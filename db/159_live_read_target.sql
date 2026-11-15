-- ══════════════════════════════════════════════════════════════════
--  159 · The home page's live read says the chase's target, and whether
--        the umpires revised the match (EXPERIENCE_PASS Q14, slice 3b)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/redesign/EXPERIENCE_PASS.md §3.8 and Q14
-- (decided 13 Nov 2026, as recommended): "Re-emit public_live_fixtures()
-- with `target` and `revised` … with db/99 proving it returns nothing else
-- new. Team facts only, as now." The strip's sentence ("Westville need 45
-- off 34", home/sections/LiveStrip.jsx statusSentence()) needs the target,
-- and a target worked out in the browser as the first innings plus one is
-- wrong after a rain revision, which the read could not say.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   ~ public_live_fixtures()  DROPPED AND CREATED AGAIN: CREATE OR REPLACE
--       cannot add result columns. db/133's body (db/82's with 'postponed'
--       in its status list) word for word, with two columns after the
--       thirteen it had, in the same order:
--         target   integer  the runs the side batting now must make to win:
--                           the chase's own target as the fold keeps it
--                           (the innings_start's, or the umpires' revised
--                           one, raised by an award to the fielding side),
--                           else the first innings plus one (two innings a
--                           side: the fourth innings, the runs it trails by
--                           over the three before it, plus one). NULL when
--                           the innings being played chases nothing (the
--                           first innings, a two-innings match's second
--                           and third, no innings yet) and in a super over,
--                           whose board is its own (lib/superOver.js).
--         revised  boolean  the umpires revised this match: a revision
--                           event stands in one of its own innings so far
--                           (overs or target), or the chase opened on a
--                           target other than the one worked out above.
--                           With it the strip says no balls left, as a
--                           revision can cut the overs (§3.8).
--       Derived from what the read already computes, and nothing new is
--       stored: match_result_compute()'s innings (db/121, joined by db/82's
--       body already), each with its runs, target, revised mark, side and
--       super over, and the fixture's frozen playing conditions for how
--       many innings a side (match_conditions, the document
--       public_match_conditions() already serves). Same grants as db/157
--       left the old one: EXECUTE to scrbrd_app by name, nothing to PUBLIC,
--       anon, authenticated or service_role. SECURITY DEFINER, search_path
--       pinned, STABLE, LANGUAGE sql, as before.
--   + fixture_chase(jsonb, integer)  the derivation above, over the innings
--       array and the innings per side. IMMUTABLE, not a definer, reads no
--       table; the owner's alone (public_school_listed()'s pattern, db/82):
--       called only from inside the definer above, as its owner.
--
-- WHY `target` IS PUBLIC (PUBLIC_DATA.md). A number of runs, about a team:
-- the match page's header already shows both innings' totals, from which
-- the first-innings target follows; the revised one is the umpires'
-- announcement at the ground. It names no child, no ground, no official,
-- no reason (the revision's reason code is not read). `revised` is one bit
-- about the match. Neither column's name matches db/82's forbidden list.
--
-- NOTHING ELSE. No table, column, row, policy, capability or role. The
-- old thirteen columns answer exactly what they answered: the after-block
-- below compares every row the old body gave on this database, at this
-- paste, column by column, with the new one's first thirteen, and refuses
-- the paste on any difference. db/99 §137 proves it again against a copy of
-- db/133's body on fixtures it builds.
--
-- NO DEPENDENT. Nothing in db/ calls the function from SQL but db/82's own
-- after-block (a check, run once at its paste): no view, no function body,
-- no policy. A plain DROP (no CASCADE) would refuse if anything did. The
-- API reads it with `select *` and names the fields it sends
-- (services/api/public/public-api.mjs live()).
--
-- THE GUARD keys on pg_proc.prosrc as db/133 does: the md5 of the live
-- body, its whitespace folded, must be db/133's (6aa12abd…) or this file's.
-- A body moved by another file since stops the paste. A second paste finds
-- this file's body and changes nothing (the function is dropped and made
-- again, identically, in the same transaction; its grants re-made).
--
-- db/133 CANNOT BE PASTED AGAIN AFTER THIS FILE, and must not be. Its
-- guard (db/133:201) accepts only db/82's body or its own for
-- public_live_fixtures(), so a second paste of db/133 stops at that guard,
-- which is its first statement that reads anything, and changes nothing;
-- its after-block (:657) would refuse too. That is the guard doing its
-- job: a re-paste of db/133 would otherwise patch a body it never read.
-- db/133 stays frozen; the ledger (tools/migrate.mjs) never re-runs a file
-- it has applied, and the paste bundle (tools/bundle-sql.mjs --apply)
-- refuses to run one twice, so only a hand paste of the raw file could try,
-- and it is refused whole. The same is true of db/125 after db/134, and of
-- db/149 after db/156.
--
-- One transaction: the paste runs the file inside one, so there is no BEGIN
-- or COMMIT here, and no caller sees the function missing between the DROP
-- and the CREATE. Its proof is db/99 §137; the walks are smoke-public,
-- home, public-live and browser-first-run.
--
-- Applies after db/157 (a managed host's API roles), whose rule every grant
-- here keeps: REVOKE ALL FROM PUBLIC first, then scrbrd_app by name.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v159_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

-- The old body's answer, before anything moves: the after-block compares.
-- Not ON COMMIT DROP: a paste run statement by statement (the rebuild
-- bundle) commits each one. Dropped at the end of the file.
CREATE TEMP TABLE IF NOT EXISTS _v159_before (r jsonb);
TRUNCATE _v159_before;

DO $guard$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('public_live_fixtures()') IS NULL
     OR to_regprocedure('match_result_compute(uuid)') IS NULL
     OR to_regclass('match_conditions') IS NULL
     OR to_regprocedure('api_role_reach(name)') IS NULL THEN
    RAISE EXCEPTION 'db/159: public_live_fixtures() (db/82), match_result_compute() (db/121), match_conditions (db/61) or api_role_reach() (db/157) is missing; apply them first';
  END IF;
  v_md5 := pg_temp._v159_fold((SELECT prosrc FROM pg_proc WHERE oid = 'public_live_fixtures()'::regprocedure));
  IF v_md5 NOT IN ('6aa12abde90e18205821fb4b78ef7d26',   -- db/133's
                   'f4eb927a47c09fa4bac32bf7e4ac7243') THEN   -- this file's
    RAISE EXCEPTION 'db/159: public_live_fixtures() is not db/133''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
  -- Every row, the thirteen columns db/133's body returns, as it answers now.
  INSERT INTO _v159_before
    SELECT jsonb_build_object('match_id', x.match_id, 'home_label', x.home_label, 'home_code', x.home_code,
             'away_label', x.away_label, 'away_code', x.away_code, 'away_on_platform', x.away_on_platform,
             'status', x.status, 'format', x.format, 'overs', x.overs, 'starts_at', x.starts_at,
             'scores', x.scores, 'result', x.result, 'served_on', x.served_on)
      FROM public_live_fixtures() x;
END $guard$;


-- ── 1 · The chase, from the innings the read already has ──────────
/**
 * The target and the revision mark of the innings being played, from
 * match_result_compute()'s `innings` (db/121: in innings order, each with
 * runs, target, revised, side, super_over) and the innings per side (1 or
 * 2, the fixture's frozen playing conditions). See the header for the rule.
 * Reads no table; the owner's alone.
 */
CREATE OR REPLACE FUNCTION fixture_chase(p_innings jsonb, p_ips integer)
RETURNS TABLE (target integer, revised boolean) AS $$
  WITH x AS (
    SELECT y.value AS v, y.n
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_innings) = 'array' THEN p_innings ELSE '[]'::jsonb END)
           WITH ORDINALITY y(value, n)
  ), cur AS (
    -- The innings being played: the last the log has reached.
    SELECT x.v, x.n FROM x ORDER BY x.n DESC LIMIT 1
  ), own AS (
    -- The match's own innings (not a super over's), numbered from one.
    SELECT x.v, x.n, row_number() OVER (ORDER BY x.n) AS k
      FROM x WHERE jsonb_typeof(x.v->'super_over') IS DISTINCT FROM 'number'
  ), chase AS (
    -- The chase: the second of one innings a side, the fourth of two; never a super over.
    SELECT cur.v, o.k FROM cur JOIN own o ON o.n = cur.n
     WHERE o.k = CASE WHEN p_ips = 2 THEN 4 ELSE 2 END
  ), num AS (
    SELECT CASE WHEN jsonb_typeof(c.v->'target') = 'number'
                 AND (c.v->>'target')::numeric = trunc((c.v->>'target')::numeric)
                 AND abs((c.v->>'target')::numeric) < 2147483648
                THEN (c.v->>'target')::numeric::integer END AS own_target,
           -- Worked out: one innings a side, the first plus one; two, the
           -- runs it trails by over the three before it, plus one. NULL when
           -- an innings' runs are not a number the fold could add.
           CASE WHEN bool_and(jsonb_typeof(o.v->'runs') = 'number') THEN
             CASE WHEN c.k = 2 THEN sum((o.v->>'runs')::numeric)::integer + 1
                  ELSE sum(CASE WHEN o.v->>'side' IS NOT DISTINCT FROM c.v->>'side' THEN -(o.v->>'runs')::numeric
                                ELSE (o.v->>'runs')::numeric END)::integer + 1 END
           END AS worked
      FROM chase c JOIN own o ON o.k < c.k
     GROUP BY c.v, c.k
  )
  SELECT (SELECT coalesce(num.own_target, num.worked) FROM num),
         coalesce((SELECT bool_or(o.v->'revised' = 'true'::jsonb) FROM own o, cur WHERE o.n <= cur.n), false)
         OR coalesce((SELECT num.own_target <> num.worked FROM num), false)
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION fixture_chase(jsonb, integer) FROM PUBLIC;


