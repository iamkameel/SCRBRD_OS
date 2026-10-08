import { useEffect } from "react";
import { correctedAt, correctionsOf, correctionText, inningsWords, withCorrectionLines } from "../lib/corrections.js";
import { liveRefreshMs } from "../views/matchcentre/live.js";
import { read } from "./reads.js";
import { CorrectedChip, StaleLine } from "../views/matchcentre/corrected.jsx";

export { CorrectedChip, StaleLine };

/**
 * THE PUBLIC PAGE'S CORRECTIONS HALF (GA-I36 A0/A1), loaded on demand: by a
 * finished match (whose head is still asked after), by a log with a void in
 * it, or by a failed read. The public static bundle has a ceiling
 * (tools/check-bundle.mjs) and a live page with nothing corrected — the hot
 * path at a ground — should not pay for any of this.
 *
 * Everything here is said from what the page already has: the redacted log
 * (a void there is its kind, seq, time and a pseudonymous target, nothing
 * else) and the page's own story. When, team-level: never who asked, who
 * approved, why, or a boy's name.
 */

/**
 * What the page draws of its corrections: the chip's time and line, the
 * innings words, and the commentary with one quiet `correction` line each.
 * @param {any[]} events  the public log's, as served
 * @param {{commentary: any[], folded: any, settled: boolean, match: any}} story  publicStory()'s
 */
export function publicFixes(events, story) {
  const list = correctionsOf(events);
  const after = story.settled || story.match.status === "complete";
  return { at: correctedAt(list), line: correctionText(after), corrected: inningsWords(events, list, story.folded.innings),
    commentary: withCorrectionLines(story.commentary, events, list, after) };
}

/**
 * A finished match's head, asked after on the page's poll (`?since=last`, the
 * public cache's own answer, which an approval or a release drops at once):
 * a head beyond the page's says "Updated · refresh", and the figures wait for
 * the reader's tap (§7). A failed read is said as one. Draws nothing.
 * @param {{matchId: string, last: number, note: (s: {stale?: boolean, error: string | null}) => void}} p
 */
export function SettledWatch({ matchId, last, note }) {
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const log = await read(`/api/public/matches/${matchId}/log?since=${last}`);
        note((log.last ?? 0) > last ? { stale: true, error: null } : { error: null });
      } catch (/** @type {any} */ e) {
        note({ error: e.status === 429 ? "busy" : "unreachable" });
      }
    }, liveRefreshMs());
    return () => clearInterval(t);
  }, [matchId, last, note]);
  return null;
}
