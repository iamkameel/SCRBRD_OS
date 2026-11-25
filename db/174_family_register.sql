-- ══════════════════════════════════════════════════════════════════
--  174 · The family list: a parent or a pupil the school listed in
--        advance is linked, or recognised, on the address Google
--        verified and the child's date of birth
--        (SCRBRD-140, the honesty model, Migration C)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. SCRBRD-140's honesty model, Migration C and slice 5 of its
-- build plan, on Kameel's answers of 18 Nov 2026:
--   Q1  (b), switched on per school: a full match on all six conditions
--           links at once. It is OFF for a school until that school says
--           yes (the platform's grant of `family_list_links` for it, as the
--           scorebook reader is granted after a school's sign-off). The
--           office is told of each link the list made, with End link.
--   Q2  (a): the parent's join form gains one optional field, the child's
--           date of birth. It is compared inside one function and never
--           kept: never a column, never a log line, never a note.
--   Q11 (a): db/93's no-name notice also goes out on a declined pupil
--           claim. The pupil's own claim (db/168's pupil_claim_decline())
--           has sent it since db/168; this file adds the other door a
--           person claims to be a pupil through, a declined `player`
--           request (§9).
--   The ceiling (confirmed): a fully matched, school-listed parent gets the
--           ordinary guardian bundle, through the one grant door, her link
--           verified by the uploader and its consent PENDING: she agrees
--           to the terms before she reads anything of his, as today.
--   D3 holds: auth_identity_sign_in() is not touched. The list works only
--           from an account already signed in, and a `pupil` row never
--           attaches a sign-in to an account that already exists.
--
-- A ROW. One child (by his roster id, never a typed name), one address,
-- a kind (`guardian` with a relationship, or `pupil` for the child's own
-- address), a claim-by date. Uploaded by the office (guardian.link.manage
-- at the school, with the authority to grant the row's role there), checked
-- at upload, and claimed once.
--
-- A MATCH IS ALL SIX (design §2.3), or it is not a match:
--   1  the claimant is signed in, and an address Google verified for one of
--      his live sign-ins (auth_identity.email_at_link, lower-cased, exact)
--      is the row's address;
--   2  the row is open: not claimed, not withdrawn, not cleared, in date;
--   3  the date of birth he typed is the roster's for the row's child,
--      exactly;
--   4  the uploader still holds the authority to make this link, asked
--      again now (P2-D8): a departed office's list links nobody;
--   5  the claimant is not paused from asking (db/93) nor paused at the
--      school (a duty_suspension on an assignment of his there);
--   6  for a `pupil` row: the child has no account already. If he has,
--      nothing merges; it goes to the office.
-- And the school has switched it on (Q1). With the switch off, a full match
-- links nothing: the row is used up and her request waits for the office,
-- marked "On the family list. The details agree." (Q1 (a)'s sorting).
--
-- ONE GO. A row is used up by its first claim. A date that agrees uses up
-- that child's row. A date that agrees with no row uses up every open row
-- for that address at that school, so a wrong guess cannot be followed by
-- another. No date typed tries nothing and uses up nothing.
--
-- WHAT THE CLAIMANT READS. A parent linked: 'linked'. A pupil of eighteen
-- given `player`: 'in'. Everyone else, whatever the reason: 'sent'. A pupil
-- under eighteen whose claim the list recognised reads it from his own
-- state (my_pupil_state(), 'recognised'), which is the design's sentence;
-- pupil_claim_send() answers him exactly as before.
--
-- WHAT MOVES
--   + feature_flag `family_list_links` (feature, off) and
--     family_list_links_on(school): on only through a grant FOR THAT
--     SCHOOL; the platform default turns it on for nobody (db/66's shape).
--   + family_register   one row per listed link. RLS on, no policy, no
--       privilege for the application: functions only (db/92's shape).
--       NO DATE OF BIRTH: the roster's is read at the claim; the typed one
--       is an argument.
--   + family_register_upload(school, rows, commit, acknowledged)   check,
--       then commit, all or nothing (db/92's register_upload() shape).
--   + family_register_claim(request, born)   a parent's guardian request,
--       or a pupil's own `player` request, tried against the list, right
--       after it is filed (POST /api/requests). The door's third caller.
--   ~ pupil_claim_send()   db/168's, with one block: a date typed tries the
--       list's `pupil` rows; a match under eighteen is RECOGNISED (known_how
--       'family_list', known_by the uploader), and opens nothing (db/169's
--       gate and a guardian's yes still decide that). md5-guarded, and
--       checked to be db/168's text with that block and nothing else.
--   + family_register_withdraw(row), family_register_rows(school, state),
--     family_register_redact_due(school), family_register_redact(school),
--     family_register_status(school)   the office's.
--   + family_register_line(request)   the office's line on a request the
--       list did not link: details_disagree · uploader_lapsed ·
--       details_agree (switched off) · has_account · refused · link_ended
--       (a list-made link the office ended, §8b). Never the
--       date she typed; never to the requester.
--   + the office's notice for each link (or recognition) the list made.
--   ~ role_assignment_end()   db/77's, as db/128 left it, re-emitted from the
--       body in place (md5-guarded): a guardian link the family list made may
--       be ended while it is a minor's last verified link (Kameel, 25 Nov), and
--       ending it reopens its request in Requests (§8b). Every other link keeps
--       db/08's rule.
--   ~ guardian_link_revoke()   db/109's, as db/128 left it: the same two edits
--       (Kameel, 25 Nov: the office's revoke is one way of ending it).
--   + trigger role_request_player_declined_notice   Q11 (§9).
--   ~ the one grant door's caller check (db/92 §8, "one door, two callers"):
--       asserted here as it now stands, four callers by name.
-- No row is inserted, changed or deleted. Nothing is dropped.
--
-- Every function: SECURITY DEFINER, search_path pinned, REVOKE ALL FROM
-- PUBLIC in the statement after its own (so a paste run statement by
-- statement never leaves one PUBLIC's); the doors GRANT EXECUTE to scrbrd_app by name; nothing to anon,
-- authenticated or service_role (db/157). No BEGIN or COMMIT: the paste
-- wraps the file in one transaction. Safe to run twice. Its proof is
-- db/99 §149; its walk is tools/smoke-family-register.mjs.


-- ── 0 · What this file stands on ─────────────────────────────────────
DO $guard$
DECLARE v text;
BEGIN
  IF to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)') IS NULL
     OR to_regprocedure('app_may_grant_at_for(uuid,text,uuid)') IS NULL OR to_regprocedure('app_may_assign_at_for(uuid,uuid)') IS NULL
     OR to_regprocedure('pupil_claim_office(uuid)') IS NULL OR to_regprocedure('pupil_claim_log(text,uuid,uuid[])') IS NULL
     OR to_regprocedure('pupil_signin_after_yes(uuid,text)') IS NULL
     OR to_regprocedure('declined_claim_notice(uuid,text,text,uuid)') IS NULL OR to_regprocedure('request_cooldown_open(uuid)') IS NULL
     OR to_regprocedure('feature_enabled(text,uuid,uuid)') IS NULL OR to_regprocedure('majority_on(date)') IS NULL
     OR to_regprocedure('sa_today()') IS NULL OR to_regprocedure('person_is_pupil(uuid)') IS NULL
     OR to_regclass('pupil_claim') IS NULL OR to_regclass('auth_identity') IS NULL OR to_regclass('duty_suspension') IS NULL
     -- db/173 first: it makes a first date that makes a boy 18 the office's,
     -- and the list lets a boy of 18 in on that date.
     OR to_regprocedure('player_born_confirm(uuid)') IS NULL OR to_regprocedure('player_born_confirmed(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/174: role_request_grant_as() (db/92), db/168''s pupil claim, db/169''s pupil_signin_after_yes(), declined_claim_notice() (db/93), feature_enabled() (db/08), majority_on() (db/62), sa_today() (db/128) or db/173''s player_born_confirm() is missing; apply them first';
  END IF;
  -- pupil_claim_send(): db/168's, or this file's own (a second paste).
  v := md5((SELECT prosrc FROM pg_proc WHERE oid = 'pupil_claim_send(uuid,text,text,date)'::regprocedure));
  IF v NOT IN ('026263290b4c3ebba66bbfe172c2a1d3', 'b562ebde580002fc7efb345117ef5d85') THEN
    RAISE EXCEPTION 'db/174: pupil_claim_send() is neither db/168''s nor this file''s (md5 %); factor the version now in place and move these hashes', v;
  END IF;
END $guard$;


-- ── 0b · Ten seconds for a lock, or nothing (db/158's pattern) ────────
-- The trigger in §9 locks role_request. A plain SET, reset by the file's
-- last statement, so a pooled connection is handed back as it came.
SET lock_timeout = '10s';


-- ── 1 · The switch (Q1) ─────────────────────────────────────────────
INSERT INTO feature_flag (key, kind, label, enabled, reason) VALUES
  ('family_list_links', 'feature', 'Family list links at once', false,
   'SCRBRD-140 honesty model, Q1 (b): a parent or a pupil the school listed in advance is linked at once on a full '
   'match (the address Google verified, the child''s date of birth, one try, the uploader checked again). A link '
   'reads a child''s file, so it is granted per school, after that school has said yes; the platform default turns '
   'it on for nobody. Off, the family list only marks the office''s Requests.')
ON CONFLICT (key) DO NOTHING;

-- On for a school only through a grant for that school (db/66's
-- scorebook_reader_on() shape): never the platform's default, and a
-- suppression turns it off.
CREATE OR REPLACE FUNCTION family_list_links_on(p_school uuid) RETURNS boolean AS $$
  SELECT p_school IS NOT NULL
     AND coalesce(feature_enabled('family_list_links', p_school, NULL), false)
     AND EXISTS (SELECT 1 FROM feature_grant g WHERE g.key = 'family_list_links' AND g.school_id = p_school AND g.granted)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_list_links_on(uuid) FROM PUBLIC;


-- ── 2 · The table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS family_register (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  -- The child, by his roster row. A row whose child is erased links nobody.
  player_id        uuid REFERENCES player(id) ON DELETE SET NULL,
  email            text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) <= 320
                                        AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  kind             text NOT NULL CHECK (kind IN ('guardian', 'pupil')),
  -- What the office listed her as. The link the grant door writes says
  -- 'parent', as a hand grant's does; this is the office's record.
  relationship     text CHECK (relationship IN ('parent', 'guardian', 'grandparent', 'other')),
  -- The row's claim window (P2-D6), not the link's life.
  valid_until      date NOT NULL,
  -- Who listed and who withdrew stay on the record, as role_assignment_ending
  -- and guardian_link_ending keep who ended (no ON DELETE): an office
  -- account is ended and tombstoned, never deleted from under its acts.
  uploaded_by      uuid NOT NULL REFERENCES app_user(id),
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  upload_id        uuid NOT NULL,
  -- The ended link the uploader acknowledged ("ended 3 Sep — list anyway?").
  warned_ended_on  date,
  claimed_at       timestamptz,
  claimed_by       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  claimed_identity uuid REFERENCES auth_identity(id) ON DELETE SET NULL,
  claimed_request  uuid REFERENCES role_request(id) ON DELETE SET NULL,
  -- The assignment the list's grant wrote (outcome granted): what "a link the
  -- list made" means to End role (§8b), whatever later happens to the request.
  granted_assignment uuid REFERENCES role_assignment(id) ON DELETE SET NULL,
  -- A pupil's row: the `selfaccess` assignment the same grant wrote beside
  -- his `player` one, so ending one ends both (§8b).
  granted_self_assignment uuid REFERENCES role_assignment(id) ON DELETE SET NULL,
  -- granted     the link (or a pupil's `player`) was written
  -- recognised  a pupil under 18's claim was recognised; nothing opened
  -- requested   used up, and the office decides (outcome_reason says why)
  outcome          text CHECK (outcome IN ('granted', 'recognised', 'requested')),
  outcome_reason   text CHECK (outcome_reason IN ('details_disagree', 'uploader_authority_lapsed', 'not_switched_on',
                                                  'has_account', 'refused')),
  withdrawn_at     timestamptz,
  withdrawn_by     uuid REFERENCES app_user(id),
  redacted_at      timestamptz,
  CONSTRAINT family_register_kind_shape CHECK ((kind = 'guardian') = (relationship IS NOT NULL)),
  CONSTRAINT family_register_claimed_whole CHECK ((claimed_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT family_register_reason_shape CHECK ((outcome = 'requested') = (outcome_reason IS NOT NULL)),
  CONSTRAINT family_register_open_or_done CHECK (NOT (claimed_at IS NOT NULL AND withdrawn_at IS NOT NULL)),
  CONSTRAINT family_register_withdrawn_names_who CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL)),
  -- A claimed row is the record of what happened, and is kept as it is.
  CONSTRAINT family_register_redacted_unclaimed CHECK (redacted_at IS NULL OR claimed_at IS NULL)
);
-- A paste of an earlier cut of this file made the table without it.
ALTER TABLE family_register ADD COLUMN IF NOT EXISTS granted_assignment uuid REFERENCES role_assignment(id) ON DELETE SET NULL;
ALTER TABLE family_register ADD COLUMN IF NOT EXISTS granted_self_assignment uuid REFERENCES role_assignment(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS family_register_one_open
  ON family_register (school_id, player_id, email, kind)
  WHERE claimed_at IS NULL AND withdrawn_at IS NULL AND redacted_at IS NULL;
CREATE INDEX IF NOT EXISTS family_register_email_idx
  ON family_register (school_id, email) WHERE claimed_at IS NULL AND withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS family_register_request_idx
  ON family_register (claimed_request) WHERE claimed_request IS NOT NULL;

COMMENT ON TABLE family_register IS
  'db/174 (SCRBRD-140 honesty model, Migration C): a guardian''s or a pupil''s address the office listed for a child in advance, claimed once by the verified Google address and the child''s date of birth. No date of birth is stored. Functions only.';

ALTER TABLE family_register ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON family_register FROM PUBLIC;
REVOKE ALL ON family_register FROM scrbrd_app;


-- ── 3 · The questions the doors ask ─────────────────────────────────
-- The record of an act on the list: the rows' ids, never an address.
CREATE OR REPLACE FUNCTION family_register_log(p_resource text, p_school uuid, p_ids uuid[]) RETURNS void AS $$
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, device_id)
  VALUES (p_school, app_user_id(), p_resource, coalesce(p_ids, '{}'), coalesce(cardinality(p_ids), 0), app_device_id())
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_log(text,uuid,uuid[]) FROM PUBLIC;

-- The role a row of this kind is granted through the door.
CREATE OR REPLACE FUNCTION family_register_role(p_kind text) RETURNS text AS $$
  SELECT CASE p_kind WHEN 'guardian' THEN 'guardian' WHEN 'pupil' THEN 'player' END
$$ LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_role(text) FROM PUBLIC;

-- Condition 4 (P2-D8): may this person, now, make this kind of link at this
-- school? An active account; a live assignment AT the school (never a
-- platform-wide one) whose role holds guardian.link.manage, with
-- app_enrolled()'s liveness clauses; and exactly what a hand grant of the
-- role there asks (user.role.assign, and db/77's floor, about this person).
CREATE OR REPLACE FUNCTION family_may_link_for(p_person uuid, p_school uuid, p_kind text) RETURNS boolean AS $$
  SELECT p_person IS NOT NULL AND p_school IS NOT NULL
     AND EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.active)
     AND EXISTS (
       SELECT 1
         FROM role_assignment a
         JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'guardian.link.manage'
        WHERE a.person_id = p_person AND a.school_id = p_school AND a.team_code IS NULL
          AND a.active
          AND (a.valid_from  IS NULL OR a.valid_from  <= sa_today())
          AND (a.valid_until IS NULL OR a.valid_until >  sa_today())
          AND (a.expires_at IS NULL OR a.expires_at > now())
          AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL))
     AND app_may_assign_at_for(p_person, p_school)
     AND coalesce(app_may_grant_at_for(p_person, family_register_role(p_kind), p_school), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_may_link_for(uuid,uuid,text) FROM PUBLIC;

-- Condition 6: does this boy have an account already (a roster link, a live
-- own link, or another account recognised as him)? p_except is the
-- claimant's own claim, which is not "another".
CREATE OR REPLACE FUNCTION family_child_has_account(p_player uuid, p_except uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.player_id = p_player AND u.active)
      OR EXISTS (SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
                  WHERE g.player_id = p_player AND g.relationship = 'self' AND a.active
                    AND (g.valid_until IS NULL OR g.valid_until > sa_today()))
      OR EXISTS (SELECT 1 FROM pupil_claim o WHERE o.player_id = p_player AND o.state IN ('recognised', 'open')
                    AND o.user_id IS DISTINCT FROM p_except)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_child_has_account(uuid,uuid) FROM PUBLIC;

-- The accounts an address belongs to: the address the office typed on the
-- account, or one Google verified for a live sign-in of it (db/92's rule).
CREATE OR REPLACE FUNCTION family_address_accounts(p_email text) RETURNS SETOF uuid AS $$
  SELECT u.id FROM app_user u
   WHERE lower(u.email) = lower(btrim(p_email))
      OR EXISTS (SELECT 1 FROM auth_identity x WHERE x.user_id = u.id AND x.revoked_at IS NULL
                                               AND lower(x.email_at_link) = lower(btrim(p_email)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_address_accounts(text) FROM PUBLIC;

-- A guardian link to this child that has ended (revoked, rejected, or its
-- role no longer active), of one person; or of anybody when p_person is NULL.
-- Answers the day it ended, the latest first; NULL for none.
CREATE OR REPLACE FUNCTION family_link_ended_on(p_player uuid, p_person uuid) RETURNS date AS $$
  SELECT max(coalesce(g.valid_until, sa_date(a.revoked_at), sa_date(g.verified_at), sa_date(g.created_at)))
    FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
   WHERE g.player_id = p_player AND a.role = 'guardian' AND g.relationship IS DISTINCT FROM 'self'
     AND (p_person IS NULL OR a.person_id = p_person)
     AND (g.verification_state IN ('revoked', 'rejected') OR NOT a.active
          OR (g.valid_until IS NOT NULL AND g.valid_until <= sa_today()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_link_ended_on(uuid,uuid) FROM PUBLIC;

-- Does this person hold a live guardian link to this child already?
CREATE OR REPLACE FUNCTION family_link_live(p_player uuid, p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
                  WHERE g.player_id = p_player AND a.person_id = p_person AND a.role = 'guardian' AND a.active
                    AND g.verification_state IN ('pending', 'verified')
                    AND (g.valid_until IS NULL OR g.valid_until > sa_today()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_link_live(uuid,uuid) FROM PUBLIC;

-- How a boy is named to the office in a notice: initial and surname.
CREATE OR REPLACE FUNCTION family_register_child_words(p_player uuid) RETURNS text AS $$
  SELECT coalesce(nullif(btrim(left(btrim(p.full_name), 1) || ' ' || coalesce(p.surname, '')), ''), 'a pupil')
    FROM player p WHERE p.id = p_player
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_child_words(uuid) FROM PUBLIC;

-- One notice to the school's office (guardian.link.manage), for a link or
-- a recognition the list made. Never public; never on a lock screen beyond
-- the push contract's words (services/api/notify/push-api.mjs).
CREATE OR REPLACE FUNCTION family_register_notice(p_school uuid, p_title text, p_body text) RETURNS void AS $$
  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind)
  VALUES (p_school, NULL, 'school', 'system', 'medium', p_title, p_body, 'guardian.link.manage', false, 'system')
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_notice(uuid,text,text) FROM PUBLIC;


-- ── 4 · Upload: check, then commit ──────────────────────────────────
-- All or nothing: one bad row commits nothing. A dry run by default. Each
-- row is { player_id, email, kind, relationship?, valid_until? }, answered
-- with a code the API turns into words (services/api/write/family-register-api.mjs):
--   problems   player_unknown · email_invalid · kind_invalid ·
--              relationship_invalid · not_grantable_here · born_required ·
--              player_is_an_adult · player_has_an_account · already_linked ·
--              link_revoked · valid_until_invalid · valid_until_past ·
--              valid_until_too_far · valid_until_required ·
--              duplicate_in_file · already_listed · warning_not_acknowledged
--   a warning  link_ended: this child has a guardian link that ended
--              (ended_on), and `ack`, the key the commit must carry
--   the call   not_permitted · no_rows · too_many_rows (line 0)
-- "player_unknown" is also the answer for a child of another school, so the
-- check says nothing about anybody else's roster.
CREATE OR REPLACE FUNCTION family_register_upload(p_school uuid, p_rows jsonb, p_commit boolean DEFAULT false,
                                                  p_acknowledged uuid[] DEFAULT '{}')
RETURNS TABLE (line integer, ok boolean, problem text, detail text, warning text, ended_on date,
               ack uuid, row_id uuid, upload_id uuid) AS $$
#variable_conflict use_column
DECLARE
  NIL       uuid := '00000000-0000-0000-0000-000000000000';
  v_me      uuid := app_user_id();
  v_default date;
  v_out     jsonb := '[]'::jsonb;
  v_seen    jsonb := '{}'::jsonb;
  v_bad     boolean := false;
  e         jsonb;
  i         integer := 0;
  v_line    integer;
  v_player  uuid; v_email text; v_kind text; v_rel text; v_raw text; v_until date; v_born date;
  v_problem text; v_detail text; v_warn text; v_ended date; v_ack uuid;
  v_key     text;
  v_upload  uuid;
  v_id      uuid;
  v_ids     uuid[] := '{}';
  v_row     jsonb;
  k         integer;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() OR p_school IS NULL OR NOT pupil_claim_office(p_school) THEN
    RETURN QUERY SELECT 0, false, 'not_permitted'::text, NULL::text, NULL::text, NULL::date, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN QUERY SELECT 0, false, 'no_rows'::text, NULL::text, NULL::text, NULL::date, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF jsonb_array_length(p_rows) > 200 THEN
    RETURN QUERY SELECT 0, false, 'too_many_rows'::text, '200'::text, NULL::text, NULL::date, NULL::uuid, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT s.ends_on INTO v_default FROM season s
   WHERE s.level = 'school' AND sa_today() BETWEEN s.starts_on AND s.ends_on
   ORDER BY s.ends_on LIMIT 1;

  FOR e IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    v_line := CASE WHEN jsonb_typeof(e->'line') = 'number' THEN (e->>'line')::numeric::integer ELSE i END;
    v_problem := NULL; v_detail := NULL; v_warn := NULL; v_ended := NULL; v_ack := NULL;
    v_player := NULL; v_born := NULL; v_until := NULL;
    v_email := lower(btrim(coalesce(e->>'email', '')));
    v_kind  := lower(btrim(coalesce(e->>'kind', '')));
    v_rel   := nullif(lower(btrim(coalesce(e->>'relationship', ''))), '');
    v_rel   := CASE WHEN v_rel IN ('mother', 'father') THEN 'parent' ELSE v_rel END;
    v_raw   := nullif(btrim(coalesce(e->>'valid_until', '')), '');
    IF coalesce(e->>'player_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT p.id, p.born INTO v_player, v_born FROM player p WHERE p.id = (e->>'player_id')::uuid AND p.school_id = p_school;
    END IF;

    IF v_player IS NULL THEN
      v_problem := 'player_unknown';
    ELSIF length(v_email) > 320 OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      v_problem := 'email_invalid';
    ELSIF v_kind NOT IN ('guardian', 'pupil') THEN
      v_problem := 'kind_invalid';
    ELSIF (v_kind = 'guardian' AND (v_rel IS NULL OR v_rel NOT IN ('parent', 'guardian', 'grandparent', 'other')))
       OR (v_kind = 'pupil' AND v_rel IS NOT NULL) THEN
      v_problem := 'relationship_invalid';
    -- The uploader's own authority: what a hand grant of the role here asks.
    ELSIF NOT (app_can('user.role.assign', p_school, '*'::text, NIL, NIL)
               AND app_may_grant_at(family_register_role(v_kind), p_school)) THEN
      v_problem := 'not_grantable_here';
    -- The match compares the roster's date: a child without one is matched by hand.
    ELSIF v_born IS NULL THEN
      v_problem := 'born_required';
    -- The grant door refuses a guardian of an adult; say so now.
    ELSIF v_kind = 'guardian' AND majority_on(v_born) <= sa_today() THEN
      v_problem := 'player_is_an_adult';
    ELSIF v_kind = 'pupil' AND family_child_has_account(v_player, NULL) THEN
      v_problem := 'player_has_an_account';
    ELSIF v_kind = 'guardian' AND EXISTS (SELECT 1 FROM family_address_accounts(v_email) a(id) WHERE family_link_live(v_player, a.id)) THEN
      v_problem := 'already_linked';
    -- Refused: this address's own link to this child was ended.
    ELSIF EXISTS (SELECT 1 FROM family_address_accounts(v_email) a(id) WHERE family_link_ended_on(v_player, a.id) IS NOT NULL) THEN
      v_problem := 'link_revoked';
    END IF;

    IF v_problem IS NULL THEN
      IF v_raw IS NULL THEN
        v_until := v_default;
        IF v_until IS NULL THEN v_problem := 'valid_until_required'; END IF;
      ELSIF v_raw !~ '^\d{4}-\d{2}-\d{2}$' THEN
        v_problem := 'valid_until_invalid';
      ELSE
        BEGIN
          v_until := v_raw::date;
        EXCEPTION WHEN others THEN
          v_problem := 'valid_until_invalid';
        END;
      END IF;
      IF v_problem IS NULL AND v_until < sa_today() THEN
        v_problem := 'valid_until_past';
      ELSIF v_problem IS NULL AND v_until > (sa_today() + interval '18 months')::date THEN
        v_problem := 'valid_until_too_far';
      END IF;
    END IF;

    IF v_problem IS NULL THEN
      v_key := v_player::text || '|' || v_email || '|' || v_kind;
      IF v_seen ? v_key THEN
        v_problem := 'duplicate_in_file'; v_detail := v_seen->>v_key;
      ELSE
        v_seen := v_seen || jsonb_build_object(v_key, v_line);
      END IF;
    END IF;

    IF v_problem IS NULL THEN
      SELECT to_char(g.valid_until, 'YYYY-MM-DD') INTO v_detail FROM family_register g
       WHERE g.school_id = p_school AND g.player_id = v_player AND g.email = v_email AND g.kind = v_kind
         AND g.claimed_at IS NULL AND g.withdrawn_at IS NULL AND g.redacted_at IS NULL AND g.valid_until >= sa_today();
      IF FOUND THEN v_problem := 'already_listed'; ELSE v_detail := NULL; END IF;
    END IF;

    -- The warning: this child has a guardian link that ended, anybody's.
    IF v_problem IS NULL THEN
      v_ended := family_link_ended_on(v_player, NULL);
      IF v_ended IS NOT NULL THEN
        v_warn := 'link_ended';
        v_ack  := md5('family|' || p_school::text || '|' || v_player::text || '|' || v_ended::text)::uuid;
        IF p_commit AND NOT (v_ack = ANY (coalesce(p_acknowledged, '{}'))) THEN
          v_problem := 'warning_not_acknowledged';
        END IF;
      END IF;
    END IF;

    IF v_problem IS NOT NULL THEN v_bad := true; END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line', v_line, 'ok', v_problem IS NULL, 'problem', v_problem, 'detail', v_detail,
      'warning', v_warn, 'ended_on', v_ended, 'ack', v_ack,
      'player', v_player, 'email', v_email, 'kind', v_kind, 'relationship', v_rel, 'until', v_until));
  END LOOP;

  IF p_commit AND NOT v_bad THEN
    v_upload := gen_random_uuid();
    FOR k IN 0 .. jsonb_array_length(v_out) - 1 LOOP
      v_row := v_out->k;
      -- The same child, address and kind listed before, past its date: done.
      UPDATE family_register g SET withdrawn_at = now(), withdrawn_by = v_me
       WHERE g.school_id = p_school AND g.player_id = (v_row->>'player')::uuid AND g.email = v_row->>'email'
         AND g.kind = v_row->>'kind' AND g.claimed_at IS NULL AND g.withdrawn_at IS NULL AND g.redacted_at IS NULL
         AND g.valid_until < sa_today();
      INSERT INTO family_register (school_id, player_id, email, kind, relationship, valid_until, uploaded_by, upload_id, warned_ended_on)
      VALUES (p_school, (v_row->>'player')::uuid, v_row->>'email', v_row->>'kind', v_row->>'relationship',
              (v_row->>'until')::date, v_me, v_upload, (v_row->>'ended_on')::date)
      RETURNING id INTO v_id;
      v_ids := v_ids || v_id;
      v_out := jsonb_set(v_out, ARRAY[k::text, 'row_id'], to_jsonb(v_id));
    END LOOP;
    PERFORM family_register_log('family_register.upload', p_school, ARRAY[v_upload] || v_ids);
  END IF;

  RETURN QUERY
    SELECT (o->>'line')::integer, (o->>'ok')::boolean, o->>'problem', o->>'detail', o->>'warning',
           (o->>'ended_on')::date, (o->>'ack')::uuid, (o->>'row_id')::uuid, v_upload
      FROM jsonb_array_elements(v_out) WITH ORDINALITY AS t(o, n)
     ORDER BY t.n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_upload(uuid,jsonb,boolean,uuid[]) FROM PUBLIC;


-- ── 5 · The match: one go ───────────────────────────────────────────
-- Internal. Under the caller's lock on the claimant. The open rows for any
-- of his live verified addresses at the school, locked. Google's only
-- (condition 1): auth_identity also takes microsoft.com and emailLink sign-ins
-- (db/81), and the list's match is the address Google verified. No date: nothing
-- tried, nothing used (no row). A date that agrees with no row of this kind:
-- every open row for those addresses at the school used up, and one row
-- answered with why = 'details_disagree'. A date that agrees: the first
-- such row (by upload), NOT yet used up, with why NULL for a full match or
-- the condition that failed; the caller uses it up with the outcome.
CREATE OR REPLACE FUNCTION family_register_try(p_user uuid, p_school uuid, p_kind text, p_born date, p_request uuid)
RETURNS TABLE (row_id uuid, player_id uuid, uploaded_by uuid, uploaded_at timestamptz, identity_id uuid, why text) AS $$
#variable_conflict use_column
DECLARE
  g        record;
  v_found  boolean := false;
  v_row    uuid; v_player uuid; v_by uuid; v_at timestamptz; v_identity uuid; v_born date;
  v_why    text;
  v_any    boolean := false;
BEGIN
  IF p_user IS NULL OR p_school IS NULL OR p_born IS NULL THEN RETURN; END IF;
  FOR g IN
    SELECT r.id, r.player_id, r.kind, r.uploaded_by, r.uploaded_at, p.born,
           (SELECT x.id FROM auth_identity x
             WHERE x.user_id = p_user AND x.provider = 'google.com' AND x.revoked_at IS NULL AND lower(x.email_at_link) = r.email
             ORDER BY x.linked_at, x.id LIMIT 1) AS identity_id
      FROM family_register r
      LEFT JOIN player p ON p.id = r.player_id AND p.school_id = r.school_id
     WHERE r.school_id = p_school
       AND r.claimed_at IS NULL AND r.withdrawn_at IS NULL AND r.redacted_at IS NULL
       AND r.valid_until >= sa_today()
       AND r.email IN (SELECT lower(x.email_at_link) FROM auth_identity x
                        WHERE x.user_id = p_user AND x.provider = 'google.com' AND x.revoked_at IS NULL AND x.email_at_link IS NOT NULL)
     ORDER BY r.uploaded_at, r.id
       FOR UPDATE OF r
  LOOP
    v_any := true;
    IF NOT v_found AND g.kind = p_kind AND g.player_id IS NOT NULL AND g.born IS NOT NULL AND g.born = p_born THEN
      v_found := true;
      v_row := g.id; v_player := g.player_id; v_by := g.uploaded_by; v_at := g.uploaded_at;
      v_identity := g.identity_id; v_born := g.born;
    END IF;
  END LOOP;
  IF NOT v_any THEN RETURN; END IF;

  IF NOT v_found THEN
    -- One go: a wrong date uses up every open row for the address here.
    UPDATE family_register r
       SET claimed_at = now(), claimed_by = p_user,
           claimed_identity = (SELECT x.id FROM auth_identity x
                                WHERE x.user_id = p_user AND x.provider = 'google.com' AND x.revoked_at IS NULL AND lower(x.email_at_link) = r.email
                                ORDER BY x.linked_at, x.id LIMIT 1),
           claimed_request = p_request, outcome = 'requested', outcome_reason = 'details_disagree'
     WHERE r.school_id = p_school
       AND r.claimed_at IS NULL AND r.withdrawn_at IS NULL AND r.redacted_at IS NULL
       AND r.valid_until >= sa_today()
       AND r.email IN (SELECT lower(x.email_at_link) FROM auth_identity x
                        WHERE x.user_id = p_user AND x.provider = 'google.com' AND x.revoked_at IS NULL AND x.email_at_link IS NOT NULL);
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::uuid, 'details_disagree'::text;
    RETURN;
  END IF;

  -- 4 · The uploader, now.
  IF NOT family_may_link_for(v_by, p_school, p_kind) THEN
    v_why := 'uploader_authority_lapsed';
  -- 5 · The claimant, not paused from asking, nor at the school.
  ELSIF request_cooldown_open(p_user)
     OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_user AND u.active)
     OR EXISTS (SELECT 1 FROM role_assignment a JOIN duty_suspension s ON s.assignment_id = a.id AND s.lifted_at IS NULL
                 WHERE a.person_id = p_user AND a.school_id = p_school AND a.active) THEN
    v_why := 'refused';
  -- A guardian: never a pupil's account; the child still a minor; her own
  -- link to him not ended; not already his.
  ELSIF p_kind = 'guardian' AND (person_is_pupil(p_user) OR majority_on(v_born) <= sa_today()
                                 OR family_link_ended_on(v_player, p_user) IS NOT NULL
                                 OR family_link_live(v_player, p_user)) THEN
    v_why := 'refused';
  -- 6 · A pupil: the boy has no account but this one.
  ELSIF p_kind = 'pupil' AND family_child_has_account(v_player, p_user) THEN
    v_why := 'has_account';
  -- Q1: the school's own yes.
  ELSIF NOT family_list_links_on(p_school) THEN
    v_why := 'not_switched_on';
  END IF;
  RETURN QUERY SELECT v_row, v_player, v_by, v_at, v_identity, v_why;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_try(uuid,uuid,text,date,uuid) FROM PUBLIC;

-- Internal: a row used up, with what came of it.
CREATE OR REPLACE FUNCTION family_register_use(p_row uuid, p_user uuid, p_identity uuid, p_request uuid,
                                               p_outcome text, p_reason text) RETURNS void AS $$
  UPDATE family_register
     SET claimed_at = now(), claimed_by = p_user, claimed_identity = p_identity, claimed_request = p_request,
         outcome = p_outcome, outcome_reason = CASE WHEN p_outcome = 'requested' THEN coalesce(p_reason, 'refused') END
   WHERE id = p_row AND claimed_at IS NULL
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_use(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;


-- ── 6 · The claim, from a request just filed ────────────────────────
-- A parent's `guardian` request, or a pupil's own `player` request (the
-- eighteen-year-old still at school), tried against the list with the date
-- of birth she typed. Called by POST /api/requests right after the INSERT,
-- in the same transaction. Answers one row:
--   linked   a parent: her link is written, verified by the uploader,
--            consent pending (she agrees to the terms before she reads)
--   in       a pupil of eighteen or more by the roster: `player` and his
--            own record, through the same door
--   sent     everything else, whatever the reason: not the caller's
--            request, not waiting, no row, no date, a wrong date, a row the
--            uploader can no longer make, a pupil under eighteen asking for
--            `player`, the school not switched on. Her request waits for the
--            office, as it would have.
-- p_born is compared and dropped: never stored, never logged.
CREATE OR REPLACE FUNCTION family_register_claim(p_request uuid, p_born date)
RETURNS TABLE (outcome text) AS $$
#variable_conflict use_column
DECLARE
  v_me    uuid := app_user_id();
  r       role_request%ROWTYPE;
  t       record;
  v_kind  text;
  v_note  text;
  v_ok    boolean;
  v_asg   uuid;
  v_born  date;
  v_by    text;
  v_who   text;
BEGIN
  IF v_me IS NULL OR app_pad_scoped() OR p_request IS NULL OR p_born IS NULL
     OR NOT EXISTS (SELECT 1 FROM app_user u WHERE u.id = v_me AND u.active) THEN
    RETURN QUERY SELECT 'sent'::text; RETURN;
  END IF;
  -- One claimant at a time, so two requests at once cannot both try.
  PERFORM pg_advisory_xact_lock(hashtextextended('family_register:' || v_me::text, 174));
  SELECT * INTO r FROM role_request q
   WHERE q.id = p_request AND q.person_id = v_me AND q.state = 'pending' AND q.role IN ('guardian', 'player')
     FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'sent'::text; RETURN; END IF;
  v_kind := CASE r.role WHEN 'guardian' THEN 'guardian' ELSE 'pupil' END;

  SELECT * INTO t FROM family_register_try(v_me, r.school_id, v_kind, p_born, p_request) LIMIT 1;
  IF NOT FOUND THEN RETURN QUERY SELECT 'sent'::text; RETURN; END IF;
  IF t.row_id IS NULL THEN RETURN QUERY SELECT 'sent'::text; RETURN; END IF;

  -- A pupil's own `player` request opens a boy of eighteen or more only:
  -- under eighteen, the list recognises him through his claim, never here.
  SELECT p.born INTO v_born FROM player p WHERE p.id = t.player_id;
  IF t.why IS NULL AND v_kind = 'pupil' AND majority_on(v_born) > sa_today() THEN
    t.why := 'refused';
  END IF;

  IF t.why IS NULL THEN
    v_note := format('from the family list, row %s, uploaded %s', t.row_id, to_char(sa_date(t.uploaded_at), 'YYYY-MM-DD'));
    BEGIN
      SELECT d.ok, d.assignment_id INTO v_ok, v_asg FROM role_request_grant_as(p_request, t.uploaded_by, v_note, t.player_id, NULL) d;
      IF v_ok IS NOT TRUE THEN t.why := 'refused'; END IF;
    EXCEPTION WHEN check_violation OR unique_violation OR foreign_key_violation THEN
      t.why := 'refused';
    END;
  END IF;

  IF t.why IS NOT NULL THEN
    PERFORM family_register_use(t.row_id, v_me, t.identity_id, p_request, 'requested', t.why);
    PERFORM family_register_log('family_register.claim', r.school_id, ARRAY[t.row_id]);
    RETURN QUERY SELECT 'sent'::text; RETURN;
  END IF;

  PERFORM family_register_use(t.row_id, v_me, t.identity_id, p_request, 'granted', NULL);
  UPDATE family_register
     SET granted_assignment = v_asg,
         -- A pupil: the door wrote his own record's role beside his `player` one.
         granted_self_assignment = CASE WHEN v_kind = 'pupil' THEN
           (SELECT a.id FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
             WHERE a.person_id = v_me AND a.role = 'selfaccess' AND a.active AND g.player_id = t.player_id
               AND g.relationship = 'self' ORDER BY a.created_at DESC, a.id LIMIT 1) END
   WHERE id = t.row_id;
  PERFORM family_register_log('family_register.claim', r.school_id, ARRAY[t.row_id]);
  -- The office is told, with End link beside the row on the family list.
  SELECT u.name INTO v_by FROM app_user u WHERE u.id = t.uploaded_by;
  SELECT u.name INTO v_who FROM app_user u WHERE u.id = v_me;
  IF v_kind = 'guardian' THEN
    PERFORM family_register_notice(r.school_id, 'Linked from the family list',
      format('%s was linked to %s today, from the row %s uploaded on %s. If this is wrong, end it from the family list.',
             coalesce(v_who, 'A parent'), family_register_child_words(t.player_id), coalesce(v_by, 'the office'),
             to_char(sa_date(t.uploaded_at), 'FMDD FMMonth YYYY')));
    RETURN QUERY SELECT 'linked'::text; RETURN;
  END IF;
  PERFORM family_register_notice(r.school_id, 'Joined from the family list',
    format('%s joined as %s''s own account today, from the row %s uploaded on %s. If this is wrong, end the role on People.',
           coalesce(v_who, 'A pupil'), family_register_child_words(t.player_id), coalesce(v_by, 'the office'),
           to_char(sa_date(t.uploaded_at), 'FMDD FMMonth YYYY')));
  RETURN QUERY SELECT 'in'::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_claim(uuid,date) FROM PUBLIC;


-- ── 7 · His claim (db/168), with the list tried ─────────────────────
-- db/168's pupil_claim_send(), with one block before its last statement:
-- a date typed tries the list's `pupil` rows for his verified address. A
-- full match whose boy is under eighteen by the roster RECOGNISES him
-- (known_how 'family_list', known_by the uploader): it opens nothing; db/169's
-- gate and a guardian's yes still decide that. Anything else uses the row up
-- and leaves his claim with the office. He is answered exactly as before.
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
  -- db/174: the family list, tried with the date he typed (family_register_claim_pupil()).
  PERFORM family_register_claim_pupil(v_me, p_school, p_born);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Internal, called by pupil_claim_send() under its lock, after his claim is
-- written and with the office. Recognises him on a full match under
-- eighteen; uses the row up otherwise. Answers nothing he is told.
CREATE OR REPLACE FUNCTION family_register_claim_pupil(p_user uuid, p_school uuid, p_born date) RETURNS void AS $$
DECLARE t record; v_born date; v_by text; v_claim uuid;
BEGIN
  IF p_user IS NULL OR p_school IS NULL OR p_born IS NULL THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('family_register:' || p_user::text, 174));
  SELECT * INTO t FROM family_register_try(p_user, p_school, 'pupil', p_born, NULL) LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF t.row_id IS NULL THEN RETURN; END IF;
  SELECT p.born INTO v_born FROM player p WHERE p.id = t.player_id;
  SELECT c.id INTO v_claim FROM pupil_claim c WHERE c.user_id = p_user AND c.school_id = p_school AND c.state = 'with_office';
  -- Eighteen or more by the roster: he asks for `player` himself, not here.
  IF t.why IS NULL AND (v_claim IS NULL OR majority_on(v_born) <= sa_today()) THEN
    t.why := 'refused';
  END IF;
  IF t.why IS NOT NULL THEN
    PERFORM family_register_use(t.row_id, p_user, t.identity_id, NULL, 'requested', t.why);
    PERFORM family_register_log('family_register.claim', p_school, ARRAY[t.row_id]);
    RETURN;
  END IF;
  UPDATE pupil_claim
     SET state = 'recognised', player_id = t.player_id, known_how = 'family_list', known_by = t.uploaded_by, known_at = now(),
         decided_at = now(), decided_by = t.uploaded_by
   WHERE id = v_claim;
  PERFORM family_register_use(t.row_id, p_user, t.identity_id, NULL, 'recognised', NULL);
  PERFORM family_register_log('family_register.claim', p_school, ARRAY[t.row_id]);
  PERFORM pupil_claim_log('pupil_claim.recognised', p_school, ARRAY[v_claim]);
  SELECT u.name INTO v_by FROM app_user u WHERE u.id = t.uploaded_by;
  PERFORM family_register_notice(p_school, 'Recognised from the family list',
    format('An account was recognised today as %s''s, from the row %s uploaded on %s. Nothing about him is opened until a parent or guardian says yes. If this is wrong, take it off his record under Pupil claims.',
           family_register_child_words(t.player_id), coalesce(v_by, 'the office'), to_char(sa_date(t.uploaded_at), 'FMDD FMMonth YYYY')));
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_claim_pupil(uuid,uuid,date) FROM PUBLIC;


-- ── 8 · Withdraw, read, clear, the switch's state, the Requests line ──
-- The office of the row's school (guardian.link.manage, never a support
-- hour, a platform-wide key or a pad). "not_permitted" is also the answer
-- for an id that is no row. An open row only: a claimed row's link is
-- ended with End link.
CREATE OR REPLACE FUNCTION family_register_withdraw(p_row uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE g family_register%ROWTYPE;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'::text; RETURN; END IF;
  SELECT * INTO g FROM family_register r WHERE r.id = p_row FOR UPDATE;
  IF NOT FOUND OR app_pad_scoped() OR NOT pupil_claim_office(g.school_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF g.claimed_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_claimed'::text; RETURN; END IF;
  IF g.withdrawn_at IS NOT NULL OR g.redacted_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_withdrawn'::text; RETURN; END IF;
  UPDATE family_register r SET withdrawn_at = now(), withdrawn_by = app_user_id() WHERE r.id = g.id;
  PERFORM family_register_log('family_register.withdraw', g.school_id, ARRAY[g.id]);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_withdraw(uuid) FROM PUBLIC;

-- The family list as the office reads it (design §5.3): each row's child by
-- his roster name (the office's own read), address, kind, claim-by date,
-- uploader and state; for a row that linked, the link's assignment while it
-- is live, for End link. Nobody else: not the claimant, a coach, the DSO by
-- standing, audit.read or a pad. p_state: open · claimed · expired ·
-- withdrawn; NULL is all.
CREATE OR REPLACE FUNCTION family_register_rows(p_school uuid, p_state text DEFAULT NULL)
RETURNS TABLE (id uuid, player_id uuid, player_name text, team_code text, email text, kind text, relationship text,
               valid_until date, state text, uploaded_by_name text, uploaded_at timestamptz, upload_id uuid,
               warned_ended_on date, claimed_at timestamptz, claimed_by_name text, outcome text, outcome_reason text,
               live_assignment uuid, withdrawn_at timestamptz, withdrawn_by_name text, redacted_at timestamptz) AS $$
  SELECT r.id, r.player_id, p.full_name, p.team_code, r.email, r.kind, r.relationship, r.valid_until, s.state,
         ub.name, r.uploaded_at, r.upload_id, r.warned_ended_on, r.claimed_at, cb.name, r.outcome, r.outcome_reason,
         (SELECT a.id FROM role_assignment a WHERE a.id = r.granted_assignment AND r.outcome = 'granted' AND a.active),
         r.withdrawn_at, wb.name, r.redacted_at
    FROM family_register r
    CROSS JOIN LATERAL (SELECT CASE WHEN r.withdrawn_at IS NOT NULL THEN 'withdrawn'
                                    WHEN r.claimed_at   IS NOT NULL THEN 'claimed'
                                    WHEN r.valid_until < sa_today() THEN 'expired'
                                    ELSE 'open' END AS state) s
    -- His roster row at this school only: after a move his old school's
    -- office does not read his name and team at the new one.
    LEFT JOIN player p ON p.id = r.player_id AND p.school_id = r.school_id
    LEFT JOIN app_user ub ON ub.id = r.uploaded_by
    LEFT JOIN app_user cb ON cb.id = r.claimed_by
    LEFT JOIN app_user wb ON wb.id = r.withdrawn_by
   WHERE r.school_id = p_school
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND pupil_claim_office(p_school)
     AND (p_state IS NULL OR s.state = p_state)
   ORDER BY r.uploaded_at DESC, p.full_name, r.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_rows(uuid,text) FROM PUBLIC;

-- Unclaimed rows ninety days past their date or their withdrawal, not yet
-- cleared (P2-D13). The office's, at that school.
CREATE OR REPLACE FUNCTION family_register_redact_due(p_school uuid)
RETURNS TABLE (id uuid, player_id uuid, email text, kind text, valid_until date, withdrawn_at timestamptz, due_on date) AS $$
  SELECT r.id, r.player_id, r.email, r.kind, r.valid_until, r.withdrawn_at, d.due_on
    FROM family_register r
    CROSS JOIN LATERAL (SELECT CASE WHEN r.withdrawn_at IS NOT NULL THEN (sa_date(r.withdrawn_at) + 90)
                                    ELSE r.valid_until + 90 END AS due_on) d
   WHERE r.school_id = p_school AND r.claimed_at IS NULL AND r.redacted_at IS NULL
     AND d.due_on <= sa_today()
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND pupil_claim_office(p_school)
   ORDER BY d.due_on, r.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_redact_due(uuid) FROM PUBLIC;

-- "Clear N expired rows": the address goes; the child, the kind, who listed
-- it and the dates stay, so the record of what the office listed survives
-- without the address. A person presses it; nothing runs unattended.
CREATE OR REPLACE FUNCTION family_register_redact(p_school uuid) RETURNS integer AS $$
DECLARE v_ids uuid[];
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped() OR p_school IS NULL OR NOT pupil_claim_office(p_school) THEN
    RAISE EXCEPTION 'not_permitted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH done AS (
    UPDATE family_register r
       SET email = 'redacted+' || r.id::text || '@redacted.invalid', redacted_at = now()
     WHERE r.id IN (SELECT d.id FROM family_register_redact_due(p_school) d)
    RETURNING r.id)
  SELECT coalesce(array_agg(id ORDER BY id), '{}') INTO v_ids FROM done;
  IF cardinality(v_ids) > 0 THEN
    PERFORM family_register_log('family_register.redact', p_school, v_ids);
  END IF;
  RETURN cardinality(v_ids);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_redact(uuid) FROM PUBLIC;

-- Is the switch on here? The office's, for the list's heading (whether a
-- match links at once or waits in Requests). NULL for anybody else.
CREATE OR REPLACE FUNCTION family_register_status(p_school uuid) RETURNS TABLE (links_at_once boolean) AS $$
  SELECT family_list_links_on(p_school)
   WHERE app_user_id() IS NOT NULL AND NOT app_pad_scoped() AND pupil_claim_office(p_school)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_status(uuid) FROM PUBLIC;

-- The office's line on a request the list did not link, or whose list-made
-- link the office ended (§8b) (design §5.3): why,
-- as a code the screen words. Never the date she typed (it is nowhere);
-- never to the person who asked, nor to anybody but the office of the
-- request's school; NULL for a request the list did not touch.
CREATE OR REPLACE FUNCTION family_register_line(p_request uuid) RETURNS text AS $$
  SELECT CASE WHEN r.outcome = 'granted' THEN 'link_ended'
              WHEN r.outcome_reason = 'details_disagree' THEN 'details_disagree'
              WHEN r.outcome_reason = 'uploader_authority_lapsed' THEN 'uploader_lapsed'
              WHEN r.outcome_reason = 'not_switched_on' THEN 'details_agree'
              WHEN r.outcome_reason = 'has_account' THEN 'has_account'
              ELSE 'refused' END
    FROM family_register r JOIN role_request q ON q.id = r.claimed_request
   WHERE r.claimed_request = p_request
     -- A request the list did not link; or one it linked whose link the office ended (§8b), back in the queue.
     AND (r.outcome = 'requested' OR (r.outcome = 'granted' AND r.kind = 'guardian' AND q.state = 'pending'))
     AND app_user_id() IS NOT NULL AND q.person_id <> app_user_id()
     AND NOT app_pad_scoped() AND pupil_claim_office(q.school_id)
   ORDER BY (r.outcome_reason = 'details_disagree'), r.claimed_at DESC, r.id
   LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_line(uuid) FROM PUBLIC;


-- ── 8b · Ending a link the list made (Kameel, 25 Nov 2026) ──────────
-- "Yes: a link the list made may always be ended by the office; the family
-- goes back to the office's queue to be linked by hand." db/08's last-link
-- rule keeps every other link. "List-made" is asked per child: the row's
-- child and the assignment its grant wrote (granted_assignment). The grant
-- door writes a new assignment for every request it grants (db/92, as
-- db/169 left it: one INSERT INTO role_assignment per grant), and §149
-- (perchild) holds the rule when another child sits on the same assignment
-- all the same. Ending a list-made guardian link reopens the request it was
-- granted on, pending and with no child chosen, so it waits in Requests for
-- a person to decide; the office's line says why (family_register_line()
-- 'link_ended'). Ending a pupil's list-made `player` role ends his own
-- record's role (`selfaccess`) with it. Nothing of the date she typed is
-- anywhere to bring back.

-- Was this child's link on this assignment granted by the family list?
CREATE OR REPLACE FUNCTION family_register_made(p_assignment uuid, p_player uuid) RETURNS boolean AS $$
  SELECT p_assignment IS NOT NULL AND p_player IS NOT NULL AND EXISTS (
    SELECT 1 FROM family_register r
     WHERE r.outcome = 'granted' AND r.kind = 'guardian'
       AND r.granted_assignment = p_assignment AND r.player_id = p_player)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_made(uuid,uuid) FROM PUBLIC;

-- Internal: the requests the list granted on this assignment (for this
-- child, or for every child when p_player is NULL) go back to the queue. A
-- request of hers already waiting there is left as it is.
CREATE OR REPLACE FUNCTION family_register_requeue(p_assignment uuid, p_player uuid) RETURNS void AS $$
BEGIN
  BEGIN
    UPDATE role_request q
       SET state = 'pending', decided_by = NULL, decided_at = NULL, decided_note = NULL,
           assignment_id = NULL, player_id = NULL
     WHERE q.id IN (SELECT r.claimed_request FROM family_register r
                     WHERE r.outcome = 'granted' AND r.kind = 'guardian' AND r.granted_assignment = p_assignment
                       AND (p_player IS NULL OR r.player_id = p_player))
       AND q.assignment_id = p_assignment AND q.role = 'guardian' AND q.state = 'granted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_requeue(uuid,uuid) FROM PUBLIC;

-- Internal, called by role_assignment_end() once an assignment has ended:
-- a list-made guardian link's requests requeue; a list-made pupil's own
-- record's role ends with his `player` role, through the same door, with
-- the same reason.
CREATE OR REPLACE FUNCTION family_register_after_end(p_assignment uuid, p_reason text) RETURNS void AS $$
DECLARE v_self uuid;
BEGIN
  PERFORM family_register_requeue(p_assignment, NULL);
  FOR v_self IN
    SELECT r.granted_self_assignment FROM family_register r JOIN role_assignment a ON a.id = r.granted_self_assignment
     WHERE r.outcome = 'granted' AND r.kind = 'pupil' AND r.granted_assignment = p_assignment AND a.active
  LOOP
    PERFORM 1 FROM role_assignment_end(v_self, p_reason);
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION family_register_after_end(uuid,text) FROM PUBLIC;

-- The two doors that end a link, re-emitted from their bodies in place,
-- each md5-guarded over the body before it (as db/128 and the files after
-- it left them) or this file's own, and checked in §11 to differ by exactly
-- these edits. role_assignment_end() (db/77): its last-link query leaves out
-- a child whose link the list made, and every ending is handed to
-- family_register_after_end(). guardian_link_revoke() (db/109, the office's
-- other way of ending a link): its last-link test leaves out a list-made
-- link, and a revoke requeues that child's request.
DROP TABLE IF EXISTS _db174_edits;
CREATE TEMP TABLE _db174_edits (fn text, was_md5 text, mine_md5 text, a text, a2 text, b text, b2 text);
INSERT INTO _db174_edits VALUES
  ('role_assignment_end(uuid,text)', '3ea136016eb3607d6c6e07c66c8fefba', 'd168ec7fe5d37f81a751673c7fa83075',
   '       AND s.is_minor AND s.live_links <= 1' || chr(10) || '     LIMIT 1;',
   '       AND s.is_minor AND s.live_links <= 1' || chr(10)
     || '       -- db/174: a link the family list made may always be ended (Kameel, 25 Nov 2026).' || chr(10)
     || '       AND NOT family_register_made(a.id, g.player_id)' || chr(10) || '     LIMIT 1;',
   '  RETURN QUERY SELECT true, NULL::text;' || chr(10) || 'END',
   '  -- db/174: a list-made link''s family back to Requests; a list-made pupil''s own record with him.' || chr(10)
     || '  PERFORM family_register_after_end(a.id, v_why);' || chr(10)
     || '  RETURN QUERY SELECT true, NULL::text;' || chr(10) || 'END'),
  ('guardian_link_revoke(uuid,text,text)', 'a5d51d1d63d288560a5ce9532f64bac8', 'aa238fc2a451a4ad36e36a6c17c87c69',
   '     AND coalesce(v_minor, true) AND coalesce(v_live, 0) <= 1 THEN',
   '     AND coalesce(v_minor, true) AND coalesce(v_live, 0) <= 1' || chr(10)
     || '     -- db/174: a link the family list made may always be ended (Kameel, 25 Nov 2026).' || chr(10)
     || '     AND NOT family_register_made(g.assignment_id, g.player_id) THEN',
   '  RETURN QUERY SELECT true, NULL::text;' || chr(10) || 'END',
   '  -- db/174: a list-made link''s family back to Requests, to be linked by hand.' || chr(10)
     || '  PERFORM family_register_requeue(g.assignment_id, g.player_id);' || chr(10)
     || '  RETURN QUERY SELECT true, NULL::text;' || chr(10) || 'END');
DO $edits$
DECLARE e record; v_src text; v_def text;
BEGIN
  FOR e IN SELECT * FROM _db174_edits LOOP
    v_src := (SELECT prosrc FROM pg_proc WHERE oid = e.fn::regprocedure);
    CONTINUE WHEN md5(v_src) = e.mine_md5;   -- a second paste
    IF md5(v_src) IS DISTINCT FROM e.was_md5 THEN
      RAISE EXCEPTION 'db/174: % is neither the body before this file nor this file''s (md5 %); factor the version now in place and move its hash', e.fn, md5(v_src);
    END IF;
    IF (length(v_src) - length(replace(v_src, e.a, ''))) / length(e.a) <> 1
       OR (length(v_src) - length(replace(v_src, e.b, ''))) / length(e.b) <> 1 THEN
      RAISE EXCEPTION 'db/174: % does not hold its last-link test and its last RETURN once each', e.fn;
    END IF;
    v_def := replace(replace(pg_get_functiondef(e.fn::regprocedure), e.a, e.a2), e.b, e.b2);
    EXECUTE v_def;
  END LOOP;
END $edits$;


-- ── 9 · Q11: a declined pupil claim tells the DSO ──────────────────
-- db/168's pupil_claim_decline() tells the school's DSOs when the office
-- declines a pupil's claim. The other door a person claims to be a pupil
-- through is his own `player` request (the eighteen-year-old still at
-- school, D6's exception). Declined, it sends the same no-name notice
-- (db/93's declined_claim_notice()): not the account, not what he typed,
-- not the boy. No cooldown: db/93's rule counts parent claims.
CREATE OR REPLACE FUNCTION role_request_player_declined_notice() RETURNS trigger AS $$
BEGIN
  PERFORM declined_claim_notice(NEW.school_id, 'A pupil claim was declined',
    'A request from an account saying it belongs to a pupil at your school was declined by the office on '
      || to_char(sa_date(coalesce(NEW.decided_at, now())), 'FMDD FMMonth YYYY')
      || '. The office can tell you who asked. If anything about it concerns you, raise a concern.');
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION role_request_player_declined_notice() FROM PUBLIC;

DROP TRIGGER IF EXISTS role_request_player_declined_notice ON role_request;
CREATE TRIGGER role_request_player_declined_notice
  AFTER UPDATE OF state ON role_request
  FOR EACH ROW
  WHEN (NEW.state = 'declined' AND OLD.state IS DISTINCT FROM 'declined' AND NEW.role = 'player')
  EXECUTE FUNCTION role_request_player_declined_notice();


-- ── 10 · Who may call what ─────────────────────────────────────────
DO $grants$
DECLARE
  f text; r text;
  v_doors text[] := ARRAY['family_register_upload(uuid,jsonb,boolean,uuid[])', 'family_register_claim(uuid,date)',
                          'family_register_withdraw(uuid)', 'family_register_rows(uuid,text)',
                          'family_register_redact_due(uuid)', 'family_register_redact(uuid)',
                          'family_register_status(uuid)', 'family_register_line(uuid)',
                          'pupil_claim_send(uuid,text,text,date)'];
  v_internal text[] := ARRAY['family_list_links_on(uuid)', 'family_register_log(text,uuid,uuid[])', 'family_register_role(text)',
                             'family_may_link_for(uuid,uuid,text)', 'family_child_has_account(uuid,uuid)',
                             'family_address_accounts(text)', 'family_link_ended_on(uuid,uuid)', 'family_link_live(uuid,uuid)',
                             'family_register_child_words(uuid)', 'family_register_notice(uuid,text,text)',
                             'family_register_try(uuid,uuid,text,date,uuid)',
                             'family_register_use(uuid,uuid,uuid,uuid,text,text)',
                             'family_register_claim_pupil(uuid,uuid,date)', 'role_request_player_declined_notice()',
                             'family_register_made(uuid,uuid)', 'family_register_requeue(uuid,uuid)',
                             'family_register_after_end(uuid,text)'];
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
      EXECUTE format('REVOKE ALL ON family_register FROM %I', r);
      FOREACH f IN ARRAY v_doors || v_internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f::regprocedure, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── 11 · What this file promised, checked in the same paste ────────
-- The behaviour is asserted live in db/99 §149 and walked through the API
-- by tools/smoke-family-register.mjs.
DO $check$
DECLARE f text; v text; w text; v_old text; v_new text;
  v_block text := '  -- db/174: the family list, tried with the date he typed (family_register_claim_pupil()).' || chr(10)
               || '  PERFORM family_register_claim_pupil(v_me, p_school, p_born);' || chr(10);
BEGIN
  -- The table: under RLS, no policy, no privilege for anybody but its owner.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'family_register'::regclass) THEN
    RAISE EXCEPTION 'db/174: family_register is not under row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'family_register') THEN
    RAISE EXCEPTION 'db/174: family_register has a policy; it is read and written through functions only';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
              WHERE c.oid = 'family_register'::regclass AND x.grantee <> c.relowner) THEN
    RAISE EXCEPTION 'db/174: family_register is granted to somebody other than its owner';
  END IF;
  -- No date of birth, by any name, on the list (Q2).
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'family_register'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                AND (a.atttypid = 'date'::regtype AND a.attname NOT IN ('valid_until', 'warned_ended_on') OR a.attname ~ 'born|birth|dob')) THEN
    RAISE EXCEPTION 'db/174: family_register holds a date other than its claim window and the warning it acknowledged';
  END IF;
  -- The staff register still names no child (db/92's no_child_role).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'school_register'::regclass AND conname = 'no_child_role'
                    AND pg_get_constraintdef(oid) ~ 'guardian' AND pg_get_constraintdef(oid) ~ 'selfaccess'
                    AND pg_get_constraintdef(oid) ~ 'player') THEN
    RAISE EXCEPTION 'db/174: school_register''s no_child_role is gone or narrowed';
  END IF;
  -- pupil_claim_send(): db/168's text with this file's one block, and
  -- nothing else (checked on a first paste, while db/168's is known).
  v_new := (SELECT prosrc FROM pg_proc WHERE oid = 'pupil_claim_send(uuid,text,text,date)'::regprocedure);
  IF position(v_block IN v_new) = 0 OR md5(replace(v_new, v_block, '')) IS DISTINCT FROM '026263290b4c3ebba66bbfe172c2a1d3' THEN
    RAISE EXCEPTION 'db/174: pupil_claim_send() is not db/168''s with the family list''s one block';
  END IF;
  -- role_assignment_end() and guardian_link_revoke(): each the body before
  -- this file with §8b's two edits, and nothing else.
  FOR f, v, w IN SELECT e.fn, e.was_md5, md5(replace(replace((SELECT prosrc FROM pg_proc WHERE oid = e.fn::regprocedure), e.a2, e.a), e.b2, e.b))
                   FROM _db174_edits e LOOP
    IF w IS DISTINCT FROM v THEN
      RAISE EXCEPTION 'db/174: % is not the body before this file with §8b''s two edits', f;
    END IF;
  END LOOP;
  -- ONE DOOR (db/92 §8, "one door, two callers", as it stands now): the
  -- office's decision, the staff register, the pupil's yes (db/169) and
  -- the family list. Nothing else names it.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO f
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname <> 'role_request_grant_as'
     AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'role_request_grant_as\s*\(';
  IF f IS DISTINCT FROM 'decide_role_request(uuid,boolean,text,uuid,text), family_register_claim(uuid,date), '
                        'pupil_signin_after_yes(uuid,text), register_claim(uuid)' THEN
    RAISE EXCEPTION 'db/174: role_request_grant_as() is called by %, not by decide_role_request(), family_register_claim(), pupil_signin_after_yes() and register_claim() alone', f;
  END IF;
  IF has_function_privilege('scrbrd_app', 'role_request_grant_as(uuid,uuid,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/174: the application may call role_request_grant_as()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'role_request'::regclass
                    AND tgname = 'role_request_player_declined_notice' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/174: the trigger role_request_player_declined_notice is missing or disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feature_flag WHERE key = 'family_list_links' AND NOT enabled) THEN
    RAISE EXCEPTION 'db/174: the family_list_links switch is missing, or on by default';
  END IF;
  FOR f IN SELECT unnest(ARRAY['family_register_upload(uuid,jsonb,boolean,uuid[])', 'family_register_claim(uuid,date)',
                               'family_register_withdraw(uuid)', 'family_register_rows(uuid,text)',
                               'family_register_redact_due(uuid)', 'family_register_redact(uuid)',
                               'family_register_status(uuid)', 'family_register_line(uuid)',
                               'pupil_claim_send(uuid,text,text,date)',
                               'family_list_links_on(uuid)', 'family_register_log(text,uuid,uuid[])', 'family_register_role(text)',
                               'family_may_link_for(uuid,uuid,text)', 'family_child_has_account(uuid,uuid)',
                               'family_address_accounts(text)', 'family_link_ended_on(uuid,uuid)', 'family_link_live(uuid,uuid)',
                               'family_register_child_words(uuid)', 'family_register_notice(uuid,text,text)',
                               'family_register_try(uuid,uuid,text,date,uuid)',
                               'family_register_use(uuid,uuid,uuid,uuid,text,text)',
                               'family_register_claim_pupil(uuid,uuid,date)', 'role_request_player_declined_notice()',
                               'family_register_made(uuid,uuid)', 'family_register_requeue(uuid,uuid)',
                               'family_register_after_end(uuid,text)']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/174: % does not pin its search_path', f;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/174: % is not a definer', f;
    END IF;
    SELECT coalesce(string_agg(coalesce(nullif(x.grantee, 0)::regrole::text, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY x.grantee::regrole::text), '')
      INTO v FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
     WHERE p.oid = f::regprocedure AND x.grantee <> p.proowner;
    w := CASE WHEN f IN ('family_register_upload(uuid,jsonb,boolean,uuid[])', 'family_register_claim(uuid,date)',
                         'family_register_withdraw(uuid)', 'family_register_rows(uuid,text)',
                         'family_register_redact_due(uuid)', 'family_register_redact(uuid)',
                         'family_register_status(uuid)', 'family_register_line(uuid)',
                         'pupil_claim_send(uuid,text,text,date)')
              THEN 'scrbrd_app:EXECUTE' ELSE '' END;
    IF v IS DISTINCT FROM w THEN
      RAISE EXCEPTION 'db/174: % is granted %', f, coalesce(nullif(v, ''), 'to nobody');
    END IF;
  END LOOP;
END $check$;


-- ── 12 · The lock limit back as it was ──────────────────────────────
RESET lock_timeout;
