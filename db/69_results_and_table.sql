-- ══════════════════════════════════════════════════════════════════
--  69 · Match results and the league table (SCRBRD-114 phase 3a)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, but for the two tables' policies between the GENERATED
-- markers (TABLES_ADDED_SINCE_09). The design is
-- docs/design/SCRBRD-114_phase3_results_super_over.md §2, §6 and §7, built
-- to D1–D17 as decided (Kameel, 2026-09-30); §10 there records the build.
--
-- A RESULT IS READ FROM THE LOG, NEVER STORED. The fold's describeResult()
-- (packages/scoring/src/replay.mjs) is the rule; match_result() here is the
-- same rule over the same rows, and tools/smoke-fold-figures.mjs folds every
-- log of packages/scoring/test/result-logs.mjs both ways and holds the two to
-- each other (and to the design). A correction of a result is a correction
-- of the log (an amendment, a release, a void) or of the match's status, and
-- every reader follows on the next read.
--
-- WHAT IS HERE.
--
--   innings_over_reason(...)          inningsOverReason(): target reached, all
--                                     out (the squad less one, at most ten),
--                                     overs bowled — in that order.
--   penalty_carried_as_folded(m, i)   the part of penalty_credit_as_folded()
--                                     (db/48) an innings OPENS on: awards to the
--                                     fielding side made in an earlier innings
--                                     (penaltyCredits()'s `carried`); the rest is
--                                     added after its last event (`added`).
--   innings_result_state(m, i, ...)   one innings as the fold leaves it, event by
--                                     event in seq order: runs, wickets, balls,
--                                     overs and target (the innings_start's, the
--                                     umpires' revision, an award to the fielding
--                                     side raising a target nobody typed), the
--                                     seal that stands (sealRefusal()), the
--                                     4th Edition's penalty-runs win and reopened
--                                     chase (Law 16.7, 41.17.2), a scorebook card,
--                                     and the end the Laws derive (settleInnings()).
--   match_result_compute(m)           §2.2's row: the match's outcome from its
--                                     scheduled innings; the margin; who won and
--                                     who decided; the decision; result_hash.
--                                     Runs as its caller; the owner's alone.
--   match_result(m)                   the same, for a reader of the fixture at
--                                     either side's scope or of its competition
--                                     (match_result_readable()): the away coach
--                                     reads the result of his match, though the
--                                     home school's log is the home school's.
--   match_result_decision             §2.5: conceded, walkover, awarded; one
--                                     standing per match; withdrawn with a note,
--                                     never deleted. match_result_decide() and
--                                     match_result_decision_withdraw() are the
--                                     doors: competition.manage at the organiser,
--                                     or a friendly's home fixture.update (D8).
--   competition_points_adjustment     the parent's §5.4: entered, never computed;
--                                     withdrawn with a note. competition_points_
--                                     adjust() and its withdrawal, under
--                                     competition.conditions.manage. An over-rate
--                                     penalty in points only where the
--                                     competition's over_rate.kind is `points`.
--   competition_results(c)            every match of a competition with its
--                                     result, for whoever can reach it.
--   competition_standing_rows(c)      §6: the table, computed on every read from
--   competition_standing (view)       match_result() under each match's OWN
--                                     frozen table document: points, the typed
--                                     ladder where the figures are not confirmed
--                                     (basis), net run rate exactly (§6.4), ranks
--                                     shared on a full tie, table.order applied.
--   match_conditions_refix_table()    the parent's §3.4: a played match's table
--                                     part replaced from a named published
--                                     version, with a reason, the part it
--                                     replaced kept beside it; play never moves.
--   scoring_amendment_decide()        db/38's, with one addition: an approval
--                                     writes an audit line naming the result
--                                     before and after (result_hash both sides).
--   match_conditions_compute()        db/61's, with one correction: a fixture's
--                                     own format says two innings a side only for
--                                     a two-day or longer match (a One-Day
--                                     Declaration is one innings a side), so its
--                                     result is not read as a draw. Every other
--                                     line as db/61 has it.
--   public_match_result(m)            the result on the signed-out page: sides,
--   public_competition_standing(c)    never boys, never a reason (SCRBRD-083,
--                                     PUBLIC_DATA A1 and §3); for a served
--                                     fixture and a published competition.
--
-- NOT HERE (phase 3b, 3c): the super over (match_result() returns
-- super_overs '[]' and never decided_by = super_over yet); progression.
-- head_to_head in table.order is accepted and not applied (D13). The team
-- sheet attestation (`unattested_results`) is the parent's phase 4: NULL.
--
-- RLS. The two tables' policies are generated (below); the application has
-- no INSERT, UPDATE or DELETE on either. The functions that compute a
-- result run as their caller and are the owner's alone; match_result(),
-- competition_results(), the standing and the public reads are SECURITY
-- DEFINER behind match_result_readable(), competition_visible() or a
-- publication, because a league's table is every school's matches and no
-- reader may read every school's log. One asks a pad capability by name —
-- match_result_readable(), fixture.read — and db/99 §28 lists it: a pad's
-- credential reads its own match's result, which its log already says.

-- ── 0 · What this file replaces, before it does ───────────────────
DROP TABLE IF EXISTS _db69_before;
CREATE TEMP TABLE _db69_before AS
SELECT p.oid::regprocedure::text AS obj,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'strict', p.proisstrict,
         'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
         'language', p.prolang) AS shape
  FROM pg_proc p
 WHERE p.oid IN ('match_conditions_compute(uuid)'::regprocedure, 'scoring_amendment_decide(uuid,boolean,text)'::regprocedure);

-- ── 1 · The rules of a result, in SQL ─────────────────────────────

-- inningsOverReason() (replay.mjs): the Laws' three endings, in its order.
CREATE OR REPLACE FUNCTION innings_over_reason(p_runs integer, p_wickets integer, p_balls integer,
                                               p_overs integer, p_target integer, p_squad integer)
RETURNS text AS $$
  SELECT CASE WHEN p_target IS NOT NULL AND p_runs >= p_target THEN 'target_reached'
              WHEN p_wickets >= least(10, greatest(1, coalesce(nullif(p_squad, 0), 11) - 1)) THEN 'all_out'
              WHEN p_balls >= coalesce(p_overs, 20) * 6 THEN 'overs_complete' END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- Two keys as describeResult() compares them: trimmed, any case, never NULL.
CREATE OR REPLACE FUNCTION result_key_eq(p_a text, p_b text) RETURNS boolean AS $$
  SELECT p_a IS NOT NULL AND p_b IS NOT NULL AND lower(btrim(p_a)) = lower(btrim(p_b))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- penaltyCredits()'s `carried`: db/48's penalty_credit_as_folded(), less the
-- awards made in a later innings (which are `added`, after the innings' last
-- event). NULL where an award is not a number the fold could add.
CREATE OR REPLACE FUNCTION penalty_carried_as_folded(p_match uuid, p_innings smallint)
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
    SELECT a.innings AS from_innings, a.awarded, a.unknown,
           coalesce((SELECT max(r.innings) FROM inns r WHERE r.innings < a.innings AND r.batting_side = a.fielding_side),
                    (SELECT min(r.innings) FROM inns r WHERE r.innings > a.innings AND r.batting_side = a.fielding_side))
             AS to_innings
      FROM inns a
     WHERE a.fielding_side IS NOT NULL AND (a.unknown OR a.awarded <> 0)
  )
  SELECT CASE WHEN coalesce(bool_or(g.unknown), false) THEN NULL
              ELSE coalesce(sum(g.awarded), 0)::integer END
    FROM goes g
   WHERE g.to_innings = p_innings AND g.from_innings < p_innings
$$ LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- One innings as the fold leaves it (inningsFolder(), then settleInnings(),
-- then the awards credited after its last event). Read over ball_event_live
-- as the caller may read it, in seq order, one event at a time, because a
-- seal is judged against the figures AT it and a penalty against the target
-- AT it. p_play is the match's frozen play part ('{}' for none); p_fourth
-- whether the match is under the 4th Edition (its start day, SAST).
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
                        THEN innings_over_reason(v_runs, v_wk, v_balls, v_overs, v_target, v_squad) END;
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
              OR e.payload->>'reason' = innings_over_reason(v_runs, v_wk, v_balls, v_overs, v_target, v_squad)) THEN
        v_sealed := true; v_done := true; v_reason := e.payload->>'reason';
      END IF;
    END IF;
  END LOOP;
  -- settleInnings(): over when the Laws say so, sealed or not.
  IF NOT v_done THEN
    v_ended := innings_over_reason(v_runs, v_wk, v_balls, v_overs, v_target, v_squad);
    IF v_ended IS NOT NULL THEN v_done := true; v_reason := v_ended; END IF;
  END IF;
  -- penaltyCredits()'s `added`: awards made later, after the last event.
  v_runs := v_runs + (penalty_credit_as_folded(p_match, p_innings) - v_carried);
  RETURN QUERY SELECT v_runs, v_wk, v_balls, v_overs, v_target, v_done, v_reason, v_sealed, v_pwin,
                      v_key, v_bat, v_squad, v_rev, v_summ;
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;

