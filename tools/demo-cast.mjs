#!/usr/bin/env node
/**
 * The solo-test cast for the DEMO copy (docs/pilot/SOLO_TEST.md).
 *
 *   node tools/demo-cast.mjs <out.sql>
 *
 * Writes one SQL file for the scrbrd-demo SQL Editor, pasted AFTER the 330
 * invented players (demo-players-330.sql, which is kept out of this
 * repository). One paste, one transaction. It refuses to run unless the demo
 * seed's accounts and the 330 players are there, refuses to run twice, and
 * ends with a read-only summary.
 *
 * WHAT IT ADDS, at Westville (WES) and Kearsney (KEA), every address
 * @example.invalid and every name plainly invented:
 *
 *   per side (11 a school)  a coach and a team manager; WES 1XI an assistant coach
 *   per school              a principal, a director of sport, a DSO, a medical
 *                           officer, two scorers, an official, a transport
 *                           coordinator and a driver
 *   pupils                  three Westville boys from the 330 (1XI, U14A, U16B),
 *                           each linked to his own player record; the 1XI boy
 *                           holds the captaincy honour
 *   fixtures                Westville v Kearsney, every side once, 8 to 18
 *                           October 2026, two on 15 October, and one TODAY (the
 *                           day of the paste, worked out inside the SQL), with
 *                           a cast scorer appointed to today's and both of
 *                           15 October's, an umpire today, and Kearsney's XI
 *                           named for today's
 *   lift clubs              switched on for Westville, with a signed policy
 *   transport               a Westville minibus, and a trip on today's fixture
 *                           with the cast driver (the app has no screen to add
 *                           either yet, so the driver's day screen would be empty)
 *
 * NOTHING HERE IS WRITTEN AS THE TABLE OWNER. Every write runs as scrbrd_app,
 * the role the API connects as, under the identity of the person whose job it
 * is, through the same function or statement the app's own route uses — so
 * every policy, trigger and refusal the app meets is met here too:
 *
 *   platform@example.invalid  appoints each school's principal (the recovery
 *                             path: platformadmin may grant any role but the
 *                             owner's key), and grants the lift module
 *   the principal             appoints the director of sport and the DSO
 *                             (CSA p17: the chairperson appoints the DSO; the
 *                             office may not), and signs the lift policy
 *   the director of sport     appoints the medical officer, arranges the
 *                             fixtures (POST /api/fixtures' insert), appoints
 *                             the duties and awards the captaincy
 *   the school office         enrols coaches, managers, scorers, the official,
 *                             transport and pupils (enrol_person(), as
 *                             POST /api/users does) and links each duty to its
 *                             fixture-scoped authority (duty_link())
 *   KEA's 1XI coach           names Kearsney's XI for today's fixture (the
 *                             team-sheet route's own check and insert)
 *   WES's transport coordinator  adds the minibus and books today's trip
 *                             (POST /api/vehicles and /api/matches/:id/trip)
 *
 * The identity is set by app_session_begin(), the one door db/85 gives a
 * request. The SQL Editor connects as the owner, so the file grants itself
 * scrbrd_app WITH SET (as db/99 does) and drops to it for the writes.
 *
 * Kept out of CI on purpose: this is not part of the seed. The rehearsal on a
 * private database and the API proof are tools/smoke-demo-cast.mjs, run by hand.
 */
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out || out.startsWith("-")) {
  console.error("usage: node tools/demo-cast.mjs <out.sql>");
  process.exit(2);
}

// ── Who and where (the seed, and the 330 load) ──
const SCHOOLS = [
  { key: "wes", code: "WES", id: "22222222-2222-2222-2222-222222222222", office: "88888888-0000-0000-0000-00000000000d" },
  { key: "kea", code: "KEA", id: "33333333-3333-3333-3333-333333333333", office: "88888888-0000-0000-0000-0000000000ea" },
];
const PLATFORM = "88888888-0000-0000-0000-000000000014";   // platform@example.invalid, platformadmin
const GROUND = "ffffffff-0000-0000-0000-000000000002";     // Westville Main, from the seed
const SIDES = ["1XI", "2XI", "3XI", "U12A", "U13A", "U14A", "U14B", "U15A", "U15B", "U16A", "U16B"];
const MARK = "Demo cast for the solo test (docs/pilot/SOLO_TEST.md)";

