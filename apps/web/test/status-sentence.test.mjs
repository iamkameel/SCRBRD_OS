/**
 * CRI-1.2: where a fixture stands, in one sentence (lib/matchCentre.js
 * statusSentence) — one test per state, the Match Centre list's card (no log)
 * and the match's header (the fold) asking the same function, and the
 * header's line no longer saying the innings a second time.
 *
 *   node apps/web/test/status-sentence.test.mjs
 */
import { inningsStart, batters, bowler, ball, deriveInnings, deriveInningsList, deriveMatch, playStopped } from "@scrbrd/scoring";
import { buildLog, CUP, RESULT_STARTS_AT } from "../../../packages/scoring/test/result-logs.mjs";
import { STATUS_STATE, matchLine, statusSentence, tossWords } from "../src/lib/matchCentre.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
/** @type {Set<string>} */
const seen = new Set();
const says = (name, got, state, text) => { seen.add(got.state); ok(`${state}: ${name} — "${text}"`, got.state === state && got.text === text, got); };

// A fixture as lib/live.js asMatch writes one: both sides on SCRBRD.
const M = { id: "m1", homeTeam: "1XI", homeLabel: "Hilton College 1XI", homeCode: "HIL", awayTeam: "Westville Boys' High 1XI",
  awayLabel: "Westville Boys' High 1XI", awayCode: null, awayTeamCode: "1XI", venue: "Gordon Sherwood Oval", date: "2026-11-01",
  time: "10:00", overs: 20, format: "T20", tossWonBy: null, tossDecision: null, result: null };
const sq = (p) => [1, 2, 3, 4].map((i) => ({ id: `${p}${i}`, name: `${p.toUpperCase()} Player${i}` }));
const first = [inningsStart({ battingTeam: "1XI", bowlingTeam: "Westville Boys' High 1XI", squad: sq("h"), bowlingSquad: sq("w"), overs: 20 }),
  batters({ striker: "h1", nonStriker: "h2" }), bowler({ bowler: "w1" })];
const second = [inningsStart({ battingTeam: "Westville Boys' High 1XI", bowlingTeam: "1XI", squad: sq("w"), bowlingSquad: sq("h"), overs: 20 }),
  batters({ striker: "w1", nonStriker: "w2" }), bowler({ bowler: "h1" })];
const inn1Live = deriveInnings([...first, ball({ value: 4 }), ball({ value: 1 })]);

group("Before a ball: the fixture's own facts");
says("a fixture with a start time", statusSentence({ ...M, status: "upcoming" }), "upcoming", "Starts at 10:00");
says("...and with none", statusSentence({ ...M, status: "upcoming", time: null }), "upcoming", "Not started");
says("the toss called, nothing bowled", statusSentence({ ...M, status: "upcoming", tossWonBy: "home", tossDecision: "bat" }), "toss",
     "Hilton College 1XI won the toss and chose to bat");
ok("...the away side's toss, and bowling", tossWords({ ...M, tossWonBy: "away", tossDecision: "bowl" }) === "Westville Boys' High 1XI won the toss and chose to bowl");
says("live on the list's read, which has no log", statusSentence({ ...M, status: "live" }), "live", "In play");
says("...a demonstration fixture's own line", statusSentence({ ...M, status: "live", result: "Hilton 1st XI batting" }), "live", "Hilton 1st XI batting");

group("In play: the fold's innings");
says("the first innings, with the toss on the fixture", statusSentence({ ...M, status: "live", tossWonBy: "home", tossDecision: "bat" }, { innings: [inn1Live] }),
     "first_innings", "Hilton College 1XI won the toss and chose to bat");
says("...and without one", statusSentence({ ...M, status: "live" }, { innings: [inn1Live] }), "first_innings", "Hilton College 1XI batting first");
const inn1Done = deriveInnings([...first, ball({ value: 6 }), ball({ value: 4 })], {});
inn1Done.complete = true;   // the innings sealed: the break
says("the innings break", statusSentence({ ...M, status: "live" }, { innings: [inn1Done] }), "innings_break",
     "Innings break: Westville Boys' High 1XI need 11 to win from 20 overs");
const chase = deriveInnings([...second, ball({ value: 4 }), ball({ value: 2 }), ball({ value: 0 })]);
says("the chase", statusSentence({ ...M, status: "live" }, { innings: [inn1Done, chase] }), "chase",
     "Westville Boys' High 1XI need 5 runs off 117 balls");
