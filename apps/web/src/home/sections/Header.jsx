import { T } from "../../design/tokens.js";
import { LinkButton } from "./shared.jsx";

/**
 * The page's header: the logo and Log in. Sticky.
 *
 * Props
 *   appHref  where Log in goes; the signed-in app. Default "/app" (§6.2).
 *   logo     the logo image's URL, imported by the entry (src/home/main.jsx)
 *            so this file stays loadable by the test runner. Absent: the
 *            wordmark in text.
 */
export function Header({ appHref = "/app", logo }) {
  return (
    <header style={{
      display: "flex", alignItems: "center", gap: T.space.sm, padding: `${T.space.md} ${T.space.lg}`,
      borderBottom: `1px solid ${T.line.subtle}`, position: "sticky", top: 0, background: T.glass.film,
      backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", zIndex: 10,
    }}>
      {logo
        ? <img src={logo} alt="SCRBRD" style={{ height: "26px", objectFit: "contain", filter: "brightness(1.15)" }} />
        : <span style={{ fontFamily: T.type.head, fontSize: "18px", fontWeight: 800, color: T.content.primary }}>SCRBRD</span>}
      <div style={{ marginLeft: "auto" }}>
        <LinkButton href={appHref} testId="home-login">Log in</LinkButton>
      </div>
    </header>
  );
}