const lower = (s) => s.toLowerCase();
const email = (...parts) => `${parts.map(lower).join(".")}@example.invalid`;

/**
 * The cast, in the order it is made: an appointer exists before anybody
 * they appoint. `by` names who makes the appointment: platform, principal,
 * dos (director of sport) or office.
 */
const CAST = [];
for (const s of SCHOOLS) {
  const S = s.code;
  CAST.push({ email: email("principal", s.key), name: `${S} Principal (demo)`, role: "principal", school: s, by: "platform" });
  CAST.push({ email: email("dos", s.key), name: `${S} Director of Sport (demo)`, role: "directorofsport", school: s, by: "principal" });
  CAST.push({ email: email("dso", s.key), name: `${S} Safeguarding Officer (demo)`, role: "dso", school: s, by: "principal" });
  CAST.push({ email: email("medical", s.key), name: `${S} Physio (demo)`, role: "medical", school: s, by: "dos" });
  for (const side of SIDES) {
    CAST.push({ email: email("coach", s.key, side), name: `${S} ${side} Coach (demo)`, role: "coach", school: s, team: side, by: "office" });
    CAST.push({ email: email("manager", s.key, side), name: `${S} ${side} Team Manager (demo)`, role: "teammanager", school: s, team: side, by: "office" });
  }
  if (s.key === "wes") {
    CAST.push({ email: email("assistant", s.key, "1XI"), name: `${S} 1XI Assistant Coach (demo)`, role: "assistantcoach", school: s, team: "1XI", by: "office" });
  }
  CAST.push({ email: email("scorer1", s.key), name: `${S} Scorer One (demo)`, role: "scorer", school: s, by: "office" });
  CAST.push({ email: email("scorer2", s.key), name: `${S} Scorer Two (demo)`, role: "scorer", school: s, by: "office" });
  CAST.push({ email: email("official", s.key), name: `${S} Umpire (demo)`, role: "official", school: s, by: "office" });
  CAST.push({ email: email("transport", s.key), name: `${S} Transport Coordinator (demo)`, role: "transportcoordinator", school: s, by: "office" });
  CAST.push({ email: email("driver", s.key), name: `${S} Driver (demo)`, role: "driver", school: s, by: "office" });
}

// Three Westville boys from the 330, picked by side and squad number (never by
// name: the names live only in the 330 file, outside this repository). The
// 1XI boy is the captain; the U14A boy's own parent is the one the runbook
// compares with him.
const PUPILS = [
  { side: "1XI", squad: 1, email: email("pupil", "wes", "1XI"), captain: true },
  { side: "U14A", squad: 1, email: email("pupil", "wes", "U14A"), compare: true },
  { side: "U16B", squad: 1, email: email("pupil", "wes", "U16B") },
];

/**
 * The fixtures: Westville host Kearsney at Westville Main, every side once,
 * 8–18 October 2026 (SAST, +02:00). Two on Thursday 15 October. The 1XI's
 * Saturday fixture is dropped when the paste happens ON 17 October, because
 * today's fixture is the 1XI's and a side does not play twice in a day.
 */
const FIXTURES = [
  { side: "U16A", at: "2026-10-08 14:30" },
  { side: "U14B", at: "2026-10-09 14:30" },
  { side: "2XI", at: "2026-10-10 09:30" },
  { side: "3XI", at: "2026-10-10 14:00" },
  { side: "U15A", at: "2026-10-12 14:30" },
  { side: "U13A", at: "2026-10-13 14:30" },
  { side: "U12A", at: "2026-10-14 14:30" },
  { side: "U14A", at: "2026-10-15 10:00", scorer: true },
  { side: "U16B", at: "2026-10-15 14:30", scorer: true },
  { side: "U15B", at: "2026-10-16 14:30" },
  { side: "1XI", at: "2026-10-17 10:00", notOnPasteDay: true },
];

