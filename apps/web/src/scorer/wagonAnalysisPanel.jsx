import { useState } from "react";
import { T } from "../design/tokens.js";
import { CX, CY, LK_COLS, R_BND, R_IN, R_MID, R_PITCH, SEGS, areaWords, ballAngle, frameOf, lineKey, toXY, wagEnd } from "./field.js";
import { FieldLabels, MIRROR_NOTE, fieldSentence } from "./fieldLabels.jsx";
import { CHIP_VALUES, filterBalls, isPlaced, wagonAnalysis } from "./wagonAnalysis.mjs";
import { Card } from "./ui.jsx";
import { isOut } from "./format.js";

/**
 * SCRBRD-102 — the wagon-wheel analysis panel.
 *
 * A batter filter, a bowler filter, run chips that isolate a subset of
 * spokes in their own colours, off side against on side, and the eight named
 * areas with their runs and boundaries. The counting is wagonAnalysis.mjs's;
 * this component reads its numbers onto the field the scorer's own wheel
 * already draws (field.js) and says nothing new about where a ball went.
 *
 * ONE COMPONENT, TWO CALLERS. The Match Centre passes every batter and
 * bowler in the innings and lets a viewer pick either; a player's profile
 * fixes the batter (`fixedBatter`) and offers only a bowler (and, where the
 * read gives it cheaply, a match) — see AnalyticsTab (matchcentre/tabs.jsx)
 * and CareerWagonWheel (views/ProfilesView.jsx).
 *
 * Names are exactly what the caller passes in `batters` / `bowlers` /
 * `matches` — the Match Centre's own names in signed-in use, and whatever a
 * signed-out view already resolves them to. Nothing here adds a second name
 * path.
 *
 * @param {object} p
 * @param {object[]} [p.balls]  every ball in view before filtering (a whole
 *   innings' ballLog, or a player's shot-point rows), each carrying
 *   strikerId, bowlerId and (where known) matchId.
 * @param {(strikerId: string) => string} [p.handOf]  the hand of the batter
 *   who played a given ball, by id.
 * @param {{id: string, name: string}[] | null} [p.batters]  null when the
 *   batter is fixed by the caller (a profile) rather than chosen here.
 * @param {{id: string, name: string} | null} [p.fixedBatter]
 * @param {{id: string, name: string}[]} [p.bowlers]
 * @param {{id: string, label: string}[] | null} [p.matches]
 * @param {string} [p.title]
 * @param {boolean} [p.showPercent]  false drops the "%" under each side's bar
 *   (the Coach tab, whose never-list bars a percentage: SCRBRD-136 3.7).
 */
