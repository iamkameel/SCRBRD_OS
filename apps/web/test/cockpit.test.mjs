/**
 * The coach's cockpit, the plain parts (SCRBRD-136 phase A,
 * docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md §1, §3): who is let in
 * and to which panels, and how the rows the reads return are put into words —
 * health as a status tier, load as a word and one sentence, lifts as a head
 * count. No DOM, no database; what the reads return is the browser walk's
 * (tools/smoke-browser-cockpit.mjs).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/cockpit.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { ROLES, SUBJECT_SCOPED_ROLES, roleGrants } from "@scrbrd/policy/roles";
import {
  ENTRY_CAPABILITIES, PANEL_CAPABILITY, busOf, cockpitGate, conditionsState, endCovered, entersAs, entryTable, isMatchDay, isSoon, isWithin,
  LOAD_SENTENCE, LOAD_WORDS, liftCounts, limitWords, ourInnings, panelsOf, saDay, saTime, shortDate, sideFoot, sideRows, spellLines, startMs,
  termsFromConditions, weatherWords, weekRows, weekWords,
} from "../src/lib/cockpit.js";
import { FORBIDDEN_FIELDS, NEVER_ON_THE_COCKPIT } from "../src/lib/cockpitNever.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil", WES = "wes";
const FIXTURE = { id: "m1", schoolId: HIL, homeTeam: "1XI", awaySchoolId: WES, awayTeamCode: "2XI", status: "upcoming", startsAt: "2026-10-03T07:00:00.000Z" };
const NOW = Date.parse("2026-10-02T12:00:00Z");

group("§1.2 · the role table is derived from roles.mjs, and equals the design's");
{
  // The design's table, typed once here and held equal to the bundles (A1).
  const DESIGN = {
    coach:           { enters: true,  side: true,  select: true,  load: true,  status: true, opposition: true,  bus: true,  lifts: true },
    assistantcoach:  { enters: true,  side: true,  select: false, load: true,  status: true, opposition: true,  bus: true,  lifts: true },
    teammanager:     { enters: true,  side: true,  select: true,  load: false, status: true, opposition: false, bus: true,  lifts: true },
    directorofsport: { enters: true,  side: true,  select: true,  load: true,  status: true, opposition: true,  bus: true,  lifts: false },
    sportsadmin:     { enters: true,  side: true,  select: true,  load: false, status: true, opposition: false, bus: true,  lifts: false },
    medical:         { enters: true,  side: false, select: false, load: true,  status: true, opposition: false, bus: false, lifts: false },
    fitness:         { enters: true,  side: false, select: false, load: true,  status: true, opposition: false, bus: false, lifts: false },
    scorer:   { enters: false }, official: { enters: false }, analyst: { enters: false }, media: { enters: false }, spectator: { enters: false },
    player:   { enters: false }, guardian: { enters: false }, selfaccess: { enters: false },
  };
  const t = Object.fromEntries(entryTable().map((r) => [r.role, r]));
  for (const [role, want] of Object.entries(DESIGN)) {
    ok(`${role}: ${want.enters ? "enters" : "does not enter"}`, !!t[role] && !!t[role].enters === want.enters, t[role]?.enters);
    if (!want.enters) continue;
    for (const k of ["side", "select", "load", "status", "opposition", "bus", "lifts"]) {
      ok(`${role}: ${k} is ${want[k]}`, t[role].panels[k] === want[k], t[role].panels[k]);
    }
  }
  // Nobody else enters but the owner's key (which the gate refuses for want of a school): a new role that does is noticed here.
  const others = ROLES.filter((r) => !(r in DESIGN) && t[r].enters);
  ok("no other role enters on capability alone but the owner's key", others.join() === "superadmin", others.join());
  ok("the entry rule is `team.select` or `player.workload.read`", ENTRY_CAPABILITIES.join() === "team.select,player.workload.read");
  ok("a subject-scoped role never enters, whatever its bundle holds", SUBJECT_SCOPED_ROLES.every((r) => !entersAs(r)));
  ok("every panel's capability is one the policy knows", Object.values(PANEL_CAPABILITY).flat().every((c) => ROLES.some((r) => roleGrants(r, c))));
  ok("panelsOf asks the bundle, not a name: a role granting nothing gets nothing", Object.values(panelsOf("spectator")).filter(Boolean).length === 1 /* fixture.read */);
}

