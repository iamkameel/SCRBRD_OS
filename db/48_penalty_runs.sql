-- ══════════════════════════════════════════════════════════════════
--  48 · Penalty runs in every total, the fielding side's where the fold
--       puts them (SCRBRD-090, SCRBRD-094)
-- ══════════════════════════════════════════════════════════════════
--
-- Two things were wrong with penalty runs (Law 41's five) in SQL, and one
-- in the fold:
--
--   THE LIVE SCORE LEFT THEM OUT (SCRBRD-090). match_live_score summed
--     `value`, which a `penalty` row does not carry (toRow() has no column
--     for its runs; they ride in the payload). The public board
--     (broadcast_state()), its chase target, the live_score read and the
--     derby record were short by every award the pad's fold counts. db/45
--     taught the handover check to count them and left the view alone.
--   THE FOLD DROPPED THE FIELDING SIDE'S (SCRBRD-094). An award to the
--     fielding side (`toBattingTeam: false`) was in no innings' total. Kameel
--     decided it from MCC Law 41: five penalty runs to the fielding side are
--     added to the fielding side's total — its most recently completed
--     innings, or, if it has not batted yet, its next innings. The fold
--     (packages/scoring replay.mjs, the truth) now does that across innings
--     (penaltyCredits()), and every SQL total below does what it does.
--
-- THE FOLD'S RULE, AS SQL READS IT (replay.mjs, "PENALTY RUNS TO THE
-- FIELDING SIDE CROSS INNINGS"):
--
--   An innings' SIDES are its last live innings_start's: the batting side's
--     key is payload.teamKey, or payload.battingTeam when there is none
--     (`ev.teamKey ?? ev.battingTeam`); the fielding side's is
--     payload.bowlingTeamKey, or payload.bowlingTeam. Compared as jsonb, so a
--     string is equal to the same string only, as `===` has it. An innings
--     with no innings_start has no side and takes no credit.
--   The award, penalty_to_fielding_as_folded(): payload.runs, 5 when absent
--     or null, on a `penalty` row whose payload.toBattingTeam is JSON false —
--     exactly the rows penalty_runs_as_folded() (db/45) gives 0 for that
--     reason. NULL for runs that are not an integer: the fold has no number.
--   WHERE IT GOES, penalty_credit_as_folded(): the awards made in innings N
--     go to the highest innings before N that the fielding side batted — its
--     most recently completed: innings are played in order, so every one
--     before N has ended — or, when it has none, to the lowest innings after
--     N that it bats. Neither yet (the second innings not opened): nowhere,
--     until its innings_start is in the log. The fold ADDS the first at the
--     end of that innings and OPENS the second on them; the totals here are
--     the same numbers either way. An innings' runs are NULL when an award
--     credited to it is.
--   THE TARGET, innings_target_as_folded(): the innings' innings_start
--     target, or the umpires' revised one (a revision's payload.target), as
--     the fold keeps `inn.target` — raised by every award to the fielding side
--     made in that innings after it was set, unless it is the umpires' (a
--     revision's, until an innings_start sets it again). Read in seq order,
--     the order the fold folds. NULL for an innings with no target, and for a
--     target or an award that is not an integer.
--
-- WHAT MOVES, ON ROWS ALREADY STORED. Only an innings' runs, and only where
-- the log has a penalty row: an award to the batting side is now in
-- match_live_score's runs (it was in the fold's and, since db/45, the
-- handover check's); an award to the fielding side is in the runs of the
-- innings the fold credits it to, which the handover check (through
-- innings_score_as_folded()) now expects too; and the board's target is the
-- fold's. For a log with no penalty row every total is the number it was.
-- The board's target also moves off "the previous innings plus one" where
-- the fold's own target differs — the umpires' revised target, the target
-- the chase opened with — which is the fold's and was never the board's.
--
-- REPLACED, each from its latest definition — name, signature, columns and
-- types, volatility, parallel label, strictness, security, pinned
-- search_path, owner, grants and view options as they were; the block at
-- the end checks that against a snapshot taken before any is touched:
--
--   match_live_score                             db/42   runs: + penalties, + credits
--   innings_score_as_folded(uuid,smallint)       db/45   runs: + credits
--   broadcast_state(uuid)                        db/08   target: the fold's
--
-- NEW, each SECURITY INVOKER (a caller reads only the innings his policies
-- give him, as the view and db/45's helpers do), EXECUTE to scrbrd_app:
--
--   penalty_to_fielding_as_folded(text,jsonb)    one row's award to the fielding side
--   penalty_credit_as_folded(uuid,smallint)      awards from other innings in this one's total
--   innings_target_as_folded(uuid,smallint)      the fold's `inn.target`
--
-- FOLLOW WITHOUT REPLACEMENT: scoring_verify_takeover() (db/45, through
-- innings_score_as_folded()), the live_score and derby_record reads
-- (services/api/read/read-api.mjs, over match_live_score) and the board.
-- penalty_runs_as_folded() (db/45) is unchanged: it answers for the batting
-- side, as it always did.
--
-- NOT CHANGED, found while checking: match_live_score's runs still add
-- `value` on every row, as db/02 wrote it, where the fold reads it on a
-- delivery only; the pad writes `value` on nothing else, so no stored figure
-- differs. The board's striker and bowler still come from ball_event, not
-- ball_event_live (a voided last ball names its batter).
--
-- PROVED BY: the block at the end of this file (a match it builds and rolls
-- back: both sides' awards, a completed innings raised, a next innings
-- opened on the award, a target raised mid-chase and one the umpires typed,
-- a two-innings match); db/99 §26; tools/smoke-fold-figures.mjs (the fold
-- and every SQL total agree over generated logs with awards to both sides);
-- tools/smoke-handover-innings.mjs.

-- ── The shape of everything this file replaces, before it does ─────
-- As db/43's: a plain temporary table, dropped at the end.
CREATE TEMP TABLE _db48_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions),
         'acl', to_jsonb(c.relacl::text[]),
         'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname = 'match_live_score'
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid),
         'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef,
         'volatility', p.provolatile,
         'parallel', p.proparallel,
         'strict', p.proisstrict,
         'leakproof', p.proleakproof,
         'cost', p.procost,
         'rows', p.prorows,
         'config', to_jsonb(p.proconfig),
         'acl', to_jsonb(p.proacl::text[]),
         'owner', p.proowner::regrole::text,
         'language', p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text IN ('innings_score_as_folded(uuid,smallint)', 'broadcast_state(uuid)');

