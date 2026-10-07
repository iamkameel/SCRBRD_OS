/**
 * GA-I05. The scorer's charts agree with the fold.
 *
 * The worm, runs per over and the run-rate chart each did their own sums over
 * the ball log, and none of them was the fold's: the worm dropped every wide
 * and no-ball, the bars added bare `value` (no wide's or no-ball's own run),
 * penalty runs were nowhere, and after a final over the required rate divided
 * by the balls left, nought, and drew NaN.
 *
 * Every innings here is built with the real event builders and folded by the
 * real replay (deriveInnings / deriveInningsList), and the charts are
 * rendered, not their arithmetic copied: the figures are read back off the
 * SVG through the chart's own axis labels. So the expected numbers are the
 * fold's, and the measured ones are what a scorer sees.
 *
 * Sections A–E fail on the charts before GA-I05 (each for the reason it
 * names) and pass after; F is the projection the charts now share
 * (scorer/chartData.js), held to the fold over generated innings.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/charts.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deriveInnings, deriveInningsList, inningsStart, batters, bowler, ball, penalty, retire, revision, voidEvent,
  BALL_TYPE, DISMISSAL, NOT_IN_OVER, notInOverDelivery,
} from "@scrbrd/scoring";
import { WormChart, ManhattanChart, RunRateChart, AnalysisDashboard } from "../src/scorer/charts.jsx";
import { projectInnings, projectMatch, runRates, deliveryRuns } from "../src/scorer/chartData.js";

let pass = 0, fail = 0;
const ok = (name, c, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${name}${c || d === "" ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`);
  if (c) pass++; else fail++;
};

// React warns on stderr for a NaN attribute; count those as failures too.
const warned = [];
const realError = console.error;
console.error = (...a) => { warned.push(a.map(String).join(" ")); };

// ── Building innings with the real builders ─────────────────────────────

const SQUAD = Array.from({ length: 11 }, (_, i) => ({ id: `p${i + 1}`, name: `Batter ${i + 1}` }));
const OPP = [{ id: "x", name: "X Bowler" }, { id: "y", name: "Y Bowler" }];
let ts = 1_790_000_000_000;
const at = () => ({ clientTs: ts++ });
let ids = 0;
const id = () => ({ id: `e${++ids}` });

/** innings i: the start, the openers, the first bowler. */
function open(i, { overs = 2, target = null, teamKey = i % 2 ? "B" : "A" } = {}) {
  const other = teamKey === "A" ? "B" : "A";
  return [
    inningsStart({ innings: i, ...at(), battingTeam: teamKey, bowlingTeam: other, teamKey, bowlingTeamKey: other,
      squad: SQUAD, bowlingSquad: OPP, overs, ...(target != null ? { target } : {}) }),
    batters({ innings: i, ...at(), striker: "p1", nonStriker: "p2" }),
    bowler({ innings: i, ...at(), bowler: "x" }),
  ];
}
const b = (i, type, value = 0, more = {}) => ball({ innings: i, ...at(), ...id(), type, value, ...more });
const dot = (i) => b(i, BALL_TYPE.RUN, 0);
const run = (i, v) => b(i, BALL_TYPE.RUN, v);
const next = (i, who) => bowler({ innings: i, ...at(), bowler: who });

// ── Reading the rendered charts ─────────────────────────────────────────

const render = (C, props) => renderToStaticMarkup(h(C, props));
/** @param {string} d */
const coords = (d) => d.split(/[ML]/).map((s) => s.trim()).filter(Boolean).map((s) => s.split(",").map(Number));