-- The result (design §2.2). describeResult() and result.mjs applyDecision(),
-- line for line: see the fold for the why of each rule. Runs as its caller
-- and reads the whole log only as the owner: the application calls it through
-- match_result() below, and the table, the public reads and the amendment's
-- audit line from their own definers. Not the application's to call.
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
  FOR i IN SELECT DISTINCT b.innings FROM ball_event_live b WHERE b.match_id = p_match ORDER BY b.innings LOOP
    SELECT * INTO s FROM innings_result_state(p_match, i.innings, v_play, v_fourth);
    v_inns := v_inns || jsonb_build_array(jsonb_build_object(
      'innings', i.innings, 'position', v_n, 'scheduled', v_n < 2 * v_ips,
      'runs', s.runs, 'wickets', s.wickets, 'balls', s.balls, 'overs', s.overs, 'target', s.target,
      'complete', s.complete, 'end_reason', s.end_reason, 'sealed', s.sealed, 'penalty_win', s.penalty_win,
      'key', s.team_key, 'batting_team', s.batting_team, 'squad', s.squad_size, 'revised', s.revised, 'summarised', s.summarised));
    v_n := v_n + 1;
  END LOOP;

  -- Which side bats each innings: by name; else the other of the first other
  -- side named; else home. An innings whose key is not the first's is the
  -- other side's.
  v_key0 := v_inns->0->>'key';
  SELECT y.value->>'key' INTO v_other FROM jsonb_array_elements(v_inns) WITH ORDINALITY y(value, n)
   WHERE y.value->>'key' IS NOT NULL AND NOT result_key_eq(y.value->>'key', v_key0) ORDER BY y.n LIMIT 1;
  v_side0 := coalesce(CASE WHEN result_key_eq(v_key0, v_home) THEN 'home' WHEN result_key_eq(v_key0, v_away) THEN 'away' END,
                      CASE WHEN result_key_eq(v_other, v_home) THEN 'away' WHEN result_key_eq(v_other, v_away) THEN 'home' END,
                      'home');
  SELECT jsonb_agg(y.value || jsonb_build_object('side',
           CASE WHEN result_key_eq(y.value->>'key', v_key0) THEN v_side0 WHEN v_side0 = 'home' THEN 'away' ELSE 'home' END) ORDER BY y.n)
    INTO v_inns FROM jsonb_array_elements(v_inns) WITH ORDINALITY y(value, n);
  v_inns := coalesce(v_inns, '[]'::jsonb);
  x0 := v_inns->0; x1 := v_inns->1; x2 := v_inns->2; x3 := v_inns->3;

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

  -- The decision, read last (result.mjs applyDecision()).
  r_out := p_out; r_kind := p_kind; r_margin := p_margin; r_side := p_side; r_key := p_key;
  r_by := CASE WHEN p_out IN ('home_win', 'away_win', 'tie', 'draw') THEN 'play' END;
  SELECT x.* INTO d FROM match_result_decision x WHERE x.match_id = p_match AND x.withdrawn_at IS NULL;
  IF FOUND THEN
    r_dec := jsonb_build_object('id', d.id, 'kind', d.kind, 'side', d.side, 'overrides_play', d.overrides_play,
                                'reason', d.reason, 'by', d.decided_by, 'at', d.decided_at);
    IF d.kind = 'awarded' AND d.overrides_play THEN
      r_out := d.side || '_win'; r_kind := 'awarded'; r_margin := NULL; r_side := d.side; r_key := NULL;
      r_by := 'decision'; r_applied := true;
    ELSIF p_out IN ('home_win', 'away_win') THEN
      NULL;   -- play named a winner: it stands, the decision is shown beside it
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
    '[]'::jsonb, r_dec, r_applied, p_out, p_side, p_key, p_kind, p_margin, v_inns,
    md5(concat_ws('|', r_out, coalesce(r_kind, '-'), coalesce(r_margin::text, '-'), coalesce(r_by, '-'),
                  coalesce(r_side, '-'), coalesce(r_school::text, '-'), coalesce(r_team, '-')));
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_compute(uuid) FROM PUBLIC;

-- May the caller read this match's result? Whoever may read the fixture, at
-- either side's scope (the match row's own policy), and whoever can reach the
-- competition it is played under: a league's results are every participant's
-- (A1), though another school's log is not. A result names sides, never a boy.
CREATE OR REPLACE FUNCTION match_result_readable(p_match uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM match m
     WHERE m.id = p_match
       AND (app_can('fixture.read', m.school_id, m.team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id)
            OR app_can('fixture.read', m.away_school_id, m.away_team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id)
            OR (m.competition_id IS NOT NULL AND competition_visible(m.competition_id))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_readable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result_readable(uuid) TO scrbrd_app;

-- The result, for a reader of it: the away school's coach reads the result of
-- the match his side played, though the home school's log is the home
-- school's; a league's participant reads every result in it.
CREATE OR REPLACE FUNCTION match_result(p_match uuid)
RETURNS TABLE (match_id uuid, outcome text, margin_kind text, margin integer, decided_by text,
               winner_side text, winner_school_id uuid, winner_team_code text, winner_key text,
               super_overs jsonb, decision jsonb, decision_applied boolean,
               play_outcome text, play_winner_side text, play_winner_key text, play_margin_kind text, play_margin integer,
               innings jsonb, result_hash text) AS $$
  SELECT r.* FROM match_result_compute(p_match) r WHERE match_result_readable(p_match)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result(uuid) TO scrbrd_app;

-- ── 2 · The decision row (design §2.5) ────────────────────────────
-- The competition a match is played under, whoever asks: the decision's
-- read policy asks competition_visible() of it, and must not depend on
-- whether the reader may read the match row.
CREATE OR REPLACE FUNCTION match_competition_of(p_match uuid) RETURNS uuid AS $$
  SELECT m.competition_id FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_competition_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_competition_of(uuid) TO scrbrd_app;

CREATE TABLE IF NOT EXISTS match_result_decision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('conceded', 'walkover', 'awarded')),
  -- conceded: the side that conceded; walkover and awarded: the side through.
  side           text NOT NULL CHECK (side IN ('home', 'away')),
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 10),
  -- An award only, and only when play had a winner it sets aside (a protest upheld).
  overrides_play boolean NOT NULL DEFAULT false,
  decided_by     uuid NOT NULL REFERENCES app_user(id),
  decided_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_by   uuid REFERENCES app_user(id),
  withdrawn_at   timestamptz,
  withdrawn_note text,
  CONSTRAINT match_result_decision_override_is_an_award CHECK (NOT overrides_play OR kind = 'awarded'),
  CONSTRAINT match_result_decision_withdrawal_is_whole
    CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_note IS NULL)),
  CONSTRAINT match_result_decision_withdrawal_says_why CHECK (withdrawn_note IS NULL OR length(btrim(withdrawn_note)) >= 10)
);
CREATE INDEX IF NOT EXISTS match_result_decision_match ON match_result_decision (match_id);
-- At most one standing decision per match.
CREATE UNIQUE INDEX IF NOT EXISTS match_result_decision_one_standing
  ON match_result_decision (match_id) WHERE withdrawn_at IS NULL;

-- The trigger the design names: an override is an award's; a decision on a
-- match with no ball bowled is a walkover or a concession; a row is never
-- changed but to withdraw it, once.
CREATE OR REPLACE FUNCTION match_result_decision_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.overrides_play AND NEW.kind <> 'awarded' THEN
      RAISE EXCEPTION 'only an award overrides a played result' USING ERRCODE = 'check_violation',
        CONSTRAINT = 'match_result_decision_override_is_an_award';
    END IF;
    IF NEW.kind NOT IN ('walkover', 'conceded') AND NOT EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = NEW.match_id) THEN
      RAISE EXCEPTION 'a match with no ball bowled is decided by a walkover or a concession, not an award'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'match_result_decision_needs_play';
    END IF;
    NEW.withdrawn_by := NULL; NEW.withdrawn_at := NULL; NEW.withdrawn_note := NULL;
    RETURN NEW;
  END IF;
  IF OLD.withdrawn_at IS NOT NULL
     OR NEW.id <> OLD.id OR NEW.match_id <> OLD.match_id OR NEW.kind <> OLD.kind OR NEW.side <> OLD.side
     OR NEW.reason <> OLD.reason OR NEW.overrides_play <> OLD.overrides_play
     OR NEW.decided_by <> OLD.decided_by OR NEW.decided_at <> OLD.decided_at THEN
    RAISE EXCEPTION 'a decision is never changed: it is withdrawn, with a note, and another made'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'match_result_decision_is_kept';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_decision_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS match_result_decision_guard ON match_result_decision;
CREATE TRIGGER match_result_decision_guard BEFORE INSERT OR UPDATE ON match_result_decision
  FOR EACH ROW EXECUTE FUNCTION match_result_decision_guard();
-- The signed-out page's cache drops the match at once (db/59's notify, keyed
-- by the match: the design's "touches match.updated_at", which match has not).
DROP TRIGGER IF EXISTS public_data_changed ON match_result_decision;
CREATE TRIGGER public_data_changed AFTER INSERT OR UPDATE OR DELETE ON match_result_decision
  FOR EACH ROW EXECUTE FUNCTION public_data_notify('match', 'match_id');

ALTER TABLE match_result_decision ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON match_result_decision FROM scrbrd_app;
GRANT SELECT ON match_result_decision TO scrbrd_app;