-- ── The rules, in SQL ────────────────────────────────────────────

-- replay.mjs, the PENALTY case's other branch, over fromRow(row):
--
--     else inn.penaltyToFielding += ev.runs ?? 5;
--
-- penalty_runs_as_folded() (db/45) with the side the other way round: 0 for
-- every row that is not a penalty, and for one whose payload.toBattingTeam
-- is anything but JSON false; NULL for runs that are not an integer.
CREATE OR REPLACE FUNCTION penalty_to_fielding_as_folded(p_kind text, p_payload jsonb)
RETURNS integer AS $$
  SELECT CASE
           WHEN p_kind IS DISTINCT FROM 'penalty'                                            THEN 0
           WHEN coalesce(p_payload->'toBattingTeam', 'null'::jsonb) IS DISTINCT FROM 'false'::jsonb THEN 0
           WHEN coalesce(p_payload->'runs', 'null'::jsonb) = 'null'::jsonb                    THEN 5
           -- Nested, so the cast is reached only for a JSON number (db/45).
           WHEN jsonb_typeof(p_payload->'runs') = 'number' THEN
             CASE WHEN (p_payload->>'runs')::numeric = trunc((p_payload->>'runs')::numeric)
                       AND abs((p_payload->>'runs')::numeric) < 2147483648
                  THEN (p_payload->>'runs')::numeric::integer END
         END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- penaltyCredits() in replay.mjs: the runs awarded to fielding sides in
