/**
 * The side's season panel (GA-I23, slice B3): one point per completed
 * limited-overs match, from the `side_season` read and nothing else.
 *
 * Held here:
 *   - the figures: run rate is 6 x runs / legal balls, the line is the
 *     season's rate so far (sum over sum, not an average of rates), drawn from
 *     the 5th match; a match with NULL figures adds nothing and is not zero
 *   - a rain-cut match says its allotment ("16 overs (revised)")
 *   - the 5-match floor: below it the panel says so in the source line's
 *     words, shows the points and draws no line
 *   - the table is the same points; the spoken sentence is one sentence with
 *     no verdict word
 *   - an empty, refused or failed read says so in words and draws no chart
 *   - signed in the panel replaces the demonstration; signed out it stays
 *   - the floors: 12px, 44px, no motion, tokens only
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/side-season.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { sideSchool, asSideSeason, MIN_MATCHES, allotmentWords, axisTop, floorNote, inningsText, resultWords, runRate, seasonOptions, seasonPoints, seasonTable, spokenSummary } from "../src/lib/sideSeason.js";
import { readState } from "../src/lib/readState.js";
import { ChartTablesOpen } from "../src/ui/ChartTable.jsx";
import { SideSeasonView } from "../src/views/sideseason.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&rsquo;|&#x2019;/g, "’").replace(/\s+/g, " ").trim();

// A row exactly as /api/read/side_season sends it, then through the adapter.
const raw = (k, o = {}) => ({
  match_id: `m${k}`, starts_at: `2026-03-${String(10 + k).padStart(2, "0")}T06:00:00.000Z`, season: "2026", current_season: true,
  side: "home", opponent: `Opp ${k}`, scheduled_overs: 20,
  for_innings: 1, for_runs: 120 + k * 6, for_wickets: 5, for_balls: 120, for_overs: 20, for_revised: false,
  against_innings: 2, against_runs: 100 + k * 6, against_wickets: 8, against_balls: 120, against_overs: 20, against_revised: false,
  result: "won", margin_kind: "runs", margin: 20, decided_by: null,
  ...o,
});
const rows = (n, over = {}) => Array.from({ length: n }, (_, i) => asSideSeason(raw(i + 1, over[i + 1] ?? {})));
const view = (rs, said = null, props = {}) =>
  renderToStaticMarkup(h(ChartTablesOpen.Provider, { value: !!props.open }, h(SideSeasonView, { rows: rs, said: said ?? readState({ rows: rs, live: true }, { what: "x" }), team: "1XI", ...props })));

group("The figures: a rate over the balls bowled");
{
  ok("6 x runs / legal balls", runRate(140, 120) === 7 && runRate(1, 6) === 1);
  ok("no ball, no rate (never 0, never NaN)", runRate(10, 0) === null && runRate(null, 12) === null && runRate(5, null) === null);
  ok("an all-out side is charged the balls it faced, not the allotment (Q10)", runRate(60, 60) === 6 && runRate(60, 120) === 3);
  const a = asSideSeason({ ...raw(1), for_runs: "140", for_balls: "120", for_revised: true });
  ok("the adapter reads numbers from the read's text and keeps NULL as null", a.forRuns === 140 && a.forBalls === 120 && a.forRevised === true
     && asSideSeason({ ...raw(1), for_runs: null }).forRuns === null);
  ok("the allotment in words, revised or not", allotmentWords(20, false) === "20 overs" && allotmentWords(16, true) === "16 overs (revised)" && allotmentWords(1, false) === "1 over" && allotmentWords(null, false) === null);
  ok("a result with its margin; a tie has none; the read's other words are said plainly",
     resultWords("won", "runs", 20) === "Won by 20 runs" && resultWords("lost", "wickets", 1) === "Lost by 1 wicket" && resultWords("tied", null, null) === "Tied" && resultWords("no_result", null, null) === "No result");
  ok("the innings as text", inningsText(142, 6, 122) === "142/6 in 20.2 overs" && inningsText(null, null, null) === null);
}

group("The points and the line: from the 5th match");
{
  const pts = seasonPoints(rows(7), "2026");
  ok("one point per completed match, in date order", pts.length === 7 && pts.every((p, i) => p.n === i + 1) && pts[0].opponent === "Opp 1");
  ok("each point is the match's own rate", pts[0].forRate === runRate(126, 120) && pts[0].againstRate === runRate(106, 120));
  ok("no line before the 5th match", pts.slice(0, 4).every((p) => p.soFarFor === null && p.soFarAgainst === null));
  const sumR = [1, 2, 3, 4, 5].reduce((s, k) => s + 120 + k * 6, 0);
  ok("the line at the 5th is 6 x sum(runs) / sum(balls) to that match", pts[4].soFarFor === (6 * sumR) / 600);
  const unequal = seasonPoints(rows(6, { 1: { for_runs: 200, for_balls: 60 } }), "2026");
  ok("the line is sum over sum, not an average of the matches' rates", unequal[5].soFarFor !== (unequal.reduce((s, p) => s + p.forRate, 0) / 6));
  const unsorted = seasonPoints([...rows(3)].reverse(), "2026");
  ok("rows out of order are put in date order", unsorted.map((p) => p.opponent).join() === "Opp 1,Opp 2,Opp 3");
  const two = [...rows(2), asSideSeason({ ...raw(9), season: "2025", current_season: false })];
  ok("only the season asked for, and the server's season picked by default", seasonPoints(two, "2026").length === 2 && seasonOptions(two).open === "2026" && seasonOptions(two).seasons.join() === "2026,2025");
  ok("the axis tops at a whole run an over, never under 1", axisTop(pts) >= 7 && Number.isInteger(axisTop(pts)) && axisTop([]) === 1);
}

group("Which school the side is");
{
  const roster = [{ team: "1XI", school: "W" }, { team: "1XI", school: "H" }, { team: "U15A", school: "H" }];
  ok("the school the reader holds, when the roster holds two 1XIs", sideSchool(roster, "1XI", ["H"]) === "H" && sideSchool(roster, "1XI", ["X", "W"]) === "W");
  ok("else the first the rows name; none for a side the rows lack", sideSchool(roster, "1XI") === "W" && sideSchool(roster, "U13A", ["H"]) === null && sideSchool([], "1XI") === null);
}

group("NULL is not zero; rain is said");
{
  const hidden = seasonPoints(rows(6, { 3: { for_runs: null, for_wickets: null, for_balls: null, against_runs: null, against_wickets: null, against_balls: null } }), "2026");
  ok("an unreadable match stays in the list with no rate", hidden.length === 6 && hidden[2].readable === false && hidden[2].forRate === null && hidden[2].againstRate === null);
  const clean = seasonPoints(rows(6), "2026");
  ok("...adds nothing to the line (balls neither)", hidden[5].soFarFor !== null && hidden[5].soFarFor !== clean[5].soFarFor);
  const sumR = [1, 2, 4, 5, 6].reduce((s, k) => s + 120 + k * 6, 0);
  ok("...the line is over the five that could be read", hidden[5].soFarFor === (6 * sumR) / 600);
  const rain = seasonPoints(rows(2, { 2: { for_overs: 16, for_revised: true, against_overs: 16, against_revised: true, for_balls: 96, against_balls: 96 } }), "2026");
  ok("a rain-cut match says its allotment", rain[1].rainCut === true && rain[1].allotment === "16 overs (revised)" && rain[0].rainCut === false && rain[0].allotment === "20 overs");
  const split = seasonPoints(rows(1, { 1: { for_overs: 20, against_overs: 16, against_revised: true } }), "2026");
  ok("...each side's own when only one innings was revised", split[0].allotment === "20 overs for, 16 overs (revised) against");
}

group("The floor: under 5 matches, plainly, and no line");
{
  ok("the floor is five", MIN_MATCHES === 5);
  const html = view(rows(3));
  const t = text(html);
  ok("the source line says: Only 3 completed matches, fewer than the 5 this needs. A guide, not a result.", /Only 3 completed matches, fewer than the 5 this needs\. A guide, not a result\./.test(t), t.slice(0, 400));
  ok("the note says where the line starts", /The line starts at the 5th match\. Until then each match is shown on its own\./.test(t));
  ok("no line is drawn, the points are", !/<polyline/.test(html) && !/<line [^>]*stroke-dasharray/.test(html.replace(/<line x1="0"[^>]*>/, "")) && (html.match(/data-testid="side-season-point"/g) ?? []).length === 3);
  ok("the legend says there is no line yet", /No line yet: it starts at the 5th match/.test(t));
  ok("floorNote is null from 5 matches", floorNote(seasonPoints(rows(5), "2026")) === null && floorNote(seasonPoints(rows(4), "2026")) !== null);
  const five = view(rows(5));
  ok("at five the line is drawn (one value: a tick, not a polyline) and the floor words are gone",
     !/fewer than the 5/.test(text(five)) && /Lines: run rate this season so far/.test(text(five)) && /<line [^>]*stroke-width="2\.5"/.test(five));
  ok("at six a polyline for each side", (view(rows(6)).match(/<polyline/g) ?? []).length === 2);
  ok("the denominator is the completed matches, from the source line", /Source Scored balls and scorebook imports/.test(text(five)) && /Basis From 5 completed matches\./.test(text(five)));
}

group("The words, and no verdict");
{
  const html = view(rows(6, { 4: { for_overs: 16, for_revised: true, against_overs: 16, against_revised: true } }));
  const t = text(html);
  ok("a rain-cut point says '16 overs (revised)' in the list and the note", /16 overs \(revised\)/.test(t) && /1 match was cut short by rain/.test(t));
  ok("the line's label", /Lines: run rate this season so far/.test(t));
  ok("no verdict word anywhere", !/in form|improving|declin|struggl|best|worst|strong|weak|good|poor/i.test(t), t.match(/in form|improving|declin|struggl|best|worst|strong|weak|good|poor/i)?.[0]);
  ok("the spoken sentence is hidden from the eye and read by the ear, one sentence about the figures",
     /class="sr-only"[^>]*data-testid="side-season-spoken"|data-testid="side-season-spoken"[^>]*class="sr-only"/.test(html) || /sr-only/.test(html.split("side-season-spoken")[0].slice(-80)));
  const said = spokenSummary(seasonPoints(rows(6), "2026"));
  ok("...it carries the season's rate for and against, and the tally", /^Run rate this season so far, after 6 completed matches: \d\.\d runs an over for the side and \d\.\d against\. Won 6, lost 0\.$/.test(said), said);
  ok("...under the floor it says there is no line", /fewer than the 5 the season line needs, so no line is drawn/.test(spokenSummary(seasonPoints(rows(2), "2026"))));
  ok("...a tie or no result is 'other', not a loss", /, 1 other\./.test(spokenSummary(seasonPoints(rows(5, { 5: { result: "tied", margin_kind: null, margin: null } }), "2026"))));
}

group("Show as table: the same points");
{
  const pts = seasonPoints(rows(6), "2026");
  const tbl = seasonTable(pts, "2026");
  ok("a row a match, a header a column, a caption", tbl.rows.length === 6 && tbl.columns.length === tbl.rows[0].length && /Run rate by match, 2026/.test(tbl.caption));
  ok("the figures are the points' own", tbl.rows[0][5] === pts[0].forRate.toFixed(1) && tbl.rows[0][3] === "126/5 in 20.0 overs" && tbl.rows[5][9] !== null && tbl.rows[0][9] === null);
  const closed = view(rows(6));
  ok("closed: a 44px button and nothing of the table", /data-testid="side-season-table-toggle"/.test(closed) && /Show as table/.test(closed) && !/<table/.test(closed));
  const open = view(rows(6), null, { open: true });
  ok("open: a real table of six matches", (open.match(/<table/g) ?? []).length === 1 && (open.match(/<tr>/g) ?? []).length >= 7 && /scope="row"/.test(open));
}

group("An empty or refused read says so in words");
{
  const none = view([], readState({ rows: [], live: true }, { what: "the side’s completed matches" }));
  ok("empty: said, no chart", /No the side’s completed matches on record\.|No .*completed matches.* on record/.test(text(none)) && !/<svg/.test(none), text(none));
  const refused = view([], readState({ rows: [], error: "forbidden", status: 403 }, { what: "the side’s completed matches" }));
  ok("refused: said, no chart, no retry to press", /may not read/.test(text(refused)) && !/side-season-chart/.test(refused), text(refused));
  const failed = view([], readState({ rows: [], error: "network" }, { what: "the side’s completed matches" }), { onRetry: () => {} });
  ok("failed: said, and a retry", /Could not read/.test(text(failed)) && /Retry|Try again/i.test(text(failed)) && !/side-season-chart/.test(failed), text(failed));
  const noSeason = view(rows(2).map((r) => ({ ...r, season: "2025", currentSeason: false })), null, { initial: { season: "1999" } });
  ok("a chosen season the rows lack falls back to one they have", /2025/.test(text(noSeason)) && (noSeason.match(/data-testid="side-season-point"/g) ?? []).length === 2);
}

group("Signed in replaces the demonstration; signed out keeps it");
{
  const an = read("../src/views/AnalyticsView.jsx");
  ok("the demonstration is drawn only when nobody is signed in (once)", /\{!signedIn\(\)&&<DemoWorm\/>\}/.test(an) && (an.match(/<DemoWorm\/>/g) ?? []).length === 1);
  ok("the side's season is drawn only when signed in, for the side on screen and the roster that names its school", /\{signedIn\(\)&&<SideSeason role=\{role\} team=\{teamFilter\} players=\{players\}\/>\}/.test(an) && (an.match(/<SideSeason /g) ?? []).length === 1);
  const sv = read("../src/views/sideseason.jsx");
  ok("the panel reads side_season and no other, with the school and side as parameters", /useLive\("side_season", role, nonce, \{ schoolId: school, teamCode: team \}\)/.test(sv) && (sv.match(/useLive\(/g) ?? []).length === 1);
  ok("it carries no demonstration and no worm", !/demo/i.test(sv.replace(/\/\*[\s\S]*?\*\//g, "")));
  const lib = read("../src/lib/sideSeason.js");
  ok("the lib calls no clock and no network", !/new Date|Date\.now|fetch\(|Math\.random|localStorage/.test(lib.replace(/\/\*[\s\S]*?\*\//g, "")));
  const live = read("../src/lib/live.js");
  ok("the read has its adapter", /side_season: asSideSeason,/.test(live));
  ok("a public page cannot draw it: nothing under public/ imports it", !/sideseason|sideSeason/.test(read("../src/public/PublicMatch.jsx")));
}

group("The floors: 12px, 44px, no motion, tokens");
{
  const src = read("../src/views/sideseason.jsx");
  const sizes = [...src.matchAll(/fontSize:\s*"(\d+(?:\.\d+)?)px"/g)].map((m) => Number(m[1]));
  ok("no font under 12px", sizes.length > 0 && sizes.every((s) => s >= 12), sizes.join());
  ok("no hex colour, no transition, no animation", !/#[0-9a-fA-F]{3,8}\b/.test(src) && !/transition|animation/.test(src));
  ok("the one control is T.floor.target tall", (src.match(/minHeight: `\$\{T\.floor\.target\}px`/g) ?? []).length === 1);
  const html = view([...rows(3), ...rows(2).map((r) => ({ ...r, matchId: `o${r.matchId}`, season: "2025", currentSeason: false }))]);
  ok("with two seasons: a labelled select, the server's current one named", /Season<\/span>/.test(html) && /2026 \(this season\)/.test(html) && (html.match(/<select/g) ?? []).length === 1);
  ok("with one season: no select", !/<select/.test(view(rows(3))));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
