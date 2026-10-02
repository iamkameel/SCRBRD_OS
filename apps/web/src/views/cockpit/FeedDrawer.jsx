import { useEffect, useRef, useState } from "react";
import { T } from "../../design/tokens.js";

/**
 * THE FEED DRAWER (SCRBRD-137 phase A; design §4): a drawer of cards, each a
 * rule over data the reader already holds, with its evidence as text, its
 * count, the read it came from and the capability that let him see it.
 *
 * It pushes nothing and reaches no parent and no pupil (D11): it is drawn only
 * behind the cockpit's entry rule. "Seen" means "I have seen this", per person,
 * per evidence, on this device (D13): it changes no row and tells nobody, and
 * a card whose evidence changes comes back. Nothing is ranked or scored; the
 * cards are in the rules' fixed order.
 *
 * A dialog: Escape closes it, focus moves in and Tab stays inside, and focus
 * returns to the button that opened it. Cards do not animate in.
 *
 * @param {{feed: ReturnType<typeof import("./useCockpit.js").useFeed>, gate: {role: string}, onClose: () => void}} p
 */
export function FeedDrawer({ feed, gate, onClose }) {
  const panel = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [showSeen, setShowSeen] = useState(false);
  const cards = showSeen ? feed.cards : feed.open;

  useEffect(() => {
    panel.current?.focus();
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll("button:not([disabled])")];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); /** @type {HTMLElement} */ (last).focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); /** @type {HTMLElement} */ (first).focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** @type {Record<string, number>} */
  const perRule = {};
  for (const c of feed.cards) perRule[c.rule] = (perRule[c.rule] ?? 0) + 1;

  return (
    <div data-testid="signals-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: T.glass.scrim, zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="signals-title" tabIndex={-1} data-testid="signals"
        style={{ background: T.surface.base, color: T.content.primary, width: "100%", maxWidth: "460px", height: "100%", overflowY: "auto",
          borderLeft: `1px solid ${T.line.normal}`, outline: "none", display: "grid", alignContent: "start", gap: T.space.md, padding: T.space.lg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: T.space.md }}>
          <h2 id="signals-title" style={{ ...T.role.title.md, margin: 0, color: T.content.primary }}>
            Signals <span data-testid="signals-count" style={{ ...T.role.figure.sm }}>{feed.open.length}</span>
          </h2>
          <button type="button" data-testid="signals-close" className="os-state" onClick={onClose} style={btn()}>Close</button>
        </div>
        <p style={quiet()}>
          Each card is a rule over what this screen has already read. Nothing here is sent to anyone, and Seen only hides a card for you.
        </p>

        {cards.length === 0 && (
          <p data-testid="signals-empty" style={{ ...T.role.body, color: T.content.secondary, margin: 0 }}>
            {feed.cards.length === 0 ? "Nothing to flag: no rule has anything true to say about this fixture."
              : "You have seen every signal for this fixture."}
          </p>
        )}

        {cards.map((c) => {
          const seen = feed.isSeen(c);
          return (
            <article key={c.base + c.key} data-testid={`signal-${c.rule}`} data-rule={c.rule} data-count={c.count} data-seen={seen ? "yes" : "no"}
              aria-labelledby={`sig-${c.base}`}
              style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg, background: T.surface.raised, padding: T.space.md, display: "grid", gap: T.space.xs }}>
              <h3 id={`sig-${c.base}`} style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>
                {c.title}{perRule[c.rule] > 1 ? ` · ${perRule[c.rule]}` : ""}
              </h3>
              {c.lines.map((l, i) => <p key={i} style={{ ...T.role.body, margin: 0, color: T.content.primary }}>{l}</p>)}
              <p style={quiet()}>
                From {c.source}. You see it through {gate.role} with {c.via.join(", ")}.
              </p>
              {c.dismissable
                ? (!seen && <button type="button" data-testid={`signal-seen-${c.rule}`} className="os-state" onClick={() => feed.dismiss(c)} style={{ ...btn(), justifySelf: "start" }}>Seen</button>)
                : <p style={quiet()}>This clears by itself.</p>}
            </article>
          );
        })}

        {feed.seenCount > 0 && (
          <button type="button" data-testid="signals-show-seen" className="os-state" onClick={() => setShowSeen((v) => !v)} style={{ ...btn(), justifySelf: "start" }}>
            {showSeen ? "Hide the ones I have seen" : `Show ${feed.seenCount} I have seen`}
          </button>
        )}
      </div>
    </div>
  );
}

const quiet = () => ({ ...T.role.body, fontSize: "14px", color: T.content.secondary, margin: 0 });
const btn = () => ({ minHeight: "44px", padding: `0 ${T.space.lg}`, background: "transparent", color: T.content.primary,
  border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 600 });
