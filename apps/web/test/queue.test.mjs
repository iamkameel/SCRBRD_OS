/**
 * The match-day queue (docs/design/GA-I09-I11_match_day_queue.md §2–§8).
 * Phase A0: the chooser that gives the coach's match-day card one card per
 * fixture an assignment admits, and the per-fixture count with its "Could not
 * read X" lines. Phase A1: the rows (source, owner, the queue's clock, one
 * door), the clock constants at their thresholds, grouping by date then team,
 * the office rules O1–O3 (O4 is S8 over the school, O5 the moved and
 * called-off fixture, O6 a tap), the header's three numbers, and the
 * never-list over the new code. Hand-built fixtures, no DOM, no database, no
 * clock (the clock is passed in).
 *
 * The browser walks (tools/smoke-browser-cockpit.mjs, smoke-browser-queue.mjs) hold the screens to this.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/queue.test.mjs
 */
import { readFileSync } from "node:fs";
import { panelsOf } from "../src/lib/cockpit.js";
import { FORBIDDEN_FIELDS, NEVER_ON_THE_COCKPIT } from "../src/lib/cockpitNever.js";
import { isSoon } from "../src/lib/cockpit.js";
import { CLOCK, SHOWN, WINDOW_DAYS, chooseFixtures, chooseSchoolFixtures, countOf, deadlineAt, entersQueue, fixtureRows, groupByDay, headerOf, headerWords, isDue,
  liftExceptionRows, officeReader, officeRows, queueGate, unreadOf } from "../src/lib/queue.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", KES = "kes";
const NOW = Date.parse("2026-10-07T08:00:00Z");              // Wednesday 10:00 SA
const at = (iso, o = {}) => ({ id: o.id ?? iso, schoolId: HIL, homeTeam: "U15A", awayTeam: "Kearsney", status: "upcoming", startsAt: `${iso}.000Z`, date: iso.slice(0, 10), ...o });
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

// ═══════════════════════════════════════════════════════════════════════
//  PHASE A1 (GA-I09–I11 §2–§5, §8): rows, the queue's clock, grouping, the
//  office rules, the header, and what the school-wide rows never say.
// ═══════════════════════════════════════════════════════════════════════
const SAT_AT = Date.parse(SAT.startsAt);                       // Sat 10 Oct 09:00 SA
const H = 3600e3;
const THU_AT = SAT_AT - 48 * H;                                // Thu 08 Oct 09:00 SA: the answers' clock runs out
const FRI_AT = SAT_AT - 24 * H;
const rd = (id, o = {}) => ({ playerId: id, name: `Fictional ${id}`, team: "U15A", declaredStatus: "available", selected: false, side: "home",
  clinicallyRestricted: null, returnDate: null, reasonKind: "family", ...o });
const sq = (n, side = "home") => Array.from({ length: n }, (_, i) => ({ playerId: `s${i}`, side, twelfth: false }));
const answered = (o = {}) => ({ squad: sq(11), readiness: [], trips: [], duties: [{ duty: "scorer" }, { duty: "umpire" }], weatherRows: [],
  conditions: { state: "set", cap: null, freeHit: null }, lifts: null, ...o });
const gateOf = (role, team = null, school = HIL, m = SAT) => queueGate([A(role, school, team)], m);
const DIRECTOR_G = gateOf("directorofsport");
const rulesOf = (g) => g.rows.map((r) => r.rule).join();
const deep = (v, f, path = "") => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [...(f(k, x) ? [path + k] : []), ...deep(x, f, `${path}${k}.`)]) : []);

