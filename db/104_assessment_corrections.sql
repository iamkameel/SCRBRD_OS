-- ══════════════════════════════════════════════════════════════════
--  104 · Corrections to a coach's judgement, and the coaching point
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: columns, two triggers, three RESTRICTIVE cuts, one
-- RESTRICTIVE insert rule and four functions. The design is
-- docs/design/GA-I26a_assessment_history.md (slice A1; AH-D2, AH-D3, AH-D5,
-- decided by Kameel on 15 Oct as recommended). Its proof is db/99 §81; the
-- API walk is tools/smoke-assessment-history.mjs.
--
-- WHAT WAS WRONG
--
--   1. A colleague's same-day re-rating took the authorship. player_skill's
--      UPDATE policy admits every player.development.write holder of the
--      boy's side (db/09), and the API's upsert set
--      `assessed_by = excluded.assessed_by` on conflict. So a second coach
--      who rated D Erasmus's footwork on the day the first did overwrote the
--      number AND the name: the record said the second coach had judged
--      what the first had. GA-I36's rule is both versions kept.
--   2. A wrong score could not be taken back except by overwriting it, and a
--      wrong note not at all.
--   3. I27's coaching point (C-D4) was drawn as its own table under
--      player.development.read, which `selfaccess` holds: the boy would have
--      read every point written about him. AH-D2 puts the point on
--      development_note instead, whose reader is player.note.read (coach,
--      assistant, director, principal; not the boy, not his parents).
--
-- WHAT CHANGES
--
--   player_skill
--     + withdrawn_at, withdrawn_by, withdrawn_reason (<= 200), whole or none
--     the UNIQUE (player, day, category, metric) becomes a partial unique
--       index over STANDING rows, so a withdrawn score does not hold its slot:
--       "rated the wrong boy", withdrawn, is re-rated the same day
--     + trigger player_skill_revision(): the assessor is stamped on insert
--       and never changes hands; a score is revised only by the coach who gave
--       it (45003 for anybody else, whatever he changes); a withdrawn score is
--       not revised (45004); a withdrawal (only the three columns) is stamped
--       with who and when, by any holder the policy or skill_withdraw() admits
--     + RESTRICTIVE player_skill_not_support: never under a support session
--   development_note
--     + the pointer: match_id, evidence_rule, evidence_read, evidence_params,
--       evidence_head, evidence_as_of, evidence_text (S2a/S5 only); a
--       COACHING POINT is a note with evidence_read set
--     + withdrawn_at, withdrawn_by, whole or none
--     development_note_author() replaced: as before for a plain note (its
--       author edits it, 45001 for anybody else), and: a point is withdrawn,
--       not edited (45002); a plain note never gains a pointer by an edit
--       (45002); a withdrawn note is not revised (45004); a withdrawal (only
--       the two columns) is stamped, by any holder of player.note.write for
--       the side — a departed coach's point must be withdrawable by the coach
--       who follows him
--     + RESTRICTIVE development_note_plain_insert: the application inserts a
--       plain note only; a pointer or a withdrawal is written by the functions
--     + RESTRICTIVE development_note_not_support and _not_platform: never
--       under a support session, never by a platform-wide assignment (I27 §6:
--       no superadmin read of a point's body; the point is now a note)
--   functions (SECURITY DEFINER, pinned path, scrbrd_app only)
--     coaching_point_write(player, match, body, evidence jsonb)
--     skill_withdraw(id, reason)
--     note_withdraw(id)
--     coaching_point_never(text)   the SQL copy of NEVER_ON_THE_COCKPIT,
--                                  internal (apps/web/test/coachingPoint.test.mjs
--                                  holds the two lists together)
--
-- WHAT IT DOES TO A LIVE DATABASE
--   Adds nullable columns (no rewrite), replaces one unique constraint with a
--   partial unique index over the same columns (every existing row is
--   standing, so it builds on the rows the constraint already held unique),
--   replaces one trigger function, adds one trigger, five policies and four
--   functions. No row is changed. Locks player_skill and development_note for
--   the length of each statement; paste outside a coaching session.
--   A second paste changes nothing: IF NOT EXISTS, DROP … IF EXISTS, CREATE
--   OR REPLACE throughout.


-- ── 1 · player_skill: a score is withdrawn, never overwritten by another ──
ALTER TABLE player_skill
  ADD COLUMN IF NOT EXISTS withdrawn_at     timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_by     uuid REFERENCES app_user(id),
  ADD COLUMN IF NOT EXISTS withdrawn_reason text;

DO $skill_constraints$
DECLARE c text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'player_skill'::regclass
                    AND conname = 'player_skill_withdrawn_whole') THEN
    ALTER TABLE player_skill ADD CONSTRAINT player_skill_withdrawn_whole
      CHECK (withdrawn_at IS NULL OR withdrawn_by IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'player_skill'::regclass
                    AND conname = 'player_skill_withdrawn_reason_short') THEN
    ALTER TABLE player_skill ADD CONSTRAINT player_skill_withdrawn_reason_short
      CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) <= 200);
  END IF;
  -- db/08's UNIQUE (player_id, assessed_on, category, metric), by its
  -- columns rather than its generated name.
  FOR c IN SELECT con.conname FROM pg_constraint con
            WHERE con.conrelid = 'player_skill'::regclass AND con.contype = 'u'
              AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
                     FROM unnest(con.conkey) k JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k)
                  = ARRAY['assessed_on', 'category', 'metric', 'player_id'] LOOP
    EXECUTE format('ALTER TABLE player_skill DROP CONSTRAINT %I', c);
  END LOOP;
