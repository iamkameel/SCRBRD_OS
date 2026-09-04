-- ════════════════════════════════════════════════════════════════
--  SCRBRD — the programme schema: training, development, notices,
--  league standings, and conditions.
--
--  These five areas existed in the product for months and in the database not
--  at all. The views read them straight out of a mock module, which meant the
--  browser was deciding who could see a child's development assessment, a
--  training register, and a notification feed — decisions with no server
--  behind them and no policy anywhere. This file is the other half of closing
--  that: the tables, so the policies generated from packages/policy/ have
--  something to attach to.
--
--  ORDERING: every governed table must exist BEFORE db/09_rls_policies.sql
--  runs, because that file ALTERs each one to enable row-level security. That
--  is why the generated policies moved from 03 to 09 — the invariant is
--  "tables first, policies last", and a schema file that lands after the
--  policies is a table with no policy on it, which is precisely the failure
--  mode that left app_user readable across every tenant.
-- ════════════════════════════════════════════════════════════════

-- ── Who is in a league ──────────────────────────────────────────
-- Closes the limitation recorded against `competition` in packages/policy/src/
-- tables.mjs: visibility used to derive from who CREATED the competition, so a
-- genuine inter-school league had to be created platform-scoped (school_id
-- NULL) to be readable by its own entrants. It now derives from participation.
CREATE TABLE competition_entrant (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  school_id      uuid NOT NULL REFERENCES school(id),
  team_code      text,
  -- A display name, because the entrant is "Hilton 1st XI" to a reader and a
  -- (school_id, team_code) pair to the schema. Free text, because a fixture
  -- list includes schools that are not SCRBRD tenants.
  display_name   text NOT NULL,
  played         smallint NOT NULL DEFAULT 0 CHECK (played  >= 0),
  won            smallint NOT NULL DEFAULT 0 CHECK (won     >= 0),
  lost           smallint NOT NULL DEFAULT 0 CHECK (lost    >= 0),
  drawn          smallint NOT NULL DEFAULT 0 CHECK (drawn   >= 0),
  no_result      smallint NOT NULL DEFAULT 0 CHECK (no_result >= 0),
  points         smallint NOT NULL DEFAULT 0,
  net_run_rate   numeric(5,3),
  UNIQUE (competition_id, school_id, team_code),
  -- The results have to add up. A ladder that disagrees with itself is worse
  -- than no ladder, because someone will act on it.
  CONSTRAINT entrant_results_sum CHECK (won + lost + drawn + no_result = played)
);
CREATE INDEX ON competition_entrant (competition_id);
CREATE INDEX ON competition_entrant (school_id, team_code);

