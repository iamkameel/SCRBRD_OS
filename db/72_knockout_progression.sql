-- ══════════════════════════════════════════════════════════════════
--  72 · Knockout progression (SCRBRD-114 phase 3c)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, but for the table's policies between the GENERATED markers
-- (TABLES_ADDED_SINCE_09). The design is docs/design/SCRBRD-114_phase3_
-- results_super_over.md §5, built to D14 as decided (Kameel, 2026-09-30);
-- §11 there records the build. Results are db/69; the super over db/71.
--
-- A RESULT RESOLVES A REFERENCE. The planner (SCRBRD-123) drafts a later
-- knockout round with a side `{ winnerOf: <fixture> }` and holds the draft
-- back (awaiting_winner) until that side is known. Once the earlier match
-- has a winner — by play, by a super over, or by the organiser's decision —
-- publishing makes the fixture with the winner as its side and writes one
-- row here: where the side came from, and the result it came from, by its
-- hash (match_result().result_hash).
--
-- A CORRECTED RESULT RE-RESOLVES IT WHILE NOTHING HAS BEEN PLAYED, AND FLAGS
-- IT ONCE SOMETHING HAS (D14): nothing downstream is rewritten silently.
--
--   downstream     upstream now                 progression_check() does
--   no event yet   a winner, another hash       the fixture's side becomes the new
--                                               winner (the side's columns, before
--                                               its first ball, as the away side's
--                                               rule allows); the row the new hash;
--                                               both schools are told
--   no event yet   no winner any more           the side and the fixture stay; the
--                                               row's resolution is cleared and
--                                               flagged "awaiting a winner of …"
--   has an event   another hash                 flagged only: "the result of … changed
--                                               after this match was played"; the
--                                               played fixture is never rewritten
--
-- A flag stands until the organiser clears it, with a note of ten characters
-- or more (progression_clear()), having decided what the change means — a
-- decision row (db/69) or an adjustment. Clearing acknowledges the result as
-- it now is; a later change flags again. A flag and its clearing are stamped
-- with clock_timestamp(), not now(): a change after a clearing in the same
-- transaction must still read as after it.
--
-- WHAT IS HERE.
--
--   match_progression           the row (§5.2), with who cleared a flag and why.
--   progression_winner(m, take) the side a result sends on: its winner, or (a
--                               placement match, later) its loser; NULL while
--                               nobody won.
--   match_progression_record()  the planner's publish, after the fixture route
--                               made the fixture: the row, under the organiser's
--                               competition.conditions.manage (who publishes a
--                               plan). Refuses a side that is not the winner.
--   progression_check(m)        §5.3, for every row fed by match m.
--   progression_clear()         the organiser clears a flag with a note, under
--                               competition.manage (who decides results, D8).
--   progression_conflict        the standing flags, per competition, as the
--   (view)                      reader may see the rows: the bracket screen's
--                               and the organiser's inbox.
--   three triggers              the paths of §2.6 by the rows they write: any
--                               event appended to an upstream match's log (an
--                               approved amendment, a release from quarantine,
--                               a scorebook commit, the pad), and a decision
--                               recorded or withdrawn. Each asks
--                               progression_check() of the match it touched,
--                               and only where a row is fed by it.
--
-- NOT A TRIGGER: the organiser's status change. A win stands whatever the
-- match's status (db/69 §10.2, 7), so a status never changes who goes
-- through; the outcomes it moves (in progress, no result, abandoned) name no
-- winner, and a row exists only for a winner. Recorded in the design (§11).
--
-- RLS. The table's policies are generated (below): read under
-- competition.read at the organiser and by whoever can reach the
-- competition; the application has no INSERT, UPDATE or DELETE; the doors are
-- the definer functions above. The view runs as its reader.

