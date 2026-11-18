-- ══════════════════════════════════════════════════════════════════
--  163 · "I am a pupil here": the pupil's claim, the recognised-and-
--        waiting state, and the under-18 basic view's own reads
--        (SCRBRD-140, the honesty model, Migration A)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. SCRBRD-140's honesty model, Migration A and slice 1 of its
-- build plan, on Kameel's answers of 18 Nov 2026 (every question as
-- recommended). The answers this file stands on:
--   Q3  (a) a pupil may say "I am a pupil here". It asks for nothing and
--           opens nothing.
--   Q8  (a) a recognised pupil sees his school's safeguarding card and may
--           raise a concern from the basic view.
--   Q9  (a) an account that said it is under 18 is kept 30 days from its
--           last claim, then removed with its follow list; the screen says
--           so from the first day.
--   Q10 (a) "I just want to follow matches" follows at once.
--   Q11 (a) a declined pupil claim tells the school's DSOs, with the same
--           no-name notice as a declined parent claim (D7, db/93).
--
-- THE RULE. What a person says about himself can only narrow what he sees.
-- A claim here widens nothing: an account that has said "I am a pupil
-- here, and under 18" holds no role, no roster link (app_user.player_id
-- stays NULL) and no self link, so it reads exactly what db/81's account
-- with no school reads (db/99 §60), and db/99 §141 runs that sweep again
-- for it. What it gains is its own: its own claim's state, and once the
-- office has recognised it, its school's safeguarding card and the door to
-- raise a concern there (Q8). Opening his own page (the yes, the gate in
-- app_can()) is Migration B, and is not here.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   + pupil_claim  one row per account that has said it is a pupil under
--       18: the school, what he typed (a name, a year), the day he said
--       it, the state (with_office · recognised · open · declined), the
--       roster row once known and who made it known, and the dates. RLS
--       on, no policy, no privilege: functions only (db/81's shape). The
--       state `open` is in the CHECK for Migration B; nothing here writes it.
--       NO DATE OF BIRTH: the date a claimant types is an argument of
--       pupil_claim_send(), shape-checked and dropped. It is never a
--       column, never logged (Q2; db/99 §141 (born) searches every table).
--   + pupil_claim_send(school, name, year, born)  his claim, as himself.
--       Every claim goes to the office until the family list exists
--       (Migration C); the answer is the same whatever he typed. Sending
--       it withdraws his own pending role requests: an account that is a
--       pupil's under 18 asks for nothing (§3.2).
--   + pupil_claim_recognise(claim, player), pupil_claim_decline(claim)
--       the office (guardian.link.manage at the claim's school, never
--       under a support hour, a platform-wide key or a pad). Recognising
--       opens nothing. A decline tells the DSOs, naming nobody (Q11).
--   + pupil_claims(school)  the office's Pupil claims list: his address
--       (to the office and the principal only, R4), what he typed, the
--       state, the date he is kept until.
--   + my_pupil_state()  what his own screen needs: the state, the school's
--       name, what he typed, the dates, whether the safeguarding card is
--       his. Never the roster's name for him, his team or a birthday.
--   + pupil_claim_clear(school), pupil_claim_remove_self(), and the
--       owner's pupil_claim_purge()  the 30-day keep (Q9): a person runs
--       each, nothing unattended. The account goes as ACCOUNT_LIFECYCLE
--       §6.3 has an account end: its sign-ins, follow list, requests and
--       notices deleted, its row deleted, or, where the record still names
--       it, tombstoned and shut.
--   + follow_school_by_id(school)  Q10: the join form's "I just want to
--       follow matches" follows the school chosen, at once (db/160's door,
--       by id; public_schools() names a school by id and name only).
--   + triggers role_request_pupil_waiting and school_add_request_pupil_waiting:
--       a request of any kind, or a note asking SCRBRD to add a school,
--       from an account whose claim is waiting is refused
--       (check_violation pupil_claim_waiting; "Ask your school office").
--       Only the account's own asking: the office enrolling him
--       (enrol_person(), today's path for the signed form) still works.
--   ~ person_is_pupil(uuid)  db/57's, as db/128 left it, with a third case:
--       the account has a pupil claim. Every caller uses it to narrow
--       (no private notice but the system's, the staff register turns him
--       away, no lift seat offered by him, no safeguarding share to him, a
--       declined claim on his account tells the DSO); the list is in the
--       design's §3.6 and the build map, and none of them allows anything.
--   ~ dso_contacts(uuid), safeguarding_concern_raise(…)  db/57's and
--       db/116's, each with one condition widened from "a live assignment
--       at the school" to "…or a pupil the school has recognised" (Q8).
--       Re-emitted in place, md5-guarded, and checked to have changed by
--       that one condition and nothing else (db/81's login_code_issue()
--       pattern).
--
-- NOT HERE (the design's Migration B and C): the yes for his own sign-in,
-- the gate in app_can(), the office's "form on file" tick, the family list.
-- Until B, the only way his own page opens is today's: the office enrols
-- his account (POST /api/users), which writes his roles through the grant
-- door with the signed form's consent, as it does now.
--
-- Every function: SECURITY DEFINER, search_path pinned, REVOKE ALL FROM
-- PUBLIC; the doors GRANT EXECUTE to scrbrd_app by name; nothing to anon,
-- authenticated or service_role (db/157). No BEGIN or COMMIT: the paste
-- wraps the file in one transaction. Safe to run twice. Its proof is
-- db/99 §141; its walks are smoke-signup (9) and smoke-browser-under18.


-- ── 0 · What this file stands on, and the bodies it re-emits ───────
DO $guard$
DECLARE v text;
BEGIN
  IF to_regprocedure('app_user_id()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('person_is_pupil(uuid)') IS NULL OR to_regprocedure('person_live_at(uuid,uuid,text[])') IS NULL
     OR to_regprocedure('dso_contacts(uuid)') IS NULL
     OR to_regprocedure('safeguarding_concern_raise(uuid,text,text[],text,text,text,uuid,uuid,text,date,text,text,boolean,uuid)') IS NULL
     OR to_regprocedure('declined_claim_notice(uuid,text,text,uuid)') IS NULL OR to_regprocedure('request_cooldown_open(uuid)') IS NULL
     OR to_regprocedure('lift_cuts_ok(uuid)') IS NULL OR to_regprocedure('follow_school(text,boolean)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('sa_date(timestamptz)') IS NULL
     OR to_regprocedure('majority_on(date)') IS NULL OR to_regprocedure('api_role_reach(name)') IS NULL
     OR to_regclass('school_add_request') IS NULL OR to_regclass('followed_school') IS NULL OR to_regclass('auth_identity') IS NULL THEN
    RAISE EXCEPTION 'db/163: app_user_id() (db/01), person_is_pupil() or dso_contacts() (db/57), safeguarding_concern_raise() (db/116), declined_claim_notice() (db/93), lift_cuts_ok() (db/70), follow_school() (db/160), school_add_request (db/158), auth_identity (db/81), sa_today() (db/128) or api_role_reach() (db/157) is missing; apply them first';
  END IF;
  -- person_is_pupil(): db/57's as db/128 left it, or this file's own.
  v := md5((SELECT prosrc FROM pg_proc WHERE oid = 'person_is_pupil(uuid)'::regprocedure));
  IF v NOT IN ('4ab87c3767211d5c959c4a43da18a2b9', '789b48b1592771d01f3407776a7f276e') THEN
    RAISE EXCEPTION 'db/163: person_is_pupil() is neither db/57''s as db/128 left it nor this file''s (md5 %); factor the version now in place and move these hashes', v;
  END IF;
  -- The two safeguarding doors: as db/57 and db/116 left them, or with
  -- this file's condition already in (a second paste; checked in §6).
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'dso_contacts(uuid)'::regprocedure);
  IF position('pupil_recognised_at(' IN v) = 0 AND md5(v) <> '5ef59c7361a95eaf32b01558fc7ce145' THEN
    RAISE EXCEPTION 'db/163: dso_contacts() is not db/57''s (md5 %); factor the version now in place and move its hash', md5(v);
  END IF;
  v := (SELECT prosrc FROM pg_proc WHERE oid = 'safeguarding_concern_raise(uuid,text,text[],text,text,text,uuid,uuid,text,date,text,text,boolean,uuid)'::regprocedure);
  IF position('pupil_recognised_at(' IN v) = 0 AND md5(v) <> '6982c7aa0395aaf8d4a54d670143546d' THEN
    RAISE EXCEPTION 'db/163: safeguarding_concern_raise() is not db/116''s (md5 %); factor the version now in place and move its hash', md5(v);
  END IF;
END $guard$;


-- ── 0b · Ten seconds for a lock, or nothing (db/158's and db/161's pattern) ──
-- The triggers lock role_request and school_add_request, which every
-- signed-in request writes. A paste that cannot get a lock in ten seconds
-- stops and changes nothing: paste it again.
DO $lock$
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
END $lock$;


-- ── 1 · The claim ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pupil_claim (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One row per account: the account's own claim, sent again if need be.
  user_id          uuid NOT NULL UNIQUE REFERENCES app_user(id) ON DELETE CASCADE,
  school_id        uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  -- What he typed, word for word (spaces tidied). Never a key into anything.
  typed_name       text NOT NULL CHECK (char_length(typed_name) BETWEEN 2 AND 80),
  typed_year       text CHECK (typed_year IS NULL OR char_length(typed_year) BETWEEN 1 AND 20),
  -- The day (Johannesburg's) he said he is under 18. Not a birthday.
  said_under_18_on date NOT NULL,
  state            text NOT NULL DEFAULT 'with_office'
                   CHECK (state IN ('with_office', 'recognised', 'open', 'declined')),
  -- The roster row, once a person at the school has made him known.
  player_id        uuid REFERENCES player(id) ON DELETE SET NULL,
  known_how        text CHECK (known_how IN ('office', 'family_list')),
  known_by         uuid REFERENCES app_user(id) ON DELETE SET NULL,
  known_at         timestamptz,
  first_claim_at   timestamptz NOT NULL DEFAULT now(),
  -- Q9's clock: kept 30 days from this.
  last_claim_at    timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  CONSTRAINT pupil_claim_known_whole CHECK (
    state NOT IN ('recognised', 'open') OR (player_id IS NOT NULL AND known_how IS NOT NULL AND known_at IS NOT NULL)),
  CONSTRAINT pupil_claim_declined_dated CHECK (state <> 'declined' OR decided_at IS NOT NULL)
);
-- One account recognised as a boy at a time: two accounts able to answer
-- as the same child is not a duplicate, it is two people (enrol_person()'s
-- own rule, db/08).
CREATE UNIQUE INDEX IF NOT EXISTS pupil_claim_one_per_player ON pupil_claim (player_id) WHERE state IN ('recognised', 'open');
CREATE INDEX IF NOT EXISTS pupil_claim_school_idx ON pupil_claim (school_id, state);

COMMENT ON TABLE pupil_claim IS
  'db/163 (SCRBRD-140 honesty model, Migration A): an account that said it is a pupil under 18 at a school. Holds what he typed and the state; never a date of birth. Functions only.';

ALTER TABLE pupil_claim ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pupil_claim FROM PUBLIC;
REVOKE ALL ON pupil_claim FROM scrbrd_app;


-- ── 2 · The questions every door asks ──────────────────────────────
-- Has this account been opened the way a pupil's is today: a roster link,
-- or a live player or selfaccess assignment? (person_is_pupil()'s first two
-- cases.) Then his claim no longer narrows anything: he is in the pupil's
-- app, whatever its row says.
CREATE OR REPLACE FUNCTION pupil_account_opened(p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = p_person AND a.role IN ('player', 'selfaccess') AND a.active
                    AND (a.valid_until IS NULL OR a.valid_until > sa_today()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Is this account a pupil's claim that has not been opened? Then it asks
-- for nothing (the two triggers below).
CREATE OR REPLACE FUNCTION pupil_claim_waiting(p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM pupil_claim c WHERE c.user_id = p_person AND c.state <> 'open')
     AND NOT pupil_account_opened(p_person)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Q8: has this school recognised this account as one of its pupils? Then
-- it sees the school's safeguarding card and may raise a concern there.
-- Never under a pad's credential; never for a shut account.
CREATE OR REPLACE FUNCTION pupil_recognised_at(p_person uuid, p_school uuid) RETURNS boolean AS $$
  SELECT p_person IS NOT NULL AND p_school IS NOT NULL AND NOT coalesce(app_pad_scoped(), false)
     AND EXISTS (SELECT 1 FROM pupil_claim c JOIN app_user u ON u.id = c.user_id
                  WHERE c.user_id = p_person AND c.school_id = p_school
                    AND c.state IN ('recognised', 'open') AND u.active)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The office of a school, for the claim doors: guardian.link.manage there
-- (the office and the principal, who read a pupil's address, R4), and not a
-- support hour, a platform-wide key or a pad (db/70's cut).
CREATE OR REPLACE FUNCTION pupil_claim_office(p_school uuid) RETURNS boolean AS $$
  SELECT p_school IS NOT NULL AND lift_cuts_ok(p_school)
     AND app_can('guardian.link.manage', p_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The last day an account is kept (Q9): 30 days from its last claim, on
-- Johannesburg's calendar. NULL once he is opened.
CREATE OR REPLACE FUNCTION pupil_claim_keep_until(p_claim uuid) RETURNS date AS $$
  SELECT CASE WHEN c.state = 'open' OR pupil_account_opened(c.user_id) THEN NULL
              ELSE sa_date(c.last_claim_at) + 30 END
    FROM pupil_claim c WHERE c.id = p_claim
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- An act by the office on a claim, on the school's record: the claim's id,
-- never what he typed and never his address.
CREATE OR REPLACE FUNCTION pupil_claim_log(p_resource text, p_school uuid, p_ids uuid[]) RETURNS void AS $$
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, device_id)
  VALUES (p_school, app_user_id(), p_resource, coalesce(p_ids, '{}'), coalesce(cardinality(p_ids), 0), app_device_id())
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · person_is_pupil(): the third, protective case (§3.6) ───────
-- db/57's two cases, as db/128 left them (sa_today()), and the account
-- that has said it is a pupil. When in doubt the account rule treats him
-- as a pupil (Kameel, 18 Nov): every caller narrows on it.
CREATE OR REPLACE FUNCTION person_is_pupil(p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = p_person AND a.role IN ('player', 'selfaccess') AND a.active
                    AND (a.valid_until IS NULL OR a.valid_until > sa_today()))
      -- db/163: he said he is a pupil under 18 (recognised or not, declined or not).
      OR EXISTS (SELECT 1 FROM pupil_claim c WHERE c.user_id = p_person)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION person_is_pupil(uuid) FROM PUBLIC;


-- ── 4 · The doors ──────────────────────────────────────────────────
/**
 * HIS CLAIM (§4.2 A, Q3). As himself, signed in, from an account that holds
 * and held nothing (no roster link, no role ever: anybody else is the
 * office's to answer). Answers (ok, reason):
 *   ok                     sent; the same answer whatever he typed
 *   not_signed_in          no session, a pad's credential, or a shut account
 *   ask_your_school_office the account holds or held a role, or is a
 *                          roster link: not a claim's to change
 *   request_cooldown       the account is paused from asking (db/93)
 *   no_such_school         no school, or an archived one
 *   name_required          a name of 2 to 80 letters, nothing hidden in it
 *   year_too_long          more than 20 characters
 *   born_invalid           a date of birth that cannot be a pupil's
 *   already_recognised     the school has already made him known
 *   already_answered       the school declined: the office is his way now
 * p_born is compared and dropped: it is never stored and never logged
 * (Q2). Until the family list (Migration C) there is nothing to compare it
 * with, so it is shape-checked only. Sending again (still with the office)
 * moves the claim to the school now named and restarts Q9's clock. Sending
 * withdraws his own pending role requests.
 */
CREATE OR REPLACE FUNCTION pupil_claim_send(p_school uuid, p_name text, p_year text, p_born date DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me     uuid := app_user_id();
  v_name   text := btrim(regexp_replace(coalesce(p_name, ''), '[\s   ]+', ' ', 'g'));
  v_year   text := nullif(btrim(regexp_replace(coalesce(p_year, ''), '[\s   ]+', ' ', 'g')), '');
  -- What a name may not hold (db/158's rule): a control character, a soft
  -- hyphen, a zero-width, joiner, bidi or isolate mark, a byte-order mark.
  v_unseen text := '[[:cntrl:]­​-‏‪-‮⁠-⁤⁦-⁩﻿]';
  c        pupil_claim%ROWTYPE;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = v_me AND u.active) THEN
    RETURN QUERY SELECT false, 'not_signed_in'::text; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_claim:' || v_me::text, 163));
  IF EXISTS (SELECT 1 FROM app_user u WHERE u.id = v_me AND u.player_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM role_assignment a WHERE a.person_id = v_me) THEN
    RETURN QUERY SELECT false, 'ask_your_school_office'::text; RETURN;
  END IF;
  IF request_cooldown_open(v_me) THEN RETURN QUERY SELECT false, 'request_cooldown'::text; RETURN; END IF;
  IF p_school IS NULL OR NOT EXISTS (SELECT 1 FROM school s WHERE s.id = p_school AND s.archived_at IS NULL) THEN
    RETURN QUERY SELECT false, 'no_such_school'::text; RETURN;
  END IF;
  IF char_length(v_name) NOT BETWEEN 2 AND 80 OR v_name ~ v_unseen OR v_name !~ '[[:alpha:]].*[[:alpha:]]' THEN
    RETURN QUERY SELECT false, 'name_required'::text; RETURN;
  END IF;
  IF v_year IS NOT NULL AND (char_length(v_year) > 20 OR v_year ~ v_unseen) THEN
    RETURN QUERY SELECT false, 'year_too_long'::text; RETURN;
  END IF;
  -- Compared, never kept. A pupil is between five and twenty-five today.
  IF p_born IS NOT NULL AND (p_born > sa_today() OR p_born < (sa_today() - interval '25 years')::date
                             OR p_born > (sa_today() - interval '5 years')::date) THEN
    RETURN QUERY SELECT false, 'born_invalid'::text; RETURN;
  END IF;

  SELECT * INTO c FROM pupil_claim x WHERE x.user_id = v_me FOR UPDATE;
  IF FOUND THEN
    IF c.state IN ('recognised', 'open') THEN RETURN QUERY SELECT false, 'already_recognised'::text; RETURN; END IF;
    IF c.state = 'declined' THEN RETURN QUERY SELECT false, 'already_answered'::text; RETURN; END IF;
    UPDATE pupil_claim SET school_id = p_school, typed_name = v_name, typed_year = v_year, last_claim_at = now()
     WHERE id = c.id;
  ELSE
    INSERT INTO pupil_claim (user_id, school_id, typed_name, typed_year, said_under_18_on)
    VALUES (v_me, p_school, v_name, v_year, sa_today());
  END IF;
  -- An account that is a pupil's under 18 asks for nothing: what it asked
  -- before it said so is taken back, as he would take it back himself.
  UPDATE role_request SET state = 'withdrawn' WHERE person_id = v_me AND state = 'pending';
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * WHAT HIS OWN SCREEN NEEDS (§3.3's left column). At most one row; none for
 * an account that has said nothing. Never the roster's name for him, his
 * team, his player id or a date of birth.
 *   state         with_office · recognised · open · declined (open: his
 *                 account has been opened, today by the office's enrolment)
 *   safeguarding  the school's card is his (Q8): recognised, at that school
 *   keep_until    the last day the account is kept (Q9); NULL once open
 */
CREATE OR REPLACE FUNCTION my_pupil_state()
RETURNS TABLE (state text, school_id uuid, school_name text, typed_name text, typed_year text,
               said_under_18_on date, sent_on date, keep_until date, safeguarding boolean) AS $$
  SELECT CASE WHEN pupil_account_opened(c.user_id) THEN 'open' ELSE c.state END,
         c.school_id, s.name, c.typed_name, c.typed_year, c.said_under_18_on, sa_date(c.last_claim_at),
         pupil_claim_keep_until(c.id), pupil_recognised_at(c.user_id, c.school_id)
    FROM pupil_claim c JOIN school s ON s.id = c.school_id
   WHERE c.user_id = app_user_id() AND app_user_id() IS NOT NULL AND NOT app_pad_scoped()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * THE OFFICE'S PUPIL CLAIMS LIST (§5.3). guardian.link.manage at the school;
 * nothing for anybody else, the same as a school with none. His address is
 * here because only the office and the principal read it (R4). The roster
 * name is the office's own read (it already reads the roster).
 */
CREATE OR REPLACE FUNCTION pupil_claims(p_school uuid)
RETURNS TABLE (id uuid, account_id uuid, account_name text, address text, typed_name text, typed_year text,
               first_claim_at timestamptz, last_claim_at timestamptz, state text, keep_until date,
               player_id uuid, player_name text, known_by_name text, known_at timestamptz, decided_at timestamptz) AS $$
  SELECT c.id, c.user_id, u.name, u.email, c.typed_name, c.typed_year, c.first_claim_at, c.last_claim_at,
         CASE WHEN pupil_account_opened(c.user_id) THEN 'open' ELSE c.state END,
         pupil_claim_keep_until(c.id), c.player_id, p.full_name, kb.name, c.known_at, c.decided_at
    FROM pupil_claim c
    JOIN app_user u ON u.id = c.user_id
    LEFT JOIN player p ON p.id = c.player_id
    LEFT JOIN app_user kb ON kb.id = c.known_by
   WHERE c.school_id = p_school AND pupil_claim_office(p_school)
   ORDER BY (c.state = 'with_office') DESC, c.last_claim_at DESC, c.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * THE OFFICE RECOGNISES HIM (§2.4): this account is this roster row. It
 * opens nothing. Answers (ok, reason): not_signed_in · not_permitted (also
 * for an id that is no claim, so a stranger learns nothing) ·
 * already_answered · player_not_at_that_school · player_has_an_account (the
 * boy has an account already, or another is recognised as him: nothing
 * merges; the existing account's claim goes through the Claims list) ·
 * player_is_an_adult (by the school's list he is 18 or more: he needs no
 * parent's yes, and the office enrols his account).
 */
CREATE OR REPLACE FUNCTION pupil_claim_recognise(p_claim uuid, p_player uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c pupil_claim%ROWTYPE; v_born date; v_school uuid;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'::text; RETURN; END IF;
  SELECT * INTO c FROM pupil_claim x WHERE x.id = p_claim FOR UPDATE;
  IF NOT FOUND OR NOT pupil_claim_office(c.school_id) THEN RETURN QUERY SELECT false, 'not_permitted'::text; RETURN; END IF;
  IF c.state <> 'with_office' OR pupil_account_opened(c.user_id) THEN
    RETURN QUERY SELECT false, 'already_answered'::text; RETURN;
  END IF;
  SELECT p.school_id, p.born INTO v_school, v_born FROM player p WHERE p.id = p_player;
  IF v_school IS DISTINCT FROM c.school_id THEN
    RETURN QUERY SELECT false, 'player_not_at_that_school'::text; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM app_user u WHERE u.player_id = p_player AND u.active)
     OR EXISTS (SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
                 WHERE g.player_id = p_player AND g.relationship = 'self' AND a.active
                   AND (g.valid_until IS NULL OR g.valid_until > sa_today()))
     OR EXISTS (SELECT 1 FROM pupil_claim o WHERE o.player_id = p_player AND o.state IN ('recognised', 'open') AND o.id <> c.id) THEN
    RETURN QUERY SELECT false, 'player_has_an_account'::text; RETURN;
  END IF;
  IF v_born IS NOT NULL AND majority_on(v_born) <= sa_today() THEN
    RETURN QUERY SELECT false, 'player_is_an_adult'::text; RETURN;
  END IF;
  UPDATE pupil_claim
     SET state = 'recognised', player_id = p_player, known_how = 'office', known_by = app_user_id(), known_at = now(),
         decided_at = now(), decided_by = app_user_id()
   WHERE id = c.id;
  PERFORM pupil_claim_log('pupil_claim.recognised', c.school_id, ARRAY[c.id]);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * THE OFFICE DECLINES HIS CLAIM, with him waiting or already recognised.
 * Q11: the school's DSOs are told, in db/93's no-name notice: not the
 * account, not what he typed, not the boy. Answers (ok, reason):
 * not_signed_in · not_permitted · already_answered.
 */
CREATE OR REPLACE FUNCTION pupil_claim_decline(p_claim uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c pupil_claim%ROWTYPE;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'::text; RETURN; END IF;
  SELECT * INTO c FROM pupil_claim x WHERE x.id = p_claim FOR UPDATE;
  IF NOT FOUND OR NOT pupil_claim_office(c.school_id) THEN RETURN QUERY SELECT false, 'not_permitted'::text; RETURN; END IF;
  IF c.state NOT IN ('with_office', 'recognised') OR pupil_account_opened(c.user_id) THEN
    RETURN QUERY SELECT false, 'already_answered'::text; RETURN;
  END IF;
  UPDATE pupil_claim SET state = 'declined', decided_at = now(), decided_by = app_user_id() WHERE id = c.id;
  PERFORM declined_claim_notice(c.school_id, 'A pupil claim was declined',
    'A request from an account saying it belongs to a pupil at your school was declined by the office on '
      || to_char(sa_today(), 'FMDD FMMonth YYYY')
      || '. The office can tell you who asked. If anything about it concerns you, raise a concern.');
  PERFORM pupil_claim_log('pupil_claim.declined', c.school_id, ARRAY[c.id]);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · The 30-day keep (Q9) ───────────────────────────────────────
-- The account goes as ACCOUNT_LIFECYCLE §6.3 has an account end (its
-- account_erase() is not built): every sign-in, the follow list, requests,
-- notes to SCRBRD, notices, sessions and codes, and the claim itself. Then
-- the row: deleted where nothing on the record names it, or kept,
-- tombstoned (no name, no address) and shut. Only an account that is
-- nothing but a claim: never one opened, one holding or having held a
-- role, or one tied to a roster row. Internal; answers whether it went.
CREATE OR REPLACE FUNCTION pupil_claim_remove_account(p_user uuid) RETURNS boolean AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pupil_claim c WHERE c.user_id = p_user AND c.state <> 'open')
     OR pupil_account_opened(p_user)
     OR EXISTS (SELECT 1 FROM role_assignment a WHERE a.person_id = p_user)
     OR EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_user AND u.player_id IS NOT NULL) THEN
    RETURN false;
  END IF;
  DELETE FROM auth_identity WHERE user_id = p_user;
  DELETE FROM followed_school WHERE person_id = p_user;
  DELETE FROM school_add_request WHERE person_id = p_user;
  DELETE FROM role_request WHERE person_id = p_user;
  DELETE FROM pending_claim WHERE user_id = p_user;
  DELETE FROM notification WHERE recipient_id = p_user;
  DELETE FROM pupil_claim WHERE user_id = p_user;
  BEGIN
    DELETE FROM app_user WHERE id = p_user;
  EXCEPTION WHEN foreign_key_violation THEN
    -- Something on the record names the account (an access log row, say):
    -- the row stays, saying nothing about him, and can never sign in.
    UPDATE app_user SET active = false, name = 'Removed account',
                        email = 'removed+' || p_user::text || '@removed.invalid'
     WHERE id = p_user;
  END;
  RETURN true;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Due: kept past its last day, and not opened.
CREATE OR REPLACE FUNCTION pupil_claim_due(p_claim uuid) RETURNS boolean AS $$
  SELECT coalesce(pupil_claim_keep_until(p_claim) < sa_today(), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * "Remove N accounts past their 30 days" on the office's Pupil claims list:
 * the office removes its own school's, and is answered how many went. The
 * record keeps the claims' ids (never a name). Nothing runs it unattended.
 */
CREATE OR REPLACE FUNCTION pupil_claim_clear(p_school uuid) RETURNS integer AS $$
DECLARE r record; v_ids uuid[] := '{}';
BEGIN
  IF NOT pupil_claim_office(p_school) THEN RETURN 0; END IF;
  FOR r IN SELECT c.id, c.user_id FROM pupil_claim c
            WHERE c.school_id = p_school AND pupil_claim_due(c.id) ORDER BY c.id FOR UPDATE LOOP
    IF pupil_claim_remove_account(r.user_id) THEN v_ids := v_ids || r.id; END IF;
  END LOOP;
  IF cardinality(v_ids) > 0 THEN PERFORM pupil_claim_log('pupil_claim.cleared', p_school, v_ids); END IF;
  RETURN cardinality(v_ids);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * His own way out, now ("Remove this account", §3.3's "delete my account"):
 * only an account that is nothing but a claim. Answers (ok, reason):
 * not_signed_in · not_a_claim (any other account: Me's own door, when
 * account_erase() exists, is its way out).
 */
CREATE OR REPLACE FUNCTION pupil_claim_remove_self()
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE v_me uuid := app_user_id();
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_signed_in'::text; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_claim:' || v_me::text, 163));
  IF NOT pupil_claim_remove_account(v_me) THEN RETURN QUERY SELECT false, 'not_a_claim'::text; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The owner's sweep, for every account past its 30 days at every school.
-- An account with no office of its own (a school since archived) is still
-- reached here. Run by a person, SELECT pupil_claim_purge(), with the
-- paste routine (DEPLOYING); answers how many went. Owner-only.
CREATE OR REPLACE FUNCTION pupil_claim_purge() RETURNS integer AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT c.user_id FROM pupil_claim c WHERE pupil_claim_due(c.id) ORDER BY c.id FOR UPDATE LOOP
    IF pupil_claim_remove_account(r.user_id) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;


-- ── 5b · Q10: follow the school chosen, at once ────────────────────
-- db/160's door, by the school's id (the join form's list names schools by
-- id and name, public_schools()). Every rule is follow_school()'s.
CREATE OR REPLACE FUNCTION follow_school_by_id(p_school uuid)
RETURNS TABLE (ok boolean, reason text, school_id uuid, school_name text) AS $$
  SELECT f.ok, f.reason, f.school_id, f.school_name
    FROM follow_school(coalesce((SELECT s.code FROM school s WHERE s.id = p_school AND s.archived_at IS NULL), ''), true) f
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5c · An account waiting on its claim asks for nothing ──────────
-- BEFORE INSERT, whichever door inserts (POST /api/requests under row
-- security, register_claim() as a definer, school_add_request_ask() as a
-- definer), but only the account's OWN asking: the office enrolling him
-- (enrol_person() writes the request as the office) is not refused.
CREATE OR REPLACE FUNCTION pupil_claim_refuses_asking() RETURNS trigger AS $$
BEGIN
  IF NEW.person_id = app_user_id() AND pupil_claim_waiting(NEW.person_id) THEN
    RAISE EXCEPTION 'pupil_claim_waiting' USING ERRCODE = 'check_violation',
      SCHEMA = 'public', TABLE = TG_TABLE_NAME, CONSTRAINT = 'pupil_claim_waiting';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER role_request_pupil_waiting
  BEFORE INSERT ON role_request
  FOR EACH ROW EXECUTE FUNCTION pupil_claim_refuses_asking();
CREATE OR REPLACE TRIGGER school_add_request_pupil_waiting
  BEFORE INSERT ON school_add_request
  FOR EACH ROW EXECUTE FUNCTION pupil_claim_refuses_asking();


-- ── 6 · Q8: the safeguarding card and the raise, for a recognised pupil ──
-- One condition each, widened from "a live assignment at the school" to
-- "…or a pupil the school has recognised", replaced in place and checked
-- to have changed by that and nothing else (rights, settings, owner).
DO $sg$
DECLARE
  r     record;
  v_src text; v_def text; v_cfg text; v_acl text; v_sec boolean; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('dso_contacts(uuid)'::regprocedure,
       'AND person_live_at(app_user_id(), sc.id)',
       'AND (person_live_at(app_user_id(), sc.id) OR pupil_recognised_at(app_user_id(), sc.id))'),
      ('safeguarding_concern_raise(uuid,text,text[],text,text,text,uuid,uuid,text,date,text,text,boolean,uuid)'::regprocedure,
       'IF p_school IS NULL OR NOT person_live_at(v_me, p_school) THEN',
       'IF p_school IS NULL OR NOT (person_live_at(v_me, p_school) OR pupil_recognised_at(v_me, p_school)) THEN')
    ) AS t(fn, was, now_) LOOP
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
      INTO v_src, v_cfg, v_acl, v_sec FROM pg_proc p WHERE p.oid = r.fn;
    IF position(r.now_ IN v_src) > 0 THEN CONTINUE; END IF;   -- a second run
    n := (length(v_src) - length(replace(v_src, r.was, ''))) / length(r.was);
    IF n <> 1 THEN
      RAISE EXCEPTION 'db/163: % holds its school condition % times, not once', r.fn, n;
    END IF;
    v_def := pg_get_functiondef(r.fn);
    EXECUTE replace(v_def, r.was, r.now_);
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = r.fn) IS DISTINCT FROM replace(v_src, r.was, r.now_)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = r.fn) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.fn) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = r.fn) IS DISTINCT FROM v_sec THEN
      RAISE EXCEPTION 'db/163: re-emitting % changed more than its school condition', r.fn;
    END IF;
  END LOOP;
END $sg$;


-- ── 7 · Who may call what ──────────────────────────────────────────
DO $grants$
DECLARE
  f text; r text;
  v_doors text[] := ARRAY['pupil_claim_send(uuid,text,text,date)', 'my_pupil_state()', 'pupil_claims(uuid)',
                          'pupil_claim_recognise(uuid,uuid)', 'pupil_claim_decline(uuid)', 'pupil_claim_clear(uuid)',
                          'pupil_claim_remove_self()', 'follow_school_by_id(uuid)'];
  v_internal text[] := ARRAY['pupil_account_opened(uuid)', 'pupil_claim_waiting(uuid)', 'pupil_recognised_at(uuid,uuid)',
                             'pupil_claim_office(uuid)', 'pupil_claim_keep_until(uuid)', 'pupil_claim_log(text,uuid,uuid[])',
                             'pupil_claim_remove_account(uuid)', 'pupil_claim_due(uuid)', 'pupil_claim_purge()',
                             'pupil_claim_refuses_asking()', 'person_is_pupil(uuid)'];
BEGIN
  FOREACH f IN ARRAY v_doors LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f::regprocedure);
  END LOOP;
  FOREACH f IN ARRAY v_internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f::regprocedure);
  END LOOP;
  -- A managed host's API roles (db/157).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF to_regrole(r) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON pupil_claim FROM %I', r);
      FOREACH f IN ARRAY v_doors || v_internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f::regprocedure, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── 8 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §141, and walked by
-- tools/smoke-signup.mjs (9) and tools/smoke-browser-under18.mjs.
DO $check$
DECLARE f text; v text; w text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'pupil_claim'::regclass) THEN
    RAISE EXCEPTION 'db/163: pupil_claim is not under row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pupil_claim')
     OR has_table_privilege('scrbrd_app', 'pupil_claim', 'SELECT') OR has_table_privilege('scrbrd_app', 'pupil_claim', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'pupil_claim', 'UPDATE') OR has_table_privilege('scrbrd_app', 'pupil_claim', 'DELETE') THEN
    RAISE EXCEPTION 'db/163: the application can reach pupil_claim other than through its functions';
  END IF;
  -- No date of birth, by any name, on the claim.
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'pupil_claim'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                AND (a.atttypid = 'date'::regtype AND a.attname <> 'said_under_18_on' OR a.attname ~ 'born|birth|dob')) THEN
    RAISE EXCEPTION 'db/163: pupil_claim holds a date other than the day he said he is under 18';
  END IF;
  FOREACH f IN ARRAY ARRAY['role_request', 'school_add_request'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = f::regclass AND tgname = f || '_pupil_waiting' AND tgenabled = 'O') THEN
      RAISE EXCEPTION 'db/163: the trigger %_pupil_waiting is missing or disabled', f;
    END IF;
  END LOOP;
  IF position('FROM pupil_claim c WHERE c.user_id = p_person' IN (SELECT prosrc FROM pg_proc WHERE oid = 'person_is_pupil(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/163: person_is_pupil() does not hold its third case';
  END IF;
  IF position('pupil_recognised_at(app_user_id(), sc.id)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'dso_contacts(uuid)'::regprocedure)) = 0
     OR position('pupil_recognised_at(v_me, p_school)' IN (SELECT prosrc FROM pg_proc
          WHERE oid = 'safeguarding_concern_raise(uuid,text,text[],text,text,text,uuid,uuid,text,date,text,text,boolean,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/163: the safeguarding card or the raise does not reach a recognised pupil';
  END IF;
  FOR f IN SELECT unnest(ARRAY['pupil_claim_send(uuid,text,text,date)', 'my_pupil_state()', 'pupil_claims(uuid)',
                               'pupil_claim_recognise(uuid,uuid)', 'pupil_claim_decline(uuid)', 'pupil_claim_clear(uuid)',
                               'pupil_claim_remove_self()', 'follow_school_by_id(uuid)',
                               'pupil_account_opened(uuid)', 'pupil_claim_waiting(uuid)', 'pupil_recognised_at(uuid,uuid)',
                               'pupil_claim_office(uuid)', 'pupil_claim_keep_until(uuid)', 'pupil_claim_log(text,uuid,uuid[])',
                               'pupil_claim_remove_account(uuid)', 'pupil_claim_due(uuid)', 'pupil_claim_purge()',
                               'pupil_claim_refuses_asking()', 'person_is_pupil(uuid)']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/163: % does not pin its search_path', f;
    END IF;
    IF f <> 'pupil_claim_purge()' AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/163: % is not a definer', f;
    END IF;
    -- Read back from the ACL: the owner, and scrbrd_app for a door; nobody else.
    SELECT coalesce(string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text), '')
      INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = f::regprocedure AND x.grantee <> p.proowner;
    w := CASE WHEN f IN ('pupil_claim_send(uuid,text,text,date)', 'my_pupil_state()', 'pupil_claims(uuid)',
                         'pupil_claim_recognise(uuid,uuid)', 'pupil_claim_decline(uuid)', 'pupil_claim_clear(uuid)',
                         'pupil_claim_remove_self()', 'follow_school_by_id(uuid)')
              THEN 'scrbrd_app:EXECUTE' ELSE '' END;
    IF v IS DISTINCT FROM w THEN
      RAISE EXCEPTION 'db/163: % is granted %', f, coalesce(nullif(v, ''), 'to nobody');
    END IF;
  END LOOP;
END $check$;
