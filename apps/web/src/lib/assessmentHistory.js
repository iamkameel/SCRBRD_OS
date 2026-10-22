/**
 * A boy's assessment history, drawn (GA-I26a §4, AH-D4). Pure: the screens in
 * views/skills/History.jsx hold the markup, this holds every decision about
 * which figure, which date and which word, so apps/web/test/skillsHistory.test.mjs
 * can hold them without a browser.
 *
 * THE WORDS ARE THE RULE. A falling line drawn to a fourteen-year-old with
 * "declining" beside it is a verdict; the same line with its dates and "rated 11
 * on 14 Sep by your coach" is his record (§3.3). So a direction is said as two
 * figures and two dates, never as a word, and nothing here writes "improving",
 * "declining", "stalled", "plateau", "form", "rank", "percentile", "missed",
 * "absent" or "injured". "Not rated" is never a zero and never a default.
 *
 * Nothing here decides who may read what. The reads are RLS's: a reader who
 * may not read a boy's scores is sent no rows, and the screen draws what it was
 * sent. A copy of the reader rules in this file would be a second opinion that
 * drifts from the one that runs.
 */
import { SCALE_MIN, SCALE_MAX, DISCIPLINES } from "@scrbrd/scoring";
import { radarLabelOf } from "./radar.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-14" (or a longer ISO string) as "14 Sep"; nothing for a value that is no date. @param {unknown} v */
export function shortDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : "";
}

/** "lineAndLength" as "line and length". @param {string} metric */
export function metricWords(metric) { return radarLabelOf(metric).toLowerCase(); }

const cap = (/** @type {string} */ s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Who gave a score, in the words the reader gets: "R Pillay, coach" to staff,
 * "your coach" to the boy. The author's name is on the coach table the side
 * reads anyway, so the choice is words, not disclosure.
 * @param {string | null | undefined} by  @param {boolean} staff
 */
export function byWords(by, staff) {
  if (!staff) return "your coach";
  return by ? `${by}, coach` : "a coach";
}

/**
 * One metric's points, oldest first: every row `skills_history` returned for
 * it, withdrawn ones kept (they are drawn struck, not dropped).
 * @param {any[]} rows  asSkillPoint rows for one boy
 * @param {string} category  @param {string} metric
 */
export function pointsFor(rows, category, metric) {
  return (rows ?? [])
    .filter((r) => r.category === category && r.metric === metric && Number.isFinite(r.score))
    .sort((a, b) => (a.assessedOn < b.assessedOn ? -1 : a.assessedOn > b.assessedOn ? 1 : String(a.id).localeCompare(String(b.id))));
}

/** The newest standing (not withdrawn) point, or null: where he stands. @param {any[]} points */
export function standingPoint(points) {
  for (let i = points.length - 1; i >= 0; i--) if (!points[i].withdrawn) return points[i];
  return null;
}

/** The pixel width one point is given, so a dot's 44px hit area never overlaps its neighbour's. */
export const CELL = 44;
/** 44px of dot above and below the 1 and the 20, so a hit area is never clipped by the strip's scroll box. */
export const STRIP_HEIGHT = 88;
const PAD = 22;

/** Where a score sits on the strip's 1 to 20 axis (20 at the top). @param {number} score @param {number} [h] */
export function yOf(score, h = STRIP_HEIGHT) {
  const t = (Math.min(SCALE_MAX, Math.max(SCALE_MIN, score)) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  return Math.round((PAD + (1 - t) * (h - 2 * PAD)) * 100) / 100;
}

/**
 * The strip's geometry. Points are spaced evenly in the order they were
 * given, one cell each, with the date under each: a point is a look, and the
 * gaps between looks are not a quantity the strip should seem to measure.
 * The hairline joins the standing points only; a withdrawn one is hollow and
 * off the line.
 * @param {any[]} points
 */
export function stripLayout(points) {
  const dots = points.map((p, i) => ({ ...p, x: i * CELL + CELL / 2, y: yOf(p.score) }));
  const line = dots.filter((d) => !d.withdrawn).map((d) => `${d.x},${d.y}`).join(" ");
  const newest = standingPoint(points);
  return { width: Math.max(1, dots.length) * CELL, height: STRIP_HEIGHT, dots, line, newestId: newest?.id ?? null };
}

/**
 * The strip's one sentence for a screen reader and for the eye that skips the
 * dots: the figures and dates, nothing about their direction. "9 on 14 Mar,
 * then 11 on 14 Sep." Withdrawn scores are named as withdrawn, not counted.
 * @param {any[]} points
 */
export function stripSummary(points) {
  const standing = points.filter((p) => !p.withdrawn);
  if (!standing.length) return "No standing score.";
  const parts = standing.map((p) => `${p.score} on ${shortDate(p.assessedOn)}`);
  const gone = points.length - standing.length;
  return `${parts.join(", then ")}.${gone ? ` ${gone} withdrawn.` : ""}`;
}

/** One dot's label: the score, the date, who gave it, and that it was withdrawn. @param {any} p @param {boolean} staff */
export function dotWords(p, staff) {
  const base = `${p.score} on ${shortDate(p.assessedOn)}, rated by ${byWords(p.by, staff)}`;
  return p.withdrawn ? `${base}, withdrawn` : base;
}

/**
 * The open targets as { metric: target } for one category: what the
 * focus-areas card (lib/focusAreas.js) was always shaped to receive and had no
 * read to fill it from. A withdrawn target is no target.
 * @param {any[]} targets  asTarget rows  @param {string} category
 * @returns {Record<string, number>}
 */
export function savedTargets(targets, category) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const t of targets ?? []) if (!t.withdrawn && t.category === category && Number.isInteger(t.target)) out[t.metric] = t.target;
  return out;
}

