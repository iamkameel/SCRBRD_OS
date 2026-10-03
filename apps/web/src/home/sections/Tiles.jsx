import { T } from "../../design/tokens.js";
import { Icon } from "../../ui/icons.jsx";
import { Section, homeBody, homeHead } from "./shared.jsx";

/**
 * What SCRBRD does (SCRBRD-142 §5.1, §6.1). No props, no data.
 *
 * The rule (§5.1): a tile is a thing a person could be shown in the app
 * today. The words are the landing pitch reviewed on claude/wip-landing-pitch,
 * with the design's cuts applied: no price, no "AI commentary", no "kit
 * allocation" promise beyond the register that exists, nothing for a feature
 * that is only designed (the scorebook photo import, the sign-up). Add a
 * line only when the screen or route behind it exists. Nothing here names a
 * gender or a child.
 */
export const LEAD = [
  { icon: "scorebook", title: "Live scoring that works offline",
    desc: "Score every ball on a phone. The pad keeps working with no signal and sends the balls when the network returns. Hand the match to another scorer mid-innings." },
  { icon: "tv", title: "Match Centre and pavilion display",
    desc: "Follow a match ball by ball, with commentary written from the scorer's events. Put the score on a ground screen. The display shows what the public page shows, and no more." },
  { icon: "scale", title: "Playing conditions per competition",
    desc: "Each competition sets its own conditions. Every figure shows where it came from, and every version stays on record." },
  { icon: "users", title: "Squad and availability",
    desc: "Pick the side, see who is available, and follow each player's skills and development." },
  { icon: "heart-pulse", title: "Bowling workload within the directives",
    desc: "Spells are counted against the age-group limits. Breaches show up, each tied to the rule it breaks. Health data needs a parent's consent." },
  { icon: "van", title: "Parent lift clubs",
    desc: "Parents offer and ask for seats to fixtures. The school signs a lift policy. Every driver signs a declaration before driving." },
  { icon: "shield-check", title: "Safeguarding built in",
    desc: "Anyone signed in can raise a concern with the school's Designated Safeguarding Officers. Only they can read it, and every read is logged." },
  { icon: "lock", title: "Privacy for minors",
    desc: "A child's name is public only with consent. Without it, the public page says \"Batter\"." },
];

export const ALSO = [
  "Wagon wheel and dismissal analysis",
  "Injury records and return to play, for those allowed to see them",
  "Transport, venues and the kit register",
  "Fixtures and training in one calendar",
  "Standings and knockout brackets",
  "Notices for players, parents and staff",
];

export function Tiles() {
  return (
    <>
      <Section id="home-tiles" label="What makes SCRBRD different">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))", gap: T.space.md }}>
          {LEAD.map((f) => (
            <article key={f.title} style={{ borderRadius: T.radius.lg, border: `1px solid ${T.line.subtle}`, background: T.fill.panel, padding: T.space.xl }}>
              <div aria-hidden="true" style={{ fontSize: "26px", marginBottom: T.space.md, color: T.brand.blueText, display: "flex" }}><Icon name={f.icon} /></div>
              <h3 style={{ ...homeHead(), fontSize: "16px", fontWeight: 700, color: T.content.primary, marginBottom: T.space.sm, lineHeight: 1.3 }}>{f.title}</h3>
              <p style={{ ...homeBody(), fontSize: "14px", color: T.content.secondary, lineHeight: 1.55 }}>{f.desc}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section id="home-also" label="Also in the pilot" narrow>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: T.space.sm, justifyContent: "center" }}>
          {ALSO.map((a) => (
            <li key={a} style={{ ...homeBody(), fontSize: "14px", color: T.content.secondary, padding: "8px 14px", borderRadius: T.radius.pill, border: `1px solid ${T.line.normal}`, background: T.fill.panel }}>{a}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}
