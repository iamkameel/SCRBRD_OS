/**
 * The skills radar and its development plan (GA-I06).
 *
 * The chart divided every value by a hard-coded 100, so a 20 out of 20 on the
 * 1-20 rubric sat a fifth of the way out; the plan printed "13 -> 23" beside a
 * scale that stops at 20. Held here:
 *
 *   - the scale is an argument with no default, and a caller without one draws nothing
 *   - 20/20 reaches the OUTER ring in Skills (per-skill axes) and in Profiles (category means)
 *   - the Squad caller, pre-normalised to 0-100, draws exactly where it always did
 *   - no target exists without a saved goal, and a saved one is believed only inside the scale
 *   - the chart's text is never under 12px
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/radar.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SCALE_MAX, TREE } from "@scrbrd/scoring";
import { RadarChart } from "../src/ui/primitives.jsx";
import {
  RUBRIC_MAX, MAX_LABELLED_AXES, radarGeometry, radarRatio, radarLabelOf, categoryMeans, categoryMeansOn100, radarSummary,
} from "../src/lib/radar.js";
import { focusAreas } from "../src/lib/focusAreas.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const dist = (g, [x, y]) => Math.hypot(x - g.cx, y - g.cy);

group("The scale is the chart's own argument");
ok("the rubric's top is the scoring package's SCALE_MAX", RUBRIC_MAX === SCALE_MAX && SCALE_MAX === 20);
ok("no max, no chart", radarGeometry({ data: { a: 1, b: 2, c: 3 } }) === null && radarGeometry({ data: { a: 1, b: 2, c: 3 }, max: 0 }) === null
  && radarGeometry({ data: { a: 1, b: 2, c: 3 }, max: NaN }) === null);
ok("fewer than three axes is not a radar", radarGeometry({ data: { a: 1, b: 2 }, max: 20 }) === null);
ok("a component with no max renders nothing at all", renderToStaticMarkup(h(RadarChart, { data: { a: 1, b: 2, c: 3 } })) === "");
ok("a ratio is held to the ring: over the top is the top, a bad value is the centre",
  radarRatio(25, 20) === 1 && radarRatio(-3, 20) === 0 && radarRatio(NaN, 20) === 0 && radarRatio(10, 20) === 0.5);

group("20 out of 20 reaches the outer ring: Skills");
// Skills passes the player's own ratings for a category, one axis per skill.
const all20 = Object.fromEntries(TREE.technical.map((k) => [k, 20]));
const gS = radarGeometry({ data: all20, max: RUBRIC_MAX, size: 110 });
const outerS = gS.rings.at(-1);
ok("every dot is on the outer ring", gS.ratios.every((q) => q === 1) && gS.dots.every((d) => near(dist(gS, d), gS.r)), gS.ratios);
ok("...and the data polygon IS the outer ring", gS.polygon === outerS);
const gHalf = radarGeometry({ data: Object.fromEntries(TREE.technical.map((k) => [k, 10])), max: RUBRIC_MAX, size: 110 });
ok("a 10 out of 20 is half way", gHalf.dots.every((d) => near(dist(gHalf, d), gHalf.r / 2)));
const was = radarGeometry({ data: all20, max: 100, size: 110 });
ok("on the old 0-100 reading the same 20s sat a fifth of the way out (the defect)", was.dots.every((d) => near(dist(was, d), was.r * 0.2)));

group("20 out of 20 reaches the outer ring: Profiles");
// Profiles passes one axis per category, the mean of its ratings.
const full = { technical: { a: 20, b: 20 }, mental: { a: 20 }, tactical: { a: 20, b: 20, c: 20 }, physical: { a: 20 } };
const means = categoryMeans(full);
ok("the means are still on 1-20", JSON.stringify(means) === JSON.stringify({ Technical: 20, Mental: 20, Tactical: 20, Physical: 20 }), means);
const gP = radarGeometry({ data: means, max: RUBRIC_MAX, size: 130 });
ok("every category dot is on the outer ring", gP.dots.every((d) => near(dist(gP, d), gP.r)) && gP.polygon === gP.rings.at(-1));
ok("an empty category draws no axis (it crashed the profile once)", Object.keys(categoryMeans({ technical: { a: 14 }, mental: {}, physical: { a: 10, b: 12 }, tactical: { a: 9 } })).join() === "Technical,Physical,Tactical");
ok("a mean keeps a decimal: 14 and 15 is 14.5, not 15 and not 14", categoryMeans({ technical: { a: 14, b: 15 } }).Technical === 14.5);

group("The Squad caller is unchanged");
// Squad has always put the mean on 0-100 itself (five to the rating, rounded)
// and handed that over. It now says so with max={100}; where it draws is not
// allowed to move.
const legacy = (byCat) => Object.fromEntries(Object.entries(byCat)
  .filter(([, vals]) => vals && Object.keys(vals).length)
  .map(([cat, vals]) => [cat.charAt(0).toUpperCase() + cat.slice(1), Math.round(5 * Object.values(vals).reduce((a, b) => a + b, 0) / Object.values(vals).length)]));
const SAMPLE = { technical: { a: 17, b: 14, c: 15 }, mental: { a: 16, b: 15 }, tactical: { a: 13, b: 14 }, physical: { a: 20, b: 18, c: 19 } };
ok("the data is the old calculation, to the value", JSON.stringify(categoryMeansOn100(SAMPLE)) === JSON.stringify(legacy(SAMPLE)), categoryMeansOn100(SAMPLE));
// The old component: r * (v / 100), r = size * 0.38. The ratio is what must hold.
const gq = radarGeometry({ data: categoryMeansOn100(SAMPLE), max: 100, size: 120 });
ok("each dot's ratio is its 0-100 value over 100, as before", gq.ratios.every((q, i) => near(q, Object.values(categoryMeansOn100(SAMPLE))[i] / 100)), gq.ratios);
const gFull = radarGeometry({ data: categoryMeansOn100(full), max: 100, size: 120 });
ok("a full 20/20 on Squad is 100, the outer ring", Object.values(categoryMeansOn100(full)).every((v) => v === 100)
  && gFull.dots.every((d) => near(dist(gFull, d), 60)));
ok("and its words for a screen reader are on the 1-20 scale, not on 100", /Technical 15\.3 of 20/.test(radarSummary(categoryMeans(SAMPLE), RUBRIC_MAX)), radarSummary(categoryMeans(SAMPLE), RUBRIC_MAX));

group("Every caller says what the outer ring is");
const src = (f) => readFileSync(new URL(`../src/views/${f}`, import.meta.url), "utf8");
for (const [file, want] of [["SkillsView.jsx", "max={RUBRIC_MAX}"], ["ProfilesView.jsx", "max={RUBRIC_MAX}"], ["SquadView.jsx", "max={100}"]]) {
  const calls = [...src(file).matchAll(/<RadarChart\b[^>]*?(?:\/>|>)/gs)].map((m) => m[0]);
  ok(`${file}: ${calls.length} call(s), each with ${want}`, calls.length >= 1 && calls.every((c) => c.includes(want)), calls);
}

group("What is drawn");
const html = renderToStaticMarkup(h(RadarChart, { data: all20, max: RUBRIC_MAX, size: 110, color: "#38bdf8" }));
ok("an image with words for a screen reader", /role="img"/.test(html) && /aria-label="Skills radar\. Footwork 20 of 20/.test(html), html.slice(0, 240));
ok("the outer ring's meaning is on the element", /data-max="20"/.test(html));
const sizes = [...html.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
const lab = renderToStaticMarkup(h(RadarChart, { data: { technical: 14, mental: 17, tactical: 12, physical: 16 }, max: 20, size: 110 }));
const labSizes = [...lab.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
ok("four axes are labelled, at 12px and no smaller", labSizes.length === 4 && labSizes.every((s) => s >= 12), labSizes);
ok("fifteen axes would collide, so none are labelled (the bars beside it carry the names)", sizes.length === 0 && TREE.technical.length > MAX_LABELLED_AXES, sizes);
ok("no label is clipped: every label's anchor point is inside the picture", (() => {
  const g = radarGeometry({ data: { technical: 14, mental: 17, tactical: 12, physical: 16 }, max: 20, size: 110 });
  return g.labels.every((l) => l.x >= 0 && l.x <= g.width && l.y >= 0 && l.y <= g.height);
})());
ok("camel-case keys read as words", radarLabelOf("lineAndLength") === "Line and length" && radarLabelOf("Technical") === "Technical" && radarLabelOf("againstPace") === "Against pace");

group("No target without a saved goal");
const mental = { concentration: 17, composure: 9, decisions: 12, anticipation: 14, bravery: 6 };
const plan = focusAreas(mental);
ok("the three lowest, lowest first, as they stand", plan.map((p) => `${p.skill}:${p.value}`).join() === "bravery:6,composure:9,decisions:12", plan);
ok("none has a target", plan.every((p) => p.target === null));
ok("not rating + 10 (the old 13 -> 23)", focusAreas({ a: 13, b: 14 }).every((p) => p.target === null));
ok("a saved goal is shown for its skill alone", (() => {
  const p = focusAreas(mental, { bravery: 12 });
  return p[0].target === 12 && p[1].target === null && p[2].target === null;
})());
ok("a saved goal above the scale's top is not believed", focusAreas({ a: 13 }, { a: 23 })[0].target === null);
ok("...nor one at or below the rating, nor a fraction, nor text", focusAreas({ a: 13 }, { a: 13 })[0].target === null
  && focusAreas({ a: 13 }, { a: 11 })[0].target === null && focusAreas({ a: 13 }, { a: 14.5 })[0].target === null && focusAreas({ a: 13 }, { a: "18" })[0].target === null);
ok("a goal of exactly 20 is the top and stands", focusAreas({ a: 13 }, { a: 20 })[0].target === 20);
ok("no ratings, no plan", focusAreas({}).length === 0 && focusAreas(null).length === 0);
ok("labels read as words", focusAreas({ lineAndLength: 5 })[0].label === "Line and length");
const sk = src("SkillsView.jsx");
ok("SkillsView draws a target only from focusAreas, and passes it no saved goals", /focusAreas\(skills\[category\]\)/.test(sk) && !/Math\.min\(v\s*\+\s*10/.test(sk) && !/v\+10/.test(sk));

console.log(`\n${fail ? "✗" : "✓"} radar: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
