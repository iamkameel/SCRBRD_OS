/**
 * The intelligence feed's rules (SCRBRD-137 phase A,
 * docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md §4.3): each rule
 * against hand-built rows, at its threshold and one short of it; its gate; its
 * words; and what a dismissal holds. No DOM, no database, no clock: the clock
 * is passed in, and the rows are the reads' own, adapted.
 *
 * The browser walk (tools/smoke-browser-cockpit.mjs) holds the drawer's cards
 * to the reads over HTTP; this holds the rules to the design.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/signals.test.mjs
 */
import { readFileSync } from "node:fs";
import { capWords } from "@scrbrd/scoring";
import { panelsOf, LOAD_SENTENCE } from "../src/lib/cockpit.js";
import { FORBIDDEN_FIELDS, NEVER_ON_THE_COCKPIT } from "../src/lib/cockpitNever.js";
import { EXCEPTION_WORDS } from "../src/lib/liftWords.js";
import {
  RULES, RULE_ORDER, MATCHUP_FLOOR, MATCHUP_GROWTH, evaluate, isSeen, markSeen, unseen, ruleS1, ruleS2a, ruleS2b, ruleS3, ruleS4a, ruleS4b, ruleS5, ruleS6, ruleS7, ruleS8, ruleS9, ruleS10, ruleS11, ruleS12,
} from "../src/lib/signals.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const HIL = "hil";
const NOW = Date.parse("2026-10-02T12:00:00Z");              // Friday noon (SA 14:00)
const SOON = { id: "m1", schoolId: HIL, homeTeam: "1XI", status: "upcoming", startsAt: "2026-10-03T07:00:00.000Z", date: "2026-10-03" };
const FAR = { ...SOON, startsAt: "2026-10-09T07:00:00.000Z", date: "2026-10-09" };
const DAYOF = { ...SOON, startsAt: "2026-10-02T17:00:00.000Z" };    // 19:00 SA the same day
const gateOf = (role, o = {}) => ({ end: "home", school: HIL, teamCode: "1XI", panels: panelsOf(role), ...o });
const COACH = gateOf("coach"), ASSIST = gateOf("assistantcoach"), MANAGER = gateOf("teammanager"), PHYSIO = gateOf("medical", { teamCode: null });
const base = (o = {}) => ({ now: NOW, match: SOON, gate: COACH, squad: [], readiness: null, workload: null, spells: null, trips: null, lifts: null, liftExceptions: null,
  weather: null, duties: null, conditions: { state: "set", cap: null, freeHit: null }, notices: null, matchups: null, fielding: [], capFor: null, ...o });
const sheet = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, side: "home", twelfth: false, name: `Boy ${i + 1}`, battingNo: i + 1, ...extra }));

group("S1 · The bus is short");
{
  const trips = (cap, taken = 0) => [{ school: HIL, state: "scheduled", capacity: cap, seatsTaken: taken }];
  const c = (named, cap, o = {}) => base({ squad: sheet(named), trips: trips(cap), ...o });
  ok("22 seats, 23 named: one short, fires", ruleS1(c(23, 22, { lifts: { boys: new Set(), count: 0 } })).length === 1 && ruleS1(c(23, 22, { lifts: { boys: new Set(), count: 0 } }))[0].count === 1);
  ok("...22 named: not one short, silent", ruleS1(c(22, 22, { lifts: { boys: new Set(), count: 0 } })).length === 0);
  const lifts = { boys: new Set(["p1", "p2"]), count: 2 };
  ok("two by lift: 23 named travel as 21, silent", ruleS1(c(23, 22, { lifts })).length === 0);
  ok("...25 named, 2 by lift, 22 seats: 23 travelling, one short, and says so",
     ruleS1(c(25, 22, { lifts }))[0]?.lines[0] === "Bus seats 22 · 25 named, 2 by lift → 23 travelling" && ruleS1(c(25, 22, { lifts }))[0]?.count === 1);
  ok("a lift boy not on our sheet is not subtracted", ruleS1(c(23, 22, { lifts: { boys: new Set(["zz", "yy"]), count: 2 } }))[0]?.count === 1);
  const noLiftCap = gateOf("directorofsport");
  ok("a reader who may not count lifts is told 'lifts not counted'", ruleS1(c(23, 22, { gate: noLiftCap }))[0]?.lines[0] === "Bus seats 22 · 23 named (lifts not counted)");
  ok("...a reader who may count them, whose lift read did not answer, is not told the bus is short", ruleS1(c(23, 22, { lifts: null })).length === 0);
  ok("seats taken above the capacity fires on its own", ruleS1(base({ squad: sheet(3), trips: trips(4, 6), lifts: { boys: new Set(), count: 0 } }))[0]?.count === 2);
  ok("no trip, no card; a cancelled trip is no bus", ruleS1(c(30, 22, { trips: [] })).length === 0 && ruleS1(c(30, 22, { trips: [{ school: HIL, state: "cancelled", capacity: 1, seatsTaken: 0 }] })).length === 0);
  ok("the gate is transport.read and team.read", ruleS1(c(30, 22, { gate: PHYSIO })).length === 0 && ruleS1(c(30, 22, { trips: null })).length === 0);
  ok("the card names nobody", !/Boy \d/.test(JSON.stringify(ruleS1(c(25, 22, { lifts })))));
  ok("a different bus or squad is different evidence (the key changes)", ruleS1(c(25, 22, { lifts }))[0].key !== ruleS1(c(26, 22, { lifts }))[0].key);
}

