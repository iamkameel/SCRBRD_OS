import { useEffect, useState } from "react";
import { batHandOf } from "@scrbrd/scoring";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { humanDateTime } from "../../lib/format.js";
import { WeatherChip } from "../shared.jsx";
import { teamOf } from "../../lib/matchCentre.js";
import { BatsmanChart, BowlerChart, ManhattanChart, ShotHeatMap, ShotSpider, ShotWheel, WormChart } from "../../scorer/charts.jsx";
import { projectMatch } from "../../scorer/chartData.js";
import { WagonAnalysisPanel } from "../../scorer/wagonAnalysisPanel.jsx";
import { ErrorBoundary } from "../../ui/ErrorBoundary.jsx";
import { InningsToggle } from "./scorecard.jsx";
import { Panel, Quiet } from "./bits.jsx";

/**
 * The Match Centre's other five tabs (the Scorecard is scorecard.jsx).
 * Summary, Commentary and Partnerships live in tabs-core.jsx, which the
 * public page (SCRBRD-083) shares; they are re-exported here so the
 * signed-in Match Centre imports its tabs from one place. Analytics and Match
 * details stay here: they draw per-player charts from placement and name the
 * officials, neither of which a public page shows. Every figure is the
 * fold's; every line of commentary is the shared generator's.
 */
import { SummaryTab, CommentaryTab, PartnershipsTab } from "./tabs-core.jsx";
export { SummaryTab, CommentaryTab, PartnershipsTab };


// ── Analytics ───────────────────────────────────────────

export function AnalyticsTab({ match, innings, inningsSel, setInningsSel, overs, events = null, focus = null }) {
  const [wheelOf, setWheelOf] = useState(null);
  const inn = innings[inningsSel];
  if (!inn) return <Quiet testid="mc-analytics-empty">Nothing has been scored yet.</Quiet>;
  // Family mode (step 4 G13): a per-player wheel is offered for the reader's
  // own child (or the pupil himself) only — another child's row is one this
  // reader may not open (§2.1 P4), so it is not offered. The whole innings
  // stays, as every spectator has it.
  const offered = inn.batsmen.filter((b) => b.balls > 0 && (!focus || focus.has(b.id)));
  const legal = inn.ballLog.filter((b) => b.type !== "Wd" && b.type !== "Nb");
  const dots = legal.filter((b) => (b.type ?? "run") === "run" && b.value === 0).length;
  const bnds = legal.filter((b) => (b.type ?? "run") === "run" && (b.value === 4 || b.value === 6)).length;
  const cfg = { overs };
  // The worm and the bars from one projection of the fold and its log (GA-I05).
  const proj = projectMatch(innings, { events, overs });
  /** @param {{l: string, v: any}} p */
  const Kpi = ({ l, v }) => (
    <div style={{ flex: "1 1 120px", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: `${T.space.sm} ${T.space.md}`, background: T.surface.raised }}>
      <div style={{ ...T.role.figure.md, color: T.content.primary }}>{v}</div>
      <div style={{ ...T.role.label, color: T.content.secondary }}>{l}</div>
    </div>
  );
  const H = ({ children }) => <h2 style={{ ...T.role.label, color: T.content.secondary, margin: `${T.space.lg} 0 ${T.space.sm}` }}>{children}</h2>;
  return (
    <section data-testid="mc-analytics" aria-label="Analytics">
      <InningsToggle match={match} innings={innings} inningsSel={inningsSel} setInningsSel={(i) => { setInningsSel(i); setWheelOf(null); }}/>
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <Kpi l="Run rate" v={inn.balls ? ((inn.runs / inn.balls) * 6).toFixed(2) : "—"}/>
        <Kpi l="Dot balls" v={legal.length ? `${Math.round((dots / legal.length) * 100)}%` : "—"}/>
        <Kpi l="Boundaries" v={bnds}/>
        <Kpi l="Extras" v={Object.values(inn.extras).reduce((a, b) => a + b, 0)}/>
      </div>
      {innings.length > 1 && (<><H>Match worm</H><WormChart innings={innings} curIn={innings.length - 1} match={cfg} events={events}/></>)}
      <H>Runs per over</H>
      <ManhattanChart inn={inn} match={cfg} projection={proj[inningsSel]}/>
      <div style={{ display: "grid", gridTemplateColumns: "var(--g-2,1fr 1fr)", gap: T.space.md }}>
        <div><H>Batting impact</H><BatsmanChart inn={inn}/></div>
        <div><H>Bowling economy</H><BowlerChart inn={inn}/></div>
      </div>
      <H>Shot placement</H>
      <div role="group" aria-label="Whose shots" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap", marginBottom: T.space.sm }}>
        {[{ id: null, name: "Whole innings" }, ...offered].map((b) => {
          const on = wheelOf === (b.id ?? null);
          return (
            <button key={b.id ?? "all"} type="button" aria-pressed={on} onClick={() => setWheelOf(b.id ?? null)} className="pressBtn os-state"
              style={{ minHeight: "44px", padding: `0 ${T.space.md}`, borderRadius: T.radius.pill, cursor: "pointer",
                background: on ? T.surface.interactive : "transparent", border: `1px solid ${on ? T.line.strong : T.line.normal}`,
                color: on ? T.content.primary : T.content.secondary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 500 }}>
              {b.name}
            </button>
          );
        })}
      </div>
      <ShotWheel inn={inn} playerId={wheelOf} title={wheelOf ? (inn.batsmen.find((b) => b.id === wheelOf)?.name ?? "Wagon wheel") : "Wagon wheel"}/>
      <div style={{ display: "grid", gridTemplateColumns: "var(--g-2,1fr 1fr)", gap: T.space.md, marginTop: T.space.md }}>
        <ShotHeatMap inn={inn} playerId={wheelOf}/>
        <ShotSpider inn={inn} playerId={wheelOf}/>
      </div>
      {/* SCRBRD-102: filters by batter and bowler, run chips that isolate a
          subset of spokes, off side against on side, and the eight named
          areas with their runs and boundaries. */}
      <div style={{ marginTop: T.space.lg }}>
        {/* Its own boundary: the heaviest panel here, so the figures and
            charts above it stay if it is the one that fails. */}
        <ErrorBoundary name="wagon-wheel analysis">
          <WagonAnalysisPanel
            balls={inn.ballLog}
            handOf={(strikerId) => batHandOf(inn, strikerId)}
            batters={offered.map((b) => ({ id: b.id, name: b.name }))}
            bowlers={inn.bowlers.filter((b) => b.balls > 0).map((b) => ({ id: b.id, name: b.name }))}
          />
        </ErrorBoundary>
      </div>
    </section>
  );
}

