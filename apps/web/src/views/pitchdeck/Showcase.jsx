import { useMemo, useState } from "react";
import { T } from "../../design/tokens.js";
import { placementFromTap } from "@scrbrd/scoring";
import { Pad, PadBoard } from "../../scorer/pad.jsx";
import { SummaryTab, CommentaryTab, PartnershipsTab } from "../matchcentre/tabs-core.jsx";
import { AnalyticsTab } from "../matchcentre/tabs.jsx";
import { ScorecardTab } from "../matchcentre/scorecard.jsx";
import { EighteenCardView, HealthConsentAsk, HealthConsentCard } from "../healthconsent.jsx";
import { Receipt, RaiseFormView } from "../SafeguardingView.jsx";
import { Device, useNarrow } from "./Device.jsx";
import { CONSENT_ROWS, SAFEGUARDING, buildMatch } from "./demo.js";

/**
 * THE DECK'S LIVE SLIDES — the real screens, on demonstration data.
 *
 * "The pitch deck should have UI/UX features and elements of the app
 * showcased visually" (Kameel, 2026-09-28), and he chose real components
 * rendered live over screenshots, so the deck cannot go stale: change the
 * pad and the deck's pad changes with it.
 *
 * WHAT THAT MEANS HERE
 *   - Every screen is the app's own component: the pad and its board
 *     (scorer/pad.jsx), the Match Centre's tabs (views/matchcentre/), the
 *     consent cards (views/healthconsent.jsx), the raise-a-concern form and
 *     its receipt (views/SafeguardingView.jsx). Where a screen reads its rows
 *     from the server, the component was split at that seam — the reader
 *     stays where it was and the drawing is exported — so this file hands the
 *     drawing its rows and nothing else. Nothing is copied or redrawn.
 *   - The data is built in the browser (demo.js), deterministic, invented,
 *     and never fetched: no request is made to draw any of it.
 *   - Everything is inert (Device.jsx): the frames take no focus and no tap,
 *     and every handler passed in is `noop`. A viewer cannot write anything
 *     from a slide, because no control on a slide reaches a write.
 *
 * WHAT IS NOT SHOWN. The coach's day sheet (views/DashboardView.jsx) is one
 * function that reads five resources and the session as it draws, with no
 * seam to split at without rewriting it; the deck does not fake it. The
 * Match Centre's own header and tab strip are inside MatchView beside its
 * reads, so the frame shows the tabs' contents and the slide says so.
 *
 * It is a module of its own, fetched when the first of these slides opens, so
 * the scorer's pad and the screens above stay out of the deck's first paint
 * as they are out of the app's (tools/check-bundle.mjs).
 */

const noop = () => {};

let cached = null;
/** The demonstration match, built once, on the first live slide. */
const demo = () => (cached ??= buildMatch());

export const SHOWCASE_IDS = ["field", "centre", "families", "safeguard"];

// ── On the field: the pad, mid-ball, on the board ──

function Pad2({ phase }) {
  const d = demo();
  // A cover drive, run through the same point the pad's own Area step records.
  const area = useMemo(() => placementFromTap({ angle: 305, radius: 0.82 }), []);
  const preset = phase === 3 ? { phase: 3, shot: "drive", area } : { phase: 2, shot: "cut" };
  return (
    <div style={{ padding: T.space.md, display: "grid", gap: T.space.sm, alignContent: "start" }}>
      <PadBoard inn={d.chasing} match={d.match} target={d.target}/>
      <Pad inn={d.chasing} basic={false} preset={preset} undoWhat={d.undoWhat}
           onCommitDetailed={noop} onWicketCtx={noop} onWide={noop} onNoBall={noop} onUndo={noop}/>
    </div>
  );
}

export function FieldShowcase() {
  return (
    <>
      <Device kind="phone" testid="showcase-field-outcome" label="The scorer's pad, after the shot and the area, asking for the outcome"
        caption="The outcome: run keys sized by how often they are hit, the wicket key set apart.">
        <Pad2 phase={3}/>
      </Device>
      <Device kind="phone" testid="showcase-field-area" label="The scorer's pad, asking where the ball went"
        caption="The area: one tap on the field records a point, not a sector.">
        <Pad2 phase={2}/>
      </Device>
    </>
  );
}

// ── The Match Centre ──

const TABS = [
  ["summary", "Summary"], ["scorecard", "Scorecard"], ["commentary", "Commentary"], ["partnerships", "Partnerships"], ["analytics", "Analytics"],
];