group("S2a · A bowler at the competition's cap: the pad's own sentences, verbatim");
{
  const PLAY = { "bowling.max_overs_per_bowler_innings": 4 };
  const capFor = (balls) => capWords(balls, PLAY);
  const inn = (...balls) => ({ bowlers: balls.map((b, i) => ({ id: `b${i}`, name: `Bowler ${i}`, balls: b })) });
  const run = (balls, inPlay = true) => ruleS2a(base({ capFor, fielding: [{ inn: inn(balls), i: 0, inPlay }] }));
  ok("two overs and five balls: nothing to say", run(17).length === 0);
  ok("three overs: 'Has 1 over left (4 an innings)'", run(18)[0]?.lines[0] === "Bowler 0 · Has 1 over left (4 an innings)");
  ok("four overs: 'Has bowled his 4 overs'", run(24)[0]?.lines[0] === "Bowler 0 · Has bowled his 4 overs");
  ok("four overs and a ball: '4.1 overs; the conditions allow 4'", run(25)[0]?.lines[0] === "Bowler 0 · 4.1 overs; the conditions allow 4");
  ok("five overs: '5 overs; the conditions allow 4'", run(30)[0]?.lines[0] === "Bowler 0 · 5 overs; the conditions allow 4");
  ok("the sentence is capWords()'s, whatever the figure — no fourth sentence is invented", [0, 6, 12, 17, 18, 24, 25, 29, 30, 36].every((b) => {
    const got = run(b)[0]?.lines[0]?.split(" · ")[1] ?? null;
    return got === capWords(b, PLAY);
  }));
  ok("in play a card cannot be dismissed (it clears with the over)", run(18)[0].dismissable === false);
  ok("after the innings only the one who went past the cap keeps a card, and it can be dismissed",
     run(18, false).length === 0 && run(24, false).length === 0 && run(30, false)[0]?.dismissable === true);
  ok("no conditions, no cap, no card", ruleS2a(base({ capFor: null, fielding: [{ inn: inn(24), i: 0, inPlay: true }] })).length === 0);
  ok("a bowler who has not bowled has none", run(0).length === 0);
}

