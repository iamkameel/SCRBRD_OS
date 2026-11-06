#!/usr/bin/env node
/**
 * A PLAYED SEASON for the DEMO copy (scrbrd-demo), as SQL the lead pastes.
 *
 *   node tools/demo-season.mjs <out-dir>            the season: demo-season-1.sql … -N.sql, pasted in order
 *   node tools/demo-season.mjs --live <ISO> <out-dir>  tomorrow's live 1XI match: demo-live.sql
 *
 * Westville (WES) and Kearsney (KEA), every side, 7 October to 5 November
 * 2026, at Westville Main and at Kearsney Main (added here as Kearsney's own
 * ground by Kearsney's director of sport). Every ball is a real event, made
 * by @scrbrd/scoring's own constructors and stamped as the pad stamps it
 * (tools/demo-season-sim.mjs); the fold reads each innings back before it is
 * written. Every person is invented (tools/demo-roster.mjs carries no name).
 *
 * WHO DOES WHAT. Nothing a person decides is written as the table owner:
 * each act runs as scrbrd_app, under app_session_begin() as the person whose
 * job it is, through the statement or function the app's own route uses —
 * so every policy, trigger and refusal the app meets is met here, and the
 * notices those triggers raise are the app's own:
 *
 *   the director of sport  arranges a new fixture, puts a 1XI fixture in the
 *                          league, appoints the officials (two umpires, a third
 *                          umpire, a match referee, the scorer), files the
 *                          pitch report and the weather, publishes his side,
 *                          and confirms a friendly's result
 *   the office             links each person-held duty to its fixture (duty_link())
 *   each side's coach      names his XI (the team-sheet route's check and insert)
 *   the scorer             records the toss, takes the pen (scoring_claim()),
 *                          fixes the playing conditions, and finishes the match
 *                          (match_finalise())
 *   the transport coordinator  books the home side's trip; the driver marks it
 *   the league's administrator  invites Kearsney's 1XI and confirms league results;
 *                          Kearsney's director of sport accepts
 *   the coach              decides Player of the Match (match_award()); on one
 *                          1XI match the captain nominates (captain_nominate())
 *                          and the coach confirms (match_nomination_decide())
 *   the office             records a third of the Westville boys' public-name
 *                          answers from signed forms (public_name_consent_set())
 *
 * The ball log itself is written as the owner, as tools/fixture-matchcentre.mjs
 * writes it (the pad's outbox, each row through toRow()), under the scorer
 * who holds the pen, at the epoch his claim was given.
 *
 * SAFE TO PASTE ONCE. Each file is one transaction; it refuses to run if its
 * own matches are already scored, or if the file before it is not there.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveFacts, fromRow, suggestPlayerOfMatch, matchFigures, figuresWords, toRow, deriveInnings, FACTS_VERSION, POTM_BASIS } from "@scrbrd/scoring";
import { playInnings, rng } from "./demo-season-sim.mjs";
import { ROSTER, sideOf, WES, KEA } from "./demo-roster.mjs";

const args = process.argv.slice(2);
const LIVE = args[0] === "--live";
const liveAt = LIVE ? args[1] : null;
const outDir = LIVE ? args[2] : args[0];
if (!outDir || (LIVE && !liveAt)) {
  console.error("usage: node tools/demo-season.mjs <out-dir>\n       node tools/demo-season.mjs --live <ISO start> <out-dir>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// ── Where and who ──
const WES_MAIN = "ffffffff-0000-0000-0000-000000000002";
const KEA_MAIN = "de5e0000-0000-4000-a000-000000000a01";
const LEAGUE = "99999999-0000-0000-0000-000000000001";
const D1 = "d1710000-0000-0000-0000-000000000001";
const SCH = { WES: { id: WES, key: "wes", code: "WES", name: "Westville Boys' High", ground: WES_MAIN },
              KEA: { id: KEA, key: "kea", code: "KEA", name: "Kearsney College", ground: KEA_MAIN } };
const em = (...p) => `${p.join(".").toLowerCase()}@example.invalid`;
// The seed's register of officials (db/98): invented umpires and a referee.
const REG = [
  { id: "0a000000-0000-0000-0000-000000000001", name: "E Ndlovu" },
  { id: "0a000000-0000-0000-0000-000000000002", name: "V Pillay" },
  { id: "0a000000-0000-0000-0000-000000000004", name: "T Sithole" },
  { id: "0a000000-0000-0000-0000-000000000005", name: "V Ngcobo" },
];
const REFEREE = { id: "0a000000-0000-0000-0000-000000000003", name: "G Marais" };
const CAPTAIN = "de300000-0000-4000-8000-000000000001";       // pupil.wes.1xi's own record
const U14A_BOY = "de300000-0000-4000-8000-000000000106";      // pupil.wes.u14a's
const U16B_BOY = "de300000-0000-4000-8000-000000000061";      // pupil.wes.u16b's
const n3 = (id) => id.slice(-3);

/**
 * THE SEASON. `existing`: the demo's own fixture (found by side and start);
 * otherwise a new one at the id given. `home`: whose fixture it is; its
 * ground is that school's. `win`: who the story says wins. `bat`/`bowl`:
 * the performances it asks for. `potm`: the sides whose coach decides
 * Player of the Match ('nominate': the captain nominates, the coach confirms).
 */
const SEASON = [
  { key: "1xi-1007", team: "1XI", home: "WES", at: "2026-10-07T17:00:00Z", existing: true, league: true, win: "WES",
    bat: { [CAPTAIN]: { min: 28, max: 48 } }, bowl: { [CAPTAIN]: 4 }, potm: ["nominate"] },
  { key: "u16a-1008", team: "U16A", home: "WES", at: "2026-10-08T12:30:00Z", existing: true, win: "WES",
    bat: { "de300000-0000-4000-8000-000000000046": { min: 52, max: 74 } }, potm: ["WES"] },
  { key: "u14a-1015", team: "U14A", home: "WES", at: "2026-10-15T08:00:00Z", existing: true, win: "WES",
    bat: { [U14A_BOY]: { min: 18, max: 34 } }, potm: ["WES"] },
  { key: "u16b-1015", team: "U16B", home: "WES", at: "2026-10-15T12:30:00Z", existing: true, win: "WES",
    bat: { [U16B_BOY]: { min: 30, max: 46 } }, potm: ["WES"] },
  { key: "1xi-1017", team: "1XI", home: "WES", at: "2026-10-17T08:00:00Z", existing: true, league: true, win: "WES",
    bat: { [CAPTAIN]: { min: 101, notOut: true } }, potm: ["WES"] },
  { key: "u14a-1021", team: "U14A", home: "KEA", at: "2026-10-21T12:30:00Z", id: "de5e0000-0000-4000-a000-000000000101", win: "WES",
    bat: { [U14A_BOY]: { min: 52, max: 72 } }, potm: ["WES", "KEA"] },
  { key: "1xi-1024", team: "1XI", home: "WES", at: "2026-10-24T07:30:00Z", id: "de5e0000-0000-4000-a000-000000000103", win: "WES", potm: ["WES"] },
  { key: "u15a-1026", team: "U15A", home: "KEA", at: "2026-10-26T12:30:00Z", id: "de5e0000-0000-4000-a000-000000000104", win: "WES",
    bat: { "de300000-0000-4000-8000-000000000077": { min: 100, max: 118 } }, potm: ["WES", "KEA"] },
  { key: "u16b-1029", team: "U16B", home: "KEA", at: "2026-10-29T12:30:00Z", id: "de5e0000-0000-4000-a000-000000000108", win: "KEA", potm: ["WES", "KEA"] },
  { key: "1xi-1031", team: "1XI", home: "KEA", at: "2026-10-31T12:00:00Z", id: "de5e0000-0000-4000-a000-000000000110", league: true, win: "WES",
    bat: { [CAPTAIN]: { min: 30, max: 52 } }, bowl: { [CAPTAIN]: 5 }, potm: ["WES", "KEA"] },
];

