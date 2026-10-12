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
 * @param {{ id: string, status: string } | null} match
 * @returns {{ loading: boolean, error: string | null, innings: any[], result: any }}
 */
export function useFold(match) {
  const id = match?.id ?? null;
  const live = match?.status === "live";
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
        const { events: rows, fold } = await api(`/api/matches/${id}/events`);
        const m = deriveMatch((rows || []).map(fromRow), fold ?? {});
        const out = { innings: (m.innings ?? []).filter(Boolean), result: m.result ?? null };
        if (match?.status === "complete") foldCache().set(id, out);
        if (!cancelled) setState({ loading: false, error: null, ...out });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.code || "unreachable", innings: [], result: null });
      }
    })();
    return () => { cancelled = true; };
    // A status change (live → complete) refetches, and is cached once complete.
  }, [id, live, tick, match?.status]);

  return state;
}
