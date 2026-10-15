-- ══════════════════════════════════════════════════════════════════
--  109 · Account lifecycle, slice 3: a child's links, and the reason for an ending
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN. The design is docs/design/ACCOUNT_LIFECYCLE.md §4 and §12
-- row 3 (decided, Kameel 2026-10-07: D11–D14, Q8, Q10, Q13, A4). Its proof
-- is db/99 §86, walked through the API by tools/smoke-family-links.mjs.
--
-- D13. EVERY ENDING OF A GUARDIAN LINK IS RECORDED, WITH A KIND, AND A
-- REASON WHEN A PERSON ENDED IT, in a row the parent and the public never
-- read. Not a column on assignment_subject: the parent's own session reads
-- that row (db/01's assignment_subject_read), so a reason there leaks on the
-- first read. db/47's public rule is unchanged and stays the conservative
-- one: every revoked link reads as "revoked as untrue", so the consents given
-- through it count for nothing and the child is "Batter" on every public page
-- until another competent person answers (D14). The row is for the office,
-- which will be asked why a link ended, in a custody dispute most of all.
--
-- THE KINDS, AND WHO WRITES EACH
--   custody, family_left,   guardian_link_revoke(link, kind, reason): the
--   guardian_asked, office  office (guardian.link.manage at the child's
--                           school), a reason of ten characters or more, its
--                           name kept as ended_by
--   role_ended              db/77's role_assignment_end() ending a guardian
--                           role: the links it revoked, with the role's own
--                           reason and ender. Written by a trigger on
--                           role_assignment_ending, so db/77 is not re-emitted
--   majority, left_school   db/62's CLOSE path, when the last school
--                           membership of the boy closes: his links end on
--                           his eighteenth birthday (a minor who left: D11,
--                           'majority') or on the day he left (an adult who
--                           left: 'left_school'). No reason, no actor. When he
--                           comes back, db/62's OPEN path re-opens a link
--                           ending on his birthday and its 'majority' row goes
--                           with it: the row says how a link ends, and that
--                           one no longer does.
-- Nothing ends a link by the clock (Q8): a 'majority' row is written on the
-- day he leaves, never on the birthday, and a link that simply runs to his
-- birthday (a club member's, set when it was made) has no row at all.
--
-- WHO READS IT (D12, D13, Q10): guardian.link.manage at the school, or
-- audit.read there, but never the guardian it is about and never the DSO by
-- standing: a holder of safeguarding.concern.read at the school reads it
-- only through an open concern, where safeguarding_family() (db/57,
-- re-emitted here) now lists the child's ended links with their kind and
-- date and never the reason (Q10). A pad credential reads none of it. And
-- never a platform-wide holder (the platform administrator, the owner's key)
-- outside a live support session at that school (db/22; Kameel,
-- 15 October 2026): inside one it reads as the role the session lent it.
--
-- WHAT IT CHANGES ON A LIVE DATABASE
--   guardian_link_ending    new table, RLS, SELECT only to the application;
--                           RESTRICTIVE guardian_link_ending_not_platform
--   guardian_link_revoke(uuid, text, text)   new: the one door, (link, kind,
--                           reason). Answers in words, refuses in this order:
--                           not_signed_in · no_such_link · not_permitted ·
--                           own_link · no_open_link · last_verified_link ·
--                           kind_required · kind_not_allowed ·
--                           reason_required · reason_too_long
--   guardian_link_revoke(uuid, uuid, text)   db/08's door without a kind or a
--                           reason. NOT DROPPED (the production paste tool
--                           hangs on a statement that removes an object):
--                           its EXECUTE is taken from PUBLIC, the application
--                           and a managed host's API roles, so nothing but the
--                           owner can call it. The one route that called it
--                           (POST /api/players/:id/guardians/revoke) now finds
--                           the link and calls the new door
--   guardian_link_ending_notice_is_mine(uuid)   new: the notice's door
--   notification            + PERMISSIVE SELECT policy notification_link_ended
--                           (db/57's and db/50's RESTRICTIVE cuts stand over it)
--   role_assignment_ending  + trigger role_assignment_ending_links (AFTER INSERT)
--   guardian_links_close_on_leaving(uuid, date), guardian_links_reopen_at_school(uuid)
--                           db/62's, re-emitted with the ending row written
--                           and taken back. md5-guarded: each refuses to run
--                           over a body it was not written against
--   safeguarding_family(uuid)   db/57's, re-emitted with `ended` (Q10).
--                           md5-guarded the same way
--
-- EXISTING ROWS. None is changed. No link moves, no notice is written. Links
-- revoked or dated out before this file have no ending row: the office's
-- read shows their state and dates, and "no reason recorded".
--
-- ORDER WITH THE API. The API built with this calls the three-argument door
-- and refuses to start without db/109 (expected-migrations.json). An API from
-- before it calls db/08's form, whose EXECUTE this takes: between the paste
-- and the new API, revoking a link answers "not permitted" and changes
-- nothing. Everything else works.
--
-- search_path pinned on every function (db/16). Safe to run twice.


-- ── 1 · The row (D13) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guardian_link_ending (
  link_id     uuid PRIMARY KEY,
  -- The link's own key is (assignment_id, player_id, id): the foreign key
  -- runs through all three, as db/47's and db/60's consents do.
  assignment_id uuid NOT NULL,
  -- Copied, so the row reads alone and its policy needs no join.
  player_id   uuid NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  school_id   uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  guardian_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('custody', 'family_left', 'guardian_asked', 'office',
                                            'role_ended', 'majority', 'left_school')),
  -- The office's words. Never to the parent, the public or the DSO.
  reason      text CHECK (reason IS NULL OR length(reason) <= 2000),
  -- NULL for the two automatic kinds, and only for them.
  ended_by    uuid REFERENCES app_user(id),
  -- The day the link ends (its valid_until): today for a revocation, his
  -- birthday or the day he left for db/62's.
  ends_on     date NOT NULL,
  ended_at    timestamptz NOT NULL DEFAULT now(),
  notice_id   uuid REFERENCES notification(id) ON DELETE SET NULL,
  FOREIGN KEY (assignment_id, player_id, link_id)
    REFERENCES assignment_subject (assignment_id, player_id, id) ON DELETE CASCADE,
  CONSTRAINT guardian_link_ending_reason_kept
    CHECK (kind IN ('majority', 'left_school') OR length(btrim(coalesce(reason, ''))) >= 10),
  CONSTRAINT guardian_link_ending_by_whom
    CHECK ((kind IN ('majority', 'left_school')) = (ended_by IS NULL)),
  CONSTRAINT guardian_link_ending_automatic_says_nothing
    CHECK (kind NOT IN ('majority', 'left_school') OR reason IS NULL)
);
CREATE INDEX IF NOT EXISTS guardian_link_ending_player_idx ON guardian_link_ending (player_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS guardian_link_ending_guardian_idx ON guardian_link_ending (guardian_id);
CREATE INDEX IF NOT EXISTS guardian_link_ending_notice_idx ON guardian_link_ending (notice_id) WHERE notice_id IS NOT NULL;

ALTER TABLE guardian_link_ending ENABLE ROW LEVEL SECURITY;
DO $read$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guardian_link_ending'
                    AND policyname = 'guardian_link_ending_read') THEN
    CREATE POLICY guardian_link_ending_read ON guardian_link_ending
      FOR SELECT USING (
        coalesce(guardian_id <> app_user_id(), false)
        AND (app_can('guardian.link.manage', school_id, '*'::text,
                     '00000000-0000-0000-0000-000000000000'::uuid,
                     '00000000-0000-0000-0000-000000000000'::uuid)
             OR (app_can('audit.read', school_id, '*'::text,
                         '00000000-0000-0000-0000-000000000000'::uuid,
                         '00000000-0000-0000-0000-000000000000'::uuid)
                 -- Not the DSO by standing (D12, Q10): audit.read is hers for
                 -- "who read this child's record", not for the office's words
                 -- about a family. Inside a concern she reads the kind and the
                 -- date through safeguarding_family().
                 AND NOT app_can('safeguarding.concern.read', school_id, '*'::text,
                                 '00000000-0000-0000-0000-000000000000'::uuid,
                                 '00000000-0000-0000-0000-000000000000'::uuid)))
      );
  END IF;
END $read$;
-- Never platform-wide (Kameel, 15 October 2026): a holder of a platform-wide
-- assignment (the platform administrator, the owner's key) reads a row only
-- inside a live support session at that row's school
-- (db/22). Outside one, its platform-wide user.role.assign and audit.read
-- reach no family here; inside one it reads as the role the session lent it.
-- A school's own holders are not platform-wide and read as before. db/104's
-- shape: the platform question asked once per statement (an InitPlan).
DO $platform$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guardian_link_ending'
                    AND policyname = 'guardian_link_ending_not_platform') THEN
    CREATE POLICY guardian_link_ending_not_platform ON guardian_link_ending AS RESTRICTIVE
      FOR SELECT USING (
        NOT (SELECT app_is_platform_wide())
        OR app_support_access_id(guardian_link_ending.school_id) IS NOT NULL
      );
  END IF;
END $platform$;
SELECT pad_scope_guard_install('guardian_link_ending'::regclass);
GRANT SELECT ON guardian_link_ending TO scrbrd_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON guardian_link_ending FROM scrbrd_app;


-- ── 2 · The notice's own door (§4.5) ───────────────────────────────
-- TRUE for a notice guardian_link_revoke() wrote to the caller about a link
-- of theirs that ended. Definer, because the guardian may not read the row;
-- it answers this one bit, about a notice addressed to them, so the notice
-- reaches her even when the link was her last at that school.
CREATE OR REPLACE FUNCTION guardian_link_ending_notice_is_mine(p_notice uuid) RETURNS boolean AS $$
  SELECT app_user_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM guardian_link_ending e
     WHERE e.notice_id = p_notice AND e.guardian_id = app_user_id())
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

DO $door$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_link_ended') THEN
    CREATE POLICY notification_link_ended ON notification
      FOR SELECT USING (
        kind = 'system' AND recipient_id = app_user_id() AND guardian_link_ending_notice_is_mine(id)
      );
  END IF;
END $door$;


-- ── 3 · The door, with a kind and a reason (D13, D14) ─────────────
/**
 * The office ends one guardian link, saying how and why (ok, reason).
 * Refusals, in this order:
 *   not_signed_in · no_such_link (no link, or not a guardian's) ·
 *   not_permitted (no guardian.link.manage at the child's school, or a
 *   platform-wide caller with no live support session there) ·
 *   own_link (nobody ends a link of their own: G1, as guardian_link_verify()
 *   refuses self_verified) · no_open_link (already ended, rejected or run
 *   out) · last_verified_link (db/08's rule: the child is a minor, or his
 *   age is not known, and this is his only live verified link — link the new
 *   guardian first) · kind_required · kind_not_allowed (the automatic kinds
 *   are the system's) · reason_required (under ten characters) ·
 *   reason_too_long (over 2,000)
 * Authority before anything about the link, so a stranger learns nothing.
 * The link's state and the last-link rule before the kind and the reason, so
 * the office is not asked to write a reason for an act that cannot happen.
 *
 * The link is marked revoked and dated to today, never deleted (db/08). A
 * guardian assignment left with no live verified link ends with it, as db/08
 * ended it. The guardian is told in one notice, kind 'system': the school
 * and the date, no child's name and never the reason. What goes with the
 * link is the existing rules' doing, unchanged (D14): his public name
 * (db/47), health consent through it (db/60), her seats and offers (db/70).
 */
CREATE OR REPLACE FUNCTION guardian_link_revoke(p_link uuid, p_kind text, p_reason text)
RETURNS TABLE (ok boolean, reason text) AS $$
DECLARE
  v_me     uuid := app_user_id();
  v_why    text := btrim(coalesce(p_reason, ''));
  v_kind   text := nullif(btrim(coalesce(p_kind, '')), '');
  g        assignment_subject%ROWTYPE;
  v_person uuid;
  v_school uuid;
  v_minor  boolean;
  v_live   int;
  v_until  date;
  v_name   text;
  v_notice uuid;
BEGIN
  IF v_me IS NULL THEN RETURN QUERY SELECT false, 'not_signed_in'; RETURN; END IF;
  IF p_link IS NULL THEN RETURN QUERY SELECT false, 'no_such_link'; RETURN; END IF;
  SELECT s.* INTO g FROM assignment_subject s WHERE s.id = p_link FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, 'no_such_link'; RETURN; END IF;
  SELECT a.person_id INTO v_person FROM role_assignment a WHERE a.id = g.assignment_id AND a.role = 'guardian';
  IF v_person IS NULL THEN RETURN QUERY SELECT false, 'no_such_link'; RETURN; END IF;
  v_school := player_school(g.player_id);
  IF v_school IS NULL
     OR NOT app_can('guardian.link.manage', v_school, '*'::text,
                    '00000000-0000-0000-0000-000000000000'::uuid,
                    '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  -- No platform role gains school authority here (Kameel, 15 October 2026):
  -- a caller holding a platform-wide assignment (the owner's key) ends a
  -- family's link only inside a live support session at the child's school
  -- (db/22), as the role the session lent it. db/104's shape. A school's own
  -- holders are not platform-wide and are not asked.
  IF app_is_platform_wide() AND app_support_access_id(v_school) IS NULL THEN
    RETURN QUERY SELECT false, 'not_permitted'; RETURN;
  END IF;
  IF v_person = v_me THEN RETURN QUERY SELECT false, 'own_link'; RETURN; END IF;
  -- LIVE, in db/08's terms: pending or verified, and not yet run out.
  IF g.verification_state NOT IN ('pending', 'verified')
     OR (g.valid_until IS NOT NULL AND g.valid_until <= current_date) THEN
    RETURN QUERY SELECT false, 'no_open_link'; RETURN;
  END IF;
  -- db/08's rule, asked of the link it is about: a pending link never
  -- counted, so ending one leaves the child exactly as accountable as before.
  SELECT s.is_minor, s.live_links INTO v_minor, v_live
    FROM player_guardian_status s WHERE s.player_id = g.player_id;
  IF g.verification_state = 'verified' AND g.valid_from <= current_date
     AND coalesce(v_minor, true) AND coalesce(v_live, 0) <= 1 THEN
    RETURN QUERY SELECT false, 'last_verified_link'; RETURN;
  END IF;
  IF v_kind IS NULL THEN RETURN QUERY SELECT false, 'kind_required'; RETURN; END IF;
  IF v_kind NOT IN ('custody', 'family_left', 'guardian_asked', 'office') THEN
    RETURN QUERY SELECT false, 'kind_not_allowed'; RETURN;
  END IF;
  IF length(v_why) < 10 THEN RETURN QUERY SELECT false, 'reason_required'; RETURN; END IF;
  IF length(v_why) > 2000 THEN RETURN QUERY SELECT false, 'reason_too_long'; RETURN; END IF;

  v_until := greatest(current_date, g.valid_from);
  UPDATE assignment_subject SET verification_state = 'revoked', valid_until = v_until WHERE id = g.id;

  -- db/08: a guardian assignment naming nobody live is ended, so the register
  -- does not say she is a guardian here when she is nobody's.
  UPDATE role_assignment a
     SET active = false, valid_until = current_date
   WHERE a.id = g.assignment_id AND a.active
     AND NOT EXISTS (SELECT 1 FROM assignment_subject o
                      WHERE o.assignment_id = a.id
                        AND o.verification_state = 'verified'
                        AND o.valid_from <= current_date
                        AND (o.valid_until IS NULL OR o.valid_until > current_date));

  -- The notice (§4.5, Q7): the school may be named; the child may not — the
  -- link that admitted her to his name is the one that ended.
  SELECT s.name INTO v_name FROM school s WHERE s.id = v_school;
  INSERT INTO notification (school_id, team_code, scope_level, kind, urgency, title, body,
                            required_capability, is_public, subject_kind, subject_id, recipient_id)
  VALUES (v_school, NULL, 'school', 'system', 'medium', 'A link to a child has ended',
          'Your link to a child at ' || coalesce(v_name, 'a school') || ' ended on '
            || to_char(v_until, 'FMDD FMMonth YYYY')
            || '. The school office can say why; the platform does not.',
          'news.read', false, 'system', g.id, v_person)
  RETURNING id INTO v_notice;

  INSERT INTO guardian_link_ending AS e (link_id, assignment_id, player_id, school_id, guardian_id, kind, reason, ended_by, ends_on, notice_id)
  VALUES (g.id, g.assignment_id, g.player_id, v_school, v_person, v_kind, v_why, v_me, v_until, v_notice)
  -- A link db/62 had dated to his birthday when he left is still live and may
  -- be revoked; the revocation is now how it ends.
  ON CONFLICT (link_id) DO UPDATE
    SET kind = excluded.kind, reason = excluded.reason, ended_by = excluded.ended_by,
        ends_on = excluded.ends_on, ended_at = excluded.ended_at, notice_id = excluded.notice_id;

  RETURN QUERY SELECT true, NULL::text;
END $$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 4 · db/77: a guardian role ended takes its links, and says so ──
-- role_assignment_end() revokes every live link of a guardian assignment it
-- ends (valid_until = greatest(valid_from, today)) and then writes its own
-- audit row. This trigger, on that row, writes one guardian_link_ending per
-- link it revoked: kind 'role_ended', the role's reason, its ender, and the
-- role's notice (db/77's words: the role, the school, the date). A link
-- already carrying a revocation of its own keeps it; one db/62 had dated is
-- now ended by the role.
CREATE OR REPLACE FUNCTION role_assignment_ending_links() RETURNS trigger AS $$
BEGIN
  INSERT INTO guardian_link_ending AS e (link_id, assignment_id, player_id, school_id, guardian_id, kind, reason, ended_by, ends_on, notice_id)
  SELECT g.id, g.assignment_id, g.player_id, coalesce(player_school(g.player_id), NEW.school_id), NEW.person_id,
         'role_ended', NEW.reason, NEW.ended_by, g.valid_until, NEW.notice_id
    FROM assignment_subject g
   WHERE g.assignment_id = NEW.assignment_id
     AND g.verification_state = 'revoked'
     AND g.valid_until = greatest(g.valid_from, current_date)
     AND coalesce(player_school(g.player_id), NEW.school_id) IS NOT NULL
  ON CONFLICT (link_id) DO UPDATE
    SET kind = excluded.kind, reason = excluded.reason, ended_by = excluded.ended_by,
        ends_on = excluded.ends_on, ended_at = excluded.ended_at, notice_id = excluded.notice_id
    WHERE e.kind IN ('majority', 'left_school');
  RETURN NULL;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE TRIGGER role_assignment_ending_links
  AFTER INSERT ON role_assignment_ending
  FOR EACH ROW WHEN (NEW.role = 'guardian')
  EXECUTE FUNCTION role_assignment_ending_links();


-- ── 5 · db/62: the automatic kinds ─────────────────────────────────
-- Both functions are re-emitted from db/62's text, each with one statement
-- added. Guarded: the body in place must be db/62's (its md5, taken from a
-- database at db/102; db/57 for the third), or this file's own (a second run).
DO $guard62$
DECLARE r record; v_src text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('guardian_links_close_on_leaving(uuid,date)', 'b0c16f71bcdea8b739ae2a3cd408745d'),
      ('guardian_links_reopen_at_school(uuid)',      '5b7f33d8c76af4ae2793e06990fc1b8a'),
      ('safeguarding_family(uuid)',                  '488d3b36cb30a9846e436d69ee96808c')) AS t(f, h) LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'db/109: % is not there to re-emit', r.f;
    END IF;
    IF position('guardian_link_ending' IN v_src) = 0 AND md5(v_src) IS DISTINCT FROM r.h THEN
      RAISE EXCEPTION 'db/109: % is not the version this file was written against (md5 %); factor the version now in place and move its hash',
        r.f, md5(v_src);
    END IF;
  END LOOP;