/**
 * The demo's other October fixtures, not played in this season: the director
 * of sport rearranges each to a date after the ones already ahead (the
 * fixture route's update of starts_at), so no past fixture stands half-done.
 */
const REARRANGED = [
  ["U14B", "2026-10-09T12:30:00Z", "2026-11-16T12:30:00Z"], ["2XI", "2026-10-10T07:30:00Z", "2026-11-21T07:30:00Z"],
  ["3XI", "2026-10-10T12:00:00Z", "2026-11-21T12:00:00Z"], ["U15A", "2026-10-12T12:30:00Z", "2026-11-17T12:30:00Z"],
  ["U13A", "2026-10-13T12:30:00Z", "2026-11-18T12:30:00Z"], ["U12A", "2026-10-14T12:30:00Z", "2026-11-19T12:30:00Z"],
  ["U15B", "2026-10-16T12:30:00Z", "2026-11-20T12:30:00Z"],
];

/** What comes next: fixtures still to be played (and tomorrow's 1XI, which --live starts). */
const AHEAD = [
  { key: "1xi-1107", team: "1XI", home: "WES", at: "2026-11-07T07:00:00Z", id: "de5e0000-0000-4000-a000-000000000201", league: true, sheets: true, live: true },
  { key: "u14a-1109", team: "U14A", home: "WES", at: "2026-11-09T12:30:00Z", id: "de5e0000-0000-4000-a000-000000000202", sheets: true, avail: true },
  { key: "u16b-1110", team: "U16B", home: "KEA", at: "2026-11-10T12:30:00Z", id: "de5e0000-0000-4000-a000-000000000203", sheets: true, lift: true },
  { key: "u15a-1111", team: "U15A", home: "WES", at: "2026-11-11T12:30:00Z", id: "de5e0000-0000-4000-a000-000000000204", avail: true },
  { key: "2xi-1112", team: "2XI", home: "KEA", at: "2026-11-12T12:30:00Z", id: "de5e0000-0000-4000-a000-000000000205" },
  { key: "u13a-1114", team: "U13A", home: "WES", at: "2026-11-14T07:00:00Z", id: "de5e0000-0000-4000-a000-000000000206" },
  { key: "1xi-1114", team: "1XI", home: "KEA", at: "2026-11-14T08:00:00Z", id: "de5e0000-0000-4000-a000-000000000207", league: true, sheets: true },
];

// ── The sides: an XI from the squad, a batting order, an attack ──
const BAT_SKILL = { batter: 1.15, keeper: 1.0, allrounder: 1.0, bowler: 0.68 };
const ROLE_ORDER = { batter: 0, keeper: 1, allrounder: 2, bowler: 3 };

function xiOf(code, team, r) {
  const squad = sideOf(code, team);
  let xi = squad.slice(0, 11);
  // A keeper on every sheet: the squad's keeper in for the eleventh man.
  if (!xi.some((b) => b.role === "keeper")) xi = [...xi.slice(0, 10), squad.find((b) => b.role === "keeper")];
  // Now and then a reserve in for a bowler or batter (not the captain).
  if (r() < 0.45) {
    const out = xi.findIndex((b, i) => i >= 3 && b.role !== "keeper" && b.id !== CAPTAIN && b.id !== U14A_BOY && b.id !== U16B_BOY);
    const inn = squad.slice(11).find((b) => !xi.includes(b) && b.role === xi[out].role) ?? null;
    if (inn) xi[out] = inn;
  }
  return xi;
}
function orderOf(xi) {
  const o = [...xi].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.squad - b.squad);
  // The 1XI captain bats at three.
  const c = o.findIndex((b) => b.id === CAPTAIN);
  if (c > 2) { const [cap] = o.splice(c, 1); o.splice(2, 0, cap); }
  return o;
}
function attackOf(xi) {
  const bowlers = xi.filter((b) => b.bowl && b.role !== "keeper")
    .sort((a, b) => (a.role === "bowler" ? 0 : 1) - (b.role === "bowler" ? 0 : 1) || a.squad - b.squad);
  return bowlers.slice(0, 6);
}

