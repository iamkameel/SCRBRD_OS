-- ══════════════════════════════════════════════════════════════════
--  156 · Switched off is hidden on the read side as well: the overlay's
--        officials and the overlay itself, and a DRS review read across
--        schools
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. Kameel's rule, 13 Nov 2026: "Anything that's Switched Off
-- for a user should be hidden for that user but still record data." db/154
-- made a DRS review store while DRS is off. Three reads still served what a
-- switch had turned off; this file closes them. Nothing here refuses a
-- write, and nothing here deletes a row.
--
-- ── WHAT MOVES ─────────────────────────────────────────────────────
--   ~ broadcast_state(uuid)  re-made in place: signature, owner, SECURITY
--       DEFINER, pinned search path, volatility and grants as they are
--       (CREATE OR REPLACE keeps the ACL: EXECUTE to PUBLIC, on purpose, as
--       the overlay is watched signed out). db/149's body word for word bar
--       two gates:
--     (1) OFFICIALS. The umpires are named only while the Officials module
--         is on for the fixture's school as well as shown by the school's
--         overlay setting: feature_enabled('officials', m.school_id, NULL).
--         Officials are adults doing a public job, but a school that
--         switched Officials off after appointing still had its umpires
--         named on the signed-out overlay. The appointments stay stored.
--     (2) BROADCAST (HOLDABLE, its own marked block inside the body, see
--         below). While the Broadcast feature is off for the fixture's
--         school, no row: the shape an unpublished fixture gets. A fixture
--         published before its school switched Broadcast off kept serving
--         its score signed out. The publication row stays stored, so the
--         overlay is back the moment Broadcast is.
--   + drs_review_shown(uuid)  and the RESTRICTIVE SELECT policy
--       drs_review_shown_while_on on drs_review: a review is read only
--       while DRS is on for ITS OWN school (the fixture's, match_school(),
--       which is what drs_review.school_id is derived from at write time):
--       feature_enabled('drs_review', match_school(match_id), NULL). So a
--       review stored while the home school had DRS off is not served to the
--       away school's readers who have it on, and is once the home school
--       switches it on. The person is NULL on purpose: a scorer from whom
--       DRS is hidden (a person-level suppression) still has his reviews
--       shown to everyone else; the API hides the panel from him alone
--       (read-api.mjs, OWNER_OF_READ drs_reviews, my_feature_enabled()).
--     ONE EXCEPTION, and it is what keeps db/154 working: whoever may write
--       the review (scoring.correct over the fixture, drs_review_insert's
--       and _update's own question) still sees the row in the database. A
--       SELECT policy also governs an INSERT's RETURNING, an INSERT ... ON
--       CONFLICT DO UPDATE's existing row and an UPDATE's WHERE, so without
--       it a review could not be recorded or corrected while DRS is off,
--       which is the opposite of the rule. He is still not SHOWN it: the
--       API's module gate refuses the read while DRS is off for him.
--     drs_review_read (db/09, db/39, db/106, db/129) is NOT touched: a
--       RESTRICTIVE policy is ANDed with it, so this narrows every reader and
--       widens none, and db/129's guard on its text still holds.
--     drs_review_shown(uuid) is a definer with its path pinned (it asks
--       app_can() and the switch past the caller's own row security),
--       EXECUTE revoked from PUBLIC and a managed host's API roles, and
--       granted to scrbrd_app alone: the role the policy runs as.
--   The API (same change): read-api.mjs drs_reviews asks the same switch
--   for each row's school, so the gate holds at the door as well as at the
--   table. services/api/expected-migrations.json gains 156.
--   Not touched: db/01, db/09, feature_enabled(), drs_review_read, the
--   writes (db/154's trigger), match_broadcast, match_official.
--
-- ── THE BROADCAST BLOCK MAY BE HELD ────────────────────────────────
-- Gate (2) is the three lines inside broadcast_state()'s body that open
-- with the "db/156 · BROADCAST SWITCH" mark and close with its "end" mark
-- (the condition between them). To hold it, delete those three lines and
-- nothing else: the guard and the after-block
-- accept the body with them and the body without them (two md5s, both
-- this file's), and every other gate in the file stands. db/99 §134's
-- (broadcast) case then goes red, which is the record that it was held.
--
-- THE GUARD keys on pg_proc.prosrc as db/149, db/154 and db/155 do: the md5
-- of the live body of broadcast_state(), its whitespace folded, must be
-- db/149's or one of this file's two. A body moved by another file since
-- stops the paste. drs_review_shown(), if there, must be this file's. A
-- second paste changes nothing. db/149 cannot be pasted again after this
-- file (its guard knows neither of this file's bodies), and must not be.
--
-- One transaction: the paste runs the file inside one, so there is no BEGIN
-- or COMMIT here. Its proof is db/99 §134; the walks are smoke-broadcast and
-- smoke-drs.

CREATE OR REPLACE FUNCTION pg_temp._v156_fold(t text) RETURNS text AS $$
  SELECT md5(regexp_replace(btrim(t), '\s+', ' ', 'g'))
$$ LANGUAGE sql IMMUTABLE;

-- ── 0 · What this file was written against ─────────────────────────
DO $guard$
DECLARE v text;
BEGIN
  IF to_regprocedure('broadcast_state(uuid)') IS NULL OR to_regclass('drs_review') IS NULL
     OR to_regprocedure('feature_enabled(text,uuid,uuid)') IS NULL OR to_regprocedure('match_school(uuid)') IS NULL
     OR to_regprocedure('match_team(uuid)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scrbrd_app') THEN
    RAISE EXCEPTION 'db/156: broadcast_state(), drs_review, feature_enabled(), match_school(), match_team(), app_can() or the role scrbrd_app is missing; apply every file before this one (through db/155) first';
  END IF;
  IF (SELECT count(*) FROM feature_flag WHERE key IN ('broadcast', 'officials', 'drs_review')) <> 3 THEN
    RAISE EXCEPTION 'db/156: the switches broadcast, officials and drs_review are not all in feature_flag; apply db/08 first';
  END IF;
  SELECT pg_temp._v156_fold(p.prosrc) INTO v FROM pg_proc p WHERE p.oid = 'broadcast_state(uuid)'::regprocedure;
  IF v NOT IN ('18f0dbbd3cfb19df50eb8eebbd5c0530',   -- db/149's
               'e3707e8319d9370fabd8a8d97dde89be',                       -- this file's
               '4d81c14036bc587b805b5479eb33fc1d') THEN                  -- this file's, the broadcast block held
    RAISE EXCEPTION 'db/156: broadcast_state(uuid) is not db/149''s body or this file''s (md5 % of its folded body); look before replacing it', v;
  END IF;
  IF to_regprocedure('drs_review_shown(uuid)') IS NOT NULL THEN
    SELECT pg_temp._v156_fold(p.prosrc) INTO v FROM pg_proc p WHERE p.oid = 'drs_review_shown(uuid)'::regprocedure;
    IF v <> 'a55d156535fb5335e90d668e3d1a57f3' THEN
      RAISE EXCEPTION 'db/156: drs_review_shown(uuid) is there and is not this file''s (md5 % of its folded body); look before replacing it', v;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'drs_review'::regclass AND p.polname = 'drs_review_shown_while_on'
                AND NOT (p.polcmd = 'r' AND NOT p.polpermissive AND p.polroles = '{0}'
                         AND pg_get_expr(p.polqual, p.polrelid) = 'drs_review_shown(match_id)' AND p.polwithcheck IS NULL)) THEN
    RAISE EXCEPTION 'db/156: drs_review_shown_while_on is there and is not this file''s policy; look before replacing it';
  END IF;
END $guard$;


-- ── 1 · The overlay: officials while Officials is on; nothing while Broadcast is off ──
-- The broadcast board (db/48's): an innings with no target of its own takes
-- the previous innings' total plus one — within its own pair. The first
-- innings of a super over chases nothing; its second chases the first.
-- db/149: no child is named — role words until a stream consent exists.
-- db/156: switched off is hidden — officials need Officials on, and the
-- whole board needs Broadcast on, for the fixture's school.
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
    -- ┌── db/156 · BROADCAST SWITCH (holdable: delete these three lines) ──
       AND feature_enabled('broadcast', (SELECT mt.school_id FROM match mt WHERE mt.id = p_match), NULL::uuid)
    -- └── end BROADCAST SWITCH ──
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
         -- when shown at all — but only when the school said to show them,
         -- and only while its Officials module is on (db/156: switched off is
         -- hidden; the appointments stay stored).
         CASE WHEN b.show_officials AND feature_enabled('officials', m.school_id, NULL::uuid) THEN (
           SELECT string_agg(o.person_name, ' · ' ORDER BY o.duty, o.person_name)
             FROM match_official o
            WHERE o.match_id = m.id AND NOT o.withdrawn AND o.duty IN ('umpire','third_umpire')
         ) END,
         b.name_display,
         (SELECT name FROM sponsor), (SELECT logo_text FROM sponsor), (SELECT logo_bg FROM sponsor)
    FROM b JOIN m ON m.id = b.match_id LEFT JOIN cur ON cur.match_id = b.match_id
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
-- Its grants are db/08's (PUBLIC, as the overlay is watched signed out) and
-- CREATE OR REPLACE keeps them. The after-block below holds them exactly.


-- ── 2 · A DRS review is read only while DRS is on for its own school ──
-- Asked once per row by the policy below. True while the drs_review switch
-- is on for the fixture's school (the person NULL: a person-level
-- suppression hides the panel from that person in the API, never his
-- reviews from anyone else); or for whoever may write the review, so that
-- recording and correcting one while DRS is off (db/154) can read back the
-- row it wrote.
CREATE OR REPLACE FUNCTION drs_review_shown(p_match uuid) RETURNS boolean AS $$
  SELECT coalesce(feature_enabled('drs_review', match_school(p_match), NULL::uuid), false)
      OR coalesce(app_can('scoring.correct', match_school(p_match), match_team(p_match),
                          '00000000-0000-0000-0000-000000000000'::uuid, p_match), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DO $grants$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION drs_review_shown(uuid) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION drs_review_shown(uuid) FROM %I', r);
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION drs_review_shown(uuid) TO scrbrd_app;
END $grants$;

-- RESTRICTIVE, so it is ANDed with drs_review_read and every other read:
-- it can only take a row away. Made once: on a second paste the guard has
-- already held the one there to this file's text, so it is left as it is.
DO $policy$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'drs_review'::regclass AND polname = 'drs_review_shown_while_on') THEN
    CREATE POLICY drs_review_shown_while_on ON drs_review AS RESTRICTIVE FOR SELECT TO PUBLIC
      USING (drs_review_shown(match_id));
  END IF;
END $policy$;


-- ── 3 · After: refuse to commit a file that did not do what it says ──
DO $after$
DECLARE v text;
BEGIN
  -- broadcast_state(): this file's body (with the broadcast block, or held),
  -- a definer with its path pinned, stable, reading no child's name, and
  -- EXECUTE to its owner and PUBLIC exactly: nobody else, nothing more.
  SELECT pg_temp._v156_fold(p.prosrc) INTO v FROM pg_proc p
   WHERE p.oid = 'broadcast_state(uuid)'::regprocedure AND p.prosecdef AND p.provolatile = 's'
     AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp'];
  IF v IS NULL OR v NOT IN ('e3707e8319d9370fabd8a8d97dde89be', '4d81c14036bc587b805b5479eb33fc1d') THEN
    RAISE EXCEPTION 'db/156: broadcast_state() is not this file''s body (md5 %), or not a stable definer with its search path pinned', v;
  END IF;
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'broadcast_state(uuid)'::regprocedure)
       ~* '\m(player|full_name|broadcast_name|striker_id|non_striker_id|bowler_id)\M' THEN
    RAISE EXCEPTION 'db/156: broadcast_state() reads a player or a name';
  END IF;
  IF (SELECT array_agg(coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ':' || a.privilege_type
                       ORDER BY a.grantee <> p.proowner, a.grantee)
        FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = 'broadcast_state(uuid)'::regprocedure)
     IS DISTINCT FROM
     (SELECT ARRAY[p.proowner::regrole::text || ':EXECUTE', 'PUBLIC:EXECUTE']
        FROM pg_proc p WHERE p.oid = 'broadcast_state(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'db/156: broadcast_state() is not EXECUTE to its owner and PUBLIC exactly (the signed-out overlay calls it)';
  END IF;

  -- drs_review_shown(): this file's, a definer with its path pinned, and
  -- the application's alone to call.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'drs_review_shown(uuid)'::regprocedure AND p.prosecdef
                    AND p.proconfig = ARRAY['search_path=pg_catalog, public, pg_temp']
                    AND pg_temp._v156_fold(p.prosrc) = 'a55d156535fb5335e90d668e3d1a57f3') THEN
    RAISE EXCEPTION 'db/156: drs_review_shown() is not this file''s body, or not a definer with its search path pinned';
  END IF;
  IF has_function_privilege('public', 'drs_review_shown(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'drs_review_shown(uuid)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = 'drs_review_shown(uuid)'::regprocedure AND a.grantee <> p.proowner
                   AND NOT (a.grantee = 'scrbrd_app'::regrole AND a.privilege_type = 'EXECUTE')) THEN
    RAISE EXCEPTION 'db/156: drs_review_shown() may be called by a role other than its owner and the application';
  END IF;

  -- The policy: one RESTRICTIVE SELECT policy for PUBLIC asking it, beside
  -- an untouched permissive read.
  IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'drs_review'::regclass AND p.polname = 'drs_review_shown_while_on'
                    AND p.polcmd = 'r' AND NOT p.polpermissive AND p.polroles = '{0}' AND p.polwithcheck IS NULL
                    AND pg_get_expr(p.polqual, p.polrelid) = 'drs_review_shown(match_id)')
     OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'drs_review'::regclass AND p.polname = 'drs_review_read'
                       AND p.polcmd = 'r' AND p.polpermissive)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'drs_review'::regclass) THEN
    RAISE EXCEPTION 'db/156: drs_review_shown_while_on is not one RESTRICTIVE SELECT policy asking drs_review_shown(match_id), or drs_review_read or row security is gone';
  END IF;
END $after$;

DROP FUNCTION pg_temp._v156_fold(text);