END $guard62$;

/**
 * He has left the school system: every open guardian link for him ends on
 * the later of the day he left and his eighteenth birthday. Only ever
 * shortens a link: one already ending sooner keeps its own date. Never before
 * the link began (assignment_subject's own CHECK; db/10's clamp). Internal.
 *
 * db/109: and each link it shortens gets its ending row — 'majority' when it
 * now ends on his birthday, after the day he left (a minor: D11, his parents
 * keep their links until then), 'left_school' when it ends the day he left
 * (an adult). No reason, no actor, no notice (§4.5: the parents' notice on
 * leaving is the departure's, slice 4).
 */
CREATE OR REPLACE FUNCTION guardian_links_close_on_leaving(p_player uuid, p_left_on date)
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  WITH closed AS (
    UPDATE assignment_subject s
       SET valid_until = greatest(p_left_on, majority_on(p.born), s.valid_from)
      FROM role_assignment a, player p
     WHERE a.id = s.assignment_id AND a.role = 'guardian'
       AND p.id = s.player_id
       AND s.player_id = p_player
       AND s.verification_state IN ('pending', 'verified')
       AND (s.valid_until IS NULL
            OR s.valid_until > greatest(p_left_on, majority_on(p.born), s.valid_from))
    RETURNING s.id, s.assignment_id, s.player_id, s.valid_until, a.person_id, coalesce(p.school_id, a.school_id) AS school_id, p.born),
  noted AS (
    INSERT INTO guardian_link_ending AS e (link_id, assignment_id, player_id, school_id, guardian_id, kind, reason, ended_by, ends_on)
    SELECT c.id, c.assignment_id, c.player_id, c.school_id, c.person_id,
           CASE WHEN c.valid_until = majority_on(c.born) AND majority_on(c.born) > p_left_on
                THEN 'majority' ELSE 'left_school' END,
           NULL, NULL, c.valid_until
      FROM closed c
     WHERE c.school_id IS NOT NULL
    ON CONFLICT (link_id) DO UPDATE
      SET kind = excluded.kind, ends_on = excluded.ends_on, ended_at = excluded.ended_at
      WHERE e.kind IN ('majority', 'left_school')
    RETURNING 1)
  SELECT count(*)::int INTO n FROM closed;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;

