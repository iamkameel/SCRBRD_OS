/**
 * WHAT LEADS A PUPIL'S OR A PARENT'S HOME (redesign slice 8; the role
 * reviews' direction §2.6 and §3.1 to §3.2, Kameel 19 Nov: "All as
 * recommended"; EXPERIENCE_PASS §1.9).
 *
 * Every first screen has one lead block, heavier than the rest, chosen by the
 * state of the match day. For one child (his own Home, or one child's section
 * of his parent's), the first of these that holds wins:
 *
 *   1. terms not agreed, a link still waiting   the family screens' own gate
 *                                               (TermsGate, NoChild), before
 *                                               this is ever asked
 *   2, 3. a match of his side is live (innings  "live": the board. A match with a
 *      break and a provisional result included,  result on the pad is still live
 *      db/165)                                   (db/165) and says "provisional"
 *   4. a match of his side today, not started   "captain" when he holds the
 *                                               captaincy (question 5 (a): his
 *                                               captain's block, before play);
 *                                               otherwise "next": the fixture,
 *                                               with what he still owes
 *   5. the next fixture, with an ask            "next": the fixture and the answer
 *   6. a match finished today                   "result": the result, his part
 *   7. the next fixture, nothing owed           "next": the match card, calm
 *   8. nothing arranged                         "none": the next-fixture card's
 *                                               own "nothing arranged", then the
 *                                               last result under it
 *
 * Once a captain's match is live the board leads and his captain's block sits
 * under it (question 5 (a)); `captainUnder` says so. On any other day his
 * block is where SCRBRD-138 C1 put it, under his next fixture.
 *
 * NOTHING HERE READS OR DECIDES ACCESS. It orders what the Home already read,
 * for the one child it is handed; whether he is a captain is the honour's
 * own row (lib/captain.js captaincyOf), read under his own assignment.
 *
 * Pure, so it is proved under plain node (apps/web/test/home-lead.test.mjs):
 * no React, no DOM, no clock (the caller passes `now`).
 */
import { fixturesOf } from "./family.js";
import { startMs } from "./cockpit.js";

const HOUR = 3600e3;

/** The South African calendar day of a moment (UTC+2, no summer time): "2026-11-21". @param {number} ms */
const saDay = (ms) => new Date(ms + 2 * HOUR).toISOString().slice(0, 10);

/** Is the fixture on the same South African day as `now`? @param {any} m @param {number} now */
export function onTheDay(m, now) {
  const t = m ? startMs(m) : null;
  return t != null && saDay(t) === saDay(now);
}

/**
 * @param {{matches: any[] | null | undefined, child: any, now: number, captain?: boolean, owed?: boolean}} o
 *   `captain`: he holds the captaincy for this season (the honour's row; a parent's Home never passes it).
 *   `owed`: his answer for the next fixture is still owed (the To-do list's R1 or R2 for it); only step 5
 *   against step 6 turns on it.
 * @returns {{kind: "live" | "captain" | "next" | "result" | "none", match: any, captainUnder: boolean}}
 */
export function leadOf({ matches, child, now, captain = false, owed = false }) {
  const f = fixturesOf(matches ?? [], child, now);
  const live = f.live[0] ?? null;
  if (live) return { kind: "live", match: live, captainUnder: captain };
  const next = f.upcoming[0] ?? null;
  if (next && onTheDay(next, now)) return { kind: captain ? "captain" : "next", match: next, captainUnder: false };
  const last = f.played[0] ?? null;
  if (last && onTheDay(last, now) && !(next && owed)) return { kind: "result", match: last, captainUnder: false };
  if (next) return { kind: "next", match: next, captainUnder: false };
  return { kind: "none", match: null, captainUnder: false };
}
