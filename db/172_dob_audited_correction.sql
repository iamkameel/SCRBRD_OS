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
--       session). The one write it lets through is the owner's own, logged
--       in as the owner, with no one signed in (the SQL Editor, a seed, a
--       walk's fixture); a door the application calls is never it. The owner
--       can switch any trigger off in any case; that write is still recorded, as
--       'owner', so it is answerable. And a recorded date changed by
--       the application (logged in as scrbrd_app, directly or through any
--       door: session_user, which no definer changes) is the office's alone
--       (insufficient_privilege, born_correction_is_the_office), and so is a
--       change to an ID number already on file (id_number_change_is_the_office;
--       not recorded: whether ID changes are recorded is Kameel's open
--       question). The import's UPDATE is such a write.
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
  -- Who: the signed-in person, and his label as it was (audit_person_label(),
  -- db/79: a pupil in initials, review N5). No foreign key: the record
  -- outlives the account.
  by_id       uuid,
  by_name     text,
  -- Why, in the office's words (Kameel, 25 Nov 2026: a correction carries a
  -- required short reason, "birth certificate seen"). A correction's alone:
  -- a capture, an import and the owner say what they were by `how`.
  reason      text,
  -- clock_timestamp(), not now(): two changes in one transaction (an import
  -- that names a boy twice) keep their order.
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (was IS DISTINCT FROM became)
);
-- A development database that took an earlier cut of this file.
ALTER TABLE player_born_change ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE player_born_change DROP CONSTRAINT IF EXISTS player_born_change_reason;
ALTER TABLE player_born_change ADD CONSTRAINT player_born_change_reason
  -- coalesce: a CHECK that comes out NULL passes, and a NULL reason must not.
  CHECK (CASE WHEN how = 'correction' THEN coalesce(reason ~ '\S' AND char_length(reason) <= 200, false)
              ELSE reason IS NULL END) NOT VALID;   -- a development database's earlier-cut rows stand; every new row is held
CREATE INDEX IF NOT EXISTS player_born_change_player ON player_born_change (player_id, at);
ALTER TABLE player_born_change ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_born_change FROM PUBLIC;
REVOKE ALL ON player_born_change FROM scrbrd_app;


-- ── 4 · The check, as the writer ───────────────────────────────────
-- SECURITY INVOKER on purpose: current_user is the role that wrote the row.
-- scrbrd_app writing directly (the capture route, the import) meets the
-- office rule; a door (a definer, running as the owner) has asked its own.
CREATE OR REPLACE FUNCTION player_born_checked() RETURNS trigger AS $$
DECLARE
  v_from_id date;
  -- The application wrote this: as itself, or through a door (a definer runs
  -- as the owner, so current_user alone would not say; the login role does,
  -- and no definer changes it).
  v_app boolean := current_user = 'scrbrd_app' OR session_user = 'scrbrd_app';
BEGIN
  -- The owner's own write, no one signed in, is the one let through (above).
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
  -- An ID number on file is the office's to change (review S1): otherwise a
  -- file could carry a new number and a date that agrees with it, and the
  -- number on his record would no longer decide anything. Not recorded: a
  -- record of ID number changes is Kameel's open question.
  IF TG_OP = 'UPDATE' AND OLD.id_number IS NOT NULL AND NEW.id_number IS DISTINCT FROM OLD.id_number
     AND v_app AND NOT player_born_office(OLD.school_id) THEN
    RAISE EXCEPTION 'id_number_change_is_the_office'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Only the school office may change an ID number already on record.';
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
DECLARE v_me uuid := app_user_id(); v_how text;
BEGIN
  IF NEW.born IS NOT DISTINCT FROM OLD.born THEN RETURN NULL; END IF;
  v_how := CASE WHEN v_me IS NULL THEN 'owner'
                WHEN current_setting('app.born_how', true) = 'import' THEN 'import'
                WHEN OLD.born IS NULL THEN 'capture'
                ELSE 'correction' END;
  -- A correction's reason is the door's (app.born_reason, set for its one
  -- UPDATE). Without one the row's CHECK refuses the write: a recorded date
  -- is corrected through player_born_correct() or not at all.
  INSERT INTO player_born_change (player_id, school_id, was, became, how, by_id, by_name, reason)
  VALUES (NEW.id, NEW.school_id, OLD.born, NEW.born, v_how,
          v_me, CASE WHEN v_me IS NOT NULL THEN audit_person_label(v_me) END,
          CASE WHEN v_how = 'correction' THEN nullif(current_setting('app.born_reason', true), '') END);
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_record() FROM PUBLIC;

DROP TRIGGER IF EXISTS player_born_changes_are_recorded ON player;
CREATE TRIGGER player_born_changes_are_recorded
  AFTER UPDATE OF born ON player
  FOR EACH ROW EXECUTE FUNCTION player_born_record();