// ── SQL helpers ──
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const by = (c) => {
  if (c.by === "platform") return q(PLATFORM) + "::uuid";
  if (c.by === "office") return q(c.school.office) + "::uuid";
  return `(ids->>${q(email(c.by, c.school.key))})::uuid`;
};
const actAs = (who) => `  PERFORM app_session_begin(${who}, 'demo-cast', NULL, NULL);`;

const enrolSql = (c, player = null) => `${actAs(by(c))}
  SELECT * INTO r FROM enrol_person(${q(c.email)}, ${c.nameSql ?? q(c.name)}, ${q(c.role)}, ${q(c.school.id)}::uuid, ${q(c.team ?? null)}, ${player ?? "NULL"}, ${q(MARK)});
  IF NOT coalesce(r.ok, false) THEN
    RAISE EXCEPTION 'Could not enrol % as %: %. Nothing was changed.', ${q(c.email)}, ${q(c.role)}, r.reason;
  END IF;
  ids := ids || jsonb_build_object(${q(c.email)}, r.user_id);`;

const WES = SCHOOLS[0], KEA = SCHOOLS[1];
const DOS_WES = `(ids->>${q(email("dos", "wes"))})::uuid`;
const PRINCIPAL_WES = `(ids->>${q(email("principal", "wes"))})::uuid`;
const SCORER1_WES = `(ids->>${q(email("scorer1", "wes"))})::uuid`;
const OFFICIAL_WES = `(ids->>${q(email("official", "wes"))})::uuid`;
const COACH_KEA_1XI = `(ids->>${q(email("coach", "kea", "1XI"))})::uuid`;
const TRANSPORT_WES = `(ids->>${q(email("transport", "wes"))})::uuid`;
const DRIVER_WES = `(ids->>${q(email("driver", "wes"))})::uuid`;

const fixtureSql = (side, startsExpr, label = side) => `${actAs(DOS_WES)}
  INSERT INTO match (school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at,
                     sport, format, overs, status, competition_id)
  VALUES (${q(WES.id)}, ${q(side)}, ${q(KEA.id)}, ${q(side)}, 'pending', ${q(GROUND)}, ${startsExpr},
          'cricket', 'T20', 20, 'scheduled', NULL)
  RETURNING id INTO m;
  IF m IS NULL THEN RAISE EXCEPTION 'The director of sport could not arrange the % fixture. Nothing was changed.', ${q(label)}; END IF;
  fx := fx || jsonb_build_object(${q(label)}, m);`;

// A duty (match_official, as the officials route inserts it, by the director
// of sport) and its fixture-scoped authority (duty_link(), by the office).
const dutySql = (matchExpr, duty, personExpr, personName) => `${actAs(DOS_WES)}
  INSERT INTO match_official (match_id, school_id, duty, person_name, person_id, official_id, panel, appointed_by, appointed_at)
  VALUES (${matchExpr}, match_school(${matchExpr}), ${q(duty)}, ${q(personName)}, ${personExpr}, NULL, NULL, app_user_id(), now())
  RETURNING id INTO d;
  IF d IS NULL THEN RAISE EXCEPTION 'Could not appoint the % duty. Nothing was changed.', ${q(duty)}; END IF;
${actAs(q(WES.office) + "::uuid")}
  SELECT * INTO l FROM duty_link(d);
  IF NOT coalesce(l.ok, false) THEN RAISE EXCEPTION 'The office could not link the % duty: %. Nothing was changed.', ${q(duty)}, l.reason; END IF;`;

const LIFT_POLICY = [
  "Westville lift club (demo). Parents may offer seats in their own cars to their own son's fixtures, and other",
  "parents may ask for a seat for theirs. A seat is confirmed only while the boy's guardian and the driver have",
  "both said yes to the lift as it now stands. Every passenger is seated and belted. Drivers hold a valid licence,",
  "insurance and a roadworthy car. Meet at the named point at the named time. Concerns go to the school's DSO.",
].join(" ");

