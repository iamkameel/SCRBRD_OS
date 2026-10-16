-- ══════════════════════════════════════════════════════════════════
--  SCRBRD — apply 113_correction_retracts_notices.sql to a database that already has the rest
-- ══════════════════════════════════════════════════════════════════
--
--  For the Supabase SQL Editor. Nothing here tears anything down: it is the
--  one migration and its ledger row, exactly what `node tools/migrate.mjs`
--  would apply to this database. Refuses to run twice, and refuses to run
--  ahead of its predecessor.
DO $apply$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migration WHERE name = '113_correction_retracts_notices.sql') THEN
    RAISE EXCEPTION '113_correction_retracts_notices.sql is already in this database''s ledger — nothing to do';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE name = '112_assignment_follows_side.sql') THEN
    RAISE EXCEPTION '112_assignment_follows_side.sql has not been applied here — apply it first, or use the rebuild bundle';
  END IF;
END $apply$;

-- A database ledgered by a bundle from before SCRBRD-025 has no note column
-- yet; this reaches it either way.
ALTER TABLE schema_migration ADD COLUMN IF NOT EXISTS note text;

-- ── 113_correction_retracts_notices.sql ──
-- ══════════════════════════════════════════════════════════════════
--  113 · A correction takes back what it falsified
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. GA-I36 slice A2 (docs/design/GA-I36_corrections_everywhere.md
-- D3, D4, §6 N4 and N5, Q4, Q6) together with NOTIFICATIONS slice S5
-- (docs/design/NOTIFICATIONS.md D18, D19: the callers of db/89's
-- notification_retract(), and the un-retract). Its proof is db/99 §90.
--
-- THE GAP. milestone_watch() and bowling_breach_watch() are AFTER INSERT
-- triggers on a ball. A fifty reached on a ball later voided had written its
-- milestone_notice and its notification ("Fifty for D Erasmus"), and nothing
-- on the void took either back: the fold said 46, the side's Notices said
-- fifty. The same for a hundred, a five-for, a hat-trick, a career mark, and
-- a bowling-directive breach (GA-I36 §3 "Notices", broken; Q6). And the
-- public page heard of a void only when its cache's TTL ran out.
--
-- WHAT THIS FILE DOES
--   On a void (a row of ball_event with kind 'void', whoever wrote it: the
--   pad's undo, an approved amendment, anything):
--   1. milestone_retract()   re-asks every live milestone notice of the
--      void's match (and the voided ball's striker's, bowler's and dismissed
--      batter's career notices, wherever they were noticed) whether its mark
--      still holds, asked of the corrected log the way milestone_watch()
--      asked it of the ball (db/87, db/51's own-ball figures). A mark that no
--      longer holds: milestone_notice.retracted_at is set (db/89's RESTRICTIVE
--      policy and recognition() already hide it), and its notification is
--      retracted through notification_retract(…, 'correction', true), which
--      sends ONE "withdrawn" notice to exactly the original's audience in the
--      design's words (D18): title "A notice was withdrawn", body "'Fifty for
--      D Erasmus' was withdrawn after the scorecard was corrected.", urgency
--      the original's capped at medium.
--      Then the voided ball's bowler's innings is asked once more: a void can
--      make a wicket stand (the no-ball before a free hit) or close a
--      hat-trick's gap, never add a run, so a five-for or a hat-trick that
--      the corrected history now holds is noticed ONCE — the retracted row
--      un-retracted, or a new one "after a correction" (recognition D20).
--   2. bowling_breach_retract()  re-asks the voided ball's bowler's breaches
--      of that innings (spell) and that day: one that no longer holds gets
--      bowling_breach.retracted_at (a new RESTRICTIVE policy hides it; the
--      row stays, a record of what was said) and its notification is
--      retracted as above (a welfare notice: urgency high, so the withdrawal
--      goes at medium to the same staff, under player.workload.read).
--   3. public_data_changed  on ball_event, for a void or a released held ball
--      only (N5, D3): the public page's entry for the fixture is dropped on
--      every API instance at commit. Never per ball.
--   On a ball that re-reaches a mark (a re-entered ball, a released held one):
--   4. milestone_notify() and bowling_breach_watch() un-retract the SAME row
--      and its notification, and send nothing new (D19, recognition D20 and
--      Q7: "re-reached → no second notice" means the same row returns). The
--      notice's words are re-synced to the corrected figure (a fifty voided
--      at 52 and re-reached at 50 says 50). Its "withdrawn" notice is itself
--      retracted, superseded and unsaid, so nobody reads "withdrawn" about a
--      notice that stands (D19).
--
-- WHO IS TOLD, AND WHAT IT SAYS. Nothing here chooses an audience or a word:
-- notification_retract() (db/89) copies the original's school, side, scope,
-- capability, child and recipient, and writes the design's sentence. No new
-- notice names a child to anybody the original did not. On a lock screen
-- nothing is named at all: every push is a pointer (push-api.mjs
-- buildPayload(), D14), the "withdrawn" notice's included.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   milestone_notice  + notice_id (the notification that told the side; ON
--                       DELETE SET NULL), backfilled where exactly one
--                       notification matches
--   bowling_breach    + retracted_at, + notice_id (backfilled the same way)
--                     + RESTRICTIVE bowling_breach_not_retracted (SELECT)
--   ball_event        + trigger ball_event_milestone_retract (AFTER INSERT,
--                       WHEN kind = 'void')
--                     + trigger ball_event_breach_retract (the same)
--                     + trigger public_data_changed (AFTER INSERT, WHEN kind
--                       = 'void' OR recovered)
--   milestone_notify()        restated: links its notice; un-retracts on a
--                             re-reached mark
--   bowling_breach_watch()    restated: links its notice; un-retracts on a
--                             re-reached breach
--   workload()                restated (db/60's): breaches_28d counts no
--                             retracted breach
--   new: notification_unretract(), milestone_notify_as(),
--        milestone_still_holds(), milestone_retract(), bowling_breach_retract()
--
-- EXISTING ROWS. No row is deleted and none is retracted by this file: a
-- notice already standing on a ball voided before the paste stays as it was
-- (the triggers act on voids from now on). The only writes are the two link
-- backfills, each named with its count in the paste's output.
--
-- NOTHING IS REMOVED. Every function is CREATE OR REPLACE, every trigger
-- CREATE OR REPLACE TRIGGER, the policy is made inside a DO block only when
-- pg_policies does not have it. Safe to run twice.
--
-- WHO MAY CALL WHAT
--   Every function here: nobody through a route. Not PUBLIC, not scrbrd_app,
--   not a managed host's anon/authenticated. The triggers run them as the
--   owner, as db/08's watchers run.

-- ── 1 · The links, and the breach's retraction column ──────────────
ALTER TABLE milestone_notice ADD COLUMN IF NOT EXISTS notice_id uuid REFERENCES notification(id) ON DELETE SET NULL;
COMMENT ON COLUMN milestone_notice.notice_id IS
  'The notification that told the side of this mark (db/113). A void that falsifies the mark retracts it through notification_retract(); a re-reached mark un-retracts it.';
ALTER TABLE bowling_breach ADD COLUMN IF NOT EXISTS retracted_at timestamptz;
ALTER TABLE bowling_breach ADD COLUMN IF NOT EXISTS notice_id uuid REFERENCES notification(id) ON DELETE SET NULL;
COMMENT ON COLUMN bowling_breach.retracted_at IS
  'When a correction to the log took the breach back (db/113, GA-I36 Q6). Hidden from every reader; the row stays, so what was said is kept, and a re-reached breach is un-retracted in place.';
COMMENT ON COLUMN bowling_breach.notice_id IS
  'The welfare notification that told the staff of this breach (db/113).';

-- ── 2 · The two backfills ──────────────────────────────────────────
-- A notice and its mark were written in one transaction, so their times are
-- equal; the title says which mark (two on one ball are two kinds). Linked
-- only where exactly one notification matches; the rest stay null and are
-- named in the output (a void then retracts the mark, and has no
-- notification to take back).
DO $backfill$
DECLARE n integer; m integer;
BEGIN
  WITH c AS (
    SELECT mn.player_id, mn.kind, mn.match_id, mn.innings, (array_agg(x.id))[1] AS id, count(x.id) AS k
      FROM milestone_notice mn
      JOIN notification x
        ON x.kind = 'recognition' AND x.subject_kind = 'match' AND x.subject_id = mn.match_id
       AND x.subject_person_id = mn.player_id AND x.retracts_id IS NULL AND x.published_by IS NULL
       AND x.published_at = mn.noticed_at
       AND x.title LIKE CASE mn.kind
             WHEN 'fifty'          THEN 'Fifty for %'
             WHEN 'hundred'        THEN 'Hundred for %'
             WHEN 'five_for'       THEN 'Five-for for %'
             WHEN 'hat_trick'      THEN 'Hat-trick for %'
             WHEN 'career_runs'    THEN '% passes ' || mn.value || ' career runs'
             WHEN 'career_wickets' THEN '% passes ' || mn.value || ' career wickets'
             ELSE milestone_label(mn.kind, mn.value) END
     WHERE mn.notice_id IS NULL
     GROUP BY mn.player_id, mn.kind, mn.match_id, mn.innings)
  UPDATE milestone_notice mn SET notice_id = c.id
    FROM c
   WHERE c.k = 1 AND mn.player_id = c.player_id AND mn.kind = c.kind AND mn.match_id = c.match_id AND mn.innings = c.innings;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT count(*) INTO m FROM milestone_notice WHERE notice_id IS NULL;
  RAISE NOTICE 'db/113: % milestone notice(s) linked to their notification; % left unlinked', n, m;

  WITH c AS (
    SELECT b.id AS breach, (array_agg(x.id))[1] AS id, count(x.id) AS k
      FROM bowling_breach b
      JOIN notification x
        ON x.kind = 'welfare' AND x.subject_id = b.match_id AND x.subject_person_id = b.bowler_id
       AND x.retracts_id IS NULL AND x.published_by IS NULL AND x.published_at = b.noticed_at
       AND x.title = 'Bowling directive exceeded'
       AND x.body LIKE CASE b.kind WHEN 'spell' THEN '% overs into a spell;%' ELSE '% overs today;%' END
     WHERE b.notice_id IS NULL
     GROUP BY b.id)
  UPDATE bowling_breach b SET notice_id = c.id FROM c WHERE c.k = 1 AND b.id = c.breach;
  GET DIAGNOSTICS n = ROW_COUNT;
  SELECT count(*) INTO m FROM bowling_breach WHERE notice_id IS NULL;
  RAISE NOTICE 'db/113: % breach(es) linked to their notification; % left unlinked', n, m;
END $backfill$;

-- ── 3 · A retracted breach is not read (GA-I36 Q6, as N4 for a notice) ──
-- RESTRICTIVE, beside db/08's bowling_breach_read, which stays. The watcher
-- and the re-check (definers) still see the row, so a breach is recorded
-- once and a re-reached one returns in place.
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bowling_breach'
                    AND policyname = 'bowling_breach_not_retracted') THEN
    CREATE POLICY bowling_breach_not_retracted ON bowling_breach AS RESTRICTIVE
      FOR SELECT USING (retracted_at IS NULL);
  END IF;
