-- ══════════════════════════════════════════════════════════════════
--  149 · The stream overlay names no child (PUBLIC_DATA D2)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's decision of 11 Nov 2026 (the public-by-terms
-- design, Q1(e)): "the stream caption: role words ('Batter') until its own
-- consent". Until a stream/media consent exists, the overlay carries no
-- child's name and no initial, whatever the fixture's name_display says.
--
-- THE FAULT. broadcast_state() (db/08, db/48, db/71, its day moved by db/128)
-- named the striker, the non-striker and the bowler through
-- broadcast_name(full_name, name_display) for every fixture with a published
-- overlay: no public-name consent, no never-public or safeguarding (DSO)
-- mark, no names-off switch, no rule for another school's boy. It is
-- SECURITY DEFINER and executable by PUBLIC (db/08), and PUBLIC_DATA D2
-- puts the overlay under the name rule. No school has had an overlay
-- published on demo or production, so nobody was shown; this closes it
-- before any school can switch one on.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────
--   ~ broadcast_state(uuid)  re-made in place with its signature, owner,
--       SECURITY DEFINER, pinned search path, volatility and grants as they
--       were (CREATE OR REPLACE keeps the ACL). The three name columns are
--       role words: 'Batter', 'Non-striker', 'Bowler' while a ball has been
--       bowled in the innings being played, NULL before it (nobody is at the
--       crease yet). The function no longer reads player at all, so no name,
--       initial or surname can reach the payload. Everything else is db/128's
--       body word for word: the score, the target, the strapline, the
--       officials (adults doing a public job, named in full when the school
--       shows them), name_display (the school's setting, returned as before)
--       and the sponsor's three columns.
--   Nothing else. broadcast_name() stays: db/79's audit log uses it.
--
-- When a stream/media consent is designed and built, the names come back
-- through it, in its own migration; this file is not the place to guess it.
--
-- THE GUARD keys on pg_proc.prosrc as db/128 and db/146 do: the md5 of the
-- live body, its whitespace folded, must be db/128's or this file's. A body
-- moved by another file since stops the paste. A second paste changes
-- nothing. No file before this one that guards broadcast_state()'s body
-- (db/48, db/128) can be pasted again after it.
--
-- Its proof is db/99 §127; the walk is smoke-broadcast.

CREATE OR REPLACE FUNCTION pg_temp._v149_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

DO $guard$
DECLARE v_src text; v_md5 text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('broadcast_state(uuid)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/149: broadcast_state(uuid) is not there to replace; apply db/128 first';
  END IF;
  v_md5 := pg_temp._v149_fold(v_src);
  -- db/128's body (its table's `mine`), or this file's own.
  IF v_md5 NOT IN ('5f412558479db82c3cb32ed21f83656f', '18f0dbbd3cfb19df50eb8eebbd5c0530') THEN
    RAISE EXCEPTION 'db/149: broadcast_state(uuid) is not db/128''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
END $guard$;

-- The broadcast board (db/48's): an innings with no target of its own takes
-- the previous innings' total plus one — within its own pair. The first
-- innings of a super over chases nothing; its second chases the first.
-- db/149: no child is named — role words until a stream consent exists.
CREATE OR REPLACE FUNCTION broadcast_state(p_match uuid)
RETURNS TABLE (
  match_id uuid, home_team text, away_team text, strapline text,
  innings smallint, runs bigint, wickets bigint, legal_balls bigint,
  overs text, run_rate numeric, target bigint,
  striker text, non_striker text, bowler text,
  officials text, name_display text,
  -- The board, and nothing behind it. See the sponsor CTE below.
  sponsor_name text, sponsor_logo text, sponsor_bg text
) AS $$
  WITH b AS (
    SELECT * FROM match_broadcast WHERE match_id = p_match AND published
  ),
  m AS (
    SELECT mt.* FROM match mt JOIN b ON b.match_id = mt.id
  ),
  -- The innings being played is the highest one the log has reached.
  cur AS (
    SELECT ls.* FROM match_live_score ls JOIN b ON b.match_id = ls.match_id
     ORDER BY ls.innings DESC LIMIT 1
  ),
  -- A chase has a target: what the previous innings made, plus one.
  prev AS (
    SELECT ls.runs FROM match_live_score ls JOIN cur ON cur.match_id = ls.match_id
     WHERE ls.innings < cur.innings
       AND ls.super_over IS NOT DISTINCT FROM cur.super_over   -- db/71: within its pair
     ORDER BY ls.innings DESC LIMIT 1
  ),
  -- Whether anybody is at the crease: a delivery has been bowled in the
  -- innings being played. Only that it exists — not who (db/149).
  last_ball AS (
    SELECT 1 AS bowled
      FROM ball_event e JOIN cur ON cur.match_id = e.match_id AND cur.innings = e.innings
     WHERE e.kind = 'ball'
     LIMIT 1
  ),
  -- The sponsor whose board this is, if the school sold the surface.
  --
  -- THREE COLUMNS AND NO MORE. contract_value_zar and school_share_pct are on
  -- the same row and are not selected here, and this function is SECURITY
  -- DEFINER — so the masking view that keeps them from a coach would not have
  -- kept them from a spectator. What a sponsor pays is between the sponsor and
  -- the school; what a sponsor buys is a name on a screen, and that is all
  -- that leaves.
  --
  -- A placement tied to THIS fixture wins over the school's standing one:
  -- ordering match_id first with NULLS LAST puts the specific agreement ahead
  -- of the general one, which is what a school selling a one-off derby board
  -- on top of a season deal expects.
  sponsor AS (
    SELECT sp.name, sp.logo_text, sp.logo_bg
      FROM sponsorship s
      JOIN sponsor sp ON sp.id = s.sponsor_id AND sp.active
      JOIN m ON m.school_id = s.school_id
     WHERE s.placement = 'broadcast_overlay'
       AND (s.match_id IS NULL OR s.match_id = m.id)
       AND sa_today() BETWEEN s.starts_on AND s.ends_on
     ORDER BY s.match_id NULLS LAST, s.agreed_at DESC
     LIMIT 1
  )
  SELECT m.id,
         m.team_code, m.opponent,
         b.strapline,
         cur.innings, cur.runs, cur.wickets, cur.legal_balls,
         (cur.legal_balls / 6)::text || '.' || (cur.legal_balls % 6)::text,
         CASE WHEN cur.legal_balls > 0
              THEN round((cur.runs::numeric * 6) / cur.legal_balls, 2) END,
         -- The fold's target (db/48): the innings' own, else the previous
         -- innings' total plus one.
         coalesce(innings_target_as_folded(cur.match_id, cur.innings), (SELECT runs + 1 FROM prev)),
         -- NO CHILD IS NAMED (Kameel, 11 Nov 2026, Q1(e): "role words
         -- ('Batter') until its own consent"). Whatever name_display says,
         -- whoever the boy is, whichever school: the role, never a name or
         -- an initial. The roster is not read.
         CASE WHEN EXISTS (SELECT 1 FROM last_ball) THEN 'Batter' END,
         CASE WHEN EXISTS (SELECT 1 FROM last_ball) THEN 'Non-striker' END,
         CASE WHEN EXISTS (SELECT 1 FROM last_ball) THEN 'Bowler' END,
         -- Officials are adults doing a public job, so they are named in full
         -- when shown at all — but only when the school said to show them.
         CASE WHEN b.show_officials THEN (
           SELECT string_agg(o.person_name, ' · ' ORDER BY o.duty, o.person_name)
             FROM match_official o
            WHERE o.match_id = m.id AND NOT o.withdrawn AND o.duty IN ('umpire','third_umpire')
         ) END,
         b.name_display,
         (SELECT name FROM sponsor), (SELECT logo_text FROM sponsor), (SELECT logo_bg FROM sponsor)
    FROM b JOIN m ON m.id = b.match_id LEFT JOIN cur ON cur.match_id = b.match_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/08's (PUBLIC, as the overlay is watched signed out) and
-- CREATE OR REPLACE keeps them: what it returns is now no more than a
-- spectator at the ground hears.

-- After: the body is this file's, a definer with its path pinned, and it
-- reads no player.
DO $after$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'broadcast_state(uuid)'::regprocedure AND p.prosecdef
     AND p.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'];
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/149: broadcast_state() is not a definer with its search path pinned';
  END IF;
  IF v_src ~* '\m(player|full_name|broadcast_name|striker_id|non_striker_id|bowler_id)\M' THEN
    RAISE EXCEPTION 'db/149: broadcast_state() still reads a player or a name';
  END IF;
END $after$;
