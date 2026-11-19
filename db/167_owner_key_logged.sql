-- ══════════════════════════════════════════════════════════════════
--  167 · The owner's key is logged off the read path too, and the
--        school's record names it as the platform
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. PLATFORM_CONTROLS slice 6a (Q7, Kameel, 31 Oct 2026: "log
-- its reads now"; fast-tracked 19 Nov 2026). The proof the slice names: a
-- read by the key at a school lands in that school's access_log and in the
-- parent's view of who read her child's record, the reader named as the
-- platform (§6: "the actor shown as platform owner"; INCIDENTS D20: "the
-- platform" as the reader's role), never by a person's name.
--
-- ── WHAT WAS FOUND (a fresh database, the key signed in, every route) ──
-- db/20, db/22 and db/139 hold for the read path: every /api/read/ answer
-- the key gets is logged per school, and every plain-INSERT row the key
-- writes is stamped platform-wide. Three gaps remained:
--   1. The GET routes outside /api/read/ write nothing for anybody, the key
--      included: a child's public name with his guardians' names and their
--      answers (/api/players/:id/public-name), the team sheet by name, the
--      ball log, Player of the Match, a pupil's account and his sign-ins,
--      among others. read-api.mjs's rule (db/20: a platform-wide reader's
--      every read is on the record) never reached them. log_platform_read()
--      below is the one statement the dispatcher runs after such a route
--      answers; for anybody who is neither platform-wide nor in a support
--      session it writes nothing.
--   2. read-api.mjs filed the key's read of a notice about a child
--      (`notifications`, subject_person_id) under his school naming nobody.
--      Fixed in the read path, not here.
--   3. The office's list named the key's reader by nothing ("—"), and only
--      because app_user's own policy hides a platform account's name; a
--      name the office could read would have shown. access_log_platform_
--      reader() lets the list say "SCRBRD platform" for a reader who holds
--      or held the owner's key or platformadmin, and never his name.
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   function access_log_platform_reader(uuid): new; a pinned STABLE
--     SECURITY DEFINER, executable by scrbrd_app alone. It answers one
--     boolean about one id: whether that person has a platform assignment
--     (superadmin or platformadmin, at no school) on record, live or ended,
--     so a key that has since lapsed is still named the platform.
--   function log_platform_read(text, uuid[], uuid, uuid, boolean): new; an
--     INVOKER (no privilege of its own: it reads player, match, match_squad
--     and role_assignment as the caller reads them), executable by
--     scrbrd_app alone. It writes through log_restricted_read() (db/22), so
--     every row is stamped platform-wide and with the support session there,
--     exactly as a read-path row is.
-- No table, column, policy, capability or role. Rows already written are
-- not touched. A second paste changes nothing.
--
-- Its proof is db/99 §144; the walks are smoke-who-read (the key's reads off
-- the read path, on the office's per-child answer as "SCRBRD platform") and
-- smoke-browser-support (the same row on the screen the office answers from).
-- Not to be pasted before it is reviewed.

DO $guard$
BEGIN
  IF to_regprocedure('log_restricted_read(text, uuid[], text[], uuid)') IS NULL
     OR to_regprocedure('app_is_platform_wide()') IS NULL
     OR to_regprocedure('app_support_access_id(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/167 needs db/20 and db/22 (log_restricted_read, app_is_platform_wide, app_support_access_id): paste them first';
  END IF;
  IF to_regprocedure('access_log_platform_stamp()') IS NULL THEN
    RAISE EXCEPTION 'db/167 needs db/139 (access_log_platform_stamp): paste it first';
  END IF;
  IF to_regprocedure('api_role_reach(name)') IS NULL THEN
    RAISE EXCEPTION 'db/167 needs db/157 (api_role_reach): paste it first';
  END IF;
END $guard$;

-- ── 0 · Ten seconds for a lock, or nothing (db/158, db/161, db/165) ──
-- A plain SET, so it holds for every statement after it however the file is
-- run; the file's last statement RESETs it, so a pooled connection is handed
-- back as it came.
SET lock_timeout = '10s';


-- ══════════════════════════════════════════════════════════════════
-- §1 · Is this reader the platform?
-- ══════════════════════════════════════════════════════════════════
/**
 * True when the person holds, or once held, a platform assignment: the
 * owner's key (superadmin) or platformadmin, at no school (db/86's rule).
 * The office's list of who read what calls it on its own rows, to name such
 * a reader "SCRBRD platform" rather than by name. Ended assignments count:
 * the row records the read, and the reader was the platform when it was made.
 */
CREATE OR REPLACE FUNCTION access_log_platform_reader(p_person uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.person_id = p_person AND a.school_id IS NULL
       AND a.role IN ('superadmin', 'platformadmin'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §2 · A read off the read path, on the record
-- ══════════════════════════════════════════════════════════════════
/**
 * After a GET route outside /api/read/ answers (server.mjs, PLATFORM_LOGGED),
 * the dispatcher hands this the route's name, every id in the answer it is
 * about to send, and the route's subject: a fixture, an account, or neither.
 * For a caller who is neither platform-wide nor in a support session it
 * returns at once and writes nothing: a school reader's log is unchanged.
 * For the key, a platform administrator or a support session, one row per
 * school, as read-api.mjs files a platform-wide read:
 *   - each child whose id came back, under his school (read as the caller
 *     reads player: no new reach);
 *   - p_squad: the fixture's named side, when the answer names its boys by
 *     name and not by id (the team sheet, the ground's names);
 *   - p_match: both of the fixture's schools, so a read that names no child
 *     is still in each school's log;
 *   - p_account: the account, under each school it is appointed at, with the
 *     child it is the pupil's own self-access to;
 *   - nothing resolvable at all: one row under no school, still platform-wide.
 * Rows are written by log_restricted_read(), which stamps platform_wide and
 * the support session and never fails the read it records.
 */
CREATE OR REPLACE FUNCTION log_platform_read(
  p_resource text,
  p_seen     uuid[],
  p_match    uuid    DEFAULT NULL,
  p_account  uuid    DEFAULT NULL,
  p_squad    boolean DEFAULT false
) RETURNS void AS $$
DECLARE r record; n int := 0;
BEGIN
  IF app_user_id() IS NULL OR NOT (app_is_platform_wide() OR app_support_access_id() IS NOT NULL) THEN
    RETURN;
  END IF;
  FOR r IN
    WITH named AS (
      SELECT p.school_id, p.id FROM player p WHERE p.id = ANY (coalesce(p_seen, '{}'))
      UNION
      SELECT p.school_id, p.id FROM match_squad s JOIN player p ON p.id = s.player_id
       WHERE p_squad AND p_match IS NOT NULL AND s.match_id = p_match AND NOT s.withdrawn
      UNION
      SELECT a.school_id, g.player_id FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
       WHERE p_account IS NOT NULL AND a.person_id = p_account AND a.role = 'selfaccess'
      UNION
      SELECT a.school_id, p_account FROM role_assignment a
       WHERE p_account IS NOT NULL AND a.person_id = p_account AND a.school_id IS NOT NULL
    ), schools AS (
      SELECT n.school_id FROM named n WHERE n.school_id IS NOT NULL
      UNION
      SELECT s FROM match m, unnest(ARRAY[m.school_id, m.away_school_id]) s
       WHERE p_match IS NOT NULL AND m.id = p_match AND s IS NOT NULL
    )
    SELECT s.school_id,
           coalesce((SELECT array_agg(DISTINCT n.id) FROM named n WHERE n.school_id = s.school_id), '{}') AS ids
      FROM schools s
  LOOP
    PERFORM log_restricted_read(p_resource, r.ids[1:500], '{}'::text[], r.school_id);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    PERFORM log_restricted_read(p_resource, '{}'::uuid[], '{}'::text[], NULL);
  END IF;
END $$ LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §3 · Who may call them: db/157's rule
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['access_log_platform_reader(uuid)',
                           'log_platform_read(text, uuid[], uuid, uuid, boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── 4 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'access_log_platform_reader(uuid)'::regprocedure
                    AND p.prosecdef AND p.provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/167: access_log_platform_reader() is not a STABLE SECURITY DEFINER with a pinned search_path';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'log_platform_read(text, uuid[], uuid, uuid, boolean)'::regprocedure
                    AND NOT p.prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/167: log_platform_read() is not an invoker with a pinned search_path';
  END IF;
  FOREACH v IN ARRAY ARRAY['access_log_platform_reader(uuid)', 'log_platform_read(text, uuid[], uuid, uuid, boolean)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', v, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = v::regprocedure AND x.privilege_type = 'EXECUTE'
                     AND x.grantee NOT IN (p.proowner, 'scrbrd_app'::regrole)) THEN
      RAISE EXCEPTION 'db/167: % is not granted to scrbrd_app alone', v;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM api_role_reach('public') x WHERE x ~ '(access_log_platform_reader|log_platform_read)\(') THEN
    RAISE EXCEPTION 'db/167: PUBLIC reaches one of db/167''s functions';
  END IF;
END $check$;


-- ── 5 · The lock limit back as it was ──────────────────────────────
RESET lock_timeout;
