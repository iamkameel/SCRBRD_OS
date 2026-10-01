-- ══════════════════════════════════════════════════════════════════
--  71 · The super over (SCRBRD-114 phase 3b)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-114_phase3_results_
-- super_over.md §3, §4 and §7, built to D1–D17 as decided (Kameel,
-- 2026-09-30); §11 there records the build. Phase 3a is db/69.
--
-- A SUPER OVER IS TWO MORE INNINGS IN THE SAME LOG (D1): at the next indexes
-- after the match's own, each opened by an innings_start whose payload
-- carries `superOver: n` (the nth super over, from 1). The key is omitted on
-- every match innings, so nothing already scored reads differently. The
-- fold (packages/scoring: events.mjs, replay.mjs, laws.mjs) is the rule;
-- this file is the same rule over the same rows, and what must NOT count it.
--
-- WHAT IS HERE.
--
--   innings_super_over(payload)       the marker as the fold reads it: a whole
--                                     number from 1, else NULL (superOverNumber()).
--   innings_end_squad(squad, so)      the squad innings_over_reason() is asked
--                                     with, so that two wickets end a super over
--                                     (wicketsToEnd()); the ending stays all_out.
--   innings_super_over_of(m, i)       the marker of one innings, for a trigger.
--   ball_event_innings_start          a partial index: an innings' innings_start,
--                                     found without reading its balls.
--   ball_event_live.super_over        a new LAST column: the innings' super over,
--                                     from its last innings_start (the fold's:
--                                     the last one stands), NULL for a match innings.
--   ball_event_career                 ball_event_live WHERE super_over IS NULL:
--                                     the log as a career reads it (D6). One
--                                     place says "never", and every career
--                                     reader below reads it.
--   penalty_credit_as_folded()        db/48's and db/69's, with penalty runs to a
--   penalty_carried_as_folded()       fielding side moving only within their pair
--                                     (penaltyCredits(), §3.2): an award in
--                                     innings 2 lands in innings 3 or nowhere.
--   innings_result_state()            db/69's, with the two-wicket end.
--   match_result_compute()            db/69's, reading the match's outcome from
--                                     its own innings alone (D7) and, where the
--                                     document provides a super over and the
--                                     match is tied, its pairs: `super_overs`,
--                                     `decided_by = super_over` and the winner
--                                     for the first won; NULL for a tie nothing
--                                     has settled. NRR's `scheduled` innings are
--                                     the match's own (§6.4).
--   match_live_score.super_over       a new LAST column, for the board's block.
--   the career readers (§4, "never") re-emitted over ball_event_career, each
--                                     otherwise exactly as its latest file has
--                                     it: db/64's thirteen views and functions
--                                     and opposition_squad(); bowler_hat_trick
--                                     (db/54); keeper_dismissal and
--                                     player_keeping_career (db/68);
--                                     innings_runs_off_bat() and
--                                     career_runs_off_bat() (db/51);
--                                     public_shot_sectors() (db/59);
--                                     opposition_context() (db/08).
--   milestone_watch()                 db/51's, returning first on a super over's
--                                     ball: no milestone is ever one (§4).
--   match_completion_refusal(m)       db/33's gate, taught the super over
--   match_completion_gate (trigger)   (§3.4): a tied match whose document
--                                     provides a super over is not marked
--                                     complete while nothing has settled who
--                                     goes through — no pair won, none left
--                                     incomplete, no decision.
--
-- WHAT STILL COUNTS IT (§4, "yes"): the scorecard, the live score, the
-- public log and the result read ball_event_live, as they did; the workload
-- record — bowler_over, bowler_spell, load_day, bowling_breach_watch() — is
-- untouched and counts a super over's balls: the boy bowled them (D5, D6).
--
-- NOT HERE. The Laws' refusals and the write path's super_over_not_provided
-- (D10) are packages/scoring/src/laws.mjs and services/api/write/
-- events-api.mjs; the readers in the API (phases, matchups, the ratings'
-- evidence, a player's shot points, the head-to-head) gain the same filter
-- there. Progression is phase 3c (db/72).
--
-- RLS. Nothing new is granted beyond SELECT on ball_event_career, which is
-- security_invoker over ball_event_live: a reader sees the career rows of the
-- log he may read, no more. Every re-emitted object keeps its owner, options,
-- columns and grants (checked at the end against a snapshot taken first);
-- the definers keep their pinned search_path.

-- ── 0 · The shape of everything replaced, before it is ──────────────
DROP TABLE IF EXISTS _db71_before;
CREATE TEMP TABLE _db71_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]), 'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('ball_event_live', 'match_live_score',
                     'player_innings', 'player_batting_career', 'player_bowling_career', 'player_dismissals',
                     'player_dismissal_breakdown', 'player_batting_by_season', 'player_bowling_by_season',
                     'player_dismissals_by_season', 'bowler_innings_figures', 'player_wicket_breakdown',
                     'bowler_hat_trick', 'keeper_dismissal', 'player_keeping_career')
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel, 'strict', p.proisstrict,
         'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
         'language', p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text IN ('player_batting_since(uuid,timestamp with time zone)',
                                     'player_bowling_since(uuid,timestamp with time zone)',
                                     'player_dismissals_since(uuid,timestamp with time zone)',
                                     'opposition_squad(uuid)', 'opposition_context(uuid)',
                                     'innings_runs_off_bat(uuid,uuid,smallint)', 'career_runs_off_bat(uuid)',
                                     'public_shot_sectors(uuid)', 'milestone_watch()',
                                     'penalty_credit_as_folded(uuid,smallint)', 'penalty_carried_as_folded(uuid,smallint)',
                                     'innings_result_state(uuid,smallint,jsonb,boolean)', 'match_result_compute(uuid)');

-- ── 1 · The marker, in SQL ───────────────────────────────────────────

-- superOverNumber() (events.mjs): a whole number from 1, else NULL. A
-- number past a smallint is no super over anyone plays.
CREATE OR REPLACE FUNCTION innings_super_over(p_payload jsonb) RETURNS smallint AS $$
  SELECT CASE WHEN jsonb_typeof(p_payload->'superOver') = 'number'
               AND (p_payload->>'superOver')::numeric = trunc((p_payload->>'superOver')::numeric)
               AND (p_payload->>'superOver')::numeric BETWEEN 1 AND 32767
              THEN (p_payload->>'superOver')::numeric::smallint END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- wicketsToEnd() (replay.mjs), as the squad innings_over_reason() (db/69) is
-- asked with: in a super over, at most three — the squad less one, at most
-- two — so that the loss of two wickets ends it, as the standard condition
-- says; anything else as it was.
CREATE OR REPLACE FUNCTION innings_end_squad(p_squad integer, p_super_over smallint) RETURNS integer AS $$
  SELECT CASE WHEN p_super_over IS NULL THEN p_squad ELSE least(coalesce(nullif(p_squad, 0), 11), 3) END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- An innings' innings_start, found without reading its balls: the career
-- readers ask ball_event_live.super_over of every delivery.
CREATE INDEX IF NOT EXISTS ball_event_innings_start ON ball_event (match_id, innings, seq) WHERE kind = 'innings_start';

-- One innings' marker, for a trigger that has a row and not the view: its
-- last innings_start that counts, as ball_event_live.super_over reads it.
-- Runs as its caller.
CREATE OR REPLACE FUNCTION innings_super_over_of(p_match uuid, p_innings smallint) RETURNS smallint AS $$
  SELECT innings_super_over(s.payload)
    FROM ball_event s
   WHERE s.match_id = p_match AND s.innings = p_innings AND s.kind = 'innings_start'
     AND NOT EXISTS (SELECT 1 FROM ball_event v
                      WHERE v.match_id = s.match_id AND v.kind = 'void' AND v.payload->>'target' = s.idempotency_key)
   ORDER BY s.seq DESC LIMIT 1
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION innings_super_over_of(uuid, smallint) FROM PUBLIC;

-- The live log, with each row's super over as its last column. Every column
-- before it, and the rule for which rows are live, as db/53 left them.
CREATE OR REPLACE VIEW ball_event_live WITH (security_invoker = true) AS
SELECT b.id, b.match_id, b.school_id, b.seq, b.epoch, b.innings,
       b.scorer_user_id, b.device_id, b.idempotency_key, b.client_seq, b.client_ts, b.server_ts,
       b.kind,
       CASE WHEN b.kind = 'retire' AND b.ball_type = 'W'
                 AND retirement_resumed(b.match_id, b.innings, b.seq, b.payload->>'batter') THEN NULL
            ELSE ball_type_as_folded(b.kind, b.ball_type) END AS ball_type,
       b.value, b.shot, b.contact, b.trajectory, b.seg, b.zone,
       b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id,
       CASE WHEN b.kind = 'retire' AND b.ball_type = 'W'
                 AND retirement_resumed(b.match_id, b.innings, b.seq, b.payload->>'batter') THEN NULL
            ELSE b.dismissal END AS dismissal,
       b.payload, b.recovered,
       b.theta, b.radius, b.placement_source, b.placement_null, b.close_position, b.capture_profile,
       -- SCRBRD-114 phase 3b (db/71): the nth super over this row's innings is,
       -- from the innings' last innings_start that counts (the fold's: the last
       -- one stands); NULL for a match innings.
       (SELECT innings_super_over(s.payload)
          FROM ball_event s
         WHERE s.match_id = b.match_id AND s.innings = b.innings AND s.kind = 'innings_start'
           AND NOT EXISTS (SELECT 1 FROM ball_event v
                            WHERE v.match_id = s.match_id AND v.kind = 'void' AND v.payload->>'target' = s.idempotency_key)
         ORDER BY s.seq DESC LIMIT 1)                                   AS super_over
  FROM ball_event b
 WHERE b.kind <> 'void'
   -- NOT EXISTS rather than NOT IN, as db/02 explains.
   AND NOT EXISTS (
         SELECT 1 FROM ball_event v
          WHERE v.match_id = b.match_id
            AND v.kind = 'void'
            AND v.payload->>'target' = b.idempotency_key);

