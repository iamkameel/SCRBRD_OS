/**
 * THE WORM (SCRBRD-133 §7.3, lifted from scorer/charts.jsx's WormChart for
 * the three surfaces that share it: the Match Centre's Summary tab, the public
 * live page and the ground display's worm panel). It reads the tokens only
 * through the palette its caller gives it, takes SERIES (lib/chartSeries.js)
 * and the par line (lib/par.js parLine()), and imports nothing of the scorer.
 *
 * What it draws, every line in words as well as in colour (§2.6):
 *   - the innings in play, solid; the other innings dim, in a chase
 *   - each wicket as a W at the score it fell at, not a red dot
 *   - the target as a solid labelled line, "Target 187"
 *   - the par as a dashed labelled line, "Par here 128 (9 innings)" or
 *     "DLS par (calculated)" — the server's figures, never computed here
 *   - an allotment the umpires cut as a vertical rule, "16 overs (revised)"
 *   - a terminated chase's par as a mark, "Par (umpires) 74"
 *
 * TEXT IS HTML, NOT SVG. The lines are drawn in a stretched SVG with strokes
 * that do not scale; every label and mark is an HTML span placed by percent,
 * so its size is the caller's CSS size and the 12px floor holds at any width
 * (smoke-a11y measures HTML text; an SVG's text would scale with its box).
 *
 * Static in G2: the segment that draws itself is G3's (§4.2).
 */

/** @param {number} v  @param {number} lo  @param {number} hi */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @typedef {{main: string, dim: string, target: string, par: string, rule: string, text: string, label: string}} WormPalette
 * @typedef {{id: string, name: string, tone: "main" | "dim", points: {ball: number, runs: number}[], wickets: {ball: number, runs: number, n: number}[]}} WormLine
 */

/**
 * @param {object} p
 * @param {WormLine[]} p.lines
 * @param {number} p.balls           the x axis: the allotment, or every ball bowled where more were
 * @param {{runs: number, label: string} | null} [p.target]
 * @param {ReturnType<typeof import("../../lib/par.js").parLine>} [p.par]
 * @param {{balls: number, label: string} | null} [p.revised]
 * @param {{balls: number, runs: number, label: string} | null} [p.umpiresPar]
 * @param {WormPalette} p.palette
 * @param {string} p.said            the chart in one sentence, for a reader
 * @param {string} [p.height]        CSS height of the plot
 * @param {string} [p.textClass]     the class its labels take (their size)
 * @param {Record<string, string | number>} [p.textStyle]
 * @param {string} [p.testid]
 */
