-- ══════════════════════════════════════════════════════════════════
--  147 · The ball log's reads ask once a match, not once a ball
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. A speed fix with no change to who reads what. The diagnosis
-- (the demo season, 6 Nov 2026): every career, milestone and personal-best
-- read is a union of sub-reads over ball_event_career, each a full scan of
-- ball_event (a career read has thirteen), and ball_event_read ran on EVERY
-- ROW of every scan: app_can('fixture.read', …), match_team(),
-- pupil_side_on() and db/97's away branch (a correlated read of match under
-- match_read, with three more app_can() calls), about 31 buffer touches a
-- ball. The cost grew with the whole log, not with what the reader may see:
-- 3.5–5.6 s a career read at 3 000 balls, 45 s and more at 7 700. A pilot
-- season is 60 000.
--
-- THE OBSERVATION. Every SELECT policy on ball_event (ball_event_read, and
-- db/50's RESTRICTIVE pad_scope_select) reads exactly two columns of the row:
-- match_id and school_id. Everything else it asks is about the reader's
-- session and the fixture. So within one statement two balls of the same
-- match at the same school are both readable or both not, and the answer for
-- the match is the answer for each of its balls.
--
-- THE SHAPE. ball_event_live (db/121's) is the one view that reads
-- ball_event; every career, season, milestone, best, record, spell and
-- live-score view reads the log through it. It now runs as its owner
-- (security_invoker off, security_barrier on), so its scan of ball_event
-- does not run the policy per ball, and it asks the policy's own conditions
-- itself, as the reader, ONCE A MATCH:
--
--   a ball at its match's school   (match_id, school_id) IN the matches whose
--                                  conditions hold: ball_event_read and
--                                  ball_event's pad guard, written out over
--                                  the match row, with db/97's away branch's
--                                  read of match under match's own SELECT
--                                  policies (match_read, match_trip_driver_
--                                  read, match's pad guard), as the policy
--                                  reads it under the reader's row security.
--                                  One test a match, hashed once a scan; a
--                                  read of one match tests that match alone
--                                  (its id reaches the test through the
--                                  join's equality). The session's own sets
--                                  (my_child_fixtures() and the rest) are
--                                  asked once a scan, as in the policy.
--   a ball at another school       one whose school_id is not its match's
--                                  (every writer stamps the match's school,
--                                  so none today, but nothing forbids one):
--                                  asked of the ball itself, through
--                                  ball_event_row_visible(), the reader's own
--                                  SELECT of it under ball_event's policies
--   the void and super-over reads  a void or an innings_start of the same
--                                  match at the same school as a readable
--                                  ball is readable (the observation); any
--                                  other is asked through the probe
--   a caller row security skips    the table's owner, a definer of his (the
--                                  milestone and seal triggers, the fold's
--                                  helpers), a role that bypasses it: every
--                                  ball, as db/121's view gave them, by
--                                  row_security_active() asked of each table
--   ball_event_rejudged (db/121)   its read policy is "the ball it re-judges
--                                  is readable", which the joined ball is,
--                                  and its pad guard: so it joins where the
--                                  session is not a pad's
--
-- WHY THE CONDITIONS ARE WRITTEN OUT, AND HOW THEY STAY TRUE. A probe asking
-- the policy as the reader once a match was tried first: exact by
-- construction, but each probe is a statement of its own and re-asks the
-- policy's per-statement sets (match_read's my_fixture_ends() alone was
-- 41 ms for a parent), so 28 matches took 0.7 s a scan, slower than before.
-- So this view states the conditions, and two guards hold them to the
-- policies they state:
--   1. this file refuses to run, and db/99 §126 fails, if any SELECT policy
--      on ball_event, match or ball_event_rejudged is not the one this file
--      was written against (name, kind, roles and the md5 of its text, as
--      db/121 pins a view: the text, or the text with spacing and brackets
--      taken out and case folded, for another major version's deparse), or
--      if a SELECT policy on ball_event comes to read a column other than
--      match_id and school_id (pg_depend). A policy changed later fails the
--      verifier until this view is re-stated with it.
--   2. db/99 §126 compares the view, row for row, with db/121's own
--      definition run under row security, for every seeded reader, with a
--      ball planted at the other school to take the per-ball path.
--
-- WHY A VIEW AS ITS OWNER, against db/99 §9 ("a view in public runs as its
-- owner and bypasses row-level security"). The rule is right, and this view
-- is the one exception §9 names: an invoker view cannot scan ball_event
-- without the policy running on each row first (row security is a barrier no
-- other filter passes), and a definer function returning the rows cannot be
-- narrowed by the caller's filters (a read of one match would materialise
-- the season). The view outputs only balls the reader may read, and
-- security_barrier keeps any condition a caller adds from running on a row
-- before the view's own.
--
-- ball_event's policies stay exactly as they are, the guard for every direct
-- read of the table (the pad's events read, the fold, the definers).
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   + ball_event_row_visible(bigint): SECURITY INVOKER, STABLE, STRICT;
--     answers only "may I read this ball", which a SELECT of it answers
--   ~ ball_event_live: re-created with the same columns, in the same order,
--     and the same rows for every reader; security_invoker off,
--     security_barrier on; its owner and grants are kept (CREATE OR
--     REPLACE). No table, column, row or policy changes. It refuses to run
--     unless the view in place is db/121's or this file's own, so a second
--     paste changes nothing.
-- ══════════════════════════════════════════════════════════════════

-- §0 · The policies this view states, as this file was written against them.
-- NULL when every SELECT policy on ball_event, match and ball_event_rejudged
-- is the one below and ball_event's read only match_id and school_id; else
-- what differs, in words. Asked by §1 here and by db/99 §126. Each pin is the
-- md5 of pg_get_expr() of the policy's USING, or of it with spacing and
-- brackets taken out and the case folded (another major version's deparse).
CREATE OR REPLACE FUNCTION ball_log_policies_unpinned() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH pinned(tbl, pol, permissive, h_def, h_norm) AS (VALUES
    ('ball_event',          'ball_event_read',          true,  '9bb220903d6f0c5b3d2fdb388d7f655c', 'a0750e00fc3d67113ce036bbef20810e'),
    ('ball_event',          'pad_scope_select',         false, 'ec1511587ed03b51c85049fb4e35b26a', '0e917fc4c7b83b8676f405897bb9887c'),
    ('match',               'match_read',               true,  'f0d18d60b5bcbd933c057db0ae76530f', '602ddd7c17473c5d6d47b367e8debce4'),
    ('match',               'match_trip_driver_read',   true,  '1960704919400a7a8aab2d4bf063e09b', '2167c483ec11873e01c776690977aaca'),
    ('match',               'pad_scope_select',         false, '468d1e6704b29ab88ec11ed73614fc39', 'c2b2813d1f39e123381f6569761f9b15'),
    ('ball_event_rejudged', 'ball_event_rejudged_read', true,  '84fb99a88e6854f8e70469c3eae3d5f6', 'feb852cdca0ee0854c56984e31cbc70b'),
    ('ball_event_rejudged', 'pad_scope_select',         false, '468d1e6704b29ab88ec11ed73614fc39', 'c2b2813d1f39e123381f6569761f9b15')),
  live AS (
    SELECT c.relname::text AS tbl, p.polname::text AS pol, p.polpermissive AS permissive,
           p.polroles = ARRAY[0::oid] AS to_public,
           md5(pg_get_expr(p.polqual, p.polrelid)) AS h_def,
           md5(regexp_replace(lower(pg_get_expr(p.polqual, p.polrelid)), '[[:space:]()]+', '', 'g')) AS h_norm
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE p.polrelid IN ('ball_event'::regclass, 'match'::regclass, 'ball_event_rejudged'::regclass)
       AND p.polcmd IN ('r', '*')),
  wrong AS (
    SELECT format('%s.%s is not the policy db/147''s ball_event_live states', coalesce(l.tbl, k.tbl), coalesce(l.pol, k.pol)) AS why
      FROM pinned k FULL JOIN live l ON l.tbl = k.tbl AND l.pol = k.pol
     WHERE k.pol IS NULL OR l.pol IS NULL OR l.permissive <> k.permissive OR NOT l.to_public
        OR (l.h_def <> k.h_def AND l.h_norm <> k.h_norm)
    UNION ALL
    -- The observation: ball_event's SELECT policies read match_id and school_id alone.
    SELECT format('ball_event.%s reads %s of the row, not only match_id and school_id', p.polname, coalesce(a.attname::text, 'the whole row'))
      FROM pg_policy p
      JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = p.oid
                      AND d.refclassid = 'pg_class'::regclass AND d.refobjid = 'ball_event'::regclass
                      AND d.deptype = 'n'
      LEFT JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid AND d.refobjsubid > 0
     WHERE p.polrelid = 'ball_event'::regclass AND p.polcmd IN ('r', '*')
       AND coalesce(a.attname::text, '') NOT IN ('match_id', 'school_id'))
  SELECT string_agg(why, '; ' ORDER BY why) FROM wrong
$$;
COMMENT ON FUNCTION ball_log_policies_unpinned() IS
  'db/147: NULL while the SELECT policies of ball_event, match and ball_event_rejudged are those ball_event_live states once a match; else what changed. db/99 §126 asks it.';

-- §1 · What is in place is what this file was written against.
DO $guard$
DECLARE
  h_def  text := md5(pg_get_viewdef('ball_event_live'::regclass));
  h_norm text := md5(regexp_replace(lower(pg_get_viewdef('ball_event_live'::regclass)), '[[:space:]()]+', '', 'g'));
  wrong  text := ball_log_policies_unpinned();
BEGIN
  -- db/121's (taken on Postgres 16, and normalised for another deparse) or this file's.
  IF h_def NOT IN ('4618aeab505ce9ea9bdd2ec08ca6bed5', '259be9dfa724031db55add070a2eb149')
     AND h_norm NOT IN ('2adf337ed62990f2b8c5d39eefbe6fba', '0cd3dcf4abb5009419da48453372fcd9') THEN
    RAISE EXCEPTION 'db/147: ball_event_live is neither db/121''s nor this file''s (md5 %, normalised %); read what changed it before pasting', h_def, h_norm;
  END IF;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'db/147: %', wrong;
  END IF;
END $guard$;

-- §2 · The probe, for a ball not at its match's school: the reader's own
-- SELECT of it, under every ball_event policy as they stand. plpgsql, so it
-- is never inlined into the owner's query.
CREATE OR REPLACE FUNCTION ball_event_row_visible(p_id bigint) RETURNS boolean
  LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM ball_event WHERE id = p_id;
  RETURN FOUND;
END $$;
COMMENT ON FUNCTION ball_event_row_visible(bigint) IS
  'db/147: may the caller read this ball? Its own SELECT of the row by id, under ball_event''s policies (SECURITY INVOKER). ball_event_live asks it of a ball not at its match''s school.';
GRANT EXECUTE ON FUNCTION ball_event_row_visible(bigint) TO scrbrd_app;
GRANT EXECUTE ON FUNCTION ball_log_policies_unpinned() TO scrbrd_app;

-- §3 · ball_event_live: db/121's columns and rows, the policy asked once a match.
CREATE OR REPLACE VIEW ball_event_live WITH (security_invoker = false, security_barrier = true) AS
SELECT b.id, b.match_id, b.school_id, b.seq, b.epoch, b.innings,
       b.scorer_user_id, b.device_id, b.idempotency_key, b.client_seq, b.client_ts, b.server_ts,
       b.kind,
       CASE WHEN b.kind = 'retire' AND b.ball_type = 'W'
                 AND retirement_resumed(b.match_id, b.innings, b.seq, b.payload->>'batter') THEN NULL
            ELSE ball_type_as_folded(b.kind, b.ball_type) END AS ball_type,
       b.value, b.shot, b.contact, b.trajectory, b.seg, b.zone,
       -- db/121 (the Laws audit, F4): who faced, as the fold re-judged it.
       CASE WHEN r.seq IS NOT NULL THEN r.striker_id ELSE b.striker_id END AS striker_id,
       b.non_striker_id, b.bowler_id, b.dismissed_id,
       CASE WHEN b.kind = 'retire' AND b.ball_type = 'W'
                 AND retirement_resumed(b.match_id, b.innings, b.seq, b.payload->>'batter') THEN NULL
            ELSE b.dismissal END AS dismissal,
       b.payload, b.recovered,
       b.theta, b.radius, b.placement_source, b.placement_null, b.close_position, b.capture_profile,
       -- db/71: the nth super over this row's innings is, from the innings' last
       -- innings_start that counts. Each row read is one the reader may read:
       -- the same match and school as this readable ball, or asked of itself.
       (SELECT innings_super_over(s.payload)
          FROM ball_event s
         WHERE s.match_id = b.match_id AND s.innings = b.innings AND s.kind = 'innings_start'
           AND (s.school_id = b.school_id OR ball_event_row_visible(s.id))
           AND NOT EXISTS (SELECT 1 FROM ball_event v
                            WHERE v.match_id = s.match_id AND v.kind = 'void' AND v.payload->>'target' = s.idempotency_key
                              AND (v.school_id = s.school_id OR ball_event_row_visible(v.id)))
         ORDER BY s.seq DESC LIMIT 1)                                   AS super_over
  FROM (
         -- A ball at its match's school: ball_event_read and ball_event's pad
         -- guard, asked once of the match (§0 pins the policies stated here).
         SELECT e.* FROM ball_event e
          WHERE (e.match_id, e.school_id) IN (
                  SELECT m.id, m.school_id FROM match m
                   WHERE -- Row security does not apply to the caller (the table's
                         -- owner, a definer of his, a role that bypasses it): no
                         -- policy, as for db/121's view read by the same caller.
                         NOT row_security_active('ball_event'::regclass)
                      OR ( -- pad_scope_select (db/50): a pad's credential reads its own match
                         COALESCE(((NOT app_pad_scoped()) OR (m.id = app_pad_match())), false)
                     AND ( -- ball_event_read, its arms in its own order: the host's
                           -- branch (db/02, db/129)
                           (app_can('fixture.read'::text, m.school_id, match_team(m.id), NULL::uuid, m.id)
                            AND ((NOT (SELECT app_reader_is_pupil())) OR (m.id = ANY ((SELECT my_own_side_fixtures())::uuid[]))
                                 OR pupil_side_on('fixture.read'::text, m.school_id, match_team(m.id), NULL::uuid, m.id)))
                           -- the away branch (db/97), its read of match under match's own policies
                        OR ((m.away_school_id IS NOT NULL)
                            AND app_can('fixture.read'::text, m.away_school_id, m.away_team_code, NULL::uuid, m.id)
                            AND ((NOT (SELECT app_reader_is_pupil())) OR (m.id = ANY ((SELECT my_own_side_fixtures())::uuid[]))
                                 OR pupil_side_on('fixture.read'::text, m.away_school_id, m.away_team_code, NULL::uuid, m.id))
                            -- match under its own row security, if it applies to the caller
                            AND ((NOT row_security_active('match'::regclass))
                             OR (-- match's pad_scope_select (RESTRICTIVE)
                                 (NOT app_pad_scoped())
                            AND ( -- match_trip_driver_read
                                  (m.id IN (SELECT trip_driven_matches()))
                                  -- match_read
                               OR (app_can('fixture.read'::text, m.school_id, m.team_code, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, m.id)
                                   AND ((NOT (SELECT app_reader_is_pupil()))
                                        OR pupil_side_on('fixture.read'::text, m.school_id, m.team_code, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, m.id)))
                               OR (app_can('fixture.read'::text, m.away_school_id, m.away_team_code, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, m.id)
                                   AND ((NOT (SELECT app_reader_is_pupil()))
                                        OR pupil_side_on('fixture.read'::text, m.away_school_id, m.away_team_code, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, m.id)))
                               OR (m.id IN (SELECT r.match_id FROM my_fixture_ends('fixture.read'::text) r(match_id, school_id, team_code)))))))
                           -- the session's own fixtures
                        OR (m.id = ANY ((SELECT my_child_fixtures())::uuid[]))
                        OR (m.id = ANY ((SELECT my_own_sheet_fixtures())::uuid[]))
                        OR (m.id = ANY ((SELECT my_own_side_fixtures())::uuid[])))))
         UNION ALL
         -- A ball at any other school: asked of the ball itself. The probe's
         -- argument is NULL (STRICT: never called) for a ball at its match's
         -- school, which the branch above has.
         SELECT e.* FROM ball_event e JOIN match m ON m.id = e.match_id
          WHERE ball_event_row_visible(CASE WHEN e.school_id <> m.school_id THEN e.id END)
       ) b
  -- ball_event_rejudged_read is "its ball is readable", which b is, under the
  -- table's pad guard (§0 pins both).
  LEFT JOIN ball_event_rejudged r ON r.match_id = b.match_id AND r.seq = b.seq
                                 AND ((NOT row_security_active('ball_event_rejudged'::regclass)) OR (NOT app_pad_scoped()))
 WHERE b.kind <> 'void'
   -- NOT EXISTS rather than NOT IN, as db/02 explains.
   AND NOT EXISTS (
         SELECT 1 FROM ball_event v
          WHERE v.match_id = b.match_id
            AND v.kind = 'void'
            AND v.payload->>'target' = b.idempotency_key
            AND (v.school_id = b.school_id OR ball_event_row_visible(v.id)));

COMMENT ON VIEW ball_event_live IS
  'db/147: the ball log as the reader may read it, voids applied. Runs as its owner (security_barrier) and asks ball_event''s read conditions as the reader once a match; ball_log_policies_unpinned() and db/99 §126 hold it to the policies and to db/121''s rows.';

-- §4 · What this file made is what it says.
DO $check$
DECLARE
  opts text[] := (SELECT reloptions FROM pg_class WHERE oid = 'ball_event_live'::regclass);
BEGIN
  IF NOT (opts @> ARRAY['security_barrier=true'] AND opts @> ARRAY['security_invoker=false']) THEN
    RAISE EXCEPTION 'db/147: ball_event_live is not an owner''s security barrier view (%)', opts;
  END IF;
  IF (SELECT relowner FROM pg_class WHERE oid = 'ball_event_live'::regclass)
     <> (SELECT relowner FROM pg_class WHERE oid = 'ball_event'::regclass) THEN
    RAISE EXCEPTION 'db/147: ball_event_live is not owned by ball_event''s owner';
  END IF;
  IF (SELECT prosecdef OR NOT proisstrict FROM pg_proc WHERE oid = 'ball_event_row_visible(bigint)'::regprocedure) THEN
    RAISE EXCEPTION 'db/147: the probe runs as its owner or is not STRICT';
  END IF;
END $check$;
