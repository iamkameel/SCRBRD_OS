-- ══════════════════════════════════════════════════════════════════
--  The pre-paste count for db/169 (SCRBRD-140 Migration B): how many live
--  accounts the gate would close on this database. READ-ONLY.
-- ══════════════════════════════════════════════════════════════════
--
-- Run it on each database BEFORE db/169 is pasted, as the owner:
--
--   psql "$DATABASE_URL" -X -f tools/pupil-signin-count.sql
--
-- It writes nothing and needs nothing from db/169: it works out, from what
-- is on record now, what db/169's gate (pupil_signin_open()) would answer
-- for every active account the moment the paste commits — after db/169 §6
-- has carried every live, verified own link stamped "granted" over as the
-- office's yes. The number on the first line is the one for Kameel's paste
-- card; the design expects none.
--
-- An account is a pupil's when it has a roster link (app_user.player_id), a
-- self link on one of its live assignments, or a live player or selfaccess
-- assignment. It would close when:
--   no_date_of_birth a boy it answers as has no date of birth on the roster
--   no_consent       a boy it answers as is under 18 and has no live,
--                    verified own link stamped "granted" to carry over
--   left_school      the stamp is there, but he has left his school since it
--                    was given, or is away from it today: the school's yes
--                    lapses (Kameel, 20 Nov, C)
--   no_boy_named     it holds a pupil's role and names no boy (no roster
--                    link, no self link): closed by db/169 (Kameel, 20 Nov,
--                    A), and no family's yes can open it until the office
--                    links it to his roster row
-- An eighteen-year-old by the roster is never closed. The last column says
-- whether the account also holds a role that is not a pupil's (a staff
-- role): those accounts would lose that role's reach too, and Kameel should
-- see each one by name before the paste (the second query lists them).

WITH acct AS (
  SELECT u.id, u.name, u.email
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
), judged AS (
  SELECT b.account, b.player,
         p.born IS NOT NULL AND (p.born + interval '18 years')::date <= (now() AT TIME ZONE 'Africa/Johannesburg')::date AS adult,
         p.born IS NULL AS no_born,
         EXISTS (SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
                  WHERE g.player_id = b.player AND g.relationship = 'self'
                    AND g.verification_state = 'verified' AND g.consent_state = 'granted' AND a.active
                    AND (g.valid_until IS NULL OR g.valid_until > (now() AT TIME ZONE 'Africa/Johannesburg')::date)) AS carried,
         -- db/169's pupil_signin_stayed(), asked of the stamp's day.
         EXISTS (SELECT 1 FROM team_membership m
                  WHERE m.player_id = b.player AND m.school_id = p.school_id
                    AND m.left_on IS NOT NULL AND m.left_on <= (now() AT TIME ZONE 'Africa/Johannesburg')::date
                    AND NOT EXISTS (SELECT 1 FROM team_membership o
                                     WHERE o.player_id = m.player_id AND o.school_id = m.school_id AND o.id <> m.id
                                       AND o.joined_on <= m.left_on AND (o.left_on IS NULL OR o.left_on > m.left_on))
                    AND (m.left_on >= (SELECT min((coalesce(g.consent_at, g.verified_at, g.created_at) AT TIME ZONE 'Africa/Johannesburg')::date)
                                         FROM assignment_subject g WHERE g.player_id = b.player AND g.relationship = 'self'
                                          AND g.verification_state = 'verified' AND g.consent_state = 'granted')
                         OR NOT EXISTS (SELECT 1 FROM team_membership o
                                         WHERE o.player_id = m.player_id AND o.school_id = m.school_id
                                           AND o.joined_on <= (now() AT TIME ZONE 'Africa/Johannesburg')::date
                                           AND (o.left_on IS NULL OR o.left_on > (now() AT TIME ZONE 'Africa/Johannesburg')::date)))) AS left_school
    FROM boys b LEFT JOIN player p ON p.id = b.player
), verdict AS (
  SELECT x.id, x.name, x.email,
         NOT EXISTS (SELECT 1 FROM boys b WHERE b.account = x.id) AS no_boy_named,
         EXISTS (SELECT 1 FROM judged j WHERE j.account = x.id AND j.no_born) AS no_date_of_birth,
         EXISTS (SELECT 1 FROM judged j WHERE j.account = x.id AND NOT j.no_born AND NOT j.adult AND NOT j.carried) AS no_consent,
         EXISTS (SELECT 1 FROM judged j WHERE j.account = x.id AND NOT j.no_born AND NOT j.adult AND j.carried AND j.left_school) AS left_school,
         EXISTS (SELECT 1 FROM role_assignment a WHERE a.person_id = x.id AND a.active
                    AND a.role NOT IN ('player', 'selfaccess')) AS also_holds_another_role
    FROM acct x
)
SELECT count(*) FILTER (WHERE no_boy_named OR no_date_of_birth OR no_consent OR left_school) AS would_close,
       count(*)                                                                AS pupil_accounts,
       count(*) FILTER (WHERE no_date_of_birth)                                AS no_date_of_birth,
       count(*) FILTER (WHERE no_consent)                                      AS no_consent,
       count(*) FILTER (WHERE left_school)                                     AS left_school,
       count(*) FILTER (WHERE (no_boy_named OR no_date_of_birth OR no_consent OR left_school)
                          AND also_holds_another_role)                         AS also_holds_another_role,
       count(*) FILTER (WHERE no_boy_named)                                    AS no_boy_named
  FROM verdict;

