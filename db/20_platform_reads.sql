-- ══════════════════════════════════════════════════════════════════
--  20 · A read across every tenant is on the record
-- ══════════════════════════════════════════════════════════════════
--
-- SCRBRD-026. access_log (db/08) records a restricted read: which columns
-- about which children came back, to whom, on what device. It records it the
-- same way for everyone, and that is the gap the security audit named (§8).
-- A person holding a platform-wide assignment — school_id NULL: the owner's
-- key, a platform administrator — reaches every school at once, and a roster
-- read that is routine for a school's own office is, for them, a read across
-- a tenant boundary. Nothing in the row distinguished the two, and only a
-- read that disclosed a restricted column was written at all.
--
-- Two additions, both small. The row now says whether the reader was
-- platform-wide at the time — decided here, at write time, by the same
-- liveness rule app_can() applies, never copied from the caller. And
-- read-api.mjs logs EVERY read such a reader makes that returned rows, not
-- only the restricted ones: a fixture list is nobody's disclosure when a
-- coach reads their own, and it is the whole platform's when the owner does.
ALTER TABLE access_log ADD COLUMN IF NOT EXISTS platform_wide boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS access_log_platform_wide_idx
  ON access_log (occurred_at DESC) WHERE platform_wide;

-- Does the caller hold a LIVE platform-wide assignment? The same liveness
-- app_can() and app_holds() apply, so a key that lapsed yesterday is not
-- platform-wide today — which is what SCRBRD-012's time-boxed support
-- assignment will lean on.
CREATE OR REPLACE FUNCTION app_is_platform_wide() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.person_id = app_user_id()
       AND a.active AND a.school_id IS NULL
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION app_is_platform_wide() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_platform_wide() TO PUBLIC;

-- log_restricted_read() stamps it. Same signature, so nothing that calls it
-- changes; the one thing added is the column, and it is decided in here.
-- Everything else is db/08's, including the rule that a logging failure
-- must never fail the read it is logging.
CREATE OR REPLACE FUNCTION log_restricted_read(
  p_resource text,
  p_ids      uuid[],
  p_fields   text[],
  p_school   uuid DEFAULT NULL
) RETURNS void AS $$
BEGIN
  IF app_user_id() IS NULL THEN RETURN; END IF;
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count,
                          fields, device_id, platform_wide)
  VALUES (p_school, app_user_id(), p_resource,
          coalesce(p_ids, '{}'), coalesce(array_length(p_ids, 1), 0),
          coalesce(p_fields, '{}'), app_device_id(), app_is_platform_wide());
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
