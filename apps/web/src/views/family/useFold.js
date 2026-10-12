/**
 * One match's log, folded — for a family card that needs one child's line
 * or the board (step 4 P1, P2, S1, S2).
 *
 * The same read and the same fold the Match Centre uses (`GET
 * /api/matches/:id/events` → deriveMatch(), MatchView.jsx), so a parent's
 * "17 off 12, run out" and the scorecard cannot disagree. §5 G7: one fetch
 * per played match, kept for the life of the page — a finished match's log
 * does not change under a family reading it — and refetched on the Match
 * Centre's own cadence while the match is live.
 */
import { useEffect, useState } from "react";
import { deriveMatch, fromRow } from "@scrbrd/scoring";
import { api, getToken, signedIn } from "../../lib/api.js";
import { liveRefreshMs } from "../matchcentre/live.js";

/** matchId → { innings, result } for a match already finished. Signed-out has none. */
const done = new Map();
/** The bearer the cache was filled under. */
let doneFor = /** @type {string | null} */ (null);

/**
 * The cache, for this session only. Signing out does not reload the page, so
 * a module-level cache would outlive it: the next person on a shared tablet
 * would be served the last person's children's lines. Keyed to the bearer, as
 * the notices are (lib/notifications.js sessionKey), so a sign-out, an expired
 * session or a different person signing in all start from nothing.
 */
export function foldCache() {
  const who = signedIn() ? getToken() : null;
  if (who !== doneFor) { done.clear(); doneFor = who; }
  return done;
}

/** Forget the cache (tests). */
export function forgetFolds() { done.clear(); doneFor = null; }

/**
 * Read and fold one match for the session that asked. The answer belongs to
 * the bearer the request went out under: if the session changed while it was
 * on its way (a sign-out, an expiry, someone else signing in), it is dropped,
 * neither cached nor returned, so it cannot land in the next person's cache or
 * on their screen. Resolves null when dropped; an error from a session that
 * has gone is dropped the same way.
 * @param {string} id @param {string | undefined} status
 * @param {(path: string) => Promise<any>} [read]
 */
export async function loadFold(id, status, read = api) {
  const who = getToken();
  let body;
  try {
    body = await read(`/api/matches/${id}/events`);
  } catch (e) {
    if (getToken() !== who) return null;
    throw e;
  }
  if (getToken() !== who) return null;
  const m = deriveMatch((body?.events || []).map(fromRow), body?.fold ?? {});
  const out = { innings: (m.innings ?? []).filter(Boolean), result: m.result ?? null };
  if (status === "complete") foldCache().set(id, out);
  return out;
}

/**
 * @param {{ id: string, status: string } | null} match
 * @returns {{ loading: boolean, error: string | null, innings: any[], result: any }}
 */
export function useFold(match) {
  const id = match?.id ?? null;
  const live = match?.status === "live";
  // The session this render belongs to: a different one refetches, and the
  // old request's answer is dropped (loadFold) and never set here (cancelled).
  const who = signedIn() ? getToken() : null;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState(() => (id && foldCache().has(id) ? { loading: false, error: null, ...foldCache().get(id) }
    : { loading: !!id && signedIn(), error: null, innings: [], result: null }));

  useEffect(() => {
    if (!live || !signedIn()) return undefined;
    const t = setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, liveRefreshMs());
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    if (!id || !signedIn()) { setState({ loading: false, error: null, innings: [], result: null }); return undefined; }
    if (!live && foldCache().has(id)) { setState({ loading: false, error: null, ...foldCache().get(id) }); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const out = await loadFold(id, match?.status);
        if (!cancelled && out) setState({ loading: false, error: null, ...out });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.code || "unreachable", innings: [], result: null });
      }
    })();
    return () => { cancelled = true; };
    // A status change (live → complete) refetches, and is cached once complete.
  }, [id, live, tick, match?.status, who]);

  return state;
}
