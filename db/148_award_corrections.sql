-- ══════════════════════════════════════════════════════════════════
--  148 · A correction reaches the awards (RECOGNITION R10)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/RECOGNITION_design.md, approved by Kameel on
-- 7 Oct 2026 as recommended (D1–D25, Q1–Q12), unparked 5 Nov 2026. This is
-- §10's R10 row: §5 F4, D19 (a flagged award returns to its decider), D20
-- (everything said is unsaid, to the same audience) and D21 (only a
-- correction is told to the side, naming nobody), as the reconciliation's
-- R10 row (docs/design/RECOGNITION_reconciliation.md §5) tests it: "a POTM
-- whose century becomes 99 is flagged, not withdrawn". GA-I36 A2 (db/113,
-- milestone_retract()) is the pattern; db/142's derived_from is what is
-- compared. Its proof is db/99 §125; the walks are smoke-recognition (the
-- API) and smoke-browser-potm (the queue row and the staff sheet).
--
-- ── WHAT WAS ALREADY BUILT, AND THIS FILE DOES NOT REPEAT ───────────
--   D20, the side's milestone notice   db/113 milestone_retract(), db/121's
--                                      milestone_recheck(): retracted as a
--                                      correction, one "withdrawn" notice to
--                                      the same side, the same row returning
--                                      on a re-reached mark.
--   D20, the parent's sealed notice    db/140 milestone_family_unsay(): her
--                                      notice retracted as a correction, the
--                                      family's words to her alone ("The
--                                      fifty noticed for Rohan was withdrawn
--                                      after the scorecard was corrected.").
--   D21                                db/142 honour_unsay_side(): a
--                                      withdrawal of kind 'correction' takes
--                                      the side's notice back and says, naming
--                                      nobody, "Player of the Match · Sat 3
--                                      Oct v Kearsney: the award was withdrawn
--                                      after the scorecard was corrected."
--   What a derived item says           nothing is written: the fold, the
--                                      bests and the boards read the log.
--
-- ── WHAT THIS FILE ADDS ─────────────────────────────────────────────
--   table     + recognition_review   D19: one row when a correction moves
--               what a match's award was decided on (the awardee's figures,
--               or the result), to its decider; at most one open per honour;
--               closed by the decider letting it stand, or by the award's
--               withdrawal. Never edited but by this file's functions;
--               never deleted. RLS on; the application SELECTs only.
--   policies  + recognition_review_read        the decider, as himself, while
--               he holds recognition.match.award over the side; once he does
--               not (his assignment ended), every holder of it over the side
--               (the side's coach, the director of sport, the principal).
--               Never a guardian of the boy.
--             + recognition_review_not_platform  RESTRICTIVE: no platform-wide
--               assignment (D7)
--             + recognition_review_no_support  RESTRICTIVE: no support hour
--             + the pad guard (pad_scope_guard_install)
--   trigger   + honour_cite_figures  BEFORE INSERT, a Player of the Match:
--               derived_from gains `figuresSql`, the awardee's figures as
--               this file's SQL mirror reads them at the decision. A later
--               void compares the mirror with itself, so a difference between
--               the mirror and packages/scoring's words never flags an award
--               nothing moved. derived_from is otherwise the door's (db/142),
--               and is never edited after the insert (honour_stamp()).
--   trigger   + ball_event_award_review  CONSTRAINT, AFTER INSERT, WHEN kind
--               = 'void', DEFERRABLE INITIALLY DEFERRED: at commit, so it reads
--               the log as the correction left it, after an amendment's
--               re-judging of who faced (db/121), never half-way through one.
--               (1) D19: each standing award of the match is re-derived and
--               compared; a difference opens a review and tells the decider
--               (D19's fallback when his assignment has ended). The award is
--               never withdrawn here and no other boy is ever awarded.
--               (2) D20: each live record notice of the match (db/143's) whose
--               cited performance no longer stands is retracted as a
--               correction, one "withdrawn" notice to the same side.
--               A failure is a WARNING: a correction is never refused for a
--               review or a notice.
--   trigger   + honour_close_review  AFTER UPDATE OF withdrawn_at: the open
--               review of a withdrawn award is closed, 'withdrawn', with the
--               withdrawer's name.
--   function  ~ record_notice_for() (db/143)  D20's second half for records:
--               a record taken back by a correction and held again at the
--               next verification returns on the same row (notification_
--               unretract()), its words re-synced, and nothing new is sent; a
--               record that newly holds after a correction says so: "…, after
--               a correction." Restated whole; the guard below takes db/143's
--               body or this file's.
--   functions + match_award_figures, match_award_person_holds,
--               recognition_review_baseline, recognition_review_tell,
--               recognition_review_check, record_notice_holds,
--               record_notice_recheck, the trigger functions (nobody's)
--             + recognition_review_reader (the policy's predicate, the
--               application's to evaluate as the reader, as db/144's
--               recognition_nomination_staff() is)
--             + recognition_reviews_open, recognition_review_stand (the
--               doors: scrbrd_app only)
--
-- ── WHAT IS SAID, AND TO WHOM ───────────────────────────────────────
-- To the decider alone (recipient_id), staff words (RECOGNITION §7, "the
-- coach"), kind recognition, medium, under recognition.match.award:
--   "Player of the Match · Sat 3 Oct v Kearsney: the scorecard was corrected"
--   "R Pillay: the figures this award cited have changed: 104 (71) → 99 (70).
--    Withdraw, or let it stand."
-- and, when the result moved: "…: the result this award was decided on has
-- changed. Withdraw, or let it stand." Never to the side, never to the boy,
-- never to his parent: the award stands, so nothing about it is unsaid
-- until a person withdraws it (D19). A push is a pointer (push-api.mjs
-- buildPayload()): no lock screen carries a name.
-- A record notice taken back says to its own side, in db/89's words:
--   "'School record · Highest innings U15A T20: 87* D Erasmus' was withdrawn
--    after the scorecard was corrected."
--
-- EXISTING ROWS. None change. An award decided before this file has no
-- `figuresSql`: a void compares the mirror with the words it cited. A record
-- notice already standing on a ball voided before the paste stays as it was
-- (the trigger acts on voids from now on). No row is written by the paste.
--
-- NOTHING IS REMOVED. CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP …
-- IF EXISTS before the policies and the constraint trigger this file makes
-- again. Safe to run twice (DEPLOYING.md, "A migration re-runs harmlessly").
--
-- SCHEMA FIRST. The API built with it (potm-api.mjs: GET
-- /api/player-of-match/to-review, POST /api/player-of-match/reviews/:id/stand)
-- calls recognition_reviews_open() and recognition_review_stand(); this file
-- goes before it and is in services/api/expected-migrations.json.
--
-- THE GUARD keys on pg_proc.prosrc as db/142–db/146 do: the md5 of the live
-- record_notice_for() body, its whitespace folded, must be db/143's or this
-- file's.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v148_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE v_src text; v_md5 text;
BEGIN
  IF to_regclass('honour') IS NULL OR to_regclass('notification') IS NULL OR to_regclass('match_squad') IS NULL
     OR to_regclass('player_innings') IS NULL OR to_regclass('bowler_innings_figures') IS NULL
     OR to_regclass('ball_event_career') IS NULL OR to_regclass('summary_bowling_line') IS NULL
     OR to_regclass('duty_suspension') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'honour' AND column_name = 'derived_from')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'honour' AND column_name = 'withdrawn_kind')
     OR to_regprocedure('match_award(uuid,uuid,jsonb)') IS NULL
     OR to_regprocedure('match_award_holds(uuid,text,uuid)') IS NULL
     OR to_regprocedure('match_award_guardian_of(uuid,uuid)') IS NULL
     OR to_regprocedure('match_award_heading(uuid,text)') IS NULL
     OR to_regprocedure('match_award_short(text)') IS NULL
     OR to_regprocedure('match_award_side_of(uuid,uuid)') IS NULL
     OR to_regprocedure('match_result_compute(uuid)') IS NULL
     OR to_regprocedure('milestone_retract()') IS NULL
     OR to_regprocedure('notification_retract(uuid,text,boolean)') IS NULL
     OR to_regprocedure('notification_unretract(uuid)') IS NULL
     OR to_regprocedure('record_notice_for(uuid)') IS NULL OR to_regprocedure('record_lines(uuid,text)') IS NULL
     OR to_regprocedure('record_short_name(text)') IS NULL
     OR to_regprocedure('ball_counts_in_over(text,jsonb)') IS NULL
     OR to_regprocedure('pad_scope_guard_install(regclass)') IS NULL
     OR to_regprocedure('app_is_platform_wide()') IS NULL
     OR to_regprocedure('match_verified(uuid)') IS NULL OR to_regprocedure('sa_today()') IS NULL THEN
    RAISE EXCEPTION 'db/148: Player of the Match (db/142), the notices'' retraction (db/89, db/113), the record boards (db/143), the career views (db/87), the pad guard (db/50) or the platform reads (db/20) is missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = 'record_notice_for(uuid)'::regprocedure;
  v_md5 := pg_temp._v148_fold(v_src);
  IF v_md5 NOT IN ('7739d83048455b4118ce43be770c70ee', '52bf0c1621beb1e2d46f0cc7cff1b9fa') THEN
    RAISE EXCEPTION 'db/148: record_notice_for() is not db/143''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
--  1 · The awardee's figures, as SQL reads the log (R1's facts' mirror)
-- ══════════════════════════════════════════════════════════════════
-- packages/scoring potm.mjs figuresWords(matchFigures()): his batting summed
-- over the match's innings, "63 (48)", "31* (22)" (not out), "63" when a
-- scorebook card did not record the balls; his bowling, "3/18 (4)", "2/31
-- (3.4)"; both, "63 (48) · 1/14 (3)"; neither, "Did not bat or bowl". The
-- same rows the career views count: ball_event_career (never a super over,
-- never a voided ball) and the scorebook's lines. Runs as the owner.
CREATE OR REPLACE FUNCTION match_award_figures(p_match uuid, p_player uuid) RETURNS text AS $$
  WITH bat AS (
    SELECT sum(i.runs)::integer AS runs,
           CASE WHEN bool_or(i.balls_faced IS NULL) THEN NULL ELSE sum(i.balls_faced)::integer END AS balls,
           bool_and(coalesce(i.out, false)) AS out, count(*) AS n
      FROM player_innings i WHERE i.match_id = p_match AND i.player_id = p_player
  ),
  bowl AS (
    SELECT sum(f.wickets)::integer AS wickets, sum(f.runs_conceded)::integer AS runs, count(*) AS n,
           (coalesce((SELECT count(*) FILTER (WHERE ball_counts_in_over(b.ball_type, b.payload))
                        FROM ball_event_career b
                       WHERE b.match_id = p_match AND b.bowler_id = p_player AND b.kind = 'ball'), 0)
            + coalesce((SELECT sum(s.legal_balls) FROM summary_bowling_line s
                         WHERE s.match_id = p_match AND s.player_id = p_player), 0))::integer AS balls
      FROM bowler_innings_figures f WHERE f.match_id = p_match AND f.player_id = p_player
  )
  SELECT coalesce(nullif(concat_ws(' · ',
           CASE WHEN bat.n > 0 THEN bat.runs || CASE WHEN bat.out THEN '' ELSE '*' END
                                    || CASE WHEN bat.balls IS NULL THEN '' ELSE ' (' || bat.balls || ')' END END,
           CASE WHEN bowl.n > 0 THEN bowl.wickets || '/' || bowl.runs || ' ('
                                     || CASE WHEN bowl.balls % 6 = 0 THEN (bowl.balls / 6)::text
                                             ELSE (bowl.balls / 6) || '.' || (bowl.balls % 6) END || ')' END), ''),
         'Did not bat or bowl')
    FROM bat, bowl
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION match_award_figures(uuid, uuid) IS
  'db/148 (RECOGNITION R10, D19): one boy''s figures in one match in packages/scoring figuresWords()''s words, as the career views read the log (never a super over, never a voided ball). The SQL mirror a correction is compared by. Nobody''s to call.';

-- The decider's words for the decision, kept with it: the door's own working
-- and, beside it, the mirror's reading at the same head.
CREATE OR REPLACE FUNCTION honour_cite_figures() RETURNS trigger AS $$
BEGIN
  BEGIN
    NEW.derived_from := NEW.derived_from || jsonb_build_object('figuresSql', match_award_figures(NEW.match_id, NEW.player_id));
  EXCEPTION WHEN OTHERS THEN
    -- A decision is never stopped for its baseline: the comparison falls back
    -- to the words the decider saw.
    RAISE WARNING 'db/148: Player of the Match % was decided without its SQL figures (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Before honour_stamp (triggers fire by name: cite < stamp < tell); it reads
-- only the match and the boy, which the door set.
CREATE OR REPLACE TRIGGER honour_cite_figures BEFORE INSERT ON honour
  FOR EACH ROW WHEN (NEW.kind = 'player_of_match' AND NEW.match_id IS NOT NULL AND jsonb_typeof(NEW.derived_from) = 'object')
  EXECUTE FUNCTION honour_cite_figures();


-- ══════════════════════════════════════════════════════════════════
--  2 · The review (D19)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS recognition_review (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  honour_id        uuid NOT NULL REFERENCES honour(id) ON DELETE RESTRICT,
  school_id        uuid NOT NULL,
  team_code        text NOT NULL,
  match_id         uuid NOT NULL REFERENCES match(id),
  player_id        uuid NOT NULL,
  decided_by       uuid REFERENCES app_user(id),
  reason           text NOT NULL,
  figures_before   text,          -- what the award cited (derived_from's awardee)
  figures_after    text,          -- the mirror's reading at the latest re-check
  result_before    text,          -- result_hash at the decision (or at the last "let it stand")
  result_after     text,          -- result_hash at the latest re-check
  opened_at        timestamptz NOT NULL DEFAULT now(),
  checked_at       timestamptz NOT NULL DEFAULT now(),
  notice_ids       uuid[] NOT NULL DEFAULT '{}',
  closed_at        timestamptz,
  closed_by        uuid REFERENCES app_user(id),
  outcome          text,
  figures_at_close text,          -- the mirror's reading when it was closed: the next re-check's baseline
  result_at_close  text,
  CONSTRAINT recognition_review_reason_known CHECK (reason IN ('figures_moved', 'result_moved', 'figures_and_result_moved')),
  CONSTRAINT recognition_review_outcome_known CHECK (outcome IS NULL OR outcome IN ('stands', 'withdrawn')),
  CONSTRAINT recognition_review_closed_whole CHECK ((closed_at IS NULL) = (outcome IS NULL))
);
COMMENT ON TABLE recognition_review IS
  'db/148 (RECOGNITION R10, D19): a correction moved what a match''s award was decided on (the awardee''s figures, or the result), and the award returns to its decider. The award stands until he withdraws it or lets it stand; the system never withdraws it and never awards another boy. Written by db/148''s functions alone; read by the decider, or the side''s deciders once his assignment has ended. Never public (N5).';
CREATE UNIQUE INDEX IF NOT EXISTS recognition_review_open_once ON recognition_review (honour_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS recognition_review_match ON recognition_review (match_id);

-- Kept: a review is closed once, and nothing else about it moves after it
-- opens but the re-check's reading.
CREATE OR REPLACE FUNCTION recognition_review_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a review of an award is kept' USING ERRCODE = 'check_violation', CONSTRAINT = 'recognition_review_is_kept';
  END IF;
  IF OLD.closed_at IS NOT NULL
     OR (NEW.id, NEW.honour_id, NEW.school_id, NEW.team_code, NEW.match_id, NEW.player_id, NEW.decided_by,
         NEW.figures_before, NEW.result_before, NEW.opened_at)
        IS DISTINCT FROM
        (OLD.id, OLD.honour_id, OLD.school_id, OLD.team_code, OLD.match_id, OLD.player_id, OLD.decided_by,
         OLD.figures_before, OLD.result_before, OLD.opened_at) THEN
    RAISE EXCEPTION 'a review of an award is closed once and not edited' USING ERRCODE = 'check_violation', CONSTRAINT = 'recognition_review_is_kept';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER recognition_review_guard BEFORE UPDATE OR DELETE ON recognition_review
  FOR EACH ROW EXECUTE FUNCTION recognition_review_guard();


-- ══════════════════════════════════════════════════════════════════
--  3 · Who reads it (D19: the decider, then the side's deciders)
-- ══════════════════════════════════════════════════════════════════
-- match_award_holds() (db/142) for a named person: recognition.match.award
-- over the side through a live assignment AT the school, not suspended.
CREATE OR REPLACE FUNCTION match_award_person_holds(p_person uuid, p_school uuid, p_team text, p_match uuid) RETURNS boolean AS $$
  SELECT p_person IS NOT NULL AND p_school IS NOT NULL AND p_team IS NOT NULL
     AND EXISTS (SELECT 1 FROM role_assignment a
                   JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'recognition.match.award'
                  WHERE a.person_id = p_person AND a.active AND a.school_id = p_school
                    AND (a.team_code IS NULL OR a.team_code = p_team)
                    AND (a.fixture_id IS NULL OR a.fixture_id = p_match)
                    AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
                    AND (a.valid_until IS NULL OR a.valid_until > sa_today())
                    AND (a.expires_at IS NULL OR a.expires_at > now())
                    AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The reader: a holder of recognition.match.award over the side, as himself
-- (match_award_holds(): never a pad, a support hour or a platform-wide
-- assignment), never a guardian of the boy, and either the decider or, once
-- the decider holds it no longer, any of them.
CREATE OR REPLACE FUNCTION recognition_review_reader(p_school uuid, p_team text, p_match uuid, p_decider uuid, p_player uuid)
RETURNS boolean AS $$
  SELECT match_award_holds(p_school, p_team, p_match)
     AND NOT match_award_guardian_of(app_user_id(), p_player)
     AND (app_user_id() = p_decider OR NOT match_award_person_holds(p_decider, p_school, p_team, p_match))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

ALTER TABLE recognition_review ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recognition_review FROM PUBLIC;
REVOKE ALL ON recognition_review FROM scrbrd_app;
GRANT SELECT ON recognition_review TO scrbrd_app;
DROP POLICY IF EXISTS recognition_review_read ON recognition_review;
CREATE POLICY recognition_review_read ON recognition_review FOR SELECT
  USING (recognition_review_reader(school_id, team_code, match_id, decided_by, player_id));
DROP POLICY IF EXISTS recognition_review_not_platform ON recognition_review;
CREATE POLICY recognition_review_not_platform ON recognition_review AS RESTRICTIVE FOR SELECT
  USING (NOT app_is_platform_wide());
DROP POLICY IF EXISTS recognition_review_no_support ON recognition_review;
CREATE POLICY recognition_review_no_support ON recognition_review AS RESTRICTIVE FOR SELECT
  USING (app_support_access_id(school_id) IS NULL);
SELECT pad_scope_guard_install('recognition_review'::regclass);


-- ══════════════════════════════════════════════════════════════════
--  4 · The re-check, on a void (D19)
-- ══════════════════════════════════════════════════════════════════
-- What the next re-check compares with: the last time a person looked (the
-- latest review he let stand), or else the decision itself.
CREATE OR REPLACE FUNCTION recognition_review_baseline(p_honour uuid, OUT figures text, OUT result text) AS $$
DECLARE r recognition_review%ROWTYPE; h honour%ROWTYPE;
BEGIN
  SELECT * INTO r FROM recognition_review x
   WHERE x.honour_id = p_honour AND x.outcome = 'stands' ORDER BY x.closed_at DESC, x.id LIMIT 1;
  IF FOUND THEN figures := r.figures_at_close; result := r.result_at_close; RETURN; END IF;
  SELECT * INTO h FROM honour x WHERE x.id = p_honour;
  figures := coalesce(h.derived_from->>'figuresSql', h.derived_from->'awardee'->>'figures');
  result := h.derived_from->>'resultHash';
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Tell whoever reads the review (D19): the decider; once he holds the
-- capability no longer, each holder over the side who is not the boy's
-- guardian. One notice each, his alone. Returns the notices written.
CREATE OR REPLACE FUNCTION recognition_review_tell(p_review uuid) RETURNS uuid[] AS $$
DECLARE
  r recognition_review%ROWTYPE;
  h honour%ROWTYPE;
  v_side text; v_title text; v_body text; v_boy text;
  v_to uuid[];
  v_out uuid[] := '{}';
  v_id uuid; u uuid;
BEGIN
  SELECT * INTO r FROM recognition_review x WHERE x.id = p_review;
  SELECT * INTO h FROM honour x WHERE x.id = r.honour_id;
  v_side := coalesce(h.derived_from->>'side', match_award_side_of(h.match_id, h.player_id), 'home');
  SELECT match_award_short(p.full_name) INTO v_boy FROM player p WHERE p.id = h.player_id;
  v_title := match_award_heading(h.match_id, v_side) || ': the scorecard was corrected';
  v_body := v_boy || ': '
    || CASE r.reason
         WHEN 'result_moved' THEN 'the result this award was decided on has changed.'
         WHEN 'figures_moved' THEN 'the figures this award cited have changed: ' || coalesce(r.figures_before, '—') || ' → ' || coalesce(r.figures_after, '—') || '.'
         ELSE 'the figures this award cited have changed: ' || coalesce(r.figures_before, '—') || ' → ' || coalesce(r.figures_after, '—')
              || ', and so has the result.' END
    || ' Withdraw, or let it stand.';
  IF match_award_person_holds(h.decided_by, h.school_id, h.team_code, h.match_id) THEN
    v_to := ARRAY[h.decided_by];
  ELSE
    SELECT coalesce(array_agg(DISTINCT a.person_id ORDER BY a.person_id), '{}') INTO v_to
      FROM role_assignment a
      JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'recognition.match.award'
     WHERE a.school_id = h.school_id AND match_award_person_holds(a.person_id, h.school_id, h.team_code, h.match_id)
       AND NOT match_award_guardian_of(a.person_id, h.player_id);
  END IF;
  FOREACH u IN ARRAY v_to LOOP
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, is_public, subject_kind, subject_id, subject_person_id, recipient_id)
    VALUES (h.school_id, h.team_code, 'team', 'recognition', 'medium', v_title, v_body,
            'recognition.match.award', false, 'match', h.match_id, h.player_id, u)
    RETURNING id INTO v_id;
    v_out := v_out || v_id;
  END LOOP;
  RETURN v_out;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- One award, asked again: open a review if what it stood on moved, and keep
-- an open one's reading current. Never withdraws, never awards.
CREATE OR REPLACE FUNCTION recognition_review_check(p_honour uuid) RETURNS void AS $$
DECLARE
  h honour%ROWTYPE;
  b record;
  v_now text; v_hash text; v_f boolean; v_r boolean; v_reason text; v_open uuid; v_id uuid;
BEGIN
  SELECT * INTO h FROM honour x WHERE x.id = p_honour FOR UPDATE;
  IF NOT FOUND OR h.withdrawn_at IS NOT NULL OR h.match_id IS NULL OR jsonb_typeof(h.derived_from) IS DISTINCT FROM 'object' THEN
    RETURN;
  END IF;
  SELECT * INTO b FROM recognition_review_baseline(h.id);
  v_now := match_award_figures(h.match_id, h.player_id);
  v_hash := (SELECT x.result_hash FROM match_result_compute(h.match_id) x);
  v_f := b.figures IS NOT NULL AND v_now IS DISTINCT FROM b.figures;
  v_r := b.result IS NOT NULL AND v_hash IS DISTINCT FROM b.result;
  v_reason := CASE WHEN v_f AND v_r THEN 'figures_and_result_moved' WHEN v_f THEN 'figures_moved' WHEN v_r THEN 'result_moved' END;
  SELECT x.id INTO v_open FROM recognition_review x WHERE x.honour_id = h.id AND x.closed_at IS NULL FOR UPDATE;
  IF v_open IS NOT NULL THEN
    -- Told once: a later correction keeps the reading current, says nothing
    -- more, and leaves the review open even if the figures came back — the
    -- decider closes it.
    UPDATE recognition_review SET figures_after = v_now, result_after = v_hash, checked_at = now(),
           reason = coalesce(v_reason, reason)
     WHERE id = v_open;
    RETURN;
  END IF;
  IF v_reason IS NULL THEN RETURN; END IF;
  INSERT INTO recognition_review (honour_id, school_id, team_code, match_id, player_id, decided_by, reason,
                                  figures_before, figures_after, result_before, result_after)
  VALUES (h.id, h.school_id, h.team_code, h.match_id, h.player_id, h.decided_by, v_reason,
          coalesce((SELECT x.figures_at_close FROM recognition_review x
                     WHERE x.honour_id = h.id AND x.outcome = 'stands' ORDER BY x.closed_at DESC, x.id LIMIT 1),
                   h.derived_from->'awardee'->>'figures', b.figures),
          v_now, b.result, v_hash)
  RETURNING id INTO v_id;
  BEGIN
    UPDATE recognition_review SET notice_ids = recognition_review_tell(v_id) WHERE id = v_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'db/148: the decider of Player of the Match % was not told of the correction (%): %', h.id, SQLSTATE, SQLERRM;
  END;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  5 · A record notice that a correction falsified (D20)
-- ══════════════════════════════════════════════════════════════════
-- Does the performance db/143's notice cited still stand in the log? Its
-- title ends with the figure and the holder (record_notice_for()'s words:
-- "School record · Highest innings U15A T20: 87* D Erasmus"), so the
-- holder's performances in the match are worded the same way and one must
-- match: the metric, the side, the figure and the name. A void touches only
-- its own match, so an unchanged figure against unchanged earlier matches
-- is the same record.
CREATE OR REPLACE FUNCTION record_notice_holds(p_notice uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM notification n
      JOIN player p ON p.id = n.subject_person_id
     CROSS JOIN LATERAL (
       SELECT 'Highest innings'::text AS label, i.runs || CASE WHEN coalesce(i.out, false) THEN '' ELSE '*' END AS fig
         FROM player_innings i WHERE i.match_id = n.subject_id AND i.player_id = n.subject_person_id
       UNION ALL
       SELECT 'Best strike rate', i.runs || ' off ' || i.balls_faced || ' balls'
         FROM player_innings i WHERE i.match_id = n.subject_id AND i.player_id = n.subject_person_id AND i.balls_faced > 0
       UNION ALL
       SELECT CASE WHEN k.e THEN 'Best economy' ELSE 'Best bowling' END,
              CASE WHEN k.e THEN f.runs_conceded || ' off ' || lb.n || ' balls' ELSE f.wickets || '/' || f.runs_conceded END
         FROM bowler_innings_figures f
        CROSS JOIN LATERAL (SELECT (coalesce((SELECT count(*) FILTER (WHERE ball_counts_in_over(b.ball_type, b.payload))
                                                FROM ball_event_career b
                                               WHERE b.match_id = f.match_id AND b.innings = f.innings
                                                 AND b.bowler_id = f.player_id AND b.kind = 'ball'), 0)
                                    + coalesce((SELECT sum(s.legal_balls) FROM summary_bowling_line s
                                                 WHERE s.match_id = f.match_id AND s.innings = f.innings
                                                   AND s.player_id = f.player_id), 0))::integer AS n) lb
        CROSS JOIN (VALUES (false), (true)) k(e)
        WHERE f.match_id = n.subject_id AND f.player_id = n.subject_person_id
     ) c
     WHERE n.id = p_notice
       AND position(' · ' || c.label || ' ' || n.team_code || ' ' IN n.title) > 0
       AND right(n.title, length(': ' || c.fig || ' ' || record_short_name(p.full_name)))
           = ': ' || c.fig || ' ' || record_short_name(p.full_name))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION record_notice_holds(uuid) IS
  'db/148 (RECOGNITION R10, D20): whether the performance a record notice (db/143) cited still stands in the log, by the notice''s own words. Nobody''s to call.';

-- The record notices of a match that a correction falsified: retracted as a
-- correction, one "withdrawn" notice to the same side (db/89's words).
CREATE OR REPLACE FUNCTION record_notice_recheck(p_match uuid) RETURNS integer AS $$
DECLARE n record; k integer := 0;
BEGIN
  FOR n IN SELECT x.id FROM notification x
            WHERE x.kind = 'recognition' AND x.subject_kind = 'match' AND x.subject_id = p_match
              AND x.required_capability = 'player.performance.read' AND x.scope_level = 'team'
              AND x.recipient_id IS NULL AND x.retracts_id IS NULL AND x.retracted_at IS NULL AND x.published_by IS NULL
              AND (x.title LIKE 'School record%' OR x.title LIKE 'Friendly record%')
            ORDER BY x.published_at, x.id FOR UPDATE LOOP
    IF NOT record_notice_holds(n.id) THEN
      PERFORM notification_retract(n.id, 'correction', true);
      k := k + 1;
    END IF;
  END LOOP;
  RETURN k;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  6 · The trigger: at commit, on a void
-- ══════════════════════════════════════════════════════════════════
-- A void of a void restores nothing (db/113), so nothing moved: skipped.
CREATE OR REPLACE FUNCTION recognition_correction() RETURNS trigger AS $$
DECLARE h record;
BEGIN
  IF EXISTS (SELECT 1 FROM ball_event t WHERE t.match_id = NEW.match_id AND t.idempotency_key = NEW.payload->>'target'
                AND t.kind = 'void') THEN
    RETURN NULL;
  END IF;
  FOR h IN SELECT x.id FROM honour x
            WHERE x.match_id = NEW.match_id AND x.withdrawn_at IS NULL AND x.kind = 'player_of_match'
            ORDER BY x.awarded_at, x.id LOOP
    BEGIN
      PERFORM recognition_review_check(h.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'db/148: Player of the Match % was not re-checked after a correction to match % (%): %', h.id, NEW.match_id, SQLSTATE, SQLERRM;
    END;
  END LOOP;
  BEGIN
    PERFORM record_notice_recheck(NEW.match_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'db/148: the record notices of match % were not re-checked after a correction (%): %', NEW.match_id, SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS ball_event_award_review ON ball_event;
CREATE CONSTRAINT TRIGGER ball_event_award_review AFTER INSERT ON ball_event
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.kind = 'void')
  EXECUTE FUNCTION recognition_correction();


-- ══════════════════════════════════════════════════════════════════
--  7 · Closing it
-- ══════════════════════════════════════════════════════════════════
-- Withdrawn, by whatever route: the open review is closed with his name.
CREATE OR REPLACE FUNCTION honour_close_review() RETURNS trigger AS $$
BEGIN
  UPDATE recognition_review
     SET closed_at = now(), closed_by = NEW.withdrawn_by, outcome = 'withdrawn',
         figures_at_close = figures_after, result_at_close = result_after
   WHERE honour_id = NEW.id AND closed_at IS NULL;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER honour_close_review AFTER UPDATE OF withdrawn_at ON honour
  FOR EACH ROW WHEN (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL AND NEW.match_id IS NOT NULL)
  EXECUTE FUNCTION honour_close_review();

-- The doors. What the decider reads: each open review he may act on, with
-- the figures as they stand now beside what the award cited (§7: "The
-- figures this award cited have changed: 104 (71) → 99 (70). Withdraw, or
-- let it stand."). p_match narrows it to one fixture's sheet.
CREATE OR REPLACE FUNCTION recognition_reviews_open(p_match uuid DEFAULT NULL)
RETURNS TABLE (review_id uuid, honour_id uuid, match_id uuid, side text, heading text, player_id uuid, player_name text,
               reason text, figures_before text, figures_now text, result_moved boolean, opened_at timestamptz,
               decided_by_name text, decided_by_me boolean, can_withdraw boolean) AS $$
  SELECT r.id, r.honour_id, r.match_id, coalesce(h.derived_from->>'side', match_award_side_of(r.match_id, r.player_id)),
         match_award_heading(r.match_id, coalesce(h.derived_from->>'side', match_award_side_of(r.match_id, r.player_id), 'home')),
         r.player_id, match_award_short(p.full_name), r.reason, r.figures_before,
         match_award_figures(r.match_id, r.player_id),
         (SELECT x.result_hash FROM match_result_compute(r.match_id) x) IS DISTINCT FROM r.result_before,
         r.opened_at, (SELECT u.name FROM app_user u WHERE u.id = r.decided_by), r.decided_by = app_user_id(),
         NOT match_award_guardian_of(app_user_id(), r.player_id)
    FROM recognition_review r
    JOIN honour h ON h.id = r.honour_id
    JOIN player p ON p.id = r.player_id
   WHERE r.closed_at IS NULL AND h.withdrawn_at IS NULL
     AND (p_match IS NULL OR r.match_id = p_match)
     AND app_user_id() IS NOT NULL AND NOT app_is_platform_wide()
     AND recognition_review_reader(r.school_id, r.team_code, r.match_id, r.decided_by, r.player_id)
   ORDER BY r.opened_at, r.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Let it stand (D19): the review is closed with his name, and the figures
-- as they stand now become what the next correction is compared with.
--   not_permitted · already_closed
CREATE OR REPLACE FUNCTION recognition_review_stand(p_review uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE r recognition_review%ROWTYPE; v_me uuid := app_user_id();
BEGIN
  SELECT * INTO r FROM recognition_review x WHERE x.id = p_review FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR app_is_platform_wide()
     OR NOT recognition_review_reader(r.school_id, r.team_code, r.match_id, r.decided_by, r.player_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF r.closed_at IS NOT NULL OR EXISTS (SELECT 1 FROM honour h WHERE h.id = r.honour_id AND h.withdrawn_at IS NOT NULL) THEN
    RETURN QUERY SELECT false, 'already_closed'::text; RETURN;
  END IF;
  UPDATE recognition_review
     SET closed_at = now(), closed_by = v_me, outcome = 'stands',
         figures_after = match_award_figures(r.match_id, r.player_id),
         result_after = (SELECT x.result_hash FROM match_result_compute(r.match_id) x),
         figures_at_close = match_award_figures(r.match_id, r.player_id),
         result_at_close = (SELECT x.result_hash FROM match_result_compute(r.match_id) x),
         checked_at = now()
   WHERE id = r.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  8 · A record held again returns on the same row (D20; db/143's,
--      restated)
-- ══════════════════════════════════════════════════════════════════
-- db/143's words and its "once" exactly. Changed, marked db/148:
--   * a record notice taken back as a correction, held again (the same
--     title) when the match is verified once more, returns on the same row
--     through notification_unretract() (which supersedes its "withdrawn"
--     notice unsaid), its words re-synced; nothing new is sent;
--   * a record the match newly holds after a correction (a void after the
--     first seal) is noticed once, "…, after a correction."
CREATE OR REPLACE FUNCTION record_notice_for(p_match uuid) RETURNS void AS $$
DECLARE
  m match%ROWTYPE;
  e record;
  r record;
  v_title text;
  v_body  text;
  v_metric text;
  v_fig text;
  v_back uuid;      -- db/148
  v_after boolean;  -- db/148
BEGIN
  BEGIN
    SELECT * INTO m FROM match x WHERE x.id = p_match;
    IF NOT FOUND OR m.status <> 'complete' OR NOT match_verified(p_match) THEN RETURN; END IF;
    -- db/148: a void written after the first seal is a correction.
    v_after := EXISTS (SELECT 1 FROM ball_event v
                        WHERE v.match_id = p_match AND v.kind = 'void'
                          AND v.seq > (SELECT min(s.seq) FROM ball_event s WHERE s.match_id = p_match AND s.kind = 'innings_end'));
    FOR e IN SELECT x.s, x.t FROM (VALUES (m.school_id, m.team_code), (m.away_school_id, m.away_team_code)) x(s, t)
              WHERE x.s IS NOT NULL AND x.t IS NOT NULL
    LOOP
      FOR r IN
        WITH l AS MATERIALIZED (SELECT * FROM record_lines(e.s, e.t))
        SELECT l.*, b.coverage_since AS since
          FROM l
          JOIN l b ON b.line = 'board' AND b.metric = l.metric AND b.class_group = l.class_group AND b.format = l.format
         WHERE l.line = 'holder' AND l.match_id = p_match AND l.prior_best
         ORDER BY l.class_group DESC, l.format, l.metric, l.player_name
      LOOP
        v_metric := CASE r.metric WHEN 'highest_innings' THEN 'Highest innings' WHEN 'best_bowling' THEN 'Best bowling'
                                  WHEN 'best_strike_rate' THEN 'Best strike rate' ELSE 'Best economy' END;
        v_fig := CASE r.metric
          WHEN 'highest_innings'  THEN r.runs || CASE WHEN r.not_out THEN '*' ELSE '' END
          WHEN 'best_bowling'     THEN r.wickets || '/' || r.runs_conceded
          WHEN 'best_strike_rate' THEN r.runs || ' off ' || r.balls || ' balls'
          ELSE r.runs_conceded || ' off ' || r.balls || ' balls' END;
        v_title := CASE WHEN r.class_group = 'friendly' THEN 'Friendly record' ELSE 'School record' END
                   || CASE WHEN r.equalled THEN ' equalled' ELSE '' END
                   || ' · ' || v_metric || ' ' || e.t || ' ' || coalesce(r.format, '') || ': ' || v_fig || ' '
                   || record_short_name(r.player_name);
        v_body := v_fig || ' against ' || coalesce(r.opponent, 'the opposition') || ', '
                  || to_char(r.played_on, 'FMDD Mon YYYY') || '. In verified SCRBRD matches since '
                  || to_char(r.since, 'Mon YYYY') || '.';
        IF NOT EXISTS (SELECT 1 FROM notification n
                        WHERE n.subject_kind = 'match' AND n.subject_id = p_match AND n.school_id = e.s
                          AND n.team_code = e.t AND n.title = v_title AND n.retracted_at IS NULL) THEN
          -- db/148: taken back by a correction and held again → the same row.
          v_back := (SELECT n.id FROM notification n
                      WHERE n.subject_kind = 'match' AND n.subject_id = p_match AND n.school_id = e.s
                        AND n.team_code = e.t AND n.title = v_title AND n.retracts_id IS NULL
                        AND n.retracted_at IS NOT NULL AND n.retraction_kind = 'correction'
                      ORDER BY n.published_at DESC, n.id LIMIT 1);
          IF v_back IS NOT NULL AND notification_unretract(v_back) THEN
            UPDATE notification SET body = v_body WHERE id = v_back;
          ELSE
            INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                      required_capability, is_public, subject_kind, subject_id, subject_person_id)
            VALUES (e.s, e.t, 'team', 'recognition', 'low', v_title,
                    CASE WHEN v_after   -- db/148: newly held after a correction
                         THEN v_fig || ' against ' || coalesce(r.opponent, 'the opposition') || ', '
                              || to_char(r.played_on, 'FMDD Mon YYYY') || ', after a correction. In verified SCRBRD matches since '
                              || to_char(r.since, 'Mon YYYY') || '.'
                         ELSE v_body END,
                    'player.performance.read', false, 'match', p_match, r.player_id);
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- The match is finished, or the innings sealed, whatever happens to its
    -- notice; the server's log says the notice was not raised.
    RAISE WARNING 'db/143: the record notice for match % was not raised (SQLSTATE %)', p_match, SQLSTATE;
  END;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION record_notice_for(uuid) IS
  'db/143 (RECOGNITION R9, D25), db/148 (R10, D20): each record a finished, verified match now holds against an earlier match''s, noticed once to that side (team scope, under player.performance.read, no recipient, the holder as subject, named by initial and surname); one taken back by a correction and held again returns on the same row; one newly held after a correction says so. A notice that cannot be raised never stops the write that asked for it. Nobody''s to call.';


-- ══════════════════════════════════════════════════════════════════
--  9 · Who may call what
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_award_figures(uuid,uuid)', 'honour_cite_figures()', 'recognition_review_guard()',
                           'match_award_person_holds(uuid,uuid,text,uuid)',
                           'recognition_review_reader(uuid,text,uuid,uuid,uuid)',
                           'recognition_review_baseline(uuid)', 'recognition_review_tell(uuid)', 'recognition_review_check(uuid)',
                           'record_notice_holds(uuid)', 'record_notice_recheck(uuid)', 'recognition_correction()',
                           'honour_close_review()', 'recognition_reviews_open(uuid)', 'recognition_review_stand(uuid)',
                           'record_notice_for(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON recognition_review FROM %I', r);
    END IF;
  END LOOP;
  -- The doors, and the policy's predicate (evaluated as the reader, as
  -- db/144's recognition_nomination_staff() is).
  GRANT EXECUTE ON FUNCTION recognition_reviews_open(uuid) TO scrbrd_app;
  GRANT EXECUTE ON FUNCTION recognition_review_stand(uuid) TO scrbrd_app;
  GRANT EXECUTE ON FUNCTION recognition_review_reader(uuid, text, uuid, uuid, uuid) TO scrbrd_app;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
--  10 · Refuse to commit a file that did not do what it says
-- ══════════════════════════════════════════════════════════════════
DO $check$
DECLARE f text; v_src text;
BEGIN
  FOREACH f IN ARRAY ARRAY['match_award_figures(uuid,uuid)', 'honour_cite_figures()',
                           'match_award_person_holds(uuid,uuid,text,uuid)',
                           'recognition_review_reader(uuid,text,uuid,uuid,uuid)',
                           'recognition_review_baseline(uuid)', 'recognition_review_tell(uuid)', 'recognition_review_check(uuid)',
                           'record_notice_holds(uuid)', 'record_notice_recheck(uuid)', 'recognition_correction()',
                           'honour_close_review()', 'recognition_reviews_open(uuid)', 'recognition_review_stand(uuid)',
                           'record_notice_for(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/148: % is not a SECURITY DEFINER with a pinned path', f;
    END IF;
    IF (SELECT prosrc FROM pg_proc WHERE oid = f::regprocedure) ~* '\mcurrent_date\M' THEN
      RAISE EXCEPTION 'db/148: % reads the database''s day (db/128)', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/148: % is executable by PUBLIC', f;
    END IF;
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE')
       <> (f IN ('recognition_reviews_open(uuid)', 'recognition_review_stand(uuid)', 'recognition_review_reader(uuid,text,uuid,uuid,uuid)')) THEN
      RAISE EXCEPTION 'db/148: % is, or is not, the application''s to call', f;
    END IF;
  END LOOP;
  -- The application reads the review and writes nothing.
  IF NOT has_table_privilege('scrbrd_app', 'recognition_review', 'SELECT')
     OR has_table_privilege('scrbrd_app', 'recognition_review', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'recognition_review', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'recognition_review', 'DELETE') THEN
    RAISE EXCEPTION 'db/148: the application writes recognition_review, or cannot read it';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'recognition_review'::regclass)
     OR (SELECT count(*) FROM pg_policies WHERE tablename = 'recognition_review'
           AND policyname IN ('recognition_review_read', 'recognition_review_not_platform', 'recognition_review_no_support')) <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recognition_review' AND policyname = 'recognition_review_not_platform'
                       AND permissive = 'RESTRICTIVE')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'recognition_review' AND policyname = 'recognition_review_no_support'
                       AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/148: recognition_review''s row security is not as this file wrote it';
  END IF;
  -- The void trigger: deferred to commit, on a void only.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                  WHERE g.tgrelid = 'ball_event'::regclass AND g.tgname = 'ball_event_award_review'
                    AND g.tgfoid = 'recognition_correction()'::regprocedure AND g.tgdeferrable AND g.tginitdeferred
                    AND pg_get_triggerdef(g.oid) LIKE '%AFTER INSERT ON public.ball_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.kind = ''void''::text))%') THEN
    RAISE EXCEPTION 'db/148: ball_event_award_review is not a deferred AFTER INSERT … WHEN (kind = ''void'') trigger';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'honour'::regclass
        AND tgname IN ('honour_cite_figures', 'honour_close_review') AND tgenabled <> 'D') <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'recognition_review'::regclass AND tgname = 'recognition_review_guard') THEN
    RAISE EXCEPTION 'db/148: a trigger on honour or recognition_review is missing or disabled';
  END IF;
  -- The re-check never withdraws and never awards (D19).
  FOREACH f IN ARRAY ARRAY['recognition_review_check(uuid)', 'recognition_correction()', 'recognition_review_tell(uuid)'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF v_src ~* 'insert\s+into\s+honour\M' OR v_src ~* 'update\s+honour\M' OR position('match_award(' IN v_src) > 0 THEN
      RAISE EXCEPTION 'db/148: % writes an honour', f;
    END IF;
  END LOOP;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'record_notice_recheck(uuid)'::regprocedure;
  IF position('notification_retract(n.id, ''correction'', true)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/148: record_notice_recheck() does not retract through notification_retract()';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'record_notice_for(uuid)'::regprocedure;
  IF position('notification_unretract(v_back)' IN v_src) = 0 OR position(', after a correction. In verified' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/148: record_notice_for() does not return a re-held record on its row, or does not say "after a correction"';
  END IF;
  IF pg_temp._v148_fold(v_src) <> '52bf0c1621beb1e2d46f0cc7cff1b9fa' THEN
    RAISE EXCEPTION 'db/148: record_notice_for() is not this file''s (md5 %)', pg_temp._v148_fold(v_src);
  END IF;
END $check$;

DROP FUNCTION pg_temp._v148_fold(text);