-- ── 2 · The read, re-made with the two columns ────────────────────
DROP FUNCTION public_live_fixtures();

/**
 * One row per fixture on the home page today (db/82 §1.2's rule, §1.4's
 * table), live first, then by start, at most 50. db/133's body, with
 * `target` and `revised` last (db/159; header). `scores` is [{innings,
 * runs, wickets, balls, side}]; `result` is public_match_result()'s
 * columns for the fixture, the API words them.
 */
CREATE OR REPLACE FUNCTION public_live_fixtures()
RETURNS TABLE (
  match_id uuid,
  home_label text, home_code text,
  away_label text, away_code text, away_on_platform boolean,
  status text, format text, overs smallint, starts_at timestamptz,
  scores jsonb, result jsonb, served_on text,
  target integer, revised boolean
) AS $$
  WITH listed AS (
    SELECT m.id, m.school_id, m.team_code, m.away_school_id, m.away_team_code, m.opponent,
           m.status, m.format, m.overs, m.starts_at
      FROM match m
     WHERE m.starts_at IS NOT NULL
       AND (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date = sa_today()
       AND m.status IN ('scheduled', 'live', 'complete', 'abandoned', 'postponed')
       AND ((fixture_side_published(m.id, 'home') AND public_school_listed(m.school_id))
            OR (m.away_school_id IS NOT NULL
                AND fixture_side_published(m.id, 'away') AND public_school_listed(m.away_school_id)))
     ORDER BY (m.status = 'live') DESC, m.starts_at, m.id
     LIMIT 50
  )
  SELECT l.id,
         hs.name, l.team_code,
         CASE WHEN l.away_school_id IS NULL THEN l.opponent ELSE aws.name END,
         CASE WHEN l.away_school_id IS NULL THEN NULL ELSE l.away_team_code END,
         l.away_school_id IS NOT NULL,
         l.status, l.format, l.overs, l.starts_at,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                            'innings', s.innings, 'runs', s.runs, 'wickets', s.wickets, 'balls', s.legal_balls,
                            'side', (SELECT x.value->>'side' FROM jsonb_array_elements(r.innings) x
                                      WHERE (x.value->>'innings')::integer = s.innings
                                        AND x.value->>'side' IN ('home', 'away') LIMIT 1))
                            ORDER BY s.innings)
                     FROM match_live_score s
                    WHERE s.match_id = l.id), '[]'::jsonb),
         CASE WHEN r.outcome IS NULL THEN NULL ELSE jsonb_build_object(
           'outcome', r.outcome, 'margin_kind', r.margin_kind, 'margin', r.margin, 'decided_by', r.decided_by,
           'winner_side', r.winner_side, 'play_outcome', r.play_outcome, 'play_winner_side', r.play_winner_side,
           'play_margin_kind', r.play_margin_kind, 'play_margin', r.play_margin,
           'decision_applied', r.decision_applied, 'decision_kind', r.decision->>'kind',
           'decision_side', r.decision->>'side', 'decision_overrides_play', (r.decision->>'overrides_play')::boolean,
           'super_overs', coalesce((SELECT jsonb_agg(jsonb_build_object('n', p.value->'n', 'state', p.value->'state',
                                                                        'first', p.value->'first', 'winner', p.value->'winner')
                                                     ORDER BY (p.value->>'n')::integer)
                                      FROM jsonb_array_elements(r.super_overs) p), '[]'::jsonb)) END,
         to_char(sa_today(), 'YYYY-MM-DD'),
         -- db/159: the chase's target and the revision mark (fixture_chase()).
         ch.target, coalesce(ch.revised, false)
    FROM listed l
    JOIN school hs ON hs.id = l.school_id
    LEFT JOIN school aws ON aws.id = l.away_school_id
    LEFT JOIN LATERAL match_result_compute(l.id) r ON true
    LEFT JOIN LATERAL fixture_chase(r.innings,
      CASE WHEN (SELECT c.doc->'play'->'format.innings_per_side' FROM match_conditions c WHERE c.match_id = l.id) = '2'::jsonb
           THEN 2 ELSE 1 END) ch ON true
   ORDER BY (l.status = 'live') DESC, l.starts_at, l.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · Who may call them: the application, and nobody else ───────