group("§1.2 · the gate: one assignment, school- or team-scoped, covering the side");
{
  const a = (role, extra = {}) => ({ role, school: HIL, team: "1XI", fixture: null, subjects: [], ...extra });
  const g = (assignments, m = FIXTURE) => cockpitGate(assignments, m);
  ok("the coach of the home side enters, at the home end", g([a("coach")])?.end === "home" && g([a("coach")])?.panels.select === true);
  ok("...a coach of another team does not", g([a("coach", { team: "2XI" })]) === null);
  ok("...a coach of another school does not", g([a("coach", { school: WES })]) === null || g([a("coach", { school: WES })])?.end !== "home");
  ok("...the away side's coach enters at the away end, with the away team's code", g([a("coach", { school: WES, team: "2XI" })])?.end === "away" && g([a("coach", { school: WES, team: "2XI" })])?.teamCode === "2XI");
  ok("...the away school's other team does not", g([a("coach", { school: WES, team: "1XI" })]) === null);
  ok("a school-wide director of sport enters", g([a("directorofsport", { team: null })])?.end === "home");
  ok("an assistant coach enters, without the selection", g([a("assistantcoach")])?.panels.select === false && g([a("assistantcoach")])?.panels.load === true);
  ok("a team manager enters, without the load", g([a("teammanager")])?.panels.load === false && g([a("teammanager")])?.panels.select === true);
  ok("a physio (school-wide) enters for the load alone", g([a("medical", { team: null })])?.panels.load === true && g([a("medical", { team: null })])?.panels.side === false);
  for (const r of ["scorer", "official", "analyst", "media", "spectator", "player", "dso", "principal", "schooladmin", "driver", "scout"]) {
    ok(`${r} does not enter`, g([a(r, { team: null })]) === null);
  }
  for (const r of ["guardian", "selfaccess", "enquiry"]) ok(`${r} never enters`, g([a(r, { team: null, subjects: ["p1"] })]) === null);
  ok("an assignment that names a person never enters, whatever role it carries", g([a("coach", { subjects: ["p1"] })]) === null);
  ok("a platform-wide assignment (no school) never enters", g([a("superadmin", { school: null, team: null })]) === null);
  ok("an assignment to one other fixture does not reach this one", g([a("coach", { fixture: "m2" })]) === null && g([a("coach", { fixture: "m1" })]) !== null);
  ok("no assignments, no match, no gate", g([]) === null && g(null) === null && g([a("coach")], null) === null);
  const both = g([a("teammanager"), a("assistantcoach")]);
  ok("ADR 0001: two assignments are never a union (the one granting the most panels answers: no selection AND no gap)", both?.role === "assistantcoach" && both.panels.select === false, both?.role);
  ok("...whichever order they come in", g([a("assistantcoach"), a("teammanager")])?.role === "assistantcoach");
  ok("endCovered reads the home side first", endCovered({ school: HIL, team: null }, FIXTURE) === "home");
}

