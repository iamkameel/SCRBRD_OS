import { useMemo, useState } from "react";
import { T } from "../../design/tokens.js";
import { Chip } from "../../ui/board.jsx";
import { commentaryByOver } from "../../lib/matchCentre.js";
import { overRows } from "../../display/data.js";
import { CardHead, Panel } from "./bits.jsx";

/**
 * THE OVER STORY on the Summary (EXPERIENCE_PASS §3.3, Slice 2; SCRBRD-133
 * §6), lifted from the ground display's panel (display/panels.jsx OverStory,
 * the same rows from display/data.js overRows()): one row an over, newest
 * first — its number, its bowler, its balls as the Board's chips, its runs and
 * wickets ("7 · 1W", a maiden "M"), and the score after it. A row is a button:
 * it opens in place to that over's lines, the shared generator's, as the
 * Commentary tab has them, and a second tap closes it (§6.4).
 *
 * Names: the bowler as the page's log names him: on the public page the name
 * rule's, a position otherwise. A wicket the free hit saved is drawn as its
 * runs, never a W (boardBall(), §6.3 A). No motion: a list being read.
 *
 * Its own chunk, fetched with the Summary that draws it: the public page's
 * static graph has a ceiling (tools/check-bundle.mjs).
 *
 * @param {{inn: any, index: number, events: any[] | null, fold: any, commentary: any[], overs: number}} p
 */
export default function OverStory({ inn, index, events, fold, commentary, overs }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(/** @type {number | null} */ (null));
  const rows = useMemo(() => overRows(inn, { events: events ?? [], fold: fold ?? {}, n: index, rows: 1000 }), [inn, events, fold, index]);
  const groups = useMemo(() => commentaryByOver((commentary ?? []).filter((c) => c.innings === index)), [commentary, index]);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 6);
  const bowled = (inn.overLog ?? []).length;
  return (
    <Panel testid="mc-over-story">
      <CardHead icon="overs">Over story</CardHead>
      <p data-testid="mc-over-story-count" style={{ ...T.role.body, fontSize: "13px", color: T.content.secondary, margin: 0, padding: `${T.space.xs} ${T.space.md} 0` }}>
        {bowled} of {inn.overs ?? overs} overs{rows.some((r) => r.current) ? ", the one in play first" : ""}
      </p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.map((r) => {
          const on = open === r.over;
          const lines = on ? (groups.find((g) => g.over === r.over - 1)?.lines ?? []) : [];
          return (
            <li key={r.over} data-testid="mc-over-row" data-over={r.over} style={{ borderTop: `1px solid ${T.line.subtle}` }}>
              <button type="button" aria-expanded={on} onClick={() => setOpen(on ? null : r.over)} className="os-state"
                aria-label={`Over ${r.over}, ${r.bowler}: ${r.figure}${r.score ? `, ${r.score} after it` : ""}`}
                style={{ width: "100%", minHeight: "44px", display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto", gap: T.space.sm,
                  alignItems: "center", padding: `${T.space.xs} ${T.space.md}`, cursor: "pointer", background: "transparent", border: "none",
                  color: T.content.primary, font: "inherit", textAlign: "left" }}>
                <span style={{ ...T.role.figure.sm, color: T.content.secondary }}>{r.over}</span>
                <span style={{ display: "grid", gap: "4px", minWidth: 0 }}>
                  <span style={{ ...T.role.body, fontSize: "14px", overflowWrap: "anywhere" }}>{r.bowler}</span>
                  <span aria-hidden="true" style={{ display: "flex", flexWrap: "wrap", gap: "4px", padding: "4px", borderRadius: T.radius.pill,
                    background: T.board.face, justifySelf: "start" }}>
                    {r.chips.map((c, i) => <Chip key={i} mark={c}/>)}
                  </span>
                </span>
                <span style={{ ...T.role.figure.sm, textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.figure}{r.score && <span style={{ display: "block", color: T.content.secondary }}>{r.score}</span>}
                </span>
              </button>
              {on && (
                <ol data-testid="mc-over-lines" style={{ listStyle: "none", margin: 0, padding: `0 ${T.space.md} ${T.space.sm} ${T.space.xxl}` }}>
                  {lines.length ? lines.map((c) => (
                    <li key={c.key} style={{ ...T.role.body, fontSize: "14px", color: T.content.primary, padding: `${T.space.xs} 0` }}>
                      {c.kind === "ball" || c.kind === "four" || c.kind === "six" || c.kind === "wicket" ? <span style={{ color: T.content.secondary }}>{c.over}.{c.ball} </span> : null}
                      {c.text}
                    </li>
                  )) : <li style={{ ...T.role.body, fontSize: "14px", color: T.content.secondary }}>No lines for this over.</li>}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
      {rows.length > 6 && (
        <div style={{ padding: T.space.md, borderTop: `1px solid ${T.line.subtle}` }}>
          <button type="button" onClick={() => setAll((x) => !x)} data-testid="mc-over-story-all" className="pressBtn os-state"
            style={{ minHeight: "44px", padding: `0 ${T.space.lg}`, cursor: "pointer", background: "transparent", border: `1px solid ${T.line.normal}`,
              borderRadius: T.radius.pill, color: T.content.primary, fontFamily: T.type.body, fontSize: "14px", fontWeight: 500 }}>
            {all ? "The last six overs" : `Every over (${rows.length})`}
          </button>
        </div>
      )}
    </Panel>
  );
}
