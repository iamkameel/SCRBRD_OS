/**
 * The pad's half of the Laws audit of 28 Oct 2026: what the wicket sheet
 * asks (wicketAsks.js), the free-hit note on the no-ball panel, the
 * "Runs, not a boundary" delivery, and a Two-Day's four innings
 * (twoInnings.js). The engine's half is packages/scoring/test/laws-audit.test.mjs.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/wicket-asks.test.mjs
 */
import { deriveInnings, deriveMatch, inningsStart, batters, bowler, ball, inningsEnd, BALL_TYPE } from "@scrbrd/scoring";
import { wicketAsks, wicketDetail } from "../src/scorer/wicketAsks.js";
import { nbFreeHit } from "../src/scorer/extras.js";
import { deliveryOf, deliveryEvents } from "../src/scorer/delivery.js";
import { nextInningsPlan, inningsDecided, twoInningsMatch, firstInningsLead } from "../src/scorer/twoInnings.js";
import { chaseOf, matchChaseOf, twoInningsPlayed } from "../src/lib/superOver.js";
import { breakPanel } from "../src/display/data.js";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };

// ── F1 · the end, on every run out ──
{
  const ro0 = wicketAsks({ mode: "run_out", offExtra: false, runs: 0 });
  ok("F1 a run out with no run completed asks the end (it did not)", ro0.end === true);
  ok("F1 ...and with runs, as before", wicketAsks({ mode: "run_out", offExtra: false, runs: 2 }).end === true);
  ok("F1 ...off a wide or a no-ball too", wicketAsks({ mode: "run_out", offExtra: true, runs: 0 }).end === true);
  ok("F1 a catch asks no end", wicketAsks({ mode: "caught", offExtra: false }).end === false);
  const d = wicketDetail(ro0, { who: "p1", strikerId: "p1", runs: 0, end: "bowler_end" });
  ok("F1 the striker run out at the bowler's end with no run: outAt is on the event", d.outAt === "bowler_end" && d.runs === 0 && d.dismissed === null);
  const inn = deriveInnings([inningsStart({ battingTeam: "H", bowlingTeam: "K", squad: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }, { id: "p3", name: "C" }] }),
    batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }),
    ball({ type: BALL_TYPE.WICKET, value: d.runs, dismissal: "run_out", outAt: d.outAt })]);
  ok("F1 ...so B, who reached the striker's end, faces next", inn.striker === "p2" && inn.nonStriker === null);
}

// ── F5 / F9 · whose the runs were ──
{
  const a = wicketAsks({ mode: "run_out", offExtra: false, runs: 1 });
  ok("F5 a run out with a run completed asks whose", a.whose === true);
  ok("F5 ...not with none", wicketAsks({ mode: "run_out", offExtra: false, runs: 0 }).whose === false);
  ok("F5 ...the detail carries nbRuns", wicketDetail(a, { runs: 1, from: "byes", end: "striker_end" }).nbRuns === "byes");
  ok("F5 ...off the bat writes none", wicketDetail(a, { runs: 1, from: null, end: "striker_end" }).nbRuns === null);
  ok("F5 off a no-ball the extra asked it: not again", wicketAsks({ mode: "run_out", offExtra: true, runs: 1 }).whose === false);
  const fh = wicketAsks({ mode: "bowled", offExtra: false, freeHit: true, runs: 1 });
  ok("F9 bowled on a free hit asks the runs completed and whose", fh.savedOnFreeHit && fh.runs && fh.whose);
  ok("F9 ...not off a fair ball", !wicketAsks({ mode: "bowled", offExtra: false, freeHit: false }).runs);
  ok("F9 ...a run out on a free hit stands, and asks as a run out", !wicketAsks({ mode: "run_out", offExtra: false, freeHit: true }).savedOnFreeHit);
  ok("F9 the detail: one bye", JSON.stringify(wicketDetail(fh, { runs: 1, from: "byes" })) === JSON.stringify({ dismissed: null, runs: 1, nbRuns: "byes", outAt: null, facesNext: null }));
}

