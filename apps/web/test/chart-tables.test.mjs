/**
 * GA-I31. Every chart has a table.
 *
 * A picture of numbers is closed to a screen reader and slow for a coach who
 * wants the figure. Each chart in scorer/charts.jsx carries a "Show as table"
 * button (ui/ChartTable.jsx) that opens the figures the chart draws, and the
 * names it draws, and nothing more.
 *
 * Every chart here is rendered from a real fold (the event builders and
 * deriveInnings), once closed and once with the tables opened
 * (ChartTablesOpen), and the table is read back and held to what the SAME
 * markup draws: the bars' heights through their own axis, the spokes' tooltips,
 * the cells' densities, the spider's data attributes, and the fold itself.
 * So a table that drifts from its chart, or invents a figure, goes red.
 *
 * A: the component (closed, open, aria, 44px, 12px, empty, a missing cell).
 * B: the worm.   C: runs per over.   D: the run rate.   E: batsmen, bowlers.
 * F: the wagon wheel.   G: the heat map (and the left-hander's mirror).
 * H: the spider.   I: closed by default, a name nowhere it is not drawn.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/chart-tables.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deriveInnings, deriveInningsList, inningsStart, batters, bowler, ball, isLegal, BALL_TYPE, DISMISSAL,
} from "@scrbrd/scoring";
import {
  AnalysisDashboard, BatsmanChart, BowlerChart, ManhattanChart, RunRateChart, ShotHeatMap, ShotSpider, ShotWheel, WormChart,
} from "../src/scorer/charts.jsx";
import { ChartTable, ChartTablesOpen } from "../src/ui/ChartTable.jsx";
import { projectInnings, runRates } from "../src/scorer/chartData.js";
import { placeWords } from "../src/scorer/field.js";

let pass = 0, fail = 0;
const ok = (name, c, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${name}${c || d === "" ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`);
  if (c) pass++; else fail++;
};

const warned = [];
console.error = (...a) => { warned.push(a.map(String).join(" ")); };

// ── Reading markup ──────────────────────────────────────────────────────
const unesc = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (C, props, open = false) => renderToStaticMarkup(open ? h(ChartTablesOpen.Provider, { value: true }, h(C, props)) : h(C, props));
const opened = (C, props) => render(C, props, true);

/** Every <table> in the markup: caption, column heads, rows (header cell first). */
function tablesOf(markup) {
  return [...markup.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((m) => {
    const t = m[1];
    const caption = unesc((/<caption[^>]*>([\s\S]*?)<\/caption>/.exec(t) || [])[1] ?? "");
    const head = [...(/<thead>([\s\S]*?)<\/thead>/.exec(t) || ["", ""])[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((c) => unesc(c[1]));
    const body = (/<tbody>([\s\S]*?)<\/tbody>/.exec(t) || ["", ""])[1];
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => unesc(c[1])));
    return { caption, head, rows, raw: t };
  });
}
const countOf = (markup, re) => (markup.match(re) || []).length;

// ── Builders (as charts.test.mjs) ───────────────────────────────────────
const SQUAD = Array.from({ length: 11 }, (_, i) => ({ id: `p${i + 1}`, name: `Batter ${i + 1}` }));
const OPP = [{ id: "x", name: "X Bowler" }, { id: "y", name: "Y Bowler" }];
let ts = 1_790_000_000_000, ids = 0;
const at = () => ({ clientTs: ts++ });
const id = () => ({ id: `e${++ids}` });
const open = (i, { overs = 4, target = null, teamKey = i % 2 ? "B" : "A" } = {}) => {
  const other = teamKey === "A" ? "B" : "A";
  return [
    inningsStart({ innings: i, ...at(), battingTeam: teamKey, bowlingTeam: other, teamKey, bowlingTeamKey: other,
      squad: SQUAD, bowlingSquad: OPP, overs, ...(target != null ? { target } : {}) }),
    batters({ innings: i, ...at(), striker: "p1", nonStriker: "p2" }),
    bowler({ innings: i, ...at(), bowler: "x" }),
  ];
};
const b = (i, type, value = 0, more = {}) => ball({ innings: i, ...at(), ...id(), type, value, ...more });
const dot = (i) => b(i, BALL_TYPE.RUN, 0);
const run = (i, v) => b(i, BALL_TYPE.RUN, v);
const next = (i, who) => bowler({ innings: i, ...at(), bowler: who });
const wicket = (i, newBat) => [b(i, BALL_TYPE.WICKET, 0, { dismissal: DISMISSAL.BOWLED }), batters({ innings: i, ...at(), striker: newBat })];

// ═══ A. The component ═══════════════════════════════════════════════════
console.log("A. The component");
{
  const spec = [{ caption: "Cap", columns: ["Over", "Runs", "Note"], text: [2], rows: [["1", 4, "ok"], ["2", null, null]], note: "* foot" }];
  const closed = renderToStaticMarkup(h(ChartTable, { tables: spec, testid: "t" }));
  ok("closed: a button and nothing else (no table in the page)", /<button/.test(closed) && !/<table/.test(closed));
  ok("...it says Show as table, aria-expanded false, and controls the region", /aria-expanded="false"/.test(closed) && />Show as table</.test(closed) && /aria-controls="[^"]+-tables"/.test(closed));
  ok("...it is at least 44px high", /min-height:44px/.test(closed));
  const o = renderToStaticMarkup(h(ChartTablesOpen.Provider, { value: true }, h(ChartTable, { tables: spec, testid: "t" })));
  ok("open: aria-expanded true and the button says Hide table", /aria-expanded="true"/.test(o) && />Hide table</.test(o));
  const ctl = /aria-controls="([^"]+)"/.exec(o)?.[1];
  ok("...aria-controls names the region that is there", !!ctl && o.includes(`id="${ctl}"`));
  ok("...the region is focusable (it scrolls) and named", /role="region"[^>]*aria-label="Cap — figures"[^>]*tabindex="0"/.test(o));
  ok("...a caption, th scope=col for every column, th scope=row for each row's first cell",
     /<caption[^>]*>Cap<\/caption>/.test(o) && countOf(o, /<th scope="col"/g) === 3 && countOf(o, /<th scope="row"/g) === 2);
  const t = tablesOf(o)[0];
  ok("...the rows are the rows given; a missing cell is a dash, not blank", JSON.stringify(t.rows) === JSON.stringify([["1", "4", "ok"], ["2", "—", "—"]]), t.rows);
  ok("...the foot note is there", /<tfoot>[\s\S]*\* foot/.test(o));
  ok("...words are set left, figures right", /<td[^>]*text-align:left[^>]*>ok/.test(o) && /<td[^>]*text-align:right[^>]*>4</.test(o));
  const sizes = [...o.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  ok(`...nothing under 12px (${[...new Set(sizes)].join(", ")})`, sizes.length > 0 && sizes.every((s) => s >= 12));
  ok("no rows, no button: nothing to show", renderToStaticMarkup(h(ChartTable, { tables: [{ caption: "x", columns: ["a"], rows: [] }] })) === "");
  ok("no tables at all, nothing", renderToStaticMarkup(h(ChartTable, { tables: [] })) === "");
}

