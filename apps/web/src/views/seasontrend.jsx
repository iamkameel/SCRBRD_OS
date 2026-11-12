import { useId, useState } from "react";
import { T } from "../design/tokens.js";
import { Card, ReadState } from "../ui/primitives.jsx";
import { SourceLine } from "../ui/sourceLine.jsx";
import { ChartTable } from "../ui/ChartTable.jsx";
import { signedIn } from "../lib/api.js";
import { useBoyRead } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { SRC_RECORD, seasonWindow } from "../lib/sourceWords.js";
import {
  LINE_LABEL, chartGeometry, lineState, rollingFive, runsLabel, seasonChoice, seasonFigures, seasonPoints, spokenSummary,
  trendNotes, trendTable,
} from "../lib/seasonTrend.js";

/**
 * A player's season, innings by innings (GA-I23 slice 2, B2;
 * docs/design/SCENARIO_AND_TREND_design.md §B2.2, §B3, §B5; Q7, Q8, Q9, Q12).
 *
 * One boy's innings in one school season, a point each, from the first; the
 * line of runs an innings over his last five, once there are 6 innings and
 * 30 balls faced in the last five; the season so far beside it. Every figure
 * is the `innings_by_season` read's (lib/seasonTrend.js does the arithmetic,
 * and only that), and the same figures are a table behind "Show as table"
 * and a spoken summary for a screen reader (GA-I31).
 *
 * WHO SEES IT is the read's gate, unchanged (B1): his family on a live link
 * (his own self link included), and staff of his side who are not pupils.
 * A team-mate, the captain included, is answered with nothing, and this
 * panel then says it has no innings to show that the reader may see: it
 * cannot tell a refusal from a boy who has not batted, so it claims neither.
 * No read is made without a boy (useBoyRead), and signed out there is no
 * read and no panel: a demonstration of a named child's innings would read
 * like the real thing.
 *
 * Signed in only; never on a public page. Nothing under 12px, every control
 * 44px, no motion at all, tokens only (the style lock). No verdict words (Q9).
 */

/**
 * The panel for one boy, read for him alone.
 * @param {{ role: string, playerId: string | null, who: string, self?: boolean, testid?: string, bare?: boolean }} props
 *   who   the name the panel uses ("R Pillay"), or "You" on his own screen
 */
export function SeasonTrend({ role, playerId, who, self = false, testid = "season-trend", bare = false }) {
  const [nonce, setNonce] = useState(0);
  const read = useBoyRead("innings_by_season", role, playerId, nonce, signedIn());
  if (!signedIn() || !playerId) return null;
  // Keyed on the boy: nothing chosen for one boy is carried to the next.
  return (
    <SeasonTrendView key={playerId} rows={read.rows} who={who} self={self} testid={testid} bare={bare}
      said={readState(read, { what: self ? "your innings" : `${who}'s innings` })}
      onRetry={() => setNonce((n) => n + 1)}/>
  );
}

/**
 * The Analytics performance tab's: pick a player of the side on screen, then
 * his panel. The list is the players this reader already reads for the side;
 * the read behind the panel is gated per boy on the server all the same.
 * @param {{ role: string, players: { id: string, name: string }[] }} props
 */
