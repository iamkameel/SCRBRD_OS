import { useState } from "react";
import { T } from "../../design/tokens.js";
import { clockWords, correctedAt, correctionsOf, correctionText, inningsWords, withCorrectionLines } from "../../lib/corrections.js";

/**
 * The two lines a correction gives a reader (GA-I36 §5, §7), shared by the
 * signed-in Match Centre and the public page so neither can say it
 * differently. Nothing here reads the server: the parent passes what it knows.
 */

const pill = () => ({
  minHeight: "44px", padding: `0 ${T.space.md}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
  background: "transparent", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer",
  color: T.content.primary, fontFamily: T.type.body, fontSize: "13px", fontWeight: 600,
});

/**
 * "Corrected 18:42": a 44px chip that opens the correction line(s) under it.
 * `lines` is called when it opens (a staff line folds the log again to name
 * the ball), and returns plain words: the public page's are team-level only.
 * @param {{at: number | null, lines: () => string[], testid?: string}} p
 */
export function CorrectedChip({ at, lines, testid = "mc-corrected" }) {
  const [open, setOpen] = useState(false);
  if (at == null) return null;
  const said = open ? lines() : [];
  return (
    <div style={{ display: "grid", gap: T.space.xs, justifyItems: "start" }}>
      <button type="button" data-testid={testid} aria-expanded={open} aria-controls={`${testid}-lines`}
        onClick={() => setOpen((o) => !o)} className="pressBtn os-state" style={pill()}>
        Corrected {clockWords(at)}
      </button>
      {open && (
        <ul id={`${testid}-lines`} data-testid={`${testid}-lines`}
          style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0, paddingLeft: T.space.lg, display: "grid", gap: "2px" }}>
          {said.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}

/**
 * The reader's own fold against the server's head (§7): nothing while
 * current; "Updated · refresh" once a poll has seen a head beyond the one on
 * screen (the figures stay until the tap, so nothing moves under a finger);
 * "Updating…" while that read is out; and a failed poll said as one, with the
 * time of the read on screen — never a zero, never silence. A live region, so
 * the change is heard as well as seen.
 * `bare`: the words without the region, for a page that keeps the region
 * itself (the public page draws it before this file has loaded).
 * @param {{stale: boolean, refreshing: boolean, failed: boolean, okAt: number | null, onRefresh: () => void, testid?: string, bare?: boolean}} p
 */
export function StaleLine({ stale, refreshing, failed, okAt, onRefresh, testid = "mc-stale", bare = false }) {
  const words = refreshing ? <p data-testid={testid} style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0, minHeight: "44px", display: "flex", alignItems: "center" }}>Updating…</p>
        : stale ? (
          <button type="button" data-testid={testid} onClick={onRefresh} className="pressBtn os-state"
            style={{ ...pill(), borderColor: T.brand.accentText, color: T.brand.accentText }}>
            Updated · refresh
          </button>
        ) : failed ? (
          <p data-testid={testid} style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0, minHeight: "44px", display: "flex", alignItems: "center" }}>
            Could not refresh · showing the match as at {clockWords(okAt) || "the last read"}
          </p>
        ) : null;
  return bare ? words : <div role="status" aria-live="polite" data-testid={`${testid}-region`}>{words}</div>;
}

/**
 * THE PUBLIC PAGE'S HALF, loaded only once the page has something to say (a
 * void in its log, a head beyond its own, a failed read): the public static
 * bundle has a ceiling (tools/check-bundle.mjs), and a page with nothing
 * corrected should not pay for the words. Given the raw public log (a void
 * there is its kind, seq, time and a pseudonymous target, nothing else) and
 * the page's story (public/reads.js publicStory), what the page draws of its
 * corrections: the chip's time and line, the innings words, and the
 * commentary with one quiet `correction` line each. When, team-level: never
 * who asked, who approved, why, or a boy's name.
 * @param {any[]} events  @param {{commentary: any[], folded: any, settled: boolean, match: any}} story
 */
export function publicFixes(events, story) {
  const list = correctionsOf(events);
  const after = story.settled || story.match.status === "complete";
  return { at: correctedAt(list), line: correctionText(after), corrected: inningsWords(events, list, story.folded.innings),
    commentary: withCorrectionLines(story.commentary, events, list, after) };
}
