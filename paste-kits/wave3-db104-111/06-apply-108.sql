-- ══════════════════════════════════════════════════════════════════
--  SCRBRD — apply 108_player_team_scoped.sql to a database that already has the rest
-- ══════════════════════════════════════════════════════════════════
--
--  For the Supabase SQL Editor. Nothing here tears anything down: it is the
--  one migration and its ledger row, exactly what `node tools/migrate.mjs`
--  would apply to this database. Refuses to run twice, and refuses to run
--  ahead of its predecessor.
DO $apply$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migration WHERE name = '108_player_team_scoped.sql') THEN
    RAISE EXCEPTION '108_player_team_scoped.sql is already in this database''s ledger — nothing to do';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE name = '107_official_register_closed.sql') THEN
    RAISE EXCEPTION '107_official_register_closed.sql has not been applied here — apply it first, or use the rebuild bundle';
  END IF;
END $apply$;

-- A database ledgered by a bundle from before SCRBRD-025 has no note column
-- yet; this reaches it either way.
ALTER TABLE schema_migration ADD COLUMN IF NOT EXISTS note text;

-- ── 108_player_team_scoped.sql ──
-- ══════════════════════════════════════════════════════════════════
--  108 · A pupil is a pupil of a side (REACH group R-D: O8)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: one CHECK constraint and one function re-emitted with a
-- block inserted. The design is docs/design/REACH_parent_pupil.md §4 row O8,
-- §5 item 1, §6.4 and §7 REACH-D4, decided by Kameel on 14 October 2026:
-- "player becomes team-scoped (a CHECK, like coach). Yes." Its proof is
-- db/99 §85.
--
-- BEFORE YOU PASTE THIS: tools/sql/fix-player-without-team.sql, with
-- Kameel's explicit yes. On 14 October production and the demo database
-- each held exactly one live `player` assignment with no team — the seeded
-- test account spectator@example.invalid (88888888-…-0001), not a pupil —
-- and this file refuses to run while one exists (§1). DEPLOYING.md (db/108)
-- has the order.
--
-- THE GAP. app_can()'s team test (db/50) is `a.team_code IS NULL OR
-- a.team_code = p_team OR p_team = '*'`: an assignment with no team reaches
-- every team at its school. That is right for a head of sport and wrong for
-- a coach, which is why db/01's assignment_team_scoped CHECK has always made
-- a coach, an assistant coach and a team manager name a side. A pupil's
-- `player` assignment had no such rule, so a boy with no side read every
-- side at the school: every team sheet, every team post, every bus list,
-- every team-mate-level row. db/50's clause stays as it is (ADR 0003: no
-- role tests in app_can()); the constraint removes the case.
--
-- WHAT CHANGES
--
--   1. role_assignment_player_team_scoped — a CHECK on role_assignment:
--        role <> 'player' OR team_code IS NOT NULL OR NOT active
--      A NEW constraint rather than an edit to db/01's (db/01 is frozen;
--      DEPLOYING.md). packages/policy/src/roles.mjs adds 'player' to
--      TEAM_SCOPED_ROLES (the truth for a fresh install and the client), and
--      services/api/rls/generate-rls.mjs keeps it out of db/01's emitted
--      list (TEAM_SCOPED_SINCE_01), so the frozen file does not move.
--
--      WHY `OR NOT active`, which db/01's coach rule and db/86's platform
--      rule do not have. An ended assignment reaches nothing: every liveness
--      test in the schema begins `a.active`. And it can never be live again:
--      db/01's role_assignment_revoke_only() refuses to reactivate one
--      ("make the appointment again"), and if that trigger were bypassed the
--      row would be active and this CHECK would refuse it. So exempting ended
--      rows exempts only history. It is what lets the one live row on the
--      record be ENDED (reversible: the row, its dates and its provenance
--      stay, and the appointment can be made again with a side) rather than
--      DELETED (which would also cascade to its assignment_subject rows and
--      erase that it ever existed). tools/sql/fix-player-without-team.sql
--      ends it.
--
--      ADDED NOT VALID, then VALIDATED, after asking first, as db/86 does:
--      if any live `player` assignment with no team is on the record, this
--      file stops, names the count and each one, says how to clear them, and
--      changes nothing. It does not rewrite live data. The table is locked
--      for the length of that one block, so nothing is written between the
--      question and the constraint; lock_timeout keeps the paste from
--      queueing behind a long query.
--
--   2. role_request_grant_as() (db/92: the one door decide_role_request(),
--      enrol_person() and register_claim() grant through) derives a pupil's
--      side when the request and the decider name none: the side of the
--      player he is linked to, on the roster at that school. A pupil with no
--      side on the roster, or a `player` request naming no pupil, is refused
--      by name, team_required, before anything is written — the answer the
--      coaching roles already get. Re-emitted from the body in place with
--      one block inserted; md5-guarded against db/92's text.
--
-- THE OTHER DOORS. Every writer of a role_assignment row was looked at:
--   decide_role_request(), enrol_person(), register_claim()
--                          → role_request_grant_as(), above
--   guardian_link_establish() (db/62)       writes `guardian` only
--   access_request_decide() (db/08)          writes `enquiry` only
--   support_access_begin() (db/22)           writes `support` only
--   duty_link() (db/34)                      writes `scorer`/`official` only
--   dso appointment (db/57)                  writes `dso` only
--   role_assignment_write (db/01, the application's INSERT policy), the
--   owner in the SQL Editor, a script with the triggers off
--                          → the CHECK, which none of them can step round
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   + constraint role_assignment_player_team_scoped on role_assignment
--     (NOT VALID, then VALIDATE: the table is read once under the lock)
--   role_request_grant_as(uuid,uuid,text,uuid,text): re-emitted with the
--     block above; same signature, rights and settings
-- No row is inserted, changed or deleted. A second paste changes nothing.
-- No API change is needed: a refusal comes back as `team_required`, which
-- the request, enrolment and register routes already answer in words.


-- ── 0 · What this file relies on is there ──────────────────────────
DO $pre$
BEGIN
  IF to_regclass('role_assignment') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('role_assignment')
                       AND conname = 'assignment_team_scoped' AND contype = 'c') THEN
    RAISE EXCEPTION 'db/108: role_assignment or db/01''s assignment_team_scoped is missing';
  END IF;
  IF to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'db/108: role_request_grant_as() (db/92) is missing; apply db/92 first';
  END IF;
END $pre$;


-- ── 1 · The rule, where every door passes it ───────────────────────
DO $rule$
DECLARE
  n      int;
  v_list text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'role_assignment'::regclass
                AND conname = 'role_assignment_player_team_scoped' AND convalidated) THEN
    RETURN;   -- a second run
  END IF;

  -- Nothing is written between the question below and the constraint.
  PERFORM set_config('lock_timeout', '10s', true);
  LOCK TABLE role_assignment IN ACCESS EXCLUSIVE MODE;

  -- Exactly the rows the constraint would refuse: live `player` rows with no
  -- team. Named, so whoever pastes this knows which account to look at.
  SELECT count(*),
         string_agg(format('%s (%s, at %s, since %s)',
                           a.id, coalesce(u.email, 'no account'),
                           coalesce(s.code, coalesce(a.school_id::text, 'no school')),
                           a.created_at::date),
                    '; ' ORDER BY a.created_at, a.id)
    INTO n, v_list
    FROM role_assignment a
    LEFT JOIN app_user u ON u.id = a.person_id
    LEFT JOIN school s ON s.id = a.school_id
   WHERE a.role = 'player' AND a.team_code IS NULL AND a.active;
  IF n > 0 THEN
    RAISE EXCEPTION 'db/108: % live player assignment(s) on the record name no team, and a pupil with no side reads every side at his school: %. Nothing was changed. Paste tools/sql/fix-player-without-team.sql first (with Kameel''s yes; DEPLOYING.md, db/108), then paste this again.',
      n, v_list;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'role_assignment'::regclass
                    AND conname = 'role_assignment_player_team_scoped') THEN
    ALTER TABLE role_assignment ADD CONSTRAINT role_assignment_player_team_scoped
      CHECK (role <> 'player' OR team_code IS NOT NULL OR NOT active) NOT VALID;
  END IF;
  ALTER TABLE role_assignment VALIDATE CONSTRAINT role_assignment_player_team_scoped;
END $rule$;


-- ── 2 · The grant door derives a pupil's side, or refuses by name ──
-- Re-emitted from the body in place with one block inserted before its
-- anchor, as db/86 re-emits. Guarded: the body must be db/92's (its md5,
-- taken from a database at db/102), the anchor must appear exactly once,
-- and afterwards the body must be the old one with exactly that insertion
-- and the same signature, rights and settings.
DO $reemit$
DECLARE
  v_fn     text := 'role_request_grant_as(uuid,uuid,text,uuid,text)';
  v_anchor text := '  IF r.role IN (''guardian'', ''selfaccess'', ''enquiry'') AND v_player IS NULL THEN';
  v_block  text :=
       '  -- db/108: a pupil is a pupil OF A SIDE (role_assignment_player_team_scoped).' || chr(10)
    || '  -- No side named by the request or the decider: his own side on the roster,' || chr(10)
    || '  -- at this school. None there either: refused by name, before anything is' || chr(10)
    || '  -- written, as a coach with no side is.' || chr(10)
    || '  IF r.role = ''player'' AND v_team IS NULL THEN' || chr(10)
    || '    SELECT p.team_code INTO v_team FROM player p WHERE p.id = v_player AND p.school_id = r.school_id;' || chr(10)
    || '    IF v_team IS NULL THEN' || chr(10)
    || '      RETURN QUERY SELECT false, ''team_required'', NULL::uuid; RETURN;' || chr(10)
    || '    END IF;' || chr(10)
    || '  END IF;' || chr(10);
  v_src text; v_def text; v_cfg text; v_acl text; v_sec boolean;
BEGIN
  SELECT p.prosrc, array_to_string(p.proconfig, ','), p.proacl::text, p.prosecdef
    INTO v_src, v_cfg, v_acl, v_sec
    FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn);
  IF position(v_block IN v_src) > 0 THEN
    RETURN;   -- already derives: a second run
  END IF;
  IF md5(v_src) IS DISTINCT FROM 'a9a5a09414e0629d70c873fcbeb99f75' THEN
    RAISE EXCEPTION 'db/108: % is not db/92''s any more; add the pupil''s side to the version now in place and move its hash', v_fn;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'db/108: % does not carry its anchor exactly once', v_fn;
  END IF;
  v_def := pg_get_functiondef(to_regprocedure(v_fn));
  EXECUTE replace(v_def, v_anchor, v_block || v_anchor);
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM replace(v_src, v_anchor, v_block || v_anchor)
     OR (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_cfg
     OR (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_acl
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS DISTINCT FROM v_sec THEN
    RAISE EXCEPTION 'db/108: re-emitting % changed more than the pupil''s side', v_fn;
  END IF;
END $reemit$;


-- ── 3 · What this file promised, checked in the same paste ─────────
DO $check$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'role_assignment'::regclass AND c.contype = 'c'
     AND c.conname = 'role_assignment_player_team_scoped' AND c.convalidated;
  IF v_def IS DISTINCT FROM 'CHECK (((role <> ''player''::text) OR (team_code IS NOT NULL) OR (NOT active)))' THEN
    RAISE EXCEPTION 'db/108: role_assignment_player_team_scoped is %', coalesce(v_def, '(missing, or not validated)');
  END IF;
  -- db/01's rule is untouched: the coaching roles still name a side.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'role_assignment'::regclass AND conname = 'assignment_team_scoped'
                    AND convalidated
                    AND pg_get_constraintdef(oid) LIKE '%coach%assistantcoach%teammanager%') THEN
    RAISE EXCEPTION 'db/108: db/01''s assignment_team_scoped is not what it was';
  END IF;
  -- No live player row without a side is on the record.
  IF EXISTS (SELECT 1 FROM role_assignment WHERE role = 'player' AND team_code IS NULL AND active) THEN
    RAISE EXCEPTION 'db/108: a live player assignment with no team is on the record';
  END IF;
  -- The door derives, and refuses by name; it is still a definer with a
  -- pinned path and no grant beyond its owner's (db/92).
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)')
                    AND prosecdef
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))
                    AND prosrc LIKE '%IF r.role = ''player'' AND v_team IS NULL THEN%'
                    AND prosrc LIKE '%SELECT p.team_code INTO v_team FROM player p WHERE p.id = v_player AND p.school_id = r.school_id;%') THEN
    RAISE EXCEPTION 'db/108: role_request_grant_as() does not derive a pupil''s side';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
              WHERE p.oid = to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)')
                AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'db/108: role_request_grant_as() is executable by PUBLIC';
  END IF;
END $check$;


-- ── the ledger row, with the hash the migrator would record and the commit
--    this bundle was generated from ──
INSERT INTO schema_migration (name, sha256, note) VALUES ('108_player_team_scoped.sql', 'cb81ce81100bb7a291f67ab8d6896193cfb0535efedf6ee9cfc90bee09499c97', '4789aebecc8b499ccc6eb7dc528735825c05d706');
