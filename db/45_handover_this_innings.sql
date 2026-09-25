-- ══════════════════════════════════════════════════════════════════
--  45 · A handover verifies this innings, penalties included (SCRBRD-088)
-- ══════════════════════════════════════════════════════════════════
--
-- scoring_verify_takeover() is step 3 of the handover: the incoming scorer
-- reads the physical scoreboard and states runs, wickets and legal balls,
-- and only a match of the server's own count hands the token over. What the
-- scorer is asked for is THIS innings' figures — the sheet asks for overs and
-- balls in the over and sends overs × 6 + balls (apps/web sheets.jsx, "Balls
-- (total, this innings)"; handover.js: "legal deliveries bowled this
-- innings") — and the fold (packages/scoring replay.mjs, the truth) keeps
-- them per innings. The check compared them with two numbers no scoreboard
-- shows:
--
--   EVERY INNINGS OF THE MATCH. It summed ball_event_live over the match,
--     not the innings. From the first ball of the second innings no honest
--     answer verified: a scorer could take over only by typing a match total
--     he was never shown.
--   NO PENALTY RUNS. A `penalty` event (Law 41's five runs) adds to the
--     fold's total (`inn.runs += ev.runs ?? 5`, when `toBattingTeam !==
--     false`), and carries its runs in the payload — toRow() has no column
--     for them, so `value` is NULL. The check read `value` alone, so after a
--     penalty award the fold said n + 5 and the server n, for the rest of the
--     innings. db/43 found this and left it (its "NOT CHANGED", third item).
--
-- WHICH INNINGS. The innings the fold calls current: the highest innings
-- number the match's live log has reached (deriveMatch's `current` is the
-- last of the innings its events are in). match_current_innings() below. The
-- client sends no innings — the sheet asks the scoreboard, which shows one —
-- and none is added: the signature stays as shipped, and the server already
-- holds the answer. It is not "the innings of the highest seq": a ball held
-- in quarantine and released after the second innings began is written into
-- its own innings (the first) at a later seq, and the scoreboard does not go
-- back to the first innings because of it. The same rule broadcast_state()
-- (db/08) reads the board's innings by: "the highest one the log has reached".
--
--   At the break. Once the second innings' innings_start is written, the
--   current innings is the second, at 0/0 off 0 — what the pad of either
--   device shows. Before it (the seal written, the next innings not opened),
--   it is still the first. A scorer who types the first innings' total after
--   the second is opened is refused, and the sheet shows him the figures the
--   server expects; nothing else about a mismatch changes.
--
-- WHAT IS COUNTED, AS THE FOLD COUNTS IT (innings_score_as_folded()):
--
--   runs         a delivery's `value`, plus its one-run penalty when it is a
--                wide or a no-ball (the BALL case) — deliveries only: the fold
--                reads `value` on no other kind; plus, for each `penalty`
--                row, penalty_runs_as_folded(): payload.runs, 5 when it is
--                absent or null (`ev.runs ?? 5`), and nothing when
--                payload.toBattingTeam is JSON false (`!== false` — a missing
--                key, null, or anything but false awards them). An award to
--                the fielding side is not added to this innings or to any
--                other: the fold drops it, and so does this. A payload.runs
--                that is not an integer is a total the fold cannot make
--                either (JavaScript would concatenate a string into it): the
--                innings' runs are then NULL, and no statement verifies.
--   wickets      a delivery that is a wicket that stands (ball_wicket_stands,
--                db/42: the free hit), and a `retire` the fold reads as a
--                dismissal (ball_retirement_dismissal, db/40: retiredOut /
--                timed out). The check used to count any non-delivery row
--                marked W; the fold counts only those. The pad writes no
--                other, so no figure it can produce moves.
--   legal balls  a delivery that is not a wide or a no-ball; a delivery with
--                no type is a run (ball_event_live, db/43).
--
-- Over ball_event_live, so a void and what it names count nothing, as ever.
--
-- NOT CHANGED: match_live_score. It is already per innings (grouped by
-- match and innings) and was never what the check read — the check summed
-- ball_event_live itself. Its runs still omit penalty runs, so the public
-- board, broadcast_state()'s target, the matches read and the summary read
-- are short by a penalty award; whether each of them wants the fold's total
-- is a question about each of them (backlog SCRBRD-090), not about the
-- handover, and this file does not answer it for them.
--
-- REPLACED, from its latest definition (db/42) with the count swapped and
-- the innings added to the mismatch audit row — name, signature, result
-- columns, volatility, parallel label, strictness, security, pinned
-- search_path, owner and grants as they were; the block at the end checks
-- that against a snapshot taken before it is touched:
--
--   scoring_verify_takeover(uuid,text,integer,integer,integer)   db/42
--
-- NEW, each SECURITY INVOKER (a caller reads only what the policies give
-- him; the definer check reads as its owner, as its inline query did):
--
--   match_current_innings(uuid)                     the innings
--   penalty_runs_as_folded(text,jsonb)              one row's penalty runs
--   innings_score_as_folded(uuid,smallint)          runs, wickets, legal balls
--
-- And, outside db/: the reference double of the protocol,
-- services/api/handover/scoring-session.mjs, folded every event as one
-- innings too; replayEvents() now answers for the innings the fold calls
-- current.
--
-- PROVED BY: tools/smoke-handover-innings.mjs (two handovers through the
-- API, in the first innings after a penalty and in the second after one each
-- way — the fold's figures verify, the match's totals and the figures
-- without the penalty are refused) and db/99 §23.

-- ── The shape of what this file replaces, before it does ───────────
-- As db/42's and db/43's: a plain temporary table, dropped at the end.
CREATE TEMP TABLE _db45_before AS
SELECT 'function:' || p.oid::regprocedure::text AS obj,
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
         'language', p.prolang) AS shape
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text = 'scoring_verify_takeover(uuid,text,integer,integer,integer)';

-- ── The rules, in SQL ────────────────────────────────────────────

-- deriveMatch's `current`: the last innings the match's log is in. Over the
-- balls that count, as broadcast_state() reads the board's innings; 0 for a
-- match with nothing scored.
CREATE OR REPLACE FUNCTION match_current_innings(p_match uuid)
RETURNS smallint AS $$
  SELECT coalesce(max(b.innings), 0)::smallint
    FROM ball_event_live b
   WHERE b.match_id = p_match
$$ LANGUAGE sql STABLE PARALLEL SAFE;

-- replay.mjs, the PENALTY case, over fromRow(row) — which spreads the payload
-- into the event, so `ev.runs` and `ev.toBattingTeam` are the payload's:
--
--     if (ev.toBattingTeam !== false) inn.runs += ev.runs ?? 5;
--
-- 0 for every row that is not a penalty, and for one awarded to the fielding
-- side (JSON false, and nothing else, is `false`). NULL when payload.runs is
-- neither absent, null nor an integer: the fold has no number for it.
CREATE OR REPLACE FUNCTION penalty_runs_as_folded(p_kind text, p_payload jsonb)
RETURNS integer AS $$
  SELECT CASE
           WHEN p_kind IS DISTINCT FROM 'penalty'                                  THEN 0
           WHEN coalesce(p_payload->'toBattingTeam', 'null'::jsonb) = 'false'::jsonb THEN 0
           WHEN coalesce(p_payload->'runs', 'null'::jsonb) = 'null'::jsonb          THEN 5
           -- Nested, so the cast is reached only for a JSON number: the
           -- operands of an AND may be evaluated in any order.
           WHEN jsonb_typeof(p_payload->'runs') = 'number' THEN
             CASE WHEN (p_payload->>'runs')::numeric = trunc((p_payload->>'runs')::numeric)
                       AND abs((p_payload->>'runs')::numeric) < 2147483648
                  THEN (p_payload->>'runs')::numeric::integer END
         END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- One innings as the fold totals it: `inn.runs`, `inn.wickets`, `inn.balls`.
-- Zero rows is 0/0 off 0 — an innings nobody has scored in.
CREATE OR REPLACE FUNCTION innings_score_as_folded(p_match uuid, p_innings smallint)
RETURNS TABLE (runs integer, wickets integer, legal_balls integer) AS $$
  SELECT
    CASE WHEN coalesce(bool_and(penalty_runs_as_folded(b.kind, b.payload) IS NOT NULL), true)
         THEN (coalesce(sum(CASE WHEN b.kind <> 'ball'               THEN 0
                                 WHEN b.ball_type IN ('Wd', 'Nb')    THEN 1 + coalesce(b.value, 0)
                                 ELSE coalesce(b.value, 0) END), 0)
               + coalesce(sum(penalty_runs_as_folded(b.kind, b.payload)), 0))::integer
    END,
    count(*) FILTER (WHERE (b.kind = 'ball'
                            AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
                        OR ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL)::integer,
    count(*) FILTER (WHERE b.kind = 'ball' AND b.ball_type NOT IN ('Wd', 'Nb'))::integer
  FROM ball_event_live b
  WHERE b.match_id = p_match AND b.innings = p_innings
$$ LANGUAGE sql STABLE PARALLEL SAFE;

GRANT EXECUTE ON FUNCTION match_current_innings(uuid) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION penalty_runs_as_folded(text, jsonb) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION innings_score_as_folded(uuid, smallint) TO scrbrd_app;

-- ── The handover check (db/42) ───────────────────────────────────
-- From db/42 with the count swapped for this innings' fold and the innings
-- written into the mismatch's audit detail. Nothing else moves: the gates,
-- their order, the refusals and the transfer are as they were.
CREATE OR REPLACE FUNCTION scoring_verify_takeover(
  p_match uuid, p_device text, p_runs int, p_wickets int, p_balls int)
RETURNS TABLE (ok boolean, reason text, epoch integer, exp_runs int, exp_wkts int, exp_balls int) AS $$
DECLARE s scoring_session%ROWTYPE; t_inn smallint; t_runs int; t_wkts int; t_balls int;
BEGIN
  IF NOT app_can('scoring.start', match_school(p_match), match_team(p_match), NULL, p_match)
    THEN RETURN QUERY SELECT false,'no_capability',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;
  -- Completion ends scoring (db/33): a takeover would hand a live token over
  -- a finished match.
  IF EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.status = 'complete')
    THEN RETURN QUERY SELECT false,'match_complete',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;
  SELECT * INTO s FROM scoring_session WHERE match_id = p_match FOR UPDATE;
  IF s.state <> 'verifying' OR s.claimant_device IS DISTINCT FROM p_device
    THEN RETURN QUERY SELECT false,'not_pending',NULL::int,NULL::int,NULL::int,NULL::int; RETURN; END IF;

  -- What the scoreboard shows: the innings being played, counted as the
  -- incoming device's fold counts it — the free hit (db/42), a retirement
  -- (db/40), a ball with no type (db/43) and penalty runs (db/45).
  t_inn := match_current_innings(p_match);
  SELECT f.runs, f.wickets, f.legal_balls INTO t_runs, t_wkts, t_balls
    FROM innings_score_as_folded(p_match, t_inn) f;

  IF (p_runs, p_wickets, p_balls) IS DISTINCT FROM (t_runs, t_wkts, t_balls) THEN
    INSERT INTO scoring_audit (match_id, school_id, event, actor_id, detail)
    VALUES (p_match, match_school(p_match), 'handover_verify_failed', app_user_id(),
            jsonb_build_object('got',jsonb_build_object('runs',p_runs,'wkts',p_wickets,'balls',p_balls),
                               'expected',jsonb_build_object('runs',t_runs,'wkts',t_wkts,'balls',t_balls),
                               'innings',t_inn));
    RETURN QUERY SELECT false,'verify_mismatch',NULL::int, t_runs, t_wkts, t_balls; RETURN;
  END IF;

  UPDATE scoring_session SET state='active', epoch = s.epoch + 1,
    holder_user_id = s.claimant_user_id, holder_device = s.claimant_device,
    lease_until = now() + interval '90 seconds',
    handover_code=NULL, handover_to=NULL, claimant_user_id=NULL, claimant_device=NULL, updated_at=now()
  WHERE match_id = p_match;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, from_user, to_user, epoch)
  VALUES (p_match, match_school(p_match), 'handover_complete', app_user_id(), s.holder_user_id, s.claimant_user_id, s.epoch + 1);
  RETURN QUERY SELECT true, NULL::text, s.epoch + 1, t_runs, t_wkts, t_balls;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── Assertion: nothing but the count moved ─────────────────────────
DO $check$
DECLARE r record; now_shape jsonb; n int; src text;
BEGIN
  SELECT count(*) INTO n FROM _db45_before;
  IF n <> 1 THEN RAISE EXCEPTION 'db/45: expected to snapshot 1 object, found %', n; END IF;
  FOR r IN SELECT * FROM _db45_before LOOP
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
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/45: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;

  -- Still a definer with its search path pinned (db/16): it writes the
  -- session and the audit trail, which its caller cannot.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = 'scoring_verify_takeover(uuid,text,integer,integer,integer)'::regprocedure
                    AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']) THEN
    RAISE EXCEPTION 'db/45: scoring_verify_takeover() is not a definer with its search path pinned';
  END IF;

  -- It asks the innings, and counts it with the fold's helper, not inline.
  SELECT prosrc INTO src FROM pg_proc
   WHERE oid = 'scoring_verify_takeover(uuid,text,integer,integer,integer)'::regprocedure;
  IF src NOT LIKE '%match_current_innings(p_match)%' OR src NOT LIKE '%innings_score_as_folded(p_match, t_inn)%'
     OR src LIKE '%WHERE b.match_id = p_match;%' THEN
    RAISE EXCEPTION 'db/45: scoring_verify_takeover() does not count the current innings through innings_score_as_folded()';
  END IF;

  -- The helpers run as their caller: a reader sees only the innings he may.
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE oid IN ('match_current_innings(uuid)'::regprocedure,
                            'penalty_runs_as_folded(text,jsonb)'::regprocedure,
                            'innings_score_as_folded(uuid,smallint)'::regprocedure)
                AND prosecdef) THEN
    RAISE EXCEPTION 'db/45: a helper runs as its owner';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'match_current_innings(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'penalty_runs_as_folded(text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'innings_score_as_folded(uuid,smallint)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'scoring_verify_takeover(uuid,text,integer,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/45: the application role cannot call the handover check or a helper';
  END IF;

  -- The penalty rule answers as `toBattingTeam !== false ? (runs ?? 5) : 0`.
  IF penalty_runs_as_folded('penalty', '{}') IS DISTINCT FROM 5
     OR penalty_runs_as_folded('penalty', '{"runs": null}') IS DISTINCT FROM 5
     OR penalty_runs_as_folded('penalty', '{"runs": 3, "toBattingTeam": true}') IS DISTINCT FROM 3
     OR penalty_runs_as_folded('penalty', '{"runs": 0}') IS DISTINCT FROM 0
     OR penalty_runs_as_folded('penalty', '{"runs": 5, "toBattingTeam": false}') IS DISTINCT FROM 0
     OR penalty_runs_as_folded('penalty', '{"runs": 5, "toBattingTeam": null}') IS DISTINCT FROM 5
     OR penalty_runs_as_folded('penalty', '{"runs": 5, "toBattingTeam": "false"}') IS DISTINCT FROM 5
     OR penalty_runs_as_folded('penalty', '{"runs": "5"}') IS NOT NULL
     OR penalty_runs_as_folded('penalty', '{"runs": 2.5}') IS NOT NULL
     OR penalty_runs_as_folded('ball', '{"runs": 5}') IS DISTINCT FROM 0
     OR penalty_runs_as_folded(NULL, NULL) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'db/45: penalty_runs_as_folded() is not the fold''s PENALTY case';
  END IF;
END $check$;

DROP TABLE _db45_before;
