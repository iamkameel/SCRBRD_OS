// Par and pressure (SCRBRD-133 G2, design §3): every row of §3.3 against
// figures worked by hand, over logs built with @scrbrd/scoring's own
// constructors. The server's half is @scrbrd/scoring parReport() (what
// GET …/par serves); the page's half is lib/par.js (the words, the rate
// track, the par line) and lib/chartSeries.js wormOf() (the worm's marks).
//
// Every figure is worked in the comment beside its assertion. The ground's
// par is this file's own, P = 160 from 9 innings; the DLS table is the
// synthetic one (round(b × (10 − w) ÷ 3) tenths, a straight line the real
// table is not; SCRBRD-130 §4.5) and no G50 is needed (R₂ < R₁ throughout).
// Nobody here is real: the sides are "1XI" and "Kearsney", the players
// "1XI 3", "Kearsney 7".
//
//   A. the required rate's direction, exactly at ±0.25
//   B. a first innings: ahead, level, behind, no par, the DLS-resources par,
//      cut by rain, and a report one ball old
//   C. a chase: one over, two, three (climbing, steady, falling), six (three
//      overs ago is not the start), the last two overs, the target reached,
//      the ground's par drawn but not said
//   D. a chase after rain: the table loaded, no table under the umpires'
//      method, no table under DLS, the interval lost, a chase ended on a par
//   E. a super over: no par, no trend, the pair's two worms
//   F. the browser computes no resource: the page's modules never name the
//      calculator
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inningsStart, batters, bowler, ball, revision, playStopped, playResumed, sealInnings, deriveMatch, BALL_TYPE,
  syntheticTable, parReport, chaseRates, rrrTrend, requiredRate, RRR_TREND, PAR_TRACK, DLS_STATUS, PAR_AT_METHOD, PAR_AT_LABEL,
} from "@scrbrd/scoring";
import { parWords, rateTrack, parLine, reportFor, gapWords, gapFigure, rainTouched } from "../src/lib/par.js";
import { wormOf } from "../src/lib/chartSeries.js";
import { boardFromInnings, atThisRate } from "../src/scorer/boardData.js";
import { availablePanels } from "../src/display/data.js";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, /** @type {unknown} */ d = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${c || d === "" ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`);
  if (c) pass++; else fail++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

const H = "1XI", A = "Kearsney";
const STARTS = "2026-10-10T10:00:00+02:00";
const T0 = Date.parse("2026-10-10T08:00:00Z");
const MATCH = { id: "m-par", homeTeam: H, homeLabel: "Hilton College 1XI", awayTeam: A, awayLabel: "Kearsney College 1XI",
  startsAt: STARTS, status: "live", overs: 20, format: "T20" };
/** @param {string} side */
const squad = (side) => Array.from({ length: 11 }, (_, k) => ({ id: `${side} ${k + 1}`, name: `${side} ${k + 1}` }));
/** n of v. @param {number} n @param {any} v */
const rep = (n, v) => Array(n).fill(v);
/** An over of six balls, the same number of runs off each. @param {number[]} o */
const overs = (...o) => o.flat();

/** The ground's par: this file's own, nine innings. */
const VENUE = { par: 160, n: 9, sufficient: true, median: 158, low: 121, high: 197, firstSeason: 2025, lastSeason: 2026 };
const TABLE = syntheticTable({ grain: "ball" });
const DLS = { "target.method": "dls_standard" };

/**
 * A log built innings by innings. Steps: a number is a ball of that many runs;
 * "W" a wicket, bowled, and the next man in; {stop}, {resume} and {rev} are
 * the rain events. The bowlers turn about every six legal balls.
 */
class Log {
  constructor() { /** @type {any[]} */ this.events = []; }
  /** @param {number} i @param {...any} evs */
  add(i, ...evs) { for (const e of evs) this.events.push({ ...e, innings: i, clientTs: T0 + this.events.length * 1000, id: `par:${this.events.length}` }); return this; }
  /** @param {number} i @param {string} bat @param {{overs?: number, target?: number | null, superOver?: number}} [o] */
  open(i, bat, { overs: n = 20, target = null, superOver } = {}) {
    const bowl = bat === H ? A : H;
    this.state = { i, bat, bowl, next: 3, legal: 0, turn: 1 };
    return this.add(i, inningsStart({ battingTeam: bat, bowlingTeam: bowl, squad: squad(bat), bowlingSquad: squad(bowl), overs: n, target,
                                      ...(superOver ? { superOver } : {}) }),
                    batters({ striker: `${bat} 1`, nonStriker: `${bat} 2` }), bowler({ bowler: `${bowl} 1` }));
  }
  /** @param {any[]} steps */
  play(steps) {
    const s = /** @type {any} */ (this.state);
    for (const x of steps) {
      if (typeof x === "number" || x === "W") {
        if (s.legal > 0 && s.legal % 6 === 0 && s.turned !== s.legal) { s.turn = s.turn === 1 ? 2 : 1; s.turned = s.legal; this.add(s.i, bowler({ bowler: `${s.bowl} ${s.turn}` })); }
        if (x === "W") {
          this.add(s.i, ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }));
          this.add(s.i, batters({ striker: `${s.bat} ${s.next++}`, nonStriker: `${s.bat} 2` }));
        } else this.add(s.i, ball({ type: BALL_TYPE.RUN, value: x }));
        s.legal++;
      } else if ("stop" in x) this.add(s.i, playStopped({ reason: "rain", at: T0 + 3_600_000 }));
      else if ("resume" in x) this.add(s.i, playResumed({ at: T0 + 6_000_000 }));
      else if ("rev" in x) this.add(s.i, revision({ overs: x.rev.overs ?? null, target: x.rev.target ?? null, par: x.rev.par ?? null, reason: "rain" }));
    }
    return this;
  }
  /** @param {any} ctx @param {string | null} [reason] */
  seal(ctx, reason = null) {
    const s = /** @type {any} */ (this.state);
    const inn = /** @type {any} */ (deriveMatch(this.events, ctx).innings[s.i]);
    return this.add(s.i, sealInnings(inn, reason ?? inn.endReason ?? null));
  }
}

/**
 * Everything a screen shows for the innings in play: the server's report, and
 * the page's words, track and worm made from it exactly as the Summary tab
 * and the display make them (tabs-core.jsx, display/data.js).
 * @param {Log} log @param {{ctx?: any, venue?: any, table?: any, result?: string | null, report?: any}} [o]
 */
function screen(log, { ctx = { startsAt: STARTS }, venue = VENUE, table = null, result = null, report: given } = {}) {
  const report = given ?? parReport({ events: log.events, ctx, venue, table });
  const fold = deriveMatch(log.events, ctx);
  const index = fold.innings.length - 1;
  const inn = /** @type {any} */ (fold.innings[index]);
  const chasing = index === 1 && inn.target != null && inn.superOver == null;
  const target = chasing || inn.superOver != null ? inn.target : null;
  const rates = chasing ? chaseRates(log.events, ctx, index) : null;
  const rained = rainTouched(fold.innings, inn.conditions ?? null);
  const shown = reportFor(report, inn, index);
  const par = { chasing, report: shown, rates, rained, result };
  const words = parWords({ inn, chasing, target, overs: inn.overs, report: shown, rates, rained, result });
  const projected = atThisRate(inn, { overs: inn.overs, chasing, format: "T20" });
  const board = boardFromInnings(inn, { target, overs: inn.overs, projected, par });
  const track = rateTrack({ inn, chasing, target, overs: inn.overs, report: shown, rates, rained, side: "Hilton" });
  const worm = wormOf({ match: MATCH, played: fold.innings, index, events: log.events, overs: 20, report: shown });
  return { report, fold, inn, index, words, sub: board?.sub ?? null, track, worm, rates };
}
const pts = (/** @type {any[]} */ t) => t.map((p) => `${p.balls}:${p.parAt}`).join(" ");

// ═══════════════════════════════════════════════════════════════════
group("A. The required rate's direction (§3.3, A7: ±0.25 an over)");
{
  // Before: 100 needed off 120 balls = 5.00. Now, off 96 balls left:
  //   84 needed → 84 × 6 ÷ 96 = 5.25   (+0.25 exactly) climbing
  //   83 needed → 5.1875               (+0.1875)       steady
  //   76 needed → 4.75                 (−0.25 exactly) falling
  //   77 needed → 4.8125               (−0.1875)       steady
  const before = { target: 100, runs: 0, left: 120 };
  ok("+0.25 exactly is climbing — compared in whole numbers, not 0.2499999", rrrTrend({ target: 100, runs: 16, left: 96 }, before) === RRR_TREND.CLIMBING);
  ok("+0.1875 is steady", rrrTrend({ target: 100, runs: 17, left: 96 }, before) === RRR_TREND.STEADY);
  ok("−0.25 exactly is falling", rrrTrend({ target: 100, runs: 24, left: 96 }, before) === RRR_TREND.FALLING);
  ok("−0.1875 is steady", rrrTrend({ target: 100, runs: 23, left: 96 }, before) === RRR_TREND.STEADY);
  ok("no ball left: no direction", rrrTrend({ target: 100, runs: 23, left: 0 }, before) === null);
  ok("requiredRate: 139 off 102 balls is 8.176…, none with no ball left",
     Math.abs(/** @type {number} */ (requiredRate(151, 12, 120, 18)) - 139 * 6 / 102) < 1e-12 && requiredRate(151, 12, 120, 120) === null);
  ok("gap words in whole runs: ahead, level, behind", gapWords(92, 80) === "12 ahead of par for this ground" && gapWords(80, 80) === "Level with par for this ground"
     && gapWords(71, 80) === "9 behind par for this ground" && gapFigure(92, 80) === "+12" && gapFigure(71, 80) === "−9" && gapFigure(80, 80) === "level");
}

// ═══════════════════════════════════════════════════════════════════
group("B. A first innings, the ground's par P = 160 over 20 overs (120 balls)");
/** Hilton batting first, 60 balls: `runs` of twos (and a one when odd), the rest dots. @param {number} runs */
const first60 = (runs) => new Log().open(0, H).play([...rep(Math.floor(runs / 2), 2), ...(runs % 2 ? [1] : []), ...rep(60 - Math.floor(runs / 2) - (runs % 2), 0)]);
{
  // 10 overs: par here = round(160 × 60 ÷ 120) = 80. CRR = runs ÷ 60 × 6.
  const ahead = screen(first60(92));
  ok("ahead: \"12 ahead of par for this ground · CRR 9.20\" (92 against 80; 92 ÷ 10 overs)",
     ahead.words === "12 ahead of par for this ground · CRR 9.20", ahead.words);
  ok("...the Board's whole second line is that, and no 'At this rate'", ahead.sub === "12 ahead of par for this ground · CRR 9.20", ahead.sub);
  const v = ahead.report.venue;
  ok("...the report: par 160 from 9, par here 80 by the proportion of overs, labelled so",
     v.par === 160 && v.n === 9 && v.parAt === 80 && v.method === PAR_AT_METHOD.PROPORTION && v.label === PAR_AT_LABEL.proportion && v.shortened === false, v);
  ok("...with its evidence: the seasons, the median, the range", v.seasons.first === 2025 && v.seasons.last === 2026 && v.median === 158
     && v.range.low === 121 && v.range.high === 197);
  // The track: 8 a over (160 ÷ 20), at every over's end, from nought.
  ok("...the track: nought, then 8 an over to 80 at the tenth (one point an over, the last the current point)",
     pts(ahead.report.track) === Array.from({ length: 11 }, (_, k) => `${6 * k}:${8 * k}`).join(" ") && ahead.report.trackOf === PAR_TRACK.VENUE,
     pts(ahead.report.track));
  ok("...no DLS par, no required rate", ahead.report.dls === null && ahead.report.rrr === null);
  ok("...the rate track: par 80 a bar, Hilton 92 a dot, \"+12\"", ahead.track?.kind === "par" && ahead.track.from.value === 80 && ahead.track.from.mark === "bar"
     && ahead.track.to.value === 92 && ahead.track.to.mark === "dot" && ahead.track.gap === "+12", ahead.track);
  const w = ahead.worm;
  ok("...the worm: the par dashed, \"Par here 160 (9 innings)\", ending at P at the allotment",
     w?.par?.label === "Par here 160 (9 innings)" && w.par.end?.balls === 120 && w.par.end.runs === 160 && w.par.of === "venue", w?.par);
  ok("...and, by the proportion of overs, a straight line ahead from 80 at 60 balls to 160 at 120",
     JSON.stringify(w?.par?.ahead) === JSON.stringify([{ balls: 60, runs: 80 }, { balls: 120, runs: 160 }]), w?.par?.ahead);
  ok("...its legend says what it is", w?.par?.legend === `Par: this ground, 9 innings (dashed) · ${PAR_AT_LABEL.proportion}`, w?.par?.legend);
  ok("...one line, no target in a first innings", w?.lines.length === 1 && w.target === null);

  const level = screen(first60(80));
  ok("level: \"Level with par for this ground · CRR 8.00\"", level.words === "Level with par for this ground · CRR 8.00", level.words);
  ok("...the rate track's gap says \"level\"", level.track?.gap === "level");
  const behind = screen(first60(71));
  ok("behind: \"9 behind par for this ground · CRR 7.10\" (71 against 80)", behind.words === "9 behind par for this ground · CRR 7.10", behind.words);

  // Mid-over: 62 balls, par here = round(160 × 62 ÷ 120) = round(82.67) = 83.
  const mid = screen(first60(80).play([1, 1]));
  ok("mid-over: par here round(82.67) = 83; 82 is \"1 behind\"; the track's last point is now, 62:83",
     mid.report.venue.parAt === 83 && /^1 behind par for this ground · CRR 7\.94$/.test(mid.words ?? "") && pts(mid.report.track).endsWith("60:80 62:83"),
     `${mid.words} | ${pts(mid.report.track)}`);

  // No par: below the floor the read has no venue (db/88 answers nothing).
  const none = screen(first60(92), { venue: null });
  ok("no venue par: the line is as built — \"CRR 9.20 · At this rate: 184\" (92 + 92 ÷ 60 × 60)",
     none.words === null && none.sub === "CRR 9.20 · At this rate: 184", none.sub);
  ok("...the report says nothing about par, and the worm draws none", none.report.venue === null && none.report.track.length === 0 && none.worm?.par === null);
  ok("...no rate track", none.track === null);
  const thin = screen(first60(92), { venue: { ...VENUE, par: null, n: 4, sufficient: false } });
  ok("an insufficient row, should one ever reach it, is no par either", thin.report.venue === null && thin.words === null);

  // The DLS resources, with a table: 60 balls, 2 down. R(120,0) = 400,
  // R(60,2) = round(60 × 8 ÷ 3) = 160; used 240 of 400; par here
  // round(160 × 240 ÷ 400) = 96. 92 is "4 behind".
  const dls = screen(new Log().open(0, H).play([...rep(46, 2), ...rep(12, 0), "W", "W"]), { table: TABLE });
  ok("with a table: par here 96 by the resources used (2 down at 10 overs), \"4 behind\"",
     dls.report.venue.parAt === 96 && dls.report.venue.method === PAR_AT_METHOD.DLS && dls.words === "4 behind par for this ground · CRR 9.20",
     `${dls.report.venue.parAt} ${dls.words}`);
  ok("...labelled \"DLS resources used\", and no cell, no resource in the report",
     dls.report.venue.label === PAR_AT_LABEL.dls_resources && !/resource_tenths|"resources"|cells|R1|R2/.test(JSON.stringify(dls.report)));
  ok("...with the table the line ahead depends on wickets not yet fallen: only its end is marked",
     dls.worm?.par?.ahead === null && dls.worm?.par?.end?.runs === 160);

  // Cut by rain: stopped at 10.0, revised to 16 overs, two more overs.
  // Measured against a full innings here: round(160 × 72 ÷ 120) = 96;
  // 100 is "4 ahead … (of a full innings here)"; CRR 100 ÷ 12 = 8.33.
  const cut = screen(first60(80).play([{ stop: true }, { rev: { overs: 16 } }, { resume: true }, ...overs([4, 4, 4, 4, 2, 2], [0, 0, 0, 0, 0, 0])]));
  ok("cut by rain: \"4 ahead of par for this ground (of a full innings here) · CRR 8.33\"",
     cut.words === "4 ahead of par for this ground (of a full innings here) · CRR 8.33" && cut.report.venue.shortened === true, cut.words);
  ok("...after the umpires' figure: \"16 overs (revised from 20) · …\"", cut.sub === `16 overs (revised from 20) · ${cut.words}`, cut.sub);
  ok("...the par line to P at the ORIGINAL 20 overs; the revised 16 a rule of its own",
     cut.worm?.par?.end?.balls === 120 && cut.worm.par.end.runs === 160 && cut.worm.revised?.balls === 96 && cut.worm.revised.label === "16 overs (revised)"
     && cut.worm.balls === 120, { par: cut.worm?.par?.end, revised: cut.worm?.revised, balls: cut.worm?.balls });
  ok("...the track is not redrawn under the cut: 8 an over throughout, 96 at 72 balls",
     pts(cut.report.track).endsWith("60:80 66:88 72:96"), pts(cut.report.track));

  // A report one ball old says nothing: the line is as built until the next read.
  const older = first60(92);
  const stale = parReport({ events: older.events, ctx: { startsAt: STARTS }, venue: VENUE });
  const now = screen(older.play([1]), { report: stale });
  ok("a report one ball behind the page's fold is not shown: no gap one ball stale", now.words === null && /^CRR /.test(now.sub ?? ""), now.sub);
  ok("...nor its par line on the worm", now.worm?.par === null);
}

// ═══════════════════════════════════════════════════════════════════
group("C. A chase: Hilton 150 in 20 overs, Kearsney need 151 from 120 balls");
/** Hilton's 150 (75 twos, 45 dots), sealed, and the chase opened. @param {any} [ctx] @param {number} [chaseOvers] @param {number} [target] */
const chase = (ctx = { startsAt: STARTS }, chaseOvers = 20, target = 151) =>
  new Log().open(0, H).play([...rep(75, 2), ...rep(45, 0)]).seal(ctx).open(1, A, { target, overs: chaseOvers });
{
  // One over, 8: need 143 off 114; RRR 143 × 6 ÷ 114 = 7.526 → 7.53; no trend yet.
  const one = screen(chase().play([2, 2, 2, 2, 0, 0]));
  ok("one over: \"Need 143 off 114 · RRR 7.53\" — no trend word under two overs", one.words === "Need 143 off 114 · RRR 7.53", one.words);
  ok("...no required-rate report and no rate track", one.report.rrr === null && one.rates === null && one.track === null);

  // Two overs, 16: three overs ago is the chase's start. Start 151 × 6 ÷ 120
  // = 7.55; now 135 × 6 ÷ 108 = 7.50; −0.05 → steady.
  const two = screen(chase().play(overs([2, 2, 2, 2, 0, 0], [2, 2, 2, 2, 0, 0])));
  ok("two overs: \"Need 135 off 108 · RRR 7.50, steady\" (7.55 at the start)", two.words === "Need 135 off 108 · RRR 7.50, steady", two.words);
  ok("...the report's rates: now 7.5, at the start 7.55", two.report.rrr?.now === 7.5 && two.report.rrr.threeOversAgo === 7.55 && two.report.rrr.trend === "steady", two.report.rrr);

  // Three overs, from the start (7.55):
  //   12 → 139 × 6 ÷ 102 = 8.176 → 8.18, +0.63 climbing
  //   24 → 127 × 6 ÷ 102 = 7.471 → 7.47, −0.08 steady
  //   36 → 115 × 6 ÷ 102 = 6.765 → 6.76, −0.79 falling
  const climbing = screen(chase().play(overs(...rep(3, [2, 2, 0, 0, 0, 0]))));
  ok("climbing: \"Need 139 off 102 · RRR 8.18, climbing\"", climbing.words === "Need 139 off 102 · RRR 8.18, climbing", climbing.words);
  ok("...the report: 8.18 now, 7.55 three overs ago", climbing.report.rrr?.now === 8.18 && climbing.report.rrr.threeOversAgo === 7.55 && climbing.report.rrr.trend === RRR_TREND.CLIMBING);
  ok("...the rate track: CRR 4.00 a dot, RRR 8.18 a bar, \"climbing\"", climbing.track?.kind === "rate" && climbing.track.from.text === "4.00"
     && climbing.track.from.mark === "dot" && climbing.track.to.text === "8.18" && climbing.track.to.mark === "bar" && climbing.track.gap === "climbing", climbing.track);
  const steady = screen(chase().play(overs(...rep(3, [2, 2, 2, 2, 0, 0]))));
  ok("steady: \"Need 127 off 102 · RRR 7.47, steady\"", steady.words === "Need 127 off 102 · RRR 7.47, steady", steady.words);
  const falling = screen(chase().play(overs(...rep(3, [2, 2, 2, 2, 2, 2]))));
  ok("falling: \"Need 115 off 102 · RRR 6.76, falling\"", falling.words === "Need 115 off 102 · RRR 6.76, falling", falling.words);
  ok("...the Board's second line is the words, nothing added", falling.sub === falling.words, falling.sub);

  // Six overs and two balls: 24 in the first three, 6 in the next three, two
  // dots. At the end of the 3rd: 127 × 6 ÷ 102 = 7.47; of the 6th:
  // 121 × 6 ÷ 84 = 8.64 → climbing. The rate now: 121 × 6 ÷ 82 = 8.85.
  const six = screen(chase().play([...overs(...rep(3, [2, 2, 2, 2, 0, 0])), ...overs(...rep(3, [2, 0, 0, 0, 0, 0])), 0, 0]));
  ok("six overs and two balls: the trend from the 3rd over's end to the 6th's, not from the start",
     six.report.rrr?.now === 8.64 && six.report.rrr.threeOversAgo === 7.47 && six.report.rrr.trend === "climbing", six.report.rrr);
  ok("...\"Need 121 off 82 · RRR 8.85, climbing\" — the rate now, the direction over the completed overs",
     six.words === "Need 121 off 82 · RRR 8.85, climbing", six.words);
  ok("...the page's own arithmetic agrees with the server's", JSON.stringify(six.rates && { now: six.rates.now, threeOversAgo: six.rates.threeOversAgo, trend: six.rates.trend })
     === JSON.stringify(six.report.rrr));
  // The ground's par in a chase: drawn, not said (§3.3). 38 balls:
  // round(160 × 38 ÷ 120) = round(50.67) = 51.
  ok("the ground's par in a chase: in the report (51 at 38 balls) and dashed on the worm, never in the words",
     six.report.venue?.parAt === 51 && six.worm?.par?.of === "venue" && !/par/i.test(six.words ?? ""), six.report.venue);
  ok("...the target a solid labelled line, the first innings dim", six.worm?.target?.runs === 151 && six.worm.target.label === "Target 151"
     && six.worm.lines.map((l) => l.tone).join() === "dim,main", six.worm?.lines.map((l) => l.tone));

  // The last two overs: 113 balls, 140 — need 11 off 7, and the balls say it.
  const last = screen(chase().play([...rep(70, 2), ...rep(43, 0)]));
  ok("the last two overs: \"Need 11 off 7\" — no rate", last.words === "Need 11 off 7", last.words);
  const reached = screen(chase().play([...rep(25, 6), 1]));
  ok("the target reached: \"Target reached\"", reached.words === "Target reached", reached.words);
}

// ═══════════════════════════════════════════════════════════════════
group("D. A chase after rain (the synthetic table)");
// Kearsney chasing 151: ten overs of 8 (2 2 2 2 0 and a dot, or W in the 5th
// and the 9th), 80 for 2 at 10.0; rain; the umpires cut the chase to 15 overs
// and the target to 121; two more overs of 21 and 4: 105 for 2 at 12.0.
//   R₁ = R(120,0) = 400. The stop at 60 balls left, 2 down; resumed at 15
//   overs, 30 left: loss R(60,2) − R(30,2) = 160 − 80 = 80; R₂ = 320.
//   Par now (72 bowled, 18 left, 2 down): R(18,2) = 48; R₂ − 48 = 272;
//   ⌊150 × 272 ÷ 400⌋ = 102. 105 is 3 ahead.
const TEN = overs(...[1, 2, 3, 4].map(() => [2, 2, 2, 2, 0, 0]), [2, 2, 2, 2, 0, "W"], ...[6, 7, 8].map(() => [2, 2, 2, 2, 0, 0]), [2, 2, 2, 2, 0, "W"], [2, 2, 2, 2, 0, 0]);
const RAIN = [{ stop: true }, { rev: { overs: 15, target: 121 } }, { resume: true }];
const AFTER = overs([4, 4, 4, 4, 4, 1], [0, 0, 0, 0, 0, 4]);
{
  const ctx = { startsAt: STARTS, conditions: DLS };
  const loaded = screen(chase(ctx).play([...TEN, ...RAIN, ...AFTER]), { ctx, table: TABLE });
  ok("the fold stands at 105 for 2, 72 balls, 15 overs, target 121", loaded.inn.runs === 105 && loaded.inn.wickets === 2 && loaded.inn.balls === 72
     && loaded.inn.overs === 15 && loaded.inn.target === 121, [loaded.inn.runs, loaded.inn.wickets, loaded.inn.balls, loaded.inn.overs, loaded.inn.target]);
  ok("table loaded: \"Need 16 off 18 (DLS) · 3 ahead of DLS par\"", loaded.words === "Need 16 off 18 (DLS) · 3 ahead of DLS par", loaded.words);
  ok("...the report's DLS par 102, the table's id and nothing of it but that", loaded.report.dls?.parAt === 102 && loaded.report.dls.status === DLS_STATUS.OK
     && Object.keys(loaded.report.dls).sort().join() === "parAt,status,tableId", loaded.report.dls);
  ok("...the ground's par not said and not served: the DLS par replaces it", loaded.report.venue === null && loaded.report.trackOf === PAR_TRACK.DLS);
  // The track as it stood: at 10.0 (before the stop) R₂ was 400 and R(60,2)
  // 160: ⌊150 × 240 ÷ 400⌋ = 90; at 11.0 (after the cut) R(24,2) = 64:
  // ⌊150 × 256 ÷ 400⌋ = 96; at 12.0, 102.
  ok("...the track as each over stood: 90 at 10.0, a step to 96 at 11.0 under the cut, 102 now",
     pts(loaded.report.track).endsWith("60:90 66:96 72:102") && loaded.report.track[0].balls === 0 && loaded.report.track[0].parAt === 0, pts(loaded.report.track));
  ok("...the rate track: DLS par 102 a bar, the score 105 a dot, \"+3\"", loaded.track?.kind === "par" && loaded.track.from.label === "DLS par"
     && loaded.track.from.value === 102 && loaded.track.to.value === 105 && loaded.track.gap === "+3", loaded.track);
  ok("...the worm: \"DLS par (calculated)\" dashed, the target at the umpires' 121", loaded.worm?.par?.of === "dls" && loaded.worm.par.label === "DLS par (calculated)"
     && loaded.worm.target?.runs === 121 && loaded.worm.par.ahead === null, loaded.worm?.par);

  // No table, the umpires' own method: the revised words and the trend.
  // At 9.0: 72 for 2, 54 bowled — (121 − 72) × 6 ÷ (90 − 54) = 8.17; at 12.0:
  // 16 × 6 ÷ 18 = 5.33 → falling.
  const plain = { startsAt: STARTS };
  const umpires = screen(chase(plain).play([...TEN, ...RAIN, ...AFTER]), { ctx: plain, table: null });
  ok("no table: \"Need 16 off 18 (revised) · RRR 5.33, falling\"", umpires.words === "Need 16 off 18 (revised) · RRR 5.33, falling", umpires.words);
  ok("...the report: DLS no_table, no par at all, no track", umpires.report.dls?.status === DLS_STATUS.NO_TABLE && umpires.report.dls.parAt === null
     && umpires.report.venue === null && umpires.report.track.length === 0);
  ok("...the required rates over the cut: 8.17 at 9.0, 5.33 at 12.0", umpires.report.rrr?.threeOversAgo === 8.17 && umpires.report.rrr.now === 5.33);
  ok("...no par line; the target line at the umpires' figure", umpires.worm?.par === null && umpires.worm?.target?.runs === 121);
  ok("...the rate track compares the rates the line names: CRR 8.75, RRR 5.33, \"falling\"", umpires.track?.kind === "rate"
     && umpires.track.from.text === "8.75" && umpires.track.to.text === "5.33" && umpires.track.gap === "falling", umpires.track);
  // No table, the competition's method DLS: the umpires worked it from their
  // own sheets; the words say whose method, as the result's words do (130 §5).
  const sheets = screen(chase(ctx).play([...TEN, ...RAIN, ...AFTER]), { ctx, table: null });
  ok("no table under DLS: \"Need 16 off 18 (DLS) · RRR 5.33, falling\" — the method's name, the rate's direction",
     sheets.words === "Need 16 off 18 (DLS) · RRR 5.33, falling", sheets.words);

  // The interval lost: the chase begins at 15 overs with a target of 121, no
  // stop at all. Rain touched it; the DLS par is the par. At 2.0, 16 for 0:
  //   R₁ 400; R₂ = R(90,0) = 300; now R(78,0) = 260; ⌊150 × 40 ÷ 400⌋ = 15.
  const lost = screen(chase(ctx, 15, 121).play(overs([2, 2, 2, 2, 0, 0], [2, 2, 2, 2, 0, 0])), { ctx, table: TABLE });
  ok("the interval lost (a 15-over chase of a 20-over innings, target 121): rain touched it",
     rainTouched(lost.fold.innings, DLS) === true && lost.report.dls?.parAt === 15 && lost.report.venue === null, lost.report.dls);
  ok("...\"Need 105 off 78 (DLS) · 1 ahead of DLS par\"", lost.words === "Need 105 off 78 (DLS) · 1 ahead of DLS par", lost.words);
  ok("an untouched chase is not rain-touched", rainTouched(screen(chase().play([2, 2, 2, 2, 0, 0])).fold.innings) === false);

  // Terminated on a par the umpires announced: the result's words, the
  // worm stopped at the termination with their par as a mark.
  const ended = chase(ctx).play([...TEN, ...RAIN, ...AFTER, { stop: true }, { rev: { par: 102 } }]).seal(ctx, "abandoned");
  const result = deriveMatch(ended.events, ctx).result;
  ok("ended on a par of 102 at 105: decided by play, Kearsney by 8 wickets (DLS)", /won by 8 wickets \(DLS\)/.test(result?.text ?? ""), result?.text);
  const done = screen(ended, { ctx, table: TABLE, result: result?.text ?? null });
  ok("...the second line is the result's words", done.words === result?.text, done.words);
  ok("...the worm: \"Par (umpires) 102\" as a mark, and no calculated line beside it",
     done.worm?.umpiresPar?.runs === 102 && done.worm.umpiresPar.label === "Par (umpires) 102" && done.worm.par === null, done.worm?.umpiresPar);
}

// ═══════════════════════════════════════════════════════════════════
group("E. A super over: no par, no projection, no trend");
{
  const ctx = { startsAt: STARTS, conditions: { "result.tie_break": "super_over" } };
  const log = new Log().open(0, H, { overs: 1 }).play([4, 1, 0, 2, 6, 1]).seal(ctx)
    .open(1, A, { overs: 1, target: 15 }).play([6, 6, 1, 1, 0, 0]).seal(ctx)
    .open(2, A, { overs: 1, superOver: 1 }).play([4, 1, 0, 2, 1, 1]).seal(ctx)
    .open(3, H, { overs: 1, superOver: 1, target: 10 }).play([1, 1, 4, 2, 0, 0]);
  const so = screen(log, { ctx, table: TABLE });
  ok("the report: nothing but where it stands", so.report.venue === null && so.report.dls === null && so.report.rrr === null && so.report.track.length === 0
     && so.report.at?.innings === 3, so.report);
  ok("the words: none of par's (the super over's own block says it)", so.words === null);
  ok("the worm: the pair's two worms only, one over wide, no par", so.worm?.lines.length === 2 && so.worm.balls === 6 && so.worm.par === null,
     so.worm && { lines: so.worm.lines.length, balls: so.worm.balls });
}

// ═══════════════════════════════════════════════════════════════════
group("F. The page computes no resource");
{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
  const page = ["lib/par.js", "lib/chartSeries.js", "ui/charts/worm.jsx", "ui/parTrack.jsx", "display/data.js", "display/panels.jsx",
    "display/DisplayView.jsx", "public/reads.js", "views/matchcentre/tabs-core.jsx"];
  const named = page.filter((f) => /\b(resourcesOf|dlsParAt|dlsTarget|inningsResources|parReport|syntheticTable|parAt)\s*\(/.test(readFileSync(join(root, f), "utf8")));
  ok("no screen module calls the calculator, the resources or venue.mjs's parAt — the figures are the server's", named.length === 0, named);
  ok("parLine draws the server's points as given", JSON.stringify(parLine({ track: [{ balls: 0, parAt: 0 }, { balls: 6, parAt: 9 }], trackOf: "dls" }, 120)?.points)
     === JSON.stringify([{ balls: 0, runs: 0 }, { balls: 6, runs: 9 }]));
  ok("...and nothing for a track of fewer than two points", parLine({ track: [{ balls: 0, parAt: 0 }], trackOf: "venue", venue: VENUE }, 120) === null);
  ok("the display's worm panel waits for a completed over", !availablePanels({ balls: 5 }).has("worm") && availablePanels({ balls: 6 }).has("worm"));
}

console.log(`\nPAR: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
