import { useEffect, useId, useRef, useState } from "react";
import { D, T } from "../design/tokens.js";
import { ThemeChoice } from "../ui/ThemeChoice.jsx";

/**
 * The pad's menu — the "⋯" in its top bar.
 *
 * Today it holds one thing: the theme (DESIGN_DIRECTION §3.1, decision 2),
 * because the pad is the screen used in direct sun, and a scorer who needs
 * Daylight should not have to leave the match to find Settings. Step 2 of the
 * redesign moves the pad's other occasional actions in here.
 *
 * A disclosure, not an ARIA menu: what opens is a small panel with a
 * radiogroup in it, which Tab reaches and arrow keys drive. Escape or a tap
 * outside closes it and focus returns to the button. It records nothing and
 * touches no match state.
 */
const PANEL_WIDTH = 320, GUTTER = 12;

export function PadMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef(null);
  const panel = useRef(null);
  // Where the panel sits: under the button, but never off the screen. At
  // phone width the button is mid-bar, and a panel hung from its right edge
  // ran off the left of the page.
  const [at, setAt] = useState(null);
  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) {
      const vw = window.innerWidth, w = Math.min(PANEL_WIDTH, vw - 2 * GUTTER);
      setAt({ top: r.bottom + 8, left: Math.max(GUTTER, Math.min(r.right - w, vw - w - GUTTER)), width: w });
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    const onDown = (e) => {
      if (panel.current?.contains(e.target) || button.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button ref={button} type="button" onClick={toggle} className="pressBtn"
        data-testid="pad-menu" aria-label="Pad menu" aria-expanded={open} aria-controls={open ? panelId : undefined}
        style={{ minWidth: "32px", padding: "4px 10px", borderRadius: D.pill, cursor: "pointer",
          background: open ? T.surface.interactive : "transparent", border: `1px solid ${D.border}`,
          fontFamily: D.head, fontSize: "12px", fontWeight: 700, lineHeight: 1, color: D.textSecondary }}>
        ⋯
      </button>
      {open && (
        <div ref={panel} id={panelId} data-testid="pad-menu-panel" role="group" aria-label="Pad menu"
          style={{ position: "fixed", top: at ? `${at.top}px` : "56px", left: at ? `${at.left}px` : `${GUTTER}px`, zIndex: 300,
            width: at ? `${at.width}px` : `min(${PANEL_WIDTH}px, calc(100vw - ${2 * GUTTER}px))`,
            padding: T.space.md, borderRadius: T.radius.lg, background: T.surface.overlay,
            border: `1px solid ${T.line.normal}`, boxShadow: T.elevation.lg }}>
          <div style={{ fontFamily: T.type.body, fontSize: "12px", fontWeight: 600, letterSpacing: "0.06em",
            textTransform: "uppercase", color: T.content.secondary, marginBottom: T.space.sm }}>Appearance</div>
          <ThemeChoice testid="pad-theme-choice" label="Pad appearance"/>
        </div>
      )}
    </div>
  );
}
