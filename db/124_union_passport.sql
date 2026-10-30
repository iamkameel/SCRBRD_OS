-- ══════════════════════════════════════════════════════════════════
--  124 · The union passport: CSA Schools and a provincial union read a
--        boy's passport on his family's word, named readers only, every
--        read logged and shown to his family
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's decisions of 29 October 2026, through the Build
-- Board, quoted as given:
--
--   "Public profile would be hidden, CSA Schools/Provincial Union will be
--    able to access a child's full passport."
--   Consent: "With his guardian's consent, as the receiving school's is."
--   Who: "Named selectors and the schools cricket manager only, every read
--    logged." So his family can see who looked.
--   Passport consent: "Under eighteen, only his guardian; at eighteen, he
--    does it himself." (db/122 §1c, which this file reuses whole.)
--
-- Its proof is db/99 §101; the API walk is tools/smoke-passport.mjs, the
-- screen's tools/smoke-browser-read.mjs (Settings → Passport, through the
-- family's Consents card). Not to be pasted before it is reviewed.
--
-- ── 1 · WHO IS A UNION, AND WHO AT IT READS ──────────────────────────
-- An institution above a school is a `school` row of kind 'union' (one per
-- province, db/57) or 'federation' (one, db/57). CSA Schools is the
-- federation tenant here: the one institution above every union (db/57's
-- school_federation()), where the NDSO already sits. A boy's union is
-- school_union() of his school (db/57: his school's province's union).
-- Today an account at a union is a competition organiser (competitionadmin),
-- and the pilot's league account holds it platform-wide; neither is a reader
-- here. Being an organiser opens nothing.
--
-- THE NAMED ROLE. `unionselector` ("Union Selector": the union's named
-- selectors and its schools cricket manager) holds passport.union.read and
-- school.read, nothing else. A trigger refuses an assignment that names no
-- institution, a school, a club or anything but a union or the federation,
-- a team or a fixture: the role is held per union organisation, whole. The
-- union's or the federation's principal appoints it (as it appoints the
-- PDSO, db/57), and the platform's two keys may, as they appoint anything.
-- The owner's key holds the capability too (its bundle is every capability
-- but safeguarding's, derived), and it counts for nothing here: the reader
-- test below asks, as db/57's safeguarding_uncut() does, that nobody reads
-- on a platform-wide assignment or a support session. The owner's key opens
-- a passport through its own office arm, as before, never as a union.
--
-- ── 2 · THE CONSENT: ONE MORE RECIPIENT ON THE PASSPORT CONSENT ──────
-- No new table for it. A passport_consent row (db/08) names an institution
-- in to_school_id, and a union or the federation is one: the family names
-- CSA Schools or his union just as it names a receiving school, through the
-- same route, the same writer rule (db/122's passport_consent_writer_ok():
-- his live, consented guardian; the boy himself from eighteen), the same
-- in-force rule (db/122's consent_giver_live(): the giver's link still
-- live, and no younger than the consent), and the same withdrawal (anyone of
-- his family on a live link, the boy at any age, db/122 §1d). The recipient
-- KIND is read from the institution, never stored, so it cannot drift:
-- institution_is_union() says whether a row names a union or the federation.
--
-- Two narrowings make a union recipient a union recipient and nothing more:
--   (a) A union is not a school. passport_open()'s named-school arm (db/116,
--       db/122) opened the passport to the office (guardian.link.manage) or
--       a coach (team.select) at the institution the family named. For a
--       union that would be its principal and its office, so that arm now
--       skips a union or the federation; the union arm below is its only
--       door. Likewise the consent row and its in-force answer are not the
--       union office's to read (db/115 gave them to "the office of the school
--       it names"): a RESTRICTIVE read policy and passport_consent_in_force()
--       leave a union row to the family alone.
--   (b) His union, or CSA Schools. A RESTRICTIVE insert policy refuses a
--       consent naming a union that is not his school's
--       (passport_consent_recipient_ok()); the route says so in words
--       (not_his_union). The read arm asks the same at read time, so a boy who
--       moves to a school in another province closes his old union's door.
--
-- ── 3 · passport_open() FOR THAT READER ─────────────────────────────
-- A new arm, passport_union_consent(boy): the in-force consent (not
-- withdrawn; consent_giver_live()) naming his union (school_union() of his
-- school) or the federation, not archived, at which the caller holds
-- passport.union.read on an assignment AT that institution, naming no team,
-- under no support session and with no platform-wide assignment, never on a
-- pad. Nothing else widens: no table policy names the capability, the
-- family's arm and the arms at his own school are db/116's, the named-school
-- arm is db/122's with (a) above. The public profile does not move: nothing
-- here touches a public read, the label, the never-public mark or a public
-- page (PUBLIC_DATA); the union reads the passport and nothing of the boy's
-- player row (its role holds no player.* capability).
--
-- ── 4 · EVERY UNION READ LOGGED, AND THE FAMILY SEES IT ──────────────
-- passport() and passport_name() (db/116) become VOLATILE, and each, when
-- the union arm is what lets the caller in, writes one passport_union_read
-- row before it answers (who, which institution, when, which boy, which
-- consent, and whether it was the passport or only his name), and one
-- access_log row at his school (log_restricted_read(), resource
-- 'passport_union'), so his school's own auditors see it in the log they
-- already read. The passport_union_read insert is not caught: if the log
-- cannot be written, the read fails. The table is nobody's to read or write
-- but these definers'.
--   passport_union_reads()  the family's view: for each boy the caller is
--                           family of on a live link (is_family_of(), db/119:
--                           a guardian, or the boy himself through his own
--                           self-access link), who at which union looked and
--                           when. Never on a pad. Settings → Passport draws
--                           it under the consents.
--
-- ── ASKED OF KAMEEL, AND ANSWERED (30 Oct 2026: all seven as
--    recommended, as built) ─────────────────────────────────────────────
--   U1  CSA Schools and a provincial union: two lines, one per institution,
--       as two schools are two lines. A family may name either or both.
--   U2  The log shows the reader's NAME, his role and the institution, not
--       the role alone: "who looked" is a person, and a union has several
--       selectors.
--   U3  How long the log is kept: as long as his record (the row goes with
--       the player row, ON DELETE CASCADE, and nothing purges it sooner).
--   U4  The boy under eighteen sees the log of his own record (READERS Q14
--       holds the school's access log from him until eighteen). Built: he
--       sees it, because he may withdraw the consent at any age (db/122 Q2)
--       and this log is what he would withdraw on.
--   U5  CSA Schools is the federation tenant (db/57), not an institution of
--       its own.
--   U6  How a selector finds a boy: nothing lists the boys whose families
--       named his union; he opens a passport by the boy's id. A list (names,
--       each read logged) is a further door, not built.
--   U7  One role for the named selectors and the schools cricket manager.
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   capability passport.union.read; role unionselector (its two capabilities;
--     appointed by principal, platformadmin, superadmin); superadmin's row
--   trigger role_assignment_unionselector_scoped: new
--   table passport_union_read: new, row security on, no privilege for the
--     application (nothing reads or writes it but the definers)
--   functions institution_is_union(uuid), passport_consent_recipient_ok(uuid,
--     uuid), passport_union_reads(): new definers, scrbrd_app's alone;
--     passport_union_reader_at(uuid), passport_union_consent(uuid),
--     passport_union_log(uuid,uuid,text), unionselector_assignment_scoped():
--     new, nobody's to call
--   function passport_open(uuid) (db/122): body replaced: the named-school arm
--     skips a union, and the union arm is added
--   function passport(uuid), passport_name(uuid) (db/116): bodies replaced and
--     VOLATILE: they log a union read; every line they return is db/116's
--   function passport_consent_in_force(uuid) (db/122): body replaced: a union
--     row's answer is the family's alone
--   function role_words(text) (db/77): one name added
--   policies passport_consent_union_family_only (SELECT) and
--     passport_consent_union_is_his (INSERT): new RESTRICTIVE
-- No column, no row of anybody's. A second paste changes nothing. Each new
-- policy takes a brief lock on passport_consent; the trigger on
-- role_assignment.
--
-- SCHEMA FIRST. The read API's `passport_union_reads` selects the new
-- definer, and the grant route asks passport_consent_recipient_ok(), so this
-- file goes before the API built with it; it is in
-- services/api/expected-migrations.json.


