-- ══════════════════════════════════════════════════════════════════
--  58 · A boy's fitness is his health (SCRBRD-117)
-- ══════════════════════════════════════════════════════════════════
--
-- player.fitness — 'fit', 'injured', 'rehab', 'unavailable' — came through
-- player_masked unmasked, under player.profile.read. A pupil holds that
-- capability across his side (the `player` bundle), so every pupil read
-- whether every team-mate was injured or in rehab: exactly what K3 (db/55)
-- took away at the injury row, still there one column over. CSA's
-- Safeguarding Policy p52 item 6 keeps a child's medical needs out of
-- "general view to other parents/caregivers or children", and PUBLIC_DATA N2
-- already treats the bare word "unavailable" as health.
-- (docs/design/SAFEGUARDING_DSO.md §6.3; docs/backlog SCRBRD-117.)
--
-- WHAT CHANGES: the column is masked behind medical.status.read — the tier
-- the injury row itself is read under — anchored to the boy's own team, as
-- the injury row is. So his side's coach, assistant and manager, the physio,
-- the office and leadership read it; his parent and he himself read it
-- through their assignments that name him; a team-mate, another side's coach
-- (who sees the roster, db/08) and a scorer read NULL. The screens already
-- drew it only for a role holding the status tier; this makes the database
-- say the same thing to a client that does not.
--
-- HOW: player_masked is built from information_schema with a mask list
-- (db/09, rebuilt by db/47 for its two columns). Rebuilt here the same way,
-- with db/09's ten masks and this one. CREATE OR REPLACE keeps the columns,
-- their order and their types: `fitness` stays text, now inside a CASE.
--
-- NOT by editing packages/policy and regenerating db/09: db/09 shipped.
-- tables.mjs carries the mask (the truth for the client and the next
-- generated file); MASKED_SINCE_09 in services/api/rls/generate-rls.mjs takes
-- it out again before db/09 is emitted, so db/09 stays byte-identical, and
-- rls.test.mjs holds this file's list to tables.mjs's, verbatim.
--
-- search_path is not pinned here because nothing here is a function: the
-- view is security_invoker, so it runs as the caller, under the caller's RLS.
--
-- Safe to run twice.

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
    LEFT JOIN (VALUES ('id_number', 'player.identity.read', 'player.team_code'), ('email', 'player.pii.read', 'player.team_code'), ('phone', 'player.pii.read', 'player.team_code'), ('hometown', 'player.pii.read', 'player.team_code'), ('houseatschool', 'player.pii.read', 'player.team_code'), ('address', 'player.pii.read', 'player.team_code'), ('guardian', 'player.pii.read', 'player.team_code'), ('height', 'player.biometric.read', 'player.team_code'), ('weight', 'player.biometric.read', 'player.team_code'), ('fitness', 'medical.status.read', 'player.team_code'), ('born', 'player.age.read', '''*''::text')) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = 'player';

  IF cols IS NULL THEN
    RAISE EXCEPTION 'db/58: cannot rebuild player_masked: table player not found';
  END IF;

  EXECUTE format(
    -- security_invoker, as db/09 says at length: without it the view reads
    -- player as its owner and every row reaches everyone.
    'CREATE OR REPLACE VIEW player_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM player',
    cols);
END
$mask_player$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  v_def   text;
  v_cols  integer;
BEGIN
  SELECT pg_get_viewdef('player_masked'::regclass) INTO v_def;
  -- fitness is behind the status tier, and nothing else moved.
  IF v_def !~ 'app_can\(''medical\.status\.read''::text, school_id, team_code, id, NULL::uuid\)\s+THEN fitness' THEN
    RAISE EXCEPTION 'db/58: player_masked does not mask fitness behind medical.status.read on the boy''s own team';
  END IF;
  SELECT count(*) INTO v_cols FROM regexp_matches(v_def, 'CASE\s+WHEN app_can\(', 'g');
  IF v_cols <> 11 THEN
    RAISE EXCEPTION 'db/58: player_masked masks % column(s), expected db/09''s ten and fitness', v_cols;
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'player_masked')
     <> (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'player') THEN
    RAISE EXCEPTION 'db/58: player_masked does not carry every player column';
  END IF;
  IF v_def ~ 'THEN (full_name|surname|known_as|team_code)\M' THEN
    RAISE EXCEPTION 'db/58: player_masked masks a name or a side; neither is masked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'player_masked'::regclass
                    AND 'security_invoker=true' = ANY (coalesce(reloptions, '{}'))
                    AND 'security_barrier=true' = ANY (coalesce(reloptions, '{}'))) THEN
    RAISE EXCEPTION 'db/58: player_masked lost security_invoker or security_barrier';
  END IF;
END $check$;
