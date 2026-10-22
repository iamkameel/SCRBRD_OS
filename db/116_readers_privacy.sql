-- ══════════════════════════════════════════════════════════════════
--  116 · Who reads a child's data: Kameel's decisions of 21 Oct 2026
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/READERS_child_data.md §7, "Decisions" (Q1–Q16),
-- decided by Kameel on 21 October 2026, each recorded as a dated "Changed 21
-- Oct 2026" line in the design it changes. This file builds the ones that
-- need SQL. Its proof is db/99 §86; packages/policy/test/separation.test.mjs
-- holds the model half.
--
-- WHAT CHANGES, by decision
--
--   Q2  `audit.read` opens the access log and nothing else. A reason stays
--       under the capability of the act that wrote it (§2):
--         scoring_amendment_read      the reason and the decider's note:
--                                     the requester and scoring.amend.approve
--         role_assignment_ending_read why a role was ended: user.role.assign
--         account_status_change_read  why an account was disabled: user.invite
--         school_register_rows()      the staff register: user.role.assign
--       Checked and KEPT, each the log itself and carrying no reason about a
--       person: access_log (the log), scoring_audit (who held the pen; no free
--       text), support_access (the platform's own reads into a school: the
--       record the school audits them by, its reason written FOR the school),
--       audit_log() (the log's door, which selects no free text: db/80), and
--       the scorebook importer's audit (SCRBRD-120 §4.5: the card and its
--       revisions, a scorecard and who typed it, never a page).
--   Q3  A departed pupil's clinical record (§3): a RESTRICTIVE cut on
--       `injury`, false for a pupil who has left the row's school unless the
--       reader is the office (player.profile.manage, school-wide) or reaches
--       him through a live guardian or self link. A re-enrolment (an open
--       membership at that school) reopens the physio's read on the next
--       statement. ACCOUNT_LIFECYCLE Q9 governs; its note, rating and
--       discipline tiers are its own slice 4.
--   Q5  The coach and conduct (§6b; Kameel, 21 Oct 2026, through the Build
--       Board: "own side, logged"): discipline.side.read opens
--       side_discipline_records(), the records of the boys on the coach's
--       own side (his assignment's team against each boy's CURRENT side, so a
--       boy moved at the rollover takes his record to his new coach), every
--       read logged. No coach holds discipline.read. A departed boy's record
--       is not his (ACCOUNT_LIFECYCLE Q9). The parent waits (Q15).
--   Q7  public_name_consent_set() and public_name_facts() (§4): a pupil's
--       own "no" from his twelfth birthday, which stands whatever a guardian
--       says; his "yes" still counts from eighteen.
--   Q8  The `compromise` notice kind (§5): the kind CHECK, its life (two
--       years, with the register), and SG-9: a notice addressed to one pupil
--       is the system's own, or a `compromise` notice to a pupil of eighteen
--       or more. `system` is unchanged (a pupil of any age reads the system's
--       own word to him, as db/57, db/65 and db/77 write it).
--   Q10 The league and conduct (§6): competitionadmin loses discipline.read;
--       competition.discipline.read opens competition_discipline_records(),
--       the records whose fixture is in a competition it organises, every
--       read logged in the child's school's log.
--   Q11 A concern about the other school's child (§7):
--       safeguarding_concern_raise() takes a boy on the other side's sheet of
--       a fixture between the two schools; the concern is held by HIS school's
--       DSO, and the reporter's own DSO is told one exists, with no name.
--   Q12 The transport coordinator (§8): transportcoordinator loses
--       player.emergency.read; transport.manifest.read opens trip_contacts()
--       for a trip he coordinates (transport.manage over its fixture), on the
--       day it runs. The API logs every manifest read that returns a number
--       (RESTRICTED_FIELDS.trip_contacts), as it always has.
--   Q13 A pupil who scores (§9): what a FIXTURE-SCOPED player.profile.read
--       reaches is cut, for a reader who is a pupil, to the sheet: the boys
--       named on a fixture's match_squad, their names, order and styles. Not
--       the school's roster, honours, side history, milestones, the training
--       register, kit, passports or scouting consents. His own side's reach,
--       through his `player` role, and his own record are untouched.
--   Q16 A child's ID number (§1): selfaccess loses player.identity.read.
--   A1  The passport (§9b; the red-team audit of 21 Oct 2026, finding A1,
--       through the lead): passport() no longer carries a boy's skill
--       ratings or the coach who gave them (GA-I26a: a judgement stays with
--       the adults who made it; Kameel's confirmation of dropping rather than
--       gating them is asked for); passport_open() is his family, a coach or
--       the office at his school, and the office or a coach at a school his
--       family named — never a team-mate, a pupil, a parent or anybody else
--       who merely holds player.profile.read; and passport(), passport_name(),
--       passport_open() and trip_contacts() are the application's to call,
--       not PUBLIC's (A5).
--
--   Q4, Q9: no code (the code stands). Q14: no route serves a pupil the log
--   (selfaccess holds no audit.read; separation.test.mjs holds it). Q15: the
--   guardian bundle holds no discipline.read; nothing here gives a parent a
--   disciplinary record. HELD, not built: the guardian's player.identity.read
--   (Q16's other half).
--
-- db/01 and db/09 do not move: services/api/rls/generate-rls.mjs records the
-- three withdrawals (WITHDRAWN_SINCE_01) and the two new capabilities
-- (ADDED_SINCE_01), and rls.test.mjs holds this file to both.


-- ── 0 · What this file stands on ───────────────────────────────────
DO $needs$
BEGIN
  IF to_regprocedure('school_register_rows(uuid,text)') IS NULL
     OR to_regprocedure('public_name_facts(uuid,text,date)') IS NULL
     OR to_regprocedure('trip_contacts(uuid)') IS NULL
     OR to_regprocedure('notification_life(text,text,uuid,timestamptz)') IS NULL
     OR to_regprocedure('person_is_pupil(uuid)') IS NULL
     OR to_regprocedure('competition_organiser(uuid)') IS NULL
     OR to_regclass('account_status_change') IS NULL
     OR to_regclass('role_assignment_ending') IS NULL THEN
    RAISE EXCEPTION 'db/116: db/47, db/57, db/61, db/62, db/77, db/89, db/90 or db/92 is missing; apply them first';
  END IF;
END $needs$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · Q16, Q10, Q12, Q5: the bundles
-- ══════════════════════════════════════════════════════════════════
-- Q16: a child's own ID number is never drawn on his screen; the office
-- meets his right of access on request. His guardian's read is held.
DELETE FROM role_capability WHERE role = 'selfaccess' AND capability = 'player.identity.read';
-- Q12: no standing school-wide read of every family's numbers.
DELETE FROM role_capability WHERE role = 'transportcoordinator' AND capability = 'player.emergency.read';
-- Q10: no standing read of a school's conduct file.
DELETE FROM role_capability WHERE role = 'competitionadmin' AND capability = 'discipline.read';

-- The three narrow doors: the catalogue row and one role_capability row per
-- holder in roles.mjs (ADDED_SINCE_01; rls.test.mjs holds the list to the
-- model). No table policy names either; each opens one function below.
INSERT INTO capability (name) VALUES ('competition.discipline.read') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('superadmin',       'competition.discipline.read'),
  ('competitionadmin', 'competition.discipline.read')
ON CONFLICT DO NOTHING;
INSERT INTO capability (name) VALUES ('discipline.side.read') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('superadmin', 'discipline.side.read'),
  ('coach',      'discipline.side.read')
ON CONFLICT DO NOTHING;
INSERT INTO capability (name) VALUES ('transport.manifest.read') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('superadmin',           'transport.manifest.read'),
  ('transportcoordinator', 'transport.manifest.read')
ON CONFLICT DO NOTHING;


-- ══════════════════════════════════════════════════════════════════
-- §2 · Q2: audit.read opens the log and nothing else
-- ══════════════════════════════════════════════════════════════════
-- The DSO holds audit.read to answer "who read this child's record"
-- (SAFEGUARDING_DSO §2), and so does the office. Neither reads why a role
-- was ended, why an account was disabled, why a ball was amended, or the
-- staff register, by standing: each stays with the act that wrote it. The
-- log itself (audit_log(), db/80) still lists every one of those acts —
-- who, when, which — without a word of the reason.

-- scoring_amendment: db/02's, without its audit.read arm. The reason and the
-- decider's note are read by the requester and by whoever may decide the
-- match (GA-I36 D9's audience, less the auditor).
DROP POLICY IF EXISTS scoring_amendment_read ON scoring_amendment;
CREATE POLICY scoring_amendment_read ON scoring_amendment
  FOR SELECT USING (
    requested_by = app_user_id()
    OR app_can('scoring.amend.approve', scoring_amendment.school_id,
               match_team(scoring_amendment.match_id), NULL, scoring_amendment.match_id)
  );

-- role_assignment_ending: db/77's, without its audit.read arm. The reason is
-- the office's words about a person (a hearing, a complaint).
DROP POLICY IF EXISTS role_assignment_ending_read ON role_assignment_ending;
CREATE POLICY role_assignment_ending_read ON role_assignment_ending
  FOR SELECT USING (app_can('user.role.assign', school_id, team_code, NULL, NULL));

-- account_status_change: db/90's, without its audit.read arm (ACCOUNT_LIFECYCLE,
-- "Changed 21 Oct 2026": the disable reason under user.invite only). Never the
-- person it is about.
DROP POLICY IF EXISTS account_status_change_read ON account_status_change;
CREATE POLICY account_status_change_read ON account_status_change
  FOR SELECT USING (
    coalesce(user_id <> app_user_id(), false)
    AND app_can('user.invite', school_id, '*'::text,
                '00000000-0000-0000-0000-000000000000'::uuid,
                '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- school_register_rows(): db/92's, without the auditor's door (SCRBRD-140
-- P2-D14, "Changed 21 Oct 2026": user.role.assign at the school, through
-- functions; never the claimant, a pad or the public). Everything else is
-- db/92's, line for line.
CREATE OR REPLACE FUNCTION school_register_rows(p_school uuid, p_state text DEFAULT NULL)
RETURNS TABLE (id uuid, name text, email text, role text, team_code text, valid_until date,
               state text, uploaded_by uuid, uploaded_by_name text, uploaded_at timestamptz, upload_id uuid,
               warned_ended_on date, claimed_at timestamptz, claimed_by uuid, claimed_by_name text,
               outcome text, outcome_reason text, claimed_request uuid,
               withdrawn_at timestamptz, withdrawn_by_name text, redacted_at timestamptz) AS $$
  SELECT r.id, r.name, r.email, r.role, r.team_code, r.valid_until, s.state,
         r.uploaded_by, ub.name, r.uploaded_at, r.upload_id, r.warned_ended_on,
         r.claimed_at, r.claimed_by, cb.name, r.outcome, r.outcome_reason, r.claimed_request,
         r.withdrawn_at, wb.name, r.redacted_at
    FROM school_register r
    CROSS JOIN LATERAL (SELECT CASE WHEN r.withdrawn_at IS NOT NULL THEN 'withdrawn'
                                    WHEN r.claimed_at   IS NOT NULL THEN 'claimed'
                                    WHEN r.valid_until < current_date THEN 'expired'
                                    ELSE 'open' END AS state) s
    LEFT JOIN app_user ub ON ub.id = r.uploaded_by
    LEFT JOIN app_user cb ON cb.id = r.claimed_by
    LEFT JOIN app_user wb ON wb.id = r.withdrawn_by
   WHERE r.school_id = p_school
     AND app_user_id() IS NOT NULL AND NOT app_pad_scoped()
     AND app_can('user.role.assign', p_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     AND (p_state IS NULL OR s.state = p_state)
   ORDER BY r.uploaded_at DESC, r.name, r.id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/92's and CREATE OR REPLACE keeps them.


-- ══════════════════════════════════════════════════════════════════
-- §3 · Q3: a departed pupil's clinical record
-- ══════════════════════════════════════════════════════════════════
-- "Departed" is read from the record that already says it: team_membership.
-- He has left the row's school when he has a membership there and none of
-- them is open today. A boy with no membership at all (an import not yet
-- placed) has not left anything. A transfer is a departure from the old
-- school: Westville's open membership does not reopen Hilton's injuries to
-- Hilton's physio. A new open membership at Hilton does, on the next
-- statement (READERS Q3: "a re-enrolment reopens the physio's read").
-- Definer: the reader may not read team_membership. It answers one bit.
CREATE OR REPLACE FUNCTION player_departed_from(p_player uuid, p_school uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM team_membership m WHERE m.player_id = p_player AND m.school_id = p_school)
     AND NOT EXISTS (SELECT 1 FROM team_membership m
                      WHERE m.player_id = p_player AND m.school_id = p_school
                        AND (m.left_on IS NULL OR m.left_on > sa_today()))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Does the reader reach this child through a live guardian or self link, in
-- app_can()'s terms (db/47's public_name_live_link())? About the reader
-- alone, and only one bit.
CREATE OR REPLACE FUNCTION reader_linked_to(p_player uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL
     AND (EXISTS (SELECT 1 FROM public_name_live_link(app_user_id(), p_player, 'guardian'))
          OR EXISTS (SELECT 1 FROM public_name_live_link(app_user_id(), p_player, 'selfaccess')))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- RESTRICTIVE, beside injury_read (db/09), which stays: it only narrows. The
-- office is player.profile.manage held school-wide (team NULL, so a
-- side-scoped holder is not the office), ACCOUNT_LIFECYCLE Q9's own words.
DROP POLICY IF EXISTS injury_departed_cut ON injury;
CREATE POLICY injury_departed_cut ON injury AS RESTRICTIVE
  FOR SELECT USING (
    NOT player_departed_from(injury.player_id, injury.school_id)
    OR app_can('player.profile.manage', injury.school_id, NULL::text,
               '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
    OR reader_linked_to(injury.player_id)
  );


-- ══════════════════════════════════════════════════════════════════
-- §4 · Q7: a pupil's own "no", from twelve
-- ══════════════════════════════════════════════════════════════════
-- PUBLIC_DATA C1 and C4 (Changed 21 Oct 2026): "From his twelfth birthday a
-- pupil may refuse his own name on public pages; his refusal stands whatever
-- a guardian says. His 'yes' counts from eighteen." db/62's two functions,
-- each with one change:
--
--   public_name_consent_set(): the pupil's own branch takes a "no" from his
--     twelfth birthday (recorded as a refusal that begins and ends the day
--     it is made, as a guardian's "no" with nothing open is); a "yes" before
--     eighteen is refused as before, not_yet_eighteen; a "no" before twelve
--     is refused, not_yet_twelve. An unknown date of birth is neither.
--   public_name_facts(): that refusal is competent. publicName() already lets
--     his own competent records govern over his guardians' (public.mjs C6:
--     "his own 'no' outweighs a guardian's 'yes' still on file"), so his
--     refusal stands against an older and a later guardian's yes alike, until
--     he himself says yes from eighteen.
CREATE OR REPLACE FUNCTION public_name_consent_set(
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
  v_today  date := sa_today();
  v_open   public_name_consent%ROWTYPE;
BEGIN
  IF app_user_id() IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  p_form_name := nullif(btrim(p_form_name), '');
  IF p_yes IS NULL THEN RETURN QUERY SELECT false, 'no_answer'; RETURN; END IF;
  IF p_version IS NULL OR btrim(p_version) = '' THEN
    RETURN QUERY SELECT false, 'no_consent_version'; RETURN;
  END IF;
  SELECT p.school_id, p.born INTO v_school, v_born FROM player p WHERE p.id = p_player;
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;

  IF p_guardian IS NULL THEN
    -- The caller answers for himself. A form is the office's evidence, not his.
    IF p_form_name IS NOT NULL OR p_form_date IS NOT NULL THEN
      RETURN QUERY SELECT false, 'form_is_for_the_office'; RETURN;
    END IF;
    SELECT l.assignment_id, l.link_id INTO v_asg, v_link
      FROM public_name_live_link(app_user_id(), p_player, 'guardian') l;
    IF v_link IS NOT NULL THEN
      -- From his eighteenth birthday a guardian may take his name off while
      -- he is at school, and never put it on (option C).
      IF v_born IS NOT NULL AND majority_on(v_born) <= v_today THEN
        IF p_yes THEN RETURN QUERY SELECT false, 'adult_consents_for_himself'; RETURN; END IF;
        IF NOT still_at_school(p_player) THEN
          RETURN QUERY SELECT false, 'player_is_an_adult'; RETURN;
        END IF;
      END IF;
      v_by := 'guardian';
    ELSE
      SELECT l.assignment_id, l.link_id INTO v_asg, v_link
        FROM public_name_live_link(app_user_id(), p_player, 'selfaccess') l;
      IF v_link IS NULL THEN RETURN QUERY SELECT false, 'not_permitted'; RETURN; END IF;
      -- His "yes" counts from eighteen; his "no" from twelve (READERS Q7). An
      -- unknown date of birth is neither.
      IF p_yes AND (v_born IS NULL OR majority_on(v_born) > v_today) THEN
        RETURN QUERY SELECT false, 'not_yet_eighteen'; RETURN;
      END IF;
      IF NOT p_yes AND (v_born IS NULL OR (v_born + interval '12 years')::date > v_today) THEN
        RETURN QUERY SELECT false, 'not_yet_twelve'; RETURN;
      END IF;
      v_by := 'pupil';
    END IF;
  ELSE
    IF NOT app_can('guardian.link.manage', v_school, '*'::text,
                   '00000000-0000-0000-0000-000000000000'::uuid,
                   '00000000-0000-0000-0000-000000000000'::uuid) THEN
      RETURN QUERY SELECT false, 'not_permitted'; RETURN;
    END IF;
    SELECT l.assignment_id, l.link_id INTO v_asg, v_link
      FROM public_name_live_link(p_guardian, p_player, 'guardian') l;
    IF v_link IS NULL THEN RETURN QUERY SELECT false, 'no_verified_link'; RETURN; END IF;
    -- The office records her answer by the same rule as her own (option C).
    IF v_born IS NOT NULL AND majority_on(v_born) <= v_today THEN
      IF p_yes THEN RETURN QUERY SELECT false, 'adult_consents_for_himself'; RETURN; END IF;
      IF NOT still_at_school(p_player) THEN
        RETURN QUERY SELECT false, 'player_is_an_adult'; RETURN;
      END IF;
    END IF;
    IF (p_form_name IS NULL) <> (p_form_date IS NULL)
       OR (p_yes AND p_form_name IS NULL) THEN
      RETURN QUERY SELECT false, 'form_required'; RETURN;
    END IF;
    IF p_form_date > v_today THEN RETURN QUERY SELECT false, 'form_in_future'; RETURN; END IF;
    v_by := 'guardian';
  END IF;

  SELECT * INTO v_open FROM public_name_consent c
   WHERE c.player_id = p_player AND c.giver_link_id = v_link AND c.ended_on IS NULL
   FOR UPDATE;

  IF p_yes THEN
    IF FOUND AND v_open.version = p_version THEN
      RETURN QUERY SELECT false, 'already_given'; RETURN;
    END IF;
    IF FOUND THEN
      UPDATE public_name_consent
         SET ended_on = v_today, end_reason = 'superseded', ended_by = app_user_id(), ended_at = now()
       WHERE id = v_open.id;
    END IF;
    INSERT INTO public_name_consent
      (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on,
       form_name, form_date, recorded_by)
    VALUES (p_player, v_by, v_asg, v_link, p_version, v_today,
            p_form_name, p_form_date, app_user_id());
  ELSIF FOUND THEN
    UPDATE public_name_consent
       SET ended_on = v_today, end_reason = 'withdrawn', ended_by = app_user_id(), ended_at = now()
     WHERE id = v_open.id;
  ELSE
    INSERT INTO public_name_consent
      (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on, ended_on,
       end_reason, form_name, form_date, recorded_by, ended_by, ended_at)
    VALUES (p_player, v_by, v_asg, v_link, p_version, v_today, v_today,
            'refused', p_form_name, p_form_date, app_user_id(), app_user_id(), now());
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/47's and CREATE OR REPLACE keeps them.

CREATE OR REPLACE FUNCTION public_name_facts(p_player uuid, p_side text DEFAULT NULL,
                                             p_on date DEFAULT sa_today())
RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'consents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'by',        x.given_by,
               'competent', x.competent,
               'givenOn',   to_char(x.given_on, 'YYYY-MM-DD'),
               'endedOn',   to_char(x.ended_on, 'YYYY-MM-DD'))
             ORDER BY x.given_on, x.seq)
        FROM (
          SELECT DISTINCT ON (c.giver_link_id)
                 c.seq, c.given_by, c.given_on, c.ended_on,
                 coalesce(
                   g.verification_state = 'verified'
                   AND g.valid_from <= c.given_on
                   AND (g.valid_until IS NULL OR g.valid_until > c.given_on)
                   AND g.verified_at IS NOT NULL
                   AND (g.verified_at AT TIME ZONE 'Africa/Johannesburg')::date <= c.given_on
                   AND CASE c.given_by
                         WHEN 'guardian' THEN a.role = 'guardian' AND g.relationship IS DISTINCT FROM 'self'
                                              AND (p.born IS NULL OR c.given_on < majority_on(p.born)
                                                   OR (c.end_reason = 'refused' AND c.ended_on = c.given_on
                                                       AND EXISTS (
                                                         SELECT 1 FROM team_membership m
                                                           JOIN school s ON s.id = m.school_id AND s.kind = 'school'
                                                          WHERE m.player_id = p.id
                                                            AND m.joined_on <= c.given_on
                                                            AND (m.left_on IS NULL OR m.left_on > c.given_on))))
                         -- His own: anything from eighteen; a refusal from
                         -- twelve (READERS Q7).
                         WHEN 'pupil'    THEN a.role = 'selfaccess' AND g.relationship = 'self'
                                              AND p.born IS NOT NULL
                                              AND (majority_on(p.born) <= c.given_on
                                                   OR (c.end_reason = 'refused' AND c.ended_on = c.given_on
                                                       AND (p.born + interval '12 years')::date <= c.given_on))
                       END, false) AS competent
            FROM public_name_consent c
            JOIN assignment_subject g ON g.id = c.giver_link_id AND g.assignment_id = c.giver_assignment_id
                                     AND g.player_id = c.player_id
            JOIN role_assignment a ON a.id = c.giver_assignment_id
           WHERE c.player_id = p.id
           ORDER BY c.giver_link_id, c.seq DESC
        ) x), '[]'::jsonb),
    'neverPublic', EXISTS (
      SELECT 1 FROM player_never_public m
       WHERE m.player_id = p.id AND (m.ended_on IS NULL OR m.ended_on > p_on)),
    'namesOff', EXISTS (
      SELECT 1 FROM public_names_off o
       WHERE o.school_id = p.school_id AND o.names_off
         AND (o.age_group IN (birth_age_group(p.born, p_on), team_age_group(p.team_code), team_age_group(p_side))
              OR p.born IS NULL)))
    FROM player p
   WHERE p.id = p_player
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/47's and CREATE OR REPLACE keeps them.