/**
 * He is at school: every guardian link of his that ends on his eighteenth
 * birthday — ahead, or already passed — and is not otherwise ended is open
 * again. Not otherwise ended: pending or verified, through a guardian
 * assignment still active and not dated out. A link that ends on any other
 * day (revoked, ended when he left as an adult, clamped by db/10) stays
 * ended. One per guardian per child: never a second open link beside one
 * (assignment_subject_one_open_link). Internal.
 *
 * db/109: a link re-opened no longer ends, so its 'majority' row goes.
 */
CREATE OR REPLACE FUNCTION guardian_links_reopen_at_school(p_player uuid)
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  WITH reopened AS (
    UPDATE assignment_subject s
       SET valid_until = NULL
     WHERE s.id IN (
       SELECT DISTINCT ON (g.assignment_id, g.player_id) g.id
         FROM assignment_subject g
         JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian'
         JOIN player p ON p.id = g.player_id
        WHERE g.player_id = p_player
          AND g.verification_state IN ('pending', 'verified')
          AND g.valid_until = majority_on(p.born)
          AND a.active
          AND (a.valid_until IS NULL OR a.valid_until > current_date)
          AND NOT EXISTS (SELECT 1 FROM assignment_subject o
                           WHERE o.assignment_id = g.assignment_id AND o.player_id = g.player_id
                             AND o.verification_state IN ('pending', 'verified')
                             AND o.valid_until IS NULL)
        ORDER BY g.assignment_id, g.player_id, g.created_at DESC, g.id)
    RETURNING s.id),
  untold AS (
    DELETE FROM guardian_link_ending e USING reopened r
     WHERE e.link_id = r.id AND e.kind IN ('majority', 'left_school')
    RETURNING 1)
  SELECT count(*)::int INTO n FROM reopened;
  RETURN n;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 6 · Q10: inside an open concern, the DSO reads how a link ended ──
