-- ══════════════════════════════════════════════════════════════════
--  84 · The database keeps the rules the routes were taught this week
-- ══════════════════════════════════════════════════════════════════
--
-- HAND-WRITTEN, after the security review of 2026-10-06. Three of its
-- findings were fixed in a route: the right fix for a pilot, and not the
-- last line. A route is one door; a second route, a script, a hand-run
-- statement in the SQL Editor, or the next person's refactor is another.
-- This file puts each rule where every door passes it.
--
-- WHAT IS HERE
--
--   1. match_squad_00_school_of_side — a BEFORE INSERT OR UPDATE row
--      trigger: a boy named for a side is that side's school's. The side's
--      school is match.school_id for 'home' and match.away_school_id for
--      'away' (squadRoutes.select in services/api/write/events-api.mjs, and
--      db/08's match_squad_side_exists). A boy of another school is refused
--      42501 with a sentence that names nobody. A withdrawn row passes, as
--      every squad trigger lets a withdrawal through (db/08): taking a boy
--      out is always allowed.
--
--      ITS NAME IS ITS ORDER. Postgres fires triggers of the same timing and
--      level in name order, and the two db/08 triggers after this one SAY
--      WHO THE BOY IS: match_squad_is_age_eligible ("<full name> is 14 on 1
--      January and cannot play U13A") and match_squad_is_registered ("cannot
--      select <full name>: not registered to play (pending_consent)"). Both
--      run before any RLS WITH CHECK. So a coach at one school who posted
--      another school's boy's id learnt his name, his age and his family's
--      consent state from the refusal — or, for an adult already
--      registered, put him on the sheet, because team.select names no
--      person and the insert policy asks nothing more. The route now checks
--      this first (05f17f6); this is the same rule beneath it, named
--      `..._00_...` so it sorts ahead of every `match_squad_is_*` and
--      `match_squad_side_*` trigger. The check at the foot asserts the order
--      against pg_trigger in this paste, and db/99 §63 asserts it on every
--      verify, so a later trigger named to sort first is caught the day it
--      lands.
--
--      An away side that is not a school on SCRBRD (away_school_id NULL)
--      has no boy of its own to name, so a row for it is refused here too,
--      with db/08's own sentence and SQLSTATE (23514, which the route
--      already answers in words): before this file, db/08's trigger said so
--      only AFTER the two that name the boy.
--
--   2. news_post_anchor_frozen — a BEFORE UPDATE row trigger: a post's
--      scope, school_id, team_code, competition_id and author_id never
--      change. db/12's news_post_update is USING (author_id = me) WITH CHECK
--      (author_id = me), and its comment says the UPDATE "cannot change the
--      anchor" — the policy never said so. An author could move his own post
--      to another school (school_id), another side (team_code), or widen it
--      from his team to the school (scope), and the read policy, which
--      derives the audience from the anchor, would show it there. Refused
--      42501. author_id may become NULL and nothing else: that is db/12's
--      ON DELETE SET NULL when an account is removed, and the policy's WITH
--      CHECK already refuses a NULL author through the application. The
--      title, the body and published_at stay the author's to change (an
--      edit, a withdrawal), as db/12 and db/83 expect.
--
--   3. role_request.asked_unverified — whether the person asked while
--      signed in as himself. onboard_request() (db/08, POST /api/onboard) is
--      unauthenticated by design: a stranger types an address and a name and
--      gets a pending request on that address's account — an account it
--      makes, or one already on the books. So anybody could file "guardian
--      of <child>" in somebody else's name. db/81's auth_identity_sign_in()
--      then LINKS such a stub to the first Google account whose verified
--      email matches, and from that day the request sat in the office's
--      list under a Google-verified address, as if its owner had asked.
--      Now a BEFORE INSERT trigger stamps every request with whether
--      app_user_id() was the requester (false: he asked, signed in, through
--      POST /api/requests) or not (true: nobody signed in asked, or somebody
--      else did), and the stamp never changes. Linking does not launder it,
--      and a request filed for an address AFTER it was linked carries it
--      too. The office's Requests list reads the column and says, in one
--      line, "Asked before the email was verified": the office phones the
--      number it already holds before it grants (SCRBRD-140 §8,
--      "Impersonating a parent"). Nothing is closed: a real person who
--      asked through the office's code path keeps his place in the queue.
--
--      THE ROWS ALREADY THERE. Nothing recorded who was signed in when they
--      were asked, so a pending request is marked when no Google sign-in was
--      linked to the account at or before the moment it was asked. That
--      marks the stubs' requests, and also any asked through an office code
--      before the account added Google — the safe side: the line asks the
--      office to check, never refuses.
--
-- No secret. RLS: nothing new to read; the column rides role_request_read.
-- The live proof is db/99 §63; tools/smoke-squad.mjs refuses a cross-school
-- boy with the route's own gate bypassed, and tools/smoke-signup.mjs walks
-- the stub through Google. search_path pinned on every function (db/16).
-- Safe to run twice.


