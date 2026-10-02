import { T, clr } from "../../design/tokens.js";

/**
 * What every section of the public home page shares (SCRBRD-142 §6.1).
 *
 * Styles are functions, not constants: the tokens switch in place when the
 * theme does (design/tokens.js), so a value copied into a module-level
 * constant would hold whichever theme was current at import. Every size here
 * is at or above the 12px text floor and every control at or above the 44px
 * touch floor that tools/smoke-a11y.mjs ratchets.
 */

export const homeHead = () => ({ fontFamily: T.type.head, margin: 0 });
export const homeBody = () => ({ fontFamily: T.type.body, margin: 0 });

/** The small uppercase heading over a section. */
export const eyebrow = () => ({
  ...homeHead(), fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
  color: T.content.tertiary,
});

/** A section's box: a readable width and the 16px gutter at phone width. */
export function Section({ id, label, narrow, children }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined}
      style={{ padding: `${T.space.xl} ${T.space.lg}`, maxWidth: narrow ? "760px" : "1040px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {label && <h2 id={id ? `${id}-h` : undefined} style={{ ...eyebrow(), marginBottom: T.space.lg }}>{label}</h2>}
      {children}
    </section>
  );
}

const btn = () => ({
  minHeight: "44px", minWidth: "44px", padding: "0 20px", borderRadius: T.radius.pill, boxSizing: "border-box",
  fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, textDecoration: "none", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});

/** A link drawn as a button: `solid` is the one call to action, `ghost` the quieter one. */
export function LinkButton({ href, solid, children, testId, rel }) {
  const style = solid
    ? { ...btn(), background: T.light.action, border: "none", color: T.light.ink, boxShadow: `0 4px 20px ${clr(T.brand.blue, 0.4)}` }
    : { ...btn(), background: "transparent", border: `1px solid ${T.line.strong}`, color: T.content.secondary };
  return <a href={href} rel={rel} data-testid={testId} className="pressBtn" style={style}>{children}</a>;
}

/** A plain text link, 44px tall so it can be tapped. */
export const textLink = () => ({
  ...homeBody(), fontSize: "14px", color: T.brand.blueText, textDecoration: "underline", textUnderlineOffset: "3px",
  display: "inline-flex", alignItems: "center", minHeight: "44px",
});

const SA = "Africa/Johannesburg";

/** "10:00", in South African time, from an ISO instant. Empty when it cannot be read. */
export function timeOfDay(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: SA }).format(d);
  } catch { return ""; }
}

/** "2 Oct 2026", in South African time. Empty when it cannot be read. */
export function shortDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric", timeZone: SA }).format(d);
  } catch { return ""; }
}

/** Overs bowled from legal balls: 110 balls is "18.2". */
export const oversText = (balls) => {
  const b = Number.isFinite(balls) ? Math.max(0, Math.trunc(balls)) : 0;
  return `${Math.floor(b / 6)}.${b % 6}`;
};
