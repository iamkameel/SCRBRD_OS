import { useEffect, useState } from "react";
import { api, signedIn } from "./api.js";
import { invitationsWaiting } from "./league.js";

const CHANGED = "scrbrd:invitations-changed";

/**
 * How many league invitations are waiting for this person's answer, for the
 * navigation badge (SCRBRD-127). The API lists only the invitations the
 * signed-in person may answer, so this counts them as they come and filters
 * nobody by role. It is 0 when signed out and 0 when the read fails: a badge
 * built from nothing says nothing.
 *
 * The API writes no notification for an invitation yet, so until it does this
 * is how a school finds one without opening Competitions.
 *
 * `key` changes when the count should be read again (signing in, a change of
 * role, a change of page). The panel that answers an invitation calls
 * `invitationsChanged()` so the badge follows at once.
 * @param {string} key
 */
export function useWaitingInvitations(key) {
  const [n, setN] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener(CHANGED, again);
    return () => window.removeEventListener(CHANGED, again);
  }, []);
  useEffect(() => {
    if (!signedIn()) { setN(0); return; }
    let off = false;
    api("/api/competition-invitations")
      .then((d) => { if (!off) setN(invitationsWaiting(d.invitations)); })
      .catch(() => { if (!off) setN(0); });
    return () => { off = true; };
  }, [key, tick]);
  return n;
}


/** Say that an invitation was answered, so the badge reads again. */
export function invitationsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}