// ── F8 · obstructing the field: who, and the runs ──
{
  const o = wicketAsks({ mode: "obstructing_field", offExtra: false, runs: 1 });
  ok("F8 an obstruction off a fair ball asks who (it was the striker's)", o.who === true);
  ok("F8 ...and the runs completed (it sent 0)", o.runs === true && wicketDetail(o, { who: "p2", strikerId: "p1", runs: 1 }).runs === 1);
  ok("F8 ...the non-striker can be the one out", wicketDetail(o, { who: "p2", strikerId: "p1", runs: 1 }).dismissed === "p2");
  ok("F8 an obstruction that stopped a catch: no runs (Law 37.5.2)", wicketAsks({ mode: "obstructing_field", offExtra: false, stopped: true }).runs === false);
  ok("F8 the rest are as they were: a catch asks nothing", JSON.stringify(wicketAsks({ mode: "caught", offExtra: false })) === JSON.stringify({ who: false, runs: false, whose: false, end: false, savedOnFreeHit: false }));
}

// ── Q2 / F12 · the free-hit note ──
ok("F12 the no-ball panel's free hit: front foot (it was height and beamer)", nbFreeHit("front_foot") === true);
ok("F12 ...not a waist-high full toss, not a beamer", nbFreeHit("height") === false && nbFreeHit("beamer") === false);

// ── F7 · runs, not a boundary ──
{
  const d = deliveryOf({ type: "run", value: 4, notBoundary: true });
  ok("F7 the pad's 'Runs, not a boundary' carries boundary: false", d.boundary === false);
  ok("F7 ...every other delivery is the event it always was", !("boundary" in deliveryOf({ type: "run", value: 4 })) && !("boundary" in deliveryOf({ type: "B", value: 4, notBoundary: true })));
  const [ev] = deliveryEvents({ curIn: 0, before: null, freeHit: false, type: "run", value: 6, notBoundary: true });
  ok("F7 ...and through ball(): six runs, boundary false", ev.value === 6 && ev.boundary === false);
}

