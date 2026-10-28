-- ══════════════════════════════════════════════════════════════════
--  120 · Alerts a person may switch off, and a pupil's quiet hours
--        (NOTIFICATIONS S4: D20, D21)
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN: one table, governed by identity like device_push_token
-- (db/08), and two read doors. The design is docs/design/NOTIFICATIONS.md
-- §8 (D20, D21) and §11's S4 row, decided by Kameel on 7 October 2026; on 23
-- October he confirmed S2–S5 before the pilot. Its proof is db/99 §95; the
-- API walk is tools/smoke-notification-prefs.mjs; the decision the push
-- worker takes at D13 step 5 is services/api/notify/push-decision.mjs, with
-- its unit test beside it.
--
-- ORDER. The design puts S4 after S3 (the outbox and the worker). S3 is not
-- built yet, so this file builds what stands without it: the table, the
-- reads, and the decision as a pure function S3's worker will call. Until
-- S3, nothing is pushed by a worker and a preference changes nothing on a
-- phone; the screen says so in its words.
--
-- ── 1 · WHAT A PREFERENCE IS (D20) ─────────────────────────────────
-- A person's "do not push me this" for one kind of notice, or for one kind
-- about one child. It governs PUSH ONLY. It never hides a row from Notices,
-- the badge or a parent's action list: no read, view or policy in the
-- product reads this table but the screen that sets it and the worker that
-- sends (GA-I20 D2: the first thing a filter hides is a consent nobody
-- answered). db/99 §95 proves a muted notice is still in my_notifications.
--
-- The worker applies a row to MEDIUM notices only. LOW is never pushed and
-- HIGH is always pushed (D3), whatever a row says. A row with a child applies
-- to notices whose subject_person_id is that child; a row without applies to
-- the kind.
--
-- ── 2 · WHICH KINDS MAY HAVE A ROW ─────────────────────────────────
-- D20's table, the union of its "may switch off" column: notice,
-- recognition, fixture, availability, lift. That refuses safeguarding,
-- welfare and system, as D20's text says a CHECK must; it also refuses
-- injury, which D20's table offers to nobody and D2 never marks "preference
-- allowed", and compromise (db/116, a breach notice), which arrived after
-- the design and is the same kind of notice as safeguarding. Both are named
-- for Kameel in the slice's report; loosening is a later file.
--
-- A row about one child is for the kinds that are ever about one child
-- (D2's audience column): recognition (a family's sealed notice),
-- availability and lift (a guardian's seat). notice and fixture never carry
-- a subject_person_id, so a per-child row for them could never match; the
-- CHECK refuses one rather than keep a switch that does nothing.
--
-- ── 3 · WHO MAY WRITE ONE ──────────────────────────────────────────
-- Identity-governed, like device_push_token (db/08): your own rows, and no
-- capability, no role, no administrative override. Nobody mutes somebody
-- else's phone. A row about a child is yours only if you are his family as
-- db/08's is_family_of() says (a verified guardian or self-access link of
-- yours), checked on INSERT and on UPDATE. Never deleted: the default
-- privileges (db/06) grant SELECT, INSERT, UPDATE; "on" again is push = true.
-- A row's key (person, kind, child) never moves; a trigger refuses it.
--
-- The key is (person_id, kind, coalesce(subject_player_id, zeros)), as D20
-- writes it. Postgres takes no expression in a PRIMARY KEY, so it is a
-- UNIQUE index of that expression, which ON CONFLICT names the same way.
--
-- ── 4 · QUIET HOURS (D21) ──────────────────────────────────────────
-- A person for whom person_is_pupil() (db/57) is true receives no medium
-- push between 21:00 and 06:00 Africa/Johannesburg; held, and sent at
-- 06:00. Platform-fixed: no column, no setting, not the school's and not the
-- pupil's. person_is_pupil() is internal (REVOKEd from PUBLIC), so the
-- worker and the screen ask my_push_quiet_hours(), which answers for the
-- caller and nobody else.
--
-- ── 5 · WHAT THE SCREEN OFFERS ─────────────────────────────────────
-- my_alert_choices(): the switches D20 gives this person, from their live
-- assignments, with each one's state (on unless a row says off):
--   staff   (any live role holding news.read other than guardian, player and
--           self-access): notice, recognition, fixture
--   pupil   (person_is_pupil): notice, recognition, fixture, availability
--   parent  (a live, verified guardian link): notice and fixture for all his
--           notices; recognition, availability and lift per child
-- A switch is offered only where its capability is held (news.read,
-- fixture.read, availability.read, transport.lift.arrange). The caller's
-- own; a child's name only for his own verified children.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   table      + notification_pref (empty), RLS on, three policies (own rows;
--                a child only through is_family_of()); no DELETE
--   triggers   + notification_pref_stamp (BEFORE INSERT OR UPDATE)
--   functions  + my_push_quiet_hours(), my_alert_choices() (definers, the
--                caller's own; the application's to call)
-- No other table, column, row, policy or grant moves. A second paste changes
-- nothing.
--
-- SCHEMA FIRST. The API built with it serves POST /api/notifications/prefs
-- and GET /api/read/my_notification_prefs, which need this file; it is in
-- services/api/expected-migrations.json so that API refuses to start
-- against a database without it.


