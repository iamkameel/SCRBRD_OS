-- ══════════════════════════════════════════════════════════════════
--  36 · An idempotency key names ONE event: the commit fingerprint
-- ══════════════════════════════════════════════════════════════════
--
-- appendEvents() deduped on idempotency_key alone. A key it had seen was
-- answered "duplicate" and the body that came with it was dropped — whatever
-- that body said. A retry of the same ball is exactly that, and harmless. A
-- DIFFERENT ball under a key already used is not: a device that reuses a key
-- after a restore, a client that mints keys badly, a queue edited by hand.
-- Each was told its ball was safely recorded while the server kept another
-- one, and the two folds then disagreed by a delivery nobody could find.
--
-- So each stored event now carries a fingerprint of what it SAYS, and the
-- write path compares: same key + same fingerprint is a retry (duplicate, as
-- before); same key + different fingerprint is a conflict, refused and
-- reported per event, never dropped.
--
-- THE CANONICAL FORM is the row's own semantic content:
--
--   sha256( jsonb_strip_nulls( to_jsonb(row) minus the provenance columns ) )
--
-- In it: match_id, innings, kind, ball_type, value, shot, contact,
-- trajectory, seg, zone, striker/non_striker/bowler/dismissed ids,
-- dismissal, payload, and the placement columns — what happened.
--
-- Out of it, deliberately: seq, epoch, device_id, scorer_user_id,
-- client_seq, client_ts, server_ts, recovered, school_id, id and the key
-- itself. Those record who sent it, from what, when, and under which token —
-- how it ARRIVED, not what it says. A legitimate retry can differ in every
-- one of them: the outbox re-sends a ball under a new epoch after a claim,
-- a rehydrated queue may renumber, a clock can be corrected, and a released
-- quarantine row is `recovered`. Counting any of them would turn an honest
-- retry into a conflict and hold a real ball for a person to clear.
-- school_id is derived from the match, so match_id already carries it.
--
-- Nulls are stripped, at every level, so that a column added to ball_event
-- later (nullable, as they all are) does not change the fingerprint of a
-- row stored before it existed — the retry of an old ball still matches.
-- A new column that is PROVENANCE, or that has a non-null default, must be
-- added to the exclusion list below, or retries of older rows will read as
-- conflicts. That failure is loud (a held event) rather than silent.
--
-- WHY SQL AND NOT packages/scoring: the fingerprint is computed in ONE place,
-- and it has to be here because not every writer of ball_event is the API.
-- scoring_amendment_decide() (db/02), quarantine_resolve() (db/14), the
-- seed and the smoke walks all INSERT rows directly, and db/02 and db/14 are
-- frozen. A trigger reaches every one of them; a JS function reaches none.
-- The server asks the same function about the event it is holding (through
-- jsonb_populate_record, which coerces exactly as the INSERT does — numeric
-- scale included), so there is no second implementation to drift. And the
-- rows already stored get their fingerprint from the same function below,
-- so there is no legacy exception to carry: every row has one.
--
-- The trigger OVERWRITES whatever a writer supplies. A fingerprint a client
-- could choose is a fingerprint a client could forge.

-- 1. The function. STABLE, not IMMUTABLE: to_jsonb of a row is only stable.
CREATE OR REPLACE FUNCTION ball_event_fingerprint(r ball_event) RETURNS text AS $$
  SELECT encode(sha256(convert_to(jsonb_strip_nulls(
           to_jsonb(r) - ARRAY['id', 'school_id', 'seq', 'epoch', 'scorer_user_id',
                               'device_id', 'idempotency_key', 'client_seq', 'client_ts',
                               'server_ts', 'recovered', 'fingerprint']
         )::text, 'UTF8')), 'hex')
$$ LANGUAGE sql STABLE;

-- 2. The column, and every row already stored. ball_event is append-only by
--    trigger; like db/13 this is a one-time edit by the owner, in a
--    migration, of a column that did not exist until this statement — no
--    recorded fact changes — and the trigger is back before the file ends.
ALTER TABLE ball_event ADD COLUMN fingerprint text;
ALTER TABLE ball_event DISABLE TRIGGER ball_event_no_update;
UPDATE ball_event b SET fingerprint = ball_event_fingerprint(b);
ALTER TABLE ball_event ENABLE TRIGGER ball_event_no_update;
ALTER TABLE ball_event ALTER COLUMN fingerprint SET NOT NULL;

-- 3. Every new row is stamped. Named zz_ on purpose: Postgres fires BEFORE
--    triggers in name order, and this one must see the row as it will be
--    stored, after anything else has had its say about NEW.
CREATE OR REPLACE FUNCTION ball_event_stamp_fingerprint() RETURNS trigger AS $$
BEGIN
  NEW.fingerprint := ball_event_fingerprint(NEW);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER zz_ball_event_fingerprint
  BEFORE INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_stamp_fingerprint();

-- 4. Quarantine. A held body is the CLIENT's event (camelCase, payload
--    unmapped), and turning it into row form is toRow() in packages/scoring,
--    which SQL cannot run — so the write path computes it (the same function
--    over the same populated row it would have inserted live) and passes it
--    in. The rows already held cannot be converted here and keep NULL:
--    "legacy, accept a matching key as a duplicate", which is exactly what
--    the write path did for them before this file. A NEW row without one is
--    refused by trigger rather than by CHECK, because quarantine_resolve()
--    UPDATEs legacy rows when it releases them, and a CHECK — even NOT VALID
--    — would refuse that update and strand every ball held before today.
ALTER TABLE ball_event_quarantine ADD COLUMN fingerprint text;

CREATE OR REPLACE FUNCTION ball_event_quarantine_fingerprint_required() RETURNS trigger AS $$
BEGIN
  IF NEW.fingerprint IS NULL THEN
    RAISE EXCEPTION 'ball_event_quarantine.fingerprint is required for a new held event (key %)', NEW.idempotency_key
      USING ERRCODE = 'not_null_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER ball_event_quarantine_fingerprint_required
  BEFORE INSERT ON ball_event_quarantine
  FOR EACH ROW EXECUTE FUNCTION ball_event_quarantine_fingerprint_required();