-- db/57's safeguarding_family(), re-emitted with one key added: `ended`, the
-- child's guardian links that have ended or are dated to end, newest first —
-- the guardian's name, the relationship, the kind and the date. Never the
-- reason: that is the office's words, and the office is who she asks. Still
-- only while the concern is open, still logged under it.
CREATE OR REPLACE FUNCTION safeguarding_family(p_concern uuid) RETURNS jsonb AS $$
DECLARE
  c safeguarding_concern%ROWTYPE;
  v jsonb;
BEGIN
  SELECT * INTO c FROM safeguarding_concern sc WHERE sc.id = p_concern;
  IF NOT FOUND OR NOT safeguarding_reader(c.tenant_id)
     OR c.subject_person_id IS NOT DISTINCT FROM app_user_id()
     OR c.state <> 'open' OR c.subject_player_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'guardians', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', u.name, 'email', u.email, 'relationship', g.relationship,
                                          'linkId', g.id, 'personId', u.id) ORDER BY u.name)
        FROM assignment_subject g
        JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian' AND a.active
        JOIN app_user u ON u.id = a.person_id AND u.active
       WHERE g.player_id = c.subject_player_id AND g.verification_state = 'verified'
         AND g.valid_from <= current_date AND (g.valid_until IS NULL OR g.valid_until > current_date)), '[]'::jsonb),
    'emergency', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', e.name, 'relationship', e.relationship, 'phone', e.phone,
                                          'phoneAlt', e.phone_alt, 'email', e.email, 'priority', e.priority)
                       ORDER BY e.priority)
        FROM emergency_contact e WHERE e.player_id = c.subject_player_id AND e.active), '[]'::jsonb),
    -- db/109 (Q10): the kind and the date, never the reason (guardian_link_ending).
    'ended', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', u.name, 'relationship', g.relationship,
                                          'kind', x.kind, 'endsOn', x.ends_on, 'linkId', g.id)
                       ORDER BY x.ends_on DESC, x.ended_at DESC)
        FROM guardian_link_ending x
        JOIN assignment_subject g ON g.id = x.link_id
        JOIN app_user u ON u.id = x.guardian_id
       WHERE x.player_id = c.subject_player_id), '[]'::jsonb)
  ) INTO v;
  PERFORM log_restricted_read('safeguarding_family', ARRAY[c.id], ARRAY['guardian', 'emergency'], c.tenant_id);
  RETURN v;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;


