/**
 * Two players side by side (GA-I24-I25 S1; docs/design/GA-I24-I25_compare_and_combine.md).
 *
 * Pure: the screens in views/compare.jsx draw what these return and compute
 * nothing of their own. A comparison is two reads, never a new one (D1): the
 * figures are the `career`, `career_by_season`, `matchups` and
 * `matchup_coverage` rows the reader already opens on Profiles, placed in two
 * columns. What this file adds is only what side by side needs and a profile
 * does not:
 *
 *   - THE FLOOR (D4, Q8). A profile is a record; a comparison is a judgement.
 *     A rate (average, strike rate, economy) is drawn only on thirty legal
 *     balls or more; below that, an em dash and the evidence word. The count
 *     is always drawn, so nothing is hidden, only not divided. The words are
 *     evidenceLabel()'s (packages/scoring, the same thresholds as db/08's
 *     evidence_label()): none, insufficient, low, moderate, high. One scale,
 *     so a coach reads the dossier's words here too.
 *   - THE COLUMNS (D5, §4). A component holds only the fields named in
 *     COMPARE_FIELDS. Skills, ratings, notes, workload, health, availability,
 *     age and discipline are not among them and a test pins the list.
 *   - WHO MAY BE PICKED (D2, D10, D13, Q6). Only a player the reader may open
 *     today, under the assignment that carries Compare: a coach's own sides,
 *     an analyst's school; a pupil's own side, himself on the left. A boy with
 *     no current side (he has left) is in no picker.
 *   - NO VERDICT (D3). Nothing here ranks, differences or colours: there is no
 *     "better", no arrow, no composite.
 *   - NO ABSENCE (D8). A season is offered only where BOTH players have
 *     figures in it, so no season is ever drawn as a gap in one column.
 *   - TYPES ONLY (D7). Match-ups fold by pace and spin (lib/captain.js, the
 *     captain's view's own fold, 138 D8); no bowler is named.
 *
 * Nothing here stores anything (D9). The screen re-reads on every open.
 */
import { evidenceLabel } from "@scrbrd/scoring";
import { roleGrants } from "@scrbrd/policy/roles";
import { matchupTypes } from "./captain.js";

/** Legal balls a rate needs before it is drawn in a comparison (D4; db/08 evidence_label(), opposition_squad()). */
export const COMPARE_FLOOR = 30;

/** The capabilities Compare is drawn under, on Analytics (D13) and for the figures in it (D2). */
export const COMPARE_CAPS = Object.freeze(["analytics.read", "player.performance.read"]);

/**
 * Every field a compare component reads from a career or season row, and no
 * other. `asCareer`/`asSeasonCareer` (lib/live.js) carry a form guide and a
 * few scorebook counts besides; projecting through this list keeps them, and
 * anything a read might ever add, out of the component's hands.
 */
export const COMPARE_FIELDS = Object.freeze([
  "id", "name", "team", "school",
  "innings", "runs", "ballsFaced", "dismissals", "avg", "sr", "fours", "sixes",
  "wkts", "ballsBowled", "runsConceded", "econ",
  "season", "currentSeason",
]);

/**
 * What never reaches a comparison (D5, §4 items 2 and 3), as field names in
 * the shapes the reads and adapters use. The test holds COMPARE_FIELDS apart
 * from every one, and the walk holds the page apart from their values.
 */
export const NEVER_COMPARED = Object.freeze([
  "score", "skills", "rating", "ratings", "notes", "note", "body", "coachingPoint", "targets",
  "fitness", "injury", "injuries", "medical", "rtw", "workload", "load", "acwr", "wellness",
  "availability", "reason", "born", "dob", "dateOfBirth", "age", "ageBand", "age_band",
  "discipline", "matter", "conduct", "address", "guardian", "idNumber", "id_number",
  "height", "weight",
]);

/** A row cut down to COMPARE_FIELDS. @param {Record<string, any> | null | undefined} row */
export function project(row) {
  if (!row) return null;
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of COMPARE_FIELDS) if (k in row) out[k] = row[k];
  return out;
}

