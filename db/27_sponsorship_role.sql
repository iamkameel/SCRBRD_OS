-- ══════════════════════════════════════════════════════════════════
--  27 · The commercial half of `finance` becomes its own role (SCRBRD-030)
-- ══════════════════════════════════════════════════════════════════
--
-- SCRBRD-030 put every capability on a five-level sensitivity scale, which
-- pulled invoice.read/invoice.manage into SENSITIVE. The old `finance` bundle
-- then held the school's invoices and a sponsor's contract value together —
-- the crossing separation.test.mjs §21.10 exists to catch. So the bundle
-- splits: `finance` keeps the invoices, a new `sponsorship` role takes
-- sponsorship.read, sponsorship.manage and sponsorship.finance.read.
--
-- That change first shipped as a regenerated db/01_authz.sql, which is the
-- one thing a live database cannot take: db/01 has run on production and the
-- ledger refuses a file whose hash moved. generate-rls.mjs now keeps db/01
-- byte-identical to what shipped (WITHDRAWN_SINCE_01 re-emits finance's three
-- rows, ROLES_ADDED_SINCE_01 leaves `sponsorship` out), and this file is where
-- every database — fresh or live — actually receives the split.
--
-- NOBODY LOSES ACCESS HERE. Every live `finance` appointment is matched by a
-- `sponsorship` appointment with the same person, scope and validity, so a
-- bursar who could read a contract value yesterday still can. What changes is
-- that a school may now withdraw one without the other. On a fresh install
-- there are no appointments yet and the copy does nothing.
--
-- Four steps, in the order the foreign keys need:
--   1. finance loses the three commercial capabilities
--   2. sponsorship receives its bundle (the catalogue rows already exist)
--   3. principal, platformadmin and superadmin may appoint it
--   4. live finance appointments are matched
--
-- Safe to run twice.

DELETE FROM role_capability
 WHERE role = 'finance'
   AND capability IN ('sponsorship.read', 'sponsorship.manage', 'sponsorship.finance.read');

INSERT INTO role_capability (role, capability) VALUES
  ('sponsorship', 'school.read'),
  ('sponsorship', 'news.read'),
  ('sponsorship', 'user.read'),
  ('sponsorship', 'sponsorship.read'),
  ('sponsorship', 'sponsorship.manage'),
  ('sponsorship', 'sponsorship.finance.read')
ON CONFLICT DO NOTHING;

INSERT INTO role_grantable (granter, role) VALUES
  ('principal',     'sponsorship'),
  ('platformadmin', 'sponsorship'),
  ('superadmin',    'sponsorship')
ON CONFLICT DO NOTHING;

INSERT INTO role_assignment (person_id, role, school_id, team_code, season, fixture_id,
                             active, valid_from, valid_until, expires_at)
SELECT f.person_id, 'sponsorship', f.school_id, f.team_code, f.season, f.fixture_id,
       true, f.valid_from, f.valid_until, f.expires_at
  FROM role_assignment f
 WHERE f.role = 'finance' AND f.active
   AND NOT EXISTS (
     SELECT 1 FROM role_assignment s
      WHERE s.role = 'sponsorship' AND s.active
        AND s.person_id = f.person_id
        AND s.school_id IS NOT DISTINCT FROM f.school_id);

-- ── Assertion ──────────────────────────────────────────────────────
DO $check$
DECLARE
  bundle text[];
BEGIN
  IF EXISTS (SELECT 1 FROM role_capability
              WHERE role = 'finance' AND capability LIKE 'sponsorship.%') THEN
    RAISE EXCEPTION 'db/27: finance still holds a sponsorship capability';
  END IF;
  SELECT array_agg(capability ORDER BY capability) INTO bundle
    FROM role_capability WHERE role = 'sponsorship';
  IF bundle IS DISTINCT FROM ARRAY['news.read', 'school.read', 'sponsorship.finance.read',
                                   'sponsorship.manage', 'sponsorship.read', 'user.read'] THEN
    RAISE EXCEPTION 'db/27: sponsorship bundle is %, not the one this file grants', bundle;
  END IF;
  -- The crossing this split exists to prevent, stated once more in SQL.
  IF EXISTS (SELECT 1 FROM role_capability a JOIN role_capability b USING (role)
              WHERE a.capability = 'invoice.read' AND b.capability = 'sponsorship.finance.read'
                AND role <> 'superadmin') THEN
    RAISE EXCEPTION 'db/27: a role other than superadmin holds invoices and contract values together';
  END IF;
  IF (SELECT count(*) FROM role_grantable WHERE role = 'sponsorship') <> 3 THEN
    RAISE EXCEPTION 'db/27: sponsorship is not appointable by exactly principal, platformadmin and superadmin';
  END IF;
  IF EXISTS (SELECT 1 FROM role_assignment f
              WHERE f.role = 'finance' AND f.active
                AND NOT EXISTS (SELECT 1 FROM role_assignment s
                                 WHERE s.role = 'sponsorship' AND s.active
                                   AND s.person_id = f.person_id
                                   AND s.school_id IS NOT DISTINCT FROM f.school_id)) THEN
    RAISE EXCEPTION 'db/27: a finance appointment lost its commercial access';
  END IF;
END $check$;
