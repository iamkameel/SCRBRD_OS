import { useState } from "react";
import { T } from "../design/tokens.js";
import { Card, ReadState } from "../ui/primitives.jsx";
import { SourceLine } from "../ui/sourceLine.jsx";
import { ChartTable } from "../ui/ChartTable.jsx";
import { useLive } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { profile } from "../lib/session.js";
import { SRC_RECORD, dateWindow, seasonWindow } from "../lib/sourceWords.js";
import {
  MIN_MATCHES, axisTop, sideSchool, floorNote, inningsText, matchesBasis, rainNote, rateText, seasonOptions, seasonPoints, seasonTable,
  spokenSummary, unreadableNote,
} from "../lib/sideSeason.js";

/**
 * The side's season, match by match (GA-I23, slice B3): the Analytics
 * performance tab's panel over the `side_season` read, drawn for a signed-in
 * reader in place of the demonstration (DemoWorm stays for signed out).
 *
 * One point per completed limited-overs match: the side's run rate and the
 * opposition's. The line is the season's run rate so far, from the 5th match;
 * under five matches the panel says so and draws no line. A rain-cut match
 * says its revised overs. No verdict word anywhere (Compare D3). Team-level:
 * no child is named, and it is never a public page; the read gates who.
 *
 * Every figure is text as well as a mark: a list of the matches sits under the
 * chart, a "Show as table" holds the same figures, and a visually hidden
 * sentence says the whole panel. Nothing under 12px, nothing tapped under
 * 44px, no motion, tokens only (the style lock).
 *
 * @param {object} props
 * @param {string} props.role
 * @param {string | null} props.team     the side on screen (the Analytics team filter)
 * @param {{ team?: string | null, school?: string | null }[]} props.players  the roster rows in view, which say which school each side is
 */
export function SideSeason({ role, team, players }) {
  const school = sideSchool(players, team, profile()?.assignments ?? []);
  if (!team || !school) {
    return (
      <Card sx={{ padding: T.space.lg, marginBottom: T.space.lg }} data-testid="side-season-panel">
        <Title/>
        <p data-testid="side-season-none" style={{ ...bodyText(), margin: 0 }}>Pick a side to see its season, match by match.</p>
      </Card>
    );
  }
  return <SideSeasonRead role={role} team={team} school={school}/>;
}

function SideSeasonRead({ role, team, school }) {
  const [nonce, setNonce] = useState(0);
  const read = useLive("side_season", role, nonce, { schoolId: school, teamCode: team });
  return <SideSeasonView rows={read.rows} said={readState(read, { what: "the side’s completed matches" })} team={team} onRetry={() => setNonce((n) => n + 1)}/>;
}

const bodyText = () => ({ fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.5, color: T.content.secondary });
const Title = () => (
  <h3 style={{ margin: `0 0 ${T.space.sm}`, fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, color: T.content.primary }}>
    Season, match by match
  </h3>
);

// The chart's own box, in drawing units. Marks are scaled with it; the words are not.
const STEP = 48, H = 120, PAD = 10;

/**
 * The panel, from rows it is handed (asSideSeason() rows). Split from the read
 * so a test can hand it rows and look at what is drawn.
 * @param {object} props
 * @param {any[]} props.rows
 * @param {import("../lib/readState.js").Result | null} props.said
 * @param {string | null} props.team
 * @param {() => void} [props.onRetry]
 * @param {{ season?: string | null }} [props.initial]
 */