/** Play one match to its story: try seeds until the fold tells it. */
function playMatch(spec, { live = false, t0Live = 0 } = {}) {
  const homeCode = spec.home, awayCode = spec.home === "WES" ? "KEA" : "WES";
  for (let seed = 1; seed < 6000; seed++) {
    const r = rng(seed * 7919 + spec.key.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 100000);
    const xi = { [homeCode]: xiOf(homeCode, spec.team, r), [awayCode]: xiOf(awayCode, spec.team, r) };
    // Who bats first, and so the toss.
    const firstCode = r() < 0.5 ? "WES" : "KEA";
    const secondCode = firstCode === "WES" ? "KEA" : "WES";
    const wonBy = r() < 0.5 ? "home" : "away";
    const winnerCodeIsFirst = (wonBy === "home" ? homeCode : awayCode) === firstCode;
    const toss = { wonBy, decision: winnerCodeIsFirst ? "bat" : "bowl" };
    const label = (code) => (code === homeCode ? "%H%" : "%A%");
    const squadIds = (code) => orderOf(xi[code]).map((b) => ({ id: `@${b.n.toString().padStart(3, "0")}`, name: "" }));
    const bOrder = (code) => orderOf(xi[code]).map((b) => ({ id: b.id, hand: b.bat, skill: BAT_SKILL[b.role] * (b.id === CAPTAIN ? 1.75 : 1) * (0.9 + r() * 0.25) }));
    const bAttack = (code) => attackOf(xi[code]).map((b, i) => ({ id: b.id, skill: (b.role === "bowler" ? 1.1 : 0.95) * (b.id === CAPTAIN ? 1.2 : 1) * (1 - i * 0.03), spin: b.bowl === "S" }));
    const keeperOf = (code) => xi[code].find((b) => b.role === "keeper").id;
    const want = spec.win;
    const form = (code, chasing) => (want ? (code === want ? (chasing ? 1.12 : 1.06) : (chasing ? 0.86 : 0.98)) : 1) * (0.92 + r() * 0.16);
    const sideTargets = (code, map) => Object.fromEntries(Object.entries(map ?? {}).filter(([id]) => xi[code].some((b) => b.id === id)));
    const first = playInnings({
      innings: 0, idp: `ds-${spec.key}`, r, t0: 0, strength: form(firstCode, false),
      start: { battingTeam: label(firstCode), bowlingTeam: label(secondCode), teamKey: label(firstCode), bowlingTeamKey: label(secondCode),
               squad: squadIds(firstCode), bowlingSquad: squadIds(secondCode), overs: 20 },
      order: bOrder(firstCode), attack: bAttack(secondCode), fielders: xi[secondCode].map((b) => b.id), keeperId: keeperOf(secondCode),
      batTargets: sideTargets(firstCode, spec.bat), bowlTargets: sideTargets(secondCode, spec.bowl),
    });
    if (first.fold.runs < 108 || first.fold.runs > 192) continue;
    const second = playInnings({
      innings: 1, idp: `ds-${spec.key}`, r, t0: first.t + 20 * 60, strength: form(secondCode, true),
      start: { battingTeam: label(secondCode), bowlingTeam: label(firstCode), teamKey: label(secondCode), bowlingTeamKey: label(firstCode),
               squad: squadIds(secondCode), bowlingSquad: squadIds(firstCode), overs: 20, target: first.fold.runs + 1 },
      order: bOrder(secondCode), attack: bAttack(firstCode), fielders: xi[firstCode].map((b) => b.id), keeperId: keeperOf(firstCode),
      batTargets: sideTargets(secondCode, spec.bat), bowlTargets: sideTargets(secondCode === homeCode ? awayCode : homeCode, spec.bowl),
      ...(live ? { stopAt: spec.liveBalls ?? 48, seal: false } : {}),
    });
    // The story, read back from the fold.
    const chased = second.fold.runs > first.fold.runs;
    const tied = second.fold.runs === first.fold.runs;
    const winner = chased ? secondCode : firstCode;
    if (!live) {
      if (tied || (want && winner !== want)) continue;
      if (second.fold.runs < 95) continue;   // no collapse a school 1XI would remember for the wrong reasons
      if (!second.fold.complete) continue;
    } else if (second.fold.runs > first.fold.runs - 20 || second.fold.wickets > 4 || second.fold.runs < 45) continue;
    const lines = [...first.fold.batsmen, ...second.fold.batsmen];
    const wk = [...first.fold.bowlers, ...second.fold.bowlers];
    let ok = true;
    for (const [id, t] of Object.entries(spec.bat ?? {})) {
      const l = lines.find((x) => x.id === id);
      if (!l || l.runs < t.min || (t.max != null && l.runs > t.max) || (t.notOut && l.status === "out")) ok = false;
    }
    for (const [id, w] of Object.entries(spec.bowl ?? {})) {
      const b = wk.find((x) => x.id === id);
      if (!b || b.wickets < w || b.wickets > w + 1) ok = false;
    }
    if (!ok) continue;
    // Nobody else's hundred unless the story asks for one, and keep the
    // headline performances the season's.
    if (lines.some((l) => l.runs >= 95 && !(spec.bat ?? {})[l.id])) continue;
    if (wk.some((b) => b.wickets >= 5 && !(spec.bowl ?? {})[b.id])) continue;
    return { spec, seed, xi, toss, firstCode, secondCode, homeCode, awayCode, log: [...first.log, ...second.log], first: first.fold, second: second.fold, winner };
  }
  throw new Error(`demo-season: no seed tells the story of ${spec.key}`);
}

// ── SQL ──
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const U = (email) => `(ids->>${q(email)})::uuid`;
const as = (email, dev = "demo-season") => `  PERFORM app_session_begin(${U(email)}, ${q(dev)}, NULL, NULL);`;
const door = (call, what) => `  SELECT * INTO r FROM ${call};
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION '${what.replace(/'/g, "''")}: %. Nothing was changed.', r.reason; END IF;`;
const DECL = `DECLARE ids jsonb := current_setting('demo.ids')::jsonb; m uuid := nullif(current_setting('demo.m', true), '')::uuid;
        r record; d uuid; n integer; v uuid; t uuid;`;

/** The match's id into demo.m, as the owner: the demo's own fixture, or the new one. */
function setMatch(spec) {
  if (spec.existing) {
    return `SELECT set_config('demo.m', (SELECT id FROM match WHERE school_id = ${q(WES)} AND away_school_id = ${q(KEA)}
   AND team_code = ${q(spec.team)} AND starts_at = timestamptz ${q(spec.at)})::text, true);
DO $chk$ BEGIN IF nullif(current_setting('demo.m', true), '') IS NULL THEN
  RAISE EXCEPTION 'The demo''s ${spec.team} fixture of ${spec.at} is not here. Nothing was changed.'; END IF; END $chk$;`;
  }
  return `SELECT set_config('demo.m', ${q(spec.id)}, true);`;
}

/** A new fixture, as POST /api/fixtures inserts it, by the home school's director of sport. */
function fixtureSql(spec) {
  const h = SCH[spec.home], a = SCH[spec.home === "WES" ? "KEA" : "WES"];
  return `${as(em("dos", h.key))}
  INSERT INTO match (id, school_id, team_code, away_school_id, away_team_code, opponent, ground_id, starts_at, sport, format, overs, status, competition_id)
  VALUES (m, ${q(h.id)}, ${q(spec.team)}, ${q(a.id)}, ${q(spec.team)}, 'pending', ${q(h.ground)}, timestamptz ${q(spec.at)},
          'cricket', 'T20', 20, 'scheduled', NULL);`;
}

