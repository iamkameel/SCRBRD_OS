import { useEffect, useState } from "react";
import { T, contrast } from "../../design/tokens.js";
import { api, signedIn } from "../../lib/api.js";
import { commentaryByOver, inningsBreak, inningsPhase, oversOf, teamOf } from "../../lib/matchCentre.js";
import { humanDateTime } from "../../lib/format.js";
import { Board, chipFill } from "../../ui/board.jsx";
import { boardFromInnings } from "../../scorer/boardData.js";
import { boardInsights } from "../../scorer/signals.js";
import { BatsmanChart, BowlerChart, ManhattanChart, ShotHeatMap, ShotSpider, ShotWheel, WormChart } from "../../scorer/charts.jsx";
import { WeatherChip } from "../shared.jsx";
import { InningsToggle } from "./scorecard.jsx";
import { CardHead, Panel, Quiet, SideName } from "./bits.jsx";

/**
 * The Match Centre's other five tabs (the Scorecard is scorecard.jsx).
 * Every figure is the fold's; every line of commentary is the shared
 * generator's (@scrbrd/scoring/commentary), never an AI line: whether a
 * spectator ever reads one is Kameel's decision to make, and it is not made.
 */

// ── Summary ─────────────────────────────────────────────

/** The target of the second innings, as the fold has it. */
const targetOf = (innings) => (innings.length >= 2 ? (innings[1].target ?? innings[0].runs + 1) : null);

/** The innings break (§10 item 10, p2): the first innings in four facts. */
function InningsBreakCard({ match, innings, overs }) {
  const first = innings[0];
  const b = inningsBreak(first);
  const target = targetOf(innings) ?? first.runs + 1;
  const chasing = teamOf(match, first.bowlingTeam);
  /** @param {{label: string, children: any, testid: string}} p */
  const Fact = ({ label, children, testid }) => (
    <div data-testid={testid} style={{ display: "grid", gap: T.space.xs, padding: `${T.space.md} ${T.space.lg}`, borderTop: `1px solid ${T.line.subtle}` }}>
      <span style={{ ...T.role.label, color: T.content.secondary }}>{label}</span>
      <div style={{ display: "grid", gap: "2px" }}>{children}</div>
    </div>
  );
  /** @param {{name: string, fig: string}} p */
  const Row = ({ name, fig }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.md, alignItems: "baseline" }}>
      <span style={{ ...T.role.body, color: T.content.primary }}>{name}</span>
      <span style={{ ...T.role.figure.sm, color: T.content.primary, whiteSpace: "nowrap" }}>{fig}</span>
    </div>
  );
  return (
    <Panel testid="innings-break">
      <div style={{ padding: `${T.space.md} ${T.space.lg}`, display: "grid", gap: T.space.xs }}>
        <span style={{ ...T.role.label, color: T.brand.accentText }}>Innings break</span>
        <p style={{ ...T.role.title.md, color: T.content.primary, margin: 0 }}>
          <SideName side={chasing}/> need {target} to win from {first.overs ?? overs} overs
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "var(--g-2,1fr 1fr)" }}>
        <Fact label="Top scorers" testid="ib-top-scorers">
          {b.topScorers.length ? b.topScorers.map((x) => <Row key={x.id} name={x.name} fig={`${x.runs}${x.status === "batting" ? "*" : ""} (${x.balls})`}/>)
            : <span style={{ ...T.role.body, color: T.content.secondary }}>Nobody scored.</span>}
        </Fact>
        <Fact label="Best bowling" testid="ib-best-bowling">
          {b.bestBowling.length ? b.bestBowling.map((x) => <Row key={x.id} name={x.name} fig={`${x.wickets}/${x.runs} (${oversOf(x.balls)})`}/>)
            : <span style={{ ...T.role.body, color: T.content.secondary }}>No bowler on record.</span>}
        </Fact>
        <Fact label="Most boundaries" testid="ib-boundaries">
          {b.boundaries ? <Row name={b.boundaries.name} fig={`${b.boundaries.fours} × 4, ${b.boundaries.sixes} × 6`}/>
            : <span style={{ ...T.role.body, color: T.content.secondary }}>No boundaries.</span>}
        </Fact>
        <Fact label="Best strike rate" testid="ib-strike-rate">
          {b.strikeRate ? <Row name={b.strikeRate.name} fig={`${b.strikeRate.sr.toFixed(1)} (${b.strikeRate.runs} off ${b.strikeRate.balls})`}/>
            : <span style={{ ...T.role.body, color: T.content.secondary }}>Nobody faced ten balls.</span>}
        </Fact>
      </div>
    </Panel>
  );
}

