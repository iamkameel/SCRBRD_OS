/**
 * A knockout's bracket, in words (SCRBRD-060). The shape is the server's
 * (services/api/write/bracket.mjs, GET /api/competitions/:id/bracket); this
 * only says it. A side or a date nobody knows yet is "To be decided", with
 * the tie it waits for where there is one — never a guess.
 */
import { dayWords, saDay, saTime } from "./league.js";

/** What a side or date not yet known says (the planner's word, lib/league.js sideWords()). */
export const TO_BE_DECIDED = "To be decided";

/** A round's name, counted back from the final. @param {number} round @param {number} last */
export function roundTitle(round, last) {
  if (round === last) return "Final";
  if (round === last - 1) return "Semi-finals";
  if (round === last - 2) return "Quarter-finals";
  return `Round ${round}`;
}

/**
 * One side, in words: its name, or "To be decided" and the tie it waits for.
 * @param {{ known: boolean, label: string | null, from: { round: number, match: number } | null }} side
 * @param {number} last  the final's round
 * @returns {{ name: string, known: boolean, note: string | null }}
 */
export function sideSaid(side, last) {
  // A feeder is never the final: it is always an earlier round.
  const from = side?.from ? `Winner of ${roundTitle(side.from.round, last)} · Match ${side.from.match}` : null;
  if (side?.known && side.label) return { name: side.label, known: true, note: null };
  return { name: TO_BE_DECIDED, known: false, note: from };
}

/**
 * When a tie is played: its fixture's start; else the plan's slot, said as a
 * plan; else "To be decided".
 * @param {{ startsAt: string | null, plannedAt: string | null }} tie
 */
export function whenSaid(tie) {
  const at = (/** @type {string} */ iso) => `${dayWords(saDay(iso))}, ${saTime(iso)}`;
  if (tie.startsAt && saDay(tie.startsAt)) return { text: at(tie.startsAt), known: true };
  if (tie.plannedAt && saDay(tie.plannedAt)) return { text: `Planned for ${at(tie.plannedAt)}`, known: true };
  return { text: `Date ${TO_BE_DECIDED.toLowerCase()}`, known: false };
}

/** How a winner went through, where play alone did not say it. @type {Record<string, string>} */
export const HOW_WORDS = {
  super_over: "Through on the super over",
  conceded: "Through: the other side conceded",
  walkover: "Through on a walkover",
  awarded: "Through: awarded by the organiser",
};

/**
 * The demonstration's cup (data/mock.js `bracket`) in the server's shape, so
 * one component draws both. Its "TBD" is a side not known, as it says.
 * @param {{ round: string, fixtures: { home: string, away: string, result: string | null, status: string }[] }[]} rounds
 */
export function demoBracket(rounds) {
  const known = (/** @type {string} */ s) => !!s && s !== "TBD";
  return {
    drawn: true, demo: true, byes: [], champion: null, fixturesOutsideDraw: 0,
    rounds: rounds.map((r, i) => ({
      round: i + 1, name: r.round,
      ties: r.fixtures.map((f, j) => ({
        key: `demo:${i}:${j}`, match: j + 1, matchId: null, startsAt: null, plannedAt: null, status: f.status,
        home: { known: known(f.home), label: known(f.home) ? f.home : null, from: null },
        away: { known: known(f.away), label: known(f.away) ? f.away : null, from: null },
        result: f.result ? { text: f.result, outcome: null, how: null } : null, through: null, flags: [],
      })),
    })),
  };
}