/** The worm's lines, as (balls, runs) read through its own axes. */
function wormOf(markup) {
  const ticks = [...markup.matchAll(/<text x="-6" y="([-\d.]+)"[^>]*>(\d+)<\/text>/g)].map((m) => ({ y: Number(m[1]) - 4, v: Number(m[2]) }));
  const lo = ticks.find((t) => t.v === 0);
  const hi = ticks.reduce((a, t) => (t.v > a.v ? t : a), ticks[0]);
  const runsAt = (y) => Math.round(((lo.y - y) / (lo.y - hi.y)) * hi.v);   // runs are whole; the path is drawn to 0.1px
  const lines = [...markup.matchAll(/<path d="([^"]+)" fill="none"/g)].map((m) => coords(m[1]));
  const xs = lines.flat().map((p) => p[0]).filter((x) => x > 0);
  const unit = xs.length ? Math.min(...xs) : 1;
  const ballsAt = (x) => Math.round((x / unit) * 100) / 100;
  const pts = lines.map((l) => l.map(([x, y]) => ({ ball: ballsAt(x), runs: runsAt(y), x })));
  const marks = [...markup.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="4.5"/g)]
    .map((m) => ({ ball: ballsAt(Number(m[1])), runs: runsAt(Number(m[2])) }));
  return { lines: pts, marks, unit };
}

/** Runs per over, as the bars' heights read through the chart's own axis. */
function barsOf(markup) {
  const ticks = [...markup.matchAll(/<text x="-5" y="([-\d.]+)"[^>]*>(\d+)<\/text>/g)].map((m) => ({ y: Number(m[1]) - 4, v: Number(m[2]) }));
  if (!ticks.length) return [];
  const lo = ticks.find((t) => t.v === 0);
  const hi = ticks.reduce((a, t) => (t.v > a.v ? t : a), ticks[0]);
  return [...markup.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)]
    .map((m) => ({ x: Number(m[1]), runs: Math.round(((lo.y - Number(m[2])) / (lo.y - hi.y)) * hi.v * 100) / 100 }))
    .sort((p, q) => p.x - q.x).map((p) => p.runs);
}

/** The run rate chart's required-rate line, its points. */
const requiredLine = (markup) => {
  const m = /<path d="([^"]*)" fill="none" stroke="[^"]+" stroke-width="1.5" stroke-dasharray/.exec(markup);
  return m ? coords(m[1]) : [];
};
const endOf = (markup) => (/data-testid="rr-end"[^>]*>([^<]*)</.exec(markup) || [])[1] ?? null;
const clean = (markup) => !/NaN|Infinity/.test(markup);

/** The fold's runs at the end of each over: the log folded up to the next over's first delivery. */
function foldByOver(events) {
  const cums = [];
  const prefix = [];
  for (const ev of events) {
    if (ev.kind === "ball") {
      const f = deriveInnings(prefix);
      while (cums.length < Math.floor(f.balls / 6)) cums.push(f.runs);
    }
    prefix.push(ev);
  }
  const f = deriveInnings(prefix);
  if (f.balls % 6 || cums.length < f.balls / 6) cums.push(f.runs);
  return cums.map((c, k) => c - (k ? cums[k - 1] : 0));
}

// ── A. Wides and no-balls with runs ──────────────────────────────────────
console.log("A. Wides and no-balls with runs");
{
  const e = [...open(0, { overs: 2 }),
    b(0, BALL_TYPE.WIDE, 0), b(0, BALL_TYPE.NO_BALL, 4), dot(0), dot(0), dot(0), dot(0), dot(0), dot(0),
    next(0, "y"),
    b(0, BALL_TYPE.WIDE, 2), run(0, 1), b(0, BALL_TYPE.NO_BALL, 1, { nbRuns: "byes" }), run(0, 4), dot(0), b(0, BALL_TYPE.WIDE, 4), dot(0), dot(0), dot(0)];
  const [inn] = deriveInningsList([e]);
  ok("the fold: the report's over (Wd, Nb 4, six dots) is 6, the second over 15, 21 in all", inn.runs === 21 && inn.balls === 12);
  const w = wormOf(render(WormChart, { innings: [inn], curIn: 0, match: { overs: 2 }, events: [e] }));
  const line = w.lines[0] ?? [];
  const last = line[line.length - 1];
  ok(`the worm ends on the innings total (${last?.runs} at ${last?.ball} balls; the fold says ${inn.runs} off ${inn.balls})`,
     last?.runs === inn.runs && last?.ball === inn.balls, line);
  ok(`every delivery is a point on the worm, extras included (${line.length - 1} of ${inn.ballLog.length})`, line.length - 1 === inn.ballLog.length);
  ok("a wide or no-ball stands at the legal-ball x of the ball before it, a step up",
     line.length > 2 && line[1].x === 0 && line[2].x === 0 && line[1].runs === 1 && line[2].runs === 6);
  const bars = barsOf(render(ManhattanChart, { inn, match: { overs: 2 }, events: e }));
  const want = foldByOver(e);
  ok(`runs per over are the fold's (${JSON.stringify(bars)}; the fold ${JSON.stringify(want)})`, JSON.stringify(bars) === JSON.stringify(want));
  ok("...and add up to the total", bars.reduce((s, v) => s + v, 0) === inn.runs);
}

