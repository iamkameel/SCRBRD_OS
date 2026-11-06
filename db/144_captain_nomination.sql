-- ══════════════════════════════════════════════════════════════════
--  144 · Player of the Match, the captain's nomination (RECOGNITION R7)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/RECOGNITION_design.md, approved by Kameel on
-- 7 Oct 2026 as recommended (D1–D25, Q1–Q12); "start it, dont be shy"
-- (Kameel, 6 Nov 2026). This is §10's R7 row: D14–D18 as §4 —
-- `recognition_nomination` in D15's shape (no rationale for a captain),
-- `is_captain_of()` (SCRBRD-138 §1.2's five tests, phase C), D16's nine
-- gate tests, and RLS per D8. It stands on db/142 (R6, the coach's path):
-- the coach decides a nomination through R6's match_award(), and the side's
-- notice and the recognition audit are R6's. Its proof is db/99 §122; the
-- walks are smoke-recognition (the API) and smoke-browser-potm (the screens).
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   table      + recognition_nomination  D15: kind (player_of_match, and
--                colours | half_colours ready for R8 with no table change),
--                match_id, season_id, school_id, team_code, the nominee, the
--                nominator (a pupil's player row, or for R8 a coach's
--                account), nominated_as (captain | vice_captain: what the
--                honour made him on the day), derived_from (the suggestions
--                he was shown, each with figures, and the log's head),
--                status (open | confirmed | superseded | no_award | lapsed),
--                closes_at, decided_by, decided_at, honour_id. NO rationale
--                and no other free text (SG-9: a structured write is not a
--                channel). Kept for ever: no DELETE, and a decided row is
--                never edited (recognition_nomination_guard).
--                + one open nomination a side a match (D16's ninth test)
--                RLS (D8): read by the pupil it names as nominator, as
--                himself; by the side's coach, assistant coach and team
--                manager; and by the school's deciders and its office
--                (recognition.match.award / recognition.manage holders at
--                the school). RESTRICTIVE: never a platform-wide
--                assignment (D7), never a support session, never a pad.
--                The application writes no row: SELECT is its only grant;
--                the doors below write.
--   honour     + nomination_id  D18: the nomination an award answered; set
--                by honour_tie_nomination() alone, never edited
--   recognition_audit (db/142)  honour_id may be NULL for a nomination's
--                row; + nomination_id; + five events: nominated,
--                nomination_confirmed, nomination_superseded,
--                nomination_no_award, nomination_lapsed
--   ~ audit_log() (db/142's)  the five events in words, patched in place
--                (db/142's exact-needle pattern). Never the nominee's
--                figures, never anything a captain typed (he types nothing).
--   functions  + is_captain_of(player, team, season)  SCRBRD-138 §1.2
--              + captaincy_holds, potm_nominators, potm_window_opens,
--                recognition_self_players, potm_side_coach_name,
--                recognition_nomination_lapse, the triggers' functions
--                (nobody's to call)
--              + recognition_nomination_mine, recognition_nomination_staff
--                (the read policy's two tests: scrbrd_app executes them, as
--                it does app_can(); each answers only about the caller)
--              + captain_nomination_state, captain_nominate,
--                match_nomination_state, match_nomination_decide,
--                nominations_to_decide (the doors: scrbrd_app only)
--   triggers   + honour_tie_nomination  BEFORE INSERT OR UPDATE OF
--                nomination_id: a Player of the Match awarded while the
--                side's nomination is open answers it (whichever door the
--                coach used); never by the nominee's guardian or the
--                nominator; the tie is never edited
--              + honour_close_nomination  AFTER INSERT: the nomination
--                becomes confirmed (the nominee was chosen) or superseded
--              + recognition_nomination_guard, recognition_nomination_audit
--
-- ── WHO NOMINATES (D14, D16) ────────────────────────────────────────
-- A pupil as himself: the player row a live, school-verified `selfaccess`
-- link of his names (assignment_subject, relationship 'self'), never a pad's
-- credential, never a support hour. He must hold the season's captaincy of
-- the side (is_captain_of(): kind captain or vice_captain, live, the
-- fixture's school season, the honour's side his side today and the match's
-- side, his school) and be on the match's confirmed sheet; the captain on
-- the sheet nominates, and the vice-captain only when no captain is on it.
-- Neither on it: no nomination, and the coach decides alone (R6). He picks
-- one boy from his own side's sheet, never himself, once the match is
-- verified (match_verified(), R3) and no award stands, within 48 hours of
-- the match becoming verified (Q6), and only while no other nomination of
-- the side is open. The figures he is shown are the coach's suggestions
-- (R1, D17); the row he writes holds ids and figures and no words of his.
--
-- ── WHO DECIDES (D9, D10, D18) ──────────────────────────────────────
-- R6's deciders (recognition.match.award over the side). Confirm or Choose
-- another is R6's match_award(); honour_tie_nomination() ties the award to
-- the open nomination and honour_close_nomination() sets its status. No
-- award sets it here. Row checks, beyond R6's: the decider is not the
-- nominator (D9), and is not a guardian of the nominee (D10: deciding a
-- son's nomination either way is deciding his award) — he is told who
-- decides instead, as R6 says it. An open nomination lapses when its window
-- closes; the lapse is written by the next door that looks (no schedule).
--
-- ── WHAT IS SAID ────────────────────────────────────────────────────
-- Nothing new. The award's own notice is R6's, to the side (D18): the
-- captain learns the outcome as his team-mates do. No notice is written to
-- the captain, the nominee or the coach about a nomination: the coach's
-- staff sheet and To-resolve row read it (D18, A22), the captain's tab reads
-- his own row.
--
-- EXISTING ROWS. None change. recognition_audit's honour_id loses NOT NULL;
-- its CHECK is re-made with the five events. Safe to run twice. DROPs: the
-- recognition_audit event CHECK (made again, wider), DROP POLICY IF EXISTS
-- before each policy this file creates, the pg_temp helpers at the end.
--
-- SCHEMA FIRST. The API built with it (potm-api.mjs) calls the five doors;
-- this file goes before it and is in services/api/expected-migrations.json.
--
-- THE GUARD keys on pg_proc.prosrc as db/142 does: the md5 of the live
-- audit_log() body, whitespace folded, must be db/142's or this file's.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v144_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('recognition_audit') IS NULL OR to_regclass('honour') IS NULL OR to_regclass('match_squad') IS NULL
     OR to_regprocedure('match_award(uuid,uuid,jsonb)') IS NULL OR to_regprocedure('match_award_holds(uuid,text,uuid)') IS NULL
     OR to_regprocedure('match_award_side_of(uuid,uuid)') IS NULL OR to_regprocedure('match_award_guardian_of(uuid,uuid)') IS NULL
     OR to_regprocedure('match_award_instead(uuid,uuid)') IS NULL OR to_regprocedure('match_award_short(text)') IS NULL
     OR to_regprocedure('match_award_heading(uuid,text)') IS NULL OR to_regprocedure('match_award_opponent(uuid,text)') IS NULL
     OR to_regprocedure('match_verified(uuid)') IS NULL OR to_regprocedure('match_head_seq(uuid)') IS NULL
     OR to_regprocedure('match_result_compute(uuid)') IS NULL OR to_regprocedure('pad_scope_guard_install(regclass)') IS NULL
     OR to_regprocedure('app_is_platform_wide()') IS NULL OR to_regprocedure('app_support_access_id(uuid)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL OR to_regprocedure('sa_today()') IS NULL THEN
    RAISE EXCEPTION 'db/144: Player of the Match, the coach''s path (db/142), the official result (db/114) or the pad guard (db/50) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                                         '5e47b7126f7d31e45a3407cbebbb33a2', 'b1ae191ba7ddb1e122d1bf849883f6a7', 'db/142'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/144: % (%) is not there to patch', r.fn, r.src;
    END IF;
    v_md5 := pg_temp._v144_fold(v_src);
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/144: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;

-- db/142's patcher: `needle` must stand in the body exactly `times` times.
CREATE OR REPLACE FUNCTION pg_temp._v144_patch(p_fn text, p_needle text, p_repl text, p_times integer) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> p_times THEN
    RAISE EXCEPTION 'db/144: % holds its needle % times, not %: look before replacing it', p_fn, v_n, p_times;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════════
--  1 · The nomination (D15)
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS recognition_nomination (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL CHECK (kind IN ('player_of_match', 'colours', 'half_colours')),
  match_id               uuid REFERENCES match(id),
  season_id              uuid NOT NULL REFERENCES season(id),
  school_id              uuid NOT NULL REFERENCES school(id),
  team_code              text NOT NULL,
  nominee_player_id      uuid NOT NULL REFERENCES player(id),
  -- A captain's pick names his player row; R8's coach names his account.
  nominated_by_player_id uuid REFERENCES player(id),
  nominated_by_user_id   uuid REFERENCES app_user(id),
  nominated_as           text CHECK (nominated_as IN ('captain', 'vice_captain')),
  -- The suggestions he was shown, each boy with his figures, the nominee's
  -- figures and the log's head: ids and figures, never words of his.
  derived_from           jsonb,
  status                 text NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open', 'confirmed', 'superseded', 'no_award', 'lapsed')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  closes_at              timestamptz,
  decided_by             uuid REFERENCES app_user(id),
  decided_at             timestamptz,
  honour_id              uuid REFERENCES honour(id),
  -- A captain's Player of the Match: a match, a pupil nominator, his
  -- captaincy, the working, a window. Colours (R8) say their own shape then.
  CONSTRAINT recognition_nomination_potm_shape CHECK (
    kind <> 'player_of_match'
    OR (match_id IS NOT NULL AND nominated_by_player_id IS NOT NULL AND nominated_by_user_id IS NULL
        AND nominated_as IS NOT NULL AND jsonb_typeof(derived_from) = 'object' AND closes_at IS NOT NULL)),
  CONSTRAINT recognition_nomination_not_self CHECK (nominee_player_id IS DISTINCT FROM nominated_by_player_id),
  -- open: nobody has decided; the rest name the decision and when it fell
  -- (a lapse has a time and no decider).
  CONSTRAINT recognition_nomination_decided CHECK (
    CASE status
      WHEN 'open'   THEN decided_at IS NULL AND decided_by IS NULL AND honour_id IS NULL
      WHEN 'lapsed' THEN decided_at IS NOT NULL AND decided_by IS NULL AND honour_id IS NULL
      WHEN 'no_award' THEN decided_at IS NOT NULL AND decided_by IS NOT NULL AND honour_id IS NULL
      ELSE decided_at IS NOT NULL AND decided_by IS NOT NULL AND honour_id IS NOT NULL END)
);
COMMENT ON TABLE recognition_nomination IS
  'db/144 (RECOGNITION R7, D15): a captain''s Player of the Match pick (and R8''s Colours nominations). No free text. Read by its nominator and the side''s staff (D8); written only by the doors; kept for ever.';

-- D16's ninth test: one open nomination a side a match.
CREATE UNIQUE INDEX IF NOT EXISTS recognition_nomination_open_once ON recognition_nomination (match_id, school_id, team_code)
  WHERE kind = 'player_of_match' AND status = 'open';
CREATE INDEX IF NOT EXISTS recognition_nomination_open ON recognition_nomination (closes_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS recognition_nomination_match ON recognition_nomination (match_id, school_id, team_code);

-- D18: the award names the nomination it answered.
ALTER TABLE honour ADD COLUMN IF NOT EXISTS nomination_id uuid REFERENCES recognition_nomination(id);
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'honour'::regclass AND conname = 'honour_nomination_is_a_match_award') THEN
    ALTER TABLE honour ADD CONSTRAINT honour_nomination_is_a_match_award
      CHECK (nomination_id IS NULL OR kind = 'player_of_match');
  END IF;
END $constraints$;

-- A nomination is decided once and never edited after; never deleted.
CREATE OR REPLACE FUNCTION recognition_nomination_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a nomination is kept' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'a decided nomination is not edited' USING ERRCODE = 'check_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'decided_by', 'decided_at', 'honour_id'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'decided_by', 'decided_at', 'honour_id']) THEN
    RAISE EXCEPTION 'a nomination is decided, not edited' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER recognition_nomination_guard BEFORE UPDATE OR DELETE ON recognition_nomination
  FOR EACH ROW EXECUTE FUNCTION recognition_nomination_guard();


-- ══════════════════════════════════════════════════════════════════
--  2 · Who the captain is (D14; SCRBRD-138 §1.2, phase C)
-- ══════════════════════════════════════════════════════════════════
-- 138 §1.2's five tests for one kind: the kind; live; the season; the
-- honour's side is the side asked about AND his side today ("an honour does
-- not move sides when he does"); the honour's school is his.
CREATE OR REPLACE FUNCTION captaincy_holds(p_player uuid, p_team text, p_season uuid, p_kind text) RETURNS boolean AS $$
  SELECT p_kind IN ('captain', 'vice_captain') AND EXISTS (
    SELECT 1 FROM honour h JOIN player p ON p.id = h.player_id
     WHERE h.player_id = p_player
       AND h.kind = p_kind
       AND h.withdrawn_at IS NULL
       AND h.season_id = p_season
       AND h.team_code = p_team AND p.team_code = p_team
       AND h.school_id = p.school_id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The captain or the vice-captain of the side for the season (138 D1).
CREATE OR REPLACE FUNCTION is_captain_of(p_player uuid, p_team text, p_season uuid) RETURNS boolean AS $$
  SELECT captaincy_holds(p_player, p_team, p_season, 'captain') OR captaincy_holds(p_player, p_team, p_season, 'vice_captain')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The fixture's school season, as R6 dates an award.
CREATE OR REPLACE FUNCTION potm_season_of(p_match uuid) RETURNS uuid AS $$
  SELECT (SELECT f.id FROM season_for((m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date, 'school') f)
    FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- D14: who may nominate for one side of one match. The captain on the
-- confirmed sheet; else the vice-captain on it; else nobody. A boy of that
-- side's school only (the sheet's side is the match's, his school is his).
CREATE OR REPLACE FUNCTION potm_nominators(p_match uuid, p_side text) RETURNS TABLE (player_id uuid, nominated_as text) AS $$
  WITH s AS (
    SELECT CASE p_side WHEN 'home' THEN m.school_id ELSE m.away_school_id END AS school,
           CASE p_side WHEN 'home' THEN m.team_code ELSE m.away_team_code END AS team,
           potm_season_of(m.id) AS season
      FROM match m WHERE m.id = p_match AND p_side IN ('home', 'away')),
  sheet AS (
    SELECT q.player_id, s.team, s.season FROM match_squad q JOIN player p ON p.id = q.player_id, s
     WHERE q.match_id = p_match AND q.side = p_side AND NOT q.withdrawn AND p.school_id = s.school),
  c AS (SELECT sheet.player_id, 'captain'::text AS nominated_as FROM sheet WHERE captaincy_holds(sheet.player_id, sheet.team, sheet.season, 'captain')),
  v AS (SELECT sheet.player_id, 'vice_captain'::text FROM sheet WHERE captaincy_holds(sheet.player_id, sheet.team, sheet.season, 'vice_captain'))
  SELECT * FROM c
  UNION ALL
  SELECT * FROM v WHERE NOT EXISTS (SELECT 1 FROM c)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The players the caller answers for as himself: his live selfaccess links
-- that name him, verified by the school. Never under a pad credential or a
-- support hour. (D16's first test: through assignment_subject, not the
-- account's own player_id, which no school verified.)
CREATE OR REPLACE FUNCTION recognition_self_players() RETURNS uuid[] AS $$
  SELECT CASE WHEN app_user_id() IS NULL OR app_pad_scoped() OR app_support_access_id() IS NOT NULL THEN '{}'::uuid[]
    ELSE coalesce((SELECT array_agg(DISTINCT g.player_id ORDER BY g.player_id)
                     FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
                    WHERE a.person_id = app_user_id() AND a.role = 'selfaccess' AND a.active
                      AND g.relationship = 'self' AND g.verification_state = 'verified'
                      AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
                      AND (a.valid_until IS NULL OR a.valid_until > sa_today())
                      AND (a.expires_at IS NULL OR a.expires_at > now())
                      AND (g.valid_from IS NULL OR g.valid_from <= sa_today())
                      AND (g.valid_until IS NULL OR g.valid_until > sa_today())
                      AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)),
                  '{}'::uuid[]) END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Is this person the boy? His account, or a live self link of his naming
-- him (verified or not: the refusing side). D9's "decider is not the
-- nominator".
CREATE OR REPLACE FUNCTION potm_is_the_boy(p_person uuid, p_player uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id = p_player)
      OR EXISTS (SELECT 1 FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
                  WHERE a.person_id = p_person AND a.active AND g.player_id = p_player AND g.relationship = 'self'
                    AND (g.valid_until IS NULL OR g.valid_until > sa_today()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Q6: the window opens when the match became verified — the log's last
-- word (the seal) or the finishing of the match (db/130), whichever came
-- later — and closes 48 hours on.
CREATE OR REPLACE FUNCTION potm_window_opens(p_match uuid) RETURNS timestamptz AS $$
  SELECT greatest((SELECT max(b.server_ts) FROM ball_event b WHERE b.match_id = p_match),
                  (SELECT max(s.at) FROM scoring_audit s WHERE s.match_id = p_match AND s.event = 'match_finalised'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- "Mr Dlamini decides": the side's coach, by name; NULL when it has none.
CREATE OR REPLACE FUNCTION potm_side_coach_name(p_school uuid, p_team text) RETURNS text AS $$
  SELECT u.name FROM role_assignment a JOIN app_user u ON u.id = a.person_id
   WHERE a.role = 'coach' AND a.active AND a.school_id = p_school AND a.team_code = p_team AND a.fixture_id IS NULL
     AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
     AND (a.valid_until IS NULL OR a.valid_until > sa_today())
     AND (a.expires_at IS NULL OR a.expires_at > now())
   ORDER BY a.created_at, u.name LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- An open nomination whose window has closed lapses: written by the next
-- door that looks, for one match or (NULL) for all.
CREATE OR REPLACE FUNCTION recognition_nomination_lapse(p_match uuid) RETURNS integer AS $$
DECLARE n integer;
BEGIN
  UPDATE recognition_nomination SET status = 'lapsed', decided_at = closes_at
   WHERE status = 'open' AND closes_at <= now() AND (p_match IS NULL OR match_id = p_match);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  3 · Who reads a nomination (D8, D7)
-- ══════════════════════════════════════════════════════════════════
-- The nominator, as himself.
CREATE OR REPLACE FUNCTION recognition_nomination_mine(p_nominator uuid) RETURNS boolean AS $$
  SELECT p_nominator IS NOT NULL AND p_nominator = ANY (recognition_self_players())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The side's staff: its coach, assistant coach and team manager, and the
-- school's deciders and office (recognition.match.award or
-- recognition.manage), through an assignment AT the school — never a
-- platform-wide one — as himself, never a pad or a support hour.
CREATE OR REPLACE FUNCTION recognition_nomination_staff(p_school uuid, p_team text, p_match uuid) RETURNS boolean AS $$
  SELECT p_school IS NOT NULL AND app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND app_support_access_id() IS NULL
     AND EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = app_user_id() AND a.active AND a.school_id = p_school
                    AND (a.team_code IS NULL OR a.team_code = p_team)
                    AND (a.fixture_id IS NULL OR a.fixture_id = p_match)
                    AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
                    AND (a.valid_until IS NULL OR a.valid_until > sa_today())
                    AND (a.expires_at IS NULL OR a.expires_at > now())
                    AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
                    AND (a.role IN ('coach', 'assistantcoach', 'teammanager')
                         OR EXISTS (SELECT 1 FROM role_capability rc WHERE rc.role = a.role
                                       AND rc.capability IN ('recognition.match.award', 'recognition.manage'))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

ALTER TABLE recognition_nomination ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recognition_nomination FROM PUBLIC;
REVOKE ALL ON recognition_nomination FROM scrbrd_app;
GRANT SELECT ON recognition_nomination TO scrbrd_app;
DROP POLICY IF EXISTS recognition_nomination_read ON recognition_nomination;
CREATE POLICY recognition_nomination_read ON recognition_nomination FOR SELECT
  USING (recognition_nomination_mine(nominated_by_player_id) OR recognition_nomination_staff(school_id, team_code, match_id));
DROP POLICY IF EXISTS recognition_nomination_not_platform ON recognition_nomination;
CREATE POLICY recognition_nomination_not_platform ON recognition_nomination AS RESTRICTIVE FOR SELECT
  USING (NOT app_is_platform_wide());
DROP POLICY IF EXISTS recognition_nomination_no_support ON recognition_nomination;
CREATE POLICY recognition_nomination_no_support ON recognition_nomination AS RESTRICTIVE FOR SELECT
  USING (app_support_access_id(school_id) IS NULL);
SELECT pad_scope_guard_install('recognition_nomination'::regclass);


-- ══════════════════════════════════════════════════════════════════
--  4 · On the recognition audit (D15: "in the recognition audit (R6)")
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE recognition_audit ALTER COLUMN honour_id DROP NOT NULL;
ALTER TABLE recognition_audit ADD COLUMN IF NOT EXISTS nomination_id uuid REFERENCES recognition_nomination(id);
ALTER TABLE recognition_audit DROP CONSTRAINT IF EXISTS recognition_audit_event_check;
ALTER TABLE recognition_audit ADD CONSTRAINT recognition_audit_event_check
  CHECK (event IN ('awarded', 'withdrawn', 'made_public', 'made_private',
                   'nominated', 'nomination_confirmed', 'nomination_superseded', 'nomination_no_award', 'nomination_lapsed'));
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'recognition_audit'::regclass AND conname = 'recognition_audit_about_something') THEN
    ALTER TABLE recognition_audit ADD CONSTRAINT recognition_audit_about_something
      CHECK (honour_id IS NOT NULL OR nomination_id IS NOT NULL);
  END IF;
END $constraints$;

-- The nomination made (its actor the pupil's account), and its decision
-- (its decider; a lapse has none). The nominee is the row's player.
CREATE OR REPLACE FUNCTION recognition_nomination_audit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO recognition_audit (event, honour_id, nomination_id, school_id, team_code, player_id, match_id, kind, actor_id, detail)
    VALUES ('nominated', NULL, NEW.id, NEW.school_id, NEW.team_code, NEW.nominee_player_id, NEW.match_id, NEW.kind,
            app_user_id(), jsonb_build_object('nominatedAs', NEW.nominated_as));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO recognition_audit (event, honour_id, nomination_id, school_id, team_code, player_id, match_id, kind, actor_id, detail)
    VALUES ('nomination_' || NEW.status, NEW.honour_id, NEW.id, NEW.school_id, NEW.team_code, NEW.nominee_player_id, NEW.match_id,
            NEW.kind, NEW.decided_by, jsonb_build_object('nominatedAs', NEW.nominated_as));
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER recognition_nomination_audit AFTER INSERT OR UPDATE OF status ON recognition_nomination
  FOR EACH ROW EXECUTE FUNCTION recognition_nomination_audit();

-- audit_log() (db/142's), with the five events (marked db/144).
SELECT pg_temp._v144_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
$n$WHEN 'made_public' THEN 'Put an honour on the public board: '$n$,
$r$WHEN 'nominated' THEN 'Nominated for ' || honour_kind_label(rx.kind, NULL)
                                       || CASE WHEN rx.detail->>'nominatedAs' = 'vice_captain' THEN ' (the vice-captain''s pick)'
                                               ELSE ' (the captain''s pick)' END   -- db/144
                 WHEN 'nomination_confirmed'  THEN 'Confirmed the captain''s nomination for ' || honour_kind_label(rx.kind, NULL)
                 WHEN 'nomination_superseded' THEN 'Chose another boy than the captain''s nomination for ' || honour_kind_label(rx.kind, NULL)
                 WHEN 'nomination_no_award'   THEN 'Recorded no award on the captain''s nomination for ' || honour_kind_label(rx.kind, NULL)
                 WHEN 'nomination_lapsed'     THEN 'The captain''s nomination for ' || honour_kind_label(rx.kind, NULL) || ' lapsed undecided'
                 WHEN 'made_public' THEN 'Put an honour on the public board: '$r$, 1);


-- ══════════════════════════════════════════════════════════════════
--  5 · An award answers the open nomination (D18)
-- ══════════════════════════════════════════════════════════════════
-- After honour_stamp and honour_tell_side (BEFORE triggers fire by name),
-- so the side's school and code are the stamp's. Whichever door wrote the
-- award, a side's open nomination in its window is answered by it: not by
-- the nominee's guardian (D10), not by the nominator (D9). The tie is the
-- system's: never the caller's, never edited.
CREATE OR REPLACE FUNCTION honour_tie_nomination() RETURNS trigger AS $$
DECLARE n recognition_nomination%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.nomination_id IS DISTINCT FROM OLD.nomination_id THEN
      RAISE EXCEPTION 'an award''s nomination is not edited' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  NEW.nomination_id := NULL;
  IF NEW.kind <> 'player_of_match' THEN RETURN NEW; END IF;
  SELECT * INTO n FROM recognition_nomination x
   WHERE x.kind = 'player_of_match' AND x.match_id = NEW.match_id AND x.school_id = NEW.school_id
     AND x.team_code = NEW.team_code AND x.status = 'open' AND x.closes_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF match_award_guardian_of(app_user_id(), n.nominee_player_id) THEN
    RAISE EXCEPTION 'nomination_guardian_conflict' USING ERRCODE = 'check_violation',
      DETAIL = match_award_instead(app_user_id(), n.school_id);
  END IF;
  IF potm_is_the_boy(app_user_id(), n.nominated_by_player_id) THEN
    RAISE EXCEPTION 'decider_is_nominator' USING ERRCODE = 'check_violation';
  END IF;
  NEW.nomination_id := n.id;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER honour_tie_nomination BEFORE INSERT OR UPDATE OF nomination_id ON honour
  FOR EACH ROW EXECUTE FUNCTION honour_tie_nomination();

CREATE OR REPLACE FUNCTION honour_close_nomination() RETURNS trigger AS $$
BEGIN
  UPDATE recognition_nomination
     SET status = CASE WHEN nominee_player_id = NEW.player_id THEN 'confirmed' ELSE 'superseded' END,
         decided_by = NEW.decided_by, decided_at = now(), honour_id = NEW.id
   WHERE id = NEW.nomination_id AND status = 'open';
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER honour_close_nomination AFTER INSERT ON honour
  FOR EACH ROW WHEN (NEW.nomination_id IS NOT NULL) EXECUTE FUNCTION honour_close_nomination();


-- ══════════════════════════════════════════════════════════════════
--  6 · The doors
-- ══════════════════════════════════════════════════════════════════
-- The captain's tab (D17): one row for each side of the match the caller
-- captains this season (or once nominated for), with whether he may
-- nominate now and why not, the side's sheet without him (only while he
-- may), and his own nomination with its state and the award that answered
-- it. Nothing for anybody else; never the other side's sheet.
--   refusal: not_on_sheet · captain_on_sheet · not_verified · already_awarded
--            · window_closed · already_nominated · already_decided · no_season
CREATE OR REPLACE FUNCTION captain_nomination_state(p_match uuid)
RETURNS TABLE (side text, school_id uuid, team_code text, heading text, nominated_as text, coach_name text,
               may_nominate boolean, refusal text, closes_at timestamptz, head_seq integer, sheet jsonb,
               nomination_id uuid, nominee_id uuid, nominee_name text, status text, nominated_at timestamptz,
               decided_at timestamptz, award_player_id uuid, award_name text, awarded_at timestamptz) AS $$
DECLARE
  m match%ROWTYPE;
  v_self uuid[] := recognition_self_players();
  v_season uuid;
  v_opens timestamptz;
  s record; me uuid; v_as text; n recognition_nomination%ROWTYPE; h honour%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR cardinality(v_self) = 0 THEN RETURN; END IF;
  PERFORM recognition_nomination_lapse(p_match);
  v_season := potm_season_of(p_match);
  v_opens := potm_window_opens(p_match);
  FOR s IN SELECT * FROM (VALUES ('home', m.school_id, m.team_code), ('away', m.away_school_id, m.away_team_code)) x(side, school, team)
            WHERE x.school IS NOT NULL LOOP
    -- His own nomination for this side, if any (the last).
    SELECT * INTO n FROM recognition_nomination x
     WHERE x.kind = 'player_of_match' AND x.match_id = p_match AND x.school_id = s.school AND x.team_code = s.team
       AND x.nominated_by_player_id = ANY (v_self)
     ORDER BY x.created_at DESC LIMIT 1;
    -- Which of his players captains this side this season.
    SELECT p.id INTO me FROM player p
     WHERE p.id = ANY (v_self) AND p.school_id = s.school AND v_season IS NOT NULL AND is_captain_of(p.id, s.team, v_season)
     ORDER BY p.id LIMIT 1;
    IF me IS NULL AND n.id IS NULL THEN CONTINUE; END IF;
    me := coalesce(me, n.nominated_by_player_id);
    v_as := (SELECT k.nominated_as FROM potm_nominators(p_match, s.side) k WHERE k.player_id = me);
    side := s.side; school_id := s.school; team_code := s.team;
    heading := match_award_heading(p_match, s.side);
    nominated_as := coalesce(n.nominated_as, v_as,
                             CASE WHEN captaincy_holds(me, s.team, v_season, 'captain') THEN 'captain' ELSE 'vice_captain' END);
    coach_name := potm_side_coach_name(s.school, s.team);
    closes_at := coalesce(n.closes_at, v_opens + interval '48 hours');
    head_seq := match_head_seq(p_match);
    refusal := CASE
      WHEN v_season IS NULL THEN 'no_season'
      WHEN match_award_side_of(p_match, me) IS DISTINCT FROM s.side THEN 'not_on_sheet'
      WHEN v_as IS NULL THEN 'captain_on_sheet'
      WHEN NOT match_verified(p_match) THEN 'not_verified'
      WHEN EXISTS (SELECT 1 FROM honour y WHERE y.match_id = p_match AND y.school_id = s.school AND y.team_code = s.team
                      AND y.kind = 'player_of_match' AND y.withdrawn_at IS NULL) THEN 'already_awarded'
      WHEN v_opens IS NULL OR now() >= v_opens + interval '48 hours' THEN 'window_closed'
      WHEN EXISTS (SELECT 1 FROM recognition_nomination y WHERE y.kind = 'player_of_match' AND y.match_id = p_match
                      AND y.school_id = s.school AND y.team_code = s.team AND y.status = 'open') THEN 'already_nominated'
      WHEN EXISTS (SELECT 1 FROM recognition_nomination y WHERE y.kind = 'player_of_match' AND y.match_id = p_match
                      AND y.school_id = s.school AND y.team_code = s.team
                      AND y.status IN ('confirmed', 'superseded', 'no_award')) THEN 'already_decided'
    END;
    may_nominate := refusal IS NULL;
    sheet := CASE WHEN may_nominate THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object('playerId', q.player_id, 'name', match_award_short(p.full_name))
                                 ORDER BY q.batting_no NULLS LAST, p.full_name), '[]'::jsonb)
         FROM match_squad q JOIN player p ON p.id = q.player_id
        WHERE q.match_id = p_match AND q.side = s.side AND NOT q.withdrawn AND p.school_id = s.school AND q.player_id <> me) END;
    nomination_id := n.id; nominee_id := n.nominee_player_id;
    nominee_name := (SELECT match_award_short(p.full_name) FROM player p WHERE p.id = n.nominee_player_id);
    status := n.status; nominated_at := n.created_at; decided_at := n.decided_at;
    -- The award that answered it, as the side sees it; none once withdrawn.
    h := NULL;
    IF n.honour_id IS NOT NULL THEN
      SELECT * INTO h FROM honour y WHERE y.id = n.honour_id AND y.withdrawn_at IS NULL;
    END IF;
    award_player_id := h.player_id;
    award_name := (SELECT match_award_short(p.full_name) FROM player p WHERE p.id = h.player_id);
    awarded_at := h.awarded_at;
    RETURN NEXT;
    n := NULL; me := NULL;
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The captain nominates (D16). p_derived is the application's working:
-- the basis, the head it read, the suggestions (each with figures, from
-- his side's sheet) and the nominee's figures.
--   not_permitted · not_captain · captain_on_sheet · not_on_sheet ·
--   nominee_not_on_sheet · cannot_nominate_yourself · not_verified ·
--   already_awarded · window_closed · already_nominated · already_decided ·
--   no_season · stale · derived_from_invalid
CREATE OR REPLACE FUNCTION captain_nominate(p_match uuid, p_nominee uuid, p_derived jsonb)
RETURNS TABLE (ok boolean, reason text, nomination_id uuid) AS $$
DECLARE
  m match%ROWTYPE;
  v_self uuid[] := recognition_self_players();
  v_season uuid; v_opens timestamptz; v_head integer; v_hash text;
  v_rank integer := 0; v_reason text := 'not_captain';
  s record; sp uuid; v_me uuid; v_side text; v_school uuid; v_team text; v_as text; v_id uuid; x jsonb;
BEGIN
  -- 1. The pupil himself, through his own verified link.
  SELECT * INTO m FROM match y WHERE y.id = p_match;
  IF NOT FOUND OR cardinality(v_self) = 0 THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN;
  END IF;
  v_season := potm_season_of(p_match);
  IF v_season IS NULL THEN
    RETURN QUERY SELECT false, 'no_season'::text, NULL::uuid; RETURN;
  END IF;
  -- 2 and 3. A captaincy of a side of this match, the sheet, and D14's rule.
  FOR s IN SELECT * FROM (VALUES ('home', m.school_id, m.team_code), ('away', m.away_school_id, m.away_team_code)) z(side, school, team)
            WHERE z.school IS NOT NULL LOOP
    FOREACH sp IN ARRAY v_self LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM player p WHERE p.id = sp AND p.school_id = s.school);
      CONTINUE WHEN NOT is_captain_of(sp, s.team, v_season);
      IF match_award_side_of(p_match, sp) IS DISTINCT FROM s.side THEN
        IF v_rank < 1 THEN v_rank := 1; v_reason := 'not_on_sheet'; END IF;
        CONTINUE;
      END IF;
      v_as := (SELECT k.nominated_as FROM potm_nominators(p_match, s.side) k WHERE k.player_id = sp);
      IF v_as IS NULL THEN
        IF v_rank < 2 THEN v_rank := 2; v_reason := 'captain_on_sheet'; END IF;
        CONTINUE;
      END IF;
      v_me := sp; v_side := s.side; v_school := s.school; v_team := s.team;
      EXIT;
    END LOOP;
    EXIT WHEN v_me IS NOT NULL;
  END LOOP;
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, v_reason, NULL::uuid; RETURN;
  END IF;
  -- 4. The nominee is on his side's sheet, of his side's school.
  IF p_nominee IS NULL OR match_award_side_of(p_match, p_nominee) IS DISTINCT FROM v_side
     OR NOT EXISTS (SELECT 1 FROM player p WHERE p.id = p_nominee AND p.school_id = v_school) THEN
    RETURN QUERY SELECT false, 'nominee_not_on_sheet'::text, NULL::uuid; RETURN;
  END IF;
  -- 5. Never himself.
  IF p_nominee = ANY (v_self) OR potm_is_the_boy(app_user_id(), p_nominee) THEN
    RETURN QUERY SELECT false, 'cannot_nominate_yourself'::text, NULL::uuid; RETURN;
  END IF;
  -- 6. The match verified (R3).
  IF NOT match_verified(p_match) THEN
    RETURN QUERY SELECT false, 'not_verified'::text, NULL::uuid; RETURN;
  END IF;
  -- One act at a time for a match, as match_award() takes it.
  PERFORM 1 FROM match y WHERE y.id = p_match FOR UPDATE;
  PERFORM recognition_nomination_lapse(p_match);
  -- 7. No award stands for the side.
  IF EXISTS (SELECT 1 FROM honour y WHERE y.match_id = p_match AND y.school_id = v_school AND y.team_code = v_team
                AND y.kind = 'player_of_match' AND y.withdrawn_at IS NULL) THEN
    RETURN QUERY SELECT false, 'already_awarded'::text, NULL::uuid; RETURN;
  END IF;
  -- 8. Within 48 hours of the match becoming verified (Q6).
  v_opens := potm_window_opens(p_match);
  IF v_opens IS NULL OR now() >= v_opens + interval '48 hours' THEN
    RETURN QUERY SELECT false, 'window_closed'::text, NULL::uuid; RETURN;
  END IF;
  -- 9. One open nomination a side a match (and the index behind it).
  IF EXISTS (SELECT 1 FROM recognition_nomination y WHERE y.kind = 'player_of_match' AND y.match_id = p_match
                AND y.school_id = v_school AND y.team_code = v_team AND y.status = 'open') THEN
    RETURN QUERY SELECT false, 'already_nominated'::text, NULL::uuid; RETURN;
  END IF;
  -- Once the coach has decided the side's nomination, it is decided.
  IF EXISTS (SELECT 1 FROM recognition_nomination y WHERE y.kind = 'player_of_match' AND y.match_id = p_match
                AND y.school_id = v_school AND y.team_code = v_team AND y.status IN ('confirmed', 'superseded', 'no_award')) THEN
    RETURN QUERY SELECT false, 'already_decided'::text, NULL::uuid; RETURN;
  END IF;
  -- The working: ids and figures, from his side's sheet, at the head.
  v_head := match_head_seq(p_match);
  IF jsonb_typeof(p_derived) IS DISTINCT FROM 'object' OR pg_column_size(p_derived) > 4096
     OR p_derived->>'basis' IS DISTINCT FROM 'batting_bowling'
     OR jsonb_typeof(p_derived->'headSeq') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_derived->'suggestions') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_derived->'suggestions') > 3
     OR p_derived->'nominee'->>'playerId' IS DISTINCT FROM p_nominee::text
     OR jsonb_typeof(p_derived->'nominee'->'figures') IS DISTINCT FROM 'string'
     OR length(p_derived->'nominee'->>'figures') > 80 THEN
    RETURN QUERY SELECT false, 'derived_from_invalid'::text, NULL::uuid; RETURN;
  END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(p_derived->'suggestions') e LOOP
    IF jsonb_typeof(x->'figures') IS DISTINCT FROM 'string' OR length(x->>'figures') > 80
       OR coalesce(x->>'playerId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR match_award_side_of(p_match, (x->>'playerId')::uuid) IS DISTINCT FROM v_side THEN
      RETURN QUERY SELECT false, 'derived_from_invalid'::text, NULL::uuid; RETURN;
    END IF;
  END LOOP;
  IF (p_derived->>'headSeq')::numeric <> v_head THEN
    RETURN QUERY SELECT false, 'stale'::text, NULL::uuid; RETURN;
  END IF;
  SELECT r.result_hash INTO v_hash FROM match_result_compute(p_match) r;
  BEGIN
    INSERT INTO recognition_nomination (kind, match_id, season_id, school_id, team_code, nominee_player_id,
                                        nominated_by_player_id, nominated_as, derived_from, closes_at)
    VALUES ('player_of_match', p_match, v_season, v_school, v_team, p_nominee, v_me, v_as,
            jsonb_build_object('version', 1, 'basis', 'batting_bowling', 'factsVersion', p_derived->'factsVersion',
                               'suggestions', (SELECT jsonb_agg(jsonb_build_object('playerId', e->'playerId', 'figures', e->'figures'))
                                                 FROM jsonb_array_elements(p_derived->'suggestions') e),
                               'nominee', jsonb_build_object('playerId', p_nominee, 'figures', p_derived->'nominee'->'figures'),
                               'headSeq', v_head, 'resultHash', v_hash, 'side', v_side),
            v_opens + interval '48 hours')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'already_nominated'::text, NULL::uuid; RETURN;
  END;
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The staff sheet's line (D18): for each side of the match the caller is
-- the side's staff for (D8), the side's latest nomination, and whether he
-- may decide it now and, if not, why.
--   refusal: not_permitted (he reads, does not decide) · guardian_conflict
--            (instead: who decides) · decider_is_nominator · not_verified ·
--            lapsed · decided
CREATE OR REPLACE FUNCTION match_nomination_state(p_match uuid)
RETURNS TABLE (side text, school_id uuid, team_code text, nomination_id uuid, nominee_id uuid, nominee_name text,
               nominated_as text, status text, nominated_at timestamptz, closes_at timestamptz, decided_at timestamptz,
               decided_by_name text, honour_id uuid, may_decide boolean, refusal text, instead text) AS $$
DECLARE
  m match%ROWTYPE;
  v_me uuid := app_user_id();
  s record; n recognition_nomination%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR v_me IS NULL THEN RETURN; END IF;
  PERFORM recognition_nomination_lapse(p_match);
  FOR s IN SELECT * FROM (VALUES ('home', m.school_id, m.team_code), ('away', m.away_school_id, m.away_team_code)) x(side, school, team)
            WHERE x.school IS NOT NULL AND NOT app_is_platform_wide() AND recognition_nomination_staff(x.school, x.team, p_match) LOOP
    SELECT * INTO n FROM recognition_nomination x
     WHERE x.kind = 'player_of_match' AND x.match_id = p_match AND x.school_id = s.school AND x.team_code = s.team
     ORDER BY x.created_at DESC LIMIT 1;
    CONTINUE WHEN n.id IS NULL;
    side := s.side; school_id := s.school; team_code := s.team;
    nomination_id := n.id; nominee_id := n.nominee_player_id;
    nominee_name := (SELECT p.full_name FROM player p WHERE p.id = n.nominee_player_id);
    nominated_as := n.nominated_as; status := n.status; nominated_at := n.created_at;
    closes_at := n.closes_at; decided_at := n.decided_at; honour_id := n.honour_id;
    decided_by_name := (SELECT u.name FROM app_user u WHERE u.id = n.decided_by);
    instead := NULL;
    refusal := CASE
      WHEN n.status = 'lapsed' THEN 'lapsed'
      WHEN n.status <> 'open' THEN 'decided'
      WHEN NOT match_award_holds(s.school, s.team, p_match) THEN 'not_permitted'
      WHEN match_award_guardian_of(v_me, n.nominee_player_id) THEN 'guardian_conflict'
      WHEN potm_is_the_boy(v_me, n.nominated_by_player_id) THEN 'decider_is_nominator'
      WHEN NOT match_verified(p_match) THEN 'not_verified' END;
    IF refusal = 'guardian_conflict' THEN instead := match_award_instead(v_me, s.school); END IF;
    may_decide := refusal IS NULL;
    RETURN NEXT;
    n := NULL;
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The coach decides the nomination (D18): confirm (the nominee), choose
-- another (p_player, through R6's match_award(), which writes the honour
-- and the side's notice; the trigger above answers the nomination), or no
-- award. R6's own refusals come back as they are.
--   not_permitted · lapsed · already_decided · action_invalid ·
--   guardian_conflict (detail: who decides) · decider_is_nominator ·
--   player_required · and match_award()'s
CREATE OR REPLACE FUNCTION match_nomination_decide(p_nomination uuid, p_action text, p_player uuid, p_derived jsonb)
RETURNS TABLE (ok boolean, reason text, detail text, honour_id uuid) AS $$
DECLARE
  n recognition_nomination%ROWTYPE;
  v_me uuid := app_user_id();
  r record; v_player uuid;
BEGIN
  SELECT * INTO n FROM recognition_nomination x WHERE x.id = p_nomination AND x.kind = 'player_of_match';
  IF NOT FOUND OR v_me IS NULL OR NOT match_award_holds(n.school_id, n.team_code, n.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  PERFORM 1 FROM match y WHERE y.id = n.match_id FOR UPDATE;
  PERFORM recognition_nomination_lapse(n.match_id);
  SELECT * INTO n FROM recognition_nomination x WHERE x.id = p_nomination FOR UPDATE;
  IF n.status = 'lapsed' THEN
    RETURN QUERY SELECT false, 'lapsed'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF n.status <> 'open' THEN
    RETURN QUERY SELECT false, 'already_decided'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'choose', 'no_award') THEN
    RETURN QUERY SELECT false, 'action_invalid'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF match_award_guardian_of(v_me, n.nominee_player_id) THEN
    RETURN QUERY SELECT false, 'guardian_conflict'::text, match_award_instead(v_me, n.school_id), NULL::uuid; RETURN;
  END IF;
  IF potm_is_the_boy(v_me, n.nominated_by_player_id) THEN
    RETURN QUERY SELECT false, 'decider_is_nominator'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF p_action = 'no_award' THEN
    UPDATE recognition_nomination SET status = 'no_award', decided_by = v_me, decided_at = now() WHERE id = n.id;
    RETURN QUERY SELECT true, NULL::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  v_player := CASE WHEN p_action = 'confirm' THEN n.nominee_player_id ELSE p_player END;
  IF v_player IS NULL OR (p_action = 'confirm' AND p_player IS NOT NULL AND p_player <> n.nominee_player_id) THEN
    RETURN QUERY SELECT false, 'player_required'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO r FROM match_award(n.match_id, v_player, p_derived);
  RETURN QUERY SELECT r.ok, r.reason, r.detail, r.honour_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The To-resolve row (D18, A22): every open nomination in its window the
-- caller may decide — never one of a boy he is guardian of, never his own.
CREATE OR REPLACE FUNCTION nominations_to_decide()
RETURNS TABLE (nomination_id uuid, match_id uuid, starts_at timestamptz, side text, side_label text, heading text,
               nominee_name text, nominated_as text, closes_at timestamptz) AS $$
BEGIN
  IF app_user_id() IS NULL THEN RETURN; END IF;
  PERFORM recognition_nomination_lapse(NULL);
  RETURN QUERY
  SELECT n.id, n.match_id, m.starts_at, x.side, coalesce(fixture_side_label(n.school_id, n.team_code), n.team_code),
         match_award_heading(n.match_id, x.side), match_award_short(p.full_name), n.nominated_as, n.closes_at
    FROM recognition_nomination n
    JOIN match m ON m.id = n.match_id
    JOIN player p ON p.id = n.nominee_player_id
    CROSS JOIN LATERAL (SELECT CASE WHEN m.school_id = n.school_id AND m.team_code = n.team_code THEN 'home' ELSE 'away' END AS side) x
   WHERE n.kind = 'player_of_match' AND n.status = 'open' AND n.closes_at > now()
     AND match_award_holds(n.school_id, n.team_code, n.match_id)
     AND NOT match_award_guardian_of(app_user_id(), n.nominee_player_id)
     AND NOT potm_is_the_boy(app_user_id(), n.nominated_by_player_id)
   ORDER BY n.closes_at, n.id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  7 · Who may call what
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  -- The doors, and the read policy's two tests: the application's alone.
  FOREACH f IN ARRAY ARRAY['captain_nomination_state(uuid)', 'captain_nominate(uuid,uuid,jsonb)',
                           'match_nomination_state(uuid)', 'match_nomination_decide(uuid,text,uuid,jsonb)',
                           'nominations_to_decide()',
                           'recognition_nomination_mine(uuid)', 'recognition_nomination_staff(uuid,text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  -- The system's own: nobody's to call.
  FOREACH f IN ARRAY ARRAY['captaincy_holds(uuid,text,uuid,text)', 'is_captain_of(uuid,text,uuid)', 'potm_season_of(uuid)',
                           'potm_nominators(uuid,text)', 'recognition_self_players()', 'potm_is_the_boy(uuid,uuid)',
                           'potm_window_opens(uuid)', 'potm_side_coach_name(uuid,text)', 'recognition_nomination_lapse(uuid)',
                           'recognition_nomination_guard()', 'recognition_nomination_audit()',
                           'honour_tie_nomination()', 'honour_close_nomination()'] LOOP
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
      EXECUTE format('REVOKE ALL ON recognition_nomination FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
--  What this file promised, checked in the same paste
-- ══════════════════════════════════════════════════════════════════
-- The behaviour is asserted live in db/99 §122.
DO $check$
DECLARE f text; r text; v_src text;
BEGIN
  IF pg_temp._v144_fold((SELECT prosrc FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure))
     <> 'b1ae191ba7ddb1e122d1bf849883f6a7' THEN
    RAISE EXCEPTION 'db/144: audit_log() is not this file''s after the paste (md5 %)',
      pg_temp._v144_fold((SELECT prosrc FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure));
  END IF;
  -- Definers, pinned; no reading of the database's day (db/128).
  FOREACH f IN ARRAY ARRAY['captaincy_holds(uuid,text,uuid,text)', 'is_captain_of(uuid,text,uuid)', 'potm_season_of(uuid)',
                           'potm_nominators(uuid,text)', 'recognition_self_players()', 'potm_is_the_boy(uuid,uuid)',
                           'potm_window_opens(uuid)', 'potm_side_coach_name(uuid,text)', 'recognition_nomination_lapse(uuid)',
                           'recognition_nomination_mine(uuid)', 'recognition_nomination_staff(uuid,text,uuid)',
                           'recognition_nomination_audit()', 'honour_tie_nomination()', 'honour_close_nomination()',
                           'captain_nomination_state(uuid)', 'captain_nominate(uuid,uuid,jsonb)',
                           'match_nomination_state(uuid)', 'match_nomination_decide(uuid,text,uuid,jsonb)',
                           'nominations_to_decide()'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/144: % is not a definer', f;
    END IF;
    IF NOT ('search_path=pg_catalog, public, pg_temp' = ANY (coalesce((SELECT proconfig FROM pg_proc WHERE oid = f::regprocedure), '{}'))) THEN
      RAISE EXCEPTION 'db/144: % does not pin its search_path', f;
    END IF;
    IF v_src ~* '\mcurrent_date\M' THEN
      RAISE EXCEPTION 'db/144: % reads the database''s day (db/128)', f;
    END IF;
  END LOOP;
  -- The doors and the policy's tests: the application's, nobody else's.
  FOREACH f IN ARRAY ARRAY['captain_nomination_state(uuid)', 'captain_nominate(uuid,uuid,jsonb)',
                           'match_nomination_state(uuid)', 'match_nomination_decide(uuid,text,uuid,jsonb)',
                           'nominations_to_decide()',
                           'recognition_nomination_mine(uuid)', 'recognition_nomination_staff(uuid,text,uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/144: % is not the application''s alone', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['captaincy_holds(uuid,text,uuid,text)', 'is_captain_of(uuid,text,uuid)', 'potm_season_of(uuid)',
                           'potm_nominators(uuid,text)', 'recognition_self_players()', 'potm_is_the_boy(uuid,uuid)',
                           'potm_window_opens(uuid)', 'potm_side_coach_name(uuid,text)', 'recognition_nomination_lapse(uuid)',
                           'recognition_nomination_guard()', 'recognition_nomination_audit()',
                           'honour_tie_nomination()', 'honour_close_nomination()'] LOOP
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/144: % is callable by the application or PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles ro WHERE ro.rolname = r)
       AND (has_table_privilege(r, 'recognition_nomination', 'SELECT')
            OR EXISTS (SELECT 1 FROM pg_roles ro, pg_proc p
                        WHERE ro.rolname = r AND p.pronamespace = 'public'::regnamespace
                          AND p.proname IN ('captain_nomination_state', 'captain_nominate', 'match_nomination_state',
                                            'match_nomination_decide', 'nominations_to_decide', 'is_captain_of')
                          AND has_function_privilege(ro.oid, p.oid, 'EXECUTE'))) THEN
      RAISE EXCEPTION 'db/144: a managed host''s API role (%) reaches a nomination', r;
    END IF;
  END LOOP;
  -- The table: SELECT is the application's only privilege; RLS on, with the
  -- read and its two RESTRICTIVE cuts; no free-text column.
  IF NOT has_table_privilege('scrbrd_app', 'recognition_nomination', 'SELECT')
     OR has_table_privilege('scrbrd_app', 'recognition_nomination', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'recognition_nomination', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'recognition_nomination', 'DELETE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'recognition_nomination'::regclass) THEN
    RAISE EXCEPTION 'db/144: recognition_nomination is writable by the application, unreadable by it, or its RLS is off';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'recognition_nomination'::regclass
        AND ((polname = 'recognition_nomination_read' AND polpermissive AND polcmd = 'r')
          OR (polname IN ('recognition_nomination_not_platform', 'recognition_nomination_no_support') AND NOT polpermissive AND polcmd = 'r'))) <> 3
     OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'recognition_nomination'::regclass AND polpermissive) <> 1 THEN
    RAISE EXCEPTION 'db/144: recognition_nomination''s policies are not the read and its two cuts';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'recognition_nomination'
                AND data_type = 'text' AND column_name NOT IN ('kind', 'team_code', 'nominated_as', 'status')) THEN
    RAISE EXCEPTION 'db/144: recognition_nomination has a free-text column (SG-9)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'recognition_nomination_open_once') THEN
    RAISE EXCEPTION 'db/144: the one-open-nomination index is missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
        AND ((tgrelid = 'honour'::regclass AND tgname IN ('honour_tie_nomination', 'honour_close_nomination'))
          OR (tgrelid = 'recognition_nomination'::regclass AND tgname IN ('recognition_nomination_guard', 'recognition_nomination_audit')))) <> 4 THEN
    RAISE EXCEPTION 'db/144: a trigger on honour or recognition_nomination is missing or disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'recognition_audit'::regclass AND conname = 'recognition_audit_event_check'
                    AND pg_get_constraintdef(oid) LIKE '%nomination_lapsed%') THEN
    RAISE EXCEPTION 'db/144: the recognition audit does not take a nomination''s events';
  END IF;
END $check$;

DROP FUNCTION pg_temp._v144_patch(text, text, text, integer);
DROP FUNCTION pg_temp._v144_fold(text);
