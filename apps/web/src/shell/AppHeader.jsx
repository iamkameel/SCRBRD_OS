import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { NAV_META, ROLES, ROLE_FAMILIES, canonicalRole } from "../design/roles.js";
import { D, T } from "../design/tokens.js";
import { useNotifications } from "../lib/notifications.js";
import { Icon } from "../ui/icons.jsx";

// Opened by a tap, so it is not in the first download (the entry chunk is held to a ceiling, tools/check-bundle.mjs).
const GlobalSearch = lazy(() => import("./GlobalSearch.jsx").then((m) => ({ default: m.GlobalSearch })));

/**
 * THE HEADER, one for everybody (DESIGN_DIRECTION §2.1, redesign slice 12): the staff application's, the family's
 * and the pupil's, signed in, on every screen. On a phone, left to right:
 *   1. the SCRBRD mark, which goes to the first screen;
 *   2. the bell, with the one read count (the server's, lib/notifications.js), which opens the notices;
 *   3. "Raise a concern", in words on one line: it never wraps and is never an icon alone (db/57, CSA p18);
 *   4. the person's name, shortened to initials before the concern's words would have to give way, which opens a
 *      short sheet: Settings, Sign out.
 * At 1366 the side rail holds the menu, the mark, the name and the way out (Sidebar.jsx), so the header does not
 * repeat them: it is the bell and "Raise a concern" (and the staff's search and live matches, kept as they were).
 *
 * What left it: the bare sign-out glyph (one mis-tap from a signed-out child), the role chip, and "Switch Role
 * (Demo)" in a real session. The demonstration has no session to be true to, so it keeps its role list: in the
 * name's sheet on a phone, and as its own button on a laptop, where the rail holds the name.
 *
 * Test ids: the header is `topbar` in the staff application and `persona-bar` in the family's and the pupil's,
 * which is how the walks tell which application is laid out. `nav-safeguarding` and `nav-settings` are
 * destinations (the shell's nav-<key> rule, Sidebar.jsx); the account button, the mark and signing out are controls.
 *
 * @param {{ role: string, persona?: string | null, wide?: boolean, demo?: boolean, home: string,
 *           onNav: (key: string) => void, onRoleChange?: (role: string) => void, userName?: string | null,
 *           active?: string | null, onSignOut?: (() => void) | null }} props
 */