-- Is this competition in reach at all?
--
-- A league table is a SHARED record. Anchoring an entrant row to its own
-- school is right for who may EDIT it and wrong for who may read it: a Hilton
-- coach anchored to Hilton reads exactly one row of a seven-team ladder, which
-- is not a ladder. Visibility has to derive from the competition, and the
-- competition's readers are its organiser plus everyone who entered it.
--
-- SECURITY DEFINER, and that is the load-bearing part rather than an
-- optimisation. Writing this as an EXISTS inside the two policies instead
-- would make competition's policy read competition_entrant and
-- competition_entrant's policy read competition — mutually recursive, which
-- Postgres refuses at query time with "infinite recursion detected in policy
-- for relation". Running as the owner steps outside RLS to answer the
-- question, exactly as match_school() and match_team() do for the scoring
-- policies.
--
-- It still asks app_can() for every candidate scope, so entering a competition
-- does not hand a league to someone who holds no competition.read anywhere —
-- participation decides WHICH leagues are in reach, never WHETHER this person
-- may read leagues at all.
CREATE OR REPLACE FUNCTION competition_visible(p_competition uuid) RETURNS boolean AS $$
  SELECT EXISTS (
           SELECT 1 FROM competition c
            WHERE c.id = p_competition
              AND app_can('competition.read', c.school_id, '*'::text,
                          '00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid))
      OR EXISTS (
           SELECT 1 FROM competition_entrant e
            WHERE e.competition_id = p_competition
              AND app_can('competition.read', e.school_id,
                          COALESCE(e.team_code, '*'::text),
                          '00000000-0000-0000-0000-000000000000'::uuid,
                          '00000000-0000-0000-0000-000000000000'::uuid))
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION competition_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION competition_visible(uuid) TO PUBLIC;

-- ── Training ────────────────────────────────────────────────────
-- Split deliberately in two. The SESSION is a noticeboard fact — when, where,
-- which team — and is governed by team.read. The REGISTER is a list of named
-- minors and is governed by player.profile.read. Merging them would mean a
-- parent could not learn that training moved to 06:30 without also receiving
-- every child who was there.
CREATE TABLE training_session (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES school(id),
  team_code    text NOT NULL,
  title        text NOT NULL,
  starts_at    timestamptz NOT NULL,
  duration_min smallint NOT NULL CHECK (duration_min BETWEEN 1 AND 600),
  venue        text,
  ground_id    uuid REFERENCES ground(id),
  coach_id     uuid REFERENCES coach(id),
  session_type text NOT NULL CHECK (session_type IN
                 ('technical','skills','batting','bowling','fielding','fitness','match-prep')),
  drills       text[] NOT NULL DEFAULT '{}',
  notes        text,
  cancelled    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON training_session (school_id, team_code, starts_at DESC);

CREATE TABLE training_attendance (
  session_id uuid NOT NULL REFERENCES training_session(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'present'
             CHECK (status IN ('present','absent','excused','injured','late')),
  -- Why someone was absent can be a medical fact. It is not stored here: the
  -- register records attendance, and the reason lives in the injury record
  -- behind medical.status.read, where the policy for it already exists.
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, player_id)
);
CREATE INDEX ON training_attendance (player_id);

-- ── Development assessments ─────────────────────────────────────
-- Long form rather than a JSON blob per player. A blob cannot be masked, cannot
-- be indexed by metric, and cannot record WHEN a judgement was made — and the
-- whole point of a development record is the trend, not the current number.
CREATE TABLE player_skill (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  assessed_on date NOT NULL DEFAULT current_date,
  assessed_by uuid REFERENCES app_user(id),
  category    text NOT NULL CHECK (category IN ('batting','bowling','fielding','fitness')),
  metric      text NOT NULL,
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  note        text,
  UNIQUE (player_id, assessed_on, category, metric)
);
CREATE INDEX ON player_skill (player_id, assessed_on DESC);

-- ── Notices ─────────────────────────────────────────────────────
-- The table that most needed a policy and had none.
--
-- news.read is a floor capability: nearly every role holds it. If that were
-- the only gate, the notification feed would be a side channel around every
-- other policy in this schema — "Theo Pretorius cleared for light training" is
-- a medical disclosure with a bell icon on it. So each row declares the
-- capability its SUBJECT MATTER requires, and the generated policy demands
-- both, in the same scope.
--
-- The rule this encodes, from the architecture note: a subscription can REDUCE
-- what someone receives. It can never EXPAND what they may know.
CREATE TABLE notification (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES school(id),
  -- NULL means the notice is not about one team. The generated policy
  -- COALESCEs this to the ANY_SCOPE sentinel rather than passing NULL, because
  -- a NULL on a resource NARROWS — a school-wide notice with a null team would
  -- be invisible to every team-scoped coach in the school.
  team_code text,
  scope_level text NOT NULL CHECK (scope_level IN ('school','team','competition')),
  kind      text NOT NULL,
  urgency   text NOT NULL DEFAULT 'low' CHECK (urgency IN ('low','medium','high')),
  title     text NOT NULL,
  body      text NOT NULL,
  -- The capability the CONTENT requires, on top of news.read. A foreign key
  -- rather than free text: a typo here fails closed, which is safe, but it
  -- fails silently — nobody receives the notice and the publisher is never
  -- told. The catalogue is generated in db/01_authz.sql from the same model
  -- the roles are.
  required_capability text NOT NULL DEFAULT 'news.read' REFERENCES capability(name),
  -- Public-facing surfaces read ONLY where this is true. It is a separate
  -- decision from the capability gate above and never a substitute for it: a
  -- row can be public and still carry a capability, and both are checked.
  is_public boolean NOT NULL DEFAULT false,
  -- What the notice is ABOUT, when it is about something. Nullable and
  -- unenforced by design: a notice may reference a fixture that is later
  -- cancelled, and the notice should survive to say so.
  subject_kind text CHECK (subject_kind IN ('match','injury','training','transport','facility','skills','system','competition')),
  subject_id   uuid,
  -- WHO the notice is about, when it is about a person.
  --
  -- This is a scope anchor, not a label. Without it a notice is about nobody
  -- in particular, so the person dimension is ANY_SCOPE and every assignment
  -- in the school and team receives it — which is right for "fixture list
  -- published" and badly wrong for "R Pillay is out with a hamstring strain":
  -- a guardian scoped to their own child would have received an alert about
  -- somebody else's.
  --
  -- With it, the generated policy passes this as the person anchor, and a
  -- guardian's assignment reaches it only if their subject list names this
  -- player. Same mechanism that scopes the record itself.
  subject_person_id uuid REFERENCES player(id) ON DELETE CASCADE,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES app_user(id),
  expires_at   timestamptz,
  CONSTRAINT notification_team_scope CHECK (scope_level <> 'team' OR team_code IS NOT NULL),
  -- A public notice may not carry a restricted subject. Belt and braces
  -- alongside the capability gate: if it is going on a public match centre,
  -- news.read is the most it may require.
  CONSTRAINT notification_public_is_general CHECK (NOT is_public OR required_capability = 'news.read')
);
CREATE INDEX ON notification (school_id, published_at DESC);
CREATE INDEX ON notification (school_id, team_code, published_at DESC);
CREATE INDEX ON notification (published_at DESC) WHERE is_public;
CREATE INDEX ON notification (subject_person_id) WHERE subject_person_id IS NOT NULL;

-- Read state is PER PERSON, so it cannot live on the notice. Its own table,
-- keyed by the reader, and deliberately NOT governed by a capability: marking
-- your own notice read is not an authorization question, and the rows you can
-- create are constrained to your own id by the policy in 09.
CREATE TABLE notification_read (
  notification_id uuid NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  person_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, person_id)
);

-- ── Asking another coach about one of their players ─────────────
--
-- A coach reaches a player through the side they coach. When a player is
-- wanted for a DIFFERENT side — promoted to the 1st XI, or filling in on
-- Saturday — the requesting coach has no scope over them and the model
-- correctly refuses. The wrong fix is to widen every coach to the whole
-- school. The right one is to make the refusal into a question.
--
-- The answer, when it is yes, is not a row in a workflow table that some read
-- path has to remember to consult. It is an ASSIGNMENT: role `enquiry`, one
-- named player in assignment_subject, and a valid_until. From that moment the
-- ordinary machinery carries it — same app_can(), immediate revocation,
-- automatic expiry — and nothing anywhere needs to know a request existed.
-- Which school a player belongs to, for a caller who cannot read the player.
--
-- SECURITY DEFINER, and needed precisely because of the situation this whole
-- section exists for: a 2nd XI coach asking about a 1st XI player cannot read
-- that player's row, so an INSERT ... SELECT over `player` returns nothing and
-- the request is silently refused. Mirrors match_school(), which solves the
-- same problem for the scoring policies.
--
-- It discloses the school of a player id you already hold, which is not a
-- disclosure about a child: you cannot enumerate ids through it, and knowing
-- a uuid is not knowing a name.
CREATE OR REPLACE FUNCTION player_school(p_player uuid) RETURNS uuid AS $$
  SELECT school_id FROM player WHERE id = p_player
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION player_school(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_school(uuid) TO PUBLIC;

-- Likewise the side they currently play for, which is what decides who may
-- answer a request about them.
CREATE OR REPLACE FUNCTION player_team(p_player uuid) RETURNS text AS $$
  SELECT team_code FROM player WHERE id = p_player
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION player_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_team(uuid) TO PUBLIC;

CREATE TABLE access_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES school(id),
  -- The side the player is wanted FOR, which is the requester's own. Recorded
  -- because "can I have him for the 2nd XI on Saturday" and "I am thinking of
  -- promoting him" are different questions and a coach deciding deserves to
  -- know which one they are answering.
  for_team      text NOT NULL,
  requested_by  uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  reason        text NOT NULL CHECK (reason IN ('promotion','fill_in','selection','other')),
  note          text,
  state         text NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','granted','declined','withdrawn','expired')),
  decided_by    uuid REFERENCES app_user(id),
  decided_at    timestamptz,
  decided_note  text,
  -- The assignment a grant created, so revoking the answer is one UPDATE away
  -- and the audit trail joins up.
  assignment_id uuid REFERENCES role_assignment(id) ON DELETE SET NULL,
  -- Every grant is time-boxed. A permission with no end is a permission
  -- somebody has to remember to take away, and nobody does.
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decided_rows_name_a_decider
    CHECK (state = 'pending' OR state = 'withdrawn' OR decided_by IS NOT NULL)
);
CREATE INDEX ON access_request (player_id) WHERE state = 'pending';
CREATE INDEX ON access_request (requested_by);
-- One open request per coach per player: asking twice is nagging, not a
-- second question, and two pending rows make "decline" ambiguous.
CREATE UNIQUE INDEX ON access_request (player_id, requested_by) WHERE state = 'pending';

-- Hand-written, like notification_read and the scoring tables, because the
-- rule is not one capability against one anchor. Reading a request is
-- governed by being either end of the conversation; writing one is governed
-- at SCHOOL scope, since the whole point is that the requester has no scope
-- over the player yet.
ALTER TABLE access_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_request_read ON access_request
  FOR SELECT USING (
    -- The coach who asked.
    requested_by = app_user_id()
    -- Or a coach who could answer: authority over the player CURRENT side.
    OR app_can('player.access.grant', player_school(access_request.player_id),
               player_team(access_request.player_id),
               access_request.player_id,
               '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Asking is scoped to the SCHOOL, not to the player's team — that is the whole
-- point. It still requires a coaching role at that school: a request is not a
-- way for an unrelated person to start a conversation about a child.
--
-- `for_team` must be a side the requester actually holds, or "I want him for
-- the 2nd XI" becomes a claim anybody can make about any team.
CREATE POLICY access_request_insert ON access_request
  FOR INSERT WITH CHECK (
    requested_by = app_user_id()
    AND state = 'pending'
    AND app_can('player.access.request', access_request.school_id, access_request.for_team,
                '00000000-0000-0000-0000-000000000000'::uuid,
                '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Withdrawing your own request is the only UPDATE anyone does directly.
-- Deciding one goes through access_request_decide() below, because a decision
-- creates an assignment and creating assignments needs authority this policy
-- deliberately does not confer.
CREATE POLICY access_request_update ON access_request
  FOR UPDATE USING (requested_by = app_user_id() AND state = 'pending')
           WITH CHECK (requested_by = app_user_id() AND state = 'withdrawn');

/**
 * Decide a request.
 *
 * SECURITY DEFINER because granting creates a role_assignment, and
 * user.role.assign is a leadership capability a coach does not hold — nor
 * should. The authority being exercised here is narrower and different: not
 * "I may assign roles at this school" but "this is my player, and I say yes".
 *
 * So the function checks that authority ITSELF, first, against the player's
 * CURRENT side. Running as the owner means row-level security is not going to
 * do it for us, and a SECURITY DEFINER function that forgets to check is just
 * a hole with a nice name.
 *
 * Three properties it enforces, in order:
 *
 *   1. The decider must hold player.access.grant over this player's current
 *      team. Not the school — the team. A 2nd XI coach cannot approve access
 *      to a 1st XI player just because they are both coaches.
 *
 *   2. A grant cannot exceed the granter. The `enquiry` bundle is availability
 *      and a name; this asserts the decider actually holds those for this
 *      player, so approving can never hand over something the approver could
 *      not see themselves.
 *
 *   3. Every grant expires. The default is 14 days — long enough to pick a
 *      side, short enough that a season does not silently accumulate standing
 *      access to other people's squads.
 */
CREATE OR REPLACE FUNCTION access_request_decide(
  p_request uuid,
  p_grant   boolean,
  p_note    text DEFAULT NULL,
  p_days    integer DEFAULT 14
) RETURNS TABLE (ok boolean, reason text, assignment uuid) AS $$
DECLARE
  r        access_request%ROWTYPE;
  v_team   text;
  v_assign uuid;
BEGIN
  SELECT * INTO r FROM access_request WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_request', NULL::uuid; RETURN; END IF;
  IF r.state <> 'pending' THEN
    RETURN QUERY SELECT false, 'already_' || r.state, NULL::uuid; RETURN; END IF;

  -- Derived from the player rather than read off the request row. A request
  -- carries a school_id for indexing; the DECISION must not trust it, or a
  -- request naming the wrong school would be answerable by a coach at that
  -- other school.
  v_team := player_team(r.player_id);
  r.school_id := player_school(r.player_id);

  -- (1) authority over THIS player's current side
  IF NOT app_can('player.access.grant', r.school_id, v_team, r.player_id,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_their_player', NULL::uuid; RETURN;
  END IF;

  IF NOT p_grant THEN
    UPDATE access_request
       SET state = 'declined', decided_by = app_user_id(), decided_at = now(),
           decided_note = p_note
     WHERE id = p_request;
    RETURN QUERY SELECT true, NULL::text, NULL::uuid; RETURN;
  END IF;

  -- (2) a grant cannot exceed the granter
  IF NOT (app_can('medical.status.read', r.school_id, v_team, r.player_id,
                  '00000000-0000-0000-0000-000000000000'::uuid)
          AND app_can('player.profile.read', r.school_id, v_team, r.player_id,
                      '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RETURN QUERY SELECT false, 'granter_lacks_access', NULL::uuid; RETURN;
  END IF;

  -- (3) time-boxed, single-player, and narrow by construction
  INSERT INTO role_assignment (person_id, role, school_id, team_code,
                               valid_from, valid_until, created_by)
  VALUES (r.requested_by, 'enquiry', r.school_id, NULL,
          current_date, current_date + make_interval(days => greatest(1, p_days)),
          app_user_id())
  RETURNING id INTO v_assign;

  INSERT INTO assignment_subject (assignment_id, player_id)
  VALUES (v_assign, r.player_id);

  UPDATE access_request
     SET state = 'granted', decided_by = app_user_id(), decided_at = now(),
         decided_note = p_note, assignment_id = v_assign,
         expires_at = now() + make_interval(days => greatest(1, p_days))
   WHERE id = p_request;

  RETURN QUERY SELECT true, NULL::text, v_assign;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION access_request_decide(uuid, boolean, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access_request_decide(uuid, boolean, text, integer) TO PUBLIC;

-- ── When something happens to a child, the right people hear ────
--
-- A trigger rather than a call in the write path, because "record the injury
-- and remember to notify" is a rule someone eventually forgets, and the
-- consequence of forgetting is a parent who was not told.
--
-- WHO RECEIVES IT is not decided here. The notice declares
-- medical.nature.read and names the player it is about, and the read policy on
-- notification does the rest — which lands on exactly the circle of care:
--
--   coaches of the team that player CURRENTLY plays for  (team anchor, and a
--     coach assignment must name a team)
--   school administration                                (school-scoped)
--   the parent or guardian OF THAT CHILD                 (subject list matches)
--   medical staff                                        (school-scoped)
--   the player themselves                                (self-access names them)
--
-- and specifically NOT team mates, whose `player` bundle holds
-- medical.status.read and not medical.nature.read, and not a guardian of a
-- different child in the same side, whose subject list does not name this one.
-- Nobody is listed anywhere; the audience falls out of the capability model.
--
-- SECURITY DEFINER because the notification INSERT policy requires
-- news.publish.team and a physiotherapist does not hold it. The SYSTEM is
-- publishing this, not the person who recorded the injury — and the row it
-- writes is still read back through the ordinary policy, so this widens who is
-- told and never who may know.
--
-- The body carries the NATURE and never the clinical notes. A notification
-- must not exceed the tier it declares, or the feed becomes a way to read a
-- record you could not open — which is the whole reason required_capability
-- exists.
CREATE OR REPLACE FUNCTION notify_injury() RETURNS trigger AS $$
DECLARE
  p        player%ROWTYPE;
  v_title  text;
  v_body   text;
BEGIN
  SELECT * INTO p FROM player WHERE id = NEW.player_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    v_title := 'Injury recorded';
    v_body  := p.full_name || ' has been recorded as injured: ' || NEW.injury_type
               || coalesce(' (' || NEW.severity || ')', '')
               || coalesce('. Expected return ' || NEW.rtw_date::text, '') || '.';
  ELSIF NEW.phase = 'cleared' AND OLD.phase IS DISTINCT FROM 'cleared' THEN
    v_title := 'Cleared to play';
    v_body  := p.full_name || ' has been cleared following ' || NEW.injury_type || '.';
  ELSIF NEW.rtw_date IS DISTINCT FROM OLD.rtw_date THEN
    v_title := 'Return date updated';
    v_body  := p.full_name || ' is now expected back on ' || NEW.rtw_date::text || '.';
  ELSE
    -- A clinical note edited is not an event anyone needs pushed at them.
    RETURN NEW;
  END IF;

  INSERT INTO notification
    (school_id, team_code, scope_level, kind, urgency, title, body,
     required_capability, is_public, subject_kind, subject_id, subject_person_id)
  VALUES
    (NEW.school_id, p.team_code, 'team', 'injury',
     CASE WHEN NEW.severity = 'severe' THEN 'high' ELSE 'medium' END,
     v_title, v_body,
     'medical.nature.read', false, 'injury', NEW.id, NEW.player_id);

  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS injury_notifies ON injury;
CREATE TRIGGER injury_notifies
  AFTER INSERT OR UPDATE ON injury
  FOR EACH ROW EXECUTE FUNCTION notify_injury();

-- ── Conditions ──────────────────────────────────────────────────
-- Keyed to a fixture and scoped through it. Nothing here is personal, but a
-- weather table readable by anyone would quietly answer "does this school have
-- a fixture on Saturday?", so it inherits the fixture's policy rather than
-- being left open on the grounds that rain is not confidential.
CREATE TABLE match_weather (
  match_id      uuid PRIMARY KEY REFERENCES match(id) ON DELETE CASCADE,
  condition     text NOT NULL,
  temp_c        smallint,
  humidity_pct  smallint CHECK (humidity_pct BETWEEN 0 AND 100),
  wind_kph      smallint CHECK (wind_kph >= 0),
  wind_dir      text,
  uv_index      smallint CHECK (uv_index BETWEEN 0 AND 15),
  rain_chance_pct smallint CHECK (rain_chance_pct BETWEEN 0 AND 100),
  forecast      text,
  playable      boolean NOT NULL DEFAULT true,
  observed_at   timestamptz NOT NULL DEFAULT now()
);

-- ── The one policy in this file that is written by hand ─────────
-- Everything else here is governed by db/09_rls_policies.sql, generated from
-- packages/policy/. notification_read is not, because it is not governed by a
-- CAPABILITY at all — it is governed by identity. "Have I read this?" is a
-- question only I can answer about myself, and there is no scope, no role and
-- no assignment involved.
--
-- Forcing it through the capability model would make it worse, not better: the
-- nearest fit is news.read, and a school-wide news.read would then let one
-- person see WHICH notices another person has opened. That is a surveillance
-- affordance nobody asked for, arrived at by trying to be consistent.
--
-- Same pattern as the scoring tables in 02, which are also hand-written for
-- the same reason: their rule is a state machine, not a capability.
ALTER TABLE notification_read ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_read_read ON notification_read
  FOR SELECT USING (person_id = app_user_id());

-- You may only mark a notice read AS YOURSELF, and only a notice you can
-- actually see: the EXISTS re-enters the notification policy rather than
-- trusting the id handed in, so this table cannot be used to probe which
-- notification ids exist.
CREATE POLICY notification_read_insert ON notification_read
  FOR INSERT WITH CHECK (
    person_id = app_user_id()
    AND EXISTS (SELECT 1 FROM notification n WHERE n.id = notification_read.notification_id)
  );

CREATE POLICY notification_read_update ON notification_read
  FOR UPDATE USING (person_id = app_user_id())
           WITH CHECK (person_id = app_user_id());
