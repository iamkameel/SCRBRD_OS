-- ══════════════════════════════════════════════════════════════════
--  131 · REACH's last slices: a spectator reads every side's team posts
--        (R-G); the team sheet to the side's families, names and order (R-H)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. docs/design/REACH_parent_pupil.md, build groups R-G (§6.7)
-- and R-H (§6.8), as Kameel decided them on 4 November 2026 (§7, "Decided 4
-- November 2026"). Its proofs are db/99 §108 (R-G) and §109 (R-H); R-I
-- (§6.9) adds no SQL and is proved in §110.
--
-- ══ R-G · A SPECTATOR READS EVERY SIDE'S TEAM POSTS ══════════════════
--
-- Kameel, 4 Nov 2026: "Spectators can see all matches. Just a lesser level
-- of detail and information regarding player stats and passports." Then
-- (a): a spectator reads EVERY side's team posts at his school, scoped or
-- not. This replaces REACH-D3's "only when scoped" (14 Oct). Still no plans
-- (team.read, db/96, unchanged); still no player capability, so no career
-- figures and no passports. And db/101's rule (db/99 §78) stands for
-- everybody else who holds news.read without reading a side: finance,
-- sponsorship, a driver and facilities read no team post.
--
-- WHY A CAPABILITY. db/101's side test (news_plan_reach(), db/117/db/129)
-- asks team.read, which no spectator holds, so he read no team post at all.
-- Asking news.read instead would also hand every team post to the four
-- roles above, which hold news.read school-wide (app_can() fits an
-- assignment with no team to every side). ADR 0003 allows no role name in a
-- policy, so the difference is a capability of its own:
--   news.team.read   read every side's team posts at the school (not its
--                    plans). Held by `spectator` (roles.mjs) and the owner's
--                    key (`superadmin`: every capability but safeguarding's).
--                    ADDED_SINCE_01 in services/api/rls/generate-rls.mjs
--                    keeps it out of db/01; this file inserts it.
-- It is asked with the team argument '*' — any side, whatever side the
-- assignment names — and the all-f person ("unnamed assignments only"), so
-- a scoped spectator reads every side's posts as a school-wide one does, and
-- a named assignment never reaches it by naming a boy.
--
-- WHAT CHANGES, nothing removed
--   + capability news.team.read; role_capability (spectator), (superadmin)
--   + news_team_wide_post(post)   the post is a team post that is not a
--       plan, and the caller holds news.team.read at its school. Definer, as db/101's are: the policies ask it of a post the
--       caller's own policies may not show him.
--   + news_team_wide_notice(kind, subject_kind, post, capability, child,
--       recipient)  a notice about such a post, with no child and no
--       recipient, under news.read: the notice follows the post (§3.2)
--   ~ news_post_team_side (db/101, as db/117 left it)  ALTER POLICY: its
--       USING gains "a team post that is not a plan, to news.team.read".
--       ALTER in place, not DROP and CREATE (the paste tool hangs on a
--       statement that removes an object); the guard below refuses if its
--       text is not db/117's or this file's.
--   + news_post_read_team_wide   PERMISSIVE, SELECT on news_post: a sent team
--       post that is not a plan, to news.team.read. A school-wide spectator
--       already passed db/12's news_post_read (news.read at any team); a
--       scoped one passes it only at his own side, and a RESTRICTIVE policy
--       can only take away.
--   ~ news_team_notice_reach(post) (db/101, as db/117 left it)  CREATE OR
--       REPLACE: a team post's notice also reaches news.team.read. Every
--       other line is db/117's (md5 guard).
--   + notification_read_team_wide  PERMISSIVE, SELECT on notification: that
--       notice, to the same reader (the scoped spectator, as above).
--   ~ notification_report(notice) (db/91, as db/101 and db/123 left it)
--       its reader test re-asks the read policies (CSA SG-9 rule 4: any
--       reader may report), so it gains the new permissive's branch; every
--       other line stands (md5 guard; the change is one replace, checked).
--
-- ══ R-H · THE TEAM SHEET TO THE SIDE'S FAMILIES ═════════════════════
--
-- STEP4 Q10 (Kameel, 27 Sep 2026): "it can allow for logistics between
-- parents to be arranged or communicated. The shape to build: signed in, her
-- own child's side and fixture only, the named players and their order —
-- names only, no profiles, ages or photos. A narrow read over
-- `match_squad`, not `player.profile.read`." And on 4 Nov 2026 (§7): the
-- sheet reaches parents when the coach saves it, as it reaches pupils; and
-- it opens only to the boy's family (live, verified link), the boy himself,
-- and the side's staff — a named enquiry grant about one boy no longer
-- opens the whole sheet.
--
-- WHY A FUNCTION. match_squad_read (db/09, dated for a pupil by db/129)
-- gives a guardian one row of a sheet: her own child's, asked about by his
-- id. Widening that policy would hand her every row of every sheet her
-- child's side plays, with the player id that opens each boy's other rows.
-- The decision is narrower: the names and the order, nothing else, and only
-- of a sheet her child is on. So the policy stays as it is (the staff's and
-- the side's full read, §3.5) and this is a definer read with its own
-- columns.
--
-- THE READ
--   fixture_sheet(match) → (side, batting_no, twelfth, name)
--     For each end of the fixture (home; away when the away school is on
--     SCRBRD), that end's sheet as it stands — every row not withdrawn, in
--     batting order, the twelfth man after the eleven, a reserve with no
--     number after them — when the caller is, for some boy on that end's
--     live sheet:
--       his family          is_family_of(boy): her live, verified guardian
--                           link, or his own self link (db/08, db/119)
--       the boy himself     his own account (my_own_boy(), db/106)
--     or is the side's staff: an assignment naming nobody, not a pupil's
--     `player` row, holding player.profile.read at that end's school and
--     team for this fixture — app_can_but_player() (db/129) with the all-f
--     person. That is the side's coach, assistant and team manager, the
--     fixture's scorer, and the school's own staff who read every side (the
--     office, the director of sport).
--     Otherwise nothing of that end. Refused, so: a spectator (no
--     player.profile.read), a guardian whose child is not on that end's
--     sheet, a team-mate who is not on it (his `player` row is the side's,
--     not the sheet's), a named enquiry grant about one boy (db/99 §109
--     (enquiry)), the other school's end of the same fixture, and anybody
--     signed out. The other school's parent reads her own end and not this
--     school's, which is why the read answers per end.
--   It is never wider than match_squad_read: every reader it admits to an
--   end reads a live row of that end there too (db/99 §109 (policy)).
--
-- WHAT IT NEVER RETURNS. No player_id, no school or team of a boy, no age,
-- no number, no photo, no availability, no fitness: four columns, named
-- here, and nothing joined onto them. db/99 §109 (columns) asserts the
-- result's shape, so a column added later goes red there.
--
-- "PUBLISHED" (Kameel, 4 Nov 2026: "the sheet reaches parents when the
-- coach saves it, as it reaches pupils"). match_squad records no
-- publication step: a row is the sheet from the moment the coach saves it
-- (events-api.mjs squadRoutes.select), and a boy taken off is withdrawn, not
-- deleted (db/00). So a sheet with a row not withdrawn is out, to the
-- families as to the side; one with nothing saved yet, or every row
-- withdrawn, returns nothing.
--
-- NAMES. full_name, as the side's own squad read (read-api.mjs match_squad)
-- names each boy. Signed in, never public: nothing here reaches a public
-- page, and the public projection (SCRBRD-083) is not touched.
--
-- ══ BOTH ═════════════════════════════════════════════════════════════
--
-- EXISTING ROWS. Nothing inserted, changed or deleted but the catalogue's
-- two rows. A team post that is not a plan, and its notice, start reading to
-- every spectator at its school on the paste; nothing else reads wider.
-- Safe to run twice: CREATE OR REPLACE, ON CONFLICT DO NOTHING, ALTER POLICY
-- to the same text, a policy created only when pg_policies lacks it, and
-- grants that end where they began.
--
-- WHO MAY CALL WHAT
--   fixture_sheet(uuid)               scrbrd_app (GET /api/matches/:id/sheet, as the caller)
--   news_team_wide_post(uuid)         scrbrd_app (the policies, as the caller)
--   news_team_wide_notice(text, text, uuid, text, uuid, uuid)   scrbrd_app (likewise)
--   news_team_notice_reach(uuid)      as db/101 left it (scrbrd_app)
--   notification_report(uuid)         as db/123 left it (scrbrd_app)
-- And none to PUBLIC, nor to a managed host's anon, authenticated or
-- service_role.

-- ── 0 · What it needs, and what it replaces ────────────────────────
DO $guard$
DECLARE r record; v_src text; v_md5 text;
BEGIN
  IF to_regclass('match_squad') IS NULL OR to_regclass('news_post') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('app_can_but_player(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('is_family_of(uuid)') IS NULL
     OR to_regprocedure('my_own_boy()') IS NULL
     OR to_regprocedure('news_plan_reach(uuid,text,date)') IS NULL
     OR to_regprocedure('news_own_old_side(uuid,text,date)') IS NULL
     OR to_regprocedure('news_sheet_reach(uuid,uuid,text)') IS NULL
     OR to_regprocedure('news_notice_sheet(uuid,uuid,text)') IS NULL
     OR to_regprocedure('news_post_day(text,uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'db/131: the side''s posts (db/101, db/117) or the dated pupil reach (db/129) is missing; apply them first';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('news_team_notice_reach(uuid)', '2eb9d64d17a6e0c45a988988c8d5a436', '8ff3be8c4ca455f6b6b439dfb883b856', 'db/117'),
      ('notification_report(uuid)',    'bc6a72b570cd91ce66a7582b0edb04f5', 'cd7d5aae9bd3444fe0de28b9a739591c', 'db/123'))
      AS x(fn, was, mine, src)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.fn);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/131: % (%) is not there to re-create', r.fn, r.src;
    END IF;
    v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
    IF v_md5 NOT IN (r.was, r.mine) THEN
      RAISE EXCEPTION 'db/131: % is not %''s or this file''s (md5 % of its folded body); look before replacing it', r.fn, r.src, v_md5;
    END IF;
  END LOOP;
  SELECT md5(pg_get_expr(p.polqual, p.polrelid)) INTO v_md5 FROM pg_policy p
   WHERE p.polrelid = 'news_post'::regclass AND p.polname = 'news_post_team_side';
  IF v_md5 IS DISTINCT FROM 'f08bbf58861dfc24d80724babeff25a5' AND v_md5 IS DISTINCT FROM '9209b1b39afb058553bbb7e0478ef4ce' THEN
    RAISE EXCEPTION 'db/131: news_post_team_side is not db/117''s or this file''s (md5 %); look first', coalesce(v_md5, '(missing)');
  END IF;
END $guard$;


-- ══════════════════════════════════════════════════════════════════
--  R-G · Every side's team posts, to news.team.read
-- ══════════════════════════════════════════════════════════════════

INSERT INTO capability (name) VALUES ('news.team.read') ON CONFLICT (name) DO NOTHING;
INSERT INTO role_capability (role, capability) VALUES
  ('spectator',  'news.team.read'),
  -- The owner's key: every capability but safeguarding's (roles.mjs).
  ('superadmin', 'news.team.read')
ON CONFLICT DO NOTHING;

-- A team post that is not a plan, at a school where the caller holds
-- news.team.read on an assignment naming nobody, whatever side it names.
CREATE OR REPLACE FUNCTION news_team_wide_post(p_post uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM news_post n
                  WHERE n.id = p_post AND n.scope = 'team' AND n.kind <> 'plan'
                    AND app_can('news.team.read', n.school_id, '*',
                                'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '00000000-0000-0000-0000-000000000000'::uuid))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- That post's notice: the post's own, under news.read, naming no child and
-- sent to nobody in particular (a recipient's notice is his alone, db/57).
CREATE OR REPLACE FUNCTION news_team_wide_notice(p_kind text, p_subject_kind text, p_post uuid, p_cap text,
                                                 p_child uuid, p_recipient uuid) RETURNS boolean AS $$
  SELECT p_kind = 'notice' AND p_subject_kind = 'news' AND p_post IS NOT NULL AND p_cap = 'news.read'
     AND p_child IS NULL AND p_recipient IS NULL AND news_team_wide_post(p_post)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/117's, with the one line marked. A plan still reaches only its side and
-- its sheet.
CREATE OR REPLACE FUNCTION news_team_notice_reach(p_post uuid) RETURNS boolean AS $$
  SELECT coalesce((SELECT CASE WHEN n.scope <> 'team' THEN true
                               WHEN n.author_id = app_user_id() THEN true
                               WHEN news_plan_reach(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at)) THEN true
                               WHEN news_own_old_side(n.school_id, n.team_code, news_post_day(n.kind, n.fixture_id, n.published_at)) THEN true
                               WHEN n.kind = 'plan' THEN news_sheet_reach(n.fixture_id, n.school_id, n.team_code)
                               -- db/131: every side's posts, to news.team.read
                               WHEN news_team_wide_post(n.id) THEN true
                               ELSE false END
                     FROM news_post n WHERE n.id = p_post), true)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

-- db/117's narrowing of a team post, with news.team.read beside the side.
ALTER POLICY news_post_team_side ON news_post
  USING (scope <> 'team' OR author_id = app_user_id()
         OR news_plan_reach(school_id, team_code, news_post_day(kind, fixture_id, published_at))
         OR news_own_old_side(school_id, team_code, news_post_day(kind, fixture_id, published_at))
         OR (kind = 'plan' AND news_sheet_reach(fixture_id, school_id, team_code))
         OR (kind <> 'plan' AND app_can('news.team.read', school_id, '*'::text,
                                        'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
                                        '00000000-0000-0000-0000-000000000000'::uuid)));

DO $team_wide$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post'
                    AND policyname = 'news_post_read_team_wide') THEN
    CREATE POLICY news_post_read_team_wide ON news_post
      FOR SELECT USING (scope = 'team' AND kind <> 'plan'
                        AND published_at IS NOT NULL AND published_at <= now()
                        AND app_can('news.team.read', school_id, '*'::text,
                                    'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
                                    '00000000-0000-0000-0000-000000000000'::uuid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_read_team_wide') THEN
    CREATE POLICY notification_read_team_wide ON notification
      FOR SELECT USING (news_team_wide_notice(kind, subject_kind, subject_id, required_capability,
                                              subject_person_id, recipient_id));
  END IF;
END $team_wide$;

-- The report door (db/101, as db/123 left it): its reader test is the read
-- policies', so it gains the new permissive's branch, after db/123's. One
-- replace, checked; every other line, the signature and the grants stand.
DO $report$
DECLARE
  v_def  text := pg_get_functiondef('notification_report(uuid)'::regprocedure);
  v_from text := E'n.subject_id, n.subject_person_id, n.recipient_id, n.published_at))\n';
  v_to   text := E'n.subject_id, n.subject_person_id, n.recipient_id, n.published_at)\n'
              || E'           -- db/131: a team post''s notice, to a reader of every side''s posts\n'
              || E'           OR news_team_wide_notice(n.kind, n.subject_kind, n.subject_id, n.required_capability,\n'
              || E'                                    n.subject_person_id, n.recipient_id))\n';
BEGIN
  IF position('news_team_wide_notice' IN v_def) > 0 THEN
    RETURN;                                   -- this file has run
  END IF;
  IF (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 THEN
    RAISE EXCEPTION 'db/131: notification_report() does not read as db/123 left it; look first';
  END IF;
  EXECUTE replace(v_def, v_from, v_to);
END $report$;


-- ══════════════════════════════════════════════════════════════════
--  R-H · The sheet
-- ══════════════════════════════════════════════════════════════════
-- Read as the owner: the sheet, the players and the links are rows the
-- caller's own policies show him one of at most.
CREATE OR REPLACE FUNCTION fixture_sheet(p_match uuid)
RETURNS TABLE (side text, batting_no smallint, twelfth boolean, name text) AS $$
  WITH e AS (
    SELECT m.id AS match_id, x.side, x.school_id, x.team_code
      FROM match m
      CROSS JOIN LATERAL (VALUES ('home', m.school_id,      m.team_code),
                                 ('away', m.away_school_id, m.away_team_code)) AS x(side, school_id, team_code)
     WHERE m.id = p_match
       AND x.school_id IS NOT NULL
       AND app_user_id() IS NOT NULL),
  open_end AS (
    SELECT e.* FROM e
     WHERE EXISTS (SELECT 1 FROM match_squad s
                    WHERE s.match_id = e.match_id AND s.side = e.side AND NOT s.withdrawn
                      AND (-- his family: a live, verified guardian link, or his own self link
                           is_family_of(s.player_id)
                           -- the boy himself, by his own account
                           OR s.player_id = ANY (my_own_boy())
                           -- the side's staff: naming nobody, not a pupil's `player` row
                           OR app_can_but_player('player.profile.read', e.school_id, e.team_code,
                                                 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, e.match_id))))
  SELECT s.side, s.batting_no, s.twelfth, p.full_name
    FROM open_end e
    JOIN match_squad s ON s.match_id = e.match_id AND s.side = e.side AND NOT s.withdrawn
    JOIN player p      ON p.id = s.player_id AND p.school_id = e.school_id
   ORDER BY CASE s.side WHEN 'home' THEN 0 ELSE 1 END, s.twelfth, s.batting_no NULLS LAST, p.full_name
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

COMMENT ON FUNCTION fixture_sheet(uuid) IS
  'REACH R-H (db/131; STEP4 Q10, Kameel 27 Sep 2026; 4 Nov 2026): a fixture''s team sheet as names and order — side, batting_no, twelfth, name; never a player_id — for each end whose live sheet holds a boy whose family (a live, verified link) or who himself is the caller, or to the side''s staff (an unnamed assignment, not a pupil''s, with player.profile.read there). It reaches the families when the coach saves it, as it reaches the pupils. A spectator, a team-mate off the sheet and a named enquiry grant read nothing.';


-- ══════════════════════════════════════════════════════════════════
--  Who may call the new functions
-- ══════════════════════════════════════════════════════════════════
DO $grants$
DECLARE f text; r text;
BEGIN
  FOREACH f IN ARRAY ARRAY['fixture_sheet(uuid)', 'news_team_wide_post(uuid)',
                           'news_team_wide_notice(text,text,uuid,text,uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;
