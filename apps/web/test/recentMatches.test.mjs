/**
 * The coach's recent matches (pilot item 5; lib/recentMatches.js): who is
 * offered the card (the cockpit's gate, by capability, never a guardian or a
 * pupil), which matches it covers, our boys only (D8), the sums, the ties,
 * the thirty-ball floor on a rate, a correction moving the figures, and the
 * never-list over the module. Hand-built folds and result reads, no DOM, no
 * database, no clock.
 *
 * The browser walk (tools/smoke-browser-cockpit.mjs) holds the screen to this.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/recentMatches.test.mjs
 */
import { readFileSync } from "node:fs";
import { deriveMatch, inningsStart, batters, bowler, ball, voidEvent, BALL_TYPE } from "@scrbrd/scoring";
import { FORBIDDEN_FIELDS, NEVER_ON_THE_COCKPIT, OTHER_SIDE_IDS } from "../src/lib/cockpitNever.js";
import { COMPARE_FLOOR } from "../src/lib/compare.js";
import { battingWords, bowlingWords, insights, leaders, matchSummary, placedInnings, recentSides, totalWords, RECENT_LIMIT } from "../src/lib/recentMatches.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", WES = "wes";
const fx = (id, date, o = {}) => ({ id, schoolId: HIL, homeTeam: "1XI", awayTeam: "Westville 1XI", awaySchoolId: WES, awayTeamCode: "1XI",
  status: "complete", startsAt: `${date}T09:00:00.000Z`, date, ...o });
const MATCHES = [
  fx("m1", "2026-10-01"), fx("m2", "2026-10-08"), fx("m3", "2026-10-15"), fx("m4", "2026-10-22"),
  fx("live", "2026-10-29", { status: "live" }), fx("next", "2026-11-05", { status: "upcoming" }),
  fx("off", "2026-10-25", { calledOff: true }),
  fx("u16", "2026-10-20", { homeTeam: "U16A", awayTeamCode: "U16A" }),
];
const A = (role, school, team = null, o = {}) => ({ role, school, team, ...o });

group("Who is offered it: the cockpit's gate, by capability (D1)");
{
  const coach = recentSides(MATCHES, [A("coach", HIL, "1XI")]);
  ok("a 1XI coach: one side, the 1XI", coach.length === 1 && coach[0].teamCode === "1XI", coach.map((s) => s.key));
  ok(`...its last ${RECENT_LIMIT} finished matches, newest first: no live, no upcoming, none called off, no other team's`,
     coach[0].picks.map((p) => p.match.id).join() === "m4,m3,m2", coach[0].picks.map((p) => p.match.id));
  ok("...with the boys' figures (player.performance.read)", coach[0].figures === true);
  const tm = recentSides(MATCHES, [A("teammanager", HIL, "1XI")]);
  ok("a team manager: the side, without the boys' figures (no player.performance.read)", tm.length === 1 && tm[0].figures === false);
  const school = recentSides(MATCHES, [A("coach", HIL, null)]);
  ok("a school-wide coach: two sides, the latest's first", school.map((s) => s.teamCode).join() === "1XI,U16A", school.map((s) => s.key));
  ok("the away end: Westville's coach gets the same fixtures as his own side",
     recentSides(MATCHES, [A("coach", WES, "1XI")])[0]?.picks.every((p) => p.gate.end === "away") === true);
  for (const [who, a] of [["a guardian", A("guardian", HIL, null, { subjects: ["boy"] })], ["a pupil", A("player", HIL, "1XI", { subjects: ["boy"] })],
    ["a scorer", A("scorer", HIL, "1XI")], ["a spectator", A("spectator", HIL, null)], ["an analyst", A("analyst", HIL, null)],
    ["a coach of another school", A("coach", "kes", null)]]) {
    ok(`${who}: no card`, recentSides(MATCHES, [a]).length === 0);
  }
  ok("signed out (no assignments): no card", recentSides(MATCHES, null).length === 0 && recentSides(MATCHES, []).length === 0);
}