END $skill_constraints$;

-- The same key, over the rows that stand. The API's upsert names it:
-- ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS player_skill_standing
  ON player_skill (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL;

/**
 * Who gave a score keeps it.
 *
 * INSERT: the assessor is whoever is writing (as development_note's author
 * is), and a score is written standing.
 * UPDATE, in this order:
 *   - a withdrawn score is not revised, not even un-withdrawn (45004);
 *   - a change to nothing but the three withdrawal columns is a withdrawal:
 *     any holder the UPDATE policy or skill_withdraw() admitted makes it,
 *     and it is stamped with who and when here, never taken from the caller;
 *   - anything else is a revision, and only the coach who gave the score
 *     makes one (45003) — "rate it yourself, on your own row". A colleague's
 *     upsert onto the same day's row is refused whatever it changes.
 * app_user_id() NULL (the owner: a migration, the seed) is not a person and
 * is not checked, as development_note_author() does not check it.
 */
CREATE OR REPLACE FUNCTION player_skill_revision() RETURNS trigger AS $$
DECLARE
  v_me uuid := app_user_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.withdrawn_at IS NOT NULL OR NEW.withdrawn_by IS NOT NULL OR NEW.withdrawn_reason IS NOT NULL THEN
      RAISE EXCEPTION 'a score is written standing; it is withdrawn afterwards' USING ERRCODE = '23514';
    END IF;
    NEW.assessed_by := coalesce(v_me, NEW.assessed_by);
    RETURN NEW;
  END IF;

  IF OLD.withdrawn_at IS NOT NULL THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'a withdrawn score is not revised' USING ERRCODE = '45004';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_reason')
     = (to_jsonb(OLD) - 'withdrawn_at' - 'withdrawn_by' - 'withdrawn_reason') THEN
    IF NEW.withdrawn_at IS NOT NULL OR NEW.withdrawn_by IS NOT NULL OR NEW.withdrawn_reason IS NOT NULL THEN
      NEW.withdrawn_at := now();
      NEW.withdrawn_by := coalesce(v_me, NEW.withdrawn_by);
    END IF;
    RETURN NEW;
  END IF;

  IF v_me IS NOT NULL AND OLD.assessed_by IS DISTINCT FROM v_me THEN
    -- Class 45, as development_note_author()'s 45001: distinct from 42501
    -- (row security: "not your player") because "not your score" has a
    -- different fix. Mapped in services/api/write/assessment-api.mjs.
    RAISE EXCEPTION 'rate it yourself on your own row' USING ERRCODE = '45003';
  END IF;
  NEW.assessed_by := OLD.assessed_by;      -- authorship never changes hands
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS player_skill_keeps_its_assessor ON player_skill;
CREATE TRIGGER player_skill_keeps_its_assessor
  BEFORE INSERT OR UPDATE ON player_skill
  FOR EACH ROW EXECUTE FUNCTION player_skill_revision();

-- Never under a support session at the boy's school, whatever role it
-- borrowed: a score is a coach's judgement of a named child (PUBLIC_DATA N5)
-- and no support ticket needs it (AH-D3). For every command: a support
-- session writes none either. db/60's shape.
DROP POLICY IF EXISTS player_skill_not_support ON player_skill;
CREATE POLICY player_skill_not_support ON player_skill AS RESTRICTIVE FOR ALL
  USING (app_support_access_id(player_school(player_skill.player_id)) IS NULL)
  WITH CHECK (app_support_access_id(player_school(player_skill.player_id)) IS NULL);


-- ── 2 · development_note: the coaching point's pointer, and withdrawal ──
ALTER TABLE development_note
  ADD COLUMN IF NOT EXISTS match_id        uuid REFERENCES match(id),
  ADD COLUMN IF NOT EXISTS evidence_rule   text,
  ADD COLUMN IF NOT EXISTS evidence_read   text,
  ADD COLUMN IF NOT EXISTS evidence_params jsonb,
  ADD COLUMN IF NOT EXISTS evidence_head   int,
  ADD COLUMN IF NOT EXISTS evidence_as_of  timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_text   text[],
  ADD COLUMN IF NOT EXISTS withdrawn_at    timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_by    uuid REFERENCES app_user(id);

DO $note_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'development_note'::regclass
                    AND conname = 'note_evidence_rule_known') THEN
    ALTER TABLE development_note ADD CONSTRAINT note_evidence_rule_known
      CHECK (evidence_rule IS NULL OR evidence_rule IN ('S2a', 'S2b', 'S2c', 'S5', 'S11'));
  END IF;
  -- The card's lines are copied only where the card's capability is the
  -- reader's own (I27 C-D4): S2a and S5.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'development_note'::regclass
                    AND conname = 'note_evidence_text_tier') THEN
    ALTER TABLE development_note ADD CONSTRAINT note_evidence_text_tier
      CHECK (evidence_text IS NULL OR evidence_rule IN ('S2a', 'S5'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'development_note'::regclass
                    AND conname = 'note_evidence_whole') THEN
    ALTER TABLE development_note ADD CONSTRAINT note_evidence_whole
      CHECK (evidence_read IS NULL OR evidence_as_of IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'development_note'::regclass
                    AND conname = 'note_withdrawn_whole') THEN
    ALTER TABLE development_note ADD CONSTRAINT note_withdrawn_whole
      CHECK (withdrawn_at IS NULL OR withdrawn_by IS NOT NULL);
  END IF;
END $note_constraints$;

/**
 * The author is whoever is writing; a plain note is its author's to edit; a
 * coaching point is withdrawn, not edited; a withdrawn note stands as it was.
 *
 * Replaces db/08's function under the same name and trigger. A plain note
 * behaves exactly as before (reviseNote and its 45001), with three additions:
 *   - a withdrawn note is not revised (45004);
 *   - a change to nothing but withdrawn_at/withdrawn_by is a withdrawal,
 *     stamped here, by any holder the UPDATE policy or note_withdraw()
 *     admitted, and is not an edit (updated_at keeps its value);
 *   - a coaching point (evidence_read set) changes in nothing else (45002),
 *     and a plain note gains no pointer by an edit (45002): the pointer is
 *     coaching_point_write()'s to write, after its checks.
 */
CREATE OR REPLACE FUNCTION development_note_author() RETURNS trigger AS $$
DECLARE
  v_me uuid := app_user_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.author_id := coalesce(v_me, NEW.author_id);
    RETURN NEW;
  END IF;

  IF OLD.withdrawn_at IS NOT NULL THEN
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'a withdrawn note is not revised' USING ERRCODE = '45004';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'withdrawn_at' - 'withdrawn_by' - 'updated_at')
     = (to_jsonb(OLD) - 'withdrawn_at' - 'withdrawn_by' - 'updated_at') THEN
    IF NEW.withdrawn_at IS NOT NULL OR NEW.withdrawn_by IS NOT NULL THEN
      NEW.withdrawn_at := now();
      NEW.withdrawn_by := coalesce(v_me, NEW.withdrawn_by);
    END IF;
    NEW.updated_at := OLD.updated_at;    -- a withdrawal is not an edit
    RETURN NEW;
  END IF;

  IF OLD.evidence_read IS NOT NULL THEN
    RAISE EXCEPTION 'a coaching point is withdrawn, not edited' USING ERRCODE = '45002';
  END IF;
  IF (NEW.match_id, NEW.evidence_rule, NEW.evidence_read, NEW.evidence_params, NEW.evidence_head,
      NEW.evidence_as_of, NEW.evidence_text)
     IS DISTINCT FROM
     (OLD.match_id, OLD.evidence_rule, OLD.evidence_read, OLD.evidence_params, OLD.evidence_head,
      OLD.evidence_as_of, OLD.evidence_text) THEN
    RAISE EXCEPTION 'a coaching point is written through coaching_point_write(), not by an edit' USING ERRCODE = '45002';
  END IF;

  -- A colleague who coaches the same side holds player.note.write and can
  -- therefore reach this row through the policy. That is right for writing
  -- their OWN note and wrong for editing mine (db/08).
  IF v_me IS NOT NULL AND OLD.author_id <> v_me THEN
    RAISE EXCEPTION 'a development note may only be edited by the coach who wrote it'
      USING ERRCODE = '45001';
  END IF;
  NEW.author_id := OLD.author_id;      -- authorship never changes hands
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS development_note_records_its_author ON development_note;
CREATE TRIGGER development_note_records_its_author
  BEFORE INSERT OR UPDATE ON development_note
  FOR EACH ROW EXECUTE FUNCTION development_note_author();