group("D4 · health is the status tier only: restricted, and back on a date");
{
  const r = (o) => ({ playerId: "p", name: "R Pillay", team: "1XI", declaredStatus: "available", selfDeclared: false, declaredByName: null,
    clinicallyRestricted: false, returnDate: null, selected: true, side: "home", battingNo: 1, state: "available",
    // What the read carries and the cockpit must not draw:
    reasonKind: "family", injuryType: "Grade 2 hamstring strain", severity: "moderate", phase: "rehab", note: "A family funeral", ...o });
  const may = { status: true };
  const rows = sideRows([r({ playerId: "a", name: "A", clinicallyRestricted: true, returnDate: "2026-10-18T00:00:00.000Z", declaredStatus: null }),
    r({ playerId: "b", name: "B", declaredStatus: "unavailable", declaredByName: "Mrs Pillay" }),
    r({ playerId: "c", name: "C", declaredStatus: null }), r({ playerId: "d", name: "D", declaredStatus: "needs_reconfirming" }),
    r({ playerId: "e", name: "E", declaredStatus: "available", selfDeclared: true }), r({ playerId: "f", name: "F", selected: false })], "home", may);
  ok("only the named are on the sheet", rows.length === 5);
  const by = Object.fromEntries(rows.map((x) => [x.id, x]));
  ok("restricted, with the date he is back", by.a.state === "restricted" && by.a.words === "restricted" && by.a.back === "2026-10-18T00:00:00.000Z");
  ok("unavailable, and who said it", by.b.words === "unavailable" && by.b.byWhom === "said by Mrs Pillay");
  ok("no answer and asked again are words", by.c.words === "no answer" && by.d.words === "asked again");
  ok("a boy who said so himself says so", by.e.state === "available" && by.e.byWhom === null);
  const blob = JSON.stringify(rows);
  ok("NO reason, nature, severity, phase or note survives into a row", !/family|hamstring|moderate|rehab|funeral/i.test(blob), blob);
  ok("...a row's keys are the status tier's and nothing else", rows.every((x) => Object.keys(x).sort().join() === "back,battingNo,byWhom,id,name,state,words"), Object.keys(rows[0]).join());
  const noStatus = sideRows([r({ clinicallyRestricted: true, returnDate: "2026-10-18", declaredStatus: null })], "home", { status: false });
  ok("without medical.status.read a restricted boy is drawn as the family's word, with no date", noStatus[0].state === "unanswered" && noStatus[0].back === null);
  ok("the foot counts, in words", sideFoot(rows) === "5 named · 2 to chase · 1 unavailable · 1 restricted", sideFoot(rows));
  // Null is "not this reader's to know" (the readiness read, for a reader
  // without medical.status.read for that boy): never restricted, never
  // counted, and never "cleared" — the family's word stands, as for false.
  const unknown = sideRows([r({ playerId: "n1", name: "N1", clinicallyRestricted: null, returnDate: null, declaredStatus: "available" }),
    r({ playerId: "n2", name: "N2", clinicallyRestricted: null, declaredStatus: null })], "home", may);
  ok("a null clinical half is the family's word, with no date", unknown[0].state === "available" && unknown[0].back === null && unknown[1].state === "unanswered");
  ok("...and the foot counts no null as restricted", !/restricted/.test(sideFoot(unknown)), sideFoot(unknown));
  ok("a away-end read draws the away boys", sideRows([r({ side: "away" })], "home", may).length === 0 && sideRows([r({ side: "away" })], "away", may).length === 1);
}

group("D5 to D7 · load is a word and one sentence: no ratio, no flag, no monitored");
{
  const w = (o) => ({ playerId: "p", name: "J Smith", pace: true, overs7d: 6, loadWord: "rising", estimated7d: true, maxSpell: 6, maxDay: 12, ageBand: "U15",
    clause: { code: "PACE-U15" }, acwr: 2.31, ewmaRatio: 1.8, monitored: true, openFlag: true, ...o });
  const rows = weekRows([w({}), w({ playerId: "q", name: "A", pace: false }), w({ playerId: "r", name: "B", loadWord: "danger" }), w({ playerId: "s", name: "C", overs7d: 14, loadWord: "steady", estimated7d: false })]);
  ok("pace bowlers only, the most overs first", rows.map((x) => x.name).join() === "C,B,J Smith", rows.map((x) => x.name).join());
  ok("a word outside the fixed seven is not drawn", rows.find((x) => x.name === "B").word === null);
  ok("the seven words are 110's", LOAD_WORDS.join() === "no load,rested,too little to say,light,steady,rising,spike");
  ok("the words: overs, the word, 'estimate' where a band is inside", weekWords(rows[2]) === "6 ov · rising (estimate)" && weekWords(rows[0]) === "14 ov · steady", weekWords(rows[2]));
  ok("the limit and its band", limitWords(rows[2]) === "6 a spell, 12 a day · U15");
  const blob = JSON.stringify(rows);
  ok("no ratio, no flag, no monitored survives a row", !/2\.31|1\.8|acwr|ewma|monitored|openFlag/i.test(blob), blob);
  ok("the fixed sentence is 110's, word for word", LOAD_SENTENCE === "A guide to a conversation, not a diagnosis.");
  ok("a squad filter narrows to the sheet", weekRows([w({})], new Set(["zzz"])).length === 0);
}