END $policy$;

-- ── 4 · Un-retract: a notice that holds again (D19) ────────────────
-- Clears the three columns on the SAME row (published_at is unchanged, so it
-- reappears where it was), and retracts each live "withdrawn" notice about
-- it as superseded, saying nothing: nobody reads "withdrawn" about a notice
-- that stands, and nobody is told twice. Only a notice the system took back
-- as a correction is returned this way; a person's withdrawal is never
-- undone by the system. Returns whether anything changed.
--
-- Through db/89's door: as the table's owner, for the one row it names.
-- Granted to nobody; the system's own definers call it.
CREATE OR REPLACE FUNCTION notification_unretract(p_id uuid) RETURNS boolean AS $$
DECLARE
  n notification%ROWTYPE;
  w uuid;
BEGIN
  SELECT * INTO n FROM notification WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR n.retracted_at IS NULL THEN RETURN false; END IF;
  IF n.retraction_kind IS DISTINCT FROM 'correction' THEN
    RAISE EXCEPTION 'only a notice taken back as a correction is returned by the system (NOTIFICATIONS.md D19), not one %', n.retraction_kind
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_retract_kind';
  END IF;
  PERFORM set_config('scrbrd.notification_retract', n.id::text, true);
  UPDATE notification SET retracted_at = NULL, retracted_by = NULL, retraction_kind = NULL WHERE id = n.id;
  PERFORM set_config('scrbrd.notification_retract', '', true);
  FOR w IN SELECT x.id FROM notification x WHERE x.retracts_id = n.id AND x.retracted_at IS NULL ORDER BY x.published_at, x.id LOOP
    PERFORM notification_retract(w, 'superseded', false);
  END LOOP;
  RETURN true;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_unretract(uuid) FROM PUBLIC;

