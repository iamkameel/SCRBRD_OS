import { T } from "../../design/tokens.js";
import { LinkButton } from "./shared.jsx";

/**
 * The page's header: the logo, the over, and Log in. Sticky.
 *
 * Props
 *   appHref  where Log in goes; the signed-in app. Default "/app" (§6.2).
 *   logo     the logo image's URL, imported by the entry (src/home/main.jsx)
 *            so this file stays loadable by the test runner. Absent: the
 *            wordmark in text.
 *   live     how many listed fixtures are live now. Above 0, a "live" link
 *            to the strip (#matches) sits beside Log in, on every screen of
 *            the page, so a parent on a Saturday is one tap from the score.
 *   over     draw the over: six balls that light one by one as the page is
 *            read (a CSS scroll timeline, home/fx.js). Decorative.
 */
export function Header({ appHref = "/app", logo, live = 0, over = false }) {
  return (
    <header className={live > 0 ? "has-live" : undefined} style={{
      display: "flex", alignItems: "center", gap: T.space.md, padding: `${T.space.md} ${T.space.lg}`,
      borderBottom: `1px solid ${T.line.subtle}`, position: "sticky", top: 0, background: T.glass.film,
      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", zIndex: 10,
    }}>
      {logo
        ? <img src={logo} alt="SCRBRD" style={{ height: "26px", objectFit: "contain", filter: "brightness(1.15)" }} />
        : <span style={{ fontFamily: T.type.head, fontSize: "18px", fontWeight: 800, color: T.content.primary }}>SCRBRD</span>}
      {over && (
        <span aria-hidden="true" className="ov">
          {[0, 1, 2, 3, 4, 5].map((i) => <b key={i} style={{ "--i": i }} />)}
        </span>
      )}
      <div style={{ marginLeft: "auto", display: "flex", gap: T.space.sm, alignItems: "center" }}>
        {live > 0 && (
          <a href="#matches" data-testid="home-header-live" className="pressBtn"
            style={{ minHeight: "44px", minWidth: "44px", padding: "0 14px", display: "inline-flex", alignItems: "center", gap: "8px", borderRadius: T.radius.pill,
              textDecoration: "none", fontFamily: T.type.mono, fontSize: "13px", color: T.content.primary, border: `1px solid ${T.line.strong}`, boxSizing: "border-box" }}>
            <span aria-hidden="true" className="live-dot" />{`${live} live`}
          </a>
        )}
        <LinkButton href={appHref} testId="home-login">Log in</LinkButton>
      </div>
    </header>
  );
}