/** Officials as the officials route appoints them (the home DOS), and the person-held duties linked by the office. */
function officialsSql(spec, i) {
  const h = SCH[spec.home];
  const office = h.key === "wes" ? "registrar.wes" : "office.kea";
  const u2 = REG[i % REG.length], u3 = REG[(i + 1) % REG.length];
  const duty = (dutyName, personEmail, personName, official, panel) => `  IF NOT EXISTS (SELECT 1 FROM match_official o WHERE o.match_id = m AND o.duty = ${q(dutyName)} AND NOT o.withdrawn
                   AND (${personEmail ? `o.person_id = ${U(personEmail)}` : `o.official_id = ${q(official)}`} OR ${q(dutyName)} IN ('scorer', 'third_umpire', 'referee'))) THEN
${as(em("dos", h.key))}
    INSERT INTO match_official (match_id, school_id, duty, person_name, person_id, official_id, panel, appointed_by, appointed_at)
    VALUES (m, match_school(m), ${q(dutyName)}, ${q(personName)}, ${personEmail ? U(personEmail) : "NULL"}, ${official ? q(official) : "NULL"}, ${q(panel)}, app_user_id(), now())
    RETURNING id INTO d;
    IF d IS NULL THEN RAISE EXCEPTION 'Could not appoint the ${dutyName} on ${spec.key}. Nothing was changed.'; END IF;${personEmail ? `
  ${as(`${office}@example.invalid`).trim()}
    SELECT * INTO r FROM duty_link(d);
    IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The office could not link the ${dutyName} duty on ${spec.key}: %. Nothing was changed.', r.reason; END IF;` : ""}
  END IF;`;
  return [
    duty("umpire", em("official", h.key), `${h.code} Umpire (demo)`, null, null),
    duty("umpire", null, u2.name, u2.id, "KZN school umpires (demo)"),
    duty("third_umpire", null, u3.name, u3.id, "KZN school umpires (demo)"),
    duty("referee", null, REFEREE.name, REFEREE.id, "Match referee (demo)"),
    duty("scorer", em("scorer1", h.key), `${h.code} Scorer One (demo)`, null, null),
  ].join("\n");
}

const PITCHES = [
  { surface: "firm", grass: "light", bounce: "even", pace: "medium", favours: "batting", br: 6, pr: 6, outfield: "fast", note: "Rolled Thursday, mown to 6 mm. True bounce; quick outfield." },
  { surface: "hard", grass: "bare", bounce: "steep", pace: "quick", favours: "seam", br: 8, pr: 7, outfield: "fast", note: "Dry and hard after a hot week. Carry for the quicks early." },
  { surface: "firm", grass: "covered", bounce: "even", pace: "medium", favours: "even", br: 5, pr: 5, outfield: "medium", note: "Covered overnight. Expected to turn a little later." },
  { surface: "soft", grass: "green", bounce: "low", pace: "slow", favours: "spin", br: 4, pr: 3, outfield: "slow", note: "Rain on Tuesday; outfield heavy. Ball stopping on the batters." },
];
const WEATHER = [
  ["Sunny, light breeze", 27, 55, 12, "NE", 9, 5], ["Partly cloudy", 24, 68, 18, "E", 7, 20], ["Hot and humid", 31, 78, 8, "N", 11, 10],
  ["Overcast, mild", 21, 72, 15, "SW", 4, 35],
];
function conditionsSql(spec, i) {
  const h = SCH[spec.home];
  const p = PITCHES[i % PITCHES.length], w = WEATHER[i % WEATHER.length];
  return `${as(em("dos", h.key))}
  INSERT INTO match_pitch_report (match_id, school_id, surface, grass, bounce, pace, favours, covers_on, notes, bounce_rating, pace_rating, outfield, reported_by, reported_at)
  VALUES (m, match_school(m), ${q(p.surface)}, ${q(p.grass)}, ${q(p.bounce)}, ${q(p.pace)}, ${q(p.favours)}, false, ${q(p.note)}, ${p.br}, ${p.pr}, ${q(p.outfield)}, app_user_id(), now())
  ON CONFLICT (match_id) DO NOTHING;
  INSERT INTO match_weather (match_id, condition, temp_c, humidity_pct, wind_kph, wind_dir, uv_index, rain_chance_pct, forecast, playable, observed_at)
  VALUES (m, ${q(w[0])}, ${w[1]}, ${w[2]}, ${w[3]}, ${q(w[4])}, ${w[5]}, ${w[6]}, 'Demo forecast: settled through the afternoon.', true, now())
  ON CONFLICT (match_id) DO NOTHING;`;
}

/** Both sides' sheets, each named by its own coach through the team-sheet route's own check. */
function sheetsSql(spec, xi) {
  const out = [];
  for (const side of ["home", "away"]) {
    const code = side === "home" ? spec.home : (spec.home === "WES" ? "KEA" : "WES");
    const s = SCH[code];
    const order = orderOf(xi[code]);
    const ids = order.map((b) => q(b.id)).join(", ");
    out.push(`  IF (SELECT count(*) FROM match_squad q WHERE q.match_id = m AND q.side = ${q(side)} AND NOT q.withdrawn) < 11 THEN
${as(em("coach", s.key, spec.team))}
    SELECT count(*) INTO n FROM match mt CROSS JOIN unnest(ARRAY[${ids}]::uuid[]) p(id) JOIN player pl ON pl.id = p.id
     WHERE mt.id = m AND pl.school_id = ${side === "away" ? "mt.away_school_id" : "mt.school_id"}
       AND app_can('team.select', pl.school_id, ${side === "away" ? "mt.away_team_code" : "mt.team_code"}, p.id, mt.id);
    IF n <> 11 THEN RAISE EXCEPTION '${s.code} ${spec.team} coach may not name his XI for ${spec.key} (% of 11). Nothing was changed.', n; END IF;
    UPDATE match_squad SET withdrawn = true WHERE match_id = m AND side = ${q(side)} AND NOT withdrawn;
    INSERT INTO match_squad (match_id, player_id, side, batting_no, twelfth, withdrawn, selected_by, selected_at)
    SELECT m, p.id, ${q(side)}, p.o, false, false, app_user_id(), now() FROM unnest(ARRAY[${ids}]::uuid[]) WITH ORDINALITY p(id, o)
    ON CONFLICT (match_id, player_id) DO UPDATE SET side = excluded.side, batting_no = excluded.batting_no, twelfth = false,
       withdrawn = false, selected_by = excluded.selected_by, selected_at = excluded.selected_at;
  END IF;`);
  }
  return out.join("\n");
}

const device = (spec) => `demo-season-pad-${SCH[spec.home].key}`;
const scorerOf = (spec) => em("scorer1", SCH[spec.home].key);

/** The toss, the pen and the conditions, as the scorer's pad takes them before the first ball. */
function padOpensSql(spec, toss, { claim = true } = {}) {
  return `${as(scorerOf(spec), device(spec))}
  INSERT INTO match_toss (match_id, school_id, won_by, decision, called_by, called_at)
  VALUES (m, match_school(m), ${q(toss.wonBy)}, ${q(toss.decision)}, app_user_id(), now())
  ON CONFLICT (match_id) DO UPDATE SET won_by = excluded.won_by, decision = excluded.decision, called_by = excluded.called_by, called_at = excluded.called_at;
${claim ? `  SELECT x.ok, x.reason INTO r FROM scoring_claim(m, ${q(device(spec))}) x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The scorer could not take the pen on ${spec.key}: %. Nothing was changed.', r.reason; END IF;
` : ""}  SELECT x.fixed AS ok, x.reason INTO r FROM match_conditions_fix(m) x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The playing conditions could not be fixed on ${spec.key}: %. Nothing was changed.', r.reason; END IF;`;
}

const COLS = ["ball_type", "value", "shot", "seg", "zone", "striker_id", "non_striker_id", "bowler_id", "dismissed_id", "dismissal",
              "theta", "radius", "placement_source", "close_position", "capture_profile"];
const PID = new Set(["striker_id", "non_striker_id", "bowler_id", "dismissed_id"]);
const tok = (s) => s.replace(/"de300000-0000-4000-8000-000000000(\d{3})"/g, '"@$1"');

/** The events, compact: [seq, innings, kind, seconds from the start, payload, …COLS]. */
function encodeEvents(log) {
  return log.map((ev, i) => {
    const row = toRow(ev);
    const cells = [i + 1, ev.innings, row.kind, Math.round(ev.clientTs), JSON.parse(tok(JSON.stringify(row.payload ?? {}))),
      ...COLS.map((c) => (PID.has(c) && row[c] ? n3(row[c]) : row[c] ?? null))];
    while (cells.length > 5 && cells[cells.length - 1] == null) cells.pop();
    return cells;
  });
}

