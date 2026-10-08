import { useState } from "react";
import { T } from "../design/tokens.js";
import { Card, ReadState } from "../ui/primitives.jsx";
import { SourceLine } from "../ui/sourceLine.jsx";
import { signedIn } from "../lib/api.js";
import { useLive } from "../lib/live.js";
import { readState } from "../lib/readState.js";
import { SRC_RECORD, seasonWindow } from "../lib/sourceWords.js";
import {
  METRICS, SQUAD_LIMIT, basisFor, demoSeasonRows, playerBars, seasonChoice, seasonsWindow, sidePlayers, squadBars, whoIs,
} from "../lib/seasonBars.js";

/**
 * Season bars (GA-I23, first slice): the Analytics performance tab's figures
 * by school season, from the `career_by_season` read the Leagues screen
 * already uses, and from nothing else.
 *
 *   No player picked   the side's leaders for one season, a bar each
 *                      (the top six; the line under the title says so)
 *   A player picked    that player's seasons, a bar each, oldest first
 *   One player in view the read shows this reader only one player of the
 *                      side (a pupil, a parent), so it is that player
 *
 * The rows are exactly what the read returns to this reader. A season he did
 * not bat or bowl in is a row that says so, never a bar of nought. Signed out
 * there is no read, so a demonstration is drawn and says "Demo" in the one
 * place that says it (SourceLine, through StateLabel); a signed-in screen
 * never draws it.
 *
 * Every figure is text as well as a bar. Nothing under 12px, every control
 * 44px, no motion, tokens only (the style lock).
 *
 * @param {object} props
 * @param {string} props.role
 * @param {string | null} props.team       the side on screen (the Analytics team filter)
 * @param {any[]} props.demoPlayers        the sample squad, used only when nobody is signed in
 */
export function SeasonBars({ role, team, demoPlayers }) {
  const demo = !signedIn();
  const [nonce, setNonce] = useState(0);
  const read = useLive("career_by_season", role, nonce);
  return (
    <SeasonBarsView demo={demo} team={team} onRetry={() => setNonce((n) => n + 1)}
      rows={demo ? demoSeasonRows(demoPlayers) : read.rows}
      said={demo ? null : readState(read, { what: "the season figures" })}/>
  );
}

/**
 * The panel, from rows it is handed. Split from the read so a test can hand it
 * the read's rows and look at what is drawn.
 * @param {object} props
 * @param {boolean} props.demo
 * @param {any[]} props.rows                   asSeasonCareer() rows (or the demonstration's)
 * @param {import("../lib/readState.js").Result | null} props.said   what the read said; null in the demonstration
 * @param {string | null} props.team
 * @param {() => void} [props.onRetry]
 * @param {{ metric?: "runs"|"wkts", picked?: string, season?: string | null }} [props.initial]  where the controls start
 */
