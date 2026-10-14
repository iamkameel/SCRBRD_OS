-- ══════════════════════════════════════════════════════════════════
--  96 · The plan to the side: a team post tagged to a fixture
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-138_phaseB.md §1–§2
-- (decided, Kameel 2026-10-14: PB-D1 to PB-D5, PB-D11). Its proof is db/99
-- §76; the words are proved in packages/policy/test/words.test.mjs and
-- services/api/write/news-api.test.mjs, not here (PB-D7).
--
-- WHAT A PLAN IS (PB-D1). The coach's plan for a match is a news_post of
-- kind 'plan' with the fixture on it. Everything else about it is what a
-- post already has: it is written under
-- news.publish.team at its side (db/12's insert policy), read under news.read
-- at that side (db/12's read policy), narrowed here to the side itself (§4:
-- the side's boys, on the sheet or not, their guardians and the staff who read
-- the side; nobody on another side or his parents, nobody at the other school,
-- no follower), its author stamped from the session (db/12), its one notice
-- written by the post's trigger with no recipient and no child (db/91), so
-- db/57's refusal of a notice addressed to a pupil never meets it. It is
-- withdrawn by news_post_withdraw() (db/91), which sets published_at back to
-- null: a withdrawn plan is its author's draft again.
--
-- WHAT THIS FILE ADDS
--   news_post.kind        'post' | 'plan'; every stored row reads 'post'
--   news_post.fixture_id  the match a plan is for; null for a post
--   news_post_plan_guard  BEFORE INSERT OR UPDATE, refusing:
--     · a kind it does not know                    news_post_kind_known
--     · a plan with no fixture, or not to a team   news_post_plan_anchored
--     · a post with a fixture                      news_post_post_unanchored
--     · a plan whose fixture does not have its     news_post_plan_side
--       (school_id, team_code) at either end
--     · a sent plan's kind or fixture changed      news_post_plan_fixed
--       (the notice went about that fixture;
--       withdraw and post again; its side never
--       moves, by db/84's news_post_anchor_frozen)
--   news_post_plan_live   one live plan per fixture per side (PB-D2): a
--                         partial unique index, WHERE kind = 'plan' AND
--                         published_at IS NOT NULL. The two sides of one
--                         fixture each have their own; a withdrawn plan
--                         leaves room for a new one.
--   news_post_plan_side   RESTRICTIVE, SELECT on news_post: a plan reads to
--                         the side and nobody wider (§4 below says why the
--                         read policy alone reached wider): news.read and
--                         team.read at the side, a guardian through a boy
--                         on it; its author always
--   notification_plan_side  RESTRICTIVE, SELECT on notification: the plan's
--                         notice, and the "withdrawn" notice about it, to
--                         the same readers
--   news_plan_reach(), news_notice_reach()  the two questions those ask
--   news_post_fixture, notification_news_subject  two plain indexes: a
--                         fixture's plans, and a post's notices by the post
--   news_post_public_not_plan  BEFORE INSERT on db/83's news_post_public: a
--                         plan is never asked onto the public home page. The
--                         design's audience (§2.1) has the public reading
--                         nothing; db/83's door would otherwise let its
--                         author ask, and a plan names a side's boys.
--
-- A TRIGGER, NOT A CHECK, ON PURPOSE (PB-D5). Phase C adds a third kind (a
-- captain's note to the side) by CREATE OR REPLACE of the guard. A CHECK
-- would have to be dropped first, and the tool that applies this to
-- production hangs on a statement that removes an object.
--
-- THE GUARD READS THE FIXTURE AS THE OWNER. It is SECURITY DEFINER because
-- a guard that cannot see the fixture it checks would pass: the other
-- school's coach writes his side's plan for a fixture his own read may not
-- reach. It reads the four side columns of one match by id and answers yes
-- or no; it returns nothing of the match.
--
-- THE WORDS ARE NOT HERE (PB-D7). The list a plan's words are checked
-- against lives in packages/policy/src/words.mjs and the route is its gate;
-- a second copy in SQL is what the design forbids.
--
-- EXISTING ROWS. Every stored post reads kind 'post' and fixture_id null
-- (the column's default and no default; added without a rewrite). No row is
-- inserted, changed or deleted.
--
-- NOTHING IS REMOVED. Columns ADD … IF NOT EXISTS; functions CREATE OR
-- REPLACE; triggers CREATE OR REPLACE TRIGGER; indexes IF NOT EXISTS; each
-- policy created inside a DO block only when pg_policies does not have it.
-- Safe to run twice. An ordinary post, and every notice that is not a
-- plan's, reads exactly as before.
--
-- WHO MAY CALL WHAT
--   news_post_plan_guard()        the trigger only
--   news_post_public_not_plan()   the trigger only
--   news_plan_reach(uuid, text)   scrbrd_app (read by the policies, as the caller)
--   news_notice_reach(uuid)       scrbrd_app (likewise)
-- And neither to PUBLIC, nor to a managed host's anon/authenticated roles.

-- ── 1 · The two columns ────────────────────────────────────────────
ALTER TABLE news_post ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'post';
ALTER TABLE news_post ADD COLUMN IF NOT EXISTS fixture_id uuid REFERENCES match(id) ON DELETE CASCADE;
COMMENT ON COLUMN news_post.kind IS
  'post (an ordinary post) | plan (the coach''s plan for one fixture, to the side: SCRBRD-138 phase B). Held by news_post_plan_guard(), not a CHECK, so a later kind is added by CREATE OR REPLACE. Fixed once published.';
COMMENT ON COLUMN news_post.fixture_id IS
  'The match a plan is for (kind plan only; null for a post). Its side (school_id, team_code) is at one end of it, home or away. One live plan per fixture per side (news_post_plan_live). Fixed once published.';

-- ── 2 · The guard ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION news_post_plan_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.kind IS NULL OR NEW.kind NOT IN ('post', 'plan') THEN
    RAISE EXCEPTION 'a post''s kind is post or plan, not %', coalesce(NEW.kind, 'null')
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'news_post', CONSTRAINT = 'news_post_kind_known';
  END IF;

  IF NEW.kind = 'post' AND NEW.fixture_id IS NOT NULL THEN
    RAISE EXCEPTION 'only a plan is tagged to a fixture'
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'news_post', CONSTRAINT = 'news_post_post_unanchored';
  END IF;

  IF NEW.kind = 'plan' THEN
    IF NEW.fixture_id IS NULL OR NEW.scope IS DISTINCT FROM 'team' THEN
      RAISE EXCEPTION 'a plan is to one side (scope team) and for one fixture'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'news_post', CONSTRAINT = 'news_post_plan_anchored';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM match m
                    WHERE m.id = NEW.fixture_id
                      AND ((m.school_id = NEW.school_id AND m.team_code = NEW.team_code)
                        OR (m.away_school_id = NEW.school_id AND m.away_team_code = NEW.team_code))) THEN
      RAISE EXCEPTION 'this fixture is not this side''s: a plan is for a fixture the side plays in'
        USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'news_post', CONSTRAINT = 'news_post_plan_side';
    END IF;
  END IF;

  -- Sent to a side about a fixture: which fixture it was is what its readers
  -- were told. Withdraw it (published_at back to null) and post again. The
  -- side itself (scope, school_id, team_code) never moves on any post, sent
  -- or not: db/84's news_post_anchor_frozen holds that.
  IF TG_OP = 'UPDATE' AND OLD.published_at IS NOT NULL
     AND (OLD.kind = 'plan' OR NEW.kind = 'plan')
     AND (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.fixture_id IS DISTINCT FROM OLD.fixture_id) THEN
    RAISE EXCEPTION 'a sent plan''s kind and fixture are fixed: withdraw it and post again'
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'news_post', CONSTRAINT = 'news_post_plan_fixed';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_post_plan_guard() FROM PUBLIC;

CREATE OR REPLACE TRIGGER news_post_plan_guard
  BEFORE INSERT OR UPDATE ON news_post
  FOR EACH ROW EXECUTE FUNCTION news_post_plan_guard();

-- ── 3 · One live plan per fixture per side (PB-D2) ─────────────────
-- Live is published: news_post_withdraw() sets published_at back to null
-- (db/91, PB-A2), so a withdrawn plan stops counting and a new one fits.
CREATE UNIQUE INDEX IF NOT EXISTS news_post_plan_live
  ON news_post (fixture_id, school_id, team_code)
  WHERE kind = 'plan' AND published_at IS NOT NULL;
-- The fixture's plans, drafts and withdrawn ones included, for the cascade
-- when a match is deleted and for the fixture screen's lookup.
CREATE INDEX IF NOT EXISTS news_post_fixture ON news_post (fixture_id) WHERE fixture_id IS NOT NULL;
-- A post's notices by the post: the `news` read gives a live plan's notice
-- id for the Report button, and db/91's trigger finds them on an edit or a
-- withdrawal. Until now that was a scan.
CREATE INDEX IF NOT EXISTS notification_news_subject ON notification (subject_id) WHERE subject_kind = 'news';

-- ── 4 · The side, and nobody wider (PB-D3, §2.1) ───────────────────
-- db/12's read policy asks app_can('news.read') at the post's team, and
-- that is narrower than "the side" for one kind of reader and wider for
-- others, as the design's own proof found (db/99 §76 (others)):
--   · a GUARDIAN's assignment is school-wide (team NULL) and names his
--     children; app_can() lets a subject-scoped role reach every row with no
--     person dimension, at every team, once it names one live child. So the
--     parent of a U15B boy read U15A's posts: "not the parent of a boy in
--     another one" (db/12) did not hold.
--   · news.read is also held school-wide by roles that do not read any side
--     (team.read): spectator, finance, sponsorship, driver, facilities. A
--     signed-in follower read a side's plan, which names its boys.
-- A plan names children and goes to one side, so for a plan the reach is
-- the side's: news.read at the side AND team.read about the side, where
-- "about the side" is either an assignment whose reach does not depend on
-- whom a row is about (the side's staff, the school's staff who read sides,
-- a pupil on the side: app_can() asked about a person nobody is linked to
-- answers yes for them and no for a guardian), or a live link to a boy on
-- the side (his guardian; himself, through self-access). An ordinary post is
-- untouched: this narrows kind 'plan' alone (PB-D8 keeps the plan's rules to
-- the plan; the wider question is Kameel's).
--
-- The same narrowing holds the plan's notice, and the "withdrawn" notice
-- about it (db/89 copies the post as their subject), which carry its title
-- and its first 280 characters. A RESTRICTIVE policy on each table; an
-- ordinary post's rows and every other notice pass it untouched.
CREATE OR REPLACE FUNCTION news_plan_reach(p_school uuid, p_team text) RETURNS boolean AS $$
  SELECT app_can('news.read', p_school, p_team,
                 '00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
     AND (app_can('team.read', p_school, p_team,
                  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
          OR EXISTS (SELECT 1 FROM player p
                      WHERE p.school_id = p_school AND p.team_code = p_team
                        AND app_can('team.read', p_school, p_team, p.id, '00000000-0000-0000-0000-000000000000'::uuid)))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_plan_reach(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_plan_reach(uuid, text) TO scrbrd_app;

-- A notice about a post: true unless the post is a plan this reader does not
-- reach (its author always does). Read as the owner: the policy that calls
-- it must not depend on the caller's own view of news_post.
CREATE OR REPLACE FUNCTION news_notice_reach(p_post uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT CASE WHEN n.kind <> 'plan' THEN true
                               WHEN n.author_id = app_user_id() THEN true
                               ELSE news_plan_reach(n.school_id, n.team_code) END
                     FROM news_post n WHERE n.id = p_post), true)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_notice_reach(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION news_notice_reach(uuid) TO scrbrd_app;

DO $plan_policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post'
                    AND policyname = 'news_post_plan_side') THEN
    CREATE POLICY news_post_plan_side ON news_post AS RESTRICTIVE
      FOR SELECT USING (kind <> 'plan' OR author_id = app_user_id() OR news_plan_reach(school_id, team_code));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_plan_side') THEN
    CREATE POLICY notification_plan_side ON notification AS RESTRICTIVE
      FOR SELECT USING (kind <> 'notice' OR subject_kind IS DISTINCT FROM 'news' OR subject_id IS NULL
                        OR news_notice_reach(subject_id));
  END IF;
END $plan_policies$;

-- ── 5 · A plan never goes on the public home page ──────────────────
-- db/83's news_public_request() inserts the request as the owner; this
-- refuses it for a plan, whichever door inserts. The read of the post is the
-- owner's too, for the same reason the guard's is.
CREATE OR REPLACE FUNCTION news_post_public_not_plan() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM news_post n WHERE n.id = NEW.post_id AND n.kind = 'plan') THEN
    RAISE EXCEPTION 'a plan is for the side, not the public home page'
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'news_post_public', CONSTRAINT = 'news_post_public_not_plan';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_post_public_not_plan() FROM PUBLIC;

CREATE OR REPLACE TRIGGER news_post_public_not_plan
  BEFORE INSERT ON news_post_public
  FOR EACH ROW EXECUTE FUNCTION news_post_public_not_plan();

-- A managed host's API roles reach none of it.
DO $managed$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION news_post_plan_guard() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION news_post_public_not_plan() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION news_plan_reach(uuid, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION news_notice_reach(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $managed$;
