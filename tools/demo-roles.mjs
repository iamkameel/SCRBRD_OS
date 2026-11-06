#!/usr/bin/env node
/**
 * Every role's own home, filled for the DEMO copy (scrbrd-demo), for Kameel's
 * walk-through of 7 November 2026.
 *
 *   node tools/demo-roles.mjs <out.sql>
 *
 * Writes one SQL file for the scrbrd-demo SQL Editor, pasted AFTER the demo
 * cast (tools/demo-cast.mjs) and after the season builder's file
 * (claude/wip-demo-season). One paste, one transaction. It refuses to run
 * outside the demo, without the cast, or twice (a marker on the clearances it
 * records), and ends with a read-only summary.
 *
 * EVERY PERSON IS INVENTED. Every account is @example.invalid; every adult
 * named here (emergency contacts) is a first name and "(demo)"; every phone
 * number is +27 00 000 …, which no South African number is. It names no boy:
 * boys are picked by id, and the names are the demo's own invented ones.
 *
 * It touches no fixture and no ball. Where a write rides on a fixture
 * (availability answers), it answers only for fixtures already there, in the
 * next ten days, that nobody has answered for yet.
 *
 * WHAT IT FILLS, by role, at Westville (WES), Kearsney (KEA) and, for the
 * seed's Hilton accounts (the bursar), Hilton (HIL):
 *
 *   office (registrar.wes, office.kea)  every clearance each school-level
 *       appointee's role requires (clearance_requirement), all current, but
 *       WES U13A coach's safeguarding awareness runs out in nine days, and
 *       KEA U12A coach's first aid is not recorded (the register's
 *       warning and its gap); the director records the office's own; a
 *       guardian link waiting to be verified
 *   parents        emergency contacts for the three pupils and four more boys;
 *                  a pending request to score (parent.020); a lift driver's
 *                  declaration (parent.002); health-monitoring consent for three
 *                  1XI seamers; availability for the coming fixtures
 *   medical        four injuries, three at WES, one at KEA, with return-to-play
 *                  reviews (rehab; cleared)
 *   platform       the workload module and KEA's lift module, granted
 *   coaches        two past and four coming sessions for WES 1XI, U14A, U16B and
 *                  KEA 1XI, one coming session for every other side, the
 *                  register for the past ones, a plan of drills, two school
 *                  drills, skills assessments and development notes, and the
 *                  1XI seamers' nets loads (the consented three)
 *   dso            a concern raised by the WES U14A coach, assigned to and
 *                  noted by the WES DSO (bland, invented)
 *   league         KEA 1XI invited and accepted into Division 1; the league's
 *                  table conditions (points, order), entered as a draft
 *   principals     a sponsor pair at WES with an exclusivity waiver; KEA's
 *                  lift policy signed
 *   bursar         two Hilton sponsors with placements
 *   transport      a second WES vehicle and a KEA minibus
 *   director       three school news posts (two WES, one KEA)
 *
 * NOT FILLED, and why: a wellness check-in (no table or read exists for one);
 * the spectator and the scout (nothing for them to follow or set up: the
 * scout's candidates need a consent the families give, and his school is
 * Hilton's); the guardian terms (every WES and KEA link already holds
 * popia-2026-01, granted 7 Oct; leaving some unagreed would mean withdrawing
 * consent, which is not done here); anything on a fixture (the season builder's).
 *
 * NOTHING HERE IS WRITTEN AS THE TABLE OWNER. As tools/demo-cast.mjs: every
 * write runs as scrbrd_app, under the person whose job it is, set by
 * app_session_begin(), through the statement or function the app's own route
 * runs. The owner only reads: the guard, the ids by email (the demo's cast ids
 * are not this repository's), and the check at the end.
 *
 * Proof: tools/smoke-demo-roles.mjs, run by hand on a local replica.
 */
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out || out.startsWith("-")) {
  console.error("usage: node tools/demo-roles.mjs <out.sql>");
  process.exit(2);
}

const WES = "22222222-2222-2222-2222-222222222222";
const KEA = "33333333-3333-3333-3333-333333333333";
const HIL = "11111111-1111-1111-1111-111111111111";
const COMPETITION = "99999999-0000-0000-0000-000000000001";   // KZN Schools T20 League, the seed's
const DIVISION_1 = "d1710000-0000-0000-0000-000000000001";
const MARK = "Recorded for the demo (demo-roles)";
const SIDES = ["1XI", "2XI", "3XI", "U16A", "U16B", "U15A", "U15B", "U14A", "U14B", "U13A", "U12A"];
/** The first boy of each side: the demo's ids run 001–165 at WES, 166–330 at KEA, 15 a side, in this order. */
const FIRST = { "1XI": 1, "2XI": 16, "3XI": 31, U16A: 46, U16B: 61, U15A: 76, U15B: 91, U14A: 106, U14B: 121, U13A: 136, U12A: 151 };
const boyN = (school, side, squad) => FIRST[side] + squad - 1 + (school === "KEA" ? 165 : 0);
const pid = (n) => `de300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const parentOf = (n) => `parent.${String(n).padStart(3, "0")}@example.invalid`;

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const P = (n) => `${q(pid(n))}::uuid`;
const U = (email) => `(ids->>${q(email.includes("@") ? email : `${email}@example.invalid`)})::uuid`;
const actAs = (who) => `  PERFORM app_session_begin(${who}, 'demo-roles', NULL, NULL);`;
const as = (email) => actAs(U(email));
/** A door that answers (ok, reason): stop the whole paste if it refuses. */
const must = (what) => `  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION '${what.replace(/'/g, "''")}: %. Nothing was changed.', r.reason; END IF;`;
const day = (n) => (n === 0 ? "sa_today()" : `(sa_today() + ${n})`);
const at = (n, hhmm) => `((sa_today() + ${n}) + time '${hhmm}') AT TIME ZONE 'Africa/Johannesburg'`;