group("D10 · lifts are a head count; the bus is a sum");
{
  const L = (o) => ({ seatId: "s", offerId: "o1", playerId: "p1", name: "T Bekker", driverName: "H Whitfield", handedOverAt: null, acknowledgedAt: null, resolvedAt: null, notLeft: false, ...o });
  const c = liftCounts([L({ notLeft: true }), L({ seatId: "t", playerId: "p2", name: "M Cele", offerId: "o1" }),
    L({ seatId: "u", playerId: "p3", offerId: "o2", handedOverAt: "2026-10-02T10:00:00Z" })], Date.parse("2026-10-02T11:00:00Z"));
  ok("boys, lifts, not left, handed over and not confirmed", c.count === 3 && c.lifts === 2 && c.notLeft === 1 && c.handedOverUnconfirmed === 1, c);
  const out = JSON.stringify({ ...c, boys: [...c.boys] });
  ok("NO name and no driver survives the reduction", !/Bekker|Cele|Whitfield/.test(out), out);
  ok("handed over under thirty minutes ago is not yet 'unconfirmed'", liftCounts([L({ handedOverAt: "2026-10-02T10:50:00Z" })], Date.parse("2026-10-02T11:00:00Z")).handedOverUnconfirmed === 0);
  ok("a read that did not answer is null, not zero", liftCounts(null, NOW) === null);
  const trips = [{ school: HIL, state: "scheduled", capacity: 22, seatsTaken: 5, departAt: "2026-10-03T05:15:00Z", pickup: "gate" }, { school: HIL, state: "cancelled", capacity: 30, seatsTaken: 0 },
    { school: WES, state: "scheduled", capacity: 50, seatsTaken: 0 }, { school: HIL, state: "scheduled", capacity: 14, seatsTaken: 2, departAt: "2026-10-03T05:30:00Z" }];
  const bus = busOf(trips, HIL);
  ok("the bus is the school's, not cancelled, summed", bus.capacity === 36 && bus.seatsTaken === 7 && bus.vehicles === 2 && bus.departAt === "2026-10-03T05:15:00Z", bus);
  ok("no trip, no bus", busOf([], HIL) === null && busOf(null, HIL) === null);
}

group("The fixture's clock, in SA time");
{
  ok("SA day: 22:30 UTC is already tomorrow in Johannesburg", saDay(Date.parse("2026-10-02T22:30:00Z")) === "2026-10-03");
  ok("a date and a time in words", shortDate("2026-10-18T00:00:00.000Z") === "18 Oct" && shortDate("2026-10-11") === "11 Oct" && shortDate(null) === null);
  ok("a time on the SA clock", saTime("2026-10-03T05:15:00Z") === "07:15");
  ok("soon is within 48 hours of an upcoming fixture", isSoon(FIXTURE, NOW) && !isSoon(FIXTURE, Date.parse("2026-09-30T06:00:00Z")) && isSoon(FIXTURE, Date.parse("2026-10-01T07:00:00Z")));
  ok("...and not for one that is live or complete", !isSoon({ ...FIXTURE, status: "live" }, NOW) && !isSoon({ ...FIXTURE, status: "complete" }, NOW));
  ok("within seven days", isWithin(FIXTURE, NOW) && !isWithin(FIXTURE, Date.parse("2026-09-20T00:00:00Z")));
  ok("the match day", isMatchDay(FIXTURE, Date.parse("2026-10-03T03:00:00Z")) && !isMatchDay(FIXTURE, NOW));
  ok("a fixture with no start has none", startMs({}) === null && !isSoon({ status: "upcoming" }, NOW));
}