// ── The file ──
const enrolments = CAST.map((c) => enrolSql(c)).join("\n\n");

const pupils = PUPILS.map((p) => `  -- Pupil: WES ${p.side}, squad number ${p.squad}${p.captain ? " (the captain)" : ""}${p.compare ? " (his parent is in the runbook)" : ""}.
${actAs(q(WES.office) + "::uuid")}
  SELECT pl.id, pl.full_name INTO pid, pname FROM player pl
   WHERE pl.school_id = ${q(WES.id)} AND pl.team_code = ${q(p.side)} AND pl.squad_no = ${p.squad}
     AND pl.id::text LIKE 'de300000-0000-4000-8000-%';
  IF pid IS NULL THEN RAISE EXCEPTION 'No WES ${p.side} boy with squad number ${p.squad} among the 330. Nothing was changed.'; END IF;
${enrolSql({ email: p.email, nameSql: "pname", role: "player", school: WES, team: p.side, by: "office" }, "pid")}
  pupils := pupils || jsonb_build_object(${q(p.email)}, pid);`).join("\n\n");

const dated = FIXTURES.map((f) => {
  const ins = fixtureSql(f.side, `timestamptz ${q(f.at + ":00+02")}`);
  return f.notOnPasteDay
    ? `  IF sa_today() <> date ${q(f.at.slice(0, 10))} THEN\n${ins.replace(/^/gm, "  ")}\n  END IF;`
    : ins;
}).join("\n\n");

const scorerDuties = FIXTURES.filter((f) => f.scorer).map((f) =>
  dutySql(`(fx->>${q(f.side)})::uuid`, "scorer", SCORER1_WES, "WES Scorer One (demo)")).join("\n\n");