-- ── 0 · What this file stands on ──────────────────────────────────
DO $guard$
BEGIN
  IF to_regprocedure('is_family_of(uuid)') IS NULL
     OR to_regprocedure('person_is_pupil(uuid)') IS NULL
     OR to_regprocedure('app_holds(text)') IS NULL
     OR to_regprocedure('app_pad_scoped()') IS NULL
     OR to_regprocedure('app_user_id()') IS NULL THEN
    RAISE EXCEPTION 'db/120: is_family_of(), person_is_pupil(), app_holds(), app_pad_scoped() or app_user_id() is missing; apply db/01–db/116 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_kind_known'
                    AND pg_get_constraintdef(oid) LIKE '%compromise%') THEN
    RAISE EXCEPTION 'db/120: notification_kind_known does not have db/116''s kinds; apply db/116 first';
  END IF;
END $guard$;


-- ── 1 · The table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_pref (
  person_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind              text NOT NULL,
  -- The child a parent's row is about; NULL for the whole kind.
  subject_player_id uuid REFERENCES player(id) ON DELETE CASCADE,
  push              boolean NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- D20: safeguarding, welfare and system can never have a row; nor injury
  -- or compromise (header §2). The same list as packages/policy/src/
  -- notifications.mjs MUTABLE_KINDS; packages/policy/test/notifications.test.mjs
  -- fails if the two disagree.
  CONSTRAINT notification_pref_mutable_kind CHECK (kind IN ('notice', 'recognition', 'fixture', 'availability', 'lift')),
  -- A row about one child, only for a kind that is ever about one child
  -- (PER_CHILD_KINDS).
  CONSTRAINT notification_pref_child_kind CHECK (subject_player_id IS NULL OR kind IN ('recognition', 'availability', 'lift'))
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_pref_key
  ON notification_pref (person_id, kind, (coalesce(subject_player_id, '00000000-0000-0000-0000-000000000000'::uuid)));

COMMENT ON TABLE notification_pref IS
  'NOTIFICATIONS D20 (db/120): a person''s own "do not push me this", per kind or per kind and child. Push only: no read of a notice consults it. Own rows; a child only through is_family_of().';

-- The time is the database's, and a row's key never moves: a preference
-- about one child does not become one about another, or somebody else's.
CREATE OR REPLACE FUNCTION notification_pref_stamp() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.person_id IS DISTINCT FROM OLD.person_id
                           OR NEW.kind IS DISTINCT FROM OLD.kind
                           OR NEW.subject_player_id IS DISTINCT FROM OLD.subject_player_id) THEN
    RAISE EXCEPTION 'a preference''s person, kind and child do not change: set another'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION notification_pref_stamp() FROM PUBLIC;

DROP TRIGGER IF EXISTS notification_pref_stamp ON notification_pref;
CREATE TRIGGER notification_pref_stamp
  BEFORE INSERT OR UPDATE ON notification_pref
  FOR EACH ROW EXECUTE FUNCTION notification_pref_stamp();