-- ── 6 · The office's door ──────────────────────────────────────────
-- An earlier cut took no reason.
DROP FUNCTION IF EXISTS player_born_correct(uuid, date);
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
  IF v_why IS NULL OR v_why = '' THEN
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
  PERFORM set_config('app.born_reason', v_why, true);
  UPDATE player x SET born = p_born WHERE x.id = p_player;
  PERFORM set_config('app.born_reason', '', true);
  RETURN QUERY SELECT true, NULL::text, p.born, p_born;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_correct(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_born_correct(uuid, date, text) TO scrbrd_app;


-- ── 7 · The office reads a boy's changes ───────────────────────────
-- An earlier cut answered no reason.
DROP FUNCTION IF EXISTS player_born_changes(uuid);
CREATE OR REPLACE FUNCTION player_born_changes(p_player uuid)
RETURNS TABLE (at timestamptz, was date, became date, how text, by_name text, reason text) AS $$
  SELECT c.at, c.was, c.became, c.how,
         coalesce(audit_person_label(c.by_id), c.by_name, CASE WHEN c.how = 'owner' THEN 'SCRBRD' END),
         c.reason
    FROM player_born_change c
    JOIN player p ON p.id = c.player_id
   WHERE c.player_id = p_player AND player_born_office(p.school_id)
   ORDER BY c.at DESC, c.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION player_born_changes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_born_changes(uuid) TO scrbrd_app;


-- ── 7b · The audit log (Kameel, 25 Nov 2026) ───────────────────────
-- audit_log() (db/79, as db/148 left it, the last to touch it; db/169–171
-- did not) gains the kind 'dob': a date of birth recorded, corrected,
-- imported or set by the owner, by whom (audit_person_label(), masked as
-- every actor is), about which boy (in initials, as every pupil is), under
-- audit.read for his side. The dates come only to a reader who holds
-- player.age.read for him; the reason never (the log's own rule: "never a
-- reason or a note"). Patched in place by exact needle, as db/142–148 patch
-- it, and only over db/148's body or this file's: the folded md5 below.
CREATE OR REPLACE FUNCTION pg_temp._v172_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION pg_temp._v172_patch(p_fn text, p_needle text, p_repl text) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'db/172: % holds its needle % times, not once: look before replacing it', p_fn, v_n;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;

DO $audit_guard$
DECLARE v text := pg_temp._v172_fold((SELECT prosrc FROM pg_proc
                   WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure));
BEGIN
  IF v IS NULL OR v NOT IN ('4c8a819926d5d303207948bdf3e55a85', '25f7df23628e41c73c4e9575e8eb37a3') THEN
    RAISE EXCEPTION 'db/172: audit_log() is neither db/148''s nor this file''s (md5 % of its folded body); look before replacing it', v;
  END IF;
END $audit_guard$;

SELECT pg_temp._v172_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
  E'\'role\', \'duty\', \'recognition\']',
  E'\'role\', \'duty\', \'recognition\', \'dob\']');
SELECT pg_temp._v172_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
  E'        UNION ALL\n        -- duty_suspension: a match duty paused and lifted.',
  E'        UNION ALL\n'
  || E'        -- player_born_change (db/172): a boy''s date of birth recorded,\n'
  || E'        -- corrected, imported or set by the owner, and by whom. The dates to\n'
  || E'        -- a reader of his age alone; never the reason.\n'
  || E'        SELECT bc.at, \'dob\',\n'
  || E'               CASE bc.how WHEN \'capture\'    THEN \'Recorded a date of birth\'\n'
  || E'                           WHEN \'correction\' THEN \'Corrected a date of birth\'\n'
  || E'                           WHEN \'import\'     THEN \'Wrote a date of birth from a roster import\'\n'
  || E'                           ELSE \'SCRBRD changed a date of birth\' END,\n'
  || E'               bc.by_id, bc.player_id, NULL, NULL, NULL, NULL, NULL, bc.school_id,\n'
  || E'               jsonb_strip_nulls(jsonb_build_object(\'how\', bc.how,\n'
  || E'                 \'was\', CASE WHEN app_can(\'player.age.read\', bc.school_id, bp.team_code, bc.player_id, NULL) THEN bc.was END,\n'
  || E'                 \'became\', CASE WHEN app_can(\'player.age.read\', bc.school_id, bp.team_code, bc.player_id, NULL) THEN bc.became END)),\n'
  || E'               \'dob:\' || bc.id::text\n'
  || E'          FROM player_born_change bc\n'
  || E'          JOIN player bp ON bp.id = bc.player_id\n'
  || E'         WHERE \'dob\' = ANY (v_kinds) AND bc.school_id = p_school\n'
  || E'           AND app_can(\'audit.read\', bc.school_id, bp.team_code, bc.player_id, NULL)\n'
  || E'        UNION ALL\n        -- duty_suspension: a match duty paused and lifted.');

DO $audit_check$
DECLARE v text := (SELECT prosrc FROM pg_proc WHERE oid = 'audit_log(uuid,text[],timestamptz,timestamptz,text,integer)'::regprocedure);
BEGIN
  IF pg_temp._v172_fold(v) <> '25f7df23628e41c73c4e9575e8eb37a3' THEN
    RAISE EXCEPTION 'db/172: audit_log() is not this file''s after the paste (md5 %)', pg_temp._v172_fold(v);
  END IF;
END $audit_check$;
DROP FUNCTION pg_temp._v172_patch(text, text, text);
DROP FUNCTION pg_temp._v172_fold(text);


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
