/**
 * A match's result (SCRBRD-114 phase 3a; docs/design/SCRBRD-114_phase3_results_super_over.md §2):
 *
 *   P. every log of result-logs.mjs folds to the result the design gives it —
 *      outcome, margin, who won, who decided, and the words; the same logs
 *      tools/smoke-fold-figures.mjs holds SQL's match_result() to
 *   Q. the two misreadings §2.2 names are gone: a chase sealed `abandoned` is
 *      no result, never a win by the runs it was short; a two-innings match is
 *      not read from its first two innings
 *   R. a caller that tells describeResult() nothing gets the shape it always
 *      had: `winner` the batting side's name, `margin` "3 wickets", null
 *      while undecided — and `win`, not a side, when it was told no sides
 *   S. the words: resultWords() over match_result()'s row (resultFromRow())
 *      are describeResult()'s, and the public page's leave a reason out
 */
import { deriveMatch, describeResult, resultWords, resultFromRow, OUTCOME,
         fixtureClass, COMP_TYPE, COMP_TYPES, FIXTURE_CLASS, NO_BOARD } from "../src/index.mjs";
import { RESULT_LOGS, RESULT_SIDES, RESULT_NAMES, RESULT_STARTS_AT } from "./result-logs.mjs";
import { RAIN_LOGS, RAIN_SIDES, RAIN_NAMES, RAIN_STARTS_AT } from "./rain-logs.mjs";

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${typeof d === "string" ? d : JSON.stringify(d)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

/** The fold's result for a log, told everything match_result() reads. @param {import("./result-logs.mjs").ResultLog} x */
const told = (x) => deriveMatch(x.log, {
  startsAt: RESULT_STARTS_AT, conditions: x.play ?? undefined, status: x.status,
  sides: RESULT_SIDES, names: RESULT_NAMES, decision: x.decision,
}).result;

group("P. Every log folds to the result the design gives it");
for (const x of RESULT_LOGS) {
  const r = told(x);
  const got = r == null
    ? { outcome: "in_progress", marginKind: null, marginValue: null, winnerSide: null, decidedBy: null, text: null }
    : { outcome: r.outcome, marginKind: r.marginKind, marginValue: r.marginValue, winnerSide: r.winnerSide, decidedBy: r.decidedBy, text: r.text };
  ok(x.name, JSON.stringify(got) === JSON.stringify(x.expect), { got, expect: x.expect });
}
ok("the list has the design's logs: at least 25", RESULT_LOGS.length >= 25, RESULT_LOGS.length);

group("Q. The two misreadings, gone");
{
  const sealed = RESULT_LOGS.find((x) => x.name.startsWith("a chase sealed abandoned"));
  const r = deriveMatch(/** @type {any} */ (sealed).log, { startsAt: RESULT_STARTS_AT }).result;
  ok("a chase sealed abandoned is no result, told nothing else", r?.outcome === OUTCOME.NO_RESULT && r?.winner == null && r?.margin === "no result", r);
  const two = RESULT_LOGS.find((x) => x.name.startsWith("two innings a side: the second innings passing"));
  const asOne = deriveMatch(/** @type {any} */ (two).log, { startsAt: RESULT_STARTS_AT, status: "complete" }).result;
  const asTwo = told(/** @type {any} */ (two));
  ok("...a two-innings match's second innings passing the first is a win only to a fold told nothing of two innings",
     asOne?.outcome === OUTCOME.WIN && asTwo?.outcome === OUTCOME.DRAW, { asOne, asTwo });
}

group("R. A caller that tells it nothing");
{
  const won = RESULT_LOGS[0];
  const r = deriveMatch(won.log).result;
  ok("winner is the batting side's name, margin the words it always was", r?.winner === "Kearsney" && r?.margin === "9 wickets", r);
  ok("...a win, not a side: it was told no sides", r?.outcome === OUTCOME.WIN && r?.winnerSide === null);
  ok("...decided by play, and in words with the innings' name", r?.decidedBy === "play" && r?.text === "Kearsney won by 9 wickets", r?.text);
  const under = RESULT_LOGS.find((x) => x.name === "a chase under way");
  ok("an undecided match is null", deriveMatch(/** @type {any} */ (under).log).result === null);
  ok("describeResult() is exported and takes innings alone", describeResult([]) === null);
  const tie = RESULT_LOGS.find((x) => x.name.startsWith("a tie"));
  const t = deriveMatch(/** @type {any} */ (tie).log).result;
  ok("a tie: winner null, margin \"tie\"", t?.winner === null && t?.margin === "tie" && t?.text === "Match tied", t);
}

group("S. The words over SQL's row are the fold's");
{
  // match_result()'s columns for the override log, as db/69 returns them.
  const row = {
    outcome: "home_win", margin_kind: "awarded", margin: null, decided_by: "decision", winner_side: "home", winner_key: null,
    play_outcome: "away_win", play_winner_side: "away", play_winner_key: "Kearsney", play_margin_kind: "wickets", play_margin: 9,
    decision_applied: true,
    decision: { kind: "awarded", side: "home", overrides_play: true, reason: "protest upheld by the league committee" },
  };
  const r = resultFromRow(row);
  const nameOf = (/** @type {string | null} */ key, /** @type {string | null} */ side) =>
    key === RESULT_SIDES.away || side === "away" ? RESULT_NAMES.away : RESULT_NAMES.home;
  const fold = told(/** @type {any} */ (RESULT_LOGS.find((x) => x.name === "an award that overrides play")));
  ok("the override's words from SQL's row are the fold's", r != null && resultWords(r, { nameOf }) === fold?.text, resultWords(/** @type {any} */ (r), { nameOf }));
  ok("...and the public page's leave the organiser's reason out",
     r != null && resultWords(r, { nameOf, reasons: false }) === "Kearsney won by 9 wickets; awarded to Hilton 1XI by the organiser");
  ok("a margin from a row: 1 run, 2 wickets, an innings and 1 run",
     resultFromRow({ outcome: "home_win", margin_kind: "runs", margin: 1 })?.margin === "1 run"
     && resultFromRow({ outcome: "away_win", margin_kind: "wickets", margin: 2 })?.margin === "2 wickets"
     && resultFromRow({ outcome: "away_win", margin_kind: "innings", margin: 1 })?.margin === "an innings and 1 run");
  ok("a no result, a draw and an abandoned match in words",
     resultWords(/** @type {any} */ (resultFromRow({ outcome: "no_result" })), {}) === "No result"
     && resultWords(/** @type {any} */ (resultFromRow({ outcome: "draw" })), {}) === "Match drawn"
     && resultWords(/** @type {any} */ (resultFromRow({ outcome: "abandoned" })), {}) === "Match abandoned");
  ok("nothing in words while a match is under way", resultWords(/** @type {any} */ (resultFromRow({ outcome: "in_progress" })), {}) === null);
}

// ── RECOGNITION R3: the fixture class (db/127 fixture_class()'s twin) ──
//   T. the class: friendly with no competition (Q1), festival under a
//      festival, competitive under a league or a knockout; comp_type's list
//   U. the no-board reason over every result and rain log the fold gives,
//      in db/127's order; the same logs smoke-fold-figures holds SQL to
//   V. the same reasons read off match_result()'s row (resultFromRow())
group("T. The fixture class (RECOGNITION R3, Q1–Q3)");
{
  ok("comp_type's list is league, knockout, festival; no inter-house before V2 (Q2)",
     JSON.stringify(COMP_TYPES) === JSON.stringify(["league", "knockout", "festival"]) && Object.isFrozen(COMP_TYPES), COMP_TYPES);
  const won = { outcome: OUTCOME.HOME_WIN, playOutcome: OUTCOME.HOME_WIN, decisionApplied: false, revisedTarget: null };
  ok("no competition: a friendly (Q1)", fixtureClass({ competitionId: null, compType: null }, won).fixtureClass === FIXTURE_CLASS.FRIENDLY);
  ok("...and with nothing told at all", fixtureClass(null, null).fixtureClass === FIXTURE_CLASS.FRIENDLY);
  ok("...a competition's type is not read without the competition",
     fixtureClass({ competitionId: null, compType: COMP_TYPE.FESTIVAL }, won).fixtureClass === FIXTURE_CLASS.FRIENDLY);
  ok("a festival's fixture: festival (Q3)", fixtureClass({ competitionId: "c", compType: COMP_TYPE.FESTIVAL }, won).fixtureClass === FIXTURE_CLASS.FESTIVAL);
  ok("a league's fixture: competitive", fixtureClass({ competitionId: "c", compType: COMP_TYPE.LEAGUE }, won).fixtureClass === FIXTURE_CLASS.COMPETITIVE);
  ok("a knockout's fixture: competitive", fixtureClass({ competitionId: "c", compType: COMP_TYPE.KNOCKOUT }, won).fixtureClass === FIXTURE_CLASS.COMPETITIVE);
  ok("a won match has no reason", fixtureClass(null, won).noBoard === null);
  ok("class and reason are independent: an abandoned festival fixture",
     JSON.stringify(fixtureClass({ competitionId: "c", compType: "festival" }, { outcome: "abandoned", playOutcome: "abandoned", decisionApplied: false }))
       === JSON.stringify({ fixtureClass: "festival", noBoard: "abandoned" }));
}

group("U. Why a match stands on no board, as the fold gives the result (db/127's order)");
{
  /** @type {Record<string, string | null>} */
  const want = {
    "a chase won by wickets": null,
    "a tie, under no tie-break": null,
    "a chase sealed abandoned: no result, never a win by runs": NO_BOARD.NO_RESULT,
    "a chase never finished, the match complete": NO_BOARD.NO_RESULT,
    "a chase under way": null,
    "abandoned before a ball": NO_BOARD.ABANDONED,
    "abandoned in the chase, by the organiser": NO_BOARD.ABANDONED,
    "two innings a side: a draw": null,
    "conceded in the chase": NO_BOARD.DECIDED_OFF_FIELD,
    "a walkover, no ball bowled": NO_BOARD.DECIDED_OFF_FIELD,
    "an award that overrides play": NO_BOARD.DECIDED_OFF_FIELD,
    "an award on a tie names who goes through, and the tie stands": null,
    "a concession on a match play decided: play stands": null,
    "a super over won by wickets": null,
    "a super over sealed abandoned: incomplete, and the organiser's award decides": null,
  };
  for (const [name, reason] of Object.entries(want)) {
    const x = RESULT_LOGS.find((l) => l.name === name);
    ok(`the log "${name}" is still in result-logs.mjs`, x != null);
    if (!x) continue;
    const got = fixtureClass(null, told(x)).noBoard;
    ok(`${name}: ${reason ?? "no reason"}`, got === reason, got);
  }
  for (const x of RAIN_LOGS) {
    const r = deriveMatch(x.log, { startsAt: RAIN_STARTS_AT, conditions: x.play ?? undefined, status: x.status,
                                   sides: RAIN_SIDES, names: RAIN_NAMES }).result;
    const e = x.expect;
    const reason = e.outcome === OUTCOME.IN_PROGRESS ? null : e.outcome === OUTCOME.NO_RESULT ? NO_BOARD.NO_RESULT
      : /\((DLS|revised target)\)$/.test(e.text ?? "") ? NO_BOARD.ADJUSTED_TARGET : null;
    const got = fixtureClass(null, r).noBoard;
    ok(`rain: ${x.name}: ${reason ?? "no reason"}`, got === reason, got);
  }
  ok("an adjusted target that also has no result is no result: the first that holds",
     fixtureClass(null, { outcome: "no_result", playOutcome: "no_result", decisionApplied: false, revisedTarget: "dls_standard" }).noBoard === NO_BOARD.NO_RESULT);
  ok("a concession on an abandoned match is decided off the field",
     fixtureClass(null, { outcome: "home_win", playOutcome: "abandoned", decisionApplied: true }).noBoard === NO_BOARD.DECIDED_OFF_FIELD);
  ok("an award naming who goes through, play still under way: no reason yet",
     fixtureClass(null, { outcome: "in_progress", playOutcome: "in_progress", decisionApplied: true, revisedTarget: "umpires_revision" }).noBoard === null);
}

group("V. The same reasons off match_result()'s row (resultFromRow())");
{
  const row = (/** @type {any} */ o) => resultFromRow({ outcome: "home_win", play_outcome: "home_win", decision_applied: false, innings: [], ...o });
  ok("a win: none", fixtureClass(null, row({})).noBoard === null);
  ok("a chase's revised_target: adjusted target",
     fixtureClass(null, row({ innings: [{ innings: 0 }, { innings: 1, revised_target: "umpires_revision" }] })).noBoard === NO_BOARD.ADJUSTED_TARGET);
  ok("a walkover: decided off the field",
     fixtureClass(null, row({ outcome: "away_win", play_outcome: "in_progress", decision_applied: true })).noBoard === NO_BOARD.DECIDED_OFF_FIELD);
  ok("abandoned", fixtureClass(null, row({ outcome: "abandoned", play_outcome: "abandoned" })).noBoard === NO_BOARD.ABANDONED);
  ok("no result", fixtureClass(null, row({ outcome: "no_result", play_outcome: "no_result" })).noBoard === NO_BOARD.NO_RESULT);
  ok("in progress: none", fixtureClass(null, row({ outcome: "in_progress", play_outcome: "in_progress" })).noBoard === null);
}

console.log(`\n${"─".repeat(52)}\nRESULT SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
