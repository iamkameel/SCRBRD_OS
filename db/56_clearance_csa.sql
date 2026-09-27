-- ══════════════════════════════════════════════════════════════════
--  56 · The clearance register to CSA's rules (K4, SG-7)
-- ══════════════════════════════════════════════════════════════════
--
-- CSA's Safeguarding Policy (2025) wants every adult coach, administrator and
-- technical official checked against the Sexual Offences Register and the
-- Child Protection Register, and given a criminal check, "every 24 months"
-- (p19); the Sexual Offences Register certificate "not older than 24 months"
-- (p24), the Child Protection Register likewise (p25), and the criminal check
-- "not older than 6 months" at the start, then every 24 months (p26). Every
-- coach and every person working within CSA holds a Safeguarding Awareness
-- Certificate, renewed annually (p11, p20, p22); the DSO's training is annual
-- (p19, p22); everyone signs the acknowledgement before they work (p65, p82).
--
-- db/08's register had no Sexual Offences Register kind at all, asked nothing
-- of administrators, asked officials and scorers for one check, and accepted
-- any check for up to five years. (docs/policy/CSA_SAFEGUARDING_CHECK.md K4
-- and SG-7; docs/design/SAFEGUARDING_DSO.md §6.4, §7, §9.3.)
--
-- WHAT CHANGES:
--
--   1. The kinds. adult_clearance.kind gains `sexual_offences_register` (the
--      National Register for Sex Offenders check) and SG-7's five:
--      `safeguarding_awareness` (the SAC), `dso_training`,
--      `good_standing_declaration`, `safeguarding_acknowledgement` (Annexure
--      G and the Code of Ethics signature) and `references_checked` (two
--      references, contacted). What is recorded is unchanged: that a named
--      person saw the document, its reference and dates — never a scan.
--
--   2. clearance_kind_max_days: the longest a check of each kind may run, and
--      how old a FIRST one may be when it is recorded. The three checks 731
--      days (24 months); a first police clearance issued no more than 183 days
--      before it is recorded; the SAC and the DSO's training 366 days. Kinds
--      with no row keep db/08's outer bound (clearance_expiry_within_reason,
--      five years) and nothing else.
--
--   3. adult_clearance_csa_age, BEFORE INSERT: refuses a new row that runs
--      longer than its kind allows, and a first police clearance at the school
--      issued more than 183 days ago. "First" means the person has no other
--      unrevoked police clearance at that school: a renewal is not held to
--      six months (p26 re-checks every 24 months), and a row revoked because
--      it was wrong does not count as a check held. INSERT only: a revocation
--      (the one UPDATE db/08 allows) is never refused, whatever the row's age.
--
--   4. Requirement rows: the three checks, the SAC and the acknowledgement
--      for coach, assistantcoach, teammanager, medical, driver,
--      transportcoordinator, official, scorer, facilities, media, scout,
--      schooladmin, sportsadmin, directorofsport and principal. db/08's rows
--      (first aid, the driving permit) stay. `dso` does not exist yet: its
--      rows (the three, the SAC, dso_training) are phase 1's (§9.1).
--
--   5. clearance_register() excludes a pupil: a person holding a live
--      `player` assignment whose own player record (app_user.player_id, or a
--      live selfaccess 'self' link) says he is under eighteen today. CSA asks
--      this of adults (p19), and a boy who scores for his side is not "missing"
--      a police clearance. Someone holding `player` whose record says eighteen
--      or more, or who has no linked record at all, stays on the register:
--      where the platform does not know he is a child, the gap stays loud.
--
-- WHAT DOES NOT CHANGE, on purpose:
--
--   - EXISTING ROWS ARE LEFT ALONE. A police clearance recorded last year to
--     run five years still reads `current` until its own date, and `expiring`
--     sixty days before it; nothing is re-dated, re-statused or refused. It
--     lapses on its own; the renewal is held to 24 months. (A school that
--     wants to act sooner revokes and records afresh.)
--   - NOTHING THAT BLOCKS A MATCH OR A TRIP REFUSES MORE FROM THE PASTE. The
--     one guard that reads the register, trip_driver_cleared() (db/08), is
--     unchanged: a KNOWN expired or revoked check refuses; a MISSING one never
--     does. Every new requirement starts MISSING for everyone, so on the day
--     this is pasted no trip and no driver is refused that was not before,
--     and the register (not the road) is where the new gaps show. Once an
--     office records one of the new kinds for a driver and it later lapses or
--     is revoked, that guard refuses him exactly as it does for a lapsed
--     police clearance today — db/08's rule, reading the requirement table.
--   - clearance_status() and the read API's status words: unchanged.
--
-- Safe to run twice: the CHECK and trigger are dropped and re-added, the
-- reference rows upserted, the functions replaced.

