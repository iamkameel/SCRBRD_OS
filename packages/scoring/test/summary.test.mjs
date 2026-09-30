/**
 * An innings from a paper scorebook (SCRBRD-120, phase 1): the card's shape
 * and arithmetic, the fold of a summary, the seal against it, and the three
 * Laws rules. db/63's proof and db/99 §41 hold the SQL half;
 * tools/smoke-scorebook.mjs the API and the parity of summaryRefusal() with
 * summary_reconciles() over the same PARITY list (scorebook-cards.mjs).
 *
 *   A. The arithmetic over the PARITY list, and the rule of sides (D6)
 *   B. normaliseCard() keeps a card's fields and nothing else; typed names
 *   C. Every cell a person must tick (§6.3)
 *   D. The fold: the card's figures, nothing zero-filled (D12), no ball
 *      invented, names from the typed map, the seal against the figures
 *   E. The Laws: LIVE_INNINGS, SUMMARISED_INNINGS, ALREADY_SUMMARISED, and
 *      the order an innings is played in
 *   F. The wire: toRow()/fromRow(), and inningsSummary()'s typed map
 *
 *   node packages/scoring/test/summary.test.mjs
 */
import {
  summaryRefusal, summaryCodes, normaliseCard, normaliseTyped, cellPaths, uncheckedCells,
  SUMMARY_REFUSAL, SUMMARY_REFUSAL_TEXT, CARD_END_REASON, ballsOfOvers,
  inningsStart, inningsSummary, inningsEnd, batters, bowler, ball, penalty, retire, voidEvent, revision, bowlerSuspended,
  deriveMatch, MatchFold, lawsRefusal, REFUSAL, REFUSAL_TEXT, toRow, fromRow, KIND, BALL_TYPE, SEAL_REFUSAL,
} from "../src/index.mjs";
import { TYPED, baseCard, PARITY } from "./scorebook-cards.mjs";

/** @import { LogEvent, ScorebookCard } from "../src/events.mjs" */

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c  @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const P = ["11111111-0000-0000-0000-000000000001", "11111111-0000-0000-0000-000000000002",
           "11111111-0000-0000-0000-000000000003", "11111111-0000-0000-0000-000000000004",
           "11111111-0000-0000-0000-000000000005", "11111111-0000-0000-0000-000000000006"];
const DNB = ["11111111-0000-0000-0000-000000000007", "11111111-0000-0000-0000-000000000008",
             "11111111-0000-0000-0000-000000000009", "11111111-0000-0000-0000-00000000000a",
             "11111111-0000-0000-0000-00000000000b"];
const ctx = { typed: TYPED, ours: /** @type {"home"} */ ("home") };
/** @returns {ScorebookCard} */
const card = () => baseCard(P, DNB);

