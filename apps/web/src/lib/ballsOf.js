import { dismissalKey } from "./matchCentre.js";

/**
 * EXPERIENCE_PASS §3.3, Q9 (decided 13 Nov): from a scorecard figure to its
 * balls. A batter's runs list the deliveries he faced, and the one that got
 * him out; a bowler's figures list every delivery he bowled. The Commentary
 * keeps them by event id (commentaryMatches(), the filter CRI-2.3's charts
 * already use), so nothing new is filtered and nothing new is read.
 *
 * SIGNED IN ONLY. A per-boy list of his balls is a player page in all but
 * name (PUBLIC_DATA A4, L7), so the public page never builds one: this module
 * is the signed-in Match Centre's (MatchView.jsx), outside the public bundle,
 * and the public page keeps the kind filters it has.
 *
 * A batter's wides are not his (Law 25.4: a wide is not a ball faced), so the
 * list's count of balls is his B; the ball that dismissed him is in it even
 * where he did not face it (run out at the other end, stumped off a wide), as
 * is a retirement that counts as a wicket, which has no delivery.
 *
 * @param {any} inn  the fold's innings
 * @param {"bat" | "bowl"} kind  @param {string} id  the player
 * @param {any[]} [events]  this innings' own log, for a wicket with no delivery
 * @returns {string[]}  event ids, in the log's order
 */
export function ballsOf(inn, kind, id, events = []) {
  if (!inn || id == null) return [];
  const log = Array.isArray(inn.ballLog) ? inn.ballLog : [];
  /** @type {Set<string>} */
  const ids = new Set();
  for (const b of log) {
    if (b?.id == null) continue;
    const mine = kind === "bowl" ? (b.bowlerId ?? b.bowler) === id : (b.strikerId ?? b.striker) === id && b.type !== "Wd";
    if (mine) ids.add(String(b.id));
  }
  if (kind === "bat") {
    const key = dismissalKey(inn, id, events);
    if (key?.startsWith("e:")) ids.add(key.slice(2));
  }
  const order = new Map(log.map((b, i) => [String(b?.id), i]));
  return [...ids].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
}