/** The open target on one metric, or null. @param {any[]} targets @param {string} category @param {string} metric */
export function openTargetOn(targets, category, metric) {
  return (targets ?? []).find((t) => !t.withdrawn && t.category === category && t.metric === metric) ?? null;
}

/**
 * A target, said. "target 12 · by 30 Nov · set 14 Sep · drill: Throw-downs",
 * and once the server says he reached it, "reached 11 Oct" with the target
 * struck. A target is never closed or raised by the screen; reached-then-rated-
 * lower says both, and neither is a verdict (§1.2).
 * @param {any} t  asTarget row
 * @returns {{ text: string, reached: boolean, struck: string | null, note: string | null }}
 */
export function targetWords(t) {
  const bits = [`target ${t.target}`];
  if (t.dueOn) bits.push(`by ${shortDate(t.dueOn)}`);
  if (t.setOn) bits.push(`set ${shortDate(t.setOn)}`);
  if (t.drillName) bits.push(`drill: ${t.drillName}`);
  const reached = !!t.reachedOn;
  let note = null;
  if (reached) {
    note = `reached ${shortDate(t.reachedOn)}`;
    if (Number.isFinite(t.latest) && t.latest < t.target && t.latestOn) {
      note += `, then rated ${t.latest} on ${shortDate(t.latestOn)}`;
    }
  }
  if (t.fromWithdrawn) note = `${note ? note + " · " : ""}stood on a withdrawn score`;
  return { text: bits.join(" · "), reached, struck: reached ? `target ${t.target}` : null, note };
}

/**
 * Whether a target may be set: above where he stands. The server refuses at or
 * below (`already_there`) and says so; this says it before the round trip.
 * @param {unknown} value  @param {number | null} standing
 */
export function targetProblem(value, standing) {
  const n = Number(value);
  if (value === "" || value == null || !Number.isInteger(n)) return "Pick a whole number from 2 to 20.";
  if (n < 2 || n > SCALE_MAX) return "Pick a whole number from 2 to 20.";
  if (Number.isFinite(standing) && n <= /** @type {number} */ (standing)) return "already there";
  return null;
}

/**
 * Drills for a target's picker: those that suit the attribute first, then the
 * rest, each group in the library's order. The map only ORDERS; it never
 * refuses a drill (a coach who wants a fielding drill for a batter's
 * concentration is coaching, not mistyping).
 * @param {any[]} drills  @param {Set<string> | string[]} suits  drill categories that suit the attribute
 */