group("A. The arithmetic, over the PARITY list");
{
  for (const [name, change, want] of PARITY) {
    const c = card();
    change(c);
    const got = summaryCodes(c, ctx);
    ok(`${name}: ${want || "clean"}`, got === want, got);
  }
  ok("every code has words", Object.values(SUMMARY_REFUSAL).every((c) => typeof SUMMARY_REFUSAL_TEXT[c] === "string"));
  const r = summaryRefusal({ ...card(), wickets: 5, fallOfWickets: [] }, ctx);
  ok("a refusal names its cell and says why", r.length === 1 && r[0].path === "wickets" && r[0].text === SUMMARY_REFUSAL_TEXT.wickets_mismatch, r);
  // Sides (D6): ours from the roster, theirs typed.
  const typedOurs = card(); typedOurs.batting[5].ref = "t:5";
  ok("a home batter typed, not chosen, is refused", summaryCodes(typedOurs, ctx).includes("ref_side"), summaryCodes(typedOurs, ctx));
  const idTheirs = card(); idTheirs.bowling[2].ref = DNB[0]; idTheirs.didNotBat = DNB.slice(1);
  ok("an opposition bowler named by a player id is refused", summaryCodes(idTheirs, ctx).includes("ref_side"));
  ok("...and allowed between two sides of one school, where a typed name is the refusal instead",
     !summaryRefusal(idTheirs, { ...ctx, ours: "both" }).some((r) => r.path === "bowling.2.ref")
     && summaryRefusal(idTheirs, { ...ctx, ours: "both" }).some((r) => r.path === "bowling.0.ref" && r.code === "ref_side"));
  const away = card(); away.battingSide = "away";
  ok("the away side batting: our rows are the bowlers", summaryCodes(away, ctx).includes("ref_side"));
  ok("no context asks nothing about sides", summaryCodes(typedOurs, { typed: TYPED }) === "");
  ok("a typed key with no spelling names nobody", summaryCodes(card(), { typed: {}, ours: "home" }) === "ref_unknown");
  ok("not an object is a shape", summaryCodes(null) === "card_shape" && summaryCodes([]) === "card_shape");
  ok("ballsOfOvers reads a book's overs", ballsOfOvers("47.3") === 285 && ballsOfOvers("20") === 120
     && ballsOfOvers("3.6") === null && ballsOfOvers(20) === null && ballsOfOvers("") === null);
}

group("B. A card's fields and nothing else");
{
  const sent = { ...card(), sneaky: "Opp Fielder One", batting: card().batting.map((b) => ({ ...b, name: "A Boy" })) };
  const clean = normaliseCard(sent);
  ok("a stray field is dropped, a stray row field too", !("sneaky" in clean) && clean.batting.every((/** @type {any} */ b) => !("name" in b)));
  ok("...and what is left is the card", summaryCodes(clean, ctx) === "", summaryCodes(clean, ctx));
  ok("a missing figure stays missing (null), never nought", normaliseCard({ batting: [{ ref: P[0] }] }).batting[0].balls === null
     && normaliseCard({}).total === null);
  ok("sixteen rows are kept to be refused, not quietly cut to fifteen",
     summaryCodes(normaliseCard({ ...card(), didNotBat: Array.from({ length: 30 }, () => DNB[0]) }), ctx).includes("card_shape"));
  const t = normaliseTyped({ "t:1": "  Opp   Fielder  ", "t:x": "no", "t:2": "", "3": "no", "t:4": 7, "t:5": "x".repeat(81) });
  ok("typed names: t:<n>, trimmed, one to eighty characters", JSON.stringify(t) === JSON.stringify({ "t:1": "Opp Fielder" }), t);
  ok("an ending is one of the book's", Object.keys(CARD_END_REASON).join() === "all_out,overs,target,declared,time,other");
}

group("C. Every cell ticked by a person");
{
  const paths = cellPaths([card()]);
  ok("the paths name each figure of each row", paths.includes("0.total") && paths.includes("0.batting.3.balls")
     && paths.includes("0.bowling.2.noBalls") && paths.includes("0.fallOfWickets.3.over") && paths.includes("0.didNotBat.4")
     && !paths.includes("0.batting.0.order"), paths.length);
  const all = Object.fromEntries(paths.map((p) => [p, true]));
  ok("all ticked: nothing left", uncheckedCells([card()], all).length === 0);
  const { ["0.batting.3.balls"]: _gone, ...less } = all;
  ok("one not ticked is named", JSON.stringify(uncheckedCells([card()], less)) === JSON.stringify(["0.batting.3.balls"]));
  ok("a confidence is not a tick", uncheckedCells([card()], { ...all, "0.total": 0.99 }).join() === "0.total");
}