/** The ball log, as the owner, as the pad's outbox would have sent it. `t0` is an SQL timestamptz expression. */
function eventsSql(spec, log, t0) {
  const json = JSON.stringify(encodeEvents(log));
  const pidOf = (i) => `CASE WHEN e->>${i} IS NULL THEN NULL ELSE ('de300000-0000-4000-8000-000000000' || (e->>${i}))::uuid END`;
  const sq = (k) => `(SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) ORDER BY x.o), '[]'::jsonb)
                FROM jsonb_array_elements(a.pl0->'${k}') WITH ORDINALITY x(v, o) JOIN player p ON p.id = (x.v->>'id')::uuid)`;
  return `INSERT INTO ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq,
                        client_ts, server_ts, kind, payload, ${COLS.join(", ")})
SELECT mt.id, mt.school_id, (e->>0)::int, 1, (e->>1)::smallint,
       (current_setting('demo.ids')::jsonb->>${q(scorerOf(spec))})::uuid, ${q(device(spec))}, b.pl->>'id', (e->>0)::int,
       (${t0}) + make_interval(secs => (e->>3)::int), (${t0}) + make_interval(secs => (e->>3)::int + 2),
       e->>2, b.pl, e->>5, (e->>6)::smallint, e->>7, (e->>8)::smallint, e->>9, ${pidOf(10)}, ${pidOf(11)}, ${pidOf(12)}, ${pidOf(13)},
       e->>14, (e->>15)::smallint, (e->>16)::numeric, e->>17, e->>18, e->>19
  FROM match mt
 CROSS JOIN jsonb_array_elements($ev$${json}$ev$::jsonb) e
 CROSS JOIN LATERAL (SELECT replace(replace(replace((e->4)::text, '"%H%"', to_jsonb(mt.team_code)::text), '"%A%"', to_jsonb(mt.opponent)::text),
                                    '"@', '"de300000-0000-4000-8000-000000000')::jsonb AS pl0) a
 CROSS JOIN LATERAL (SELECT CASE WHEN e->>2 = 'innings_start'
                                 THEN a.pl0 || jsonb_build_object('squad', ${sq("squad")}, 'bowlingSquad', ${sq("bowlingSquad")})
                                 ELSE a.pl0 END AS pl) b
 WHERE mt.id = current_setting('demo.m')::uuid
 ORDER BY (e->>0)::int;`;
}

/** Player of the Match working, as potm-api.mjs builds it, from the same log. */
function working(played, sideCode) {
  const rows = played.log.map((ev, i) => ({ ...toRow(ev), seq: i + 1, epoch: 1, idempotency_key: ev.id }));
  const evs = rows.map(fromRow);
  const ids = orderOf(played.xi[sideCode]).map((b) => b.id);
  const facts = deriveFacts(evs, ids, { ctx: {} });
  const figures = new Map(matchFigures(facts, ids).map((f) => [f.playerId, figuresWords(f)]));
  const suggestions = suggestPlayerOfMatch(facts, ids).map((x) => ({ playerId: x.playerId, figures: x.figures ?? figures.get(x.playerId) }));
  return { figures, suggestions, head: rows.length };
}
const derived = (w, playerId, key = "awardee") => JSON.stringify({ version: 1, basis: POTM_BASIS, factsVersion: FACTS_VERSION, headSeq: w.head,
  suggestions: w.suggestions.map((x) => ({ playerId: x.playerId, figures: x.figures })),
  [key]: { playerId, figures: w.figures.get(playerId) ?? "Did not bat or bowl" } });