-- The log as a career reads it (design §4, D6): never a super over. Run as
-- its reader, as ball_event_live is, so it shows no row its reader may not
-- see there.
CREATE OR REPLACE VIEW ball_event_career WITH (security_invoker = true) AS
SELECT * FROM ball_event_live WHERE super_over IS NULL;
GRANT SELECT ON ball_event_career TO scrbrd_app;

-- ── 2 · The fold's figures and the result ────────────────────────────
-- penaltyCredits() within a pair (§3.2): the match's own innings are one
-- pair and each super over another (their `so`, NULL for the match's own),
-- and an award to a fielding side moves only inside its own. A match with no
-- super over is one pair, exactly as before.
CREATE OR REPLACE FUNCTION penalty_credit_as_folded(p_match uuid, p_innings smallint)
RETURNS integer AS $$
  WITH inns AS (
    SELECT b.innings, max(b.super_over) AS so,   -- db/71: the pair it belongs to
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
           coalesce((SELECT max(r.innings) FROM inns r WHERE r.innings < a.innings AND r.batting_side = a.fielding_side AND r.so IS NOT DISTINCT FROM a.so),
                    (SELECT min(r.innings) FROM inns r WHERE r.innings > a.innings AND r.batting_side = a.fielding_side AND r.so IS NOT DISTINCT FROM a.so))
             AS to_innings
      FROM inns a
     WHERE a.fielding_side IS NOT NULL AND (a.unknown OR a.awarded <> 0)
  )
  SELECT CASE WHEN coalesce(bool_or(g.unknown), false) THEN NULL
              ELSE coalesce(sum(g.awarded), 0)::integer END
    FROM goes g
   WHERE g.to_innings = p_innings
$$ LANGUAGE sql STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION penalty_carried_as_folded(p_match uuid, p_innings smallint)
RETURNS integer AS $$
  WITH inns AS (
    SELECT b.innings, max(b.super_over) AS so,   -- db/71: the pair it belongs to
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
    SELECT a.innings AS from_innings, a.awarded, a.unknown,
           coalesce((SELECT max(r.innings) FROM inns r WHERE r.innings < a.innings AND r.batting_side = a.fielding_side AND r.so IS NOT DISTINCT FROM a.so),
                    (SELECT min(r.innings) FROM inns r WHERE r.innings > a.innings AND r.batting_side = a.fielding_side AND r.so IS NOT DISTINCT FROM a.so))
             AS to_innings
      FROM inns a
     WHERE a.fielding_side IS NOT NULL AND (a.unknown OR a.awarded <> 0)
  )
  SELECT CASE WHEN coalesce(bool_or(g.unknown), false) THEN NULL
              ELSE coalesce(sum(g.awarded), 0)::integer END
    FROM goes g
   WHERE g.to_innings = p_innings AND g.from_innings < p_innings
$$ LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION innings_result_state(p_match uuid, p_innings smallint, p_play jsonb, p_fourth boolean)
RETURNS TABLE (runs integer, wickets integer, balls integer, overs integer, target integer,
               complete boolean, end_reason text, sealed boolean, penalty_win boolean,
               team_key text, batting_team text, squad_size integer, revised boolean, summarised boolean) AS $$
DECLARE
  e         record;
  v_runs    integer;
  v_wk      integer := 0;
  v_balls   integer := 0;
  v_overs   integer := 20;      -- the fold's before any innings_start: 20
  v_target  integer;
  v_typed   boolean := false;   -- the umpires' target: an award does not move it
  v_squad   integer := 0;
  v_done    boolean := false;
  v_reason  text;
  v_sealed  boolean := false;
  v_pwin    boolean := false;
  v_key     text;
  v_bat     text;
  v_rev     boolean := false;
  v_summ    boolean := false;
  v_carried integer;
  v_award   integer;
  v_ended   text;
  v_c       jsonb;
  v_so      smallint;           -- db/71: the nth super over, or NULL
BEGIN
  v_carried := penalty_carried_as_folded(p_match, p_innings);
  v_runs := v_carried;
  FOR e IN SELECT b.seq, b.kind, b.ball_type, b.value, b.dismissal, b.payload
             FROM ball_event_live b
            WHERE b.match_id = p_match AND b.innings = p_innings
            ORDER BY b.seq
  LOOP
    IF e.kind = 'innings_start' THEN
      v_bat := e.payload->>'battingTeam';
      v_key := coalesce(e.payload->>'teamKey', e.payload->>'battingTeam');
      v_squad := CASE WHEN jsonb_typeof(e.payload->'squad') = 'array' THEN jsonb_array_length(e.payload->'squad') ELSE 0 END;
      -- oversPerInnings(): the innings_start's own, else the document's, else 20.
      v_overs := play_overs(p_play, CASE WHEN jsonb_typeof(e.payload->'overs') = 'number'
                                              AND (e.payload->>'overs')::numeric = trunc((e.payload->>'overs')::numeric)
                                         THEN (e.payload->>'overs')::numeric::integer END);
      v_target := CASE WHEN jsonb_typeof(e.payload->'target') = 'number' THEN (e.payload->>'target')::numeric::integer END;
      v_typed := false;
      v_so := innings_super_over(e.payload);
    ELSIF e.kind = 'revision' THEN
      IF jsonb_typeof(e.payload->'overs') = 'number' THEN v_overs := (e.payload->>'overs')::numeric::integer; END IF;
      IF jsonb_typeof(e.payload->'target') = 'number' THEN
        v_target := (e.payload->>'target')::numeric::integer; v_typed := true;
      END IF;
      v_rev := true;
    ELSIF e.kind = 'penalty' THEN
      IF coalesce(e.payload->'toBattingTeam', 'null'::jsonb) IS DISTINCT FROM 'false'::jsonb THEN
        -- Law 16.7 (4th Edition): a chase completed short, made enough by an
        -- award to it, is won "by penalty runs".
        v_award := penalty_runs_as_folded(e.kind, e.payload);
        v_ended := CASE WHEN p_fourth AND v_target IS NOT NULL AND v_runs < v_target
                        THEN innings_over_reason(v_runs, v_wk, v_balls, v_overs, v_target, innings_end_squad(v_squad, v_so)) END;
        v_runs := v_runs + v_award;
        IF v_ended IN ('all_out', 'overs_complete') AND v_target IS NOT NULL AND v_runs >= v_target THEN v_pwin := true; END IF;
      ELSE
        v_award := penalty_to_fielding_as_folded(e.kind, e.payload);
        IF v_target IS NOT NULL AND NOT v_typed THEN v_target := v_target + v_award; END IF;
        -- 4th Edition (Law 41.17.2, 16.6.1): an award that lifts the target
        -- past a chase sealed as reached reopens it.
        IF p_fourth AND v_sealed AND v_reason = 'target_reached' AND v_target IS NOT NULL AND v_runs < v_target THEN
          v_sealed := false; v_done := false; v_reason := NULL;
        END IF;
      END IF;
    ELSIF e.kind = 'ball' THEN
      v_runs := v_runs + CASE WHEN e.ball_type IN ('Wd', 'Nb') THEN 1 + coalesce(e.value, 0) ELSE coalesce(e.value, 0) END;
      IF ball_wicket_stands(p_match, p_innings, e.seq, e.kind, e.ball_type, e.dismissal) THEN v_wk := v_wk + 1; END IF;
      IF ball_counts_in_over(e.ball_type, e.payload) THEN v_balls := v_balls + 1; END IF;
    ELSIF e.kind = 'retire' THEN
      IF ball_retirement_dismissal(e.kind, e.ball_type, e.dismissal, e.payload) IS NOT NULL THEN v_wk := v_wk + 1; END IF;
    ELSIF e.kind = 'innings_summary' THEN
      -- A scorebook card (db/63): its figures, on whatever it opened on.
      v_c := e.payload->'card';
      IF jsonb_typeof(v_c) = 'object' AND scorebook_is_count(v_c->'total') AND scorebook_is_count(v_c->'wickets')
         AND scorebook_balls(v_c->'overs') IS NOT NULL THEN
        v_runs := v_carried + (v_c->>'total')::integer;
        v_wk := (v_c->>'wickets')::integer;
        v_balls := scorebook_balls(v_c->'overs');
        v_summ := true;
      END IF;
    ELSIF e.kind = 'innings_end' THEN
      -- sealRefusal(): the figures read back are the log's at this point, a
      -- reason is given, and an ending the Laws derive is the one they derive.
      v_c := e.payload->'confirmed';
      IF jsonb_typeof(v_c) = 'object'
         AND jsonb_typeof(v_c->'runs') = 'number' AND jsonb_typeof(v_c->'wickets') = 'number' AND jsonb_typeof(v_c->'balls') = 'number'
         AND (v_c->>'runs')::numeric = v_runs AND (v_c->>'wickets')::numeric = v_wk AND (v_c->>'balls')::numeric = v_balls
         AND e.payload->>'reason' IS NOT NULL
         AND (e.payload->>'reason' NOT IN ('all_out', 'overs_complete', 'target_reached')
              OR e.payload->>'reason' = innings_over_reason(v_runs, v_wk, v_balls, v_overs, v_target, innings_end_squad(v_squad, v_so))) THEN
        v_sealed := true; v_done := true; v_reason := e.payload->>'reason';
      END IF;
    END IF;
  END LOOP;
  -- settleInnings(): over when the Laws say so, sealed or not.
  IF NOT v_done THEN
    v_ended := innings_over_reason(v_runs, v_wk, v_balls, v_overs, v_target, innings_end_squad(v_squad, v_so));
    IF v_ended IS NOT NULL THEN v_done := true; v_reason := v_ended; END IF;
  END IF;
  -- penaltyCredits()'s `added`: awards made later, after the last event.
  v_runs := v_runs + (penalty_credit_as_folded(p_match, p_innings) - v_carried);
  RETURN QUERY SELECT v_runs, v_wk, v_balls, v_overs, v_target, v_done, v_reason, v_sealed, v_pwin,
                      v_key, v_bat, v_squad, v_rev, v_summ;
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION match_result_compute(p_match uuid)
RETURNS TABLE (match_id uuid, outcome text, margin_kind text, margin integer, decided_by text,
               winner_side text, winner_school_id uuid, winner_team_code text, winner_key text,
               super_overs jsonb, decision jsonb, decision_applied boolean,
               play_outcome text, play_winner_side text, play_winner_key text, play_margin_kind text, play_margin integer,
               innings jsonb, result_hash text) AS $$
DECLARE
  m        match%ROWTYPE;
  d        record;
  s        record;
  i        record;
  v_play   jsonb;
  v_fourth boolean;
  v_ips    integer;
  v_inns   jsonb := '[]';
  v_n      integer := 0;
  v_key0   text;
  v_other  text;
  v_side0  text;
  v_home   text;
  v_away   text;
  -- play's answer
  p_out    text := 'in_progress';
  p_kind   text;
  p_margin integer;
  p_side   text;
  p_key    text;
  x0 jsonb; x1 jsonb; x2 jsonb; x3 jsonb; win jsonb; oth jsonb;
  v_t      integer;
  v_least  jsonb;
  v_lead   integer;
  -- the answer
  r_out    text;
  r_kind   text;
  r_margin integer;
  r_side   text;
  r_key    text;
  r_by     text;
  r_dec    jsonb;
  r_applied boolean := false;
  r_school uuid;
  r_team   text;
  -- db/71: the super overs
  v_m      integer := 0;     -- the match's own innings so far
  v_mi     jsonb;            -- the match's own innings, in order
  v_sos    jsonb := '[]';    -- the super overs, as describeResult() lists them
  v_so_applies boolean := false;
  v_so_by  text;
  v_so_n   integer;
  v_so_settled boolean := false;
  sa jsonb; sb jsonb; v_st text; v_ws text; v_wk text; v_so_t integer;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND THEN RETURN; END IF;
  -- The frozen play part only: a preview never decides a logged match.
  v_play := coalesce((SELECT c.doc->'play' FROM match_conditions c WHERE c.match_id = p_match), '{}'::jsonb);
  v_fourth := (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date >= DATE '2026-10-01';
  v_ips := CASE WHEN v_play->'format.innings_per_side' = '2'::jsonb THEN 2 ELSE 1 END;
  v_home := coalesce(m.team_code, 'Home');
  v_away := m.opponent;

  -- The innings in the order of their numbers (deriveMatch() compacts).
  -- (db/71) Each innings carries its super over, NULL for the match's own;
  -- only the match's own are `scheduled` (net run rate reads no other, §6.4).
  FOR i IN SELECT b.innings, max(b.super_over) AS so FROM ball_event_live b WHERE b.match_id = p_match
            GROUP BY b.innings ORDER BY b.innings LOOP
    SELECT * INTO s FROM innings_result_state(p_match, i.innings, v_play, v_fourth);
    v_inns := v_inns || jsonb_build_array(jsonb_build_object(
      'innings', i.innings, 'position', v_n, 'scheduled', i.so IS NULL AND v_m < 2 * v_ips, 'super_over', i.so,
      'runs', s.runs, 'wickets', s.wickets, 'balls', s.balls, 'overs', s.overs, 'target', s.target,
      'complete', s.complete, 'end_reason', s.end_reason, 'sealed', s.sealed, 'penalty_win', s.penalty_win,
      'key', s.team_key, 'batting_team', s.batting_team, 'squad', s.squad_size, 'revised', s.revised, 'summarised', s.summarised));
    v_n := v_n + 1;
    IF i.so IS NULL THEN v_m := v_m + 1; END IF;
  END LOOP;

  -- Which side bats each innings: by name; else the other of the first other
  -- side named; else home. An innings whose key is not the first's is the
  -- other side's.
  -- (db/71) Over the match's own innings: a super over's are the same sides.
  v_mi := coalesce((SELECT jsonb_agg(y.value ORDER BY y.n) FROM jsonb_array_elements(v_inns) WITH ORDINALITY y(value, n)
                     WHERE y.value->'super_over' = 'null'::jsonb), '[]'::jsonb);
  v_key0 := v_mi->0->>'key';
  SELECT y.value->>'key' INTO v_other FROM jsonb_array_elements(v_mi) WITH ORDINALITY y(value, n)
   WHERE y.value->>'key' IS NOT NULL AND NOT result_key_eq(y.value->>'key', v_key0) ORDER BY y.n LIMIT 1;
  v_side0 := coalesce(CASE WHEN result_key_eq(v_key0, v_home) THEN 'home' WHEN result_key_eq(v_key0, v_away) THEN 'away' END,
                      CASE WHEN result_key_eq(v_other, v_home) THEN 'away' WHEN result_key_eq(v_other, v_away) THEN 'home' END,
                      'home');
  SELECT jsonb_agg(y.value || jsonb_build_object('side',
           CASE WHEN result_key_eq(y.value->>'key', v_key0) THEN v_side0 WHEN v_side0 = 'home' THEN 'away' ELSE 'home' END) ORDER BY y.n)
    INTO v_inns FROM jsonb_array_elements(v_inns) WITH ORDINALITY y(value, n);
  v_inns := coalesce(v_inns, '[]'::jsonb);
  -- (db/71) The match's outcome is read from its own innings alone (D7).
  v_mi := coalesce((SELECT jsonb_agg(y.value ORDER BY y.n) FROM jsonb_array_elements(v_inns) WITH ORDINALITY y(value, n)
                     WHERE y.value->'super_over' = 'null'::jsonb), '[]'::jsonb);
  x0 := v_mi->0; x1 := v_mi->1; x2 := v_mi->2; x3 := v_mi->3;

  IF v_ips = 2 THEN
    -- Two innings a side (D11).
    IF (x0->>'complete')::boolean AND (x1->>'complete')::boolean AND (x2->>'complete')::boolean AND x2->>'end_reason' = 'all_out' THEN
      SELECT sum(CASE WHEN result_key_eq(y->>'key', x2->>'key') THEN -(y->>'runs')::integer ELSE (y->>'runs')::integer END)
        INTO v_lead FROM jsonb_array_elements(jsonb_build_array(x0, x1, x2)) y;
      SELECT y INTO oth FROM jsonb_array_elements(jsonb_build_array(x0, x1, x2)) WITH ORDINALITY t(y, n)
       WHERE NOT result_key_eq(y->>'key', x2->>'key') ORDER BY t.n LIMIT 1;
      IF oth IS NOT NULL AND v_lead > 0 THEN
        p_out := 'win'; win := oth; p_kind := 'innings'; p_margin := v_lead;
      END IF;
    END IF;
    IF p_out = 'in_progress' AND (x3->>'complete')::boolean AND x3->>'end_reason' IS DISTINCT FROM 'abandoned' THEN
      SELECT y INTO oth FROM jsonb_array_elements(jsonb_build_array(x0, x1, x2)) WITH ORDINALITY t(y, n)
       WHERE NOT result_key_eq(y->>'key', x3->>'key') ORDER BY t.n LIMIT 1;
      v_t := coalesce((x3->>'target')::integer,
                      (SELECT sum(CASE WHEN result_key_eq(y->>'key', x3->>'key') THEN -(y->>'runs')::integer ELSE (y->>'runs')::integer END)
                         FROM jsonb_array_elements(jsonb_build_array(x0, x1, x2)) y) + 1);
      IF (x3->>'runs')::integer >= v_t THEN
        p_out := 'win'; win := x3;
        IF (x3->>'penalty_win')::boolean THEN p_kind := 'penalty_runs'; p_margin := NULL;
        ELSE p_kind := 'wickets';
             p_margin := least(10, coalesce(nullif((x3->>'squad')::integer, 0), 11) - 1) - (x3->>'wickets')::integer; END IF;
      ELSIF x3->>'end_reason' = 'all_out' AND oth IS NOT NULL THEN
        IF v_t - 1 - (x3->>'runs')::integer > 0 THEN
          p_out := 'win'; win := oth; p_kind := 'runs'; p_margin := v_t - 1 - (x3->>'runs')::integer;
        ELSE p_out := 'tie'; END IF;
      END IF;
    END IF;
    IF p_out = 'in_progress' AND m.status = 'complete' THEN p_out := 'draw'; END IF;
  ELSE
    -- One innings a side: the second is the chase.
    IF x0 IS NULL OR x1 IS NULL OR NOT (x1->>'complete')::boolean THEN
      p_out := CASE WHEN m.status = 'complete' THEN 'no_result' ELSE 'in_progress' END;
    ELSIF x1->>'end_reason' = 'abandoned' THEN
      p_out := 'no_result';
    ELSE
      v_t := coalesce((x1->>'target')::integer, (x0->>'runs')::integer + 1);
      v_least := v_play->'result.min_overs_per_side';
      IF (x1->>'runs')::integer >= v_t THEN
        p_out := 'win'; win := x1;
        IF (x1->>'penalty_win')::boolean THEN p_kind := 'penalty_runs'; p_margin := NULL;
        ELSE p_kind := 'wickets';
             p_margin := least(10, coalesce(nullif((x1->>'squad')::integer, 0), 11) - 1) - (x1->>'wickets')::integer; END IF;
      ELSIF jsonb_typeof(v_least) = 'number' AND (v_least #>> '{}')::numeric = trunc((v_least #>> '{}')::numeric)
            AND (v_least #>> '{}')::numeric > 0 AND (x1->>'overs')::integer < (v_least #>> '{}')::numeric
            AND x1->>'end_reason' = 'overs_complete' THEN
        p_out := 'no_result';
      ELSIF v_t - 1 - (x1->>'runs')::integer > 0 THEN
        p_out := 'win'; win := x0; p_kind := 'runs'; p_margin := v_t - 1 - (x1->>'runs')::integer;
      ELSE
        p_out := 'tie';
      END IF;
    END IF;
  END IF;
  IF p_out = 'win' THEN
    p_side := win->>'side'; p_key := win->>'key';
    p_out := CASE p_side WHEN 'home' THEN 'home_win' WHEN 'away' THEN 'away_win' END;
  END IF;
  -- The organiser's status: a match abandoned with no result is abandoned.
  IF m.status = 'abandoned' AND p_out NOT IN ('home_win', 'away_win', 'tie', 'draw') THEN
    p_out := 'abandoned'; p_kind := NULL; p_margin := NULL; p_side := NULL; p_key := NULL;
  END IF;

  -- ── db/71 · the super overs (design §2.2, §3.2, §3.6; D7) ──
  -- describeResult(), line for line: only where the match's document provides
  -- one (result.tie_break = super_over, one innings a side) and the match is
  -- tied. Each pair is won, tied or incomplete (pairState()); the first that
  -- is not tied settles it — a pair won names who goes through, anything else
  -- leaves it to nobody until the organiser's award. The match's outcome
  -- stays the tie the table reads. A super over the document does not
  -- provide (the write path refuses one, D10) is listed nowhere.
  IF p_out = 'tie' AND v_play->'result.tie_break' = '"super_over"'::jsonb AND v_ips = 1 THEN
    v_so_applies := true;
    FOR v_so_n IN SELECT DISTINCT (y->>'super_over')::integer FROM jsonb_array_elements(v_inns) y
                   WHERE y->'super_over' <> 'null'::jsonb ORDER BY 1 LOOP
      SELECT t.y INTO sa FROM jsonb_array_elements(v_inns) WITH ORDINALITY t(y, n)
       WHERE (t.y->>'super_over')::integer = v_so_n ORDER BY t.n LIMIT 1;
      SELECT t.y INTO sb FROM jsonb_array_elements(v_inns) WITH ORDINALITY t(y, n)
       WHERE (t.y->>'super_over')::integer = v_so_n ORDER BY t.n OFFSET 1 LIMIT 1;
      v_ws := NULL; v_wk := NULL;
      IF sb IS NULL OR NOT (sa->>'complete')::boolean OR NOT (sb->>'complete')::boolean
         OR coalesce(sa->>'end_reason', '') = 'abandoned' OR coalesce(sb->>'end_reason', '') = 'abandoned' THEN
        v_st := 'incomplete';
      ELSE
        v_so_t := coalesce((sb->>'target')::integer, (sa->>'runs')::integer + 1);
        IF (sb->>'runs')::integer >= v_so_t THEN v_st := 'won'; v_ws := sb->>'side'; v_wk := sb->>'key';
        ELSIF (sb->>'runs')::integer = v_so_t - 1 THEN v_st := 'tied';
        ELSE v_st := 'won'; v_ws := sa->>'side'; v_wk := sa->>'key';
        END IF;
      END IF;
      v_sos := v_sos || jsonb_build_array(jsonb_build_object(
        'n', v_so_n, 'first', sa->>'side',
        'a', jsonb_build_object('runs', (sa->>'runs')::integer, 'wickets', (sa->>'wickets')::integer, 'balls', (sa->>'balls')::integer),
        'b', CASE WHEN sb IS NOT NULL
                  THEN jsonb_build_object('runs', (sb->>'runs')::integer, 'wickets', (sb->>'wickets')::integer, 'balls', (sb->>'balls')::integer) END,
        'state', v_st, 'winner', v_ws, 'winner_key', v_wk));
      IF NOT v_so_settled THEN
        IF v_st = 'won' THEN v_so_by := 'super_over'; p_side := v_ws; p_key := v_wk; v_so_settled := true;
        ELSIF v_st <> 'tied' THEN v_so_settled := true;
        END IF;
      END IF;
    END LOOP;
  END IF;


  -- The decision, read last (result.mjs applyDecision()).
  r_out := p_out; r_kind := p_kind; r_margin := p_margin; r_side := p_side; r_key := p_key;
  r_by := CASE WHEN v_so_applies THEN v_so_by WHEN p_out IN ('home_win', 'away_win', 'tie', 'draw') THEN 'play' END;
  SELECT x.* INTO d FROM match_result_decision x WHERE x.match_id = p_match AND x.withdrawn_at IS NULL;
  IF FOUND THEN
    r_dec := jsonb_build_object('id', d.id, 'kind', d.kind, 'side', d.side, 'overrides_play', d.overrides_play,
                                'reason', d.reason, 'by', d.decided_by, 'at', d.decided_at);
    IF d.kind = 'awarded' AND d.overrides_play THEN
      r_out := d.side || '_win'; r_kind := 'awarded'; r_margin := NULL; r_side := d.side; r_key := NULL;
      r_by := 'decision'; r_applied := true;
    ELSIF p_out IN ('home_win', 'away_win') OR r_by = 'super_over' THEN
      NULL;   -- play, or (db/71) a super over, named a winner: it stands, the decision is shown beside it
    ELSIF d.kind = 'conceded' THEN
      r_side := CASE d.side WHEN 'home' THEN 'away' ELSE 'home' END;
      r_out := r_side || '_win'; r_kind := 'conceded'; r_margin := NULL; r_key := NULL; r_by := 'decision'; r_applied := true;
    ELSIF d.kind = 'walkover' THEN
      r_side := d.side;
      r_out := r_side || '_win'; r_kind := 'walkover'; r_margin := NULL; r_key := NULL; r_by := 'decision'; r_applied := true;
    ELSIF d.kind = 'awarded' THEN
      -- Who goes through; the match's own outcome stands for the table.
      r_side := d.side; r_key := NULL; r_by := 'decision'; r_applied := true;
    END IF;
  END IF;
  IF r_side = 'home' THEN r_school := m.school_id; r_team := m.team_code;
  ELSIF r_side = 'away' THEN r_school := m.away_school_id; r_team := m.away_team_code; END IF;

  RETURN QUERY SELECT p_match, r_out, r_kind, r_margin, r_by, r_side, r_school, r_team, r_key,
    v_sos, r_dec, r_applied, p_out, p_side, p_key, p_kind, p_margin, v_inns,
    md5(concat_ws('|', r_out, coalesce(r_kind, '-'), coalesce(r_margin::text, '-'), coalesce(r_by, '-'),
                  coalesce(r_side, '-'), coalesce(r_school::text, '-'), coalesce(r_team, '-')));
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;

-- ── 3 · The live score says which innings are a super over (§4) ──────
-- db/63's, with super_over as its last column: the board and the scorecard
-- show "Super over 1" over the pair's two lines.
CREATE OR REPLACE VIEW match_live_score WITH (security_invoker = true) AS
SELECT
  match_id,
  innings,
  CASE WHEN bool_or(kind = 'innings_summary')
       THEN ((array_agg(payload->'card' ORDER BY seq DESC) FILTER (WHERE kind = 'innings_summary'))[1]->>'total')::integer
            + penalty_credit_as_folded(match_id, innings)
       WHEN bool_and(penalty_runs_as_folded(kind, payload) IS NOT NULL)
       THEN sum(CASE WHEN kind <> 'ball'               THEN 0
                     WHEN ball_type IN ('Wd','Nb')    THEN 1 + coalesce(value,0)
                     ELSE coalesce(value,0) END)
            + sum(penalty_runs_as_folded(kind, payload))
            + penalty_credit_as_folded(match_id, innings)
  END                                                                     AS runs,
  CASE WHEN bool_or(kind = 'innings_summary')
       THEN ((array_agg(payload->'card' ORDER BY seq DESC) FILTER (WHERE kind = 'innings_summary'))[1]->>'wickets')::integer
       ELSE sum(CASE WHEN (kind = 'ball' AND ball_wicket_stands(match_id, innings, seq, kind, ball_type, dismissal))
                          OR ball_retirement_dismissal(kind, ball_type, dismissal, payload) IS NOT NULL
                     THEN 1 ELSE 0 END)
  END                                                                     AS wickets,
  CASE WHEN bool_or(kind = 'innings_summary')
       THEN scorebook_balls((array_agg(payload->'card' ORDER BY seq DESC) FILTER (WHERE kind = 'innings_summary'))[1]->'overs')
       ELSE sum(CASE WHEN kind='ball' AND ball_counts_in_over(ball_type, payload) THEN 1 ELSE 0 END)
  END                                                                     AS legal_balls,
  max(seq)                                                                AS last_seq,
  max(server_ts)                                                          AS last_ball_at,
  max(super_over)                                                         AS super_over   -- db/71
FROM ball_event_live
GROUP BY match_id, innings;

-- ── 4 · Careers never count a super over (§4, D6) ───────────────────
-- Every reader of the list, as its latest file has it, with its reads of
-- the log through ball_event_career: no run, ball, wicket, dismissal,
-- catch, hat-trick or sector of a super over in any career, season,
-- window, dossier or public wheel. db/64's summary branches are untouched
-- (a book has no super over). The rows each reads are otherwise the same.
-- player_innings: db/64's, its 3 reads of the log now ball_event_career.
CREATE OR REPLACE VIEW player_innings WITH (security_invoker = true) AS
SELECT
  x.player_id,
  x.match_id,
  x.innings,
  max(x.server_ts)                     AS ended_at,
  coalesce(sum(x.runs), 0)             AS runs,
  coalesce(sum(x.balls), 0)            AS balls_faced,
  bool_or(x.out)                       AS out
FROM (
  SELECT b.striker_id AS player_id, b.match_id, b.innings, b.server_ts,
         ball_runs_off_bat(b.ball_type, b.value, b.payload)               AS runs,
         CASE WHEN b.ball_type <> 'Wd' THEN 1 ELSE 0 END                   AS balls,
         (b.ball_type = 'W'
          AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT DISTINCT FROM b.striker_id
          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)) AS out
    FROM ball_event_career b
   WHERE b.kind = 'ball' AND b.striker_id IS NOT NULL
  UNION ALL
  SELECT ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_career b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT NULL
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS DISTINCT FROM b.striker_id
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_career b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.match_id, x.innings
UNION ALL
SELECT s.player_id, s.match_id, s.innings, s.played_at, s.runs::bigint, s.balls::bigint, s.is_dismissal
  FROM summary_batting_line s
 WHERE s.player_id IS NOT NULL;

-- player_batting_career: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW player_batting_career WITH (security_invoker = true) AS
SELECT x.player_id,
       count(DISTINCT x.match_id)                                                 AS matches,
       coalesce(sum(x.runs), 0)                                                   AS runs,
       sum(x.balls)                                                               AS balls_faced,
       sum(x.fours)                                                               AS fours,
       sum(x.sixes)                                                               AS sixes,
       max(x.at)                                                                  AS last_ball_at
  FROM (
    SELECT who.player_id, b.match_id,
           CASE WHEN who.faced THEN ball_runs_off_bat(b.ball_type, b.value, b.payload) ELSE 0 END AS runs,
           CASE WHEN who.faced AND b.ball_type <> 'Wd' THEN 1 ELSE 0 END AS balls,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
           b.server_ts AS at
      FROM ball_event_career b
      -- db/44's three arms, NULLIF'd so a row counts once per player as the
      -- function's OR does (db/49).
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' THEN b.striker_id END, true),
        (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN nullif(ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.striker_id) END, false),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' THEN b.striker_id END), false)
      ) AS who(player_id, faced)
    UNION ALL
    SELECT s.player_id, s.match_id, s.runs, s.balls, s.fours, s.sixes, s.played_at
      FROM summary_batting_line s
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

-- player_batting_by_season: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW player_batting_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT x.player_id,
       ms.season,
       count(DISTINCT x.match_id)                                                 AS matches,
       coalesce(sum(x.runs), 0)                                                   AS runs,
       sum(x.balls)                                                               AS balls_faced,
       sum(x.fours)                                                               AS fours,
       sum(x.sixes)                                                               AS sixes,
       max(x.at)                                                                  AS last_ball_at
  FROM (
    SELECT who.player_id, b.match_id,
           CASE WHEN who.faced THEN ball_runs_off_bat(b.ball_type, b.value, b.payload) ELSE 0 END AS runs,
           CASE WHEN who.faced AND b.ball_type <> 'Wd' THEN 1 ELSE 0 END AS balls,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN who.faced AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
           b.server_ts AS at
      FROM ball_event_career b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' THEN b.striker_id END, true),
        (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN nullif(ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.striker_id) END, false),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' THEN b.striker_id END), false)
      ) AS who(player_id, faced)
    UNION ALL
    SELECT s.player_id, s.match_id, s.runs, s.balls, s.fours, s.sixes, s.played_at
      FROM summary_batting_line s
  ) x
  JOIN match_season ms ON ms.match_id = x.match_id
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id, ms.season;

-- player_batting_since: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE FUNCTION player_batting_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs bigint, balls_faced bigint, fours bigint,
               sixes bigint, last_ball_at timestamptz) AS $$
  SELECT
    count(DISTINCT x.match_id),
    coalesce(sum(x.runs), 0),
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.balls) END,
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.fours) END,
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.sixes) END,
    max(x.at)
  FROM (
    SELECT b.match_id,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player
                THEN ball_runs_off_bat(b.ball_type, b.value, b.payload) ELSE 0 END AS runs,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type <> 'Wd'
                THEN 1 ELSE 0 END AS balls,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END AS fours,
           CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type IN ('run','Nb')
                 AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END AS sixes,
           b.server_ts AS at
      FROM ball_event_career b
     WHERE ((b.kind = 'ball' AND b.striker_id = p_player)
            OR (b.kind = 'ball' AND b.ball_type = 'W'
                AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = p_player
                AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
            OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
       AND (p_from IS NULL OR b.server_ts >= p_from)
    UNION ALL
    SELECT s.match_id, s.runs, s.balls, s.fours, s.sixes, s.played_at
      FROM summary_batting_line s
     WHERE s.player_id = p_player
       AND (p_from IS NULL OR s.played_at >= p_from)
  ) x
$$ LANGUAGE sql STABLE;

-- player_bowling_career: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW player_bowling_career WITH (security_invoker = true) AS
SELECT x.player_id,
       count(DISTINCT x.match_id)                                                 AS matches,
       coalesce(sum(x.runs), 0)                                                   AS runs_conceded,
       coalesce(sum(x.balls), 0)                                                  AS legal_balls,
       sum(x.wides)                                                               AS wides,
       sum(x.no_balls)                                                            AS no_balls,
       coalesce(sum(x.wickets), 0)                                                AS wickets
  FROM (
    SELECT b.bowler_id AS player_id, b.match_id,
           ball_runs_to_bowler(b.ball_type, b.value, b.payload)                   AS runs,
           CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END AS balls,
           CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END                         AS wides,
           CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END                         AS no_balls,
           CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_career b
     WHERE b.kind = 'ball'
    UNION ALL
    SELECT w.player_id, w.match_id, w.runs, w.legal_balls, w.wides, w.no_balls, w.wickets
      FROM summary_bowling_line w
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

-- player_bowling_by_season: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW player_bowling_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT x.player_id,
       ms.season,
       count(DISTINCT x.match_id)                                                 AS matches,
       coalesce(sum(x.runs), 0)                                                   AS runs_conceded,
       coalesce(sum(x.balls), 0)                                                  AS legal_balls,
       sum(x.wides)                                                               AS wides,
       sum(x.no_balls)                                                            AS no_balls,
       coalesce(sum(x.wickets), 0)                                                AS wickets
  FROM (
    SELECT b.bowler_id AS player_id, b.match_id,
           ball_runs_to_bowler(b.ball_type, b.value, b.payload)                   AS runs,
           CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END AS balls,
           CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END                         AS wides,
           CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END                         AS no_balls,
           CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_career b
     WHERE b.kind = 'ball'
    UNION ALL
    SELECT w.player_id, w.match_id, w.runs, w.legal_balls, w.wides, w.no_balls, w.wickets
      FROM summary_bowling_line w
  ) x
  JOIN match_season ms ON ms.match_id = x.match_id
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id, ms.season;

-- player_bowling_since: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE FUNCTION player_bowling_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs_conceded bigint, legal_balls bigint, wides bigint, no_balls bigint, wickets bigint) AS $$
  SELECT
    count(DISTINCT x.match_id),
    coalesce(sum(x.runs), 0),
    coalesce(sum(x.balls), 0),
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.wides) END,
    CASE WHEN count(*) = 0 THEN 0 ELSE sum(x.no_balls) END,
    coalesce(sum(x.wickets), 0)
  FROM (
    SELECT b.match_id,
           ball_runs_to_bowler(b.ball_type, b.value, b.payload)                   AS runs,
           CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END AS balls,
           CASE WHEN b.ball_type = 'Wd' THEN 1 ELSE 0 END                         AS wides,
           CASE WHEN b.ball_type = 'Nb' THEN 1 ELSE 0 END                         AS no_balls,
           CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END                                                 AS wickets
      FROM ball_event_career b
     WHERE b.kind = 'ball'
       AND b.bowler_id = p_player
       AND (p_from IS NULL OR b.server_ts >= p_from)
    UNION ALL
    SELECT w.match_id, w.runs, w.legal_balls, w.wides, w.no_balls, w.wickets
      FROM summary_bowling_line w
     WHERE w.player_id = p_player
       AND (p_from IS NULL OR w.played_at >= p_from)
  ) x
$$ LANGUAGE sql STABLE;

-- bowler_innings_figures: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW bowler_innings_figures WITH (security_invoker = true) AS
SELECT b.bowler_id AS player_id, b.match_id, b.innings,
       count(*) FILTER (WHERE b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS wickets,
       coalesce(sum(ball_runs_to_bowler(b.ball_type, b.value, b.payload)), 0)::int AS runs_conceded
  FROM ball_event_career b
 WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL
 GROUP BY b.bowler_id, b.match_id, b.innings
UNION ALL
SELECT w.player_id, w.match_id, w.innings, w.wickets, w.runs
  FROM summary_bowling_line w
 WHERE w.player_id IS NOT NULL;

-- player_wicket_breakdown: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW player_wicket_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS wickets
  FROM (
    SELECT b.bowler_id AS player_id, b.dismissal
      FROM ball_event_career b
     WHERE b.kind = 'ball' AND b.ball_type = 'W'
       AND b.bowler_id IS NOT NULL
       AND dismissal_is_bowlers(b.dismissal)
       AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
    UNION ALL
    SELECT s.bowler_id, s.how_out
      FROM summary_batting_line s
     WHERE s.is_bowlers AND s.bowler_id IS NOT NULL
  ) x
 GROUP BY x.player_id, x.dismissal;

-- player_dismissals: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW player_dismissals WITH (security_invoker = true) AS
SELECT x.player_id,
       count(*)                                                                   AS dismissals
  FROM (
    SELECT who.player_id, b.match_id
      FROM ball_event_career b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                     THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END))
      ) AS who(player_id)
    UNION ALL
    SELECT s.player_id, s.match_id
      FROM summary_batting_line s
     WHERE s.is_dismissal
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

