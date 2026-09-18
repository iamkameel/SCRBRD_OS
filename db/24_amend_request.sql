-- ══════════════════════════════════════════════════════════════════
--  24 · The request for a correction gets its own name (SCRBRD-054)
-- ══════════════════════════════════════════════════════════════════
--
-- db/02 wrote scoring_amendment's INSERT policy on `scoring.correct`, and
-- `scoring.correct` gates three other things that have nothing to do with
-- paperwork: force-releasing a scoring lease whose holder has gone
-- (scoring_session_release, db/02), reading the quarantine queue (db/02,
-- db/14) and entering a DRS review (db/09). Those are recovery at the
-- ground, and the director of sport and the competition admin hold them
-- because somebody senior has to. But the same name was also the first
-- signature on an amendment to a locked match, and both of those roles hold
-- the second signature (`scoring.amend.approve`) — so either could file a
-- correction and approve it in one pair of hands, which is exactly what
-- capabilities.mjs says must not happen.
--
-- Withdrawing `scoring.correct` from the two roles was tried first (a db/24
-- that never landed): it took session recovery, quarantine visibility and
-- DRS entry away with it and three walks went red. The defect is that four
-- acts share a name, so the fix is a fourth name.
--
-- Three steps, in the order the foreign keys need:
--
--   1. The catalogue row. role_capability.capability references capability
--      (db/01), so the name exists before anything holds it.
--   2. The grants: the scorer, who is the person who spots the mistake, and
--      superadmin, whose bundle is "everything" and is asserted to be
--      (db/99: the owner's key holds every capability). Nobody else. The
--      director of sport and the competition admin keep `scoring.correct`
--      and everything it recovers, and never receive the request — so the
--      requester and approver sets no longer overlap.
--   3. The policy. The INSERT on scoring_amendment now asks for the new
--      name. Everything else about the policy — you file as yourself, it
--      starts pending — is exactly as db/02 wrote it.
--
-- db/01 and db/02 are not edited: both have run on production and the ledger
-- refuses a changed file. generate-rls.mjs's ADDED_SINCE_01 keeps db/01
-- emitting its catalogue and bundles WITHOUT this capability, so a fresh
-- install receives it here, in the same order production did.
--
-- Safe to run twice: each step does nothing when its row or policy is
-- already the one described.

INSERT INTO capability (name) VALUES ('scoring.amend.request')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_capability (role, capability) VALUES
  ('superadmin', 'scoring.amend.request'),
  ('scorer',     'scoring.amend.request')
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS scoring_amendment_insert ON scoring_amendment;
CREATE POLICY scoring_amendment_insert ON scoring_amendment
  FOR INSERT WITH CHECK (
    requested_by = app_user_id()
    AND state = 'pending'
    AND app_can('scoring.amend.request', scoring_amendment.school_id,
                match_team(scoring_amendment.match_id), NULL, scoring_amendment.match_id)
  );

-- ── Assertion ──────────────────────────────────────────────────────
-- What this file promised, checked in the same paste. A DO block raises, so
-- the transaction the operator wrapped this in rolls back rather than
-- leaving half of it applied.
DO $check$
DECLARE
  holders text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM capability WHERE name = 'scoring.amend.request') THEN
    RAISE EXCEPTION 'db/24: scoring.amend.request is not in the catalogue';
  END IF;
  SELECT array_agg(role ORDER BY role) INTO holders
    FROM role_capability WHERE capability = 'scoring.amend.request';
  IF holders IS DISTINCT FROM ARRAY['scorer', 'superadmin'] THEN
    RAISE EXCEPTION 'db/24: scoring.amend.request is held by %, expected scorer and superadmin', holders;
  END IF;
  -- The two roles this file exists to keep apart: each still recovers a
  -- session, and neither can file the correction it would then approve.
  IF EXISTS (SELECT 1 FROM role_capability
              WHERE role IN ('directorofsport', 'competitionadmin')
                AND capability = 'scoring.amend.request') THEN
    RAISE EXCEPTION 'db/24: an approver can still request';
  END IF;
  IF (SELECT count(*) FROM role_capability
       WHERE role IN ('directorofsport', 'competitionadmin')
         AND capability = 'scoring.correct') <> 2 THEN
    RAISE EXCEPTION 'db/24: session recovery was withdrawn — that was the wrong fix';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE tablename = 'scoring_amendment' AND policyname = 'scoring_amendment_insert'
                    AND with_check LIKE '%scoring.amend.request%'
                    AND with_check NOT LIKE '%scoring.correct%') THEN
    RAISE EXCEPTION 'db/24: scoring_amendment_insert does not gate on scoring.amend.request';
  END IF;
END $check$;
