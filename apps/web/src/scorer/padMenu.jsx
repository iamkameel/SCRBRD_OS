import { useEffect, useId, useRef, useState } from "react";
import { T } from "../design/tokens.js";
import { ThemeChoice } from "../ui/ThemeChoice.jsx";

/**
 * The pad's menu — the "⋯" at the end of its title bar.
 *
 * The pad's occasional things live here, so the title bar is one row that
 * fits a phone (DESIGN_DIRECTION §4): how the pad asks (Basic Scoring, pro
 * mode), what the umpires change (revise the overs or the target, penalty
 * runs), and the theme (§3.1, decision 2) — the pad is the screen used in
 * direct sun, and a scorer who needs Daylight should not have to leave the
 * match to find Settings.
 *
 * A disclosure, not an ARIA menu: what opens is a small panel of ordinary
 * buttons and a radiogroup, which Tab reaches and arrow keys drive. Escape or
 * a tap outside closes it and focus returns to the button. `children` is a
 * function given `close`, so an item that opens a sheet closes the menu
 * first. The menu itself records nothing: every item is a handler the pad
 * already had.
 */
const PANEL_WIDTH = 340, GUTTER = 12;

export function PadMenu({ children }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef(null);
  const panel = useRef(null);
  // Where the panel sits: under the button, but never off the screen.
  const [at, setAt] = useState(null);
  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) {
      const vw = window.innerWidth, w = Math.min(PANEL_WIDTH, vw - 2 * GUTTER);
      setAt({ top: r.bottom + 8, left: Math.max(GUTTER, Math.min(r.right - w, vw - w - GUTTER)), width: w,
              maxHeight: Math.max(200, window.innerHeight - r.bottom - 8 - GUTTER) });
    }
    setOpen((o) => !o);
  };
  const close = () => { setOpen(false); button.current?.focus(); };

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
      <button ref={button} type="button" onClick={toggle} className="pressBtn os-state"
        data-testid="pad-menu" aria-label="Pad menu" aria-expanded={open} aria-controls={open ? panelId : undefined}
        style={{ width: "44px", height: "44px", padding: 0, borderRadius: T.radius.md, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: open ? T.surface.interactive : "transparent", border: `1px solid ${T.line.normal}`,
          fontFamily: T.type.body, fontSize: "22px", fontWeight: 700, lineHeight: 1, color: T.content.primary }}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div ref={panel} id={panelId} data-testid="pad-menu-panel" role="group" aria-label="Pad menu"
          style={{ position: "fixed", top: at ? `${at.top}px` : "60px", left: at ? `${at.left}px` : `${GUTTER}px`, zIndex: 300,
            width: at ? `${at.width}px` : `min(${PANEL_WIDTH}px, calc(100vw - ${2 * GUTTER}px))`,
            maxHeight: at ? `${at.maxHeight}px` : "80vh", overflowY: "auto",
            padding: T.space.md, borderRadius: T.radius.lg, background: T.surface.overlay,
            border: `1px solid ${T.line.normal}`, boxShadow: T.elevation.lg, display: "grid", gap: T.space.md }}>
          {children?.(close)}
          <section aria-label="Appearance">
            <h3 style={menuHeading()}>Appearance</h3>
            <ThemeChoice testid="pad-theme-choice" label="Pad appearance"/>
          </section>
        </div>
      )}
    </div>
  );
}

const menuHeading = () => ({ ...T.role.label, color: T.content.secondary, margin: `0 0 ${T.space.sm}` });

/** A titled group of items in the menu. */
export function MenuSection({ title, children }) {
  return (
    <section aria-label={title}>
      <h3 style={menuHeading()}>{title}</h3>
      <div style={{ display: "grid", gap: T.space.xs }}>{children}</div>
    </section>
  );
}

/**
 * One item. `checked` makes it a switch (role="switch"), for a way of scoring
 * that is on or off; without it, an action that opens a sheet.
 */
export function MenuItem({ label, hint, checked, onClick, testid }) {
  const isSwitch = typeof checked === "boolean";
  return (
    <button type="button" data-testid={testid} onClick={onClick} className="pressBtn os-state"
      role={isSwitch ? "switch" : undefined} aria-checked={isSwitch ? checked : undefined}
      style={{ width: "100%", minHeight: "48px", padding: `${T.space.sm} ${T.space.md}`, borderRadius: T.radius.md,
        cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: T.space.md,
        background: T.surface.base, border: `1px solid ${isSwitch && checked ? T.content.primary : T.line.normal}`,
        color: T.content.primary }}>
      <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "2px" }}>
        <span style={{ fontFamily: T.type.body, fontSize: "16px", fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ fontFamily: T.type.body, fontSize: "13px", lineHeight: 1.35, color: T.content.secondary }}>{hint}</span>}
      </span>
      {isSwitch && (
        <span aria-hidden="true" style={{ flexShrink: 0, width: "40px", height: "24px", borderRadius: T.radius.pill, position: "relative",
          background: checked ? T.content.primary : T.fill.track, border: `1px solid ${T.line.strong}` }}>
          <span style={{ position: "absolute", top: "2px", left: checked ? "18px" : "2px", width: "18px", height: "18px",
            borderRadius: "50%", background: checked ? T.surface.canvas : T.content.secondary,
            transition: `left ${T.motion.micro} ${T.motion.swift}` }}/>
        </span>
      )}
    </button>
  );
}
