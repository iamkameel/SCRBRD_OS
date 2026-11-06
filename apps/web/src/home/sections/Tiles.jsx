import { T } from "../../design/tokens.js";
import { Glyph } from "./glyphs.jsx";
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
 *
 * Laid out as a numbered card per tile, the first two (what the film just
 * showed) wider on a wide screen; each arrives as it scrolls in.
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

/**
 * A tile leans towards a mouse over it and a light follows the pointer
 * (`.hb-tile`, home/fx.js; only with motion allowed, and only for a mouse:
 * a finger gets the press instead). The handler writes four custom
 * properties on the tile under the pointer and reads only that tile's box.
 * @param {import("react").PointerEvent<HTMLElement>} e
 */
function tilt(e) {
  if (e.pointerType !== "mouse") return;
  const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.(".hb-tile"));
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / (r.width || 1), y = (e.clientY - r.top) / (r.height || 1);
  el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
  el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  el.style.setProperty("--rx", `${((0.5 - y) * 9).toFixed(2)}deg`);
  el.style.setProperty("--ry", `${((x - 0.5) * 11).toFixed(2)}deg`);
}
/** @param {import("react").PointerEvent<HTMLElement>} e */
function untilt(e) {
  const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest?.(".hb-tile"));
  if (!el || el.contains(/** @type {Node | null} */ (e.relatedTarget))) return;
  el.style.setProperty("--rx", "0deg");
  el.style.setProperty("--ry", "0deg");
}

export function Tiles() {
  return (
    <>
      <Section id="home-tiles" reveal={false} cam="tiles" kicker="What SCRBRD does, today" label="What makes SCRBRD different">
        <ol className="tiles" onPointerMove={tilt} onPointerOut={untilt}
          style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))", gap: T.space.md }}>
          {LEAD.map((f, i) => (
            <li key={f.title} className="rv" style={{ "--i": i % 4, gridColumn: i < 2 || i >= 6 ? "span var(--wide, 1)" : undefined, display: "flex" }}>
              <div className="hb-tile" style={{ flex: 1, borderRadius: T.radius.xl, border: `1px solid ${T.line.normal}`,
                background: T.surface.raised, padding: T.space.xl, boxShadow: T.elevation.sm, position: "relative", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: T.space.lg }}>
                <span aria-hidden="true" style={{ width: "44px", height: "44px", borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  color: T.brand.accentText, background: T.fill.track }}><Glyph name={f.icon} /></span>
                <span aria-hidden="true" style={{ fontFamily: T.type.mono, fontSize: "13px", color: T.content.tertiary, letterSpacing: "0.08em" }}>{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 style={{ ...homeHead(), fontSize: i < 2 ? "20px" : "17px", fontWeight: 700, color: T.content.primary, marginBottom: T.space.sm, lineHeight: 1.25 }}>{f.title}</h3>
              <p style={{ ...homeBody(), fontSize: "15px", color: T.content.secondary, lineHeight: 1.55 }}>{f.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <Section id="home-also" label="Also in the pilot" narrow>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: T.space.sm }}>
          {ALSO.map((a) => (
            <li key={a} className="chip" style={{ ...homeBody(), fontSize: "14px", color: T.content.secondary, padding: "8px 14px", borderRadius: T.radius.pill, border: `1px solid ${T.line.normal}`, background: T.fill.panel }}>{a}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}