-- ══════════════════════════════════════════════════════════════════
-- §5 · Q8: the `compromise` notice, and SG-9
-- ══════════════════════════════════════════════════════════════════
-- INCIDENTS_AND_BREACHES D9: a notice that a child's data was, or may have
-- been, seen by somebody who should not have seen it. Written by the
-- register's compromise_notify() (not built yet: INCIDENTS A1), one row per
-- live verified guardian, and to the pupil of eighteen or more as his own
-- data subject. Never retracted (notification_retract() refuses every word
-- for it: it is not a recognition, welfare or fixture notice, and it is never
-- a retraction itself); lives two years, with the register.
--
-- The same list as packages/policy/src/notifications.mjs KINDS;
-- packages/policy/test/notifications.test.mjs reads the latest file that
-- writes this constraint and fails if the two disagree.
DO $kind$
DECLARE v_outside text;
BEGIN
  ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_kind_known;
  ALTER TABLE notification ADD CONSTRAINT notification_kind_known
    CHECK (kind IN ('injury', 'recognition', 'welfare', 'safeguarding', 'system', 'availability', 'fixture', 'lift', 'notice', 'compromise')) NOT VALID;
  SELECT string_agg(format('%L (%s)', x.kind, x.n), ', ' ORDER BY x.kind) INTO v_outside
    FROM (SELECT kind, count(*) AS n FROM notification
           WHERE kind NOT IN ('injury', 'recognition', 'welfare', 'safeguarding', 'system', 'availability', 'fixture', 'lift', 'notice', 'compromise')
           GROUP BY kind) x;
  IF v_outside IS NULL THEN
    ALTER TABLE notification VALIDATE CONSTRAINT notification_kind_known;
  ELSE
    RAISE WARNING 'db/116: stored notices outside D1''s kinds: %. They stay as written and the CHECK stays NOT VALID (it holds every new row), as db/89 left it.', v_outside;
  END IF;
