/**
 * SCRBRD — writing a development record: assessments and notes.
 *
 * Every function here is a thin call to an endpoint that makes the decision.
 * Nothing in this module checks whether the person may do what they are asking
 * to do — the row-level policy does, on the player's CURRENT side, and a
 * duplicate check here would be a second opinion that drifts from the one that
 * actually runs.
 *
 * What it DOES do is refuse to send nonsense: a rating outside the scale or an
 * adjustment with no discipline is a mistake the coach should be told about
 * before it becomes a round trip. The server validates the same things again,
 * because a client-side check is a courtesy and not a control.
 */
import { api } from "./api.js";
import { SCALE_MIN, SCALE_MAX, TREE, DISCIPLINES } from "@scrbrd/scoring";
import { NEVER_ON_THE_COCKPIT } from "./cockpitNever.js";

/** The most a single note may move a rating. Mirrors the column's CHECK. */
export const NOTE_ADJUSTMENT_LIMIT = 3;

/** Is this a score a coach could actually have meant? */
export function validScore(v) {
  return Number.isInteger(v) && v >= SCALE_MIN && v <= SCALE_MAX;
}

/**
 * Record an assessment.
 *
 * `scores` is { group: { attribute: 1..20 } }. PARTIAL IS NORMAL: a coach rates
 * what they watched on Saturday, and the write path upserts per attribute, so
 * four numbers revise those four and leave the other twenty-nine standing.
 * Sending an untouched attribute would overwrite a considered judgement with a
 * default, which is why the form only sends what was moved.
 *
 * There is no `note` (GA-I26a §4.4): the per-row prose was copied into every
 * row written and read back by nothing. What a coach wants to say becomes a
 * coaching point on the row he means (writeCoachingPoint below).
 */
export async function recordAssessment(playerId, scores, { assessedOn } = {}) {
  const clean = {};
  for (const [group, attrs] of Object.entries(scores || {})) {
    if (!TREE[group]) throw new Error(`unknown_group:${group}`);
    for (const [attr, raw] of Object.entries(attrs || {})) {
      const v = Number(raw);
      if (raw === "" || raw == null) continue;          // untouched
      if (!TREE[group].includes(attr)) throw new Error(`unknown_attribute:${group}.${attr}`);
      if (!validScore(v)) throw new Error(`bad_score:${group}.${attr}`);
      (clean[group] ??= {})[attr] = v;
    }
  }
  if (!Object.keys(clean).length) throw new Error("nothing_to_record");
  return api(`/api/players/${playerId}/assessment`, {
    method: "POST", body: { scores: clean, assessedOn: assessedOn || undefined },
  });
}

/**
 * Write a development note.
 *
 * The signal is optional and explicit. Nothing reads the prose — see
 * db/08_schema_programme.sql — so a note that is meant to move a rating has to
 * say which discipline and by how much, and a coach who fills in one without
 * the other is told rather than having the number silently dropped.
 */
export async function writeNote(playerId, { body, aboutDiscipline, adjustment } = {}) {
  const text = (body || "").trim();
  if (!text) throw new Error("body_required");
  const adj = adjustment === "" || adjustment == null ? null : Number(adjustment);
  if (adj !== null) {
    if (!Number.isInteger(adj)) throw new Error("bad_adjustment");
    if (Math.abs(adj) > NOTE_ADJUSTMENT_LIMIT) throw new Error("adjustment_too_large");
    if (!aboutDiscipline) throw new Error("adjustment_needs_a_discipline");
  }
  if (aboutDiscipline && !Object.hasOwn(DISCIPLINES, aboutDiscipline))
    throw new Error(`unknown_discipline:${aboutDiscipline}`);
  return api(`/api/players/${playerId}/notes`, {
    method: "POST",
    body: { body: text, aboutDiscipline: aboutDiscipline || undefined,
            adjustment: adj === null || adj === 0 ? undefined : adj },
  });
}

// ── GA-I26a A3: targets, withdrawals and coaching points ───────────────
// Thin calls, like the ones above: the database decides who may do what, and
// refuses in words (`already_there`, `forbidden_word`, `not_permitted`).