-- ── 1. The kinds ────────────────────────────────────────────────────
ALTER TABLE adult_clearance DROP CONSTRAINT IF EXISTS adult_clearance_kind_check;
ALTER TABLE adult_clearance DROP CONSTRAINT IF EXISTS adult_clearance_kind;
ALTER TABLE adult_clearance ADD CONSTRAINT adult_clearance_kind CHECK (kind IN (
  -- db/08's
  'police_clearance', 'child_protection', 'first_aid', 'driving_permit', 'coaching_accreditation',
  -- K4: the National Register for Sex Offenders (CSA p19, p24)
  'sexual_offences_register',
  -- SG-7 (CSA p11, p17, p19, p20, p22, p23, p65, p82)
  'safeguarding_awareness', 'dso_training', 'good_standing_declaration',
  'safeguarding_acknowledgement', 'references_checked'));

CREATE OR REPLACE FUNCTION clearance_kind_label(p_kind text) RETURNS text AS $$
  SELECT CASE p_kind
    WHEN 'police_clearance'             THEN 'police clearance'
    WHEN 'child_protection'             THEN 'Children''s Act register clearance'
    WHEN 'first_aid'                    THEN 'first aid certificate'
    WHEN 'driving_permit'               THEN 'professional driving permit'
    WHEN 'coaching_accreditation'       THEN 'coaching accreditation'
    WHEN 'sexual_offences_register'     THEN 'Sexual Offences Register clearance'
    WHEN 'safeguarding_awareness'       THEN 'Safeguarding Awareness Certificate'
    WHEN 'dso_training'                 THEN 'DSO training'
    WHEN 'good_standing_declaration'    THEN 'declaration of good standing'
    WHEN 'safeguarding_acknowledgement' THEN 'signed safeguarding acknowledgement'
    WHEN 'references_checked'           THEN 'references checked'
    ELSE p_kind END;
$$ LANGUAGE sql IMMUTABLE;

-- ── 2. How long each kind may run ───────────────────────────────────
CREATE TABLE IF NOT EXISTS clearance_kind_max_days (
  kind           text PRIMARY KEY,
  -- The longest expires_on - issued_on a new row of this kind may have.
  max_days       integer NOT NULL CHECK (max_days BETWEEN 1 AND 1827),
  -- The oldest a person's FIRST row of this kind at a school may be, in days
  -- before the day it is recorded. NULL: no such rule.
  first_max_days integer CHECK (first_max_days IS NULL OR first_max_days BETWEEN 1 AND 1827),
  -- Where the number comes from, for the next person to read this table.
  source         text NOT NULL
);
ALTER TABLE clearance_kind_max_days ENABLE ROW LEVEL SECURITY;
-- Platform reference data, like clearance_requirement: readable by anybody
-- signed in (a coach may know how long his check lasts), written by nobody
-- through the API — there is no write policy.
DROP POLICY IF EXISTS clearance_kind_max_days_read ON clearance_kind_max_days;
CREATE POLICY clearance_kind_max_days_read ON clearance_kind_max_days
  FOR SELECT USING (app_user_id() IS NOT NULL);
-- And, like every table behind RLS since db/50, closed to a pad's resume
-- credential: a RESTRICTIVE pad_scope_select that is false under pad scope.
SELECT pad_scope_guard_install('clearance_kind_max_days'::regclass);

INSERT INTO clearance_kind_max_days (kind, max_days, first_max_days, source) VALUES
  ('police_clearance',         731, 183,  'CSA Safeguarding Policy p19, p26: every 24 months; not older than 6 months at the start'),
  ('child_protection',         731, NULL, 'CSA Safeguarding Policy p19, p25: not older than 24 months'),
  ('sexual_offences_register', 731, NULL, 'CSA Safeguarding Policy p19, p24: not older than 24 months'),
  ('safeguarding_awareness',   366, NULL, 'CSA Safeguarding Policy p11, p20, p22: renewed annually'),
  ('dso_training',             366, NULL, 'CSA Safeguarding Policy p19, p22: annual')
ON CONFLICT (kind) DO UPDATE
  SET max_days = EXCLUDED.max_days, first_max_days = EXCLUDED.first_max_days, source = EXCLUDED.source;

-- ── 3. The rule, on every new row ───────────────────────────────────
-- SECURITY DEFINER because "first at this school" is a question about every
-- row the person has there, and the office recording one may hold
-- clearance.manage without clearance.read: under its own RLS it would see no
-- earlier row and refuse a renewal as a first. It reads, and refuses; it
-- writes nothing.
CREATE OR REPLACE FUNCTION adult_clearance_csa_age() RETURNS trigger AS $$
DECLARE
  r      clearance_kind_max_days%ROWTYPE;
  v_from date;
