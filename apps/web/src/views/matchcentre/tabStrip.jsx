import { useEffect, useRef, useState } from "react";
import { T } from "../../design/tokens.js";
import { splitTabs } from "../../lib/matchTabs.js";

/**
 * CRI-1.3: the match page's tab strip and its address, shared by the signed-in
 * Match Centre (MatchView.jsx) and the public page (src/public/PublicMatch.jsx).
 * It imports the tokens and lib/matchTabs.js only, so the public bundle can
 * carry it (tools/check-bundle.mjs).
 *
 * Wide, every tab is in one WAI-ARIA tablist, as it always was: arrow keys
 * move and select, Home and End go to its ends. On a phone (lib/matchTabs.js
 * splitTabs) the tablist is Summary, Scorecard and Commentary, and beside it
 * a menu button, More, whose menu holds the rest. The arrow keys run along
 * the tabs and onto More; ArrowDown or ArrowUp on More, or a tap, opens the
 * menu with focus on the tab in use or the first. In the menu the arrows,
 * Home and End move, Tab stays inside it, Escape closes it, and closing gives
 * focus back to More. A tab chosen there is named on More, which then reads
 * as the selected tab. The menu drops in quickly; with reduced motion it
 * simply appears (design/tokens.js `.mc-more-menu`).
 */

/**
 * The id that labels the open panel: its tab, or More when the tab is in its menu.
 * @param {{id: string}[]} tabs  @param {string} tab  @param {boolean} narrow
 */
export const panelLabel = (tabs, tab, narrow) =>
  (splitTabs(tabs, narrow).more.some((t) => t.id === tab) ? "mc-more" : `mc-tab-${tab}`);

// ── The strip ───────────────────────────────────────────

