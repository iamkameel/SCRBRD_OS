-- ══════════════════════════════════════════════════════════════════
--  150 · Who fielded the wicket, and what a fielder and a keeper did
--        in a season (RECOGNITION R12)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Slice R12 of docs/design/RECOGNITION_reconciliation.md (§5,
-- "Scorer completeness (V2)"), approved by Kameel on 11 Nov 2026 ("Yes,
-- after the pad fixes"): P2's structured fielders with a run-out
-- contribution rule, then fielding and keeping recognition, and D17's
-- "based on batting and bowling only" dropped where fielding is scored
-- (RECOGNITION_design.md §10, row R12). P8, the boundary, needed nothing
-- here: db/121's ball_boundary() already reads payload.boundary = false,
-- and a no-ball's four all run now carries it from the pad.
-- Its proof: db/99 §128; tools/smoke-fold-figures.mjs (this SQL
-- equal to the fold's fieldingCredits() and facts over a real write path);
-- smoke-recognition (Player of the Match on the new basis).
--
-- ── WHAT AN EVENT NOW CARRIES ───────────────────────────────────────
-- payload.fielders: the fielders the scorer named, in order — a player id
-- where SCRBRD holds a row, the name as typed where it does not (a
-- substitute, the other side's boy). One for a catch (the catcher; the
-- bowler for caught and bowled), one for a stumping (the keeper), one or
-- two for a run out. payload.fielder stays the scorecard's text, as before.
-- Rides in the payload (events-api.mjs: "capturing a new dimension needs no
-- migration"); no column, so no row already stored moves and no fingerprint
-- (db/36) changes. THE CONTRIBUTION RULE (events.mjs FIELDED_DISMISSALS):
-- each fielder named in a run out is credited one run out; the wicket is
-- one wicket for the side. A wicket that names nobody credits nobody: the
-- spec's "missing fielding attribution stays unknown, not zero".
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   functions  + ball_fielders_fit(jsonb, text)  events.mjs fieldersFit():
--                the list this way out may carry. IMMUTABLE, nobody's data.
--              + ball_event_wicket_fielders()  the door's body
--   trigger    + ball_event_wicket_fielders  BEFORE INSERT on ball_event: a
--                row whose payload names fielders that do not fit its way
--                out, or on a delivery that is no wicket, is refused
--                (check_violation, CONSTRAINT ball_event_wicket_fielders →
--                "fielders_invalid", events-api.mjs CHECK_REASON); a
--                stumping's first fielder is the keeper while one is on
--                the record (as db/68's door asks of its `fielder`). Named
--                to fire after ball_event_stumped_by_keeper and before
--                zz_ball_event_fingerprint. Whether a fielder is a batter
--                at the crease is the Laws' at commit (lawsRefusal,
--                fielders_invalid); a stored row is never re-judged.
--   views      + fielding_credit (security_invoker)  fieldingCredits(): one
--                row per fielder a standing catch, stumping or run out
--                names, over ball_event_career (no super over, no void),
--                with as_keeper when he was the keeper at that ball.
--              + player_fielding_act, player_fielding_career,
--                player_fielding_by_season (security_invoker)  a boy's
--                catches and run outs (from fielding_credit) and his
--                keeping — catches as keeper, stumpings, innings kept — from
--                db/68's keeper_dismissal and keeper rows: one row per act,
--                then his career, then a row per school season as the career
--                read's other by-season views (school_season_of(), db/44).
--                Our boys only. The career reads' fielding columns.
--              Both read through ball_event's own policies: a reader sees
--              the credits of the matches he may read, as the careers do.
--   POTM       ~ match_award() (db/142) and captain_nominate() (db/144)
--                take the basis the application read the suggestions on —
--                'batting_bowling' (no fielding), or, new,
--                'batting_bowling_fielding' when every catch, stumping and
--                run out of the match names its fielders — and store it, in
--                place of the fixed 'batting_bowling'. Patched in place by
--                needle, as db/144 patched audit_log(): each needle must
--                stand in the body exactly once, or the file stops.
--
-- EXISTING ROWS. None change: no stored event carries `fielders`, so
-- fielding_credit is empty on the paste and every figure, career and award
-- reads as before. Safe to run twice: CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS before it is made again, and a patch that finds its replacement
-- already there does nothing.
--
-- SCHEMA FIRST. The API built with it (events-api.mjs's refusal words,
-- the career read's fielding columns, potm-api.mjs's basis) runs against
-- this file; it is in services/api/expected-migrations.json.


-- ── 0 · What this file was written against ─────────────────────────
DO $guard$
BEGIN
  IF to_regclass('ball_event') IS NULL OR to_regclass('ball_event_career') IS NULL OR to_regclass('keeper_dismissal') IS NULL
     OR to_regclass('match') IS NULL OR to_regclass('player') IS NULL
     OR to_regprocedure('keeper_at(uuid,smallint,integer)') IS NULL
     OR to_regprocedure('keeper_is_fielder(text,text,jsonb)') IS NULL
     OR to_regprocedure('ball_is_wicket(text,text)') IS NULL
     OR to_regprocedure('ball_wicket_stands(uuid,smallint,integer,text,text,text)') IS NULL
     OR to_regprocedure('school_season_of(timestamptz)') IS NULL
     OR to_regprocedure('match_award(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('captain_nominate(uuid,uuid,jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass AND tgname = 'ball_event_stumped_by_keeper')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass AND tgname = 'zz_ball_event_fingerprint') THEN
    RAISE EXCEPTION 'db/150: the keeper (db/68), wickets on extras (db/87), Player of the Match (db/142) or the captain''s nomination (db/144) is missing; apply them first';
  END IF;
END $guard$;

-- db/144's patcher: `needle` must stand in the body exactly `times` times.
CREATE OR REPLACE FUNCTION pg_temp._v150_patch(p_fn text, p_needle text, p_repl text, p_times integer) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> p_times THEN
    RAISE EXCEPTION 'db/150: % holds its needle % times, not %: look before replacing it', p_fn, v_n, p_times;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════════
--  1 · The fielders a way out may name (events.mjs fieldersFit)
-- ══════════════════════════════════════════════════════════════════
-- One or two (a run out), one (a catch, a stumping), none for any other way
-- out; each a non-empty string with no space at either end and at most 80
-- characters (FIELDER_REF_MAX), each named once. False — never NULL — for
-- anything else, a missing list included.
CREATE OR REPLACE FUNCTION ball_fielders_fit(p_fielders jsonb, p_dismissal text) RETURNS boolean AS $$
  SELECT coalesce(
           jsonb_typeof(p_fielders) = 'array'
       AND jsonb_array_length(p_fielders) >= 1
       AND jsonb_array_length(p_fielders) <= CASE p_dismissal WHEN 'caught' THEN 1 WHEN 'stumped' THEN 1 WHEN 'run_out' THEN 2 ELSE 0 END
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fielders) e
                        WHERE jsonb_typeof(e) <> 'string' OR e #>> '{}' = '' OR e #>> '{}' ~ '^\s|\s$'
                           OR length(e #>> '{}') > 80)
       AND (SELECT count(DISTINCT e) FROM jsonb_array_elements_text(p_fielders) e) = jsonb_array_length(p_fielders),
         false)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
COMMENT ON FUNCTION ball_fielders_fit(jsonb, text) IS
  'db/150 (RECOGNITION R12, P2): events.mjs fieldersFit(). The fielders a way out may name: one for a catch or a stumping, one or two for a run out, each once.';


-- ══════════════════════════════════════════════════════════════════
--  2 · The door
-- ══════════════════════════════════════════════════════════════════
-- A JSON null is no list, as the constructor and the Laws read it: the
-- wicket names nobody.
CREATE OR REPLACE FUNCTION ball_event_wicket_fielders() RETURNS trigger AS $$
DECLARE k record;
BEGIN
  IF jsonb_typeof(NEW.payload -> 'fielders') IS NULL OR jsonb_typeof(NEW.payload -> 'fielders') = 'null' THEN
    RETURN NEW;
  END IF;
  IF NEW.kind IS DISTINCT FROM 'ball' OR NOT coalesce(ball_is_wicket(NEW.ball_type, NEW.dismissal), false)
     OR NOT ball_fielders_fit(NEW.payload -> 'fielders', NEW.dismissal) THEN
    RAISE EXCEPTION 'ball_event: the fielders named do not fit the way out (match %, key %) — one for a catch or a stumping, one or two for a run out, each once',
      NEW.match_id, NEW.idempotency_key
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event', CONSTRAINT = 'ball_event_wicket_fielders';
  END IF;
  IF NEW.dismissal = 'stumped' THEN
    SELECT * INTO k FROM keeper_at(NEW.match_id, NEW.innings, NEW.seq);
    IF k.keeper_ref IS NOT NULL AND NOT keeper_is_fielder(k.keeper_ref, k.keeper_name, NEW.payload -> 'fielders' -> 0) THEN
      RAISE EXCEPTION 'ball_event: a stumping credited to someone who was not keeping wicket (match %, key %) — a stumping is the wicket-keeper''s',
        NEW.match_id, NEW.idempotency_key
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event', CONSTRAINT = 'ball_event_stumped_by_keeper';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION ball_event_wicket_fielders() FROM PUBLIC;

DROP TRIGGER IF EXISTS ball_event_wicket_fielders ON ball_event;
CREATE TRIGGER ball_event_wicket_fielders
  BEFORE INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_wicket_fielders();


-- ══════════════════════════════════════════════════════════════════
--  3 · The credit (replay.mjs fieldingCredits)
-- ══════════════════════════════════════════════════════════════════
-- One row per fielder a standing catch, stumping or run out names (a free
-- hit saves a catch and a stumping: ball_wicket_stands()), over the career
-- log (no super over, no void). act is 'catch', 'stumping' or 'run_out';
-- player_id the fielder when his reference is a player id (a typed name is
-- nobody's figure); as_keeper when he was the keeper on the record at that
-- ball (keeper_at(), the fold's keeperId).
CREATE OR REPLACE VIEW fielding_credit WITH (security_invoker = true) AS
SELECT b.match_id, b.school_id, b.innings, b.seq, b.server_ts,
       f.ref                                                           AS fielder_ref,
       f.ord::smallint                                                 AS fielder_no,
       CASE WHEN f.ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN f.ref::uuid END                                       AS player_id,
       CASE b.dismissal WHEN 'caught' THEN 'catch' WHEN 'stumped' THEN 'stumping' ELSE 'run_out' END AS act,
       coalesce(k.keeper_ref = f.ref, false)                           AS as_keeper
  FROM ball_event_career b
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(b.payload -> 'fielders') = 'array'
                                                    THEN b.payload -> 'fielders' ELSE '[]'::jsonb END) WITH ORDINALITY AS f(ref, ord)
  LEFT JOIN LATERAL keeper_at(b.match_id, b.innings, b.seq) k ON true
 WHERE b.kind = 'ball' AND ball_is_wicket(b.ball_type, b.dismissal) AND b.dismissal IN ('caught', 'stumped', 'run_out')
   AND ball_fielders_fit(b.payload -> 'fielders', b.dismissal)
   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal);
COMMENT ON VIEW fielding_credit IS
  'db/150 (RECOGNITION R12, P2): replay.mjs fieldingCredits(). One row per fielder a standing catch, stumping or run out names; each fielder of a run out one run out. A wicket that names nobody has no row.';


-- ══════════════════════════════════════════════════════════════════
--  4 · A boy's fielding and keeping, for his career and a season at a time
-- ══════════════════════════════════════════════════════════════════
-- player_fielding_act: one row per act. 'credit' rows are his
-- fielding_credit (act catch, stumping or run_out); 'keeping' rows are
-- db/68's keeping record, keeper_dismissal (act caught or stumped: a
-- stumping is the keeper's whoever the row names, a catch his by reference
-- or by name); 'kept' rows are the innings a keeper row named him in. So a
-- season scored before the pad named fielders keeps its keeping, and a
-- catch he took keeping is one of his catches and one of his keeping
-- catches. Our boys only: a typed name is nobody's figure.
CREATE OR REPLACE VIEW player_fielding_act WITH (security_invoker = true) AS
SELECT x.player_id, x.match_id, x.innings, x.act, x.src
  FROM (
    SELECT c.player_id, c.match_id, c.innings, c.act, 'credit'::text AS src
      FROM fielding_credit c WHERE c.player_id IS NOT NULL
    UNION ALL
    SELECT d.player_id, d.match_id, d.innings, d.dismissal, 'keeping'
      FROM keeper_dismissal d WHERE d.player_id IS NOT NULL
    UNION ALL
    SELECT (b.payload ->> 'keeper')::uuid, b.match_id, b.innings, NULL, 'kept'
      FROM ball_event_career b
     WHERE b.kind = 'keeper' AND jsonb_typeof(b.payload -> 'keeper') = 'string'
       AND b.payload ->> 'keeper' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) x
  JOIN player p ON p.id = x.player_id;
COMMENT ON VIEW player_fielding_act IS
  'db/150 (RECOGNITION R12): a boy''s fielding credits (fielding_credit) and keeping (db/68''s record), one row per act; what player_fielding_career and player_fielding_by_season count.';

-- The career read's grain: his whole record.
CREATE OR REPLACE VIEW player_fielding_career WITH (security_invoker = true) AS
SELECT a.player_id,
       count(*) FILTER (WHERE a.src = 'credit' AND a.act = 'catch')            AS catches,
       count(*) FILTER (WHERE a.src = 'credit' AND a.act = 'run_out')          AS run_outs,
       count(*) FILTER (WHERE a.src = 'keeping' AND a.act = 'caught')          AS keeping_catches,
       count(*) FILTER (WHERE a.src = 'keeping' AND a.act = 'stumped')         AS stumpings,
       count(DISTINCT (a.match_id, a.innings)) FILTER (WHERE a.src = 'kept')   AS innings_kept
  FROM player_fielding_act a
 GROUP BY a.player_id;
COMMENT ON VIEW player_fielding_career IS
  'db/150 (RECOGNITION R12): a boy''s catches, run outs and keeping over every match the reader may see. The career read''s fielding columns.';

-- The by-season read's grain: the season is the MATCH's (school_season_of(),
-- db/44), as every by-season career view's.
CREATE OR REPLACE VIEW player_fielding_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT a.player_id,
       ms.season,
       count(*) FILTER (WHERE a.src = 'credit' AND a.act = 'catch')            AS catches,
       count(*) FILTER (WHERE a.src = 'credit' AND a.act = 'run_out')          AS run_outs,
       count(*) FILTER (WHERE a.src = 'keeping' AND a.act = 'caught')          AS keeping_catches,
       count(*) FILTER (WHERE a.src = 'keeping' AND a.act = 'stumped')         AS stumpings,
       count(DISTINCT (a.match_id, a.innings)) FILTER (WHERE a.src = 'kept')   AS innings_kept
  FROM player_fielding_act a
  JOIN match_season ms ON ms.match_id = a.match_id
 GROUP BY a.player_id, ms.season;
COMMENT ON VIEW player_fielding_by_season IS
  'db/150 (RECOGNITION R12): player_fielding_career per school season. Evidence for Fielder and Wicketkeeper of the Season, read under the career read''s scope.';

-- Read, never written: the schema's default privileges hand the application
-- INSERT and UPDATE on every new relation, and these are views of the log.
REVOKE INSERT, UPDATE, DELETE ON fielding_credit, player_fielding_act, player_fielding_career, player_fielding_by_season FROM scrbrd_app;
GRANT SELECT ON fielding_credit, player_fielding_act, player_fielding_career, player_fielding_by_season TO scrbrd_app;
-- A managed host's API roles read neither (Supabase grants a new view to them).
DO $hosted$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON fielding_credit, player_fielding_act, player_fielding_career, player_fielding_by_season FROM %I', r);
    END IF;
  END LOOP;
END $hosted$;


-- ══════════════════════════════════════════════════════════════════
--  5 · Player of the Match: the basis the suggestions were read on (D17)
-- ══════════════════════════════════════════════════════════════════
DO $patch$
BEGIN
  PERFORM pg_temp._v150_patch('match_award(uuid,uuid,jsonb)',
  $n$OR p_derived->>'basis' IS DISTINCT FROM 'batting_bowling'$n$,
  $r$OR coalesce(p_derived->>'basis', '') NOT IN ('batting_bowling', 'batting_bowling_fielding')$r$, 1);
  PERFORM pg_temp._v150_patch('match_award(uuid,uuid,jsonb)',
  $n$jsonb_build_object('version', 1, 'basis', 'batting_bowling',$n$,
  $r$jsonb_build_object('version', 1, 'basis', p_derived->>'basis',$r$, 1);
  PERFORM pg_temp._v150_patch('captain_nominate(uuid,uuid,jsonb)',
  $n$OR p_derived->>'basis' IS DISTINCT FROM 'batting_bowling'$n$,
  $r$OR coalesce(p_derived->>'basis', '') NOT IN ('batting_bowling', 'batting_bowling_fielding')$r$, 1);
  PERFORM pg_temp._v150_patch('captain_nominate(uuid,uuid,jsonb)',
  $n$jsonb_build_object('version', 1, 'basis', 'batting_bowling', 'factsVersion'$n$,
  $r$jsonb_build_object('version', 1, 'basis', p_derived->>'basis', 'factsVersion'$r$, 1);
END $patch$;


-- ══════════════════════════════════════════════════════════════════
--  6 · What this file holds itself to
-- ══════════════════════════════════════════════════════════════════
DO $proof$
DECLARE got text[];
BEGIN
  -- The rule's truth table.
  IF NOT (ball_fielders_fit('["a"]', 'caught') AND ball_fielders_fit('["a"]', 'stumped')
          AND ball_fielders_fit('["a","b"]', 'run_out') AND ball_fielders_fit('["a"]', 'run_out'))
     OR ball_fielders_fit('["a","b"]', 'caught') OR ball_fielders_fit('["a","b","c"]', 'run_out')
     OR ball_fielders_fit('["a","a"]', 'run_out') OR ball_fielders_fit('[]', 'caught') OR ball_fielders_fit('[""]', 'caught')
     OR ball_fielders_fit('[" a"]', 'caught') OR ball_fielders_fit('[7]', 'caught') OR ball_fielders_fit('"a"', 'caught')
     OR ball_fielders_fit('["a"]', 'bowled') OR ball_fielders_fit(NULL, 'caught')
     OR ball_fielders_fit(to_jsonb(ARRAY[repeat('x', 81)]), 'caught') OR NOT ball_fielders_fit(to_jsonb(ARRAY[repeat('x', 80)]), 'caught') THEN
    RAISE EXCEPTION 'db/150: ball_fielders_fit() is not fieldersFit()';
  END IF;
  -- The door fires after db/68's and before the fingerprint.
  SELECT array_agg(t.tgname::text ORDER BY t.tgname) INTO got FROM pg_trigger t
   WHERE t.tgrelid = 'ball_event'::regclass AND NOT t.tgisinternal AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4;
  IF array_position(got, 'ball_event_wicket_fielders') IS NULL
     OR array_position(got, 'ball_event_wicket_fielders') < array_position(got, 'ball_event_stumped_by_keeper')
     OR array_position(got, 'ball_event_wicket_fielders') > array_position(got, 'zz_ball_event_fingerprint') THEN
    RAISE EXCEPTION 'db/150: the BEFORE INSERT triggers on ball_event are %', got;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname IN ('fielding_credit', 'player_fielding_act', 'player_fielding_career', 'player_fielding_by_season')
                AND NOT coalesce('security_invoker=true' = ANY (reloptions), false)) THEN
    RAISE EXCEPTION 'db/150: a new view runs as its owner';
  END IF;
  IF position($r$NOT IN ('batting_bowling', 'batting_bowling_fielding')$r$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'match_award(uuid,uuid,jsonb)'::regprocedure)) = 0
     OR position($r$'basis', p_derived->>'basis'$r$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'match_award(uuid,uuid,jsonb)'::regprocedure)) = 0
     OR position($r$NOT IN ('batting_bowling', 'batting_bowling_fielding')$r$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'captain_nominate(uuid,uuid,jsonb)'::regprocedure)) = 0
     OR position($r$'basis', p_derived->>'basis'$r$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'captain_nominate(uuid,uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/150: Player of the Match does not take the basis it was read on';
  END IF;
  -- Nothing stored names fielders before this file: the credit starts empty.
  IF NOT EXISTS (SELECT 1 FROM ball_event WHERE payload ? 'fielders') AND EXISTS (SELECT 1 FROM fielding_credit) THEN
    RAISE EXCEPTION 'db/150: fielding_credit credits a wicket that names nobody';
  END IF;
END $proof$;

DROP FUNCTION pg_temp._v150_patch(text, text, text, integer);