// ── A scored match, folded as the scorecard folds it ──
const OPP = ["Opp A", "Opp B", "Opp C"];
const sq = (ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));
function log({ hilBats = true, voidSix = false } = {}) {
  const evs = [];
  let n = 0;
  const add = (ev, innings) => evs.push({ ...ev, innings, id: `e${++n}`, seq: n, clientTs: 1e12 + n });
  const hil = sq(["whitfield", "bekker", "naidoo"]), opp = OPP.map((x) => ({ id: x, name: x }));
  // Hilton bat: Whitfield faces over 1 (4,0,2,6,0,4 = 16 off 6), Bekker over 2 (2,2,0,0,4,0 = 8 off 6).
  const bat = (inn) => {
    add(inningsStart({ battingTeam: "1XI", bowlingTeam: "Westville 1XI", squad: hil, bowlingSquad: opp, overs: 20 }), inn);
    add(batters({ striker: "whitfield", nonStriker: "bekker" }), inn);
    add(bowler({ bowler: "Opp A" }), inn);
    for (const v of [4, 0, 2, 6, 0, 4]) add(ball({ type: BALL_TYPE.RUN, value: v }), inn);
    add(bowler({ bowler: "Opp B" }), inn);
    for (const v of [2, 2, 0, 0, 4, 0]) add(ball({ type: BALL_TYPE.RUN, value: v }), inn);
  };
  // Westville bat: Naidoo bowls over 1 and takes a wicket; Westville's own boys score.
  const field = (inn) => {
    add(inningsStart({ battingTeam: "Westville 1XI", bowlingTeam: "1XI", squad: opp, bowlingSquad: hil, overs: 20 }), inn);
    add(batters({ striker: "Opp A", nonStriker: "Opp B" }), inn);
    add(bowler({ bowler: "naidoo" }), inn);
    for (const v of [0, 0, 6, 0]) add(ball({ type: BALL_TYPE.RUN, value: v }), inn);
    add(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }), inn);
    add(batters({ striker: "Opp C" }), inn);
    add(ball({ type: BALL_TYPE.RUN, value: 2 }), inn);
  };
  if (hilBats) { bat(0); field(1); } else { field(0); bat(1); }
  if (voidSix) {
    const six = evs.find((e) => e.kind === "ball" && e.value === 6 && e.innings === (hilBats ? 0 : 1));
    add({ ...voidEvent({ target: six.id, reason: "amendment" }), amendment: "a1" }, six.innings);
  }
  return evs;
}
const fold = (o) => deriveMatch(log(o), {}).innings;
const route = (hilBats = true, hilRuns = 30, wesRuns = 8) => ({
  result: { text: "Hilton College 1XI won by 22 runs" },
  innings: [{ innings: 0, side: hilBats ? "home" : "away", runs: hilBats ? hilRuns : wesRuns, wickets: hilBats ? 0 : 1, balls: hilBats ? 12 : 6, superOver: null },
    { innings: 1, side: hilBats ? "away" : "home", runs: hilBats ? wesRuns : hilRuns, wickets: hilBats ? 1 : 0, balls: hilBats ? 6 : 12, superOver: null }],
});
const M = fx("m4", "2026-10-22");