END $kind$;

-- db/89's notification_life(), with the one arm.
CREATE OR REPLACE FUNCTION notification_life(p_kind text, p_subject_kind text, p_subject uuid, p_from timestamptz)
RETURNS timestamptz AS $$
  SELECT CASE p_kind
    WHEN 'injury'       THEN p_from + interval '90 days'
    WHEN 'recognition'  THEN p_from + interval '180 days'
    WHEN 'welfare'      THEN p_from + interval '30 days'
    WHEN 'safeguarding' THEN p_from + interval '30 days'
    WHEN 'system'       THEN p_from + interval '180 days'
    WHEN 'notice'       THEN p_from + interval '60 days'
    WHEN 'compromise'   THEN p_from + interval '730 days'
    WHEN 'availability' THEN coalesce(fx.starts_at, p_from + interval '30 days')
    WHEN 'fixture'      THEN coalesce(fx.starts_at + interval '7 days', p_from + interval '30 days')
    WHEN 'lift'         THEN coalesce(greatest(lf.meet_at, fx.starts_at) + interval '1 day', p_from + interval '30 days')
    ELSE p_from + interval '30 days' END
    FROM (SELECT (SELECT m.starts_at FROM match m WHERE p_subject_kind = 'match' AND m.id = p_subject) AS starts_at) fx,
         (SELECT (SELECT max(o.meet_at) FROM lift_offer o
                   WHERE p_kind = 'lift' AND p_subject_kind = 'match' AND o.match_id = p_subject) AS meet_at) lf
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_life(text, text, uuid, timestamptz) FROM PUBLIC;