// ── 1 · Clearances, by the office ──
// The office records everybody's but its own; the director of sport records the office's.
const clearances = [WES, KEA].flatMap((school) => {
  const office = school === WES ? "registrar.wes" : "office.kea";
  const dos = school === WES ? "dos.wes" : "dos.kea";
  return [[office, `<> ${q(`${office}@example.invalid`)}`], [dos, `= ${q(`${office}@example.invalid`)}`]];
}).map(([who, filter], i) => {
  const school = i < 2 ? WES : KEA;
  return `${as(who)}
  FOR c IN SELECT * FROM jsonb_to_recordset(current_setting('demo_roles.clear')::jsonb)
                    AS x(person uuid, school uuid, role text, email text, k int)
            WHERE x.school = ${q(school)}::uuid AND x.email ${filter} LOOP
    FOR kind IN SELECT cr.kind FROM clearance_requirement cr WHERE cr.role = c.role ORDER BY cr.kind LOOP
      CONTINUE WHEN c.email = 'coach.kea.u12a@example.invalid' AND kind = 'first_aid';
      IF c.email = 'coach.wes.u13a@example.invalid' AND kind = 'safeguarding_awareness' THEN
        iss := sa_today() - 357; exp := sa_today() + 9;
      ELSE
        iss := sa_today() - (20 + (c.k * 7 + length(kind)) % 150);
        exp := iss + CASE WHEN kind IN ('police_clearance', 'child_protection', 'sexual_offences_register') THEN 730
                          WHEN kind = 'driving_permit' THEN 1460 ELSE 365 END;
      END IF;
      INSERT INTO adult_clearance (person_id, school_id, kind, reference, issued_on, expires_on, note)
      VALUES (c.person, c.school, kind,
              CASE WHEN kind IN ('police_clearance', 'driving_permit') THEN 'DEMO-' || upper(left(kind, 3)) || '-' || lpad(c.k::text, 4, '0') END,
              iss, exp, ${q(MARK)})
      RETURNING id INTO v;
      IF v IS NULL THEN RAISE EXCEPTION 'The office could not record % for %. Nothing was changed.', kind, c.email; END IF;
      n := n + 1;
    END LOOP;
  END LOOP;`;
}).join("\n\n");

// ── 2 · Emergency contacts, each by the boy's own parent (POST /api/players/:id/emergency-contacts) ──
const CONTACT_NAMES = ["Thandi", "Pieter", "Nomvula", "Grant", "Ayesha", "Johan", "Lindiwe", "Craig", "Fatima", "Sibusiso", "Megan", "Ravi", "Zanele", "Andre"];
const CONTACT_BOYS = [1, 61, 106, 2, 3, 107, 108];
let contactNo = 0;
const contacts = CONTACT_BOYS.map((n) => {
  const rows = [
    { pr: 1, rel: n % 2 ? "mother" : "father" },
    { pr: 2, rel: n % 3 ? "grandparent" : "family" },
  ].map(({ pr, rel }) => {
    const i = contactNo++;
    const name = `${CONTACT_NAMES[i % CONTACT_NAMES.length]} (demo)`;
    const phone = `+27 00 000 ${String(1000 + i * 37).slice(-4)}`;
    return `  UPDATE emergency_contact SET active = false WHERE player_id = ${P(n)} AND priority = ${pr} AND active;
  INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
  VALUES (${P(n)}, ${pr}, ${q(name)}, ${q(rel)}, ${q(phone)}, NULL, NULL, ${pr === 1 ? "'Works shifts: try the second number after 18:00 (demo).'" : "NULL"})
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The parent of boy ${n} could not add a contact. Nothing was changed.'; END IF;
  contacts := contacts || jsonb_build_object(${q(`${n}:${pr}`)}, v);`;
  }).join("\n");
  return `${as(parentOf(n))}\n${rows}`;
}).join("\n\n");

// ── 3 · Injuries, by the school's medical officer (POST /api/injuries, /api/injuries/:id/reviews) ──
const INJURIES = [
  { by: "medical.wes", n: boyN("WES", "1XI", 12), type: "Lower back stiffness", sev: "moderate", ago: 12, rtw: 10, review: 2,
    notes: "Stiffness after a long nets session. No bowling until cleared; core and mobility work only.",
    then: { phase: "rehab", restricted: true, rtw: 10, next: 4, note: "Pain-free walking and light running. Started a graded return; batting in nets allowed, no bowling yet." } },
  { by: "medical.wes", n: boyN("WES", "U14A", 13), type: "Sprained left ankle", sev: "minor", ago: 5, rtw: 6, review: 1,
    notes: "Rolled it fielding at practice. Iced, strapped; rest and review." },
  { by: "medical.wes", n: boyN("WES", "U16B", 13), type: "Bruised finger", sev: "minor", ago: 19, rtw: 7, review: 5,
    notes: "Struck on the finger in fielding drills. No fracture suspected; buddy-strapped.",
    then: { phase: "cleared", restricted: false, rtw: null, next: null, note: "Full grip strength, no pain. Cleared to play." } },
  { by: "medical.kea", n: boyN("KEA", "1XI", 13), type: "Hamstring strain (left)", sev: "moderate", ago: 8, rtw: 12, review: 2,
    notes: "Felt it sprinting between the wickets. Stretching and strengthening programme; no sprinting." },
];
const injuries = INJURIES.map((j) => `${as(j.by)}
  SELECT ok, reason, injury_id AS id INTO r
    FROM injury_record(${P(j.n)}, ${q(j.type)}, ${q(j.sev)}, ${day(-j.ago)}, true, ${day(j.rtw)}, ${day(j.review)}, false, ${q(j.notes)}, NULL);
${must(`The medical officer could not record the injury to boy ${j.n}`)}${j.then ? `
  SELECT ok, reason, review_id AS id INTO r
    FROM injury_review_record(r.id, ${q(j.then.phase)}, ${j.then.restricted}, ${j.then.rtw == null ? "NULL" : day(j.then.rtw)}, ${j.then.next == null ? "NULL" : day(j.then.next)}, ${q(j.then.note)});
${must(`The medical officer could not review the injury to boy ${j.n}`)}` : ""}`).join("\n\n");

// ── 4 · Training: sessions, the register, a plan (POST /api/training, …/attendance, …/plan, /api/drills) ──
const FULL = [
  { school: "WES", side: "1XI" }, { school: "WES", side: "U14A" }, { school: "WES", side: "U16B" }, { school: "KEA", side: "1XI" },
];
const SESSION_PLAN = [
  { d: -4, t: "15:00", min: 120, type: "bowling", title: "Nets: seam, line and length" },
  { d: -2, t: "15:00", min: 90, type: "fielding", title: "Fielding: high catches and throwing" },
  { d: 1, t: "15:00", min: 90, type: "batting", title: "Batting: playing spin" },
  { d: 3, t: "15:00", min: 90, type: "match-prep", title: "Match preparation and middle practice" },
  { d: 6, t: "15:00", min: 120, type: "skills", title: "Skills circuit" },
  { d: 8, t: "15:00", min: 90, type: "fitness", title: "Conditioning and running between the wickets" },
];
const VENUE = { WES: "Main nets", KEA: "Kearsney nets" };
const sessionSql = (school, side, s, key) => `  INSERT INTO training_session (school_id, team_code, title, starts_at, duration_min, venue, ground_id, session_type, notes)
  VALUES (${q(school === "WES" ? WES : KEA)}, ${q(side)}, ${q(s.title)}, ${at(s.d, s.t)}, ${s.min}, ${q(VENUE[school])}, NULL, ${q(s.type)}, NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The ${school} ${side} coach could not schedule "${s.title}". Nothing was changed.'; END IF;
  ts := ts || jsonb_build_object(${q(key)}, v);`;
