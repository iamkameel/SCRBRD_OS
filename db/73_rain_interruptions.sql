-- ══════════════════════════════════════════════════════════════════
--  73 · Rain: interruptions in the log, the par clause, the deemed
--       net-run-rate figures (SCRBRD-130 phase R1)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-130_rain_and_par.md §2 and
-- §5, built to D1–D14 as decided (Kameel, 2026-09-30; G50 2026-10-01); its
-- §9 records the build. The events, the fold, the Laws and the words are
-- packages/scoring (events.mjs playStopped()/playResumed() and revision.par,
-- replay.mjs inn.stopped/inn.interruptions/inn.par and describeResult()'s
-- par clause, laws.mjs's six refusals, result.mjs's suffix); this file is
-- what SQL needs of them, and agrees with the fold by construction:
-- tools/smoke-fold-figures.mjs folds every log of
-- packages/scoring/test/rain-logs.mjs both ways, and db/99 §52 proves it
-- under the application role.
--
-- THE EVENTS. `play_stopped` {reason, note?, at?} and `play_resumed` {at?}
-- are ball_event rows like any other: their figures ride in the payload,
-- no column is added, and every SQL reader of a delivery already filters
-- `kind = 'ball'`, so a log with no stop — every log before this file —
-- reads exactly as it did. `revision` gains one optional key, `par`: the
-- umpires' announced par when a chase cannot resume. NOTHING ABOUT DLS IS
-- WRITTEN INTO THE LOG: the umpires' figures are (D1); a calculation is a
-- read (R2, db/75), never stored.
--
-- WHAT IS HERE.
--
--   target.method, target.g50         the catalogue (§1): the method's values
--                                     are umpires_revision (the default,
--                                     today's) and dls_standard (D4: no
--                                     average run rate); G50 is a league's
--                                     figure with its source, no platform
--                                     default (D7, Kameel 2026-10-01). Neither
--                                     value is in this file.
--   innings_stop_open(m, i)           a stop with no resumption after it: the
--                                     last stop-or-resume row of the innings is
--                                     a stop (the fold ignores a second stop
--                                     and a resumption with none open, so its
--                                     state is the last row's).
--   innings_par_as_folded(m, i)       the last revision.par of the innings that
--                                     is a whole number (inn.par).
--   innings_stop_as_folded(m, i)      the design's `stopped` and `par` (§2.2),
--                                     for a reader of the log: stopped is an
--                                     open stop in an innings no seal closed
--                                     (the fold: a standing seal terminates the
--                                     interruption). See DEPARTURE below.
--   match_result_compute(m)           db/71's, with three marked blocks (§5):
--                                     each innings' `par` and `stopped`; a
--                                     chase sealed `abandoned` WITH a par is
--                                     decided on it (D2), result.min_overs_per_
--                                     side reading the overs FACED there; and,
--                                     where the chase's target was revised (a
--                                     par, or a target other than the first
--                                     innings plus one), `revised_target` on
--                                     the chase (the frozen target.method: the
--                                     words' suffix) and the first innings'
--                                     `nrr_runs`/`nrr_balls`, the deemed
--                                     figures (D8). Signature unchanged.
--   competition_standing_rows(c)      db/69's, net run rate reading the deemed
--                                     figures where an innings carries them.
--   public_match_log(m, since)        db/71's, with the two kinds and the
--                                     `par` and `at` keys: the stop and resume
--                                     lines a spectator sees (§5). A stop's
--                                     free-text note is never selected.
--
-- DEPARTURE (design §2.2, §3.5). The design gives innings_score_as_folded()
-- (db/45) two more columns. That function is the handover check's count:
-- its RETURNS TABLE is what scoring_verify_takeover() and db/45/db/48's
-- checks read, and a changed RETURNS TABLE is a DROP and a CREATE of the
-- function the live write path calls. Its figures are unchanged; the two
-- new facts are innings_stop_as_folded() beside it, the same reader's.
--
-- REBASING. This file re-emits three functions whole. §0 refuses to run
-- unless each is still the body this file was written against: db/71's
-- match_result_compute() and public_match_log() (the super over, merged in
-- 2026-10-01: the rain blocks read the match's own innings, v_mi, so a
-- super over is never revised and rain never sets its target), db/69's
-- competition_standing_rows(). A later file that re-emits one must be
-- merged into the blocks below and the hash in §0 moved with it, rather
-- than overwritten by this file without a word.
--
-- RLS. Nothing new to read or write: the functions run as their caller over
-- ball_event_live (the rule functions), or are db/69's and db/71's definers
-- behind their own guards, unchanged.

-- ── 0 · What this file replaces, before it does ───────────────────
DO $guard$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('match_result_compute(uuid)', '69b8c241eaca3666f7387bf13bd2bb5d', 'db/71'),
      ('competition_standing_rows(uuid)', 'e9f604c8385a74cea6da3df82a5de87b', 'db/69'),
      ('public_match_log(uuid,integer)', '640271c3417de516a043653c07195e32', 'db/71')) AS x(fn, h, src)
  LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM r.h THEN
      RAISE EXCEPTION 'db/73: % is not %''s any more; merge this file''s marked blocks into the version now in place and move its hash', r.fn, r.src;
    END IF;
  END LOOP;
