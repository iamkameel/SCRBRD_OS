-- ══════════════════════════════════════════════════════════════════
--  115 · A family's consents are the family's: where his record may
--        travel, and whether scouts may see him (REACH group R-B: O5, O6)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: two read policies, nothing else. The design is
-- docs/design/REACH_parent_pupil.md §3.3 (class C2, "the consents"), §4 rows
-- O5 and O6, and §6.2; Kameel decided its two open points on 16 October 2026:
--
--   1. "Passport consent: office only." A passport_consent row is read by the
--      boy's family and by the holders of guardian.link.manage at the school
--      it names. The receiving school's coaches no longer read the consent
--      row; they still read the passport itself through passport(), which
--      this file does not touch.
--   2. "Scouting consent: keep the coach." A player_scouting_consent row is
--      read by the family, the office at his school, and his own side's
--      coach. Other sides' coaches, scouts and everyone else read nothing.
--
-- Its proof is db/99 §92; the API walks are tools/smoke-passport.mjs and
-- tools/smoke-scouting.mjs.
--
-- ── 1 · THE GAPS ───────────────────────────────────────────────────
-- O5. passport_consent_read (db/08) was
--       is_family_of(player_id)
--       OR app_can('player.profile.read', to_school_id, '*', zeros, zeros)
--     The second term, with the all-zeros person, is "anybody at the
--     receiving school who holds player.profile.read about anybody": every
--     coach, every pupil (his `player` role holds it across a side), and,
--     because zeros is a guardian's whole school, every parent there. Each
--     read every family's consents naming that school: another family's
--     child, by name (passport_consents reads passport_name()), and the
--     school his record is travelling to, which may be a move not yet
--     announced.
-- O6. player_scouting_consent_read (db/08) was
--       app_can('player.profile.read', player_school(player_id),
--               player_team(player_id), player_id, zeros)
--     A pupil's `player` role holds player.profile.read at team scope and
--     names nobody, so it passed for every team-mate: a side read which of
--     its boys a family had put in front of scouts, and which had said no.
--     "Scouting interest" is PUBLIC_DATA N5's never-public class. So did the
--     team manager, the scorer, the analyst, the physio, the media officer
--     and anybody else holding the capability over the boy.
--
-- ── 2 · WHAT CHANGES ───────────────────────────────────────────────
--   passport_consent_read:
--       is_family_of(player_id)
--       OR app_can('guardian.link.manage', to_school_id, '*', zeros, zeros)
--     The family (a verified guardian, or the boy himself through his
--     self-access link: db/08's is_family_of()), and the office of the school
--     the row names: guardian.link.manage is held by the principal and the
--     school administrator at that school (db/01) and by the owner's key. Not
--     a coach, a director of sport, a pupil or a parent there; not the
--     sending school's coach. The consents' own spelling, as db/47 and db/60
--     write the office term (school, '*', zeros, zeros).
--
--   player_scouting_consent_read:
--       is_family_of(player_id)
--       OR app_can('guardian.link.manage', player_school(player_id), '*', zeros, zeros)
--       OR app_can('player.development.read', player_school(player_id),
--                  player_team(player_id), player_id, zeros)
--     The family; the office at his own school; and his own side's coach.
--     The coach's term keeps today's argument (his school, his side, his row
--     id) and changes the capability, because the capability is what let the
--     side's pupils in: player.profile.read is held across a side by the
--     `player` role. player.development.read (skill ratings, their history
--     and targets: what a coach about to recommend a boy reads) is held by
--     the coach and the assistant coach of his side, by the director of
--     sport school-wide, by the owner's key, and by the boy's own self-access
--     link. It is not held by the `player` role, and roles.mjs says why: "this
--     role is held across a side, and a boy does not read a team-mate's
--     attribute scores for playing in the same XI". It is at the same
--     sensitivity tier as player.profile.read (1). Capabilities only, never a
--     role name (ADR 0001, ADR 0003).
--
--   WHO LOSES A READ, against db/08:
--     passport_consent        every holder of player.profile.read at the
--                             receiving school except its office: coaches,
--                             assistant coaches, team managers, the director
--                             of sport, scorers, analysts, the physio, media,
--                             the DSO, pupils, and every parent there
--     player_scouting_consent the side's pupils (O6), the team manager, the
--                             scorer, the analyst, the physio, fitness,
--                             media, the DSO, a granted enquiry and a
--                             sports administrator
--   WHO GAINS ONE: nobody. The office already read both through
--   player.profile.read; the family through is_family_of() or its own link.
--
-- ── 3 · WHAT IS LEFT ───────────────────────────────────────────────
-- passport_open(), passport_name() and passport() (db/08) are SECURITY
-- DEFINER and read passport_consent as its owner: the receiving school's
-- coach still opens a boy's passport once the family has named his school,
-- exactly as before. scouting_candidates() and scouting_consent_set() are
-- definers too: what a scout sees, and who may decide, do not move. The write
-- policies (passport_consent_insert, passport_consent_update: the family
-- only) and player_scouting_consent's absence of any write policy stay as
-- db/08 wrote them; the self-check at the foot proves they did. db/08's
-- comments above the two read policies describe the old rule; this header
-- replaces them.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   policy passport_consent_read, player_scouting_consent_read: replaced (the
--     narrowings above); guarded, each must read as db/08 left it or as this
--     file writes it, or nothing is changed
-- No table, no column, no row, no function, no grant. A second paste changes
-- nothing. Each DROP/CREATE POLICY takes a brief lock on its table.
--
-- ONE BEHAVIOUR CHANGES ON THE PASTE. A receiving school's coach who opened
-- Settings → Passport saw the consents naming his school; he now sees none,
-- and the screen says the list is the family's and the office's. A pupil
-- reading Seen by scouts sees his own decision and no team-mate's.
--
-- SCHEMA FIRST. No route or column depends on this file; it is in
-- services/api/expected-migrations.json so that an API built with it is not
-- run against a database still answering with db/08's reach.


-- ── 0 · Refuse to replace policies this file was not written against ──
-- db/08 left each as quoted; a second paste finds this file's own. Anything
-- else means somebody moved one since, and that change is not overwritten
-- blind.
DO $guard$
DECLARE r record; v_qual text;
BEGIN
  IF to_regprocedure('is_family_of(uuid)') IS NULL
     OR to_regprocedure('app_can(text,uuid,text,uuid,uuid)') IS NULL
     OR to_regprocedure('player_school(uuid)') IS NULL
     OR to_regprocedure('player_team(uuid)') IS NULL THEN
    RAISE EXCEPTION 'db/115: is_family_of(), app_can(), player_school() or player_team() is missing; apply db/01–db/08 first';
  END IF;
  IF to_regclass('passport_consent') IS NULL OR to_regclass('player_scouting_consent') IS NULL THEN
    RAISE EXCEPTION 'db/115: passport_consent or player_scouting_consent (db/08) is missing';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('passport_consent', 'passport_consent_read',
       '(is_family_of(player_id) OR app_can(''player.profile.read''::text, to_school_id, ''*''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid))',
       '(is_family_of(player_id) OR app_can(''guardian.link.manage''::text, to_school_id, ''*''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid))'),
      ('player_scouting_consent', 'player_scouting_consent_read',
       'app_can(''player.profile.read''::text, player_school(player_id), player_team(player_id), player_id, ''00000000-0000-0000-0000-000000000000''::uuid)',
       '(is_family_of(player_id) OR app_can(''guardian.link.manage''::text, player_school(player_id), ''*''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid) OR app_can(''player.development.read''::text, player_school(player_id), player_team(player_id), player_id, ''00000000-0000-0000-0000-000000000000''::uuid))'))
      AS x(tbl, pol, was, mine)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_qual
      FROM pg_policy p WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol;
    IF v_qual IS NOT NULL AND v_qual <> r.was AND v_qual <> r.mine THEN
      RAISE EXCEPTION 'db/115: %.% reads % — not what db/08 left; look before replacing it', r.tbl, r.pol, v_qual;
    END IF;
  END LOOP;
