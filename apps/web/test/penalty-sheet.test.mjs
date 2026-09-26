/**
 * The pad's penalty runs (SCRBRD-094 item 1: the screen) — the fold the pad
 * reads, and the questions its sheet asks before it offers anything.
 *
 * What is checked:
 *
 *   - THE FOLD MOVED AND NOTHING ELSE DID. The pad folds its per-innings log
 *     with deriveInningsList() (foldPad) instead of deriveInnings() per
 *     innings. Over generated two-innings logs with no award to a fielding
 *     side, every innings is the same object, field for field, and so is every
 *     projection. With one, the innings that opens on the award seals (it was
 *     refused as figures_moved) and the chase's target rises with an award
 *     made during it.
 *   - The sheet offers an award only the Laws would take: each side's
 *     reasons are that side's (PENALTY_REASON_SIDE), short running is its own
 *     action, and a refusal has words — none of them with a Law clause number
 *     (Kameel is checking the numbers against the current Code).
 *   - Pending credits are said in words ("… start their innings on 5").
 *   - The sheet as drawn: its controls, the Award button disabled with a
 *     reason, the 12px type floor and 44px touch floor, no Law numbers.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/penalty-sheet.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deriveInnings, inningsStart, batters, bowler, ball, penalty, sealInnings, lawsRefusal,
  PENALTY_REASON, PENALTY_REASON_SIDE, REFUSAL, BALL_TYPE, KIND,
} from "@scrbrd/scoring";
import {
  foldPad, projectPad, withoutLaw, reasonWords, reasonsFor, awardRefusal, awardEvent, shortRunEvents,
  shortRunRefusal, refusalWords, pendingCredits, whereTheRunsGo,
} from "../src/scorer/penalty.js";
import { PenaltySheet } from "../src/scorer/penaltySheet.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 200)}` : ""); } };
const group = (t) => console.log("\n" + t);

const SQ_A = ["a1", "a2", "a3", "a4", "a5"].map((id) => ({ id, name: `Hilton ${id}` }));
const SQ_B = ["b1", "b2", "b3", "b4", "b5"].map((id) => ({ id, name: `Mhouse ${id}` }));
const open0 = (x = {}) => inningsStart({ innings: 0, battingTeam: "Hilton", bowlingTeam: "Michaelhouse", teamKey: "HIL", bowlingTeamKey: "MIC",
  squad: SQ_A, bowlingSquad: SQ_B, overs: 2, ...x });
const open1 = (x = {}) => inningsStart({ innings: 1, battingTeam: "Michaelhouse", bowlingTeam: "Hilton", teamKey: "MIC", bowlingTeamKey: "HIL",
  squad: SQ_B, bowlingSquad: SQ_A, overs: 2, ...x });
const runs = (n, i = 0) => ball({ innings: i, type: BALL_TYPE.RUN, value: n });
const start0 = () => [open0(), batters({ innings: 0, striker: "a1", nonStriker: "a2" }), bowler({ innings: 0, bowler: "b1" })];
const start1 = (x) => [open1(x), batters({ innings: 1, striker: "b1", nonStriker: "b2" }), bowler({ innings: 1, bowler: "a1" })];

// A deterministic generator: two innings of balls, wickets, extras, overs
// changed, a revision, and penalty runs to the BATTING side only.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function genLog(seed) {
  const r = rng(seed);
  const log = [[...start0()], []];
  const inningsOf = (i) => {
    const bowlers = i === 0 ? ["b1", "b2"] : ["a1", "a2"];
    const next = i === 0 ? ["a3", "a4", "a5"] : ["b3", "b4", "b5"];
    for (let k = 0; k < 40; k++) {
      const inn = deriveInnings(log[i]);
      if (inn.complete) break;
      if (inn.bowler == null) { log[i].push(bowler({ innings: i, bowler: bowlers[Math.floor(inn.balls / 6) % 2] })); continue; }
      if (inn.striker == null || inn.nonStriker == null) {
        const n = next.shift(); if (!n) break;
        log[i].push(batters({ innings: i, ...(inn.striker == null ? { striker: n } : { nonStriker: n }) })); continue;
      }
      const x = r();
      if (x < 0.08) log[i].push(ball({ innings: i, type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }));
      else if (x < 0.14) log[i].push(ball({ innings: i, type: BALL_TYPE.WIDE, value: 0 }));
      else if (x < 0.18) log[i].push(ball({ innings: i, type: BALL_TYPE.NO_BALL, value: Math.floor(r() * 3) }));
      else if (x < 0.21) log[i].push(penalty({ innings: i, runs: 5, toBattingTeam: true, reason: PENALTY_REASON.HELMET_STRUCK }));
      else log[i].push(runs([0, 1, 1, 2, 4, 6][Math.floor(r() * 6)], i));
    }
  };
  inningsOf(0);
  const first = deriveInnings(log[0]);
  if (first.complete) log[0].push(sealInnings(first));
  log[1].push(...start1({ target: first.runs + 1 }));
  inningsOf(1);
  return log;
}

// ── The fold ─────────────────────────────────────────────
group("The pad's fold: with no award to a fielding side, nothing moved");
{
  let same = 0, projSame = 0, checked = 0, withBoth = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const log = genLog(seed);
    const before = log.map((evs) => (evs.length ? deriveInnings(evs) : null));
    const after = foldPad(log);
    if (JSON.stringify(before) === JSON.stringify(after)) same++;
    // A projection: every prefix of the second innings, one ball more.
    const i = 1, n = log[i].length;
    const cut = [log[0], log[i].slice(0, Math.floor(n / 2))];
    const extra = runs(1, 1);
    if (JSON.stringify(deriveInnings([...cut[1], extra])) === JSON.stringify(projectPad(cut, 1, [extra]))) projSame++;
    if (after[0]?.sealed && after[1]) withBoth++;
    checked++;
  }
  ok(`every innings of ${checked} generated two-innings logs is the same object (${same})`, same === checked);
  ok(`...and so is every projection (${projSame})`, projSame === checked);
  ok(`...and the generator reached sealed first innings and a chase (${withBoth})`, withBoth > 100, withBoth);
}

group("With five to the fielding side in the first innings, the chase opens on them");
{
  const log = [[...start0(), runs(4), penalty({ innings: 0, runs: 5, toBattingTeam: false, reason: PENALTY_REASON.PITCH_DAMAGE })], []];
  let inn = foldPad(log);
  ok("the first innings' total is its own (4), not the award's", inn[0].runs === 4, inn[0].runs);
  const pend = pendingCredits(inn);
  ok("before the second innings starts, the credit is pending, in words",
     pend.length === 1 && pend[0].words === "Michaelhouse start their innings on 5", JSON.stringify(pend));
  ok("...and where-the-runs-go said the same before it was awarded",
     whereTheRunsGo(foldPad([start0(), []]), 0, false) === "Michaelhouse start their innings on 5.");
  log[1] = [...start1({ target: inn[0].runs + 1 })];
  inn = foldPad(log);
  ok("once it starts, the second innings opens on 5", inn[1].runs === 5 && inn[1].extras.penalty === 5 && inn[1].penaltyCarried === 5, JSON.stringify(inn[1].extras));
  ok("...and nothing is pending", pendingCredits(inn).length === 0);
  ok("deriveInnings alone cannot see it (the old pad's fold)", deriveInnings(log[1]).runs === 0);
  // Reach the target of 5 with the carried five and one run: 6 > 5. A single
  // is enough, and the projection (what decides the innings review) sees it.
  const after = projectPad(log, 1, [runs(1, 1)]);
  ok("the projection reaches the target with the carried runs in (6 of 5)", after.complete && after.endReason === "target_reached", `${after.runs} ${after.endReason}`);
  const oldProj = deriveInnings([...log[1], runs(1, 1)]);
  ok("...where one innings' fold said the chase went on", !oldProj.complete, oldProj.runs);
  // The seal the pad writes: from its own fold it is accepted; from one
  // innings' fold (no credit) the whole match's fold refuses it.
  log[1].push(runs(1, 1));
  const sealNew = sealInnings(foldPad(log)[1]);
  const sealOld = sealInnings(deriveInnings(log[1]));
  const withNew = foldPad([log[0], [...log[1], sealNew]])[1];
  const withOld = foldPad([log[0], [...log[1], sealOld]])[1];
  ok("a seal stamped from the pad's fold is accepted", withNew.sealed === true, withNew.sealRefused);
  ok("...one stamped from deriveInnings is refused as figures_moved", withOld.sealed === false && withOld.sealRefused === "figures_moved", withOld.sealRefused);
}

group("With five to the fielding side mid-chase, their total and the target rise");
{
  const log = [[...start0(), runs(6), runs(4)], []];
  log[0].push(...[runs(0), runs(0), runs(0), runs(0), bowler({ innings: 0, bowler: "b2" }), ...Array(6).fill(0).map(() => runs(0))]);
  const first = foldPad(log)[0];
  ok("the first innings is complete on 10", first.complete && first.runs === 10, `${first.runs} ${first.complete}`);
  log[0].push(sealInnings(first));
  log[1] = [...start1({ target: first.runs + 1 }), runs(2, 1)];
  ok("the chase starts with a target of 11", foldPad(log)[1].target === 11);
  ok("where-the-runs-go says the target rises", whereTheRunsGo(foldPad(log), 1, false) === "Added to Hilton's total. The target rises by 5.");
  log[1].push(awardEvent(1, { toBattingTeam: false, reason: PENALTY_REASON.TIME_WASTING }));
  const inn = foldPad(log);
  ok("the target rises to 16", inn[1].target === 16, inn[1].target);
  ok("...and the side that set it has 15", inn[0].runs === 15 && inn[0].sealed === true, `${inn[0].runs} ${inn[0].sealed}`);
  ok("...while the chase's own total does not move", inn[1].runs === 2);
}

// ── The questions ────────────────────────────────────────
group("Each side is offered only its own reasons, in words, with no Law numbers");
{
  const bat = reasonsFor(true), field = reasonsFor(false);
  ok("the batting side's reasons are the batting side's (or either side's)", bat.every((r) => PENALTY_REASON_SIDE[r] === true || PENALTY_REASON_SIDE[r] == null), bat);
  ok("the fielding side's reasons are the fielding side's (or either side's)", field.every((r) => PENALTY_REASON_SIDE[r] === false || PENALTY_REASON_SIDE[r] == null), field);
  ok("short running is not among them: it is its own action", !field.includes(PENALTY_REASON.SHORT_RUNNING) && !bat.includes(PENALTY_REASON.SHORT_RUNNING));
  const offered = new Set([...bat, ...field, PENALTY_REASON.SHORT_RUNNING]);
  ok("every reason on the list is offered somewhere", Object.values(PENALTY_REASON).every((r) => offered.has(r)));
  const words = Object.values(PENALTY_REASON).map(reasonWords);
  ok("every reason has words", words.every((w) => w && w.length > 3), words);
  ok("...with no Law and no clause number in any of them", words.every((w) => !/\bLaws?\b|\d/.test(w)), words.filter((w) => /\bLaws?\b|\d/.test(w)));
  ok("withoutLaw takes the bracket off", withoutLaw("deliberate short running (Law 41.5)") === "deliberate short running");
}

group("The Laws are asked before an award is offered, and their answer has words");
{
  const log = [[...start0(), runs(1)], []];
  const m = { innings: foldPad(log), events: log };
  ok("a reason the side can be awarded is taken", awardRefusal(m, 0, { toBattingTeam: true, reason: PENALTY_REASON.HELMET_STRUCK }) === null);
  ok("...and to the fielding side too", awardRefusal(m, 0, { toBattingTeam: false, reason: PENALTY_REASON.PITCH_DAMAGE }) === null);
  ok("a reason for the wrong side is refused (penalty_reason_side)",
     awardRefusal(m, 0, { toBattingTeam: true, reason: PENALTY_REASON.PITCH_DAMAGE }) === REFUSAL.PENALTY_REASON_SIDE);
  ok("short running as a bare award, after a run, is refused (short_run_unmatched)",
     awardRefusal(m, 0, { toBattingTeam: false, reason: PENALTY_REASON.SHORT_RUNNING }) === REFUSAL.SHORT_RUN_UNMATCHED);
  const none = { innings: foldPad([[], []]), events: [[], []] };
  ok("an innings nobody opened refuses any award (no_innings)", awardRefusal(none, 0, { toBattingTeam: true, reason: PENALTY_REASON.OTHER }) === REFUSAL.NO_INNINGS);
  const codes = [REFUSAL.MATCH_DECIDED, REFUSAL.PENALTY_REASON_SIDE, REFUSAL.PENALTY_REASON_UNKNOWN, REFUSAL.PENALTY_RUNS_INVALID,
    REFUSAL.SHORT_RUN_UNMATCHED, REFUSAL.NO_INNINGS, REFUSAL.NEXT_BOWLER, REFUSAL.OPENERS, REFUSAL.INNINGS_OVER, REFUSAL.MID_OVER_NO_REASON];
  const said = codes.map(refusalWords);
  ok("every refusal the sheet can meet has words", said.every((w) => typeof w === "string" && w.length > 10), said);
  ok("...none with a Law or a clause number", said.every((w) => !/\bLaws?\b|\d/.test(w)), said.filter((w) => /\bLaws?\b|\d/.test(w)));
  ok("no refusal, no words", refusalWords(null) === null);
}

group("Short running: the delivery with no runs, then five to the fielding side");
{
  const log = [[...start0(), runs(1)], []];
  const m = { innings: foldPad(log), events: log };
  const pair = shortRunEvents(0, { type: "run", value: 3, striker: "a2", nonStriker: "a1", bowler: "b1" });
  ok("two events, the ball first, every run disallowed", pair.length === 2 && pair[0].kind === KIND.BALL && pair[0].value === 0 && pair[1].kind === KIND.PENALTY);
  ok("...the award to the fielding side, for short running", pair[1].toBattingTeam === false && pair[1].reason === PENALTY_REASON.SHORT_RUNNING && pair[1].runs === 5);
  ok("the Laws take it on a ready pad", shortRunRefusal(m, 0, { type: "run" }) === null);
  ok("...and the pair, appended, is taken event by event", (() => {
    const e1 = [[...log[0], pair[0]], []];
    return lawsRefusal({ innings: foldPad(e1), events: e1 }, pair[1]) === null;
  })());
  const noBowler = [[open0(), batters({ innings: 0, striker: "a1", nonStriker: "a2" })], []];
  const nb = shortRunRefusal({ innings: foldPad(noBowler), events: noBowler }, 0, { type: "run" });
  ok(`a pad with nobody bowling refuses the delivery first (${nb})`, nb === REFUSAL.OPENING_BOWLER);
  const after = projectPad(log, 0, pair);
  ok("the projection: a ball faced, no runs, the batters where they were", after.balls === 2 && after.runs === 1 && after.striker === m.innings[0].striker && after.penaltyToFielding === 5, `${after.balls} ${after.runs}`);
}

// ── The sheet as drawn ───────────────────────────────────
group("The sheet: sides first, Award disabled with its reason, floors, no Law numbers");
{
  const log = [[...start0(), runs(1)], []];
  const inn = foldPad(log);
  const props = { innings: inn, events: log, curIn: 0, crease: { striker: "a1", nonStriker: "a2", bowler: "b1" },
    names: { striker: "Hilton a1", nonStriker: "Hilton a2", bowler: "Mhouse b1" }, onAward() {}, onShortRun() {}, onClose() {} };
  const award = renderToStaticMarkup(h(PenaltySheet, props));
  ok("it offers both sides, by name", /data-testid="penalty-side-batting"/.test(award) && /data-testid="penalty-side-fielding"/.test(award) && /Hilton/.test(award) && /Michaelhouse/.test(award));
  ok("...and no reason until a side is chosen", !/penalty-reason-/.test(award));
  ok("the Award button is there, disabled, with what is missing said", /data-testid="penalty-award"[^>]*disabled=""/.test(award) || /disabled=""[^>]*data-testid="penalty-award"/.test(award), award.match(/<button[^>]*penalty-award[^>]*>/)?.[0]);
  ok("...the hint in words", /Choose who gets the five runs/.test(award));
  ok("the umpires' report is one line, and out of scope", /The umpires report the offence to the offending side/.test(award));
  const short = renderToStaticMarkup(h(PenaltySheet, { ...props, mode: "shortRun" }));
  ok("the short run says what happens, in words", /The delivery counts, with no runs/.test(short) && /Five penalty runs go to Michaelhouse/.test(short));
  ok("...asks the delivery, and names the crease", /short-run-type-run/.test(short) && /short-run-type-Nb/.test(short) && /short-run-type-Wd/.test(short) && /Faced by Hilton a1/.test(short));
  ok("...and its confirm is enabled on a ready pad", /<button[^>]*data-testid="short-run-confirm"(?![^>]*disabled)[^>]*>/.test(short));
  const blocked = renderToStaticMarkup(h(PenaltySheet, { ...props, mode: "shortRun",
    innings: foldPad([[open0(), batters({ innings: 0, striker: "a1", nonStriker: "a2" })], []]),
    events: [[open0(), batters({ innings: 0, striker: "a1", nonStriker: "a2" })], []] }));
  ok("with nobody bowling, the confirm is disabled and the refusal is said", /<button[^>]*data-testid="short-run-confirm"[^>]*disabled/.test(blocked) && /data-testid="penalty-refusal"/.test(blocked) && /The opening bowler has not been chosen/.test(blocked));
  const pend = renderToStaticMarkup(h(PenaltySheet, { ...props,
    innings: foldPad([[...log[0], penalty({ innings: 0, runs: 5, toBattingTeam: false, reason: PENALTY_REASON.PITCH_DAMAGE })], []]),
    events: [[...log[0], penalty({ innings: 0, runs: 5, toBattingTeam: false, reason: PENALTY_REASON.PITCH_DAMAGE })], []] }));
  ok("a pending credit is on the sheet, in words", /data-testid="penalty-pending"/.test(pend) && /Michaelhouse start their innings on 5/.test(pend));
  for (const [name, out] of [["award", award], ["short run", short], ["pending", pend]]) {
    ok(`${name}: no Law clause numbers`, !/\bLaws? \d/.test(out) && !/\(Law/.test(out));
    const sizes = [...out.matchAll(/font-size:\s*([\d.]+)px/g)].map((x) => Number(x[1]));
    ok(`${name}: nothing under 12px (${Math.min(...sizes)}px)`, sizes.length > 0 && sizes.every((s) => s >= 12), sizes);
    const btns = [...out.matchAll(/<button[^>]*>/g)].map((x) => x[0]).filter((b) => !/aria-label="Close/.test(b));
    const tall = btns.map((b) => Number(b.match(/min-height:\s*(\d+)px/)?.[1] ?? 0));
    ok(`${name}: every control is 44px or taller (${Math.min(...tall)}px)`, btns.length > 0 && tall.every((x) => x >= 44), btns.filter((_, i) => tall[i] < 44));
  }
}

console.log("\n" + "─".repeat(52));
console.log(`PENALTY SHEET: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