-- player_dismissals_by_season: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW player_dismissals_by_season WITH (security_invoker = true) AS
WITH match_season AS MATERIALIZED (
  SELECT m.id AS match_id, school_season_of(m.starts_at) AS season FROM match m
)
SELECT x.player_id,
       ms.season,
       count(*)                                                                   AS dismissals
  FROM (
    SELECT who.player_id, b.match_id
      FROM ball_event_career b
      CROSS JOIN LATERAL (VALUES
        (CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
              THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END),
        (nullif(ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
                CASE WHEN b.kind = 'ball' AND b.ball_type = 'W'
                          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                     THEN ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) END))
      ) AS who(player_id)
    UNION ALL
    SELECT s.player_id, s.match_id
      FROM summary_batting_line s
     WHERE s.is_dismissal
  ) x
  JOIN match_season ms ON ms.match_id = x.match_id
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id, ms.season;

-- player_dismissals_since: db/64's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE FUNCTION player_dismissals_since(p_player uuid, p_from timestamptz)
RETURNS bigint AS $$
  SELECT (SELECT count(*)
            FROM ball_event_career b
           WHERE ((b.kind = 'ball' AND b.ball_type = 'W'
                   AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = p_player
                   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
                  OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
             AND (p_from IS NULL OR b.server_ts >= p_from))
       + (SELECT count(*)
            FROM summary_batting_line s
           WHERE s.player_id = p_player AND s.is_dismissal
             AND (p_from IS NULL OR s.played_at >= p_from))
$$ LANGUAGE sql STABLE;

-- player_dismissal_breakdown: db/64's, its 2 reads of the log now ball_event_career.
CREATE OR REPLACE VIEW player_dismissal_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS dismissals
FROM (
  SELECT ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) AS player_id, b.dismissal
    FROM ball_event_career b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT NULL
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
         ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload)
    FROM ball_event_career b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
  UNION ALL
  SELECT s.player_id, s.how_out
    FROM summary_batting_line s
   WHERE s.is_dismissal AND s.player_id IS NOT NULL
) x
GROUP BY x.player_id, x.dismissal;

