/**
 * The match-day queue, phase A0 (docs/design/GA-I09-I11_match_day_queue.md
 * §4, §7, §8): the chooser that gives the coach's match-day card one card per
 * fixture an assignment admits, and the per-fixture count with its "Could not
 * read X" lines. Hand-built fixtures, no DOM, no database, no clock (the clock
 * is passed in).
 *
 * The browser walk (tools/smoke-browser-cockpit.mjs) holds the screen to this.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/queue.test.mjs
 */
import { readFileSync } from "node:fs";
import { panelsOf } from "../src/lib/cockpit.js";
import { FORBIDDEN_FIELDS, NEVER_ON_THE_COCKPIT } from "../src/lib/cockpitNever.js";
import { SHOWN, WINDOW_DAYS, chooseFixtures, countOf, unreadOf } from "../src/lib/queue.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", KES = "kes";
const NOW = Date.parse("2026-10-07T08:00:00Z");              // Wednesday 10:00 SA
const at = (iso, o = {}) => ({ id: o.id ?? iso, schoolId: HIL, homeTeam: "U15A", status: "upcoming", startsAt: `${iso}.000Z`, date: iso.slice(0, 10), ...o });
const TODAY_LATE = at("2026-10-07T15:00:00", { id: "today-late" });
const TODAY_EARLY = at("2026-10-07T11:00:00", { id: "today-early" });
const SAT = at("2026-10-10T07:00:00", { id: "sat" });
const SAT_B = at("2026-10-10T09:00:00", { id: "sat-b", homeTeam: "U14B" });
const SUN = at("2026-10-11T07:00:00", { id: "sun" });
const NEXT_WEEK = at("2026-10-21T07:00:00", { id: "next-week" });     // 14 days off: outside the window
const PLAYED = at("2026-10-05T07:00:00", { id: "played", status: "complete" });
const AT_KES = at("2026-10-10T08:00:00", { id: "at-kes", schoolId: KES, homeTeam: "U15A" });

const A = (role, school, team = null, o = {}) => ({ role, school, team, ...o });
const COACH_ALL = [A("coach", HIL, null)];                    // a school-wide coach: every side at Hilton

group("The chooser: one card for each fixture one assignment admits");
{
  const two = chooseFixtures([SAT, SUN], COACH_ALL, NOW);
  ok("two admitted fixtures give two cards", two.all.length === 2 && two.shown.length === 2 && two.later.length === 0, two.all.map((p) => p.match.id));
  ok("...in starts_at order", two.all.map((p) => p.match.id).join() === "sat,sun");
  ok("...each carries its own gate, built by cockpitGate", two.all.every((p) => p.gate.school === HIL && p.gate.end === "home" && p.gate.role === "coach"));
  const one = chooseFixtures([SAT], COACH_ALL, NOW);
  ok("one admitted fixture gives one card and nothing folded: what he sees today", one.all.length === 1 && one.shown.length === 1 && one.later.length === 0);
  ok("fixtures handed in out of order come out in order", chooseFixtures([SUN, SAT, TODAY_LATE], COACH_ALL, NOW).all.map((p) => p.match.id).join() === "today-late,sat,sun");
  ok("today's fixtures come first, earliest first", chooseFixtures([SAT, TODAY_LATE, SUN, TODAY_EARLY], COACH_ALL, NOW).all.map((p) => p.match.id).join() === "today-early,today-late,sat,sun");
  ok("two fixtures on one day are two cards, never merged", chooseFixtures([SAT_B, SAT], COACH_ALL, NOW).all.map((p) => p.match.id).join() === "sat,sat-b");
  ok("the window is seven days: a fixture two weeks off, and one already played, are not cards",
     chooseFixtures([SAT, NEXT_WEEK, PLAYED], COACH_ALL, NOW).all.map((p) => p.match.id).join() === "sat" && WINDOW_DAYS === 7);
  ok("nothing to choose from: nothing", chooseFixtures([], COACH_ALL, NOW).all.length === 0 && chooseFixtures(null, COACH_ALL, NOW).all.length === 0);
}

