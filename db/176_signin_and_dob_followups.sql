-- ══════════════════════════════════════════════════════════════════
--  176 · A pupil's sign-in and his date of birth: the gate reads his
--        claim, the grant door names the boy, the record names who
--        asked, a correction lists the links it dated, and the log's
--        dates stay at his school
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Each change rests on a rule Kameel has already decided,
-- named where it is made:
--   * Kameel, 18 Nov 2026 (the honesty model, Q5): an under-18 pupil signs
--     in only on a guardian's yes or the office's signed form; and 20 Nov
--     (A): an account holding a pupil's role that names no boy is closed.
--   * db/168's rule, on Kameel's answers of 18 Nov: what a person says about
--     himself can only narrow what he sees.
--   * The map of who sees a child's data (READERS_child_data.md, Kameel,
--     21 Oct 2026): §0 rule 7, the record answers for each act; class A2,
--     a boy's date of birth is read at his school (player.age.read, the
--     roster tier) and never by another school.
--   * The family list's condition 4 (SCRBRD-140, Kameel, 18 Nov 2026): a
--     grant made on an office person's earlier act is made only while that
--     person still holds the right to make it (db/174, family_may_link_for()).
--   * The re-dating design (Kameel, 25 Nov 2026, as recommended): §3.2, a
--     link the rule dated from the old date is listed for the office, which
--     reopens or ends it by its own act (Q4: "the office reopens each ended
--     link by a tap, from a list"); §3.5, the log shows a change's dates only
--     while he is still at the school of the change.
-- Safe to run twice.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   ~ pupil_signin_open() (db/169, as db/173 left it), replaced whole,
--       guarded: an account with no roster boy of its own that has said it is
--       a pupil here (a pupil_claim, in any state but 'open') is closed,
--       whatever else it holds. A yes opens it through the claim, as before
--       (the account is then his roster row's, and his yes decides).
--   ~ role_request_grant_as() (db/92, as db/169 left it), patched by one
--       needle, guarded: a scorer's role, a side's role (coach, assistant
--       coach, team manager) or any role named for a side, for an account
--       that is a pupil's (person_is_pupil()), is granted only once the
--       account is a roster boy's own (his roster link or a self link), so the
--       gate reads that boy's yes. Refused otherwise, before anything is
--       written: pupil_needs_his_roster_row. `player` names its boy already.
--   + role_request.asked_by  who asked for a request on another's behalf:
--       the guardian whose yes opened his own sign-in, or the office person
--       whose tick or retry did. NULL where the person asked himself.
--   ~ pupil_signin_after_yes() (db/169, as db/173 left it), replaced whole,
--       guarded: the request it files names the caller as asked_by; the
--       decider is the office person acting now, or else the office person
--       who recognised the account, only while he still holds that right
--       (family_may_link_for(), as the family list asks of its uploader).
--       Otherwise nothing is granted and the door answers recogniser_lapsed:
--       the yes stands, and the office's retry opens him as its own act.
--   + born_links_to_review(school, player)  the office's list after a
--       correction: each guardian link of a boy at the school whose end date
--       the rule worked out from a date of birth since corrected (his 18th
--       birthday by the old date, or the day he left school, when the old date
--       made him an adult by then and the corrected one does not), with the
--       old and the corrected 18th birthdays. Listed, never changed.
--   ~ audit_log() (as db/173 left it), patched by needle, guarded: a
--       date-of-birth change's `was` and `became` go to a reader of his age
--       only while he is still at the school of the change.
--
-- ── WHAT IS NOT HERE ───────────────────────────────────────────────
--   * Re-dating a link, and the office's tap that reopens one (the re-dating
--     design's slice 2): the list is for the office to act on by hand.
--   * duty_link() (db/166): a fixture duty for a pupil's account with no
--     roster boy is closed by the gate above, as every other role is.
--   * The roster import's answers (services/api/io/import-api.mjs) and the
--     correction route's list (services/api/write/dob-capture-api.mjs).
--
-- WHO THE PASTE CLOSES. Every account with a pupil_claim not 'open' and no
-- roster boy of its own: what it holds stops counting from the statement after
-- the paste. Such an account asks for nothing while its claim waits (db/168),
-- so it holds no role unless the office gave one; count them first (DEPLOYING).
-- No row of any table is changed; role_request gains one empty column.
--
-- Every function: SECURITY DEFINER, search_path pinned, REVOKE ALL FROM
-- PUBLIC; the one door GRANTs EXECUTE to scrbrd_app by name; nothing to anon,
-- authenticated or service_role (db/157). No BEGIN or COMMIT: paste as one
-- transaction. Its proof is db/99 §151.


-- ── 0a · Ten seconds for a lock, or nothing (db/168's pattern) ──────
-- The column takes a short lock on role_request; re-emitting the gate waits
-- on every statement reading through it. Reset by the file's last statement.
SET lock_timeout = '10s';


-- ── 0 · What this file stands on ───────────────────────────────────
DO $guard$
BEGIN
  IF to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR NOT pg_has_role(current_user, (SELECT p.proowner FROM pg_proc p
                                        WHERE p.oid = 'app_can(text,uuid,text,uuid,uuid)'::regprocedure), 'MEMBER') THEN
    RAISE EXCEPTION 'db/176: run this as the schema owner (current_user is %), not as the application', current_user;
  END IF;
  IF to_regprocedure('pupil_signin_open(uuid)') IS NULL OR to_regprocedure('pupil_signin_after_yes(uuid,text)') IS NULL
     OR to_regprocedure('pupil_signin_in_force(uuid)') IS NULL OR to_regprocedure('pupil_signin_is_pupils(uuid)') IS NULL
     OR to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)') IS NULL
     OR to_regprocedure('person_is_pupil(uuid)') IS NULL OR to_regclass('pupil_claim') IS NULL
     OR to_regprocedure('pupil_claim_held(uuid)') IS NULL OR to_regprocedure('pupil_claim_office(uuid)') IS NULL
     OR to_regprocedure('family_may_link_for(uuid,uuid,text)') IS NULL
     OR to_regprocedure('player_born_office(uuid)') IS NULL OR to_regclass('player_born_change') IS NULL
     OR to_regprocedure('player_born_confirm(uuid)') IS NULL OR to_regclass('guardian_link_ending') IS NULL
     OR to_regprocedure('my_terms_due()') IS NULL OR to_regprocedure('majority_on(date)') IS NULL
     OR to_regprocedure('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'db/176: db/168 (the claim), db/169 (the gate), db/172 and db/173 (the date''s record), db/174 (family_may_link_for()) or db/175 (my_terms_due()) is missing; apply them first';
  END IF;
END $guard$;

-- Each body this file moves is the one the file before it left, or this
-- file's own (a second paste). The folded md5, as db/172 and db/173 fold.
CREATE OR REPLACE FUNCTION pg_temp._v176_fold(p_fn text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g')) FROM pg_proc p WHERE p.oid = to_regprocedure(p_fn)
$$ LANGUAGE sql STABLE;
DROP TABLE IF EXISTS pg_temp._v176_bodies;
CREATE TEMP TABLE _v176_bodies (fn text PRIMARY KEY, was text, mine text, file text);
INSERT INTO _v176_bodies VALUES
  ('pupil_signin_open(uuid)',                          '9f48a4d15b197910c45640601d96c889', '87674727a364b0e1c2e8cdb2c224c590', 'db/173'),
  ('pupil_signin_after_yes(uuid,text)',                '9af7035afb366ee70ff3c122e8b0789f', '043e96aaa8b1170ac7ca5783f82a5550', 'db/173'),
  ('role_request_grant_as(uuid,uuid,text,uuid,text)',  'dbccd62440044dab42cdb41f2cde8af2', '4f4fae5b2f5a6e1e742aa9704da8cfd5', 'db/169'),
  ('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
                                                       '5323dd10910de37e623e80302ea9cf93', 'cd92b24ec5dd39941071f02e83c33f1f', 'db/173');
DO $bodies$
DECLARE r record; v text; n_mine int := 0; n_was int := 0;
BEGIN
  FOR r IN SELECT * FROM _v176_bodies LOOP
    v := pg_temp._v176_fold(r.fn);
    IF v IS NULL OR v NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/176: % is neither %''s nor this file''s (md5 % of its folded body); look before replacing it',
        r.fn, r.file, v;
    END IF;
    IF v = r.mine THEN n_mine := n_mine + 1; ELSE n_was := n_was + 1; END IF;
  END LOOP;
  -- The gate and the grant door move together, or not at all.
  IF n_mine > 0 AND n_was > 0 THEN
    RAISE EXCEPTION 'db/176: a partial paste is in place (% of its % bodies are this file''s); restore them, or see the paste card',
      n_mine, n_mine + n_was;
  END IF;
END $bodies$;


-- ── 1 · The gate: an account that said it is a pupil waits for a yes ──
-- db/169's, as db/173 left it, with one test more (Kameel, 18 Nov 2026, Q5:
-- an under-18 pupil signs in only on a guardian's yes or the office's form;
-- db/168: what he says of himself only narrows). An account with no roster
-- boy of its own that has a pupil_claim not yet opened by a yes ('open') is
-- closed, whatever role it holds; once a yes opens his account through the
-- claim, the account is his roster row's and his own yes decides, above.
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
  -- db/176: he said he is a pupil here, under 18, and no yes has opened him.
  IF EXISTS (SELECT 1 FROM pupil_claim c WHERE c.user_id = p_account AND c.state <> 'open') THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM role_assignment a
                      WHERE a.person_id = p_account AND a.active AND a.role IN ('player', 'selfaccess')
                        AND (a.valid_until IS NULL OR a.valid_until > sa_today()));
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
   COST 500;
REVOKE ALL ON FUNCTION pupil_signin_open(uuid) FROM PUBLIC;


-- ── 2 · The grant door: a pupil's account takes a side's role as his own ──
-- Patched by needle, from the catalog (pg_get_functiondef, as db/169 re-emits
-- it), after the refusal for a role that needs a boy and before anything is
-- written; rights, settings, volatility and owner checked unchanged. Kameel,
-- 18 Nov 2026 (Q5) and 20 Nov (A): a pupil's account opens on his own yes,
-- so a role that would let it act for a side is given only to an account the
-- gate can read a boy's yes for. A second paste finds it in place.
DO $door$
DECLARE
  v_needle constant text := '  IF r.role IN (''guardian'', ''selfaccess'', ''enquiry'', ''player'') AND v_player IS NULL THEN' || chr(10)
                  || '    RETURN QUERY SELECT false, ''player_required'', NULL::uuid; RETURN;' || chr(10)
                  || '  END IF;' || chr(10);
  v_patch constant text := '  -- db/176 (Kameel, 18 Nov 2026, Q5: an under-18 pupil signs in only on a' || chr(10)
                  || '  -- guardian''s yes or the office''s form; 20 Nov, A): a scorer''s or a side''s' || chr(10)
                  || '  -- role, for an account that is a pupil''s, only once the account is a roster' || chr(10)
                  || '  -- boy''s own, so the sign-in gate reads that boy''s yes.' || chr(10)
                  || '  IF (r.role IN (''scorer'', ''coach'', ''assistantcoach'', ''teammanager'')' || chr(10)
                  || '      OR (v_team IS NOT NULL AND r.role NOT IN (''player'', ''selfaccess'', ''guardian'', ''enquiry'')))' || chr(10)
                  || '     AND person_is_pupil(r.person_id)' || chr(10)
                  || '     AND NOT EXISTS (SELECT 1 FROM app_user pu WHERE pu.id = r.person_id AND pu.player_id IS NOT NULL)' || chr(10)
                  || '     AND NOT EXISTS (SELECT 1 FROM role_assignment pa JOIN assignment_subject ps ON ps.assignment_id = pa.id' || chr(10)
                  || '                      WHERE pa.person_id = r.person_id AND pa.active AND ps.relationship = ''self'') THEN' || chr(10)
                  || '    RETURN QUERY SELECT false, ''pupil_needs_his_roster_row'', NULL::uuid; RETURN;' || chr(10)
                  || '  END IF;' || chr(10);
  v_fn constant text := 'role_request_grant_as(uuid,uuid,text,uuid,text)';
  v_src text; v_cfg text; v_acl text; v_sec boolean; v_vol "char"; v_own oid; n int;
BEGIN
  SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef, p.provolatile, p.proowner
    INTO v_src, v_cfg, v_acl, v_sec, v_vol, v_own FROM pg_proc p WHERE p.oid = v_fn::regprocedure;
  IF position('pupil_needs_his_roster_row' IN v_src) > 0 THEN RETURN; END IF;   -- a second paste (§0 checked it is this file's)
  n := (length(v_src) - length(replace(v_src, v_needle, ''))) / length(v_needle);
  IF n <> 1 THEN
    RAISE EXCEPTION 'db/176: % holds its needle % times, not once: look before replacing it', v_fn, n;
  END IF;
  EXECUTE replace(pg_get_functiondef(v_fn::regprocedure), v_needle, v_needle || v_patch);
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM replace(v_src, v_needle, v_needle || v_patch)
     OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM v_cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM v_acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM v_sec
     OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM v_vol
     OR (SELECT p.proowner FROM pg_proc p WHERE p.oid = v_fn::regprocedure) IS DISTINCT FROM v_own THEN
    RAISE EXCEPTION 'db/176: re-emitting % changed more than its one refusal', v_fn;
  END IF;
END $door$;


-- ── 3 · Who asked, and on whose recognition (the map's rule 7) ───────
ALTER TABLE role_request ADD COLUMN IF NOT EXISTS asked_by uuid REFERENCES app_user(id) ON DELETE SET NULL;
COMMENT ON COLUMN role_request.asked_by IS
  'db/176: who asked for this request on another''s behalf: the guardian whose yes opened his own sign-in, or the office person whose tick or retry did. NULL when the person asked himself. For such a request decided_by is the office person on whose authority it was granted: the one acting then, or the one who recognised his account (his claim''s known_by), still holding that right.';

-- db/169's, as db/173 left it, with the grant's record made whole (the map,
-- §0 rule 7: the record answers for each act). The caller is the one who
-- asked. The decider is the office person acting now, or else the office
-- person who recognised the account, and only while he still holds the right
-- to (the family list's condition 4, Kameel, 18 Nov 2026: the question db/174
-- asks of its uploader, family_may_link_for()). If he does not, nothing is
-- granted: the yes stands, and the office's retry opens him as its own act.
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
  -- db/176: the office acting now, or the recogniser while his right holds.
  IF pupil_claim_office(c.school_id) THEN
    v_decider := app_user_id();
  ELSIF c.known_by IS NOT NULL AND family_may_link_for(c.known_by, c.school_id, 'pupil') THEN
    v_decider := c.known_by;
  ELSE
    RETURN 'recogniser_lapsed';
  END IF;
  BEGIN
    INSERT INTO role_request (person_id, role, school_id, player_id, note, asked_by)
    VALUES (c.user_id, 'player', c.school_id, p_player, 'His own sign-in: a yes on record', app_user_id())
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


-- ── 4 · After a correction: the links the old date dated ───────────
-- The re-dating design §3.2 and Q4 (Kameel, 25 Nov 2026): a guardian link the
-- rule dated from his date of birth does not follow a correction by itself;
-- the office is shown it and acts. Each live link (pending or verified, on an
-- active guardian assignment, not his own) of a boy at the school, whose end
-- date the rule worked out from a date this school's office has since
-- corrected:
--   eighteenth_birthday  it ends on his 18th birthday by the old date, and
--                        the corrected date gives another;
--   left_school          it ended the day he left school (db/62: an adult who
--                        leaves takes the link with him), the old date made him
--                        18 by then, and the corrected one does not.
-- With the old and the corrected 18th birthdays. The office's of his school
-- alone (player_born_office()); nothing for anyone else. Nothing is changed.
CREATE OR REPLACE FUNCTION born_links_to_review(p_school uuid, p_player uuid DEFAULT NULL)
RETURNS TABLE (player_id uuid, full_name text, team_code text, link_id uuid, guardian_name text,
               ends_on date, why text, old_of_age_on date, of_age_on date, corrected_at timestamptz) AS $$
  SELECT x.player_id, x.full_name, x.team_code, x.link_id, x.guardian_name, x.ends_on, x.why,
         x.old_of_age_on, x.of_age_on, x.corrected_at
    FROM (
      SELECT DISTINCT ON (g.id)
             p.id AS player_id, p.full_name, p.team_code, g.id AS link_id, u.name AS guardian_name,
             g.valid_until AS ends_on,
             CASE WHEN g.valid_until = majority_on(c.was) THEN 'eighteenth_birthday' ELSE 'left_school' END AS why,
             majority_on(c.was) AS old_of_age_on, majority_on(p.born) AS of_age_on, c.at AS corrected_at
        FROM player p
        JOIN player_born_change c ON c.player_id = p.id AND c.school_id = p.school_id
                                 AND c.was IS NOT NULL AND c.how <> 'confirmed'
        JOIN assignment_subject g ON g.player_id = p.id
        JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian' AND a.active
        LEFT JOIN app_user u ON u.id = a.person_id
        LEFT JOIN guardian_link_ending e ON e.link_id = g.id
       WHERE coalesce(player_born_office(p_school), false)
         AND p.school_id = p_school AND (p_player IS NULL OR p.id = p_player)
         AND p.born IS NOT NULL AND majority_on(c.was) <> majority_on(p.born)
         AND g.relationship IS DISTINCT FROM 'self' AND g.relationship IS DISTINCT FROM 'enquiry'
         AND g.verification_state IN ('pending', 'verified')
         AND g.valid_until IS NOT NULL
         AND (g.valid_until = majority_on(c.was)
              OR (e.kind = 'left_school' AND e.ends_on = g.valid_until
                  AND majority_on(c.was) <= g.valid_until AND majority_on(p.born) > g.valid_until))
       ORDER BY g.id, c.at DESC) x
   ORDER BY x.full_name, x.player_id, x.guardian_name, x.link_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION born_links_to_review(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION born_links_to_review(uuid, uuid) TO scrbrd_app;


-- ── 5 · The log's dates stay at his school ─────────────────────────
-- By exact needle, as db/172 and db/173 patched it, and only over db/173's
-- body or this file's (§0). The re-dating design §3.5 and the map's class A2:
-- the dates of a change go to a reader of his age while he is still at the
-- school of the change; after he leaves, that school's log keeps the event and
-- who made it, without the dates, and the other school reads his date never.
CREATE OR REPLACE FUNCTION pg_temp._v176_patch(p_fn text, p_needle text, p_repl text) RETURNS void AS $$
DECLARE v_src text; v_n integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = p_fn::regprocedure;
  IF position(p_repl IN v_src) > 0 THEN RETURN; END IF;
  v_n := (length(v_src) - length(replace(v_src, p_needle, ''))) / length(p_needle);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'db/176: % holds its needle % times, not once: look before replacing it', p_fn, v_n;
  END IF;
  EXECUTE replace(pg_get_functiondef(p_fn::regprocedure), p_needle, p_repl);
END $$ LANGUAGE plpgsql;
SELECT pg_temp._v176_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
  E'''was'', CASE WHEN app_can(''player.age.read'', bc.school_id, bp.team_code, bc.player_id, NULL) THEN bc.was END,',
  E'-- db/176: the dates while he is still at the school of the change.\n'
  || E'                 ''was'', CASE WHEN bp.school_id = bc.school_id\n'
  || E'                                AND app_can(''player.age.read'', bc.school_id, bp.team_code, bc.player_id, NULL) THEN bc.was END,');
SELECT pg_temp._v176_patch('audit_log(uuid,text[],timestamptz,timestamptz,text,integer)',
  E'''became'', CASE WHEN app_can(''player.age.read'', bc.school_id, bp.team_code, bc.player_id, NULL) THEN bc.became END)),',
  E'''became'', CASE WHEN bp.school_id = bc.school_id\n'
  || E'                                   AND app_can(''player.age.read'', bc.school_id, bp.team_code, bc.player_id, NULL) THEN bc.became END)),');
DROP FUNCTION pg_temp._v176_patch(text, text, text);


-- ── 6 · Each body is this file's now ───────────────────────────────
DO $after$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM _v176_bodies LOOP
    v := pg_temp._v176_fold(r.fn);
    IF v IS DISTINCT FROM r.mine THEN
      RAISE EXCEPTION 'db/176: % is not this file''s after the paste (md5 %)', r.fn, v;
    END IF;
  END LOOP;
  -- The doors as they stood: the gate and the grant door are the owner's,
  -- the log and the new list the application's to call.
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'born_links_to_review(uuid,uuid)'::regprocedure)
       IS DISTINCT FROM (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'born_unconfirmed(uuid)'::regprocedure)
     OR has_function_privilege('scrbrd_app', 'pupil_signin_open(uuid)', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'pupil_signin_after_yes(uuid,text)', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'role_request_grant_as(uuid,uuid,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/176: a door''s rights are not as this file leaves them';
  END IF;
END $after$;
DROP TABLE _v176_bodies;
DROP FUNCTION pg_temp._v176_fold(text);


-- ── 7 · The lock limit back as it was ──────────────────────────────
RESET lock_timeout;