-- other innings of this match that are in this innings' total. See the
-- header for the rule; `inns` is each innings the live log is in, its two
-- sides and what it awarded the fielding side.
CREATE OR REPLACE FUNCTION penalty_credit_as_folded(p_match uuid, p_innings smallint)
RETURNS integer AS $$
  WITH inns AS (
    SELECT b.innings,
           (SELECT coalesce(nullif(s.payload->'teamKey', 'null'::jsonb), nullif(s.payload->'battingTeam', 'null'::jsonb))
              FROM ball_event_live s
             WHERE s.match_id = p_match AND s.innings = b.innings AND s.kind = 'innings_start'
             ORDER BY s.seq DESC LIMIT 1)                                            AS batting_side,
           (SELECT coalesce(nullif(s.payload->'bowlingTeamKey', 'null'::jsonb), nullif(s.payload->'bowlingTeam', 'null'::jsonb))
              FROM ball_event_live s
             WHERE s.match_id = p_match AND s.innings = b.innings AND s.kind = 'innings_start'
             ORDER BY s.seq DESC LIMIT 1)                                            AS fielding_side,
           sum(penalty_to_fielding_as_folded(b.kind, b.payload))                     AS awarded,
           bool_or(penalty_to_fielding_as_folded(b.kind, b.payload) IS NULL)         AS unknown
      FROM ball_event_live b
     WHERE b.match_id = p_match
     GROUP BY b.innings
  ),
  goes AS (
    SELECT a.awarded, a.unknown,
           coalesce((SELECT max(r.innings) FROM inns r WHERE r.innings < a.innings AND r.batting_side = a.fielding_side),
                    (SELECT min(r.innings) FROM inns r WHERE r.innings > a.innings AND r.batting_side = a.fielding_side))
             AS to_innings
      FROM inns a
     WHERE a.fielding_side IS NOT NULL AND (a.unknown OR a.awarded <> 0)
  )
  SELECT CASE WHEN coalesce(bool_or(g.unknown), false) THEN NULL
              ELSE coalesce(sum(g.awarded), 0)::integer END
    FROM goes g
   WHERE g.to_innings = p_innings
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- `inn.target` as the fold leaves it (replay.mjs): innings_start sets it
-- (`ev.target ?? null`) and makes it the innings' own; a revision with a
-- target sets it and makes it the umpires'; an award to the fielding side
-- raises it, unless it is the umpires' or there is none.
CREATE OR REPLACE FUNCTION innings_target_as_folded(p_match uuid, p_innings smallint)
RETURNS integer AS $$
DECLARE r record; t integer; bad boolean := false; typed boolean := false; v jsonb; award integer;
BEGIN
  FOR r IN SELECT b.kind, b.payload FROM ball_event_live b
            WHERE b.match_id = p_match AND b.innings = p_innings
              AND b.kind IN ('innings_start', 'revision', 'penalty')
            ORDER BY b.seq
  LOOP
    v := coalesce(r.payload->'target', 'null'::jsonb);
    IF r.kind = 'innings_start' OR (r.kind = 'revision' AND v <> 'null'::jsonb) THEN
      t := NULL; bad := false;
      IF jsonb_typeof(v) = 'number' AND (v::text)::numeric = trunc((v::text)::numeric)
         AND abs((v::text)::numeric) < 2147483648 THEN
        t := (v::text)::numeric::integer;
      ELSIF v <> 'null'::jsonb THEN
        bad := true;
      END IF;
      typed := r.kind = 'revision';
    ELSIF r.kind = 'penalty' AND (t IS NOT NULL OR bad) AND NOT typed THEN
      award := penalty_to_fielding_as_folded(r.kind, r.payload);
      IF award IS NULL THEN bad := true; ELSE t := t + award; END IF;
    END IF;
  END LOOP;
  RETURN CASE WHEN bad THEN NULL ELSE t END;
END $$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

GRANT EXECUTE ON FUNCTION penalty_to_fielding_as_folded(text, jsonb) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION penalty_credit_as_folded(uuid, smallint) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION innings_target_as_folded(uuid, smallint) TO scrbrd_app;

