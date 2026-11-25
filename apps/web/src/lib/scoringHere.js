import { useEffect, useState } from "react";
import { recordKeys } from "./persist.js";

/**
 * Does THIS phone hold the pad's log of this fixture (redesign slice 10)? The
 * pad saves a fixture's log here as it is set up and on every ball
 * (lib/persist.js saveMatch, under `match:<id>`; a practice or a Pilot Match
 * has its own prefix), so a saved log means this phone is the one scoring it,
 * or was. It feeds lib/enterScoring.js scoresItHere(), which asks it only of a
 * reader the existing per-fixture check already lets score; it never offers
 * anything by itself.
 *
 * It asks for the key alone, never the log: a log carries the boys' names, and
 * only the scorer's own modules read one (apps/web/test/pilot.test.mjs).
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
    const key = `match:${matchId}`;
    recordKeys(key)
      .then((keys) => { if (!off) setHeld(Array.isArray(keys) && keys.includes(key)); })
      .catch(() => { if (!off) setHeld(false); });
    return () => { off = true; };
  }, [matchId]);
  return held;
}
