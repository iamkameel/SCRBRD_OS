-- ══════════════════════════════════════════════════════════════════
--  97 · The ball log follows the fixture: the away side reads its match
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/SCRBRD-136-137_away_visibility.md
-- (approved, Kameel 2026-10-14; AV-D1 to AV-D5, built as AV0 of its §8). Its
-- proof is db/99 §75; the API walk is tools/smoke-cockpit.mjs's group 5.
--
-- WHY. A fixture has a host (match.school_id, team_code) and a visitor
-- (match.away_school_id, away_team_code). match_read (db/09) admits either
-- side's fixture.read holders, so the visiting school's coach, pupils and
-- spectators see Saturday at Hilton on their lists. But every ball of it is
-- written with the host's school_id (the scorer's session is at the host),
-- and ball_event_read (db/02) asked fixture.read at ball_event.school_id and
-- match_team(), both the host's. So the visitors saw the fixture and none of
-- it: no scorecard, no spells, no wheel, no phases, while bowler_day() (a
-- definer, db/94) already counted their own boy's overs in it.
--
-- THE RULE (AV-D1). Whoever may read the fixture may read its log.
-- ball_event_read becomes match_read's two branches:
--
--   host  app_can('fixture.read', ball_event.school_id, match_team(match_id), NULL, match_id)
--         -- db/02's line, word for word
--   away  app_can('fixture.read', <match.away_school_id>, <match.away_team_code>, NULL, match_id)
--         -- match_read's second line, with the ball's match as the fixture
--
-- The away anchors are read from match directly, as match_read reads them;
-- match_team() returns the host's code and ball_event.school_id is the
-- host's, so neither could ever be the visitor's. The read of match is under
-- the reader's own row security, as the design's two sub-selects were: a
-- reader who may not see the fixture finds no row and reads no ball.
--
-- THE SHAPE (the design's AV-A7: "the lead compares EXPLAIN before and after
-- on the seed's longest match"). The design wrote the away anchors as two
-- scalar sub-selects. Measured on a copy of the seed's 96-ball match shared
-- with Westville, the policy runs on every ball a reader's host branch
-- refuses, including every ball of fixtures he cannot see at all, which is
-- what a career view's one scan of the log is (db/49):
--
--                                     host only   two sub-selects   this
--   Hilton's coach, his own match       ~5 ms        ~5 ms          ~5 ms
--   Westville's coach, the shared one     0 rows     ~24 ms         ~16 ms
--   Westville's coach, a Hilton-only    ~3.5 ms     ~25 ms          ~3.7 ms
--
-- Two sub-selects are two reads of match, each paying match_read's own two
-- app_can() calls. One EXISTS reads it once, and `away_school_id IS NOT NULL`
-- (leakproof, so the planner applies it before match_read) means a fixture
-- with no away school, the common case, costs what it cost before. Same rule,
-- same anchors, same row security: the shape AV-A7 allowed, without the new
-- definer helper it offered, which would also have answered any caller
-- "which school is this fixture against" for any match id. A fixture with no
-- away school reads no ball through this branch, and app_can() would have
-- refused its null school without error anyway (AV-A4; db/50).
--
-- The person argument stays NULL in both branches, as db/02 had it: the log
-- asks about nobody in particular. That keeps the two sides symmetric. (It
-- also means a role that only means anything about a person — guardian —
-- reads no delivery at either side's fixtures, as db/99 §22 has always said.
-- That was true before this file and is unchanged by it.)
--
-- WHAT IT OPENS. Every read of the log is security_invoker down to
-- ball_event (ball_event_live, bowler_over, bowler_spell, ball_event_career,
-- match_live_score), so the fold, live_score, shot_points, phases, summary,
-- bowling_spells, matchups and a boy's own career all start answering the
-- visiting side at once. Each per-boy gate on top of the log keeps asking
-- per boy (AV-D3): the directive beside a spell (player.workload.read), a
-- boy's wheel and career (player.performance.read), his day and his week
-- (bowler_day(), workload()), and the player row itself (player_read). So the
-- away coach reads his own boys filled and the host's boys' load nowhere.
--
-- WHAT IT NEVER OPENS (AV-D4). The pad's tables keep their host-only
-- policies: scoring_session (session_read), ball_event_quarantine
-- (quarantine_read and its two siblings) and scoring_audit (audit_read).
-- Every write is unchanged: ball_event_insert still asks scoring.edit at the
-- host, so nothing here lets the visiting side score.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   ball_event_read on ball_event: dropped and re-created with the away
--   branch. The host branch is unchanged. No table, column, row, function or
--   grant is added or changed; no other policy is touched. DROP POLICY IF
--   EXISTS then CREATE POLICY, in the paste's one transaction, so a second
--   paste changes nothing.

DROP POLICY IF EXISTS ball_event_read ON ball_event;

-- Reading the ball log is reading the fixture: whoever may see the match may
-- see how it is going, at either side's school. Scoped through app_can() like
-- everything else, so a spectator sees his school's matches and nothing beyond.
CREATE POLICY ball_event_read ON ball_event
  FOR SELECT USING (
    app_can('fixture.read', ball_event.school_id, match_team(ball_event.match_id), NULL, ball_event.match_id)
    OR EXISTS (SELECT 1 FROM match m
                WHERE m.id = ball_event.match_id
                  AND m.away_school_id IS NOT NULL
                  AND app_can('fixture.read', m.away_school_id, m.away_team_code, NULL, ball_event.match_id))
  );


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  q text;
  w text;
  n int;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid), p.polcmd::text || p.polpermissive::text
    INTO q, w
    FROM pg_policy p WHERE p.polrelid = 'ball_event'::regclass AND p.polname = 'ball_event_read';
  IF q IS NULL THEN
    RAISE EXCEPTION 'db/97: ball_event_read is missing';
  END IF;
  -- A permissive SELECT policy, as db/02's was.
  IF w IS DISTINCT FROM 'rtrue' THEN
    RAISE EXCEPTION 'db/97: ball_event_read is not a permissive SELECT policy (%)', w;
  END IF;
  -- The away branch names the visitor's anchors...
  IF position('away_school_id' IN q) = 0 OR position('away_team_code' IN q) = 0 THEN
    RAISE EXCEPTION 'db/97: ball_event_read has no away branch: %', q;
  END IF;
  -- ...and the host branch is still there, once.
  n := (length(q) - length(replace(q, 'match_team(', ''))) / length('match_team(');
  IF n <> 1 OR position('''fixture.read''' IN q) = 0 THEN
    RAISE EXCEPTION 'db/97: ball_event_read''s host branch is not db/02''s (match_team( % time(s)): %', n, q;
  END IF;
  -- The writes and the pad's tables are the host's, untouched (AV-D4).
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid IN ('ball_event'::regclass, 'scoring_session'::regclass,
                            'ball_event_quarantine'::regclass, 'scoring_audit'::regclass)
         AND concat(pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) LIKE '%away_%'
         AND p.polname <> 'ball_event_read') > 0 THEN
    RAISE EXCEPTION 'db/97: a policy other than ball_event_read on the log or the pad''s tables names the away side';
  END IF;
END $check$;
