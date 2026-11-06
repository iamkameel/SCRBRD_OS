import { D, px, themed } from "../design/tokens.js";
import { RUBRIC_MAX, overallOf, overallSummary } from "../lib/radar.js";

/**
 * The Overall skills radar (Kameel, 6 Nov): one player's four groups —
 * Technical, Mental, Tactical, Physical — each the mean of that group's 1-20
 * ratings, with the overall beside it. One component, drawn the same on the
 * Skills Matrix's Overall tab, Squad Management's "Skills snapshot" and the
 * player's Profiles page, so the three never disagree about a boy.
 *
 * It draws only what it is handed. Each caller keeps the read it already makes
 * (useSkills, row-scoped by the server) and the read state it already says; a
 * caller that has nothing for the boy passes nothing and is told "Not assessed
 * yet", never an empty radar or a zero.
 *
 * Honest about partial assessments: the shape is drawn only when all four
 * groups carry a rating. A group nobody rated is "Not rated", not a point at
 * the centre, which would draw him as poor at it.
 *
 * Words, not colour alone: every axis is labelled on the chart, and the list
 * beside it names each group with its figure. The chart is an image whose
 * label is the same figures in words. Nothing moves, so prefers-reduced-motion
 * has nothing to honour; every word is 12px or more.
 */

/** The groups' colours, as the Skills Matrix's tabs draw them. Follows the theme. */
export const SKILL_COLORS = themed(() => ({ technical: D.sky, mental: D.violet, tactical: D.amber, physical: D.emerald }));

/** The rubric's bands, as the Skills Matrix's bars word them (packages/scoring BANDS_OF_SCALE). */
export const bandOf = (v) => (v >= 16 ? "Excellent" : v >= 11 ? "Good" : v >= 6 ? "Average" : "Poor");

const FONT = 12;
const GAP = 8;
const LABEL_ROOM = Math.ceil("Technical".length * 6.6) + GAP;   // the widest side label, with room to spare
const RINGS = [5, 10, 15, 20];                                   // the bands' tops: poor, average, good, excellent

/** The chart alone: four axes, top, right, bottom, left, in the tabs' order. */
function Chart({ o, size, words }) {
  const r = size / 2;
  const width = size + LABEL_ROOM * 2, height = size + (FONT + GAP + 4) * 2;
  const cx = width / 2, cy = height / 2;
  const dir = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const at = (i, v) => [cx + dir[i][0] * r * (v / RUBRIC_MAX), cy + dir[i][1] * r * (v / RUBRIC_MAX)];
  const pts = (v) => dir.map((_, i) => at(i, v).map((n) => n.toFixed(2)).join(",")).join(" ");
  const shape = o.axes.map((a, i) => at(i, Math.min(Math.max(a.value, 0), RUBRIC_MAX)).map((n) => n.toFixed(2)).join(",")).join(" ");
  const label = (i) => {
    const [x, y] = at(i, RUBRIC_MAX);
    const [dx, dy] = dir[i];
    return { x: x + dx * GAP, y: dy < 0 ? y - GAP : dy > 0 ? y + GAP + FONT * 0.8 : y + FONT * 0.35,
             anchor: dx > 0 ? "start" : dx < 0 ? "end" : "middle" };
  };
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Overall skills radar. ${words}`}
      data-testid="overall-radar-chart" data-max={RUBRIC_MAX}
      style={{ width: px(width), height: px(height), maxWidth: "100%", flexShrink: 0, display: "block" }}>
      {RINGS.map((v) => (
        <polygon key={v} points={pts(v)} fill="none" stroke={v === RUBRIC_MAX ? D.borderMed : D.border} strokeWidth="1"/>
      ))}
      {dir.map((_, i) => {
        const [x, y] = at(i, RUBRIC_MAX);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={D.border} strokeWidth="1"/>;
      })}
      <polygon points={shape} fill={D.textPrimary + "14"} stroke={D.textSecondary} strokeWidth="1.5" strokeLinejoin="round"/>
      {o.axes.map((a, i) => {
        const [x, y] = at(i, Math.min(Math.max(a.value, 0), RUBRIC_MAX));
        return <circle key={a.key} cx={x} cy={y} r="4.5" fill={SKILL_COLORS[a.key]} stroke={D.surf1} strokeWidth="1.5"/>;
      })}
      {o.axes.map((a, i) => {
        const l = label(i);
        return (
          <text key={a.key} x={l.x} y={l.y} textAnchor={l.anchor} fontSize={FONT} fontFamily={D.body}
            fill={D.textSecondary} fontWeight="600">{a.label}</text>
        );
      })}
    </svg>
  );
}

/**
 * @param {{ skills: Record<string, Record<string, number>> | null | undefined, size?: number, testId?: string }} props
 *   `skills` is one player's ratings by group, as useSkills() pivots them.
 */
function OverallRadar({ skills, size = 132, testId = "overall-radar" }) {
  const o = overallOf(skills);
  if (o.overall == null) {
    return (
      <div data-testid={`${testId}-none`} style={{ fontFamily: D.body, fontSize: "13px", color: D.textMuted, lineHeight: 1.5 }}>
        Not assessed yet.
      </div>
    );
  }
  const words = overallSummary(o);
  return (
    <div data-testid={testId} data-overall={o.overall}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "12px 20px" }}>
      {o.complete ? <Chart o={o} size={size} words={words}/> : (
        <div data-testid={`${testId}-partial`} style={{ flex: "1 1 180px", fontFamily: D.body, fontSize: "12px", color: D.textMuted, lineHeight: 1.5 }}>
          Rated in {o.rated} of 4 groups so far. The radar is drawn once all four are rated.
        </div>
      )}
      <div style={{ flex: "1 1 150px", minWidth: "150px", maxWidth: "240px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px", paddingBottom: "8px", marginBottom: "4px", borderBottom: `1px solid ${D.border}` }}>
          <span style={{ fontFamily: D.head, fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", color: D.textMuted }}>OVERALL</span>
          <span data-testid={`${testId}-overall`} style={{ fontFamily: D.mono, fontSize: "24px", fontWeight: 700, color: D.textPrimary, marginLeft: "auto" }}>{o.overall}</span>
          <span style={{ fontFamily: D.mono, fontSize: "12px", color: D.textMuted }}>/ {RUBRIC_MAX}</span>
        </div>
        <div style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted, marginBottom: "6px" }}>
          {bandOf(o.overall)}{o.complete ? " · the mean of the four groups" : ` · from ${o.rated} of 4 groups`}
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {o.axes.map((a) => (
            <li key={a.key} data-testid={`${testId}-${a.key}`} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0" }}>
              <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "50%", background: SKILL_COLORS[a.key], flexShrink: 0 }}/>
              <span style={{ flex: 1, fontFamily: D.body, fontSize: "12px", color: D.textSecondary }}>{a.label}</span>
              {a.value == null
                ? <span style={{ fontFamily: D.body, fontSize: "12px", color: D.textMuted }}>Not rated</span>
                : <span style={{ fontFamily: D.mono, fontSize: "13px", fontWeight: 700, color: D.textPrimary }}>{a.value}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export { OverallRadar };
