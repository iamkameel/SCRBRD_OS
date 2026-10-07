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

/** The big heading of a section that has a kicker over it. */
export const displayHead = () => ({
  ...homeHead(), fontSize: "clamp(26px,4.6vw,42px)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.015em",
  color: T.content.primary,
});

/**
 * A section's box: a readable width and the 16px gutter at phone width.
 * `label` is its h2: the small uppercase eyebrow, or with `kicker` (a line
 * over it) a display heading. The section arrives as it scrolls in (`.rv`,
 * home/fx.js): from a visible state, and not at all with reduced motion.
 * `reveal={false}` when its own parts arrive one by one instead.
 */
export function Section({ id, label, kicker, narrow, children, style, reveal = true }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={reveal ? "rv" : undefined}
      style={{ padding: `${T.space.xl} ${T.space.lg}`, maxWidth: narrow ? "760px" : "1120px", margin: "0 auto", width: "100%", boxSizing: "border-box", ...style }}>
      {kicker && <p style={{ ...eyebrow(), color: T.brand.accentText, marginBottom: T.space.md }}>{kicker}</p>}
      {label && <h2 id={id ? `${id}-h` : undefined} style={kicker ? { ...displayHead(), marginBottom: T.space.xl } : { ...eyebrow(), marginBottom: T.space.lg }}>{label}</h2>}
      {children}
    </section>
  );
}

/** A stitched seam between two parts of the page, drawn as it scrolls into view. Decorative. */
export function Seam() {
  return (
    <div aria-hidden="true" className="rv-seam" style={{ maxWidth: "1120px", margin: "0 auto", padding: `0 ${T.space.lg}` }}>
      <svg viewBox="0 0 1000 24" preserveAspectRatio="none" style={{ display: "block", width: "100%", height: "24px", overflow: "visible" }}>
        <path pathLength="1" d="M0 12 C 250 2, 750 22, 1000 12" fill="none" stroke={T.semantic.criticalText} strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="0.012 0.008" />
      </svg>
    </div>
  );
}

const btn = () => ({
  minHeight: "44px", minWidth: "44px", padding: "0 20px", borderRadius: T.radius.pill, boxSizing: "border-box",
  fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, textDecoration: "none", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});

/**
 * A link drawn as a button: `solid` is the one call to action, the default
 * the quieter one. `tone="night"` is the quiet one on the film, which is
 * night in both themes, so it does not take the theme's ink.
 */
export function LinkButton({ href, solid, children, testId, rel, tone }) {
  const style = solid
    ? { ...btn(), background: T.light.action, border: "none", color: T.light.ink, boxShadow: `0 4px 20px ${clr(T.brand.blue, 0.4)}` }
    : tone === "night"
      ? { ...btn(), background: "rgba(5,8,13,0.5)", border: "1px solid rgba(255,255,255,0.32)", color: "#f4f6f3" }
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
export const oversOfBalls = (balls) => {
  const b = Number.isFinite(balls) ? Math.max(0, Math.trunc(balls)) : 0;
  return `${Math.floor(b / 6)}.${b % 6}`;
};