export function CentreShowcase() {
  const d = demo();
  const narrow = useNarrow(760);
  const [tab, setTab] = useState("summary");
  const [picked, setPicked] = useState(null);
  const inningsSel = picked ?? Math.max(0, d.played.length - 1);
  const ctx = { match: d.match, innings: d.played, result: d.result, commentary: d.commentary, events: d.events, demo: false,
    overs: d.overs, inningsSel, setInningsSel: setPicked, phone: narrow, setTab: noop, moment: null, overSummary: null, shownRuns: null,
    opens: false, profileOf: () => null, Wheel: null };
  const body = tab === "summary" ? <SummaryTab {...ctx}/>
    : tab === "scorecard" ? <ScorecardTab {...ctx}/>
    : tab === "commentary" ? <CommentaryTab {...ctx}/>
    : tab === "partnerships" ? <PartnershipsTab {...ctx}/>
    : <AnalyticsTab {...ctx}/>;
  return (
    <div className="deck-centre">
      <div className="deck-tabs" role="group" aria-label="Which Match Centre tab to show">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className="deck-chip" aria-pressed={tab === id} onClick={() => setTab(id)} data-testid={`showcase-tab-${id}`}>{label}</button>
        ))}
      </div>
      <Device kind={narrow ? "phone" : "laptop"} testid="showcase-centre" fade label={`The Match Centre, ${TABS.find((t) => t[0] === tab)[1]} tab, on a demonstration match`}
        caption={`${TABS.find((t) => t[0] === tab)[1]}: read from a ball log, folded by the same replay as the scorer's.`}>
        <div key={tab} data-testid={`showcase-centre-${tab}`} className="os-page" style={{ padding: narrow ? T.space.md : T.space.xl }}>{body}</div>
      </Device>
    </div>
  );
}

// ── For families: the parent's Me and a pupil's ──

export function FamiliesShowcase() {
  const r = CONSENT_ROWS;
  return (
    <>
      <Device kind="phone" testid="showcase-families-parent" label="A parent's Me screen: asked once about health monitoring, then a switch for each child"
        caption="A parent's Me: asked once, off unless she turns it on, each child's answer on its own switch.">
        <div style={{ padding: T.space.md, display: "grid", gap: T.space.md, alignContent: "start" }}>
          <HealthConsentAsk c={r.ask} onYes={noop} onNo={noop} onLater={noop}/>
          <HealthConsentCard rows={r.section} onChanged={noop} idSuffix="-parent"/>
        </div>
      </Device>
      <Device kind="phone" testid="showcase-families-pupil" label="A pupil's Me screen at eighteen: his own decision now"
        caption="A pupil's Me at eighteen: his parent's yes is asked of him once, and from then on the choice is his.">
        <div style={{ padding: T.space.md, display: "grid", gap: T.space.md, alignContent: "start" }}>
          <EighteenCardView mine={r.eighteen} onAnswer={noop}/>
          <HealthConsentCard rows={[r.self]} onChanged={noop} idSuffix="-pupil"/>
        </div>
      </Device>
    </>
  );
}

// ── Duty of care in the product: raising a concern ──

export function SafeguardShowcase() {
  return (
    <>
      <Device kind="phone" testid="showcase-safeguard-form" label="Raise a concern: the form anybody signed in can open" fade
        caption="Raise a concern: confidential, said plainly to be not anonymous, with the way to report anonymously beside it.">
        <div style={{ padding: T.space.md }}>
          <RaiseFormView isDso={false} contacts={SAFEGUARDING.contacts} players={[]} onSent={noop} onCancel={noop} demo/>
        </div>
      </Device>
      <Device kind="phone" testid="showcase-safeguard-receipt" label="After sending: a receipt with a reference, and nothing else"
        caption="After sending: a reference and the time, and nothing of what was said comes back onto the screen.">
        <div style={{ padding: T.space.md }}>
          <Receipt r={SAFEGUARDING.receipt} guardianAppUrl="#" onDone={noop}/>
        </div>
      </Device>
    </>
  );
}

/** The slide's devices, by slide id. */
export default function Showcase({ id }) {
  if (id === "field") return <FieldShowcase/>;
  if (id === "centre") return <CentreShowcase/>;
  if (id === "families") return <FamiliesShowcase/>;
  if (id === "safeguard") return <SafeguardShowcase/>;
  return null;
}