group("The queue's clock: constants, each firing at its threshold and not one short (§2.4, D3)");
{
  ok("the constants are the design's: answers 48 hours, the sheet 24, first ball 0, the bus the trip's own", CLOCK.answers.hours === 48 && CLOCK.sheet.hours === 24 && CLOCK.firstBall.hours === 0 && CLOCK.bus.trip === true);
  ok("...and the answers' 48 is the feed's own 'soon' (cockpit.js isSoon)", [THU_AT - 1, THU_AT].map((t) => isSoon(SAT, t)).join() === "false,true");
  for (const [clock, at] of [["answers", THU_AT], ["sheet", FRI_AT], ["firstBall", SAT_AT]]) {
    const d = deadlineAt(clock, SAT);
    ok(`${clock}: the deadline is ${CLOCK[clock].hours} hours before the start, exactly`, d?.at === at && d.clock === clock, d);
    ok(`...due AT the threshold, not one millisecond short`, isDue(d.at, at) === true && isDue(d.at, at - 1) === false);
  }
  ok("a fixture with no start has no deadline", deadlineAt("answers", { id: "x" }) === null && isDue(null, NOW) === false);
  const dep = new Date(SAT_AT - 150 * 60e3).toISOString();
  ok("the bus: the trip's own depart_at", deadlineAt("bus", SAT, [{ school: HIL, state: "booked", capacity: 4, departAt: dep }], HIL)?.at === Date.parse(dep) && deadlineAt("bus", SAT, [{ school: HIL, state: "booked", capacity: 4, departAt: dep }], HIL)?.clock === "bus");
  ok("...else the first ball, when the trip has none, there is no trip, or it is cancelled",
     [[{ school: HIL, state: "booked", capacity: 4, departAt: null }], null, [{ school: HIL, state: "cancelled", capacity: 4, departAt: dep }]]
       .every((t) => deadlineAt("bus", SAT, t, HIL)?.at === SAT_AT && deadlineAt("bus", SAT, t, HIL)?.clock === "firstBall"));
  const r = fixtureRows({ match: SAT, gate: DIRECTOR_G, now: THU_AT, reads: answered({ readiness: [rd("a", { declaredStatus: null })] }) });
  ok("a row's deadline reads 'was due Thu 09:00' once its clock has run out",
     r.rows[0].deadline.words === "was due Thu 09:00" && r.rows[0].deadline.due === true, r.rows[0].deadline);
  ok("...and 'by Thu 09:00' before it (the answers' row of an earlier day, read on the Wednesday)",
     fixtureRows({ match: SAT, gate: DIRECTOR_G, now: THU_AT - 1, reads: answered({ readiness: [rd("a", { declaredStatus: null, selected: true, clinicallyRestricted: true })] }) }).rows.find((x) => x.rule === "S3")?.deadline?.words === "by Thu 09:00");
  ok("...S7 fires at 48 hours (the clock) and not a millisecond short of it",
     fixtureRows({ match: SAT, gate: DIRECTOR_G, now: THU_AT, reads: answered({ readiness: [rd("a", { declaredStatus: null })] }) }).rows.some((x) => x.rule === "S7")
     && !fixtureRows({ match: SAT, gate: DIRECTOR_G, now: THU_AT - 1, reads: answered({ readiness: [rd("a", { declaredStatus: null })] }) }).rows.some((x) => x.rule === "S7"));
  const thin = fixtureRows({ match: SAT, gate: DIRECTOR_G, now: THU_AT, reads: answered({ squad: sq(7) }) }).rows.find((x) => x.rule === "S6");
  ok("S6 runs on the 24-hour clock: on the feed at 48 hours, due the day before", thin?.deadline?.at === FRI_AT && thin.deadline.words === "by Fri 09:00" && thin.deadline.due === false, thin?.deadline);
  const dutyRow = fixtureRows({ match: SAT, gate: DIRECTOR_G, now: THU_AT, reads: answered({ duties: [{ duty: "umpire" }] }) }).rows.find((x) => x.rule === "O4");
  ok("duties run to the first ball", dutyRow?.deadline?.at === SAT_AT && dutyRow.deadline.words === "by first ball (Sat 09:00)", dutyRow?.deadline);
  ok("requests and claims carry no deadline, only an age (the office decides its own pace); a clearance its own date",
     officeRows({ school: HIL, can: { requests: true, claims: true, register: false }, requests: [{ state: "pending", decidable: true, school: HIL, requestedAt: new Date(NOW - 4 * 24 * H).toISOString() }],
       claims: [{ school_id: HIL, requested_at: new Date(NOW - 2 * 24 * H).toISOString() }], now: NOW }).rows.every((x) => x.deadline === null && /^oldest \d+ days?$/.test(x.age)));
}

