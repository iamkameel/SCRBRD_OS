-- ══════════════════════════════════════════════════════════════════
--  173 · A first date of birth: the office's when it makes a boy 18,
--        every first date recorded, the office's confirmation, and
--        "Coming of age"
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's decisions of 25 Nov 2026 (Build Board, 15:42 SAST),
-- all as recommended, before Westville's real pupils load:
--   * only the office writes a first date of birth that makes a boy 18; the
--     roster import holds such lines for the office's one tick;
--   * an ID number, first or not, is the office's to write;
--   * for the pilot the clock may make a boy 18, with "Coming of age" listing
--     each boy 60 days ahead for the office to confirm his date;
--   * the seeded test account's sign-in exemption ends, and so does its
--     `player` role.
-- Safe to run twice.
--
-- WHY. db/169 opens a boy's own sign-in at eighteen by the date on his
-- record, nobody asked; db/172 made a recorded date the office's to change.
-- A first date, written where there was none (a new boy, or a boy with no
-- date), decides the same thing, so it is the office's when it makes him 18
-- today. And a boy whose date nobody at the office wrote or confirmed is
-- listed for the office before the clock makes him 18.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   ~ player_born_checked() (db/172's BEFORE trigger on player), replaced
--       whole, only over db/172's body or this file's (folded md5, §0).
--       Two new rules, asked first, for every write made by or for a
--       signed-in person: logged in as scrbrd_app, directly or through any
--       door, or with a person signed in under any login (a pooler's, a SET
--       ROLE). db/172's own rules in the same function read the login the
--       same way from this file on:
--         born_needs_the_office       a first date (an INSERT with a date,
--             or none becoming a date) that makes him 18 today, from anyone
--             but the office of his school;
--         id_number_needs_the_office  a first ID number (an INSERT with one,
--             or none becoming one), from anyone but the office.
--       Both insufficient_privilege. The owner's own write (the SQL Editor, a
--       seed) is let through, as before, and recorded as 'owner'.
--       db/172's four rules stand as they were, after these.
--       And (Kameel, 26 Nov 2026, the re-dating design's Q8) an office person
--       who is his own guardian (player_born_own_child()) writes no first date
--       that makes him 18 (born_own_child), corrects no date and confirms none
--       (own_child): another office person does, or SCRBRD.
--   ~ player_born_correct() (db/172), replaced whole, guarded: refuses
--       own_child.
--   + player_id_number_change  one row each time an ID number is written
--       where there was none, changed or taken off: who, when, whether his
--       school's office. Never the number. RLS on, no policy, no privilege.
--   ~ player_born_record() (db/172's AFTER trigger), replaced whole, likewise
--       guarded, and the trigger fires AFTER INSERT too: a new boy written with
--       a date is one row, `was` empty, `how` capture, import or owner.
--   ~ player_born_change: `how` may be 'confirmed' (was = became: the office
--       has checked the date on record), and `by_office` says whether the
--       person who wrote the row was his school's office at that moment
--       (player_born_office()), not his own guardian, and, for an import, on
--       a line the office ticked (Kameel, 26 Nov 2026, Q1). Rows written
--       before this file read false.
--   + player_born_confirmed(player)  is the date on record one his school's
--       office wrote or confirmed, with no write to it since? Owner-only.
--   + player_born_confirm(player)  the office's "Confirm his date": (ok,
--       reason). not_permitted (not the office, or no such boy: one answer),
--       born_required (no date to confirm), ok 'unchanged' (already the
--       office's). Writes one 'confirmed' row.
--   + born_unconfirmed(school)  "Coming of age": the boys at the school who
--       are 18, or will be within 60 days, on a date no office person wrote
--       or confirmed. The office's alone; no row for anyone else.
--   ~ audit_log() names the two new kinds of row: "Confirmed a date of
--       birth", and "SCRBRD recorded a date of birth" for the owner's first
--       date. Patched by exact needle, over db/172's body or this file's.
--   ~ pupil_signin_carry_over() (db/169 §6), replaced whole, guarded: it
--       carries over only own links stamped before db/169 was first pasted on
--       this database (db/169's row in schema_migration). A link stamped since
--       was stamped by db/169's grant door, which stamps 'granted' only with a
--       yes in force, so it is never the school's yes with no form. With no
--       ledger row it carries nothing.
--   ~ pupil_signin_open() (db/169), replaced whole, guarded: no account is let
--       through by its id. An account holding a pupil's role that names no boy
--       is closed, the seeded test account included (Kameel, 20 Nov, A).
--   + pupil_signin_account(player)  Q3 (Kameel, 25 Nov 2026): before her
--       "Allow his own sign-in", a guardian reads what the account the office
--       recognised as him typed (its name and its year) and the day the office
--       recognised it. Those three and nothing else: never its email or its
--       own name. Only for her own live, verified, agreed link; nothing for
--       a pad, a support hour, a platform-wide key, a child's own account, or
--       a claim held for a safeguarding concern (pupil_claim_held(), db/168),
--       which reads as none so nothing tips anyone off.
--   ~ pupil_signin_after_yes() (db/169), replaced whole, guarded: for a claim
--       held for a safeguarding concern (db/168 B1) a yes does not enrol the
--       account (no `player` role is granted; the claim stays recognised) and
--       does not stamp his own link; it answers as if nothing waits (the yes
--       itself stands on record). A hold keeps an account and its claim from
--       being removed; it does not shut an account. One the office already
--       enrolled opens, like every boy's, on any yes in force (db/169's gate
--       reads the boy's yes, not the account's claim).
--   ~ pupil_signin_state() (db/169), replaced whole, guarded: `held` (his
--       account waits) is never true to his family for such a claim; the
--       office reads it as before.
--   ~ The seeded test account's live `player` assignment (app_user
--       88888888-0000-0000-0000-000000000001, spectator@example.invalid) is
--       ended: active = false, as db/77 and tools/sql/fix-player-without-team
--       .sql end one. Only that account, and only while it names no boy.
--
-- ── WHAT IS NOT HERE ───────────────────────────────────────────────
--   * A boy made 18 by the clock rather than by a write is not refused; he is
--     listed on "Coming of age" 60 days ahead (Kameel's Q2, for the pilot).
--   * What follows a correction (his links and stamps re-dated, the office's
--     follow-up list) is a later migration.
--   * The roster import's report and tick are services/api/io/import-api.mjs;
--     "Coming of age" is read and confirmed through services/api/write/
--     dob-capture-api.mjs.
--
-- Needs db/172 (player_born_change and its triggers), db/169 (the gate and
-- the carry-over), and audit_log() as db/172 left it. Takes a short lock on
-- player for its trigger.

DO $guard$
BEGIN
  IF to_regclass('player_born_change') IS NULL
     OR to_regprocedure('player_born_checked()') IS NULL OR to_regprocedure('player_born_record()') IS NULL
     OR to_regprocedure('player_born_office(uuid)') IS NULL OR to_regprocedure('majority_on(date)') IS NULL
     OR to_regprocedure('pupil_signin_open(uuid)') IS NULL OR to_regprocedure('pupil_signin_carry_over()') IS NULL
     OR to_regprocedure('pupil_signin_after_yes(uuid,text)') IS NULL OR to_regprocedure('pupil_signin_my_link(uuid)') IS NULL
     OR to_regprocedure('pupil_signin_child_account(uuid)') IS NULL OR to_regprocedure('pupil_claim_held(uuid)') IS NULL
     OR to_regprocedure('lift_cuts_ok(uuid)') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('sa_date(timestamptz)') IS NULL OR to_regclass('pupil_claim') IS NULL
     OR to_regprocedure('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'db/173: db/172 (player_born_change, its triggers), db/169 (the gate, the carry-over, the yes) or db/168 (the claim) is missing; apply them first';
  END IF;
END $guard$;

SET lock_timeout = '10s';


-- ── 0 · What this file replaces is what it expects ─────────────────
-- Each function replaced whole is the one its file shipped, or this file's
-- own (a second paste). The folded md5, as db/172 folds audit_log().
CREATE OR REPLACE FUNCTION pg_temp._v173_fold(p_fn text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g')) FROM pg_proc p WHERE p.oid = to_regprocedure(p_fn)
$$ LANGUAGE sql STABLE;
DROP TABLE IF EXISTS pg_temp._v173_bodies;
CREATE TEMP TABLE _v173_bodies (fn text PRIMARY KEY, shipped text, mine text, file text);
INSERT INTO _v173_bodies VALUES
  ('player_born_checked()',     '4214f377cb5bdeade6c1c13ef06a2955', 'c850e92291bc7f809e52e2630c422c85', 'db/172'),
  ('player_born_record()',      'd2e91ecba68ca5f7529024903431b250', '9ba26159d30af8fd6d1cdbeb1ebe70aa', 'db/172'),
  ('pupil_signin_carry_over()', '9aa438021d787f69337360a57554b5ff', 'a83fd786dea8ab57e4d9a83d96c11eb3', 'db/169'),
  ('pupil_signin_open(uuid)',   '8fb155c9ca0bcc28ee7d2436f4f69675', '9f48a4d15b197910c45640601d96c889', 'db/169'),
  ('pupil_signin_after_yes(uuid,text)', '605c5b3a4c0139b7089f64973ccf51ba', '9af7035afb366ee70ff3c122e8b0789f', 'db/169'),
  ('pupil_signin_state(uuid)',  '1fae83e1510ed44e67f5e29cc2f82932', 'a6ab3bfe6f7f1d14d2f2ef726505d67d', 'db/169'),
  ('player_born_correct(uuid,date,text)', 'a40e796fdc611dd18dc662bd2d1a6871', 'a0158aea9702893c476b11e60323a2dd', 'db/172'),
  ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                                '25f7df23628e41c73c4e9575e8eb37a3', '5323dd10910de37e623e80302ea9cf93','db/172');
DO $bodies$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM _v173_bodies LOOP
    v := pg_temp._v173_fold(r.fn);
    IF v IS NULL OR v NOT IN (r.shipped, r.mine) THEN
      RAISE EXCEPTION 'db/173: % is neither %''s nor this file''s (md5 % of its folded body); look before replacing it',
        r.fn, r.file, v;
    END IF;
  END LOOP;
END $bodies$;


-- ── 1 · The record: a confirmation, and who was the office ─────────
ALTER TABLE player_born_change ADD COLUMN IF NOT EXISTS by_office boolean NOT NULL DEFAULT false;
-- db/172's own CHECKs, by the names Postgres gave them, become named ones
-- that know a confirmation: the date on record, checked, not changed.
ALTER TABLE player_born_change DROP CONSTRAINT IF EXISTS player_born_change_how_check;
ALTER TABLE player_born_change DROP CONSTRAINT IF EXISTS player_born_change_check;
ALTER TABLE player_born_change DROP CONSTRAINT IF EXISTS player_born_change_how;
ALTER TABLE player_born_change ADD CONSTRAINT player_born_change_how
  CHECK (how IN ('capture', 'correction', 'import', 'owner', 'confirmed'));
ALTER TABLE player_born_change DROP CONSTRAINT IF EXISTS player_born_change_moved;
ALTER TABLE player_born_change ADD CONSTRAINT player_born_change_moved
  CHECK (CASE WHEN how = 'confirmed' THEN was IS NOT NULL AND was = became AND by_office
              ELSE was IS DISTINCT FROM became END);


-- ── 1b · Is the caller his own guardian? ───────────────────────────
-- A live link of the caller's own to the boy, as a guardian (not his own
-- self link): pending or verified, on an active assignment, not ended. The
-- re-dating design's Q8 (Kameel, 25 and 26 Nov 2026).
CREATE OR REPLACE FUNCTION player_born_own_child(p_player uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM role_assignment a JOIN assignment_subject s ON s.assignment_id = a.id
     WHERE a.person_id = app_user_id() AND a.role = 'guardian' AND s.player_id = p_player
       AND s.relationship IS DISTINCT FROM 'self' AND a.active
       AND s.verification_state IN ('pending', 'verified')
       AND (a.valid_until IS NULL OR a.valid_until > sa_today())
       AND (s.valid_until IS NULL OR s.valid_until > sa_today()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_own_child(uuid) FROM PUBLIC;
-- The trigger asks it as the writer; it answers only about the caller.
GRANT EXECUTE ON FUNCTION player_born_own_child(uuid) TO scrbrd_app;


-- ── 2 · The check, as the writer ───────────────────────────────────
-- SECURITY INVOKER, as db/172 made it: current_user is the role that wrote.
CREATE OR REPLACE FUNCTION player_born_checked() RETURNS trigger AS $$
DECLARE
  v_from_id date;
  -- The application wrote this: as itself, or through a door (a definer runs
  -- as the owner, so current_user alone would not say; the login role does,
  -- and no definer changes it); or anyone at all with a person signed in, so
  -- the rules hold however the application logs in (a pooler's own login, a
  -- SET ROLE). Only the owner's own write, no one signed in, is none of these.
  v_app boolean := current_user = 'scrbrd_app' OR session_user = 'scrbrd_app' OR app_user_id() IS NOT NULL;
  -- The school whose record it is: OLD's, as db/172's office rule reads it.
  v_school uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.school_id ELSE OLD.school_id END;
BEGIN
  -- db/173 (Kameel, 25 Nov 2026): a first date that makes him 18 today is
  -- the office's to write. Asked before the ID number is read, so the answer
  -- is the same whatever is on file.
  IF v_app AND NEW.born IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.born IS NULL)
     AND majority_on(NEW.born) <= sa_today() AND NOT coalesce(player_born_office(v_school), false) THEN
    RAISE EXCEPTION 'born_needs_the_office'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only the school office may record a date of birth that makes him 18.';
  END IF;
  -- db/173: an ID number, first or not, is the office's to write (a change
  -- to one on file is db/172's rule below).
  IF v_app AND NEW.id_number IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.id_number IS NULL)
     AND NOT coalesce(player_born_office(v_school), false) THEN
    RAISE EXCEPTION 'id_number_needs_the_office'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only the school office may record an ID number.';
  END IF;
  -- Kameel, 26 Nov 2026 (the re-dating design's Q8): an office person who is
  -- his own guardian does not write a first date that makes him 18; another
  -- office person does, or SCRBRD.
  IF v_app AND NEW.born IS NOT NULL AND TG_OP = 'UPDATE' AND OLD.born IS NULL
     AND majority_on(NEW.born) <= sa_today() AND player_born_own_child(NEW.id) THEN
    RAISE EXCEPTION 'born_own_child'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Another person at the school office records a date of birth for your own child.';
  END IF;
  -- db/172's rules, as it wrote them. The owner's own write, no one signed
  -- in, is the one let through.
  IF NEW.born IS NOT NULL AND NEW.id_number IS NOT NULL
     AND (app_user_id() IS NOT NULL OR v_app)
     AND (TG_OP = 'INSERT' OR NEW.born IS DISTINCT FROM OLD.born OR NEW.id_number IS DISTINCT FROM OLD.id_number) THEN
    v_from_id := sa_id_born(NEW.id_number);
    -- An unreadable number carries no date to disagree with (the JS's
    -- bornAgreesWithSaId(): unreadable, not checked); the doors refuse it.
    IF v_from_id IS NOT NULL AND v_from_id <> NEW.born THEN
      RAISE EXCEPTION 'id_number_disagrees_with_date_of_birth'
        USING ERRCODE = 'check_violation',
              HINT = 'The ID number carries a different date of birth to the one given.';
    END IF;
  END IF;
  -- The office rule, for the date and for the number: the school whose
  -- record it was (OLD) decides.
  IF TG_OP = 'UPDATE' AND OLD.born IS NOT NULL AND NEW.born IS DISTINCT FROM OLD.born
     AND v_app AND NOT player_born_office(OLD.school_id) THEN
    RAISE EXCEPTION 'born_correction_is_the_office'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only the school office may change a date of birth already on record.';
  END IF;
  -- A correction the application makes carries its reason, which only the
  -- door sets (app.born_reason, for its one UPDATE). A reason is words.
  IF TG_OP = 'UPDATE' AND OLD.born IS NOT NULL AND NEW.born IS DISTINCT FROM OLD.born AND v_app
     AND coalesce(current_setting('app.born_reason', true), '') !~ '[[:alnum:]]' THEN
    RAISE EXCEPTION 'born_correction_needs_a_reason'
      USING ERRCODE = 'check_violation',
            HINT = 'A date of birth on record is corrected through player_born_correct(), with its reason.';
  END IF;
  -- An ID number on file is the office's to change.
  IF TG_OP = 'UPDATE' AND OLD.id_number IS NOT NULL AND NEW.id_number IS DISTINCT FROM OLD.id_number
     AND v_app AND NOT player_born_office(OLD.school_id) THEN
    RAISE EXCEPTION 'id_number_change_is_the_office'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only the school office may change an ID number already on record.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_checked() FROM PUBLIC;
-- The trigger itself is db/172's, unchanged (BEFORE INSERT OR UPDATE OF born, id_number).


-- ── 3 · The record, as the owner: first dates too ──────────────────
-- How: no one signed in is the owner; the import says so for its own
-- transaction (app.born_how = 'import', a label and never an authority); a
-- date where there was none, a new boy's included, is a capture; any other
-- change is a correction. by_office: was the writer his school's office (and
-- not his own guardian), for an import only on a line the office ticked.
CREATE OR REPLACE FUNCTION player_born_record() RETURNS trigger AS $$
DECLARE v_me uuid := app_user_id(); v_how text; v_was date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.born IS NULL THEN RETURN NULL; END IF;
  ELSE
    IF NEW.born IS NOT DISTINCT FROM OLD.born THEN RETURN NULL; END IF;
    v_was := OLD.born;
  END IF;
  v_how := CASE WHEN v_me IS NULL THEN 'owner'
                WHEN current_setting('app.born_how', true) = 'import' THEN 'import'
                WHEN v_was IS NULL THEN 'capture'
                ELSE 'correction' END;
  -- A correction's reason is the door's (app.born_reason, set for its one
  -- UPDATE); the check refuses an application correction without one.
  INSERT INTO player_born_change (player_id, school_id, was, became, how, by_id, by_name, reason, by_office)
  VALUES (NEW.id, NEW.school_id, v_was, NEW.born, v_how,
          v_me, CASE WHEN v_me IS NOT NULL THEN audit_person_label(v_me) END,
          CASE WHEN v_how = 'correction' THEN nullif(current_setting('app.born_reason', true), '') END,
          -- His school's office, and not his own guardian (Q8); an import's
          -- line only under the office's tick (Kameel, 26 Nov 2026, Q1:
          -- app.born_ticked, set by the import for that line alone).
          v_me IS NOT NULL AND coalesce(player_born_office(NEW.school_id), false) AND NOT player_born_own_child(NEW.id)
          AND (v_how <> 'import' OR coalesce(current_setting('app.born_ticked', true), '') = 'on'));
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_record() FROM PUBLIC;

DROP TRIGGER IF EXISTS player_born_changes_are_recorded ON player;
CREATE TRIGGER player_born_changes_are_recorded
  AFTER INSERT OR UPDATE OF born ON player
  FOR EACH ROW EXECUTE FUNCTION player_born_record();


-- ── 3b · An ID number written: who, when, the office or not ────────
-- Kameel, 25 Nov 2026: an ID number, first or not, is the office's to write.
-- One row each time one is written where there was none, changed, or taken
-- off: the boy, his school, how, who (his label as it was), whether he was
-- his school's office, when. Never the number itself. RLS on, no policy, no
-- privilege: written by the trigger alone. A row goes with its boy.
CREATE TABLE IF NOT EXISTS player_id_number_change (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  school_id  uuid,
  how        text NOT NULL CONSTRAINT player_id_number_change_how CHECK (how IN ('first', 'changed', 'removed')),
  by_id      uuid,
  by_name    text,
  by_office  boolean NOT NULL DEFAULT false,
  at         timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS player_id_number_change_player ON player_id_number_change (player_id, at);
ALTER TABLE player_id_number_change ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_id_number_change FROM PUBLIC;
REVOKE ALL ON player_id_number_change FROM scrbrd_app;

CREATE OR REPLACE FUNCTION player_id_number_record() RETURNS trigger AS $$
DECLARE v_me uuid := app_user_id(); v_how text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.id_number IS NULL THEN RETURN NULL; END IF;
    v_how := 'first';
  ELSE
    IF NEW.id_number IS NOT DISTINCT FROM OLD.id_number THEN RETURN NULL; END IF;
    v_how := CASE WHEN OLD.id_number IS NULL THEN 'first' WHEN NEW.id_number IS NULL THEN 'removed' ELSE 'changed' END;
  END IF;
  INSERT INTO player_id_number_change (player_id, school_id, how, by_id, by_name, by_office)
  VALUES (NEW.id, NEW.school_id, v_how, v_me, CASE WHEN v_me IS NOT NULL THEN audit_person_label(v_me) END,
          v_me IS NOT NULL AND coalesce(player_born_office(NEW.school_id), false));
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_id_number_record() FROM PUBLIC;

DROP TRIGGER IF EXISTS player_id_numbers_are_recorded ON player;
CREATE TRIGGER player_id_numbers_are_recorded
  AFTER INSERT OR UPDATE OF id_number ON player
  FOR EACH ROW EXECUTE FUNCTION player_id_number_record();


-- ── 4 · Is his date the office's? ──────────────────────────────────
-- The date on record now was written, or confirmed, by his school's office,
-- and nothing has written it since. A date with no row (written before
-- db/173 by INSERT, or with the record switched off) is nobody's.
CREATE OR REPLACE FUNCTION player_born_confirmed(p_player uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM player p
      JOIN player_born_change c ON c.player_id = p.id
     WHERE p.id = p_player AND p.born IS NOT NULL
       AND c.by_office AND c.became = p.born AND c.school_id IS NOT DISTINCT FROM p.school_id
       AND NOT EXISTS (SELECT 1 FROM player_born_change w
                        WHERE w.player_id = p.id AND w.how <> 'confirmed' AND w.at > c.at))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_confirmed(uuid) FROM PUBLIC;


-- ── 5 · The office's "Confirm his date" ────────────────────────────
CREATE OR REPLACE FUNCTION player_born_confirm(p_player uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE p record; v_me uuid := app_user_id();
BEGIN
  -- Who is asking first, and only then the lock: one answer for "not yours"
  -- and "no such boy".
  IF NOT coalesce(player_born_office((SELECT x.school_id FROM player x WHERE x.id = p_player)), false) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  SELECT x.id, x.school_id, x.born INTO p FROM player x WHERE x.id = p_player FOR UPDATE;
  IF NOT FOUND OR NOT player_born_office(p.school_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF p.born IS NULL THEN
    RETURN QUERY SELECT false, 'born_required'::text; RETURN;
  END IF;
  -- Q8 (Kameel, 26 Nov 2026): not his own guardian.
  IF player_born_own_child(p_player) THEN
    RETURN QUERY SELECT false, 'own_child'::text; RETURN;
  END IF;
  IF player_born_confirmed(p_player) THEN
    RETURN QUERY SELECT true, 'unchanged'::text; RETURN;
  END IF;
  INSERT INTO player_born_change (player_id, school_id, was, became, how, by_id, by_name, by_office)
  VALUES (p.id, p.school_id, p.born, p.born, 'confirmed', v_me, audit_person_label(v_me), true);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_confirm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_born_confirm(uuid) TO scrbrd_app;


-- ── 5b · The office's correction, not of his own child ─────────────
-- db/172's door, with one refusal more (Q8).
CREATE OR REPLACE FUNCTION player_born_correct(p_player uuid, p_born date, p_reason text)
RETURNS TABLE (ok boolean, reason text, was date, born date) AS $$
#variable_conflict use_column
-- Trimmed of every kind of space, as the route's trim() trims it.
DECLARE p record; v_from_id date; v_why text := regexp_replace(p_reason, '^\s+|\s+$', '', 'g');
BEGIN
  -- Who is asking first, and only then the lock (review N2): a caller who
  -- is not the office holds no row of anybody's.
  IF NOT player_born_office((SELECT x.school_id FROM player x WHERE x.id = p_player)) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::date, NULL::date; RETURN;
  END IF;
  SELECT x.id, x.school_id, x.born, x.id_number INTO p FROM player x WHERE x.id = p_player FOR UPDATE;
  IF NOT FOUND OR NOT player_born_office(p.school_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::date, NULL::date; RETURN;
  END IF;
  IF p_born IS NULL THEN
    RETURN QUERY SELECT false, 'born_required'::text, p.born, NULL::date; RETURN;
  END IF;
  -- db/173 (Q8, Kameel, 25 and 26 Nov 2026): an office person who is his own
  -- guardian does not correct his date; another office person does.
  IF player_born_own_child(p_player) THEN
    RETURN QUERY SELECT false, 'own_child'::text, p.born, NULL::date; RETURN;
  END IF;
  -- A reason is asked only of a correction (review B N8): filling a missing
  -- date is a capture, and asks for none. It is words: at least one letter
  -- or digit (review B N1).
  IF p.born IS NULL THEN
    v_why := NULL;
  ELSIF v_why IS NULL OR v_why !~ '[[:alnum:]]' THEN
    RETURN QUERY SELECT false, 'reason_required'::text, p.born, NULL::date; RETURN;
  END IF;
  IF char_length(v_why) > 200 THEN
    RETURN QUERY SELECT false, 'reason_too_long'::text, p.born, NULL::date; RETURN;
  END IF;
  IF p_born > sa_today() THEN
    RETURN QUERY SELECT false, 'born_in_future'::text, p.born, NULL::date; RETURN;
  END IF;
  IF p.born IS NOT DISTINCT FROM p_born THEN
    RETURN QUERY SELECT true, 'unchanged'::text, p.born, p.born; RETURN;
  END IF;
  v_from_id := CASE WHEN p.id_number IS NOT NULL THEN sa_id_born(p.id_number) END;
  IF v_from_id IS NOT NULL AND v_from_id <> p_born THEN
    RETURN QUERY SELECT false, 'id_number_disagrees_with_date_of_birth'::text, p.born, NULL::date; RETURN;
  END IF;
  PERFORM set_config('app.born_reason', coalesce(v_why, ''), true);
  UPDATE player x SET born = p_born WHERE x.id = p_player;
  PERFORM set_config('app.born_reason', '', true);
  RETURN QUERY SELECT true, NULL::text, p.born, p_born;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_correct(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_born_correct(uuid, date, text) TO scrbrd_app;


-- ── 6 · "Coming of age" ────────────────────────────────────────────
-- The boys at the school who are 18, or will be within 60 days, on a date no
-- office person wrote or confirmed: when, his side, and how the date on
-- record was last written. Soonest first. The office's alone.
CREATE OR REPLACE FUNCTION born_unconfirmed(p_school uuid)
RETURNS TABLE (player_id uuid, full_name text, team_code text, born date, of_age_on date, how text, written_at timestamptz) AS $$
  SELECT p.id, p.full_name, p.team_code, p.born, majority_on(p.born), w.how, w.at
    FROM player p
    LEFT JOIN LATERAL (SELECT c.how, c.at FROM player_born_change c
                        WHERE c.player_id = p.id AND c.how <> 'confirmed'
                        ORDER BY c.at DESC, c.id LIMIT 1) w ON true
   WHERE coalesce(player_born_office(p_school), false) AND p.school_id = p_school AND p.born IS NOT NULL
     AND majority_on(p.born) <= sa_today() + 60
     AND NOT player_born_confirmed(p.id)
   ORDER BY majority_on(p.born), p.full_name, p.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION born_unconfirmed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION born_unconfirmed(uuid) TO scrbrd_app;


-- ── 7 · The audit log names the new rows ───────────────────────────
-- By exact needle, as db/172 patched it, and only over db/172's body or this
-- file's (§0).
CREATE OR REPLACE FUNCTION pg_temp._v173_patch(p_fn text, p_needle text, p_repl text) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'db/173: % holds its needle % times, not once: look before replacing it', p_fn, v_n;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;
SELECT pg_temp._v173_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
  E'                           ELSE \'SCRBRD changed a date of birth\' END,',
  E'                           WHEN \'confirmed\'  THEN \'Confirmed a date of birth\'\n'
  || E'                           ELSE CASE WHEN bc.was IS NULL THEN \'SCRBRD recorded a date of birth\'\n'
  || E'                                     ELSE \'SCRBRD changed a date of birth\' END END,');
DROP FUNCTION pg_temp._v173_patch(text, text, text);


-- ── 8 · The carry-over: links stamped before db/169's first paste ──
-- When db/169 was first pasted here: its row in the ledger that
-- tools/migrate.mjs and the paste bundles write (applied_at, the start of
-- that paste's transaction). NULL where there is no such row.
CREATE OR REPLACE FUNCTION pupil_signin_first_paste() RETURNS timestamptz AS $$
DECLARE v timestamptz;
BEGIN
  IF to_regclass('public.schema_migration') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT applied_at FROM public.schema_migration WHERE name = $1' INTO v USING '169_pupil_signin_gate.sql';
  RETURN v;
EXCEPTION WHEN undefined_column THEN RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_first_paste() FROM PUBLIC;

-- db/169 §6, with one test more: the stamp is older than db/169's first
-- paste. Owner-only; answers how many boys it carried over.
CREATE OR REPLACE FUNCTION pupil_signin_carry_over() RETURNS integer AS $$
DECLARE n integer; v_before timestamptz := pupil_signin_first_paste();
BEGIN
  INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, terms_version, given_at, school_id)
  SELECT DISTINCT ON (g.player_id) g.player_id, 'yes', 'enrolled', g.verified_by, left(u.name, 200), g.consent_version,
         coalesce(g.consent_at, g.verified_at, g.created_at),
         -- The school that stamped it: his own record's assignment's.
         coalesce(a.school_id, p.school_id)
    FROM assignment_subject g
    JOIN role_assignment a ON a.id = g.assignment_id
    JOIN player p ON p.id = g.player_id
    LEFT JOIN app_user u ON u.id = g.verified_by
   WHERE g.relationship = 'self' AND g.verification_state = 'verified' AND g.consent_state = 'granted'
     AND a.active AND (g.valid_until IS NULL OR g.valid_until > sa_today())
     AND (p.born IS NULL OR majority_on(p.born) > sa_today())
     -- db/173: only a stamp from before db/169 was first pasted. One since
     -- is db/169's grant door's, which stamps 'granted' only with a yes in
     -- force; it is never carried over as the school's yes.
     AND coalesce(g.consent_at, g.verified_at, g.created_at) < v_before
     AND NOT EXISTS (SELECT 1 FROM pupil_signin_consent x WHERE x.player_id = g.player_id)
   ORDER BY g.player_id, g.consent_at NULLS LAST, g.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_carry_over() FROM PUBLIC;


-- ── 9 · The gate, with no account let through by its id ────────────
-- db/169's, less the seeded test account's exemption (S2).
CREATE OR REPLACE FUNCTION pupil_signin_open(p_account uuid) RETURNS boolean AS $$
DECLARE b uuid; v_any boolean := false;
BEGIN
  IF p_account IS NULL THEN RETURN true; END IF;
  FOR b IN SELECT u.player_id FROM app_user u WHERE u.id = p_account AND u.player_id IS NOT NULL
           UNION
           SELECT g.player_id FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
            WHERE a.person_id = p_account AND a.active AND g.relationship = 'self' LOOP
    v_any := true;
    IF NOT pupil_signin_in_force(b) THEN RETURN false; END IF;
  END LOOP;
  IF v_any THEN RETURN true; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM role_assignment a
                      WHERE a.person_id = p_account AND a.active AND a.role IN ('player', 'selfaccess')
                        AND (a.valid_until IS NULL OR a.valid_until > sa_today()));
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
   COST 500;
REVOKE ALL ON FUNCTION pupil_signin_open(uuid) FROM PUBLIC;


-- ── 9b · Q3: what the recognised account typed, for her yes ────────
-- Her own live, verified guardian link, agreed to the terms (as
-- pupil_signin_state() asks before it offers her the yes), and the account
-- her yes would open: the one recognised as him, still active, and not held
-- for a safeguarding concern. Its name and year as typed, and the day
-- (Johannesburg's) the school recognised it. Nothing else of the account.
CREATE OR REPLACE FUNCTION pupil_signin_account(p_player uuid)
RETURNS TABLE (typed_name text, typed_year text, recognised_on date) AS $$
DECLARE v_me uuid := app_user_id(); v_school uuid; l record;
BEGIN
  IF v_me IS NULL OR coalesce(app_pad_scoped(), false) OR pupil_signin_child_account(v_me) THEN RETURN; END IF;
  SELECT x.school_id INTO v_school FROM player x WHERE x.id = p_player;
  IF NOT FOUND OR NOT lift_cuts_ok(v_school) THEN RETURN; END IF;
  SELECT * INTO l FROM pupil_signin_my_link(p_player);
  IF l.link_id IS NULL OR NOT coalesce(l.agreed, false) THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.typed_name, c.typed_year, sa_date(c.known_at)
      FROM pupil_claim c JOIN app_user u ON u.id = c.user_id
     WHERE c.player_id = p_player AND c.state = 'recognised' AND u.active
       AND NOT pupil_claim_held(c.user_id);
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pupil_signin_account(uuid) TO scrbrd_app;

-- db/169's, with one test more: a held claim's account is not opened.
CREATE OR REPLACE FUNCTION pupil_signin_after_yes(p_player uuid, p_version text) RETURNS text AS $$
DECLARE c pupil_claim%ROWTYPE; v_user uuid; v_req uuid; v_ok boolean; v_why text; v_decider uuid;
BEGIN
  IF NOT pupil_signin_in_force(p_player) THEN RETURN 'not_in_force'; END IF;
  -- db/173: a claim held for a safeguarding concern is asked first: neither
  -- his own link's stamp nor his account moves on a yes.
  IF EXISTS (SELECT 1 FROM pupil_claim x WHERE x.player_id = p_player AND x.state = 'recognised'
                AND pupil_claim_held(x.user_id)) THEN
    RETURN NULL;
  END IF;
  UPDATE assignment_subject g
     SET consent_state = 'granted', consent_version = coalesce(p_version, pupil_signin_terms_version()), consent_at = now()
   WHERE g.player_id = p_player AND g.relationship = 'self'
     AND g.verification_state = 'verified' AND g.consent_state = 'pending'
     AND (g.valid_until IS NULL OR g.valid_until > sa_today());
  -- N14: the claim's own advisory lock first, as db/168's doors take it.
  SELECT x.user_id INTO v_user FROM pupil_claim x WHERE x.player_id = p_player AND x.state = 'recognised';
  -- db/173: the account of a claim held for a safeguarding concern is not
  -- opened by a yes; nothing waits, as far as anyone is told.
  IF v_user IS NULL OR pupil_claim_held(v_user) THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_claim:' || v_user::text, 163));
  SELECT * INTO c FROM pupil_claim x WHERE x.player_id = p_player AND x.state = 'recognised' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = c.user_id AND u.active) THEN RETURN 'account_shut'; END IF;
  IF pupil_signin_is_pupils(c.user_id) THEN
    -- Already enrolled by the office (today's path): the yes opened him.
    UPDATE pupil_claim SET state = 'open' WHERE id = c.id;
    RETURN NULL;
  END IF;
  v_decider := CASE WHEN pupil_claim_office(c.school_id) THEN app_user_id() ELSE coalesce(c.known_by, app_user_id()) END;
  BEGIN
    INSERT INTO role_request (person_id, role, school_id, player_id, note)
    VALUES (c.user_id, 'player', c.school_id, p_player, 'His own sign-in: a yes on record')
    RETURNING id INTO v_req;
    SELECT d.ok, d.reason INTO v_ok, v_why
      FROM role_request_grant_as(v_req, v_decider, 'His own sign-in: a yes on record', p_player, NULL) d;
    IF NOT coalesce(v_ok, false) THEN
      RAISE EXCEPTION 'pupil_signin_open_refused:%', coalesce(v_why, 'refused') USING ERRCODE = 'check_violation';
    END IF;
    UPDATE pupil_claim SET state = 'open' WHERE id = c.id;
  EXCEPTION WHEN check_violation OR unique_violation OR foreign_key_violation THEN
    RETURN coalesce(substring(SQLERRM FROM 'pupil_signin_open_refused:(.*)'), 'refused');
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_after_yes(uuid, text) FROM PUBLIC;

-- db/169's state read, with a held claim read as none by his family.
CREATE OR REPLACE FUNCTION pupil_signin_state(p_player uuid)
RETURNS TABLE (agreed boolean, in_force boolean, adult boolean, born_known boolean, yes_how text, yes_by text, yes_at timestamptz,
               form_signed_by text, form_signed_on date,
               yours boolean, can_allow boolean, can_stop boolean, held boolean, office boolean) AS $$
DECLARE v_me uuid := app_user_id(); p player%ROWTYPE; l record; v_office boolean; y pupil_signin_consent%ROWTYPE; v_enrolled boolean;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN RETURN; END IF;
  SELECT * INTO p FROM player x WHERE x.id = p_player;
  IF NOT FOUND OR NOT lift_cuts_ok(p.school_id) THEN RETURN; END IF;
  SELECT * INTO l FROM pupil_signin_my_link(p_player);
  v_office := pupil_claim_office(p.school_id);
  IF l.link_id IS NULL AND NOT v_office THEN RETURN; END IF;
  office := v_office;
  agreed := v_office OR coalesce(l.agreed, false);
  IF NOT agreed THEN
    yours := false; can_allow := false; can_stop := false;
    RETURN NEXT; RETURN;
  END IF;
  -- The yes that keeps him open: hers first, then the most recent.
  SELECT * INTO y FROM pupil_signin_consent c
   WHERE c.player_id = p_player AND c.answer = 'yes' AND pupil_signin_yes_stands(c.id)
   ORDER BY (c.how = 'guardian' AND c.given_by = v_me) DESC, c.seq DESC LIMIT 1;
  in_force := pupil_signin_in_force(p_player);
  adult := p.born IS NOT NULL AND majority_on(p.born) <= sa_today();
  born_known := p.born IS NOT NULL;
  yes_how := y.how;
  yours := coalesce(y.how = 'guardian' AND y.given_by = v_me, false);
  yes_by := CASE WHEN y.id IS NULL THEN NULL
                 WHEN yours THEN y.given_by_name
                 WHEN v_office THEN coalesce(y.given_by_name, 'the school office')
                 WHEN y.how = 'guardian' THEN 'the guardian'
                 ELSE 'the school office' END;
  yes_at := y.given_at;
  form_signed_by := CASE WHEN v_office THEN y.form_signed_by END;
  form_signed_on := y.form_signed_on;
  -- db/173: a claim held for a safeguarding concern reads as none to his
  -- family (Q3, Kameel, 25 Nov 2026); the office reads it as before.
  held := coalesce(in_force, false) AND EXISTS (SELECT 1 FROM pupil_claim c JOIN app_user u ON u.id = c.user_id
                                               WHERE c.player_id = p_player AND c.state = 'recognised' AND u.active
                                                 AND (v_office OR NOT pupil_claim_held(c.user_id)));
  v_enrolled := pupil_signin_enrolled_yes(p_player) IS NOT NULL;
  can_allow := l.link_id IS NOT NULL AND born_known AND NOT adult AND (NOT yours OR held)
               AND NOT pupil_signin_child_account(v_me);
  can_stop := l.link_id IS NOT NULL AND NOT adult AND (yours OR v_enrolled) AND NOT pupil_signin_child_account(v_me);
  RETURN NEXT;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pupil_signin_state(uuid) TO scrbrd_app;


-- ── 10 · The seeded test account's `player` role, ended ────────────
-- Ended, not deleted: the row, its dates and who made it stay on the record
-- (db/01 stamps revoked_at; revoked_by stays NULL, the schema's way of
-- saying no person at a screen did it). Only while it is the seeded test
-- account and names no boy; otherwise nothing is touched and the paste says
-- so (the gate above closes such an account in any case).
DO $test_account$
DECLARE n integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM app_user u WHERE u.id = '88888888-0000-0000-0000-000000000001'
                AND lower(u.email) = 'spectator@example.invalid' AND u.player_id IS NULL) THEN
    UPDATE role_assignment a SET active = false
     WHERE a.person_id = '88888888-0000-0000-0000-000000000001' AND a.role = 'player' AND a.active
       AND NOT EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id AND g.relationship = 'self');
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF EXISTS (SELECT 1 FROM app_user u WHERE u.id = '88888888-0000-0000-0000-000000000001') THEN
    RAISE NOTICE 'db/173: account 88888888-0000-0000-0000-000000000001 is not the seeded test account here; its roles are left as they are';
  END IF;
  RAISE NOTICE 'db/173: % live player assignment(s) of the seeded test account ended', n;
END $test_account$;


-- ── 11 · Each body is this file's now ──────────────────────────────
DO $after$
DECLARE r record; v text;
BEGIN
  -- The CHECKs on the record are the three named ones and no other: an old
  -- one under a name this file did not guess would refuse a confirmation.
  v := (SELECT string_agg(conname, ',' ORDER BY conname) FROM pg_constraint
         WHERE conrelid = 'player_born_change'::regclass AND contype = 'c');
  IF v IS DISTINCT FROM 'player_born_change_how,player_born_change_moved,player_born_change_reason' THEN
    RAISE EXCEPTION 'db/173: player_born_change carries the CHECKs %, not the three this file names; drop the stray one and paste again', v;
  END IF;
  FOR r IN SELECT * FROM _v173_bodies LOOP
    v := pg_temp._v173_fold(r.fn);
    IF v IS DISTINCT FROM r.mine THEN
      RAISE EXCEPTION 'db/173: % is not this file''s after the paste (md5 %)', r.fn, v;
    END IF;
  END LOOP;
END $after$;
DROP TABLE _v173_bodies;
DROP FUNCTION pg_temp._v173_fold(text);


-- ── 12 · The lock limit back as it was ─────────────────────────────
RESET lock_timeout;