// ═══ B. The worm ════════════════════════════════════════════════════════
console.log("\nB. The worm");
{
  // 4 overs a side. Innings 0: 2 wickets (over 1 and 3); innings 1 is chasing and ends part-way through over 3.
  const e0 = [...open(0, { overs: 4 }),
    run(0, 1), run(0, 4), dot(0), b(0, BALL_TYPE.WIDE, 0), run(0, 2), dot(0), run(0, 6),
    next(0, "y"), ...wicket(0, "p3"), run(0, 1), run(0, 1), run(0, 1), run(0, 1), run(0, 4),
    next(0, "x"), run(0, 2), dot(0), ...wicket(0, "p4"), run(0, 1), run(0, 6), dot(0), run(0, 2)];
  const e1 = [...open(1, { overs: 4, target: 40 }),
    run(1, 4), run(1, 1), dot(1), dot(1), run(1, 2), dot(1),
    next(1, "y"), run(1, 6), run(1, 1), dot(1), ...wicket(1, "p3"), run(1, 1)];
  const [i0, i1] = deriveInningsList([e0, e1]);
  const markup = opened(WormChart, { innings: [i0, i1], curIn: 1, match: { overs: 4 }, events: [e0, e1] });
  const tabs = tablesOf(markup);
  ok("two innings tables and the fall of wickets", tabs.length === 3 && /Fall of wickets/.test(tabs[2].caption), tabs.map((t) => t.caption));
  ok("the svg is an image with a label that says what it shows", /<svg[^>]*role="img"[^>]*aria-label="Worm, runs and wickets against overs bowled\. A \d+\/2 after/.test(markup));
  const foldedAtOver = (events, k) => {
    // The fold of the log up to the end of legal over k (or the whole log).
    const cut = [];
    let legal = 0;
    for (const ev of events) {
      if (ev.kind === "ball" && legal >= k * 6 && isLegal(ev.type)) break;
      if (ev.kind === "ball" && isLegal(ev.type)) legal++;
      cut.push(ev);
    }
    return deriveInnings(cut);
  };
  for (const [n, inn, events] of [[0, i0, e0], [1, i1, e1]]) {
    const t = tabs[n];
    const overs = Math.ceil(inn.balls / 6);
    ok(`innings ${n}: one row per over bowled (${t.rows.length}; ${inn.balls} balls)`, t.rows.length === overs);
    const bad = t.rows.filter((r, k) => {
      const f = foldedAtOver(events, k + 1);
      return Number(r[1]) !== f.runs || Number(r[2]) !== f.wickets;
    });
    ok(`...each row's runs and wickets are the fold's at that over's end`, bad.length === 0, bad);
    const last = t.rows[t.rows.length - 1];
    ok(`...the last row is the innings total (${last.join(" ")}; fold ${inn.runs}/${inn.wickets})`, Number(last[1]) === inn.runs && Number(last[2]) === inn.wickets);
    ok(`...a part over is named by the balls bowled (${last[0]})`, inn.balls % 6 === 0 || last[0] === `${Math.floor(inn.balls / 6)}.${inn.balls % 6}`);
  }
  const fow = tabs[2].rows;
  const want = [...i0.fow.map((f, k) => [`A ${k + 1}`, f]), ...i1.fow.map((f, k) => [`B ${k + 1}`, f])];
  ok(`the fall of wickets lists every marker the chart draws (${fow.length} / ${want.length})`, fow.length === want.length && countOf(markup, /r="4.5"/g) === want.length);
  ok("...each with the score, the overs and the batter the chart's own tooltip names",
     want.every(([lab, f], k) => fow[k][0] === lab && Number(fow[k][1]) === f.runs && fow[k][2] === f.overs && fow[k][3] === f.batsman),
     { fow, want: want.map(([l, f]) => [l, f.runs, f.overs, f.batsman]) });
  ok("...and the markers' tooltips carry the same names", want.every(([, f]) => markup.includes(`(${f.batsman}`)));
}

// ═══ C. Runs per over ═══════════════════════════════════════════════════
console.log("\nC. Runs per over");
{
  const e = [...open(0, { overs: 4 }),
    run(0, 1), run(0, 4), b(0, BALL_TYPE.WIDE, 0), dot(0), run(0, 2), dot(0), run(0, 6),
    next(0, "y"), ...wicket(0, "p3"), run(0, 1), run(0, 1), run(0, 1), run(0, 1), run(0, 4),
    next(0, "x"), run(0, 2), dot(0), ...wicket(0, "p4"), b(0, BALL_TYPE.WICKET, 0, { dismissal: DISMISSAL.BOWLED })];
  const [inn] = deriveInningsList([e]);
  const props = { inn, match: { overs: 4 }, events: e };
  const m = opened(ManhattanChart, props);
  const t = tablesOf(m)[0];
  const p = projectInnings(inn, { events: e, overs: 4 });
  ok("one row per over the chart draws", t.rows.length === p.overs.length && countOf(m, /data-over="/g) === t.rows.length);
  const bars = [...m.matchAll(/data-over="(\d+)" data-runs="(\d+)"/g)].map((x) => [x[1], x[2]]);
  ok("each row's runs are the bar's own (data-runs)", t.rows.every((r, k) => r[0].split(" ")[0] === bars[k][0] && r[1] === bars[k][1]), { rows: t.rows, bars });
  ok("...and its wickets the W marks the chart prints over it",
     t.rows.every((r, k) => Number(r[2]) === p.overs[k].wickets) && t.rows.reduce((s, r) => s + Number(r[2]), 0) === inn.wickets);
  ok("...the runs add up to the fold's total", t.rows.reduce((s, r) => s + Number(r[1]), 0) === inn.runs);
  ok("the svg is an image and says its total and its best over", /role="img" aria-label="Runs per over: \d+ overs?, the most \d+ in over \d+, \d+ runs in all\."/.test(m));
  const live = tablesOf(opened(ManhattanChart, { inn: { ...inn, complete: false }, match: { overs: 4 }, events: e }))[0];
  ok("the over in progress is marked so in the table, as the lighter bar marks it", live.rows.some((r) => /\(so far\)/.test(r[0])) === (inn.balls % 6 !== 0), live.rows);
  ok("an innings with no overs has no chart and no table", !/<table|<button/.test(opened(ManhattanChart, { inn: deriveInnings(open(0)), match: { overs: 4 } })));
}

// ═══ D. The run rate ════════════════════════════════════════════════════
console.log("\nD. The run rate");
{
  const e0 = [...open(0, { overs: 4 }), run(0, 1), run(0, 4), dot(0), run(0, 2), dot(0), run(0, 6), next(0, "y"), run(0, 1), run(0, 1), run(0, 1), run(0, 1), run(0, 4), dot(0)];
  const e1 = [...open(1, { overs: 4, target: 30 }), run(1, 4), run(1, 1), dot(1), dot(1), run(1, 2), dot(1), next(1, "y"), run(1, 6), run(1, 1), dot(1), dot(1), dot(1), run(1, 2)];
  const [, inn] = deriveInningsList([e0, e1]);
  const p = projectInnings(inn, { events: e1, overs: 4 });
  const { pts } = runRates(p, 30, inn);
  const m = opened(RunRateChart, { inn, match: { overs: 4 }, target: 30, events: e1 });
  const t = tablesOf(m)[0];
  ok(`a row for every over the line is drawn through (${t.rows.length} / ${pts.length})`, t.rows.length === pts.length && pts.length >= 2);
  ok("...with the run rate to two places", t.rows.every((r, k) => r[1] === pts[k].rr.toFixed(2)), t.rows);
  const req = pts.filter((q) => q.reqRr != null);
  ok(`...and a required rate column exactly when the dashed line is drawn (${req.length} points)`, (t.head.length === 3) === (req.length > 1) && /stroke-dasharray="4 3"/.test(m) === (req.length > 1));
  ok("...its figures the chart's", t.head.length < 3 || t.rows.every((r, k) => (pts[k].reqRr == null ? r[2] === "—" : r[2] === pts[k].reqRr.toFixed(2))), t.rows);
  ok("the over is named in overs and balls", t.rows.every((r, k) => r[0] === `${Math.floor(Math.round(pts[k].over * 6) / 6)}.${Math.round(pts[k].over * 6) % 6}`));
  ok("the svg is an image that says where the rate starts and ends", /role="img" aria-label="Run rate after each over, from \d+\.\d\d to \d+\.\d\d/.test(m));
  const first = renderToStaticMarkup(h(RunRateChart, { inn: deriveInnings(e0.slice(0, 5)), match: { overs: 4 }, target: null }));
  ok("a chart with fewer than two overs draws no svg and gives no table", !/<svg|<table|Show as table/.test(first));
}

// ═══ E. Batsmen and bowlers ═════════════════════════════════════════════
console.log("\nE. Batsmen and bowlers");
{
  const e = [...open(0, { overs: 4 }),
    run(0, 4), run(0, 1), run(0, 6), dot(0), run(0, 2), dot(0),
    next(0, "y"), run(0, 1), run(0, 3), ...wicket(0, "p3"), run(0, 4), dot(0), run(0, 1)];
  const inn = deriveInnings(e);
  const m = opened(BatsmanChart, { inn });
  const t = tablesOf(m)[0];
  const want = inn.batsmen.filter((x) => x.balls > 0).sort((p, q) => q.runs - p.runs).slice(0, 6);
  ok(`batsmen: the rows are the chart's bars, in its order (${t.rows.length})`, t.rows.length === want.length && want.length >= 3);
  ok("...name (a star for the one batting), runs, balls and the strike rate the chart prints",
     want.every((x, k) => t.rows[k][0] === x.name + (x.status === "batting" ? "*" : "") && Number(t.rows[k][1]) === x.runs && Number(t.rows[k][2]) === x.balls
       && t.rows[k][3] === (x.runs / x.balls * 100).toFixed(0)), t.rows);
  ok("...every name in the table is a name the chart draws", t.rows.every((r) => m.includes(`>${r[0].replace("*", "")}`)));
  const bm = opened(BowlerChart, { inn });
  const bt = tablesOf(bm)[0];
  const bw = inn.bowlers.filter((x) => x.balls > 0).sort((p, q) => q.wickets - p.wickets || p.runs - q.runs).slice(0, 6);
  ok(`bowlers: the rows are the chart's, in its order (${bt.rows.length})`, bt.rows.length === bw.length && bw.length === 2);
  ok("...overs, wickets, runs and economy the chart prints",
     bw.every((x, k) => bt.rows[k][0].startsWith(x.name) && bt.rows[k][1] === `${Math.floor(x.balls / 6)}.${x.balls % 6}` && Number(bt.rows[k][2]) === x.wickets
       && Number(bt.rows[k][3]) === x.runs && bt.rows[k][4] === (x.runs / (x.balls / 6)).toFixed(2)), bt.rows);
  ok("...and the bowler bowling now has the star the chart gives him", bt.rows.filter((r) => r[0].endsWith("*")).length === (inn.bowler ? 1 : 0));
  ok("each chart prints its figures as text already: the figures in the table are in its markup too",
     bw.every((x) => bm.includes(`${x.wickets}W-${x.runs}R`)) && want.every((x) => m.includes(`(${x.balls}b`)));
  ok("nobody has faced a ball: no chart, no table", renderToStaticMarkup(h(BatsmanChart, { inn: deriveInnings(open(0)) })) === "");
}

// ═══ Placements for F–H ═════════════════════════════════════════════════
const PSQUAD = [{ id: "righty", name: "R Hand", batHand: "R" }, { id: "lefty", name: "L Hand", batHand: "L" }];
const pbl = (theta, radius, value, who = "righty", more = {}) =>
  ({ kind: "ball", type: "run", value, theta, radius, placementSource: "point", strikerId: who, ...more });
const placed = (balls, squad = PSQUAD) => deriveInnings([
  { kind: "innings_start", overs: 20, squad, bowlingSquad: [] },
  { kind: "batters", striker: squad[0].id, nonStriker: squad[1]?.id ?? "z" },
  { kind: "bowler", bowler: "b1" },
  ...balls.map((x, k) => ({ ...x, seq: k + 1 })),
]);

// ═══ F. The wagon wheel ═════════════════════════════════════════════════
console.log("\nF. The wagon wheel");
{
  const inn = placed([pbl(235, 0.7, 4), pbl(90, 0.5, 1), { kind: "ball", type: "run", value: 2, seg: 3, strikerId: "righty" },
    { kind: "ball", type: "run", value: 0, strikerId: "righty" }, pbl(200, 1, 6), pbl(30, 0.2, 0)]);
  ok("the fold: six balls, five drawable", inn.ballLog.length === 6 && inn.ballLog.filter((x) => x.theta != null || x.seg != null).length === 5, inn.ballLog.length);
  const m = opened(ShotWheel, { inn });
  const t = tablesOf(m)[0];
  const tips = [...m.matchAll(/<g data-spoke="[^"]*" data-colour="[^"]*"><title>([^<]*)<\/title>/g)].map((x) => unesc(x[1]));
  ok(`one row for every spoke drawn (${t.rows.length} / ${tips.length})`, t.rows.length === tips.length && tips.length === 5);
  const said = t.rows.map((r) => `${r[1]}${r[2] && r[2] !== "—" ? ` — ${r[2]}` : ""}${r[0] !== "—" ? ` (${r[0]})` : ""}`);
  ok("...saying what that spoke's own tooltip says: the result, the fielding position, the over", JSON.stringify(said) === JSON.stringify(tips), { said, tips });
  ok("...the dashed (sector-only) spokes are marked Direction only, the measured Exact",
     JSON.stringify(t.rows.map((r) => r[3])) === JSON.stringify(inn.ballLog.filter((x) => x.theta != null || x.seg != null).map((x) => (x.placementSource === "point" ? "Exact" : "Direction only"))), t.rows);
  ok("...and the count of dashed spokes matches the svg", countOf(m, /stroke-dasharray="2 2"/g) === 2 * t.rows.filter((r) => r[3] === "Direction only").length);
  const one = opened(ShotWheel, { inn, playerId: "nobody", title: "Where he scores" });
  ok("a batter with no balls has no spokes and no table", !/<table/.test(one));
  ok("the table is named for the chart's title", /Where he scores/.test(tablesOf(opened(ShotWheel, { inn, playerId: "righty", title: "Where he scores" }))[0].caption));
  ok("the wheel's table holds no name", !/R Hand|L Hand|righty|lefty/.test(t.raw));
}

// ═══ G. The heat map ════════════════════════════════════════════════════
console.log("\nG. The heat map");
{
  const cluster = Array.from({ length: 8 }, () => pbl(235, 0.7, 4));
  const inn = placed([...cluster, pbl(100, 0.4, 1), pbl(100, 0.45, 1), pbl(310, 0.9, 2)]);
  const m = opened(ShotHeatMap, { inn, playerId: "righty" });
  const t = tablesOf(m)[0];
  const cells = [...m.matchAll(/class="heat-cell"[\s\S]*?<title>(\d+)% of the peak<\/title>/g)].map((x) => Number(x[1]));
  ok(`one row for every cell drawn (${t.rows.length} / ${cells.length})`, t.rows.length === cells.length && cells.length > 5);
  ok("...their densities are the cells' own, hottest first", JSON.stringify(t.rows.map((r) => Number(r[2]))) === JSON.stringify([...cells].sort((p, q) => q - p)), { rows: t.rows.slice(0, 5), cells: cells.slice(0, 5) });
  ok("...the hottest is the whole peak", Number(t.rows[0][2]) === 100);
  ok("...and sits where the cluster is: through the covers, a right-hander's off side", /cover/i.test(t.rows[0][0]), t.rows[0]);
  const lm = opened(ShotHeatMap, { inn: placed([...cluster.map((x) => ({ ...x, strikerId: "lefty" }))], [PSQUAD[1], PSQUAD[0]]), playerId: "lefty" });
  const lt = tablesOf(lm)[0];
  ok(`a left-hander's cluster is named in HIS terms, not the screen's (${lt.rows[0][0]} / ${t.rows[0][0]})`, lt.rows[0][0] === t.rows[0][0]);
  const want = placeWords({ theta: 235, radius: 0.7 });
  ok(`...the position the engine names that ball (${want})`, lt.rows[0][0] === want || lt.rows[0][0].startsWith(want?.split(" ")[0] ?? "?"), lt.rows[0]);
  ok("no placed shots: no table", !/<table|Show as table/.test(opened(ShotHeatMap, { inn: placed([{ kind: "ball", type: "run", value: 1, seg: 4, strikerId: "righty" }]) })));
  ok("the heat map's table holds no name", !/R Hand|L Hand|righty|lefty/.test(t.raw));
}

// ═══ H. The spider ══════════════════════════════════════════════════════
console.log("\nH. The spider");
{
  const inn = placed([pbl(235, 0.7, 4), pbl(240, 0.9, 1), pbl(90, 0.5, 2), pbl(95, 0.4, 0), pbl(95, 0.3, 1), pbl(330, 0.6, 6)]);
  const m = opened(ShotSpider, { inn });
  const t = tablesOf(m)[0];
  const axes = [...m.matchAll(/data-testid="spider-axis-([a-z_]+)" data-shots="(\d+)" data-reach="([\d.]*)"/g)].map((x) => ({ key: x[1], shots: Number(x[2]), reach: x[3] === "" ? null : Number(x[3]) }));
  ok(`one row for every axis (${t.rows.length} / ${axes.length})`, t.rows.length === axes.length && axes.length >= 6);
  ok("...with the shots the label prints", t.rows.every((r, k) => Number(r[1]) === axes[k].shots) && t.rows.reduce((s, r) => s + Number(r[1]), 0) === 6);
  ok("...and the reach the axis was drawn to, as a share of the rope; a dash for an empty direction",
     t.rows.every((r, k) => (axes[k].reach == null ? r[2] === "—" : Number(r[2]) === Math.round(axes[k].reach * 100))), { rows: t.rows, axes });
  ok("...runs where there were shots", t.rows.every((r, k) => (axes[k].shots ? r[3] !== "—" : r[3] === "—")) && t.rows.reduce((s, r) => s + (r[3] === "—" ? 0 : Number(r[3])), 0) === 14);
  ok("the spider's table holds no name", !/R Hand|L Hand|righty|lefty/.test(t.raw));
}

// ═══ I. Closed by default, and the dashboard ════════════════════════════
console.log("\nI. Closed by default");
{
  const e = [...open(0, { overs: 4 }), run(0, 4), run(0, 1), dot(0), run(0, 2), dot(0), run(0, 6), next(0, "y"), run(0, 1), run(0, 1), ...wicket(0, "p3"), run(0, 4)];
  const [inn] = deriveInningsList([e]);
  const placedInn = placed([pbl(235, 0.7, 4), pbl(90, 0.5, 1)]);
  const closed = [
    render(WormChart, { innings: [inn], match: { overs: 4 }, events: [e] }), render(ManhattanChart, { inn, match: { overs: 4 }, events: e }),
    render(BatsmanChart, { inn }), render(BowlerChart, { inn }),
    render(ShotWheel, { inn: placedInn }), render(ShotHeatMap, { inn: placedInn }), render(ShotSpider, { inn: placedInn }),
  ];
  ok("closed, no chart has a table in the page", closed.every((x) => !/<table/.test(x)));
  ok("...each has the one button, shut", closed.every((x) => countOf(x, /Show as table/g) === 1 && /aria-expanded="false"/.test(x)));
  const names = ["worm", "manhattan", "batsman", "bowler", "wheel", "heat", "spider"];
  ok("...with its own test id", closed.every((x, k) => x.includes(`data-testid="${names[k]}-table-toggle"`)));
  const dash = render(AnalysisDashboard, { inn, match: { overs: 4 }, curIn: 0, innings: [inn], events: [e] });
  ok("the dashboard's charts carry their buttons (worm, run rate maybe, runs per over, batsmen, bowlers, heat, spider)", countOf(dash, /Show as table/g) >= 4, countOf(dash, /Show as table/g));
  ok("React reported nothing (no NaN, no key warning)", warned.length === 0, warned.slice(0, 3));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