group("S2b · A bowler one over from the directive's spell");
{
  const spell = (o = {}) => ({ bowlerId: "b1", name: "T Cele", innings: 0, spellNo: 1, overs: 5, maxSpell: 6, ageBand: "U15", pace: true, ...o });
  const f = (o = {}) => ({ inn: { bowler: "b1", bowlers: [{ id: "b1", name: "T Cele" }], ...o }, i: 0, inPlay: true });
  const run = (sp, field = [f()], g = COACH) => ruleS2b(base({ gate: g, spells: sp, fielding: field }));
  ok("five of six: fires, with the band's directive", run([spell()])[0]?.lines[0] === "T Cele · spell 5 of 6 (U15 directive)");
  ok("four of six: one short of the threshold, silent", run([spell({ overs: 4 })]).length === 0);
  ok("six of six, seven of six: fires", run([spell({ overs: 6 })]).length === 1 && run([spell({ overs: 7 })]).length === 1);
  ok("a spinner is under no limit: silent", run([spell({ pace: false })]).length === 0 && run([spell({ maxSpell: null })]).length === 0);
  ok("only the bowler on now has an open spell", run([spell()], [f({ bowler: "b2" })]).length === 0);
  ok("the latest spell is the open one", run([spell({ spellNo: 1, overs: 6 }), spell({ spellNo: 2, overs: 1 })]).length === 0);
  ok("never after the innings; never without player.workload.read", run([spell()], [{ ...f(), inPlay: false }]).length === 0 && run([spell()], [f()], MANAGER).length === 0);
  ok("it clears by itself", run([spell()])[0].dismissable === false);
}

group("S3 · A picked boy is unavailable, restricted or asking again");
{
  const r = (o) => ({ playerId: "p1", name: "R Pillay", selected: true, side: "home", declaredStatus: "available", clinicallyRestricted: false, returnDate: null, selfDeclared: false, declaredByName: null, ...o });
  const run = (rows, g = COACH) => ruleS3(base({ gate: g, readiness: rows }));
  ok("unavailable and picked: fires, with who said it", run([r({ declaredStatus: "unavailable", declaredByName: "Mrs Pillay" })])[0]?.lines[0] === "R Pillay · on the sheet · marked unavailable (said by Mrs Pillay)");
  ok("restricted: the date, nothing of the nature", run([r({ clinicallyRestricted: true, returnDate: "2026-10-14T00:00:00.000Z" })])[0]?.lines[0] === "R Pillay · restricted · back 14 Oct");
  ok("asked again", run([r({ declaredStatus: "needs_reconfirming" })])[0]?.lines[0] === "R Pillay · on the sheet · asked again: the fixture has moved");
  ok("available, doubtful or unanswered: silent", ["available", "doubtful", null].every((s) => run([r({ declaredStatus: s })]).length === 0));
  ok("not picked: silent", run([r({ selected: false, declaredStatus: "unavailable" })]).length === 0);
  ok("one card per boy, in the read's order", run([r({ playerId: "a", declaredStatus: "unavailable" }), r({ playerId: "b", clinicallyRestricted: true }), r({ playerId: "c" })]).length === 2);
  ok("it needs the selection: an assistant coach, who does not select, has none", run([r({ declaredStatus: "unavailable" })], ASSIST).length === 0);
  ok("a restricted boy is not told to a reader without medical.status.read", run([r({ clinicallyRestricted: true })], { ...COACH, panels: { ...COACH.panels, status: false } }).length === 0);
  ok("his status changing again changes the evidence", run([r({ clinicallyRestricted: true, returnDate: "2026-10-14" })])[0].key !== run([r({ clinicallyRestricted: true, returnDate: "2026-10-21" })])[0].key);
  const blob = JSON.stringify(run([r({ declaredStatus: "unavailable", reasonKind: "bereavement", note: "A family funeral", injuryType: "Grade 2 hamstring strain" })]));
  ok("NO reason and NO nature on a card, though the row carried both", !/bereavement|funeral|hamstring|strain/i.test(blob), blob);
}

group("S4a · Lifts to chase: a head count, on the match day");
{
  const lifts = (o = {}) => ({ boys: new Set(["a", "b"]), count: 2, lifts: 2, notLeft: 1, handedOverUnconfirmed: 0, ...o });
  const run = (l, m = DAYOF, g = COACH) => ruleS4a(base({ match: m, lifts: l, gate: g }));
  ok("one lift not marked as leaving: fires", run(lifts())[0]?.lines.join(" | ") === "2 arriving by lift | 1 lift not marked as leaving");
  ok("handed over, not yet confirmed: fires", run(lifts({ notLeft: 0, handedOverUnconfirmed: 1 }))[0]?.lines[1] === "1 handed over, not yet confirmed");
  ok("two lifts late are 'lifts'", run(lifts({ notLeft: 2 }))[0]?.lines[1] === "2 lifts not marked as leaving");
  ok("nothing to chase: silent", run(lifts({ notLeft: 0, handedOverUnconfirmed: 0 })).length === 0);
  ok("only on the match day", run(lifts(), SOON).length === 0);
  ok("only for transport.lift.receive (the director of sport has no lift capability)", run(lifts(), DAYOF, gateOf("directorofsport")).length === 0 && run(lifts(), DAYOF, MANAGER).length === 1);
  ok("a read that did not answer is silent", run(null).length === 0);
  ok("the count is the card's count", run(lifts())[0].count === 2);
}