/**
 * The evidence word for a count of legal balls. A count the scorebook did not
 * record (null) is "balls not recorded", the dossier's sixth state, which is
 * not "none": there is a record, and no ball to rate it on (SCRBRD-120 D12).
 * @param {number | null | undefined} balls
 */
export function evidenceWord(balls) {
  if (balls == null) return "balls not recorded";
  return evidenceLabel(Number(balls));
}

/**
 * A rate, or the reason it is not drawn.
 * @param {number | null | undefined} value  the derived rate the adapter already computed
 * @param {number | null | undefined} balls  the legal balls it rests on
 * @param {number} [digits]
 * @returns {{ text: string, word: string | null, held: boolean }}  held: withheld by the floor
 */
export function floorRate(value, balls, digits = 2) {
  const n = balls == null ? null : Number(balls);
  if (n == null || n < COMPARE_FLOOR) return { text: "—", word: evidenceWord(balls), held: true };
  if (value == null || !Number.isFinite(Number(value))) return { text: "—", word: null, held: false };
  return { text: Number(value).toFixed(digits), word: null, held: false };
}

/** A count, always drawn: the figure and, for a ball count, its evidence word. */
const count = (v) => ({ text: v == null ? "—" : String(v), word: null, held: false });
const balls = (v) => ({ text: v == null ? "—" : String(v), word: evidenceWord(v), held: false });

/**
 * The batting rows: label between two cells. `held` on a rate cell says the
 * floor withheld it; `basis` on the panel is the two ball counts.
 * @param {Record<string, any> | null} a  @param {Record<string, any> | null} b
 */
export function battingRows(a, b) {
  const both = (f) => ({ a: f(a ?? {}), b: f(b ?? {}) });
  // Null is a scorebook innings with no balls column (asCareer keeps it null);
  // absent is a player with no batting row at all, who faced none.
  const bf = (r) => (r.ballsFaced === undefined ? 0 : r.ballsFaced);
  return [
    { key: "innings", label: "Innings", ...both((r) => count(r.innings ?? 0)) },
    { key: "runs", label: "Runs", ...both((r) => count(r.runs ?? 0)) },
    { key: "balls", label: "Balls faced", ...both((r) => balls(bf(r))) },
    { key: "outs", label: "Times out", ...both((r) => count(r.dismissals ?? 0)) },
    { key: "avg", label: "Average", ...both((r) => floorRate(r.avg, bf(r))) },
    { key: "sr", label: "Strike rate", ...both((r) => floorRate(r.sr, bf(r), 1)) },
    { key: "fours", label: "Fours", ...both((r) => count(r.fours)) },
    { key: "sixes", label: "Sixes", ...both((r) => count(r.sixes)) },
  ];
}

/** The bowling rows. @param {Record<string, any> | null} a  @param {Record<string, any> | null} b */
export function bowlingRows(a, b) {
  const both = (f) => ({ a: f(a ?? {}), b: f(b ?? {}) });
  return [
    { key: "balls", label: "Balls bowled", ...both((r) => balls(r.ballsBowled ?? 0)) },
    { key: "conceded", label: "Runs conceded", ...both((r) => count(r.runsConceded ?? 0)) },
    { key: "wkts", label: "Wickets", ...both((r) => count(r.wkts ?? 0)) },
    { key: "econ", label: "Economy", ...both((r) => floorRate(r.econ, r.ballsBowled ?? 0)) },
  ];
}

/**
 * Which of two players is below the floor for a panel, by name, for the
 * panel's "not enough balls to compare" line. Empty when both clear it.
 * @param {{name: string, n: number | null}[]} sides
 */
export function belowFloor(sides) {
  return sides.filter((s) => s.n == null || s.n < COMPARE_FLOOR);
}

/**
 * The scopes Compare may pick within, from the session's assignments: each
 * assignment whose role carries both COMPARE_CAPS, as {school, team} (null =
 * every). Presentation only, as lib/held.js is: the reads are authorised again
 * by the server, and this only narrows what a picker offers to what the
 * reader holds Compare over, so a coach's other-side boys (whom the career
 * read returns in outline) and a director's own child at another school
 * (readable as her child, not as her school's) are not offered (D2, D11).
 * @param {{role: string, school?: string | null, team?: string | null}[]} assignments
 */
