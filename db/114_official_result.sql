-- ══════════════════════════════════════════════════════════════════
--  114 · When a result becomes OFFICIAL
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, but for the table's policies between the GENERATED markers
-- (TABLES_ADDED_SINCE_09). The design is docs/design/OFFICIAL_RESULT.md,
-- slice S1 (§4 S1–S8, §5, §6), approved by Kameel on 8 October 2026 as
-- recommended (D1–D14, Q1–Q8; audit/GAP_ANALYSIS_2026-10-05.md decision 8).
-- Its proof is db/99 §91; the API walk is tools/smoke-official.mjs.
--
-- THE GAP. A finished match had a status (`complete`) and a result read off
-- the log, and nothing that said a second person had looked at that result
-- and stood behind it. "Looks right" dismissed a banner on one phone. So
-- nothing could honestly be called official.
--
-- WHAT "OFFICIAL" IS (D1). One stored act, pinned to the log's revision: a
-- row of match_result_confirmation naming the match, the head `seq` of its
-- log and the `result_hash` match_result() gave, who confirmed it, when and
-- in which role. "Official" is DERIVED, as the result is: a match is
-- official when a standing confirmation names the CURRENT head and the
-- CURRENT hash and no dispute stands on it. Any correction moves the head (a
-- void, a released held ball, a late ball, an import) or the hash (a
-- decision recorded or withdrawn, a status change), so the confirmation
-- stops matching by itself; the triggers below only stamp WHEN and WHY it
-- lapsed and tell both schools (D9). The stamp is the audit and the hook,
-- never the truth. Re-confirmation is a new row; the old one stays.
--
-- NAMES. The design's `match_official(m)` would clash with db/08's TABLE
-- match_official (the officials appointed to a fixture), so the read is
-- match_official_state(m). The design's "db/90" and "§69" are taken
-- (db/90_account_status_change, db/99 §69): this is db/114 and §91.
--
-- WHAT CHANGES ON A LIVE DATABASE
--   capability    + result.confirm (catalogue row; held by superadmin,
--                   directorofsport, principal, competitionadmin: §5)
--   catalogue     + playing_condition_key results.confirmed_by (table part,
--                   enum organiser | home_school | either_school) and
--                   results.dispute_days (table part, int, days). No platform
--                   default: the reader's own fallback is `organiser` and 7
--                   (D4, Q2), so no document already fixed or fixed from now
--                   on changes because of this file.
--   table         + match_result_confirmation (empty), RLS on, its generated
--                   read policy; the application reads its plain columns
--                   (never the notes, the people or the dispute's time) and
--                   writes nothing: the doors below are the only writers.
--                   A guard trigger: never changed but to stamp, once per
--                   stamp; never deleted but with its match.
--   triggers      + ball_event       match_result_confirmation_lapse (AFTER
--                                    INSERT, FOR EACH STATEMENT, one indexed
--                                    lookup per match in the statement)
--                 + match_result_decision  ..._lapse (AFTER INSERT OR UPDATE)
--                 + match            ..._lapse (AFTER UPDATE OF status)
--                 + match_result_confirmation  public_data_changed
--   functions     + match_head_seq, match_verified (RECOGNITION R3's, one
--                   definition, this file's), match_seals_stand,
--                   result_confirmer_of, result_dispute_days,
--                   result_confirm_as, result_dispute_as, result_staff,
--                   result_hand_on_log, result_confirm_blocker, result_official_at,
--                   result_is_official, match_official_core,
--                   result_official_notices, result_lapse
--                   (the system's own; nobody may call them)
--                 + match_confirmable, match_result_confirm,
--                   match_result_dispute, match_result_dispute_clear,
--                   match_result_confirmation_withdraw, match_official_state,
--                   results_to_confirm (the doors: scrbrd_app only)
--   restated      public_match_result()        + official, official_at
--                 competition_standing_rows()  + provisional_results (db/73's
--                   body otherwise exactly; the view competition_standing
--                   dropped and made again over it)
--                 public_competition_standing() + provisional_results
--   No existing row is changed. No figure, standing, progression, career or
--   honour waits for the word (D10): the table counts what it counted.
--
-- WHO MAY CONFIRM (D2, D3, D4, Q1, Q8). A competition fixture: the
-- organiser — result.confirm at the competition's organising school (for a
-- league with no organising school, a platform-wide holder) — always; the
-- home school's holder too where the match's frozen document says
-- results.confirmed_by = home_school; either school's where it says
-- either_school. A friendly: the home school's holder (the director of
-- sport, the principal). The home school's confirmation stands alone when
-- the away side is not on the platform (Q8). The superadmin confirms as
-- `platform`. And whoever it is, the row check of D5: the confirmer is never
-- a hand on the log — not the scorer of any event, not the requester or the
-- approver of an applied amendment, not the releaser of a held ball, not
-- the typist or the confirmer of a scorebook import (`you_wrote_this_log`).
--
-- WHEN (D6). Complete or abandoned; every innings sealed by the scorer with
-- the seal standing — or sealed and since changed only through the two-hand
-- paths (an approved amendment's void, a released held ball), see
-- match_seals_stand() — or a standing decision row, or abandoned with no
-- innings; no amendment pending; no held ball unresolved; not already
-- official. No earliest time.
--
-- DISPUTE, CLEAR, WITHDRAW (D7, D14, Q2, Q5). Within results.dispute_days
-- (7 by default) of the confirmation, a result.confirm holder of either side
-- or the organiser disputes it with a note of ten characters or more: the
-- staff word becomes "Under review" and nothing else moves; the public reads
-- "Provisional" (Q3: "Under review" is never public). The organiser clears
-- it (for a friendly, a holder at either school who is not the disputant),
-- with a note, and the result is official again. The confirmer may withdraw
-- his own within the window, with a note. After the window: only a
-- correction reopens it, and every correction does (D8: never locked).
--
-- WHAT IS SAID (D11, §3 "notices"). Kind `fixture` (D1's closed list), to
-- each side's team scope under fixture.read — never a child's name, never who
-- confirmed or disputed, never a reason: official → low; reopened or
-- withdrawn → medium, to both sides and to the organiser where the
-- competition has an organising school, and the official notice retracted
-- `superseded` without a second word (db/89's notification_retract(…, false):
-- the "reopened" notice is the one thing said, so nobody is told twice).
-- Each lives a week past the later of the fixture and the telling.
--
-- NOTHING IS REMOVED but what this file makes again: the three restated
-- reads (each dropped and created, because their columns change; their
-- grants restated as db/69 and db/71 gave them) and the view over the table
-- function. CREATE … IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO
-- NOTHING throughout. Safe to run twice. SQL-Editor-safe: no transaction
-- statements, no psql commands.

-- ── 0 · The base this file is written against ──────────────────────
DO $base$
DECLARE v_res text; v_src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'milestone_notice' AND column_name = 'notice_id') THEN
    RAISE EXCEPTION 'db/114 needs db/113 (milestone_notice.notice_id): paste 113 first';
  END IF;
  IF to_regprocedure('notification_retract(uuid,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'db/114 needs db/89''s notification_retract(): paste 89 first';
  END IF;
  IF to_regclass('match_result_decision') IS NULL OR to_regprocedure('match_result_compute(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/114 needs db/69 (match_result_decision, match_result_compute)';
  END IF;
  -- The public result: db/71's fourteen columns, or this file's sixteen.
  v_res := pg_get_function_result(to_regprocedure('public_match_result(uuid)'));
  IF v_res IS NULL OR position('super_overs jsonb' IN v_res) = 0 THEN
    RAISE EXCEPTION 'db/114: public_match_result() is not db/71''s (%): the base is wrong', coalesce(v_res, 'missing');
  END IF;
  -- The table: db/73's body (deemed figures for net run rate), or this file's.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = to_regprocedure('competition_standing_rows(uuid)');
  IF v_src IS NULL OR position('nrr_runs' IN v_src) = 0 OR position('unattested' IN coalesce(
       pg_get_function_result(to_regprocedure('competition_standing_rows(uuid)')), '')) = 0 THEN
    RAISE EXCEPTION 'db/114: competition_standing_rows() is not db/73''s: the base is wrong';
  END IF;
  -- The name the design used is a table here (db/08): this file never makes
  -- a function of that name.
  IF to_regclass('match_official') IS NULL THEN
    RAISE EXCEPTION 'db/114: db/08''s match_official table is missing: the base is wrong';
  END IF;
END $base$;


-- ── 1 · The capability: result.confirm (§4 S1, §5) ─────────────────
-- The catalogue row and one role_capability row per holder in roles.mjs
-- (services/api/rls/generate-rls.mjs ADDED_SINCE_01; rls.test.mjs holds the
-- list to the model). Confirming, disputing and clearing ride on one name:
-- all three are standing behind a result, and the row checks below decide
-- which act a holder may do on which match.
INSERT INTO capability (name) VALUES ('result.confirm') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('superadmin',       'result.confirm'),
  ('directorofsport',  'result.confirm'),
  ('principal',        'result.confirm'),
  ('competitionadmin', 'result.confirm')
ON CONFLICT DO NOTHING;


-- ── 2 · Who confirms a competition's results, and the window (D4, Q2) ──
-- Two keys of the table part, read through the match's own frozen document
-- as the table keys are (SCRBRD-114 D1: one model per competition, frozen
-- per match). No platform default: a document that does not state them reads
-- `organiser` and 7, the reader's own fallback, which keeps every document
-- already fixed — and every one fixed from now — byte for byte as it was.
-- Mirrored by packages/scoring/src/conditions.mjs (CONDITION); db/99 §39
-- compares the two.
INSERT INTO playing_condition_key (key, part, value_type, unit, enum_values, by_age_band, platform_default, readers, sort_order) VALUES
  ('results.confirmed_by', 'table', 'enum', NULL,   '{organiser,home_school,either_school}', false, NULL, '{sql}', 150),
  ('results.dispute_days', 'table', 'int',  'days', NULL,                                     false, NULL, '{sql}', 151)
ON CONFLICT (key) DO NOTHING;


-- ── 3 · The confirmation (§4 S2) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS match_result_confirmation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id           uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  -- The revision it was given for: the log's max(seq) (0 for a match with no
  -- event) and match_result()'s hash, at the moment of confirming.
  head_seq           integer NOT NULL CHECK (head_seq >= 0),
  result_hash        text NOT NULL CHECK (result_hash ~ '^[0-9a-f]{32}$'),
  -- The standing decision at the time, if one stood (a walkover, an award).
  decision_id        uuid REFERENCES match_result_decision(id),
  confirmed_by       uuid NOT NULL REFERENCES app_user(id),
  confirmed_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- The role word D11 shows staff: "confirmed by the organiser".
  confirmed_as       text NOT NULL CHECK (confirmed_as IN ('organiser', 'home_school', 'away_school', 'platform')),
  -- results.dispute_days after confirmed_at, frozen with the row.
  window_closes_at   timestamptz NOT NULL,
  -- The fixture notices that said it was official, retracted on a lapse.
  notice_ids         uuid[] NOT NULL DEFAULT '{}',
  -- D9: when and why it stopped matching (the stamp; never the truth).
  lapsed_at          timestamptz,
  lapsed_seq         integer,
  lapsed_reason      text CHECK (lapsed_reason IN ('correction', 'decision', 'status')),
  -- D7: one dispute per confirmation, and its clearing.
  disputed_by        uuid REFERENCES app_user(id),
  disputed_at        timestamptz,
  disputed_as        text CHECK (disputed_as IN ('organiser', 'home_school', 'away_school', 'platform')),
  dispute_note       text,
  dispute_cleared_by uuid REFERENCES app_user(id),
  dispute_cleared_at timestamptz,
  dispute_cleared_note text,
  -- D14: the confirmer's own withdrawal, within the window.
  withdrawn_by       uuid REFERENCES app_user(id),
  withdrawn_at       timestamptz,
  withdrawn_note     text,
  CONSTRAINT match_result_confirmation_window CHECK (window_closes_at >= confirmed_at),
  CONSTRAINT match_result_confirmation_lapse_whole
    CHECK ((lapsed_at IS NULL) = (lapsed_reason IS NULL) AND (lapsed_at IS NULL) = (lapsed_seq IS NULL)),
  CONSTRAINT match_result_confirmation_dispute_whole
    CHECK ((disputed_at IS NULL) = (disputed_by IS NULL) AND (disputed_at IS NULL) = (dispute_note IS NULL)
           AND (disputed_at IS NULL) = (disputed_as IS NULL)),
  CONSTRAINT match_result_confirmation_dispute_says_why CHECK (dispute_note IS NULL OR length(btrim(dispute_note)) >= 10),
  CONSTRAINT match_result_confirmation_clear_whole
    CHECK ((dispute_cleared_at IS NULL) = (dispute_cleared_by IS NULL) AND (dispute_cleared_at IS NULL) = (dispute_cleared_note IS NULL)),
  CONSTRAINT match_result_confirmation_clear_says_why CHECK (dispute_cleared_note IS NULL OR length(btrim(dispute_cleared_note)) >= 10),
  CONSTRAINT match_result_confirmation_clear_needs_dispute CHECK (dispute_cleared_at IS NULL OR disputed_at IS NOT NULL),
  CONSTRAINT match_result_confirmation_withdrawal_whole
    CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL) AND (withdrawn_at IS NULL) = (withdrawn_note IS NULL)),
  CONSTRAINT match_result_confirmation_withdrawal_says_why CHECK (withdrawn_note IS NULL OR length(btrim(withdrawn_note)) >= 10),
  CONSTRAINT match_result_confirmation_withdrawn_by_confirmer CHECK (withdrawn_by IS NULL OR withdrawn_by = confirmed_by)
);
COMMENT ON TABLE match_result_confirmation IS
  'OFFICIAL_RESULT D1 (db/114): a second person standing behind a result, pinned to the log''s head and the result''s hash. Official is derived: a standing row matching both, no dispute standing (match_official_state()). Never changed but to stamp; never deleted.';
