-- ═══════════════════════════════════════════════════════════════════
--  The newsfeed — four capabilities that governed nothing
-- ═══════════════════════════════════════════════════════════════════
--
-- news.read, news.publish.team, news.publish.school and news.publish.competition
-- have been in the capability table since the first migration. Twenty-three of
-- the twenty-five roles hold news.read. There was no table, no read, no screen
-- and no destination — so four capabilities sat in the model, passed every
-- authorization test, and reached nothing. That is the same defect as
-- officiating.assign before the officials register, and the fix is the same:
-- give them something to govern.
--
-- THE THREE PUBLISH TIERS ARE A SCOPE, NOT A RANK, and that is what makes them
-- worth having as three capabilities rather than one. A coach posts to the side
-- he coaches; the office posts to the whole school; whoever runs the league
-- posts to every school in it. Each is a different AUDIENCE, so each is a
-- different anchor, and the read policy derives who may see a post from the
-- same anchor that decided who may write it.

CREATE TABLE news_post (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      text NOT NULL CHECK (scope IN ('team', 'school', 'competition')),
  -- The anchor, one column per scope. Which one is required is a CHECK rather
  -- than a convention, because a post whose audience cannot be worked out is a
  -- post the read policy has to guess about — and a policy that guesses is the
  -- thing this schema does not do anywhere else.
  school_id      uuid REFERENCES school(id) ON DELETE CASCADE,
  team_code      text,
  competition_id uuid REFERENCES competition(id) ON DELETE CASCADE,
  CONSTRAINT news_post_anchored CHECK (
    (scope = 'team'        AND school_id IS NOT NULL AND team_code IS NOT NULL AND competition_id IS NULL)
 OR (scope = 'school'      AND school_id IS NOT NULL AND team_code IS NULL     AND competition_id IS NULL)
 OR (scope = 'competition' AND school_id IS NULL     AND team_code IS NULL     AND competition_id IS NOT NULL)),

  title      text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 140),
  body       text NOT NULL CHECK (length(btrim(body))  BETWEEN 1 AND 4000),
  -- Written and published are different moments. A draft is not a notice, and
  -- the read policy below refuses one — so an unfinished post cannot be read
  -- by the side it is about while somebody is still writing it.
  published_at timestamptz,
  -- Stamped from the session by the trigger below, never taken from the caller.
  author_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON news_post (school_id, published_at DESC) WHERE published_at IS NOT NULL;
CREATE INDEX ON news_post (competition_id, published_at DESC) WHERE published_at IS NOT NULL;
ALTER TABLE news_post ENABLE ROW LEVEL SECURITY;

-- The author is the session, not a field. Everywhere else in this schema that
-- records who did something does it this way, and for the same reason: a
-- byline the caller supplies is a byline the caller can forge.
CREATE OR REPLACE FUNCTION news_post_author() RETURNS trigger AS $$
BEGIN
  NEW.author_id := app_user_id();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER news_post_author BEFORE INSERT ON news_post
  FOR EACH ROW EXECUTE FUNCTION news_post_author();

-- ── Who may read one ────────────────────────────────────────────
--
-- Derived from the anchor. A team post reaches the people news.read reaches AT
-- THAT TEAM — which is the parent of a boy in that side, and not the parent of
-- a boy in another one. A school post reaches the school.
--
-- A COMPETITION POST IS THE INTERESTING ONE. app_can() has no wildcard for
-- school by design — every governed row belongs to a tenant — so a row with
-- school_id NULL would otherwise be readable only by platform-wide holders,
-- which is the opposite of what a league notice is for. competition_entrant
-- already records which schools are in a competition, so the post is readable
-- by anyone holding news.read at ANY school entered in it. The membership
-- table decides the audience; nothing here invents one.
CREATE POLICY news_post_read ON news_post FOR SELECT USING (
  published_at IS NOT NULL AND published_at <= now()
  AND CASE scope
    WHEN 'team'   THEN app_can('news.read', school_id, team_code,
                               '00000000-0000-0000-0000-000000000000'::uuid,
                               '00000000-0000-0000-0000-000000000000'::uuid)
    WHEN 'school' THEN app_can('news.read', school_id, '*',
                               '00000000-0000-0000-0000-000000000000'::uuid,
                               '00000000-0000-0000-0000-000000000000'::uuid)
    ELSE EXISTS (SELECT 1 FROM competition_entrant e
                  WHERE e.competition_id = news_post.competition_id
                    AND app_can('news.read', e.school_id, '*',
                                '00000000-0000-0000-0000-000000000000'::uuid,
                                '00000000-0000-0000-0000-000000000000'::uuid))
  END);

-- An author reads their own drafts, and nobody else does. Without this half a
-- draft is invisible to the person writing it the moment they save it.
CREATE POLICY news_post_read_own ON news_post FOR SELECT USING (author_id = app_user_id());

-- ── Who may write one ───────────────────────────────────────────
-- The tier is the scope. A coach holding news.publish.team cannot post to the
-- school by naming a different anchor, because the anchor is what the check
-- reads.
CREATE POLICY news_post_insert ON news_post FOR INSERT WITH CHECK (
  CASE scope
    WHEN 'team'   THEN app_can('news.publish.team', school_id, team_code,
                               '00000000-0000-0000-0000-000000000000'::uuid,
                               '00000000-0000-0000-0000-000000000000'::uuid)
    WHEN 'school' THEN app_can('news.publish.school', school_id, '*',
                               '00000000-0000-0000-0000-000000000000'::uuid,
                               '00000000-0000-0000-0000-000000000000'::uuid)
    ELSE EXISTS (SELECT 1 FROM competition_entrant e
                  WHERE e.competition_id = news_post.competition_id
                    AND app_can('news.publish.competition', e.school_id, '*',
                                '00000000-0000-0000-0000-000000000000'::uuid,
                                '00000000-0000-0000-0000-000000000000'::uuid))
      OR app_can('news.publish.competition', NULL, '*',
                 '00000000-0000-0000-0000-000000000000'::uuid,
                 '00000000-0000-0000-0000-000000000000'::uuid)
  END);

-- Editing and withdrawing are the author's, and only while it is theirs. A
-- notice that went out and was then silently rewritten is worse than one that
-- was wrong, so the UPDATE keeps the author and cannot change the anchor.
CREATE POLICY news_post_update ON news_post FOR UPDATE
  USING (author_id = app_user_id())
  WITH CHECK (author_id = app_user_id());

GRANT SELECT, INSERT, UPDATE ON news_post TO scrbrd_app;
