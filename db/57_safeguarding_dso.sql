-- ══════════════════════════════════════════════════════════════════
--  57 · Safeguarding, phase 1: the DSO and the concern record
-- ══════════════════════════════════════════════════════════════════
--
-- CSA's Safeguarding Policy (Against Harassment and Abuse in Cricket, 2025)
-- asks every club and school for a Designated Safeguarding Officer (p15–17),
-- a way for anyone to raise a concern with that officer (p18, p53), and a
-- record of it that nobody else reads by standing (p52 item 5, p63). This is
-- docs/design/SAFEGUARDING_DSO.md §9.1, phase 1, as decided (§10; and
-- docs/policy/CSA_SAFEGUARDING_CHECK.md §5). Suspension, the DSO register,
-- referral to the provincial and national DSOs, purge, the DSO-removal notice
-- period, trips and media are later phases and are not here.
--
-- WHAT THIS FILE MAKES
--
--   1. The `dso` role, holding four capabilities nobody else holds —
--      safeguarding.concern.read, .concern.manage, .suspend, .authorise —
--      and the existing ones a DSO's job needs at the institution. Appointed
--      by the principal (and, as the recovery path, the platform). The
--      owner's key does NOT hold safeguarding.* (roles.mjs, decided Q9).
--      A `dso` assignment always names an institution and never a team.
--   2. Raising a concern: safeguarding_concern_raise(), open to anybody
--      signed in, with no capability — a capability lives in bundles, and a
--      bundle that forgot it would be a pupil who cannot report.
--   3. Routing (§3.2): the school's DSOs hold it; a concern about the
--      school's leadership also tells the union's DSOs (a notice, never the
--      record — SG-5); a concern about the DSO, or at a school with no DSO,
--      is held by the union's DSOs (or the federation's). With nobody
--      anywhere it is still written, held at the school and marked unheld,
--      and the reporter is told to use The Guardian's app as well.
--   4. The record: safeguarding_concern, _reporter (who raised it, apart),
--      _note (append-only; the account is written once) and _share
--      (need-to-know, to a named person, for named parts, until a date).
--   5. Who reads it, in layers on every one of those tables:
--        permissive   app_can('safeguarding.concern.read') at the HOLDING
--                     institution, with no team and no fixture — so a DSO
--                     reads his own institution's and no other's;
--        RESTRICTIVE  not under a support session at that institution;
--        RESTRICTIVE  not by anybody holding a platform-wide assignment —
--                     the owner's key, a platform administrator — whatever
--                     else they hold;
--        RESTRICTIVE  never by the adult the concern names.
--      And access_log gains a RESTRICTIVE policy hiding every row whose
--      resource starts `safeguarding` from anybody who is not such a
--      reader, and from a reader the concern names: the principal, the
--      office and the platform keep audit.read and see no row that says a
--      concern exists (§4.3).
--   6. The doors: every read of the record goes through a SECURITY DEFINER
--      function that applies the same layers and writes access_log —
--      safeguarding_inbox(), _concern_open(), _family(), _share_open().
--   7. Telling the DSO: one nameless notice per holding institution, gated
--      on the capability (to each OTHER DSO by name, when the one it names is
--      a DSO there); and notification.recipient_id, with the RESTRICTIVE
--      policy SCRBRD-110 §3.4 planned, for the notice that a share was made.
--      A recipient_id never names a pupil unless the notice is the system's
--      own (SG-9). A safeguarding notice is written by these functions only:
--      the publish route cannot insert one or edit one. Not pushed to a
--      phone: no system-written notice in the product is, yet.
--   8. support_access_begin() refuses a role carrying safeguarding.*.
--   9. dso_appointment_guard(): a DSO's appointment is ended (or dated out,
--      or expired) only by somebody who may appoint one — the principal, or
--      the platform as the recovery path — and not while a concern about the
--      school's leadership or its DSO is open that names the person ending
--      it, or names nobody; the provincial or national DSO over the school
--      may always end it, through safeguarding_dso_end(). Its refusal's words
--      are generic until phase 5's notice period (decided Q1).
--  10. The clearance requirements for `dso` that db/56 could not add before
--      the role existed: the three checks, the SAC, the acknowledgement and
--      DSO training.
--
-- WHERE THIS DIFFERS FROM THE DESIGN'S LETTER, and why
--
--   - The permissive policy passes NULL, not ANY, for team and fixture. The
--     design wrote app_can(…, tenant_id, '*', nil, nil); with the nil UUID
--     for fixture, a fixture-scoped (tour) DSO would pass and read every
--     concern at the school — the opposite of §2.1's "a tour DSO reads
--     nothing else". NULL narrows: only an institution-wide DSO reads.
--   - A fourth RESTRICTIVE cut, the named adult, beside the design's two.
--     Principle 2 says the person a concern is about never reads it; routing
--     does that for a named DSO, and this does it for everyone else too.
--   - dso_contacts() answers for the caller's OWN institutions only, not any
--     school id a caller names.
--   - my_safeguarding_shares() and safeguarding_share_revoke() are added:
--     the recipient of a share has to be able to find it, and "closes on
--     revocation" needs a revocation. safeguarding_note(), _assign() and
--     safeguarding_dso_end() are the design's "notes", "assign" and "the
--     PDSO may end it", which §9.1 names as acts but not as functions.
--   - The office may not end a DSO's appointment. The revoke policy (db/01)
--     admits user.role.assign at the school for any role; the design's guard
--     named only the principal, and the principal could otherwise have asked
--     the office to do it.
--   - With nobody above, a concern about a school's DSO is held at the school
--     by its other DSOs, marked unheld, and the one it names is told nothing:
--     not in a notice, not in the log.
--
-- search_path is pinned on every function below (db/16). Every function the
-- application calls is granted to scrbrd_app only, and taken back from
-- PUBLIC and from a managed host's API roles. Safe to run twice.


-- ── 1 · The capabilities, the role and who appoints it ─────────────
-- Capabilities the model gained after db/01 shipped (ADDED_SINCE_01) and a
-- role it gained after (ROLES_ADDED_SINCE_01), so the catalogue rows, the
-- bundle and the appointers are all here, as db/47 and db/27 did.
INSERT INTO capability (name) VALUES ('safeguarding.concern.read') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('safeguarding.concern.manage') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('safeguarding.suspend') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('safeguarding.authorise') ON CONFLICT (name) DO NOTHING;

INSERT INTO role_capability (role, capability) VALUES
  ('dso', 'safeguarding.concern.read'),
  ('dso', 'safeguarding.concern.manage'),
  ('dso', 'safeguarding.suspend'),
  ('dso', 'safeguarding.authorise'),
  ('dso', 'clearance.read'),
  ('dso', 'clearance.manage'),
  ('dso', 'audit.read'),
  ('dso', 'player.public.withhold'),
  ('dso', 'school.read'),
  ('dso', 'user.read'),
  ('dso', 'team.read'),
  ('dso', 'fixture.read'),
  ('dso', 'news.read'),
  ('dso', 'transport.read'),
  ('dso', 'player.profile.read')
ON CONFLICT DO NOTHING;

-- The masterkey's carve-out. db/01 never granted these (they are not in it),
-- so on any database this deletes nothing; it is here so that the rule is
-- stated where the rows live.
DELETE FROM role_capability WHERE role <> 'dso' AND capability LIKE 'safeguarding.%';

INSERT INTO role_grantable (granter, role) VALUES
  ('principal',     'dso'),
  ('platformadmin', 'dso'),
  ('superadmin',    'dso')
ON CONFLICT DO NOTHING;


-- ── 2 · Institutions above a school ────────────────────────────────
-- A PDSO is a `dso` at the `union` tenant of the school's province; the NDSO
-- a `dso` at the `federation` tenant. One union per province, and one
-- federation (decided Q4): a second would make "the union's DSOs" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS school_one_union_per_province
  ON school (lower(btrim(province))) WHERE kind = 'union';
CREATE UNIQUE INDEX IF NOT EXISTS school_one_federation
  ON school (kind) WHERE kind = 'federation';

-- The one federation, or NULL.
CREATE OR REPLACE FUNCTION school_federation() RETURNS uuid AS $$
  SELECT f.id FROM school f WHERE f.kind = 'federation' AND f.archived_at IS NULL LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION school_federation() FROM PUBLIC;

-- The institution above this one (§2.4): a school's union by province, else
-- the federation; a union's federation; a federation's nothing.
CREATE OR REPLACE FUNCTION school_union(p_school uuid) RETURNS uuid AS $$
  SELECT CASE s.kind
           WHEN 'federation' THEN NULL
           WHEN 'union' THEN school_federation()
           ELSE coalesce((SELECT u.id FROM school u
                           WHERE u.kind = 'union' AND u.archived_at IS NULL
                             AND s.province IS NOT NULL
                             AND lower(btrim(u.province)) = lower(btrim(s.province))),
                         school_federation())
         END
    FROM school s WHERE s.id = p_school
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION school_union(uuid) FROM PUBLIC;


-- ── 3 · A DSO belongs to one institution, whole ────────────────────
-- There is no platform-wide DSO: the recovery path (platformadmin may grant
-- any role) must not be able to mint one. And no team-scoped DSO: a DSO
-- holds the institution's concerns, all of them, or none.
CREATE OR REPLACE FUNCTION dso_assignment_scoped() RETURNS trigger AS $$
BEGIN
  IF NEW.role = 'dso' THEN
    IF NEW.school_id IS NULL THEN
      RAISE EXCEPTION 'a DSO belongs to one institution: a dso assignment must name a school'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.team_code IS NOT NULL THEN
      RAISE EXCEPTION 'a DSO holds the whole institution''s concerns: a dso assignment names no team'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dso_assignment_scoped() FROM PUBLIC;
DROP TRIGGER IF EXISTS role_assignment_dso_scoped ON role_assignment;
CREATE TRIGGER role_assignment_dso_scoped BEFORE INSERT OR UPDATE OF role, school_id, team_code
  ON role_assignment FOR EACH ROW EXECUTE FUNCTION dso_assignment_scoped();


