-- ══════════════════════════════════════════════════════════════════
--  43 · The last places SQL disagreed with the fold
-- ══════════════════════════════════════════════════════════════════
--
-- The rule db/40 and db/42 established: the fold (packages/scoring,
-- replay.mjs, over the rows as fromRow() reads them) is the truth, and every
-- SQL reader of ball_event agrees with it. db/40 left four disagreements
-- written down and unfixed, because each is older than SCRBRD-068/081 and
-- moving it moves shipped figures (the backlog paragraph "Found 2026-09-24
-- (db/40), not fixed"). db/42 closed the free hit. This closes the rest.
--
-- 1. WHO IS OUT. The fold: `ev.dismissed ?? striker` (replay.mjs, the W
--    case). `dismissed` is dismissed_id when toRow() could put a player id in
--    it, and payload.dismissed when it could not — a typed name, a batter
--    SCRBRD holds no row for (asPlayerId in events.mjs); fromRow() spreads the
--    payload last, so the payload's answer is the event's. SQL asked
--    coalesce(dismissed_id, striker_id) and got two things wrong:
--
--      - player_innings marked `out` only on the row of the ball's STRIKER.
--        A batter run out at the non-striker's end was a dismissal in
--        player_dismissals and not out on his own innings row — his form
--        guide and his passport average (runs over innings out) disagreed
--        with the scorecard — and one run out before he faced a ball had no
--        innings at all. He has one now: 0 (0), out, as a timed-out batter
--        has had since db/40; player_batting_since counts the match, as
--        db/40 made it count a retirement ("matches counts it, as
--        player_innings has a row for it").
--      - A typed-name batter run out at the other end (payload.dismissed,
--        dismissed_id NULL) was filed against the STRIKER: his dismissal,
--        his innings out, his line in the breakdown, a dismissal in the
--        opposition's figures and in the matchup. To the fold the striker
--        is not out; nobody SCRBRD holds a row for is.
--
--    ball_dismissed_batter() is that rule, and every reader of who is out
--    asks it. payload.outAt (SCRBRD-069) is deliberately not read: in the
--    fold it decides which END empties — where the survivor stands — never
--    who is out, and no SQL reader tracks ends; each reads the striker the
--    pad stamped on the ball.
--
-- 2. THE OPPOSITION'S FIGURES (opposition_squad, db/42). Three columns
--    followed nothing the fold says:
--      balls          excluded no-balls. A no-ball is a ball faced, a wide
--                     is not (SCORING_RULES §3) — the balls_faced every
--                     career view already counts. Its strike rate, dot
--                     percentage and evidence label divide by it.
--      fours, sixes   counted any ball worth four or six that was not a
--                     no-ball's byes: byes, leg byes, a wide run to the rope,
--                     a W ball with four run. The fold counts a boundary off
--                     the bat, off a run or a no-ball only (runsOffBat()),
--                     as player_batting_since does.
--      runs_conceded  left out the one-run penalty of a wide and a no-ball.
--                     The fold's bowler is charged 1 + value for each, as
--                     player_bowling_since and bowler_innings_figures are.
--
-- 3. A BALL WITH NO TYPE. The fold reads `ev.type ?? "run"`: a legal ball,
--    its value the striker's and the bowler's. To SQL a NULL ball_type fell
--    through every IN, NOT IN and <> — no ball faced, no legal ball, no run
--    to the batter or the bowler — while match_live_score still added its
--    value to the total. The pad's ball() never writes one; the API writes
--    what it is sent, and toRow() maps a missing type to NULL. DECIDED:
--
--    (a) Refused at the door — a BEFORE INSERT trigger,
--        ball_event_names_its_delivery, raising what a CHECK would: 23514,
--        naming the table and the rule (ball_event_ball_has_type) as the
--        constraint. The API already turns exactly that into a per-event
--        refusal that names it (value_refused, SCRBRD-077), and a held ball
--        meets it on release the same way. Three shapes it is not:
--          - a trigger that writes 'run'. The write path decides "retry or
--            conflict" by fingerprinting the event it holds (db/36,
--            ball_event_fingerprint over jsonb_populate_record — no trigger
--            runs there), so a row rewritten on its way in would never match
--            its own resend: every resend a conflict held for a person. A
--            refusal changes nothing that is stored.
--          - a CHECK, even NOT VALID. ball_event is append-only: the only
--            UPDATEs it ever takes are an owner's one-time edits in a
--            migration, the append-only trigger lifted — db/13's
--            normalisation, db/36's fingerprint backfill — and a CHECK is
--            re-checked on every row such an UPDATE touches, so the next
--            backfill would fail on the first legacy row. db/36 refused a new
--            quarantine row by trigger rather than CHECK for the same reason.
--            A trigger on INSERT alone leaves stored rows as they are.
--          - a correction of the rows already stored. They are history, read
--            as the fold reads them, (b).
--    (b) Read as the fold reads it — ball_event_live, the one definition of
--        "the balls that count" every reader selects from (db/02), now
--        answers ball_type_as_folded(): a ball with no type is a run. Every
--        reader over it follows at once, the ones replaced here and the ones
--        not: match_live_score's legal balls, the handover check's balls,
--        balls faced, a bowler's legal balls and runs, bowler_over (and the
--        workload trigger over it), the hat-trick, the free-hit lookup
--        (db/42 already read NULL as legal there), the opposition's figures,
--        the matchups and phases reads.
--
-- 4. A WICKET WITH NO METHOD. A W ball with dismissal NULL is a wicket to
--    the fold — the batter out — and nobody's wicket: chargedToBowler(null)
--    is false. dismissal_is_bowlers(NULL) was true (db/13, db/26: "an
--    uncaptured method is not evidence of a run out"). The fold decides the
--    other way, and SQL now follows it. dismissal_stands_on_free_hit() was
--    NOT dismissal_is_bowlers(), which would have flipped with it; it is
--    restated so a NULL method still does not stand on a free hit
--    (standsOnFreeHit(null) is false). The API has refused a wicket with no
--    method since db/13 (dismissal_unknown), on the live path and on
--    release; the same trigger refuses one at the database too
--    (ball_event_wicket_has_method), for every other writer. Only a row
--    written before db/13, or by hand, can carry one.
--
-- WHAT MOVES, ON ROWS ALREADY STORED. Only these; every other figure is the
-- number it was:
--   - a W ball that stood and dismissed somebody other than its striker: an
--     innings row for him, out, and a batting match (+ its ended_at);
--   - a W ball whose payload names a typed-name batter out: no longer the
--     striker's dismissal, innings out, breakdown line, opposition dismissal
--     or matchup dismissal;
--   - the opposition's balls (+ no-balls), fours and sixes (− everything not
--     off the bat), runs conceded (+1 per wide and no-ball), and what divides
--     by them: strike rate, dot percentage, economy, the evidence labels;
--   - a ball row with no type: everywhere a run, a legal ball, a ball faced;
--   - a W ball with no method: no longer a bowler's wicket, wicket breakdown
--     line, five-for or hat-trick ball.
--
-- REPLACED, each from its latest definition with only the rule swapped — the
-- name, signature, column list and types, volatility, parallel safety,
-- security, pinned search_path, owner, grants and view options are as they
-- were, and the block at the end of this file checks that against a snapshot
-- taken before any of them is touched:
--
--   ball_event_live                 db/07  a ball with no type is a run
--   player_innings                  db/42  who is out; the non-striker's row
--   player_dismissal_breakdown      db/42  who is out
--   dismissal_is_bowlers()          db/13  NULL is not the bowler's
--   dismissal_stands_on_free_hit()  db/42  NULL still does not stand
--   player_dismissals_since()       db/42  who is out
--   player_batting_since()          db/40  the non-striker's match
--   opposition_squad()              db/42  balls, fours, sixes, runs
--                                          conceded; who is out
--
-- NEW: ball_type_as_folded(), ball_dismissed_batter(); the door,
-- ball_event_names_its_delivery() and its BEFORE INSERT trigger on
-- ball_event (rules ball_event_ball_has_type, ball_event_wicket_has_method).
--
-- And, outside db/: the read API's `matchups` dismissals
-- (services/api/read/read-api.mjs) ask ball_dismissed_batter(), and no
-- longer count a wicket with no method as the bowler's.
--
-- FOLLOW WITHOUT REPLACEMENT: match_live_score, scoring_verify_takeover(),
-- player_bowling_since(), bowler_innings_figures, bowler_hat_trick,
-- bowler_over, bowler_spell, player_wicket_breakdown and milestone_watch()
-- (over ball_event_live and dismissal_is_bowlers()); player_batting_career,
-- player_dismissals, player_milestone, passport(), scouting_candidates(),
-- workload() and the read API's career, form guide, dismissal_breakdown,
-- phases and rewards (over the views and functions above). The milestone
-- trigger reads the new row itself, which the door now keeps typed and
-- named. ball_runs_off_bat() keeps its NULL branch; no reader reaches it.
--
-- NOT CHANGED, found while checking (each a decision, not a slip):
--   - the matchups read's `balls` counts legal deliveries, so a no-ball is
--     not one — the opposite of opposition_squad's `balls` now, and pinned
--     that way by tools/smoke-matchups.mjs;
--   - a batter who came to the crease and neither faced a ball nor was out
--     has no player_innings row (the fold lists him "0*"); the only SQL
--     source for him is the `batters` event;
--   - penalty runs (a `penalty` event) are in the fold's total and in no SQL
--     total — match_live_score, and so the handover check, read `value`,
--     which a penalty row does not carry.
--
-- PROVED BY: tools/smoke-fold-figures.mjs (the fold and every SQL reader of
-- a batter's and a bowler's figures agree over generated logs, legacy rows
-- included), tools/smoke-free-hit.mjs and db/99 §21.

