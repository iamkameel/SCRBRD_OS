-- ══════════════════════════════════════════════════════════════════
--  The pre-paste count for db/169 (SCRBRD-140 Migration B): how many live
--  accounts the gate would close on this database. READ-ONLY.
-- ══════════════════════════════════════════════════════════════════
--
-- Run it on each database BEFORE db/169 is pasted, as the owner:
--
--   psql "$DATABASE_URL" -X -f tools/pupil-signin-count.sql
--
-- It writes nothing to the database (one temporary table, this session's
-- own, dropped at the end) and needs nothing from db/169: it works out,
-- from what is on record now, what db/169's gate (pupil_signin_open())
-- would answer for every active account the moment the paste commits —
-- after db/169 §6 has carried every live, verified own link stamped
-- "granted" over as the school's yes. The number on the first line is the
-- one for Kameel's paste card. Read every column, not only the first.
--
-- An account is a pupil's when it has a roster link (app_user.player_id), a
-- self link on one of its live assignments, or a live player or selfaccess
-- assignment. It would close when:
--   no_date_of_birth a boy it answers as has no date of birth on the roster
--   no_consent       a boy it answers as is under 18 and has no live,
--                    verified own link stamped "granted" to carry over
--   left_school      the stamp is there, but the school that stamped it no
--                    longer holds him: he is on another school's roster now
--                    (a transfer), he left that school since the stamp, or
--                    is away from it today: the school's yes lapses (Kameel,
--                    20 Nov, C; db/169's pupil_signin_stayed())
--   no_boy_named     it holds a live pupil's role and names no boy (no
--                    roster link, no self link): closed by db/169 (Kameel,
--                    20 Nov, A), and no family's yes can open it until the
--                    office links it to his roster row
-- An eighteen-year-old by the roster is never closed. also_holds_another_role
-- counts the closing accounts that also hold a role that is not a pupil's (a
-- staff role): those would lose that role's reach too.
--
-- Three results: the counts; every no_boy_named account, by id (A: "see
-- each account before choosing"); and every closing account that holds a
-- staff role, by id, with its roles and why it closes. Ids and roles only:
-- no child's name, no address.

CREATE TEMP TABLE _pupil_signin_count AS
WITH today AS (SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date AS d),
acct AS (
  SELECT u.id
    FROM app_user u
   WHERE u.active
     AND (u.player_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM role_assignment a
                      WHERE a.person_id = u.id AND a.active
                        AND (a.role IN ('player', 'selfaccess')
                             OR EXISTS (SELECT 1 FROM assignment_subject g
                                         WHERE g.assignment_id = a.id AND g.relationship = 'self'))))
), boys AS (
  SELECT x.id AS account, u.player_id AS player FROM acct x JOIN app_user u ON u.id = x.id WHERE u.player_id IS NOT NULL
  UNION
  SELECT x.id, g.player_id FROM acct x
    JOIN role_assignment a ON a.person_id = x.id AND a.active
    JOIN assignment_subject g ON g.assignment_id = a.id AND g.relationship = 'self'
), stamp AS (
  -- The stamp the carry-over takes for each boy (§6's own choice): its
  -- day, and the school that stamped it (his own record's assignment's).
  SELECT DISTINCT ON (g.player_id) g.player_id AS player,
         ((coalesce(g.consent_at, g.verified_at, g.created_at)) AT TIME ZONE 'Africa/Johannesburg')::date AS on_day,
         coalesce(a.school_id, p.school_id) AS school
    FROM assignment_subject g
    JOIN role_assignment a ON a.id = g.assignment_id
    JOIN player p ON p.id = g.player_id, today
   WHERE g.relationship = 'self' AND g.verification_state = 'verified' AND g.consent_state = 'granted'
     AND a.active AND (g.valid_until IS NULL OR g.valid_until > today.d)
   ORDER BY g.player_id, g.consent_at NULLS LAST, g.id
), judged AS (
  SELECT b.account, b.player,
         p.born IS NOT NULL AND (p.born + interval '18 years')::date <= today.d AS adult,
         p.born IS NULL AS no_born,
         st.player IS NOT NULL AS carried,
         st.player IS NOT NULL AND (
           p.school_id IS DISTINCT FROM st.school
           OR EXISTS (SELECT 1 FROM team_membership m
                       WHERE m.player_id = b.player AND m.school_id = st.school
                         AND m.left_on IS NOT NULL AND m.left_on <= today.d AND m.left_on >= st.on_day
                         AND NOT EXISTS (SELECT 1 FROM team_membership o
                                          WHERE o.player_id = m.player_id AND o.school_id = m.school_id AND o.id <> m.id
                                            AND o.joined_on <= m.left_on AND (o.left_on IS NULL OR o.left_on > m.left_on)))
           OR (EXISTS (SELECT 1 FROM team_membership m WHERE m.player_id = b.player AND m.school_id = st.school)
               AND NOT EXISTS (SELECT 1 FROM team_membership o
                                WHERE o.player_id = b.player AND o.school_id = st.school
                                  AND o.joined_on <= today.d AND (o.left_on IS NULL OR o.left_on > today.d)))) AS left_school
    FROM boys b LEFT JOIN player p ON p.id = b.player LEFT JOIN stamp st ON st.player = b.player, today
)
SELECT x.id,
       NOT EXISTS (SELECT 1 FROM boys b WHERE b.account = x.id)
         AND EXISTS (SELECT 1 FROM role_assignment a, today
                      WHERE a.person_id = x.id AND a.active AND a.role IN ('player', 'selfaccess')
                        AND (a.valid_until IS NULL OR a.valid_until > today.d)) AS no_boy_named,
       EXISTS (SELECT 1 FROM judged j WHERE j.account = x.id AND j.no_born) AS no_date_of_birth,
       EXISTS (SELECT 1 FROM judged j WHERE j.account = x.id AND NOT j.no_born AND NOT j.adult AND NOT j.carried) AS no_consent,
       EXISTS (SELECT 1 FROM judged j WHERE j.account = x.id AND NOT j.no_born AND NOT j.adult AND j.carried AND j.left_school) AS left_school,
       (SELECT string_agg(DISTINCT a.role, ', ' ORDER BY a.role) FROM role_assignment a
         WHERE a.person_id = x.id AND a.active AND a.role NOT IN ('player', 'selfaccess')) AS other_roles
  FROM acct x;

SELECT count(*) FILTER (WHERE no_boy_named OR no_date_of_birth OR no_consent OR left_school) AS would_close,
       count(*)                                                                AS pupil_accounts,
       count(*) FILTER (WHERE no_date_of_birth)                                AS no_date_of_birth,
       count(*) FILTER (WHERE no_consent)                                      AS no_consent,
       count(*) FILTER (WHERE left_school)                                     AS left_school,
       count(*) FILTER (WHERE (no_boy_named OR no_date_of_birth OR no_consent OR left_school)
                          AND other_roles IS NOT NULL)                         AS also_holds_another_role,
       count(*) FILTER (WHERE no_boy_named)                                    AS no_boy_named
  FROM _pupil_signin_count;

-- Every account holding a pupil's role that names no boy (A), by id.
SELECT id AS no_boy_named_account, other_roles
  FROM _pupil_signin_count WHERE no_boy_named ORDER BY id;

-- Every closing account that also holds a staff role, by id, and why.
SELECT id AS account, other_roles,
       concat_ws(', ', CASE WHEN no_boy_named THEN 'no_boy_named' END, CASE WHEN no_date_of_birth THEN 'no_date_of_birth' END,
                       CASE WHEN no_consent THEN 'no_consent' END, CASE WHEN left_school THEN 'left_school' END) AS closes_for
  FROM _pupil_signin_count
 WHERE other_roles IS NOT NULL AND (no_boy_named OR no_date_of_birth OR no_consent OR left_school)
 ORDER BY id;

DROP TABLE _pupil_signin_count;

-- After the paste the same number is db/169's own answer, for a check:
--   SELECT count(*) FROM app_user u WHERE u.active AND NOT pupil_signin_open(u.id);