-- ── 1 · The row (design §5.2) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_progression (
  match_id             uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,       -- the downstream fixture
  side                 text NOT NULL CHECK (side IN ('home', 'away')),
  from_match_id        uuid NOT NULL REFERENCES match(id) ON DELETE CASCADE,       -- the upstream match
  take                 text NOT NULL DEFAULT 'winner' CHECK (take IN ('winner', 'loser')),
  competition_id       uuid NOT NULL REFERENCES competition(id) ON DELETE CASCADE,
  -- The planner's fixture id of the upstream (ko:r…:m…), for the bracket.
  fixture_key          text CHECK (fixture_key IS NULL OR length(fixture_key) BETWEEN 1 AND 200),
  resolved_school_id   uuid,
  resolved_team_code   text,
  resolved_at          timestamptz,
  resolved_result_hash text,
  conflict_at          timestamptz,
  conflict_note        text,
  cleared_at           timestamptz,
  cleared_by           uuid REFERENCES app_user(id),
  cleared_note         text,
  created_by           uuid NOT NULL REFERENCES app_user(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, side),
  CHECK (match_id <> from_match_id),
  CHECK (cleared_at IS NULL OR (cleared_by IS NOT NULL AND length(btrim(coalesce(cleared_note, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS match_progression_from ON match_progression (from_match_id);
CREATE INDEX IF NOT EXISTS match_progression_competition ON match_progression (competition_id);
COMMENT ON TABLE match_progression IS
  'SCRBRD-114 phase 3c: where a knockout side came from — the upstream match, the result it was resolved from (its hash), and any flag a later correction raised. Written by db/72''s functions alone.';

ALTER TABLE match_progression ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON match_progression FROM scrbrd_app;
GRANT SELECT ON match_progression TO scrbrd_app;

-- ── 2 · Who a result sends on ─────────────────────────────────────
-- The winner (match_result()'s winner_*: play, a super over, or a decision),
-- or, taking the loser, the other side once there is a winner. NULL while
-- nobody won. With the result's hash, which is what a row remembers.
CREATE OR REPLACE FUNCTION progression_winner(p_match uuid, p_take text DEFAULT 'winner')
RETURNS TABLE (school_id uuid, team_code text, result_hash text) AS $$
  SELECT CASE WHEN r.winner_side IS NULL THEN NULL
              WHEN p_take = 'loser' THEN CASE r.winner_side WHEN 'home' THEN m.away_school_id ELSE m.school_id END
              ELSE r.winner_school_id END,
         CASE WHEN r.winner_side IS NULL THEN NULL
              WHEN p_take = 'loser' THEN CASE r.winner_side WHEN 'home' THEN m.away_team_code ELSE m.team_code END
              ELSE r.winner_team_code END,
         r.result_hash
    FROM match m, LATERAL match_result_compute(m.id) r
   WHERE m.id = p_match
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION progression_winner(uuid, text) FROM PUBLIC;

-- A side's columns on the match: the home side's, or the away side's.
CREATE OR REPLACE FUNCTION match_side_of(p_match uuid, p_side text, OUT school_id uuid, OUT team_code text) AS $$
  SELECT CASE p_side WHEN 'home' THEN m.school_id ELSE m.away_school_id END,
         CASE p_side WHEN 'home' THEN m.team_code ELSE m.away_team_code END
    FROM match m WHERE m.id = p_match
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_side_of(uuid, text) FROM PUBLIC;

-- ── 3 · The planner's publish records the row ─────────────────────
-- After the fixture route made the downstream fixture with the upstream's
-- winner as its side (planner-api.mjs). Answers (ok, reason, detail):
--   not_permitted      no such match, or not the caller's to publish (one answer)
--   support_session    a support session publishes nothing
--   side_invalid · take_invalid
--   not_in_competition the two matches are not the same competition's
--   no_winner          the upstream has no winner (yet, or any more)
--   side_mismatch      the downstream side is not the side the result sends on
-- A second call for the same side and upstream is ok and changes nothing.
CREATE OR REPLACE FUNCTION match_progression_record(p_match uuid, p_side text, p_from uuid,
                                                    p_take text DEFAULT 'winner', p_fixture_key text DEFAULT NULL)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE
  d  match%ROWTYPE;
  u  match%ROWTYPE;
  w  record;
  s  record;
  x  match_progression%ROWTYPE;
BEGIN
  SELECT * INTO d FROM match m WHERE m.id = p_match;
  IF NOT FOUND OR d.competition_id IS NULL OR app_user_id() IS NULL OR app_pad_scoped()
     OR NOT competition_conditions_manager(d.competition_id) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF app_support_access_id() IS NOT NULL THEN RETURN QUERY SELECT false, 'support_session', NULL::text; RETURN; END IF;
  IF p_side IS NULL OR p_side NOT IN ('home', 'away') THEN RETURN QUERY SELECT false, 'side_invalid', 'home or away'; RETURN; END IF;
  IF coalesce(p_take, '') NOT IN ('winner', 'loser') THEN RETURN QUERY SELECT false, 'take_invalid', 'winner or loser'; RETURN; END IF;
  SELECT * INTO u FROM match m WHERE m.id = p_from;
  IF NOT FOUND OR u.competition_id IS DISTINCT FROM d.competition_id OR u.id = d.id THEN
    RETURN QUERY SELECT false, 'not_in_competition', 'both matches are this competition''s, and two'; RETURN;
  END IF;
  SELECT * INTO x FROM match_progression p WHERE p.match_id = p_match AND p.side = p_side;
  IF FOUND THEN
    IF x.from_match_id = p_from AND x.take = p_take THEN RETURN QUERY SELECT true, NULL::text, 'already'; RETURN; END IF;
    RETURN QUERY SELECT false, 'side_mismatch', 'that side already comes from another match'; RETURN;
  END IF;
  SELECT * INTO w FROM progression_winner(p_from, p_take);
  IF w.school_id IS NULL THEN RETURN QUERY SELECT false, 'no_winner', 'the earlier match has no winner'; RETURN; END IF;
  SELECT * INTO s FROM match_side_of(p_match, p_side);
  IF s.school_id IS DISTINCT FROM w.school_id OR s.team_code IS DISTINCT FROM w.team_code THEN
    RETURN QUERY SELECT false, 'side_mismatch', 'the fixture''s side is not the side the result sends on'; RETURN;
  END IF;
  INSERT INTO match_progression (match_id, side, from_match_id, take, competition_id, fixture_key,
                                 resolved_school_id, resolved_team_code, resolved_at, resolved_result_hash, created_by)
  VALUES (p_match, p_side, p_from, p_take, d.competition_id, p_fixture_key,
          w.school_id, w.team_code, now(), w.result_hash, app_user_id());
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_progression_record(uuid, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_progression_record(uuid, text, uuid, text, text) TO scrbrd_app;

-- ── 4 · progression_check(): a result changed (design §5.3, D14) ──
-- For every row fed by p_from. Returns how many rows it changed. Runs as
-- the owner: it is the triggers' (below), never the application's.
CREATE OR REPLACE FUNCTION progression_check(p_from uuid) RETURNS integer AS $$
DECLARE
  x       match_progression%ROWTYPE;
  w       record;
  s       record;
  d       match%ROWTYPE;
  u       match%ROWTYPE;
  v_n     integer := 0;
  v_label text;
  v_from  text;
  v_standing boolean;
BEGIN
  SELECT * INTO u FROM match m WHERE m.id = p_from;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_from := coalesce(fixture_side_label(u.school_id, u.team_code), u.team_code, 'home') || ' v '
         || coalesce(fixture_side_label(u.away_school_id, u.away_team_code), u.opponent, 'away')
         || ' (' || to_char(u.starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon') || ')';
  FOR x IN SELECT * FROM match_progression p WHERE p.from_match_id = p_from ORDER BY p.match_id, p.side FOR UPDATE LOOP
    SELECT * INTO w FROM progression_winner(p_from, x.take);
    IF w.result_hash IS NOT DISTINCT FROM x.resolved_result_hash THEN CONTINUE; END IF;
    SELECT * INTO d FROM match m WHERE m.id = x.match_id;
    v_standing := x.conflict_at IS NOT NULL AND (x.cleared_at IS NULL OR x.cleared_at < x.conflict_at);
    IF EXISTS (SELECT 1 FROM ball_event b WHERE b.match_id = x.match_id) THEN
      -- Played: flagged only; the fixture is never rewritten.
      IF NOT v_standing THEN
        UPDATE match_progression SET conflict_at = clock_timestamp(),
               conflict_note = 'the result of ' || v_from || ' changed after this match was played'
         WHERE match_id = x.match_id AND side = x.side;
        v_n := v_n + 1;
      END IF;
    ELSIF w.school_id IS NULL THEN
      -- No winner any more: the fixture keeps its side; the row awaits one.
      UPDATE match_progression SET resolved_school_id = NULL, resolved_team_code = NULL, resolved_at = NULL,
             resolved_result_hash = w.result_hash, conflict_at = clock_timestamp(), conflict_note = 'awaiting a winner of ' || v_from
       WHERE match_id = x.match_id AND side = x.side;
      v_n := v_n + 1;
    ELSE
      -- Unplayed, and a winner: the side is the winner's.
      SELECT * INTO s FROM match_side_of(x.match_id, x.side);
      IF s.school_id IS DISTINCT FROM w.school_id OR s.team_code IS DISTINCT FROM w.team_code THEN
        v_label := coalesce(fixture_side_label(w.school_id, w.team_code), w.team_code);
        IF x.side = 'home' THEN
          UPDATE match SET school_id = w.school_id, team_code = w.team_code WHERE id = x.match_id;
        ELSE
          UPDATE match SET away_school_id = w.school_id, away_team_code = w.team_code, opponent = v_label WHERE id = x.match_id;
        END IF;
        -- Both schools are told: the side that comes in and the side it meets.
        INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                  required_capability, is_public, subject_kind, subject_id)
        SELECT t.school, t.team, 'team', 'fixture', 'high', 'A knockout fixture''s side has changed',
               'The result of ' || v_from || ' was corrected, so ' || v_label || ' now plays this fixture ('
                 || to_char(d.starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon HH24:MI') || ').',
               'fixture.read', false, 'match', x.match_id
          FROM (VALUES (w.school_id, w.team_code),
                       (CASE x.side WHEN 'home' THEN d.away_school_id ELSE d.school_id END,
                        CASE x.side WHEN 'home' THEN d.away_team_code ELSE d.team_code END)) AS t(school, team)
         WHERE t.school IS NOT NULL AND t.team ~ '^(U(9|10|11|12|13|14|15|16|17|18|19)[A-F]?|([1-9]|1[0-9]|20)XI)$';
        -- ...and the organiser, where the competition has a school.
        INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                  required_capability, is_public, subject_kind, subject_id)
        SELECT c.school_id, NULL, 'competition', 'fixture', 'medium', 'A knockout fixture was re-resolved',
               'The result of ' || v_from || ' was corrected; its winner, ' || v_label || ', now plays the next round.',
               'competition.manage', false, 'match', x.match_id
          FROM competition c WHERE c.id = x.competition_id AND c.school_id IS NOT NULL;
      END IF;
      UPDATE match_progression SET resolved_school_id = w.school_id, resolved_team_code = w.team_code, resolved_at = now(),
             resolved_result_hash = w.result_hash,
             conflict_at = CASE WHEN v_standing AND conflict_note LIKE 'awaiting a winner of %' THEN NULL ELSE conflict_at END,
             conflict_note = CASE WHEN v_standing AND conflict_note LIKE 'awaiting a winner of %' THEN NULL ELSE conflict_note END
       WHERE match_id = x.match_id AND side = x.side;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION progression_check(uuid) FROM PUBLIC;

-- ── 5 · The paths that change a result (design §2.6) ──────────────
-- An event appended to a match's log: the pad, a release from quarantine, an
-- approved amendment's void or correction, a scorebook's commit. One check
-- per statement, per match that feeds a row.
CREATE OR REPLACE FUNCTION progression_after_events() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT n.match_id FROM progression_new_events n
            WHERE EXISTS (SELECT 1 FROM match_progression p WHERE p.from_match_id = n.match_id) LOOP
    PERFORM progression_check(r.match_id);
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION progression_after_events() FROM PUBLIC;
DROP TRIGGER IF EXISTS progression_after_events ON ball_event;
CREATE TRIGGER progression_after_events AFTER INSERT ON ball_event
  REFERENCING NEW TABLE AS progression_new_events
  FOR EACH STATEMENT EXECUTE FUNCTION progression_after_events();

-- A decision recorded, or withdrawn (db/69): who goes through may change.
CREATE OR REPLACE FUNCTION progression_after_decision() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM match_progression p WHERE p.from_match_id = NEW.match_id) THEN
    PERFORM progression_check(NEW.match_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION progression_after_decision() FROM PUBLIC;
DROP TRIGGER IF EXISTS progression_after_decision ON match_result_decision;
CREATE TRIGGER progression_after_decision AFTER INSERT OR UPDATE ON match_result_decision
  FOR EACH ROW EXECUTE FUNCTION progression_after_decision();

-- ── 6 · The organiser clears a flag, with a note ──────────────────
-- Under competition.manage at the organiser (who decides results, D8): the
-- flag is a question about who should have played, and its answer is a
-- decision. Clearing acknowledges the result as it now is (the row takes
-- its hash); a later change flags again. Answers (ok, reason, detail):
--   not_permitted · support_session · note_required (ten characters or more)
--   no_conflict   nothing is flagged on that side
CREATE OR REPLACE FUNCTION progression_clear(p_match uuid, p_side text, p_note text)
RETURNS TABLE (ok boolean, reason text, detail text) AS $$
DECLARE x match_progression%ROWTYPE; w record;
BEGIN
  SELECT * INTO x FROM match_progression p WHERE p.match_id = p_match AND p.side = p_side;
  IF NOT FOUND OR app_user_id() IS NULL OR app_pad_scoped()
     OR NOT app_can('competition.manage', competition_organiser(x.competition_id), '*'::text,
                    '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted', NULL::text; RETURN;
  END IF;
  IF app_support_access_id() IS NOT NULL THEN RETURN QUERY SELECT false, 'support_session', NULL::text; RETURN; END IF;
  IF length(btrim(coalesce(p_note, ''))) < 10 THEN RETURN QUERY SELECT false, 'note_required', 'ten characters or more'; RETURN; END IF;
  IF x.conflict_at IS NULL OR (x.cleared_at IS NOT NULL AND x.cleared_at >= x.conflict_at) THEN
    RETURN QUERY SELECT false, 'no_conflict', NULL::text; RETURN;
  END IF;
  SELECT * INTO w FROM progression_winner(x.from_match_id, x.take);
  UPDATE match_progression SET cleared_at = clock_timestamp(), cleared_by = app_user_id(), cleared_note = btrim(p_note),
         resolved_result_hash = w.result_hash
   WHERE match_id = p_match AND side = p_side;
  RETURN QUERY SELECT true, NULL::text, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION progression_clear(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION progression_clear(uuid, text, text) TO scrbrd_app;

-- ── 7 · The standing flags (design §5.3) ──────────────────────────
-- Per competition, as the reader may see the rows: the bracket screen's
-- flags and the organiser's inbox. A flag stands from its raising until it
-- is cleared.
CREATE OR REPLACE VIEW progression_conflict WITH (security_invoker = true) AS
SELECT p.competition_id, p.match_id, p.side, p.from_match_id, p.fixture_key, p.take,
       p.resolved_school_id, p.resolved_team_code, p.conflict_at, p.conflict_note,
       p.conflict_note LIKE 'awaiting a winner of %' AS awaiting_winner,
       EXISTS (SELECT 1 FROM ball_event_live b WHERE b.match_id = p.match_id) AS played
  FROM match_progression p
 WHERE p.conflict_at IS NOT NULL AND (p.cleared_at IS NULL OR p.cleared_at < p.conflict_at);
GRANT SELECT ON progression_conflict TO scrbrd_app;

-- ── 8 · Grants on a managed host ──────────────────────────────────
-- The platform's API roles get EXECUTE on every new function in public by
-- default privilege, directly and not through PUBLIC (db/29, db/47, db/51).
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['progression_winner(uuid,text)', 'match_side_of(uuid,text)',
                               'match_progression_record(uuid,text,uuid,text,text)', 'progression_check(uuid)',
                               'progression_after_events()', 'progression_after_decision()', 'progression_clear(uuid,text,text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON match_progression FROM %I', r);
      EXECUTE format('REVOKE ALL ON progression_conflict FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;

-- ── 9 · Row-level security ───────────────────────────────────────
-- ┌── GENERATED from packages/policy/src/tables.mjs by services/api/rls/generate-rls.mjs (TABLES_ADDED_SINCE_09). DO NOT EDIT BY HAND; `pnpm rls:generate` rewrites it.

-- match_progression — read: competition.read · write: competition.manage
-- plus a named exception on read — see readPredicate() in generate-rls.mjs
ALTER TABLE match_progression ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_progression_read   ON match_progression;
DROP POLICY IF EXISTS match_progression_insert ON match_progression;
DROP POLICY IF EXISTS match_progression_update ON match_progression;
DROP POLICY IF EXISTS match_progression_delete ON match_progression;

CREATE POLICY match_progression_read ON match_progression
  FOR SELECT USING ((app_can('competition.read', (competition_organiser(match_progression.competition_id)), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
    OR (competition_visible(match_progression.competition_id)));

CREATE POLICY match_progression_insert ON match_progression
  FOR INSERT WITH CHECK (app_can('competition.manage', (competition_organiser(match_progression.competition_id)), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE POLICY match_progression_update ON match_progression
  FOR UPDATE USING (app_can('competition.manage', (competition_organiser(match_progression.competition_id)), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
           WITH CHECK (app_can('competition.manage', (competition_organiser(match_progression.competition_id)), '*'::text, '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid));

-- └── END GENERATED

-- The pad's credential reads and writes none of it (db/50's guard).
SELECT pad_scope_guard_install('match_progression'::regclass);

-- ── 10 · The proof ───────────────────────────────────────────────
-- What must hold the moment the file has run; db/99 §51 is the fuller
-- proof, under the application role, on every verify paste.
DO $check$
BEGIN
  IF has_table_privilege('scrbrd_app', 'match_progression', 'INSERT') OR has_table_privilege('scrbrd_app', 'match_progression', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'match_progression', 'DELETE') THEN
    RAISE EXCEPTION 'db/72: the application may write match_progression past its functions';
  END IF;
  IF has_function_privilege('scrbrd_app', 'progression_check(uuid)', 'EXECUTE')
     OR has_function_privilege('scrbrd_app', 'progression_winner(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/72: the application may call the check or the winner directly';
  END IF;
  IF NOT coalesce((SELECT 'security_invoker=true' = ANY (c.reloptions) FROM pg_class c WHERE c.oid = 'progression_conflict'::regclass), false) THEN
    RAISE EXCEPTION 'db/72: progression_conflict runs as its owner';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'match_progression'::regclass) < 1
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'match_progression'::regclass) THEN
    RAISE EXCEPTION 'db/72: match_progression has no row-level security';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('progression_after_events', 'progression_after_decision') AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'db/72: the two triggers are not both in place';
  END IF;
END $check$;
