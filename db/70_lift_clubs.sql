-- ══════════════════════════════════════════════════════════════════
--  70 · Parent lift clubs, phase 1: the arrangement (SCRBRD-124)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, like db/57: the generator's permissive policies cannot say
-- "a guardian reads the offers on her own child's side" or "the driver reads
-- names only through a logged door". The design is
-- docs/design/SCRBRD-124_lift_clubs.md (Fable, 2026-09-30; D1-D18 decided by
-- Kameel as recommended, D9 three years, D11's words as drafted). This file
-- is its phase 1 (§8, "1 · The arrangement"): parents offer seats in their
-- own cars to their own son's fixtures, other parents ask for a seat for
-- theirs, and a seat is confirmed only while the boy's guardian and the
-- driver have both said yes to the lift as it now stands. The day's marks,
-- the coach's expected list, the pupil's line, the watch and the purge are
-- phase 2; the DSO's bar, history and invitations phase 3. THE MODULE STAYS
-- OFF for every school: §8 puts it live only after phase 2 ("an arrangement
-- without the day's marks is a noticeboard").
--
-- WHAT IS HERE
--
--   transport.lift.arrange / .receive / .oversee / .policy
--                         the capabilities (ADDED_SINCE_01): arrange — the
--                         guardian; receive — coach, assistant coach, team
--                         manager; oversee — the roles holding
--                         transport.manage (schooladmin, sportsadmin,
--                         transportcoordinator); policy — the principal;
--                         superadmin all four, and the cuts below take every
--                         one of them back from the owner's key.
--   feature `lift_club`   a MODULE, arriving off: the platform grants it per
--                         school (the first key, D17).
--   lift_policy           the school's own text, signed by the principal (the
--                         second key): two enforceable switches (D4 clearance,
--                         D5 a lone passenger) and the named meeting point.
--   lift_driver_declaration  a parent's yearly statement that she may drive:
--                         licence, insurance, roadworthy, belts, the school's
--                         code read, the car and its seats. No number: see
--                         reach_contact_id below.
--   lift_offer            one driver, one fixture, one leg, so many seats, a
--                         named meeting point and a time; versioned, with the
--                         fixture as it stood when she last stood behind it.
--   lift_seat             one boy on one offer: requested, confirmed, declined,
--                         withdrawn, cancelled, void. Confirmed only while
--                         both the guardian's and the driver's yes are on the
--                         offer's current version (rule 1).
--   lift_purge_log        counts only; written by the phase 2 purge.
--   lift_seat_live        each seat with its derived status (§1.3).
--   the functions         §1.4 down to lift_contacts(), with lift_offers_for(),
--                         my_lift_standing() and lift_summary() (counts only).
--                         Every write goes through one of them; scrbrd_app
--                         holds SELECT on the tables and nothing else.
--   lift_fixture_moved    §1.5: AFTER a fixture's start, ground or status
--                         changes, beside SCRBRD-122's availability_ask_again
--                         (db/65) on the same table, a second trigger on its
--                         own events: start or ground moved — every live offer
--                         on it goes up a version and waits on its driver;
--                         abandoned — every live offer and seat void.
--   lift_links_settle     §6.4: deferred constraint triggers on
--                         assignment_subject, role_assignment (guardian) and
--                         team_membership — db/62's events — cancel the offers
--                         of a driver with no child left on the side
--                         ('link_ended') and void the seats a link that ended
--                         had consented to.
--
-- WHO READS WHAT (§2.3, §5)
--
--   lift_offer       the driver; a guardian with a child on the offer's side
--                    (lift_my_sides(), uncorrelated, db/41's shape).
--   lift_seat        the driver of its offer; the boy's own guardians.
--   lift_driver_declaration  the declarant; transport.lift.oversee at the
--                    school (the office reads the four facts and the car).
--   lift_policy      anyone with a live assignment at the school, except a
--                    pupil: the text is meant to be read by every family.
--   lift_purge_log   transport.lift.oversee at the school.
--   Three RESTRICTIVE cuts on every table: never under a support session at
--   the school, never by anybody holding a platform-wide assignment (the
--   owner's key, a platform administrator), and never by a pupil — plus
--   db/50's pad guard. The functions apply the same (lift_uncut()), so a
--   pupil is refused on every one of them.
--   A seat row carries player_id and nothing else about the boy: names reach
--   a driver only through lift_passengers(), and numbers only through
--   lift_contacts() inside the day window, both written to access_log.
--   No phone number, address or name is stored in any lift_* row.
--
-- WHERE THIS DIFFERS FROM THE DESIGN'S LETTER, and why
--
--   - The migration is db/70, not db/66 (§8's numbers were assumptions).
--   - The DRIVER'S NUMBER. §1.4 reads "the consenting guardian's name and
--     phone (app_user)", and app_user has no phone column: no adult parent's
--     number is held anywhere on the platform. A parent's numbers live on her
--     child's emergency_contact card, which the family keeps. So the
--     declaration names one of those rows — reach_contact_id, an active
--     contact on the card of a child she is a live guardian of — as "the
--     number the families on my lift ring on the day", and lift_contacts()
--     reads it live inside the window. No lift row holds a number; changing
--     or retiring the contact changes or removes what is read. The driver
--     reads each confirmed boy's own emergency contacts (trip_contacts()'s
--     reach, db/41), which is where his guardian's number is.
--   - transport.lift.oversee is held by schooladmin, sportsadmin and
--     transportcoordinator: the roles that hold transport.manage today
--     (roles.mjs). The design's assumption named directorofsport, who holds
--     transport.read only.
--   - receive and oversee read NO lift table directly. §2.3 gave them table
--     reads; §8's proof says a coach reads zero lift_offer rows, and §5.1/D10
--     keep ordinary passenger lists from the office. The stricter reading
--     holds both: they reach lifts only through the logged functions
--     (lift_passengers() for the out leg's receiver; lift_summary(), counts).
--   - A fixture "cancelled": match.status has no such word. 'abandoned' is the
--     fixture ended unplayed (db/30), and is what voids.
--   - D5, the lone passenger. "accept refuses while the confirmed count would
--     be one" would refuse the first acceptance on every offer forever under
--     a policy that refuses one-to-one. lift_seat_accept() therefore takes
--     several seats of one offer at once, and judges the count they leave.
--   - lift_offer.driver_version: the version the driver last stood behind
--     (create, edit, reaffirm). An offer whose fixture moved has version >
--     driver_version and every live seat reads awaiting_driver, which §1.3
--     needs and its columns could not say for a seat still only requested.
--   - lift_seat.team_code, guardian_assignment_id (the composite key to the
--     link, db/47's shape: assignment_subject's key is three columns),
--     ended_at and ended_by (who withdrew, declined or cancelled, and when —
--     the record phase 3's history reads).
--   - One live offer per driver per fixture per leg (lift_offer_one_live).
--   - A 'back' leg meets after the fixture starts, as an 'out' leg meets
--     before it; a meeting time is always in the future when set.
--   - A live link, for a lift, is verified, in date, through a live guardian
--     assignment, and its processing consent GRANTED (decision 2 below).
--   - Clearance (D4): 'current' or 'expiring' by clearance_status() — both are
--     live checks; only lapsed, revoked or missing refuses.
--   - No name in any notice body (§5.2). The examples in §1.4 named the
--     driver; the notices here name the fixture and the leg, and the screen
--     says who.
--   - The driver's own children are counted present, never seated: she asks
--     no seat for them on her own lift (driver_own_child).
--   - A boy of eighteen still at school: see decision 5. His guardian, while
--     db/62's past-eighteen link is live, may ask and withdraw for him as for
--     any child; the seat records who consented (lift_seat.consent_by).
--
-- KAMEEL'S DECISIONS (2026-10-01), built here before the file shipped
--
--   1. The driver's number: as built — her declaration names her own
--      emergency_contact row on her child's card, read live on the day, every
--      read logged. No phone field on any account.
--   2. Processing consent: a lift needs it GRANTED. A link whose consent is
--      pending (or anything but granted) neither offers nor asks
--      (consent_not_granted), and her standing line says why in plain words.
--      A consent that stops being granted voids the seats it gave and ends her
--      lifts on that side (the link triggers watch consent_state).
--   3. The lone passenger: when a withdrawal, or a seat voided because its
--      link ended, leaves one boy alone on a lift under a policy refusing
--      one-to-one, his seat falls back to requested (lift_lone_fallback()),
--      and his family and the driver are told, naming nobody. A policy
--      allowing one-to-one leaves it confirmed.
--   4. Pupils: out of lift clubs entirely. A caller who is a pupil — a player
--      record, or a live player or selfaccess assignment — is refused on
--      every function (pupil_excluded where a word is shown) and reads no lift
--      table, including asking a seat for a brother through a guardian link.
--      This supersedes D8's "from eighteen at school he asks for himself".
--   5. The narrow exception (2026-10-01, follow-up): a pupil eighteen or over
--      by date of birth AND still at the school (db/60's still_at_school, the
--      test db/62 uses) may ask a seat for HIMSELF on an offer for his own
--      side and fixture (consent_by 'self', no guardian link), withdraw it,
--      confirm it again, and read his own seat and the offer it is on: the
--      meet place and time, and once his seat is confirmed the driver's name
--      and her contact through lift_contacts(), logged as a guardian's read
--      is. Nothing else: a pupil under eighteen (or of unknown birth date)
--      is refused (not_yet_eighteen), one who has left (not_at_school); no
--      pupil acts for anyone else — an eighteen-year-old asking for his
--      brother through a guardian link is still pupil_excluded — and no
--      pupil drives, declares, offers, reads a lift table, a passenger list
--      or the office's counts. Notices about his seat go to him (kind
--      'system', behind transport.read, as SG-9 requires of a pupil) and to
--      his live guardians, naming nobody. A seat on his own say stands while
--      he is eighteen, at school and his self link live; when he leaves school
--      or the link ends it is void, as a guardian's seat is when her link
--      ends (lift_self_settle(), from the same triggers).
--      ONE-TO-ONE, as read here: CSA's rule protects children, so the count
--      is of CHILDREN — passengers under eighteen or of unknown birth date.
--      An adult passenger alone with the driver is not refused and never
--      falls back; and an adult does not make a lone child "not alone", so
--      a child with only an adult beside him still counts as one-to-one.
--
-- search_path is pinned on every function below (db/16). Every function the
-- application calls is granted to scrbrd_app and taken back from PUBLIC and a
-- managed host's API roles. Safe to run twice. db/99 §48 is the proof, with
-- principals, on every verify paste.


-- ── 0 · The capabilities ───────────────────────────────────────────
INSERT INTO capability (name) VALUES ('transport.lift.arrange') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('transport.lift.receive') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('transport.lift.oversee') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('transport.lift.policy')  ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('guardian',             'transport.lift.arrange'),
  ('coach',                'transport.lift.receive'),
  ('assistantcoach',       'transport.lift.receive'),
  ('teammanager',          'transport.lift.receive'),
  ('schooladmin',          'transport.lift.oversee'),
  ('sportsadmin',          'transport.lift.oversee'),
  ('transportcoordinator', 'transport.lift.oversee'),
  ('principal',            'transport.lift.policy'),
  ('superadmin',           'transport.lift.arrange'),
  ('superadmin',           'transport.lift.receive'),
  ('superadmin',           'transport.lift.oversee'),
  ('superadmin',           'transport.lift.policy')
ON CONFLICT DO NOTHING;


-- ── 1 · The module: the platform's key ─────────────────────────────
INSERT INTO feature_flag (key, kind, label, enabled, reason) VALUES
  ('lift_club', 'module', 'Lift club', false,
   'SCRBRD-124: parents give each other''s children lifts to fixtures. Holds who travels with whom, and when, about '
   'minors, so it is granted per school, never assumed; and it is live at a school only while the principal''s '
   'signed lift policy stands. Off everywhere until phase 2 (the day''s marks) lands.')
ON CONFLICT (key) DO NOTHING;


-- ── 2 · Small rules, shared ────────────────────────────────────────
/** Is this person a pupil (db/57's test), or the holder of a live self link? */
CREATE OR REPLACE FUNCTION lift_is_pupil(p_person uuid) RETURNS boolean AS $$
  SELECT person_is_pupil(p_person)
      OR EXISTS (SELECT 1 FROM role_assignment a
                   JOIN assignment_subject g ON g.assignment_id = a.id
                  WHERE a.person_id = p_person AND a.role = 'selfaccess' AND a.active
                    AND g.relationship = 'self' AND g.verification_state = 'verified'
                    AND (g.valid_until IS NULL OR g.valid_until > current_date))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The caller, for the RESTRICTIVE cut. */
CREATE OR REPLACE FUNCTION lift_caller_is_pupil() RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND lift_is_pupil(app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The cuts, for the functions as the tables' policies apply them: no support
 * session at the school, no platform-wide assignment, no pupil (Kameel,
 * 2026-10-01: pupils take no part in lift clubs at all), and no pad
 * credential. The owner's key holds all four capabilities and acts on none.
 * Every door below asks this, so a pupil is refused on every one of them.
 */
CREATE OR REPLACE FUNCTION lift_cuts_ok(p_school uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL
     AND app_support_access_id(p_school) IS NULL
     AND NOT app_is_platform_wide()
     AND NOT coalesce(app_pad_scoped(), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION lift_uncut(p_school uuid) RETURNS boolean AS $$
  SELECT lift_cuts_ok(p_school) AND NOT lift_is_pupil(app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * How a person stands with the children at a school (or on one side of it):
 * 'granted' — a live, verified guardian link whose processing consent is
 * granted; 'pending' — live and verified, but the consent not granted;
 * 'none' — no live verified guardian link there. Internal.
 */
CREATE OR REPLACE FUNCTION lift_family_at(p_person uuid, p_school uuid, p_team text DEFAULT NULL) RETURNS text AS $$
  SELECT CASE WHEN coalesce(bool_or(g.consent_state = 'granted'), false) THEN 'granted'
              WHEN count(*) > 0 THEN 'pending' ELSE 'none' END
    FROM role_assignment a
    JOIN assignment_subject g ON g.assignment_id = a.id AND g.relationship IS DISTINCT FROM 'self'
    JOIN player p ON p.id = g.player_id
   WHERE a.person_id = p_person AND a.role = 'guardian'
     AND p.school_id = p_school AND (p_team IS NULL OR p.team_code = p_team)
     AND a.active
     AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
     AND (a.valid_until IS NULL OR a.valid_until >  current_date)
     AND (a.expires_at IS NULL OR a.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
     AND g.verification_state = 'verified'
     AND g.valid_from <= current_date
     AND (g.valid_until IS NULL OR g.valid_until > current_date)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * A person's live link to a child through a role (guardian, or selfaccess for
 * his own): the assignment live (active, dated, not expired, not suspended),
 * the link verified and in date, its processing consent GRANTED (Kameel,
 * 2026-10-01: pending, withdrawn or anything else consents to no lift), and
 * the relationship the role means. db/47's public_name_live_link() with the
 * consent clause.
 */
CREATE OR REPLACE FUNCTION lift_live_link(p_person uuid, p_player uuid, p_role text)
RETURNS TABLE (assignment_id uuid, link_id uuid) AS $$
  SELECT g.assignment_id, g.id
    FROM role_assignment a
    JOIN assignment_subject g ON g.assignment_id = a.id AND g.player_id = p_player
   WHERE a.person_id = p_person
     AND a.role = p_role
     AND a.active
     AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
     AND (a.valid_until IS NULL OR a.valid_until >  current_date)
     AND (a.expires_at IS NULL OR a.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
     AND g.verification_state = 'verified'
     AND g.valid_from <= current_date
     AND (g.valid_until IS NULL OR g.valid_until > current_date)
     AND g.consent_state = 'granted'
     AND (CASE WHEN p_role = 'selfaccess' THEN g.relationship = 'self'
               ELSE g.relationship IS DISTINCT FROM 'self' END)
   ORDER BY g.verified_at DESC NULLS LAST, g.id
   LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** Is this one link live today, by the same test? */
CREATE OR REPLACE FUNCTION lift_link_is_live(p_link uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
     WHERE g.id = p_link
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       AND g.verification_state = 'verified'
       AND g.valid_from <= current_date
       AND (g.valid_until IS NULL OR g.valid_until > current_date)
       AND g.consent_state = 'granted')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * A minor, for the one-to-one rule: under eighteen by his date of birth, or
 * with no date of birth recorded (an unknown age is not an adult's).
 */
CREATE OR REPLACE FUNCTION lift_is_minor(p_player uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT majority_on(p.born) > sa_today() FROM player p WHERE p.id = p_player), true)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Kameel's follow-up (2026-10-01): the one exception to "pupils take no
 * part". A boy eighteen or over by his date of birth and still at school —
 * still_at_school(), the test db/62 uses for the guardian link past eighteen —
 * may be seated. Here: is he that boy, now?
 */
CREATE OR REPLACE FUNCTION lift_adult_at_school(p_player uuid) RETURNS boolean AS $$
  SELECT NOT lift_is_minor(p_player) AND still_at_school(p_player)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * ...and is this person that boy himself, through his own live self link
 * (verified, in date, consent granted — his own say)? Only ever about his own
 * player row: an adult pupil acts for nobody else.
 */
CREATE OR REPLACE FUNCTION lift_adult_self(p_person uuid, p_player uuid) RETURNS boolean AS $$
  SELECT p_person IS NOT NULL AND p_player IS NOT NULL
     AND EXISTS (SELECT 1 FROM lift_live_link(p_person, p_player, 'selfaccess'))
     AND lift_adult_at_school(p_player)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The cuts for a door that acts on one boy's seat: the base three, and no
 * pupil — unless the caller is that boy himself, eighteen and at school.
 */
CREATE OR REPLACE FUNCTION lift_uncut_for(p_school uuid, p_player uuid) RETURNS boolean AS $$
  SELECT lift_cuts_ok(p_school)
     AND (NOT lift_is_pupil(app_user_id()) OR lift_adult_self(app_user_id(), p_player))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The boy's own accounts, while he is eighteen and at school: his notices go to them. */
CREATE OR REPLACE FUNCTION lift_self_accounts(p_player uuid) RETURNS SETOF uuid AS $$
  SELECT DISTINCT a.person_id
    FROM role_assignment a
    JOIN assignment_subject g ON g.assignment_id = a.id AND g.player_id = p_player AND g.relationship = 'self'
   WHERE a.role = 'selfaccess' AND lift_adult_self(a.person_id, p_player)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The adults a boy's lift notices go to: his live guardians, never a pupil. */
CREATE OR REPLACE FUNCTION lift_guardians_of(p_player uuid) RETURNS SETOF uuid AS $$
  SELECT DISTINCT a.person_id
    FROM role_assignment a
    JOIN assignment_subject g ON g.assignment_id = a.id AND g.player_id = p_player
   WHERE a.role = 'guardian' AND g.relationship IS DISTINCT FROM 'self'
     AND lift_link_is_live(g.id)
     AND NOT lift_is_pupil(a.person_id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** Has this person a child, by a live guardian link, in this team at this school? (D2) */
CREATE OR REPLACE FUNCTION lift_has_child_on(p_person uuid, p_school uuid, p_team text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM player p
     WHERE p.school_id = p_school AND p.team_code IS NOT DISTINCT FROM p_team AND p_team IS NOT NULL
       AND EXISTS (SELECT 1 FROM lift_live_link(p_person, p.id, 'guardian')))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The sides (school, team) on which the caller has a child she may arrange
 * lifts for. Uncorrelated in lift_offer's policy, so it runs once per query,
 * and as a definer, so the policy reads no table under the caller's RLS
 * (db/41's trip_driven_matches() shape).
 */
CREATE OR REPLACE FUNCTION lift_my_sides() RETURNS TABLE (school_id uuid, team_code text) AS $$
  SELECT DISTINCT p.school_id, p.team_code
    FROM role_assignment a
    JOIN assignment_subject g ON g.assignment_id = a.id
    JOIN player p ON p.id = g.player_id
   WHERE a.person_id = app_user_id() AND a.role = 'guardian'
     AND g.relationship IS DISTINCT FROM 'self'
     AND p.team_code IS NOT NULL
     AND lift_link_is_live(g.id)
     AND app_can('transport.lift.arrange', p.school_id, p.team_code, p.id,
                 '00000000-0000-0000-0000-000000000000'::uuid)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** Does the caller hold a live assignment of any kind at this school? */
CREATE OR REPLACE FUNCTION lift_at_school(p_school uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.person_id = app_user_id() AND a.school_id = p_school AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at  IS NULL OR a.expires_at  >  now()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 3 · The tables ─────────────────────────────────────────────────
-- Rule 7: the school's own text, signed by the principal. One live version.
CREATE TABLE IF NOT EXISTS lift_policy (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  version            integer NOT NULL CHECK (version >= 1),
  body               text NOT NULL CHECK (length(btrim(body)) BETWEEN 200 AND 6000),
  requires_clearance boolean NOT NULL DEFAULT false,      -- D4
  allow_one_to_one   boolean NOT NULL DEFAULT true,       -- D5
  -- "the Chapel car park": the school's named point (D3). Never a home.
  meet_note          text CHECK (meet_note IS NULL OR length(btrim(meet_note)) BETWEEN 1 AND 80),
  signed_by          uuid NOT NULL REFERENCES app_user(id),
  signed_at          timestamptz NOT NULL DEFAULT now(),
  withdrawn_at       timestamptz,
  withdrawn_by       uuid REFERENCES app_user(id),
  UNIQUE (school_id, version),
  CONSTRAINT lift_policy_withdraw_whole CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS lift_policy_one_live ON lift_policy (school_id) WHERE withdrawn_at IS NULL;

-- Rule 2: only known adults drive. One live declaration per parent per school.
CREATE TABLE IF NOT EXISTS lift_driver_declaration (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id           uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  school_id           uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  vehicle_description text NOT NULL CHECK (length(btrim(vehicle_description)) BETWEEN 3 AND 60),
  registration        text NOT NULL CHECK (registration ~ '^[A-Z0-9 ]{2,12}$'),
  -- Passenger seats with belts, not counting her own children.
  seats               smallint NOT NULL CHECK (seats BETWEEN 1 AND 7),
  licence_held        boolean NOT NULL CHECK (licence_held),
  insured             boolean NOT NULL CHECK (insured),
  roadworthy          boolean NOT NULL CHECK (roadworthy),
  belts               boolean NOT NULL CHECK (belts),
  -- The school's policy and CSA's code (Annexure G) read and accepted.
  code_acknowledged   boolean NOT NULL CHECK (code_acknowledged),
  policy_version      integer NOT NULL,
  -- The number the families on her lift ring on the day: an emergency
  -- contact on her own child's card that is hers. A pointer, read live; no
  -- number is copied here (§1.2, §5.3).
  reach_contact_id    uuid REFERENCES emergency_contact(id) ON DELETE SET NULL,
  declared_at         timestamptz NOT NULL DEFAULT now(),
  expires_on          date NOT NULL,
  withdrawn_at        timestamptz,
  CONSTRAINT lift_declaration_expires_after CHECK (expires_on > declared_at::date)
);
CREATE UNIQUE INDEX IF NOT EXISTS lift_declaration_one_live ON lift_driver_declaration (person_id, school_id)
  WHERE withdrawn_at IS NULL;

CREATE TABLE IF NOT EXISTS lift_offer (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  match_id          uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  -- The school's side on the fixture, stamped by lift_offer_stamp().
  team_code         text NOT NULL,
  leg               text NOT NULL CHECK (leg IN ('out', 'back')),
  driver_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  declaration_id    uuid NOT NULL REFERENCES lift_driver_declaration(id),
  seats             smallint NOT NULL CHECK (seats BETWEEN 1 AND 7),
  -- D3: one of two named places, never free text, never a home.
  meet_kind         text NOT NULL CHECK (meet_kind IN ('school', 'ground')),
  meet_at           timestamptz NOT NULL,
  -- The driver's, to requesters: "leaving sharp; silver Fortuner".
  note              text CHECK (note IS NULL OR length(note) <= 120),
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- The version the driver last stood behind: create, edit, reaffirm. Behind
  -- `version` only when the fixture moved under her (§1.5).
  driver_version    integer NOT NULL DEFAULT 1,
  -- The fixture as it stood when she last stood behind the offer.
  fixture_starts_at timestamptz NOT NULL,
  fixture_ground_id uuid,
  fixture_changed_at timestamptz,
  state             text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'cancelled', 'void', 'done')),
  cancel_kind       text CHECK (cancel_kind IN ('driver', 'school', 'dso', 'fixture', 'link_ended', 'policy_withdrawn')),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES app_user(id),
  -- The driver's marks (phase 2), only ever null -> a time.
  departed_at       timestamptz,
  arrived_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lift_offer_cancel_whole CHECK ((state IN ('cancelled', 'void')) = (cancelled_at IS NOT NULL)
                                            AND (cancelled_at IS NULL) = (cancel_kind IS NULL)),
  CONSTRAINT lift_offer_arrives_after_departing CHECK (arrived_at IS NULL OR departed_at IS NOT NULL),
  CONSTRAINT lift_offer_driver_behind CHECK (driver_version BETWEEN 1 AND version)
);
CREATE INDEX IF NOT EXISTS lift_offer_match_idx ON lift_offer (match_id);
CREATE INDEX IF NOT EXISTS lift_offer_driver_idx ON lift_offer (driver_id) WHERE state IN ('open', 'closed');
CREATE INDEX IF NOT EXISTS lift_offer_school_idx ON lift_offer (school_id) WHERE state IN ('open', 'closed');
CREATE UNIQUE INDEX IF NOT EXISTS lift_offer_one_live ON lift_offer (match_id, driver_id, leg)
  WHERE state IN ('open', 'closed');

CREATE TABLE IF NOT EXISTS lift_seat (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id               uuid NOT NULL REFERENCES lift_offer(id) ON DELETE CASCADE,
  -- Denormalised from the offer by lift_seat_stamp(), so the policies anchor.
  school_id              uuid NOT NULL,
  match_id               uuid NOT NULL,
  team_code              text NOT NULL,
  leg                    text NOT NULL,
  player_id              uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- Who consented: 'guardian' — the live verified link, consent granted,
  -- named below; or 'self' — the boy himself, eighteen and still at school
  -- (Kameel's follow-up, 2026-10-01), and then no link.
  consent_by             text NOT NULL DEFAULT 'guardian' CHECK (consent_by IN ('guardian', 'self')),
  guardian_assignment_id uuid,
  guardian_link_id       uuid,
  requested_by           uuid NOT NULL REFERENCES app_user(id),
  -- Rule 1: confirmed only while both equal the offer's version.
  guardian_ok_version    integer,
  driver_ok_version      integer,
  state                  text NOT NULL CHECK (state IN ('requested', 'invited', 'confirmed', 'declined',
                                                        'withdrawn', 'cancelled', 'void', 'done')),
  ended_at               timestamptz,
  ended_by               uuid REFERENCES app_user(id),
  -- The day (phase 2): only ever null -> a time.
  boarded_at             timestamptz,
  handed_over_at         timestamptz,
  handover_kind          text CHECK (handover_kind IN ('received', 'not_collected')),
  acknowledged_at        timestamptz,
  acknowledged_by        uuid REFERENCES app_user(id),
  resolved_at            timestamptz,
  resolved_by            uuid REFERENCES app_user(id),
  resolution             text CHECK (resolution IN ('collected_late', 'school_office', 'other')),
  missed_alerted_at      timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guardian_assignment_id, player_id, guardian_link_id)
    REFERENCES assignment_subject (assignment_id, player_id, id) ON DELETE CASCADE,
  CONSTRAINT lift_seat_consent_whole CHECK ((consent_by = 'guardian') = (guardian_link_id IS NOT NULL)
                                           AND (guardian_assignment_id IS NULL) = (guardian_link_id IS NULL)),
  CONSTRAINT lift_seat_end_whole CHECK ((state IN ('declined', 'withdrawn', 'cancelled', 'void')) = (ended_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS lift_seat_offer_idx ON lift_seat (offer_id);
CREATE INDEX IF NOT EXISTS lift_seat_player_idx ON lift_seat (player_id);
CREATE INDEX IF NOT EXISTS lift_seat_link_idx ON lift_seat (guardian_assignment_id) WHERE guardian_assignment_id IS NOT NULL;
-- One live seat per boy per fixture per leg.
CREATE UNIQUE INDEX IF NOT EXISTS lift_seat_one_live ON lift_seat (match_id, player_id, leg)
  WHERE state IN ('requested', 'invited', 'confirmed');

-- §5.3: what is left after a purge names nobody. Written by phase 2's purge.
CREATE TABLE IF NOT EXISTS lift_purge_log (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  purged_at timestamptz NOT NULL DEFAULT now(),
  season    text NOT NULL CHECK (season ~ '^[0-9]{4}$'),
  offers    integer NOT NULL CHECK (offers >= 0),
  seats     integer NOT NULL CHECK (seats >= 0)
);

COMMENT ON TABLE lift_seat IS
  'One boy on one parent''s lift (SCRBRD-124, db/70): who travels with whom, and when — a minor''s movements. '
  'Read by the driver and the boy''s guardians; names only through lift_passengers(), numbers only through lift_contacts(), both logged.';
COMMENT ON COLUMN lift_driver_declaration.reach_contact_id IS
  'The emergency contact, on her own child''s card, that is her: the number families on her lift ring on the day, read live by lift_contacts() (db/70). No number is stored here.';

-- ── The rows' own rules, as triggers ──
/**
 * An offer names a side of its fixture and carries the fixture as it stands.
 * Written only by the definers below; this is belt and braces against a
 * future door that forgets.
 */
CREATE OR REPLACE FUNCTION lift_offer_stamp() RETURNS trigger AS $$
DECLARE m match%ROWTYPE;
BEGIN
  SELECT * INTO m FROM match WHERE id = NEW.match_id;
  IF NOT FOUND THEN RETURN NEW; END IF;   -- the foreign key refuses it, in its own words
  IF NOT ((NEW.school_id = m.school_id AND NEW.team_code IS NOT DISTINCT FROM m.team_code)
          OR (NEW.school_id = m.away_school_id AND NEW.team_code IS NOT DISTINCT FROM m.away_team_code)) THEN
    RAISE EXCEPTION 'a lift is offered on a side of its fixture: % % is not one of its sides', NEW.school_id, NEW.team_code
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.fixture_starts_at := m.starts_at;
  NEW.fixture_ground_id := m.ground_id;
  NEW.version := 1;
  NEW.driver_version := 1;
  NEW.state := 'open';
  NEW.cancel_kind := NULL; NEW.cancelled_at := NULL; NEW.cancelled_by := NULL;
  NEW.departed_at := NULL; NEW.arrived_at := NULL; NEW.fixture_changed_at := NULL;
  NEW.created_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS lift_offer_stamp ON lift_offer;
CREATE TRIGGER lift_offer_stamp BEFORE INSERT ON lift_offer FOR EACH ROW EXECUTE FUNCTION lift_offer_stamp();

/** A seat carries its offer's school, fixture, side and leg, derived. */
CREATE OR REPLACE FUNCTION lift_seat_stamp() RETURNS trigger AS $$
DECLARE o lift_offer%ROWTYPE;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = NEW.offer_id;
  IF FOUND THEN
    NEW.school_id := o.school_id; NEW.match_id := o.match_id; NEW.team_code := o.team_code; NEW.leg := o.leg;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS lift_seat_stamp ON lift_seat;
CREATE TRIGGER lift_seat_stamp BEFORE INSERT ON lift_seat FOR EACH ROW EXECUTE FUNCTION lift_seat_stamp();

/**
 * What an offer or a seat IS never changes after it is made, and every mark
 * goes from null to a time once (§1.3, trip_mark()'s rule, db/41): a driver
 * reports; she does not re-time, reassign or edit what happened.
 */
CREATE OR REPLACE FUNCTION lift_row_fixed() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'lift_offer' THEN
    IF (NEW.school_id, NEW.match_id, NEW.team_code, NEW.leg, NEW.driver_id, NEW.declaration_id, NEW.created_at)
       IS DISTINCT FROM (OLD.school_id, OLD.match_id, OLD.team_code, OLD.leg, OLD.driver_id, OLD.declaration_id, OLD.created_at)
    OR (OLD.departed_at IS NOT NULL AND NEW.departed_at IS DISTINCT FROM OLD.departed_at)
    OR (OLD.arrived_at  IS NOT NULL AND NEW.arrived_at  IS DISTINCT FROM OLD.arrived_at)
    OR NEW.version < OLD.version
    OR (OLD.state IN ('cancelled', 'void', 'done') AND NEW.state IS DISTINCT FROM OLD.state) THEN
      RAISE EXCEPTION 'a lift is what it was offered as; its marks go forward once, and an ended lift stays ended'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (NEW.offer_id, NEW.school_id, NEW.match_id, NEW.team_code, NEW.leg, NEW.player_id, NEW.created_at)
       IS DISTINCT FROM (OLD.offer_id, OLD.school_id, OLD.match_id, OLD.team_code, OLD.leg, OLD.player_id, OLD.created_at)
    OR (OLD.boarded_at      IS NOT NULL AND NEW.boarded_at      IS DISTINCT FROM OLD.boarded_at)
    OR (OLD.handed_over_at  IS NOT NULL AND NEW.handed_over_at  IS DISTINCT FROM OLD.handed_over_at)
    OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at)
    OR (OLD.resolved_at     IS NOT NULL AND NEW.resolved_at     IS DISTINCT FROM OLD.resolved_at)
    OR (OLD.state IN ('declined', 'withdrawn', 'cancelled', 'void', 'done') AND NEW.state IS DISTINCT FROM OLD.state) THEN
      RAISE EXCEPTION 'a seat is one boy on one lift; its marks go forward once, and an ended seat stays ended'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
DROP TRIGGER IF EXISTS lift_offer_fixed ON lift_offer;
CREATE TRIGGER lift_offer_fixed BEFORE UPDATE ON lift_offer FOR EACH ROW EXECUTE FUNCTION lift_row_fixed();
DROP TRIGGER IF EXISTS lift_seat_fixed ON lift_seat;
CREATE TRIGGER lift_seat_fixed BEFORE UPDATE ON lift_seat FOR EACH ROW EXECUTE FUNCTION lift_row_fixed();

-- The application reads (under the policies below) and writes nothing: the
-- only doors are the functions. Two layers, as db/57: no write privilege, and
-- no write policy.
GRANT SELECT ON lift_policy, lift_driver_declaration, lift_offer, lift_seat, lift_purge_log TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON lift_policy, lift_driver_declaration, lift_offer, lift_seat, lift_purge_log
  FROM scrbrd_app;

/** The offers the caller drives, holding transport.lift.arrange on their side. Uncorrelated. */
CREATE OR REPLACE FUNCTION lift_my_offers() RETURNS SETOF uuid AS $$
  SELECT o.id FROM lift_offer o
   WHERE o.driver_id = app_user_id()
     AND app_can('transport.lift.arrange', o.school_id, o.team_code,
                 '00000000-0000-0000-0000-000000000000'::uuid, o.match_id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · Who reads: the permissive arms and the three cuts ──────────
DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lift_policy', 'lift_driver_declaration', 'lift_offer', 'lift_seat', 'lift_purge_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_no_support', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_not_platform', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_not_pupil', t);
    -- RESTRICTIVE: never under a support session at the school.
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (
        app_support_access_id(%I.school_id) IS NULL)$p$, t || '_no_support', t, t);
    -- RESTRICTIVE: never by anybody holding a platform-wide assignment.
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (
        NOT app_is_platform_wide())$p$, t || '_not_platform', t);
    -- RESTRICTIVE: never by a pupil (Kameel, 2026-10-01: pupils take no
    -- part in lift clubs), on every table, the school's text included.
    EXECUTE format($p$CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT USING (
        NOT lift_caller_is_pupil())$p$, t || '_not_pupil', t);
  END LOOP;
END $policies$;

-- The school's text: anyone with a live assignment at the school.
CREATE POLICY lift_policy_read ON lift_policy FOR SELECT USING (lift_at_school(lift_policy.school_id));

-- A declaration: the declarant, and the office.
CREATE POLICY lift_driver_declaration_read ON lift_driver_declaration FOR SELECT USING (
  lift_driver_declaration.person_id = app_user_id()
  OR app_can('transport.lift.oversee', lift_driver_declaration.school_id, '*'::text,
             '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- An offer: its driver, and a guardian with a child on its side.
CREATE POLICY lift_offer_read ON lift_offer FOR SELECT USING (
  lift_offer.id IN (SELECT lift_my_offers())
  OR (lift_offer.school_id, lift_offer.team_code) IN (SELECT s.school_id, s.team_code FROM lift_my_sides() s));

-- A seat: the driver of its offer, and the boy's own guardians.
CREATE POLICY lift_seat_read ON lift_seat FOR SELECT USING (
  lift_seat.offer_id IN (SELECT lift_my_offers())
  OR app_can('transport.lift.arrange', lift_seat.school_id, lift_seat.team_code, lift_seat.player_id, lift_seat.match_id));

-- The purge's counts: the office.
CREATE POLICY lift_purge_log_read ON lift_purge_log FOR SELECT USING (
  app_can('transport.lift.oversee', lift_purge_log.school_id, '*'::text,
          '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- A pad's resume credential reaches none of it (db/50).
SELECT pad_scope_guard_install('lift_policy'::regclass), pad_scope_guard_install('lift_driver_declaration'::regclass),
       pad_scope_guard_install('lift_offer'::regclass), pad_scope_guard_install('lift_seat'::regclass),
       pad_scope_guard_install('lift_purge_log'::regclass);


-- ── 5 · A seat's status, derived (§1.3) ────────────────────────────
/**
 * confirmed          state confirmed, both yeses on the offer's version, and
 *                    the consenting link still live;
 * awaiting_driver    the fixture moved under the offer and the driver has not
 *                    stood behind it again (every live seat waits on her: there
 *                    may be no lift to consent to);
 * awaiting_guardian  the driver's yes is current and the guardian's is not —
 *                    or the link that gave it has ended;
 * else the state word (requested, invited, declined, withdrawn, cancelled,
 * void, done).
 */
/**
 * The yes behind a seat still stands: the guardian's link live; or, for his
 * own say, the boy still eighteen and at school with his own self link live.
 */
CREATE OR REPLACE FUNCTION lift_seat_consent_live(s lift_seat) RETURNS boolean AS $$
  SELECT CASE s.consent_by WHEN 'self' THEN EXISTS (SELECT 1 FROM lift_self_accounts(s.player_id))
              ELSE lift_link_is_live(s.guardian_link_id) END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION lift_seat_status(s lift_seat) RETURNS text AS $$
  SELECT CASE
    WHEN s.state NOT IN ('requested', 'invited', 'confirmed') THEN s.state
    WHEN o.driver_version < o.version THEN 'awaiting_driver'
    WHEN s.state IN ('confirmed', 'invited') AND s.driver_ok_version IS DISTINCT FROM o.version THEN 'awaiting_driver'
    WHEN NOT lift_seat_consent_live(s) THEN 'awaiting_guardian'
    WHEN s.state IN ('confirmed', 'requested') AND s.guardian_ok_version IS DISTINCT FROM o.version THEN 'awaiting_guardian'
    ELSE s.state
  END
    FROM lift_offer o WHERE o.id = s.offer_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The screens' seat, with its status: the caller's own rows only (security
-- invoker), so it discloses nothing lift_seat does not.
CREATE OR REPLACE VIEW lift_seat_live WITH (security_invoker = true) AS
  SELECT s.id, s.offer_id, s.school_id, s.match_id, s.team_code, s.leg, s.player_id, s.requested_by, s.consent_by,
         s.guardian_ok_version, s.driver_ok_version, s.state, s.ended_at, s.created_at,
         lift_seat_status(s) AS status
    FROM lift_seat s;
GRANT SELECT ON lift_seat_live TO scrbrd_app;


-- ── 6 · The notices: to one adult, naming nobody (§5.2) ────────────
/** "v Kearsney, Sat 3 Oct 09:00 at Chapel Oval" — the fixture, never a person. */
CREATE OR REPLACE FUNCTION lift_fixture_words(p_match uuid) RETURNS text AS $$
  SELECT 'v ' || m.opponent || ', ' || availability_fixture_words(m.starts_at, m.ground_id, NULL, NULL)
    FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION lift_leg_words(p_leg text) RETURNS text AS $$
  SELECT CASE p_leg WHEN 'out' THEN 'to the fixture' ELSE 'home from the fixture' END
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;

/**
 * One notice to one adult about one lift. Never to a pupil: a lift notice is
 * an adult's (rule 4, SG-9) — the boy reads his own lift on his Home. Gated on
 * transport.lift.arrange at the side, with the boy as the person anchor when
 * it is about him, so only an adult who could read his seat reads it.
 */
CREATE OR REPLACE FUNCTION lift_notify(p_offer uuid, p_to uuid, p_about uuid, p_title text, p_body text)
RETURNS void AS $$
DECLARE o lift_offer%ROWTYPE;
BEGIN
  -- Never to a pupil — except the boy himself, eighteen and at school, about
  -- his own seat; then as the system's own notice (SG-9, db/57), readable
  -- through his side's transport.read with himself as the anchor.
  IF p_to IS NULL OR (lift_is_pupil(p_to) AND NOT lift_adult_self(p_to, p_about)) THEN RETURN; END IF;
  SELECT * INTO o FROM lift_offer WHERE id = p_offer;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind, subject_id, subject_person_id, recipient_id)
  VALUES (o.school_id, o.team_code, 'team',
          CASE WHEN lift_is_pupil(p_to) THEN 'system' ELSE 'lift' END, 'medium', p_title, p_body,
          CASE WHEN lift_is_pupil(p_to) THEN 'transport.read' ELSE 'transport.lift.arrange' END,
          false, 'match', o.match_id, p_about, p_to);
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The same notice to every live guardian of a boy, and to him while he is eighteen and at school. */
CREATE OR REPLACE FUNCTION lift_notify_family(p_offer uuid, p_player uuid, p_title text, p_body text)
RETURNS void AS $$
DECLARE r uuid;
BEGIN
  FOR r IN SELECT lift_guardians_of(p_player) UNION SELECT lift_self_accounts(p_player) LOOP
    PERFORM lift_notify(p_offer, r, p_player, p_title, p_body);
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** "The lift to the fixture v Kearsney, Sat 3 Oct 09:00 at Chapel Oval" */
CREATE OR REPLACE FUNCTION lift_offer_words(p_offer uuid) RETURNS text AS $$
  SELECT 'The lift ' || lift_leg_words(o.leg) || ' ' || lift_fixture_words(o.match_id)
    FROM lift_offer o WHERE o.id = p_offer
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * End an offer: cancelled (by its driver, the school, a link that ended, the
 * policy withdrawn) or void (the fixture abandoned). Its live seats follow,
 * and every guardian of a boy on it is told it is no longer available, never
 * why. Internal.
 */
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


-- ── 7 · The school's two keys (D17) ────────────────────────────────
/** Live at a school: the platform's grant AND a signed policy standing. */
CREATE OR REPLACE FUNCTION lift_module_live(p_school uuid) RETURNS boolean AS $$
  SELECT coalesce(feature_enabled('lift_club', p_school, app_user_id()), false)
     AND EXISTS (SELECT 1 FROM lift_policy p WHERE p.school_id = p_school AND p.withdrawn_at IS NULL)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The live policy at a school, or nothing. Internal. */
CREATE OR REPLACE FUNCTION lift_policy_live(p_school uuid) RETURNS lift_policy AS $$
  SELECT * FROM lift_policy p WHERE p.school_id = p_school AND p.withdrawn_at IS NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The principal signs the school's text: the live version withdrawn, the next
 * written. No offer is touched by a re-sign (drivers re-acknowledge at their
 * next declaration). Refused while the platform has not granted the module:
 * a policy for a module the school does not have would be a switch that does
 * nothing.
 */
CREATE OR REPLACE FUNCTION lift_policy_sign(p_school uuid, p_body text, p_requires_clearance boolean,
                                            p_allow_one_to_one boolean, p_meet_note text)
RETURNS TABLE (ok boolean, reason text, policy_id uuid, version integer) AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := app_user_id();
  v_next integer;
  v_id uuid;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::uuid, NULL::integer; RETURN; END IF;
  IF NOT lift_uncut(p_school)
     OR NOT app_can('transport.lift.policy', p_school, '*'::text,
                    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::integer; RETURN;
  END IF;
  IF NOT coalesce(feature_enabled('lift_club', p_school, v_me), false) THEN
    RETURN QUERY SELECT false, 'module_disabled', NULL::uuid, NULL::integer; RETURN;
  END IF;
  IF p_body IS NULL OR length(btrim(p_body)) < 200 THEN
    RETURN QUERY SELECT false, 'policy_too_short', NULL::uuid, NULL::integer; RETURN;
  END IF;
  IF length(btrim(p_body)) > 6000 THEN
    RETURN QUERY SELECT false, 'policy_too_long', NULL::uuid, NULL::integer; RETURN;
  END IF;
  p_meet_note := nullif(btrim(p_meet_note), '');
  IF p_meet_note IS NOT NULL AND length(p_meet_note) > 80 THEN
    RETURN QUERY SELECT false, 'meet_note_too_long', NULL::uuid, NULL::integer; RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('lift_policy:' || p_school::text));
  UPDATE lift_policy SET withdrawn_at = now(), withdrawn_by = v_me
   WHERE school_id = p_school AND withdrawn_at IS NULL;
  SELECT coalesce(max(p.version), 0) + 1 INTO v_next FROM lift_policy p WHERE p.school_id = p_school;
  INSERT INTO lift_policy (school_id, version, body, requires_clearance, allow_one_to_one, meet_note, signed_by)
  VALUES (p_school, v_next, btrim(p_body), coalesce(p_requires_clearance, false), coalesce(p_allow_one_to_one, true),
          p_meet_note, v_me)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, v_id, v_next;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The principal switches lift clubs off: the policy withdrawn, and every live
 * offer at the school cancelled 'policy_withdrawn' at once — its families and
 * its driver told the school has paused lift clubs. Never module-gated: a
 * school can always stop.
 */
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
  FOR o IN SELECT id FROM lift_offer WHERE school_id = p_school AND state IN ('open', 'closed') LOOP
    PERFORM lift_offer_end(o.id, 'cancelled', 'policy_withdrawn', v_me, true);
    n := n + 1;
  END LOOP;
  RETURN QUERY SELECT true, NULL::text, n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 8 · Who may drive (rule 2, D8, D4) ─────────────────────────────
/**
 * Why this person may not drive at this school today, as one word; NULL when
 * she may. In order: the two keys; a pupil takes no part (no live self link,
 * no pupil's account, at any age); a live guardian link to a child at the
 * school, its processing consent granted; a live, unexpired declaration;
 * and, when the school's policy
 * requires clearance, the three CSA checks each live for her at the school
 * by clearance_status() (db/56). MISSING REFUSES here, unlike
 * trip_driver_cleared(): the school chose the requirement. The DSO's bar is
 * phase 3 and slots in after the declaration. Internal.
 */
CREATE OR REPLACE FUNCTION lift_driver_standing(p_person uuid, p_school uuid) RETURNS text AS $$
DECLARE
  pol lift_policy%ROWTYPE;
  d   lift_driver_declaration%ROWTYPE;
  k   text;
BEGIN
  IF NOT coalesce(feature_enabled('lift_club', p_school, p_person), false) THEN RETURN 'module_off'; END IF;
  pol := lift_policy_live(p_school);
  IF pol.id IS NULL THEN RETURN 'no_policy'; END IF;
  IF lift_is_pupil(p_person) THEN RETURN 'pupil_excluded'; END IF;
  k := lift_family_at(p_person, p_school);
  IF k = 'none' THEN RETURN 'no_child_at_school'; END IF;
  IF k = 'pending' THEN RETURN 'consent_not_granted'; END IF;
  SELECT * INTO d FROM lift_driver_declaration
   WHERE person_id = p_person AND school_id = p_school AND withdrawn_at IS NULL;
  IF NOT FOUND THEN RETURN 'no_declaration'; END IF;
  IF d.expires_on <= sa_today() THEN RETURN 'declaration_expired'; END IF;
  IF pol.requires_clearance THEN
    FOREACH k IN ARRAY ARRAY['police_clearance', 'child_protection', 'sexual_offences_register'] LOOP
      IF coalesce((SELECT c.status FROM clearance_status(p_person, p_school, k) c), 'missing')
         NOT IN ('current', 'expiring') THEN
        RETURN 'clearance_required';
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION lift_driver_eligible(p_person uuid, p_school uuid) RETURNS boolean AS $$
  SELECT lift_driver_standing(p_person, p_school) IS NULL
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The standing's word in the school's words, for the parent's line. */
CREATE OR REPLACE FUNCTION lift_standing_words(p_word text, p_school uuid) RETURNS text AS $$
  SELECT CASE
    WHEN p_word IS NULL THEN NULL
    WHEN p_word = 'module_off' THEN 'Lift clubs are not switched on at ' || s.name || '.'
    WHEN p_word = 'no_policy' THEN s.name || ' has not published a lift policy, so lift clubs are paused.'
    WHEN p_word = 'pupil_excluded' THEN 'Lift clubs are arranged between parents. A pupil does not drive or offer lifts; '
                                        || 'a pupil of eighteen still at school may ask for a seat for himself on his own fixtures.'
    WHEN p_word = 'consent_not_granted' THEN 'The school has not recorded your consent to the processing of your child''s information, and lift clubs need it. Ask the school office to record it; then you may offer lifts and ask for seats.'
    WHEN p_word = 'no_child_at_school' THEN 'Only a parent or guardian with a child at ' || s.name || ' may offer lifts there.'
    WHEN p_word = 'no_declaration' THEN 'Before offering a lift, read the school''s lift policy and make your yearly driver''s declaration.'
    WHEN p_word = 'declaration_expired' THEN 'Your driver''s declaration has expired. Make a new one to offer lifts.'
    WHEN p_word = 'clearance_required' THEN s.name || '''s lift policy asks drivers for a current police clearance, Children''s Act register clearance and Sexual Offences Register clearance. The office has not recorded all three for you.'
    ELSE 'You may not offer lifts at present.' END
    FROM school s WHERE s.id = p_school
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * A parent makes her yearly declaration: the four facts, the school's text
 * read (its version recorded), the car, its passenger seats, and which of
 * her own child's emergency contacts is the number to ring her on. Her live
 * declaration, if any, is withdrawn first; her open offers stand.
 */
CREATE OR REPLACE FUNCTION lift_driver_declare(p_school uuid, p_vehicle_description text, p_registration text,
                                               p_seats integer, p_licence_held boolean, p_insured boolean,
                                               p_roadworthy boolean, p_belts boolean, p_code_acknowledged boolean,
                                               p_reach_contact uuid)
RETURNS TABLE (ok boolean, reason text, declaration_id uuid, expires_on date) AS $$
#variable_conflict use_column
DECLARE
  v_me  uuid := app_user_id();
  pol   lift_policy%ROWTYPE;
  v_reg text;
  v_id  uuid;
  v_exp date := (sa_today() + interval '1 year')::date;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::uuid, NULL::date; RETURN; END IF;
  IF lift_is_pupil(v_me) THEN RETURN QUERY SELECT false, 'pupil_excluded', NULL::uuid, NULL::date; RETURN; END IF;
  IF NOT lift_uncut(p_school) THEN RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::date; RETURN; END IF;
  IF NOT lift_module_live(p_school) THEN RETURN QUERY SELECT false, 'module_disabled', NULL::uuid, NULL::date; RETURN; END IF;
  IF NOT app_can('transport.lift.arrange', p_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     OR lift_family_at(v_me, p_school) = 'none' THEN
    RETURN QUERY SELECT false, 'no_child_at_school', NULL::uuid, NULL::date; RETURN;
  END IF;
  IF lift_family_at(v_me, p_school) <> 'granted' THEN
    RETURN QUERY SELECT false, 'consent_not_granted', NULL::uuid, NULL::date; RETURN;
  END IF;
  IF NOT (coalesce(p_licence_held, false) AND coalesce(p_insured, false) AND coalesce(p_roadworthy, false)
          AND coalesce(p_belts, false) AND coalesce(p_code_acknowledged, false)) THEN
    RETURN QUERY SELECT false, 'declaration_incomplete', NULL::uuid, NULL::date; RETURN;
  END IF;
  IF p_vehicle_description IS NULL OR length(btrim(p_vehicle_description)) NOT BETWEEN 3 AND 60 THEN
    RETURN QUERY SELECT false, 'vehicle_description', NULL::uuid, NULL::date; RETURN;
  END IF;
  -- "nd 123-456" is ND 123 456: upper case, a hyphen read as a space.
  v_reg := regexp_replace(upper(btrim(replace(coalesce(p_registration, ''), '-', ' '))), '\s+', ' ', 'g');
  IF v_reg !~ '^[A-Z0-9 ]{2,12}$' THEN
    RETURN QUERY SELECT false, 'registration', NULL::uuid, NULL::date; RETURN;
  END IF;
  IF p_seats IS NULL OR p_seats NOT BETWEEN 1 AND 7 THEN
    RETURN QUERY SELECT false, 'seats_out_of_range', NULL::uuid, NULL::date; RETURN;
  END IF;
  -- The number to ring her on: a live contact on the card of a child she is a
  -- live guardian of. Read live by lift_contacts(); never copied.
  IF p_reach_contact IS NULL OR NOT EXISTS (
       SELECT 1 FROM emergency_contact c
        WHERE c.id = p_reach_contact AND c.active
          AND EXISTS (SELECT 1 FROM lift_live_link(v_me, c.player_id, 'guardian'))) THEN
    RETURN QUERY SELECT false, 'contact_required', NULL::uuid, NULL::date; RETURN;
  END IF;
  pol := lift_policy_live(p_school);
  PERFORM pg_advisory_xact_lock(hashtext('lift_declaration:' || v_me::text || ':' || p_school::text));
  UPDATE lift_driver_declaration SET withdrawn_at = now()
   WHERE person_id = v_me AND school_id = p_school AND withdrawn_at IS NULL;
  INSERT INTO lift_driver_declaration (person_id, school_id, vehicle_description, registration, seats,
                                       licence_held, insured, roadworthy, belts, code_acknowledged,
                                       policy_version, reach_contact_id, expires_on)
  VALUES (v_me, p_school, btrim(p_vehicle_description), v_reg, p_seats, true, true, true, true, true,
          pol.version, p_reach_contact, v_exp)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, v_id, v_exp;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** She stops driving: the declaration withdrawn, her live offers cancelled 'driver'. Never module-gated. */
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
  FOR o IN SELECT id FROM lift_offer WHERE driver_id = v_me AND school_id = p_school AND state IN ('open', 'closed') LOOP
    PERFORM lift_offer_end(o.id, 'cancelled', 'driver', v_me);
    n := n + 1;
  END LOOP;
  RETURN QUERY SELECT true, NULL::text, n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Where the caller stands at a school: whether the module is live, whether she
 * may drive and, if not, why — the word and the school's words — and her
 * live declaration, if she has one. About the caller only.
 */
CREATE OR REPLACE FUNCTION my_lift_standing(p_school uuid)
RETURNS TABLE (module_live boolean, may_drive boolean, reason text, words text, policy_version integer,
               declaration_id uuid, vehicle_description text, registration text, seats smallint,
               expires_on date, declared_policy_version integer, reach_contact_id uuid) AS $$
#variable_conflict use_column
DECLARE
  v_me   uuid := app_user_id();
  v_word text;
  pol    lift_policy%ROWTYPE;
  d      lift_driver_declaration%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  IF lift_is_pupil(v_me) THEN
    RETURN QUERY SELECT false, false, 'pupil_excluded'::text, lift_standing_words('pupil_excluded', p_school),
                        NULL::integer, NULL::uuid, NULL::text, NULL::text, NULL::smallint, NULL::date, NULL::integer, NULL::uuid;
    RETURN;
  END IF;
  IF NOT lift_uncut(p_school) THEN RETURN; END IF;
  v_word := lift_driver_standing(v_me, p_school);
  pol := lift_policy_live(p_school);
  SELECT * INTO d FROM lift_driver_declaration
   WHERE person_id = v_me AND school_id = p_school AND withdrawn_at IS NULL;
  RETURN QUERY SELECT lift_module_live(p_school), v_word IS NULL, v_word, lift_standing_words(v_word, p_school),
                      pol.version, d.id, d.vehicle_description, d.registration, d.seats, d.expires_on,
                      d.policy_version, d.reach_contact_id;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 9 · Offers ─────────────────────────────────────────────────────
/** The meeting time against the fixture: out before it starts, back after; always ahead. */
CREATE OR REPLACE FUNCTION lift_meet_refusal(p_leg text, p_meet_at timestamptz, p_starts timestamptz) RETURNS text AS $$
  SELECT CASE
    WHEN p_meet_at IS NULL THEN 'meet_at_required'
    WHEN p_meet_at <= now() THEN 'meet_at_past'
    WHEN p_leg = 'out' AND p_meet_at >= p_starts THEN 'meet_after_start'
    WHEN p_leg = 'back' AND p_meet_at <= p_starts THEN 'meet_before_start'
  END
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

/**
 * A parent offers seats on one leg of her own son's fixture (D1, D2). She is
 * eligible (§8 above); a child of hers, by a live link, is in the side's team
 * at her school; the fixture is scheduled and not started; the seats are no
 * more than she declared; the meeting point is the school's or the ground.
 */
CREATE OR REPLACE FUNCTION lift_offer_create(p_match uuid, p_leg text, p_seats integer, p_meet_kind text,
                                             p_meet_at timestamptz, p_note text)
RETURNS TABLE (ok boolean, reason text, offer_id uuid) AS $$
#variable_conflict use_column
DECLARE
  v_me     uuid := app_user_id();
  m        match%ROWTYPE;
  v_school uuid;
  v_team   text;
  v_word   text;
  d        lift_driver_declaration%ROWTYPE;
  v_id     uuid;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::uuid; RETURN; END IF;
  IF lift_is_pupil(v_me) THEN RETURN QUERY SELECT false, 'pupil_excluded', NULL::uuid; RETURN; END IF;
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted', NULL::uuid; RETURN; END IF;
  -- Her side: the first side of the fixture on which she has a child.
  SELECT x.s, x.t INTO v_school, v_team
    FROM (VALUES (1, m.school_id, m.team_code), (2, m.away_school_id, m.away_team_code)) x(i, s, t)
   WHERE x.s IS NOT NULL AND x.t IS NOT NULL AND lift_has_child_on(v_me, x.s, x.t)
   ORDER BY x.i LIMIT 1;
  IF v_school IS NULL OR NOT lift_uncut(v_school)
     OR NOT app_can('transport.lift.arrange', v_school, v_team, '00000000-0000-0000-0000-000000000000'::uuid, p_match) THEN
    RETURN QUERY SELECT false,
      CASE WHEN v_school IS NOT NULL THEN 'not_permitted'
           -- A child on a side, by a link whose consent is not granted: say so.
           WHEN EXISTS (SELECT 1 FROM (VALUES (m.school_id, m.team_code), (m.away_school_id, m.away_team_code)) x(s, t)
                         WHERE x.s IS NOT NULL AND x.t IS NOT NULL AND lift_family_at(v_me, x.s, x.t) = 'pending')
             THEN 'consent_not_granted'
           ELSE 'no_child_on_side' END, NULL::uuid; RETURN;
  END IF;
  IF NOT lift_module_live(v_school) THEN RETURN QUERY SELECT false, 'module_disabled', NULL::uuid; RETURN; END IF;
  v_word := lift_driver_standing(v_me, v_school);
  IF v_word IS NOT NULL THEN RETURN QUERY SELECT false, v_word, NULL::uuid; RETURN; END IF;
  IF m.status <> 'scheduled' OR m.starts_at <= now() THEN
    RETURN QUERY SELECT false, 'fixture_not_ahead', NULL::uuid; RETURN;
  END IF;
  IF p_leg IS NULL OR p_leg NOT IN ('out', 'back') THEN RETURN QUERY SELECT false, 'leg', NULL::uuid; RETURN; END IF;
  IF p_meet_kind IS NULL OR p_meet_kind NOT IN ('school', 'ground') THEN
    RETURN QUERY SELECT false, 'meet_kind', NULL::uuid; RETURN;
  END IF;
  v_word := lift_meet_refusal(p_leg, p_meet_at, m.starts_at);
  IF v_word IS NOT NULL THEN RETURN QUERY SELECT false, v_word, NULL::uuid; RETURN; END IF;
  SELECT * INTO d FROM lift_driver_declaration WHERE person_id = v_me AND school_id = v_school AND withdrawn_at IS NULL;
  IF p_seats IS NULL OR p_seats < 1 THEN RETURN QUERY SELECT false, 'seats_out_of_range', NULL::uuid; RETURN; END IF;
  IF p_seats > d.seats THEN RETURN QUERY SELECT false, 'more_seats_than_declared', NULL::uuid; RETURN; END IF;
  p_note := nullif(btrim(p_note), '');
  IF p_note IS NOT NULL AND length(p_note) > 120 THEN RETURN QUERY SELECT false, 'note_too_long', NULL::uuid; RETURN; END IF;
  BEGIN
    INSERT INTO lift_offer (school_id, match_id, team_code, leg, driver_id, declaration_id, seats, meet_kind, meet_at, note,
                            fixture_starts_at)
    VALUES (v_school, p_match, v_team, p_leg, v_me, d.id, p_seats, p_meet_kind, p_meet_at, p_note, m.starts_at)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'already_offered', NULL::uuid; RETURN;
  END;
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The caller is this offer's driver, still holding the capability on its side. */
CREATE OR REPLACE FUNCTION lift_is_driver(o lift_offer) RETURNS boolean AS $$
  SELECT o.driver_id = app_user_id() AND lift_uncut(o.school_id)
     AND app_can('transport.lift.arrange', o.school_id, o.team_code, '00000000-0000-0000-0000-000000000000'::uuid, o.match_id)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Ask every family on a live seat to confirm again: the lift as it now
 * stands is not the one they said yes to.
 */
CREATE OR REPLACE FUNCTION lift_ask_families(p_offer uuid) RETURNS void AS $$
DECLARE s record; v_words text := lift_offer_words(p_offer);
BEGIN
  FOR s IN SELECT DISTINCT player_id FROM lift_seat
            WHERE offer_id = p_offer AND state IN ('requested', 'invited', 'confirmed') LOOP
    PERFORM lift_notify_family(p_offer, s.player_id, 'A lift has changed: please confirm again',
      v_words || ' has changed. Please look at it and confirm again; until you do, the seat is not confirmed.');
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The driver edits her offer (time, meeting point, seats, note), against the
 * version she read. The version moves; her yes moves with it on every seat
 * she had confirmed; every family on it is asked again. An edit after the
 * fixture moved is also her standing behind the fixture as it now is.
 */
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

/**
 * After the fixture moved (§1.5): the driver still offers the lift. Her yes
 * moves to the current version on every seat she had confirmed, and only now
 * is each family asked to confirm again. A meeting time the move has left on
 * the wrong side of the start is hers to edit, not the platform's to correct.
 */
CREATE OR REPLACE FUNCTION lift_offer_reaffirm(p_offer uuid, p_version integer)
RETURNS TABLE (ok boolean, reason text, version integer) AS $$
#variable_conflict use_column
DECLARE
  o      lift_offer%ROWTYPE;
  m      match%ROWTYPE;
  v_word text;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer FOR UPDATE;
  IF NOT FOUND OR NOT lift_is_driver(o) THEN RETURN QUERY SELECT false, 'not_permitted', NULL::integer; RETURN; END IF;
  IF o.state NOT IN ('open', 'closed') THEN RETURN QUERY SELECT false, 'offer_ended', NULL::integer; RETURN; END IF;
  IF p_version IS DISTINCT FROM o.version THEN RETURN QUERY SELECT false, 'version_conflict', o.version; RETURN; END IF;
  IF o.driver_version = o.version THEN RETURN QUERY SELECT false, 'nothing_to_reaffirm', o.version; RETURN; END IF;
  IF NOT lift_module_live(o.school_id) THEN RETURN QUERY SELECT false, 'module_disabled', NULL::integer; RETURN; END IF;
  SELECT * INTO m FROM match WHERE id = o.match_id;
  IF m.status <> 'scheduled' OR m.starts_at <= now() THEN
    RETURN QUERY SELECT false, 'fixture_not_ahead', NULL::integer; RETURN;
  END IF;
  v_word := lift_meet_refusal(o.leg, o.meet_at, m.starts_at);
  IF v_word IS NOT NULL THEN RETURN QUERY SELECT false, v_word, NULL::integer; RETURN; END IF;
  UPDATE lift_offer SET driver_version = o.version, fixture_starts_at = m.starts_at, fixture_ground_id = m.ground_id
   WHERE id = p_offer;
  UPDATE lift_seat SET driver_ok_version = o.version
   WHERE offer_id = p_offer AND state IN ('confirmed', 'invited') AND driver_ok_version IS NOT NULL;
  PERFORM lift_ask_families(p_offer);
  RETURN QUERY SELECT true, NULL::text, o.version;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The driver takes no more requests; the seats she has stand. */
CREATE OR REPLACE FUNCTION lift_offer_close(p_offer uuid) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE o lift_offer%ROWTYPE;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer FOR UPDATE;
  IF NOT FOUND OR NOT lift_is_driver(o) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF o.state <> 'open' THEN RETURN QUERY SELECT false, 'offer_not_open'; RETURN; END IF;
  UPDATE lift_offer SET state = 'closed' WHERE id = p_offer;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * Cancel a lift: its driver ('driver'), or the school's office through
 * transport.lift.oversee ('school'). Every family on it is told it is no
 * longer available, never why. Never module-gated: stopping is always open.
 */
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
  PERFORM lift_offer_end(p_offer, 'cancelled', v_kind, app_user_id(), v_kind = 'school');
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * How the caller may act for a boy on a lift: 'guardian' (a live link,
 * consent granted, the boy under eighteen); 'guardian_adult' (the same, the
 * boy eighteen and still at school — db/62's link past eighteen: she may ask
 * and withdraw, Kameel's follow-up); 'consent_pending' (a live verified link
 * whose consent is not granted: nothing); for a pupil, only ever about his
 * own row: 'self' (eighteen and at school), 'self_minor', 'self_away'; or
 * NULL. With the link that gives it. Internal.
 */
CREATE OR REPLACE FUNCTION lift_acting_for(p_player uuid, OUT how text, OUT assignment_id uuid, OUT link_id uuid) AS $$
DECLARE
  v_me   uuid := app_user_id();
  v_born date;
  v_adult boolean;
BEGIN
  SELECT p.born INTO v_born FROM player p WHERE p.id = p_player;
  v_adult := v_born IS NOT NULL AND majority_on(v_born) <= sa_today();
  -- A pupil acts only as himself, on his own seat (Kameel's follow-up): 'self'
  -- when he is eighteen and at school, 'self_minor' under eighteen,
  -- 'self_away' when he has left school; never as anybody's guardian.
  IF lift_is_pupil(v_me) THEN
    IF EXISTS (SELECT 1 FROM lift_live_link(v_me, p_player, 'selfaccess')) THEN
      how := CASE WHEN NOT v_adult THEN 'self_minor' WHEN NOT still_at_school(p_player) THEN 'self_away' ELSE 'self' END;
    END IF;
    RETURN;
  END IF;
  SELECT l.assignment_id, l.link_id INTO assignment_id, link_id FROM lift_live_link(v_me, p_player, 'guardian') l;
  IF link_id IS NOT NULL THEN
    how := CASE WHEN v_adult THEN 'guardian_adult' ELSE 'guardian' END;
    RETURN;
  END IF;
  -- A live verified link to him whose consent is not granted: a word for the
  -- screen, never an act.
  IF EXISTS (SELECT 1 FROM role_assignment a JOIN assignment_subject g ON g.assignment_id = a.id
              WHERE a.person_id = v_me AND a.role = 'guardian' AND g.player_id = p_player
                AND g.relationship IS DISTINCT FROM 'self' AND g.verification_state = 'verified' AND a.active
                AND g.valid_from <= current_date AND (g.valid_until IS NULL OR g.valid_until > current_date)) THEN
    how := 'consent_pending';
  END IF;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The open offers on a fixture, as a family reads them: for each side where
 * the caller has a child (by a live link, consent granted) and the module is
 * live — for a pupil, only himself, eighteen and at school, on his own side,
 * with no driver's name until his seat is confirmed — the driver's NAME, the leg, the meeting point in the school's words,
 * the time, the seats and how many are left, the note, and the caller's own
 * children's seats on it — never the other passengers (D6). The caller's own
 * offers are always there, whatever the side. Nothing for anybody else.
 */
CREATE OR REPLACE FUNCTION lift_offers_for(p_match uuid)
RETURNS TABLE (offer_id uuid, school_id uuid, team_code text, leg text, driver_name text, is_mine boolean,
               meet_kind text, meet_place text, meet_at timestamptz, seats smallint, confirmed integer,
               seats_left integer, note text, state text, version integer, awaiting_driver boolean,
               fixture_starts_at timestamptz, my_seats jsonb, my_children jsonb) AS $$
#variable_conflict use_column
DECLARE
  v_me uuid := app_user_id();
  v_pupil boolean := lift_is_pupil(app_user_id());
  m    match%ROWTYPE;
  sd   record;
  kids jsonb;
BEGIN
  IF v_me IS NULL THEN RETURN; END IF;
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND THEN RETURN; END IF;
  FOR sd IN SELECT x.s AS school_id, x.t AS team_code
              FROM (VALUES (1, m.school_id, m.team_code), (2, m.away_school_id, m.away_team_code)) x(i, s, t)
             WHERE x.s IS NOT NULL AND x.t IS NOT NULL
             ORDER BY x.i LOOP
    IF v_pupil THEN
      -- The boy himself, eighteen and at school, on his own side only.
      SELECT coalesce(jsonb_agg(jsonb_build_object('playerId', p.id, 'name', p.full_name, 'how', 'self')), '[]')
        INTO kids
        FROM player p
       WHERE p.school_id = sd.school_id AND p.team_code = sd.team_code AND lift_adult_self(v_me, p.id);
      CONTINUE WHEN jsonb_array_length(kids) = 0
                 OR EXISTS (SELECT 1 FROM jsonb_array_elements(kids) k
                             WHERE NOT lift_uncut_for(sd.school_id, (k->>'playerId')::uuid));
    ELSE
      CONTINUE WHEN NOT lift_uncut(sd.school_id);
      -- The caller's own boys on this side, and how she may act for each.
      SELECT coalesce(jsonb_agg(jsonb_build_object('playerId', p.id, 'name', p.full_name, 'how', a.how) ORDER BY p.full_name), '[]')
        INTO kids
        FROM player p CROSS JOIN LATERAL lift_acting_for(p.id) a
       WHERE p.school_id = sd.school_id AND p.team_code = sd.team_code AND a.how IN ('guardian', 'guardian_adult')
         AND (a.how <> 'guardian' OR app_can('transport.lift.arrange', sd.school_id, sd.team_code, p.id, p_match));
    END IF;
    CONTINUE WHEN (jsonb_array_length(kids) = 0 OR NOT lift_module_live(sd.school_id))
              AND NOT EXISTS (SELECT 1 FROM lift_offer o WHERE o.match_id = p_match AND o.school_id = sd.school_id
                                 AND o.driver_id = v_me);
    RETURN QUERY
      SELECT o.id, o.school_id, o.team_code, o.leg,
             -- The boy himself reads the driver's name once his own seat on it is confirmed.
             CASE WHEN v_pupil AND NOT EXISTS (
                    SELECT 1 FROM lift_seat s WHERE s.offer_id = o.id AND lift_seat_status(s) = 'confirmed'
                       AND s.player_id IN (SELECT (k->>'playerId')::uuid FROM jsonb_array_elements(kids) k))
                  THEN NULL ELSE u.name END,
             o.driver_id = v_me,
             o.meet_kind,
             CASE o.meet_kind WHEN 'ground' THEN 'At the ground'
                  ELSE coalesce('At school: ' || (lift_policy_live(o.school_id)).meet_note, 'At school') END,
             o.meet_at, o.seats, c.n, greatest(o.seats - c.n, 0), o.note, o.state, o.version,
             o.driver_version < o.version, m.starts_at,
             (SELECT coalesce(jsonb_agg(jsonb_build_object('seatId', s.id, 'playerId', s.player_id,
                                                           'status', lift_seat_status(s)) ORDER BY s.created_at), '[]')
                FROM lift_seat s
               WHERE s.offer_id = o.id AND s.player_id IN (SELECT (k->>'playerId')::uuid FROM jsonb_array_elements(kids) k)
                 AND s.state IN ('requested', 'invited', 'confirmed', 'declined')),
             kids
        FROM lift_offer o
        JOIN app_user u ON u.id = o.driver_id
        CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM lift_seat s WHERE s.offer_id = o.id AND s.state = 'confirmed') c
       WHERE o.match_id = p_match AND o.school_id = sd.school_id AND o.team_code = sd.team_code
         AND (o.state IN ('open', 'closed') AND (jsonb_array_length(kids) > 0 AND lift_module_live(sd.school_id))
              OR (o.driver_id = v_me AND o.state IN ('open', 'closed')))
       ORDER BY o.leg DESC, o.meet_at, o.created_at;
  END LOOP;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 10 · Seats ─────────────────────────────────────────────────────
/**
 * The lone passenger (D5, Kameel 2026-10-01). When a seat leaves a lift — a
 * withdrawal, or a seat voided because the link that consented ended — and
 * the school's policy refuses one boy alone with a driver who is not his
 * parent, a lift left with exactly one confirmed child (an adult pupil does
 * not count, either way) is not confirmed any more: his seat falls back to requested, the driver's yes taken off it, so
 * it is confirmed again only by an acceptance that leaves two (or by a
 * policy that allows one). His family and the driver are each told, naming
 * nobody. Nobody is reassigned (D18). A policy that allows one-to-one leaves
 * the seat confirmed. Internal.
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
  -- Children only: an adult passenger is not a lone child, and does not keep one company.
  SELECT count(*) INTO n FROM lift_seat ls WHERE ls.offer_id = p_offer AND ls.state = 'confirmed' AND lift_is_minor(ls.player_id);
  IF n <> 1 THEN RETURN false; END IF;
  SELECT * INTO s FROM lift_seat ls WHERE ls.offer_id = p_offer AND ls.state = 'confirmed' AND lift_is_minor(ls.player_id) FOR UPDATE;
  UPDATE lift_seat SET state = 'requested', driver_ok_version = NULL WHERE id = s.id;
  v_words := lift_offer_words(p_offer);
  PERFORM lift_notify_family(p_offer, s.player_id, 'A seat on a lift is no longer confirmed',
    v_words || ' now has one boy on it, which the school''s lift policy does not allow. His seat is not confirmed '
      || 'unless the driver takes another boy with him. Please make other arrangements, or wait to hear.');
  PERFORM lift_notify(p_offer, o.driver_id, NULL, 'One boy is left on your lift',
    v_words || ' now has one boy on it, which the school''s lift policy does not allow. His seat is no longer '
      || 'confirmed: accept another boy with him, or cancel the lift.');
  RETURN true;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * A seat for one boy: asked by his live verified guardian, her consent to
 * processing granted — past his eighteenth birthday too while db/62 keeps her
 * link open at school — or by the boy himself when he is eighteen and still at
 * school, through his own self link (Kameel's follow-up, 2026-10-01). Never by
 * any other pupil, and never by a pupil for anybody else — not for a brother
 * through a guardian link. He is in the
 * offer's side; the offer is open, its driver behind it, its fixture ahead;
 * he is on no other live lift for that leg (lift_seat_one_live); he is not
 * the driver's own (she counts him present). The driver is told a seat was
 * asked for, with no name.
 */
CREATE OR REPLACE FUNCTION lift_seat_request(p_offer uuid, p_player uuid)
RETURNS TABLE (ok boolean, reason text, seat_id uuid, other_offer uuid) AS $$
#variable_conflict use_column
DECLARE
  v_me  uuid := app_user_id();
  o     lift_offer%ROWTYPE;
  m     match%ROWTYPE;
  a     record;
  v_id  uuid;
  v_other uuid;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in', NULL::uuid, NULL::uuid; RETURN; END IF;
  SELECT * INTO a FROM lift_acting_for(p_player);
  -- A pupil: only the boy himself, eighteen and at school, for his own seat.
  IF lift_is_pupil(v_me) THEN
    IF a.how = 'self_minor' THEN RETURN QUERY SELECT false, 'not_yet_eighteen', NULL::uuid, NULL::uuid; RETURN; END IF;
    IF a.how = 'self_away' THEN RETURN QUERY SELECT false, 'not_at_school', NULL::uuid, NULL::uuid; RETURN; END IF;
    IF a.how IS DISTINCT FROM 'self' THEN RETURN QUERY SELECT false, 'pupil_excluded', NULL::uuid, NULL::uuid; RETURN; END IF;
  END IF;
  SELECT * INTO o FROM lift_offer WHERE id = p_offer;
  IF NOT FOUND OR NOT lift_uncut_for(o.school_id, p_player) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF a.how IS NULL OR a.how IN ('self_minor', 'self_away') THEN RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::uuid; RETURN; END IF;
  IF a.how = 'consent_pending' THEN RETURN QUERY SELECT false, 'consent_not_granted', NULL::uuid, NULL::uuid; RETURN; END IF;
  IF a.how IN ('guardian', 'guardian_adult') AND NOT app_can('transport.lift.arrange', o.school_id, o.team_code, p_player, o.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM player p WHERE p.id = p_player AND p.school_id = o.school_id AND p.team_code = o.team_code) THEN
    RETURN QUERY SELECT false, 'not_on_side', NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF NOT lift_module_live(o.school_id) THEN RETURN QUERY SELECT false, 'module_disabled', NULL::uuid, NULL::uuid; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM lift_live_link(o.driver_id, p_player, 'guardian')) THEN
    RETURN QUERY SELECT false, 'driver_own_child', NULL::uuid, NULL::uuid; RETURN;
  END IF;
  IF o.state <> 'open' THEN RETURN QUERY SELECT false, 'offer_not_open', NULL::uuid, NULL::uuid; RETURN; END IF;
  IF o.driver_version < o.version THEN RETURN QUERY SELECT false, 'awaiting_driver', NULL::uuid, NULL::uuid; RETURN; END IF;
  SELECT * INTO m FROM match WHERE id = o.match_id;
  IF m.status <> 'scheduled' OR m.starts_at <= now() THEN
    RETURN QUERY SELECT false, 'fixture_not_ahead', NULL::uuid, NULL::uuid; RETURN;
  END IF;
  SELECT s.offer_id INTO v_other FROM lift_seat s
   WHERE s.match_id = o.match_id AND s.player_id = p_player AND s.leg = o.leg
     AND s.state IN ('requested', 'invited', 'confirmed');
  IF v_other IS NOT NULL THEN RETURN QUERY SELECT false, 'already_on_a_lift', NULL::uuid, v_other; RETURN; END IF;
  BEGIN
    INSERT INTO lift_seat (offer_id, school_id, match_id, team_code, leg, player_id, consent_by,
                           guardian_assignment_id, guardian_link_id, requested_by, guardian_ok_version, state)
    VALUES (p_offer, o.school_id, o.match_id, o.team_code, o.leg, p_player,
            CASE WHEN a.how = 'self' THEN 'self' ELSE 'guardian' END,
            a.assignment_id, a.link_id, v_me, o.version, 'requested')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT false, 'already_on_a_lift', NULL::uuid, NULL::uuid; RETURN;
  END;
  PERFORM lift_notify(p_offer, o.driver_id, NULL, 'A seat has been asked for',
    'A family has asked for a seat on your lift ' || lift_leg_words(o.leg) || ' ' || lift_fixture_words(o.match_id)
      || '. Open the fixture to answer.');
  RETURN QUERY SELECT true, NULL::text, v_id, NULL::uuid;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The driver accepts one or more requests on her offer, together. Each must
 * still carry its family's yes on the current version, through a link still
 * live; the confirmed seats may not pass the offer's seats (seats_full); and
 * where the school's policy refuses a lone passenger (D5), the acceptance may
 * not leave exactly one confirmed — which is why several are taken at once.
 * Each family is told its seat is confirmed. FOR UPDATE on the offer, so two
 * acceptances cannot both take the last seat.
 */
CREATE OR REPLACE FUNCTION lift_seat_accept(p_seats uuid[]) RETURNS TABLE (ok boolean, reason text, confirmed integer) AS $$
#variable_conflict use_column
DECLARE
  v_offer uuid;
  o       lift_offer%ROWTYPE;
  pol     lift_policy%ROWTYPE;
  s       lift_seat%ROWTYPE;
  v_have  integer;
  v_add   integer;
  v_one   boolean;
  v_minors integer;
  v_new_minors integer;
  v_words text;
BEGIN
  IF p_seats IS NULL OR cardinality(p_seats) = 0 THEN RETURN QUERY SELECT false, 'no_seats', 0; RETURN; END IF;
  -- Every seat named, all on one offer, none twice.
  SELECT min(ls.offer_id::text)::uuid,
         count(DISTINCT ls.offer_id) = 1 AND count(*) = cardinality(p_seats)
           AND cardinality(p_seats) = (SELECT count(DISTINCT x) FROM unnest(p_seats) x)
    INTO v_offer, v_one FROM lift_seat ls WHERE ls.id = ANY (p_seats);
  IF v_offer IS NULL OR NOT coalesce(v_one, false) THEN RETURN QUERY SELECT false, 'not_permitted', 0; RETURN; END IF;
  SELECT * INTO o FROM lift_offer WHERE id = v_offer FOR UPDATE;
  IF NOT lift_is_driver(o) THEN RETURN QUERY SELECT false, 'not_permitted', 0; RETURN; END IF;
  IF o.state NOT IN ('open', 'closed') THEN RETURN QUERY SELECT false, 'offer_ended', 0; RETURN; END IF;
  IF NOT lift_module_live(o.school_id) THEN RETURN QUERY SELECT false, 'module_disabled', 0; RETURN; END IF;
  IF o.driver_version < o.version THEN RETURN QUERY SELECT false, 'awaiting_driver', 0; RETURN; END IF;
  FOR s IN SELECT * FROM lift_seat WHERE id = ANY (p_seats) FOR UPDATE LOOP
    IF s.state <> 'requested' THEN RETURN QUERY SELECT false, 'not_a_request', 0; RETURN; END IF;
    IF s.guardian_ok_version IS DISTINCT FROM o.version
       OR NOT lift_seat_consent_live(s) THEN
      RETURN QUERY SELECT false, 'awaiting_guardian', 0; RETURN;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_have FROM lift_seat WHERE offer_id = o.id AND state = 'confirmed';
  v_add := cardinality(p_seats);
  -- D5 counts CHILDREN (Kameel's follow-up: CSA's one-adult-one-unrelated-
  -- child rule is about children). An adult passenger is never a lone child,
  -- and his presence does not make a lone child less alone.
  SELECT count(*) INTO v_minors FROM lift_seat ls WHERE ls.offer_id = o.id AND ls.state = 'confirmed' AND lift_is_minor(ls.player_id);
  SELECT count(*) INTO v_new_minors FROM lift_seat ls WHERE ls.id = ANY (p_seats) AND lift_is_minor(ls.player_id);
  IF v_have + v_add > o.seats THEN RETURN QUERY SELECT false, 'seats_full', v_have; RETURN; END IF;
  pol := lift_policy_live(o.school_id);
  IF NOT coalesce(pol.allow_one_to_one, true) AND v_new_minors > 0 AND v_minors + v_new_minors = 1 THEN
    RETURN QUERY SELECT false, 'one_to_one_not_allowed', v_have; RETURN;
  END IF;
  UPDATE lift_seat SET state = 'confirmed', driver_ok_version = o.version WHERE id = ANY (p_seats);
  v_words := lift_offer_words(o.id);
  FOR s IN SELECT * FROM lift_seat WHERE id = ANY (p_seats) LOOP
    PERFORM lift_notify_family(o.id, s.player_id, 'A seat on a lift is confirmed',
      v_words || ': the seat you asked for is confirmed. The driver''s number is on the fixture on the day.');
  END LOOP;
  RETURN QUERY SELECT true, NULL::text, v_have + v_add;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/** The driver declines a request. No reason is asked or stored; the family is told. */
CREATE OR REPLACE FUNCTION lift_seat_decline(p_seat uuid) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE s lift_seat%ROWTYPE; o lift_offer%ROWTYPE;
BEGIN
  SELECT * INTO s FROM lift_seat WHERE id = p_seat FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  SELECT * INTO o FROM lift_offer WHERE id = s.offer_id;
  IF NOT lift_is_driver(o) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF s.state <> 'requested' THEN RETURN QUERY SELECT false, 'not_a_request'; RETURN; END IF;
  UPDATE lift_seat SET state = 'declined', ended_at = now(), ended_by = app_user_id() WHERE id = p_seat;
  PERFORM lift_notify_family(o.id, s.player_id, 'A seat request was not accepted',
    lift_offer_words(o.id) || ': the seat you asked for was not accepted. You may ask on another lift.');
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * A "no": any live verified guardian of the boy — of a boy of eighteen still
 * at school too — or the boy himself while he is eighteen and at school, any
 * time before he is in the car (D13: a withdrawal by
 * either guardian ends the seat). If it leaves one boy alone with a driver
 * not his parent under a policy refusing that, his seat falls back
 * (lift_lone_fallback()). Never
 * module-gated and never refused for want of the capability: a family's "no"
 * is theirs to give. The driver is told a seat was withdrawn, never why.
 */
CREATE OR REPLACE FUNCTION lift_seat_withdraw(p_seat uuid) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE s lift_seat%ROWTYPE; a record;
BEGIN
  SELECT * INTO s FROM lift_seat WHERE id = p_seat FOR UPDATE;
  IF NOT FOUND OR NOT lift_uncut_for(s.school_id, s.player_id) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  SELECT * INTO a FROM lift_acting_for(s.player_id);
  IF a.how IS NULL OR a.how NOT IN ('guardian', 'guardian_adult', 'self') THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF s.state NOT IN ('requested', 'invited', 'confirmed') THEN RETURN QUERY SELECT false, 'seat_ended'; RETURN; END IF;
  IF s.boarded_at IS NOT NULL THEN RETURN QUERY SELECT false, 'already_boarded'; RETURN; END IF;
  UPDATE lift_seat SET state = 'withdrawn', ended_at = now(), ended_by = app_user_id() WHERE id = p_seat;
  PERFORM lift_notify(s.offer_id, (SELECT o.driver_id FROM lift_offer o WHERE o.id = s.offer_id), NULL,
    'A seat was withdrawn', lift_offer_words(s.offer_id) || ': a family has withdrawn a seat.');
  PERFORM lift_lone_fallback(s.offer_id);
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The family says yes again to the lift as it now stands: after an edit, or
 * after the driver stood behind a moved fixture. The consenting link becomes
 * the caller's (the later act stands, D13). Not while the offer still waits
 * on its driver: there may be no lift to say yes to.
 */
CREATE OR REPLACE FUNCTION lift_seat_reconfirm(p_seat uuid) RETURNS TABLE (ok boolean, reason text) AS $$
#variable_conflict use_column
DECLARE s lift_seat%ROWTYPE; o lift_offer%ROWTYPE; a record;
BEGIN
  SELECT * INTO s FROM lift_seat WHERE id = p_seat FOR UPDATE;
  IF NOT FOUND OR NOT lift_uncut_for(s.school_id, s.player_id) THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  SELECT * INTO a FROM lift_acting_for(s.player_id);
  IF a.how IS NULL OR a.how IN ('self_minor', 'self_away') THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  IF a.how = 'consent_pending' THEN RETURN QUERY SELECT false, 'consent_not_granted'; RETURN; END IF;
  IF a.how IN ('guardian', 'guardian_adult') AND NOT app_can('transport.lift.arrange', s.school_id, s.team_code, s.player_id, s.match_id) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  SELECT * INTO o FROM lift_offer WHERE id = s.offer_id;
  IF NOT lift_module_live(o.school_id) THEN RETURN QUERY SELECT false, 'module_disabled'; RETURN; END IF;
  IF s.state NOT IN ('requested', 'confirmed') OR o.state NOT IN ('open', 'closed') THEN
    RETURN QUERY SELECT false, 'seat_ended'; RETURN;
  END IF;
  IF o.driver_version < o.version THEN RETURN QUERY SELECT false, 'awaiting_driver'; RETURN; END IF;
  UPDATE lift_seat SET guardian_ok_version = o.version,
                       consent_by = CASE WHEN a.how = 'self' THEN 'self' ELSE 'guardian' END,
                       guardian_assignment_id = a.assignment_id, guardian_link_id = a.link_id
   WHERE id = p_seat;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 11 · Names, numbers and counts: the logged doors ───────────────
/**
 * The boys on a lift, by full name and nothing else (D6, §5.1):
 *   the driver          every live seat on her offer, with its status — a
 *                       request is a name: she must know whom she accepts;
 *   a guardian          whose own boy's seat on it is confirmed: the
 *                       confirmed seats;
 *   the side's staff    transport.lift.receive on the side, the out leg: the
 *                       confirmed seats (§1.6);
 *   anybody else        nothing, and nothing logged.
 * Every answer is on access_log as ('lift_passengers', [offer], '{name}').
 */
CREATE OR REPLACE FUNCTION lift_passengers(p_offer uuid)
RETURNS TABLE (seat_id uuid, player_id uuid, full_name text, status text) AS $$
#variable_conflict use_column
DECLARE
  o     lift_offer%ROWTYPE;
  v_me  uuid := app_user_id();
  v_all boolean := false;
  v_ok  boolean := false;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer;
  IF NOT FOUND OR v_me IS NULL OR NOT lift_uncut(o.school_id) OR lift_is_pupil(v_me) THEN RETURN; END IF;
  IF lift_is_driver(o) THEN
    v_all := true; v_ok := true;
  ELSIF EXISTS (SELECT 1 FROM lift_seat s
                 WHERE s.offer_id = o.id AND lift_seat_status(s) = 'confirmed'
                   AND EXISTS (SELECT 1 FROM lift_live_link(v_me, s.player_id, 'guardian'))) THEN
    v_ok := true;
  ELSIF o.leg = 'out' AND app_can('transport.lift.receive', o.school_id, o.team_code,
                                  '00000000-0000-0000-0000-000000000000'::uuid, o.match_id) THEN
    v_ok := true;
  END IF;
  IF NOT v_ok THEN RETURN; END IF;
  PERFORM log_restricted_read('lift_passengers', ARRAY[o.id], '{name}'::text[], o.school_id);
  RETURN QUERY
    SELECT s.id, s.player_id, p.full_name, lift_seat_status(s)
      FROM lift_seat s JOIN player p ON p.id = s.player_id
     WHERE s.offer_id = o.id
       AND (CASE WHEN v_all THEN s.state IN ('requested', 'invited', 'confirmed')
                 ELSE lift_seat_status(s) = 'confirmed' END)
     ORDER BY p.full_name;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The numbers, on the day only: from the day before the meeting to the day
 * after (db/41's window, on the Johannesburg calendar), and only for
 * confirmed seats.
 *   to the driver   each confirmed boy: his name, the consenting guardian's
 *                   name, and his active emergency contacts (where his
 *                   guardian's number is);
 *   to a guardian   whose boy's seat on it is confirmed: the driver's name,
 *                   the number she named on her declaration, the car and
 *                   its registration.
 * Never to a pupil (rule 4). Outside the window, or for anybody else: NULL,
 * and nothing logged. Every answer is on access_log as
 * ('lift_contacts', [offer], '{phone,emergency}').
 */
CREATE OR REPLACE FUNCTION lift_contacts(p_offer uuid) RETURNS jsonb AS $$
DECLARE
  o      lift_offer%ROWTYPE;
  d      lift_driver_declaration%ROWTYPE;
  v_me   uuid := app_user_id();
  v_day  date;
  v_out  jsonb;
BEGIN
  SELECT * INTO o FROM lift_offer WHERE id = p_offer;
  IF NOT FOUND OR v_me IS NULL OR NOT lift_cuts_ok(o.school_id) THEN RETURN NULL; END IF;
  -- A pupil reads only the driver of his own confirmed seat, eighteen and at school.
  IF lift_is_pupil(v_me) AND NOT EXISTS (SELECT 1 FROM lift_seat s WHERE s.offer_id = o.id
                                            AND lift_seat_status(s) = 'confirmed' AND lift_adult_self(v_me, s.player_id)) THEN
    RETURN NULL;
  END IF;
  IF o.state NOT IN ('open', 'closed', 'done') THEN RETURN NULL; END IF;
  v_day := (o.meet_at AT TIME ZONE 'Africa/Johannesburg')::date;
  IF sa_today() NOT BETWEEN v_day - 1 AND v_day + 1 THEN RETURN NULL; END IF;

  IF lift_is_driver(o) THEN
    SELECT jsonb_build_object('as', 'driver', 'passengers', coalesce(jsonb_agg(jsonb_build_object(
             'playerId', p.id, 'name', p.full_name,
             'guardian', (SELECT u.name FROM role_assignment ra JOIN app_user u ON u.id = ra.person_id
                           WHERE ra.id = s.guardian_assignment_id),
             'contacts', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'relationship', c.relationship,
                                                                       'phone', c.phone, 'phoneAlt', c.phone_alt)
                                                    ORDER BY c.priority), '[]')
                            FROM emergency_contact c WHERE c.player_id = p.id AND c.active))
             ORDER BY p.full_name), '[]'))
      INTO v_out
      FROM lift_seat s JOIN player p ON p.id = s.player_id
     WHERE s.offer_id = o.id AND lift_seat_status(s) = 'confirmed';
  ELSIF EXISTS (SELECT 1 FROM lift_seat s
                 WHERE s.offer_id = o.id AND lift_seat_status(s) = 'confirmed'
                   AND (EXISTS (SELECT 1 FROM lift_live_link(v_me, s.player_id, 'guardian'))
                        OR lift_adult_self(v_me, s.player_id))) THEN
    -- Her live declaration if she has made a new one since, else the offer's.
    SELECT * INTO d FROM lift_driver_declaration
     WHERE person_id = o.driver_id AND school_id = o.school_id AND withdrawn_at IS NULL;
    IF NOT FOUND THEN SELECT * INTO d FROM lift_driver_declaration WHERE id = o.declaration_id; END IF;
    SELECT jsonb_build_object('as', 'guardian', 'driver', jsonb_build_object(
             'name', u.name, 'vehicle', d.vehicle_description, 'registration', d.registration,
             'phone', c.phone, 'phoneAlt', c.phone_alt))
      INTO v_out
      FROM app_user u
      LEFT JOIN emergency_contact c ON c.id = d.reach_contact_id AND c.active
     WHERE u.id = o.driver_id;
  ELSE
    RETURN NULL;
  END IF;
  PERFORM log_restricted_read('lift_contacts', ARRAY[o.id], '{phone,emergency}'::text[], o.school_id);
  RETURN v_out;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The office's counts on a fixture (D10), per side it oversees and per leg:
 * offers, seats offered, seats confirmed, boys still requested, seats waiting
 * on a yes. No name (phase 2 adds the exceptions, by name). Nothing to
 * anybody without transport.lift.oversee at the side's school.
 */
CREATE OR REPLACE FUNCTION lift_summary(p_match uuid)
RETURNS TABLE (school_id uuid, leg text, offers integer, seats_offered integer, confirmed integer,
               requested integer, awaiting integer) AS $$
#variable_conflict use_column
DECLARE m match%ROWTYPE; sd record;
BEGIN
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND OR app_user_id() IS NULL THEN RETURN; END IF;
  FOR sd IN SELECT x.s AS school_id, x.t AS team_code
              FROM (VALUES (1, m.school_id, m.team_code), (2, m.away_school_id, m.away_team_code)) x(i, s, t)
             WHERE x.s IS NOT NULL AND x.t IS NOT NULL ORDER BY x.i LOOP
    CONTINUE WHEN NOT lift_uncut(sd.school_id)
               OR NOT app_can('transport.lift.oversee', sd.school_id, sd.team_code,
                              '00000000-0000-0000-0000-000000000000'::uuid, p_match);
    RETURN QUERY
      SELECT sd.school_id, l.leg,
             (SELECT count(*)::int FROM lift_offer o WHERE o.match_id = p_match AND o.school_id = sd.school_id
                 AND o.leg = l.leg AND o.state IN ('open', 'closed')),
             (SELECT coalesce(sum(o.seats), 0)::int FROM lift_offer o WHERE o.match_id = p_match AND o.school_id = sd.school_id
                 AND o.leg = l.leg AND o.state IN ('open', 'closed')),
             (SELECT count(*)::int FROM lift_seat s WHERE s.match_id = p_match AND s.school_id = sd.school_id
                 AND s.leg = l.leg AND lift_seat_status(s) = 'confirmed'),
             (SELECT count(*)::int FROM lift_seat s WHERE s.match_id = p_match AND s.school_id = sd.school_id
                 AND s.leg = l.leg AND lift_seat_status(s) = 'requested'),
             (SELECT count(*)::int FROM lift_seat s WHERE s.match_id = p_match AND s.school_id = sd.school_id
                 AND s.leg = l.leg AND lift_seat_status(s) IN ('awaiting_driver', 'awaiting_guardian'))
        FROM (VALUES ('out'), ('back')) l(leg);
  END LOOP;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 12 · When the fixture moves or is called off (§1.5) ────────────
/**
 * Beside SCRBRD-122's availability_ask_again() (db/65) on the same table, on
 * its own events. A lift depends on two of the four facts db/65 watches: the
 * start and the ground. Format and overs alone do not touch a lift.
 *   start or ground changed, the fixture still scheduled: every live offer on
 *     it goes up a version, stamped fixture_changed_at, and waits on its
 *     driver — one notice to her; no family is asked yet, because there may
 *     be no lift to consent to;
 *   abandoned (the fixture called off): every live offer void ('fixture'),
 *     every live seat void, one notice to the driver and one to each
 *     guardian of a boy on it; none to a pupil.
 */
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
              WHERE match_id = NEW.id AND state IN ('open', 'closed')
             RETURNING id, driver_id, leg LOOP
      PERFORM lift_notify(o.id, o.driver_id, NULL, 'A fixture has moved: do you still offer the lift?',
        'The fixture ' || lift_fixture_words(NEW.id) || ' has moved. Do you still offer your lift '
          || lift_leg_words(o.leg) || '? Confirm it, or cancel it; until you confirm, no seat on it is confirmed.');
    END LOOP;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS lift_fixture_moved ON match;
CREATE TRIGGER lift_fixture_moved AFTER UPDATE OF starts_at, ground_id, status ON match
  FOR EACH ROW
  WHEN ((OLD.starts_at, OLD.ground_id, OLD.status) IS DISTINCT FROM (NEW.starts_at, NEW.ground_id, NEW.status))
  EXECUTE FUNCTION lift_fixture_moved();


-- ── 13 · When a link ends (§6.4, §6.5) ─────────────────────────────
/**
 * Settle one person's lifts against her links as the transaction leaves them:
 *   an offer she drives on a side where she no longer has a child by a live
 *     link is cancelled 'link_ended' — her link ended, her guardian
 *     assignment ended, or her child left the team;
 *   a live seat that a link of hers consented to, where that link is no
 *     longer live (ended, revoked, its consent withdrawn), is void, and the
 *     driver told a seat was withdrawn.
 * Internal: the triggers below call it.
 */
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
              AND NOT lift_link_is_live(ls.guardian_link_id) LOOP
    UPDATE lift_seat SET state = 'void', ended_at = now() WHERE id = s.id;
    PERFORM lift_notify(s.offer_id, (SELECT x.driver_id FROM lift_offer x WHERE x.id = s.offer_id), NULL,
      'A seat was withdrawn', lift_offer_words(s.offer_id) || ': a seat is no longer confirmed and has been withdrawn.');
    PERFORM lift_lone_fallback(s.offer_id);
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * The boy's own say, settled the same way (Kameel's follow-up): a live seat
 * he asked for himself, once he is no longer eighteen-and-at-school through a
 * live self link of his own — he left school, or his self link ended — is
 * void, and the driver told a seat was withdrawn. Internal.
 */
CREATE OR REPLACE FUNCTION lift_self_settle(p_player uuid) RETURNS void AS $$
DECLARE s record;
BEGIN
  IF p_player IS NULL OR EXISTS (SELECT 1 FROM lift_self_accounts(p_player)) THEN RETURN; END IF;
  FOR s IN SELECT ls.id, ls.offer_id FROM lift_seat ls
            WHERE ls.player_id = p_player AND ls.consent_by = 'self'
              AND ls.state IN ('requested', 'invited', 'confirmed') LOOP
    UPDATE lift_seat SET state = 'void', ended_at = now() WHERE id = s.id;
    PERFORM lift_notify(s.offer_id, (SELECT x.driver_id FROM lift_offer x WHERE x.id = s.offer_id), NULL,
      'A seat was withdrawn', lift_offer_words(s.offer_id) || ': a seat is no longer confirmed and has been withdrawn.');
    PERFORM lift_lone_fallback(s.offer_id);
  END LOOP;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION lift_link_changed() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'assignment_subject' THEN
    PERFORM lift_links_settle((SELECT a.person_id FROM role_assignment a WHERE a.id = NEW.assignment_id));
    IF NEW.relationship = 'self' THEN PERFORM lift_self_settle(NEW.player_id); END IF;
  ELSIF TG_TABLE_NAME = 'role_assignment' THEN
    PERFORM lift_links_settle(NEW.person_id);
    PERFORM lift_self_settle(g.player_id) FROM assignment_subject g
     WHERE g.assignment_id = NEW.id AND g.relationship = 'self' AND NEW.role = 'selfaccess';
  ELSIF TG_TABLE_NAME = 'team_membership' THEN
    PERFORM lift_links_settle(a.person_id)
       FROM (SELECT DISTINCT ra.person_id FROM assignment_subject g JOIN role_assignment ra ON ra.id = g.assignment_id
              WHERE g.player_id = NEW.player_id AND ra.role = 'guardian') a;
    PERFORM lift_self_settle(NEW.player_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Deferred, as db/62's are: a move between sides is two statements, and a
-- link re-opened in the same transaction must be judged as it is left.
DROP TRIGGER IF EXISTS lift_link_changed ON assignment_subject;
CREATE CONSTRAINT TRIGGER lift_link_changed
  AFTER UPDATE OF valid_until, valid_from, verification_state, consent_state ON assignment_subject
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION lift_link_changed();
DROP TRIGGER IF EXISTS lift_guardian_changed ON role_assignment;
CREATE CONSTRAINT TRIGGER lift_guardian_changed
  AFTER UPDATE OF active, valid_from, valid_until, expires_at ON role_assignment
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.role IN ('guardian', 'selfaccess'))
  EXECUTE FUNCTION lift_link_changed();
DROP TRIGGER IF EXISTS lift_team_changed ON team_membership;
CREATE CONSTRAINT TRIGGER lift_team_changed
  AFTER INSERT OR UPDATE OF left_on, team_code ON team_membership
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION lift_link_changed();


-- ── 14 · Grants ────────────────────────────────────────────────────
DO $grants$
DECLARE f text; r text;
  app text[] := ARRAY[
    'lift_uncut(uuid)', 'lift_caller_is_pupil()', 'lift_my_sides()', 'lift_my_offers()', 'lift_at_school(uuid)',
    'lift_seat_status(lift_seat)', 'lift_module_live(uuid)',
    'lift_policy_sign(uuid,text,boolean,boolean,text)', 'lift_policy_withdraw(uuid)',
    'lift_driver_declare(uuid,text,text,integer,boolean,boolean,boolean,boolean,boolean,uuid)',
    'lift_driver_declaration_withdraw(uuid)', 'my_lift_standing(uuid)',
    'lift_offer_create(uuid,text,integer,text,timestamp with time zone,text)',
    'lift_offer_update(uuid,integer,text,timestamp with time zone,text,integer)',
    'lift_offer_reaffirm(uuid,integer)', 'lift_offer_close(uuid)', 'lift_offer_cancel(uuid)',
    'lift_offers_for(uuid)', 'lift_seat_request(uuid,uuid)', 'lift_seat_accept(uuid[])',
    'lift_seat_decline(uuid)', 'lift_seat_withdraw(uuid)', 'lift_seat_reconfirm(uuid)',
    'lift_passengers(uuid)', 'lift_contacts(uuid)', 'lift_summary(uuid)'];
  internal text[] := ARRAY[
    'lift_is_pupil(uuid)', 'lift_live_link(uuid,uuid,text)', 'lift_link_is_live(uuid)', 'lift_guardians_of(uuid)',
    'lift_has_child_on(uuid,uuid,text)', 'lift_offer_stamp()', 'lift_seat_stamp()',
    'lift_row_fixed()', 'lift_fixture_words(uuid)', 'lift_leg_words(text)',
    'lift_notify(uuid,uuid,uuid,text,text)', 'lift_notify_family(uuid,uuid,text,text)', 'lift_offer_words(uuid)',
    'lift_offer_end(uuid,text,text,uuid,boolean)', 'lift_policy_live(uuid)', 'lift_driver_standing(uuid,uuid)',
    'lift_driver_eligible(uuid,uuid)', 'lift_standing_words(text,uuid)', 'lift_meet_refusal(text,timestamp with time zone,timestamp with time zone)',
    'lift_is_driver(lift_offer)', 'lift_ask_families(uuid)', 'lift_acting_for(uuid)',
    'lift_family_at(uuid,uuid,text)', 'lift_lone_fallback(uuid)',
    'lift_cuts_ok(uuid)', 'lift_is_minor(uuid)', 'lift_adult_at_school(uuid)', 'lift_adult_self(uuid,uuid)',
    'lift_uncut_for(uuid,uuid)', 'lift_self_accounts(uuid)', 'lift_seat_consent_live(lift_seat)',
    'lift_fixture_moved()', 'lift_links_settle(uuid)', 'lift_self_settle(uuid)', 'lift_link_changed()'];
BEGIN
  FOREACH f IN ARRAY app LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
  END LOOP;
  FOREACH f IN ARRAY internal LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
  -- A managed host's API roles (Supabase grants new functions and tables to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY app || internal LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON lift_policy, lift_driver_declaration, lift_offer, lift_seat, lift_purge_log, lift_seat_live FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 15 · Refuse to commit a file that did not do what it says ──────
DO $check$
DECLARE
  t   text;
  f   text;
  n   integer;
  v_list text;
BEGIN
  -- (1) The four capabilities, held by exactly the roles named.
  SELECT string_agg(role || ':' || capability, ' ' ORDER BY capability, role) INTO v_list
    FROM role_capability WHERE capability LIKE 'transport.lift.%';
  IF v_list IS DISTINCT FROM
     'guardian:transport.lift.arrange superadmin:transport.lift.arrange '
     || 'schooladmin:transport.lift.oversee sportsadmin:transport.lift.oversee superadmin:transport.lift.oversee transportcoordinator:transport.lift.oversee '
     || 'principal:transport.lift.policy superadmin:transport.lift.policy '
     || 'assistantcoach:transport.lift.receive coach:transport.lift.receive superadmin:transport.lift.receive teammanager:transport.lift.receive' THEN
    RAISE EXCEPTION 'db/70: transport.lift.* is held as [%]', v_list;
  END IF;

  -- (2) The module arrives off, and no school holds it.
  IF (SELECT row(kind, enabled, locked)::text FROM feature_flag WHERE key = 'lift_club') IS DISTINCT FROM '(module,f,f)'
     OR EXISTS (SELECT 1 FROM feature_grant WHERE key = 'lift_club' AND granted) THEN
    RAISE EXCEPTION 'db/70: the lift_club module is not off for every school';
  END IF;

  -- (3) The tables: row security on, the cuts, SELECT only, the pad guard.
  FOREACH t IN ARRAY ARRAY['lift_policy', 'lift_driver_declaration', 'lift_offer', 'lift_seat', 'lift_purge_log'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'db/70: % is not under row-level security', t;
    END IF;
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = t
       AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
       AND policyname IN (t || '_no_support', t || '_not_platform', t || '_not_pupil');
    IF n <> 3 THEN
      RAISE EXCEPTION 'db/70: % carries % of its RESTRICTIVE cuts', t, n;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                  AND permissive = 'PERMISSIVE' AND cmd <> 'SELECT') THEN
      RAISE EXCEPTION 'db/70: % has a write policy', t;
    END IF;
    IF has_table_privilege('scrbrd_app', t, 'INSERT') OR has_table_privilege('scrbrd_app', t, 'UPDATE')
       OR has_table_privilege('scrbrd_app', t, 'DELETE') OR has_table_privilege('scrbrd_app', t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'db/70: the application may write %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                      AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'db/70: % has no RESTRICTIVE pad_scope_select (db/50)', t;
    END IF;
  END LOOP;

  -- (4) No lift row holds a number, an address, a name or an e-mail (§1.2, §5.2).
  SELECT string_agg(table_name || '.' || column_name, ' ') INTO v_list
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name LIKE 'lift\_%'
     AND column_name ~ '(phone|address|name|email|id_number|mobile|location|latitude|longitude)';
  IF v_list IS NOT NULL THEN RAISE EXCEPTION 'db/70: a lift row carries [%]', v_list; END IF;

  -- (5) The triggers, beside db/65's on match.
  SELECT count(*) INTO n FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
    ('lift_offer_stamp', 'lift_seat_stamp', 'lift_offer_fixed', 'lift_seat_fixed', 'lift_fixture_moved',
     'lift_link_changed', 'lift_guardian_changed', 'lift_team_changed', 'availability_ask_again');
  IF n <> 9 THEN RAISE EXCEPTION 'db/70: % of the nine triggers (eight here, db/65''s one) are in place', n; END IF;

  -- (6) Definers pinned; the application's doors its own; nothing for PUBLIC.
  FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public' AND (p.proname LIKE 'lift\_%' OR p.proname = 'my_lift_standing') LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/70: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/70: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['lift_live_link(uuid,uuid,text)', 'lift_offer_end(uuid,text,text,uuid,boolean)',
                           'lift_notify(uuid,uuid,uuid,text,text)', 'lift_links_settle(uuid)',
                           'lift_driver_standing(uuid,uuid)', 'lift_acting_for(uuid)',
                           'lift_family_at(uuid,uuid,text)', 'lift_lone_fallback(uuid)'] LOOP
    IF has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/70: % is internal and the application may call it', f;
    END IF;
  END LOOP;
END $check$;
