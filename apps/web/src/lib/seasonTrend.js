/**
 * A player's season, innings by innings (GA-I23 slice 2, B2;
 * docs/design/SCENARIO_AND_TREND_design.md §B2.2, §B3, Kameel's Q8, Q9, Q12).
 *
 * The figures behind the season-trend panel, from the rows the
 * `innings_by_season` read returns to this reader (lib/live.js asInnings) and
 * from nothing else. Nothing here reads the network, a clock or a date, and
 * nothing invents a figure.
 *
 * THE SCOPE IS THE READ'S. The read is one boy's, gated per boy on the server
 * (B1, Q7): his family, or staff of his side who are not pupils. A reader the
 * gate refuses is answered with no rows, which this file cannot tell from a
 * boy with no innings, so the words for nothing say "that you may see" and
 * claim nothing about the record.
 *
 *   points       every innings he batted in the season, in the read's order
 *                (the match's start, the match, the innings), drawn from
 *                the first
 *   the line     runs an innings over his last five innings (a rolling five),
 *                a point at each innings from the 5th; drawn only once BOTH
 *                floors are met: 6 innings in the season, and 30 balls faced
 *                (MIN_BALLS_FACED, rating.mjs) in the last five
 *   the season   runs; innings; not outs; average (runs ÷ dismissals, none
 *                without a dismissal, never 0); strike rate (100 × runs ÷
 *                balls faced, over the innings whose balls are recorded)
 *
 * A SCOREBOOK INNINGS (source 'scorebook') is a point of its own. Where the
 * book recorded no balls (`ballsFaced` null, never 0) the innings counts
 * towards the 6 and its balls towards nothing: it is out of the strike rate
 * (runs and balls both) and out of the 30 (B2.2, as corrected by B1).
 *
 * DID NOT BAT. The read returns innings, never a "did not bat" line (a card's
 * didNotBat list is not a batting row), so a season with no row is a season
 * he did not bat in: "Did not bat this season.", no axis, no zero.
 *
 * NO VERDICT WORDS (Q9, Compare D3). Nothing here says "in form",
 * "improving", "declining", "best" or "struggling"; the points and the line
 * are the whole statement. season-trend.test.mjs holds every sentence to it.
 */
import { MIN_BALLS_FACED } from "@scrbrd/scoring";
import { isoDay } from "./sourceWords.js";

/** The innings a season needs before the line is drawn (Q12): a rolling five needs a sixth to make two points. */
export const MIN_INNINGS = 6;
/** The window of the line: his last five innings. */
export const ROLLING = 5;
/** The balls faced the last five innings need before the line is drawn (Q12): the rating floor's 30. */
export { MIN_BALLS_FACED };

/** The line's own label (B3). */
export const LINE_LABEL = "Runs an innings, last five innings";

/** Words a trend never says (Q9). Held here so the test and the walk read one list. */
export const VERDICT_WORDS = Object.freeze(["in form", "out of form", "improving", "declining", "best", "worst", "struggling"]);

const round1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;

/**
 * @typedef {{ playerId: string, name: string | null, season: string | null, currentSeason: boolean,
 *   matchId: string, innings: number, endedAt: string | null, startsAt: string | null, runs: number, ballsFaced: number | null,
 *   out: boolean, source: "scored" | "scorebook" }} InningsRow
 * @typedef {{ n: number, runs: number, balls: number | null, out: boolean, source: "scored" | "scorebook",
 *   matchId: string, innings: number, on: string | null }} Point
 */

/**
 * The seasons the rows hold, newest first (as text, the server's labels, the
 * Awards tab's sort), the one the server calls current where he batted in it,
 * and the one to open on. `open` is the current season when he batted in it,
 * else null: he did not bat this season, and the panel says so, with his
 * earlier seasons a choice away.
 * @param {InningsRow[]} rows
 */
export function seasonChoice(rows) {
  const seasons = [...new Set(rows.map((r) => r.season).filter((s) => typeof s === "string" && s))].sort().reverse();
  const current = rows.find((r) => r.currentSeason && r.season)?.season ?? null;
  return { seasons, current, open: current };
}

/**
 * His innings in one season, numbered from 1 in the order the read gave them.
 * @param {InningsRow[]} rows  @param {string | null} season
 * @returns {Point[]}
 */
export function seasonPoints(rows, season) {
  if (!season) return [];
  return rows.filter((r) => r.season === season).map((r, i) => ({
    n: i + 1,
    runs: Number.isFinite(r.runs) ? r.runs : 0,
    balls: r.ballsFaced == null || !Number.isFinite(r.ballsFaced) ? null : r.ballsFaced,
    out: r.out === true,
    source: r.source === "scorebook" ? "scorebook" : "scored",
    matchId: r.matchId, innings: r.innings,
    // The match's start, never ended_at: that is when the server took the
    // last ball in, which for a match scored offline is the day it synced.
    on: r.startsAt ?? null,
  }));
}