-- One standing confirmation per match: lapsed and withdrawn rows are kept beside it.
CREATE UNIQUE INDEX IF NOT EXISTS match_result_confirmation_standing
  ON match_result_confirmation (match_id) WHERE lapsed_at IS NULL AND withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS match_result_confirmation_match ON match_result_confirmation (match_id, confirmed_at DESC);

-- The guard, as match_result_decision_guard (db/69): a row is born whole and
-- unstamped; each stamp is made once and never changed; nothing else moves;
-- a row is deleted only with its match (ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION match_result_confirmation_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM match m WHERE m.id = OLD.match_id) THEN
      RAISE EXCEPTION 'a confirmation is never deleted: it lapses, or is withdrawn, and is kept'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'match_result_confirmation_is_kept';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lapsed_at IS NOT NULL OR NEW.disputed_at IS NOT NULL OR NEW.dispute_cleared_at IS NOT NULL
       OR NEW.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'a confirmation is born standing: no lapse, dispute or withdrawal'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'match_result_confirmation_is_kept';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.match_id, NEW.head_seq, NEW.result_hash, NEW.decision_id, NEW.confirmed_by, NEW.confirmed_at,
      NEW.confirmed_as, NEW.window_closes_at, NEW.notice_ids)
     IS DISTINCT FROM
     (OLD.id, OLD.match_id, OLD.head_seq, OLD.result_hash, OLD.decision_id, OLD.confirmed_by, OLD.confirmed_at,
      OLD.confirmed_as, OLD.window_closes_at, OLD.notice_ids)
     OR (OLD.lapsed_at IS NOT NULL AND (NEW.lapsed_at, NEW.lapsed_seq, NEW.lapsed_reason)
                                       IS DISTINCT FROM (OLD.lapsed_at, OLD.lapsed_seq, OLD.lapsed_reason))
     OR (OLD.disputed_at IS NOT NULL AND (NEW.disputed_at, NEW.disputed_by, NEW.disputed_as, NEW.dispute_note)
                                         IS DISTINCT FROM (OLD.disputed_at, OLD.disputed_by, OLD.disputed_as, OLD.dispute_note))
     OR (OLD.dispute_cleared_at IS NOT NULL AND (NEW.dispute_cleared_at, NEW.dispute_cleared_by, NEW.dispute_cleared_note)
                                                IS DISTINCT FROM (OLD.dispute_cleared_at, OLD.dispute_cleared_by, OLD.dispute_cleared_note))
     OR (OLD.withdrawn_at IS NOT NULL AND (NEW.withdrawn_at, NEW.withdrawn_by, NEW.withdrawn_note)
                                          IS DISTINCT FROM (OLD.withdrawn_at, OLD.withdrawn_by, OLD.withdrawn_note))
     -- A lapsed or withdrawn row is history: it takes no new stamp.
     OR ((OLD.lapsed_at IS NOT NULL OR OLD.withdrawn_at IS NOT NULL)
         AND (NEW.lapsed_at, NEW.disputed_at, NEW.dispute_cleared_at, NEW.withdrawn_at)
             IS DISTINCT FROM (OLD.lapsed_at, OLD.disputed_at, OLD.dispute_cleared_at, OLD.withdrawn_at)) THEN
    RAISE EXCEPTION 'a confirmation is never changed: it is stamped once — lapsed, disputed, cleared or withdrawn — and kept'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'match_result_confirmation_is_kept';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_confirmation_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS match_result_confirmation_guard ON match_result_confirmation;
CREATE TRIGGER match_result_confirmation_guard BEFORE INSERT OR UPDATE OR DELETE ON match_result_confirmation
  FOR EACH ROW EXECUTE FUNCTION match_result_confirmation_guard();
-- The signed-out page's entry for the fixture drops at commit (db/59).
DROP TRIGGER IF EXISTS public_data_changed ON match_result_confirmation;
CREATE TRIGGER public_data_changed AFTER INSERT OR UPDATE ON match_result_confirmation
  FOR EACH ROW EXECUTE FUNCTION public_data_notify('match', 'match_id');

ALTER TABLE match_result_confirmation ENABLE ROW LEVEL SECURITY;


-- ── 4 · The facts a confirmation stands on (§4 S3) ─────────────────
-- None of these is the application's: the doors and the reads below call
-- them as the owner. Each asks nothing about the caller.

-- The head of the log: the last seq written, whatever its kind (a void, a
-- released ball, an import), 0 for a match with no event.
CREATE OR REPLACE FUNCTION match_head_seq(p_match uuid) RETURNS integer AS $$
  SELECT coalesce(max(b.seq), 0) FROM ball_event b WHERE b.match_id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_head_seq(uuid) FROM PUBLIC;

-- RECOGNITION R3's `match_verified`, one definition, this file's: the match
-- complete, and every innings of its log sealed by the scorer with the seal
-- standing (match_result()'s `sealed`: the figures read back at the seal are
-- the log's). The scorer's tier: R3 builds fixture_class() beside it.
CREATE OR REPLACE FUNCTION match_verified(p_match uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT m.status = 'complete' FROM match m WHERE m.id = p_match), false)
     AND coalesce((SELECT jsonb_array_length(r.innings) > 0
                          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.innings) i
                                           WHERE (i->>'sealed')::boolean IS NOT TRUE)
                     FROM match_result_compute(p_match) r), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_verified(uuid) FROM PUBLIC;