-- The application inserts a plain note and nothing else: a pointer is
-- written by coaching_point_write() (which checks the coach's own write and
-- the words), a withdrawal by note_withdraw() or an update. Definers run as
-- the table's owner and are not held by this.
DROP POLICY IF EXISTS development_note_plain_insert ON development_note;
CREATE POLICY development_note_plain_insert ON development_note AS RESTRICTIVE FOR INSERT
  WITH CHECK (match_id IS NULL AND evidence_rule IS NULL AND evidence_read IS NULL
              AND evidence_params IS NULL AND evidence_head IS NULL AND evidence_as_of IS NULL
              AND evidence_text IS NULL AND withdrawn_at IS NULL AND withdrawn_by IS NULL);

-- Never under a support session at the boy's school, and never by anybody
-- holding a platform-wide assignment: a note is a coach's candid writing about
-- a child, a coaching point is one, and I27 §6 admits no superadmin read of
-- its body. db/57's shape for a concern.
DROP POLICY IF EXISTS development_note_not_support ON development_note;
CREATE POLICY development_note_not_support ON development_note AS RESTRICTIVE FOR ALL
  USING (app_support_access_id(development_note.school_id) IS NULL)
  WITH CHECK (app_support_access_id(development_note.school_id) IS NULL);
DROP POLICY IF EXISTS development_note_not_platform ON development_note;
CREATE POLICY development_note_not_platform ON development_note AS RESTRICTIVE FOR ALL
  USING (NOT app_is_platform_wide())
  WITH CHECK (NOT app_is_platform_wide());


