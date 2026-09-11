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
  kind       text NOT NULL DEFAULT 'feature' CHECK (kind IN ('module','feature')),
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
  SELECT school_id, capacity, active, registration INTO v FROM vehicle WHERE id = NEW.vehicle_id;
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
