-- ══════════════════════════════════════════════════════════════════
--  119 · "His family" means a link that is live today
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: one function re-created, its grants narrowed, nothing else.
-- The finding is the Opus review of #176 (db/115, REACH R-B), which made
-- is_family_of() the family's only way into passport_consent and
-- player_scouting_consent, to read and to write. Its proof is db/99 §98; the
-- API walks are tools/smoke-passport.mjs and tools/smoke-scouting.mjs.
--
-- ── 1 · THE GAP ────────────────────────────────────────────────────
-- is_family_of(p_player) (db/08) asked: does the caller hold an active
-- guardian or self-access assignment with a verified link to this boy. It
-- read no date. So it still said yes to:
--   - a guardian whose assignment has ended (role_assignment.valid_until
--     passed) or expired (expires_at passed);
--   - a link that has ended (assignment_subject.valid_until passed). Since
--     db/62 a guardian link closes on the later of the boy leaving school and
--     his eighteenth birthday (Kameel's Q1); db/109 writes why. A mother whose
--     link closed that way still read, and wrote, his passport consents;
--   - a link not yet begun (valid_from in the future);
--   - a scoring pad's session (db/50: app.scope = 'pad'), which must reach
--     nothing but its own fixture's log. A scorer who is also a parent, on the
--     pad's credential, read his child's consents.
-- And it was granted to PUBLIC with no search_path of its own (db/16 pinned
-- one after the fact).
--
-- ── 2 · WHAT CHANGES ───────────────────────────────────────────────
-- is_family_of() keeps its name, signature, owner, STABLE and SECURITY
-- DEFINER, and its question: a guardian or self-access assignment of the
-- caller's with a verified link to the boy. It now asks that both be LIVE
-- TODAY, in exactly the words app_can() (db/50, from db/35 and db/23) uses
-- for a person-scoped role, and that db/47's public_name_live_link() and
-- db/60's health_giver_link_live() repeat, so "live" means one thing:
--   the assignment  active; valid_from NULL or begun; valid_until NULL or
--                   after today; expires_at NULL or later than now; no open
--                   duty_suspension (db/35; a guardian assignment never has
--                   one, but the test is app_can()'s whole, not a part of it)
--   the link        verified; valid_from begun; valid_until NULL or after
--                   today (db/62's "is this link live today": "still what the
--                   column says")
-- and it answers false in a pad-scoped session (app_pad_scoped(), db/50),
-- before reading anything. search_path is pinned in the definition. EXECUTE
-- is taken back from PUBLIC (and from a managed host's anon and authenticated,
-- where they exist, as db/111 does) and granted to scrbrd_app, the role every
-- policy that calls it is evaluated as. Its owner's own definers
-- (passport_open(), injury_writer_is_family()) call it as the owner.
--
-- ── 3 · EVERY CALLER, AND WHAT MOVES FOR EACH ──────────────────────
-- `git grep is_family_of` over db/, services/, packages/, apps/ and tools/,
-- and pg_proc/pg_policy/pg_views on a database at db/114 (and db/115). Nothing
-- outside db/ calls it; no view names it.
--   passport_consent_read (db/08; db/115)    the family's read: narrows. A
--     guardian whose assignment or link has ended or not begun, or any family
--     member on a pad's credential, reads no consent through it. The office's
--     term (db/115; db/08's player.profile.read term before it) is untouched.
--   passport_consent_insert, _update (db/08) the family's writes: narrow the
--     same way. Only a live family names a school or withdraws one.
--   player_scouting_consent_read (db/115, where applied)  the family's read:
--     narrows the same way. The office and coach terms are untouched. Not on a
--     database without db/115, where db/08's policy does not call it.
--   passport_open() (db/08), and through it passport() and passport_name()
--     the family no longer opens the passport on a dead link or on a pad. The
--     boy's own school (player.profile.read) and a school the family named
--     (a live consent) open it exactly as before.
--   injury_writer_is_family() (db/111), and through it injury_write_refusal(),
--     injury_record(), injury_review_record() and injury_worklist()
--     NO CHANGE. It is is_family_of() OR any guardian or self-access link the
--     caller holds or held to the boy, pending or verified, whatever its dates
--     and whether or not its assignment is active. Every (caller, boy) pair
--     the old is_family_of() said yes to is in that second arm, and so is
--     every pair the new one says yes to, so the OR is the second arm alone,
--     before and after: the mother-physio is refused on a live link, an ended
--     one, a pending one, and on a pad (where injury_write_refusal() already
--     answers not_permitted first, and the worklist's family cut still holds).
--     db/111's comment ("is_family_of() and more ... whatever its dates") is
--     what makes this so; the self-check below refuses to commit if the second
--     arm is not db/111's.
--
-- WHO LOSES: a guardian (or a pupil's self-access account) whose assignment
-- or link has ended, expired, been suspended or not yet begun, at every
-- caller above but db/111's; any session on a pad's credential. WHO GAINS:
-- nobody.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   function is_family_of(uuid): body replaced (above); SET search_path;
--     EXECUTE revoked from PUBLIC (and anon, authenticated where they exist),
--     granted to scrbrd_app. Guarded: the body in place must be db/08's or
--     this file's (whitespace-normalised, md5), or nothing is changed.
-- No table, column, row or policy. A second paste changes nothing.
--
-- ONE BEHAVIOUR CHANGES ON THE PASTE. A parent whose link to a boy has ended
-- (he left school after eighteen, or the office revoked it with an end date)
-- no longer sees his passport consents or opens his passport. A live family
-- sees no difference.
--
-- SCHEMA FIRST. No route or column depends on this file; it is in
-- services/api/expected-migrations.json so that an API built with it is not
-- run against a database still answering db/08's question.


-- ── 0 · Refuse to replace a function this file was not written against ──
-- db/08 wrote it; a second paste finds this file's own. Compared with the
-- whitespace folded, so a paste that re-indents nothing still matches.
DO $guard$
DECLARE v_src text; v_md5 text;
BEGIN
  IF to_regprocedure('app_pad_scoped()') IS NULL OR to_regprocedure('app_user_id()') IS NULL
     OR to_regclass('duty_suspension') IS NULL THEN
    RAISE EXCEPTION 'db/119: app_pad_scoped() (db/50), app_user_id() or duty_suspension (db/34) is missing; apply them first';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('is_family_of(uuid)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'db/119: is_family_of(uuid) (db/08) is not there to re-create';
  END IF;
  v_md5 := md5(regexp_replace(btrim(v_src), '\s+', ' ', 'g'));
  IF v_md5 NOT IN ('09b6f1506e21258216ed5d6680f3c607',   -- db/08
                   'df3d415fd2f319b8c92009ae94a52c81')    -- this file
  THEN
    RAISE EXCEPTION 'db/119: is_family_of() is not db/08''s or this file''s (md5 % of its folded body); look before replacing it', v_md5;
  END IF;
END $guard$;


-- ── 1 · Is the caller this boy's family, today ─────────────────────
/**
 * A verified guardian of this boy, or the boy himself through his self-access
 * account, on an assignment and a link that are both live today, in
 * app_can()'s words; never on a pad's credential. The family's term in the
 * consent policies (db/08, db/115) and in passport_open().
 */
CREATE OR REPLACE FUNCTION is_family_of(p_player uuid) RETURNS boolean AS $$
  SELECT NOT app_pad_scoped() AND EXISTS (
    SELECT 1 FROM role_assignment a
    JOIN assignment_subject s ON s.assignment_id = a.id
   WHERE a.person_id = app_user_id() AND a.active
     AND a.role IN ('guardian', 'selfaccess')
     AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
     AND (a.valid_until IS NULL OR a.valid_until >  current_date)
     AND (a.expires_at IS NULL OR a.expires_at > now())
     AND NOT EXISTS (SELECT 1 FROM duty_suspension d
                      WHERE d.assignment_id = a.id AND d.lifted_at IS NULL)
     AND s.player_id = p_player AND s.verification_state = 'verified'
     AND s.valid_from <= current_date
     AND (s.valid_until IS NULL OR s.valid_until > current_date))
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON FUNCTION is_family_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_family_of(uuid) TO scrbrd_app;

-- On a managed host the platform's API roles get EXECUTE on functions by
-- default privilege, directly and not through PUBLIC (db/29), so it is taken
-- back from them by name, as db/60 and db/111 do.
DO $revoke_platform_roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION is_family_of(uuid) FROM %I', r);
    END IF;
  END LOOP;
END $revoke_platform_roles$;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  f   oid := to_regprocedure('is_family_of(uuid)');
  r   text;
  v_src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = f AND p.prosecdef AND p.provolatile = 's'
                    AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(p.proconfig, '{}'))
                    AND md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g')) = 'df3d415fd2f319b8c92009ae94a52c81') THEN
    RAISE EXCEPTION 'db/119: is_family_of() is not this file''s pinned, stable definer';
  END IF;
  -- db/115's own self-check reads these two phrases in the body; a re-paste
  -- of db/115 after this file must still pass it.
  IF position('a.role IN (''guardian'', ''selfaccess'')' IN (SELECT prosrc FROM pg_proc WHERE oid = f)) = 0
     OR position('s.verification_state = ''verified''' IN (SELECT prosrc FROM pg_proc WHERE oid = f)) = 0 THEN
    RAISE EXCEPTION 'db/119: is_family_of() no longer reads as db/115 checks it';
  END IF;
  IF has_function_privilege('public', f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = f AND x.grantee = 0) THEN
    RAISE EXCEPTION 'db/119: PUBLIC can still execute is_family_of()';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/119: % can still execute is_family_of()', r;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
    RAISE EXCEPTION 'db/119: scrbrd_app cannot execute is_family_of(), and every family policy would refuse with an error';
  END IF;
  -- Off the record, nobody is anybody's family.
  IF is_family_of(gen_random_uuid()) THEN
    RAISE EXCEPTION 'db/119: is_family_of() said yes about nobody';
  END IF;

  -- db/111's refusal stands on its own second arm, which reads no date and no
  -- active flag; that is why narrowing is_family_of() does not narrow it.
  IF to_regprocedure('injury_writer_is_family(uuid)') IS NOT NULL THEN
    SELECT btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) INTO v_src
      FROM pg_proc WHERE oid = to_regprocedure('injury_writer_is_family(uuid)');
    IF position('SELECT is_family_of(p_player) OR EXISTS (' IN v_src) <> 1
       OR position('s.verification_state IN (''pending'', ''verified'')' IN v_src) = 0
       OR v_src ~ '(valid_from|valid_until|expires_at|a\.active|app_pad_scoped)' THEN
      RAISE EXCEPTION 'db/119: injury_writer_is_family() is not db/111''s "is_family_of() and more"; its refusal may have narrowed';
    END IF;
  END IF;
END $check$;
