/**
 * Personal bests, as a screen says them (RECOGNITION R5;
 * docs/design/RECOGNITION_design.md D22–D24, §7's words).
 *
 * The figures are the server's: db/141 player_best() derives every best from
 * the log and marks it, per class group, format and the side he played for.
 * Nothing here ranks a boy or compares him with anybody: it groups the rows
 * the `personal_bests` read returned for ONE boy and words them. A tie is all
 * of its dates. A row still awaiting the scorer's seal is never a best; it is
 * counted, so the card can say "awaiting verification".
 *
 * School Records is the headline group; Friendly sits under the filter with
 * its own label, never merged with it (D24).
 */
import { longDate } from "./family.js";

/** The class groups, the headline first (D24). */
export const GROUPS = Object.freeze([
  Object.freeze({ id: "school_records", label: "School Records" }),
  Object.freeze({ id: "friendly", label: "Friendly" }),
]);
export const groupLabel = (/** @type {string} */ id) => GROUPS.find((g) => g.id === id)?.label ?? id;

/** "63*" for an innings (a not-out said, not hidden), "3/18" for a spell. */
export function figureOf(r) {
  if (!r) return "";
  return r.metric === "batting" ? `${r.runs ?? 0}${r.notOut ? "*" : ""}` : `${r.wickets ?? 0}/${r.conceded ?? 0}`;
}

const METRIC = Object.freeze({ batting: "Highest innings", bowling: "Best bowling" });
export const metricLabel = (/** @type {string} */ m) => METRIC[m] ?? m;

/**
 * The best lines of one group: one per metric, format and side, with every
 * date a tie holds. Batting first, then bowling; then format and side.
 * @param {any[]} rows   asPersonalBest() rows for one boy
 * @param {string} group a GROUPS id
 */
export function bestLines(rows, group) {
  /** @type {Map<string, { metric: string, format: string, side: string, figure: string, at: { opponent: string, on: string | null }[] }>} */
  const lines = new Map();
  for (const r of rows ?? []) {
    if (!r?.best || !r.verified || r.group !== group) continue;
    const key = `${r.metric}|${r.format ?? ""}|${r.side ?? ""}`;
    const line = lines.get(key) ?? { metric: r.metric, format: r.format ?? "", side: r.side ?? "", figure: figureOf(r), at: [] };
    line.at.push({ opponent: r.opponent ?? "", on: r.on ?? null });
    lines.set(key, line);
  }
  const order = (m) => (m === "batting" ? 0 : 1);
  return [...lines.values()]
    .map((l) => ({ ...l, at: l.at.sort((a, b) => String(a.on).localeCompare(String(b.on))) }))
    .sort((a, b) => order(a.metric) - order(b.metric) || a.format.localeCompare(b.format) || a.side.localeCompare(b.side));
}

/** "v DHS, 12 Sep 2026", each date of a tie joined by "and". */
export function whereWords(at) {
  return (at ?? []).map((x) => [x.opponent ? `v ${x.opponent}` : null, longDate(x.on)].filter(Boolean).join(", ")).join(" and ");
}

/** The matches of his still awaiting the scorer's seal. */
export const awaitingCount = (rows) => new Set((rows ?? []).filter((r) => r && !r.verified).map((r) => r.matchId)).size;

/** The groups that hold a best, in GROUPS order. */
export const groupsHeld = (rows) => GROUPS.filter((g) => (rows ?? []).some((r) => r?.best && r.verified && r.group === g.id)).map((g) => g.id);

/**
 * The headline sentence for a group: his highest innings in it, else his best
 * bowling. "Your best: 63* v DHS · School Records" (§7), or the boy's name for
 * his parent. Null when the group holds nothing.
 * @param {any[]} rows @param {string} group @param {string} who  "Your" or "Rohan's"
 */
export function headline(rows, group, who) {
  const lines = bestLines(rows, group);
  const top = lines.filter((l) => l.metric === "batting")
    .sort((a, b) => parseInt(b.figure, 10) - parseInt(a.figure, 10))[0] ?? lines[0];
  if (!top) return null;
  const v = top.at[0]?.opponent ? ` v ${top.at[0].opponent}` : "";
  return `${who} best: ${top.figure}${v} · ${groupLabel(group)}`;
}

/** The month of his first verified best, for the coverage label: "Oct 2026". */
export function coverageSince(rows) {
  const first = (rows ?? []).filter((r) => r?.verified && r.on).map((r) => r.on).sort()[0];
  if (!first) return null;
  const words = longDate(first);
  return words ? words.split(" ").slice(1).join(" ") : null;
}

/**
 * Which of the spec's empty states the group is in, or null when it holds a
 * best (D24): `none` (no innings of his at all), `awaiting` (only innings the
 * scorer has not sealed), `not_enough` (nothing in this group, though another
 * holds a best).
 */
export function emptyState(rows, group) {
  if (groupsHeld(rows).includes(group)) return null;
  if (!(rows ?? []).length) return "none";
  if (awaitingCount(rows) > 0 && !groupsHeld(rows).length) return "awaiting";
  return "not_enough";
}