export function AnalyticsSeasonTrend({ role, players }) {
  const [picked, setPicked] = useState(players.length === 1 ? players[0].id : "");
  const who = players.find((p) => p.id === picked) ?? null;
  return (
    <Card sx={{ padding: T.space.lg, marginBottom: T.space.lg }} data-testid="season-trend-pick">
      <h3 style={heading}>Innings by innings</h3>
      {players.length === 0 ? (
        <p data-testid="season-trend-no-players" style={sentence}>No player of this side that you may see, so there are no innings to show.</p>
      ) : (
        <label style={{ display: "flex", flexDirection: "column", gap: T.space.xs, marginBottom: who ? T.space.md : 0 }}>
          <span style={labelStyle()}>Player</span>
          <select value={picked} onChange={(e) => setPicked(e.target.value)} data-testid="season-trend-player" style={selectStyle()}>
            <option value="">Pick a player</option>
            {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {players.length > 0 && !who && (
        <p data-testid="season-trend-none-picked" style={{ ...sentence, marginTop: T.space.md }}>Pick a player to see his season innings by innings.</p>
      )}
      {who && <SeasonTrend role={role} playerId={who.id} who={who.name} testid="season-trend" bare/>}
    </Card>
  );
}

const heading = { margin: `0 0 ${T.space.sm}`, fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, color: T.content.primary };
const sentence = { margin: 0, fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.5, color: T.content.secondary };
// Read at render, never at import: the theme can change under a mounted page.
const labelStyle = () => ({ fontFamily: T.type.body, fontSize: `${T.floor.read}px`, fontWeight: 600, color: T.content.secondary });
const selectStyle = () => ({
  ...T.role.control, minHeight: `${T.floor.target}px`, padding: `0 ${T.space.md}`, borderRadius: T.radius.md,
  border: `1px solid ${T.line.normal}`, background: T.surface.interactive, color: T.content.primary, maxWidth: "100%",
});

const W = 320, H = 140, PAD = 12;

/**
 * The panel, from rows it is handed: split from the read so a test can hand
 * it the read's rows and look at what is drawn.
 * @param {object} props
 * @param {import("../lib/seasonTrend.js").InningsRow[]} props.rows
 * @param {import("../lib/readState.js").Result} props.said
 * @param {string} props.who
 * @param {boolean} [props.self]
 * @param {() => void} [props.onRetry]
 * @param {string} [props.testid]
 * @param {boolean} [props.bare]          drawn inside another card (Analytics' picker), so no card or title of its own
 * @param {{ season?: string }} [props.initial]
 */
export function SeasonTrendView({ rows, said, who, self = false, onRetry, testid = "season-trend", bare = false, initial = {} }) {
  const [chosen, setChosen] = useState(/** @type {string | null} */ (initial.season ?? null));
  const sumId = useId();
  const choice = seasonChoice(rows);
  const season = chosen && choice.seasons.includes(chosen) ? chosen : choice.open;
  const current = season != null && season === choice.current;
  const points = seasonPoints(rows, season);
  const st = lineState(points, { self });
  const figs = seasonFigures(points);
  const notes = trendNotes(points, { self, current });
  const g = chartGeometry(points, { w: W, h: H, pad: PAD, draw: st.draw });
  const line = st.draw ? rollingFive(points) : [];
  const latest = line[line.length - 1] ?? null;

  const body = (
    <div data-testid={testid} data-state={said.state} data-season={season ?? ""} data-line={st.draw ? "drawn" : "none"}
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: T.space.md }}>
      {said.state !== "ok" && said.state !== "empty" ? (
        <ReadState read={said} onRetry={onRetry} testId={`${testid}-read-state`}/>
      ) : rows.length === 0 ? (
        <p data-testid={`${testid}-none`} style={sentence}>
          {self ? "No innings of yours on record yet." : `No innings for ${who} that you may see.`} Innings are counted from scored balls and scorebook imports.
        </p>
      ) : (
        <>
          {choice.seasons.length > 1 || (!season && choice.seasons.length > 0) ? (
            <label style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
              <span style={labelStyle()}>Season</span>
              <select value={season ?? ""} onChange={(e) => setChosen(e.target.value)} data-testid={`${testid}-season`} style={selectStyle()}>
                {!season && <option value="">This season</option>}
                {choice.seasons.map((s) => <option key={s} value={s}>{s}{s === choice.current ? " (this season)" : ""}</option>)}
              </select>
            </label>
          ) : null}

          {!season ? (
            <p data-testid={`${testid}-dnb`} style={sentence}>Did not bat this season.</p>
          ) : (
            <>
              <SourceLine testid={`source-line-${testid}`} source={SRC_RECORD} scope={self ? "You" : `One player: ${who}`}
                window={seasonWindow(season)} denominator={st.basis}>
                {notes.length ? notes.join(" ") : null}
              </SourceLine>

              <dl data-testid={`${testid}-figures`} style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: T.space.md }}>
                {[
                  ["Runs", figs.runs],
                  ["Innings", figs.innings],
                  ["Not out", figs.notOuts],
                  ["Average", figs.average ?? "no average yet"],
                  ["Strike rate", figs.strikeRate ?? "no balls recorded"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt style={labelStyle()}>{k}</dt>
                    <dd data-figure={k} style={{ ...(typeof v === "number" ? T.role.figure.sm : { fontFamily: T.type.body, fontSize: "14px" }), color: typeof v === "number" ? T.content.primary : T.content.secondary, margin: 0 }}>{v}</dd>
                  </div>
                ))}
              </dl>

              <figure style={{ margin: 0, display: "grid", gap: T.space.xs, minWidth: 0 }}>
                <p style={{ ...sentence, fontSize: `${T.floor.read}px` }}>
                  Runs in each innings, 0 to {g.top}, in the order played{st.draw ? `. ${LINE_LABEL}: ${latest?.v} at the ${ordinal(latest?.n ?? 0)} innings` : ""}.
                </p>
                <svg data-testid={`${testid}-chart`} viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet"
                  role="img" aria-label={`${self ? "Your" : `${who}'s`} runs, innings by innings`} aria-describedby={sumId}
                  style={{ display: "block", maxWidth: "100%", height: "auto" }}>
                  <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke={T.line.strong} strokeWidth="1"/>
                  <line x1={PAD} x2={W - PAD} y1={PAD} y2={PAD} stroke={T.line.subtle} strokeWidth="1"/>
                  {g.line.length > 1 && (
                    <polyline data-testid={`${testid}-line`} fill="none" stroke={T.content.primary} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                      points={g.line.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}/>
                  )}
                  {g.dots.map((p) => {
                    const fill = p.out ? T.sport.batting : T.surface.raised;
                    const common = { "data-testid": `${testid}-point`, "data-runs": p.runs, "data-out": p.out ? "true" : "false", "data-source": p.source,
                      fill, stroke: T.sport.batting, strokeWidth: 2 };
                    return p.source === "scorebook"
                      ? <rect key={p.n} {...common} x={p.x - 4.5} y={p.y - 4.5} width="9" height="9"/>
                      : <circle key={p.n} {...common} cx={p.x} cy={p.y} r="4.5"/>;
                  })}
                </svg>
                <p id={sumId} className="sr-only" data-testid={`${testid}-summary`}>{spokenSummary({ who: self ? "You" : who, season, points, self })}</p>
                <Legend line={st.draw} book={figs.bookInnings > 0}/>
                <p aria-hidden="true" style={{ ...sentence, fontSize: `${T.floor.read}px`, display: "flex", justifyContent: "space-between", gap: T.space.md }}>
                  <span>Innings 1</span><span>{points.length > 1 ? `Innings ${points.length}` : ""}</span>
                </p>
              </figure>

              <p data-testid={`${testid}-innings`} style={{ ...T.role.figure.sm, color: T.content.primary, margin: 0, overflowWrap: "anywhere" }}>
                {points.map(runsLabel).join(" · ")}
              </p>

              <ChartTable testid={`${testid}-table`} tables={trendTable({ who: self ? "You" : who, season, points, self })}/>
            </>
          )}
        </>
      )}
    </div>
  );

  if (bare) return body;
  return (
    <Card sx={{ padding: T.space.lg }} data-testid={`${testid}-card`}>
      <h3 style={heading}>Innings by innings</h3>
      {body}
    </Card>
  );
}

