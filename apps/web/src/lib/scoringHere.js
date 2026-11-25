import { useEffect, useState } from "react";
import { loadMatch } from "./persist.js";

/**
 * Does THIS phone hold the pad's log of this fixture (redesign slice 10)? The
 * pad saves a fixture's log here as it is set up and on every ball
 * (lib/persist.js saveMatch, `match:<id>`), so a saved log means this phone is
 * the one scoring it, or was. It feeds lib/enterScoring.js scoresItHere(),
 * which asks it only of a reader the existing per-fixture check already lets
 * score; it never offers anything by itself.
 *
 * Read only: nothing here writes, claims or clears. False until the store has
 * answered, and when it cannot be read: no "Open scorer" on a guess.
 * @param {string | null | undefined} matchId  null: nothing is asked
 * @returns {boolean}
 */
export function useLogOnThisPhone(matchId) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!matchId) { setHeld(false); return undefined; }
    let off = false;
    loadMatch(matchId)
      .then((v) => { if (!off) setHeld(!!v && v.cfg?.live === true); })
      .catch(() => { if (!off) setHeld(false); });
    return () => { off = true; };
  }, [matchId]);
  return held;
}
