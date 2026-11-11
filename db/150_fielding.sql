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
--              + ball_fielder_on_side()  a fielder named by id is the fielding
--                side's for the match: on the sheet (match_squad) on the
--                bowler's side, else the innings' fielding squad
--   trigger    + ball_event_wicket_fielders  BEFORE INSERT on ball_event: a
--                row whose payload names fielders that do not fit its way
--                out, or on a delivery that is no wicket, is refused
--                (check_violation, CONSTRAINT ball_event_wicket_fielders →
--                "fielders_invalid", events-api.mjs CHECK_REASON); a
--                stumping's first fielder is the keeper while one is on
--                the record (as db/68's door asks of its `fielder`); a
--                fielder named by id is one of the fielding side's
--                (ball_fielder_on_side(): never a team-mate batting, a boy
--                not in the match, another school's child). Named
--                to fire after ball_event_stumped_by_keeper and before
--                zz_ball_event_fingerprint. Whether a fielder is a batter
--                at the crease is the Laws' at commit (lawsRefusal,
--                fielders_invalid); a stored row is never re-judged.
--   views      + fielding_credit (security_invoker)  fieldingCredits(): one
--                row per fielder a standing catch, stumping or run out
--                names, over ball_event_career (no super over, no void).
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
--   R10        + match_award_figures(match, boy, basis), match_award_fielding_words():
--                db/148's mirror on the award's own basis; ~ honour_cite_figures(),
--                recognition_review_check(), recognition_reviews_open() and
--                recognition_review_stand() (db/148) pass the award's basis, so a
--                correction that voids or re-credits a catch flags an award decided
--                on fielding, and an old batting_bowling award compares as before.
--                Applies after db/148 (the guard asks for it); after a re-run of
--                db/148, run this file again.
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
     -- R10 (db/148): the corrections this file teaches the fielding basis.
     OR to_regprocedure('match_award_figures(uuid,uuid)') IS NULL OR to_regprocedure('honour_cite_figures()') IS NULL
     OR to_regprocedure('recognition_review_check(uuid)') IS NULL OR to_regprocedure('recognition_reviews_open(uuid)') IS NULL
     OR to_regprocedure('recognition_review_stand(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass AND tgname = 'ball_event_stumped_by_keeper')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'ball_event'::regclass AND tgname = 'zz_ball_event_fingerprint') THEN
    RAISE EXCEPTION 'db/150: the keeper (db/68), wickets on extras (db/87), Player of the Match (db/142), the captain''s nomination (db/144) or corrections reaching awards (db/148) is missing; apply them first';
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
-- characters (FIELDER_REF_MAX), each named once; one shaped as a player id
-- only in lower case, as SCRBRD writes ids (so "<id>" and "<ID>" are never
-- two fielders here and one in the fold). False — never NULL — for anything
-- else, a missing list included.
CREATE OR REPLACE FUNCTION ball_fielders_fit(p_fielders jsonb, p_dismissal text) RETURNS boolean AS $$
  SELECT coalesce(
           jsonb_typeof(p_fielders) = 'array'
       AND jsonb_array_length(p_fielders) >= 1
       AND jsonb_array_length(p_fielders) <= CASE p_dismissal WHEN 'caught' THEN 1 WHEN 'stumped' THEN 1 WHEN 'run_out' THEN 2 ELSE 0 END
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fielders) e
                        WHERE jsonb_typeof(e) <> 'string' OR e #>> '{}' = '' OR e #>> '{}' ~ '^\s|\s$'
                           OR length(e #>> '{}') > 80
                           OR (e #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                               AND e #>> '{}' <> lower(e #>> '{}')))
       AND (SELECT count(DISTINCT e) FROM jsonb_array_elements_text(p_fielders) e) = jsonb_array_length(p_fielders),
         false)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
COMMENT ON FUNCTION ball_fielders_fit(jsonb, text) IS
  'db/150 (RECOGNITION R12, P2): events.mjs fieldersFit(). The fielders a way out may name: one for a catch or a stumping, one or two for a run out, each once.';


-- ══════════════════════════════════════════════════════════════════
--  2 · The door
-- ══════════════════════════════════════════════════════════════════
-- Is this reference a fielder of the side in the field (the review's S3)?
-- A typed name (a substitute, the other side's boy, Law 24) always may be.
-- A player id must be one of the fielding side's for that match:
--   the match has a sheet (match_squad, not withdrawn; the twelfth man is on
--     it): on the sheet, and on the side the ball's bowler is on — or, with
--     a bowler the sheet does not hold (a typed name), the side the striker
--     is not on; with neither on the sheet, anywhere on it;
--   no sheet: one of the innings' fielding squad as the pad named it (the
--     innings_start's bowlingSquad, an id or a member's id) or the keeper on
--     the record; with no fielding squad named at all, nothing to check.
-- So a team-mate batting, a boy not in the match, or another school's child
-- is never credited a catch he did not take. Asked by the door, which
-- knows the sheet; the Laws do not (the pad offers only the fielding side).
CREATE OR REPLACE FUNCTION ball_fielder_on_side(p_match uuid, p_innings smallint, p_seq integer,
                                                p_bowler uuid, p_striker uuid, p_ref text) RETURNS boolean AS $$
  SELECT CASE
    WHEN p_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN true
    WHEN EXISTS (SELECT 1 FROM match_squad s WHERE s.match_id = p_match AND NOT s.withdrawn) THEN
      EXISTS (SELECT 1 FROM match_squad s
               WHERE s.match_id = p_match AND NOT s.withdrawn AND s.player_id = p_ref::uuid
                 AND s.side = coalesce(
                       (SELECT b.side FROM match_squad b WHERE b.match_id = p_match AND NOT b.withdrawn AND b.player_id = p_bowler),
                       (SELECT CASE t.side WHEN 'home' THEN 'away' WHEN 'away' THEN 'home' END
                          FROM match_squad t WHERE t.match_id = p_match AND NOT t.withdrawn AND t.player_id = p_striker),
                       s.side))
    ELSE coalesce((
      SELECT CASE WHEN count(m.id) = 0 THEN true
                  ELSE bool_or(m.id = p_ref) OR coalesce((SELECT k.keeper_ref = p_ref FROM keeper_at(p_match, p_innings, p_seq) k), false) END
        FROM (SELECT s.payload FROM ball_event_live s
               WHERE s.match_id = p_match AND s.innings = p_innings AND s.kind = 'innings_start' AND s.seq < p_seq
               ORDER BY s.seq DESC LIMIT 1) st
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(st.payload -> 'bowlingSquad') = 'array'
                                                     THEN st.payload -> 'bowlingSquad' ELSE '[]'::jsonb END) e(member)
        CROSS JOIN LATERAL (SELECT CASE jsonb_typeof(e.member)
                                     WHEN 'object' THEN CASE WHEN jsonb_typeof(e.member -> 'id') = 'string' THEN e.member ->> 'id' END
                                     WHEN 'string' THEN e.member #>> '{}' END AS id) m
       WHERE m.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), true)
  END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION ball_fielder_on_side(uuid, smallint, integer, uuid, uuid, text) IS
  'db/150 (RECOGNITION R12): a fielder named by id is one of the fielding side''s for the match (the sheet, else the innings'' fielding squad). The door''s; nobody''s to call.';
REVOKE ALL ON FUNCTION ball_fielder_on_side(uuid, smallint, integer, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ball_fielder_on_side(uuid, smallint, integer, uuid, uuid, text) FROM scrbrd_app;

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
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.payload -> 'fielders') f(ref)
              WHERE NOT ball_fielder_on_side(NEW.match_id, NEW.innings, NEW.seq, NEW.bowler_id, NEW.striker_id, f.ref)) THEN
    RAISE EXCEPTION 'ball_event: a fielder named is not one of the fielding side''s for this match (match %, key %)',
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
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- A definer, so the sheet it reads (ball_fielder_on_side(), nobody's to
-- call) is asked whoever's insert fires it; it only refuses, never writes.
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
-- nobody's figure). Whether he was keeping is the keeping record's
-- (keeper_dismissal, db/68), not asked here: no reader of this view needs
-- it, and keeper_at() per row is a correlated scan of the log.
CREATE OR REPLACE VIEW fielding_credit WITH (security_invoker = true) AS
SELECT b.match_id, b.school_id, b.innings, b.seq, b.server_ts,
       f.ref                                                           AS fielder_ref,
       f.ord::smallint                                                 AS fielder_no,
       CASE WHEN f.ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN f.ref::uuid END                                       AS player_id,
       CASE b.dismissal WHEN 'caught' THEN 'catch' WHEN 'stumped' THEN 'stumping' ELSE 'run_out' END AS act
  FROM ball_event_career b
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(b.payload -> 'fielders') = 'array'
                                                    THEN b.payload -> 'fielders' ELSE '[]'::jsonb END) WITH ORDINALITY AS f(ref, ord)
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
--  6 · A correction re-derives an award on the basis it was decided on
--      (R10, db/148)
-- ══════════════════════════════════════════════════════════════════
-- db/148's mirror, match_award_figures(match, boy), is figuresWords() on the
-- batting and bowling basis. An award decided on the fielding basis cited
-- the boy's fielding too ("6* (6) · 1 catch"), so a correction that voids or
-- re-credits a catch must move what is compared, and one that touches only
-- fielding must not move an award decided without it. The three-argument
-- mirror below is figuresWords(matchFigures(facts, ids, basis)): the
-- two-argument one's words, and on the fielding basis the boy's catches,
-- stumpings and run outs from fielding_credit after them (catches, then
-- stumpings, then run outs, as potm.mjs writes them); his fielding alone
-- when he neither batted nor bowled. Any other basis is exactly db/148's.
-- Every call db/148 makes of the mirror for an award is patched to pass the
-- award's own derived_from.basis (honour_cite_figures, recognition_review_
-- check, recognition_reviews_open, recognition_review_stand): an old
-- batting_bowling award compares as before, character for character.
-- Re-running db/148 after this file restates those four without the basis:
-- run this file again after it.
CREATE OR REPLACE FUNCTION match_award_fielding_words(p_match uuid, p_player uuid) RETURNS text AS $$
  SELECT nullif(concat_ws(' · ',
           CASE WHEN c.catches > 0 THEN c.catches || CASE WHEN c.catches = 1 THEN ' catch' ELSE ' catches' END END,
           CASE WHEN c.stumpings > 0 THEN c.stumpings || CASE WHEN c.stumpings = 1 THEN ' stumping' ELSE ' stumpings' END END,
           CASE WHEN c.run_outs > 0 THEN c.run_outs || CASE WHEN c.run_outs = 1 THEN ' run out' ELSE ' run outs' END END), '')
    FROM (SELECT count(*) FILTER (WHERE f.act = 'catch') AS catches,
                 count(*) FILTER (WHERE f.act = 'stumping') AS stumpings,
                 count(*) FILTER (WHERE f.act = 'run_out') AS run_outs
            FROM fielding_credit f WHERE f.match_id = p_match AND f.player_id = p_player) c
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION match_award_figures(p_match uuid, p_player uuid, p_basis text) RETURNS text AS $$
  SELECT CASE WHEN p_basis IS DISTINCT FROM 'batting_bowling_fielding' OR f.w IS NULL THEN b.w
              WHEN b.w = 'Did not bat or bowl' THEN f.w
              ELSE b.w || ' · ' || f.w END
    FROM (SELECT match_award_figures(p_match, p_player) AS w) b,
         (SELECT CASE WHEN p_basis = 'batting_bowling_fielding' THEN match_award_fielding_words(p_match, p_player) END AS w) f
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION match_award_figures(uuid, uuid, text) IS
  'db/150 (RECOGNITION R12 on R10): db/148''s mirror on the award''s basis: on batting_bowling_fielding the boy''s catches, stumpings and run outs after his batting and bowling, as potm.mjs figuresWords() writes them. Nobody''s to call.';

DO $mirror$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_award_fielding_words(uuid,uuid)', 'match_award_figures(uuid,uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp._v150_patch('honour_cite_figures()',
    $n$match_award_figures(NEW.match_id, NEW.player_id))$n$,
    $r$match_award_figures(NEW.match_id, NEW.player_id, NEW.derived_from->>'basis'))$r$, 1);
  PERFORM pg_temp._v150_patch('recognition_review_check(uuid)',
    $n$v_now := match_award_figures(h.match_id, h.player_id);$n$,
    $r$v_now := match_award_figures(h.match_id, h.player_id, h.derived_from->>'basis');$r$, 1);
  PERFORM pg_temp._v150_patch('recognition_reviews_open(uuid)',
    $n$match_award_figures(r.match_id, r.player_id),$n$,
    $r$match_award_figures(r.match_id, r.player_id, h.derived_from->>'basis'),$r$, 1);
  PERFORM pg_temp._v150_patch('recognition_review_stand(uuid)',
    $n$match_award_figures(r.match_id, r.player_id),$n$,
    $r$match_award_figures(r.match_id, r.player_id, (SELECT x.derived_from->>'basis' FROM honour x WHERE x.id = r.honour_id)),$r$, 2);
