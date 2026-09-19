-- ══════════════════════════════════════════════════════════════════
--  26 · How a boy is out, and how a bowler takes wickets — by method
-- ══════════════════════════════════════════════════════════════════
--
-- player_dismissals (db/02) already answers "how many times was this player
-- out" — one number, count(*) over ball_type = 'W'. It cannot answer "bowled
-- how many times, caught how many, lbw how many", and player_bowling_career's
-- `wickets` cannot say whether a bowler's five wickets were five bowled or
-- five lbw. Both are the same GROUP BY away, now that db/13 closed the
-- dismissal vocabulary to the eleven values the Laws recognise.
--
-- Two views, following player_batting_career / player_bowling_career exactly:
-- security_invoker over ball_event_live, so the RLS boundary already proven
-- for those views (fixture.read on ball_event, inherited through the view) is
-- the one this inherits too — nothing new is decided about who may read what,
-- only how the same rows already visible to a caller are grouped.
--
-- LONG-FORM, one row per player per dismissal type, the shape `skills`
-- already uses for a small fixed vocabulary — a client pivots it, and the
-- alternative (one column per dismissal type) grows a migration every time a
-- new dismissal type enters the Laws, which is exactly never but is still the
-- wrong thing to bet the schema on.
--
-- dismissal IS NOT excluded when NULL. A 'W' with no recorded method (a
-- delivery scored before this vocabulary closed, or a device that dropped the
-- field) is still a real dismissal, and a view that silently dropped it would
-- make sum(dismissals) over this view disagree with player_dismissals for the
-- same player — the exact class of quiet drift db/13 closed the vocabulary to
-- stop. It comes back as a NULL `dismissal`, which the read API and the
-- client render as "method not recorded" rather than omitting the wicket.

-- Batting side: how THIS player got out, by method. Not filtered to the
-- bowler's dismissals — a run out is still a fact about how the batter got
-- out, even though it is nobody's bowling figure.
--
-- Same subject as player_dismissals: coalesce(dismissed_id, striker_id),
-- because a run out at the non-striker's end is not the striker's dismissal.
CREATE OR REPLACE VIEW player_dismissal_breakdown WITH (security_invoker = true) AS
SELECT
  coalesce(b.dismissed_id, b.striker_id) AS player_id,
  b.dismissal,
  count(*) AS dismissals
FROM ball_event_live b
WHERE b.kind = 'ball' AND b.ball_type = 'W'
  AND coalesce(b.dismissed_id, b.striker_id) IS NOT NULL
GROUP BY coalesce(b.dismissed_id, b.striker_id), b.dismissal;

-- Bowling side: a bowler's wickets, by method — but ONLY the methods
-- dismissal_is_bowlers() credits to the bowler (db/13: everything except
-- run_out, handled_ball, obstructing_field, timed_out, retired_out and
-- hit_twice). A run out off this bowler's over is not his wicket by type
-- here, the same as it is not counted in player_bowling_career.wickets — one
-- predicate, asked the same way in both places, so the two cannot drift.
--
-- NULL dismissal is credited to the bowler here for the same reason
-- dismissal_is_bowlers(NULL) already returns true: an uncaptured method is
-- not evidence of a run out, and the existing wickets column has always
-- counted it as the bowler's. This view either agrees with that column or
-- gives a reason to change it — it does not invent a third answer.
CREATE OR REPLACE VIEW player_wicket_breakdown WITH (security_invoker = true) AS
SELECT
  b.bowler_id AS player_id,
  b.dismissal,
  count(*) AS wickets
FROM ball_event_live b
WHERE b.kind = 'ball' AND b.ball_type = 'W'
  AND b.bowler_id IS NOT NULL
  AND dismissal_is_bowlers(b.dismissal)
GROUP BY b.bowler_id, b.dismissal;

-- CAUGHT AND BOWLED is deliberately NOT its own line here.
--
-- HowStat and every scorecard convention give it one because it says the
-- bowler took the catch himself, and that is a fact about WHO CAUGHT IT, not
-- about who bowled it or who is out — a fact ball_event does not carry. The
-- table names bowler_id (who bowled the delivery), striker_id / dismissed_id
-- (who is out) and nothing that records who FIELDED the ball. Every caught
-- dismissal off this bowler's own bowling looks identical in the log to a
-- catch taken by any of the other ten fielders, so there is no column here to
-- distinguish "the bowler caught it" from "cover caught it off the bowler" —
-- both are just dismissal = 'caught' with this bowler_id.
--
-- Inferring it from bowler_id alone (bowler bowled it, therefore bowler
-- caught it) would be wrong for nearly every 'caught' dismissal in the game,
-- which is worse than not showing the line at all. If a fielder/catcher
-- column is ever added to ball_event, 'caught_and_bowled' becomes a third
-- value this view's GROUP BY produces for free, wherever the catcher equals
-- the bowler. Until then, a caught-and-bowled wicket is counted here as an
-- ordinary 'caught' wicket, and it is one.