-- ── The live score (db/42) ───────────────────────────────────────
-- From db/42 with the runs as the fold totals them: the deliveries as
-- before, the awards to the batting side made in this innings, and the
-- awards to fielding sides made elsewhere that are this side's. NULL when
-- one of those is not a number the fold could add. Wickets, legal balls,
-- the last seq and the last ball's time are as they were.
CREATE OR REPLACE VIEW match_live_score WITH (security_invoker = true) AS
SELECT
  match_id,
  innings,
  CASE WHEN bool_and(penalty_runs_as_folded(kind, payload) IS NOT NULL)
       THEN sum(CASE WHEN ball_type IN ('Wd','Nb') THEN 1 + coalesce(value,0)
                     ELSE coalesce(value,0) END)
            + sum(penalty_runs_as_folded(kind, payload))
            + penalty_credit_as_folded(match_id, innings)
  END                                                                     AS runs,
  sum(CASE WHEN ball_wicket_stands(match_id, innings, seq, kind, ball_type, dismissal)
           THEN 1 ELSE 0 END)                                             AS wickets,
  sum(CASE WHEN kind='ball' AND ball_type NOT IN ('Wd','Nb') THEN 1 ELSE 0 END) AS legal_balls,
  max(seq)                                                                AS last_seq,
  max(server_ts)                                                          AS last_ball_at
FROM ball_event_live
GROUP BY match_id, innings;

