-- ══════════════════════════════════════════════════════════════════
--  59 · The signed-out read path (SCRBRD-083, public pages phase 1)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/policy/PUBLIC_DATA.md is the rule and
-- docs/design/SCRBRD-083_public_pages.md is how it is built; this file is
-- that design's phase 1 migration (§8), and db/47 holds the records it reads.
--
-- A public request (services/api/public/) runs as the ANONYMOUS principal:
-- app.user_id is empty, app_user_id() is NULL, app_can() finds nothing, and
-- every row-level policy in db/ denies. So a plain SELECT from any base table
-- inside a public read returns no rows. The only data a signed-out page can
-- reach comes through the functions below, each SECURITY DEFINER, each naming
-- every column it selects (packages/policy/test/public.test.mjs reads this
-- file and holds every one against NEVER_PUBLIC with assertPublicSelect()),
-- and each answering NOTHING for a fixture neither of whose sides has been
-- published — the same nothing as for a fixture that does not exist.
--
-- WHAT IS HERE:
--
--   1. public_fixture_served(match) — at least one side published
--      (fixture_side_published(), db/47). Internal: owner only.
--
--   2. public_match_header(match) — the page's header: both sides by team
--      name, short codes, format and overs, the start, the ground, the
--      status, the toss, which sides are published, the score by innings (a
--      team fact), the fold's context and the day being served. No official
--      (design §9 Q5), no weather, no pitch report, no player.
--
--   3. public_match_log(match, since) — the fixture's event log with every
--      field named: the typed columns a fold needs, and the payload's keys ONE
--      BY ONE (never the payload whole). The API (services/api/public/
--      redact.mjs) then applies the per-kind allowlist, replaces every player
--      and every event id with a per-match HMAC pseudonym keyed by an
--      environment variable this database never sees, and labels each squad
--      member by publicName(). Kinds that carry nothing a spectator may read
--      (bowler_suspended: a Law 41 suspension is a conduct matter about one
--      boy, N3) are not returned at all.
--
--   4. public_match_people(match) — one row per player the log names: the
--      facts publicName() needs (public_name_facts(), db/47, for HIS side,
--      judged on the day served), whether his side is published, and the
--      three name columns the formatter reads. For the API's formatter only:
--      the API sends the label it computes and never these columns
--      (services/api/public/public.test.mjs asserts no name part, no player
--      id, no date of birth in any response).
--
--   5. public_shot_sectors(match) — L7, team level: per innings and sector,
--      the scoring shots and the runs off the bat. No ball, no batter, no
--      coordinates.
--
--   6. public_data_changed — pg_notify from AFTER triggers on everything a
--      public page's answer depends on, so the API's cache drops the entries
--      a change touches on the next request rather than at the TTL (C3: a
--      "no" reaches every page at once; design §2.6). The payload is a kind
--      ("player", "school", "match", "competition") and an id, and never the
--      table: a listener cannot tell a never-public mark (C5, whose row's
--      existence is the disclosure) from a consent or a surname.
--
-- WHO MAY CALL THEM: scrbrd_app, the role the API connects as, and nobody
-- else — not PUBLIC and not a managed host's anon/authenticated roles. That
-- is the one grant the public path needs, and it is justified by where the
-- rule is applied: public_match_log() returns player ids and
-- public_match_people() returns full names, both of which the API turns into
-- pseudonyms and labels before anything leaves the server. A grant to `anon`
-- would hand a stranger holding the platform's anonymous key the raw inputs
-- to the rule rather than its answer. The design's §2.2 says the same; the
-- check at the foot of this file and db/99 section 37 hold it.
--
-- NOT HERE, on purpose:
--   - fixture_publish() refusing a transcribed (backfilled) match (design
--     §2.4, SCRBRD-099). No provenance column exists yet — nothing on match
--     or ball_event says "transcribed" — so there is nothing to refuse on.
--     SCRBRD-099's migration adds the refusal to fixture_publish() and the
--     exclusion to public_fixture_served() when it adds the provenance.
--   - A page-view counter (§9 Q8, decided no).
--   - Competition, fixtures-list and honours reads (phase 2), AI commentary
--     (phase 3), the overlay's board and broadcast_state() (phase 4), and
--     the turning-18 changes to db/47's functions (phase 5).
--
-- search_path is pinned on every function below (db/16).


-- ── 1 · Is this fixture served at all ──────────────────────────────
/**
 * True when at least one side of the fixture is published (design §2.5). A
 * fixture that does not exist is false, the same false. Not SECURITY
 * DEFINER: it is only ever called from inside the definers below, where it
 * runs as their owner; called by anyone else it reads through RLS.
 */