group("Who enters the school-wide screen: the cockpit's entry or an office capability, by one assignment, never a union (§1.1, ADR 0001)");
{
  const enters = (role) => entersQueue(role);
  ok("the director, the principal, the school admin, the sports admin and the coach's team enter",
     ["directorofsport", "principal", "schooladmin", "sportsadmin", "coach", "assistantcoach", "teammanager", "transportcoordinator"].every(enters));
  ok("a scorer, an official, a spectator, a groundskeeper, a pupil, a parent and a person's own record do not: fixture.read alone is not a door",
     ["scorer", "official", "spectator", "facilities", "media", "player", "guardian", "selfaccess", "enquiry", "driver"].every((r) => !enters(r)));
  ok("a school-wide director admits a fixture at his school and not another's", queueGate([A("directorofsport", HIL, null)], SAT)?.role === "directorofsport" && queueGate([A("directorofsport", HIL, null)], AT_KES) === null);
  ok("a coach for U15A admits the U15A fixture and not the U14B one", queueGate([A("coach", HIL, "U15A")], SAT) !== null && queueGate([A("coach", HIL, "U15A")], SAT_B) === null);
  ok("a person-scoped assignment and a single fixture's scorer admit nothing", queueGate([A("coach", HIL, null, { subjects: ["p1"] })], SAT) === null && queueGate([A("directorofsport", HIL, null, { fixture: "other" })], SAT) === null);
  const nPanels = (role) => Object.values(panelsOf(role)).filter(Boolean).length;
  ok("with a coach's and a director's assignment, ONE admits the fixture: the one granting the most panels, the first on a tie (never both)",
     queueGate([A("coach", HIL, "U15A"), A("directorofsport", HIL, null)], SAT)?.role === (nPanels("directorofsport") > nPanels("coach") ? "directorofsport" : "coach"));
  ok("no assignments, none", queueGate([], SAT) === null && queueGate(null, SAT) === null && queueGate(undefined, SAT) === null);
  const all = [SAT, SAT_B, SUN, NEXT_WEEK, PLAYED, AT_KES, at("2026-10-09T07:00:00", { id: "off", calledOff: true, status: "complete" }), at("2026-10-09T09:00:00", { id: "live", status: "live" }), at("2026-10-30T07:00:00", { id: "far" }), at("2026-10-25T07:00:00", { id: "off-far", calledOff: true, status: "complete" })];
  const got = chooseSchoolFixtures(all, [A("directorofsport", HIL, null)], NOW);
  ok("seven days are drawn in start order, a fixture called off among them; played, live and other schools' are not",
     got.inWindow.map((p) => p.match.id).join() === "off,sat,sat-b,sun", got.inWindow.map((p) => p.match.id));
  ok("...the upcoming ones after that fold under Later, nearest first (a fixture called off beyond the week is not one of them)",
     got.later.map((p) => p.match.id).join() === "next-week,far", got.later.map((p) => p.match.id));
  ok("...nobody else's fixtures, nothing to a guardian", chooseSchoolFixtures(all, [A("guardian", HIL, null, { subjects: ["p1"] })], NOW).inWindow.length === 0);
}

group("A fixture's rows: counts, each with its source, owner, the queue's clock and one door (§2.2, §3.2)");
{
  const THU = THU_AT + 60e3;
  const reads = answered({
    readiness: [rd("a", { declaredStatus: null }), rd("b", { declaredStatus: null }), rd("c", { declaredStatus: null }), rd("d", { declaredStatus: null }),
      rd("e", { selected: true, clinicallyRestricted: true, returnDate: "2026-10-20", reasonKind: "injury" }), rd("f", { selected: true, declaredStatus: "unavailable" }),
      rd("g", { declaredStatus: "needs_reconfirming" }), rd("h", { declaredStatus: "needs_reconfirming" })],
    squad: sq(7),
    trips: [{ school: HIL, state: "booked", capacity: 4, seatsTaken: 0, departAt: new Date(SAT_AT - 150 * 60e3).toISOString() }],
    duties: [{ duty: "umpire" }],
    weatherRows: [{ matchId: SAT.id, tempC: 18, condition: "Showers", rainChancePct: 70, forecast: "Rain likely from 14:00", playable: true }],
    conditions: { state: "defaults", cap: null, freeHit: null },
  });
  const g = fixtureRows({ match: SAT, gate: DIRECTOR_G, reads, now: THU });
  const by = (rule) => g.rows.filter((r) => r.rule === rule);
  ok("the rows come in the fixed order S7, S3, S6, S1, O4 (S8), S10, S9, O5: nothing ranked", rulesOf(g) === "S7,S3,S3,S6,S1,O4,S10,S9,O5", rulesOf(g));
  ok("S7 is a count in the source's words: '4 have not answered'", by("S7")[0]?.fact === "4 have not answered" && by("S7")[0].count === 4);
  ok("...its source is the side read, its owner the side's coach or team manager (derived from the capability), its door the side",
     by("S7")[0].source === "the side read" && by("S7")[0].owner === "the U15A coach, assistant coach or team manager" && by("S7")[0].action.kind === "side" && by("S7")[0].action.matchId === SAT.id, by("S7")[0]);
  ok("S3 is two counts, never a name: '1 restricted boy on the sheet' and '1 marked unavailable on the sheet'", by("S3").map((r) => r.fact).join("|") === "1 restricted boy on the sheet|1 marked unavailable on the sheet", by("S3").map((r) => r.fact));
  ok("...its owner is the selector (derived: the team roles that hold team.select)", by("S3")[0].owner === "the U15A coach or team manager", by("S3")[0].owner);
  ok("S6: '7 named · a side needs 11', the sheet read", by("S6")[0].fact === "7 named · a side needs 11" && by("S6")[0].source === "the sheet read");
  ok("S1 is the signals' own sentence, 'lifts not counted' for a reader who holds no lift capability, on the trip's clock",
     by("S1")[0].fact === "Bus seats 4 · 7 named (lifts not counted)" && by("S1")[0].deadline.words === "by the bus's departure (Sat 06:30)" && by("S1")[0].deadline.clock === "bus", by("S1")[0]);
  ok("O4 (S8's rule): 'No scorer on record for 10 Oct', the office's, to the first ball; the conditions are the organiser's",
     by("O4")[0].fact === "No scorer on record for 10 Oct" && by("O4")[0].owner === "the office" && by("S10")[0].owner === "the competition's organiser", [by("O4")[0].fact, by("S10")[0].owner]);
  ok("S9 (weather) is drawn and counted as none: information, no door", by("S9")[0].state === "info" && by("S9")[0].count === 0 && by("S9")[0].action === null);
  ok("O5: the answers to ask again, the only on-record trace of a move", by("O5")[0].fact === "Moved: 2 answers to ask again" && by("O5")[0].source === "the side read");
  ok("the group counts its open rows (not the information): 8 to resolve, nothing failed", g.open === 8 && g.failed === 0 && g.line === "8 to resolve" && !g.clear, [g.open, g.line]);
  ok("every row has one door or none, and the doors are the design's: side, bus, duties, conditions, fixture",
     g.rows.every((r) => r.action === null || ["side", "bus", "duties", "conditions", "fixture"].includes(r.action.kind)));
  ok("the group names the fixture, ours first", g.label === "U15A v Kearsney" && g.start === SAT_AT);
}

