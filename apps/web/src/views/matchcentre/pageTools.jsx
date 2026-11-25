import { useEffect, useId, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { Icon } from "../../ui/icons.jsx";
import PageLinks from "./pageLinks.jsx";

/**
 * THE MATCH PAGE'S TOOLS (redesign slice 10; DESIGN_DIRECTION §2.1 and §3.3
 * Flow A: "Share and Big screen sit in one overflow"). The signed-in match
 * page's Big screen, Share and ground display, which were their own rows
 * between Back and the match.
 *
 * Where there is room they sit in Back's row. On a phone they always sit in
 * one "More" button that opens a small panel beneath it, even one alone
 * (Kameel, 25 Nov: "Share always under More"), so the row never changes shape
 * as the reads that offer each tool answer one by one. Each item is the
 * caller's to offer: this decides only where they go.
 *
 * The panel is a disclosure, not a menu: Share says "Link copied" in it, so
 * it stays open until the person closes it. Escape, or a press outside it,
 * closes it, and Escape gives focus back to More. Big screen closes it as it
 * opens the screen. It appears in place, with no motion.
 *
 * @param {{phone: boolean, big: (() => void) | null,
 *          links: {share: {url: string, title: string, text?: string} | null, display: string | null} | null}} p
 */
export function PageTools({ phone, big, links }) {
  const [open, setOpen] = useState(false);
  const button = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const panel = useRef(/** @type {HTMLDivElement | null} */ (null));
  const id = useId();
  const n = (big ? 1 : 0) + (links?.share ? 1 : 0) + (links?.display ? 1 : 0);
  const folded = phone && n > 0;

  useEffect(() => {
    if (!open) return undefined;
    /** @param {Event} e */
    const away = (e) => {
      const t = /** @type {Node} */ (e.target);
      if (!panel.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  // Widened with the panel open: the tools are back in the row.
  useEffect(() => { if (!folded && open) setOpen(false); }, [folded, open]);

  if (n === 0) return null;
  const bigButton = big && (
    <button type="button" onClick={() => { setOpen(false); big(); }} data-testid="mc-bigscreen-open" className="pressBtn os-state"
      style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
        background: "transparent", color: T.content.primary, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill,
        cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 500 }}>
      <Icon name="tv"/> Big screen
    </button>
  );
  const linkRow = links && (links.share || links.display) ? <PageLinks share={links.share} display={links.display}/> : null;
  if (!folded) return <>{bigButton}{linkRow}</>;

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" ref={button} data-testid="mc-tools-open" className="pressBtn os-state"
        aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); } }}
        style={{ minHeight: "44px", minWidth: "44px", padding: `0 ${T.space.md}`, display: "inline-flex", alignItems: "center", gap: T.space.xs,
          background: open ? T.surface.interactive : "transparent", color: T.content.primary, border: `1px solid ${T.line.normal}`,
          borderRadius: T.radius.pill, cursor: "pointer", fontFamily: T.type.body, fontSize: "14px", fontWeight: 500 }}>
        More<span className="sr-only"> for this match</span><Icon name="chevron-down"/>
      </button>
      {open && (
        <div ref={panel} id={id} role="group" aria-label="More for this match" data-testid="mc-tools"
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus(); } }}
          style={{ position: "absolute", right: 0, top: `calc(100% + ${T.space.xs})`, zIndex: 30, width: "max-content",
            minWidth: "220px", maxWidth: "calc(100vw - 32px)", display: "grid", gap: T.space.sm, padding: T.space.sm,
            background: T.surface.overlay, border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, boxShadow: T.elevation.lg }}>
          {/* Each tool on its own line, the whole width of the panel. */}
          <style>{`[data-testid="mc-tools"] [data-testid="mc-page-links"]{flex-direction:column;align-items:stretch}
[data-testid="mc-tools"] .pressBtn{justify-content:flex-start;width:100%}`}</style>
          {bigButton}
          {linkRow}
        </div>
      )}
    </span>
  );
}