-- opposition_squad: db/64's, its 2 reads of the log now ball_event_career.
CREATE OR REPLACE FUNCTION opposition_squad(p_match uuid)
RETURNS TABLE (player_id uuid, school_id uuid, full_name text, team_code text,
               playing_role text, batting_style text, bowling_style text,
               innings integer, balls integer, runs integer, dismissals integer,
               fours integer, sixes integer, dots integer,
               strike_rate numeric, dot_pct numeric, batting_evidence text,
               balls_bowled integer, runs_conceded integer, wickets integer,
               economy numeric, bowling_evidence text) AS $$
  WITH s AS (SELECT * FROM opposition_side(p_match) WHERE open),
  squad AS (
    SELECT p.id, p.school_id, p.full_name, p.team_code, p.playing_role,
           p.batting_style, p.bowling_style
      FROM player p JOIN s ON p.school_id = s.their_school AND p.team_code = s.their_team
  ),
  bat_rows AS (
    SELECT b.striker_id AS pid, b.match_id, true AS live,
           -- Balls faced: a no-ball is one, a wide is not.
           CASE WHEN b.ball_type <> 'Wd' THEN 1 ELSE 0 END AS balls,
           ball_runs_off_bat(b.ball_type, b.value, b.payload) AS runs,
           CASE WHEN b.ball_type = 'W'
                 AND dismissal_is_bowlers(b.dismissal)
                 AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = b.striker_id
                 AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                THEN 1 ELSE 0 END AS dismissals,
           -- His boundaries: off the bat, off a run or a no-ball (runsOffBat()).
           CASE WHEN b.ball_type IN ('run','Nb') AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4
                THEN 1 ELSE 0 END AS fours,
           CASE WHEN b.ball_type IN ('run','Nb') AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6
                THEN 1 ELSE 0 END AS sixes,
           CASE WHEN ball_counts_in_over(b.ball_type, b.payload) AND coalesce(b.value,0) = 0
                THEN 1 ELSE 0 END AS dots
      FROM ball_event_career b JOIN squad q ON q.id = b.striker_id
     WHERE b.kind = 'ball'
    UNION ALL
    -- His book innings: the bowler's dismissals of him, as above.
    SELECT l.player_id, l.match_id, false, l.balls, l.runs,
           CASE WHEN l.is_bowlers THEN 1 ELSE 0 END, l.fours, l.sixes, NULL::integer
      FROM summary_batting_line l JOIN squad q ON q.id = l.player_id
  ),
  bat AS (
    SELECT r.pid,
           count(DISTINCT r.match_id)::int AS innings,
           sum(r.balls)::int AS balls,
           coalesce(sum(r.runs),0)::int AS runs,
           sum(r.dismissals)::int AS dismissals,
           sum(r.fours)::int AS fours,
           sum(r.sixes)::int AS sixes,
           sum(r.dots)::int AS dots,
           sum(r.balls) FILTER (WHERE r.live)::int AS live_balls,
           coalesce(sum(r.runs) FILTER (WHERE r.balls IS NOT NULL), 0)::int AS runs_with_balls
      FROM bat_rows r
     GROUP BY r.pid
  ),
  bowl AS (
    SELECT x.pid,
           coalesce(sum(x.balls), 0)::int AS balls_bowled,
           -- What the bowler conceded, as the fold charges him (runsToBowler()):
           -- a wide is its penalty run and every run off it; a no-ball its
           -- penalty run and the runs off the bat, not its byes or leg byes
           -- (Law 21.15); a run or a wicket ball its runs; byes and leg byes
           -- are not his. A book's bowling row: his runs, as the card has them.
           coalesce(sum(x.runs), 0)::int AS runs_conceded,
           coalesce(sum(x.wickets), 0)::int AS wickets
      FROM (
        SELECT b.bowler_id AS pid,
               CASE WHEN ball_counts_in_over(b.ball_type, b.payload) THEN 1 ELSE 0 END AS balls,
               ball_runs_to_bowler(b.ball_type, b.value, b.payload) AS runs,
               CASE WHEN b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
                    THEN 1 ELSE 0 END AS wickets
          FROM ball_event_career b JOIN squad q ON q.id = b.bowler_id
         WHERE b.kind = 'ball'
        UNION ALL
        SELECT w.player_id, w.legal_balls, w.runs, w.wickets
          FROM summary_bowling_line w JOIN squad q ON q.id = w.player_id
      ) x
     GROUP BY x.pid
  )
  SELECT q.id, q.school_id, q.full_name, q.team_code, q.playing_role, q.batting_style, q.bowling_style,
         coalesce(bat.innings,0),
         CASE WHEN bat.pid IS NULL THEN 0 ELSE bat.balls END,
         coalesce(bat.runs,0), coalesce(bat.dismissals,0),
         CASE WHEN bat.pid IS NULL THEN 0 ELSE bat.fours END,
         CASE WHEN bat.pid IS NULL THEN 0 ELSE bat.sixes END,
         CASE WHEN bat.pid IS NULL THEN 0 ELSE bat.dots END,
         -- NULL below the evidence floor, not a number. The label beside it
         -- says why, and a screen renders an em dash.
         CASE WHEN coalesce(bat.balls,0) >= 30 THEN round(bat.runs_with_balls * 100.0 / bat.balls, 1) END,
         CASE WHEN coalesce(bat.live_balls,0) >= 30 THEN round(bat.dots * 100.0 / bat.live_balls, 1) END,
         evidence_label(bat.balls),
         coalesce(bowl.balls_bowled,0), coalesce(bowl.runs_conceded,0), coalesce(bowl.wickets,0),
         CASE WHEN coalesce(bowl.balls_bowled,0) >= 30 THEN round(bowl.runs_conceded * 6.0 / bowl.balls_bowled, 2) END,
         evidence_label(bowl.balls_bowled)
    FROM squad q
    LEFT JOIN bat  ON bat.pid  = q.id
    LEFT JOIN bowl ON bowl.pid = q.id
   ORDER BY coalesce(bat.runs,0) DESC, q.full_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- bowler_hat_trick: db/54's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW bowler_hat_trick WITH (security_invoker = true) AS