// ── B. A wicket off an illegal delivery ──────────────────────────────────
// What follows a no-ball is the free hit, where only a run out (and the other
// non-bowler modes) stands, and the fold says which wickets stood. Since
// 2026-10-07 a wicket can also fall ON a wide or a no-ball (Law 22.9, 21.17:
// a run out off a no-ball here, and a stumping off a wide): the extra's runs
// count, it is no ball of the over, and the worm marks the wicket where it
// fell, at the legal-ball x of the ball before it.
console.log("\nB. A wicket off an illegal delivery");
{
  const e = [...open(0, { overs: 2 }),
    b(0, BALL_TYPE.NO_BALL, 2, { nbType: "front_foot" }),              // free hit next
    b(0, BALL_TYPE.WICKET, 0, { dismissal: DISMISSAL.BOWLED }),         // saved by the free hit
    b(0, BALL_TYPE.NO_BALL, 1, { nbType: "front_foot", dismissal: DISMISSAL.RUN_OUT, dismissed: "p2", outAt: "striker_end" }), // run out off a no-ball: stands
    batters({ innings: 0, ...at(), nonStriker: "p3" }),
    b(0, BALL_TYPE.WICKET, 1, { dismissal: DISMISSAL.RUN_OUT, dismissed: "p3" }), // on the free hit: stands
    batters({ innings: 0, ...at(), nonStriker: "p4" }),
    run(0, 4), b(0, BALL_TYPE.WIDE, 0, { dismissal: DISMISSAL.STUMPED }),  // stumped off a wide: stands
    batters({ innings: 0, ...at(), striker: "p5" }),
    dot(0), dot(0),
    next(0, "y"),
    b(0, BALL_TYPE.WICKET, 0, { dismissal: DISMISSAL.BOWLED }), run(0, 2)];
  const [inn] = deriveInningsList([e]);
  ok(`the fold: two of the three W deliveries stood, the free hit saving one, and both wickets on extras (${inn.wickets} down, ${inn.runs} runs)`, inn.wickets === 4 && inn.fow.length === 4 && inn.balls === 7);
  const m = render(WormChart, { innings: [inn], curIn: 0, match: { overs: 2 }, events: [e] });
  const w = wormOf(m);
  const want = inn.fow.map((f) => ({ ball: Number(f.overs.split(".")[0]) * 6 + Number(f.overs.split(".")[1] ?? 0), runs: f.runs }));
  ok(`the worm marks the wickets that stood, where they fell (${JSON.stringify(w.marks)}; the fold ${JSON.stringify(want)})`,
     JSON.stringify(w.marks) === JSON.stringify(want));
  const line = w.lines[0] ?? [];
  ok("...each mark on the line", w.marks.every((k) => line.some((p) => p.ball === k.ball && p.runs === k.runs)));
  ok(`...which ends on the total (${line[line.length - 1]?.runs} / ${inn.runs})`, line[line.length - 1]?.runs === inn.runs);
  const bars = barsOf(render(ManhattanChart, { inn, match: { overs: 2 }, events: e }));
  ok(`runs per over are the fold's (${JSON.stringify(bars)} / ${JSON.stringify(foldByOver(e))})`, JSON.stringify(bars) === JSON.stringify(foldByOver(e)));
}

