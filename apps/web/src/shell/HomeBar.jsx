import { useEffect, useState } from "react";
import { HOMES } from "../design/roles.js";
import { useHome } from "../lib/features.js";
import { D } from "../design/tokens.js";

/* ══════════════════════════════════════════════════════
   HOME BAR (GA-I30)

   The one strip a domain's home draws under its header: the home's sections
   as a switch, and the links to the neighbouring screens of the same area.

   It decides nothing. `useHome` answers with the sections and links whose
   source destination this reader reaches — the same list, narrowed by the
   same capability check and the same module switch, that draws the menu — and
   this only draws them. A link is offered where its target is in the reach,
   so it can never lead somewhere the menu would not.

   Floors: 12px text, 44px targets. No motion of its own.
   ══════════════════════════════════════════════════════ */

/**
 * Which section is on show: the one asked for if this reader has it, else the
 * first they do. Following `requested` when it changes, so a link from another
 * screen that names a section opens it.
 * @returns {[string | null, (key: string) => void]}
 */
export function useHomeSection(role, home, requested) {
  const { sections } = useHome(role, home);
  const [chosen, setChosen] = useState(requested ?? null);
  useEffect(() => { if (requested) setChosen(requested); }, [requested]);
  const active = (sections.find((s) => s.key === chosen) ?? sections[0])?.key ?? null;
  return [active, setChosen];
}

const pill = (on, tone) => ({
  padding: "6px 16px", minHeight: "44px", borderRadius: D.pill, cursor: "pointer", boxSizing: "border-box",
  border: `1px solid ${on ? tone + "55" : D.border}`, background: on ? tone + "14" : "transparent",
  fontFamily: D.body, fontSize: "12px", fontWeight: on ? 600 : 400, color: on ? tone : D.textMuted,
});

/**
 * @param {{ home: string, role: string, section?: string | null, onSection?: (key: string) => void,
 *           onNav?: (page: string, section?: string) => void }} props
 */
export function HomeBar({ home, role, section = null, onSection, onNav }) {
  const { sections, links } = useHome(role, home);
  const tone = D[HOMES[home].color];
  const title = HOMES[home].title;
  const shownLinks = onNav ? links : [];
  const switchOn = sections.length > 1 && !!onSection;
  if (!switchOn && shownLinks.length === 0) return null;
  return (
    <div data-testid={`home-${home}`} style={{display:"flex",gap:"6px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
      {switchOn && (
        <div role="group" aria-label={`${title}: sections`} data-testid={`home-${home}-sections`} style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
          {sections.map((s) => (
            <button key={s.key} type="button" aria-pressed={section === s.key} data-testid={`home-${home}-section-${s.key}`}
              onClick={() => onSection(s.key)} className="pressBtn" style={pill(section === s.key, tone)}>{s.label}</button>
          ))}
        </div>
      )}
      {shownLinks.length > 0 && (
        <div role="group" aria-label={`${title}: also in this area`} data-testid={`home-${home}-links`}
          style={{display:"flex",gap:"6px",flexWrap:"wrap",marginLeft:switchOn ? "auto" : 0}}>
          {shownLinks.map((l) => (
            <button key={l.to + (l.section ?? "")} type="button" data-testid={`home-${home}-link-${l.to}${l.section ? "-" + l.section : ""}`}
              onClick={() => onNav(l.to, l.section)} className="pressBtn" style={pill(false, tone)}>{l.label} →</button>
          ))}
        </div>
      )}
    </div>
  );
}