END $guard$;


-- ── 1 · Where his record may travel: the family, and the office it names ──
DROP POLICY IF EXISTS passport_consent_read ON passport_consent;
CREATE POLICY passport_consent_read ON passport_consent
  AS PERMISSIVE FOR SELECT TO public
  USING (
    is_family_of(player_id)
    OR app_can('guardian.link.manage', to_school_id, '*'::text,
               '00000000-0000-0000-0000-000000000000'::uuid,
               '00000000-0000-0000-0000-000000000000'::uuid)
  );


-- ── 2 · Whether scouts may see him: the family, his office, his side's coach ──
DROP POLICY IF EXISTS player_scouting_consent_read ON player_scouting_consent;
CREATE POLICY player_scouting_consent_read ON player_scouting_consent
  AS PERMISSIVE FOR SELECT TO public
  USING (
    is_family_of(player_id)
    OR app_can('guardian.link.manage', player_school(player_id), '*'::text,
               '00000000-0000-0000-0000-000000000000'::uuid,
               '00000000-0000-0000-0000-000000000000'::uuid)
    OR app_can('player.development.read', player_school(player_id), player_team(player_id),
               player_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

COMMENT ON POLICY passport_consent_read ON passport_consent IS
  'The family (is_family_of) and the office of the school the row names (guardian.link.manage there); db/115, REACH O5. The receiving coach opens the passport through passport().';
COMMENT ON POLICY player_scouting_consent_read ON player_scouting_consent IS
  'The family (is_family_of), the office at his school (guardian.link.manage) and his own side''s coach (player.development.read at his side); db/115, REACH O6.';


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE
  r      record;
  v_qual text;
  v_chk  text;
  v_n    int;
BEGIN
  -- The read policies, as Postgres stores them. Exact text: a policy that
  -- reads differently is not the one this file proves.
  FOR r IN SELECT * FROM (VALUES
      ('passport_consent', 'passport_consent_read',
       '(is_family_of(player_id) OR app_can(''guardian.link.manage''::text, to_school_id, ''*''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid))'),
      ('player_scouting_consent', 'player_scouting_consent_read',
       '(is_family_of(player_id) OR app_can(''guardian.link.manage''::text, player_school(player_id), ''*''::text, ''00000000-0000-0000-0000-000000000000''::uuid, ''00000000-0000-0000-0000-000000000000''::uuid) OR app_can(''player.development.read''::text, player_school(player_id), player_team(player_id), player_id, ''00000000-0000-0000-0000-000000000000''::uuid))'))
      AS x(tbl, pol, want)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_qual
      FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polname = r.pol
       AND p.polcmd = 'r' AND p.polpermissive AND p.polroles = '{0}';
    IF v_qual IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION 'db/115: %.% reads %', r.tbl, r.pol, coalesce(v_qual, '(missing, or not a permissive SELECT for everyone)');
    END IF;
    -- And it is the only way to read a row: a second permissive SELECT (or
    -- ALL) policy would be OR-ed with it and undo the narrowing.
    SELECT count(*) INTO v_n FROM pg_policy p
     WHERE p.polrelid = to_regclass(r.tbl) AND p.polcmd IN ('r', '*') AND p.polpermissive;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'db/115: % has % permissive policies that read it, not one', r.tbl, v_n;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(r.tbl)) THEN
      RAISE EXCEPTION 'db/115: row security is off on %', r.tbl;
    END IF;
  END LOOP;

  -- The writes are db/08's, untouched: the family alone names a school and
  -- withdraws it; nobody writes a scouting decision but scouting_consent_set().
  SELECT pg_get_expr(p.polwithcheck, p.polrelid) INTO v_chk FROM pg_policy p
   WHERE p.polrelid = to_regclass('passport_consent') AND p.polname = 'passport_consent_insert' AND p.polcmd = 'a';
  IF v_chk IS DISTINCT FROM '(is_family_of(player_id) AND (withdrawn_at IS NULL))' THEN
    RAISE EXCEPTION 'db/115: passport_consent_insert checks %', coalesce(v_chk, '(missing)');
  END IF;
  SELECT pg_get_expr(p.polqual, p.polrelid) || ' / ' || pg_get_expr(p.polwithcheck, p.polrelid) INTO v_chk FROM pg_policy p
   WHERE p.polrelid = to_regclass('passport_consent') AND p.polname = 'passport_consent_update' AND p.polcmd = 'w';
  IF v_chk IS DISTINCT FROM '(is_family_of(player_id) AND (withdrawn_at IS NULL)) / (is_family_of(player_id) AND (withdrawn_at IS NOT NULL))' THEN
    RAISE EXCEPTION 'db/115: passport_consent_update reads %', coalesce(v_chk, '(missing)');
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy p
   WHERE p.polrelid = to_regclass('passport_consent') AND p.polpermissive AND p.polcmd IN ('a', 'w', 'd', '*');
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'db/115: passport_consent has % permissive write policies, not db/08''s two', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy p
   WHERE p.polrelid = to_regclass('player_scouting_consent') AND p.polpermissive AND p.polcmd IN ('a', 'w', 'd', '*');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'db/115: player_scouting_consent has % permissive write policies; db/08 gave it none', v_n;
  END IF;

  -- The family term is db/08's definer: a verified guardian or self-access
  -- link of the caller's, nothing wider.
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = to_regprocedure('is_family_of(uuid)') AND prosecdef AND provolatile = 's'
                    AND prosrc LIKE '%a.role IN (''guardian'', ''selfaccess'')%'
                    AND prosrc LIKE '%s.verification_state = ''verified''%') THEN
    RAISE EXCEPTION 'db/115: is_family_of() is not db/08''s stable definer over verified guardian and self-access links';
  END IF;
END $check$;
