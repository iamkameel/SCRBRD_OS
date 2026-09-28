-- ══════════════════════════════════════════════════════════════════
--  60 · Workload, phase 1: consent and the count (SCRBRD-110)
-- ══════════════════════════════════════════════════════════════════
--
-- docs/design/SCRBRD-110_workload.md, §9's phase 1 row, as decided (§10,
-- Q1–Q19). Two things, and nothing about a body:
--
--   THE COUNT. Every delivery a bowler bowls, nets included. Match deliveries
--   keep coming from the ball log (bowler_over, db/08 and db/54), exact and
--   never typed again. Nets and training are recorded as an ESTIMATE — a band
--   of deliveries (under 12 / 12-24 / 24-36 / 36+) with an effort — because
--   "we're not trying to be 100% accurate on how many balls are bowled in the
--   nets" (Kameel, Q1). A game scored on paper elsewhere carries the
--   scorebook's exact count. One figure per session: the bowler's own band
--   when he entered one, the coach's otherwise, and nobody's figure is set
--   against anybody else's. The windows, the ratio and the word are derived
--   when asked for; nothing counted is stored.
--
--   THE CONSENT. Health monitoring's own consent, separate from the terms
--   (the guardian link's) and from the public name (db/47): optional, off by
--   default, given by a competent person, withdrawable, recorded and never
--   deleted. Nothing in this file collects under it — the nets band is
--   ordinary processing, like attendance (Q5) — but every health table from
--   phase 2 on calls health_consent_live(), so the record comes first.
--
-- WHAT THIS FILE MAKES
--
--   1. player.workload.write (the nets band), and wellness.read and
--      fitness.test.write so that the `fitness` role (the strength-and-
--      conditioning coach, Q3 and Q13) is whole when it is appointed. The two
--      gate nothing until phases 2 and 4 bring their tables. `fitness` is
--      appointed by the director of sport.
--   2. The module switch: feature `workload_monitoring`, OFF until the
--      platform grants it to a school. Its reads are `load` and `load_weeks`;
--      the write is refused here as well as in the API.
--   3. still_at_school() — phase 0's function, carried here because phase 0
--      (the guardian link past eighteen) waits on the information officer and
--      this phase must stand without it (§9, Q18).
--   4. health_monitoring_consent, health_monitoring_consent_set(),
--      health_consent_live(), health_retention_due(), my_health_consents().
--   5. load_unit ('delivery', cricket), load_band_units(), load_entry and its
--      stamp, load_day, load_ratio_word(), load_word(), load_summary(),
--      load_weeks().
--   6. workload() re-emitted with units_7d, units_28d, estimated_7d,
--      ewma_ratio, load_word and monitored at the end of its row. Its old
--      columns, their meaning and its order are unchanged.
--   7. The generated policies for load_unit and load_entry (tables.mjs,
--      TABLES_ADDED_SINCE_09), between the markers below.
--
-- EIGHTEEN, BEFORE PHASE 0. A guardian's health consent counts only while
-- the link it was given through is live — so, until phase 0 lands, it ends on
-- his eighteenth birthday with her access, which is today's behaviour and the
-- officer's fallback (§7.4). When phase 0 keeps an enrolled pupil's link open
-- past the birthday, the same function carries her consent on while he is at
-- school, with no change here: the rule in health_consent_live() is §7.2's,
-- plus "through a link that is live today". Her "yes" on or after the
-- birthday is refused either way (adult_consents_for_himself).
--
-- WHERE THIS DIFFERS FROM THE DESIGN'S LETTER, and why
--
--   - The numbers: the design says db/53; the Laws and safeguarding work took
--     52-59, so this is db/60.
--   - load_unit's read is written as the named exception (anyone signed in)
--     on a platform capability. The design wrote a boolean where tables.mjs
--     takes a capability name.
--   - load_entry takes no UPDATE from the application at all (REVOKE): the
--     design says "never updated", and a correction is a new row naming the
--     one it replaces (supersedes), which the stamp holds to the same boy,
--     day, session and voice.
--   - The EWMA is the closed form of the recursion the design describes
--     (seeded at zero 90 days back): today's average is the sum of each day's
--     load times λ(1-λ)^days-ago. The same number, one pass, no recursion.
--   - "Latest record governs" follows db/47's reading, ordered by the act:
--     each giver's most recent record, and of those the one whose last act
--     (given, or ended) is latest — so one guardian's "no" after another's
--     "yes" is not outvoted by it.
--   - A guardian's "yes" also needs the terms agreed on her link
--     (consent_state = 'granted'), as scouting_consent_set() does: the
--     narrower consent never outruns the broader one.
--   - A support session reads no consent record and records none from a form
--     (a RESTRICTIVE cut, and a refusal in the office's path): consent to
--     health monitoring is N2, and §6.5 keeps support out of the health tables.
--   - health_retention_due() counts "he left the school system" as his last
--     school membership closing, and is per boy, not per school; Q19's
--     per-school clock is the purge's design (phase 6), which deletes nothing
--     before the officer signs it off.
--   - health_consent_live() is not granted to the application in this phase:
--     nothing here gates on it through a policy. The screens read it through
--     my_health_consents() and workload()'s `monitored`. Phase 2's RESTRICTIVE
--     policies will need it granted (or wrapped) when they are written.
--
-- search_path is pinned on every function below (db/16). Every function the
-- application calls is granted to scrbrd_app only and taken back from PUBLIC
-- and from a managed host's API roles. Safe to run twice.


-- ── 1 · The capabilities, the role and who appoints it ─────────────
-- Capabilities the model gained after db/01 shipped (ADDED_SINCE_01) and a
-- role it gained after (ROLES_ADDED_SINCE_01): the catalogue rows, the grants
-- and the appointers are all here, as db/27, db/47 and db/57 did.
INSERT INTO capability (name) VALUES ('player.workload.write') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('wellness.read') ON CONFLICT (name) DO NOTHING;
INSERT INTO capability (name) VALUES ('fitness.test.write') ON CONFLICT (name) DO NOTHING;

INSERT INTO role_capability (role, capability) VALUES
  -- The nets band: the coach and assistant for his side, the physio, the
  -- fitness coach, and the boy for himself (§6.1).
  ('coach',           'player.workload.write'),
  ('assistantcoach',  'player.workload.write'),
  ('medical',         'player.workload.write'),
  ('selfaccess',      'player.workload.write'),
  ('superadmin',      'player.workload.write'),
  -- His own words about his body (phase 2) and a capacity test (phase 4).
  ('coach',           'wellness.read'),
  ('assistantcoach',  'wellness.read'),
  ('medical',         'wellness.read'),
  ('directorofsport', 'wellness.read'),
  ('selfaccess',      'wellness.read'),
  ('superadmin',      'wellness.read'),
  ('medical',         'fitness.test.write'),
  ('superadmin',      'fitness.test.write'),
  -- The strength-and-conditioning coach: READ_TEAM, the load, the check-ins,
  -- the tests, and an injury at the coach's tier. Never medical.details.read,
  -- never player.note.read.
  ('fitness', 'team.read'),
  ('fitness', 'fixture.read'),
  ('fitness', 'player.profile.read'),
  ('fitness', 'news.read'),
  ('fitness', 'facility.read'),
  ('fitness', 'competition.read'),
  ('fitness', 'player.age.read'),
  ('fitness', 'player.biometric.read'),
  ('fitness', 'player.workload.read'),
  ('fitness', 'player.workload.write'),
  ('fitness', 'wellness.read'),
  ('fitness', 'fitness.test.write'),
  ('fitness', 'medical.status.read'),
  ('fitness', 'medical.nature.read')
ON CONFLICT DO NOTHING;

INSERT INTO role_grantable (granter, role) VALUES
  ('directorofsport', 'fitness'),
  ('platformadmin',   'fitness'),
  ('superadmin',      'fitness')
ON CONFLICT DO NOTHING;


-- ── 2 · The module switch ──────────────────────────────────────────
-- A FEATURE, and features arrive off (db/08: "a FEATURE that arrives switched
-- on has not been decided about"). The platform grants it per school.
INSERT INTO feature_flag (key, kind, label, enabled, reason) VALUES
  ('workload_monitoring', 'feature', 'Workload monitoring', false,
   'SCRBRD-110: the nets band and each bowler''s load, and later his check-ins. '
   'Collects something new about children, so it is granted per school, never assumed.')
ON CONFLICT (key) DO NOTHING;


-- ── 3 · Still at school (phase 0's function, carried here) ─────────
/**
 * Is he in the school system today: an open team membership at a tenant
 * whose kind is 'school'? A club, an academy or a union is not "the school
 * system" (§7.4, and SCRBRD-083 §6.3's test). Phase 0 re-emits this same
 * function when it lands; nothing here depends on it beyond
 * health_consent_live() and health_retention_due(). Internal: owner only.
 */
CREATE OR REPLACE FUNCTION still_at_school(p_player uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_membership m
      JOIN school s ON s.id = m.school_id
     WHERE m.player_id = p_player AND m.left_on IS NULL AND s.kind = 'school')
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION still_at_school(uuid) FROM PUBLIC;


-- ── 4 · The health-monitoring consent (§7.2) ───────────────────────
-- db/47's public_name_consent, column for column, so the Settings screen, the
-- office's admission-form path and "the latest record governs" are one
-- pattern. given_by is 'self' rather than 'pupil': an adult club athlete is
-- not a pupil.
CREATE TABLE IF NOT EXISTS health_monitoring_consent (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq         bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  given_by    text NOT NULL CHECK (given_by IN ('guardian', 'self')),
  -- The verified link through which the giver answers for this child: a
  -- guardian's link, or the athlete's own 'self' link. Through player_id as
  -- well, so a record cannot name one child's guardian against another.
  giver_assignment_id uuid NOT NULL,
  giver_link_id       uuid NOT NULL,
  -- The wording agreed to (or refused).
  version     text NOT NULL CHECK (btrim(version) <> ''),
  -- sa_today() when recorded, never passed in: a consent is not backdated.
  given_on    date NOT NULL,
  ended_on    date,
  --   withdrawn   the giver stopped a consent he had given
  --   superseded  he agreed to a newer version
  --   refused     he said no with nothing open: begins and ends the same day
  end_reason  text CHECK (end_reason IN ('withdrawn', 'superseded', 'refused')),
  -- The office recording from the school's own form: both or neither.
  form_name   text CHECK (form_name IS NULL OR btrim(form_name) <> ''),
  form_date   date,
  recorded_by uuid NOT NULL REFERENCES app_user(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  ended_by    uuid REFERENCES app_user(id),
  ended_at    timestamptz,
  FOREIGN KEY (giver_assignment_id, player_id, giver_link_id)
    REFERENCES assignment_subject (assignment_id, player_id, id) ON DELETE CASCADE,
  CONSTRAINT health_monitoring_consent_dates CHECK (ended_on IS NULL OR ended_on >= given_on),
  CONSTRAINT health_monitoring_consent_end_is_whole
    CHECK ((ended_on IS NULL) = (end_reason IS NULL) AND (ended_on IS NULL) = (ended_by IS NULL)
           AND (ended_on IS NULL) = (ended_at IS NULL)),
  CONSTRAINT health_monitoring_consent_form_is_whole
    CHECK ((form_name IS NULL) = (form_date IS NULL) AND (form_date IS NULL OR form_date <= given_on))
);
CREATE INDEX IF NOT EXISTS health_monitoring_consent_player ON health_monitoring_consent (player_id);
CREATE UNIQUE INDEX IF NOT EXISTS health_monitoring_consent_one_open
  ON health_monitoring_consent (player_id, giver_link_id) WHERE ended_on IS NULL;

ALTER TABLE health_monitoring_consent ENABLE ROW LEVEL SECURITY;
-- No INSERT, UPDATE or DELETE policy, and no privilege either: the only door
-- is health_monitoring_consent_set(). Two layers, as db/47 does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON health_monitoring_consent FROM scrbrd_app;

-- Read: the office that records them from its forms (guardian.link.manage at
-- the child's school, db/08's link test), and a giver his own records. Not a
-- coach, not the physio, not another guardian: a consent record names who a
-- child's guardian is. What a family and the boy see is my_health_consents().
DROP POLICY IF EXISTS health_monitoring_consent_read ON health_monitoring_consent;
CREATE POLICY health_monitoring_consent_read ON health_monitoring_consent
  FOR SELECT USING (
    app_can('guardian.link.manage', player_school(health_monitoring_consent.player_id), '*'::text,
            '00000000-0000-0000-0000-000000000000'::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid)
    OR public_name_giver_is_me(health_monitoring_consent.giver_assignment_id));

-- And never under a support session at that school, whatever role it
-- borrowed: consent to health monitoring is a health fact (N2), and no
-- support ticket needs to read which family agreed to it (§6.5).
DROP POLICY IF EXISTS health_monitoring_consent_not_support ON health_monitoring_consent;
CREATE POLICY health_monitoring_consent_not_support ON health_monitoring_consent
  AS RESTRICTIVE FOR SELECT
  USING (app_support_access_id(player_school(health_monitoring_consent.player_id)) IS NULL);

/**
 * Is this giver's link live today, in the terms app_can() uses: the
 * assignment active, begun, not ended, not expired, not suspended; the link
 * verified, begun, not ended — and, for a guardian, the terms agreed on it.
 * A guardian's consent counts only through a link that is live, so it ends
 * with her access: on his eighteenth birthday today, and (once phase 0
 * lands) on the day he leaves school after it. Internal.
 */
CREATE OR REPLACE FUNCTION health_giver_link_live(p_link uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignment_subject g
      JOIN role_assignment a ON a.id = g.assignment_id
     WHERE g.id = p_link
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       AND g.verification_state = 'verified'
       AND g.valid_from <= current_date
       AND (g.valid_until IS NULL OR g.valid_until > current_date)
       AND (g.relationship = 'self' OR g.consent_state = 'granted'))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION health_giver_link_live(uuid) FROM PUBLIC;

/**
 * The record that governs a player's health consent: none, or one.
 *
 * Each giver's most recent record; of those, his own once he has made any
 * record at all ("once he has spoken, only his records count", §7.2), else
 * the guardians'; and of those, the one whose last act — given, or ended — is
 * latest, a tie going to the one that ended. So a guardian's "no" after
 * another guardian's "yes" governs, and a "yes" given after it governs in
 * turn: db/47's "the latest record governs", with a withdrawal counted as the
 * act it is. Internal.
 */
CREATE OR REPLACE FUNCTION health_consent_governing(p_player uuid)
RETURNS SETOF health_monitoring_consent AS $$
  WITH last_per_giver AS (
    SELECT DISTINCT ON (c.giver_link_id) c.*
      FROM health_monitoring_consent c
     WHERE c.player_id = p_player
     ORDER BY c.giver_link_id, c.seq DESC)
  SELECT l.* FROM last_per_giver l
   WHERE l.given_by = CASE WHEN EXISTS (SELECT 1 FROM health_monitoring_consent s
                                         WHERE s.player_id = p_player AND s.given_by = 'self')
                           THEN 'self' ELSE 'guardian' END
   ORDER BY coalesce(l.ended_at, l.recorded_at) DESC, (l.ended_on IS NOT NULL) DESC, l.seq DESC
   LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION health_consent_governing(uuid) FROM PUBLIC;

/**
 * THE ONE FUNCTION EVERY HEALTH GATE CALLS (§7.2, §7.3).
 *
 * Live when the governing record is open (a "yes") and competent:
 *   his own ('self') — given from his eighteenth birthday, his date of birth
 *     known (a self record cannot be made otherwise);
 *   a guardian's — given while he was a child, through a link that is live
 *     today, and either he is still a child or he is still at school.
 * Read plainly: a parent's yes counts while he is a child and, given while he
 * was a child, goes on counting while he is a pupil AND her link to him is
 * live; his own record, once he has made one, is the only one that counts.
 * Until phase 0, her link ends on his birthday, so her consent does too.
 * Internal to the database in this phase (see the header).
 */
CREATE OR REPLACE FUNCTION health_consent_live(p_player uuid) RETURNS boolean AS $$
  SELECT coalesce((
    SELECT g.ended_on IS NULL
           AND p.born IS NOT NULL
           AND CASE g.given_by
                 WHEN 'self' THEN g.given_on >= majority_on(p.born)
                 ELSE g.given_on < majority_on(p.born)
                      AND health_giver_link_live(g.giver_link_id)
                      AND (majority_on(p.born) > sa_today() OR still_at_school(p.id))
               END
      FROM health_consent_governing(p_player) g
      JOIN player p ON p.id = g.player_id), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION health_consent_live(uuid) FROM PUBLIC;

/**
 * When his health rows fall due for deletion (§7.5): twelve months after the
 * later of the day his last health consent ended and the day he left the
 * school system. NULL while a consent is live, while he is at school, or when
 * no consent was ever recorded (there is nothing to delete). An open record
 * that no longer counts ended, for this, when its link did. Nothing deletes
 * in this phase: this is so the screen and the information officer can see
 * the date (health_records_purge() is phase 6).
 */
CREATE OR REPLACE FUNCTION health_retention_due(p_player uuid) RETURNS date AS $$
  SELECT CASE
           WHEN health_consent_live(p_player) OR still_at_school(p_player) THEN NULL
           WHEN NOT EXISTS (SELECT 1 FROM health_monitoring_consent c WHERE c.player_id = p_player) THEN NULL
           ELSE (greatest(
                   (SELECT max(coalesce(c.ended_on, g.valid_until, sa_today()))
                      FROM health_monitoring_consent c
                      JOIN assignment_subject g ON g.id = c.giver_link_id
                     WHERE c.player_id = p_player),
                   (SELECT max(m.left_on) FROM team_membership m
                      JOIN school s ON s.id = m.school_id
                     WHERE m.player_id = p_player AND s.kind = 'school'))
                 + interval '12 months')::date
         END
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION health_retention_due(uuid) FROM PUBLIC;

/**
 * Say yes or no to health monitoring for one child.
 *
 * TWO WAYS IN, and each checks its own authority (db/47's shape):
 *
 *   p_guardian NULL — the caller answers for himself. A guardian through her
 *     live, verified link to THIS child: her "yes" while he is a minor and the
 *     terms are agreed on the link; her "no" (a withdrawal, or a refusal)
 *     whenever her link is live, because stopping needs no lawful basis. Or
 *     the athlete himself, through his own verified 'self' link, from his
 *     eighteenth birthday (his date of birth known).
 *
 *   p_guardian set — the office, from its own admission forms: guardian.link.
 *     manage at the child's school, never under a support session; the
 *     guardian must hold a live, verified link; a "yes" names the form and its
 *     date (not in the future), a "no" need not.
 *
 * A GUARDIAN'S "YES" ON OR AFTER HIS EIGHTEENTH BIRTHDAY IS REFUSED:
 * adult_consents_for_himself — whether or not her link is still live, so the
 * answer is the same before and after phase 0 (§7.2, SCRBRD-083 §6.3).
 *
 * WHAT IT WRITES. Yes: the giver's open record, if any, ends as superseded
 * and a new one begins today (the same version again is already_given). No:
 * his open record ends today as withdrawn — effective on the next statement —
 * or, with nothing open, a refusal is recorded that begins and ends today.
 * Nothing else is updated and nothing is deleted.
 */
CREATE OR REPLACE FUNCTION health_monitoring_consent_set(
  p_player    uuid,
  p_yes       boolean,
  p_version   text,
  p_guardian  uuid DEFAULT NULL,
  p_form_name text DEFAULT NULL,
  p_form_date date DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_school uuid;
  v_born   date;
  v_by     text;
  v_asg    uuid;
  v_link   uuid;
  v_terms  text;
  v_today  date := sa_today();
  v_adult  boolean;
  v_open   health_monitoring_consent%ROWTYPE;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  -- A scorer's pad credential answers for nobody's child (db/50).
  IF app_pad_scoped() THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
  p_form_name := nullif(btrim(p_form_name), '');
  IF p_yes IS NULL THEN RETURN QUERY SELECT false, 'no_answer'; RETURN; END IF;
  IF p_version IS NULL OR btrim(p_version) = '' THEN
    RETURN QUERY SELECT false, 'no_consent_version'; RETURN;
  END IF;
  SELECT p.school_id, p.born INTO v_school, v_born FROM player p WHERE p.id = p_player;
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;
  v_adult := v_born IS NOT NULL AND majority_on(v_born) <= v_today;

  IF p_guardian IS NULL THEN
    IF p_form_name IS NOT NULL OR p_form_date IS NOT NULL THEN
      RETURN QUERY SELECT false, 'form_is_for_the_office'; RETURN;
    END IF;
    SELECT l.assignment_id, l.link_id INTO v_asg, v_link
      FROM public_name_live_link(app_user_id(), p_player, 'guardian') l;
    IF v_link IS NOT NULL THEN
      IF p_yes AND v_adult THEN RETURN QUERY SELECT false, 'adult_consents_for_himself'; RETURN; END IF;
      SELECT g.consent_state INTO v_terms FROM assignment_subject g WHERE g.id = v_link;
      IF p_yes AND v_terms IS DISTINCT FROM 'granted' THEN
        RETURN QUERY SELECT false, 'terms_not_agreed'; RETURN;
      END IF;
      v_by := 'guardian';
    ELSE
      SELECT l.assignment_id, l.link_id INTO v_asg, v_link
        FROM public_name_live_link(app_user_id(), p_player, 'selfaccess') l;
      IF v_link IS NULL THEN
        -- A guardian whose link ended on his birthday: say why, in the
        -- same word her live link would get.
        IF p_yes AND v_adult AND EXISTS (
             SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
              WHERE g.player_id = p_player AND a.person_id = app_user_id() AND a.role = 'guardian'
                AND g.verification_state = 'verified') THEN
          RETURN QUERY SELECT false, 'adult_consents_for_himself'; RETURN;
        END IF;
        RETURN QUERY SELECT false, 'not_permitted'; RETURN;
      END IF;
      IF NOT v_adult THEN RETURN QUERY SELECT false, 'not_yet_eighteen'; RETURN; END IF;
      v_by := 'self';
    END IF;
  ELSE
    IF NOT app_can('guardian.link.manage', v_school, '*'::text,
                   '00000000-0000-0000-0000-000000000000'::uuid,
                   '00000000-0000-0000-0000-000000000000'::uuid) THEN
      RETURN QUERY SELECT false, 'not_permitted'; RETURN;
    END IF;
    IF app_support_access_id(v_school) IS NOT NULL THEN
      RETURN QUERY SELECT false, 'not_under_support'; RETURN;
    END IF;
    SELECT l.assignment_id, l.link_id INTO v_asg, v_link
      FROM public_name_live_link(p_guardian, p_player, 'guardian') l;
    IF v_link IS NULL THEN
      IF p_yes AND v_adult THEN RETURN QUERY SELECT false, 'adult_consents_for_himself'; RETURN; END IF;
      RETURN QUERY SELECT false, 'no_verified_link'; RETURN;
    END IF;
    IF p_yes AND v_adult THEN RETURN QUERY SELECT false, 'adult_consents_for_himself'; RETURN; END IF;
    SELECT g.consent_state INTO v_terms FROM assignment_subject g WHERE g.id = v_link;
    IF p_yes AND v_terms IS DISTINCT FROM 'granted' THEN
      RETURN QUERY SELECT false, 'terms_not_agreed'; RETURN;
    END IF;
    IF (p_form_name IS NULL) <> (p_form_date IS NULL) OR (p_yes AND p_form_name IS NULL) THEN
      RETURN QUERY SELECT false, 'form_required'; RETURN;
    END IF;
    IF p_form_date > v_today THEN RETURN QUERY SELECT false, 'form_in_future'; RETURN; END IF;
    v_by := 'guardian';
  END IF;

  SELECT * INTO v_open FROM health_monitoring_consent c
   WHERE c.player_id = p_player AND c.giver_link_id = v_link AND c.ended_on IS NULL
   FOR UPDATE;

  IF p_yes THEN
    IF FOUND AND v_open.version = p_version THEN
      RETURN QUERY SELECT false, 'already_given'; RETURN;
    END IF;
    IF FOUND THEN
      UPDATE health_monitoring_consent
         SET ended_on = v_today, end_reason = 'superseded', ended_by = app_user_id(), ended_at = now()
       WHERE id = v_open.id;
    END IF;
    INSERT INTO health_monitoring_consent
      (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on,
       form_name, form_date, recorded_by)
    VALUES (p_player, v_by, v_asg, v_link, p_version, v_today, p_form_name, p_form_date, app_user_id());
  ELSIF FOUND THEN
    UPDATE health_monitoring_consent
       SET ended_on = v_today, end_reason = 'withdrawn', ended_by = app_user_id(), ended_at = now()
     WHERE id = v_open.id;
  ELSE
    INSERT INTO health_monitoring_consent
      (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on, ended_on,
       end_reason, form_name, form_date, recorded_by, ended_by, ended_at)
    VALUES (p_player, v_by, v_asg, v_link, p_version, v_today, v_today,
            'refused', p_form_name, p_form_date, app_user_id(), app_user_id(), now());
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION health_monitoring_consent_set(uuid, boolean, text, uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION health_monitoring_consent_set(uuid, boolean, text, uuid, text, date) TO scrbrd_app;

/**
 * The `consents` read: health monitoring, per child the caller answers for
 * through a live, verified link — her children as a guardian, himself
 * through his own account — one row each. STEP 4's Consents screen adds its
 * other kinds beside this one; the shape is per child and kind.
 *
 * It says whether the consent is live and what the governing record is, in
 * words and dates, and names nobody: "you", "the office" (a form), or the
 * other side ("his parent", "him"). No reason, no guardian's identity. The
 * boy's own row is read-only until he is eighteen (can_say_* false).
 *
 * ask_at_18: the "you are 18 — is this still all right?" card. He is an adult
 * reading his own row, he has made no record of his own yet, and a parent
 * said yes for him at some point.
 */
CREATE OR REPLACE FUNCTION my_health_consents()
RETURNS TABLE (player_id uuid, full_name text, relation text, adult boolean, live boolean,
               state text, given_by text, by_you boolean, from_form boolean,
               given_on date, ended_on date, version text,
               can_say_yes boolean, can_say_no boolean, parent_said_yes boolean,
               ask_at_18 boolean, retention_due date) AS $$
  WITH links AS (
    SELECT DISTINCT ON (g.player_id) g.player_id, g.id AS link_id,
           CASE WHEN g.relationship = 'self' THEN 'self' ELSE 'guardian' END AS relation,
           g.consent_state
      FROM role_assignment a
      JOIN assignment_subject g ON g.assignment_id = a.id
     WHERE a.person_id = app_user_id()
       AND a.role IN ('guardian', 'selfaccess')
       AND (a.role = 'selfaccess') = (g.relationship IS NOT DISTINCT FROM 'self')
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at IS NULL OR a.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
       AND g.verification_state = 'verified'
       AND g.valid_from <= current_date
       AND (g.valid_until IS NULL OR g.valid_until > current_date)
       -- Never through a support session, or a scorer's pad credential: it
       -- is nobody's family (db/22, db/50).
       AND app_support_access_id(a.school_id) IS NULL
       AND NOT app_pad_scoped()
     ORDER BY g.player_id, (g.relationship = 'self') DESC)
  SELECT l.player_id, p.full_name, l.relation,
         (p.born IS NOT NULL AND majority_on(p.born) <= sa_today()) AS adult,
         health_consent_live(l.player_id) AS live,
         CASE WHEN r.id IS NULL THEN 'not_answered'
              WHEN r.ended_on IS NULL THEN CASE WHEN health_consent_live(l.player_id) THEN 'given' ELSE 'lapsed' END
              ELSE r.end_reason END AS state,
         r.given_by,
         coalesce(r.recorded_by = app_user_id() AND r.form_name IS NULL, false) AS by_you,
         coalesce(r.form_name IS NOT NULL, false) AS from_form,
         r.given_on, r.ended_on, r.version,
         CASE l.relation
           WHEN 'self' THEN p.born IS NOT NULL AND majority_on(p.born) <= sa_today()
           ELSE p.born IS NOT NULL AND majority_on(p.born) > sa_today() AND l.consent_state = 'granted' END AS can_say_yes,
         CASE l.relation
           WHEN 'self' THEN p.born IS NOT NULL AND majority_on(p.born) <= sa_today()
           ELSE true END AS can_say_no,
         EXISTS (SELECT 1 FROM health_monitoring_consent c
                  WHERE c.player_id = l.player_id AND c.given_by = 'guardian'
                    AND c.end_reason IS DISTINCT FROM 'refused') AS parent_said_yes,
         (l.relation = 'self' AND p.born IS NOT NULL AND majority_on(p.born) <= sa_today()
          AND NOT EXISTS (SELECT 1 FROM health_monitoring_consent c
                           WHERE c.player_id = l.player_id AND c.given_by = 'self')
          AND EXISTS (SELECT 1 FROM health_monitoring_consent c
                       WHERE c.player_id = l.player_id AND c.given_by = 'guardian'
                         AND c.end_reason IS DISTINCT FROM 'refused')) AS ask_at_18,
         health_retention_due(l.player_id) AS retention_due
    FROM links l
    JOIN player p ON p.id = l.player_id
    LEFT JOIN LATERAL health_consent_governing(l.player_id) r ON true
   ORDER BY l.relation DESC, p.full_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION my_health_consents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_health_consents() TO scrbrd_app;


-- ── 5 · The load record (§1) ───────────────────────────────────────
-- The unit vocabulary: one row per unit, owned by the platform like `sport`.
-- Another sport adds rows, not columns.
CREATE TABLE IF NOT EXISTS load_unit (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]*$'),
  label      text NOT NULL CHECK (btrim(label) <> ''),
  sport_code text NOT NULL REFERENCES sport(code)
);
INSERT INTO load_unit (code, label, sport_code) VALUES ('delivery', 'Deliveries', 'cricket')
ON CONFLICT (code) DO NOTHING;

/**
 * A band's midpoint: under 12 → 6, 12-24 → 18, 24-36 → 30, 36+ → 42. Applied
 * where a figure is READ, never stored, so a change of edges is a change of
 * this one function (§1.3). NULL for no band.
 */
CREATE OR REPLACE FUNCTION load_band_units(p_band text) RETURNS integer AS $$
  SELECT CASE p_band WHEN 'lt12' THEN 6 WHEN '12_24' THEN 18 WHEN '24_36' THEN 30 WHEN '36plus' THEN 42 END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION load_band_units(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION load_band_units(text) TO scrbrd_app;

-- One row per person per recording of one session. Never updated: a
-- correction is a new row that names the one it replaces.
CREATE TABLE IF NOT EXISTS load_entry (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The boy's school, set by the stamp from his player row: never passed in.
  school_id           uuid NOT NULL REFERENCES school(id),
  player_id           uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  sport_code          text NOT NULL DEFAULT 'cricket' REFERENCES sport(code),
  unit_code           text NOT NULL DEFAULT 'delivery' REFERENCES load_unit(code),
  --   nets, training   a session at the nets or at training: a BAND
  --   match_elsewhere  a game scored on paper at a ground the platform does
  --                    not host: the scorebook's exact count. A match scored
  --                    on SCRBRD is in ball_event and is never entered here.
  kind                text NOT NULL CHECK (kind IN ('nets', 'training', 'match_elsewhere')),
  -- When it was one of ours. Its day is the session's day (the stamp).
  training_session_id uuid REFERENCES training_session(id),
  on_date             date NOT NULL,
  band                text CHECK (band IN ('lt12', '12_24', '24_36', '36plus')),
  units               integer CHECK (units BETWEEN 0 AND 1000),
  -- The effort: the three buttons write 3, 6 and 9. 1-10 so a sport that uses
  -- a numeric RPE needs no schema change.
  rpe                 smallint CHECK (rpe BETWEEN 1 AND 10),
  minutes             smallint CHECK (minutes BETWEEN 1 AND 600),
  -- Who said so, derived by the stamp and never passed in: 'self' when the
  -- writer holds a live self-access link to this boy, 'staff' otherwise.
  -- 'device' joins here under SCRBRD-111.
  recorded_by         uuid NOT NULL REFERENCES app_user(id),
  recorded_as         text NOT NULL CHECK (recorded_as IN ('self', 'staff')),
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  supersedes          uuid REFERENCES load_entry(id),
  -- Nets and training carry a band and never a count; a paper-scored match
  -- carries its count and never a band. Nobody can be asked to count a net.
  CONSTRAINT load_entry_band_or_count CHECK (
       (kind IN ('nets', 'training') AND band IS NOT NULL AND units IS NULL)
    OR (kind = 'match_elsewhere'     AND units IS NOT NULL AND band IS NULL)),
  CONSTRAINT load_entry_elsewhere_is_not_a_session
    CHECK (kind <> 'match_elsewhere' OR training_session_id IS NULL)
);
CREATE INDEX IF NOT EXISTS load_entry_player_day ON load_entry (player_id, on_date);
CREATE INDEX IF NOT EXISTS load_entry_supersedes ON load_entry (supersedes) WHERE supersedes IS NOT NULL;

/**
 * The stamp, before every insert. The browser never says who recorded a row,
 * which school it belongs to, or which day a session was on.
 *
 *   - school_id from the player; recorded_by, recorded_at from the session;
 *     recorded_as 'self' when the writer holds a live self-access link to
 *     this boy (db/47's public_name_live_link), 'staff' otherwise.
 *   - not in the future (SA time); the unit belongs to the sport.
 *   - a training session is at his school, and its day is the entry's day.
 *   - a correction (supersedes) replaces a row about the same boy, day,
 *     session and voice: the coach corrects the coach's figure, the boy his.
 *   - the module: refused where workload_monitoring is off for his school or
 *     for the writer — the same answer the API's gate gives.
 *
 * SECURITY DEFINER to read the player, the session and a superseded row
 * whatever the writer may read of them. It decides no access: the insert
 * policy (tables.mjs, player.workload.write) runs after it, on the row it
 * leaves.
 */
CREATE OR REPLACE FUNCTION load_entry_stamp() RETURNS trigger AS $$
DECLARE
  v_me   uuid := app_user_id();
  v_ts   record;
  v_prev load_entry%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_signed_in' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT p.school_id INTO NEW.school_id FROM player p WHERE p.id = NEW.player_id;
  IF NEW.school_id IS NULL THEN
    RAISE EXCEPTION 'no_such_player' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.recorded_by := v_me;
  NEW.recorded_at := now();
  NEW.recorded_as := CASE WHEN EXISTS (SELECT 1 FROM public_name_live_link(v_me, NEW.player_id, 'selfaccess'))
                          THEN 'self' ELSE 'staff' END;

  IF NOT feature_enabled('workload_monitoring', NEW.school_id, v_me) THEN
    RAISE EXCEPTION 'workload_monitoring_off' USING ERRCODE = 'check_violation',
      DETAIL = 'feature_flag.workload_monitoring is not on for this school; the platform grants it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM load_unit u WHERE u.code = NEW.unit_code AND u.sport_code = NEW.sport_code) THEN
    RAISE EXCEPTION 'unit_not_of_sport' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.training_session_id IS NOT NULL THEN
    SELECT t.school_id, (t.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS on_date INTO v_ts
      FROM training_session t WHERE t.id = NEW.training_session_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no_such_session' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_ts.school_id <> NEW.school_id THEN
      RAISE EXCEPTION 'session_not_at_his_school' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.on_date IS NOT NULL AND NEW.on_date <> v_ts.on_date THEN
      RAISE EXCEPTION 'session_is_on_another_day' USING ERRCODE = 'check_violation';
    END IF;
    NEW.on_date := v_ts.on_date;
  END IF;
  IF NEW.on_date IS NULL THEN
    RAISE EXCEPTION 'no_date' USING ERRCODE = 'not_null_violation';
  END IF;
  IF NEW.on_date > sa_today() THEN
    RAISE EXCEPTION 'load_entry_in_future' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.supersedes IS NOT NULL THEN
    SELECT * INTO v_prev FROM load_entry e WHERE e.id = NEW.supersedes;
    IF NOT FOUND
       OR v_prev.player_id <> NEW.player_id
       OR v_prev.on_date <> NEW.on_date
       OR coalesce(v_prev.training_session_id::text, v_prev.kind) <> coalesce(NEW.training_session_id::text, NEW.kind)
       OR v_prev.recorded_as <> NEW.recorded_as THEN
      RAISE EXCEPTION 'supersedes_another_session' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION load_entry_stamp() FROM PUBLIC;

DROP TRIGGER IF EXISTS load_entry_stamp ON load_entry;
CREATE TRIGGER load_entry_stamp BEFORE INSERT ON load_entry
  FOR EACH ROW EXECUTE FUNCTION load_entry_stamp();


-- ── 6 · Who may read and write them: generated from tables.mjs ─────
-- load_unit: anyone signed in reads it; the platform writes it.
-- load_entry: read under player.workload.read, written under
-- player.workload.write, anchored through the player as injury is. No DELETE
-- policy anywhere; see below for UPDATE.
-- ┌── GENERATED from packages/policy/src/tables.mjs by services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09). DO NOT EDIT BY HAND; `pnpm rls:generate` rewrites it.

-- load_unit — read: platform.feature.manage · write: platform.feature.manage
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE load_unit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS load_unit_read   ON load_unit;
DROP POLICY IF EXISTS load_unit_insert ON load_unit;
DROP POLICY IF EXISTS load_unit_update ON load_unit;
DROP POLICY IF EXISTS load_unit_delete ON load_unit;

CREATE POLICY load_unit_read ON load_unit
  FOR SELECT USING ((app_can('platform.feature.manage', '00000000-0000-0000-0000-000000000000'::uuid, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    OR (app_user_id() IS NOT NULL));

CREATE POLICY load_unit_insert ON load_unit
  FOR INSERT WITH CHECK (app_can('platform.feature.manage', '00000000-0000-0000-0000-000000000000'::uuid, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY load_unit_update ON load_unit
  FOR UPDATE USING (app_can('platform.feature.manage', '00000000-0000-0000-0000-000000000000'::uuid, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('platform.feature.manage', '00000000-0000-0000-0000-000000000000'::uuid, '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- load_entry — read: player.workload.read · write: player.workload.write
ALTER TABLE load_entry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS load_entry_read   ON load_entry;
DROP POLICY IF EXISTS load_entry_insert ON load_entry;
DROP POLICY IF EXISTS load_entry_update ON load_entry;
DROP POLICY IF EXISTS load_entry_delete ON load_entry;

CREATE POLICY load_entry_read ON load_entry
  FOR SELECT USING (app_can('player.workload.read', load_entry.school_id, (SELECT p.team_code FROM player p WHERE p.id = load_entry.player_id), load_entry.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY load_entry_insert ON load_entry
  FOR INSERT WITH CHECK (app_can('player.workload.write', load_entry.school_id, (SELECT p.team_code FROM player p WHERE p.id = load_entry.player_id), load_entry.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY load_entry_update ON load_entry
  FOR UPDATE USING (app_can('player.workload.write', load_entry.school_id, (SELECT p.team_code FROM player p WHERE p.id = load_entry.player_id), load_entry.player_id, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('player.workload.write', load_entry.school_id, (SELECT p.team_code FROM player p WHERE p.id = load_entry.player_id), load_entry.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- └── END GENERATED

-- Never updated, never deleted by the application: a correction is a new
-- row (supersedes), and the generated UPDATE policy is therefore unreachable.
-- Two layers, as db/47 does for its records.
REVOKE UPDATE, DELETE, TRUNCATE ON load_entry FROM scrbrd_app;
REVOKE DELETE, TRUNCATE ON load_unit FROM scrbrd_app;

-- db/50: a pad resume credential (a scorer's device, one match) reads and
-- writes none of the three: a restrictive guard for every command a
-- permissive policy on each admits.
SELECT pad_scope_guard_install('health_monitoring_consent'::regclass)
     + pad_scope_guard_install('load_unit'::regclass)
     + pad_scope_guard_install('load_entry'::regclass) AS pad_guards;


-- ── 7 · How the pieces combine: load_day (§1.4) ────────────────────
-- One row per player per sport per day that has any load. Match units are the
-- ball log's (bowler_over.deliveries: wides and no-balls included), exact;
-- entered units are one figure per session — the band's midpoint, or a
-- paper-scored match's count. A session is (boy, day, training session or
-- else kind); in it, the last row of his own chain when he recorded one, else
-- the last row of the staff chain (§1.3). Nothing is compared and nothing is
-- flagged, except that a paper-scored match on a day the log already has
-- deliveries for him is marked as possibly counted twice, and a person
-- decides.
--
-- NOT granted to the application. It is read through load_summary(),
-- load_weeks() and workload(), which read it as its owner and ask
-- player.workload.read per boy. Granted, a team-mate who holds fixture.read
-- could assemble a boy's match half of it from the scorecard's balls, and a
-- day-by-day load is not a scorecard. security_invoker as well, so a later
-- grant would still obey every underlying policy.
CREATE OR REPLACE VIEW load_day WITH (security_invoker = true) AS
WITH live AS (
  SELECT e.*, coalesce(e.training_session_id::text, e.kind) AS grp
    FROM load_entry e
   WHERE NOT EXISTS (SELECT 1 FROM load_entry n WHERE n.supersedes = e.id)),
pick AS (
  SELECT DISTINCT ON (l.player_id, l.sport_code, l.on_date, l.grp) l.*
    FROM live l
   ORDER BY l.player_id, l.sport_code, l.on_date, l.grp,
            (l.recorded_as = 'self') DESC, l.recorded_at DESC, l.id DESC),
entered AS (
  SELECT k.player_id, k.sport_code, k.on_date,
         sum(coalesce(load_band_units(k.band), k.units))::int AS entered_units,
         bool_or(k.band IS NOT NULL) AS estimated,
         sum(k.minutes)::int AS minutes,
         sum(k.rpe * k.minutes)::int AS au,
         count(*)::int AS sessions,
         bool_or(k.kind = 'match_elsewhere') AS elsewhere
    FROM pick k
   GROUP BY k.player_id, k.sport_code, k.on_date),
scored AS (
  SELECT o.bowler_id AS player_id, 'cricket'::text AS sport_code, o.bowled_on AS on_date,
         sum(o.deliveries)::int AS match_units, count(DISTINCT o.match_id)::int AS matches
    FROM bowler_over o
   GROUP BY o.bowler_id, o.bowled_on)
SELECT coalesce(e.player_id, m.player_id) AS player_id,
       pl.school_id,
       coalesce(e.sport_code, m.sport_code) AS sport_code,
       coalesce(e.on_date, m.on_date) AS on_date,
       coalesce(m.match_units, 0) AS match_units,
       coalesce(e.entered_units, 0) AS entered_units,
       coalesce(m.match_units, 0) + coalesce(e.entered_units, 0) AS units,
       coalesce(e.estimated, false) AS estimated,
       e.minutes,
       e.au,
       coalesce(e.sessions, 0) + coalesce(m.matches, 0) AS sessions,
       (coalesce(e.elsewhere, false) AND coalesce(m.match_units, 0) > 0) AS possibly_doubled
  FROM entered e
  FULL JOIN scored m ON m.player_id = e.player_id AND m.sport_code = e.sport_code AND m.on_date = e.on_date
  JOIN player pl ON pl.id = coalesce(e.player_id, m.player_id);

REVOKE ALL ON load_day FROM PUBLIC, scrbrd_app;


-- ── 8 · The words (§2.2) ───────────────────────────────────────────
/**
 * The ratio's word, on workload()'s own thresholds (db/08), so the existing
 * screen and the new one never disagree about what "spike" means: over 1.5
 * spike, from 1.2 rising, under 0.8 light, otherwise steady.
 */
CREATE OR REPLACE FUNCTION load_ratio_word(p_ratio numeric) RETURNS text AS $$
  SELECT CASE WHEN p_ratio IS NULL THEN NULL
              WHEN p_ratio > 1.5  THEN 'spike'
              WHEN p_ratio >= 1.2 THEN 'rising'
              WHEN p_ratio < 0.8  THEN 'light'
              ELSE 'steady' END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION load_ratio_word(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION load_ratio_word(numeric) TO scrbrd_app;

/**
 * The word beside a bowler's load. A fixed vocabulary, about LOAD and never
 * about the body — no word says risk, danger, injury or unsafe — and every
 * screen that shows one shows "A guide to a conversation, not a diagnosis."
 *   no load            nothing in 28 days
 *   rested             nothing this week, something this month
 *   too little to say  fewer than 12 units in 28 days
 *   light / steady / rising / spike   the EWMA ratio, on load_ratio_word()
 */
CREATE OR REPLACE FUNCTION load_word(p_units_28d numeric, p_units_7d numeric, p_ratio numeric) RETURNS text AS $$
  SELECT CASE WHEN coalesce(p_units_28d, 0) = 0 THEN 'no load'
              WHEN coalesce(p_units_7d, 0) = 0  THEN 'rested'
              WHEN p_units_28d < 12 OR p_ratio IS NULL THEN 'too little to say'
              ELSE load_ratio_word(p_ratio) END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION load_word(numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION load_word(numeric, numeric, numeric) TO scrbrd_app;


-- ── 9 · One bowler's figures: load_summary(), load_weeks() (§2.3) ──
/**
 * One row for one boy the caller may read the load of (player.workload.read
 * per row, inside the function, as workload() does), none otherwise.
 *
 *   units_Nd, match_units_Nd, estimated_Nd   the 7/14/28/42-day windows
 *       ending today (SA time); estimated when a band is inside, with the
 *       exact match share beside it
 *   units_prev_7d, week_change_pct           this 7 days against the 7 before
 *   ewma_acute, ewma_chronic, ewma_ratio     λ = 2/(7+1) and 2/(28+1) over
 *       the zero-padded daily series of the last 90 days; the ratio (2 dp)
 *       is the word's
 *   load_word, ratio_estimated               the word, and whether a band is
 *       inside the 90 days the ratio reads
 *   uncoupled_ratio                          this 7 days against the mean
 *       of the 3 weeks before (7:21)
 *   days_since_bowled, longest_gap_42d, usual_gap_28d
 *   baseline_week, baseline_weeks_with_load, baseline_weeks_needed,
 *   baseline_deviation, baseline_word        §2.4: the median of his weekly
 *       totals (7-day blocks back from today) for weeks 3-14, only when 6 of
 *       them had any load; else how many more such weeks it needs
 *   possibly_doubled_7d, possibly_doubled_on
 *   monitored                                health_consent_live()
 *   over_guideline_28d, days_since_last_injury, returning_from_injury
 *                                            phase 3's; NULL until it lands
 *                                            and NULL for a boy without a live
 *                                            health consent after it does
 */
CREATE OR REPLACE FUNCTION load_summary(p_player uuid, p_sport text DEFAULT 'cricket')
RETURNS TABLE (
  player_id uuid, sport_code text, on_date date,
  units_7d int, units_14d int, units_28d int, units_42d int,
  match_units_7d int, match_units_14d int, match_units_28d int, match_units_42d int,
  estimated_7d boolean, estimated_14d boolean, estimated_28d boolean, estimated_42d boolean,
  units_prev_7d int, week_change_pct numeric,
  ewma_acute numeric, ewma_chronic numeric, ewma_ratio numeric, load_word text, ratio_estimated boolean,
  uncoupled_ratio numeric,
  days_since_bowled int, longest_gap_42d int, usual_gap_28d numeric,
  baseline_week numeric, baseline_weeks_with_load int, baseline_weeks_needed int,
  baseline_deviation numeric, baseline_word text,
  possibly_doubled_7d boolean, possibly_doubled_on date[],
  monitored boolean,
  over_guideline_28d jsonb, days_since_last_injury int, returning_from_injury boolean
) AS $$
  WITH me AS (
    SELECT p.id FROM player p
     WHERE p.id = p_player
       AND app_can('player.workload.read', p.school_id, p.team_code, p.id,
                   '00000000-0000-0000-0000-000000000000'::uuid)),
  s AS (
    SELECT (sa_today() - g)::date AS on_date, g AS ago,
           coalesce(l.units, 0) AS units, coalesce(l.match_units, 0) AS match_units,
           coalesce(l.estimated, false) AS estimated, coalesce(l.possibly_doubled, false) AS doubled
      FROM me
      CROSS JOIN generate_series(0, 97) g
      LEFT JOIN load_day l ON l.player_id = me.id AND l.sport_code = p_sport AND l.on_date = sa_today() - g),
  f AS (
    SELECT sum(units) FILTER (WHERE ago < 7)::int  AS u7,  sum(units) FILTER (WHERE ago < 14)::int AS u14,
           sum(units) FILTER (WHERE ago < 28)::int AS u28, sum(units) FILTER (WHERE ago < 42)::int AS u42,
           sum(match_units) FILTER (WHERE ago < 7)::int  AS m7,  sum(match_units) FILTER (WHERE ago < 14)::int AS m14,
           sum(match_units) FILTER (WHERE ago < 28)::int AS m28, sum(match_units) FILTER (WHERE ago < 42)::int AS m42,
           coalesce(bool_or(estimated) FILTER (WHERE ago < 7),  false) AS e7,
           coalesce(bool_or(estimated) FILTER (WHERE ago < 14), false) AS e14,
           coalesce(bool_or(estimated) FILTER (WHERE ago < 28), false) AS e28,
           coalesce(bool_or(estimated) FILTER (WHERE ago < 42), false) AS e42,
           coalesce(bool_or(estimated) FILTER (WHERE ago < 90), false) AS e90,
           sum(units) FILTER (WHERE ago BETWEEN 7 AND 13)::int AS prev7,
           sum(units) FILTER (WHERE ago BETWEEN 7 AND 27)::numeric AS prev21,
           sum(units * 0.25 * power(0.75::numeric, ago)) FILTER (WHERE ago < 90) AS acute,
           sum(units * (2.0 / 29) * power((27.0 / 29)::numeric, ago)) FILTER (WHERE ago < 90) AS chronic,
           min(ago) FILTER (WHERE units > 0) AS since,
           coalesce(bool_or(doubled) FILTER (WHERE ago < 7), false) AS d7,
           array_agg(on_date ORDER BY on_date) FILTER (WHERE doubled AND ago < 42) AS dd
      FROM s),
  w AS (SELECT ago / 7 + 1 AS blk, sum(units) AS total FROM s GROUP BY ago / 7),
  base AS (
    SELECT CASE WHEN count(*) FILTER (WHERE total > 0) >= 6
                THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY total) END::numeric AS baseline,
           count(*) FILTER (WHERE total > 0)::int AS with_load
      FROM w WHERE blk BETWEEN 3 AND 14),
  runs AS (
    SELECT max(n)::int AS longest FROM (
      SELECT count(*) AS n FROM (
        SELECT on_date - (row_number() OVER (ORDER BY on_date))::int AS isl
          FROM s WHERE ago < 42 AND units = 0) z
       GROUP BY isl) r),
  gaps AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap)::numeric AS usual
      FROM (SELECT on_date - lag(on_date) OVER (ORDER BY on_date) AS gap
              FROM s WHERE ago < 28 AND units > 0) x
     WHERE gap IS NOT NULL),
  r AS (SELECT f.*, CASE WHEN f.chronic > 0 THEN round(f.acute / f.chronic, 2) END AS ratio FROM f)
  SELECT me.id, p_sport, sa_today(),
         coalesce(r.u7, 0), coalesce(r.u14, 0), coalesce(r.u28, 0), coalesce(r.u42, 0),
         coalesce(r.m7, 0), coalesce(r.m14, 0), coalesce(r.m28, 0), coalesce(r.m42, 0),
         r.e7, r.e14, r.e28, r.e42,
         coalesce(r.prev7, 0),
         CASE WHEN coalesce(r.prev7, 0) > 0 THEN round((coalesce(r.u7, 0) - r.prev7) * 100.0 / r.prev7, 0) END,
         round(r.acute, 2), round(r.chronic, 2), r.ratio,
         load_word(r.u28, r.u7, r.ratio), r.e90,
         CASE WHEN coalesce(r.prev21, 0) > 0 THEN round(coalesce(r.u7, 0) / (r.prev21 / 3), 2) END,
         r.since, coalesce(runs.longest, 0), gaps.usual,
         base.baseline, base.with_load,
         CASE WHEN base.baseline IS NULL THEN greatest(6 - base.with_load, 1) END,
         CASE WHEN base.baseline > 0 THEN round(coalesce(r.u7, 0) / base.baseline, 2) END,
         CASE WHEN base.baseline > 0 THEN load_ratio_word(round(coalesce(r.u7, 0) / base.baseline, 2)) END,
         r.d7, r.dd,
         health_consent_live(me.id),
         NULL::jsonb, NULL::int, NULL::boolean
    FROM me, r, base, runs, gaps
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION load_summary(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION load_summary(uuid, text) TO scrbrd_app;

/**
 * One row per ISO week (Monday, SA time), oldest first, for the last p_weeks
 * weeks including this one (1-104, default 26): units with the match and the
 * entered share, estimated, sessions, minutes and AU, and — beside every row —
 * the 13- and 26-week means of the complete weeks before this one. The
 * client draws the chart and computes nothing. planned_units is phase 3's.
 * No rows for a boy the caller may not read the load of.
 */
CREATE OR REPLACE FUNCTION load_weeks(p_player uuid, p_weeks integer DEFAULT 26, p_sport text DEFAULT 'cricket')
RETURNS TABLE (week_start date, week_end date, units int, match_units int, entered_units int,
               estimated boolean, sessions int, minutes int, au int, planned_units int,
               mean_13w numeric, mean_26w numeric) AS $$
  WITH me AS (
    SELECT p.id FROM player p
     WHERE p.id = p_player
       AND app_can('player.workload.read', p.school_id, p.team_code, p.id,
                   '00000000-0000-0000-0000-000000000000'::uuid)),
  n AS (SELECT least(greatest(coalesce(p_weeks, 26), 1), 104) AS weeks),
  wk AS (
    SELECT (date_trunc('week', sa_today()::timestamp)::date - 7 * g) AS week_start, g
      FROM n, generate_series(0, greatest(n.weeks, 27) - 1) g),
  agg AS (
    SELECT wk.week_start, wk.g,
           coalesce(sum(l.units), 0)::int AS units,
           coalesce(sum(l.match_units), 0)::int AS match_units,
           coalesce(sum(l.entered_units), 0)::int AS entered_units,
           coalesce(bool_or(l.estimated), false) AS estimated,
           coalesce(sum(l.sessions), 0)::int AS sessions,
           sum(l.minutes)::int AS minutes,
           sum(l.au)::int AS au
      FROM me
      CROSS JOIN wk
      LEFT JOIN load_day l ON l.player_id = me.id AND l.sport_code = p_sport
                          AND l.on_date >= wk.week_start AND l.on_date < wk.week_start + 7
                          AND l.on_date <= sa_today()
     GROUP BY wk.week_start, wk.g),
  means AS (
    SELECT round(avg(units) FILTER (WHERE g BETWEEN 1 AND 13), 1) AS m13,
           round(avg(units) FILTER (WHERE g BETWEEN 1 AND 26), 1) AS m26
      FROM agg)
  SELECT a.week_start, least(a.week_start + 6, sa_today()), a.units, a.match_units, a.entered_units,
         a.estimated, a.sessions, a.minutes, a.au, NULL::int, m.m13, m.m26
    FROM agg a, means m, n
   WHERE a.g < n.weeks
   ORDER BY a.week_start
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION load_weeks(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION load_weeks(uuid, integer, text) TO scrbrd_app;


-- ── 10 · workload(), re-emitted (§2.3) ─────────────────────────────
-- db/08's function exactly — its columns, their meaning, the coupled acwr and
-- load_state on overs, its order (breaches first, then spikes) — with six
-- columns added at the END of the row so the coach's list can sort by the new
-- word without a second call:
--   units_7d, units_28d   deliveries from load_day: the log's, and the bands
--   estimated_7d          a band is inside this week's figure
--   ewma_ratio, load_word the EWMA ratio and its word, as load_summary()
--   monitored             his health consent is live (the screen says "not
--                         monitored" rather than drawing an empty cell)
-- A function's row type cannot change in place, so it is dropped and made
-- again; nothing in the schema depends on it, and the read route selects w.*.
DROP FUNCTION IF EXISTS workload(text);
CREATE FUNCTION workload(p_team text DEFAULT NULL)
RETURNS TABLE (player_id uuid, full_name text, team_code text, school_id uuid,
               age_band text, pace boolean, max_overs_per_spell smallint, max_overs_per_day smallint,
               overs_7d int, overs_28d int, longest_spell_7d int, breaches_28d int, last_bowled_on date,
               sessions_7d int, minutes_7d int, sessions_28d int, minutes_28d int,
               acwr numeric, load_state text,
               units_7d int, units_28d int, estimated_7d boolean, ewma_ratio numeric, load_word text,
               monitored boolean) AS $$
  WITH boys AS (
    SELECT p.id, p.full_name, p.team_code, p.school_id, p.born, p.bowling_style
      FROM player p
     WHERE (p_team IS NULL OR p.team_code = p_team)
       AND app_can('player.workload.read', p.school_id, p.team_code, p.id,
                   '00000000-0000-0000-0000-000000000000'::uuid)),
  bowl AS (
    SELECT o.bowler_id,
           count(*) FILTER (WHERE o.bowled_on > sa_today() - 7)::int  AS overs_7d,
           count(*) FILTER (WHERE o.bowled_on > sa_today() - 28)::int AS overs_28d,
           max(o.bowled_on) AS last_bowled_on
      FROM bowler_over o JOIN boys b ON b.id = o.bowler_id
     WHERE o.bowled_on <= sa_today()
     GROUP BY o.bowler_id),
  spells AS (
    SELECT s.bowler_id, max(s.overs)::int AS longest_spell_7d
      FROM bowler_spell s JOIN boys b ON b.id = s.bowler_id
     WHERE s.bowled_on > sa_today() - 7 AND s.bowled_on <= sa_today()
     GROUP BY s.bowler_id),
  breaches AS (
    SELECT x.bowler_id, count(*)::int AS breaches_28d
      FROM bowling_breach x JOIN boys b ON b.id = x.bowler_id
     WHERE x.bowled_on > sa_today() - 28
     GROUP BY x.bowler_id),
  train AS (
    SELECT a.player_id,
           count(*) FILTER (WHERE t.starts_at > now() - interval '7 days')::int            AS sessions_7d,
           coalesce(sum(t.duration_min) FILTER (WHERE t.starts_at > now() - interval '7 days'), 0)::int  AS minutes_7d,
           count(*)::int AS sessions_28d,
           coalesce(sum(t.duration_min), 0)::int AS minutes_28d
      FROM training_attendance a
      JOIN training_session t ON t.id = a.session_id
      JOIN boys b ON b.id = a.player_id
     WHERE a.status IN ('present', 'late') AND NOT t.cancelled
       AND t.starts_at > now() - interval '28 days' AND t.starts_at <= now()
     GROUP BY a.player_id),
  -- The load, from load_day: the same series and the same EWMA as
  -- load_summary(), so the list and the profile say the same word.
  lf AS (
    SELECT d.player_id,
           sum(d.units) FILTER (WHERE sa_today() - d.on_date < 7)::int  AS units_7d,
           sum(d.units) FILTER (WHERE sa_today() - d.on_date < 28)::int AS units_28d,
           coalesce(bool_or(d.estimated) FILTER (WHERE sa_today() - d.on_date < 7), false) AS estimated_7d,
           sum(d.units * 0.25 * power(0.75::numeric, sa_today() - d.on_date)) AS acute,
           sum(d.units * (2.0 / 29) * power((27.0 / 29)::numeric, sa_today() - d.on_date)) AS chronic
      FROM load_day d JOIN boys b ON b.id = d.player_id
     WHERE d.sport_code = 'cricket' AND d.on_date <= sa_today() AND d.on_date > sa_today() - 90
     GROUP BY d.player_id)
  SELECT b.id, b.full_name, b.team_code, b.school_id,
         d.age_band, d.pace, d.max_overs_per_spell, d.max_overs_per_day,
         coalesce(w.overs_7d, 0), coalesce(w.overs_28d, 0), coalesce(sp.longest_spell_7d, 0),
         coalesce(br.breaches_28d, 0), w.last_bowled_on,
         coalesce(tr.sessions_7d, 0), coalesce(tr.minutes_7d, 0), coalesce(tr.sessions_28d, 0), coalesce(tr.minutes_28d, 0),
         CASE WHEN coalesce(w.overs_28d, 0) > 0
              THEN round(coalesce(w.overs_7d, 0) / (w.overs_28d / 4.0), 2) END AS acwr,
         CASE WHEN coalesce(w.overs_28d, 0) = 0 THEN 'no bowling'
              WHEN coalesce(w.overs_7d, 0) = 0 THEN 'rested'
              WHEN w.overs_7d / (w.overs_28d / 4.0) > 1.5 THEN 'spike'
              WHEN w.overs_7d / (w.overs_28d / 4.0) >= 1.2 THEN 'rising'
              WHEN w.overs_7d / (w.overs_28d / 4.0) < 0.8 THEN 'light'
              ELSE 'steady' END AS load_state,
         coalesce(lf.units_7d, 0), coalesce(lf.units_28d, 0), coalesce(lf.estimated_7d, false),
         CASE WHEN lf.chronic > 0 THEN round(lf.acute / lf.chronic, 2) END,
         load_word(lf.units_28d, lf.units_7d, CASE WHEN lf.chronic > 0 THEN round(lf.acute / lf.chronic, 2) END),
         health_consent_live(b.id)
    FROM boys b
    CROSS JOIN LATERAL bowling_directive_for(b.id) d
    LEFT JOIN bowl w ON w.bowler_id = b.id
    LEFT JOIN spells sp ON sp.bowler_id = b.id
    LEFT JOIN breaches br ON br.bowler_id = b.id
    LEFT JOIN train tr ON tr.player_id = b.id
    LEFT JOIN lf ON lf.player_id = b.id
   ORDER BY CASE WHEN coalesce(br.breaches_28d, 0) > 0 THEN 0 ELSE 1 END,
            CASE WHEN coalesce(w.overs_28d, 0) > 0 AND w.overs_7d / (w.overs_28d / 4.0) > 1.5 THEN 0 ELSE 1 END,
            coalesce(w.overs_7d, 0) DESC, b.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION workload(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workload(text) TO scrbrd_app;


-- ── Who may call these: the application, and nobody else ──────────
-- On a managed host the platform's API roles get EXECUTE on every new
-- function by default privilege, directly and not through PUBLIC (db/29
-- found this), so it is taken back from them here, as db/47 and db/57 do.
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY[
          'still_at_school(uuid)', 'health_giver_link_live(uuid)', 'health_consent_governing(uuid)',
          'health_consent_live(uuid)', 'health_retention_due(uuid)',
          'health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)', 'my_health_consents()',
          'load_band_units(text)', 'load_entry_stamp()', 'load_ratio_word(numeric)',
          'load_word(numeric,numeric,numeric)', 'load_summary(uuid,text)',
          'load_weeks(uuid,integer,text)', 'workload(text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON health_monitoring_consent, load_entry, load_unit, load_day FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  t text;
  n int;
BEGIN
  -- Every function: SECURITY DEFINER (but the pure ones) with a pinned search
  -- path (db/16).
  FOREACH f IN ARRAY ARRAY['still_at_school(uuid)', 'health_giver_link_live(uuid)',
                           'health_consent_governing(uuid)', 'health_consent_live(uuid)',
                           'health_retention_due(uuid)',
                           'health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)',
                           'my_health_consents()', 'load_entry_stamp()', 'load_summary(uuid,text)',
                           'load_weeks(uuid,integer,text)', 'workload(text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/60: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;

  -- The application's doors, and nobody else's: not PUBLIC.
  FOREACH f IN ARRAY ARRAY['health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)',
                           'my_health_consents()', 'load_summary(uuid,text)',
                           'load_weeks(uuid,integer,text)', 'workload(text)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/60: the application cannot call %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['still_at_school(uuid)', 'health_giver_link_live(uuid)',
                           'health_consent_governing(uuid)', 'health_consent_live(uuid)',
                           'health_retention_due(uuid)', 'health_monitoring_consent_set(uuid,boolean,text,uuid,text,date)',
                           'my_health_consents()', 'load_entry_stamp()', 'load_summary(uuid,text)',
                           'load_weeks(uuid,integer,text)', 'workload(text)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/60: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  -- The internals are the owner's alone: the consent's liveness is read
  -- through my_health_consents() and workload() in this phase.
  FOREACH f IN ARRAY ARRAY['still_at_school(uuid)', 'health_consent_live(uuid)',
                           'health_consent_governing(uuid)', 'health_retention_due(uuid)'] LOOP
    IF has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/60: the application can call the internal %', f;
    END IF;
  END LOOP;

  -- The consent record has one door; the load record is never updated.
  IF has_table_privilege('scrbrd_app', 'health_monitoring_consent', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'health_monitoring_consent', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'health_monitoring_consent', 'DELETE') THEN
    RAISE EXCEPTION 'db/60: the application can write health_monitoring_consent directly';
  END IF;
  IF has_table_privilege('scrbrd_app', 'load_entry', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'load_entry', 'DELETE') THEN
    RAISE EXCEPTION 'db/60: the application can change a load entry';
  END IF;
  IF has_table_privilege('scrbrd_app', 'load_day', 'SELECT') THEN
    RAISE EXCEPTION 'db/60: the application reads load_day directly, around the per-boy check';
  END IF;

  -- Row-level security on every new table, with the generated policies and
  -- the consent's support cut in place.
  FOREACH t IN ARRAY ARRAY['health_monitoring_consent', 'load_unit', 'load_entry'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'db/60: % has row-level security off', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['load_unit_read', 'load_unit_insert', 'load_unit_update',
                           'load_entry_read', 'load_entry_insert', 'load_entry_update',
                           'health_monitoring_consent_read', 'health_monitoring_consent_not_support'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = t) THEN
      RAISE EXCEPTION 'db/60: policy % is missing', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'load_entry_insert'
                    AND with_check LIKE '%player.workload.write%')
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'load_entry_read'
                       AND qual LIKE '%player.workload.read%') THEN
    RAISE EXCEPTION 'db/60: load_entry is not governed by player.workload.read/.write';
  END IF;
  IF (SELECT permissive FROM pg_policies WHERE policyname = 'health_monitoring_consent_not_support') <> 'RESTRICTIVE' THEN
    RAISE EXCEPTION 'db/60: the support cut on the consent is not RESTRICTIVE';
  END IF;

  -- The pad guard (db/50) on every command a permissive policy admits.
  FOREACH t IN ARRAY ARRAY['health_monitoring_consent', 'load_unit', 'load_entry'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                      AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'db/60: % has no RESTRICTIVE pad_scope_select (db/50)', t;
    END IF;
  END LOOP;

  -- The stamp is on the table.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'load_entry'::regclass
                    AND tgname = 'load_entry_stamp' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'db/60: load_entry has no stamp';
  END IF;

  -- The fitness role: whole, and never the physio's notes or a coach's prose.
  SELECT count(*) INTO n FROM role_capability WHERE role = 'fitness';
  IF n <> 14 THEN RAISE EXCEPTION 'db/60: the fitness role holds % capabilities, not 14', n; END IF;
  IF EXISTS (SELECT 1 FROM role_capability WHERE role = 'fitness'
                AND capability IN ('medical.details.read', 'player.note.read', 'medical.write')) THEN
    RAISE EXCEPTION 'db/60: the fitness role reads the physio''s notes or a coach''s prose';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM role_grantable WHERE granter = 'directorofsport' AND role = 'fitness') THEN
    RAISE EXCEPTION 'db/60: the director of sport cannot appoint the fitness coach';
  END IF;
  IF EXISTS (SELECT 1 FROM role_capability
              WHERE capability IN ('player.workload.write', 'wellness.read', 'fitness.test.write')
                AND role IN ('player', 'guardian', 'spectator', 'analyst', 'scorer', 'official',
                             'media', 'scout', 'enquiry')) THEN
    RAISE EXCEPTION 'db/60: a team-mate, a parent or an observer holds a load or wellness capability';
  END IF;

  -- The switch arrives off.
  IF (SELECT enabled FROM feature_flag WHERE key = 'workload_monitoring') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'db/60: workload_monitoring does not arrive off';
  END IF;

  -- The bands and the words.
  IF load_band_units('lt12') <> 6 OR load_band_units('12_24') <> 18 OR load_band_units('24_36') <> 30
     OR load_band_units('36plus') <> 42 OR load_band_units('something') IS NOT NULL THEN
    RAISE EXCEPTION 'db/60: a band is not read at its midpoint';
  END IF;
  IF load_ratio_word(0.79) <> 'light' OR load_ratio_word(0.8) <> 'steady' OR load_ratio_word(1.19) <> 'steady'
     OR load_ratio_word(1.2) <> 'rising' OR load_ratio_word(1.5) <> 'rising' OR load_ratio_word(1.51) <> 'spike'
     OR load_word(0, 0, NULL) <> 'no load' OR load_word(20, 0, 0) <> 'rested'
     OR load_word(11, 11, 3) <> 'too little to say' THEN
    RAISE EXCEPTION 'db/60: the words do not follow workload()''s thresholds';
  END IF;

  -- A boy who does not exist has no load, no weeks and no consent.
  SELECT (SELECT count(*) FROM load_summary('00000000-0000-0000-0000-000000000000'))
       + (SELECT count(*) FROM load_weeks('00000000-0000-0000-0000-000000000000')) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'db/60: a player who does not exist was answered'; END IF;
  IF health_consent_live('00000000-0000-0000-0000-000000000000') THEN
    RAISE EXCEPTION 'db/60: a player who does not exist has a live consent';
  END IF;
END $check$;
