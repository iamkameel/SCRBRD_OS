/**
 * The one door of a "Needs you" row (GA-I09 §3.2; EXPERIENCE_PASS §1.10): the
 * exact screen it opens, said on the row in its own words, and on that screen
 * the thing to deal with. Shared by To resolve (views/ReadinessOverview.jsx)
 * and Today's "Needs you" block (views/needsyou.jsx), so a row opens the same
 * place from both.
 *
 * A fixture's side, duties and result open that fixture's tab in the Match
 * Centre (lib/cockpitNav.js). The bus opens this fixture's trip on Logistics,
 * the playing conditions this fixture's competition, the requests, claims and
 * register their own panels (lib/fixNote.js). A door the reader has no screen
 * for falls back to the fixture, or to nothing: a row with no door is
 * information. Presentation only; each screen's reads decide what it draws.
 */
import { cockpitGate } from "../lib/cockpit.js";
import { requestCoach, requestDuties, requestResult } from "../lib/cockpitNav.js";
import { fixFor, requestFix } from "../lib/fixNote.js";

/**
 * @param {{ nav: string[], byId: Map<string, any>, assignments: any, onNav: (page: string, section?: string | null) => void }} o
 *   `nav` the destinations this reader reaches (capability and module), `byId` the fixtures read by id
 * @returns {(row: import("../lib/queue.js").Row) => {label: string, go: () => void} | null}
 */
export function doorsFor({ nav, byId, assignments, onNav }) {
  return (row) => {
    const a = row.action;
    if (!a || a.kind === "retry") return null;
    const m = a.matchId ? byId.get(a.matchId) : null;
    const fixture = m ? { label: "Open the fixture", go: () => { requestDuties(m.id); onNav("matches"); } } : null;
    /** A screen the reader reaches, landed on the row's own thing when the screen draws it. */
    const page = (/** @type {string} */ p, /** @type {string} */ label, /** @type {string | null} */ section = null) => {
      if (!nav.includes(p)) return null;
      const note = fixFor(a.kind, { matchId: m?.id ?? null, competitionId: m?.competition ?? null, requestId: a.requestId ?? null });
      return { label, go: () => { if (note) requestFix(note); onNav(p, section); } };
    };
    switch (a.kind) {
      case "side": return m && cockpitGate(assignments, m) ? { label: "Open the side", go: () => { requestCoach(m.id, false); onNav("matches"); } } : fixture;
      case "duties": return m ? { label: "Open the duties", go: () => { requestDuties(m.id); onNav("matches"); } } : null;
      case "bus": return page("logistics", "Open the bus", "transport") ?? fixture;
      case "conditions": return (m?.competition ? page("competitions", "Open the conditions", "competitions") : null) ?? fixture;
      case "fixture": return fixture;
      case "requests": return page("management", "Decide");
      case "claims": return page("staff", "Confirm");
      case "register": return page("staff", "The register");
      case "result": return a.matchId ? { label: a.label, go: () => { requestResult(/** @type {string} */ (a.matchId)); onNav("matches"); } } : null;
      default: return null;
    }
  };
}
