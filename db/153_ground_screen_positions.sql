-- ══════════════════════════════════════════════════════════════════
--  153 · The big screen at the ground shows a marked boy by position
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/PUBLIC_BY_TERMS.md (approved by Kameel, 11 Nov
-- 2026), §2.5 and slice 1: "One change: a boy under any never-public mark is
-- shown by position on it. A mark is for a child who must not be findable,
-- and a screen facing a crowd is a place he can be found."
--
-- THE GAP. The Match Centre's big screen (apps/web/src/views/matchcentre/
-- bigscreen.jsx) is the ground display's own view, fed by the signed-in
-- fold, and so by the names the log carries. It faces the boundary crowd and
-- knew nothing of a never-public mark (player_never_public, db/47): the mark
-- is read only under player.public.withhold, and a coach, who is the person
-- who opens the big screen, holds no read of it (READERS_child_data K2).
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   + ground_screen_positions(match uuid) → (player_id, position_only)
--       For each player the match's log puts on the field in a role (a
--       striker, a non-striker, a bowler, a batter dismissed, a fielder, a
--       keeper, a batter retiring), whether the big screen shows him by his
--       position. position_only is the never-public mark on the day served
--       (public_name_facts()'s `neverPublic`, db/116), and nothing else: the
--       consents, the names-off switch and the by-terms switches do not
--       govern the school's own scoreboard (§2.5; "the Privacy screen says
--       so").
--
--   SECURITY INVOKER, so the log is read under ball_event_read, the
--   caller's own policy: a reader who may not read this match's log gets no
--   rows, and the signed-out caller gets none. Its one definer call is
--   public_name_facts(), the one read of the mark the public pages already
--   use (db/47 grants it to scrbrd_app only), and only its boolean is kept.
--   No reason, no author, no date, no consent and no name leaves the
--   function.
--
--   The squads on innings_start are NOT read: a squad member who has had no
--   role on the field is not on the big screen, so the answer does not say
--   whether he is marked. The client shows by position every player this
--   answer does not cover (fail closed), so a boy who comes into the log
--   after the read is a position until the next one.
--
--   What it tells its reader: that these boys are shown by position on the
--   big screen. The big screen tells the boundary the same thing, and the
--   reader is one who may open it (any reader of the log). It does not say
--   why. Recorded for Kameel in the slice's report.
--
-- Nothing else. broadcast_state() (db/149) already names no child.
--
-- Its proof is db/99 §130; the walk is smoke-browser-matchcentre's big
-- screen group.

CREATE OR REPLACE FUNCTION ground_screen_positions(p_match uuid)
RETURNS TABLE (player_id uuid, position_only boolean) AS $$
  WITH refs AS (
    -- Every reference the log puts on the field, under the caller's own
    -- policy on ball_event. A reference that is not a uuid is a name the
    -- scorer typed (L6): no row, no mark, so not here.
    SELECT DISTINCT r.ref::uuid AS pid
      FROM ball_event b
     CROSS JOIN LATERAL (VALUES
       (b.striker_id::text), (b.non_striker_id::text), (b.bowler_id::text), (b.dismissed_id::text),
       (b.payload ->> 'striker'), (b.payload ->> 'nonStriker'), (b.payload ->> 'bowler'),
       (b.payload ->> 'dismissed'), (b.payload ->> 'fielder'), (b.payload ->> 'batter'),
       (b.payload ->> 'keeper')) AS r(ref)
     WHERE b.match_id = p_match
       AND r.ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  SELECT x.pid, (x.facts ->> 'neverPublic')::boolean
    FROM (SELECT refs.pid, public_name_facts(refs.pid, NULL, sa_today()) AS facts FROM refs) x
   -- A uuid that is not a player (public_name_facts() answers NULL) is
   -- nobody to mark; the client shows it by position anyway.
   WHERE x.facts IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp;

-- The application's, and nobody else's. Not PUBLIC, and not a managed
-- host's API roles, which get EXECUTE on every new function by default
-- privilege (db/29, db/47).
REVOKE ALL ON FUNCTION ground_screen_positions(uuid) FROM PUBLIC;
DO $revoke_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION ground_screen_positions(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;
GRANT EXECUTE ON FUNCTION ground_screen_positions(uuid) TO scrbrd_app;

-- After: an invoker (the log is the caller's), its path pinned, reading the
-- mark only through public_name_facts().
DO $after$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'ground_screen_positions(uuid)'::regprocedure AND NOT p.prosecdef
     AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'];
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/153: ground_screen_positions() is not an invoker with its search path pinned';
  END IF;
  IF v_src ~* '\m(player_never_public|public_name_consent|full_name|surname|known_as|reason)\M' THEN
    RAISE EXCEPTION 'db/153: ground_screen_positions() reads a mark, a consent or a name directly';
  END IF;
  IF has_function_privilege('public', 'ground_screen_positions(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/153: ground_screen_positions() is executable by PUBLIC';
  END IF;
END $after$;