-- ── 0 · What this file relies on is there ──────────────────────────
DO $needs$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['match_id', 'player_id', 'side', 'withdrawn'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'match_squad'::regclass
                      AND attname = c AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'db/84: match_squad.% is missing', c;
    END IF;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['school_id', 'away_school_id'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'match'::regclass
                      AND attname = c AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'db/84: match.% is missing', c;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'player'::regclass
                    AND attname = 'school_id' AND attnum > 0 AND NOT attisdropped AND attnotnull) THEN
    RAISE EXCEPTION 'db/84: player.school_id is missing, or no longer NOT NULL';
  END IF;
  -- The five columns the freeze names: the anchor (db/12's news_post_anchored
  -- CHECK) and the byline. A column renamed or dropped since would leave the
  -- trigger comparing nothing, so it is refused here instead.
  FOREACH c IN ARRAY ARRAY['scope', 'school_id', 'team_code', 'competition_id', 'author_id'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'news_post'::regclass
                      AND attname = c AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'db/84: news_post.% is missing', c;
    END IF;
  END LOOP;
  IF to_regclass('auth_identity') IS NULL THEN
    RAISE EXCEPTION 'db/84: auth_identity (db/81) is missing; apply db/81 first';
  END IF;
END $needs$;


-- ── 1 · A boy named for a side is that side's school's ─────────────
CREATE OR REPLACE FUNCTION match_squad_school_of_side() RETURNS trigger AS $$
DECLARE
  v_found  boolean;
  v_school uuid;
BEGIN
  -- Taking a boy OUT is always allowed (db/08's rule for every squad trigger).
  IF NEW.withdrawn THEN RETURN NEW; END IF;

  SELECT true, CASE WHEN NEW.side = 'away' THEN m.away_school_id ELSE m.school_id END
    INTO v_found, v_school
    FROM match m WHERE m.id = NEW.match_id;
  -- No fixture: the foreign key refuses the row, in its own words.
  IF NOT coalesce(v_found, false) THEN RETURN NEW; END IF;

  IF v_school IS NULL THEN
    -- db/08's match_squad_side_exists() sentence, said before anything names
    -- the boy. Nobody is named in it.
    RAISE EXCEPTION
      'this fixture''s away side is not a school on SCRBRD, so its team sheet is not ours to name'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM player p WHERE p.id = NEW.player_id AND p.school_id = v_school) THEN
    -- Nobody named: not the boy, not his school, not why he is not ours.
    -- A player id that is nobody's answers the same.
    RAISE EXCEPTION 'not permitted: a side is named from its own school''s players'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION match_squad_school_of_side() FROM PUBLIC;

COMMENT ON FUNCTION match_squad_school_of_side() IS
  'db/84: a squad row''s player is the side''s school''s (home: match.school_id, away: match.away_school_id). Fires first by name, so no later trigger names a boy of another school.';

DROP TRIGGER IF EXISTS match_squad_00_school_of_side ON match_squad;
CREATE TRIGGER match_squad_00_school_of_side
  BEFORE INSERT OR UPDATE ON match_squad
  FOR EACH ROW EXECUTE FUNCTION match_squad_school_of_side();


-- ── 2 · A post's audience and byline never move ────────────────────
CREATE OR REPLACE FUNCTION news_post_anchor_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW.scope          IS DISTINCT FROM OLD.scope
  OR NEW.school_id      IS DISTINCT FROM OLD.school_id
  OR NEW.team_code      IS DISTINCT FROM OLD.team_code
  OR NEW.competition_id IS DISTINCT FROM OLD.competition_id
  -- NULL is db/12's ON DELETE SET NULL; anything else is a forged byline.
  OR (NEW.author_id IS DISTINCT FROM OLD.author_id AND NEW.author_id IS NOT NULL) THEN
    RAISE EXCEPTION 'not permitted: a post''s audience and author are fixed when it is written; write a new post instead'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION news_post_anchor_frozen() FROM PUBLIC;

DROP TRIGGER IF EXISTS news_post_anchor_frozen ON news_post;
CREATE TRIGGER news_post_anchor_frozen
  BEFORE UPDATE ON news_post
  FOR EACH ROW EXECUTE FUNCTION news_post_anchor_frozen();


-- ── 3 · Whether the requester asked, signed in as himself ──────────
ALTER TABLE role_request ADD COLUMN IF NOT EXISTS asked_unverified boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN role_request.asked_unverified IS
  'db/84: true when the request was not made by its person signed in as himself (POST /api/onboard, signed out). Stamped at insert, never changed. The office reads it as "Asked before the email was verified".';

-- The rows already there, before the trigger that freezes the column. A
-- second run finds the trigger in place and changes nothing.
DO $backfill$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'role_request'::regclass
                AND tgname = 'role_request_asked_unverified' AND NOT tgisinternal) THEN
    RETURN;
  END IF;
  UPDATE role_request r SET asked_unverified = true
   WHERE r.state = 'pending'
     AND NOT EXISTS (SELECT 1 FROM auth_identity x
                      WHERE x.user_id = r.person_id AND x.linked_at <= r.requested_at);
END $backfill$;

CREATE OR REPLACE FUNCTION role_request_asked_unverified() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The session, never the caller's word: POST /api/requests inserts as
    -- the person (role_request_insert: person_id = app_user_id()); POST
    -- /api/onboard runs with nobody signed in.
    NEW.asked_unverified := app_user_id() IS DISTINCT FROM NEW.person_id;
  ELSE
    NEW.asked_unverified := OLD.asked_unverified;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION role_request_asked_unverified() FROM PUBLIC;

DROP TRIGGER IF EXISTS role_request_asked_unverified ON role_request;
CREATE TRIGGER role_request_asked_unverified
  BEFORE INSERT OR UPDATE ON role_request
  FOR EACH ROW EXECUTE FUNCTION role_request_asked_unverified();


-- ── 4 · What this file promised, checked in the same paste ──────────
-- The behaviour is asserted live in db/99 §63.
DO $check$
DECLARE
  v_first text;
  v_late  text;
  f       text;
BEGIN
  -- The guard is on the table, enabled, BEFORE, FOR EACH ROW, on INSERT and UPDATE.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'match_squad'::regclass AND t.tgname = 'match_squad_00_school_of_side'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O'
                    AND t.tgfoid = 'match_squad_school_of_side()'::regprocedure
                    AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2      -- ROW, BEFORE
                    AND (t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16    -- INSERT, UPDATE
                ) THEN
    RAISE EXCEPTION 'db/84: match_squad_00_school_of_side is not a BEFORE INSERT OR UPDATE row trigger, enabled';
  END IF;

  -- THE ORDER. Postgres fires same-timing triggers by name (strcmp, so "C").
  -- Every other BEFORE row trigger on match_squad must sort after the guard,
  -- and the two that name a boy must be among them.
  SELECT t.tgname INTO v_first FROM pg_trigger t
   WHERE t.tgrelid = 'match_squad'::regclass AND NOT t.tgisinternal
     AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2
   ORDER BY t.tgname COLLATE "C" LIMIT 1;
  IF v_first IS DISTINCT FROM 'match_squad_00_school_of_side' THEN
    RAISE EXCEPTION 'db/84: % fires before the school-of-side guard on match_squad', v_first;
  END IF;
  FOREACH v_late IN ARRAY ARRAY['match_squad_is_age_eligible', 'match_squad_is_registered', 'match_squad_side_is_real'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'match_squad'::regclass AND t.tgname = v_late) THEN
      RAISE EXCEPTION 'db/84: % (db/08) is missing from match_squad', v_late;
    END IF;
    IF NOT ('match_squad_00_school_of_side' COLLATE "C" < v_late COLLATE "C") THEN
      RAISE EXCEPTION 'db/84: % sorts before the school-of-side guard', v_late;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'news_post'::regclass AND t.tgname = 'news_post_anchor_frozen'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O'
                    AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16) THEN
    RAISE EXCEPTION 'db/84: news_post_anchor_frozen is not a BEFORE UPDATE row trigger, enabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'role_request'::regclass AND t.tgname = 'role_request_asked_unverified'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O'
                    AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2
                    AND (t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16) THEN
    RAISE EXCEPTION 'db/84: role_request_asked_unverified is not a BEFORE INSERT OR UPDATE row trigger, enabled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'role_request'::regclass
                    AND attname = 'asked_unverified' AND attnotnull AND NOT attisdropped) THEN
    RAISE EXCEPTION 'db/84: role_request.asked_unverified is missing, or nullable';
  END IF;

  -- The guard reads past RLS (a check that cannot see the boy passes him),
  -- and every function here pins its search_path and answers nobody directly.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'match_squad_school_of_side()'::regprocedure) THEN
    RAISE EXCEPTION 'db/84: match_squad_school_of_side() is not SECURITY DEFINER';
  END IF;
  FOREACH f IN ARRAY ARRAY['match_squad_school_of_side()', 'news_post_anchor_frozen()', 'role_request_asked_unverified()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = f::regprocedure
                      AND 'search_path=pg_catalog, public, pg_temp' = ANY (coalesce(proconfig, '{}'))) THEN
      RAISE EXCEPTION 'db/84: % does not pin its search_path', f;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                WHERE p.oid = f::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'db/84: % is executable by PUBLIC', f;
    END IF;
  END LOOP;

  -- The refusals name nobody: no format placeholder anywhere in the body.
  SELECT prosrc INTO f FROM pg_proc WHERE oid = 'match_squad_school_of_side()'::regprocedure;
  IF position('%' IN f) > 0 THEN
    RAISE EXCEPTION 'db/84: the school-of-side guard formats a value into a refusal';
  END IF;
END $check$;