group("The school-wide rows carry counts and no name, no player id, no return date, no reason (§5, D8)");
{
  const reads = answered({ readiness: [rd("a", { declaredStatus: null, name: "Zed Fictional" }), rd("e", { selected: true, clinicallyRestricted: true, returnDate: "2026-10-20", reasonKind: "injury", name: "Yan Fictional" }),
    rd("f", { selected: true, declaredStatus: "unavailable", reasonKind: "family", name: "Xia Fictional" })], squad: sq(7) });
  const g = fixtureRows({ match: SAT, gate: DIRECTOR_G, reads, now: THU_AT + 60e3 });
  const text = JSON.stringify(g);
  ok("the rendered group holds none of the three names, none of their ids", !/Fictional/.test(text) && !/"(a|e|f)"/.test(text), text.slice(0, 200));
  ok("...and no 'name', 'playerId', 'rtw_date', 'returnDate', 'reason_kind', 'reasonKind', 'note' field anywhere on it",
     deep(g, (k) => ["name", "playerId", "rtw_date", "returnDate", "reason_kind", "reasonKind", "note", "injury_type", "severity", "phase", "acwr", "ewma_ratio", "open_flag"].includes(k)).length === 0,
     deep(g, (k) => ["name", "playerId", "returnDate", "reasonKind"].includes(k)));
  ok("...nor the date he is back, nor the reason an absence was given", !/2026-10-20|20 Oct|family|injury/i.test(g.rows.map((r) => r.fact).join(" ")));
  const manager = fixtureRows({ match: SAT, gate: gateOf("teammanager", "U15A"), reads, now: THU_AT + 60e3 });
  ok("a team manager's group is the same counts: the gate is his, the rows are not wider", manager.rows.every((r) => !/Fictional/.test(r.fact)) && manager.rows.some((r) => r.rule === "S3"));
  const principal = fixtureRows({ match: SAT, gate: gateOf("principal"), reads, now: THU_AT + 60e3 });
  ok("the principal's thin row is the policy's answer: no answers, no sheet signals (no availability.read, no team.select), duties and conditions yes",
     !principal.rows.some((r) => ["S7", "S3", "S6", "S1", "O5"].includes(r.rule)) && panelsOf("principal").day === true && panelsOf("principal").side === false && panelsOf("principal").select === false);
  const admin = fixtureRows({ match: SAT, gate: gateOf("schooladmin"), reads, now: THU_AT + 60e3 });
  ok("the school admin reads the answers and the bus and not the sheet's selection: S7 yes, S3 and S6 no", admin.rows.some((r) => r.rule === "S7") && !admin.rows.some((r) => r.rule === "S3" || r.rule === "S6"));
}

