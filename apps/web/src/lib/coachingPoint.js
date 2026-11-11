/**
 * THE COACHING POINT (GA-I27 slice 2, C4; GA-I26a AH-D2, slice A4): one boy,
 * one sentence, one pointer to what it stood on. Stored as a development_note
 * with its evidence (db/104, `coaching_point_write()`), written on the boy's
 * development panel (the Skills screen), and drawn in two places: that panel,
 * and the coach's drawer as S13 when it names this fixture.
 *
 * WHO READS IT is the note's own policy, player.note.read: the coach, the
 * assistant coach, the director of sport and the principal (GA-I26a AH-D3).
 * Never the boy himself, his parents, a team-mate or captain, the team
 * manager, the analyst, the physio, the scorer or the office (GA-I27 C-D4,
 * §3.3 item 7). Nothing here decides that: the server sends a reader who may
 * not read a point no row, and the screens ask for the read only where the
 * reader holds the capability. WHO WRITES IT is player.development.write and
 * player.note.write together, which the function checks again.
 *
 * WHAT IT STOOD ON, AND NOW (C-D5, §4.2): the pointer is kept as written and
 * never overwritten. On open the same figure is derived again from today's
 * reads under the reader's own gate; where it differs, both are drawn,
 * "stood on" and "now", and "corrected" only where the difference can only
 * be a correction (fewer balls than it stood on, or the same balls with other
 * figures: play only ever adds balls).
 *
 * Pure: no DOM, no clock of its own, no read (apps/web/test/coachingPoint.test.mjs).
 */
import { NEVER_ON_THE_COCKPIT } from "./cockpitNever.js";
import { matchupFigures, matchupLine, matchupTypes } from "./captain.js";
import { clockWords } from "./corrections.js";
import { metricWords, shortDate } from "./assessmentHistory.js";

/** The point's sentence (GA-I27 §5.3; the column's CHECK). */
export const POINT_MAX = 500;

/** The cards a point may stand on (C-D7), of those this slice builds a door from: S5. A score on the strip is the other. */
export const POINT_RULES = Object.freeze(["S5"]);

// ── The pointer, from where the coach asked for it ──────

/**
 * A pointer from an S5 card in the drawer: the card's lines are kept (C-D4:
 * S5's capability is the reader's own), its read, the boy and the type, and
 * when its read answered (the drawer's "as at"; the moment he saw it when the
 * card has none). The fixture is the one the drawer is about.
 * @param {{rule: string, lines: string[], evidence?: {params?: Record<string, any>, asOf?: number | null}}} card
 * @param {string | null} matchId  @param {number} now
 */
export function pointerOfCard(card, matchId, now) {
  if (!card || !POINT_RULES.includes(card.rule)) return null;
  const params = card.evidence?.params ?? {};
  if (!params.playerId || !params.type) return null;
  const asOf = Number.isFinite(card.evidence?.asOf) ? /** @type {number} */ (card.evidence?.asOf) : now;
  return {
    playerId: String(params.playerId), matchId: matchId ?? null, line: card.lines[0] ?? "", asOf,
    evidence: { rule: card.rule, read: "matchups", params: { playerId: String(params.playerId), type: String(params.type) },
      asOf: new Date(asOf).toISOString(), text: card.lines.filter(Boolean) },
  };
}

/**
 * A pointer from a dot on the strip: the score row itself. Its as-of is the
 * day it was given, which the function sets from the row.
 * @param {{id: string, playerId?: string, metric: string, score: number, assessedOn: string, withdrawn?: boolean}} point
 * @param {string} playerId
 */
export function pointerOfScore(point, playerId) {
  if (!point || point.withdrawn || !point.id) return null;
  return { playerId, matchId: null, line: `${metricWords(point.metric)} ${point.score} · ${shortDate(point.assessedOn)}`, asOf: null,
    evidence: { read: "skills", params: { skillId: point.id } } };
}

/** The pointer above the field (§5.3): the card's collapsed line and "as at". @param {{line: string, asOf: number | null}} p @param {number} now */
export function pointerWords(p, now) {
  return [p.line, p.asOf != null ? `as at ${clockWords(p.asOf, now)}` : null].filter(Boolean).join(" · ");
}

// ── The words the field refuses (client first; the function holds) ──

/**
 * Why a sentence will not be saved, or null. A cockpit never-word, or another
 * boy named in full (an initial and a surname: a name with a space in it), as
 * coaching_point_write() refuses them. `others` is the names the screen holds:
 * the side's players beside him.
 * @param {string} body  @param {string[]} others
 * @returns {null | "body_required" | "body_length" | "forbidden_word" | "names_another_boy"}
 */
