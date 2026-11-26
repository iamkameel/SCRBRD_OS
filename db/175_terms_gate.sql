-- ══════════════════════════════════════════════════════════════════
--  175 · The parent's terms gate: her link reaches her child once she
--        has agreed the school's terms (redesign slice 5b)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The server half of the parent's terms gate, on Kameel's
-- decisions: the board of 18 Nov 2026 ("Server withholds his data until
-- she agrees"), and his answers of 20 Nov 2026 ("All six as recommended"):
--   Q1 (a) a parent who agreed and later WITHDREW still reads him, as the
--          approved terms promise ("you keep sight of his record").
--   Q2 (a) on a new terms version she keeps reading; a row asks her to
--          agree again. The gate reads consent_state, never consent_version.
--   Q3 (a) a link the office stamped agreed from a signed form counts.
--   Q4 (a) notices about him, sent while she has not agreed, are held
--          unseen and unpushed, there when she agrees; no count shown. The
--          breach email and a DSO's share are never held.
--   Q5 (a) slice 5 (the screen) first; the count read; then Kameel's word.
-- And Kameel, 25 Nov 2026: it goes live before Westville's families load.
--
-- THE RULE. For an assignment of role `guardian` and a link
-- (assignment_subject) that is not `self` and not `enquiry`: the link counts
-- for that child only while it is verified, its dates are live (as before)
-- AND consent_state <> 'pending'. One child's link never speaks for another:
-- the test is on the row for that player_id. `granted` and `withdrawn` both
-- count (Q1); the version is never read (Q2).
--
-- WHERE IT SITS. In the link test itself: the guardian arm of app_can() and
-- its two copies (app_can_but_player(), app_can_but_scorer()), and
-- is_family_of(). Every read, write and policy that asks those for a child
-- through her link closes with it: his record, his side's fixtures through
-- him, his notices, his consents, his lifts, his availability. The condition
-- is a predicate on the assignment_subject row those bodies already fetch: no
-- new call, join or index on a hot read.
--
-- THE OTHER READERS OF HER LINK, EACH MARKED (gate it · leave it · must
-- stay open):
--   gate it   my_alert_choices()      names each child of hers for the alert
--                                     choices; a gated child is not listed.
--   gate it   my_health_consents()    names him and his health-monitoring
--                                     state on her guardian row.
--   gate it   pupil_signin_my_link()  her link for "Allow his own sign-in":
--                                     a gated link is not hers to use, so
--                                     pupil_signin_state() answers her
--                                     nothing (it would otherwise say he has
--                                     an account), pupil_signin_account()
--                                     nothing, and pupil_signin_consent_set()
--                                     and pupil_signin_retry() refuse
--                                     not_permitted.
--   gate it   public_name_consent_set(), health_monitoring_consent_set():
--                                     her own act for him (the guardian arm,
--                                     p_guardian NULL) rides a link she has
--                                     agreed on. The office's arm, from a
--                                     form, is the office's act: unchanged.
--   gate it   my_children (read-api.mjs): her agreed children as before; a
--                                     gated child's row comes from
--                                     my_terms_due() below, with his name and
--                                     school and nothing else.
--   leave it  app_holds(), app_enrolled(), app_enrolled_at(),
--             lift_at_school(), scorebook_school_grant(): they read no child
--             (reference data, the menu, a staff grant); nothing of his.
--   leave it  lift_family_at(), lift_acting_for(), lift_guardians_of(),
--             lift_live_link(), lift_link_is_live(), health_giver_link_live(),
--             consent_giver_live(), passport_consent_writer_ok(),
--             scouting_consent_set(), pupil_signin_yes_stands(): already
--             need `granted`, or answer only a refusal ('consent_pending').
--   leave it  public_name_facts(), public_name_live_link(),
--             reader_linked_to(): the system's derivation of what may be
--             public, and a restrictive cut whose permissive read asks
--             app_can(); the writers above carry the gate for her own acts.
--   leave it  availability_ask_again(): the system writes the notice to every
--             verified guardian; the notice policy (§4) holds it from her
--             until she agrees (Q4).
--   leave it  match_award(), match_award_guardian_of(), injury_writer_is_family(),
--             potm_is_the_boy(): refusals; gating them would widen.
--   leave it  safeguarding_family(), safeguarding_share() and the share
--             readers, child_links, dob_gaps(), guardian_link_verify(),
--             role_request_grant_as(), account_offboard_preview(),
--             player_guardian_link_counts(), the family list's (db/174),
--             the lifecycle triggers: the office's, the DSO's or the system's.
--   leave it  my_links (read-api.mjs), school_answer_subject_is_mine(): her
--             own link's state and dates; his name rides only where his row
--             is readable, so a gated link names nobody there (my_terms_due()
--             names him for the card).
--   leave it  pupil_signin_account() (db/173): reads her link through
--             pupil_signin_my_link() and asks "agreed", so it answers a
--             waiting link nothing.
--   leave it  family_link_live(), family_link_ended_on() (db/174): the
--             office's and the claim's "is she linked already", a waiting
--             link included, so the family list never links her twice.
--             role_assignment_end(), guardian_link_revoke(): the office's, and
--             her ending her own link; not re-emitted here.
--   note      family_register_claim() (db/174) makes a link verified with
--             consent pending: exactly the link this file gates. She agrees
--             through guardian_consent_record(), which stays open.
--   must stay open  guardian_consent_record() and its route: she agrees with
--             no capability (p_guardian = app_user_id()); player_school() is
--             a definer. Raising a concern and the DSO card (person_live_at()).
--             guardian_consent_withdraw(), and her ending her own link.
--             The DSO's share notice to her (§4's second policy).
--
-- WHAT MOVES
--   + guardian_terms_record  append-only: every agreement or withdrawal of a
--       guardian's terms, as it happened: the link, the child, the guardian,
--       the state, the version, the time, who recorded it and how (her own
--       tap, the office, the system, or as found at this file's paste). The
--       link row keeps only the latest; this keeps which text she had agreed
--       in March. RLS on, no policy, no privilege: the owner's (db/81's
--       shape). Written by a trigger on assignment_subject, so no door can
--       forget it.
--   + my_terms_due()  the caller's own live, verified guardian links still
--       waiting for her agreement: link, child, the child's name, his
--       school's id and name. Nothing else: no team, no date, no other
--       guardian. A pad credential, a pupil's closed account and anybody
--       with no such link get nothing.
--   + terms_gate_mine(), terms_gate_schools()  the same set as arrays, for
--       the notice policies, asked once per statement.
--   + notification_terms_gate (restrictive): a notice about a child whom the
--       caller reaches only through a link waiting for her agreement is not
--       read, so it is not pushed either: services/api/notify/push-api.mjs
--       asks `select 1 from notification` as the recipient before it sends.
--       Her other reach of him (a coach, the office) still reads it; the
--       system's own notices addressed to her still read.
--   + notification_terms_gate_dso (permissive): a DSO's safeguarding notice
--       addressed to her, at a school where her link waits, is read: the gate
--       must not stand between a DSO and a parent.
--   ~ app_can(), app_can_but_player(), app_can_but_scorer(), is_family_of(),
--     my_alert_choices(), my_health_consents(), pupil_signin_my_link(),
--     public_name_consent_set() (7 args), health_monitoring_consent_set():
--       re-emitted from the catalog with the change below and nothing else;
--       rights, settings, volatility and owner checked unchanged; each held
--       to an md5 before and after.
--
-- WHO THE PASTE CLOSES. Every parent with a live, verified guardian link at
-- consent_state 'pending', for that child, from the statement after the
-- paste: she sees the "Read the terms" card for him and nothing else of his
-- until she agrees. A link the office stamped 'granted' at verification (Q3),
-- and a withdrawn link (Q1), are not touched. No row of assignment_subject
-- is changed: the paste moves no link from one state to another. Count first
-- with tools/terms-gate-count.sql (counts only, no names) and read
-- would_close by school.
--
-- HOW TO PASTE. One transaction, stop on the first error (the SQL Editor's
-- implicit transaction, or psql -1 -v ON_ERROR_STOP=1). Every body moves in
-- one statement (§3), or none does; §0 refuses a database where some are
-- this file's and some are not; a second paste changes nothing. Outside a
-- match: re-emitting app_can() waits on every statement reading through it.
--
-- Every function: SECURITY DEFINER, search_path pinned, REVOKE ALL FROM
-- PUBLIC; the doors GRANT EXECUTE to scrbrd_app by name; nothing to anon,
-- authenticated or service_role (db/157). No BEGIN or COMMIT. Safe to run
-- twice. Its proof is db/99 §150.