-- ── 5 · Does a mark still hold? ────────────────────────────────────
-- Asked of the log as it now stands, by the rules milestone_watch() (db/87)
-- noticed it by: runs off the bat from the striker's own balls (db/51), a
-- bowler's standing wickets (bowler_innings_figures), the hat-trick view, a
-- career sum. The fold's facts (packages/scoring facts.mjs) are the same
-- rules; tools/smoke-fold-figures holds the two together. A kind a void
-- cannot move (caps) always holds. Runs as its caller: the definers below.
CREATE OR REPLACE FUNCTION milestone_still_holds(p_player uuid, p_kind text, p_match uuid, p_innings smallint, p_value integer)
RETURNS boolean AS $$
  SELECT CASE p_kind
    WHEN 'fifty'          THEN innings_runs_off_bat(p_player, p_match, p_innings) >= 50
    WHEN 'hundred'        THEN innings_runs_off_bat(p_player, p_match, p_innings) >= 100
    WHEN 'five_for'       THEN coalesce((SELECT f.wickets FROM bowler_innings_figures f
                                          WHERE f.player_id = p_player AND f.match_id = p_match AND f.innings = p_innings), 0) >= 5
    WHEN 'hat_trick'      THEN EXISTS (SELECT 1 FROM bowler_hat_trick h
                                        WHERE h.player_id = p_player AND h.match_id = p_match AND h.innings = p_innings)
    WHEN 'career_runs'    THEN career_runs_off_bat(p_player) >= p_value
    WHEN 'career_wickets' THEN coalesce((SELECT sum(f.wickets) FROM bowler_innings_figures f WHERE f.player_id = p_player), 0) >= p_value
    ELSE true END
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION milestone_still_holds(uuid, text, uuid, smallint, integer) FROM PUBLIC;

