import { T, clr } from "../../design/tokens.js";
import { LinkButton, homeBody, homeHead } from "./shared.jsx";

/**
 * The hero: one sentence and the call to action (SCRBRD-142 §5.2, §6.1).
 *
 * Props
 *   appHref   where "Log in" goes. Default "/app".
 *   hasStrip  true when the live strip is on this page. Then "Follow a match"
 *             links to it (#matches) and the line under it says to look there.
 *             False (the default, and what a 404 from the strip leaves): no
 *             such button, and the line says to ask the school.
 *
 * Until SCRBRD-140 ships the honest way in is the office code; when it does
 * "Log in" becomes "Sign in with Google" (§5.2). The page collects nothing.
 */
export function Hero({ appHref = "/app", hasStrip = false }) {
  return (
    <section aria-labelledby="home-hero-h" style={{ textAlign: "center", padding: `${T.space.huge} ${T.space.lg} ${T.space.xxl}`, maxWidth: "860px", margin: "0 auto" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: T.space.sm, padding: "8px 16px", borderRadius: T.radius.pill,
        background: clr(T.brand.blue, 0.12), border: `1px solid ${clr(T.brand.blue, 0.3)}`, marginBottom: T.space.xl,
      }}>
        <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "50%", background: T.brand.blue }} />
        <span style={{ fontFamily: T.type.head, fontSize: "12px", fontWeight: 700, color: T.brand.blueText, letterSpacing: "0.08em", textTransform: "uppercase" }}>KZN school cricket pilot</span>
      </div>
      <h1 id="home-hero-h" style={{ ...homeHead(), fontSize: "clamp(32px,7vw,64px)", fontWeight: 800, color: T.content.primary, lineHeight: 1.08, letterSpacing: "-0.02em", marginBottom: T.space.lg }}>
        School cricket, scored live
        <span style={{ display: "block", color: T.brand.accentText }}>and kept safe.</span>
      </h1>
      <p style={{ ...homeBody(), fontSize: "17px", color: T.content.secondary, lineHeight: 1.65, maxWidth: "580px", margin: `0 auto ${T.space.xl}` }}>
        SCRBRD runs a school's cricket from the pavilion to the parent's phone. Scorers score offline. Coaches pick the side. Parents see their child's fixtures. Children's names stay private unless a parent agrees.
      </p>
      <div style={{ display: "flex", gap: T.space.md, justifyContent: "center", flexWrap: "wrap" }}>
        <LinkButton solid href={appHref} testId="home-cta-login">Log in</LinkButton>
        {hasStrip && <LinkButton href="#matches" testId="home-cta-follow">Follow a match</LinkButton>}
      </div>
      <p data-testid="home-cta-note" style={{ ...homeBody(), fontSize: "14px", color: T.content.tertiary, lineHeight: 1.55, margin: `${T.space.lg} auto 0`, maxWidth: "440px" }}>
        Your school's office gives you your code.{" "}
        {hasStrip ? "On match day, ask your school for the live link, or look here." : "On match day, ask your school for the live link."}
      </p>
    </section>
  );
}