const sql = `-- SCRBRD demo copy · the solo-test cast (docs/pilot/SOLO_TEST.md).
-- Generated by tools/demo-cast.mjs. FOR THE scrbrd-demo PROJECT ONLY.
-- Paste AFTER demo-players-330.sql. Every address is @example.invalid and every name is invented.
-- One transaction. Refuses to run outside the demo, without the 330 players, or twice.
-- Every write runs as scrbrd_app under the person whose job it is, through the app's own path.
BEGIN;

DO $demo_only$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'scorer@example.invalid')
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE id = ${q(WES.office)} AND email = 'registrar.wes@example.invalid' AND active)
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE id = ${q(PLATFORM)} AND email = 'platform@example.invalid' AND active) THEN
    RAISE EXCEPTION 'This is not the demo database (the seeded demo accounts are missing). Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM player WHERE id::text LIKE 'de300000-0000-4000-8000-%') <> 330
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE id = ${q(KEA.office)} AND email = 'office.kea@example.invalid' AND active) THEN
    RAISE EXCEPTION 'The 330 demo players are not loaded here. Paste demo-players-330.sql first. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM app_user WHERE email = ${q(email("coach", "wes", "1XI"))}) THEN
    RAISE EXCEPTION 'The demo cast is already loaded here. Nothing was changed.';
  END IF;
END $demo_only$;

-- The SQL Editor connects as the table owner, which row-level security does
-- not apply to. The writes below drop to scrbrd_app, the API's own role, so
-- they meet every policy the app meets. Postgres 16 needs the SET option to
-- do that (db/99 grants it the same way).
DO $grant$
BEGIN
  EXECUTE format('GRANT scrbrd_app TO %I WITH SET TRUE', current_user);
EXCEPTION
  WHEN duplicate_object OR invalid_grant_operation THEN NULL;
  WHEN syntax_error THEN EXECUTE format('GRANT scrbrd_app TO %I', current_user);  -- before Postgres 16
END $grant$;

SET LOCAL ROLE scrbrd_app;

DO $cast$
DECLARE
  ids    jsonb := '{}';   -- email -> app_user id, as each is made
  pupils jsonb := '{}';   -- pupil email -> player id
  fx     jsonb := '{}';   -- side -> fixture id
  r      record;          -- enrol_person()'s answer
  l      record;          -- duty_link()'s answer
  pid    uuid;
  pname  text;
  m      uuid;
  d      uuid;
  h      uuid;
  today  uuid;
  season uuid;
  v      uuid;
  n      integer;
BEGIN
  -- ── 1 · The cast: principals first, then those they appoint ──
${enrolments}

  -- ── 2 · Three Westville pupils, each linked to his own record ──
${pupils}

  -- ── 3 · The captaincy (SCRBRD-138), awarded as POST /api/honours does ──
${actAs(DOS_WES)}
  season := season_named(to_char(sa_today(), 'YYYY'), 'school');
  IF season IS NULL THEN RAISE EXCEPTION 'No school season for this year. Nothing was changed.'; END IF;
  INSERT INTO honour (player_id, kind, name, season_id, citation, awarded_on, is_public)
  VALUES ((pupils->>${q(PUPILS[0].email)})::uuid, 'captain', NULL, season, 'Captain of the 1st XI (demo).', sa_today(), false)
  RETURNING id INTO h;
  IF h IS NULL THEN RAISE EXCEPTION 'The director of sport could not award the captaincy. Nothing was changed.'; END IF;

  -- ── 4 · The fixtures, as POST /api/fixtures inserts them ──
${dated}

  -- TODAY's: the 1XI, at 14:30 SA time, or later if the paste is later in the
  -- day (an hour or so ahead), and never past 23:30 of the same day.
${fixtureSql("1XI", `least(
            greatest((sa_today() + time '14:30') AT TIME ZONE 'Africa/Johannesburg',
                     date_bin('30 minutes', now() + interval '90 minutes', timestamptz '2000-01-01 00:00+00')),
            (sa_today() + time '23:30') AT TIME ZONE 'Africa/Johannesburg')`, "1XI today")}
  today := m;

  -- ── 5 · Duties: a cast scorer on today's and both of 15 October's, an umpire today ──
${dutySql("today", "scorer", SCORER1_WES, "WES Scorer One (demo)")}

${scorerDuties}

${dutySql("today", "umpire", OFFICIAL_WES, "WES Umpire (demo)")}

  -- ── 6 · Kearsney's XI for today, named by their 1XI coach (the team-sheet route) ──
${actAs(COACH_KEA_1XI)}
  SELECT count(*) INTO n
    FROM match mt JOIN player pl ON pl.school_id = mt.away_school_id AND pl.team_code = mt.away_team_code
   WHERE mt.id = today AND pl.squad_no BETWEEN 1 AND 11
     AND app_can('team.select', mt.away_school_id, mt.away_team_code, pl.id, mt.id);
  IF n <> 11 THEN RAISE EXCEPTION 'Kearsney''s 1XI coach may not name his XI (% of 11). Nothing was changed.', n; END IF;
  INSERT INTO match_squad (match_id, player_id, side, batting_no, twelfth, withdrawn, selected_by, selected_at)
  SELECT today, pl.id, 'away', pl.squad_no, false, false, app_user_id(), now()
    FROM player pl
   WHERE pl.school_id = ${q(KEA.id)} AND pl.team_code = '1XI' AND pl.squad_no BETWEEN 1 AND 11;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 11 THEN RAISE EXCEPTION 'Kearsney''s XI came to % boys, not 11. Nothing was changed.', n; END IF;

  -- ── 7 · Lift clubs at Westville: the platform grants the module, the principal signs the policy ──
${actAs(q(PLATFORM) + "::uuid")}
  INSERT INTO feature_grant (key, school_id, granted, note, changed_by, changed_at)
  VALUES ('lift_club', ${q(WES.id)}, true, ${q(MARK)}, app_user_id(), now())
  ON CONFLICT (key, school_id) DO UPDATE
    SET granted = excluded.granted, note = excluded.note, changed_by = excluded.changed_by, changed_at = now();
${actAs(PRINCIPAL_WES)}
  SELECT * INTO l FROM lift_policy_sign(${q(WES.id)}, ${q(LIFT_POLICY)}, false, true, 'The pavilion car park');
  IF NOT coalesce(l.ok, false) THEN RAISE EXCEPTION 'The principal could not sign the lift policy: %. Nothing was changed.', l.reason; END IF;

  -- ── 8 · A minibus and today's trip, so the driver's day screen has one ──
  -- The app has no screen for these yet: POST /api/vehicles and
  -- POST /api/matches/:id/trip, by the transport coordinator, as the routes insert them.
${actAs(TRANSPORT_WES)}
  INSERT INTO vehicle (school_id, registration, description, kind, capacity, condition, next_service_on, active, notes,
                       insurance_expires_on, roadworthy_expires_on)
  VALUES (${q(WES.id)}, 'WES DEMO 1', 'Demo minibus, 22 seats', 'minibus', 22, 'good', NULL, true, ${q(MARK)},
          date '2027-03-31', date '2027-01-31')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The transport coordinator could not add the minibus. Nothing was changed.'; END IF;
  INSERT INTO trip (match_id, school_id, vehicle_id, driver_id, depart_at, return_at, pickup, seats_taken, notes, arranged_by, arranged_at)
  SELECT today, match_school(today), v, ${DRIVER_WES}, mt.starts_at - interval '60 minutes', mt.starts_at + interval '4 hours',
         'The junior school gate', 15, ${q(MARK)}, app_user_id(), now()
    FROM match mt WHERE mt.id = today
  RETURNING id INTO d;
  IF d IS NULL THEN RAISE EXCEPTION 'The transport coordinator could not book today''s trip. Nothing was changed.'; END IF;

  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.device_id', '', true);
END $cast$;

RESET ROLE;

-- ── The check, as the owner: everything above is there, or nothing is ──
DO $check$
DECLARE a int; f int; f15 int; ft int; du int; sq int; cap int; pu int; tr int;
BEGIN
  SELECT count(*) INTO a FROM app_user u
    JOIN role_assignment ra ON ra.person_id = u.id AND ra.active AND ra.fixture_id IS NULL
   WHERE u.email IN (${CAST.map((c) => q(c.email)).join(", ")});
  SELECT count(*) INTO pu FROM app_user u
   WHERE u.email IN (${PUPILS.map((p) => q(p.email)).join(", ")}) AND u.player_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM role_assignment ra JOIN assignment_subject s ON s.assignment_id = ra.id
                  WHERE ra.person_id = u.id AND ra.role = 'selfaccess' AND s.player_id = u.player_id
                    AND s.relationship = 'self' AND s.verification_state = 'verified');
  SELECT count(*), count(*) FILTER (WHERE (starts_at AT TIME ZONE 'Africa/Johannesburg')::date = date '2026-10-15'),
         count(*) FILTER (WHERE (starts_at AT TIME ZONE 'Africa/Johannesburg')::date = sa_today())
    INTO f, f15, ft
    FROM match WHERE school_id = ${q(WES.id)} AND away_school_id = ${q(KEA.id)};
  SELECT count(*) INTO du FROM match_official mo JOIN match mt ON mt.id = mo.match_id
   WHERE mt.away_school_id = ${q(KEA.id)} AND mo.assignment_id IS NOT NULL AND NOT mo.withdrawn;
  SELECT count(*) INTO sq FROM match_squad ms JOIN match mt ON mt.id = ms.match_id
   WHERE mt.away_school_id = ${q(KEA.id)} AND ms.side = 'away' AND NOT ms.withdrawn;
  SELECT count(*) INTO cap FROM honour WHERE kind = 'captain' AND withdrawn_at IS NULL
     AND player_id IN (SELECT player_id FROM app_user WHERE email = ${q(PUPILS[0].email)});
  SELECT count(*) INTO tr FROM trip t JOIN match mt ON mt.id = t.match_id
   WHERE mt.away_school_id = ${q(KEA.id)} AND t.driver_id = (SELECT id FROM app_user WHERE email = ${q(email("driver", "wes"))});
  IF a <> ${CAST.length} OR pu <> ${PUPILS.length} OR f < ${FIXTURES.length} OR f15 < 2 OR ft < 1 OR du <> 4 OR sq <> 11
     OR cap <> 1 OR tr <> 1 THEN
    RAISE EXCEPTION 'The cast is incomplete (% of ${CAST.length} staff, % of ${PUPILS.length} pupils, % fixtures, % on 15 Oct, % today, % of 4 duties, % of 11 named, % captain, % of 1 trip). Rolled back.',
      a, pu, f, f15, ft, du, sq, cap, tr;
  END IF;
END $check$;
COMMIT;

-- ── Read-only summary ──
-- 1. The cast, by school and role. Sign in with the email, the code left blank.
SELECT s.code AS school, ra.role, coalesce(ra.team_code, '') AS side, u.email, u.name
  FROM app_user u
  JOIN role_assignment ra ON ra.person_id = u.id AND ra.active AND ra.fixture_id IS NULL AND ra.role <> 'selfaccess'
  JOIN school s ON s.id = ra.school_id
 WHERE u.email IN (${[...CAST.map((c) => c.email), ...PUPILS.map((p) => p.email)].map(q).join(", ")})
 ORDER BY s.code, ra.role, ra.team_code NULLS FIRST, u.email;

-- 2. The pupils, the captain, and each boy's own parent (sign in as either).
SELECT u.email AS pupil, p.team_code AS side, p.squad_no,
       CASE WHEN EXISTS (SELECT 1 FROM honour h WHERE h.player_id = p.id AND h.kind = 'captain' AND h.withdrawn_at IS NULL)
            THEN 'captain' ELSE '' END AS honour,
       (SELECT string_agg(g.email, ', ') FROM assignment_subject sj
          JOIN role_assignment ga ON ga.id = sj.assignment_id AND ga.role = 'guardian' AND ga.active
          JOIN app_user g ON g.id = ga.person_id
         WHERE sj.player_id = p.id) AS parent
  FROM app_user u JOIN player p ON p.id = u.player_id
 WHERE u.email IN (${PUPILS.map((p) => q(p.email)).join(", ")})
 ORDER BY p.team_code;

-- 3. The fixtures, SA time, with the scorer and umpire appointed.
SELECT to_char(m.starts_at AT TIME ZONE 'Africa/Johannesburg', 'Dy DD Mon HH24:MI') AS starts_sast,
       CASE WHEN (m.starts_at AT TIME ZONE 'Africa/Johannesburg')::date = sa_today() THEN 'TODAY' ELSE '' END AS today,
       'WES ' || m.team_code || ' v KEA ' || m.away_team_code AS fixture, g.name AS ground,
       (SELECT string_agg(mo.duty || ': ' || u.email, ', ' ORDER BY mo.duty) FROM match_official mo
          JOIN app_user u ON u.id = mo.person_id WHERE mo.match_id = m.id AND NOT mo.withdrawn) AS duties,
       (SELECT count(*) FROM match_squad ms WHERE ms.match_id = m.id AND NOT ms.withdrawn) AS named,
       (SELECT string_agg(v.registration || ', driver ' || u.email, '; ') FROM trip t
          JOIN vehicle v ON v.id = t.vehicle_id JOIN app_user u ON u.id = t.driver_id WHERE t.match_id = m.id) AS trip
  FROM match m LEFT JOIN ground g ON g.id = m.ground_id
 WHERE m.school_id = ${q(WES.id)} AND m.away_school_id = ${q(KEA.id)}
 ORDER BY m.starts_at;
`;

writeFileSync(out, sql);
console.log(`${out}: ${Buffer.byteLength(sql)} bytes, ${CAST.length} staff, ${PUPILS.length} pupils, ${FIXTURES.length + 1} fixtures`);