export function Worm({ lines, balls, target = null, par = null, revised = null, umpiresPar = null, palette, said, height = "200px",
                       textClass, textStyle = {}, testid = "worm" }) {
  const xMax = Math.max(6, balls);
  const all = [
    ...lines.flatMap((l) => l.points.map((p) => p.runs)),
    target?.runs ?? 0, umpiresPar?.runs ?? 0,
    ...(par?.points ?? []).map((p) => p.runs), par?.end?.runs ?? 0,
  ];
  const yMax = Math.max(20, ...all) * 1.08;
  const X = (/** @type {number} */ b) => (clamp(b, 0, xMax) / xMax) * 1000;
  const Y = (/** @type {number} */ r) => 1000 - (Math.max(0, r) / yMax) * 1000;
  const pc = (/** @type {number} */ v) => `${(v / 10).toFixed(2)}%`;
  /** @param {{ball?: number, balls?: number, runs: number}[]} pts */
  const path = (pts) => pts.map((p) => `${X(p.ball ?? p.balls ?? 0).toFixed(1)},${Y(p.runs).toFixed(1)}`).join(" ");
  const label = { position: /** @type {const} */ ("absolute"), whiteSpace: /** @type {const} */ ("nowrap"), lineHeight: 1.1, color: palette.label,
                  pointerEvents: /** @type {const} */ ("none"), ...textStyle };
  // A label sits above its point, kept inside the plot: right-aligned past the
  // middle, so the end of a line's label never runs off the edge.
  /** @param {number} x  @param {number} y */
  const place = (x, y) => ({ top: `calc(${pc(clamp(y, 60, 1000))} - 1.3em)`,
    ...(x > 600 ? { right: pc(1000 - clamp(x, 0, 1000)) } : { left: pc(clamp(x, 0, 1000)) }) });
  const overs = Math.ceil(xMax / 6);
  const step = overs <= 10 ? 2 : overs <= 25 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(overs / step) + 1 }, (_, i) => i * step);
  const parLast = par?.points?.[par.points.length - 1] ?? null;
  return (
    <figure data-testid={testid} style={{ margin: 0, display: "grid", gap: "6px" }}>
      <div role="img" aria-label={said} style={{ position: "relative", height, marginTop: "1.4em" }} className={textClass}>
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
          <line x1="0" y1="1000" x2="1000" y2="1000" stroke={palette.rule} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
          <line x1="0" y1="0" x2="0" y2="1000" stroke={palette.rule} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
          {target && (
            <line data-testid={`${testid}-target`} x1="0" x2="1000" y1={Y(target.runs)} y2={Y(target.runs)} stroke={palette.target}
              strokeWidth="2" vectorEffect="non-scaling-stroke"/>
          )}
          {revised && (
            <line data-testid={`${testid}-revised`} x1={X(revised.balls)} x2={X(revised.balls)} y1="0" y2="1000" stroke={palette.dim}
              strokeWidth="2" vectorEffect="non-scaling-stroke"/>
          )}
          {par && (
            <polyline data-testid={`${testid}-par`} data-par-end={parLast?.runs} points={path(par.points)} fill="none" stroke={palette.par}
              strokeWidth="2" strokeDasharray="7 6" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
          )}
          {par?.ahead && (
            <polyline data-testid={`${testid}-par-ahead`} points={path(par.ahead)} fill="none" stroke={palette.par}
              strokeWidth="1.5" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" opacity="0.7"/>
          )}
          {lines.filter((l) => l.tone === "dim").concat(lines.filter((l) => l.tone !== "dim")).map((l) => (
            <polyline key={l.id} data-testid={`${testid}-line`} data-tone={l.tone} data-end-runs={l.points[l.points.length - 1]?.runs}
              points={path(l.points)} fill="none" stroke={l.tone === "dim" ? palette.dim : palette.main}
              strokeWidth={l.tone === "dim" ? 2 : 3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
          ))}
        </svg>
        {target && <span data-testid={`${testid}-target-label`} style={{ ...label, ...place(0, Y(target.runs)), color: palette.target }}>{target.label}</span>}
        {par && parLast && (
          <span data-testid={`${testid}-par-label`} style={{ ...label, ...place(X(parLast.balls), Y(parLast.runs) + 120), top: `calc(${pc(clamp(Y(parLast.runs), 0, 940))} + 0.4em)` }}>
            {par.label}
          </span>
        )}
        {par?.end && !par.ahead && (
          <span aria-hidden="true" data-testid={`${testid}-par-end`} style={{ ...label, left: `calc(${pc(X(par.end.balls))} - 0.5em)`,
            top: `calc(${pc(Y(par.end.runs))} - 0.6em)`, color: palette.par }}>◆</span>
        )}
        {revised && <span data-testid={`${testid}-revised-label`} style={{ ...label, ...place(X(revised.balls), 60) }}>{revised.label}</span>}
        {umpiresPar && (
          <span data-testid={`${testid}-umpires-par`} style={{ ...label, ...place(X(umpiresPar.balls), Y(umpiresPar.runs)), color: palette.par }}>
            ◆ {umpiresPar.label}
          </span>
        )}
        {lines.flatMap((l) => l.wickets.map((w) => (
          <span key={`${l.id}-${w.n}`} aria-hidden="true" data-testid={`${testid}-wicket`} style={{ ...label, fontWeight: 700,
            left: `calc(${pc(X(w.ball))} - 0.35em)`, top: `calc(${pc(Y(w.runs))} - 1.25em)`, color: l.tone === "dim" ? palette.dim : palette.main }}>W</span>
        )))}
        {ticks.map((o) => (
          <span key={o} aria-hidden="true" style={{ ...label, top: "calc(100% + 0.25em)", left: `calc(${pc(X(o * 6))} - 0.5ch)`, color: palette.text }}>{o}</span>
        ))}
      </div>
      <figcaption data-testid={`${testid}-legend`} className={textClass} style={{ ...textStyle, color: palette.text, marginTop: "1.2em", lineHeight: 1.35 }}>
        {[...lines.map((l) => `${l.name} (${l.tone === "dim" ? "dim" : "solid"})`),
          target ? `${target.label} (solid line)` : null,
          par ? par.legend : null,
          revised ? revised.label : null,
          umpiresPar ? umpiresPar.label : null].filter(Boolean).join(" · ")}
      </figcaption>
    </figure>
  );
}