-- ── 6 · Noticing a mark, once (db/08's milestone_notify, restated) ──
-- db/08's words exactly, and its "once" (milestone_notice's key). Changed:
--   * the notice is linked from its mark (notice_id);
--   * a mark already noticed and retracted, now reached again, is returned
--     in place — the same milestone_notice row and the same notification,
--     its words re-synced to the figure the corrected log holds — and
--     nothing new is sent (D19; recognition D20, Q7);
--   * p_after (the void's re-check only): a mark the corrected history holds
--     that was never noticed says so, "…, after a correction." (recognition
--     D20). milestone_notify() is the ball's, and says nothing of the kind.
CREATE OR REPLACE FUNCTION milestone_notify_as(p_player uuid, p_kind text, p_match uuid, p_innings smallint, p_value integer, p_after boolean)
RETURNS void AS $$
DECLARE
  p player%ROWTYPE;
  v_title text; v_body text; v_new boolean; v_notice uuid; v_retracted timestamptz; v_id uuid;
BEGIN
  INSERT INTO milestone_notice (player_id, kind, match_id, innings, value)
  VALUES (p_player, p_kind, p_match, p_innings, p_value) ON CONFLICT DO NOTHING;
  v_new := FOUND;
  SELECT * INTO p FROM player WHERE id = p_player;
  v_title := CASE p_kind
    WHEN 'fifty'          THEN 'Fifty for ' || p.full_name
    WHEN 'hundred'        THEN 'Hundred for ' || p.full_name
    WHEN 'five_for'       THEN 'Five-for for ' || p.full_name
    WHEN 'hat_trick'      THEN 'Hat-trick for ' || p.full_name
    WHEN 'career_runs'    THEN p.full_name || ' passes ' || p_value || ' career runs'
    WHEN 'career_wickets' THEN p.full_name || ' passes ' || p_value || ' career wickets'
    ELSE milestone_label(p_kind, p_value) END;
  v_body := milestone_label(p_kind, p_value) || ' against ' || coalesce((SELECT opponent FROM match WHERE id = p_match), 'the opposition')
            || CASE WHEN p_after THEN ', after a correction.' ELSE '.' END;

  IF NOT v_new THEN
    -- Noticed before. Live: nothing to do (the "once"). Retracted: it holds
    -- again, so the same row returns.
    SELECT mn.notice_id, mn.retracted_at INTO v_notice, v_retracted FROM milestone_notice mn
     WHERE mn.player_id = p_player AND mn.kind = p_kind AND mn.match_id = p_match AND mn.innings = p_innings FOR UPDATE;
    IF v_retracted IS NULL THEN RETURN; END IF;
    UPDATE milestone_notice SET retracted_at = NULL, value = p_value
     WHERE player_id = p_player AND kind = p_kind AND match_id = p_match AND innings = p_innings;
    IF v_notice IS NOT NULL AND notification_unretract(v_notice) THEN
      UPDATE notification SET title = v_title,
             body = milestone_label(p_kind, p_value) || ' against ' || coalesce((SELECT opponent FROM match WHERE id = p_match), 'the opposition') || '.'
       WHERE id = v_notice;
    END IF;
    RETURN;
  END IF;

  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind, subject_id, subject_person_id)
  VALUES (p.school_id, p.team_code, 'team', 'recognition', 'low', v_title, v_body,
          'news.read', false, 'match', p_match, p_player)
  RETURNING id INTO v_id;
  UPDATE milestone_notice SET notice_id = v_id
   WHERE player_id = p_player AND kind = p_kind AND match_id = p_match AND innings = p_innings;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION milestone_notify_as(uuid, text, uuid, smallint, integer, boolean) FROM PUBLIC;

-- The ball's: milestone_watch() (db/87) calls this, unchanged.
CREATE OR REPLACE FUNCTION milestone_notify(p_player uuid, p_kind text, p_match uuid, p_innings smallint, p_value int) RETURNS void AS $$
BEGIN
  PERFORM milestone_notify_as(p_player, p_kind, p_match, p_innings, p_value, false);
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION milestone_notify(uuid, text, uuid, smallint, integer) FROM PUBLIC;

