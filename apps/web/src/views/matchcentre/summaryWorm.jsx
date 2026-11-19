import { useMemo } from "react";
import { T } from "../../design/tokens.js";
import { wormOf } from "../../lib/chartSeries.js";
import { Worm } from "../../ui/charts/worm.jsx";
import { SourcedLazy, ballsLine } from "../../ui/sourcedLazy.jsx";
import { CardHead, Panel } from "./bits.jsx";

/**
 * The Summary's worm panel (tabs-core.jsx), a chunk of its own (CRI-2.4):
 * the chart, its series (lib/chartSeries.js) and the projection under it
 * (scorer/chartData.js) are fetched the first time a Summary draws one, so
 * the public entry's static graph does not carry them, and a public page in
 * Low data, which draws no chart, never fetches them at all. Null before a
 * completed over, as wormOf() says.
 * @param {{match: any, innings: any[], index: number, events?: any[] | null, overs: number, par?: any}} p
 */
export default function SummaryWorm({ match, innings, index, events = null, overs, par = null }) {
  const worm = useMemo(() => wormOf({ match, played: innings, index, events, overs, report: par }), [match, innings, index, events, overs, par]);
  if (!worm) return null;
  // CRI-2.2: what the worm stands on — every innings it draws, by the fold's balls.
  const wormLine = ballsLine(innings.filter(Boolean).length > 1 ? "Both innings" : "This innings", innings.reduce((n, x) => n + (x?.balls ?? 0), 0));
  return (
    <Panel testid="mc-worm-panel">
      <CardHead icon="trending-up">Worm</CardHead>
      <SourcedLazy line={wormLine} testid="source-line-worm" style={{ padding: `${T.space.sm} ${T.space.lg} ${T.space.md}` }}>
        <Worm lines={worm.lines} balls={worm.balls} target={worm.target} par={worm.par} revised={worm.revised}
          umpiresPar={worm.umpiresPar} said={worm.said} height="160px" testid="mc-worm"
          textStyle={{ fontFamily: T.type.body, fontSize: "12px" }}
          palette={{ main: T.content.primary, dim: T.content.tertiary, target: T.brand.accentText, par: T.brand.accentText,
                     rule: T.line.normal, text: T.content.secondary, label: T.content.primary }}/>
      </SourcedLazy>
    </Panel>
  );
}