// The register: most present; squad 4 late, 9 excused, 14 absent. Never "injured" (db/105).
const ATTEND = (sq) => (sq === 4 ? "late" : sq === 9 ? "excused" : sq === 14 ? "absent" : "present");
const attendanceSql = (school, side, key, skipSquads = []) => {
  const lines = [];
  for (let sq = 1; sq <= 15; sq++) {
    if (skipSquads.includes(sq)) continue;
    lines.push(`(${P(boyN(school, side, sq))}, '${ATTEND(sq)}')`);
  }
  return `  FOR b IN SELECT * FROM (VALUES ${lines.join(", ")}) AS a(player, status) LOOP
    INSERT INTO training_attendance (session_id, player_id, status)
    SELECT (ts->>${q(key)})::uuid, b.player, b.status
     WHERE player_school(b.player) = (SELECT t.school_id FROM training_session t WHERE t.id = (ts->>${q(key)})::uuid)
    ON CONFLICT (session_id, player_id) DO UPDATE SET status = excluded.status, recorded_at = now()
    RETURNING player_id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The register for % refused a boy. Nothing was changed.', ${q(key)}; END IF;
  END LOOP;`;
};
// The coach checks he may run the session first, as the route's mayManage() does.
const mayRun = (key) => `  IF NOT (SELECT app_can('team.training.run', t.school_id, t.team_code, '00000000-0000-0000-0000-000000000000'::uuid,
                            '00000000-0000-0000-0000-000000000000'::uuid) FROM training_session t WHERE t.id = (ts->>${q(key)})::uuid) THEN
    RAISE EXCEPTION 'The coach may not run %. Nothing was changed.', ${q(key)};
  END IF;`;
const injuredOf = (school, side) => INJURIES.filter((j) => j.n >= boyN(school, side, 1) && j.n <= boyN(school, side, 15) && !(j.then?.phase === "cleared")).map((j) => j.n - boyN(school, side, 1) + 1);

const training = FULL.map(({ school, side }) => {
  const coach = `coach.${school.toLowerCase()}.${side.toLowerCase()}`;
  const parts = [as(coach)];
  for (const s of SESSION_PLAN) {
    const key = `${school}/${side}/${s.d}`;
    parts.push(sessionSql(school, side, s, key));
    if (s.d < 0) { parts.push(mayRun(key)); parts.push(attendanceSql(school, side, key, injuredOf(school, side))); }
  }
  // A plan of drills on the next session: the school's own two at WES, the library's elsewhere.
  const next = `${school}/${side}/1`;
  parts.push(`${mayRun(next)}
  DELETE FROM training_session_drill WHERE session_id = (ts->>${q(next)})::uuid;
  INSERT INTO training_session_drill (session_id, drill_id, position, minutes)
  SELECT (ts->>${q(next)})::uuid, d.id, row_number() OVER (ORDER BY d.pick)::smallint, d.minutes
    FROM (SELECT dr.id, CASE WHEN dr.school_id IS NOT NULL THEN 0 ELSE 1 END AS pick, 20::smallint AS minutes
            FROM drill dr
           WHERE ${school === "WES" ? "dr.school_id = " + q(WES) + "::uuid OR " : ""}(dr.school_id IS NULL AND dr.category IN ('batting', 'fielding'))
           ORDER BY 2, dr.name LIMIT 3) d;
  GET DIAGNOSTICS n2 = ROW_COUNT;
  IF n2 < 2 THEN RAISE EXCEPTION 'The plan for % came to % drills. Nothing was changed.', ${q(next)}, n2; END IF;`);
  return parts.join("\n");
});
// Every other side: one session in the coming days, by its own coach, so each coach's "This week" has one.
const otherSides = [];
for (const school of ["WES", "KEA"]) {
  for (const side of SIDES) {
    if (FULL.some((f) => f.school === school && f.side === side)) continue;
    const coach = `coach.${school.toLowerCase()}.${side.toLowerCase()}`;
    const s = { d: 2 + (SIDES.indexOf(side) % 3), t: side.startsWith("U1") ? "14:30" : "15:30", min: 90,
                type: ["batting", "bowling", "fielding"][SIDES.indexOf(side) % 3],
                title: ["Batting: front-foot drives", "Bowling: run-up and rhythm", "Fielding: ground fielding and backing up"][SIDES.indexOf(side) % 3] };
    otherSides.push(`${as(coach)}\n${sessionSql(school, side, s, `${school}/${side}/${s.d}`)}`);
  }
}

const drills = `${as("coach.wes.1xi")}
  INSERT INTO drill (school_id, name, category, duration_min, description)
  VALUES (${q(WES)}, 'Westville yorker ladder', 'bowling', 20,
          'Six balls at a shoe on a full length, then a ladder of targets back to good length. Count the hits; no speed gun.')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not add a drill. Nothing was changed.'; END IF;
  INSERT INTO drill (school_id, name, category, duration_min, description)
  VALUES (${q(WES)}, 'Three-cone run-outs', 'fielding', 15,
          'Pick up on the run from three cones and throw to the keeper''s end; the batter''s end on the coach''s call.')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES 1XI coach could not add a drill. Nothing was changed.'; END IF;`;

