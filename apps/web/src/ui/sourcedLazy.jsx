import { Suspense, lazy } from "react";

/**
 * CRI-2.2: a chart and the line that says what it stands on, as one block —
 * the chart a child of the block that carries the line, so "no chart without
 * a source line" is held by structure (apps/web/test/sourced.test.mjs fails
 * on a chart in the listed files outside one).
 *
 * This is the block for the public page's files (tabs-core.jsx, PublicMatch.jsx):
 * their static graph has a ceiling (tools/check-bundle.mjs), so the line
 * (ui/sourceLine.jsx) is fetched as a chunk of its own the first time a
 * chart is drawn, and the chart is never kept waiting for it. Signed-in
 * screens use ui/sourced.jsx, the same block with the line in it from the
 * start. The line goes under the chart's heading, before the chart, as
 * SourceLine says it should. Nothing here names a person: a scope is a side
 * or an innings, never a boy (docs/policy/PUBLIC_DATA.md).
 */
const SourceLine = lazy(() => import("./sourceLine.jsx").then((m) => ({ default: m.SourceLine })));

/** Delivery events: lib/sourceWords.js SRC_BALLS, held equal by the test (no import: the public graph). */
export const BALLS = "Scored balls";

/**
 * The line most charts here give: scored balls, whose they are, and how many.
 * @param {string | null} scope  @param {number} balls  @param {string | null} [note]
 */
export const ballsLine = (scope, balls, note = null) => ({ source: BALLS, scope, denominator: { n: balls, unit: "ball" }, note });

/** "Shots captured for 23 of 60 balls." What a chart that draws shots says of its coverage. @param {number} n @param {number} of */
export const shotsCaptured = (n, of) => `Shots captured for ${n} of ${of} ball${of === 1 ? "" : "s"}.`;

/**
 * `after`: the line under the block rather than over it — for a chart drawn
 * inside the board (the rate track), whose top is the score.
 * @param {{line: {source?: string, scope?: string | null, denominator?: object, note?: string | null}, testid?: string, after?: boolean, children: any, style?: object}} p
 */
export function SourcedLazy({ line, testid = "source-line", after = false, children, style }) {
  const { note = null, ...rest } = line ?? {};
  const said = <Suspense fallback={null}><SourceLine testid={testid} {...rest}>{note}</SourceLine></Suspense>;
  return (
    <div data-sourced="true" style={{ display: "grid", gap: "8px", minWidth: 0, ...style }}>
      {!after && said}
      {children}
      {after && said}
    </div>
  );
}
