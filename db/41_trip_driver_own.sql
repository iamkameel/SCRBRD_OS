-- ══════════════════════════════════════════════════════════════════
--  41 · A driver reaches his own trips, and no other
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/rls-anchor-audit.md §5.1 is the finding; this file is
-- the fix it proposed, closing a leak of CHILDREN'S EMERGENCY CONTACTS that
-- was live in production.
--
-- THE LEAK. trip_contacts(p_trip) (db/08) is SECURITY DEFINER and let a
-- caller holding transport.drive at the school read the manifest — every
-- travelling child's parents' names and numbers — for ANY trip at that school
-- within a day of departure. It never asked whether the caller was that
-- trip's driver, and a driver's assignment is school-wide (db/98, and the
-- role-request grant path). trip_mark() had the same shape: any
-- transport.drive holder at the school could mark any trip there departed or
-- arrived. And trip_mark() had a second hole: its gate was
--     IF NOT (t.driver_id = app_user_id() OR app_can(...) OR app_can(...))
-- which, on a trip with NO driver named, is NOT (NULL OR false OR false) =
-- NULL, and IF NULL does not refuse — so ANY signed-in person could mark a
-- driverless trip. Both are replaced here.
--
-- Meanwhile the read did the opposite: a driver-only account read no trip at
-- all, not even his own, because trip_read (db/09) anchors through a subquery
-- on `match` under the caller's RLS and a driver holds no fixture.read.
--
-- WHAT CHANGES, and nothing else:
--
--   1. trip_contacts(): the driver path additionally requires
--      t.driver_id = app_user_id(). Window, transport.drive check, the
--      per-child player.emergency.read path, signature, return shape and
--      grants are db/08's, verbatim.
--
--   2. trip_mark(): allowed = (the NAMED driver AND he still holds
--      transport.drive there) OR transport.manage. The blanket
--      transport.drive arm is gone. A driver whose assignment has been
--      revoked or suspended is refused on a trip that still names him.
--      Reasons, their order, signature and grants are db/08's, verbatim.
--
--   3. trip_driver_own_read — a permissive SELECT policy on trip: the named
--      driver reads his own trip, where he holds transport.read. Anchored on
--      trip.school_id and the SECURITY DEFINER match_team(), not on a
--      subquery against match, so it neither recurses nor depends on what
--      else the caller can read. trip_read (db/09) is untouched.
--
--   4. match_trip_driver_read — a permissive SELECT policy on match: the named
--      driver of a live (not cancelled) trip reads that trip's fixture —
--      opponent, start, format, status — for the day-of screen. Every match
--      column is fixture metadata (no pupil, no contact, no medical field);
--      the toss, the squad, the conditions and the scorecard stay behind
--      their own policies and fixture.read, which a driver does not hold.
--      It asks trip_driven_matches(), SECURITY DEFINER, because a policy on
--      match that read trip under the caller's RLS would expand trip_read,
--      which reads match: Postgres refuses that as infinite recursion.
--
--   5. trip_driver_own_only — a RESTRICTIVE SELECT policy on trip. Needed
--      because of (4): trip_read's anchor subquery runs under the caller's
--      RLS, so once a driver can read the fixture, trip_read resolves for
--      EVERY trip on it — the second bus to the same match, driven by
--      somebody else. This policy says: where the caller reaches a fixture
--      only as a driver (he drives a live trip on it and cannot read it by
--      fixture.read, home or away), he sees his own trips on it and no
--      others. For every other reader, and every other fixture, it is true
--      and changes nothing. If match_read ever gains an arm this file does
--      not repeat, the error is on the safe side: such a reader who is also
--      a driver is narrowed to his own trips on the fixtures he drives.
--
-- NOT HERE: whether a driver should hold school-wide transport.read at all
-- (the audit's item 3) — a driver who is also a parent at the school still
-- reads every trip there through the parent's fixture.read, as before, though
-- trip_contacts() no longer gives him any manifest but his own bus's. And the
-- venue: the ground's name is behind facility.read, which a driver does not
-- hold, and is not widened here.
--
-- search_path is pinned in every SECURITY DEFINER definition below, because
-- CREATE OR REPLACE discards the pin db/16 set with ALTER FUNCTION.


-- ── 1 · trip_contacts: the driver path is the NAMED driver ─────────
/**
 * The manifest: every child on a trip, and who to ring for each.
 *
 * THE DRIVER IS REACHED THROUGH THE TRIP, NOT THROUGH A CAPABILITY ON THE
 * CHILD. A driver's assignment is school-wide, so giving drivers
 * player.emergency.read would hand every driver every child's numbers all
 * year. What a driver needs is the parents of the children on HIS bus, on
 * the day. So the trip's named driver, holding transport.drive on the
 * fixture, inside a window around the departure — the day before to the day
 * after — reaches the manifest, and outside that window he reads nothing.
 * Another bus at the same school is not his business on any day (db/41).
 *
 * Everyone else is checked PER CHILD with player.emergency.read, so a guardian
 * reading the manifest of a bus their child is on sees their own child and
 * nobody else's — the person anchor doing exactly what it does everywhere.
 */
CREATE OR REPLACE FUNCTION trip_contacts(p_trip uuid)
RETURNS TABLE (player_id uuid, full_name text, priority smallint, name text,
               relationship text, phone text, phone_alt text, email text,
               note text, school_id uuid) AS $$
DECLARE
  t trip%ROWTYPE;
  m match%ROWTYPE;
  v_driver boolean := false;
  v_from date; v_to date;
BEGIN
  SELECT * INTO t FROM trip WHERE id = p_trip;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO m FROM match WHERE id = t.match_id;
  IF NOT FOUND THEN RETURN; END IF;

  v_from := coalesce(t.depart_at::date, m.starts_at::date) - 1;
  v_to   := coalesce(t.return_at::date, t.depart_at::date, m.starts_at::date) + 1;
  -- coalesce: a trip with no driver named compares NULL, and NULL is "no".
  v_driver := coalesce(t.driver_id = app_user_id(), false)
              AND t.cancelled_at IS NULL
              AND current_date BETWEEN v_from AND v_to
              AND app_can('transport.drive', t.school_id, coalesce(m.team_code, '*'),
                          '00000000-0000-0000-0000-000000000000'::uuid, m.id);

  RETURN QUERY
    SELECT p.id, p.full_name, c.priority, c.name, c.relationship,
           c.phone, c.phone_alt, c.email, c.note, p.school_id
      FROM match_squad s
      JOIN player p ON p.id = s.player_id
      JOIN emergency_contact c ON c.player_id = p.id AND c.active
     WHERE s.match_id = m.id AND NOT s.withdrawn
       AND p.school_id = t.school_id
       AND (v_driver OR app_can('player.emergency.read', p.school_id, p.team_code, p.id,
                                '00000000-0000-0000-0000-000000000000'::uuid))
     ORDER BY p.full_name, c.priority;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION trip_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trip_contacts(uuid) TO PUBLIC;


-- ── 2 · trip_mark: the named driver, or the office ─────────────────
/**
 * The driver's own two acts: we have left, and we have arrived.
 *
 * A FUNCTION RATHER THAN A WRITE POLICY, because transport.drive is not a
 * capability to change a trip — it is a capability to report on one. A driver
 * must not be able to re-time the departure, swap the vehicle or cancel the
 * fixture's transport; they mark what happened, and only forwards.
 *
 * WHO. The trip's NAMED driver, while he still holds transport.drive on the
 * fixture — so revoking or suspending his assignment stops him even on a trip
 * that still names him — or anybody holding transport.manage there, standing
 * in for a driver who did not mark it. Holding transport.drive somewhere at
 * the school is not being this trip's driver (db/41).
 *
 * SECURITY DEFINER, so the marks land without granting a driver UPDATE on the
 * table generally. Same reasoning as the scoring session's state machine.
 */
CREATE OR REPLACE FUNCTION trip_mark(p_trip uuid, p_event text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE t record;
BEGIN
  SELECT tr.*, m.team_code INTO t
    FROM trip tr JOIN match m ON m.id = tr.match_id WHERE tr.id = p_trip;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_trip'; RETURN; END IF;

  -- coalesce: on a trip with no driver named the comparison is NULL, and
  -- IF NOT (NULL) does not refuse. db/08 let anybody mark such a trip.
  IF NOT ((coalesce(t.driver_id = app_user_id(), false)
           AND app_can('transport.drive',  t.school_id, t.team_code, NULL, t.match_id))
          OR app_can('transport.manage', t.school_id, t.team_code, NULL, t.match_id)) THEN
    RETURN QUERY SELECT false, 'not_this_driver'; RETURN;
  END IF;

  IF t.cancelled_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'trip_cancelled'; RETURN;
  END IF;

  IF p_event = 'departed' THEN
    IF t.departed_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_departed'; RETURN; END IF;
    UPDATE trip SET departed_at = now() WHERE id = p_trip;
  ELSIF p_event = 'arrived' THEN
    -- Arriving without having left is not a clock correction, it is a sign
    -- somebody is marking the wrong trip.
    IF t.departed_at IS NULL THEN RETURN QUERY SELECT false, 'not_departed'; RETURN; END IF;
    IF t.arrived_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_arrived'; RETURN; END IF;
    UPDATE trip SET arrived_at = now() WHERE id = p_trip;
  ELSE
    RETURN QUERY SELECT false, 'unknown_event'; RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION trip_mark(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trip_mark(uuid, text) TO PUBLIC;


-- ── 3 · The named driver reads his own trip ────────────────────────
-- A second PERMISSIVE policy, so it widens trip_read by exactly these rows.
-- Hand-written: the generator drops only the four names it owns per table
-- (trip_read/_insert/_update/_delete), so regenerating leaves this in place.
DROP POLICY IF EXISTS trip_driver_own_read ON trip;
CREATE POLICY trip_driver_own_read ON trip
  FOR SELECT USING (
    trip.driver_id = app_user_id()
    AND app_can('transport.read', trip.school_id, match_team(trip.match_id),
                '00000000-0000-0000-0000-000000000000'::uuid, trip.match_id));


-- ── 4 · ...and the fixture his live trip goes to ───────────────────
-- The fixtures the caller drives a live trip to, holding transport.read there
-- — the same test as (3), minus cancelled trips. SECURITY DEFINER: a match
-- policy that read trip under the caller's RLS would recurse (see the header).
-- Uncorrelated in the policy below, so it runs once per query, not per row.
CREATE OR REPLACE FUNCTION trip_driven_matches() RETURNS SETOF uuid AS $$
  SELECT t.match_id
    FROM trip t
   WHERE t.driver_id = app_user_id()
     AND t.cancelled_at IS NULL
     AND app_can('transport.read', t.school_id, match_team(t.match_id),
                 '00000000-0000-0000-0000-000000000000'::uuid, t.match_id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION trip_driven_matches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trip_driven_matches() TO PUBLIC;

DROP POLICY IF EXISTS match_trip_driver_read ON match;
CREATE POLICY match_trip_driver_read ON match
  FOR SELECT USING (match.id IN (SELECT trip_driven_matches()));


-- ── 5 · ...and not the other bus to that fixture ───────────────────
-- True when the caller reaches this fixture ONLY as a driver: he drives a
-- live trip on it, and cannot read it by fixture.read from either side — the
-- two arms of match_read (db/09), repeated here because a definer cannot ask
-- the caller's RLS "excluding one policy".
CREATE OR REPLACE FUNCTION trip_fixture_driver_only(p_match uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM trip_driven_matches() d WHERE d = p_match)
     AND NOT EXISTS (
       SELECT 1 FROM match m
        WHERE m.id = p_match
          AND (app_can('fixture.read', m.school_id, m.team_code,
                       '00000000-0000-0000-0000-000000000000'::uuid, m.id)
               OR app_can('fixture.read', m.away_school_id, m.away_team_code,
                          '00000000-0000-0000-0000-000000000000'::uuid, m.id)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION trip_fixture_driver_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trip_fixture_driver_only(uuid) TO PUBLIC;

DROP POLICY IF EXISTS trip_driver_own_only ON trip;
CREATE POLICY trip_driver_own_only ON trip
  AS RESTRICTIVE FOR SELECT USING (
    coalesce(trip.driver_id = app_user_id(), false)
    OR NOT trip_fixture_driver_only(trip.match_id));


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  p text;
  src text;
BEGIN
  FOREACH f IN ARRAY ARRAY['trip_contacts(uuid)', 'trip_mark(uuid,text)',
                           'trip_driven_matches()', 'trip_fixture_driver_only(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/41: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;

  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'trip_contacts(uuid)'::regprocedure;
  IF src NOT LIKE '%coalesce(t.driver_id = app_user_id(), false)%' THEN
    RAISE EXCEPTION 'db/41: trip_contacts() does not gate its driver path on the named driver';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'trip_mark(uuid,text)'::regprocedure;
  IF src NOT LIKE '%coalesce(t.driver_id = app_user_id(), false)%' THEN
    RAISE EXCEPTION 'db/41: trip_mark() does not gate its driver path on the named driver';
  END IF;

  FOREACH p IN ARRAY ARRAY['trip.trip_driver_own_read', 'match.match_trip_driver_read',
                           'trip.trip_driver_own_only'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                    WHERE schemaname = 'public' AND cmd = 'SELECT'
                      AND tablename = split_part(p, '.', 1) AND policyname = split_part(p, '.', 2)) THEN
      RAISE EXCEPTION 'db/41: policy % is missing', p;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'trip'
                    AND policyname = 'trip_driver_own_only' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/41: trip_driver_own_only is not RESTRICTIVE';
  END IF;
  -- Neither new policy may read a table under the caller's RLS: the trip one
  -- would stop being independent of what else he reads, the match one would
  -- recurse.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                AND policyname IN ('trip_driver_own_read', 'match_trip_driver_read', 'trip_driver_own_only')
                AND (qual ILIKE '%FROM match%' OR qual ILIKE '%FROM trip%')) THEN
    RAISE EXCEPTION 'db/41: a db/41 policy reads a table under the caller''s RLS';
  END IF;
END $check$;