-- A pupil of eighteen or more: every child record the account answers for as
-- himself (app_user.player_id, and the players his live self links name)
-- has a date of birth, and each is eighteen today; and there is at least
-- one. An unknown date of birth is not eighteen. Internal.
CREATE OR REPLACE FUNCTION person_pupil_of_age(p_person uuid) RETURNS boolean AS $$
  WITH his AS (
    SELECT u.player_id AS player_id FROM app_user u WHERE u.id = p_person AND u.player_id IS NOT NULL
    UNION
    SELECT g.player_id FROM role_assignment a
      JOIN assignment_subject g ON g.assignment_id = a.id AND g.relationship = 'self'
     WHERE a.person_id = p_person AND a.role = 'selfaccess' AND a.active
       AND (a.valid_until IS NULL OR a.valid_until > current_date)
  )
  SELECT EXISTS (SELECT 1 FROM his)
     AND NOT EXISTS (SELECT 1 FROM his h LEFT JOIN player p ON p.id = h.player_id
                      WHERE p.born IS NULL OR majority_on(p.born) > sa_today())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- SG-9 (db/57), with READERS Q8: a notice addressed to one pupil is the
-- system's own, or a `compromise` notice and he is eighteen or more. Under
-- eighteen his guardians are the recipients (INCIDENTS D8, unchanged).
CREATE OR REPLACE FUNCTION notification_recipient_not_pupil() RETURNS trigger AS $$
BEGIN
  IF NEW.recipient_id IS NOT NULL AND NEW.kind IS DISTINCT FROM 'system'
     AND person_is_pupil(NEW.recipient_id)
     AND NOT (NEW.kind = 'compromise' AND person_pupil_of_age(NEW.recipient_id)) THEN
    RAISE EXCEPTION 'a notice addressed to one pupil must be the system''s own, or a compromise notice to a pupil of eighteen or more (SG-9)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- The trigger is db/57's and calls this function by name.


-- ══════════════════════════════════════════════════════════════════
-- §6 · Q10: the league reads its own fixtures' records
-- ══════════════════════════════════════════════════════════════════
-- READERS G1: competitionadmin held discipline.read, and the pilot's league
-- account is platform-wide, so it read every conduct record at every school.
-- Now: the records whose fixture is in a competition the reader organises
-- (competition.discipline.read at competition_organiser(), the same test
-- competition_conditions_manager() asks), the umpire's report on its own
-- match and nothing filed without a fixture. Every call that returns a
-- record writes one access_log row per school whose children it names,
-- under that school, with the watched columns that came back: the
-- disclosure lands in the right school's log. VOLATILE, because it writes
-- the log. p_competition NULL: every competition the reader organises.
CREATE OR REPLACE FUNCTION competition_discipline_records(p_competition uuid DEFAULT NULL)
RETURNS TABLE (id uuid, player_id uuid, full_name text, school_id uuid, school_name text,
               match_id uuid, competition_id uuid, opponent text, starts_at timestamptz,
               occurred_on date, body text, state text, outcome text,
               created_at timestamptz, updated_at timestamptz) AS $$
