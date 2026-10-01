-- ══════════════════════════════════════════════════════════════════
--  76 · Parent lift clubs, phase 2: the day (SCRBRD-124)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, like db/70 (phase 1, the arrangement), which this extends.
-- The design is docs/design/SCRBRD-124_lift_clubs.md; this file is §8's
-- row "2 · The day": the driver's marks (left, boy in, handed over, not
-- collected, arrived), the receiver's acknowledgement (the side's staff on
-- the way out, the boy's guardian on the way home, §1.6), the office's
-- exceptions and resolve, the coach's expected list, the boy of eighteen's
-- own line, the watch the platform runs, and the purge (§5.3).
--
-- After this file the module MAY go live per school (§8). It stays OFF by
-- default: the platform grants `lift_club` to one school at a time, and the
-- school's principal signs its policy (D17's two keys). Nothing here grants
-- it to anybody.
--
-- WHAT IS HERE
--
--   lift_mark(offer, event)        the driver: 'departed', 'arrived'.
--   lift_seat_mark(seat, event)    the driver: 'boarded', 'handed_over',
--                                  'not_collected'.
--   lift_receive(seat)             the out leg's receiver (transport.lift.
--                                  receive on the side: "with us"); the back
--                                  leg's (a live guardian of the boy, or he
--                                  himself at eighteen and at school:
--                                  "collected").
--   lift_resolve(seat, resolution) the office closes a seat in exception.
--   lift_my_day(match)             the day cards: the driver's (her
--                                  passengers by name, logged, and their
--                                  marks), the family's (her own boys' seats,
--                                  the driver's name, the marks).
--   lift_expected(match)           the coach's head count for the out leg,
--                                  logged.
--   lift_exceptions(school, match) §6's exceptions, by name, to the office,
--                                  logged. lift_summary() (db/70) keeps its
--                                  counts and its shape.
--   my_lifts()                     the boy of eighteen at school: his own
--                                  confirmed lifts, no number.
--   lift_missed_watch()            the platform's key, on a schedule: §6.1's
--                                  lift not left and §6.2's handover not
--                                  acknowledged, once per seat.
--   lift_purge_due(school), lift_purge(offer), lift_purge_declaration(id)
--                                  §5.3 and D9: offers and seats three years
--                                  after the fixture's day, declarations a
--                                  year after they end, pressed by the office
--                                  from a due list, never a job; each leaves
--                                  a lift_purge_log row of counts.
--   ON THE ROAD                    a lift whose car has left, or that has a
--                                  boy in it, is seen through to its end: the
--                                  fixture moving or being called off, a link
--                                  ending, a withdrawal leaving one boy, the
--                                  policy withdrawn — none of them cancels,
--                                  voids, re-versions or unconfirms it
--                                  (lift_on_the_road(); a row guard besides).
--
-- WHERE THIS DIFFERS FROM THE DESIGN'S LETTER, and why
--
--   - The migration is db/76, not db/67 (§8's numbers were assumptions).
--   - lift_summary() keeps db/70's shape (counts per leg). Its exceptions are
--     lift_exceptions(), a function of their own: changing a returned row's
--     shape would mean DROP FUNCTION, and db/70 is shipped. The office's
--     screen asks both.
--   - Exceptions are per school, a match optional: the office's question is
--     "is any boy not collected right now", not one fixture at a time.
--   - "By name, to oversee" (§6.2): the office reads the boy's name in
--     lift_exceptions(), logged; the notice it is sent names nobody and
--     points at him (subject_person_id), as db/70 does every lift notice
--     (§5.2 is stricter than §6.2's example sentence).
--   - Five exceptions, not two: not left (§6.1), not boarded when the car
--     left, not collected (§6.2), handed over and not received within 30
--     minutes (§6.2), and arrived with a boy not handed over. A lift reaches
--     'done' only when every confirmed seat on it is received or resolved —
--     a boy the car left without is a missing child until somebody says
--     where he is.
--   - Marks are inside the day window (the day before the meeting to the
--     day after, on the Johannesburg calendar: lift_contacts()'s window,
--     db/41's). A boy may be marked in after the car has left (she forgot to
--     tap): the time is when she marked it.
--   - "Left" closes the offer to new requests and declines the requests the
--     driver had not accepted, telling those families; a confirmed boy not
--     marked in when the car leaves is told to his family.
--   - The receiver may acknowledge before the driver marks the handover: a
--     coach who has the boy in front of him says so.
--   - The day's reads, the marks, receive, resolve, the exceptions, the
--     expected list and the watch are not module-gated, as db/70's endings
--     are not: switching the module off must never strand a lift on the road.
--   - lift_purge_log gains `declarations` and one row per school per season.
--   - my_lifts() is for the boy of eighteen still at school only (Kameel,
--     2026-10-01, decisions 4 and 5): a pupil under eighteen reads no lift,
--     his own included. The design's S1 line for every pupil is superseded.
--
-- KAMEEL'S DECISIONS (2026-10-01) honoured here: consent GRANTED (every
-- family act goes through db/70's lift_acting_for()); the lone passenger
-- (a car on the road is not unconfirmed — the driver and his family are told
-- instead, below); pupils out but the boy of eighteen at school for himself
-- (lift_uncut_for()); one-to-one counting children only (lift_lone_fallback()
-- unchanged in that); the driver's number from her child's card
-- (lift_contacts(), unchanged).
--
-- search_path is pinned on every function below (db/16). Every function the
-- application calls is granted to scrbrd_app and taken back from PUBLIC and a
-- managed host's API roles. Safe to run twice. db/99 §55 is the proof.


-- ── 0 · The module: still the platform's to grant, per school ───────
UPDATE feature_flag
   SET reason = 'SCRBRD-124: parents give each other''s children lifts to fixtures, and mark the day. Holds who travels '
             || 'with whom, and when, about minors, so it is granted per school by the platform, never assumed; and it is '
             || 'live at a school only while the principal''s signed lift policy stands.'
 WHERE key = 'lift_club';


-- ── 1 · The purge's counts: one row per school per season ──────────
ALTER TABLE lift_purge_log ADD COLUMN IF NOT EXISTS declarations integer NOT NULL DEFAULT 0 CHECK (declarations >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS lift_purge_log_one ON lift_purge_log (school_id, season);


-- ── 2 · Small rules, shared ────────────────────────────────────────
/** The meeting's day and the days either side, on the Johannesburg calendar (lift_contacts()'s window). */
CREATE OR REPLACE FUNCTION lift_in_day(p_meet_at timestamptz) RETURNS boolean AS $$
  SELECT sa_today() BETWEEN (p_meet_at AT TIME ZONE 'Africa/Johannesburg')::date - 1
                        AND (p_meet_at AT TIME ZONE 'Africa/Johannesburg')::date + 1
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

/**
 * On the road: the car has left, or a boy is in it. Such a lift is seen
 * through to 'done' and nothing ends it early (the header).
 */
CREATE OR REPLACE FUNCTION lift_on_the_road(p_offer uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM lift_offer o WHERE o.id = p_offer AND o.departed_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM lift_seat s WHERE s.offer_id = p_offer AND s.boarded_at IS NOT NULL)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The platform's key: platform.feature.manage, platform-wide, not a pad (db/63's test). */
CREATE OR REPLACE FUNCTION lift_platform_caller() RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND NOT coalesce(app_pad_scoped(), false)
     AND app_can('platform.feature.manage', '00000000-0000-0000-0000-000000000000'::uuid, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The adults at a school (on a side, for receive) holding a lift capability
 * through a live assignment AT the school: the office (oversee) and the
 * side's staff (receive). Never a pupil, never a school-less assignment (the
 * owner's key is told nothing about a family's lift).
 */
CREATE OR REPLACE FUNCTION lift_staff(p_school uuid, p_team text, p_cap text) RETURNS SETOF uuid AS $$
  SELECT DISTINCT a.person_id
    FROM role_assignment a
    JOIN role_capability rc ON rc.role = a.role AND rc.capability = p_cap
   WHERE a.school_id = p_school
     AND (p_team IS NULL OR a.team_code IS NULL OR a.team_code = p_team)
     AND a.active
     AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
     AND (a.valid_until IS NULL OR a.valid_until >  current_date)
     AND (a.expires_at  IS NULL OR a.expires_at  >  now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
     AND NOT lift_is_pupil(a.person_id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * One notice to one member of staff about one boy on one lift: gated on the
 * capability that makes her a party (receive or oversee), with the boy as the
 * person anchor. Naming nobody (§5.2). Never to a pupil.
 */
CREATE OR REPLACE FUNCTION lift_notify_staff(p_offer uuid, p_to uuid, p_about uuid, p_cap text, p_title text, p_body text)
RETURNS void AS $$
DECLARE o lift_offer%ROWTYPE;
BEGIN
  IF p_to IS NULL OR lift_is_pupil(p_to) THEN RETURN; END IF;
  SELECT * INTO o FROM lift_offer WHERE id = p_offer;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind, subject_id, subject_person_id, recipient_id)
  VALUES (o.school_id, o.team_code, 'team', 'lift', 'high', p_title, p_body, p_cap,
          false, 'match', o.match_id, p_about, p_to);
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** "16:35", on the Johannesburg clock. */
CREATE OR REPLACE FUNCTION lift_clock(p_at timestamptz) RETURNS text AS $$
  SELECT to_char(p_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

/**
 * A lift is done when it has arrived and every confirmed seat on it is
 * received or resolved — a boy the car left without included. Its seats go
 * 'done' with it. Internal: the arrival, a receipt and a resolution ask it.
 */
CREATE OR REPLACE FUNCTION lift_offer_settle(p_offer uuid) RETURNS boolean AS $$
DECLARE o lift_offer%ROWTYPE;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer FOR UPDATE;
  IF NOT FOUND OR o.state NOT IN ('open', 'closed') OR o.arrived_at IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM lift_seat s WHERE s.offer_id = p_offer AND s.state = 'confirmed'
                AND s.acknowledged_at IS NULL AND s.resolved_at IS NULL) THEN
    RETURN false;
  END IF;
  UPDATE lift_offer SET state = 'done' WHERE id = p_offer;
  UPDATE lift_seat SET state = 'done' WHERE offer_id = p_offer AND state = 'confirmed';
  UPDATE lift_seat SET state = 'cancelled', ended_at = now() WHERE offer_id = p_offer AND state IN ('requested', 'invited');
  RETURN true;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · On the road, as a row rule ─────────────────────────────────
/**
 * Belt and braces under the definers below: an offer on the road keeps its
 * version, time, place and seats and is not cancelled or voided; a boy in the
 * car keeps his seat until the lift is done; and a car that has left takes
 * no new passenger.
 */
CREATE OR REPLACE FUNCTION lift_road_guard() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'lift_offer' THEN
    IF (OLD.departed_at IS NOT NULL OR EXISTS (SELECT 1 FROM lift_seat s WHERE s.offer_id = OLD.id AND s.boarded_at IS NOT NULL))
       AND ((NEW.version, NEW.meet_at, NEW.meet_kind, NEW.seats) IS DISTINCT FROM (OLD.version, OLD.meet_at, OLD.meet_kind, OLD.seats)
            OR NEW.state IN ('cancelled', 'void')) THEN
      RAISE EXCEPTION 'a lift on the road is seen through to its end: it is not changed, cancelled or voided'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF OLD.boarded_at IS NOT NULL AND NEW.state NOT IN ('confirmed', 'done') THEN
      RAISE EXCEPTION 'a boy in the car keeps his seat until the lift is done' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state = 'confirmed' AND OLD.state IS DISTINCT FROM 'confirmed'
       AND EXISTS (SELECT 1 FROM lift_offer o WHERE o.id = NEW.offer_id AND o.departed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'a lift that has left takes no new passenger' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS lift_offer_road ON lift_offer;
CREATE TRIGGER lift_offer_road BEFORE UPDATE ON lift_offer FOR EACH ROW EXECUTE FUNCTION lift_road_guard();
DROP TRIGGER IF EXISTS lift_seat_road ON lift_seat;
CREATE TRIGGER lift_seat_road BEFORE UPDATE ON lift_seat FOR EACH ROW EXECUTE FUNCTION lift_road_guard();


-- ── 4 · db/70's endings, taught the road ───────────────────────────
-- Each is db/70's function with the on-the-road rule added and nothing else
-- changed; the comment above each says what.

/** db/70's lift_offer_end(): a lift on the road is not ended (returns 0, untouched). */
CREATE OR REPLACE FUNCTION lift_offer_end(p_offer uuid, p_state text, p_kind text, p_by uuid, p_tell_driver boolean DEFAULT false)
RETURNS integer AS $$
DECLARE
  o     lift_offer%ROWTYPE;
  s     record;
  n     integer := 0;
  v_seat_state text := CASE p_state WHEN 'void' THEN 'void' ELSE 'cancelled' END;
  v_words text;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer FOR UPDATE;
  IF NOT FOUND OR o.state NOT IN ('open', 'closed') THEN RETURN 0; END IF;
  IF lift_on_the_road(p_offer) THEN RETURN 0; END IF;
  v_words := lift_offer_words(p_offer);
  UPDATE lift_offer SET state = p_state, cancel_kind = p_kind, cancelled_at = now(), cancelled_by = p_by
   WHERE id = p_offer;
  FOR s IN UPDATE lift_seat SET state = v_seat_state, ended_at = now(), ended_by = p_by
            WHERE offer_id = p_offer AND state IN ('requested', 'invited', 'confirmed')
           RETURNING player_id LOOP
    n := n + 1;
    PERFORM lift_notify_family(p_offer, s.player_id, 'A lift is no longer available',
      v_words || ' is no longer available. Please make other arrangements.');
  END LOOP;
  IF p_tell_driver THEN
    PERFORM lift_notify(p_offer, o.driver_id, NULL,
      CASE p_kind WHEN 'fixture' THEN 'A fixture is off' ELSE 'Your lift is cancelled' END,
      v_words || CASE p_kind WHEN 'fixture' THEN ' is cancelled: the fixture is off.'
                             WHEN 'policy_withdrawn' THEN ' is cancelled: the school has paused lift clubs.'
                             ELSE ' is cancelled.' END);
  END IF;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/70's lift_fixture_moved(): a lift on the road keeps its version (a start delayed on the day moves only what has not left). */
CREATE OR REPLACE FUNCTION lift_fixture_moved() RETURNS trigger AS $$
DECLARE o record;
BEGIN
  IF NEW.status = 'abandoned' AND OLD.status IS DISTINCT FROM 'abandoned' THEN
    FOR o IN SELECT id FROM lift_offer WHERE match_id = NEW.id AND state IN ('open', 'closed') LOOP
      PERFORM lift_offer_end(o.id, 'void', 'fixture', app_user_id(), true);
    END LOOP;
    RETURN NULL;
  END IF;
  IF NEW.status = 'scheduled'
     AND (OLD.starts_at, OLD.ground_id) IS DISTINCT FROM (NEW.starts_at, NEW.ground_id) THEN
    FOR o IN UPDATE lift_offer SET version = version + 1, fixture_changed_at = now()
              WHERE match_id = NEW.id AND state IN ('open', 'closed') AND NOT lift_on_the_road(id)
             RETURNING id, driver_id, leg LOOP
      PERFORM lift_notify(o.id, o.driver_id, NULL, 'A fixture has moved: do you still offer the lift?',
        'The fixture ' || lift_fixture_words(NEW.id) || ' has moved. Do you still offer your lift '
          || lift_leg_words(o.leg) || '? Confirm it, or cancel it; until you confirm, no seat on it is confirmed.');
    END LOOP;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * db/70's lift_lone_fallback(). On the road the boy is already in the car:
 * his seat is not taken back (nobody is put out of a car by the platform);
 * the driver and his family are told instead, so they speak now.
 */
CREATE OR REPLACE FUNCTION lift_lone_fallback(p_offer uuid) RETURNS boolean AS $$
DECLARE
  o      lift_offer%ROWTYPE;
  pol    lift_policy%ROWTYPE;
  s      lift_seat%ROWTYPE;
  n      integer;
  v_words text;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer;
  IF NOT FOUND OR o.state NOT IN ('open', 'closed') THEN RETURN false; END IF;
  pol := lift_policy_live(o.school_id);
  IF pol.id IS NULL OR pol.allow_one_to_one THEN RETURN false; END IF;
  SELECT count(*) INTO n FROM lift_seat ls WHERE ls.offer_id = p_offer AND ls.state = 'confirmed' AND lift_is_minor(ls.player_id);
  IF n <> 1 THEN RETURN false; END IF;
  SELECT * INTO s FROM lift_seat ls WHERE ls.offer_id = p_offer AND ls.state = 'confirmed' AND lift_is_minor(ls.player_id) FOR UPDATE;
  v_words := lift_offer_words(p_offer);
  IF lift_on_the_road(p_offer) THEN
    PERFORM lift_notify_family(p_offer, s.player_id, 'One boy is left on a lift',
      v_words || ' now has one boy on it, which the school''s lift policy does not allow. The lift is under way, so '
        || 'his seat stands: ring the driver now and agree what happens.');
    PERFORM lift_notify(p_offer, o.driver_id, NULL, 'One boy is left on your lift',
      v_words || ' now has one boy on it, which the school''s lift policy does not allow. The lift is under way: '
        || 'ring his family now and agree what happens.');
    RETURN false;
  END IF;
  UPDATE lift_seat SET state = 'requested', driver_ok_version = NULL WHERE id = s.id;
  PERFORM lift_notify_family(p_offer, s.player_id, 'A seat on a lift is no longer confirmed',
    v_words || ' now has one boy on it, which the school''s lift policy does not allow. His seat is not confirmed '
      || 'unless the driver takes another boy with him. Please make other arrangements, or wait to hear.');
  PERFORM lift_notify(p_offer, o.driver_id, NULL, 'One boy is left on your lift',
    v_words || ' now has one boy on it, which the school''s lift policy does not allow. His seat is no longer '
      || 'confirmed: accept another boy with him, or cancel the lift.');
  RETURN true;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/70's lift_links_settle(): a boy in the car keeps his seat until the lift is done. */
CREATE OR REPLACE FUNCTION lift_links_settle(p_person uuid) RETURNS void AS $$
DECLARE o record; s record;
BEGIN
  FOR o IN SELECT id, school_id, team_code FROM lift_offer
            WHERE driver_id = p_person AND state IN ('open', 'closed') LOOP
    IF NOT lift_has_child_on(p_person, o.school_id, o.team_code) THEN
      PERFORM lift_offer_end(o.id, 'cancelled', 'link_ended', NULL);
    END IF;
  END LOOP;
  FOR s IN SELECT ls.id, ls.offer_id FROM lift_seat ls JOIN role_assignment a ON a.id = ls.guardian_assignment_id
            WHERE a.person_id = p_person AND ls.state IN ('requested', 'invited', 'confirmed')
              AND ls.boarded_at IS NULL
              AND NOT lift_link_is_live(ls.guardian_link_id) LOOP
    UPDATE lift_seat SET state = 'void', ended_at = now() WHERE id = s.id;
    PERFORM lift_notify(s.offer_id, (SELECT x.driver_id FROM lift_offer x WHERE x.id = s.offer_id), NULL,
      'A seat was withdrawn', lift_offer_words(s.offer_id) || ': a seat is no longer confirmed and has been withdrawn.');
    PERFORM lift_lone_fallback(s.offer_id);
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/70's lift_self_settle(): the same — a boy in the car keeps his seat. */
CREATE OR REPLACE FUNCTION lift_self_settle(p_player uuid) RETURNS void AS $$
DECLARE s record;
BEGIN
  IF p_player IS NULL OR EXISTS (SELECT 1 FROM lift_self_accounts(p_player)) THEN RETURN; END IF;
  FOR s IN SELECT ls.id, ls.offer_id FROM lift_seat ls
            WHERE ls.player_id = p_player AND ls.consent_by = 'self'
              AND ls.state IN ('requested', 'invited', 'confirmed') AND ls.boarded_at IS NULL LOOP
    UPDATE lift_seat SET state = 'void', ended_at = now() WHERE id = s.id;
    PERFORM lift_notify(s.offer_id, (SELECT x.driver_id FROM lift_offer x WHERE x.id = s.offer_id), NULL,
      'A seat was withdrawn', lift_offer_words(s.offer_id) || ': a seat is no longer confirmed and has been withdrawn.');
    PERFORM lift_lone_fallback(s.offer_id);
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/70's lift_offer_update(): refused on the road (on_the_road). */
CREATE OR REPLACE FUNCTION lift_offer_update(p_offer uuid, p_seats integer, p_meet_kind text, p_meet_at timestamptz,
                                             p_note text, p_version integer)
RETURNS TABLE (ok boolean, reason text, version integer) AS $$
#variable_conflict use_column
DECLARE
  o      lift_offer%ROWTYPE;
  m      match%ROWTYPE;
  d      lift_driver_declaration%ROWTYPE;
  v_word text;
  v_new  integer;
  v_conf integer;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer FOR UPDATE;
  IF NOT FOUND OR NOT lift_is_driver(o) THEN RETURN QUERY SELECT false, 'not_permitted', NULL::integer; RETURN; END IF;
  IF o.state NOT IN ('open', 'closed') THEN RETURN QUERY SELECT false, 'offer_ended', NULL::integer; RETURN; END IF;
  IF lift_on_the_road(p_offer) THEN RETURN QUERY SELECT false, 'on_the_road', NULL::integer; RETURN; END IF;
  IF p_version IS DISTINCT FROM o.version THEN RETURN QUERY SELECT false, 'version_conflict', o.version; RETURN; END IF;
  IF NOT lift_module_live(o.school_id) THEN RETURN QUERY SELECT false, 'module_disabled', NULL::integer; RETURN; END IF;
  SELECT * INTO m FROM match WHERE id = o.match_id;
  IF m.status <> 'scheduled' OR m.starts_at <= now() THEN
    RETURN QUERY SELECT false, 'fixture_not_ahead', NULL::integer; RETURN;
  END IF;
  IF p_meet_kind IS NULL OR p_meet_kind NOT IN ('school', 'ground') THEN
    RETURN QUERY SELECT false, 'meet_kind', NULL::integer; RETURN;
  END IF;
  v_word := lift_meet_refusal(o.leg, p_meet_at, m.starts_at);
  IF v_word IS NOT NULL THEN RETURN QUERY SELECT false, v_word, NULL::integer; RETURN; END IF;
  SELECT * INTO d FROM lift_driver_declaration WHERE id = o.declaration_id;
  IF p_seats IS NULL OR p_seats < 1 THEN RETURN QUERY SELECT false, 'seats_out_of_range', NULL::integer; RETURN; END IF;
  IF p_seats > d.seats THEN RETURN QUERY SELECT false, 'more_seats_than_declared', NULL::integer; RETURN; END IF;
  SELECT count(*) INTO v_conf FROM lift_seat WHERE offer_id = p_offer AND state = 'confirmed';
  IF p_seats < v_conf THEN RETURN QUERY SELECT false, 'seats_below_confirmed', NULL::integer; RETURN; END IF;
  p_note := nullif(btrim(p_note), '');
  IF p_note IS NOT NULL AND length(p_note) > 120 THEN RETURN QUERY SELECT false, 'note_too_long', NULL::integer; RETURN; END IF;
  v_new := o.version + 1;
  UPDATE lift_offer SET seats = p_seats, meet_kind = p_meet_kind, meet_at = p_meet_at, note = p_note,
                        version = v_new, driver_version = v_new,
                        fixture_starts_at = m.starts_at, fixture_ground_id = m.ground_id
   WHERE id = p_offer;
  UPDATE lift_seat SET driver_ok_version = v_new
   WHERE offer_id = p_offer AND state IN ('confirmed', 'invited') AND driver_ok_version IS NOT NULL;
  PERFORM lift_ask_families(p_offer);
  RETURN QUERY SELECT true, NULL::text, v_new;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/70's lift_offer_cancel(): refused on the road (on_the_road) — the office resolves instead. */
CREATE OR REPLACE FUNCTION lift_offer_cancel(p_offer uuid) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE
  o      lift_offer%ROWTYPE;
  v_kind text;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF lift_is_driver(o) THEN v_kind := 'driver';
  ELSIF lift_uncut(o.school_id)
        AND app_can('transport.lift.oversee', o.school_id, o.team_code,
                    '00000000-0000-0000-0000-000000000000'::uuid, o.match_id) THEN v_kind := 'school';
  ELSE RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF o.state NOT IN ('open', 'closed') THEN RETURN QUERY SELECT false, 'offer_ended'; RETURN; END IF;
  IF lift_on_the_road(p_offer) THEN RETURN QUERY SELECT false, 'on_the_road'; RETURN; END IF;
  PERFORM lift_offer_end(p_offer, 'cancelled', v_kind, app_user_id(), v_kind = 'school');
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/70's lift_policy_withdraw(): counts the lifts it ended; one on the road runs to its end. */
CREATE OR REPLACE FUNCTION lift_policy_withdraw(p_school uuid)
RETURNS TABLE (ok boolean, reason text, cancelled integer) AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := app_user_id();
  o    record;
  n    integer := 0;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', 0; RETURN; END IF;
  IF NOT lift_uncut(p_school)
     OR NOT app_can('transport.lift.policy', p_school, '*'::text,
                    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted', 0; RETURN;
  END IF;
  UPDATE lift_policy SET withdrawn_at = now(), withdrawn_by = v_me
   WHERE school_id = p_school AND withdrawn_at IS NULL;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_live_policy', 0; RETURN; END IF;
  FOR o IN SELECT id FROM lift_offer WHERE school_id = p_school AND state IN ('open', 'closed') AND NOT lift_on_the_road(id) LOOP
    PERFORM lift_offer_end(o.id, 'cancelled', 'policy_withdrawn', v_me, true);
    n := n + 1;
  END LOOP;
  RETURN QUERY SELECT true, NULL::text, n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** db/70's lift_driver_declaration_withdraw(): the same count. */
CREATE OR REPLACE FUNCTION lift_driver_declaration_withdraw(p_school uuid)
RETURNS TABLE (ok boolean, reason text, cancelled integer) AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := app_user_id();
  o    record;
  n    integer := 0;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', 0; RETURN; END IF;
  IF NOT lift_uncut(p_school) THEN RETURN QUERY SELECT false, 'not_permitted', 0; RETURN; END IF;
  UPDATE lift_driver_declaration SET withdrawn_at = now()
   WHERE person_id = v_me AND school_id = p_school AND withdrawn_at IS NULL;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_declaration', 0; RETURN; END IF;
  FOR o IN SELECT id FROM lift_offer WHERE driver_id = v_me AND school_id = p_school AND state IN ('open', 'closed')
                                       AND NOT lift_on_the_road(id) LOOP
    PERFORM lift_offer_end(o.id, 'cancelled', 'driver', v_me);
    n := n + 1;
  END LOOP;
  RETURN QUERY SELECT true, NULL::text, n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 5 · The driver's marks (§1.3) ──────────────────────────────────
/**
 * The driver's two acts on her lift: we have left, we have arrived. Only the
 * offer's driver, still holding transport.lift.arrange on its side — so a
 * guardian revoked or suspended is refused on an offer that still names her
 * (db/41's rule) — on the day, and each once, forwards. Her declaration
 * having expired since does not stop the record of what happened (§6.5).
 *   departed  the lift on its version (not waiting on her after a fixture
 *             move); it closes to new requests; a request she never accepted
 *             is declined, and its family told; a confirmed boy not marked in
 *             is told to his family.
 *   arrived   after departed; the lift is done once every confirmed boy on
 *             it is received or resolved (lift_offer_settle()).
 */
CREATE OR REPLACE FUNCTION lift_mark(p_offer uuid, p_event text) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE
  o       lift_offer%ROWTYPE;
  s       record;
  v_words text;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer FOR UPDATE;
  IF NOT FOUND OR NOT coalesce(lift_is_driver(o), false) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF p_event IS NULL OR p_event NOT IN ('departed', 'arrived') THEN RETURN QUERY SELECT false, 'unknown_event'; RETURN; END IF;
  IF o.state NOT IN ('open', 'closed') THEN RETURN QUERY SELECT false, 'offer_ended'; RETURN; END IF;
  IF NOT lift_in_day(o.meet_at) THEN RETURN QUERY SELECT false, 'not_the_day'; RETURN; END IF;
  v_words := lift_offer_words(o.id);
  IF p_event = 'departed' THEN
    IF o.departed_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_departed'; RETURN; END IF;
    IF o.driver_version < o.version THEN RETURN QUERY SELECT false, 'awaiting_driver'; RETURN; END IF;
    UPDATE lift_offer SET departed_at = now(), state = 'closed' WHERE id = o.id;
    FOR s IN UPDATE lift_seat SET state = 'declined', ended_at = now(), ended_by = NULL
              WHERE offer_id = o.id AND state IN ('requested', 'invited')
             RETURNING player_id LOOP
      PERFORM lift_notify_family(o.id, s.player_id, 'A seat request was not accepted',
        v_words || ' has left. The seat you asked for was not accepted; please make other arrangements.');
    END LOOP;
    FOR s IN SELECT ls.player_id FROM lift_seat ls
              WHERE ls.offer_id = o.id AND ls.state = 'confirmed' AND ls.boarded_at IS NULL LOOP
      PERFORM lift_notify_family(o.id, s.player_id, 'A lift has left: he was not marked in the car',
        v_words || ' has left, and his seat was not marked "in the car". If he is not with the driver, '
          || 'ring her now: her number is on the fixture.');
    END LOOP;
  ELSE
    IF o.departed_at IS NULL THEN RETURN QUERY SELECT false, 'not_departed'; RETURN; END IF;
    IF o.arrived_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_arrived'; RETURN; END IF;
    UPDATE lift_offer SET arrived_at = now() WHERE id = o.id;
    PERFORM lift_offer_settle(o.id);
  END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The driver's marks on one boy: in the car, handed over, not collected.
 * Only a confirmed seat, on the day, each once and forwards; "in" while his
 * yes still stands on the lift as it is (status confirmed); a handover only
 * after he is in and the car has left, and not once his receiver has him.
 * Not collected (§6.2) tells every live guardian of the boy, the office
 * (transport.lift.oversee at the school) and — on the way out — the side's
 * staff, each pointed at him and naming nobody; the seat stays in exception,
 * and the lift short of done, until it is received or resolved.
 */
CREATE OR REPLACE FUNCTION lift_seat_mark(p_seat uuid, p_event text) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE
  v_offer uuid;
  o       lift_offer%ROWTYPE;
  s       lift_seat%ROWTYPE;
  r       uuid;
  v_words text;
BEGIN
  SELECT ls.offer_id INTO v_offer FROM lift_seat ls WHERE ls.id = p_seat;
  IF v_offer IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  SELECT * INTO o FROM lift_offer WHERE id = v_offer FOR UPDATE;
  SELECT * INTO s FROM lift_seat WHERE id = p_seat FOR UPDATE;
  IF NOT coalesce(lift_is_driver(o), false) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF p_event IS NULL OR p_event NOT IN ('boarded', 'handed_over', 'not_collected') THEN
    RETURN QUERY SELECT false, 'unknown_event'; RETURN;
  END IF;
  IF o.state NOT IN ('open', 'closed') THEN RETURN QUERY SELECT false, 'offer_ended'; RETURN; END IF;
  IF NOT lift_in_day(o.meet_at) THEN RETURN QUERY SELECT false, 'not_the_day'; RETURN; END IF;
  IF s.state <> 'confirmed' THEN RETURN QUERY SELECT false, 'not_confirmed'; RETURN; END IF;
  IF p_event = 'boarded' THEN
    IF s.boarded_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_marked'; RETURN; END IF;
    IF lift_seat_status(s) <> 'confirmed' THEN RETURN QUERY SELECT false, 'not_confirmed'; RETURN; END IF;
    IF s.handed_over_at IS NOT NULL OR s.acknowledged_at IS NOT NULL THEN
      RETURN QUERY SELECT false, 'already_received'; RETURN;
    END IF;
    UPDATE lift_seat SET boarded_at = now() WHERE id = p_seat;
    RETURN QUERY SELECT true, NULL::text; RETURN;
  END IF;
  IF s.boarded_at IS NULL THEN RETURN QUERY SELECT false, 'not_boarded'; RETURN; END IF;
  IF o.departed_at IS NULL THEN RETURN QUERY SELECT false, 'not_departed'; RETURN; END IF;
  IF s.handed_over_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_marked'; RETURN; END IF;
  IF s.acknowledged_at IS NOT NULL OR s.resolved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_received'; RETURN; END IF;
  UPDATE lift_seat SET handed_over_at = now(),
                       handover_kind = CASE p_event WHEN 'handed_over' THEN 'received' ELSE 'not_collected' END
   WHERE id = p_seat;
  IF p_event = 'not_collected' THEN
    v_words := lift_offer_words(o.id);
    PERFORM lift_notify_family(o.id, s.player_id, 'He was not collected from his lift',
      v_words || ': the driver could not hand him over at ' || lift_clock(now()) || '. She is staying with him. '
        || 'Ring her now: her number is on the fixture. Confirm on the fixture when you have him.');
    FOR r IN SELECT lift_staff(o.school_id, NULL, 'transport.lift.oversee') LOOP
      PERFORM lift_notify_staff(o.id, r, s.player_id, 'transport.lift.oversee', 'A boy was not collected from a lift',
        v_words || ': a boy was not collected at ' || lift_clock(now()) || '. The driver is staying with him. '
          || 'He is on the lift exceptions, by name.');
    END LOOP;
    IF o.leg = 'out' THEN
      FOR r IN SELECT lift_staff(o.school_id, o.team_code, 'transport.lift.receive') LOOP
        PERFORM lift_notify_staff(o.id, r, s.player_id, 'transport.lift.receive', 'A boy on a lift was not handed over',
          v_words || ': the driver could not hand a boy over at ' || lift_clock(now()) || '. Find her at the ground.');
      END LOOP;
    END IF;
  END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 6 · Who receives (§1.6) ────────────────────────────────────────
/**
 * The receiver says she has him. On the way OUT that is the side's staff —
 * transport.lift.receive on the fixture's side, with the boy as the anchor —
 * and no guardian (she is not at the ground). On the way HOME it is any live
 * guardian of the boy (her consent granted: db/70's lift_acting_for()), or he
 * himself at eighteen and still at school — and no coach. On the day, on a
 * confirmed seat, once. A seat marked not collected and then received is
 * resolved 'collected_late' by the same act. Not module-gated.
 */
CREATE OR REPLACE FUNCTION lift_receive(p_seat uuid) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE
  v_offer uuid;
  o       lift_offer%ROWTYPE;
  s       lift_seat%ROWTYPE;
  a       record;
  v_me    uuid := app_user_id();
BEGIN
  SELECT ls.offer_id INTO v_offer FROM lift_seat ls WHERE ls.id = p_seat;
  IF v_offer IS NULL OR v_me IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  SELECT * INTO o FROM lift_offer WHERE id = v_offer FOR UPDATE;
  SELECT * INTO s FROM lift_seat WHERE id = p_seat FOR UPDATE;
  IF NOT lift_uncut_for(s.school_id, s.player_id) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF s.leg = 'out' THEN
    IF lift_is_pupil(v_me)
       OR NOT app_can('transport.lift.receive', s.school_id, s.team_code, s.player_id, s.match_id) THEN
      RETURN QUERY SELECT false, 'not_permitted'; RETURN;
    END IF;
  ELSE
    SELECT * INTO a FROM lift_acting_for(s.player_id);
    IF a.how IS NULL OR a.how NOT IN ('guardian', 'guardian_adult', 'self') THEN
      RETURN QUERY SELECT false, 'not_permitted'; RETURN;
    END IF;
  END IF;
  IF NOT lift_in_day(o.meet_at) THEN RETURN QUERY SELECT false, 'not_the_day'; RETURN; END IF;
  IF s.state <> 'confirmed' THEN RETURN QUERY SELECT false, 'not_confirmed'; RETURN; END IF;
  IF s.acknowledged_at IS NOT NULL OR s.resolved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_received'; RETURN; END IF;
  UPDATE lift_seat SET acknowledged_at = now(), acknowledged_by = v_me,
                       resolution  = CASE WHEN s.handover_kind = 'not_collected' THEN 'collected_late' END,
                       resolved_at = CASE WHEN s.handover_kind = 'not_collected' THEN now() END,
                       resolved_by = CASE WHEN s.handover_kind = 'not_collected' THEN v_me END
   WHERE id = p_seat;
  PERFORM lift_offer_settle(o.id);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The office closes a seat in exception (§6.2): transport.lift.oversee at the
 * school, once the lift has left or its meeting time has come, on a confirmed seat nobody has
 * received or resolved — collected late, at the school office, or other. A
 * driver who could not mark, and a boy the car left without, are closed the
 * same way. Not module-gated.
 */
CREATE OR REPLACE FUNCTION lift_resolve(p_seat uuid, p_resolution text) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE
  v_offer uuid;
  o       lift_offer%ROWTYPE;
  s       lift_seat%ROWTYPE;
BEGIN
  SELECT ls.offer_id INTO v_offer FROM lift_seat ls WHERE ls.id = p_seat;
  IF v_offer IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  SELECT * INTO o FROM lift_offer WHERE id = v_offer FOR UPDATE;
  SELECT * INTO s FROM lift_seat WHERE id = p_seat FOR UPDATE;
  IF NOT lift_uncut(s.school_id)
     OR NOT app_can('transport.lift.oversee', s.school_id, s.team_code, s.player_id, s.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF p_resolution IS NULL OR p_resolution NOT IN ('collected_late', 'school_office', 'other') THEN
    RETURN QUERY SELECT false, 'resolution'; RETURN;
  END IF;
  IF s.state <> 'confirmed' THEN RETURN QUERY SELECT false, 'not_confirmed'; RETURN; END IF;
  IF s.acknowledged_at IS NOT NULL OR s.resolved_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_received'; RETURN; END IF;
  IF o.meet_at > now() AND o.departed_at IS NULL THEN RETURN QUERY SELECT false, 'not_yet'; RETURN; END IF;
  UPDATE lift_seat SET resolved_at = now(), resolved_by = app_user_id(), resolution = p_resolution WHERE id = p_seat;
  PERFORM lift_offer_settle(o.id);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 7 · The day's reads ────────────────────────────────────────────
/**
 * A seat's status on the day: db/70's lift_seat_status(), except that a boy
 * in the car is on the lift whatever has happened to the yes behind his seat
 * since (a link that ended mid-way does not take him out of the car).
 */
CREATE OR REPLACE FUNCTION lift_day_status(s lift_seat) RETURNS text AS $$
  SELECT CASE WHEN s.state = 'confirmed' AND s.boarded_at IS NOT NULL THEN 'confirmed' ELSE lift_seat_status(s) END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** One seat's marks, as the day cards read them. Internal. */
CREATE OR REPLACE FUNCTION lift_seat_marks(s lift_seat) RETURNS jsonb AS $$
  SELECT jsonb_build_object('seatId', s.id, 'playerId', s.player_id, 'status', lift_day_status(s),
           'boardedAt', s.boarded_at, 'handedOverAt', s.handed_over_at, 'handoverKind', s.handover_kind,
           'acknowledgedAt', s.acknowledged_at, 'resolvedAt', s.resolved_at, 'resolution', s.resolution)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The day cards on one fixture, for the caller, on the day only (the window):
 *   as the driver   each of her lifts on it: its marks, and every seat on it
 *                   — confirmed, done, and those "not confirmed — do not
 *                   take" — by the boy's full name, with its marks. The names
 *                   are logged ('lift_day', [offer], '{name}').
 *   as a family     each lift on it carrying a boy of hers (a live link, her
 *                   consent granted) — or himself, eighteen and at school —
 *                   on a confirmed or done seat: the driver's name, the
 *                   place, the time, the lift's marks and his. Her own; not
 *                   logged (§5.4). mayReceive on the way home.
 * Nothing to anybody else, a pupil under eighteen included. Not
 * module-gated. Numbers stay lift_contacts()'s.
 */
CREATE OR REPLACE FUNCTION lift_my_day(p_match uuid) RETURNS jsonb AS $$
DECLARE
  v_me   uuid := app_user_id();
  o      lift_offer%ROWTYPE;
  v_out  jsonb := '[]';
  v_seats jsonb;
  v_place text;
  v_logged uuid[] := '{}';
BEGIN
  IF v_me IS NULL THEN RETURN v_out; END IF;
  FOR o IN SELECT * FROM lift_offer WHERE match_id = p_match AND state IN ('open', 'closed', 'done')
            ORDER BY leg DESC, meet_at, created_at LOOP
    CONTINUE WHEN NOT lift_in_day(o.meet_at) OR NOT lift_cuts_ok(o.school_id);
    v_place := CASE o.meet_kind WHEN 'ground' THEN 'At the ground'
                    ELSE coalesce('At school: ' || (lift_policy_live(o.school_id)).meet_note, 'At school') END;
    IF coalesce(lift_is_driver(o), false) THEN
      SELECT coalesce(jsonb_agg(lift_seat_marks(s) || jsonb_build_object('name', p.full_name) ORDER BY p.full_name), '[]')
        INTO v_seats
        FROM lift_seat s JOIN player p ON p.id = s.player_id
       WHERE s.offer_id = o.id AND s.state IN ('requested', 'invited', 'confirmed', 'done');
      IF jsonb_array_length(v_seats) > 0 THEN v_logged := v_logged || o.id; END IF;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'as', 'driver', 'offerId', o.id, 'leg', o.leg, 'meetPlace', v_place, 'meetAt', o.meet_at, 'state', o.state,
        'departedAt', o.departed_at, 'arrivedAt', o.arrived_at, 'awaitingDriver', o.driver_version < o.version,
        'seats', v_seats));
    ELSE
      SELECT coalesce(jsonb_agg(lift_seat_marks(s) || jsonb_build_object('name', p.full_name,
               'mayReceive', o.leg = 'back' AND s.state = 'confirmed' AND s.acknowledged_at IS NULL AND s.resolved_at IS NULL,
               'self', a.how = 'self') ORDER BY p.full_name), '[]')
        INTO v_seats
        FROM lift_seat s JOIN player p ON p.id = s.player_id
        CROSS JOIN LATERAL lift_acting_for(s.player_id) a
       WHERE s.offer_id = o.id AND s.state IN ('confirmed', 'done')
         AND lift_uncut_for(o.school_id, s.player_id)
         AND (a.how = 'self'
              OR (a.how IN ('guardian', 'guardian_adult')
                  AND app_can('transport.lift.arrange', s.school_id, s.team_code, s.player_id, s.match_id)));
      CONTINUE WHEN jsonb_array_length(v_seats) = 0;
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'as', 'family', 'offerId', o.id, 'leg', o.leg, 'meetPlace', v_place, 'meetAt', o.meet_at, 'state', o.state,
        'departedAt', o.departed_at, 'arrivedAt', o.arrived_at,
        'driverName', (SELECT u.name FROM app_user u WHERE u.id = o.driver_id), 'seats', v_seats));
    END IF;
  END LOOP;
  IF cardinality(v_logged) > 0 THEN
    PERFORM log_restricted_read('lift_day', v_logged, '{name}'::text[], (SELECT x.school_id FROM lift_offer x WHERE x.id = v_logged[1]));
  END IF;
  RETURN v_out;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The coach's head count (§1.6, D7): on each side of the fixture where the
 * caller holds transport.lift.receive, every boy on a confirmed (or done)
 * seat on the way OUT — his name, the driver's name, the meeting time, the
 * lift's and the seat's marks, and "not left" once the lift is 45 minutes
 * past its meeting time unmarked. Never the way home, never a number, never
 * another side. Logged ('lift_expected', [offers], '{name}').
 */
CREATE OR REPLACE FUNCTION lift_expected(p_match uuid)
RETURNS TABLE (seat_id uuid, offer_id uuid, player_id uuid, full_name text, driver_name text, meet_at timestamptz,
               departed_at timestamptz, arrived_at timestamptz, boarded_at timestamptz, handed_over_at timestamptz,
               handover_kind text, acknowledged_at timestamptz, resolved_at timestamptz, status text, not_left boolean) AS $$
#variable_conflict use_column
DECLARE
  m      match%ROWTYPE;
  sd     record;
  v_ids  uuid[];
BEGIN
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND OR app_user_id() IS NULL OR lift_is_pupil(app_user_id()) THEN RETURN; END IF;
  FOR sd IN SELECT x.s AS school_id, x.t AS team_code
              FROM (VALUES (1, m.school_id, m.team_code), (2, m.away_school_id, m.away_team_code)) x(i, s, t)
             WHERE x.s IS NOT NULL AND x.t IS NOT NULL ORDER BY x.i LOOP
    CONTINUE WHEN NOT lift_uncut(sd.school_id)
               OR NOT app_can('transport.lift.receive', sd.school_id, sd.team_code,
                              '00000000-0000-0000-0000-000000000000'::uuid, p_match);
    SELECT array_agg(DISTINCT o.id) INTO v_ids
      FROM lift_offer o JOIN lift_seat s ON s.offer_id = o.id
     WHERE o.match_id = p_match AND o.school_id = sd.school_id AND o.team_code = sd.team_code AND o.leg = 'out'
       AND o.state IN ('open', 'closed', 'done')
       AND (lift_day_status(s) = 'confirmed' OR s.state = 'done');
    CONTINUE WHEN v_ids IS NULL;
    PERFORM log_restricted_read('lift_expected', v_ids, '{name}'::text[], sd.school_id);
    RETURN QUERY
      SELECT s.id, o.id, s.player_id, p.full_name, u.name, o.meet_at, o.departed_at, o.arrived_at, s.boarded_at,
             s.handed_over_at, s.handover_kind, s.acknowledged_at, s.resolved_at, lift_day_status(s),
             o.departed_at IS NULL AND o.meet_at + interval '45 minutes' <= now()
        FROM lift_offer o
        JOIN lift_seat s ON s.offer_id = o.id
        JOIN player p ON p.id = s.player_id
        JOIN app_user u ON u.id = o.driver_id
       WHERE o.id = ANY (v_ids) AND (lift_day_status(s) = 'confirmed' OR s.state = 'done')
       ORDER BY o.meet_at, p.full_name;
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The office's exceptions (§6, D10), by name, at one school (one fixture if
 * named): every confirmed seat nobody has received or resolved that is
 *   not_left        on a lift 45 minutes past its meeting time, not left;
 *   not_boarded     on a lift that left without him marked in;
 *   not_collected   marked not collected by the driver;
 *   not_received    handed over 30 minutes ago and not acknowledged;
 *   not_handed_over on a lift that has arrived, in the car, not handed over.
 * The boy's name and the driver's; no number. transport.lift.oversee at the
 * school only. Logged ('lift_exceptions', [offers], '{name}').
 */
CREATE OR REPLACE FUNCTION lift_exception_rows(p_school uuid, p_match uuid)
RETURNS TABLE (offer_id uuid, seat_id uuid, match_id uuid, leg text, kind text, player_id uuid, full_name text,
               driver_name text, meet_at timestamptz, since timestamptz) AS $$
  SELECT o.id, s.id, o.match_id, o.leg, x.kind, s.player_id, p.full_name, u.name, o.meet_at, x.since
    FROM lift_offer o
    JOIN lift_seat s ON s.offer_id = o.id
    JOIN player p ON p.id = s.player_id
    JOIN app_user u ON u.id = o.driver_id
    CROSS JOIN LATERAL (SELECT CASE
        WHEN s.handover_kind = 'not_collected' THEN 'not_collected'
        WHEN s.handover_kind = 'received' AND s.handed_over_at + interval '30 minutes' <= now() THEN 'not_received'
        WHEN s.handover_kind IS NULL AND o.arrived_at IS NOT NULL AND s.boarded_at IS NOT NULL THEN 'not_handed_over'
        WHEN o.departed_at IS NOT NULL AND s.boarded_at IS NULL THEN 'not_boarded'
        WHEN o.departed_at IS NULL AND o.meet_at + interval '45 minutes' <= now()
             AND lift_seat_status(s) = 'confirmed' THEN 'not_left'
      END AS kind,
      CASE WHEN s.handover_kind IS NOT NULL THEN s.handed_over_at
           WHEN o.arrived_at IS NOT NULL AND s.boarded_at IS NOT NULL THEN o.arrived_at
           WHEN o.departed_at IS NOT NULL THEN o.departed_at
           ELSE o.meet_at + interval '45 minutes' END AS since) x
   WHERE o.school_id = p_school AND (p_match IS NULL OR o.match_id = p_match)
     AND o.state IN ('open', 'closed')
     AND s.state = 'confirmed' AND s.acknowledged_at IS NULL AND s.resolved_at IS NULL
     AND x.kind IS NOT NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION lift_exceptions(p_school uuid, p_match uuid DEFAULT NULL)
RETURNS TABLE (offer_id uuid, seat_id uuid, match_id uuid, leg text, kind text, player_id uuid, full_name text,
               driver_name text, meet_at timestamptz, since timestamptz) AS $$
#variable_conflict use_column
DECLARE v_ids uuid[];
BEGIN
  IF app_user_id() IS NULL OR NOT lift_uncut(p_school)
     OR NOT app_can('transport.lift.oversee', p_school, '*'::text,
                    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN;
  END IF;
  SELECT array_agg(DISTINCT e.offer_id) INTO v_ids FROM lift_exception_rows(p_school, p_match) e;
  IF v_ids IS NULL THEN RETURN; END IF;
  PERFORM log_restricted_read('lift_exceptions', v_ids, '{name}'::text[], p_school);
  RETURN QUERY SELECT e.offer_id, e.seat_id, e.match_id, e.leg, e.kind, e.player_id, e.full_name, e.driver_name, e.meet_at, e.since
                 FROM lift_exception_rows(p_school, p_match) e ORDER BY e.since, e.full_name;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The boy's own line (S1), for the boy of eighteen still at school only
 * (decisions 4 and 5): his confirmed lifts from today on — the driver's name,
 * the place, the time and the car; never a number (rule 4: the number is
 * lift_contacts()'s, on the day, logged). mayReceive on the way home once the
 * car has left. His own; not logged. Nothing for anybody else, a pupil under
 * eighteen included.
 */
CREATE OR REPLACE FUNCTION my_lifts()
RETURNS TABLE (seat_id uuid, offer_id uuid, match_id uuid, leg text, driver_name text, meet_place text,
               meet_at timestamptz, vehicle text, status text, departed_at timestamptz, handed_over_at timestamptz,
               may_receive boolean) AS $$
#variable_conflict use_column
DECLARE v_me uuid := app_user_id();
BEGIN
  IF v_me IS NULL OR NOT lift_is_pupil(v_me) THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.id, o.id, o.match_id, o.leg, u.name,
           CASE o.meet_kind WHEN 'ground' THEN 'At the ground'
                ELSE coalesce('At school: ' || (lift_policy_live(o.school_id)).meet_note, 'At school') END,
           o.meet_at,
           coalesce((SELECT d.vehicle_description FROM lift_driver_declaration d
                      WHERE d.person_id = o.driver_id AND d.school_id = o.school_id AND d.withdrawn_at IS NULL),
                    (SELECT d.vehicle_description FROM lift_driver_declaration d WHERE d.id = o.declaration_id)),
           lift_day_status(s), o.departed_at, s.handed_over_at,
           o.leg = 'back' AND o.departed_at IS NOT NULL AND s.acknowledged_at IS NULL AND s.resolved_at IS NULL
      FROM lift_seat s
      JOIN lift_offer o ON o.id = s.offer_id
      JOIN app_user u ON u.id = o.driver_id
     WHERE s.state = 'confirmed' AND lift_day_status(s) = 'confirmed'
       AND o.state IN ('open', 'closed')
       AND (o.meet_at AT TIME ZONE 'Africa/Johannesburg')::date >= sa_today()
       AND lift_adult_self(v_me, s.player_id)
       AND lift_uncut_for(o.school_id, s.player_id)
     ORDER BY o.meet_at;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 8 · The watch (§6.1, §6.2, D14) ────────────────────────────────
/**
 * Run by the platform's key on a schedule (POST /api/lifts/watch). Inside the
 * day window, for every confirmed seat not yet alerted (missed_alerted_at,
 * once per seat):
 *   not left       its lift is 45 minutes past the meeting time with no
 *                  "left": his family told to ring the driver; the driver
 *                  asked, once per lift, to mark it or cancel it;
 *   not received   handed over 30 minutes ago and nobody has said they have
 *                  him: on the way out the side's staff and his family, on
 *                  the way home his family ("confirm").
 * Every notice names nobody. Returns counts. Nothing for anybody else.
 */
CREATE OR REPLACE FUNCTION lift_missed_watch()
RETURNS TABLE (ok boolean, reason text, not_left integer, not_received integer) AS $$
#variable_conflict use_column
DECLARE
  s       record;
  r       uuid;
  n_left  integer := 0;
  n_recv  integer := 0;
  v_told  uuid[] := '{}';
BEGIN
  IF NOT lift_platform_caller() THEN RETURN QUERY SELECT false, 'not_permitted', 0, 0; RETURN; END IF;
  FOR s IN SELECT ls.id, ls.player_id, o.id AS offer_id, o.driver_id
             FROM lift_seat ls JOIN lift_offer o ON o.id = ls.offer_id
            WHERE o.state IN ('open', 'closed') AND o.departed_at IS NULL
              AND o.meet_at + interval '45 minutes' <= now() AND lift_in_day(o.meet_at)
              AND ls.state = 'confirmed' AND ls.missed_alerted_at IS NULL
              AND ls.acknowledged_at IS NULL AND ls.resolved_at IS NULL
              AND lift_seat_status(ls) = 'confirmed'
            ORDER BY o.id, ls.id
              FOR UPDATE OF ls SKIP LOCKED LOOP
    UPDATE lift_seat SET missed_alerted_at = now() WHERE id = s.id;
    n_left := n_left + 1;
    PERFORM lift_notify_family(s.offer_id, s.player_id, 'A lift has not been marked as leaving',
      lift_offer_words(s.offer_id) || ' has not been marked as leaving. Ring the driver: her number is on the fixture.');
    IF NOT s.offer_id = ANY (v_told) THEN
      v_told := v_told || s.offer_id;
      PERFORM lift_notify(s.offer_id, s.driver_id, NULL, 'Has your lift left?',
        lift_offer_words(s.offer_id) || ' has not been marked as leaving. Mark it, or cancel it.');
    END IF;
  END LOOP;
  FOR s IN SELECT ls.id, ls.player_id, ls.handed_over_at, o.id AS offer_id, o.leg, o.school_id, o.team_code
             FROM lift_seat ls JOIN lift_offer o ON o.id = ls.offer_id
            WHERE o.state IN ('open', 'closed') AND lift_in_day(o.meet_at)
              AND ls.state = 'confirmed' AND ls.missed_alerted_at IS NULL
              AND ls.handover_kind = 'received' AND ls.handed_over_at + interval '30 minutes' <= now()
              AND ls.acknowledged_at IS NULL AND ls.resolved_at IS NULL
            ORDER BY o.id, ls.id
              FOR UPDATE OF ls SKIP LOCKED LOOP
    UPDATE lift_seat SET missed_alerted_at = now() WHERE id = s.id;
    n_recv := n_recv + 1;
    PERFORM lift_notify_family(s.offer_id, s.player_id, 'Please confirm you have him',
      lift_offer_words(s.offer_id) || ': the driver says she handed him over at ' || lift_clock(s.handed_over_at)
        || CASE s.leg WHEN 'back' THEN '. Confirm on the fixture that you have him.'
                      ELSE '. The coach has not yet said he is with the side.' END);
    IF s.leg = 'out' THEN
      FOR r IN SELECT lift_staff(s.school_id, s.team_code, 'transport.lift.receive') LOOP
        PERFORM lift_notify_staff(s.offer_id, r, s.player_id, 'transport.lift.receive', 'A boy on a lift is not marked with the side',
          lift_offer_words(s.offer_id) || ': the driver says she handed a boy over at ' || lift_clock(s.handed_over_at)
            || '. Mark him "with us", or find him.');
      END LOOP;
    END IF;
  END LOOP;
  RETURN QUERY SELECT true, NULL::text, n_left, n_recv;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 9 · The purge (§5.3, D9) ───────────────────────────────────────
/** The fixture's day, on the Johannesburg calendar. Internal. */
CREATE OR REPLACE FUNCTION lift_fixture_day(p_offer uuid) RETURNS date AS $$
  SELECT (coalesce(m.starts_at, o.fixture_starts_at) AT TIME ZONE 'Africa/Johannesburg')::date
    FROM lift_offer o LEFT JOIN match m ON m.id = o.match_id WHERE o.id = p_offer
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** A declaration's last day: withdrawn or expired, whichever came first. Internal. */
CREATE OR REPLACE FUNCTION lift_declaration_end(d lift_driver_declaration) RETURNS date AS $$
  SELECT least(d.expires_on, (d.withdrawn_at AT TIME ZONE 'Africa/Johannesburg')::date)
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

/** May the caller purge at this school? transport.lift.oversee there, uncut. */
CREATE OR REPLACE FUNCTION lift_purger(p_school uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND lift_uncut(p_school)
     AND app_can('transport.lift.oversee', p_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * What is due at a school (D9, assumptions the information officer set):
 * lifts three years after the fixture's day, and declarations a year after
 * they ended (withdrawn or expired) with no lift left on them. Ids, days and
 * counts; no name. transport.lift.oversee at the school only.
 */
CREATE OR REPLACE FUNCTION lift_purge_due(p_school uuid)
RETURNS TABLE (kind text, id uuid, match_id uuid, day date, leg text, seats integer) AS $$
#variable_conflict use_column
BEGIN
  IF NOT lift_purger(p_school) THEN RETURN; END IF;
  RETURN QUERY
    SELECT 'offer'::text, o.id, o.match_id, lift_fixture_day(o.id), o.leg,
           (SELECT count(*)::int FROM lift_seat s WHERE s.offer_id = o.id)
      FROM lift_offer o
     WHERE o.school_id = p_school AND (lift_fixture_day(o.id) + interval '3 years')::date <= sa_today()
    UNION ALL
    SELECT 'declaration'::text, d.id, NULL::uuid, lift_declaration_end(d), NULL::text, NULL::integer
      FROM lift_driver_declaration d
     WHERE d.school_id = p_school AND (d.withdrawn_at IS NOT NULL OR d.expires_on <= sa_today())
       AND (lift_declaration_end(d) + interval '1 year')::date <= sa_today()
       AND NOT EXISTS (SELECT 1 FROM lift_offer o WHERE o.declaration_id = d.id)
     ORDER BY 1 DESC, 4, 2;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Purge one lift that is due: it and its seats are deleted, and the school's
 * season row of counts is written (lift_purge_log, naming nobody). Refused
 * before the date (not_due) and to anybody but the office.
 */
CREATE OR REPLACE FUNCTION lift_purge(p_offer uuid) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE
  o        lift_offer%ROWTYPE;
  v_day    date;
  v_seats  integer;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer FOR UPDATE;
  IF NOT FOUND OR NOT lift_purger(o.school_id) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  v_day := lift_fixture_day(o.id);
  IF (v_day + interval '3 years')::date > sa_today() THEN RETURN QUERY SELECT false, 'not_due'; RETURN; END IF;
  SELECT count(*) INTO v_seats FROM lift_seat WHERE offer_id = o.id;
  DELETE FROM lift_offer WHERE id = o.id;
  INSERT INTO lift_purge_log AS l (school_id, season, offers, seats)
  VALUES (o.school_id, to_char(v_day, 'YYYY'), 1, v_seats)
  ON CONFLICT (school_id, season) DO UPDATE SET offers = l.offers + 1, seats = l.seats + excluded.seats, purged_at = now();
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** Purge one declaration that is due (a year after it ended, no lift on it); counted, naming nobody. */
CREATE OR REPLACE FUNCTION lift_purge_declaration(p_declaration uuid) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE
  d     lift_driver_declaration%ROWTYPE;
  v_end date;
BEGIN
  SELECT * INTO d FROM lift_driver_declaration WHERE id = p_declaration FOR UPDATE;
  IF NOT FOUND OR NOT lift_purger(d.school_id) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  v_end := lift_declaration_end(d);
  IF (d.withdrawn_at IS NULL AND d.expires_on > sa_today()) OR (v_end + interval '1 year')::date > sa_today() THEN
    RETURN QUERY SELECT false, 'not_due'; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM lift_offer o WHERE o.declaration_id = d.id) THEN
    RETURN QUERY SELECT false, 'lifts_remain'; RETURN;
  END IF;
  DELETE FROM lift_driver_declaration WHERE id = d.id;
  INSERT INTO lift_purge_log AS l (school_id, season, offers, seats, declarations)
  VALUES (d.school_id, to_char(v_end, 'YYYY'), 0, 0, 1)
  ON CONFLICT (school_id, season) DO UPDATE SET declarations = l.declarations + 1, purged_at = now();
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 10 · Grants ────────────────────────────────────────────────────
DO $grants$
DECLARE f text; r text;
  app text[] := ARRAY[
    'lift_mark(uuid,text)', 'lift_seat_mark(uuid,text)', 'lift_receive(uuid)', 'lift_resolve(uuid,text)',
    'lift_my_day(uuid)', 'lift_expected(uuid)', 'lift_exceptions(uuid,uuid)', 'my_lifts()',
    'lift_missed_watch()', 'lift_purge_due(uuid)', 'lift_purge(uuid)', 'lift_purge_declaration(uuid)'];
  internal text[] := ARRAY[
    'lift_in_day(timestamp with time zone)', 'lift_on_the_road(uuid)', 'lift_platform_caller()',
    'lift_staff(uuid,text,text)', 'lift_notify_staff(uuid,uuid,uuid,text,text,text)',
    'lift_clock(timestamp with time zone)', 'lift_offer_settle(uuid)', 'lift_road_guard()',
    'lift_seat_marks(lift_seat)', 'lift_day_status(lift_seat)', 'lift_fixture_day(uuid)', 'lift_declaration_end(lift_driver_declaration)',
    'lift_purger(uuid)', 'lift_exception_rows(uuid,uuid)'];
BEGIN
  FOREACH f IN ARRAY app LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH f IN ARRAY internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY app || internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ── 11 · Refuse to commit a file that did not do what it says ──────
DO $check$
DECLARE
  f      text;
  n      integer;
  v_list text;
BEGIN
  -- (1) The module is still off by default; nothing here granted it.
  IF (SELECT row(kind, enabled)::text FROM feature_flag WHERE key = 'lift_club') IS DISTINCT FROM '(module,f)' THEN
    RAISE EXCEPTION 'db/76: the lift_club module is not an off-by-default module';
  END IF;

  -- (2) Still no lift row holds a number, an address, a name or an e-mail.
  SELECT string_agg(table_name || '.' || column_name, ' ') INTO v_list
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name LIKE 'lift\_%'
     AND column_name ~ '(phone|address|name|email|id_number|mobile|location|latitude|longitude)';
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'db/76: a lift row carries [%]', v_list; END IF;

  -- (3) The road guards, beside db/70's rules.
  SELECT count(*) INTO n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
    ('lift_offer_road', 'lift_seat_road', 'lift_offer_fixed', 'lift_seat_fixed', 'lift_fixture_moved');
  IF n <> 5 THEN RAISE EXCEPTION 'db/76: % of the five lift triggers are in place', n; END IF;

  -- (4) Every lift function pinned and not PUBLIC's; the internal ones not the application's.
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND (p.proname LIKE 'lift\_%' OR p.proname IN ('my_lift_standing', 'my_lifts')) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/76: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/76: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['lift_offer_settle(uuid)', 'lift_notify_staff(uuid,uuid,uuid,text,text,text)',
                           'lift_staff(uuid,text,text)', 'lift_on_the_road(uuid)', 'lift_platform_caller()',
                           'lift_purger(uuid)', 'lift_offer_end(uuid,text,text,uuid,boolean)'] LOOP
    IF has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/76: % is internal and the application may call it', f;
    END IF;
  END LOOP;

  -- (5) The application still writes no lift row.
  FOREACH f IN ARRAY ARRAY['lift_policy', 'lift_driver_declaration', 'lift_offer', 'lift_seat', 'lift_purge_log'] LOOP
    IF has_table_privilege('scrbrd_app', f, 'INSERT') OR has_table_privilege('scrbrd_app', f, 'UPDATE')
       OR has_table_privilege('scrbrd_app', f, 'DELETE') THEN
      RAISE EXCEPTION 'db/76: the application may write %', f;
    END IF;
  END LOOP;
END $check$;
