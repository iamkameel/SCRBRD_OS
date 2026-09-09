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
    OR EXISTS (SELECT 1 FROM role_assignment a JOIN role_capability rc ON rc.role = a.role
                WHERE a.person_id = app_user_id() AND rc.capability = 'scouting.accredit'
                  AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
                  AND (a.valid_until IS NULL OR a.valid_until > current_date))
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
  IF NOT EXISTS (
    SELECT 1 FROM role_assignment a JOIN role_capability rc ON rc.role = a.role
     WHERE a.person_id = app_user_id() AND rc.capability = 'scouting.write'
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until > current_date)
  ) THEN
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
  IF NOT EXISTS (
    SELECT 1 FROM role_assignment a JOIN role_capability rc ON rc.role = a.role
     WHERE a.person_id = app_user_id() AND rc.capability = 'scouting.accredit'
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until > current_date)
  ) THEN
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