group("S4b · A lift exception by name: the office's, never the coach's");
{
  const row = { seatId: "s1", kind: "not_collected", name: "T Bekker", driverName: "H Whitfield", leg: "back", since: "2026-10-02T15:10:00Z" };
  const OFFICE = gateOf("sportsadmin", { teamCode: null });
  ok("the office sees it by name, with the five kinds in db/76's words", ruleS4b(base({ gate: OFFICE, liftExceptions: [row] }))[0]?.lines[0] === `T Bekker · ${EXCEPTION_WORDS.not_collected}` && Object.keys(EXCEPTION_WORDS).length === 5);
  ok("...with the driver and the time since, on the SA clock", ruleS4b(base({ gate: OFFICE, liftExceptions: [row] }))[0]?.lines[1] === "Home with H Whitfield · since 17:10");
  ok("the coach, whatever the read returned, has none", ruleS4b(base({ gate: COACH, liftExceptions: [row] })).length === 0 && ruleS4b(base({ gate: ASSIST, liftExceptions: [row] })).length === 0);
  ok("no rows, no cards", ruleS4b(base({ gate: OFFICE, liftExceptions: [] })).length === 0 && ruleS4b(base({ gate: OFFICE, liftExceptions: null })).length === 0);
}

group("S5 · A matchup with enough balls: thirty, and not before");
{
  const row = (balls, o = {}) => ({ bowlingStyle: "Right-arm fast", balls, runs: 31, dismissals: 3, ...o });
  const run = (rows, cov = { attributable: 48, deliveries: 61 }, m = SOON, g = COACH) => ruleS5(base({ gate: g, match: m, squad: sheet(1), matchups: { p1: { rows, coverage: cov } } }));
  ok("29 balls: silent", run([row(29)]).length === 0);
  ok("30 balls: fires", run([row(30)]).length === 1 && MATCHUP_FLOOR === 30);
  ok("the sentence: the type, balls, runs, dismissals, and what is attributable", run([row(48)])[0]?.lines.join(" | ") === "Boy 1 v pace · 48 balls · 31 runs · out 3 times | 48 of 61 balls attributable", run([row(48)])[0]?.lines);
  ok("two bowlers of one type are one type", run([row(20, { runs: 10, dismissals: 1 }), row(15, { runs: 5, dismissals: 1 })])[0]?.count === 35);
  ok("pace and spin are two cards", run([row(40), row(31, { bowlingStyle: "Left-arm orthodox" })]).length === 2);
  ok("a bowling style that names no type is no card", run([row(50, { bowlingStyle: null })]).length === 0);
  ok("before the match only", run([row(50)], undefined, { ...SOON, status: "live" }).length === 0 && run([row(50)], undefined, { ...SOON, status: "complete" }).length === 0);
  ok("needs player.performance.read", run([row(50)], undefined, SOON, gateOf("teammanager")).length === 0);
  const card = run([row(48)])[0], grown = run([row(48 + MATCHUP_GROWTH - 1)])[0], more = run([row(48 + MATCHUP_GROWTH)])[0];
  const seen = markSeen({}, card);
  ok(`dismissed, it does not return until the balls have grown by ${MATCHUP_GROWTH}`, isSeen(grown, seen) && !isSeen(more, seen));
  ok("no bowler is named on it", !/Right-arm|orthodox/.test(JSON.stringify(card)));
}

