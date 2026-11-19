/**
 * Player of the Match suggestions (Recognition R6, design D17): read from
 * deriveFacts(), never more than three, only the side's sheet, the stated
 * order, and the figures in the board's words.
 *
 *   A. the order: runs plus twenty a wicket; a tie on points is a tie; a boy
 *      with nothing is never suggested
 *   B. only the sheet given: the other side's bowler is never a suggestion
 *   C. the words: "63 (48)", "31* (22)", "3/18 (4)", "12 (9) · 2/30 (3.4)"
 *   D. a correction moves them (the void is the fold's)
 *   E. determinism: the same log gives the same answer, the input untouched
 *   F. CRI-3.3 (Kameel, 19 Nov 2026): the points and their working,
 *      "42 runs + 2 wickets (40) + 1 catch (10) = 92"
 *   G. a run out credits no bowler, and credits its named fielder
 *   H. a corrected ball changes the points
 *   I. a tie in points is shown as a tie, never broken silently, and a tie
 *      past the last place shown is named
 *   J. a fielder the log did not name is not credited, and the card says so
 *
 * Falsified (5 Nov 2026): WICKET_WEIGHT 0 → A goes red; matchFigures over
 * every batter instead of `ids` → B goes red; oversOf dividing by 5 → C.
 */
import {
  deriveFacts, inningsStart, batters, bowler, ball, voidEvent, BALL_TYPE,
  suggestPlayerOfMatch, matchFigures, figuresWords, oversOf, BASIS_WORDS, POTM_BASIS, POTM_SUGGESTIONS, WICKET_WEIGHT,
  potmCard, potmPoints, workingWords, ruleWords, unnamedWords, potmBasis, POTM_BASIS_FIELDING, FIELDING_WEIGHT,
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
  const tie = matchFigures({ version: 1, milestones: [], moments: [], fielding: [], unattributed: 0, credited: 0,
    batting: [{ player: H[0], innings: 0, runs: 20, balls: 10, out: true, summarised: false, crossings: [] }],
    bowling: [{ player: H[1], innings: 1, wickets: 1, runs: 30, balls: 24, summarised: false }] }, [H[0], H[1]]);
  ok("matchFigures reads each listed boy", tie.length === 2 && tie[0].bat?.runs === 20 && tie[1].bowl?.wickets === 1, tie);
  const tied = suggestPlayerOfMatch({ version: 1, milestones: [], moments: [], fielding: [], unattributed: 0, credited: 0,
    batting: [{ player: H[0], innings: 0, runs: 20, balls: 10, out: true, summarised: false, crossings: [] }],
    bowling: [{ player: H[1], innings: 1, wickets: 1, runs: 30, balls: 24, summarised: false }] }, [H[0], H[1]]);
  ok("a tie on points is a tie: both marked, neither preferred by a hidden rule",
     tied.length === 2 && tied.every((x) => x.tied && x.points === 20) && tied[0]?.playerId === H[0], tied);
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

// A second log, with fielders named as the pad names them (RECOGNITION R12).
// H bats first: H0 42 (off 8, out caught), H1 12*. A bats: H2 takes three
// wickets (a catch by H3, one bowled, one caught with no fielder named);
// between them A2 is run out by H3, off H2's bowling.
const FW = (/** @type {Record<string, any>} */ o, /** @type {number} */ inns) => I(ball({ type: BALL_TYPE.WICKET, value: 0, ...o }), inns);
const flog = [
  I(inningsStart({ battingTeam: "H", bowlingTeam: "A", overs: 20 }), 0),
  I(batters({ striker: H[0], nonStriker: H[1] }), 0),
  I(bowler({ bowler: A[0] }), 0),
  r(6, 0), r(6, 0), r(6, 0), r(6, 0), r(6, 0), r(6, 0),
  I(bowler({ bowler: A[1] }), 0), I(batters({ striker: H[0], nonStriker: H[1] }), 0), r(6, 0),
  FW({ dismissal: "caught", fielders: [A[2]] }, 0), I(batters({ striker: H[1], nonStriker: H[5] }), 0),
  r(6, 0), r(6, 0),
  I(inningsStart({ battingTeam: "A", bowlingTeam: "H", overs: 20, target: 100 }), 1),
  I(batters({ striker: A[0], nonStriker: A[1] }), 1),
  I(bowler({ bowler: H[2] }), 1),
  FW({ dismissal: "caught", fielders: [H[3]] }, 1), I(batters({ striker: A[2] }), 1),
  FW({ dismissal: "bowled" }, 1), I(batters({ striker: A[3] }), 1),
  FW({ dismissal: "run_out", fielders: [H[3]] }, 1), I(batters({ striker: A[4] }), 1),
  FW({ dismissal: "caught" }, 1), I(batters({ striker: A[5] }), 1),
  r(1, 1),
];

group("F. The points and their working (CRI-3.3)");
{
  const f = deriveFacts(flog, [...H, ...A]);
  ok("the log names fielders: fielding counts", potmBasis(f) === POTM_BASIS_FIELDING && FIELDING_WEIGHT === 10);
  const card = potmCard(f, H);
  const by = Object.fromEntries(card.suggestions.map((x) => [x.playerId, x]));
  ok("42 runs = 42", by[H[0]]?.points === 42 && by[H[0]]?.working === "42 runs = 42", by[H[0]]);
  ok("3 wickets (60) = 60", by[H[2]]?.points === 60 && by[H[2]]?.working === "3 wickets (60) = 60", by[H[2]]);
  ok("1 catch (10) + 1 run out (10) = 20", by[H[3]]?.points === 20 && by[H[3]]?.working === "1 catch (10) + 1 run out (10) = 20", by[H[3]]);
  ok("in points order: 60, 42, then 20", card.suggestions.map((x) => x.playerId).join() === [H[2], H[0], H[3]].join(), card.suggestions);
  ok("the brief's example, word for word",
     workingWords({ playerId: "x", bat: { runs: 42, balls: 30, out: true }, bowl: { wickets: 2, runs: 20, balls: 24 }, field: { catches: 1, stumpings: 0, runOuts: 0 } })
       === "42 runs + 2 wickets (40) + 1 catch (10) = 92");
  ok("one of each is singular, a stumping its own part",
     workingWords({ playerId: "x", bat: { runs: 1, balls: 1, out: false }, bowl: { wickets: 1, runs: 0, balls: 6 }, field: { catches: 0, stumpings: 1, runOuts: 0 } })
       === "1 run + 1 wicket (20) + 1 stumping (10) = 31");
  ok("nothing to count says so", workingWords({ playerId: "x", bat: null, bowl: null }) === "0 points");
  ok("the parts add up", potmPoints({ playerId: "x", bat: { runs: 7, balls: 3, out: true }, bowl: { wickets: 3, runs: 9, balls: 12 },
     field: { catches: 2, stumpings: 0, runOuts: 1 } }).total === 7 + 60 + 30);
  ok("the rule said on each basis", ruleWords(POTM_BASIS_FIELDING) === "Points: runs, plus 20 a wicket, plus 10 a catch, stumping or run out."
     && ruleWords(POTM_BASIS) === "Points: runs, plus 20 a wicket.");
  ok("the figures still read as the board's, the SQL mirror's words", by[H[3]]?.figures === "1 catch · 1 run out", by[H[3]]);
}

group("G. A run out credits no bowler");
{
  const f = deriveFacts(flog, [...H, ...A]);
  const fig = Object.fromEntries(matchFigures(f, H).map((x) => [x.playerId, x]));
  ok("the bowler on the run out has his three wickets, not four", fig[H[2]]?.bowl?.wickets === 3, fig[H[2]]);
  ok("...and his working counts three", potmPoints(fig[H[2]]).total === 60);
  ok("the run out's named fielder has it", fig[H[3]]?.field?.runOuts === 1, fig[H[3]]);
  // A run out alone, on a bowler's over: nothing to the bowler.
  const ro = [...flog.slice(0, 3), FW({ dismissal: "run_out", fielders: [A[2]] }, 0)];
  const g = deriveFacts(ro, [...H, ...A]);
  ok("a bowler whose only wicket ball is a run out is not suggested on it",
     !potmCard(g, A).suggestions.some((x) => x.playerId === A[0]), potmCard(g, A));
  ok("...and the fielder is, for ten", potmCard(g, A).suggestions[0]?.playerId === A[2] && potmCard(g, A).suggestions[0]?.working === "1 run out (10) = 10");
}

group("H. A corrected ball changes the points");
{
  const six = /** @type {any} */ (flog.find((e) => e.kind === "ball" && e.innings === 0 && e.value === 6));
  const catchBall = /** @type {any} */ (flog.find((e) => e.kind === "ball" && e.dismissal === "caught" && e.fielders?.[0] === H[3]));
  const f0 = potmCard(deriveFacts(flog, [...H, ...A]), H);
  const f1 = potmCard(deriveFacts([...flog, I(voidEvent({ target: six.id }), 0)], [...H, ...A]), H);
  const p = (/** @type {any} */ c, /** @type {string} */ id) => c.suggestions.find((/** @type {any} */ x) => x.playerId === id);
  ok("a six voided: 42 becomes 36, and the working says it", p(f1, H[0])?.points === 36 && p(f1, H[0])?.working === "36 runs = 36", p(f1, H[0]));
  const f2 = potmCard(deriveFacts([...flog, I(voidEvent({ target: catchBall.id }), 1)], [...H, ...A]), H, 6);
  ok("a catch voided: the catcher loses its ten and the bowler its twenty",
     p(f2, H[3])?.working === "1 run out (10) = 10" && p(f2, H[2])?.working === "2 wickets (40) = 40", f2.suggestions);
  ok("...and the order moves: 42 now heads 40", f2.suggestions[0]?.playerId === H[0] && f0.suggestions[0]?.playerId === H[2], f2.suggestions);
}

group("I. A tie in points is a tie");
{
  // Four boys on the sheet: 30, 30, 30 and 30 — three places, four level.
  const facts = { version: 2, milestones: [], moments: [], fielding: [], unattributed: 0, credited: 0,
    batting: [H[3], H[1], H[0]].map((p) => ({ player: p, innings: 0, runs: 30, balls: 20, out: true, summarised: false, crossings: [] })),
    bowling: [{ player: H[2], innings: 1, wickets: 1, runs: 12, balls: 12, summarised: false }] };
  // H2's 20 is not level; give him 10 runs too so he is 30.
  facts.batting.push({ player: H[2], innings: 0, runs: 10, balls: 5, out: false, summarised: false, crossings: [] });
  const c = potmCard(/** @type {any} */ (facts), H);
  ok("three shown, every one marked tied on 30", c.suggestions.length === 3 && c.suggestions.every((x) => x.tied && x.points === 30), c);
  ok("the fourth level boy is named, not dropped", c.alsoTied.length === 1 && c.alsoTied[0].points === 30 && c.alsoTied[0].tied, c.alsoTied);
  ok("the four are the four level boys", new Set([...c.suggestions, ...c.alsoTied].map((x) => x.playerId)).size === 4);
  ok("...in id order, the same on every device, whatever the sheet's order",
     JSON.stringify(potmCard(/** @type {any} */ (facts), [...H].reverse())) === JSON.stringify(c));
  const clear = potmCard(deriveFacts(flog, [...H, ...A]), H);
  ok("no tie, nobody marked tied and nothing also tied", clear.suggestions.every((x) => !x.tied) && clear.alsoTied.length === 0, clear);
  ok("the list never exceeds three, what the decision may store (db/142)", c.suggestions.length <= POTM_SUGGESTIONS);
}

group("J. A fielder the log did not name is not credited");
{
  const f = deriveFacts(flog, [...H, ...A]);
  ok("one catch named nobody: one unattributed", f.unattributed === 1, f.unattributed);
  const card = potmCard(f, H);
  ok("...the bowler of it has his wicket", matchFigures(f, [H[2]])[0]?.bowl?.wickets === 3);
  ok("...nobody on the sheet holds a catch for it: H3's one catch is the named one",
     matchFigures(f, H).reduce((s, x) => s + (x.field?.catches ?? 0), 0) === 1);
  ok("...the named fielders still count though another wicket named nobody", card.suggestions.some((x) => x.playerId === H[3] && x.points === 20));
  ok("...and the card says so plainly", card.unnamed === 1
     && unnamedWords(card.unnamed) === "1 dismissal in this match names no fielder, so no fielder is credited for it.");
  ok("several said in the plural, none said not at all",
     unnamedWords(2) === "2 dismissals in this match name no fielder, so no fielder is credited for them." && unnamedWords(0) === null);
  // A log that names nobody at all (before R12): batting and bowling only.
  const old = flog.map((e) => (e.kind === "ball" && e.fielders ? (({ fielders, ...rest }) => rest)(e) : e));
  const g = deriveFacts(old, [...H, ...A]);
  ok("a log naming no fielder anywhere: batting and bowling only, and every fielding wicket unnamed",
     potmBasis(g) === POTM_BASIS && g.unattributed === 4 && !potmCard(g, H).suggestions.some((x) => x.working.includes("catch")), potmCard(g, H));
}

console.log(`\n${"─".repeat(52)}\nPOTM SUGGESTIONS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