// ── C. Penalty runs, and events that are not deliveries ──────────────────
console.log("\nC. Penalty runs");
{
  // Innings 0 (A): five to A for a fielder's offence after the third ball;
  // a delivery not of the over with its five (Law 17.3.2.5); a retired out.
  // Innings 1 (B): A, fielding, are awarded five, credited to A's innings 0
  // after it ended; B are awarded five in their own innings.
  const e0 = [...open(0, { overs: 2, teamKey: "A" }),
    run(0, 1), dot(0), run(0, 2),
    penalty({ innings: 0, ...at(), ...id(), runs: 5, toBattingTeam: true, reason: "helmet_struck" }),
    dot(0), ...notInOverDelivery({ innings: 0, ...at(), type: BALL_TYPE.RUN, value: 1 }, [...NOT_IN_OVER][0]),
    dot(0), dot(0),
    next(0, "y"),
    retire({ innings: 0, ...at(), batter: "p1", reason: "out", type: "W" }),
    batters({ innings: 0, ...at(), striker: "p3", nonStriker: "p2" }),
    run(0, 4), dot(0), dot(0), dot(0), dot(0), dot(0)];
  const e1 = [...open(1, { overs: 2, teamKey: "B", target: 30 }),
    run(1, 1), penalty({ innings: 1, ...at(), ...id(), runs: 5, toBattingTeam: false, reason: "pitch_damage" }),
    dot(1), penalty({ innings: 1, ...at(), ...id(), runs: 5, toBattingTeam: true, reason: "helmet_struck" }), dot(1)];
  const list = deriveInningsList([e0, e1]);
  const [i0, i1] = list;
  const own = deriveInnings(e0);
  ok(`the fold: A's innings ${i0.runs} with the five credited after it ended (its own log alone: ${own.runs}); B's ${i1.runs}`,
     i0.runs === own.runs + 5 && i1.runs === 1 + 5);
  const m = render(WormChart, { innings: list, curIn: 1, match: { overs: 2 }, events: [e0, e1] });
  const w = wormOf(m);
  const ends = w.lines.map((l) => l[l.length - 1]?.runs);
  ok(`each worm ends on its innings' total (${JSON.stringify(ends)}; the fold ${JSON.stringify([i0.runs, i1.runs])})`,
     ends[0] === i0.runs && ends[1] === i1.runs);
  ok(`the retired out is marked (${w.marks.length} marks; the fold ${i0.wickets + i1.wickets} wickets)`, w.marks.length === i0.wickets + i1.wickets);
  const bars = barsOf(render(ManhattanChart, { inn: i0, match: { overs: 2 }, events: e0 }));
  ok(`A's runs per over have the penalty runs in the over they were awarded (${JSON.stringify(bars)}; the fold ${JSON.stringify(foldByOver(e0))})`,
     JSON.stringify(bars) === JSON.stringify(foldByOver(e0)));
  const mm = render(ManhattanChart, { inn: i0, match: { overs: 2 }, events: e0 });
  ok("...and the five credited from the other innings are said, not dropped", /data-testid="manhattan-unplaced"[^>]*>[^<]*5 penalty runs/.test(mm));
  // Without the log, nothing is placed by guesswork: the line still ends on the total.
  const bare = wormOf(render(WormChart, { innings: list, curIn: 1, match: { overs: 2 } }));
  ok("with no log to place them, the worm still ends on each total", bare.lines.map((l) => l[l.length - 1]?.runs).join() === [i0.runs, i1.runs].join());
}
{
  // A side that opens on five: penalty runs to B while fielding first.
  const e0 = [...open(0, { overs: 1, teamKey: "A" }), run(0, 1),
    penalty({ innings: 0, ...at(), ...id(), runs: 5, toBattingTeam: false, reason: "pitch_damage" }),
    dot(0), dot(0), dot(0), dot(0), dot(0)];
  const e1 = [...open(1, { overs: 1, teamKey: "B", target: 2 }), dot(1), run(1, 1)];
  const list = deriveInningsList([e0, e1]);
  const w = wormOf(render(WormChart, { innings: list, curIn: 1, match: { overs: 1 }, events: [e0, e1] }));
  const l1 = w.lines[1] ?? [];
  ok(`an innings that opened on penalty runs starts there (${l1[0]?.runs}) and ends on its total (${l1[l1.length - 1]?.runs} / ${list[1].runs})`,
     l1[0]?.runs === 5 && l1[l1.length - 1]?.runs === list[1].runs);
}
{
  // An undone award is not on the line.
  const pen = penalty({ innings: 0, ...at(), ...id(), runs: 5, toBattingTeam: true, reason: "helmet_struck" });
  const e = [...open(0, { overs: 1 }), run(0, 2), pen, voidEvent({ innings: 0, ...at(), target: pen.id }), dot(0), dot(0), dot(0), dot(0), dot(0)];
  const [inn] = deriveInningsList([e]);
  const w = wormOf(render(WormChart, { innings: [inn], curIn: 0, match: { overs: 1 }, events: [e] }));
  ok(`a voided award is left out, as the fold leaves it (${w.lines[0]?.at(-1)?.runs} / ${inn.runs})`, inn.runs === 2 && w.lines[0]?.at(-1)?.runs === 2);
}

