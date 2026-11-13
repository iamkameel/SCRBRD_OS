/**
 * CRI-2.2: no chart without a source line. Every chart drawn in the files
 * below must sit inside a <Sourced>, <SourcedLazy> or <SourcedPlain> block
 * (ui/sourced.jsx, ui/sourcedLazy.jsx), whose line says what the chart
 * stands on: the chart's source-line ancestor. The files are the ones the
 * Cricinfo map (CRI-2.2) found charts in with no line. Read as text: a chart
 * is a JSX element of one of CHARTS, and it is inside a block when more
 * blocks have opened than closed before it in the same file.
 *
 * Left out, by decision: the skills and rating charts (views/skills/,
 * ui/overallRadar.jsx, ui/primitives.jsx), which are ratings, not match data;
 * and the pad's tap-to-place field (scorer/panels.jsx WagonWheel, on the pad
 * in scorer/pad.jsx and scorer/scoring.jsx), which is an input, not a chart.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/sourced.test.mjs
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SRC_BALLS } from "../src/lib/sourceWords.js";
import { BALLS, ballsLine, shotsCaptured } from "../src/ui/sourcedLazy.jsx";
import { Sourced, SourcedPlain } from "../src/ui/sourced.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

const SRC = new URL("../src/", import.meta.url);
/** The chart components, as their callers write them. */
const CHARTS = ["Worm", "RateTrack", "WormChart", "ManhattanChart", "RunRateChart", "BatsmanChart", "BowlerChart",
  "ShotWheel", "ShotHeatMap", "ShotSpider", "WagonAnalysisPanel", "TeamWheel", "PartnershipChart"];
/** The files, and the least number of charts each draws (so a file whose charts are renamed cannot pass empty). */
const FILES = {
  "views/matchcentre/tabs.jsx": 9,
  "views/matchcentre/tabs-core.jsx": 3,
  "public/PublicMatch.jsx": 1,
  "views/matchcentre/captainTab.jsx": 1,
  "views/cockpit/CoachTab.jsx": 1,
  "views/ProfilesView.jsx": 4,
  "scorer/charts.jsx": 11,
  "scorer/engine.jsx": 1,
  "display/panels.jsx": 1,
};
const OPEN = /<(Sourced|SourcedLazy|SourcedPlain)\b/g;
const CLOSE = /<\/(Sourced|SourcedLazy|SourcedPlain)>/g;

/**
 * Every chart element in a source text, and whether a block is open around it.
 * @param {string} text
 */
function chartsIn(text) {
  // Comments say chart names too; they are not charts.
  const blank = (m) => m.replace(/[^\n]/g, " ");
  const code = text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, blank);
  const marks = [];
  for (const m of code.matchAll(OPEN)) marks.push([m.index, 1]);
  for (const m of code.matchAll(CLOSE)) marks.push([m.index, -1]);
  marks.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const m of code.matchAll(new RegExp(`<(${CHARTS.join("|")})\\b`, "g"))) {
    const depth = marks.filter(([at]) => at < m.index).reduce((d, [, s]) => d + s, 0);
    const line = code.slice(0, m.index).split("\n").length;
    out.push({ chart: m[1], line, inside: depth > 0 });
  }
  return out;
}

group("Every chart in the listed files has a source-line ancestor");
for (const [file, least] of Object.entries(FILES)) {
  const found = chartsIn(readFileSync(new URL(file, SRC), "utf8"));
  const bare = found.filter((c) => !c.inside);
  ok(`${file}: ${found.length} chart${found.length === 1 ? "" : "s"}, each inside a source-line block`, found.length >= least && bare.length === 0,
     bare.map((c) => `${c.chart} at line ${c.line}`).concat(found.length < least ? [`only ${found.length} of ${least}`] : []));
}

group("The scan itself: a bare chart is caught, and a wrapped one is not");
{
  ok("a chart with no block is bare", chartsIn("return <div><ShotWheel inn={i}/></div>;").every((c) => !c.inside));
  ok("a chart inside a block is not", chartsIn("return <Sourced line={l}><ShotWheel inn={i}/></Sourced>;").every((c) => c.inside));
  ok("a chart after a closed block is bare again", chartsIn("<Sourced line={l}><Worm/></Sourced><Worm/>").map((c) => c.inside).join() === "true,false");
  ok("a name in a comment is not a chart", chartsIn("// <ShotWheel/> is drawn below\n/* <Worm/> */").length === 0);
}

group("The block: the line under the heading, before the chart, the words the line gives");
{
  ok("the public block's source is the shared word", BALLS === SRC_BALLS);
  ok("shots captured, in words", shotsCaptured(23, 60) === "Shots captured for 23 of 60 balls." && shotsCaptured(0, 1) === "Shots captured for 0 of 1 ball.");
  const html = renderToStaticMarkup(h(Sourced, { line: ballsLine("Hilton College 1XI innings", 60, shotsCaptured(23, 60)), testid: "source-line-x" }, h("svg", { "data-chart": "x" })));
  ok("the block holds the line and then the chart", /data-sourced="true"/.test(html) && html.indexOf("source-line-x") < html.indexOf("data-chart"), html.slice(0, 200));
  ok("...the line says its source, scope, basis and note", /Scored balls/.test(html) && /Hilton College 1XI innings/.test(html) && /From 60 balls\./.test(html)
     && /Shots captured for 23 of 60 balls\./.test(html));
  const plain = renderToStaticMarkup(h(SourcedPlain, { line: ballsLine("Hilton College 1XI innings", 60), className: "dv-small" }, h("svg")));
  ok("the plain block (the ground display) says the same words in the surface's own class",
     /class="dv-small"/.test(plain) && /Source Scored balls · Scope Hilton College 1XI innings · Basis From 60 balls\./.test(plain), plain);
}

console.log(`\nSOURCED: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