// ── A match whose first innings is a scorebook's ──
const SRC = { kind: /** @type {"scorebook"} */ ("scorebook"), import: "imp-1", checkedBy: "u-scorer", confirmedBy: "u-dos" };
/** @param {ScorebookCard} c @param {object} [o] @returns {LogEvent[]} */
const imported = (c, o = {}) => [
  inningsStart({ innings: c.innings, battingTeam: "1XI", bowlingTeam: "Opposition", overs: 20, id: `s${c.innings}`,
                 squad: [...P, ...DNB].map((id) => ({ id, name: `Boy ${id.slice(-1)}` })), ...o }),
  inningsSummary({ innings: c.innings, card: c, typed: TYPED, source: SRC, id: `m${c.innings}` }),
  inningsEnd({ innings: c.innings, reason: CARD_END_REASON[/** @type {keyof typeof CARD_END_REASON} */ (c.endReason)],
               confirmed: { runs: c.total, wickets: c.wickets, balls: ballsOfOvers(c.overs) }, id: `e${c.innings}` }),
];

group("D. The fold of a summary");
{
  const m = deriveMatch(imported(card()));
  const inn = m.innings[0];
  ok("the card's figures are the innings'", inn.runs === 127 && inn.wickets === 4 && inn.balls === 120, [inn.runs, inn.wickets, inn.balls]);
  ok("sealed on its own figures, for the overs", inn.sealed && inn.complete && inn.endReason === "overs_complete" && inn.sealRefused == null,
     [inn.sealed, inn.endReason, inn.sealRefused]);
  ok("no ball is invented: no ball log, no overs, no partnership", inn.ballLog.length === 0 && inn.overLog.length === 0 && inn.partnerships.length === 0);
  ok("marked summarised, with its source", inn.summarised?.import === "imp-1" && inn.summarised?.checkedBy === "u-scorer"
     && inn.summarised?.confirmedBy === "u-dos" && inn.summarised?.unreconciled === null);
  const b4 = inn.batsmen.find((b) => b.id === P[3]);
  ok("a batter's balls, fours and sixes the book does not give stay null (D12)", b4?.balls === null && b4?.fours === null && b4?.sixes === null && b4?.runs === 25, b4);
  ok("the batting order is the card's", inn.batsmen.map((b) => b.id).join() === P.join());
  ok("dismissal lines in the pad's words, names from the typed map",
     inn.batsmen[0].dismissal === "c Opp Fielder One b Opp Bowler Two" && inn.batsmen[1].dismissal === "b Opp Bowler Two"
     && inn.batsmen[3].dismissal === "run out (Opp Fielder Four)" && inn.batsmen[4].status === "batting" && inn.batsmen[4].dismissal === null,
     inn.batsmen.map((b) => b.dismissal));
  ok("our boys by the squad's names", inn.batsmen[0].name === "Boy 1");
  const t5 = inn.bowlers.find((b) => b.id === "t:5");
  ok("a bowler's maidens, wides and no-balls the book does not give stay null, and are not counted",
     t5?.maidens === null && t5?.wides === null && t5?.noBalls === null && t5?.balls === 24 && inn.bowlers[1].maidens === 1, inn.bowlers);
  ok("extras as the book gives them", JSON.stringify(inn.extras) === JSON.stringify({ wide: 5, noBall: 3, bye: 2, legBye: 1, penalty: 0 }), inn.extras);
  ok("the fall of wickets", inn.fow.length === 4 && inn.fow[2].runs === 60 && inn.fow[2].batsman === "Boy 1" && inn.fow[3].overs === "15");
  const u = card(); u.extras.wides = null; u.extras.byes = null; u.unreconciled = { runs: 7, note: "not broken down" };
  const ui = deriveMatch(imported(u)).innings[0];
  ok("an extra the book does not break down is null, not nought", ui.extras.wide === null && ui.extras.bye === null && ui.runs === 127);
  ok("the recorded difference rides on the innings (D4)", ui.summarised?.unreconciled?.runs === 7);

  // The seal, against the figures (§2.3): "all out" with four down is not the Laws' ending.
  const wrong = card(); wrong.endReason = "all_out";
  const wi = deriveMatch(imported(wrong)).innings[0];
  ok("a card whose ending disagrees with its figures is refused at the seal", !wi.sealed && wi.sealRefused === SEAL_REFUSAL.NOT_THE_LAWS_REASON, wi.sealRefused);
  ok("a declaration is taken on the book's word, with the figures", (() => {
    const d = card(); d.endReason = "declared"; d.overs = "20";
    const di = deriveMatch(imported(d)).innings[0];
    return di.sealed && di.endReason === "declared";
  })());
  // A chase that got there: the target on its innings_start.
  const chase = card(); chase.innings = 1; chase.battingSide = "away"; chase.endReason = "target"; chase.overs = "19.2";
  chase.bowling[2].overs = "3.2";
  const first = card(); first.total = 126; first.batting[4].runs = 39; first.fallOfWickets[3].score = 90;
  first.bowling[2].runs = 38;
  const log = [...imported(first), ...imported(chase, { target: 127 })];
  const two = deriveMatch(log);
  ok("a chase reaches its target and is sealed for it", two.innings[1].sealed && two.innings[1].endReason === "target_reached", two.innings[1].sealRefused);
  ok("the result reads from the two summaries", two.result?.winner === "1XI" && /wicket/.test(two.result?.margin ?? ""), two.result);
  const inc = new MatchFold([], {});
  for (const ev of log) inc.push(ev);
  const v = inc.view().innings;
  ok("the incremental fold agrees", v[0].runs === two.innings[0].runs && v[1].runs === 127 && v[1].summarised != null && v[1].balls === 116);
  // All out when it is: a side of five (the squad the innings opened with),
  // four down.
  const five = deriveMatch(imported({ ...card(), endReason: "all_out" }, { squad: P.slice(0, 5).map((id) => ({ id, name: id })) })).innings[0];
  ok("all out when the squad says four down is all of them", five.sealed && five.endReason === "all_out", five.sealRefused);
}