-- ── 4 · Who reads, decided in one place ────────────────────────────
-- The two cuts (§4.2): no support session at that institution, and nobody
-- holding a platform-wide assignment. Both are false for the owner's key and
-- a platform administrator whatever capability rows they hold.
CREATE OR REPLACE FUNCTION safeguarding_uncut(p_tenant uuid) RETURNS boolean AS $$
  SELECT app_support_access_id(p_tenant) IS NULL AND NOT app_is_platform_wide()
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_uncut(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_uncut(uuid) TO scrbrd_app;

-- A reader of the concerns held at this institution: the capability there,
-- held through an assignment naming no team and no fixture, and neither cut.
CREATE OR REPLACE FUNCTION safeguarding_reader(p_tenant uuid) RETURNS boolean AS $$
  SELECT app_can('safeguarding.concern.read', p_tenant, NULL::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
     AND safeguarding_uncut(p_tenant)
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_reader(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_reader(uuid) TO scrbrd_app;

-- The same, for working one.
CREATE OR REPLACE FUNCTION safeguarding_manager(p_tenant uuid) RETURNS boolean AS $$
  SELECT app_can('safeguarding.concern.manage', p_tenant, NULL::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
     AND safeguarding_uncut(p_tenant)
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_manager(uuid) TO scrbrd_app;

-- Upward authority (§2.4): the capability held at the institution ABOVE this
-- one — its union or the federation — never at the school itself. Used by
-- the acts a provincial DSO may perform on a school (in phase 1, ending a
-- DSO's appointment), never by a read policy: upward authority does not
-- become upward reading.
CREATE OR REPLACE FUNCTION safeguarding_upward(p_capability text, p_school uuid) RETURNS boolean AS $$
DECLARE
  v_up  uuid := school_union(p_school);
  v_fed uuid := school_federation();
BEGIN
  IF p_capability IS NULL OR p_capability NOT LIKE 'safeguarding.%' THEN RETURN false; END IF;
  RETURN (v_up IS NOT NULL AND v_up <> p_school
          AND app_can(p_capability, v_up, NULL::text, '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
          AND safeguarding_uncut(v_up))
      OR (v_fed IS NOT NULL AND v_fed <> p_school AND v_fed IS DISTINCT FROM v_up
          AND app_can(p_capability, v_fed, NULL::text, '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
          AND safeguarding_uncut(v_fed));
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_upward(text, uuid) FROM PUBLIC;

-- The design's safeguarding_authority() (§2.4): at the school, at its union
-- or at the federation. Only ever answers for a safeguarding capability.
CREATE OR REPLACE FUNCTION safeguarding_authority(p_capability text, p_school uuid) RETURNS boolean AS $$
  SELECT p_capability LIKE 'safeguarding.%'
     AND ((app_can(p_capability, p_school, NULL::text, '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
           AND safeguarding_uncut(p_school))
          OR safeguarding_upward(p_capability, p_school))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_authority(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_authority(text, uuid) TO scrbrd_app;

-- The live DSOs at an institution, by the liveness app_can() applies (active,
-- dated, not expired, not suspended), institution-wide, with an active
-- account. Internal: names DSOs to routing and to dso_contacts().
CREATE OR REPLACE FUNCTION dso_people_at(p_tenant uuid)
RETURNS TABLE (person_id uuid, name text) AS $$
  SELECT DISTINCT u.id, u.name
    FROM role_assignment a
    JOIN app_user u ON u.id = a.person_id AND u.active
   WHERE a.role = 'dso' AND a.school_id = p_tenant
     AND a.team_code IS NULL AND a.fixture_id IS NULL
     AND a.active
     AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
     AND (a.valid_until IS NULL OR a.valid_until >  current_date)
     AND (a.expires_at  IS NULL OR a.expires_at  >  now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dso_people_at(uuid) FROM PUBLIC;

-- Does this person hold a live assignment at this institution, in any role
-- (or in one of these)? The same liveness.
CREATE OR REPLACE FUNCTION person_live_at(p_person uuid, p_school uuid, p_roles text[] DEFAULT NULL)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.person_id = p_person AND a.school_id = p_school
       AND (p_roles IS NULL OR a.role = ANY (p_roles))
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at  IS NULL OR a.expires_at  >  now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION person_live_at(uuid, uuid, text[]) FROM PUBLIC;

-- A pupil, for SG-9: an account that IS a player, or holds a live player or
-- selfaccess assignment anywhere.
CREATE OR REPLACE FUNCTION person_is_pupil(p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.person_id = p_person AND a.role IN ('player', 'selfaccess') AND a.active
                    AND (a.valid_until IS NULL OR a.valid_until > current_date))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION person_is_pupil(uuid) FROM PUBLIC;


-- ── 5 · The concern record ─────────────────────────────────────────
-- Hand-written, like db/25 and db/47: the generator's permissive policies
-- are the wrong tool for a record that is mostly about who may NOT read it.
-- Never a disciplinary_record (principle 1): discipline.read reaches a
-- competition administrator across every school.
CREATE TABLE IF NOT EXISTS safeguarding_concern (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the reporter keeps: SG-XXXX-YYYY. Nothing else leaves the record.
  reference         text NOT NULL UNIQUE CHECK (reference ~ '^SG-[0-9A-Z]{4}-[0-9]{4}$'),
  -- Whose DSOs hold it (§3.2). Every read policy keys on this.
  tenant_id         uuid NOT NULL REFERENCES school(id),
  -- The institution it concerns. Differs from tenant_id when it is held above.
  school_id         uuid NOT NULL REFERENCES school(id),
  raised_at         timestamptz NOT NULL DEFAULT now(),
  about_kind        text NOT NULL CHECK (about_kind IN ('child', 'adult', 'leadership', 'dso', 'unknown')),
  subject_player_id uuid REFERENCES player(id) ON DELETE SET NULL,
  subject_person_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  subject_text      text CHECK (subject_text IS NULL OR length(subject_text) BETWEEN 1 AND 500),
  -- Annexure A's list.
  nature            text[] NOT NULL CHECK (nature <@ '{psychological,physical,sexual_harassment,sexual_abuse,neglect,bullying,other}'::text[]
                                           AND cardinality(nature) > 0),
  -- p68: a suspicion, or abuse recognised.
  certainty         text NOT NULL CHECK (certainty IN ('suspicion', 'recognised')),
  occurred_on       date,
  occurred_where    text CHECK (occurred_where IS NULL OR length(occurred_where) BETWEEN 1 AND 200),
  -- Written once, by the reporter (principle 7). A correction is a note.
  account           text NOT NULL CHECK (length(btrim(account)) >= 20 AND length(account) <= 8000),
  authorities_told  text CHECK (authorities_told IS NULL OR length(authorities_told) BETWEEN 1 AND 500),
  assigned_to       uuid REFERENCES app_user(id),
  -- Set by the DSO at close; drives retention (p64).
  position_of_trust boolean NOT NULL DEFAULT false,
  -- Nobody who could properly hold it when it was raised (§3.2): no DSO at
  -- the school or above it, or a concern about a DSO with nobody above. The
  -- reporter is told to use The Guardian's app as well.
  unheld            boolean NOT NULL DEFAULT false,
  state             text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  closed_at         timestamptz,
  closed_by         uuid REFERENCES app_user(id),
  outcome           text CHECK (outcome IN ('no_action', 'supported', 'referred_saps',
                      'referred_social_development', 'disciplinary_enquiry', 'handed_to_union', 'other')),
  retain_until      date,
  CONSTRAINT safeguarding_concern_closes_whole CHECK (
        (state = 'open') = (closed_at IS NULL)
    AND (closed_at IS NULL) = (closed_by IS NULL)
    AND (closed_at IS NULL) = (outcome IS NULL)
    AND (closed_at IS NULL) = (retain_until IS NULL))
);
CREATE INDEX IF NOT EXISTS safeguarding_concern_tenant_idx ON safeguarding_concern (tenant_id, raised_at DESC);
CREATE INDEX IF NOT EXISTS safeguarding_concern_school_open_idx ON safeguarding_concern (school_id) WHERE state = 'open';

-- p63: who raised it is apart from what was raised, and read by the holding
-- institution's DSOs only — never inside a share, a note or a notice.
CREATE TABLE IF NOT EXISTS safeguarding_concern_reporter (
  concern_id  uuid PRIMARY KEY REFERENCES safeguarding_concern(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES school(id),
  reporter_id uuid NOT NULL REFERENCES app_user(id),
  -- p66. 'anonymous_app' is a report The Guardian's app passed on, recorded
  -- by a DSO; it runs on a 72-hour clock (p53).
  how_learned text NOT NULL CHECK (how_learned IN ('witness', 'told', 'victim', 'anonymous_app', 'other')),
  -- "The DSO may tell others that it was me" — no by default (p63).
  named_ok    boolean NOT NULL DEFAULT false,
  device_id   text
);
CREATE INDEX IF NOT EXISTS safeguarding_concern_reporter_idx ON safeguarding_concern_reporter (reporter_id);

-- Append-only: the actions log. Written by the functions below; never edited.
CREATE TABLE IF NOT EXISTS safeguarding_concern_note (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concern_id uuid NOT NULL REFERENCES safeguarding_concern(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES school(id),
  kind       text NOT NULL CHECK (kind IN ('raised', 'note', 'assigned', 'family_contacted', 'saps_contacted',
               'guardian_contacted', 'social_development_contacted', 'ndso_informed', 'shared', 'share_revoked',
               'suspended', 'suspension_lifted', 'referred', 'position_of_trust_set', 'closed', 'reopened')),
  body       text CHECK (body IS NULL OR length(body) <= 4000),
  written_by uuid NOT NULL REFERENCES app_user(id),
  written_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safeguarding_concern_note_idx ON safeguarding_concern_note (concern_id, written_at);

-- Need-to-know (§4.4). `what` has no word for the reporter: there is no way
-- to share who reported (p63).
CREATE TABLE IF NOT EXISTS safeguarding_share (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concern_id     uuid NOT NULL REFERENCES safeguarding_concern(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES school(id),
  shared_by      uuid NOT NULL REFERENCES app_user(id),
  shared_at      timestamptz NOT NULL DEFAULT now(),
  with_person_id uuid NOT NULL REFERENCES app_user(id),
  -- A verified guardian link of the child, when the person is his parent.
  with_link_id   uuid,
  what           text[] NOT NULL CHECK (what <@ '{summary,child,account,actions}'::text[] AND cardinality(what) > 0),
  open_until     timestamptz NOT NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 10 AND length(reason) <= 500),
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES app_user(id),
  CONSTRAINT safeguarding_share_window CHECK (open_until > shared_at AND open_until <= shared_at + interval '30 days'),
  CONSTRAINT safeguarding_share_revoke_whole CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX IF NOT EXISTS safeguarding_share_person_idx ON safeguarding_share (with_person_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS safeguarding_share_concern_idx ON safeguarding_share (concern_id);

-- ── The record's own rules, as triggers ──
-- The account and everything the reporter wrote are fixed. Only the state of
-- the case moves: assigned, closed.
CREATE OR REPLACE FUNCTION safeguarding_concern_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
  OR NEW.school_id IS DISTINCT FROM OLD.school_id OR NEW.raised_at IS DISTINCT FROM OLD.raised_at
  OR NEW.about_kind IS DISTINCT FROM OLD.about_kind
  OR NEW.subject_player_id IS DISTINCT FROM OLD.subject_player_id
  OR NEW.subject_person_id IS DISTINCT FROM OLD.subject_person_id
  OR NEW.subject_text IS DISTINCT FROM OLD.subject_text OR NEW.nature IS DISTINCT FROM OLD.nature
  OR NEW.certainty IS DISTINCT FROM OLD.certainty OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on
  OR NEW.occurred_where IS DISTINCT FROM OLD.occurred_where OR NEW.account IS DISTINCT FROM OLD.account
  OR NEW.authorities_told IS DISTINCT FROM OLD.authorities_told OR NEW.unheld IS DISTINCT FROM OLD.unheld THEN
    RAISE EXCEPTION 'a safeguarding concern is written once; a correction is a note'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'closed' AND NEW.state = 'closed'
     AND (NEW.closed_at, NEW.closed_by, NEW.outcome, NEW.retain_until, NEW.position_of_trust)
         IS DISTINCT FROM (OLD.closed_at, OLD.closed_by, OLD.outcome, OLD.retain_until, OLD.position_of_trust) THEN
    RAISE EXCEPTION 'a closed concern''s close is not edited' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_concern_fixed() FROM PUBLIC;
DROP TRIGGER IF EXISTS safeguarding_concern_fixed ON safeguarding_concern;
CREATE TRIGGER safeguarding_concern_fixed BEFORE UPDATE ON safeguarding_concern
  FOR EACH ROW EXECUTE FUNCTION safeguarding_concern_fixed();

-- A child row carries its concern's holding institution, derived, never
-- supplied; and who wrote it is the session's person, never supplied
-- (disciplinary_record_author()'s shape, db/25).
CREATE OR REPLACE FUNCTION safeguarding_child_stamp() RETURNS trigger AS $$
BEGIN
  NEW.tenant_id := (SELECT c.tenant_id FROM safeguarding_concern c WHERE c.id = NEW.concern_id);
  IF TG_TABLE_NAME = 'safeguarding_concern_note' THEN
    NEW.written_by := coalesce(app_user_id(), NEW.written_by);
    NEW.written_at := now();
  ELSIF TG_TABLE_NAME = 'safeguarding_concern_reporter' THEN
    NEW.reporter_id := coalesce(app_user_id(), NEW.reporter_id);
  ELSIF TG_TABLE_NAME = 'safeguarding_share' THEN
    NEW.shared_by := coalesce(app_user_id(), NEW.shared_by);
    NEW.revoked_at := NULL;
    NEW.revoked_by := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_child_stamp() FROM PUBLIC;
DROP TRIGGER IF EXISTS safeguarding_note_stamp ON safeguarding_concern_note;
CREATE TRIGGER safeguarding_note_stamp BEFORE INSERT ON safeguarding_concern_note
  FOR EACH ROW EXECUTE FUNCTION safeguarding_child_stamp();
DROP TRIGGER IF EXISTS safeguarding_reporter_stamp ON safeguarding_concern_reporter;
CREATE TRIGGER safeguarding_reporter_stamp BEFORE INSERT ON safeguarding_concern_reporter
  FOR EACH ROW EXECUTE FUNCTION safeguarding_child_stamp();
DROP TRIGGER IF EXISTS safeguarding_share_stamp ON safeguarding_share;
CREATE TRIGGER safeguarding_share_stamp BEFORE INSERT ON safeguarding_share
  FOR EACH ROW EXECUTE FUNCTION safeguarding_child_stamp();

-- Notes and the reporter row are never edited. A share changes once: revoked.
CREATE OR REPLACE FUNCTION safeguarding_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'safeguarding_share' THEN
    IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
       AND (NEW.id, NEW.concern_id, NEW.tenant_id, NEW.shared_by, NEW.shared_at, NEW.with_person_id,
            NEW.with_link_id, NEW.what, NEW.open_until, NEW.reason)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.concern_id, OLD.tenant_id, OLD.shared_by, OLD.shared_at, OLD.with_person_id,
            OLD.with_link_id, OLD.what, OLD.open_until, OLD.reason) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a share is made, and revoked; it is not edited' USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_append_only() FROM PUBLIC;
DROP TRIGGER IF EXISTS safeguarding_note_append_only ON safeguarding_concern_note;
CREATE TRIGGER safeguarding_note_append_only BEFORE UPDATE ON safeguarding_concern_note
  FOR EACH ROW EXECUTE FUNCTION safeguarding_append_only();
DROP TRIGGER IF EXISTS safeguarding_reporter_append_only ON safeguarding_concern_reporter;
CREATE TRIGGER safeguarding_reporter_append_only BEFORE UPDATE ON safeguarding_concern_reporter
  FOR EACH ROW EXECUTE FUNCTION safeguarding_append_only();
DROP TRIGGER IF EXISTS safeguarding_share_append_only ON safeguarding_share;
CREATE TRIGGER safeguarding_share_append_only BEFORE UPDATE ON safeguarding_share
  FOR EACH ROW EXECUTE FUNCTION safeguarding_append_only();

-- The application reads (under the policies below) and writes nothing: the
-- only doors are the functions in §8. Two layers, as db/06 does for
-- role_capability: no write privilege, and no write policy.
GRANT SELECT ON safeguarding_concern, safeguarding_concern_reporter,
                safeguarding_concern_note, safeguarding_share TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON safeguarding_concern, safeguarding_concern_reporter,
                safeguarding_concern_note, safeguarding_share FROM scrbrd_app;

-- Is the caller the adult this concern names? SECURITY DEFINER so a policy on
-- a child table can ask without depending on what else the caller reads.
CREATE OR REPLACE FUNCTION safeguarding_names_me(p_concern uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM safeguarding_concern c
                  WHERE c.id = p_concern AND c.subject_person_id = app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_names_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_names_me(uuid) TO scrbrd_app;


-- ── 6 · The four layers, on every table of the record ──────────────
DO $policies$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['safeguarding_concern', 'safeguarding_concern_reporter',
                           'safeguarding_concern_note', 'safeguarding_share'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_no_support', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_not_platform', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_not_named', t);
    -- 1. Permissive: a DSO of the HOLDING institution, institution-wide. NULL
    --    for team and fixture narrows: a team- or fixture-scoped assignment
    --    reads nothing here.
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT USING (
        app_can('safeguarding.concern.read', %I.tenant_id, NULL::text,
                '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid))$p$, t || '_read', t, t);
    -- 2. RESTRICTIVE: never under a support session at that institution.
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (
        app_support_access_id(%I.tenant_id) IS NULL)$p$, t || '_no_support', t, t);
    -- 3. RESTRICTIVE: never by anybody holding a platform-wide assignment.
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (
        NOT app_is_platform_wide())$p$, t || '_not_platform', t);
    -- 4. RESTRICTIVE: never by the adult the concern names.
    IF t = 'safeguarding_concern' THEN
      EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (
          subject_person_id IS DISTINCT FROM app_user_id())$p$, t || '_not_named', t);
    ELSE
      EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (
          NOT safeguarding_names_me(%I.concern_id))$p$, t || '_not_named', t, t);
    END IF;
    -- db/50: a pad resume credential reads none of it.
    PERFORM pad_scope_guard_install(t::regclass);
  END LOOP;
END $policies$;


-- ── 7 · The audit log does not say a concern exists (§4.3) ──────────
-- access_log_read (db/08) admits audit.read at the row's school. This cuts
-- every row whose resource starts `safeguarding` to the readers of that
-- institution's concerns. Every safeguarding function logs under the HOLDING
-- institution, so the principal, the office, the director of sport and the
-- platform — all audit.read holders — see no such row, and a DSO sees his.
--
-- And never a row about a concern that names the reader: a DSO named in a
-- concern his colleague holds (only when nobody above could hold it) would
-- otherwise read, on the log, that it was raised and by whom. The row's ids
-- are concerns (a raise, an open, the family, the inbox) or shares.
CREATE OR REPLACE FUNCTION safeguarding_log_names_me(p_ids uuid[]) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM safeguarding_concern c
                  WHERE c.subject_person_id = app_user_id()
                    AND (c.id = ANY (p_ids)
                         OR c.id IN (SELECT sh.concern_id FROM safeguarding_share sh WHERE sh.id = ANY (p_ids))))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_log_names_me(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_log_names_me(uuid[]) TO scrbrd_app;

DROP POLICY IF EXISTS access_log_safeguarding_hidden ON access_log;
CREATE POLICY access_log_safeguarding_hidden ON access_log AS RESTRICTIVE
  FOR SELECT USING (resource NOT LIKE 'safeguarding%'
                    OR (safeguarding_reader(access_log.school_id) AND NOT safeguarding_log_names_me(access_log.record_ids)));


-- ── 8 · Notices: to one person, and never to a pupil in private ─────
-- SCRBRD-110 §3.4 planned recipient_id in exactly this shape; whichever
-- design landed first adds it, and this one did. A notice with a recipient
-- reaches that person only, on top of every other gate it carries.
ALTER TABLE notification ADD COLUMN IF NOT EXISTS recipient_id uuid REFERENCES app_user(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notification_recipient_idx ON notification (recipient_id) WHERE recipient_id IS NOT NULL;
COMMENT ON COLUMN notification.recipient_id IS
  'One person this notice is for, or NULL for everyone its policy admits. RESTRICTIVE notification_recipient_only (db/57). Never a pupil unless kind = ''system'' (SG-9).';

DROP POLICY IF EXISTS notification_recipient_only ON notification;
CREATE POLICY notification_recipient_only ON notification AS RESTRICTIVE
  FOR SELECT USING (recipient_id IS NULL OR recipient_id = app_user_id());

-- A safeguarding notice is the system's, written by the functions below and
-- by nobody through the publish route: an office cannot forge one to a DSO,
-- nor edit one into a broadcast. And neither cut reads one.
DROP POLICY IF EXISTS notification_safeguarding_uncut ON notification;
CREATE POLICY notification_safeguarding_uncut ON notification AS RESTRICTIVE
  FOR SELECT USING (kind <> 'safeguarding' OR safeguarding_uncut(notification.school_id));
DROP POLICY IF EXISTS notification_safeguarding_insert ON notification;
CREATE POLICY notification_safeguarding_insert ON notification AS RESTRICTIVE
  FOR INSERT WITH CHECK (kind <> 'safeguarding');
DROP POLICY IF EXISTS notification_safeguarding_update ON notification;
CREATE POLICY notification_safeguarding_update ON notification AS RESTRICTIVE
  FOR UPDATE USING (kind <> 'safeguarding') WITH CHECK (kind <> 'safeguarding');

-- SG-9, the part enforceable today: a private notice to a pupil is refused
-- unless it is the system's own.
CREATE OR REPLACE FUNCTION notification_recipient_not_pupil() RETURNS trigger AS $$
BEGIN
  IF NEW.recipient_id IS NOT NULL AND NEW.kind IS DISTINCT FROM 'system'
     AND person_is_pupil(NEW.recipient_id) THEN
    RAISE EXCEPTION 'a notice addressed to one pupil must be the system''s own (SG-9)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_recipient_not_pupil() FROM PUBLIC;
DROP TRIGGER IF EXISTS notification_recipient_not_pupil ON notification;
CREATE TRIGGER notification_recipient_not_pupil BEFORE INSERT OR UPDATE OF recipient_id, kind ON notification
  FOR EACH ROW EXECUTE FUNCTION notification_recipient_not_pupil();


-- ── 9 · Support may not borrow a DSO ───────────────────────────────
-- db/22's function, verbatim, with one refusal added after the subject-scoped
-- one: a role carrying any safeguarding.* capability is not supportable.
-- (The tables' RESTRICTIVE cuts would hide the record from such a session
-- anyway; this stops the session being issued at all.) Same signature, so
-- its grants stand.
CREATE OR REPLACE FUNCTION support_access_begin(
  p_school  uuid,
  p_role    text,
  p_reason  text,
  p_team    text    DEFAULT NULL,
  p_minutes integer DEFAULT 60
) RETURNS TABLE (ok boolean, reason text, id uuid, expires_at timestamptz) AS $$
DECLARE
  v_actor   uuid := app_user_id();
  v_until   timestamptz;
  v_assign  uuid;
  v_id      uuid;
BEGIN
  IF v_actor IS NULL OR NOT app_holds('platform.support.impersonate') THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM school s WHERE s.id = p_school) THEN
    RETURN QUERY SELECT false, 'school_unknown', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM role_capability rc WHERE rc.role = p_role) THEN
    RETURN QUERY SELECT false, 'role_unknown', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  -- A platform role at a school is a contradiction app_may_grant() already
  -- refuses; support is FOR reaching one school as one of its own roles.
  -- superadmin is caught here too: it carries every platform capability.
  IF EXISTS (SELECT 1 FROM role_capability rc
               JOIN capability c ON c.name = rc.capability AND c.platform_only
              WHERE rc.role = p_role) THEN
    RETURN QUERY SELECT false, 'role_not_supportable', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  -- The roles that only mean anything ABOUT SOMEBODY (SUBJECT_SCOPED_ROLES in
  -- packages/policy; the same list app_can() names). Support reaches a school
  -- the way its office does, never the way a parent does.
  IF p_role = ANY (ARRAY['guardian', 'selfaccess', 'enquiry']) THEN
    RETURN QUERY SELECT false, 'role_needs_subject', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  -- db/57: no support read of a safeguarding concern (decided Q9). The DSO is
  -- not a role support may take into a school.
  IF EXISTS (SELECT 1 FROM role_capability rc
              WHERE rc.role = p_role AND rc.capability LIKE 'safeguarding.%') THEN
    RETURN QUERY SELECT false, 'role_not_supportable', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RETURN QUERY SELECT false, 'reason_required', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  -- An hour by default; four at most. Longer than that is not a support
  -- session, it is an appointment, and those are made by the school.
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 240 THEN
    RETURN QUERY SELECT false, 'minutes_out_of_range', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM support_access s JOIN role_assignment a ON a.id = s.assignment_id
              WHERE s.actor_id = v_actor AND s.school_id = p_school AND s.role = p_role
                AND s.ended_at IS NULL AND a.active AND a.expires_at > now()) THEN
    RETURN QUERY SELECT false, 'already_live', NULL::uuid, NULL::timestamptz; RETURN;
  END IF;

  v_until := now() + make_interval(mins => p_minutes);
  -- A real assignment, stamped by the same trigger as any appointment
  -- (created_by = the support person). The team-scoped CHECK still applies:
  -- a coach must name a side, and a request that does not is refused by the
  -- constraint rather than second-guessed here.
  INSERT INTO role_assignment (person_id, role, school_id, team_code, active, valid_from, expires_at)
  VALUES (v_actor, p_role, p_school, p_team, true, current_date, v_until)
  RETURNING role_assignment.id INTO v_assign;
  INSERT INTO support_access (actor_id, school_id, role, team_code, reason, assignment_id, device_id, expires_at)
  VALUES (v_actor, p_school, p_role, p_team, btrim(p_reason), v_assign, app_device_id(), v_until)
  RETURNING support_access.id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, v_id, v_until;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 10 · Ending a DSO's appointment ────────────────────────────────
-- The decided rule (§2.3, check §5 Q5): a principal cannot remove a DSO while
-- a concern naming the principal is open. Read broadly, because the record
-- may not name anybody: an open concern about the school's leadership or its
-- DSO — held at the school, or above it about the school — that names the
-- person ending it, or names nobody, refuses the end. "The end" is any change
-- that could make the assignment stop granting: active, its dates, an hour
-- hand, a fixture. The provincial or national DSO over the school may end it
-- (safeguarding_dso_end() below). The refusal leaks one bit, that something
-- blocks; phase 5's notice period removes it (decided Q1), and until then the
-- words are the same whatever the reason.
CREATE OR REPLACE FUNCTION dso_appointment_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.role <> 'dso' OR app_user_id() IS NULL THEN RETURN NEW; END IF;
  IF (NEW.active, NEW.valid_from, NEW.valid_until, NEW.expires_at, NEW.fixture_id, NEW.season)
     IS NOT DISTINCT FROM
     (OLD.active, OLD.valid_from, OLD.valid_until, OLD.expires_at, OLD.fixture_id, OLD.season) THEN
    RETURN NEW;
  END IF;
  -- Who appoints a DSO is who may end one (the principal; the platform as the
  -- recovery path), or the DSO above. The office holds user.role.assign at
  -- the school, which the revoke policy (db/01) is satisfied by for any role
  -- — but the office may not appoint a DSO, and so may not end one either.
  IF NOT (app_may_grant('dso') OR safeguarding_upward('safeguarding.concern.manage', OLD.school_id)) THEN
    RAISE EXCEPTION 'This appointment cannot be ended from here. Ask the provincial DSO.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM safeguarding_concern c
              WHERE c.state = 'open' AND c.school_id = OLD.school_id
                AND c.about_kind IN ('leadership', 'dso')
                AND (c.subject_person_id IS NULL OR c.subject_person_id = app_user_id()))
     AND NOT safeguarding_upward('safeguarding.concern.manage', OLD.school_id) THEN
    RAISE EXCEPTION 'This appointment cannot be ended from here. Ask the provincial DSO.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dso_appointment_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS role_assignment_dso_guard ON role_assignment;
CREATE TRIGGER role_assignment_dso_guard BEFORE UPDATE ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION dso_appointment_guard();

-- The provincial or national DSO ends a school's DSO appointment. Upward
-- authority only: a DSO at the school itself cannot, and neither can the
-- platform. Answers rather than raises.
CREATE OR REPLACE FUNCTION safeguarding_dso_end(p_assignment uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  a role_assignment%ROWTYPE;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  SELECT * INTO a FROM role_assignment r WHERE r.id = p_assignment;
  IF NOT FOUND OR a.role <> 'dso'
     OR NOT safeguarding_upward('safeguarding.concern.manage', a.school_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF NOT a.active THEN RETURN QUERY SELECT true, 'already_ended'; RETURN; END IF;
  UPDATE role_assignment SET active = false WHERE role_assignment.id = p_assignment;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_dso_end(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_dso_end(uuid) TO scrbrd_app;


-- ── 11 · Routing (§3.2) ────────────────────────────────────────────
-- Internal. Which institution holds a concern about this school, what it is
-- about once the subject's own appointments are read, which institution is
-- told as well (leadership: the one above, by a notice), and whether nobody
-- could hold it. A subject who holds `dso` at the school makes it a concern
-- about the DSO whatever the reporter ticked; one who holds principal,
-- directorofsport, schooladmin or sportsadmin there makes it leadership.
-- The subject is never counted as a DSO who could hold it.
CREATE OR REPLACE FUNCTION safeguarding_route(p_school uuid, p_about_kind text, p_subject_person uuid)
RETURNS TABLE (tenant_id uuid, about_kind text, tell_tenant uuid, unheld boolean) AS $$
DECLARE
  v_kind   text := p_about_kind;
  v_here   boolean;
  v_union  uuid := school_union(p_school);
  v_fed    uuid := school_federation();
  v_up     uuid;
BEGIN
  IF p_subject_person IS NOT NULL THEN
    IF person_live_at(p_subject_person, p_school, ARRAY['dso']) THEN
      v_kind := 'dso';
    ELSIF v_kind <> 'dso'
      AND person_live_at(p_subject_person, p_school,
                         ARRAY['principal', 'directorofsport', 'schooladmin', 'sportsadmin']) THEN
      v_kind := 'leadership';
    END IF;
  END IF;
  v_here := EXISTS (SELECT 1 FROM dso_people_at(p_school) d
                     WHERE d.person_id IS DISTINCT FROM p_subject_person);
  IF v_union IS NOT NULL AND v_union <> p_school
     AND EXISTS (SELECT 1 FROM dso_people_at(v_union) d WHERE d.person_id IS DISTINCT FROM p_subject_person) THEN
    v_up := v_union;
  ELSIF v_fed IS NOT NULL AND v_fed <> p_school
     AND EXISTS (SELECT 1 FROM dso_people_at(v_fed) d WHERE d.person_id IS DISTINCT FROM p_subject_person) THEN
    v_up := v_fed;
  END IF;

  IF v_kind = 'dso' OR NOT v_here THEN
    IF v_up IS NOT NULL THEN
      RETURN QUERY SELECT v_up, v_kind, NULL::uuid, false;
    ELSE
      -- Nobody above: written anyway, held at the school, and unheld unless
      -- a DSO there who is not its subject can hold it.
      RETURN QUERY SELECT p_school, v_kind, NULL::uuid, (v_kind = 'dso' OR NOT v_here);
    END IF;
  ELSE
    RETURN QUERY SELECT p_school, v_kind, CASE WHEN v_kind = 'leadership' THEN v_up END, false;
  END IF;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_route(uuid, text, uuid) FROM PUBLIC;


-- ── 12 · Raising a concern (§3.1) ──────────────────────────────────
-- Anybody signed in, at an institution where they hold a live assignment (a
-- guardian's is his child's school). A child is named only if the reporter
-- can already see him — so the form cannot enumerate children — and an adult
-- only if he holds a live assignment there. The reporter gets back a
-- reference and the time, and nothing more, ever.
CREATE OR REPLACE FUNCTION safeguarding_concern_raise(
  p_school           uuid,
  p_about_kind       text,
  p_nature           text[],
  p_certainty        text,
  p_account          text,
  p_how_learned      text,
  p_subject_player   uuid    DEFAULT NULL,
  p_subject_person   uuid    DEFAULT NULL,
  p_subject_text     text    DEFAULT NULL,
  p_occurred_on      date    DEFAULT NULL,
  p_occurred_where   text    DEFAULT NULL,
  p_authorities_told text    DEFAULT NULL,
  p_named_ok         boolean DEFAULT false,
  p_preferred_dso    uuid    DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text, reference text, raised_at timestamptz, unheld boolean) AS $$
DECLARE
  v_me      uuid := app_user_id();
  v_nature  text[];
  v_route   record;
  v_player  player%ROWTYPE;
  v_id      uuid;
  v_ref     text;
  v_at      timestamptz;
  v_assign  uuid;
  v_alpha   text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  i         integer;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_signed_in', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_school IS NULL OR NOT person_live_at(v_me, p_school) THEN
    RETURN QUERY SELECT false, 'not_your_school', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_about_kind IS NULL OR p_about_kind NOT IN ('child', 'adult', 'leadership', 'dso', 'unknown') THEN
    RETURN QUERY SELECT false, 'about_kind_invalid', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_nature FROM unnest(coalesce(p_nature, '{}')) x WHERE x IS NOT NULL;
  IF v_nature IS NULL OR NOT (v_nature <@ '{psychological,physical,sexual_harassment,sexual_abuse,neglect,bullying,other}'::text[]) THEN
    RETURN QUERY SELECT false, 'nature_invalid', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_certainty IS NULL OR p_certainty NOT IN ('suspicion', 'recognised') THEN
    RETURN QUERY SELECT false, 'certainty_invalid', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_account IS NULL OR length(btrim(p_account)) < 20 OR length(p_account) > 8000 THEN
    RETURN QUERY SELECT false, 'account_length', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_how_learned IS NULL OR p_how_learned NOT IN ('witness', 'told', 'victim', 'anonymous_app', 'other') THEN
    RETURN QUERY SELECT false, 'how_learned_invalid', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  -- A report The Guardian's app passed on is recorded by a DSO (§3.4).
  IF p_how_learned = 'anonymous_app' AND NOT safeguarding_authority('safeguarding.concern.manage', p_school) THEN
    RETURN QUERY SELECT false, 'anonymous_app_is_recorded_by_a_dso', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF (p_subject_text IS NOT NULL AND length(btrim(p_subject_text)) > 500)
  OR (p_occurred_where IS NOT NULL AND length(btrim(p_occurred_where)) > 200)
  OR (p_authorities_told IS NOT NULL AND length(btrim(p_authorities_told)) > 500) THEN
    RETURN QUERY SELECT false, 'too_long', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_occurred_on IS NOT NULL AND p_occurred_on > sa_today() THEN
    RETURN QUERY SELECT false, 'occurred_in_future', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  -- The child: at this school, and one the reporter can already see — the
  -- player read policy's own two arms (db/09 player_read), asked as him. The
  -- same answer whether the id exists or not.
  IF p_subject_player IS NOT NULL THEN
    SELECT * INTO v_player FROM player p WHERE p.id = p_subject_player;
    IF NOT FOUND OR v_player.school_id <> p_school
       OR NOT (app_can('player.profile.read', v_player.school_id, v_player.team_code, v_player.id,
                       '00000000-0000-0000-0000-000000000000'::uuid)
               OR app_can('player.roster.read', v_player.school_id, '*'::text,
                          '00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid)) THEN
      RETURN QUERY SELECT false, 'child_not_visible', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
    END IF;
  END IF;
  -- The adult: somebody who holds a live appointment at this school.
  IF p_subject_person IS NOT NULL AND NOT person_live_at(p_subject_person, p_school) THEN
    RETURN QUERY SELECT false, 'subject_unknown', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;

  SELECT * INTO v_route FROM safeguarding_route(p_school, p_about_kind, p_subject_person);

  -- The reference: four characters nobody misreads, and the year.
  LOOP
    v_ref := 'SG-';
    FOR i IN 1..4 LOOP
      v_ref := v_ref || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
    v_ref := v_ref || '-' || to_char(sa_today(), 'YYYY');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM safeguarding_concern c WHERE c.reference = v_ref);
  END LOOP;

  -- A preferred DSO sets who is working it, never who reads it; one who does
  -- not hold it is ignored rather than refused, which would say who does.
  IF p_preferred_dso IS NOT NULL
     AND EXISTS (SELECT 1 FROM dso_people_at(v_route.tenant_id) d
                  WHERE d.person_id = p_preferred_dso AND d.person_id IS DISTINCT FROM p_subject_person) THEN
    v_assign := p_preferred_dso;
  END IF;

  INSERT INTO safeguarding_concern (reference, tenant_id, school_id, about_kind, subject_player_id,
                                    subject_person_id, subject_text, nature, certainty, occurred_on,
                                    occurred_where, account, authorities_told, assigned_to, unheld)
  VALUES (v_ref, v_route.tenant_id, p_school, v_route.about_kind, p_subject_player, p_subject_person,
          nullif(btrim(p_subject_text), ''), v_nature, p_certainty, p_occurred_on,
          nullif(btrim(p_occurred_where), ''), btrim(p_account), nullif(btrim(p_authorities_told), ''),
          v_assign, v_route.unheld)
  RETURNING safeguarding_concern.id, safeguarding_concern.raised_at INTO v_id, v_at;
  INSERT INTO safeguarding_concern_reporter (concern_id, tenant_id, reporter_id, how_learned, named_ok, device_id)
  VALUES (v_id, v_route.tenant_id, v_me, p_how_learned, coalesce(p_named_ok, false), app_device_id());
  INSERT INTO safeguarding_concern_note (concern_id, tenant_id, kind, written_by)
  VALUES (v_id, v_route.tenant_id, 'raised', v_me);

  -- The notice (§3.3): at the holding institution, gated on the capability,
  -- naming nobody. Its publisher is left empty: the notice is the system's.
  -- When the adult it names is himself a DSO there — only when nobody above
  -- could hold it — the notice goes to each of the OTHER DSOs by name
  -- (recipient_id) instead, so the person it is about is not told that
  -- something was raised.
  --
  -- In the app, not on a lock screen: no system-written notice in this
  -- product is pushed yet (fanOut() pushes only what its caller may publish),
  -- and the reporter is not handed the notices' ids to push with.
  IF p_subject_person IS NOT NULL
     AND EXISTS (SELECT 1 FROM dso_people_at(v_route.tenant_id) d WHERE d.person_id = p_subject_person) THEN
    INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability, recipient_id)
    SELECT v_route.tenant_id, 'school', 'safeguarding', 'high', 'A safeguarding concern has been raised',
           'Open SCRBRD to read it. You have 24 hours to inform the NDSO if it is child abuse.',
           'safeguarding.concern.read', d.person_id
      FROM dso_people_at(v_route.tenant_id) d WHERE d.person_id <> p_subject_person;
  ELSE
    INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability)
    VALUES (v_route.tenant_id, 'school', 'safeguarding', 'high', 'A safeguarding concern has been raised',
            'Open SCRBRD to read it. You have 24 hours to inform the NDSO if it is child abuse.',
            'safeguarding.concern.read');
  END IF;
  -- Leadership: the institution above is told that one exists, and where.
  -- Never the record: nothing on the platform lets a union read the account
  -- (SG-5); the referral with p27's four facts is phase 5.
  IF v_route.tell_tenant IS NOT NULL THEN
    INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability)
    VALUES (v_route.tell_tenant, 'school', 'safeguarding', 'high', 'A concern about a school''s leadership',
            format('A concern about the leadership of %s has been raised with the school''s DSO. Contact the school''s DSO.',
                   (SELECT s.name FROM school s WHERE s.id = p_school)),
            'safeguarding.concern.read');
  END IF;

  -- The raise itself is on the log, filed under the holding institution, so
  -- only its DSOs can see that it happened.
  PERFORM log_restricted_read('safeguarding_concern_raise', ARRAY[v_id], '{}'::text[], v_route.tenant_id);

  RETURN QUERY SELECT true, NULL::text, v_ref, v_at, v_route.unheld;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_concern_raise(uuid, text, text[], text, text, text, uuid, uuid, text, date, text, text, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_concern_raise(uuid, text, text[], text, text, text, uuid, uuid, text, date, text, text, boolean, uuid) TO scrbrd_app;


-- ── 13 · The reporter's receipt (§3.5) ─────────────────────────────
-- His own references and when, and nothing else: not the state, not who has
-- it, not whether it was read (SG-2).
CREATE OR REPLACE FUNCTION my_concern_receipts()
RETURNS TABLE (reference text, raised_at timestamptz) AS $$
  SELECT c.reference, c.raised_at
    FROM safeguarding_concern c
    JOIN safeguarding_concern_reporter r ON r.concern_id = c.id
   WHERE r.reporter_id = app_user_id()
   ORDER BY c.raised_at DESC
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION my_concern_receipts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_concern_receipts() TO scrbrd_app;


-- ── 14 · Who the DSOs are (§2.5) ───────────────────────────────────
-- For each of the caller's own institutions: its live DSOs by name; or, with
-- none, the union's (or the federation's), marked so; or one row saying
-- nobody. Only the caller's own institutions — a DSO's name is for the
-- people at his school, not for any id somebody types.
CREATE OR REPLACE FUNCTION dso_contacts(p_school uuid DEFAULT NULL)
RETURNS TABLE (school_id uuid, school_name text, person_id uuid, name text, held_at text) AS $$
DECLARE
  s      record;
  v_up   uuid;
  v_kind text;
BEGIN
  IF app_user_id() IS NULL THEN RETURN; END IF;
  FOR s IN SELECT DISTINCT sc.id, sc.name FROM school sc
            WHERE (p_school IS NULL OR sc.id = p_school)
              AND person_live_at(app_user_id(), sc.id)
            ORDER BY sc.name LOOP
    IF EXISTS (SELECT 1 FROM dso_people_at(s.id)) THEN
      RETURN QUERY SELECT s.id, s.name, d.person_id, d.name, 'school'::text FROM dso_people_at(s.id) d ORDER BY d.name;
    ELSE
      v_up := school_union(s.id);
      IF v_up IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dso_people_at(v_up)) THEN
        v_up := CASE WHEN school_federation() IS DISTINCT FROM s.id
                      AND EXISTS (SELECT 1 FROM dso_people_at(school_federation())) THEN school_federation() END;
      END IF;
      IF v_up IS NOT NULL THEN
        v_kind := (SELECT CASE sc.kind WHEN 'federation' THEN 'federation' ELSE 'union' END FROM school sc WHERE sc.id = v_up);
        RETURN QUERY SELECT s.id, s.name, d.person_id, d.name, v_kind FROM dso_people_at(v_up) d ORDER BY d.name;
      ELSE
        RETURN QUERY SELECT s.id, s.name, NULL::uuid, NULL::text, 'none'::text;
      END IF;
    END IF;
  END LOOP;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION dso_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dso_contacts(uuid) TO scrbrd_app;


-- ── 15 · The clocks (§3.4) ─────────────────────────────────────────
-- 24 hours from the raise to the NDSO (p27); 72 for a report that came
-- through The Guardian's app (p53). A clock stops when the concern closes or
-- a DSO records that the NDSO was informed. Internal.
CREATE OR REPLACE FUNCTION safeguarding_clock(p_concern uuid)
RETURNS TABLE (clock_hours integer, hours_open numeric, stopped boolean, overdue boolean) AS $$
  WITH c AS (
    SELECT sc.raised_at, sc.closed_at,
           CASE WHEN r.how_learned = 'anonymous_app' THEN 72 ELSE 24 END AS limit_h,
           (SELECT min(n.written_at) FROM safeguarding_concern_note n
             WHERE n.concern_id = sc.id AND n.kind = 'ndso_informed') AS informed_at
      FROM safeguarding_concern sc
      LEFT JOIN safeguarding_concern_reporter r ON r.concern_id = sc.id
     WHERE sc.id = p_concern)
  SELECT c.limit_h,
         round((extract(epoch FROM (coalesce(least(c.closed_at, c.informed_at), c.closed_at, c.informed_at, now())
                                    - c.raised_at)) / 3600)::numeric, 1),
         (c.closed_at IS NOT NULL OR c.informed_at IS NOT NULL),
         (c.closed_at IS NULL AND c.informed_at IS NULL AND now() - c.raised_at > make_interval(hours => c.limit_h))
    FROM c
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_clock(uuid) FROM PUBLIC;


-- ── 16 · The DSO's inbox (§4.2) ────────────────────────────────────
-- References, dates, what it is about, the state and the clocks — no names,
-- no account. Every institution the caller reads concerns at (or one), and
-- the read is on the log under each.
CREATE OR REPLACE FUNCTION safeguarding_inbox(p_tenant uuid DEFAULT NULL)
RETURNS TABLE (id uuid, reference text, tenant_id uuid, tenant_name text, school_id uuid, school_name text,
               raised_at timestamptz, about_kind text, nature text[], certainty text, state text,
               assigned_to uuid, assigned_name text, unheld boolean, clock_hours integer,
               hours_open numeric, clock_stopped boolean, overdue boolean) AS $$
DECLARE
  t record;
BEGIN
  IF app_user_id() IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.id, c.reference, c.tenant_id, ts.name, c.school_id, ss.name, c.raised_at, c.about_kind,
           c.nature, c.certainty, c.state, c.assigned_to, au.name, c.unheld,
           k.clock_hours, k.hours_open, k.stopped, k.overdue
      FROM safeguarding_concern c
      JOIN school ts ON ts.id = c.tenant_id
      JOIN school ss ON ss.id = c.school_id
      LEFT JOIN app_user au ON au.id = c.assigned_to
      CROSS JOIN LATERAL safeguarding_clock(c.id) k
     WHERE (p_tenant IS NULL OR c.tenant_id = p_tenant)
       AND safeguarding_reader(c.tenant_id)
       AND c.subject_person_id IS DISTINCT FROM app_user_id()
     ORDER BY (c.state = 'open') DESC, k.overdue DESC, c.raised_at DESC;
  FOR t IN SELECT c.tenant_id AS tid, array_agg(c.id) AS ids
             FROM safeguarding_concern c
            WHERE (p_tenant IS NULL OR c.tenant_id = p_tenant)
              AND safeguarding_reader(c.tenant_id)
              AND c.subject_person_id IS DISTINCT FROM app_user_id()
            GROUP BY c.tenant_id LOOP
    PERFORM log_restricted_read('safeguarding_inbox', t.ids[1:50], '{}'::text[], t.tid);
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_inbox(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_inbox(uuid) TO scrbrd_app;


-- ── 17 · Opening a concern (§4.2) ──────────────────────────────────
-- The record, who raised it, the notes and the shares, to a reader at the
-- holding institution who is not its subject; logged with the two fields it
-- discloses. NULL for anybody else, and for an id that does not exist: the
-- same answer. Never a date of birth, an address or a medical record (§8).
CREATE OR REPLACE FUNCTION safeguarding_concern_open(p_concern uuid) RETURNS jsonb AS $$
DECLARE
  c   safeguarding_concern%ROWTYPE;
  v   jsonb;
BEGIN
  SELECT * INTO c FROM safeguarding_concern sc WHERE sc.id = p_concern;
  IF NOT FOUND OR NOT safeguarding_reader(c.tenant_id)
     OR c.subject_person_id IS NOT DISTINCT FROM app_user_id() THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'id', c.id, 'reference', c.reference,
    'tenantId', c.tenant_id, 'tenantName', (SELECT s.name FROM school s WHERE s.id = c.tenant_id),
    'schoolId', c.school_id, 'schoolName', (SELECT s.name FROM school s WHERE s.id = c.school_id),
    'raisedAt', c.raised_at, 'aboutKind', c.about_kind,
    'subjectPlayer', (SELECT jsonb_build_object('id', p.id, 'name', p.full_name, 'team', p.team_code)
                        FROM player p WHERE p.id = c.subject_player_id),
    'subjectPerson', (SELECT jsonb_build_object('id', u.id, 'name', u.name)
                        FROM app_user u WHERE u.id = c.subject_person_id),
    'subjectText', c.subject_text, 'nature', to_jsonb(c.nature), 'certainty', c.certainty,
    'occurredOn', c.occurred_on, 'occurredWhere', c.occurred_where, 'account', c.account,
    'authoritiesTold', c.authorities_told,
    'assignedTo', (SELECT jsonb_build_object('id', u.id, 'name', u.name) FROM app_user u WHERE u.id = c.assigned_to),
    'positionOfTrust', c.position_of_trust, 'unheld', c.unheld, 'state', c.state,
    'closedAt', c.closed_at, 'closedBy', (SELECT u.name FROM app_user u WHERE u.id = c.closed_by),
    'outcome', c.outcome, 'retainUntil', c.retain_until,
    'reporter', (SELECT jsonb_build_object('id', r.reporter_id, 'name', u.name,
                                           'howLearned', r.how_learned, 'namedOk', r.named_ok)
                   FROM safeguarding_concern_reporter r JOIN app_user u ON u.id = r.reporter_id
                  WHERE r.concern_id = c.id),
    'notes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body,
                                                          'by', u.name, 'at', n.written_at) ORDER BY n.written_at, n.id)
                         FROM safeguarding_concern_note n JOIN app_user u ON u.id = n.written_by
                        WHERE n.concern_id = c.id), '[]'::jsonb),
    'shares', coalesce((SELECT jsonb_agg(jsonb_build_object('id', sh.id, 'with', u.name, 'withId', sh.with_person_id,
                                                           'what', to_jsonb(sh.what), 'openUntil', sh.open_until,
                                                           'reason', sh.reason, 'sharedAt', sh.shared_at,
                                                           'by', b.name, 'revokedAt', sh.revoked_at,
                                                           'live', sh.revoked_at IS NULL AND sh.open_until > now()
                                                                   AND c.state = 'open')
                                         ORDER BY sh.shared_at)
                          FROM safeguarding_share sh
                          JOIN app_user u ON u.id = sh.with_person_id
                          JOIN app_user b ON b.id = sh.shared_by
                         WHERE sh.concern_id = c.id), '[]'::jsonb),
    'clock', (SELECT jsonb_build_object('hours', k.clock_hours, 'open', k.hours_open,
                                        'stopped', k.stopped, 'overdue', k.overdue)
                FROM safeguarding_clock(c.id) k),
    'canManage', safeguarding_manager(c.tenant_id),
    'dsos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.person_id, 'name', d.name) ORDER BY d.name)
                        FROM dso_people_at(c.tenant_id) d
                       WHERE d.person_id IS DISTINCT FROM c.subject_person_id), '[]'::jsonb)
  ) INTO v;
  PERFORM log_restricted_read('safeguarding_concern', ARRAY[c.id], ARRAY['account', 'reporter'], c.tenant_id);
  RETURN v;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_concern_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_concern_open(uuid) TO scrbrd_app;


-- ── 18 · The family, through the concern and only while it is open (§4.5) ──
-- The named child's verified, live guardians — name, email, relationship —
-- and his active emergency contacts. The whole of a DSO's reach into a
-- family (decided Q3), logged under the concern.
CREATE OR REPLACE FUNCTION safeguarding_family(p_concern uuid) RETURNS jsonb AS $$
DECLARE
  c safeguarding_concern%ROWTYPE;
  v jsonb;
BEGIN
  SELECT * INTO c FROM safeguarding_concern sc WHERE sc.id = p_concern;
  IF NOT FOUND OR NOT safeguarding_reader(c.tenant_id)
     OR c.subject_person_id IS NOT DISTINCT FROM app_user_id()
     OR c.state <> 'open' OR c.subject_player_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'guardians', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', u.name, 'email', u.email, 'relationship', g.relationship,
                                          'linkId', g.id, 'personId', u.id) ORDER BY u.name)
        FROM assignment_subject g
        JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian' AND a.active
        JOIN app_user u ON u.id = a.person_id AND u.active
       WHERE g.player_id = c.subject_player_id AND g.verification_state = 'verified'
         AND g.valid_from <= current_date AND (g.valid_until IS NULL OR g.valid_until > current_date)), '[]'::jsonb),
    'emergency', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', e.name, 'relationship', e.relationship, 'phone', e.phone,
                                          'phoneAlt', e.phone_alt, 'email', e.email, 'priority', e.priority)
                       ORDER BY e.priority)
        FROM emergency_contact e WHERE e.player_id = c.subject_player_id AND e.active), '[]'::jsonb)
  ) INTO v;
  PERFORM log_restricted_read('safeguarding_family', ARRAY[c.id], ARRAY['guardian', 'emergency'], c.tenant_id);
  RETURN v;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_family(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_family(uuid) TO scrbrd_app;


-- ── 19 · Working a concern: a note, and who is working it ──────────
CREATE OR REPLACE FUNCTION safeguarding_note(p_concern uuid, p_kind text, p_body text)
RETURNS TABLE (ok boolean, reason text, note_id uuid) AS $$
DECLARE
  c safeguarding_concern%ROWTYPE;
  v uuid;
BEGIN
  SELECT * INTO c FROM safeguarding_concern sc WHERE sc.id = p_concern;
  IF NOT FOUND OR NOT safeguarding_manager(c.tenant_id)
     OR c.subject_person_id IS NOT DISTINCT FROM app_user_id() THEN
    RETURN QUERY SELECT false, 'no_such_concern', NULL::uuid; RETURN;
  END IF;
  IF c.state <> 'open' THEN RETURN QUERY SELECT false, 'concern_closed', NULL::uuid; RETURN; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('note', 'family_contacted', 'saps_contacted', 'guardian_contacted',
                                      'social_development_contacted', 'ndso_informed') THEN
    RETURN QUERY SELECT false, 'kind_invalid', NULL::uuid; RETURN;
  END IF;
  IF (p_kind = 'note' AND (p_body IS NULL OR length(btrim(p_body)) < 2))
     OR (p_body IS NOT NULL AND length(p_body) > 4000) THEN
    RETURN QUERY SELECT false, 'body_length', NULL::uuid; RETURN;
  END IF;
  INSERT INTO safeguarding_concern_note (concern_id, tenant_id, kind, body, written_by)
  VALUES (c.id, c.tenant_id, p_kind, nullif(btrim(p_body), ''), app_user_id())
  RETURNING safeguarding_concern_note.id INTO v;
  RETURN QUERY SELECT true, NULL::text, v;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_note(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_note(uuid, text, text) TO scrbrd_app;

CREATE OR REPLACE FUNCTION safeguarding_assign(p_concern uuid, p_dso uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  c safeguarding_concern%ROWTYPE;
  v_name text;
BEGIN
  SELECT * INTO c FROM safeguarding_concern sc WHERE sc.id = p_concern;
  IF NOT FOUND OR NOT safeguarding_manager(c.tenant_id)
     OR c.subject_person_id IS NOT DISTINCT FROM app_user_id() THEN
    RETURN QUERY SELECT false, 'no_such_concern'; RETURN;
  END IF;
  IF c.state <> 'open' THEN RETURN QUERY SELECT false, 'concern_closed'; RETURN; END IF;
  SELECT d.name INTO v_name FROM dso_people_at(c.tenant_id) d
   WHERE d.person_id = p_dso AND d.person_id IS DISTINCT FROM c.subject_person_id;
  IF v_name IS NULL THEN RETURN QUERY SELECT false, 'not_a_dso_here'; RETURN; END IF;
  UPDATE safeguarding_concern SET assigned_to = p_dso WHERE safeguarding_concern.id = c.id;
  INSERT INTO safeguarding_concern_note (concern_id, tenant_id, kind, body, written_by)
  VALUES (c.id, c.tenant_id, 'assigned', v_name, app_user_id());
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_assign(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_assign(uuid, uuid) TO scrbrd_app;


-- ── 20 · Need-to-know (§4.4) ───────────────────────────────────────
-- A named act, to a named person, for named parts, until a date no more than
-- thirty days away, with a reason. Never to the adult it names; never to a
-- pupil (SG-9: a private notice to a pupil is the system's alone); a parent
-- through his verified link to the child. One nameless notice to the person.
CREATE OR REPLACE FUNCTION safeguarding_share(
  p_concern    uuid,
  p_with       uuid,
  p_what       text[],
  p_open_until timestamptz,
  p_reason     text,
  p_with_link  uuid DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text, share_id uuid) AS $$
DECLARE
  c      safeguarding_concern%ROWTYPE;
  v_what text[];
  v_name text;
  v_id   uuid;
BEGIN
  SELECT * INTO c FROM safeguarding_concern sc WHERE sc.id = p_concern;
  IF NOT FOUND OR NOT safeguarding_manager(c.tenant_id)
     OR c.subject_person_id IS NOT DISTINCT FROM app_user_id() THEN
    RETURN QUERY SELECT false, 'no_such_concern', NULL::uuid; RETURN;
  END IF;
  IF c.state <> 'open' THEN RETURN QUERY SELECT false, 'concern_closed', NULL::uuid; RETURN; END IF;
  SELECT u.name INTO v_name FROM app_user u WHERE u.id = p_with AND u.active;
  IF v_name IS NULL OR p_with = app_user_id() THEN
    RETURN QUERY SELECT false, 'no_such_person', NULL::uuid; RETURN;
  END IF;
  IF p_with IS NOT DISTINCT FROM c.subject_person_id THEN
    RETURN QUERY SELECT false, 'recipient_is_subject', NULL::uuid; RETURN;
  END IF;
  IF person_is_pupil(p_with) THEN
    RETURN QUERY SELECT false, 'recipient_is_pupil', NULL::uuid; RETURN;
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_what FROM unnest(coalesce(p_what, '{}')) x WHERE x IS NOT NULL;
  IF v_what IS NULL OR NOT (v_what <@ '{summary,child,account,actions}'::text[]) THEN
    RETURN QUERY SELECT false, 'what_invalid', NULL::uuid; RETURN;
  END IF;
  IF 'child' = ANY (v_what) AND c.subject_player_id IS NULL THEN
    RETURN QUERY SELECT false, 'no_child_named', NULL::uuid; RETURN;
  END IF;
  IF p_open_until IS NULL OR p_open_until <= now() OR p_open_until > now() + interval '30 days' THEN
    RETURN QUERY SELECT false, 'open_until_out_of_range', NULL::uuid; RETURN;
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 OR length(p_reason) > 500 THEN
    RETURN QUERY SELECT false, 'reason_required', NULL::uuid; RETURN;
  END IF;
  IF p_with_link IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM assignment_subject g
         JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian' AND a.active
        WHERE g.id = p_with_link AND a.person_id = p_with
          AND g.player_id = c.subject_player_id AND g.verification_state = 'verified'
          AND g.valid_from <= current_date AND (g.valid_until IS NULL OR g.valid_until > current_date)) THEN
    RETURN QUERY SELECT false, 'link_invalid', NULL::uuid; RETURN;
  END IF;

  INSERT INTO safeguarding_share (concern_id, tenant_id, shared_by, with_person_id, with_link_id, what, open_until, reason)
  VALUES (c.id, c.tenant_id, app_user_id(), p_with, p_with_link, v_what, p_open_until, btrim(p_reason))
  RETURNING safeguarding_share.id INTO v_id;
  INSERT INTO safeguarding_concern_note (concern_id, tenant_id, kind, body, written_by)
  VALUES (c.id, c.tenant_id, 'shared',
          format('With %s until %s (%s): %s', v_name,
                 to_char(p_open_until AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI'),
                 array_to_string(v_what, ', '), btrim(p_reason)),
          app_user_id());
  INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability, recipient_id)
  VALUES (c.school_id, 'school', 'safeguarding', 'medium', 'The DSO has shared something with you',
          'Open Safeguarding to read it.', 'news.read', p_with);
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_share(uuid, uuid, text[], timestamptz, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_share(uuid, uuid, text[], timestamptz, text, uuid) TO scrbrd_app;

-- Revoked by any DSO at the holding institution; lapses by itself at
-- open_until; ends with the concern's close.
CREATE OR REPLACE FUNCTION safeguarding_share_revoke(p_share uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  s safeguarding_share%ROWTYPE;
BEGIN
  SELECT * INTO s FROM safeguarding_share sh WHERE sh.id = p_share;
  IF NOT FOUND OR NOT safeguarding_manager(s.tenant_id) OR safeguarding_names_me(s.concern_id) THEN
    RETURN QUERY SELECT false, 'no_such_share'; RETURN;
  END IF;
  IF s.revoked_at IS NOT NULL THEN RETURN QUERY SELECT true, 'already_revoked'; RETURN; END IF;
  UPDATE safeguarding_share SET revoked_at = now(), revoked_by = app_user_id() WHERE safeguarding_share.id = s.id;
  INSERT INTO safeguarding_concern_note (concern_id, tenant_id, kind, body, written_by)
  VALUES (s.concern_id, s.tenant_id, 'share_revoked',
          (SELECT u.name FROM app_user u WHERE u.id = s.with_person_id), app_user_id());
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_share_revoke(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_share_revoke(uuid) TO scrbrd_app;

-- The named person's live shares: when, until when, which parts. No detail;
-- that is safeguarding_share_open()'s, logged.
CREATE OR REPLACE FUNCTION my_safeguarding_shares()
RETURNS TABLE (id uuid, shared_at timestamptz, open_until timestamptz, what text[]) AS $$
  SELECT sh.id, sh.shared_at, sh.open_until, sh.what
    FROM safeguarding_share sh
    JOIN safeguarding_concern c ON c.id = sh.concern_id
   WHERE sh.with_person_id = app_user_id() AND sh.revoked_at IS NULL AND sh.open_until > now()
     AND c.state = 'open' AND safeguarding_uncut(c.school_id) AND safeguarding_uncut(c.tenant_id)
   ORDER BY sh.shared_at DESC
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION my_safeguarding_shares() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_safeguarding_shares() TO scrbrd_app;

-- Opening one: only its person, only while live, only the parts in `what`,
-- never the reporter; logged. No capability is needed: it is a named act to
-- a named person, and his ordinary session is the credential.
--   summary  what it is: nature, certainty, when, what about
--   child    the child's name
--   account  the account
--   actions  the notes, except those about shares, suspensions and referrals
CREATE OR REPLACE FUNCTION safeguarding_share_open(p_share uuid) RETURNS jsonb AS $$
DECLARE
  s safeguarding_share%ROWTYPE;
  c safeguarding_concern%ROWTYPE;
  v jsonb;
BEGIN
  SELECT * INTO s FROM safeguarding_share sh WHERE sh.id = p_share;
  IF NOT FOUND OR s.with_person_id IS DISTINCT FROM app_user_id() OR s.revoked_at IS NOT NULL
     OR s.open_until <= now() THEN
    RETURN NULL;
  END IF;
  SELECT * INTO c FROM safeguarding_concern sc WHERE sc.id = s.concern_id;
  IF c.state <> 'open' OR NOT safeguarding_uncut(c.school_id) OR NOT safeguarding_uncut(c.tenant_id)
     OR c.subject_person_id IS NOT DISTINCT FROM app_user_id() THEN
    RETURN NULL;
  END IF;
  v := jsonb_build_object('shareId', s.id, 'sharedAt', s.shared_at, 'openUntil', s.open_until,
                          'reason', s.reason, 'what', to_jsonb(s.what),
                          'sharedBy', (SELECT u.name FROM app_user u WHERE u.id = s.shared_by),
                          'schoolName', (SELECT sc.name FROM school sc WHERE sc.id = c.school_id));
  IF 'summary' = ANY (s.what) THEN
    v := v || jsonb_build_object('summary', jsonb_build_object('nature', to_jsonb(c.nature), 'certainty', c.certainty,
                                                               'occurredOn', c.occurred_on, 'aboutKind', c.about_kind));
  END IF;
  IF 'child' = ANY (s.what) THEN
    v := v || jsonb_build_object('child', (SELECT p.full_name FROM player p WHERE p.id = c.subject_player_id));
  END IF;
  IF 'account' = ANY (s.what) THEN
    v := v || jsonb_build_object('account', c.account);
  END IF;
  IF 'actions' = ANY (s.what) THEN
    v := v || jsonb_build_object('actions', coalesce((
      SELECT jsonb_agg(jsonb_build_object('kind', n.kind, 'body', n.body, 'at', n.written_at) ORDER BY n.written_at, n.id)
        FROM safeguarding_concern_note n
       WHERE n.concern_id = c.id
         AND n.kind NOT IN ('raised', 'shared', 'share_revoked', 'suspended', 'suspension_lifted', 'referred')), '[]'::jsonb));
  END IF;
  PERFORM log_restricted_read('safeguarding_share', ARRAY[s.id], s.what, s.tenant_id);
  RETURN v;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_share_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_share_open(uuid) TO scrbrd_app;


-- ── 21 · Closing (§4.7) ────────────────────────────────────────────
-- The outcome, whether it touches a position of trust, and the date it may
-- not be deleted before: CSA's periods as the floor (p64; decided Q8) — five
-- years for a position of trust, three otherwise. Every open share ends.
-- Purge is phase 5; nothing deletes a concern here.
CREATE OR REPLACE FUNCTION safeguarding_close(p_concern uuid, p_outcome text, p_position_of_trust boolean,
                                              p_note text DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, retain_until date) AS $$
DECLARE
  c      safeguarding_concern%ROWTYPE;
  v_now  timestamptz := now();
  v_keep date;
BEGIN
  SELECT * INTO c FROM safeguarding_concern sc WHERE sc.id = p_concern FOR UPDATE;
  IF NOT FOUND OR NOT safeguarding_manager(c.tenant_id)
     OR c.subject_person_id IS NOT DISTINCT FROM app_user_id() THEN
    RETURN QUERY SELECT false, 'no_such_concern', NULL::date; RETURN;
  END IF;
  IF c.state <> 'open' THEN RETURN QUERY SELECT false, 'concern_closed', NULL::date; RETURN; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('no_action', 'supported', 'referred_saps', 'referred_social_development',
                                            'disciplinary_enquiry', 'handed_to_union', 'other') THEN
    RETURN QUERY SELECT false, 'outcome_invalid', NULL::date; RETURN;
  END IF;
  IF p_position_of_trust IS NULL THEN RETURN QUERY SELECT false, 'position_of_trust_required', NULL::date; RETURN; END IF;
  IF p_note IS NOT NULL AND length(p_note) > 4000 THEN RETURN QUERY SELECT false, 'body_length', NULL::date; RETURN; END IF;
  v_keep := ((v_now AT TIME ZONE 'Africa/Johannesburg')
             + CASE WHEN p_position_of_trust THEN interval '5 years' ELSE interval '3 years' END)::date;
  UPDATE safeguarding_concern
     SET state = 'closed', closed_at = v_now, closed_by = app_user_id(), outcome = p_outcome,
         position_of_trust = p_position_of_trust, retain_until = v_keep
   WHERE safeguarding_concern.id = c.id;
  UPDATE safeguarding_share SET revoked_at = v_now, revoked_by = app_user_id()
   WHERE concern_id = c.id AND revoked_at IS NULL;
  IF p_position_of_trust THEN
    INSERT INTO safeguarding_concern_note (concern_id, tenant_id, kind, written_by)
    VALUES (c.id, c.tenant_id, 'position_of_trust_set', app_user_id());
  END IF;
  INSERT INTO safeguarding_concern_note (concern_id, tenant_id, kind, body, written_by)
  VALUES (c.id, c.tenant_id, 'closed', concat_ws(' — ', p_outcome, nullif(btrim(p_note), '')), app_user_id());
  RETURN QUERY SELECT true, NULL::text, v_keep;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION safeguarding_close(uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION safeguarding_close(uuid, text, boolean, text) TO scrbrd_app;


-- ── 22 · A DSO's own clearances ────────────────────────────────────
-- db/56 could not add these before the role existed: the three checks, the
-- Safeguarding Awareness Certificate, the signed acknowledgement, and DSO
-- training (§6.4, SG-7).
INSERT INTO clearance_requirement (role, kind)
SELECT 'dso', k
  FROM unnest(ARRAY['police_clearance', 'child_protection', 'sexual_offences_register',
                    'safeguarding_awareness', 'safeguarding_acknowledgement', 'dso_training']) AS k
ON CONFLICT (role, kind) DO NOTHING;


-- ── 23 · A managed host's API roles reach none of it ───────────────
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                WHERE ns.nspname = 'public'
                  AND p.proname IN ('school_federation', 'school_union', 'dso_assignment_scoped', 'safeguarding_uncut',
                                    'safeguarding_reader', 'safeguarding_manager', 'safeguarding_upward',
                                    'safeguarding_authority', 'dso_people_at', 'person_live_at', 'person_is_pupil',
                                    'safeguarding_concern_fixed', 'safeguarding_child_stamp', 'safeguarding_append_only',
                                    'safeguarding_names_me', 'safeguarding_log_names_me', 'notification_recipient_not_pupil', 'dso_appointment_guard',
                                    'safeguarding_dso_end', 'safeguarding_route', 'safeguarding_concern_raise',
                                    'my_concern_receipts', 'dso_contacts', 'safeguarding_clock', 'safeguarding_inbox',
                                    'safeguarding_concern_open', 'safeguarding_family', 'safeguarding_note',
                                    'safeguarding_assign', 'safeguarding_share', 'safeguarding_share_revoke',
                                    'my_safeguarding_shares', 'safeguarding_share_open', 'safeguarding_close') LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON safeguarding_concern, safeguarding_concern_reporter, '
                     'safeguarding_concern_note, safeguarding_share FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f       text;
  t       text;
  v_n     integer;
  v_list  text;
  v_def   text;
BEGIN
  -- (1) The four capabilities are held by `dso` and by nobody else.
  SELECT string_agg(DISTINCT role, ' ' ORDER BY role) INTO v_list
    FROM role_capability WHERE capability LIKE 'safeguarding.%';
  IF v_list IS DISTINCT FROM 'dso' THEN
    RAISE EXCEPTION 'db/57: safeguarding.* is held by [%], expected dso alone', v_list;
  END IF;
  SELECT count(*) INTO v_n FROM role_capability WHERE role = 'dso';
  IF v_n <> 15 THEN RAISE EXCEPTION 'db/57: the dso bundle has % capabilities, expected 15', v_n; END IF;
  IF EXISTS (SELECT 1 FROM role_capability WHERE role = 'dso'
              AND (capability LIKE 'medical.%' OR capability LIKE 'discipline.%' OR capability LIKE 'scoring.%'
                   OR capability IN ('user.role.assign', 'player.pii.read', 'player.emergency.read',
                                     'player.age.read', 'player.note.read'))) THEN
    RAISE EXCEPTION 'db/57: dso holds a capability the design keeps from it';
  END IF;
  SELECT string_agg(granter, ' ' ORDER BY granter) INTO v_list FROM role_grantable WHERE role = 'dso';
  IF v_list IS DISTINCT FROM 'platformadmin principal superadmin' THEN
    RAISE EXCEPTION 'db/57: dso is appointable by [%], expected principal, platformadmin and superadmin', v_list;
  END IF;

  -- (2) The tables: row security on, the four layers each, SELECT only, the pad guard.
  FOREACH t IN ARRAY ARRAY['safeguarding_concern', 'safeguarding_concern_reporter',
                           'safeguarding_concern_note', 'safeguarding_share'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'db/57: % is not under row-level security', t;
    END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = t
          AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
          AND policyname IN (t || '_no_support', t || '_not_platform', t || '_not_named')) <> 3 THEN
      RAISE EXCEPTION 'db/57: % does not carry its three RESTRICTIVE cuts', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                      AND policyname = t || '_read' AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
                      AND qual LIKE '%app_can(''safeguarding.concern.read''%NULL::text%NULL::uuid)%') THEN
      RAISE EXCEPTION 'db/57: % is not read under safeguarding.concern.read with no team and no fixture', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                  AND permissive = 'PERMISSIVE' AND cmd <> 'SELECT') THEN
      RAISE EXCEPTION 'db/57: % has a write policy', t;
    END IF;
    IF has_table_privilege('scrbrd_app', t, 'INSERT') OR has_table_privilege('scrbrd_app', t, 'UPDATE')
       OR has_table_privilege('scrbrd_app', t, 'DELETE') OR has_table_privilege('scrbrd_app', t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'db/57: the application may write %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                      AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'db/57: % has no RESTRICTIVE pad_scope_select (db/50)', t;
    END IF;
  END LOOP;

  -- (3) The log hides its rows; the notices are one person's, and the system's.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'access_log'
                    AND policyname = 'access_log_safeguarding_hidden' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'db/57: access_log_safeguarding_hidden is missing or not RESTRICTIVE';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
     AND permissive = 'RESTRICTIVE'
     AND policyname IN ('notification_recipient_only', 'notification_safeguarding_uncut',
                        'notification_safeguarding_insert', 'notification_safeguarding_update');
  IF v_n <> 4 THEN RAISE EXCEPTION 'db/57: notification carries % of its four RESTRICTIVE policies', v_n; END IF;

  -- (4) Support may not take a DSO into a school; the guards are in place.
  SELECT prosrc INTO v_def FROM pg_proc WHERE oid = 'support_access_begin(uuid,text,text,text,integer)'::regprocedure;
  IF v_def NOT LIKE '%rc.capability LIKE ''safeguarding.%''%' THEN
    RAISE EXCEPTION 'db/57: support_access_begin() does not refuse a safeguarding role';
  END IF;
  FOREACH t IN ARRAY ARRAY['role_assignment_dso_scoped', 'role_assignment_dso_guard'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'role_assignment'::regclass AND tgname = t AND NOT tgisinternal) THEN
      RAISE EXCEPTION 'db/57: trigger % is missing', t;
    END IF;
  END LOOP;

  -- (5) The DSO's clearances.
  SELECT count(*) INTO v_n FROM clearance_requirement WHERE role = 'dso';
  IF v_n <> 6 THEN RAISE EXCEPTION 'db/57: dso is asked for % clearances, expected 6', v_n; END IF;

  -- (6) Definers: pinned; the ones the application calls are its alone.
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public'
              AND (p.proname LIKE 'safeguarding%' OR p.proname IN ('school_federation', 'school_union', 'dso_people_at',
                   'person_live_at', 'person_is_pupil', 'my_concern_receipts', 'my_safeguarding_shares', 'dso_contacts',
                   'dso_appointment_guard', 'dso_assignment_scoped', 'notification_recipient_not_pupil')) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/57: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/57: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(r.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/57: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
      'safeguarding_concern_raise(uuid,text,text[],text,text,text,uuid,uuid,text,date,text,text,boolean,uuid)',
      'my_concern_receipts()', 'dso_contacts(uuid)', 'safeguarding_inbox(uuid)', 'safeguarding_concern_open(uuid)',
      'safeguarding_family(uuid)', 'safeguarding_note(uuid,text,text)', 'safeguarding_assign(uuid,uuid)',
      'safeguarding_share(uuid,uuid,text[],timestamp with time zone,text,uuid)', 'safeguarding_share_revoke(uuid)',
      'my_safeguarding_shares()', 'safeguarding_share_open(uuid)', 'safeguarding_close(uuid,text,boolean,text)',
      'safeguarding_dso_end(uuid)', 'safeguarding_reader(uuid)', 'safeguarding_names_me(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/57: scrbrd_app cannot execute %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['safeguarding_route(uuid,text,uuid)', 'dso_people_at(uuid)', 'safeguarding_upward(text,uuid)',
                           'person_is_pupil(uuid)', 'safeguarding_clock(uuid)'] LOOP
    IF has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/57: % is internal and the application may call it', f;
    END IF;
  END LOOP;
END $check$;