BEGIN
  SELECT * INTO r FROM clearance_kind_max_days WHERE kind = NEW.kind;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.expires_on > NEW.issued_on + r.max_days THEN
    RAISE EXCEPTION 'a % runs at most % days under CSA''s Safeguarding Policy: one issued on % is re-checked by %, not %',
                    clearance_kind_label(NEW.kind), r.max_days, NEW.issued_on,
                    NEW.issued_on + r.max_days, NEW.expires_on
      USING ERRCODE = 'check_violation';
  END IF;
  IF r.first_max_days IS NOT NULL THEN
    v_from := sa_today() - r.first_max_days;
    IF NEW.issued_on < v_from
       AND NOT EXISTS (SELECT 1 FROM adult_clearance ac
                        WHERE ac.person_id = NEW.person_id AND ac.school_id = NEW.school_id
                          AND ac.kind = NEW.kind AND ac.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'a first % must be no older than % days when it is recorded (CSA''s Safeguarding Policy): this one was issued on %, and the oldest accepted today is %',
                      clearance_kind_label(NEW.kind), r.first_max_days, NEW.issued_on, v_from
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION adult_clearance_csa_age() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION adult_clearance_csa_age() TO scrbrd_app;

DROP TRIGGER IF EXISTS adult_clearance_csa_age ON adult_clearance;
CREATE TRIGGER adult_clearance_csa_age BEFORE INSERT ON adult_clearance
  FOR EACH ROW EXECUTE FUNCTION adult_clearance_csa_age();

-- ── 4. Who needs what ───────────────────────────────────────────────
INSERT INTO clearance_requirement (role, kind)
SELECT r, k
  FROM unnest(ARRAY['coach', 'assistantcoach', 'teammanager', 'medical', 'driver',
                    'transportcoordinator', 'official', 'scorer', 'facilities', 'media',
                    'scout', 'schooladmin', 'sportsadmin', 'directorofsport', 'principal']) AS r,
       unnest(ARRAY['police_clearance', 'child_protection', 'sexual_offences_register',
                    'safeguarding_awareness', 'safeguarding_acknowledgement']) AS k
ON CONFLICT (role, kind) DO NOTHING;

-- ── 5. The register, without the pupils ─────────────────────────────
-- db/08's, verbatim, with the pupil exclusion (the NOT EXISTS) and its grant
-- narrowed to the application: it is called by the read API as scrbrd_app
-- and by nothing else.
CREATE OR REPLACE FUNCTION clearance_register(p_school uuid)
RETURNS TABLE (person_id uuid, name text, role text, kind text, status text,
               expires_on date, clearance_id uuid, reference text, school_id uuid) AS $$
BEGIN
  IF NOT app_can('clearance.read', p_school, '*',
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT ON (u.id, ra.role, cr.kind)
           u.id, u.name, ra.role, cr.kind, cs.status, cs.expires_on, cs.clearance_id, cs.reference, p_school
      FROM role_assignment ra
      JOIN app_user u ON u.id = ra.person_id
      JOIN clearance_requirement cr ON cr.role = ra.role
      CROSS JOIN LATERAL clearance_status(ra.person_id, p_school, cr.kind) cs
     WHERE ra.school_id = p_school AND ra.active AND u.active
       AND (ra.valid_from IS NULL OR ra.valid_from <= current_date)
       AND (ra.valid_until IS NULL OR ra.valid_until > current_date)
       -- A pupil is not an adult (CSA p19): a live `player` assignment
       -- anywhere, and his own record says he is under eighteen today.
       AND NOT EXISTS (
         SELECT 1
           FROM role_assignment pa
           JOIN player p ON p.id = u.player_id
                         OR p.id IN (SELECT s.player_id
                                       FROM role_assignment sa
                                       JOIN assignment_subject s ON s.assignment_id = sa.id
                                      WHERE sa.person_id = u.id AND sa.role = 'selfaccess' AND sa.active
                                        AND s.relationship = 'self'
                                        AND (s.valid_until IS NULL OR s.valid_until > current_date))
          WHERE pa.person_id = u.id AND pa.role = 'player' AND pa.active
            AND (pa.valid_until IS NULL OR pa.valid_until > current_date)
            AND p.born IS NOT NULL AND majority_on(p.born) > sa_today())
     ORDER BY u.id, ra.role, cr.kind;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION clearance_register(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clearance_register(uuid) TO scrbrd_app;

-- A managed host's API roles get EXECUTE on functions and privileges on
-- tables in public by default, directly rather than through PUBLIC (db/29).
DO $revoke_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION adult_clearance_csa_age() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION clearance_register(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE clearance_kind_max_days FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f      text;
  v_def  text;
  v_n    int;
  v_miss text;
BEGIN
  -- The vocabulary: db/08's five and the six new kinds, and nothing else.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'adult_clearance'::regclass AND conname = 'adult_clearance_kind';
  IF v_def IS NULL THEN RAISE EXCEPTION 'db/56: adult_clearance_kind is missing'; END IF;
  FOREACH f IN ARRAY ARRAY['police_clearance', 'child_protection', 'first_aid', 'driving_permit',
                           'coaching_accreditation', 'sexual_offences_register', 'safeguarding_awareness',
                           'dso_training', 'good_standing_declaration', 'safeguarding_acknowledgement',
                           'references_checked'] LOOP
    IF v_def NOT LIKE '%''' || f || '''%' THEN
      RAISE EXCEPTION 'db/56: the kind % is not in the vocabulary', f;
    END IF;
    IF clearance_kind_label(f) = f THEN
      RAISE EXCEPTION 'db/56: the kind % has no label', f;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'adult_clearance'::regclass
                AND conname = 'adult_clearance_kind_check') THEN
    RAISE EXCEPTION 'db/56: db/08''s kind CHECK is still there beside the new one';
  END IF;

  -- The ages.
  IF (SELECT string_agg(kind || '=' || max_days || '/' || coalesce(first_max_days::text, '-'), ' ' ORDER BY kind)
        FROM clearance_kind_max_days)
     IS DISTINCT FROM 'child_protection=731/- dso_training=366/- police_clearance=731/183 safeguarding_awareness=366/- sexual_offences_register=731/-' THEN
    RAISE EXCEPTION 'db/56: clearance_kind_max_days is not CSA''s 24 months, 6 months and one year';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'adult_clearance'::regclass
                    AND tgname = 'adult_clearance_csa_age' AND NOT tgisinternal
                    AND tgtype & 4 = 4 AND tgtype & 16 = 0) THEN   -- INSERT, not UPDATE
    RAISE EXCEPTION 'db/56: adult_clearance_csa_age is not a BEFORE INSERT (and only INSERT) trigger';
  END IF;

  -- Every adult role holds the five new requirements; db/08's rows remain.
  SELECT count(*) INTO v_n FROM clearance_requirement
   WHERE kind IN ('police_clearance', 'child_protection', 'sexual_offences_register',
                  'safeguarding_awareness', 'safeguarding_acknowledgement')
     AND role IN ('coach', 'assistantcoach', 'teammanager', 'medical', 'driver',
                  'transportcoordinator', 'official', 'scorer', 'facilities', 'media',
                  'scout', 'schooladmin', 'sportsadmin', 'directorofsport', 'principal');
  IF v_n <> 75 THEN
    RAISE EXCEPTION 'db/56: % of the 75 requirement rows (15 roles x 5 checks) are present', v_n;
  END IF;
  SELECT string_agg(role || '/' || kind, ' ') INTO v_miss FROM (VALUES
      ('coach', 'first_aid'), ('assistantcoach', 'first_aid'), ('driver', 'driving_permit')) AS x(role, kind)
   WHERE NOT EXISTS (SELECT 1 FROM clearance_requirement c WHERE c.role = x.role AND c.kind = x.kind);
  IF v_miss IS NOT NULL THEN RAISE EXCEPTION 'db/56: db/08''s requirement rows are gone: %', v_miss; END IF;
  IF EXISTS (SELECT 1 FROM clearance_requirement
              WHERE role IN ('player', 'selfaccess', 'guardian', 'spectator', 'enquiry')) THEN
    RAISE EXCEPTION 'db/56: a pupil''s or a parent''s role is asked for a clearance';
  END IF;

  -- The register excludes pupils; the guard is db/08's, untouched.
  SELECT prosrc INTO v_def FROM pg_proc WHERE oid = 'clearance_register(uuid)'::regprocedure;
  IF v_def NOT LIKE '%majority_on(p.born) > sa_today()%' THEN
    RAISE EXCEPTION 'db/56: clearance_register() does not leave pupils off';
  END IF;
  SELECT prosrc INTO v_def FROM pg_proc WHERE oid = 'trip_driver_cleared()'::regprocedure;
  IF v_def NOT LIKE '%IF cs.status = ''expired'' THEN%' OR v_def LIKE '%''missing''%' THEN
    RAISE EXCEPTION 'db/56: trip_driver_cleared() no longer refuses only a known lapse';
  END IF;

  -- Definers: pinned, and the application's alone.
  FOREACH f IN ARRAY ARRAY['adult_clearance_csa_age()', 'clearance_register(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/56: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/56: % is executable by PUBLIC', f;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/56: scrbrd_app cannot execute %', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(r.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/56: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'clearance_kind_max_days'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'db/56: clearance_kind_max_days has no row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clearance_kind_max_days'
                AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'db/56: clearance_kind_max_days has a write policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'clearance_kind_max_days'
                    AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'db/56: clearance_kind_max_days has no RESTRICTIVE pad_scope_select (db/50)';
  END IF;
END $check$;