END $mirror$;


-- ══════════════════════════════════════════════════════════════════
--  7 · What this file holds itself to
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
     OR ball_fielders_fit(to_jsonb(ARRAY[repeat('x', 81)]), 'caught') OR NOT ball_fielders_fit(to_jsonb(ARRAY[repeat('x', 80)]), 'caught')
     OR ball_fielders_fit('["AAAAAAAA-0000-4000-8000-000000000001"]', 'caught')
     OR ball_fielders_fit('["aaaaaaaa-0000-4000-8000-000000000001","AAAAAAAA-0000-4000-8000-000000000001"]', 'run_out')
     OR NOT ball_fielders_fit('["aaaaaaaa-0000-4000-8000-000000000001","J SUB"]', 'run_out') THEN
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
  IF position($r$h.derived_from->>'basis'$r$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'recognition_review_check(uuid)'::regprocedure)) = 0
     OR position($r$NEW.derived_from->>'basis'$r$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'honour_cite_figures()'::regprocedure)) = 0
     OR position($r$h.derived_from->>'basis'$r$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'recognition_reviews_open(uuid)'::regprocedure)) = 0
     OR position($r$x.derived_from->>'basis'$r$ IN (SELECT prosrc FROM pg_proc WHERE oid = 'recognition_review_stand(uuid)'::regprocedure)) = 0
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('match_award_figures(uuid,uuid,text)'::regprocedure, 'match_award_fielding_words(uuid,uuid)'::regprocedure)
                   AND (NOT p.prosecdef OR has_function_privilege('scrbrd_app', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'db/150: a correction does not re-derive an award on the basis it was decided on';
  END IF;
  -- Nothing stored names fielders before this file: the credit starts empty.
  IF NOT EXISTS (SELECT 1 FROM ball_event WHERE payload ? 'fielders') AND EXISTS (SELECT 1 FROM fielding_credit) THEN
    RAISE EXCEPTION 'db/150: fielding_credit credits a wicket that names nobody';
  END IF;
END $proof$;

DROP FUNCTION pg_temp._v150_patch(text, text, text, integer);