/** "23*" for a not-out, "23" for an out: the scorecard's own mark. @param {Point} p */
export const runsLabel = (p) => `${p.runs}${p.out ? "" : "*"}`;

/**
 * Runs an innings over the five innings ending at each innings from the 5th,
 * to one decimal place. Its denominator is fixed at five: a not-out does not
 * move it, as it would an average.
 * @param {Point[]} points
 * @returns {{ n: number, v: number }[]}
 */
export function rollingFive(points) {
  const out = [];
  for (let i = ROLLING - 1; i < points.length; i++) {
    let sum = 0;
    for (let k = i - ROLLING + 1; k <= i; k++) sum += points[k].runs;
    out.push({ n: points[i].n, v: round1(sum / ROLLING) });
  }
  return out;
}

/** The balls recorded in his last five innings: a scorebook innings with none adds nothing. @param {Point[]} points */
export function lastFiveBalls(points) {
  return points.slice(-ROLLING).reduce((s, p) => s + (p.balls ?? 0), 0);
}

/**
 * The season so far.
 * @param {Point[]} points
 */
export function seasonFigures(points) {
  const runs = points.reduce((s, p) => s + p.runs, 0);
  const dismissals = points.filter((p) => p.out).length;
  const known = points.filter((p) => p.balls != null);
  const ballsKnown = known.reduce((s, p) => s + /** @type {number} */ (p.balls), 0);
  const runsKnown = known.reduce((s, p) => s + p.runs, 0);
  const book = points.filter((p) => p.source === "scorebook");
  return {
    innings: points.length,
    runs,
    notOuts: points.length - dismissals,
    dismissals,
    // Runs ÷ dismissals; with no dismissal there is no average, never 0.
    average: dismissals > 0 ? round1(runs / dismissals) : null,
    // Over the innings whose balls are recorded, runs and balls both.
    strikeRate: ballsKnown > 0 ? Math.round((100 * runsKnown) / ballsKnown) : null,
    ballsFaced: ballsKnown,
    bookInnings: book.length,
    bookNoBalls: book.filter((p) => p.balls == null).length,
  };
}

/**
 * Whether the line is drawn, and the basis the source line says (B3).
 *
 *   under 6 innings        "Only 4 innings, fewer than the 6 this needs. A guide, not a result."
 *   6, under 30 balls      "Only 22 balls faced in his last five innings, fewer than the 30 this needs. ..."
 *   both met               "From 9 innings, 34 balls faced in his last five innings."
 *
 * @param {Point[]} points  @param {{ self?: boolean }} [o]
 * @returns {{ draw: boolean, short: null | "innings" | "balls", balls: number,
 *   basis: import("../ui/sourceLine.jsx").Denominator | null }}
 */
export function lineState(points, { self = false } = {}) {
  const n = points.length;
  const balls = lastFiveBalls(points);
  const his = self ? "your" : "his";
  if (n === 0) return { draw: false, short: null, balls, basis: null };
  if (n < MIN_INNINGS) {
    return { draw: false, short: "innings", balls, basis: { n, unit: "innings", plural: "innings", floor: MIN_INNINGS } };
  }
  if (balls < MIN_BALLS_FACED) {
    // None recorded at all (every one of the five from a book with no balls):
    // the source line's "No … on record yet, so there is nothing to read here"
    // would deny the points drawn, so the basis is the innings and the note
    // says what the book lacks.
    if (balls === 0) {
      return { draw: false, short: "balls", balls, basis: { n, unit: "innings", plural: "innings", detail: `no balls recorded in ${his} last five innings` } };
    }
    return {
      draw: false, short: "balls", balls,
      basis: { n: balls, unit: `ball faced in ${his} last five innings`, plural: `balls faced in ${his} last five innings`, floor: MIN_BALLS_FACED },
    };
  }
  return {
    draw: true, short: null, balls,
    basis: { n, unit: "innings", plural: "innings", floor: MIN_INNINGS, detail: `${balls} ball${balls === 1 ? "" : "s"} faced in ${his} last five innings` },
  };
}

/**
 * The panel's own sentences, under the source line (B3). Each is a fact about
 * the figures, never a verdict.
 * @param {Point[]} points
 * @param {{ self?: boolean, current?: boolean }} [o]  current: the season on show is this season
 * @returns {string[]}
 */
