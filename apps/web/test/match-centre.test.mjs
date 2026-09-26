/**
 * What the Match Centre works out before it draws (lib/matchCentre.js,
 * redesign step 3c): the sides named in full and by code, the match line,
 * where the match is, the scorecard's parts from the fold, the innings
 * break, the commentary grouped by over, and the reader's names for the
 * commentary generator. Pure: no DOM, no database.
 */
import {
  inningsStart, batters, bowler, ball, penalty, retire, deriveInnings, deriveMatch, deriveCommentary, BALL_TYPE,
} from "@scrbrd/scoring";
import {
  nameCode, sideName, sidesOf, sideOfTeam, teamOf, inningsPhase, ageGroupOf, matchLine, nameBook, fowLines,
  didNotBat, extrasOf, runCounts, dismissalKey, inningsBreak, commentaryByOver, oversOf,
} from "../src/lib/matchCentre.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

group("A side's name: in full, and by code");
ok("a short name is its own code", nameCode("Hilton") === "Hilton");
ok("three words or more: initials", nameCode("Westville Boys' High") === "WBH" && nameCode("Durban High School") === "DHS");
ok("two long words: the first", nameCode("Maritzburg College") === "Maritzburg");
ok("school.code and the side, where the read gave the code",
   JSON.stringify(sideName({ label: "Hilton College 1XI", schoolCode: "HIL", team: "1XI" })) === JSON.stringify({ full: "Hilton College 1XI", short: "HIL 1XI" }));
ok("...the name's initials where it did not", sideName({ label: "Westville Boys' High 1XI", team: "1XI" }).short === "WBH 1XI");
ok("a free-text opponent keeps its side", sideName({ fallback: "Durban High School 1st XI" }).short === "DHS 1XI");
const live = { homeTeam: "1XI", homeLabel: "Hilton College 1XI", homeCode: "HIL", awayTeam: "Westville Boys' High 1XI",
  awayLabel: "Westville Boys' High 1XI", awayCode: null, awayTeamCode: "1XI", venue: "Gordon Sherwood Oval", date: "2026-09-26", time: "10:00" };
ok("both sides of a live fixture", sidesOf(live).home.short === "HIL 1XI" && sidesOf(live).away.full === "Westville Boys' High 1XI");
ok("a demonstration fixture (no labels)", JSON.stringify(sidesOf({ homeTeam: "Hilton 1st XI", awayTeam: "Michaelhouse 1st XI" }))
   === JSON.stringify({ home: { full: "Hilton 1st XI", short: "Hilton 1XI" }, away: { full: "Michaelhouse 1st XI", short: "Michaelhouse 1XI" } }));
ok("the pad's innings names find their side", sideOfTeam(live, "1XI") === "home" && sideOfTeam(live, "Westville Boys' High 1XI") === "away");
ok("...and a name that is neither is named as it is", teamOf(live, "Somebody XI").full === "Somebody XI");

group("The match line, and where the match is");
ok("the age group of a side", ageGroupOf("U16B") === "U16" && ageGroupOf("1XI") === "1st XI" && ageGroupOf("Hilton 1st XI") === null);
ok("competition · age group · ground · start · weather · innings",
   matchLine({ match: live, competition: "KZN Super League", weather: { tempC: 25, condition: "Sunny" }, phase: "2nd innings" })
   === "KZN Super League · 1st XI · Gordon Sherwood Oval · Sat 26 Sep · 10:00 · 25° sunny · 2nd innings");
ok("a part the fixture does not have is left out, not dashed", matchLine({ match: { homeTeam: "1XI", homeLabel: "Hilton 1XI" } }) === "1st XI");
const open = [inningsStart({ battingTeam: "1XI", bowlingTeam: "Opp", squad: [{ id: "a", name: "A One" }, { id: "b", name: "B Two" }, { id: "c", name: "C Three" }, { id: "d", name: "D Four" }], overs: 1 }),
  batters({ striker: "a", nonStriker: "b" }), bowler({ bowler: "Typed Bowler" })];