const Chevron = ({ up = false }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"
    style={{ flexShrink: 0, transform: up ? "rotate(180deg)" : "none" }}>
    <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const Tick = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
    <path d="M3 7.5 6 10.5 11 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/**
 * @param {{tabs: {id: string, label: string}[], tab: string, setTab: (id: string) => void, narrow: boolean, label: string}} p
 */
export function TabStrip({ tabs, tab, setTab, narrow, label }) {
  const { strip, more } = splitTabs(tabs, narrow);
  const refs = useRef(/** @type {Record<string, HTMLElement | null>} */ ({}));
  const moreRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const menuRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [open, setOpen] = useState(/** @type {false | "first" | "last"} */ (false));
  const underMore = more.find((t) => t.id === tab) ?? null;
  const inStrip = strip.some((t) => t.id === tab);
  // The row the arrow keys run along: the tabs, then More.
  const row = [...strip.map((t) => t.id), ...(more.length ? ["more"] : [])];

  /** @param {string} id */
  const focusRow = (id) => (id === "more" ? moreRef.current : refs.current[id])?.focus();
  /** @param {import("react").KeyboardEvent} e  @param {string} id */
  const onRowKey = (e, id) => {
    const i = row.indexOf(id), n = row.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to == null) return;
    e.preventDefault();
    if (row[to] !== "more") setTab(row[to]);
    focusRow(row[to]);
  };

  /** @param {boolean} restore  focus back to More (Escape, a choice), or not (a tap elsewhere took it) */
  const close = (restore) => { setOpen(false); if (restore) moreRef.current?.focus(); };
  const items = () => /** @type {HTMLElement[]} */ ([...(menuRef.current?.querySelectorAll('[role="menuitemradio"]') ?? [])]);

  // Opened: focus into the menu; a press anywhere outside it closes it.
  useEffect(() => {
    if (!open) return undefined;
    const list = items();
    const on = list.findIndex((el) => el.getAttribute("aria-checked") === "true");
    (open === "last" ? list[list.length - 1] : list[on >= 0 ? on : 0])?.focus();
    /** @param {Event} e */
    const away = (e) => {
      const t = /** @type {Node} */ (e.target);
      if (!menuRef.current?.contains(t) && !moreRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);
  // Widened with the menu open: there is no More any longer.
  useEffect(() => { if (!more.length && open) setOpen(false); }, [more.length, open]);

  /** @param {import("react").KeyboardEvent} e */
  const onMenuKey = (e) => {
    const list = items(), n = list.length;
    const i = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); return; }
    const to = e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey) ? (i + 1) % n
      : e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? (i - 1 + n) % n
      : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to == null) return;
    e.preventDefault();
    list[to]?.focus();
  };

  const tabStyle = (/** @type {boolean} */ on) => ({
    minHeight: "44px", padding: narrow ? `0 ${T.space.sm}` : `0 ${T.space.lg}`, cursor: "pointer",
    flex: narrow ? "1 1 auto" : "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: T.space.xs,
    background: "transparent", border: "none", borderBottom: `2px solid ${on ? T.brand.accentText : "transparent"}`,
    marginBottom: "-1px", color: on ? T.content.primary : T.content.secondary,
    fontFamily: T.type.body, fontSize: narrow ? "13px" : "14px", fontWeight: on ? 600 : 500, whiteSpace: "nowrap",
  });

  const tablist = (
    <div role="tablist" aria-label={label} data-testid="mc-tabs"
      style={more.length
        ? { display: "flex", flexWrap: "wrap", flex: "1 1 auto", minWidth: 0 }
        : { display: "flex", gap: T.space.xs, overflowX: "auto", borderBottom: `1px solid ${T.line.normal}`,
          margin: `${T.space.lg} 0`, scrollbarWidth: "thin" }}>
      {strip.map((t, i) => {
        const on = t.id === tab;
        return (
          <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" type="button"
            id={`mc-tab-${t.id}`} data-testid={`mc-tab-${t.id}`} aria-selected={on} aria-controls={`mc-panel-${t.id}`}
            // One stop in the tablist: the selected tab, or its first while the tab in use is under More.
            tabIndex={on || (!inStrip && i === 0) ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={(e) => onRowKey(e, t.id)}
            className="os-state" style={tabStyle(on)}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
  if (!more.length) return tablist;

  return (
    <div data-testid="mc-tabs-row" style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "stretch",
      borderBottom: `1px solid ${T.line.normal}`, margin: `${T.space.lg} 0` }}>
      {tablist}
      <button ref={moreRef} type="button" id="mc-more" data-testid="mc-more" className="os-state"
        aria-haspopup="menu" aria-expanded={!!open} aria-controls={open ? "mc-more-menu" : undefined}
        // The visible words lead the name (WCAG 2.5.3): "More tabs", or "Partnerships, more tabs" once one is chosen.
        aria-label={underMore ? `${underMore.label}, more tabs` : "More tabs"}
        data-selected={underMore ? "true" : undefined}
        onClick={() => (open ? close(false) : setOpen("first"))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(e.key === "ArrowUp" ? "last" : "first"); return; }
          onRowKey(e, "more");
        }}
        style={{ ...tabStyle(!!underMore), flex: "0 0 auto" }}>
        {underMore ? underMore.label : "More"}<Chevron up={!!open}/>
      </button>
      {open && (
        <div ref={menuRef} role="menu" id="mc-more-menu" data-testid="mc-more-menu" aria-label="More tabs" className="mc-more-menu"
          onKeyDown={onMenuKey}
          style={{ position: "absolute", right: 0, top: `calc(100% + ${T.space.xs})`, zIndex: 30, minWidth: "min(220px, 100%)", maxWidth: "100%",
            display: "grid", gap: "2px", padding: T.space.xs, background: T.surface.overlay, border: `1px solid ${T.line.normal}`,
            borderRadius: T.radius.md, boxShadow: T.elevation.lg }}>
          {more.map((t) => {
            const on = t.id === tab;
            return (
              <button key={t.id} type="button" role="menuitemradio" aria-checked={on} tabIndex={-1}
                id={`mc-more-${t.id}`} data-testid={`mc-tab-${t.id}`} data-selected={on ? "true" : undefined} className="os-state"
                onClick={() => { setTab(t.id); close(true); }}
                style={{ minHeight: "44px", width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: T.space.md, padding: `0 ${T.space.md}`, background: "transparent", border: "none", borderRadius: T.radius.sm,
                  cursor: "pointer", textAlign: "left", color: T.content.primary, fontFamily: T.type.body, fontSize: "15px",
                  fontWeight: on ? 600 : 500, whiteSpace: "nowrap" }}>
                {t.label}{on && <span style={{ color: T.brand.accentText, display: "inline-flex" }}><Tick/></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