group("A read that failed is a row that says so; one that answered nothing is no row (I08)");
{
  const THU = THU_AT + 60e3;
  const g0 = fixtureRows({ match: SAT, gate: DIRECTOR_G, reads: answered(), now: THU });
  ok("every read answered and nothing waiting: 'Nothing to resolve', clear", g0.clear && g0.line === "Nothing to resolve" && g0.open === 0 && g0.failed === 0 && g0.rows.length === 0, g0);
  const bad = fixtureRows({ match: SAT, gate: DIRECTOR_G, reads: answered({ duties: null }), errors: { duties: "unreachable" }, now: THU });
  ok("a null duties read gives a could_not_read row with the read's name and its error, never an empty group",
     bad.unread.length === 1 && bad.unread[0].state === "could_not_read" && bad.unread[0].read === "duties" && bad.unread[0].fact === "Could not read the duties (unreachable)", bad.unread);
  ok("...zero blockers and a failed read do not look alike: '0 to resolve', not clear, one failed",
     bad.line === "0 to resolve" && !bad.clear && bad.failed === 1 && bad.open === 0 && bad.line !== g0.line);
  ok("...and it has a door to read it again, not a door to somewhere else", bad.unread[0].action.kind === "retry");
  ok("an empty duties read ([]) is a read that answered: 'No scorer on record' fires, no could-not-read row",
     fixtureRows({ match: SAT, gate: DIRECTOR_G, reads: answered({ duties: [] }), now: THU }).unread.length === 0
     && fixtureRows({ match: SAT, gate: DIRECTOR_G, reads: answered({ duties: [] }), now: THU }).rows.filter((r) => r.rule === "O4").length === 2);
  ok("a failed readiness read says 'who has answered', whatever else is open",
     fixtureRows({ match: SAT, gate: DIRECTOR_G, reads: answered({ readiness: null }), now: THU }).unread.map((r) => r.fact).join() === "Could not read who has answered");
  ok("a failed conditions read is the document read failing",
     fixtureRows({ match: SAT, gate: DIRECTOR_G, reads: answered({ conditions: { state: "failed", cap: null, freeHit: null } }), now: THU }).unread.map((r) => r.read).join() === "conditions");
  ok("a read the gate never asked for is not a failure: the principal asked for no side and no bus",
     fixtureRows({ match: SAT, gate: gateOf("principal"), reads: answered({ readiness: null, trips: null }), now: THU }).unread.length === 0);
  ok("the lifts are read on the match day only, for a reader who may count them, and a null one then is a failure",
     fixtureRows({ match: SAT, gate: gateOf("coach"), reads: answered({ lifts: null }), now: THU }).unread.length === 0
     && fixtureRows({ match: SAT, gate: gateOf("coach"), reads: answered({ lifts: null }), now: SAT_AT - 3 * H }).unread.map((r) => r.read).join() === "lifts");
  ok("a bowlers' week, the notices and the lift exceptions are not the school-wide screen's reads: a null there is not its failure",
     fixtureRows({ match: SAT, gate: gateOf("coach"), reads: answered({ workload: null, notices: null, liftExceptions: null }), now: THU }).unread.length === 0);
  ok("a group whose reads have not come back is loading, not clear", fixtureRows({ match: SAT, gate: DIRECTOR_G, reads: undefined, now: THU }).loading === true && fixtureRows({ match: SAT, gate: DIRECTOR_G, reads: undefined, now: THU }).clear === false);
  const off = at("2026-10-09T09:00:00", { id: "off", calledOff: true, status: "complete" });
  const co = fixtureRows({ match: off, gate: queueGate([A("directorofsport", HIL, null)], off), now: THU,
    reads: { duties: [{ duty: "umpire" }, { duty: "scorer" }], trips: [{ school: HIL, state: "booked", capacity: 30, seatsTaken: 0 }] } });
  ok("O5's first clause: a fixture called off with duties and a bus still on record says so, in counts",
     co.calledOff && co.rows.length === 1 && co.rows[0].fact === "Called off: 2 duties and 1 bus still on record" && co.rows[0].rule === "O5" && co.unread.length === 0, co.rows);
  ok("...called off with nothing on record: nothing to resolve; and none of S7–S10 ask a called-off fixture anything",
     fixtureRows({ match: off, gate: queueGate([A("directorofsport", HIL, null)], off), now: THU, reads: { duties: [], trips: [] } }).clear);
}