{
  // Penalty runs before the first ball: a step at nought, not an empty chart.
  const e = [...open(0, { overs: 1 }), penalty({ innings: 0, ...at(), ...id(), runs: 5, toBattingTeam: true, reason: "helmet_struck" })];
  const [inn] = deriveInningsList([e]);
  const w = wormOf(render(WormChart, { innings: [inn], curIn: 0, match: { overs: 1 }, events: [e] }));
  ok(`penalty runs before a ball is bowled are on the worm (${w.lines[0]?.at(-1)?.runs} / ${inn.runs})`, inn.runs === 5 && w.lines[0]?.at(-1)?.runs === 5);
}

// ── D. Revised overs ─────────────────────────────────────────────────────
console.log("\nD. Revised overs");
{
  // A three-over match; the chase is cut to two overs and its target reset to 15.
  const e0 = [...open(0, { overs: 3, teamKey: "A" }), ...Array.from({ length: 6 }, () => run(0, 1)), next(0, "y"),
    ...Array.from({ length: 6 }, () => run(0, 1)), next(0, "x"), ...Array.from({ length: 6 }, () => run(0, 1))];
  const e1 = [...open(1, { overs: 3, teamKey: "B", target: 19 }), ...Array.from({ length: 6 }, () => run(1, 1)),
    revision({ innings: 1, ...at(), overs: 2, target: 15, reason: "rain" }), next(1, "y"),
    ...Array.from({ length: 6 }, () => run(1, 1))];
  const list = deriveInningsList([e0, e1]);
  const i1 = list[1];
  ok(`the fold: the chase ends at its revised two overs, ${i1.runs} of a revised ${i1.target}`, i1.complete && i1.balls === 12 && i1.target === 15);
  const rr = render(RunRateChart, { inn: i1, match: { overs: 3 }, target: i1.target, events: e1 });
  const req = requiredLine(rr);
  ok(`no required rate once no balls are left in the revised overs (required-rate points: ${req.length})`, req.length <= 1);
  ok(`the chase's end is said instead ("${endOf(rr)}")`, endOf(rr) === "Ended 3 short of the target of 15");
  ok("nothing in the chart is NaN or Infinity", clean(rr));
  const dash = render(AnalysisDashboard, { inn: i1, match: { overs: 3 }, curIn: 1, innings: list, events: [e0, e1] });
  ok(`the dashboard chases the revised target, not the first innings' runs + 1 ("${endOf(dash)}")`, endOf(dash) === "Ended 3 short of the target of 15");
  const bars = barsOf(render(ManhattanChart, { inn: i1, match: { overs: 3 }, events: e1 }));
  ok(`runs per over: the two overs bowled (${JSON.stringify(bars)})`, JSON.stringify(bars) === "[6,6]");
}