END $guard$;

DROP TABLE IF EXISTS _db73_before;
CREATE TEMP TABLE _db73_before AS
SELECT p.oid::regprocedure::text AS obj,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef, 'volatility', p.provolatile, 'strict', p.proisstrict,
         'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
         'language', p.prolang) AS shape
  FROM pg_proc p
 WHERE p.oid IN ('match_result_compute(uuid)'::regprocedure, 'competition_standing_rows(uuid)'::regprocedure,
                 'public_match_log(uuid,integer)'::regprocedure);

-- ── 1 · The catalogue: the rain rule's two keys ───────────────────
-- conditions.mjs CONDITION, row for row; db/99 §39 compares the two. Neither
-- has a platform figure for G50: a league states one, with its source.
--
-- The key's shape takes a digit after a segment's first character, so the
-- design's `target.g50` is a key (db/61 allowed letters and underscores
-- only). conditions.mjs's KEY_SHAPE is the same; the deny-list is untouched.
ALTER TABLE playing_condition_key DROP CONSTRAINT IF EXISTS playing_condition_key_key_check;
ALTER TABLE playing_condition_key ADD CONSTRAINT playing_condition_key_key_check
  CHECK (key ~ '^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$' AND key !~ '^(quota|transformation|race)\.');
UPDATE playing_condition_key
   SET enum_values = '{umpires_revision,dls_standard}', readers = '{fold,sql}', sort_order = 90
 WHERE key = 'target.method';
INSERT INTO playing_condition_key (key, part, value_type, unit, enum_values, by_age_band, platform_default, readers, sort_order) VALUES
  ('target.g50', 'play', 'int', 'runs', NULL, false, NULL, '{pad}', 91)
ON CONFLICT (key) DO NOTHING;

-- ── 2 · A stop, and the par, as the fold reads them ──────────────
-- Over ball_event_live as the caller may read it (voids honoured).
CREATE OR REPLACE FUNCTION innings_stop_open(p_match uuid, p_innings smallint) RETURNS boolean AS $$
  SELECT coalesce((SELECT b.kind = 'play_stopped'
                     FROM ball_event_live b
                    WHERE b.match_id = p_match AND b.innings = p_innings AND b.kind IN ('play_stopped', 'play_resumed')
                    ORDER BY b.seq DESC LIMIT 1), false)
$$ LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION innings_par_as_folded(p_match uuid, p_innings smallint) RETURNS integer AS $$
  SELECT (b.payload->>'par')::numeric::integer
    FROM ball_event_live b
   WHERE b.match_id = p_match AND b.innings = p_innings AND b.kind = 'revision'
     AND jsonb_typeof(b.payload->'par') = 'number'
     AND (b.payload->>'par')::numeric = trunc((b.payload->>'par')::numeric)
   ORDER BY b.seq DESC LIMIT 1
