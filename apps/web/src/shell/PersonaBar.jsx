import { T } from "../design/tokens.js";
import { NAV_META } from "../design/roles.js";
import { Icon } from "../ui/icons.jsx";

/**
 * THE PERSONA HEADER — the family's and the pupil's top bar (redesign step 4
 * §2.0). Their bottom bar is four destinations and no "More", so what a
 * phone application keeps behind the person's name lives here: Settings
 * (theme, colours, devices), raising a concern with the school's DSO —
 * everybody's to do (db/57, CSA p18) — and the way out.
 *
 * `nav-settings` and `nav-safeguarding` are DESTINATIONS (the shell's
 * nav-<key> rule, Sidebar.jsx): the read walk's sweep opens every one a
 * person is offered. Signing out is a control, not a destination.
 *
 * No search and no role switcher: a parent does not search the school, and
 * a live session's roles are the ones the school gave.
 */
function PersonaBar({ active, onNav, onSignOut, userName }) {
  const btn = (on) => ({
    minHeight: "44px", minWidth: "44px", padding: `0 ${T.space.md}`, display: "inline-flex", alignItems: "center",
    justifyContent: "center", gap: T.space.xs, cursor: "pointer", borderRadius: T.radius.pill,
    background: on ? T.surface.interactive : "transparent", border: `1px solid ${on ? T.line.strong : T.line.normal}`,
    color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 500,
  });
  return (
    <header data-testid="persona-bar" className="os-glass"
      style={{ minHeight: "56px", borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none", display: "flex",
        alignItems: "center", gap: T.space.sm, padding: `${T.space.xs} ${T.space.lg}`, flexShrink: 0, position: "sticky", top: 0, zIndex: 100 }}>
      <span aria-hidden="true" style={{ fontFamily: T.type.head, fontSize: "18px", fontWeight: 700, letterSpacing: "0.04em", color: T.content.primary }}>SCRBRD</span>
      <span style={{ flex: 1 }}/>
      <button type="button" onClick={() => onNav("settings")} data-testid="nav-settings" className="pressBtn os-state"
        aria-label={`${NAV_META.settings.label}: ${userName ?? "you"}`} aria-current={active === "settings" ? "page" : undefined}
        style={btn(active === "settings")}>
        <Icon name="user"/>
        <span className="os-username" style={{ maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName}</span>
      </button>
      <button type="button" onClick={() => onNav("safeguarding")} data-testid="nav-safeguarding" className="pressBtn os-state"
        aria-label="Raise a concern" aria-current={active === "safeguarding" ? "page" : undefined} style={btn(active === "safeguarding")}>
        <Icon name="hand-heart"/>
      </button>
      <button type="button" onClick={onSignOut} data-testid="persona-signout" className="pressBtn os-state" aria-label="Sign out" style={btn(false)}>
        <Icon name="log-out"/>
      </button>
    </header>
  );
}

export { PersonaBar };