group("The chooser: the gate decides, one assignment at a time, never a union");
{
  ok("an assignment at another school admits nothing", chooseFixtures([SAT, SUN], [A("coach", KES, null)], NOW).all.length === 0);
  ok("...and a fixture at another school is not admitted to a coach at Hilton", chooseFixtures([AT_KES], COACH_ALL, NOW).all.length === 0);
  ok("...with both schools' assignments, each admits its own school's fixture only",
     chooseFixtures([SAT, AT_KES], [A("coach", HIL, null), A("coach", KES, null)], NOW).all.map((p) => `${p.match.id}:${p.gate.school}`).join() === `sat:${HIL},at-kes:${KES}`);
  ok("no assignments, none; a signed-out reader has none", chooseFixtures([SAT], [], NOW).all.length === 0 && chooseFixtures([SAT], null, NOW).all.length === 0 && chooseFixtures([SAT], undefined, NOW).all.length === 0);
  ok("a guardian, a pupil and a scorer admit nothing",
     chooseFixtures([SAT], [A("guardian", HIL, null, { subjects: ["p1"] }), A("player", HIL, null), A("scorer", HIL, null)], NOW).all.length === 0);
  ok("an assignment about a person (subjects) is not a side", chooseFixtures([SAT], [A("coach", HIL, null, { subjects: ["p1"] })], NOW).all.length === 0);
  const sides = [A("coach", HIL, "U15A"), A("assistantcoach", HIL, "U14B")];
  const got = chooseFixtures([SAT, SAT_B, SUN], sides, NOW);
  ok("a coach for U15A and an assistant for U14B: each fixture is admitted by its own assignment, and the third (U15A on Sunday: also his) too",
     got.all.map((p) => `${p.match.id}:${p.gate.role}`).join() === "sat:coach,sat-b:assistantcoach,sun:coach", got.all.map((p) => `${p.match.id}:${p.gate.role}`));
  const apart = chooseFixtures([at("2026-10-10T07:00:00", { id: "u16", homeTeam: "U16A" })], sides, NOW);
  ok("a fixture neither assignment's side covers is admitted by neither: the two are not joined to admit it", apart.all.length === 0);
  const both = chooseFixtures([SAT], [A("coach", HIL, "U15A"), A("directorofsport", HIL, null)], NOW);
  ok("two assignments admit one fixture: one card, by the assignment granting the most panels (never two, never merged)",
     both.all.length === 1 && Object.values(both.all[0].gate.panels).filter(Boolean).length === Math.max(
       Object.values(panelsOf("coach")).filter(Boolean).length, Object.values(panelsOf("directorofsport")).filter(Boolean).length), both.all.map((p) => p.gate.role));
  ok("a scorer's single fixture is not a side", chooseFixtures([SAT, SUN], [A("scorer", HIL, null, { fixture: "sat" }), A("coach", HIL, "U13A")], NOW).all.length === 0);
}

group("The fold: the first few are cards, the rest fold under Later");
{
  const week = [TODAY_EARLY, SAT, SAT_B, SUN, at("2026-10-12T07:00:00", { id: "mon" })];
  const f = chooseFixtures(week, COACH_ALL, NOW);
  ok(`${SHOWN} are drawn, the rest fold, none is lost`, f.shown.length === SHOWN && f.later.length === week.length - SHOWN && f.all.length === week.length, [f.shown.length, f.later.length]);
  ok("...the fold keeps the order, today's first", f.shown.map((p) => p.match.id).join() === "today-early,sat,sat-b" && f.later.map((p) => p.match.id).join() === "sun,mon");
  const exact = chooseFixtures(week.slice(0, SHOWN), COACH_ALL, NOW);
  ok("exactly as many as are shown: no fold", exact.later.length === 0);
  ok("the number shown is the caller's to set", chooseFixtures(week, COACH_ALL, NOW, { shown: 1 }).later.length === week.length - 1);
}