export function SummaryTab({ match, innings, result, commentary, demo, overs, phone, setTab }) {
  if (!innings.length) return <Quiet testid="mc-summary-empty">Nothing has been scored yet. The board opens with the first ball.</Quiet>;
  const phase = inningsPhase(innings, result ? {} : null);
  const atBreak = phase === "Innings break";
  const inn = atBreak ? innings[0] : innings[innings.length - 1];
  const chase = innings.length >= 2 && inn === innings[1];
  const target = chase ? targetOf(innings) : null;
  const inOvers = inn.overs ?? overs;
  const props = boardFromInnings(inn, { target, overs: inOvers });
  const side = teamOf(match, inn.battingTeam);
  const insight = demo || !props ? [] : boardInsights(inn, { target, overs: inOvers });
  const latest = [...commentary].reverse().filter((c) => c.kind !== "over_end").slice(0, 3);
  return (
    <div style={{ display: "grid", gap: T.space.lg }} data-testid="mc-summary">
      {props && <Board {...props} team={phone ? side.short : side.full} size="card" testid="mc-board"
        insight={insight.length ? insight : undefined}/>}
      {atBreak && <InningsBreakCard match={match} innings={innings} overs={overs}/>}
      {latest.length > 0 && (
        <Panel testid="mc-latest">
          <CardHead icon="scorebook">Latest</CardHead>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {latest.map((c) => <CommentaryLine key={c.key} item={c}/>)}
          </ol>
          <div style={{ padding: T.space.md }}>
            <button type="button" onClick={() => setTab("commentary")} className="pressBtn os-state" data-testid="mc-all-commentary"
              style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, cursor: "pointer", background: "transparent",
                border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, color: T.content.primary,
                fontFamily: T.type.body, fontSize: "14px", fontWeight: 500 }}>
              All commentary
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── Commentary ──────────────────────────────────────────

const MARK = { four: ["four", "4"], six: ["six", "6"], wicket: ["wicket", "W"] };

/** A four, a six or a wicket gets its ball chip, as the board draws it (§10). */
function Mark({ kind }) {
  const m = MARK[kind];
  if (!m) return <span aria-hidden="true" style={{ width: "24px", flexShrink: 0 }}/>;
  const fill = chipFill(m[0]);
  const ink = contrast(fill, T.board.face) >= contrast(fill, T.board.figure) ? T.board.face : T.board.figure;
  return (
    <span aria-hidden="true" style={{ flexShrink: 0, width: "24px", height: "24px", borderRadius: T.radius.pill, display: "inline-flex",
      alignItems: "center", justifyContent: "center", background: fill, color: ink, border: `1px solid ${T.line.strong}`,
      fontFamily: T.type.mono, fontSize: "13px", fontWeight: 500 }}>{m[1]}</span>
  );
}

/** One line of commentary: where it fell, its mark, its words. */
function CommentaryLine({ item }) {
  const strong = item.kind === "wicket" || item.kind === "innings_end" || item.kind === "milestone";
  const ballNo = item.kind === "ball" || item.kind === "four" || item.kind === "six" || item.kind === "wicket";
  return (
    <li data-testid="mc-line" data-kind={item.kind} data-key={item.key}
      style={{ display: "flex", gap: T.space.sm, alignItems: "flex-start", padding: `${T.space.sm} ${T.space.md}`, borderTop: `1px solid ${T.line.subtle}` }}>
      <span style={{ ...T.role.figure.sm, color: T.content.secondary, width: "40px", flexShrink: 0 }}>
        {ballNo ? `${item.over}.${item.ball}` : ""}
      </span>
      <Mark kind={item.kind}/>
      <span style={{ ...T.role.body, color: T.content.primary, fontWeight: strong ? 600 : 400, minWidth: 0 }}>{item.text}</span>
    </li>
  );
}

const OVERS_AT_FIRST = 12;

export function CommentaryTab({ match, commentary, demo, innings }) {
  const [shown, setShown] = useState(OVERS_AT_FIRST);
  if (demo) return <Quiet testid="mc-commentary-none">Commentary is written from a match's own ball log. This demonstration fixture has none.</Quiet>;
  if (!commentary.length) return <Quiet testid="mc-commentary-none">Nothing has happened yet. Commentary starts with the first ball.</Quiet>;
  const groups = commentaryByOver(commentary);
  const visible = groups.slice(0, shown);
  let lastInnings = null;
  return (
    <section data-testid="mc-commentary" aria-label="Commentary, newest first">
      {visible.map((g) => {
        const head = g.innings !== lastInnings;
        lastInnings = g.innings;
        const inn = innings[g.innings];
        return (
          <div key={g.key}>
            {head && (
              <h2 style={{ ...T.role.label, color: T.content.secondary, margin: `${T.space.lg} 0 ${T.space.sm}` }}>
                {inn ? <><SideName side={teamOf(match, inn.battingTeam)}/> innings</> : `Innings ${g.innings + 1}`}
              </h2>
            )}
            <Panel testid="mc-over" style={{ marginBottom: T.space.md }}>
              <div style={{ padding: `${T.space.sm} ${T.space.md}`, background: T.surface.base, display: "grid", gap: "2px" }}>
                <span style={{ ...T.role.label, color: T.content.primary }}>Over {g.over + 1}</span>
                {g.end && <span data-testid="mc-over-end" style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>{g.end.text}</span>}
              </div>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {g.lines.map((c) => <CommentaryLine key={c.key} item={c}/>)}
              </ol>
            </Panel>
          </div>
        );
      })}
      {groups.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + OVERS_AT_FIRST)} className="pressBtn os-state" data-testid="mc-commentary-more"
          style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, cursor: "pointer", background: "transparent",
            border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, color: T.content.primary,
            fontFamily: T.type.body, fontSize: "14px", fontWeight: 500 }}>
          Earlier overs
        </button>
      )}
    </section>
  );
}