WITH legal AS (
  SELECT b.bowler_id, b.match_id, b.innings, b.seq,
         (b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)) AS w
    FROM ball_event_career b
   WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL AND ball_counts_in_over(b.ball_type, b.payload)),
runs AS (
  SELECT *, lag(w, 1) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w1,
            lag(w, 2) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w2
    FROM legal)
SELECT bowler_id AS player_id, match_id, innings, min(seq)::int AS completed_at_seq
  FROM runs WHERE w AND w1 AND w2
 GROUP BY bowler_id, match_id, innings;

-- keeper_dismissal: db/68's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE VIEW keeper_dismissal WITH (security_invoker = true) AS
SELECT b.match_id, b.school_id, b.innings, b.seq, b.server_ts,
       k.keeper_ref,
       CASE WHEN k.keeper_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN k.keeper_ref::uuid END AS player_id,
       b.dismissal
  FROM ball_event_career b
  CROSS JOIN LATERAL keeper_at(b.match_id, b.innings, b.seq) k
 WHERE b.kind = 'ball' AND b.ball_type = 'W' AND b.dismissal IN ('caught', 'stumped')
   AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
   AND (b.dismissal = 'stumped' OR keeper_is_fielder(k.keeper_ref, k.keeper_name, b.payload -> 'fielder'));

