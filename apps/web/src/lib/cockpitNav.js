/**
 * Where the Dashboard's match-day card sends the coach (SCRBRD-136): one tap
 * opens the Coach tab of that fixture in the Match Centre, optionally with the
 * feed's drawer open. The Readiness screen's rows (match-day queue, phase A0)
 * open the same fixture's duties: the Match Centre's details panel for it,
 * where the DutyRoster is. The shell has no deep links, so the caller leaves a
 * note here and the Match Centre takes it when it mounts. In memory only: a
 * reload forgets it, which is right.
 */
/** @type {{matchId: string, drawer: boolean, view: "coach" | "duties"} | null} */
let pending = null;

/** @param {string} matchId @param {boolean} [drawer] */
export function requestCoach(matchId, drawer = false) { pending = { matchId, drawer, view: "coach" }; }

/** The fixture's duties, in the Match Centre's details panel. @param {string} matchId */
export function requestDuties(matchId) { pending = { matchId, drawer: false, view: "duties" }; }

/** Look without taking: the Match Centre waits for its fixtures to load. */
export const peekCoach = () => pending;

/** The note has been acted on. */
export function clearCoach() { pending = null; }
