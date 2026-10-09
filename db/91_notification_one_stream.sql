-- ══════════════════════════════════════════════════════════════════
--  91 · Notifications S2: one stream
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/NOTIFICATIONS.md (decided, Kameel
-- 2026-10-07), slice S2: D9, D10 and D11. Its proof is db/99 §70.
--
-- D9 · PEOPLE WRITE POSTS. THE SYSTEM WRITES NOTICES. A person's words become
-- a `notice` row only through news_post. The publish route
-- (POST /api/notifications) and the manual push route close (410, in the
-- API); here the database holds the same line: the application may neither
-- insert nor edit a notification of kind 'notice'. The trigger below, which
-- runs as the table's owner, is the one writer.
--
-- D10 · THE POST'S TRIGGER WRITES THE NOTICE. A post that becomes published
-- writes one notice (one per school entered, for a league post: a notice
-- belongs to a school); an edit of a published post's title or body
-- re-syncs the notice's words; a withdrawal retracts it, through db/89's
-- notification_retract(…, 'withdrawn', true), which tells exactly the same
-- readers that it was withdrawn.
--
-- D11 · WHAT A PERSON'S NOTICE MAY NOT CONTAIN, AND HOW THAT HOLDS. The shape
-- is db/89's contract (no child, no recipient, never high, news.read alone);
-- news_post.urgency is low or medium by CHECK. The words cannot be checked by
-- a machine, so: the post is withdrawn by its author OR by a
-- news.publish.school holder at its school (news_post_withdraw(), a definer:
-- db/12's update policy is the author's alone); and any reader may report a
-- notice in one tap (notification_report()), which writes one no-name
-- safeguarding notice to the school's DSOs and refuses a second report of
-- the same notice by the same person.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   news_post          + urgency text NOT NULL DEFAULT 'low', CHECK low|medium
--                        (every stored post reads 'low'; nothing else moves)
--                      + trigger news_post_notice (AFTER INSERT OR UPDATE OF
--                        published_at, title, body, urgency)
--   notification       + RESTRICTIVE notification_notice_insert_system and
--                        notification_notice_update_system: the application
--                        writes no 'notice' row
--   access_log         + RESTRICTIVE access_log_notice_report_author: the
--                        author of a reported notice never reads who reported
--                        it (the rows are `safeguarding.notice_report`, so
--                        db/57's access_log_safeguarding_hidden and db/80's
--                        audit_log() already keep them to the school's DSOs)
--   news_post_notice(), news_post_withdraw(), notification_report(),
--   notification_report_about_me()   new
--
-- EXISTING ROWS. No row is inserted, changed or deleted, beyond every stored
-- post reading urgency 'low' (the column's default, added without a rewrite).
-- In particular NO NOTICE IS BACKFILLED for a post published before this
-- file: the trigger acts on what happens from now on, so a pilot's earlier
-- posts stay in News and do not arrive in everybody's Notices as new, unread
-- notices on the day this is pasted. Withdrawing such a post retracts
-- nothing (it has no notice) and works as before.
--
-- NOTHING IS REMOVED. The tool that applies this to production hangs on a
-- statement that removes an object, so there is none: the trigger is CREATE
-- OR REPLACE TRIGGER; every function is new; each policy is
-- created inside a DO block only when pg_policies does not have it.
--
-- WHO MAY CALL WHAT
--   news_post_notice()              the trigger only
--   news_post_withdraw(uuid)        scrbrd_app (POST /api/news/:id/withdraw)
--   notification_report(uuid)       scrbrd_app (POST /api/notifications/:id/report)
--   notification_report_about_me()  scrbrd_app (read by a policy, as the caller)
-- And none of them to a managed host's anon/authenticated roles.

-- ── 1 · How loud a post is (D9) ────────────────────────────────────
-- Low: in the app only. Medium: "Send to phones too". Never high: high is
-- the system's, for what wakes a phone at any hour.
ALTER TABLE news_post ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'low'
  CONSTRAINT news_post_urgency_known CHECK (urgency IN ('low', 'medium'));
COMMENT ON COLUMN news_post.urgency IS
  'low (in the app only) | medium ("Send to phones too"). Never high (NOTIFICATIONS.md D9, D11). Becomes the notice''s urgency when the post is published, and is fixed from then on.';

-- ── 2 · The application writes no notice (D9) ──────────────────────
-- db/09's generated policies let a news.publish holder insert and update a
-- notification in scope; these narrow them, for the one kind a person's
-- words make. Beside db/57's two for 'safeguarding', in the same shape.
DO $notice_policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_notice_insert_system') THEN
    CREATE POLICY notification_notice_insert_system ON notification AS RESTRICTIVE
      FOR INSERT WITH CHECK (kind <> 'notice');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_notice_update_system') THEN
    CREATE POLICY notification_notice_update_system ON notification AS RESTRICTIVE
      FOR UPDATE USING (kind <> 'notice') WITH CHECK (kind <> 'notice');
  END IF;
END $notice_policies$;

-- ── 3 · The post's trigger writes the notice (D10) ─────────────────
-- A definer: it writes what the application may not (§2), as the owner
-- notification_retraction_door() admits. The notice:
--   kind 'notice', the post's scope and anchor, news.read, the post's
--   urgency, its title, its first 280 characters, subject 'news' = the post,
--   published by the author, at the post's published_at; no child, no
--   recipient (db/89's contract refuses either).
-- A league post has no school; a notice must have one, so it is one notice
-- per school entered in the competition when it is published, each read at
-- its school exactly as news_post_read reads the post there.
CREATE OR REPLACE FUNCTION news_post_notice() RETURNS trigger AS $$
DECLARE
  v_was  boolean := TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL;
  v_is   boolean := NEW.published_at IS NOT NULL;
  v_body text    := CASE WHEN length(NEW.body) > 280 THEN left(NEW.body, 279) || '…' ELSE NEW.body END;
  r      record;
BEGIN
  IF v_is AND NOT v_was THEN
    -- Published (at once, or a draft sent): one notice per school it reaches.
    INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                              required_capability, subject_kind, subject_id, published_at, published_by)
    SELECT s.school_id, NEW.team_code, NEW.scope, 'notice', NEW.urgency, NEW.title, v_body,
           'news.read', 'news', NEW.id, NEW.published_at, NEW.author_id
      FROM (SELECT NEW.school_id AS school_id WHERE NEW.scope <> 'competition'
            UNION
            SELECT e.school_id FROM competition_entrant e
             WHERE NEW.scope = 'competition' AND e.competition_id = NEW.competition_id) s
     WHERE s.school_id IS NOT NULL;

  ELSIF v_was AND NOT v_is THEN
    -- Withdrawn: each live notice of the post is retracted as the withdrawer
    -- (app_user_id(), the author or a news.publish.school holder at the
    -- school: notification_retract() asks again and refuses anybody else),
    -- and its readers are told, unless it had already expired: nobody is told
    -- a notice they no longer see was withdrawn.
    FOR r IN SELECT n.id, (n.expires_at IS NULL OR n.expires_at > now()) AS live
               FROM notification n
              WHERE n.kind = 'notice' AND n.subject_kind = 'news' AND n.subject_id = NEW.id
                AND n.retracts_id IS NULL AND n.retracted_at IS NULL
              ORDER BY n.published_at, n.id LOOP
      PERFORM notification_retract(r.id, 'withdrawn', r.live);
    END LOOP;

  ELSIF v_was AND v_is THEN
    -- The notice was sent at the urgency it was sent at. A post made louder
    -- after the fact would reach nobody new, and one made quieter has
    -- already reached them: withdraw it and post again.
    IF NEW.urgency IS DISTINCT FROM OLD.urgency THEN
      RAISE EXCEPTION 'a sent post''s urgency is fixed: withdraw it and post again (NOTIFICATIONS.md D10)'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'news_post', CONSTRAINT = 'news_post_urgency_sent';
    END IF;
    -- Edited: the words re-synced; when it was published does not move.
    IF NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body THEN
      UPDATE notification n SET title = NEW.title, body = v_body
       WHERE n.kind = 'notice' AND n.subject_kind = 'news' AND n.subject_id = NEW.id
         AND n.retracts_id IS NULL AND n.retracted_at IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_post_notice() FROM PUBLIC;

CREATE OR REPLACE TRIGGER news_post_notice
  AFTER INSERT OR UPDATE OF published_at, title, body, urgency ON news_post
  FOR EACH ROW EXECUTE FUNCTION news_post_notice();

-- ── 4 · Withdrawing a post (D11) ───────────────────────────────────
-- The author, or a news.publish.school holder at the post's school (any side
-- of it, as notification_retract() asks): SCRBRD-142 finding 1, applied to
-- the post itself. A definer because db/12's update policy is the author's
-- alone. Answers ok, or why not; a post this person may not withdraw
-- answers as one that is not there, as the author-only route always did.
CREATE OR REPLACE FUNCTION news_post_withdraw(p_post uuid) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
  n    news_post%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  SELECT * INTO n FROM news_post WHERE id = p_post FOR UPDATE;
  IF NOT FOUND OR n.published_at IS NULL
     OR NOT (n.author_id IS NOT DISTINCT FROM v_me
             OR (n.scope <> 'competition'
                 AND app_can('news.publish.school', n.school_id, coalesce(n.team_code, '*'),
                             '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))) THEN
    RETURN QUERY SELECT false, 'no_such_notice'::text; RETURN;
  END IF;
  -- The trigger above retracts its notice as this person.
  UPDATE news_post SET published_at = NULL WHERE id = n.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_post_withdraw(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_post_withdraw(uuid) TO scrbrd_app;

-- ── 5 · Reporting a notice (D11, CSA SG-9 rule 4) ──────────────────
-- Any reader of a person's notice. Writes ONE safeguarding notice to the
-- school's DSOs (school-wide, safeguarding.concern.read, high, as db/57
-- writes a concern's), naming nobody: not the reporter, not the author, and
-- not the notice's own title, which is a person's words and may name a
-- child. It says where the notice went and when, so a DSO finds it in
-- Notices; its subject is the post (subject_kind 'news', D5's meaning), the
-- words the DSO reads in full.
--
-- The record of who reported which notice is access_log, under
-- `safeguarding.notice_report` with the notice's id: db/57 keeps it to the
-- school's DSOs (and not to a DSO it would name), db/80's audit_log() leaves
-- it out, and §6 keeps it from the notice's author. It is also what refuses
-- a second report of the same notice by the same person, so it is written
-- directly, not through log_restricted_read(), which would swallow a failure
-- and let the report through unrecorded.
--
-- Answers ok, why not, and `unheld`: nobody holds the DSO appointment at the
-- school, so the screen says to tell the school directly.
CREATE OR REPLACE FUNCTION notification_report(p_id uuid) RETURNS TABLE (ok boolean, reason text, unheld boolean) AS $$
DECLARE
  v_me  uuid := app_user_id();
  n     notification%ROWTYPE;
  ZERO  uuid := '00000000-0000-0000-0000-000000000000';
  v_aud text;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text, NULL::boolean; RETURN;
  END IF;
  SELECT * INTO n FROM notification WHERE id = p_id;
  -- Only what this person may read now, as db/09's policy and db/57's
  -- recipient cut decide it, neither expired nor retracted: anything else
  -- answers as a notice that is not there, the same for all of them.
  IF NOT FOUND
     OR n.retracted_at IS NOT NULL
     OR (n.expires_at IS NOT NULL AND n.expires_at <= now())
     OR (n.recipient_id IS NOT NULL AND n.recipient_id <> v_me)
     OR NOT app_can('news.read', n.school_id, coalesce(n.team_code, '*'), coalesce(n.subject_person_id, ZERO), ZERO)
     OR NOT app_can(n.required_capability, n.school_id, coalesce(n.team_code, '*'), coalesce(n.subject_person_id, ZERO), ZERO) THEN
    RETURN QUERY SELECT false, 'no_such_notice'::text, NULL::boolean; RETURN;
  END IF;
  -- A person's words, and not the system's own "A notice was withdrawn".
  IF n.kind <> 'notice' OR n.retracts_id IS NOT NULL THEN
    RETURN QUERY SELECT false, 'not_reportable'::text, NULL::boolean; RETURN;
  END IF;

  -- Once per person per notice, and two taps at once are one.
  PERFORM pg_advisory_xact_lock(hashtextextended('notification_report:' || v_me::text || ':' || n.id::text, 0));
  IF EXISTS (SELECT 1 FROM access_log l
              WHERE l.person_id = v_me AND l.resource = 'safeguarding.notice_report'
                AND l.record_ids @> ARRAY[n.id]) THEN
    RETURN QUERY SELECT false, 'already_reported'::text, NULL::boolean; RETURN;
  END IF;

  v_aud := CASE n.scope_level WHEN 'team' THEN 'the ' || n.team_code
                              WHEN 'school' THEN 'the whole school'
                              ELSE 'the league' END;
  INSERT INTO notification (school_id, scope_level, kind, urgency, title, body, required_capability,
                            subject_kind, subject_id)
  VALUES (n.school_id, 'school', 'safeguarding', 'high', 'A notice was reported at your school',
          format('Someone reported the notice posted to %s on %s. It is in Notices: read it, and take it up with whoever posted it. Its author or the school''s office can withdraw it.',
                 v_aud, to_char(n.published_at AT TIME ZONE 'Africa/Johannesburg', 'FMDD FMMonth')),
          'safeguarding.concern.read',
          CASE WHEN n.subject_kind = 'news' THEN 'news' END,
          CASE WHEN n.subject_kind = 'news' THEN n.subject_id END);

  INSERT INTO access_log (school_id, person_id, resource, record_ids, record_count, fields, device_id)
  VALUES (n.school_id, v_me, 'safeguarding.notice_report', ARRAY[n.id], 1, '{}'::text[], app_device_id());

  RETURN QUERY SELECT true, NULL::text, NOT EXISTS (SELECT 1 FROM dso_people_at(n.school_id));
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_report(uuid) TO scrbrd_app;

-- ── 6 · Who reported is not the author's to read ───────────────────
-- A DSO may also write notices. db/57's policy keeps a report's row to the
-- school's DSOs; this keeps it from the one who wrote the notice reported.
CREATE OR REPLACE FUNCTION notification_report_about_me(p_ids uuid[]) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM notification n WHERE n.id = ANY (p_ids) AND n.published_by = app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_report_about_me(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notification_report_about_me(uuid[]) TO scrbrd_app;

DO $report_policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'access_log'
                    AND policyname = 'access_log_notice_report_author') THEN
    CREATE POLICY access_log_notice_report_author ON access_log AS RESTRICTIVE
      FOR SELECT USING (resource <> 'safeguarding.notice_report' OR NOT notification_report_about_me(access_log.record_ids));
  END IF;
END $report_policy$;

-- ── 7 · Not a managed host's anonymous roles ──────────────────────
DO $revoke_platform_roles$
DECLARE r text; f text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH f IN ARRAY ARRAY['news_post_notice()', 'news_post_withdraw(uuid)', 'notification_report(uuid)',
                               'notification_report_about_me(uuid[])'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END LOOP;
    END IF;
  END LOOP;
END $revoke_platform_roles$;