group("Our boys only (D8): batting from our innings, bowling from theirs");
{
  const s = matchSummary({ match: M, end: "home", theirName: "Westville 1XI", route: route(), innings: fold() });
  const by = Object.fromEntries(s.boys.map((b) => [b.id, b]));
  ok("three of ours and none of theirs", s.boys.map((b) => b.id).sort().join() === "bekker,naidoo,whitfield", s.boys.map((b) => b.id));
  ok("Whitfield 16 off 6, Bekker 8 off 6", by.whitfield.runs === 16 && by.whitfield.balls === 6 && by.bekker.runs === 8 && by.bekker.balls === 6, by);
  ok("Naidoo 1 for 8 off 6 balls (the scorecard's own figures)", by.naidoo.wickets === 1 && by.naidoo.conceded === 8 && by.naidoo.ballsBowled === 6, by.naidoo);
  ok("the line: the result read's words and each side's total", s.line.result === "Hilton College 1XI won by 22 runs" && s.line.ours === "30/0 (2 ov)" && s.line.theirs === "8/1 (1 ov)", s.line);
  ok("...and it carries a scorecard", s.line.carded === true);
  const away = matchSummary({ match: M, end: "away", theirName: "Hilton College 1XI", route: route(), innings: fold() });
  ok("from the away end the same log counts the other side's boys as theirs: Westville's typed names, never Hilton's",
     away.boys.every((b) => OPP.includes(b.id)) && away.line.ours === "8/1 (1 ov)", away.boys.map((b) => b.id));
  const placed = placedInnings(M, "home", fold({ hilBats: false }), route(false));
  ok("the innings order does not matter: fielding first, then batting", placed.map((p) => p.side).join() === "bowling,batting");
  const noName = fold().map((inn) => ({ ...inn, battingTeam: null }));
  ok("an innings the fold cannot place is placed by the result read's side", placedInnings(M, "home", noName, route()).map((p) => p.side).join() === "batting,bowling");
  ok("...and one neither can place counts nothing", placedInnings(M, "home", noName, null).length === 0
     && matchSummary({ match: M, end: "home", theirName: "x", route: null, innings: noName }).boys.length === 0);
  const failed = matchSummary({ match: M, end: "home", theirName: "x", route: null, innings: null });
  ok("both reads failed: the line says the result was not read; no total of nothing, no boy", failed.line.resultRead === false && failed.line.ours === null && failed.boys.length === 0);
}

group("Across matches: sums, the order, ties, the thirty-ball floor");
{
  const one = matchSummary({ match: M, end: "home", theirName: "W", route: route(), innings: fold() }).boys;
  const top = leaders([one, one]);
  ok("summed over two matches: Whitfield 32 off 12, then Bekker 16 off 12", top.batting.map((b) => `${b.id}:${b.runs}/${b.balls}/${b.innings}`).join() === "whitfield:32/12/2,bekker:16/12/2", top.batting);
  ok("wickets: Naidoo 2 for 16", top.bowling.length === 1 && top.bowling[0].wickets === 2 && top.bowling[0].conceded === 16);
  ok("the words: '32 (12 balls)', '2 for 16 (2 ov)'", battingWords(top.batting[0]) === "32 (12 balls)" && bowlingWords(top.bowling[0]) === "2 for 16 (2 ov)", [battingWords(top.batting[0]), bowlingWords(top.bowling[0])]);
  const said = insights(top, 2);
  ok("two insights at most, one each", said.length === 2 && said.map((s) => s.key).join() === "bat,bowl");
  ok("the top scorer, plainly counted", said[0].text === "Top scorer over the last 2 matches: WHITFIELD, 32 runs from 12 balls.", said[0].text);
  ok(`under ${COMPARE_FLOOR} balls the strike rate is not drawn, and the sentence says why`, said[0].rate === `No strike rate: 12 balls is fewer than the ${COMPARE_FLOOR} a rate needs.`, said[0].rate);
  ok("...and the economy too", /^No economy rate: 12 balls is fewer than the 30/.test(said[1].rate), said[1].rate);
  const many = leaders([[{ id: "a", name: "A", runs: 45, balls: 30, innings: 1, wickets: 3, ballsBowled: 36, conceded: 30, bowled: 1 }]]);
  const rated = insights(many, 1);
  ok("at the floor the rate is drawn: 150.0, economy 5.00", rated[0].rate === "Strike rate 150.0." && rated[1].rate === "Economy 5.00 an over." && /last match:/.test(rated[0].text), rated);
  const tie = leaders([[{ id: "a", name: "A", runs: 20, balls: 10, innings: 1, wickets: 0, ballsBowled: 0, conceded: 0, bowled: 0 },
    { id: "b", name: "B", runs: 20, balls: 25, innings: 1, wickets: 0, ballsBowled: 0, conceded: 0, bowled: 0 }]]);
  ok("a tie at the top is said as a tie, never broken for the sentence", insights(tie, 3)[0].text === "Top scorers over the last 3 matches: A and B, 20 runs each.", insights(tie, 3));
  ok("no wicket, no wicket insight; no run, no batting insight", insights(leaders([[]]), 3).length === 0);
  const unrec = leaders([[{ id: "a", name: "A", runs: 40, balls: null, innings: 1, wickets: 0, ballsBowled: null, conceded: 0, bowled: 0 }]]);
  ok("balls not recorded (a scorebook innings): no rate, and it says so", insights(unrec, 1)[0].rate === "No strike rate: the balls were not recorded." && battingWords(unrec.batting[0]) === "40 (balls not recorded)", insights(unrec, 1));
  ok("totals: all out reads as such", totalWords({ runs: 98, wickets: 10, balls: 100 }) === "98 all out (16.4 ov)");
}

