import { createContext, useContext, useId, useState } from "react";
import { T } from "../design/tokens.js";

/**
 * "Show as table": the words-and-figures alternative to a chart (GA-I31).
 *
 * A picture of numbers is a locked box to a screen reader and a poor one to a
 * coach who wants the figure, not the height of a bar. Every chart in
 * scorer/charts.jsx carries one of these under it.
 *
 * THE RULE THAT KEEPS IT HONEST. A chart's table is built from the SAME
 * values the chart draws, by the chart, at the place it draws them — never a
 * second read, never a second fold. It lists the figures and the names the
 * chart already shows that reader, and nothing more. So a chart that is not
 * allowed to show a name does not get a table that does.
 *
 * The pattern, one for all: a 44px button (aria-expanded, aria-controls) that
 * opens a scrollable region holding one or more real tables, each with a
 * caption and column headers (`th scope="col"`) and a row header per row
 * (`th scope="row"`, the first cell). Closed, nothing is in the page, so a
 * screen reader meets the chart's own label and then the button, not the
 * figures twice.
 *
 * `ChartTablesOpen` opens every table at first render. The server-rendered
 * unit tests read the tables through it; so can a printed report.
 */
export const ChartTablesOpen = createContext(false);

/**
 * @typedef {{caption: string, columns: string[], rows: (string | number | null)[][], text?: number[], note?: string}} ChartTableSpec
 *   rows: the first cell of a row is its header; every cell is already text.
 *   text: the columns of words, set left; the rest are figures, set right.
 */

const th = { ...T.role.body, fontSize: "12px", fontWeight: 600, color: T.content.secondary, padding: "6px 10px", whiteSpace: "nowrap", borderBottom: `1px solid ${T.line.normal}` };
const td = { ...T.role.body, fontSize: "12px", color: T.content.primary, padding: "6px 10px", borderTop: `1px solid ${T.line.subtle}`, fontVariantNumeric: "tabular-nums" };

/**
 * @param {{tables: ChartTableSpec[], testid?: string}} p
 */
export function ChartTable({ tables, testid = "chart-table" }) {
  const [open, setOpen] = useState(useContext(ChartTablesOpen));
  const id = useId();
  const live = (tables || []).filter((t) => t && t.rows.length > 0);
  if (!live.length) return null;
  return (
    <div style={{ marginTop: T.space.sm, display: "grid", gap: T.space.sm, justifyItems: "start" }}>
      <button type="button" data-testid={`${testid}-toggle`} aria-expanded={open} aria-controls={`${id}-tables`}
        onClick={() => setOpen((o) => !o)} className="pressBtn os-state"
        style={{
          minHeight: "44px", padding: `0 ${T.space.md}`, display: "inline-flex", alignItems: "center",
          background: "transparent", border: `1px solid ${T.line.normal}`, borderRadius: T.radius.pill, cursor: "pointer",
          color: T.content.primary, fontFamily: T.type.body, fontSize: "13px", fontWeight: 600,
        }}>
        {open ? "Hide table" : "Show as table"}
      </button>
      {open && (
        <div id={`${id}-tables`} data-testid={testid} role="region" aria-label={`${live[0].caption} — figures`} tabIndex={0}
          style={{ width: "100%", maxHeight: "300px", overflow: "auto", display: "grid", gap: T.space.lg }}>
          {live.map((t, k) => (
            <table key={k} data-testid={`${testid}-table`} style={{ borderCollapse: "collapse", width: "100%", textAlign: "left" }}>
              <caption style={{ ...T.role.body, fontSize: "12px", fontWeight: 600, color: T.content.secondary, textAlign: "left", padding: "0 10px 6px" }}>
                {t.caption}
              </caption>
              <thead>
                <tr>{t.columns.map((c, i) => <th key={i} scope="col" style={{ ...th, textAlign: i === 0 || t.text?.includes(i) ? "left" : "right" }}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((cell, j) => j === 0
                      ? <th key={j} scope="row" style={{ ...td, fontWeight: 500, textAlign: "left" }}>{cell ?? "—"}</th>
                      : <td key={j} style={{ ...td, textAlign: t.text?.includes(j) ? "left" : "right" }}>{cell ?? "—"}</td>)}
                  </tr>
                ))}
              </tbody>
              {t.note && <tfoot><tr><td colSpan={t.columns.length} style={{ ...td, borderTop: `1px solid ${T.line.normal}`, color: T.content.secondary, textAlign: "left" }}>{t.note}</td></tr></tfoot>}
            </table>
          ))}
        </div>
      )}
    </div>
  );
}
