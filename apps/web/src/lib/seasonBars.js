/**
 * The figures behind the Analytics "performance" tab's season bars (GA-I23,
 * first slice): one bar per player for a season, or one bar per season for a
 * player, drawn from the rows `career_by_season` already returns to this
 * reader (lib/live.js asSeasonCareer). Nothing here reads the network, calls
 * a clock or a date, or invents a figure.
 *
 * THE SCOPE IS THE READ'S. The rows are the deliveries this reader may see,
 * for the players this reader may read (RLS, db/44), so a pupil's or a
 * parent's rows are their own child's and a coach's are what the read gives a
 * coach. This file only narrows what it is handed, to a side and a season or
 * to a player; it never asks for more and never fills a gap.
 *
 * TWO NULLS THAT ARE NOT ZEROS.
 *   - A season in which a player did not bat has no run figure: the bar is
 *     absent and the row says "did not bat", never a bar of nought.
 *   - A season in which he bowled no ball has no wicket figure: "did not bowl".
 *   A zero is only ever a fact: he batted, and scored none.
 *
 * THE SEASONS ARE THE SERVER'S. `season` is the label Postgres filed each
 * match under (school_season_of(), db/44). They are sorted as text, the way
 * the Awards tab sorts them, and never read as dates here.
 *
 * THE DEMONSTRATION is for the signed-out app only (demoSeasonRows): a
 * clearly labelled split of the sample players' career into three seasons. It
 * is a function of its inputs, not a list of figures held in the view, and
 * the view draws it only when no session exists.
 */
import { seasonWindow } from "./sourceWords.js";

/** What each bar chart can show. `key` names the figure on the season row. */
export const METRICS = Object.freeze({
  runs: Object.freeze({ key: "runs", label: "Runs", unit: "run", plural: "runs", none: "did not bat" }),
  wkts: Object.freeze({ key: "wkts", label: "Wickets", unit: "wicket", plural: "wickets", none: "did not bowl" }),
});

/** At most this many players in the side's chart, so it stays a chart. */
export const SQUAD_LIMIT = 6;

/** The most recent this many seasons in a player's chart. */
export const SEASON_LIMIT = 8;

/**
 * Did the player take part in this discipline in that season? `innings` is
 * batting matches (bat_matches); `ballsBowled` is legal balls bowled.
 * @param {any} r  a season row  @param {"runs"|"wkts"} metric
 */
export const tookPart = (r, metric) => (metric === "runs" ? (r.innings ?? 0) > 0 : (r.ballsBowled ?? 0) > 0);

/** The figure for a bar, or null where he did not take part. @param {any} r @param {"runs"|"wkts"} metric */
export function figure(r, metric) {
  if (!tookPart(r, metric)) return null;
  const v = r[METRICS[metric].key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Which seasons the rows hold, newest first, which of them the server calls
 * current, and which to open on: the current one when it has figures, else the
 * latest that does (the Awards tab's rule, lib/seasonAwards.js, restated here
 * so this tab does not carry the rating package for it). A season with no
 * rows is never offered.
 * @param {any[]} rows  @returns {{ seasons: string[], current: string|null, open: string|null }}
 */
export function seasonChoice(rows) {
  const seasons = [...new Set(rows.map((r) => r?.season).filter((s) => typeof s === "string" && s))].sort((a, b) => b.localeCompare(a));
  const current = rows.find((r) => r?.currentSeason && r.season)?.season ?? null;
  return { seasons, current, open: current && seasons.includes(current) ? current : (seasons[0] ?? null) };
}

/**
 * The players in a side who have a season row, for the picker: most runs
 * across the seasons shown first, ties by name. One entry per player.
 * @param {any[]} rows  @param {string|null} team
 * @returns {{ id: string, name: string }[]}
 */
export function sidePlayers(rows, team) {
  const by = new Map();
  for (const r of rows) {
    if (!r || r.id == null || (team != null && r.team !== team)) continue;
    const e = by.get(r.id) ?? { id: r.id, name: r.name ?? "", runs: 0 };
    e.runs += Number.isFinite(r.runs) ? r.runs : 0;
    by.set(r.id, e);
  }
  return [...by.values()].sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name)).map(({ id, name }) => ({ id, name }));
}

/**
 * The player the chart is about. A picked player wins; with none picked, a
 * side the read shows only ONE player of (a pupil's own row, a parent's own
 * child) is that player; otherwise nobody, and the chart is the side's.
 * @param {string} picked  "" for nobody  @param {{ id: string }[]} players
 * @returns {string}
 */
export function whoIs(picked, players) {
  if (picked && players.some((p) => p.id === picked)) return picked;
  return players.length === 1 ? players[0].id : "";
}