-- ── 0 · Refuse to replace what this file was not written against ──
DO $guard$
DECLARE r record; v_src text; v_md5 text; v_qual text;
BEGIN
  IF to_regprocedure('consent_giver_live(uuid,uuid,timestamptz)') IS NULL
     OR to_regprocedure('passport_consent_writer_ok(uuid)') IS NULL
     OR to_regprocedure('school_union(uuid)') IS NULL OR to_regprocedure('school_federation()') IS NULL
     OR to_regprocedure('app_support_access_id(uuid)') IS NULL OR to_regprocedure('app_is_platform_wide()') IS NULL
     OR to_regprocedure('log_restricted_read(text,uuid[],text[],uuid)') IS NULL
     OR to_regprocedure('is_family_of(uuid)') IS NULL OR to_regprocedure('player_school(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/124: consent_giver_live(), passport_consent_writer_ok() (db/122), school_union(), school_federation() (db/57), app_support_access_id() (db/22), app_is_platform_wide() (db/20), log_restricted_read() or is_family_of() is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('passport_open(uuid)',             'c90384bf784a087fd550806652195c78', '8e210cbd4fd5aea4d854967f7371d591',     'db/122'),
      ('passport(uuid)',                  '5a74d545a6c669c9535fa5446fac1427', 'af51b8b92926f6c7e50cc98c8d1e89b6', 'db/116'),
      ('passport_name(uuid)',             'c66de74b0fda2fd755e86c140a6a77c9', 'cee15d920736a7ffecce8943c2c6b0b8',     'db/116'),
      ('passport_consent_in_force(uuid)', '5ba05a756524f94ebad1ca00bd7bfc0d', 'c46388505e757f57fa4ac423c300b13e',  'db/122'),
      ('role_words(text)',                '2ca3e32d8973caf8a5c69e66ad9b3952', '009daaf01590b760ab0a1c54fde1d565',    'db/77'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/124: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/124: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
  -- The read policy this file narrows beside is db/115's.
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_qual FROM pg_policy p
   WHERE p.polrelid = 'passport_consent'::regclass AND p.polname = 'passport_consent_read';
  IF v_qual IS DISTINCT FROM '(is_family_of(player_id) OR app_can(''guardian.link.manage''::text, to_school_id, ''*''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid))' THEN
    RAISE EXCEPTION 'db/124: passport_consent_read reads % — not db/115''s; look first', coalesce(v_qual, '(missing)');
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · The capability, the role and who appoints it
-- ══════════════════════════════════════════════════════════════════
-- ADDED_SINCE_01 and ROLES_ADDED_SINCE_01 (services/api/rls/generate-rls.mjs):
-- the catalogue row, the bundle and the appointers are all here, as db/57
-- and db/60 did; db/01 does not move.
INSERT INTO capability (name) VALUES ('passport.union.read') ON CONFLICT (name) DO NOTHING;

INSERT INTO role_capability (role, capability) VALUES
  ('unionselector', 'passport.union.read'),
  ('unionselector', 'school.read'),
  -- The owner's key: every capability but safeguarding's (roles.mjs). It
  -- reads no passport as a union (§3's reader test refuses a platform-wide
  -- caller).
  ('superadmin',    'passport.union.read')
ON CONFLICT DO NOTHING;

INSERT INTO role_grantable (granter, role) VALUES
  ('principal',     'unionselector'),
  ('platformadmin', 'unionselector'),
  ('superadmin',    'unionselector')
ON CONFLICT DO NOTHING;

-- Held per union organisation, whole: at a union or the federation, never
-- platform-wide, never at a school, never for one team or one fixture.
CREATE OR REPLACE FUNCTION unionselector_assignment_scoped() RETURNS trigger AS $$
BEGIN
  IF NEW.role = 'unionselector' THEN
    -- institution_is_union() reads the institution as its owner: the
    -- appointer may not be able to read a union's row.
    IF NEW.school_id IS NULL OR NOT institution_is_union(NEW.school_id) THEN
      RAISE EXCEPTION 'a union selector belongs to one union or to CSA Schools: a unionselector assignment names a union or the federation'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.team_code IS NOT NULL OR NEW.fixture_id IS NOT NULL THEN
      RAISE EXCEPTION 'a union selector reads for the whole union: a unionselector assignment names no team and no fixture'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS role_assignment_unionselector_scoped ON role_assignment;
CREATE TRIGGER role_assignment_unionselector_scoped BEFORE INSERT OR UPDATE OF role, school_id, team_code, fixture_id
  ON role_assignment FOR EACH ROW EXECUTE FUNCTION unionselector_assignment_scoped();

-- Role names, as the screens say them (apps/web/src/design/roles.js): db/77's,
-- with the one name added.
CREATE OR REPLACE FUNCTION role_words(p_role text) RETURNS text AS $$
  SELECT CASE p_role
    WHEN 'superadmin' THEN 'Super Admin'           WHEN 'platformadmin' THEN 'Platform Admin'
    WHEN 'principal' THEN 'Principal'              WHEN 'directorofsport' THEN 'Director of Sport'
    WHEN 'schooladmin' THEN 'School Admin'         WHEN 'sportsadmin' THEN 'Sports Admin'
    WHEN 'coach' THEN 'Coach'                      WHEN 'assistantcoach' THEN 'Assistant Coach'
    WHEN 'teammanager' THEN 'Team Manager'         WHEN 'player' THEN 'Player'
    WHEN 'guardian' THEN 'Parent / Guardian'       WHEN 'spectator' THEN 'Spectator'
    WHEN 'selfaccess' THEN 'My Record'             WHEN 'enquiry' THEN 'Enquiry Access'
    WHEN 'scorer' THEN 'Scorer'                    WHEN 'official' THEN 'Match Official'
    WHEN 'analyst' THEN 'Performance Analyst'      WHEN 'scout' THEN 'Scout'
    WHEN 'medical' THEN 'Medical Staff'            WHEN 'fitness' THEN 'Strength & Conditioning'
    WHEN 'transportcoordinator' THEN 'Transport Coordinator'
    WHEN 'driver' THEN 'Driver'                    WHEN 'facilities' THEN 'Groundskeeper'
    WHEN 'finance' THEN 'Finance Admin'            WHEN 'sponsorship' THEN 'Sponsorship'
    WHEN 'media' THEN 'Media'                      WHEN 'competitionadmin' THEN 'Competition Admin'
    WHEN 'dso' THEN 'Safeguarding Officer'         WHEN 'unionselector' THEN 'Union Selector'
    ELSE p_role END
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §2 · A union recipient on the passport consent
-- ══════════════════════════════════════════════════════════════════
/**
 * Does this institution sit above a school: a provincial union, or the
 * federation (CSA Schools)? A definer, because a policy asks it as the
 * caller, and a caller who cannot read the union's row must not be told "a
 * school" (which would let the office arm in).
 */
CREATE OR REPLACE FUNCTION institution_is_union(p_org uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM school s WHERE s.id = p_org AND s.kind IN ('union', 'federation'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * May a family name this institution for this boy's record? Any school, as
 * before; a union only if it is his (his school's province's, school_union());
 * the federation always; an archived union or federation never. The
 * RESTRICTIVE insert policy below asks it, and the grant route asks it first
 * so it can say why.
 */
CREATE OR REPLACE FUNCTION passport_consent_recipient_ok(p_player uuid, p_org uuid) RETURNS boolean AS $$
  SELECT NOT institution_is_union(p_org)
      OR EXISTS (SELECT 1 FROM player p, school o
                  WHERE p.id = p_player AND o.id = p_org AND o.archived_at IS NULL
                    AND ((o.kind = 'union' AND o.id = school_union(p.school_id))
                         OR (o.kind = 'federation' AND o.id = school_federation())))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- His union or CSA Schools, never another province's union.
DROP POLICY IF EXISTS passport_consent_union_is_his ON passport_consent;
CREATE POLICY passport_consent_union_is_his ON passport_consent AS RESTRICTIVE
  FOR INSERT WITH CHECK (passport_consent_recipient_ok(player_id, to_school_id));
-- A union's row is the family's to read, not the union office's (db/115's
-- "office of the school it names" is a school's office). Its readers read
-- the passport, through passport(), and nothing of the consent.
DROP POLICY IF EXISTS passport_consent_union_family_only ON passport_consent;
CREATE POLICY passport_consent_union_family_only ON passport_consent AS RESTRICTIVE
  FOR SELECT USING (NOT institution_is_union(to_school_id) OR is_family_of(player_id));
COMMENT ON POLICY passport_consent_union_is_his ON passport_consent IS
  'A family names his own union or CSA Schools, never another province''s union (db/124).';
COMMENT ON POLICY passport_consent_union_family_only ON passport_consent IS
  'A consent naming a union or CSA Schools is read by his family alone; the union reads the passport (db/124).';

/**
 * db/122's in-force answer, its office arm a school's office only: a row
 * naming a union or the federation is answered to the family alone.
 */
CREATE OR REPLACE FUNCTION passport_consent_in_force(p_consent uuid) RETURNS boolean AS $$
  SELECT c.withdrawn_at IS NULL AND consent_giver_live(c.granted_by, c.player_id, c.granted_at)
    FROM passport_consent c
   WHERE c.id = p_consent AND NOT app_pad_scoped()
     AND (is_family_of(c.player_id)
          OR (app_can('guardian.link.manage', c.to_school_id, '*'::text,
                      '00000000-0000-0000-0000-000000000000'::uuid,
                      '00000000-0000-0000-0000-000000000000'::uuid)
              -- A union's or CSA Schools' row is the family's alone (db/124).
              AND NOT institution_is_union(c.to_school_id)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §3 · passport_open() for a union's named reader
-- ══════════════════════════════════════════════════════════════════
/**
 * Is the caller a named reader at this union or at the federation:
 * passport.union.read held on an assignment AT it, naming no team, as
 * db/57's safeguarding_reader() asks — no support session there, no
 * platform-wide assignment — and never on a pad. Internal.
 */
CREATE OR REPLACE FUNCTION passport_union_reader_at(p_org uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND app_support_access_id(p_org) IS NULL AND NOT app_is_platform_wide()
     AND app_can('passport.union.read', p_org, NULL::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

/**
 * The consent that opens this boy's passport to the caller as a union: in
 * force (not withdrawn, its giver's link live and no younger than it, db/122),
 * naming his union or the federation, neither archived, at which the caller
 * is a named reader. NULL when there is none. Internal: passport_open() asks
 * it, and passport() and passport_name() log by it.
 */
CREATE OR REPLACE FUNCTION passport_union_consent(p_player uuid) RETURNS uuid AS $$
  SELECT c.id
    FROM passport_consent c
    JOIN player p ON p.id = c.player_id
    JOIN school o ON o.id = c.to_school_id
   WHERE c.player_id = p_player AND c.withdrawn_at IS NULL
     AND consent_giver_live(c.granted_by, c.player_id, c.granted_at)
     AND o.archived_at IS NULL
     AND ((o.kind = 'union' AND o.id = school_union(p.school_id))
          OR (o.kind = 'federation' AND o.id = school_federation()))
     AND passport_union_reader_at(o.id)
   ORDER BY c.granted_at, c.id
   LIMIT 1
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

/**
 * db/122's passport_open(): the family's arm and the arms at his own school
 * are db/116's, line for line; the named-school arm is db/122's and skips a
 * union or the federation; the union's named readers come in through their
 * own arm, last.
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
                    -- A union is not a school: its door is the arm below (db/124).
                    AND NOT institution_is_union(c.to_school_id)
                    AND (app_can('guardian.link.manage', c.to_school_id, '*'::text,
                                 '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
                         OR app_can('team.select', c.to_school_id, '*'::text,
                                    '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)))
      -- His union or CSA Schools, named on a consent in force, to its named
      -- selectors and schools cricket manager only (db/124).
      OR passport_union_consent(p_player) IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §4 · Every union read logged, and shown to his family
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS passport_union_read (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  reader_id  uuid NOT NULL REFERENCES app_user(id),
  org_id     uuid NOT NULL REFERENCES school(id),
  consent_id uuid REFERENCES passport_consent(id) ON DELETE SET NULL,
  what       text NOT NULL CHECK (what IN ('passport', 'name')),
  read_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passport_union_read_player ON passport_union_read (player_id, read_at DESC);
ALTER TABLE passport_union_read ENABLE ROW LEVEL SECURITY;
-- No policy: nobody reads or writes the rows but the definers below, as
-- their owner. No privilege either, so a policy added by mistake opens nothing.
REVOKE ALL ON TABLE passport_union_read FROM PUBLIC;
REVOKE ALL ON TABLE passport_union_read FROM scrbrd_app;
COMMENT ON TABLE passport_union_read IS
  'Every read of a boy''s passport by a union''s named reader (db/124): who, which institution, when, which boy. Shown to his family by passport_union_reads().';

/**
 * Write the record of one union read, before the read answers. Not caught:
 * a read whose record cannot be written does not happen. The access-log row
 * at his school is log_restricted_read()'s, which never fails a read. Internal.
 */
CREATE OR REPLACE FUNCTION passport_union_log(p_player uuid, p_consent uuid, p_what text) RETURNS void AS $$
BEGIN
  INSERT INTO passport_union_read (player_id, reader_id, org_id, consent_id, what)
  SELECT p_player, app_user_id(), c.to_school_id, c.id, p_what
    FROM passport_consent c WHERE c.id = p_consent;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'db/124: a union read of % was not recorded', p_player;
  END IF;
  PERFORM log_restricted_read('passport_union', ARRAY[p_player], ARRAY[p_what], player_school(p_player));
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;

/**
 * db/116's passport(), its lines word for word, VOLATILE now: when the union
 * arm is what lets the caller in, the read is recorded first.
 */
CREATE OR REPLACE FUNCTION passport(p_player uuid)
RETURNS TABLE (family text, label text, value text, on_date date, source_school text,
               recorded_by text, confidence text) AS $$
DECLARE p player%ROWTYPE; v_union uuid;
BEGIN
  SELECT * INTO p FROM player WHERE id = p_player;
  IF NOT FOUND OR NOT passport_open(p_player) THEN RETURN; END IF;
  -- A union's named reader: on the record before a line is given (db/124).
  v_union := passport_union_consent(p_player);
  IF v_union IS NOT NULL THEN PERFORM passport_union_log(p_player, v_union, 'passport'); END IF;
  RETURN QUERY
    SELECT 'career', 'Batting', b.runs || ' runs in ' || b.innings || ' innings' || coalesce(', average ' || round(b.average, 1), ''),
           NULL::date, (SELECT name FROM school WHERE id = p.school_id), 'the ball log', 'derived'
      FROM (SELECT count(*)::int AS innings, coalesce(sum(i.runs), 0)::int AS runs,
                   CASE WHEN count(*) FILTER (WHERE i.out) > 0 THEN sum(i.runs)::numeric / count(*) FILTER (WHERE i.out) END AS average
              FROM player_innings i WHERE i.player_id = p_player) b WHERE b.innings > 0
    UNION ALL
    SELECT 'career', 'Bowling', w.wickets || ' wickets, ' || w.runs || ' runs conceded', NULL, (SELECT name FROM school WHERE id = p.school_id), 'the ball log', 'derived'
      FROM (SELECT coalesce(sum(f.wickets), 0)::int AS wickets, coalesce(sum(f.runs_conceded), 0)::int AS runs, count(*)::int AS n
              FROM bowler_innings_figures f WHERE f.player_id = p_player) w WHERE w.n > 0
    UNION ALL
    SELECT 'honour', honour_kind_label(h.kind, h.name), (SELECT sn.label FROM season sn WHERE sn.id = h.season_id), h.awarded_on,
           (SELECT name FROM school WHERE id = h.school_id),
           coalesce((SELECT u.name FROM app_user u WHERE u.id = h.awarded_by), 'nobody on record'),
           CASE WHEN h.awarded_by IS NULL THEN 'seeded' ELSE 'verified' END
      FROM honour h WHERE h.player_id = p_player AND h.withdrawn_at IS NULL
    UNION ALL
    SELECT 'cap', c.team_code || ' cap #' || c.cap_no, c.appearances || ' appearance' || CASE WHEN c.appearances = 1 THEN '' ELSE 's' END,
           c.first_on, (SELECT name FROM school WHERE id = c.school_id), 'the team sheets', 'derived'
      FROM team_cap c WHERE c.player_id = p_player
    UNION ALL
    SELECT 'milestone', milestone_label(m.kind, m.value), 'v ' || coalesce(m.opponent, '?'), m.played_on,
           (SELECT name FROM school WHERE id = p.school_id), 'the ball log', 'derived'
      FROM player_milestone m WHERE m.player_id = p_player
    ORDER BY 1, 4 DESC NULLS LAST, 2;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * db/116's passport_name(), VOLATILE now: a union's named reader reading the
 * boy's name is recorded as a read of it.
 */
CREATE OR REPLACE FUNCTION passport_name(p_player uuid) RETURNS text AS $$
DECLARE v_name text; v_union uuid;
BEGIN
  SELECT full_name INTO v_name FROM player WHERE id = p_player AND passport_open(p_player);
  IF v_name IS NOT NULL THEN
    v_union := passport_union_consent(p_player);
    IF v_union IS NOT NULL THEN PERFORM passport_union_log(p_player, v_union, 'name'); END IF;
  END IF;
  RETURN v_name;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Who at which union looked at his passport, and when: for every boy the
 * caller is family of on a live link (is_family_of(), db/119: a guardian, or
 * the boy himself), never on a pad. The reader's name and role, the
 * institution, the time, and whether it was the passport or his name.
 */
CREATE OR REPLACE FUNCTION passport_union_reads()
RETURNS TABLE (player_id uuid, read_at timestamptz, reader_name text, reader_role text,
               organisation text, what text) AS $$
  SELECT r.player_id, r.read_at, u.name, role_words('unionselector'), o.name, r.what
    FROM passport_union_read r
    JOIN app_user u ON u.id = r.reader_id
    JOIN school o ON o.id = r.org_id
   WHERE NOT app_pad_scoped() AND is_family_of(r.player_id)
   ORDER BY r.read_at DESC, r.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── Grants ─────────────────────────────────────────────────────────
-- The application's: the doors it calls and the tests its policies ask.
-- Nobody's: the reader test, the opening consent, the log writer and the
-- trigger, called only inside definers (as their owner) or by the trigger.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'passport(uuid)', 'passport_name(uuid)',
                           'passport_consent_in_force(uuid)', 'institution_is_union(uuid)',
                           'passport_consent_recipient_ok(uuid,uuid)', 'passport_union_reads()',
                           'role_words(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['passport_union_reader_at(uuid)', 'passport_union_consent(uuid)',
                           'passport_union_log(uuid,uuid,text)', 'unionselector_assignment_scoped()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'passport(uuid)', 'passport_name(uuid)',
                               'passport_consent_in_force(uuid)', 'institution_is_union(uuid)',
                               'passport_consent_recipient_ok(uuid,uuid)', 'passport_union_reads()',
                               'role_words(text)', 'passport_union_reader_at(uuid)', 'passport_union_consent(uuid)',
                               'passport_union_log(uuid,uuid,text)', 'unionselector_assignment_scoped()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON TABLE passport_union_read FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE f text; r text; v_src text; v_n int;
BEGIN
  -- §1: the capability, its two holders, the role's whole bundle, its
  -- appointers, and the organiser holding nothing of it.
  IF NOT EXISTS (SELECT 1 FROM capability WHERE name = 'passport.union.read' AND NOT platform_only) THEN
    RAISE EXCEPTION 'db/124: passport.union.read is not in the catalogue (or is platform-only)';
  END IF;
  IF (SELECT string_agg(role, ',' ORDER BY role) FROM role_capability WHERE capability = 'passport.union.read')
     IS DISTINCT FROM 'superadmin,unionselector' THEN
    RAISE EXCEPTION 'db/124: passport.union.read is held by %, not the union selector and the owner''s key alone',
      (SELECT string_agg(role, ',' ORDER BY role) FROM role_capability WHERE capability = 'passport.union.read');
  END IF;
  IF (SELECT string_agg(capability, ',' ORDER BY capability) FROM role_capability WHERE role = 'unionselector')
     IS DISTINCT FROM 'passport.union.read,school.read' THEN
    RAISE EXCEPTION 'db/124: the union selector holds more or less than the passport and the school read';
  END IF;
  IF (SELECT string_agg(granter, ',' ORDER BY granter) FROM role_grantable WHERE role = 'unionselector')
     IS DISTINCT FROM 'platformadmin,principal,superadmin' THEN
    RAISE EXCEPTION 'db/124: the union selector is appointed by someone other than a principal and the platform''s keys';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'role_assignment'::regclass
                    AND tgname = 'role_assignment_unionselector_scoped'
                    AND tgfoid = 'unionselector_assignment_scoped()'::regprocedure AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/124: the union selector''s scope trigger is gone or disabled';
  END IF;
  IF role_words('unionselector') <> 'Union Selector' OR role_words('dso') <> 'Safeguarding Officer' THEN
    RAISE EXCEPTION 'db/124: role_words() does not name the union selector, or lost a name';
  END IF;

  -- Every function here pins its search path; the doors and the policies'
  -- tests are definers, the internal three are not.
  FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'passport(uuid)', 'passport_name(uuid)',
                           'passport_consent_in_force(uuid)', 'institution_is_union(uuid)',
                           'passport_consent_recipient_ok(uuid,uuid)', 'passport_union_reads()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/124: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['passport_union_reader_at(uuid)', 'passport_union_consent(uuid)',
                           'passport_union_log(uuid,uuid,text)', 'unionselector_assignment_scoped()', 'role_words(text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = f::regprocedure AND NOT p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/124: % is a definer, or does not pin its search_path', f;
    END IF;
  END LOOP;
  -- The two that write the log are VOLATILE; nothing else here writes.
  IF (SELECT string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text) FROM pg_proc p
       WHERE p.oid IN ('passport(uuid)'::regprocedure, 'passport_name(uuid)'::regprocedure) AND p.provolatile = 'v')
     IS DISTINCT FROM 'passport(uuid),passport_name(uuid)' THEN
    RAISE EXCEPTION 'db/124: passport() or passport_name() is not VOLATILE, and cannot write its log';
  END IF;

  -- Who may call what.
  FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'passport(uuid)', 'passport_name(uuid)',
                           'passport_consent_in_force(uuid)', 'institution_is_union(uuid)',
                           'passport_consent_recipient_ok(uuid,uuid)', 'passport_union_reads()', 'role_words(text)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/124: % is executable by PUBLIC, or not by scrbrd_app', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['passport_union_reader_at(uuid)', 'passport_union_consent(uuid)',
                           'passport_union_log(uuid,uuid,text)', 'unionselector_assignment_scoped()'] LOOP
    IF has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE')
       OR has_function_privilege('public', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/124: % is callable by the application or PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['passport_open(uuid)', 'passport(uuid)', 'passport_name(uuid)',
                               'passport_consent_in_force(uuid)', 'institution_is_union(uuid)',
                               'passport_consent_recipient_ok(uuid,uuid)', 'passport_union_reads()',
                               'role_words(text)', 'passport_union_reader_at(uuid)', 'passport_union_consent(uuid)',
                               'passport_union_log(uuid,uuid,text)', 'unionselector_assignment_scoped()'] LOOP
        IF has_function_privilege(r, f::regprocedure, 'EXECUTE') THEN
          RAISE EXCEPTION 'db/124: % can execute %', r, f;
        END IF;
      END LOOP;
      IF has_table_privilege(r, 'passport_union_read', 'SELECT') OR has_table_privilege(r, 'passport_union_read', 'INSERT') THEN
        RAISE EXCEPTION 'db/124: % can read or write the union read log', r;
      END IF;
    END IF;
  END LOOP;
  -- The log: row security on, no policy, no privilege for the application.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'passport_union_read'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'passport_union_read'::regclass)
     OR has_table_privilege('scrbrd_app', 'passport_union_read', 'SELECT')
     OR has_table_privilege('scrbrd_app', 'passport_union_read', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'passport_union_read', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'passport_union_read', 'DELETE') THEN
    RAISE EXCEPTION 'db/124: the union read log is readable or writable past its definers';
  END IF;

  -- §3: the named-school arm skips a union; the union arm asks the named
  -- reader at the institution the consent names, in force, his own union or
  -- the federation; the reader test refuses a pad, a support session and a
  -- platform-wide caller; db/116's and db/122's checks still hold.
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src FROM pg_proc WHERE oid = 'passport_open(uuid)'::regprocedure;
  IF position('AND NOT institution_is_union(c.to_school_id)' IN v_src) = 0
     OR position('OR passport_union_consent(p_player) IS NOT NULL' IN v_src) = 0
     OR position('consent_giver_live(c.granted_by, c.player_id, c.granted_at)' IN v_src) = 0
     OR v_src LIKE '%player.profile.read%' OR v_src LIKE '%passport.union.read%' THEN
    RAISE EXCEPTION 'db/124: passport_open() is not db/122''s with the union arm and the named-school arm''s cut';
  END IF;
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src FROM pg_proc WHERE oid = 'passport_union_consent(uuid)'::regprocedure;
  IF position('c.withdrawn_at IS NULL' IN v_src) = 0
     OR position('consent_giver_live(c.granted_by, c.player_id, c.granted_at)' IN v_src) = 0
     OR position('o.archived_at IS NULL' IN v_src) = 0
     OR position('(o.kind = ''union'' AND o.id = school_union(p.school_id))' IN v_src) = 0
     OR position('(o.kind = ''federation'' AND o.id = school_federation())' IN v_src) = 0
     OR position('passport_union_reader_at(o.id)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/124: passport_union_consent() is not the in-force consent naming his union, at which the caller reads';
  END IF;
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src FROM pg_proc WHERE oid = 'passport_union_reader_at(uuid)'::regprocedure;
  IF position('NOT app_pad_scoped()' IN v_src) = 0 OR position('app_support_access_id(p_org) IS NULL' IN v_src) = 0
     OR position('NOT app_is_platform_wide()' IN v_src) = 0
     OR position('app_can(''passport.union.read'', p_org, NULL::text,' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/124: passport_union_reader_at() lets in a pad, a support session, a platform-wide caller or a team''s assignment';
  END IF;
  -- No table policy names the capability: the passport is its whole reach.
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE coalesce(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%passport.union.read%'
                                           OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%passport.union.read%') THEN
    RAISE EXCEPTION 'db/124: a table policy names passport.union.read';
  END IF;
  -- §4: both reads write the log when the union arm lets the caller in, and
  -- the passport carries no rating (db/116's check).
  FOREACH f IN ARRAY ARRAY['passport(uuid)', 'passport_name(uuid)'] LOOP
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = f::regprocedure;
    IF position('v_union := passport_union_consent(p_player);' IN v_src) = 0
       OR position('PERFORM passport_union_log(p_player, v_union, ' IN v_src) = 0
       OR position('passport_open(p_player)' IN v_src) = 0 THEN
      RAISE EXCEPTION 'db/124: % does not record a union read', f;
    END IF;
  END LOOP;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'passport(uuid)'::regprocedure) ~ '(player_skill|''rating'')' THEN
    RAISE EXCEPTION 'db/124: passport() carries a rating';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'passport_union_log(uuid,uuid,text)'::regprocedure;
  IF position('INSERT INTO passport_union_read' IN v_src) = 0 OR v_src ~* 'EXCEPTION\s+WHEN' THEN
    RAISE EXCEPTION 'db/124: passport_union_log() does not write the log, or swallows a failure to';
  END IF;
  SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src FROM pg_proc WHERE oid = 'passport_union_reads()'::regprocedure;
  IF position('NOT app_pad_scoped() AND is_family_of(r.player_id)' IN v_src) = 0 THEN
    RAISE EXCEPTION 'db/124: passport_union_reads() answers someone other than his family on a live link';
  END IF;
  -- §2: the union row's readers are his family; the office arm of the
  -- in-force answer is a school's.
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'passport_consent'::regclass AND NOT p.polpermissive
         AND ((p.polname = 'passport_consent_union_is_his' AND p.polcmd = 'a'
               AND pg_get_expr(p.polwithcheck, p.polrelid) = 'passport_consent_recipient_ok(player_id, to_school_id)')
           OR (p.polname = 'passport_consent_union_family_only' AND p.polcmd = 'r'
               AND pg_get_expr(p.polqual, p.polrelid) = '((NOT institution_is_union(to_school_id)) OR is_family_of(player_id))'))) <> 2 THEN
    RAISE EXCEPTION 'db/124: passport_consent''s two RESTRICTIVE union policies are not this file''s';
  END IF;
  IF position('AND NOT institution_is_union(c.to_school_id)' IN
              (SELECT prosrc FROM pg_proc WHERE oid = 'passport_consent_in_force(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/124: passport_consent_in_force() answers a union''s office';
  END IF;
  -- db/122's writer rules still stand beside the new ones.
  SELECT count(*) INTO v_n FROM pg_policy p
   WHERE p.polrelid = 'passport_consent'::regclass AND NOT p.polpermissive
     AND p.polname IN ('passport_consent_writer_of_age_insert', 'passport_consent_withdraw_by_family');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'db/124: db/122''s two RESTRICTIVE write policies are gone';
  END IF;
  -- And they answer for nobody.
  IF institution_is_union(gen_random_uuid()) OR passport_union_consent(gen_random_uuid()) IS NOT NULL
     OR passport_union_reader_at(gen_random_uuid()) OR NOT passport_consent_recipient_ok(gen_random_uuid(), gen_random_uuid()) THEN
    RAISE EXCEPTION 'db/124: a union test said yes about nobody, or no to a school';
  END IF;
END $check$;