-- ── 3 · The words a coaching point refuses ─────────────────────────
/**
 * The SQL copy of NEVER_ON_THE_COCKPIT (apps/web/src/lib/cockpitNever.js).
 * Postgres's word boundary is \y where JavaScript's is \b; otherwise the
 * pattern is the same text, and apps/web/test/coachingPoint.test.mjs fails the
 * day the two differ. Internal: called by coaching_point_write() as the owner.
 */
CREATE OR REPLACE FUNCTION coaching_point_never(p_body text) RETURNS boolean AS $$
  SELECT coalesce(p_body, '') ~* '\yrisk\y|danger|unsafe|wellness|check-?in|soreness|\yflag\y|guideline|hamstring|shoulder|fracture|sprain|strain|concussion|tendon|impingement|grade [123]|ewma|\yacwr\y|\yratio\y|diagnos|win chance|chance of winning|probab|threat|pressure|\d\s?%'
$$ LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION coaching_point_never(text) FROM PUBLIC;


-- ── 4 · Writing a coaching point ───────────────────────────────────
/**
 * One sentence, at most 500 characters, about one boy, pinned to what the
 * coach saw (I27 §6, moved onto the note by AH-D2).
 *
 * The writer holds BOTH player.note.write and player.development.write for
 * the boy's current side: note.write alone would admit the assistant and the
 * director, and C-D4 chose the coach. Not under a support session.
 *
 * p_evidence: { read, asOf?, rule?, params?, head?, text? }. `read` is
 * required (that is what makes a note a point). For read = 'skills',
 * params.skillId names a player_skill row of THIS boy, and asOf defaults to
 * that row's day at midnight in Johannesburg; otherwise asOf is required.
 * params.batterId / params.playerId, where given, are this boy.
 *
 * Refuses, with a reason: not_permitted; no_such_player; body_length;
 * forbidden_word (NEVER_ON_THE_COCKPIT); names_another_boy (a full name from
 * the fixture's sheet, or from his own side's roster: a point never names
 * two boys); no_such_match; evidence_required; evidence_names_another_boy;
 * evidence_not_his (a skill row of another boy, or none); evidence_as_of_required.
 * evidence_text with a rule other than S2a/S5 is refused by the column's
 * CHECK (23514), as the design proves it.
 *
 * Inserts with observed_on today, about_discipline and adjustment NULL: a
 * point never moves a rating.
 */