-- D6's seal test, for confirming: every innings of the log was sealed by the
-- scorer and either the seal stands, or the innings has changed since its
-- seal ONLY through the two-hand paths — an approved amendment's void
-- (payload names the amendment; db/38, db/69) or a ball released from the
-- hold (recovered; db/14, db/37). A void of an earlier ball moves the
-- figures the seal read back, so the seal no longer "stands"; the pad cannot
-- seal a complete match again (db/33). Without this, a result corrected by
-- amendment could never be confirmed again, which D8 and D9 require.
-- An innings the pad's undo unsealed (the innings_end voided) is not sealed.
CREATE OR REPLACE FUNCTION match_seals_stand(p_match uuid) RETURNS boolean AS $$
  WITH inns AS (
    SELECT (i->>'innings')::smallint AS innings, coalesce((i->>'sealed')::boolean, false) AS sealed
      FROM match_result_compute(p_match) r, jsonb_array_elements(r.innings) i)
  SELECT EXISTS (SELECT 1 FROM inns)
     AND NOT EXISTS (
       SELECT 1 FROM inns x
        WHERE NOT x.sealed
          AND NOT EXISTS (
            SELECT 1 FROM ball_event_live e
             WHERE e.match_id = p_match AND e.innings = x.innings AND e.kind = 'innings_end'
               AND NOT EXISTS (SELECT 1 FROM ball_event a
                                WHERE a.match_id = p_match AND a.innings = x.innings AND a.seq > e.seq
                                  AND NOT ((a.kind = 'void' AND a.payload ? 'amendment' AND a.payload ? 'approved_by')
                                           OR a.recovered))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_seals_stand(uuid) FROM PUBLIC;

-- D4: who confirms this match. A friendly (no competition): the home school.
-- A competition fixture: its frozen document's results.confirmed_by, else the
-- organiser (A3: a fixture with no document falls back to the organiser).
CREATE OR REPLACE FUNCTION result_confirmer_of(p_match uuid) RETURNS text AS $$
  SELECT CASE WHEN m.competition_id IS NULL THEN 'home_school'
              ELSE coalesce((SELECT c.doc->'table'->>'results.confirmed_by' FROM match_conditions c
                              WHERE c.match_id = m.id
                                AND c.doc->'table'->>'results.confirmed_by' IN ('organiser', 'home_school', 'either_school')),
                            'organiser') END
    FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_confirmer_of(uuid) FROM PUBLIC;

-- Q2: the dispute window, in days: the document's results.dispute_days where
-- it is a whole number from 1 to 60, else 7.
CREATE OR REPLACE FUNCTION result_dispute_days(p_match uuid) RETURNS integer AS $$
  SELECT coalesce((SELECT (c.doc->'table'->>'results.dispute_days')::integer FROM match_conditions c
                    WHERE c.match_id = p_match
                      AND jsonb_typeof(c.doc->'table'->'results.dispute_days') = 'number'
                      AND c.doc->'table'->>'results.dispute_days' ~ '^[0-9]{1,2}$'
                      AND (c.doc->'table'->>'results.dispute_days')::integer BETWEEN 1 AND 60), 7)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_dispute_days(uuid) FROM PUBLIC;

-- Is the caller's result.confirm the platform's — a superadmin assignment —
-- rather than a school's or a league's? Then the role word is `platform`.
CREATE OR REPLACE FUNCTION result_confirm_platform() RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = app_user_id() AND a.active AND a.role = 'superadmin'
                    AND (a.valid_from IS NULL OR a.valid_from <= current_date)
                    AND (a.valid_until IS NULL OR a.valid_until > current_date)
                    AND (a.expires_at IS NULL OR a.expires_at > now()))
     AND NOT EXISTS (SELECT 1 FROM role_assignment a
                      JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'result.confirm'
                     WHERE a.person_id = app_user_id() AND a.active AND a.role <> 'superadmin'
                       AND (a.valid_from IS NULL OR a.valid_from <= current_date)
                       AND (a.valid_until IS NULL OR a.valid_until > current_date)
                       AND (a.expires_at IS NULL OR a.expires_at > now()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_confirm_platform() FROM PUBLIC;

-- The three scopes result.confirm is asked at: the organiser (competition
-- fixtures), the home school's side, the away school's side. A person as
-- himself: never a pad's credential, never a support session.
CREATE OR REPLACE FUNCTION result_scope_holds(p_match uuid, p_scope text) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND app_support_access_id() IS NULL
     AND coalesce((
       SELECT CASE p_scope
                WHEN 'organiser' THEN m.competition_id IS NOT NULL
                     AND app_can('result.confirm', competition_organiser(m.competition_id), '*'::text,
                                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
                WHEN 'home_school' THEN
                     app_can('result.confirm', m.school_id, m.team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id)
                WHEN 'away_school' THEN m.away_school_id IS NOT NULL
                     AND app_can('result.confirm', m.away_school_id, m.away_team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id)
                ELSE false END
         FROM match m WHERE m.id = p_match), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_scope_holds(uuid, text) FROM PUBLIC;

-- The role word under which the caller may CONFIRM this match, or NULL
-- (D2, D3, D4, Q1, Q8; §5's table).
CREATE OR REPLACE FUNCTION result_confirm_as(p_match uuid) RETURNS text AS $$
DECLARE m match%ROWTYPE; v_who text; v_as text;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_who := result_confirmer_of(p_match);
  IF m.competition_id IS NOT NULL AND result_scope_holds(p_match, 'organiser') THEN v_as := 'organiser';
  ELSIF v_who IN ('home_school', 'either_school') AND result_scope_holds(p_match, 'home_school') THEN v_as := 'home_school';
  ELSIF v_who = 'either_school' AND result_scope_holds(p_match, 'away_school') THEN v_as := 'away_school';
  END IF;
  IF v_as IS NOT NULL AND result_confirm_platform() THEN v_as := 'platform'; END IF;
  RETURN v_as;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_confirm_as(uuid) FROM PUBLIC;

-- The role word under which the caller may DISPUTE (or, for a friendly,
-- clear) this match: either side's result.confirm holder, or the organiser
-- (D7, Q8: the organiser may still dispute a league fixture). NULL: none.
CREATE OR REPLACE FUNCTION result_dispute_as(p_match uuid) RETURNS text AS $$
DECLARE v_as text;
BEGIN
  IF result_scope_holds(p_match, 'organiser') THEN v_as := 'organiser';
  ELSIF result_scope_holds(p_match, 'home_school') THEN v_as := 'home_school';
  ELSIF result_scope_holds(p_match, 'away_school') THEN v_as := 'away_school';
  END IF;
  IF v_as IS NOT NULL AND result_confirm_platform() THEN v_as := 'platform'; END IF;
  RETURN v_as;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_dispute_as(uuid) FROM PUBLIC;

-- Staff, for D11's words: the people a result's checking concerns — whoever
-- may confirm, approve or request a correction, or score, at either side;
-- and the organiser. A parent, a pupil, a follower is not: they read
-- "Provisional" and "Official result", never "Under review", never a role.
CREATE OR REPLACE FUNCTION result_staff(p_match uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND EXISTS (
       SELECT 1 FROM match m, unnest(ARRAY['result.confirm', 'scoring.amend.approve', 'scoring.amend.request', 'scoring.edit']) c(cap)
        WHERE m.id = p_match
          AND (app_can(c.cap, m.school_id, m.team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id)
               OR (m.away_school_id IS NOT NULL
                   AND app_can(c.cap, m.away_school_id, m.away_team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id))
               OR (m.competition_id IS NOT NULL AND c.cap IN ('result.confirm', 'scoring.amend.approve')
                   AND app_can(c.cap, competition_organiser(m.competition_id), '*'::text,
                               '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))))
     OR (app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND EXISTS (
       SELECT 1 FROM match m WHERE m.id = p_match AND m.competition_id IS NOT NULL
          AND app_can('competition.manage', competition_organiser(m.competition_id), '*'::text,
                      '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_staff(uuid) FROM PUBLIC;

-- D5: is this person a hand on the match's log? Which hand, or NULL. The
-- whole log is at or below its head, so every row of it is asked.
--   scorer    the scorer_user_id of any event (an amendment's void is the
--             requester's, db/69; a released ball the submitter's, db/14)
--   approver  the approved_by of an amendment's void
--   amendment the requester or decider of an applied amendment
--   releaser  whoever released a held ball into the log
--   import    whoever typed, submitted or confirmed a scorebook import of it
CREATE OR REPLACE FUNCTION result_hand_on_log(p_match uuid, p_user uuid) RETURNS text AS $$
  SELECT CASE
    WHEN p_user IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = p_match AND b.scorer_user_id = p_user) THEN 'scorer'
    WHEN EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = p_match AND b.kind = 'void'
                    AND b.payload->>'approved_by' = p_user::text) THEN 'approver'
    WHEN EXISTS (SELECT 1 FROM scoring_amendment a WHERE a.match_id = p_match AND a.state = 'approved'
                    AND (a.requested_by = p_user OR a.decided_by = p_user)) THEN 'amendment'
    WHEN EXISTS (SELECT 1 FROM ball_event_quarantine q WHERE q.match_id = p_match AND q.resolution = 'accepted'
                    AND q.resolved_by = p_user) THEN 'releaser'
    WHEN EXISTS (SELECT 1 FROM scorebook_import s WHERE s.match_id = p_match AND s.state = 'confirmed'
                    AND p_user IN (s.created_by, s.submitted_by, s.confirmed_by)) THEN 'import'
  END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_hand_on_log(uuid, uuid) FROM PUBLIC;

-- When the match, as it stands, was made official: the standing
-- confirmation's time when it names the current head and the given (current)
-- hash and no dispute stands on it; else NULL. The one rule every reader of
-- the word asks (the public result, the table's count, the state).
CREATE OR REPLACE FUNCTION result_official_at(p_match uuid, p_hash text) RETURNS timestamptz AS $$
  SELECT c.confirmed_at FROM match_result_confirmation c
   WHERE c.match_id = p_match AND c.lapsed_at IS NULL AND c.withdrawn_at IS NULL
     AND c.head_seq = match_head_seq(p_match) AND c.result_hash = p_hash
     AND (c.disputed_at IS NULL OR c.dispute_cleared_at IS NOT NULL)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_official_at(uuid, text) FROM PUBLIC;
CREATE OR REPLACE FUNCTION result_is_official(p_match uuid, p_hash text) RETURNS boolean AS $$
  SELECT result_official_at(p_match, p_hash) IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_is_official(uuid, text) FROM PUBLIC;

-- D6, the half that asks nothing of the caller: the first reason the match
-- cannot be confirmed now, or NULL. In the design's order.
CREATE OR REPLACE FUNCTION result_confirm_blocker(p_match uuid) RETURNS text AS $$
DECLARE
  m match%ROWTYPE;
  r record;
  c match_result_confirmation%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR m.status NOT IN ('complete', 'abandoned') THEN RETURN 'not_finished'; END IF;
  SELECT x.result_hash, x.innings INTO r FROM match_result_compute(p_match) x;
  IF NOT (EXISTS (SELECT 1 FROM match_result_decision d WHERE d.match_id = p_match AND d.withdrawn_at IS NULL)
          OR (m.status = 'abandoned' AND coalesce(jsonb_array_length(r.innings), 0) = 0)
          OR match_seals_stand(p_match)) THEN
    RETURN 'innings_unsealed';
  END IF;
  IF EXISTS (SELECT 1 FROM scoring_amendment a WHERE a.match_id = p_match AND a.state = 'pending') THEN
    RETURN 'amendment_pending';
  END IF;
  IF EXISTS (SELECT 1 FROM ball_event_quarantine q WHERE q.match_id = p_match AND q.resolved_at IS NULL) THEN
    RETURN 'ball_held';
  END IF;
  SELECT * INTO c FROM match_result_confirmation x
   WHERE x.match_id = p_match AND x.lapsed_at IS NULL AND x.withdrawn_at IS NULL;
  IF FOUND AND c.head_seq = match_head_seq(p_match) AND c.result_hash = r.result_hash THEN
    RETURN 'already_official';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_confirm_blocker(uuid) FROM PUBLIC;

-- The state as the system knows it, for nobody in particular (§2's table).
--   state       not_finished · provisional · under_review · official
--   standing    the standing confirmation, when it matches (official or under review)
--   last        the newest confirmation that no longer stands (lapsed or withdrawn), for
--               "was official 20:15 · reopened by a correction 18:42"
--   blocked_by  D6's reason, for a provisional result that cannot be confirmed yet
CREATE OR REPLACE FUNCTION match_official_core(p_match uuid)
RETURNS TABLE (state text, standing_id uuid, confirmed_at timestamptz, confirmed_as text, head_seq integer,
               window_closes_at timestamptz, disputed_at timestamptz, disputed_as text, disputed_by uuid,
               dispute_cleared_at timestamptz, confirmed_by uuid,
               last_id uuid, last_confirmed_at timestamptz, lapsed_at timestamptz, lapsed_reason text,
               withdrawn_at timestamptz, blocked_by text) AS $$
DECLARE
  m match%ROWTYPE;
  v_hash text;
  v_head integer;
  c match_result_confirmation%ROWTYPE;
  l match_result_confirmation%ROWTYPE;
  v_state text;
  v_block text;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT x.result_hash INTO v_hash FROM match_result_compute(p_match) x;
  v_head := match_head_seq(p_match);
  SELECT * INTO c FROM match_result_confirmation x
   WHERE x.match_id = p_match AND x.lapsed_at IS NULL AND x.withdrawn_at IS NULL
     AND x.head_seq = v_head AND x.result_hash = v_hash;
  SELECT * INTO l FROM match_result_confirmation x
   WHERE x.match_id = p_match AND (x.lapsed_at IS NOT NULL OR x.withdrawn_at IS NOT NULL)
   ORDER BY coalesce(x.lapsed_at, x.withdrawn_at) DESC, x.confirmed_at DESC LIMIT 1;
  IF c.id IS NOT NULL THEN
    v_state := CASE WHEN c.disputed_at IS NOT NULL AND c.dispute_cleared_at IS NULL THEN 'under_review' ELSE 'official' END;
  ELSIF m.status NOT IN ('complete', 'abandoned') THEN
    v_state := 'not_finished';
  ELSE
    v_state := 'provisional';
    v_block := result_confirm_blocker(p_match);
    IF v_block IN ('not_finished', 'already_official') THEN v_block := NULL; END IF;
  END IF;
  RETURN QUERY SELECT v_state, c.id, c.confirmed_at, c.confirmed_as, v_head, c.window_closes_at,
                      c.disputed_at, c.disputed_as, c.disputed_by, c.dispute_cleared_at, c.confirmed_by,
                      l.id, l.confirmed_at, l.lapsed_at, l.lapsed_reason, l.withdrawn_at, v_block;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_official_core(uuid) FROM PUBLIC;


-- ── 5 · What is said (D9, D11, §3 "notices") ───────────────────────
-- Kind `fixture`, to each side's team scope under fixture.read: a parent, a
-- pupil and the staff of the side read it; no child is named, no person, no
-- reason. p_what:
--   official    low, to both sides                       (returns their ids)
--   correction  medium, both sides and the organiser:  "…the scorecard was corrected at 18:42…"
--   decision    medium, the same:                       "…a decision on the result was recorded or withdrawn at…"
--   status      medium, the same:                       "…the match's status changed at…"
--   withdrawn   medium, the same:                       "…the confirmation was withdrawn at…"
-- Each lives a week past the later of the fixture and the telling (D2's
-- "start+7" would have a late confirmation born expired).
CREATE OR REPLACE FUNCTION result_official_notices(p_match uuid, p_what text, p_at timestamptz)
RETURNS uuid[] AS $$
DECLARE
  m match%ROWTYPE;
  v_home text; v_away text; v_title text; v_body text; v_urg text; v_life timestamptz;
  v_clock text := to_char(p_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI');
  v_day   text := to_char(p_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon');
  v_ids uuid[] := '{}';
  v_id uuid;
  t record;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND THEN RETURN v_ids; END IF;
  v_home := coalesce(fixture_side_label(m.school_id, m.team_code), m.team_code, 'Home');
  v_away := coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent, 'Away');
  v_life := greatest(m.starts_at, p_at) + interval '7 days';
  IF p_what = 'official' THEN
    v_urg := 'low';
    v_title := 'Official result · ' || v_home || ' v ' || v_away;
    v_body := 'The result of ' || v_home || ' v ' || v_away || ' ('
              || to_char(m.starts_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon') || ') was confirmed at '
              || v_clock || ', ' || v_day || '.';
  ELSE
    v_urg := 'medium';
    v_title := 'Result reopened · ' || v_home || ' v ' || v_away;
    v_body := 'The result of ' || v_home || ' v ' || v_away || ' is no longer official: '
              || CASE p_what WHEN 'correction' THEN 'the scorecard was corrected at '
                             WHEN 'decision'   THEN 'a decision on the result was recorded or withdrawn at '
                             WHEN 'status'     THEN 'the match''s status changed at '
                             ELSE 'the confirmation was withdrawn at ' END
              || v_clock || ', ' || v_day || '. It will be confirmed again.';
  END IF;
  FOR t IN SELECT x.school, x.team FROM (VALUES (m.school_id, m.team_code), (m.away_school_id, m.away_team_code)) x(school, team)
            WHERE x.school IS NOT NULL
              AND x.team ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$' LOOP
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, is_public, subject_kind, subject_id, expires_at)
    VALUES (t.school, t.team, 'team', 'fixture', v_urg, v_title, v_body, 'fixture.read', false, 'match', p_match, v_life)
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;
  -- The organiser hears a reopening, where the competition has a school
  -- (progression_check()'s rule, db/72).
  IF p_what <> 'official' AND m.competition_id IS NOT NULL THEN
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, is_public, subject_kind, subject_id, expires_at)
    SELECT c.school_id, NULL, 'competition', 'fixture', v_urg, v_title, v_body, 'competition.manage', false, 'match', p_match, v_life
      FROM competition c WHERE c.id = m.competition_id AND c.school_id IS NOT NULL;
  END IF;
  RETURN v_ids;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_official_notices(uuid, text, timestamptz) FROM PUBLIC;

-- Take back what said a result was official: each notice retracted
-- `superseded`, saying nothing (the reopening notice is the one word).
CREATE OR REPLACE FUNCTION result_official_unsay(p_ids uuid[]) RETURNS void AS $$
DECLARE v uuid;
BEGIN
  FOREACH v IN ARRAY coalesce(p_ids, '{}'::uuid[]) LOOP
    IF EXISTS (SELECT 1 FROM notification n WHERE n.id = v AND n.retracted_at IS NULL) THEN
      PERFORM notification_retract(v, 'superseded', false);
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_official_unsay(uuid[]) FROM PUBLIC;

-- D9: the standing confirmation of a match, if any, is stamped lapsed for
-- p_reason, its official notice taken back and the reopening said. One row at
-- most (the unique index). clock_timestamp(), as db/72: a lapse after a
-- confirmation in one transaction reads as after it.
CREATE OR REPLACE FUNCTION result_lapse(p_match uuid, p_reason text) RETURNS boolean AS $$
DECLARE c match_result_confirmation%ROWTYPE; v_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO c FROM match_result_confirmation x
   WHERE x.match_id = p_match AND x.lapsed_at IS NULL AND x.withdrawn_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE match_result_confirmation SET lapsed_at = v_at, lapsed_seq = match_head_seq(p_match), lapsed_reason = p_reason
   WHERE id = c.id;
  PERFORM result_official_unsay(c.notice_ids);
  PERFORM result_official_notices(p_match, p_reason, v_at);
  RETURN true;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION result_lapse(uuid, text) FROM PUBLIC;


-- ── 6 · The lapse triggers (§4 S4) ─────────────────────────────────
-- Any event appended to a log with a standing confirmation: a void, a
-- released held ball, a late ball, an import. Per statement, one indexed
-- lookup per match in it (most matches have no standing row; a live match
-- never has one, because a status change lapses it).
CREATE OR REPLACE FUNCTION match_result_confirmation_lapse_events() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT n.match_id FROM confirmation_new_events n
            WHERE EXISTS (SELECT 1 FROM match_result_confirmation c
                           WHERE c.match_id = n.match_id AND c.lapsed_at IS NULL AND c.withdrawn_at IS NULL) LOOP
    PERFORM result_lapse(r.match_id, 'correction');
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_confirmation_lapse_events() FROM PUBLIC;
DROP TRIGGER IF EXISTS match_result_confirmation_lapse ON ball_event;
CREATE TRIGGER match_result_confirmation_lapse AFTER INSERT ON ball_event
  REFERENCING NEW TABLE AS confirmation_new_events
  FOR EACH STATEMENT EXECUTE FUNCTION match_result_confirmation_lapse_events();

-- A decision recorded or withdrawn (db/69): the outcome moved without an event.
CREATE OR REPLACE FUNCTION match_result_confirmation_lapse_decision() RETURNS trigger AS $$
BEGIN
  PERFORM result_lapse(NEW.match_id, 'decision');
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_confirmation_lapse_decision() FROM PUBLIC;
DROP TRIGGER IF EXISTS match_result_confirmation_lapse ON match_result_decision;
CREATE TRIGGER match_result_confirmation_lapse AFTER INSERT OR UPDATE ON match_result_decision
  FOR EACH ROW EXECUTE FUNCTION match_result_confirmation_lapse_decision();

-- The match's status changed (complete → abandoned, or reopened to live).
CREATE OR REPLACE FUNCTION match_result_confirmation_lapse_status() RETURNS trigger AS $$
BEGIN
  PERFORM result_lapse(NEW.id, 'status');
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_confirmation_lapse_status() FROM PUBLIC;
DROP TRIGGER IF EXISTS match_result_confirmation_lapse ON match;
CREATE TRIGGER match_result_confirmation_lapse AFTER UPDATE OF status ON match
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION match_result_confirmation_lapse_status();


-- ── 7 · The doors (§4 S3) ──────────────────────────────────────────
-- Each answers rather than raises: (ok, reason, …). Capability is asked
-- first, so a caller with no standing over the match learns nothing about
-- it: one answer, not_permitted, for "no such match" and "not yours".

-- May the caller confirm this match now? D6's reasons, in the design's order.
CREATE OR REPLACE FUNCTION match_confirmable(p_match uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE v_block text;
BEGIN
  IF result_confirm_as(p_match) IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  v_block := result_confirm_blocker(p_match);
  IF v_block IS NOT NULL THEN RETURN QUERY SELECT false, v_block; RETURN; END IF;
  IF result_hand_on_log(p_match, app_user_id()) IS NOT NULL THEN
    RETURN QUERY SELECT false, 'you_wrote_this_log'::text; RETURN;
  END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_confirmable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_confirmable(uuid) TO scrbrd_app;

-- Confirm: one row, pinned to the head and the hash as they are under the
-- match's locks — the scoring session's row (the live path's and the
-- amendment's, db/38) and the per-match lock decisions take (db/61) — so
-- nothing is appended or decided between the check and the row.
--   support_session · not_permitted · not_finished · innings_unsealed ·
--   amendment_pending · ball_held · already_official · you_wrote_this_log
CREATE OR REPLACE FUNCTION match_result_confirm(p_match uuid)
RETURNS TABLE (ok boolean, reason text, confirmation_id uuid) AS $$
DECLARE
  v_me   uuid := app_user_id();
  v_as   text;
  v_hash text;
  v_dec  uuid;
  v_head integer;
  v_at   timestamptz;
  v_ids  uuid[];
  v_id   uuid;
  q      record;
  s      match_result_confirmation%ROWTYPE;
BEGIN
  IF app_support_access_id() IS NOT NULL AND v_me IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session'::text, NULL::uuid; RETURN;
  END IF;
  v_as := result_confirm_as(p_match);
  IF v_as IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN; END IF;
  PERFORM 1 FROM scoring_session x WHERE x.match_id = p_match FOR UPDATE;
  PERFORM match_conditions_lock(p_match);
  -- A standing row that no longer matches (a change no trigger saw: a side
  -- re-pointed on the match row) is stamped first, so the new one can stand.
  SELECT * INTO s FROM match_result_confirmation x
   WHERE x.match_id = p_match AND x.lapsed_at IS NULL AND x.withdrawn_at IS NULL FOR UPDATE;
  SELECT r.result_hash, (r.decision->>'id')::uuid INTO v_hash, v_dec FROM match_result_compute(p_match) r;
  v_head := match_head_seq(p_match);
  IF s.id IS NOT NULL AND (s.head_seq <> v_head OR s.result_hash <> v_hash) THEN
    PERFORM result_lapse(p_match, CASE WHEN s.head_seq <> v_head THEN 'correction'
                                       WHEN s.decision_id IS DISTINCT FROM v_dec THEN 'decision' ELSE 'status' END);
  END IF;
  SELECT * INTO q FROM match_confirmable(p_match) c;
  IF NOT q.ok THEN RETURN QUERY SELECT false, q.reason, NULL::uuid; RETURN; END IF;
  v_at := clock_timestamp();
  v_ids := result_official_notices(p_match, 'official', v_at);
  INSERT INTO match_result_confirmation (match_id, head_seq, result_hash, decision_id, confirmed_by, confirmed_at,
                                         confirmed_as, window_closes_at, notice_ids)
  VALUES (p_match, v_head, v_hash, v_dec, v_me, v_at, v_as,
          v_at + make_interval(days => result_dispute_days(p_match)), v_ids)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_confirm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result_confirm(uuid) TO scrbrd_app;

-- Dispute (D7): a stamp on the standing, matching confirmation by a
-- result.confirm holder of either side or the organiser, within the window,
-- with a note of ten characters or more. It moves no figure.
--   support_session · not_permitted · note_required · not_official ·
--   already_disputed · window_closed · cannot_dispute_your_own (withdraw it)
CREATE OR REPLACE FUNCTION match_result_dispute(p_match uuid, p_note text)
RETURNS TABLE (ok boolean, reason text, confirmation_id uuid) AS $$
DECLARE
  v_me uuid := app_user_id();
  v_as text;
  v_hash text;
  c match_result_confirmation%ROWTYPE;
BEGIN
  IF app_support_access_id() IS NOT NULL AND v_me IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session'::text, NULL::uuid; RETURN;
  END IF;
  v_as := result_dispute_as(p_match);
  IF v_as IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN; END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN
    RETURN QUERY SELECT false, 'note_required'::text, NULL::uuid; RETURN;
  END IF;
  PERFORM match_conditions_lock(p_match);
  SELECT r.result_hash INTO v_hash FROM match_result_compute(p_match) r;
  SELECT * INTO c FROM match_result_confirmation x
   WHERE x.match_id = p_match AND x.lapsed_at IS NULL AND x.withdrawn_at IS NULL
     AND x.head_seq = match_head_seq(p_match) AND x.result_hash = v_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_official'::text, NULL::uuid; RETURN; END IF;
  IF c.disputed_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_disputed'::text, c.id; RETURN; END IF;
  IF clock_timestamp() > c.window_closes_at THEN RETURN QUERY SELECT false, 'window_closed'::text, c.id; RETURN; END IF;
  IF c.confirmed_by = v_me THEN RETURN QUERY SELECT false, 'cannot_dispute_your_own'::text, c.id; RETURN; END IF;
  UPDATE match_result_confirmation
     SET disputed_by = v_me, disputed_at = clock_timestamp(), disputed_as = v_as, dispute_note = btrim(p_note)
   WHERE id = c.id;
  RETURN QUERY SELECT true, NULL::text, c.id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_dispute(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result_dispute(uuid, text) TO scrbrd_app;

-- Clear a dispute (D7 (b)), with a note: the organiser for a competition
-- fixture; for a friendly, a result.confirm holder at either school. Never the
-- disputant. The result stands official.
--   support_session · not_permitted · note_required · not_disputed ·
--   not_standing · cannot_clear_your_own
CREATE OR REPLACE FUNCTION match_result_dispute_clear(p_confirmation uuid, p_note text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
  c match_result_confirmation%ROWTYPE;
  v_comp uuid;
  v_may boolean;
BEGIN
  IF app_support_access_id() IS NOT NULL AND v_me IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session'::text; RETURN;
  END IF;
  SELECT * INTO c FROM match_result_confirmation x WHERE x.id = p_confirmation;
  IF FOUND THEN
    SELECT m.competition_id INTO v_comp FROM match m WHERE m.id = c.match_id;
    v_may := CASE WHEN v_comp IS NOT NULL THEN result_scope_holds(c.match_id, 'organiser')
                  ELSE result_scope_holds(c.match_id, 'home_school') OR result_scope_holds(c.match_id, 'away_school') END;
  END IF;
  IF c.id IS NULL OR NOT coalesce(v_may, false) THEN RETURN QUERY SELECT false, 'not_permitted'::text; RETURN; END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN RETURN QUERY SELECT false, 'note_required'::text; RETURN; END IF;
  PERFORM match_conditions_lock(c.match_id);
  SELECT * INTO c FROM match_result_confirmation x WHERE x.id = p_confirmation FOR UPDATE;
  IF c.disputed_at IS NULL OR c.dispute_cleared_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'not_disputed'::text; RETURN;
  END IF;
  IF c.lapsed_at IS NOT NULL OR c.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'not_standing'::text; RETURN;
  END IF;
  IF c.disputed_by = v_me THEN RETURN QUERY SELECT false, 'cannot_clear_your_own'::text; RETURN; END IF;
  UPDATE match_result_confirmation
     SET dispute_cleared_by = v_me, dispute_cleared_at = clock_timestamp(), dispute_cleared_note = btrim(p_note)
   WHERE id = c.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_dispute_clear(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result_dispute_clear(uuid, text) TO scrbrd_app;

-- Withdraw his own confirmation (D14, Q5): the confirmer, while he still
-- holds result.confirm for the match, within the window, with a note. Said
-- to both sides as a lapse is.
--   support_session · not_permitted · note_required · not_standing · window_closed
CREATE OR REPLACE FUNCTION match_result_confirmation_withdraw(p_confirmation uuid, p_note text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
  c match_result_confirmation%ROWTYPE;
  v_at timestamptz;
BEGIN
  IF app_support_access_id() IS NOT NULL AND v_me IS NOT NULL THEN
    RETURN QUERY SELECT false, 'support_session'::text; RETURN;
  END IF;
  SELECT * INTO c FROM match_result_confirmation x WHERE x.id = p_confirmation;
  IF NOT FOUND OR c.confirmed_by IS DISTINCT FROM v_me OR result_confirm_as(c.match_id) IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 10 THEN RETURN QUERY SELECT false, 'note_required'::text; RETURN; END IF;
  PERFORM match_conditions_lock(c.match_id);
  SELECT * INTO c FROM match_result_confirmation x WHERE x.id = p_confirmation FOR UPDATE;
  IF c.lapsed_at IS NOT NULL OR c.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'not_standing'::text; RETURN;
  END IF;
  v_at := clock_timestamp();
  IF v_at > c.window_closes_at THEN RETURN QUERY SELECT false, 'window_closed'::text; RETURN; END IF;
  UPDATE match_result_confirmation SET withdrawn_by = v_me, withdrawn_at = v_at, withdrawn_note = btrim(p_note)
   WHERE id = c.id;
  PERFORM result_official_unsay(c.notice_ids);
  PERFORM result_official_notices(c.match_id, 'withdrawn', v_at);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_result_confirmation_withdraw(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_result_confirmation_withdraw(uuid, text) TO scrbrd_app;


-- ── 8 · The read (§2, §3) ──────────────────────────────────────────
-- The design's match_official(m), named match_official_state(m): db/08 has a
-- TABLE match_official. For a reader of the result (match_result_readable(),
-- db/69) and nobody else: no row at all otherwise.
--
-- A parent, a pupil, a follower (not result_staff()) reads the public words'
-- facts: the state with under_review read as provisional (Q3, D11), when it
-- was confirmed or reopened — never who, never the role, never a dispute.
-- Staff read the role words, the dispute's side and time, the blocker, and
-- what they may do. A dispute's words reach the organiser, the disputant and
-- audit.read at either school, and nobody else (a dispute may be about a
-- boy's innings); the withdrawal's words, the confirmer and the same.
CREATE OR REPLACE FUNCTION match_official_state(p_match uuid)
RETURNS TABLE (state text, staff boolean, confirmation_id uuid, confirmed_at timestamptz, confirmed_as text,
               head_seq integer, window_closes_at timestamptz,
               disputed_at timestamptz, disputed_as text, dispute_note text, dispute_cleared_at timestamptz,
               was_official_at timestamptz, lapsed_at timestamptz, lapsed_reason text, withdrawn_at timestamptz,
               withdrawn_note text, blocked_by text, confirmer text,
               can_confirm boolean, confirm_refusal text, can_dispute boolean, can_clear boolean, can_withdraw boolean) AS $$
DECLARE
  o record;
  q record;
  v_staff boolean;
  v_note_reader boolean;
  v_comp uuid;
  v_w text;
  v_me uuid := app_user_id();
  v_open boolean;
BEGIN
  IF NOT match_result_readable(p_match) THEN RETURN; END IF;
  SELECT * INTO o FROM match_official_core(p_match);
  IF NOT FOUND THEN RETURN; END IF;
  v_staff := result_staff(p_match);
  SELECT m.competition_id INTO v_comp FROM match m WHERE m.id = p_match;
  v_note_reader := v_staff AND (result_scope_holds(p_match, 'organiser')
                   OR (o.disputed_by IS NOT NULL AND o.disputed_by = v_me)
                   OR EXISTS (SELECT 1 FROM match m WHERE m.id = p_match
                                 AND (app_can('audit.read', m.school_id, m.team_code, '00000000-0000-0000-0000-000000000000'::uuid, m.id)
                                      OR (m.away_school_id IS NOT NULL
                                          AND app_can('audit.read', m.away_school_id, m.away_team_code,
                                                      '00000000-0000-0000-0000-000000000000'::uuid, m.id)))));
  IF NOT v_staff THEN
    RETURN QUERY SELECT CASE WHEN o.state = 'under_review' THEN 'provisional' ELSE o.state END, false,
      NULL::uuid, CASE WHEN o.state = 'official' THEN o.confirmed_at END, NULL::text, o.head_seq, NULL::timestamptz,
      NULL::timestamptz, NULL::text, NULL::text, NULL::timestamptz,
      NULL::timestamptz, CASE WHEN o.state IN ('provisional', 'not_finished') THEN coalesce(o.lapsed_at, o.withdrawn_at) END,
      NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::text,
      false, NULL::text, false, false, false;
    RETURN;
  END IF;
  SELECT * INTO q FROM match_confirmable(p_match);
  v_open := o.standing_id IS NOT NULL AND clock_timestamp() <= o.window_closes_at;
  IF v_note_reader OR (o.last_id IS NOT NULL AND
                       (SELECT x.confirmed_by FROM match_result_confirmation x WHERE x.id = o.last_id) = v_me) THEN
    SELECT x.withdrawn_note INTO v_w FROM match_result_confirmation x WHERE x.id = o.last_id;
  END IF;
  RETURN QUERY SELECT o.state, true, o.standing_id, o.confirmed_at, o.confirmed_as, o.head_seq, o.window_closes_at,
    o.disputed_at, o.disputed_as,
    CASE WHEN v_note_reader AND o.standing_id IS NOT NULL
         THEN (SELECT x.dispute_note FROM match_result_confirmation x WHERE x.id = o.standing_id) END,
    o.dispute_cleared_at,
    o.last_confirmed_at, o.lapsed_at, o.lapsed_reason, o.withdrawn_at, v_w, o.blocked_by,
    CASE WHEN o.standing_id IS NOT NULL AND o.confirmed_by = v_me THEN 'you' END,
    coalesce(q.ok, false), CASE WHEN q.reason IS DISTINCT FROM 'not_permitted' THEN q.reason END,
    -- may dispute: a standing official result, the window open, a holder of
    -- either side or the organiser, not its confirmer
    (o.state = 'official' AND v_open AND o.disputed_at IS NULL AND o.confirmed_by IS DISTINCT FROM v_me
     AND result_dispute_as(p_match) IS NOT NULL),
    -- may clear: a standing dispute, the organiser (a friendly: either school), not the disputant
    (o.state = 'under_review' AND o.disputed_by IS DISTINCT FROM v_me
     AND CASE WHEN v_comp IS NOT NULL THEN result_scope_holds(p_match, 'organiser')
              ELSE result_scope_holds(p_match, 'home_school') OR result_scope_holds(p_match, 'away_school') END),
    -- may withdraw: his own, standing, the window open
    (o.standing_id IS NOT NULL AND o.confirmed_by = v_me AND v_open AND result_confirm_as(p_match) IS NOT NULL);
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_official_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_official_state(uuid) TO scrbrd_app;

-- The organiser's and the director's To-resolve rows (§3, GA-I09–I11): every
-- finished match of the last 180 days the caller may confirm or settle, as
-- his policy admits it, oldest first.
--   kind confirm     he may confirm it now
--   kind blocked     he would confirm it but for blocked_by (a correction
--                    awaiting approval, a held ball, an unsealed innings, his
--                    own hand on the log — then somebody else must)
--   kind review      a dispute stands and he may clear it, or it is his
CREATE OR REPLACE FUNCTION results_to_confirm()
RETURNS TABLE (match_id uuid, starts_at timestamptz, status text, home_label text, away_label text,
               competition_id uuid, kind text, blocked_by text, window_closes_at timestamptz, disputed_at timestamptz) AS $$
  WITH mine AS (
    SELECT m.id, m.starts_at, m.status, m.competition_id,
           coalesce(fixture_side_label(m.school_id, m.team_code), m.team_code, 'Home') AS home_label,
           coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent, 'Away') AS away_label
      FROM match m
     WHERE m.status IN ('complete', 'abandoned')
       AND m.starts_at > now() - interval '180 days'
       AND app_user_id() IS NOT NULL AND NOT app_pad_scoped()
       AND result_dispute_as(m.id) IS NOT NULL),
  st AS (
    SELECT x.*, o.state, o.disputed_by, o.window_closes_at AS closes, o.disputed_at AS dat, c.ok, c.reason,
           result_confirm_as(x.id) AS conf_as
      FROM mine x
     CROSS JOIN LATERAL match_official_core(x.id) o
     CROSS JOIN LATERAL match_confirmable(x.id) c)
  SELECT s.id, s.starts_at, s.status, s.home_label, s.away_label, s.competition_id,
         CASE WHEN s.state = 'under_review' THEN 'review' WHEN s.ok THEN 'confirm' ELSE 'blocked' END,
         CASE WHEN s.state = 'provisional' AND NOT s.ok THEN s.reason END,
         CASE WHEN s.state = 'under_review' THEN s.closes END, s.dat
    FROM st s
   WHERE (s.state = 'provisional' AND s.conf_as IS NOT NULL
          AND (s.ok OR s.reason IN ('innings_unsealed', 'amendment_pending', 'ball_held', 'you_wrote_this_log')))
      OR (s.state = 'under_review'
          AND (s.disputed_by = app_user_id()
               OR CASE WHEN s.competition_id IS NOT NULL THEN result_scope_holds(s.id, 'organiser') ELSE true END))
   ORDER BY s.starts_at, s.id
   LIMIT 200
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION results_to_confirm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION results_to_confirm() TO scrbrd_app;


-- ── 9 · The reads restated (§4 S5) ─────────────────────────────────
-- The signed-out result (db/71's) gains official and official_at: the time
-- only, never who, never "under review" (Q3: a disputed result reads as not
-- official). Two columns more, last — dropped and made again, nothing depends
-- on it but the API, its grants as db/69 gave them.
DROP FUNCTION IF EXISTS public_match_result(uuid);
CREATE FUNCTION public_match_result(p_match uuid)
RETURNS TABLE (outcome text, margin_kind text, margin integer, decided_by text, winner_side text,
               play_outcome text, play_winner_side text, play_margin_kind text, play_margin integer,
               decision_applied boolean, decision_kind text, decision_side text, decision_overrides_play boolean,
               super_overs jsonb, official boolean, official_at timestamptz) AS $$
  SELECT r.outcome, r.margin_kind, r.margin, r.decided_by, r.winner_side,
         r.play_outcome, r.play_winner_side, r.play_margin_kind, r.play_margin,
         r.decision_applied, r.decision->>'kind', r.decision->>'side', (r.decision->>'overrides_play')::boolean,
         coalesce((SELECT jsonb_agg(jsonb_build_object('n', p->'n', 'state', p->'state', 'first', p->'first', 'winner', p->'winner')
                                    ORDER BY (p->>'n')::integer)
                     FROM jsonb_array_elements(r.super_overs) p), '[]'::jsonb),
         result_official_at(p_match, r.result_hash) IS NOT NULL, result_official_at(p_match, r.result_hash)
    FROM match_result_compute(p_match) r
   WHERE public_fixture_served(p_match)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_match_result(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_match_result(uuid) TO scrbrd_app;

-- The table (db/73's, line for line) gains provisional_results: how many of
-- the results the table counts are not official — complete and unconfirmed,
-- confirmed and since corrected, under review, or decided on the field and
-- never marked complete. One figure for the table, on every row, as `basis`
-- is. Nothing else moves: the points are the points (D10).
DROP VIEW IF EXISTS competition_standing;
DROP FUNCTION IF EXISTS public_competition_standing(uuid);
DROP FUNCTION IF EXISTS competition_standing_rows(uuid);
CREATE FUNCTION competition_standing_rows(p_competition uuid)
RETURNS TABLE (entrant_id uuid, division_id uuid, school_id uuid, team_code text, display_name text,
               basis text, played integer, won integer, lost integer, tied integer, drawn integer, no_result integer,
               points numeric, adjustment_points numeric, nrr numeric,
               runs_for integer, balls_for integer, runs_against integer, balls_against integer,
               rank integer, table_order jsonb, head_to_head_listed boolean, conditions_adjusted integer,
               unattested_results integer, provisional_results integer) AS $$
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
  -- db/114: the counted results that are not official.
  prov AS (
    SELECT count(*)::integer AS n FROM res r WHERE r.counted AND NOT result_is_official(r.match_id, r.result_hash)
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
         ord.o, ord.o ? 'head_to_head', x.adjusted, NULL::integer, prov.n
    FROM base x CROSS JOIN ord CROSS JOIN prov
   ORDER BY x.division_id NULLS LAST, 20, x.display_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION competition_standing_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_standing_rows(uuid) TO scrbrd_app;

-- db/69's view, made again over the new shape (s.* now ends in provisional_results).
CREATE VIEW competition_standing WITH (security_invoker = true) AS
SELECT c.id AS competition_id, s.*
  FROM competition c
 CROSS JOIN LATERAL competition_standing_rows(c.id) s;
GRANT SELECT ON competition_standing TO scrbrd_app;

-- A published competition's table (db/69's) gains the count: "includes 2
-- provisional results". Sides and figures; no reason, no boy.
CREATE FUNCTION public_competition_standing(p_competition uuid)
RETURNS TABLE (rank integer, division text, side text, played integer, won integer, lost integer, tied integer,
               drawn integer, no_result integer, points numeric, nrr numeric, basis text, provisional_results integer) AS $$
  SELECT s.rank, d.name, s.display_name, s.played, s.won, s.lost, s.tied, s.drawn, s.no_result, s.points,
         round(s.nrr, 3), s.basis, s.provisional_results
    FROM competition_standing_rows(p_competition) s
    LEFT JOIN competition_division d ON d.id = s.division_id
   WHERE competition_published(p_competition)
   ORDER BY d.rank NULLS LAST, s.rank, s.display_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public_competition_standing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_competition_standing(uuid) TO scrbrd_app;


-- ── 10 · Row-level security (§4 S6) ────────────────────────────────
-- The read is generated (tables.mjs): whoever reads the fixture at either
-- side's scope, or reaches its competition — as match_result_decision's.
-- The application has no INSERT, UPDATE or DELETE on the table, so the
-- generated write policies grant nothing; the doors above are the writers.
-- ┌── GENERATED from packages/policy/src/tables.mjs by services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09). DO NOT EDIT BY HAND; `pnpm rls:generate` rewrites it.

-- match_result_confirmation — read: fixture.read (from 2 scopes) · write: result.confirm
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE match_result_confirmation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_result_confirmation_read   ON match_result_confirmation;
DROP POLICY IF EXISTS match_result_confirmation_insert ON match_result_confirmation;
DROP POLICY IF EXISTS match_result_confirmation_update ON match_result_confirmation;
DROP POLICY IF EXISTS match_result_confirmation_delete ON match_result_confirmation;

CREATE POLICY match_result_confirmation_read ON match_result_confirmation
  FOR SELECT USING (((app_can('fixture.read', (match_school(match_result_confirmation.match_id)), (match_team(match_result_confirmation.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_result_confirmation.match_id))
    OR app_can('fixture.read', (SELECT m.away_school_id FROM match m WHERE m.id = match_result_confirmation.match_id), (SELECT m.away_team_code FROM match m WHERE m.id = match_result_confirmation.match_id), '00000000-0000-0000-0000-000000000000'::uuid, match_result_confirmation.match_id))
    OR (competition_visible(match_competition_of(match_result_confirmation.match_id))));

CREATE POLICY match_result_confirmation_insert ON match_result_confirmation
  FOR INSERT WITH CHECK (app_can('result.confirm', (match_school(match_result_confirmation.match_id)), (match_team(match_result_confirmation.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_result_confirmation.match_id));

CREATE POLICY match_result_confirmation_update ON match_result_confirmation
  FOR UPDATE USING (app_can('result.confirm', (match_school(match_result_confirmation.match_id)), (match_team(match_result_confirmation.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_result_confirmation.match_id))
           WITH CHECK (app_can('result.confirm', (match_school(match_result_confirmation.match_id)), (match_team(match_result_confirmation.match_id)), '00000000-0000-0000-0000-000000000000'::uuid, match_result_confirmation.match_id));

-- └── END GENERATED

-- What the application may read of a row: the revision, the time, the role
-- word, the window and the lapse. Never who confirmed, disputed, cleared or
-- withdrew, never a note, never the dispute's stamp: those reach a reader
-- through match_official_state(), which says them to whom D11 allows. A
-- column the application cannot select cannot leak through a careless query.
REVOKE ALL ON match_result_confirmation FROM scrbrd_app;
GRANT SELECT (id, match_id, head_seq, result_hash, decision_id, confirmed_at, confirmed_as, window_closes_at,
              lapsed_at, lapsed_seq, lapsed_reason, withdrawn_at)
   ON match_result_confirmation TO scrbrd_app;

-- A pad's resume credential reaches none of it (db/50).
SELECT pad_scope_guard_install('match_result_confirmation'::regclass) AS pad_guards;


-- ── 11 · A managed host's API roles reach none of it ───────────────
DO $managed$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON match_result_confirmation, competition_standing FROM %I', r);
      FOREACH f IN ARRAY ARRAY[
          'match_result_confirmation_guard()', 'match_head_seq(uuid)', 'match_verified(uuid)', 'match_seals_stand(uuid)',
          'result_confirmer_of(uuid)', 'result_dispute_days(uuid)', 'result_confirm_platform()',
          'result_scope_holds(uuid,text)', 'result_confirm_as(uuid)', 'result_dispute_as(uuid)', 'result_staff(uuid)',
          'result_hand_on_log(uuid,uuid)', 'result_official_at(uuid,text)', 'result_is_official(uuid,text)',
          'result_confirm_blocker(uuid)', 'match_official_core(uuid)', 'result_official_notices(uuid,text,timestamptz)', 'result_official_unsay(uuid[])',
          'result_lapse(uuid,text)', 'match_result_confirmation_lapse_events()', 'match_result_confirmation_lapse_decision()',
          'match_result_confirmation_lapse_status()', 'match_confirmable(uuid)', 'match_result_confirm(uuid)',
          'match_result_dispute(uuid,text)', 'match_result_dispute_clear(uuid,text)',
          'match_result_confirmation_withdraw(uuid,text)', 'match_official_state(uuid)', 'results_to_confirm()',
          'public_match_result(uuid)', 'competition_standing_rows(uuid)', 'public_competition_standing(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $managed$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  n integer;
  src text;
BEGIN
  -- The capability: four holders, and nobody else.
  SELECT count(*) INTO n FROM role_capability WHERE capability = 'result.confirm'
     AND role IN ('superadmin', 'directorofsport', 'principal', 'competitionadmin');
  IF n <> 4 OR (SELECT count(*) FROM role_capability WHERE capability = 'result.confirm') <> 4 THEN
    RAISE EXCEPTION 'db/114: result.confirm is held by % of its four roles, or by others', n;
  END IF;
  -- D5's role half: nobody who files a correction confirms one.
  IF EXISTS (SELECT 1 FROM role_capability a JOIN role_capability b ON b.role = a.role
              WHERE a.capability = 'result.confirm' AND b.capability = 'scoring.amend.request' AND a.role <> 'superadmin') THEN
    RAISE EXCEPTION 'db/114: a role holds both result.confirm and scoring.amend.request';
  END IF;
  IF (SELECT count(*) FROM playing_condition_key
       WHERE (key = 'results.confirmed_by' AND part = 'table' AND value_type = 'enum'
              AND enum_values = '{organiser,home_school,either_school}' AND platform_default IS NULL)
          OR (key = 'results.dispute_days' AND part = 'table' AND value_type = 'int' AND platform_default IS NULL)) <> 2 THEN
    RAISE EXCEPTION 'db/114: the two condition keys are missing or not as written';
  END IF;

  -- The table: row security on, one standing row per match, the guard.
  IF to_regclass('match_result_confirmation') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'match_result_confirmation'::regclass) THEN
    RAISE EXCEPTION 'db/114: match_result_confirmation is missing, or row security is off';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('match_result_confirmation_standing')
                    AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION 'db/114: match_result_confirmation_standing is not a partial unique index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'match_result_confirmation'::regclass
                    AND tgname = 'match_result_confirmation_guard' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/114: the confirmation''s guard is missing or disabled';
  END IF;
  IF has_table_privilege('scrbrd_app', 'match_result_confirmation', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'match_result_confirmation', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'match_result_confirmation', 'DELETE')
     OR has_column_privilege('scrbrd_app', 'match_result_confirmation', 'dispute_note', 'SELECT')
     OR has_column_privilege('scrbrd_app', 'match_result_confirmation', 'confirmed_by', 'SELECT')
     OR has_column_privilege('scrbrd_app', 'match_result_confirmation', 'disputed_at', 'SELECT')
     OR has_column_privilege('scrbrd_app', 'match_result_confirmation', 'withdrawn_note', 'SELECT')
     OR NOT has_column_privilege('scrbrd_app', 'match_result_confirmation', 'head_seq', 'SELECT') THEN
    RAISE EXCEPTION 'db/114: the application may write the confirmation, or read a person or a note on it';
  END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'match_result_confirmation'
     AND permissive = 'PERMISSIVE' AND cmd = 'SELECT' AND qual LIKE '%fixture.read%' AND qual LIKE '%competition_visible%';
  IF n <> 1 THEN RAISE EXCEPTION 'db/114: the confirmation has % generated read policies, not one', n; END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'match_result_confirmation' AND permissive = 'RESTRICTIVE' AND policyname LIKE 'pad\_scope\_%';
  IF n < 1 THEN RAISE EXCEPTION 'db/114: the pad''s guards are missing on the confirmation (db/50)'; END IF;

  -- The three lapse triggers, and the public one.
  IF (SELECT count(*) FROM pg_trigger g WHERE NOT g.tgisinternal AND g.tgname = 'match_result_confirmation_lapse'
        AND g.tgenabled = 'O'
        AND ((g.tgrelid = 'ball_event'::regclass AND g.tgfoid = 'match_result_confirmation_lapse_events()'::regprocedure)
          OR (g.tgrelid = 'match_result_decision'::regclass AND g.tgfoid = 'match_result_confirmation_lapse_decision()'::regprocedure)
          OR (g.tgrelid = 'match'::regclass AND g.tgfoid = 'match_result_confirmation_lapse_status()'::regprocedure))) <> 3 THEN
    RAISE EXCEPTION 'db/114: the three lapse triggers are not all in place';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = 'match_result_confirmation'::regclass
                    AND g.tgname = 'public_data_changed' AND g.tgfoid = 'public_data_notify()'::regprocedure) THEN
    RAISE EXCEPTION 'db/114: the confirmation does not drop the public page''s entry';
  END IF;

  -- The doors: pinned definers, the application's alone.
  FOREACH f IN ARRAY ARRAY['match_confirmable(uuid)', 'match_result_confirm(uuid)', 'match_result_dispute(uuid,text)',
                           'match_result_dispute_clear(uuid,text)', 'match_result_confirmation_withdraw(uuid,text)',
                           'match_official_state(uuid)', 'results_to_confirm()', 'public_match_result(uuid)',
                           'competition_standing_rows(uuid)', 'public_competition_standing(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(f) AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/114: % is not a SECURITY DEFINER with a pinned path', f;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', to_regprocedure(f), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = to_regprocedure(f) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/114: % is not the application''s alone', f;
    END IF;
  END LOOP;
  -- The system's own: pinned definers nobody may call.
  FOREACH f IN ARRAY ARRAY['match_head_seq(uuid)', 'match_verified(uuid)', 'match_seals_stand(uuid)',
                           'result_confirmer_of(uuid)', 'result_dispute_days(uuid)', 'result_confirm_platform()',
                           'result_scope_holds(uuid,text)', 'result_confirm_as(uuid)', 'result_dispute_as(uuid)',
                           'result_staff(uuid)', 'result_hand_on_log(uuid,uuid)', 'result_official_at(uuid,text)',
                           'result_is_official(uuid,text)',
                           'result_confirm_blocker(uuid)', 'match_official_core(uuid)',
                           'result_official_notices(uuid,text,timestamptz)', 'result_official_unsay(uuid[])',
                           'result_lapse(uuid,text)', 'match_result_confirmation_lapse_events()',
                           'match_result_confirmation_lapse_decision()', 'match_result_confirmation_lapse_status()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(f) AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/114: % is not a SECURITY DEFINER with a pinned path', f;
    END IF;
    IF has_function_privilege('public', to_regprocedure(f), 'EXECUTE')
       OR has_function_privilege('scrbrd_app', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/114: % is executable by PUBLIC or by scrbrd_app', f;
    END IF;
  END LOOP;
  IF has_function_privilege('scrbrd_app', 'match_result_confirmation_guard()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/114: the application can call the confirmation''s guard';
  END IF;

  -- D5 and the order of D6: the row check is asked in the door, last.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'match_confirmable(uuid)'::regprocedure;
  IF position('result_confirm_as(p_match)' IN src) = 0 OR position('result_hand_on_log(p_match, app_user_id())' IN src) = 0
     OR position('''you_wrote_this_log''' IN src) = 0
     OR position('result_confirm_as(p_match)' IN src) > position('result_confirm_blocker(p_match)' IN src) THEN
    RAISE EXCEPTION 'db/114: match_confirmable() does not ask the capability first and the hand on the log';
  END IF;
  -- The public read never says "under review" and names nobody.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'public_match_result(uuid)'::regprocedure;
  IF position('result_official_at(p_match, r.result_hash)' IN src) = 0 OR position('confirmed_by' IN src) > 0
     OR position('dispute' IN src) > 0 THEN
    RAISE EXCEPTION 'db/114: public_match_result() does not read official as the state alone';
  END IF;
  IF position('provisional_results' IN pg_get_function_result('public_competition_standing(uuid)'::regprocedure)) = 0
     OR position('provisional_results' IN pg_get_function_result('competition_standing_rows(uuid)'::regprocedure)) = 0
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'competition_standing'
                       AND column_name = 'provisional_results') THEN
    RAISE EXCEPTION 'db/114: the table does not carry provisional_results';
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_class c WHERE c.oid = 'competition_standing'::regclass), false)
     OR NOT has_table_privilege('scrbrd_app', 'competition_standing', 'SELECT') THEN
    RAISE EXCEPTION 'db/114: competition_standing runs as its owner, or the application lost it';
  END IF;
  -- The lapse retracts through db/89's door and says the one word.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'result_official_unsay(uuid[])'::regprocedure;
  IF position('notification_retract(v, ''superseded'', false)' IN src) = 0 THEN
    RAISE EXCEPTION 'db/114: the official notice is not retracted superseded through notification_retract()';
  END IF;
END $check$;
