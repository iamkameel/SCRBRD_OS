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
import { FORBIDDEN_FIELDS, NEVER_ON_THE_COCKPIT, OTHER_SIDE_IDS } from "../src/lib/cockpitNever.js";
import { EXCEPTION_WORDS } from "../src/lib/liftWords.js";
import {
  RULES, RULE_ORDER, TRAILS, MATCHUP_FLOOR, MATCHUP_GROWTH, evaluate, trailLine, isSeen, markSeen, unseen, ruleS1, ruleS2a, ruleS2b, ruleS2c, ruleS3, ruleS4a, ruleS4b, ruleS5, ruleS6, ruleS7, ruleS8, ruleS9, ruleS10, ruleS11, ruleS12,
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

group("S2c · A bowler one over from the directive's day, across every match (phase B §1.5)");
{
  // bowler_day's rows, adapted (lib/live.js asBowlerDay): the server has summed the matches.
  const day = (o = {}) => ({ playerId: "b1", name: "K Naidoo", team: "1XI", oversToday: 11, matchesToday: 1, ageBand: "U15", pace: true, maxSpell: 6, maxDay: 12, ...o });
  const f = (o = {}) => ({ inn: { bowler: "b1", bowlers: [{ id: "b1", name: "K Naidoo" }], ...o }, i: 0, inPlay: true });
  const run = (rows, field = [f()], g = COACH, squad = []) => ruleS2c(base({ gate: g, bowlerDay: rows, fielding: field, squad }));
  ok("eleven of twelve: fires, with the band's directive", run([day()])[0]?.lines[0] === "K Naidoo · 11 of 12 today (U15 directive)", run([day()]));
  ok("ten of twelve: two short, silent", run([day({ oversToday: 10 })]).length === 0);
  ok("the sum of two matches says so", run([day({ matchesToday: 2 })])[0]?.lines[0] === "K Naidoo · 11 of 12 today, two matches (U15 directive)");
  ok("at the figure and past it: the figure, never 'stop'",
     run([day({ oversToday: 12, matchesToday: 2 })])[0]?.lines[0] === "K Naidoo · 12 of 12 today"
     && run([day({ oversToday: 13 })])[0]?.lines[0] === "K Naidoo · 13 of 12 today"
     && !/stop|take him off|do not bowl/i.test(JSON.stringify(run([day({ oversToday: 13 })]))));
  ok("a spinner never fires (no day limit, and not pace)", run([day({ pace: false, maxDay: null })]).length === 0 && run([day({ pace: false })]).length === 0
     && run([day({ maxDay: null })]).length === 0);
  ok("a read that did not answer never fires", run(null).length === 0);
  ok("the key changes with the over, so it clears with his next one", run([day()])[0].key !== run([day({ oversToday: 12 })])[0].key
     && run([day()])[0].base === run([day({ oversToday: 12 })])[0].base);
  ok("it is the count of overs, and clears by itself", run([day()])[0].count === 11 && run([day()])[0].dismissable === false);
  ok("in play only: after the innings it is not drawn at all", run([day()], [{ ...f(), inPlay: false }]).length === 0);
  ok("never without player.workload.read: the team manager has none", run([day()], [f()], MANAGER).length === 0);
  ok("never on the Dashboard's card, which has no fold", run([day()], []).length === 0);
  ok("a boy who has not bowled in this innings but is on our sheet still counts (the morning's overs are his)",
     run([day({ playerId: "p2", name: "Boy 2" })], [f()], COACH, sheet(3))[0]?.lines[0] === "Boy 2 · 11 of 12 today (U15 directive)");
  ok("...and a boy neither on the sheet nor bowling here is not ours to warn about", run([day({ playerId: "zz" })], [f()], COACH, sheet(3)).length === 0);
  ok("the bowler's name is the fold's where it has one", run([day({ name: "Kabelo Naidoo" })])[0]?.lines[0].startsWith("K Naidoo · "));
  ok("the band is said only when the read has one", run([day({ ageBand: null })])[0]?.lines[0] === "K Naidoo · 11 of 12 today (directive)");
  // Tightest wins (Kameel, 14 Oct, #141): the competition's figure for the band, where the frozen conditions name one.
  const runDoc = (rows, docDay) => ruleS2c(base({ gate: COACH, bowlerDay: rows, fielding: [f()], squad: [], docDayFor: (band) => (band === "U15" ? docDay : null) }));
  ok("a tighter competition figure is the limit, and the card says it is the competition's",
     runDoc([day({ oversToday: 9 })], 10)[0]?.lines[0] === "K Naidoo · 9 of 10 today (U15 competition)", runDoc([day({ oversToday: 9 })], 10));
  ok("...so it fires where the directive alone would stay silent", run([day({ oversToday: 9 })]).length === 0 && runDoc([day({ oversToday: 9 })], 10).length === 1);
  ok("a looser competition figure leaves the directive's in charge", runDoc([day()], 14)[0]?.lines[0] === "K Naidoo · 11 of 12 today (U15 directive)");
  ok("a spinner has no directive day, but the competition's figure is for every bowler",
     runDoc([day({ pace: false, maxDay: null, oversToday: 7 })], 8)[0]?.lines[0] === "K Naidoo · 7 of 8 today (U15 competition)");
  ok("no band, no competition figure: the directive alone", runDoc([day({ ageBand: null })], 8)[0]?.lines[0] === "K Naidoo · 11 of 12 today (directive)");
  ok("the key carries the limit in force, so a changed limit is a new card", runDoc([day({ oversToday: 9 })], 10)[0].key.endsWith(":9:10"));
  const blob = JSON.stringify(run([day({ loadWord: "spike", monitored: true, openFlag: true, opponent: "Kearsney", matchId: "m-other" })]));
  ok("nothing but the figure reaches the card: no word, no flag, no other match", !/spike|monitored|openFlag|Kearsney|m-other/.test(blob), blob);
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
  ok("a null clinical half (not this reader's to know) is no card, and no restriction", run([r({ clinicallyRestricted: null })]).length === 0);
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
  ok("welfare, a person's notice and lift notices about this match (D1's kinds)", ["welfare", "notice", "lift"].every((k) => run([n({ type: k })]).length === 1));
  ok("...and no kind outside D1's list", ["selection", "transport"].every((k) => run([n({ type: k })]).length === 0));
  ok("the notice is as published, word for word", run([n()])[0]?.lines.join(" | ") === "Bowling directive exceeded | A boy is 5 overs into a spell. Take him off.");
  ok("a tiered notice, listed without its body, is its title alone (D17)", run([n({ body: null })])[0]?.lines.join(" | ") === "Bowling directive exceeded");
  ok("not injury, not training, not another match, not about nothing", [{ type: "injury" }, { type: "training" }, { subjectId: "m2" }, { subjectKind: null }, { subjectKind: "injury" }].every((o) => run([n(o)]).length === 0));
  ok("nothing derived: a failed read is silent", run(null).length === 0);
}

group("Every rule: its gate, its order, its words");
{
  const everyone = base({ gate: COACH });
  ok("the twelve rules (S1 to S12, S2 and S4 in parts; S2c from phase B) are listed, in the design's order", RULE_ORDER.join() === "S1,S2a,S2b,S2c,S3,S4a,S4b,S5,S6,S7,S8,S9,S10,S11,S12");
  ok("S2c sits between S2b and S3, under the load capability, from bowler_day and the frozen conditions",
     JSON.stringify(RULES.S2c) === JSON.stringify({ title: "A bowler at the day's limit", via: ["player.workload.read"], source: "bowler_day, the frozen conditions" }));
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

group("GA-I27 · Every card's evidence trail: the rule's own inputs, its time from the context, nothing the never-lists hold");
{
  const PLAY = { "bowling.max_overs_per_bowler_innings": 4 };
  const T0 = NOW - 120000;                                     // 13:58 on the SA clock
  const AT = { trips: T0 + 3000, match_squad: T0, lift_expected: T0 + 5000, fold: T0 + 1000, bowling_spells: T0 + 2000, bowler_day: T0 + 4000, readiness: T0 + 6000,
    matchups: T0 + 7000, matchup_coverage: T0 + 7000, match_duties: T0 + 8000, weather: T0 + 9000, "playing-conditions": T0 + 10000, workload: T0 + 11000, notifications: T0 + 12000,
    lift_exceptions: T0 + 13000 };
  const HEAD = 412;
  // Every row carries fields no rule reads, each with a value that must never reach a trail.
  const POISON = { reasonKind: "ZZREASON", note: "ZZNOTE", injuryType: "ZZINJURY", severity: "ZZSEVERE", monitored: true, openFlag: true, ewmaRatio: 9.87, acwr: 8.76,
    units7d: 98765, roster: 97531, opponent: "ZZOPP", driverPhone: "ZZPHONE", wellness: "ZZWELL" };
  const p = (o) => ({ ...o, ...POISON });
  const full = (o = {}) => base({
    match: DAYOF, at: AT, head: HEAD,
    squad: sheet(10, POISON),
    trips: [p({ school: HIL, state: "scheduled", capacity: 4, seatsTaken: 0 })],
    lifts: { boys: new Set(["p1"]), count: 1, lifts: 1, notLeft: 1, handedOverUnconfirmed: 0 },
    readiness: [p({ playerId: "p2", name: "R Pillay", selected: true, side: "home", team: "1XI", declaredStatus: "unavailable", clinicallyRestricted: false, declaredByName: "Mrs Pillay" }),
      p({ playerId: "p3", name: "K Naidoo", selected: true, side: "home", team: "1XI", declaredStatus: null, clinicallyRestricted: false })],
    workload: [p({ playerId: "p1", name: "D Erasmus", pace: true, loadWord: "rising", overs7d: 6, estimated7d: false })],
    spells: [p({ bowlerId: "b1", name: "T Cele", innings: 0, spellNo: 1, overs: 5, maxSpell: 6, ageBand: "U15", pace: true })],
    bowlerDay: [p({ playerId: "b1", name: "T Cele", oversToday: 11, matchesToday: 1, ageBand: "U15", pace: true, maxDay: 12 })],
    fielding: [{ inn: { bowler: "b1", bowlers: [p({ id: "b1", name: "T Cele", balls: 18 })] }, i: 0, inPlay: true }],
    capFor: (b) => capWords(b, PLAY),
    matchups: { p1: { rows: [p({ bowlingStyle: "Right-arm fast", balls: 48, runs: 31, dismissals: 3 })], coverage: { attributable: 48, deliveries: 61 } } },
    duties: [],
    weather: p({ rainChancePct: 70, playable: true, condition: "Showers", tempC: 18, forecast: "Rain likely from 14:00" }),
    conditions: { state: "defaults", cap: null, freeHit: true },
    notices: [p({ id: "n1", type: "notice", title: "The sheet has changed", body: "The sheet for tonight was changed by the selector.", subjectKind: "match", subjectId: "m1" })],
    ...o,
  });
  const OFFICE = gateOf("sportsadmin", { teamCode: null });
  const coachCards = evaluate(full());
  const officeCards = evaluate(full({ gate: OFFICE, liftExceptions: [p({ seatId: "s1", kind: "not_collected", name: "T Bekker", driverName: "H Whitfield", leg: "back", since: "2026-10-02T15:10:00Z" })] }));
  const all = [...coachCards, ...officeCards.filter((k) => k.rule === "S4b")];
  const one = (r) => all.find((k) => k.rule === r);
  const figs = (r) => JSON.stringify(one(r)?.evidence.figures);
  const want = (...f) => JSON.stringify(f.map(([label, value, unit]) => (unit ? { label, value, unit } : { label, value })));

  ok("every rule has its trail's row, and every rule fires once in this context", RULE_ORDER.every((r) => TRAILS[r] && one(r)), RULE_ORDER.filter((r) => !one(r)));
  ok("every card carries evidence: a read, a window, its figures", all.every((k) => k.evidence && k.evidence.read && k.evidence.window && k.evidence.figures.length >= 1));
  ok("the read it names is one of the card's own sources", all.every((k) => k.source.includes(k.evidence.read)), all.filter((k) => !k.source.includes(k.evidence.read)).map((k) => k.rule));

  // Each figure is the rule's input, as the row had it.
  ok("S1: the bus's seats, the seats taken, named, by lift, travelling", figs("S1") === want(["seats on the bus", 4, "seats"], ["seats marked taken", 0, "seats"], ["named", 10, "boys"], ["by lift", 1, "boy"], ["travelling by bus", 9, "boys"]), figs("S1"));
  ok("S1: a reader who may not count lifts reads 'not counted'", JSON.stringify(ruleS1(full({ gate: gateOf("directorofsport") }))[0]?.evidence.figures[3]) === JSON.stringify({ label: "by lift", value: "not counted" }));
  ok("S2a: the balls he has bowled and the cap's own sentence, verbatim", figs("S2a") === want(["balls bowled", 18, "balls"], ["the conditions", capWords(18, PLAY)]), figs("S2a"));
  ok("S2b: the spell, its overs, the directive's spell, the band", figs("S2b") === want(["spell", 1], ["overs in it", 5, "overs"], ["the directive's spell", 6, "overs"], ["age band", "U15"]), figs("S2b"));
  ok("S2c: overs today, the day's limit and whose, the matches as a count, the band", figs("S2c") === want(["overs today", 11, "overs"], ["the day's limit", 12, "overs"], ["whose limit", "directive"], ["matches today", 1], ["age band", "U15"]), figs("S2c"));
  ok("S3: the state, and who said it; no reason, no nature", figs("S3") === want(["on the sheet", "yes"], ["state", "unavailable"], ["who said it", "said by Mrs Pillay"]), figs("S3"));
  ok("S3: restricted carries the date he is back and nothing of who said it",
     JSON.stringify(ruleS3(base({ readiness: [{ playerId: "p1", name: "R Pillay", selected: true, side: "home", clinicallyRestricted: true, returnDate: "2026-10-14T00:00:00.000Z", declaredByName: "Mrs Pillay" }] }))[0]?.evidence.figures)
       === want(["on the sheet", "yes"], ["state", "restricted"], ["back", "14 Oct"]));
  ok("S4a: a head count, nothing more", figs("S4a") === want(["arriving by lift", 1, "boy"], ["not marked as leaving", 1, "lift"], ["handed over, not yet confirmed", 0, "boys"]), figs("S4a"));
  ok("S4b: the office's: the kind in db/76's words, the leg, since when", figs("S4b") === want(["what", EXCEPTION_WORDS.not_collected], ["leg", "home"], ["since", "17:10"]), figs("S4b"));
  ok("S5: the type, balls, runs, out, and what is attributable", figs("S5") === want(["against", "pace"], ["balls", 48, "balls"], ["runs", 31, "runs"], ["out", 3, "times"], ["attributable", 48, "balls"], ["of the balls he faced", 61, "balls"]), figs("S5"));
  ok("S6: named, of a side of eleven; never the roster", figs("S6") === want(["named", 10, "boys"], ["a side", 11, "boys"]), figs("S6"));
  ok("S7: counts, never a name and never the roster", figs("S7") === want(["not answered", 1], ["to answer again", 0]), figs("S7"));
  ok("S8: the empty slot and the day", figs("S8") === want(["slot", "scorer"], ["on record", "nobody"], ["the day", "2 Oct"]), figs("S8"));
  ok("S9: the read's forecast, the chance in 100 (never a percent), playable", figs("S9") === want(["forecast", "Rain likely from 14:00"], ["chance of rain", 70, "in 100"], ["playable", "yes"]), figs("S9"));
  ok("S10: what the document says", figs("S10") === want(["conditions", "the platform defaults"], ["cap", "none"], ["free hit", "yes"]), figs("S10"));
  ok("S11: the overs, the word, whether it is an estimate; never a ratio", figs("S11") === want(["overs this week", 6, "overs"], ["the word", "rising"], ["an estimate", "no"]), figs("S11"));
  ok("S12: the notice's kind; the notice itself is the record", figs("S12") === want(["kind", "notice"]), figs("S12"));

  // The time: from the context, never a clock of the module's own.
  ok("as at is the oldest of the card's reads (S1: the sheet, read before the bus and the lifts)", one("S1").evidence.asOf === AT.match_squad);
  ok("...a card over one read is that read's time", one("S11").evidence.asOf === AT.workload && one("S2c").evidence.asOf === AT.bowler_day && one("S2a").evidence.asOf === AT.fold);
  ok("the head is the context's, on the cards that stand on the log (S2a, S2b), and on no other", all.every((k) => k.evidence.head === (["S2a", "S2b"].includes(k.rule) ? HEAD : null)), all.map((k) => `${k.rule}:${k.evidence.head}`));
  ok("the source line: read, window, denominator, as at",
     trailLine(one("S11").evidence, NOW) === "workload · the 7 days to today · overs begun, every match · as at 13:58", trailLine(one("S11").evidence, NOW));
  ok("...and the head where it stands on the log", trailLine(one("S2a").evidence, NOW) === "fold · this innings · balls bowled, against the frozen conditions · as at 13:58 · head 412", trailLine(one("S2a").evidence, NOW));
  ok("...a read from another day says its date", /as at 13:58, 1 Oct$/.test(trailLine({ ...one("S11").evidence, asOf: T0 - 86400e3 }, NOW)), trailLine({ ...one("S11").evidence, asOf: T0 - 86400e3 }, NOW));
  const bare = evaluate(full({ at: undefined, head: undefined }));
  ok("a context with no times: no 'as at', never 'Invalid Date', and no head", bare.length === coachCards.length && bare.every((k) => k.evidence.asOf === null && k.evidence.head === null
     && !/as at|Invalid|NaN|undefined/.test(trailLine(k.evidence, NOW))), bare.map((k) => trailLine(k.evidence, NOW)).find((l) => /as at|Invalid|NaN|undefined/.test(l)));
  ok("...nor when the read the card names did not answer, though another did", evaluate(full({ at: { match_squad: T0 } })).find((k) => k.rule === "S1").evidence.asOf === null);
  ok("a card drawn straight from its rule is not yet stamped (evaluate() alone holds the context)", ruleS11(full())[0].evidence.asOf === null);

  // What never reaches a trail.
  const words = (k) => [k.evidence.read, k.evidence.window, k.evidence.denominator, k.evidence.unit, k.evidence.screen?.label,
    ...k.evidence.figures.flatMap((f) => [f.label, String(f.value), f.unit])].filter((x) => x != null);
  const bad = all.flatMap((k) => words(k).filter((w) => NEVER_ON_THE_COCKPIT.test(w)).map((w) => `${k.rule}: ${w}`));
  ok("no word in any trail matches the never-words", bad.length === 0, bad);
  const fieldHit = all.flatMap((k) => words(k).filter((w) => FORBIDDEN_FIELDS.some((f) => new RegExp(`\\b${f}\\b`).test(w))).map((w) => `${k.rule}: ${w}`));
  ok("...nor names a forbidden field", fieldHit.length === 0, fieldHit);
  const blob = JSON.stringify(all.map((k) => k.evidence));
  const leaked = ["ZZ", "9.87", "8.76", "98765", "97531", "roster", "Whitfield"].filter((s) => blob.includes(s));
  ok("no field the rules do not read reaches a trail, though every row carried them (a reason, a nature, a flag, a ratio, the roster, a phone, a driver)", leaked.length === 0, leaked);
  const ids = all.flatMap((k) => Object.entries(k.evidence.params).filter(([n]) => /player|batter|bowler/i.test(n)).filter(([, v]) => !k.base.includes(String(v))).map(([n, v]) => `${k.rule}: ${n}=${v}`));
  ok("params name a boy only when the card does (his id is in the card's base)", ids.length === 0, ids);
  ok("no trail names a second boy: S5's names its batter alone, S6 and S7 none", Object.keys(one("S5").evidence.params).join() === "batterId,type" && Object.keys(one("S6").evidence.params).length === 0 && Object.keys(one("S7").evidence.params).length === 0);
  ok("the screens are the existing ones (C-D3: no fifth destination); S9 has none", all.every((k) => k.evidence.screen === null || ["logistics", "scorecard", "training", "squad", "profile", "duties", "competitions", "notifications"].includes(k.evidence.screen.route))
     && one("S9").evidence.screen === null);
  ok("the team manager's cards carry no load read's name, for he has no load card", !/bowler_day|bowling_spells|workload/.test(JSON.stringify(evaluate(full({ gate: MANAGER })).map((k) => k.evidence))));
}

group("The static check: the rules read none of what they must not, and touch nothing");
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const code = strip(readFileSync(new URL("../src/lib/signals.js", import.meta.url), "utf8"));
  const hit = FORBIDDEN_FIELDS.filter((w) => new RegExp(`\\b${w}\\b`).test(code));
  ok(`no forbidden field is read (${FORBIDDEN_FIELDS.join(", ")})`, hit.length === 0, hit);
  ok("it fetches nothing and writes nothing (no api, no storage, no clock of its own)", !/\bapi\(|fetch\(|localStorage|sessionStorage|Date\.now|new Date\(\)|XMLHttpRequest/i.test(code), code.match(/\bapi\(|fetch\(|localStorage|Date\.now/)?.[0]);
  ok("the scan holds the evidence trail's helpers too (GA-I27: trail, stamp, trailLine)", /function trail\(/.test(code) && /function stamp\(/.test(code) && /export function trailLine\(/.test(code));
  ok("it imports no screen", !/from "\.\.\/(views|ui)\//.test(code) && !/from "react"/.test(code));
  // Phase B §1.5: the new read's absent columns stay absent from the rule that reads it.
  const s2c = code.slice(code.indexOf("export function ruleS2c"), code.indexOf("export function ruleS3"));
  ok("S2c reads no load word, monitored, flag or ratio from bowlerDay", s2c.length > 200 && !/load_?word|monitored|open_?flag|acwr|ewma|units/i.test(s2c), s2c.length);
  const adapter = (() => { const live = readFileSync(new URL("../src/lib/live.js", import.meta.url), "utf8"); return live.slice(live.indexOf("function asBowlerDay"), live.indexOf("function asBreach")); })();
  ok("...and its adapter carries none of them either, nor another match's id", adapter.length > 100 && !/load_?word|monitored|open_?flag|acwr|ewma|units|match_id|opponent/i.test(adapter.replace(/\/\*\*[\s\S]*?\*\//, "")));
  const lines = ["Boy 1 v pace · 48 balls · 31 runs · out 3 times", "Bus seats 22 · 25 named, 2 by lift → 23 travelling", "R Pillay · restricted · back 14 Oct", "Has 1 over left (4 an innings)", "10 named · a side needs 11",
    "No playing conditions are set for this fixture: the pad will use the platform defaults", "Rain likely from 14:00", "1 lift not marked as leaving", "J Smith · 6 overs this week · rising (estimate)"];
  ok("the cards' own sentences pass the never-words", lines.every((l) => !NEVER_ON_THE_COCKPIT.test(l)), lines.filter((l) => NEVER_ON_THE_COCKPIT.test(l)));
  ok("no refused signal (§4.4) has a title: no risk, no flag, no guideline, no win chance", Object.values(RULES).every((r) => !NEVER_ON_THE_COCKPIT.test(r.title) && !/discipl|safeguard|clearance|fees|invoice|injury/i.test(r.title)));

  // Away visibility (AV3, db/97): no rule keys a card to the other side's boy.
  const body = (name, next) => code.slice(code.indexOf(`export function ${name}`), code.indexOf(`export function ${next}`));
  const other = OTHER_SIDE_IDS.filter((w) => new RegExp(`\\b${w}\\b`).test(code));
  ok(`no rule reads the log's other ids (${OTHER_SIDE_IDS.join(", ")})`, other.length === 0, other);
  const s2b = body("ruleS2b", "ruleS2c");
  ok("a spell's bowlerId is read in S2b alone", s2b.length > 200 && (code.match(/\bbowlerId\b/g) ?? []).length === (s2b.match(/\bbowlerId\b/g) ?? []).length, (code.match(/\bbowlerId\b/g) ?? []).length);
  ok("...matched to the bowler on now in OUR fielding innings", /for \(const \{ inn, i, inPlay \} of c\.fielding \?\? \[\]\)/.test(s2b) && /s\.bowlerId === inn\.bowler/.test(s2b));
  ok("...and keyed only once the directive beside him answered (a boy whose load the reader may read)",
     s2b.indexOf("open.pace !== true || open.maxSpell == null") > 0 && s2b.indexOf("open.pace !== true || open.maxSpell == null") < s2b.indexOf('card("S2b"'));
  ok("every rule that walks an innings walks our fielding ones", (code.match(/\{ inn, i, inPlay \} of /g) ?? []).length === (code.match(/\{ inn, i, inPlay \} of c\.fielding \?\? \[\]/g) ?? []).length
     && (code.match(/of c\.fielding/g) ?? []).length >= 3 && !/c\.innings\b|c\.batting\b/.test(code));
  ok("S5 counts a matchup by type, never by their bowler", !/bowler/i.test(body("ruleS5", "ruleS6").replace(/bowling/g, "")));
}

group("Away visibility (AV3): the other side's boy, as the reads return him after db/97, draws no card");
{
  // A Westville-hosted fixture read by our coach: the other side's quick is in
  // the log (the fold's bowlers when we bat), in bowling_spells with the
  // directive null (or not at all: the read joins his record), absent from
  // bowler_day and workload, and named on matchup rows. Our side is b1.
  const THEIRS = "w9";
  const theirSpell = { bowlerId: THEIRS, name: "W Visitor", innings: 1, spellNo: 1, overs: 7, maxSpell: null, maxDay: null, ageBand: null, pace: null };
  const ourSpell = { bowlerId: "b1", name: "T Cele", innings: 0, spellNo: 1, overs: 5, maxSpell: 6, ageBand: "U15", pace: true };
  const away = { end: "away", school: "wes", teamCode: "1XI", panels: panelsOf("coach") };
  const fielding = [{ inn: { bowler: "b1", bowlers: [{ id: "b1", name: "T Cele", balls: 30 }] }, i: 0, inPlay: true }];
  const ctx = base({
    gate: away, match: { ...DAYOF, status: "live" }, squad: sheet(11, { side: "away" }), spells: [theirSpell, ourSpell], fielding,
    bowlerDay: [{ playerId: "b1", name: "T Cele", oversToday: 11, matchesToday: 2, ageBand: "U15", pace: true, maxSpell: 6, maxDay: 12 }],
    workload: [], capFor: (b) => capWords(b, { "bowling.max_overs_per_bowler_innings": 4 }),
    matchups: { p1: { rows: [{ bowlerId: THEIRS, bowlerName: "W Visitor", bowlingStyle: "Right-arm fast", balls: 40, runs: 20, dismissals: 1 }], coverage: { attributable: 40, deliveries: 40 } } },
  });
  const cards = evaluate(ctx);
  ok("our bowler's cards still speak (S2a, S2b, S2c)", ["S2a", "S2b", "S2c"].every((r) => cards.some((k) => k.rule === r)), cards.map((k) => k.rule));
  ok("no card is keyed to their bowler or names him", cards.every((k) => !k.key.includes(THEIRS) && !k.base.includes(THEIRS) && !k.lines.join(" ").includes("W Visitor")), cards.map((k) => k.key));
  // ...even were their bowler on now in an innings handed to the rules as ours:
  // his spell's directive is null, so S2b has nothing to say of him.
  const astray = [{ inn: { bowler: THEIRS, bowlers: [{ id: THEIRS, name: "W Visitor", balls: 42 }] }, i: 1, inPlay: true }];
  ok("...even were he handed to S2b as the bowler on now, his null directive keeps it silent",
     ruleS2b(base({ gate: away, spells: [theirSpell], fielding: astray })).length === 0);
  ok("...and S2c has no row for him to draw", ruleS2c(base({ gate: away, bowlerDay: [], fielding: astray })).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