/** A refusal from these routes, in words; the code only when there are none. */
const WRITE_WORDS = {
  missing_token: "You are not signed in, so nothing was saved.",
  not_permitted: "You may not do that for this player.",
  nothing_to_record: "Move at least one rating before saving.",
  already_there: "He is already at or above that. Pick a higher target.",
  forbidden_word: "That wording is not allowed here: it names a risk, a diagnosis or a figure. Say what you saw.",
  names_another_boy: "That names another boy. Leave him out.",
  reason_required: "Say why, in a few words.",
  body_length: "Keep it to one line, 200 characters or fewer.",
  body_required: "Write the reason, or leave the box empty.",
  evidence_required: "Rate this skill first; the reason stands on a score.",
  evidence_not_his: "That score is not his.",
  already_withdrawn: "That was already taken back.",
  drill_retired: "That drill is retired. Pick another.",
  no_such_drill: "That drill is not in the library.",
  due_in_past: "The date has passed. Pick a later one, or leave it blank.",
  bad_due_on: "That is not a date.",
  not_the_assessor: "Another coach gave that score. Rate it again on a row of your own.",
  withdrawn: "A withdrawn score is not changed.",
  minutes_invalid: "Minutes run from 5 to 180, or leave it blank for the drill's own.",
  drills_invalid: "A plan holds up to 20 drills.",
  drill_repeated: "A drill is on the plan once.",
  status_invalid: "Pick present, late, excused or absent.",
  status_not_accepted: "That word is not used on the register.",
  player_not_at_this_school: "That boy is not at this school.",
  no_such_session: "That session is not one you can see.",
};
/** A refusal as a sentence for the coach: `writeWords(err)`. */
export function writeWords(e) {
  const code = String(e?.code || e?.message || "").split(" ")[0];
  if (WRITE_WORDS[code]) return WRITE_WORDS[code];
  if (/^bad_score:/.test(code)) return "A rating is outside 1 to 20.";
  if (code === "bad_score") return "Pick a whole number from 2 to 20.";
  return e?.message || "Could not save just now.";
}

/** A reason is required to take a judgement back; it is shown with the strike. */
export const REASON_MAX = 200;
/** The "why" of a target is one line (§4.3); the column allows more. */
export const WHY_MAX = 200;

/**
 * Set a target on one attribute. The old open target for it is withdrawn
 * ("replaced") in the same transaction by the database, never here.
 * `noteId` is the coaching point that says why: staff-tier prose the boy does
 * not read.
 */
export async function setTarget(playerId, { category, metric, targetScore, dueOn, drillId, noteId }) {
  const n = Number(targetScore);
  if (!TREE[category]?.includes(metric)) throw new Error(`unknown_attribute:${category}.${metric}`);
  if (!Number.isInteger(n) || n < 2 || n > SCALE_MAX) throw new Error("bad_score");
  return api(`/api/players/${playerId}/targets`, {
    method: "POST", body: { category, metric, targetScore: n, dueOn: dueOn || undefined, drillId: drillId || undefined, noteId: noteId || undefined },
  });
}

/** Take an open target back. */
export async function withdrawTarget(targetId, reason) {
  const why = (reason || "").trim();
  if (!why) throw new Error("reason_required");
  return api(`/api/targets/${targetId}/withdraw`, { method: "POST", body: { reason: why.slice(0, REASON_MAX) } });
}

/** Take a score back. The row stays, struck, with who withdrew it and why. */
export async function withdrawScore(skillId, reason) {
  const why = (reason || "").trim();
  if (!why) throw new Error("reason_required");
  return api(`/api/skills/${skillId}/withdraw`, { method: "POST", body: { reason: why.slice(0, REASON_MAX) } });
}

/** Take a note or a coaching point back (the row stays, struck). */
export async function withdrawNote(noteId) {
  return api(`/api/notes/${noteId}/withdraw`, { method: "POST", body: {} });
}

/**
 * Write the "why" of a target as a coaching point standing on the score it is
 * about (`evidence_read: 'skills'`). The cockpit's never-words are refused
 * here before the trip and again in the database, which is the one that holds.
 * @returns {Promise<{ id: string }>}
 */
export async function writeCoachingPoint(playerId, { body, skillId }) {
  const text = (body || "").trim();
  if (!text) throw new Error("body_required");
  if (text.length > WHY_MAX) throw new Error("body_length");
  if (!skillId) throw new Error("evidence_required");
  if (NEVER_ON_THE_COCKPIT.test(text)) throw new Error("forbidden_word");
  return api(`/api/players/${playerId}/coaching-points`, {
    method: "POST", body: { body: text, evidence: { read: "skills", params: { skillId } } },
  });
}