export function SeasonBarsView({ demo, rows, said, team, onRetry, initial = {} }) {
  const [metric, setMetric] = useState(/** @type {"runs"|"wkts"} */ (initial.metric ?? "runs"));
  const [picked, setPicked] = useState(initial.picked ?? "");
  const [chosenSeason, setChosenSeason] = useState(/** @type {string | null} */ (initial.season ?? null));
  const inSide = team == null ? rows : rows.filter((r) => r.team === team);
  const players = sidePlayers(inSide, team);
  const who = whoIs(picked, players);
  const alone = !picked && players.length === 1;
  const choice = seasonChoice(inSide);
  const season = chosenSeason && choice.seasons.includes(chosenSeason) ? chosenSeason : choice.open;
  const m = METRICS[metric];
  const name = players.find((p) => p.id === who)?.name ?? "";

  const squad = who ? null : squadBars(inSide, { team, season, metric });
  const one = who ? playerBars(inSide, who, metric) : null;
  const items = squad
    ? squad.bars.map((b) => ({ key: b.id, label: b.name, v: b.v, current: false }))
    : (one?.bars ?? []).map((b) => ({ key: b.season, label: b.season, v: b.v, current: b.current }));
  const max = Math.max(1, ...items.map((i) => i.v ?? 0));
  const behind = squad ? squad.rows : (one?.rows ?? []);
  const shown = squad ? squad.bars.length : 0;

  const scope = who
    ? `One player: ${name}`
    : `${team ?? "Every side you can see"}, ${squad && squad.eligible > shown ? `top ${shown} of ${squad.eligible}` : `${shown} player${shown === 1 ? "" : "s"}`} by ${m.label.toLowerCase()}`;
  const window = who ? seasonsWindow(one?.bars.map((b) => b.season) ?? []) : seasonWindow(season);
  // One sentence that belongs to this panel alone: why these players, or why this one.
  const note = alone ? "The read shows you one player of this side, so these are their seasons."
    : squad && squad.eligible > 0 ? "No player is picked, so this is the side\u2019s leaders for the season. Pick a player to see their seasons."
    : null;
  const fill = metric === "runs" ? T.sport.batting : T.sport.bowling;
  const label = { fontFamily: T.type.body, fontSize: `${T.floor.read}px`, fontWeight: 600, color: T.content.secondary };
  const select = {
    ...T.role.control, minHeight: `${T.floor.target}px`, padding: `0 ${T.space.md}`, borderRadius: T.radius.md,
    border: `1px solid ${T.line.normal}`, background: T.surface.interactive, color: T.content.primary, maxWidth: "100%",
  };

  return (
    <Card sx={{ padding: T.space.lg, marginBottom: T.space.lg }} data-testid="season-bars-panel">
      <h3 style={{ margin: `0 0 ${T.space.sm}`, fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, color: T.content.primary }}>
        Season by season
      </h3>

      {!demo && said && said.state !== "ok" ? (
        <ReadState read={said} onRetry={onRetry} testId="season-bars-read-state"/>
      ) : (
        <>
          <div style={{ marginBottom: T.space.md }}>
            <SourceLine testid="source-line-season-bars" demo={demo} demoWhy="sample players"
              source={SRC_RECORD} scope={scope} window={window} denominator={basisFor(behind, metric)}>
              {note}
            </SourceLine>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: `${T.space.md} ${T.space.lg}`, marginBottom: T.space.lg }}>
            <div role="group" aria-label="Figure" data-testid="season-bars-metric" style={{ display: "flex", gap: T.space.sm }}>
              {Object.values(METRICS).map((x) => (
                <button key={x.key} type="button" className="pressBtn" aria-pressed={metric === x.key}
                  data-testid={`season-bars-${x.key}`} onClick={() => setMetric(/** @type {"runs"|"wkts"} */ (x.key))}
                  style={{
                    minHeight: `${T.floor.target}px`, minWidth: `${T.floor.target}px`, padding: `0 ${T.space.lg}`, borderRadius: T.radius.pill, cursor: "pointer",
                    border: `1px solid ${metric === x.key ? T.semantic.info : T.line.normal}`, background: metric === x.key ? T.surface.interactive : "transparent",
                    ...T.role.control, fontSize: "14px", color: metric === x.key ? T.content.primary : T.content.secondary,
                  }}>{x.label}</button>
              ))}
            </div>
            {players.length > 1 && (
              <label style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
                <span style={label}>Player</span>
                <select value={who} onChange={(e) => setPicked(e.target.value)} data-testid="season-bars-player" style={select}>
                  <option value="">The side&rsquo;s leaders</option>
                  {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {!who && choice.seasons.length > 0 && (
              <label style={{ display: "flex", flexDirection: "column", gap: T.space.xs }}>
                <span style={label}>Season</span>
                <select value={season ?? ""} onChange={(e) => setChosenSeason(e.target.value)} data-testid="season-bars-season" style={select}>
                  {choice.seasons.map((s) => <option key={s} value={s}>{s}{s === choice.current ? " (this season)" : ""}</option>)}
                </select>
              </label>
            )}
          </div>

          {items.length === 0 ? (
            <p data-testid="season-bars-none" style={{ margin: 0, fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.5, color: T.content.secondary }}>
              {inSide.length === 0
                ? `No season figures for ${team ?? "your sides"} that you may see. They are counted from scored balls and scorebook imports, so there is nothing to draw yet.`
                : `No ${m.plural} for ${team ?? "your sides"} in the ${season} school season: nobody ${metric === "runs" ? "scored one" : "took one"}, or the season has no ${metric === "runs" ? "innings" : "bowling"} on record.`}
            </p>
          ) : (
            <ol data-testid="season-bars" data-mode={who ? "player" : "squad"} data-metric={metric}
              style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: T.space.sm }}>
              {items.map((it) => (
                <li key={it.key} data-testid="season-bar" data-key={it.key} data-value={it.v ?? ""}
                  style={{ display: "grid", gridTemplateColumns: "minmax(84px, 32%) minmax(0, 1fr) minmax(64px, auto)", alignItems: "center", gap: T.space.md, minHeight: "28px" }}>
                  <span style={{ fontFamily: T.type.body, fontSize: "14px", lineHeight: 1.3, color: T.content.primary, overflowWrap: "anywhere" }}>
                    {it.label}{it.current && <span style={{ ...label, fontWeight: 400 }}>{" · this season"}</span>}
                  </span>
                  <span aria-hidden="true" style={{ display: "block", height: "12px", borderRadius: T.radius.xs, background: T.surface.interactive }}>
                    {it.v != null && it.v > 0 && <span style={{ display: "block", height: "100%", borderRadius: T.radius.xs, background: fill, width: `${Math.max(2, (it.v / max) * 100)}%` }}/>}
                  </span>
                  <span style={{ ...T.role.figure.sm, color: it.v == null ? T.content.secondary : T.content.primary, textAlign: "right" }}>
                    {it.v == null ? m.none : <>{it.v}<span style={{ ...label, fontWeight: 400 }}>{` ${it.v === 1 ? m.unit : m.plural}`}</span></>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Card>
  );
}