group("Grouping: date, then team; nothing ranked (§2.5)");
{
  const mk = (m) => fixtureRows({ match: m, gate: queueGate([A("directorofsport", HIL, null)], m), reads: answered(), now: THU_AT });
  const U13 = at("2026-10-10T09:00:00", { id: "u13", homeTeam: "U13A" });
  const days = groupByDay([mk(SUN), mk(SAT_B), mk(U13), mk(SAT)]);
  ok("two days: Saturday and Sunday, in date order, each headed in words", days.map((d) => `${d.day}:${d.label}`).join() === "2026-10-10:Sat 10 Oct,2026-10-11:Sun 11 Oct", days.map((d) => d.label));
  ok("inside a day: start time first, then team", days[0].groups.map((g) => g.id).join() === "sat,u13,sat-b", days[0].groups.map((g) => `${g.id}:${g.team}`));
  ok("...the same start, by team code: U13A before U14B", days[0].groups.filter((g) => g.start === Date.parse(SAT_B.startsAt)).map((g) => g.team).join() === "U13A,U14B");
  ok("a Saturday of three fixtures is one date group of three", days[0].groups.length === 3 && days[1].groups.length === 1);
  ok("a fixture across midnight SA time is the SA day's, not the UTC one's: 22:30 UTC Saturday is Sunday 00:30 in SA",
     groupByDay([mk(at("2026-10-10T22:30:00", { id: "late" }))])[0].day === "2026-10-11");
  ok("a group with no start is not placed, and nothing throws", groupByDay([{ ...mk(SAT), start: null }]).length === 0 && groupByDay([]).length === 0);
}