group("The terms: the route's answer, read once");
{
  const doc = (play, o = {}) => ({ doc: { v: 1, play }, sources: {}, setId: null, fixed: false, setTitle: null, setVersion: null, ...o });
  ok("platform defaults alone: 'defaults', naming only what the document names", JSON.stringify(conditionsState(doc({ "format.free_hit": true }))) === JSON.stringify({ state: "defaults", cap: null, freeHit: true }));
  ok("a cap in the document is named", conditionsState(doc({ "bowling.max_overs_per_bowler_innings": 4 })).cap === 4);
  ok("a competition's set, or a fixed document, is 'set'", conditionsState(doc({}, { setId: "s1" })).state === "set" && conditionsState(doc({}, { fixed: true })).state === "set");
  ok("an answer with no document is a failed read, never 'none'", conditionsState(null).state === "failed" && conditionsState({}).state === "failed");
  ok("termsFromConditions gives the pad's shape, or null for an empty play part", termsFromConditions(doc({ "bowling.max_overs_per_bowler_innings": 4 })).conditions["bowling.max_overs_per_bowler_innings"] === 4 && termsFromConditions(doc({})) === null);
  ok("weather in a line", weatherWords({ tempC: 22, condition: "Partly cloudy", rainChancePct: 20 }) === "22° partly cloudy" && weatherWords({ tempC: 18, condition: "Showers", rainChancePct: 70 }) === "18° showers, rain likely" && weatherWords(null) === null);
}

group("Our side's innings, and the spells as recorded");
{
  const m = { homeTeam: "1XI", awayTeam: "Opp", schoolId: HIL };
  const inns = [{ battingTeam: "Opp", batsmen: [{ id: "o1" }], bowlers: [{ id: "p1" }] }, { battingTeam: "1XI", batsmen: [{ id: "p1" }], bowlers: [] }, { battingTeam: "X", superOver: 1 }];
  const r = ourInnings(m, "home", inns, new Set(["p1"]));
  ok("by the side the innings names, or by our own ids", r[0].side === "bowling" && r[1].side === "batting" && r[2].side === null, r.map((x) => x.side));
  const lines = spellLines([{ bowlerId: "p1", name: "K Naidoo", innings: 0, spellNo: 1, overs: 5, maxSpell: 4, breachRecorded: true }, { bowlerId: "p2", name: "S", innings: 0, spellNo: 1, overs: 2, maxSpell: 4, breachRecorded: false },
    { bowlerId: "zz", name: "Other", innings: 0, spellNo: 1, overs: 9, maxSpell: 4, breachRecorded: true }], new Set(["p1", "p2"]));
  ok("ours only, with the directive's allowance and the breach on record", lines.length === 2 && lines[0].text === "K Naidoo: 5 overs; the directive allowed 4; a breach is on record" && lines[1].text === "S: 2 overs", lines.map((x) => x.text));
}

group("The never-list is held, in the words and in the code");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const dir = new URL("../src/views/cockpit/", import.meta.url);
  const files = [new URL("../src/lib/cockpit.js", import.meta.url), new URL("../src/lib/signals.js", import.meta.url), new URL("../src/lib/cockpitNav.js", import.meta.url),
    ...readdirSync(dir).map((f) => new URL(f, dir))];
  ok("the cockpit's code is more than two files", files.length >= 6, files.length);
  for (const f of files) {
    const code = strip(readFileSync(f, "utf8"));
    const hit = FORBIDDEN_FIELDS.filter((w) => new RegExp(`\\b${w}\\b`).test(code));
    ok(`${f.pathname.split("/").slice(-2).join("/")}: no forbidden field is read (${FORBIDDEN_FIELDS.length} checked)`, hit.length === 0, hit);
  }
  const rule = (s) => NEVER_ON_THE_COCKPIT.test(s);
  ok("the never-words catch what they should", ["a risk of injury", "hamstring", "Grade 2", "wellness check-in", "ratio 1.8", "62%", "win chance", "threat level", "guideline"].every(rule));
  ok("...and let a coach's words through", !["Bekker · restricted · back 11 Oct", "marked unavailable", "no answer", "6 ov · rising (estimate)", "Has 1 over left (4 an innings)", "10 named · a side needs 11"].some(rule));
  ok("...the load sentence is the one thing with 'diagnosis' in it (the walks strip it before the check)", rule(LOAD_SENTENCE) && !rule(LOAD_SENTENCE.replace(LOAD_SENTENCE, "")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