export function trendNotes(points, { self = false, current = true } = {}) {
  const out = [];
  const st = lineState(points, { self });
  // This season is still being played: the line is to come (B3's words). A
  // finished season is not: it says why there is none, with no "yet".
  if (st.short === "innings") {
    out.push(current
      ? `The line starts once ${self ? "you have" : "he has"} batted ${MIN_INNINGS} times this season. Until then each innings is shown on its own.`
      : `There is no line: ${self ? "you" : "he"} batted fewer than ${MIN_INNINGS} times that season, so each innings is shown on its own.`);
  } else if (st.short === "balls") {
    out.push(current
      ? `The line starts once ${self ? "your" : "his"} last five innings hold ${MIN_BALLS_FACED} balls faced. Until then each innings is shown on its own.`
      : `There is no line: ${self ? "your" : "his"} last five innings that season hold fewer than ${MIN_BALLS_FACED} balls faced, so each innings is shown on its own.`);
  }
  const f = seasonFigures(points);
  if (f.bookInnings > 0) {
    const are = f.bookInnings === 1 ? "1 innings is" : `${f.bookInnings} innings are`;
    const none = f.bookNoBalls === 0 ? ""
      : f.bookNoBalls === 1 ? "; 1 has no balls recorded, so it is not in the strike rate"
      : `; ${f.bookNoBalls} have no balls recorded, so they are not in the strike rate`;
    out.push(`${are} from a scorebook${none}.`);
  }
  return out;
}

/**
 * The spoken summary (GA-I31): what the chart shows, in one short paragraph,
 * for a screen reader. The same figures the chart and its table draw; no
 * verdict, no ranking, no other boy.
 * @param {{ who: string, season: string | null, points: Point[], self?: boolean, current?: boolean }} p
 *   current: the season on show is this season; a finished one says no "yet"
 */
export function spokenSummary({ who, season, points, self = false, current = true }) {
  if (!points.length) return season ? `${who}: no innings in the ${season} school season.` : `${who}: no innings.`;
  const f = seasonFigures(points);
  const st = lineState(points, { self });
  const parts = [
    `${who}, the ${season} school season: ${f.innings} innings, ${f.runs} run${f.runs === 1 ? "" : "s"}, ${f.notOuts} not out.`,
    `Average ${f.average == null ? `none${current ? " yet" : ""}, no dismissal` : f.average}. Strike rate ${f.strikeRate == null ? "none, no balls recorded" : f.strikeRate}.`,
    `Runs in each innings, in order: ${points.map((p) => `${p.runs}${p.out ? "" : " not out"}`).join(", ")}.`,
  ];
  if (st.draw) {
    const line = rollingFive(points);
    parts.push(`${LINE_LABEL}: ${line[0].v} at innings ${line[0].n}, ${line[line.length - 1].v} at innings ${line[line.length - 1].n}.`);
  } else {
    parts.push(current ? "No line is drawn yet." : "No line is drawn.");
  }
  return parts.join(" ");
}

/**
 * The chart's figures as a table (GA-I31, ui/ChartTable.jsx): the same values
 * the chart draws, built from the same points, and the line's column only
 * where the line is drawn.
 * @param {{ who: string, season: string | null, points: Point[], self?: boolean }} p
 * @returns {import("../ui/ChartTable.jsx").ChartTableSpec[]}
 */
export function trendTable({ who, season, points, self = false }) {
  const st = lineState(points, { self });
  const line = st.draw ? new Map(rollingFive(points).map((x) => [x.n, x.v])) : null;
  const columns = ["Innings", "Date", "Runs", "Balls", "How", "From", ...(line ? [LINE_LABEL] : [])];
  return [{
    caption: `${who}: runs in each innings, the ${season} school season`,
    columns,
    text: [1, 4, 5],
    rows: points.map((p) => [
      String(p.n), isoDay(p.on), p.runs, p.balls, p.out ? "out" : "not out", p.source === "scorebook" ? "scorebook" : "scored",
      ...(line ? [line.get(p.n) ?? null] : []),
    ]),
  }];
}

/**
 * Where each point and the line sit on a chart `w` × `h` with `pad` inside
 * each edge: x by innings, y by runs from 0 to the season's most (and the
 * line's, which can be no higher). Pure, so the test reads the geometry.
 * @param {Point[]} points  @param {{ w: number, h: number, pad: number, draw: boolean }} g
 */
export function chartGeometry(points, { w, h, pad, draw }) {
  const top = Math.max(1, ...points.map((p) => p.runs));
  const n = points.length;
  const x = (/** @type {number} */ i) => (n <= 1 ? w / 2 : pad + ((i - 1) / (n - 1)) * (w - 2 * pad));
  const y = (/** @type {number} */ v) => h - pad - (v / top) * (h - 2 * pad);
  const dots = points.map((p) => ({ ...p, x: x(p.n), y: y(p.runs) }));
  const line = draw ? rollingFive(points).map((l) => ({ ...l, x: x(l.n), y: y(l.v) })) : [];
  return { top, dots, line };
}