// ── Match details ───────────────────────────────────────

const DUTY_LABEL = { umpire: "Umpire", third_umpire: "Third umpire", scorer: "Scorer", referee: "Referee" };

export function DetailsTab({ match, result, weather, competition }) {
  // Who stood in the middle: its own read, allowed to fail on its own.
  const [officials, setOfficials] = useState([]);
  useEffect(() => {
    if (!signedIn()) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { rows } = await api(`/api/read/officials?matchId=${match.id}`);
        if (!cancelled) setOfficials(rows || []);
      } catch { if (!cancelled) setOfficials([]); }
    })();
    return () => { cancelled = true; };
  }, [match.id]);
  const home = teamOf(match, match.homeTeam), away = teamOf(match, match.awayTeam);
  const toss = match.tossWonBy && match.tossDecision
    ? `${(match.tossWonBy === "home" ? home : away).full} won the toss and chose to ${match.tossDecision === "bowl" ? "bowl" : "bat"}`
    : null;
  const rows = [
    ["Competition", competition?.name ?? null],
    ["Format", [match.format, match.overs ? `${match.overs} overs a side` : null].filter(Boolean).join(" · ") || null],
    ["Start", match.date ? humanDateTime(match.date, match.time ?? null) : null],
    ["Ground", match.venue ?? null],
    ["Toss", toss],
    ["Result", result ?? null],
    ...officials.map((o) => [DUTY_LABEL[o.duty] ?? o.duty, o.person_name]),
  ].filter(([, v]) => v != null && v !== "");
  return (
    <section data-testid="mc-details" aria-label="Match details" style={{ display: "grid", gap: T.space.lg }}>
      <Panel>
        <dl style={{ margin: 0 }}>
          {rows.map(([k, v], i) => (
            <div key={`${k}${i}`} style={{ display: "grid", gridTemplateColumns: "minmax(110px,160px) 1fr", gap: T.space.md,
              padding: `${T.space.sm} ${T.space.md}`, borderTop: i ? `1px solid ${T.line.subtle}` : "none", minHeight: "44px", alignItems: "center" }}>
              <dt style={{ ...T.role.label, color: T.content.secondary }}>{k}</dt>
              <dd style={{ ...T.role.body, color: T.content.primary, margin: 0 }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      {weather && <WeatherChip w={weather} status={match.status}/>}
    </section>
  );
}