export function SideSeasonView({ rows, said, team, onRetry, initial = {} }) {
  const [chosen, setChosen] = useState(/** @type {string | null} */ (initial.season ?? null));
  const choice = seasonOptions(rows);
  const season = chosen && choice.seasons.includes(chosen) ? chosen : choice.open;
  const points = seasonPoints(rows, season);
  const label = { fontFamily: T.type.body, fontSize: `${T.floor.read}px`, fontWeight: 600, color: T.content.secondary };

  if (said && said.state !== "ok") {
    return (
      <Card sx={{ padding: T.space.lg, marginBottom: T.space.lg }} data-testid="side-season-panel">
        <Title/>
        <ReadState read={said} onRetry={onRetry} testId="side-season-read-state"/>
      </Card>
    );
  }

  const top = axisTop(points);
  const W = Math.max(points.length, MIN_MATCHES) * STEP;
  const x = (i) => i * STEP + STEP / 2;
  const y = (v) => H - PAD - (v / top) * (H - 2 * PAD);
  const drawn = (key) => points.map((p, i) => ({ i, v: p[key] })).filter((d) => d.v != null);
  const path = (key) => drawn(key).map((d) => `${x(d.i)},${y(d.v)}`).join(" ");
  const soFarFor = drawn("soFarFor"), soFarAgainst = drawn("soFarAgainst");
  const note = [floorNote(points), rainNote(points), unreadableNote(points)].filter(Boolean);
  const window = dateWindow(rows.filter((r) => r.season === season).map((r) => r.startsAt)) ?? seasonWindow(season);

  return (
    <Card sx={{ padding: T.space.lg, marginBottom: T.space.lg }} data-testid="side-season-panel">
      <Title/>
      <div style={{ marginBottom: T.space.md }}>
        <SourceLine testid="source-line-side-season" source={SRC_RECORD} scope={`${team ?? "The side"} against the opposition, one point a match`}
          window={[seasonWindow(season), window && window !== seasonWindow(season) ? window : null].filter(Boolean).join(", ")}
          denominator={matchesBasis(points)}>
          {note.length > 0 && note.join(" ")}
        </SourceLine>
      </div>

      {choice.seasons.length > 1 && (
        <label style={{ display: "flex", flexDirection: "column", gap: T.space.xs, marginBottom: T.space.md, alignItems: "flex-start" }}>
          <span style={label}>Season</span>
          <select value={season ?? ""} onChange={(e) => setChosen(e.target.value)} data-testid="side-season-season"
            style={{
              ...T.role.control, minHeight: `${T.floor.target}px`, padding: `0 ${T.space.md}`, borderRadius: T.radius.md, maxWidth: "100%",
              border: `1px solid ${T.line.normal}`, background: T.surface.interactive, color: T.content.primary,
            }}>
            {choice.seasons.map((s) => <option key={s} value={s}>{s}{s === choice.current ? " (this season)" : ""}</option>)}
          </select>
        </label>
      )}

      <p className="sr-only" data-testid="side-season-spoken">{spokenSummary(points)}</p>

      {points.length === 0 ? (
        <p data-testid="side-season-none" style={{ ...bodyText(), margin: 0 }}>
          No completed limited-overs matches for {team ?? "this side"} in the {season ?? "current"} school season that you may see.
        </p>
      ) : (
        <>
          <svg data-testid="side-season-chart" data-points={points.filter((p) => p.forRate != null || p.againstRate != null).length}
            viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" style={{ width: "100%", maxHeight: "180px", display: "block" }}>
            <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke={T.line.normal} strokeWidth="1"/>
            {soFarAgainst.length > 1 && <polyline points={path("soFarAgainst")} fill="none" stroke={T.semantic.critical} strokeWidth="2" strokeDasharray="5 3" strokeLinejoin="round"/>}
            {soFarFor.length > 1 && <polyline points={path("soFarFor")} fill="none" stroke={T.semantic.positive} strokeWidth="2.5" strokeLinejoin="round"/>}
            {soFarAgainst.length === 1 && <line x1={x(soFarAgainst[0].i) - 8} x2={x(soFarAgainst[0].i) + 8} y1={y(soFarAgainst[0].v)} y2={y(soFarAgainst[0].v)} stroke={T.semantic.critical} strokeWidth="2" strokeDasharray="5 3"/>}
            {soFarFor.length === 1 && <line x1={x(soFarFor[0].i) - 8} x2={x(soFarFor[0].i) + 8} y1={y(soFarFor[0].v)} y2={y(soFarFor[0].v)} stroke={T.semantic.positive} strokeWidth="2.5"/>}
            {points.map((p, i) => p.againstRate != null && (
              <rect key={`a${i}`} data-testid="side-season-point-against" x={x(i) - 3.5} y={y(p.againstRate) - 3.5} width="7" height="7"
                fill={p.rainCut ? T.surface.raised : T.semantic.critical} stroke={T.semantic.critical} strokeWidth="1.5"/>
            ))}
            {points.map((p, i) => p.forRate != null && (
              <circle key={`f${i}`} data-testid="side-season-point" data-match={p.matchId} data-n={p.n} data-rate={p.forRate.toFixed(2)}
                cx={x(i)} cy={y(p.forRate)} r="4.5" fill={p.rainCut ? T.surface.raised : T.semantic.positive} stroke={T.semantic.positive} strokeWidth="2"/>
            ))}
          </svg>
          <p style={{ ...label, fontWeight: 400, margin: `${T.space.xs} 0 ${T.space.sm}` }} data-testid="side-season-scale">
            Runs an over, 0 to {top}. Points: each match, side as a circle, opposition as a square, hollow where rain cut it short.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: `${T.space.xs} ${T.space.lg}`, marginBottom: T.space.md, ...label, fontWeight: 400 }}>
            <span style={{ display: "flex", alignItems: "center", gap: T.space.sm }}><span aria-hidden="true" style={{ width: 20, height: 3, background: T.semantic.positive }}/>The side</span>
            <span style={{ display: "flex", alignItems: "center", gap: T.space.sm }}><span aria-hidden="true" style={{ width: 20, borderTop: `2px dashed ${T.semantic.critical}` }}/>Opposition</span>
            <span data-testid="side-season-line-label">{points.length >= MIN_MATCHES ? "Lines: run rate this season so far" : `No line yet: it starts at the ${MIN_MATCHES}th match`}</span>
          </div>

          <ol data-testid="side-season-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: T.space.sm }}>
            {points.map((p) => (
              <li key={p.matchId} data-testid="side-season-match" data-rain={p.rainCut ? "true" : undefined}
                style={{ ...bodyText(), color: T.content.primary, overflowWrap: "anywhere" }}>
                <span style={{ fontWeight: 700 }}>{p.n}. {p.opponent ? `v ${p.opponent}` : "Match"}</span>
                {p.date && <span style={{ ...label, fontWeight: 400 }}>{` · ${p.date}`}</span>}
                <br/>
                {p.readable ? (
                  <>
                    Side {inningsText(p.forRuns, p.forWickets, p.forBalls) ?? "no figures"}{p.forRate != null && ` (${rateText(p.forRate)} an over)`}
                    {" · "}Opposition {inningsText(p.againstRuns, p.againstWickets, p.againstBalls) ?? "no figures"}{p.againstRate != null && ` (${rateText(p.againstRate)} an over)`}
                  </>
                ) : "No figures you may read for this match."}
                <br/>
                <span style={{ color: T.content.secondary }}>
                  {[p.allotment, p.resultLine].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ol>
          <ChartTable testid="side-season-table" tables={[seasonTable(points, season)]}/>
        </>
      )}
    </Card>
  );
}