// ── Partnerships ────────────────────────────────────────

const nth = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export function PartnershipsTab({ match, innings, inningsSel, setInningsSel }) {
  const inn = innings[inningsSel];
  if (!inn) return <Quiet testid="mc-partnerships-empty">Nothing has been scored yet.</Quiet>;
  const rows = (inn.partnerships ?? []).map((p) => ({ ...p, open: false }));
  // The stand in progress, while both of the pair are in.
  const cp = inn.curPartner;
  const nm = (id) => inn.batsmen.find((b) => b.id === id)?.name;
  if (!inn.complete && cp && cp.bat1 && cp.bat2 && (cp.runs > 0 || cp.balls > 0)) {
    rows.push({ bat1: nm(cp.bat1) ?? "?", bat2: nm(cp.bat2) ?? "?", runs: cp.runs, balls: cp.balls, wicket: inn.wickets + 1, open: true });
  }
  const most = Math.max(1, ...rows.map((r) => r.runs));
  return (
    <section data-testid="mc-partnerships" aria-label="Partnerships">
      <InningsToggle match={match} innings={innings} inningsSel={inningsSel} setInningsSel={setInningsSel}/>
      {!rows.length ? <Quiet>No partnership yet.</Quiet> : (
        <Panel>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((r, i) => (
              <li key={i} data-testid="mc-partnership" style={{ padding: `${T.space.md} ${T.space.md}`, borderTop: i ? `1px solid ${T.line.subtle}` : "none", display: "grid", gap: T.space.xs }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: T.space.md, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ ...T.role.label, color: T.content.secondary }}>{nth(r.wicket)} wicket{r.open ? " · unbroken" : ""}</span>
                  <span style={{ ...T.role.figure.sm, fontSize: "16px", color: T.content.primary }}>{r.runs} <span style={{ color: T.content.secondary }}>({r.balls})</span></span>
                </div>
                <span style={{ ...T.role.body, color: T.content.primary }}>{r.bat1} and {r.bat2}</span>
                <div aria-hidden="true" style={{ height: "8px", borderRadius: T.radius.pill, background: T.fill.track, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round((r.runs / most) * 100)}%`, height: "100%", background: T.sport.batting, borderRadius: T.radius.pill }}/>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </section>
  );
}

// ── Analytics ───────────────────────────────────────────

export function AnalyticsTab({ match, innings, inningsSel, setInningsSel, overs }) {
  const [wheelOf, setWheelOf] = useState(null);
  const inn = innings[inningsSel];
  if (!inn) return <Quiet testid="mc-analytics-empty">Nothing has been scored yet.</Quiet>;
  const legal = inn.ballLog.filter((b) => b.type !== "Wd" && b.type !== "Nb");
  const dots = legal.filter((b) => (b.type ?? "run") === "run" && b.value === 0).length;
  const bnds = legal.filter((b) => (b.type ?? "run") === "run" && (b.value === 4 || b.value === 6)).length;
  const cfg = { overs };
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
      {innings.length > 1 && (<><H>Match worm</H><WormChart innings={innings} curIn={innings.length - 1} match={cfg}/></>)}
      <H>Runs per over</H>
      <ManhattanChart inn={inn} match={cfg}/>
      <div style={{ display: "grid", gridTemplateColumns: "var(--g-2,1fr 1fr)", gap: T.space.md }}>
        <div><H>Batting impact</H><BatsmanChart inn={inn}/></div>
        <div><H>Bowling economy</H><BowlerChart inn={inn}/></div>
      </div>
      <H>Shot placement</H>
      <div role="group" aria-label="Whose shots" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap", marginBottom: T.space.sm }}>
        {[{ id: null, name: "Whole innings" }, ...inn.batsmen.filter((b) => b.balls > 0)].map((b) => {
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
      {weather && <WeatherChip w={weather}/>}
    </section>
  );
}
