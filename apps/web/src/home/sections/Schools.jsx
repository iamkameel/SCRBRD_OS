import { T, clr } from "../../design/tokens.js";
import { LinkButton, Section, homeBody } from "./shared.jsx";

/**
 * Bring SCRBRD to your school (SCRBRD-142 §5.4, D11): three sentences, the
 * privacy promise in one line, and a mailto. Nothing is collected by the page.
 *
 * Props
 *   email  the address a school writes to (A8: Kameel names it; not a
 *          personal one). Without it the section shows its words and no link,
 *          rather than a link to nowhere.
 */
const PILOT = "This season SCRBRD is in a pilot with KwaZulu-Natal schools. We are looking for more schools that want to try it at the ground and in the pavilion. Write to us and say what your school would like to see.";
const PROMISE = "Nothing about a child is public unless a parent agrees. This page collects nothing; writing to us is an email.";
const SUBJECT = "Bring SCRBRD to our school";

export function Schools({ email }) {
  const href = email ? `mailto:${email}?subject=${encodeURIComponent(SUBJECT)}` : null;
  const p = { ...homeBody(), fontSize: "17px", color: T.content.secondary, lineHeight: 1.6 };
  return (
    <Section id="home-schools" kicker="For schools" label="Bring SCRBRD to your school"
      style={{ borderRadius: T.radius.xxl, border: `1px solid ${T.line.normal}`, padding: `${T.space.huge} ${T.space.xl}`, margin: `${T.space.xl} auto`,
        maxWidth: "min(1088px, calc(100% - 32px))", backgroundColor: T.surface.raised,
        backgroundImage: `radial-gradient(600px 300px at 90% 0%, ${clr(T.brand.lime, 0.14)}, transparent 70%), radial-gradient(500px 260px at 0% 100%, ${clr(T.brand.cyan, 0.1)}, transparent 70%)` }}>
      <div style={{ maxWidth: "640px" }}>
        <p style={p}>{PILOT}</p>
        <p style={{ ...p, margin: `${T.space.md} 0 ${T.space.xl}` }}>{PROMISE}</p>
        {href && <LinkButton solid href={href} testId="home-schools-mail">Write to us</LinkButton>}
      </div>
    </Section>
  );
}
