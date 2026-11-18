-- ══════════════════════════════════════════════════════════════════
--  164 · "Allow his own sign-in": the yes for a pupil's own sign-in,
--        the gate in the core access check, and the office's tick
--        (SCRBRD-140, the honesty model, Migration B)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. SCRBRD-140's honesty model, Migration B and slice 3 of its
-- build plan, on Kameel's answers of 18 Nov 2026 (every question as
-- recommended). The answers this file stands on:
--   Q5  (a) what opens a pupil's own page is a separate "Allow his own
--           sign-in" yes, from a guardian with a live, verified link who
--           has agreed to the terms, or the office recording that the
--           school's signed form is on file.
--   Q6  (a) one yes opens it. Only the person who gave it, or the office,
--           closes it; another guardian who objects goes to the office.
--   Q7  (a) one computed question, asked by the core check and by every
--           function that answers a pupil about himself. Nothing stamped.
--   Q12 (a) for a child under 18 the office's grant needs the tick "The
--           signed consent form is on file", recorded with the office
--           person's name. Without it he is recognised and waits.
--   And the 29 Oct rule: a consent lapses when the link that gave it ends.
--
-- THE QUESTION. pupil_signin_in_force(player): is there a yes in force for
-- this boy today? Worked out when asked, never stamped (the design's §4.3):
--   * eighteen by the school's roster (majority_on(born), on Johannesburg's
--     day): yes, from that day and not the day before. Nothing he typed.
--   * no date of birth on the roster: no, whatever is on record. He stays
--     closed until the office records the date (§3.2).
--   * otherwise: a yes on record that still stands —
--       a guardian's: not followed by a no of hers (her "Stop his own
--         sign-in", or her withdrawal of the terms), not followed by the
--         office's no, and given on a link that is still live, verified and
--         agreed to the terms today (the 29 Oct rule; consent_giver_live()'s
--         tests, on the very link that gave it);
--       the office's (the form on file, or the stamp carried over below):
--         not followed by the office's no.
--   Another yes standing keeps him open (Q6).
--
-- THE GATE. pupil_signin_open(account): false for an account that answers
-- as a boy (its roster link, or a self link on one of its live
-- assignments) when any boy it answers as has no yes in force. True for
-- every other account, so nothing changes for anybody who is not a pupil.
-- An account holding `player` that names no boy at all (no roster link, no
-- self link) is NOT closed here: no boy, no family and no date of birth
-- stand behind it, so no yes could ever open it, and what it reads is its
-- side, not a child's own record. db/81's trigger already refuses it a
-- Google sign-in. Whether the gate should close it too is left to Kameel
-- (tools/pupil-signin-count.sql counts them: one on the seed, the
-- spectator@ pupil persona). Asked inside app_can(), app_holds(), app_enrolled() and the
-- functions that read the caller's own assignments without app_can():
-- every assignment of a closed account stops counting, at the next
-- statement. He is not signed out; his session reads what a signed-out
-- visitor reads, his own account row, his own state, and his school's
-- safeguarding card (person_live_at() is not gated: Q8). The code sign-in
-- (db/05 login_code_redeem(), which checks no consent) is covered the same
-- way: the gate is on what the account reads, not on the door.
--
-- WHAT A NO DOES NOT TAKE BACK. His guardians' own reads (her assignment is
-- not a pupil's; db/99 §142 (guardian)), the school's record of him, his
-- past answers, the match record, his follow list.
--
-- NOBODY ENROLLED TODAY IS CLOSED BY THE PASTE. Every live, verified own
-- link the office stamped "granted" before this file is carried over as the
-- office's yes (how 'enrolled', given by the person who verified the link,
-- at the stamp's time). It is the school's yes: under Q6 only the office
-- closes it. The count of accounts the gate would close is
-- tools/pupil-signin-count.sql, run before the paste.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   + pupil_signin_consent  the record: one row per yes or no, append-only,
--       ordered by seq. Who (the guardian or the office person, by id and by
--       name as it was), how (guardian · office · enrolled · terms_withdrawn),
--       her link and her terms version, the form on file, the time. RLS on,
--       no policy, no privilege: functions only (db/81's shape).
--   + pupil_signin_consent_set(player, yes)  the guardian's own tap.
--   + pupil_signin_office_set(player, yes)  the office: the signed form on
--       file (the Q12 tick, also used by the grant), or a withdrawal for a
--       parent who telephones (closes every yes before it).
--   + pupil_signin_state(player)  what the family and the office read.
--   + my_own_signin()  what the boy's own screen needs: is this a pupil's
--       account, and is it open.
--   + notification_pupil_signin (restrictive, on notification): a closed
--       account reads only the system's own notices addressed to it, and
--       so a notice to his side is neither read nor pushed to his phone
--       (§5b); pupil_signin_mine_open() is the policy's question.
--   + pupil_signin_terms_withdrawn (trigger on assignment_subject): her
--       withdrawal of the terms is recorded as her no, so agreeing again
--       later does not quietly reopen her old yes (a new tap is a new yes).
--       The gate does not depend on it: a link not agreed closes at once.
--   ~ app_can(), app_holds(), app_enrolled()  db/50's and db/81's bodies as
--       db/128 left them (sa_today()), with one line each:
--       AND pupil_signin_open(a.person_id). md5-guarded.
--   ~ app_enrolled_at() (db/107), app_can_but_player() (db/119),
--     is_family_of() (db/119), lift_at_school() (db/70),
--     scorebook_school_grant() (db/63): the same line. md5-guarded.
--   ~ my_own_boy() (db/106), recognition_self_players() (db/144),
--     my_health_consents() (db/60): nothing for a closed account.
--   ~ app_user_email_seen() (db/118): an account that has said it is a
--       pupil (db/163's pupil_claim, recognised or waiting) is a pupil's
--       for his address, at his claim's school: the office and the
--       principal there read it, a director of sport does not.
--   ~ role_request_grant_as() (db/92, db/108, db/128): his own link is
--       stamped "granted" only when a yes is in force (or he is eighteen);
--       otherwise "pending", and he waits (Q12).
--   ~ db/163's pupil_account_opened(), pupil_claim_waiting(),
--     my_pupil_state(), pupil_claims() and pupil_claim_keep_until():
--     "opened" now means opened and his sign-in in force; a page a no
--     closed again reads "closed"; an account holding a pupil's role has no
--     last day.
--
-- NOT RE-EMITTED, AND WHY. decide_role_request() keeps its five arguments
-- and its body: the tick is the office's yes, recorded first by
-- pupil_signin_office_set() in the same transaction (the API does it), and
-- the grant door asks the question itself. Functions on the map that NARROW
-- (person_is_pupil(), lift_is_pupil(), potm_is_the_boy(), match_award()'s
-- "cannot award yourself", injury_writer_is_family() ("family cannot
-- record"), school_add_request_ask()'s pupil refusal) are untouched: gating
-- them would widen. Functions that already ask app_can() on the path that
-- serves him (recognition(), news_sheet_reach(), my_own_sheet_fixtures(),
-- my_own_side_fixtures(), fixture_end_reach(), my_fixture_ends(),
-- my_sides(), side_reach_on()) are gated through it. Those that only ever
-- answer an adult boy (lift_self_accounts(), my_lifts()'s
-- lift_adult_self(), passport_consent_writer_ok()'s own arm,
-- person_pupil_of_age(), health_giver_link_live()'s own arm) cannot change:
-- an adult is always in force. app_user_email_seen() answers him his own
-- address, which is his account.
--
-- Every function: SECURITY DEFINER, search_path pinned, REVOKE ALL FROM
-- PUBLIC; the doors GRANT EXECUTE to scrbrd_app by name; nothing to anon,
-- authenticated or service_role (db/157). No BEGIN or COMMIT: the paste
-- wraps the file in one transaction. Safe to run twice. Its proof is
-- db/99 §142.


-- ── 0 · What this file stands on ───────────────────────────────────
DO $guard$
BEGIN
  IF to_regprocedure('app_user_id()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('majority_on(date)') IS NULL
     OR to_regprocedure('guardian_link_reopened_since(uuid,timestamptz)') IS NULL
     OR to_regprocedure('lift_cuts_ok(uuid)') IS NULL
     OR to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)') IS NULL
     OR to_regprocedure('pupil_claim_office(uuid)') IS NULL OR to_regprocedure('pupil_claim_log(text,uuid,uuid[])') IS NULL
     OR to_regprocedure('pupil_account_opened(uuid)') IS NULL OR to_regclass('pupil_claim') IS NULL
     OR to_regprocedure('app_enrolled_at(uuid)') IS NULL OR to_regprocedure('app_can_but_player(text,uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/164: app_user_id() (db/01), sa_today() (db/08), guardian_link_reopened_since() (db/124), lift_cuts_ok() (db/70), role_request_grant_as() (db/92), app_enrolled_at() (db/107), app_can_but_player() (db/119) or db/163''s pupil claim is missing; apply them first';
  END IF;
END $guard$;

-- The bodies this file replaces, each as the files before it left it, or
-- as this file leaves it (a second paste). Anything else stops the paste:
-- a body that has moved since is not the one this file was written
-- against. Each is changed by exactly the text in §5 and nothing else.
DROP TABLE IF EXISTS _db164_bodies;
CREATE TEMP TABLE _db164_bodies (fn text PRIMARY KEY, was_md5 text, mine_md5 text);
INSERT INTO _db164_bodies VALUES
  ('app_can(text,uuid,text,uuid,uuid)',                '7fa3e089f052d42790d0e7f07556fa28', 'e8e8848ae0d30642c702502d9a3ed628'),
  ('app_holds(text)',                                  'f53697b4a90fbd2427ef7fe9de415f06', 'ba639a44481e5537cc5320e8711962f7'),
  ('app_enrolled()',                                   '9a3b74b8b64875c6a8e6244deafcfadb', 'aa23d9277a9f600eccbb7c1582b8e22c'),
  ('app_enrolled_at(uuid)',                            '430da167a8cb3fbd8b487e345d649052', '3d62ae8be6c326efacd2728a3f332323'),
  ('app_can_but_player(text,uuid,text,uuid,uuid)',     '14c226c6660d49d093fc5999d7453ee0', '228c672a6dd87642a95b535901186673'),
  ('is_family_of(uuid)',                               '3bbf4d725a9a92aa62dd83168f929192', '04afe1ecb8a74b78ec6c8ff97f274dd3'),
  ('lift_at_school(uuid)',                             '1af38f3d54786fa3beca0383ec6bf0a3', 'cc6a0f8001bb50b68a6dbeeaff9f8b67'),
  ('scorebook_school_grant(text[],uuid)',              'b9e15f6864dea8ae6835d387a690039d', 'f45fb0c191848dd615756423aee030f4'),
  ('my_own_boy()',                                     '4487337328df5d7df121e3381ed9aef1', '884642135bf09d59441d8ebd18fe95e6'),
  ('recognition_self_players()',                       'e4816a75bb16729ea59233e7399dd135', '96dab531dd0692e5f499eda2ac062e56'),
  ('my_health_consents()',                             'e7b25292d376488fb390b453998e829a', 'a8f1cdfca325430b57b66115b3dfba95'),
  ('role_request_grant_as(uuid,uuid,text,uuid,text)',  '5ac61a0386e299220d485d0fc744e8c7', '6ec179e5ccb6d8afdbdc8ac3d2c317e4'),
  ('my_pupil_state()',                                 '7e617a2bf3c80223c9dbec592604b56b', '2d959dd176152fb275f61eede6ea95a6'),
  ('pupil_claims(uuid)',                               '236d0ff30f96f570723d5259109bb247', '608b9e8e2b97267f624afb9401aa67e4'),
  ('pupil_account_opened(uuid)',                       '4ab87c3767211d5c959c4a43da18a2b9', '19eae6d7d5419182ba3eb242a6147b70'),
  ('pupil_claim_waiting(uuid)',                        'e2dca119c869fadd964e73c6d98e0278', '08b401e4f64ebcd5ab38130ac488f81b'),
  ('pupil_claim_keep_until(uuid)',                     'b64dbe01c336708bac142f86cdf60120', 'a65471e9e4eeb6cd0b3a37772f698c68'),
  ('app_user_email_seen(uuid,uuid,text)',              '7116c9e13ddd993d8b65c9a6656255cf', 'eb52d82ad0748f99a45b9e1aaa11e6c8');
DO $bodies$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM _db164_bodies LOOP
    v := (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn));
    IF v IS NULL THEN
      RAISE EXCEPTION 'db/164: % is not there', r.fn;
    END IF;
    IF v NOT IN (r.was_md5, r.mine_md5) THEN
      RAISE EXCEPTION 'db/164: % is neither as the files before this one left it nor this file''s (md5 %); factor the version now in place and move its hash', r.fn, v;
    END IF;
  END LOOP;
END $bodies$;


-- ── 0b · Ten seconds for a lock, or nothing (db/158's pattern) ──────
-- The trigger locks assignment_subject, and re-emitting app_can() waits on
-- every statement that is reading through it. A paste that cannot get a
-- lock in ten seconds stops and changes nothing: paste it again, outside a
-- match.
DO $lock$
BEGIN
  PERFORM set_config('lock_timeout', '10s', true);
END $lock$;


-- ── 1 · The record ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pupil_signin_consent (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The order things were said in: a no closes only the yeses before it.
  seq            bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  player_id      uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  answer         text NOT NULL CHECK (answer IN ('yes', 'no')),
  -- guardian         her own tap: "Allow his own sign-in" or "Stop his own sign-in"
  -- office           the office: the signed form on file (yes), or a
  --                  withdrawal recorded for a parent (no)
  -- enrolled         (yes) the office's stamp on his own link before db/164
  -- terms_withdrawn  (no) her withdrawal of the terms, recorded as it happened
  how            text NOT NULL CHECK (how IN ('guardian', 'office', 'enrolled', 'terms_withdrawn')),
  given_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  -- The name as it was when it was said: the record names a person.
  given_by_name  text CHECK (given_by_name IS NULL OR char_length(given_by_name) <= 200),
  -- A guardian's: the link (assignment_subject.id) she said it on.
  link_id        uuid,
  -- A guardian's yes: the terms she had agreed to (her link's consent_version).
  terms_version  text CHECK (terms_version IS NULL OR char_length(terms_version) <= 40),
  -- The office's yes is the signed form, on file (Q12's tick).
  form_on_file   boolean NOT NULL DEFAULT false,
  given_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pupil_signin_consent_shape CHECK (
        (how = 'guardian'        AND link_id IS NOT NULL AND (answer = 'no' OR terms_version IS NOT NULL))
     OR (how = 'office'          AND link_id IS NULL AND (answer = 'no' OR form_on_file))
     OR (how = 'enrolled'        AND answer = 'yes' AND link_id IS NULL)
     OR (how = 'terms_withdrawn' AND answer = 'no' AND link_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pupil_signin_consent_player_idx ON pupil_signin_consent (player_id, seq);

COMMENT ON TABLE pupil_signin_consent IS
  'db/164 (SCRBRD-140 honesty model, Migration B): every yes and no for a pupil''s own sign-in, append-only. Read by pupil_signin_in_force(); functions only.';

ALTER TABLE pupil_signin_consent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pupil_signin_consent FROM PUBLIC;
REVOKE ALL ON pupil_signin_consent FROM scrbrd_app;


-- ── 2 · The question ───────────────────────────────────────────────
-- Does this yes still stand? Not followed by a no of the same giver's (her
-- stop, her terms withdrawal), or by the office's no. A guardian's only
-- while the link she gave it on is live, verified and agreed to the terms
-- today, was there when she said it, and has not been reopened since he
-- came back to school (db/124's rule): the 29 Oct rule, on her own link.
CREATE OR REPLACE FUNCTION pupil_signin_yes_stands(p_yes uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM pupil_signin_consent y
     WHERE y.id = p_yes AND y.answer = 'yes'
       AND NOT EXISTS (SELECT 1 FROM pupil_signin_consent n
                        WHERE n.player_id = y.player_id AND n.answer = 'no' AND n.seq > y.seq
                          AND (n.how = 'office'
                               OR (y.how = 'guardian' AND n.given_by IS NOT NULL AND n.given_by = y.given_by)))
       AND (y.how <> 'guardian' OR EXISTS (
             SELECT 1 FROM assignment_subject s
               JOIN role_assignment a ON a.id = s.assignment_id
              WHERE s.id = y.link_id AND s.player_id = y.player_id
                AND a.person_id = y.given_by AND a.role = 'guardian'
                AND s.relationship IS DISTINCT FROM 'self'
                AND a.active
                AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
                AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
                AND (a.expires_at  IS NULL OR a.expires_at  >  now())
                AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
                AND s.verification_state = 'verified'
                AND s.consent_state = 'granted'
                AND s.valid_from <= sa_today()
                AND (s.valid_until IS NULL OR s.valid_until > sa_today())
                AND a.created_at <= y.given_at AND s.created_at <= y.given_at
                AND NOT guardian_link_reopened_since(y.player_id, y.given_at))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- THE ONE QUESTION (Q7): is there a yes in force for this boy today?
CREATE OR REPLACE FUNCTION pupil_signin_in_force(p_player uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM player p
     WHERE p.id = p_player AND p.born IS NOT NULL
       AND (majority_on(p.born) <= sa_today()
            OR EXISTS (SELECT 1 FROM pupil_signin_consent y
                        WHERE y.player_id = p.id AND y.answer = 'yes' AND pupil_signin_yes_stands(y.id))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- THE GATE: may this account's assignments count? Yes for any account that
-- answers as no boy. An account that answers as a boy (its roster link, or
-- a self link on one of its live assignments) only while every boy it
-- answers as has a yes in force. (A `player` naming no boy: see the
-- header.) NULL (no caller) is open: such a caller holds nothing anyway.
CREATE OR REPLACE FUNCTION pupil_signin_open(p_account uuid) RETURNS boolean AS $$
  SELECT p_account IS NULL OR NOT EXISTS (
    SELECT 1 FROM (
      SELECT u.player_id AS id FROM app_user u WHERE u.id = p_account AND u.player_id IS NOT NULL
      UNION
      SELECT g.player_id FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
       WHERE a.person_id = p_account AND a.active AND g.relationship = 'self') b
     WHERE NOT pupil_signin_in_force(b.id))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
   COST 500;

-- Is this account a pupil's at all (the gate's first test)?
CREATE OR REPLACE FUNCTION pupil_signin_is_pupils(p_account uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_account AND u.player_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = p_account AND a.active
                    AND (a.role IN ('player', 'selfaccess')
                         OR EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id AND g.relationship = 'self')))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The grant door's stamp on his own link (Q12): 'granted' only when the
-- question says yes (he is eighteen, or a yes is in force), else 'pending'.
CREATE OR REPLACE FUNCTION pupil_signin_stamp(p_player uuid) RETURNS text AS $$
  SELECT CASE WHEN pupil_signin_in_force(p_player) THEN 'granted' ELSE 'pending' END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · What a yes sets going ──────────────────────────────────────
-- Called after a yes is recorded. If the boy is now in force: his own links
-- still 'pending' (a grant without the tick) are stamped 'granted', so
-- db/81's trigger lets a Google sign-in on to his account (§3.6); and an
-- account the office recognised and that waits (db/163) is opened through
-- the one grant door, which asks the question itself. A grant the door
-- refuses (no side on the roster, say) leaves him recognised; the yes
-- stays on record and opens him when the office fixes it and says yes
-- again. Answers the door's refusal, or NULL.
CREATE OR REPLACE FUNCTION pupil_signin_after_yes(p_player uuid, p_version text) RETURNS text AS $$
DECLARE c pupil_claim%ROWTYPE; v_req uuid; v_ok boolean; v_why text;
BEGIN
  IF NOT pupil_signin_in_force(p_player) THEN RETURN 'not_in_force'; END IF;
  UPDATE assignment_subject g
     SET consent_state = 'granted', consent_version = coalesce(p_version, 'popia-2026-01'), consent_at = now()
   WHERE g.player_id = p_player AND g.relationship = 'self'
     AND g.verification_state = 'verified' AND g.consent_state = 'pending'
     AND (g.valid_until IS NULL OR g.valid_until > sa_today());
  SELECT * INTO c FROM pupil_claim x WHERE x.player_id = p_player AND x.state = 'recognised' FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = c.user_id AND u.active) THEN RETURN NULL; END IF;
  IF pupil_signin_is_pupils(c.user_id) THEN
    -- Already enrolled by the office (today's path): the yes opened him.
    UPDATE pupil_claim SET state = 'open' WHERE id = c.id;
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO role_request (person_id, role, school_id, player_id, note)
    VALUES (c.user_id, 'player', c.school_id, p_player, 'His own sign-in: a yes on record')
    RETURNING id INTO v_req;
    SELECT d.ok, d.reason INTO v_ok, v_why
      FROM role_request_grant_as(v_req, coalesce(c.known_by, app_user_id()), 'His own sign-in: a yes on record', p_player, NULL) d;
    IF NOT coalesce(v_ok, false) THEN
      RAISE EXCEPTION 'pupil_signin_open_refused:%', coalesce(v_why, 'refused') USING ERRCODE = 'check_violation';
    END IF;
    UPDATE pupil_claim SET state = 'open' WHERE id = c.id;
  EXCEPTION WHEN check_violation OR unique_violation OR foreign_key_violation THEN
    RETURN coalesce(substring(SQLERRM FROM 'pupil_signin_open_refused:(.*)'), 'refused');
  END;
  RETURN NULL;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The caller's own live, verified guardian link to the boy, the agreed one
-- first: (link, agreed, terms version). None: not his guardian.
CREATE OR REPLACE FUNCTION pupil_signin_my_link(p_player uuid)
RETURNS TABLE (link_id uuid, agreed boolean, terms_version text) AS $$
  SELECT s.id, s.consent_state = 'granted', s.consent_version
    FROM role_assignment a JOIN assignment_subject s ON s.assignment_id = a.id
   WHERE a.person_id = app_user_id() AND a.role = 'guardian' AND s.player_id = p_player
     AND s.relationship IS DISTINCT FROM 'self'
     AND a.active
     AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
     AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
     AND (a.expires_at  IS NULL OR a.expires_at  >  now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
     AND s.verification_state = 'verified'
     AND s.valid_from <= sa_today()
     AND (s.valid_until IS NULL OR s.valid_until > sa_today())
   ORDER BY (s.consent_state = 'granted') DESC, s.created_at DESC
   LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · The doors ──────────────────────────────────────────────────
/**
 * THE GUARDIAN'S TAP (Q5, Q6): "Allow his own sign-in" (p_yes true) or
 * "Stop his own sign-in" (false), as herself, on her own live, verified
 * link. Never under a support hour, a platform-wide key or a pad. Answers
 * (ok, reason, in_force):
 *   ok                  recorded (or her yes already stands); in_force is
 *                       the question's answer now
 *   not_signed_in       no session, or a pad's credential
 *   not_permitted       not his guardian today (also for an id that is no
 *                       boy, so a stranger learns nothing)
 *   answer_required     neither yes nor no
 *   player_is_an_adult  he is eighteen: his own sign-in is his (§3.5)
 *   terms_not_agreed    her link has not agreed to the school's terms
 *   no_date_of_birth    the school has no date of birth for him: a yes
 *                       would open nothing (§3.2); the office records it
 *   not_yours_to_stop   she has no yes of her own standing; a yes given by
 *                       someone else is closed by them or the office (Q6)
 */
CREATE OR REPLACE FUNCTION pupil_signin_consent_set(p_player uuid, p_yes boolean)
RETURNS TABLE (ok boolean, reason text, in_force boolean) AS $$
DECLARE
  v_me uuid := app_user_id();
  v_school uuid; v_born date;
  l record; v_mine uuid; v_id uuid; v_name text;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_signed_in'::text, NULL::boolean; RETURN; END IF;
  SELECT p.school_id, p.born INTO v_school, v_born FROM player p WHERE p.id = p_player;
  IF v_school IS NULL OR NOT lift_cuts_ok(v_school) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean; RETURN;
  END IF;
  SELECT * INTO l FROM pupil_signin_my_link(p_player);
  IF l.link_id IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean; RETURN; END IF;
  IF p_yes IS NULL THEN RETURN QUERY SELECT false, 'answer_required'::text, NULL::boolean; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_signin:' || p_player::text, 164));
  IF v_born IS NOT NULL AND majority_on(v_born) <= sa_today() THEN
    RETURN QUERY SELECT false, 'player_is_an_adult'::text, true; RETURN;
  END IF;
  SELECT y.id INTO v_mine FROM pupil_signin_consent y
   WHERE y.player_id = p_player AND y.answer = 'yes' AND y.how = 'guardian' AND y.given_by = v_me
     AND pupil_signin_yes_stands(y.id)
   ORDER BY y.seq DESC LIMIT 1;
  v_name := (SELECT left(u.name, 200) FROM app_user u WHERE u.id = v_me);
  IF p_yes THEN
    IF NOT l.agreed THEN RETURN QUERY SELECT false, 'terms_not_agreed'::text, pupil_signin_in_force(p_player); RETURN; END IF;
    IF v_born IS NULL THEN RETURN QUERY SELECT false, 'no_date_of_birth'::text, false; RETURN; END IF;
    IF v_mine IS NULL THEN
      INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, link_id, terms_version)
      VALUES (p_player, 'yes', 'guardian', v_me, v_name, l.link_id, l.terms_version)
      RETURNING id INTO v_id;
      PERFORM pupil_claim_log('pupil_signin.yes', v_school, ARRAY[v_id]);
    END IF;
    PERFORM pupil_signin_after_yes(p_player, l.terms_version);
  ELSE
    IF v_mine IS NULL THEN
      RETURN QUERY SELECT false, 'not_yours_to_stop'::text, pupil_signin_in_force(p_player); RETURN;
    END IF;
    INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, link_id)
    VALUES (p_player, 'no', 'guardian', v_me, v_name, l.link_id)
    RETURNING id INTO v_id;
    PERFORM pupil_claim_log('pupil_signin.no', v_school, ARRAY[v_id]);
  END IF;
  RETURN QUERY SELECT true, NULL::text, pupil_signin_in_force(p_player);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * THE OFFICE (Q12, §3.4): p_yes true records "The signed consent form is on
 * file", under the office person's name; it is the tick the grant asks for.
 * false records a withdrawal (a parent who telephones, a court order): it
 * closes every yes before it, the family's and the school's. The office:
 * guardian.link.manage at his school, never under a support hour, a
 * platform-wide key or a pad (db/163's pupil_claim_office()). Answers (ok,
 * reason, in_force): not_signed_in · not_permitted · answer_required ·
 * player_is_an_adult · no_date_of_birth (a yes only; the office records
 * his date of birth first).
 */
CREATE OR REPLACE FUNCTION pupil_signin_office_set(p_player uuid, p_yes boolean)
RETURNS TABLE (ok boolean, reason text, in_force boolean) AS $$
DECLARE v_me uuid := app_user_id(); v_school uuid; v_born date; v_id uuid;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_signed_in'::text, NULL::boolean; RETURN; END IF;
  SELECT p.school_id, p.born INTO v_school, v_born FROM player p WHERE p.id = p_player;
  IF v_school IS NULL OR NOT pupil_claim_office(v_school) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean; RETURN;
  END IF;
  IF p_yes IS NULL THEN RETURN QUERY SELECT false, 'answer_required'::text, NULL::boolean; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_signin:' || p_player::text, 164));
  IF p_yes THEN
    IF v_born IS NOT NULL AND majority_on(v_born) <= sa_today() THEN
      RETURN QUERY SELECT false, 'player_is_an_adult'::text, true; RETURN;
    END IF;
    IF v_born IS NULL THEN RETURN QUERY SELECT false, 'no_date_of_birth'::text, false; RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pupil_signin_consent y
                    WHERE y.player_id = p_player AND y.answer = 'yes' AND y.how = 'office'
                      AND pupil_signin_yes_stands(y.id)) THEN
      INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, form_on_file)
      VALUES (p_player, 'yes', 'office', v_me, (SELECT left(u.name, 200) FROM app_user u WHERE u.id = v_me), true)
      RETURNING id INTO v_id;
      PERFORM pupil_claim_log('pupil_signin.form_on_file', v_school, ARRAY[v_id]);
    END IF;
    PERFORM pupil_signin_after_yes(p_player, NULL);
  ELSE
    INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name)
    VALUES (p_player, 'no', 'office', v_me, (SELECT left(u.name, 200) FROM app_user u WHERE u.id = v_me))
    RETURNING id INTO v_id;
    PERFORM pupil_claim_log('pupil_signin.withdrawn', v_school, ARRAY[v_id]);
  END IF;
  RETURN QUERY SELECT true, NULL::text, pupil_signin_in_force(p_player);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * WHAT THE FAMILY AND THE OFFICE READ (§5.2). A guardian with a live,
 * verified link to him, or the office; nothing for anybody else (the boy
 * reads his own through my_own_signin()). At most one row:
 *   in_force    the question's answer today
 *   adult       eighteen by the roster
 *   born_known  the school has his date of birth
 *   yes_how     the yes keeping him open: guardian · office · enrolled (NULL)
 *   yes_by      who gave it: her own name to her; "the guardian" for another
 *               guardian's yes (to the family); the office person's name to
 *               the office, "the school office" to the family
 *   yes_at      when
 *   yours       the yes standing is the caller's own
 *   can_allow   she may say yes now (agreed, under 18, date known)
 *   can_stop    she has a yes of her own to stop
 *   office      the caller reads as the office
 */
CREATE OR REPLACE FUNCTION pupil_signin_state(p_player uuid)
RETURNS TABLE (in_force boolean, adult boolean, born_known boolean, yes_how text, yes_by text, yes_at timestamptz,
               yours boolean, can_allow boolean, can_stop boolean, office boolean) AS $$
DECLARE v_me uuid := app_user_id(); p player%ROWTYPE; l record; v_office boolean; y pupil_signin_consent%ROWTYPE;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN RETURN; END IF;
  SELECT * INTO p FROM player x WHERE x.id = p_player;
  IF NOT FOUND OR NOT lift_cuts_ok(p.school_id) THEN RETURN; END IF;
  SELECT * INTO l FROM pupil_signin_my_link(p_player);
  v_office := pupil_claim_office(p.school_id);
  IF l.link_id IS NULL AND NOT v_office THEN RETURN; END IF;
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
  can_allow := l.link_id IS NOT NULL AND coalesce(l.agreed, false) AND born_known AND NOT adult AND NOT yours;
  can_stop := yours AND NOT adult;
  office := v_office;
  RETURN NEXT;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * WHAT HIS OWN SCREEN NEEDS. One row for a signed-in account:
 *   pupil   the account is a pupil's (a roster link, a self link, a pupil's role)
 *   open    his own sign-in is in force (always true for an account that is
 *           not a pupil's)
 *   school_id, school_name  his school, by his roster row, for the sentence
 * Never his roster name, his team, a birthday or who said what.
 */
CREATE OR REPLACE FUNCTION my_own_signin()
RETURNS TABLE (pupil boolean, open boolean, school_id uuid, school_name text) AS $$
  SELECT pupil_signin_is_pupils(app_user_id()), pupil_signin_open(app_user_id()), s.id, s.name
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT p.school_id FROM player p
       WHERE p.id = (SELECT u.player_id FROM app_user u WHERE u.id = app_user_id())
          OR p.id IN (SELECT g.player_id FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
                       WHERE a.person_id = app_user_id() AND a.active AND g.relationship = 'self')
       ORDER BY p.id LIMIT 1) b ON true
    LEFT JOIN school s ON s.id = b.school_id
   WHERE app_user_id() IS NOT NULL AND NOT app_pad_scoped()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4b · Her withdrawal of the terms is her no ─────────────────────
-- AFTER UPDATE OF consent_state: a guardian's link leaving 'granted'
-- (guardian_consent_withdraw(), db/08) is recorded as her no for that boy,
-- where she has a yes on record. The question already closes him the
-- moment her link is not agreed; this row only keeps a later agreement
-- from reopening the old yes without a new tap.
CREATE OR REPLACE FUNCTION pupil_signin_terms_withdrawn() RETURNS trigger AS $$
BEGIN
  IF OLD.consent_state = 'granted' AND NEW.consent_state IS DISTINCT FROM 'granted'
     AND NEW.relationship IS DISTINCT FROM 'self' THEN
    INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, link_id)
    SELECT NEW.player_id, 'no', 'terms_withdrawn', a.person_id, left(u.name, 200), NEW.id
      FROM role_assignment a JOIN app_user u ON u.id = a.person_id
     WHERE a.id = NEW.assignment_id AND a.role = 'guardian'
       AND EXISTS (SELECT 1 FROM pupil_signin_consent y
                    WHERE y.player_id = NEW.player_id AND y.answer = 'yes' AND y.how = 'guardian'
                      AND y.given_by = a.person_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER pupil_signin_terms_withdrawn
  AFTER UPDATE OF consent_state ON assignment_subject
  FOR EACH ROW EXECUTE FUNCTION pupil_signin_terms_withdrawn();


-- ── 5 · The gate, and the doors that already read his own ──────────
-- Each body re-emitted from the catalog (pg_get_functiondef, as db/128 and
-- db/163 do), with the one change below and nothing else; rights,
-- settings, volatility and owner checked unchanged. A second paste finds
-- its mark and leaves the body alone (and §0 has already checked that body
-- is this file's, by its md5).
DO $gate$
DECLARE
  G constant text := '       -- db/164: a pupil''s own account counts only while his own sign-in is in force.' || chr(10)
                  || '       AND pupil_signin_open(a.person_id)' || chr(10);
  r record;
  v_src text; v_def text; v_cfg text; v_acl text; v_sec boolean; v_vol "char"; v_own oid; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      -- The core check, and its two siblings: every assignment of a closed account.
      ('app_can(text,uuid,text,uuid,uuid)', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      ('app_holds(text)', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      ('app_enrolled()', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      -- The readers of the caller's own assignments that do not go through app_can().
      ('app_enrolled_at(uuid)', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      ('app_can_but_player(text,uuid,text,uuid,uuid)', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      ('is_family_of(uuid)', 1,
       '   WHERE a.person_id = app_user_id() AND a.active' || chr(10),
       '   WHERE a.person_id = app_user_id() AND a.active' || chr(10) || G),
      ('lift_at_school(uuid)', 1,
       '     WHERE a.person_id = app_user_id() AND a.school_id = p_school AND a.active' || chr(10),
       '     WHERE a.person_id = app_user_id() AND a.school_id = p_school AND a.active' || chr(10) || G),
      ('scorebook_school_grant(text[],uuid)', 1,
       '     WHERE m.id = p_match' || chr(10),
       '     WHERE m.id = p_match' || chr(10) || G),
      ('my_health_consents()', 1,
       '       AND NOT app_pad_scoped()' || chr(10),
       '       AND NOT app_pad_scoped()' || chr(10) || G),
      -- The boy the caller IS, and the boy who answers for himself as captain: none.
      ('my_own_boy()', 1,
       ') x(b)' || chr(10),
       ') x(b)' || chr(10) || '   -- db/164: none while his own sign-in is not in force.' || chr(10)
                || '   WHERE pupil_signin_open(app_user_id())' || chr(10)),
      ('recognition_self_players()', 1,
       'OR app_support_access_id() IS NOT NULL THEN ',
       'OR app_support_access_id() IS NOT NULL OR NOT pupil_signin_open(app_user_id()) THEN '),
      -- The grant door (Q12): his own link stamped 'granted' only with a yes in force.
      ('role_request_grant_as(uuid,uuid,text,uuid,text)', 2,
       '''self'', ''verified'', p_decider, now(), ''granted'', ''popia-2026-01'', now(), p_decider);',
       '''self'', ''verified'', p_decider, now(), pupil_signin_stamp(v_player), '
         || 'CASE WHEN pupil_signin_stamp(v_player) = ''granted'' THEN ''popia-2026-01'' END, '
         || 'CASE WHEN pupil_signin_stamp(v_player) = ''granted'' THEN now() END, p_decider);'),
      -- db/163's two readers of his claim's state: a page a no closed again reads 'closed'.
      ('my_pupil_state()', 1,
       'CASE WHEN pupil_account_opened(c.user_id) THEN ''open'' ELSE c.state END',
       'CASE WHEN pupil_account_opened(c.user_id) THEN ''open'' WHEN c.state = ''open'' THEN ''closed'' ELSE c.state END'),
      ('pupil_claims(uuid)', 1,
       'CASE WHEN pupil_account_opened(c.user_id) THEN ''open'' ELSE c.state END',
       'CASE WHEN pupil_account_opened(c.user_id) THEN ''open'' WHEN c.state = ''open'' THEN ''closed'' ELSE c.state END'),
      -- db/163's "opened": opened AND his sign-in in force; a claim waits until then.
      ('pupil_account_opened(uuid)', 1,
       '  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL)' || chr(10) || '      OR EXISTS',
       '  SELECT pupil_signin_open(p_person) AND EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL)' || chr(10)
         || '      OR pupil_signin_open(p_person) AND EXISTS'),
      ('pupil_claim_waiting(uuid)', 1,
       'c.user_id = p_person AND c.state <> ''open'')',
       'c.user_id = p_person)'),
      -- An account holding a pupil's role is never removed by the 30-day keep:
      -- it has no last day (db/163 refuses to remove it anyway).
      ('pupil_claim_keep_until(uuid)', 1,
       'CASE WHEN c.state = ''open'' OR pupil_account_opened(c.user_id) THEN NULL',
       'CASE WHEN c.state = ''open'' OR pupil_account_opened(c.user_id) OR pupil_signin_is_pupils(c.user_id) THEN NULL'),
      -- db/118's address rule: an account that has said it is a pupil (db/163's
      -- third case of person_is_pupil(), recognised or still waiting) is a
      -- pupil's, at the school of his claim, so only that school's office and
      -- principal read his address (R4) -- also on a request he sent before he
      -- claimed, which a director of sport otherwise reads.
      ('app_user_email_seen(uuid,uuid,text)', 1,
       '           WHERE a.person_id = p_user AND a.role IN (''player'', ''selfaccess'')) z;',
       '           WHERE a.person_id = p_user AND a.role IN (''player'', ''selfaccess'')' || chr(10)
         || '          UNION ALL' || chr(10)
         || '          -- db/164: an account that has said it is a pupil (db/163), at his claim''s school.' || chr(10)
         || '          SELECT c.school_id FROM pupil_claim c WHERE c.user_id = p_user) z;')
    ) AS t(fn, times, was, now_) LOOP
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef, p.provolatile, p.proowner
      INTO v_src, v_cfg, v_acl, v_sec, v_vol, v_own FROM pg_proc p WHERE p.oid = r.fn::regprocedure;
    -- A second run: §0 checked the body is this file's.
    IF md5(v_src) = (SELECT b.mine_md5 FROM _db164_bodies b WHERE b.fn = r.fn) THEN CONTINUE; END IF;
    n := (length(v_src) - length(replace(v_src, r.was, ''))) / length(r.was);
    IF n <> r.times THEN
      RAISE EXCEPTION 'db/164: % holds the text it changes % times, not %', r.fn, n, r.times;
    END IF;
    v_def := pg_get_functiondef(r.fn::regprocedure);
    EXECUTE replace(v_def, r.was, r.now_);
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM replace(v_src, r.was, r.now_)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_sec
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_vol
       OR (SELECT p.proowner FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_own THEN
      RAISE EXCEPTION 'db/164: re-emitting % changed more than its one change', r.fn;
    END IF;
  END LOOP;
END $gate$;


-- ── 5b · His notices, and their delivery to his phone ─────────────
-- Every route by which a notice is read (notification_read and the side's,
-- the sheet's and the team-wide policies) asks app_can() or my_own_boy(),
-- which the gate above already closes. This restrictive policy says the
-- rule once more, on the notice itself, so that no notice route added later
-- can miss it: an account whose own sign-in is not in force reads only the
-- system's own notices addressed to it (§3.3's left column: "A parent has
-- said yes", "The school has answered", a role that ended). Delivery to a
-- phone follows: services/api/notify/push-api.mjs fanOut() asks, as each
-- recipient, `select 1 from notification where id = $1` before it sends,
-- and records the delivery as the recipient under the same policy
-- (notification_delivery_insert), so a closed boy's phone is sent nothing
-- and no delivery can be written to him. The question is asked once per
-- statement (an initplan), not once per row.
CREATE OR REPLACE FUNCTION pupil_signin_mine_open() RETURNS boolean AS $$
  SELECT pupil_signin_open(app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DO $notice$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification'::regclass AND polname = 'notification_pupil_signin') THEN
    CREATE POLICY notification_pupil_signin ON notification AS RESTRICTIVE
      FOR SELECT USING (
        (SELECT pupil_signin_mine_open())
        OR (kind = 'system' AND recipient_id = app_user_id())
      );
  END IF;
END $notice$;


-- ── 6 · Nobody enrolled today is closed: the stamp carried over ─────
-- Every boy whose own link is live, verified and stamped 'granted' (the
-- office's grant, db/92, or the paths before it) has that stamp carried
-- over as the office's yes, given by the person who verified the link, at
-- the stamp's time. Only for a boy with nothing on record yet, so a second
-- paste, or the seed after the migrations, never adds a yes behind a no.
-- Owner-only; answers how many boys it carried over.
CREATE OR REPLACE FUNCTION pupil_signin_carry_over() RETURNS integer AS $$
DECLARE n integer;
BEGIN
  INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, terms_version, given_at)
  SELECT DISTINCT ON (g.player_id) g.player_id, 'yes', 'enrolled', g.verified_by, left(u.name, 200), g.consent_version,
         coalesce(g.consent_at, g.verified_at, g.created_at)
    FROM assignment_subject g
    JOIN role_assignment a ON a.id = g.assignment_id
    LEFT JOIN app_user u ON u.id = g.verified_by
   WHERE g.relationship = 'self' AND g.verification_state = 'verified' AND g.consent_state = 'granted'
     AND a.active AND (g.valid_until IS NULL OR g.valid_until > sa_today())
     AND NOT EXISTS (SELECT 1 FROM pupil_signin_consent x WHERE x.player_id = g.player_id)
   ORDER BY g.player_id, g.consent_at NULLS LAST, g.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;

DO $carry$
DECLARE n integer;
BEGIN
  n := pupil_signin_carry_over();
  RAISE NOTICE 'db/164: % boy(s) enrolled before this file keep their own sign-in, as the office''s yes', n;
END $carry$;


-- ── 7 · Who may call what ──────────────────────────────────────────
DO $grants$
DECLARE
  f text; r text;
  v_doors text[] := ARRAY['pupil_signin_consent_set(uuid,boolean)', 'pupil_signin_office_set(uuid,boolean)',
                          'pupil_signin_state(uuid)', 'my_own_signin()', 'pupil_signin_mine_open()'];
  v_internal text[] := ARRAY['pupil_signin_yes_stands(uuid)', 'pupil_signin_in_force(uuid)', 'pupil_signin_open(uuid)',
                             'pupil_signin_is_pupils(uuid)', 'pupil_signin_stamp(uuid)', 'pupil_signin_after_yes(uuid,text)',
                             'pupil_signin_my_link(uuid)', 'pupil_signin_terms_withdrawn()', 'pupil_signin_carry_over()'];
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
      EXECUTE format('REVOKE ALL ON pupil_signin_consent FROM %I', r);
      FOREACH f IN ARRAY v_doors || v_internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f::regprocedure, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── 8 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §142.
DO $check$
DECLARE f text; v text; w text; r record;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'pupil_signin_consent'::regclass) THEN
    RAISE EXCEPTION 'db/164: pupil_signin_consent is not under row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pupil_signin_consent')
     OR has_table_privilege('scrbrd_app', 'pupil_signin_consent', 'SELECT') OR has_table_privilege('scrbrd_app', 'pupil_signin_consent', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'pupil_signin_consent', 'UPDATE') OR has_table_privilege('scrbrd_app', 'pupil_signin_consent', 'DELETE') THEN
    RAISE EXCEPTION 'db/164: the application can reach pupil_signin_consent other than through its functions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'assignment_subject'::regclass
                    AND tgname = 'pupil_signin_terms_withdrawn' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/164: the trigger pupil_signin_terms_withdrawn is missing or disabled';
  END IF;
  -- His notices: the restrictive policy, as written (§5b).
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v FROM pg_policy p
   WHERE p.polrelid = 'notification'::regclass AND p.polname = 'notification_pupil_signin'
     AND NOT p.polpermissive AND p.polcmd = 'r';
  IF v IS NULL OR position('pupil_signin_mine_open()' IN v) = 0 THEN
    RAISE EXCEPTION 'db/164: notification_pupil_signin is %', coalesce(v, '(missing, or not restrictive)');
  END IF;
  -- Every re-emitted body is exactly this file's.
  FOR r IN SELECT * FROM _db164_bodies LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM r.mine_md5 THEN
      RAISE EXCEPTION 'db/164: % is not this file''s body after the paste (md5 %)', r.fn,
        (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure);
    END IF;
  END LOOP;
  FOR f IN SELECT unnest(ARRAY['pupil_signin_consent_set(uuid,boolean)', 'pupil_signin_office_set(uuid,boolean)',
                               'pupil_signin_state(uuid)', 'my_own_signin()', 'pupil_signin_mine_open()',
                               'pupil_signin_yes_stands(uuid)', 'pupil_signin_in_force(uuid)', 'pupil_signin_open(uuid)',
                               'pupil_signin_is_pupils(uuid)', 'pupil_signin_stamp(uuid)', 'pupil_signin_after_yes(uuid,text)',
                               'pupil_signin_my_link(uuid)', 'pupil_signin_terms_withdrawn()', 'pupil_signin_carry_over()']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/164: % does not pin its search_path', f;
    END IF;
    IF f <> 'pupil_signin_carry_over()' AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/164: % is not a definer', f;
    END IF;
    -- Read back from the ACL: the owner, and scrbrd_app for a door; nobody else.
    SELECT coalesce(string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text), '')
      INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = f::regprocedure AND x.grantee <> p.proowner;
    w := CASE WHEN f IN ('pupil_signin_consent_set(uuid,boolean)', 'pupil_signin_office_set(uuid,boolean)',
                         'pupil_signin_state(uuid)', 'my_own_signin()', 'pupil_signin_mine_open()')
              THEN 'scrbrd_app:EXECUTE' ELSE '' END;
    IF v IS DISTINCT FROM w THEN
      RAISE EXCEPTION 'db/164: % is granted %', f, coalesce(nullif(v, ''), 'to nobody');
    END IF;
  END LOOP;
END $check$;
DROP TABLE IF EXISTS _db164_bodies;