-- player_keeping_career: db/68's, its 1 read of the log now ball_event_career.
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
      FROM ball_event_career b
     WHERE b.kind = 'keeper'
    UNION ALL
    SELECT d.player_id, d.match_id, d.innings, false, d.dismissal
      FROM keeper_dismissal d
  ) x
  JOIN player p ON p.id = x.player_id
 GROUP BY x.player_id;

-- innings_runs_off_bat: db/51's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE FUNCTION innings_runs_off_bat(p_player uuid, p_match uuid, p_innings smallint)
RETURNS bigint AS $$
  SELECT coalesce(sum(ball_runs_off_bat(b.ball_type, b.value, b.payload)), 0)
    FROM ball_event_career b
   WHERE b.match_id = p_match AND b.innings = p_innings
     AND b.kind = 'ball' AND b.striker_id = p_player
$$ LANGUAGE sql STABLE;

-- career_runs_off_bat: db/51's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE FUNCTION career_runs_off_bat(p_player uuid)
RETURNS bigint AS $$
  SELECT coalesce(sum(ball_runs_off_bat(b.ball_type, b.value, b.payload)), 0)
    FROM ball_event_career b
   WHERE b.kind = 'ball' AND b.striker_id = p_player
$$ LANGUAGE sql STABLE;

-- public_shot_sectors: db/59's, its 1 read of the log now ball_event_career.
CREATE OR REPLACE FUNCTION public_shot_sectors(p_match uuid)
RETURNS TABLE (innings smallint, sector smallint, shots integer, runs integer) AS $$
  SELECT b.innings, b.seg, count(*)::integer, sum(b.value)::integer
    FROM ball_event_career b
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

