/**
 * THE SCHOOL'S TERMS, WHOLE (GA-I20 D7, N6; docs/design/GUARDIAN_TERMS.md):
 * the one drawing of the approved text, used where a parent agrees for her own
 * link and where the office records a family's agreement, so the two read the
 * same words. The text and its version are lib/guardianLink.js's constant;
 * nothing here edits a sentence, only fills the two contacts.
 *
 * It scrolls inside itself and says when its last section has been on screen
 * (`onEnd`), so the screen that asks "I agree" can wait for it. A text short
 * enough to fit is at its end at once. One landmark, keyboard-scrollable.
 *
 * Floors: body at 15px, nothing under 12px; no motion.
 */
import { useEffect, useRef } from "react";
import { T } from "../design/tokens.js";
import { GUARDIAN_TERMS, renderTerms, termsContacts, termsRuns } from "../lib/guardianLink.js";

/** @param {{ text: string }} p */
function Runs({ text }) {
  return termsRuns(text).map((r, i) => (r.kind === "strong" ? <strong key={i}>{r.text}</strong>
    : r.kind === "em" ? <em key={i}>{r.text}</em> : <span key={i}>{r.text}</span>));
}

/**
 * @param {{ schoolName?: string | null, onEnd?: () => void, maxHeight?: string, testid?: string }} p
 */
export function TermsText({ schoolName, onEnd, maxHeight = "55vh", testid = "terms-text" }) {
  const box = useRef(/** @type {HTMLDivElement | null} */ (null));
  const told = useRef(false);
  const check = () => {
    const el = box.current;
    if (!el || told.current) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) { told.current = true; onEnd?.(); }
  };
  useEffect(check);  // a text that fits is read to its end already
  const sections = renderTerms(termsContacts(schoolName));
  const para = { ...T.role.body, color: T.content.primary, margin: 0 };
  return (
    <div ref={box} onScroll={check} role="region" tabIndex={0} data-testid={testid}
      aria-label={`${GUARDIAN_TERMS.title}, version ${GUARDIAN_TERMS.version}`}
      style={{ maxHeight, overflowY: "auto", display: "grid", gap: T.space.sm, padding: `${T.space.sm} ${T.space.md}`,
        border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, background: T.surface.base }}>
      <h3 style={{ ...T.role.title.md, color: T.content.primary, margin: 0 }}>{GUARDIAN_TERMS.title}</h3>
      <p style={{ ...para, color: T.content.secondary }}><em>Version {GUARDIAN_TERMS.version}</em></p>
      {sections.map((s, i) => (
        <section key={i} style={{ display: "grid", gap: "4px" }}>
          {s.heading && <h4 style={{ ...para, fontWeight: 700 }}>{s.heading}</h4>}
          {s.paragraphs.map((p, j) => <p key={j} style={para}><Runs text={p}/></p>)}
        </section>
      ))}
      <p data-testid={`${testid}-end`} style={{ ...para, color: T.content.secondary }}>End of the terms.</p>
    </div>
  );
}