-- ── The handover check's count (db/45) ───────────────────────────
-- From db/45 with the credit added to the runs. The check itself
-- (scoring_verify_takeover) is unchanged and counts through this.
CREATE OR REPLACE FUNCTION innings_score_as_folded(p_match uuid, p_innings smallint)
RETURNS TABLE (runs integer, wickets integer, legal_balls integer) AS $$
  SELECT
    CASE WHEN coalesce(bool_and(penalty_runs_as_folded(b.kind, b.payload) IS NOT NULL), true)
         THEN (coalesce(sum(CASE WHEN b.kind <> 'ball'               THEN 0
                                 WHEN b.ball_type IN ('Wd', 'Nb')    THEN 1 + coalesce(b.value, 0)
                                 ELSE coalesce(b.value, 0) END), 0)
               + coalesce(sum(penalty_runs_as_folded(b.kind, b.payload)), 0))::integer
              + penalty_credit_as_folded(p_match, p_innings)
    END,
    count(*) FILTER (WHERE (b.kind = 'ball'
                            AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
                        OR ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL)::integer,
    count(*) FILTER (WHERE b.kind = 'ball' AND b.ball_type NOT IN ('Wd', 'Nb'))::integer
  FROM ball_event_live b
  WHERE b.match_id = p_match AND b.innings = p_innings
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- ── The board (db/08) ────────────────────────────────────────────
-- From db/08 with the target the fold's: the innings' own target (raised by
-- an award to the fielding side, or the umpires' revised one), and, for a
-- chase that carries none, what the previous innings made plus one — its
-- total with the awards credited to it, now that match_live_score has them.
-- Its search path is restated: db/16 pinned it, and CREATE OR REPLACE
-- replaces a function's settings with the ones it is given.
CREATE OR REPLACE FUNCTION broadcast_state(p_match uuid)
RETURNS TABLE (
  match_id uuid, home_team text, away_team text, strapline text,
  innings smallint, runs bigint, wickets bigint, legal_balls bigint,
  overs text, run_rate numeric, target bigint,
  striker text, non_striker text, bowler text,
  officials text, name_display text,
  -- The board, and nothing behind it. See the sponsor CTE below.
  sponsor_name text, sponsor_logo text, sponsor_bg text
) AS $$
  WITH b AS (
    SELECT * FROM match_broadcast WHERE match_id = p_match AND published
  ),
  m AS (
    SELECT mt.* FROM match mt JOIN b ON b.match_id = mt.id
  ),
  -- The innings being played is the highest one the log has reached.
  cur AS (
    SELECT ls.* FROM match_live_score ls JOIN b ON b.match_id = ls.match_id
     ORDER BY ls.innings DESC LIMIT 1
  ),
  -- A chase has a target: what the previous innings made, plus one.
  prev AS (
    SELECT ls.runs FROM match_live_score ls JOIN cur ON cur.match_id = ls.match_id
     WHERE ls.innings < cur.innings ORDER BY ls.innings DESC LIMIT 1
  ),
  -- Who is at the crease, taken from the last delivery bowled rather than
  -- replayed: ball_event stamps the striker and the bowler on every ball, and
  -- an overlay wants the state at the last ball by definition.
  last_ball AS (
    SELECT e.striker_id, e.non_striker_id, e.bowler_id
      FROM ball_event e JOIN cur ON cur.match_id = e.match_id AND cur.innings = e.innings
     WHERE e.kind = 'ball'
     ORDER BY e.seq DESC LIMIT 1
  ),
  -- The sponsor whose board this is, if the school sold the surface.
  --
  -- THREE COLUMNS AND NO MORE. contract_value_zar and school_share_pct are on
  -- the same row and are not selected here, and this function is SECURITY
  -- DEFINER — so the masking view that keeps them from a coach would not have
  -- kept them from a spectator. What a sponsor pays is between the sponsor and
  -- the school; what a sponsor buys is a name on a screen, and that is all
  -- that leaves.
  --
  -- A placement tied to THIS fixture wins over the school's standing one:
  -- ordering match_id first with NULLS LAST puts the specific agreement ahead
  -- of the general one, which is what a school selling a one-off derby board
  -- on top of a season deal expects.
  sponsor AS (
    SELECT sp.name, sp.logo_text, sp.logo_bg
      FROM sponsorship s
      JOIN sponsor sp ON sp.id = s.sponsor_id AND sp.active
      JOIN m ON m.school_id = s.school_id
     WHERE s.placement = 'broadcast_overlay'
       AND (s.match_id IS NULL OR s.match_id = m.id)
       AND current_date BETWEEN s.starts_on AND s.ends_on
     ORDER BY s.match_id NULLS LAST, s.agreed_at DESC
     LIMIT 1
  )
  SELECT m.id,
         m.team_code, m.opponent,
         b.strapline,
         cur.innings, cur.runs, cur.wickets, cur.legal_balls,
         (cur.legal_balls / 6)::text || '.' || (cur.legal_balls % 6)::text,
         CASE WHEN cur.legal_balls > 0
              THEN round((cur.runs::numeric * 6) / cur.legal_balls, 2) END,
         -- The fold's target (db/48): the innings' own, else the previous
         -- innings' total plus one.
         coalesce(innings_target_as_folded(cur.match_id, cur.innings), (SELECT runs + 1 FROM prev)),
         -- Every name goes through the masker. There is no branch here that
         -- returns an unmasked one.
         broadcast_name((SELECT full_name FROM player WHERE id = (SELECT striker_id FROM last_ball)), b.name_display),
         broadcast_name((SELECT full_name FROM player WHERE id = (SELECT non_striker_id FROM last_ball)), b.name_display),
         broadcast_name((SELECT full_name FROM player WHERE id = (SELECT bowler_id FROM last_ball)), b.name_display),
         -- Officials are adults doing a public job, so they are named in full
         -- when shown at all — but only when the school said to show them.
         CASE WHEN b.show_officials THEN (
           SELECT string_agg(o.person_name, ' · ' ORDER BY o.duty, o.person_name)
             FROM match_official o
            WHERE o.match_id = m.id AND NOT o.withdrawn AND o.duty IN ('umpire','third_umpire')
         ) END,
         b.name_display,
         (SELECT name FROM sponsor), (SELECT logo_text FROM sponsor), (SELECT logo_bg FROM sponsor)
    FROM b JOIN m ON m.id = b.match_id LEFT JOIN cur ON cur.match_id = b.match_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── Assertion: the rules, and nothing else moved ───────────────────
DO $check$
DECLARE r record; now_shape jsonb; n int; src text;
  -- The proof's own rows, built below and rolled back before this block ends.
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  m_one    uuid := gen_random_uuid();
  m_two    uuid := gen_random_uuid();
  k        int := 0;
  got      jsonb;
  want     jsonb := jsonb_build_object(
    -- One innings each. A: 4 + 6 + 5 to the batting side = 15 of its own,
    -- then three awards to it while fielding second: 30. B opens on the
    -- award A's innings made to it (5), then 1 and a short run's dot: 6.
    -- The target, 16 when B opened: + 5, + 5 = 26, then the umpires' 30,
    -- which the last award does not move.
    'one_live',   '[[0, 30], [1, 6]]'::jsonb,
    'one_folded', '[[0, 30], [1, 6]]'::jsonb,
    'one_credit', '[[0, 15], [1, 5]]'::jsonb,
    'one_target', '[26, 30]'::jsonb,
    'one_board',  '[1, 6, 30]'::jsonb,
    -- Two innings each: A 2, B 3 (+5 from A's first, +5 from A's second) = 13,
    -- A 1 (+5 from B's second) = 6, B 4.
    'two_live',   '[[0, 2], [1, 13], [2, 6], [3, 4]]'::jsonb,
    -- An award that is not a number leaves the innings it goes to unknown.
    'unknown',    '[null, null]'::jsonb);
  v_live jsonb; v_folded jsonb; v_credit jsonb; v_target jsonb; v_board jsonb; v_two jsonb; v_unknown jsonb;
BEGIN
  -- The shape: the same three objects, the same everything but their bodies.
  SELECT count(*) INTO n FROM _db48_before;
  IF n <> 3 THEN RAISE EXCEPTION 'db/48: expected to snapshot 3 objects, found %', n; END IF;
  FOR r IN SELECT * FROM _db48_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object(
               'options', to_jsonb(c.reloptions),
               'acl', to_jsonb(c.relacl::text[]),
               'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape
        FROM pg_class c WHERE c.oid = to_regclass('public.' || substr(r.obj, 6));
    ELSE
      SELECT jsonb_build_object(
               'result', pg_get_function_result(p.oid),
               'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef,
               'volatility', p.provolatile,
               'parallel', p.proparallel,
               'strict', p.proisstrict,
               'leakproof', p.proleakproof,
               'cost', p.procost,
               'rows', p.prorows,
               'config', to_jsonb(p.proconfig),
               'acl', to_jsonb(p.proacl::text[]),
               'owner', p.proowner::regrole::text,
               'language', p.prolang)
        INTO now_shape
        FROM pg_proc p WHERE p.oid = to_regprocedure(substr(r.obj, 10));
    END IF;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/48: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;

  -- The board is still a definer with its search path pinned (db/16).
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'broadcast_state(uuid)'::regprocedure
                    AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
    RAISE EXCEPTION 'db/48: broadcast_state() is not a definer with its search path pinned';
  END IF;
  -- Each total asks the rules, not a copy of them.
  IF pg_get_viewdef('match_live_score'::regclass) NOT LIKE '%penalty_runs_as_folded(%'
     OR pg_get_viewdef('match_live_score'::regclass) NOT LIKE '%penalty_credit_as_folded(%' THEN
    RAISE EXCEPTION 'db/48: match_live_score does not count penalty runs through the helpers';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'innings_score_as_folded(uuid,smallint)'::regprocedure;
  IF src NOT LIKE '%penalty_credit_as_folded(p_match, p_innings)%' THEN
    RAISE EXCEPTION 'db/48: innings_score_as_folded() does not add the credit';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'broadcast_state(uuid)'::regprocedure;
  IF src NOT LIKE '%innings_target_as_folded(cur.match_id, cur.innings)%' THEN
    RAISE EXCEPTION 'db/48: broadcast_state() does not state the fold''s target';
  END IF;
  -- The helpers run as their caller, and the application role may call them.
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid IN ('penalty_to_fielding_as_folded(text,jsonb)'::regprocedure,
                            'penalty_credit_as_folded(uuid,smallint)'::regprocedure,
                            'innings_target_as_folded(uuid,smallint)'::regprocedure)
                AND prosecdef) THEN
    RAISE EXCEPTION 'db/48: a helper runs as its owner';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'penalty_to_fielding_as_folded(text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'penalty_credit_as_folded(uuid,smallint)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'innings_target_as_folded(uuid,smallint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/48: the application role cannot call a helper';
  END IF;

  -- The award rule answers as `toBattingTeam === false ? (runs ?? 5) : 0`.
  IF penalty_to_fielding_as_folded('penalty', '{"toBattingTeam": false}') IS DISTINCT FROM 5
     OR penalty_to_fielding_as_folded('penalty', '{"runs": 3, "toBattingTeam": false}') IS DISTINCT FROM 3
     OR penalty_to_fielding_as_folded('penalty', '{"runs": null, "toBattingTeam": false}') IS DISTINCT FROM 5
     OR penalty_to_fielding_as_folded('penalty', '{"runs": 5}') IS DISTINCT FROM 0
     OR penalty_to_fielding_as_folded('penalty', '{"runs": 5, "toBattingTeam": true}') IS DISTINCT FROM 0
     OR penalty_to_fielding_as_folded('penalty', '{"runs": 5, "toBattingTeam": null}') IS DISTINCT FROM 0
     OR penalty_to_fielding_as_folded('penalty', '{"runs": 5, "toBattingTeam": "false"}') IS DISTINCT FROM 0
     OR penalty_to_fielding_as_folded('penalty', '{"runs": "5", "toBattingTeam": false}') IS NOT NULL
     OR penalty_to_fielding_as_folded('penalty', '{"runs": 2.5, "toBattingTeam": false}') IS NOT NULL
     OR penalty_to_fielding_as_folded('ball', '{"runs": 5, "toBattingTeam": false}') IS DISTINCT FROM 0
     OR penalty_to_fielding_as_folded(NULL, NULL) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'db/48: penalty_to_fielding_as_folded() is not the fold''s PENALTY case';
  END IF;

  -- The behaviour, on two matches that exist only inside this block: written
  -- as the owner, read through the helpers, the view and the board, and then
  -- undone by the sentinel below, whatever the database already holds.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db48-' || v_school, 'db/48 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db48-' || v_user || '@example.invalid', 'db/48 proof, scorer', 'scorer', v_school);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status)
    VALUES (m_one, v_school, '1XI', 'db/48 proof', now(), 'cricket', 'T20', 20, 'live'),
           (m_two, v_school, '1XI', 'db/48 proof, two innings', now(), 'cricket', 'T20', 20, 'live');
    INSERT INTO match_broadcast (match_id, school_id, published) VALUES (m_one, v_school, true);

    FOR r IN SELECT * FROM (VALUES
        -- innings 0: A (key "A") bats, B fields
        (m_one, 0, 'innings_start', NULL, NULL::int, '{"battingTeam":"A side","bowlingTeam":"B side","teamKey":"A","bowlingTeamKey":"B"}'::jsonb),
        (m_one, 0, 'ball',    'run', 4,    '{}'::jsonb),
        (m_one, 0, 'penalty', NULL,  NULL, '{"toBattingTeam":false,"reason":"pitch_damage"}'::jsonb),   -- to B's next innings
        (m_one, 0, 'ball',    'run', 6,    '{}'::jsonb),
        (m_one, 0, 'penalty', NULL,  NULL, '{"runs":5,"toBattingTeam":true,"reason":"helmet_struck"}'::jsonb),
        -- innings 1: B bats, chasing 16
        (m_one, 1, 'innings_start', NULL, NULL, '{"battingTeam":"B side","bowlingTeam":"A side","teamKey":"B","bowlingTeamKey":"A","target":16}'::jsonb),
        (m_one, 1, 'ball',    'run', 1,    '{}'::jsonb),
        (m_one, 1, 'ball',    'run', 0,    '{}'::jsonb),                                               -- a short run: no run
        (m_one, 1, 'penalty', NULL,  NULL, '{"runs":5,"toBattingTeam":false,"reason":"short_running"}'::jsonb),
        (m_one, 1, 'penalty', NULL,  NULL, '{"toBattingTeam":false,"reason":"time_wasting"}'::jsonb)
      ) AS v(mid, inn, kind, bt, val, pl)
    LOOP
      k := k + 1;
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
      VALUES (r.mid, v_school, k, 1, r.inn, v_user, 'db48', 'db48:' || v_school || ':' || k, k, now(),
              r.kind, r.bt, r.val, r.pl);
    END LOOP;
    v_target := jsonb_build_array(innings_target_as_folded(m_one, 1::smallint));

    FOR r IN SELECT * FROM (VALUES
        (m_one, 1, 'revision', NULL, NULL::int, '{"target":30,"reason":"rain"}'::jsonb),
        (m_one, 1, 'penalty',  NULL, NULL,      '{"runs":5,"toBattingTeam":false,"reason":"protected_area"}'::jsonb),
        -- The two-innings match: A, B, A, B.
        (m_two, 0, 'innings_start', NULL, NULL, '{"battingTeam":"A","bowlingTeam":"B"}'::jsonb),
        (m_two, 0, 'ball',    'run', 2,    '{}'::jsonb),
        (m_two, 0, 'penalty', NULL,  NULL, '{"toBattingTeam":false}'::jsonb),                           -- to B's first
        (m_two, 1, 'innings_start', NULL, NULL, '{"battingTeam":"B","bowlingTeam":"A"}'::jsonb),
        (m_two, 1, 'ball',    'run', 3,    '{}'::jsonb),
        (m_two, 2, 'innings_start', NULL, NULL, '{"battingTeam":"A","bowlingTeam":"B"}'::jsonb),
        (m_two, 2, 'ball',    'run', 1,    '{}'::jsonb),
        (m_two, 2, 'penalty', NULL,  NULL, '{"runs":5,"toBattingTeam":false}'::jsonb),                  -- to B's first, their last
        (m_two, 3, 'innings_start', NULL, NULL, '{"battingTeam":"B","bowlingTeam":"A"}'::jsonb),
        (m_two, 3, 'ball',    'run', 4,    '{}'::jsonb),
        (m_two, 3, 'penalty', NULL,  NULL, '{"runs":5,"toBattingTeam":false}'::jsonb)                   -- to A's second
      ) AS v(mid, inn, kind, bt, val, pl)
    LOOP
      k := k + 1;
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                              idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
      VALUES (r.mid, v_school, k, 1, r.inn, v_user, 'db48', 'db48:' || v_school || ':' || k, k, now(),
              r.kind, r.bt, r.val, r.pl);
    END LOOP;

    SELECT jsonb_agg(jsonb_build_array(l.innings, l.runs) ORDER BY l.innings) INTO v_live
      FROM match_live_score l WHERE l.match_id = m_one;
    SELECT jsonb_agg(jsonb_build_array(i, (SELECT f.runs FROM innings_score_as_folded(m_one, i::smallint) f)) ORDER BY i)
      INTO v_folded FROM generate_series(0, 1) i;
    SELECT jsonb_agg(jsonb_build_array(i, penalty_credit_as_folded(m_one, i::smallint)) ORDER BY i)
      INTO v_credit FROM generate_series(0, 1) i;
    v_target := v_target || jsonb_build_array(innings_target_as_folded(m_one, 1::smallint));
    SELECT jsonb_build_array(s.innings, s.runs, s.target) INTO v_board FROM broadcast_state(m_one) s;
    SELECT jsonb_agg(jsonb_build_array(l.innings, l.runs) ORDER BY l.innings) INTO v_two
      FROM match_live_score l WHERE l.match_id = m_two;

    -- An award that is not a number: the innings it goes to has no total.
    k := k + 1;
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                            idempotency_key, client_seq, client_ts, kind, payload)
    VALUES (m_two, v_school, k, 1, 3, v_user, 'db48', 'db48:' || v_school || ':' || k, k, now(),
            'penalty', '{"runs":"5","toBattingTeam":false}');
    SELECT jsonb_build_array((SELECT l.runs FROM match_live_score l WHERE l.match_id = m_two AND l.innings = 2),
                             (SELECT f.runs FROM innings_score_as_folded(m_two, 2::smallint) f))
      INTO v_unknown;

    RAISE EXCEPTION USING ERRCODE = 'ZZ048', MESSAGE = 'db/48: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ048' THEN NULL;
  END;

  got := jsonb_build_object('one_live', v_live, 'one_folded', v_folded, 'one_credit', v_credit,
                            'one_target', v_target, 'one_board', v_board, 'two_live', v_two, 'unknown', v_unknown);
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'db/48: the totals read %, expected %', got, want;
  END IF;

  -- And nothing of the proof is left.
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) OR EXISTS (SELECT 1 FROM app_user WHERE id = v_user)
     OR EXISTS (SELECT 1 FROM match WHERE id IN (m_one, m_two)) THEN
    RAISE EXCEPTION 'db/48: the proof left something behind';
  END IF;
END $check$;

DROP TABLE _db48_before;