// ── E. A chase that ends below, on, or above its target ──────────────────
console.log("\nE. Final totals below, equal to and above the target");
const chase = (secondOver) => {
  const e0 = [...open(0, { overs: 2, teamKey: "A" }), ...Array.from({ length: 6 }, () => run(0, 1)), next(0, "y"),
    ...Array.from({ length: 6 }, () => run(0, 1))];
  const e1 = [...open(1, { overs: 2, teamKey: "B", target: 13 }), ...Array.from({ length: 6 }, () => run(1, 1)), next(1, "y"), ...secondOver.map((v) => (typeof v === "number" ? run(1, v) : v()))];
  return { e: [e0, e1], list: deriveInningsList([e0, e1]) };
};
for (const [label, over, want] of [
  ["below: 10 of 13 off the final ball", [1, 1, 1, 1, 0, 0], "Ended 3 short of the target of 13"],
  ["level: 12 of 13", [1, 1, 1, 1, 1, 1], "Scores level on 12"],
  ["equal: 13 of 13 on the final ball", [1, 1, 1, 1, 1, 2], "Target of 13 reached"],
  ["above: 16 of 13 with a six off the final ball", [1, 1, 1, 1, 0, 6], "Target of 13 reached"],
  ["above, with balls to spare: 16 at 1.4", [1, 1, 2, 6], "Target of 13 reached"],
  ["above, off a wide in the final over", [1, 1, 1, 1, 1, () => b(1, BALL_TYPE.WIDE, 1)], "Target of 13 reached"],
]) {
  const { e, list } = chase(over);
  const i1 = list[1];
  const rr = render(RunRateChart, { inn: i1, match: { overs: 2 }, target: i1.target, events: e[1] });
  const w = wormOf(render(WormChart, { innings: list, curIn: 1, match: { overs: 2 }, events: e }));
  ok(`${label}: the fold says ${i1.runs} off ${i1.balls}; the chart says "${endOf(rr)}"`, endOf(rr) === want && i1.complete);
  ok(`${label}: no NaN or Infinity in any path, tick or coordinate`, clean(rr));
  ok(`${label}: no required rate drawn at the end (${requiredLine(rr).length} points)`, requiredLine(rr).length <= 1);
  ok(`${label}: the worm ends on ${i1.runs}`, w.lines[1]?.at(-1)?.runs === i1.runs);
}