export function pointProblem(body, others = []) {
  const t = String(body ?? "").trim();
  if (!t) return "body_required";
  if (t.length > POINT_MAX) return "body_length";
  if (NEVER_ON_THE_COCKPIT.test(t)) return "forbidden_word";
  const low = t.toLowerCase();
  if (others.some((n) => { const s = String(n ?? "").trim(); return s.length >= 3 && /\s/.test(s) && low.includes(s.toLowerCase()); })) return "names_another_boy";
  return null;
}

/** The field's refusals as sentences: the point is up to 500 characters, not the target's one line. */
export const POINT_WORDS = Object.freeze({
  body_required: "Write the point first.",
  body_length: `Keep it to ${POINT_MAX} characters or fewer.`,
  forbidden_word: "That wording is not allowed here: it names a risk, a diagnosis or a figure. Say what you saw.",
  names_another_boy: "That names another boy. A coaching point is about one boy: leave him out.",
});

// ── What it stood on, and what it says now (C-D5) ───────

/**
 * The lines under a point: "stood on …", and "now …" where today's figure
 * differs, with "corrected" where only a correction explains the difference.
 * `ctx.matchups` is today's matchups read for the boy (rows), or null where
 * this reader did not or could not read it: then there is no "now" line,
 * never an invented one. `ctx.history` is his skills_history rows.
 * `ctx.at` is when today's read answered.
 * @param {any} point  an asPoint row
 * @param {{matchups?: any[] | null, history?: any[] | null, at?: number | null, now: number}} ctx
 * @returns {{stood: string, now: string | null, corrected: boolean}}
 */
export function pointLines(point, ctx) {
  const now = ctx.now;
  if (point?.read === "matchups" && point.rule === "S5") {
    const was = point.text?.[0] ?? "";
    const stood = `stood on: ${was}${point.asOf != null ? ` · as at ${clockWords(point.asOf, now)}` : ""}`;
    const type = point.params?.type;
    if (!ctx.matchups || !type) return { stood, now: null, corrected: false };
    const t = matchupTypes(ctx.matchups).find((x) => x.type === type) ?? { type, balls: 0, runs: 0, out: 0 };
    const then = matchupFigures(was);
    const name = then ? was.slice(0, was.lastIndexOf(` v ${then.type} · `)) : (point.name ?? "");
    const line = matchupLine(name, t);
    if (line === was) return { stood, now: null, corrected: false };
    const corrected = !!then && (t.balls < then.balls || (t.balls === then.balls && (t.runs !== then.runs || t.out !== then.out)));
    const at = ctx.at != null ? ` · as at ${clockWords(ctx.at, now)}` : "";
    return { stood, now: `now: ${line}${at}${corrected ? " · corrected" : ""}`, corrected };
  }
  if (point?.read === "skills") {
    const rows = ctx.history ?? [];
    const row = rows.find((r) => r.id === point.skillId);
    if (!row) return { stood: point.asOf != null ? `stood on: a score of ${shortDate(new Date(point.asOf).toISOString())}` : "stood on: a score", now: null, corrected: false };
    const label = metricWords(row.metric);
    const stood = `stood on: ${label} ${row.score} · ${shortDate(row.assessedOn)}`;
    const same = rows.filter((r) => r.category === row.category && r.metric === row.metric && !r.withdrawn)
      .sort((a, b) => (a.assessedOn < b.assessedOn ? -1 : a.assessedOn > b.assessedOn ? 1 : 0));
    const standing = same.at(-1) ?? null;
    if (!row.withdrawn && standing?.id === row.id) return { stood, now: null, corrected: false };
    const nowWords = standing ? `${label} ${standing.score} · ${shortDate(standing.assessedOn)}` : `${label}: no score stands`;
    return { stood, now: `now: ${nowWords}${row.withdrawn ? " · the score it stood on was withdrawn" : ""}`, corrected: !!row.withdrawn };
  }
  return { stood: "", now: null, corrected: false };
}

// ── The door from the drawer to the panel ───────────────

/**
 * What the drawer hands the Skills screen when it opens it: the boy, and the
 * pointer where the coach asked to make a point. Held in memory for the one
 * navigation, never stored: a reload loses it, which is the right answer for
 * a half-made judgement about a child.
 * @type {{playerId: string, pointer?: any} | null}
 */
let handed = null;
/** @param {{playerId: string, pointer?: any} | null} h */
export function handToSkills(h) { handed = h; }
/** What was handed, without taking it. */
export function handedToSkills() { return handed; }
/** Take it, once the screen has opened on it. */
export function clearHanded() { handed = null; }