-- ── The shape of everything this file replaces, before it does ─────
-- A plain temporary table, dropped at the end of the file rather than ON
-- COMMIT, as db/42's: psql without -1 would take the snapshot away before
-- the check at the end reads it. CREATE OR REPLACE FUNCTION also resets the
-- parallel label, strictness, leakproofness, cost and rows it is not told,
-- so those are in the snapshot too.
CREATE TEMP TABLE _db43_before AS
SELECT 'view:' || c.relname AS obj,
       jsonb_build_object(
         'options', to_jsonb(c.reloptions),
         'acl', to_jsonb(c.relacl::text[]),
         'owner', c.relowner::regrole::text,
         'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                       FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)) AS shape
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'v'
   AND c.relname IN ('ball_event_live', 'player_innings', 'player_dismissal_breakdown')
UNION ALL
SELECT 'function:' || p.oid::regprocedure::text,
       jsonb_build_object(
         'result', pg_get_function_result(p.oid),
         'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef,
         'volatility', p.provolatile,
         'parallel', p.proparallel,
         'strict', p.proisstrict,
         'leakproof', p.proleakproof,
         'cost', p.procost,
         'rows', p.prorows,
         'config', to_jsonb(p.proconfig),
         'acl', to_jsonb(p.proacl::text[]),
         'owner', p.proowner::regrole::text,
         'language', p.prolang)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.oid::regprocedure::text IN (
         'dismissal_is_bowlers(text)',
         'dismissal_stands_on_free_hit(text)',
         'player_dismissals_since(uuid,timestamp with time zone)',
         'player_batting_since(uuid,timestamp with time zone)',
         'opposition_squad(uuid)');

-- ── The rules, in SQL ────────────────────────────────────────────

-- `ev.type ?? "run"` (replay.mjs, the ball case; runsOffBat() in events.mjs
-- asks the same): a delivery with no type is a run. Only a delivery — a
-- retirement marked W keeps its W, and every other kind its NULL.
CREATE OR REPLACE FUNCTION ball_type_as_folded(p_kind text, p_ball_type text)
RETURNS text AS $$
  SELECT CASE WHEN p_kind = 'ball' THEN coalesce(p_ball_type, 'run') ELSE p_ball_type END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Who a wicket ball dismissed, as the fold decides: `ev.dismissed ?? striker`
-- over fromRow(row). The event's `dismissed` is payload.dismissed when the
-- payload carries the key (fromRow spreads the payload last), else
-- dismissed_id. None — the default — is the striker. A typed name is a batter
-- SCRBRD holds no row for: NULL, nobody here, and never the striker.
CREATE OR REPLACE FUNCTION ball_dismissed_batter(p_striker uuid, p_dismissed uuid, p_payload jsonb)
RETURNS uuid AS $$
  SELECT CASE
           WHEN NOT coalesce(p_payload ? 'dismissed', false) THEN coalesce(p_dismissed, p_striker)
           WHEN p_payload->>'dismissed' IS NULL THEN p_striker
           WHEN p_payload->>'dismissed' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (p_payload->>'dismissed')::uuid
         END
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- ── The balls that count (db/07) ─────────────────────────────────
-- db/07's `SELECT b.*`, spelled out — Postgres froze that list when the view
-- was created, which is why `fingerprint` (db/36) was never in it and is not
-- now — with ball_type read as the fold reads it. A future column added to
-- ball_event reaches this view only by recreating it, as db/07 says; keep
-- ball_type_as_folded() when you do. security_invoker is restated: CREATE OR
-- REPLACE VIEW replaces the options.
CREATE OR REPLACE VIEW ball_event_live WITH (security_invoker = true) AS
SELECT b.id, b.match_id, b.school_id, b.seq, b.epoch, b.innings,
       b.scorer_user_id, b.device_id, b.idempotency_key, b.client_seq, b.client_ts, b.server_ts,
       b.kind,
       ball_type_as_folded(b.kind, b.ball_type) AS ball_type,
       b.value, b.shot, b.contact, b.trajectory, b.seg, b.zone,
       b.striker_id, b.non_striker_id, b.bowler_id, b.dismissed_id, b.dismissal, b.payload, b.recovered,
       b.theta, b.radius, b.placement_source, b.placement_null, b.close_position, b.capture_profile
  FROM ball_event b
 WHERE b.kind <> 'void'
   -- NOT EXISTS rather than NOT IN, as db/02 explains.
   AND NOT EXISTS (
         SELECT 1 FROM ball_event v
          WHERE v.match_id = b.match_id
            AND v.kind = 'void'
            AND v.payload->>'target' = b.idempotency_key);

-- ── Whose wicket (db/13) ─────────────────────────────────────────
-- chargedToBowler() (events.mjs): a method the Laws know, not one of the six
-- NON_DELIVERY. A wicket with no method is nobody's.
CREATE OR REPLACE FUNCTION dismissal_is_bowlers(p_dismissal text) RETURNS boolean AS $$
  SELECT p_dismissal IS NOT NULL
     AND p_dismissal NOT IN ('run_out','handled_ball','obstructing_field',
                             'timed_out','retired_out','hit_twice')
$$ LANGUAGE sql IMMUTABLE;

-- standsOnFreeHit() (events.mjs): NON_DELIVERY — a method, and not the
-- bowler's. Still db/13's one list, asked from the other side; a NULL method
-- does not stand, as it did not before.
CREATE OR REPLACE FUNCTION dismissal_stands_on_free_hit(p_dismissal text)
RETURNS boolean AS $$
  SELECT p_dismissal IS NOT NULL AND NOT dismissal_is_bowlers(p_dismissal)
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- ── Per-innings batting (db/42) ──────────────────────────────────
-- Three sources, one row per player per innings:
--   the balls he faced — out when a wicket that stood dismissed HIM;
--   a wicket that stood and dismissed a batter who was not its striker — his
--     innings, 0 runs and 0 balls from that ball, out (with any balls he
--     faced, one row: out);
--   a retirement marked W (db/40).
-- `out` is IS NOT DISTINCT FROM, never =, so a ball whose batter out is a
-- typed name reads false, not NULL.
CREATE OR REPLACE VIEW player_innings WITH (security_invoker = true) AS
SELECT
  x.player_id,
  x.match_id,
  x.innings,
  max(x.server_ts)                     AS ended_at,
  coalesce(sum(x.runs), 0)             AS runs,
  coalesce(sum(x.balls), 0)            AS balls_faced,
  bool_or(x.out)                       AS out
FROM (
  SELECT b.striker_id AS player_id, b.match_id, b.innings, b.server_ts,
         ball_runs_off_bat(b.ball_type, b.value, b.payload)               AS runs,
         CASE WHEN b.ball_type <> 'Wd' THEN 1 ELSE 0 END                   AS balls,
         (b.ball_type = 'W'
          AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT DISTINCT FROM b.striker_id
          AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)) AS out
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.striker_id IS NOT NULL
  UNION ALL
  SELECT ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT NULL
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS DISTINCT FROM b.striker_id
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload), b.match_id, b.innings, b.server_ts,
         0, 0, true
    FROM ball_event_live b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.match_id, x.innings;