CREATE OR REPLACE FUNCTION public_fixture_served(p_match uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM match m
     WHERE m.id = p_match
       AND (fixture_side_published(m.id, 'home') OR fixture_side_published(m.id, 'away')))
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_fixture_served(uuid) FROM PUBLIC;


-- ── 2 · The header ─────────────────────────────────────────────────
/**
 * One row for a served fixture; none otherwise. Team facts only: a school's
 * name is not a child's, and the away `opponent` text of an off-platform side
 * is shown as typed because it names a school (design §9 Q3).
 *
 *   scores   [{innings, runs, wickets, balls}] from match_live_score, the
 *            same count the live score and the handover check make
 *   served_on  sa_today(), the day every name on the page is judged on
 *            (PUBLIC_DATA §5a) — the API passes it to publicName() as `on`
 */
CREATE OR REPLACE FUNCTION public_match_header(p_match uuid)
RETURNS TABLE (
  home_label text, home_code text, home_team text,
  away_label text, away_code text, away_team text, away_on_platform boolean,
  sport text, format text, overs smallint, starts_at timestamptz, ground text, status text,
  toss_won_by text, toss_decision text,
  home_published boolean, away_published boolean,
  scores jsonb, served_on text
) AS $$
  SELECT fixture_side_label(m.school_id, m.team_code),
         hs.code,
         m.team_code,
         CASE WHEN m.away_school_id IS NULL THEN m.opponent
              ELSE fixture_side_label(m.away_school_id, m.away_team_code) END,
         aws.code,
         m.away_team_code,
         m.away_school_id IS NOT NULL,
         m.sport, m.format, m.overs, m.starts_at,
         g.name,
         m.status,
         t.won_by, t.decision,
         fixture_side_published(m.id, 'home'),
         fixture_side_published(m.id, 'away'),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                            'innings', s.innings, 'runs', s.runs,
                            'wickets', s.wickets, 'balls', s.legal_balls) ORDER BY s.innings)
                     FROM match_live_score s
                    WHERE s.match_id = m.id), '[]'::jsonb),
         to_char(sa_today(), 'YYYY-MM-DD')
    FROM match m
    JOIN school hs ON hs.id = m.school_id
    LEFT JOIN school aws ON aws.id = m.away_school_id
    LEFT JOIN ground g ON g.id = m.ground_id
    LEFT JOIN match_toss t ON t.match_id = m.id
   WHERE m.id = p_match
     AND public_fixture_served(m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_match_header(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_header(uuid) TO scrbrd_app;


-- ── 3 · The log, every field named ─────────────────────────────────
/**
 * The served fixture's events after `p_since`, in seq order: the columns a
 * fold needs by name, and from the payload only the keys some event kind's
 * allowlist can keep (services/api/public/redact.mjs PUBLIC_EVENT_FIELDS),
 * each by name. The payload itself is never selected: a key a producer adds
 * tomorrow reaches nobody until somebody lists it here AND in the allowlist.
 *
 * Not selected, and so not reachable by the API's projection at all: shot,
 * contact, trajectory, seg, zone, theta, radius, placement and capture
 * columns (L7: placement is team level, public_shot_sectors() below);
 * scorer_user_id, device_id, server_ts, epoch, recovered (who and what
 * scored it). `event_key` is the idempotency key — a device id is inside it —
 * returned only so the API can pseudonymise it and every void's target alike.
 *
 * Voided events stay in the log, with their voids: the browser's fold drops
 * them as the signed-in fold does, so the two folds are one fold (§2.4).
 */
CREATE OR REPLACE FUNCTION public_match_log(p_match uuid, p_since integer DEFAULT 0)
RETURNS TABLE (
  seq integer, innings smallint, kind text, ball_type text, value smallint,
  striker_id uuid, non_striker_id uuid, bowler_id uuid, dismissed_id uuid, dismissal text,
  event_key text, client_ts timestamptz, detail jsonb
) AS $$
  SELECT b.seq, b.innings, b.kind, b.ball_type, b.value,
         b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id, b.dismissal,
         b.idempotency_key, b.client_ts,
         jsonb_strip_nulls(jsonb_build_object(
           -- innings_start
           'battingTeam',    b.payload -> 'battingTeam',
           'bowlingTeam',    b.payload -> 'bowlingTeam',
           'teamKey',        b.payload -> 'teamKey',
           'bowlingTeamKey', b.payload -> 'bowlingTeamKey',
           'squad',          b.payload -> 'squad',
           'bowlingSquad',   b.payload -> 'bowlingSquad',
           'overs',          b.payload -> 'overs',
           'target',         b.payload -> 'target',
           -- a player the scorer typed, where the column holds no id
           'striker',        b.payload -> 'striker',
           'nonStriker',     b.payload -> 'nonStriker',
           'bowler',         b.payload -> 'bowler',
           'dismissed',      b.payload -> 'dismissed',
           -- batters
           'captainConsent', b.payload -> 'captainConsent',
           -- ball
           'fielder',        b.payload -> 'fielder',
           'freeHit',        b.payload -> 'freeHit',
           'nbRuns',         b.payload -> 'nbRuns',
           'nbType',         b.payload -> 'nbType',
           'outAt',          b.payload -> 'outAt',
           'facesNext',      b.payload -> 'facesNext',
           'notInOver',      b.payload -> 'notInOver',
           -- penalty
           'runs',           b.payload -> 'runs',
           'toBattingTeam',  b.payload -> 'toBattingTeam',
           -- retire; penalty, innings_end and revision reasons (the API keeps
           -- a reason only where it is a code from a closed list)
           'batter',         b.payload -> 'batter',
           'reason',         b.payload -> 'reason',
           -- innings_end
           'confirmed',      b.payload -> 'confirmed')) AS detail
    FROM ball_event b
   WHERE b.match_id = p_match
     AND b.seq > coalesce(p_since, 0)
     AND b.kind IN ('innings_start', 'batters', 'bowler', 'ball', 'penalty', 'retire',
                    'innings_end', 'revision', 'void')
     AND public_fixture_served(b.match_id)
   ORDER BY b.seq
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_match_log(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_log(uuid, integer) TO scrbrd_app;


-- ── 4 · The people the log names, and the facts about each ─────────
/** A uuid, from a payload's text; NULL for anything else (a typed name). */
CREATE OR REPLACE FUNCTION public_ref_uuid(p_ref text) RETURNS uuid AS $$
  SELECT CASE WHEN p_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN p_ref::uuid END
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_ref_uuid(text) FROM PUBLIC;

/** A payload value as an array: the value when it is one, else empty. */
CREATE OR REPLACE FUNCTION public_json_array(p_value jsonb) RETURNS jsonb AS $$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'array' THEN p_value ELSE '[]'::jsonb END
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_json_array(jsonb) FROM PUBLIC;

/**
 * One row per player (a `player` row) the served fixture's log refers to,
 * anywhere: the four id columns, a typed-or-id reference in the payload, a
 * squad member, a fielder, a retiring batter.
 *
 * HIS SIDE is the side whose school is his school (L5: each school speaks
 * for its own children). `school_published` is true only when EVERY such side
 * is published — a fixture between two sides of one school needs both — and
 * false when neither side is his school's (a boy whose school is on neither
 * side is nobody this fixture's publication speaks for). `facts` is
 * public_name_facts() for his side's team code (a boy playing up, §5a), with
 * namesOff true if it is true for any side of his school in the fixture.
 *
 * The three name columns are the formatter's (public.mjs initialAndSurname()).
 * They never leave the API: it sends publicName()'s answer and nothing else.
 */
CREATE OR REPLACE FUNCTION public_match_people(p_match uuid)
RETURNS TABLE (
  player_id uuid, school_published boolean, facts jsonb,
  full_name text, surname text, known_as text, served_on text
) AS $$
  WITH refs AS (
    SELECT b.striker_id AS pid FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT b.non_striker_id FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT b.bowler_id FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT b.dismissed_id FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'striker') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'nonStriker') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'bowler') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'dismissed') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'fielder') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(b.payload ->> 'batter') FROM ball_event b WHERE b.match_id = p_match
    UNION SELECT public_ref_uuid(coalesce(e.member ->> 'id', e.member #>> '{}'))
            FROM ball_event b
            CROSS JOIN LATERAL jsonb_array_elements(public_json_array(b.payload -> 'squad')
                                                    || public_json_array(b.payload -> 'bowlingSquad')) AS e(member)
           WHERE b.match_id = p_match AND b.kind = 'innings_start'
  )
  SELECT p.id,
         coalesce(x.published, false),
         public_name_facts(p.id, x.team, sa_today())
           || jsonb_build_object('namesOff', coalesce(x.names_off, true)),
         p.full_name, p.surname, p.known_as,
         to_char(sa_today(), 'YYYY-MM-DD')
    FROM refs r
    JOIN player p ON p.id = r.pid
    JOIN match m ON m.id = p_match
    CROSS JOIN LATERAL (
      SELECT bool_and(fixture_side_published(m.id, s.side)) AS published,
             bool_or((public_name_facts(p.id, s.team, sa_today()) ->> 'namesOff')::boolean) AS names_off,
             min(s.team) AS team
        FROM (VALUES ('home', m.school_id, m.team_code),
                     ('away', m.away_school_id, m.away_team_code)) AS s(side, school, team)
       WHERE s.school = p.school_id
    ) x
   WHERE public_fixture_served(m.id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_match_people(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_people(uuid) TO scrbrd_app;


-- ── 5 · Where the runs went, for the team (L7) ─────────────────────
/**
 * Per innings and sector (the stored `seg`, 0–11: the ground as the scorer's
 * field graphic draws it), the scoring shots and the runs off the bat, over
 * the live log (voided deliveries out). Runs off the bat as runsOffBat()
 * counts them: a run or a wicket ball's value, a no-ball's unless its runs
 * were byes or leg byes. No ball, no batter, no bowler, no coordinate.
 */
CREATE OR REPLACE FUNCTION public_shot_sectors(p_match uuid)
RETURNS TABLE (innings smallint, sector smallint, shots integer, runs integer) AS $$
  SELECT b.innings, b.seg, count(*)::integer, sum(b.value)::integer
    FROM ball_event_live b
   WHERE b.match_id = p_match
     AND b.kind = 'ball'
     AND b.seg IS NOT NULL
     AND coalesce(b.value, 0) > 0
     AND (b.ball_type IN ('run', 'W')
          OR (b.ball_type = 'Nb' AND coalesce(b.payload ->> 'nbRuns', '') NOT IN ('byes', 'leg_byes')))
     AND public_fixture_served(b.match_id)
   GROUP BY b.innings, b.seg
   ORDER BY b.innings, b.seg
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_shot_sectors(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_shot_sectors(uuid) TO scrbrd_app;


-- ── 6 · "At once": tell the API what changed ───────────────────────
/**
 * AFTER trigger: pg_notify('public_data_changed', {"k": kind, "id": id}).
 * TG_ARGV[0] is the kind the API's cache is keyed by and TG_ARGV[1] the
 * column holding the id. The table is never named (see the header). A
 * notification is delivered on COMMIT and never for a rolled-back change.
 */
CREATE OR REPLACE FUNCTION public_data_notify() RETURNS trigger AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  PERFORM pg_notify('public_data_changed',
                    jsonb_build_object('k', TG_ARGV[0], 'id', v_row ->> TG_ARGV[1])::text);
  RETURN NULL;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_data_notify() FROM PUBLIC;

-- The design's list (§2.6), and three it follows from:
--   assignment_subject  a guardian link's state decides whether his consent
--                       is competent (db/47): a revoked link unnames him
--   player              the three name columns, his date of birth (his age
--                       group, names-off), his side and school
--   match               a side's school changing unpublishes that side
--                       (fixture_side_published() compares them)
DO $triggers$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('public_name_consent',     'player',      'player_id',      'INSERT OR UPDATE OR DELETE'),
      ('player_never_public',     'player',      'player_id',      'INSERT OR UPDATE OR DELETE'),
      ('public_names_off',        'school',      'school_id',      'INSERT OR UPDATE OR DELETE'),
      ('fixture_publication',     'match',       'match_id',       'INSERT OR UPDATE OR DELETE'),
      ('competition_publication', 'competition', 'competition_id', 'INSERT OR UPDATE OR DELETE'),
      ('match_broadcast',         'match',       'match_id',       'INSERT OR UPDATE OR DELETE'),
      ('honour',                  'player',      'player_id',      'INSERT OR UPDATE OR DELETE'),
      ('assignment_subject',      'player',      'player_id',      'INSERT OR UPDATE OR DELETE'),
      ('player',                  'player',      'id',
         'UPDATE OF full_name, surname, known_as, born, team_code, school_id OR DELETE'),
      ('match',                   'match',       'id',
         'UPDATE OF school_id, team_code, away_school_id, away_team_code, status, starts_at, ground_id OR DELETE')
    ) AS v(tbl, kind, col, events)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS public_data_changed ON %I', t.tbl);
    EXECUTE format('CREATE TRIGGER public_data_changed AFTER %s ON %I FOR EACH ROW '
                   'EXECUTE FUNCTION public_data_notify(%L, %L)', t.events, t.tbl, t.kind, t.col);
  END LOOP;
END $triggers$;


-- ── Who may call these: the application, and nobody else ──────────
-- As db/47 does: on a managed host the platform's API roles get EXECUTE on
-- every new function by default privilege, directly and not through PUBLIC
-- (db/29 found this), so it is taken back from them here.
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY[
          'public_fixture_served(uuid)', 'public_match_header(uuid)',
          'public_match_log(uuid,integer)', 'public_match_people(uuid)',
          'public_shot_sectors(uuid)', 'public_ref_uuid(text)', 'public_json_array(jsonb)',
          'public_data_notify()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  t text;
  v_cols text;
  n int;
BEGIN
  -- The four reads: SECURITY DEFINER with a pinned search path (db/16),
  -- executable by scrbrd_app and by nobody else — not PUBLIC, not a managed
  -- host's API roles.
  FOREACH f IN ARRAY ARRAY['public_match_header(uuid)', 'public_match_log(uuid,integer)',
                           'public_match_people(uuid)', 'public_shot_sectors(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/59: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/59: the application cannot call %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public_fixture_served(uuid)', 'public_match_header(uuid)',
                           'public_match_log(uuid,integer)', 'public_match_people(uuid)',
                           'public_shot_sectors(uuid)', 'public_data_notify()'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/59: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(r.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/59: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  -- The internal helper is the owner's alone, and is not a definer: called by
  -- the application directly it would read through RLS.
  IF has_function_privilege('scrbrd_app', 'public_fixture_served(uuid)'::regprocedure, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'public_fixture_served(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/59: public_fixture_served() is callable by the application, or is a definer';
  END IF;

  -- No read returns a column §3 forbids, or the payload whole, by name. (The
  -- test in packages/policy/test/public.test.mjs reads the bodies; this reads
  -- what the functions return.)
  SELECT string_agg(a.name, ',') INTO v_cols
    FROM pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) AS a(name, mode)
   WHERE p.proname IN ('public_match_header', 'public_match_log', 'public_match_people', 'public_shot_sectors')
     AND a.mode = 't'
     AND a.name IN ('born', 'fitness', 'id_number', 'email', 'phone', 'address', 'guardian', 'hometown',
                    'houseatschool', 'height', 'weight', 'payload', 'reason', 'withdrawn_reason',
                    'device_id', 'scorer_user_id', 'theta', 'radius', 'shot');
  IF v_cols IS NOT NULL THEN
    RAISE EXCEPTION 'db/59: a public read returns %', v_cols;
  END IF;

  -- Every trigger the cache depends on exists, and fires the notifier.
  FOREACH t IN ARRAY ARRAY['public_name_consent', 'player_never_public', 'public_names_off',
                           'fixture_publication', 'competition_publication', 'match_broadcast',
                           'honour', 'assignment_subject', 'player', 'match'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                    WHERE g.tgrelid = t::regclass AND g.tgname = 'public_data_changed'
                      AND g.tgfoid = 'public_data_notify()'::regprocedure AND NOT g.tgisinternal) THEN
      RAISE EXCEPTION 'db/59: % has no public_data_changed trigger', t;
    END IF;
  END LOOP;

  -- The notifier names a kind and an id, never a table.
  IF pg_get_functiondef('public_data_notify()'::regprocedure) ~ 'TG_TABLE_NAME|TG_RELNAME' THEN
    RAISE EXCEPTION 'db/59: public_data_notify() names the table that changed';
  END IF;

  -- A fixture that does not exist is served nothing, by every read.
  SELECT (SELECT count(*) FROM public_match_header('00000000-0000-0000-0000-000000000000'))
       + (SELECT count(*) FROM public_match_log('00000000-0000-0000-0000-000000000000', 0))
       + (SELECT count(*) FROM public_match_people('00000000-0000-0000-0000-000000000000'))
       + (SELECT count(*) FROM public_shot_sectors('00000000-0000-0000-0000-000000000000'))
    INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION 'db/59: a fixture that does not exist was answered (% rows)', n;
  END IF;

  -- Nor does any fixture nobody published: every row of every read below
  -- belongs to a fixture with a published side.
  IF EXISTS (SELECT 1 FROM match m
              WHERE NOT public_fixture_served(m.id)
                AND (EXISTS (SELECT 1 FROM public_match_header(m.id))
                     OR EXISTS (SELECT 1 FROM public_match_log(m.id, 0))
                     OR EXISTS (SELECT 1 FROM public_match_people(m.id))
                     OR EXISTS (SELECT 1 FROM public_shot_sectors(m.id)))) THEN
    RAISE EXCEPTION 'db/59: an unpublished fixture was answered';
  END IF;

  IF public_ref_uuid('D Erasmus') IS NOT NULL OR public_ref_uuid('aaaaaaaa-0000-0000-0000-000000000001') IS NULL THEN
    RAISE EXCEPTION 'db/59: public_ref_uuid() does not tell an id from a typed name';
  END IF;
END $check$;
