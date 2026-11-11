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
--                                  read of one match tests that match alone.
--   a ball at another school       one whose school_id is not its match's
--                                  (every writer stamps the match's school,
--                                  so none today, but nothing forbids one):
--                                  admitted only if the reader's own SELECT of
--                                  ball_event returns it (ball_event_visible_
--                                  ids(), under every policy as it stands)
--   the void and super-over reads  a void or an innings_start of the same
--                                  match at the same school as a readable
--                                  ball is readable (the observation); any
--                                  other only if ball_event_visible_ids() has it
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
-- IT FAILS CLOSED (the security review's B1). The conditions are written out,
-- so they hold only while the policies are the ones they restate. Two pins:
--   the text pin   ball_log_text_pinned(): every SELECT policy on ball_event,
--                  match and ball_event_rejudged exactly as this file was
--                  written against it (name, kind, roles, the md5 of its text
--                  with only its whitespace normalised: brackets and case
--                  count, the review's S1), ball_event's policies reading
--                  match_id and school_id alone (pg_depend), and this view's
--                  own text (S2). A deparse costs milliseconds, so it is asked
--                  at the paste, by the verifier, and by ball_log_repin().
--   the live pin   ball_log_pinned(), asked by the view at every use: the
--                  catalogue rows of those policies and of this view's rule,
--                  each by its oid and the transaction that last wrote it
--                  (xmin), against the fingerprint ball_log_repin() recorded
--                  once the text pin held. Any CREATE, ALTER or DROP POLICY on
--                  the three tables, and any re-creation of this view, changes
--                  it at once, in that transaction and every later one.
-- When the live pin does not hold, the view stops using the restated
-- conditions AND the shortcuts that stand on the observation, and admits
-- exactly the rows the reader's own SELECT of each table returns:
-- ball_event_visible_ids() and ball_event_rejudged_visible_keys(), SECURITY
-- INVOKER, so every policy as it stands, RESTRICTIVE ones included, applies at
-- once. That path is exact and costs what db/121's view cost (one
-- row-security scan of the log a scan). The verifier goes red (§9, §126)
-- until the view is re-stated for the new policies and re-pinned. A restore
-- into a new database (new xmins) also reads unpinned, so exact and slow,
-- until the owner runs `SELECT ball_log_repin()`, which re-pins only if the
-- text pin holds.
--
-- WHY THE CONDITIONS ARE WRITTEN OUT. A probe asking the policy as the reader
-- once a match was tried first: exact by construction, but each probe is a
-- statement of its own and re-asks the policy's per-statement sets
-- (match_read's my_fixture_ends() alone was 41 ms for a parent), so 28
-- matches took 0.7 s a scan, slower than before. db/99 §126 compares the
-- view, row for row, with db/121's own definition run under row security,
-- for every seeded reader, on a pad's credential at either side's fixtures, in
-- a support session, with row security lifted from match, with a ball planted
-- at the other school, and with a RESTRICTIVE policy added (the fallback).
--
-- WHY A VIEW AS ITS OWNER, against db/99 §9 ("a view in public runs as its
-- owner and bypasses row-level security"). The rule is right, and this view
-- is the one exception §9 names: an invoker view cannot scan ball_event
-- without the policy running on each row first (row security is a barrier no
-- other filter passes), and a definer function returning the rows cannot be
-- narrowed by the caller's filters (a read of one match would materialise
-- the season). The view outputs only balls the reader may read, and
-- security_barrier keeps any condition a caller adds from running on a row
-- before the view's own. Only scrbrd_app may select from it (S4).
--
-- ball_event's policies stay exactly as they are, the guard for every direct
-- read of the table (the pad's events read, the fold, the definers).
--
-- THE TEXT PINS ARE POSTGRES 16'S DEPARSE. On a server whose deparse of these
-- policies or of this view differs by more than whitespace, this file
-- refuses to run (§1 or §5), naming what differs: re-take the pins on that
-- version before pasting. Nothing is half-applied (the paste is one
-- transaction).
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   + ball_log_pin: one row, the live pin's fingerprint; row security on, no
--     policy, no privilege for the application (the definers read it)
--   + ball_log_norm(text), ball_log_policies_unpinned(),
--     ball_log_text_pinned(), ball_log_fingerprint(): catalogue reads,
--     SECURITY INVOKER
--   + ball_log_pinned(): the live pin, SECURITY DEFINER (it reads
--     ball_log_pin), EXECUTE for scrbrd_app; ball_log_repin(): SECURITY
--     DEFINER, the owner's alone
--   + ball_event_visible_ids(), ball_event_rejudged_visible_keys(): the
--     caller's own SELECT of the two tables, SECURITY INVOKER; EXECUTE for
--     scrbrd_app only
--   ~ ball_event_live: re-created with the same columns, in the same order,
--     and the same rows for every reader; security_invoker off,
--     security_barrier on; its owner kept; SELECT for scrbrd_app only
--     (PUBLIC, anon and authenticated revoked where they exist). No table,
--     column, row or policy changes. It refuses to run unless the view in
--     place is db/121's or this file's own, so a second paste changes nothing.
-- ══════════════════════════════════════════════════════════════════

-- §0 · The pins.
-- Whitespace only: brackets carry precedence and a literal's case is its
-- value, so neither is folded (S1).
CREATE OR REPLACE FUNCTION ball_log_norm(p text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT
  SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT regexp_replace(btrim(p), '[[:space:]]+', ' ', 'g') $$;
COMMENT ON FUNCTION ball_log_norm(text) IS
  'db/147: a policy''s or view''s deparse with its whitespace normalised (nothing else) for the pins.';

-- NULL when every SELECT policy on ball_event, match and ball_event_rejudged
-- is the one below and ball_event's read only match_id and school_id; else
-- what differs, in words. Asked by §1 here, by ball_log_pinned() on every
-- scan of ball_event_live, and by db/99 §9 and §126.
CREATE OR REPLACE FUNCTION ball_log_policies_unpinned() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH pinned(tbl, pol, permissive, h) AS (VALUES
    ('ball_event',          'ball_event_read',          true,  '9e64211c80c1a211a6750760025f540f'),
    ('ball_event',          'pad_scope_select',         false, 'ec1511587ed03b51c85049fb4e35b26a'),
    ('match',               'match_read',               true,  '33a31e3efc91b9a2ec4bbad234ff1e64'),
    ('match',               'match_trip_driver_read',   true,  '1960704919400a7a8aab2d4bf063e09b'),
    ('match',               'pad_scope_select',         false, '468d1e6704b29ab88ec11ed73614fc39'),
    ('ball_event_rejudged', 'ball_event_rejudged_read', true,  '211d2062a7897d3047fcff3da662945b'),
    ('ball_event_rejudged', 'pad_scope_select',         false, '468d1e6704b29ab88ec11ed73614fc39')),
  live AS (
    SELECT c.relname::text AS tbl, p.polname::text AS pol, p.polpermissive AS permissive,
           p.polroles = ARRAY[0::oid] AS to_public,
           md5(ball_log_norm(pg_get_expr(p.polqual, p.polrelid))) AS h
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE p.polrelid IN ('ball_event'::regclass, 'match'::regclass, 'ball_event_rejudged'::regclass)
       AND p.polcmd IN ('r', '*')),
  wrong AS (
    SELECT format('%s.%s is not the policy db/147''s ball_event_live states', coalesce(l.tbl, k.tbl), coalesce(l.pol, k.pol)) AS why
      FROM pinned k FULL JOIN live l ON l.tbl = k.tbl AND l.pol = k.pol
     WHERE k.pol IS NULL OR l.pol IS NULL OR l.permissive IS DISTINCT FROM k.permissive
        OR NOT l.to_public OR l.h IS DISTINCT FROM k.h
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
  'db/147: NULL while the SELECT policies of ball_event, match and ball_event_rejudged are those ball_event_live states once a match; else what changed.';

-- The text pin: the policies pinned AND ball_event_live this file's own text
-- (S2). Milliseconds (two deparses): the paste, the verifier and the re-pin
-- ask it, never a read.
CREATE OR REPLACE FUNCTION ball_log_text_pinned() RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT ball_log_policies_unpinned() IS NULL
     AND md5(ball_log_norm(pg_get_viewdef('ball_event_live'::regclass))) = '818cb7d85603be38940bfa87ea48ed01'
$$;
COMMENT ON FUNCTION ball_log_text_pinned() IS
  'db/147: true while the SELECT policies of ball_event, match and ball_event_rejudged and ball_event_live''s own text are those db/147 pinned.';

-- The live pin's fingerprint: each SELECT policy row of the three tables and
-- ball_event_live's rule, by oid and by the transaction that last wrote it.
-- Catalogue index reads, well under a millisecond; any CREATE, ALTER or DROP
-- POLICY there, or CREATE OR REPLACE of the view, changes it.
CREATE OR REPLACE FUNCTION ball_log_fingerprint() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce((SELECT string_agg(p.oid::text || ':' || p.xmin::text, ',' ORDER BY p.oid)
                     FROM pg_policy p
                    WHERE p.polrelid IN ('ball_event'::regclass, 'match'::regclass, 'ball_event_rejudged'::regclass)
                      AND p.polcmd IN ('r', '*')), '')
      || '|' ||
         coalesce((SELECT r.oid::text || ':' || r.xmin::text FROM pg_rewrite r
                    WHERE r.ev_class = 'ball_event_live'::regclass AND r.rulename = '_RETURN'), '')
$$;
COMMENT ON FUNCTION ball_log_fingerprint() IS
  'db/147: the catalogue rows ball_event_live''s restated conditions stand on (the three tables'' SELECT policies and the view''s rule), by oid and xmin.';

CREATE TABLE IF NOT EXISTS ball_log_pin (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fingerprint text NOT NULL,
  pinned_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ball_log_pin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ball_log_pin FROM PUBLIC;
COMMENT ON TABLE ball_log_pin IS
  'db/147: the fingerprint ball_log_repin() recorded once the text pin held. ball_log_pinned() compares the live catalogue with it.';

-- The live pin: asked by ball_event_live at every use. A definer only to read
-- ball_log_pin; the catalogue it compares is the same for every caller.
CREATE OR REPLACE FUNCTION ball_log_pinned() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce((SELECT p.fingerprint = ball_log_fingerprint() FROM ball_log_pin p WHERE p.id = 1), false)
$$;
COMMENT ON FUNCTION ball_log_pinned() IS
  'db/147: true while nothing ball_event_live''s restated conditions stand on has changed since ball_log_repin(); false sends the view down the exact path.';

-- The re-pin: the owner's, after this file, after a restore (new xmins), or
-- after a re-statement of the view. It records the fingerprint only if the
-- text pin holds, and says what differs if not.
CREATE OR REPLACE FUNCTION ball_log_repin() RETURNS text
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT ball_log_text_pinned() THEN
    RAISE EXCEPTION 'ball_log_repin: not pinned: %',
      coalesce(ball_log_policies_unpinned(), 'ball_event_live is not db/147''s text');
  END IF;
  INSERT INTO ball_log_pin (id, fingerprint) VALUES (1, ball_log_fingerprint())
  ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, pinned_at = now();
  RETURN ball_log_fingerprint();
END $$;
COMMENT ON FUNCTION ball_log_repin() IS
  'db/147: re-record ball_event_live''s live pin, only if its text pin holds. The owner''s alone.';
REVOKE ALL ON FUNCTION ball_log_repin() FROM PUBLIC;
REVOKE ALL ON FUNCTION ball_log_pinned() FROM PUBLIC;

-- §1 · What is in place is what this file was written against.
DO $guard$
DECLARE
  h_def  text := md5(pg_get_viewdef('ball_event_live'::regclass));
  h_norm text := md5(ball_log_norm(pg_get_viewdef('ball_event_live'::regclass)));
  wrong  text := ball_log_policies_unpinned();
BEGIN
  -- db/121's (taken on Postgres 16, exactly or with its whitespace normalised) or this file's.
  IF h_def <> '4618aeab505ce9ea9bdd2ec08ca6bed5'
     AND h_norm NOT IN ('e03b4e5540e04513a0d53734b02c837e', '818cb7d85603be38940bfa87ea48ed01') THEN
    RAISE EXCEPTION 'db/147: ball_event_live is neither db/121''s nor this file''s (md5 %, normalised %); read what changed it before pasting', h_def, h_norm;
  END IF;
  IF wrong IS NOT NULL THEN
    RAISE EXCEPTION 'db/147: %', wrong;
  END IF;
END $guard$;

-- §2 · The exact path: the caller's own SELECT of each table, under every
-- policy as it stands. plpgsql, so never inlined into the owner's query.
CREATE OR REPLACE FUNCTION ball_event_visible_ids() RETURNS SETOF bigint
  LANGUAGE plpgsql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY SELECT b.id FROM ball_event b;
END $$;
COMMENT ON FUNCTION ball_event_visible_ids() IS
  'db/147: the ids of the balls the caller may read: its own SELECT of ball_event, under ball_event''s policies (SECURITY INVOKER). ball_event_live''s exact path.';

CREATE OR REPLACE FUNCTION ball_event_rejudged_visible_keys() RETURNS TABLE (match_id uuid, seq integer)
  LANGUAGE plpgsql STABLE SECURITY INVOKER
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY SELECT r.match_id, r.seq FROM ball_event_rejudged r;
END $$;
COMMENT ON FUNCTION ball_event_rejudged_visible_keys() IS
  'db/147: the re-judged strikers (db/121) the caller may read: its own SELECT of ball_event_rejudged (SECURITY INVOKER). ball_event_live''s exact path.';

REVOKE ALL ON FUNCTION ball_event_visible_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION ball_event_rejudged_visible_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ball_event_visible_ids() TO scrbrd_app;
GRANT EXECUTE ON FUNCTION ball_event_rejudged_visible_keys() TO scrbrd_app;
GRANT EXECUTE ON FUNCTION ball_log_pinned() TO scrbrd_app;
GRANT EXECUTE ON FUNCTION ball_log_policies_unpinned() TO scrbrd_app;
GRANT EXECUTE ON FUNCTION ball_log_text_pinned() TO scrbrd_app;
GRANT EXECUTE ON FUNCTION ball_log_fingerprint() TO scrbrd_app;

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
       -- pinned, the same match and school as this readable ball; else the
       -- reader's own SELECT has it.
       (SELECT innings_super_over(s.payload)
          FROM ball_event s
         WHERE s.match_id = b.match_id AND s.innings = b.innings AND s.kind = 'innings_start'
           AND CASE WHEN (SELECT ball_log_pinned()) AND s.school_id = b.school_id THEN true
                    ELSE s.id IN (SELECT ball_event_visible_ids()) END
           AND NOT EXISTS (SELECT 1 FROM ball_event v
                            WHERE v.match_id = s.match_id AND v.kind = 'void' AND v.payload->>'target' = s.idempotency_key
                              AND CASE WHEN (SELECT ball_log_pinned()) AND v.school_id = s.school_id THEN true
                                       ELSE v.id IN (SELECT ball_event_visible_ids()) END)
         ORDER BY s.seq DESC LIMIT 1)                                   AS super_over
  FROM (
         -- Pinned: a ball at its match's school. ball_event_read and
         -- ball_event's pad guard, asked once of the match (§0 pins the
         -- policies stated here).
         SELECT e.* FROM ball_event e
          WHERE (SELECT ball_log_pinned())
            AND (e.match_id, e.school_id) IN (
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
         -- Pinned: a ball at any other school, only if the reader's own
         -- SELECT has it (asked only for such a ball: none today).
         SELECT e.* FROM ball_event e JOIN match m ON m.id = e.match_id
          WHERE (SELECT ball_log_pinned())
            AND CASE WHEN e.school_id <> m.school_id THEN e.id IN (SELECT ball_event_visible_ids()) ELSE false END
         UNION ALL
         -- Not pinned: exactly the balls the reader's own SELECT returns.
         SELECT e.* FROM ball_event e
          WHERE NOT (SELECT ball_log_pinned())
            AND e.id IN (SELECT ball_event_visible_ids())
       ) b
  -- ball_event_rejudged_read is "its ball is readable", which b is, under the
  -- table's pad guard (§0 pins both); not pinned, the reader's own SELECT.
  LEFT JOIN ball_event_rejudged r ON r.match_id = b.match_id AND r.seq = b.seq
                                 AND CASE WHEN (SELECT ball_log_pinned())
                                          THEN (NOT row_security_active('ball_event_rejudged'::regclass)) OR (NOT app_pad_scoped())
                                          ELSE (r.match_id, r.seq) IN (SELECT k.match_id, k.seq FROM ball_event_rejudged_visible_keys() k) END
 WHERE b.kind <> 'void'
   -- NOT EXISTS rather than NOT IN, as db/02 explains.
   AND NOT EXISTS (
         SELECT 1 FROM ball_event v
          WHERE v.match_id = b.match_id
            AND v.kind = 'void'
            AND v.payload->>'target' = b.idempotency_key
            AND CASE WHEN (SELECT ball_log_pinned()) AND v.school_id = b.school_id THEN true
                     ELSE v.id IN (SELECT ball_event_visible_ids()) END);

COMMENT ON VIEW ball_event_live IS
  'db/147: the ball log as the reader may read it, voids applied. Runs as its owner (security_barrier) and asks ball_event''s read conditions as the reader once a match while ball_log_pinned(); else the reader''s own SELECT. db/99 §9 and §126 hold it.';

-- §4 · Who may select from it (S4): the application, and only SELECT.
REVOKE ALL ON ball_event_live FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ball_event_live FROM %I', r);
    END IF;
  END LOOP;
END $grants$;
REVOKE ALL ON ball_event_live FROM scrbrd_app;
GRANT SELECT ON ball_event_live TO scrbrd_app;

-- §5 · What this file made is what it says.
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
  IF EXISTS (SELECT 1 FROM pg_proc WHERE prosecdef AND oid IN ('ball_event_visible_ids()'::regprocedure,
               'ball_event_rejudged_visible_keys()'::regprocedure, 'ball_log_policies_unpinned()'::regprocedure,
               'ball_log_text_pinned()'::regprocedure, 'ball_log_fingerprint()'::regprocedure))
     OR EXISTS (SELECT 1 FROM pg_proc WHERE NOT prosecdef AND oid IN ('ball_log_pinned()'::regprocedure, 'ball_log_repin()'::regprocedure)) THEN
    RAISE EXCEPTION 'db/147: an exact-path or pin function runs as the wrong role';
  END IF;
  -- The text pin must hold now (it raises, naming what differs, if not) …
  PERFORM ball_log_repin();
  -- … and the live pin with it, in this transaction.
  IF NOT ball_log_pinned() THEN
    RAISE EXCEPTION 'db/147: ball_event_live is not pinned after its own paste';
  END IF;
END $check$;