group("S6 · The sheet is thin");
{
  const run = (n, m = SOON, g = COACH) => ruleS6(base({ squad: sheet(n), match: m, gate: g }));
  ok("ten named: fires", run(10)[0]?.lines[0] === "10 named · a side needs 11" && run(10)[0]?.count === 10);
  ok("eleven named: not one short, silent", run(11).length === 0);
  ok("an empty sheet is said", run(0)[0]?.lines[0] === "The sheet is empty");
  ok("the twelfth man is not one of the eleven", ruleS6(base({ squad: [...sheet(10), { playerId: "t", side: "home", twelfth: true, name: "T" }] }))[0]?.count === 10);
  ok("the other side's boys are not ours", ruleS6(base({ squad: [...sheet(8), ...sheet(5, { side: "away", playerId: "x" })] }))[0]?.count === 8);
  ok("only when the fixture is soon", run(10, FAR).length === 0 && run(10, { ...SOON, status: "live" }).length === 0);
  ok("only for the selector", run(10, SOON, ASSIST).length === 0 && run(10, SOON, MANAGER).length === 1);
  ok("a read that did not answer is silent", ruleS6(base({ squad: null })).length === 0);
  ok("no name on it", !/Boy/.test(JSON.stringify(run(10))));
}

group("S7 · Unanswered: a count, never a name");
{
  const r = (s, o = {}) => ({ playerId: Math.random().toString(), name: "Boy", team: "1XI", declaredStatus: s, ...o });
  const run = (rows, m = SOON, g = COACH) => ruleS7(base({ readiness: rows, match: m, gate: g }));
  const rows = [r(null), r(null), r(null), r("needs_reconfirming"), r("available"), r("unavailable")];
  ok("three have not answered, one to answer again", run(rows)[0]?.lines.join(" | ") === "3 have not answered | 1 to answer again (the fixture moved)" && run(rows)[0]?.count === 4);
  ok("one is 'has'", run([r(null)])[0]?.lines[0] === "1 has not answered");
  ok("everyone answered: silent", run([r("available"), r("unavailable"), r("doubtful")]).length === 0);
  ok("the roster of our team only", run([r(null, { team: "2XI" })]).length === 0);
  ok("only when the fixture is soon", run(rows, FAR).length === 0);
  ok("needs availability.read: a physio has none", run(rows, SOON, PHYSIO).length === 0);
  ok("no name and no reason on it", !/Boy|reason|family/i.test(JSON.stringify(run(rows))));
  ok("a new answer changes the evidence", run(rows)[0].key !== run([...rows.slice(1)])[0].key);
}

group("S8 · No scorer or umpire on record");
{
  const run = (duties, m = SOON, g = COACH) => ruleS8(base({ duties, match: m, gate: g }));
  ok("none of either: two cards, in words", run([]).map((c) => c.lines[0]).join() === "No scorer on record for 3 Oct,No umpire on record for 3 Oct");
  ok("an umpire on record: only the scorer is missing", run([{ duty: "umpire" }]).map((c) => c.base.split(":").pop()).join() === "scorer");
  ok("both on record: silent", run([{ duty: "umpire" }, { duty: "scorer" }]).length === 0);
  ok("no word like 'pending'", !/pending/i.test(JSON.stringify(run([]))));
  ok("only when the fixture is soon; a failed read is silent", run([], FAR).length === 0 && run(null).length === 0);
}

group("S9 · Weather");
{
  const w = (o) => ({ rainChancePct: 39, playable: true, condition: "Cloudy", tempC: 22, forecast: "Dry", ...o });
  const run = (x, m = SOON) => ruleS9(base({ weather: x, match: m }));
  ok("39 in 100: silent; 40: fires", run(w({})).length === 0 && run(w({ rainChancePct: 40 })).length === 1);
  ok("not playable fires whatever the chance", run(w({ playable: false })).length === 1);
  ok("the weather read's own words, then the rest", run(w({ rainChancePct: 70, forecast: "Rain likely from 14:00" }))[0]?.lines.join(" | ") === "Rain likely from 14:00 | 22° cloudy, rain likely · 70 in 100 chance of rain");
  ok("only when the fixture is soon", run(w({ rainChancePct: 90 }), FAR).length === 0 && run(null).length === 0);
  ok("no percent sign", !/%/.test(JSON.stringify(run(w({ rainChancePct: 70 })))));
}