-- opposition_context: db/08's, its 2 reads of the log now ball_event_career.
CREATE OR REPLACE FUNCTION opposition_context(p_match uuid)
RETURNS TABLE (match_id uuid, my_side text, their_school uuid, their_label text,
               their_team text, opens_at timestamptz, closes_at timestamptz,
               open boolean, reason text, games_analysed integer,
               deliveries_analysed integer, data_cutoff timestamptz) AS $$
  SELECT p_match,
         CASE WHEN s.my_school = m.school_id THEN 'home' ELSE 'away' END,
         s.their_school,
         fixture_side_label(s.their_school, s.their_team),
         s.their_team, s.opens_at, s.closes_at, s.open, s.reason,
         -- Only counted once the window is open. A closed window says how
         -- much there WOULD be to read, which is a disclosure by another name.
         CASE WHEN s.open THEN (
           SELECT count(DISTINCT b.match_id)::int FROM ball_event_career b
             JOIN player p ON p.id IN (b.striker_id, b.bowler_id)
            WHERE p.school_id = s.their_school AND p.team_code = s.their_team) END,
         CASE WHEN s.open THEN (
           SELECT count(*)::int FROM ball_event_career b
             JOIN player p ON p.id IN (b.striker_id, b.bowler_id)
            WHERE p.school_id = s.their_school AND p.team_code = s.their_team
              AND b.kind = 'ball') END,
         now()
    FROM opposition_side(p_match) s
    JOIN match m ON m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 5 · Milestones never come from a super over (§4) ───────────────