CREATE OR REPLACE FUNCTION coaching_point_write(p_player uuid, p_match uuid, p_body text, p_evidence jsonb)
RETURNS TABLE (ok boolean, reason text, id uuid) AS $$
DECLARE
  v_me     uuid := app_user_id();
  ZERO     uuid := '00000000-0000-0000-0000-000000000000';
  p        player%ROWTYPE;
  v_body   text := btrim(coalesce(p_body, ''));
  v_read   text := nullif(btrim(coalesce(p_evidence->>'read', '')), '');
  v_params jsonb := p_evidence->'params';
  v_asof   timestamptz;
  v_skill  uuid;
  v_text   text[];
  v_id     uuid;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN;
  END IF;
  SELECT * INTO p FROM player WHERE player.id = p_player;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_such_player'::text, NULL::uuid; RETURN;
  END IF;
  IF app_support_access_id(p.school_id) IS NOT NULL
     OR app_is_platform_wide()
     OR NOT app_can('player.note.write', p.school_id, p.team_code, p.id, ZERO)
     OR NOT app_can('player.development.write', p.school_id, p.team_code, p.id, ZERO) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::uuid; RETURN;
  END IF;

  IF length(v_body) < 1 OR length(v_body) > 500 THEN
    RETURN QUERY SELECT false, 'body_length'::text, NULL::uuid; RETURN;
  END IF;
  IF coaching_point_never(v_body) THEN
    RETURN QUERY SELECT false, 'forbidden_word'::text, NULL::uuid; RETURN;
  END IF;
  IF p_match IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM match m WHERE m.id = p_match
          AND (m.school_id = p.school_id OR m.away_school_id = p.school_id)) THEN
    RETURN QUERY SELECT false, 'no_such_match'::text, NULL::uuid; RETURN;
  END IF;
  -- A second boy, named in full (a name with a space in it: an initial and a
  -- surname, never a lone word that might sit inside another): on the
  -- fixture's sheet (either side), or on his own side's roster.
  IF EXISTS (SELECT 1 FROM match_squad s JOIN player o ON o.id = s.player_id
              WHERE s.match_id = p_match AND o.id <> p.id
                AND length(btrim(o.full_name)) >= 3 AND btrim(o.full_name) ~ '\s'
                AND position(lower(btrim(o.full_name)) IN lower(v_body)) > 0)
     OR EXISTS (SELECT 1 FROM player o
                 WHERE o.school_id = p.school_id AND o.team_code = p.team_code AND o.id <> p.id
                   AND length(btrim(o.full_name)) >= 3 AND btrim(o.full_name) ~ '\s'
                   AND position(lower(btrim(o.full_name)) IN lower(v_body)) > 0) THEN
    RETURN QUERY SELECT false, 'names_another_boy'::text, NULL::uuid; RETURN;
  END IF;

  IF v_read IS NULL OR v_read !~ '^[a-z][a-z_]{1,39}$' THEN
    RETURN QUERY SELECT false, 'evidence_required'::text, NULL::uuid; RETURN;
  END IF;
  IF (v_params ? 'batterId' AND v_params->>'batterId' IS DISTINCT FROM p.id::text)
     OR (v_params ? 'playerId' AND v_params->>'playerId' IS DISTINCT FROM p.id::text) THEN
    RETURN QUERY SELECT false, 'evidence_names_another_boy'::text, NULL::uuid; RETURN;
  END IF;
  IF v_read = 'skills' THEN
    BEGIN
      v_skill := (v_params->>'skillId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN v_skill := NULL;
    END;
    SELECT (s.assessed_on::timestamp AT TIME ZONE 'Africa/Johannesburg') INTO v_asof
      FROM player_skill s WHERE s.id = v_skill AND s.player_id = p.id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'evidence_not_his'::text, NULL::uuid; RETURN;
    END IF;
  END IF;
  IF p_evidence ? 'asOf' AND nullif(p_evidence->>'asOf', '') IS NOT NULL THEN
    v_asof := (p_evidence->>'asOf')::timestamptz;
  END IF;
  IF v_asof IS NULL THEN
    RETURN QUERY SELECT false, 'evidence_as_of_required'::text, NULL::uuid; RETURN;
  END IF;
  IF jsonb_typeof(p_evidence->'text') = 'array' THEN
    SELECT array_agg(x) INTO v_text FROM jsonb_array_elements_text(p_evidence->'text') x;
  END IF;

  INSERT INTO development_note (player_id, school_id, author_id, body, about_discipline, adjustment,
                                observed_on, match_id, evidence_rule, evidence_read, evidence_params,
                                evidence_head, evidence_as_of, evidence_text)
  VALUES (p.id, p.school_id, v_me, v_body, NULL, NULL, current_date, p_match,
          nullif(p_evidence->>'rule', ''), v_read, v_params,
          (p_evidence->>'head')::int, v_asof, v_text)
  RETURNING development_note.id INTO v_id;
  RETURN QUERY SELECT true, NULL::text, v_id;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION coaching_point_write(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION coaching_point_write(uuid, uuid, text, jsonb) TO scrbrd_app;


-- ── 5 · Withdrawing a score, and a note ────────────────────────────
/**
 * Withdraw a score: any holder of player.development.write for the boy's
 * CURRENT side (the coach who follows a departed one included), with a reason
 * of 1–200 characters. The row stays, with its assessor; `skills` stops
 * returning it, `skills_history` returns it struck. Not under a support
 * session. Refuses not_permitted (no row this person may withdraw — the two
 * are not told apart), reason_required, already_withdrawn.
 */
CREATE OR REPLACE FUNCTION skill_withdraw(p_id uuid, p_reason text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
  ZERO uuid := '00000000-0000-0000-0000-000000000000';
  s    player_skill%ROWTYPE;
  p    player%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  SELECT * INTO s FROM player_skill WHERE player_skill.id = p_id FOR UPDATE;
  IF FOUND THEN SELECT * INTO p FROM player WHERE player.id = s.player_id; END IF;
  IF s.id IS NULL OR p.id IS NULL
     OR app_support_access_id(p.school_id) IS NOT NULL
     OR NOT app_can('player.development.write', p.school_id, p.team_code, p.id, ZERO) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF length(v_reason) < 1 OR length(v_reason) > 200 THEN
    RETURN QUERY SELECT false, 'reason_required'::text; RETURN;
  END IF;
  IF s.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_withdrawn'::text; RETURN;
  END IF;
  -- The trigger stamps who and when.
  UPDATE player_skill SET withdrawn_at = now(), withdrawn_by = v_me, withdrawn_reason = v_reason
   WHERE player_skill.id = s.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION skill_withdraw(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION skill_withdraw(uuid, text) TO scrbrd_app;

/**
 * Withdraw a note or a coaching point: any holder of player.note.write for
 * the boy's CURRENT side. The row stays, struck; withdrawn_at and
 * withdrawn_by are the only columns that change. Not under a support session,
 * nor by a platform-wide assignment. Refuses not_permitted (as above),
 * already_withdrawn.
 */
CREATE OR REPLACE FUNCTION note_withdraw(p_id uuid)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
  ZERO uuid := '00000000-0000-0000-0000-000000000000';
  n    development_note%ROWTYPE;
  v_team text;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  SELECT * INTO n FROM development_note WHERE development_note.id = p_id FOR UPDATE;
  IF FOUND THEN SELECT pl.team_code INTO v_team FROM player pl WHERE pl.id = n.player_id; END IF;
  IF n.id IS NULL
     OR app_support_access_id(n.school_id) IS NOT NULL
     OR app_is_platform_wide()
     OR NOT app_can('player.note.write', n.school_id, v_team, n.player_id, ZERO) THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  IF n.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_withdrawn'::text; RETURN;
  END IF;
  UPDATE development_note SET withdrawn_at = now(), withdrawn_by = v_me WHERE development_note.id = n.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION note_withdraw(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION note_withdraw(uuid) TO scrbrd_app;


-- ── Who may call these: the application, and nobody else ──────────
-- A managed host's API roles get EXECUTE on a new function by default
-- privilege, directly and not through PUBLIC (db/29), so it is taken back.
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['coaching_point_write(uuid,uuid,text,jsonb)', 'skill_withdraw(uuid,text)',
                               'note_withdraw(uuid)', 'coaching_point_never(text)',
                               'player_skill_revision()', 'development_note_author()'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f text;
  n int;
BEGIN
  -- The columns.
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'player_skill'
     AND column_name IN ('withdrawn_at', 'withdrawn_by', 'withdrawn_reason');
  IF n <> 3 THEN RAISE EXCEPTION 'db/104: player_skill has % of its three withdrawal columns', n; END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'development_note'
     AND column_name IN ('match_id', 'evidence_rule', 'evidence_read', 'evidence_params', 'evidence_head',
                         'evidence_as_of', 'evidence_text', 'withdrawn_at', 'withdrawn_by');
  IF n <> 9 THEN RAISE EXCEPTION 'db/104: development_note has % of its nine new columns', n; END IF;
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname IN ('player_skill_withdrawn_whole', 'player_skill_withdrawn_reason_short', 'note_evidence_rule_known',
                     'note_evidence_text_tier', 'note_evidence_whole', 'note_withdrawn_whole') AND contype = 'c';
  IF n <> 6 THEN RAISE EXCEPTION 'db/104: % of the six CHECKs exist', n; END IF;

  -- The standing key: a partial unique index, and no whole-table key beside it.
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('player_skill_standing')
                    AND i.indisunique AND i.indpred IS NOT NULL) THEN
    RAISE EXCEPTION 'db/104: player_skill_standing is not a partial unique index';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'player_skill'::regclass AND contype = 'u') THEN
    RAISE EXCEPTION 'db/104: player_skill still holds a whole-table unique constraint';
  END IF;

  -- The triggers, enabled, on the functions this file wrote.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'player_skill'::regclass
                    AND t.tgname = 'player_skill_keeps_its_assessor' AND t.tgenabled = 'O'
                    AND t.tgfoid = 'player_skill_revision()'::regprocedure) THEN
    RAISE EXCEPTION 'db/104: player_skill_keeps_its_assessor is missing or disabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'development_note'::regclass
                    AND t.tgname = 'development_note_records_its_author' AND t.tgenabled = 'O'
                    AND t.tgfoid = 'development_note_author()'::regprocedure) THEN
    RAISE EXCEPTION 'db/104: development_note_records_its_author is missing or disabled';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'development_note_author()'::regprocedure) NOT LIKE '%45002%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'player_skill_revision()'::regprocedure) NOT LIKE '%45003%' THEN
    RAISE EXCEPTION 'db/104: a trigger function is not the one this file writes';
  END IF;

  -- The cuts: RESTRICTIVE, on the tables named.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
     AND (tablename, policyname, cmd) IN (('player_skill', 'player_skill_not_support', 'ALL'),
                                          ('development_note', 'development_note_not_support', 'ALL'),
                                          ('development_note', 'development_note_not_platform', 'ALL'),
                                          ('development_note', 'development_note_plain_insert', 'INSERT'));
  IF n <> 4 THEN RAISE EXCEPTION 'db/104: % of the four RESTRICTIVE policies exist as written', n; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'player_skill'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'development_note'::regclass) THEN
    RAISE EXCEPTION 'db/104: row security is off on player_skill or development_note';
  END IF;
  -- Still no DELETE: a judgement leaves only by the retention purge.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                AND tablename IN ('player_skill', 'development_note') AND cmd = 'DELETE') THEN
    RAISE EXCEPTION 'db/104: a DELETE policy exists on player_skill or development_note';
  END IF;

  -- The doors: definers with a pinned path, the application's alone.
  FOREACH f IN ARRAY ARRAY['coaching_point_write(uuid,uuid,text,jsonb)', 'skill_withdraw(uuid,text)',
                           'note_withdraw(uuid)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(f) AND prosecdef AND provolatile = 'v'
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/104: % is not a volatile SECURITY DEFINER with a pinned search_path', f;
    END IF;
    IF NOT has_function_privilege('scrbrd_app', to_regprocedure(f), 'EXECUTE') THEN
      RAISE EXCEPTION 'db/104: the application cannot call %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['coaching_point_write(uuid,uuid,text,jsonb)', 'skill_withdraw(uuid,text)',
                           'note_withdraw(uuid)', 'coaching_point_never(text)'] LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = to_regprocedure(f) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/104: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  IF has_function_privilege('scrbrd_app', 'coaching_point_never(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/104: the application can call the internal coaching_point_never';
  END IF;
  -- Both checks in the point's door: the coach's write as well as the note's.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'coaching_point_write(uuid,uuid,text,jsonb)'::regprocedure)
       NOT LIKE '%app_can(''player.note.write''%app_can(''player.development.write''%' THEN
    RAISE EXCEPTION 'db/104: coaching_point_write does not ask both write capabilities';
  END IF;
  -- And the words refuse what they say.
  IF NOT coaching_point_never('a hamstring niggle') OR NOT coaching_point_never('70 %')
     OR coaching_point_never('front foot is late to the pitch') THEN
    RAISE EXCEPTION 'db/104: coaching_point_never does not read as written';
  END IF;
END $check$;
