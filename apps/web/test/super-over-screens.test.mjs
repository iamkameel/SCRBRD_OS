/**
 * The super over's screens (SCRBRD-114 phase 3b, the Sonnet items): what a
 * screen asks of the engine and says back — pure, over the design's own logs
 * (packages/scoring/test/result-logs.mjs), no DOM.
 *
 *   A. The pad's offer: the button only where the conditions provide a super
 *      over, the last pair is level and sealed, and the Laws take it; the
 *      engine's words for why not (a league's tie stands)
 *   B. The pair's flow: the first innings' start and the chase's, as the
 *      write path takes them (the Laws accept each)
 *   C. The board's block: the target, the balls left, the wickets left of two
 *   D. The eligibility words: a batter out, and the bowler, of an earlier one
 *   E. The commentary's words for a super over
 *   F. The live line, the pairs, the chase
 *
 * Every date is explicit (3 October 2026, the 4th Edition), through the logs.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/super-over-screens.test.mjs
 */
import { deriveInningsList, deriveMatch, lawsRefusal, REFUSAL_TEXT } from "@scrbrd/scoring";
import { deriveCommentary } from "@scrbrd/scoring/commentary";
import { buildLog, CUP, LEAGUE, RESULT_STARTS_AT } from "../../../packages/scoring/test/result-logs.mjs";
import {
  chaseOf, eligibilityNotes, firstSuperOverAt, liveSuperOverLine, matchInningsOf, pairPlace, superOverBlock, superOverChaseStart,
  superOverCommentary, superOverFirstStart, superOverOffer, superOversOf, SUPER_OVER_OVERS,
} from "../src/lib/superOver.js";
import { boardFromInnings } from "../src/scorer/boardData.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${typeof d === "string" ? d : JSON.stringify(d)}` : ""); } };
const group = (t) => console.log("\n" + t);

const H = "1XI", A = "Kearsney";
const FIRST14 = { bat: H, bowl: A, steps: [4, 1, 0, 2, 6, 1], overs: 1 };
const LEVEL14 = { bat: A, bowl: H, steps: [6, 6, 1, 1, 0, 0], overs: 1, target: 15 };
const so = (n, bat, steps, more = {}) => ({ bat, bowl: bat === H ? A : H, steps, overs: 1, superOver: n, ...more });

/** The pad's shape of a log: each innings' own array, folded together under the document. */
function pad(log, conditions) {
  const events = [];
  for (const e of log) (events[e.innings ?? 0] ??= []).push(e);
  for (let i = 0; i < events.length; i++) events[i] ??= [];
  const ctx = { startsAt: RESULT_STARTS_AT, ...(conditions ? { conditions } : {}) };
  return { events, innings: deriveInningsList(events, ctx), ctx };
}
const offerOf = (plans, conditions, build = conditions) => {
  const p = pad(buildLog(plans, { conditions: build }), conditions);
  return { ...p, offer: superOverOffer({ innings: p.innings, events: p.events, conditions }) };
};