-- ── 7 · On a void: take back what no longer holds (N4) ─────────────
-- The voided row is found by its key, in its match (ball_event_live's own
-- rule). A void of a void changes nothing (the fold skips it; SQL never
-- restores a row once a void names it), so it is skipped here too. A second
-- void of the same ball finds nothing live to take back: idempotent.
CREATE OR REPLACE FUNCTION milestone_retract() RETURNS trigger AS $$
DECLARE
  t ball_event%ROWTYPE;
  r record;
  v_players uuid[];
  v_w integer;
BEGIN
  SELECT * INTO t FROM ball_event b WHERE b.match_id = NEW.match_id AND b.idempotency_key = NEW.payload->>'target';
  IF NOT FOUND OR t.kind = 'void' THEN RETURN NULL; END IF;
  v_players := array_remove(ARRAY[t.striker_id, t.bowler_id, t.dismissed_id], NULL);

  -- 1. Every live notice of this match, and the voided ball's players'
  --    career notices wherever they were noticed: does its mark still hold?
  FOR r IN
    SELECT mn.player_id, mn.kind, mn.match_id, mn.innings, mn.value, mn.notice_id
      FROM milestone_notice mn
     WHERE mn.retracted_at IS NULL
       AND (mn.match_id = NEW.match_id
            OR (mn.player_id = ANY (v_players) AND mn.kind IN ('career_runs', 'career_wickets')))
     ORDER BY mn.noticed_at, mn.kind, mn.player_id
       FOR UPDATE
  LOOP
    IF NOT milestone_still_holds(r.player_id, r.kind, r.match_id, r.innings, r.value) THEN
      UPDATE milestone_notice SET retracted_at = now()
       WHERE player_id = r.player_id AND kind = r.kind AND match_id = r.match_id AND innings = r.innings;
      IF r.notice_id IS NOT NULL THEN
        PERFORM notification_retract(r.notice_id, 'correction', true);
      END IF;
    END IF;
  END LOOP;

  -- 2. What the corrected history holds that it did not: a void never adds
  --    a run, but it can make the bowler's wicket stand or close his
  --    hat-trick's gap. His innings only, never a super over (db/71).
  IF t.bowler_id IS NOT NULL AND innings_super_over_of(t.match_id, t.innings) IS NULL THEN
    SELECT f.wickets INTO v_w FROM bowler_innings_figures f
     WHERE f.player_id = t.bowler_id AND f.match_id = t.match_id AND f.innings = t.innings;
    IF coalesce(v_w, 0) >= 5 THEN
      PERFORM milestone_notify_as(t.bowler_id, 'five_for', t.match_id, t.innings, 5, true);
    END IF;
    IF EXISTS (SELECT 1 FROM bowler_hat_trick h
                WHERE h.player_id = t.bowler_id AND h.match_id = t.match_id AND h.innings = t.innings) THEN
      PERFORM milestone_notify_as(t.bowler_id, 'hat_trick', t.match_id, t.innings, 3, true);
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION milestone_retract() FROM PUBLIC;

CREATE OR REPLACE TRIGGER ball_event_milestone_retract AFTER INSERT ON ball_event
  FOR EACH ROW WHEN (NEW.kind = 'void')
  EXECUTE FUNCTION milestone_retract();

-- ── 8 · On a void: a breach that no longer holds (Q6) ──────────────
-- A breach is judged against the limit it was recorded under (`allowed`),
-- not today's directive. The day: his overs on that date, in any match. The
-- spell: a void can shift every over after it by a ball (an over is six
-- legal balls, db/08), so a spell's first over may move; the innings'
-- breaches are matched to its spells by count, latest first — while N of
-- his spells in that innings still exceed the limit, his first N breaches
-- there stand. A void never makes a breach: a correction that adds one is
-- the ball path's to notice (bowling_breach_watch()), not this one's.
CREATE OR REPLACE FUNCTION bowling_breach_retract() RETURNS trigger AS $$
DECLARE
  t ball_event%ROWTYPE;
  r bowling_breach%ROWTYPE;
  v_n integer := 0;
  v_day date;
