/**
 * Redesign slice 1: the match card's words (lib/matchCard.js), one test per
 * rule of DESIGN_DIRECTION §2.2: the state line, overs with their unit, the
 * reader's side first, the batting side marked, provisional never "Live",
 * and the one status sentence.
 *
 *   node apps/web/test/match-card.test.mjs
 */
import { inningsStart, batters, bowler, ball, deriveInnings } from "@scrbrd/scoring";
import { cardModel, demoScore, openWords, oversWords, scoreWords, scoresOf, startsIn, stateOf } from "../src/lib/matchCard.js";
import { statusSentence } from "../src/lib/matchCentre.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const M = { id: "m1", homeTeam: "1XI", homeLabel: "Hilton College 1XI", homeCode: "HIL", awayTeam: "Westville Boys' High 1XI",
  awayLabel: "Westville Boys' High 1XI", awayCode: null, awayTeamCode: "1XI", venue: "Gordon Sherwood Oval", date: "2026-11-21",
  time: "17:25", startsAt: "2026-11-21T15:25:00.000Z", overs: 20, format: "T20", tossWonBy: null, tossDecision: null, result: null, mySide: null };
const sq = (p) => [1, 2, 3, 4].map((i) => ({ id: `${p}${i}`, name: `${p.toUpperCase()} Player${i}` }));
const first = [inningsStart({ battingTeam: "1XI", bowlingTeam: "Westville Boys' High 1XI", squad: sq("h"), bowlingSquad: sq("w"), overs: 20 }),
  batters({ striker: "h1", nonStriker: "h2" }), bowler({ bowler: "w1" })];
const inn1 = deriveInnings([...first, ball({ value: 4 }), ball({ value: 1 }), ball({ value: 0 }), ball({ value: 0 }), ball({ value: 2 }), ball({ value: 0 }), ball({ value: 1 })]);

group("Overs carry their unit");
ok("42 balls is 7 overs", oversWords(42) === "7 overs", oversWords(42));
ok("44 balls is 7.2 overs", oversWords(44) === "7.2 overs");
ok("6 balls is 1 over", oversWords(6) === "1 over");
ok("a score with balls", scoreWords([{ runs: 50, wickets: 0, balls: 42 }]) === "50/0 · 7 overs");
ok("a score with the scorer's overs", scoreWords([{ runs: 142, wickets: 6, overs: "20" }]) === "142/6 · 20 overs");
ok("no figure, no score", scoreWords([]) === null && scoreWords([{ runs: null }]) === null);
ok("two innings a side: both runs, the latest's overs", scoreWords([{ runs: 120, wickets: 10, balls: 300, complete: true }, { runs: 50, wickets: 2, balls: 108 }]) === "120 & 50/2 · 18 overs");
ok("the demo's line", demoScore({ score: "142/6", overs: "20" }) === "142/6 · 20 overs");
ok("...never a bare figure", !/\(\d+\)$/.test(demoScore({ score: "88/3", overs: "12.4" })) && demoScore({ score: "88/3", overs: "12.4" }) === "88/3 · 12.4 overs");

group("Both sides' scores, from the innings the screen has");
{
  const s = scoresOf({ ...M, status: "live" }, [inn1]);
  ok("the fold's innings is the home side's", s.home === "8/0 · 1.1 overs" && s.away === null, s);
  ok("...and the home side is batting", s.batting === "home");
  const r = scoresOf({ ...M, status: "complete" }, [{ side: "away", runs: 143, wickets: 5, balls: 120, complete: true }, { side: "home", runs: 131, wickets: 9, balls: 120, complete: true }]);
  ok("the result route's innings, by their side", r.away === "143/5 · 20 overs" && r.home === "131/9 · 20 overs", r);
  ok("...nobody batting once it is over", r.batting === null);
  ok("a super over is not the match's score", scoresOf({ ...M, status: "complete" }, [{ side: "home", runs: 100, wickets: 3, balls: 120, complete: true }, { side: "home", runs: 12, wickets: 0, balls: 6, superOver: 1 }]).home === "100/3 · 20 overs");
}