group("E. The Laws: live or imported, never both (D3)");
{
  const start = inningsStart({ innings: 0, battingTeam: "1XI", bowlingTeam: "Opposition", overs: 20, id: "s0",
                               squad: P.map((id) => ({ id, name: id })) });
  const summ = inningsSummary({ innings: 0, card: card(), typed: TYPED, source: SRC, id: "m0" });
  /** @param {LogEvent[]} evs */
  const view = (evs) => new MatchFold(evs, {}).view();
  const pair = batters({ innings: 0, striker: P[0], nonStriker: P[1], id: "b0" });
  const bw = bowler({ innings: 0, bowler: "t:2", id: "w0" });
  const dot = ball({ innings: 0, type: BALL_TYPE.RUN, value: 0, id: "d0" });

  ok("a summary for an opened innings is allowed", lawsRefusal(view([start]), summ) === null);
  ok("...not before it is opened", lawsRefusal(view([]), summ) === REFUSAL.NO_INNINGS);
  ok("...not over a delivery (LIVE_INNINGS)", lawsRefusal(view([start, pair, bw, dot]), summ) === REFUSAL.LIVE_INNINGS);
  ok("...not over the openers alone", lawsRefusal(view([start, pair]), summ) === REFUSAL.LIVE_INNINGS);
  ok("...not over a penalty", lawsRefusal(view([start, penalty({ innings: 0, runs: 5, toBattingTeam: true, id: "p0" })]), summ) === REFUSAL.LIVE_INNINGS);
  ok("...but over openers since voided", lawsRefusal(view([start, pair, voidEvent({ innings: 0, target: "b0", id: "v0" })]), summ) === null);
  ok("a second summary is refused (ALREADY_SUMMARISED)", lawsRefusal(view([start, summ]), { ...summ, id: "m1" }) === REFUSAL.ALREADY_SUMMARISED);
  ok("...until an amendment voids the first", lawsRefusal(view([start, summ, voidEvent({ innings: 0, target: "m0", id: "v1" })]), { ...summ, id: "m1" }) === null);

  const after = view([start, summ]);
  for (const [name, ev] of /** @type {[string, LogEvent][]} */ ([
    ["a ball", dot], ["the openers", pair], ["a bowler", bw],
    ["a penalty", penalty({ innings: 0, runs: 5, toBattingTeam: false, id: "p1" })],
    ["a retirement", retire({ innings: 0, batter: P[4], id: "r0" })],
    ["a suspension", bowlerSuspended({ innings: 0, bowler: "t:2", reason: "short_pitched", id: "x0" })],
    ["a new innings_start", { ...start, id: "s9" }],
    ["a revision", revision({ innings: 0, overs: 15, id: "rv0" })],
  ])) ok(`${name} in a summarised innings is refused (SUMMARISED_INNINGS)`, lawsRefusal(after, ev) === REFUSAL.SUMMARISED_INNINGS, lawsRefusal(after, ev));
  ok("its seal is not", lawsRefusal(after, inningsEnd({ innings: 0, reason: "overs_complete", confirmed: { runs: 127, wickets: 4, balls: 120 } })) === null);

  const second = inningsStart({ innings: 1, battingTeam: "Opposition", bowlingTeam: "1XI", overs: 20, id: "s1" });
  const summ1 = inningsSummary({ innings: 1, card: { ...card(), innings: 1 }, typed: TYPED, id: "m1" });
  ok("a summary for the second innings while the first is open is refused",
     lawsRefusal(view([start, pair, second]), summ1) === REFUSAL.PREVIOUS_INNINGS_OPEN);
  const [s0, m0, e0] = imported(card());
  ok("...and allowed once the first is sealed", lawsRefusal(view([s0, m0, e0, second]), summ1) === null);
  ok("no summary of an innings once a later one has a delivery",
     lawsRefusal(view([start, second, batters({ innings: 1, striker: "t:1", nonStriker: "t:2" }), bowler({ innings: 1, bowler: P[0] }),
                       ball({ innings: 1, type: BALL_TYPE.RUN, value: 1 })]), summ) === REFUSAL.LATER_INNINGS_STARTED);
  ok("...nor a ball in an earlier innings once a later one is summarised",
     lawsRefusal(view([start, pair, bw, second, summ1]), dot) === REFUSAL.LATER_INNINGS_STARTED);
  ok("every new code has words", [REFUSAL.LIVE_INNINGS, REFUSAL.SUMMARISED_INNINGS, REFUSAL.ALREADY_SUMMARISED]
     .every((c) => typeof REFUSAL_TEXT[c] === "string" && !/\d+\.\d+/.test(REFUSAL_TEXT[c])));
}