group("The count: N to resolve, and could not read X for each read that failed");
{
  const COACH = { end: "home", role: "coach", school: HIL, team: null, teamCode: "U15A", panels: panelsOf("coach") };
  const MANAGER = { ...COACH, role: "teammanager", panels: panelsOf("teammanager") };
  const DIRECTOR = { ...COACH, role: "directorofsport", panels: panelsOf("directorofsport") };
  const PHYSIO = { ...COACH, role: "medical", panels: panelsOf("medical") };
  const answered = () => ({ squad: [], readiness: [], workload: [], trips: [], duties: [], weatherRows: [], notices: [], lifts: null, liftExceptions: null,
    conditions: { state: "set", cap: null, freeHit: null } });

  const none = countOf({ open: 0, reads: answered(), gate: COACH });
  ok("nothing open and every read answered: 'Nothing to resolve'", none.line === "Nothing to resolve" && none.clear && none.unread.length === 0, none);
  const three = countOf({ open: 3, reads: answered(), gate: COACH });
  ok("three open: '3 to resolve'", three.line === "3 to resolve" && !three.clear && three.unread.length === 0);
  ok("one open: '1 to resolve' (the number, not a plural word)", countOf({ open: 1, reads: answered(), gate: COACH }).line === "1 to resolve");

  ok("a null read gives 'Could not read the bus'", countOf({ open: 2, reads: { ...answered(), trips: null }, gate: COACH }).unread.map((r) => r.text).join() === "Could not read the bus");
  ok("...and the count beside it is still the number open", countOf({ open: 2, reads: { ...answered(), trips: null }, gate: COACH }).line === "2 to resolve");
  ok("an empty read gives no row", countOf({ open: 0, reads: { ...answered(), trips: [] }, gate: COACH }).unread.length === 0);
  ok("an empty read is a read that answered: still 'Nothing to resolve'", countOf({ open: 0, reads: { ...answered(), trips: [], duties: [], readiness: [] }, gate: COACH }).line === "Nothing to resolve");

  const failed = countOf({ open: 0, reads: { ...answered(), trips: null }, gate: COACH });
  ok("ZERO BLOCKERS AND A FAILED READ DO NOT LOOK THE SAME: '0 to resolve' + the failed read, never 'Nothing to resolve'",
     failed.line === "0 to resolve" && !failed.clear && failed.unread.length === 1 && failed.line !== none.line, failed);

  const all = unreadOf({ squad: null, readiness: null, trips: null, duties: null, weatherRows: null, workload: null, notices: null, lifts: null, liftExceptions: null, conditions: { state: "failed" } }, COACH, { lifts: true });
  ok("every read that failed is its own line, in a fixed order, each said in the read's own words",
     all.map((r) => r.label).join() === "the sheet,who has answered,the bus,the lifts,the duties,the playing conditions,the weather,the bowlers' week,the notices", all.map((r) => r.label));
  ok("a failed conditions read is the document read failing, not the weather",
     unreadOf({ ...answered(), conditions: { state: "failed", cap: null, freeHit: null } }, COACH).map((r) => r.key).join() === "conditions"
     && unreadOf({ ...answered(), conditions: { state: "defaults", cap: null, freeHit: null } }, COACH).length === 0);
  ok("a null weather read is a failed one; no forecast for this fixture (an empty read) is not", unreadOf({ ...answered(), weatherRows: null }, COACH).map((r) => r.key).join() === "weatherRows" && unreadOf({ ...answered(), weatherRows: [] }, COACH).length === 0);

  ok("a read the reader's gate never asked for is not a failed one: the team manager holds no load, so no 'bowlers' week'",
     unreadOf({ ...answered(), workload: null }, MANAGER).length === 0 && unreadOf({ ...answered(), workload: null }, COACH).length === 1);
  ok("...the physio asked for no side and no bus: those reads, null, are not failures; the sheet, the day and the load he did ask for are",
     unreadOf({ squad: [], readiness: null, trips: null, duties: [], weatherRows: [], workload: [], notices: [], conditions: { state: "set" } }, PHYSIO).length === 0
     && unreadOf({ squad: [], readiness: null, trips: null, duties: null, weatherRows: [], workload: [], notices: [], conditions: { state: "set" } }, PHYSIO).map((r) => r.key).join() === "duties");
  ok("the lifts are read on the match day only: null on another day is not a failure, null on the match day is", unreadOf(answered(), COACH, { lifts: false }).length === 0 && unreadOf(answered(), COACH, { lifts: true }).map((r) => r.key).join() === "lifts");
  ok("...an answered lift read (even empty) is not a failure", unreadOf({ ...answered(), lifts: [] }, COACH, { lifts: true }).length === 0);
  ok("...the office's lift exceptions are asked of the holder of transport.lift.oversee only", unreadOf({ ...answered(), lifts: [], liftExceptions: null }, DIRECTOR, { lifts: true }).length === 0
     && panelsOf("schooladmin").liftOffice === true);
  ok("no reads object at all (signed out, nothing asked): nothing failed", unreadOf(null, COACH).length === 0 && unreadOf(undefined, COACH).length === 0);
}

group("What this module never says (design §5)");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const code = strip(readFileSync(new URL("../src/lib/queue.js", import.meta.url), "utf8"));
  const hit = FORBIDDEN_FIELDS.filter((w) => new RegExp(`\\b${w}\\b`).test(code));
  ok(`no forbidden field is read (${FORBIDDEN_FIELDS.join(", ")})`, hit.length === 0, hit);
  ok("it reads no name and no player: no 'name', 'playerId', 'rtw', 'reason' field", !/\.(name|playerId|returnDate|rtw\w*|reason\w*|note|injury\w*|severity|phase)\b/.test(code), code.match(/\.(name|playerId|returnDate|rtw\w*|reason\w*|note|injury\w*)\b/)?.[0]);
  ok("it fetches nothing and writes nothing", !/\bapi\(|fetch\(|localStorage|sessionStorage|Date\.now|new Date\(\)|XMLHttpRequest/i.test(code));
  ok("it imports no screen and no react", !/from "\.\.\/(views|ui)\//.test(code) && !/from "react"/.test(code));
  const COACH = { end: "home", role: "coach", school: HIL, team: null, teamCode: "U15A", panels: panelsOf("coach") };
  const say = [countOf({ open: 0, reads: { squad: [] , readiness: [], trips: [], duties: [], weatherRows: [], workload: [], notices: [], conditions: { state: "set" } }, gate: COACH }).line,
    countOf({ open: 4, reads: {}, gate: COACH, lifts: true }).line,
    ...countOf({ open: 4, reads: {}, gate: COACH, lifts: true }).unread.map((r) => r.text)];
  ok("its own sentences pass the cockpit's never-words, and say no 'done', 'ready', 'cleared', 'resolved' and no percentage",
     say.every((l) => !NEVER_ON_THE_COCKPIT.test(l) && !/\b(done|ready|cleared|resolved|complete|all clear)\b|%/i.test(l)), say.filter((l) => NEVER_ON_THE_COCKPIT.test(l) || /\b(done|ready|cleared|resolved|complete|all clear)\b|%/i.test(l)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
