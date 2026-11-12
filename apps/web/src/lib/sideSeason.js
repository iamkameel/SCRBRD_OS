/**
 * The figures behind the side's season panel (GA-I23, slice B3): one point per
 * completed limited-overs match of a side, from the rows the `side_season`
 * read returns to this reader (SCENARIO_AND_TREND_design.md B2.1, B3). Nothing
 * here reads the network, calls a clock, or invents a figure.
 *
 * RUN RATE, NOT THE TOTAL. A school's season mixes 20, 40 and 50 overs and
 * rain-cut matches, so a total is not comparable across them and a rate is.
 * `6 x runs / legal balls`, over the balls actually bowled: an all-out side is
 * not charged its full allotment (Q10). The total is printed beside the point.
 *
 * THE LINE is the season's run rate so far, through each match:
 * `6 x sum(runs) / sum(balls)` to that match. It is drawn from the 5th
 * completed match (MIN_MATCHES); the points are drawn from the first.
 *
 * A MATCH WHOSE INNINGS THE READER CANNOT READ comes back with its figures
 * NULL (never zero). It stays in the list and in the table with no rate, adds
 * nothing to the line, and is said in words.
 *
 * NO VERDICT WORDS (Compare D3, Q9): never "in form", "improving", "best".
 * The points and the line are the whole statement. Team-level: no child here.
 */
import { isoDay } from "./sourceWords.js";

/** Fewer completed matches than this and the line is not drawn. */
export const MIN_MATCHES = 5;

const num = (v) => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * One row of the read, in the shape the panel reads.
 * @param {Record<string, any>} r  a `side_season` row
 */
export function asSideSeason(r) {
  return {
    matchId: r.match_id, startsAt: r.starts_at ?? null, season: r.season ?? null, currentSeason: r.current_season === true,
    side: r.side ?? null, opponent: r.opponent ?? null, scheduledOvers: num(r.scheduled_overs),
    forRuns: num(r.for_runs), forWickets: num(r.for_wickets), forBalls: num(r.for_balls), forOvers: num(r.for_overs), forRevised: r.for_revised === true,
    againstRuns: num(r.against_runs), againstWickets: num(r.against_wickets), againstBalls: num(r.against_balls), againstOvers: num(r.against_overs), againstRevised: r.against_revised === true,
    result: r.result ?? null, marginKind: r.margin_kind ?? null, margin: num(r.margin),
    live: true,
  };
}

/** `6 x runs / balls`, or null where there is no ball to divide by. */
export function runRate(runs, balls) {
  return runs != null && balls != null && balls > 0 ? (6 * runs) / balls : null;
}

/** One decimal, or null. @param {number | null} v */
export const rateText = (v) => (v == null ? null : v.toFixed(1));

/** Legal balls as overs: 122 balls is "20.2". */
export const ballsAsOvers = (balls) => (balls == null ? null : `${Math.floor(balls / 6)}.${balls % 6}`);

/** "20 overs", "16 overs (revised)", or null when the read does not say. */
export function allotmentWords(overs, revised) {
  if (overs == null) return null;
  return `${overs} over${overs === 1 ? "" : "s"}${revised ? " (revised)" : ""}`;
}

const RESULT = Object.freeze({ won: "Won", lost: "Lost", tied: "Tied", no_result: "No result", draw: "Drawn", abandoned: "Abandoned" });

/** The result in words, with its margin where the read gives a runs or wickets one. */
export function resultWords(result, marginKind, margin) {
  if (!result) return null;
  const word = RESULT[result] ?? (result.charAt(0).toUpperCase() + result.slice(1).replace(/_/g, " "));
  const by = (result === "won" || result === "lost") && margin != null && (marginKind === "runs" || marginKind === "wickets")
    ? ` by ${margin} ${margin === 1 ? marginKind.replace(/s$/, "") : marginKind}` : "";
  return word + by;
}

/**
 * The seasons the rows hold, newest first, and which to open on: the server's
 * current one when it has matches, else the latest that does.
 * @param {any[]} rows
 * @returns {{ seasons: string[], current: string | null, open: string | null }}
 */
export function seasonOptions(rows) {
  const seasons = [...new Set(rows.map((r) => r?.season).filter((s) => typeof s === "string" && s))].sort((a, b) => b.localeCompare(a));
  const current = rows.find((r) => r?.currentSeason && r.season)?.season ?? null;
  return { seasons, current, open: current && seasons.includes(current) ? current : (seasons[0] ?? null) };
}

/**
 * The points of one season, in date order, each with the season's run rate so
 * far through it (null until the MIN_MATCHES-th match).
 * @param {any[]} rows  asSideSeason() rows  @param {string | null} season
 */
