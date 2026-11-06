/**
 * Player of the Match suggestions (Recognition R6, design D17): read from
 * deriveFacts(), never more than three, only the side's sheet, the stated
 * order, and the figures in the board's words.
 *
 *   A. the order: runs plus twenty a wicket; ties to wickets, then runs, then
 *      fewer balls; a boy with nothing is never suggested
 *   B. only the sheet given: the other side's bowler is never a suggestion
 *   C. the words: "63 (48)", "31* (22)", "3/18 (4)", "12 (9) · 2/30 (3.4)"
 *   D. a correction moves them (the void is the fold's)
 *   E. determinism: the same log gives the same answer, the input untouched
 *
 * Falsified (5 Nov 2026): WICKET_WEIGHT 0 → A goes red; matchFigures over
 * every batter instead of `ids` → B goes red; oversOf dividing by 5 → C.
 */
import {
  deriveFacts, inningsStart, batters, bowler, ball, voidEvent, BALL_TYPE,
  suggestPlayerOfMatch, matchFigures, figuresWords, oversOf, BASIS_WORDS, POTM_BASIS, POTM_SUGGESTIONS, WICKET_WEIGHT,
} from "../src/index.mjs";

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, detail) => {
  if (c) pass++;
  else { fail++; console.log("  ✗", n, detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 600)}`); }
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

// Ids shaped as the database's. H is the side being decided, A the other.
const H = Array.from({ length: 6 }, (_, k) => `a1a1a1a1-0000-4000-8000-0000000000${String(k + 1).padStart(2, "0")}`);
const A = Array.from({ length: 6 }, (_, k) => `b2b2b2b2-0000-4000-8000-0000000000${String(k + 1).padStart(2, "0")}`);
const T0 = Date.parse("2026-10-03T08:00:00Z");
let n = 0;
/** @template {object} T @param {T} e @param {number} inns */
const I = (e, inns) => { n++; return { ...e, id: `pm:${n.toString(36)}`, seq: n, innings: inns, clientTs: T0 + n * 1000 }; };
const r = (/** @type {number} */ v, /** @type {number} */ inns) => I(ball({ type: BALL_TYPE.RUN, value: v }), inns);
const W = (/** @type {number} */ inns) => I(ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }), inns);

// Innings 0: H bats. H0 makes 30 off 6 balls (five sixes and a dot) and is
// out bowled by A0 on the 7th; H1 comes in and is 4* off 1.
// Innings 1: A bats. H2 bowls an over: three wickets for 6. H3 bowls an
// over for 10. A0 makes 16.
const log = [
  I(inningsStart({ battingTeam: "H", bowlingTeam: "A", overs: 20 }), 0),
  I(batters({ striker: H[0], nonStriker: H[5] }), 0),
  I(bowler({ bowler: A[0] }), 0),
  r(6, 0), r(6, 0), r(6, 0), r(6, 0), r(6, 0), r(0, 0),
  I(bowler({ bowler: A[1] }), 0),
  I(batters({ striker: H[5], nonStriker: H[0] }), 0), r(0, 0), I(batters({ striker: H[0], nonStriker: H[5] }), 0),
  W(0), I(batters({ striker: H[1] }), 0), r(4, 0),
  I(inningsStart({ battingTeam: "A", bowlingTeam: "H", overs: 20, target: 39 }), 1),
  I(batters({ striker: A[0], nonStriker: A[1] }), 1),
  I(bowler({ bowler: H[2] }), 1),
  W(1), I(batters({ striker: A[2] }), 1), W(1), I(batters({ striker: A[3] }), 1), W(1), I(batters({ striker: A[0] }), 1),
  r(6, 1), r(0, 1), r(0, 1),
  I(bowler({ bowler: H[3] }), 1),
  r(4, 1), r(6, 1), r(0, 1), r(0, 1), r(0, 1), r(0, 1),
];

group("A. The order: runs plus twenty a wicket");
{
  const f = deriveFacts(log);
  const s = suggestPlayerOfMatch(f, H);
  ok("three at most", s.length === POTM_SUGGESTIONS && POTM_SUGGESTIONS === 3, s);
  ok("three wickets (60) before thirty runs", s[0]?.playerId === H[2] && s[1]?.playerId === H[0], s);
  ok("...then the four not out", s[2]?.playerId === H[1], s);
  ok("a bowler with no wicket and a batter who scored nothing are not suggested",
     !s.some((x) => x.playerId === H[3] || x.playerId === H[5]), s);
  ok("the weight is stated: twenty a wicket", WICKET_WEIGHT === 20);
  ok("two asked for, two given", suggestPlayerOfMatch(f, H, 2).length === 2);
  ok("the basis is said in words and stored as a word", BASIS_WORDS === "Based on batting and bowling only." && POTM_BASIS === "batting_bowling");
  // A tie on weight goes to wickets: 20 runs v one wicket.
  const tie = matchFigures({ version: 1, milestones: [], moments: [],
    batting: [{ player: H[0], innings: 0, runs: 20, balls: 10, out: true, summarised: false, crossings: [] }],
    bowling: [{ player: H[1], innings: 1, wickets: 1, runs: 30, balls: 24, summarised: false }] }, [H[0], H[1]]);
  ok("matchFigures reads each listed boy", tie.length === 2 && tie[0].bat?.runs === 20 && tie[1].bowl?.wickets === 1, tie);
  const tied = suggestPlayerOfMatch({ version: 1, milestones: [], moments: [],
    batting: [{ player: H[0], innings: 0, runs: 20, balls: 10, out: true, summarised: false, crossings: [] }],
    bowling: [{ player: H[1], innings: 1, wickets: 1, runs: 30, balls: 24, summarised: false }] }, [H[0], H[1]]);
  ok("a tie on weight goes to the wicket", tied[0]?.playerId === H[1], tied);
}

group("B. Only the sheet given");
{
  const f = deriveFacts(log);
  ok("the other side's bowler (a wicket) and batter (16) are never this side's suggestions",
     !suggestPlayerOfMatch(f, H).some((x) => A.includes(x.playerId)));
  ok("...and are theirs when their sheet is asked", suggestPlayerOfMatch(f, A).some((x) => x.playerId === A[0]));
  ok("an empty sheet suggests nobody", suggestPlayerOfMatch(f, []).length === 0);
}

group("C. The words");
{
  const f = deriveFacts(log);
  const words = Object.fromEntries(matchFigures(f, H).map((x) => [x.playerId, figuresWords(x)]));
  ok("30 off 7, out", words[H[0]] === "30 (7)", words[H[0]]);
  ok("4 not out off 1", words[H[1]] === "4* (1)", words[H[1]]);
  ok("three for six off one over", words[H[2]] === "3/6 (1)", words[H[2]]);
  ok("nought for ten off one over", words[H[3]] === "0/10 (1)", words[H[3]]);
  ok("a boy who did neither", words[H[4]] === "Did not bat or bowl", words[H[4]]);
  ok("both, joined", figuresWords({ playerId: "x", bat: { runs: 12, balls: 9, out: true }, bowl: { wickets: 2, runs: 30, balls: 22 } }) === "12 (9) · 2/30 (3.4)");
  ok("a scorebook's innings has no balls to say", figuresWords({ playerId: "x", bat: { runs: 12, balls: null, out: false }, bowl: null }) === "12*");
  ok("overs as the board writes them", oversOf(0) === "0" && oversOf(6) === "1" && oversOf(22) === "3.4" && oversOf(5) === "0.5");
  ok("the suggestion carries the words", suggestPlayerOfMatch(f, H)[0]?.figures === "3/6 (1)");
}

group("D. A correction moves them");
{
  // Void the second wicket: H2 has two, and thirty runs (30) beat forty (40)? No: 40 > 30, still first.
  // Void all three: H2 has none and is gone.
  const wickets = log.filter((e) => e.innings === 1 && e.kind === "ball" && e.type === BALL_TYPE.WICKET);
  const voided = [...log, ...wickets.map((w) => I(voidEvent({ target: w.id }), 1))];
  const s = suggestPlayerOfMatch(deriveFacts(voided), H);
  ok("three wickets voided: the bowler is no longer suggested", !s.some((x) => x.playerId === H[2]), s);
  ok("...and the thirty heads the list", s[0]?.playerId === H[0], s);
}

group("E. Determinism");
{
  const before = JSON.stringify(log);
  const a = suggestPlayerOfMatch(deriveFacts(log), H), b = suggestPlayerOfMatch(deriveFacts(log), [...H].reverse());
  ok("the same log, the sheet in any order, the same suggestions", JSON.stringify(a) === JSON.stringify(b), [a, b]);
  ok("the log is not touched", JSON.stringify(log) === before);
}

console.log(`\n${"─".repeat(52)}\nPOTM SUGGESTIONS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