// ── F2 · a Two-Day's four innings ──
{
  const SA = [{ id: "a1", name: "A1" }, { id: "a2", name: "A2" }, { id: "a3", name: "A3" }];
  const SB = [{ id: "b1", name: "B1" }, { id: "b2", name: "B2" }, { id: "b3", name: "B3" }];
  const C = { conditions: { "format.innings_per_side": 2 } };
  ok("F2 the conditions say it", twoInningsMatch(C.conditions) && !twoInningsMatch({}) && !twoInningsMatch(null));
  const start = (i, bat, bowl, squad, bsq, more = {}) => ({ ...inningsStart({ battingTeam: bat, bowlingTeam: bowl, teamKey: bat, bowlingTeamKey: bowl, squad, bowlingSquad: bsq, overs: 80, ...more }), innings: i });
  const W = (i) => ({ ...ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }), innings: i });
  const R = (i, v) => ({ ...ball({ type: BALL_TYPE.RUN, value: v }), innings: i });
  const allOut = (i, sq, runs) => [{ ...batters({ striker: sq[0].id, nonStriker: sq[1].id }), innings: i }, { ...bowler({ bowler: "x" }), innings: i },
    R(i, runs), W(i), { ...batters({ striker: sq[2].id }), innings: i }, W(i)];
  const log = [start(0, "Hilton", "Kearsney", SA, SB), ...allOut(0, SA, 10)];
  let m = deriveMatch(log, C);
  const p1 = nextInningsPlan(m.innings, 1);
  ok("F2 the second innings: Kearsney bat, the squads swapped, no target", p1.battingTeam === "Kearsney" && p1.squad === SB && p1.target === null);
  log.push(start(1, p1.battingTeam, p1.bowlingTeam, p1.squad, p1.bowlingSquad), ...allOut(1, SB, 4));
  m = deriveMatch(log, C);
  ok("F2 the first-innings lead is Hilton's 6", firstInningsLead(m.innings) === 6);
  const p2 = nextInningsPlan(m.innings, 2), fo = nextInningsPlan(m.innings, 2, { followOn: true });
  ok("F2 the third: Hilton bat again, or Kearsney follow on", p2.battingTeam === "Hilton" && fo.battingTeam === "Kearsney" && fo.squad === SB);
  log.push(start(2, p2.battingTeam, p2.bowlingTeam, p2.squad, p2.bowlingSquad), ...allOut(2, SA, 3));
  m = deriveMatch(log, C);
  ok("F2 not an innings win: a fourth innings follows", inningsDecided(m.innings) === false);
  const p3 = nextInningsPlan(m.innings, 3);
  ok("F2 the fourth: Kearsney chase 10 (13 against 4, plus one)", p3.battingTeam === "Kearsney" && p3.target === 10);
  // Followed on and still behind, all out: an innings win.
  const fol = [...log.slice(0, log.findIndex((e) => e.innings === 2)), start(2, fo.battingTeam, fo.bowlingTeam, fo.squad, fo.bowlingSquad), ...allOut(2, SB, 1)];
  ok("F2 followed on, all out still behind: an innings win, no fourth", inningsDecided(deriveMatch(fol, C).innings) === true);
  const dec = deriveMatch([...log.slice(0, log.findIndex((e) => e.innings === 2)), start(2, "Hilton", "Kearsney", SA, SB),
    { ...batters({ striker: "a1", nonStriker: "a2" }), innings: 2 }, { ...bowler({ bowler: "x" }), innings: 2 }, R(2, 2),
    { ...inningsEnd({ reason: "declared", confirmed: { runs: 2, wickets: 0, balls: 1 } }), innings: 2 }], C);
  ok("F2 a declaration in the third: a fourth innings follows", dec.innings[2].complete && inningsDecided(dec.innings) === false);

  // ── S1 · only the fourth innings is a chase (chaseOf(), every screen's) ──
  const two = deriveMatch(log.filter((e) => e.innings <= 1), C).innings;
  ok("S1 a Two-Day's second innings chases nothing (the conditions say two a side)", chaseOf(two, 1) === null && matchChaseOf(two, 1) === null);
  ok("S1 ...and its break after the first innings says no target", twoInningsPlayed(two.slice(0, 1))
     && breakPanel({ homeTeam: "Hilton", opponent: "Kearsney" }, two.slice(0, 1)).words.endsWith("to bat"));
  const four = [...log, start(3, p3.battingTeam, p3.bowlingTeam, p3.squad, p3.bowlingSquad, { target: p3.target }),
    { ...batters({ striker: "b1", nonStriker: "b2" }), innings: 3 }, { ...bowler({ bowler: "x" }), innings: 3 }, R(3, 1)];
  const all = deriveMatch(four, C).innings;
  ok("S1 the third chases nothing, the fourth chases 10", chaseOf(all, 2) === null && chaseOf(all, 3)?.target === 10 && chaseOf(all, 3)?.of === 2);
  // The innings_start's target dropped: the fourth's is still the runs behind, plus one.
  const bare = deriveMatch(four.map((e) => (e.innings === 3 && e.kind === "innings_start" ? { ...e, target: undefined } : e)), C).innings;
  ok("S1 ...worked out when the innings_start carries none", chaseOf(bare, 3)?.target === 10);
  const noDoc = deriveMatch(four, {}).innings;
  ok("S1 folded without its conditions, a third innings still says two a side", chaseOf(noDoc, 1) === null && chaseOf(noDoc, 3)?.target === 10);
  const one = deriveMatch([start(0, "Hilton", "Kearsney", SA, SB), ...allOut(0, SA, 10), start(1, "Kearsney", "Hilton", SB, SA)], {}).innings;
  ok("S1 one innings a side: the second is the chase, as before", chaseOf(one, 1)?.target === 11 && matchChaseOf(one, 1)?.target === 11
     && breakPanel({ homeTeam: "Hilton", opponent: "Kearsney" }, one.slice(0, 1)).words.includes("need 11 to win"));
}

console.log(`\nwicket-asks: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
