/**
 * THE DSO CARD, LAST ON EVERY PARENT'S AND PUPIL'S HOME (EXPERIENCE_PASS Q7,
 * decided 13 Nov; docs/design/SAFEGUARDING_DSO.md §2.5, decided 27 Sep).
 *
 * The school's Designated Safeguarding Officers by name, from
 * dso_contacts() through GET /api/safeguarding/contacts (db/57: the live dso
 * assignments at every school the reader is live at, or, with none, the
 * union's or the federation's, said as such); "Raise a concern", which opens
 * the Safeguarding screen the header already reaches; "Report anonymously",
 * The Guardian's app, where the deployment has set its link; and the line
 * whom to call when a child is in danger now.
 *
 * What it does NOT draw, because nothing holds it yet: each DSO's own contact
 * line and the school's policy links live in the safeguarding register
 * (SAFEGUARDING_DSO §2.6, SG-1 and SG-8), which is not built. The card says
 * whom to call instead, as Q7 allows ("or let the card say whom to call").
 *
 * The same words as the Safeguarding screen's own DSO card
 * (views/SafeguardingView.jsx), so a parent reads one thing in two places.
 * Nothing here says whether a concern exists: the card is the same for
 * everyone at the school.
 */
import { useEffect, useState } from "react";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { Icon } from "../../ui/icons.jsx";
import { Action, Card, Line } from "./parts.jsx";

/** The DSOs at each school the reader is live at, and The Guardian's app link. */
function useContacts() {
  const [c, setC] = useState({ rows: [], guardianAppUrl: null, loading: true, error: false });
  useEffect(() => {
    if (!signedIn()) { setC({ rows: [], guardianAppUrl: null, loading: false, error: false }); return undefined; }
    let off = false;
    api("/api/safeguarding/contacts")
      .then((r) => { if (!off) setC({ rows: r?.rows ?? [], guardianAppUrl: r?.guardianAppUrl ?? null, loading: false, error: false }); })
      .catch(() => { if (!off) setC({ rows: [], guardianAppUrl: null, loading: false, error: true }); });
    return () => { off = true; };
  }, []);
  return c;
}

/** Above whom the concerns go when a school has no DSO of its own (db/57 held_at). */
const ABOVE = { union: "provincial", federation: "national" };

/** @param {{ onRaise?: (() => void) | null, testid?: string }} p */
export function DsoCard({ onRaise = null, testid = "dso-card" }) {
  const c = useContacts();
  const bySchool = c.rows.reduce((acc, r) => { (acc[r.schoolId] ??= { name: r.schoolName, rows: [] }).rows.push(r); return acc; }, /** @type {Record<string, {name: string, rows: any[]}>} */ ({}));
  const schools = Object.entries(bySchool);
  return (
    <Card label="Worried about a child?" testid={testid}>
      <Line>Tell the school&apos;s Designated Safeguarding Officer (DSO). You do not need to be sure.</Line>
      {c.loading && <Line quiet>Reading who the DSO is…</Line>}
      {c.error && <Line quiet testid={`${testid}-unread`}>Couldn't load who the DSO is just now. The Safeguarding screen in the header still reaches them.</Line>}
      {schools.map(([id, s]) => (
        <div key={id} data-testid={`${testid}-school`} style={{ display: "grid", gap: "2px" }}>
          {schools.length > 1 && <Line strong>{s.name}</Line>}
          {s.rows[0].heldAt === "none"
            ? <Line testid={`${testid}-none`}>This school has not yet appointed a DSO. Please use The Guardian&apos;s app, or phone Childline on 116.</Line>
            : <>
                {s.rows[0].heldAt !== "school" && <Line quiet>This school has not yet appointed a DSO. Concerns go to the {ABOVE[s.rows[0].heldAt] ?? "provincial"} DSO instead:</Line>}
                {s.rows.map((r) => <Line key={r.personId} testid={`${testid}-name`}>{r.name}{s.rows[0].heldAt === "school" ? ", DSO" : ""}</Line>)}
              </>}
        </div>
      ))}
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        {onRaise && <Action testid={`${testid}-raise`} onClick={onRaise}>Raise a concern</Action>}
        {c.guardianAppUrl
          ? <a href={c.guardianAppUrl} target="_blank" rel="noopener noreferrer" data-testid={`${testid}-anonymous`} className="pressBtn os-state"
              style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, display: "inline-flex", alignItems: "center",
                gap: T.space.xs, border: `1px solid ${T.line.normal}`, color: T.content.primary, textDecoration: "none", ...T.role.control, fontSize: "15px" }}>
              Report anonymously <Icon name="arrow-up-right"/>
            </a>
          : <Line quiet testid={`${testid}-anonymous-unset`}>Report anonymously: The Guardian&apos;s app, Cricket South Africa&apos;s safeguarding partner. Its link has not been set on this platform yet.</Line>}
      </div>
      <Line quiet testid={`${testid}-danger`}>If a child is in danger now, phone SAPS on 10111 or Childline on 116.</Line>
    </Card>
  );
}