group("S10 · No playing conditions");
{
  const run = (conditions, m = SOON) => ruleS10(base({ conditions, match: m }));
  ok("the platform defaults alone, soon: fires, saying only what the document says", run({ state: "defaults", cap: null, freeHit: true })[0]?.lines[1] === "no cap on a bowler's overs · a free hit after a no-ball");
  ok("...a cap the document names is named", run({ state: "defaults", cap: 4, freeHit: false })[0]?.lines[1] === "4 overs a bowler · no free hit");
  ok("a competition's set governs it: silent", run({ state: "set", cap: null, freeHit: null }).length === 0);
  ok("a route that failed says nothing", run({ state: "failed", cap: null, freeHit: null }).length === 0);
  ok("only when the fixture is soon", run({ state: "defaults", cap: null, freeHit: null }, FAR).length === 0);
}

group("S11 · A bowler's week: rising or spike, with the fixed sentence");
{
  const w = (o) => ({ playerId: "p1", name: "J Smith", pace: true, loadWord: "rising", overs7d: 6, estimated7d: false, ...o });
  const run = (rows, g = COACH) => ruleS11(base({ gate: g, workload: rows, squad: sheet(2) }));
  ok("rising: the overs, the word, the sentence", run([w()])[0]?.lines.join(" | ") === `J Smith · 6 overs this week · rising | ${LOAD_SENTENCE}`);
  ok("spike fires; steady, light, rested, too little to say, no load do not", run([w({ loadWord: "spike" })]).length === 1
     && ["steady", "light", "rested", "too little to say", "no load"].every((x) => run([w({ loadWord: x })]).length === 0));
  ok("an estimate says so", run([w({ estimated7d: true })])[0]?.lines[0] === "J Smith · 6 overs this week · rising (estimate)");
  ok("one over is 'over'", run([w({ overs7d: 1 })])[0]?.lines[0].includes("1 over this week"));
  ok("pace bowlers on the sheet only", run([w({ pace: false })]).length === 0 && run([w({ playerId: "zz" })]).length === 0);
  ok("needs player.workload.read: the team manager has none", run([w()], MANAGER).length === 0 && run([w()], ASSIST).length === 1);
  ok("the word changing changes the evidence", run([w()])[0].key !== run([w({ loadWord: "spike" })])[0].key);
  const blob = JSON.stringify(run([w({ ewmaRatio: 1.82, acwr: 2.3, monitored: true, openFlag: true, units7d: 99 })]));
  ok("no ratio, no flag, no word 'risk' even if the row carried them", !/1\.82|2\.3|monitored|openFlag|99/.test(blob) && !/\brisk\b/i.test(blob.replace(LOAD_SENTENCE, "")), blob);
}

group("S12 · A notice for this fixture, as published");
{
  const n = (o) => ({ id: "n1", type: "welfare", title: "Bowling directive exceeded", body: "A boy is 5 overs into a spell. Take him off.", subjectKind: "match", subjectId: "m1", ...o });
  const run = (rows) => ruleS12(base({ notices: rows }));
  ok("welfare, selection and transport notices about this match", ["welfare", "selection", "transport"].every((k) => run([n({ type: k })]).length === 1));
  ok("the notice is as published, word for word", run([n()])[0]?.lines.join(" | ") === "Bowling directive exceeded | A boy is 5 overs into a spell. Take him off.");
  ok("not injury, not training, not another match, not about nothing", [{ type: "injury" }, { type: "training" }, { subjectId: "m2" }, { subjectKind: null }, { subjectKind: "injury" }].every((o) => run([n(o)]).length === 0));
  ok("nothing derived: a failed read is silent", run(null).length === 0);
}

