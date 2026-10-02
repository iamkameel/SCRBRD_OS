/**
 * Where the Dashboard's match-day card sends the coach (SCRBRD-136): one tap
 * opens the Coach tab of that fixture in the Match Centre, optionally with the
 * feed's drawer open. The shell has no deep links, so the card leaves a note
 * here and the Match Centre takes it when it mounts. In memory only: a reload
 * forgets it, which is right.
 */
/** @type {{matchId: string, drawer: boolean} | null} */
let pending = null;

/** @param {string} matchId @param {boolean} [drawer] */
export function requestCoach(matchId, drawer = false) { pending = { matchId, drawer }; }

/** Look without taking: the Match Centre waits for its fixtures to load. */
export const peekCoach = () => pending;

/** The note has been acted on. */
export function clearCoach() { pending = null; }
