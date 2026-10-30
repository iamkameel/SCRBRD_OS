-- ══════════════════════════════════════════════════════════════════
--  122 · A lapsed consent, the last doors to a pupil's email, the
--        two-letter particles, and the school's day for a move
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Four decisions Kameel made on 29 October 2026 on the Build
-- Board, and two more that afternoon on the open points the first left (1b,
-- 1c),
-- each quoted as given, in one file. Its proof is db/99 §99; the API
-- walks are tools/smoke-passport.mjs, smoke-scouting.mjs, smoke-enrol.mjs,
-- smoke-signup.mjs, smoke-accounts.mjs, smoke-family-links.mjs,
-- smoke-plan-drafts.mjs and smoke-player-move.mjs; the browser walk is
-- tools/smoke-browser-management.mjs (People: Add role on a pupil's account).
-- Eleven functions are replaced and one has a rule added (login_code_issue),
-- each guarded by the md5 of the body it was written against (whitespace
-- folded, as db/118, db/119 and db/121 guard); four are new, with two
-- RESTRICTIVE write policies on passport_consent (1c, 1d). The points a
-- read-through raised before the paste, and Kameel's answers, are §1d.
-- No table, column or row changes.
--
-- ── 1 · "THE CONSENT LAPSES WHEN THE LINK THAT GAVE IT ENDS." ─────────
-- (fam-ended-consent; the reasoning given: a boy who turns eighteen gives his
-- own consent, and nobody acts on a lapsed parent's word.)
--
-- A passport consent (passport_consent, db/08) names its giver in
-- granted_by, stamped from the session by db/08's trigger; a scouting
-- decision (player_scouting_consent, db/08) names its giver in decided_by,
-- written by scouting_consent_set(). db/115 and db/119 made the FAMILY's
-- reading and writing of both depend on a live link (is_family_of()); they
-- did not touch what a consent already given DOES. Two places decide that a
-- consent is in force, and both read only the row:
--   passport_open() (db/116)     a school the family named opens the passport
--                                while `withdrawn_at IS NULL`;
--   scouting_candidates() (db/08) a scout sees the boy while
--                                `consent_state = 'granted'`.
-- So a mother whose link closed (db/62: the later of the boy leaving school
-- and his eighteenth birthday; or the office's dated end, db/109) still had
-- her word act for her: the named school kept opening his passport, and a
-- scout kept seeing him, on the say of somebody who no longer answers for
-- him.
--
-- NOW a consent is in force only while its giver holds a live link to the
-- boy: consent_giver_live(giver, boy, given_at) asks is_family_of()'s
-- question (db/119) of the giver instead of the caller, word for word (a
-- guardian or self-access assignment of the giver's, active, in its dates,
-- not expired, not suspended, with a verified link to the boy that is in its
-- dates today), and two things more (§1d): a self-access giver counts only
-- once the boy is eighteen, and only a link already there when the consent
-- was given counts. passport_open()'s named-school arm and
-- scouting_candidates()'s join each ask it. A consent with no giver on record (granted_by or decided_by NULL:
-- only ever written by the owner, a seed or a backfill, never through a
-- door) is in force for nobody: there is no link that gave it.
--
-- COMPUTED, NOT STAMPED. "Lapsed" is not written anywhere: it is asked, at
-- the moment the consent would act, from the same columns is_family_of()
-- reads. Three reasons. (a) A link ends by a date passing (valid_until),
-- not by an event: a stamp needs a nightly job, and between midnight and the
-- job the stale consent would still act. (b) "Live" then means one thing
-- across is_family_of(), app_can() and this, instead of a second copy that
-- drifts. (c) No data changes: nothing to back-fill on paste, nothing to undo.
-- What brings a lapsed consent back (§1d below, Q4): a link the office
-- re-opens in place (a dated end moved later, a wrongly ended link
-- corrected) brings the consent back with it, because it is the same link and
-- it is live again. A link ended and then granted afresh does not: the new
-- link (a fresh assignment_subject row, and often a fresh assignment) is
-- younger than the consent, and a consent counts only the links that were
-- already there when it was given. A family that wants a consent back after
-- that gives it again.
--
-- WHAT A READER SEES. The rows stay, and their readers (db/115's) still read
-- them: a lapsed consent is history, not a deletion. Two definers tell a
-- reader of the row whether it is in force, so the screen can say "lapsed"
-- and no coach or office acts on it as a yes:
--   passport_consent_in_force(id)    for a reader of that passport consent
--                                    (db/115's terms: his family, or the office
--                                    of the school it names); NULL for anybody
--                                    else and on a pad;
--   scouting_consent_in_force(boy)   for a reader of his scouting decision
--                                    (db/115's terms: his family, the office
--                                    at his school, his side's coach); NULL
--                                    for anybody else and on a pad.
-- consent_giver_live() itself answers about anybody's link, so it is not the
-- application's: it is called only inside these definers, as their owner.
-- A NEW GIVER. passport_consent_live (db/08) allows one open row per (boy,
-- school), and a lapsed row is still open (withdrawn_at NULL). So the
-- family's grant route (services/api/write/kit-api.mjs) first withdraws a
-- lapsed row naming the same school, as the caller (db/08's update policy:
-- the family), then inserts; db/08's trigger stamps that withdrawal with the
-- new giver, who has replaced it. A scouting decision is one row per boy and
-- scouting_consent_set() overwrites it, giver and all.
--
-- ── 1b · "LET A BOY OF EIGHTEEN RECORD HIS OWN SCOUTING YES OR NO" ────
-- (Kameel, 29 October 2026, 15:11 SAST, on the open point §1 left: the
-- reasoning's "a boy who turns eighteen gives his own consent" had no door
-- for scouting, because db/08's scouting_consent_set() takes a guardian only.)
-- scouting_consent_set() now accepts, beside his guardian, the boy himself
-- through his own self-access link, once he is eighteen. Each arm asks what
-- consent_giver_live() asks of the giver, so a decision it records is in force
-- the moment it is written:
--   his guardian  a `guardian` assignment, active and in its dates, not
--                 expired, not suspended; a verified link to the boy in its
--                 dates today; processing consent granted on it (db/08's rule:
--                 the narrower decision never ahead of the broader one);
--   the boy       a `selfaccess` assignment the same, his `self` link the same,
--                 its processing consent granted, and his birth date on file
--                 with majority_on(born) <= sa_today() (db/62's eighteen, the
--                 test person_pupil_of_age() makes, db/116).
-- Never on a pad's credential. A boy under eighteen is refused
-- `not_yet_eighteen`; anybody else, a guardian whose link has ended included,
-- `not_a_consented_guardian` as before. His own decision is recorded with him
-- as decided_by, so consent_giver_live() holds for him: a lapsed guardian yes
-- followed by his own leaves one row, his, in force. The two arms narrow
-- db/08's guardian test by the assignment's own liveness (active, dates,
-- expiry, suspension), which it never read: a guardian whose assignment was
-- revoked while the link's dates stood could still say yes, a yes that
-- consent_giver_live() would then never count. EXECUTE moves from PUBLIC
-- (db/08) to scrbrd_app alone.
-- The screen: Settings → Passport draws the scouting decision beside the
-- passport consent for the same boys (SettingsView.jsx), so the boy who may
-- name a school for himself is offered his own scouting choice there too; a
-- refusal is said in words.
--
-- ── 1c · "UNDER EIGHTEEN, ONLY HIS GUARDIAN; AT EIGHTEEN, HE DOES IT
--         HIMSELF" ──────────────────────────────────────────────────────
-- (Kameel, 29 October 2026, 16:57 SAST, on the passport point §1b raised:
-- db/08's passport_consent_insert and passport_consent_update ask
-- is_family_of() alone, so a pupil's own live self-access link named a
-- school for his record, or withdrew one, at any age; nothing read his birth
-- date.) A RESTRICTIVE policy on passport_consent FOR INSERT asks
-- passport_consent_writer_ok(boy) beside db/08's permissive insert (which
-- stays as db/08 and db/115 wrote and check it):
--   his guardian  a `guardian` assignment and verified link to the boy, both
--                 live today (is_family_of()'s words), the link's processing
--                 consent granted (§1d, Q8), at any age of the boy;
--   the boy       his `selfaccess` assignment and `self` link, the same, once
--                 majority_on(born) <= sa_today() (§1b's test);
-- never on a pad. So under eighteen only a live guardian names a school; from
-- his eighteenth birthday he does it himself (and his guardian, while her
-- link lives, still may). Withdrawing is not naming (§1d, Q2): a second
-- RESTRICTIVE policy, FOR UPDATE, asks is_family_of() alone, so the boy may
-- take a school's name back at any age. Reading is untouched: the boy still
-- reads his own consents through is_family_of() (db/115, db/116). The grant
-- route (kit-api.mjs) is the insert policy's caller: a minor's own attempt is
-- refused not_permitted, and Settings → Passport says, in words, that his
-- guardian decides until he is eighteen.
--
-- ── 1d · THE READ-THROUGH'S POINTS, DECIDED ─────────────────────────
-- (Kameel, 29 October 2026, 21:15 SAST: each as recommended.) A read-through
-- of this file from the callers' side, before it was pasted, found six places
-- where the rule above stopped one step short or went one step too far.
--   Q1  A passport consent a boy named for himself before this file, while
--       under eighteen (db/08 let him), lapses. consent_giver_live()'s
--       self-access arm asks the age writer_ok() asks, so "may give it" and
--       "is in force" are the same rule; the family's next grant to that
--       school then clears the row, as for any lapsed one. Note: the test is
--       of his age today, so such a consent, still open on his eighteenth
--       birthday, counts from then, on the word of the boy who is by then of
--       age to give it.
--   Q2  Under eighteen he may still say no. The update policy (a withdrawal:
--       db/08's permissive update allows nothing else) asks is_family_of()
--       alone; naming stays with his guardian. The withdraw route answers
--       403 when nothing was withdrawn, and Settings → Passport says why.
--   Q3  Confirming or declining a Google claim on a pupil's account, and
--       issuing a pupil a sign-in code, are the office's alone
--       (guardian.link.manage at a school he is at): the same people who
--       are shown the addresses those acts are judged by (app_user_email_seen(),
--       db/118). pending_claim_confirm(), pending_claim_decline() (db/81) and
--       login_code_issue() (db/05, db/81) answer `office_only` to anybody
--       else, the director of sport included, who still adds roles to a
--       pupil's account by its id (§2). "Issue a code" names the account by
--       its id too, and the route reads its address server-side, as
--       add-role does. The Claims screen draws no answer on a row whose
--       addresses it was not given, and says whose it is.
--   Q4  A re-granted link does not bring a lapsed consent back.
--       consent_giver_live() takes the consent's own time (granted_at,
--       decided_at) and counts a link only when its assignment and its
--       subject row were both written by then. A link whose end is moved or
--       corrected in place is the same row, so it still revives the consent.
--       Both are asked, not only the assignment: guardian_link_establish()
--       (db/62) hangs a new link on the guardian's existing assignment.
--   Q8  A guardian names a school only on a link whose processing consent is
--       granted, as scouting_consent_set() already asks: the narrower
--       decision never ahead of the broader one.
--   F9  The anon/authenticated check below names every function the revoke
--       does.
-- Kept as they are, decided: a moved boy keeps his new side's earlier
-- notices (db/123); a boy's own consent at eighteen lapses with his own link.
-- Left for a later file, decided: the remaining current_date reads (§4).
--
-- ── 2 · "CLOSE BOTH DOORS, AND ADD-ROLE USES THE ACCOUNT ID." ─────────
-- (email-doors; extending Kameel's 28 October answer, "The office alone, as
-- A4 says": only guardian.link.manage reads a pupil's login email.)
-- db/118 put app_user_email_seen() on the `users` and `accounts` reads. Three
-- definers of db/81's still returned the address as stored:
--   role_requester(request)  u.email, to a holder of user.role.assign at the
--                            request's school who may grant its role: the
--                            director of sport;
--   pending_claims()         account_email and presented_email (the Google
--                            address claiming the account), to the account's
--                            office under auth_office_refusal(): user.invite,
--                            which the director of sport holds, over a pupil
--                            account whose only role she may grant (`player`);
--   account_sign_ins(user)   email_at_link, to the same.
-- Each now hands every address through app_user_email_seen(account,
-- account's school, address): the account holder himself and, for a
-- pupil's account, guardian.link.manage at a school he is at; an adult's
-- account unchanged. Every other column, the order and the WHERE are db/81's.
-- The account's school (not the request's) is passed for role_requester(), so
-- the rule is the `users` read's exactly: a pupil asking another school for a
-- role is not that school's office's to read the address of.
-- ADD ROLE BY THE ACCOUNT. People's "Add role" posted the account's email to
-- POST /api/users, so it was offered only where the reader had been given
-- one: since db/118 the director of sport could not add a role to a pupil's
-- account at all. The screen now posts the account's id (`userId`); the
-- route reads the account's address under the caller's own row security
-- (app_user_read, db/09: the same rows People listed) and hands it to
-- enrol_person() as before. The address never leaves the server. No SQL
-- changes for it.
--
-- ── 3 · "SKIP THEM, AS THE THREE-LETTER ONES ARE SKIPPED." ───────────
-- (news-particles.) db/118's header says "The surname particles (van, der,
-- de, …) are not names on their own and are not scanned as words". From the
-- same file's "Catch two-letter names too" (28 Oct) that was untrue of the
-- two-letter ones: the word list read words of two letters or more and left
-- out only three-letter particles, so "de", "du", "le", "la", "da" and "di"
-- were scanned, and a post saying "Tour de France" refused for every boy
-- named de Villiers. db/118 is frozen; its header is corrected here.
-- news_public_hits() now also leaves out 'de', 'du', 'le', 'la', 'da', 'di'
-- as words. Two-letter first names stay caught ("Jo", "Al"); the full name
-- and the stored surname that carry a particle ("de Villiers") are still
-- scanned whole. A boy whose first name IS one of the six (an "Di") is found
-- by his full name only: the cost of the decision, as it is for a "Van".
--
-- ── 4 · "THE SCHOOL'S DAY (SAST), EVERYWHERE." ────────────────────────
-- (midnight-date.) db/08's history trigger (player_team_membership_log())
-- and db/117's seat void (player_move_voids_seats()), which reads the day as
-- it does, dated a move with no effective_on as current_date: the database
-- session's day, UTC on every host we run. Everything that reads the move
-- back (side_on(), side_day(), §94) asks sa_today(), Johannesburg's day. From
-- 00:00 to 02:00 SAST the two disagree: a move typed then was dated
-- yesterday, its old side closed a day early, and the seat void compared a
-- fixture's SA day with UTC's. That is the CI failure between midnight and
-- two. Both triggers now date it sa_today(); nothing else in either body
-- moves. The move route's "not in the future" check
-- (services/api/write/roster-api.mjs) compared with the server's UTC date,
-- refusing a move dated today between 00:00 and 02:00; it asks sa_today()
-- now.
-- THE OTHER current_date IN THE ROLLOVER PATH, found (pg_proc, every body
-- that reads it, on a database at this file) and left, for Kameel: each asks
-- whether a link or an assignment is live today, spelled as app_can() spells
-- it, so moving one alone would make "live" mean two things at midnight:
--   app_can(), app_holds(), app_enrolled(), app_may_grant_at() (db/50,
--     db/81, db/77): every capability the move route and the carry ask;
--   player_own_accounts() (db/112): whose `player` assignment the carry
--     moves with the boy (his self-access link live today);
--   my_own_boy() (db/106; db/117 branch 5): the moved boy reading his old
--     side's season;
--   is_family_of() (db/119) and consent_giver_live() (this file, its words);
--   guardian_links_reopen_at_school() (db/62, db/109): a boy moved back to a school;
--   role_assignment_ending_links() (db/109); person_pupil_of_age() (db/116);
--   lift_live_link(), lift_link_is_live(), lift_family_at() (db/70): whose
--     seat a move voids is asked of the seat, but who may ask for one is these.
-- And in db/99 the stages of §94, §96 and §97 end links with current_date,
-- which the functions above read alike, so they agree at any hour.
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   function consent_giver_live(uuid,uuid,timestamptz): new; not a definer,
--     nobody's to call (owner only)
--   function passport_consent_in_force(uuid), scouting_consent_in_force(uuid):
--     new definers, scrbrd_app's alone
--   function passport_consent_writer_ok(uuid): new definer, scrbrd_app's;
--     policies passport_consent_writer_of_age_insert and
--     passport_consent_withdraw_by_family: new RESTRICTIVE writes (§1c, §1d);
--     a pupil under eighteen no longer names a school for his own record, and
--     still withdraws one; a guardian names one only on a consented link
--   function pending_claim_confirm(uuid), pending_claim_decline(uuid) (db/81):
--     bodies replaced (§1d, Q3); login_code_issue(text,text,integer) (db/05,
--     db/81): one rule added, its grants untouched; a pupil's claim and code
--     are the office's alone from the paste
--   function scouting_consent_set(uuid,boolean) (db/08): body replaced (§1b);
--     a boy of eighteen on his own live self-access link may record his own
--     scouting decision; a guardian whose assignment is no longer live may
--     not; EXECUTE from PUBLIC to scrbrd_app alone
--   function passport_open(uuid) (db/116), scouting_candidates() (db/08):
--     bodies replaced (§1); a named school stops opening the passport, and a
--     scout stops seeing the boy, on the paste, wherever the consent's giver's
--     link has ended or no giver is on record
--   function role_requester(uuid), pending_claims(), account_sign_ins(uuid)
--     (db/81): bodies replaced (§2); a pupil's address reads NULL to the
--     director of sport from the paste
--   function news_public_hits(uuid) (db/118): body replaced (§3); a post
--     refused only on a two-letter particle passes on its next check
--   function player_team_membership_log() (db/08), player_move_voids_seats()
--     (db/117): bodies replaced (§4); rows already written keep their dates
-- Every replaced function keeps its owner, volatility, SECURITY DEFINER where
-- it had it, a pinned search_path and its grants (re-stated below). No
-- table, column or row is changed; the only policies are §1c's two. A second
-- paste changes nothing.
--
-- SCHEMA FIRST. The read API's `passport_consents` and `scouting_consent`
-- select the two in-force definers, so this file goes before the API built
-- with it; it is in services/api/expected-migrations.json.


-- ── 0 · Refuse to replace a function this file was not written against ──
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('is_family_of(uuid)') IS NULL OR to_regprocedure('app_user_email_seen(uuid,uuid,text)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('sa_date(timestamptz)') IS NULL
     OR to_regprocedure('auth_office_refusal(uuid)') IS NULL OR to_regclass('duty_suspension') IS NULL THEN
    RAISE EXCEPTION 'db/122: is_family_of() (db/119), app_user_email_seen() (db/118), sa_date() (db/117), auth_office_refusal() (db/81) or duty_suspension is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('passport_open(uuid)',          '426f91567b99785310185b5ebfd42346', 'c90384bf784a087fd550806652195c78',       'db/116'),
      ('scouting_candidates()',        '533f1ccd3304a3e8bb1e29637a3fec3f', '4665afc95b78b8665e183295a18a4a72', 'db/08'),
      ('scouting_consent_set(uuid,boolean)', '898a4915b3972ed71c19bbe635d99d01', '71b868ef399b6fa87d7fcadcb8970bc0', 'db/08'),
      ('role_requester(uuid)',         '991ca8bf0de42d29b36108573dc3a8ef', '857f0abb653308c38daa7e17d7b94999',      'db/81'),
      ('pending_claims()',             '9eb59cdbe26f1d8b4905a351b042d3fc', 'd76db45e4ce4a1781888a98915076fa7',      'db/81'),
      ('account_sign_ins(uuid)',       'cf8f7322926c64e6d9b78ac88e34c1df', '39004443afcccbc50880d1984514a430',    'db/81'),
      ('news_public_hits(uuid)',       'da73e5d4f2fe601485c713a1cd450bae', '2c2296a3beb8ea82670e19383b48b98c',    'db/118'),
      ('player_team_membership_log()', '22e432167c473430ccbe64f11339592b', 'a21a68428e85a5fe5e1c310ed14cdd48',      'db/08'),
      ('player_move_voids_seats()',    '4088060d4f616621a2b8b849fb74175c', 'c09401725f95ee31449d0a0388224646',         'db/117'),
      ('pending_claim_confirm(uuid)',  '41d9624d063203c197169bc16a1ee8fa', '6ae865dff4087c7000c7e34f8400603e', 'db/81'),
      ('pending_claim_decline(uuid)',  '351432ae34696ca111fb0759652f2819', '110d4d904c38ab2f4addd95a9033b4c4', 'db/81'),
      ('login_code_issue(text,text,integer)', '239368d19f4eeeae71d26433a7993838', 'b6094044b5f0a5b39c81181831ba87c2', 'db/81'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/122: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/122: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · A consent is in force while the link that gave it is live
-- ══════════════════════════════════════════════════════════════════
/**
 * Does p_giver hold a live link to p_player today that already stood when
 * the consent was given (p_given_at): is_family_of()'s question (db/119),
 * word for word, asked of the giver instead of the caller, with no pad test
 * (that is about the caller's session, not the giver's link), and two
 * clauses after it (§1d): a self-access giver counts once the boy is
 * eighteen (Q1, writer_ok()'s age), and the assignment and the link must
 * both be no younger than the consent (Q4). False for a NULL giver.
 * Internal: not a definer, granted to nobody, called only inside the
 * definers below (as their owner).
 */
CREATE OR REPLACE FUNCTION consent_giver_live(p_giver uuid, p_player uuid, p_given_at timestamptz) RETURNS boolean AS $$
  SELECT p_giver IS NOT NULL AND EXISTS (
    SELECT 1 FROM role_assignment a
    JOIN assignment_subject s ON s.assignment_id = a.id
   WHERE a.person_id = p_giver AND a.active
     AND a.role IN ('guardian', 'selfaccess')
     AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
     AND (a.valid_until IS NULL OR a.valid_until >  current_date)
     AND (a.expires_at IS NULL OR a.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                      WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
     AND s.player_id = p_player AND s.verification_state = 'verified'
     AND s.valid_from <= current_date
     AND (s.valid_until IS NULL OR s.valid_until > current_date)
     AND (a.role = 'guardian'
          OR EXISTS (SELECT 1 FROM player p WHERE p.id = s.player_id
                        AND p.born IS NOT NULL AND majority_on(p.born) <= sa_today()))
     AND a.created_at <= p_given_at AND s.created_at <= p_given_at)
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION consent_giver_live(uuid, uuid, timestamptz) FROM PUBLIC;

/**
 * db/116's passport_open(), its named-school arm asking that the consent's
 * giver still holds a live link to the boy. The family's arm and the arms at
 * his own school are db/116's, line for line.
 */
CREATE OR REPLACE FUNCTION passport_open(p_player uuid) RETURNS boolean AS $$
  SELECT is_family_of(p_player)
      OR EXISTS (SELECT 1 FROM player p WHERE p.id = p_player
                    AND (app_can('team.select', p.school_id, p.team_code, p.id, NULL::uuid)
                         OR app_can('player.profile.manage', p.school_id, p.team_code, p.id, NULL::uuid)
                         OR app_can('guardian.link.manage', p.school_id, '*'::text,
                                    '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)))
      OR EXISTS (SELECT 1 FROM passport_consent c
                  WHERE c.player_id = p_player AND c.withdrawn_at IS NULL
                    -- In force only while the link that gave it is live (db/122).
                    AND consent_giver_live(c.granted_by, c.player_id, c.granted_at)
                    AND (app_can('guardian.link.manage', c.to_school_id, '*'::text,
                                 '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
                         OR app_can('team.select', c.to_school_id, '*'::text,
                                    '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * db/08's scouting_candidates(), its consent join asking that the decision's
 * giver still holds a live link to the boy. Every other line is db/08's.
 */
CREATE OR REPLACE FUNCTION scouting_candidates()
RETURNS TABLE (
  player_id uuid, full_name text, school_id uuid, team_code text,
  playing_role text, batting_style text, bowling_style text,
  batting_matches bigint, runs bigint, balls_faced bigint,
  bowling_matches bigint, wickets bigint, runs_conceded bigint, legal_balls bigint
) AS $$
  SELECT p.id, p.full_name, p.school_id, p.team_code,
         p.playing_role, p.batting_style, p.bowling_style,
         coalesce(bc.matches, 0), bc.runs, bc.balls_faced,
         coalesce(bw.matches, 0), bw.wickets, bw.runs_conceded, bw.legal_balls
    FROM player p
    JOIN player_scouting_consent c ON c.player_id = p.id AND c.consent_state = 'granted'
                                  -- In force only while the link that gave it is live (db/122).
                                  AND consent_giver_live(c.decided_by, c.player_id, c.decided_at)
    LEFT JOIN player_batting_career bc ON bc.player_id = p.id
    LEFT JOIN player_bowling_career bw ON bw.player_id = p.id
   WHERE app_can('scouting.read', p.school_id, '*'::text, p.id,
                 '00000000-0000-0000-0000-000000000000'::uuid)
     AND EXISTS (SELECT 1 FROM scout_accreditation sa
                  WHERE sa.person_id = app_user_id()
                    AND sa.verification_status = 'verified')
     AND (coalesce(bc.matches, 0) + coalesce(bw.matches, 0)) >= scouting_evidence_threshold()
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Is this passport consent in force: not withdrawn, and its giver's link
 * live. Answered only to a reader of the row (db/115's passport_consent_read:
 * the boy's family, or the office of the school it names), never on a pad;
 * NULL to anybody else, and for an id that is no consent.
 */
CREATE OR REPLACE FUNCTION passport_consent_in_force(p_consent uuid) RETURNS boolean AS $$
  SELECT c.withdrawn_at IS NULL AND consent_giver_live(c.granted_by, c.player_id, c.granted_at)
    FROM passport_consent c
   WHERE c.id = p_consent AND NOT app_pad_scoped()
     AND (is_family_of(c.player_id)
          OR app_can('guardian.link.manage', c.to_school_id, '*'::text,
                     '00000000-0000-0000-0000-000000000000'::uuid,
                     '00000000-0000-0000-0000-000000000000'::uuid))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Is this boy's scouting decision a yes in force: granted, and its giver's
 * link live (false for a withdrawal, and for a yes whose giver's link has
 * ended). Answered only to a reader of the row (db/115's
 * player_scouting_consent_read: his family, the office at his school, his
 * own side's coach), never on a pad; NULL to anybody else, and for a boy
 * with no decision.
 */
CREATE OR REPLACE FUNCTION scouting_consent_in_force(p_player uuid) RETURNS boolean AS $$
  SELECT c.consent_state = 'granted' AND consent_giver_live(c.decided_by, c.player_id, c.decided_at)
    FROM player_scouting_consent c
   WHERE c.player_id = p_player AND NOT app_pad_scoped()
     AND (is_family_of(c.player_id)
          OR app_can('guardian.link.manage', player_school(c.player_id), '*'::text,
                     '00000000-0000-0000-0000-000000000000'::uuid,
                     '00000000-0000-0000-0000-000000000000'::uuid)
          OR app_can('player.development.read', player_school(c.player_id), player_team(c.player_id),
                     c.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * db/08's one door to a scouting decision, with the boy of eighteen beside
 * his guardian (Kameel, 29 October 2026: "Let a boy of eighteen record his
 * own scouting yes or no"). See (1b) above. Still no administrative
 * override: the office, a coach, the director of sport answer
 * not_a_consented_guardian, as before. The write is db/08's, line for line:
 * the caller is decided_by.
 */
CREATE OR REPLACE FUNCTION scouting_consent_set(
  p_player  uuid,
  p_granted boolean
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
BEGIN
  IF v_me IS NULL OR app_pad_scoped() THEN
    RETURN QUERY SELECT false, 'not_a_consented_guardian'; RETURN;
  END IF;
  -- Consent to being scouted rests on top of consent to be processed at all
  -- (g.consent_state = 'granted'), never ahead of it, on either arm. Each
  -- arm's link is live today in consent_giver_live()'s words.
  IF NOT EXISTS (
    SELECT 1 FROM assignment_subject g
      JOIN role_assignment a ON a.id = g.assignment_id
      JOIN player p ON p.id = g.player_id
     WHERE g.player_id = p_player
       AND a.person_id = v_me AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                        WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
       AND g.verification_state = 'verified'
       AND g.consent_state = 'granted'
       AND g.valid_from <= current_date
       AND (g.valid_until IS NULL OR g.valid_until > current_date)
       AND (a.role = 'guardian'
            -- The boy himself, through his own link, once he is eighteen.
            OR (a.role = 'selfaccess' AND g.relationship = 'self'
                AND p.born IS NOT NULL AND majority_on(p.born) <= sa_today()))
  ) THEN
    -- His own live link, but not yet eighteen: said as that.
    IF EXISTS (SELECT 1 FROM assignment_subject g
                 JOIN role_assignment a ON a.id = g.assignment_id
                 JOIN player p ON p.id = g.player_id
                WHERE g.player_id = p_player AND a.person_id = v_me AND a.active
                  AND a.role = 'selfaccess' AND g.relationship = 'self'
                  AND g.verification_state = 'verified'
                  AND (g.valid_until IS NULL OR g.valid_until > current_date)
                  AND (p.born IS NULL OR majority_on(p.born) > sa_today())) THEN
      RETURN QUERY SELECT false, 'not_yet_eighteen'; RETURN;
    END IF;
    RETURN QUERY SELECT false, 'not_a_consented_guardian'; RETURN;
  END IF;

  INSERT INTO player_scouting_consent (player_id, consent_state, decided_by, decided_at)
       VALUES (p_player, CASE WHEN p_granted THEN 'granted' ELSE 'withdrawn' END,
               v_me, now())
  ON CONFLICT (player_id) DO UPDATE
       SET consent_state = excluded.consent_state,
           decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


/**
 * May the caller name a school for p_player's record: his live guardian, on
 * a link whose processing consent is granted (§1d, Q8), or the boy himself on
 * his live self-link once he is eighteen (Kameel, 29 October 2026: "Under
 * eighteen, only his guardian; at eighteen, he does it himself"). See (1c)
 * above. The RESTRICTIVE insert policy below asks it; a definer, because the
 * caller cannot read every assignment and link it reads. Withdrawing is not
 * asked of it (§1d, Q2).
 */
CREATE OR REPLACE FUNCTION passport_consent_writer_ok(p_player uuid) RETURNS boolean AS $$
  SELECT NOT app_pad_scoped() AND EXISTS (
    SELECT 1 FROM role_assignment a
    JOIN assignment_subject s ON s.assignment_id = a.id
    JOIN player p ON p.id = s.player_id
   WHERE a.person_id = app_user_id() AND a.active
     AND (a.role = 'guardian'
          -- The boy himself, through his own link, once he is eighteen.
          OR (a.role = 'selfaccess' AND s.relationship = 'self'
              AND p.born IS NOT NULL AND majority_on(p.born) <= sa_today()))
     AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
     AND (a.valid_until IS NULL OR a.valid_until >  current_date)
     AND (a.expires_at IS NULL OR a.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                      WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
     AND s.player_id = p_player AND s.verification_state = 'verified'
     -- Processing consent first, as scouting_consent_set() asks (Q8).
     AND s.consent_state = 'granted'
     AND s.valid_from <= current_date
     AND (s.valid_until IS NULL OR s.valid_until > current_date))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Naming a school: the guardian, or the boy at eighteen (§1c).
DROP POLICY IF EXISTS passport_consent_writer_of_age_insert ON passport_consent;
CREATE POLICY passport_consent_writer_of_age_insert ON passport_consent AS RESTRICTIVE
  FOR INSERT WITH CHECK (passport_consent_writer_ok(player_id));
-- Taking a name back: anyone of his family on a live link, the boy at any age
-- (§1d, Q2). db/08's permissive update asks the same and allows a withdrawal
-- only; this keeps the rule in place if a wider permissive is ever added.
DROP POLICY IF EXISTS passport_consent_withdraw_by_family ON passport_consent;
CREATE POLICY passport_consent_withdraw_by_family ON passport_consent AS RESTRICTIVE
  FOR UPDATE USING (is_family_of(player_id)) WITH CHECK (is_family_of(player_id));
COMMENT ON POLICY passport_consent_writer_of_age_insert ON passport_consent IS
  'Under eighteen, only his guardian; at eighteen, he does it himself (Kameel, 29 Oct 2026; db/122 1c).';
COMMENT ON POLICY passport_consent_withdraw_by_family ON passport_consent IS
  'Under eighteen he may still withdraw; naming stays with his guardian (Kameel, 29 Oct 2026; db/122 1d).';


-- ══════════════════════════════════════════════════════════════════
-- §2 · The last doors to a pupil's login email
-- ══════════════════════════════════════════════════════════════════
/** db/81's Claims list, each address through app_user_email_seen() (db/118). */
CREATE OR REPLACE FUNCTION pending_claims()
RETURNS TABLE (id uuid, user_id uuid, account_name text, account_email text, account_active boolean,
               school_id uuid, presented_email text, provider text, requested_at timestamptz,
               last_requested_at timestamptz) AS $$
  SELECT c.id, u.id, u.name, app_user_email_seen(u.id, u.school_id, u.email), u.active, u.school_id,
         app_user_email_seen(u.id, u.school_id, c.email), c.provider, c.requested_at, c.last_requested_at
    FROM pending_claim c JOIN app_user u ON u.id = c.user_id
   WHERE c.resolved_at IS NULL AND app_user_id() IS NOT NULL
     AND auth_office_refusal(c.user_id) IS NULL
   ORDER BY c.last_requested_at DESC, c.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/81's view of one account's sign-ins, the address through app_user_email_seen(). Never the uid. */
CREATE OR REPLACE FUNCTION account_sign_ins(p_user uuid)
RETURNS TABLE (id uuid, provider text, email_at_link text, linked_at timestamptz, linked_how text,
               last_sign_in_at timestamptz, revoked_at timestamptz) AS $$
  SELECT x.id, x.provider,
         app_user_email_seen(p_user, (SELECT u.school_id FROM app_user u WHERE u.id = p_user), x.email_at_link),
         x.linked_at, x.linked_how, x.last_sign_in_at, x.revoked_at
    FROM auth_identity x
   WHERE x.user_id = p_user AND auth_office_refusal(p_user) IS NULL
   ORDER BY x.revoked_at IS NOT NULL, x.linked_at, x.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/81's who-asked, the address through app_user_email_seen(), at the account's school. */
CREATE OR REPLACE FUNCTION role_requester(p_request uuid)
RETURNS TABLE (name text, email text) AS $$
  SELECT u.name, app_user_email_seen(u.id, u.school_id, u.email)
    FROM role_request r JOIN app_user u ON u.id = r.person_id
   WHERE r.id = p_request AND NOT app_pad_scoped()
     AND (r.person_id = app_user_id()
          OR (app_can('user.role.assign', r.school_id, '*'::text,
                      '00000000-0000-0000-0000-000000000000'::uuid,
                      '00000000-0000-0000-0000-000000000000'::uuid)
              AND app_may_grant_at(r.role, r.school_id)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- ── 2b · A pupil's claim and code are the office's (§1d, Q3) ──────
-- The test is app_user_email_seen() (db/118) asked with a placeholder
-- address: it hands an address back exactly to those who are shown a pupil's
-- (the account holder, and guardian.link.manage at a school he is at), and
-- to anyone for an adult's account. So whoever is not shown a pupil's
-- addresses does not answer his claim or issue his code: they are told
-- `office_only`. auth_office_refusal() (db/81) is asked first, as before, so
-- a stranger still learns nothing about the account.

/** db/81's confirm, with the pupil's-account test after the office rule. Every other line is db/81's. */
CREATE OR REPLACE FUNCTION pending_claim_confirm(p_claim uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c pending_claim%ROWTYPE; v_me uuid := app_user_id(); v_why text;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  SELECT * INTO c FROM pending_claim x WHERE x.id = p_claim FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  v_why := auth_office_refusal(c.user_id);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why; RETURN; END IF;
  IF app_user_email_seen(c.user_id, (SELECT u.school_id FROM app_user u WHERE u.id = c.user_id), '@') IS NULL THEN
    RETURN QUERY SELECT false, 'office_only'; RETURN;
  END IF;
  IF c.resolved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_resolved'; RETURN; END IF;
  IF c.user_id = v_me THEN RETURN QUERY SELECT false, 'cannot_confirm_your_own'; RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('auth_identity:' || c.provider || ':' || c.provider_uid, 81));
  IF EXISTS (SELECT 1 FROM auth_identity x WHERE x.provider = c.provider AND x.provider_uid = c.provider_uid) THEN
    UPDATE pending_claim SET resolved_at = now(), resolved_how = 'superseded', resolved_by = v_me WHERE id = c.id;
    RETURN QUERY SELECT false, 'identity_in_use'; RETURN;
  END IF;
  BEGIN
    INSERT INTO auth_identity (user_id, provider, provider_uid, email_at_link, linked_how, linked_by)
    VALUES (c.user_id, c.provider, c.provider_uid, c.email, 'office_confirmed', v_me);
  EXCEPTION WHEN check_violation THEN
    RETURN QUERY SELECT false, CASE WHEN SQLERRM = 'pupil_consent_required' THEN SQLERRM ELSE 'refused' END;
    RETURN;
  END;
  UPDATE pending_claim SET resolved_at = now(), resolved_how = 'office_confirmed', resolved_by = v_me WHERE id = c.id;
  PERFORM auth_identity_log('auth.claim_confirmed', c.user_id);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/81's decline, with the same test. Every other line is db/81's. */
CREATE OR REPLACE FUNCTION pending_claim_decline(p_claim uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c pending_claim%ROWTYPE; v_why text;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  SELECT * INTO c FROM pending_claim x WHERE x.id = p_claim FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  v_why := auth_office_refusal(c.user_id);
  IF v_why IS NOT NULL THEN RETURN QUERY SELECT false, v_why; RETURN; END IF;
  IF app_user_email_seen(c.user_id, (SELECT u.school_id FROM app_user u WHERE u.id = c.user_id), '@') IS NULL THEN
    RETURN QUERY SELECT false, 'office_only'; RETURN;
  END IF;
  IF c.resolved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_resolved'; RETURN; END IF;
  UPDATE pending_claim SET resolved_at = now(), resolved_how = 'declined', resolved_by = app_user_id() WHERE id = c.id;
  PERFORM auth_identity_log('auth.claim_declined', c.user_id);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- login_code_issue() (db/05, with db/81's account rule), one rule more: the
-- same test, after db/81's. Re-emitted as db/81 re-emitted it, by inserting
-- the rule before the one statement that spends the previous codes, so its
-- owner, settings and grants (PUBLIC's EXECUTE among them, db/05: the body
-- decides) stay as they are. A body that already carries the rule is left
-- alone, so a second paste changes nothing; §0 refused any third body.
DO $issue$
DECLARE
  v_fn   regprocedure := 'login_code_issue(text,text,integer)'::regprocedure;
  v_old  text := '  UPDATE login_code SET used_at = now()';
  v_rule text := '  -- db/122: a pupil''s code is the office''s alone, as his addresses are.' || chr(10)
              || '  IF app_user_email_seen(v_user, v_school, ''@'') IS NULL THEN' || chr(10)
              || '    RETURN QUERY SELECT false, ''office_only''::text, NULL::uuid, NULL::timestamptz; RETURN;' || chr(10)
              || '  END IF;' || chr(10) || chr(10);
  v_src  text; v_cfg text; v_acl text; v_sec boolean;
BEGIN
  SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
    INTO v_src, v_cfg, v_acl, v_sec FROM pg_proc p WHERE p.oid = v_fn;
  IF position(v_rule IN v_src) > 0 THEN RETURN; END IF;
  IF (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'db/122: login_code_issue() does not spend the previous codes exactly once';
  END IF;
  EXECUTE replace(pg_get_functiondef(v_fn), v_old, v_rule || v_old);
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM replace(v_src, v_old, v_rule || v_old)
     OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn) IS DISTINCT FROM v_sec THEN
    RAISE EXCEPTION 'db/122: re-emitting login_code_issue() changed more than the pupil''s rule';
  END IF;
END $issue$;


-- ══════════════════════════════════════════════════════════════════
-- §3 · The public news scan skips the two-letter particles too
-- ══════════════════════════════════════════════════════════════════
/**
 * db/118's scan, with 'de', 'du', 'le', 'la', 'da', 'di' beside the
 * three-letter particles among the words of a full name it does not read on
 * their own (Kameel, 29 October 2026). Every other line is db/118's.
 * Internal: not a definer, nobody's to call.
 */
CREATE OR REPLACE FUNCTION news_public_hits(p_post uuid)
RETURNS TABLE (player_id uuid, word text, at integer) AS $$
  WITH post AS (
    SELECT n.school_id, n.title || E'\n' || n.body AS txt FROM news_post n WHERE n.id = p_post
  ), schools AS (
    SELECT post.school_id AS school_id FROM post
    UNION
    SELECT CASE WHEN m.school_id = post.school_id THEN m.away_school_id ELSE m.school_id END
      FROM match m, post
     WHERE (m.school_id = post.school_id OR m.away_school_id = post.school_id)
       AND m.away_school_id IS NOT NULL
       AND m.starts_at >= now() - interval '12 months'
       AND m.starts_at <= now() + interval '3 months'
  ), names AS (
    SELECT p.id AS player_id, c.name
      FROM player p
      JOIN schools sc ON sc.school_id = p.school_id
      CROSS JOIN LATERAL (
        SELECT btrim(x) AS name
          FROM unnest(ARRAY[p.full_name, p.known_as, p.surname]) AS x
         WHERE length(btrim(coalesce(x, ''))) >= 2
        UNION
        SELECT t
          FROM regexp_split_to_table(btrim(coalesce(p.full_name, '')), '[^[:alpha:]]+') AS t
         WHERE length(t) >= 2
           AND lower(t) NOT IN ('van', 'von', 'der', 'den', 'des', 'del', 'dos', 'das', 'ten', 'ter',
                                'de', 'du', 'le', 'la', 'da', 'di')) AS c
  ), hits AS (
    SELECT nm.player_id,
           regexp_match(post.txt,
             '(?:^|[^[:alnum:]])('
             || regexp_replace(regexp_replace(nm.name, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g'), '\s+', '\\s+', 'g')
             || ')(?:$|[^[:alnum:]])', 'i') AS m,
           post.txt
      FROM names nm, post
  )
  SELECT h.player_id, h.m[1], strpos(h.txt, h.m[1])
    FROM hits h
   WHERE h.m IS NOT NULL
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §4 · A move is dated by the school's day
-- ══════════════════════════════════════════════════════════════════
/**
 * db/08's history trigger, with a move that names no effective_on dated
 * sa_today() (Johannesburg's day), not current_date (the session's, UTC).
 * Every other line is db/08's.
 */
CREATE OR REPLACE FUNCTION player_team_membership_log() RETURNS trigger AS $$
DECLARE
  v_on   date;
  v_open team_membership%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.team_code IS NOT DISTINCT FROM OLD.team_code
     AND NEW.school_id IS NOT DISTINCT FROM OLD.school_id THEN
    RETURN NEW;
  END IF;

  -- WHEN it took effect: app.effective_on (the move route, the seed, the
  -- import) and, absent, the school's day (db/122: the cricket's calendar,
  -- not the database session's).
  v_on := coalesce(nullif(current_setting('app.effective_on', true), '')::date, sa_today());

  SELECT * INTO v_open FROM team_membership
   WHERE player_id = NEW.id AND sport = 'cricket' AND left_on IS NULL;
  IF FOUND THEN
    -- Already recorded — a re-applied seed, or an import that changed nothing.
    IF v_open.team_code IS NOT DISTINCT FROM NEW.team_code
       AND v_open.school_id IS NOT DISTINCT FROM NEW.school_id THEN
      RETURN NEW;
    END IF;
    IF v_on < v_open.joined_on THEN
      RAISE EXCEPTION
        'a move cannot take effect on %: his current side (%) only began on %',
        v_on, v_open.team_code, v_open.joined_on
        USING ERRCODE = 'check_violation';
    END IF;
    -- Close whatever was open. left_on, not deletion: the row that says he WAS
    -- in the 2XI is the entire purpose of this table.
    UPDATE team_membership SET left_on = v_on WHERE id = v_open.id;
  END IF;

  IF NEW.team_code IS NOT NULL THEN
    INSERT INTO team_membership (player_id, school_id, sport, team_code, joined_on, reason, moved_by)
    VALUES (NEW.id, NEW.school_id, 'cricket', NEW.team_code, v_on,
            CASE WHEN TG_OP = 'INSERT' THEN 'joined' ELSE 'moved' END,
            app_user_id());
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * db/117's seat void, reading the move's day as the history trigger now
 * does: effective_on, else sa_today(). Every other line is db/117's.
 */
CREATE OR REPLACE FUNCTION player_move_voids_seats() RETURNS trigger AS $$
DECLARE
  v_on date;
  s    record;
BEGIN
  IF NEW.team_code IS NOT DISTINCT FROM OLD.team_code
     AND NEW.school_id IS NOT DISTINCT FROM OLD.school_id THEN
    RETURN NULL;
  END IF;
  IF OLD.team_code IS NULL THEN
    RETURN NULL;
  END IF;
  -- The day the move took effect, as db/08's history trigger reads it (db/122: sa_today()).
  v_on := coalesce(nullif(current_setting('app.effective_on', true), '')::date, sa_today());
  FOR s IN SELECT ls.id, ls.offer_id
             FROM lift_seat ls
             JOIN match m ON m.id = ls.match_id
            WHERE ls.player_id = NEW.id
              AND ls.school_id = OLD.school_id AND ls.team_code = OLD.team_code
              AND ls.state IN ('requested', 'invited', 'confirmed')
              AND ls.boarded_at IS NULL
              AND sa_date(m.starts_at) > v_on
              -- ...and still to come: a backdated move does not void a lift already past
              AND m.starts_at > now()
              -- ...which he no longer reaches: not his new side's end...
              AND NOT (ls.school_id = NEW.school_id AND ls.team_code IS NOT DISTINCT FROM NEW.team_code)
              -- ...and not named on that end's sheet (he still goes)
              AND NOT EXISTS (SELECT 1 FROM match_squad q
                               WHERE q.match_id = m.id AND q.player_id = NEW.id AND NOT q.withdrawn
                                 AND ((q.side = 'home' AND m.school_id = ls.school_id)
                                   OR (q.side = 'away' AND m.away_school_id = ls.school_id)))
            ORDER BY m.starts_at, ls.id
            FOR UPDATE OF ls LOOP
    UPDATE lift_seat SET state = 'void', ended_at = now(), ended_by = app_user_id() WHERE id = s.id;
    PERFORM lift_notify(s.offer_id, (SELECT x.driver_id FROM lift_offer x WHERE x.id = s.offer_id), NULL,
      'A seat was withdrawn', lift_offer_words(s.offer_id) || ': a seat is no longer confirmed and has been withdrawn.');
    PERFORM lift_notify_family(s.offer_id, NEW.id, 'A seat on a lift was withdrawn',
      lift_offer_words(s.offer_id) || ': his seat has been withdrawn, because he is no longer on that side. '
        || 'If he should still travel to it, ask the school.');
    PERFORM lift_lone_fallback(s.offer_id);
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── Grants ─────────────────────────────────────────────────────────
-- The application's: the readers' definers, and the ones they replace that
-- were its already. Nobody's: the internal scan and giver test. The
-- triggers': their owner's alone, as db/117 left the seat void.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'scouting_candidates()', 'passport_consent_in_force(uuid)',
                           'scouting_consent_in_force(uuid)', 'role_requester(uuid)', 'pending_claims()',
                           'account_sign_ins(uuid)', 'scouting_consent_set(uuid,boolean)', 'passport_consent_writer_ok(uuid)',
                           'pending_claim_confirm(uuid)', 'pending_claim_decline(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['consent_giver_live(uuid,uuid,timestamptz)', 'news_public_hits(uuid)',
                           'player_team_membership_log()', 'player_move_voids_seats()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'scouting_candidates()', 'passport_consent_in_force(uuid)',
                               'scouting_consent_in_force(uuid)', 'role_requester(uuid)', 'pending_claims()',
                               'account_sign_ins(uuid)', 'scouting_consent_set(uuid,boolean)', 'passport_consent_writer_ok(uuid)',
                               'pending_claim_confirm(uuid)', 'pending_claim_decline(uuid)',
                               'consent_giver_live(uuid,uuid,timestamptz)', 'news_public_hits(uuid)',
                               'player_team_membership_log()', 'player_move_voids_seats()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE f text; r text; v_src text;
BEGIN
  -- Every function here pins its search path; the definers stay definers,
  -- the internal two do not become ones.
  FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'scouting_candidates()', 'passport_consent_in_force(uuid)',
                           'scouting_consent_in_force(uuid)', 'role_requester(uuid)', 'pending_claims()',
                           'account_sign_ins(uuid)', 'scouting_consent_set(uuid,boolean)', 'passport_consent_writer_ok(uuid)',
                           'pending_claim_confirm(uuid)', 'pending_claim_decline(uuid)',
                           'player_team_membership_log()', 'player_move_voids_seats()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/122: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['consent_giver_live(uuid,uuid,timestamptz)', 'news_public_hits(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure AND NOT p.prosecdef AND p.provolatile = 's'
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/122: % is a definer, not stable, or does not pin its search_path', f;
    END IF;
  END LOOP;
  -- Who may call what.
  FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'scouting_candidates()', 'passport_consent_in_force(uuid)',
                           'scouting_consent_in_force(uuid)', 'role_requester(uuid)', 'pending_claims()',
                           'account_sign_ins(uuid)', 'scouting_consent_set(uuid,boolean)', 'passport_consent_writer_ok(uuid)',
                           'pending_claim_confirm(uuid)', 'pending_claim_decline(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/122: % is executable by PUBLIC, or not by scrbrd_app', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['consent_giver_live(uuid,uuid,timestamptz)', 'news_public_hits(uuid)',
                           'player_team_membership_log()', 'player_move_voids_seats()'] LOOP
    IF has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE')
       OR has_function_privilege('public', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/122: % is callable by the application or PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- Every function the revoke above names (F9), not a sample of them.
      FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'scouting_candidates()', 'passport_consent_in_force(uuid)',
                               'scouting_consent_in_force(uuid)', 'role_requester(uuid)', 'pending_claims()',
                               'account_sign_ins(uuid)', 'scouting_consent_set(uuid,boolean)', 'passport_consent_writer_ok(uuid)',
                               'pending_claim_confirm(uuid)', 'pending_claim_decline(uuid)',
                               'consent_giver_live(uuid,uuid,timestamptz)', 'news_public_hits(uuid)',
                               'player_team_membership_log()', 'player_move_voids_seats()'] LOOP
        IF has_function_privilege(r, f::regprocedure, 'EXECUTE') THEN
          RAISE EXCEPTION 'db/122: % can execute %', r, f;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- §1: both consumers ask the giver's link, as of the consent's own time;
  -- the giver test is is_family_of()'s words (the pad test aside) and then
  -- exactly the two clauses §1d adds (Q1, Q4), nothing else.
  IF position('consent_giver_live(c.granted_by, c.player_id, c.granted_at)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'passport_open(uuid)'::regprocedure)) = 0
     OR position('consent_giver_live(c.decided_by, c.player_id, c.decided_at)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'scouting_candidates()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/122: passport_open() or scouting_candidates() does not ask whether the consent''s giver is live';
  END IF;
  -- Compared with every run of whitespace folded to one space.
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src
    FROM pg_proc WHERE oid = 'consent_giver_live(uuid,uuid,timestamptz)'::regprocedure;
  IF v_src IS DISTINCT FROM
     regexp_replace(
       replace(regexp_replace(btrim(regexp_replace((SELECT prosrc FROM pg_proc WHERE oid = 'is_family_of(uuid)'::regprocedure),
                                                   '\s+', ' ', 'g')),
                              '^SELECT NOT app_pad_scoped\(\) AND EXISTS', 'SELECT p_giver IS NOT NULL AND EXISTS'),
               'a.person_id = app_user_id()', 'a.person_id = p_giver'),
       '\)$',
       ' AND (a.role = ''guardian'' OR EXISTS (SELECT 1 FROM player p WHERE p.id = s.player_id'
       || ' AND p.born IS NOT NULL AND majority_on(p.born) <= sa_today()))'
       || ' AND a.created_at <= p_given_at AND s.created_at <= p_given_at)') THEN
    RAISE EXCEPTION 'db/122: consent_giver_live() is not is_family_of()''s question asked of the giver, aged and dated';
  END IF;
  IF consent_giver_live(NULL, gen_random_uuid(), now()) OR consent_giver_live(gen_random_uuid(), gen_random_uuid(), now()) THEN
    RAISE EXCEPTION 'db/122: consent_giver_live() said yes about nobody';
  END IF;
  -- §1b: the boy of eighteen beside his guardian, both on a live link with
  -- processing consent, never on a pad, recording the caller as the giver.
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src
    FROM pg_proc WHERE oid = 'scouting_consent_set(uuid,boolean)'::regprocedure;
  IF position('a.role = ''selfaccess'' AND g.relationship = ''self'' AND p.born IS NOT NULL AND majority_on(p.born) <= sa_today()' IN v_src) = 0
     OR position('app_pad_scoped()' IN v_src) = 0 OR position('g.consent_state = ''granted''' IN v_src) = 0
     OR position('a.person_id = v_me AND a.active' IN v_src) = 0 OR position('''not_yet_eighteen''' IN v_src) = 0
     OR position('decided_by = excluded.decided_by' IN v_src) = 0 OR position('guardian.link.manage' IN v_src) > 0 THEN
    RAISE EXCEPTION 'db/122: scouting_consent_set() is not the guardian-or-the-boy-of-eighteen door this file writes';
  END IF;

  -- §1c, §1d: naming asks the writer test, withdrawing the family test.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'passport_consent'::regclass AND NOT p.polpermissive
         AND ((p.polname = 'passport_consent_writer_of_age_insert' AND p.polcmd = 'a'
               AND pg_get_expr(p.polwithcheck, p.polrelid) = 'passport_consent_writer_ok(player_id)')
           OR (p.polname = 'passport_consent_withdraw_by_family' AND p.polcmd = 'w'
               AND pg_get_expr(p.polqual, p.polrelid) = 'is_family_of(player_id)'
               AND pg_get_expr(p.polwithcheck, p.polrelid) = 'is_family_of(player_id)'))) <> 2 THEN
    RAISE EXCEPTION 'db/122: passport_consent''s two RESTRICTIVE write policies are not this file''s';
  END IF;
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src
    FROM pg_proc WHERE oid = 'passport_consent_writer_ok(uuid)'::regprocedure;
  IF position('a.role = ''selfaccess'' AND s.relationship = ''self'' AND p.born IS NOT NULL AND majority_on(p.born) <= sa_today()' IN v_src) = 0
     OR position('NOT app_pad_scoped()' IN v_src) = 0 OR position('s.valid_until IS NULL OR s.valid_until > current_date' IN v_src) = 0
     OR position('AND s.consent_state = ''granted''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/122: passport_consent_writer_ok() is not the consented-guardian-or-the-boy-of-eighteen test';
  END IF;
  IF passport_consent_writer_ok(gen_random_uuid()) THEN
    RAISE EXCEPTION 'db/122: passport_consent_writer_ok() said yes about nobody';
  END IF;

  -- db/116's check still holds: the passport opens to no player.profile.read.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'passport_open(uuid)'::regprocedure) LIKE '%player.profile.read%' THEN
    RAISE EXCEPTION 'db/122: passport_open() opens to player.profile.read';
  END IF;

  -- §2: every address through app_user_email_seen().
  IF position('app_user_email_seen(u.id, u.school_id, u.email)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'role_requester(uuid)'::regprocedure)) = 0
     OR position('app_user_email_seen(u.id, u.school_id, u.email)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'pending_claims()'::regprocedure)) = 0
     OR position('app_user_email_seen(u.id, u.school_id, c.email)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'pending_claims()'::regprocedure)) = 0
     OR position('x.email_at_link)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'account_sign_ins(uuid)'::regprocedure)) = 0
     OR position('app_user_email_seen(p_user,' IN (SELECT prosrc FROM pg_proc WHERE oid = 'account_sign_ins(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/122: a door still returns a login email past app_user_email_seen()';
  END IF;
  -- db/81's own check: nothing the browser reaches returns a provider uid.
  FOREACH f IN ARRAY ARRAY['pending_claims()', 'account_sign_ins(uuid)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proargnames, '{}')) a WHERE p.oid = f::regprocedure AND a ~ 'uid') THEN
      RAISE EXCEPTION 'db/122: % returns a provider uid', f;
    END IF;
  END LOOP;

  -- §2b (§1d, Q3): a pupil's claim and code are the office's alone.
  FOREACH f IN ARRAY ARRAY['pending_claim_confirm(uuid)', 'pending_claim_decline(uuid)'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF position('IF app_user_email_seen(c.user_id, (SELECT u.school_id FROM app_user u WHERE u.id = c.user_id), ''@'') IS NULL THEN' IN v_src) = 0
       OR position('''office_only''' IN v_src) = 0
       OR position('auth_office_refusal(c.user_id)' IN v_src) = 0 THEN
      RAISE EXCEPTION 'db/122: % answers a pupil''s claim for someone not shown his addresses', f;
    END IF;
  END LOOP;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'login_code_issue(text,text,integer)'::regprocedure;
  IF position('IF app_user_email_seen(v_user, v_school, ''@'') IS NULL THEN' IN v_src) = 0
     OR position('auth_office_refusal(v_user)' IN v_src) = 0
     OR position('IF app_user_email_seen(v_user, v_school, ''@'') IS NULL THEN' IN v_src)
        > position('  UPDATE login_code SET used_at = now()' IN v_src) THEN
    RAISE EXCEPTION 'db/122: login_code_issue() issues a pupil''s code to someone not shown his address';
  END IF;

  -- §3: the six two-letter particles are out, the three-letter ones still.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'news_public_hits(uuid)'::regprocedure;
  IF position('''van'', ''von'', ''der'', ''den'', ''des'', ''del'', ''dos'', ''das'', ''ten'', ''ter''' IN v_src) = 0
     OR position('''de'', ''du'', ''le'', ''la'', ''da'', ''di''' IN v_src) = 0
     OR position('WHERE length(t) >= 2' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/122: news_public_hits() does not skip the particles, or no longer reads two-letter words';
  END IF;

  -- §4: no move in either trigger dated by the session's day.
  FOREACH f IN ARRAY ARRAY['player_team_membership_log()', 'player_move_voids_seats()'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF v_src ~ 'current_date' OR position('''app.effective_on'', true), '''')::date, sa_today())' IN v_src) = 0 THEN
      RAISE EXCEPTION 'db/122: % still dates a move by current_date', f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'player'::regclass AND tgname = 'player_moves_are_recorded'
                    AND tgfoid = 'player_team_membership_log()'::regprocedure AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'player'::regclass AND tgname = 'player_move_voids_seats'
                       AND tgfoid = 'player_move_voids_seats()'::regprocedure AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/122: a move trigger on player is gone or disabled';
  END IF;
END $check$;
