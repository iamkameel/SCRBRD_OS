-- ══════════════════════════════════════════════════════════════════
--  172 · A date of birth: the office corrects it, every change is
--        recorded, and it must agree with the ID number
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel, 20 Nov 2026: "The office corrects it; every change
-- is audited", with his note "Date of birth should be match with an ID No."
-- Safe to run twice.
--
-- WHY NOW. db/169 (Migration B) opens a boy's own sign-in at eighteen by the
-- date on his record (majority_on(player.born) <= sa_today()), nobody asked.
-- A wrong date was always wrong; after db/169 it opens or shuts a child's
-- account. Until this file a recorded date had three ways in and no record:
-- the Add Player form, the roster import's `born = coalesce($9, born)`,
-- which overwrote a recorded date in silence, and the owner in the SQL
-- Editor. And the ID number check (packages/policy/src/date-of-birth.mjs,
-- resolveBirthDate()) lived in JavaScript only, so it held at the doors
-- that called it and nowhere else: the capture route compared the typed
-- date with a typed ID number, never with the one already on file.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   + sa_id_born(id, on), sa_id_born(id)  the date of birth an SA ID number
--       carries, YYMMDD with the century chosen EXACTLY as
--       packages/policy/src/sa-id.mjs resolveCentury() chooses it: 20YY
--       first, then 19YY, skipping a year after this one and a year more
--       than 120 years ago, and a date that does not exist (31 April) is no
--       date. "This year" is the UTC calendar year, as resolveCentury()
--       reads it (getUTCFullYear()), so the two agree on every day of the
--       year. NULL when the number cannot be read (the JS's `unreadable`).
--       db/99 §147 (pin) and packages/policy/test/sa-id-sql-pin.test.mjs
--       read ONE list of numbers and answers, so the two cannot drift.
--   + player_born_change  one row per change to a recorded date of birth:
--       the boy, his school, the date before and after, who (the signed-in
--       person's id, and his name as it was), when, and how:
--         capture     a date where there was none (the capture route)
--         correction  a recorded date changed by the office's door
--         import      a date written by the roster import, filling one or
--                     changing one
--         owner       no one signed in: the owner, in the SQL Editor
--       RLS on, no policy, no privilege: written by the trigger alone and
--       read through player_born_changes(). A row goes with its boy (ON
--       DELETE CASCADE): it is his data, and an erasure takes it.
--   + trigger player_born_agrees_with_id (BEFORE INSERT OR UPDATE OF born,
--       id_number): a date of birth and an ID number that disagree are
--       refused (check_violation, id_number_disagrees_with_date_of_birth)
--       for every write made by or for a signed-in person: the application
--       role, and every door (a definer, as the owner, under the caller's
--       session). The one write it lets through is the owner's own with no
--       one signed in (the SQL Editor, a seed, a walk's fixture), which can
--       switch any trigger off in any case; that write is still recorded, as
--       'owner', so it is answerable. And a recorded date changed by
--       the application role directly (not through a door) is the office's
--       alone (insufficient_privilege, born_correction_is_the_office): the
--       import's UPDATE is such a write.
--   + trigger player_born_changes_are_recorded (AFTER UPDATE OF born): the
--       row above, whenever born changes. No path writes born without it.
--   + player_born_office(school)  the school office: pupil_claim_office()
--       (db/168: guardian.link.manage at the school, never a support hour,
--       a platform-wide key or a pad) AND player.profile.manage AND
--       player.identity.read there. The principal holds the first only;
--       the director of sport and the sports administrator hold the second
--       only; the office (schooladmin) holds all three. Kameel's word was
--       "the office", so the office it is. player.identity.read is part of
--       it for a second reason: the door's answer says whether a date agrees
--       with the ID number, which only an ID number's reader may learn.
--   + player_born_correct(player, born)  the office's door: (ok, reason,
--       was, born). Refuses not_permitted (not the office, or no such boy,
--       one answer for both), born_required, born_in_future, and
--       id_number_disagrees_with_date_of_birth; answers ok 'unchanged' for
--       the date already on record. The format and the age band are the
--       route's (resolveBirthDate()), as at every other door.
--   + player_born_changes(player)  the office reads a boy's history: when,
--       before, after, how, by whom (audit_person_label(), db/79). Nothing
--       for anyone else.
--
-- ── ROWS THAT ALREADY DISAGREE ─────────────────────────────────────
-- A CHECK constraint would refuse the paste on any database holding one
-- old row whose date disagrees with its ID number, so this is a trigger on
-- change instead: a row already on file is left as it is until somebody
-- writes its born or its id_number, and then the write must agree. The
-- paste counts such rows and says so (a NOTICE, never a failure), so the
-- office has a number to act on. The local pilot seed has none: its three
-- ID numbers are made from their own dates (db/98's sa_id_for()). An old
-- disagreeing row can be put right by the office's door only to the date
-- its ID number carries; if the ID number is the wrong one, that is a
-- correction to the ID number, which no route makes yet (a question for
-- Kameel, not decided here).
--
-- ── WHAT IS NOT HERE ───────────────────────────────────────────────
--   * A first date written by INSERT (the Add Player form, a new boy in an
--     import) is not a change and is not a row here; it is checked against
--     the ID number all the same.
--   * Guardian links a school already ended from the old date
--     (assignment_subject.valid_until = majority_on(born) once he has left,
--     db/62) are not re-dated by a correction. db/169's sign-in reads born
--     itself and follows a correction at once.
--   * No function of db/169, db/170 or db/171 is touched.
--
-- Needs db/168 (pupil_claim_office()), db/79 (audit_person_label()), db/08
-- (sa_today()). Takes a short lock on player for the two triggers.

DO $guard$
BEGIN
  IF to_regprocedure('app_user_id()') IS NULL OR to_regprocedure('sa_today()') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('pupil_claim_office(uuid)') IS NULL
     OR to_regprocedure('audit_person_label(uuid)') IS NULL
     OR to_regclass('player') IS NULL OR to_regclass('app_user') IS NULL THEN
    RAISE EXCEPTION 'db/172: app_user_id() or app_can() (db/01), sa_today() (db/08), audit_person_label() (db/79) or pupil_claim_office() (db/168) is missing; apply them first';
  END IF;
END $guard$;

SET lock_timeout = '10s';


-- ── 1 · The date an ID number carries ──────────────────────────────
-- resolveCentury() in SQL, line for line. p_on is "today"; only its year is
-- read, as the JS reads only getUTCFullYear(). Pure: no table, no clock.
CREATE OR REPLACE FUNCTION sa_id_born(p_id text, p_on date) RETURNS date AS $$
  SELECT CASE WHEN p_id ~ '^[0-9]{13}$' AND p_on IS NOT NULL THEN (
    SELECT d
      FROM (SELECT c.ord, c.century + substr(p_id, 1, 2)::int AS y,
                   substr(p_id, 3, 2)::int AS m, substr(p_id, 5, 2)::int AS dd
              FROM (VALUES (1, 2000), (2, 1900)) AS c(ord, century)) t
      CROSS JOIN LATERAL (
        -- Nested, so make_date() never sees a month that is not one.
        SELECT CASE WHEN t.m BETWEEN 1 AND 12 AND t.dd BETWEEN 1 AND 31 THEN
                 CASE WHEN t.dd <= extract(day FROM (make_date(t.y, t.m, 1) + interval '1 month - 1 day'))::int
                      THEN make_date(t.y, t.m, t.dd) END END AS d) x
     WHERE t.y <= extract(year FROM p_on)::int                 -- not born yet
       AND extract(year FROM p_on)::int - t.y <= 120           -- nobody is that old
       AND x.d IS NOT NULL                                     -- 31 February and friends
     ORDER BY t.ord
     LIMIT 1) END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

-- Today, as the JS has it: the UTC calendar date.
CREATE OR REPLACE FUNCTION sa_id_born(p_id text) RETURNS date AS $$
  SELECT sa_id_born(p_id, (now() AT TIME ZONE 'UTC')::date)
$$ LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION sa_id_born(text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION sa_id_born(text) FROM PUBLIC;
-- The app role's trigger calls it (the check runs as the writer); it reads
-- nothing but its argument.
GRANT EXECUTE ON FUNCTION sa_id_born(text, date) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION sa_id_born(text) TO scrbrd_app;


-- ── 2 · Who the office is ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION player_born_office(p_school uuid) RETURNS boolean AS $$
  SELECT p_school IS NOT NULL AND app_user_id() IS NOT NULL
     AND pupil_claim_office(p_school)
     AND app_can('player.profile.manage', p_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     AND app_can('player.identity.read', p_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_office(uuid) FROM PUBLIC;
-- The trigger asks it as the writer; it answers only about the caller.
GRANT EXECUTE ON FUNCTION player_born_office(uuid) TO scrbrd_app;


-- ── 3 · The record ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS player_born_change (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  school_id   uuid,
  was         date,                    -- NULL: there was none (a capture)
  became      date,
  how         text NOT NULL CHECK (how IN ('capture', 'correction', 'import', 'owner')),
  -- Who: the signed-in person, and his name as it was. No foreign key: the
  -- record outlives the account.
  by_id       uuid,
  by_name     text,
  -- clock_timestamp(), not now(): two changes in one transaction (an import
  -- that names a boy twice) keep their order.
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (was IS DISTINCT FROM became)
);
CREATE INDEX IF NOT EXISTS player_born_change_player ON player_born_change (player_id, at);
ALTER TABLE player_born_change ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_born_change FROM PUBLIC;
REVOKE ALL ON player_born_change FROM scrbrd_app;


-- ── 4 · The check, as the writer ───────────────────────────────────
-- SECURITY INVOKER on purpose: current_user is the role that wrote the row.
-- scrbrd_app writing directly (the capture route, the import) meets the
-- office rule; a door (a definer, running as the owner) has asked its own.
CREATE OR REPLACE FUNCTION player_born_checked() RETURNS trigger AS $$
DECLARE v_from_id date;
BEGIN
  -- The owner's own write, no one signed in, is the one let through (above).
  IF NEW.born IS NOT NULL AND NEW.id_number IS NOT NULL
     AND (app_user_id() IS NOT NULL OR current_user = 'scrbrd_app')
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
  IF TG_OP = 'UPDATE' AND OLD.born IS NOT NULL AND NEW.born IS DISTINCT FROM OLD.born
     AND current_user = 'scrbrd_app' AND NOT player_born_office(NEW.school_id) THEN
    RAISE EXCEPTION 'born_correction_is_the_office'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only the school office may change a date of birth already on record.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_checked() FROM PUBLIC;

DROP TRIGGER IF EXISTS player_born_agrees_with_id ON player;
CREATE TRIGGER player_born_agrees_with_id
  BEFORE INSERT OR UPDATE OF born, id_number ON player
  FOR EACH ROW EXECUTE FUNCTION player_born_checked();


-- ── 5 · The record, as the owner ───────────────────────────────────
-- How: no one signed in is the owner; the import says so for its own
-- transaction (app.born_how = 'import', set by the import route); a date
-- where there was none is a capture; any other change is a correction.
-- app.born_how is a label and never an authority: the office rule above
-- does not read it.
CREATE OR REPLACE FUNCTION player_born_record() RETURNS trigger AS $$
DECLARE v_me uuid := app_user_id();
BEGIN
  IF NEW.born IS NOT DISTINCT FROM OLD.born THEN RETURN NULL; END IF;
  INSERT INTO player_born_change (player_id, school_id, was, became, how, by_id, by_name)
  VALUES (NEW.id, NEW.school_id, OLD.born, NEW.born,
          CASE WHEN v_me IS NULL THEN 'owner'
               WHEN current_setting('app.born_how', true) = 'import' THEN 'import'
               WHEN OLD.born IS NULL THEN 'capture'
               ELSE 'correction' END,
          v_me, (SELECT u.name FROM app_user u WHERE u.id = v_me));
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_record() FROM PUBLIC;

DROP TRIGGER IF EXISTS player_born_changes_are_recorded ON player;
CREATE TRIGGER player_born_changes_are_recorded
  AFTER UPDATE OF born ON player
  FOR EACH ROW EXECUTE FUNCTION player_born_record();


-- ── 6 · The office's door ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION player_born_correct(p_player uuid, p_born date)
RETURNS TABLE (ok boolean, reason text, was date, born date) AS $$
#variable_conflict use_column
DECLARE p record; v_from_id date;
BEGIN
  SELECT x.id, x.school_id, x.born, x.id_number INTO p FROM player x WHERE x.id = p_player FOR UPDATE;
  IF NOT FOUND OR NOT player_born_office(p.school_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::date, NULL::date; RETURN;
  END IF;
  IF p_born IS NULL THEN
    RETURN QUERY SELECT false, 'born_required'::text, p.born, NULL::date; RETURN;
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
  UPDATE player x SET born = p_born WHERE x.id = p_player;
  RETURN QUERY SELECT true, NULL::text, p.born, p_born;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_correct(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_born_correct(uuid, date) TO scrbrd_app;


-- ── 7 · The office reads a boy's changes ───────────────────────────
CREATE OR REPLACE FUNCTION player_born_changes(p_player uuid)
RETURNS TABLE (at timestamptz, was date, became date, how text, by_name text) AS $$
  SELECT c.at, c.was, c.became, c.how,
         coalesce(audit_person_label(c.by_id), c.by_name, CASE WHEN c.how = 'owner' THEN 'SCRBRD' END)
    FROM player_born_change c
    JOIN player p ON p.id = c.player_id
   WHERE c.player_id = p_player AND player_born_office(p.school_id)
   ORDER BY c.at DESC, c.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_changes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_born_changes(uuid) TO scrbrd_app;


-- ── 8 · What is already on file ────────────────────────────────────
-- Never a failure: a number for the office.
DO $count$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM player
   WHERE born IS NOT NULL AND id_number IS NOT NULL
     AND sa_id_born(id_number) IS NOT NULL AND sa_id_born(id_number) <> born;
  IF n > 0 THEN
    RAISE NOTICE 'db/172: % player row(s) hold a date of birth that disagrees with their ID number. They stand until changed; the next write to either must agree.', n;
  END IF;
END $count$;


-- ── 9 · The lock limit back as it was ──────────────────────────────
RESET lock_timeout;
