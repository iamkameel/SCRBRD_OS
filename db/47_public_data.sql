-- ══════════════════════════════════════════════════════════════════
--  47 · The records the public-data rule reads (SCRBRD-083, §6 step 2)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/policy/PUBLIC_DATA.md is the decision; the rule in code
-- is packages/policy/src/public.mjs, whose publicName() takes the facts this
-- file stores. Nothing public exists yet: no route, no screen, no signed-out
-- read reads any of this (that is §6 step 3). This file is the records, the
-- doors that write them, who may read them, and the one function a public
-- read will call to learn what the rule needs about a child.
--
-- None of these tables is in packages/policy/src/tables.mjs, on purpose: the
-- generator would emit their policies into db/09, which is frozen. Their
-- policies are here, like db/25's and db/41's.
--
-- WHAT IS HERE, one section each:
--
--   1. player.surname, player.known_as — a stored surname, so "D Erasmus" is
--      read rather than guessed (public.mjs's initialAndSurname() prefers them).
--      Not masked: a surname is no more sensitive than full_name, which is
--      not, so both follow full_name into player_masked unmasked.
--
--   2. public_name_consent — C1, C3, C6. A consent to be named on public
--      pages, per child, from a verified guardian or from the pupil himself
--      at eighteen; recorded by the office from its own admission forms,
--      naming the form and its date. END-DATED, NEVER DELETED, like the
--      guardian link's own consent (assignment_subject), and SEPARATE from
--      that consent: the link's consent governs whether the child is
--      processed at all, this governs whether a stranger may read his name.
--      Written only through public_name_consent_set().
--
--   3. player_never_public — C5. A mark authorised staff set; it overrides
--      every consent. Its REASON lives on the row and the row is readable by
--      nobody but the holders of the capability that sets it,
--      player.public.withhold (new here). Written only through
--      player_never_public_set() / _end().
--
--   4. public_names_off — C4. A school's switch, per age group: names off.
--      No row, or a row switched back, is the default: names allowed,
--      subject to consent. Written only through public_names_off_set().
--
--   5. fixture_publication, competition_publication — L1, A1. Off until
--      switched on. A fixture is published SIDE BY SIDE: the home school
--      publishes its own side and the away school its own (L5, "each school
--      speaks for its own children"). Written only through fixture_publish()
--      and competition_publish().
--
--   6. public_name_facts(player, side, on) — the one read: exactly the facts
--      publicName() needs about one child and nothing else. No date of birth
--      (N1), no reason, no guardian.
--
-- ─── CAPABILITIES, AND WHY THESE ─────────────────────────────────────
--
--   The office records a guardian's consent from its forms under
--   guardian.link.manage (principal, schooladmin). It is the same act the
--   office already performs for the link's own consent from the same forms
--   (guardian_link_verify(), guardian_consent_record() in db/08), done by
--   the same people, who hold the file the form is in. A NEW capability for
--   "record a consent from a form" would be a second name for one job.
--
--   The never-public mark is player.public.withhold — NEW, level 3, held by
--   principal, schooladmin and directorofsport (and superadmin, which holds
--   everything). No existing capability is the right set of people:
--     guardian.link.manage leaves out the director of sport, who runs the
--       school's sport and is the one most often told "this boy must not
--       appear" — and it would hand a safeguarding reason to whoever a school
--       later appoints to verify links, which is clerical work;
--     discipline.write is held by `official` (an umpire's one-fixture
--       report), who must never read why a child is protected;
--     broadcast.publish is held by sportsadmin, who publishes pages and is
--       exactly the person under pressure to name a star player.
--   Level 3 because the reason is a safeguarding matter — a court order, a
--   custody dispute, a protection order — candid, and about a child's home.
--   Setting a mark can only take a name OFF a page; ending one puts it back,
--   which is why ending takes the same capability as setting, not less.
--
--   A fixture side and the names-off switch are published under
--   broadcast.publish (directorofsport, sportsadmin, superadmin). That
--   capability's own comment is the reason: "scheduling a match and
--   broadcasting one are different acts with different consequences, and the
--   second one puts children in front of an audience that is not at the
--   ground." A public live page is that act. fixture.update would hand it to
--   the school office and to the platform's competition administrators, who
--   schedule fixtures and have no business publishing a school's children.
--   C4 names the overlay's name_display — broadcast.publish's column — as the
--   precedent for names-off, so the switch goes with it.
--
--   A competition page is published under competition.manage at the
--   organiser, as the competition row itself is written. It carries team
--   names and standings (A1) and no pupil (A3: leaderboards are not public).
--
-- ─── "competent", computed here so no date of birth leaves ───────────
--
--   public.mjs takes, per consent record, a boolean: could the giver give it
--   on the day he did. It is computed on every read, from the records as they
--   stand today, so a link revoked tomorrow unmakes yesterday's consent and a
--   corrected date of birth recomputes a pupil's:
--
--     guardian  the link the record names was a live, verified guardian link
--               on given_on (verified that day or earlier, begun, not yet
--               ended), he was still a minor that day, and the link is STILL
--               'verified' — not since rejected or revoked. A link that simply
--               ran to its end date at his majority stays 'verified', so his
--               guardian's consent stands past his birthday (C6); a consent
--               a guardian gave ON or after it does not — every link now ends
--               there (db/08, db/10), and this holds even for one that was
--               written before they did. Revocation (guardian_link_revoke())
--               records no reason, so "revoked as untrue" cannot be told from
--               "revoked because custody changed": every revocation counts as
--               untrue, which fails closed — his name comes off until someone
--               competent consents again.
--     pupil     his own 'self' link was live and verified on given_on, is
--               still 'verified', and majority_on(born) <= given_on — he was
--               eighteen that day. An unknown date of birth is not eighteen.
--
-- ─── ONE PERSON'S ACTS, AND "THE LATEST GOVERNS" ─────────────────────
--
--   public.mjs lets the latest record govern and gives a tie on the day to
--   the record that ended — so a guardian's "no" is never outvoted by an
--   earlier "yes" from the other one. That tie rule is for two people who
--   disagree. One person's own acts are ordered by when he made them, so the
--   fact set carries each giver's MOST RECENT act only. Without that, a
--   guardian who withdrew and consented again on the same day would tie with
--   himself, the ended record would win, and he could never be named again.
--   Nothing is lost by it: a giver's earlier records are all dated on or
--   before his latest, so they could only ever matter in exactly that tie.
--
-- search_path is pinned on every SECURITY DEFINER function below (db/16).


-- ── 0 · The capability: player.public.withhold ─────────────────────
-- A capability the model gained after db/01 shipped (ADDED_SINCE_01 in
-- services/api/rls/generate-rls.mjs), so the catalogue row and every holder's
-- row are here, the way db/24 added scoring.amend.request.
INSERT INTO capability (name) VALUES ('player.public.withhold')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_capability (role, capability) VALUES
  ('superadmin',      'player.public.withhold'),
  ('principal',       'player.public.withhold'),
  ('directorofsport', 'player.public.withhold'),
  ('schooladmin',     'player.public.withhold')
ON CONFLICT DO NOTHING;


-- ── 1 · A stored surname, and a known-as ───────────────────────────
-- Filled by the office. NULL is "not recorded", and the formatter falls back
-- to its heuristic over full_name. Neither is ever shown on a public page
-- whole: the surname follows an initial ("D Erasmus"), and the known-as only
-- ever gives that initial (a boy registered "Johannes" and known as "Hannes"
-- is "H Botha", never "Hannes").
ALTER TABLE player ADD COLUMN IF NOT EXISTS surname  text;
ALTER TABLE player ADD COLUMN IF NOT EXISTS known_as text;
ALTER TABLE player DROP CONSTRAINT IF EXISTS player_surname_not_blank;
ALTER TABLE player ADD CONSTRAINT player_surname_not_blank
  CHECK (surname IS NULL OR (btrim(surname) <> '' AND length(surname) <= 100));
ALTER TABLE player DROP CONSTRAINT IF EXISTS player_known_as_not_blank;
ALTER TABLE player ADD CONSTRAINT player_known_as_not_blank
  CHECK (known_as IS NULL OR (btrim(known_as) <> '' AND length(known_as) <= 100));

-- player_masked is built by db/09 from information_schema at the moment it
-- ran, so a column added since is not in it. Rebuilt the same way, with the
-- same mask list — the ten columns db/09 masks, behind the same capabilities
-- — so the two new columns appear, unmasked, exactly as full_name does.
-- CREATE OR REPLACE may only append columns, which is all this does: the new
-- ones are last in the table and so last in the view. The check at the foot
-- of the file holds the rebuilt view to db/09's masks.
DO $mask_player$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            'player.school_id',
                            g.team_anchor,
                            'player.id',
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ('id_number', 'player.identity.read', 'player.team_code'), ('email', 'player.pii.read', 'player.team_code'), ('phone', 'player.pii.read', 'player.team_code'), ('hometown', 'player.pii.read', 'player.team_code'), ('houseatschool', 'player.pii.read', 'player.team_code'), ('address', 'player.pii.read', 'player.team_code'), ('guardian', 'player.pii.read', 'player.team_code'), ('height', 'player.biometric.read', 'player.team_code'), ('weight', 'player.biometric.read', 'player.team_code'), ('born', 'player.age.read', '''*''::text')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'player';

  EXECUTE format(
    -- security_invoker, as db/09 says at length: without it the view reads
    -- player as its owner and every row reaches everyone.
    'CREATE OR REPLACE VIEW player_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM player',
    cols);
END
$mask_player$;


-- ── 2 · Public-name consent (C1, C3, C6) ───────────────────────────
CREATE TABLE IF NOT EXISTS public_name_consent (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The order records were made in. now() is the transaction's clock, so two
  -- acts in one transaction share a recorded_at; "a giver's most recent act"
  -- (the header) needs an order that cannot tie.
  seq         bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- Who gave it, in public.mjs's words.
  given_by    text NOT NULL CHECK (given_by IN ('guardian', 'pupil')),
  -- THE GIVER: the verified link through which he answers for this child —
  -- a guardian's link, or the pupil's own 'self' link (his account). The
  -- foreign key runs through player_id as well, so a record cannot name one
  -- child's guardian link against another child. Never public (N4): who a
  -- child's guardian is.
  giver_assignment_id uuid NOT NULL,
  giver_link_id       uuid NOT NULL,
  -- The wording he agreed (or refused) to, as the link's consent_version is.
  version     text NOT NULL CHECK (btrim(version) <> ''),
  -- The day it began to count (sa_today() when recorded — never passed in,
  -- so a consent cannot be backdated onto scorecards) and the day it stopped.
  given_on    date NOT NULL,
  ended_on    date,
  --   withdrawn   the giver said no to a consent he had given
  --   superseded  he gave a newer version
  --   refused     he said no with nothing open: a record that ends the day
  --               it begins, which public.mjs reads as a "no"
  end_reason  text CHECK (end_reason IN ('withdrawn', 'superseded', 'refused')),
  -- C1: "the school may record it from its own admission forms, naming the
  -- form and the date". Both or neither; the form cannot postdate the record.
  form_name   text CHECK (form_name IS NULL OR btrim(form_name) <> ''),
  form_date   date,
  -- Who pressed the button: the giver himself, or the office on his behalf.
  -- Never public (N4): for a self-answer it is the guardian or the pupil.
  recorded_by uuid NOT NULL REFERENCES app_user(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  ended_by    uuid REFERENCES app_user(id),
  ended_at    timestamptz,
  FOREIGN KEY (giver_assignment_id, player_id, giver_link_id)
    REFERENCES assignment_subject (assignment_id, player_id, id) ON DELETE CASCADE,
  CONSTRAINT public_name_consent_dates CHECK (ended_on IS NULL OR ended_on >= given_on),
  CONSTRAINT public_name_consent_end_is_whole
    CHECK ((ended_on IS NULL) = (end_reason IS NULL) AND (ended_on IS NULL) = (ended_by IS NULL)
           AND (ended_on IS NULL) = (ended_at IS NULL)),
  CONSTRAINT public_name_consent_form_is_whole
    CHECK ((form_name IS NULL) = (form_date IS NULL) AND (form_date IS NULL OR form_date <= given_on))
);
CREATE INDEX IF NOT EXISTS public_name_consent_player ON public_name_consent (player_id);
-- One open record per giver per child. A new version ends the old one first.
CREATE UNIQUE INDEX IF NOT EXISTS public_name_consent_one_open
  ON public_name_consent (player_id, giver_link_id) WHERE ended_on IS NULL;

ALTER TABLE public_name_consent ENABLE ROW LEVEL SECURITY;
-- No INSERT, UPDATE or DELETE policy, and no privilege either: the only door
-- is public_name_consent_set(), which checks its own authority. Two layers,
-- as db/06 does for role_capability.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public_name_consent FROM scrbrd_app;

/**
 * Whether an assignment is the caller's own. SECURITY DEFINER because
 * role_assignment is itself behind RLS, and a policy on public_name_consent
 * must not depend on what else of it the caller can read.
 */
CREATE OR REPLACE FUNCTION public_name_giver_is_me(p_assignment uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.id = p_assignment AND a.person_id = app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_name_giver_is_me(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_name_giver_is_me(uuid) TO PUBLIC;

-- Read: the office that records them (guardian.link.manage at the child's
-- school, the same test db/08's link functions make), and a giver his own
-- records. Not a coach, not another guardian: a consent record names who a
-- child's guardian is.
DROP POLICY IF EXISTS public_name_consent_read ON public_name_consent;
CREATE POLICY public_name_consent_read ON public_name_consent
  FOR SELECT USING (
    app_can('guardian.link.manage', player_school(public_name_consent.player_id), '*'::text,
            '00000000-0000-0000-0000-000000000000'::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid)
    OR public_name_giver_is_me(public_name_consent.giver_assignment_id));

/**
 * A person's LIVE, verified link to a child in one role — 'guardian', or
 * 'selfaccess' for a pupil's own account — in the terms app_can() uses: the
 * assignment active, begun, not ended, not expired, not suspended; the link
 * verified, begun and not ended. Internal: called by the definer below.
 */
CREATE OR REPLACE FUNCTION public_name_live_link(p_person uuid, p_player uuid, p_role text)
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
     AND NOT EXISTS (SELECT 1 FROM duty_suspension s
                      WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
     AND g.verification_state = 'verified'
     AND g.valid_from <= current_date
     AND (g.valid_until IS NULL OR g.valid_until > current_date)
     AND (CASE WHEN p_role = 'selfaccess' THEN g.relationship = 'self'
               ELSE g.relationship IS DISTINCT FROM 'self' END)
   ORDER BY g.verified_at DESC NULLS LAST, g.id
   LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_name_live_link(uuid, uuid, text) FROM PUBLIC;

/**
 * Say yes or no to a child being named on public pages.
 *
 * TWO WAYS IN, and each checks its own authority:
 *
 *   p_guardian NULL — the caller answers for himself. He must hold a live,
 *     verified guardian link to THIS child while the child is a minor (a
 *     guardian of another child is refused), or be this child through his
 *     own verified 'self' link AND be eighteen today (C6: "his own consent
 *     counts from his birthday"; before it he is refused, not recorded).
 *
 *   p_guardian set — the office, on that guardian's behalf, from its own
 *     forms (C1). guardian.link.manage at the child's school; the guardian
 *     must hold a live, verified link to the child; a "yes" must name the
 *     form and its date, which cannot be in the future. A "no" need not — the
 *     parent who telephones, as guardian_consent_withdraw() allows.
 *
 * WHAT IT WRITES. Yes: the giver's open record, if any, is ended as
 * superseded, and a new one begins today. No: his open record is ended today
 * as withdrawn — effective the day it is made (C3) — or, with nothing open,
 * a refusal is recorded that begins and ends today. Nothing is updated in
 * any other way and nothing is deleted.
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
      -- A guardian answers for a minor. From his eighteenth birthday the
      -- answer is his own (C6), whatever an old link still says.
      IF v_born IS NOT NULL AND majority_on(v_born) <= v_today THEN
        RETURN QUERY SELECT false, 'player_is_an_adult'; RETURN;
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
    IF v_born IS NOT NULL AND majority_on(v_born) <= v_today THEN
      RETURN QUERY SELECT false, 'player_is_an_adult'; RETURN;
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

REVOKE ALL ON FUNCTION public_name_consent_set(uuid, boolean, text, uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_name_consent_set(uuid, boolean, text, uuid, text, date) TO PUBLIC;


-- ── 3 · The never-public mark (C5) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS player_never_public (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- WHY. Held on this row, which nobody but a holder of
  -- player.public.withhold can read, and which no public read may select
  -- (NEVER_PUBLIC in public.mjs). The fact set carries the mark as a boolean
  -- and nothing else, so it cannot come back out on a page.
  reason    text NOT NULL CHECK (btrim(reason) <> ''),
  set_on    date NOT NULL,
  set_by    uuid NOT NULL REFERENCES app_user(id),
  set_at    timestamptz NOT NULL DEFAULT now(),
  -- End-dated, never deleted: "was this boy protected in March" has to have
  -- an answer in September.
  ended_on  date,
  ended_by  uuid REFERENCES app_user(id),
  ended_at  timestamptz,
  CONSTRAINT player_never_public_dates CHECK (ended_on IS NULL OR ended_on >= set_on),
  CONSTRAINT player_never_public_end_is_whole
    CHECK ((ended_on IS NULL) = (ended_by IS NULL) AND (ended_on IS NULL) = (ended_at IS NULL))
);
CREATE INDEX IF NOT EXISTS player_never_public_player ON player_never_public (player_id);
CREATE UNIQUE INDEX IF NOT EXISTS player_never_public_one_open
  ON player_never_public (player_id) WHERE ended_on IS NULL;

ALTER TABLE player_never_public ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON player_never_public FROM scrbrd_app;

-- Read: the people who set it, and nobody else — not a coach, not a guardian,
-- not the office's link clerk unless the school gave them this. Anchored on
-- the child's own school, side and person, as every other read about him.
DROP POLICY IF EXISTS player_never_public_read ON player_never_public;
CREATE POLICY player_never_public_read ON player_never_public
  FOR SELECT USING (
    app_can('player.public.withhold', player_school(player_never_public.player_id),
            player_team(player_never_public.player_id), player_never_public.player_id,
            '00000000-0000-0000-0000-000000000000'::uuid));

/**
 * Mark a child never to appear on a public page, with the reason. In force at
 * once, on every page, past scorecards included (C3, C5).
 */
CREATE OR REPLACE FUNCTION player_never_public_set(p_player uuid, p_reason text)
RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF player_school(p_player) IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;
  IF NOT app_can('player.public.withhold', player_school(p_player), player_team(p_player), p_player,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RETURN QUERY SELECT false, 'no_reason'; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM player_never_public m WHERE m.player_id = p_player AND m.ended_on IS NULL) THEN
    RETURN QUERY SELECT false, 'already_marked'; RETURN;
  END IF;
  INSERT INTO player_never_public (player_id, reason, set_on, set_by)
  VALUES (p_player, btrim(p_reason), sa_today(), app_user_id());
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION player_never_public_set(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_never_public_set(uuid, text) TO PUBLIC;

/**
 * End a child's mark. The row stays, end-dated. The same capability as
 * setting it, not a lesser one: this is the act that puts a name back.
 */
CREATE OR REPLACE FUNCTION player_never_public_end(p_player uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE v_rows int;
BEGIN
  IF player_school(p_player) IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;
  IF NOT app_can('player.public.withhold', player_school(p_player), player_team(p_player), p_player,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  UPDATE player_never_public
     SET ended_on = greatest(sa_today(), set_on), ended_by = app_user_id(), ended_at = now()
   WHERE player_id = p_player AND ended_on IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN QUERY SELECT false, 'not_marked'; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION player_never_public_end(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_never_public_end(uuid) TO PUBLIC;


-- ── 4 · A school's names-off switch, per age group (C4) ────────────
-- The age groups are teams.mjs's vocabulary, the same one the
-- player_team_code_known CHECK closes (db/09): U9–U19 — a school fields
-- U9–U16, representative cricket U13–U19 — and 'open' for the ranked sides
-- (1XI, 2XI …). team_age_group() below maps a team code onto it.
CREATE TABLE IF NOT EXISTS public_names_off (
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  age_group  text NOT NULL CHECK (age_group ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)|open)$'),
  -- Default false: names allowed, subject to consent. A row switched back is
  -- kept, with who switched it and when.
  names_off  boolean NOT NULL DEFAULT false,
  set_by     uuid NOT NULL REFERENCES app_user(id),
  set_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, age_group)
);

ALTER TABLE public_names_off ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public_names_off FROM scrbrd_app;

-- Read: anyone at the school who reads its fixtures — a coach should know his
-- U13s are not named. A school setting, about no child.
DROP POLICY IF EXISTS public_names_off_read ON public_names_off;
CREATE POLICY public_names_off_read ON public_names_off
  FOR SELECT USING (
    app_can('fixture.read', public_names_off.school_id, '*'::text,
            '00000000-0000-0000-0000-000000000000'::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid));

/** 'U14A' → 'U14', '1XI' → 'open', anything else → NULL. teams.mjs's parseTeam(). */
CREATE OR REPLACE FUNCTION team_age_group(p_team text) RETURNS text AS $$
  SELECT CASE
           WHEN btrim(p_team) ~ '^U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?$'
             THEN substring(btrim(p_team) FROM '^(U[0-9]+)')
           WHEN btrim(p_team) ~ '^([1-9]|1[0-9]|20)XI$' THEN 'open'
         END
$$ LANGUAGE sql IMMUTABLE;

/**
 * A boy's own age group by birth, on the season's cut-off (season_cutoff(),
 * the rule age_band() and the eligibility trigger use): "U14" is fourteen and
 * under on the cut-off, so his own group is the youngest he may play in.
 * Under nine is U9; seventeen and over is 'open'. Unknown is NULL.
 */
CREATE OR REPLACE FUNCTION birth_age_group(p_born date, p_on date DEFAULT sa_today()) RETURNS text AS $$
  SELECT CASE WHEN p_born IS NULL THEN NULL
              WHEN a <= 9  THEN 'U9'
              WHEN a <= 16 THEN 'U' || a
              ELSE 'open' END
    FROM (SELECT extract(year FROM age(season_cutoff(p_on), p_born))::int AS a) x
$$ LANGUAGE sql STABLE;

/** Switch names off (or back on) for one age group at one school. */
CREATE OR REPLACE FUNCTION public_names_off_set(p_school uuid, p_age_group text, p_off boolean)
RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF p_school IS NULL OR NOT EXISTS (SELECT 1 FROM school s WHERE s.id = p_school) THEN
    RETURN QUERY SELECT false, 'no_such_school'; RETURN;
  END IF;
  -- NULL team, not '*': a school-wide switch needs a school-wide holder. A
  -- sports administrator appointed to one side does not decide for every age
  -- group at the school.
  IF NOT app_can('broadcast.publish', p_school, NULL::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF p_age_group IS NULL OR p_age_group !~ '^(U(9|10|11|12|13|14|15|16|17|18|19)|open)$' THEN
    RETURN QUERY SELECT false, 'unknown_age_group'; RETURN;
  END IF;
  IF p_off IS NULL THEN RETURN QUERY SELECT false, 'no_answer'; RETURN; END IF;
  INSERT INTO public_names_off (school_id, age_group, names_off, set_by)
  VALUES (p_school, p_age_group, p_off, app_user_id())
  ON CONFLICT (school_id, age_group)
  DO UPDATE SET names_off = EXCLUDED.names_off, set_by = EXCLUDED.set_by, set_at = now();
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION public_names_off_set(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_names_off_set(uuid, text, boolean) TO PUBLIC;


-- ── 5 · Publishing: a fixture side by side, and a competition (L1, A1) ──
--
-- WHY NOT match_broadcast.published (db/08). It is the right shape in one
-- way — a per-fixture decision, off by default, under broadcast.publish — and
-- this table copies that shape and that capability. It is the wrong row in
-- two: it is ONE row per fixture, anchored on the home school, so the away
-- school could not speak for its own children through it (L5); and it is the
-- stream OVERLAY's decision (D2), which a school may well refuse while it
-- publishes the live page — a stream is permanent and copyable, a page is
-- reached by link. So the page gets its own row per side, and step 4 brings
-- the overlay under this: a side's names on the overlay will need its row
-- here as well as the overlay's own.
--
-- WHY A TABLE AND NOT TWO COLUMNS ON match. match is written under
-- fixture.update at the HOME school only (db/09: "whoever hosts owns the
-- fixture record"), so the away school could not set an away column without a
-- hole cut in that policy; and a column cannot say who decided or when.
CREATE TABLE IF NOT EXISTS fixture_publication (
  match_id   uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  side       text NOT NULL CHECK (side IN ('home', 'away')),
  -- The side's school and team, derived from the match at write time and
  -- never asserted: home is match.school_id/team_code, away is
  -- away_school_id/away_team_code. An away side not on the platform has no
  -- row and no one to publish it (L5: never named).
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  team_code  text,
  -- Off until switched on (§1.1).
  published  boolean NOT NULL DEFAULT false,
  set_by     uuid NOT NULL REFERENCES app_user(id),
  set_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, side)
);
CREATE INDEX IF NOT EXISTS fixture_publication_school ON fixture_publication (school_id);

ALTER TABLE fixture_publication ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fixture_publication FROM scrbrd_app;

-- Read: each school reads its own side's row, under fixture.read at that side.
DROP POLICY IF EXISTS fixture_publication_read ON fixture_publication;
CREATE POLICY fixture_publication_read ON fixture_publication
  FOR SELECT USING (
    app_can('fixture.read', fixture_publication.school_id, fixture_publication.team_code,
            '00000000-0000-0000-0000-000000000000'::uuid, fixture_publication.match_id));

/**
 * Publish (or withdraw) one side of a fixture. The caller must hold
 * broadcast.publish at THAT side's school and team: the away school's
 * publisher cannot publish the home side, nor the home school's the away.
 */
CREATE OR REPLACE FUNCTION fixture_publish(p_match uuid, p_side text, p_published boolean)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  m match%ROWTYPE;
  v_school uuid;
  v_team   text;
BEGIN
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_fixture'; RETURN; END IF;
  IF p_side IS NULL OR p_side NOT IN ('home', 'away') THEN
    RETURN QUERY SELECT false, 'unknown_side'; RETURN;
  END IF;
  IF p_published IS NULL THEN RETURN QUERY SELECT false, 'no_answer'; RETURN; END IF;
  IF p_side = 'home' THEN v_school := m.school_id;      v_team := m.team_code;
  ELSE                    v_school := m.away_school_id; v_team := m.away_team_code;
  END IF;
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'side_not_on_platform'; RETURN; END IF;
  IF NOT app_can('broadcast.publish', v_school, v_team,
                 '00000000-0000-0000-0000-000000000000'::uuid, p_match) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  INSERT INTO fixture_publication (match_id, side, school_id, team_code, published, set_by)
  VALUES (p_match, p_side, v_school, v_team, p_published, app_user_id())
  ON CONFLICT (match_id, side)
  DO UPDATE SET school_id = EXCLUDED.school_id, team_code = EXCLUDED.team_code,
                published = EXCLUDED.published, set_by = EXCLUDED.set_by, set_at = now();
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION fixture_publish(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fixture_publish(uuid, text, boolean) TO PUBLIC;

/**
 * Whether one side of a fixture is published — for the signed-out read
 * (§6 step 3), which has no session for RLS to admit. A yes or no about a
 * page that is public by definition when it is yes; nothing else. A side
 * whose school has since changed on the fixture is not published: the row
 * spoke for the school that was there.
 */
CREATE OR REPLACE FUNCTION fixture_side_published(p_match uuid, p_side text) RETURNS boolean AS $$
  SELECT coalesce((
    SELECT f.published
      FROM fixture_publication f JOIN match m ON m.id = f.match_id
     WHERE f.match_id = p_match AND f.side = p_side
       AND f.school_id = CASE p_side WHEN 'home' THEN m.school_id WHEN 'away' THEN m.away_school_id END), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION fixture_side_published(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fixture_side_published(uuid, text) TO PUBLIC;

CREATE TABLE IF NOT EXISTS competition_publication (
  competition_id uuid PRIMARY KEY REFERENCES competition(id) ON DELETE CASCADE,
  published      boolean NOT NULL DEFAULT false,
  set_by         uuid NOT NULL REFERENCES app_user(id),
  set_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE competition_publication ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON competition_publication FROM scrbrd_app;

-- Read: whoever can reach the competition, as competition_division is read.
DROP POLICY IF EXISTS competition_publication_read ON competition_publication;
CREATE POLICY competition_publication_read ON competition_publication
  FOR SELECT USING (competition_visible(competition_publication.competition_id));

/** Publish (or withdraw) a competition's page: its results and standings (A1). */
CREATE OR REPLACE FUNCTION competition_publish(p_competition uuid, p_published boolean)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE c competition%ROWTYPE;
BEGIN
  SELECT * INTO c FROM competition WHERE id = p_competition;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_competition'; RETURN; END IF;
  IF p_published IS NULL THEN RETURN QUERY SELECT false, 'no_answer'; RETURN; END IF;
  -- The organiser's test, exactly as competition_update (db/09) makes it: for
  -- a shared league with no organiser that is a platform-wide administrator.
  IF NOT app_can('competition.manage', c.school_id, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  INSERT INTO competition_publication (competition_id, published, set_by)
  VALUES (p_competition, p_published, app_user_id())
  ON CONFLICT (competition_id)
  DO UPDATE SET published = EXCLUDED.published, set_by = EXCLUDED.set_by, set_at = now();
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION competition_publish(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_publish(uuid, boolean) TO PUBLIC;

/** Whether a competition's page is published, for the signed-out read. */
CREATE OR REPLACE FUNCTION competition_published(p_competition uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT published FROM competition_publication WHERE competition_id = p_competition), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION competition_published(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_published(uuid) TO PUBLIC;


-- ── 6 · The facts publicName() needs, and nothing else ─────────────
/**
 * For one child: exactly the part of NameFacts (public.mjs) that lives in
 * these records, as JSON the rule takes as it comes —
 *
 *   { "consents":    [{ "by": "guardian"|"pupil", "competent": bool,
 *                       "givenOn": "YYYY-MM-DD", "endedOn": "YYYY-MM-DD"|null }, …],
 *     "neverPublic": bool,
 *     "namesOff":    bool }
 *
 * and NOTHING ELSE: no date of birth (N1 — competence and his age group are
 * worked out here, where born lives), no reason for a mark, no guardian, no
 * link, no form, no recorder. NULL for a player who does not exist, which
 * publicName() reads as no facts: not named.
 *
 * SECURITY DEFINER, because the signed-out read has no session for RLS to
 * admit, and it would read nothing. The facts are the rule's inputs, not a
 * page: the read that calls this (§6 step 3) passes them to publicName() and
 * sends the answer, never the facts — "Batter" for a boy never named and
 * "Batter" for a boy with a mark must stay the same string.
 *
 *   p_side  the team code of the side he is on in the fixture being served,
 *           when there is one (PUBLIC_DATA §5a: a boy playing up). NULL for a
 *           page with no side — an honours board.
 *   p_on    the day the page is served; sa_today() unless told otherwise. It
 *           decides the season's cut-off for his age group and whether a mark
 *           has ended. Consents are dated and passed whole: publicName()
 *           judges them on its own `on`.
 *
 * neverPublic: a mark not ended by p_on. A mark set today counts for every
 *   page, past scorecards included (C3); its start is not compared.
 * namesOff: his school has names off for his own age group by birth, for the
 *   side he is registered in (player.team_code), or for p_side. Three arms,
 *   because "his own age group" is read both ways and either is a reason to
 *   hold his name back. An unknown date of birth leaves his own age group
 *   unknown, and then any switch that is on at his school holds it back:
 *   unknown is not yes.
 * consents: each giver's most recent act (see the file header).
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
                                              AND (p.born IS NULL OR c.given_on < majority_on(p.born))
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

REVOKE ALL ON FUNCTION public_name_facts(uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_name_facts(uuid, text, date) TO PUBLIC;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  t text;
  v_def text;
  v_cols int;
  v_keys text;
BEGIN
  -- Every definer here pins its search path (db/16).
  FOREACH f IN ARRAY ARRAY[
      'public_name_giver_is_me(uuid)', 'public_name_live_link(uuid,uuid,text)',
      'public_name_consent_set(uuid,boolean,text,uuid,text,date)',
      'player_never_public_set(uuid,text)', 'player_never_public_end(uuid)',
      'public_names_off_set(uuid,text,boolean)',
      'fixture_publish(uuid,text,boolean)', 'fixture_side_published(uuid,text)',
      'competition_publish(uuid,boolean)', 'competition_published(uuid)',
      'public_name_facts(uuid,text,date)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc
                    WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/47: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;

  -- Every table is behind RLS, has exactly one policy — a read — and gives
  -- the application no way to write it but the functions.
  FOREACH t IN ARRAY ARRAY['public_name_consent', 'player_never_public', 'public_names_off',
                           'fixture_publication', 'competition_publication'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'db/47: % is not behind row-level security', t;
    END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = t) <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
                         AND cmd = 'SELECT' AND policyname = t || '_read') THEN
      RAISE EXCEPTION 'db/47: % should have exactly one policy, % (SELECT)', t, t || '_read';
    END IF;
    IF has_table_privilege('scrbrd_app', t, 'INSERT') OR has_table_privilege('scrbrd_app', t, 'UPDATE')
       OR has_table_privilege('scrbrd_app', t, 'DELETE') THEN
      RAISE EXCEPTION 'db/47: the application role may write % directly', t;
    END IF;
  END LOOP;

  -- The mark's reason is readable only under the capability that sets it.
  SELECT qual INTO v_def FROM pg_policies WHERE tablename = 'player_never_public' AND policyname = 'player_never_public_read';
  IF v_def NOT LIKE '%player.public.withhold%' OR v_def ILIKE '%guardian.link.manage%' OR v_def ILIKE '% OR %' THEN
    RAISE EXCEPTION 'db/47: player_never_public is readable by something other than player.public.withhold: %', v_def;
  END IF;

  -- The capability and its four holders.
  IF (SELECT count(*) FROM role_capability WHERE capability = 'player.public.withhold'
        AND role IN ('superadmin', 'principal', 'directorofsport', 'schooladmin')) <> 4
     OR EXISTS (SELECT 1 FROM role_capability WHERE capability = 'player.public.withhold'
                   AND role NOT IN ('superadmin', 'principal', 'directorofsport', 'schooladmin')) THEN
    RAISE EXCEPTION 'db/47: player.public.withhold is not held by exactly superadmin, principal, directorofsport and schooladmin';
  END IF;

  -- player_masked carries the two new columns, and still masks db/09's ten.
  SELECT pg_get_viewdef('player_masked'::regclass) INTO v_def;
  SELECT count(*) INTO v_cols FROM regexp_matches(v_def, 'app_can\(', 'g');
  IF v_cols <> 10 THEN
    RAISE EXCEPTION 'db/47: player_masked masks % column(s), db/09 masks 10', v_cols;
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'player_masked')
     <> (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'player')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                       AND table_name = 'player_masked' AND column_name = 'surname')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                       AND table_name = 'player_masked' AND column_name = 'known_as') THEN
    RAISE EXCEPTION 'db/47: player_masked does not carry every player column, surname and known_as included';
  END IF;
  IF v_def ~ 'app_can\([^)]*\) THEN (player\.)?(surname|known_as|full_name)\M' THEN
    RAISE EXCEPTION 'db/47: player_masked masks a name column; a name is not masked';
  END IF;

  -- The fact set is exactly its three keys, whatever player it is asked
  -- about (asked here of a player that does not exist and of every one that
  -- does, which on a fresh database is none).
  IF public_name_facts('00000000-0000-0000-0000-000000000000'::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'db/47: public_name_facts() answered for a player who does not exist';
  END IF;
  SELECT string_agg(DISTINCT k, ',' ORDER BY k) INTO v_keys
    FROM player p, jsonb_object_keys(public_name_facts(p.id)) k;
  IF v_keys IS NOT NULL AND v_keys <> 'consents,namesOff,neverPublic' THEN
    RAISE EXCEPTION 'db/47: public_name_facts() carries keys %, expected consents, namesOff and neverPublic', v_keys;
  END IF;

  -- The vocabulary mapping, on the codes it has to get right.
  IF team_age_group('U14A') IS DISTINCT FROM 'U14' OR team_age_group('U9') IS DISTINCT FROM 'U9'
     OR team_age_group('1XI') IS DISTINCT FROM 'open' OR team_age_group('20XI') IS DISTINCT FROM 'open'
     OR team_age_group('U19B') IS DISTINCT FROM 'U19' OR team_age_group('U20') IS NOT NULL
     OR team_age_group('21XI') IS NOT NULL OR team_age_group(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'db/47: team_age_group() does not read teams.mjs''s vocabulary';
  END IF;
END $check$;
