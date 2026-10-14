-- ══════════════════════════════════════════════════════════════════
--  103 · The plan's byline: who wrote the side's plan
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. SCRBRD-138 phase B's byline ("Plan from Mr Dlamini · Thu",
-- docs/design/SCRBRD-138_captains_view.md §3.2; the block's label in
-- docs/design/SCRBRD-138_phaseB.md §5.2) and CSA SG-9: a pupil always knows
-- which adult wrote to the side. Its proof is db/99 §80.
--
-- THE GAP. The `news` read names a post's author by joining app_user, and
-- app_user reads under user.read (db/09) or to oneself. A pupil and a parent
-- hold no user.read, so for them the join came back null and the plan said
-- "The plan · Thu": the one reader SG-9 is about could not tell which adult
-- had written to his side.
--
-- WHAT THIS FILE ADDS
--   plan_author_name(post)  the display name (app_user.name) of the author of
--       ONE post, and only when that post is a plan (kind 'plan'), live
--       (published, and not in the future; a withdrawn plan is its author's
--       draft again, db/91, and answers nothing), and one this caller reads
--       under news_post's own policies. Null otherwise, the same null for a
--       post that is not there, one he may not read, a draft, a withdrawn
--       plan, an ordinary post, and a plan whose author's account is gone.
-- Nothing else about the author: no id, no email, no phone, no role, no
-- school. The news read already returns the post's other columns.
--
-- WHY NOT WIDEN app_user. A row policy on app_user would hand the whole row,
-- email and phone with it, to every read that joins app_user; this answers
-- one column for one post.
--
-- WHY ORDINARY POSTS ARE NOT HERE. Whether a post's author is named to a
-- pupil or a parent is not decided (the plan's rules stay the plan's, PB-D8).
-- An ordinary post reads exactly as before: its author's name where the
-- reader may read the author's account, and otherwise none.
--
-- THE READER TEST IS THE POLICIES' OWN. The function reads as the owner, who
-- is not under row-level security, so it asks what the policies ask, as
-- db/91's notification_report() does. For a live plan they are:
--   db/12 news_post_read       published, published_at <= now(), and
--                              news.read at the post's team (a plan is always
--                              scope 'team': db/96's guard)
--   db/12 news_post_read_own   OR its author
--   db/96 news_post_plan_side  RESTRICTIVE: its author, or news_plan_reach()
-- and news_plan_reach() already asks news.read at the side, so the whole
-- test is "its author, or news_plan_reach(school, team)". news_plan_reach()
-- is called, not copied: if the side's reach changes there, it changes here.
-- db/99 §80 (agree) holds the two together: for every reader it stages and
-- every post, the name comes back exactly when the reader reads the row as a
-- live plan. A new policy that widens who reads a plan (a permissive one, as
-- the team sheet's would be) is not seen here until this function asks it
-- too: the name is then missing for that reader, never shown to another.
--
-- NOTHING IS REMOVED. One function, CREATE OR REPLACE; its grants. No table,
-- column, row or policy is added, changed or deleted. Safe to run twice.
--
-- WHO MAY CALL WHAT
--   plan_author_name(uuid)   scrbrd_app (the news read, as the caller)
-- And neither PUBLIC nor a managed host's anon/authenticated roles.

CREATE OR REPLACE FUNCTION plan_author_name(p_post uuid) RETURNS text AS $$
  SELECT u.name
    FROM news_post n
    JOIN app_user u ON u.id = n.author_id
   WHERE n.id = p_post
     AND app_user_id() IS NOT NULL
     -- a plan, and live: sent, and not withdrawn (withdrawing sets it back to null)
     AND n.kind = 'plan'
     AND n.scope = 'team'
     AND n.published_at IS NOT NULL AND n.published_at <= now()
     -- and this reader reads it: db/12's and db/96's policies, as they ask it
     AND (n.author_id = app_user_id() OR news_plan_reach(n.school_id, n.team_code))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
COMMENT ON FUNCTION plan_author_name(uuid) IS
  'The display name of a live plan''s author, to a reader of that plan (db/12, db/96''s policies); null for anything else. SCRBRD-138 phase B''s byline, CSA SG-9. db/103.';
REVOKE ALL ON FUNCTION plan_author_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plan_author_name(uuid) TO scrbrd_app;

-- A managed host's API roles reach none of it.
DO $managed$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION plan_author_name(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $managed$;

-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  o oid := to_regprocedure('plan_author_name(uuid)');
  f text;
BEGIN
  IF o IS NULL THEN
    RAISE EXCEPTION 'db/103: plan_author_name(uuid) is missing';
  END IF;
  -- A stable definer with the pinned path, answering one text.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = o AND p.prosecdef AND p.provolatile = 's' AND NOT p.proretset
                    AND p.prorettype = 'text'::regtype
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))) THEN
    RAISE EXCEPTION 'db/103: plan_author_name(uuid) is not a stable SECURITY DEFINER returning one text with a pinned path';
  END IF;
  -- Only a live plan, only to its readers, only the name.
  SELECT p.prosrc INTO f FROM pg_proc p WHERE p.oid = o;
  IF position('n.kind = ''plan''' IN f) = 0
     OR position('n.published_at IS NOT NULL AND n.published_at <= now()' IN f) = 0
     OR position('n.author_id = app_user_id() OR news_plan_reach(n.school_id, n.team_code)' IN f) = 0
     OR position('app_user_id() IS NOT NULL' IN f) = 0
     OR position('SELECT u.name' IN f) = 0
     OR f ~* 'u\.(email|phone|role|school_id|player_id|child_ids|teams)' THEN
    RAISE EXCEPTION 'db/103: plan_author_name(uuid) does not ask what the plan''s read policies ask, or answers more than the name';
  END IF;
  IF has_function_privilege('public', o, 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', o, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/103: plan_author_name(uuid) is executable by PUBLIC, or not by scrbrd_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname IN ('anon', 'authenticated')
                AND has_function_privilege(g.oid, o, 'EXECUTE')) THEN
    RAISE EXCEPTION 'db/103: a managed host''s API role can call plan_author_name(uuid)';
  END IF;
  -- The reach it calls is still db/96's: a definer the application may call.
  IF NOT coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('news_plan_reach(uuid,text)')), false) THEN
    RAISE EXCEPTION 'db/103: news_plan_reach(uuid, text) (db/96) is missing or no longer SECURITY DEFINER';
  END IF;
END $check$;
