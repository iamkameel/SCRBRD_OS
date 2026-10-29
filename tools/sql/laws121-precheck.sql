-- ══════════════════════════════════════════════════════════════════
--  Before db/121: the stored dismissals the free-hit rule moves
-- ══════════════════════════════════════════════════════════════════
--
-- NOT A MIGRATION. Not in db/, not in the ledger, not run by
-- tools/migrate.mjs or any bundle. ONE SELECT: it writes nothing, takes no
-- lock beyond a read, and may be run as often as wanted. Paste it into the
-- SQL Editor of a database AS ITS OWNER (the owner reads past RLS, so every
-- match is counted), BEFORE scrbrd-supabase-apply-121.sql (DEPLOYING.md,
-- db/121).
--
-- IF IT RETURNS ANY ROW, STOP. Do not paste db/121. Take the rows to Kameel:
-- each is a match whose stored scorecard db/121 changes.
--
-- WHY. Kameel decided (the Laws audit of 28 Oct 2026, Q2 and Q9, F11): the
-- free hit follows a front-foot no-ball only, and a delivery that does not
-- count in the over leaves the free hit for the next. Until db/121 every
-- no-ball gave a free hit (db/54's ball_on_free_hit()), and the pad has
-- stored each no-ball's kind (payload.nbType: front_foot, height, beamer)
-- since 27 September 2026. So on the paste:
--   now_stands  a bowler's dismissal on the delivery after a waist-high
--               no-ball or a beamer, which the old rule's free hit saved, now
--               stands — one more wicket in every SQL count, and the fold's
--               batter, who never left, is out;
--   now_saved   a bowler's dismissal right after a fair delivery marked not
--               in the over (payload.notInOver) that followed a no-ball,
--               which stood, is now saved by the free hit carried over it.
-- The rule is not date-gated (Kameel decided it plainly); this count is how
-- a database learns, before the paste, whether it holds any such ball.
--
-- WHAT IT RETURNS. One row per match with any such dismissal: the match's
-- id, the fixture's date (Africa/Johannesburg), the school's code and the
-- side, and the two counts. No person's name, no player id. Nothing at all
-- for a database that holds none — the answer to look for.
--
-- Both rules are written out here, so the answer is the same before db/121
-- and after it. db/99 §98 runs this same query (the text between the two
-- markers, held identical by services/api/write/rejudge.test.mjs) over the
-- seeded database and proves it zero, and over its own staged match, where
-- it finds the one of each it planted.
-- precheck:begin
WITH w AS (
  -- A bowler's dismissal on a delivery, in a match whose format gives free
  -- hits: the dismissals a free hit saves (dismissal_stands_on_free_hit()).
  SELECT x.match_id,
         -- The old rule (db/54): the last earlier live delivery of the innings
         -- that was not a wide was a no-ball, of any kind.
         coalesce((SELECT p.ball_type IS NOT DISTINCT FROM 'Nb'
                     FROM ball_event_live p
                    WHERE p.match_id = x.match_id AND p.innings = x.innings AND p.seq < x.seq
                      AND p.kind = 'ball' AND p.ball_type IS DISTINCT FROM 'Wd'
                    ORDER BY p.seq DESC LIMIT 1), false) AS old_free_hit,
         -- The new (db/121): the last earlier live delivery of the innings that
         -- counts in the over or earns a free hit (a no-ball of nbType
         -- front_foot, or of none recorded) was a no-ball.
         coalesce((SELECT p.ball_type IS NOT DISTINCT FROM 'Nb'
                     FROM ball_event_live p
                    WHERE p.match_id = x.match_id AND p.innings = x.innings AND p.seq < x.seq
                      AND p.kind = 'ball'
                      AND (ball_counts_in_over(p.ball_type, p.payload)
                           OR (p.ball_type = 'Nb' AND coalesce(p.payload ->> 'nbType', 'front_foot') = 'front_foot'))
                    ORDER BY p.seq DESC LIMIT 1), false) AS new_free_hit
    FROM ball_event_live x
   WHERE x.kind = 'ball'
     AND ball_is_wicket(x.ball_type, x.dismissal)
     AND NOT dismissal_stands_on_free_hit(x.dismissal)
     AND match_free_hits_apply(x.match_id)
)
SELECT w.match_id,
       (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date               AS fixture_date,
       s.code                                                               AS school,
       m.team_code                                                          AS side,
       count(*) FILTER (WHERE w.old_free_hit AND NOT w.new_free_hit)::int   AS now_stands,
       count(*) FILTER (WHERE w.new_free_hit AND NOT w.old_free_hit)::int   AS now_saved
  FROM w
  JOIN match m  ON m.id = w.match_id
  JOIN school s ON s.id = m.school_id
 WHERE w.old_free_hit <> w.new_free_hit
 GROUP BY w.match_id, m.starts_at, s.code, m.team_code
 ORDER BY 2, 3, 4, 1
-- precheck:end
;