-- db/157's rule: PUBLIC first, then scrbrd_app by name; the managed host's
-- three API roles by name where they exist. The helper is the owner's alone.
DO $grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION public_live_fixtures() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public_live_fixtures() TO scrbrd_app;
  REVOKE ALL ON FUNCTION fixture_chase(jsonb, integer) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['scrbrd_app', 'anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      IF r <> 'scrbrd_app' THEN
        EXECUTE format('REVOKE ALL ON FUNCTION public_live_fixtures() FROM %I', r);
      END IF;
      EXECUTE format('REVOKE ALL ON FUNCTION fixture_chase(jsonb, integer) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 4 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE
  v_md5 text; v_cols text; v_acl text; v_diff int; t integer; v boolean;
BEGIN
  v_md5 := pg_temp._v159_fold((SELECT prosrc FROM pg_proc WHERE oid = 'public_live_fixtures()'::regprocedure));
  IF v_md5 <> 'f4eb927a47c09fa4bac32bf7e4ac7243' THEN
    RAISE EXCEPTION 'db/159: public_live_fixtures() is not this file''s after the paste (md5 %)', v_md5;
  END IF;

  -- Exactly db/133's thirteen columns, then the two, by name and type.
  SELECT string_agg(a.name || ' ' || format_type(a.typ, NULL), ', ' ORDER BY a.ord) INTO v_cols
    FROM pg_proc p,
         unnest(p.proargnames, p.proallargtypes, p.proargmodes::text[]) WITH ORDINALITY AS a(name, typ, mode, ord)
   WHERE p.oid = 'public_live_fixtures()'::regprocedure AND a.mode = 't';
  IF v_cols IS DISTINCT FROM 'match_id uuid, home_label text, home_code text, away_label text, away_code text, '
       || 'away_on_platform boolean, status text, format text, overs smallint, starts_at timestamp with time zone, '
       || 'scores jsonb, result jsonb, served_on text, target integer, revised boolean' THEN
    RAISE EXCEPTION 'db/159: the live read returns %', v_cols;
  END IF;

  -- The old rows, unchanged: every row the old body gave, column by column.
  SELECT count(*) INTO v_diff FROM (
    (SELECT r FROM _v159_before
     EXCEPT ALL
     SELECT jsonb_build_object('match_id', x.match_id, 'home_label', x.home_label, 'home_code', x.home_code,
              'away_label', x.away_label, 'away_code', x.away_code, 'away_on_platform', x.away_on_platform,
              'status', x.status, 'format', x.format, 'overs', x.overs, 'starts_at', x.starts_at,
              'scores', x.scores, 'result', x.result, 'served_on', x.served_on)
       FROM public_live_fixtures() x)
    UNION ALL
    (SELECT jsonb_build_object('match_id', x.match_id, 'home_label', x.home_label, 'home_code', x.home_code,
              'away_label', x.away_label, 'away_code', x.away_code, 'away_on_platform', x.away_on_platform,
              'status', x.status, 'format', x.format, 'overs', x.overs, 'starts_at', x.starts_at,
              'scores', x.scores, 'result', x.result, 'served_on', x.served_on)
       FROM public_live_fixtures() x
     EXCEPT ALL
     SELECT r FROM _v159_before)) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'db/159: % rows of the old thirteen columns differ from what db/133''s body answered', v_diff;
  END IF;

  -- A definer with its path pinned, as before; STABLE.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public_live_fixtures()'::regprocedure AND prosecdef AND provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/159: public_live_fixtures() is not a STABLE definer with a pinned search_path';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'fixture_chase(jsonb,integer)'::regprocedure AND (prosecdef OR provolatile <> 'i')) THEN
    RAISE EXCEPTION 'db/159: fixture_chase() is a definer, or not IMMUTABLE';
  END IF;

  -- The grants, read from the ACLs: the owner and scrbrd_app's EXECUTE on the
  -- read, nothing else; the owner alone on the helper.
  SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY x.grantee <> p.proowner, x.grantee::regrole::text)
    INTO v_acl FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   WHERE p.oid = 'public_live_fixtures()'::regprocedure;
  IF v_acl IS DISTINCT FROM (SELECT proowner::regrole::text FROM pg_proc WHERE oid = 'public_live_fixtures()'::regprocedure)
                            || ':EXECUTE,scrbrd_app:EXECUTE' THEN
    RAISE EXCEPTION 'db/159: public_live_fixtures() is granted %', v_acl;
  END IF;
  SELECT string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',')
    INTO v_acl FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   WHERE p.oid = 'fixture_chase(jsonb,integer)'::regprocedure AND x.grantee <> p.proowner;
  IF v_acl IS NOT NULL THEN
    RAISE EXCEPTION 'db/159: fixture_chase() is granted %', v_acl;
  END IF;
  IF EXISTS (SELECT 1 FROM api_role_reach('public') x WHERE x ~ '(public_live_fixtures|fixture_chase)\(') THEN
    RAISE EXCEPTION 'db/159: PUBLIC reaches the live read or its helper';
  END IF;

  -- No ground, person or reason by name (db/82's own list).
  SELECT string_agg(a.name, ',') INTO v_cols
    FROM pg_proc p, unnest(p.proargnames, p.proargmodes::text[]) AS a(name, mode)
   WHERE p.oid = 'public_live_fixtures()'::regprocedure AND a.mode = 't'
     AND (a.name ~ '(ground|venue|toss|official|umpire|player|born|reason|payload|scorer|device)'
          OR a.name IN ('home_team', 'away_team', 'ground_id'));
  IF v_cols IS NOT NULL THEN
    RAISE EXCEPTION 'db/159: the live read returns %', v_cols;
  END IF;

  -- The rule, case by case, on innings as match_result_compute() writes them.
  SELECT c.target, c.revised INTO t, v FROM fixture_chase('[]'::jsonb, 1) c;
  IF t IS NOT NULL OR v THEN RAISE EXCEPTION 'db/159: no innings answered % %', t, v; END IF;
  SELECT c.target, c.revised INTO t, v FROM fixture_chase(
    '[{"innings":0,"super_over":null,"runs":141,"target":null,"revised":false,"side":"home"}]', 1) c;
  IF t IS NOT NULL OR v THEN RAISE EXCEPTION 'db/159: the first innings answered % %', t, v; END IF;
  SELECT c.target, c.revised INTO t, v FROM fixture_chase(
    '[{"innings":0,"super_over":null,"runs":141,"target":null,"revised":false,"side":"home"},
      {"innings":1,"super_over":null,"runs":97,"target":null,"revised":false,"side":"away"}]', 1) c;
  IF t IS DISTINCT FROM 142 OR v THEN RAISE EXCEPTION 'db/159: the chase of 141 answered % %', t, v; END IF;
  SELECT c.target, c.revised INTO t, v FROM fixture_chase(
    '[{"innings":0,"super_over":null,"runs":141,"target":null,"revised":false,"side":"home"},
      {"innings":1,"super_over":null,"runs":97,"target":130,"revised":true,"side":"away"}]', 1) c;
  IF t IS DISTINCT FROM 130 OR NOT v THEN RAISE EXCEPTION 'db/159: a revised chase answered % %', t, v; END IF;
  SELECT c.target, c.revised INTO t, v FROM fixture_chase(
    '[{"innings":0,"super_over":null,"runs":141,"target":null,"revised":true,"side":"home"},
      {"innings":1,"super_over":null,"runs":97,"target":null,"revised":false,"side":"away"}]', 1) c;
  IF t IS DISTINCT FROM 142 OR NOT v THEN RAISE EXCEPTION 'db/159: overs cut in the first innings answered % %', t, v; END IF;
  SELECT c.target, c.revised INTO t, v FROM fixture_chase(
    '[{"innings":0,"super_over":null,"runs":141,"target":null,"revised":false,"side":"home"},
      {"innings":1,"super_over":null,"runs":141,"target":null,"revised":false,"side":"away"},
      {"innings":2,"super_over":1,"runs":9,"target":null,"revised":false,"side":"home"},
      {"innings":3,"super_over":1,"runs":4,"target":10,"revised":false,"side":"away"}]', 1) c;
  IF t IS NOT NULL OR v THEN RAISE EXCEPTION 'db/159: a super over answered % %', t, v; END IF;
  SELECT c.target, c.revised INTO t, v FROM fixture_chase(
    '[{"innings":0,"super_over":null,"runs":200,"target":null,"revised":false,"side":"home"},
      {"innings":1,"super_over":null,"runs":150,"target":null,"revised":false,"side":"away"}]', 2) c;
  IF t IS NOT NULL OR v THEN RAISE EXCEPTION 'db/159: a two-innings match''s second innings answered % %', t, v; END IF;
  SELECT c.target, c.revised INTO t, v FROM fixture_chase(
    '[{"innings":0,"super_over":null,"runs":200,"target":null,"revised":false,"side":"home"},
      {"innings":1,"super_over":null,"runs":150,"target":null,"revised":false,"side":"away"},
      {"innings":2,"super_over":null,"runs":120,"target":null,"revised":false,"side":"home"},
      {"innings":3,"super_over":null,"runs":10,"target":null,"revised":false,"side":"away"}]', 2) c;
  IF t IS DISTINCT FROM 171 OR v THEN RAISE EXCEPTION 'db/159: a fourth innings answered % %', t, v; END IF;
  SELECT c.target, c.revised INTO t, v FROM fixture_chase(
    '[{"innings":0,"super_over":null,"runs":null,"target":null,"revised":false,"side":"home"},
      {"innings":1,"super_over":null,"runs":3,"target":null,"revised":false,"side":"away"}]', 1) c;
  IF t IS NOT NULL OR v THEN RAISE EXCEPTION 'db/159: a first innings the fold could not add answered % %', t, v; END IF;
END $check$;

DROP TABLE _v159_before;
DROP FUNCTION pg_temp._v159_fold(text);
