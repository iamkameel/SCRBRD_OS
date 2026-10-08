-- ══════════════════════════════════════════════════════════════════
--  89 · Notifications S1: the contract and read state
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/NOTIFICATIONS.md (decided, Kameel
-- 2026-10-07: approved as recommended). This file is slice S1's schema: D1,
-- D4, D5 (the closed lists and the contract trigger), D18 (the retraction
-- columns and notification_retract(), which nothing calls yet: S2 and S5 add
-- the callers), D17 (my_notifications, the one view the list and the count
-- read) and D19 (notification_by_id(): a retracted row read as a stub;
-- recognition() and milestone_notice exclude what was retracted). Its proof
-- is db/99 §68.
--
-- NOTHING HERE WIDENS A READ. RLS decides who sees a notice, as before
-- (db/09's generated policy, db/57's recipient cut, db/77's door); the view
-- and the function below run as the caller, under those policies, and only
-- ever take rows away (expired, retracted) or hold a body back (a tiered row's
-- body is read on open, and the open is logged).
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   notification       + retracted_at, retracted_by, retraction_kind, retracts_id
--                      + CHECK notification_kind_known (D1: nine kinds)
--                      ~ the subject_kind CHECK, re-added with 'welfare' and
--                        'news' as notification_subject_kind_known (D5)
--                      + CHECKs on the retraction columns' shape
--                      + trigger notification_contract (D4: default expiry by
--                        kind; a 'notice' about nobody, for nobody, never high,
--                        news.read only; is_public never true)
--                      + trigger notification_retraction_door (D18: the
--                        columns are written by notification_retract() alone)
--   milestone_notice   + retracted_at; a RESTRICTIVE read policy hides a
--                        retracted row (D19)
--   recognition()      the milestone arm leaves out a mark whose notice was
--                        retracted (D19); otherwise exactly db/08's
--   my_notifications   new view, security_invoker (D17)
--   notification_life(), notification_retract(), notification_by_id()  new
--
-- EXISTING ROWS. None is refused and none is deleted. Two backfills, both
-- named in the paste's output:
--   1. is_public is set false on every row (D4, D6: the flag is dormant, and
--      since S0 nothing reads it — buildPayload() sends a pointer whatever it
--      says). The pilot seed's "Fixture list published" was the one known.
--   2. The pilot seed's one notice outside D1's list ('training', "U16B
--      training moved", a person's words to a side) becomes a 'notice'
--      (A2). Matched by id, kind and title: a database that was never seeded
--      has no such row and nothing is touched.
-- The kind CHECK is added NOT VALID and validated only when every stored row
-- is in the list. If any row is not (a kind typed through the publish route
-- before S0 locked it), the paste WARNs with each kind and its count, the
-- rows stay as written, the CHECK still holds every new row, and §68's
-- (stored) assertion goes red naming them: correcting them is a decision
-- for a person, not this file. The subject_kind CHECK only grows, so every
-- stored row already satisfies it.
--
-- Expiry (D4) is set on INSERT when the writer left it null. Rows already
-- stored keep the expires_at they have.
--
-- WHO MAY CALL WHAT
--   notification_retract()   nobody through a route: not PUBLIC, not
--                            scrbrd_app. The system's own definers call it
--                            (S5's triggers; S2's post withdrawal).
--   notification_by_id()     scrbrd_app; runs as the caller.
--   notification_life()      the trigger only.
-- And none of the three to a managed host's anon/authenticated roles.

-- ── 1 · The retraction columns (D18) ───────────────────────────────
ALTER TABLE notification ADD COLUMN IF NOT EXISTS retracted_at    timestamptz;
-- NULL is the system. A person only ever withdraws (the post's author, or a
-- news.publish.school holder at its school).
ALTER TABLE notification ADD COLUMN IF NOT EXISTS retracted_by    uuid REFERENCES app_user(id);
ALTER TABLE notification ADD COLUMN IF NOT EXISTS retraction_kind text;
-- On a "withdrawn" notice: the notice it says was withdrawn.
ALTER TABLE notification ADD COLUMN IF NOT EXISTS retracts_id     uuid REFERENCES notification(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notification_retracts_idx ON notification (retracts_id) WHERE retracts_id IS NOT NULL;

COMMENT ON COLUMN notification.retracted_at IS
  'When the notice was taken back (NOTIFICATIONS.md D18). Every read leaves a retracted row out; notification_by_id() reads it as a stub. Written by notification_retract() alone.';
COMMENT ON COLUMN notification.retracted_by IS
  'Who withdrew it, or NULL: the system (a correction, a later notice superseding it).';
COMMENT ON COLUMN notification.retraction_kind IS
  'correction (the system: the record behind it changed) | superseded (the system: a later notice replaced it) | withdrawn (a person: the post was withdrawn).';
COMMENT ON COLUMN notification.retracts_id IS
  'On a "withdrawn" notice, the notice it says was withdrawn. Same audience exactly.';
COMMENT ON COLUMN notification.is_public IS
  'Dormant (SCRBRD-142, NOTIFICATIONS.md D6): always false since db/89, and nothing reads it.';

DO $shape$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification'::regclass AND conname = 'notification_retraction_kind') THEN
    ALTER TABLE notification ADD CONSTRAINT notification_retraction_kind
      CHECK (retraction_kind IN ('correction', 'withdrawn', 'superseded'));
  END IF;
  -- Retracted means all of it: a time and a word together, and a person only
  -- on a retracted row.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification'::regclass AND conname = 'notification_retraction_whole') THEN
    ALTER TABLE notification ADD CONSTRAINT notification_retraction_whole
      CHECK ((retracted_at IS NULL) = (retraction_kind IS NULL) AND (retracted_by IS NULL OR retracted_at IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification'::regclass AND conname = 'notification_retracts_another') THEN
    ALTER TABLE notification ADD CONSTRAINT notification_retracts_another CHECK (retracts_id IS DISTINCT FROM id);
  END IF;
END $shape$;

ALTER TABLE milestone_notice ADD COLUMN IF NOT EXISTS retracted_at timestamptz;
COMMENT ON COLUMN milestone_notice.retracted_at IS
  'When the milestone''s notice was taken back (GA-I36 N4, NOTIFICATIONS.md D19). Hidden from every reader; the row stays, so the mark is still noticed once.';

-- ── 2 · The two backfills (before any trigger below can see them) ──
DO $backfill$
DECLARE n integer;
BEGIN
  UPDATE notification SET is_public = false WHERE is_public;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'db/89: % notice(s) were marked public; none is now (D6: the flag chooses nothing)', n;
  UPDATE notification SET kind = 'notice'
   WHERE id = '40170000-0000-0000-0000-000000000003' AND kind = 'training' AND title = 'U16B training moved';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'db/89: % pilot-seed notice(s) moved from ''training'' to ''notice'' (A2)', n;
END $backfill$;

-- ── 3 · One closed list of kinds (D1) and of subjects (D5) ─────────
-- The same lists are packages/policy/src/notifications.mjs's KINDS and
-- SUBJECT_KINDS; packages/policy/test/notifications.test.mjs reads this file
-- and fails if the two disagree.
DO $kind$
DECLARE v_outside text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification'::regclass AND conname = 'notification_kind_known') THEN
    ALTER TABLE notification ADD CONSTRAINT notification_kind_known
      CHECK (kind IN ('injury', 'recognition', 'welfare', 'safeguarding', 'system', 'availability', 'fixture', 'lift', 'notice')) NOT VALID;
  END IF;
  SELECT string_agg(format('%L (%s)', x.kind, x.n), ', ' ORDER BY x.kind) INTO v_outside
    FROM (SELECT kind, count(*) AS n FROM notification
           WHERE kind NOT IN ('injury', 'recognition', 'welfare', 'safeguarding', 'system', 'availability', 'fixture', 'lift', 'notice')
           GROUP BY kind) x;
  IF v_outside IS NULL THEN
    ALTER TABLE notification VALIDATE CONSTRAINT notification_kind_known;
  ELSE
    RAISE WARNING 'db/89: stored notices outside D1''s kinds: %. They stay as written and the CHECK stays NOT VALID (it holds every new row); db/99 §68 names them until a person corrects them and runs ALTER TABLE notification VALIDATE CONSTRAINT notification_kind_known.', v_outside;
  END IF;
END $kind$;

-- db/08's subject_kind CHECK was written inline, so its name is the one
-- Postgres chose; it is found by what it says, not by that name.
DO $subject$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'notification'::regclass AND contype = 'c'
              AND conname <> 'notification_subject_kind_known'
              AND pg_get_constraintdef(oid) LIKE '%subject_kind%' LOOP
    EXECUTE format('ALTER TABLE notification DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'notification'::regclass AND conname = 'notification_subject_kind_known') THEN
    ALTER TABLE notification ADD CONSTRAINT notification_subject_kind_known
      CHECK (subject_kind IN ('match', 'injury', 'training', 'transport', 'facility', 'skills', 'system', 'competition', 'selection', 'welfare', 'news')) NOT VALID;
  END IF;
  -- Only ever grown from db/08's list, so every stored row satisfies it.
  ALTER TABLE notification VALIDATE CONSTRAINT notification_subject_kind_known;
END $subject$;

-- ── 4 · How long a notice lives, by kind (D2's "lives", D4) ────────
-- From the moment it was published. A notice about a fixture lives by the
-- fixture: an availability question until it starts, a fixture notice a week
-- past it, a lift notice a day past the latest meeting time on that fixture
-- (db/70's lift notices name the fixture, not the offer). A subject that
-- cannot be found falls back to thirty days.
CREATE OR REPLACE FUNCTION notification_life(p_kind text, p_subject_kind text, p_subject uuid, p_from timestamptz)
RETURNS timestamptz AS $$
  SELECT CASE p_kind
    WHEN 'injury'       THEN p_from + interval '90 days'
    WHEN 'recognition'  THEN p_from + interval '180 days'
    WHEN 'welfare'      THEN p_from + interval '30 days'
    WHEN 'safeguarding' THEN p_from + interval '30 days'
    WHEN 'system'       THEN p_from + interval '180 days'
    WHEN 'notice'       THEN p_from + interval '60 days'
    WHEN 'availability' THEN coalesce(fx.starts_at, p_from + interval '30 days')
    WHEN 'fixture'      THEN coalesce(fx.starts_at + interval '7 days', p_from + interval '30 days')
    WHEN 'lift'         THEN coalesce(greatest(lf.meet_at, fx.starts_at) + interval '1 day', p_from + interval '30 days')
    ELSE p_from + interval '30 days' END
    FROM (SELECT (SELECT m.starts_at FROM match m WHERE p_subject_kind = 'match' AND m.id = p_subject) AS starts_at) fx,
         (SELECT (SELECT max(o.meet_at) FROM lift_offer o
                   WHERE p_kind = 'lift' AND p_subject_kind = 'match' AND o.match_id = p_subject) AS meet_at) lf
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_life(text, text, uuid, timestamptz) FROM PUBLIC;

-- ── 5 · The contract, as a trigger (D4) ────────────────────────────
-- A 'notice' is words a person wrote to a side, a school or a competition:
-- about nobody in particular, for nobody in particular, at most medium, and
-- readable by whoever holds news.read in its scope. Anything more is written
-- by the record it comes from. And no notice is public (D6). On INSERT, and
-- on an UPDATE of any column the shape is made of, so an edit cannot reach
-- what an insert may not. db/57's SG-9 trigger stays as it is, beside this.
-- Definer so the expiry can read the fixture a writer may not.
CREATE OR REPLACE FUNCTION notification_contract() RETURNS trigger AS $$
BEGIN
  IF NEW.is_public THEN
    RAISE EXCEPTION 'a notice is never public: is_public chooses nothing and stays false (NOTIFICATIONS.md D4, D6)'
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'notification', CONSTRAINT = 'notification_never_public';
  END IF;
  IF NEW.kind = 'notice' THEN
    IF NEW.subject_person_id IS NOT NULL THEN
      RAISE EXCEPTION 'a notice a person wrote is about nobody in particular: it names no child (NOTIFICATIONS.md D4)'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'notification', CONSTRAINT = 'notification_notice_shape';
    END IF;
    IF NEW.recipient_id IS NOT NULL THEN
      RAISE EXCEPTION 'a notice a person wrote goes to everybody in its scope, never to one person (NOTIFICATIONS.md D4)'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'notification', CONSTRAINT = 'notification_notice_shape';
    END IF;
    IF NEW.urgency = 'high' THEN
      RAISE EXCEPTION 'a notice a person wrote is low or medium; high is the system''s (NOTIFICATIONS.md D4)'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'notification', CONSTRAINT = 'notification_notice_shape';
    END IF;
    IF NEW.required_capability IS DISTINCT FROM 'news.read' THEN
      RAISE EXCEPTION 'a notice a person wrote is read with news.read alone; one that needs more is written by the record it comes from (NOTIFICATIONS.md D4)'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'notification', CONSTRAINT = 'notification_notice_shape';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.expires_at IS NULL THEN
    NEW.expires_at := notification_life(NEW.kind, NEW.subject_kind, NEW.subject_id, NEW.published_at);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_contract() FROM PUBLIC;
DROP TRIGGER IF EXISTS notification_contract ON notification;
CREATE TRIGGER notification_contract
  BEFORE INSERT OR UPDATE OF kind, urgency, required_capability, is_public, subject_person_id, recipient_id ON notification
  FOR EACH ROW EXECUTE FUNCTION notification_contract();

-- ── 6 · One door for the retraction columns (D18) ──────────────────
-- A notice is not born retracted, and its retraction is written by
-- notification_retract() alone: as the table's owner (the application role
-- never is) and for the one row it named (db/63's scorebook door is the
-- pattern). The publish policy (db/09) lets a news.publish holder UPDATE a
-- notice in scope; it cannot reach these four columns. NOT a definer: the
-- door asks who is writing.
CREATE OR REPLACE FUNCTION notification_retraction_door() RETURNS trigger AS $$
DECLARE
  v_door  text := nullif(current_setting('scrbrd.notification_retract', true), '');
  v_owner boolean := current_user::text = (SELECT c.relowner::regrole::text FROM pg_class c WHERE c.oid = 'notification'::regclass);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.retracted_at IS NOT NULL OR NEW.retracted_by IS NOT NULL OR NEW.retraction_kind IS NOT NULL THEN
      RAISE EXCEPTION 'a notice is not born retracted (NOTIFICATIONS.md D18)'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'notification', CONSTRAINT = 'notification_retraction_door';
    END IF;
    IF NEW.retracts_id IS NOT NULL AND NOT (v_owner AND v_door IS NOT DISTINCT FROM NEW.retracts_id::text) THEN
      RAISE EXCEPTION 'a "withdrawn" notice is written by notification_retract() alone (NOTIFICATIONS.md D18)'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'notification', CONSTRAINT = 'notification_retraction_door';
    END IF;
  ELSIF (OLD.retracted_at, OLD.retracted_by, OLD.retraction_kind, OLD.retracts_id)
        IS DISTINCT FROM (NEW.retracted_at, NEW.retracted_by, NEW.retraction_kind, NEW.retracts_id)
        AND NOT (v_owner AND v_door IS NOT DISTINCT FROM NEW.id::text) THEN
    RAISE EXCEPTION 'a notice is retracted by notification_retract() alone (NOTIFICATIONS.md D18)'
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'notification', CONSTRAINT = 'notification_retraction_door';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_retraction_door() FROM PUBLIC;
DROP TRIGGER IF EXISTS notification_retraction_door ON notification;
CREATE TRIGGER notification_retraction_door
  BEFORE INSERT OR UPDATE OF retracted_at, retracted_by, retraction_kind, retracts_id ON notification
  FOR EACH ROW EXECUTE FUNCTION notification_retraction_door();

-- ── 7 · Taking a notice back (D18) ─────────────────────────────────
-- Sets the three columns on the row and, when p_say, writes ONE "withdrawn"
-- notice to exactly the original's audience: the same school, side, scope,
-- capability, child and recipient, the same kind, urgency capped at medium
-- (so a phone told a false thing is told it was false, and nobody is paged
-- about a withdrawal of something they were never paged about: Q7). It names
-- a child only where the original did, to the same readers. Returns that
-- notice's id, or NULL when nothing was said.
--
-- Which word, for which kind (D2's "retractable" column, enforced):
--   correction  the system's: recognition and welfare, when the record behind
--               them changed (GA-I36 D4, recognition D20)
--   superseded  the system's: a fixture notice a later change replaced, or a
--               "withdrawn" notice whose original stands again (D19)
--   withdrawn   a person's: a notice (kind 'notice') through the post's
--               withdrawal, by its author or a news.publish.school holder at
--               its school (D10, D11)
-- Never a safeguarding notice. Once only: a second call changes nothing and
-- returns the first call's "withdrawn" notice.
--
-- Granted to nobody. The system's own definers call it (S2, S5); no route
-- retracts a notice directly.
CREATE OR REPLACE FUNCTION notification_retract(p_id uuid, p_kind text, p_say boolean) RETURNS uuid AS $$
DECLARE
  n       notification%ROWTYPE;
  v_by    uuid;
  v_said  uuid;
  v_words text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('correction', 'withdrawn', 'superseded') THEN
    RAISE EXCEPTION 'a notice is retracted as a correction, superseded or withdrawn, not %', coalesce(p_kind, 'nothing')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO n FROM notification WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such notice' USING ERRCODE = 'no_data_found';
  END IF;
  IF n.kind = 'safeguarding' THEN
    RAISE EXCEPTION 'a safeguarding notice is never retracted (NOTIFICATIONS.md D2)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_retract_kind';
  END IF;

  IF p_kind = 'withdrawn' THEN
    v_by := app_user_id();
    IF v_by IS NULL THEN
      RAISE EXCEPTION 'a withdrawal is a person''s, and nobody is signed in' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF n.kind <> 'notice' THEN
      RAISE EXCEPTION 'only a notice a person wrote is withdrawn; a % notice is taken back by the record it came from', n.kind
        USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_retract_kind';
    END IF;
    IF NOT (n.published_by IS NOT DISTINCT FROM v_by
            OR app_can('news.publish.school', n.school_id, coalesce(n.team_code, '*'),
                       '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
      RAISE EXCEPTION 'a notice is withdrawn by its author or by news.publish.school at its school' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    -- The system's words: nobody's name goes on them.
    v_by := NULL;
    IF p_kind = 'correction' AND n.kind NOT IN ('recognition', 'welfare') THEN
      RAISE EXCEPTION 'a % notice is not taken back as a correction (NOTIFICATIONS.md D2)', n.kind
        USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_retract_kind';
    END IF;
    IF p_kind = 'superseded' AND n.kind <> 'fixture' AND n.retracts_id IS NULL THEN
      RAISE EXCEPTION 'a % notice is not superseded (NOTIFICATIONS.md D2)', n.kind
        USING ERRCODE = 'check_violation', CONSTRAINT = 'notification_retract_kind';
    END IF;
  END IF;

  IF n.retracted_at IS NOT NULL THEN
    RETURN (SELECT w.id FROM notification w WHERE w.retracts_id = n.id ORDER BY w.published_at, w.id LIMIT 1);
  END IF;

  PERFORM set_config('scrbrd.notification_retract', n.id::text, true);
  UPDATE notification SET retracted_at = now(), retracted_by = v_by, retraction_kind = p_kind WHERE id = n.id;

  IF p_say THEN
    v_words := format('''%s'' %s', left(n.title, 200), CASE p_kind
      WHEN 'correction' THEN 'was withdrawn after the scorecard was corrected.'
      WHEN 'superseded' THEN 'was replaced by a later notice.'
      ELSE CASE WHEN n.published_by IS NOT DISTINCT FROM v_by THEN 'was withdrawn by the person who wrote it.'
                ELSE 'was withdrawn by the school.' END END);
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body, required_capability,
                              subject_kind, subject_id, subject_person_id, recipient_id, published_by, retracts_id)
    VALUES (n.school_id, n.team_code, n.scope_level, n.kind,
            CASE WHEN n.urgency = 'high' THEN 'medium' ELSE n.urgency END,
            'A notice was withdrawn', v_words, n.required_capability,
            n.subject_kind, n.subject_id, n.subject_person_id, n.recipient_id, v_by, n.id)
    RETURNING id INTO v_said;
  END IF;
  PERFORM set_config('scrbrd.notification_retract', '', true);

  IF v_by IS NOT NULL THEN
    PERFORM log_restricted_read('notification.retract', ARRAY[n.id], ARRAY['retracted'], n.school_id);
  END IF;
  RETURN v_said;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_retract(uuid, text, boolean) FROM PUBLIC;

-- ── 8 · One view, one count (D17) ──────────────────────────────────
-- The notices this person may have — the policy decides, as the CALLER —
-- that are neither expired nor retracted, each with its own read state. The
-- list (LIMIT 200) and the summary's unread count both read this, in the
-- same session, so the two cannot disagree.
--
-- A TIERED row (required_capability other than news.read: injury, welfare,
-- safeguarding, availability, a lift, a referral) shows its title here and
-- not its body. The body is read on open, through notification_by_id(),
-- which logs that open. A news.read row's body is in the list.
CREATE OR REPLACE VIEW my_notifications WITH (security_invoker = true) AS
SELECT n.id, n.school_id, n.team_code, n.scope_level, n.kind, n.urgency, n.title,
       CASE WHEN n.required_capability = 'news.read' THEN n.body END AS body,
       (n.required_capability <> 'news.read')                       AS tiered,
       n.subject_kind, n.subject_id, n.subject_person_id,
       n.published_at, n.expires_at, n.retracts_id,
       (r.person_id IS NOT NULL) AS read, r.read_at
  FROM notification n
  LEFT JOIN notification_read r ON r.notification_id = n.id AND r.person_id = app_user_id()
 WHERE n.retracted_at IS NULL
   AND (n.expires_at IS NULL OR n.expires_at > now());
REVOKE ALL ON my_notifications FROM PUBLIC;
GRANT SELECT ON my_notifications TO scrbrd_app;

-- ── 9 · One notice, by id (D16, D19) ───────────────────────────────
-- What opening a notice reads. As the CALLER, so RLS decides: a notice this
-- person may not have, an expired one and one that never existed all answer
-- NULL — one sentence on the screen for all three. A retracted one answers
-- a stub: its id, that it was withdrawn and when, and the id of the
-- "withdrawn" notice about it (when one was said and the caller may read
-- it) — no title, no body. Otherwise the whole notice, body included; and
-- for a tiered row the open is a disclosure, logged as log_restricted_read()
-- logs a read of the record behind it.
CREATE OR REPLACE FUNCTION notification_by_id(p_id uuid) RETURNS jsonb AS $$
DECLARE
  n notification%ROWTYPE;
  v_withdrawal uuid;
BEGIN
  IF p_id IS NULL OR app_user_id() IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO n FROM notification WHERE id = p_id;
  IF NOT FOUND OR (n.expires_at IS NOT NULL AND n.expires_at <= now()) THEN RETURN NULL; END IF;
  IF n.retracted_at IS NOT NULL THEN
    SELECT w.id INTO v_withdrawal FROM notification w
     WHERE w.retracts_id = n.id AND w.retracted_at IS NULL
     ORDER BY w.published_at, w.id LIMIT 1;
    RETURN jsonb_build_object('id', n.id, 'withdrawn', true, 'retracted_at', n.retracted_at,
                              'withdrawal_id', v_withdrawal);
  END IF;
  IF n.required_capability <> 'news.read' THEN
    PERFORM log_restricted_read('notification.open', ARRAY[n.id], ARRAY['body'], n.school_id);
  END IF;
  RETURN jsonb_build_object(
    'id', n.id, 'withdrawn', false, 'school_id', n.school_id, 'team_code', n.team_code,
    'scope_level', n.scope_level, 'kind', n.kind, 'urgency', n.urgency, 'title', n.title, 'body', n.body,
    'tiered', n.required_capability <> 'news.read',
    'subject_kind', n.subject_kind, 'subject_id', n.subject_id, 'subject_person_id', n.subject_person_id,
    'published_at', n.published_at, 'expires_at', n.expires_at, 'retracts_id', n.retracts_id,
    'read', EXISTS (SELECT 1 FROM notification_read r WHERE r.notification_id = n.id AND r.person_id = app_user_id()));
END $$ LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_by_id(uuid) TO scrbrd_app;

-- ── 10 · What was retracted is not read (D19) ──────────────────────
-- milestone_notice: RESTRICTIVE, beside db/08's read policy, which stays.
-- The trigger that writes it (milestone_notify(), a definer) still sees a
-- retracted row, so a mark is noticed once and a re-reached mark is
-- un-retracted in place (S5), never noticed twice.
DROP POLICY IF EXISTS milestone_notice_not_retracted ON milestone_notice;
CREATE POLICY milestone_notice_not_retracted ON milestone_notice AS RESTRICTIVE
  FOR SELECT USING (retracted_at IS NULL);

-- recognition(): db/08's, with the milestone arm leaving out a mark whose
-- notice was retracted. Its milestones are the fold's (player_milestone), so
-- a voided ball already takes a mark away; this keeps the two from
-- disagreeing while a retraction and the fold catch up with each other.
CREATE OR REPLACE FUNCTION recognition(p_player uuid)
RETURNS TABLE (family text, kind text, label text, value int, season text, on_date date,
               match_id uuid, opponent text, is_public boolean, citation text, ref_id uuid) AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM player p WHERE p.id = p_player
                    AND app_can('player.profile.read', p.school_id, p.team_code, p.id,
                                '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT 'honour'::text, h.kind, honour_kind_label(h.kind, h.name), NULL::int, (SELECT sn.label FROM season sn WHERE sn.id = h.season_id), h.awarded_on,
           NULL::uuid, NULL::text, h.is_public, h.citation, h.id
      FROM honour h WHERE h.player_id = p_player AND h.withdrawn_at IS NULL
    UNION ALL
    SELECT 'cap', 'cap', c.team_code || ' cap ' || CASE WHEN c.baseline_set THEN '#' || c.cap_no ELSE '#' || c.cap_no || ' (no baseline set)' END
             || ' · ' || c.appearances || ' appearance' || CASE WHEN c.appearances = 1 THEN '' ELSE 's' END,
           c.cap_no, NULL, c.first_on, c.first_match_id, NULL, false, NULL, NULL
      FROM team_cap c WHERE c.player_id = p_player
    UNION ALL
    SELECT 'milestone', ms.kind, milestone_label(ms.kind, ms.value), ms.value, NULL, ms.played_on,
           ms.match_id, ms.opponent, false, NULL, NULL
      FROM player_milestone ms WHERE ms.player_id = p_player
       AND NOT EXISTS (SELECT 1 FROM milestone_notice mn
                        WHERE mn.player_id = ms.player_id AND mn.kind = ms.kind AND mn.match_id = ms.match_id
                          AND mn.innings = coalesce(ms.innings, 0) AND mn.retracted_at IS NOT NULL)
    ORDER BY 6 DESC NULLS LAST, 1;
END $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION recognition(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recognition(uuid) TO PUBLIC;

-- ── 11 · Not a managed host's anonymous roles ──────────────────────
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['notification_life(text,text,uuid,timestamptz)', 'notification_contract()',
                               'notification_retraction_door()', 'notification_retract(uuid,text,boolean)',
                               'notification_by_id(uuid)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
      EXECUTE format('REVOKE ALL ON my_notifications FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;