-- db/51's, returning first on a super over's ball. Excluding it from the
-- career sums alone would not do: a super-over boundary after a boy passed
-- 500 would read his career "before this ball" as 500 less four, and say he
-- passed it again.
CREATE OR REPLACE FUNCTION milestone_watch() RETURNS trigger AS $$
DECLARE v_runs int; v_before int; v_w int; v_career int; t int; v_bat int;
BEGIN
  -- db/71: a super over's ball is no milestone (design §4, D6): not a career
  -- run, not a five-for, not a hat-trick. Asked first, before any figure.
  IF innings_super_over_of(NEW.match_id, NEW.innings) IS NOT NULL THEN RETURN NEW; END IF;
  v_bat := ball_runs_off_bat(NEW.ball_type, NEW.value, NEW.payload);
  -- The striker's innings, and his career, after this ball.
  IF NEW.striker_id IS NOT NULL AND v_bat > 0 THEN
    SELECT innings_runs_off_bat(NEW.striker_id, NEW.match_id, NEW.innings) INTO v_runs;
    v_before := v_runs - v_bat;
    IF v_before < 50 AND v_runs >= 50 THEN PERFORM milestone_notify(NEW.striker_id, 'fifty', NEW.match_id, NEW.innings, v_runs); END IF;
    IF v_before < 100 AND v_runs >= 100 THEN PERFORM milestone_notify(NEW.striker_id, 'hundred', NEW.match_id, NEW.innings, v_runs); END IF;
    SELECT career_runs_off_bat(NEW.striker_id) INTO v_career;
    FOREACH t IN ARRAY ARRAY[500, 1000, 2000, 5000] LOOP
      IF v_career - v_bat < t AND v_career >= t THEN PERFORM milestone_notify(NEW.striker_id, 'career_runs', NEW.match_id, 0::smallint, t); END IF;
    END LOOP;
  END IF;
  -- The bowler's wicket — one that stood.
  IF NEW.bowler_id IS NOT NULL AND NEW.ball_type = 'W' AND dismissal_is_bowlers(NEW.dismissal)
     AND ball_wicket_stands(NEW.match_id, NEW.innings, NEW.seq, NEW.kind, NEW.ball_type, NEW.dismissal) THEN
    SELECT wickets INTO v_w FROM bowler_innings_figures
     WHERE player_id = NEW.bowler_id AND match_id = NEW.match_id AND innings = NEW.innings;
    IF v_w = 5 THEN PERFORM milestone_notify(NEW.bowler_id, 'five_for', NEW.match_id, NEW.innings, 5); END IF;
    IF EXISTS (SELECT 1 FROM bowler_hat_trick h WHERE h.player_id = NEW.bowler_id AND h.match_id = NEW.match_id
                  AND h.innings = NEW.innings AND h.completed_at_seq = NEW.seq) THEN
      PERFORM milestone_notify(NEW.bowler_id, 'hat_trick', NEW.match_id, NEW.innings, 3);
    END IF;
    SELECT coalesce(sum(wickets), 0) INTO v_career FROM bowler_innings_figures WHERE player_id = NEW.bowler_id;
    FOREACH t IN ARRAY ARRAY[25, 50, 100, 250] LOOP
      IF v_career = t THEN PERFORM milestone_notify(NEW.bowler_id, 'career_wickets', NEW.match_id, 0::smallint, t); END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 6 · Completion waits for the super over (db/33's gate, §3.4) ─────
-- db/33's gate reads match.status alone: once 'complete', scoring ends for
-- everyone. Nothing marks a pad's match complete at its last seal (db/69
-- §10.4), so the gate does not read the result today and is not re-emitted.
-- What the super over needs is the other side of it: a tied match whose
-- document provides a super over is not COMPLETED while nothing has settled
-- who goes through — else the gate would shut the pad on the tie, and the
-- super over could never be scored. It may be marked complete once a pair
-- is won, or a pair is left incomplete (the light went: the organiser's
-- award decides, §3.6), or a decision stands. A scorebook's commit marks its
-- match complete and is not stopped: a book records no super over, and the
-- organiser's award is how its cup tie is settled.
CREATE OR REPLACE FUNCTION match_completion_refusal(p_match uuid) RETURNS text AS $$
DECLARE r record;
BEGIN
  IF coalesce((SELECT c.doc->'play'->'result.tie_break' FROM match_conditions c WHERE c.match_id = p_match), 'null'::jsonb)
     IS DISTINCT FROM '"super_over"'::jsonb THEN
    RETURN NULL;
  END IF;
  SELECT x.outcome, x.decided_by, x.super_overs INTO r FROM match_result_compute(p_match) x;
  IF r.outcome IS DISTINCT FROM 'tie' OR r.decided_by IS NOT NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(r.super_overs, '[]')) p WHERE p->>'state' = 'incomplete') THEN
    RETURN NULL;
  END IF;
  RETURN 'super_over_pending';
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_completion_refusal(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION match_completion_gate() RETURNS trigger AS $$
DECLARE why text;
BEGIN
  -- The scorebook's commit (db/63) completes its own match.
  IF coalesce(current_setting('scrbrd.scorebook_commit', true), '') <> '' THEN RETURN NEW; END IF;
  why := match_completion_refusal(NEW.id);
  IF why IS NOT NULL THEN
    RAISE EXCEPTION 'match: % is tied and its playing conditions provide a super over — play it, or record the organiser''s decision, before marking it complete', NEW.id
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'match', CONSTRAINT = 'match_super_over_pending';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_completion_gate() FROM PUBLIC;

DROP TRIGGER IF EXISTS match_completion_gate ON match;
CREATE TRIGGER match_completion_gate BEFORE UPDATE OF status ON match
  FOR EACH ROW WHEN (NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete')
  EXECUTE FUNCTION match_completion_gate();

-- On a managed host the platform's API roles get EXECUTE on every new
-- function in public by default privilege, directly and not through PUBLIC
-- (db/29, db/47, db/51).
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['innings_super_over_of(uuid,smallint)', 'match_completion_refusal(uuid)', 'match_completion_gate()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON ball_event_career FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;

-- ── 7 · The proof ────────────────────────────────────────────────────
-- Built and rolled back. db/99 §50 is the fuller proof, under the
-- application role, on every verify paste; tools/smoke-fold-figures.mjs
-- holds match_result() and ball_event_live.super_over to the fold over the
-- super-over logs of result-logs.mjs. This is what must hold the moment the
-- file has run.
DO $check$
DECLARE
  r        record;
  now_shape jsonb;
  want     jsonb;
  n        integer;
  got      text;
  before_c text;
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_m      uuid := gen_random_uuid();
  p_a      uuid := gen_random_uuid();   -- Hilton's opener: 14 off the match's over, then the super over
  p_b      uuid := gen_random_uuid();   -- Hilton's bowler: bowls the super over
  v_k      integer := 0;
  T        timestamptz := '2026-10-03 10:00+02';
  sq       jsonb;
  sqk      jsonb := (SELECT jsonb_agg(jsonb_build_object('id', 'K' || g, 'name', 'K' || g)) FROM generate_series(1, 11) g);
  why      text;
BEGIN
  -- 1. What was re-emitted keeps its shape; the two views gain one last column.
  FOR r IN SELECT * FROM _db71_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object(
               'options', to_jsonb(c.reloptions), 'acl', to_jsonb(c.relacl::text[]), 'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'v' AND c.relname = substr(r.obj, 6);
      want := CASE WHEN r.obj IN ('view:ball_event_live', 'view:match_live_score')
                   THEN jsonb_set(r.shape, '{columns}', (r.shape->'columns') || '["super_over smallint"]'::jsonb)
                   ELSE r.shape END;
    ELSE
      SELECT jsonb_build_object(
               'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef, 'volatility', p.provolatile, 'parallel', p.proparallel, 'strict', p.proisstrict,
               'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
               'language', p.prolang)
        INTO now_shape FROM pg_proc p WHERE p.oid = substr(r.obj, 10)::regprocedure;
      want := r.shape;
    END IF;
    IF now_shape IS DISTINCT FROM want THEN
      RAISE EXCEPTION 'db/71: % changed shape: was %, now %', r.obj, want, now_shape;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _db71_before) <> 28 THEN
    RAISE EXCEPTION 'db/71: the snapshot is not the 28 objects this file replaces (%)', (SELECT count(*) FROM _db71_before);
  END IF;

  -- 2. Every career reader reads the career log, and none the live one.
  FOR r IN SELECT c.relname AS nm, pg_get_viewdef(c.oid) AS def FROM pg_class c
            WHERE c.relname IN ('player_innings', 'player_batting_career', 'player_bowling_career', 'player_dismissals',
                                'player_dismissal_breakdown', 'player_batting_by_season', 'player_bowling_by_season',
                                'player_dismissals_by_season', 'bowler_innings_figures', 'player_wicket_breakdown',
                                'bowler_hat_trick', 'keeper_dismissal', 'player_keeping_career')
           UNION ALL
           SELECT p.proname, p.prosrc FROM pg_proc p
            WHERE p.oid IN ('player_batting_since(uuid,timestamptz)'::regprocedure, 'player_bowling_since(uuid,timestamptz)'::regprocedure,
                            'player_dismissals_since(uuid,timestamptz)'::regprocedure, 'opposition_squad(uuid)'::regprocedure,
                            'opposition_context(uuid)'::regprocedure, 'innings_runs_off_bat(uuid,uuid,smallint)'::regprocedure,
                            'career_runs_off_bat(uuid)'::regprocedure, 'public_shot_sectors(uuid)'::regprocedure)
  LOOP
    IF r.def NOT LIKE '%ball_event_career%' OR r.def ~ '\mball_event_live\M' THEN
      RAISE EXCEPTION 'db/71: % does not read the log through ball_event_career alone', r.nm;
    END IF;
  END LOOP;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_class c WHERE c.oid = 'ball_event_career'::regclass), false) THEN
    RAISE EXCEPTION 'db/71: ball_event_career runs as its owner';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'milestone_watch()'::regprocedure) NOT LIKE '%innings_super_over_of(NEW.match_id, NEW.innings) IS NOT NULL THEN RETURN NEW%' THEN
    RAISE EXCEPTION 'db/71: milestone_watch() does not return first on a super over';
  END IF;

  -- 3. A cup tie and its super over.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db71-' || v_school, 'db/71 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db71-' || v_user || '@example.invalid', 'db/71 proof', 'scorer', v_school);
    INSERT INTO player (id, school_id, team_code, full_name, squad_no, playing_role, born) VALUES
      (p_a, v_school, '1XI', 'db/71 Opener', 1, 'batter', DATE '2010-03-01'),
      (p_b, v_school, '1XI', 'db/71 Bowler', 2, 'bowler', DATE '2010-03-01');
    sq := jsonb_build_array(jsonb_build_object('id', p_a, 'name', 'db/71 Opener'), jsonb_build_object('id', p_b, 'name', 'db/71 Bowler'))
          || (SELECT jsonb_agg(jsonb_build_object('id', 'H' || g, 'name', 'H' || g)) FROM generate_series(3, 11) g);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (v_m, v_school, '1XI', 'Kearsney', T, 'cricket', 'T20', 1, 'live');
    INSERT INTO match_conditions (match_id, doc, sources, doc_hash)
    VALUES (v_m, '{"v":1,"play":{"format.kind":"limited","format.innings_per_side":1,"result.tie_break":"super_over"},"table":{},"sheet":{}}', '{}', '');
    -- Hilton 14 off an over (p_a facing every ball), Kearsney 14 chasing 15:
    -- tied. Then Kearsney's super over off p_b, 8 for 1; Hilton's, p_a 9.
    FOR r IN
      SELECT * FROM (VALUES
        (0, 'innings_start', NULL, NULL::int, NULL, jsonb_build_object('battingTeam', '1XI', 'bowlingTeam', 'Kearsney', 'squad', sq, 'bowlingSquad', sqk, 'overs', 1), NULL::uuid, NULL::uuid),
        (0, 'ball', 'run', 4, NULL, '{}'::jsonb, p_a, NULL), (0, 'ball', 'run', 1, NULL, '{}', p_a, NULL), (0, 'ball', 'run', 0, NULL, '{}', p_a, NULL),
        (0, 'ball', 'run', 2, NULL, '{}', p_a, NULL), (0, 'ball', 'run', 6, NULL, '{}', p_a, NULL), (0, 'ball', 'run', 1, NULL, '{}', p_a, NULL),
        (0, 'innings_end', NULL, NULL, NULL, '{"reason":"overs_complete","confirmed":{"runs":14,"wickets":0,"balls":6}}', NULL, NULL),
        (1, 'innings_start', NULL, NULL, NULL, jsonb_build_object('battingTeam', 'Kearsney', 'bowlingTeam', '1XI', 'squad', sqk, 'bowlingSquad', sq, 'overs', 1, 'target', 15), NULL, NULL),
        (1, 'ball', 'run', 6, NULL, '{}', NULL, p_b), (1, 'ball', 'run', 6, NULL, '{}', NULL, p_b), (1, 'ball', 'run', 1, NULL, '{}', NULL, p_b),
        (1, 'ball', 'run', 1, NULL, '{}', NULL, p_b), (1, 'ball', 'run', 0, NULL, '{}', NULL, p_b), (1, 'ball', 'run', 0, NULL, '{}', NULL, p_b),
        (1, 'innings_end', NULL, NULL, NULL, '{"reason":"overs_complete","confirmed":{"runs":14,"wickets":0,"balls":6}}', NULL, NULL)
      ) AS x(inn, kind, bt, v, dis, payload, striker, bowler)
    LOOP
      v_k := v_k + 1;
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, dismissal, payload, striker_id, bowler_id)
      VALUES (v_m, v_school, v_k, 1, r.inn, v_user, 'db71-pad', 'db71:' || v_k, v_k, T + v_k * interval '20 seconds',
              r.kind, r.bt, r.v, r.dis, r.payload, r.striker, r.bowler);
    END LOOP;
    SELECT row(x.outcome, x.decided_by, x.super_overs)::text INTO got FROM match_result_compute(v_m) x;
    IF got IS DISTINCT FROM '(tie,,[])' THEN RAISE EXCEPTION 'db/71: the tie, before the super over, reads %', got; END IF;
    why := match_completion_refusal(v_m);
    IF why IS DISTINCT FROM 'super_over_pending' THEN RAISE EXCEPTION 'db/71: a cup tie may be completed before its super over (%)', why; END IF;
    BEGIN
      UPDATE match SET status = 'complete' WHERE id = v_m;
      RAISE EXCEPTION 'db/71: the gate let a cup tie be marked complete before its super over';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    SELECT string_agg(concat_ws(':', x.player_id, x.runs, x.balls_faced, x.out), ' ' ORDER BY x.player_id) INTO before_c
      FROM player_innings x WHERE x.match_id = v_m;
    FOR r IN
      SELECT * FROM (VALUES
        (2, 'innings_start', NULL, NULL::int, NULL, jsonb_build_object('battingTeam', 'Kearsney', 'bowlingTeam', '1XI', 'squad', sqk, 'bowlingSquad', sq, 'overs', 1, 'superOver', 1), NULL::uuid, NULL::uuid),
        (2, 'ball', 'run', 6, NULL, '{}'::jsonb, NULL, p_b), (2, 'ball', 'run', 1, NULL, '{}', NULL, p_b), (2, 'ball', 'W', 0, 'bowled', '{}', NULL, p_b),
        (2, 'ball', 'run', 1, NULL, '{}', NULL, p_b), (2, 'ball', 'run', 0, NULL, '{}', NULL, p_b), (2, 'ball', 'run', 0, NULL, '{}', NULL, p_b),
        (2, 'innings_end', NULL, NULL, NULL, '{"reason":"overs_complete","confirmed":{"runs":8,"wickets":1,"balls":6}}', NULL, NULL),
        (3, 'innings_start', NULL, NULL, NULL, jsonb_build_object('battingTeam', '1XI', 'bowlingTeam', 'Kearsney', 'squad', sq, 'bowlingSquad', sqk, 'overs', 1, 'target', 9, 'superOver', 1), NULL, NULL),
        (3, 'ball', 'run', 4, NULL, '{}', p_a, NULL), (3, 'ball', 'run', 4, NULL, '{}', p_a, NULL), (3, 'ball', 'run', 1, NULL, '{}', p_a, NULL),
        (3, 'innings_end', NULL, NULL, NULL, '{"reason":"target_reached","confirmed":{"runs":9,"wickets":0,"balls":3}}', NULL, NULL)
      ) AS x(inn, kind, bt, v, dis, payload, striker, bowler)
    LOOP
      v_k := v_k + 1;
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, dismissal, payload, striker_id, bowler_id)
      VALUES (v_m, v_school, v_k, 1, r.inn, v_user, 'db71-pad', 'db71:' || v_k, v_k, T + v_k * interval '20 seconds',
              r.kind, r.bt, r.v, r.dis, r.payload, r.striker, r.bowler);
    END LOOP;
    SELECT string_agg(x.innings || '=' || coalesce(x.so::text, '-'), ' ' ORDER BY x.innings) INTO got
      FROM (SELECT b.innings, max(b.super_over) AS so FROM ball_event_live b WHERE b.match_id = v_m GROUP BY b.innings) x;
    IF got IS DISTINCT FROM '0=- 1=- 2=1 3=1' THEN RAISE EXCEPTION 'db/71: ball_event_live.super_over reads %', got; END IF;
    SELECT row(x.outcome, x.decided_by, x.winner_side, x.play_outcome, x.super_overs->0->>'state', x.super_overs->0->>'winner')::text INTO got
      FROM match_result_compute(v_m) x;
    IF got IS DISTINCT FROM '(tie,super_over,home,tie,won,home)' THEN RAISE EXCEPTION 'db/71: the super over reads %', got; END IF;
    SELECT string_agg(concat_ws(':', x.player_id, x.runs, x.balls_faced, x.out), ' ' ORDER BY x.player_id) INTO got
      FROM player_innings x WHERE x.match_id = v_m;
    IF got IS DISTINCT FROM before_c THEN RAISE EXCEPTION 'db/71: a super over moved a career: % then %', before_c, got; END IF;
    IF (SELECT count(*) FROM bowler_over o WHERE o.match_id = v_m AND o.bowler_id = p_b) <> 2 THEN
      RAISE EXCEPTION 'db/71: the workload record does not count the super over p_b bowled';
    END IF;
    UPDATE match SET status = 'complete' WHERE id = v_m;   -- the super over was won: completion is allowed
    RAISE EXCEPTION USING ERRCODE = 'ZZ071', MESSAGE = 'db/71: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ071' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/71: the proof left something behind'; END IF;
END $check$;

DROP TABLE _db71_before;