-- May the caller decide this match's result? The organiser's competition.manage
-- for a match in a competition; the home school's fixture.update for a friendly
-- (D8). A person as himself: not a pad's credential, not a support session.
CREATE OR REPLACE FUNCTION match_result_decider(p_match uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND app_support_access_id() IS NULL
     AND EXISTS (
       SELECT 1 FROM match m
        WHERE m.id = p_match
          AND CASE WHEN m.competition_id IS NOT NULL
                   THEN app_can('competition.manage', competition_organiser(m.competition_id), '*'::text,
                                '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
                   ELSE app_can('fixture.update', m.school_id, m.team_code,
                                '00000000-0000-0000-0000-000000000000'::uuid, m.id) END)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_decider(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result_decider(uuid) TO scrbrd_app;

-- Record a decision. Answers rather than raises: (ok, reason, detail, id).
--   not_permitted      no such match, or not the caller's to decide (one answer)
--   support_session    a support session decides no result
--   kind_invalid · side_invalid · reason_required (ten characters or more)
--   override_not_award only an award overrides play
--   needs_play         a match with no ball bowled: a walkover or a concession
--   already_decided    a standing decision: withdraw it first
CREATE OR REPLACE FUNCTION match_result_decide(p_match uuid, p_kind text, p_side text, p_reason text,
                                               p_overrides_play boolean DEFAULT false)
RETURNS TABLE (ok boolean, reason text, detail text, decision_id uuid) AS $$
DECLARE v_id uuid; v_constraint text;
BEGIN
  IF app_support_access_id() IS NOT NULL AND app_user_id() IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session', 'a support session does not decide a result', NULL::uuid; RETURN;
  END IF;
  IF NOT match_result_decider(p_match) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid; RETURN;
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('conceded', 'walkover', 'awarded') THEN
    RETURN QUERY SELECT false, 'kind_invalid', 'conceded, walkover or awarded', NULL::uuid; RETURN; END IF;
  IF p_side IS NULL OR p_side NOT IN ('home', 'away') THEN
    RETURN QUERY SELECT false, 'side_invalid', 'home or away', NULL::uuid; RETURN; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RETURN QUERY SELECT false, 'reason_required', 'say why, in ten characters or more', NULL::uuid; RETURN; END IF;
  -- One decision at a time per match: the per-match lock the conditions take.
  PERFORM match_conditions_lock(p_match);
  IF EXISTS (SELECT 1 FROM match_result_decision x WHERE x.match_id = p_match AND x.withdrawn_at IS NULL) THEN
    RETURN QUERY SELECT false, 'already_decided', 'withdraw the standing decision first', NULL::uuid; RETURN;
  END IF;
  BEGIN
    INSERT INTO match_result_decision (match_id, kind, side, reason, overrides_play, decided_by)
    VALUES (p_match, p_kind, p_side, btrim(p_reason), coalesce(p_overrides_play, false), app_user_id())
    RETURNING id INTO v_id;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RETURN QUERY SELECT false,
      CASE v_constraint WHEN 'match_result_decision_override_is_an_award' THEN 'override_not_award'
                        WHEN 'match_result_decision_needs_play' THEN 'needs_play' ELSE 'refused' END,
      CASE v_constraint WHEN 'match_result_decision_override_is_an_award' THEN 'only an award overrides a played result'
                        WHEN 'match_result_decision_needs_play' THEN 'no ball has been bowled: a walkover or a concession'
                        ELSE v_constraint END, NULL::uuid;
    RETURN;
  END;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_decide(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result_decide(uuid, text, text, text, boolean) TO scrbrd_app;

-- Withdraw a standing decision, with a note: play's answer is the result again.
CREATE OR REPLACE FUNCTION match_result_decision_withdraw(p_decision uuid, p_note text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE x match_result_decision%ROWTYPE;
BEGIN
  SELECT * INTO x FROM match_result_decision y WHERE y.id = p_decision;
  IF app_support_access_id() IS NOT NULL AND app_user_id() IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session', 'a support session does not withdraw a decision'; RETURN;
  END IF;
  IF NOT FOUND OR NOT match_result_decider(x.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN
    RETURN QUERY SELECT false, 'note_required', 'say why, in ten characters or more'; RETURN;
  END IF;
  PERFORM match_conditions_lock(x.match_id);
  SELECT * INTO x FROM match_result_decision y WHERE y.id = p_decision FOR UPDATE;
  IF x.withdrawn_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_withdrawn', NULL::text; RETURN; END IF;
  UPDATE match_result_decision SET withdrawn_by = app_user_id(), withdrawn_at = now(), withdrawn_note = btrim(p_note)
   WHERE id = p_decision;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_decision_withdraw(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result_decision_withdraw(uuid, text) TO scrbrd_app;

-- ── 3 · Points adjustments (parent design §5.4) ───────────────────
CREATE TABLE IF NOT EXISTS competition_points_adjustment (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  entrant_id     uuid NOT NULL REFERENCES competition_entrant(id) ON DELETE CASCADE,
  match_id       uuid REFERENCES match(id) ON DELETE SET NULL,      -- NULL: a season-level adjustment
  kind           text NOT NULL CHECK (kind IN ('over_rate', 'conduct', 'correction', 'other')),
  points         numeric(4,1) NOT NULL CHECK (points <> 0),          -- negative for a penalty
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 10),
  source_clause  text,
  set_by         uuid NOT NULL REFERENCES app_user(id),
  set_at         timestamptz NOT NULL DEFAULT now(),
  withdrawn_by   uuid REFERENCES app_user(id),
  withdrawn_at   timestamptz,
  withdrawn_note text,
  CONSTRAINT competition_points_adjustment_withdrawal_is_whole
    CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_note IS NULL)),
  CONSTRAINT competition_points_adjustment_withdrawal_says_why
    CHECK (withdrawn_note IS NULL OR length(btrim(withdrawn_note)) >= 10)
);
CREATE INDEX IF NOT EXISTS competition_points_adjustment_competition ON competition_points_adjustment (competition_id);
CREATE INDEX IF NOT EXISTS competition_points_adjustment_entrant ON competition_points_adjustment (entrant_id);

-- The entrant is the competition's, the match (if any) is played under it,
-- and a row is never changed but to withdraw it, once.
CREATE OR REPLACE FUNCTION competition_points_adjustment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM competition_entrant e WHERE e.id = NEW.entrant_id AND e.competition_id = NEW.competition_id) THEN
      RAISE EXCEPTION 'that entrant is in another competition' USING ERRCODE = 'check_violation',
        CONSTRAINT = 'competition_points_adjustment_entrant_fits';
    END IF;
    IF NEW.match_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match m WHERE m.id = NEW.match_id AND m.competition_id = NEW.competition_id) THEN
      RAISE EXCEPTION 'that match is not played under this competition' USING ERRCODE = 'check_violation',
        CONSTRAINT = 'competition_points_adjustment_match_fits';
    END IF;
    NEW.withdrawn_by := NULL; NEW.withdrawn_at := NULL; NEW.withdrawn_note := NULL;
    RETURN NEW;
  END IF;
  IF OLD.withdrawn_at IS NOT NULL
     OR NEW.id <> OLD.id OR NEW.competition_id <> OLD.competition_id OR NEW.entrant_id <> OLD.entrant_id
     OR NEW.match_id IS DISTINCT FROM OLD.match_id OR NEW.kind <> OLD.kind OR NEW.points <> OLD.points
     OR NEW.reason <> OLD.reason OR NEW.source_clause IS DISTINCT FROM OLD.source_clause
     OR NEW.set_by <> OLD.set_by OR NEW.set_at <> OLD.set_at THEN
    RAISE EXCEPTION 'an adjustment is never changed: it is withdrawn, with a note, and another entered'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'competition_points_adjustment_is_kept';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_points_adjustment_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS competition_points_adjustment_guard ON competition_points_adjustment;
CREATE TRIGGER competition_points_adjustment_guard BEFORE INSERT OR UPDATE ON competition_points_adjustment
  FOR EACH ROW EXECUTE FUNCTION competition_points_adjustment_guard();
DROP TRIGGER IF EXISTS public_data_changed ON competition_points_adjustment;
CREATE TRIGGER public_data_changed AFTER INSERT OR UPDATE OR DELETE ON competition_points_adjustment
  FOR EACH ROW EXECUTE FUNCTION public_data_notify('competition', 'competition_id');

ALTER TABLE competition_points_adjustment ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON competition_points_adjustment FROM scrbrd_app;
GRANT SELECT ON competition_points_adjustment TO scrbrd_app;

-- The unit an over-rate penalty is entered in, for a match (its frozen table
-- part) or the season (the version in force today): none, points or runs.
CREATE OR REPLACE FUNCTION competition_over_rate_kind(p_competition uuid, p_match uuid DEFAULT NULL) RETURNS text AS $$
  SELECT coalesce(
    (SELECT c.doc->'table'->>'over_rate.kind' FROM match_conditions c
       JOIN match m ON m.id = c.match_id WHERE c.match_id = p_match AND m.competition_id = p_competition),
    (SELECT v.value #>> '{}' FROM condition_value v
      WHERE v.set_id = condition_set_for(p_competition, sa_today()) AND v.key = 'over_rate.kind' AND v.age_band = ''),
    (SELECT k.platform_default #>> '{}' FROM playing_condition_key k WHERE k.key = 'over_rate.kind'),
    'none')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_over_rate_kind(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_over_rate_kind(uuid, uuid) TO scrbrd_app;

-- Enter an adjustment. (ok, reason, detail, id):
--   not_permitted · support_session · kind_invalid · points_invalid (a
--   non-zero tenth, ±999.9) · reason_required · entrant_invalid ·
--   match_invalid · over_rate_not_points (an over-rate penalty in points
--   only where the competition's over_rate.kind is `points`; a `runs`
--   penalty is a penalty event the scorer records, and `none` has none).
CREATE OR REPLACE FUNCTION competition_points_adjust(p_competition uuid, p_entrant uuid, p_match uuid, p_kind text,
                                                     p_points numeric, p_reason text, p_clause text DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, detail text, adjustment_id uuid) AS $$
DECLARE v_id uuid; v_unit text;
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped() OR NOT competition_conditions_manager(p_competition) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text, NULL::uuid; RETURN;
  END IF;
  IF app_support_access_id() IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session', 'a support session does not adjust a table', NULL::uuid; RETURN;
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('over_rate', 'conduct', 'correction', 'other') THEN
    RETURN QUERY SELECT false, 'kind_invalid', 'over_rate, conduct, correction or other', NULL::uuid; RETURN; END IF;
  IF p_points IS NULL OR p_points = 0 OR abs(p_points) > 999.9 OR p_points <> round(p_points, 1) THEN
    RETURN QUERY SELECT false, 'points_invalid', 'a number of points to a tenth, not nought', NULL::uuid; RETURN; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RETURN QUERY SELECT false, 'reason_required', 'say why, in ten characters or more', NULL::uuid; RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM competition_entrant e WHERE e.id = p_entrant AND e.competition_id = p_competition) THEN
    RETURN QUERY SELECT false, 'entrant_invalid', 'that side is not in this competition', NULL::uuid; RETURN; END IF;
  IF p_match IS NOT NULL AND NOT EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND m.competition_id = p_competition) THEN
    RETURN QUERY SELECT false, 'match_invalid', 'that match is not played under this competition', NULL::uuid; RETURN; END IF;
  IF p_kind = 'over_rate' THEN
    v_unit := competition_over_rate_kind(p_competition, p_match);
    IF v_unit IS DISTINCT FROM 'points' THEN
      RETURN QUERY SELECT false, 'over_rate_not_points',
        CASE v_unit WHEN 'runs' THEN 'this competition''s over-rate penalties are in runs: the scorer records them as penalty runs'
                    ELSE 'this competition has no over-rate penalties' END, NULL::uuid; RETURN;
    END IF;
  END IF;
  INSERT INTO competition_points_adjustment (competition_id, entrant_id, match_id, kind, points, reason, source_clause, set_by)
  VALUES (p_competition, p_entrant, p_match, p_kind, p_points, btrim(p_reason), nullif(btrim(coalesce(p_clause, '')), ''), app_user_id())
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_points_adjust(uuid, uuid, uuid, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_points_adjust(uuid, uuid, uuid, text, numeric, text, text) TO scrbrd_app;

CREATE OR REPLACE FUNCTION competition_points_adjustment_withdraw(p_adjustment uuid, p_note text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE x competition_points_adjustment%ROWTYPE;
BEGIN
  SELECT * INTO x FROM competition_points_adjustment y WHERE y.id = p_adjustment;
  IF NOT FOUND OR app_user_id() IS NULL OR app_pad_scoped() OR NOT competition_conditions_manager(x.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF app_support_access_id() IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session', 'a support session does not adjust a table'; RETURN;
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN
    RETURN QUERY SELECT false, 'note_required', 'say why, in ten characters or more'; RETURN;
  END IF;
  SELECT * INTO x FROM competition_points_adjustment y WHERE y.id = p_adjustment FOR UPDATE;
  IF x.withdrawn_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_withdrawn', NULL::text; RETURN; END IF;
  UPDATE competition_points_adjustment SET withdrawn_by = app_user_id(), withdrawn_at = now(), withdrawn_note = btrim(p_note)
   WHERE id = p_adjustment;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_points_adjustment_withdraw(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_points_adjustment_withdraw(uuid, text) TO scrbrd_app;

-- ── 4 · The table (design §6) ─────────────────────────────────────
-- Every match played under a competition, with its result, as the owner
-- reads them. No guard: the two functions below ask theirs first.
CREATE OR REPLACE FUNCTION competition_results_all(p_competition uuid)
RETURNS TABLE (match_id uuid, starts_at timestamptz, status text,
               home_school_id uuid, home_team_code text, home_label text,
               away_school_id uuid, away_team_code text, away_label text,
               outcome text, margin_kind text, margin integer, decided_by text, winner_side text, winner_key text,
               play_outcome text, play_winner_side text, play_winner_key text, play_margin_kind text, play_margin integer,
               decision jsonb, decision_applied boolean, counted boolean, rates_count boolean, innings jsonb,
               table_doc jsonb, table_sources jsonb, conditions_adjusted boolean, result_hash text) AS $$
  SELECT m.id, m.starts_at, m.status,
         m.school_id, m.team_code, fixture_side_label(m.school_id, m.team_code),
         m.away_school_id, m.away_team_code,
         CASE WHEN m.away_school_id IS NULL THEN m.opponent ELSE fixture_side_label(m.away_school_id, m.away_team_code) END,
         r.outcome, r.margin_kind, r.margin, r.decided_by, r.winner_side, r.winner_key,
         r.play_outcome, r.play_winner_side, r.play_winner_key, r.play_margin_kind, r.play_margin,
         r.decision, r.decision_applied,
         -- Played (§6.2): complete or abandoned and not in progress; or won
         -- by a decision (a walkover needs no status changed to count).
         (m.status IN ('complete', 'abandoned') AND r.outcome <> 'in_progress')
           OR (r.decided_by = 'decision' AND r.outcome IN ('home_win', 'away_win')),
         -- Net run rate (§6.4): play's result only — a win or a tie.
         r.play_outcome IN ('home_win', 'away_win', 'tie'),
         r.innings,
         -- The match's frozen table part; a match never scored (a walkover,
         -- one abandoned before a ball) has none, and counts under the
         -- version in force on its day, as its first event would have fixed.
         coalesce(mc.doc->'table', (SELECT x.doc->'table' FROM match_conditions_compute(m.id) x)),
         coalesce(mc.sources, (SELECT x.sources FROM match_conditions_compute(m.id) x)),
         mc.table_refixed_at IS NOT NULL, r.result_hash
    FROM match m
    LEFT JOIN match_conditions mc ON mc.match_id = m.id
   CROSS JOIN LATERAL match_result_compute(m.id) r
   WHERE m.competition_id = p_competition
   ORDER BY m.starts_at, m.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_results_all(uuid) FROM PUBLIC;

-- The results of a competition, for whoever can reach it (competition_visible()).
CREATE OR REPLACE FUNCTION competition_results(p_competition uuid)
RETURNS TABLE (match_id uuid, starts_at timestamptz, status text,
               home_school_id uuid, home_team_code text, home_label text,
               away_school_id uuid, away_team_code text, away_label text,
               outcome text, margin_kind text, margin integer, decided_by text, winner_side text, winner_key text,
               play_outcome text, play_winner_side text, play_winner_key text, play_margin_kind text, play_margin integer,
               decision jsonb, decision_applied boolean, counted boolean, rates_count boolean, innings jsonb,
               table_doc jsonb, table_sources jsonb, conditions_adjusted boolean, result_hash text) AS $$
  SELECT r.* FROM competition_results_all(p_competition) r WHERE competition_visible(p_competition)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_results(uuid) TO scrbrd_app;

-- The table of one competition: one row per accepted entrant (§6.2–6.4).
-- For whoever can reach the competition, and — the table being public once
-- its page is published (PUBLIC_DATA A1) — for anyone then. Nothing here
-- names a boy or carries a reason.
CREATE OR REPLACE FUNCTION competition_standing_rows(p_competition uuid)
RETURNS TABLE (entrant_id uuid, division_id uuid, school_id uuid, team_code text, display_name text,
               basis text, played integer, won integer, lost integer, tied integer, drawn integer, no_result integer,
               points numeric, adjustment_points numeric, nrr numeric,
               runs_for integer, balls_for integer, runs_against integer, balls_against integer,
               rank integer, table_order jsonb, head_to_head_listed boolean, conditions_adjusted integer,
               unattested_results integer) AS $$
  WITH ok AS (
    SELECT (competition_visible(p_competition) OR competition_published(p_competition)) AS yes
  ),
  res AS MATERIALIZED (
    SELECT r.* FROM ok, competition_results_all(p_competition) r WHERE ok.yes
  ),
  sides AS (
    SELECT r.match_id, s.side, s.school_id, s.team_code, r.table_doc, r.table_sources, r.conditions_adjusted,
           r.rates_count, r.innings,
           CASE WHEN r.outcome IN ('home_win', 'away_win')
                THEN CASE WHEN (r.outcome = 'home_win') = (s.side = 'home') THEN 'win' ELSE 'loss' END
                ELSE r.outcome END AS result
      FROM res r
     CROSS JOIN LATERAL (VALUES ('home', r.home_school_id, r.home_team_code),
                                ('away', r.away_school_id, r.away_team_code)) AS s(side, school_id, team_code)
     WHERE r.counted AND s.school_id IS NOT NULL
  ),
  keyed AS (
    SELECT x.*,
           CASE x.result WHEN 'win' THEN 'points.win' WHEN 'loss' THEN 'points.loss' WHEN 'tie' THEN 'points.tie'
                         WHEN 'draw' THEN 'points.draw' WHEN 'no_result' THEN 'points.no_result'
                         -- An abandoned match takes points.abandoned, falling back
                         -- to points.no_result where the set states none (D15).
                         WHEN 'abandoned' THEN CASE WHEN x.table_doc ? 'points.abandoned' THEN 'points.abandoned'
                                                    ELSE 'points.no_result' END END AS pkey
      FROM sides x
  ),
  valued AS (
    SELECT k.*,
           CASE WHEN jsonb_typeof(k.table_doc->k.pkey) = 'number' THEN (k.table_doc->>k.pkey)::numeric ELSE 0 END AS pts,
           coalesce(k.table_doc ? k.pkey AND k.table_sources->k.pkey->>'status' = 'confirmed', false) AS confirmed,
           -- §6.4, in balls: the side's own scheduled innings and the
           -- other's; all out is charged its allotted (revised) overs.
           (SELECT sum((i->>'runs')::integer) FROM jsonb_array_elements(k.innings) i
             WHERE (i->>'scheduled')::boolean AND i->>'side' = k.side) AS rf,
           (SELECT sum(CASE WHEN i->>'end_reason' = 'all_out' THEN (i->>'overs')::integer * 6 ELSE (i->>'balls')::integer END)
              FROM jsonb_array_elements(k.innings) i WHERE (i->>'scheduled')::boolean AND i->>'side' = k.side) AS bf,
           (SELECT sum((i->>'runs')::integer) FROM jsonb_array_elements(k.innings) i
             WHERE (i->>'scheduled')::boolean AND i->>'side' <> k.side) AS ra,
           (SELECT sum(CASE WHEN i->>'end_reason' = 'all_out' THEN (i->>'overs')::integer * 6 ELSE (i->>'balls')::integer END)
              FROM jsonb_array_elements(k.innings) i WHERE (i->>'scheduled')::boolean AND i->>'side' <> k.side) AS ba
      FROM keyed k
  ),
  per AS (
    SELECT v.school_id, v.team_code,
           count(*)::integer AS played,
           count(*) FILTER (WHERE v.result = 'win')::integer AS won,
           count(*) FILTER (WHERE v.result = 'loss')::integer AS lost,
           count(*) FILTER (WHERE v.result = 'tie')::integer AS tied,
           count(*) FILTER (WHERE v.result = 'draw')::integer AS drawn,
           count(*) FILTER (WHERE v.result IN ('no_result', 'abandoned'))::integer AS no_result,
           sum(v.pts) AS points,
           coalesce(sum(v.rf) FILTER (WHERE v.rates_count), 0)::integer AS rf,
           coalesce(sum(v.bf) FILTER (WHERE v.rates_count), 0)::integer AS bf,
           coalesce(sum(v.ra) FILTER (WHERE v.rates_count), 0)::integer AS ra,
           coalesce(sum(v.ba) FILTER (WHERE v.rates_count), 0)::integer AS ba,
           count(*) FILTER (WHERE v.conditions_adjusted)::integer AS adjusted
      FROM valued v
     GROUP BY v.school_id, v.team_code
  ),
  basis AS (
    -- Computed from the first counted match, when every figure a counted
    -- match reads is confirmed in its frozen document; else the typed ladder.
    SELECT CASE WHEN count(*) > 0 AND bool_and(v.confirmed) THEN 'computed' ELSE 'entered' END AS basis FROM valued v
  ),
  ord AS (
    SELECT coalesce(
             (SELECT v.value FROM condition_value v
               WHERE v.set_id = condition_set_for(p_competition, sa_today()) AND v.key = 'table.order' AND v.age_band = ''
                 AND jsonb_typeof(v.value) = 'array'),
             (SELECT k.platform_default FROM playing_condition_key k WHERE k.key = 'table.order'),
             '["points", "wins", "nrr"]'::jsonb) AS o
  ),
  adj AS (
    SELECT a.entrant_id, sum(a.points) AS pts
      FROM competition_points_adjustment a
     WHERE a.competition_id = p_competition AND a.withdrawn_at IS NULL
     GROUP BY a.entrant_id
  ),
  base AS (
    SELECT e.id, e.division_id, e.school_id, e.team_code, e.display_name, b.basis,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.played, 0) ELSE e.played::integer END AS played,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.won, 0) ELSE e.won::integer END AS won,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.lost, 0) ELSE e.lost::integer END AS lost,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.tied, 0) ELSE 0 END AS tied,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.drawn, 0) ELSE e.drawn::integer END AS drawn,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.no_result, 0) ELSE e.no_result::integer END AS no_result,
           coalesce(adj.pts, 0) AS adjustment_points,
           (CASE WHEN b.basis = 'computed' THEN coalesce(p.points, 0) ELSE e.points::numeric END) + coalesce(adj.pts, 0) AS points,
           CASE WHEN b.basis = 'computed'
                THEN CASE WHEN p.bf > 0 AND p.ba > 0 THEN p.rf::numeric * 6 / p.bf - p.ra::numeric * 6 / p.ba END
                ELSE e.net_run_rate END AS nrr,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.rf, 0) END AS rf,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.bf, 0) END AS bf,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.ra, 0) END AS ra,
           CASE WHEN b.basis = 'computed' THEN coalesce(p.ba, 0) END AS ba,
           coalesce(p.adjusted, 0) AS adjusted
      FROM ok
      JOIN competition_entrant e ON ok.yes AND e.competition_id = p_competition AND e.status = 'accepted'
     CROSS JOIN basis b
      LEFT JOIN per p ON p.school_id = e.school_id AND p.team_code IS NOT DISTINCT FROM e.team_code
      LEFT JOIN adj ON adj.entrant_id = e.id
  )
  SELECT x.id, x.division_id, x.school_id, x.team_code, x.display_name, x.basis,
         x.played, x.won, x.lost, x.tied, x.drawn, x.no_result, x.points, x.adjustment_points, x.nrr,
         x.rf, x.bf, x.ra, x.ba,
         -- table.order (D13): points, wins, nrr, fewer_losses applied; head_to_head
         -- accepted and not applied; equal on every key, the same rank.
         (rank() OVER (PARTITION BY x.division_id ORDER BY
            CASE ord.o->>0 WHEN 'points' THEN x.points WHEN 'wins' THEN x.won WHEN 'nrr' THEN x.nrr WHEN 'fewer_losses' THEN -x.lost END DESC NULLS LAST,
            CASE ord.o->>1 WHEN 'points' THEN x.points WHEN 'wins' THEN x.won WHEN 'nrr' THEN x.nrr WHEN 'fewer_losses' THEN -x.lost END DESC NULLS LAST,
            CASE ord.o->>2 WHEN 'points' THEN x.points WHEN 'wins' THEN x.won WHEN 'nrr' THEN x.nrr WHEN 'fewer_losses' THEN -x.lost END DESC NULLS LAST,
            CASE ord.o->>3 WHEN 'points' THEN x.points WHEN 'wins' THEN x.won WHEN 'nrr' THEN x.nrr WHEN 'fewer_losses' THEN -x.lost END DESC NULLS LAST,
            CASE ord.o->>4 WHEN 'points' THEN x.points WHEN 'wins' THEN x.won WHEN 'nrr' THEN x.nrr WHEN 'fewer_losses' THEN -x.lost END DESC NULLS LAST
          ))::integer,
         ord.o, ord.o ? 'head_to_head', x.adjusted, NULL::integer
    FROM base x CROSS JOIN ord
   ORDER BY x.division_id NULLS LAST, 20, x.display_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_standing_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_standing_rows(uuid) TO scrbrd_app;

