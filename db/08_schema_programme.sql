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
  -- TECHNICAL / MENTAL / PHYSICAL — the craft, the head, the body. Grouped
  -- this way rather than by discipline because a boy whose batting has stalled
  -- has either stopped improving technically or stopped concentrating, and
  -- those need opposite conversations. See TREE in packages/scoring/src/rubric.mjs,
  -- which is the one place the attribute set is decided.
  -- Four groups, not the three Football Manager uses. Cricket's game-craft —
  -- rotating strike, setting a field, bowling at the death — is coachable skill
  -- rather than disposition, and folding it into `mental` lost the distinction
  -- a coach actually selects on. See TREE in packages/scoring/src/rubric.mjs.
  category    text NOT NULL CHECK (category IN ('technical','mental','tactical','physical')),
  metric      text NOT NULL,
  -- 1-20, the Football Manager scale: 1-5 poor, 6-10 average, 11-15 good,
  -- 16-20 excellent. Not 0-100, which invites a precision no coach can defend
  -- — the difference between a 63 and a 66 is noise, and noise in a
  -- longitudinal record is indistinguishable from a player changing.
  score       smallint NOT NULL CHECK (score BETWEEN 1 AND 20),
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
  subject_kind text CHECK (subject_kind IN ('match','injury','training','transport','facility','skills','system','competition','selection')),
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

-- ── A fifteen-year-old cannot be picked for a U13 match ─────────
--
-- "U13" means thirteen AND UNDER, so eligibility is an upper bound. Getting it
-- wrong is not a data-quality problem: it is a fifteen-year-old bowling at
-- thirteen-year-olds, which is a safeguarding failure before it is a
-- competitive one, and it is the kind of thing a school is answerable for.
--
-- A TRIGGER, not a check in the selection screen. There are already three ways
-- a squad row can be written — the API, a seed, an import — and "remember to
-- check the age" is a rule that survives exactly as long as the person who
-- knew about it. The database is the only place all three pass through.
--
-- SECURITY DEFINER because it reads player.born, which is masked behind
-- player.age.read. The person picking the side holds that capability; a
-- fixture importer running as the application role may not, and the check must
-- not quietly pass because the trigger could not see a date of birth.
--
-- AGE IS MEASURED AT 1 JANUARY of the year of the match, not on the day. A boy
-- who turns 14 in March plays the whole year in the band he was in on 1
-- January — otherwise a side is legal in February and illegal in April, and a
-- player changes age group mid-season. Confirmed convention, not an assumption.
--
-- THIS FUNCTION ANSWERS FOR SCHOOL CRICKET ONLY, and says so below rather than
-- assuming it.
--
-- Taking the year off the MATCH DATE is only equivalent to taking it off the
-- season because the South African school year is the calendar year: four
-- terms, January to December, cricket in Term 1 and Term 4 of the same one.
-- Both cricket terms sit inside one January-to-December window, so a side
-- cannot change band mid-season.
--
-- Above school level that is false. Club, provincial and national cricket run
-- the southern summer — the 2025/26 season, spring through autumn, with winter
-- given to northern tours and county cricket — so the season straddles 1
-- January and its cut-off is the January in its SECOND year. Using the line
-- below for such a fixture makes every player a year young from September to
-- December, which is a fourteen-year-old passing an under-13 check in October.
--
-- Every fixture in this schema belongs to a school, so the school rule is
-- right today. What is NOT safe is the silence: the team-code CHECK admits
-- U17, U18 and U19 because one constraint cannot know a row's level, so a
-- representative fixture is insertable right now and would be answered with a
-- school calendar. It is refused instead, until `match` carries a level.
--
-- Same convention as SEASON_SPANS_NEW_YEAR in packages/policy/src/teams.mjs,
-- which carries the longer note; change both together.
--
-- An UNKNOWN date of birth does not pass. A squad row for a child whose age
-- nobody recorded is exactly the row this exists to stop, and defaulting to
-- "probably fine" is how a fifteen-year-old ends up in a U13 fixture with a
-- clean audit trail behind him. Open teams have no age limit and are exempt.
CREATE OR REPLACE FUNCTION match_squad_age_eligible() RETURNS trigger AS $$
DECLARE
  v_team   text;
  v_starts timestamptz;
  v_born   date;
  v_limit  int;
  v_age    int;
  v_name   text;
BEGIN
  -- Taking a boy OUT is always allowed. Without this, a player who became
  -- ineligible after selection — a birthday, a withdrawn consent — could not be
  -- removed from the side, because the check that should have stopped him
  -- getting in would now refuse to let him leave.
  IF NEW.withdrawn THEN RETURN NEW; END IF;

  SELECT m.team_code, m.starts_at INTO v_team, v_starts
    FROM match m WHERE m.id = NEW.match_id;
  IF v_team IS NULL THEN RETURN NEW; END IF;

  -- Open teams (1XI, 2XI …) carry no age limit.
  v_limit := NULLIF(substring(v_team FROM '^U([0-9]{1,2})'), '')::int;
  IF v_limit IS NULL THEN RETURN NEW; END IF;

  -- A band no South African school fields. U17, U18 and U19 exist only in
  -- representative cricket, whose season straddles the new year — so the
  -- calendar this function uses is the wrong one for it, and answering anyway
  -- would let a boy through a check that had quietly been computed a year
  -- young. Refuse until a fixture can state its level.
  IF v_limit > 16 THEN
    RAISE EXCEPTION
      'cannot check eligibility for a % fixture: bands above U16 are representative cricket, whose season straddles 1 January, and this fixture does not say what level it is',
      v_team
      USING ERRCODE = 'check_violation';
  END IF;

  -- The away side of a fixture against a school SCRBRD does not host has no
  -- player row and no date of birth we could check. Their eligibility is their
  -- own school's responsibility, and refusing the row would make it impossible
  -- to record the match at all.
  SELECT p.born, p.full_name INTO v_born, v_name FROM player p WHERE p.id = NEW.player_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_born IS NULL THEN
    RAISE EXCEPTION
      'cannot select % for a % match: no date of birth on record, so eligibility cannot be checked',
      coalesce(v_name, NEW.player_id::text), v_team
      USING ERRCODE = 'check_violation';
  END IF;

  v_age := extract(year FROM make_date(extract(year FROM v_starts)::int, 1, 1))
         - extract(year FROM v_born)
         - CASE WHEN make_date(extract(year FROM v_starts)::int, 1, 1)
                     < make_date(extract(year FROM v_starts)::int,
                                 extract(month FROM v_born)::int,
                                 extract(day FROM v_born)::int)
                THEN 1 ELSE 0 END;

  IF v_age > v_limit THEN
    RAISE EXCEPTION
      '% is % on 1 January and cannot play %: the limit is %',
      coalesce(v_name, NEW.player_id::text), v_age, v_team, v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS match_squad_is_age_eligible ON match_squad;
CREATE TRIGGER match_squad_is_age_eligible
  BEFORE INSERT OR UPDATE ON match_squad
  FOR EACH ROW EXECUTE FUNCTION match_squad_age_eligible();

-- ── A boy about to age up ───────────────────────────────────────
--
-- A thirteen-year-old in the U13A side who turns fourteen before the next
-- cut-off is a U14 player next season. Under the 1 January rule he stays
-- eligible for the whole of THIS one — which is exactly why the U14 coaches
-- need to know ahead of the birthday. By the time he is ineligible, the trials
-- have happened and he has missed them.
--
-- A VIEW, NOT A SCHEDULED JOB
-- ──────────────────────────
-- The first version of this published notification rows from a function
-- something was expected to call every morning. That was the wrong shape, and
-- wrong in the way this codebase is most careful about elsewhere: the live
-- score is not a column, career figures are not columns, the ladder is not a
-- column. Materialising a fact that can be derived is how the two drift.
--
-- "Who is ageing up in the next thirty days" is arithmetic on a date that was
-- always there. As a view it is always current, cannot be missed, cannot fire
-- twice, needs no idempotency guard — the guard the job needed existed only
-- because the job could re-run — and cannot disagree with the data, because it
-- IS the data.
--
-- An injury alert is genuinely different and stays an event: an injury HAPPENS
-- at a moment, and nothing about the state of the world afterwards lets you
-- derive that it was recorded on Tuesday. A birthday is not an event. It is a
-- date that has been sitting in the row since the child was registered.
--
-- WHEN THE INBOX ARRIVES it reads this view and decides what to deliver. That
-- keeps two different questions apart — what is TRUE, and who was TOLD — which
-- want different lifetimes, different retention and different read models. A
-- delivered message is not a fact about a player.
--
-- WHO IT REACHES: the next band up AT THE SAME MERIT LEVEL. A U13A player is
-- not a U14 player in general; he is one of the best thirteen-year-olds at the
-- school, and sending him to the U14C because that is where a space happens to
-- be is how a good player is lost. The division letter is preserved.
--
-- U16 is the exception. He ages into the OPEN category, where sides are ranked
-- rather than lettered and he is competing with seventeen- and
-- eighteen-year-olds for the first time. No letter maps honestly to a rank, so
-- every open side is a candidate and the coaches sort it out.
--
-- security_invoker, so a coach sees only the children they may see — which,
-- with the roster, is every child at their own school and none anywhere else.
CREATE OR REPLACE VIEW player_band_change_due
  WITH (security_barrier = true, security_invoker = true) AS
WITH upcoming AS (
  SELECT
    p.id AS player_id, p.school_id, p.full_name, p.team_code, p.born,
    substring(p.team_code FROM '^U([0-9]{1,2})')::int AS band,
    coalesce(substring(p.team_code FROM '^U[0-9]{1,2}([A-F])'), '') AS division,
    make_date(
      CASE WHEN make_date(extract(year FROM current_date)::int,
                          extract(month FROM p.born)::int,
                          extract(day FROM p.born)::int) < current_date
           THEN extract(year FROM current_date)::int + 1
           ELSE extract(year FROM current_date)::int END,
      extract(month FROM p.born)::int,
      extract(day FROM p.born)::int) AS next_birthday
  FROM player p
  WHERE p.born IS NOT NULL
    AND p.team_code ~ '^U[0-9]{1,2}'
),
aged AS (
  SELECT u.*,
         extract(year FROM u.next_birthday)::int - extract(year FROM u.born)::int AS turning,
         -- Their age at the cut-off AFTER that birthday. If it exceeds the band
         -- they are in, they age out of it for the coming season.
         (extract(year FROM u.next_birthday)::int + 1
          - extract(year FROM u.born)::int
          - CASE WHEN make_date(extract(year FROM u.next_birthday)::int + 1, 1, 1)
                      < make_date(extract(year FROM u.next_birthday)::int + 1,
                                  extract(month FROM u.born)::int,
                                  extract(day FROM u.born)::int)
                 THEN 1 ELSE 0 END) AS band_next_season
    FROM upcoming u
)
SELECT
  a.player_id, a.school_id, a.full_name,
  a.team_code                              AS current_team,
  a.band                                   AS current_band,
  a.band_next_season                       AS next_band,
  a.next_birthday,
  a.turning,
  (a.next_birthday - current_date)::int    AS days_until,
  -- The side or sides to trial them for.
  CASE WHEN a.band >= 16
       THEN ARRAY['1XI','2XI','3XI']
       ELSE ARRAY['U' || (a.band + 1)::text || a.division]
  END                                      AS trial_for
FROM aged a
WHERE a.band_next_season > a.band
  AND a.next_birthday >= current_date
  AND a.next_birthday <= current_date + 30;

-- ── Who read what about a child ─────────────────────────────────
--
-- This is the table SCRBRD produces to the Information Regulator, or to a
-- parent who asks who has been reading their child's record. Append-only, and
-- written by the system rather than by anything a person controls.
--
-- WHERE IT IS WRITTEN, AND WHY NOT WHERE THE SPEC SAYS
-- ───────────────────────────────────────────────────
-- The spec says "written inside getData()". getData() is in the BROWSER, and
-- in this codebase it now refuses outright once a session exists — the choke
-- point moved to the API and the row-level policies behind it. A log written
-- in the browser would be a log the reader can switch off, which is not a log.
--
-- So it is written in the read path, on the server, after the rows come back:
-- one place, on the far side of the policy that decided what those rows were.
--
-- WHAT IT RECORDS
-- ───────────────
-- Not "what the query asked for" — what the reader ACTUALLY RECEIVED. Masking
-- is per row and per capability, so two people running the same query get
-- different columns back, and logging the query would record a disclosure that
-- never happened for one of them and miss the shape of the one that did.
CREATE TABLE access_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid REFERENCES school(id),
  person_id    uuid NOT NULL REFERENCES app_user(id),
  resource     text NOT NULL,
  -- The ids actually returned, capped. A roster read is a disclosure about
  -- every child in it, and "they read the roster" without saying whose records
  -- were in it is not an answer to a parent's question.
  record_ids   uuid[] NOT NULL DEFAULT '{}',
  record_count integer NOT NULL DEFAULT 0,
  -- The restricted columns that came back non-null for at least one row. This
  -- is the difference between "opened the injuries screen" and "read a child's
  -- physiotherapy notes", and only the second is a disclosure worth the name.
  fields       text[] NOT NULL DEFAULT '{}',
  device_id    text,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON access_log (person_id, occurred_at DESC);
CREATE INDEX ON access_log (school_id, occurred_at DESC);
-- The question a parent actually asks: who has read MY child's record.
CREATE INDEX ON access_log USING gin (record_ids);

ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;

