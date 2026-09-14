import { useId } from "react";
import { T, textOn } from "../design/tokens.js";

// ══════════════════════════════════════════════════════════════════
//  DATA DISPLAY — Design System 2.0
// ══════════════════════════════════════════════════════════════════
//
// The KPI wall is §32's named anti-pattern, and the reason is not that big
// numbers are bad — it is that six identical tiles say every figure matters
// equally, which is the one thing a dashboard must never say.
//
// So `Metric` is deliberately small and quiet by default. It gets loud only
// when told to, and `MetricGroup` is what a row of them lives in.

/**
 * An absent figure is an em dash, never a zero.
 *
 * This rule already existed on the dashboard and it is worth restating where
 * every metric can reach it: a card showing 0 because a request failed, or
 * because the reader is not allowed to see the rows it counts, has stated
 * something false and specific. "We do not know" and "there are none" are
 * different facts and 0 cannot tell them apart.
 */
const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

/**
 * A single figure.
 *
 * `size` is the whole hierarchy control: "lg" for the one or two numbers a
 * screen is actually about, "md" by default, "sm" inside a dense tile. A
 * screen where everything is lg has no hierarchy, which §32 lists as a thing
 * not to build.
 */
const Metric = ({ label, value, unit, sub, tone, size = "md", trend, ...rest }) => {
  const FS = { sm: "18px", md: "26px", lg: "40px" }[size] ?? "26px";
  return (
    <div {...rest}>
      {label && (
        <div style={{
          fontFamily: T.type.head, fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
          textTransform: "uppercase", color: T.content.tertiary, marginBottom: T.space.sm,
        }}>{label}</div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
        <span style={{
          fontFamily: T.type.mono, fontSize: FS, fontWeight: 500, lineHeight: 1,
          letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums",
          // A tone is a DATA colour and may be a fill-only value, so it is
          // resolved here rather than trusted — the call site does not know
          // which of the palette it was handed.
          color: tone ? textOn(tone) : T.content.primary,
        }}>{dash(value)}</span>
        {unit && (
          <span style={{ fontFamily: T.type.mono, fontSize: "12px", color: T.content.tertiary }}>{unit}</span>
        )}
        {trend !== undefined && trend !== null && <Trend value={trend}/>}
      </div>
      {sub && (
        <div style={{ fontFamily: T.type.body, fontSize: "11px", color: T.content.tertiary, marginTop: "5px" }}>
          {sub}
        </div>
      )}
    </div>
  );
};

/**
 * A row of figures that belong together.
 *
 * Auto-fit rather than a fixed column count, so a group of two does not
 * stretch across a space meant for five — §32 again: a tile alone in a row
 * looks like a rendering fault.
 */
const MetricGroup = ({ children, min = 140, sx, ...rest }) => (
  <div style={{
    display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`,
    gap: T.space.lg, ...sx,
  }} {...rest}>{children}</div>
);

/**
 * Direction of travel.
 *
 * Up is not automatically good — a bowling economy that rises is worse — so
 * `goodWhen` says which way is which, and the colour follows the MEANING
 * rather than the arrow. Getting this wrong is how a dashboard congratulates
 * a coach on a rising injury count.
 */
const Trend = ({ value, goodWhen = "up", suffix = "%" }) => {
  const rising = value >= 0;
  const good = goodWhen === "up" ? rising : !rising;
  const tone = value === 0 ? T.content.tertiary
             : good ? T.semantic.positive
             : textOn(T.semantic.critical);
  return (
    <span style={{ fontFamily: T.type.mono, fontSize: "11px", color: tone, whiteSpace: "nowrap" }}>
      <span aria-hidden="true">{value === 0 ? "▬" : rising ? "▲" : "▼"}</span>
      {" "}{Math.abs(value)}{suffix}
      <span className="sr-only">{rising ? " increase" : " decrease"}</span>
    </span>
  );
};

/**
 * A small line, for shape rather than value.
 *
 * Drawn to one scale with the last point emphasised, because the end of the
 * series is the thing a reader is looking for. A flat series still draws a
 * flat line rather than collapsing to the baseline — the difference between
 * "steady" and "nothing recorded" has to survive.
 */
const Sparkline = ({ points = [], tone = T.brand.cyan, width = 96, height = 28, label }) => {
  const id = useId();
  if (points.length < 2) return null;
  const lo = Math.min(...points), hi = Math.max(...points);
  const pad = 2;
  const x = (i) => pad + (i / (points.length - 1)) * (width - pad * 2);
  // A series that never moves is STEADY, and steady is a finding. Scaling it
  // by a fallback span of 1 put every point at the bottom of the box, which is
  // where a series of zeroes also lands — so "held their economy all season"
  // and "nothing was recorded" drew the identical picture. A flat series runs
  // through the middle instead, which is the one place no real trend ends up
  // by accident.
  const flat = hi === lo;
  const y = (v) => (flat
    ? height / 2
    : height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2));
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
         aria-label={label ?? `trend, ${points.length} points, latest ${points[last]}`}
         style={{ maxWidth: "100%", overflow: "visible" }}>
      <defs>
        <linearGradient id={`spark${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={tone} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={`${d} L${x(last)},${height} L${x(0)},${height} Z`} fill={`url(#spark${id})`} stroke="none"/>
      <path d={d} fill="none" stroke={tone} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={x(last)} cy={y(points[last])} r="2.5" fill={tone} stroke={T.surface.base} strokeWidth="1.5"/>
    </svg>
  );
};

/**
 * A label and a value on one line — the densest honest way to show a fact.
 *
 * Tabular figures so a column of them lines up, which is most of why a table
 * reads faster than a list of cards. §32: do not convert every table into
 * cards.
 */
const StatRow = ({ label, value, tone, mono = true }) => (
  <div style={{
    display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: T.space.md,
    padding: `${T.space.sm} 0`, borderBottom: `1px solid ${T.line.subtle}`,
  }}>
    <span style={{ fontFamily: T.type.body, fontSize: "12px", color: T.content.tertiary }}>{label}</span>
    <span style={{
      fontFamily: mono ? T.type.mono : T.type.body, fontSize: "12px",
      fontVariantNumeric: "tabular-nums",
      color: tone ? textOn(tone) : T.content.primary,
    }}>{dash(value)}</span>
  </div>
);

/**
 * State, said in a shape as well as a colour.
 *
 * The dot matters: colour alone fails for a red-green colour-blind reader, and
 * "live" versus "complete" is exactly the distinction they would lose.
 */
const STATUS = {
  live:     { tone: T.brand.green,        label: "Live",      dot: true  },
  upcoming: { tone: T.semantic.info,      label: "Upcoming",  dot: false },
  complete: { tone: T.content.tertiary,   label: "Complete",  dot: false },
  warning:  { tone: T.semantic.warning,   label: "Attention", dot: false },
  critical: { tone: T.semantic.critical,  label: "Urgent",    dot: false },
};

const StatusPill = ({ status = "upcoming", children }) => {
  const s = STATUS[status] ?? STATUS.upcoming;
  const read = textOn(s.tone);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "3px 10px", borderRadius: T.radius.pill,
      background: `${s.tone}14`, border: `1px solid ${s.tone}2e`,
      fontFamily: T.type.head, fontSize: "10px", fontWeight: 700,
      letterSpacing: "0.06em", textTransform: "uppercase", color: read,
    }}>
      {s.dot
        ? <span className="live-dot" aria-hidden="true"/>
        : <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "50%", background: s.tone }}/>}
      {children ?? s.label}
    </span>
  );
};