const one = deriveInnings([...open, ball({ value: 1 })]);
ok("one innings under way", inningsPhase([one]) === "1st innings");
const done = deriveInnings([...open, ...[4, 6, 1, 0, 2, 2].map((v) => ball({ value: v }))]);
ok("the first innings over: the break", inningsPhase([done]) === "Innings break");
ok("...still the break with the second opened and no ball bowled", inningsPhase([done, deriveInnings([inningsStart({ battingTeam: "Opp" })])]) === "Innings break");
ok("a result", inningsPhase([done, done], { winner: "x" }) === "Result");

group("The scorecard's parts, from the fold");
const log = [...open, ball({ value: 4 }), ball({ value: 1 }), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }),
  batters({ striker: "c" }), penalty({ runs: 5, toBattingTeam: true, reason: "helmet_struck" }), ball({ type: BALL_TYPE.WIDE, value: 0 }),
  ball({ type: BALL_TYPE.NO_BALL, value: 0 }), ball({ value: 2 })];
const withIds = log.map((e, i) => ({ ...e, id: `e${i}` }));
const inn = deriveInnings(withIds);
ok("the fall of wickets as the prototype writes it", fowLines(inn)[0] === "5/1 · B Two · 0.3", fowLines(inn));
ok("did not bat: the squad nobody has a line for", JSON.stringify(didNotBat(inn).map((p) => p.name)) === JSON.stringify(["D Four"]));
const ex = extrasOf(inn);
ok("extras as NB · WD · B · LB · PEN", ex.parts.NB === 1 && ex.parts.WD === 1 && ex.parts.PEN === 5 && ex.total === 7, ex);
ok("a batter's 1s to 6s, off the bat", JSON.stringify(runCounts(inn, "a")) === JSON.stringify({ 1: 1, 2: 0, 3: 0, 4: 1, 6: 0 }), runCounts(inn, "a"));
ok("the key of the line that tells his dismissal", dismissalKey(inn, "b") === "e:e5");
const r = deriveInnings([...open, { ...retire({ batter: "a", reason: "out" }), id: "r1" }]);
ok("...a retirement's, for a wicket with no ball", dismissalKey(r, "a", [{ ...retire({ batter: "a", reason: "out" }), id: "r1" }]) === "e:r1");
ok("overs as a card writes them", oversOf(60) === "10" && oversOf(33) === "5.3");

group("The innings break");
const brk = inningsBreak(done);
ok("top scorers, most first", brk.topScorers[0].runs >= (brk.topScorers[1]?.runs ?? 0));
ok("best bowling", brk.bestBowling.length === 1 && brk.bestBowling[0].id === "Typed Bowler");
ok("most boundaries", brk.boundaries?.fours + brk.boundaries?.sixes >= 1);
ok("best strike rate needs ten balls", brk.strikeRate === null);

group("The commentary, newest first, by over; and the reader's names");
const evs = [...open.map((e, i) => ({ ...e, id: `x${i}` })), ...[1, 4, 0, 0, 1, 2, 6].map((v, i) => ({ ...ball({ value: v }), id: `b${i}` }))];
const items = deriveCommentary(evs, { nameOf: nameBook(deriveMatch(evs).innings) });
const groups = commentaryByOver(items);
ok("the latest over first", groups[0].over === 1 && groups[1].over === 0);
ok("its lines newest first", groups[1].lines.at(-1).kind === "innings_start" && groups[0].lines.filter((l) => l.kind !== "innings_end")[0].key === "e:b6");
ok("the over's summary heads its group", groups[1].end?.kind === "over_end" && !groups[1].lines.some((l) => l.kind === "over_end"));
const names = nameBook([deriveInnings(evs)], [{ id: "0a1b2c3d-0000-4000-8000-00000000000f", name: "Roster Name" }]);
ok("names from the squads the log carries", names("a") === "A One");
ok("...then the reader's roster", names("0a1b2c3d-0000-4000-8000-00000000000f") === "Roster Name");
ok("...a typed name as typed", names("Typed Bowler") === "Typed Bowler");
ok("...and an id nobody names is nobody, never the id", names("0a1b2c3d-0000-4000-8000-0000000000ff") === null);
ok("the generator then says the role", deriveCommentary([{ ...batters({ striker: "0a1b2c3d-0000-4000-8000-0000000000ff", nonStriker: "b" }), id: "q" }],
  { nameOf: names })[0].text.startsWith("The striker"));

console.log(`\n${"─".repeat(52)}\nMATCH CENTRE SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