-- Readable by whoever may audit, at their own school. NOT by the person who
-- generated the entries: a log the subject can read is a log the subject can
-- be pressured about, and a log the reader can read tells them exactly what to
-- avoid next time.
CREATE POLICY access_log_read ON access_log
  FOR SELECT USING (
    app_can('audit.read', access_log.school_id, '*'::text,
            '00000000-0000-0000-0000-000000000000'::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- No INSERT policy, no UPDATE policy, no DELETE policy. The application role
-- cannot write this table at all; the only way a row appears is
-- log_restricted_read() below, which runs as the owner. An audit log the
-- audited party can append to is a diary.

/**
 * Record a restricted read.
 *
 * SECURITY DEFINER because access_log has no INSERT policy and the application
 * role has no way to write it directly. That is the point: a log the reader
 * can forge is worth nothing, and one they can suppress is worth less.
 *
 * Deliberately cannot fail the read it is logging. A logging failure must not
 * turn into a coach being unable to see whether a boy is fit to play on a
 * Saturday morning — the exception is swallowed and the read proceeds. That is
 * a trade, and the right way round: an unlogged disclosure is a compliance
 * problem, a blocked one is a safeguarding problem.
 */
CREATE OR REPLACE FUNCTION log_restricted_read(
  p_resource text,
  p_ids      uuid[],
  p_fields   text[],
  p_school   uuid DEFAULT NULL
) RETURNS void AS $$
BEGIN
  IF app_user_id() IS NULL THEN RETURN; END IF;
  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count,
                          fields, device_id)
  VALUES (p_school, app_user_id(), p_resource,
          coalesce(p_ids, '{}'), coalesce(array_length(p_ids, 1), 0),
          coalesce(p_fields, '{}'), app_device_id());
EXCEPTION WHEN OTHERS THEN
  -- See above. Never let the log break the read.
  NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION log_restricted_read(text, uuid[], text[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_restricted_read(text, uuid[], text[], uuid) TO PUBLIC;

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

  -- Verified by construction, and by the person who decided. `enquiry` is
  -- subject-scoped, so a link left pending would grant the requesting coach
  -- nothing at all — the grant would silently be no grant. The DECISION is the
  -- verification here: the coach who owns this player said yes, by name.
  INSERT INTO assignment_subject
    (assignment_id, player_id, relationship, verification_state,
     verified_by, verified_at, created_by, valid_until)
  VALUES (v_assign, r.player_id, 'enquiry', 'verified',
          app_user_id(), now(), app_user_id(),
          current_date + make_interval(days => greatest(1, p_days)));

  UPDATE access_request
     SET state = 'granted', decided_by = app_user_id(), decided_at = now(),
         decided_note = p_note, assignment_id = v_assign,
         expires_at = now() + make_interval(days => greatest(1, p_days))
   WHERE id = p_request;

  RETURN QUERY SELECT true, NULL::text, v_assign;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION access_request_decide(uuid, boolean, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access_request_decide(uuid, boolean, text, integer) TO PUBLIC;

-- ── The link between a child and the adult responsible for them ──
--
-- POPIA does not let a school process a minor's information because somebody
-- said they were the parent. §12.2 of the permissions scope puts it as a hard
-- rule: every minor has a VERIFIED guardian link. Until this section existed,
-- assignment_subject carried the relationship and nothing carried the
-- verification, so a link typed into a form was indistinguishable from one an
-- administrator had checked against a birth certificate.
--
-- The lifecycle lives on the link itself (db/00_schema_core.sql) rather than in
-- a second `guardian_links` table, for the reason given there: two tables would
-- be two answers to "may this person reach this child", and a revoked link with
-- a live subject row is not a bug anybody notices.
--
-- WHAT EACH STATE DOES, because they are easy to conflate:
--
--   verification  governs ACCESS. app_can() counts only verified, unended
--                 links, so an unverified link reaches nothing at all.
--   consent       governs PROCESSING. A school can be certain who a boy's
--                 mother is and still not have her consent. Withdrawing it does
--                 NOT blind her to her own child's record — that would punish
--                 the parent for exercising the right — it makes the CHILD
--                 unregistered, which is what stops him being selected.
--
-- ALL FOUR ACTS ARE FUNCTIONS, not policies, because assignment_subject has no
-- INSERT, UPDATE or DELETE policy at all: there is no way to write a link from
-- the application role except through these, and each one checks its own
-- authority. A SECURITY DEFINER function that forgets to check is a hole with a
-- nice name, so each check is written out rather than inherited.

/**
 * Record a claimed relationship. It is created PENDING and reaches nothing.
 *
 * Three refusals, in order:
 *
 *   1. The caller must hold guardian.link.manage at the CHILD'S school. Not
 *      their own — a school office may not link a child at another school.
 *   2. Nobody may create a link that grants THEMSELVES access. This is §12.11
 *      (no role is self-assignable) applied to the one relationship where
 *      self-assignment would be most useful and least visible.
 *   3. A coach may not be linked to a child in a side they coach. §6.3's third
 *      constraint, and the sharpest of the three: a coach who becomes the
 *      "guardian" of a boy they already coach converts a scoped, term-limited,
 *      revocable coaching relationship into a standing personal one over that
 *      child's whole record. It is refused whoever asks, including the office.
 */
CREATE OR REPLACE FUNCTION guardian_link_establish(
  p_guardian     uuid,
  p_player       uuid,
  p_relationship text DEFAULT 'parent'
) RETURNS TABLE (ok boolean, reason text, assignment uuid) AS $$
DECLARE
  v_school uuid;
  v_team   text;
  v_assign uuid;
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

  -- One guardian assignment per person per school, reused. A second would not
  -- be wrong, but it would split one parent's children across two rows and make
  -- "end this person's guardianship" two operations instead of one.
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
                AND g.valid_until IS NULL) THEN
    RETURN QUERY SELECT false, 'already_linked', v_assign; RETURN;
  END IF;

  INSERT INTO assignment_subject
    (assignment_id, player_id, relationship, created_by)
  VALUES (v_assign, p_player, p_relationship, app_user_id());

  RETURN QUERY SELECT true, NULL::text, v_assign;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION guardian_link_establish(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guardian_link_establish(uuid, uuid, text) TO PUBLIC;

/**
 * Verify a link — the act that turns a claim into a permission — and, when a
 * consent version is given, record the consent taken at the same time.
 *
 * Consent is a separate argument rather than a separate state change because a
 * school takes both off the same signed form; passing NULL records the identity
 * check alone and leaves consent pending, which is the case where a form came
 * back with the certificate attached and the consent box unticked.
 *
 * verified_by is app_user_id() and cannot be passed in. Who checked the
 * paperwork is the entire value of the record.
 */
CREATE OR REPLACE FUNCTION guardian_link_verify(
  p_guardian        uuid,
  p_player          uuid,
  p_consent_version text DEFAULT NULL,
  p_note            text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_school uuid;
  v_rows   int;
BEGIN
  v_school := player_school(p_player);
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;

  IF NOT app_can('guardian.link.manage', v_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;

  -- No check for a missing session: app_can() above compares app_user_id()
  -- against role_assignment.person_id, and NULL matches nothing, so a
  -- sessionless caller is already refused as 'not_permitted'.
  IF p_guardian = app_user_id() THEN RETURN QUERY SELECT false, 'self_verified'; RETURN; END IF;

  UPDATE assignment_subject g
     SET verification_state = 'verified',
         verified_by        = app_user_id(),
         verified_at        = now(),
         verified_note      = p_note,
         consent_state      = CASE WHEN p_consent_version IS NULL
                                   THEN g.consent_state ELSE 'granted' END,
         consent_version    = coalesce(p_consent_version, g.consent_version),
         consent_at         = CASE WHEN p_consent_version IS NULL
                                   THEN g.consent_at ELSE now() END
   WHERE g.player_id = p_player
     AND g.valid_until IS NULL
     AND g.verification_state = 'pending'
     AND EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.id = g.assignment_id
                    AND a.person_id = p_guardian AND a.role = 'guardian');
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN RETURN QUERY SELECT false, 'no_pending_link'; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION guardian_link_verify(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guardian_link_verify(uuid, uuid, text, text) TO PUBLIC;

/**
 * End a link. It is end-dated and marked revoked, never deleted: "who could
 * read this child's record in March" is a question a school has to answer in
 * September.
 *
 * §6.3's second constraint — THE LAST VERIFIED LINK OF A MINOR CANNOT BE
 * REVOKED — is enforced here. Not because the relationship cannot end, but
 * because ending the last one silently would leave a child on the system with
 * nobody accountable for him and nothing to say so. Link the new guardian
 * first; then this succeeds.
 */
CREATE OR REPLACE FUNCTION guardian_link_revoke(
  p_guardian uuid,
  p_player   uuid,
  p_note     text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_school uuid;
  v_minor  boolean;
  v_live   int;
  v_rows   int;
BEGIN
  v_school := player_school(p_player);
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;

  IF NOT app_can('guardian.link.manage', v_school, '*'::text,
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;

  SELECT s.is_minor, s.live_links INTO v_minor, v_live
    FROM player_guardian_status s WHERE s.player_id = p_player;

  IF coalesce(v_minor, true) AND coalesce(v_live, 0) <= 1 THEN
    RETURN QUERY SELECT false, 'last_verified_link'; RETURN;
  END IF;

  UPDATE assignment_subject g
     SET verification_state = 'revoked',
         valid_until        = current_date,
         verified_note      = coalesce(p_note, g.verified_note)
   WHERE g.player_id = p_player
     AND g.valid_until IS NULL
     AND g.verification_state IN ('pending','verified')
     AND EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.id = g.assignment_id
                    AND a.person_id = p_guardian AND a.role = 'guardian');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN QUERY SELECT false, 'no_open_link'; RETURN; END IF;

  -- A guardian assignment naming nobody live already reaches nothing —
  -- app_can() refuses subject-scoped roles that name no live person — but
  -- leaving it active would misrepresent the register. End it.
  UPDATE role_assignment a
     SET active = false, valid_until = current_date
   WHERE a.person_id = p_guardian AND a.role = 'guardian'
     AND a.school_id = v_school AND a.active
     AND NOT EXISTS (SELECT 1 FROM assignment_subject g
                      WHERE g.assignment_id = a.id
                        AND g.verification_state = 'verified'
                        AND g.valid_from <= current_date
                        AND (g.valid_until IS NULL OR g.valid_until > current_date));

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION guardian_link_revoke(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guardian_link_revoke(uuid, uuid, text) TO PUBLIC;

/**
 * Record consent, on a link that is already verified.
 *
 * Verification and consent arrive together on one form often enough that
 * guardian_link_verify() takes both — and separately often enough that this
 * exists. A certificate comes back with the consent box unticked, the office
 * verifies the identity, and the signed consent follows a week later; without
 * this the only way to record it would be to revoke the link and start again,
 * which would blind the parent in the meantime for a paperwork reason.
 *
 * The guardian may record their own consent, for the same reason they may
 * withdraw it: it is theirs.
 */
CREATE OR REPLACE FUNCTION guardian_consent_record(
  p_guardian uuid,
  p_player   uuid,
  p_version  text
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_school uuid;
  v_rows   int;
BEGIN
  IF p_version IS NULL OR btrim(p_version) = '' THEN
    RETURN QUERY SELECT false, 'no_consent_version'; RETURN;
  END IF;

  v_school := player_school(p_player);
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;

  IF NOT (p_guardian = app_user_id()
          OR app_can('guardian.link.manage', v_school, '*'::text,
                     '00000000-0000-0000-0000-000000000000'::uuid,
                     '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;

  UPDATE assignment_subject g
     SET consent_state = 'granted', consent_version = p_version, consent_at = now()
   WHERE g.player_id = p_player
     AND g.valid_until IS NULL
     AND g.verification_state = 'verified'
     AND EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.id = g.assignment_id
                    AND a.person_id = p_guardian AND a.role = 'guardian');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN QUERY SELECT false, 'no_verified_link'; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION guardian_consent_record(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guardian_consent_record(uuid, uuid, text) TO PUBLIC;

/**
 * Withdraw consent.
 *
 * The one act on a link a GUARDIAN may perform themselves, because it is their
 * consent and a right that has to be asked for is not a right. The office may
 * also record it, for the parent who telephones.
 *
 * It does not touch verification, so the parent keeps sight of their own
 * child's record. What changes is the CHILD's registration state, and the
 * consequence of that is that he cannot be selected until it is resolved —
 * which is a conversation with the school, not a silent loss of access.
 */
CREATE OR REPLACE FUNCTION guardian_consent_withdraw(
  p_guardian uuid,
  p_player   uuid
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_school uuid;
  v_rows   int;
BEGIN
  v_school := player_school(p_player);
  IF v_school IS NULL THEN RETURN QUERY SELECT false, 'no_such_player'; RETURN; END IF;

  IF NOT (p_guardian = app_user_id()
          OR app_can('guardian.link.manage', v_school, '*'::text,
                     '00000000-0000-0000-0000-000000000000'::uuid,
                     '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;

  UPDATE assignment_subject g
     SET consent_state = 'withdrawn'
   WHERE g.player_id = p_player
     AND g.valid_until IS NULL
     AND g.consent_state = 'granted'
     AND EXISTS (SELECT 1 FROM role_assignment a
                  WHERE a.id = g.assignment_id
                    AND a.person_id = p_guardian AND a.role = 'guardian');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN QUERY SELECT false, 'no_consent_to_withdraw'; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION guardian_consent_withdraw(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION guardian_consent_withdraw(uuid, uuid) TO PUBLIC;

-- ── Whether a child is registered: DERIVED, not a flag ──────────
--
-- §12.2 says no minor may be ACTIVE without a verified guardian link. The
-- obvious implementation is a boolean on `player` and a trigger that guards it,
-- and this codebase has learned twice over what that costs: a stored fact that
-- can be derived is a fact that will eventually disagree with what it was
-- derived from. The live score is not a column, career figures are not columns,
-- the ladder is not a column, and the ageing-up notice stopped being a
-- scheduled job for the same reason.
--
-- So a child is not marked active. A child IS active, or is not, according to
-- the links that exist right now:
--
--   active                — an adult, or a minor with a verified, consented
--                           guardian link
--   pending_consent       — verified, but nobody has consented to processing
--   pending_verification  — somebody claimed the relationship; nobody checked
--   unlinked              — no guardian at all
--
-- A REVOKED link counts for nothing here. The first draft counted every row
-- ever written, which made a child whose only guardian had been revoked look
-- like a child somebody had merely not got round to verifying — the mildest of
-- the four states, for what is actually the worst of them.
--
-- MINOR means actual age today, not the 1 January cricket cut-off. The cut-off
-- decides which side a boy plays for; it has nothing to do with whether the law
-- treats him as a child.
--
-- An UNKNOWN date of birth counts as a minor. Same reasoning as the eligibility
-- trigger: the child whose age nobody recorded is exactly the one this exists
-- to protect.
--
-- security_invoker so the office sees the children they may read and no others.
-- The counts, as a SECURITY DEFINER function rather than a join inside the
-- view, and this is the whole reason the view has one.
--
-- security_invoker decides WHICH CHILDREN you see, which is the disclosure that
-- matters and belongs to `player`'s own policy. It must not also decide whether
-- the counts are right: `role_assignment` and `assignment_subject` are
-- themselves RLS-protected, so an invoker who may see a child but not other
-- people's assignments would read live_links = 0 for a child with two verified
-- guardians. A view that answers "this child has no guardian" to some readers
-- and "two" to others is worse than one that refuses — the zero looks like an
-- answer.
CREATE OR REPLACE FUNCTION player_guardian_link_counts(p_player uuid)
RETURNS TABLE (open_links int, live_links int, consented_links int) AS $$
  SELECT count(*) FILTER (
           WHERE g.verification_state IN ('pending','verified')
             AND g.valid_from <= current_date
             AND (g.valid_until IS NULL OR g.valid_until > current_date))::int,
         count(*) FILTER (
           WHERE g.verification_state = 'verified'
             AND g.valid_from <= current_date
             AND (g.valid_until IS NULL OR g.valid_until > current_date))::int,
         count(*) FILTER (
           WHERE g.verification_state = 'verified'
             AND g.consent_state = 'granted'
             AND g.valid_from <= current_date
             AND (g.valid_until IS NULL OR g.valid_until > current_date))::int
    FROM assignment_subject g
    JOIN role_assignment a ON a.id = g.assignment_id
   WHERE g.player_id = p_player AND a.role = 'guardian'
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION player_guardian_link_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION player_guardian_link_counts(uuid) TO PUBLIC;

CREATE OR REPLACE VIEW player_guardian_status
WITH (security_invoker = true) AS
SELECT p.id AS player_id,
       p.school_id,
       p.team_code,
       p.full_name,
       (p.born IS NULL OR p.born > current_date - interval '18 years') AS is_minor,
       coalesce(l.open_links,      0) AS open_links,
       coalesce(l.live_links,      0) AS live_links,
       coalesce(l.consented_links, 0) AS consented_links,
       CASE
         WHEN NOT (p.born IS NULL OR p.born > current_date - interval '18 years') THEN 'active'
         WHEN coalesce(l.consented_links, 0) > 0 THEN 'active'
         WHEN coalesce(l.live_links,      0) > 0 THEN 'pending_consent'
         WHEN coalesce(l.open_links,      0) > 0 THEN 'pending_verification'
         ELSE 'unlinked'
       END AS registration_state
  FROM player p
  LEFT JOIN LATERAL player_guardian_link_counts(p.id) l ON true;

GRANT SELECT ON player_guardian_status TO scrbrd_app;

-- ── An unregistered child is not selected ───────────────────────
--
-- Where the derived state BITES. Without this the view is a report nobody
-- reads, and §12.2 is a sentence in a document.
--
-- Selection is the right edge for it. It is the moment a school acts on a
-- child's data in a way that puts him on a field, in a result, and in a
-- published scorecard — and it is already the moment the database checks
-- whether he is old enough, so the office is already used to a squad row being
-- refused with a reason.
--
-- A SEPARATE trigger from the age check on purpose: two rules, two failures,
-- two messages. Folding them together would mean a squad refusal that says
-- "ineligible" when what is actually missing is a signature from a parent.
CREATE OR REPLACE FUNCTION match_squad_is_registered() RETURNS trigger AS $$
DECLARE
  v_state text;
  v_name  text;
BEGIN
  -- Taking a boy OUT is always allowed. Without this, a player who became
  -- ineligible after selection — a birthday, a withdrawn consent — could not be
  -- removed from the side, because the check that should have stopped him
  -- getting in would now refuse to let him leave.
  IF NEW.withdrawn THEN RETURN NEW; END IF;

  SELECT s.registration_state, s.full_name INTO v_state, v_name
    FROM player_guardian_status s WHERE s.player_id = NEW.player_id;

  -- No player row: the away side of a fixture against a school SCRBRD does not
  -- host. Their registration is their own school's responsibility, exactly as
  -- their eligibility is.
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_state <> 'active' THEN
    RAISE EXCEPTION
      'cannot select %: not registered to play (%). A minor needs a verified guardian link and consent before he is selected',
      coalesce(v_name, NEW.player_id::text), v_state
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS match_squad_is_registered ON match_squad;
CREATE TRIGGER match_squad_is_registered
  BEFORE INSERT OR UPDATE ON match_squad
  FOR EACH ROW EXECUTE FUNCTION match_squad_is_registered();

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
-- ── The pitch report ────────────────────────────────────────────
-- What the square is like before a ball is bowled, written down by the person
-- who prepared it. Captains read it before the toss; a coach reads it a season
-- later to work out why their spinners went for nine an over.
--
-- Deliberately NOT carrying a "playable" flag. match_weather already has one,
-- and whether a match goes ahead is the umpire's call under Law 2.7 — a
-- groundsman's assessment feeds that decision and does not make it. Two tables
-- both claiming to say whether play happens is how they end up disagreeing.
--
-- One report per match, like the toss: a pitch reported twice was reported
-- once and corrected. Every field is nullable except the match it belongs to,
-- because a groundsman filling in three of eight boxes on a wet Friday is
-- still worth more than nothing, and a form that demands all eight gets
-- abandoned or invented.
-- ── The derby ────────────────────────────────────────────────────
--
-- WHAT IS STORED HERE, AND WHAT IS DELIBERATELY NOT
-- ─────────────────────────────────────────────────
-- scrbrd-beta-2 carried a DerbyRecord holding totalClashes, winsA, winsB and
-- draws. Those are counts of rows that exist, kept beside the rows they count,
-- which is the same shape as every stored aggregate this codebase has removed:
-- a scorecard corrected in March silently leaves the tally wrong for ever, and
-- nothing in the product can say which of the two numbers is right.
--
-- So the tally is not here. It is derived from the fixtures at read time (see
-- `derby_record` in read-api.mjs) and inherits the reader's own scope, exactly
-- as career figures and phase breakdowns do — two people may legitimately see
-- different totals for the same rivalry, because they may see different
-- matches, and that is the model working.
--
-- What IS here is the part no query could ever produce: that this fixture is
-- called The Michaelhouse Derby and has been played since 1892. Nobody can
-- compute a name or a founding year from a list of matches.
--
-- The opponent is free text because it must be: a school SCRBRD does not host
-- has no row to point at, which is the same reason match.opponent is text.
CREATE TABLE derby (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  opponent    text NOT NULL CHECK (length(btrim(opponent)) > 0),
  title       text NOT NULL CHECK (length(btrim(title)) > 0),
  -- Nullable: plenty of rivalries are real and nobody remembers when they
  -- started. A guessed year is worse than an absent one.
  since_year  smallint CHECK (since_year IS NULL OR since_year BETWEEN 1800 AND 2200),
  notes       text CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by  uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- One name per rivalry. Case-insensitive because "Michaelhouse" and
-- "michaelhouse" are the same school and a second row would split the record.
CREATE UNIQUE INDEX ON derby (school_id, lower(btrim(opponent)));

-- ── The curator's record of a ground ─────────────────────────────
--
-- match_pitch_report below describes the square PREPARED FOR ONE FIXTURE. This
-- describes the ground itself, which is a different fact with a different
-- author and a different lifetime: a groundsman rolls, mows and waters a
-- square across a season, and the last time it was cut is not a property of
-- Saturday's match.
--
-- The distinction matters practically. "How long after the rain stops before
-- we can play?" is the single most asked question of a school groundsman on a
-- wet morning, and the answer is a property of that ground's drainage — not
-- of the fixture that happens to be scheduled on it. Recording it per match
-- would mean storing the same number against every fixture at that venue and
-- watching the copies drift.
--
-- One current record per ground, like the pitch report is one per match. A
-- ground reported twice was reported once and corrected. Every field is
-- nullable but the ground: a groundsman who measures moisture and nothing else
-- is still worth more than an empty table, and a form demanding all seven gets
-- abandoned or invented — the same reasoning as the pitch report.
CREATE TABLE ground_condition (
  ground_id     uuid PRIMARY KEY REFERENCES ground(id) ON DELETE CASCADE,
  -- Derived at write time from the ground, never asserted by the caller.
  school_id     uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  moisture_pct  smallint CHECK (moisture_pct IS NULL OR moisture_pct BETWEEN 0 AND 100),
  grass_mm      smallint CHECK (grass_mm IS NULL OR grass_mm BETWEEN 0 AND 100),
  roller        text CHECK (roller IS NULL OR roller IN ('none','light','heavy')),
  outfield      text CHECK (outfield IS NULL OR outfield IN ('fast','medium','slow')),
  -- Minutes from the rain stopping to the ground being playable. Ten hours is
  -- the ceiling because beyond that the answer is "not today", which is a
  -- decision rather than a drainage time.
  drainage_min  smallint CHECK (drainage_min IS NULL OR drainage_min BETWEEN 0 AND 600),
  last_rolled   date,
  last_mown     date,
  notes         text CHECK (notes IS NULL OR length(notes) <= 2000),
  reported_by   uuid REFERENCES app_user(id),
  reported_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ground_condition (school_id);

CREATE TABLE match_pitch_report (
  match_id    uuid PRIMARY KEY REFERENCES match(id) ON DELETE CASCADE,
  -- Derived at write time from the match, never asserted by the caller: a row
  -- whose school disagrees with its match is invisible to the read policy.
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  surface     text CHECK (surface IS NULL OR surface IN ('hard','firm','soft','damp')),
  grass       text CHECK (grass   IS NULL OR grass   IN ('bare','light','covered','green')),
  bounce      text CHECK (bounce  IS NULL OR bounce  IN ('low','even','variable','steep')),
  pace        text CHECK (pace    IS NULL OR pace    IN ('slow','medium','quick')),
  -- The DEGREE, beside the character above. These are not the same fact twice:
  -- 'variable' is not a point on a scale and cannot be written as a number,
  -- while "steep" covers everything from awkward to unplayable and a season's
  -- worth of squares cannot be compared on four words. A groundsman says
  -- "two-paced" out loud; a director of sport asking which of five squares has
  -- got slower since September needs the number. Either may be given alone.
  bounce_rating smallint CHECK (bounce_rating IS NULL OR bounce_rating BETWEEN 1 AND 10),
  pace_rating   smallint CHECK (pace_rating   IS NULL OR pace_rating   BETWEEN 1 AND 10),
  -- How fast the outfield is running, which decides whether a well-timed shot
  -- is two or four and is a different question from how the square plays.
  outfield    text CHECK (outfield IS NULL OR outfield IN ('fast','medium','slow')),
  -- What the square is expected to reward. An estimate made before play, kept
  -- so it can be read back against what actually happened.
  favours     text CHECK (favours IS NULL OR favours IN ('seam','spin','batting','even')),
  covers_on   boolean,
  notes       text CHECK (notes IS NULL OR length(notes) <= 2000),
  reported_by uuid REFERENCES app_user(id),
  reported_at timestamptz NOT NULL DEFAULT now()
);

-- ── Who stood in the middle ──────────────────────────────────────
--
-- `officiating.assign` has existed since the first capability table and three
-- roles hold it. There was nothing to assign: no table, so no appointment, so
-- a capability that could never be exercised and an `official` role with
-- nothing behind it. The scorecard's "scorer" pill read a mock-only field.
--
-- WHY THE NAME IS STORED AND NOT JOINED
-- ─────────────────────────────────────
-- `person_name` is NOT NULL and `person_id` is the optional link. Most school
-- umpires have no account here at all — they come off a union panel and stand
-- at four different schools in a season — so an appointment that could only
-- name an app_user could not record the majority of real appointments.
--
-- Storing the name also means a read never joins app_user. That join would run
-- under the reader's own row-level security, so a parent who may see the
-- fixture but not the staff directory would get an appointment with a blank
-- name rather than a refusal: the silent-empty-join failure this schema has
-- been bitten by before. And the name as appointed is part of the record — an
-- account renamed in 2027 must not quietly rewrite who umpired in 2026.
--
-- NOT CONSTRAINED TO TWO UMPIRES. A men's Test has two on-field umpires and a
-- third; an U14 fixture on a wet Tuesday often has one, or a parent standing
-- at square leg. A constraint asserting the professional shape would refuse
-- the ordinary case, and the ordinary case is the one this product is for.
CREATE TABLE match_official (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id     uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  -- Derived at write time from the match, never asserted by the caller —
  -- the same rule as ball_event and match_pitch_report.
  school_id    uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  duty         text NOT NULL CHECK (duty IN ('umpire','third_umpire','scorer','referee')),
  person_name  text NOT NULL CHECK (length(btrim(person_name)) > 0),
  -- Set when the official holds an account here, which is what lets them file
  -- a report later under officiating.report. Null for everyone else.
  person_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  panel        text,                            -- the union or association
  -- Standing an official down is an UPDATE, never a DELETE. No table in this
  -- schema has a DELETE policy for any role, and who was originally appointed
  -- and later withdrawn is exactly the sort of thing a disputed fixture needs.
  withdrawn    boolean NOT NULL DEFAULT false,
  appointed_by uuid REFERENCES app_user(id),
  appointed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON match_official (match_id);
CREATE INDEX ON match_official (school_id);
-- The same person twice on the same duty is a mis-tick, in either identity
-- form. Partial, because a withdrawn appointment must not block re-appointing
-- the person it names.
CREATE UNIQUE INDEX ON match_official (match_id, duty, person_id)
  WHERE person_id IS NOT NULL AND NOT withdrawn;
CREATE UNIQUE INDEX ON match_official (match_id, duty, lower(btrim(person_name)))
  WHERE person_id IS NULL AND NOT withdrawn;

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

-- ── A coach's own writing about a player ────────────────────────
--
-- The attribute set is 33 numbers and a child is not. "He has gone quiet since
-- his father started coming to matches", "won't play the pull shot since he was
-- hit", "runs the drinks without being asked" — none of that has a column, all
-- of it is coaching, and the first two are the reason a rating moves.
--
-- WHO READS IT is deliberately narrower than who reads the ratings beside it.
-- player_skill is readable by the pupil himself; a note is not. The asymmetry
-- is a policy decision with a POPIA exposure named in
-- packages/policy/src/capabilities.mjs, and every read of one is logged.
--
-- HOW IT REACHES THE ALGORITHM, and the part worth being careful about:
-- NOTHING HERE PARSES THE PROSE. A system that read a coach's sentence and
-- decided a number from it would be inventing a judgement and attributing it to
-- a named person. So a note that is meant to move a rating carries the signal
-- EXPLICITLY — which discipline, and by how much — and the prose stays what it
-- is, the reasoning a human reads. The coach states the conclusion; the
-- paragraph explains it.
CREATE TABLE development_note (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- Denormalised from the player so the row states its own tenant. A policy
  -- anchor that has to join to find its school is one that returns NULL for a
  -- reader who cannot see the player, and a NULL anchor narrows — which would
  -- be right by accident here and wrong the first time somebody reuses it.
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES app_user(id),
  body        text NOT NULL CHECK (length(btrim(body)) > 0),
  -- The structured signal, both nullable: a note that is purely narrative
  -- moves nothing, which is the common case and the default.
  about_discipline text CHECK (about_discipline IS NULL
                    OR about_discipline IN ('batting','bowling','fielding','keeping')),
  -- Bounded on purpose. A coach who wants to move a rating by more than this
  -- has changed their mind about the player rather than observed one thing, and
  -- the honest way to say that is a fresh assessment — which re-anchors, and
  -- supersedes every note written before it.
  adjustment  smallint CHECK (adjustment IS NULL OR adjustment BETWEEN -3 AND 3),
  observed_on date NOT NULL DEFAULT current_date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz,
  CONSTRAINT adjustment_names_its_subject
    CHECK (adjustment IS NULL OR about_discipline IS NOT NULL)
);
CREATE INDEX ON development_note (player_id, observed_on DESC);
CREATE INDEX ON development_note (author_id);

-- The author is WHOEVER IS WRITING, not whoever the payload says. A column
-- recording authorship that the writer can set is a column that cannot be
-- relied on in the one conversation it exists for.
CREATE OR REPLACE FUNCTION development_note_author() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.author_id := coalesce(app_user_id(), NEW.author_id);
  ELSE
    -- A colleague who coaches the same side holds player.note.write and can
    -- therefore reach this row through the policy. That is right for writing
    -- their OWN note about the player and wrong for editing mine: a
    -- development record whose author is fixed but whose text anybody can
    -- rewrite records the wrong person's judgement under my name.
    IF app_user_id() IS NOT NULL AND OLD.author_id <> app_user_id() THEN
      -- SQLSTATE class 45 is unassigned by Postgres and by the standard, so it
      -- is free for an application to mean something with. It has to be
      -- distinct from 42501: that is what row-level security raises, and
      -- "this is not your player" and "this is not your note" are different
      -- refusals with different fixes. Mapped in
      -- services/api/write/assessment-api.mjs.
      RAISE EXCEPTION 'a development note may only be edited by the coach who wrote it'
        USING ERRCODE = '45001';
    END IF;
    NEW.author_id := OLD.author_id;      -- authorship never changes hands
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS development_note_records_its_author ON development_note;
CREATE TRIGGER development_note_records_its_author
  BEFORE INSERT OR UPDATE ON development_note
  FOR EACH ROW EXECUTE FUNCTION development_note_author();


-- ════════════════════════════════════════════════════════════════
--  Scouting: a primitive, not a feature
-- ════════════════════════════════════════════════════════════════
-- Two tables and one gated read. Everything here answers one question: what
-- does a real accredited scout — a provincial union, a university programme,
-- a franchise academy — get to see, and who decided they may see it.
--
-- THE ANSWER, in one sentence: nobody, of anybody, until that specific
-- child's guardian has said so, and even then only to a scout whose
-- organisation has been checked. Not the school. Not a subscription tier.
-- The guardian, and only the guardian — see scouting_consent_set() below for
-- why that is not negotiable.
--
-- "Subscriptions can reduce the information someone receives. They can never
-- expand what someone may know" governs a pay-gate the same way it governs a
-- notification filter: an organisation paying for scouting access buys a
-- NARROWER view of what consent already permits, never a wider one. There is
-- no code path anywhere in this section that a payment status could widen —
-- entitlement, if it is ever built, is a further AND on scouting_candidates(),
-- intersected with everything here, never a replacement for any of it.

-- Who is allowed to look, from the outside.
--
-- The `scout` role (packages/policy/src/roles.mjs) holds scouting.read and
-- scouting.write, and neither means anything on its own: they say a person
-- may act AS a scout, not that any particular organisation vouches for them.
-- This table is that vouching, and it is what scouting_candidates() actually
-- checks — a person holding the role but not verified here sees nothing,
-- which is the ordinary case for a brand-new registration.
CREATE TABLE scout_accreditation (
  -- One accreditation per person. A scout who changes organisation is a new
  -- fact, recorded by updating this row and re-verifying — not a second row,
  -- which would let an old, unrevoked accreditation quietly keep working.
  person_id           uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  organisation        text NOT NULL CHECK (length(btrim(organisation)) > 0),
  scout_role          text CHECK (scout_role IS NULL OR scout_role IN
                        ('regional_selector','high_performance_scout',
                         'university_recruiter','provincial_coach','other')),
  -- 'pending' is the default for the same reason verification_state defaults
  -- to 'pending' on a guardian link: a claim nobody has checked grants
  -- nothing, so a self-registration that never gets looked at fails closed
  -- rather than quietly working.
  verification_status text NOT NULL DEFAULT 'pending'
                        CHECK (verification_status IN ('pending','verified','suspended')),
  verified_by          uuid REFERENCES app_user(id),
  verified_at          timestamptz,
  verified_note        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scout_verified_names_a_verifier
    CHECK (verification_status <> 'verified'
           OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

-- RLS is hand-written here, not generated, and deliberately so — the same
-- reason login_code and access_log are. "May I see my own accreditation" and
-- "may I verify somebody else's" are not a capability held at a school/team
-- scope; app_can()'s four dimensions have nothing to anchor to for a claim
-- about an external organisation. Regenerating packages/policy never touches
-- this file, so there is nothing here for `pnpm rls:generate` to overwrite —
-- unlike the toss's policies, which WERE the ordinary generated shape and
-- were lost for exactly that reason.
ALTER TABLE scout_accreditation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scout_accreditation_read ON scout_accreditation;
CREATE POLICY scout_accreditation_read ON scout_accreditation
  FOR SELECT USING (
    person_id = app_user_id()
    OR app_holds('scouting.accredit')
  );
-- No INSERT/UPDATE/DELETE policy. Every write goes through one of the two
-- functions below, which run SECURITY DEFINER and therefore bypass RLS
-- regardless — the absence of a policy here is documentation, not the
-- mechanism, and it is what stops scrbrd_app from writing the table any other
-- way if a future route ever tried to.

-- A scout claims an organisation. Always lands 'pending' — this function
-- cannot verify itself, on purpose, so there is no argument to leave out to
-- accidentally skip the check.
CREATE OR REPLACE FUNCTION scout_accreditation_register(
  p_organisation text,
  p_scout_role   text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  -- Hand-written, not app_can(). "Does this person hold scouting.write AT
  -- ALL" has no resource to anchor against — there is no player, no school,
  -- no fixture, nothing app_can()'s four dimensions compare a scope to. This
  -- is the same shape as the scouting.accredit check below it and the read
  -- policy on scout_accreditation above: a claim about the whole platform,
  -- not about one governed row. A fake NIL school as a stand-in resource was
  -- tried first and failed for exactly the reason "there is no ANY_SCOPE for
  -- school" documents — a scout's own assignment IS scoped to a real school,
  -- and a nil resource does not widen against it.
  -- Hand-written, not app_can(). "Does this person hold scouting.write AT
  -- ALL" has no resource to anchor against — no player, no school, no
  -- fixture — nothing app_can()'s four dimensions compare a scope to. Same
  -- shape as the scouting.accredit checks below and the read policy above: a
  -- claim about the whole platform, not one governed row.
  --
  -- valid_from checked as NULL-open, matching role_assignment's own column
  -- (which allows an open start, unlike assignment_subject's NOT NULL
  -- default): `valid_from <= current_date` against a NULL evaluates to NULL,
  -- which is false in a WHERE clause, and the first version of this refused
  -- every ordinary open-ended assignment in the seed — nobody could register
  -- at all, silently, because the comparison itself never fires.
  IF NOT app_holds('scouting.write') THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF p_organisation IS NULL OR btrim(p_organisation) = '' THEN
    RETURN QUERY SELECT false, 'organisation_required'; RETURN;
  END IF;
  INSERT INTO scout_accreditation (person_id, organisation, scout_role)
       VALUES (app_user_id(), btrim(p_organisation), p_scout_role)
  ON CONFLICT (person_id) DO UPDATE
       -- A re-registration is a CHANGE of organisation, and it re-opens the
       -- gate: whatever verification existed for the old claim does not carry
       -- over to a new one nobody has checked.
       SET organisation = excluded.organisation, scout_role = excluded.scout_role,
           verification_status = 'pending', verified_by = NULL, verified_at = NULL,
           verified_note = NULL;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION scout_accreditation_register(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scout_accreditation_register(text, text) TO PUBLIC;

-- The platform checks the claim. `p_verified = false` suspends rather than
-- deletes — the school-wide rule that nothing here is ever removed applies to
-- an external actor's record just as much as to a child's.
CREATE OR REPLACE FUNCTION scout_accreditation_decide(
  p_scout    uuid,
  p_verified boolean,
  p_note     text DEFAULT NULL
) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_rows int;
BEGIN
  -- Hand-written rather than app_can(), for the same reason the read policy
  -- above is: accrediting a scout is not a claim about any school, and
  -- app_can() has no dimension for "the whole platform, no anchor at all."
  IF NOT app_holds('scouting.accredit') THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;

  UPDATE scout_accreditation
     SET verification_status = CASE WHEN p_verified THEN 'verified' ELSE 'suspended' END,
         verified_by = app_user_id(), verified_at = now(), verified_note = p_note
   WHERE person_id = p_scout;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN QUERY SELECT false, 'no_such_scout'; RETURN; END IF;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION scout_accreditation_decide(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scout_accreditation_decide(uuid, boolean, text) TO PUBLIC;

-- Whether a specific child may be surfaced to scouts at all.
--
-- Absence of a row means what it says: not consented, not discoverable, full
-- stop. There is no default that reaches 'granted' — not a subscription, not
-- a school setting, not an import. `withdrawn` is a state, never a delete: a
-- family who changes their mind has a right to be forgotten going FORWARD,
-- and a right to their own history of having once said yes.
CREATE TABLE player_scouting_consent (
  player_id    uuid PRIMARY KEY REFERENCES player(id) ON DELETE CASCADE,
  consent_state text NOT NULL CHECK (consent_state IN ('granted','withdrawn')),
  decided_by   uuid REFERENCES app_user(id),
  decided_at   timestamptz NOT NULL DEFAULT now()
);

-- Read is the ordinary capability a school already uses to see this child's
-- profile at all — the same people who can already see a name, a birth date
-- behind masking, a batting style. Whether a family has opted a child into
-- external scouting is not a bigger disclosure than that, and a director of
-- sport has a legitimate reason to know it: to support the family, or to
-- follow up when a scout does show interest.
--
-- What must NOT happen, and does not: nobody with player.profile.read can
-- WRITE this table. There is no INSERT/UPDATE policy at all, hand-written for
-- the same reason as scout_accreditation above — the only path to 'granted'
-- is scouting_consent_set(), and its check is guardian-only, deliberately
-- with no administrative override. See that function for why.
ALTER TABLE player_scouting_consent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_scouting_consent_read ON player_scouting_consent;
CREATE POLICY player_scouting_consent_read ON player_scouting_consent
  FOR SELECT USING (
    app_can('player.profile.read', player_school(player_scouting_consent.player_id),
            player_team(player_scouting_consent.player_id),
            player_scouting_consent.player_id,
            '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- The one act on this table a family may perform, and the only path to it.
--
-- guardian_consent_record() above lets the SCHOOL OFFICE record processing
-- consent on a parent's behalf, for the parent who telephones — that is right
-- for "may SCRBRD process my son's attendance and scores" and wrong here.
-- Deciding whether a child is put in front of external scouting organisations
-- is a materially larger decision than platform processing consent, and it is
-- not the office's to make, record, or nudge. There is deliberately no
-- `OR app_can('guardian.link.manage', ...)` escape hatch in the check below —
-- a school administrator cannot grant this on a family's behalf, full stop,
-- the same rule that already governs a notification subscription: an
-- administrative role does not get to expand what a family has not agreed to.
--
-- SECURITY DEFINER because player_scouting_consent has no ordinary write
-- policy for anybody, by design.
CREATE OR REPLACE FUNCTION scouting_consent_set(
  p_player  uuid,
  p_granted boolean
) RETURNS TABLE (ok boolean, reason text) AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM assignment_subject g
      JOIN role_assignment a ON a.id = g.assignment_id
     WHERE g.player_id = p_player
       AND a.person_id = app_user_id()
       AND a.role = 'guardian'
       AND g.verification_state = 'verified'
       -- Consent to being scouted rests on top of consent to be processed at
       -- all — never ahead of it. A family cannot opt a child into external
       -- scouting while withholding basic platform consent; that would be the
       -- narrower decision outrunning the broader one it depends on.
       AND g.consent_state = 'granted'
       AND g.valid_from <= current_date
       AND (g.valid_until IS NULL OR g.valid_until > current_date)
  ) THEN
    RETURN QUERY SELECT false, 'not_a_consented_guardian'; RETURN;
  END IF;

  INSERT INTO player_scouting_consent (player_id, consent_state, decided_by, decided_at)
       VALUES (p_player, CASE WHEN p_granted THEN 'granted' ELSE 'withdrawn' END,
               app_user_id(), now())
  ON CONFLICT (player_id) DO UPDATE
       SET consent_state = excluded.consent_state,
           decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION scouting_consent_set(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scouting_consent_set(uuid, boolean) TO PUBLIC;

-- A single afternoon is not a body of work. Written as one number in one
-- place, the same reasoning as COACH_PRIOR_BALLS in packages/scoring: not a
-- claim that three is the RIGHT number, a documented placeholder a director
-- of sport can argue with and raise without touching the query that uses it.
CREATE OR REPLACE FUNCTION scouting_evidence_threshold() RETURNS int AS $$
  SELECT 3
$$ LANGUAGE sql IMMUTABLE;

-- What an accredited scout actually sees.
--
-- Every one of the following must hold, for every row returned:
--   1. app_can('scouting.read', ...) — the caller holds the role at all.
--   2. scout_accreditation.verification_status = 'verified' for THIS caller —
--      holding the role is not enough; the platform checked who they are.
--   3. player_scouting_consent.consent_state = 'granted' for THIS player —
--      a guardian said yes, specifically, and has not since said otherwise.
--   4. matches recorded >= scouting_evidence_threshold() — enough of a body
--      of work to be worth anyone's trial, batting or bowling.
--
-- SECURITY DEFINER, and deliberately NOT a security_invoker view over
-- `player`. A security_invoker view joined to player would be filtered by
-- player's OWN read policy (player.profile.read), which the scout role no
-- longer holds — see the comment on the `scout` role in
-- packages/policy/src/roles.mjs for why that capability was removed from it.
-- This function is the one and only door, and it checks everything itself
-- rather than depending on a capability a scout is not meant to hold.
--
-- Returns figures only, never the fields a school masks even from its own
-- coaches: no date of birth, no id number, no medical or disciplinary
-- anything. A scout sees exactly what a scorecard shows a spectator, plus the
-- career totals every reader of /read/career already gets for a match they
-- may see — nothing a consenting family has not effectively already made
-- public by having their son's name on a scoreboard.
CREATE OR REPLACE FUNCTION scouting_candidates()
RETURNS TABLE (
  player_id uuid, full_name text, school_id uuid, team_code text,
  playing_role text, batting_style text, bowling_style text,
  batting_matches bigint, runs bigint, balls_faced bigint,
  bowling_matches bigint, wickets bigint, runs_conceded bigint, legal_balls bigint
) AS $$
  SELECT p.id, p.full_name, p.school_id, p.team_code,
         p.playing_role, p.batting_style, p.bowling_style,
         coalesce(bc.matches, 0), bc.runs, bc.balls_faced,
         coalesce(bw.matches, 0), bw.wickets, bw.runs_conceded, bw.legal_balls
    FROM player p
    JOIN player_scouting_consent c ON c.player_id = p.id AND c.consent_state = 'granted'
    LEFT JOIN player_batting_career bc ON bc.player_id = p.id
    LEFT JOIN player_bowling_career bw ON bw.player_id = p.id
   WHERE app_can('scouting.read', p.school_id, '*'::text, p.id,
                 '00000000-0000-0000-0000-000000000000'::uuid)
     AND EXISTS (SELECT 1 FROM scout_accreditation sa
                  WHERE sa.person_id = app_user_id()
                    AND sa.verification_status = 'verified')
     AND (coalesce(bc.matches, 0) + coalesce(bw.matches, 0)) >= scouting_evidence_threshold()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION scouting_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scouting_candidates() TO PUBLIC;


-- ═══════════════════════════════════════════════════════════════
--  FEATURE FLAGS, AND THE FIRST FEATURE THAT NEEDS ONE
-- ═══════════════════════════════════════════════════════════════
--
-- A switch a platform administrator can throw to turn a product feature off
-- for everybody. There is exactly one reason for this table to exist and it is
-- worth stating plainly, because a flag system is otherwise an invitation to
-- half-ship things: SOME FEATURES ARE CORRECT AND NOT YET TRUSTWORTHY.
--
-- DRS is the case. The review panel below models a decision perfectly well.
-- What it cannot do is measure: "pitching in line" and "would have hit leg
-- stump" are outputs of ball-tracking, and until there are cameras on the
-- ground every value a school could enter is a person's judgement. Shipping it
-- switched on would put a Hawk-Eye-shaped screen in front of a parent over a
-- number an umpire guessed, which is the fabrication this codebase keeps
-- deleting — the seeded scorecard, the invented par score, the stored derby
-- tally. Building it and holding it off is the honest version.
--
-- WHAT A FLAG IS NOT
-- ──────────────────
-- It is not authorisation. It says what the product currently offers, never
-- who may see what — those stay in capabilities and RLS, where they can be
-- reasoned about. So a flag never appears in a read policy, and turning DRS on
-- grants nobody a single row they could not already read.
--
-- And it is ENFORCED IN THE DATABASE, not by hiding a button. A disabled
-- feature whose only guard is a hidden control is a feature anybody with a
-- fetch call still has. See the trigger below.
CREATE TABLE feature_flag (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{2,49}$'),
  -- module or feature. A module has a doorway somebody can be sent to; a
  -- feature is something the product does inside one. The distinction changes
  -- nothing about how the switch resolves and everything about how an
  -- administrator's screen reads, which is the only reason it is here.
  -- module, feature or sport. A module has a doorway somebody can be sent to;
  -- a feature is something the product does inside one; a SPORT is which game
  -- a fixture is, and it gates the machinery rather than a screen. All three
  -- resolve through exactly the same three levels — the distinction changes
  -- nothing about how a switch behaves and everything about how an
  -- administrator's screen groups them, which is the only reason it is here.
  kind       text NOT NULL DEFAULT 'feature' CHECK (kind IN ('module','feature','sport')),
  -- What to call it on that screen. In the database rather than only in
  -- packages/policy/src/modules.mjs so that a row is legible to somebody
  -- reading the table directly during an incident.
  label      text,
  -- NOBODY MAY DEVIATE. Not a stronger `enabled` — an independent statement
  -- that this switch is the platform's to hold, so a school grant is ignored
  -- entirely while it stands. DRS is the case it was added for: the feature is
  -- built, and no commercial conversation should be able to turn it on before
  -- there is ball-tracking to feed it.
  --
  -- Suppressions still apply on top. Locking sets the ceiling; it never forces
  -- a school to show something.
  locked     boolean NOT NULL DEFAULT false,
  -- Default false, deliberately. A feature that arrives switched on the moment
  -- its migration lands has not been decided about; it has been forgotten
  -- about. Turning it on is a person's act and this table records whose.
  enabled    boolean NOT NULL DEFAULT false,
  -- Why it is in the state it is in. Free text, and the most valuable column
  -- here: "off until we have ball-tracking" is the difference between a switch
  -- somebody can reason about in a year and one nobody dares touch.
  reason     text CHECK (reason IS NULL OR length(reason) <= 1000),
  changed_by uuid REFERENCES app_user(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feature_flag ENABLE ROW LEVEL SECURITY;

-- Hand-written rather than declared in packages/policy/src/tables.mjs, and for
-- the reason that file's generated policies cannot express: this table has NO
-- SCHOOL. Every anchor the generator builds is a tenant comparison, and a
-- platform-wide switch belongs to no tenant. Same class as login_code and
-- access_log, which are hand-written here for the same reason.
--
-- Readable by anyone signed in. Which features exist and whether they are on
-- is not a secret — a client has to know what to render, and hiding it would
-- only mean the client guessed.
CREATE POLICY feature_flag_read ON feature_flag
  FOR SELECT USING (app_user_id() IS NOT NULL);

-- Written only by a platform capability, through app_holds() because there is
-- no tenant to anchor on. NOT platform.tenant.manage: configuring a school and
-- deciding what the product does for everybody are different jobs.
CREATE POLICY feature_flag_insert ON feature_flag
  FOR INSERT WITH CHECK (app_holds('platform.feature.manage'));
CREATE POLICY feature_flag_update ON feature_flag
  FOR UPDATE USING (app_holds('platform.feature.manage'))
           WITH CHECK (app_holds('platform.feature.manage'));
-- No DELETE policy. A flag that disappears reads as a feature that was never
-- gated, which is the opposite of what a removed row would mean.

/**
 * Is a feature on right now?
 *
 * Unknown key means OFF. A feature nobody has declared is one nobody has
 * decided about, and defaulting an unrecognised name to `true` would make a
 * typo in a trigger switch a feature on for the platform.
 *
 * SECURITY DEFINER so the answer does not depend on the caller being able to
 * read feature_flag — the trigger below must get the same answer for a scorer
 * as for a platform administrator, or the gate is not a gate.
 */
CREATE OR REPLACE FUNCTION feature_enabled(p_key text) RETURNS boolean AS $$
  SELECT coalesce((SELECT enabled FROM feature_flag WHERE key = p_key), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION feature_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION feature_enabled(text) TO PUBLIC;


-- ── The commercial level: what a school's plan includes ──────────
--
-- Written ONLY under platform.feature.manage. This is the lever that lets a
-- module be off by default and on for the schools that pay for it, and it can
-- go either way — granted, or revoked when a plan lapses — because it is the
-- platform's own decision about its own product.
--
-- A row here is an OVERRIDE of feature_flag.enabled for one school, so
-- `granted` is a boolean and not merely the row's existence: revoking has to
-- be distinguishable from never having granted, or the note explaining why a
-- school lost a module has nowhere to live.
CREATE TABLE feature_grant (
  key        text NOT NULL REFERENCES feature_flag(key) ON DELETE CASCADE,
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  granted    boolean NOT NULL,
  note       text CHECK (note IS NULL OR length(note) <= 1000),
  changed_by uuid REFERENCES app_user(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, school_id)
);
ALTER TABLE feature_grant ENABLE ROW LEVEL SECURITY;

-- Hand-written for the same reason feature_flag's are: this is not an ordinary
-- tenant table. It HAS a school, but the person who may write it is not
-- scoped to that school at all — a platform administrator holds no assignment
-- anywhere, so every anchor the generator builds would refuse them.
--
-- Readable by anyone signed in. What a school's plan includes is not a secret
-- from that school, and hiding it would only mean a client guessed.
CREATE POLICY feature_grant_read ON feature_grant
  FOR SELECT USING (app_user_id() IS NOT NULL);
CREATE POLICY feature_grant_insert ON feature_grant
  FOR INSERT WITH CHECK (app_holds('platform.feature.manage'));
CREATE POLICY feature_grant_update ON feature_grant
  FOR UPDATE USING (app_holds('platform.feature.manage'))
           WITH CHECK (app_holds('platform.feature.manage'));


-- ── The school's own level, and the shape that makes it safe ─────
--
-- THIS TABLE HAS NO COLUMN THAT COULD MEAN "ON".
--
-- That sentence is the entire design of school-side module management. A
-- school administrator can hide a module from their school, or from one person
-- at it, and cannot grant themselves a module the platform did not grant them
-- — not because a policy forbids setting a boolean to true, but because there
-- is no boolean. The safe property is structural, so a future edit to a policy
-- or a route cannot quietly reverse it. Same reasoning as "a cached
-- notification is not permission".
--
-- person_id NULL means the whole school. A row naming a person means that one
-- person, and it narrows further rather than replacing the school-wide row —
-- both are checked, and either is enough to switch the module off.
--
-- UN-HIDING IS A LIFT, NOT A DELETE, and that is not a stylistic choice: this
-- database grants scrbrd_app no DELETE privilege on anything (db/06_app_role),
-- because records are deactivated rather than removed so an audit trail
-- survives. A suppression is a setting rather than a record about a child, but
-- carving a privilege exception for it would be the wrong way round — and the
-- append-only version turns out to be the better one anyway, because "who
-- turned Injuries back on, and when" is a question a school will eventually
-- ask.
--
-- Lifting does NOT weaken the guarantee above. A lifted suppression returns
-- the answer to whatever the platform said and no further; there is still no
-- column here whose value can exceed the platform's grant. The one-position
-- switch is intact — what a lift does is take the switch out of the circuit.
CREATE TABLE feature_suppression (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL REFERENCES feature_flag(key) ON DELETE CASCADE,
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  person_id  uuid REFERENCES app_user(id) ON DELETE CASCADE,
  reason     text CHECK (reason IS NULL OR length(reason) <= 1000),
  hidden_by  uuid REFERENCES app_user(id),
  hidden_at  timestamptz NOT NULL DEFAULT now(),
  -- When set, this suppression no longer applies. Re-hiding writes a NEW row,
  -- so the table reads as a history of a school's decisions rather than as
  -- their current state, and the current state is a WHERE clause.
  lifted_at  timestamptz,
  lifted_by  uuid REFERENCES app_user(id),
  CONSTRAINT lifted_has_a_lifter CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
);
-- Two indexes rather than a composite primary key: person_id is nullable, and
-- a NULL in a key column would let the same school-wide suppression be written
-- twice. Both are partial on lifted_at so that a lifted row does not block the
-- school from hiding the module again later.
CREATE UNIQUE INDEX ON feature_suppression (key, school_id)
  WHERE person_id IS NULL AND lifted_at IS NULL;
CREATE UNIQUE INDEX ON feature_suppression (key, school_id, person_id)
  WHERE person_id IS NOT NULL AND lifted_at IS NULL;
ALTER TABLE feature_suppression ENABLE ROW LEVEL SECURITY;

/**
 * Whoever writes a suppression must hold school.feature.manage AT THAT SCHOOL.
 *
 * app_can() rather than app_holds(): unlike the platform switch, this one IS a
 * claim about a tenant, and a school administrator at Westville must not be
 * able to hide a module from Hilton. The person dimension is deliberately
 * passed as NULL — hiding a module from somebody is not reading anything about
 * them, and requiring a person-scoped assignment would mean an administrator
 * could only hide modules from people they were individually assigned to.
 */
CREATE POLICY feature_suppression_read ON feature_suppression
  FOR SELECT USING (app_user_id() IS NOT NULL);
CREATE POLICY feature_suppression_insert ON feature_suppression
  FOR INSERT WITH CHECK (app_can('school.feature.manage', school_id, NULL, NULL, NULL));
-- The only UPDATE this table accepts is a lift, and the policy says so in both
-- directions: the row must be unlifted going in and lifted coming out. A
-- school cannot un-lift a suppression back into force, because re-hiding is an
-- insert — which keeps the history honest.
CREATE POLICY feature_suppression_update ON feature_suppression
  FOR UPDATE USING     (app_can('school.feature.manage', school_id, NULL, NULL, NULL)
                        AND lifted_at IS NULL)
           WITH CHECK  (app_can('school.feature.manage', school_id, NULL, NULL, NULL)
                        AND lifted_at IS NOT NULL);
-- No DELETE policy, and no DELETE privilege either — see db/06_app_role.sql.

/**
 * An UPDATE may set the lift and nothing else.
 *
 * The policy above governs WHO and in which direction; it cannot stop the same
 * statement from also rewriting key, school_id or person_id, which would turn
 * one school's lifted suppression into another school's live one. Structural
 * rules get triggers here — the same reasoning as ball_event's append-only
 * guard.
 */
CREATE OR REPLACE FUNCTION feature_suppression_lift_only() RETURNS trigger AS $$
BEGIN
  IF NEW.key       IS DISTINCT FROM OLD.key
  OR NEW.school_id IS DISTINCT FROM OLD.school_id
  OR NEW.person_id IS DISTINCT FROM OLD.person_id
  OR NEW.hidden_by IS DISTINCT FROM OLD.hidden_by
  OR NEW.hidden_at IS DISTINCT FROM OLD.hidden_at
  OR NEW.reason    IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'a suppression may only be lifted; to change what is hidden, '
                    'lift this one and write the one you meant'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER feature_suppression_lift_guard BEFORE UPDATE ON feature_suppression
  FOR EACH ROW EXECUTE FUNCTION feature_suppression_lift_only();

/**
 * Is this module on, for one school, for one person?
 *
 *     platform default, or the school's grant if the flag is not locked
 *     AND NOT suppressed for the school
 *     AND NOT suppressed for this person at that school
 *
 * An AND at every level, which is what makes the whole mechanism unable to
 * widen anything. There is no branch in here that returns true because of a
 * row somebody at a school wrote.
 *
 * SECURITY DEFINER, so the answer does not depend on the caller being able to
 * read these tables — an administrator and a coach must get the same answer or
 * the gate is not a gate.
 */
CREATE OR REPLACE FUNCTION feature_enabled(p_key text, p_school uuid, p_person uuid)
RETURNS boolean AS $$
  -- The outer coalesce is what makes an UNKNOWN KEY OFF rather than NULL: no
  -- feature_flag row means the inner SELECT returns nothing at all, and a
  -- three-valued answer to "may this be shown" is one a caller will get wrong.
  -- Same rule as the one-argument form above.
  SELECT coalesce((
    SELECT CASE
             WHEN EXISTS (
               SELECT 1 FROM feature_suppression s
                WHERE s.key = p_key AND s.school_id = p_school
                  AND s.lifted_at IS NULL
                  AND (s.person_id IS NULL OR s.person_id = p_person)
             ) THEN false
             WHEN f.locked THEN f.enabled
             ELSE coalesce(
                    (SELECT g.granted FROM feature_grant g
                      WHERE g.key = p_key AND g.school_id = p_school),
                    f.enabled)
           END
      FROM feature_flag f WHERE f.key = p_key), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION feature_enabled(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION feature_enabled(text, uuid, uuid) TO PUBLIC;

/**
 * The same question for the SIGNED-IN caller, across everywhere they belong.
 *
 * A person can hold assignments at more than one school, and a module can be
 * on at one and hidden at the other. The API refuses a read once, for the
 * whole request, so it has to collapse that into a single answer — and the
 * direction it collapses in is the codebase's standing one: OFF AT ANY SCHOOL
 * YOU BELONG TO IS OFF.
 *
 * That over-refuses for the rare person assigned at two schools, and it
 * over-refuses in the safe direction. The alternative — on if on anywhere —
 * would mean a school that hid a module from a particular coach could be
 * defeated by that coach holding an assignment somewhere else, which is a
 * setting that does not do what its name says.
 *
 * Somebody with no school at all is a platform account, and gets the platform
 * default: no grants and no suppressions can apply to a person no school has.
 */
CREATE OR REPLACE FUNCTION my_feature_enabled(p_key text) RETURNS boolean AS $$
  SELECT CASE
           WHEN app_user_id() IS NULL THEN false
           WHEN NOT EXISTS (
             SELECT 1 FROM role_assignment a
              WHERE a.person_id = app_user_id() AND a.active AND a.school_id IS NOT NULL
           ) THEN feature_enabled(p_key)
           ELSE coalesce((
             SELECT bool_and(feature_enabled(p_key, s.school_id, app_user_id()))
               FROM (SELECT DISTINCT a.school_id FROM role_assignment a
                      WHERE a.person_id = app_user_id() AND a.active
                        AND a.school_id IS NOT NULL) s
           ), false)
         END
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION my_feature_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_feature_enabled(text) TO PUBLIC;

-- ── The switchable things themselves ─────────────────────────────
--
-- Kept in step with packages/policy/src/modules.mjs by a test that fails the
-- build when the two disagree, the same way the RLS generator's output is kept
-- in step with tables.mjs. Two lists of what the product offers would drift,
-- and the symptom would be a module nobody can switch because the row it needs
-- was never inserted.
--
-- MODULES ARRIVE ON. The column default is false and stays false, because a
-- FEATURE that arrives switched on has not been decided about. A MODULE is
-- different: it is part of the product a school already bought, and shipping
-- this migration with everything off would take Analytics away from every
-- school on the platform at the moment it applied.
INSERT INTO feature_flag (key, kind, label, enabled, reason) VALUES
  ('competitions', 'module', 'Competitions', true, NULL),
  ('leagues',      'module', 'Leagues',      true, NULL),
  ('analytics',    'module', 'Analytics',    true, NULL),
  ('skills',       'module', 'Skills',       true, NULL),
  ('training',     'module', 'Training',     true, NULL),
  ('injuries',     'module', 'Injuries',     true, NULL),
  ('logistics',    'module', 'Logistics',    true, NULL),
  ('fields',       'module', 'Fields',       true, NULL),
  ('officials',    'module', 'Officials',    true, NULL),
  ('sponsors',     'module', 'Sponsors',     true, NULL),
  ('staff',        'module', 'Staff',        true, NULL),
  ('broadcast',    'feature','Broadcast overlay', true, NULL),
  ('scouting',     'feature','Scouting',     true, NULL)
ON CONFLICT (key) DO NOTHING;

-- THE SPORTS, and only one of them is on.
--
-- Keys are derived from sport.code by the generated flag_key column in db/00,
-- so these cannot drift from the catalogue —
-- packages/policy/test/modules.test.mjs fails if a sport has no row or a row
-- has no sport.
--
-- Cricket on, everything else off, and off here means off for EVERY school
-- until the platform grants it. That is the same direction as every other
-- switch in this table: the platform grants, a school may only reduce. A
-- school cannot decide to start running rugby through SCRBRD by flipping
-- something at their end, because "rugby works" is a statement about what we
-- have built and tested, not a preference.
INSERT INTO feature_flag (key, kind, label, enabled, reason) VALUES
  ('sport_cricket',   'sport', 'Cricket',   true,  NULL),
  ('sport_rugby',     'sport', 'Rugby',     false,
   'Fixture engine only — schedule, squad, availability, transport, officials. '
   'No scoring engine. Grant per school when they want the fixture half.'),
  ('sport_hockey',    'sport', 'Hockey',    false, 'As rugby: fixture engine only.'),
  ('sport_netball',   'sport', 'Netball',   false, 'As rugby: fixture engine only.'),
  ('sport_football',  'sport', 'Football',  false, 'As rugby: fixture engine only.'),
  ('sport_athletics', 'sport', 'Athletics', false,
   'Listed, not built. A meet is heats and lanes and marks, which is a '
   'different shape from a fixture between two sides, and pretending otherwise '
   'would give a school a fixture list it cannot use.'),
  ('sport_swimming',  'sport', 'Swimming',  false, 'As athletics: a gala is not a fixture.')
ON CONFLICT (key) DO NOTHING;

-- Reading another school's players ahead of a fixture. Off until the platform
-- turns it on for a school: this is a disclosure about children who are not
-- that school's, bounded in db/08 by a fixture and a window, and the decision
-- to make it at all is the platform's — see opposition_window() below.
INSERT INTO feature_flag (key, kind, label, enabled, reason) VALUES
  ('opposition', 'feature', 'Opposition intelligence', false,
   'Cross-tenant by nature. Granted per school once the fixture window and the '
   'cricket-only column rule have been walked through with them.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO feature_flag (key, kind, label, enabled, locked, reason) VALUES
  ('drs_review', 'feature', 'DRS / LBW review', false, true,
   'Built and held off. The panel records a review correctly, but pitching, '
   'impact and wickets are ball-tracking outputs, and until there are cameras '
   'on the ground every value entered would be an umpire''s judgement rendered '
   'as if it were measured. Turn on per the evidence_source the technology '
   'actually supports.')
ON CONFLICT (key) DO NOTHING;
-- LOCKED, which is the difference between this row and every other one above.
-- A school cannot be granted DRS while it stands, whatever a commercial
-- conversation concludes, because the objection is not commercial: there is no
-- instrument on the ground capable of producing the numbers the screen would
-- render.


-- ── The review itself ────────────────────────────────────────────
--
-- Law 36 has four questions — where it pitched, where it struck, whether it
-- was going on to hit, and whether a shot was offered — and under real DRS
-- three of them come off ball-tracking. Here they come off whatever the ground
-- actually has, so EVERY REVIEW STATES HOW IT WAS KNOWN.
--
-- `evidence_source` is NOT NULL and has NO DEFAULT. That is the whole design.
-- A row cannot be written without saying whether a person judged it, a replay
-- showed it, or a tracking system computed it, and a screen can therefore
-- never render an umpire's opinion in the visual language of a measurement.
-- It is the same rule as placement_source on ball_event: a sector-era ball is
-- never upgraded by synthesising a point from its wedge, and an eye-judged
-- review is never dressed up as a tracked one.
--
-- The delivery is referenced by (match_id, seq), which is a real foreign key
-- into the ball log rather than a loose number: a review of a ball that was
-- never bowled cannot be recorded.
CREATE TABLE drs_review (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  -- Derived at write time from the match, never asserted — as everywhere.
  school_id     uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  ball_seq      integer NOT NULL,
  FOREIGN KEY (match_id, ball_seq) REFERENCES ball_event (match_id, seq) ON DELETE CASCADE,

  -- Who called for it. A review is not always a player's: an umpire may refer
  -- a decision upward without either side asking.
  called_by     text NOT NULL CHECK (called_by IN ('batting','fielding','umpire')),
  -- What the on-field umpire had given before the review.
  on_field      text NOT NULL CHECK (on_field IN ('out','not_out')),
  -- What the review did to it.
  outcome       text NOT NULL CHECK (outcome IN ('upheld','overturned','umpires_call')),

  -- The Law 36 components. All nullable, because a review of a caught-behind
  -- has none of them and a form that demanded them would be filled in with
  -- invention — the same reasoning as the pitch report's optional fields.
  pitching      text CHECK (pitching IS NULL OR pitching IN ('in_line','outside_off','outside_leg')),
  impact        text CHECK (impact   IS NULL OR impact   IN ('in_line','outside_off')),
  wickets       text CHECK (wickets  IS NULL OR wickets  IN ('hitting','missing','umpires_call')),
  shot_offered  boolean,

  -- HOW IT WAS KNOWN. No default: see above.
  evidence_source text NOT NULL
                  CHECK (evidence_source IN ('umpire_eye','video_replay','ball_tracking')),
  notes         text CHECK (notes IS NULL OR length(notes) <= 2000),
  reviewed_by   uuid REFERENCES app_user(id),
  reviewed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON drs_review (match_id);
CREATE INDEX ON drs_review (school_id);
-- One review per delivery. A ball reviewed twice was reviewed once and
-- corrected, like the toss and the pitch report.
CREATE UNIQUE INDEX ON drs_review (match_id, ball_seq);

/**
 * The gate, in the database.
 *
 * A feature switched off in the UI is switched off for people who use the UI.
 * This is what makes it off for everybody: the row is refused at the table, so
 * a stale client, a queued offline write and somebody with a fetch call all
 * get the same answer.
 *
 * The message names the flag and who can change it, because the alternative is
 * a scorer at a ground being told "not permitted" for a feature that is
 * working exactly as intended.
 */
CREATE OR REPLACE FUNCTION drs_review_feature_gate() RETURNS trigger AS $$
BEGIN
  -- Resolved for THE ROW'S SCHOOL, not platform-wide, since school grants and
  -- school suppressions exist. The writer is passed as the person so that a
  -- school which hid DRS from one scorer refuses that scorer's write and
  -- nobody else's.
  --
  -- The row's own school_id is safe to use here where an RLS predicate would
  -- not be: it is derived at write time by match_school() in the same
  -- statement, and this trigger is a product gate rather than an access
  -- decision. Nothing about who may READ a review passes through here.
  IF NOT feature_enabled('drs_review', NEW.school_id, app_user_id()) THEN
    RAISE EXCEPTION 'the DRS review feature is switched off '
                    '(feature_flag.drs_review); a platform administrator holding '
                    'platform.feature.manage can enable it, unless a school has '
                    'hidden it for itself'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drs_review_gate BEFORE INSERT OR UPDATE ON drs_review
  FOR EACH ROW EXECUTE FUNCTION drs_review_feature_gate();


-- ═══════════════════════════════════════════════════════════════
--  TRANSPORT
-- ═══════════════════════════════════════════════════════════════
--
-- THREE CAPABILITIES THAT HAD NOTHING TO ACT ON. transport.read,
-- transport.manage and transport.drive were declared, bundled into ten roles,
-- and gated a Logistics destination whose vehicles came off a mock array hung
-- on the staff record and whose trips came off a mock field on the match.
-- Nothing in the database had ever heard of a bus.
--
-- That is the same shape this codebase keeps closing — a control that exists
-- and nothing exercises it — and it is worse here than most, because a
-- capability in the role directory is a claim the platform makes about what a
-- transport coordinator can do.
--
-- WHAT A TRIP IS ANCHORED ON, and it is the interesting decision. A trip
-- belongs to a FIXTURE: a bus goes to Michaelhouse on Saturday because there
-- is a match there. Anchoring on the fixture means a driver assigned to that
-- fixture reaches that trip and no other, which is what transport.drive has
-- always needed and never had — the older build reached for a whole extra
-- scope dimension (TRIP) to express it, and the fixture already does.
CREATE TABLE vehicle (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  registration text NOT NULL,
  description  text NOT NULL,                      -- Quantum 22-seater
  kind         text NOT NULL DEFAULT 'minibus'
                 CHECK (kind IN ('bus','minibus','van','car')),
  -- Seats, and it is load-bearing rather than decorative: naming more
  -- passengers than a vehicle holds is the check below, and a school putting
  -- fifteen boys in a fourteen-seater is a safety failure, not a rounding
  -- error.
  capacity     smallint NOT NULL CHECK (capacity BETWEEN 1 AND 80),
  condition    text CHECK (condition IS NULL OR condition IN
                 ('excellent','good','fair','poor','off_road')),
  next_service_on date,
  -- The two dates a minibus of children turns on, and the transport module
  -- could not see either. NULL means "not recorded" and is surfaced as
  -- unknown rather than treated as fine — a school that has not typed its
  -- insurance date in is not thereby uninsured. A KNOWN date in the past is
  -- different: a trip on that vehicle is refused, by trip_vehicle_fits().
  insurance_expires_on  date,
  roadworthy_expires_on date,
  active       boolean NOT NULL DEFAULT true,
  notes        text CHECK (notes IS NULL OR length(notes) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON vehicle (school_id);
-- A unique INDEX, not a table constraint: a constraint cannot be built on an
-- expression, and the registration has to match regardless of how somebody
-- typed the spaces and the case.
CREATE UNIQUE INDEX ON vehicle (school_id, upper(btrim(registration)));

CREATE TABLE trip (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  -- Derived from the match at write time, never asserted.
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  vehicle_id  uuid REFERENCES vehicle(id),
  -- The driver as a PERSON, not as free text. A name typed into a box is a
  -- name nobody can scope a permission to, and transport.drive has to reach
  -- this row for exactly one person.
  driver_id   uuid REFERENCES app_user(id),
  depart_at   timestamptz,
  return_at   timestamptz,
  pickup      text CHECK (pickup IS NULL OR length(pickup) <= 200),
  seats_taken smallint CHECK (seats_taken IS NULL OR seats_taken >= 0),
  notes       text CHECK (notes IS NULL OR length(notes) <= 500),
  -- The driver's own marks. Not a status column somebody sets to anything:
  -- these are two timestamps that only ever go from null to a time, written
  -- through trip_mark() under transport.drive.
  departed_at timestamptz,
  arrived_at  timestamptz,
  cancelled_at timestamptz,
  arranged_by uuid REFERENCES app_user(id),
  arranged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_returns_after_departure
    CHECK (return_at IS NULL OR depart_at IS NULL OR return_at >= depart_at),
  CONSTRAINT trip_arrives_after_departing
    CHECK (arrived_at IS NULL OR departed_at IS NOT NULL)
);
CREATE INDEX ON trip (school_id);
CREATE INDEX ON trip (match_id);
CREATE INDEX ON trip (driver_id) WHERE driver_id IS NOT NULL;
-- One trip per vehicle per fixture. A bus double-booked for the same match is
-- always a mistake, and it is the mistake a transport coordinator makes at
-- five o'clock on a Friday.
CREATE UNIQUE INDEX ON trip (match_id, vehicle_id) WHERE vehicle_id IS NOT NULL;

/**
 * A trip cannot carry more boys than the bus holds, or use somebody else's bus.
 *
 * Both are the kind of thing a screen usually checks and a database usually
 * does not, which means they hold until the first import, the first offline
 * queue, or the first person with psql. Overloading a minibus is a safety
 * matter; borrowing another school's vehicle is a tenancy one.
 */
CREATE OR REPLACE FUNCTION trip_vehicle_fits() RETURNS trigger AS $$
DECLARE v record;
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;
  SELECT school_id, capacity, active, registration,
         insurance_expires_on, roadworthy_expires_on
    INTO v FROM vehicle WHERE id = NEW.vehicle_id;
  IF v.school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'that vehicle belongs to another school'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v.active THEN
    RAISE EXCEPTION 'vehicle % is not in service', v.registration
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.seats_taken IS NOT NULL AND NEW.seats_taken > v.capacity THEN
    RAISE EXCEPTION 'vehicle % seats %, and this trip names % passengers',
                    v.registration, v.capacity, NEW.seats_taken
      USING ERRCODE = 'check_violation';
  END IF;

  -- COVER. Checked when a trip is arranged or re-arranged — the vehicle or the
  -- departure changes — and NOT when a driver marks it departed or arrived:
  -- a refusal at "we have left" is too late to be useful and would only stop
  -- the record of what happened. A known lapsed date refuses; an unrecorded
  -- one does not, because the absence of a date is a gap in the office's
  -- records, not a fact about the vehicle, and the vehicles read says
  -- "unknown" where that is the case.
  IF TG_OP = 'INSERT'
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.depart_at  IS DISTINCT FROM OLD.depart_at THEN
    IF v.insurance_expires_on IS NOT NULL
       AND v.insurance_expires_on < coalesce(NEW.depart_at::date, current_date) THEN
      RAISE EXCEPTION 'vehicle %: insurance expired on %. Renew it, or record the renewal, before it carries a side',
                      v.registration, v.insurance_expires_on
        USING ERRCODE = 'check_violation';
    END IF;
    IF v.roadworthy_expires_on IS NOT NULL
       AND v.roadworthy_expires_on < coalesce(NEW.depart_at::date, current_date) THEN
      RAISE EXCEPTION 'vehicle %: roadworthy certificate expired on %',
                      v.registration, v.roadworthy_expires_on
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
-- SECURITY DEFINER for the reason availability_player_belongs() is: without
-- it this reads vehicle under the caller's row-level security, and a caller
-- who cannot see the vehicle gets "belongs to another school" about one that
-- does not. The refusal would be correct and its reason invented.
SECURITY DEFINER;

CREATE TRIGGER trip_vehicle_check BEFORE INSERT OR UPDATE ON trip
  FOR EACH ROW EXECUTE FUNCTION trip_vehicle_fits();

/**
 * The driver's own two acts: we have left, and we have arrived.
 *
 * A FUNCTION RATHER THAN A WRITE POLICY, because transport.drive is not a
 * capability to change a trip — it is a capability to report on one. A driver
 * must not be able to re-time the departure, swap the vehicle or cancel the
 * fixture's transport; they mark what happened, and only forwards.
 *
 * Scoped on the FIXTURE, which is what gives transport.drive somewhere to
 * live. A driver assigned to Saturday's match reaches Saturday's trip. Being
 * named as this trip's driver is accepted too — a school that assigns the
 * driver on the trip row should not also have to write a fixture-scoped role
 * assignment for them.
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

  IF NOT (t.driver_id = app_user_id()
          OR app_can('transport.drive',  t.school_id, t.team_code, NULL, t.match_id)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION trip_mark(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trip_mark(uuid, text) TO PUBLIC;


-- ═══════════════════════════════════════════════════════════════
--  AVAILABILITY
-- ═══════════════════════════════════════════════════════════════
--
-- WHOSE STATEMENT THIS IS, and it is the whole design.
--
-- The schema already knows whether a boy is FIT. That is the physio's
-- judgement, it lives on injury, and it is read through the medical tiers. It
-- has never known whether he is AVAILABLE, which is a different fact belonging
-- to a different person: a perfectly fit fourteen-year-old can be at his
-- grandmother's funeral, writing a rewrite, or away with his family, and none
-- of that is a clinical matter or the school's to assert on his behalf.
--
-- So availability is DECLARED, by the boy or by his guardian, and a coach
-- recording it is recording what he was told. declared_by is on every row for
-- exactly that reason — "unavailable, said so himself" and "unavailable,
-- according to the coach" are different degrees of certainty on a Friday
-- afternoon, and a selector deserves to see which one they have.
--
-- NOTHING HERE TOUCHES injury, in either direction. A boy declaring himself
-- unavailable does not become injured, and a physio marking him unfit does not
-- write a declaration in his name. The squad screen reads both and shows both,
-- because a side is picked from the intersection — but the two facts stay
-- separate rows owned by separate people, and merging them would mean either
-- a coach could overwrite a clinical record or a physio could speak for a
-- family.
--
-- SILENCE IS NOT A YES. There is no default status and no row until somebody
-- declares one. The absence of a row means "has not answered", which is the
-- state a team manager actually needs to chase, and defaulting it to available
-- would turn a boy who never saw the message into a boy who is picked and does
-- not arrive.
CREATE TABLE match_availability (
  match_id    uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- Derived from the match at write time, never asserted, as everywhere.
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('available','unavailable','doubtful')),
  -- WHY, in a fixed vocabulary rather than free text alone. A team manager
  -- planning a Saturday needs to know that three boys are away on a school
  -- trip and one is at a funeral, and cannot read that out of prose at a
  -- glance. 'other' exists so nobody is forced into a wrong box.
  reason_kind text CHECK (reason_kind IS NULL OR reason_kind IN
                ('illness','family','academic','travel','religious','other_sport','other')),
  -- The prose, optional and short. Kept deliberately modest: this is a note to
  -- a coach about one Saturday, not a place to write about a child's home
  -- circumstances, and a 280-character ceiling says so without a policy
  -- document.
  note        text CHECK (note IS NULL OR length(note) <= 280),
  -- Who said it, and it is not always the player. Recorded rather than
  -- inferred: the person who typed it is the person the platform can stand
  -- behind, and a selector reading "declared by the coach" knows to check.
  declared_by uuid REFERENCES app_user(id),
  declared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX ON match_availability (school_id);
CREATE INDEX ON match_availability (player_id);

/**
 * A declaration is about a fixture the player could actually be picked for.
 *
 * Without this a boy at one school could be marked available for another
 * school's fixture — harmless-looking, and it would put his name on a team
 * manager's screen at a school that has no business holding it. The school
 * comes from the match, so the check is that the player belongs to it.
 */
CREATE OR REPLACE FUNCTION availability_player_belongs() RETURNS trigger AS $$
DECLARE v_school uuid;
BEGIN
  SELECT school_id INTO v_school FROM player WHERE id = NEW.player_id;
  IF v_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'that player is not at the school playing this fixture'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
-- SECURITY DEFINER, and it took a failing walk to see why.
--
-- Without it this reads `player` under the CALLER's row-level security, so a
-- guardian writing about a boy who is not their child found no row, v_school
-- came back NULL, and the trigger raised "that player is not at the school
-- playing this fixture" — about a boy who is. The refusal was correct and its
-- reason was a fabrication, which is worse than a bare refusal: a school
-- office reading that message would go looking for a data error that does not
-- exist.
--
-- A BEFORE trigger runs ahead of the RLS check, so the wrong answer arrived
-- first and the right one never ran. As a definer this answers the question it
-- claims to answer — does this player belong to this school — and the policy
-- is then left to answer the separate question of whether the caller may say
-- anything about him at all. It discloses nothing either way: the only thing
-- that leaves is a fixed sentence.
SECURITY DEFINER;

/**
 * Who made a declaration, for a reader who cannot read the app_user table.
 *
 * The obvious version of this joined app_user twice — once to find the boy's
 * own account, once for the declarant's name — and both came back NULL for a
 * coach, because app_user is row-scoped and a coach may not read a pupil's
 * login or a parent's. So "said so himself" and "we could not tell" rendered
 * identically, which is the distinction the column exists to draw.
 *
 * SECURITY DEFINER and deliberately narrow: it answers about ONE declaration
 * the caller is already reading, and returns a name and a boolean. It cannot
 * be used to enumerate accounts, and it discloses only who told the school a
 * child cannot play on Saturday — which is the person a team manager has to
 * ring back.
 */
CREATE OR REPLACE FUNCTION availability_declarant(p_player uuid, p_declared_by uuid)
RETURNS TABLE (name text, is_self boolean) AS $$
  SELECT u.name,
         coalesce(u.player_id = p_player, false)
    FROM app_user u WHERE u.id = p_declared_by
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION availability_declarant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION availability_declarant(uuid, uuid) TO PUBLIC;

CREATE TRIGGER availability_belongs BEFORE INSERT OR UPDATE ON match_availability
  FOR EACH ROW EXECUTE FUNCTION availability_player_belongs();


-- ═══════════════════════════════════════════════════════════════
--  COMMERCIAL
-- ═══════════════════════════════════════════════════════════════
--
-- School sport in South Africa runs on sponsorship — a boundary board, a logo
-- on the scoreboard, a name under the fixture list. This is that, and the two
-- decisions in it that scrbrd-beta-2's model did not make.
--
-- FIRST: WHICH BRANDS MAY BE ON A CHILD'S SCOREBOARD AT ALL.
--
-- beta-2's brandCategory list was Automotive, Banking, Sportswear, Nutrition,
-- Education and Telecom. Alcohol, gambling and tobacco are not on it — and
-- they are not on it by ABSENCE, which is not a safeguard. A list that simply
-- fails to mention betting is a list somebody widens in a year without ever
-- confronting the question, because there is nothing there to argue with.
--
-- So the prohibited categories are PRESENT here and marked prohibited, with a
-- note saying why, and a trigger refuses the placement rather than a dropdown
-- omitting the option. Everything this platform holds is school sport; there
-- is no context inside it where a betting brand belongs.
--
-- SECOND: WHAT IS COUNTED.
--
-- beta-2 carried impressions, viewableImpressions and clickThroughs on the
-- campaign. Delivery counting against a placement is ordinary commercial
-- reporting; the danger is the shape it invites, which is per-viewer tracking
-- on a platform whose viewers are children and their families. Nothing here
-- records who saw anything. A sponsorship knows its dates and its terms; it
-- does not know its audience.
CREATE TABLE sponsor_category (
  name       text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{2,39}$'),
  -- The decision, stated once, where a person can find it and argue with it.
  permitted  boolean NOT NULL,
  note       text
);

INSERT INTO sponsor_category (name, permitted, note) VALUES
  ('automotive',    true,  NULL),
  ('banking',       true,  NULL),
  ('insurance',     true,  NULL),
  ('sportswear',    true,  NULL),
  ('nutrition',     true,  NULL),
  ('education',     true,  NULL),
  ('telecom',       true,  NULL),
  ('retail',        true,  NULL),
  ('agriculture',   true,  NULL),
  ('health',        true,  NULL),
  -- Present, and refused. These are here so that turning one on is a visible
  -- act with a name on it rather than an edit to a list of allowed values.
  ('alcohol',       false, 'Advertising alcohol on youth sport. Restricted under South African '
                           'advertising codes and not something this platform places against '
                           'fixtures played by children.'),
  ('gambling',      false, 'Betting brands against school fixtures, including odds and free-bet '
                           'promotions. Refused outright.'),
  ('tobacco_vaping',false, 'Tobacco, vaping and nicotine products. Refused outright.'),
  ('political',     false, 'Party-political messaging on a school scoreboard. Not a safeguarding '
                           'question but an institutional-neutrality one, and a school that wants '
                           'it should have to decide so explicitly rather than by picking from a list.')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE sponsor_category ENABLE ROW LEVEL SECURITY;
-- Hand-written, like feature_flag and for the same reason: the vocabulary
-- belongs to no tenant. Readable by anyone signed in; written by nobody
-- through the API at all — changing what may be advertised to children is a
-- migration somebody reviews, not a form somebody fills in.
CREATE POLICY sponsor_category_read ON sponsor_category
  FOR SELECT USING (app_user_id() IS NOT NULL);

CREATE TABLE sponsor (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A sponsor belongs to the school that signed them. A platform-wide sponsor
  -- would be a different row per school, which is the honest shape: each
  -- school agrees its own terms.
  school_id  uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  category   text NOT NULL REFERENCES sponsor_category(name),
  -- What goes on the board. Deliberately text and a colour rather than an
  -- uploaded asset: an overlay needs something it can render at any size, and
  -- an image pipeline is a different piece of work.
  logo_text  text CHECK (logo_text IS NULL OR length(logo_text) <= 24),
  logo_bg    text CHECK (logo_bg IS NULL OR logo_bg ~ '^#[0-9a-fA-F]{6}$'),
  active     boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sponsor (school_id);
CREATE UNIQUE INDEX ON sponsor (school_id, lower(btrim(name)));

-- Where a sponsor appears, for how long, and on what terms.
CREATE TABLE sponsorship (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  sponsor_id  uuid NOT NULL REFERENCES sponsor(id) ON DELETE CASCADE,
  -- The surface. Named for what a person would call it rather than for a
  -- component, so a slot surviving a redesign keeps its meaning.
  placement   text NOT NULL CHECK (placement IN
                ('broadcast_overlay','scorecard_footer','fixture_list','ground_board')),
  -- A placement may be the school's in general, or tied to one fixture.
  match_id    uuid REFERENCES match(id) ON DELETE CASCADE,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  -- The commercial terms. Masked: see tables.mjs. A boundary board is meant to
  -- be seen; what was paid for it is not.
  contract_value_zar numeric(12,2) CHECK (contract_value_zar IS NULL OR contract_value_zar >= 0),
  school_share_pct   smallint CHECK (school_share_pct IS NULL OR school_share_pct BETWEEN 0 AND 100),
  agreed_by   uuid REFERENCES app_user(id),
  agreed_at   timestamptz NOT NULL DEFAULT now(),

  -- ── CATEGORY EXCLUSIVITY ──────────────────────────────────────
  --
  -- A sponsor who has paid to be the only bank on a scoreboard has bought
  -- something the schema has to be able to keep. Without this, the promise
  -- lives in a signed contract and nowhere in the system that draws the
  -- boards, and the first breach is discovered by the sponsor.
  --
  -- The SCOPE is the whole point and it is wider than one school. A bank
  -- taking exclusivity across a competition has bought silence from every
  -- school in it, which is a claim no single school's row can express — so
  -- the scope names the shape and sponsorship_covers() below resolves it to
  -- the actual schools.
  exclusive       boolean NOT NULL DEFAULT false,
  exclusive_scope text CHECK (exclusive_scope IS NULL OR exclusive_scope IN
                    ('school','province','competition','platform')),
  -- Both or neither. An exclusive placement with no scope is a promise with
  -- no boundary, and a scope on a non-exclusive one is a scope that does
  -- nothing — either would read as protection that is not there.
  CONSTRAINT exclusivity_has_a_scope CHECK (exclusive = (exclusive_scope IS NOT NULL)),

  -- Named when the scope is a competition, and only then.
  competition_id uuid REFERENCES competition(id) ON DELETE CASCADE,
  CONSTRAINT competition_scope_names_one CHECK (
    (exclusive_scope = 'competition') = (competition_id IS NOT NULL)),

  -- ── THE WAIVER ────────────────────────────────────────────────
  --
  -- A conflicting placement is refused, and a school that has genuinely
  -- agreed one with both parties needs a way through. It is prose and a
  -- name, never a flag: "somebody ticked a box" is not a record anyone can
  -- act on when the exclusive sponsor asks how this happened. The trigger
  -- requires the person writing it to hold the waiver capability and stamps
  -- them, so the name on the row is the person who actually decided.
  waiver_note text CHECK (waiver_note IS NULL OR length(btrim(waiver_note)) >= 20),
  waived_by   uuid REFERENCES app_user(id),
  waived_at   timestamptz,
  CONSTRAINT waiver_is_signed CHECK (
    (waiver_note IS NULL) = (waived_by IS NULL)
    AND (waived_by IS NULL) = (waived_at IS NULL)),

  CONSTRAINT sponsorship_runs_forwards CHECK (ends_on >= starts_on)
);
CREATE INDEX ON sponsorship (competition_id) WHERE competition_id IS NOT NULL;
CREATE INDEX ON sponsorship (exclusive) WHERE exclusive;
CREATE INDEX ON sponsorship (school_id);
CREATE INDEX ON sponsorship (sponsor_id);
CREATE INDEX ON sponsorship (match_id) WHERE match_id IS NOT NULL;

/**
 * A prohibited category never reaches a screen.
 *
 * On the SPONSOR rather than only on the placement, so a brand that may not be
 * advertised to children cannot be created and left waiting for somebody to
 * place it. The message quotes the note from the category table, because
 * "not_permitted" tells a school office nothing and the note tells them why.
 */
CREATE OR REPLACE FUNCTION sponsor_category_permitted() RETURNS trigger AS $$
DECLARE v_ok boolean; v_note text;
BEGIN
  SELECT permitted, note INTO v_ok, v_note FROM sponsor_category WHERE name = NEW.category;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'the % category may not be placed on school sport: %',
                    NEW.category, coalesce(v_note, 'refused')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sponsor_category_gate BEFORE INSERT OR UPDATE ON sponsor
  FOR EACH ROW EXECUTE FUNCTION sponsor_category_permitted();


/**
 * Which schools a placement's exclusivity actually covers.
 *
 * The scope names a shape; this resolves it to the set of schools the promise
 * reaches, so a conflict is a plain question about whether two sets intersect
 * rather than a matrix of scope-against-scope special cases. Four shapes and
 * one rule each:
 *
 *   school       the school that signed it
 *   province     every school in the same province — a regional deal
 *   competition  every school entered in it, from competition_entrant, so a
 *                league deal reaches the schools actually playing rather
 *                than the ones somebody remembered to list
 *   platform     everything
 *
 * SECURITY DEFINER, because the trigger that calls it must see conflicts at
 * schools the writer cannot read. A school administrator signing a bank has no
 * business reading another school's sponsor list — and must still be refused
 * when that school's bank holds a competition-wide exclusivity. Resolving this
 * under the caller's own row-level security would return an empty set and let
 * the conflicting placement straight through, which is precisely the kind of
 * silent hole a security_invoker view creates elsewhere in this schema.
 */
CREATE OR REPLACE FUNCTION sponsorship_covers(
  p_scope text, p_school uuid, p_competition uuid)
RETURNS TABLE (school_id uuid) AS $$
  SELECT s.id FROM school s
   WHERE CASE p_scope
           WHEN 'school'      THEN s.id = p_school
           WHEN 'province'    THEN s.province IS NOT NULL
                                   AND s.province = (SELECT province FROM school
                                                      WHERE id = p_school)
           WHEN 'competition' THEN EXISTS (SELECT 1 FROM competition_entrant e
                                            WHERE e.competition_id = p_competition
                                              AND e.school_id = s.id)
           WHEN 'platform'    THEN true
           -- A placement that claims no exclusivity covers nobody, which is
           -- what makes the conflict test below symmetric without a branch.
           ELSE false
         END
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION sponsorship_covers(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sponsorship_covers(text, uuid, uuid) TO PUBLIC;

/**
 * A category exclusivity is kept, or waived by somebody who signs for it.
 *
 * TESTED IN BOTH DIRECTIONS, which beta-2's version was not. It refused a new
 * placement that walked into an existing exclusivity, and said nothing about a
 * new EXCLUSIVE placement written over sponsors already there — so a school
 * could sell exclusivity it had already given away, and the promise was broken
 * at the moment it was made. Here a conflict is any overlap in category, dates
 * and covered schools where EITHER side claims exclusivity.
 *
 * The message names the blocker: which sponsor, which category, which scope,
 * and until when. "not_permitted" tells a school office to ring somebody;
 * naming the standing deal tells them who to ring.
 */
CREATE OR REPLACE FUNCTION sponsorship_exclusivity_gate() RETURNS trigger AS $$
DECLARE v_category text; v_blocker record;
BEGIN
  SELECT category INTO v_category FROM sponsor WHERE id = NEW.sponsor_id;

  SELECT sp.name, other.exclusive_scope, other.ends_on, other.exclusive, sc.name AS school_name
    INTO v_blocker
    FROM sponsorship other
    JOIN sponsor sp ON sp.id = other.sponsor_id AND sp.category = v_category
    JOIN school  sc ON sc.id = other.school_id
   WHERE other.id IS DISTINCT FROM NEW.id
     AND sp.id IS DISTINCT FROM NEW.sponsor_id      -- a sponsor never blocks itself
     AND sp.active
     -- Overlapping terms. Two deals that never run at once do not conflict,
     -- which is what lets a school line up next season's bank in advance.
     AND other.starts_on <= NEW.ends_on
     AND other.ends_on   >= NEW.starts_on
     AND (other.exclusive OR NEW.exclusive)
     AND EXISTS (
       SELECT 1
         FROM sponsorship_covers(coalesce(other.exclusive_scope, 'school'),
                                 other.school_id, other.competition_id) a
         JOIN sponsorship_covers(coalesce(NEW.exclusive_scope, 'school'),
                                 NEW.school_id, NEW.competition_id) b
           ON a.school_id = b.school_id)
   ORDER BY other.exclusive DESC, other.ends_on DESC
   LIMIT 1;

  -- FOUND, not v_blocker IS NOT NULL. A composite is IS NOT NULL only when
  -- EVERY field is non-null, and a blocker that is merely in the way rather
  -- than exclusive has a NULL exclusive_scope — so the record tested false and
  -- the conflict passed straight through. It cost an hour and it is the reason
  -- the walk tests both directions rather than trusting the symmetric-looking
  -- query above.
  IF FOUND THEN
    IF NEW.waiver_note IS NULL THEN
      RAISE EXCEPTION
        'category exclusivity: % holds % exclusivity at scope % until % (%). '
        'This placement cannot proceed without a written waiver from somebody '
        'holding sponsorship.exclusivity.waive',
        v_blocker.name, v_category,
        coalesce(v_blocker.exclusive_scope, 'school'),
        v_blocker.ends_on, v_blocker.school_name
        USING ERRCODE = 'check_violation';
    END IF;

    -- A waiver is a decision, so it is made by the person making it. Accepting
    -- a waived_by naming somebody else would let the office write the
    -- principal's name on a decision the principal never took.
    IF NOT app_can('sponsorship.exclusivity.waive', NEW.school_id, NULL, NULL, NULL) THEN
      RAISE EXCEPTION
        'a waiver of category exclusivity must be signed by somebody holding '
        'sponsorship.exclusivity.waive at this school'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.waived_by := app_user_id();
    NEW.waived_at := now();
  ELSE
    -- No conflict, no waiver. A waiver on a placement nothing blocked would
    -- sit in the record implying a decision nobody had to take.
    NEW.waiver_note := NULL;
    NEW.waived_by   := NULL;
    NEW.waived_at   := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sponsorship_exclusivity BEFORE INSERT OR UPDATE ON sponsorship
  FOR EACH ROW EXECUTE FUNCTION sponsorship_exclusivity_gate();



-- ═══════════════════════════════════════════════════════════════
--  BROADCAST
-- ═══════════════════════════════════════════════════════════════
--
-- WHAT THIS IS NOT: a second scoring engine. scrbrd-beta-2 carried a
-- 4,172-line BroadcastScorer that kept its own idea of the score, and porting
-- it would have meant two implementations of an innings that can disagree
-- while each stays internally consistent. The overlay is PRESENTATION over the
-- same replay every other surface reads. Nothing here stores a score.
--
-- WHAT IT IS: a per-fixture decision to put a match on a screen the public can
-- watch, and a statement of what that screen may show.
--
-- WHY THAT DECISION HAS A TABLE
-- ─────────────────────────────
-- A scoreboard at the boundary and a stream overlay are different in kind. The
-- first is seen by people who walked to the ground; the second is permanent,
-- copyable, and reaches an audience nobody at the match chose. Both show
-- children's names. So broadcasting is OPT-IN PER FIXTURE, under its own
-- capability, and it says how much of a child's name goes on the screen.
--
-- `name_display` defaults to 'initials', which is the conservative answer and
-- the one a school that has thought about nothing in particular should get.
-- Somebody deciding otherwise is making a decision, and the row records who.
CREATE TABLE match_broadcast (
  match_id     uuid PRIMARY KEY REFERENCES match(id) ON DELETE CASCADE,
  -- Derived at write time from the match, never asserted — as everywhere.
  school_id    uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  -- Off until somebody turns it on. A fixture that has never been considered
  -- is a fixture that is not being broadcast.
  published    boolean NOT NULL DEFAULT false,
  -- How much of a player's name the overlay may carry.
  --   initials — "T Mahlangu". The default.
  --   full     — the whole name. A deliberate choice, recorded as one.
  --   none     — positions only, for an age group a school will not name.
  name_display text NOT NULL DEFAULT 'initials'
               CHECK (name_display IN ('initials','full','none')),
  -- Officials are adults doing a public job and are named by default; a school
  -- may still turn it off.
  show_officials boolean NOT NULL DEFAULT true,
  -- A caption for the overlay: the competition, the occasion, the sponsor line
  -- a school wants under the score.
  strapline    text CHECK (strapline IS NULL OR length(strapline) <= 200),
  published_by uuid REFERENCES app_user(id),
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON match_broadcast (school_id);

/**
 * The overlay's data, and the ONLY way it should ever be obtained.
 *
 * THE MASKING HAPPENS HERE, IN SQL, and that is the whole point of this
 * function. If a school has said initials, the browser never receives the full
 * name — not in a field it chooses not to render, not in a payload a developer
 * console can open, not in a response somebody screenshots. A widget that is
 * handed a full name and asked politely to show initials is a widget that
 * leaks the first time somebody renders the wrong field.
 *
 * SECURITY DEFINER, and it checks publication itself. An overlay is watched by
 * people with no account, so this cannot depend on the caller's own row-level
 * security the way the rest of the read path does. What makes that safe is
 * that it returns NOTHING for a fixture nobody has published, and only ever
 * the handful of columns below for one that is — no identifiers, no dates of
 * birth, no contact details, nothing that is not already being announced over
 * a public address system at the ground.
 */
CREATE OR REPLACE FUNCTION broadcast_name(p_name text, p_display text)
RETURNS text AS $$
  SELECT CASE
           WHEN p_name IS NULL OR p_display = 'none' THEN NULL
           WHEN p_display = 'full' THEN p_name
           -- Initials: every word but the last reduced to its first letter.
           -- "Thandeka Mahlangu" → "T Mahlangu"; a single-word name is left
           -- alone, because reducing it would leave a letter and nothing else.
           WHEN position(' ' IN btrim(p_name)) = 0 THEN btrim(p_name)
           ELSE (
             SELECT string_agg(
                      CASE WHEN ord = cnt THEN word ELSE left(word, 1) END,
                      ' ' ORDER BY ord)
               FROM (
                 SELECT word, row_number() OVER () AS ord,
                        count(*) OVER () AS cnt
                   FROM regexp_split_to_table(btrim(p_name), '\s+') AS word
               ) parts
           )
         END
$$ LANGUAGE sql IMMUTABLE;

REVOKE ALL ON FUNCTION broadcast_name(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION broadcast_name(text, text) TO PUBLIC;

-- Dropped rather than replaced: the sponsor columns below were added after
-- this function already existed, and CREATE OR REPLACE cannot change a
-- function's return type. Without this, applying the file over an older
-- database fails on the signature instead of on anything meaningful.
DROP FUNCTION IF EXISTS broadcast_state(uuid);

CREATE OR REPLACE FUNCTION broadcast_state(p_match uuid)
RETURNS TABLE (
  match_id uuid, home_team text, away_team text, strapline text,
  innings smallint, runs bigint, wickets bigint, legal_balls bigint,
  overs text, run_rate numeric, target bigint,
  striker text, non_striker text, bowler text,
  officials text, name_display text,
  -- The board, and nothing behind it. See the sponsor CTE below.
  sponsor_name text, sponsor_logo text, sponsor_bg text
) AS $$
  WITH b AS (
    SELECT * FROM match_broadcast WHERE match_id = p_match AND published
  ),
  m AS (
    SELECT mt.* FROM match mt JOIN b ON b.match_id = mt.id
  ),
  -- The innings being played is the highest one the log has reached.
  cur AS (
    SELECT ls.* FROM match_live_score ls JOIN b ON b.match_id = ls.match_id
     ORDER BY ls.innings DESC LIMIT 1
  ),
  -- A chase has a target: what the previous innings made, plus one.
  prev AS (
    SELECT ls.runs FROM match_live_score ls JOIN cur ON cur.match_id = ls.match_id
     WHERE ls.innings < cur.innings ORDER BY ls.innings DESC LIMIT 1
  ),
  -- Who is at the crease, taken from the last delivery bowled rather than
  -- replayed: ball_event stamps the striker and the bowler on every ball, and
  -- an overlay wants the state at the last ball by definition.
  last_ball AS (
    SELECT e.striker_id, e.non_striker_id, e.bowler_id
      FROM ball_event e JOIN cur ON cur.match_id = e.match_id AND cur.innings = e.innings
     WHERE e.kind = 'ball'
     ORDER BY e.seq DESC LIMIT 1
  ),
  -- The sponsor whose board this is, if the school sold the surface.
  --
  -- THREE COLUMNS AND NO MORE. contract_value_zar and school_share_pct are on
  -- the same row and are not selected here, and this function is SECURITY
  -- DEFINER — so the masking view that keeps them from a coach would not have
  -- kept them from a spectator. What a sponsor pays is between the sponsor and
  -- the school; what a sponsor buys is a name on a screen, and that is all
  -- that leaves.
  --
  -- A placement tied to THIS fixture wins over the school's standing one:
  -- ordering match_id first with NULLS LAST puts the specific agreement ahead
  -- of the general one, which is what a school selling a one-off derby board
  -- on top of a season deal expects.
  sponsor AS (
    SELECT sp.name, sp.logo_text, sp.logo_bg
      FROM sponsorship s
      JOIN sponsor sp ON sp.id = s.sponsor_id AND sp.active
      JOIN m ON m.school_id = s.school_id
     WHERE s.placement = 'broadcast_overlay'
       AND (s.match_id IS NULL OR s.match_id = m.id)
       AND current_date BETWEEN s.starts_on AND s.ends_on
     ORDER BY s.match_id NULLS LAST, s.agreed_at DESC
     LIMIT 1
  )
  SELECT m.id,
         m.team_code, m.opponent,
         b.strapline,
         cur.innings, cur.runs, cur.wickets, cur.legal_balls,
         (cur.legal_balls / 6)::text || '.' || (cur.legal_balls % 6)::text,
         CASE WHEN cur.legal_balls > 0
              THEN round((cur.runs::numeric * 6) / cur.legal_balls, 2) END,
         (SELECT runs + 1 FROM prev),
         -- Every name goes through the masker. There is no branch here that
         -- returns an unmasked one.
         broadcast_name((SELECT full_name FROM player WHERE id = (SELECT striker_id FROM last_ball)), b.name_display),
         broadcast_name((SELECT full_name FROM player WHERE id = (SELECT non_striker_id FROM last_ball)), b.name_display),
         broadcast_name((SELECT full_name FROM player WHERE id = (SELECT bowler_id FROM last_ball)), b.name_display),
         -- Officials are adults doing a public job, so they are named in full
         -- when shown at all — but only when the school said to show them.
         CASE WHEN b.show_officials THEN (
           SELECT string_agg(o.person_name, ' · ' ORDER BY o.duty, o.person_name)
             FROM match_official o
            WHERE o.match_id = m.id AND NOT o.withdrawn AND o.duty IN ('umpire','third_umpire')
         ) END,
         b.name_display,
         (SELECT name FROM sponsor), (SELECT logo_text FROM sponsor), (SELECT logo_bg FROM sponsor)
    FROM b JOIN m ON m.id = b.match_id LEFT JOIN cur ON cur.match_id = b.match_id
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION broadcast_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION broadcast_state(uuid) TO PUBLIC;

-- ── The half of the notification system that was missing ────────
--
-- `notification` and `notification_read` have been here since the start, with
-- a capability-gated publish policy and a feed the dashboard reads. What there
-- has never been is DELIVERY. A notice sits in the database until somebody
-- opens the app, which for "your son has been taken to hospital" is not a
-- notification system at all.
--
-- THE RULE THAT SHAPES EVERY LINE BELOW: a cached notification is not
-- permission. A device that once received a notice has no standing to receive
-- the next one, and a push that went out last week says nothing about who may
-- read anything today. So nothing here decides who receives what. The
-- notification's own policy already does — news.read AND the capability the
-- row declares, in the row's scope — and the fan-out RE-ASKS IT, per person,
-- at send time, through the same policy. A role withdrawn an hour ago means
-- the phone stays silent, with no cache to invalidate and no subscription list
-- to reconcile.
--
-- WHAT GOES ON THE WIRE IS A SECOND QUESTION, and the answer is: as little as
-- possible. A push payload is stored by Google, rendered on a lock screen, and
-- read by whoever is holding the phone — which at a school gate on a Saturday
-- is not necessarily the parent. "R Pillay is out with a hamstring strain" on
-- a lock screen is a disclosure of a child's medical information to a bystander,
-- and it is a disclosure this platform's whole masking apparatus exists to
-- prevent one screen earlier. So the full text travels ONLY for a notice the
-- school has already marked public — which the existing
-- notification_public_is_general CHECK guarantees requires nothing beyond
-- news.read. Everything else travels as a pointer: a generic line and an id,
-- with the real content fetched through the governed read when the app opens
-- and the person is authenticated again.

-- A phone, and the token FCM will accept for it.
--
-- Governed by IDENTITY, not by capability, exactly as notification_read is.
-- "Which devices are mine" is a question only I can answer about myself, and
-- there is no scope, role or assignment in it. Forcing it through the
-- capability model would be worse than inconsistent: the list of a person's
-- devices, with the times each was last seen, is a movement and behaviour
-- trail, and no role in this product has a reason to hold somebody else's.
CREATE TABLE device_push_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  -- What FCM hands the browser. Opaque, long, and it rotates — which is why
  -- the row is keyed on its own id and the token is merely unique, rather than
  -- the token being the key.
  token       text NOT NULL CHECK (length(btrim(token)) BETWEEN 16 AND 4096),
  platform    text NOT NULL CHECK (platform IN ('web','android','ios')),
  -- The device id the session token already carries, so a person signing out
  -- of one phone retires that phone's registration and not their other one.
  device_id   text,
  -- "Dad's phone". The person's own words, for their own settings screen.
  label       text CHECK (label IS NULL OR length(label) <= 60),
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- RETIRED, never deleted. This database grants no DELETE anywhere, and the
  -- row that says a device was registered and then signed out is the record
  -- that a registration happened at all.
  retired_at    timestamptz,
  retired_reason text CHECK (retired_reason IS NULL OR retired_reason IN
                   ('signed_out','rejected','replaced','stale')),
  CONSTRAINT retired_has_a_reason CHECK ((retired_at IS NULL) = (retired_reason IS NULL))
);
-- One live registration per token. Partial, because a retired row keeps the
-- token it had — that is the record of which device it was.
CREATE UNIQUE INDEX device_push_token_live ON device_push_token (token)
  WHERE retired_at IS NULL;
CREATE INDEX ON device_push_token (person_id) WHERE retired_at IS NULL;

/**
 * A phone that changes hands must stop receiving the last person's alerts.
 *
 * The hazard is ordinary and the consequence is not: a parent signs in on a
 * shared family tablet, a second parent signs in on the same tablet, and FCM
 * hands the browser THE SAME registration token. Without this, both rows are
 * live, the fan-out finds both, and the tablet receives alerts about a child
 * whose family the current user does not belong to.
 *
 * So registering a token retires any live row that holds it for somebody else.
 * SECURITY DEFINER because that row belongs to another person and the caller
 * cannot see it — this is the case where definer rights are the requirement
 * rather than a convenience: under the caller's own policy the UPDATE would
 * match nothing, the registration would succeed, and the stale row would
 * quietly survive. A refusal we never see is worse than one we do.
 *
 * It retires rather than reassigns. Who held a device and when is not
 * something to overwrite.
 */
CREATE OR REPLACE FUNCTION device_push_token_claim() RETURNS trigger AS $$
BEGIN
  IF NEW.retired_at IS NOT NULL THEN RETURN NEW; END IF;
  UPDATE device_push_token
     SET retired_at = now(), retired_reason = 'replaced'
   WHERE token = NEW.token
     AND retired_at IS NULL
     AND id IS DISTINCT FROM NEW.id
     AND person_id IS DISTINCT FROM NEW.person_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS device_push_token_claims_the_device ON device_push_token;
CREATE TRIGGER device_push_token_claims_the_device
  BEFORE INSERT OR UPDATE ON device_push_token
  FOR EACH ROW EXECUTE FUNCTION device_push_token_claim();

ALTER TABLE device_push_token ENABLE ROW LEVEL SECURITY;

CREATE POLICY device_push_token_read ON device_push_token
  FOR SELECT USING (person_id = app_user_id());

-- You may register a device AS YOURSELF and no other way. There is no
-- administrative override: nobody enrols somebody else's phone.
CREATE POLICY device_push_token_insert ON device_push_token
  FOR INSERT WITH CHECK (person_id = app_user_id());

CREATE POLICY device_push_token_update ON device_push_token
  FOR UPDATE USING (person_id = app_user_id())
           WITH CHECK (person_id = app_user_id());

-- What was actually put on the wire, per notice per device.
--
-- Evidence, and a de-duplicator: the primary key is the pair, so a fan-out run
-- twice sends once. payload_kind records WHICH payload went — a 'pointer' row
-- is the proof that a restricted notice did not travel in clear text, which is
-- the kind of thing a school is eventually asked to show.
--
-- Written BY THE RECIPIENT, under their own principal, inside the same
-- per-person step that checked visibility. That is not an implementation
-- detail: it means the sender is structurally incapable of recording a
-- delivery to somebody who could not read the notice, because the insert would
-- be refused by the same policy that refused them the row.
CREATE TABLE notification_delivery (
  notification_id uuid NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  token_id     uuid NOT NULL REFERENCES device_push_token(id) ON DELETE CASCADE,
  person_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  payload_kind text NOT NULL CHECK (payload_kind IN ('full','pointer')),
  state        text NOT NULL CHECK (state IN ('sent','failed','rejected')),
  detail       text,
  attempts     smallint NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 100),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, token_id)
);
CREATE INDEX ON notification_delivery (person_id, attempted_at DESC);

ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY;

-- Your own delivery history and nobody else's. A publisher asking "did it
-- reach the parents" is asking a reasonable question with an unreasonable
-- answer attached — which families have the app installed, on how many
-- devices, last seen when. That is not a reporting line this product offers.
CREATE POLICY notification_delivery_read ON notification_delivery
  FOR SELECT USING (person_id = app_user_id());

CREATE POLICY notification_delivery_insert ON notification_delivery
  FOR INSERT WITH CHECK (
    person_id = app_user_id()
    -- Re-enters the notification policy rather than trusting the id handed
    -- in, exactly as notification_read does, so this table cannot be used to
    -- probe which notification ids exist.
    AND EXISTS (SELECT 1 FROM notification n WHERE n.id = notification_delivery.notification_id)
  );

CREATE POLICY notification_delivery_update ON notification_delivery
  FOR UPDATE USING (person_id = app_user_id())
           WITH CHECK (person_id = app_user_id());

/**
 * Who might be reachable, which is not the same question as who may receive.
 *
 * A fan-out has to start from a list of devices, and no principal in this
 * product may read another person's device rows — correctly, since that list
 * is a movement trail. So this enumeration is SECURITY DEFINER, and it is
 * carefully the WEAKEST thing that works: every live token belonging to
 * somebody with an active assignment at the notice's school.
 *
 * IT DECIDES NOTHING. Every row it returns is handed straight back to the
 * notification's own policy, as that person, and a person who may not read the
 * notice receives nothing however many devices they have registered. Read it
 * as an address book, not as a permission — the temptation to add a capability
 * filter here is the temptation to answer the authorization question twice, in
 * two places, one of which will drift.
 *
 * Scoped to the school because a tenant is the widest an enumeration ever
 * needs to be, and a cross-tenant one is exactly the shape of the failure
 * this codebase spent its whole life removing.
 */
CREATE OR REPLACE FUNCTION push_candidates(p_school uuid)
RETURNS TABLE (token_id uuid, person_id uuid, token text, platform text) AS $$
  SELECT DISTINCT t.id, t.person_id, t.token, t.platform
    FROM device_push_token t
    JOIN role_assignment a ON a.person_id = t.person_id
   WHERE t.retired_at IS NULL
     AND a.active
     AND (a.school_id IS NULL OR a.school_id = p_school)
     AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
     AND (a.valid_until IS NULL OR a.valid_until >  current_date)
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Reachable only from this application's own code. A person holding a session
-- has no business calling it directly, and PUBLIC execute on a DEFINER
-- enumeration is how a helper becomes a directory.
REVOKE ALL ON FUNCTION push_candidates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_candidates(uuid) TO scrbrd_app;

-- ── The coefficients of the rewards algorithm, kept where a browser cannot reach ──
--
-- The rewards figure is a weighted composite of four things: impact-adjusted
-- performance, current rating on the absolute rubric, the breadth and freshness
-- of the evidence behind that rating, and GROWTH — the change in rating over
-- elapsed time, which is the term that makes a weak player's improvement worth
-- more than a strong player's plateau. The weights are the product decision,
-- and they are deliberately not public.
--
-- WHY THEY LIVE IN THE DATABASE RATHER THAN IN CODE. Anything in packages/ can
-- be imported by the web app, and anything the web app imports is in the
-- bundle, which is a text file on a stranger's laptop. A constant named
-- GROWTH_WEIGHT in a shared module is a published constant with extra steps.
-- In a table, behind a platform capability, with no read route and no read
-- resource, the only way to it is a server process holding the application
-- role — which is the boundary we actually control.
--
-- WHY THEY ARE VERSIONED. Every aggregate in this product is derived and none
-- is stored, the rewards figure included. Derive last term's award with this
-- term's coefficients and you get a different answer for a term that has
-- already been awarded — so the award cannot be re-derived, which is the one
-- property that makes deriving safe. Keeping the coefficients that were in
-- force, rather than the answers they produced, is the same choice as keeping
-- the ball log rather than the scorecard.
--
-- THERE IS NO READ ROUTE AND NO READ RESOURCE, on purpose. An endpoint that
-- returns a coefficient is an endpoint that publishes the algorithm to anyone
-- who can call it, and a platform administrator who needs to see the current
-- values has a database. What the API returns about a reward is the figure and
-- its components' RANKS AND BANDS, never their weights or contributions:
-- publishing a weight beside a contribution is publishing the coefficient, by
-- algebra, to anybody who can divide.
CREATE TABLE reward_weight (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The coefficient's name. Deliberately not an enum: the algorithm will gain
  -- and lose terms, and a CHECK listing them would put the shape of the
  -- algorithm in the schema, which ships to anybody who can read a migration.
  key  text NOT NULL CHECK (length(btrim(key)) BETWEEN 3 AND 80),
  value numeric NOT NULL,
  -- From when. A row is never edited: a new coefficient is a new row with a
  -- later date, and the old one stays because a past term was awarded with it.
  effective_from date NOT NULL,
  -- Why it moved. The most useful column here in two years' time, when
  -- somebody asks why the growth weight doubled in 2027.
  note   text CHECK (note IS NULL OR length(note) <= 500),
  set_by uuid REFERENCES app_user(id),
  set_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, effective_from)
);
CREATE INDEX ON reward_weight (key, effective_from DESC);

ALTER TABLE reward_weight ENABLE ROW LEVEL SECURITY;

-- Hand-written, like feature_flag's and for the same reason: this table has NO
-- SCHOOL. Every anchor the policy generator builds is a tenant comparison, and
-- the platform's algorithm belongs to no tenant.
--
-- READ IS AS NARROW AS WRITE, which is unusual in this schema and is the point.
-- Everywhere else a capability to read is wider than a capability to write,
-- because reading is the ordinary case. Here the value IS the secret, so
-- reading it is the sensitive act, and there is no role at a school — not a
-- principal, not a director of sport — that has any business holding it.
CREATE POLICY reward_weight_read ON reward_weight
  FOR SELECT USING (app_holds('platform.reward.manage'));

CREATE POLICY reward_weight_insert ON reward_weight
  FOR INSERT WITH CHECK (app_holds('platform.reward.manage'));

-- UPDATE exists only so a note can be corrected. The value and the date are
-- frozen by the trigger below: changing a coefficient that was already in
-- force would silently re-write what a past term was awarded on.
CREATE POLICY reward_weight_update ON reward_weight
  FOR UPDATE USING (app_holds('platform.reward.manage'))
           WITH CHECK (app_holds('platform.reward.manage'));

/**
 * A coefficient in force is a matter of record.
 *
 * Same reasoning as the toss freezing once a delivery exists. An award is
 * derived, not stored, so the only thing standing between a past term's figures
 * and silent revision is that the inputs cannot move. A correction is a new row
 * with a later effective_from; this refuses the edit rather than trusting
 * everyone to remember that.
 */
CREATE OR REPLACE FUNCTION reward_weight_is_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.value IS DISTINCT FROM OLD.value
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION
      'a coefficient already in force cannot be changed; insert a new row with a later effective_from'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.set_by := OLD.set_by;
  NEW.set_at := OLD.set_at;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reward_weight_stays_put ON reward_weight;
CREATE TRIGGER reward_weight_stays_put
  BEFORE UPDATE ON reward_weight
  FOR EACH ROW EXECUTE FUNCTION reward_weight_is_immutable();

/**
 * Who set it, taken from the session rather than the request.
 *
 * The same stamp as role_assignment's granter and match_availability's
 * declarant, for the same reason: the person who typed it is the person the
 * platform can stand behind, and no route, import or psql session gets to
 * claim somebody else moved the algorithm.
 */
CREATE OR REPLACE FUNCTION reward_weight_stamp_setter() RETURNS trigger AS $$
BEGIN
  NEW.set_by := app_user_id();
  NEW.set_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reward_weight_stamps_setter ON reward_weight;
CREATE TRIGGER reward_weight_stamps_setter
  BEFORE INSERT ON reward_weight
  FOR EACH ROW EXECUTE FUNCTION reward_weight_stamp_setter();

/**
 * The coefficient in force on a date, for the computation to use.
 *
 * SECURITY DEFINER because the computation runs as the COACH who asked for a
 * player's figure, and a coach may not read this table — correctly, since the
 * value is the secret. This is the same case as every other definer function
 * here: a question the caller cannot answer about data they cannot see, where
 * running under the caller's own policy would return nothing and the figure
 * would silently come out as though the weight were zero.
 *
 * REVOKEd from PUBLIC and granted only to the application role, so it is
 * reachable from this codebase's own server processes and from nothing a person
 * holds. That is a narrower door than the table's own policy, which is the
 * right way round: the table is for the platform to manage, this is for the
 * algorithm to run.
 *
 * It returns ONE value and takes ONE key. No function here returns the set,
 * because a function that returns the set is the algorithm in one call.
 */
CREATE OR REPLACE FUNCTION reward_weight_at(p_key text, p_on date DEFAULT current_date)
RETURNS numeric AS $$
  SELECT w.value FROM reward_weight w
   WHERE w.key = p_key AND w.effective_from <= p_on
   ORDER BY w.effective_from DESC
   LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION reward_weight_at(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reward_weight_at(text, date) TO scrbrd_app;

-- ── The sport catalogue's policies, and the gate on cricket's machinery ──
--
-- The table is in db/00 because `match` references it and that file runs
-- first; the policies are here because app_holds() does not exist until
-- db/01_authz.sql. Same split as school and app_user, whose policies are in
-- db/09 for the same reason.
ALTER TABLE sport ENABLE ROW LEVEL SECURITY;

-- Readable by anyone signed in, exactly as feature_flag is. Which sports exist
-- and how much of each works is not a secret — a client has to know what to
-- draw, and hiding it would only mean the client hard-coded a list, which is
-- the state this replaces.
CREATE POLICY sport_read ON sport
  FOR SELECT USING (app_user_id() IS NOT NULL);

-- Written only by the platform, through app_holds() because there is no tenant
-- to anchor on. NOT a new capability: deciding which sports the product
-- supports is precisely "enable or disable a product feature platform-wide",
-- and inventing sport.manage would be a second name for the same authority.
CREATE POLICY sport_insert ON sport
  FOR INSERT WITH CHECK (app_holds('platform.feature.manage'));
CREATE POLICY sport_update ON sport
  FOR UPDATE USING (app_holds('platform.feature.manage'))
           WITH CHECK (app_holds('platform.feature.manage'));

/**
 * A fixture may only be in a sport this school actually runs.
 *
 * Asked through feature_enabled(key, school, NULL) — the same function the
 * module gate and the read path use — so a sport resolves through the three
 * levels every other switch does and cannot acquire its own rules. The
 * platform grants; a school may reduce.
 *
 * SECURITY DEFINER because it reads feature_grant and feature_suppression,
 * which a coach cannot see. Under the caller's own policies the lookup would
 * find nothing and every fixture would be refused with a sentence about a
 * sport the school does run — a refusal whose stated reason is a fabrication,
 * which this codebase has now hit twice and is not doing a third time.
 *
 * The message names the sport and says who can change it, because the person
 * who hits this is a sportsmaster typing a hockey fixture into a product that
 * has not been given hockey, and "not permitted" would send them to their own
 * IT department.
 */
CREATE OR REPLACE FUNCTION match_sport_is_enabled() RETURNS trigger AS $$
DECLARE v_label text; v_key text;
BEGIN
  -- An UPDATE that does not touch the sport is left alone. Without this, a
  -- school that stopped running hockey could not correct a typo in the venue
  -- of a hockey fixture it already has — and the history is precisely what
  -- switching a sport off must not destroy.
  IF TG_OP = 'UPDATE' AND NEW.sport IS NOT DISTINCT FROM OLD.sport THEN
    RETURN NEW;
  END IF;

  SELECT s.label, s.flag_key INTO v_label, v_key FROM sport s WHERE s.code = NEW.sport;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such sport: %', NEW.sport USING ERRCODE = 'check_violation';
  END IF;

  IF NOT feature_enabled(v_key, NEW.school_id, NULL) THEN
    RAISE EXCEPTION
      '% is not switched on for this school. A sport is granted by the platform, not enabled locally — ask SCRBRD to add it to your plan',
      v_label
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS match_sport_is_granted ON match;
CREATE TRIGGER match_sport_is_granted
  BEFORE INSERT OR UPDATE ON match
  FOR EACH ROW EXECUTE FUNCTION match_sport_is_enabled();

/**
 * The ball log, the toss and DRS belong to cricket and to nothing else.
 *
 * One function on four tables rather than four functions, so the refusal reads
 * the same wherever somebody meets it, and so a fifth cricket table added later
 * needs a trigger rather than a copy.
 *
 * ON ball_event TOO, which is the hot path. A per-delivery primary-key lookup
 * at school-cricket volumes — a few hundred balls a match — is not a cost
 * worth reasoning about, and the alternative is trusting that nothing ever
 * writes a delivery except through a route that checked. There are already
 * three ways a row reaches this schema (the API, a seed, an import) and
 * "remember to check the sport" survives exactly as long as the person who
 * knew about it.
 *
 * SECURITY DEFINER for the reason the availability and trip checks are: a
 * check that cannot see the row it is checking passes, and a silent pass is
 * worse than a refusal.
 */
CREATE OR REPLACE FUNCTION requires_cricket() RETURNS trigger AS $$
DECLARE v_sport text; v_label text;
BEGIN
  SELECT m.sport INTO v_sport FROM match m WHERE m.id = NEW.match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such fixture: %', NEW.match_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_sport <> 'cricket' THEN
    SELECT s.label INTO v_label FROM sport s WHERE s.code = v_sport;
    RAISE EXCEPTION
      '% cannot carry a %: that is part of the cricket scoring engine, and this fixture is a % fixture',
      TG_TABLE_NAME, TG_TABLE_NAME, coalesce(v_label, v_sport)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS ball_event_is_cricket ON ball_event;
CREATE TRIGGER ball_event_is_cricket
  BEFORE INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION requires_cricket();

DROP TRIGGER IF EXISTS match_toss_is_cricket ON match_toss;
CREATE TRIGGER match_toss_is_cricket
  BEFORE INSERT OR UPDATE ON match_toss
  FOR EACH ROW EXECUTE FUNCTION requires_cricket();

DROP TRIGGER IF EXISTS scoring_session_is_cricket ON scoring_session;
CREATE TRIGGER scoring_session_is_cricket
  BEFORE INSERT ON scoring_session
  FOR EACH ROW EXECUTE FUNCTION requires_cricket();

DROP TRIGGER IF EXISTS drs_review_is_cricket ON drs_review;
CREATE TRIGGER drs_review_is_cricket
  BEFORE INSERT ON drs_review
  FOR EACH ROW EXECUTE FUNCTION requires_cricket();

/**
 * A fixture's sport is frozen once its scoring machinery has anything in it.
 *
 * Same reasoning as the toss freezing once a delivery exists. Changing a
 * scored cricket fixture to hockey would leave a ball log attached to a
 * fixture whose sport says those deliveries cannot exist — and every replay
 * over it would be deriving a cricket innings from a hockey match.
 */
CREATE OR REPLACE FUNCTION match_sport_is_frozen_once_played() RETURNS trigger AS $$
BEGIN
  IF NEW.sport IS NOT DISTINCT FROM OLD.sport THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = NEW.id) THEN
    RAISE EXCEPTION
      'this fixture already has a ball log; its sport cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS match_sport_stays_put ON match;
CREATE TRIGGER match_sport_stays_put
  BEFORE UPDATE ON match
  FOR EACH ROW EXECUTE FUNCTION match_sport_is_frozen_once_played();

-- ── One fixture, two schools ─────────────────────────────────────
--
-- `match.away_school_id` / `away_team_code` name the away side when it is a
-- SCRBRD tenant; `opponent` carries the name either way. The read policy is
-- generated and asks fixture.read at BOTH sides' scopes — see the note on
-- `readAnchors` in packages/policy/src/tables.mjs. What is left for this file
-- is keeping the display name honest and stopping the two halves diverging.

/**
 * When the away side is a tenant, its name is not typed — it is stamped.
 *
 * `opponent` stays NOT NULL and stays the thing every read displays, which is
 * what let this land without touching the fixture list, the scorecard header,
 * the broadcast overlay or the derby record. But a typed name beside a school
 * id is two sources of truth for one fact, and the typed one will drift: a
 * school renames itself, somebody abbreviates, and the derby read — which
 * groups on the string — starts counting one rival as two.
 *
 * So when away_school_id is set, opponent is DERIVED and any supplied value is
 * replaced. Not refused: a route that sent both a school id and the name it
 * knew is not making a mistake worth failing a Saturday over, and the stamp
 * makes the argument moot.
 *
 * SECURITY DEFINER because it reads `school`, which is scoped to the tenants
 * the caller is attached to. A sportsmaster arranging a fixture against a
 * school they have no assignment at cannot see that school's row — so under
 * the caller's own policies the lookup would find nothing, the name would come
 * out NULL, and the NOT NULL would refuse a perfectly legitimate fixture with
 * a message about a missing opponent.
 */
CREATE OR REPLACE FUNCTION match_away_side_label() RETURNS trigger AS $$
DECLARE v_name text;
BEGIN
  IF NEW.away_school_id IS NULL THEN RETURN NEW; END IF;
  SELECT s.name INTO v_name FROM school s WHERE s.id = NEW.away_school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such school: %', NEW.away_school_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- "Michaelhouse 1XI" rather than "Michaelhouse": the fixture is against a
  -- named side, and a school fields eleven of them on a Saturday.
  NEW.opponent := v_name || ' ' || NEW.away_team_code;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS match_away_side_is_named ON match;
CREATE TRIGGER match_away_side_is_named
  BEFORE INSERT OR UPDATE ON match
  FOR EACH ROW EXECUTE FUNCTION match_away_side_label();

/**
 * The away side of a played fixture is frozen, like its sport.
 *
 * Once there is a ball log, every derived figure — the scorecard, the ladder,
 * the head-to-head, a boy's average against that school — was computed against
 * whoever the away side was. Re-pointing it afterwards silently re-attributes
 * a season's cricket to a school that never played it.
 *
 * The home side is already immutable in practice, because school_id and
 * team_code are the fixture's own scope anchors and changing them would move
 * the row out from under the assignment that may write it. This says the same
 * thing about the other half, out loud.
 */
CREATE OR REPLACE FUNCTION match_away_side_is_frozen_once_played() RETURNS trigger AS $$
BEGIN
  IF NEW.away_school_id IS NOT DISTINCT FROM OLD.away_school_id
     AND NEW.away_team_code IS NOT DISTINCT FROM OLD.away_team_code THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = NEW.id) THEN
    RAISE EXCEPTION
      'this fixture already has a ball log; the side it was played against cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS match_away_side_stays_put ON match;
CREATE TRIGGER match_away_side_stays_put
  BEFORE UPDATE ON match
  FOR EACH ROW EXECUTE FUNCTION match_away_side_is_frozen_once_played();

/**
 * A squad row's side must be a side this fixture actually has.
 *
 * match_squad.side is 'home' or 'away' and its anchors now follow it (see
 * tables.mjs). For a fixture whose away side is not a tenant, an away row
 * anchors at a NULL school and the policy refuses it — which is correct, and
 * is a refusal whose REASON is worth stating rather than leaving as
 * "not permitted": the opposition's team sheet belongs to the opposition.
 *
 * SECURITY DEFINER for the reason every check here is: a check that cannot see
 * the fixture it is checking passes, and a silent pass is worse than a refusal.
 */
CREATE OR REPLACE FUNCTION match_squad_side_exists() RETURNS trigger AS $$
DECLARE v_away uuid;
BEGIN
  IF NEW.withdrawn THEN RETURN NEW; END IF;
  IF NEW.side <> 'away' THEN RETURN NEW; END IF;
  SELECT m.away_school_id INTO v_away FROM match m WHERE m.id = NEW.match_id;
  IF v_away IS NULL THEN
    RAISE EXCEPTION
      'this fixture''s away side is not a school on SCRBRD, so its team sheet is not ours to name'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS match_squad_side_is_real ON match_squad;
CREATE TRIGGER match_squad_side_is_real
  BEFORE INSERT OR UPDATE ON match_squad
  FOR EACH ROW EXECUTE FUNCTION match_squad_side_exists();

/**
 * How a side is written on a fixture list, from either end of it.
 *
 * A SHARED FIXTURE CREATES A PROBLEM THE OLD ONE DID NOT HAVE. `school` is
 * scoped to the tenants a person is attached to — correctly; the tenant list is
 * not public — and the away school's coaches are attached to their own school,
 * not to the host's. So the moment a Westville coach can read a
 * Hilton-hosted fixture, they can read a row naming a school they cannot
 * resolve, and their fixture list says "a match against Westville 1XI" with no
 * indication of who is hosting.
 *
 * SECURITY DEFINER, returning THE NAME AND NOTHING ELSE. That is the whole
 * disclosure: a school's name and the side it has fielded, which is already on
 * every team sheet, every league ladder and every public scoreboard this
 * product draws. It does not return the tenant list, and it answers only about
 * an id the caller already holds — which they only hold by having read a
 * fixture that names it.
 */
CREATE OR REPLACE FUNCTION fixture_side_label(p_school uuid, p_team text)
RETURNS text AS $$
  SELECT CASE
           WHEN p_school IS NULL THEN NULL
           WHEN p_team IS NULL THEN (SELECT s.name FROM school s WHERE s.id = p_school)
           ELSE (SELECT s.name || ' ' || p_team FROM school s WHERE s.id = p_school)
         END
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION fixture_side_label(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fixture_side_label(uuid, text) TO PUBLIC;

-- Stamped through the same function the reads display, so the derived name and
-- the displayed name cannot come out differently.
CREATE OR REPLACE FUNCTION match_away_side_label() RETURNS trigger AS $$
DECLARE v_label text;
BEGIN
  IF NEW.away_school_id IS NULL THEN RETURN NEW; END IF;
  v_label := fixture_side_label(NEW.away_school_id, NEW.away_team_code);
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'no such school: %', NEW.away_school_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.opponent := v_label;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Which sides a boy has been in, which was being overwritten ───
--
-- player.team_code is a single mutable column, and it is the scope anchor half
-- the policies in this schema hang off — so it stays exactly what it is: the
-- CURRENT side. What was missing is everything before it. A boy promoted from
-- the 2XI to the 1XI in March was overwritten, not recorded: last season's
-- side could not be reconstructed, "when did he move up" had no answer, and a
-- career that is mostly a story of moving through teams had no rows to tell it
-- with. The CSV import moves team_code today (coalesce($3, team_code)), so
-- this is not a future hazard — history has been lost through a real route
-- since the import landed.
--
-- THE HISTORY IS DERIVED, NEVER ASSERTED. Nobody writes a membership row;
-- writing player.team_code writes one, through the trigger below, exactly as
-- the ball log derives the scorecard. That is also what makes the history
-- trustworthy: there is no INSERT or UPDATE policy on this table AT ALL, so
-- the application role cannot forge a membership or quietly edit one, and the
-- record of where a boy played is as tamper-evident as the appointments and
-- the coefficients are.
--
-- `sport` is here even though player.team_code is implicitly cricket today:
-- the catalogue landed this week, a boy will eventually hold a side per sport,
-- and a history table is the one place a missing dimension cannot be
-- retrofitted — the old rows would not know which game they were about.
CREATE TABLE team_membership (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- Copied from the player AT THE TIME, not joined at read time: a boy who
  -- changes schools keeps his old school on his old rows, which is the point
  -- of a history.
  school_id  uuid NOT NULL REFERENCES school(id),
  sport      text NOT NULL DEFAULT 'cricket' REFERENCES sport(code),
  team_code  text NOT NULL,
  joined_on  date NOT NULL DEFAULT current_date,
  -- NULL means this is where he is now. A row is closed by the next move,
  -- never edited by a person.
  left_on    date,
  -- How the row came to exist, in the only vocabulary the trigger can honestly
  -- derive: 'joined' is a first side, 'moved' is a change. Richer words —
  -- promoted, dropped, aged up — are judgements about direction that a column
  -- write does not carry, and guessing them here would put an opinion in a
  -- table whose whole value is that it holds none.
  reason     text NOT NULL DEFAULT 'moved' CHECK (reason IN ('joined','moved')),
  -- Who made the move, stamped from the session as every provenance column
  -- here is. NULL is a migration or an import running as the owner, which is
  -- itself information.
  moved_by   uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT membership_leaves_after_joining CHECK (left_on IS NULL OR left_on >= joined_on)
);
-- One open membership per boy per sport. Partial, because closed rows are the
-- history and there are meant to be many of them.
CREATE UNIQUE INDEX team_membership_current ON team_membership (player_id, sport)
  WHERE left_on IS NULL;
CREATE INDEX ON team_membership (school_id, sport, team_code, joined_on DESC);

ALTER TABLE team_membership ENABLE ROW LEVEL SECURITY;

-- READ follows the BOY, not the old team. A 1XI coach reading a boy now in
-- his side needs the U15A and U16B rows that explain him, and anchoring the
-- team dimension on each row's historical code would hide exactly those. So
-- the team anchor is the player's CURRENT side — the same question as "may
-- you read this boy's roster row", asked with the same capability — and the
-- school anchor stays on the row, so a boy who moves schools does not carry
-- his old school's rows to staff at the new one. Whether a history should
-- travel between schools is the passport question, and it is a consent
-- decision for later, not a default to slip in here.
CREATE POLICY team_membership_read ON team_membership
  FOR SELECT USING (app_can('player.profile.read',
    team_membership.school_id,
    (SELECT p.team_code FROM player p WHERE p.id = team_membership.player_id),
    team_membership.player_id,
    '00000000-0000-0000-0000-000000000000'::uuid));

-- NO INSERT, UPDATE OR DELETE POLICY, deliberately. Default deny is the whole
-- write model for this table: rows arrive through the SECURITY DEFINER
-- trigger below and through nothing else, so the history cannot be forged by
-- any principal, however senior. The trigger is the one door and the write it
-- records was already authorised — on player, by player's own policy.

/**
 * Writing player.team_code writes the history.
 *
 * A TRIGGER RATHER THAN A ROUTE CONVENTION, for the reason the age check is:
 * there are already three ways a player row changes — the API, a seed, the
 * CSV import — and "remember to record the move" survives exactly as long as
 * the person who knew about it. The import is the one that made this urgent:
 * it updates team_code today, so every bulk roster correction has been
 * silently discarding where boys were.
 *
 * SECURITY DEFINER because the caller has no rights on team_membership at all
 * — see above — and must not need any: the history must be written even, and
 * especially, by callers who could never touch it directly.
 *
 * Same-day churn is kept, not collapsed. A boy moved to the 1XI at nine and
 * back at noon leaves two rows with joined_on = left_on, which is the honest
 * record of a Tuesday that actually happened.
 */
CREATE OR REPLACE FUNCTION player_team_membership_log() RETURNS trigger AS $$
DECLARE
  v_on   date;
  v_open team_membership%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.team_code IS NOT DISTINCT FROM OLD.team_code
     AND NEW.school_id IS NOT DISTINCT FROM OLD.school_id THEN
    RETURN NEW;
  END IF;

  -- WHEN it took effect. Every move used to be dated the day it was typed,
  -- which for a decision made on Saturday and entered on Tuesday is wrong by
  -- three days, and for the seed meant every first membership began on the
  -- demo's birthday. A transaction-local setting carries the real date — the
  -- move route and the seed both use it — and absent, today. It cannot reach
  -- before the membership it closes: that would be two sides true at once.
  v_on := coalesce(nullif(current_setting('app.effective_on', true), '')::date, current_date);

  SELECT * INTO v_open FROM team_membership
   WHERE player_id = NEW.id AND sport = 'cricket' AND left_on IS NULL;
  IF FOUND THEN
    -- Already recorded — a re-applied seed, or an import that changed nothing.
    IF v_open.team_code IS NOT DISTINCT FROM NEW.team_code
       AND v_open.school_id IS NOT DISTINCT FROM NEW.school_id THEN
      RETURN NEW;
    END IF;
    IF v_on < v_open.joined_on THEN
      RAISE EXCEPTION
        'a move cannot take effect on %: his current side (%) only began on %',
        v_on, v_open.team_code, v_open.joined_on
        USING ERRCODE = 'check_violation';
    END IF;
    -- Close whatever was open. left_on, not deletion: the row that says he WAS
    -- in the 2XI is the entire purpose of this table.
    UPDATE team_membership SET left_on = v_on WHERE id = v_open.id;
  END IF;

  IF NEW.team_code IS NOT NULL THEN
    INSERT INTO team_membership (player_id, school_id, sport, team_code, joined_on, reason, moved_by)
    VALUES (NEW.id, NEW.school_id, 'cricket', NEW.team_code, v_on,
            CASE WHEN TG_OP = 'INSERT' THEN 'joined' ELSE 'moved' END,
            app_user_id());
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS player_moves_are_recorded ON player;
CREATE TRIGGER player_moves_are_recorded
  AFTER INSERT OR UPDATE ON player
  FOR EACH ROW EXECUTE FUNCTION player_team_membership_log();

-- ── Opposition intelligence: another school's record, ahead of a fixture ──
--
-- A school preparing for Saturday wants to know how the other side bats and
-- bowls. The other side are children at a school that is not this one, and
-- every policy in this schema exists to stop exactly that read. So this is the
-- one place the tenant boundary is crossed on purpose, and the crossing is
-- bounded three ways, in this order, in the functions below:
--
--   1. A HEAD-TO-HEAD FIXTURE the reader's team is actually in. Not "a school
--      we might play", not "a school in our league" — a scheduled row in
--      match naming both sides as tenants. The fixture is the legitimate
--      purpose, and without one there is nothing to read.
--   2. A WINDOW before it. Intelligence opens opposition_window_days() before
--      the start and closes when the match begins; after that the reader has
--      their own fixture's ball log, which is their own record. There is no
--      standing access to another school's players between fixtures.
--   3. CRICKET COLUMNS AND AGGREGATES ONLY. A name, a role, a style, and what
--      the log says they did. Never a date of birth, an address, a fitness
--      state, an injury, a note. The functions name their columns explicitly
--      so nothing arrives by default, and every read is logged in access_log
--      as a restricted read of THAT school's minors.
--
-- SECURITY DEFINER, and deliberately not a widening of player's or ball_event's
-- own policies. Widening those would put the other school's boys on every
-- roster read, every injury join and every note lookup in the platform; here
-- the disclosure has exactly two doors, each of which checks all three bounds
-- before it opens. The authorisation is INSIDE the function, evaluated with the
-- caller's own session, so a spectator, a parent and a coach at neither school
-- get nothing at all — not a refusal with a reason, nothing.
--
-- The window is a function rather than a constant so the number has a name
-- and a note. Fourteen days is a first cut: long enough to prepare, short
-- enough that a rival's record is not simply available all season.
CREATE OR REPLACE FUNCTION opposition_window_days() RETURNS integer AS $$
  SELECT 14
$$ LANGUAGE sql IMMUTABLE;

/**
 * Which side of this fixture the caller stands on, and whether the window is
 * open. Returns NOTHING when the caller has no standing — no row, no reason —
 * because a reason is a confirmation that the fixture exists.
 */
CREATE OR REPLACE FUNCTION opposition_side(p_match uuid)
RETURNS TABLE (my_school uuid, my_team text, their_school uuid, their_team text,
               opens_at timestamptz, closes_at timestamptz, open boolean, reason text) AS $$
DECLARE m match%ROWTYPE; v_home boolean; v_away boolean;
BEGIN
  SELECT * INTO m FROM match WHERE id = p_match;
  IF NOT FOUND THEN RETURN; END IF;

  v_home := app_can('opposition.read', m.school_id, m.team_code,
                    '00000000-0000-0000-0000-000000000000'::uuid, m.id);
  v_away := m.away_school_id IS NOT NULL
            AND app_can('opposition.read', m.away_school_id, m.away_team_code,
                        '00000000-0000-0000-0000-000000000000'::uuid, m.id);
  IF NOT (v_home OR v_away) THEN RETURN; END IF;

  IF v_home THEN
    my_school := m.school_id;      my_team := m.team_code;
    their_school := m.away_school_id; their_team := m.away_team_code;
  ELSE
    my_school := m.away_school_id; my_team := m.away_team_code;
    their_school := m.school_id;   their_team := m.team_code;
  END IF;

  opens_at  := m.starts_at - make_interval(days => opposition_window_days());
  closes_at := m.starts_at;

  -- The reader's own school must have the feature. Checked here as well as at
  -- the API's module gate, because this function is reachable from a psql
  -- session too and a gate in one door covers one door.
  IF NOT feature_enabled('opposition', my_school, NULL) THEN
    open := false; reason := 'feature_off'; RETURN NEXT; RETURN;
  END IF;
  IF their_school IS NULL THEN
    open := false; reason := 'opponent_not_on_scrbrd'; RETURN NEXT; RETURN;
  END IF;
  IF m.status <> 'scheduled' OR now() >= closes_at THEN
    open := false; reason := 'fixture_started'; RETURN NEXT; RETURN;
  END IF;
  IF now() < opens_at THEN
    open := false; reason := 'not_yet_open'; RETURN NEXT; RETURN;
  END IF;
  open := true; reason := 'open'; RETURN NEXT;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION opposition_side(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opposition_side(uuid) TO scrbrd_app;

/**
 * How much evidence is behind a figure, in words the reader will act on.
 *
 * First-cut thresholds, stated once so every opposition figure grades the same
 * way. Below thirty legal deliveries nothing is said at all: a strike rate off
 * eleven balls is a coin toss with decimals, and a coach who reads "SR 145"
 * off it will set a field for a batter who does not exist.
 */
CREATE OR REPLACE FUNCTION evidence_label(p_n bigint) RETURNS text AS $$
  SELECT CASE
           WHEN p_n IS NULL OR p_n = 0 THEN 'none'
           WHEN p_n < 30  THEN 'insufficient'
           WHEN p_n < 100 THEN 'low'
           WHEN p_n < 250 THEN 'moderate'
           ELSE 'high'
         END
$$ LANGUAGE sql IMMUTABLE;

/**
 * The header of a dossier: who, when the window opens and closes, and how much
 * log there is to work from. One row, or none if the caller has no standing.
 */
CREATE OR REPLACE FUNCTION opposition_context(p_match uuid)
RETURNS TABLE (match_id uuid, my_side text, their_school uuid, their_label text,
               their_team text, opens_at timestamptz, closes_at timestamptz,
               open boolean, reason text, games_analysed integer,
               deliveries_analysed integer, data_cutoff timestamptz) AS $$
  SELECT p_match,
         CASE WHEN s.my_school = m.school_id THEN 'home' ELSE 'away' END,
         s.their_school,
         fixture_side_label(s.their_school, s.their_team),
         s.their_team, s.opens_at, s.closes_at, s.open, s.reason,
         -- Only counted once the window is open. A closed window says how
         -- much there WOULD be to read, which is a disclosure by another name.
         CASE WHEN s.open THEN (
           SELECT count(DISTINCT b.match_id)::int FROM ball_event_live b
             JOIN player p ON p.id IN (b.striker_id, b.bowler_id)
            WHERE p.school_id = s.their_school AND p.team_code = s.their_team) END,
         CASE WHEN s.open THEN (
           SELECT count(*)::int FROM ball_event_live b
             JOIN player p ON p.id IN (b.striker_id, b.bowler_id)
            WHERE p.school_id = s.their_school AND p.team_code = s.their_team
              AND b.kind = 'ball') END,
         now()
    FROM opposition_side(p_match) s
    JOIN match m ON m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION opposition_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opposition_context(uuid) TO scrbrd_app;

/**
 * The other side's players and what the log says about each — and nothing
 * else about them.
 *
 * EVERY COLUMN IS NAMED. No SELECT p.*, no view: full_name, playing_role and
 * the two styles are the cricket half of a player row, and the rest — born,
 * id_number, address, guardian, height, weight, fitness — is a child's
 * personal and medical information and is not here. fitness in particular
 * looks like a cricket column and is not: 'rehab' is a clinical state.
 *
 * Aggregates are over the player's WHOLE log, every fixture, not only the
 * ones against the reader — that is the grant as decided, and the window is
 * what makes it a preparation rather than a standing file. Empty rows are
 * kept: a boy in the side with no deliveries logged is a fact the reader
 * needs ("we know nothing about their number seven"), and evidence_label says
 * 'none' rather than the row quietly not appearing.
 */
CREATE OR REPLACE FUNCTION opposition_squad(p_match uuid)
RETURNS TABLE (player_id uuid, school_id uuid, full_name text, team_code text,
               playing_role text, batting_style text, bowling_style text,
               innings integer, balls integer, runs integer, dismissals integer,
               fours integer, sixes integer, dots integer,
               strike_rate numeric, dot_pct numeric, batting_evidence text,
               balls_bowled integer, runs_conceded integer, wickets integer,
               economy numeric, bowling_evidence text) AS $$
  WITH s AS (SELECT * FROM opposition_side(p_match) WHERE open),
  squad AS (
    SELECT p.id, p.school_id, p.full_name, p.team_code, p.playing_role,
           p.batting_style, p.bowling_style
      FROM player p JOIN s ON p.school_id = s.their_school AND p.team_code = s.their_team
  ),
  bat AS (
    SELECT b.striker_id AS pid,
           count(DISTINCT b.match_id)::int AS innings,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb'))::int AS balls,
           coalesce(sum(CASE WHEN b.ball_type IN ('run','W','Nb') THEN coalesce(b.value,0) ELSE 0 END),0)::int AS runs,
           count(*) FILTER (WHERE b.ball_type = 'W'
                              AND coalesce(b.dismissal,'') !~* 'run ?out'
                              AND coalesce(b.dismissed_id, b.striker_id) = b.striker_id)::int AS dismissals,
           count(*) FILTER (WHERE b.value = 4)::int AS fours,
           count(*) FILTER (WHERE b.value = 6)::int AS sixes,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb') AND coalesce(b.value,0) = 0)::int AS dots
      FROM ball_event_live b JOIN squad q ON q.id = b.striker_id
     WHERE b.kind = 'ball'
     GROUP BY b.striker_id
  ),
  bowl AS (
    SELECT b.bowler_id AS pid,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb'))::int AS balls_bowled,
           -- What the bowler conceded: runs, wides and no-balls. Byes and leg
           -- byes are not his, which is the same split the matchups read makes.
           coalesce(sum(CASE WHEN b.ball_type IN ('run','Wd','Nb','W') THEN coalesce(b.value,0) ELSE 0 END),0)::int AS runs_conceded,
           count(*) FILTER (WHERE b.ball_type = 'W' AND coalesce(b.dismissal,'') !~* 'run ?out')::int AS wickets
      FROM ball_event_live b JOIN squad q ON q.id = b.bowler_id
     WHERE b.kind = 'ball'
     GROUP BY b.bowler_id
  )
  SELECT q.id, q.school_id, q.full_name, q.team_code, q.playing_role, q.batting_style, q.bowling_style,
         coalesce(bat.innings,0), coalesce(bat.balls,0), coalesce(bat.runs,0), coalesce(bat.dismissals,0),
         coalesce(bat.fours,0), coalesce(bat.sixes,0), coalesce(bat.dots,0),
         -- NULL below the evidence floor, not a number. The label beside it
         -- says why, and a screen renders an em dash.
         CASE WHEN coalesce(bat.balls,0) >= 30 THEN round(bat.runs * 100.0 / bat.balls, 1) END,
         CASE WHEN coalesce(bat.balls,0) >= 30 THEN round(bat.dots * 100.0 / bat.balls, 1) END,
         evidence_label(bat.balls),
         coalesce(bowl.balls_bowled,0), coalesce(bowl.runs_conceded,0), coalesce(bowl.wickets,0),
         CASE WHEN coalesce(bowl.balls_bowled,0) >= 30 THEN round(bowl.runs_conceded * 6.0 / bowl.balls_bowled, 2) END,
         evidence_label(bowl.balls_bowled)
    FROM squad q
    LEFT JOIN bat  ON bat.pid  = q.id
    LEFT JOIN bowl ON bowl.pid = q.id
   ORDER BY coalesce(bat.runs,0) DESC, q.full_name
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION opposition_squad(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opposition_squad(uuid) TO scrbrd_app;

/**
 * Who was in a side on a date. The question the column could not answer.
 *
 * Plain SQL over the history, under the caller's own policies — no definer
 * rights, because nothing here is a fact the caller may not see: it is the
 * roster read they already hold, asked about a day other than today. A read
 * resource wraps it; a ladder, a cap or an honours board can call it directly.
 */
CREATE OR REPLACE FUNCTION roster_on(p_school uuid, p_team text, p_on date, p_sport text DEFAULT 'cricket')
RETURNS TABLE (player_id uuid, team_code text, joined_on date, left_on date) AS $$
  SELECT m.player_id, m.team_code, m.joined_on, m.left_on
    FROM team_membership m
   WHERE m.school_id = p_school AND m.sport = p_sport AND m.team_code = p_team
     AND m.joined_on <= p_on AND (m.left_on IS NULL OR m.left_on > p_on)
$$ LANGUAGE sql STABLE;

-- ── Who to ring when something happens to a child ───────────────
--
-- A minibus leaves for an away fixture and nobody aboard can reach a parent.
-- That was the state of this schema: the only contact a child had was a
-- single JSON blob on the player row, behind player.pii.read — a capability
-- the coach, the team manager, the physio and the driver do not hold, and
-- rightly, because it is the capability for the child's FILE: address, ID
-- number, the office's business. The people around the child on a Saturday
-- need one thing from that file, and it is the thing that cannot wait for
-- the office to open on Monday.
--
-- So it is its own table and its own capability. Up to three contacts in
-- order, kept by the family and the office, read by the people on the day,
-- and never deleted — a number that was replaced is retired, because "which
-- number did we have in March" is a question a school is eventually asked.
CREATE TABLE emergency_contact (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- Derived from the player at write time by the trigger below, never
  -- asserted by a caller, as everywhere a row carries its child's school.
  school_id    uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  -- Who to try first. Three is enough: past three the list is a directory,
  -- and a coach with a phone in one hand and a boy in the other needs an
  -- order, not options.
  priority     smallint NOT NULL CHECK (priority BETWEEN 1 AND 3),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  relationship text NOT NULL CHECK (relationship IN
                 ('mother','father','guardian','grandparent','sibling','family','other')),
  -- Digits, spaces and a leading plus. Not a full E.164 parse: a number typed
  -- by a parent is dialled by a coach, and a check that rejects "082 000 0005"
  -- because it lacks a country code is a check that leaves a child with no
  -- contact at all.
  phone        text NOT NULL CHECK (phone ~ '^\+?[0-9][0-9 ]{6,19}$'),
  phone_alt    text CHECK (phone_alt IS NULL OR phone_alt ~ '^\+?[0-9][0-9 ]{6,19}$'),
  email        text CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- "Works nights — try after seven." Short, operational, and not a place for
  -- anything about the family's circumstances.
  note         text CHECK (note IS NULL OR length(note) <= 200),
  active       boolean NOT NULL DEFAULT true,
  retired_at   timestamptz,
  retired_by   uuid REFERENCES app_user(id),
  created_by   uuid REFERENCES app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retired_is_inactive CHECK ((retired_at IS NULL) = active)
);
-- One live contact per position. Partial, because the retired ones are the
-- history and there are meant to be several.
CREATE UNIQUE INDEX emergency_contact_priority ON emergency_contact (player_id, priority) WHERE active;
CREATE INDEX ON emergency_contact (player_id) WHERE active;

/**
 * The school comes from the child, and the provenance from the session.
 *
 * SECURITY DEFINER to read the player row: the caller is somebody allowed to
 * keep this child's contacts, which is not the same as somebody allowed to
 * read every column of the child — a guardian holds player.emergency.manage
 * for their own child and should not need the roster capability to save a
 * phone number. Reading one school_id with definer rights is the whole of
 * what this borrows.
 */
CREATE OR REPLACE FUNCTION emergency_contact_stamp() RETURNS trigger AS $$
DECLARE v_school uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.school_id INTO v_school FROM player p WHERE p.id = NEW.player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no such player: %', NEW.player_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.school_id  := v_school;
    NEW.created_by := app_user_id();
    NEW.created_at := now();
    NEW.retired_at := NULL; NEW.retired_by := NULL; NEW.active := true;
  ELSIF NEW.active = false AND OLD.active = true THEN
    NEW.retired_at := now();
    NEW.retired_by := app_user_id();
  ELSIF NEW.active = true AND OLD.active = false THEN
    -- A retired number is not brought back; a new row is added. Otherwise the
    -- history would show a number retired and then never retired.
    RAISE EXCEPTION 'a retired contact is not reactivated — add it again'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS emergency_contact_is_stamped ON emergency_contact;
CREATE TRIGGER emergency_contact_is_stamped
  BEFORE INSERT OR UPDATE ON emergency_contact
  FOR EACH ROW EXECUTE FUNCTION emergency_contact_stamp();

/**
 * The manifest: every child on a trip, and who to ring for each.
 *
 * THE DRIVER IS REACHED THROUGH THE TRIP, NOT THROUGH A CAPABILITY ON THE
 * CHILD. A driver's assignment is school-wide, so giving drivers
 * player.emergency.read would hand every driver every child's numbers all
 * year. What a driver needs is the parents of the children on his bus, on
 * the day. So transport.drive on the fixture, inside a window around the
 * departure — the day before to the day after — reaches the manifest, and
 * outside that window the same driver reads nothing. A scheduled trip a
 * fortnight away is not yet his business.
 *
 * Everyone else is checked PER CHILD with player.emergency.read, so a guardian
 * reading the manifest of a bus their child is on sees their own child and
 * nobody else's — the person anchor doing exactly what it does everywhere.
 *
 * SECURITY DEFINER because the driver holds no capability on emergency_contact
 * and would otherwise read nothing through its policy. The decision is made
 * here, in one place, with the same app_can() everything else uses.
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
  v_driver := t.cancelled_at IS NULL
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
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION trip_contacts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION trip_contacts(uuid) TO PUBLIC;

-- ═══════════════════════════════════════════════════════════════════
--  ADULT CLEARANCES — has this adult been checked, and when does it lapse
-- ═══════════════════════════════════════════════════════════════════
--
-- Every adult the platform puts near a child — coach, manager, physio,
-- driver, official — is somebody a school is answerable for having checked:
-- a police clearance certificate, the Children's Act register, a first aid
-- certificate, a professional driving permit. The checks exist. What did not
-- exist was anywhere to write down that they were done and when they run
-- out, so the answer to "is the man driving the U14s on Saturday cleared?"
-- lived in a filing cabinet, or in nobody's head.
--
-- WHAT IS RECORDED: that a named person at the school SAW a document, its
-- reference, its issue date and the date the school will re-check. Not the
-- document. A scan of a police clearance is exactly the kind of thing this
-- codebase declines to hold: the reference number is enough to re-verify,
-- and it is a restricted field, logged on every read.
--
-- A CLEARANCE BELONGS TO THE SCHOOL THAT MADE IT. Hilton's check on a coach
-- is Hilton's; WES, where he also coaches, makes its own. Whether a check
-- should travel with the person is the passport question, and it is a
-- consent decision for later, not a default to slip in here.
--
-- A CLEARANCE WITHOUT A RE-CHECK DATE IS NOT A CLEARANCE. expires_on is
-- required, because "checked once, years ago" is the state this table
-- exists to make visible, and an open-ended row would hide it.
--
-- NEVER EDITED. A verified row is a statement by a named person on a date.
-- If it was wrong it is revoked, with a reason, and a new one recorded; the
-- register then shows both. Fixing it in place would show a check that was
-- never made.

CREATE TABLE clearance_requirement (
  role text NOT NULL,
  kind text NOT NULL,
  PRIMARY KEY (role, kind)
);
ALTER TABLE clearance_requirement ENABLE ROW LEVEL SECURITY;
-- Platform reference data, like the sports. Readable by anybody signed in —
-- a coach is entitled to know what he is expected to hold — and written by
-- nobody through the API.
CREATE POLICY clearance_requirement_read ON clearance_requirement
  FOR SELECT USING (app_user_id() IS NOT NULL);

-- Which adults need which checks. The Children's Act register applies to
-- everyone who works with children at all; the police clearance to everyone
-- in a position of trust; first aid to whoever is alone with a side on a
-- field; the permit to whoever drives them.
INSERT INTO clearance_requirement (role, kind) VALUES
  ('coach',                'police_clearance'), ('coach',                'child_protection'), ('coach', 'first_aid'),
  ('assistantcoach',       'police_clearance'), ('assistantcoach',       'child_protection'), ('assistantcoach', 'first_aid'),
  ('teammanager',          'police_clearance'), ('teammanager',          'child_protection'),
  ('medical',              'police_clearance'), ('medical',              'child_protection'),
  ('driver',               'police_clearance'), ('driver',               'child_protection'), ('driver', 'driving_permit'),
  ('transportcoordinator', 'police_clearance'), ('transportcoordinator', 'child_protection'),
  ('official',             'child_protection'),
  ('scorer',               'child_protection'),
  ('facilities',           'police_clearance');

CREATE TABLE adult_clearance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  school_id      uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('police_clearance', 'child_protection', 'first_aid',
                                               'driving_permit', 'coaching_accreditation')),
  -- The certificate's own number, enough to re-verify it. Restricted: read
  -- through the API it is logged like a phone number is.
  reference      text CHECK (reference IS NULL OR length(reference) BETWEEN 3 AND 60),
  issued_on      date NOT NULL,
  expires_on     date NOT NULL,
  note           text CHECK (note IS NULL OR length(note) <= 200),
  -- Who saw the document. Stamped from the session; NULL means a seeded or
  -- migrated row, the same sentence created_by NULL says everywhere else.
  verified_by    uuid REFERENCES app_user(id),
  verified_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES app_user(id),
  revoked_reason text CHECK (revoked_reason IS NULL OR length(revoked_reason) BETWEEN 3 AND 200),
  CONSTRAINT clearance_expires_after_issue   CHECK (expires_on > issued_on),
  -- Five years is the longest anything here is issued for. A longer span is a
  -- typo in the year, and a typo in the year is a check that never lapses.
  CONSTRAINT clearance_expiry_within_reason  CHECK (expires_on <= issued_on + 1827),
  CONSTRAINT clearance_revocation_has_reason CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX ON adult_clearance (person_id, kind) WHERE revoked_at IS NULL;
CREATE INDEX ON adult_clearance (school_id) WHERE revoked_at IS NULL;
ALTER TABLE adult_clearance ENABLE ROW LEVEL SECURITY;

-- The person's own rows. The school's side — clearance.read at the school —
-- is generated from packages/policy; this is the identity half, and the two
-- OR together as every permissive policy does. A coach may see what Hilton
-- holds on him and when it lapses. He may not see his colleague's, and he
-- may not write his own: there is no identity write policy, on purpose.
CREATE POLICY adult_clearance_own_read ON adult_clearance
  FOR SELECT USING (person_id = app_user_id());

CREATE OR REPLACE FUNCTION adult_clearance_stamp() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.verified_by := app_user_id();
    NEW.verified_at := now();
    NEW.revoked_at := NULL; NEW.revoked_by := NULL; NEW.revoked_reason := NULL;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a revoked clearance is not edited — record a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.issued_on IS DISTINCT FROM OLD.issued_on OR NEW.expires_on IS DISTINCT FROM OLD.expires_on
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'a clearance is not edited after verification — revoke it and record a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.revoked_at := now();
    NEW.revoked_by := app_user_id();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER adult_clearance_stamp BEFORE INSERT OR UPDATE ON adult_clearance
  FOR EACH ROW EXECUTE FUNCTION adult_clearance_stamp();

CREATE OR REPLACE FUNCTION clearance_kind_label(p_kind text) RETURNS text AS $$
  SELECT CASE p_kind
    WHEN 'police_clearance'       THEN 'police clearance'
    WHEN 'child_protection'       THEN 'Children''s Act register clearance'
    WHEN 'first_aid'              THEN 'first aid certificate'
    WHEN 'driving_permit'         THEN 'professional driving permit'
    WHEN 'coaching_accreditation' THEN 'coaching accreditation'
    ELSE p_kind END;
$$ LANGUAGE sql IMMUTABLE;

-- ONE WORD for where a person stands on one check at one school, derived
-- here once rather than by every screen from three dates:
--   current   — a live clearance, more than sixty days left
--   expiring  — a live clearance, sixty days or fewer left
--   expired   — the latest live clearance has lapsed
--   revoked   — nothing live, and the last one was withdrawn
--   missing   — nothing recorded at all
-- "unknown" does not appear: a check the school never recorded is missing,
-- and missing is the loud state. Definer rights because the trip guard below
-- asks it about a driver whose rows the office may not hold clearance.read
-- on; not granted to callers, who reach it through the register.
CREATE OR REPLACE FUNCTION clearance_status(p_person uuid, p_school uuid, p_kind text)
RETURNS TABLE (status text, expires_on date, clearance_id uuid, reference text) AS $$
DECLARE c record;
BEGIN
  SELECT ac.id, ac.expires_on, ac.reference INTO c
    FROM adult_clearance ac
   WHERE ac.person_id = p_person AND ac.school_id = p_school AND ac.kind = p_kind
     AND ac.revoked_at IS NULL
   ORDER BY ac.expires_on DESC, ac.verified_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT
      CASE WHEN c.expires_on < current_date THEN 'expired'
           WHEN c.expires_on <= current_date + 60 THEN 'expiring'
           ELSE 'current' END,
      c.expires_on, c.id, c.reference;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM adult_clearance ac
              WHERE ac.person_id = p_person AND ac.school_id = p_school AND ac.kind = p_kind) THEN
    RETURN QUERY SELECT 'revoked'::text, NULL::date, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'missing'::text, NULL::date, NULL::uuid, NULL::text;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
REVOKE ALL ON FUNCTION clearance_status(uuid, uuid, text) FROM PUBLIC;

-- THE REGISTER: every adult with a live appointment at the school whose role
-- requires a check, against every check it requires. One row per person, role
-- and kind, with the one word above. The gaps are the point: an adult who
-- appears with nothing recorded is the row the office needs to see first, so
-- the order puts missing before expired before revoked before expiring.
--
-- Guarded whole, at the school: clearance.read there or nothing. Definer
-- rights because the rows behind it — the appointments, the users, the
-- clearances — are three tables with three policies, and the register is a
-- question about the school rather than about any of them.
CREATE OR REPLACE FUNCTION clearance_register(p_school uuid)
RETURNS TABLE (person_id uuid, name text, role text, kind text, status text,
               expires_on date, clearance_id uuid, reference text, school_id uuid) AS $$
BEGIN
  IF NOT app_can('clearance.read', p_school, '*',
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT DISTINCT ON (u.id, ra.role, cr.kind)
           u.id, u.name, ra.role, cr.kind, cs.status, cs.expires_on, cs.clearance_id, cs.reference, p_school
      FROM role_assignment ra
      JOIN app_user u ON u.id = ra.person_id
      JOIN clearance_requirement cr ON cr.role = ra.role
      CROSS JOIN LATERAL clearance_status(ra.person_id, p_school, cr.kind) cs
     WHERE ra.school_id = p_school AND ra.active AND u.active
       AND (ra.valid_from IS NULL OR ra.valid_from <= current_date)
       AND (ra.valid_until IS NULL OR ra.valid_until > current_date)
     ORDER BY u.id, ra.role, cr.kind;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
REVOKE ALL ON FUNCTION clearance_register(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clearance_register(uuid) TO PUBLIC;

-- A DRIVER WHOSE CHECK HAS LAPSED DOES NOT TAKE A SIDE. Checked when a driver
-- is put on a trip, or swapped, against everything a driver must hold: a
-- KNOWN expired or revoked check refuses, naming the person, the check and
-- the date. A check nobody recorded does not refuse — as with the vehicle's
-- cover, the absence of a record is a gap in the office's records, and the
-- register makes that gap loud rather than this trigger making it silent by
-- refusing every trip until the paperwork is typed in. Definer rights: the
-- office arranging the trip may not hold clearance.read, and a refusal it
-- cannot see the reason for is a refusal with a fabricated reason.
CREATE OR REPLACE FUNCTION trip_driver_cleared() RETURNS trigger AS $$
DECLARE req record; cs record; v_name text;
BEGIN
  IF NEW.driver_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN RETURN NEW; END IF;
  SELECT name INTO v_name FROM app_user WHERE id = NEW.driver_id;
  FOR req IN SELECT kind FROM clearance_requirement WHERE role = 'driver' ORDER BY kind LOOP
    SELECT * INTO cs FROM clearance_status(NEW.driver_id, NEW.school_id, req.kind);
    IF cs.status = 'expired' THEN
      RAISE EXCEPTION 'driver %: % expired on %. Record the renewal before he carries a side',
                      v_name, clearance_kind_label(req.kind), cs.expires_on
        USING ERRCODE = 'check_violation';
    ELSIF cs.status = 'revoked' THEN
      RAISE EXCEPTION 'driver %: % was revoked. Record a new one before he carries a side',
                      v_name, clearance_kind_label(req.kind)
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trip_driver_check BEFORE INSERT OR UPDATE ON trip
  FOR EACH ROW EXECUTE FUNCTION trip_driver_cleared();

-- ═══════════════════════════════════════════════════════════════════
--  BOWLING AND TRAINING WORKLOAD — how much a boy has bowled, and whether
--  anyone should have taken him off
-- ═══════════════════════════════════════════════════════════════════
--
-- A fourteen-year-old's back does not care that the match was close. Junior
-- cricket has had fast-bowling directives for decades — so many overs in a
-- spell, so many in a day, by age — and they are broken most often not by
-- coaches who disagree with them but by scorers who lost count. Nothing here
-- refuses a ball. THE LOG RECORDS WHAT HAPPENED; a delivery that was bowled
-- was bowled, and a scoring system that refused to write it down would only
-- make the breach invisible. What this does instead is derive the overs and
-- the spells from the log, compare them to the directive for the boy's age,
-- write the breach down as a FACT the moment it happens, and tell the people
-- responsible for him.
--
-- Everything is DERIVED from ball_event. No over count is stored, no spell
-- is stored; both are folds over the log, like the score is, and a voided
-- ball drops out of them the way it drops out of the scorecard.

-- The day it is where the cricket is played. The database runs in UTC and a
-- Saturday fixture that starts at nine in Durban is still Friday there for
-- the first two hours of a walk run late at night; a window that ends at
-- current_date would drop today's overs until midnight in Greenwich.
CREATE OR REPLACE FUNCTION sa_today() RETURNS date AS $$
  SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date $$ LANGUAGE sql STABLE;

-- ── Age on the season cut-off ────────────────────────────────────
-- Age-group cricket is played by age on a date, not age today, or a boy
-- would change age group mid-season. The South African season turns over on
-- 1 September; a boy is "under 13" for the season if he was under 13 then.
CREATE OR REPLACE FUNCTION season_cutoff(p_on date DEFAULT sa_today()) RETURNS date AS $$
  SELECT CASE WHEN extract(month FROM p_on) >= 9
              THEN make_date(extract(year FROM p_on)::int, 9, 1)
              ELSE make_date(extract(year FROM p_on)::int - 1, 9, 1) END;
$$ LANGUAGE sql IMMUTABLE;

-- The bands are the South African high-school ones: U13, U14, U15, U16, and
-- Open from sixteen on the cut-off — a boy in Grade 10 to 12 plays Open
-- cricket, whatever his birthday says, and is not "U17" or "U18" to anyone
-- at a school. Open carries no directive, as the game treats him.
CREATE OR REPLACE FUNCTION age_band(p_born date, p_on date DEFAULT sa_today()) RETURNS text AS $$
  SELECT CASE WHEN p_born IS NULL THEN 'unknown'
              WHEN a < 13 THEN 'U13' WHEN a < 14 THEN 'U14'
              WHEN a < 15 THEN 'U15' WHEN a < 16 THEN 'U16'
              ELSE 'open' END
    FROM (SELECT extract(year FROM age(season_cutoff(p_on), p_born))::int AS a) x;
$$ LANGUAGE sql IMMUTABLE;

-- ── The directive ────────────────────────────────────────────────
-- Overs per spell and per day for a pace bowler, by age band. Platform
-- reference data: a school reads it and cannot loosen it. The numbers follow
-- the ECB fast bowling directives, mapped onto the school bands (U14 and
-- U15 sit in the ECB's U15 band, U16 in its U17), which is what most South
-- African schools apply in the absence of a published CSA schedule; when
-- CSA publishes one this table is where it goes. NULL means no limit
-- applies — an Open player, or a boy whose date of birth the school has not
-- recorded, whom the workload read names as 'unknown' rather than quietly
-- treating as Open.
CREATE TABLE bowling_directive (
  age_band            text PRIMARY KEY,
  max_overs_per_spell smallint,
  max_overs_per_day   smallint
);
ALTER TABLE bowling_directive ENABLE ROW LEVEL SECURITY;
CREATE POLICY bowling_directive_read ON bowling_directive
  FOR SELECT USING (app_user_id() IS NOT NULL);
INSERT INTO bowling_directive VALUES
  ('U13', 5, 10), ('U14', 6, 12), ('U15', 6, 12), ('U16', 7, 18),
  ('open', NULL, NULL), ('unknown', NULL, NULL);

-- Which boys the directive applies to: pace. A spinner has no over limit in
-- any junior directive. A boy whose style nobody has recorded is treated as
-- pace, because the cost of being wrong that way is a spinner taken off an
-- over early, and the cost of being wrong the other way is a stress fracture.
CREATE OR REPLACE FUNCTION bowling_directive_for(p_player uuid)
RETURNS TABLE (age_band text, pace boolean, max_overs_per_spell smallint, max_overs_per_day smallint) AS $$
  SELECT age_band(p.born) AS age_band,
         (p.bowling_style IS NULL OR p.bowling_style !~* 'spin|slow') AS pace,
         CASE WHEN (p.bowling_style IS NULL OR p.bowling_style !~* 'spin|slow') THEN d.max_overs_per_spell END,
         CASE WHEN (p.bowling_style IS NULL OR p.bowling_style !~* 'spin|slow') THEN d.max_overs_per_day END
    FROM player p
    LEFT JOIN bowling_directive d ON d.age_band = age_band(p.born)
   WHERE p.id = p_player;
$$ LANGUAGE sql STABLE;

-- ── Overs, from the log ──────────────────────────────────────────
-- An over is six LEGAL balls; a wide or a no-ball does not advance it. The
-- over a ball belongs to is the number of legal balls before it in the
-- innings, divided by six — counted over every ball, including the ones
-- with no bowler attributed, or an unattributed delivery would shift every
-- over after it. Dated by the FIXTURE, not by when the row arrived: a
-- scorer's phone may sync the second innings on Sunday night, and a day
-- limit is about the day the boy bowled.
CREATE OR REPLACE VIEW bowler_over WITH (security_invoker = true) AS
WITH balls AS (
  SELECT b.match_id, b.innings, b.bowler_id, b.school_id, b.seq, b.ball_type,
         coalesce(count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb'))
                    OVER (PARTITION BY b.match_id, b.innings ORDER BY b.seq
                          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) / 6 AS over_no
    FROM ball_event_live b
   WHERE b.kind = 'ball')
SELECT x.match_id, x.innings, x.bowler_id, x.school_id, x.over_no::int AS over_no,
       (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS bowled_on,
       count(*) FILTER (WHERE x.ball_type NOT IN ('Wd','Nb'))::int AS legal_balls,
       count(*)::int AS deliveries
  FROM balls x
  JOIN match m ON m.id = x.match_id
 WHERE x.bowler_id IS NOT NULL
 GROUP BY x.match_id, x.innings, x.bowler_id, x.school_id, x.over_no, m.starts_at;

-- A SPELL is unbroken bowling from one end. Ends alternate, so a bowler in a
-- spell bowls every second over: over numbers two apart are the same spell.
-- A gap of three or more means he missed his turn at that end — he was
-- rested — and what he bowls next is a new spell. The directive counts
-- spells, and counts them this way.
CREATE OR REPLACE VIEW bowler_spell WITH (security_invoker = true) AS
WITH o AS (
  SELECT *, lag(over_no) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY over_no) AS prev_over
    FROM bowler_over),
marked AS (
  SELECT *, CASE WHEN prev_over IS NULL OR over_no - prev_over > 2 THEN 1 ELSE 0 END AS starts FROM o),
numbered AS (
  SELECT *, sum(starts) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY over_no) AS spell_no FROM marked)
SELECT match_id, innings, bowler_id, school_id, bowled_on, spell_no::int AS spell_no,
       min(over_no)::int AS first_over, max(over_no)::int AS last_over,
       count(*)::int AS overs, sum(legal_balls)::int AS legal_balls
  FROM numbered
 GROUP BY match_id, innings, bowler_id, school_id, bowled_on, spell_no;

-- ── The breach, as a fact ────────────────────────────────────────
-- Written the moment the log shows it and never removed: a boy who bowled a
-- seventh over of a spell bowled it, and the row says so, with the limit he
-- was under and the band that set it. One row per spell or per day, however
-- many balls were bowled past the line.
CREATE TABLE bowling_breach (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  innings    smallint NOT NULL,
  bowler_id  uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  school_id  uuid NOT NULL REFERENCES school(id),
  kind       text NOT NULL CHECK (kind IN ('spell', 'day')),
  -- Which spell (its first over) or which day (0): the identity of the breach.
  key        integer NOT NULL,
  overs      smallint NOT NULL,
  allowed    smallint NOT NULL,
  age_band   text NOT NULL,
  bowled_on  date NOT NULL,
  noticed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, innings, bowler_id, kind, key)
);
CREATE UNIQUE INDEX bowling_breach_one_per_day ON bowling_breach (bowler_id, bowled_on) WHERE kind = 'day';
ALTER TABLE bowling_breach ENABLE ROW LEVEL SECURITY;
-- Read under player.workload.read — coaching staff, the physio, the boy
-- himself through self-access; written only by the trigger below, so no
-- insert policy.
CREATE POLICY bowling_breach_read ON bowling_breach
  FOR SELECT USING (app_can('player.workload.read', bowling_breach.school_id,
    (SELECT p.team_code FROM player p WHERE p.id = bowling_breach.bowler_id),
    bowling_breach.bowler_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE OR REPLACE FUNCTION bowling_breach_watch() RETURNS trigger AS $$
DECLARE
  d record; s record; p player%ROWTYPE;
  v_day date; v_day_overs int;
BEGIN
  SELECT * INTO p FROM player WHERE id = NEW.bowler_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO d FROM bowling_directive_for(NEW.bowler_id);
  IF d.max_overs_per_spell IS NULL AND d.max_overs_per_day IS NULL THEN RETURN NEW; END IF;

  -- The spell this ball is part of.
  SELECT * INTO s FROM bowler_spell
   WHERE match_id = NEW.match_id AND innings = NEW.innings AND bowler_id = NEW.bowler_id
   ORDER BY spell_no DESC LIMIT 1;
  IF FOUND AND d.max_overs_per_spell IS NOT NULL AND s.overs > d.max_overs_per_spell THEN
    INSERT INTO bowling_breach (match_id, innings, bowler_id, school_id, kind, key, overs, allowed, age_band, bowled_on)
    VALUES (NEW.match_id, NEW.innings, NEW.bowler_id, p.school_id, 'spell', s.first_over, s.overs, d.max_overs_per_spell, d.age_band, s.bowled_on)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, subject_person_id)
      VALUES (p.school_id, p.team_code, 'team', 'welfare', 'high',
              'Bowling directive exceeded',
              p.full_name || ' (' || d.age_band || ') is ' || s.overs || ' overs into a spell; the directive allows '
                || d.max_overs_per_spell || '. Take him off.',
              'player.workload.read', false, 'match', NEW.match_id, NEW.bowler_id);
    END IF;
  END IF;

  -- The day: every over he has bowled on the fixture's date, in any match.
  SELECT o.bowled_on, count(*) INTO v_day, v_day_overs
    FROM bowler_over o
   WHERE o.bowler_id = NEW.bowler_id
     AND o.bowled_on = (SELECT (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date FROM match m WHERE m.id = NEW.match_id)
   GROUP BY o.bowled_on;
  IF FOUND AND d.max_overs_per_day IS NOT NULL AND v_day_overs > d.max_overs_per_day THEN
    INSERT INTO bowling_breach (match_id, innings, bowler_id, school_id, kind, key, overs, allowed, age_band, bowled_on)
    VALUES (NEW.match_id, NEW.innings, NEW.bowler_id, p.school_id, 'day', 0, v_day_overs, d.max_overs_per_day, d.age_band, v_day)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, subject_person_id)
      VALUES (p.school_id, p.team_code, 'team', 'welfare', 'high',
              'Bowling directive exceeded',
              p.full_name || ' (' || d.age_band || ') has bowled ' || v_day_overs || ' overs today; the directive allows '
                || d.max_overs_per_day || ' in a day. He does not bowl again today.',
              'player.workload.read', false, 'match', NEW.match_id, NEW.bowler_id);
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

-- AFTER, and only for a delivery with a bowler on it. Definer rights: the
-- scorer writing the ball holds scoring capabilities, not the boy's
-- development record, and the breach has to be written and the coach told
-- whoever is holding the phone.
CREATE TRIGGER ball_event_bowling_breach AFTER INSERT ON ball_event
  FOR EACH ROW WHEN (NEW.kind = 'ball' AND NEW.bowler_id IS NOT NULL)
  EXECUTE FUNCTION bowling_breach_watch();

-- ── Workload ─────────────────────────────────────────────────────
-- One row per boy the reader may read the development record of: what he
-- bowled in the last week and the last four, his longest spell, the breaches
-- on his name, and what training he was at. The acute:chronic ratio is the
-- standard one — this week against the average of the last four — and the
-- word beside it is the server's, not a screen's:
--   no bowling — nothing in four weeks
--   rested     — bowled this month, not this week
--   light      — under 0.8
--   steady     — 0.8 to 1.2
--   rising     — 1.2 to 1.5
--   spike      — over 1.5, the range the injury literature keeps finding
-- Under player.workload.read per row, because this is a reading of a named
-- child's body, not a scorecard — the overs are public, the meaning is not.
-- Not player.development.read: the pupil ROLE holds that across a side, and
-- a boy does not get a team-mate's load for playing in the same XI. Definer rights so the per-row check is the only gate and three
-- tables' policies do not each subtract from the answer differently.
CREATE OR REPLACE FUNCTION workload(p_team text DEFAULT NULL)
RETURNS TABLE (player_id uuid, full_name text, team_code text, school_id uuid,
               age_band text, pace boolean, max_overs_per_spell smallint, max_overs_per_day smallint,
               overs_7d int, overs_28d int, longest_spell_7d int, breaches_28d int, last_bowled_on date,
               sessions_7d int, minutes_7d int, sessions_28d int, minutes_28d int,
               acwr numeric, load_state text) AS $$
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
     GROUP BY a.player_id)
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
              ELSE 'steady' END AS load_state
    FROM boys b
    CROSS JOIN LATERAL bowling_directive_for(b.id) d
    LEFT JOIN bowl w ON w.bowler_id = b.id
    LEFT JOIN spells sp ON sp.bowler_id = b.id
    LEFT JOIN breaches br ON br.bowler_id = b.id
    LEFT JOIN train tr ON tr.player_id = b.id
   ORDER BY CASE WHEN coalesce(br.breaches_28d, 0) > 0 THEN 0 ELSE 1 END,
            CASE WHEN coalesce(w.overs_28d, 0) > 0 AND w.overs_7d / (w.overs_28d / 4.0) > 1.5 THEN 0 ELSE 1 END,
            coalesce(w.overs_7d, 0) DESC, b.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
REVOKE ALL ON FUNCTION workload(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workload(text) TO PUBLIC;

-- ═══════════════════════════════════════════════════════════════════
--  RECOGNITION — honours, caps and milestones. No points.
-- ═══════════════════════════════════════════════════════════════════
--
-- Three kinds of recognition, and they are different things:
--
--   AN HONOUR IS AWARDED. Colours, captaincy, player of the season: a named
--   person decided it, on a date, for a season. It is a school's statement
--   and is never edited — withdrawn with a reason if it must be, and stays.
--   A CAP IS EARNED. A boy who takes the field for a side has played for
--   it, and his cap number is the order in which he first did. Derived from
--   the team sheets and never typed in, except for the ledger's starting
--   point: the caps a side awarded before the platform was keeping count.
--   A MILESTONE HAPPENS. A fifty, a five-for, a hat-trick, five hundred
--   career runs: derived from the ball log, like the score is, and noticed
--   the moment the ball that makes it is recorded.
--
-- NONE OF THEM IS A CURRENCY. Nothing here is a number a boy accumulates
-- to be ranked by, and nothing here feeds the rewards engine. A cap is
-- 412, not 412 points.

-- ── Honours ──────────────────────────────────────────────────────
CREATE TABLE honour (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  school_id    uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  -- The side he was on when it was awarded, kept as it was: an honour does
  -- not move sides when he does.
  team_code    text,
  kind         text NOT NULL CHECK (kind IN ('colours', 'half_colours', 'honours', 'captain', 'vice_captain',
                                             'player_of_season', 'award')),
  -- Required for an 'award' (which is whatever the school calls it — "Fielder
  -- of the Year"); optional otherwise.
  name         text CHECK (name IS NULL OR length(name) BETWEEN 3 AND 80),
  season       text NOT NULL CHECK (season ~ '^\d{4}(/\d{2})?$'),
  citation     text CHECK (citation IS NULL OR length(citation) <= 300),
  awarded_on   date NOT NULL DEFAULT sa_today(),
  awarded_by   uuid REFERENCES app_user(id),
  awarded_at   timestamptz NOT NULL DEFAULT now(),
  -- Whether it may go on a public board with his name. False until somebody
  -- says otherwise; only true feeds anything outward-facing.
  is_public    boolean NOT NULL DEFAULT false,
  withdrawn_at timestamptz,
  withdrawn_by uuid REFERENCES app_user(id),
  withdrawn_reason text CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) BETWEEN 3 AND 200),
  CONSTRAINT honour_award_is_named CHECK (kind <> 'award' OR name IS NOT NULL),
  CONSTRAINT honour_withdrawal_has_reason CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL))
);
-- One of each kind per boy per season, live. Awards are free-named and may
-- be several.
CREATE UNIQUE INDEX honour_once_a_season ON honour (player_id, kind, season)
  WHERE withdrawn_at IS NULL AND kind <> 'award';
CREATE INDEX ON honour (school_id, season) WHERE withdrawn_at IS NULL;

CREATE OR REPLACE FUNCTION honour_stamp() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.school_id, p.team_code INTO NEW.school_id, NEW.team_code FROM player p WHERE p.id = NEW.player_id;
    IF NEW.school_id IS NULL THEN
      RAISE EXCEPTION 'no such player: %', NEW.player_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.awarded_by := app_user_id();
    NEW.awarded_at := now();
    NEW.withdrawn_at := NULL; NEW.withdrawn_by := NULL; NEW.withdrawn_reason := NULL;
    RETURN NEW;
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'a withdrawn honour is not edited — award it again' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.player_id IS DISTINCT FROM OLD.player_id OR NEW.school_id IS DISTINCT FROM OLD.school_id
     OR NEW.team_code IS DISTINCT FROM OLD.team_code OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.season IS DISTINCT FROM OLD.season
     OR NEW.citation IS DISTINCT FROM OLD.citation OR NEW.awarded_on IS DISTINCT FROM OLD.awarded_on
     OR NEW.awarded_by IS DISTINCT FROM OLD.awarded_by OR NEW.awarded_at IS DISTINCT FROM OLD.awarded_at THEN
    RAISE EXCEPTION 'an honour is not edited after it is awarded — withdraw it and award it again'
      USING ERRCODE = 'check_violation';
  END IF;
  -- is_public may change: putting a name on a board, or taking it off, is a
  -- decision about the board, not about the honour.
  IF NEW.withdrawn_at IS NOT NULL THEN
    NEW.withdrawn_at := now();
    NEW.withdrawn_by := app_user_id();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER honour_stamp BEFORE INSERT OR UPDATE ON honour
  FOR EACH ROW EXECUTE FUNCTION honour_stamp();

CREATE OR REPLACE FUNCTION honour_kind_label(p_kind text, p_name text) RETURNS text AS $$
  SELECT CASE p_kind
    WHEN 'colours'          THEN 'Full colours'
    WHEN 'half_colours'     THEN 'Half colours'
    WHEN 'honours'          THEN 'Honours'
    WHEN 'captain'          THEN 'Captain'
    WHEN 'vice_captain'     THEN 'Vice-captain'
    WHEN 'player_of_season' THEN 'Player of the season'
    WHEN 'award'            THEN coalesce(p_name, 'Award')
    ELSE p_kind END || CASE WHEN p_kind <> 'award' AND p_name IS NOT NULL THEN ' — ' || p_name ELSE '' END;
$$ LANGUAGE sql IMMUTABLE;

-- ── Caps ─────────────────────────────────────────────────────────
CREATE TABLE cap_baseline (
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  team_code   text NOT NULL,
  -- Caps the side had awarded before the first fixture the platform holds.
  caps_before integer NOT NULL CHECK (caps_before >= 0),
  as_of       date NOT NULL,
  note        text CHECK (note IS NULL OR length(note) <= 200),
  set_by      uuid REFERENCES app_user(id),
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, team_code)
);
CREATE OR REPLACE FUNCTION cap_baseline_stamp() RETURNS trigger AS $$
BEGIN NEW.set_by := app_user_id(); NEW.set_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER cap_baseline_stamp BEFORE INSERT OR UPDATE ON cap_baseline
  FOR EACH ROW EXECUTE FUNCTION cap_baseline_stamp();

-- An APPEARANCE is a place in the eleven for a match that was played: not
-- the twelfth man, not a withdrawn name, not a fixture still to come. The
-- side is the one the sheet was for — home or away — and the school is the
-- boy's own, so a guest fixture at another school's ground is still his cap.
CREATE OR REPLACE VIEW team_appearance WITH (security_invoker = true) AS
SELECT p.school_id,
       CASE s.side WHEN 'home' THEN m.team_code ELSE m.away_team_code END AS team_code,
       s.player_id, s.match_id, s.batting_no,
       (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS played_on
  FROM match_squad s
  JOIN match m ON m.id = s.match_id
  JOIN player p ON p.id = s.player_id
 WHERE NOT s.withdrawn AND NOT s.twelfth
   AND m.status IN ('live', 'complete')
   AND (CASE s.side WHEN 'home' THEN m.school_id ELSE m.away_school_id END) = p.school_id;

-- One row per boy per side: how many times, when first, and his cap number,
-- which is the baseline plus his place in the order of first appearances.
-- Ties on a day — a whole new side debuting together — go by batting order
-- on that sheet, then by name, so the numbers are stable and defensible.
CREATE OR REPLACE VIEW team_cap WITH (security_invoker = true) AS
WITH firsts AS (
  SELECT DISTINCT ON (school_id, team_code, player_id)
         school_id, team_code, player_id, played_on AS first_on, batting_no AS first_batting_no, match_id AS first_match_id
    FROM team_appearance
   ORDER BY school_id, team_code, player_id, played_on, match_id),
counts AS (
  SELECT school_id, team_code, player_id, count(*)::int AS appearances, max(played_on) AS last_on
    FROM team_appearance GROUP BY school_id, team_code, player_id)
SELECT f.school_id, f.team_code, f.player_id, p.full_name, c.appearances, f.first_on, c.last_on, f.first_match_id,
       coalesce(b.caps_before, 0)
         + rank() OVER (PARTITION BY f.school_id, f.team_code
                        ORDER BY f.first_on, f.first_batting_no NULLS LAST, p.full_name)::int AS cap_no,
       b.caps_before IS NOT NULL AS baseline_set
  FROM firsts f
  JOIN player p ON p.id = f.player_id
  JOIN counts c ON c.school_id = f.school_id AND c.team_code = f.team_code AND c.player_id = f.player_id
  LEFT JOIN cap_baseline b ON b.school_id = f.school_id AND b.team_code = f.team_code;

-- ── Milestones ───────────────────────────────────────────────────
-- Derived. A row here is a fold over the log and nothing else, so a voided
-- ball takes a fifty with it, the way it takes the runs.
CREATE OR REPLACE VIEW bowler_innings_figures WITH (security_invoker = true) AS
SELECT b.bowler_id AS player_id, b.match_id, b.innings,
       count(*) FILTER (WHERE b.ball_type = 'W' AND coalesce(b.dismissal,'') !~* 'run ?out')::int AS wickets,
       coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                         WHEN b.ball_type IN ('run','W')  THEN coalesce(b.value,0) ELSE 0 END), 0)::int AS runs_conceded
  FROM ball_event_live b
 WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL
 GROUP BY b.bowler_id, b.match_id, b.innings;

-- A hat-trick is three wickets in three consecutive LEGAL deliveries by one
-- bowler in one innings; a wide or a no-ball in between is not a delivery
-- and does not break it. Run-outs are not the bowler's.
CREATE OR REPLACE VIEW bowler_hat_trick WITH (security_invoker = true) AS
WITH legal AS (
  SELECT b.bowler_id, b.match_id, b.innings, b.seq,
         (b.ball_type = 'W' AND coalesce(b.dismissal,'') !~* 'run ?out') AS w
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.bowler_id IS NOT NULL AND b.ball_type NOT IN ('Wd','Nb')),
runs AS (
  SELECT *, lag(w, 1) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w1,
            lag(w, 2) OVER (PARTITION BY match_id, innings, bowler_id ORDER BY seq) AS w2
    FROM legal)
SELECT bowler_id AS player_id, match_id, innings, min(seq)::int AS completed_at_seq
  FROM runs WHERE w AND w1 AND w2
 GROUP BY bowler_id, match_id, innings;

CREATE OR REPLACE VIEW player_milestone WITH (security_invoker = true) AS
WITH dated AS (
  SELECT m.id AS match_id, m.opponent, (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date AS played_on, m.starts_at
    FROM match m),
innings_bat AS (
  SELECT i.player_id, i.match_id, i.innings,
         CASE WHEN i.runs >= 100 THEN 'hundred' ELSE 'fifty' END AS kind, i.runs::int AS value
    FROM player_innings i WHERE i.runs >= 50),
innings_bowl AS (
  SELECT f.player_id, f.match_id, f.innings, 'five_for' AS kind, f.wickets AS value
    FROM bowler_innings_figures f WHERE f.wickets >= 5),
hat AS (
  SELECT h.player_id, h.match_id, h.innings, 'hat_trick' AS kind, 3 AS value FROM bowler_hat_trick h),
career_runs AS (
  SELECT x.player_id, x.match_id, NULL::smallint AS innings, 'career_runs' AS kind, t.threshold AS value
    FROM (SELECT i.player_id, i.match_id,
                 sum(i.runs) OVER (PARTITION BY i.player_id ORDER BY d.starts_at, i.match_id) AS after_runs,
                 sum(i.runs) OVER (PARTITION BY i.player_id ORDER BY d.starts_at, i.match_id
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS before_runs
            FROM (SELECT player_id, match_id, sum(runs) AS runs FROM player_innings GROUP BY player_id, match_id) i
            JOIN dated d ON d.match_id = i.match_id) x
    CROSS JOIN (VALUES (500), (1000), (2000), (5000)) t(threshold)
   WHERE coalesce(x.before_runs, 0) < t.threshold AND x.after_runs >= t.threshold),
career_wkts AS (
  SELECT x.player_id, x.match_id, NULL::smallint AS innings, 'career_wickets' AS kind, t.threshold AS value
    FROM (SELECT f.player_id, f.match_id,
                 sum(f.wickets) OVER (PARTITION BY f.player_id ORDER BY d.starts_at, f.match_id) AS after_w,
                 sum(f.wickets) OVER (PARTITION BY f.player_id ORDER BY d.starts_at, f.match_id
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS before_w
            FROM (SELECT player_id, match_id, sum(wickets) AS wickets FROM bowler_innings_figures GROUP BY player_id, match_id) f
            JOIN dated d ON d.match_id = f.match_id) x
    CROSS JOIN (VALUES (25), (50), (100), (250)) t(threshold)
   WHERE coalesce(x.before_w, 0) < t.threshold AND x.after_w >= t.threshold),
caps AS (
  SELECT x.player_id, x.match_id, NULL::smallint AS innings, 'caps' AS kind, t.threshold AS value
    FROM (SELECT a.player_id, a.match_id,
                 row_number() OVER (PARTITION BY a.player_id, a.school_id, a.team_code ORDER BY a.played_on, a.match_id) AS nth
            FROM team_appearance a) x
    CROSS JOIN (VALUES (25), (50), (100)) t(threshold)
   WHERE x.nth = t.threshold),
everything AS (
  SELECT * FROM innings_bat UNION ALL SELECT * FROM innings_bowl UNION ALL SELECT * FROM hat
  UNION ALL SELECT * FROM career_runs UNION ALL SELECT * FROM career_wkts UNION ALL SELECT * FROM caps)
SELECT e.player_id, e.kind, e.value, e.match_id, e.innings, d.opponent, d.played_on
  FROM everything e JOIN dated d ON d.match_id = e.match_id;

CREATE OR REPLACE FUNCTION milestone_label(p_kind text, p_value int) RETURNS text AS $$
  SELECT CASE p_kind
    WHEN 'fifty'          THEN 'Fifty (' || p_value || ')'
    WHEN 'hundred'        THEN 'Hundred (' || p_value || ')'
    WHEN 'five_for'       THEN 'Five-for (' || p_value || ' wickets)'
    WHEN 'hat_trick'      THEN 'Hat-trick'
    WHEN 'career_runs'    THEN p_value || ' career runs'
    WHEN 'career_wickets' THEN p_value || ' career wickets'
    WHEN 'caps'           THEN p_value || ' caps'
    ELSE p_kind END;
$$ LANGUAGE sql IMMUTABLE;

-- ── The moment it happens ────────────────────────────────────────
-- A notice the ball it lands on, once per boy per innings per kind. The
-- table is the "once"; the milestone itself lives in the log and is never
-- written down twice. Notices carry news.read at the boy's side and are not
-- public: a fifty is a scorecard fact, a boy's name pushed outward is a
-- decision the broadcast module makes.
CREATE TABLE milestone_notice (
  player_id uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  kind      text NOT NULL,
  match_id  uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  innings   smallint NOT NULL DEFAULT 0,
  value     int NOT NULL,
  noticed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, kind, match_id, innings)
);
ALTER TABLE milestone_notice ENABLE ROW LEVEL SECURITY;
-- Written only by the trigger below (no insert policy). Readable by whoever
-- may read the boy's profile, because "when was his fifty called" is part
-- of his record, and a table nobody can read is a decision, not a default.
CREATE POLICY milestone_notice_read ON milestone_notice
  FOR SELECT USING (app_can('player.profile.read',
    (SELECT p.school_id FROM player p WHERE p.id = milestone_notice.player_id),
    (SELECT p.team_code FROM player p WHERE p.id = milestone_notice.player_id),
    milestone_notice.player_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE OR REPLACE FUNCTION milestone_notify(p_player uuid, p_kind text, p_match uuid, p_innings smallint, p_value int) RETURNS void AS $$
DECLARE p player%ROWTYPE; v_title text;
BEGIN
  INSERT INTO milestone_notice (player_id, kind, match_id, innings, value)
  VALUES (p_player, p_kind, p_match, p_innings, p_value) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO p FROM player WHERE id = p_player;
  v_title := CASE p_kind
    WHEN 'fifty'          THEN 'Fifty for ' || p.full_name
    WHEN 'hundred'        THEN 'Hundred for ' || p.full_name
    WHEN 'five_for'       THEN 'Five-for for ' || p.full_name
    WHEN 'hat_trick'      THEN 'Hat-trick for ' || p.full_name
    WHEN 'career_runs'    THEN p.full_name || ' passes ' || p_value || ' career runs'
    WHEN 'career_wickets' THEN p.full_name || ' passes ' || p_value || ' career wickets'
    ELSE milestone_label(p_kind, p_value) END;
  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind, subject_id, subject_person_id)
  VALUES (p.school_id, p.team_code, 'team', 'recognition', 'low', v_title,
          milestone_label(p_kind, p_value) || ' against ' || coalesce((SELECT opponent FROM match WHERE id = p_match), 'the opposition') || '.',
          'news.read', false, 'match', p_match, p_player);
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION milestone_watch() RETURNS trigger AS $$
DECLARE v_runs int; v_before int; v_w int; v_career int; t int;
BEGIN
  -- The striker's innings, and his career, after this ball.
  IF NEW.striker_id IS NOT NULL AND NEW.ball_type IN ('run', 'W', 'Nb') AND coalesce(NEW.value, 0) > 0 THEN
    SELECT coalesce(runs, 0) INTO v_runs FROM player_innings
     WHERE player_id = NEW.striker_id AND match_id = NEW.match_id AND innings = NEW.innings;
    v_before := v_runs - NEW.value;
    IF v_before < 50 AND v_runs >= 50 THEN PERFORM milestone_notify(NEW.striker_id, 'fifty', NEW.match_id, NEW.innings, v_runs); END IF;
    IF v_before < 100 AND v_runs >= 100 THEN PERFORM milestone_notify(NEW.striker_id, 'hundred', NEW.match_id, NEW.innings, v_runs); END IF;
    SELECT coalesce(sum(runs), 0) INTO v_career FROM player_innings WHERE player_id = NEW.striker_id;
    FOREACH t IN ARRAY ARRAY[500, 1000, 2000, 5000] LOOP
      IF v_career - NEW.value < t AND v_career >= t THEN PERFORM milestone_notify(NEW.striker_id, 'career_runs', NEW.match_id, 0::smallint, t); END IF;
    END LOOP;
  END IF;
  -- The bowler's wicket.
  IF NEW.bowler_id IS NOT NULL AND NEW.ball_type = 'W' AND coalesce(NEW.dismissal,'') !~* 'run ?out' THEN
    SELECT wickets INTO v_w FROM bowler_innings_figures
     WHERE player_id = NEW.bowler_id AND match_id = NEW.match_id AND innings = NEW.innings;
    IF v_w = 5 THEN PERFORM milestone_notify(NEW.bowler_id, 'five_for', NEW.match_id, NEW.innings, 5); END IF;
    IF EXISTS (SELECT 1 FROM bowler_hat_trick h WHERE h.player_id = NEW.bowler_id AND h.match_id = NEW.match_id
                  AND h.innings = NEW.innings AND h.completed_at_seq = NEW.seq) THEN
      PERFORM milestone_notify(NEW.bowler_id, 'hat_trick', NEW.match_id, NEW.innings, 3);
    END IF;
    SELECT coalesce(sum(wickets), 0) INTO v_career FROM bowler_innings_figures WHERE player_id = NEW.bowler_id;
    FOREACH t IN ARRAY ARRAY[25, 50, 100, 250] LOOP
      IF v_career = t THEN PERFORM milestone_notify(NEW.bowler_id, 'career_wickets', NEW.match_id, 0::smallint, t); END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER ball_event_milestone AFTER INSERT ON ball_event
  FOR EACH ROW WHEN (NEW.kind = 'ball')
  EXECUTE FUNCTION milestone_watch();

-- ── The profile's view of all three ──────────────────────────────
-- One shape for a boy's honours, caps and milestones, per row under
-- player.profile.read: what the roster already shows about him, said in
-- full. Definer rights so that one check is the gate and the three sources
-- behind it do not each subtract differently.
CREATE OR REPLACE FUNCTION recognition(p_player uuid)
RETURNS TABLE (family text, kind text, label text, value int, season text, on_date date,
               match_id uuid, opponent text, is_public boolean, citation text, ref_id uuid) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM player p WHERE p.id = p_player
                    AND app_can('player.profile.read', p.school_id, p.team_code, p.id,
                                '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT 'honour'::text, h.kind, honour_kind_label(h.kind, h.name), NULL::int, h.season, h.awarded_on,
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
    ORDER BY 6 DESC NULLS LAST, 1;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
REVOKE ALL ON FUNCTION recognition(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recognition(uuid) TO PUBLIC;
