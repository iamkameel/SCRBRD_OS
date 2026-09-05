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
 */
export async function recordAssessment(playerId, scores, { note, assessedOn } = {}) {
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
    method: "POST", body: { scores: clean, note: note || undefined, assessedOn: assessedOn || undefined },
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