DECLARE
  r      record;
  v_sch  uuid[] := '{}';
  v_ply  uuid[] := '{}';
  v_out  boolean[] := '{}';
  s      uuid;
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped() THEN RETURN; END IF;
  FOR r IN
    SELECT d.id, d.player_id, p.full_name, d.school_id, sc.name AS school_name,
           d.match_id, m.competition_id, m.opponent, m.starts_at,
           d.occurred_on, d.body, d.state, d.outcome, d.created_at, d.updated_at
      FROM disciplinary_record d
      JOIN match m ON m.id = d.match_id
      JOIN player p ON p.id = d.player_id
      JOIN school sc ON sc.id = d.school_id
     WHERE m.competition_id IS NOT NULL
       AND (p_competition IS NULL OR m.competition_id = p_competition)
       AND app_can('competition.discipline.read', competition_organiser(m.competition_id), '*'::text,
                   '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     ORDER BY d.occurred_on DESC, d.created_at DESC, d.id
  LOOP
    id := r.id; player_id := r.player_id; full_name := r.full_name; school_id := r.school_id;
    school_name := r.school_name; match_id := r.match_id; competition_id := r.competition_id;
    opponent := r.opponent; starts_at := r.starts_at; occurred_on := r.occurred_on; body := r.body;
    state := r.state; outcome := r.outcome; created_at := r.created_at; updated_at := r.updated_at;
    v_sch := v_sch || r.school_id; v_ply := v_ply || r.player_id; v_out := v_out || (r.outcome IS NOT NULL);
    RETURN NEXT;
  END LOOP;
  -- One row per school, naming its children and the watched columns that
  -- came back (the API's RESTRICTED_FIELDS.disciplinary_records: body, outcome).
  FOR s IN SELECT DISTINCT u.sc FROM unnest(v_sch) u(sc) LOOP
    PERFORM log_restricted_read('competition_discipline_records',
      (SELECT array_agg(DISTINCT x.pl ORDER BY x.pl) FROM unnest(v_sch, v_ply) x(sc, pl) WHERE x.sc = s),
      CASE WHEN EXISTS (SELECT 1 FROM unnest(v_sch, v_out) x(sc, ou) WHERE x.sc = s AND x.ou)
           THEN ARRAY['body', 'outcome'] ELSE ARRAY['body'] END,
      s);
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §6b · Q5: the coach reads his own side's conduct records, logged
-- ══════════════════════════════════════════════════════════════════
-- Kameel, 21 Oct 2026: "own side, logged" (SEASON_ROLLOVER keeps the
-- discipline view for the coach; "Coaches now, parents later"). Not
-- discipline.read on the coach's bundle, which db/25's policy would apply to
-- every row it covers: a definer, so this one door is the whole of it. A
-- record is his when the boy is at the record's school, on a side today, and
-- discipline.side.read holds for that school and that side — a coach's
-- assignment names his team, so it is his own side, as the boy stands now: a
-- boy moved at the rollover takes his record to his new coach and leaves his
-- old one. A boy who has left the school is nobody's side (ACCOUNT_LIFECYCLE
-- Q9's cut). Every call that returns a record writes one access_log row per
-- school, naming the boys and the watched columns (body, outcome), as the
-- API's RESTRICTED_FIELDS.disciplinary_records would. VOLATILE: it writes
-- the log. p_player NULL: every boy on his side.
CREATE OR REPLACE FUNCTION side_discipline_records(p_player uuid DEFAULT NULL)
RETURNS TABLE (id uuid, player_id uuid, full_name text, team_code text, school_id uuid, match_id uuid,
               occurred_on date, body text, state text, outcome text,
               created_at timestamptz, updated_at timestamptz) AS $$
DECLARE
  r      record;
  v_sch  uuid[] := '{}';
  v_ply  uuid[] := '{}';
  v_out  boolean[] := '{}';
  s      uuid;
BEGIN
  IF app_user_id() IS NULL OR app_pad_scoped() THEN RETURN; END IF;
  FOR r IN
    SELECT d.id, d.player_id, p.full_name, p.team_code, d.school_id, d.match_id,
           d.occurred_on, d.body, d.state, d.outcome, d.created_at, d.updated_at
      FROM disciplinary_record d
      JOIN player p ON p.id = d.player_id
     WHERE (p_player IS NULL OR d.player_id = p_player)
       AND p.team_code IS NOT NULL
       AND p.school_id = d.school_id
       AND NOT player_departed_from(d.player_id, d.school_id)
       AND app_can('discipline.side.read', d.school_id, p.team_code, d.player_id,
                   '00000000-0000-0000-0000-000000000000'::uuid)
     ORDER BY d.occurred_on DESC, d.created_at DESC, d.id
  LOOP
    id := r.id; player_id := r.player_id; full_name := r.full_name; team_code := r.team_code;
    school_id := r.school_id; match_id := r.match_id; occurred_on := r.occurred_on; body := r.body;
    state := r.state; outcome := r.outcome; created_at := r.created_at; updated_at := r.updated_at;
    v_sch := v_sch || r.school_id; v_ply := v_ply || r.player_id; v_out := v_out || (r.outcome IS NOT NULL);
    RETURN NEXT;
  END LOOP;
  FOR s IN SELECT DISTINCT u.sc FROM unnest(v_sch) u(sc) LOOP
    PERFORM log_restricted_read('side_discipline_records',
      (SELECT array_agg(DISTINCT x.pl ORDER BY x.pl) FROM unnest(v_sch, v_ply) x(sc, pl) WHERE x.sc = s),
      CASE WHEN EXISTS (SELECT 1 FROM unnest(v_sch, v_out) x(sc, ou) WHERE x.sc = s AND x.ou)
           THEN ARRAY['body', 'outcome'] ELSE ARRAY['body'] END,
      s);
  END LOOP;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §7 · Q11: a concern about the other school's child
-- ══════════════════════════════════════════════════════════════════
-- db/57's safeguarding_concern_raise(), with READERS G2: a reporter at one
-- school may name a boy of the OTHER school when the boy is on the other
-- side's sheet (match_squad, not withdrawn) of a fixture between the two
-- schools that the reporter may read. Then:
--   * the concern is about HIS school (school_id) and is routed by it
--     (safeguarding_route(), his school's DSOs, or above them): the child's
--     DSO is the one who can act;
--   * an adult named beside him must hold a live appointment at HIS school;
--   * the reporter's own school's DSOs are told that a concern exists, held
--     by the other school's DSO, and nothing else: no child, no reporter, no
--     account (a notice under safeguarding.concern.read at the reporter's
--     school, which db/57's cuts keep to its DSOs);
--   * never under a pad credential (db/50): its fixture.read answers its own
--     match, and a scoring pad is not where a boy of the other side is named.
-- Everything else is db/57's, line for line. The reporter's own school is
-- still the one his assignment must be live at (p_school).
CREATE OR REPLACE FUNCTION safeguarding_concern_raise(
  p_school           uuid,
  p_about_kind       text,
  p_nature           text[],
  p_certainty        text,
  p_account          text,
  p_how_learned      text,
  p_subject_player   uuid    DEFAULT NULL,
  p_subject_person   uuid    DEFAULT NULL,
  p_subject_text     text    DEFAULT NULL,
  p_occurred_on      date    DEFAULT NULL,
  p_occurred_where   text    DEFAULT NULL,
  p_authorities_told text    DEFAULT NULL,
  p_named_ok         boolean DEFAULT false,
  p_preferred_dso    uuid    DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text, reference text, raised_at timestamptz, unheld boolean) AS $$
DECLARE
  v_me      uuid := app_user_id();
  v_nature  text[];
  v_route   record;
  v_player  player%ROWTYPE;
  v_school  uuid := p_school;
  v_id      uuid;
  v_ref     text;
  v_at      timestamptz;
  v_assign  uuid;
  v_alpha   text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  i         integer;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_signed_in', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_school IS NULL OR NOT person_live_at(v_me, p_school) THEN
    RETURN QUERY SELECT false, 'not_your_school', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_about_kind IS NULL OR p_about_kind NOT IN ('child', 'adult', 'leadership', 'dso', 'unknown') THEN
    RETURN QUERY SELECT false, 'about_kind_invalid', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_nature FROM unnest(coalesce(p_nature, '{}')) x WHERE x IS NOT NULL;
  IF v_nature IS NULL OR NOT (v_nature <@ '{psychological,physical,sexual_harassment,sexual_abuse,neglect,bullying,other}'::text[]) THEN
    RETURN QUERY SELECT false, 'nature_invalid', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_certainty IS NULL OR p_certainty NOT IN ('suspicion', 'recognised') THEN
    RETURN QUERY SELECT false, 'certainty_invalid', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_account IS NULL OR length(btrim(p_account)) < 20 OR length(p_account) > 8000 THEN
    RETURN QUERY SELECT false, 'account_length', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_how_learned IS NULL OR p_how_learned NOT IN ('witness', 'told', 'victim', 'anonymous_app', 'other') THEN
    RETURN QUERY SELECT false, 'how_learned_invalid', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  -- A report The Guardian's app passed on is recorded by a DSO (§3.4).
  IF p_how_learned = 'anonymous_app' AND NOT safeguarding_authority('safeguarding.concern.manage', p_school) THEN
    RETURN QUERY SELECT false, 'anonymous_app_is_recorded_by_a_dso', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF (p_subject_text IS NOT NULL AND length(btrim(p_subject_text)) > 500)
  OR (p_occurred_where IS NOT NULL AND length(btrim(p_occurred_where)) > 200)
  OR (p_authorities_told IS NOT NULL AND length(btrim(p_authorities_told)) > 500) THEN
    RETURN QUERY SELECT false, 'too_long', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  IF p_occurred_on IS NOT NULL AND p_occurred_on > sa_today() THEN
    RETURN QUERY SELECT false, 'occurred_in_future', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;
  -- The child. At the reporter's school: one the reporter can already see —
  -- the player read policy's own two arms (db/09 player_read), asked as him.
  -- At the other school (READERS Q11): a boy on the other side's sheet of a
  -- fixture between the two schools that the reporter may read; the concern
  -- is then his school's. The same answer whether the id exists or not.
  IF p_subject_player IS NOT NULL THEN
    SELECT * INTO v_player FROM player p WHERE p.id = p_subject_player;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'child_not_visible', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
    END IF;
    IF v_player.school_id = p_school THEN
      IF NOT (app_can('player.profile.read', v_player.school_id, v_player.team_code, v_player.id,
                      '00000000-0000-0000-0000-000000000000'::uuid)
              OR app_can('player.roster.read', v_player.school_id, '*'::text,
                         '00000000-0000-0000-0000-000000000000'::uuid,
                         '00000000-0000-0000-0000-000000000000'::uuid)) THEN
        RETURN QUERY SELECT false, 'child_not_visible', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
      END IF;
    ELSIF p_about_kind = 'child' AND NOT app_pad_scoped() AND EXISTS (
      SELECT 1 FROM match_squad q JOIN match m ON m.id = q.match_id
       WHERE q.player_id = v_player.id AND NOT q.withdrawn
         AND ((q.side = 'away' AND m.away_school_id = v_player.school_id AND m.school_id = p_school
               AND app_can('fixture.read', m.school_id, coalesce(m.team_code, '*'),
                           '00000000-0000-0000-0000-000000000000'::uuid, m.id))
           OR (q.side IS DISTINCT FROM 'away' AND m.school_id = v_player.school_id AND m.away_school_id = p_school
               AND app_can('fixture.read', m.away_school_id, coalesce(m.away_team_code, '*'),
                           '00000000-0000-0000-0000-000000000000'::uuid, m.id)))) THEN
      v_school := v_player.school_id;
    ELSE
      RETURN QUERY SELECT false, 'child_not_visible', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
    END IF;
  END IF;
  -- The adult: somebody who holds a live appointment at the school the
  -- concern is about.
  IF p_subject_person IS NOT NULL AND NOT person_live_at(p_subject_person, v_school) THEN
    RETURN QUERY SELECT false, 'subject_unknown', NULL::text, NULL::timestamptz, NULL::boolean; RETURN;
  END IF;

  SELECT * INTO v_route FROM safeguarding_route(v_school, p_about_kind, p_subject_person);

  -- The reference: four characters nobody misreads, and the year.
  LOOP
    v_ref := 'SG-';
    FOR i IN 1..4 LOOP
      v_ref := v_ref || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    END LOOP;
    v_ref := v_ref || '-' || to_char(sa_today(), 'YYYY');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM safeguarding_concern c WHERE c.reference = v_ref);
  END LOOP;

  -- A preferred DSO sets who is working it, never who reads it; one who does
  -- not hold it is ignored rather than refused, which would say who does.
  IF p_preferred_dso IS NOT NULL
     AND EXISTS (SELECT 1 FROM dso_people_at(v_route.tenant_id) d
                  WHERE d.person_id = p_preferred_dso AND d.person_id IS DISTINCT FROM p_subject_person) THEN
    v_assign := p_preferred_dso;
  END IF;

  INSERT INTO safeguarding_concern (reference, tenant_id, school_id, about_kind, subject_player_id,
                                    subject_person_id, subject_text, nature, certainty, occurred_on,
                                    occurred_where, account, authorities_told, assigned_to, unheld)
  VALUES (v_ref, v_route.tenant_id, v_school, v_route.about_kind, p_subject_player, p_subject_person,
          nullif(btrim(p_subject_text), ''), v_nature, p_certainty, p_occurred_on,
          nullif(btrim(p_occurred_where), ''), btrim(p_account), nullif(btrim(p_authorities_told), ''),
          v_assign, v_route.unheld)
  RETURNING safeguarding_concern.id, safeguarding_concern.raised_at INTO v_id, v_at;
  INSERT INTO safeguarding_concern_reporter (concern_id, tenant_id, reporter_id, how_learned, named_ok, device_id)
  VALUES (v_id, v_route.tenant_id, v_me, p_how_learned, coalesce(p_named_ok, false), app_device_id());
  INSERT INTO safeguarding_concern_note (concern_id, tenant_id, kind, written_by)
  VALUES (v_id, v_route.tenant_id, 'raised', v_me);

  -- The notice (§3.3): at the holding institution, gated on the capability,
  -- naming nobody. Its publisher is left empty: the notice is the system's.
  -- When the adult it names is himself a DSO there — only when nobody above
  -- could hold it — the notice goes to each of the OTHER DSOs by name
  -- (recipient_id) instead, so the person it is about is not told that
  -- something was raised.
  --
  -- In the app, not on a lock screen: no system-written notice in this
  -- product is pushed yet (fanOut() pushes only what its caller may publish),
  -- and the reporter is not handed the notices' ids to push with.
  IF p_subject_person IS NOT NULL
     AND EXISTS (SELECT 1 FROM dso_people_at(v_route.tenant_id) d WHERE d.person_id = p_subject_person) THEN
    INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability, recipient_id)
    SELECT v_route.tenant_id, 'school', 'safeguarding', 'high', 'A safeguarding concern has been raised',
           'Open SCRBRD to read it. You have 24 hours to inform the NDSO if it is child abuse.',
           'safeguarding.concern.read', d.person_id
      FROM dso_people_at(v_route.tenant_id) d WHERE d.person_id <> p_subject_person;
  ELSE
    INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability)
    VALUES (v_route.tenant_id, 'school', 'safeguarding', 'high', 'A safeguarding concern has been raised',
            'Open SCRBRD to read it. You have 24 hours to inform the NDSO if it is child abuse.',
            'safeguarding.concern.read');
  END IF;
  -- Leadership: the institution above is told that one exists, and where.
  -- Never the record: nothing on the platform lets a union read the account
  -- (SG-5); the referral with p27's four facts is phase 5.
  IF v_route.tell_tenant IS NOT NULL THEN
    INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability)
    VALUES (v_route.tell_tenant, 'school', 'safeguarding', 'high', 'A concern about a school''s leadership',
            format('A concern about the leadership of %s has been raised with the school''s DSO. Contact the school''s DSO.',
                   (SELECT s.name FROM school s WHERE s.id = v_school)),
            'safeguarding.concern.read');
  END IF;
  -- The other school's child (READERS Q11): the reporter's own DSOs are told
  -- that a concern exists and who holds it. No child, no reporter, no account.
  IF v_school <> p_school THEN
    INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability)
    VALUES (p_school, 'school', 'safeguarding', 'medium', 'A concern raised about a child at another school',
            format('Somebody at your school raised a safeguarding concern about a child at %s. It is with that school''s DSO; nothing more is shared here.',
                   (SELECT s.name FROM school s WHERE s.id = v_school)),
            'safeguarding.concern.read');
  END IF;

  -- The raise itself is on the log, filed under the holding institution, so
  -- only its DSOs can see that it happened.
  PERFORM log_restricted_read('safeguarding_concern_raise', ARRAY[v_id], '{}'::text[], v_route.tenant_id);

  RETURN QUERY SELECT true, NULL::text, v_ref, v_at, v_route.unheld;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/57's and CREATE OR REPLACE keeps them.