// ── 5 · Skills assessments and development notes (POST /players/:id/assessment, /notes) ──
const ASSESS = [
  { by: "coach.wes.1xi", n: 1, ago: 30, scores: { technical: { lineAndLength: 13, spin: 14, variations: 11 }, mental: { composure: 13, leadership: 15 } } },
  { by: "coach.wes.1xi", n: 1, ago: 3, scores: { technical: { lineAndLength: 14, spin: 15, variations: 12 }, mental: { composure: 14, leadership: 15 } } },
  { by: "coach.wes.1xi", n: 2, ago: 3, scores: { technical: { footwork: 12, timing: 13, catching: 14 }, physical: { agility: 13 } } },
  { by: "coach.wes.1xi", n: 6, ago: 3, scores: { technical: { glovework: 14, catching: 15 }, mental: { concentration: 13 } } },
  { by: "coach.wes.1xi", n: 8, ago: 3, scores: { technical: { lineAndLength: 12, seamAndSwing: 13 }, physical: { bowlingPace: 15, stamina: 12 } } },
  { by: "coach.wes.u14a", n: 106, ago: 3, scores: { technical: { footwork: 12, defence: 13, againstSpin: 11 }, mental: { concentration: 12 } } },
  { by: "coach.wes.u14a", n: 107, ago: 3, scores: { technical: { spin: 11, catching: 12 }, mental: { teamwork: 14 } } },
  { by: "coach.wes.u16b", n: 61, ago: 3, scores: { technical: { footwork: 11, timing: 12, shotRange: 11 }, mental: { determination: 14 } } },
  { by: "coach.kea.1xi", n: 166, ago: 3, scores: { technical: { footwork: 13, timing: 14, againstPace: 12 }, mental: { composure: 13 } } },
];
const assessments = ASSESS.map((a) => {
  const rows = Object.entries(a.scores).flatMap(([cat, m]) => Object.entries(m).map(([metric, score]) =>
    `(${q(cat)}, ${q(metric)}, ${score})`));
  return `${as(a.by)}
  FOR srow IN SELECT * FROM (VALUES ${rows.join(", ")}) AS x(category, metric, score) LOOP
    INSERT INTO player_skill (player_id, assessed_on, assessed_by, category, metric, score, note)
    VALUES (${P(a.n)}, ${day(-a.ago)}, app_user_id(), srow.category, srow.metric, srow.score, NULL)
    ON CONFLICT (player_id, assessed_on, category, metric) WHERE withdrawn_at IS NULL
    DO UPDATE SET score = excluded.score, note = excluded.note
    RETURNING id INTO v;
    IF v IS NULL THEN RAISE EXCEPTION 'The assessment of boy ${a.n} was refused. Nothing was changed.'; END IF;
  END LOOP;`;
}).join("\n\n");

const NOTES = [
  { by: "coach.wes.1xi", n: 1, disc: "bowling", adj: 1, ago: 3, body: "Leading the attack well. Arm ball is coming on; keep working on bowling to a plan with the field set." },
  { by: "coach.wes.1xi", n: 2, disc: "batting", adj: null, ago: 2, body: "Good tempo in nets. Leaving well outside off. Next: rotating the strike against spin." },
  { by: "coach.wes.1xi", n: 8, disc: "bowling", adj: null, ago: 4, body: "Quick and getting quicker. Workload kept to the plan agreed with home; follow-through drills to protect his back." },
  { by: "coach.wes.u14a", n: 106, disc: "batting", adj: 1, ago: 2, body: "Much better at playing spin late. Ready to open in the next fixture." },
  { by: "coach.kea.1xi", n: 166, disc: null, adj: null, ago: 3, body: "Set the tone at practice this week. Asked good questions about field placings." },
];
const notes = NOTES.map((x) => `${as(x.by)}
  INSERT INTO development_note (player_id, school_id, author_id, body, about_discipline, adjustment, observed_on)
  SELECT ${P(x.n)}, player_school(${P(x.n)}), app_user_id(), ${q(x.body)}, ${q(x.disc)}, ${x.adj ?? "NULL"}, ${day(-x.ago)}
   WHERE player_school(${P(x.n)}) IS NOT NULL
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The development note on boy ${x.n} was refused. Nothing was changed.'; END IF;`).join("\n\n");

// ── 6 · Workload: the platform grants the module at WES, three families consent, the coach logs nets loads ──
const SEAMERS = [8, 13, 15];   // WES 1XI: fast, medium, medium; born 2009 (under 18, so the parent consents); none injured
const HEALTH_VERSION = "health-monitoring-2026-09";   // apps/web/src/views/healthconsent.jsx HEALTH_CONSENT_VERSION
const workload = `${actAs(U("platform"))}
  INSERT INTO feature_grant (key, school_id, granted, note, changed_by, changed_at)
  VALUES ('workload_monitoring', ${q(WES)}, true, ${q(MARK)}, app_user_id(), now())
  ON CONFLICT (key, school_id) DO UPDATE
    SET granted = excluded.granted, note = excluded.note, changed_by = excluded.changed_by, changed_at = now();

${SEAMERS.map((n) => `${as(parentOf(n))}
  SELECT * INTO r FROM health_monitoring_consent_set(${P(n)}, true, ${q(HEALTH_VERSION)}, NULL, NULL, NULL);
