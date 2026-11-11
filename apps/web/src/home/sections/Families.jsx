import { T } from "../../design/tokens.js";
import { Section, homeBody, textLink } from "./shared.jsx";

/**
 * For families: the plain-words promise about children's data, four lines
 * from docs/policy/PUBLIC_DATA.md §1-§3 (SCRBRD-142 §6.1 item 7), and the way
 * to the whole of it. Beside them, a sample of what a public scorecard says
 * before a parent agrees: "Batter", never a name (team-level, labelled a sample).
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

const SAMPLE = [["Batter", "34", "(28)"], ["Batter", "12", "(15)"], ["Batter", "7*", "(9)"], ["Bowler", "4-0-21-2", ""]];

/**
 * The promise's emblem: a shield that draws itself and locks as the card
 * comes in (home/fx.js `.pr-shield`; drawn whole with reduced motion).
 * Decorative: the words beside it say what it means.
 */
function Shield() {
  return (
    <svg className="pr-shield" aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" stroke={T.board.lime} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path pathLength="1" d="M20 4l13 5v9c0 8.5-5.6 13.6-13 16-7.4-2.4-13-7.5-13-16V9z" />
      <path pathLength="1" className="pr-tick" d="M14 20l4.2 4.2L26.5 15.8" />
    </svg>
  );
}

function SampleCard() {
  const mono = { fontFamily: T.type.mono, fontVariantNumeric: "tabular-nums" };
  return (
    <figure className="rv pr-card" style={{ "--i": 1, margin: 0, background: T.board.face, borderRadius: T.radius.xl, padding: T.space.xl, border: "1px solid rgba(255,255,255,0.08)", boxShadow: T.elevation.lg, position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: T.space.md, margin: `0 0 ${T.space.md}` }}>
        <p style={{ ...mono, fontSize: "12px", letterSpacing: "0.12em", color: T.board.dim, margin: 0 }}>PUBLIC SCORECARD · SAMPLE</p>
        <Shield />
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {SAMPLE.map(([who, fig, balls], i) => (
          <li key={i} className="pr-row" style={{ "--i": i, display: "flex", justifyContent: "space-between", gap: T.space.md, padding: "10px 0", borderTop: i ? `1px solid ${T.board.rule}` : "none" }}>
            <span style={{ ...homeBody(), fontSize: "16px", color: T.board.figure }}>{who}</span>
            <span style={{ ...mono, fontSize: "16px", color: T.board.figure }}>{fig} <span style={{ color: T.board.dim }}>{balls}</span></span>
          </li>
        ))}
      </ul>
      <figcaption style={{ ...homeBody(), fontSize: "13px", color: T.board.dim, marginTop: T.space.md, lineHeight: 1.5 }}>
        How a public page reads before a parent says yes. A sample, not a real match.
      </figcaption>
    </figure>
  );
}

export function Families({ privacyHref = "/privacy" }) {
  return (
    <Section id="home-families" reveal={false} cam="families" kicker="For families" label="What the public sees, and what it never does">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: T.space.xxl, alignItems: "start" }}>
        <div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: T.space.lg }}>
            {PROMISES.map((p, i) => (
              <li key={p} className="rv pr-li" style={{ "--i": i, ...homeBody(), fontSize: "17px", color: T.content.secondary, lineHeight: 1.55, paddingLeft: T.space.lg, borderLeft: `3px solid ${T.brand.accentText}` }}>{p}</li>
            ))}
          </ul>
          <p style={{ margin: `${T.space.lg} 0 0` }}>
            <a href={privacyHref} data-testid="home-privacy-link" style={textLink()}>How we treat children's data</a>
          </p>
        </div>
        <SampleCard />
      </div>
    </Section>
  );
}
