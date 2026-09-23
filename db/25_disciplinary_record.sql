-- ══════════════════════════════════════════════════════════════════
--  25 · The disciplinary record (SCRBRD-053)
-- ══════════════════════════════════════════════════════════════════
--
-- `discipline.read` and `discipline.write` have been in the catalogue and in
-- six role bundles since db/01, and until this file they gated NOTHING: no
-- table, no policy, no masked column, no read resource. A school
-- administrator who "can read discipline" could read nothing at all, and on
-- the day a record arrived nobody's read of it would have been logged,
-- because the logger watches columns and there were none to watch.
-- sensitivity.test.mjs found that and carried it as a named exception; this
-- is the record the exception was waiting for.
--
-- Building it rather than dropping the pair is the right way round: the six
-- bundles are correct about who should be able to do this, and it was the
-- schema that had nothing to offer them.
--
-- WHAT THE GRANTS ALREADY IMPLY, WHICH IS WHAT THIS SHAPE IS BUILT TO MEET
-- ────────────────────────────────────────────────────────────────────────
-- Read is held by `principal`, `directorofsport` and `schooladmin` — the
-- ordinary school-scoped case — by `selfaccess`, which is a pupil reading HIS
-- OWN record (the same right-of-access reasoning that puts
-- medical.details.read on that bundle), and by `competitionadmin`, whose
-- assignment names no school and therefore reaches every school on the
-- platform. Write is held by `directorofsport`, the school side of it, and by
-- `official`, who is appointed per MATCH rather than per team. Nothing here
-- widens or narrows any of that. The table is shaped so that each of those
-- five anchors resolves, and so that nobody else's does.
--
-- WHAT IS DELIBERATELY NOT HERE
-- ─────────────────────────────
-- No severity scale and no category enum. A severity nobody reads is a number
-- a school would argue about and the platform would never act on; grading an
-- offence against a written rule is SCRBRD-041's, where the clauses live. And
-- the on-field / off-field distinction a category would carry is already
-- stated by whether `match_id` is there — one fact, said once.

CREATE TABLE disciplinary_record (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  -- Denormalised from the player, for development_note's reason (db/08) and
  -- one more besides. A school anchor that has to join to find its tenant
  -- returns NULL for a reader who cannot see the player — and
  -- `competitionadmin` cannot: that bundle holds discipline.read and no
  -- player capability at all. A NULL school on the resource happens to
  -- satisfy a NULL-school assignment, so a derived anchor would be right by
  -- accident for them and wrong for every school-scoped reader beside them.
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  -- The fixture, WHEN THERE WAS ONE, and this column is what makes the
  -- official's grant usable at all. An official's assignment carries
  -- fixture_id, and app_can() refuses a fixture-scoped assignment on a row
  -- that does not state that fixture — so an umpire files about the match
  -- they stood at and about nothing else, which is the whole of the authority
  -- the appointment gave them.
  --
  -- Nullable because the other holder of the same capability is not writing
  -- about a match: conduct on tour, or in the nets, has no fixture to point
  -- at, and a NULL fixture anchor is refused only for a writer whose own
  -- assignment named one.
  --
  -- SET NULL rather than CASCADE. A child's record must not be deleted by
  -- somebody tidying up a fixture; it stands on the school and the player,
  -- and the match is context.
  match_id    uuid REFERENCES match(id) ON DELETE SET NULL,
  -- WHOEVER IS WRITING, fixed by the trigger below. A column recording
  -- authorship that the writer can set is a column that cannot be relied on
  -- in the one conversation it exists for.
  recorded_by uuid NOT NULL REFERENCES app_user(id),
  occurred_on date NOT NULL DEFAULT current_date,
  body        text NOT NULL CHECK (length(btrim(body)) > 0),
  -- capabilities.mjs describes the write as "Record and progress disciplinary
  -- matters", and a record that can only be appended to cannot be progressed.
  -- Three states and no more: it is open, it concluded, or it was withdrawn.
  state       text NOT NULL DEFAULT 'open'
                CHECK (state IN ('open', 'concluded', 'withdrawn')),
  outcome     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz,
  -- A matter that is no longer open has to say what happened to it. Stated as
  -- a constraint rather than left to whoever is closing it, because a record
  -- marked 'concluded' with nothing beside it is the shape of a school having
  -- decided something it cannot now describe.
  CONSTRAINT disciplinary_record_closes_with_a_reason
    CHECK (state = 'open' OR (outcome IS NOT NULL AND length(btrim(outcome)) > 0))
);