-- Each account that would close and also holds a role that is not a
-- pupil's, by id and role only (no child's name, no address), for Kameel.
WITH acct AS (
  SELECT u.id FROM app_user u
   WHERE u.active
     AND (u.player_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM role_assignment a WHERE a.person_id = u.id AND a.active
                        AND (a.role IN ('player', 'selfaccess')
                             OR EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id AND g.relationship = 'self'))))
), boys AS (
  SELECT x.id AS account, u.player_id AS player FROM acct x JOIN app_user u ON u.id = x.id WHERE u.player_id IS NOT NULL
  UNION
  SELECT x.id, g.player_id FROM acct x JOIN role_assignment a ON a.person_id = x.id AND a.active
    JOIN assignment_subject g ON g.assignment_id = a.id AND g.relationship = 'self'
)
SELECT x.id AS account,
       (SELECT string_agg(DISTINCT a.role, ', ') FROM role_assignment a
         WHERE a.person_id = x.id AND a.active AND a.role NOT IN ('player', 'selfaccess')) AS other_roles
  FROM acct x
 WHERE EXISTS (SELECT 1 FROM role_assignment a WHERE a.person_id = x.id AND a.active AND a.role NOT IN ('player', 'selfaccess'))
   AND (NOT EXISTS (SELECT 1 FROM boys b WHERE b.account = x.id)
        OR EXISTS (SELECT 1 FROM boys b JOIN player p ON p.id = b.player
                    WHERE b.account = x.id
                      AND (p.born IS NULL
                           OR ((p.born + interval '18 years')::date > (now() AT TIME ZONE 'Africa/Johannesburg')::date
                               AND NOT EXISTS (SELECT 1 FROM assignment_subject g JOIN role_assignment a ON a.id = g.assignment_id
                                                WHERE g.player_id = b.player AND g.relationship = 'self'
                                                  AND g.verification_state = 'verified' AND g.consent_state = 'granted' AND a.active
                                                  AND (g.valid_until IS NULL OR g.valid_until > (now() AT TIME ZONE 'Africa/Johannesburg')::date))))))
 ORDER BY 1;

-- After the paste the same number is db/169's own answer, for a check:
--   SELECT count(*) FROM app_user u WHERE u.active AND NOT pupil_signin_open(u.id);