-- The view the design names: each competition the reader may read (the
-- competition table's own policy), and its table.
CREATE OR REPLACE VIEW competition_standing WITH (security_invoker = true) AS
SELECT c.id AS competition_id, s.*
  FROM competition c
 CROSS JOIN LATERAL competition_standing_rows(c.id) s;
GRANT SELECT ON competition_standing TO scrbrd_app;

-- ── 5 · A played match's table figures (parent design §3.4) ───────
-- The table part replaced from a NAMED published version of the match's
-- competition (§3.2 means none in force on the day can be newer), with a
-- reason of ten characters or more; the part it replaced kept in
-- table_doc_before; play and the sheet never move (the db/61 guard refuses
-- it). Under competition.conditions.manage, never by a support session.
--   not_permitted · support_session · reason_required · no_document (a
--   match scored before db/61 has no document, and is not given one) ·
--   set_invalid (not a published version of this competition)
CREATE OR REPLACE FUNCTION match_conditions_refix_table(p_match uuid, p_set uuid, p_reason text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE
  m      match%ROWTYPE;
  c      match_conditions%ROWTYPE;
  s      condition_set%ROWTYPE;
  k      playing_condition_key%ROWTYPE;
  v_row  condition_value%ROWTYPE;
  v_tab  jsonb := '{}';
  v_src  jsonb := '{}';
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR m.competition_id IS NULL OR app_user_id() IS NULL OR app_pad_scoped()
     OR NOT competition_conditions_manager(m.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF app_support_access_id() IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session', 'a support session does not re-fix a match''s table figures'; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RETURN QUERY SELECT false, 'reason_required', 'say why, in ten characters or more'; RETURN;
  END IF;
  PERFORM 1 FROM scoring_session x WHERE x.match_id = p_match FOR UPDATE;
  PERFORM match_conditions_lock(p_match);
  SELECT * INTO c FROM match_conditions x WHERE x.match_id = p_match FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_document', 'this match was scored before playing conditions and has none to re-fix'; RETURN;
  END IF;
  SELECT * INTO s FROM condition_set x WHERE x.id = p_set AND x.competition_id = m.competition_id AND x.status = 'published';
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'set_invalid', 'name a published version of this match''s competition'; RETURN;
  END IF;
  FOR k IN SELECT * FROM playing_condition_key x WHERE x.part = 'table' ORDER BY x.sort_order, x.key LOOP
    SELECT * INTO v_row FROM condition_value v WHERE v.set_id = s.id AND v.key = k.key AND v.age_band = '';
    IF FOUND THEN
      v_tab := v_tab || jsonb_build_object(k.key, v_row.value);
      v_src := v_src || jsonb_build_object(k.key, jsonb_strip_nulls(jsonb_build_object(
                 'from', 'set', 'status', v_row.status, 'version', s.version, 'document', v_row.source_document,
                 'clause', v_row.source_clause, 'date', v_row.source_date, 'refixed', true)));
    ELSIF k.platform_default IS NOT NULL THEN
      v_tab := v_tab || jsonb_build_object(k.key, k.platform_default);
      v_src := v_src || jsonb_build_object(k.key, jsonb_build_object('from', 'platform_default', 'status', 'unconfirmed', 'refixed', true));
    ELSE
      v_src := v_src || jsonb_build_object(k.key, jsonb_build_object('from', 'platform_default', 'status', 'unconfirmed', 'refixed', true));
    END IF;
  END LOOP;
  UPDATE match_conditions
     SET doc = jsonb_set(doc, '{table}', v_tab),
         sources = sources || v_src,
         table_doc_before = c.doc->'table',
         table_refixed_at = now(), table_refixed_by = app_user_id(), table_refixed_reason = btrim(p_reason)
   WHERE match_id = p_match;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_conditions_refix_table(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_conditions_refix_table(uuid, uuid, text) TO scrbrd_app;

-- ── 6 · An approved amendment names the result before and after ────
-- db/38's scoring_amendment_decide(), line for line, with ONE addition on the
-- approval path: the result's hash before the void and after it, written to
-- scoring_audit as 'amendment_approved' (design §2.6, 4), so an amendment
-- that flips a result is visible in the audit as one that did. Inside the
-- caller's transaction: the route's Laws check rolling the void back rolls
-- the line back with it. Signature, reasons, their order, the void, the lock
-- and the grants are db/38's.
CREATE OR REPLACE FUNCTION scoring_amendment_decide(
  p_amendment uuid,
  p_approve   boolean,
  p_note      text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text, void_key text) AS $$
DECLARE
  a         scoring_amendment%ROWTYPE;
  v_team    text;
  v_seq     integer;
  v_epoch   integer;
  v_innings smallint;
  v_key     text;
  v_before  record;
  v_after   record;
BEGIN
  -- Read to learn the match; not locked yet (see the header).
  SELECT * INTO a FROM scoring_amendment WHERE id = p_amendment;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_amendment', NULL::text; RETURN; END IF;
  IF a.state <> 'pending' THEN
    RETURN QUERY SELECT false, 'already_' || a.state, NULL::text; RETURN; END IF;

  v_team := match_team(a.match_id);

  -- (1) authority over this match
  IF NOT app_can('scoring.amend.approve', a.school_id, v_team, NULL, a.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;

  -- (2) not your own
  IF a.requested_by = app_user_id() THEN
    RETURN QUERY SELECT false, 'cannot_approve_your_own', NULL::text; RETURN;
  END IF;

  -- The live path's per-match lock (scoring_lease_check), in the live path's
  -- order — session row, then the amendment row — held to the caller's
  -- commit, so nothing is appended to this match between the max(seq) below
  -- and the route's Laws check. db/38.
  PERFORM 1 FROM scoring_session s WHERE s.match_id = a.match_id FOR UPDATE;
  -- ...and asked again under the lock: somebody may have decided it meanwhile.
  SELECT * INTO a FROM scoring_amendment WHERE id = p_amendment FOR UPDATE;
  IF a.state <> 'pending' THEN
    RETURN QUERY SELECT false, 'already_' || a.state, NULL::text; RETURN; END IF;

  IF NOT p_approve THEN
    UPDATE scoring_amendment
       SET state = 'declined', decided_by = app_user_id(),
           decided_at = now(), decided_note = p_note
     WHERE id = p_amendment;
    RETURN QUERY SELECT true, NULL::text, NULL::text; RETURN;
  END IF;

  -- (3) the target is a live delivery in this match
  SELECT b.innings INTO v_innings
    FROM ball_event_live b
   WHERE b.match_id = a.match_id AND b.idempotency_key = a.target_key;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_such_live_delivery', NULL::text; RETURN;
  END IF;

  SELECT coalesce(max(seq), 0) + 1, coalesce(max(epoch), 1)
    INTO v_seq, v_epoch
    FROM ball_event WHERE match_id = a.match_id;

  -- Derived from the amendment id, so the same approval cannot write two voids
  -- even if this function is somehow called twice: the UNIQUE on
  -- idempotency_key refuses the second.
  v_key := 'amendment:' || a.id::text;

  -- The result as the log has it now (db/69).
  SELECT r.outcome, r.result_hash INTO v_before FROM match_result_compute(a.match_id) r;

  -- (4) authored by the requester, approved by the caller
  INSERT INTO ball_event
    (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
     idempotency_key, client_seq, client_ts, kind, payload)
  VALUES
    (a.match_id, a.school_id, v_seq, v_epoch, v_innings, a.requested_by,
     -- Not a scoring device. A correction made at a desk days later did not
     -- come from one, and recording a device that was never involved would put
     -- a fiction in the provenance columns.
     'amendment', v_key, v_seq, now(), 'void',
     jsonb_build_object('target', a.target_key,
                        'amendment', a.id,
                        'approved_by', app_user_id()));

  UPDATE scoring_amendment
     SET state = 'approved', decided_by = app_user_id(),
         decided_at = now(), decided_note = p_note, applied_key = v_key
   WHERE id = p_amendment;

  -- ...and as it has it after the void: the audit line (db/69).
  SELECT r.outcome, r.result_hash INTO v_after FROM match_result_compute(a.match_id) r;
  INSERT INTO scoring_audit (match_id, school_id, event, actor_id, epoch, detail)
  VALUES (a.match_id, a.school_id, 'amendment_approved', app_user_id(), v_epoch,
          jsonb_build_object('amendment', a.id, 'void_key', v_key,
                             'outcome_before', v_before.outcome, 'result_hash_before', v_before.result_hash,
                             'outcome_after', v_after.outcome, 'result_hash_after', v_after.result_hash,
                             'result_changed', v_before.result_hash IS DISTINCT FROM v_after.result_hash));

  RETURN QUERY SELECT true, NULL::text, v_key;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION scoring_amendment_decide(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scoring_amendment_decide(uuid, boolean, text) TO PUBLIC;

-- ── 7 · Innings a side, from the fixture's own format ─────────────
-- db/61's match_conditions_compute(), line for line, but for the fixture's
-- `format.innings_per_side`: 2 only for a two-day or longer match, 1 for
-- every other format stated — a One-Day Declaration (timed) match is one
-- innings a side, as fixtureFormatFrom() (conditions.mjs) and the planner
-- (db/67) already read it. db/61 said 2 for every declaration format, which
-- match_result() would read as a draw once complete. Documents already
-- fixed are frozen and not touched (§3.3); see the design's §10.
CREATE OR REPLACE FUNCTION match_conditions_compute(p_match uuid)
RETURNS TABLE (set_id uuid, set_version smallint, doc jsonb, sources jsonb) AS $$
DECLARE
  m        match%ROWTYPE;
  v_day    date;
  v_set    condition_set%ROWTYPE;
  k        playing_condition_key%ROWTYPE;
  v_val    jsonb;
  v_src    jsonb;
  v_parts  jsonb := '{"play": {}, "table": {}, "sheet": {}}';
  v_srcs   jsonb := '{}';
  v_row    condition_value%ROWTYPE;
  v_ovr    match_condition_override%ROWTYPE;
  v_fixture jsonb;
  v_band   jsonb;
  v_bsrc   jsonb;
BEGIN
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND THEN RETURN; END IF;
  v_day := (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date;
  IF m.competition_id IS NOT NULL THEN
    SELECT * INTO v_set FROM condition_set s WHERE s.id = condition_set_for(m.competition_id, v_day);
  END IF;
  FOR k IN SELECT * FROM playing_condition_key ORDER BY sort_order, key LOOP
    v_val := NULL; v_src := NULL; v_fixture := NULL;
    -- 1. the platform's default
    IF k.platform_default IS NOT NULL THEN
      v_val := k.platform_default;
      v_src := jsonb_build_object('from', 'platform_default', 'status', 'unconfirmed');
    END IF;
    -- 2. the version in force
    IF v_set.id IS NOT NULL THEN
      IF k.by_age_band THEN
        v_band := NULL; v_bsrc := NULL;
        FOR v_row IN SELECT * FROM condition_value cv WHERE cv.set_id = v_set.id AND cv.key = k.key ORDER BY cv.age_band LOOP
          v_band := coalesce(v_band, '{}') || jsonb_build_object(v_row.age_band, v_row.value);
          v_bsrc := coalesce(v_bsrc, '{}') || jsonb_build_object(v_row.age_band, jsonb_strip_nulls(jsonb_build_object(
                      'from', 'set', 'status', v_row.status, 'version', v_set.version,
                      'document', v_row.source_document, 'clause', v_row.source_clause, 'date', v_row.source_date)));
        END LOOP;
        IF v_band IS NOT NULL THEN v_val := v_band; v_src := v_bsrc; END IF;
      ELSE
        SELECT * INTO v_row FROM condition_value cv WHERE cv.set_id = v_set.id AND cv.key = k.key AND cv.age_band = '';
        IF FOUND THEN
          v_val := v_row.value;
          v_src := jsonb_strip_nulls(jsonb_build_object('from', 'set', 'status', v_row.status, 'version', v_set.version,
                     'document', v_row.source_document, 'clause', v_row.source_clause, 'date', v_row.source_date));
        END IF;
      END IF;
    END IF;
    -- 3. the fixture: what the umpires agreed on the day, and what the
    --    fixture screen shows. The free hit follows the version when it
    --    states one, else the format, as today.
    v_fixture := CASE k.key
      WHEN 'format.kind' THEN
        CASE WHEN btrim(coalesce(m.format, '')) = '' THEN NULL
             WHEN free_hits_apply(m.format) THEN '"limited"'::jsonb ELSE '"declaration"'::jsonb END
      WHEN 'format.overs_per_innings' THEN to_jsonb(m.overs::integer)
      WHEN 'format.innings_per_side' THEN
        -- db/69: two innings a side for a two-day or longer match only.
        CASE WHEN btrim(coalesce(m.format, '')) = '' THEN NULL
             WHEN lower(regexp_replace(btrim(m.format), '\s+', ' ', 'g')) IN
                  ('two-day', 'two day', 'three-day', 'three day', 'four-day', 'four day', 'five-day', 'five day',
                   'multi-day', 'multi day', 'test') THEN '2'::jsonb
             ELSE '1'::jsonb END
      WHEN 'format.free_hit' THEN
        CASE WHEN v_src->>'from' = 'set' THEN NULL ELSE to_jsonb(free_hits_apply(m.format)) END
    END;
    IF v_fixture IS NOT NULL AND jsonb_typeof(v_fixture) <> 'null' THEN
      v_val := v_fixture;
      v_src := jsonb_build_object('from', 'fixture', 'status', 'confirmed');
    END IF;
    -- 4. the fixture's own departures, each with its reason
    IF k.by_age_band THEN
      FOR v_ovr IN SELECT * FROM match_condition_override o WHERE o.match_id = p_match AND o.key = k.key ORDER BY o.age_band LOOP
        v_val := CASE WHEN jsonb_typeof(v_val) = 'object' THEN v_val ELSE '{}' END || jsonb_build_object(v_ovr.age_band, v_ovr.value);
        v_src := CASE WHEN jsonb_typeof(v_src) = 'object' AND v_src->>'from' IS NULL THEN v_src ELSE '{}' END
                 || jsonb_build_object(v_ovr.age_band, jsonb_build_object('from', 'override', 'status', 'confirmed', 'reason', v_ovr.reason));
      END LOOP;
    ELSE
      SELECT * INTO v_ovr FROM match_condition_override o WHERE o.match_id = p_match AND o.key = k.key AND o.age_band = '';
      IF FOUND THEN
        v_val := v_ovr.value;
        v_src := jsonb_build_object('from', 'override', 'status', 'confirmed', 'reason', v_ovr.reason);
      END IF;
    END IF;
    IF v_val IS NOT NULL THEN
      v_parts := jsonb_set(v_parts, ARRAY[k.part], (v_parts->k.part) || jsonb_build_object(k.key, v_val));
    END IF;
    -- A key a reader consults says where its figure came from, stated or not.
    IF v_src IS NOT NULL THEN
      v_srcs := v_srcs || jsonb_build_object(k.key, v_src);
    ELSIF cardinality(k.readers) > 0 THEN
      v_srcs := v_srcs || jsonb_build_object(k.key, jsonb_build_object('from', 'platform_default', 'status', 'unconfirmed'));
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_set.id, v_set.version, jsonb_build_object('v', 1) || v_parts, v_srcs;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_conditions_compute(uuid) FROM PUBLIC;

-- ── 8 · The signed-out reads (SCRBRD-083: sides, never boys) ──────
-- The result of a served fixture, as structure: who won, by what, who
-- decided, and the decision's kind and side — never its reason, which is an
-- organiser's free text (PUBLIC_DATA §3). The API names the sides from the
-- header's labels (services/api/public/public-api.mjs).
CREATE OR REPLACE FUNCTION public_match_result(p_match uuid)
RETURNS TABLE (outcome text, margin_kind text, margin integer, decided_by text, winner_side text,
               play_outcome text, play_winner_side text, play_margin_kind text, play_margin integer,
               decision_applied boolean, decision_kind text, decision_side text, decision_overrides_play boolean) AS $$
  SELECT r.outcome, r.margin_kind, r.margin, r.decided_by, r.winner_side,
         r.play_outcome, r.play_winner_side, r.play_margin_kind, r.play_margin,
         r.decision_applied, r.decision->>'kind', r.decision->>'side', (r.decision->>'overrides_play')::boolean
    FROM match_result_compute(p_match) r
   WHERE public_fixture_served(p_match)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_match_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_result(uuid) TO scrbrd_app;

-- A published competition's table (A1): sides and figures; no adjustment's
-- reason, no basis detail beyond its name, no boy.
CREATE OR REPLACE FUNCTION public_competition_standing(p_competition uuid)
RETURNS TABLE (rank integer, division text, side text, played integer, won integer, lost integer, tied integer,
               drawn integer, no_result integer, points numeric, nrr numeric, basis text) AS $$
  SELECT s.rank, d.name, s.display_name, s.played, s.won, s.lost, s.tied, s.drawn, s.no_result, s.points,
         round(s.nrr, 3), s.basis
    FROM competition_standing_rows(p_competition) s
    LEFT JOIN competition_division d ON d.id = s.division_id
   WHERE competition_published(p_competition)
   ORDER BY d.rank NULLS LAST, s.rank, s.display_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_competition_standing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_competition_standing(uuid) TO scrbrd_app;

-- ── 9 · Grants ────────────────────────────────────────────────────
-- The rule functions run as their caller and keep PostgreSQL's default
-- EXECUTE, as every rule the career views call does; on a managed host the
-- platform's own API roles get nothing new, as db/47 and db/59 take back.
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON match_result_decision, competition_points_adjustment, competition_standing FROM %I', r);
      FOREACH f IN ARRAY ARRAY[
          'match_result(uuid)', 'match_result_compute(uuid)', 'match_result_readable(uuid)',
          'innings_result_state(uuid,smallint,jsonb,boolean)', 'penalty_carried_as_folded(uuid,smallint)',
          'innings_over_reason(integer,integer,integer,integer,integer,integer)', 'result_key_eq(text,text)',
          'match_competition_of(uuid)', 'match_result_decider(uuid)',
          'match_result_decide(uuid,text,text,text,boolean)', 'match_result_decision_withdraw(uuid,text)',
          'competition_over_rate_kind(uuid,uuid)', 'competition_points_adjust(uuid,uuid,uuid,text,numeric,text,text)',
          'competition_points_adjustment_withdraw(uuid,text)', 'competition_results_all(uuid)', 'competition_results(uuid)',
          'competition_standing_rows(uuid)', 'match_conditions_refix_table(uuid,uuid,text)',
          'public_match_result(uuid)', 'public_competition_standing(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

-- ── 10 · Row-level security ───────────────────────────────────────
-- ┌── GENERATED from packages/policy/src/tables.mjs by services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09). DO NOT EDIT BY HAND; `pnpm rls:generate` rewrites it.

-- match_result_decision — read: fixture.read (from 2 scopes) · write: competition.manage
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE match_result_decision ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_result_decision_read   ON match_result_decision;
DROP POLICY IF EXISTS match_result_decision_insert ON match_result_decision;
DROP POLICY IF EXISTS match_result_decision_update ON match_result_decision;
DROP POLICY IF EXISTS match_result_decision_delete ON match_result_decision;

CREATE POLICY match_result_decision_read ON match_result_decision
  FOR SELECT USING (((app_can('fixture.read', (match_school(match_result_decision.match_id)), (match_team(match_result_decision.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_result_decision.match_id))
    OR app_can('fixture.read', (SELECT m.away_school_id FROM match m WHERE m.id = match_result_decision.match_id), (SELECT m.away_team_code FROM match m WHERE m.id = match_result_decision.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_result_decision.match_id))
    OR (competition_visible(match_competition_of(match_result_decision.match_id))));

CREATE POLICY match_result_decision_insert ON match_result_decision
  FOR INSERT WITH CHECK (app_can('competition.manage', (match_school(match_result_decision.match_id)), (match_team(match_result_decision.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_result_decision.match_id));

CREATE POLICY match_result_decision_update ON match_result_decision
  FOR UPDATE USING (app_can('competition.manage', (match_school(match_result_decision.match_id)), (match_team(match_result_decision.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_result_decision.match_id))
           WITH CHECK (app_can('competition.manage', (match_school(match_result_decision.match_id)), (match_team(match_result_decision.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_result_decision.match_id));

-- competition_points_adjustment — read: competition.read · write: competition.conditions.manage
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE competition_points_adjustment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competition_points_adjustment_read   ON competition_points_adjustment;
DROP POLICY IF EXISTS competition_points_adjustment_insert ON competition_points_adjustment;
DROP POLICY IF EXISTS competition_points_adjustment_update ON competition_points_adjustment;
DROP POLICY IF EXISTS competition_points_adjustment_delete ON competition_points_adjustment;

CREATE POLICY competition_points_adjustment_read ON competition_points_adjustment
  FOR SELECT USING ((app_can('competition.read', (competition_organiser(competition_points_adjustment.competition_id)), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    OR (competition_visible(competition_points_adjustment.competition_id)));

CREATE POLICY competition_points_adjustment_insert ON competition_points_adjustment
  FOR INSERT WITH CHECK (app_can('competition.conditions.manage', (competition_organiser(competition_points_adjustment.competition_id)), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY competition_points_adjustment_update ON competition_points_adjustment
  FOR UPDATE USING (app_can('competition.conditions.manage', (competition_organiser(competition_points_adjustment.competition_id)), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('competition.conditions.manage', (competition_organiser(competition_points_adjustment.competition_id)), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- └── END GENERATED

-- The pad's credential reads and writes neither (db/50's guard, as every
-- table behind RLS carries).
SELECT pad_scope_guard_install('match_result_decision'::regclass);
SELECT pad_scope_guard_install('competition_points_adjustment'::regclass);

-- ── 11 · The proof ────────────────────────────────────────────────
-- Built and rolled back. db/99 §47 is the fuller proof, under the
-- application role, on every verify paste; tools/smoke-fold-figures.mjs
-- holds match_result() to the fold over result-logs.mjs. This is what must
-- hold the moment the file has run.
DO $check$
DECLARE
  r        record;
  n        integer;
  got      text;
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_won    uuid := gen_random_uuid();   -- a chase won by 9 wickets
  v_abd    uuid := gen_random_uuid();   -- a chase sealed abandoned
  v_k      integer := 0;
  T        timestamptz := '2026-10-03 10:00+02';
  sq       jsonb := (SELECT jsonb_agg(jsonb_build_object('id', 'P' || g, 'name', 'P' || g)) FROM generate_series(1, 11) g);
BEGIN
  -- 1. What was re-emitted keeps its signature, attributes and grants.
  FOR r IN SELECT * FROM _db69_before LOOP
    IF (SELECT jsonb_build_object(
              'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
              'definer', p.prosecdef, 'volatility', p.provolatile, 'strict', p.proisstrict,
              'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
              'language', p.prolang) FROM pg_proc p WHERE p.oid = r.obj::regprocedure) IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/69: % changed shape', r.obj;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _db69_before) <> 2 THEN RAISE EXCEPTION 'db/69: the snapshot is not the two functions this file replaces'; END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_class c WHERE c.oid = 'competition_standing'::regclass), false) THEN
    RAISE EXCEPTION 'db/69: competition_standing runs as its owner';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid IN ('match_result_compute(uuid)'::regprocedure,
               'innings_result_state(uuid,smallint,jsonb,boolean)'::regprocedure) AND p.prosecdef)
     OR has_function_privilege('scrbrd_app', 'match_result_compute(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/69: a result is computed as its owner, or the application may compute one past its guard';
  END IF;
  IF has_function_privilege('scrbrd_app', 'competition_results_all(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/69: the application may read every competition''s results with no guard';
  END IF;

  -- 2. Two logs: the abandoned seal is no result, never a win by runs.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db69-' || v_school, 'db/69 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db69-' || v_user || '@example.invalid', 'db/69 proof', 'scorer', v_school);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (v_won, v_school, '1XI', 'Kearsney', T, 'cricket', 'T20', 20, 'complete'),
      (v_abd, v_school, '1XI', 'Kearsney', T, 'cricket', 'T20', 20, 'live');
    -- One row per statement, as the write path writes. Both matches: Hilton
    -- 14 off an over, sealed; Kearsney chasing 15: 6, 4, W. v_won goes on, 4
    -- and 1, reaching it; v_abd stops there (`both` false: v_won's alone).
    FOR r IN
      SELECT mm, x.*
        FROM unnest(ARRAY[v_won, v_abd]) AS mm
       CROSS JOIN (VALUES
         (1,  true,  0, 'innings_start', NULL, NULL::int, NULL, jsonb_build_object('battingTeam', '1XI', 'bowlingTeam', 'Kearsney', 'squad', sq, 'overs', 1)),
         (2,  true,  0, 'ball', 'run', 4, NULL, '{}'::jsonb), (3, true, 0, 'ball', 'run', 1, NULL, '{}'::jsonb),
         (4,  true,  0, 'ball', 'run', 0, NULL, '{}'::jsonb), (5, true, 0, 'ball', 'run', 2, NULL, '{}'::jsonb),
         (6,  true,  0, 'ball', 'run', 6, NULL, '{}'::jsonb), (7, true, 0, 'ball', 'run', 1, NULL, '{}'::jsonb),
         (8,  true,  0, 'innings_end', NULL, NULL, NULL, '{"reason":"overs_complete","confirmed":{"runs":14,"wickets":0,"balls":6}}'::jsonb),
         (9,  true,  1, 'innings_start', NULL, NULL, NULL, jsonb_build_object('battingTeam', 'Kearsney', 'bowlingTeam', '1XI', 'squad', sq, 'overs', 1, 'target', 15)),
         (10, true,  1, 'ball', 'run', 6, NULL, '{}'::jsonb), (11, true, 1, 'ball', 'run', 4, NULL, '{}'::jsonb),
         (12, true,  1, 'ball', 'W', 0, 'bowled', '{}'::jsonb),
         (13, false, 1, 'ball', 'run', 4, NULL, '{}'::jsonb), (14, false, 1, 'ball', 'run', 1, NULL, '{}'::jsonb)
       ) AS x(seq, both_, inn, kind, bt, v, dis, payload)
       WHERE x.both_ OR mm = v_won
       ORDER BY mm, x.seq
    LOOP
      v_k := v_k + 1;
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, dismissal, payload)
      VALUES (r.mm, v_school, r.seq, 1, r.inn, v_user, 'db69-pad', 'db69:' || v_k, r.seq, T, r.kind, r.bt, r.v, r.dis, r.payload);
    END LOOP;
    -- v_abd: 6, 4, W, then the umpires call it: sealed abandoned at 10 for 1 off 3
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, payload)
    VALUES (v_abd, v_school, 100, 1, 1, v_user, 'db69-pad', 'db69:seal', 100, T, 'innings_end',
            '{"reason":"abandoned","confirmed":{"runs":10,"wickets":1,"balls":3}}');
    SELECT string_agg(x.label || '=' || concat_ws(',', r2.outcome, r2.margin_kind, r2.margin, r2.decided_by, r2.winner_side), ' ' ORDER BY x.label)
      INTO got
      FROM (VALUES ('abd', v_abd), ('won', v_won)) AS x(label, m), LATERAL match_result_compute(x.m) r2;
    IF got IS DISTINCT FROM 'abd=no_result won=away_win,wickets,9,play,away' THEN
      RAISE EXCEPTION 'db/69: match_result reads %', got;
    END IF;
    -- A decision: an award with no ball bowled is refused by the trigger;
    -- an override that is not an award by the table's CHECK.
    BEGIN
      INSERT INTO match_result_decision (match_id, kind, side, reason, overrides_play, decided_by)
      VALUES (v_won, 'conceded', 'home', 'not an award at all here', true, v_user);
      RAISE EXCEPTION 'db/69: a concession overrode play';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO match_result_decision (match_id, kind, side, reason, overrides_play, decided_by)
    VALUES (v_won, 'awarded', 'home', 'protest upheld by the committee', true, v_user);
    IF (SELECT row(r2.outcome, r2.margin_kind, r2.decided_by, r2.play_outcome)::text FROM match_result_compute(v_won) r2)
       IS DISTINCT FROM '(home_win,awarded,decision,away_win)' THEN
      RAISE EXCEPTION 'db/69: the override reads %', (SELECT row(r2.outcome, r2.margin_kind, r2.decided_by, r2.play_outcome)::text FROM match_result_compute(v_won) r2);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ069', MESSAGE = 'db/69: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ069' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/69: the proof left something behind'; END IF;
END $check$;

DROP TABLE _db69_before;
