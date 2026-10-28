-- ══════════════════════════════════════════════════════════════════
--  118 · Names, login emails, retirements and bowler changes: narrower reads
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Five small rules about children's data, in four functions,
-- each proved by db/99 §95. No table changes; nothing here widens a read.
-- Each rule carries Kameel's answers of 28 October 2026 to the
-- red-team of that day (READERS_child_data §7, the decisions of 28 Oct).
--
-- 1. THE PUBLIC NEWS SCAN READS EVERY PART OF A NAME (PUBLIC_DATA §1 rules
--    3 and 4: no full name, no first name alone, no name without consent).
--    db/83's news_public_names() counted the school's pupils whose full name
--    or known-as the post's words carried. A surname alone ("Erasmus took
--    five", "D Erasmus 52*") or a first name alone ("Well done Dylan") passed
--    the scan, and the scan is the only check: the approver is told a count,
--    never which name. It now also reads the stored surname (db/47) and every
--    word of the full name of two letters or more, split on anything
--    that is not a letter ("Erasmus, D" gives Erasmus; "Mary-Anne" gives
--    Mary and Anne), whole-word and case-blind, and refuses on any hit. The
--    surname particles (van, der, de, …) are not names on their own and are
--    not scanned as words; the full name and the surname that carry them
--    still are. Kameel's answers (22 October 2026):
--      - the boys scanned are the post's school's AND those of every school
--        it has a fixture with, home or away, starting in the twelve months
--        before now or the three after: a post names the other side's boys
--        as easily as its own;
--      - the refusal still answers a count, and news_public_word() tells the
--        author and the school's publishers which word of their own post
--        matched, as the post writes it: never which boy or which school.
--    And of 28 October 2026: "Catch two-letter names too". A first name of
--    two letters ("Jo", "Al") is a word of his name like any other. Whole-
--    word, so "Jo" never matches inside "Johannesburg". A boy whose name is
--    a common word ("Will", "May", "Brown") makes every post using the word
--    refuse: that over-blocking is by design (PUBLIC_DATA §5a), and the
--    author is told the word; it is not to be "fixed" by weakening the scan.
--    The scan (news_public_hits, news_public_names) is no definer and
--    nobody's to call.
--
-- 2. A PUPIL'S LOGIN EMAIL IS THE OFFICE'S (READERS A2-A5; PUBLIC_DATA §5a).
--    The `users` and `accounts` reads give every user.read holder at a school
--    each account's email, and user.read is held by finance and sponsorship
--    as well as the office. app_user_email_seen() answers an account's email
--    to the account holder himself, to anybody for an adult's account, and
--    for a pupil's account (an account linked to a player row, or that holds
--    or held a `player` or `selfaccess` assignment) only to a holder of
--    guardian.link.manage at a school the pupil is at: the office and the
--    principal. Kameel, 28 October 2026: "The office alone, as A4 says" —
--    user.role.assign no longer opens it, so the director of sport (and the
--    platform account) read the pupil's account with no email on it.
--    Otherwise NULL. It is handed the row's own email, so it can only ever
--    answer what the caller's row already carried, or less.
--
-- 3. A RETIREMENT'S REASON STAYS AT THE BOY'S SCHOOL (SCRBRD-136-137 away
--    visibility §4: the log does not say whether a boy is carrying
--    something; the public page's projection already says "not out").
--    A `retire` event carries its reason (hurt, out, timed out) in its
--    payload, and the signed-in log is read by both schools' families and
--    spectators. ball_event_payload_seen() leaves every payload as it is
--    except a retirement that is not a dismissal (no `W`, or a reason other
--    than out or timed out), whose reason reads "not out" to a reader who
--    holds no fixture.read at the retiring boy's school, or who is platform-
--    wide (an assignment naming no school: the league account, the owner's
--    key; Kameel, 28 October 2026, "Only its own competitions: refuse a
--    platform-wide caller"). Inside his school everybody who may read the
--    log reads "retired hurt", as built (Kameel, 28 October 2026: "Everyone
--    at his school (as built)"). A batter the pad
--    knows only by a typed name has no school here, and reads "not out" to
--    everybody. A retired-out or timed-out batter keeps his reason: it is a
--    dismissal on the scorecard. The fold reads both alike (a retirement
--    that is not a dismissal leaves him not out and free to return), so a
--    log read with the reason masked replays to the same scorecard.
--    The pad's handover still reads the raw log; it is the scorer's.
--
-- 4. A BOWLER CHANGE'S REASON STAYS AT THE BOWLER'S SCHOOL (Kameel, 22
--    October 2026). A bowler replaced during an over (Law 17.7.1) is
--    recorded with why: injury, or suspended. The other school of the
--    fixture sees that the bowler changed, never why: the same function
--    drops `reason` from a `bowler` event for a reader with no fixture.read
--    at the bowler's school, or who is platform-wide. A Law 41 suspension (`bowler_suspended`) is
--    treated alike: its ground is a conduct matter (db/59), so the other
--    school reads that he was suspended and for how long (`scope`), never
--    on what ground; the fold reads a suspension with no reason the same. A bowler the pad knows only by a typed name is
--    at no school here, and his reason reaches nobody through the log. The
--    public projection already keeps only who bowls (public/redact.mjs), and
--    the Match Centre's scorecard and commentary say no reason; the pad's
--    words say it from the log as the reader has it.
--
-- 5. THE LEAGUE READS ITS OWN COMPETITIONS' CONDUCT RECORDS, AND NO OTHERS
--    (Kameel, 28 October 2026: "Only its own competitions: refuse a
--    platform-wide caller"). db/116's competition_discipline_records() kept
--    a record when competition.discipline.read held at the competition's
--    organiser, and app_can() lets an assignment naming no school pass for
--    every school: the pilot's league account, held platform-wide, read the
--    records of every competition on the platform. It is re-created here
--    with two tests before app_can(): the caller is not platform-wide
--    (app_is_platform_wide(), db/22), and the competition has an organiser
--    (competition_organiser() IS NOT NULL), so a competition nobody
--    organises opens to nobody. Everything else is db/116's, line for line:
--    the columns, the order, the per-school log. Guarded: the body in place
--    must be db/116's or this file's (whitespace folded, md5), or nothing is
--    changed. A league is scoped to the school that organises its
--    competition; one held platform-wide reads no conduct record at all.
--
-- GRANTS. app_user_email_seen(), ball_event_payload_seen() and news_public_word() are definers
-- (they look up a pupil's assignments and a boy's school past the caller's
-- own policies), executable by scrbrd_app only: never PUBLIC, nor a
-- managed host's anon/authenticated roles.
-- news_public_names() keeps db/83's grants: none.
-- competition_discipline_records() keeps db/116's: scrbrd_app alone.

-- ── 1 · The scan ───────────────────────────────────────────────────
/**
 * Every word of the post's title and body that names a boy the scan reads:
 * the boy and the word as the post writes it, with where it first stands.
 * The boys are the post's school's, and those of every school it has a
 * fixture with, home or away, starting within the twelve months before now
 * or the three after (Kameel, 22 October 2026). The names: full name,
 * known-as and stored surname (two letters or more), and each word of the
 * full name of two letters or more (Kameel, 28 October 2026), split on
 * anything that is not a letter, surname particles aside; whole-word and
 * case-blind. Internal: not
 * a definer, called only from inside definers (as their owner), nobody's to
 * call.
 */
CREATE OR REPLACE FUNCTION news_public_hits(p_post uuid)
RETURNS TABLE (player_id uuid, word text, at integer) AS $$
  WITH post AS (
    SELECT n.school_id, n.title || E'\n' || n.body AS txt FROM news_post n WHERE n.id = p_post
  ), schools AS (
    SELECT post.school_id AS school_id FROM post
    UNION
    SELECT CASE WHEN m.school_id = post.school_id THEN m.away_school_id ELSE m.school_id END
      FROM match m, post
     WHERE (m.school_id = post.school_id OR m.away_school_id = post.school_id)
       AND m.away_school_id IS NOT NULL
       AND m.starts_at >= now() - interval '12 months'
       AND m.starts_at <= now() + interval '3 months'
  ), names AS (
    SELECT p.id AS player_id, c.name
      FROM player p
      JOIN schools sc ON sc.school_id = p.school_id
      CROSS JOIN LATERAL (
        SELECT btrim(x) AS name
          FROM unnest(ARRAY[p.full_name, p.known_as, p.surname]) AS x
         WHERE length(btrim(coalesce(x, ''))) >= 2
        UNION
        SELECT t
          FROM regexp_split_to_table(btrim(coalesce(p.full_name, '')), '[^[:alpha:]]+') AS t
         WHERE length(t) >= 2
           AND lower(t) NOT IN ('van', 'von', 'der', 'den', 'des', 'del', 'dos', 'das', 'ten', 'ter')) AS c
  ), hits AS (
    SELECT nm.player_id,
           regexp_match(post.txt,
             '(?:^|[^[:alnum:]])('
             || regexp_replace(regexp_replace(nm.name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '\s+', '\\s+', 'g')
             || ')(?:$|[^[:alnum:]])', 'i') AS m,
           post.txt
      FROM names nm, post
  )
  SELECT h.player_id, h.m[1], strpos(h.txt, h.m[1])
    FROM hits h
   WHERE h.m IS NOT NULL
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_hits(uuid) FROM PUBLIC;

/**
 * How many boys the post names (news_public_hits()). Internal, as db/83's:
 * called only from inside its definers.
 */
CREATE OR REPLACE FUNCTION news_public_names(p_post uuid) RETURNS integer AS $$
  SELECT count(DISTINCT h.player_id)::integer FROM news_public_hits(p_post) h
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_names(uuid) FROM PUBLIC;

/**
 * The first word in the post that names a boy, as the post writes it, for
 * the author and the school's publishers (who already read the post), and
 * NULL for anybody else or a post that names nobody (Kameel, 22 October
 * 2026). The word only: never which boy, nor which school, it belongs to.
 */
CREATE OR REPLACE FUNCTION news_public_word(p_post uuid) RETURNS text AS $$
  SELECT CASE WHEN (n.author_id = app_user_id() AND NOT app_pad_scoped())
                   OR app_can('broadcast.publish', n.school_id, '*'::text,
                              '00000000-0000-0000-0000-000000000000'::uuid,
                              '00000000-0000-0000-0000-000000000000'::uuid)
              THEN (SELECT h.word FROM news_public_hits(n.id) h ORDER BY h.at, h.word LIMIT 1) END
    FROM news_post n
   WHERE n.id = p_post AND n.scope IN ('team', 'school')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION news_public_word(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_public_word(uuid) TO scrbrd_app;


-- ── 2 · A pupil's login email ──────────────────────────────────────
/**
 * The email an account row may show this reader: `p_email` (the row's own)
 * or NULL. See (2) above.
 */
CREATE OR REPLACE FUNCTION app_user_email_seen(p_user uuid, p_school uuid, p_email text)
RETURNS text AS $$
DECLARE
  v_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  v_schools uuid[];
BEGIN
  IF p_email IS NULL OR p_user IS NULL THEN RETURN p_email; END IF;
  IF p_user = app_user_id() THEN RETURN p_email; END IF;
  -- The schools a pupil is at: his player row's, and his player or
  -- selfaccess assignments' (ended ones too: a boy who has left is still a
  -- boy). An account with none of these is an adult's.
  SELECT array_agg(DISTINCT s) INTO v_schools
    FROM (SELECT p.school_id AS s
            FROM app_user u JOIN player p ON p.id = u.player_id
           WHERE u.id = p_user
          UNION ALL
          SELECT a.school_id
            FROM role_assignment a
           WHERE a.person_id = p_user AND a.role IN ('player', 'selfaccess')) z;
  IF v_schools IS NULL THEN
    -- Neither linked to a player nor ever held a pupil's role: an adult.
    RETURN p_email;
  END IF;
  v_schools := array_remove(v_schools || p_school, NULL);
  -- The office and the principal alone (Kameel, 28 October 2026).
  IF EXISTS (SELECT 1 FROM unnest(v_schools) s
              WHERE app_can('guardian.link.manage', s, '*'::text, v_nil, v_nil)) THEN
    RETURN p_email;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION app_user_email_seen(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_email_seen(uuid, uuid, text) TO scrbrd_app;


-- ── 3 · A retirement's reason, and a bowler change's ──────────────
/**
 * A ball_event payload of match `p_match` as this reader may have it. See (3)
 * and (4) above. The match is asked of app_can() as the fixture, so a
 * one-fixture assignment counts for its own fixture, and a pad resume
 * credential (db/50) answers for its own match only. `p_bowler` is the row's
 * bowler_id; a bowler the pad knows only by a typed name is in the payload.
 */
CREATE OR REPLACE FUNCTION ball_event_payload_seen(p_match uuid, p_kind text, p_ball_type text, p_bowler uuid, p_payload jsonb)
RETURNS jsonb AS $$
  SELECT CASE
    WHEN p_payload IS NULL OR NOT (p_payload ? 'reason') OR p_kind IS NULL
         OR p_kind NOT IN ('retire', 'bowler', 'bowler_suspended') THEN p_payload
    -- A retirement that is a dismissal is on the scorecard, reason and all.
    WHEN p_kind = 'retire' AND p_ball_type = 'W' AND p_payload->>'reason' IN ('out', 'timed_out') THEN p_payload
    -- The reader holds fixture.read at the school of the boy the reason is
    -- about, and is not platform-wide (Kameel, 28 October 2026).
    WHEN NOT app_is_platform_wide()
     AND EXISTS (SELECT 1 FROM player p
                  WHERE p.id::text = lower(CASE WHEN p_kind = 'retire' THEN p_payload->>'batter'
                                                ELSE coalesce(p_bowler::text, p_payload->>'bowler') END)
                    AND app_can('fixture.read', p.school_id, '*'::text,
                                '00000000-0000-0000-0000-000000000000'::uuid, p_match)) THEN p_payload
    WHEN p_kind = 'retire' THEN jsonb_set(p_payload, '{reason}', to_jsonb('not out'::text))
    -- A bowler change or a suspension: that it happened (and a suspension's
    -- scope), never why.
    ELSE p_payload - 'reason'
  END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION ball_event_payload_seen(uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ball_event_payload_seen(uuid, text, text, uuid, jsonb) TO scrbrd_app;


-- ── 5 · The league's conduct read: its own competitions only ──────
-- The body in place must be db/116's or this file's, compared on its source
-- with every run of whitespace folded to one space, so a paste that changed
-- only line endings or indentation still matches; any other change refuses.
DO $guard$
DECLARE v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('app_is_platform_wide()') IS NULL OR to_regprocedure('competition_organiser(uuid)') IS NULL
     OR to_regprocedure('log_restricted_read(text,uuid[],text[],uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/118: app_is_platform_wide() (db/22), competition_organiser() (db/61) or log_restricted_read() is missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('competition_discipline_records(uuid)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/118: competition_discipline_records(uuid) (db/116) is not there to re-create; apply db/116 first';
  END IF;
  v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
  IF v_md5 NOT IN ('b19a54c77246608200bececc31265e45',   -- db/116
                   'fdc6e483bf188661437542b4e6e84a0a')    -- this file
  THEN
    RAISE EXCEPTION 'db/118: competition_discipline_records() is not db/116''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
END $guard$;

/**
 * db/116's read of the conduct records whose fixture is in a competition the
 * reader organises, with (5) above: never for a platform-wide caller, never
 * for a competition with no organiser. Every call that returns a record
 * writes one access_log row per school whose children it names, as db/116's.
 */
CREATE OR REPLACE FUNCTION competition_discipline_records(p_competition uuid DEFAULT NULL)
RETURNS TABLE (id uuid, player_id uuid, full_name text, school_id uuid, school_name text,
               match_id uuid, competition_id uuid, opponent text, starts_at timestamptz,
               occurred_on date, body text, state text, outcome text,
               created_at timestamptz, updated_at timestamptz) AS $$
DECLARE
  r      record;
  v_sch  uuid[] := '{}';
  v_ply  uuid[] := '{}';
  v_out  boolean[] := '{}';
  s      uuid;
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped() THEN RETURN; END IF;
  -- A platform-wide caller reads no competition's records (Kameel, 28 Oct).
  IF app_is_platform_wide() THEN RETURN; END IF;
  FOR r IN
    SELECT d.id, d.player_id, p.full_name, d.school_id, sc.name AS school_name,
           d.match_id, m.competition_id, m.opponent, m.starts_at,
           d.occurred_on, d.body, d.state, d.outcome, d.created_at, d.updated_at
      FROM disciplinary_record d
      JOIN match m ON m.id = d.match_id
      JOIN player p ON p.id = d.player_id
      JOIN school sc ON sc.id = d.school_id
     WHERE m.competition_id IS NOT NULL
       AND (p_competition IS NULL OR m.competition_id = p_competition)
       -- A competition nobody organises opens to nobody.
       AND competition_organiser(m.competition_id) IS NOT NULL
       AND app_can('competition.discipline.read', competition_organiser(m.competition_id), '*'::text,
                   '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     ORDER BY d.occurred_on DESC, d.created_at DESC, d.id
  LOOP
    id := r.id; player_id := r.player_id; full_name := r.full_name; school_id := r.school_id;
    school_name := r.school_name; match_id := r.match_id; competition_id := r.competition_id;
    opponent := r.opponent; starts_at := r.starts_at; occurred_on := r.occurred_on; body := r.body;
    state := r.state; outcome := r.outcome; created_at := r.created_at; updated_at := r.updated_at;
    v_sch := v_sch || r.school_id; v_ply := v_ply || r.player_id; v_out := v_out || (r.outcome IS NOT NULL);
    RETURN NEXT;
  END LOOP;
  -- One row per school, naming its children and the watched columns that
  -- came back (the API's RESTRICTED_FIELDS.disciplinary_records: body, outcome).
  FOR s IN SELECT DISTINCT u.sc FROM unnest(v_sch) u(sc) LOOP
    PERFORM log_restricted_read('competition_discipline_records',
      (SELECT array_agg(DISTINCT x.pl ORDER BY x.pl) FROM unnest(v_sch, v_ply) x(sc, pl) WHERE x.sc = s),
      CASE WHEN EXISTS (SELECT 1 FROM unnest(v_sch, v_out) x(sc, ou) WHERE x.sc = s AND x.ou)
           THEN ARRAY['body', 'outcome'] ELSE ARRAY['body'] END,
      s);
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION competition_discipline_records(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_discipline_records(uuid) TO scrbrd_app;


-- ── A managed host's API roles reach none of it ────────────────────
DO $managed$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['app_user_email_seen(uuid,uuid,text)', 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)',
                               'news_public_names(uuid)', 'news_public_hits(uuid)', 'news_public_word(uuid)',
                               'competition_discipline_records(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $managed$;


-- ── Checks ─────────────────────────────────────────────────────────
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('anon', 'authenticated')
               AND (has_function_privilege(g.oid, 'app_user_email_seen(uuid,uuid,text)'::regprocedure, 'EXECUTE')
                    OR has_function_privilege(g.oid, 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'db/118: a managed host''s API role can call a definer here';
  END IF;
  IF has_function_privilege('scrbrd_app', 'news_public_names(uuid)'::regprocedure, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'news_public_names(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/118: news_public_names() is callable by the application, or is a definer';
  END IF;
  IF has_function_privilege('scrbrd_app', 'news_public_hits(uuid)'::regprocedure, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = 'news_public_hits(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/118: news_public_hits() is callable by the application, or is a definer';
  END IF;
  IF has_function_privilege('public', 'news_public_word(uuid)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'news_public_word(uuid)'::regprocedure, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(g.oid, 'news_public_word(uuid)'::regprocedure, 'EXECUTE')) THEN
    RAISE EXCEPTION 'db/118: news_public_word() is not the application''s alone';
  END IF;
  IF has_function_privilege('public', 'app_user_email_seen(uuid,uuid,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('public', 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/118: a definer here is executable by PUBLIC';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'app_user_email_seen(uuid,uuid,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/118: the application cannot execute a function its reads call';
  END IF;
  -- The league's read: db/116's grants and shape, with both tests in place.
  IF has_function_privilege('public', 'competition_discipline_records(uuid)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'competition_discipline_records(uuid)'::regprocedure, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(g.oid, 'competition_discipline_records(uuid)'::regprocedure, 'EXECUTE')) THEN
    RAISE EXCEPTION 'db/118: competition_discipline_records() is not the application''s alone';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = 'competition_discipline_records(uuid)'::regprocedure AND p.prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))
                    AND position('app_is_platform_wide()' IN p.prosrc) > 0
                    AND position('competition_organiser(m.competition_id) IS NOT NULL' IN p.prosrc) > 0) THEN
    RAISE EXCEPTION 'db/118: competition_discipline_records() is not a pinned definer refusing a platform-wide caller and an unorganised competition';
  END IF;
  IF position('app_is_platform_wide()' IN (SELECT prosrc FROM pg_proc WHERE oid = 'ball_event_payload_seen(uuid,text,text,uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/118: ball_event_payload_seen() unmasks for a platform-wide caller';
  END IF;
END $check$;
