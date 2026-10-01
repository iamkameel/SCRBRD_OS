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
import { api, signedIn } from "../../lib/api.js";
import { liveRefreshMs } from "../matchcentre/live.js";

/** matchId → { innings, result } for a match already finished. Signed-out has none. */
const done = new Map();

/** Forget the cache (tests, and a sign-out on a shared device). */
export function forgetFolds() { done.clear(); }

/**
 * @param {{ id: string, status: string } | null} match
 * @returns {{ loading: boolean, error: string | null, innings: any[], result: any }}
 */
export function useFold(match) {
  const id = match?.id ?? null;
  const live = match?.status === "live";
  const [tick, setTick] = useState(0);
  const [state, setState] = useState(() => (id && done.has(id) ? { loading: false, error: null, ...done.get(id) }
    : { loading: !!id && signedIn(), error: null, innings: [], result: null }));

  useEffect(() => {
    if (!live || !signedIn()) return undefined;
    const t = setInterval(() => { if (!document.hidden) setTick((x) => x + 1); }, liveRefreshMs());
    return () => clearInterval(t);
  }, [live]);

  useEffect(() => {
    if (!id || !signedIn()) { setState({ loading: false, error: null, innings: [], result: null }); return undefined; }
    if (!live && done.has(id)) { setState({ loading: false, error: null, ...done.get(id) }); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const { events: rows, fold } = await api(`/api/matches/${id}/events`);
        const m = deriveMatch((rows || []).map(fromRow), fold ?? {});
        const out = { innings: (m.innings ?? []).filter(Boolean), result: m.result ?? null };
        if (match?.status === "complete") done.set(id, out);
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
