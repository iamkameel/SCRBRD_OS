-- ══════════════════════════════════════════════════════════════════
--  142 · Player of the Match, the coach's path (RECOGNITION R6)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/RECOGNITION_design.md, approved by Kameel on
-- 7 Oct 2026 as recommended (D1–D25, Q1–Q12), unparked 5 Nov 2026. This is
-- §10's R6 row: D5 (the decider is named), D9 and D10 (who may decide, and
-- never a guardian of the boy), D18's notice to the side, D21's withdrawal
-- kinds, `derived_from` holding the suggestions with the log head and the
-- result hash for D19 (R10 compares them later), and a recognition audit
-- table joined into audit_log(). The reconciliation's R6 row
-- (docs/design/RECOGNITION_reconciliation.md §5) names the capability and
-- the proofs. The captain's nomination (R7), Colours (R8), the corrections
-- trigger (R10), the D4 mask and the D7 RESTRICTIVE cut (R5c) are not here,
-- but for the one RESTRICTIVE line below that keeps the owner's key off a
-- Player of the Match. withdrawn_reason stays unmasked until R5c: today any
-- reader of the honour row may select it (recognition() never does).
-- Its proof is db/99 §120; the walks are smoke-recognition (the API) and
-- smoke-browser-potm (the staff sheet).
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   capability  + recognition.match.award: the side's coach (team-scoped),
--                 the director of sport, and the principal (D10's last
--                 step: when the director is the boy's guardian). Through
--                 ADDED_SINCE_01 (generate-rls.mjs), as db/131 added
--                 news.team.read. NOT the owner's key: D7 carves recognition
--                 out of superadmin, and this capability is the first of
--                 recognition.* to follow it (roles.mjs). recognition.manage
--                 is not moved (R5c's).
--   honour      + kind 'player_of_match' (the CHECK re-made with it)
--               + match_id      the match it was won in; a POTM's only
--               + decided_by    D5: the decider; existing rows backfilled
--                               from awarded_by; the stamp sets it from the
--                               session on every new row
--               + derived_from  D17/D19: the suggestions shown, each with its
--                               figures, the awardee's figures, the log's
--                               head `seq` and match_result()'s `result_hash`
--                               at the decision, stamped by the door
--               + withdrawn_kind  D21: 'correction' | 'other', NOT NULL with
--                               withdrawn_at; existing withdrawn rows 'other'
--               + notice_id     the side's notice, so a withdrawal takes it back
--               ~ honour_once_a_season  re-made so it leaves player_of_match
--                               out (a boy may be Player of the Match more
--                               than once a season)
--               + honour_match_award_once  one standing per side per match (Q5)
--               + honour_match_award_door  RESTRICTIVE, INSERT: the
--                               application writes no player_of_match row
--                               but through match_award() below
--               + honour_no_platform_award  RESTRICTIVE, UPDATE: no
--                               platform-wide assignment withdraws a Player
--                               of the Match or puts it on the board (D7,
--                               until R5c cuts the whole table)
--               ~ honour_stamp() (db/08)  a POTM's side is the match's code
--                               for the boy's side on the sheet, never his
--                               current team (D22); decided_by stamped; the
--                               new columns never edited; a withdrawal's
--                               kind defaults to 'other'; a guardian of the
--                               boy never withdraws a Player of the Match
--               ~ honour_kind_label() (db/08)  'Player of the Match'
--   triggers    + honour_tell_side   BEFORE INSERT, a POTM: the side's notice
--               + honour_unsay_side  AFTER UPDATE OF withdrawn_at, a POTM:
--                               the notice taken back; on 'correction' one
--                               low notice to the side naming nobody (D21)
--               + honour_audit       AFTER INSERT OR UPDATE: the audit row
--   table       + recognition_audit  (RLS on, no grant: read through
--                               audit_log() alone), backfilled from the
--                               honours already held; never updated
--   ~ audit_log() (db/136)  kind 'recognition' joins the list and the union,
--                 patched in place (db/136's exact-needle pattern). Words:
--                 "Awarded Player of the Match", "Withdrew … after a
--                 correction". Never the reason (D4, READERS Q2).
--   functions   + match_award_holds, match_award_guardian_of,
--                 match_award_side_of, match_award_opponent, match_award_short,
--                 the three trigger functions, the audit guard (nobody's)
--               + match_award_state, match_award, match_award_withdraw
--                 (the doors: scrbrd_app only)
--
-- ── WHO MAY DECIDE (D9, D10) ────────────────────────────────────────
-- A holder of recognition.match.award over the boy's side (app_can at the
-- side's school and code), through an assignment AT that school (never a
-- platform-wide one: D7), as himself (never a pad's credential, never a
-- support hour). Row checks: the boy is on that side's sheet for the match
-- (match_squad, not withdrawn); the match is verified (match_verified():
-- complete, every innings sealed and standing); no standing award for that
-- side and match; never the boy himself; never a guardian of the boy (any
-- guardian assignment naming him, verified or not, not ended: a parent is
-- a parent before the office verifies her) — refused 'guardian_conflict',
-- naming who decides: the director of sport, or the principal when the
-- caller is the director. The same people withdraw it, with a kind and a
-- reason; the office (recognition.manage) may also withdraw it through the
-- ordinary route. A guardian of the boy withdraws it by no route: the door
-- refuses him in words, and honour_stamp() refuses him at the table
-- (insufficient_privilege). Nothing here nominates: R7's captain is later.
--
-- ── WHAT IS SAID (D18, D21) ─────────────────────────────────────────
-- To the side, at team scope, under news.read, kind recognition, low:
--   "Player of the Match · Sat 3 Oct v Kearsney: R Pillay"
-- Never to a child alone (no recipient); a push is a pointer (push-api.mjs
-- buildPayload()), so no lock screen carries a name. On withdrawal the
-- notice is taken back without a word: as a correction ('correction', the
-- system's word) when the scorecard was corrected, as a person's take-back
-- ('withdrawn', db/89's word for it, which notification_unretract() never
-- returns) for another reason. On 'correction' one more low notice to the
-- same side, naming nobody:
--   "Player of the Match · Sat 3 Oct v Kearsney: the award was withdrawn
--    after the scorecard was corrected." For 'other', nothing is said. A
-- notice that cannot be written never stops the award or the withdrawal:
-- it is a WARNING (as db/132 and db/140).
--
-- EXISTING ROWS. decided_by and withdrawn_kind are backfilled with
-- honour_stamp set aside for the two UPDATEs only (db/13's precedent); no
-- other column of any row changes. recognition_audit gains a row for every
-- honour already awarded and one for every withdrawal. Safe to run twice.
-- DROPs: honour_kind_check (made again with the new kind), the old
-- honour_once_a_season (made again without POTM), and DROP POLICY IF EXISTS
-- before each of the two policies this file creates; the pg_temp helpers
-- at the end.
--
-- SCHEMA FIRST. The API built with it calls match_award_state(),
-- match_award() and match_award_withdraw(); this file goes before it and is
-- in services/api/expected-migrations.json.
--
-- THE GUARD keys on pg_proc.prosrc as db/132–db/137 do: the md5 of the live
-- body, its whitespace folded, must be its source's or this file's.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v142_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('honour') IS NULL OR to_regclass('notification') IS NULL OR to_regclass('match_squad') IS NULL
     OR to_regclass('capability') IS NULL OR to_regclass('role_capability') IS NULL
     OR to_regprocedure('notification_retract(uuid,text,boolean)') IS NULL
     OR to_regprocedure('match_verified(uuid)') IS NULL OR to_regprocedure('match_head_seq(uuid)') IS NULL
     OR to_regprocedure('match_result_compute(uuid)') IS NULL
     OR to_regprocedure('fixture_side_label(uuid,text)') IS NULL
     OR to_regprocedure('app_pad_scoped()') IS NULL OR to_regprocedure('app_support_access_id(uuid)') IS NULL
     OR to_regprocedure('audit_person_label(uuid)') IS NULL OR to_regprocedure('sa_today()') IS NULL THEN
    RAISE EXCEPTION 'db/142: the notices (db/89), the official result (db/114), the sheet label (db/131), the audit log (db/79) or the SA day (db/08) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('honour_stamp()',                 'ba879ca71d07f48100c4218397a80a4b', '4d23d2abe5b6a93970590b2cdf413933', 'db/08'),
      ('honour_kind_label(text,text)',   'f97492d5524992eef7c2abaa46d7bea8', '1456d2e848e00cb3277e356dc4958178', 'db/08'),
      ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                                         'a381fc0455aff9196d74f232eacfb01b', '5e47b7126f7d31e45a3407cbebbb33a2', 'db/136'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/142: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := pg_temp._v142_fold(v_src);
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/142: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;

-- One body, one change: `needle` must stand in it exactly `times` times, and
-- each becomes `repl`. Re-emitted through pg_get_functiondef(), so the
-- signature, options and grants stand; a body already this file's is left.
CREATE OR REPLACE FUNCTION pg_temp._v142_patch(p_fn text, p_needle text, p_repl text, p_times integer) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> p_times THEN
    RAISE EXCEPTION 'db/142: % holds its needle % times, not %: look before replacing it', p_fn, v_n, p_times;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;


-- ══════════════════════════════════════════════════════════════════
--  1 · The capability (ADDED_SINCE_01)
-- ══════════════════════════════════════════════════════════════════
INSERT INTO capability (name) VALUES ('recognition.match.award') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('coach',           'recognition.match.award'),
  ('directorofsport', 'recognition.match.award'),
  -- D10's last step: the principal decides when the director is the guardian.
  ('principal',       'recognition.match.award')
ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════
--  2 · The honour learns a match, a decider, its working and a kind of
--      withdrawal
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE honour ADD COLUMN IF NOT EXISTS match_id       uuid REFERENCES match(id);
ALTER TABLE honour ADD COLUMN IF NOT EXISTS decided_by     uuid REFERENCES app_user(id);
ALTER TABLE honour ADD COLUMN IF NOT EXISTS derived_from   jsonb;
ALTER TABLE honour ADD COLUMN IF NOT EXISTS withdrawn_kind text;
ALTER TABLE honour ADD COLUMN IF NOT EXISTS notice_id      uuid REFERENCES notification(id) ON DELETE SET NULL;

ALTER TABLE honour DROP CONSTRAINT IF EXISTS honour_kind_check;
ALTER TABLE honour ADD CONSTRAINT honour_kind_check
  CHECK (kind IN ('colours', 'half_colours', 'honours', 'captain', 'vice_captain', 'player_of_season', 'award',
                  'player_of_match'));

-- The two backfills, and nothing else, with the stamp set aside: it refuses
-- any edit of a withdrawn honour, which is right for every caller but this one.
ALTER TABLE honour DISABLE TRIGGER honour_stamp;
UPDATE honour SET decided_by = awarded_by WHERE decided_by IS NULL AND awarded_by IS NOT NULL;
UPDATE honour SET withdrawn_kind = 'other' WHERE withdrawn_at IS NOT NULL AND withdrawn_kind IS NULL;
ALTER TABLE honour ENABLE TRIGGER honour_stamp;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'honour'::regclass AND conname = 'honour_withdrawn_kind_known') THEN
    ALTER TABLE honour ADD CONSTRAINT honour_withdrawn_kind_known
      CHECK (withdrawn_kind IS NULL OR withdrawn_kind IN ('correction', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'honour'::regclass AND conname = 'honour_withdrawal_has_kind') THEN
    ALTER TABLE honour ADD CONSTRAINT honour_withdrawal_has_kind
      CHECK ((withdrawn_at IS NULL) = (withdrawn_kind IS NULL));
  END IF;
  -- A match's award is tied to its match and carries its working; no other
  -- kind names a match (until a later file says otherwise).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'honour'::regclass AND conname = 'honour_match_award_is_tied') THEN
    ALTER TABLE honour ADD CONSTRAINT honour_match_award_is_tied
      CHECK (CASE WHEN kind = 'player_of_match'
                  THEN match_id IS NOT NULL AND team_code IS NOT NULL AND jsonb_typeof(derived_from) = 'object'
                  ELSE match_id IS NULL END);
  END IF;
  -- One of each kind a boy a season, live — but a Player of the Match is a
  -- match's, and a boy may be one more than once.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'honour_once_a_season'
                    AND indexdef LIKE '%player_of_match%') THEN
    DROP INDEX IF EXISTS honour_once_a_season;
    CREATE UNIQUE INDEX honour_once_a_season ON honour (player_id, kind, season_id)
      WHERE withdrawn_at IS NULL AND kind NOT IN ('award', 'player_of_match');
  END IF;
END $constraints$;

-- Q5: one standing Player of the Match per side per match.
CREATE UNIQUE INDEX IF NOT EXISTS honour_match_award_once ON honour (match_id, school_id, team_code)
  WHERE kind = 'player_of_match' AND withdrawn_at IS NULL;

-- The application's own INSERT never makes one: match_award() (a definer,
-- the table's owner, which RLS does not stop) is the only way in.
DROP POLICY IF EXISTS honour_match_award_door ON honour;
CREATE POLICY honour_match_award_door ON honour AS RESTRICTIVE
  FOR INSERT WITH CHECK (kind <> 'player_of_match');

-- D7, ahead of R5c: no platform-wide assignment changes a Player of the
-- Match (the owner's key still holds recognition.manage, and with it the
-- ordinary route's withdraw and is_public, until R5c carves recognition.*
-- out and cuts the whole table). The school's own people are untouched.
DROP POLICY IF EXISTS honour_no_platform_award ON honour;
CREATE POLICY honour_no_platform_award ON honour AS RESTRICTIVE
  FOR UPDATE USING (kind <> 'player_of_match' OR NOT app_is_platform_wide())
           WITH CHECK (kind <> 'player_of_match' OR NOT app_is_platform_wide());


-- ══════════════════════════════════════════════════════════════════
--  3 · The label, and the stamp
-- ══════════════════════════════════════════════════════════════════
-- db/08's, with one line added (db/142).
CREATE OR REPLACE FUNCTION honour_kind_label(p_kind text, p_name text) RETURNS text AS $$
  SELECT CASE p_kind
    WHEN 'colours'          THEN 'Full colours'
    WHEN 'half_colours'     THEN 'Half colours'
    WHEN 'honours'          THEN 'Honours'
    WHEN 'captain'          THEN 'Captain'
    WHEN 'vice_captain'     THEN 'Vice-captain'
    WHEN 'player_of_season' THEN 'Player of the season'
    WHEN 'player_of_match'  THEN 'Player of the Match'   -- db/142
    WHEN 'award'            THEN coalesce(p_name, 'Award')
    ELSE p_kind END || CASE WHEN p_kind <> 'award' AND p_name IS NOT NULL THEN ' — ' || p_name ELSE '' END;
$$ LANGUAGE sql IMMUTABLE;

-- The boy's side on a match's sheet: 'home' or 'away', or NULL when he is
-- not on it (a withdrawn name is not on it).
CREATE OR REPLACE FUNCTION match_award_side_of(p_match uuid, p_player uuid) RETURNS text AS $$
  SELECT s.side FROM match_squad s WHERE s.match_id = p_match AND s.player_id = p_player AND NOT s.withdrawn
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/08's, with the lines marked db/142.
CREATE OR REPLACE FUNCTION honour_stamp() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.school_id, p.team_code INTO NEW.school_id, NEW.team_code FROM player p WHERE p.id = NEW.player_id;
    IF NEW.school_id IS NULL THEN
      RAISE EXCEPTION 'no such player: %', NEW.player_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    -- db/142: a match's award is the side's he won it for, as the sheet has
    -- him, never the side he is on today (D22).
    IF NEW.kind = 'player_of_match' THEN
      NEW.team_code := (SELECT CASE match_award_side_of(m.id, NEW.player_id)
                                 WHEN 'home' THEN CASE WHEN m.school_id = NEW.school_id THEN m.team_code END
                                 WHEN 'away' THEN CASE WHEN m.away_school_id = NEW.school_id THEN m.away_team_code END END
                          FROM match m WHERE m.id = NEW.match_id);
    END IF;
    NEW.awarded_by := app_user_id();
    NEW.awarded_at := now();
    NEW.decided_by := NEW.awarded_by;   -- db/142: D5, the decider is the session
    NEW.withdrawn_at := NULL; NEW.withdrawn_by := NULL; NEW.withdrawn_reason := NULL;
    NEW.withdrawn_kind := NULL; NEW.notice_id := NULL;   -- db/142
    RETURN NEW;
  END IF;
  -- db/142: the side's notice was deleted and its key set this to NULL;
  -- nothing else moves, withdrawn or not.
  IF OLD.notice_id IS NOT NULL AND NEW.notice_id IS NULL
     AND (to_jsonb(NEW) - 'notice_id') = (to_jsonb(OLD) - 'notice_id') THEN
    RETURN NEW;
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'a withdrawn honour is not edited — award it again' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.player_id IS DISTINCT FROM OLD.player_id OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.team_code IS DISTINCT FROM OLD.team_code OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.season_id IS DISTINCT FROM OLD.season_id
     OR NEW.citation IS DISTINCT FROM OLD.citation OR NEW.awarded_on IS DISTINCT FROM OLD.awarded_on
     OR NEW.awarded_by IS DISTINCT FROM OLD.awarded_by OR NEW.awarded_at IS DISTINCT FROM OLD.awarded_at
     OR NEW.match_id IS DISTINCT FROM OLD.match_id OR NEW.decided_by IS DISTINCT FROM OLD.decided_by   -- db/142
     OR NEW.derived_from IS DISTINCT FROM OLD.derived_from OR NEW.notice_id IS DISTINCT FROM OLD.notice_id THEN
    RAISE EXCEPTION 'an honour is not edited after it is awarded — withdraw it and award it again'
      USING ERRCODE = 'check_violation';
  END IF;
  -- is_public may change: putting a name on a board, or taking it off, is a
  -- decision about the board, not about the honour.
  IF NEW.withdrawn_at IS NOT NULL THEN
    -- db/142: D9/D10 at the table, whatever the route: a live guardian of
    -- the boy does not withdraw his Player of the Match (the door says it
    -- in words first).
    IF NEW.kind = 'player_of_match' AND match_award_guardian_of(app_user_id(), NEW.player_id) THEN
      RAISE EXCEPTION 'a guardian of the boy does not withdraw his Player of the Match; another of the school''s deciders does'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.withdrawn_at := now();
    NEW.withdrawn_by := app_user_id();
    NEW.withdrawn_kind := coalesce(NEW.withdrawn_kind, 'other');   -- db/142: D21
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  4 · Who decides (D9, D10)
-- ══════════════════════════════════════════════════════════════════
-- recognition.match.award over a side, held as himself through an
-- assignment AT the side's school by a school's role: never a platform-wide
-- assignment (D7), never a pad's credential, never a support hour.
CREATE OR REPLACE FUNCTION match_award_holds(p_school uuid, p_team text, p_match uuid) RETURNS boolean AS $$
  SELECT p_school IS NOT NULL AND p_team IS NOT NULL
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND app_support_access_id() IS NULL
     AND app_can('recognition.match.award', p_school, p_team, '00000000-0000-0000-0000-000000000000'::uuid, p_match)
     AND EXISTS (SELECT 1 FROM role_assignment a
                   JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'recognition.match.award'
                  WHERE a.person_id = app_user_id() AND a.active AND a.school_id = p_school
                    AND (a.team_code IS NULL OR a.team_code = p_team)
                    AND (a.fixture_id IS NULL OR a.fixture_id = p_match)
                    AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
                    AND (a.valid_until IS NULL OR a.valid_until > sa_today())
                    AND (a.expires_at IS NULL OR a.expires_at > now())
                    AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- D10: is this person a guardian of this boy? Any guardian assignment naming
-- him that has not ended, verified or not, consented or not: a parent is a
-- parent before the office verifies her, and refusing is the safe side.
CREATE OR REPLACE FUNCTION match_award_guardian_of(p_person uuid, p_player uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM role_assignment a
                   JOIN assignment_subject g ON g.assignment_id = a.id
                  WHERE a.person_id = p_person AND a.role = 'guardian' AND a.active
                    AND g.player_id = p_player AND g.relationship IS DISTINCT FROM 'self'
                    AND (a.valid_until IS NULL OR a.valid_until > sa_today())
                    AND (a.expires_at IS NULL OR a.expires_at > now())
                    AND (g.valid_until IS NULL OR g.valid_until > sa_today()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Who decides instead, said to a guardian who may not (D10).
CREATE OR REPLACE FUNCTION match_award_instead(p_person uuid, p_school uuid) RETURNS text AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM role_assignment a
                            WHERE a.person_id = p_person AND a.role = 'directorofsport' AND a.active
                              AND a.school_id = p_school
                              AND (a.valid_until IS NULL OR a.valid_until > sa_today()))
              THEN 'principal' ELSE 'directorofsport' END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- "R Pillay" from "Rohan Pillay": the initial and the surname (§7's words).
CREATE OR REPLACE FUNCTION match_award_short(p_name text) RETURNS text AS $$
  SELECT regexp_replace(btrim(coalesce(p_name, '')), '^(\S)\S*\s+(?:.*\s)?(\S+)$', '\1 \2')
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

-- The other side's label, from this side's point of view, and the day.
CREATE OR REPLACE FUNCTION match_award_opponent(p_match uuid, p_side text) RETURNS text AS $$
  SELECT CASE p_side
           WHEN 'home' THEN coalesce(fixture_side_label(m.away_school_id, m.away_team_code), m.opponent, 'the opposition')
           ELSE coalesce(fixture_side_label(m.school_id, m.team_code), m.team_code, 'the home side') END
    FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION match_award_heading(p_match uuid, p_side text) RETURNS text AS $$
  SELECT 'Player of the Match · ' || to_char(m.starts_at AT TIME ZONE 'Africa/Johannesburg', 'Dy FMDD Mon')
         || ' v ' || match_award_opponent(p_match, p_side)
    FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  5 · What the side is told (D18, D21)
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION honour_tell_side() RETURNS trigger AS $$
DECLARE v_id uuid; v_side text; v_name text;
BEGIN
  BEGIN
    v_side := coalesce(NEW.derived_from->>'side', match_award_side_of(NEW.match_id, NEW.player_id));
    SELECT match_award_short(p.full_name) INTO v_name FROM player p WHERE p.id = NEW.player_id;
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, is_public, subject_kind, subject_id, subject_person_id)
    VALUES (NEW.school_id, NEW.team_code, 'team', 'recognition', 'low',
            match_award_heading(NEW.match_id, v_side) || ': ' || v_name,
            v_name || ' is Player of the Match against ' || match_award_opponent(NEW.match_id, v_side) || '. Decided by the coach.',
            'news.read', false, 'match', NEW.match_id, NEW.player_id)
    RETURNING id INTO v_id;
    NEW.notice_id := v_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'db/142: the side was not told of Player of the Match % (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A person's take-back of the side's notice: the word db/89 gives a
-- retraction by a person ('withdrawn', retracted_by the withdrawer), the
-- one notification_unretract() refuses, so nothing the system does later
-- (a correction re-reached, R10) can put the award back on the side's feed.
-- Written through the retraction door as notification_retract() writes it:
-- that function keeps 'withdrawn' for a person's own post (kind 'notice'),
-- and an award withdrawn for another reason is a person's act about a
-- recognition notice. Nothing is said.
CREATE OR REPLACE FUNCTION match_award_take_back(p_notice uuid) RETURNS void AS $$
DECLARE n notification%ROWTYPE; v_by uuid := app_user_id();
BEGIN
  SELECT * INTO n FROM notification WHERE id = p_notice FOR UPDATE;
  IF NOT FOUND OR n.retracted_at IS NOT NULL THEN RETURN; END IF;
  PERFORM set_config('scrbrd.notification_retract', n.id::text, true);
  UPDATE notification SET retracted_at = now(), retracted_by = v_by, retraction_kind = 'withdrawn' WHERE id = n.id;
  PERFORM set_config('scrbrd.notification_retract', '', true);
  IF v_by IS NOT NULL THEN
    PERFORM log_restricted_read('notification.retract', ARRAY[n.id], ARRAY['retracted'], n.school_id);
  END IF;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- D21. The side's notice is taken back: as a correction when the scorecard
-- was corrected, as a person's take-back otherwise. Only a correction is
-- told, naming nobody. Two blocks, so a take-back that raises does not also
-- lose the correction's line. The side is the one the award was decided for
-- (derived_from), not the sheet as it stands now.
CREATE OR REPLACE FUNCTION honour_unsay_side() RETURNS trigger AS $$
DECLARE v_side text := coalesce(NEW.derived_from->>'side', match_award_side_of(NEW.match_id, NEW.player_id), 'home');
BEGIN
  BEGIN
    IF NEW.notice_id IS NOT NULL THEN
      IF NEW.withdrawn_kind = 'correction' THEN
        PERFORM notification_retract(NEW.notice_id, 'correction', false);
      ELSE
        PERFORM match_award_take_back(NEW.notice_id);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'db/142: the side''s notice of Player of the Match % was not taken back (%): %', NEW.id, SQLSTATE, SQLERRM;
  END;
  IF NEW.withdrawn_kind = 'correction' THEN
    BEGIN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id)
      VALUES (NEW.school_id, NEW.team_code, 'team', 'recognition', 'low',
              match_award_heading(NEW.match_id, v_side) || ': the award was withdrawn',
              match_award_heading(NEW.match_id, v_side) || ': the award was withdrawn after the scorecard was corrected.',
              'news.read', false, 'match', NEW.match_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'db/142: the side was not told Player of the Match % was withdrawn after a correction (%): %', NEW.id, SQLSTATE, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- After honour_stamp (triggers fire by name: stamp < tell), so the side's
-- code and the school are the stamp's.
CREATE OR REPLACE TRIGGER honour_tell_side BEFORE INSERT ON honour
  FOR EACH ROW WHEN (NEW.kind = 'player_of_match') EXECUTE FUNCTION honour_tell_side();
CREATE OR REPLACE TRIGGER honour_unsay_side AFTER UPDATE OF withdrawn_at ON honour
  FOR EACH ROW WHEN (OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL AND NEW.kind = 'player_of_match')
  EXECUTE FUNCTION honour_unsay_side();


-- ══════════════════════════════════════════════════════════════════
--  6 · The recognition audit
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS recognition_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  event      text NOT NULL CHECK (event IN ('awarded', 'withdrawn', 'made_public', 'made_private')),
  honour_id  uuid NOT NULL REFERENCES honour(id) ON DELETE CASCADE,
  school_id  uuid NOT NULL,
  team_code  text,
  player_id  uuid NOT NULL,
  match_id   uuid,
  kind       text NOT NULL,
  actor_id   uuid REFERENCES app_user(id),
  -- The honour's name and the withdrawal's kind. Never the reason (D4) and
  -- never the citation.
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS recognition_audit_school_at ON recognition_audit (school_id, at DESC);
COMMENT ON TABLE recognition_audit IS
  'db/142 (RECOGNITION R6): who awarded, withdrew, or put on or took off the public board each honour, and when. Written by honour_audit() alone, never updated; read through audit_log() alone. No reason, no citation.';
ALTER TABLE recognition_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recognition_audit FROM PUBLIC;
REVOKE ALL ON recognition_audit FROM scrbrd_app;

CREATE OR REPLACE FUNCTION recognition_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the recognition audit is not edited' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER recognition_audit_append_only BEFORE UPDATE ON recognition_audit
  FOR EACH ROW EXECUTE FUNCTION recognition_audit_append_only();

-- Each act at the moment it is made (clock_timestamp(), the column's
-- default), so two acts in one transaction keep their order in the log.
CREATE OR REPLACE FUNCTION honour_audit() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO recognition_audit (event, honour_id, school_id, team_code, player_id, match_id, kind, actor_id, detail)
    VALUES ('awarded', NEW.id, NEW.school_id, NEW.team_code, NEW.player_id, NEW.match_id, NEW.kind,
            NEW.awarded_by, jsonb_strip_nulls(jsonb_build_object('name', NEW.name)));
  ELSE
    IF OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL THEN
      INSERT INTO recognition_audit (event, honour_id, school_id, team_code, player_id, match_id, kind, actor_id, detail)
      VALUES ('withdrawn', NEW.id, NEW.school_id, NEW.team_code, NEW.player_id, NEW.match_id, NEW.kind,
              NEW.withdrawn_by, jsonb_strip_nulls(jsonb_build_object('name', NEW.name, 'withdrawnKind', NEW.withdrawn_kind)));
    END IF;
    IF NEW.is_public IS DISTINCT FROM OLD.is_public THEN
      INSERT INTO recognition_audit (event, honour_id, school_id, team_code, player_id, match_id, kind, actor_id, detail)
      VALUES (CASE WHEN NEW.is_public THEN 'made_public' ELSE 'made_private' END, NEW.id, NEW.school_id, NEW.team_code,
              NEW.player_id, NEW.match_id, NEW.kind, app_user_id(), jsonb_strip_nulls(jsonb_build_object('name', NEW.name)));
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
CREATE OR REPLACE TRIGGER honour_audit AFTER INSERT OR UPDATE OF withdrawn_at, is_public ON honour
  FOR EACH ROW EXECUTE FUNCTION honour_audit();

-- The honours already held: one row for each award and each withdrawal,
-- dated as the honour is. Once.
INSERT INTO recognition_audit (at, event, honour_id, school_id, team_code, player_id, match_id, kind, actor_id, detail)
SELECT h.awarded_at, 'awarded', h.id, h.school_id, h.team_code, h.player_id, h.match_id, h.kind, h.awarded_by,
       jsonb_strip_nulls(jsonb_build_object('name', h.name))
  FROM honour h
 WHERE NOT EXISTS (SELECT 1 FROM recognition_audit x WHERE x.honour_id = h.id AND x.event = 'awarded');
INSERT INTO recognition_audit (at, event, honour_id, school_id, team_code, player_id, match_id, kind, actor_id, detail)
SELECT h.withdrawn_at, 'withdrawn', h.id, h.school_id, h.team_code, h.player_id, h.match_id, h.kind, h.withdrawn_by,
       jsonb_strip_nulls(jsonb_build_object('name', h.name, 'withdrawnKind', h.withdrawn_kind))
  FROM honour h
 WHERE h.withdrawn_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM recognition_audit x WHERE x.honour_id = h.id AND x.event = 'withdrawn');

-- audit_log() (db/136), with the kind and its arm (marked db/142).
SELECT pg_temp._v142_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
$n$'support', 'role', 'duty']$n$,
$r$'support', 'role', 'duty', 'recognition']$r$, 1);
SELECT pg_temp._v142_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
$n$        UNION ALL
        -- duty_suspension: a match duty paused and lifted. The office's only.$n$,
$r$        UNION ALL
        -- recognition_audit (db/142): an honour awarded, withdrawn, or put on
        -- or taken off the public board, and by whom. Never why (D4).
        SELECT rx.at, 'recognition',
               CASE rx.event
                 WHEN 'awarded'   THEN 'Awarded ' || honour_kind_label(rx.kind, rx.detail->>'name')
                 WHEN 'withdrawn' THEN 'Withdrew ' || honour_kind_label(rx.kind, rx.detail->>'name')
                                       || CASE WHEN rx.detail->>'withdrawnKind' = 'correction' THEN ' after a correction' ELSE '' END
                 WHEN 'made_public' THEN 'Put an honour on the public board: ' || honour_kind_label(rx.kind, rx.detail->>'name')
                 ELSE 'Took an honour off the public board: ' || honour_kind_label(rx.kind, rx.detail->>'name') END,
               rx.actor_id, rx.player_id, NULL, rx.match_id, NULL, NULL, NULL, rx.school_id,
               jsonb_strip_nulls(jsonb_build_object('event', rx.event, 'honourKind', rx.kind, 'team', rx.team_code,
                                                    'withdrawnKind', rx.detail->'withdrawnKind')),
               'recognition:' || rx.id::text
          FROM recognition_audit rx
         WHERE 'recognition' = ANY (v_kinds) AND rx.school_id = p_school
           AND app_can('audit.read', rx.school_id, rx.team_code, NULL, rx.match_id)
        UNION ALL
        -- duty_suspension: a match duty paused and lifted. The office's only.$r$, 1);


-- ══════════════════════════════════════════════════════════════════
--  7 · The doors
-- ══════════════════════════════════════════════════════════════════
-- What the staff sheet reads: one row for each side of the match the caller
-- may decide for, with its standing award if any. Nothing for anybody else:
-- everybody else reads the honour where they read honours.
CREATE OR REPLACE FUNCTION match_award_state(p_match uuid)
RETURNS TABLE (side text, school_id uuid, team_code text, side_label text, opponent_label text, heading text,
               verified boolean, head_seq integer, can_award boolean, refusal text,
               honour_id uuid, player_id uuid, player_name text, awarded_at timestamptz, decided_by_name text,
               can_withdraw boolean, conflicts uuid[], instead text) AS $$
DECLARE
  m match%ROWTYPE;
  v_me uuid := app_user_id();
  v_verified boolean;
  v_season uuid;
  s record;
  h honour%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  IF NOT FOUND OR v_me IS NULL THEN RETURN; END IF;
  v_verified := match_verified(p_match);
  v_season := (SELECT f.id FROM season_for((m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date, 'school') f);
  FOR s IN SELECT * FROM (VALUES ('home', m.school_id, m.team_code), ('away', m.away_school_id, m.away_team_code)) x(side, school, team)
            WHERE match_award_holds(x.school, x.team, p_match) LOOP
    SELECT * INTO h FROM honour y
     WHERE y.match_id = p_match AND y.school_id = s.school AND y.team_code = s.team
       AND y.kind = 'player_of_match' AND y.withdrawn_at IS NULL;
    side := s.side; school_id := s.school; team_code := s.team;
    side_label := coalesce(fixture_side_label(s.school, s.team), s.team);
    opponent_label := match_award_opponent(p_match, s.side);
    heading := match_award_heading(p_match, s.side);
    verified := v_verified;
    head_seq := match_head_seq(p_match);
    refusal := CASE WHEN h.id IS NOT NULL THEN 'already_awarded'
                    WHEN NOT v_verified THEN 'not_verified'
                    WHEN v_season IS NULL THEN 'no_season' END;
    can_award := refusal IS NULL;
    honour_id := h.id; player_id := h.player_id;
    player_name := (SELECT p.full_name FROM player p WHERE p.id = h.player_id);
    awarded_at := h.awarded_at;
    decided_by_name := (SELECT u.name FROM app_user u WHERE u.id = h.decided_by);
    can_withdraw := h.id IS NOT NULL AND NOT match_award_guardian_of(v_me, h.player_id);
    conflicts := (SELECT coalesce(array_agg(q.player_id ORDER BY q.player_id), '{}'::uuid[]) FROM match_squad q
                   WHERE q.match_id = p_match AND q.side = s.side AND NOT q.withdrawn
                     AND match_award_guardian_of(v_me, q.player_id));
    instead := match_award_instead(v_me, s.school);
    RETURN NEXT;
  END LOOP;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Award it (D18). p_derived is the application's working (R1's suggestions,
-- the awardee's figures and the head they were read at); the head and the
-- result hash it stores are this function's.
--   not_permitted · not_on_sheet · cannot_award_yourself · guardian_conflict
--   (detail: directorofsport | principal) · not_verified · already_awarded
--   · no_season · stale (the log moved since the suggestions were read) ·
--   derived_from_invalid
CREATE OR REPLACE FUNCTION match_award(p_match uuid, p_player uuid, p_derived jsonb)
RETURNS TABLE (ok boolean, reason text, detail text, honour_id uuid) AS $$
DECLARE
  m match%ROWTYPE;
  v_me uuid := app_user_id();
  v_side text; v_school uuid; v_team text; v_season uuid; v_head integer; v_hash text;
  v_id uuid; v_name text; x jsonb;
BEGIN
  SELECT * INTO m FROM match y WHERE y.id = p_match;
  IF NOT FOUND OR v_me IS NULL
     OR NOT (match_award_holds(m.school_id, m.team_code, p_match) OR match_award_holds(m.away_school_id, m.away_team_code, p_match)) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  v_side := match_award_side_of(p_match, p_player);
  IF v_side = 'home' THEN v_school := m.school_id; v_team := m.team_code;
  ELSIF v_side = 'away' THEN v_school := m.away_school_id; v_team := m.away_team_code; END IF;
  IF v_side IS NULL OR v_school IS NULL OR NOT EXISTS (SELECT 1 FROM player p WHERE p.id = p_player AND p.school_id = v_school) THEN
    RETURN QUERY SELECT false, 'not_on_sheet'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  -- A coach of the other side may not decide this one.
  IF NOT match_award_holds(v_school, v_team, p_match) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM app_user u WHERE u.id = v_me AND u.player_id = p_player)
     OR EXISTS (SELECT 1 FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
                 WHERE a.person_id = v_me AND a.active AND g.player_id = p_player AND g.relationship = 'self') THEN
    RETURN QUERY SELECT false, 'cannot_award_yourself'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF match_award_guardian_of(v_me, p_player) THEN
    RETURN QUERY SELECT false, 'guardian_conflict'::text, match_award_instead(v_me, v_school), NULL::uuid; RETURN;
  END IF;
  IF NOT match_verified(p_match) THEN
    RETURN QUERY SELECT false, 'not_verified'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  -- One decision at a time for a match.
  PERFORM 1 FROM match y WHERE y.id = p_match FOR UPDATE;
  IF EXISTS (SELECT 1 FROM honour y WHERE y.match_id = p_match AND y.school_id = v_school AND y.team_code = v_team
                AND y.kind = 'player_of_match' AND y.withdrawn_at IS NULL) THEN
    RETURN QUERY SELECT false, 'already_awarded'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  v_season := (SELECT f.id FROM season_for((m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date, 'school') f);
  IF v_season IS NULL THEN
    RETURN QUERY SELECT false, 'no_season'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  -- The working, as the application read it: the basis, the head, two or
  -- three suggestions from this side's sheet, and the awardee's figures.
  v_head := match_head_seq(p_match);
  IF jsonb_typeof(p_derived) IS DISTINCT FROM 'object' OR pg_column_size(p_derived) > 4096
     OR p_derived->>'basis' IS DISTINCT FROM 'batting_bowling'
     OR jsonb_typeof(p_derived->'headSeq') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_derived->'suggestions') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_derived->'suggestions') > 3
     OR p_derived->'awardee'->>'playerId' IS DISTINCT FROM p_player::text
     OR jsonb_typeof(p_derived->'awardee'->'figures') IS DISTINCT FROM 'string' THEN
    RETURN QUERY SELECT false, 'derived_from_invalid'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  FOR x IN SELECT e FROM jsonb_array_elements(p_derived->'suggestions') e LOOP
    IF jsonb_typeof(x->'figures') IS DISTINCT FROM 'string' OR length(x->>'figures') > 80
       OR (x->>'playerId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR match_award_side_of(p_match, (x->>'playerId')::uuid) IS DISTINCT FROM v_side THEN
      RETURN QUERY SELECT false, 'derived_from_invalid'::text, NULL::text, NULL::uuid; RETURN;
    END IF;
  END LOOP;
  IF (p_derived->>'headSeq')::numeric <> v_head THEN
    RETURN QUERY SELECT false, 'stale'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  SELECT r.result_hash INTO v_hash FROM match_result_compute(p_match) r;
  v_name := left('v ' || match_award_opponent(p_match, v_side) || ' · '
                 || to_char(m.starts_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon YYYY'), 80);
  BEGIN
    INSERT INTO honour (player_id, kind, name, season_id, awarded_on, match_id, derived_from)
    VALUES (p_player, 'player_of_match', v_name, v_season, sa_today(), p_match,
            jsonb_build_object('version', 1, 'basis', 'batting_bowling',
                               'factsVersion', p_derived->'factsVersion',
                               'suggestions', p_derived->'suggestions', 'awardee', p_derived->'awardee',
                               'headSeq', v_head, 'resultHash', v_hash, 'side', v_side))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'already_awarded'::text, NULL::text, NULL::uuid; RETURN;
  END;
  RETURN QUERY SELECT true, NULL::text, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Withdraw it (D21), with its kind and a reason. The deciders of the side,
-- never a guardian of the boy; the office withdraws through the ordinary
-- route (recognition.manage, the table's own policy).
--   not_permitted · guardian_conflict · already_withdrawn · kind_invalid · reason_required
CREATE OR REPLACE FUNCTION match_award_withdraw(p_honour uuid, p_kind text, p_reason text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE h honour%ROWTYPE; v_me uuid := app_user_id();
BEGIN
  SELECT * INTO h FROM honour y WHERE y.id = p_honour AND y.kind = 'player_of_match' FOR UPDATE;
  IF NOT FOUND OR v_me IS NULL OR NOT match_award_holds(h.school_id, h.team_code, h.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::text; RETURN;
  END IF;
  IF match_award_guardian_of(v_me, h.player_id) THEN
    RETURN QUERY SELECT false, 'guardian_conflict'::text, match_award_instead(v_me, h.school_id); RETURN;
  END IF;
  IF h.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_withdrawn'::text, NULL::text; RETURN;
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('correction', 'other') THEN
    RETURN QUERY SELECT false, 'kind_invalid'::text, NULL::text; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 200 THEN
    RETURN QUERY SELECT false, 'reason_required'::text, NULL::text; RETURN;
  END IF;
  UPDATE honour SET withdrawn_at = now(), withdrawn_reason = btrim(p_reason), withdrawn_kind = p_kind WHERE id = h.id;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
--  8 · Who may call what
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  -- The doors: the application's alone.
  FOREACH f IN ARRAY ARRAY['match_award_state(uuid)', 'match_award(uuid,uuid,jsonb)', 'match_award_withdraw(uuid,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  -- The system's own: nobody's to call.
  FOREACH f IN ARRAY ARRAY['match_award_holds(uuid,text,uuid)', 'match_award_guardian_of(uuid,uuid)',
                           'match_award_instead(uuid,uuid)', 'match_award_side_of(uuid,uuid)',
                           'match_award_opponent(uuid,text)', 'match_award_heading(uuid,text)',
                           'match_award_short(text)',
                           'honour_tell_side()', 'honour_unsay_side()', 'honour_audit()',
                           'match_award_take_back(uuid)', 'recognition_audit_append_only()'] LOOP
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
      EXECUTE format('REVOKE ALL ON recognition_audit FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
--  What this file promised, checked in the same paste
-- ══════════════════════════════════════════════════════════════════
-- The behaviour is asserted live in db/99 §120.
DO $check$
DECLARE f text; r text; v_md5 text; v_src text;
BEGIN
  FOR f, v_md5 IN SELECT * FROM (VALUES
      ('honour_stamp()',               '4d23d2abe5b6a93970590b2cdf413933'),
      ('honour_kind_label(text,text)', '1456d2e848e00cb3277e356dc4958178'),
      ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)', '5e47b7126f7d31e45a3407cbebbb33a2')) x(fn, md5) LOOP
    IF pg_temp._v142_fold((SELECT prosrc FROM pg_proc WHERE oid = f::regprocedure)) <> v_md5 THEN
      RAISE EXCEPTION 'db/142: % is not this file''s after the paste (md5 %)', f,
        pg_temp._v142_fold((SELECT prosrc FROM pg_proc WHERE oid = f::regprocedure));
    END IF;
  END LOOP;
  -- The capability and its three holders, and not the owner's key (D7).
  IF NOT EXISTS (SELECT 1 FROM capability WHERE name = 'recognition.match.award')
     OR (SELECT string_agg(role, ',' ORDER BY role) FROM role_capability WHERE capability = 'recognition.match.award')
        IS DISTINCT FROM 'coach,directorofsport,principal' THEN
    RAISE EXCEPTION 'db/142: recognition.match.award is not held by the coach, the director of sport and the principal alone';
  END IF;
  -- Definers, pinned; no reading of the database's day (db/128).
  FOREACH f IN ARRAY ARRAY['honour_stamp()', 'match_award_holds(uuid,text,uuid)', 'match_award_guardian_of(uuid,uuid)',
                           'match_award_instead(uuid,uuid)', 'match_award_side_of(uuid,uuid)',
                           'match_award_opponent(uuid,text)', 'match_award_heading(uuid,text)',
                           'honour_tell_side()', 'honour_unsay_side()', 'honour_audit()', 'match_award_take_back(uuid)',
                           'match_award_state(uuid)', 'match_award(uuid,uuid,jsonb)', 'match_award_withdraw(uuid,text,text)'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/142: % is not a definer', f;
    END IF;
    IF NOT ('search_path=pg_catalog, public, pg_temp' = ANY (coalesce((SELECT proconfig FROM pg_proc WHERE oid = f::regprocedure), '{}'))) THEN
      RAISE EXCEPTION 'db/142: % does not pin its search_path', f;
    END IF;
    IF v_src ~* '\mcurrent_date\M' THEN
      RAISE EXCEPTION 'db/142: % reads the database''s day (db/128)', f;
    END IF;
  END LOOP;
  -- The doors: the application's, and no managed host's API role's.
  FOREACH f IN ARRAY ARRAY['match_award_state(uuid)', 'match_award(uuid,uuid,jsonb)', 'match_award_withdraw(uuid,text,text)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/142: % is not the application''s alone', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['match_award_holds(uuid,text,uuid)', 'match_award_guardian_of(uuid,uuid)',
                           'match_award_instead(uuid,uuid)', 'match_award_side_of(uuid,uuid)',
                           'match_award_opponent(uuid,text)', 'match_award_heading(uuid,text)', 'match_award_short(text)',
                           'honour_tell_side()', 'honour_unsay_side()', 'honour_audit()', 'match_award_take_back(uuid)',
                           'recognition_audit_append_only()'] LOOP
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/142: % is callable by the application or PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles ro, pg_proc p
                WHERE ro.rolname = r AND p.proname LIKE 'match_award%' AND p.pronamespace = 'public'::regnamespace
                  AND has_function_privilege(ro.oid, p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/142: a match_award function is executable by a managed host''s API role (%)', r;
    END IF;
  END LOOP;
  -- The audit is nobody's but its owner's.
  IF has_table_privilege('scrbrd_app', 'recognition_audit', 'SELECT') OR has_table_privilege('scrbrd_app', 'recognition_audit', 'INSERT')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'recognition_audit'::regclass) THEN
    RAISE EXCEPTION 'db/142: recognition_audit is readable or writable by the application, or its RLS is off';
  END IF;
  -- The table's shape: the kind, the ties, the one standing award, the door.
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'honour'::regclass
        AND conname IN ('honour_kind_check', 'honour_withdrawn_kind_known', 'honour_withdrawal_has_kind', 'honour_match_award_is_tied')) <> 4
     OR position('player_of_match' IN (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                                        WHERE conrelid = 'honour'::regclass AND conname = 'honour_kind_check')) = 0 THEN
    RAISE EXCEPTION 'db/142: a constraint on honour is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'honour_match_award_once')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'honour_once_a_season' AND indexdef LIKE '%player_of_match%') THEN
    RAISE EXCEPTION 'db/142: the once-a-match or the once-a-season index is not this file''s';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'honour'::regclass AND polname = 'honour_match_award_door'
                    AND NOT polpermissive AND polcmd = 'a') THEN
    RAISE EXCEPTION 'db/142: honour_match_award_door is not a RESTRICTIVE INSERT policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'honour'::regclass AND polname = 'honour_no_platform_award'
                    AND NOT polpermissive AND polcmd = 'w') THEN
    RAISE EXCEPTION 'db/142: honour_no_platform_award is not a RESTRICTIVE UPDATE policy';
  END IF;
  -- D7: the owner's key holds no recognition.match.award.
  IF EXISTS (SELECT 1 FROM role_capability WHERE role = 'superadmin' AND capability = 'recognition.match.award') THEN
    RAISE EXCEPTION 'db/142: the owner''s key (superadmin) holds recognition.match.award';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'honour'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
        AND tgname IN ('honour_stamp', 'honour_tell_side', 'honour_unsay_side', 'honour_audit')) <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'recognition_audit'::regclass AND tgname = 'recognition_audit_append_only' AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'db/142: a trigger on honour or recognition_audit is missing or disabled';
  END IF;
  -- Every honour is on the audit, and every withdrawal says its kind.
  IF EXISTS (SELECT 1 FROM honour h WHERE NOT EXISTS (SELECT 1 FROM recognition_audit x WHERE x.honour_id = h.id AND x.event = 'awarded'))
     OR EXISTS (SELECT 1 FROM honour h WHERE h.withdrawn_at IS NOT NULL AND h.withdrawn_kind IS NULL) THEN
    RAISE EXCEPTION 'db/142: an honour is not on the recognition audit, or a withdrawal has no kind';
  END IF;
END $check$;

DROP FUNCTION pg_temp._v142_patch(text, text, text, integer);
DROP FUNCTION pg_temp._v142_fold(text);