$$ LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- inn.stopped and inn.par (design §2.2): an open stop in an innings no
-- standing seal has closed — innings_result_state()'s `sealed`, the fold's
-- seal rule (sealRefusal()) — and the umpires' last par.
CREATE OR REPLACE FUNCTION innings_stop_as_folded(p_match uuid, p_innings smallint)
RETURNS TABLE (stopped boolean, par integer) AS $$
  SELECT innings_stop_open(p_match, p_innings) AND NOT coalesce(s.sealed, false),
         innings_par_as_folded(p_match, p_innings)
    FROM match m
    LEFT JOIN match_conditions c ON c.match_id = m.id
    LEFT JOIN LATERAL innings_result_state(p_match, p_innings, coalesce(c.doc->'play', '{}'::jsonb),
                                           (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date >= DATE '2026-10-01') s ON true
   WHERE m.id = p_match
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
GRANT EXECUTE ON FUNCTION innings_stop_as_folded(uuid, smallint) TO scrbrd_app;

-- ── 3 · The result: db/71's (db/69's with the super over), with the rain blocks (§5) ──
-- describeResult() and revisedTargetMethod() (replay.mjs), line for line.
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
  v_method text;      -- SCRBRD-130 R1
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
      'key', s.team_key, 'batting_team', s.batting_team, 'squad', s.squad_size, 'revised', s.revised, 'summarised', s.summarised)
      -- ── SCRBRD-130 R1: the umpires' par, and an open stop (inn.par, inn.stopped) ──
      || jsonb_build_object('par', innings_par_as_folded(p_match, i.innings),
                            'stopped', innings_stop_open(p_match, i.innings) AND NOT coalesce(s.sealed, false)));
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

  -- ── SCRBRD-130 R1: a revised chase target (revisedTargetMethod(), D8) ──
  -- One innings a side, the chase carrying a par or a target other than the
  -- first innings plus one: the chase says under which method (the words'
  -- suffix), and the first innings carries its deemed figures for net run
  -- rate — the par, or the last announced target less one, off the chase's
  -- allotted balls (its balls faced, when it was terminated). The match's
  -- own two innings only (v_mi, db/71): a super over is never revised, and
  -- rain never sets its target. They lead v_inns (a super over's innings
  -- number follows the match's), so the positions written are theirs.
  IF v_ips = 1 AND jsonb_array_length(v_mi) >= 2
     AND v_inns->0->'super_over' = 'null'::jsonb AND v_inns->1->'super_over' = 'null'::jsonb THEN
    x0 := v_mi->0; x1 := v_mi->1;
    IF jsonb_typeof(x1->'par') = 'number'
       OR (jsonb_typeof(x1->'target') = 'number' AND (x1->>'target')::integer IS DISTINCT FROM (x0->>'runs')::integer + 1) THEN
      v_method := CASE WHEN v_play->>'target.method' = 'dls_standard' THEN 'dls_standard' ELSE 'umpires_revision' END;
      v_inns := jsonb_set(v_inns, '{1}', x1 || jsonb_build_object('revised_target', v_method));
      v_inns := jsonb_set(v_inns, '{0}', x0 || jsonb_build_object(
        'nrr_runs', coalesce((x1->>'par')::integer, (x1->>'target')::integer - 1),
        'nrr_balls', CASE WHEN x1->>'end_reason' = 'abandoned' THEN (x1->>'balls')::integer ELSE (x1->>'overs')::integer * 6 END));
      v_mi := jsonb_set(jsonb_set(v_mi, '{1}', v_inns->1), '{0}', v_inns->0);
    END IF;
  END IF;
  -- ── end SCRBRD-130 R1 ──
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
      -- ── SCRBRD-130 R1 (D2): a chase terminated with the umpires' par is
      -- decided on it; without one, no result. result.min_overs_per_side
      -- reads the overs faced (whole overs of legal balls) here. ──
      v_least := v_play->'result.min_overs_per_side';
      IF jsonb_typeof(x1->'par') IS DISTINCT FROM 'number' THEN
        p_out := 'no_result';
      ELSIF jsonb_typeof(v_least) = 'number' AND (v_least #>> '{}')::numeric = trunc((v_least #>> '{}')::numeric)
            AND (v_least #>> '{}')::numeric > 0 AND (x1->>'balls')::integer / 6 < (v_least #>> '{}')::numeric THEN
        p_out := 'no_result';
      ELSIF (x1->>'runs')::integer > (x1->>'par')::integer THEN
        p_out := 'win'; win := x1; p_kind := 'wickets';
        p_margin := least(10, coalesce(nullif((x1->>'squad')::integer, 0), 11) - 1) - (x1->>'wickets')::integer;
      ELSIF (x1->>'runs')::integer = (x1->>'par')::integer THEN
        p_out := 'tie';
      ELSE
        p_out := 'win'; win := x0; p_kind := 'runs'; p_margin := (x1->>'par')::integer - (x1->>'runs')::integer;
      END IF;
      -- ── end SCRBRD-130 R1 ──
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
REVOKE ALL ON FUNCTION match_result_compute(uuid) FROM PUBLIC;

-- ── 4 · The table: db/69's, net run rate reading the deemed figures ─
-- §6.4 in balls, as db/69 has it, but where match_result_compute() deemed
-- an innings' figures (D8: the first innings of a match whose chase's
-- target was revised) those are read instead: runs `nrr_runs` off
-- `nrr_balls`. Every other line as db/69 has it.
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
           -- SCRBRD-130 R1 (D8): an innings' deemed figures where it has them.
           (SELECT sum(coalesce((i->>'nrr_runs')::integer, (i->>'runs')::integer)) FROM jsonb_array_elements(k.innings) i
             WHERE (i->>'scheduled')::boolean AND i->>'side' = k.side) AS rf,
           (SELECT sum(coalesce((i->>'nrr_balls')::integer,
                                CASE WHEN i->>'end_reason' = 'all_out' THEN (i->>'overs')::integer * 6 ELSE (i->>'balls')::integer END))
              FROM jsonb_array_elements(k.innings) i WHERE (i->>'scheduled')::boolean AND i->>'side' = k.side) AS bf,
           (SELECT sum(coalesce((i->>'nrr_runs')::integer, (i->>'runs')::integer)) FROM jsonb_array_elements(k.innings) i
             WHERE (i->>'scheduled')::boolean AND i->>'side' <> k.side) AS ra,
           (SELECT sum(coalesce((i->>'nrr_balls')::integer,
                                CASE WHEN i->>'end_reason' = 'all_out' THEN (i->>'overs')::integer * 6 ELSE (i->>'balls')::integer END))
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

-- ── 5 · The public log: db/71's, with the stop and resume lines ────
-- db/71's line for line, but for the two kinds and two keys: `at` (a stop's
-- or resumption's wall-clock time, for "Rain stopped play, 12.3 ov (14:32)")
-- and `par` (the umpires' announced par). A stop's `reason` rides in the
-- `reason` key every kind shares, and the API keeps it only where it is one
-- of STOP_REASONS (redact.mjs). A stop's free-text note is never selected.
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
           'superOver',      b.payload -> 'superOver',   -- db/71: the nth super over
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
           'confirmed',      b.payload -> 'confirmed',
           -- innings_summary (db/63): the card, less the note on a difference
           'card',           CASE WHEN b.kind = 'innings_summary' THEN (b.payload -> 'card') #- '{unreconciled,note}' END,
           -- SCRBRD-130 R1: a stop's or resumption's time; the umpires' par
           -- (the API keeps each only for its kind: redact.mjs)
           'at',             b.payload -> 'at',
           'par',            b.payload -> 'par')) AS detail
    FROM ball_event b
   WHERE b.match_id = p_match
     AND b.seq > coalesce(p_since, 0)
     AND b.kind IN ('innings_start', 'batters', 'bowler', 'ball', 'penalty', 'retire',
                    'innings_end', 'revision', 'void', 'innings_summary',
                    'play_stopped', 'play_resumed')
     AND public_fixture_served(b.match_id)
   ORDER BY b.seq
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_match_log(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_log(uuid, integer) TO scrbrd_app;

-- ── 6 · Grants ────────────────────────────────────────────────────
-- The rule functions run as their caller and keep PostgreSQL's default
-- EXECUTE, as db/69's do; on a managed host the platform's own API roles get
-- nothing new.
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['innings_stop_open(uuid,smallint)', 'innings_par_as_folded(uuid,smallint)',
                               'innings_stop_as_folded(uuid,smallint)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;

-- ── 7 · The proof ────────────────────────────────────────────────
-- Built and rolled back. db/99 §52 is the fuller proof, under the
-- application role, on every verify paste; tools/smoke-fold-figures.mjs
-- holds all of this to the fold over rain-logs.mjs. This is what must hold
-- the moment the file has run.
DO $check$
DECLARE
  r        record;
  got      text;
  v_school uuid := gen_random_uuid();
  v_user   uuid := gen_random_uuid();
  v_par    uuid := gen_random_uuid();   -- a chase terminated below the umpires' par
  v_none   uuid := gen_random_uuid();   -- the same chase, no par announced
  v_k      integer := 0;
  T        timestamptz := '2026-10-10 10:00+02';
  sq       jsonb := (SELECT jsonb_agg(jsonb_build_object('id', 'P' || g, 'name', 'P' || g)) FROM generate_series(1, 11) g);
BEGIN
  -- 1. What was re-emitted keeps its signature, attributes and grants.
  FOR r IN SELECT * FROM _db73_before LOOP
    IF (SELECT jsonb_build_object(
              'result', pg_get_function_result(p.oid), 'args', pg_get_function_arguments(p.oid),
              'definer', p.prosecdef, 'volatility', p.provolatile, 'strict', p.proisstrict,
              'config', to_jsonb(p.proconfig), 'acl', to_jsonb(p.proacl::text[]), 'owner', p.proowner::regrole::text,
              'language', p.prolang) FROM pg_proc p WHERE p.oid = r.obj::regprocedure) IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/73: % changed shape', r.obj;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM _db73_before) <> 3 THEN RAISE EXCEPTION 'db/73: the snapshot is not the three functions this file replaces'; END IF;
  IF NOT EXISTS (SELECT 1 FROM playing_condition_key WHERE key = 'target.g50' AND platform_default IS NULL)
     OR NOT EXISTS (SELECT 1 FROM playing_condition_key WHERE key = 'target.method' AND enum_values = '{umpires_revision,dls_standard}') THEN
    RAISE EXCEPTION 'db/73: the rain rule''s keys are not as the catalogue says (G50 never has a platform default)';
  END IF;

  -- 2. Two logs: Hilton 24 off two overs; Kearsney chasing 25 reach 15/1 off
  -- 1.3, rain stops play, the innings is terminated. v_par: the umpires
  -- announce a par of 18 — Hilton win by 3 runs. v_none: no par — no result.
  BEGIN
    INSERT INTO school (id, code, name) VALUES (v_school, 'db73-' || v_school, 'db/73 proof');
    INSERT INTO app_user (id, email, name, role, school_id)
    VALUES (v_user, 'db73-' || v_user || '@example.invalid', 'db/73 proof', 'scorer', v_school);
    INSERT INTO match (id, school_id, team_code, opponent, starts_at, sport, format, overs, status) VALUES
      (v_par, v_school, '1XI', 'Kearsney', T, 'cricket', 'T20', 20, 'complete'),
      (v_none, v_school, '1XI', 'Kearsney', T, 'cricket', 'T20', 20, 'complete');
    FOR r IN
      SELECT mm, x.*
        FROM unnest(ARRAY[v_par, v_none]) AS mm
       CROSS JOIN (
         SELECT 1 AS seq, true AS both_, 0 AS inn, 'innings_start' AS kind, NULL AS bt, NULL::int AS v, NULL AS dis,
                jsonb_build_object('battingTeam', '1XI', 'bowlingTeam', 'Kearsney', 'squad', sq, 'overs', 2) AS payload
         UNION ALL SELECT 1 + g, true, 0, 'ball', 'run', 2, NULL, '{}'::jsonb FROM generate_series(1, 12) g
         UNION ALL SELECT 14, true, 0, 'innings_end', NULL, NULL, NULL, '{"reason":"overs_complete","confirmed":{"runs":24,"wickets":0,"balls":12}}'::jsonb
         UNION ALL SELECT 15, true, 1, 'innings_start', NULL, NULL, NULL,
                          jsonb_build_object('battingTeam', 'Kearsney', 'bowlingTeam', '1XI', 'squad', sq, 'overs', 2, 'target', 25)
         UNION ALL SELECT 15 + g, true, 1, 'ball', 'run', 2, NULL, '{}'::jsonb FROM generate_series(1, 6) g
         UNION ALL SELECT 22, true, 1, 'ball', 'run', 1, NULL, '{}'::jsonb
         UNION ALL SELECT 23, true, 1, 'ball', 'W', 0, 'bowled', '{}'::jsonb
         UNION ALL SELECT 24, true, 1, 'ball', 'run', 2, NULL, '{}'::jsonb
         UNION ALL SELECT 25, true, 1, 'play_stopped', NULL, NULL, NULL, '{"reason":"rain","note":"a private note"}'::jsonb
         UNION ALL SELECT 26, false, 1, 'revision', NULL, NULL, NULL, '{"overs":null,"target":null,"reason":"rain","par":18}'::jsonb
         UNION ALL SELECT 27, true, 1, 'innings_end', NULL, NULL, NULL, '{"reason":"abandoned","confirmed":{"runs":15,"wickets":1,"balls":9}}'::jsonb
       ) AS x
       WHERE x.both_ OR mm = v_par
       ORDER BY mm, x.seq
    LOOP
      v_k := v_k + 1;
      INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                              client_seq, client_ts, kind, ball_type, value, dismissal, payload)
      VALUES (r.mm, v_school, r.seq, 1, r.inn, v_user, 'db73-pad', 'db73:' || v_k, r.seq, T, r.kind, r.bt, r.v, r.dis, r.payload);
    END LOOP;
    SELECT string_agg(x.label || '=' || concat_ws(',', r2.outcome, r2.margin_kind, r2.margin, r2.decided_by, r2.winner_side,
                                                   r2.innings->1->>'revised_target', r2.innings->0->>'nrr_runs', r2.innings->0->>'nrr_balls'),
                      ' ' ORDER BY x.label)
      INTO got
      FROM (VALUES ('none', v_none), ('par', v_par)) AS x(label, m), LATERAL match_result_compute(x.m) r2;
    -- v_none's chase target 25 is the first innings plus one: no revision, no deemed figures.
    IF got IS DISTINCT FROM 'none=no_result par=home_win,runs,3,play,home,umpires_revision,18,9' THEN
      RAISE EXCEPTION 'db/73: match_result reads %', got;
    END IF;
    IF (SELECT row(s.stopped, s.par)::text FROM innings_stop_as_folded(v_par, 1::smallint) s) IS DISTINCT FROM '(f,18)' THEN
      RAISE EXCEPTION 'db/73: a terminated chase reads stopped/par %', (SELECT row(s.stopped, s.par)::text FROM innings_stop_as_folded(v_par, 1::smallint) s);
    END IF;
    -- Unseal it (void the seal): the stop is open again.
    INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                            client_seq, client_ts, kind, payload)
    VALUES (v_par, v_school, 28, 1, 1, v_user, 'db73-pad', 'db73:void', 28, T, 'void',
            jsonb_build_object('target', (SELECT b.idempotency_key FROM ball_event b WHERE b.match_id = v_par AND b.seq = 27)));
    IF (SELECT row(s.stopped, s.par)::text FROM innings_stop_as_folded(v_par, 1::smallint) s) IS DISTINCT FROM '(t,18)' THEN
      RAISE EXCEPTION 'db/73: an open stop reads %', (SELECT row(s.stopped, s.par)::text FROM innings_stop_as_folded(v_par, 1::smallint) s);
    END IF;
    -- The public log lists the two kinds, and never selects a stop's note
    -- (db/99 §52 reads a served match's log through it).
    IF position('''play_stopped'', ''play_resumed''' IN (SELECT pg_get_functiondef('public_match_log(uuid,integer)'::regprocedure))) = 0
       OR position('''note''' IN (SELECT pg_get_functiondef('public_match_log(uuid,integer)'::regprocedure))) > 0 THEN
      RAISE EXCEPTION 'db/73: the public log selects a stop''s note';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ073', MESSAGE = 'db/73: undo the proof';
  EXCEPTION WHEN sqlstate 'ZZ073' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM school WHERE id = v_school) THEN RAISE EXCEPTION 'db/73: the proof left something behind'; END IF;
END $check$;

DROP TABLE _db73_before;
