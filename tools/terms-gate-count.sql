-- ══════════════════════════════════════════════════════════════════
--  The pre-paste count for db/175 (redesign slice 5b, the parent's terms
--  gate): how many parents the gate would close on this database. READ-ONLY.
-- ══════════════════════════════════════════════════════════════════
--
-- Run it on each database BEFORE db/175 is pasted, and again after, as the
-- owner:
--
--   psql "$DATABASE_URL" -X -f tools/terms-gate-count.sql
--
-- It writes nothing and names nobody: counts only, by school. A link counts
-- when it is a guardian's (role `guardian`, not a `self` or `enquiry` link),
-- live (verified, started, not ended, on an active assignment) and its
-- consent_state is 'pending': from the statement after the paste, that
-- parent reads nothing of that child until she agrees the terms in the app.
--   would_close       such links, by school
--   signed_in_30d     of those, whose parent has signed in within 30 days
--                     (she will meet the card soon; the rest the office chases)
--   every_child       parents all of whose live guardian links would close
--   withdrawn         live links at 'withdrawn': they stay open (Q1)
--   also_staff        parents in would_close who also hold a staff role
--                     (as staff they keep what that role reaches)
--   pupil_yes_on_unagreed  a guardian's "Allow his own sign-in" yes standing
--                     on a link that is not 'granted' (should be none)
-- The office chases from its own child_links read, which already shows each
-- link's consent_state. No report with children's names is made here.

WITH live AS (
  SELECT g.id AS link_id, g.player_id, g.consent_state, a.person_id, a.id AS assignment_id, p.school_id
    FROM assignment_subject g
    JOIN role_assignment a ON a.id = g.assignment_id AND a.role = 'guardian' AND a.active
    JOIN player p ON p.id = g.player_id
   WHERE g.relationship IS DISTINCT FROM 'self' AND g.relationship IS DISTINCT FROM 'enquiry'
     AND g.verification_state = 'verified'
     AND g.valid_from <= sa_today() AND (g.valid_until IS NULL OR g.valid_until > sa_today())
     AND (a.valid_from IS NULL OR a.valid_from <= sa_today())
     AND (a.valid_until IS NULL OR a.valid_until > sa_today())
     AND (a.expires_at IS NULL OR a.expires_at > now())
), closing AS (
  SELECT * FROM live WHERE consent_state = 'pending'
)
SELECT s.name AS school,
       (SELECT count(*) FROM closing c WHERE c.school_id = s.id) AS would_close,
       (SELECT count(*) FROM closing c JOIN app_user u ON u.id = c.person_id
         WHERE c.school_id = s.id AND u.last_seen_at > now() - interval '30 days') AS signed_in_30d,
       (SELECT count(DISTINCT c.person_id) FROM closing c
         WHERE c.school_id = s.id
           AND NOT EXISTS (SELECT 1 FROM live l WHERE l.person_id = c.person_id AND l.consent_state <> 'pending')) AS every_child,
       (SELECT count(*) FROM live l WHERE l.school_id = s.id AND l.consent_state = 'withdrawn') AS withdrawn,
       (SELECT count(DISTINCT c.person_id) FROM closing c
         WHERE c.school_id = s.id
           AND EXISTS (SELECT 1 FROM role_assignment x WHERE x.person_id = c.person_id AND x.active
                          AND x.role NOT IN ('guardian', 'player', 'selfaccess', 'enquiry', 'spectator'))) AS also_staff
  FROM school s
 WHERE EXISTS (SELECT 1 FROM live l WHERE l.school_id = s.id)
 ORDER BY would_close DESC, s.name;

-- Should be none: a guardian's yes for a pupil's own sign-in that stands on
-- a link not agreed (db/169 refuses one; this checks nothing slipped past).
SELECT count(*) AS pupil_yes_on_unagreed
  FROM pupil_signin_consent y
  JOIN assignment_subject g ON g.id = y.link_id
 WHERE y.how = 'guardian' AND y.answer = 'yes' AND g.consent_state <> 'granted';