BEGIN
  SELECT * INTO t FROM ball_event b WHERE b.match_id = NEW.match_id AND b.idempotency_key = NEW.payload->>'target';
  IF NOT FOUND OR t.kind = 'void' OR t.bowler_id IS NULL THEN RETURN NULL; END IF;

  FOR r IN SELECT * FROM bowling_breach x
            WHERE x.match_id = t.match_id AND x.innings = t.innings AND x.bowler_id = t.bowler_id
              AND x.kind = 'spell' AND x.retracted_at IS NULL
            ORDER BY x.key, x.noticed_at FOR UPDATE LOOP
    v_n := v_n + 1;
    IF v_n > (SELECT count(*) FROM bowler_spell s
               WHERE s.match_id = r.match_id AND s.innings = r.innings AND s.bowler_id = r.bowler_id
                 AND s.overs > r.allowed) THEN
      UPDATE bowling_breach SET retracted_at = now() WHERE id = r.id;
      IF r.notice_id IS NOT NULL THEN PERFORM notification_retract(r.notice_id, 'correction', true); END IF;
    END IF;
  END LOOP;

  SELECT (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date INTO v_day FROM match m WHERE m.id = t.match_id;
  FOR r IN SELECT * FROM bowling_breach x
            WHERE x.bowler_id = t.bowler_id AND x.kind = 'day' AND x.bowled_on = v_day AND x.retracted_at IS NULL
            FOR UPDATE LOOP
    IF (SELECT count(*) FROM bowler_over o WHERE o.bowler_id = r.bowler_id AND o.bowled_on = r.bowled_on) <= r.allowed THEN
      UPDATE bowling_breach SET retracted_at = now() WHERE id = r.id;
      IF r.notice_id IS NOT NULL THEN PERFORM notification_retract(r.notice_id, 'correction', true); END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION bowling_breach_retract() FROM PUBLIC;

CREATE OR REPLACE TRIGGER ball_event_breach_retract AFTER INSERT ON ball_event
  FOR EACH ROW WHEN (NEW.kind = 'void')
  EXECUTE FUNCTION bowling_breach_retract();

-- ── 9 · The breach, as a fact (db/08's bowling_breach_watch, restated) ──
-- db/08's rules and words exactly. Changed: the notice is linked from its
-- breach (notice_id); and a breach recorded and retracted, now reached again,
-- is returned in place — the same row, its figure re-synced, and the same
-- notification with its words re-synced — and nothing new is sent (D19).
CREATE OR REPLACE FUNCTION bowling_breach_watch() RETURNS trigger AS $$
DECLARE
  d record; s record; p player%ROWTYPE;
  v_day date; v_day_overs int; v_b uuid; v_id uuid; v_words text;
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
    v_words := p.full_name || ' (' || d.age_band || ') is ' || s.overs || ' overs into a spell; the directive allows '
                 || d.max_overs_per_spell || '. Take him off.';
    v_b := NULL;
    INSERT INTO bowling_breach (match_id, innings, bowler_id, school_id, kind, key, overs, allowed, age_band, bowled_on)
    VALUES (NEW.match_id, NEW.innings, NEW.bowler_id, p.school_id, 'spell', s.first_over, s.overs, d.max_overs_per_spell, d.age_band, s.bowled_on)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_b;
    IF v_b IS NOT NULL THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, subject_person_id)
      VALUES (p.school_id, p.team_code, 'team', 'welfare', 'high',
              'Bowling directive exceeded', v_words,
              'player.workload.read', false, 'match', NEW.match_id, NEW.bowler_id)
      RETURNING id INTO v_id;
      UPDATE bowling_breach SET notice_id = v_id WHERE id = v_b;
    ELSE
      -- Recorded before: retracted by a correction and reached again?
      UPDATE bowling_breach SET retracted_at = NULL, overs = s.overs
       WHERE match_id = NEW.match_id AND innings = NEW.innings AND bowler_id = NEW.bowler_id
         AND kind = 'spell' AND key = s.first_over AND retracted_at IS NOT NULL
      RETURNING notice_id INTO v_id;
      IF v_id IS NOT NULL AND notification_unretract(v_id) THEN
        UPDATE notification SET body = v_words WHERE id = v_id;
      END IF;
    END IF;
  END IF;

  -- The day: every over he has bowled on the fixture's date, in any match.
  SELECT o.bowled_on, count(*) INTO v_day, v_day_overs
    FROM bowler_over o
   WHERE o.bowler_id = NEW.bowler_id
     AND o.bowled_on = (SELECT (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date FROM match m WHERE m.id = NEW.match_id)
   GROUP BY o.bowled_on;
  IF FOUND AND d.max_overs_per_day IS NOT NULL AND v_day_overs > d.max_overs_per_day THEN
    v_words := p.full_name || ' (' || d.age_band || ') has bowled ' || v_day_overs || ' overs today; the directive allows '
                 || d.max_overs_per_day || ' in a day. He does not bowl again today.';
    v_b := NULL; v_id := NULL;
    INSERT INTO bowling_breach (match_id, innings, bowler_id, school_id, kind, key, overs, allowed, age_band, bowled_on)
    VALUES (NEW.match_id, NEW.innings, NEW.bowler_id, p.school_id, 'day', 0, v_day_overs, d.max_overs_per_day, d.age_band, v_day)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_b;
    IF v_b IS NOT NULL THEN
      INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                                required_capability, is_public, subject_kind, subject_id, subject_person_id)
      VALUES (p.school_id, p.team_code, 'team', 'welfare', 'high',
              'Bowling directive exceeded', v_words,
              'player.workload.read', false, 'match', NEW.match_id, NEW.bowler_id)
      RETURNING id INTO v_id;
      UPDATE bowling_breach SET notice_id = v_id WHERE id = v_b;
    ELSE
      UPDATE bowling_breach SET retracted_at = NULL, overs = v_day_overs
       WHERE bowler_id = NEW.bowler_id AND kind = 'day' AND bowled_on = v_day AND retracted_at IS NOT NULL
      RETURNING notice_id INTO v_id;
      IF v_id IS NOT NULL AND notification_unretract(v_id) THEN
        UPDATE notification SET body = v_words WHERE id = v_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION bowling_breach_watch() FROM PUBLIC;

-- ── 10 · "At once" for a correction (N5, D3) ───────────────────────
-- A void or a released held ball drops the fixture's public entry on every
-- API instance at commit, as db/59's other triggers do (the payload names
-- the match and never the table). Never an ordinary ball: the live cache's
-- TTL is the batching.
CREATE OR REPLACE TRIGGER public_data_changed AFTER INSERT ON ball_event
  FOR EACH ROW WHEN (NEW.kind = 'void' OR NEW.recovered)
  EXECUTE FUNCTION public_data_notify('match', 'match_id');