const ordinal = (/** @type {number} */ n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** What the marks mean, in words beside each mark: never colour alone. */
function Legend({ line, book }) {
  const item = { display: "inline-flex", alignItems: "center", gap: T.space.xs };
  const glyph = (/** @type {import("react").ReactNode} */ g) => <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" style={{ flexShrink: 0 }}>{g}</svg>;
  return (
    <p style={{ ...sentence, fontSize: `${T.floor.read}px`, display: "flex", flexWrap: "wrap", gap: `${T.space.xs} ${T.space.lg}` }}>
      <span style={item}>{glyph(<circle cx="7" cy="7" r="4.5" fill={T.sport.batting} stroke={T.sport.batting} strokeWidth="2"/>)}out</span>
      <span style={item}>{glyph(<circle cx="7" cy="7" r="4.5" fill={T.surface.raised} stroke={T.sport.batting} strokeWidth="2"/>)}not out</span>
      {book && <span style={item}>{glyph(<rect x="2.5" y="2.5" width="9" height="9" fill={T.surface.raised} stroke={T.sport.batting} strokeWidth="2"/>)}from a scorebook</span>}
      {line && <span style={item}>{glyph(<line x1="1" x2="13" y1="7" y2="7" stroke={T.content.primary} strokeWidth="2" strokeLinecap="round"/>)}{LINE_LABEL.toLowerCase()}</span>}
    </p>
  );
}