// ── F. The projection, held to the fold ──────────────────────────────────
console.log("\nF. The shared projection, over generated innings");
{
  // A seeded generator: deliveries of every type, penalty awards to either
  // side, retirements and voids, folded by the real replay.
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let worst = null, checked = 0;
  for (let t = 0; t < 150; t++) {
    const logs = [0, 1].map((i) => {
      const e = [...open(i, { overs: 3, teamKey: i ? "B" : "A", target: i ? 999 : null })];
      let striker = 3, legal = 0, last = null;
      for (let k = 0; k < 30 && legal < 18; k++) {
        const r = rnd();
        let ev;
        if (r < 0.1) ev = b(i, BALL_TYPE.WIDE, pick([0, 0, 1, 4]));
        else if (r < 0.2) ev = b(i, BALL_TYPE.NO_BALL, pick([0, 1, 4, 6]), rnd() < 0.3 ? { nbRuns: "leg_byes" } : {});
        else if (r < 0.27) ev = b(i, pick([BALL_TYPE.BYE, BALL_TYPE.LEG_BYE]), pick([1, 2, 4]));
        else if (r < 0.32) ev = b(i, BALL_TYPE.WICKET, 0, { dismissal: DISMISSAL.CAUGHT });
        else if (r < 0.36) { e.push(penalty({ innings: i, ...at(), ...id(), runs: 5, toBattingTeam: rnd() < 0.5, reason: rnd() < 0.5 ? "helmet_struck" : "pitch_damage" })); continue; }
        else if (r < 0.38 && last) { e.push(voidEvent({ innings: i, ...at(), target: last.id })); last = null; continue; }
        else ev = run(i, pick([0, 0, 1, 1, 2, 3, 4, 6]));
        e.push(ev); last = ev;
        const f = deriveInnings(e);
        legal = f.balls;
        if (ev.type === BALL_TYPE.WICKET && f.striker == null && f.nonStriker != null && striker <= 11) e.push(batters({ innings: i, ...at(), striker: `p${striker++}`, nonStriker: f.nonStriker }));
        if (f.balls > 0 && f.balls % 6 === 0 && f.bowler == null) e.push(next(i, f.balls / 6 % 2 ? "y" : "x"));
      }
      return e;
    });
    const list = deriveInningsList(logs);
    const projs = projectMatch(list, { events: logs });
    projs.forEach((p, i) => {
      const inn = list[i];
      checked++;
      const end = p.points.at(-1)?.runs;
      const bars = p.overs.reduce((s, o) => s + o.runs, 0);
      const nums = [...p.points.flatMap((q) => [q.ball, q.runs]), ...p.overs.flatMap((o) => [o.runs, o.cum, o.balls])];
      const problems = [
        end !== inn.runs && `worm ends ${end}, fold ${inn.runs}`,
        bars + p.opening + p.closing !== inn.runs && `bars ${bars} + ${p.opening} + ${p.closing} ≠ ${inn.runs}`,
        p.balls !== inn.balls && `balls ${p.balls} ≠ ${inn.balls}`,
        p.overs.reduce((s, o) => s + o.wickets, 0) !== inn.wickets && `wickets ≠ ${inn.wickets}`,
        p.wickets.length !== inn.wickets && "fall of wickets marks ≠ wickets",
        !nums.every(Number.isFinite) && "a non-finite number",
        p.points.some((q, k) => k && q.ball < p.points[k - 1].ball) && "x went backwards",
      ].filter(Boolean);
      if (problems.length && !worst) worst = { t, i, problems };
    });
  }
  ok(`${checked} generated innings: the worm ends on the fold's total, bars + credits add up to it, balls and wickets agree, every number finite`,
     worst == null, worst);
}
{
  const e = [...open(0, { overs: 1 }), b(0, BALL_TYPE.WIDE, 0), b(0, BALL_TYPE.NO_BALL, 4), ...Array.from({ length: 6 }, () => dot(0))];
  const inn = deriveInnings(e);
  const p = projectInnings(inn, { events: e });
  ok("deliveryRuns() is the fold's: the report's over sums to 6", inn.ballLog.reduce((s, x) => s + deliveryRuns(x), 0) === inn.runs && p.total === 6);
  ok("a chase with no target has no end state, and no required rate", runRates(p, null, inn).end === null && runRates(p, null, inn).pts.every((q) => q.reqRr == null));
  ok("an innings with nothing bowled projects to nothing, and nothing is NaN", (() => {
    const empty = projectInnings(deriveInnings(open(0)));
    const r = runRates(empty, 10, { complete: false });
    return empty.points.length === 0 && r.pts.length === 0 && r.end === null;
  })());
  ok("an innings known by its figures (a paper scorebook) draws no line", projectInnings({ summarised: {}, runs: 120, balls: 120, ballLog: [] }).points.length === 0);
}

console.error = realError;
ok(`React reported no NaN attribute while rendering (${warned.filter((w) => /NaN/.test(w)).length})`, !warned.some((w) => /NaN/.test(w)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