${must(`The parent of boy ${n} could not consent to health monitoring`)}`).join("\n")}

${as("coach.wes.1xi")}
${SEAMERS.map((n, i) => `  INSERT INTO load_entry (player_id, kind, training_session_id, on_date, band, units, rpe, minutes, supersedes)
  VALUES (${P(n)}, 'nets', (ts->>'WES/1XI/-4')::uuid, ${day(-4)}, ${q(["24_36", "12_24", "12_24"][i])}, NULL, ${[7, 6, 5][i]}, ${[50, 40, 35][i]}, NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The nets load for boy ${n} was refused. Nothing was changed.'; END IF;`).join("\n")}`;

// ── 7 · A safeguarding concern: raised by the WES U14A coach, held by the WES DSO ──
const ACCOUNT = "After Tuesday's practice one of the U14A boys seemed upset and was very quiet. I spoke with him briefly; he said he was tired and fine. Raising it so the DSO is aware. The team manager let his parents know.";
const safeguarding = `${as("coach.wes.u14a")}
  SELECT * INTO r FROM safeguarding_concern_raise(
    p_school => ${q(WES)}::uuid, p_about_kind => 'child', p_nature => ARRAY['other']::text[], p_certainty => 'suspicion',
    p_account => ${q(ACCOUNT)}, p_how_learned => 'witness', p_subject_player => ${P(boyN("WES", "U14A", 7))},
    p_subject_person => NULL, p_subject_text => NULL, p_occurred_on => ${day(-3)}, p_occurred_where => 'Junior nets',
    p_authorities_told => NULL, p_named_ok => true, p_preferred_dso => NULL);
${must("The U14A coach could not raise the concern")}
  ref := r.reference;

${as("dso.wes")}
  SELECT i.id INTO v FROM safeguarding_inbox(NULL) i WHERE i.reference = ref;
  IF v IS NULL THEN RAISE EXCEPTION 'The concern did not reach the Westville DSO. Nothing was changed.'; END IF;
  SELECT * INTO r FROM safeguarding_assign(v, app_user_id());
${must("The DSO could not take the concern")}
  SELECT * INTO r FROM safeguarding_note(v, 'note', 'Spoke with the coach. Arranged a quiet check-in with the boy at school on Monday, with his class teacher present.');
${must("The DSO could not note the concern")}
  SELECT * INTO r FROM safeguarding_note(v, 'guardian_contacted', 'Spoke with his mother by phone. Nothing further at home; she will let us know if anything changes.');
${must("The DSO could not note the call home")}`;

// ── 8 · The office: a guardian link waiting to be verified (POST /players/:id/guardians) ──
const PENDING_LINK = { parent: parentOf(30), boy: boyN("WES", "U13A", 5) };
const guardianLink = `${as("registrar.wes")}
  SELECT * INTO r FROM guardian_link_establish(${U(PENDING_LINK.parent)}, ${P(PENDING_LINK.boy)}, 'guardian');
${must("The office could not open the guardian link")}`;

// ── 9 · A pending role request, by a parent who scores (POST /api/requests) ──
const roleRequest = `${as(parentOf(20))}
  INSERT INTO role_request (person_id, role, school_id, team_code, player_id, note)
  VALUES (app_user_id(), 'scorer', ${q(WES)}, NULL, NULL, 'I keep the book for the 2XI most Saturdays and can help on the pad.')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The parent could not ask to score. Nothing was changed.'; END IF;`;

// ── 10 · A lift driver's declaration (POST /api/lifts/declaration) ──
const declaration = `${as(parentOf(2))}
  SELECT ok, reason INTO r FROM lift_driver_declare(${q(WES)}::uuid, 'Silver hatchback (demo)', 'DEMO 002', 3, true, true, true, true, true,
                                                     (contacts->>'2:1')::uuid);
${must("The parent could not make the driver's declaration")}`;

// ── 11 · Availability for the coming fixtures, by each boy's parent (POST /matches/:id/availability) ──
// Only fixtures already there, starting in the next ten days, not started, and
// only boys nobody has answered for. Squad 5 is doubtful (family), squad 10 out
// (academic), 13–15 not yet answered (so the parent's list has a row).
const availability = `  FOR f IN SELECT * FROM jsonb_to_recordset(current_setting('demo_roles.coming')::jsonb)
                    AS x(match_id uuid, school_id uuid, team_code text, starts_at timestamptz) ORDER BY x.starts_at LOOP
    FOR b IN SELECT pl.id AS player, pl.squad_no, g.email
               FROM jsonb_to_recordset(current_setting('demo_roles.boys')::jsonb) AS pl(id uuid, school_id uuid, team_code text, squad_no int)
               JOIN jsonb_to_recordset(current_setting('demo_roles.parents')::jsonb) AS g(player uuid, email text) ON g.player = pl.id
              WHERE pl.school_id = f.school_id AND pl.team_code = f.team_code AND pl.squad_no BETWEEN 1 AND 12
                AND NOT (current_setting('demo_roles.answered')::jsonb ? (f.match_id::text || ':' || pl.id::text)) LOOP
      PERFORM app_session_begin((ids->>b.email)::uuid, 'demo-roles', NULL, NULL);
      INSERT INTO match_availability (match_id, player_id, school_id, status, reason_kind, note, declared_by, declared_at)
      VALUES (f.match_id, b.player, match_school(f.match_id),
              CASE b.squad_no WHEN 5 THEN 'doubtful' WHEN 10 THEN 'unavailable' ELSE 'available' END,
              CASE b.squad_no WHEN 5 THEN 'family' WHEN 10 THEN 'academic' END, NULL, app_user_id(), now())
      ON CONFLICT (match_id, player_id) DO UPDATE
        SET status = excluded.status, reason_kind = excluded.reason_kind, note = excluded.note,
            declared_by = excluded.declared_by, declared_at = now()
      RETURNING match_id INTO v;
      IF v IS NULL THEN RAISE EXCEPTION 'A parent could not answer for his son. Nothing was changed.'; END IF;
      avail := avail + 1;
    END LOOP;
  END LOOP;`;

// ── 12 · Transport: a second WES vehicle, a KEA minibus (POST /api/vehicles) ──
const vehicles = `${as("transport.wes")}
  INSERT INTO vehicle (school_id, registration, description, kind, capacity, condition, next_service_on, active, notes,
                       insurance_expires_on, roadworthy_expires_on)
  VALUES (${q(WES)}, 'WES DEMO 2', 'Demo bus, 60 seats', 'bus', 60, 'good', ${day(40)}, true, ${q(MARK)}, date '2027-06-30', date '2027-02-28')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The WES transport coordinator could not add the bus. Nothing was changed.'; END IF;

${as("transport.kea")}
  INSERT INTO vehicle (school_id, registration, description, kind, capacity, condition, next_service_on, active, notes,
                       insurance_expires_on, roadworthy_expires_on)
  VALUES (${q(KEA)}, 'KEA DEMO 1', 'Demo minibus, 16 seats', 'minibus', 16, 'excellent', ${day(25)}, true, ${q(MARK)}, date '2027-04-30', date '2027-03-31')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The KEA transport coordinator could not add the minibus. Nothing was changed.'; END IF;`;

// ── 13 · Lift clubs at Kearsney: the platform grants the module, the principal signs the policy ──
const KEA_POLICY = [
  "Kearsney lift club (demo). Parents may offer seats in their own cars to their own son's fixtures, and other",
  "parents may ask for a seat for theirs. A seat is confirmed only while the boy's guardian and the driver have",
  "both said yes to the lift as it now stands. Every passenger is seated and belted. Drivers hold a valid licence,",
  "insurance and a roadworthy car. Meet at the named point at the named time. Concerns go to the school's DSO.",
].join(" ");
const keaLifts = `${actAs(U("platform"))}
  INSERT INTO feature_grant (key, school_id, granted, note, changed_by, changed_at)
  VALUES ('lift_club', ${q(KEA)}, true, ${q(MARK)}, app_user_id(), now())
  ON CONFLICT (key, school_id) DO UPDATE
    SET granted = excluded.granted, note = excluded.note, changed_by = excluded.changed_by, changed_at = now();
${as("principal.kea")}
  SELECT ok, reason INTO r FROM lift_policy_sign(${q(KEA)}, ${q(KEA_POLICY)}, false, true, 'The chapel car park');
${must("The Kearsney principal could not sign the lift policy")}`;

// ── 14 · Sponsors: Hilton's by the bursar; Westville's by the principal, with a waiver (POST /api/sponsors, /sponsorships) ──
const sponsor = (school, name, category, text, bg) => `  INSERT INTO sponsor (school_id, name, category, logo_text, logo_bg, active, created_by)
  VALUES (${q(school)}, btrim(${q(name)}), ${q(category)}, ${q(text)}, ${q(bg)}, true, app_user_id())
  ON CONFLICT (school_id, lower(btrim(name))) DO UPDATE
    SET category = excluded.category, logo_text = excluded.logo_text, logo_bg = excluded.logo_bg, active = excluded.active
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not add the sponsor %. Nothing was changed.', ${q(name)}; END IF;
  sp := sp || jsonb_build_object(${q(name)}, v);`;
const placement = (name, where, from, to, value, share, exclusive = false, waiver = null) => `  INSERT INTO sponsorship (school_id, sponsor_id, placement, match_id, starts_on, ends_on, contract_value_zar, school_share_pct,
                           agreed_by, agreed_at, exclusive, exclusive_scope, competition_id, waiver_note)
  SELECT s.school_id, s.id, ${q(where)}, NULL, ${from}, ${to}, ${value}, ${share}, app_user_id(), now(),
         ${exclusive}, ${exclusive ? "'school'" : "NULL"}, NULL, ${q(waiver)}
    FROM sponsor s WHERE s.id = (sp->>${q(name)})::uuid
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'Could not place %. Nothing was changed.', ${q(name)}; END IF;`;
const SEASON_END = "date '2027-03-31'";
const sponsors = `${as("bursar")}
${sponsor(HIL, "Midlands Motors (demo)", "automotive", "MIDLANDS", "#1d4ed8")}
${sponsor(HIL, "Hilltop Outfitters (demo)", "sportswear", "HILLTOP", "#065f46")}
${placement("Midlands Motors (demo)", "scorecard_footer", "date '2026-10-01'", SEASON_END, 45000, 100)}
${placement("Hilltop Outfitters (demo)", "ground_board", "date '2026-10-01'", SEASON_END, 18000, 100)}

${as("principal.wes")}
${sponsor(WES, "Berea Family Pharmacy (demo)", "health", "BEREA", "#0f766e")}
${sponsor(WES, "Westville Physio Rooms (demo)", "health", "PHYSIO", "#7c3aed")}
${placement("Berea Family Pharmacy (demo)", "scorecard_footer", "date '2026-10-01'", SEASON_END, 30000, 100, true)}
${placement("Westville Physio Rooms (demo)", "ground_board", "date '2026-10-15'", SEASON_END, 12000, 100, false,
  "Both are local family health businesses; the sports committee agreed to share the category for this season.")}`;

// ── 15 · The league: KEA 1XI in, and the table's conditions ──
const TABLE_CONDITIONS = [
  ["points.win", 2], ["points.tie", 1], ["points.no_result", 1], ["points.abandoned", 1], ["points.loss", 0],
  ["table.order", ["points", "wins", "nrr"]],
];
const league = `  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(current_setting('demo_roles.entrants')::jsonb) e
                  WHERE e->>'school_id' = ${q(KEA)} AND e->>'team_code' = '1XI') THEN
${as("league").replace(/^/gm, "  ")}
    SELECT * INTO r FROM competition_entrant_invite(${q(COMPETITION)}::uuid, ${q(KEA)}::uuid, '1XI', 'Kearsney 1st XI');
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not invite Kearsney: %. Nothing was changed.', r.reason; END IF;
    v := r.entrant_id;
${as("dos.kea").replace(/^/gm, "  ")}
    SELECT * INTO r FROM competition_entrant_respond(v, true);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'Kearsney could not accept: %. Nothing was changed.', r.reason; END IF;
${as("league").replace(/^/gm, "  ")}
    SELECT * INTO r FROM place_entrant(v, ${q(DIVISION_1)}::uuid);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not place Kearsney: %. Nothing was changed.', r.reason; END IF;
  END IF;

  IF NOT (current_setting('demo_roles.conditions')::boolean) THEN
${as("league").replace(/^/gm, "  ")}
    SELECT * INTO r FROM condition_set_draft(${q(COMPETITION)}::uuid, 'League table rules 2026/27 (demo)', sa_today() + 1);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not draft its conditions: % %. Nothing was changed.', r.reason, r.detail; END IF;
    v := r.set_id;
${TABLE_CONDITIONS.map(([k, val]) => `    SELECT * INTO r FROM condition_value_enter(v, ${q(k)}, '', ${q(JSON.stringify(val))}::jsonb, 'confirmed',
           'KZN Schools T20 League rules (demo)', 'Section 4', date '2026-09-15', NULL);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not enter ${k}: % %. Nothing was changed.', r.reason, r.detail; END IF;`).join("\n")}
    -- Left a DRAFT on purpose: published, it would take effect tomorrow for the
    -- season's fixtures in this league, which are the season builder's. The
    -- league admin publishes it in the walk-through if Kameel wants to show it.
  END IF;`;

// ── 16 · School news, by each director of sport (POST /api/news, scope school, sent) ──
const NEWS = [
  { by: "dos.wes", school: WES, title: "Nets timetable for the rest of term",
    body: "Senior nets run Monday, Wednesday and Thursday from 15:00; junior sides Tuesday and Thursday from 14:30. Bring water and a hat: the sun is back. Coaches will post any change here." },
  { by: "dos.wes", school: WES, title: "Thank you to our parent scorers",
    body: "Our sides could not play without the parents who keep the book and run the pad. If you would like to help, ask in the app (Settings, Ask for a role) and the office will be in touch." },
  { by: "dos.kea", school: KEA, title: "New sight screens at the Oval",
    body: "The new sight screens are up at the Oval in time for the derby season. Thank you to the groundstaff and to the families who helped raise the money." },
];
const news = NEWS.map((x) => `${as(x.by)}
  INSERT INTO news_post (scope, school_id, team_code, competition_id, title, body, published_at, urgency, kind, fixture_id)
  VALUES ('school', ${q(x.school)}, NULL, NULL, ${q(x.title)}, ${q(x.body)}, now(), 'low', 'post', NULL)
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The director of sport could not post "${x.title}". Nothing was changed.'; END IF;`).join("\n\n");

// ── The file ──
const sql = `-- SCRBRD demo copy · every role's home, filled (tools/demo-roles.mjs).
-- FOR THE scrbrd-demo PROJECT ONLY. Paste AFTER the demo cast and the season builder's file.
-- Every person is invented, every address @example.invalid, every phone +27 00 000 ….
-- One transaction. Refuses to run outside the demo, without the cast, or twice.
-- Every write runs as scrbrd_app under the person whose job it is, through the app's own door.
BEGIN;

DO $demo_only$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'registrar.wes@example.invalid' AND active)
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'platform@example.invalid' AND active) THEN
    RAISE EXCEPTION 'This is not the demo database (the seeded demo accounts are missing). Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM app_user WHERE email NOT LIKE '%@example.invalid') THEN
    RAISE EXCEPTION 'This database holds a real person''s account, so it is not the demo copy. Nothing was changed.';
  END IF;
  IF (SELECT count(*) FROM player WHERE id::text LIKE 'de300000-0000-4000-8000-%') <> 330
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'coach.kea.u12a@example.invalid')
     OR NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'pupil.wes.u14a@example.invalid') THEN
    RAISE EXCEPTION 'The 330 players or the demo cast are not here. Paste tools/demo-cast.mjs''s file first. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM adult_clearance WHERE note = ${q(MARK)}) THEN
    RAISE EXCEPTION 'The demo roles are already filled here. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM safeguarding_concern WHERE school_id = ${q(WES)} AND account LIKE 'After Tuesday''s practice one of the U14A boys%') THEN
    RAISE EXCEPTION 'The demo roles are already filled here (the concern is there). Nothing was changed.';
  END IF;
END $demo_only$;

-- The owner READS only: who is who by email (the demo's ids are its own), the
-- appointees whose clearances the office records, the boys and their parents,
-- the answers already given, and what the league already holds. Kept in this
-- transaction's settings for the writer below.
DO $read$
BEGIN
  PERFORM set_config('demo_roles.ids', (SELECT jsonb_object_agg(email, id)::text FROM app_user WHERE email LIKE '%@example.invalid'), true);
  PERFORM set_config('demo_roles.clear', coalesce((
    SELECT jsonb_agg(jsonb_build_object('person', ra.person_id, 'school', ra.school_id, 'role', ra.role, 'email', u.email,
                                        'k', row_number) ORDER BY ra.school_id, u.email, ra.role)::text
      FROM (SELECT ra.*, row_number() OVER (ORDER BY ra.school_id, ra.person_id, ra.role) FROM role_assignment ra) ra
      JOIN app_user u ON u.id = ra.person_id AND u.active
     WHERE ra.active AND ra.fixture_id IS NULL AND ra.school_id IN (${q(WES)}, ${q(KEA)})
       AND EXISTS (SELECT 1 FROM clearance_requirement cr WHERE cr.role = ra.role)), '[]'), true);
  PERFORM set_config('demo_roles.boys', (SELECT jsonb_agg(jsonb_build_object('id', id, 'school_id', school_id, 'team_code', team_code, 'squad_no', squad_no))::text
                                           FROM player WHERE id::text LIKE 'de300000-0000-4000-8000-%'), true);
  PERFORM set_config('demo_roles.parents', (SELECT jsonb_agg(jsonb_build_object('player', s.player_id, 'email', u.email))::text
      FROM assignment_subject s JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian' AND a.active
      JOIN app_user u ON u.id = a.person_id AND u.active AND u.email ~ '^parent\\.[0-9]{3}@example\\.invalid$'
     WHERE s.verification_state = 'verified' AND s.consent_state = 'granted'
       AND s.player_id::text LIKE 'de300000-0000-4000-8000-%'
       AND split_part(split_part(u.email, '@', 1), '.', 2)::int = right(s.player_id::text, 3)::int), true);
  PERFORM set_config('demo_roles.answered', coalesce((SELECT jsonb_object_agg(match_id::text || ':' || player_id::text, true)::text
                                                        FROM match_availability), '{}'), true);
  -- The coming fixtures, the home side only: the availability route files an
  -- answer under match_school(), the home school, so an away family's answer
  -- is the away school's to take (the route refuses it here).
  PERFORM set_config('demo_roles.coming', coalesce((
    SELECT jsonb_agg(jsonb_build_object('match_id', m.id, 'school_id', m.school_id, 'team_code', m.team_code, 'starts_at', m.starts_at))::text
      FROM match m
     WHERE m.status = 'scheduled' AND m.starts_at > now() AND m.starts_at < now() + interval '10 days'
       AND m.school_id IN (${q(WES)}, ${q(KEA)}) AND m.school_id = match_school(m.id)), '[]'), true);
  PERFORM set_config('demo_roles.entrants', coalesce((SELECT jsonb_agg(jsonb_build_object('school_id', school_id, 'team_code', team_code))::text
                                                         FROM competition_entrant WHERE competition_id = ${q(COMPETITION)}
                                                          AND status IN ('invited', 'accepted')), '[]'), true);
  PERFORM set_config('demo_roles.conditions', (EXISTS (SELECT 1 FROM condition_set WHERE competition_id = ${q(COMPETITION)}))::text, true);
END $read$;

-- The SQL Editor connects as the table owner, which row-level security does
-- not apply to. The writes below drop to scrbrd_app, the API's own role, so
-- they meet every policy the app meets (as tools/demo-cast.mjs does).
DO $grant$
BEGIN
  EXECUTE format('GRANT scrbrd_app TO %I WITH SET TRUE', current_user);
EXCEPTION
  WHEN duplicate_object OR invalid_grant_operation THEN NULL;
  WHEN syntax_error THEN EXECUTE format('GRANT scrbrd_app TO %I', current_user);
END $grant$;

SET LOCAL ROLE scrbrd_app;

DO $roles$
DECLARE
  ids      jsonb := current_setting('demo_roles.ids')::jsonb;
  ts       jsonb := '{}';   -- "WES/1XI/-4" -> training session id
  sp       jsonb := '{}';   -- sponsor name -> id
  contacts jsonb := '{}';   -- "boy:priority" -> emergency contact id
  r        record;
  c        record;
  b        record;
  srow     record;
  f        record;
  kind     text;
  ref      text;
  iss      date;
  exp      date;
  v        uuid;
  n        integer := 0;
  n2       integer;
  avail    integer := 0;
BEGIN
  -- ── 1 · Clearances, recorded by each school's office (POST /api/clearances) ──
${clearances}

  -- ── 2 · Emergency contacts, by each boy's own parent ──
${contacts}

  -- ── 3 · Injuries and return-to-play reviews, by the medical officers ──
${injuries}

  -- ── 4 · Training: two school drills, sessions, registers and a plan ──
${drills}

${training.join("\n\n")}

${otherSides.join("\n\n")}

  -- ── 5 · Skills assessments and development notes, by the coaches ──
${assessments}

${notes}

  -- ── 6 · Workload: the module at WES, three consents, the nets loads ──
${workload}

  -- ── 7 · A safeguarding concern, raised by a coach and held by the DSO ──
${safeguarding}

  -- ── 8 · A guardian link waiting to be verified ──
${guardianLink}

  -- ── 9 · A pending request for a role ──
${roleRequest}

  -- ── 10 · A lift driver's declaration ──
${declaration}

  -- ── 11 · Availability for the coming fixtures (only those already there) ──
${availability}
  RAISE NOTICE 'demo-roles: % clearances, % availability answers', n, avail;

  -- ── 12 · Transport ──
${vehicles}

  -- ── 13 · Lift clubs at Kearsney ──
${keaLifts}

  -- ── 14 · Sponsors ──
${sponsors}

  -- ── 15 · The league ──
${league}

  -- ── 16 · School news ──
${news}

  PERFORM set_config('app.user_id', '', true);
  PERFORM set_config('app.device_id', '', true);
END $roles$;

RESET ROLE;

-- ── The check, as the owner: everything above is there, or nothing is ──
DO $check$
DECLARE cl int; soon int; ec int; inj int; rev int; ts int; att int; sk int; dn int; ld int; sg int; sgn int;
        gl int; rr int; dec int; veh int; spn int; spl int; ent int; cs int; nw int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE expires_on <= sa_today() + 30) INTO cl, soon FROM adult_clearance WHERE note = ${q(MARK)};
  SELECT count(*) INTO ec FROM emergency_contact WHERE active AND name LIKE '% (demo)' AND player_id IN (${CONTACT_BOYS.map(P).join(", ")});
  SELECT count(*) INTO inj FROM injury WHERE player_id IN (${INJURIES.map((j) => P(j.n)).join(", ")});
  SELECT count(*) INTO rev FROM injury_review rv JOIN injury i ON i.id = rv.injury_id WHERE i.player_id IN (${INJURIES.map((j) => P(j.n)).join(", ")});
  SELECT count(*) INTO ts FROM training_session WHERE school_id IN (${q(WES)}, ${q(KEA)}) AND starts_at > now() - interval '6 days';
  SELECT count(*) INTO att FROM training_attendance a JOIN training_session t ON t.id = a.session_id WHERE t.school_id IN (${q(WES)}, ${q(KEA)});
  SELECT count(*) INTO sk FROM player_skill WHERE player_id IN (${[...new Set(ASSESS.map((a) => a.n))].map(P).join(", ")}) AND withdrawn_at IS NULL;
  SELECT count(*) INTO dn FROM development_note WHERE player_id IN (${NOTES.map((x) => P(x.n)).join(", ")});
  SELECT count(*) INTO ld FROM load_entry WHERE player_id IN (${SEAMERS.map(P).join(", ")});
  SELECT count(*) INTO sg FROM safeguarding_concern WHERE school_id = ${q(WES)} AND account = ${q(ACCOUNT)};
  SELECT count(*) INTO sgn FROM safeguarding_concern_note nt JOIN safeguarding_concern c ON c.id = nt.concern_id WHERE c.account = ${q(ACCOUNT)};
  SELECT count(*) INTO gl FROM assignment_subject s JOIN role_assignment a ON a.id = s.assignment_id
   WHERE s.player_id = ${P(PENDING_LINK.boy)} AND s.verification_state = 'pending'
     AND a.person_id = (SELECT id FROM app_user WHERE email = ${q(PENDING_LINK.parent)});
  SELECT count(*) INTO rr FROM role_request WHERE state = 'pending' AND role = 'scorer' AND school_id = ${q(WES)}
     AND person_id = (SELECT id FROM app_user WHERE email = ${q(parentOf(20))});
  SELECT count(*) INTO dec FROM lift_driver_declaration WHERE withdrawn_at IS NULL AND person_id = (SELECT id FROM app_user WHERE email = ${q(parentOf(2))});
  SELECT count(*) INTO veh FROM vehicle WHERE registration IN ('WES DEMO 2', 'KEA DEMO 1');
  SELECT count(*) INTO spn FROM sponsor WHERE name LIKE '% (demo)';
  SELECT count(*) INTO spl FROM sponsorship sh JOIN sponsor s ON s.id = sh.sponsor_id WHERE s.name LIKE '% (demo)';
  SELECT count(*) INTO ent FROM competition_entrant WHERE competition_id = ${q(COMPETITION)} AND school_id = ${q(KEA)} AND team_code = '1XI' AND status = 'accepted';
  SELECT count(*) INTO cs FROM condition_set WHERE competition_id = ${q(COMPETITION)};
  SELECT count(*) INTO nw FROM news_post WHERE scope = 'school' AND title IN (${NEWS.map((x) => q(x.title)).join(", ")}) AND published_at IS NOT NULL;
  IF cl < 100 OR soon < 1 OR ec <> ${CONTACT_BOYS.length * 2} OR inj <> ${INJURIES.length} OR rev < 2 OR ts < ${FULL.length * SESSION_PLAN.length}
     OR att < 100 OR sk < 20 OR dn <> ${NOTES.length} OR ld <> ${SEAMERS.length} OR sg <> 1 OR sgn < 2 OR gl <> 1 OR rr <> 1
     OR dec <> 1 OR veh <> 2 OR spn <> 4 OR spl <> 4 OR ent <> 1 OR cs < 1 OR nw <> ${NEWS.length} THEN
    RAISE EXCEPTION 'The demo roles are incomplete (clearances %/% soon, contacts %, injuries % reviews %, sessions %, register %, skills %, notes %, loads %, concern % notes %, pending link %, request %, declaration %, vehicles %, sponsors %/%, KEA entrant %, condition sets %, news %). Rolled back.',
      cl, soon, ec, inj, rev, ts, att, sk, dn, ld, sg, sgn, gl, rr, dec, veh, spn, spl, ent, cs, nw;
  END IF;
END $check$;
COMMIT;

-- ── Read-only summary ──
SELECT 'clearances' AS what, count(*)::text AS n, count(*) FILTER (WHERE expires_on <= sa_today() + 30)::text || ' expiring within 30 days' AS note
  FROM adult_clearance WHERE note = ${q(MARK)}
UNION ALL SELECT 'injuries (WES/KEA)', count(*)::text, string_agg(DISTINCT i.phase, ', ') FROM injury i JOIN player p ON p.id = i.player_id WHERE p.school_id IN (${q(WES)}, ${q(KEA)})
UNION ALL SELECT 'training sessions (WES/KEA)', count(*)::text, 'from ' || min((starts_at AT TIME ZONE 'Africa/Johannesburg')::date) || ' to ' || max((starts_at AT TIME ZONE 'Africa/Johannesburg')::date) FROM training_session WHERE school_id IN (${q(WES)}, ${q(KEA)})
UNION ALL SELECT 'availability answers (WES/KEA)', count(*)::text, '' FROM match_availability WHERE school_id IN (${q(WES)}, ${q(KEA)})
UNION ALL SELECT 'safeguarding concerns (WES)', count(*)::text, string_agg(reference, ', ') FROM safeguarding_concern WHERE school_id = ${q(WES)}
UNION ALL SELECT 'pending role requests', count(*)::text, '' FROM role_request WHERE state = 'pending'
UNION ALL SELECT 'pending guardian links', count(*)::text, '' FROM assignment_subject WHERE verification_state = 'pending'
UNION ALL SELECT 'sponsors', count(*)::text, string_agg(name, ', ') FROM sponsor
UNION ALL SELECT 'league entrants', count(*)::text, string_agg(display_name, ', ') FROM competition_entrant WHERE competition_id = ${q(COMPETITION)}
UNION ALL SELECT 'school news posts', count(*)::text, string_agg(title, ' · ') FROM news_post WHERE scope = 'school' AND school_id IN (${q(WES)}, ${q(KEA)});
`;

writeFileSync(out, sql);
console.log(`${out}: ${Buffer.byteLength(sql)} bytes`);
