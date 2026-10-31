-- ══════════════════════════════════════════════════════════════════
--  127 · The fixture class: competitive, festival or friendly, and the
--        reasons a match stands on no board; comp_type a closed list
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Slice R3 of docs/design/RECOGNITION_reconciliation.md (§5,
-- the R3 row), on Kameel's answers to Q1–Q3 (decided as recommended,
-- 7 October 2026):
--   Q1  A friendly is a fixture with no competition (match.competition_id
--       NULL, db/61). The Practice Match never reaches the server, so it
--       needs no class and no pilot flag.
--   Q2  Inter-house is deferred to V2: no `inter_house` comp_type now.
--   Q3  External festivals feed School Records within their format; DLS (an
--       adjusted target), abandoned and super-over matches stand on no board
--       in V1. The super-over half is db/71's already (a super over's
--       innings are in no career, ball_event_career); the match's own
--       innings are not touched by it, so it is no reason here.
--
-- `match_verified(match)`, the R3 row's other half, is db/114's (§4, "one
-- definition, this file's") and is not redefined here.
--
-- Its proof is db/99 §104; the JS twin is fixtureClass() in
-- packages/scoring/src/result.mjs, held to this one in
-- tools/smoke-fold-figures.mjs over every result and rain log.
--
-- ── 1 · fixture_class(match) ────────────────────────────────────────
-- One row: the match's class and its no-board reason, NULL when it has none.
--   class      friendly     no competition (Q1)
--              festival     a competition whose comp_type is festival (Q3)
--              competitive  a league or a knockout
--   no_board   read off match_result_compute() (db/121's), the one result:
--              decided_off_field  a decision changed the match's outcome
--                                 (conceded, walkover, or an award that
--                                 overrides play): the outcome is not
--                                 play's. An award that only says who goes
--                                 through leaves the match's own outcome,
--                                 and the figures stand on it.
--              (nothing)          still in progress: not decided, so no
--                                 reason yet. A board also asks
--                                 match_verified().
--              abandoned          the outcome is abandoned (the organiser's
--                                 status, with no result from play)
--              no_result          the outcome is no result
--              adjusted_target    the chase's target was revised, by the
--                                 umpires or by DLS (the result's
--                                 revised_target, SCRBRD-130 R1)
--              In that order: the first that holds is the reason.
-- The class and the reason are independent: a friendly may be abandoned.
-- Nothing is stored; a correction, a decision or a change of status moves
-- it on the next read (Q10: derive, never store).
--
-- STABLE; a pinned SECURITY DEFINER that asks nothing of the caller, as
-- match_verified() beside it, and like it nobody's to call: not PUBLIC, not
-- the application, not a managed host's API roles. The readers that will
-- carry it (R4's restated milestones, R9's boards) call it as the owner.
--
-- ── 2 · comp_type, a closed list ────────────────────────────────────
-- competition.comp_type was free text, commented `league | knockout |
-- festival` (db/00), and competition_create() (db/67) already refuses
-- anything else as comp_type_invalid. The CHECK competition_comp_type_known
-- holds every door to those three, and to a value: a type left empty is
-- outside the list, since a class cannot be read off nothing. Its name is
-- the refusal. ADDED NOT VALID, then VALIDATED, after asking first, as
-- db/86 does: any competition outside the list stops this file, named, and
-- nothing is changed. The pilot and the demo each hold one competition, a
-- league.
--
-- ── 3 · WHAT THIS FILE DOES NOT TOUCH ──────────────────────────────
-- No table, column, policy, capability or row. No function but the new one.
-- A second paste changes nothing. Nothing in the application calls it yet.


-- ── 0 · What this file stands on, and refuse to replace what it was not ──
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('competition') IS NULL OR to_regclass('match') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'competition' AND column_name = 'comp_type')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'match' AND column_name = 'competition_id')
     OR to_regprocedure('match_result_compute(uuid)') IS NULL
     OR to_regprocedure('match_verified(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/127: competition.comp_type, match.competition_id (db/61), match_result_compute() (db/121) or match_verified() (db/114) is missing; apply them first';
  END IF;
  -- fixture_class() is this file's alone: absent, or as this file wrote it.
  FOR r IN SELECT * FROM (VALUES
      ('fixture_class(uuid)', '8a153d4302f4f2dbacfe0894f8256b4e'))
      AS x(fn, mine)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    CONTINUE WHEN v_src IS NULL;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 <> r.mine THEN
      RAISE EXCEPTION 'db/127: % is not this file''s (md5 % of its folded body); look before replacing it', r.fn, v_md5;
    END IF;
  END LOOP;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · fixture_class
-- ══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fixture_class(p_match uuid)
RETURNS TABLE (fixture_class text, no_board text) AS $$
  SELECT CASE WHEN m.competition_id IS NULL THEN 'friendly'
              WHEN c.comp_type = 'festival' THEN 'festival'
              ELSE 'competitive' END,
         CASE WHEN r.decision_applied AND r.outcome IS DISTINCT FROM r.play_outcome THEN 'decided_off_field'
              WHEN r.outcome IS NULL OR r.outcome = 'in_progress' THEN NULL
              WHEN r.outcome = 'abandoned' THEN 'abandoned'
              WHEN r.outcome = 'no_result' THEN 'no_result'
              WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(r.innings) i
                            WHERE i->>'revised_target' IS NOT NULL) THEN 'adjusted_target'
         END
    FROM match m
    LEFT JOIN competition c ON c.id = m.competition_id
    LEFT JOIN LATERAL match_result_compute(m.id) r ON true
   WHERE m.id = p_match
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION fixture_class(uuid) IS
  'db/127 (RECOGNITION R3): the match''s class (competitive, festival, friendly) and the reason it stands on no board (decided_off_field, abandoned, no_result, adjusted_target), NULL when none. Derived on every read. Its JS twin is fixtureClass() (packages/scoring/src/result.mjs).';