export function orderDrills(drills, suits) {
  const set = new Set(suits);
  const suit = [], rest = [];
  for (const d of drills ?? []) (set.has(String(d.category).toLowerCase()) ? suit : rest).push(d);
  return { suit, rest };
}

/** "throw-downs ×4": a drill and how many sessions ran it. @param {{ name: string, times: number }} d */
export function drillTimes(d) { return `${d.name} ×${d.times}`; }

/**
 * "Since the last look" for one discipline (§4.2), in the design's order and
 * words. It counts what he ATTENDED and never what he did not (GA-I24-I25 D8):
 * no absence figure, no "missed". A session with no register says "no register
 * taken", not a zero. A boy with no assessment in the discipline gets one line.
 *
 * @param {any} row  asSince row for one discipline
 * @param {{ name: string, team: string, self: boolean, author: string | null }} ctx
 *   `self`: the reader is the boy; `author`: byWords() of the look's assessor
 * @returns {{ title: string, lines: string[], footer: string | null }}
 */
export function sinceWords(row, ctx) {
  const disc = cap(row.discipline);
  if (!row.anchor) return { title: disc, lines: [`Not yet rated for ${row.discipline}.`], footer: null };
  const were = ctx.self ? "you were" : `${ctx.name} was`;
  const he = ctx.self ? "you were" : "he was";
  const title = `${disc} · last looked ${shortDate(row.anchor)}${ctx.author ? ` (${ctx.author})` : ""}`;
  /** @type {string[]} */
  const lines = [];
  const n = row.sessions ?? 0;
  if (n === 0) {
    lines.push(`${ctx.team} held no sessions since then.`);
  } else {
    lines.push(`Since then ${ctx.team} held ${n} session${n === 1 ? "" : "s"}.`);
    const reg = row.registered ?? 0;
    if (reg === 0) {
      lines.push("No register was taken at them.");
    } else {
      const late = row.late ? `, late at ${row.late}` : "";
      lines.push(`${cap(were)} marked present at ${row.present ?? 0}${late}${reg < n ? ` (a register was taken at ${reg} of ${n})` : ""}.`);
    }
    lines.push(row.drills?.length ? `Drills on those sessions: ${row.drills.map(drillTimes).join(", ")}.` : "No drills were planned on them.");
  }
  for (const t of row.targets ?? []) {
    const head = `Target: ${metricWords(t.metric)} ${t.target}${t.dueOn ? ` by ${shortDate(t.dueOn)}` : ""}, set ${shortDate(t.setOn)}`;
    lines.push(t.drillName
      ? `${head} — the drill for it, ${t.drillName}, ran ${t.drillRan} time${t.drillRan === 1 ? "" : "s"}; ${he} there for ${t.drillAttended}.`
      : `${head} — no drill chosen.`);
  }
  const footer = `From the training sessions, the register and the plan; ${ctx.team}, ${shortDate(row.windowFrom ?? row.anchor)} to today.`;
  return { title, lines, footer };
}

/**
 * Which look a discipline stands on and who gave it: the newest standing
 * score among the discipline's attributes, so the panel can say "(your coach)".
 * @param {any[]} rows  asSkillPoint rows for one boy  @param {string} discipline
 */
export function lastLookBy(rows, discipline) {
  const attrs = new Set(/** @type {Record<string, readonly string[]>} */ (DISCIPLINES)[discipline] ?? []);
  let best = null;
  for (const r of rows ?? []) {
    if (r.withdrawn || !attrs.has(`${r.category}.${r.metric}`)) continue;
    if (!best || r.assessedOn > best.assessedOn) best = r;
  }
  return best?.by ?? null;
}

/**
 * The register's four words, in the order a coach taps through them
 * (GA-I26a §1.4, AH-D9). There is no fifth: `injured` is a health word on a
 * list the side reads, and the route refuses it.
 */
export const REGISTER_STATES = Object.freeze(["present", "late", "excused", "absent"]);