group("The office list: who holds which row, and O1, O2, O3 (§2.3, §3.3)");
{
  const school = (role, team = null, o = {}) => officeReader([A(role, HIL, team, o)])[0]?.can ?? null;
  const caps = (c) => c ? Object.entries(c).filter(([, v]) => v).map(([k]) => k).join() : "none";
  ok("the director: requests, claims, the register; no lifts (he holds neither lift capability)", caps(school("directorofsport")) === "requests,claims,register", caps(school("directorofsport")));
  ok("the principal: requests and the register; no claims (no user.invite)", caps(school("principal")) === "requests,register", caps(school("principal")));
  ok("the school admin: all four, lifts included", caps(school("schooladmin")) === "requests,claims,register,lifts", caps(school("schooladmin")));
  ok("the sports admin: O3 and O6 and not O1 or O2 (no user.role.assign, no user.invite)", caps(school("sportsadmin")) === "register,lifts", caps(school("sportsadmin")));
  ok("the transport coordinator: the register and the lifts only", caps(school("transportcoordinator")) === "register,lifts", caps(school("transportcoordinator")));
  ok("a coach, a team's coach, a parent, a pupil and a scorer have no office list",
     ["coach"].every((r) => school(r) === null) && school("coach", "U15A") === null && school("guardian", null, { subjects: ["p"] }) === null && school("player") === null && school("scorer") === null);
  ok("a team-scoped director's assignment is not the school's office", school("directorofsport", "U15A") === null);
  ok("two schools, two offices, each with its own rows", officeReader([A("schooladmin", HIL, null), A("schooladmin", KES, null)]).map((o) => o.school).join() === `${HIL},${KES}`);

  const day = 24 * H;
  const req = (o) => ({ state: "pending", decidable: true, school: HIL, askedUnverified: false, requestedAt: new Date(NOW - 1 * day).toISOString(), ...o });
  const can = { requests: true, claims: true, register: true };
  const o1 = officeRows({ school: HIL, can, requests: [req({}), req({ askedUnverified: true, requestedAt: new Date(NOW - 4 * day).toISOString() }), req({ id: "x" }),
    req({ state: "approved" }), req({ decidable: false }), req({ school: KES })], now: NOW });
  ok("O1: '3 requests waiting · 1 asked before the email was verified', oldest 4 days: the unverified one is counted in the three, never dropped",
     o1.rows[0]?.fact === "3 requests waiting · 1 asked before the email was verified" && o1.rows[0].count === 3 && o1.rows[0].age === "oldest 4 days", o1.rows[0]);
  ok("...an answered one, one this reader cannot decide, and another school's are not on it", o1.rows[0].count === 3);
  ok("...its door is Decide, its owner the office, its source the requests read", o1.rows[0].action.kind === "requests" && o1.rows[0].action.label === "Decide" && o1.rows[0].owner === "the office" && o1.rows[0].source === "the requests read");
  ok("...a request asked before the email was verified is a request all the same: one such alone is a row",
     officeRows({ school: HIL, can, requests: [req({ askedUnverified: true })], now: NOW }).rows[0]?.fact === "1 request waiting · 1 asked before the email was verified");
  ok("...nothing waiting is no row, and a request none of which is decidable by this reader is no row", officeRows({ school: HIL, can, requests: [] , now: NOW }).rows.length === 0 && officeRows({ school: HIL, can, requests: [req({ decidable: false })], now: NOW }).rows.length === 0);
  const claim = (o) => ({ school_id: HIL, requested_at: new Date(NOW - 2 * day).toISOString(), ...o });
  const o2 = officeRows({ school: HIL, can, claims: [claim({}), claim({ requested_at: new Date(NOW - 3 * day).toISOString() }), claim({ school_id: KES })], now: NOW });
  ok("O2: '2 Google sign-ins match an enrolled account', oldest 3 days, door Confirm", o2.rows[0]?.fact === "2 Google sign-ins match an enrolled account" && o2.rows[0].age === "oldest 3 days" && o2.rows[0].action.label === "Confirm", o2.rows[0]);
  ok("...one is '1 Google sign-in matches an enrolled account'", officeRows({ school: HIL, can, claims: [claim({})], now: NOW }).rows[0]?.fact === "1 Google sign-in matches an enrolled account");
  const reg = (o) => ({ personId: "p", name: "Mr Khoza", role: "official", school: HIL, kindLabel: "Police clearance", status: "current", expiresOn: null, ...o });
  const o3 = officeRows({ school: HIL, can, register: [reg({ personId: "p1", status: "expired", expiresOn: "2026-10-03" }), reg({ personId: "p2", name: "Ms Dube", status: "expiring", expiresOn: "2026-10-20" }),
    reg({ personId: "p3", status: "current", expiresOn: "2027-01-01" }), reg({ personId: "p1", status: "missing", kindLabel: "Child protection" }), reg({ personId: "p4", name: "Mr Pillay", status: "missing" }),
    reg({ personId: "p5", status: "expired", school: KES, expiresOn: "2026-09-01" })], now: NOW });
  ok("O3: each adult once, by his worst gap: '3 adults without a current clearance: 2 missing, 1 expiring' (p1's two gaps are one adult; a current check is none; another school's is not here)",
     o3.rows[0]?.fact === "3 adults without a current clearance: 2 missing, 1 expiring", o3.rows[0]?.fact);
  ok("...the earliest date on any gap is its deadline, the record's own: 'expired 3 Oct'", o3.rows[0].deadline?.words === "expired 3 Oct" && o3.rows[0].deadline.due === true, o3.rows[0].deadline);
  ok("...it carries the adults' own rows (the register names adults, never children), worst first", o3.rows[0].items.map((r) => r.status).join() === "missing,missing,expiring" && o3.rows[0].items.length === 3, o3.rows[0].items.map((r) => r.status));
  const o3b = officeRows({ school: HIL, can, register: [reg({ personId: "p1", status: "expired", expiresOn: "2026-10-03" }), reg({ personId: "p2", status: "expiring", expiresOn: "2026-10-20" })], now: NOW });
  ok("O3 as the design words it: '2 adults without a current clearance: 1 expired, 1 expiring', the earlier date first", o3b.rows[0].fact === "2 adults without a current clearance: 1 expired, 1 expiring" && o3b.rows[0].deadline.words === "expired 3 Oct");
  ok("...nothing owed is no row", officeRows({ school: HIL, can, register: [reg({ status: "current", expiresOn: "2027-01-01" })], now: NOW }).rows.length === 0);
  const down = officeRows({ school: HIL, can, requests: null, claims: null, register: null, now: NOW, errors: { requests: "unreachable" } });
  ok("a failed office read is a row that says so, in the read's own name; an empty one is none",
     down.unread.map((r) => r.fact).join("|") === "Could not read the requests (unreachable)|Could not read the sign-ins|Could not read the clearance register" && down.rows.length === 0 && down.failed === 3);
  ok("a read the capability does not cover is never asked for, so a null there is not a failure",
     officeRows({ school: HIL, can: { requests: false, claims: false, register: true }, requests: null, claims: null, register: [], now: NOW }).unread.length === 0);
  ok("the lift exceptions are S4b's own five sentences, by name, on a tap",
     liftExceptionRows([{ seatId: "s1", kind: "not_collected", name: "Ben Fictional", leg: "back", driverName: "Mrs Fictional", since: "2026-10-10T12:15:00Z" }])[0]?.fact === "Ben Fictional · Not collected"
     && liftExceptionRows([]).length === 0 && liftExceptionRows(null).length === 0);
}

group("The header's three numbers, always drawn (§3.2)");
{
  const g = (o) => ({ open: 0, failed: 0, loading: false, ...o });
  ok("5 open · 1 read failed · 7 fixtures", headerWords(headerOf(Array.from({ length: 7 }, (_, i) => g(i === 0 ? { open: 3, failed: 1 } : i === 1 ? { open: 2 } : {})))) === "5 open · 1 read failed · 7 fixtures");
  ok("the office's rows count beside the fixtures'", headerOf([g({ open: 1 })], [{ open: 2, failed: 1 }]).open === 3 && headerOf([g({ open: 1 })], [{ open: 2, failed: 1 }]).failed === 1);
  ok("none open and one failed says '0 open · 1 read failed', never 'all clear'", headerWords(headerOf([g({ failed: 1 })])) === "0 open · 1 read failed · 1 fixture" && !/all clear|nothing/i.test(headerWords(headerOf([g({ failed: 1 })]))));
  ok("zero failed is '0 reads failed', one fixture is '1 fixture', none is '0 fixtures'", headerWords(headerOf([])) === "0 open · 0 reads failed · 0 fixtures" && /1 fixture$/.test(headerWords(headerOf([g({})]))));
  ok("groups still reading are counted as loading", headerOf([g({ loading: true }), g({})]).loading === 1);
}

