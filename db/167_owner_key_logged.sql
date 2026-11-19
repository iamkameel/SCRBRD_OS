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
--      reader() lets the list say "SCRBRD platform" for a reader who held
--      the owner's key or platformadmin when he read, and never his name.
--
-- WHAT IT CHANGES ON A LIVE DATABASE (production holds test data only)
--   function access_log_platform_reader(uuid, timestamptz): new; a pinned
--     STABLE SECURITY DEFINER, executable by scrbrd_app alone. One boolean
--     about one id at one instant: whether that person held a platform
--     assignment (superadmin or platformadmin, at no school) live at that
--     instant, by the liveness rule app_is_platform_wide() applies, read
--     back in time (created, not yet revoked, inside its dates and its
--     hour). The office's list asks it of each row at the row's occurred_at.
--   function log_platform_row(text, uuid[], integer, text[], uuid): new; a
--     pinned SECURITY DEFINER, executable by scrbrd_app alone. The STRICT
--     writer (review S1, 19 Nov 2026): it inserts the row as db/91's
--     definers do, with no exception handler, so a row that cannot be
--     written fails the statement and the dispatcher answers 503 not_logged
--     instead of the read. log_restricted_read() (db/22) swallows every
--     error by design and is not used here. It writes for a platform-wide
--     caller or one in a support session only, about himself only, stamped
--     as log_restricted_read() stamps (platform_wide, the support session).
--   function log_platform_read(text, uuid[], uuid, uuid, boolean, boolean):
--     new; an INVOKER (no privilege of its own: it reads player, match,
--     match_squad, role_assignment and assignment_subject as the caller
--     reads them), executable by scrbrd_app alone; it writes through
--     log_platform_row(). An earlier draft of either function, under its
--     earlier arguments, is dropped first (never pasted outside a review).
-- No table, column, policy, capability or role; no shipped function body
-- is re-emitted. Rows already written are not touched. A second paste
-- changes nothing.
--
-- Its proof is db/99 §144; the walks are smoke-who-read (the key's reads off
-- the read path, on the office's per-child answer as "SCRBRD platform") and
-- smoke-browser-support (the same row on the screen the office answers from).
-- Not to be pasted before it is reviewed.

DO $guard$
BEGIN
  IF to_regprocedure('app_is_platform_wide()') IS NULL
     OR to_regprocedure('app_support_access_id(uuid)') IS NULL
     OR to_regprocedure('app_device_id()') IS NULL THEN
    RAISE EXCEPTION 'db/167 needs db/20 and db/22 (app_is_platform_wide, app_support_access_id): paste them first';
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

-- The review's drafts, under their earlier arguments, if a reviewer pasted one.
DROP FUNCTION IF EXISTS access_log_platform_reader(uuid);
DROP FUNCTION IF EXISTS log_platform_read(text, uuid[], uuid, uuid, boolean);


-- ══════════════════════════════════════════════════════════════════
-- §1 · Was this reader the platform when he read?
-- ══════════════════════════════════════════════════════════════════
/**
 * True when the person held a platform assignment (the owner's key or
 * platformadmin, at no school: db/86's rule) live at p_at: created by then,
 * not revoked by then, inside its dates, inside its hour. The office's list
 * of who read what asks it of each row at the row's own occurred_at, to name
 * such a reader "SCRBRD platform" rather than by name. A key that lapsed
 * later is still the platform for the reads it made while it held.
 */
CREATE OR REPLACE FUNCTION access_log_platform_reader(p_person uuid, p_at timestamptz) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.person_id = p_person AND a.school_id IS NULL
       AND a.role IN ('superadmin', 'platformadmin')
       AND a.created_at <= p_at
       AND (a.active OR a.revoked_at > p_at)
       AND (a.valid_from  IS NULL OR a.valid_from  <= p_at::date)
       AND (a.valid_until IS NULL OR a.valid_until >  p_at::date)
       AND (a.expires_at  IS NULL OR a.expires_at  >  p_at))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §2 · The strict writer
-- ══════════════════════════════════════════════════════════════════
/**
 * One access_log row about the caller's own read, for a platform-wide caller
 * or one in a support session; nothing for anybody else. No exception
 * handler: a row that cannot be written is an error the caller sees.
 * p_count is how many records the read reached at that school, which is more
 * than the ids kept when the list was cut (the row's fields then say
 * record_ids_cut).
 */
CREATE OR REPLACE FUNCTION log_platform_row(
  p_resource text, p_ids uuid[], p_count integer, p_fields text[], p_school uuid
) RETURNS void AS $$
DECLARE
  v_support uuid := app_support_access_id(p_school);
  v_school  uuid := p_school;
BEGIN
  IF app_user_id() IS NULL OR NOT (app_is_platform_wide() OR v_support IS NOT NULL) THEN
    RETURN;
  END IF;
  IF v_school IS NULL AND v_support IS NOT NULL THEN
    SELECT s.school_id INTO v_school FROM support_access s WHERE s.id = v_support;
  END IF;
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count,
                          fields, device_id, platform_wide, support_access_id)
  VALUES (v_school, app_user_id(), p_resource,
          coalesce(p_ids, '{}'), greatest(coalesce(p_count, 0), coalesce(array_length(p_ids, 1), 0)),
          coalesce(p_fields, '{}'), app_device_id(), app_is_platform_wide(), v_support);
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §3 · A read off the read path, on the record
-- ══════════════════════════════════════════════════════════════════
/**
 * After a GET route outside /api/read/ answers a platform-wide caller or one
 * in a support session (server.mjs, PLATFORM_LOGGED; the dispatcher asks
 * first and does not call this for anybody else), the dispatcher hands this
 * the route's name, the ids in the answer's id-shaped fields, and the route's
 * subject: a fixture, an account, or neither. For a school reader it returns
 * at once. Otherwise one row per school, as read-api.mjs files a platform-wide
 * read, every lookup made as the caller makes it (no new reach):
 *   - each child whose id came back, under his school;
 *   - p_squad: the fixture's named side when the answer names its boys by
 *     name and not by id (the team sheet), each end's boys of that end's
 *     school only, as fixture_sheet() (db/131) draws them;
 *   - p_match: both of the fixture's schools, so a read that names no child
 *     is still in each school's log;
 *   - p_account: the account, under each school it holds a LIVE assignment
 *     at (app_is_platform_wide()'s liveness rule), and the child its live
 *     self-access link is to, under the child's own school;
 *   - nothing resolvable at all: one row under no school.
 * At most 2000 ids per row; past that, or when the dispatcher had to cut the
 * answer's ids (p_cut), the row's fields say record_ids_cut and its
 * record_count keeps the whole count.
 */