group("A corrected ball changes the figures (GA-I36)");
{
  const before = matchSummary({ match: M, end: "home", theirName: "W", route: route(), innings: fold() });
  const after = matchSummary({ match: M, end: "home", theirName: "W", route: route(true, 24), innings: fold({ voidSix: true }) });
  const w = (s) => s.boys.find((b) => b.id === "whitfield");
  // The fold replays the over without the six: his sixth ball is now the next one bowled (a 2), so 16 off 6 becomes 12 off 6.
  ok("Whitfield's six voided: 16 off 6 becomes the fold's 12 off 6", w(before).runs === 16 && w(after).runs === 12 && w(after).balls === 6, [w(before), w(after)]);
  ok("...and the total moves with the result read", before.line.ours === "30/0 (2 ov)" && after.line.ours === "24/0 (2 ov)", after.line);
}

group("What it never says, and what it never does");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const code = strip(readFileSync(new URL("../src/lib/recentMatches.js", import.meta.url), "utf8"));
  const view = strip(readFileSync(new URL("../src/views/cockpit/RecentMatches.jsx", import.meta.url), "utf8"));
  for (const [what, src] of [["the module", code], ["the card", view]]) {
    const hit = FORBIDDEN_FIELDS.filter((w) => new RegExp(`\\b${w}\\b`).test(src));
    ok(`${what}: no forbidden field is read`, hit.length === 0, hit);
    const other = OTHER_SIDE_IDS.filter((w) => new RegExp(`\\b${w}\\b`).test(src));
    ok(`${what}: no ball's striker, bowler or dismissed id is read (the other side's boys are never keyed)`, other.length === 0, other);
    ok(`${what}: no injury, availability, load or reason field`, !/\.(injur\w*|rtw\w*|returnDate|reason\w*|note|workload|load\w*|available\w*|declared\w*|restricted)\b/.test(src), src.match(/\.(injur\w*|rtw\w*|returnDate|reason\w*|note|workload|load\w*|available\w*|declared\w*|restricted)\b/)?.[0]);
  }
  ok("the module fetches nothing, stores nothing, reads no clock", !/\bapi\(|fetch\(|localStorage|sessionStorage|Date\.now|new Date\(\)/.test(code));
  ok("the card writes nothing and notifies nobody (D11): only GETs, no POST, no notification", !/method:\s*"(POST|PUT|PATCH|DELETE)"|notif/i.test(view));
  const one = matchSummary({ match: M, end: "home", theirName: "W", route: route(), innings: fold() }).boys;
  const say = [...insights(leaders([one]), 1).flatMap((s) => [s.text, s.rate]), ...insights(leaders([[{ id: "a", name: "A", runs: 45, balls: 30, innings: 1, wickets: 3, ballsBowled: 36, conceded: 30, bowled: 1 }]]), 1).flatMap((s) => [s.text, s.rate])];
  ok("its sentences pass the cockpit's never-words, and say no percentage", say.every((l) => !NEVER_ON_THE_COCKPIT.test(l)), say.filter((l) => NEVER_ON_THE_COCKPIT.test(l)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
