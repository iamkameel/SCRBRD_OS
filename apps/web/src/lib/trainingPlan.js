/**
 * A session's plan and register: the calls and the shape checks (GA-I26a
 * §1.3, §1.4, AH-D9). Thin, as lib/development.js is: the policy decides who
 * may plan a session (`team.training.run`), and refuses in words.
 *
 * The plan names no boy. The register has four words, never `injured`.
 */
import { api } from "./api.js";
import { REGISTER_STATES } from "./assessmentHistory.js";

export const PLAN_MAX_DRILLS = 20;
export const MINUTES_MIN = 5;
export const MINUTES_MAX = 180;

/** Minutes for a plan line: blank is the drill's own length, otherwise 5 to 180. @param {unknown} v */
export function minutesProblem(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= MINUTES_MIN && n <= MINUTES_MAX ? null : `Minutes run from ${MINUTES_MIN} to ${MINUTES_MAX}, or leave it blank for the drill's own.`;
}

/** Move line `i` by `by` places; the list is unchanged at either end. @template T @param {T[]} list @param {number} i @param {number} by */
export function moved(list, i, by) {
  const j = i + by;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/**
 * Replace a session's plan, in order. POST, not the design's PUT: the
 * dispatcher reads a body for POST and PATCH only.
 * @param {string} sessionId @param {{ drillId: string, minutes?: string | number | null }[]} lines
 */
export async function savePlan(sessionId, lines) {
  if (lines.length > PLAN_MAX_DRILLS) throw new Error("drills_invalid");
  const drills = lines.map((l) => {
    if (minutesProblem(l.minutes)) throw new Error("minutes_invalid");
    return { drillId: l.drillId, minutes: l.minutes === "" || l.minutes == null ? undefined : Number(l.minutes) };
  });
  return api(`/api/training/${sessionId}/plan`, { method: "POST", body: { drills } });
}

/**
 * Save the register, whole: one row per boy marked. A boy left unmarked is
 * not sent, which is "no register taken for him", not an absence.
 * @param {string} sessionId @param {Record<string, string>} marks  playerId → one of REGISTER_STATES
 */
export async function saveRegister(sessionId, marks) {
  const rows = Object.entries(marks).filter(([, s]) => s).map(([playerId, status]) => {
    if (!REGISTER_STATES.includes(status)) throw new Error("status_invalid");
    return { playerId, status };
  });
  if (!rows.length) throw new Error("nothing_to_record");
  return api(`/api/training/${sessionId}/attendance`, { method: "POST", body: { rows } });
}
