-- ══════════════════════════════════════════════════════════════════
--  169 · "Allow his own sign-in": the yes for a pupil's own sign-in,
--        the gate in the core access check, and the office's tick
--        (SCRBRD-140, the honesty model, Migration B)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. SCRBRD-140's honesty model, Migration B and slice 3 of its
-- build plan, on Kameel's answers of 18 Nov 2026 (every question as
-- recommended) and of 20 Nov 2026 on the red-team's six questions ("All six
-- as recommended"). The answers this file stands on:
--   Q5  (a) what opens a pupil's own page is a separate "Allow his own
--           sign-in" yes, from a guardian with a live, verified link who
--           has agreed to the terms, or the office recording that a signed
--           consent form is on file.
--   Q6  (a) one yes opens it. Only the person who gave it, or the office,
--           closes it; another guardian who objects goes to the office.
--   Q7  (a) one computed question, asked by the core check and by every
--           function that answers a pupil about himself. Nothing stamped.
--   Q12 (a) for a child under 18 the office's grant needs the tick "The
--           signed consent form is on file", recorded with the office
--           person's name. Without it he is recognised and waits.
--   And the 29 Oct rule: a consent lapses when the link that gave it ends.
--   20 Nov:
--   A  an account holding a pupil's role (player, selfaccess) that names no
--      boy is CLOSED by the gate, and the grant door refuses to make one
--      (player_required, as it already did for selfaccess). One account is
--      not closed, by its id: the seeded test account spectator@ (db/98, and
--      the same row in production and the demo), the test cast's, not a
--      child's; tools/pupil-signin-count.sql lists it as exempt.
--   B  a guardian may close the yes the school carried over for her son
--      (how 'enrolled') herself; the office's real tick stays the office's.
--   C  the school's yes (office, enrolled) lapses when his enrolment at the
--      school ends (he leaves it, or moves to another school: a transfer is
--      a departure, db/116) or his own account ends. How long the record is
--      kept is for counsel: see TODO(counsel) at §1.
--   D  "the signed consent form is on file" records who signed the form and
--      the date it was signed, not just a tick: optional now, required once
--      counsel has read it (TODO(counsel) at §1 and in the office's door).
--   E  the office's no does NOT hold against a guardian's later yes; the
--      office's screen says so.
--   F  a yes carries across a new terms version: only a withdrawal of the
--      terms (consent_state 'withdrawn') is recorded as her no, never a
--      version roll; the -02 rollout must not move links out of 'granted'.
--
-- THE QUESTION. pupil_signin_in_force(player): is there a yes in force for
-- this boy today? Worked out when asked, never stamped (the design's §4.3):
--   * eighteen by the school's roster (majority_on(born), on Johannesburg's
--     day): yes, from that day and not the day before. Nothing he typed.
--   * no date of birth on the roster: no, whatever is on record. He stays
--     closed until the office records the date (§3.2).
--   * otherwise: a yes on record that still stands —
--       a guardian's: not followed by a no of hers (her "Stop his own
--         sign-in", her withdrawal of the terms, her link ending), not
--         followed by the office's no, and given on a link that is still
--         live, verified and agreed to the terms today (the 29 Oct rule;
--         consent_giver_live()'s tests, on the very link that gave it);
--       the school's (the form on file, or the stamp carried over below):
--         not followed by the office's no, nor by his account ending (C),
--         nor (the carried-over stamp only) by a guardian's stop (B), and
--         only while he has stayed at the school whose yes it is since it
--         was given: not left it, not moved to another (C).
--   Another yes standing keeps him open (Q6).
--
-- THE GATE. pupil_signin_open(account): false for an account that answers
-- as a boy (its roster link, or a self link on one of its live
-- assignments) when any boy it answers as has no yes in force; false for an
-- account holding a live pupil's role that answers as no boy at all (A: in
-- doubt, a pupil, and no family's yes could ever open it). True for every
-- other account, so nothing changes for anybody who is not a pupil. Asked
-- inside app_can(), app_holds(), app_enrolled() and the functions that read
-- the caller's own assignments without app_can(): every assignment of a
-- closed account stops counting, at the next statement. He is not signed
-- out; his session reads what a signed-out visitor reads, his own account
-- row, his own state, and his school's safeguarding card (person_live_at()
-- is not gated: Q8). The code sign-in (db/05 login_code_redeem(), which
-- checks no consent) is covered the same way: the gate is on what the
-- account reads, not on the door.
--
-- WHAT A NO DOES NOT TAKE BACK. His guardians' own reads (her assignment is
-- not a pupil's; db/99 §142 (guardian)), the school's record of him, his
-- past answers, the match record, his follow list.
--
-- WHO THE PASTE CLOSES. Every live, verified own link the office stamped
-- "granted" before this file, for a boy under 18, is carried over as the
-- school's yes (how 'enrolled', given by the person who verified the link,
-- at the stamp's time), BEFORE the gate goes on (§6 runs before §5). The
-- paste still closes: a boy with no date of birth on the roster; an account
-- with a roster link and no granted own link; an account holding a pupil's
-- role that names no boy (A); and any staff role on such an account.
-- tools/pupil-signin-count.sql counts each, run before the paste: read
-- would_close, no_date_of_birth, no_boy_named and also_holds_another_role,
-- not only the first.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   + pupil_signin_consent  the record: one row per yes or no, append-only,
--       ordered by seq. Who (the guardian or the office person, by id and by
--       name as it was), how (guardian · office · enrolled · terms_withdrawn
--       · link_ended · lapsed · not_him), her link and her terms version,
--       the school whose yes it is, the form on file with who signed it and
--       when where the office has them (D), the time. RLS on, no policy, no
--       privilege: functions only (db/81's shape).
--   + pupil_signin_consent_set(player, yes)  the guardian's own tap.
--   + pupil_signin_office_set(player, yes, signed_by, signed_on)  the
--       office: the signed form on file (the Q12 tick, also used by the
--       grant), or a withdrawal for a parent who telephones (closes every
--       yes before it; not a later one, E).
--   + pupil_signin_retry(player)  open a recognised boy a yes already
--       allows, when the first try was held (S5).
--   + pupil_signin_state(player)  what the family and the office read.
--   + my_own_signin()  what the boy's own screen needs: is this a pupil's
--       account, and is it open.
--   + pupil_claim_not_him(claim)  the office: "This account is not him"
--       (S10): ends a wrongly recognised account's pupil roles and links at
--       the claim's school, closes the yeses given since it was recognised,
--       declines the claim, tells the DSOs.
--   + notification_pupil_signin (restrictive, on notification): a closed
--       account reads only the system's own notices addressed to it, and
--       so a notice to his side is neither read nor pushed to his phone
--       (§5b); pupil_signin_mine_open() is the policy's question.
--   + pupil_signin_link_no (trigger on assignment_subject): her withdrawal
--       of the terms, or her link ending (revoked, rejected, run out), is
--       recorded as her no, so a link agreed or verified again later does
--       not quietly reopen her old yes (a new tap is a new yes). A terms
--       version roll is not a no (F). The gate does not depend on it: a
--       link not live closes at once.
--   + pupil_signin_account_ended (trigger on app_user): his own account
--       ending (removed, or its roster link moved) is recorded as the
--       school's yes lapsing (C).
--   ~ app_can(), app_holds(), app_enrolled()  db/50's and db/81's bodies as
--       db/128 left them (sa_today()), with one line each:
--       AND pupil_signin_open(a.person_id). md5-guarded.
--   ~ app_enrolled_at() (db/107), app_can_but_player() (db/119),
--     is_family_of() (db/119), lift_at_school() (db/70),
--     scorebook_school_grant() (db/63): the same line. md5-guarded.
--   ~ my_own_boy() (db/106), recognition_self_players() (db/144),
--     my_health_consents() (db/60): nothing for a closed account.
--   (app_user_email_seen() (db/118), which this file widened when it was
--    db/164, is no longer touched here: db/168 §6b now adds the same arm, an
--    account that has said it is a pupil is a pupil's for his address, at
--    his claim's school. db/99 §142 (address) still holds it.)
--   ~ role_request_grant_as() (db/92, db/108, db/128): his own link is
--       stamped "granted" only when a yes is in force (or he is eighteen);
--       otherwise "pending", and he waits (Q12); and `player` needs a boy,
--       as `selfaccess` already did (A).
--   ~ db/168's pupil_account_opened(), pupil_claim_waiting(),
--     my_pupil_state(), pupil_claims(), pupil_claim_keep_until() and
--     pupil_claim_office_until(): "opened" now means opened and his sign-in
--     in force; a page a no closed again reads "closed"; an account holding
--     a pupil's role has no last day, on the office's date as on the keep's
--     (Migration A's review item: db/168 is not changed; its body is
--     re-emitted here).
--
-- NOT RE-EMITTED, AND WHY. decide_role_request() keeps its five arguments
-- and its body: the tick is the office's yes, recorded by
-- pupil_signin_office_set() AFTER the grant, in the same transaction (the
-- API does it; a refused tick rolls the grant back), and the grant door
-- asks the question itself. Functions on the map that NARROW
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
-- NUMBERED db/169, WRITTEN AS db/164. The file was renumbered after db/165
-- and db/166 shipped and Migration A became db/168. The text it puts into
-- the bodies it re-emits (§5: app_can() and its siblings' one line, and
-- my_own_boy()'s) still says "-- db/164:", on purpose: those bodies are
-- held to their md5 by §0 and §8, and by db/99 §142, so the comment is left
-- as written rather than move every hash.
--
-- HOW TO PASTE (S1). One transaction, stop on the first error: the
-- Supabase SQL Editor runs bundle-sql --apply's script as one implicit
-- transaction, and psql -1 -v ON_ERROR_STOP=1 does the same here. Run any
-- other way it is still safe at every statement: each function is revoked
-- from PUBLIC the statement after it is made; the carry-over (§6) runs
-- before the notice policy (§5b) and the gate (§5), which goes on in one
-- statement for all its bodies; §0 refuses a database where only some of
-- the gate's bodies are in place; and a second paste finishes what a
-- stopped one left.
--
-- Every function: SECURITY DEFINER (but the owner-only carry-over),
-- search_path pinned, REVOKE ALL FROM PUBLIC; the doors GRANT EXECUTE to
-- scrbrd_app by name; nothing to anon, authenticated or service_role
-- (db/157). No BEGIN or COMMIT. Safe to run twice. Its proof is db/99 §142.


-- ── 0a · Ten seconds for a lock, or nothing (db/168's pattern) ──────
-- The triggers lock assignment_subject, app_user and player, and
-- re-emitting app_can() waits on every statement that is reading through
-- it. A plain SET, so it holds for every statement after it however the
-- file is run; the file's last statement RESETs it, so a pooled connection
-- is handed back as it came. A paste that cannot get a lock in ten seconds
-- stops: paste it again, outside a match.
SET lock_timeout = '10s';


-- ── 0 · What this file stands on ───────────────────────────────────
DO $guard$
BEGIN
  IF to_regprocedure('app_user_id()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('majority_on(date)') IS NULL
     OR to_regprocedure('sa_date(timestamptz)') IS NULL OR to_regclass('team_membership') IS NULL
     OR to_regprocedure('guardian_link_reopened_since(uuid,timestamptz)') IS NULL
     OR to_regprocedure('lift_cuts_ok(uuid)') IS NULL
     OR to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)') IS NULL
     OR to_regprocedure('pupil_claim_office(uuid)') IS NULL OR to_regprocedure('pupil_claim_log(text,uuid,uuid[])') IS NULL
     OR to_regprocedure('pupil_account_opened(uuid)') IS NULL OR to_regclass('pupil_claim') IS NULL
     OR to_regprocedure('pupil_claim_office_until(uuid)') IS NULL
     OR to_regprocedure('declined_claim_notice(uuid,text,text,uuid)') IS NULL
     OR to_regprocedure('app_enrolled_at(uuid)') IS NULL OR to_regprocedure('app_can_but_player(text,uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/169: app_user_id() (db/01), sa_today() or sa_date() (db/08, db/128), team_membership, guardian_link_reopened_since() (db/124), lift_cuts_ok() (db/70), role_request_grant_as() (db/92), app_enrolled_at() (db/107), app_can_but_player() (db/119), declined_claim_notice() (db/93) or db/168''s pupil claim is missing; apply them first';
  END IF;
END $guard$;

-- The bodies this file replaces, each as the files before it left it, or
-- as this file leaves it (a second paste). Anything else stops the paste:
-- a body that has moved since is not the one this file was written
-- against. Each is changed by exactly the text in §5 and nothing else.
-- (Moved 19 Nov, on the renumber: pupil_claims() and pupil_claim_keep_until()
-- as db/168 now leaves them, after Migration A's review. Moved 20 Nov, on
-- the red-team's fixes: role_request_grant_as()'s own (A, N3, N9), and
-- pupil_claim_office_until() added; every other hash held unchanged.)
DROP TABLE IF EXISTS _db169_bodies;
CREATE TEMP TABLE _db169_bodies (fn text PRIMARY KEY, was_md5 text, mine_md5 text);
INSERT INTO _db169_bodies VALUES
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
  ('role_request_grant_as(uuid,uuid,text,uuid,text)',  '5ac61a0386e299220d485d0fc744e8c7', 'b32f5cfb02cd259ff5c6f47aecc09143'),
  ('my_pupil_state()',                                 '7e617a2bf3c80223c9dbec592604b56b', '2d959dd176152fb275f61eede6ea95a6'),
  ('pupil_claims(uuid)',                               '393c8222bb2e4e269f9badc6daa7d8b7', 'a6faac8bedb002af1ebe120912050c71'),
  ('pupil_account_opened(uuid)',                       '4ab87c3767211d5c959c4a43da18a2b9', '19eae6d7d5419182ba3eb242a6147b70'),
  ('pupil_claim_waiting(uuid)',                        'e2dca119c869fadd964e73c6d98e0278', '08b401e4f64ebcd5ab38130ac488f81b'),
  ('pupil_claim_keep_until(uuid)',                     '3f0886bc4ba10a37b12c3a7bcf8bc2f6', 'c310ac648a03905829a6b3c76fa1d106'),
  ('pupil_claim_office_until(uuid)',                   '5f0f49811277c05a2a574083f883ed6f', 'ef1803fa4131d691fdc526f23f9a2e52');
DO $bodies$
DECLARE r record; v text; n_mine int := 0; n_was int := 0;
BEGIN
  FOR r IN SELECT * FROM _db169_bodies LOOP
    v := (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn));
    IF v IS NULL THEN
      RAISE EXCEPTION 'db/169: % is not there', r.fn;
    END IF;
    IF v NOT IN (r.was_md5, r.mine_md5) THEN
      RAISE EXCEPTION 'db/169: % is neither as the files before this one left it nor this file''s (md5 %); factor the version now in place and move its hash', r.fn, v;
    END IF;
    IF v = r.mine_md5 THEN n_mine := n_mine + 1; ELSE n_was := n_was + 1; END IF;
  END LOOP;
  -- S1: the gate goes on in one statement (§5), so its bodies are all the
  -- files' before it or all this file's. A mix is a database somebody has
  -- changed by hand, or a paste of another cut of this file: stop.
  IF n_mine > 0 AND n_was > 0 THEN
    RAISE EXCEPTION 'db/169: a partial paste is in place (% of the gate''s % bodies are this file''s); restore them, or see the paste card', n_mine, n_mine + n_was;
  END IF;
  -- And a gate in place needs its record and its question.
  IF n_mine > 0 AND (to_regclass('pupil_signin_consent') IS NULL OR to_regprocedure('pupil_signin_open(uuid)') IS NULL) THEN
    RAISE EXCEPTION 'db/169: the gate is in place without its record; restore the bodies, or see the paste card';
  END IF;
END $bodies$;


-- ── 1 · The record ─────────────────────────────────────────────────
-- TODO(counsel): how long a row of this record is kept. Today it is kept
-- for as long as his roster row (ON DELETE CASCADE from player), with the
-- giver's name as it was, even after the giver's account is erased
-- (given_by SET NULL, given_by_name kept). Counsel sets the period (C);
-- nothing here removes a row on a clock until then. Do not invent one.
-- TODO(counsel): who signed the form and the day it was signed (D) are
-- optional now and become required once counsel has read them: then the
-- office's door refuses a tick without them, and a migration makes the
-- shape below require them on an office yes.
CREATE TABLE IF NOT EXISTS pupil_signin_consent (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The order things were said in: a no closes only the yeses before it.
  seq            bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  player_id      uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  answer         text NOT NULL CHECK (answer IN ('yes', 'no')),
  -- guardian         her own tap: "Allow his own sign-in" or "Stop his own sign-in"
  -- office           the office: the signed form on file (yes), or a
  --                  withdrawal recorded for a parent (no)
  -- enrolled         (yes) the office's stamp on his own link before db/169
  -- terms_withdrawn  (no) her withdrawal of the terms, recorded as it happened
  -- link_ended       (no) her link revoked, rejected or run out
  -- lapsed           (no) his own account ended: the school's yes lapses (C)
  -- not_him          (no) the office took a wrongly recognised account off
  --                  his record (S10): closes the yeses given since `since`
  how            text NOT NULL CHECK (how IN ('guardian', 'office', 'enrolled', 'terms_withdrawn', 'link_ended', 'lapsed', 'not_him')),
  given_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  -- The name as it was when it was said: the record names a person.
  given_by_name  text CHECK (given_by_name IS NULL OR char_length(given_by_name) <= 200),
  -- A guardian's: the link (assignment_subject.id) she said it on.
  link_id        uuid,
  -- A guardian's yes: the terms she had agreed to (her link's consent_version).
  terms_version  text CHECK (terms_version IS NULL OR char_length(terms_version) <= 40),
  -- The school's yes (office, enrolled): the school it is of. It stands
  -- only while he stays at that school (C).
  school_id      uuid REFERENCES school(id) ON DELETE CASCADE,
  -- not_him: the yeses it closes are those given since this (the claim's
  -- recognition).
  since          timestamptz,
  -- The office's yes is the signed form, on file (Q12's tick), and (D) who
  -- signed it, as written on the form, and the day it was signed, where
  -- the office has them (optional until counsel: TODO(counsel) above).
  form_on_file   boolean NOT NULL DEFAULT false,
  form_signed_by text CHECK (form_signed_by IS NULL OR char_length(btrim(form_signed_by)) BETWEEN 2 AND 200),
  form_signed_on date,
  given_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pupil_signin_consent_shape CHECK (
        (how = 'guardian'        AND link_id IS NOT NULL AND (answer = 'no' OR terms_version IS NOT NULL))
     OR (how = 'office'          AND link_id IS NULL AND (answer = 'no' OR (form_on_file AND school_id IS NOT NULL)))
     OR (how = 'enrolled'        AND answer = 'yes' AND link_id IS NULL AND school_id IS NOT NULL)
     OR (how IN ('terms_withdrawn', 'link_ended') AND answer = 'no' AND link_id IS NOT NULL)
     OR (how = 'lapsed'          AND answer = 'no' AND link_id IS NULL)
     OR (how = 'not_him'         AND answer = 'no' AND link_id IS NULL AND since IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pupil_signin_consent_player_idx ON pupil_signin_consent (player_id, seq);

COMMENT ON TABLE pupil_signin_consent IS
  'db/169 (SCRBRD-140 honesty model, Migration B): every yes and no for a pupil''s own sign-in, append-only. Read by pupil_signin_in_force(); functions only. Retention: for counsel (TODO(counsel) in db/169 §1).';

ALTER TABLE pupil_signin_consent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pupil_signin_consent FROM PUBLIC;
REVOKE ALL ON pupil_signin_consent FROM scrbrd_app;
-- N4: the identity's sequence too.
REVOKE ALL ON SEQUENCE pupil_signin_consent_seq_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE pupil_signin_consent_seq_seq FROM scrbrd_app;

-- A cut of this file from before 20 Nov made its doors with other
-- arguments or answers, and its link trigger under another name. Never
-- shipped; dropped here so a development database takes this cut.
DROP TRIGGER IF EXISTS pupil_signin_terms_withdrawn ON assignment_subject;
DROP FUNCTION IF EXISTS pupil_signin_terms_withdrawn();
DROP TRIGGER IF EXISTS pupil_signin_born_kept ON player;
DROP FUNCTION IF EXISTS pupil_signin_born_kept();
DROP FUNCTION IF EXISTS pupil_signin_stayed(uuid, timestamptz);
DROP FUNCTION IF EXISTS pupil_signin_office_set(uuid, boolean);
DO $older$
BEGIN
  IF to_regprocedure('pupil_signin_consent_set(uuid,boolean)') IS NOT NULL
     AND pg_get_function_result(to_regprocedure('pupil_signin_consent_set(uuid,boolean)')) <> 'TABLE(ok boolean, reason text, in_force boolean, held text)' THEN
    DROP FUNCTION pupil_signin_consent_set(uuid, boolean);
  END IF;
  IF to_regprocedure('pupil_signin_state(uuid)') IS NOT NULL
     AND position('held boolean' IN pg_get_function_result(to_regprocedure('pupil_signin_state(uuid)'))) = 0 THEN
    DROP FUNCTION pupil_signin_state(uuid);
  END IF;
END $older$;


-- ── 2 · The question ───────────────────────────────────────────────
-- S8: the four functions the gate asks on every row are plpgsql, not SQL.
-- A SQL function with its own search_path is planned afresh on every call,
-- and row security calls these once per row per check: measured on the
-- seed, a pupil's read of the ball log went from 5 ms (db/168) to 140 ms
-- with SQL bodies, and to about 11 ms as plpgsql, whose plans are kept; a
-- coach's from 4 to 5 ms. The answers are the same. (S8: measured on the
-- seed, not the build database; time it there before the paste.)

-- C: has he stayed at p_school (the school whose yes it is) since p_since?
-- No when he is on another school's roster now (a transfer is a departure
-- from the old school, db/116); when a membership of his at that school
-- ended on or after p_since and no other membership there covered the day
-- (he left it, back or not); or when he has had a membership there and
-- none is open today. A boy with no membership record at the school reads
-- as at it (a roster row from before db/93's record).
CREATE OR REPLACE FUNCTION pupil_signin_stayed(p_player uuid, p_since timestamptz, p_school uuid) RETURNS boolean AS $$
DECLARE v_now uuid;
BEGIN
  SELECT p.school_id INTO v_now FROM player p WHERE p.id = p_player;
  IF v_now IS DISTINCT FROM p_school THEN RETURN false; END IF;
  -- Most boys: no membership at the school has ended yet.
  IF NOT EXISTS (SELECT 1 FROM team_membership m
                  WHERE m.player_id = p_player AND m.school_id = p_school
                    AND m.left_on IS NOT NULL AND m.left_on <= sa_today()) THEN
    RETURN true;
  END IF;
  RETURN NOT EXISTS (
           SELECT 1 FROM team_membership m
            WHERE m.player_id = p_player AND m.school_id = p_school
              AND m.left_on IS NOT NULL AND m.left_on <= sa_today() AND m.left_on >= sa_date(p_since)
              AND NOT EXISTS (SELECT 1 FROM team_membership o
                               WHERE o.player_id = m.player_id AND o.school_id = m.school_id AND o.id <> m.id
                                 AND o.joined_on <= m.left_on AND (o.left_on IS NULL OR o.left_on > m.left_on)))
     AND EXISTS (SELECT 1 FROM team_membership o
                  WHERE o.player_id = p_player AND o.school_id = p_school
                    AND o.joined_on <= sa_today() AND (o.left_on IS NULL OR o.left_on > sa_today()));
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_stayed(uuid, timestamptz, uuid) FROM PUBLIC;

-- Does this yes still stand? Not followed by a no that closes it:
--   the office's no closes every yes before it (E: not one after it);
--   his account ending ('lapsed') closes the school's (C);
--   a guardian's stop closes the carried-over stamp (B), and her own;
--   her terms withdrawal or her link ending closes her own;
--   "this account is not him" closes those given since the claim's
--   recognition (S10).
-- The school's only while he has stayed at the school since, the school
-- whose yes it is (C). A
-- guardian's only while the link she gave it on is live, verified and
-- agreed to the terms today (any version: F), was there when she said it,
-- and has not been reopened since he came back to school (db/124's rule):
-- the 29 Oct rule, on her own link.
CREATE OR REPLACE FUNCTION pupil_signin_yes_stands(p_yes uuid) RETURNS boolean AS $$
DECLARE y pupil_signin_consent%ROWTYPE;
BEGIN
  SELECT * INTO y FROM pupil_signin_consent c WHERE c.id = p_yes AND c.answer = 'yes';
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM pupil_signin_consent n
              WHERE n.player_id = y.player_id AND n.answer = 'no' AND n.seq > y.seq
                AND (n.how = 'office'
                     OR (n.how = 'lapsed' AND y.how IN ('office', 'enrolled'))
                     OR (n.how = 'not_him' AND y.given_at >= n.since)
                     OR (n.how = 'guardian' AND y.how = 'enrolled')
                     OR (y.how = 'guardian' AND n.given_by IS NOT NULL AND n.given_by = y.given_by))) THEN
    RETURN false;
  END IF;
  IF y.how <> 'guardian' THEN RETURN pupil_signin_stayed(y.player_id, y.given_at, y.school_id); END IF;
  RETURN EXISTS (
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
       AND NOT guardian_link_reopened_since(y.player_id, y.given_at));
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_yes_stands(uuid) FROM PUBLIC;

-- THE ONE QUESTION (Q7): is there a yes in force for this boy today?
CREATE OR REPLACE FUNCTION pupil_signin_in_force(p_player uuid) RETURNS boolean AS $$
DECLARE v_born date; y uuid;
BEGIN
  SELECT p.born INTO v_born FROM player p WHERE p.id = p_player;
  -- No such boy, or no date of birth: no.
  IF v_born IS NULL THEN RETURN false; END IF;
  IF majority_on(v_born) <= sa_today() THEN RETURN true; END IF;
  FOR y IN SELECT c.id FROM pupil_signin_consent c WHERE c.player_id = p_player AND c.answer = 'yes' ORDER BY c.seq DESC LOOP
    IF pupil_signin_yes_stands(y) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_in_force(uuid) FROM PUBLIC;

-- THE GATE: may this account's assignments count? An account that answers
-- as a boy (its roster link, or a self link on one of its live
-- assignments): only while every boy it answers as has a yes in force. An
-- account holding a live pupil's role that answers as no boy: never (A).
-- Every other account: yes. NULL (no caller) is open: such a caller holds
-- nothing anyway.
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
  -- The seeded test account, spectator@example.invalid (db/98; the same row
  -- in production and the demo, tools/sql/fix-player-without-team.sql): a
  -- test cast's `player` on the 1st XI, not a child. A does not close it.
  IF p_account = '88888888-0000-0000-0000-000000000001'::uuid THEN RETURN true; END IF;
  RETURN NOT EXISTS (SELECT 1 FROM role_assignment a
                      WHERE a.person_id = p_account AND a.active AND a.role IN ('player', 'selfaccess')
                        AND (a.valid_until IS NULL OR a.valid_until > sa_today()));
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
   COST 500;
REVOKE ALL ON FUNCTION pupil_signin_open(uuid) FROM PUBLIC;

-- Is this account a pupil's at all (the gate's first test)?
CREATE OR REPLACE FUNCTION pupil_signin_is_pupils(p_account uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_account AND u.player_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = p_account AND a.active
                    AND (a.role IN ('player', 'selfaccess')
                         OR EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id AND g.relationship = 'self')))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_is_pupils(uuid) FROM PUBLIC;

-- N6: is this account a child's own: a pupil's account naming no boy, or
-- answering as a boy under 18 (or with no date of birth)? Such an account
-- gives no family's yes.
CREATE OR REPLACE FUNCTION pupil_signin_child_account(p_account uuid) RETURNS boolean AS $$
  WITH b AS (
    SELECT u.player_id AS id FROM app_user u WHERE u.id = p_account AND u.player_id IS NOT NULL
    UNION
    SELECT g.player_id FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
     WHERE a.person_id = p_account AND a.active AND g.relationship = 'self')
  SELECT pupil_signin_is_pupils(p_account)
     AND (NOT EXISTS (SELECT 1 FROM b)
          OR EXISTS (SELECT 1 FROM b JOIN player p ON p.id = b.id
                      WHERE p.born IS NULL OR majority_on(p.born) > sa_today()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_child_account(uuid) FROM PUBLIC;

-- N9: the terms version his own link is stamped under. One place to move
-- when popia-2026-02 is issued (F: a yes given under -01 carries).
CREATE OR REPLACE FUNCTION pupil_signin_terms_version() RETURNS text AS $$
  SELECT 'popia-2026-01'::text
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_terms_version() FROM PUBLIC;

-- The grant door's stamp on his own link (Q12): 'granted' only when the
-- question says yes (he is eighteen, or a yes is in force), else 'pending'.
-- N3: it takes the boy's pupil_signin lock, the one every yes and no takes,
-- so a grant and a yes for the same boy are answered one after the other.
CREATE OR REPLACE FUNCTION pupil_signin_stamp(p_player uuid) RETURNS text AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_signin:' || p_player::text, 164));
  RETURN CASE WHEN pupil_signin_in_force(p_player) THEN 'granted' ELSE 'pending' END;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_stamp(uuid) FROM PUBLIC;


-- ── 3 · What a yes sets going ──────────────────────────────────────
-- Called after a yes is recorded, under the boy's pupil_signin lock. If the
-- boy is now in force: his own links still 'pending' (a grant without the
-- tick) are stamped 'granted', so db/81's trigger lets a Google sign-in on
-- to his account (§3.6); and an account the office recognised and that
-- waits (db/168) is opened through the one grant door, which asks the
-- question itself. The decider is the caller when the caller is the office,
-- else the office person who recognised him (S5). A grant the door refuses
-- (no side on the roster, say) leaves him recognised; the yes stays on
-- record, and the refusal is answered (S5: the doors say it, and a second
-- tap, or the office's retry, tries again). Answers the door's refusal,
-- 'not_in_force', or NULL (nothing waits, or opened).
CREATE OR REPLACE FUNCTION pupil_signin_after_yes(p_player uuid, p_version text) RETURNS text AS $$
DECLARE c pupil_claim%ROWTYPE; v_user uuid; v_req uuid; v_ok boolean; v_why text; v_decider uuid;
BEGIN
  IF NOT pupil_signin_in_force(p_player) THEN RETURN 'not_in_force'; END IF;
  UPDATE assignment_subject g
     SET consent_state = 'granted', consent_version = coalesce(p_version, pupil_signin_terms_version()), consent_at = now()
   WHERE g.player_id = p_player AND g.relationship = 'self'
     AND g.verification_state = 'verified' AND g.consent_state = 'pending'
     AND (g.valid_until IS NULL OR g.valid_until > sa_today());
  -- N14: the claim's own advisory lock first, as db/168's doors take it.
  SELECT x.user_id INTO v_user FROM pupil_claim x WHERE x.player_id = p_player AND x.state = 'recognised';
  IF v_user IS NULL THEN RETURN NULL; END IF;
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
REVOKE ALL ON FUNCTION pupil_signin_my_link(uuid) FROM PUBLIC;

-- The carried-over stamp (how 'enrolled') standing for him, if any (B).
CREATE OR REPLACE FUNCTION pupil_signin_enrolled_yes(p_player uuid) RETURNS uuid AS $$
  SELECT y.id FROM pupil_signin_consent y
   WHERE y.player_id = p_player AND y.answer = 'yes' AND y.how = 'enrolled' AND pupil_signin_yes_stands(y.id)
   ORDER BY y.seq DESC LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_enrolled_yes(uuid) FROM PUBLIC;


-- ── 4 · The doors ──────────────────────────────────────────────────
/**
 * THE GUARDIAN'S TAP (Q5, Q6, B): "Allow his own sign-in" (p_yes true) or
 * "Stop his own sign-in" (false), as herself, on her own live, verified
 * link. Never under a support hour, a platform-wide key or a pad, and never
 * from a child's own account (N6). Answers (ok, reason, in_force, held):
 *   ok                  recorded (or her yes already stands); in_force is
 *                       the question's answer now; held is why a
 *                       recognised boy's account could not be opened by
 *                       it (S5), or NULL
 *   not_signed_in       no session, or a pad's credential
 *   not_permitted       not his guardian today (also for an id that is no
 *                       boy, so a stranger learns nothing)
 *   answer_required     neither yes nor no
 *   player_is_an_adult  he is eighteen: his own sign-in is his (§3.5)
 *   terms_not_agreed    her link has not agreed to the school's terms
 *   no_date_of_birth    the school has no date of birth for him: a yes
 *                       would open nothing (§3.2); the office records it
 *   not_yours_to_stop   neither a yes of her own nor the school's
 *                       carried-over stamp stands; a yes given by somebody
 *                       else is closed by them or the office (Q6)
 */
CREATE OR REPLACE FUNCTION pupil_signin_consent_set(p_player uuid, p_yes boolean)
RETURNS TABLE (ok boolean, reason text, in_force boolean, held text) AS $$
DECLARE
  v_me uuid := app_user_id();
  v_school uuid; v_born date;
  l record; v_mine uuid; v_enrolled uuid; v_id uuid; v_name text; v_held text;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_signed_in'::text, NULL::boolean, NULL::text; RETURN; END IF;
  SELECT p.school_id INTO v_school FROM player p WHERE p.id = p_player;
  IF v_school IS NULL OR NOT lift_cuts_ok(v_school) OR pupil_signin_child_account(v_me) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean, NULL::text; RETURN;
  END IF;
  IF p_yes IS NULL THEN RETURN QUERY SELECT false, 'answer_required'::text, NULL::boolean, NULL::text; RETURN; END IF;
  -- N5: the boy's lock first; then her link and his date of birth, read after it.
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_signin:' || p_player::text, 164));
  SELECT * INTO l FROM pupil_signin_my_link(p_player);
  IF l.link_id IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean, NULL::text; RETURN; END IF;
  SELECT p.born INTO v_born FROM player p WHERE p.id = p_player;
  IF v_born IS NOT NULL AND majority_on(v_born) <= sa_today() THEN
    RETURN QUERY SELECT false, 'player_is_an_adult'::text, true, NULL::text; RETURN;
  END IF;
  SELECT y.id INTO v_mine FROM pupil_signin_consent y
   WHERE y.player_id = p_player AND y.answer = 'yes' AND y.how = 'guardian' AND y.given_by = v_me
     AND pupil_signin_yes_stands(y.id)
   ORDER BY y.seq DESC LIMIT 1;
  v_name := (SELECT left(u.name, 200) FROM app_user u WHERE u.id = v_me);
  IF p_yes THEN
    IF NOT l.agreed THEN RETURN QUERY SELECT false, 'terms_not_agreed'::text, pupil_signin_in_force(p_player), NULL::text; RETURN; END IF;
    IF v_born IS NULL THEN RETURN QUERY SELECT false, 'no_date_of_birth'::text, false, NULL::text; RETURN; END IF;
    IF v_mine IS NULL THEN
      INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, link_id, terms_version)
      VALUES (p_player, 'yes', 'guardian', v_me, v_name, l.link_id, l.terms_version)
      RETURNING id INTO v_id;
      PERFORM pupil_claim_log('pupil_signin.yes', v_school, ARRAY[v_id]);
    END IF;
    v_held := pupil_signin_after_yes(p_player, l.terms_version);
  ELSE
    v_enrolled := pupil_signin_enrolled_yes(p_player);
    IF v_mine IS NULL AND v_enrolled IS NULL THEN
      RETURN QUERY SELECT false, 'not_yours_to_stop'::text, pupil_signin_in_force(p_player), NULL::text; RETURN;
    END IF;
    -- B: the school's carried-over stamp is hers to stop only once she has agreed the terms.
    IF v_mine IS NULL AND NOT l.agreed THEN
      RETURN QUERY SELECT false, 'terms_not_agreed'::text, pupil_signin_in_force(p_player), NULL::text; RETURN;
    END IF;
    INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, link_id)
    VALUES (p_player, 'no', 'guardian', v_me, v_name, l.link_id)
    RETURNING id INTO v_id;
    PERFORM pupil_claim_log('pupil_signin.no', v_school, ARRAY[v_id]);
  END IF;
  RETURN QUERY SELECT true, NULL::text, pupil_signin_in_force(p_player), nullif(v_held, 'not_in_force');
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_consent_set(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pupil_signin_consent_set(uuid, boolean) TO scrbrd_app;

/**
 * THE OFFICE (Q12, §3.4, D, E): p_yes true records "The signed consent
 * form is on file", under the office person's name and for his school,
 * with who signed the form (as written on it) and the day it was signed
 * where the office gives them (optional until counsel); it is the tick the
 * grant asks for. false records a withdrawal (a parent who telephones, a
 * court order): it closes every yes before it, the family's and the
 * school's, and not one given after it (E: to keep him out whatever is
 * said later, end his roles or shut his account). The office:
 * guardian.link.manage at his school, never under a support hour, a
 * platform-wide key or a pad (db/168's pupil_claim_office()). Answers (ok,
 * reason, in_force, held): not_signed_in · not_permitted · answer_required
 * · player_is_an_adult · no_date_of_birth (a yes only; the office records
 * his date of birth first) · form_signer_invalid (who signed it, given, is
 * under two letters) · form_date_invalid (given, and after today, or
 * before he was born).
 */
CREATE OR REPLACE FUNCTION pupil_signin_office_set(p_player uuid, p_yes boolean, p_signed_by text DEFAULT NULL, p_signed_on date DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, in_force boolean, held text) AS $$
DECLARE v_me uuid := app_user_id(); v_school uuid; v_born date; v_id uuid; v_held text; v_by text := nullif(btrim(coalesce(p_signed_by, '')), '');
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_signed_in'::text, NULL::boolean, NULL::text; RETURN; END IF;
  SELECT p.school_id INTO v_school FROM player p WHERE p.id = p_player;
  IF v_school IS NULL OR NOT pupil_claim_office(v_school) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean, NULL::text; RETURN;
  END IF;
  IF p_yes IS NULL THEN RETURN QUERY SELECT false, 'answer_required'::text, NULL::boolean, NULL::text; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_signin:' || p_player::text, 164));
  SELECT p.born INTO v_born FROM player p WHERE p.id = p_player;
  IF p_yes THEN
    IF v_born IS NOT NULL AND majority_on(v_born) <= sa_today() THEN
      RETURN QUERY SELECT false, 'player_is_an_adult'::text, true, NULL::text; RETURN;
    END IF;
    IF v_born IS NULL THEN RETURN QUERY SELECT false, 'no_date_of_birth'::text, false, NULL::text; RETURN; END IF;
    -- D: optional until counsel (TODO(counsel), §1); checked when given.
    IF v_by IS NOT NULL AND (char_length(v_by) < 2 OR char_length(v_by) > 200) THEN
      RETURN QUERY SELECT false, 'form_signer_invalid'::text, NULL::boolean, NULL::text; RETURN;
    END IF;
    IF p_signed_on IS NOT NULL AND (p_signed_on > sa_today() OR p_signed_on < v_born) THEN
      RETURN QUERY SELECT false, 'form_date_invalid'::text, NULL::boolean, NULL::text; RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pupil_signin_consent y
                    WHERE y.player_id = p_player AND y.answer = 'yes' AND y.how = 'office'
                      AND y.form_signed_by IS NOT DISTINCT FROM v_by AND y.form_signed_on IS NOT DISTINCT FROM p_signed_on
                      AND pupil_signin_yes_stands(y.id)) THEN
      INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, school_id, form_on_file, form_signed_by, form_signed_on)
      VALUES (p_player, 'yes', 'office', v_me, (SELECT left(u.name, 200) FROM app_user u WHERE u.id = v_me), v_school, true, v_by, p_signed_on)
      RETURNING id INTO v_id;
      PERFORM pupil_claim_log('pupil_signin.form_on_file', v_school, ARRAY[v_id]);
    END IF;
    v_held := pupil_signin_after_yes(p_player, NULL);
  ELSE
    INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name)
    VALUES (p_player, 'no', 'office', v_me, (SELECT left(u.name, 200) FROM app_user u WHERE u.id = v_me))
    RETURNING id INTO v_id;
    PERFORM pupil_claim_log('pupil_signin.withdrawn', v_school, ARRAY[v_id]);
  END IF;
  RETURN QUERY SELECT true, NULL::text, pupil_signin_in_force(p_player), nullif(v_held, 'not_in_force');
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_office_set(uuid, boolean, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pupil_signin_office_set(uuid, boolean, text, date) TO scrbrd_app;

/**
 * TRY AGAIN (S5): a yes is in force for a boy the office recognised, and
 * opening his account was held (no side on the roster, say); the office has
 * fixed it. The office, or his guardian with a live, verified, agreed link.
 * Answers (ok, reason, in_force, held): not_signed_in · not_permitted ·
 * not_in_force (no yes stands: nothing to open).
 */
CREATE OR REPLACE FUNCTION pupil_signin_retry(p_player uuid)
RETURNS TABLE (ok boolean, reason text, in_force boolean, held text) AS $$
DECLARE v_school uuid; l record; v_held text;
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_signed_in'::text, NULL::boolean, NULL::text; RETURN; END IF;
  SELECT p.school_id INTO v_school FROM player p WHERE p.id = p_player;
  IF v_school IS NULL OR NOT lift_cuts_ok(v_school) THEN RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean, NULL::text; RETURN; END IF;
  SELECT * INTO l FROM pupil_signin_my_link(p_player);
  IF NOT pupil_claim_office(v_school) AND (l.link_id IS NULL OR NOT l.agreed OR pupil_signin_child_account(app_user_id())) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean, NULL::text; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('pupil_signin:' || p_player::text, 164));
  v_held := pupil_signin_after_yes(p_player, NULL);
  IF v_held = 'not_in_force' THEN RETURN QUERY SELECT false, 'not_in_force'::text, false, NULL::text; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text, true, v_held;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_retry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pupil_signin_retry(uuid) TO scrbrd_app;

/**
 * WHAT THE FAMILY AND THE OFFICE READ (§5.2). A guardian with a live,
 * verified link to him, or the office; nothing for anybody else (the boy
 * reads his own through my_own_signin()). At most one row:
 *   agreed      the guardian has agreed to the school's terms (N11: until
 *               she has, she is told only that, and every field below but
 *               office is NULL or false); always true for the office
 *   in_force    the question's answer today
 *   adult       eighteen by the roster
 *   born_known  the school has his date of birth
 *   yes_how     the yes keeping him open: guardian · office · enrolled (NULL)
 *   yes_by      who gave it: her own name to her; "the guardian" for another
 *               guardian's yes (to the family); the office person's name to
 *               the office, "the school office" to the family
 *   yes_at      when
 *   form_signed_by  (the office only) who signed the form on file
 *   form_signed_on  the day the form on file was signed
 *   yours       the yes standing is the caller's own
 *   can_allow   she may say yes now (agreed, under 18, date known), or say
 *               it again while her yes waits to open a recognised boy (S5)
 *   can_stop    she has a yes of her own to stop, or the school's carried-
 *               over stamp stands (B)
 *   held        a yes is in force and his recognised account waits to be
 *               opened (S5)
 *   office      the caller reads as the office
 */
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
  held := coalesce(in_force, false) AND EXISTS (SELECT 1 FROM pupil_claim c JOIN app_user u ON u.id = c.user_id
                                               WHERE c.player_id = p_player AND c.state = 'recognised' AND u.active);
  v_enrolled := pupil_signin_enrolled_yes(p_player) IS NOT NULL;
  can_allow := l.link_id IS NOT NULL AND born_known AND NOT adult AND (NOT yours OR held)
               AND NOT pupil_signin_child_account(v_me);
  can_stop := l.link_id IS NOT NULL AND NOT adult AND (yours OR v_enrolled) AND NOT pupil_signin_child_account(v_me);
  RETURN NEXT;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pupil_signin_state(uuid) TO scrbrd_app;

/**
 * WHAT HIS OWN SCREEN NEEDS. One row for a signed-in account:
 *   pupil   the account is a pupil's (a roster link, a self link, a pupil's role)
 *   open    his own sign-in is in force (always true for an account that is
 *           not a pupil's)
 *   school_id, school_name  his school, by his roster row (or, for a
 *           pupil's role naming no boy, that role's school), for the sentence
 * Never his roster name, his team, a birthday or who said what.
 */
CREATE OR REPLACE FUNCTION my_own_signin()
RETURNS TABLE (pupil boolean, open boolean, school_id uuid, school_name text) AS $$
  SELECT pupil_signin_is_pupils(app_user_id()), pupil_signin_open(app_user_id()), s.id, s.name
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT x.school_id FROM (
        SELECT p.school_id, 0 AS o, p.id::text AS k FROM player p
         WHERE p.id = (SELECT u.player_id FROM app_user u WHERE u.id = app_user_id())
            OR p.id IN (SELECT g.player_id FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
                         WHERE a.person_id = app_user_id() AND a.active AND g.relationship = 'self')
        UNION ALL
        SELECT a.school_id, 1, a.id::text FROM role_assignment a
         WHERE a.person_id = app_user_id() AND a.active AND a.role IN ('player', 'selfaccess') AND a.school_id IS NOT NULL) x
       ORDER BY x.o, x.k LIMIT 1) b ON true
    LEFT JOIN school s ON s.id = b.school_id
   WHERE app_user_id() IS NOT NULL AND NOT app_pad_scoped()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION my_own_signin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_own_signin() TO scrbrd_app;

/**
 * "THIS ACCOUNT IS NOT HIM" (S10, the red-team's open item 4): the office
 * recognised the wrong account as a boy, and it may already be open. The
 * office of the claim's school (pupil_claim_office()). In one transaction,
 * at the claim's school only: the account's pupil roles end, its own links
 * to the boy are revoked and its roster link cleared (so it answers as
 * nobody there, and the boy can be recognised again against the right
 * account); the yeses given since the claim was recognised are closed (a
 * yes given while the wrong account stood for him is asked for again; his
 * family's earlier yes, about the boy, stands); the claim is declined; and
 * the school's DSOs
 * are told, as Q11 tells them of a decline, naming nobody. Answers (ok,
 * reason): not_signed_in · not_permitted (also for an id that is no claim)
 * · not_recognised (the claim names no boy: decline it instead).
 */
CREATE OR REPLACE FUNCTION pupil_claim_not_him(p_claim uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c pupil_claim%ROWTYPE; v_user uuid; v_boy uuid; v_me uuid := app_user_id(); v_id uuid;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_signed_in'::text; RETURN; END IF;
  -- N-3: the boy's lock, then the claim's, as a yes takes them (after_yes()).
  SELECT x.user_id, x.player_id INTO v_user, v_boy FROM pupil_claim x WHERE x.id = p_claim;
  IF v_boy IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('pupil_signin:' || v_boy::text, 164)); END IF;
  IF v_user IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('pupil_claim:' || v_user::text, 163)); END IF;
  SELECT * INTO c FROM pupil_claim x WHERE x.id = p_claim FOR UPDATE;
  IF NOT FOUND OR NOT pupil_claim_office(c.school_id) THEN RETURN QUERY SELECT false, 'not_permitted'::text; RETURN; END IF;
  IF c.player_id IS NULL OR c.player_id IS DISTINCT FROM v_boy OR c.state NOT IN ('recognised', 'open') THEN
    RETURN QUERY SELECT false, 'not_recognised'::text; RETURN;
  END IF;
  -- At the claim's school only: his own links to this boy on the account
  -- (the 'self' rows the grant door wrote), then its pupil roles there.
  UPDATE assignment_subject g SET verification_state = 'revoked', valid_until = greatest(sa_today(), g.valid_from)
    FROM role_assignment a
   WHERE a.id = g.assignment_id AND a.person_id = c.user_id AND a.school_id = c.school_id
     AND g.relationship = 'self' AND g.player_id = c.player_id
     AND g.verification_state IN ('pending', 'verified');
  -- Ended, not re-pointed (db/01's rule); its trigger stamps the who and when.
  UPDATE role_assignment a SET active = false
   WHERE a.person_id = c.user_id AND a.school_id = c.school_id AND a.active AND a.role IN ('player', 'selfaccess');
  UPDATE app_user SET player_id = NULL WHERE id = c.user_id AND player_id = c.player_id;
  -- The yeses the wrong account may have stood on: those given since he was
  -- recognised. One given before (his family's, for the boy) stands.
  INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, since)
  VALUES (c.player_id, 'no', 'not_him', v_me, (SELECT left(u.name, 200) FROM app_user u WHERE u.id = v_me),
          coalesce(c.known_at, c.decided_at, now()))
  RETURNING id INTO v_id;
  UPDATE pupil_claim SET state = 'declined', decided_at = now(), decided_by = v_me WHERE id = c.id;
  PERFORM declined_claim_notice(c.school_id, 'A pupil account was taken back',
    'An account the office had recognised as a pupil at your school was found not to be his, and was taken off his record by the office on '
      || to_char(sa_today(), 'FMDD FMMonth YYYY')
      || '. The office can tell you which account it was. If anything about it concerns you, raise a concern.');
  PERFORM pupil_claim_log('pupil_claim.not_him', c.school_id, ARRAY[c.id, v_id]);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_claim_not_him(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pupil_claim_not_him(uuid) TO scrbrd_app;


-- ── 6 · Nobody enrolled today is closed: the stamp carried over ─────
-- BEFORE the notice policy (§5b) and the gate (§5), so a paste stopped
-- between them closes nobody (S1). Every boy under 18 whose own link is live, verified and stamped
-- 'granted' (the office's grant, db/92, or the paths before it) has that
-- stamp carried over as the school's yes, given by the person who verified
-- the link, at the stamp's time. Only for a boy with nothing on record
-- yet, so a second paste, or the seed after the migrations, never adds a
-- yes behind a no; never for a boy of 18 by the roster (N10), who needs
-- none. Owner-only; answers how many boys it carried over.
CREATE OR REPLACE FUNCTION pupil_signin_carry_over() RETURNS integer AS $$
DECLARE n integer;
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
     AND NOT EXISTS (SELECT 1 FROM pupil_signin_consent x WHERE x.player_id = g.player_id)
   ORDER BY g.player_id, g.consent_at NULLS LAST, g.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_carry_over() FROM PUBLIC;

DO $carry$
DECLARE n integer;
BEGIN
  n := pupil_signin_carry_over();
  RAISE NOTICE 'db/169: % boy(s) enrolled before this file keep their own sign-in, as the school''s yes', n;
END $carry$;


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
-- statement (an initplan), not once per row. Before §4b's triggers (N-4):
-- the policy's lock on notification is taken first, so writes to the
-- tables the triggers lock do not queue behind it.
CREATE OR REPLACE FUNCTION pupil_signin_mine_open() RETURNS boolean AS $$
  SELECT pupil_signin_open(app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_mine_open() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pupil_signin_mine_open() TO scrbrd_app;

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


-- ── 4b · What ends a yes without a tap ─────────────────────────────
-- Her link (S6(b), F). AFTER UPDATE on a guardian's link that was live
-- (verified, not run out): withdrawn terms, from agreed (guardian_consent_withdraw(),
-- db/08) is recorded as her no ('terms_withdrawn'); the link revoked,
-- rejected or dated to an end already reached (guardian_link_revoke(),
-- db/109) as her no ('link_ended'). Only where she has a yes on record for
-- that boy. A link moving to 'pending' for a new terms version is neither
-- (F: a yes carries across a version; the gate closes him only while her
-- link is not agreed, and her agreeing to the new version reopens it).
CREATE OR REPLACE FUNCTION pupil_signin_link_no() RETURNS trigger AS $$
DECLARE v_how text;
BEGIN
  -- Her link was live and verified (agreed or not: N-9, a link waiting in
  -- 'pending' that is revoked is still her link ending).
  IF NEW.relationship IS NOT DISTINCT FROM 'self'
     OR NOT (OLD.verification_state = 'verified' AND (OLD.valid_until IS NULL OR OLD.valid_until > sa_today())) THEN
    RETURN NULL;
  END IF;
  v_how := CASE WHEN OLD.consent_state = 'granted' AND NEW.consent_state = 'withdrawn' THEN 'terms_withdrawn'
                WHEN NEW.verification_state <> 'verified'
                  OR (NEW.valid_until IS NOT NULL AND NEW.valid_until <= sa_today()) THEN 'link_ended' END;
  IF v_how IS NULL THEN RETURN NULL; END IF;
  INSERT INTO pupil_signin_consent (player_id, answer, how, given_by, given_by_name, link_id)
  SELECT NEW.player_id, 'no', v_how, a.person_id, left(u.name, 200), NEW.id
    FROM role_assignment a JOIN app_user u ON u.id = a.person_id
   WHERE a.id = NEW.assignment_id AND a.role = 'guardian'
     AND EXISTS (SELECT 1 FROM pupil_signin_consent y
                  WHERE y.player_id = NEW.player_id AND y.answer = 'yes' AND y.how = 'guardian'
                    AND y.given_by = a.person_id);
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_link_no() FROM PUBLIC;

CREATE OR REPLACE TRIGGER pupil_signin_link_no
  AFTER UPDATE OF consent_state, verification_state, valid_until ON assignment_subject
  FOR EACH ROW EXECUTE FUNCTION pupil_signin_link_no();

-- His account (C). AFTER UPDATE or DELETE of an account that answered as a
-- boy: deleted, or its roster link moved or cleared. Disabling it is not
-- its end (Kameel, on the review's S-2; ACCOUNT_LIFECYCLE D1: "Disabling
-- stops sign-in and keeps everything else"). Recorded as the school's
-- yes lapsing ('lapsed'), where one stands for that boy, so opening an
-- account for him again needs a new tick or a guardian's tap.
CREATE OR REPLACE FUNCTION pupil_signin_account_ended() RETURNS trigger AS $$
DECLARE v_boys uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_boys := ARRAY[OLD.player_id];
  ELSIF NEW.player_id IS DISTINCT FROM OLD.player_id THEN
    -- Its roster link moved or cleared: the boy it answered as.
    v_boys := ARRAY[OLD.player_id];
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO pupil_signin_consent (player_id, answer, how, given_by_name)
  SELECT DISTINCT b.id, 'no', 'lapsed', 'His own account ended'
    FROM unnest(v_boys) b(id)
   WHERE b.id IS NOT NULL
     AND EXISTS (SELECT 1 FROM player p WHERE p.id = b.id)
     AND EXISTS (SELECT 1 FROM pupil_signin_consent y
                  WHERE y.player_id = b.id AND y.answer = 'yes' AND y.how IN ('office', 'enrolled')
                    AND pupil_signin_yes_stands(y.id));
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION pupil_signin_account_ended() FROM PUBLIC;

CREATE OR REPLACE TRIGGER pupil_signin_account_ended
  AFTER UPDATE OF player_id OR DELETE ON app_user
  FOR EACH ROW EXECUTE FUNCTION pupil_signin_account_ended();


-- ── 5 · The gate, and the doors that already read his own ──────────
-- Each body re-emitted from the catalog (pg_get_functiondef, as db/128 and
-- db/168 do), with the change below and nothing else; rights, settings,
-- volatility and owner checked unchanged. One statement: every body moves,
-- or none does (S1). A second paste finds each body is this file's (§0 has
-- checked that, by its md5) and leaves it alone. A function with two rows
-- takes both changes, in order.
DO $gate$
DECLARE
  G constant text := '       -- db/164: a pupil''s own account counts only while his own sign-in is in force.' || chr(10)
                  || '       AND pupil_signin_open(a.person_id)' || chr(10);
  r record;
  v_src text; v_def text; v_cfg text; v_acl text; v_sec boolean; v_vol "char"; v_own oid; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      -- The core check, and its two siblings: every assignment of a closed account.
      (1, 'app_can(text,uuid,text,uuid,uuid)', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      (2, 'app_holds(text)', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      (3, 'app_enrolled()', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      -- The readers of the caller's own assignments that do not go through app_can().
      (4, 'app_enrolled_at(uuid)', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      (5, 'app_can_but_player(text,uuid,text,uuid,uuid)', 1,
       '     WHERE a.person_id = app_user_id()' || chr(10),
       '     WHERE a.person_id = app_user_id()' || chr(10) || G),
      (6, 'is_family_of(uuid)', 1,
       '   WHERE a.person_id = app_user_id() AND a.active' || chr(10),
       '   WHERE a.person_id = app_user_id() AND a.active' || chr(10) || G),
      (7, 'lift_at_school(uuid)', 1,
       '     WHERE a.person_id = app_user_id() AND a.school_id = p_school AND a.active' || chr(10),
       '     WHERE a.person_id = app_user_id() AND a.school_id = p_school AND a.active' || chr(10) || G),
      (8, 'scorebook_school_grant(text[],uuid)', 1,
       '     WHERE m.id = p_match' || chr(10),
       '     WHERE m.id = p_match' || chr(10) || G),
      (9, 'my_health_consents()', 1,
       '       AND NOT app_pad_scoped()' || chr(10),
       '       AND NOT app_pad_scoped()' || chr(10) || G),
      -- The boy the caller IS, and the boy who answers for himself as captain: none.
      (10, 'my_own_boy()', 1,
       ') x(b)' || chr(10),
       ') x(b)' || chr(10) || '   -- db/164: none while his own sign-in is not in force.' || chr(10)
                || '   WHERE pupil_signin_open(app_user_id())' || chr(10)),
      (11, 'recognition_self_players()', 1,
       'OR app_support_access_id() IS NOT NULL THEN ',
       'OR app_support_access_id() IS NOT NULL OR NOT pupil_signin_open(app_user_id()) THEN '),
      -- The grant door (Q12): his own link stamped 'granted' only with a yes in
      -- force, under the version of the day (N9) ...
      (12, 'role_request_grant_as(uuid,uuid,text,uuid,text)', 2,
       '''self'', ''verified'', p_decider, now(), ''granted'', ''popia-2026-01'', now(), p_decider);',
       '''self'', ''verified'', p_decider, now(), pupil_signin_stamp(v_player), '
         || 'CASE WHEN pupil_signin_stamp(v_player) = ''granted'' THEN pupil_signin_terms_version() END, '
         || 'CASE WHEN pupil_signin_stamp(v_player) = ''granted'' THEN now() END, p_decider);'),
      -- ... and (A) `player` names a boy, as `selfaccess` already had to.
      (13, 'role_request_grant_as(uuid,uuid,text,uuid,text)', 1,
       'IF r.role IN (''guardian'', ''selfaccess'', ''enquiry'') AND v_player IS NULL THEN',
       'IF r.role IN (''guardian'', ''selfaccess'', ''enquiry'', ''player'') AND v_player IS NULL THEN'),
      -- db/168's two readers of his claim's state: a page a no closed again reads 'closed'.
      (14, 'my_pupil_state()', 1,
       'CASE WHEN pupil_account_opened(c.user_id) THEN ''open'' ELSE c.state END',
       'CASE WHEN pupil_account_opened(c.user_id) THEN ''open'' WHEN c.state = ''open'' THEN ''closed'' ELSE c.state END'),
      (15, 'pupil_claims(uuid)', 1,
       'CASE WHEN pupil_account_opened(c.user_id) THEN ''open'' ELSE c.state END',
       'CASE WHEN pupil_account_opened(c.user_id) THEN ''open'' WHEN c.state = ''open'' THEN ''closed'' ELSE c.state END'),
      -- db/168's "opened": opened AND his sign-in in force; a claim waits until then.
      (16, 'pupil_account_opened(uuid)', 1,
       '  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL)' || chr(10) || '      OR EXISTS',
       '  SELECT pupil_signin_open(p_person) AND EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL)' || chr(10)
         || '      OR pupil_signin_open(p_person) AND EXISTS'),
      (17, 'pupil_claim_waiting(uuid)', 1,
       'c.user_id = p_person AND c.state <> ''open'')',
       'c.user_id = p_person)'),
      -- An account holding a pupil's role is never removed by the 30-day keep:
      -- it has no last day (db/168 refuses to remove it anyway). db/168 holds a
      -- concern's reporter the same way (pupil_claim_held()); this is beside it.
      (18, 'pupil_claim_keep_until(uuid)', 1,
       'CASE WHEN c.state = ''open'' OR pupil_account_opened(c.user_id) OR pupil_claim_held(c.user_id) THEN NULL',
       'CASE WHEN c.state = ''open'' OR pupil_account_opened(c.user_id) OR pupil_claim_held(c.user_id) OR pupil_signin_is_pupils(c.user_id) THEN NULL'),
      -- And the office's date reads the same (Migration A's item; the red-team's
      -- ruling on open item 3): no "kept until" beside a boy who will be kept.
      (19, 'pupil_claim_office_until(uuid)', 1,
       'CASE WHEN c.state = ''open'' OR pupil_account_opened(c.user_id) THEN NULL',
       'CASE WHEN c.state = ''open'' OR pupil_account_opened(c.user_id) OR pupil_signin_is_pupils(c.user_id) THEN NULL')
    ) AS t(ord, fn, times, was, now_) ORDER BY t.ord LOOP
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef, p.provolatile, p.proowner
      INTO v_src, v_cfg, v_acl, v_sec, v_vol, v_own FROM pg_proc p WHERE p.oid = r.fn::regprocedure;
    -- A second run: §0 checked the body is this file's.
    IF md5(v_src) = (SELECT b.mine_md5 FROM _db169_bodies b WHERE b.fn = r.fn) THEN CONTINUE; END IF;
    n := (length(v_src) - length(replace(v_src, r.was, ''))) / length(r.was);
    IF n <> r.times THEN
      RAISE EXCEPTION 'db/169: % holds the text it changes % times, not %', r.fn, n, r.times;
    END IF;
    v_def := pg_get_functiondef(r.fn::regprocedure);
    EXECUTE replace(v_def, r.was, r.now_);
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM replace(v_src, r.was, r.now_)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_sec
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_vol
       OR (SELECT p.proowner FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_own THEN
      RAISE EXCEPTION 'db/169: re-emitting % changed more than its one change', r.fn;
    END IF;
  END LOOP;
  -- Every body is this file's now, or none of this has happened.
  FOR r IN SELECT * FROM _db169_bodies LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM r.mine_md5 THEN
      RAISE EXCEPTION 'db/169: % is not this file''s body after the gate (md5 %)', r.fn,
        (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure);
    END IF;
  END LOOP;
END $gate$;


-- ── 7 · Who may call what ──────────────────────────────────────────
-- Said again as one list (each was revoked the statement after it was made).
DO $grants$
DECLARE
  f text; r text;
  v_doors text[] := ARRAY['pupil_signin_consent_set(uuid,boolean)', 'pupil_signin_office_set(uuid,boolean,text,date)',
                          'pupil_signin_retry(uuid)', 'pupil_signin_state(uuid)', 'my_own_signin()', 'pupil_signin_mine_open()',
                          'pupil_claim_not_him(uuid)'];
  v_internal text[] := ARRAY['pupil_signin_stayed(uuid,timestamptz,uuid)', 'pupil_signin_yes_stands(uuid)', 'pupil_signin_in_force(uuid)',
                             'pupil_signin_open(uuid)', 'pupil_signin_is_pupils(uuid)', 'pupil_signin_child_account(uuid)',
                             'pupil_signin_terms_version()', 'pupil_signin_stamp(uuid)', 'pupil_signin_after_yes(uuid,text)',
                             'pupil_signin_my_link(uuid)', 'pupil_signin_enrolled_yes(uuid)', 'pupil_signin_link_no()',
                             'pupil_signin_account_ended()', 'pupil_signin_carry_over()'];
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
      EXECUTE format('REVOKE ALL ON SEQUENCE pupil_signin_consent_seq_seq FROM %I', r);
      FOREACH f IN ARRAY v_doors || v_internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f::regprocedure, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── 8 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §142.
DO $check$
DECLARE f text; v text; w text; r record; t text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'pupil_signin_consent'::regclass) THEN
    RAISE EXCEPTION 'db/169: pupil_signin_consent is not under row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pupil_signin_consent')
     OR has_table_privilege('scrbrd_app', 'pupil_signin_consent', 'SELECT') OR has_table_privilege('scrbrd_app', 'pupil_signin_consent', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'pupil_signin_consent', 'UPDATE') OR has_table_privilege('scrbrd_app', 'pupil_signin_consent', 'DELETE') THEN
    RAISE EXCEPTION 'db/169: the application can reach pupil_signin_consent other than through its functions';
  END IF;
  -- N4: the table's ACL, and its sequence's, hold the owner alone (a managed host's roles included).
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault(CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) x
              WHERE c.oid IN ('pupil_signin_consent'::regclass, 'pupil_signin_consent_seq_seq'::regclass) AND x.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'db/169: pupil_signin_consent or its sequence is granted to somebody other than its owner';
  END IF;
  FOR t IN SELECT unnest(ARRAY['assignment_subject:pupil_signin_link_no', 'app_user:pupil_signin_account_ended']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = split_part(t, ':', 1)::regclass
                      AND tgname = split_part(t, ':', 2) AND tgenabled = 'O') THEN
      RAISE EXCEPTION 'db/169: the trigger % is missing or disabled', t;
    END IF;
  END LOOP;
  -- His notices: the restrictive policy, as written (§5b).
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v FROM pg_policy p
   WHERE p.polrelid = 'notification'::regclass AND p.polname = 'notification_pupil_signin'
     AND NOT p.polpermissive AND p.polcmd = 'r';
  IF v IS NULL OR position('pupil_signin_mine_open()' IN v) = 0 THEN
    RAISE EXCEPTION 'db/169: notification_pupil_signin is %', coalesce(v, '(missing, or not restrictive)');
  END IF;
  -- Every re-emitted body is exactly this file's.
  FOR r IN SELECT * FROM _db169_bodies LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM r.mine_md5 THEN
      RAISE EXCEPTION 'db/169: % is not this file''s body after the paste (md5 %)', r.fn,
        (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure);
    END IF;
  END LOOP;
  -- S1: the carry-over left nobody behind: no boy under 18 with a live,
  -- verified own link stamped 'granted' and nothing on record.
  IF EXISTS (SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id JOIN player p ON p.id = g.player_id
              WHERE g.relationship = 'self' AND g.verification_state = 'verified' AND g.consent_state = 'granted'
                AND a.active AND (g.valid_until IS NULL OR g.valid_until > sa_today())
                AND (p.born IS NULL OR majority_on(p.born) > sa_today())
                AND NOT EXISTS (SELECT 1 FROM pupil_signin_consent x WHERE x.player_id = g.player_id)) THEN
    RAISE EXCEPTION 'db/169: the carry-over (§6) left a boy with a granted own link and nothing on record';
  END IF;
  FOR f IN SELECT unnest(ARRAY['pupil_signin_consent_set(uuid,boolean)', 'pupil_signin_office_set(uuid,boolean,text,date)',
                               'pupil_signin_retry(uuid)', 'pupil_signin_state(uuid)', 'my_own_signin()', 'pupil_signin_mine_open()',
                               'pupil_claim_not_him(uuid)',
                               'pupil_signin_stayed(uuid,timestamptz,uuid)', 'pupil_signin_yes_stands(uuid)', 'pupil_signin_in_force(uuid)',
                               'pupil_signin_open(uuid)', 'pupil_signin_is_pupils(uuid)', 'pupil_signin_child_account(uuid)',
                               'pupil_signin_terms_version()', 'pupil_signin_stamp(uuid)', 'pupil_signin_after_yes(uuid,text)',
                               'pupil_signin_my_link(uuid)', 'pupil_signin_enrolled_yes(uuid)', 'pupil_signin_link_no()',
                               'pupil_signin_account_ended()', 'pupil_signin_carry_over()']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/169: % does not pin its search_path', f;
    END IF;
    IF f <> 'pupil_signin_carry_over()' AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/169: % is not a definer', f;
    END IF;
    -- Read back from the ACL: the owner, and scrbrd_app for a door; nobody else.
    SELECT coalesce(string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text), '')
      INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = f::regprocedure AND x.grantee <> p.proowner;
    w := CASE WHEN f IN ('pupil_signin_consent_set(uuid,boolean)', 'pupil_signin_office_set(uuid,boolean,text,date)',
                         'pupil_signin_retry(uuid)', 'pupil_signin_state(uuid)', 'my_own_signin()', 'pupil_signin_mine_open()',
                         'pupil_claim_not_him(uuid)')
              THEN 'scrbrd_app:EXECUTE' ELSE '' END;
    IF v IS DISTINCT FROM w THEN
      RAISE EXCEPTION 'db/169: % is granted %', f, coalesce(nullif(v, ''), 'to nobody');
    END IF;
  END LOOP;
END $check$;
DROP TABLE IF EXISTS _db169_bodies;
RESET lock_timeout;
