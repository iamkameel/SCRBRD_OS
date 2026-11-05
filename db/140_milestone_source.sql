-- ══════════════════════════════════════════════════════════════════
--  140 · Milestones say where they came from; the family is told at the seal
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Slice R4 of docs/design/RECOGNITION_reconciliation.md (§5),
-- as docs/design/RECOGNITION_design.md §10 changes it (decided 7 Oct 2026,
-- Kameel: D1–D25, Q1–Q12 as recommended; unparked 5 Nov 2026, "Unpark
-- Awards, get the crew batting"). Its proof is db/99 §118.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────
-- 1. recognition() (db/116's) says, of each milestone, where it came from:
--      side_code      the side the boy played for in that match (the match's
--                     side code, never player.team_code: R4, D22's anchor)
--      innings        the innings it was made in (NULL for a career mark)
--      sealed_on      the day the scorer's seal stands for it, NULL until
--                     then (D6): an innings mark (fifty, hundred, five-for,
--                     hat-trick) when its innings is sealed and the seal
--                     stands (match_result_compute()'s `sealed`); a match
--                     mark (career runs, career wickets, caps) when the
--                     match is verified (match_verified(), R3's one
--                     definition, db/114)
--      source         'ball log', 'scorebook' (an innings_summary card,
--                     db/63) or, for caps, 'team sheet'
--      fixture_class  and no_board: fixture_class() (R3, db/127), as the
--                     owner, which is how db/127 says R4 reads it
--    and of each honour, D3:
--      withdrawn_on   the day it was withdrawn. A withdrawn honour is
--                     returned to three readers only: the pupil himself
--                     (his self-access link, or his own account), his
--                     guardian (is_family_of()), and a holder of
--                     recognition.manage over him (the principal, the
--                     director of sport, the office). Every other reader
--                     still gets no row at all, as before. The reason is
--                     never returned (D4).
--    recognition.decide does not exist yet (R5c adds it, held by the
--    principal and the director, who hold recognition.manage today); D3's
--    "decide or manage" is recognition.manage until it does.
--    A new result shape is a new function, so it is dropped and created in
--    this file's one transaction; its grant is db/116's (scrbrd_app alone).
--
-- 2. The family's sealed notice (D6). A notice to a parent about HER child
--    is written when the mark is sealed, never on the ball: one
--    'recognition' row per live guardian (lift_guardians_of(), db/76's rule:
--    a verified, consented, dated link, and never a pupil), recipient_id the
--    guardian, subject_person_id the child, news.read, urgency medium
--    (NOTIFICATIONS.md D2, D7). The side's live notice (db/08, db/113) is
--    untouched. Nothing is sent to a child alone: a pupil is never a
--    recipient here (and db/57's trigger refuses one). A push is a pointer
--    and names nobody (push-api.mjs buildPayload()).
--    The words are §7's:
--      "Rohan's first fifty" / "63 v DHS · sealed by the scorer, 12 Sep"
--    and, if a correction takes the mark away (milestone_recheck(), db/121),
--    the family's notice is retracted as a correction and the withdrawal
--    says, to her alone:
--      "The fifty noticed for Rohan was withdrawn after the scorecard was corrected."
--    A mark re-reached returns the same rows (D20, Q7): nothing new is sent.
--    Only what the side was told live is told to the family: a mark from a
--    scorebook card (no milestone_notice) and a cap are shown on the card,
--    sealed or not, and are not noticed. A mark that no longer folds at the
--    seal (a fifty that became a hundred) is not noticed: the hundred is.
--    milestone_family_notice is the "once" (per mark, per guardian) and
--    the link to what was said; it holds no figure (§10: no stored score).
--    The moments: an innings_end is written (the seal), a match becomes
--    complete (verified), a mark is first noticed after the seal (a
--    correction), a mark is retracted or returns. Triggers on ball_event,
--    match and milestone_notice; none replaces another.
--
-- ── WHAT IT CHANGES ON A LIVE DATABASE ──────────────────────────────
--   function recognition(uuid)                 dropped and created (shape)
--   table    milestone_family_notice            new; RLS on, no policy, no grant
--   function milestone_seal_at, milestone_source, milestone_side_of,
--            milestone_family_tell, milestone_family_unsay,
--            milestone_family_resay, milestone_family_seal       new
--   triggers milestone_notice_family (milestone_notice),
--            ball_event_milestone_seal (ball_event),
--            match_milestone_verified (match)                    new
-- No capability, role, policy or column on an existing table. No row is
-- written by the paste: a mark sealed before this file is not noticed to the
-- family afterwards (the next seal, or the next mark, is).
--
-- WHO MAY CALL WHAT
--   recognition(uuid)  scrbrd_app (GET /api/read/recognition), as before
--   every other function here: nobody but its owner (the triggers and
--   recognition()); not PUBLIC, not scrbrd_app, not a managed host's anon,
--   authenticated or service_role (db/131's loop).
--
-- THE GUARD keys on pg_proc.prosrc as db/132–db/136 do: the md5 of
-- recognition()'s live body, its whitespace folded, must be db/116's or this
-- file's. Safe to run twice.


-- ── 0 · What this file was written against ─────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._v140_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE v_src text;
BEGIN
  IF to_regclass('milestone_notice') IS NULL OR to_regclass('player_milestone') IS NULL
     OR to_regclass('ball_event_live') IS NULL OR to_regclass('honour') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'milestone_notice'::regclass AND attname = 'notice_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'milestone_notice'::regclass AND attname = 'retracted_at' AND NOT attisdropped)
     OR to_regprocedure('match_verified(uuid)') IS NULL OR to_regprocedure('fixture_class(uuid)') IS NULL
     OR to_regprocedure('match_result_compute(uuid)') IS NULL
     OR to_regprocedure('notification_retract(uuid,text,boolean)') IS NULL
     OR to_regprocedure('notification_unretract(uuid)') IS NULL
     OR to_regprocedure('lift_guardians_of(uuid)') IS NULL
     OR to_regprocedure('is_family_of(uuid)') IS NULL OR to_regprocedure('app_reader_is_pupil()') IS NULL
     OR to_regprocedure('sa_date(timestamptz)') IS NULL OR to_regprocedure('honour_kind_label(text,text)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/140: milestone_notice with notice_id and retracted_at (db/89, db/113), match_verified() (db/114), fixture_class() (db/127), notification_unretract() (db/113), lift_guardians_of() (db/76), sa_date() (db/128) or app_reader_is_pupil() (db/116) is missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('recognition(uuid)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/140: recognition(uuid) (db/116) is not there to replace';
  END IF;
  IF pg_temp._v140_fold(v_src) NOT IN ('3d73c5efcf880d8c78d62c8d13cd5f45', -- db/116's
                                       'e070d3ca32e877ab0999ad81bf7bbc48') -- this file's
  THEN
    RAISE EXCEPTION 'db/140: recognition(uuid) is not db/116''s nor this file''s (md5 % of its folded body); look before replacing it',
      pg_temp._v140_fold(v_src);
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
-- §1 · Where a mark came from
-- ══════════════════════════════════════════════════════════════════
-- Each asks the log as it now stands and stores nothing. Plain functions,
-- search path pinned, run as their caller: recognition() and the definers
-- below, as the owner. Granted to nobody.

-- When the scorer's seal stands for a mark, or NULL. Innings marks: the
-- innings sealed with the seal standing (db/121's match_result_compute()
-- `sealed`: the figures read back at the seal are still the log's); the time
-- is that innings' live innings_end. Match marks: match_verified() (db/114);
-- the time is the match's last live innings_end. The kind says the grain,
-- not the innings: milestone_notice files a career mark under innings 0,
-- which is also the first innings' number.
CREATE OR REPLACE FUNCTION milestone_seal_at(p_match uuid, p_kind text, p_innings smallint)
RETURNS timestamptz AS $$
  SELECT CASE
    WHEN p_kind IN ('fifty', 'hundred', 'five_for', 'hat_trick') THEN
      CASE WHEN EXISTS (SELECT 1 FROM match_result_compute(p_match) r, jsonb_array_elements(r.innings) i
                         WHERE (i->>'innings')::smallint = p_innings AND (i->>'sealed')::boolean IS TRUE)
           THEN (SELECT max(b.server_ts) FROM ball_event_live b
                  WHERE b.match_id = p_match AND b.innings = p_innings AND b.kind = 'innings_end') END
    ELSE
      CASE WHEN match_verified(p_match)
           THEN (SELECT max(b.server_ts) FROM ball_event_live b
                  WHERE b.match_id = p_match AND b.kind = 'innings_end') END
  END
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- 'scorebook' when the innings (a match mark: any innings of the match) is a
-- scorebook card (db/63's innings_summary); 'team sheet' for caps
-- (team_appearance); else 'ball log'.
CREATE OR REPLACE FUNCTION milestone_source(p_match uuid, p_kind text, p_innings smallint)
RETURNS text AS $$
  SELECT CASE
    WHEN p_kind = 'caps' THEN 'team sheet'
    WHEN EXISTS (SELECT 1 FROM ball_event_live b
                  WHERE b.match_id = p_match AND b.kind = 'innings_summary'
                    AND (p_kind NOT IN ('fifty', 'hundred', 'five_for', 'hat_trick') OR b.innings = p_innings))
      THEN 'scorebook'
    ELSE 'ball log' END
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;

-- The side he played for in the match: his appearance on its sheet
-- (team_appearance, db/08), else the end of the match his school is at,
-- else the home side's code. Never player.team_code (a boy moves sides).
CREATE OR REPLACE FUNCTION milestone_side_of(p_match uuid, p_player uuid)
RETURNS text AS $$
  SELECT coalesce(
    (SELECT a.team_code FROM team_appearance a WHERE a.match_id = p_match AND a.player_id = p_player LIMIT 1),
    (SELECT CASE WHEN m.away_school_id IS NOT NULL AND m.away_school_id = p.school_id
                      AND m.school_id IS DISTINCT FROM p.school_id THEN m.away_team_code
                 ELSE m.team_code END
       FROM match m, player p WHERE m.id = p_match AND p.id = p_player))
$$ LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp;


-- ══════════════════════════════════════════════════════════════════
-- §2 · The family's sealed notice (D6), once per mark per guardian
-- ══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS milestone_family_notice (
  player_id   uuid NOT NULL,
  kind        text NOT NULL,
  match_id    uuid NOT NULL,
  innings     smallint NOT NULL,
  guardian_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  notice_id   uuid REFERENCES notification(id) ON DELETE SET NULL,
  told_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, kind, match_id, innings, guardian_id),
  FOREIGN KEY (player_id, kind, match_id, innings)
    REFERENCES milestone_notice (player_id, kind, match_id, innings) ON DELETE CASCADE
);
COMMENT ON TABLE milestone_family_notice IS
  'db/140 (RECOGNITION R4, D6): which guardian was told of which sealed mark, and the notification that told her. The "once"; no figure is kept here. Written by milestone_family_tell() alone; read by nobody but the owner.';
ALTER TABLE milestone_family_notice ENABLE ROW LEVEL SECURITY;

-- The words of one mark, §7's, for the family: his first name, the mark,
-- "first" when he had none of the kind before it, the figure and the side
-- it was against. p_value is the figure that folds now (player_milestone).
CREATE OR REPLACE FUNCTION milestone_family_words(p_player uuid, p_kind text, p_match uuid, p_innings smallint, p_value integer,
                                                  OUT name text, OUT what text, OUT title text, OUT figure text)
AS $$
DECLARE
  p player%ROWTYPE;
  m match%ROWTYPE;
  v_first boolean := false;
BEGIN
  SELECT * INTO p FROM player x WHERE x.id = p_player;
  SELECT * INTO m FROM match x WHERE x.id = p_match;
  -- What his family calls him: known_as; else his first name; else, when
  -- the register holds only an initial ("R Pillay"), his name as it stands.
  name := coalesce(nullif(btrim(p.known_as), ''),
                   CASE WHEN length(replace(split_part(btrim(p.full_name), ' ', 1), '.', '')) > 1
                        THEN split_part(btrim(p.full_name), ' ', 1) END,
                   btrim(p.full_name));
  what := CASE p_kind
    WHEN 'fifty'          THEN 'fifty'
    WHEN 'hundred'        THEN 'hundred'
    WHEN 'five_for'       THEN 'five-for'
    WHEN 'hat_trick'      THEN 'hat-trick'
    WHEN 'career_runs'    THEN p_value || ' career runs'
    WHEN 'career_wickets' THEN p_value || ' career wickets'
    WHEN 'caps'           THEN p_value || ' caps'
    ELSE milestone_label(p_kind, p_value) END;
  IF p_kind IN ('fifty', 'hundred', 'five_for', 'hat_trick') THEN
    v_first := NOT EXISTS (
      SELECT 1 FROM player_milestone e JOIN match em ON em.id = e.match_id
       WHERE e.player_id = p_player AND e.kind = p_kind
         AND (em.starts_at, e.match_id, coalesce(e.innings, 0)) < (m.starts_at, p_match, p_innings));
  END IF;
  title := name || '''s ' || CASE WHEN v_first THEN 'first ' ELSE '' END || what;
  figure := concat_ws(' ',
    CASE p_kind WHEN 'fifty' THEN p_value::text WHEN 'hundred' THEN p_value::text
                WHEN 'five_for' THEN p_value || ' wickets' END,
    CASE WHEN nullif(btrim(m.opponent), '') IS NOT NULL THEN 'v ' || btrim(m.opponent) END);
END $$ LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp;

-- Tell each live guardian of one mark, if it is noticed, live, folds and is
-- sealed; once. Returns how many were told now.
CREATE OR REPLACE FUNCTION milestone_family_tell(p_player uuid, p_kind text, p_match uuid, p_innings smallint)
RETURNS integer AS $$
DECLARE
  mn milestone_notice%ROWTYPE;
  p  player%ROWTYPE;
  w  record;
  v_at timestamptz;
  v_value integer;
  v_body text;
  g uuid;
  v_id uuid;
  n integer := 0;
BEGIN
  SELECT * INTO mn FROM milestone_notice x
   WHERE x.player_id = p_player AND x.kind = p_kind AND x.match_id = p_match AND x.innings = p_innings;
  IF NOT FOUND OR mn.retracted_at IS NOT NULL THEN RETURN 0; END IF;
  -- The mark as it folds now: a fifty that became a hundred is the hundred's.
  SELECT ms.value INTO v_value FROM player_milestone ms
   WHERE ms.player_id = p_player AND ms.kind = p_kind AND ms.match_id = p_match
     AND coalesce(ms.innings, 0) = p_innings
   LIMIT 1;
  IF v_value IS NULL THEN RETURN 0; END IF;
  v_at := milestone_seal_at(p_match, p_kind, p_innings);
  IF v_at IS NULL THEN RETURN 0; END IF;
  SELECT * INTO p FROM player x WHERE x.id = p_player;
  SELECT * INTO w FROM milestone_family_words(p_player, p_kind, p_match, p_innings, v_value);
  v_body := concat_ws(' · ', nullif(w.figure, ''),
                      'sealed by the scorer, ' || to_char(v_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon'));
  FOR g IN SELECT x.id FROM lift_guardians_of(p_player) AS x(id) ORDER BY 1 LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM milestone_family_notice f
                           WHERE f.player_id = p_player AND f.kind = p_kind AND f.match_id = p_match
                             AND f.innings = p_innings AND f.guardian_id = g);
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, is_public, subject_kind, subject_id, subject_person_id, recipient_id)
    VALUES (p.school_id, p.team_code, CASE WHEN p.team_code IS NULL THEN 'school' ELSE 'team' END,
            'recognition', 'medium', w.title, v_body,
            'news.read', false, 'match', p_match, p_player, g)
    RETURNING id INTO v_id;
    INSERT INTO milestone_family_notice (player_id, kind, match_id, innings, guardian_id, notice_id)
    VALUES (p_player, p_kind, p_match, p_innings, g, v_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- A correction took the mark away: each family notice of it is taken back
-- as a correction, and the withdrawal says so in the family's words (D20,
-- §7), to the same guardian alone.
CREATE OR REPLACE FUNCTION milestone_family_unsay(p_player uuid, p_kind text, p_match uuid, p_innings smallint, p_value integer)
RETURNS integer AS $$
DECLARE
  f record;
  w record;
  v_said uuid;
  n integer := 0;
BEGIN
  SELECT * INTO w FROM milestone_family_words(p_player, p_kind, p_match, p_innings, p_value);
  FOR f IN SELECT x.notice_id FROM milestone_family_notice x
            JOIN notification t ON t.id = x.notice_id AND t.retracted_at IS NULL
           WHERE x.player_id = p_player AND x.kind = p_kind AND x.match_id = p_match AND x.innings = p_innings
           ORDER BY x.guardian_id LOOP
    v_said := notification_retract(f.notice_id, 'correction', true);
    IF v_said IS NOT NULL THEN
      UPDATE notification
         SET body = 'The ' || CASE WHEN p_kind IN ('career_runs', 'career_wickets', 'caps') THEN 'mark of ' ELSE '' END
                    || w.what || ' noticed for ' || w.name || ' was withdrawn after the scorecard was corrected.'
       WHERE id = v_said;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- The mark holds again (D20, Q7): the same rows return, their words
-- re-synced to what folds now, and nothing new is sent. A mark the family
-- was never told of is told now, if it is sealed.
CREATE OR REPLACE FUNCTION milestone_family_resay(p_player uuid, p_kind text, p_match uuid, p_innings smallint)
RETURNS integer AS $$
DECLARE
  f record;
  w record;
  v_value integer;
  v_at timestamptz;
  n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM milestone_family_notice x
                  WHERE x.player_id = p_player AND x.kind = p_kind AND x.match_id = p_match AND x.innings = p_innings) THEN
    RETURN milestone_family_tell(p_player, p_kind, p_match, p_innings);
  END IF;
  SELECT ms.value INTO v_value FROM player_milestone ms
   WHERE ms.player_id = p_player AND ms.kind = p_kind AND ms.match_id = p_match AND coalesce(ms.innings, 0) = p_innings
   LIMIT 1;
  v_at := milestone_seal_at(p_match, p_kind, p_innings);
  FOR f IN SELECT x.notice_id FROM milestone_family_notice x
           WHERE x.player_id = p_player AND x.kind = p_kind AND x.match_id = p_match AND x.innings = p_innings
             AND x.notice_id IS NOT NULL
           ORDER BY x.guardian_id LOOP
    IF notification_unretract(f.notice_id) AND v_value IS NOT NULL AND v_at IS NOT NULL THEN
      SELECT * INTO w FROM milestone_family_words(p_player, p_kind, p_match, p_innings, v_value);
      UPDATE notification
         SET title = w.title,
             body = concat_ws(' · ', nullif(w.figure, ''),
                              'sealed by the scorer, ' || to_char(v_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD Mon'))
       WHERE id = f.notice_id;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- Every live mark of a match, told if it is sealed now.
CREATE OR REPLACE FUNCTION milestone_family_seal(p_match uuid) RETURNS integer AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT mn.player_id, mn.kind, mn.innings FROM milestone_notice mn
            WHERE mn.match_id = p_match AND mn.retracted_at IS NULL
            ORDER BY mn.noticed_at, mn.kind, mn.player_id LOOP
    n := n + milestone_family_tell(r.player_id, r.kind, p_match, r.innings);
  END LOOP;
  RETURN n;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── The moments ────────────────────────────────────────────────────
-- A mark noticed, retracted or returned (milestone_notify_as(), db/113;
-- milestone_recheck(), db/121): its family follows.
CREATE OR REPLACE FUNCTION milestone_notice_family() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM milestone_family_tell(NEW.player_id, NEW.kind, NEW.match_id, NEW.innings);
  ELSIF OLD.retracted_at IS NULL AND NEW.retracted_at IS NOT NULL THEN
    PERFORM milestone_family_unsay(NEW.player_id, NEW.kind, NEW.match_id, NEW.innings, NEW.value);
  ELSIF OLD.retracted_at IS NOT NULL AND NEW.retracted_at IS NULL THEN
    PERFORM milestone_family_resay(NEW.player_id, NEW.kind, NEW.match_id, NEW.innings);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS milestone_notice_family ON milestone_notice;
CREATE TRIGGER milestone_notice_family AFTER INSERT OR UPDATE OF retracted_at ON milestone_notice
  FOR EACH ROW EXECUTE FUNCTION milestone_notice_family();

-- The scorer's seal (an innings_end) and the match's verification (its
-- status becoming complete): the marks they settle are told.
CREATE OR REPLACE FUNCTION milestone_seal_watch() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'ball_event' THEN
    PERFORM milestone_family_seal(NEW.match_id);
  ELSE
    PERFORM milestone_family_seal(NEW.id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS ball_event_milestone_seal ON ball_event;
CREATE TRIGGER ball_event_milestone_seal AFTER INSERT ON ball_event
  FOR EACH ROW WHEN (NEW.kind = 'innings_end')
  EXECUTE FUNCTION milestone_seal_watch();

DROP TRIGGER IF EXISTS match_milestone_verified ON match;
CREATE TRIGGER match_milestone_verified AFTER UPDATE OF status ON match
  FOR EACH ROW WHEN (NEW.status = 'complete' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION milestone_seal_watch();


-- ══════════════════════════════════════════════════════════════════
-- §3 · recognition(): where each mark came from; a withdrawn honour to three
-- ══════════════════════════════════════════════════════════════════
-- db/116's gate, its three arms and its order, unchanged; seven columns
-- added at the end. Each match's fold is asked once (the CTEs are
-- materialised), however many marks he made in it.
DROP FUNCTION IF EXISTS recognition(uuid);
CREATE FUNCTION recognition(p_player uuid)
RETURNS TABLE (family text, kind text, label text, value int, season text, on_date date,
               match_id uuid, opponent text, is_public boolean, citation text, ref_id uuid,
               withdrawn_on date, side_code text, innings smallint, sealed_on date, source text,
               fixture_class text, no_board text) AS $$
DECLARE v_own boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM player p WHERE p.id = p_player
                    AND app_can('player.profile.read', p.school_id, p.team_code, p.id,
                                '00000000-0000-0000-0000-000000000000'::uuid)
                    -- READERS Q13: a pupil, through a standing assignment only.
                    AND (NOT app_reader_is_pupil()
                         OR app_can('player.profile.read', p.school_id, p.team_code, p.id, NULL::uuid))) THEN
    RETURN;
  END IF;
  -- D3: the pupil himself (his self-access link, or his own account) and his
  -- guardian read a withdrawn honour; so does recognition.manage over him.
  v_own := is_family_of(p_player)
           OR EXISTS (SELECT 1 FROM app_user u WHERE u.id = app_user_id() AND u.player_id = p_player);
  RETURN QUERY
    WITH ms AS MATERIALIZED (
      SELECT x.kind, x.value, x.match_id, x.innings, x.opponent, x.played_on
        FROM player_milestone x WHERE x.player_id = p_player
         AND NOT EXISTS (SELECT 1 FROM milestone_notice mn
                          WHERE mn.player_id = x.player_id AND mn.kind = x.kind AND mn.match_id = x.match_id
                            AND mn.innings = coalesce(x.innings, 0) AND mn.retracted_at IS NOT NULL)),
    mx AS MATERIALIZED (
      SELECT d.match_id, f.fixture_class, f.no_board, milestone_side_of(d.match_id, p_player) AS side_code
        FROM (SELECT DISTINCT ms.match_id FROM ms) d
        LEFT JOIN LATERAL fixture_class(d.match_id) f ON true),
    sx AS MATERIALIZED (
      SELECT g.match_id, g.grain, g.innings,
             sa_date(milestone_seal_at(g.match_id, g.grain, g.innings)) AS sealed_on,
             milestone_source(g.match_id, g.grain, g.innings) AS source
        FROM (SELECT DISTINCT ms.match_id,
                     CASE WHEN ms.kind IN ('fifty', 'hundred', 'five_for', 'hat_trick') THEN 'fifty'
                          WHEN ms.kind = 'caps' THEN 'caps' ELSE 'career_runs' END AS grain,
                     coalesce(ms.innings, 0)::smallint AS innings
                FROM ms) g)
    SELECT 'honour'::text, h.kind, honour_kind_label(h.kind, h.name), NULL::int, (SELECT sn.label FROM season sn WHERE sn.id = h.season_id), h.awarded_on,
           NULL::uuid, NULL::text, h.is_public, h.citation, h.id,
           sa_date(h.withdrawn_at), h.team_code, NULL::smallint, NULL::date, NULL::text, NULL::text, NULL::text
      FROM honour h WHERE h.player_id = p_player
       AND (h.withdrawn_at IS NULL OR v_own
            OR app_can('recognition.manage', h.school_id, coalesce(h.team_code, '*'), h.player_id, NULL::uuid))
    UNION ALL
    SELECT 'cap', 'cap', c.team_code || ' cap ' || CASE WHEN c.baseline_set THEN '#' || c.cap_no ELSE '#' || c.cap_no || ' (no baseline set)' END
             || ' · ' || c.appearances || ' appearance' || CASE WHEN c.appearances = 1 THEN '' ELSE 's' END,
           c.cap_no, NULL, c.first_on, c.first_match_id, NULL, false, NULL, NULL,
           NULL::date, c.team_code, NULL::smallint, NULL::date, 'team sheet', NULL::text, NULL::text
      FROM team_cap c WHERE c.player_id = p_player
    UNION ALL
    SELECT 'milestone', ms.kind, milestone_label(ms.kind, ms.value), ms.value, NULL, ms.played_on,
           ms.match_id, ms.opponent, false, NULL, NULL,
           NULL::date, mx.side_code, ms.innings, sx.sealed_on, sx.source, mx.fixture_class, mx.no_board
      FROM ms
      JOIN mx ON mx.match_id = ms.match_id
      JOIN sx ON sx.match_id = ms.match_id AND sx.innings = coalesce(ms.innings, 0)
             AND sx.grain = CASE WHEN ms.kind IN ('fifty', 'hundred', 'five_for', 'hat_trick') THEN 'fifty'
                                 WHEN ms.kind = 'caps' THEN 'caps' ELSE 'career_runs' END
    ORDER BY 6 DESC NULLS LAST, 1;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION recognition(uuid) IS
  'db/140 (RECOGNITION R4): a boy''s honours, caps and milestones under player.profile.read on him. A milestone says where it came from (side_code, innings, sealed_on, source, fixture_class, no_board); a withdrawn honour is returned, with withdrawn_on and never its reason, to the pupil, his guardian and recognition.manage over him only (D3).';


-- ══════════════════════════════════════════════════════════════════
-- §4 · Who may call what
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  -- recognition(): db/116's grant, restated on the new function.
  REVOKE ALL ON FUNCTION recognition(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION recognition(uuid) TO scrbrd_app;
  -- The rest: nobody's but the owner's.
  FOREACH f IN ARRAY ARRAY['milestone_seal_at(uuid,text,smallint)', 'milestone_source(uuid,text,smallint)',
                           'milestone_side_of(uuid,uuid)',
                           'milestone_family_words(uuid,text,uuid,smallint,integer)',
                           'milestone_family_tell(uuid,text,uuid,smallint)',
                           'milestone_family_unsay(uuid,text,uuid,smallint,integer)',
                           'milestone_family_resay(uuid,text,uuid,smallint)',
                           'milestone_family_seal(uuid)', 'milestone_notice_family()', 'milestone_seal_watch()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM scrbrd_app', f);
  END LOOP;
  REVOKE ALL ON milestone_family_notice FROM PUBLIC;
  REVOKE ALL ON milestone_family_notice FROM scrbrd_app;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION recognition(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON milestone_family_notice FROM %I', r);
      FOREACH f IN ARRAY ARRAY['milestone_seal_at(uuid,text,smallint)', 'milestone_source(uuid,text,smallint)',
                               'milestone_side_of(uuid,uuid)',
                               'milestone_family_words(uuid,text,uuid,smallint,integer)',
                               'milestone_family_tell(uuid,text,uuid,smallint)',
                               'milestone_family_unsay(uuid,text,uuid,smallint,integer)',
                               'milestone_family_resay(uuid,text,uuid,smallint)',
                               'milestone_family_seal(uuid)', 'milestone_notice_family()', 'milestone_seal_watch()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;


-- ══════════════════════════════════════════════════════════════════
-- §5 · Refuse to commit a file that did not do what it says
-- ══════════════════════════════════════════════════════════════════
DO $check$
DECLARE f text;
BEGIN
  IF pg_get_function_result('recognition(uuid)'::regprocedure) <>
     'TABLE(family text, kind text, label text, value integer, season text, on_date date, match_id uuid, opponent text, is_public boolean, citation text, ref_id uuid, withdrawn_on date, side_code text, innings smallint, sealed_on date, source text, fixture_class text, no_board text)' THEN
    RAISE EXCEPTION 'db/140: recognition() does not return the shape this file gives it: %', pg_get_function_result('recognition(uuid)'::regprocedure);
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'recognition(uuid)'::regprocedure) LIKE '%withdrawn_reason%' THEN
    RAISE EXCEPTION 'db/140: recognition() reads withdrawn_reason (D4)';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'recognition(uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                 WHERE p.oid = 'recognition(uuid)'::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'db/140: recognition() is PUBLIC''s, or not the application''s';
  END IF;
  FOREACH f IN ARRAY ARRAY['recognition(uuid)', 'milestone_family_tell(uuid,text,uuid,smallint)',
                           'milestone_family_unsay(uuid,text,uuid,smallint,integer)',
                           'milestone_family_resay(uuid,text,uuid,smallint)', 'milestone_family_seal(uuid)',
                           'milestone_notice_family()', 'milestone_seal_watch()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure AND prosecdef
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/140: % is not SECURITY DEFINER with a pinned search_path', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['milestone_seal_at(uuid,text,smallint)', 'milestone_source(uuid,text,smallint)',
                           'milestone_side_of(uuid,uuid)', 'milestone_family_words(uuid,text,uuid,smallint,integer)',
                           'milestone_family_tell(uuid,text,uuid,smallint)',
                           'milestone_family_unsay(uuid,text,uuid,smallint,integer)',
                           'milestone_family_resay(uuid,text,uuid,smallint)', 'milestone_family_seal(uuid)',
                           'milestone_notice_family()', 'milestone_seal_watch()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/140: % has no pinned search_path', f;
    END IF;
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                   WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/140: % is callable by PUBLIC or the application', f;
    END IF;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'milestone_family_notice'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'milestone_family_notice'::regclass)
     OR has_table_privilege('scrbrd_app', 'milestone_family_notice', 'SELECT')
     OR has_table_privilege('scrbrd_app', 'milestone_family_notice', 'INSERT') THEN
    RAISE EXCEPTION 'db/140: milestone_family_notice is readable or writable by the application';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'D'
        AND ((tgrelid = 'milestone_notice'::regclass AND tgname = 'milestone_notice_family')
             OR (tgrelid = 'ball_event'::regclass AND tgname = 'ball_event_milestone_seal')
             OR (tgrelid = 'match'::regclass AND tgname = 'match_milestone_verified'))) <> 3 THEN
    RAISE EXCEPTION 'db/140: a trigger that tells the family at the seal is missing or disabled';
  END IF;
  -- The ball's own path is untouched: the family is never told on the ball.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'milestone_notify_as(uuid,text,uuid,smallint,integer,boolean)'::regprocedure)
       LIKE '%recipient_id%' THEN
    RAISE EXCEPTION 'db/140: milestone_notify_as() writes to one person: the ball must not tell a family';
  END IF;
END $check$;
