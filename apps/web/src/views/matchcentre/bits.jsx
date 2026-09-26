import { T } from "../../design/tokens.js";
import { Icon } from "../../ui/icons.jsx";

/**
 * A side's name, in full where there is room and by code where not
 * (DESIGN_DIRECTION §10 item 6). Both are in the page; GLOBAL_CSS's
 * `.mc-full` / `.mc-short` show one of them by the width of the screen
 * (display:none, so a screen reader reads the one on screen).
 */
export function SideName({ side, testid }) {
  return (
    <span data-testid={testid}>
      <span className="mc-full">{side.full}</span>
      <span className="mc-short">{side.short}</span>
    </span>
  );
}

/** A plain line of text where a panel has nothing else to say. */
export function Quiet({ children, testid }) {
  return <p data-testid={testid} style={{ ...T.role.body, color: T.content.secondary, padding: `${T.space.xl} 0`, margin: 0 }}>{children}</p>;
}

/** A card's heading: the label style, with an icon. */
export function CardHead({ icon, children }) {
  return (
    <h2 style={{ ...T.role.label, color: T.content.secondary, margin: 0, padding: `${T.space.sm} ${T.space.md}`,
      borderBottom: `1px solid ${T.line.normal}`, display: "flex", gap: T.space.xs, alignItems: "center" }}>
      {icon && <Icon name={icon}/>}{children}
    </h2>
  );
}

/** A card: a border, not a tint (§3.7). */
export function Panel({ children, testid, style }) {
  return (
    <section data-testid={testid} style={{ border: `1px solid ${T.line.normal}`, borderRadius: T.radius.lg, overflow: "hidden",
      background: T.surface.raised, ...style }}>
      {children}
    </section>
  );
}
