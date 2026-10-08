import { T } from "../design/tokens.js";
import { Card } from "../ui/primitives.jsx";
import { SourceLine } from "../ui/sourceLine.jsx";

/**
 * The season worm, as a DEMONSTRATION and nothing more (GA-I23).
 *
 * These eight scores were hard-coded in the Analytics view and drawn there as
 * if they were a side's season. The team's match-by-match worm needs a read of
 * its own (the second slice), so until then it is drawn only when nobody is
 * signed in, and says "Demo" through the one shared line. A signed-in reader
 * never sees it: AnalyticsView renders it only when signedIn() is false.
 *
 * Text and shapes only. Nothing here is a school's, and nothing is a child's.
 */
const SIDE = [142, 186, 134, 168, 194, 152, 177, 142];
const OPPOSITION = [108, 152, 135, 141, 156, 148, 162];
const STEP = 60, TOP = 220;
const y = (v) => 100 - (v / TOP) * 90;

const line = (values) => values.map((v, i) => `${i * STEP + STEP / 2},${y(v)}`).join(" ");

export function DemoWorm() {
  return (
    <Card sx={{ padding: T.space.lg, marginBottom: T.space.lg }} data-testid="demo-worm">
      <h3 style={{ margin: `0 0 ${T.space.sm}`, fontFamily: T.type.head, fontSize: "14px", fontWeight: 700, color: T.content.primary }}>
        Season scores, last 8 matches
      </h3>
      <div style={{ marginBottom: T.space.md }}>
        <SourceLine testid="source-line-worm" demo demoWhy="sample matches" scope="The side against the opposition, one point a match"/>
      </div>
      <svg viewBox={`0 0 ${SIDE.length * STEP} 100`} role="img" aria-label="A demonstration line of eight sample scores for the side and seven for the opposition"
        style={{ width: "100%", height: "100px", overflow: "visible" }}>
        <polyline points={line(SIDE)} fill="none" stroke={T.semantic.positive} strokeWidth="2" strokeLinejoin="round"/>
        <polyline points={line(OPPOSITION)} fill="none" stroke={T.semantic.critical} strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 3"/>
        {SIDE.map((v, i) => <circle key={i} cx={i * STEP + STEP / 2} cy={y(v)} r="4" fill={T.semantic.positive} stroke={T.surface.raised} strokeWidth="2"/>)}
        {OPPOSITION.map((v, i) => <circle key={i} cx={i * STEP + STEP / 2} cy={y(v)} r="3" fill={T.semantic.critical} stroke={T.surface.raised} strokeWidth="1.5"/>)}
      </svg>
      <div style={{ display: "flex", gap: T.space.lg, marginTop: T.space.sm, fontFamily: T.type.body, fontSize: `${T.floor.read}px`, color: T.content.secondary }}>
        <span style={{ display: "flex", alignItems: "center", gap: T.space.sm }}><span aria-hidden="true" style={{ width: 20, height: 2, background: T.semantic.positive }}/>The side</span>
        <span style={{ display: "flex", alignItems: "center", gap: T.space.sm }}><span aria-hidden="true" style={{ width: 20, borderTop: `2px dashed ${T.semantic.critical}` }}/>Opposition</span>
      </div>
    </Card>
  );
}