export function seasonPoints(rows, season) {
  const mine = rows.filter((r) => r && (season == null || r.season === season))
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)) || String(a.matchId).localeCompare(String(b.matchId)));
  let fr = 0, fb = 0, ar = 0, ab = 0;
  return mine.map((r, i) => {
    const readableFor = r.forRuns != null && r.forBalls != null, readableAgainst = r.againstRuns != null && r.againstBalls != null;
    if (readableFor) { fr += r.forRuns; fb += r.forBalls; }
    if (readableAgainst) { ar += r.againstRuns; ab += r.againstBalls; }
    const n = i + 1;
    const lined = n >= MIN_MATCHES;
    const forAllot = allotmentWords(r.forOvers ?? r.scheduledOvers, r.forRevised);
    const againstAllot = allotmentWords(r.againstOvers ?? r.scheduledOvers, r.againstRevised);
    const rainCut = r.forRevised || r.againstRevised;
    return {
      n, matchId: r.matchId, date: isoDay(r.startsAt), opponent: r.opponent,
      forRuns: r.forRuns, forWickets: r.forWickets, forBalls: r.forBalls,
      againstRuns: r.againstRuns, againstWickets: r.againstWickets, againstBalls: r.againstBalls,
      forRate: runRate(r.forRuns, r.forBalls), againstRate: runRate(r.againstRuns, r.againstBalls),
      soFarFor: lined ? runRate(fr, fb) : null, soFarAgainst: lined ? runRate(ar, ab) : null,
      forAllot, againstAllot, rainCut,
      // One phrase for the point: the scheduled overs, or each innings' own where one was revised.
      allotment: rainCut ? (forAllot === againstAllot ? forAllot : `${forAllot ?? "?"} for, ${againstAllot ?? "?"} against`) : (forAllot ?? againstAllot),
      result: r.result, resultLine: resultWords(r.result, r.marginKind, r.margin),
      readable: readableFor || readableAgainst,
    };
  });
}

/** "142/6 in 20.0 overs", or null. */
export function inningsText(runs, wickets, balls) {
  if (runs == null) return null;
  return `${runs}${wickets != null ? `/${wickets}` : ""}${balls != null ? ` in ${ballsAsOvers(balls)} overs` : ""}`;
}

/** The top of the axis: the highest rate drawn, rounded up to a whole run an over (never under 1). */
export function axisTop(points) {
  const all = points.flatMap((p) => [p.forRate, p.againstRate, p.soFarFor, p.soFarAgainst]).filter((v) => v != null);
  return Math.max(1, Math.ceil(Math.max(0, ...all)));
}

/** The basis the SourceLine states: how many completed matches, and the floor. */
export const matchesBasis = (points) => ({ n: points.length, unit: "completed match", plural: "completed matches", floor: MIN_MATCHES });

/** The one sentence under a small sample: where the line starts. */
export const floorNote = (points) => (points.length > 0 && points.length < MIN_MATCHES
  ? `The line starts at the ${MIN_MATCHES}th match. Until then each match is shown on its own.` : null);

/** The note that says what the read could not give, or null. */
export function unreadableNote(points) {
  const k = points.filter((p) => !p.readable).length;
  return k === 0 ? null : `${k} match${k === 1 ? " has" : "es have"} no figures you may read, so ${k === 1 ? "it is" : "they are"} listed without a rate and not in the line.`;
}

/** The note on rain-cut matches, or null. */
export function rainNote(points) {
  const k = points.filter((p) => p.rainCut).length;
  return k === 0 ? null : `${k} match${k === 1 ? " was" : "es were"} cut short by rain; the rate uses the balls actually bowled, and each says its revised overs.`;
}

/**
 * The panel in one sentence, for a screen reader (GA-I31). No verdict.
 * @param {ReturnType<typeof seasonPoints>} points
 */
export function spokenSummary(points) {
  const n = points.length;
  if (n === 0) return "No completed matches this season.";
  const noun = `${n} completed match${n === 1 ? "" : "es"}`;
  const last = points[n - 1];
  if (n < MIN_MATCHES) {
    return `${noun}, fewer than the ${MIN_MATCHES} the season line needs, so no line is drawn. Each match is a point.`;
  }
  const tally = (w) => points.filter((p) => p.result === w).length;
  const won = tally("won"), lost = tally("lost"), other = n - won - lost;
  const f = rateText(last.soFarFor), a = rateText(last.soFarAgainst);
  const rates = f != null && a != null ? `${f} runs an over for the side and ${a} against` : "no run rate you may read";
  return `Run rate this season so far, after ${noun}: ${rates}. Won ${won}, lost ${lost}${other > 0 ? `, ${other} other` : ""}.`;
}

/**
 * The table behind the chart, from the same points the chart draws.
 * @param {ReturnType<typeof seasonPoints>} points  @param {string | null} season
 * @returns {import("../ui/ChartTable.jsx").ChartTableSpec}
 */
export function seasonTable(points, season) {
  return {
    caption: `Run rate by match${season ? `, ${season} school season` : ""}`,
    columns: ["Match", "Date", "Opponent", "Side", "Opposition", "Side, an over", "Opposition, an over", "Overs", "Result", "Side so far", "Opposition so far"],
    text: [1, 2, 3, 4, 7, 8],
    rows: points.map((p) => [
      String(p.n), p.date, p.opponent, inningsText(p.forRuns, p.forWickets, p.forBalls), inningsText(p.againstRuns, p.againstWickets, p.againstBalls),
      rateText(p.forRate), rateText(p.againstRate), p.allotment, p.resultLine, rateText(p.soFarFor), rateText(p.soFarAgainst),
    ]),
    note: "An over is six legal balls. “So far” is the season’s run rate through that match, from the 5th.",
  };
}

/**
 * Which school the side on screen belongs to. The roster can hold two schools'
 * "1XI"s (a staff reader may see both); the side whose season this is, is the
 * one at a school the reader holds an assignment at, else the first the rows name.
 * Presentation only: the read is gated by the fixture's own scope, whatever is asked.
 * @param {{ team?: string | null, school?: string | null }[]} players  @param {string | null} team
 * @param {(string | null | undefined)[]} [heldSchools]
 * @returns {string | null}
 */
export function sideSchool(players, team, heldSchools = []) {
  const schools = [...new Set((players ?? []).filter((p) => p && p.team === team && p.school).map((p) => p.school))];
  return schools.find((s) => heldSchools.includes(s)) ?? schools[0] ?? null;
}