function AppHeader({ role, persona = null, wide = false, demo = false, home, onNav, onRoleChange = () => {}, userName = null, active = null, onSignOut = null }) {
  // The unread badge is the SERVER's count of the notices it agreed to send this person (my_notifications, db/89),
  // from the one store every badge reads. Null while uncounted: no badge rather than a number nobody counted.
  const { unread: counted } = useNotifications(role);
  const unread = counted ?? 0;
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBtn = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const staff = !persona;
  // The bell opens the notices: the family's own Notices, which stays on her bar too (EP §1.7), or the one notices
  // screen everybody else has. Named by the screen it opens.
  const bellTo = persona === "family" ? "notices" : "notifications";
  const bellWord = NAV_META[bellTo].label;
  const name = (userName ?? "").trim() || ROLES[role]?.label || "You";

  // Closing the search gives focus back to the button that opened it.
  const closeSearch = () => { setSearchOpen(false); requestAnimationFrame(() => searchBtn.current?.focus()); };
  // Keyboard shortcut: Cmd/Ctrl+K, where there is a search.
  useEffect(() => {
    if (!staff) return undefined;
    const handler = (/** @type {KeyboardEvent} */ e) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [staff]);

  const quiet = (/** @type {boolean} */ on) => ({
    display: "flex", alignItems: "center", justifyContent: "center", minWidth: "44px", minHeight: "44px", flexShrink: 0,
    borderRadius: T.radius.pill, cursor: "pointer", color: T.content.secondary,
    background: on ? T.surface.interactive : "transparent", border: `1px solid ${on ? T.line.strong : "transparent"}`,
  });

  return (
    <>
      {searchOpen && <Suspense fallback={null}><GlobalSearch role={role} onNav={onNav} onClose={closeSearch}/></Suspense>}
      <header data-testid={persona ? "persona-bar" : "topbar"} data-wide={wide ? "true" : "false"}
        className={`os-glass os-hdr ${persona ? "os-hdr--persona" : "os-hdr--staff"}`}
        style={{ minHeight: "52px", borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none", display: "flex", alignItems: "center",
          padding: `0 ${T.space.lg}`, gap: "10px", flexShrink: 0, position: "sticky", top: 0, zIndex: 100 }}>

        {/* 1. The mark: the first screen. The rail carries it at 1366. */}
        {!wide && (
          <button type="button" onClick={() => onNav(home)} data-testid="header-mark" aria-label="SCRBRD, home" className="pressBtn os-hdr-mark"
            style={{ ...quiet(false), padding: "0 2px", fontFamily: T.type.head, fontSize: "17px", fontWeight: 800, letterSpacing: "0.01em", color: T.content.primary }}>
            <span className="os-hdr-mark-word" aria-hidden="true">SCRBRD</span>
            {/* The rail's own small mark, where the staff's row has no room for the word (Sidebar.jsx, collapsed). */}
            <span className="os-hdr-mark-glyph" aria-hidden="true" style={{ width: "30px", height: "30px", borderRadius: D.md, background: D.gradMain, alignItems: "center", justifyContent: "center", fontSize: "14px" }}><Icon name="bat"/></span>
          </button>
        )}

        {/* Live matches: on a laptop only. On a phone it was a bare green dot beside the bar's own Matches (§2.1). */}
        {staff && wide && (
          <button type="button" onClick={() => onNav("matches")} className="pressBtn" data-testid="topbar-live" aria-label="Live matches"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 10px", minHeight: "44px", borderRadius: D.pill, background: D.emerald + "14", border: `1px solid ${D.emerald}30`, cursor: "pointer", flexShrink: 0 }}>
            <div className="live-dot"/><span style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, color: D.emerald, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>LIVE</span>
          </button>
        )}

        {/* Search, or ask Stats-Magic: the staff's, as it was. Its icon alone on a phone, still named. */}
        {staff && (
          <button type="button" ref={searchBtn} onClick={() => setSearchOpen(true)} className="pressBtn os-search" data-testid="topbar-search" aria-label="Search, or ask Stats-Magic"
            style={{ flex: wide ? 1 : "0 0 auto", maxWidth: "420px", display: "flex", alignItems: "center", justifyContent: wide ? "flex-start" : "center", gap: "8px", padding: wide ? "7px 12px" : 0, minHeight: "44px", minWidth: "44px",
              borderRadius: D.pill, background: wide ? D.surf2 : "transparent", border: `1px solid ${wide ? D.border : "transparent"}`, cursor: "pointer", textAlign: "left", color: T.content.secondary }}>
            <span aria-hidden="true" style={{ display: "flex", fontSize: "16px", color: D.textMuted }}><Icon name="search"/></span>
            {wide && <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, flex: 1 }}>Search or ask Stats-Magic…</span>}
            {wide && <span aria-hidden="true" style={{ fontFamily: D.mono, fontSize: "12px", color: D.textMuted, background: D.surf3, padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>⌘K</span>}
          </button>
        )}

        <span aria-hidden="true" style={{ flex: 1, minWidth: 0 }}/>

        {/* 2. The bell, with the server's one count. */}
        <button type="button" onClick={() => onNav(bellTo)} className="pressBtn os-state" data-testid="topbar-alerts"
          aria-label={unread > 0 ? `${bellWord}, ${unread} unread` : bellWord} aria-current={active === bellTo ? "page" : undefined}
          style={{ ...quiet(active === bellTo), position: "relative", fontSize: "18px" }}>
          <Icon name="bell"/>
          {unread > 0 && <span data-testid="topbar-alerts-badge" aria-hidden="true" style={{ position: "absolute", top: "2px", right: 0, background: T.semantic.critical, color: T.surface.canvas, borderRadius: D.pill, padding: "0 4px", fontFamily: D.mono, fontSize: "12px", lineHeight: 1.25, fontWeight: 700, minWidth: "16px", textAlign: "center" }}>{unread}</span>}
        </button>

        {/* 3. Raise a concern: everybody's, in words on one line beside its icon. It carries no mark: whether any
            concern exists is said by nothing here (Q7; SAFEGUARDING_DSO §1 principle 3). */}
        <button type="button" onClick={() => onNav("safeguarding")} className="pressBtn os-state os-concern" data-testid="nav-safeguarding" aria-label="Raise a concern"
          aria-current={active === "safeguarding" ? "page" : undefined}
          style={{ ...quiet(active === "safeguarding"), gap: "6px", padding: "0 10px", border: `1px solid ${active === "safeguarding" ? T.line.strong : T.line.normal}`, color: T.content.primary }}>
          <span aria-hidden="true" style={{ display: "flex", fontSize: "16px" }}><Icon name="hand-heart"/></span>
          <span className="os-concern-text" style={{ fontFamily: T.type.body, fontSize: "13px", fontWeight: 500, lineHeight: 1.15, whiteSpace: "nowrap" }}>Raise{" "}a{" "}concern</span>
        </button>

        {/* 4. The person: Settings and the way out, in a short sheet. The rail holds both at 1366. */}
        {!wide && (
          <AccountMenu name={name} demo={demo} role={role} active={active} onNav={onNav} onSignOut={onSignOut} onRoleChange={onRoleChange}/>
        )}

        {/* The demonstration's role list, on a laptop. Never in a real session. */}
        {wide && demo && <DemoRoleMenu role={role} onRoleChange={onRoleChange}/>}
      </header>
    </>
  );
}

/**
 * Whether the name has shortened to its initials (§2.1): the row gives the name what is left once the mark, the bell
 * and "Raise a concern" have theirs, and a name that would be cut off is said as its initials instead, before the
 * concern's words would ever have to give way. Asked again whenever the header's width changes; a wider header tries
 * the whole name again. Drawn before paint, so neither form flashes.
 * @param {import("react").RefObject<HTMLElement | null>} btn @param {string} name
 */
function useInitials(btn, name) {
  const [short, setShort] = useState(false);
  const at = useRef({ short: false, width: 0 });
  useLayoutEffect(() => {
    const el = /** @type {HTMLElement | null | undefined} */ (btn.current?.querySelector(".os-hdr-name"));
    const bar = btn.current?.closest("header");
    if (!el || !bar) return undefined;
    const check = () => {
      const width = bar.clientWidth;
      if (at.current.short) {
        if (width > at.current.width) { at.current = { short: false, width }; setShort(false); }
        return;
      }
      if (el.scrollWidth > el.clientWidth + 1) { at.current = { short: true, width }; setShort(true); }
    };
    check();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(bar);
    return () => ro?.disconnect();
  }, [btn, name, short]);
  return short;
}

/** "A Coach" → "AC", "Sarah" → "S": the first letters of the first and last words. */
export function initialsOf(/** @type {string | null | undefined} */ name) {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = [...words[0]][0] ?? "";
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * A menu that opens from a button: focus moves to its first item (or the checked one), the arrows and Home and End
 * move within it, Escape closes it and gives focus back to the button, and a tap outside or a Tab away closes it.
 * @param {boolean} open @param {() => void} close
 * @param {import("react").RefObject<HTMLElement | null>} btn @param {import("react").RefObject<HTMLElement | null>} menu
 */
function useMenuKeys(open, close, btn, menu) {
  useEffect(() => {
    if (!open) return undefined;
    const items = () => /** @type {HTMLElement[]} */ ([...(menu.current?.querySelectorAll('[role^="menuitem"]') ?? [])]);
    (/** @type {HTMLElement | null} */ (menu.current?.querySelector('[aria-checked="true"]')) ?? items()[0])?.focus();
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); btn.current?.focus(); return; }
      if (e.key === "Tab") { close(); return; }
      const all = items();
      const at = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
      const to = e.key === "ArrowDown" ? (at + 1) % all.length : e.key === "ArrowUp" ? (at - 1 + all.length) % all.length
        : e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : -1;
      if (to < 0 || !all.length) return;
      e.preventDefault();
      all[to].focus();
    };
    const away = (/** @type {Event} */ e) => { const t = /** @type {Node} */ (e.target); if (!menu.current?.contains(t) && !btn.current?.contains(t)) close(); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", away);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", away); };
  }, [open, close, btn, menu]);
}