-- ── 7 · Who may call these ─────────────────────────────────────────
DO $grants$
DECLARE f text; r text;
BEGIN
  -- The door and the notice's door are the application's (the second is
  -- called from the notification policy, as the reader).
  FOREACH f IN ARRAY ARRAY['guardian_link_revoke(uuid,text,text)', 'guardian_link_ending_notice_is_mine(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO scrbrd_app', f::regprocedure);
  END LOOP;
  -- Internal: triggers and other definers only. CREATE OR REPLACE kept db/62's
  -- and db/57's grants; these are restated so a second run says the same.
  FOREACH f IN ARRAY ARRAY['role_assignment_ending_links()', 'guardian_links_close_on_leaving(uuid,date)',
                           'guardian_links_reopen_at_school(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f::regprocedure);
  END LOOP;
  REVOKE ALL ON FUNCTION safeguarding_family(uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION safeguarding_family(uuid) TO scrbrd_app;
  -- db/08's door without a kind or a reason: nobody's but the owner's now.
  REVOKE ALL ON FUNCTION guardian_link_revoke(uuid, uuid, text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION guardian_link_revoke(uuid, uuid, text) FROM scrbrd_app;
  -- A managed host's API roles (Supabase grants new objects to them).
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION guardian_link_revoke(uuid, text, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION guardian_link_revoke(uuid, uuid, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION guardian_link_ending_notice_is_mine(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION role_assignment_ending_links() FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION guardian_links_close_on_leaving(uuid, date) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION guardian_links_reopen_at_school(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION safeguarding_family(uuid) FROM %I', r);
      EXECUTE format('REVOKE ALL ON guardian_link_ending FROM %I', r);
    END IF;
  END LOOP;
END $grants$;


-- ── 8 · What this file promised, checked in the same paste ─────────
-- The behaviour is asserted live in db/99 §86.
DO $check$
DECLARE f text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'guardian_link_ending'::regclass) THEN
    RAISE EXCEPTION 'db/109: guardian_link_ending is not under row-level security';
  END IF;
  IF has_table_privilege('scrbrd_app', 'guardian_link_ending', 'INSERT')
     OR has_table_privilege('scrbrd_app', 'guardian_link_ending', 'UPDATE')
     OR has_table_privilege('scrbrd_app', 'guardian_link_ending', 'DELETE') THEN
    RAISE EXCEPTION 'db/109: the application may write guardian_link_ending';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guardian_link_ending'
                AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'db/109: guardian_link_ending has a write policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guardian_link_ending'
                    AND policyname = 'pad_scope_select' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'db/109: guardian_link_ending has no RESTRICTIVE pad_scope_select (db/50)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guardian_link_ending'
                    AND policyname = 'guardian_link_ending_read' AND cmd = 'SELECT'
                    AND qual LIKE '%safeguarding.concern.read%' AND qual LIKE '%app_user_id()%') THEN
    RAISE EXCEPTION 'db/109: guardian_link_ending_read is not the policy this file wrote';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guardian_link_ending'
                    AND policyname = 'guardian_link_ending_not_platform' AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
                    AND qual LIKE '%app_is_platform_wide()%' AND qual LIKE '%app_support_access_id(%') THEN
    RAISE EXCEPTION 'db/109: guardian_link_ending is readable platform-wide outside a support session';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
                    AND policyname = 'notification_link_ended' AND permissive = 'PERMISSIVE' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'db/109: notification_link_ended is missing';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification'
         AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT'
         AND policyname IN ('notification_recipient_only', 'notification_safeguarding_uncut', 'pad_scope_select')) <> 3 THEN
    RAISE EXCEPTION 'db/109: a RESTRICTIVE cut on notification is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'role_assignment_ending'::regclass
                    AND tgname = 'role_assignment_ending_links' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'db/109: role_assignment_ending_links is not enabled';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'team_membership'::regclass AND tgenabled = 'O'
         AND tgname IN ('team_membership_closes_guardian_links', 'team_membership_opens_guardian_links')) <> 2 THEN
    RAISE EXCEPTION 'db/109: db/62''s two triggers on team_membership are not both enabled';
  END IF;
  -- No door without a kind and a reason, for anybody the application is.
  IF has_function_privilege('scrbrd_app', 'guardian_link_revoke(uuid,uuid,text)', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                 WHERE p.oid = 'guardian_link_revoke(uuid,uuid,text)'::regprocedure
                   AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'db/109: db/08''s guardian_link_revoke(uuid, uuid, text) is still callable';
  END IF;
  FOREACH f IN ARRAY ARRAY['guardian_link_revoke(uuid,text,text)', 'guardian_link_ending_notice_is_mine(uuid)',
                           'role_assignment_ending_links()', 'guardian_links_close_on_leaving(uuid,date)',
                           'guardian_links_reopen_at_school(uuid)', 'safeguarding_family(uuid)'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'db/109: % is not SECURITY DEFINER', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/109: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/109: % is executable by PUBLIC', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['guardian_link_revoke(uuid,text,text)', 'guardian_link_ending_notice_is_mine(uuid)',
                           'safeguarding_family(uuid)'] LOOP
    IF NOT has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/109: the application cannot call %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['role_assignment_ending_links()', 'guardian_links_close_on_leaving(uuid,date)',
                           'guardian_links_reopen_at_school(uuid)'] LOOP
    IF has_function_privilege('scrbrd_app', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'db/109: the application may call the internal %', f;
    END IF;
  END LOOP;
  -- The door refuses a platform-wide caller outside a support session.
  IF position('app_is_platform_wide()' IN (SELECT prosrc FROM pg_proc WHERE oid = 'guardian_link_revoke(uuid,text,text)'::regprocedure)) = 0
     OR position('app_support_access_id(v_school)' IN (SELECT prosrc FROM pg_proc WHERE oid = 'guardian_link_revoke(uuid,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'db/109: guardian_link_revoke() does not refuse a platform-wide caller outside a support session';
  END IF;
  -- The re-emits carry the ending row.
  FOREACH f IN ARRAY ARRAY['guardian_links_close_on_leaving(uuid,date)', 'guardian_links_reopen_at_school(uuid)',
                           'safeguarding_family(uuid)'] LOOP
    IF position('guardian_link_ending' IN (SELECT prosrc FROM pg_proc WHERE oid = f::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'db/109: % was not re-emitted', f;
    END IF;
  END LOOP;
  -- D13: never a reason on the link itself.
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'assignment_subject'::regclass AND NOT attisdropped
                AND attname ~ 'reason') THEN
    RAISE EXCEPTION 'db/109: assignment_subject carries a reason column (D13)';
  END IF;
END $check$;