group("Everything the school-wide screen says passes the never-list (§5)");
{
  const THU = THU_AT + 60e3;
  const said = [];
  const rich = answered({ readiness: [rd("a", { declaredStatus: null }), rd("e", { selected: true, clinicallyRestricted: true }), rd("f", { selected: true, declaredStatus: "unavailable" }), rd("g", { declaredStatus: "needs_reconfirming" })],
    squad: sq(7), trips: [{ school: HIL, state: "booked", capacity: 4, seatsTaken: 0 }], duties: [], conditions: { state: "defaults", cap: null, freeHit: null },
    weatherRows: [{ matchId: SAT.id, tempC: 18, condition: "Showers", rainChancePct: 70, forecast: "Rain likely from 14:00", playable: true }] });
  for (const gate of [DIRECTOR_G, gateOf("teammanager", "U15A"), gateOf("schooladmin"), gateOf("principal"), gateOf("coach", "U15A")]) {
    const g = fixtureRows({ match: SAT, gate, reads: rich, now: THU });
    said.push(...g.rows.flatMap((r) => [r.fact, r.owner, r.deadline?.words, r.source, r.action?.label]), g.line);
    const n = fixtureRows({ match: SAT, gate, reads: { ...rich, readiness: null, duties: null, squad: null, trips: null, conditions: { state: "failed" } }, errors: { duties: "unreachable" }, now: THU });
    said.push(...n.unread.map((r) => r.fact), n.line);
  }
  const o = officeRows({ school: HIL, can: { requests: true, claims: true, register: true }, requests: [{ state: "pending", decidable: true, school: HIL, askedUnverified: true, requestedAt: new Date(NOW).toISOString() }],
    claims: [{ school_id: HIL, requested_at: new Date(NOW).toISOString() }], register: [{ personId: "p", status: "expiring", expiresOn: "2026-10-20", school: HIL }], now: NOW });
  said.push(...o.rows.flatMap((r) => [r.fact, r.owner, r.age, r.deadline?.words, r.source, r.action?.label]));
  said.push(headerWords(headerOf([{ open: 1, failed: 1, loading: false }])));
  const words = said.filter(Boolean);
  const bad = words.filter((l) => NEVER_ON_THE_COCKPIT.test(l) || /\b(done|ready|cleared|resolved|complete|completed|all clear|priority|score|risk)\b|%/i.test(l));
  ok(`${words.length} sentences: none holds a never-word, a percentage, 'done', 'ready', 'cleared', 'resolved' or a priority`, words.length > 40 && bad.length === 0, bad);
  ok("...nor a phone number, an email address or a clinical word", words.every((l) => !/\d{3}[ -]?\d{3}[ -]?\d{4}|@|injur|hamstring|concussion|wellness|diagnos/i.test(l)));
  const code = readFileSync(new URL("../src/lib/queue.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  ok("the module's source reads no child's field (the static check holds the A1 code too, comments removed)", !/\.(name|playerId|returnDate|rtw\w*|reason\w*|note|injury\w*|severity|phase)\b/.test(code) && !/\b(rtw_date|reason_kind|injury_type|open_flag)\b/.test(code));
  ok("...it fetches nothing, keeps nothing in storage and tells no time of its own (the caller passes `now`)", !/\bapi\(|fetch\(|localStorage|sessionStorage|Date\.now|new Date\(\)/i.test(code));
  const view = readFileSync(new URL("../src/views/ReadinessOverview.jsx", import.meta.url), "utf8");
  ok("the screen has no 'Seen' control and no 'done' button (D7, §2.6), and its queue reads are the hook's, not its own", !/\bseen\b|markSeen|dismiss/i.test(view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")) && !/\bapi\(|readLive\(/.test(view));
  const hook = readFileSync(new URL("../src/views/cockpit/useQueue.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  ok("the hook asks for no workload, no spells, no notices and no opposition, and the lift exceptions only through its tap",
     !/workload|bowling_spells|opposition|notifications|directives/.test(hook) && (hook.match(/lifts\/exceptions/g) ?? []).length === 1 && /checkLifts/.test(hook));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