-- ── How a boy is out, by method (db/42) ──────────────────────────
CREATE OR REPLACE VIEW player_dismissal_breakdown WITH (security_invoker = true) AS
SELECT x.player_id, x.dismissal, count(*) AS dismissals
FROM (
  SELECT ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) AS player_id, b.dismissal
    FROM ball_event_live b
   WHERE b.kind = 'ball' AND b.ball_type = 'W'
     AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) IS NOT NULL
     AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal)
  UNION ALL
  SELECT ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload),
         ball_retirement_dismissal(b.kind, b.ball_type, b.dismissal, b.payload)
    FROM ball_event_live b
   WHERE ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) IS NOT NULL
) x
GROUP BY x.player_id, x.dismissal;

-- ── Dismissals, windowed (db/42) ─────────────────────────────────
CREATE OR REPLACE FUNCTION player_dismissals_since(p_player uuid, p_from timestamptz)
RETURNS bigint AS $$
  SELECT count(*)
    FROM ball_event_live b
   WHERE ((b.kind = 'ball' AND b.ball_type = 'W'
           AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = p_player
           AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
          OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
     AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- ── Batting, windowed (db/40) ────────────────────────────────────
-- A match he batted in: a ball he faced, a wicket that stood and dismissed
-- him at the other end (new — player_innings has a row for it), or a
-- retirement marked W. Runs, balls and boundaries are only ever off a ball he
-- FACED: a run out's runs completed are the striker's.
CREATE OR REPLACE FUNCTION player_batting_since(p_player uuid, p_from timestamptz)
RETURNS TABLE (matches bigint, runs bigint, balls_faced bigint, fours bigint,
               sixes bigint, last_ball_at timestamptz) AS $$
  SELECT
    count(DISTINCT b.match_id),
    coalesce(sum(CASE WHEN b.kind = 'ball' AND b.striker_id = p_player
                      THEN ball_runs_off_bat(b.ball_type, b.value, b.payload) ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type <> 'Wd'
                      THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type IN ('run','Nb')
                       AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4 THEN 1 ELSE 0 END), 0),
    coalesce(sum(CASE WHEN b.kind = 'ball' AND b.striker_id = p_player AND b.ball_type IN ('run','Nb')
                       AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6 THEN 1 ELSE 0 END), 0),
    max(b.server_ts)
  FROM ball_event_live b
  WHERE ((b.kind = 'ball' AND b.striker_id = p_player)
         OR (b.kind = 'ball' AND b.ball_type = 'W'
             AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = p_player
             AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))
         OR ball_retired_batter(b.kind, b.ball_type, b.dismissal, b.payload) = p_player)
    AND (p_from IS NULL OR b.server_ts >= p_from)
$$ LANGUAGE sql STABLE;

-- ── The opposition's figures (db/42) ─────────────────────────────
-- From db/42 with balls, fours, sixes and runs conceded as the fold counts
-- them, and who is out asked of ball_dismissed_batter(). Innings, runs, dots,
-- balls bowled and wickets are db/42's. Its dismissals are still only the
-- bowler's of the batter himself.
CREATE OR REPLACE FUNCTION opposition_squad(p_match uuid)
RETURNS TABLE (player_id uuid, school_id uuid, full_name text, team_code text,
               playing_role text, batting_style text, bowling_style text,
               innings integer, balls integer, runs integer, dismissals integer,
               fours integer, sixes integer, dots integer,
               strike_rate numeric, dot_pct numeric, batting_evidence text,
               balls_bowled integer, runs_conceded integer, wickets integer,
               economy numeric, bowling_evidence text) AS $$
  WITH s AS (SELECT * FROM opposition_side(p_match) WHERE open),
  squad AS (
    SELECT p.id, p.school_id, p.full_name, p.team_code, p.playing_role,
           p.batting_style, p.bowling_style
      FROM player p JOIN s ON p.school_id = s.their_school AND p.team_code = s.their_team
  ),
  bat AS (
    SELECT b.striker_id AS pid,
           count(DISTINCT b.match_id)::int AS innings,
           -- Balls faced: a no-ball is one, a wide is not.
           count(*) FILTER (WHERE b.ball_type <> 'Wd')::int AS balls,
           coalesce(sum(ball_runs_off_bat(b.ball_type, b.value, b.payload)),0)::int AS runs,
           count(*) FILTER (WHERE b.ball_type = 'W'
                              AND dismissal_is_bowlers(b.dismissal)
                              AND ball_dismissed_batter(b.striker_id, b.dismissed_id, b.payload) = b.striker_id
                              AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS dismissals,
           -- His boundaries: off the bat, off a run or a no-ball (runsOffBat()).
           count(*) FILTER (WHERE b.ball_type IN ('run','Nb')
                              AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 4)::int AS fours,
           count(*) FILTER (WHERE b.ball_type IN ('run','Nb')
                              AND ball_runs_off_bat(b.ball_type, b.value, b.payload) = 6)::int AS sixes,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb') AND coalesce(b.value,0) = 0)::int AS dots
      FROM ball_event_live b JOIN squad q ON q.id = b.striker_id
     WHERE b.kind = 'ball'
     GROUP BY b.striker_id
  ),
  bowl AS (
    SELECT b.bowler_id AS pid,
           count(*) FILTER (WHERE b.ball_type NOT IN ('Wd','Nb'))::int AS balls_bowled,
           -- What the bowler conceded, as the fold charges him: a wide or a
           -- no-ball is its penalty run and every run off it; a run or a
           -- wicket ball its runs; byes and leg byes are not his.
           coalesce(sum(CASE WHEN b.ball_type IN ('Wd','Nb') THEN 1 + coalesce(b.value,0)
                             WHEN b.ball_type IN ('run','W')  THEN coalesce(b.value,0)
                             ELSE 0 END),0)::int AS runs_conceded,
           count(*) FILTER (WHERE b.ball_type = 'W' AND dismissal_is_bowlers(b.dismissal)
                              AND ball_wicket_stands(b.match_id, b.innings, b.seq, b.kind, b.ball_type, b.dismissal))::int AS wickets
      FROM ball_event_live b JOIN squad q ON q.id = b.bowler_id
     WHERE b.kind = 'ball'
     GROUP BY b.bowler_id
  )
  SELECT q.id, q.school_id, q.full_name, q.team_code, q.playing_role, q.batting_style, q.bowling_style,
         coalesce(bat.innings,0), coalesce(bat.balls,0), coalesce(bat.runs,0), coalesce(bat.dismissals,0),
         coalesce(bat.fours,0), coalesce(bat.sixes,0), coalesce(bat.dots,0),
         -- NULL below the evidence floor, not a number. The label beside it
         -- says why, and a screen renders an em dash.
         CASE WHEN coalesce(bat.balls,0) >= 30 THEN round(bat.runs * 100.0 / bat.balls, 1) END,
         CASE WHEN coalesce(bat.balls,0) >= 30 THEN round(bat.dots * 100.0 / bat.balls, 1) END,
         evidence_label(bat.balls),
         coalesce(bowl.balls_bowled,0), coalesce(bowl.runs_conceded,0), coalesce(bowl.wickets,0),
         CASE WHEN coalesce(bowl.balls_bowled,0) >= 30 THEN round(bowl.runs_conceded * 6.0 / bowl.balls_bowled, 2) END,
         evidence_label(bowl.balls_bowled)
    FROM squad q
    LEFT JOIN bat  ON bat.pid  = q.id
    LEFT JOIN bowl ON bowl.pid = q.id
   ORDER BY coalesce(bat.runs,0) DESC, q.full_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION opposition_squad(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION opposition_squad(uuid) TO scrbrd_app;

-- ── The door (3a, 4) ─────────────────────────────────────────────
-- What is already stored is counted and named, not refused: the readers
-- above read it as the fold does.
DO $legacy$
DECLARE n_type bigint; n_method bigint;
BEGIN
  SELECT count(*) FILTER (WHERE kind = 'ball' AND ball_type IS NULL),
         count(*) FILTER (WHERE kind = 'ball' AND ball_type = 'W' AND dismissal IS NULL)
    INTO n_type, n_method FROM ball_event;
  RAISE NOTICE 'db/43: % stored ball row(s) with no type, read as runs; % stored wicket ball(s) with no method, read as nobody''s wicket',
    n_type, n_method;
END $legacy$;

-- A new delivery says what it was, and a new wicket how. Only a delivery: a
-- retirement marked W carries its reason where a method would be (db/40), and
-- every other kind carries no type. What a CHECK would raise, so every writer
-- that already handles a CHECK — the API's per-event refusal — handles this.
-- Named to fire after ball_event_is_cricket (a hockey fixture is refused for
-- being hockey first) and before zz_ball_event_fingerprint; it changes
-- nothing in NEW, so the fingerprint is the one the row would have had.
CREATE OR REPLACE FUNCTION ball_event_names_its_delivery() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'ball' AND NEW.ball_type IS NULL THEN
    RAISE EXCEPTION 'ball_event: a delivery with no type (match %, key %) — the record says what a ball was: run, W, Wd, Nb, B or LB',
      NEW.match_id, NEW.idempotency_key
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event',
            CONSTRAINT = 'ball_event_ball_has_type';
  END IF;
  IF NEW.kind = 'ball' AND NEW.ball_type = 'W' AND NEW.dismissal IS NULL THEN
    RAISE EXCEPTION 'ball_event: a wicket with no method (match %, key %) — the record says how a batter was out',
      NEW.match_id, NEW.idempotency_key
      USING ERRCODE = 'check_violation', SCHEMA = 'public', TABLE = 'ball_event',
            CONSTRAINT = 'ball_event_wicket_has_method';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER ball_event_names_its_delivery
  BEFORE INSERT ON ball_event
  FOR EACH ROW EXECUTE FUNCTION ball_event_names_its_delivery();

-- ── Assertion: nothing but the rule moved ────────────────────────
-- Every object replaced has the shape it had before this file; each asks the
-- rule it was replaced for; the rules answer as the fold does; the door is
-- on ball_event, on INSERT alone, in its place among the triggers; the
-- application role can reach the rules through the views it reads.
DO $check$
DECLARE r record; now_shape jsonb; n int;
  U uuid := 'aaaaaaaa-0000-4000-8000-000000000001';   -- any two player ids
  V uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
BEGIN
  SELECT count(*) INTO n FROM _db43_before;
  IF n <> 8 THEN RAISE EXCEPTION 'db/43: expected to snapshot 8 objects, found %', n; END IF;
  FOR r IN SELECT * FROM _db43_before LOOP
    IF r.obj LIKE 'view:%' THEN
      SELECT jsonb_build_object(
               'options', to_jsonb(c.reloptions),
               'acl', to_jsonb(c.relacl::text[]),
               'owner', c.relowner::regrole::text,
               'columns', (SELECT jsonb_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
                             FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
        INTO now_shape
        FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'v' AND c.relname = substr(r.obj, 6);
    ELSE
      SELECT jsonb_build_object(
               'result', pg_get_function_result(p.oid),
               'args', pg_get_function_arguments(p.oid),
               'definer', p.prosecdef,
               'volatility', p.provolatile,
               'parallel', p.proparallel,
               'strict', p.proisstrict,
               'leakproof', p.proleakproof,
               'cost', p.procost,
               'rows', p.prorows,
               'config', to_jsonb(p.proconfig),
               'acl', to_jsonb(p.proacl::text[]),
               'owner', p.proowner::regrole::text,
               'language', p.prolang)
        INTO now_shape
        FROM pg_proc p WHERE p.oid = to_regprocedure(substr(r.obj, 10));
    END IF;
    IF now_shape IS DISTINCT FROM r.shape THEN
      RAISE EXCEPTION 'db/43: % changed shape: was %, now %', r.obj, r.shape, now_shape;
    END IF;
  END LOOP;

  -- Each asks the rule it was replaced for.
  IF pg_get_viewdef('ball_event_live'::regclass) NOT LIKE '%ball_type_as_folded(%' THEN
    RAISE EXCEPTION 'db/43: ball_event_live does not read ball_type through ball_type_as_folded()';
  END IF;
  IF pg_get_viewdef('player_innings'::regclass) NOT LIKE '%ball_dismissed_batter(%'
     OR pg_get_viewdef('player_innings'::regclass) NOT LIKE '%ball_wicket_stands(%'
     OR pg_get_viewdef('player_dismissal_breakdown'::regclass) NOT LIKE '%ball_dismissed_batter(%' THEN
    RAISE EXCEPTION 'db/43: player_innings / player_dismissal_breakdown do not ask ball_dismissed_batter() and ball_wicket_stands()';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.oid IN ('player_dismissals_since(uuid,timestamptz)'::regprocedure,
                   'player_batting_since(uuid,timestamptz)'::regprocedure,
                   'opposition_squad(uuid)'::regprocedure)
     AND p.prosrc LIKE '%ball_dismissed_batter(%' AND p.prosrc LIKE '%ball_wicket_stands(%';
  IF n <> 3 THEN
    RAISE EXCEPTION 'db/43: % of player_dismissals_since / player_batting_since / opposition_squad ask ball_dismissed_batter()', n;
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'opposition_squad(uuid)'::regprocedure)
       NOT LIKE '%THEN 1 + coalesce(b.value,0)%' THEN
    RAISE EXCEPTION 'db/43: opposition_squad() does not charge the bowler the penalty run of a wide or a no-ball';
  END IF;

  -- The rules answer as the fold does.
  IF ball_type_as_folded('ball', NULL) IS DISTINCT FROM 'run'
     OR ball_type_as_folded('ball', 'Wd') IS DISTINCT FROM 'Wd'
     OR ball_type_as_folded('retire', 'W') IS DISTINCT FROM 'W'
     OR ball_type_as_folded('batters', NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'db/43: ball_type_as_folded() is not `type ?? "run"` for a delivery and nothing else';
  END IF;
  IF ball_dismissed_batter(U, NULL, '{}') IS DISTINCT FROM U
     OR ball_dismissed_batter(U, V, '{}') IS DISTINCT FROM V
     OR ball_dismissed_batter(U, NULL, '{"dismissed": null}') IS DISTINCT FROM U
     OR ball_dismissed_batter(U, NULL, '{"dismissed": "A Typed Name"}') IS NOT NULL
     OR ball_dismissed_batter(NULL, NULL, jsonb_build_object('dismissed', V::text)) IS DISTINCT FROM V
     OR ball_dismissed_batter(NULL, NULL, '{}') IS NOT NULL THEN
    RAISE EXCEPTION 'db/43: ball_dismissed_batter() is not `dismissed ?? striker` over fromRow()';
  END IF;
  IF (SELECT bool_and(dismissal_is_bowlers(d) = (d IN ('bowled', 'caught', 'lbw', 'stumped', 'hit_wicket'))
                      AND dismissal_stands_on_free_hit(d) = NOT (d IN ('bowled', 'caught', 'lbw', 'stumped', 'hit_wicket')))
        FROM unnest(ARRAY['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'handled_ball',
                          'obstructing_field', 'timed_out', 'retired_out', 'hit_twice']) d) IS NOT TRUE
     OR dismissal_is_bowlers(NULL) IS DISTINCT FROM false
     OR dismissal_stands_on_free_hit(NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'db/43: dismissal_is_bowlers() / dismissal_stands_on_free_hit() are not chargedToBowler() / standsOnFreeHit()';
  END IF;

  -- The door: on ball_event, enabled, BEFORE INSERT FOR EACH ROW and on
  -- nothing else (tgtype 7 = ROW | BEFORE | INSERT — never UPDATE, which is
  -- the point), firing after the sport check and before the fingerprint,
  -- and naming both rules.
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE t.tgrelid = 'ball_event'::regclass AND t.tgname = 'ball_event_names_its_delivery'
     AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 7
     AND t.tgfoid = 'ball_event_names_its_delivery()'::regprocedure;
  IF n <> 1 THEN RAISE EXCEPTION 'db/43: the door is not a BEFORE INSERT row trigger on ball_event, enabled'; END IF;
  -- Postgres fires same-kind triggers in name order, byte by byte.
  IF (SELECT array_agg(t.tgname::text ORDER BY t.tgname::text COLLATE "C") FROM pg_trigger t
       WHERE t.tgrelid = 'ball_event'::regclass AND NOT t.tgisinternal
         AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4)
       IS DISTINCT FROM ARRAY['ball_event_is_cricket', 'ball_event_names_its_delivery', 'zz_ball_event_fingerprint']
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'ball_event_names_its_delivery()'::regprocedure)
          NOT LIKE '%ball_event_ball_has_type%ball_event_wicket_has_method%' THEN
    RAISE EXCEPTION 'db/43: the BEFORE INSERT triggers on ball_event are not the sport check, the door and the fingerprint, in that order — or the door does not name both rules';
  END IF;

  -- The application role reaches the rules through the views it reads.
  IF NOT has_function_privilege('scrbrd_app', 'ball_type_as_folded(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'ball_dismissed_batter(uuid,uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'dismissal_is_bowlers(text)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'dismissal_stands_on_free_hit(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/43: the application role cannot call a rule its views ask';
  END IF;
END $check$;

DROP TABLE _db43_before;