-- ── 11 · workload(), re-emitted (db/60's) ──────────────────────────
-- db/60's function exactly, with one line: breaches_28d counts no retracted
-- breach (a definer reads past the RESTRICTIVE policy, so it asks itself).
CREATE OR REPLACE FUNCTION workload(p_team text DEFAULT NULL)
RETURNS TABLE (player_id uuid, full_name text, team_code text, school_id uuid,
               age_band text, pace boolean, max_overs_per_spell smallint, max_overs_per_day smallint,
               overs_7d int, overs_28d int, longest_spell_7d int, breaches_28d int, last_bowled_on date,
               sessions_7d int, minutes_7d int, sessions_28d int, minutes_28d int,
               acwr numeric, load_state text,
               units_7d int, units_28d int, estimated_7d boolean, ewma_ratio numeric, load_word text,
               monitored boolean) AS $$
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
       AND x.retracted_at IS NULL   -- db/113: a breach a correction took back is not one
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
     GROUP BY a.player_id),
  -- The load, from load_day: the same series and the same EWMA as
  -- load_summary(), so the list and the profile say the same word.
  lf AS (
    SELECT d.player_id,
           sum(d.units) FILTER (WHERE sa_today() - d.on_date < 7)::int  AS units_7d,
           sum(d.units) FILTER (WHERE sa_today() - d.on_date < 28)::int AS units_28d,
           coalesce(bool_or(d.estimated) FILTER (WHERE sa_today() - d.on_date < 7), false) AS estimated_7d,
           sum(d.units * 0.25 * power(0.75::numeric, sa_today() - d.on_date)) AS acute,
           sum(d.units * (2.0 / 29) * power((27.0 / 29)::numeric, sa_today() - d.on_date)) AS chronic
      FROM load_day d JOIN boys b ON b.id = d.player_id
     WHERE d.sport_code = 'cricket' AND d.on_date <= sa_today() AND d.on_date > sa_today() - 90
     GROUP BY d.player_id)
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
              ELSE 'steady' END AS load_state,
         coalesce(lf.units_7d, 0), coalesce(lf.units_28d, 0), coalesce(lf.estimated_7d, false),
         CASE WHEN lf.chronic > 0 THEN round(lf.acute / lf.chronic, 2) END,
         load_word(lf.units_28d, lf.units_7d, CASE WHEN lf.chronic > 0 THEN round(lf.acute / lf.chronic, 2) END),
         health_consent_live(b.id)
    FROM boys b
    CROSS JOIN LATERAL bowling_directive_for(b.id) d
    LEFT JOIN bowl w ON w.bowler_id = b.id
    LEFT JOIN spells sp ON sp.bowler_id = b.id
    LEFT JOIN breaches br ON br.bowler_id = b.id
    LEFT JOIN train tr ON tr.player_id = b.id
    LEFT JOIN lf ON lf.player_id = b.id
   ORDER BY CASE WHEN coalesce(br.breaches_28d, 0) > 0 THEN 0 ELSE 1 END,
            CASE WHEN coalesce(w.overs_28d, 0) > 0 AND w.overs_7d / (w.overs_28d / 4.0) > 1.5 THEN 0 ELSE 1 END,
            coalesce(w.overs_7d, 0) DESC, b.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION workload(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workload(text) TO scrbrd_app;

-- A managed host's API roles reach none of it.
DO $managed$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['notification_unretract(uuid)', 'milestone_still_holds(uuid,text,uuid,smallint,integer)',
                               'milestone_notify_as(uuid,text,uuid,smallint,integer,boolean)',
                               'milestone_notify(uuid,text,uuid,smallint,integer)', 'milestone_retract()',
                               'bowling_breach_retract()', 'bowling_breach_watch()', 'workload(text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $managed$;

-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  src text;
BEGIN
  -- The system's own: definers with the pinned path, callable by nobody.
  FOREACH f IN ARRAY ARRAY['notification_unretract(uuid)', 'milestone_notify_as(uuid,text,uuid,smallint,integer,boolean)',
                           'milestone_notify(uuid,text,uuid,smallint,integer)', 'milestone_retract()',
                           'bowling_breach_retract()', 'bowling_breach_watch()'] LOOP
    IF to_regprocedure(f) IS NULL THEN RAISE EXCEPTION 'db/113: % is missing', f; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(f) AND p.prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/113: % is not a SECURITY DEFINER with a pinned path', f;
    END IF;
    IF has_function_privilege('public', to_regprocedure(f), 'EXECUTE')
       OR has_function_privilege('scrbrd_app', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/113: % is executable by PUBLIC or by scrbrd_app', f;
    END IF;
  END LOOP;
  IF has_function_privilege('public', to_regprocedure('milestone_still_holds(uuid,text,uuid,smallint,integer)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'db/113: milestone_still_holds() is executable by PUBLIC';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'workload(text)'::regprocedure, 'EXECUTE')
     OR position('x.retracted_at IS NULL' IN (SELECT prosrc FROM pg_proc WHERE oid = 'workload(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/113: workload() still counts a retracted breach, or the application lost it';
  END IF;

  -- The three triggers, on a void (and a released ball) only.
  IF (SELECT count(*) FROM pg_trigger g
       WHERE g.tgrelid = 'ball_event'::regclass AND NOT g.tgisinternal
         AND ((g.tgname = 'ball_event_milestone_retract' AND g.tgfoid = 'milestone_retract()'::regprocedure)
           OR (g.tgname = 'ball_event_breach_retract'   AND g.tgfoid = 'bowling_breach_retract()'::regprocedure))
         AND pg_get_triggerdef(g.oid) LIKE '%AFTER INSERT ON public.ball_event FOR EACH ROW WHEN ((new.kind = ''void''::text))%') <> 2 THEN
    RAISE EXCEPTION 'db/113: the two void triggers are not AFTER INSERT … WHEN (kind = ''void'')';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                  WHERE g.tgrelid = 'ball_event'::regclass AND g.tgname = 'public_data_changed' AND NOT g.tgisinternal
                    AND g.tgfoid = 'public_data_notify()'::regprocedure
                    AND pg_get_triggerdef(g.oid) LIKE '%WHEN (((new.kind = ''void''::text) OR new.recovered))%') THEN
    RAISE EXCEPTION 'db/113: ball_event has no public_data_changed trigger for a void or a released ball';
  END IF;

  -- The retraction goes through db/89's function, with the system's word
  -- and its sentence; the un-retract through the door.
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'milestone_retract()'::regprocedure;
  IF position('notification_retract(r.notice_id, ''correction'', true)' IN src) = 0
     OR position('milestone_still_holds(' IN src) = 0 THEN
    RAISE EXCEPTION 'db/113: milestone_retract() does not re-ask the mark, or does not retract through notification_retract()';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'bowling_breach_retract()'::regprocedure;
  IF position('notification_retract(r.notice_id, ''correction'', true)' IN src) = 0 THEN
    RAISE EXCEPTION 'db/113: bowling_breach_retract() does not retract through notification_retract()';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'notification_unretract(uuid)'::regprocedure;
  IF position('notification_retract(w, ''superseded'', false)' IN src) = 0
     OR position('scrbrd.notification_retract' IN src) = 0 THEN
    RAISE EXCEPTION 'db/113: notification_unretract() does not supersede its "withdrawn" notice unsaid, or bypasses the door';
  END IF;
  SELECT prosrc INTO src FROM pg_proc WHERE oid = 'notification_retract(uuid,text,boolean)'::regprocedure;
  IF position('''A notice was withdrawn''' IN src) = 0
     OR position('was withdrawn after the scorecard was corrected.' IN src) = 0 THEN
    RAISE EXCEPTION 'db/113: notification_retract() (db/89) no longer writes the design''s words';
  END IF;

  -- What the readers are kept from.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bowling_breach'
                    AND policyname = 'bowling_breach_not_retracted' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
                    AND qual = '(retracted_at IS NULL)') THEN
    RAISE EXCEPTION 'db/113: bowling_breach_not_retracted is missing or not the policy this file wrote';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'milestone_notice'
                    AND policyname = 'milestone_notice_not_retracted' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/113: db/89''s milestone_notice_not_retracted is missing';
  END IF;
END $check$;


-- ── the ledger row, with the hash the migrator would record and the commit
--    this bundle was generated from ──
INSERT INTO schema_migration (name, sha256, note) VALUES ('113_correction_retracts_notices.sql', '46c4276f7a6d6e77cf02adf39c00da63635d4b4179fa18517ea73d214b9d4aa4', '00bc558e3d4f66c869261040e6f213896ad348f1');
