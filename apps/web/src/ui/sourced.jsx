import { SourceLine, sourceParts } from "./sourceLine.jsx";
import { BALLS, ballsLine, shotsCaptured } from "./sourcedLazy.jsx";

// The words, the same for both blocks.
export { BALLS, ballsLine, shotsCaptured };

/**
 * CRI-2.2: a chart and its source line as one block, for signed-in screens
 * (the line drawn with the chart; the public page's files use
 * sourcedLazy.jsx, which fetches it). The line goes under the chart's
 * heading, before the chart. apps/web/test/sourced.test.mjs fails on a chart
 * in the listed files that is not inside one of these blocks.
 *
 * @param {{line: {source?: string, scope?: string | null, window?: string | null, denominator?: object, note?: string | null}, testid?: string, children: any, style?: object}} p
 */
export function Sourced({ line, testid = "source-line", children, style }) {
  const { note = null, ...rest } = line ?? {};
  return (
    <div data-sourced="true" style={{ display: "grid", gap: "8px", minWidth: 0, ...style }}>
      <SourceLine testid={testid} {...rest}>{note}</SourceLine>
      {children}
    </div>
  );
}

/**
 * The same block on a surface of its own colours (the ground display): the
 * line's words as plain text in the caller's class, so they take the
 * surface's ink rather than the page's.
 * @param {{line: {source?: string, scope?: string | null, denominator?: object, note?: string | null}, className?: string, testid?: string, children: any}} p
 */
export function SourcedPlain({ line, className, testid = "source-line", children }) {
  const { note = null, ...rest } = line ?? {};
  const words = [...sourceParts(rest).map((p) => `${p.label} ${p.text}`), note].filter(Boolean).join(" · ");
  return (
    <div data-sourced="true" style={{ display: "grid", gap: "4px", minWidth: 0 }}>
      {children}
      {words && <p data-testid={testid} className={className} style={{ margin: 0 }}>{words}</p>}
    </div>
  );
}