const sheetStyle = () => ({
  position: "absolute", right: 0, top: "calc(100% + 6px)", background: T.surface.overlay, border: `1px solid ${T.line.normal}`,
  borderRadius: T.radius.lg, overflowY: "auto", minWidth: "220px", maxWidth: "calc(100vw - 16px)", maxHeight: "min(70vh,520px)",
  zIndex: 200, boxShadow: T.elevation.lg, padding: `${T.space.xs} 0`,
});
const itemStyle = (/** @type {boolean} */ on = false) => ({
  width: "100%", padding: "8px 14px", minHeight: "44px", display: "flex", alignItems: "center", gap: "10px",
  background: on ? T.surface.interactive : "transparent", border: "none", cursor: "pointer", textAlign: "left",
  fontFamily: T.type.body, fontSize: "14px", color: T.content.primary,
});
const headStyle = () => ({
  padding: "10px 14px 4px", fontFamily: T.type.head, fontSize: "12px", fontWeight: 700, letterSpacing: "0.1em",
  textTransform: "uppercase", color: T.content.tertiary,
});

/** The person's name (or initials), and its short sheet: Settings, Sign out; the demonstration's roles under them. */
function AccountMenu({ name, demo, role, active, onNav, onSignOut, onRoleChange }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const menu = useRef(/** @type {HTMLDivElement | null} */ (null));
  const close = useRef(() => setOpen(false)).current;
  useMenuKeys(open, close, btn, menu);
  const go = (/** @type {() => void} */ fn) => { setOpen(false); fn(); };
  const short = useInitials(btn, name);
  return (
    <div style={{ position: "relative", flexShrink: 1, minWidth: 0, display: "flex" }}>
      <button type="button" ref={btn} onClick={() => setOpen(!open)} className="pressBtn os-state os-hdr-account" data-testid="header-account"
        data-short={short ? "true" : "false"} aria-haspopup="menu" aria-expanded={open} aria-label={`${name}: Settings, Sign out`}
        style={{ display: "flex", alignItems: "center", gap: "4px", minHeight: "44px", minWidth: "44px", maxWidth: "100%", padding: "0 10px", flexShrink: 1,
          borderRadius: T.radius.pill, cursor: "pointer", color: T.content.primary,
          background: open || active === "settings" ? T.surface.interactive : "transparent", border: `1px solid ${open || active === "settings" ? T.line.strong : "transparent"}`,
          fontFamily: T.type.body, fontSize: "13px", fontWeight: 600 }}>
        <span className="os-hdr-name" style={{ minWidth: 0, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <span className="os-hdr-init" aria-hidden="true" style={{ whiteSpace: "nowrap" }}>{initialsOf(name) || "?"}</span>
        <span aria-hidden="true" style={{ fontSize: "12px", color: T.content.secondary, flexShrink: 0 }}>▾</span>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={name} data-testid="header-account-menu" style={sheetStyle()}>
          <button type="button" role="menuitem" onClick={() => go(() => onNav("settings"))} className="pressBtn os-state" data-testid="nav-settings"
            aria-current={active === "settings" ? "page" : undefined} style={itemStyle(active === "settings")}>
            <span aria-hidden="true" style={{ display: "flex", color: T.content.secondary }}><Icon name="settings"/></span>Settings
          </button>
          {onSignOut && (
            <button type="button" role="menuitem" onClick={() => go(onSignOut)} className="pressBtn os-state" data-testid="header-signout" style={itemStyle()}>
              <span aria-hidden="true" style={{ display: "flex", color: T.content.secondary }}><Icon name="log-out"/></span>Sign out
            </button>
          )}
          {demo && (
            <div style={{ borderTop: `1px solid ${T.line.subtle}`, marginTop: T.space.xs }}>
              <div style={headStyle()}>Switch Role (Demo)</div>
              <RoleOptions role={role} onPick={(r) => go(() => { onRoleChange(r); btn.current?.focus(); })}/>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The demonstration's role list on a laptop, where the rail holds the name and the way out. */
function DemoRoleMenu({ role, onRoleChange }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const menu = useRef(/** @type {HTMLDivElement | null} */ (null));
  const close = useRef(() => setOpen(false)).current;
  useMenuKeys(open, close, btn, menu);
  const rc = ROLES[role];
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button type="button" ref={btn} onClick={() => setOpen(!open)} className="pressBtn" data-testid="topbar-role" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Switch role (demo): ${rc?.label ?? "Role"}`}
        style={{ display: "flex", alignItems: "center", gap: "6px", padding: "5px 12px", minHeight: "44px", minWidth: "44px", borderRadius: D.pill, background: D.surf2, border: `1px solid ${D.border}`, cursor: "pointer" }}>
        <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textSecondary, whiteSpace: "nowrap" }}>Switch role</span>
        <span aria-hidden="true" style={{ fontSize: "12px", color: D.textMuted }}>▾</span>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Switch role" style={sheetStyle()}>
          <div style={headStyle()}>Switch Role (Demo)</div>
          <RoleOptions role={role} onPick={(r) => { onRoleChange(r); setOpen(false); btn.current?.focus(); }}/>
        </div>
      )}
    </div>
  );
}

/**
 * The demonstration's roles, grouped by family, ONE ENTRY PER ROLE. ROLES is the lookup table, whose aliases carry
 * their target's label; ROLE_FAMILIES is the canonical set, so no role is listed twice.
 * @param {{ role: string, onPick: (role: string) => void }} props
 */
export function RoleOptions({ role, onPick }) {
  return Object.entries(ROLE_FAMILIES).map(([family, members]) => (
    <div key={family} role="group" aria-label={family}>
      <div aria-hidden="true" style={{ ...headStyle(), padding: "9px 14px 3px", letterSpacing: "0.12em" }}>{family}</div>
      {members.map((r) => {
        const rc = ROLES[r];
        const current = role === r || canonicalRole(role) === r;
        return (
          <button type="button" key={r} role="menuitemradio" aria-checked={current} onClick={() => onPick(r)}
            className="pressBtn os-state" data-testid={`role-option-${r}`} data-selected={current}
            style={{ ...itemStyle(current), fontSize: "12px", gap: "8px" }}>
            <span aria-hidden="true" style={{ display: "flex", color: T.content.secondary }}><Icon name={rc.icon}/></span>
            <span style={{ color: current ? rc.color : T.content.secondary }}>{rc.label}</span>
          </button>
        );
      })}
    </div>
  ));
}

export { AppHeader };
