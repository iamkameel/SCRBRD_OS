/**
 * The pad on a match that has closed (Kameel's solo run, 27 Nov 2026).
 *
 * A fixture called off (db/132) or complete (db/33) takes no more balls: the
 * server refuses the claim, the lease and every ball sent after it, and a
 * ball sent anyway goes to the lead's review, not into the scorebook. The pad
 * used to say so in its banner and leave every key live, so a tap was held
 * and the pill read "For review 1" with nothing saying what that meant.
 *
 * The pad learns the match is closed from the server's answer to its claim,
 * which it makes as it opens (PadSync.attach, `reason`), so a scorer opening
 * a called-off match sees this at once, before any tap. Then the keys are
 * off, Undo is gone, the reason is said beside them, a ball the server set
 * aside is said in words, and there is one way out.
 */
import { T } from "../design/tokens.js";
import { useTheme } from "../design/theme.js";

/** The reasons, from the server, that close a match to scoring. */
export const CLOSED_REASONS = new Set(["match_complete", "match_abandoned"]);

/**
 * Why this pad's match is closed, or null.
 * @param {{reason?: string | null} | null | undefined} status PadSync's status
 * @param {{pilotCalledOff?: boolean}} [o] a Pilot Match called off on this phone
 */
export function closedReason(status, { pilotCalledOff = false } = {}) {
  const r = status?.reason ?? null;
  if (r && CLOSED_REASONS.has(r)) return r;
  return pilotCalledOff ? "match_abandoned" : null;
}

/**
 * The words, in sentence case: why the keys are off, and what the balls the
 * server set aside are.
 * @param {string} reason match_complete | match_abandoned
 * @param {number} [rejected] balls this phone sent that the server held for review
 */
export function closedWords(reason, rejected = 0) {
  const called = reason === "match_abandoned";
  const lead = called ? "This match was called off. Scoring has closed."
    : "This match is complete. Scoring has closed.";
  const why = called ? "the match was called off" : "the result was recorded";
  const n = Number.isInteger(rejected) && rejected > 0 ? rejected : 0;
  const review = n
    ? `${n} ${n === 1 ? "ball" : "balls"} not recorded: ${why}. ${n === 1 ? "It is" : "They are"} with the match-day lead for review.`
    : null;
  const after = called ? null : "A correction now goes through an amendment request.";
  return { lead, review, after, pill: n ? `${n} not recorded` : null };
}

/**
 * The keys, in one fieldset: off while play is stopped (SCRBRD-130 R1) or
 * the match has closed. A disabled fieldset turns off every key in it at once.
 */
export function PadKeys({ off, children }) {
  return (
    <fieldset disabled={!!off} data-testid="pad-keys" aria-disabled={!!off || undefined}
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: off ? 0.45 : 1 }}>
      {children}
    </fieldset>
  );
}

/**
 * Said beside the keys on a closed match, with the one way out: the
 * scorer's own way back (the pad's exit), else the match's scorecard tab.
 * @param {{reason: string, rejected?: number, onOut?: (() => void) | null, outWords?: string}} p
 */
export function PadClosed({ reason, rejected = 0, onOut = null, outWords = "See the scorecard" }) {
  useTheme();
  const w = closedWords(reason, rejected);
  return (
    <div role="status" aria-live="polite" data-testid="pad-closed" data-reason={reason}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `${T.space.sm} ${T.space.md}`, marginBottom: T.space.md,
        padding: T.space.md, borderRadius: T.radius.md, border: `2px solid ${T.line.strong}`, background: T.surface.raised }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <p data-testid="pad-closed-words" style={{ margin: 0, fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, lineHeight: 1.4, color: T.content.primary }}>
          {w.lead}
        </p>
        {w.review && (
          <p data-testid="pad-closed-review" style={{ margin: 0, fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.4, color: T.content.secondary }}>
            {w.review}
          </p>
        )}
        {w.after && (
          <p style={{ margin: 0, fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.4, color: T.content.secondary }}>{w.after}</p>
        )}
      </div>
      {onOut && (
        <button type="button" data-testid="pad-closed-out" className="pressBtn os-state" onClick={onOut}
          style={{ minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.md, cursor: "pointer", border: "none",
            background: T.content.primary, color: T.surface.base, fontFamily: T.type.body, fontSize: "15px", fontWeight: 600, flexShrink: 0 }}>
          {outWords}
        </button>
      )}
    </div>
  );
}