group("A. The pad's offer: the button, or the words why not");
{
  const cup = offerOf([FIRST14, LEVEL14], CUP);
  ok("a tied cup match sealed: the Super over is offered", cup.offer.state === "available", cup.offer);
  ok("...as the first, at the next innings", cup.offer.n === 1 && cup.offer.at === 2, cup.offer);
  ok("...the side that batted second bats first, by the standard order", cup.offer.standard.team === A && cup.offer.other.team === H, cup.offer);
  ok("...in words", /^Match tied\. This match's playing conditions provide a super over: Kearsney bat first\.$/.test(cup.offer.words), cup.offer.words);

  const league = offerOf([FIRST14, LEVEL14], LEAGUE, CUP);
  ok("a league tie: no button", league.offer.state === "refused", league.offer);
  ok("...and the engine's own words why", league.offer.refusal === "super_over_not_provided"
     && league.offer.words === `Match tied. ${REFUSAL_TEXT.super_over_not_provided[0].toUpperCase()}${REFUSAL_TEXT.super_over_not_provided.slice(1)}.`, league.offer.words);
  ok("...a tie stands", /a tie stands/.test(league.offer.words));

  const none = offerOf([FIRST14, LEVEL14], null, CUP);
  ok("a tie with no document at all: no button, the same words", none.offer.state === "refused" && none.offer.refusal === "super_over_not_provided", none.offer);

  const timed = offerOf([FIRST14, LEVEL14], { ...CUP, "format.kind": "timed" }, CUP);
  ok("a document that is not limited overs: no button", timed.offer.state === "refused", timed.offer);

  const won = offerOf([FIRST14, { bat: A, bowl: H, steps: [6, 6, 1, 1, 1], overs: 1, target: 15 }], CUP);
  ok("a match won in play: nothing to offer, nothing to say", won.offer.state === "none" && won.offer.words === null, won.offer);

  const open = offerOf([FIRST14, { ...LEVEL14, seal: false }], CUP);
  ok("a second innings level but not yet sealed: nothing yet", open.offer.state === "none", open.offer);

  const first = offerOf([FIRST14], CUP);
  ok("a first innings only: nothing", first.offer.state === "none", first.offer);

  const done = offerOf([FIRST14, LEVEL14, so(1, A, [6, 1, "W", 1, 0, 0]), so(1, H, [4, 4, 1], { target: 9 })], CUP);
  ok("a super over won: no further button", done.offer.state === "none", done.offer);

  const again = offerOf([FIRST14, LEVEL14, so(1, A, [4, 1, 1, 1, 0, 0]), so(1, H, [4, 1, 1, 0, 0, 1], { target: 8 })], CUP);
  ok("a super over tied: the next is offered, numbered 2, at innings 4", again.offer.state === "available" && again.offer.n === 2 && again.offer.at === 4, again.offer);
  ok("...the side that batted second in the last bats first: Hilton", again.offer.standard.team === H && again.offer.other.team === A, again.offer);

  const mid = offerOf([FIRST14, LEVEL14, so(1, A, [6, 1, 1, 0, 0, 0])], CUP);
  ok("a super over's first innings sealed: not a tied pair, so no new offer (the chase is next)", mid.offer.state === "none", mid.offer);

  const abandoned = offerOf([FIRST14, LEVEL14, so(1, A, [6, 1, 1, 0, 0, 0]), so(1, H, [1, 2], { target: 9, seal: "abandoned" })], CUP);
  ok("a super over sealed abandoned (the light went): no button and no words — the result line and the organiser say it", abandoned.offer.state === "none", abandoned.offer);

  // The Laws' answer, not ours: the probe is the engine's.
  const probe = (p, n, at) => lawsRefusal({ innings: p.innings, events: p.events },
    { ...superOverFirstStart({ ...p.offer, state: "available", n }), innings: at });
  ok("the Laws take the innings_start the pad would send", probe(cup, 1, 2) === null);
  ok("...and refuse it numbered 2 (the same answer the offer gives)", probe(cup, 2, 2) === "super_over_number");
  ok("...and refuse it after a win: super_over_not_tied", lawsRefusal({ innings: won.innings, events: won.events },
    { ...superOverFirstStart({ ...cup.offer, n: 1 }), innings: 2 }) === "super_over_not_tied");
}

group("B. The pair's flow: the two innings_starts");
{
  const p = offerOf([FIRST14, LEVEL14], CUP);
  const swapped = superOverFirstStart(p.offer, { swap: true });
  const std = superOverFirstStart(p.offer);
  ok("the first innings: the marker, one over, the standard order", std.superOver === 1 && std.overs === SUPER_OVER_OVERS && std.battingTeam === A && std.bowlingTeam === H, std);
  ok("...both squads from the match", std.squad.length === 11 && std.bowlingSquad.length === 11 && std.squad[0].id.startsWith(A), std.squad[0]);
  ok("...the order changed: Hilton first", swapped.battingTeam === H && swapped.bowlingTeam === A && swapped.superOver === 1);
  ok("...a match innings has no marker key at all, but this does", "superOver" in std);

  // Play it on the log and open the chase.
  const played = pad(buildLog([FIRST14, LEVEL14, so(1, A, [6, 1, "W", 1, 0, 0])], { conditions: CUP }), CUP);
  const firstInn = played.innings[2];
  const chase = superOverChaseStart(firstInn);
  ok("the chase: the other side, the same marker, one more than the first (6+1+1 = 8, so 9)", chase.battingTeam === H && chase.superOver === 1 && chase.target === firstInn.runs + 1 && chase.overs === 1, chase);
  ok("...squads swapped", chase.squad[0].id.startsWith(H) && chase.bowlingSquad[0].id.startsWith(A));
  ok("the Laws take the chase's start", lawsRefusal({ innings: played.innings, events: played.events }, { ...chase, innings: 3 }) === null);
  ok("...pairPlace: first, second, and none for a match innings",
     pairPlace(played.innings, 2) === "first" && pairPlace([...played.innings, chase && { ...firstInn, superOver: 1 }], 3) === "second" && pairPlace(played.innings, 0) === null);
}

group("C. The board's block: target, balls left, wickets left of two");
{
  const mid = pad(buildLog([FIRST14, LEVEL14, so(1, A, [6, 1, "W"], { seal: false })], { conditions: CUP }), CUP);
  const a = mid.innings[2];
  const blk = superOverBlock(a);
  ok("a super over's first innings: balls left and wickets left of two", blk.ballsLeft === "3 balls left" && blk.wicketsLeft === "1 wicket left of 2" && blk.target === null, blk);
  ok("...in one line", blk.line === "Super over 1 · 3 balls left · 1 wicket left of 2", blk.line);
  ok("a match innings has no block", superOverBlock(mid.innings[0]) === null);

  const chase = pad(buildLog([FIRST14, LEVEL14, so(1, A, [6, 1, 1, 0, 0, 0]), so(1, H, [4, 1], { target: 9, seal: false })], { conditions: CUP }), CUP);
  const c = chase.innings[3];
  const cb = superOverBlock(c);
  ok("a chase: need, off the balls left, and the wickets", cb.target === "Need 4 off 4" && cb.wicketsLeft === "2 wickets left of 2" && cb.line === "Super over 1 · Need 4 off 4 · 2 wickets left of 2", cb);
  const one = superOverBlock({ ...c, wickets: 2 });
  ok("two down: none left", one.wicketsLeft === "no wickets left of 2", one);
  const reached = superOverBlock({ ...c, runs: 9 });
  ok("the target reached says so", reached.target === "Target reached", reached);

  const board = boardFromInnings(c, { target: null, overs: 20 });
  ok("the board draws it: the sub line carries the block, whatever overs the caller holds", board.sub === "Super over 1 · Need 4 off 4 · 2 wickets left of 2", board.sub);
  const board1 = boardFromInnings(a, { target: null, overs: 20 });
  ok("...a first innings: balls left and wickets left of two", board1.sub === "Super over 1 · 3 balls left · 1 wicket left of 2", board1.sub);
  const plain = boardFromInnings(mid.innings[0], { target: null, overs: 1 });
  ok("a match innings' board is as it was: no super over words", !/uper over|of 2/.test(plain.sub ?? ""), plain.sub);
}

group("D. The eligibility words: a batter out, and the bowler, of an earlier super over");
{
  // Super over 1: Kearsney bat and lose a wicket (Kearsney 3 is out); Hilton bowl (Kearsney 1's bowler "1XI 1").
  const p = pad(buildLog([FIRST14, LEVEL14, so(1, A, [4, "W", 1, 1, 0, 0]), so(1, H, [1, 1, 1, 1, 1, 0], { target: 7 })], { conditions: CUP }), CUP);
  const noteA = eligibilityNotes(p.innings, 4, { battingKey: A, bowlingKey: H });
  ok("the batter who was out is named, in words and not a refusal", noteA.batters.size === 1 && [...noteA.batters.values()][0] === "Out in super over 1: may not bat in this one", [...noteA.batters.entries()]);
  ok("...the bowler of the earlier one is named", [...noteA.bowlers.values()].every((w) => w === "Bowled super over 1: may not bowl in this one") && noteA.bowlers.size >= 1, [...noteA.bowlers.entries()]);
  const none = eligibilityNotes(p.innings, 2, { battingKey: A, bowlingKey: H });
  ok("before any super over: nothing to say", none.batters.size === 0 && none.bowlers.size === 0);
  const other = eligibilityNotes(p.innings, 4, { battingKey: "Nobody", bowlingKey: "Nobody" });
  ok("a side that did not play it: nothing to say", other.batters.size === 0 && other.bowlers.size === 0);
}

group("E. The commentary's words");
{
  const log = buildLog([FIRST14, LEVEL14, so(1, A, [6, 1, "W", 1, 0, 0]), so(1, H, [4, 4, 1], { target: 9 })], { conditions: CUP });
  const items = deriveCommentary(log, { ctx: { startsAt: RESULT_STARTS_AT, conditions: CUP } });
  const innings = deriveMatch(log, { startsAt: RESULT_STARTS_AT, conditions: CUP }).innings;
  const said = superOverCommentary(items, innings);
  const starts = said.filter((i) => i.kind === "innings_start");
  ok("a match innings' opening is as the engine words it", starts[0].text === items.find((i) => i.kind === "innings_start").text);
  ok("the super over's first opening: its own words", starts[2].text === "Super over 1. Kearsney to bat first: one over, and two wickets end it.", starts[2].text);
  ok("...and its chase's: the target and the one over", starts[3].text === "Super over 1. 1XI need 9 to win from one over; two wickets end it.", starts[3].text);
  const overEnds = said.filter((i) => i.kind === "over_end" && innings[i.innings].superOver != null);
  ok("the over's end reads the super over", overEnds.length >= 1 && overEnds.every((i) => /^End of the super over:/.test(i.text)), overEnds.map((i) => i.text));
  ok("...a match innings' over ends are untouched", said.filter((i) => i.kind === "over_end" && innings[i.innings].superOver == null).every((i) => /^End of over 1:/.test(i.text)));
  ok("no career-milestone line in a super over", !said.some((i) => i.kind === "milestone" && innings[i.innings].superOver != null));
  const named = superOverCommentary(items, innings, { teamName: (_k, name) => `${name} High` });
  ok("the side is named as the screen names it", named.filter((i) => i.kind === "innings_start")[2].text.startsWith("Super over 1. Kearsney High to bat first"));
  ok("the engine's items are not mutated", items.find((i) => i.innings === 2 && i.kind === "innings_start").text.startsWith("Kearsney") === true || !/Super over/.test(items.find((i) => i.innings === 2 && i.kind === "innings_start").text));
}

group("F. The pairs, the chase, the live line");
{
  const p = pad(buildLog([FIRST14, LEVEL14, so(1, A, [4, 1, 1, 1, 0, 0]), so(1, H, [4, 1, 1, 0, 0, 1], { target: 8 }), so(2, H, [1, 1, 1, 1, 1, 0])], { conditions: CUP }), CUP);
  const pairs = superOversOf(p.innings);
  ok("the pairs, in order, as the engine states them: the first tied, the second incomplete (its chase not begun)",
     pairs.length === 2 && pairs[0].n === 1 && pairs[0].state === "tied" && pairs[1].n === 2 && pairs[1].state === "incomplete", pairs.map((x) => [x.n, x.state]));
  ok("firstSuperOverAt and matchInningsOf", firstSuperOverAt(p.innings) === 2 && matchInningsOf(p.innings).length === 2);
  ok("chaseOf: none for the first innings, a target for the match's second and a super over's second",
     chaseOf(p.innings, 0) === null && chaseOf(p.innings, 1).target === 15 && chaseOf(p.innings, 2) === null && chaseOf(p.innings, 3).target === 8 && chaseOf(p.innings, 4) === null);
  ok("a super over in play says so, in place of the engine's 'not completed'", liveSuperOverLine(p.innings, "live") === "Match tied; super over 2 in progress", liveSuperOverLine(p.innings, "live"));
  ok("...but not once the match is complete", liveSuperOverLine(p.innings, "complete") === null);
  const lost = pad(buildLog([FIRST14, LEVEL14, so(1, A, [6, 1, 1, 0, 0, 0]), so(1, H, [1, 2], { target: 9, seal: "abandoned" })], { conditions: CUP }), CUP);
  ok("...nor when the light went (sealed abandoned): the engine's words stand", liveSuperOverLine(lost.innings, "live") === null);
  ok("a match with no super over: no live line", liveSuperOverLine(pad(buildLog([FIRST14, LEVEL14], { conditions: CUP }), CUP).innings, "live") === null);
}

console.log(`\n${"─".repeat(52)}\nSUPER OVER SCREENS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