group("F. The wire");
{
  const ev = inningsSummary({ innings: 0, card: card(), typed: { ...TYPED, "t:77": "Somebody Else" }, source: SRC, id: "scorebook:x:0:summary", clientTs: 1_700_000_000_000 });
  ok("the typed map keeps only the names this card uses", !("t:77" in ev.typed) && Object.keys(ev.typed).length === 5);
  ok("the kind", ev.kind === KIND.INNINGS_SUMMARY && ev.kind === "innings_summary");
  const row = toRow(ev);
  ok("no ball column: no type, value or player id", row.ball_type === null && row.value === null && row.striker_id === null
     && row.bowler_id === null && row.dismissal === undefined && row.kind === "innings_summary" && row.innings === 0);
  ok("the card, the names and the source ride in the payload", JSON.stringify(Object.keys(row.payload).sort()) === JSON.stringify(["card", "id", "source", "typed"]),
     Object.keys(row.payload));
  const back = fromRow({ ...row, seq: 3, idempotency_key: ev.id, payload: Object.fromEntries(Object.entries(row.payload).filter(([k]) => k !== "id")) });
  ok("fromRow() gives the event back", back.kind === ev.kind && JSON.stringify(back.card) === JSON.stringify(ev.card)
     && JSON.stringify(back.typed) === JSON.stringify(ev.typed) && back.id === ev.id && back.clientTs === ev.clientTs);
}

console.log(`\n${"─".repeat(52)}\nSUMMARY SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