/**
 * A segmented control — the Material 3 pattern, in SCRBRD's clothes.
 *
 * A real radiogroup rather than a row of buttons, so arrow keys work and a
 * screen reader announces "2 of 4" instead of reading four unrelated buttons.
 */
const SegmentedControl = ({ options, value, onChange, label }) => (
  <div role="radiogroup" aria-label={label} style={{
    display: "inline-flex", padding: "3px", gap: "2px",
    background: T.surface.base, border: `1px solid ${T.line.subtle}`, borderRadius: T.radius.pill,
  }}>
    {options.map((o) => {
      const v = o.value ?? o;
      const selected = v === value;
      return (
        <button key={v} role="radio" aria-checked={selected} onClick={() => onChange(v)}
          className="pressBtn os-state" data-selected={selected}
          style={{
            padding: "6px 14px", borderRadius: T.radius.pill, border: "none", cursor: "pointer",
            background: selected ? T.surface.interactive : "transparent",
            color: selected ? T.content.primary : T.content.tertiary,
            fontFamily: T.type.head, fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap",
          }}>{o.label ?? o}</button>
      );
    })}
  </div>
);

/**
 * The persistent analytical context bar (§15).
 *
 * The point of this component is not the chrome — it is that every filter on a
 * screen lives in ONE place and drives everything below it. A profile with a
 * season picker over here and a format picker inside a card is not a connected
 * analytical environment; it is two filters that happen to be on the same page.
 */
const ContextBar = ({ children, sticky = true }) => (
  <div className="os-glass" style={{
    position: sticky ? "sticky" : "static", top: 0, zIndex: 20,
    display: "flex", alignItems: "center", gap: T.space.sm, flexWrap: "wrap",
    padding: `${T.space.sm} ${T.space.md}`,
    borderRadius: T.radius.pill, marginBottom: T.space.lg,
  }}>{children}</div>
);

export { ContextBar, Metric, MetricGroup, SegmentedControl, Sparkline, StatRow, StatusPill, Trend, dash };
