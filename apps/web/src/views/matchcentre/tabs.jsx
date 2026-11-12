import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { batHandOf } from "@scrbrd/scoring";
import { T } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { humanDateTime } from "../../lib/format.js";
import { WeatherChip } from "../shared.jsx";
import { boundaryCount, teamOf } from "../../lib/matchCentre.js";
import { BatsmanChart, BowlerChart, ManhattanChart, ShotHeatMap, ShotSpider, ShotWheel, WormChart } from "../../scorer/charts.jsx";
import { projectMatch } from "../../scorer/chartData.js";
import { overParts } from "../../scorer/overParts.js";
import { WagonAnalysisPanel } from "../../scorer/wagonAnalysisPanel.jsx";
import { ErrorBoundary } from "../../ui/ErrorBoundary.jsx";
import { ChartTable } from "../../ui/ChartTable.jsx";
import { Sourced, ballsLine, shotsCaptured } from "../../ui/sourced.jsx";
import { fullAnalysis } from "../../lib/matchAnalysis.js";
import { InningsToggle } from "./scorecard.jsx";
import { scrollerOf } from "../../lib/toBall.js";
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

/**
 * CRI-2.5: the innings' stands as a chart — one of the three every reader of
 * the Analytics tab has. The fold's partnerships (the stand still in, while
 * both are in, as the Partnerships tab adds it), each bar its runs against
 * the biggest, the pair named as the scorecard names them, and the figures
 * as a table behind "Show as table" (GA-I31).
 */
function PartnershipChart({ inn }) {
  const rows = (inn.partnerships ?? []).map((p) => ({ ...p, open: false }));
  const cp = inn.curPartner;
  const nm = (id) => inn.batsmen.find((b) => b.id === id)?.name;
  const last = { bat1: nm(cp?.bat1) ?? "?", bat2: nm(cp?.bat2) ?? "?" };
  const listed = rows.some((r) => r.bat1 === last.bat1 && r.bat2 === last.bat2 && r.runs === cp?.runs && r.balls === cp?.balls);
  if (cp && cp.bat1 && cp.bat2 && (cp.runs > 0 || cp.balls > 0) && !listed) rows.push({ ...last, runs: cp.runs, balls: cp.balls, wicket: inn.wickets + 1, open: true });
  const most = Math.max(1, ...rows.map((r) => r.runs));
  const nth = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
  const table = [{ caption: "Partnerships, wicket by wicket", columns: ["Wicket", "Pair", "Runs", "Balls"], text: [1],
    rows: rows.map((r) => [`${nth(r.wicket)}${r.open ? " (unbroken)" : ""}`, `${r.bat1} and ${r.bat2}`, r.runs, r.balls]) }];
  return (
    <Panel testid="mc-partnership-chart" style={{ padding: `${T.space.md} ${T.space.md}` }}>
      {!rows.length ? <Quiet>No partnership yet.</Quiet> : (
        <ol aria-label={`Partnerships: ${rows.length}, the biggest ${most} runs`} style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: T.space.sm }}>
          {rows.map((r, i) => (
            <li key={i} data-testid="mc-partnership-bar" data-runs={r.runs} style={{ display: "grid", gap: "2px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.sm, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ ...T.role.body, fontSize: "14px", color: T.content.primary, minWidth: 0, overflowWrap: "anywhere" }}>{r.bat1} and {r.bat2}</span>
                <span style={{ ...T.role.figure.sm, color: T.content.primary }}>{r.runs} <span style={{ color: T.content.secondary }}>({r.balls}){r.open ? " *" : ""}</span></span>
              </div>
              <div aria-hidden="true" style={{ height: "8px", borderRadius: T.radius.pill, background: T.fill.track, overflow: "hidden" }}>
                <div style={{ width: `${Math.round((r.runs / most) * 100)}%`, height: "100%", background: T.sport.batting, borderRadius: T.radius.pill }}/>
              </div>
            </li>
          ))}
        </ol>
      )}
      <ChartTable testid="partnership-table" tables={table}/>
    </Panel>
  );
}


/**
 * `toBalls` (CRI-2.3): a Manhattan bar or a wagon-wheel area leads to the
 * Commentary, filtered to its balls by event id (MatchView's, signed in and
 * not a demonstration; null leaves the charts as they were).
 */