export function compareScopes(assignments) {
  return (assignments ?? [])
    .filter((a) => COMPARE_CAPS.every((c) => roleGrants(a.role, c)))
    .map((a) => ({ school: a.school ?? null, team: a.team ?? null }));
}

/**
 * The players a staff picker offers: career rows the reader may open, inside
 * a Compare scope, with a current side (Q6: a boy who has left is in no
 * picker). Grouped by side for the picker, sides in the order given first.
 * @param {Record<string, any>[]} rows  career rows (asCareer)
 * @param {{school: string | null, team: string | null}[]} scopes
 */
export function pickable(rows, scopes) {
  return (rows ?? [])
    .filter((r) => r?.id && r.team)
    .filter((r) => scopes.some((s) => (s.school == null || s.school === r.school) && (s.team == null || s.team === r.team)))
    .map(project)
    .sort((x, y) => String(x.team).localeCompare(String(y.team)) || String(x.name).localeCompare(String(y.name)));
}

/**
 * A pupil's picker (D10, Q1): team-mates on his own current side, never
 * himself. He is the left column and there is only one picker, so two
 * team-mates are never placed against each other.
 * @param {Record<string, any>[]} rows  @param {{id: string, team: string | null, school?: string | null}} me
 */
export function teamMates(rows, me) {
  if (!me?.team) return [];
  return (rows ?? [])
    .filter((r) => r?.id && r.id !== me.id && r.team === me.team && (me.school == null || r.school === me.school))
    .map(project)
    .sort((x, y) => String(x.name).localeCompare(String(y.name)));
}

/** The picker's groups: [team, players][], in team order. @param {Record<string, any>[]} players */
export function bySide(players) {
  /** @type {Map<string, Record<string, any>[]>} */
  const m = new Map();
  for (const p of players) (m.get(p.team) ?? m.set(p.team, []).get(p.team)).push(p);
  return [...m.entries()];
}

/**
 * The seasons both players have figures in, newest first (D8: a season only
 * one of them played is not offered, so no column is ever drawn as a gap).
 * @param {Record<string, any>[]} seasonRows  career_by_season rows (asSeasonCareer)
 * @param {string} aId  @param {string} bId
 */
export function sharedSeasons(seasonRows, aId, bId) {
  const of = (id) => new Set((seasonRows ?? []).filter((r) => r.id === id && r.season).map((r) => r.season));
  const a = of(aId), b = of(bId);
  return [...a].filter((s) => b.has(s)).sort((x, y) => String(y).localeCompare(String(x)));
}

/** One player's row for a season, projected. */
export function seasonRow(seasonRows, id, season) {
  return project((seasonRows ?? []).find((r) => r.id === id && r.season === season) ?? null);
}

/**
 * Match-ups by bowling type, the two batters side by side: one row per type
 * either of them has faced, pace before spin. Types only (D7): the fold
 * drops every bowler's name. A type one of them has not faced reads 0 balls,
 * "none", which is what he faced, not a gap.
 * @param {Record<string, any>[]} rowsA  matchups rows for batter A (asMatchup)
 * @param {Record<string, any>[]} rowsB
 */
export function typeRows(rowsA, rowsB) {
  const a = Object.fromEntries(matchupTypes(rowsA).map((t) => [t.type, t]));
  const b = Object.fromEntries(matchupTypes(rowsB).map((t) => [t.type, t]));
  const cell = (t) => {
    const n = t?.balls ?? 0;
    const sr = n ? Math.round(((t.runs * 100) / n) * 10) / 10 : null;
    return { balls: balls(n), runs: count(t?.runs ?? 0), out: count(t?.out ?? 0), sr: floorRate(sr, n, 1) };
  };
  return ["pace", "spin"].filter((k) => a[k] || b[k])
    .map((k) => ({ type: k, label: k === "pace" ? "Against pace" : "Against spin", a: cell(a[k]), b: cell(b[k]) }));
}

/** "As at 14:32 on 16 Oct 2026", from the time the reads answered (D14). @param {Date | null} t */
export function asAtWords(t) {
  if (!t) return null;
  const time = t.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  const day = t.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  return `As at ${time} on ${day}`;
}