group("Every rule: its gate, its order, its words");
{
  const everyone = base({ gate: COACH });
  ok("the twelve rules (S1 to S12, S2 and S4 in parts) are listed, in the design's order", RULE_ORDER.join() === "S1,S2a,S2b,S3,S4a,S4b,S5,S6,S7,S8,S9,S10,S11,S12");
  ok("S2c is not here: it needs bowler_day, which is phase B", !("S2c" in RULES));
  ok("every rule names a read and a capability that lets him see it", Object.values(RULES).every((r) => r.source && r.via.length > 0 && r.title));
  ok("with a reader holding nothing but the fixture, only the rules the fixture alone gates speak (S8, S9, S10)", evaluate({ ...everyone, gate: gateOf("spectator"), squad: sheet(3), trips: [{ school: HIL, state: "s", capacity: 1, seatsTaken: 9 }],
    readiness: [{ playerId: "x", selected: true, side: "home", declaredStatus: "unavailable", team: "1XI", name: "X" }], workload: [{ playerId: "p1", pace: true, loadWord: "spike", name: "J", overs7d: 9 }],
    duties: [], weather: { rainChancePct: 99, playable: false }, conditions: { state: "defaults", cap: null, freeHit: null },
    lifts: { boys: new Set(["p1"]), count: 1, notLeft: 1, handedOverUnconfirmed: 0 } }).filter((c) => c.rule !== "S8" && c.rule !== "S9" && c.rule !== "S10").length === 0);
  ok("evaluate files a card under the fixture too", evaluate(base({ squad: sheet(3) })).every((c) => c.base.startsWith("m1:")));
  ok("evaluate over nothing is nothing", evaluate(null).length === 0 && evaluate({ gate: COACH }).length === 0);
}

group("D13 · Seen: per evidence, and nothing else");
{
  const card = ruleS6(base({ squad: sheet(10) }))[0];
  ok("a fresh person has seen nothing", !isSeen(card, {}) && unseen([card], {}).length === 1);
  const seen = markSeen({}, card);
  ok("seeing a card hides it", isSeen(card, seen) && unseen([card], seen).length === 0);
  const changed = ruleS6(base({ squad: sheet(9) }))[0];
  ok("...until its evidence changes (nine named, not ten)", !isSeen(changed, seen) && unseen([changed], seen).length === 1);
  ok("seeing is pure: the old store is untouched", Object.keys({}).length === 0 && Object.keys(seen).length === 1);
  const unseeable = ruleS2a(base({ capFor: (b) => capWords(b, { "bowling.max_overs_per_bowler_innings": 4 }), fielding: [{ inn: { bowlers: [{ id: "b", name: "B", balls: 24 }] }, i: 0, inPlay: true }] }))[0];
  ok("a card that clears by itself cannot be marked seen", !isSeen(unseeable, markSeen({}, unseeable)));
  ok("seeing it on another fixture is not seeing it here", !isSeen({ ...card, base: "m2:S6" }, seen));
}

group("The static check: the rules read none of what they must not, and touch nothing");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const code = strip(readFileSync(new URL("../src/lib/signals.js", import.meta.url), "utf8"));
  const hit = FORBIDDEN_FIELDS.filter((w) => new RegExp(`\\b${w}\\b`).test(code));
  ok(`no forbidden field is read (${FORBIDDEN_FIELDS.join(", ")})`, hit.length === 0, hit);
  ok("it fetches nothing and writes nothing (no api, no storage, no clock of its own)", !/\bapi\(|fetch\(|localStorage|sessionStorage|Date\.now|new Date\(\)|XMLHttpRequest/i.test(code), code.match(/\bapi\(|fetch\(|localStorage|Date\.now/)?.[0]);
  ok("it imports no screen", !/from "\.\.\/(views|ui)\//.test(code) && !/from "react"/.test(code));
  const lines = ["Boy 1 v pace · 48 balls · 31 runs · out 3 times", "Bus seats 22 · 25 named, 2 by lift → 23 travelling", "R Pillay · restricted · back 14 Oct", "Has 1 over left (4 an innings)", "10 named · a side needs 11",
    "No playing conditions are set for this fixture: the pad will use the platform defaults", "Rain likely from 14:00", "1 lift not marked as leaving", "J Smith · 6 overs this week · rising (estimate)"];
  ok("the cards' own sentences pass the never-words", lines.every((l) => !NEVER_ON_THE_COCKPIT.test(l)), lines.filter((l) => NEVER_ON_THE_COCKPIT.test(l)));
  ok("no refused signal (§4.4) has a title: no risk, no flag, no guideline, no win chance", Object.values(RULES).every((r) => !NEVER_ON_THE_COCKPIT.test(r.title) && !/discipl|safeguard|clearance|fees|invoice|injury/i.test(r.title)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