export function AnalyticsTab({ match, role = null, innings, inningsSel, setInningsSel, overs, events = null, focus = null, toBalls = null,
  chartsAt = null, onChartsRestored = null }) {
  const [wheelOf, setWheelOf] = useState(null);
  const at = useRef(/** @type {HTMLElement | null} */ (null));
  // CRI-2.3: once, as the tab is drawn again after a chart's balls: the page where the reader left it.
  useLayoutEffect(() => {
    if (!chartsAt) return;
    const sc = scrollerOf(at.current);
    if (sc) sc.scrollTop = chartsAt.scrollTop ?? 0;
    onChartsRestored?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // CRI-2.5, by persona (lib/matchAnalysis.js): a parent, a pupil, a follower has the worm, runs per
  // over and the partnerships; every staff role the whole analysis. Presentation: all read the same log.
  const full = fullAnalysis(role);
  const inn = innings[inningsSel];
  if (!inn) return <Quiet testid="mc-analytics-empty">Nothing has been scored yet.</Quiet>;
  /** A chart's balls, and where the page is, for the way back. */
  const drill = toBalls ? (balls) => toBalls(balls, at.current) : null;
  // Each bar's events, placed as the projection places their runs (scorer/overParts.js).
  const parts = drill ? overParts(inn, (events ?? []).filter((e) => (e.innings ?? 0) === inningsSel)) : null;
  // Family mode (step 4 G13): a per-player wheel is offered for the reader's
  // own child (or the pupil himself) only — another child's row is one this
  // reader may not open (§2.1 P4), so it is not offered. The whole innings
  // stays, as every spectator has it.
  const offered = inn.batsmen.filter((b) => b.balls > 0 && (!focus || focus.has(b.id)));
  const legal = inn.ballLog.filter((b) => b.type !== "Wd" && b.type !== "Nb");
  const dots = legal.filter((b) => (b.type ?? "run") === "run" && b.value === 0).length;
  // Fours and sixes are boundaries (the Laws audit F7): the engine's one test.
  const bnds = boundaryCount(inn);
  const cfg = { overs };
  // The worm and the bars from one projection of the fold and its log (GA-I05).
  const proj = projectMatch(innings, { events, overs });
  // CRI-2.2: what each chart stands on. The innings by its side, the balls by the fold's count; a chart
  // that draws shots says how many of the balls carried one.
  const sideName = teamOf(match, inn.battingTeam).full;
  const scope = `${sideName} innings`;
  const both = innings.filter(Boolean).reduce((n, x) => n + (x.balls ?? 0), 0);
  const placed = (balls) => balls.filter((b) => b.theta != null || b.seg != null).length;
  const theirs = wheelOf ? inn.ballLog.filter((b) => b.strikerId === wheelOf) : inn.ballLog;
  /** @param {{l: string, v: any}} p */
  const Kpi = ({ l, v }) => (
    <div style={{ flex: "1 1 120px", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: `${T.space.sm} ${T.space.md}`, background: T.surface.raised }}>
      <div style={{ ...T.role.figure.md, color: T.content.primary }}>{v}</div>
      <div style={{ ...T.role.label, color: T.content.secondary }}>{l}</div>
    </div>
  );
  const H = ({ children }) => <h2 style={{ ...T.role.label, color: T.content.secondary, margin: `${T.space.lg} 0 ${T.space.sm}` }}>{children}</h2>;
  return (
    <section ref={at} data-testid="mc-analytics" data-analysis={full ? "full" : "spectator"} aria-label="Analytics">
      <InningsToggle match={match} innings={innings} inningsSel={inningsSel} setInningsSel={(i) => { setInningsSel(i); setWheelOf(null); }}/>
      <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap" }}>
        <Kpi l="Run rate" v={inn.balls ? ((inn.runs / inn.balls) * 6).toFixed(2) : "—"}/>
        <Kpi l="Dot balls" v={legal.length ? `${Math.round((dots / legal.length) * 100)}%` : "—"}/>
        <Kpi l="Boundaries" v={bnds}/>
        <Kpi l="Extras" v={Object.values(inn.extras).reduce((a, b) => a + b, 0)}/>
      </div>
      {innings.length > 1 && (<><H>Match worm</H>
        <Sourced line={ballsLine("Both innings", both)} testid="source-line-worm">
          <WormChart innings={innings} curIn={innings.length - 1} match={cfg} events={events}/>
        </Sourced></>)}
      <H>Runs per over</H>
      <Sourced line={ballsLine(scope, inn.balls ?? 0)} testid="source-line-manhattan">
        <ManhattanChart inn={inn} match={cfg} projection={proj[inningsSel]}
          onOver={drill ? (o) => drill({ ids: (parts?.get(o.over) ?? []).map((x) => x.id).filter(Boolean), what: `over ${o.over + 1}`, runs: o.runs }) : null}/>
      </Sourced>
      <H>Partnerships</H>
      <Sourced line={ballsLine(scope, inn.balls ?? 0)} testid="source-line-partnership">
        <PartnershipChart inn={inn}/>
      </Sourced>
      {full && (<>
      <div style={{ display: "grid", gridTemplateColumns: "var(--g-2,1fr 1fr)", gap: T.space.md }}>
        <div><H>Batting impact</H><Sourced line={ballsLine(scope, inn.balls ?? 0)} testid="source-line-batsman"><BatsmanChart inn={inn}/></Sourced></div>
        <div><H>Bowling economy</H><Sourced line={ballsLine(scope, inn.balls ?? 0)} testid="source-line-bowler"><BowlerChart inn={inn}/></Sourced></div>
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
      <Sourced line={ballsLine(wheelOf ? "One batter, this innings" : scope, theirs.length, shotsCaptured(placed(theirs), theirs.length))} testid="source-line-shots">
        <ShotWheel inn={inn} playerId={wheelOf} title={wheelOf ? (inn.batsmen.find((b) => b.id === wheelOf)?.name ?? "Wagon wheel") : "Wagon wheel"}/>
        <div style={{ display: "grid", gridTemplateColumns: "var(--g-2,1fr 1fr)", gap: T.space.md }}>
          <ShotHeatMap inn={inn} playerId={wheelOf}/>
          <ShotSpider inn={inn} playerId={wheelOf}/>
        </div>
      </Sourced>
      {/* SCRBRD-102: filters by batter and bowler, run chips that isolate a
          subset of spokes, off side against on side, and the eight named
          areas with their runs and boundaries. */}
      <div style={{ marginTop: T.space.lg }}>
        {/* Its own boundary: the heaviest panel here, so the figures and
            charts above it stay if it is the one that fails. */}
        <ErrorBoundary name="wagon-wheel analysis">
          <Sourced line={ballsLine(scope, inn.ballLog.length, shotsCaptured(placed(inn.ballLog), inn.ballLog.length))} testid="source-line-wagon-analysis">
          <WagonAnalysisPanel
            balls={inn.ballLog}
            handOf={(strikerId) => batHandOf(inn, strikerId)}
            batters={offered.map((b) => ({ id: b.id, name: b.name }))}
            bowlers={inn.bowlers.filter((b) => b.balls > 0).map((b) => ({ id: b.id, name: b.name }))}
            onArea={drill ? (ar) => drill({ ids: ar.ids, what: ar.label, runs: ar.runs }) : null}
          />
          </Sourced>
        </ErrorBoundary>
      </div>
      </>)}
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
            // The label and its value side by side, and one over the other where they do not fit (200% zoom on a phone) (I32).
            <div key={`${k}${i}`} style={{ display: "flex", flexWrap: "wrap", gap: `${T.space.xs} ${T.space.md}`,
              padding: `${T.space.sm} ${T.space.md}`, borderTop: i ? `1px solid ${T.line.subtle}` : "none", minHeight: "44px", alignItems: "center" }}>
              <dt style={{ ...T.role.label, color: T.content.secondary, flex: "0 1 160px", minWidth: "110px" }}>{k}</dt>
              <dd style={{ ...T.role.body, color: T.content.primary, margin: 0, flex: "1 1 130px", minWidth: 0, overflowWrap: "anywhere" }}>{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      {weather && <WeatherChip w={weather} status={match.status}/>}
    </section>
  );
}