/**
 * The side's leaders for one season: players with a figure above nought for
 * the metric, highest first, ties by name, at most `limit`.
 * @param {any[]} rows  asSeasonCareer() rows, every season
 * @param {{ team: string|null, season: string|null, metric: "runs"|"wkts", limit?: number }} o
 * @returns {{ bars: { id: string, name: string, v: number, row: any }[], eligible: number, rows: any[] }}
 *   `rows` are the season rows behind the bars, for the basis line.
 */
export function squadBars(rows, { team, season, metric, limit = SQUAD_LIMIT }) {
  const ranked = rows
    .filter((r) => r && r.season === season && (team == null || r.team === team))
    .map((r) => ({ id: r.id, name: r.name ?? "", v: figure(r, metric), row: r }))
    .filter((b) => b.v != null && b.v > 0)
    .sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
  const bars = ranked.slice(0, limit);
  return { bars, eligible: ranked.length, rows: bars.map((b) => b.row) };
}

/**
 * One player's seasons, oldest first (so the chart reads left to right in
 * time), the latest `SEASON_LIMIT` of them. A season he did not take part in
 * keeps its place with `v: null`.
 * @param {any[]} rows  @param {string} playerId  @param {"runs"|"wkts"} metric
 * @returns {{ bars: { season: string, v: number|null, current: boolean, row: any }[], rows: any[] }}
 */
export function playerBars(rows, playerId, metric) {
  const mine = rows
    .filter((r) => r && r.id === playerId && typeof r.season === "string" && r.season)
    .sort((a, b) => a.season.localeCompare(b.season))
    .slice(-SEASON_LIMIT);
  return { bars: mine.map((r) => ({ season: r.season, v: figure(r, metric), current: r.currentSeason === true, row: r })), rows: mine };
}

/**
 * The seasons a chart covers, in words: "The 2026 school season" for one,
 * "2024 to 2026 school seasons" for a span. Null with none.
 * @param {string[]} seasons
 */
export function seasonsWindow(seasons) {
  const s = [...new Set(seasons.filter(Boolean))].sort();
  if (!s.length) return null;
  if (s.length === 1) return seasonWindow(s[0]);
  return `${s[0]} to ${s[s.length - 1]} school seasons`;
}

/**
 * The basis for the chart's source line: what the bars are built from, as far
 * as the rows say. Runs stand on innings (`innings` is bat_matches), with the
 * balls faced beside it only when every one of those innings recorded its
 * balls; wickets stand on balls bowled. Null where there are no rows at all.
 * @param {any[]} rows  the season rows behind the bars  @param {"runs"|"wkts"} metric
 * @returns {{ n: number, unit: string, plural: string, detail?: string } | null}
 */
export function basisFor(rows, metric) {
  if (!rows.length) return null;
  if (metric === "wkts") {
    const n = rows.reduce((s, r) => s + (r.ballsBowled ?? 0), 0);
    return { n, unit: "ball bowled", plural: "balls bowled" };
  }
  const n = rows.reduce((s, r) => s + (r.innings ?? 0), 0);
  const known = rows.every((r) => typeof r.ballsFaced === "number");
  const balls = known ? rows.reduce((s, r) => s + r.ballsFaced, 0) : null;
  return { n, unit: "innings", plural: "innings", ...(balls != null ? { detail: `${balls} ball${balls === 1 ? "" : "s"} faced` } : null) };
}

/** Three demonstration seasons, newest last, and how much of a career each holds (sums to 1). */
const DEMO_SEASONS = Object.freeze([["2024", 0.2], ["2025", 0.35], ["2026", 0.45]]);

/**
 * THE DEMONSTRATION. Season rows in the shape asSeasonCareer() gives, split
 * out of the sample players' career totals, for the signed-out app only. A
 * sample player with no career runs has none to split. These rows are never
 * a school's and the view that draws them says "Demo" through StateLabel.
 * `live` is false: the source line then claims no source.
 * @param {{ id: string, name: string, team: string, school?: string, careerTotals?: { runs?: number, innings?: number }, wkts?: number }[]} players
 */
export function demoSeasonRows(players) {
  const rows = [];
  for (const p of players ?? []) {
    const runs = p.careerTotals?.runs ?? 0, innings = p.careerTotals?.innings ?? 0, wkts = p.wkts ?? 0;
    if (!runs && !wkts) continue;
    for (const [season, share] of DEMO_SEASONS) {
      rows.push({
        id: p.id, name: p.name, team: p.team, school: p.school ?? null, season, currentSeason: season === "2026",
        innings: Math.round(innings * share), runs: Math.round(runs * share), ballsFaced: null,
        ballsBowled: wkts ? Math.round(wkts * share * 24) : 0, wkts: Math.round(wkts * share),
        live: false,
      });
    }
  }
  return rows;
}
