-- ══════════════════════════════════════════════════════════════════
--  110 · The coach's draft plan: changed, and thrown away
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's decision on the board, 15 Oct 2026 (final):
--   · a plan that was never sent can be edited and deleted by its author;
--   · a withdrawn plan can be edited and sent again, but never deleted;
--   · a plan that has been sent and not withdrawn keeps today's behaviour:
--     it is not changed in place (withdraw it, and it comes back to its
--     author to change and send again).
-- Its proof is db/99 §87.
--
-- WHAT THE DATABASE COULD NOT TELL. A withdrawn plan is its author's draft
-- again (db/91's news_post_withdraw() sets published_at back to null), so a
-- plan never sent and a plan sent and taken back looked the same. The first
-- may go; the second was read by the side and is kept (CSA SG-9: every
-- message to the side stays openable by the DSO).
--
-- WHAT THIS FILE ADDS
--   news_post.first_sent_at   when a plan was first sent. Null for a plan
--       never sent, and for every ordinary post (the decision is the plan's).
--       Stamped by the trigger below, never taken from the caller, and never
--       cleared: withdrawing a plan leaves it. Existing plans are dated from
--       published_at, or, for one already withdrawn, from its first notice
--       (db/91 wrote one for every plan ever sent: plans began at db/96).
--   news_post_plan_drafts     BEFORE INSERT OR UPDATE on news_post:
--     · stamps first_sent_at, as above
--     · refuses a change to a sent plan's words or urgency while it is out
--       (news_post_plan_sent: withdraw it first)
--     · refuses a change to a plan's words or urgency by anybody but its
--       author (news_post_plan_author), whichever door the UPDATE came
--       through. db/12's update policy already keeps the application's
--       UPDATE to the author; this holds the line for a definer too.
--   news_plan_discard(post)   the one way a plan is deleted: its author's,
--       and only a plan never sent. A withdrawn plan answers plan_kept, a
--       live one plan_kept; a post that is not a plan, not his, or not there
--       answers no_such_draft, the same for all three. A definer because the
--       application holds no DELETE on news_post (db/99 §78 says so, and
--       this file keeps it so).
--
-- THE HISTORY OF A WITHDRAWN PLAN. What the side was sent is kept where
-- db/91 keeps it: the plan's notice, retracted on withdrawal, with the words
-- it went out with (its title and first 280 characters). Editing the
-- withdrawn plan touches no notice (db/91's trigger only re-syncs a LIVE
-- post's notice), and sending it again writes a new notice with the new
-- words. So both versions stand, in order, about the one post.
--
-- WHAT IT CHANGES ON A LIVE DATABASE. One column (no rewrite), dated on the
-- existing plans only (an UPDATE of first_sent_at alone: db/91's notice
-- trigger is not fired by it, db/84's and db/96's guards pass it, db/83's
-- cache trigger drops the public news cache, which holds no plan). One
-- trigger, one function each for it and for discarding. No policy, grant or
-- privilege on news_post changes; no notice is written or changed. Nothing
-- is removed. Safe to run twice.
--
-- WHO MAY CALL WHAT
--   news_post_plan_drafts()     the trigger only
--   news_plan_discard(uuid)     scrbrd_app (POST /api/news/:id/delete)
-- And neither PUBLIC nor a managed host's anon/authenticated roles.

-- ── 1 · When a plan was first sent ─────────────────────────────────
ALTER TABLE news_post ADD COLUMN IF NOT EXISTS first_sent_at timestamptz;
COMMENT ON COLUMN news_post.first_sent_at IS
  'When a plan was first sent (kind plan only; null for a plan never sent and for every ordinary post). Stamped by news_post_plan_drafts(), never cleared: a withdrawn plan keeps it, and is kept (db/110).';

-- Existing plans, before the trigger exists (it would overwrite the date it
-- cannot see). A live plan was first sent no later than now; a withdrawn one
-- at its first notice. A plan with neither was never sent.
UPDATE news_post n
   SET first_sent_at = coalesce(n.published_at,
                                (SELECT min(x.published_at) FROM notification x
                                  WHERE x.kind = 'notice' AND x.subject_kind = 'news' AND x.subject_id = n.id
                                    AND x.retracts_id IS NULL))
 WHERE n.kind = 'plan' AND n.first_sent_at IS NULL
   AND (n.published_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM notification x
                    WHERE x.kind = 'notice' AND x.subject_kind = 'news' AND x.subject_id = n.id
                      AND x.retracts_id IS NULL));

-- ── 2 · The guard ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION news_post_plan_drafts() RETURNS trigger AS $$
BEGIN
  -- The date is the database's: never the caller's, never cleared.
  IF TG_OP = 'INSERT' THEN
    NEW.first_sent_at := CASE WHEN NEW.kind = 'plan' AND NEW.published_at IS NOT NULL THEN NEW.published_at END;
    RETURN NEW;
  END IF;
  NEW.first_sent_at := coalesce(OLD.first_sent_at,
                                CASE WHEN NEW.kind = 'plan' AND NEW.published_at IS NOT NULL THEN NEW.published_at END);

  IF OLD.kind = 'plan'
     AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
          OR NEW.urgency IS DISTINCT FROM OLD.urgency) THEN
    -- Out with the side: what they read is not changed under them.
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'a sent plan is not changed while it is out: withdraw it, and it comes back to you to change and send again'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'news_post', CONSTRAINT = 'news_post_plan_sent';
    END IF;
    -- Its author's words, whoever's door.
    IF OLD.author_id IS NULL OR OLD.author_id IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'only the plan''s author changes it'
        USING ERRCODE = 'insufficient_privilege', SCHEMA = 'public', TABLE = 'news_post', CONSTRAINT = 'news_post_plan_author';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_post_plan_drafts() FROM PUBLIC;

CREATE OR REPLACE TRIGGER news_post_plan_drafts
  BEFORE INSERT OR UPDATE ON news_post
  FOR EACH ROW EXECUTE FUNCTION news_post_plan_drafts();

-- ── 3 · Throwing a draft plan away ─────────────────────────────────
-- Its author's, and only a plan never sent. Answers ok, or why not.
CREATE OR REPLACE FUNCTION news_plan_discard(p_post uuid) RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me uuid := app_user_id();
  n    news_post%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'::text; RETURN;
  END IF;
  SELECT * INTO n FROM news_post WHERE id = p_post FOR UPDATE;
  -- Not there, not a plan, or not his: one answer for all three.
  IF NOT FOUND OR n.kind IS DISTINCT FROM 'plan' OR n.author_id IS DISTINCT FROM v_me THEN
    RETURN QUERY SELECT false, 'no_such_draft'::text; RETURN;
  END IF;
  -- Sent, now or before: the side read it, and it is kept.
  IF n.published_at IS NOT NULL OR n.first_sent_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'plan_kept'::text; RETURN;
  END IF;
  DELETE FROM news_post WHERE id = n.id;
  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_plan_discard(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_plan_discard(uuid) TO scrbrd_app;

-- A managed host's API roles reach none of it.
DO $managed$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION news_post_plan_drafts() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION news_plan_discard(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $managed$;

-- ── 4 · Refuse to commit a file that did not do what it says ───────
DO $check$
DECLARE
  g oid := to_regprocedure('news_post_plan_drafts()');
  d oid := to_regprocedure('news_plan_discard(uuid)');
  f text;
BEGIN
  IF g IS NULL OR d IS NULL THEN
    RAISE EXCEPTION 'db/110: news_post_plan_drafts() or news_plan_discard(uuid) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'news_post'::regclass AND t.tgname = 'news_post_plan_drafts'
                    AND t.tgfoid = g AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/110: the trigger news_post_plan_drafts is missing or not enabled';
  END IF;
  IF (SELECT count(*) FROM pg_proc p WHERE p.oid IN (g, d) AND p.prosecdef
         AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) <> 2 THEN
    RAISE EXCEPTION 'db/110: a function is not a SECURITY DEFINER with a pinned path';
  END IF;
  SELECT p.prosrc INTO f FROM pg_proc p WHERE p.oid = g;
  IF position('news_post_plan_sent' IN f) = 0 OR position('news_post_plan_author' IN f) = 0
     OR position('coalesce(OLD.first_sent_at' IN f) = 0 THEN
    RAISE EXCEPTION 'db/110: the guard does not refuse a sent plan''s edit, a non-author''s, or keep the date';
  END IF;
  SELECT p.prosrc INTO f FROM pg_proc p WHERE p.oid = d;
  IF position('n.published_at IS NOT NULL OR n.first_sent_at IS NOT NULL' IN f) = 0
     OR position('n.author_id IS DISTINCT FROM v_me' IN f) = 0 THEN
    RAISE EXCEPTION 'db/110: news_plan_discard() does not keep a sent plan, or lets somebody else''s go';
  END IF;
  IF has_function_privilege('scrbrd_app', g, 'EXECUTE') OR has_function_privilege('public', g, 'EXECUTE')
     OR has_function_privilege('public', d, 'EXECUTE') OR NOT has_function_privilege('scrbrd_app', d, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/110: the guard is callable, or discarding is not the application''s alone';
  END IF;
  IF has_table_privilege('scrbrd_app', 'news_post', 'DELETE') THEN
    RAISE EXCEPTION 'db/110: the application may delete a post directly';
  END IF;
END $check$;