CREATE OR REPLACE FUNCTION log_platform_read(
  p_resource text,
  p_seen     uuid[],
  p_match    uuid    DEFAULT NULL,
  p_account  uuid    DEFAULT NULL,
  p_squad    boolean DEFAULT false,
  p_cut      boolean DEFAULT false
) RETURNS void AS $$
DECLARE r record; n int := 0; k constant int := 2000;
BEGIN
  IF app_user_id() IS NULL OR NOT (app_is_platform_wide() OR app_support_access_id() IS NOT NULL) THEN
    RETURN;
  END IF;
  FOR r IN
    WITH live AS (
      SELECT a.* FROM role_assignment a
       WHERE p_account IS NOT NULL AND a.person_id = p_account AND a.active
         AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
         AND (a.valid_until IS NULL OR a.valid_until >  current_date)
         AND (a.expires_at  IS NULL OR a.expires_at  >  now())
    ), named AS (
      SELECT p.school_id, p.id FROM player p WHERE p.id = ANY (coalesce(p_seen, '{}'))
      UNION
      SELECT p.school_id, p.id
        FROM match m
        CROSS JOIN LATERAL (VALUES ('home', m.school_id), ('away', m.away_school_id)) AS e(side, school_id)
        JOIN match_squad s ON s.match_id = m.id AND s.side = e.side AND NOT s.withdrawn
        JOIN player p      ON p.id = s.player_id AND p.school_id = e.school_id
       WHERE p_squad AND p_match IS NOT NULL AND m.id = p_match AND e.school_id IS NOT NULL
      UNION
      SELECT p.school_id, p.id
        FROM live a
        JOIN assignment_subject g ON g.assignment_id = a.id
        JOIN player p ON p.id = g.player_id
       WHERE a.role = 'selfaccess'
         AND (g.valid_from  IS NULL OR g.valid_from  <= current_date)
         AND (g.valid_until IS NULL OR g.valid_until >  current_date)
      UNION
      SELECT a.school_id, p_account FROM live a WHERE a.school_id IS NOT NULL
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
    PERFORM log_platform_row(p_resource, r.ids[1:k], coalesce(array_length(r.ids, 1), 0),
      CASE WHEN p_cut OR coalesce(array_length(r.ids, 1), 0) > k THEN ARRAY['record_ids_cut'] ELSE '{}'::text[] END,
      r.school_id);
    n := n + 1;
  END LOOP;
  IF n = 0 THEN
    PERFORM log_platform_row(p_resource, '{}'::uuid[], 0,
      CASE WHEN p_cut THEN ARRAY['record_ids_cut'] ELSE '{}'::text[] END, NULL);
  END IF;
END $$ LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §4 · Who may call them: db/157's rule
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['access_log_platform_reader(uuid, timestamptz)',
                           'log_platform_row(text, uuid[], integer, text[], uuid)',
                           'log_platform_read(text, uuid[], uuid, uuid, boolean, boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── 5 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['access_log_platform_reader(uuid, timestamptz)', 'log_platform_row(text, uuid[], integer, text[], uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v::regprocedure AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/167: % is not a SECURITY DEFINER with a pinned search_path', v;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'log_platform_read(text, uuid[], uuid, uuid, boolean, boolean)'::regprocedure
                    AND NOT p.prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/167: log_platform_read() is not an invoker with a pinned search_path';
  END IF;
  -- The writer is strict: no EXCEPTION clause anywhere in it.
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'log_platform_row(text, uuid[], integer, text[], uuid)'::regprocedure) ~* '\mexception\M' THEN
    RAISE EXCEPTION 'db/167: log_platform_row() catches an exception; it must let a failed write fail';
  END IF;
  IF to_regprocedure('access_log_platform_reader(uuid)') IS NOT NULL
     OR to_regprocedure('log_platform_read(text, uuid[], uuid, uuid, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'db/167: a draft''s function is still there under its earlier arguments';
  END IF;
  FOREACH v IN ARRAY ARRAY['access_log_platform_reader(uuid, timestamptz)', 'log_platform_row(text, uuid[], integer, text[], uuid)',
                           'log_platform_read(text, uuid[], uuid, uuid, boolean, boolean)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', v, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = v::regprocedure AND x.privilege_type = 'EXECUTE'
                     AND x.grantee NOT IN (p.proowner, 'scrbrd_app'::regrole)) THEN
      RAISE EXCEPTION 'db/167: % is not granted to scrbrd_app alone', v;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM api_role_reach('public') x WHERE x ~ '(access_log_platform_reader|log_platform_r(ead|ow))\(') THEN
    RAISE EXCEPTION 'db/167: PUBLIC reaches one of db/167''s functions';
  END IF;
END $check$;


-- ── 6 · The lock limit back as it was ──────────────────────────────
RESET lock_timeout;