const one = deriveInnings([...second, ball({ value: 6 }), ball({ value: 4 })]);
says("...one run, said as one", statusSentence({ ...M, status: "live" }, { innings: [{ ...inn1Done, runs: 10 }, { ...one, runs: 10 }] }), "chase",
     "Westville Boys' High 1XI need 1 run off 118 balls");
says("...a timed match has no balls to count", statusSentence({ ...M, status: "live", format: "declaration", overs: null }, { innings: [inn1Done, { ...chase, overs: null }] }),
     "chase", "Westville Boys' High 1XI need 5 runs to win");
const stopped = deriveInnings([...second, ball({ value: 4 }), ball({ value: 2 }), ball({ value: 0 }), playStopped({ reason: "rain" })]);
says("play stopped: said first, then where the match stands", statusSentence({ ...M, status: "live" }, { innings: [inn1Done, stopped] }), "stopped",
     "Play stopped · Westville Boys' High 1XI need 5 runs off 117 balls");

group("Decided");
says("the fold's result, in resultText's words", statusSentence({ ...M, status: "live" }, { innings: [inn1Done, chase], result: { winner: "Westville Boys' High 1XI", margin: "4 wickets" } }),
     "result", "Westville Boys' High 1XI won by 4 wickets");
says("...the screen's own (the server's) words stand before the fold's", statusSentence({ ...M, status: "complete" }, { innings: [inn1Done, chase], result: { winner: "x", margin: "1 run" } }, { result: "Walkover to Westville Boys' High 1XI" }),
     "result", "Walkover to Westville Boys' High 1XI");
says("a finished fixture on the list's read: its stored result", statusSentence({ ...M, status: "complete", result: "Hilton won by 34 runs" }), "result", "Hilton won by 34 runs");
says("...finished, and nothing to word", statusSentence({ ...M, status: "complete" }), "complete", "Match over");
says("called off (the signed-in read)", statusSentence({ ...M, status: "complete", calledOff: true }), "abandoned", "Match abandoned");
says("...abandoned (the public read's word)", statusSentence({ ...M, status: "abandoned" }), "abandoned", "Match abandoned");

group("A super over being played");
{
  const H = "1XI", A = "Kearsney";
  const so = (n, bat, steps, more = {}) => ({ bat, bowl: bat === H ? A : H, steps, overs: 1, superOver: n, ...more });
  const log = buildLog([{ bat: H, bowl: A, steps: [4, 1, 0, 2, 6, 1], overs: 1 }, { bat: A, bowl: H, steps: [6, 6, 1, 1, 0, 0], overs: 1, target: 15 },
    so(1, A, [4, 1, 1, 1, 0, 0])], { conditions: CUP });
  const events = [];
  for (const e of log) (events[e.innings ?? 0] ??= []).push(e);
  for (let i = 0; i < events.length; i++) events[i] ??= [];
  const innings = deriveInningsList(events, { startsAt: RESULT_STARTS_AT, conditions: CUP });
  says("level, the super over under way", statusSentence({ ...M, homeTeam: H, awayTeam: A, homeLabel: null, awayLabel: null, status: "live" }, { innings, result: null }),
       "super_over", "Match tied; super over 1 in progress");
}

group("Every state has its test, and the list and the header ask the one function");
ok(`every state is said: ${STATUS_STATE.join(", ")}`, STATUS_STATE.every((s) => seen.has(s)), STATUS_STATE.filter((s) => !seen.has(s)));
{
  // The list's card passes no fold, the header the fold: a decided match reads the same on both.
  const row = { ...M, status: "complete", result: "Westville Boys' High 1XI won by 4 wickets" };
  const card = statusSentence(row);
  const hero = statusSentence(row, { innings: [inn1Done, chase], result: { winner: "Westville Boys' High 1XI", margin: "4 wickets" } });
  ok("a decided match: the card and the header say the same", card.text === hero.text && card.state === hero.state, [card, hero]);
  ok("the header's match line no longer carries the innings (the sentence does)", matchLine({ match: M }) === "1st XI · Gordon Sherwood Oval · Sun 1 Nov · 10:00",
     matchLine({ match: M }));
}
{
  const m = deriveMatch([...first.map((e) => ({ ...e, innings: 0 })), { ...ball({ value: 1 }), innings: 0 }]);
  ok("deriveMatch's shape is what the header passes", statusSentence({ ...M, status: "live" }, m).state === "first_innings");
}

console.log(`\n${"─".repeat(52)}\nSTATUS SENTENCE (CRI-1.2): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
