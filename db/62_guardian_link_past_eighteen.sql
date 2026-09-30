-- ══════════════════════════════════════════════════════════════════
--  62 · The guardian link past eighteen (SCRBRD-110 phase 0; SCRBRD-083 §6.3)
-- ══════════════════════════════════════════════════════════════════
--
-- docs/design/SCRBRD-110_workload.md §7.4, items 1-4, and §9's phase 0 row.
-- Signed off by Kameel as information officer on 2026-09-28 (§7.4 "Signed
-- off"; SCRBRD-083 §6.4; docs/policy/PUBLIC_DATA.md). The §7.4 fallback is
-- not needed and is not built.
--
-- THE CHANGE, STATED ONCE. A guardian link's valid_until is the later of the
-- child's eighteenth birthday and the day he leaves the school system; while
-- he is at school it is open. "At school" is still_at_school() (db/60): an
-- open team_membership at a tenant whose kind is 'school'. A club, an academy
-- or a union is not the school system, so a club member's link ends on his
-- birthday exactly as before.
--
-- WHAT THIS FILE DOES
--
--   1. guardian_link_establish() (db/08) re-emitted: it writes valid_until
--      NULL while the child is still_at_school(), majority_on(born) otherwise
--      (as before), and STILL REFUSES A NEW LINK FOR AN ADULT
--      (player_is_an_adult). An existing link carries on; a new one is never
--      made for a grown child. Otherwise line for line db/08's, with its
--      search_path pinned as db/16 pinned the original.
--   2. Two triggers on team_membership:
--        CLOSE — a row gets left_on and he has no other open school
--          membership: every open guardian link for him gets
--          valid_until = greatest(left_on, majority_on(born)). A minor who
--          leaves keeps his parent until his birthday, exactly as before; an
--          adult who leaves takes his parent's access with him that day.
--        OPEN — a row opens (inserted open, or its left_on cleared) and he is
--          at school: every guardian link of his that ends on
--          majority_on(born) — in the future, or already passed — and is not
--          otherwise ended is set back to NULL. The boy who comes back, and
--          the boy enrolled after his link was made.
--   3. The data step: open guardian links of pupils still_at_school() get
--      valid_until = NULL, including those db/10 closed on the birthday of a
--      boy still enrolled. db/10 itself does not move.
--   4. SCRBRD-083 §6.3, option C for the public name, which needed this link
--      to mean anything: public_name_consent_set() takes a guardian's "no"
--      after his eighteenth birthday while he is still_at_school(), and
--      refuses her "yes" as adult_consents_for_himself; public_name_facts()
--      counts that "no" as competent. Nothing else in db/47 moves.
--
-- NOTHING WIDENS BY THE CLOCK. The triggers fire on the events that matter —
-- a boy leaving, a boy enrolling — and nothing runs on a schedule. The only
-- statement here that re-opens a link without such an event is the data
-- step, once, for boys enrolled today.
--
-- WHAT A RE-OPEN NEVER TOUCHES. A link that ends on any date but his
-- majority: revoked (valid_until = the day, verification_state 'revoked'),
-- rejected, ended when he left as an adult (the leaving day), ended by db/10
-- for want of a date of birth, or clamped by db/10 to its own start because
-- it was made to someone already grown. A link whose guardian's assignment
-- has ended. And never a second open link to the same child through the
-- same assignment (assignment_subject_one_open_link).
--
-- WHY THE TRIGGERS ARE DEFERRED. A move between sides is two statements
-- inside db/08's player_team_membership_log(): the old row closes, then the
-- new one opens. Judged row by row, the close would see a boy with no open
-- school membership and end an adult pupil's link on the day he was moved
-- from the U19A to the 1st XI — and the open could not honestly re-open a
-- link that ended on the moving day rather than his birthday. Deferred to
-- the end of the transaction, each trigger asks still_at_school() of the
-- state the transaction leaves, which is the question §7.4 asks. db/30's
-- role_assignment_expiry_has_reason is the precedent; db/99 fires them
-- where it needs them with SET CONSTRAINTS ... IMMEDIATE.
--
-- WHERE THIS DIFFERS FROM THE DESIGN'S LETTER, and why
--
--   - The number: the design says db/52; the Laws, safeguarding, workload
--     and conditions work took 52-61.
--   - still_at_school() is not re-emitted: db/60 carries it as §7.4 item 1
--     wrote it, and phase 1 was built to stand on it.
--   - The triggers are deferred constraint triggers (above).
--   - "Not otherwise ended" is read as: verification_state pending or
--     verified, and the guardian's assignment active and not dated out.
--
-- Nothing else changes: app_can(), is_family_of(), player_guardian_status,
-- the consent functions and every other valid_until test keep their code,
-- because "is this link live today" is still what the column says.
-- health_consent_live() (db/60) already reads a guardian's consent through a
-- link live today, so a parent's pre-18 health "yes" now carries on while he
-- is at school with no change to db/60.
--
-- search_path is pinned on every function below (db/16). Safe to run twice.


-- ── 1 · Establishing a link (db/08, re-emitted) ────────────────────
CREATE OR REPLACE FUNCTION guardian_link_establish(
  p_guardian     uuid,
  p_player       uuid,
  p_relationship text DEFAULT 'parent'
) RETURNS TABLE (ok boolean, reason text, assignment uuid) AS $$
DECLARE
  v_school uuid;
  v_team   text;
  v_assign uuid;
  v_born   date;
BEGIN
  v_school := player_school(p_player);
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player', NULL::uuid; RETURN; END IF;

  IF NOT app_can('guardian.link.manage', v_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::uuid; RETURN;
  END IF;

  IF p_guardian = app_user_id() THEN
    RETURN QUERY SELECT false, 'self_created', NULL::uuid; RETURN;
  END IF;

  v_team := player_team(p_player);
  IF EXISTS (SELECT 1 FROM role_assignment a
              WHERE a.person_id = p_guardian
                AND a.active
                AND a.role IN ('coach','assistantcoach','teammanager')
                AND a.school_id = v_school
                AND v_team IS NOT NULL AND a.team_code = v_team) THEN
    RETURN QUERY SELECT false, 'coaches_this_player', NULL::uuid; RETURN;
  END IF;

  -- The child's date of birth decides when this ends, so it is REQUIRED here
  -- rather than assumed. Asked BEFORE the assignment below is reached, because
  -- a plpgsql RETURN is not a rollback (db/08).
  SELECT p.born INTO v_born FROM player p WHERE p.id = p_player;
  IF v_born IS NULL THEN
    RETURN QUERY SELECT false, 'player_date_of_birth_required', NULL::uuid; RETURN;
  END IF;
  -- An existing link carries on past eighteen while he is at school; a NEW
  -- one is never made for an adult, at school or not (§7.4 item 2, Q16).
  IF majority_on(v_born) <= current_date THEN
    RETURN QUERY SELECT false, 'player_is_an_adult', NULL::uuid; RETURN;
  END IF;

  SELECT a.id INTO v_assign
    FROM role_assignment a
   WHERE a.person_id = p_guardian AND a.role = 'guardian'
     AND a.school_id = v_school AND a.active
   LIMIT 1;

  IF v_assign IS NULL THEN
    INSERT INTO role_assignment (person_id, role, school_id, created_by)
    VALUES (p_guardian, 'guardian', v_school, app_user_id())
    RETURNING id INTO v_assign;
  END IF;

  IF EXISTS (SELECT 1 FROM assignment_subject g
              WHERE g.assignment_id = v_assign AND g.player_id = p_player
                AND g.verification_state IN ('pending','verified')
                AND (g.valid_until IS NULL OR g.valid_until > current_date)) THEN
    RETURN QUERY SELECT false, 'already_linked', v_assign; RETURN;
  END IF;

  -- Open while he is at school; his eighteenth birthday otherwise. The
  -- CLOSE trigger below dates it when he leaves.
  INSERT INTO assignment_subject
    (assignment_id, player_id, relationship, created_by, valid_until)
  VALUES (v_assign, p_player, p_relationship, app_user_id(),
          CASE WHEN still_at_school(p_player) THEN NULL ELSE majority_on(v_born) END);

  RETURN QUERY SELECT true, NULL::text, v_assign;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/08's and CREATE OR REPLACE keeps them.


-- ── 2 · The link follows the school (§7.4 item 3) ──────────────────
/**
 * He has left the school system: every open guardian link for him ends on
 * the later of the day he left and his eighteenth birthday. Only ever
 * shortens a link: one already ending sooner keeps its own date. Never before
 * the link began (assignment_subject's own CHECK; db/10's clamp). Internal.
 */
CREATE OR REPLACE FUNCTION guardian_links_close_on_leaving(p_player uuid, p_left_on date)
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  UPDATE assignment_subject s
     SET valid_until = greatest(p_left_on, majority_on(p.born), s.valid_from)
    FROM role_assignment a, player p
   WHERE a.id = s.assignment_id AND a.role = 'guardian'
     AND p.id = s.player_id
     AND s.player_id = p_player
     AND s.verification_state IN ('pending', 'verified')
     AND (s.valid_until IS NULL
          OR s.valid_until > greatest(p_left_on, majority_on(p.born), s.valid_from));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION guardian_links_close_on_leaving(uuid, date) FROM PUBLIC;

/**
 * He is at school: every guardian link of his that ends on his eighteenth
 * birthday — ahead, or already passed — and is not otherwise ended is open
 * again. Not otherwise ended: pending or verified, through a guardian
 * assignment still active and not dated out. A link that ends on any other
 * day (revoked, ended when he left as an adult, clamped by db/10) stays
 * ended. One per guardian per child: never a second open link beside one
 * (assignment_subject_one_open_link). Internal.
 */
CREATE OR REPLACE FUNCTION guardian_links_reopen_at_school(p_player uuid)
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  UPDATE assignment_subject s
     SET valid_until = NULL
   WHERE s.id IN (
     SELECT DISTINCT ON (g.assignment_id, g.player_id) g.id
       FROM assignment_subject g
       JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian'
       JOIN player p ON p.id = g.player_id
      WHERE g.player_id = p_player
        AND g.verification_state IN ('pending', 'verified')
        AND g.valid_until = majority_on(p.born)
        AND a.active
        AND (a.valid_until IS NULL OR a.valid_until > current_date)
        AND NOT EXISTS (SELECT 1 FROM assignment_subject o
                         WHERE o.assignment_id = g.assignment_id AND o.player_id = g.player_id
                           AND o.verification_state IN ('pending', 'verified')
                           AND o.valid_until IS NULL)
      ORDER BY g.assignment_id, g.player_id, g.created_at DESC, g.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION guardian_links_reopen_at_school(uuid) FROM PUBLIC;

/** CLOSE: a membership closed, and he has no other open school membership. */
CREATE OR REPLACE FUNCTION team_membership_closes_guardian_links() RETURNS trigger AS $$
BEGIN
  IF NOT still_at_school(NEW.player_id) THEN
    PERFORM guardian_links_close_on_leaving(NEW.player_id, NEW.left_on);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION team_membership_closes_guardian_links() FROM PUBLIC;

/** OPEN: a membership opened, and he is at school. */
CREATE OR REPLACE FUNCTION team_membership_opens_guardian_links() RETURNS trigger AS $$
BEGIN
  IF still_at_school(NEW.player_id) THEN
    PERFORM guardian_links_reopen_at_school(NEW.player_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION team_membership_opens_guardian_links() FROM PUBLIC;

DROP TRIGGER IF EXISTS team_membership_closes_guardian_links ON team_membership;
CREATE CONSTRAINT TRIGGER team_membership_closes_guardian_links
  AFTER UPDATE OF left_on ON team_membership
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (OLD.left_on IS NULL AND NEW.left_on IS NOT NULL)
  EXECUTE FUNCTION team_membership_closes_guardian_links();

DROP TRIGGER IF EXISTS team_membership_opens_guardian_links ON team_membership;
CREATE CONSTRAINT TRIGGER team_membership_opens_guardian_links
  AFTER INSERT OR UPDATE OF left_on ON team_membership
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.left_on IS NULL)
  EXECUTE FUNCTION team_membership_opens_guardian_links();


-- ── 3 · The data step (§7.4 item 4) ────────────────────────────────
-- Every boy at school today, through the same function the OPEN trigger
-- calls — so the links re-opened here are exactly the ones a fresh
-- enrolment would re-open, and no others. Among them the links db/10 ended
-- on the birthday of a boy still enrolled.
DO $reopen$
DECLARE v_players int := 0; v_links int := 0; v_n int; r record;
BEGIN
  FOR r IN SELECT p.id FROM player p WHERE still_at_school(p.id) LOOP
    v_n := guardian_links_reopen_at_school(r.id);
    IF v_n > 0 THEN v_players := v_players + 1; v_links := v_links + v_n; END IF;
  END LOOP;
  RAISE NOTICE 'db/62: % guardian link(s) of % pupil(s) at school are open while they are at school', v_links, v_players;
END $reopen$;


-- ── 4 · The public name at eighteen: option C (SCRBRD-083 §6.3) ────
/**
 * db/47's public_name_consent_set(), with §6.3 item 1. The guardian's two
 * branches (her own answer, and the office's from her form) no longer refuse
 * every act for a boy of eighteen or more. Instead:
 *
 *   her "yes" on or after his birthday: refused, adult_consents_for_himself —
 *     nobody adult is named on a parent's word; from 18 only he can newly
 *     name himself (the same word db/60 gives a health "yes");
 *   her "no" on or after his birthday while he is still_at_school(): recorded
 *     as before — a withdrawal of her standing consent, or a refusal with
 *     nothing open — because stopping publication needs no lawful basis;
 *   anything else after his birthday: refused, player_is_an_adult, as before.
 *
 * "Still at the school" is still_at_school() (§6.3 left the test to Opus;
 * SCRBRD-110 §7.4 item 1 names it for both designs). Her link must be live
 * for her to be calling at all — which, from his birthday, it is only while
 * he is at school (section 2 above). Everything else is db/47's, line for line.
 */
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
      -- An unknown date of birth is not eighteen.
      IF v_born IS NULL OR majority_on(v_born) > v_today THEN
        RETURN QUERY SELECT false, 'not_yet_eighteen'; RETURN;
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

/**
 * db/47's public_name_facts(), with §6.3 item 2: the guardian arm of
 * `competent` is db/47's (given while he was a child) OR a refusal — a "no"
 * that begins and ends the same day — given while he was at school on that
 * day (an open-on-the-day team_membership at a 'school', the historical form
 * of still_at_school()). Without it, her post-18 refusal would be her most
 * recent act and incompetent, and the OTHER guardian's standing yes would
 * keep naming him; with it, "the latest record governs" (public.mjs) lets
 * her no beat that yes. A post-18 "yes" from a guardian cannot be recorded
 * at all (above) and would stay incompetent if it were. A withdrawal needs
 * nothing: it ends a pre-18 record whose competence is unchanged. His own
 * records still displace hers once he speaks (publicName(), unchanged).
 * The shape is unchanged: consents, neverPublic, namesOff.
 */
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
                         WHEN 'pupil'    THEN a.role = 'selfaccess' AND g.relationship = 'self'
                                              AND p.born IS NOT NULL AND majority_on(p.born) <= c.given_on
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


-- ── Who may call these ─────────────────────────────────────────────
-- The four new functions are the owner's alone (REVOKE above). On a managed
-- host the platform's API roles get EXECUTE on every new function by default
-- privilege, directly and not through PUBLIC (db/29), so it is taken back
-- from them here, as db/47, db/57 and db/60 do. db/47's two functions are
-- re-emitted with their grants kept, and taken back again here for the same
-- reason db/47 gave.
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY[
          'guardian_links_close_on_leaving(uuid,date)', 'guardian_links_reopen_at_school(uuid)',
          'team_membership_closes_guardian_links()', 'team_membership_opens_guardian_links()',
          'public_name_consent_set(uuid,boolean,text,uuid,text,date)',
          'public_name_facts(uuid,text,date)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  t text;
  n int;
  v_def text;
BEGIN
  -- Every function here: SECURITY DEFINER with a pinned search path (db/16).
  FOREACH f IN ARRAY ARRAY['guardian_link_establish(uuid,uuid,text)',
                           'guardian_links_close_on_leaving(uuid,date)', 'guardian_links_reopen_at_school(uuid)',
                           'team_membership_closes_guardian_links()', 'team_membership_opens_guardian_links()',
                           'public_name_consent_set(uuid,boolean,text,uuid,text,date)',
                           'public_name_facts(uuid,text,date)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/62: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;

  -- The internals are the owner's: not PUBLIC, not the application, not a
  -- managed host's API roles.
  FOREACH f IN ARRAY ARRAY['guardian_links_close_on_leaving(uuid,date)', 'guardian_links_reopen_at_school(uuid)',
                           'team_membership_closes_guardian_links()', 'team_membership_opens_guardian_links()'] LOOP
    IF has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/62: the application can call the internal %', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(r.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/62: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  -- db/47's doors are still the application's, and still nobody else's.
  FOREACH f IN ARRAY ARRAY['public_name_consent_set(uuid,boolean,text,uuid,text,date)',
                           'public_name_facts(uuid,text,date)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/62: the application can no longer call %', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/62: % is executable by PUBLIC', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
                  AND has_function_privilege(r.oid, f::regprocedure, 'EXECUTE')) THEN
      RAISE EXCEPTION 'db/62: % is executable by a managed host''s API role', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('scrbrd_app', 'guardian_link_establish(uuid,uuid,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/62: the application can no longer call guardian_link_establish()';
  END IF;

  -- guardian_link_establish() still refuses an adult, and writes the open
  -- link only for a pupil at school.
  v_def := pg_get_functiondef('guardian_link_establish(uuid,uuid,text)'::regprocedure);
  IF v_def NOT LIKE '%''player_is_an_adult''%' OR v_def NOT LIKE '%still_at_school(p_player)%' THEN
    RAISE EXCEPTION 'db/62: guardian_link_establish() does not refuse an adult and open a pupil''s link';
  END IF;

  -- The two triggers, on the events §7.4 names, deferred to the end of the
  -- transaction (a move between sides is a close and an open).
  FOREACH t IN ARRAY ARRAY['team_membership_closes_guardian_links', 'team_membership_opens_guardian_links'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'team_membership'::regclass AND tgname = t AND NOT tgisinternal
                      AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred) THEN
      RAISE EXCEPTION 'db/62: % is not a deferred constraint trigger on team_membership', t;
    END IF;
  END LOOP;

  -- The data step did what it says: no pupil at school still has a link that
  -- ends on his birthday and could be open.
  SELECT count(*) INTO n
    FROM assignment_subject g
    JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian'
    JOIN player p ON p.id = g.player_id
   WHERE g.verification_state IN ('pending', 'verified')
     AND g.valid_until = majority_on(p.born)
     AND a.active AND (a.valid_until IS NULL OR a.valid_until > current_date)
     AND still_at_school(p.id)
     AND NOT EXISTS (SELECT 1 FROM assignment_subject o
                      WHERE o.assignment_id = g.assignment_id AND o.player_id = g.player_id
                        AND o.verification_state IN ('pending', 'verified') AND o.valid_until IS NULL);
  IF n > 0 THEN
    RAISE EXCEPTION 'db/62: % pupil link(s) at school still end on the birthday', n;
  END IF;
  -- And nothing was opened that should not be: an open-ended guardian link
  -- belongs to a minor or to a pupil at school.
  SELECT count(*) INTO n
    FROM assignment_subject g
    JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian'
    JOIN player p ON p.id = g.player_id
   WHERE g.valid_until IS NULL
     AND NOT coalesce(majority_on(p.born) > current_date, false)
     AND NOT still_at_school(p.id);
  IF n > 0 THEN
    RAISE EXCEPTION 'db/62: % guardian link(s) are open-ended for an adult not at school', n;
  END IF;

  -- The facts keep their three keys.
  IF public_name_facts('00000000-0000-0000-0000-000000000000'::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'db/62: public_name_facts() answered for a player who does not exist';
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT DISTINCT k FROM player p, jsonb_object_keys(public_name_facts(p.id)) k) x
   WHERE k NOT IN ('consents', 'namesOff', 'neverPublic');
  IF n > 0 THEN
    RAISE EXCEPTION 'db/62: public_name_facts() carries a key other than consents, namesOff and neverPublic';
  END IF;
END $check$;