-- ── 0a · Ten seconds for a lock, or nothing (db/168's pattern) ──────
-- The trigger in §1 locks assignment_subject; the policies in §4 lock
-- notification; re-emitting app_can() waits on every statement reading
-- through it. A plain SET, so it holds for every statement after it however
-- the file is run; the file's last statement RESETs it. A paste that cannot
-- get a lock in ten seconds stops: paste it again, outside a match.
SET lock_timeout = '10s';


-- ── 0 · What this file stands on ───────────────────────────────────
DO $guard$
BEGIN
  -- The role pasting must be the one that owns the core check (or a
  -- superuser): CREATE OR REPLACE of another role's function fails half way.
  IF to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR NOT pg_has_role(current_user, (SELECT p.proowner FROM pg_proc p
                                        WHERE p.oid = 'app_can(text,uuid,text,uuid,uuid)'::regprocedure), 'MEMBER') THEN
    RAISE EXCEPTION 'db/175: run this as the schema owner (current_user is %), not as the application', current_user;
  END IF;
  IF to_regprocedure('pupil_signin_open(uuid)') IS NULL OR to_regclass('pupil_signin_consent') IS NULL
     OR to_regprocedure('app_can_but_scorer(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('born_unconfirmed(uuid)') IS NULL OR to_regclass('family_register') IS NULL
     OR to_regprocedure('guardian_consent_record(uuid,uuid,text)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regclass('duty_suspension') IS NULL THEN
    RAISE EXCEPTION 'db/175: db/169 (the pupil sign-in gate), db/171 (app_can_but_scorer()), db/173 (born_unconfirmed()) or db/174 (family_register) is missing; apply them first';
  END IF;
END $guard$;

-- The bodies this file replaces, each as the files before it left it, or as
-- this file leaves it (a second paste). Anything else stops the paste.
DROP TABLE IF EXISTS _db175_bodies;
CREATE TEMP TABLE _db175_bodies (fn text PRIMARY KEY, was_md5 text, mine_md5 text);
INSERT INTO _db175_bodies VALUES
  ('app_can(text,uuid,text,uuid,uuid)',                                'e8e8848ae0d30642c702502d9a3ed628', 'ac524f57020140fe6b6bdb0455274d11'),
  ('app_can_but_player(text,uuid,text,uuid,uuid)',                     '228c672a6dd87642a95b535901186673', '1a3ce7649c2dfafb1dd8e75e430a434c'),
  ('app_can_but_scorer(text,uuid,text,uuid,uuid)',                     '9bc812346bbcf27eb1a0668925578362', 'a52734ba914cef6a87103ac6c6143818'),
  ('is_family_of(uuid)',                                               '04afe1ecb8a74b78ec6c8ff97f274dd3', 'c2377a5414b315241fa63c32ef089d78'),
  ('my_alert_choices()',                                               '3358cc160844ca97bfd5913b34ad1afe', 'd107d022abf8ea4bbb524965867e8737'),
  ('my_health_consents()',                                             'a8f1cdfca325430b57b66115b3dfba95', '5adccddcbb9f1686fc7d8f4d35b25b75'),
  ('pupil_signin_my_link(uuid)',                                       '52abc7b2450767ed5ba4b9dadc5ac2d0', 'ce64420509c38d04eac70d0456bb703d'),
  ('public_name_consent_set(uuid,boolean,text,uuid,text,date,text)',   '156083d5a79bed7e1a5b684dfb07c29b', '6f423bb0f5614429e7c49d40d2a01f45'),
  ('health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)',  'e3cdcaa6416c98fbcc3e8a75b0fd6e26', 'baae671939c1848fc0bdf51b625ee1cf');
DO $bodies$
DECLARE r record; v text; n_mine int := 0; n_was int := 0;
BEGIN
  FOR r IN SELECT * FROM _db175_bodies LOOP
    v := (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn));
    IF v IS NULL THEN
      RAISE EXCEPTION 'db/175: % is not there', r.fn;
    END IF;
    IF v NOT IN (r.was_md5, r.mine_md5) THEN
      RAISE EXCEPTION 'db/175: % is neither as the files before this one left it nor this file''s (md5 %); factor the version now in place and move its hash', r.fn, v;
    END IF;
    IF v = r.mine_md5 THEN n_mine := n_mine + 1; ELSE n_was := n_was + 1; END IF;
  END LOOP;
  -- The gate goes on in one statement (§3): all the files' before it, or all this file's.
  IF n_mine > 0 AND n_was > 0 THEN
    RAISE EXCEPTION 'db/175: a partial paste is in place (% of the gate''s % bodies are this file''s); restore them, or see the paste card', n_mine, n_mine + n_was;
  END IF;
  IF n_mine > 0 AND (to_regclass('guardian_terms_record') IS NULL OR to_regprocedure('my_terms_due()') IS NULL) THEN
    RAISE EXCEPTION 'db/175: the gate is in place without its record or my_terms_due(); restore the bodies, or see the paste card';
  END IF;
END $bodies$;


-- ── 1 · The record of every agreement ──────────────────────────────
-- TODO(counsel): how long a row is kept. Today, as long as his roster row
-- (ON DELETE CASCADE from player), with the guardian's name as it was after
-- her account is erased (guardian_id SET NULL). Nothing removes a row on a
-- clock until counsel sets the period. Do not invent one.
CREATE TABLE IF NOT EXISTS guardian_terms_record (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq           bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  -- Her link (assignment_subject.id) and the child it is to.
  link_id       uuid NOT NULL,
  player_id     uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  guardian_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  guardian_name text CHECK (guardian_name IS NULL OR char_length(guardian_name) <= 200),
  -- What the link now says, as it was written.
  state         text NOT NULL CHECK (state IN ('pending', 'granted', 'withdrawn')),
  version       text CHECK (version IS NULL OR char_length(version) <= 40),
  agreed_at     timestamptz,
  -- guardian  her own tap          office  somebody else signed in (the
  -- system    no account (a job)   as_found  the link as it stood at db/175's paste
  how           text NOT NULL CHECK (how IN ('guardian', 'office', 'system', 'as_found')),
  recorded_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guardian_terms_record_granted_names_a_version
    CHECK (state <> 'granted' OR (version IS NOT NULL AND agreed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS guardian_terms_record_link ON guardian_terms_record (link_id, seq);
CREATE INDEX IF NOT EXISTS guardian_terms_record_player ON guardian_terms_record (player_id);
ALTER TABLE guardian_terms_record ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guardian_terms_record FROM PUBLIC;
REVOKE ALL ON guardian_terms_record FROM scrbrd_app;
REVOKE ALL ON SEQUENCE guardian_terms_record_seq_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE guardian_terms_record_seq_seq FROM scrbrd_app;

-- Append-only, the owner included: a row once written is the record.
CREATE OR REPLACE FUNCTION guardian_terms_record_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'guardian_terms_record is append-only' USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION guardian_terms_record_append_only() FROM PUBLIC;
DROP TRIGGER IF EXISTS guardian_terms_record_append_only ON guardian_terms_record;
CREATE TRIGGER guardian_terms_record_append_only
  BEFORE UPDATE OR DELETE ON guardian_terms_record
  FOR EACH ROW EXECUTE FUNCTION guardian_terms_record_append_only();

-- Every change of a guardian link's terms (state, version or time), as it
-- happens, by whichever door made it: guardian_consent_record() (hers, or the
-- office's from a form), guardian_link_verify()'s stamp, the grant door,
-- guardian_consent_withdraw(), an import.
CREATE OR REPLACE FUNCTION guardian_terms_recorded() RETURNS trigger AS $$
DECLARE v_me uuid := app_user_id();
BEGIN
  IF NEW.relationship IN ('self', 'enquiry') THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' AND NEW.consent_state = 'pending' AND NEW.consent_version IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.consent_state, NEW.consent_version, NEW.consent_at)
                          IS NOT DISTINCT FROM (OLD.consent_state, OLD.consent_version, OLD.consent_at) THEN
    RETURN NULL;
  END IF;
  INSERT INTO guardian_terms_record (link_id, player_id, guardian_id, guardian_name, state, version, agreed_at, how, recorded_by)
  SELECT NEW.id, NEW.player_id, a.person_id, left(u.name, 200), NEW.consent_state, NEW.consent_version, NEW.consent_at,
         CASE WHEN v_me IS NULL THEN 'system' WHEN v_me = a.person_id THEN 'guardian' ELSE 'office' END,
         v_me
    FROM role_assignment a LEFT JOIN app_user u ON u.id = a.person_id
   WHERE a.id = NEW.assignment_id AND a.role = 'guardian';
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION guardian_terms_recorded() FROM PUBLIC;

CREATE OR REPLACE TRIGGER guardian_terms_recorded
  AFTER INSERT OR UPDATE OF consent_state, consent_version, consent_at ON assignment_subject
  FOR EACH ROW EXECUTE FUNCTION guardian_terms_recorded();

-- The links as they stand, once: every guardian link that says anything of
-- the terms and has nothing on record yet. A second paste finds them all.
INSERT INTO guardian_terms_record (link_id, player_id, guardian_id, guardian_name, state, version, agreed_at, how, recorded_at)
SELECT g.id, g.player_id, a.person_id, left(u.name, 200), g.consent_state, g.consent_version, g.consent_at, 'as_found', now()
  FROM assignment_subject g
  JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian'
  LEFT JOIN app_user u ON u.id = a.person_id
 WHERE g.relationship IS DISTINCT FROM 'self' AND g.relationship IS DISTINCT FROM 'enquiry'
   AND (g.consent_state <> 'pending' OR g.consent_version IS NOT NULL)
   AND NOT EXISTS (SELECT 1 FROM guardian_terms_record r WHERE r.link_id = g.id);


-- ── 2 · Whose terms she has still to read ──────────────────────────
-- The card on her Home and Family: "Read and agree to the school's terms
-- for T Bekker". His name and his school's, because she cannot agree to
-- terms for a child the screen cannot name; she typed the name and the
-- school verified it. Only her own links, live and verified, still pending:
-- an unverified, rejected, revoked or run-out link names nobody here
-- (GA-I20 §3.3, §3.4), and an agreed or withdrawn one is not due.
CREATE OR REPLACE FUNCTION my_terms_due()
RETURNS TABLE (link_id uuid, player_id uuid, full_name text, school_id uuid, school_name text) AS $$
  SELECT s.id, s.player_id, p.full_name, p.school_id, sc.name
    FROM role_assignment a
    JOIN assignment_subject s ON s.assignment_id = a.id
    JOIN player p ON p.id = s.player_id
    LEFT JOIN school sc ON sc.id = p.school_id
   WHERE app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND a.person_id = app_user_id() AND a.role = 'guardian' AND a.active
     AND pupil_signin_open(a.person_id)
     AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
     AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
     AND (a.expires_at  IS NULL OR a.expires_at  >  now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension d WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
     AND s.relationship IS DISTINCT FROM 'self' AND s.relationship IS DISTINCT FROM 'enquiry'
     AND s.verification_state = 'verified'
     AND s.valid_from <= sa_today()
     AND (s.valid_until IS NULL OR s.valid_until > sa_today())
     AND s.consent_state = 'pending'
   ORDER BY p.full_name, s.player_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION my_terms_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_terms_due() TO scrbrd_app;

-- The same children, and their schools, as arrays: the notice policies'
-- question, asked once per statement (an initplan), not once per row.
CREATE OR REPLACE FUNCTION terms_gate_mine() RETURNS uuid[] AS $$
  SELECT coalesce(array_agg(DISTINCT t.player_id), '{}'::uuid[]) FROM my_terms_due() t
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION terms_gate_mine() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION terms_gate_mine() TO scrbrd_app;

CREATE OR REPLACE FUNCTION terms_gate_schools() RETURNS uuid[] AS $$
  SELECT coalesce(array_agg(DISTINCT t.school_id), '{}'::uuid[]) FROM my_terms_due() t
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION terms_gate_schools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION terms_gate_schools() TO scrbrd_app;


-- ── 3 · The gate ───────────────────────────────────────────────────
-- Each body re-emitted from the catalog (pg_get_functiondef, as db/128,
-- db/168 and db/169 do), with the change below and nothing else; rights,
-- settings, volatility and owner checked unchanged. One statement: every
-- body moves, or none does. A second paste finds each body is this file's
-- (§0 has checked that, by its md5) and leaves it alone. The three copies
-- of app_can() take the same two lines, so each stays app_can() bar its
-- one line (db/99 §106, §146).
DO $gate$
DECLARE
  -- app_can()'s guardian arm: "names a live person" (which also opens the
  -- rows with no person in them, a fixture) and "reaches this person".
  A1 constant text := '                      WHERE g.assignment_id = a.id' || chr(10)
                   || '                        AND g.verification_state = ''verified''' || chr(10);
  A2 constant text := '                         WHERE g.assignment_id = a.id AND g.player_id = p_person' || chr(10)
                   || '                           AND g.verification_state = ''verified''' || chr(10);
  P1 constant text := '                        -- db/175: a guardian''s link counts once she has agreed the terms.' || chr(10)
                   || '                        AND (a.role <> ''guardian'' OR g.consent_state <> ''pending'' OR g.relationship IN (''self'', ''enquiry''))' || chr(10);
  P2 constant text := '                           AND (a.role <> ''guardian'' OR g.consent_state <> ''pending'' OR g.relationship IN (''self'', ''enquiry''))' || chr(10);
  F  constant text := '     AND s.player_id = p_player AND s.verification_state = ''verified''' || chr(10);
  W  constant text := '      FROM public_name_live_link(app_user_id(), p_player, ''guardian'') l;';
  WG constant text := '      FROM public_name_live_link(app_user_id(), p_player, ''guardian'') l' || chr(10)
                   || '     -- db/175: her own act for him rides a link she has agreed the terms on.' || chr(10)
                   || '     WHERE (SELECT g.consent_state FROM assignment_subject g WHERE g.id = l.link_id) <> ''pending'';';
  r record;
  v_src text; v_def text; v_cfg text; v_acl text; v_sec boolean; v_vol "char"; v_own oid; n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      (1,  'app_can(text,uuid,text,uuid,uuid)',            1, A1, A1 || P1),
      (2,  'app_can(text,uuid,text,uuid,uuid)',            1, A2, A2 || P2),
      (3,  'app_can_but_player(text,uuid,text,uuid,uuid)', 1, A1, A1 || P1),
      (4,  'app_can_but_player(text,uuid,text,uuid,uuid)', 1, A2, A2 || P2),
      (5,  'app_can_but_scorer(text,uuid,text,uuid,uuid)', 1, A1, A1 || P1),
      (6,  'app_can_but_scorer(text,uuid,text,uuid,uuid)', 1, A2, A2 || P2),
      (7,  'is_family_of(uuid)', 1, F,
           F || '     -- db/175: a guardian''s link counts once she has agreed the terms.' || chr(10)
             || '     AND (a.role <> ''guardian'' OR s.consent_state <> ''pending'' OR s.relationship IN (''self'', ''enquiry''))' || chr(10)),
      (8,  'my_alert_choices()', 1,
           '     WHERE a.role = ''guardian'' AND s.verification_state = ''verified''' || chr(10),
           '     WHERE a.role = ''guardian'' AND s.verification_state = ''verified''' || chr(10)
             || '       -- db/175: a child of hers once she has agreed the terms.' || chr(10)
             || '       AND (s.consent_state <> ''pending'' OR s.relationship IN (''self'', ''enquiry''))' || chr(10)),
      (9,  'my_health_consents()', 1,
           '       AND g.verification_state = ''verified''' || chr(10),
           '       AND g.verification_state = ''verified''' || chr(10)
             || '       -- db/175: a guardian''s link counts once she has agreed the terms.' || chr(10)
             || '       AND (a.role <> ''guardian'' OR g.consent_state <> ''pending'' OR g.relationship IN (''self'', ''enquiry''))' || chr(10)),
      (10, 'pupil_signin_my_link(uuid)', 1,
           '     AND s.verification_state = ''verified''' || chr(10),
           '     AND s.verification_state = ''verified''' || chr(10)
             || '     -- db/175: her link counts once she has agreed the terms.' || chr(10)
             || '     AND s.consent_state <> ''pending''' || chr(10)),
      (11, 'public_name_consent_set(uuid,boolean,text,uuid,text,date,text)', 1, W, WG),
      (12, 'health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)', 1, W, WG)
    ) AS t(ord, fn, times, was, now_) ORDER BY t.ord LOOP
    SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef, p.provolatile, p.proowner
      INTO v_src, v_cfg, v_acl, v_sec, v_vol, v_own FROM pg_proc p WHERE p.oid = r.fn::regprocedure;
    -- A second run: §0 checked the body is this file's.
    IF md5(v_src) = (SELECT b.mine_md5 FROM _db175_bodies b WHERE b.fn = r.fn) THEN CONTINUE; END IF;
    n := (length(v_src) - length(replace(v_src, r.was, ''))) / length(r.was);
    IF n <> r.times THEN
      RAISE EXCEPTION 'db/175: % holds the text it changes % times, not %', r.fn, n, r.times;
    END IF;
    v_def := pg_get_functiondef(r.fn::regprocedure);
    EXECUTE replace(v_def, r.was, r.now_);
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM replace(v_src, r.was, r.now_)
       OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_cfg
       OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_acl
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_sec
       OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_vol
       OR (SELECT p.proowner FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM v_own THEN
      RAISE EXCEPTION 'db/175: re-emitting % changed more than its one change', r.fn;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM _db175_bodies LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM r.mine_md5 THEN
      RAISE EXCEPTION 'db/175: % is not this file''s body after the gate (md5 %)', r.fn,
        (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure);
    END IF;
  END LOOP;
END $gate$;


-- ── 4 · His notices, held until she agrees (Q4) ─────────────────────
-- Every permissive read of a notice about a named child already asks
-- app_can() for that child, which §3 closes. This says it once more on the
-- notice itself, so that no notice route added later can miss it: a notice
-- about a child the caller reaches only through a link waiting for her
-- agreement is not read; her other reach of him (a coach, the office), and
-- the system's own notices addressed to her ("The school has answered", a
-- link ending), still read. Delivery to a phone follows: push-api.mjs
-- fanOut() reads the notice as the recipient before it sends, so a held
-- notice is not pushed. When she agrees it reads with its own date; nothing
-- counts what is held.
DO $notice$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification'::regclass AND polname = 'notification_terms_gate') THEN
    CREATE POLICY notification_terms_gate ON notification AS RESTRICTIVE
      FOR SELECT USING (
        subject_person_id IS NULL
        OR (kind = 'system' AND recipient_id = app_user_id())
        OR NOT subject_person_id = ANY (coalesce((SELECT terms_gate_mine()), '{}'::uuid[]))
        OR app_can(required_capability, school_id, coalesce(team_code, '*'::text), subject_person_id,
                   '00000000-0000-0000-0000-000000000000'::uuid)
      );
  END IF;
  -- The DSO's notice to her ("The DSO has shared something with you") names
  -- no child and is read through news.read at her school, which a parent whose
  -- only links wait for her agreement no longer holds. A DSO's act of sharing
  -- is never the gate's to stop (Q4): addressed to her, at a school where her
  -- link waits, it reads.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'notification'::regclass AND polname = 'notification_terms_gate_dso') THEN
    CREATE POLICY notification_terms_gate_dso ON notification
      FOR SELECT USING (
        kind = 'safeguarding' AND subject_person_id IS NULL AND recipient_id = app_user_id()
        AND school_id = ANY (coalesce((SELECT terms_gate_schools()), '{}'::uuid[]))
      );
  END IF;
END $notice$;


-- ── 5 · Who may call what ──────────────────────────────────────────
DO $grants$
DECLARE
  f text; r text;
  v_doors text[] := ARRAY['my_terms_due()', 'terms_gate_mine()', 'terms_gate_schools()'];
  v_internal text[] := ARRAY['guardian_terms_recorded()', 'guardian_terms_record_append_only()'];
BEGIN
  FOREACH f IN ARRAY v_doors LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f::regprocedure);
  END LOOP;
  FOREACH f IN ARRAY v_internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f::regprocedure);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF to_regrole(r) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON guardian_terms_record FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE guardian_terms_record_seq_seq FROM %I', r);
      FOREACH f IN ARRAY v_doors || v_internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f::regprocedure, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── 6 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §150.
DO $check$
DECLARE f text; v text; w text; r record;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'guardian_terms_record'::regclass) THEN
    RAISE EXCEPTION 'db/175: guardian_terms_record is not under row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guardian_terms_record')
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault(CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END::"char", c.relowner))) x
                 WHERE c.oid IN ('guardian_terms_record'::regclass, 'guardian_terms_record_seq_seq'::regclass) AND x.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'db/175: guardian_terms_record or its sequence is reachable other than by its owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'assignment_subject'::regclass
                    AND tgname = 'guardian_terms_recorded' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'guardian_terms_record'::regclass
                    AND tgname = 'guardian_terms_record_append_only' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/175: a trigger of the agreement record is missing or disabled';
  END IF;
  -- Every guardian link that says anything of the terms has its record.
  IF EXISTS (SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian'
              WHERE g.relationship IS DISTINCT FROM 'self' AND g.relationship IS DISTINCT FROM 'enquiry'
                AND (g.consent_state <> 'pending' OR g.consent_version IS NOT NULL)
                AND NOT EXISTS (SELECT 1 FROM guardian_terms_record x WHERE x.link_id = g.id)) THEN
    RAISE EXCEPTION 'db/175: a guardian link''s terms are not on record';
  END IF;
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v FROM pg_policy p
   WHERE p.polrelid = 'notification'::regclass AND p.polname = 'notification_terms_gate'
     AND NOT p.polpermissive AND p.polcmd = 'r';
  IF v IS NULL OR position('terms_gate_mine()' IN v) = 0 THEN
    RAISE EXCEPTION 'db/175: notification_terms_gate is %', coalesce(v, '(missing, or not restrictive)');
  END IF;
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v FROM pg_policy p
   WHERE p.polrelid = 'notification'::regclass AND p.polname = 'notification_terms_gate_dso'
     AND p.polpermissive AND p.polcmd = 'r';
  IF v IS NULL OR position('terms_gate_schools()' IN v) = 0 OR position('safeguarding' IN v) = 0 THEN
    RAISE EXCEPTION 'db/175: notification_terms_gate_dso is %', coalesce(v, '(missing, or not permissive)');
  END IF;
  FOR r IN SELECT * FROM _db175_bodies LOOP
    IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure) IS DISTINCT FROM r.mine_md5 THEN
      RAISE EXCEPTION 'db/175: % is not this file''s body after the paste (md5 %)', r.fn,
        (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = r.fn::regprocedure);
    END IF;
  END LOOP;
  -- The copies of the core check: each is app_can() bar its one line.
  IF replace((SELECT prosrc FROM pg_proc WHERE oid = 'app_can_but_player(text,uuid,text,uuid,uuid)'::regprocedure),
             chr(10) || '       AND a.role <> ''player''', '')
       IS DISTINCT FROM (SELECT prosrc FROM pg_proc WHERE oid = 'app_can(text,uuid,text,uuid,uuid)'::regprocedure)
     OR replace((SELECT prosrc FROM pg_proc WHERE oid = 'app_can_but_scorer(text,uuid,text,uuid,uuid)'::regprocedure),
             chr(10) || '       AND a.role <> ''scorer''', '')
       IS DISTINCT FROM (SELECT prosrc FROM pg_proc WHERE oid = 'app_can(text,uuid,text,uuid,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/175: app_can_but_player() or app_can_but_scorer() is not app_can() bar its one line';
  END IF;
  FOR f IN SELECT unnest(ARRAY['my_terms_due()', 'terms_gate_mine()', 'terms_gate_schools()', 'guardian_terms_recorded()']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/175: % is not a definer that pins its search_path', f;
    END IF;
    SELECT coalesce(string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text), '')
      INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = f::regprocedure AND x.grantee <> p.proowner;
    w := CASE WHEN f = 'guardian_terms_recorded()' THEN '' ELSE 'scrbrd_app:EXECUTE' END;
    IF v IS DISTINCT FROM w THEN
      RAISE EXCEPTION 'db/175: % is granted %', f, coalesce(nullif(v, ''), 'to nobody');
    END IF;
  END LOOP;
END $check$;
DROP TABLE IF EXISTS _db175_bodies;
RESET lock_timeout;
