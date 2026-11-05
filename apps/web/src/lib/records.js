/**
 * School record boards, as a screen says them (RECOGNITION R9;
 * docs/design/RECOGNITION_design.md D22–D25, §7's words).
 *
 * The boards are the server's: db/143 record_board() derives every board of
 * one side from the log on each read — the holder, joint holders, former
 * holders — and, for staff alone, this season's list ordered by the metric.
 * Nothing here ranks anybody or decides who holds a record: it groups the
 * rows the `record_boards` read returned and words them. A pupil's read
 * carries no season list at all (reader_view 'chronology'), so no code path
 * here can draw one for him.
 *
 * School Records is the headline group; Friendly sits under the filter with
 * its own label, never merged (D24). Format is part of every board: a T10
 * board and a T20 board are two boards.
 */
import { longDate } from "./family.js";

/** The class groups, the headline first (D24). */
export const GROUPS = Object.freeze([
  Object.freeze({ id: "school_records", label: "School Records" }),
  Object.freeze({ id: "friendly", label: "Friendly Records" }),
]);
export const groupLabel = (/** @type {string} */ id) => GROUPS.find((g) => g.id === id)?.label ?? id;

/** The metrics, in the order a board list draws them. */
export const METRICS = Object.freeze([
  Object.freeze({ id: "highest_innings", label: "Highest innings" }),
  Object.freeze({ id: "best_bowling", label: "Best bowling" }),
  Object.freeze({ id: "best_strike_rate", label: "Best strike rate" }),
  Object.freeze({ id: "best_economy", label: "Best economy" }),
]);
export const metricLabel = (/** @type {string} */ m) => METRICS.find((x) => x.id === m)?.label ?? m;

/** The minimum's unit, said with the board (spec §5.2). */
const UNIT = Object.freeze({ best_strike_rate: "balls faced", best_economy: "balls bowled" });

/** "Mon YYYY" of an ISO date, for the coverage line. */
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthYear(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The figure a line shows, in cricket's words: "87*" for an innings (a
 * not-out said, not hidden), "3/18" for a spell, "87 off 15" for a strike
 * rate (its rate beside it), "10 off 6 balls" for an economy (per over).
 * Rates are computed for display only; the comparison was the server's.
 */
export function figureOf(r) {
  if (!r) return "";
  switch (r.metric) {
    case "highest_innings": return `${r.runs ?? 0}${r.notOut ? "*" : ""}`;
    case "best_bowling": return `${r.wickets ?? 0}/${r.conceded ?? 0}`;
    case "best_strike_rate": {
      const sr = r.balls > 0 ? ((r.runs * 100) / r.balls).toFixed(1) : "–";
      return `${r.runs ?? 0}${r.notOut ? "*" : ""} off ${r.balls ?? 0} · strike rate ${sr}`;
    }
    case "best_economy": {
      const ec = r.balls > 0 ? ((r.conceded * 6) / r.balls).toFixed(2) : "–";
      return `${r.conceded ?? 0} off ${r.balls ?? 0} balls · ${ec} an over`;
    }
    default: return "";
  }
}

/** "v Kearsney, 12 Sep 2026". */
export const whereWords = (r) => [r?.opponent ? `v ${r.opponent}` : null, longDate(r?.on)].filter(Boolean).join(", ");

/**
 * The boards of one group, each with its lines: one entry per metric and
 * format, in METRICS order, then format.
 * @param {any[]} rows   asRecordLine() rows of one side
 * @param {string} group a GROUPS id
 */
export function boardsOf(rows, group) {
  /** @type {Map<string, any>} */
  const boards = new Map();
  const key = (r) => `${r.metric}|${r.format ?? ""}`;
  for (const r of rows ?? []) {
    if (r?.group !== group || r.line !== "board") continue;
    boards.set(key(r), { metric: r.metric, format: r.format ?? "", state: r.state, minBalls: r.minBalls,
                         since: r.since, awaiting: r.awaiting ?? 0, holders: [], formers: [], season: [] });
  }
  for (const r of rows ?? []) {
    if (r?.group !== group || r.line === "board") continue;
    const b = boards.get(key(r));
    if (!b) continue;
    if (r.line === "holder") b.holders.push(r);
    else if (r.line === "former") b.formers.push(r);
    else if (r.line === "season") b.season.push(r);
  }
  const order = (m) => METRICS.findIndex((x) => x.id === m);
  return [...boards.values()].sort((a, b) => order(a.metric) - order(b.metric) || a.format.localeCompare(b.format));
}

/** The groups that hold a board, headline first. */
export const groupsHeld = (rows) => GROUPS.map((g) => g.id).filter((g) => (rows ?? []).some((r) => r?.group === g && r.line === "board"));

/** 'full' (staff) or 'chronology' (a pupil), as the server said; null for no rows. */
export const viewOf = (rows) => (rows ?? []).find((r) => r?.view)?.view ?? null;

/**
 * The words a board says when it holds no record — the spec's empty states
 * (§10), none of which looks like a record — or null when one stands.
 */
export function boardEmptyWords(b) {
  if (!b) return null;
  if (b.state === "no_minimum") return "Off until the school publishes a minimum number of balls for it.";
  if (b.state === "awaiting") return "Awaiting verification: the scorer has not sealed these matches yet.";
  if (b.state === "not_enough") {
    return b.minBalls ? `Not enough eligible data yet: nobody has reached the minimum of ${b.minBalls} ${UNIT[b.metric] ?? "balls"}.`
                      : "Not enough eligible data yet.";
  }
  return null;
}

/** "Highest innings · U15A · T20 · School Records". */
export const boardTitle = (b, side, group) => [metricLabel(b.metric), side, b.format, groupLabel(group)].filter(Boolean).join(" · ");

/** "In verified SCRBRD matches since Oct 2026." — the bounded coverage (spec §5.5). */
export function coverageWords(b) {
  const since = monthYear(b?.since);
  const min = b?.minBalls ? ` Minimum ${b.minBalls} ${UNIT[b.metric] ?? "balls"}.` : "";
  return `In verified SCRBRD matches${since ? ` since ${since}` : ""}. Earlier matches are not counted.${min}`;
}

/** The empty state for a whole side with no board at all. */
export const NO_BOARDS = "No records yet. A record appears once a match of this side is verified.";
