import { useEffect, useState } from "react";
import { hasMatchLog } from "./persist.js";
import { api } from "./api.js";

/**
 * Does THIS phone hold the pad's log of this fixture (redesign slice 10)? The
 * pad saves a fixture's log here as it is set up and on every ball
 * (lib/persist.js saveMatch, under `match:<id>`; a practice or a Pilot Match
 * has its own prefix), so a saved log means this phone is the one scoring it,
 * or was. It feeds lib/enterScoring.js scoresItHere(), which asks it only of a
 * reader the existing per-fixture check already lets score; it never offers
 * anything by itself.
 *
 * It asks for the key alone, never the log (persist.js hasMatchLog): a log
 * carries the boys' names, and only the scorer's own modules read one
 * (apps/web/test/pilot.test.mjs).
 * Nothing here writes, claims or clears. False until the store has answered,
 * and when it cannot be read: no "Open scorer" on a guess.
 * @param {string | null | undefined} matchId  null: nothing is asked
 * @returns {boolean}
 */
export function useLogOnThisPhone(matchId) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!matchId) { setHeld(false); return undefined; }
    let off = false;
    hasMatchLog(matchId)
      .then((has) => { if (!off) setHeld(has === true); })
      .catch(() => { if (!off) setHeld(false); });
    return () => { off = true; };
  }, [matchId]);
  return held;
}

/**
 * Does the office's duty roster name THIS reader as this fixture's scorer, on a
 * duty not paused (Kameel, 25 Nov: an appointed scorer counts for "Open
 * scorer")? The officials read the scorer's home already makes for the same
 * question (lib/scorerHome.js appointmentOf `byDuty`), narrowed to the one
 * fixture: match_official's rows with the person's id, so his own id is
 * compared, never a name. A bounded read; false while it is out, when it
 * fails, and for anyone the read does not answer: no "Open scorer" on a guess.
 * It feeds scoresItHere(), which asks the existing per-fixture check first.
 * @param {string | null | undefined} matchId  null: nothing is asked
 * @param {string | null | undefined} userId  the session's own user id
 * @returns {boolean}
 */
export function useDutyScorerHere(matchId, userId) {
  const [named, setNamed] = useState(false);
  useEffect(() => {
    if (!matchId || !userId) { setNamed(false); return undefined; }
    let off = false;
    api(`/api/read/officials?matchId=${encodeURIComponent(matchId)}`, { timeoutMs: 8000 })
      .then((d) => {
        const rows = Array.isArray(d?.rows) ? d.rows : null;
        if (!off) setNamed(!!rows && dutyScorerIn(rows, matchId, userId));
      })
      .catch(() => { if (!off) setNamed(false); });
    return () => { off = true; };
  }, [matchId, userId]);
  return named;
}

/**
 * The rows' answer, pure: a `scorer` duty on this fixture naming this person's
 * id, not paused by the office.
 * @param {any[]} rows  the officials read, as the server sends it
 * @param {string} matchId  @param {string} userId
 */
export const dutyScorerIn = (rows, matchId, userId) => rows.some((r) =>
  r?.duty === "scorer" && r.match_id === matchId && r.person_id === userId && r.suspended !== true);
