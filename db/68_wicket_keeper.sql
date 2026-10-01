-- ══════════════════════════════════════════════════════════════════
--  68 · The wicket-keeper: his dismissals, and a stumping only his (SCRBRD-126)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The event, the fold and the Laws are packages/scoring
-- (events.mjs keeper(), replay.mjs, laws.mjs stumped_not_keeper); this file
-- is what SQL needs of them, and agrees with the fold by construction:
-- tools/smoke-fold-figures.mjs holds every figure here to the fold over its
-- generated logs, and db/99 §46 proves it under the application role.
--
-- THE EVENT. A `keeper` row names the fielding side's wicket-keeper from
-- that point of the innings on (ball_event.kind = 'keeper'), as a `bowler`
-- row names the bowler: state at a point in the log, not typed on every
-- ball. His reference rides in payload.keeper — an id where SCRBRD holds a
-- row, a typed name where it does not; there is no column for it, and none
-- is added. Nothing about any other row changes, and every SQL reader of a
-- delivery already filters `kind = 'ball'`, so a log with no keeper row —
-- every log before this file — reads exactly as it did.
--
-- WHAT IS HERE.
--
--   keeper_at(match, innings, seq)    the keeper when that row was written:
--                                     the last keeper row of the innings
--                                     before it that still counts (voids
--                                     honoured), his reference and his name as
--                                     the squads gave it when he was named
--                                     (the innings_start before that row) —
--                                     replay.mjs's inn.keeper and keeperName.
--   keeper_is_fielder(ref, name, f)   isKeeperRef(): the fielder is the keeper
--                                     by his reference or his name.
--   keeper_dismissal                  one row per wicket that stands credited
--                                     to the keeper at the ball: every
--                                     stumping while one is recorded (Law 39:
--                                     the keeper's alone), and a catch whose
--                                     fielder is him. player_id is his id, or
--                                     NULL for a typed name.
--   player_keeping_career             per boy: matches and innings he kept
--                                     in, catches and stumpings as keeper.
--                                     The fold's inn.keepers, summed.
--   ball_event_stumped_by_keeper      the door: a new stumping credited to a
--                                     fielder who is not the keeper at that
--                                     ball is refused while one is recorded,
--                                     as the Laws refuse it at commit
--                                     (REFUSAL.STUMPED_NOT_KEEPER). What a
--                                     CHECK would raise (23514, named), so the
--                                     write path's per-event refusal names it
--                                     (events-api.mjs CHECK_REASON), as db/43's
--                                     door is named. With no keeper recorded
--                                     — every log before this — nothing is
--                                     refused; nor a stumping with no fielder.
--
-- WHERE CATCHES WERE COUNTED BEFORE: nowhere. db/26 explains why — the
-- table names who bowled and who is out, and the fielder rides in the
-- payload as the wicket sheet wrote him (a name). So "as keeper" is new,
-- in new objects, and no existing view or function changes: every view and
-- function that reads ball_event is snapshotted before and asserted
-- identical after, definition and shape (§0, and the proof in §6).
--
-- NOT HERE. A scorebook innings knows no keeper: a card has no †, so an
-- imported innings adds nothing as keeper (and the fold's inn.keepers is
-- empty for one). Seasons and windows (by_season, _since) wait for a
-- screen that reads them. The public read path (db/59, db/63's
-- public_match_log) lists the kinds a signed-out page may fold, and
-- `keeper` is not among them: what a spectator may know about a boy is
-- SCRBRD-083's to decide, so the public scorecard shows no † yet.
--
-- RLS. Both views are security_invoker over ball_event_live, so a reader
-- sees exactly the rows of ball_event he may read (fixture.read), and
-- player_keeping_career joins `player` under its own policy, as every
-- career view does. The functions run as their caller. The door's function
-- reads the log as the writer, who may read the match he scores.

-- ── 0 · Everything that reads ball_event, before ──────────────────
DROP TABLE IF EXISTS _db68_before;
CREATE TEMP TABLE _db68_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'def', pg_get_viewdef(c.oid), 'options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]),
         'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') AND pg_get_viewdef(c.oid) ~ 'ball_event'
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object('src', p.prosrc, 'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ 'ball_event';

-- ── 1 · The keeper at a row ───────────────────────────────────────
-- replay.mjs, the KEEPER case: a reference is a non-empty string, anything
-- else names nobody; his name is the first squad member (the batting
-- squad, then the fielding squad, each in order) whose id — or, for a bare
-- string member, the string — is his reference, when that member's name is
-- a string; else the reference itself. The squads are the innings_start's
-- before the keeper row. No row, or a row naming nobody: no keeper.
CREATE OR REPLACE FUNCTION keeper_at(p_match uuid, p_innings smallint, p_seq integer)
RETURNS TABLE (keeper_ref text, keeper_name text) AS $$
  SELECT k.ref,
         coalesce((
           SELECT CASE WHEN jsonb_typeof(m.member -> 'name') = 'string' THEN m.member ->> 'name' END
             FROM (SELECT s.payload FROM ball_event_live s
                    WHERE s.match_id = p_match AND s.innings = p_innings AND s.kind = 'innings_start' AND s.seq < k.seq
                    ORDER BY s.seq DESC LIMIT 1) st
             CROSS JOIN LATERAL (
               SELECT e.member, 1 AS part, e.ord
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(st.payload -> 'squad') = 'array'
                                                THEN st.payload -> 'squad' ELSE '[]'::jsonb END) WITH ORDINALITY AS e(member, ord)
               UNION ALL
               SELECT e.member, 2, e.ord
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(st.payload -> 'bowlingSquad') = 'array'
                                                THEN st.payload -> 'bowlingSquad' ELSE '[]'::jsonb END) WITH ORDINALITY AS e(member, ord)
             ) m
            WHERE CASE jsonb_typeof(m.member)
                    WHEN 'object' THEN CASE WHEN jsonb_typeof(m.member -> 'id') = 'string' THEN m.member ->> 'id' END
                    WHEN 'string' THEN m.member #>> '{}'
                  END = k.ref
            ORDER BY m.part, m.ord
            LIMIT 1), k.ref)
    FROM (SELECT CASE WHEN jsonb_typeof(b.payload -> 'keeper') = 'string' AND b.payload ->> 'keeper' <> ''
                      THEN b.payload ->> 'keeper' END AS ref,
                 b.seq
            FROM ball_event_live b
           WHERE b.match_id = p_match AND b.innings = p_innings AND b.kind = 'keeper' AND b.seq < p_seq
           ORDER BY b.seq DESC
           LIMIT 1) k
   WHERE k.ref IS NOT NULL
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- isKeeperRef(): a fielder named, as a non-empty string, who is the keeper
-- by his reference or his name. False — never NULL — for anything else.
CREATE OR REPLACE FUNCTION keeper_is_fielder(p_ref text, p_name text, p_fielder jsonb)
RETURNS boolean AS $$
  SELECT coalesce(p_ref IS NOT NULL
                  AND jsonb_typeof(p_fielder) = 'string'
                  AND p_fielder #>> '{}' <> ''
                  AND (p_fielder #>> '{}' = p_ref OR p_fielder #>> '{}' = p_name), false)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- ── 2 · The keeper's dismissals ───────────────────────────────────
-- The fold's BALL case: a wicket that stands (ball_wicket_stands(): a free
-- hit saves a catch and a stumping alike), with a keeper at the ball; a
-- stumping is his whatever the event names (the door and the Laws refuse a
-- new one naming anyone else), a catch only when its fielder is him.
CREATE OR REPLACE VIEW keeper_dismissal WITH (security_invoker = true) AS
SELECT b.match_id, b.school_id, b.innings, b.seq, b.server_ts,
       k.keeper_ref,
       CASE WHEN k.keeper_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN k.keeper_ref::uuid END AS player_id,
       b.dismissal
  FROM ball_event_live b
  CROSS JOIN LATERAL keeper_at(b.match_id, b.innings, b.seq) k
 WHERE b.kind = 'ball' AND b.ball_type = 'W' AND b.dismissal IN ('caught', 'stumped')
   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
   AND (b.dismissal = 'stumped' OR keeper_is_fielder(k.keeper_ref, k.keeper_name, b.payload -> 'fielder'));

-- ── 3 · A boy's keeping ───────────────────────────────────────────
-- Innings kept: every innings a keeper row named him in (inn.keepers has a
-- line for him); matches: the fixtures those are in. Catches and stumpings:
-- his rows above. Our boys only — a typed name is nobody's career.
CREATE OR REPLACE VIEW player_keeping_career WITH (security_invoker = true) AS
SELECT x.player_id,
       count(DISTINCT x.match_id) FILTER (WHERE x.kept)                     AS matches,
       count(DISTINCT (x.match_id, x.innings)) FILTER (WHERE x.kept)        AS innings_kept,
       count(*) FILTER (WHERE x.dismissal = 'caught')                       AS catches,
       count(*) FILTER (WHERE x.dismissal = 'stumped')                      AS stumpings
  FROM (
    SELECT CASE WHEN b.payload ->> 'keeper' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 AND jsonb_typeof(b.payload -> 'keeper') = 'string'
                THEN (b.payload ->> 'keeper')::uuid END AS player_id,
           b.match_id, b.innings, true AS kept, NULL::text AS dismissal
      FROM ball_event_live b
     WHERE b.kind = 'keeper'
    UNION ALL
    SELECT d.player_id, d.match_id, d.innings, false, d.dismissal
      FROM keeper_dismissal d
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

-- ── 4 · The door ──────────────────────────────────────────────────
-- A new stumping credited to someone who is not the keeper at that ball,
-- while one is recorded: refused, as a CHECK would refuse it. Named to
-- fire after ball_event_names_its_delivery (a wicket with no method is
-- refused for that first) and before zz_ball_event_fingerprint; it changes
-- nothing in NEW.
CREATE OR REPLACE FUNCTION ball_event_stumped_by_keeper() RETURNS trigger AS $$
DECLARE k record;
BEGIN
  IF NEW.kind = 'ball' AND NEW.ball_type = 'W' AND NEW.dismissal = 'stumped'
     AND jsonb_typeof(NEW.payload -> 'fielder') = 'string' AND NEW.payload ->> 'fielder' <> '' THEN
    SELECT * INTO k FROM keeper_at(NEW.match_id, NEW.innings, NEW.seq);
    IF k.keeper_ref IS NOT NULL AND NOT keeper_is_fielder(k.keeper_ref, k.keeper_name, NEW.payload -> 'fielder') THEN
      RAISE EXCEPTION 'ball_event: a stumping credited to someone who was not keeping wicket (match %, key %) — a stumping is the wicket-keeper''s',
        NEW.match_id, NEW.idempotency_key
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event',
              CONSTRAINT = 'ball_event_stumped_by_keeper';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ball_event_stumped_by_keeper ON ball_event;
CREATE TRIGGER ball_event_stumped_by_keeper
  BEFORE INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_stumped_by_keeper();

-- ── 5 · Grants ────────────────────────────────────────────────────
-- The application role reads the two views, as it reads the careers; a
-- managed host's API roles read neither (Supabase grants a new view to
-- them). The functions keep PostgreSQL's default EXECUTE, as the rules the
-- career views call (ball_wicket_stands(), ball_runs_off_bat()) do: they
-- run as their caller and answer only over rows he may read.
GRANT SELECT ON keeper_dismissal, player_keeping_career TO scrbrd_app;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON keeper_dismissal, player_keeping_career FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- ── 6 · The proof ─────────────────────────────────────────────────
-- Built and rolled back. db/99 §46 is the fuller proof, under the
-- application role, on every verify paste; tools/smoke-fold-figures.mjs
-- holds these figures to the fold. This is what must hold the moment the
-- file has run.
DO $check$
DECLARE
  r         record;
  now_shape jsonb;
  n         int;
  got       text;
  v_school  uuid := gen_random_uuid();
  v_user    uuid := gen_random_uuid();
  v_m       uuid := gen_random_uuid();   -- keepers named
  v_plain   uuid := gen_random_uuid();   -- the same deliveries, no keeper row
  k1        uuid := gen_random_uuid();   -- keeps first: a catch by his name
  k2        uuid := gen_random_uuid();   -- takes the gloves mid-over: a stumping, a catch by reference
  f1        uuid := gen_random_uuid();   -- a fielder, never keeping
  v_squad   jsonb;
BEGIN
  -- 1. Nothing that reads ball_event changed, definition or shape.
  SELECT count(*) INTO n FROM _db68_before;
  IF n < 20 THEN RAISE EXCEPTION 'db/68: the snapshot holds % objects that read ball_event; expected the careers and more', n; END IF;
  FOR r IN SELECT * FROM _db68_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object('def', pg_get_viewdef(c.oid), 'options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]),
               'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape FROM pg_class c WHERE c.oid = to_regclass(substr(r.obj, 6));
    ELSE
      SELECT jsonb_build_object('src', p.prosrc, 'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef, 'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]))
        INTO now_shape FROM pg_proc p WHERE p.oid = to_regprocedure(substr(r.obj, 10));
    END IF;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/68: % changed: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname IN ('keeper_dismissal', 'player_keeping_career')
                AND NOT coalesce('security_invoker=true' = ANY (reloptions), false)) THEN
    RAISE EXCEPTION 'db/68: a new view runs as its owner';
  END IF;
  IF (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
       WHERE t.tgrelid = 'ball_event'::regclass AND NOT t.tgisinternal AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4)
     IS DISTINCT FROM ARRAY['ball_event_is_cricket', 'ball_event_names_its_delivery', 'ball_event_scorebook_door',
                            'ball_event_stumped_by_keeper', 'zz_ball_event_fingerprint'] THEN
    RAISE EXCEPTION 'db/68: the BEFORE INSERT triggers on ball_event are %',
      (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
        WHERE t.tgrelid = 'ball_event'::regclass AND NOT t.tgisinternal AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4);
  END IF;

  -- 2. A log with keepers, and the same deliveries without.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db68-' || v_school, 'db/68 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db68-' || v_user || '@example.invalid', 'db/68 proof', 'scorer', v_school);
    INSERT INTO player (id, school_id, full_name, team_code, born) VALUES
      (k1, v_school, 'db/68 Keeper', '1XI', '2009-03-01'), (k2, v_school, 'db/68 Second', '1XI', '2009-03-01'),
      (f1, v_school, 'db/68 Fielder', '1XI', '2009-03-01');
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (v_m,     v_school, '1XI', 'db/68 Keepers', now() - interval '2 days', 'cricket', 'T20', 20, 'complete'),
      (v_plain, v_school, '1XI', 'db/68 Plain',   now() - interval '2 days', 'cricket', 'T20', 20, 'complete');
    v_squad := jsonb_build_array(jsonb_build_object('id', k1, 'name', 'K One'), jsonb_build_object('id', k2, 'name', 'K Two'),
                                 jsonb_build_object('id', f1, 'name', 'F One'));
    -- One row per statement, as the write path writes them. Seq:
    --   1 start · 2 keeper k1 · 3 caught "K One" (k1's, by his name) · 4 a
    --   no-ball · 5 stumped (saved: the free hit) · 6 keeper k2, mid-over ·
    --   7 stumped, no fielder named (k2's) · 8 caught by k2's reference (k2's)
    --   · 9 caught "K One" (not as keeper: k1 keeps no longer) · 10 run out,
    --   "K Two" (not a keeper's dismissal) · 11 keeper f1 · 12 the void of 11
    --   · 13 stumped "K Two" (k2 keeps still: f1's row was undone).
    -- v_plain has the same deliveries and no keeper row or void.
    FOR r IN
      SELECT m, x.*
        FROM unnest(ARRAY[v_m, v_plain]) AS m
       CROSS JOIN (VALUES
         (1,  'innings_start', NULL, NULL::int, NULL, jsonb_build_object('battingTeam', 'Opp', 'bowlingTeam', 'db/68', 'squad', '[]'::jsonb, 'bowlingSquad', v_squad)),
         (2,  'keeper', NULL, NULL, NULL, jsonb_build_object('keeper', k1)),
         (3,  'ball', 'W', 0, 'caught',  '{"fielder":"K One"}'::jsonb),
         (4,  'ball', 'Nb', 0, NULL,     '{}'::jsonb),
         (5,  'ball', 'W', 0, 'stumped', '{}'::jsonb),
         (6,  'keeper', NULL, NULL, NULL, jsonb_build_object('keeper', k2)),
         (7,  'ball', 'W', 0, 'stumped', '{}'::jsonb),
         (8,  'ball', 'W', 0, 'caught',  jsonb_build_object('fielder', k2)),
         (9,  'ball', 'W', 0, 'caught',  '{"fielder":"K One"}'::jsonb),
         (10, 'ball', 'W', 0, 'run_out', '{"fielder":"K Two"}'::jsonb),
         (11, 'keeper', NULL, NULL, NULL, jsonb_build_object('keeper', f1)),
         (12, 'void', NULL, NULL, NULL, '{}'::jsonb),
         (13, 'ball', 'W', 0, 'stumped', '{"fielder":"K Two"}'::jsonb)
       ) AS x(seq, kind, bt, v, dis, payload)
       WHERE m = v_m OR x.kind NOT IN ('keeper', 'void')
       ORDER BY m, x.seq
    LOOP
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, dismissal, payload)
      VALUES (r.m, v_school, r.seq, 1, 0, v_user, 'db68-pad', 'db68:' || r.m || ':' || r.seq, r.seq, now(), r.kind, r.bt, r.v, r.dis,
              CASE WHEN r.kind = 'void' THEN jsonb_build_object('target', 'db68:' || r.m || ':11') ELSE r.payload END);
    END LOOP;

    -- The keeper's dismissals: the fold's, ball by ball.
    SELECT string_agg(d.seq || ':' || CASE d.player_id WHEN k1 THEN 'k1' WHEN k2 THEN 'k2' WHEN f1 THEN 'f1' ELSE '?' END
                      || ':' || d.dismissal, ' ' ORDER BY d.seq)
      INTO got FROM keeper_dismissal d WHERE d.match_id = v_m;
    IF got IS DISTINCT FROM '3:k1:caught 7:k2:stumped 8:k2:caught 13:k2:stumped' THEN
      RAISE EXCEPTION 'db/68: keeper_dismissal reads %', got;
    END IF;
    IF EXISTS (SELECT 1 FROM keeper_dismissal WHERE match_id = v_plain) THEN
      RAISE EXCEPTION 'db/68: a log with no keeper row has keeper dismissals';
    END IF;
    -- The careers: k1 kept one innings, one catch; k2 one innings, a catch
    -- and two stumpings; f1's keeping was undone, so he has no line.
    SELECT string_agg(CASE c.player_id WHEN k1 THEN 'k1' WHEN k2 THEN 'k2' ELSE 'f1' END || '=' ||
                      row(c.matches, c.innings_kept, c.catches, c.stumpings)::text, ' ' ORDER BY c.player_id = k2, c.player_id = f1)
      INTO got FROM player_keeping_career c WHERE c.player_id IN (k1, k2, f1);
    IF got IS DISTINCT FROM 'k1=(1,1,1,0) k2=(1,1,1,2)' THEN
      RAISE EXCEPTION 'db/68: player_keeping_career reads %', got;
    END IF;
    -- Every other figure of the log with keepers is the plain log's.
    IF (SELECT row(l.runs, l.wickets, l.legal_balls)::text FROM match_live_score l WHERE l.match_id = v_m)
       IS DISTINCT FROM (SELECT row(l.runs, l.wickets, l.legal_balls)::text FROM match_live_score l WHERE l.match_id = v_plain)
       OR (SELECT row(f.runs, f.wickets, f.legal_balls)::text FROM innings_score_as_folded(v_m, 0::smallint) f)
          IS DISTINCT FROM (SELECT row(f.runs, f.wickets, f.legal_balls)::text FROM innings_score_as_folded(v_plain, 0::smallint) f) THEN
      RAISE EXCEPTION 'db/68: a keeper row moved a figure: % against %',
        (SELECT row(l.runs, l.wickets, l.legal_balls)::text FROM match_live_score l WHERE l.match_id = v_m),
        (SELECT row(l.runs, l.wickets, l.legal_balls)::text FROM match_live_score l WHERE l.match_id = v_plain);
    END IF;

    -- The door: a stumping credited to the fielder while k2 keeps is refused,
    -- named; by k2's name or reference, or nobody named, it is taken; in the
    -- plain log (no keeper) the fielder's is taken, as before.
    BEGIN
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, dismissal, payload)
      VALUES (v_m, v_school, 20, 1, 0, v_user, 'db68-pad', 'db68:door', 20, now(), 'ball', 'W', 0, 'stumped', '{"fielder":"F One"}');
      RAISE EXCEPTION 'db/68: the door took a stumping by a fielder who was not keeping';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS got = CONSTRAINT_NAME;
      IF got IS DISTINCT FROM 'ball_event_stumped_by_keeper' THEN RAISE EXCEPTION 'db/68: the door is named %', got; END IF;
    END;
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, ball_type, value, dismissal, payload)
    VALUES (v_m, v_school, 21, 1, 0, v_user, 'db68-pad', 'db68:door:name', 21, now(), 'ball', 'W', 0, 'stumped', '{"fielder":"K Two"}'),
           (v_plain, v_school, 21, 1, 0, v_user, 'db68-pad', 'db68:door:plain', 21, now(), 'ball', 'W', 0, 'stumped', '{"fielder":"F One"}');
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, ball_type, value, dismissal, payload)
    VALUES (v_m, v_school, 22, 1, 0, v_user, 'db68-pad', 'db68:door:ref', 22, now(), 'ball', 'W', 0, 'stumped', jsonb_build_object('fielder', k2));
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, ball_type, value, dismissal, payload)
    VALUES (v_m, v_school, 23, 1, 0, v_user, 'db68-pad', 'db68:door:none', 23, now(), 'ball', 'W', 0, 'stumped', '{}');
    IF (SELECT count(*) FROM keeper_dismissal WHERE match_id = v_m AND seq >= 20) <> 3 THEN
      RAISE EXCEPTION 'db/68: the stumpings the door took are not k2''s';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ068', MESSAGE = 'db/68: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ068' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/68: the proof left something behind'; END IF;
END $check$;

DROP TABLE _db68_before;