-- ── 2 · Own rows only (device_push_token's rule, db/08) ──────────────
ALTER TABLE notification_pref ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_pref_read ON notification_pref;
CREATE POLICY notification_pref_read ON notification_pref
  FOR SELECT USING (person_id = app_user_id());

DROP POLICY IF EXISTS notification_pref_insert ON notification_pref;
CREATE POLICY notification_pref_insert ON notification_pref
  FOR INSERT WITH CHECK (person_id = app_user_id()
                         AND (subject_player_id IS NULL OR is_family_of(subject_player_id)));

DROP POLICY IF EXISTS notification_pref_update ON notification_pref;
CREATE POLICY notification_pref_update ON notification_pref
  FOR UPDATE USING (person_id = app_user_id())
           WITH CHECK (person_id = app_user_id()
                       AND (subject_player_id IS NULL OR is_family_of(subject_player_id)));

-- db/06's default privileges gave the application SELECT, INSERT, UPDATE and
-- nothing else; said here too, so a later default cannot widen it.
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON notification_pref FROM scrbrd_app;
REVOKE ALL ON notification_pref FROM PUBLIC;


-- ── 3 · Quiet hours: is the caller a pupil (D21) ─────────────────────
-- The caller's own answer, and nobody else's: it takes no argument. The
-- worker asks it as each recipient (D13 step 5, under withPrincipal); the
-- screen asks it to say the hours.
CREATE OR REPLACE FUNCTION my_push_quiet_hours() RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND coalesce(person_is_pupil(app_user_id()), false)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION my_push_quiet_hours() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_push_quiet_hours() TO scrbrd_app;


-- ── 4 · The switches this person is offered, with their state ───────
-- Header §5. A definer because person_is_pupil() is internal; every row is
-- the caller's own, and a child is named only when the caller holds a live,
-- verified guardian link to him. Nothing under a pad's credential.
CREATE OR REPLACE FUNCTION my_alert_choices()
RETURNS TABLE (kind text, subject_player_id uuid, player_name text, push boolean, quiet_hours boolean) AS $$
  WITH me AS (
    SELECT app_user_id() AS id WHERE app_user_id() IS NOT NULL AND NOT app_pad_scoped()
  ), live AS (
    SELECT a.id, a.role FROM role_assignment a JOIN me ON a.person_id = me.id
     WHERE a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       AND (a.expires_at  IS NULL OR a.expires_at  >  now())
       AND NOT EXISTS (SELECT 1 FROM duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)
  ), children AS (
    SELECT DISTINCT s.player_id FROM live a JOIN assignment_subject s ON s.assignment_id = a.id
     WHERE a.role = 'guardian' AND s.verification_state = 'verified'
       AND (s.valid_from  IS NULL OR s.valid_from  <= current_date)
       AND (s.valid_until IS NULL OR s.valid_until >  current_date)
  ), who AS (
    SELECT coalesce((SELECT person_is_pupil(me.id) FROM me), false) AS pupil,
           EXISTS (SELECT 1 FROM live a JOIN role_capability rc ON rc.role = a.role AND rc.capability = 'news.read'
                    WHERE a.role NOT IN ('guardian', 'player', 'selfaccess')) AS staff,
           app_holds('news.read') AS news, app_holds('fixture.read') AS fixtures,
           app_holds('availability.read') AS availability, app_holds('transport.lift.arrange') AS lifts
  ), offered AS (
    SELECT 'notice'::text AS kind, NULL::uuid AS player_id FROM me, who WHERE who.news
    UNION ALL SELECT 'recognition', NULL FROM me, who WHERE who.news AND (who.staff OR who.pupil)
    UNION ALL SELECT 'fixture', NULL FROM me, who WHERE who.fixtures
    UNION ALL SELECT 'availability', NULL FROM me, who WHERE who.pupil AND who.availability
    UNION ALL SELECT 'recognition', c.player_id FROM children c, who WHERE who.news
    UNION ALL SELECT 'availability', c.player_id FROM children c, who WHERE who.availability
    UNION ALL SELECT 'lift', c.player_id FROM children c, who WHERE who.lifts
  )
  SELECT o.kind, o.player_id, p.full_name, coalesce(np.push, true), (SELECT who.pupil FROM who)
    FROM offered o
    LEFT JOIN player p ON p.id = o.player_id
    LEFT JOIN notification_pref np
           ON np.person_id = (SELECT me.id FROM me) AND np.kind = o.kind
          AND np.subject_player_id IS NOT DISTINCT FROM o.player_id
   ORDER BY o.player_id IS NOT NULL, p.full_name, o.player_id,
            array_position(ARRAY['notice', 'recognition', 'fixture', 'availability', 'lift'], o.kind)
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION my_alert_choices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION my_alert_choices() TO scrbrd_app;


-- ── Refuse to commit a file that did not do what it says ───────────
DO $check$
DECLARE v_n int; v_q text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'notification_pref'::regclass) THEN
    RAISE EXCEPTION 'db/120: row security is off on notification_pref';
  END IF;
  -- Three permissive policies, each the caller's own, and nothing else.
  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid = 'notification_pref'::regclass;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'db/120: notification_pref has % policies, not three', v_n;
  END IF;
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO v_q FROM pg_policy p
   WHERE p.polrelid = 'notification_pref'::regclass AND p.polname = 'notification_pref_read' AND p.polcmd = 'r';
  IF v_q IS DISTINCT FROM '(person_id = app_user_id())' THEN
    RAISE EXCEPTION 'db/120: notification_pref_read reads %', coalesce(v_q, '(missing)');
  END IF;
  IF (SELECT count(*) FROM pg_policy p
       WHERE p.polrelid = 'notification_pref'::regclass AND p.polcmd IN ('a', 'w')
         AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%(person_id = app_user_id())%'
         AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%is_family_of(subject_player_id)%') <> 2 THEN
    RAISE EXCEPTION 'db/120: an insert or update policy does not hold the row to its writer and his own children';
  END IF;
  IF has_table_privilege('scrbrd_app', 'notification_pref', 'DELETE') THEN
    RAISE EXCEPTION 'db/120: the application may delete a preference';
  END IF;
  IF has_function_privilege('scrbrd_app', 'person_is_pupil(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/120: the application may ask whether anybody is a pupil';
  END IF;
  IF NOT has_function_privilege('scrbrd_app', 'my_alert_choices()', 'EXECUTE')
     OR NOT has_function_privilege('scrbrd_app', 'my_push_quiet_hours()', 'EXECUTE') THEN
    RAISE EXCEPTION 'db/120: the application cannot call its two doors';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'notification_pref_mutable_kind'))
     ~ '(safeguarding|welfare|system|injury|compromise)' THEN
    RAISE EXCEPTION 'db/120: a kind that is never muted may have a preference';
  END IF;
END $check$;