CREATE INDEX ON disciplinary_record (player_id, occurred_on DESC);
CREATE INDEX ON disciplinary_record (school_id, state);
CREATE INDEX ON disciplinary_record (match_id) WHERE match_id IS NOT NULL;

-- Two rules, and they divide the row between the person who wrote it and the
-- school that has to deal with it.
--
-- THE ACCOUNT IS THE AUTHOR'S. An umpire's description of what happened is
-- evidence, and a record whose author is fixed but whose text anybody holding
-- the capability can rewrite records the wrong person's words under the right
-- person's name.
--
-- THE OUTCOME IS THE SCHOOL'S. `state` and `outcome` are for whoever holds
-- discipline.write in scope, which is how a director of sport concludes a
-- matter an official filed. That is the one place this differs from
-- development_note's trigger, which locks the whole row to its author —
-- correct for a coach's private note, and wrong here, because the umpire who
-- filed the incident was appointed for one afternoon and the matter outlives
-- the appointment.
--
-- SQLSTATE class 45 is unassigned by Postgres and by the standard, so it is
-- free for an application to mean something with. 45001 is development_note's
-- "this is not your note" and means the same thing here; 45002 is new and
-- says the subject of a record does not change. Both are deliberately
-- distinct from 42501, which is row-level security saying "this is not your
-- school" — three refusals with three different fixes, mapped in
-- services/api/write/discipline-api.mjs.
CREATE OR REPLACE FUNCTION disciplinary_record_author() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.recorded_by := coalesce(app_user_id(), NEW.recorded_by);
  ELSE
    -- Moving a record from one child to another is not an edit to it. Both
    -- children are at the same school for anybody the policy lets this far,
    -- so row-level security has nothing to refuse and this is the only place
    -- the fact can be held.
    IF NEW.player_id <> OLD.player_id OR NEW.school_id <> OLD.school_id THEN
      RAISE EXCEPTION 'a disciplinary record cannot be re-filed against another child'
        USING ERRCODE = '45002';
    END IF;
    IF NEW.body <> OLD.body
       AND app_user_id() IS NOT NULL AND OLD.recorded_by <> app_user_id() THEN
      RAISE EXCEPTION 'the account of a disciplinary matter may only be edited by the person who recorded it'
        USING ERRCODE = '45001';
    END IF;
    NEW.recorded_by := OLD.recorded_by;      -- authorship never changes hands
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS disciplinary_record_records_its_author ON disciplinary_record;
CREATE TRIGGER disciplinary_record_records_its_author
  BEFORE INSERT OR UPDATE ON disciplinary_record
  FOR EACH ROW EXECUTE FUNCTION disciplinary_record_author();

-- db/06 grants the application role the three verbs ON ALL TABLES that existed
-- when it ran. A table born later is a table the API cannot touch until it is
-- named, and the symptom is a 42501 on every read that looks exactly like a
-- policy refusal. No DELETE, here or anywhere: records about minors are
-- deactivated, never removed.
GRANT SELECT, INSERT, UPDATE ON disciplinary_record TO scrbrd_app;

-- ── Row-level security ─────────────────────────────────────────────
--
-- HAND-WRITTEN, AND NOT IN packages/policy/src/tables.mjs — which is the
-- opposite of the usual rule and needs its reason on the record.
--
-- The generator emits every modelled table's policies into
-- db/09_rls_policies.sql. db/09 runs before this file, so a policy generated
-- for a table created here would fail on a fresh install with "relation does
-- not exist"; and db/09 has already run on production, where the migration
-- ledger refuses a file whose hash changed. Both reasons point the same way,
-- and it is the way news_post (db/12) and scoring_amendment's re-gated INSERT
-- (db/24) already went.
--
-- So these four predicates are written out exactly as callCan() in
-- services/api/rls/generate-rls.mjs would have emitted them for:
--
--   read:  discipline.read   ·  write: discipline.write
--   anchors: { school:  school_id,
--              team:    (SELECT p.team_code FROM player p WHERE p.id = …),
--              person:  player_id,
--              fixture: match_id }
--
-- The team anchor is derived through the player and is NOT load-bearing
-- today: no holder of either capability is team-scoped, and it resolves to
-- NULL for the two holders who cannot read a player row, which a NULL
-- team_code on their own assignment widens past. It is here because it is the
-- difference between a coach who is one day granted discipline.read reaching
-- their own squad's records and reaching the whole school's — the same
-- defence in depth development_note gets from the same subquery.
--
-- The match_toss lesson (see tables.mjs) is about hand-writing into the
-- GENERATED file, where the next regeneration silently deletes it. Nothing
-- regenerates this one. What keeps it honest instead is the assertion block
-- below, db/99's live assertions, and sensitivity.test.mjs, which greps the
-- SQL for the capability inside an app_can() call and fails if it is not
-- there.
ALTER TABLE disciplinary_record ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS disciplinary_record_read   ON disciplinary_record;
DROP POLICY IF EXISTS disciplinary_record_insert ON disciplinary_record;
DROP POLICY IF EXISTS disciplinary_record_update ON disciplinary_record;