function WagonAnalysisPanel({ balls = [], handOf = () => "R", batters = null, fixedBatter = null, bowlers = [], matches = null, title = "Wagon-wheel analysis", showPercent = true }) {
  const [selBatter, setSelBatter] = useState(null);
  const [selBowler, setSelBowler] = useState(null);
  const [selMatch, setSelMatch] = useState(null);
  const [chip, setChip] = useState(/** @type {string | null} */ (null));

  const batterId = fixedBatter ? fixedBatter.id : selBatter;
  const filtered = filterBalls(balls, { batterId, bowlerId: selBowler, matchId: selMatch });
  const a = wagonAnalysis(filtered, { batHandFor: (b) => handOf(b.strikerId), chip });

  // The frame every spoke is drawn in (SCRBRD-101): the one batter's hand
  // when the view is narrowed to one, else the hand every placed ball
  // shares, or a right-hander's with the left-handers mirrored. Computed
  // over every placed ball regardless of the chip, so tapping a chip never
  // moves the field under the spokes still showing.
  const placedAll = filtered.filter(isPlaced);
  const frame = batterId ? { hand: handOf(batterId), mixed: false } : frameOf(placedAll.map((b) => handOf(b.strikerId)));
  const angleOf = (b) => ballAngle(b, handOf(b.strikerId), frame.hand);

  const Pill = ({ active, onClick, children, testid }) => (
    <button type="button" data-testid={testid} aria-pressed={active} onClick={onClick} className="pressBtn os-state"
      style={{ minHeight: T.floor.target, padding: `0 ${T.space.md}`, borderRadius: T.radius.pill, cursor: "pointer",
        background: active ? T.surface.interactive : "transparent", border: `1px solid ${active ? T.line.strong : T.line.normal}`,
        color: active ? T.content.primary : T.content.secondary, fontFamily: T.type.body, fontSize: "13px", fontWeight: 500 }}>
      {children}
    </button>
  );

  const Chip = ({ k, count }) => {
    const value = k === "all" ? null : k;
    const active = chip === value;
    const col = k === "all" ? T.content.secondary : LK_COLS[k];
    return (
      <button type="button" data-testid={`wagon-chip-${k}`} aria-pressed={active}
        onClick={() => setChip(active ? null : value)} className="pressBtn os-state"
        style={{ minHeight: T.floor.target, display: "flex", alignItems: "center", gap: T.space.xs, padding: `0 ${T.space.md}`,
          borderRadius: T.radius.pill, cursor: "pointer",
          background: active ? `${col}1f` : "transparent",
          border: `1px solid ${active ? `${col}66` : T.line.normal}` }}>
        <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "50%", background: col }}/>
        <span style={{ fontFamily: T.type.body, fontSize: "13px", fontWeight: 600, color: T.content.primary }}>{k === "all" ? "All" : `${k}s`}</span>
        <span style={{ ...T.role.figure.sm, fontSize: "12px", color: T.content.secondary }}>{count}</span>
      </button>
    );
  };

  /** @param {{label: string, runs: number, pct: number, color: string}} p */
  const SideCard = ({ label, runs, pct, color }) => (
    <div style={{ flex: "1 1 140px", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.md, padding: `${T.space.sm} ${T.space.md}`, background: T.surface.raised }}>
      <div style={{ ...T.role.label, color: T.content.secondary }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: T.space.xs, marginTop: T.space.xs }}>
        <span style={{ ...T.role.figure.md, color: T.content.primary }}>{runs}</span>
        <span style={{ ...T.role.body, color: T.content.secondary }}>run{runs === 1 ? "" : "s"}</span>
      </div>
      <div aria-hidden="true" style={{ height: "6px", borderRadius: T.radius.pill, background: T.fill.track, overflow: "hidden", marginTop: T.space.xs }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: T.radius.pill }}/>
      </div>
      {showPercent && <div style={{ ...T.role.figure.sm, fontSize: "12px", color: T.content.secondary, marginTop: "2px" }}>{a.sides.total ? `${pct}%` : "—"}</div>}
    </div>
  );

  /** @param {{key: string, label: string, runs: number, boundaries: number}} p */
  const AreaCell = ({ label, runs, boundaries }) => (
    <div data-testid={`wagon-area-${label.toLowerCase().replace(/\s+/g, "-")}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: `${T.space.xs} ${T.space.sm}`, borderBottom: `1px solid ${T.line.subtle}`, gap: T.space.sm }}>
      <span style={{ ...T.role.body, fontSize: "13px", color: T.content.primary }}>{label}</span>
      <span style={{ display: "flex", gap: T.space.sm, alignItems: "baseline" }}>
        <span style={{ ...T.role.figure.sm, fontSize: "13px", color: T.content.primary }}>{runs}</span>
        {boundaries > 0 && <span style={{ ...T.role.figure.sm, fontSize: "12px", color: T.content.secondary }}>{boundaries} {boundaries === 1 ? "boundary" : "boundaries"}</span>}
      </span>
    </div>
  );

  const offAreas = a.areas.filter((x) => x.side === "off");
  const legAreas = a.areas.filter((x) => x.side === "leg");
  const excludedTotal = a.excluded.unplaced + a.excluded.straight;

  return (
    <div data-testid="wagon-analysis" aria-label={title} style={{ display: "flex", flexDirection: "column", gap: T.space.md }}>
      <h2 style={{ ...T.role.label, color: T.content.secondary, margin: 0 }}>{title}</h2>

      {(batters || bowlers.length > 0 || matches) && (
        <div style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
          {batters && (
            <div role="group" aria-label="Filter by batter" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
              <Pill active={selBatter == null} onClick={() => setSelBatter(null)} testid="wagon-batter-all">Every batter</Pill>
              {batters.map((b) => (
                <Pill key={b.id} active={selBatter === b.id} onClick={() => setSelBatter(b.id)} testid={`wagon-batter-${b.id}`}>{b.name}</Pill>
              ))}
            </div>
          )}
          {bowlers.length > 0 && (
            <div role="group" aria-label="Filter by bowler" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
              <Pill active={selBowler == null} onClick={() => setSelBowler(null)} testid="wagon-bowler-all">Every bowler</Pill>
              {bowlers.map((b) => (
                <Pill key={b.id} active={selBowler === b.id} onClick={() => setSelBowler(b.id)} testid={`wagon-bowler-${b.id}`}>{b.name}</Pill>
              ))}
            </div>
          )}
          {matches && matches.length > 1 && (
            <div role="group" aria-label="Filter by match" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
              <Pill active={selMatch == null} onClick={() => setSelMatch(null)} testid="wagon-match-all">Every match</Pill>
              {matches.map((m) => (
                <Pill key={m.id} active={selMatch === m.id} onClick={() => setSelMatch(m.id)} testid={`wagon-match-${m.id}`}>{m.label}</Pill>
              ))}
            </div>
          )}
        </div>
      )}

      <div role="group" aria-label="Run chips" style={{ display: "flex", gap: T.space.xs, flexWrap: "wrap" }}>
        <Chip k="all" count={a.chips.all}/>
        {CHIP_VALUES.map((k) => <Chip key={k} k={k} count={a.chips[k]}/>)}
      </div>

      {a.chips.all === 0 ? (
        <p style={{ ...T.role.body, color: T.content.secondary, margin: 0, padding: `${T.space.lg} 0`, textAlign: "center" }}>
          No placed shots for this filter.
        </p>
      ) : (
        <Card style={{ padding: "14px 16px" }}>
          <div data-testid="wagon-analysis-wheel" data-frame={frame.hand} style={{ position: "relative", width: "100%", maxWidth: "280px", margin: "0 auto", aspectRatio: "1" }}>
            <svg viewBox="0 0 300 300" style={{ width: "100%", height: "100%", display: "block" }} role="img"
              aria-label={`Wagon wheel: ${a.shown.length} shot${a.shown.length === 1 ? "" : "s"} shown of ${a.chips.all} placed. ${fieldSentence(frame.hand, frame.mixed)}`}>
              <circle cx={CX} cy={CY} r={R_BND + 3} fill={T.field.ground} stroke={T.field.rule} strokeWidth="1"/>
              <circle cx={CX} cy={CY} r={R_MID} fill="none" stroke={T.field.rule} strokeWidth="1" strokeDasharray="4 3"/>
              <circle cx={CX} cy={CY} r={R_IN} fill="none" stroke={T.field.rule} strokeWidth="1" strokeDasharray="3 4"/>
              {SEGS.map((s) => { const [x, y] = toXY(s.angle - 15, R_BND); return (
                <line key={`g${s.id}`} x1={CX} y1={CY} x2={x} y2={y} stroke={T.field.hairline} strokeWidth="0.5"/>); })}
              {a.shown.map((b, i) => {
                const { xy: [ex, ey], synthetic } = wagEnd(angleOf(b), b);
                const key = lineKey(b), col = LK_COLS[key];
                const w = b.value === 6 ? 2.5 : b.value === 4 ? 2 : 1.2, op = b.value === 0 ? 0.25 : 0.72;
                const where = areaWords(b, handOf(b.strikerId));
                return (
                  <g key={`wl${i}`} data-spoke={key} data-colour={col}>
                    <title>{`${isOut(b) ? "Wicket" : `${b.value || 0} run${b.value === 1 ? "" : "s"}`}${where ? ` — ${where}` : ""}`}</title>
                    <line x1={CX} y1={CY} x2={ex} y2={ey} stroke={T.field.casing} strokeWidth={w + 1.6} strokeDasharray={synthetic ? "2 2" : undefined} opacity={op} strokeLinecap="round"/>
                    <line x1={CX} y1={CY} x2={ex} y2={ey} stroke={col} strokeWidth={w} strokeDasharray={synthetic ? "2 2" : undefined} opacity={op} strokeLinecap="round"/>
                  </g>
                );
              })}
              {a.shown.filter((b) => b.value >= 4).map((b, i) => {
                const { xy: [ex, ey] } = wagEnd(angleOf(b), b);
                return <circle key={`d${i}`} cx={ex} cy={ey} r={b.value === 6 ? 5 : 3.5} fill={LK_COLS[lineKey(b)]} opacity="0.95" stroke={T.field.casing} strokeWidth="0.8"/>;
              })}
              <rect x={CX - 4.5} y={CY - R_PITCH} width={9} height={R_PITCH * 2} rx="2.5" fill={T.field.pitch} stroke={T.field.mark} strokeWidth="0.7"/>
            </svg>
            <FieldLabels hand={frame.hand}/>
          </div>
          {frame.mixed && (
            <p data-testid="wagon-analysis-mirror-note" style={{ margin: "8px 0 0", textAlign: "center", fontFamily: T.type.body, fontSize: "12px", lineHeight: 1.4, color: T.content.secondary }}>
              {MIRROR_NOTE}
            </p>
          )}

          <div style={{ display: "flex", gap: T.space.sm, flexWrap: "wrap", marginTop: T.space.md }}>
            <SideCard label="Off side" runs={a.sides.off.runs} pct={a.sides.off.pct} color={T.sport.bowling}/>
            <SideCard label="On side" runs={a.sides.leg.runs} pct={a.sides.leg.pct} color={T.sport.batting}/>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "var(--g-2,1fr 1fr)", gap: T.space.md, marginTop: T.space.md }}>
            <div>
              <div style={{ ...T.role.label, color: T.content.secondary, marginBottom: T.space.xs }}>Off side areas</div>
              {offAreas.map((ar) => <AreaCell key={ar.key} label={ar.label} runs={ar.runs} boundaries={ar.boundaries}/>)}
            </div>
            <div>
              <div style={{ ...T.role.label, color: T.content.secondary, marginBottom: T.space.xs }}>On side areas</div>
              {legAreas.map((ar) => <AreaCell key={ar.key} label={ar.label} runs={ar.runs} boundaries={ar.boundaries}/>)}
            </div>
          </div>

          {excludedTotal > 0 && (
            <p data-testid="wagon-analysis-excluded" style={{ ...T.role.body, fontSize: "12px", color: T.content.secondary, marginTop: T.space.md, marginBottom: 0, lineHeight: 1.5 }}>
              {a.excluded.unplaced > 0 && `${a.excluded.unplaced} ball${a.excluded.unplaced === 1 ? "" : "s"} carried no placement at all. `}
              {a.excluded.straight > 0 && `${a.excluded.straight} ball${a.excluded.straight === 1 ? "" : "s"} went dead straight or dead behind the stumps — neither off nor on, and left out of the sides and areas above.`}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

export { WagonAnalysisPanel };