/** After the last ball: finished, published, the trip, the result confirmed, Player of the Match. */
function afterSql(played) {
  const spec = played.spec, h = SCH[spec.home], a = SCH[spec.home === "WES" ? "KEA" : "WES"];
  const parts = [];
  parts.push(`${as(scorerOf(spec), device(spec))}
  SELECT x.ok, x.reason INTO r FROM match_finalise(m) x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The scorer could not finish ${spec.key}: %. Nothing was changed.', r.reason; END IF;
`);
  for (const [side, s] of [["home", h], ["away", a]]) {
    parts.push(`${as(em("dos", s.key))}
${door(`fixture_publish(m, ${q(side)}, true)`, `${s.code} could not publish its side of ${spec.key}`)}`);
  }
  // The home side's trip, booked by its transport coordinator, marked by its driver.
  parts.push(`${as(em("transport", h.key))}
  SELECT tr.id INTO t FROM trip tr WHERE tr.match_id = m AND tr.cancelled_at IS NULL LIMIT 1;
  IF t IS NULL THEN
  INSERT INTO trip (match_id, school_id, vehicle_id, driver_id, depart_at, return_at, pickup, seats_taken, notes, arranged_by, arranged_at)
  SELECT m, match_school(m), (SELECT v.id FROM vehicle v WHERE v.school_id = ${q(h.id)} AND v.registration = ${q(`${h.code} DEMO 1`)}),
         ${U(em("driver", h.key))}, mt.starts_at - interval '75 minutes', mt.starts_at + interval '4 hours',
         ${q(h.code === "WES" ? "The junior school gate" : "The Kearsney chapel car park")}, 15, 'Demo season: the side to the ground and home.', app_user_id(), now()
    FROM match mt WHERE mt.id = m
  RETURNING id INTO t;
  IF t IS NULL THEN RAISE EXCEPTION 'The transport coordinator could not book the trip on ${spec.key}. Nothing was changed.'; END IF;
  END IF;
${as(em("driver", h.key))}
${door("trip_mark(t, 'departed')", `The driver could not mark the trip on ${spec.key} departed`)}
${door("trip_mark(t, 'arrived')", `The driver could not mark the trip on ${spec.key} arrived`)}`);
  // The official result: the organiser for a league fixture, the home director for a friendly.
  if (spec.league) parts.push(`${as("league@example.invalid")}
${door(`match_conditions_refix_table(m, (SELECT cs.id FROM condition_set cs WHERE cs.competition_id = ${q(LEAGUE)} AND cs.status = 'published' ORDER BY cs.version DESC LIMIT 1),
         'The league''s points for 2026, confirmed in its rules, applied to a fixture played before they were published.')`, `The league could not re-fix the table figures of ${spec.key}`)}`);
  parts.push(`${as(spec.league ? "league@example.invalid" : em("dos", h.key))}
  SELECT x.ok, x.reason INTO r FROM match_result_confirm(m) x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The result of ${spec.key} could not be confirmed: %. Nothing was changed.', r.reason; END IF;`);
  // Player of the Match.
  for (const who of spec.potm ?? []) {
    if (who === "nominate") {
      const w = working(played, "WES");
      const nominee = w.suggestions.find((x) => x.playerId !== CAPTAIN)?.playerId;
      parts.push(`${as("pupil.wes.1xi@example.invalid")}
  SELECT x.ok, x.reason, x.nomination_id AS id INTO r FROM captain_nominate(m, ${q(nominee)}, $d$${derived(w, nominee, "nominee")}$d$::jsonb) x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The captain could not nominate on ${spec.key}: %. Nothing was changed.', r.reason; END IF;
  v := r.id;
${as(em("coach", "wes", spec.team))}
${door(`match_nomination_decide(v, 'confirm', NULL, $d$${derived(w, nominee)}$d$::jsonb)`, `The coach could not confirm the captain's nomination on ${spec.key}`)}`);
      continue;
    }
    const w = working(played, who);
    const pickId = w.suggestions[0]?.playerId;
    if (!pickId) continue;
    parts.push(`${as(em("coach", SCH[who].key, spec.team))}
${door(`match_award(m, ${q(pickId)}, $d$${derived(w, pickId)}$d$::jsonb)`, `The ${who} coach could not award Player of the Match on ${spec.key}`)}`);
  }
  return parts.join("\n");
}

function matchSql(played, i) {
  const spec = played.spec;
  const t0 = `timestamptz ${q(spec.at)}`;
  const f = played.first, s = played.second;
  const words = `${played.firstCode} ${f.runs}/${f.wickets}, ${played.secondCode} ${s.runs}/${s.wickets}: ${played.winner} won`;
  return `
-- ── ${spec.key}: ${spec.home === "WES" ? "Westville v Kearsney at Westville Main" : "Kearsney v Westville at Kearsney Main"} · ${words} ──
RESET ROLE;
${setMatch(spec)}
SET LOCAL ROLE scrbrd_app;
DO $before$ ${DECL}
BEGIN
${spec.existing ? "" : fixtureSql(spec)}
${spec.league ? `${as(em("dos", SCH[spec.home].key))}
  UPDATE match SET competition_id = ${q(LEAGUE)} WHERE id = m AND competition_id IS DISTINCT FROM ${q(LEAGUE)};` : ""}
${officialsSql(spec, i)}
${conditionsSql(spec, i)}
${sheetsSql(spec, played.xi)}
${padOpensSql(spec, played.toss)}
END $before$;
RESET ROLE;
${eventsSql(spec, played.log, t0)}
SET LOCAL ROLE scrbrd_app;
DO $after$ ${DECL}
BEGIN
${afterSql(played)}
END $after$;
RESET ROLE;
DO $verified$ BEGIN
  IF NOT match_verified(current_setting('demo.m')::uuid) THEN RAISE EXCEPTION '${spec.key} is finished but not verified. Nothing was changed.'; END IF;
END $verified$;`;
}

// ── The file's frame ──
const ID_EMAILS = (() => {
  const out = new Set(["registrar@example.invalid", "registrar.wes@example.invalid", "office.kea@example.invalid", "league@example.invalid", "platform@example.invalid",
                       "pupil.wes.1xi@example.invalid", "pupil.wes.u14a@example.invalid", "pupil.wes.u16b@example.invalid"]);
  for (const s of ["wes", "kea"]) {
    for (const r of ["principal", "dos", "dso", "scorer1", "scorer2", "official", "transport", "driver"]) out.add(em(r, s));
    for (const t of ["1XI", "2XI", "3XI", "U12A", "U13A", "U14A", "U14B", "U15A", "U15B", "U16A", "U16B"]) {
      out.add(em("coach", s, t)); out.add(em("manager", s, t));
    }
  }
  for (const b of ROSTER) out.add(`parent.${String(b.n).padStart(3, "0")}@example.invalid`);
  return [...out];
})();

function frame(title, body, { guard, check }) {
  return `-- SCRBRD demo copy · ${title}
-- Generated by tools/demo-season.mjs. FOR THE scrbrd-demo PROJECT ONLY. Every person in it is invented.
-- One transaction. Refuses to run outside the demo, or twice.
BEGIN;
SET LOCAL statement_timeout = 0;

DO $demo_only$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_user WHERE email = 'coach.wes.1xi@example.invalid')
     OR (SELECT count(*) FROM player WHERE id::text LIKE 'de300000-0000-4000-8000-%') <> 330 THEN
    RAISE EXCEPTION 'This is not the demo database (the cast and the 330 players are missing). Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM app_user WHERE email NOT LIKE '%@example.invalid') THEN
    RAISE EXCEPTION 'This database holds a real person''s account, so it is not the demo copy. Nothing was changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE name = '144_captain_nomination.sql') THEN
    RAISE EXCEPTION 'db/144 is not in this database. Nothing was changed.';
  END IF;
${guard}
END $demo_only$;

DO $grant$
BEGIN
  EXECUTE format('GRANT scrbrd_app TO %I WITH SET TRUE', current_user);
EXCEPTION
  WHEN duplicate_object OR invalid_grant_operation THEN NULL;
  WHEN syntax_error THEN EXECUTE format('GRANT scrbrd_app TO %I', current_user);
END $grant$;

-- Who is who, read once as the owner: the cast's accounts by address.
SELECT set_config('demo.ids', (SELECT jsonb_object_agg(email, id)::text FROM app_user WHERE email IN (${ID_EMAILS.map(q).join(", ")})), true);
${body}

RESET ROLE;
DO $check$
BEGIN
${check}
END $check$;
COMMIT;
`;
}

// ── Once, at the top of the first file: the ground, the league, the vehicles, the listings ──
function setupSql() {
  return `
SET LOCAL ROLE scrbrd_app;
DO $setup$ ${DECL}
BEGIN
  -- Kearsney's own ground, added by its director of sport (facility.manage).
${as(em("dos", "kea"))}
  INSERT INTO ground (id, school_id, name, surface, end_a_name, end_b_name)
  VALUES (${q(KEA_MAIN)}, ${q(KEA)}, 'Kearsney Main', 'turf', 'Chapel End', 'Pavilion End');

  -- Kearsney's 1XI into the KZN Schools T20 League: the league's administrator
  -- invites, Kearsney's director of sport accepts (db/67), Division 1.
${as("league@example.invalid")}
  SELECT x.ok, x.reason, x.entrant_id AS id INTO r FROM competition_entrant_invite(${q(LEAGUE)}, ${q(KEA)}, '1XI', 'Kearsney 1st XI') x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not invite Kearsney''s 1XI: %. Nothing was changed.', r.reason; END IF;
  v := r.id;
${as(em("dos", "kea"))}
${door("competition_entrant_respond(v, true)", "Kearsney could not accept the league's invitation")}
${as("league@example.invalid")}
  UPDATE competition_entrant SET division_id = ${q(D1)} WHERE id = v;

  -- The league's points, confirmed from its rules and published by its
  -- administrator (POST /api/competitions/:id/playing-conditions, …/values,
  -- …/publish). A version takes effect from tomorrow (db/61: never back-dated),
  -- so the fixtures already played take it by the designed path for a played
  -- match: the administrator re-fixes each one's table figures from it, with a
  -- reason (match_conditions_refix_table(), db/69), before confirming its result.
  -- The table is then computed from the results rather than typed.
  SELECT x.ok, x.reason, x.set_id AS id INTO r FROM condition_set_draft(${q(LEAGUE)}, 'KZN Schools T20 League 2026 (demo)', sa_today() + 1) x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The league could not draft its playing conditions: %. Nothing was changed.', r.reason; END IF;
  t := r.id;
${[["points.win", 4], ["points.loss", 0], ["points.tie", 2], ["points.draw", 2], ["points.no_result", 2], ["points.abandoned", 2], ["nrr.method", "standard"]].map(([k, v], j) =>
  door(`condition_value_enter(t, ${q(k)}, '', ${q(JSON.stringify(v))}::jsonb, 'confirmed', 'League rules 2026 (demo)', '4.${j + 1}', date '2026-09-15', NULL)`, `The league could not enter ${k}`)).join("\n")}
${door("condition_set_publish(t)", "The league could not publish its playing conditions")}

  -- Kearsney's minibus, as POST /api/vehicles adds it (Westville's came with the cast).
${as(em("transport", "kea"))}
  INSERT INTO vehicle (school_id, registration, description, kind, capacity, condition, next_service_on, active, notes,
                       insurance_expires_on, roadworthy_expires_on)
  VALUES (${q(KEA)}, 'KEA DEMO 1', 'Demo minibus, 22 seats', 'minibus', 22, 'good', NULL, true, 'Demo season', date '2027-03-31', date '2027-01-31')
  ON CONFLICT DO NOTHING;

  -- The October fixtures this season does not play, rearranged by Westville's director of sport.
${as(em("dos", "wes"))}
${REARRANGED.map(([team, was, now]) => `  UPDATE match SET starts_at = timestamptz ${q(now)}
   WHERE school_id = ${q(WES)} AND away_school_id = ${q(KEA)} AND team_code = ${q(team)} AND starts_at = timestamptz ${q(was)} AND status = 'scheduled';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Could not rearrange the ${team} fixture of ${was} (% found). Nothing was changed.', n; END IF;`).join("\n")}

  -- Hilton's two seed fixtures still open in October, against schools not on
  -- SCRBRD, called off by Hilton's office (the fixture route, status abandoned):
  -- one never started, one stopped after sixteen balls and never resumed.
${as("registrar@example.invalid")}
  UPDATE match SET status = 'abandoned' WHERE id IN ('77777777-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000003') AND status = 'scheduled';

  -- Both schools list their matches on the SCRBRD home page (Settings → School).
${as(em("dos", "wes"))}
${door(`public_listing_set(${q(WES)}, true)`, "Westville could not list its matches")}
${as(em("dos", "kea"))}
${door(`public_listing_set(${q(KEA)}, true)`, "Kearsney could not list its matches")}
END $setup$;`;
}

// ── Then: consents, the news, what's next ──
function consentsSql() {
  // A third of the Westville boys, the 1XI captain among them: every third
  // squad number, and the captain. Recorded by the office from a signed form.
  const boys = ROSTER.filter((b) => b.code === "WES" && (b.id === CAPTAIN || b.squad % 3 === 1));
  return `
SET LOCAL ROLE scrbrd_app;
DO $consent$ ${DECL}
BEGIN
${as("registrar.wes@example.invalid")}
${boys.map((b) => `  SELECT * INTO r FROM public_name_consent_set(${q(b.id)}, true, 'public-names-2026-10', ${U(`parent.${String(b.n).padStart(3, "0")}@example.invalid`)}, 'Public names form (demo)', date '2026-10-20');
  IF NOT coalesce(r.ok, false) THEN
    IF r.reason = 'adult_consents_for_himself' THEN${b.id === CAPTAIN ? `
      -- Eighteen: the captain answers for himself, in his own app.
${as("pupil.wes.1xi@example.invalid")}
      SELECT * INTO r FROM public_name_consent_set(${q(b.id)}, true, 'public-names-2026-10', NULL, NULL, NULL);
      IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The captain could not give his own public-name answer: %. Nothing was changed.', r.reason; END IF;
${as("registrar.wes@example.invalid")}` : `
      NULL;   -- eighteen: his answer is his own to give, and he has no account in the demo`}
    ELSE RAISE EXCEPTION 'The office could not record the public-name answer for boy ${b.n}: %. Nothing was changed.', r.reason;
    END IF;
  END IF;`).join("\n")}
END $consent$;`;
}

function newsSql(played) {
  const by = Object.fromEntries(played.map((p) => [p.spec.key, p]));
  const posts = [
    ["1xi-1017", "1XI", "A hundred, and a win", "The 1st XI beat Kearsney by %MARGIN% in the league. The captain's unbeaten hundred is a new school record for the side. Well played, all."],
    ["u14a-1021", "U14A", "A first fifty at Kearsney", "The U14A won at Kearsney Main on Wednesday, built on a first fifty from our opener. Nets on Monday as usual."],
    ["1xi-1031", "1XI", "Five wickets, and still unbeaten", "The 1st XI won at Kearsney on Saturday; the captain took five. Three from three in the league. Home to Kearsney on the 7th."],
    ["u15a-1026", "U15A", "A U15 hundred", "A hundred at Kearsney Main and a win to go with it. Training moves to Tuesday this week."],
  ];
  return `
SET LOCAL ROLE scrbrd_app;
DO $news$ ${DECL}
BEGIN
${posts.filter(([k]) => by[k]).map(([k, team, title, body]) => {
    const p = by[k]; const margin = p.winner === p.firstCode ? `${p.first.runs - p.second.runs} runs` : `${10 - p.second.wickets} wickets`;
    return `  PERFORM set_config('demo.m', (SELECT id FROM match WHERE ${p.spec.existing ? `school_id = ${q(WES)} AND away_school_id = ${q(KEA)} AND team_code = ${q(team)} AND starts_at = timestamptz ${q(p.spec.at)}` : `id = ${q(p.spec.id)}`})::text, true);
${as(em("coach", "wes", team))}
  INSERT INTO news_post (scope, school_id, team_code, competition_id, title, body, published_at, urgency, kind, fixture_id)
  VALUES ('team', ${q(WES)}, ${q(team)}, NULL, ${q(title)}, ${q(body.replace("%MARGIN%", margin))}, now(), 'low', 'post', NULL);`;
  }).join("\n")}
END $news$;`;
}

function aheadSql() {
  const parts = [];
  for (const [i, spec] of AHEAD.entries()) {
    const h = SCH[spec.home], aw = SCH[spec.home === "WES" ? "KEA" : "WES"];
    const r = rng(1000 + i);
    const xi = { [spec.home]: xiOf(spec.home, spec.team, r), [aw.code]: xiOf(aw.code, spec.team, r) };
    parts.push(`
-- ── Ahead: ${spec.key} ──
RESET ROLE;
SELECT set_config('demo.m', ${q(spec.id)}, true);
SET LOCAL ROLE scrbrd_app;
DO $ahead$ ${DECL}
BEGIN
${fixtureSql(spec)}
${spec.league ? `${as(em("dos", h.key))}
  UPDATE match SET competition_id = ${q(LEAGUE)} WHERE id = m;` : ""}
${officialsSql(spec, i + 2)}
${spec.live ? conditionsSql(spec, 0) : ""}
${spec.sheets ? sheetsSql(spec, xi) : ""}
${spec.sheets ? [["home", h], ["away", aw]].map(([side, s]) => `${as(em("dos", s.key))}
${door(`fixture_publish(m, ${q(side)}, true)`, `${s.code} could not publish its side of ${spec.key}`)}`).join("\n") : ""}
${spec.live || spec.sheets ? `${as(em("transport", h.key))}
  INSERT INTO trip (match_id, school_id, vehicle_id, driver_id, depart_at, return_at, pickup, seats_taken, notes, arranged_by, arranged_at)
  SELECT m, match_school(m), (SELECT v.id FROM vehicle v WHERE v.school_id = ${q(h.id)} AND v.registration = ${q(`${h.code} DEMO 1`)}),
         ${U(em("driver", h.key))}, mt.starts_at - interval '75 minutes', mt.starts_at + interval '4 hours',
         ${q(h.code === "WES" ? "The junior school gate" : "The Kearsney chapel car park")}, 15, 'Demo season', app_user_id(), now()
    FROM match mt WHERE mt.id = m;` : ""}
${spec.avail ? availabilitySql(spec, xi) : ""}
${spec.lift ? liftSql(spec) : ""}
END $ahead$;`);
  }
  return parts.join("\n");
}

/** Availability: most of the Westville side answered by their parents, two by the coach, one doubtful. */
function availabilitySql(spec, xi) {
  const wes = sideOf("WES", spec.team);
  return wes.slice(0, 13).map((b, i) => {
    const byParent = i % 5 !== 4;
    const status = i === 6 ? "doubtful" : i === 12 ? "unavailable" : "available";
    const kind = status === "unavailable" ? "'academic'" : status === "doubtful" ? "'illness'" : "NULL";
    const note = status === "unavailable" ? "'Exam that afternoon (demo).'" : status === "doubtful" ? "'A cold; will know by Monday (demo).'" : "NULL";
    return `${as(byParent ? `parent.${String(b.n).padStart(3, "0")}@example.invalid` : em("coach", "wes", spec.team))}
  INSERT INTO match_availability (match_id, player_id, school_id, status, reason_kind, note, declared_by, declared_at)
  VALUES (m, ${q(b.id)}, ${q(WES)}, ${q(status)}, ${kind}, ${note}, app_user_id(), now())
  ON CONFLICT (match_id, player_id) DO UPDATE SET status = excluded.status, reason_kind = excluded.reason_kind,
     note = excluded.note, declared_by = excluded.declared_by, declared_at = now();`;
  }).join("\n");
}

/** A parent of the U16B side offers a lift to Kearsney (db/70: declaration, then the offer). */
function liftSql(spec) {
  const parent = "parent.061@example.invalid";
  return `${as(parent)}
  -- Her number on her son's card first (POST /api/players/:id/contacts): the lift club rings that one.
  INSERT INTO emergency_contact (player_id, priority, name, relationship, phone, phone_alt, email, note)
  VALUES (${q(U16B_BOY)}, 1, coalesce((SELECT u.name FROM app_user u WHERE u.id = app_user_id()), 'Parent (demo)'), 'guardian',
          '+27 82 000 0061', NULL, ${q(parent)}, 'Demo number.')
  RETURNING id INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'The parent could not add her number to her son''s card. Nothing was changed.'; END IF;
  SELECT x.ok, x.reason INTO r FROM lift_driver_declare(${q(WES)}, 'Silver hatchback (demo)', 'ND 123 456', 3, true, true, true, true, true, v) x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The parent could not declare himself a lift driver: %. Nothing was changed.', r.reason; END IF;
  SELECT x.ok, x.reason INTO r FROM lift_offer_create(m, 'out', 3, 'school', (SELECT mt.starts_at - interval '75 minutes' FROM match mt WHERE mt.id = m),
                                                       'From the junior school gate (demo).') x;
  IF NOT coalesce(r.ok, false) THEN RAISE EXCEPTION 'The parent could not offer a lift on ${spec.key}: %. Nothing was changed.', r.reason; END IF;`;
}

// ── Build ──
if (!LIVE) {
  const played = SEASON.map((s) => playMatch(s));
  for (const p of played) {
    const f = p.first, s = p.second;
    console.log(`${p.spec.key.padEnd(10)} seed ${String(p.seed).padStart(4)}  ${p.firstCode} ${f.runs}/${f.wickets} (${Math.floor(f.balls / 6)}.${f.balls % 6})  ${p.secondCode} ${s.runs}/${s.wickets} (${Math.floor(s.balls / 6)}.${s.balls % 6})  ${p.winner} won  ${p.log.length} events`);
  }
  // Files of about a megabyte, each one transaction, in order.
  const chunks = [];
  let cur = [], size = 0;
  for (const [i, p] of played.entries()) {
    const sql = matchSql(p, i);
    if ((size + sql.length > 1_200_000 || cur.length >= 4) && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push({ p, sql }); size += sql.length;
  }
  if (cur.length) chunks.push(cur);
  const files = [];
  const keyOf = (p) => `ds-${p.spec.key}-0-1`;
  chunks.forEach((chunk, k) => {
    const lastFile = k === chunks.length - 1;
    const prev = k > 0 ? chunks[k - 1].at(-1).p : null;
    const guard = `  IF EXISTS (SELECT 1 FROM ball_event WHERE idempotency_key = ${q(keyOf(chunk[0].p))}) THEN
    RAISE EXCEPTION 'This part of the demo season (file ${k + 1}) is already here. Nothing was changed.';
  END IF;${prev ? `
  IF NOT EXISTS (SELECT 1 FROM ball_event WHERE idempotency_key = ${q(keyOf(prev))}) THEN
    RAISE EXCEPTION 'Paste demo-season-${k}.sql first. Nothing was changed.';
  END IF;` : ""}`;
    const check = chunk.map(({ p }) => `  IF NOT EXISTS (SELECT 1 FROM ball_event WHERE idempotency_key = ${q(keyOf(p))}) THEN
    RAISE EXCEPTION 'The demo season is incomplete (${p.spec.key}). Rolled back.'; END IF;`).join("\n");
    let body = (k === 0 ? setupSql() : "") + chunk.map((c) => c.sql).join("\n");
    if (lastFile) body += consentsSql() + newsSql(played) + aheadSql();
    const name = `demo-season-${k + 1}.sql`;
    const text = frame(`the demo season, part ${k + 1} of ${chunks.length}`, body, { guard, check });
    writeFileSync(join(outDir, name), text);
    files.push(`${name} ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB, ${chunk.length} matches`);
  });
  console.log(files.join("\n"));
} else {
  // ── Tomorrow's 1XI, started 90 minutes before the paste ──
  const spec = { ...AHEAD.find((a) => a.live), win: null, liveBalls: 48, potm: [] };
  const played = playMatch(spec, { live: true });
  const f = played.first, s = played.second;
  console.log(`live 1XI: ${played.firstCode} ${f.runs}/${f.wickets} sealed; ${played.secondCode} ${s.runs}/${s.wickets} after ${Math.floor(s.balls / 6)}.${s.balls % 6}, ${played.log.length} events, seed ${played.seed}`);
  // The clock: the last ball about two minutes before the paste.
  const lastT = played.log.at(-1).clientTs;
  const t0 = `(now() - make_interval(secs => ${Math.round(lastT) + 120}))`;
  const body = `
RESET ROLE;
SELECT set_config('demo.m', ${q(spec.id)}, true);
SET LOCAL ROLE scrbrd_app;
DO $before$ ${DECL}
BEGIN
  -- The fixture moves to the time it started, and goes live (the fixture route, by the director of sport).
${as("dos.wes@example.invalid")}
  UPDATE match SET starts_at = date_bin('5 minutes', ${t0}, timestamptz '2000-01-01') WHERE id = m;
  UPDATE match SET status = 'live' WHERE id = m;
${as("transport.wes@example.invalid")}
  UPDATE trip SET depart_at = (SELECT mt.starts_at - interval '75 minutes' FROM match mt WHERE mt.id = m),
                  return_at = (SELECT mt.starts_at + interval '4 hours' FROM match mt WHERE mt.id = m) WHERE match_id = m;
${padOpensSql(spec, played.toss, { claim: false })}
END $before$;
RESET ROLE;
${eventsSql(spec, played.log, t0)}
-- Nobody holds the pen: scorer1.wes's own pad takes it (scoring_claim(), epoch 1,
-- the epoch these events carry) when he opens the match, and scores on.`;
  const guard = `  IF NOT EXISTS (SELECT 1 FROM match WHERE id = ${q(spec.id)}) THEN
    RAISE EXCEPTION 'Tomorrow''s 1XI fixture is not here: paste the demo season first. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM ball_event WHERE match_id = ${q(spec.id)}) THEN
    RAISE EXCEPTION 'The live match has already been started here. Nothing was changed.';
  END IF;`;
  const check = `  IF (SELECT count(*) FROM ball_event WHERE match_id = ${q(spec.id)}) <> ${played.log.length} THEN
    RAISE EXCEPTION 'The live match is incomplete. Rolled back.'; END IF;`;
  const text = frame("tomorrow's live 1XI (Westville v Kearsney)", body, { guard, check });
  writeFileSync(join(outDir, "demo-live.sql"), text);
  console.log(`demo-live.sql ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`);
}
