import { T } from "../../design/tokens.js";
import { Section, homeBody, textLink } from "./shared.jsx";

/**
 * For families: the plain-words promise about children's data, four lines
 * from docs/policy/PUBLIC_DATA.md §1-§3 (SCRBRD-142 §6.1 item 7), and the way
 * to the whole of it.
 *
 * Props
 *   privacyHref  where the full words live. Default "/privacy".
 */
export const PROMISES = [
  "A child's name is public only when a parent has said yes. Until then a public page says \"Batter\" or \"Bowler\".",
  "Initial and surname, never more. No photograph, no date of birth, no age (the age group, such as U15, stays).",
  "Health, discipline, home and contact details, and coaches' judgements are never public, whatever anyone agrees to.",
  "A \"no\" takes effect at once, on past scorecards too.",
];

export function Families({ privacyHref = "/privacy" }) {
  return (
    <Section id="home-families" label="For families" narrow>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: T.space.md }}>
        {PROMISES.map((p) => (
          <li key={p} style={{ ...homeBody(), fontSize: "16px", color: T.content.secondary, lineHeight: 1.55, paddingLeft: T.space.lg, borderLeft: `2px solid ${T.line.strong}` }}>{p}</li>
        ))}
      </ul>
      <p style={{ margin: `${T.space.lg} 0 0` }}>
        <a href={privacyHref} data-testid="home-privacy-link" style={textLink()}>How we treat children's data</a>
      </p>
    </Section>
  );
}
