-- ══════════════════════════════════════════════════════════════════
--  154 · Switched off still records: a DRS review is stored while the
--        feature is off, and shown only once it is on
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's rule, 13 Nov 2026: "Anything that's switched off
-- for a user should be hidden for that user but still record data." His
-- scope, "as recommended": keep recording while off for the modules that
-- hold no child's own data, and keep refusing any part of a write that has
-- an outward or public effect. Then, 14 Nov 2026, "as recommended": other
-- sports' fixtures STAY REFUSED while the sport is off, because a fixture
-- carries a squad of children and their availability (Fable's red-team of
-- this file, F1 and F2). So this file is DRS alone.
--
-- The rest of the rule is not here. Logistics, broadcast's settings and a
-- sponsor signed were gated in the API only (server.mjs) and are lifted
-- there; Officials stays refused; the scorebook reader's read stays refused
-- (sending page photos to an outside provider is the outward act, db/66);
-- match_sport_is_enabled() (db/08) is not touched.
--
-- WHAT MOVES.
--   ~ drs_review_feature_gate()  RETURNS NEW: the drs_review feature is no
--       longer asked when a review row is written. A review records a
--       decision already given on the field and sends nothing anywhere: no
--       function or view reads drs_review, so nothing in the fold, the score
--       or a public page moves. Who may write one is unchanged
--       (drs_review_insert / _update, scoring.correct over the fixture), and
--       the read stays refused while the feature is off (read-api.mjs,
--       OWNER_OF_READ drs_reviews; the panel is hidden, views/drs.jsx). The
--       trigger drs_review_gate (db/08) stays, so a later decision to gate a
--       part of the row again has its one place.
--     Its EXECUTE is revoked from PUBLIC and a managed host's API roles: a
--     trigger function is never called by name, and firing a trigger asks
--     no privilege of the writer.
--
-- THE GUARD keys on pg_proc.prosrc as db/149 and db/155 do: the md5 of the
-- body this file replaces, whitespace folded, must be db/08's or this
-- file's, and the trigger must exist on drs_review and call this function.
-- A body moved by another file since stops the paste. A second paste
-- changes nothing. Pasting db/08 again after this file would put the gate
-- back: db/08 cannot follow it.
--
-- One transaction: the paste runs the file inside one, so there is no
-- BEGIN or COMMIT here. Its proof is db/99 §132; the walks are smoke-drs
-- and smoke-browser-drs.

CREATE OR REPLACE FUNCTION pg_temp._v154_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

-- ── 0 · What this file was written against ─────────────────────────
DO $guard$
DECLARE v text;
BEGIN
  IF to_regclass('drs_review') IS NULL OR to_regprocedure('drs_review_feature_gate()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = 'drs_review'::regclass AND t.tgname = 'drs_review_gate' AND NOT t.tgisinternal
                       AND t.tgfoid = 'drs_review_feature_gate()'::regprocedure) THEN
    RAISE EXCEPTION 'db/154: drs_review, its gate drs_review_feature_gate() or the trigger drs_review_gate calling it is missing; apply db/08 first';
  END IF;
  SELECT pg_temp._v154_fold(p.prosrc) INTO v FROM pg_proc p WHERE p.oid = 'drs_review_feature_gate()'::regprocedure;
  IF v NOT IN ('bf1d8234997bb7fe6a3faeaacbd66497',   -- db/08's
               'ac2bc55c25c62b44767004e860858f36') THEN -- this file's
    RAISE EXCEPTION 'db/154: drs_review_feature_gate() is not db/08''s body or this file''s (md5 % of its folded body); look before replacing it', v;
  END IF;
END $guard$;

-- ── 1 · A review row stores while the feature is off ───────────────
CREATE OR REPLACE FUNCTION drs_review_feature_gate() RETURNS trigger AS $$
BEGIN
  -- Switched off records (db/154, Kameel 13 Nov 2026): the feature is not
  -- asked. The review is stored, and shown only where drs_review is on.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

-- ── 2 · Grants ─────────────────────────────────────────────────────
DO $grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION drs_review_feature_gate() FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION drs_review_feature_gate() FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

-- ── 3 · After: refuse to commit a file that did not do what it says ──
DO $after$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'drs_review_feature_gate()'::regprocedure
              AND (p.prosrc ~* 'feature_(enabled|flag|grant|suppression)' OR p.prosecdef
                   OR NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'], false))) THEN
    RAISE EXCEPTION 'db/154: drs_review_feature_gate() still asks a feature, is a definer, or its path is not pinned';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'drs_review'::regclass AND t.tgname = 'drs_review_gate' AND NOT t.tgisinternal
         AND t.tgenabled <> 'D' AND t.tgfoid = 'drs_review_feature_gate()'::regprocedure
         AND (t.tgtype & 2) = 2                     -- BEFORE
         AND (t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16) <> 1 THEN   -- INSERT and UPDATE
    RAISE EXCEPTION 'db/154: drs_review_gate is not one enabled BEFORE INSERT OR UPDATE trigger calling drs_review_feature_gate()';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = 'drs_review_feature_gate()'::regprocedure AND a.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'db/154: drs_review_feature_gate() is executable by a role other than its owner';
  END IF;
END $after$;