group("The state line");
const sent = (m) => statusSentence(m, null);
ok("live is the status's word", stateOf({ ...M, status: "live" }, sent({ ...M, status: "live" })).words === "Live");
ok("upcoming is the day and the time, in words", stateOf({ ...M, status: "upcoming" }, sent({ ...M, status: "upcoming" })).words === "Sat 21 Nov · 17:25");
ok("never an ISO date", !/\d{4}-\d{2}-\d{2}/.test(stateOf({ ...M, status: "upcoming" }, sent(M)).words));
ok("complete is the result", stateOf({ ...M, status: "complete" }, { state: "result" }).words === "Result");
ok("...provisional where the screen read it so", stateOf({ ...M, status: "complete" }, { state: "result" }, "provisional").kind === "provisional");
ok("a result on the pad while live is provisional, never Live", stateOf({ ...M, status: "live" }, { state: "result" }).words === "Provisional");
ok("postponed", stateOf({ ...M, status: "postponed" }, { state: "postponed" }).words === "Postponed");
ok("called off", stateOf({ ...M, status: "complete", calledOff: true }, { state: "abandoned" }).words === "Called off");

group("In the last hour: \"in 12 min\"");
const start = Date.parse(M.startsAt);
ok("12 minutes before", startsIn({ ...M, status: "upcoming" }, start - 12 * 60e3) === "in 12 min");
ok("not two hours before", startsIn({ ...M, status: "upcoming" }, start - 120 * 60e3) === null);
ok("not once started", startsIn({ ...M, status: "upcoming" }, start + 60e3) === null);
ok("not a live match", startsIn({ ...M, status: "live" }, start - 12 * 60e3) === null);
ok("from the SA day and time where there is no instant", startsIn({ ...M, status: "upcoming", startsAt: null }, start - 30 * 60e3) === "in 30 min");

group("The card, in order");
{
  const c = cardModel({ match: { ...M, status: "live" }, fold: { innings: [inn1], result: null }, now: start });
  ok("home side first with no side of his own", c.sides[0].end === "home" && c.sides[1].end === "away");
  ok("the batting side is marked", c.sides[0].batting === true && c.sides[1].batting === false);
  ok("the sentence is statusSentence()'s", c.sentence.text === statusSentence({ ...M, status: "live" }, { innings: [inn1], result: null }).text);
  ok("the state is Live", c.state.kind === "live");
  const a = cardModel({ match: { ...M, status: "upcoming", mySide: "away" }, now: start - 10 * 60e3 });
  ok("the reader's own side first (the read's mySide)", a.sides[0].end === "away", a.sides.map((s) => s.end));
  ok("...or the end a screen names", cardModel({ match: { ...M, status: "upcoming" }, ownEnd: "away" }).sides[0].end === "away");
  ok("nobody is batting before the first ball", a.sides.every((s) => !s.batting));
  ok("soon says the minutes", a.soon === "in 10 min");
  ok("an upcoming match says where", a.sentence.text === "Starts at 17:25 · Gordon Sherwood Oval", a.sentence.text);
  ok("...and only the start where there is no ground", cardModel({ match: { ...M, status: "upcoming", venue: null } }).sentence.text === "Starts at 17:25");
  ok("names in full, never 1XI alone", a.sides.every((s) => s.name.full !== "1XI"), a.sides.map((s) => s.name.full));
  const p = cardModel({ match: { ...M, status: "complete" }, resultWords: "Hilton College 1XI won by 12 runs", official: "provisional" });
  ok("a provisional result says so in the sentence", p.sentence.text === "Hilton College 1XI won by 12 runs · provisional", p.sentence.text);
  const r = cardModel({ match: { ...M, status: "complete" }, resultWords: "Hilton College 1XI won by 12 runs" });
  ok("a result is the result's words", r.sentence.text === "Hilton College 1XI won by 12 runs" && r.state.words === "Result");
  const d = cardModel({ match: { ...M, status: "live" }, scores: { home: "142/6 · 20 overs", away: null, batting: "home" } });
  ok("the demo's scores, handed in", d.sides[0].score === "142/6 · 20 overs" && d.sides[0].batting);
}

group("The action is named for the match");
ok("from the home side", openWords(M) === "Open v Westville Boys' High 1XI");
ok("from the away side", openWords({ ...M, mySide: "away" }) === "Open v Hilton College 1XI");

console.log(`\n${"─".repeat(52)}\nMATCH CARD (slice 1): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