-- ══════════════════════════════════════════════════════════════════
-- §8 · Q12: the transport coordinator's manifest, on the day
-- ══════════════════════════════════════════════════════════════════
-- db/41's trip_contacts(), with a third path beside the driver's and the
-- per-child one: transport.manifest.read with transport.manage over the
-- trip's fixture (he coordinates it), the trip not cancelled, on the day it
-- runs — from the day it departs to the day it returns, by the clock in
-- Johannesburg. Then the manifest is his: every boy on that trip's squad.
-- Outside those days he reads nothing of it; and he holds no
-- player.emergency.read, so no other path opens it for him either. The
-- driver's path and the per-child path are db/41's, line for line. The read
-- is logged where it always was: the API's RESTRICTED_FIELDS.trip_contacts
-- (phone, phone_alt, email) writes access_log for every read that returns a
-- number, naming the boys.
CREATE OR REPLACE FUNCTION trip_contacts(p_trip uuid)
RETURNS TABLE (player_id uuid, full_name text, priority smallint, name text,
               relationship text, phone text, phone_alt text, email text,
               note text, school_id uuid) AS $$
DECLARE
  t trip%ROWTYPE;
  m match%ROWTYPE;
  v_driver boolean := false;
  v_coord  boolean := false;
  v_from date; v_to date;
  v_day_from date; v_day_to date;
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

  -- READERS Q12: the coordinator, on the day.
  v_day_from := (coalesce(t.depart_at, m.starts_at) AT TIME ZONE 'Africa/Johannesburg')::date;
  v_day_to   := (coalesce(t.return_at, t.depart_at, m.starts_at) AT TIME ZONE 'Africa/Johannesburg')::date;
  v_coord := t.cancelled_at IS NULL
             AND v_day_from IS NOT NULL
             AND sa_today() BETWEEN v_day_from AND greatest(v_day_from, v_day_to)
             AND app_can('transport.manifest.read', t.school_id, coalesce(m.team_code, '*'),
                         '00000000-0000-0000-0000-000000000000'::uuid, m.id)
             AND app_can('transport.manage', t.school_id, coalesce(m.team_code, '*'),
                         '00000000-0000-0000-0000-000000000000'::uuid, m.id);

  RETURN QUERY
    SELECT p.id, p.full_name, c.priority, c.name, c.relationship,
           c.phone, c.phone_alt, c.email, c.note, p.school_id
      FROM match_squad s
      JOIN player p ON p.id = s.player_id
      JOIN emergency_contact c ON c.player_id = p.id AND c.active
     WHERE s.match_id = m.id AND NOT s.withdrawn
       AND p.school_id = t.school_id
       AND (v_driver OR v_coord
            OR app_can('player.emergency.read', p.school_id, p.team_code, p.id,
                       '00000000-0000-0000-0000-000000000000'::uuid))
     ORDER BY p.full_name, c.priority;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/41's and CREATE OR REPLACE keeps them.