-- ══════════════════════════════════════════════════════════════════
-- §2 · comp_type, a closed list (as db/86)
-- ══════════════════════════════════════════════════════════════════
DO $rule$
DECLARE
  n      int;
  v_list text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'competition'::regclass
                AND conname = 'competition_comp_type_known' AND convalidated) THEN
    RETURN;   -- a second run
  END IF;

  -- Nothing is written between the question below and the constraint.
  PERFORM set_config('lock_timeout', '10s', true);
  LOCK TABLE competition IN ACCESS EXCLUSIVE MODE;

  SELECT count(*),
         string_agg(format('%s (%s, comp_type %s)', c.id, c.name, coalesce(quote_literal(c.comp_type), 'empty')),
                    '; ' ORDER BY c.created_at, c.id)
    INTO n, v_list
    FROM competition c
   WHERE c.comp_type IS NULL OR c.comp_type NOT IN ('league', 'knockout', 'festival');
  IF n > 0 THEN
    RAISE EXCEPTION 'db/127: % competition(s) have a type outside league, knockout and festival: %. Nothing was changed. Set each one''s comp_type, then paste this again.',
      n, v_list;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'competition'::regclass
                    AND conname = 'competition_comp_type_known') THEN
    ALTER TABLE competition ADD CONSTRAINT competition_comp_type_known
      CHECK (comp_type IS NOT NULL AND comp_type IN ('league', 'knockout', 'festival')) NOT VALID;
  END IF;
  ALTER TABLE competition VALIDATE CONSTRAINT competition_comp_type_known;
END $rule$;
COMMENT ON COLUMN competition.comp_type IS
  'league | knockout | festival (db/127 competition_comp_type_known). A festival''s fixtures are the festival class; a league''s and a knockout''s, competitive (fixture_class()).';


-- ── 3 · Who may call it: nobody but its owner ──────────────────────
-- A managed host's API roles get EXECUTE on every new function by default
-- privilege, so it is taken back (db/47's reasoning, as db/125 and db/126).
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['fixture_class(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;


-- ── 4 · Check what was built ────────────────────────────────────────
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'fixture_class(uuid)'::regprocedure AND p.prosecdef
                    AND p.provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/127: fixture_class() is not a STABLE SECURITY DEFINER with a pinned path';
  END IF;
  IF has_function_privilege('public', 'fixture_class(uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'fixture_class(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/127: fixture_class() is executable by PUBLIC or by scrbrd_app';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'competition'::regclass
                    AND conname = 'competition_comp_type_known' AND convalidated) THEN
    RAISE EXCEPTION 'db/127: competition_comp_type_known is not in force';
  END IF;
END $check$;