CREATE POLICY disciplinary_record_read ON disciplinary_record
  FOR SELECT USING (app_can('discipline.read', disciplinary_record.school_id, (SELECT p.team_code FROM player p WHERE p.id = disciplinary_record.player_id), disciplinary_record.player_id, disciplinary_record.match_id));

CREATE POLICY disciplinary_record_insert ON disciplinary_record
  FOR INSERT WITH CHECK (app_can('discipline.write', disciplinary_record.school_id, (SELECT p.team_code FROM player p WHERE p.id = disciplinary_record.player_id), disciplinary_record.player_id, disciplinary_record.match_id));

CREATE POLICY disciplinary_record_update ON disciplinary_record
  FOR UPDATE USING (app_can('discipline.write', disciplinary_record.school_id, (SELECT p.team_code FROM player p WHERE p.id = disciplinary_record.player_id), disciplinary_record.player_id, disciplinary_record.match_id))
           WITH CHECK (app_can('discipline.write', disciplinary_record.school_id, (SELECT p.team_code FROM player p WHERE p.id = disciplinary_record.player_id), disciplinary_record.player_id, disciplinary_record.match_id));

-- ── Assertion ──────────────────────────────────────────────────────
-- What this file promised, checked in the same paste. A DO block raises, so
-- the transaction the operator wrapped this in rolls back rather than leaving
-- half of it applied.
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE relname = 'disciplinary_record'
                    AND relnamespace = 'public'::regnamespace
                    AND relrowsecurity) THEN
    RAISE EXCEPTION 'db/25: disciplinary_record has row-level security disabled';
  END IF;
  -- Each policy gates on the capability it is meant to, and on no other. A
  -- read policy that named discipline.write would pass the "is it gated at
  -- all" question and be wrong about who by.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE tablename = 'disciplinary_record' AND policyname = 'disciplinary_record_read'
                    AND qual LIKE '%discipline.read%' AND qual NOT LIKE '%discipline.write%') THEN
    RAISE EXCEPTION 'db/25: the read policy does not gate on discipline.read alone';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE tablename = 'disciplinary_record'
         AND policyname IN ('disciplinary_record_insert', 'disciplinary_record_update')
         AND with_check LIKE '%discipline.write%'
         AND with_check NOT LIKE '%discipline.read%') <> 2 THEN
    RAISE EXCEPTION 'db/25: the write policies do not gate on discipline.write alone';
  END IF;
  -- No DELETE policy, and the privilege to match.
  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'disciplinary_record'::regclass AND polcmd = 'd') THEN
    RAISE EXCEPTION 'db/25: disciplinary_record has a delete policy';
  END IF;
  IF has_table_privilege('scrbrd_app', 'disciplinary_record', 'DELETE') THEN
    RAISE EXCEPTION 'db/25: the application role can delete a disciplinary record';
  END IF;
  IF NOT (has_table_privilege('scrbrd_app', 'disciplinary_record', 'SELECT')
          AND has_table_privilege('scrbrd_app', 'disciplinary_record', 'INSERT')
          AND has_table_privilege('scrbrd_app', 'disciplinary_record', 'UPDATE')) THEN
    RAISE EXCEPTION 'db/25: the application role cannot read or write a disciplinary record';
  END IF;
  -- The constraint that stops a matter being closed with nothing said.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'disciplinary_record'::regclass
                    AND conname = 'disciplinary_record_closes_with_a_reason') THEN
    RAISE EXCEPTION 'db/25: a matter can be concluded without saying what happened';
  END IF;
END $check$;