-- ══════════════════════════════════════════════════════════════════
-- §9 · Q13: a pupil who scores reads the sheet, not the school
-- ══════════════════════════════════════════════════════════════════
-- WHAT A FIXTURE-SCOPED player.profile.read REACHED (READERS Q13 asked for
-- the list first). A scorer's assignment names one fixture at the host
-- school, and every policy and door below asks player.profile.read with the
-- fixture anchor "any" ('0…0'), which a fixture-scoped assignment satisfies
-- at its school. So a pupil scoring at Hilton read, of every Hilton boy:
--   player              the roster row (player_masked): name, side, squad
--                       number, playing role, styles; masked beyond that
--   honour              colours, awards, and a withdrawn one's reason
--   team_membership     every side he has played for, and when
--   milestone_notice    every fifty and five-for noticed
--   training_attendance the register: present, late, excused
--   equipment_issue     the kit issued to him
--   passport_consent    which school his family has named (as that school)
--   player_scouting_consent  whether his family was asked about scouts
--   recognition()       honours, caps and milestones, in one shape
--   passport_open()     his passport
--   match_squad         the sheet: who is named, in what order
-- The decision: names, order and styles. So for a READER WHO IS A PUPIL, a
-- row reached only through a fixture-scoped assignment is cut, everywhere
-- above but the sheet; and the roster row survives only for a boy named on
-- a sheet the reader may read (the sheet's own anchors, its own fixture),
-- which is what the pad joins for a name and a batting hand.
--
-- HOW, without a role test (ADR 0003). app_can() with a NULL fixture refuses
-- every fixture-scoped assignment and answers exactly as before for every
-- other (db/50: `a.fixture_id IS NULL OR …`). So "reached through a standing
-- assignment" is the same question as each policy, asked with NULL for the
-- fixture. An adult scorer is untouched; a pupil's own side (his `player`
-- role), his own record (selfaccess) and a guardian link he holds are
-- standing assignments and untouched.
--
-- Is the reader a pupil (db/57's person_is_pupil(), SG-9's test)? One bit,
-- about the reader. Asked once per statement in each policy, through a
-- scalar subquery.
CREATE OR REPLACE FUNCTION app_reader_is_pupil() RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND person_is_pupil(app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- May the reader read this boy's sheet row on some fixture: named, not
-- withdrawn, on a match_squad row whose own read policy (db/09
-- match_squad_read: player.profile.read at the side's school and team, on
-- that fixture) admits the reader. Definer, so the sheet is read as the
-- policy asks it and not under the reader's own cut.
CREATE OR REPLACE FUNCTION reader_sees_on_sheet(p_player uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_squad q JOIN match m ON m.id = q.match_id
     WHERE q.player_id = p_player AND NOT q.withdrawn
       AND app_can('player.profile.read',
                   CASE WHEN q.side = 'away' THEN m.away_school_id ELSE m.school_id END,
                   CASE WHEN q.side = 'away' THEN m.away_team_code ELSE m.team_code END,
                   q.player_id, q.match_id))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The roster row. player_read's own two arms (db/09), asked with a NULL
-- fixture, or the sheet.
DROP POLICY IF EXISTS player_pupil_sheet_only ON player;
CREATE POLICY player_pupil_sheet_only ON player AS RESTRICTIVE
  FOR SELECT USING (
    NOT (SELECT app_reader_is_pupil())
    OR app_can('player.profile.read', player.school_id, player.team_code, player.id, NULL::uuid)
    OR app_can('player.roster.read', player.school_id, '*'::text,
               '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
    OR reader_sees_on_sheet(player.id)
  );

-- Each of the rest: its own read policy's arm, asked with a NULL fixture.
DROP POLICY IF EXISTS honour_pupil_standing_only ON honour;
CREATE POLICY honour_pupil_standing_only ON honour AS RESTRICTIVE
  FOR SELECT USING (
    NOT (SELECT app_reader_is_pupil())
    OR app_can('player.profile.read', honour.school_id, player_team(honour.player_id), honour.player_id, NULL::uuid)
  );

DROP POLICY IF EXISTS team_membership_pupil_standing_only ON team_membership;
CREATE POLICY team_membership_pupil_standing_only ON team_membership AS RESTRICTIVE
  FOR SELECT USING (
    NOT (SELECT app_reader_is_pupil())
    OR app_can('player.profile.read', team_membership.school_id, player_team(team_membership.player_id),
               team_membership.player_id, NULL::uuid)
  );

DROP POLICY IF EXISTS milestone_notice_pupil_standing_only ON milestone_notice;
CREATE POLICY milestone_notice_pupil_standing_only ON milestone_notice AS RESTRICTIVE
  FOR SELECT USING (
    NOT (SELECT app_reader_is_pupil())
    OR app_can('player.profile.read', player_school(milestone_notice.player_id), player_team(milestone_notice.player_id),
               milestone_notice.player_id, NULL::uuid)
  );

DROP POLICY IF EXISTS training_attendance_pupil_standing_only ON training_attendance;
CREATE POLICY training_attendance_pupil_standing_only ON training_attendance AS RESTRICTIVE
  FOR SELECT USING (
    NOT (SELECT app_reader_is_pupil())
    OR app_can('player.profile.read',
               (SELECT t.school_id FROM training_session t WHERE t.id = training_attendance.session_id),
               (SELECT t.team_code FROM training_session t WHERE t.id = training_attendance.session_id),
               training_attendance.player_id, NULL::uuid)
  );

DROP POLICY IF EXISTS equipment_issue_pupil_standing_only ON equipment_issue;
CREATE POLICY equipment_issue_pupil_standing_only ON equipment_issue AS RESTRICTIVE
  FOR SELECT USING (
    NOT (SELECT app_reader_is_pupil())
    OR app_can('player.profile.read',
               (SELECT e.school_id FROM equipment e WHERE e.id = equipment_issue.equipment_id),
               player_team(equipment_issue.player_id), equipment_issue.player_id, NULL::uuid)
  );

-- passport_consent: the family's own arm (is_family_of(), db/08) stays whole.
DROP POLICY IF EXISTS passport_consent_pupil_standing_only ON passport_consent;
CREATE POLICY passport_consent_pupil_standing_only ON passport_consent AS RESTRICTIVE
  FOR SELECT USING (
    NOT (SELECT app_reader_is_pupil())
    OR is_family_of(passport_consent.player_id)
    OR app_can('player.profile.read', passport_consent.to_school_id, '*'::text,
               '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
  );

DROP POLICY IF EXISTS player_scouting_consent_pupil_standing_only ON player_scouting_consent;
CREATE POLICY player_scouting_consent_pupil_standing_only ON player_scouting_consent AS RESTRICTIVE
  FOR SELECT USING (
    NOT (SELECT app_reader_is_pupil())
    OR app_can('player.profile.read', player_school(player_scouting_consent.player_id),
               player_team(player_scouting_consent.player_id), player_scouting_consent.player_id, NULL::uuid)
  );

-- The door that asks the same question as a definer (and so past every
-- policy above): recognition(), db/89's, with the one clause.
CREATE OR REPLACE FUNCTION recognition(p_player uuid)
RETURNS TABLE (family text, kind text, label text, value int, season text, on_date date,
               match_id uuid, opponent text, is_public boolean, citation text, ref_id uuid) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM player p WHERE p.id = p_player
                    AND app_can('player.profile.read', p.school_id, p.team_code, p.id,
                                '00000000-0000-0000-0000-000000000000'::uuid)
                    -- READERS Q13: a pupil, through a standing assignment only.
                    AND (NOT app_reader_is_pupil()
                         OR app_can('player.profile.read', p.school_id, p.team_code, p.id, NULL::uuid))) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT 'honour'::text, h.kind, honour_kind_label(h.kind, h.name), NULL::int, (SELECT sn.label FROM season sn WHERE sn.id = h.season_id), h.awarded_on,
           NULL::uuid, NULL::text, h.is_public, h.citation, h.id
      FROM honour h WHERE h.player_id = p_player AND h.withdrawn_at IS NULL
    UNION ALL
    SELECT 'cap', 'cap', c.team_code || ' cap ' || CASE WHEN c.baseline_set THEN '#' || c.cap_no ELSE '#' || c.cap_no || ' (no baseline set)' END
             || ' · ' || c.appearances || ' appearance' || CASE WHEN c.appearances = 1 THEN '' ELSE 's' END,
           c.cap_no, NULL, c.first_on, c.first_match_id, NULL, false, NULL, NULL
      FROM team_cap c WHERE c.player_id = p_player
    UNION ALL
    SELECT 'milestone', ms.kind, milestone_label(ms.kind, ms.value), ms.value, NULL, ms.played_on,
           ms.match_id, ms.opponent, false, NULL, NULL
      FROM player_milestone ms WHERE ms.player_id = p_player
       AND NOT EXISTS (SELECT 1 FROM milestone_notice mn
                        WHERE mn.player_id = ms.player_id AND mn.kind = ms.kind AND mn.match_id = ms.match_id
                          AND mn.innings = coalesce(ms.innings, 0) AND mn.retracted_at IS NOT NULL)
    ORDER BY 6 DESC NULLS LAST, 1;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/08's and CREATE OR REPLACE keeps them.

-- passport_open() is narrowed further in §9b (the red-team's A1), past
-- player.profile.read altogether, which also closes it to a pupil scorer.


-- ══════════════════════════════════════════════════════════════════
-- §9b · The passport: a cricket record, to the people it was made for (A1)
-- ══════════════════════════════════════════════════════════════════
-- WHO MAY OPEN IT. db/08 opened it to every player.profile.read holder over
-- the boy — his team-mates, the scorer, media, the DSO — and, at a school
-- his family named, to every player.profile.read holder there: its pupils,
-- its parents, its scorer. Now:
--   his family                     is_family_of(): his guardians and himself
--   at his own school              a coach of his side or the office: the
--                                  team.select or player.profile.manage of
--                                  an assignment over him, or
--                                  guardian.link.manage at the school (the
--                                  office and its head). A team-mate holds
--                                  none of the three.
--   at a school his family named   that school's office (guardian.link.manage)
--                                  or a coach there (team.select, any side),
--                                  while the consent is live.
-- Every staff test asks with a NULL fixture, so no fixture-scoped
-- assignment (a scorer's, an umpire's) opens it.
CREATE OR REPLACE FUNCTION passport_open(p_player uuid) RETURNS boolean AS $$
  SELECT is_family_of(p_player)
      OR EXISTS (SELECT 1 FROM player p WHERE p.id = p_player
                    AND (app_can('team.select', p.school_id, p.team_code, p.id, NULL::uuid)
                         OR app_can('player.profile.manage', p.school_id, p.team_code, p.id, NULL::uuid)
                         OR app_can('guardian.link.manage', p.school_id, '*'::text,
                                    '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)))
      OR EXISTS (SELECT 1 FROM passport_consent c
                  WHERE c.player_id = p_player AND c.withdrawn_at IS NULL
                    AND (app_can('guardian.link.manage', c.to_school_id, '*'::text,
                                 '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)
                         OR app_can('team.select', c.to_school_id, '*'::text,
                                    '00000000-0000-0000-0000-000000000000'::uuid, NULL::uuid)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- WHAT IT SAYS. db/08's passport(), without its `rating` lines: a coach's
-- scores and his name are a judgement, which READERS §3 H keeps from a
-- team-mate, a parent and another school alike (GA-I26a), and a document the
-- family carries to another school is not where they go. Career, honours,
-- caps and milestones are db/08's, line for line.
CREATE OR REPLACE FUNCTION passport(p_player uuid)
RETURNS TABLE (family text, label text, value text, on_date date, source_school text,
               recorded_by text, confidence text) AS $$
DECLARE p player%ROWTYPE;
BEGIN
  SELECT * INTO p FROM player WHERE id = p_player;
  IF NOT FOUND OR NOT passport_open(p_player) THEN RETURN; END IF;
  RETURN QUERY
    SELECT 'career', 'Batting', b.runs || ' runs in ' || b.innings || ' innings' || coalesce(', average ' || round(b.average, 1), ''),
           NULL::date, (SELECT name FROM school WHERE id = p.school_id), 'the ball log', 'derived'
      FROM (SELECT count(*)::int AS innings, coalesce(sum(i.runs), 0)::int AS runs,
                   CASE WHEN count(*) FILTER (WHERE i.out) > 0 THEN sum(i.runs)::numeric / count(*) FILTER (WHERE i.out) END AS average
              FROM player_innings i WHERE i.player_id = p_player) b WHERE b.innings > 0
    UNION ALL
    SELECT 'career', 'Bowling', w.wickets || ' wickets, ' || w.runs || ' runs conceded', NULL, (SELECT name FROM school WHERE id = p.school_id), 'the ball log', 'derived'
      FROM (SELECT coalesce(sum(f.wickets), 0)::int AS wickets, coalesce(sum(f.runs_conceded), 0)::int AS runs, count(*)::int AS n
              FROM bowler_innings_figures f WHERE f.player_id = p_player) w WHERE w.n > 0
    UNION ALL
    SELECT 'honour', honour_kind_label(h.kind, h.name), (SELECT sn.label FROM season sn WHERE sn.id = h.season_id), h.awarded_on,
           (SELECT name FROM school WHERE id = h.school_id),
           coalesce((SELECT u.name FROM app_user u WHERE u.id = h.awarded_by), 'nobody on record'),
           CASE WHEN h.awarded_by IS NULL THEN 'seeded' ELSE 'verified' END
      FROM honour h WHERE h.player_id = p_player AND h.withdrawn_at IS NULL
    UNION ALL
    SELECT 'cap', c.team_code || ' cap #' || c.cap_no, c.appearances || ' appearance' || CASE WHEN c.appearances = 1 THEN '' ELSE 's' END,
           c.first_on, (SELECT name FROM school WHERE id = c.school_id), 'the team sheets', 'derived'
      FROM team_cap c WHERE c.player_id = p_player
    UNION ALL
    SELECT 'milestone', milestone_label(m.kind, m.value), 'v ' || coalesce(m.opponent, '?'), m.played_on,
           (SELECT name FROM school WHERE id = p.school_id), 'the ball log', 'derived'
      FROM player_milestone m WHERE m.player_id = p_player
    ORDER BY 1, 4 DESC NULLS LAST, 2;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- passport_name(): db/08's, with its search path pinned (db/16's rule).
CREATE OR REPLACE FUNCTION passport_name(p_player uuid) RETURNS text AS $$
  SELECT full_name FROM player WHERE id = p_player AND passport_open(p_player)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A5: the application's to call, not PUBLIC's.
DO $passport_grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['passport(uuid)', 'passport_name(uuid)', 'passport_open(uuid)', 'trip_contacts(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $passport_grants$;


-- ══════════════════════════════════════════════════════════════════
-- §10 · Who may call the new functions
-- ══════════════════════════════════════════════════════════════════
-- The application, whose policies ask them (or which reads through them).
-- Not PUBLIC, nor a managed host's API roles. person_pupil_of_age() is the
-- trigger's alone.
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['player_departed_from(uuid,uuid)', 'reader_linked_to(uuid)',
                           'app_reader_is_pupil()', 'reader_sees_on_sheet(uuid)',
                           'competition_discipline_records(uuid)', 'side_discipline_records(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
  REVOKE ALL ON FUNCTION person_pupil_of_age(uuid) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION person_pupil_of_age(uuid) FROM %I', r);
      FOREACH f IN ARRAY ARRAY['school_register_rows(uuid,text)',
                               'public_name_consent_set(uuid,boolean,text,uuid,text,date)',
                               'public_name_facts(uuid,text,date)', 'notification_life(text,text,uuid,timestamptz)',
                               'notification_recipient_not_pupil()', 'trip_contacts(uuid)',
                               'recognition(uuid)', 'passport_open(uuid)',
                               'safeguarding_concern_raise(uuid,text,text[],text,text,text,uuid,uuid,text,date,text,text,boolean,uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
-- §11 · Refuse to commit a file that did not do what it says
-- ══════════════════════════════════════════════════════════════════
DO $check$
DECLARE f text; n int;
BEGIN
  -- §1: the bundles.
  IF EXISTS (SELECT 1 FROM role_capability WHERE (role, capability) IN
               (('selfaccess', 'player.identity.read'), ('transportcoordinator', 'player.emergency.read'),
                ('competitionadmin', 'discipline.read'))) THEN
    RAISE EXCEPTION 'db/116: a withdrawn grant is still held';
  END IF;
  IF (SELECT count(*) FROM role_capability
       WHERE capability IN ('competition.discipline.read', 'transport.manifest.read', 'discipline.side.read')) <> 6 THEN
    RAISE EXCEPTION 'db/116: the three new capabilities are not held by exactly their six rows';
  END IF;
  IF EXISTS (SELECT 1 FROM role_capability WHERE role IN ('coach', 'assistantcoach', 'guardian') AND capability = 'discipline.read') THEN
    RAISE EXCEPTION 'db/116: a coach or a parent holds discipline.read';
  END IF;

  -- §2, Q2: no read policy names audit.read but the log's (access_log), the
  -- pen's (scoring_audit), the support sessions' and the scorebook audit's.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL') AND qual LIKE '%audit.read%'
     AND (tablename, policyname) NOT IN (('access_log', 'access_log_read'), ('scoring_audit', 'audit_read'),
                                         ('support_access', 'support_access_read'),
                                         ('scorebook_import', 'scorebook_import_read'),
                                         ('scorebook_import_revision', 'scorebook_import_revision_read'));
  IF n <> 0 THEN
    RAISE EXCEPTION 'db/116: % read polic(ies) still name audit.read beside a reason', n;
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'school_register_rows(uuid,text)'::regprocedure) LIKE '%audit.read%' THEN
    RAISE EXCEPTION 'db/116: school_register_rows() still opens to audit.read';
  END IF;

  -- §3, §9: the RESTRICTIVE cuts.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
     AND policyname IN ('injury_departed_cut', 'player_pupil_sheet_only', 'honour_pupil_standing_only',
                        'team_membership_pupil_standing_only', 'milestone_notice_pupil_standing_only',
                        'training_attendance_pupil_standing_only', 'equipment_issue_pupil_standing_only',
                        'passport_consent_pupil_standing_only', 'player_scouting_consent_pupil_standing_only');
  IF n <> 9 THEN
    RAISE EXCEPTION 'db/116: % of the nine RESTRICTIVE cuts are in place', n;
  END IF;

  -- §5: the kind, the life, SG-9.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification'::regclass
                    AND conname = 'notification_kind_known' AND pg_get_constraintdef(oid) LIKE '%compromise%') THEN
    RAISE EXCEPTION 'db/116: notification_kind_known does not take compromise';
  END IF;
  IF notification_life('compromise', 'system', NULL, '2026-01-01 00:00+02') <> '2028-01-01 00:00+02'::timestamptz THEN
    RAISE EXCEPTION 'db/116: a compromise notice does not live two years';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'notification_recipient_not_pupil()'::regprocedure) NOT LIKE '%person_pupil_of_age%' THEN
    RAISE EXCEPTION 'db/116: SG-9 does not admit a compromise notice to a pupil of eighteen';
  END IF;

  -- §9b: no rating on the passport; its doors the application's alone.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'passport(uuid)'::regprocedure) ~ '(player_skill|''rating'')' THEN
    RAISE EXCEPTION 'db/116: passport() still carries a rating';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'passport_open(uuid)'::regprocedure) LIKE '%player.profile.read%' THEN
    RAISE EXCEPTION 'db/116: passport_open() still opens to player.profile.read';
  END IF;
  FOREACH f IN ARRAY ARRAY['passport(uuid)', 'passport_name(uuid)', 'passport_open(uuid)', 'trip_contacts(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/116: % is executable by PUBLIC, or not by scrbrd_app', f;
    END IF;
  END LOOP;

  -- Every function here: SECURITY DEFINER with a pinned search path (db/16).
  FOREACH f IN ARRAY ARRAY['school_register_rows(uuid,text)', 'player_departed_from(uuid,uuid)', 'reader_linked_to(uuid)',
                           'public_name_consent_set(uuid,boolean,text,uuid,text,date)', 'public_name_facts(uuid,text,date)',
                           'notification_life(text,text,uuid,timestamptz)', 'person_pupil_of_age(uuid)',
                           'notification_recipient_not_pupil()', 'competition_discipline_records(uuid)',
                           'side_discipline_records(uuid)',
                           'safeguarding_concern_raise(uuid,text,text[],text,text,text,uuid,uuid,text,date,text,text,boolean,uuid)',
                           'trip_contacts(uuid)', 'app_reader_is_pupil()', 'reader_sees_on_sheet(uuid)',
                           'recognition(uuid)', 'passport_open(uuid)', 'passport(uuid)', 'passport_name(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/116: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;
  -- The new ones: the application's, never PUBLIC; the trigger's helper, nobody's.
  FOREACH f IN ARRAY ARRAY['player_departed_from(uuid,uuid)', 'reader_linked_to(uuid)', 'app_reader_is_pupil()',
                           'reader_sees_on_sheet(uuid)', 'competition_discipline_records(uuid)',
                           'side_discipline_records(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/116: % is executable by PUBLIC, or not by scrbrd_app', f;
    END IF;
  END LOOP;
  IF has_function_privilege('scrbrd_app', 'person_pupil_of_age(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/116: the application can call the internal person_pupil_of_age()';
  END IF;
END $check$;
