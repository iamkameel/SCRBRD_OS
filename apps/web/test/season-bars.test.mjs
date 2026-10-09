/**
 * The Analytics performance tab's season bars (GA-I23, first slice): real
 * per-player, per-season figures from the `career_by_season` read, and no
 * invented figure on a signed-in screen.
 *
 * Held here:
 *
 *   - the bars ARE the read's rows: raw rows in the read's shape go through the
 *     web adapter (asSeasonCareer), and every bar's value is that row's figure,
 *     for the side's leaders in a season and for one player across seasons
 *   - a season he did not bat or bowl in is "did not bat" / "did not bowl",
 *     with no bar, never a bar of nought; a zero he scored stays a zero
 *   - the side's chart is the top six, highest first, ties by name, only the
 *     side on screen, only the season asked for; and it says it is the leaders
 *     because no player is picked
 *   - a read that shows this reader one player of the side draws that player
 *   - the source line: source, scope, window and basis (innings, or balls
 *     bowled), the zero words where the figures are nothing
 *   - signed in, nothing is labelled Demo and the demonstration is not drawn;
 *     signed out, the panel says Demo through StateLabel and claims no source
 *   - the view holds no hard-coded figures: the old SEASON_TREND / SEASON_OPP
 *     arrays are gone from it, the worm is a separate demonstration drawn only
 *     when signedIn() is false, and the panel's data comes from the read
 *   - a read that failed is said, with a Retry, and draws no bar
 *   - the floors: nothing under 12px, controls 44px, no animation
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/season-bars.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { asSeasonCareer } from "../src/lib/live.js";
import { readState } from "../src/lib/readState.js";
import {
  SQUAD_LIMIT, SEASON_LIMIT, basisFor, demoSeasonRows, playerBars, seasonChoice, seasonsWindow, sidePlayers, squadBars, whoIs,
} from "../src/lib/seasonBars.js";
import { SeasonBarsView } from "../src/views/seasonbars.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 300)}`); } };
const group = (t) => console.log("\n" + t);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&rsquo;|&#x2019;/g, "’").replace(/\s+/g, " ").trim();

// A row exactly as /api/read/career_by_season sends it (read-api.mjs), then
// through the adapter the screen uses.
const raw = (id, name, team, season, o = {}) => ({
  player_id: id, full_name: name, team_code: team, school_id: "HIL", season,
  current_season: o.current === true,
  bat_matches: 0, runs: 0, balls_faced: 0, fours: 0, sixes: 0, dismissals: 0,
  bowl_matches: 0, runs_conceded: 0, balls_bowled: 0, wides: 0, no_balls: 0, wickets: 0,
  book_innings: 0, innings_without_balls: 0, runs_without_balls: 0, innings_without_boundaries: 0, bowling_without_extras: 0,
  ...o.row,
});
const READ = [
  // 2026 (current), 1XI
  raw("a", "A Batter", "1XI", "2026", { current: true, row: { bat_matches: 5, runs: 212, balls_faced: 190, dismissals: 4 } }),
  raw("b", "B Allround", "1XI", "2026", { current: true, row: { bat_matches: 4, runs: 96, balls_faced: 101, dismissals: 3, bowl_matches: 4, balls_bowled: 72, runs_conceded: 80, wickets: 7 } }),
  raw("c", "C Bowler", "1XI", "2026", { current: true, row: { bowl_matches: 5, balls_bowled: 90, runs_conceded: 99, wickets: 9 } }),
  raw("z", "Z Duck", "1XI", "2026", { current: true, row: { bat_matches: 1, runs: 0, balls_faced: 3, dismissals: 1 } }),
  raw("d", "D Other", "U15A", "2026", { current: true, row: { bat_matches: 3, runs: 300, balls_faced: 250, dismissals: 3 } }),
  // 2025
  raw("a", "A Batter", "1XI", "2025", { row: { bat_matches: 6, runs: 150, balls_faced: 140, dismissals: 6 } }),
  raw("b", "B Allround", "1XI", "2025", { row: { bowl_matches: 3, balls_bowled: 54, runs_conceded: 60, wickets: 4 } }),
].map(asSeasonCareer);
const ROWS = READ;
const bars = (html) => [...html.matchAll(/<li data-testid="season-bar" data-key="([^"]*)" data-value="([^"]*)"/g)].map((m) => ({ key: m[1], value: m[2] }));
const view = (props) => renderToStaticMarkup(h(SeasonBarsView, { demo: false, rows: ROWS, said: { state: "ok", sentence: null, retry: false }, team: "1XI", ...props }));

group("The side's chart: the read's rows, this season, highest first");
{
  const sq = squadBars(ROWS, { team: "1XI", season: "2026", metric: "runs" });
  ok("only the side on screen: the U15A boy's 300 is not in it", !sq.bars.some((b) => b.id === "d"), sq.bars.map((b) => b.name).join(","));
  ok("highest first, each bar the row's runs", sq.bars.map((b) => `${b.id}:${b.v}`).join() === "a:212,b:96", sq.bars.map((b) => `${b.id}:${b.v}`).join());
  ok("a bowler who did not bat has no run bar, and the duck (batted, scored none) has no bar of nought either", !sq.bars.some((b) => b.id === "c" || b.id === "z"));
  ok("...but the duck IS a real zero in his own chart (below)", playerBars(ROWS, "z", "runs").bars[0].v === 0);
  const wk = squadBars(ROWS, { team: "1XI", season: "2026", metric: "wkts" });
  ok("wickets: the row's wickets, highest first", wk.bars.map((b) => `${b.id}:${b.v}`).join() === "c:9,b:7", wk.bars.map((b) => `${b.id}:${b.v}`).join());
  ok("another season is that season's rows alone", squadBars(ROWS, { team: "1XI", season: "2025", metric: "runs" }).bars.map((b) => b.id).join() === "a");
  ok("a season nobody played in is empty, not a guess", squadBars(ROWS, { team: "1XI", season: "2019", metric: "runs" }).bars.length === 0);
  const many = Array.from({ length: 9 }, (_, i) => asSeasonCareer(raw(`p${i}`, `Player ${i}`, "1XI", "2026", { row: { bat_matches: 1, runs: 10 + i, balls_faced: 10 } })));
  const top = squadBars(many, { team: "1XI", season: "2026", metric: "runs" });
  ok(`the top ${SQUAD_LIMIT} of nine, and it knows there are nine`, top.bars.length === SQUAD_LIMIT && top.eligible === 9 && top.bars[0].v === 18, top.bars.length);
  const ties = [asSeasonCareer(raw("y", "Y Tie", "1XI", "2026", { row: { bat_matches: 1, runs: 5, balls_faced: 5 } })), asSeasonCareer(raw("x", "X Tie", "1XI", "2026", { row: { bat_matches: 1, runs: 5, balls_faced: 5 } }))];
  ok("ties by name", squadBars(ties, { team: "1XI", season: "2026", metric: "runs" }).bars.map((b) => b.name).join() === "X Tie,Y Tie");
}

group("One player's seasons: oldest first, did-not-bat is not a zero");
{
  const a = playerBars(ROWS, "a", "runs");
  ok("A Batter: 2025 then 2026, each the row's runs", a.bars.map((b) => `${b.season}:${b.v}`).join() === "2025:150,2026:212", a.bars.map((b) => `${b.season}:${b.v}`).join());
  ok("...and 2026 is marked as this season, from the server", a.bars[1].current === true && a.bars[0].current === false);
  const b = playerBars(ROWS, "b", "runs");
  ok("B Allround did not bat in 2025: null, not 0", b.bars[0].season === "2025" && b.bars[0].v === null && b.bars[1].v === 96, JSON.stringify(b.bars.map((x) => x.v)));
  const bw = playerBars(ROWS, "b", "wkts");
  ok("his wickets: 4 then 7", bw.bars.map((x) => x.v).join() === "4,7");
  const c = playerBars(ROWS, "c", "runs");
  ok("a bowler who never batted: null in every season", c.bars.length === 1 && c.bars[0].v === null);
  const long = Array.from({ length: 12 }, (_, i) => asSeasonCareer(raw("m", "M Long", "1XI", String(2015 + i), { row: { bat_matches: 1, runs: i, balls_faced: 1 } })));
  const lp = playerBars(long, "m", "runs");
  ok(`at most the latest ${SEASON_LIMIT} seasons, oldest first`, lp.bars.length === SEASON_LIMIT && lp.bars[0].season === "2019" && lp.bars.at(-1).season === "2026", lp.bars.map((x) => x.season).join());
}

group("Who the chart is about");
{
  const players = sidePlayers(ROWS, "1XI");
  ok("the side's players, most runs first, one each", players.map((p) => p.id).join() === "a,b,c,z", players.map((p) => p.id).join());
  ok("nobody picked, several in view: the side's chart", whoIs("", players) === "");
  ok("a picked player wins", whoIs("b", players) === "b");
  ok("a pick the read no longer shows is nobody", whoIs("nobody", players) === "");
  ok("the read shows this reader ONE player of the side (a pupil, a parent): that player", whoIs("", [{ id: "kid", name: "K Kid" }]) === "kid");
  ok("...and no players, no one", whoIs("", []) === "");
  const one = [asSeasonCareer(raw("kid", "K Kid", "1XI", "2026", { current: true, row: { bat_matches: 2, runs: 33, balls_faced: 40, dismissals: 2 } }))];
  const html = view({ rows: one });
  ok("the screen draws his seasons, not a squad, and says why", /data-mode="player"/.test(html) && /read shows you one player of this side/.test(text(html)), text(html).slice(0, 200));
  ok("...with no player picker, as there is only one", !/season-bars-player/.test(html));
}

group("What the panel draws, from the read's rows (signed in)");
{
  const html = view({});
  const got = bars(html);
  const squad = squadBars(ROWS, { team: "1XI", season: "2026", metric: "runs" }).bars;
  ok("every bar is the row's figure, in order", JSON.stringify(got) === JSON.stringify(squad.map((b) => ({ key: b.id, value: String(b.v) }))), JSON.stringify(got));
  ok("the figure is text as well as a bar", /212/.test(text(html)) && /A Batter/.test(text(html)));
  ok("the bar fill is drawn from the figure, not a constant", /width:100%/.test(html) && /width:\d+(\.\d+)?%/.test(html));
  ok("it opens on the current season, the server's word", /<option value="2026" selected="">2026 \(this season\)<\/option>/.test(html), html.match(/<select[^>]*season[\s\S]*?<\/select>/)?.[0]);
  ok("it offers only the seasons the rows hold", seasonChoice(ROWS.filter((r) => r.team === "1XI")).seasons.join() === "2026,2025");
  ok("it says the chart is the leaders because no player is picked", /No player is picked, so this is the side.s leaders/.test(text(html)), text(html).slice(0, 400));
  const player = view({ initial: { picked: "a" } });
  ok("a picked player: one bar a season", JSON.stringify(bars(player)) === JSON.stringify([{ key: "2025", value: "150" }, { key: "2026", value: "212" }]), JSON.stringify(bars(player)));
  ok("...this season is named", /2026 · this season/.test(text(player)));
  const wk = view({ initial: { metric: "wkts" } });
  ok("wickets: the row's wickets", JSON.stringify(bars(wk)) === JSON.stringify([{ key: "c", value: "9" }, { key: "b", value: "7" }]), JSON.stringify(bars(wk)));
  const dnb = view({ initial: { picked: "b" } });
  const li = [...dnb.matchAll(/<li data-testid="season-bar" data-key="2025"[\s\S]*?<\/li>/g)][0]?.[0] ?? "";
  ok("did not bat: the words, an empty value, and no filled bar", /did not bat/.test(text(li)) && /data-value=""/.test(li) && !/width:\d/.test(li), li.slice(0, 300));
  ok("the other side is not on this screen", !/D Other/.test(text(html)) && !/300/.test(text(html)));
}

group("The source line says what the bars stand on");
{
  const html = view({});
  const line = text(html.slice(html.indexOf('data-testid="source-line-season-bars"')));
  ok("source: scored balls and scorebook imports, as the career panels say", /Source Scored balls and scorebook imports/.test(line), line.slice(0, 200));
  ok("scope: the side, and that these are the top by runs", /Scope 1XI, 2 players by runs/.test(line), line.slice(0, 200));
  ok("window: the season", /Window The 2026 school season/.test(line), line.slice(0, 300));
  ok("basis: innings, with the balls when every one recorded them", /Basis From 9 innings, 291 balls faced\./.test(line), line.slice(0, 400));
  const wk = text(view({ initial: { metric: "wkts" } }));
  ok("wickets stand on balls bowled", /Basis From 162 balls bowled\./.test(wk), wk.slice(0, 500));
  const span = text(view({ initial: { picked: "a" } }));
  ok("a player's window is the seasons shown", /Scope One player: A Batter Window 2025 to 2026 school seasons/.test(span), span.slice(0, 300));
  ok("seasonsWindow: one, a span, none", seasonsWindow(["2026"]) === "The 2026 school season" && seasonsWindow(["2026", "2024", "2025"]) === "2024 to 2026 school seasons" && seasonsWindow([]) === null);
  ok("basis: no rows, none given; a thing with nothing says zero", basisFor([], "runs") === null);
  const zero = renderToStaticMarkup(h(SeasonBarsView, { demo: false, team: "1XI", said: { state: "ok", sentence: null, retry: false },
    rows: [asSeasonCareer(raw("q", "Q Quiet", "1XI", "2026", { current: true, row: { bat_matches: 1, runs: 4, balls_faced: 4 } }))], initial: { metric: "wkts", picked: "q" } }));
  ok("a season with nothing behind a wicket figure says so", /did not bowl/.test(text(zero)));
  const nothing = text(view({ rows: ROWS.filter((r) => r.team === "U15A"), team: "1XI" }));
  ok("a side with no rows says there are none, in words", /No season figures for 1XI that you may see/.test(nothing), nothing);
  const noRuns = text(view({ rows: [ROWS.find((r) => r.id === "c" && r.season === "2026"), asSeasonCareer(raw("e", "E Bowler", "1XI", "2026", { current: true, row: { bowl_matches: 1, balls_bowled: 12, wickets: 1 } }))], team: "1XI" }));
  ok("a season where nobody scored says that, not a chart of nothing", /No runs for 1XI in the 2026 school season/.test(noRuns), noRuns);
}

group("Signed in is never Demo; signed out always is");
{
  const signed = view({});
  ok("signed in: no Demo label, no demonstration marker", !/state-label-demo/.test(signed) && !/data-demo/.test(signed) && !/\bDemo\b/.test(text(signed)));
  const sample = [
    { id: "s1", name: "Sample One", team: "1XI", school: "HIL", careerTotals: { runs: 1000, innings: 40 }, wkts: 10 },
    { id: "s2", name: "Sample Two", team: "1XI", school: "HIL", careerTotals: { runs: 400, innings: 20 }, wkts: 0 },
    { id: "s3", name: "Sample Three", team: "1XI", school: "HIL" },
  ];
  const demoRows = demoSeasonRows(sample);
  ok("the demonstration: three seasons a sample player who has a career, none for one without", demoRows.length === 6 && !demoRows.some((r) => r.id === "s3"));
  ok("...whose seasons add back up to the sample's own career (no figure invented)", demoRows.filter((r) => r.id === "s1").reduce((t, r) => t + r.runs, 0) === 1000 && demoRows.filter((r) => r.id === "s2").reduce((t, r) => t + r.runs, 0) === 400);
  ok("...none of them live, so none claims a source", demoRows.every((r) => r.live === false));
  const demo = renderToStaticMarkup(h(SeasonBarsView, { demo: true, rows: demoRows, said: null, team: "1XI" }));
  ok("signed out: Demo, through StateLabel", /data-testid="state-label-demo"/.test(demo) && /\bDemo\b/.test(text(demo)));
  ok("...claims no source and no basis", !/Source Scored balls/.test(text(demo)) && !/Basis/.test(text(demo)), text(demo).slice(0, 300));
  ok("...but still draws the bars", bars(demo).length > 0);
}

group("A read that did not answer is said, and nothing is drawn");
{
  const failed = view({ said: readState({ rows: [], loading: false, error: "boom", status: 500 }, { what: "the season figures" }), rows: [], onRetry: () => {} });
  ok("failed: the sentence and a Retry", /Could not read the season figures/.test(text(failed)) && /season-bars-read-state-retry/.test(failed), text(failed).slice(0, 200));
  ok("...and no bar and no source line", bars(failed).length === 0 && !/source-line-season-bars/.test(failed));
  const loading = view({ said: readState({ rows: [], loading: true }, { what: "the season figures" }), rows: [] });
  ok("loading: says so, draws no bar", /Reading the season figures/.test(text(loading)) && bars(loading).length === 0);
  const forbidden = view({ said: readState({ rows: [], error: "forbidden", status: 403 }, { what: "the season figures" }), rows: [] });
  ok("forbidden: says so, with no Retry", /may not read/.test(text(forbidden)) && !/retry/.test(forbidden));
  const empty = view({ said: readState({ rows: [], loading: false, error: null }, { what: "the season figures" }), rows: [] });
  ok("empty: none on record, never a zero chart", /No season figures on record/.test(text(empty)) && bars(empty).length === 0);
}

group("The view holds no invented figures");
{
  const an = read("../src/views/AnalyticsView.jsx");
  ok("SEASON_TREND and SEASON_OPP are gone from the Analytics view", !/SEASON_TREND|SEASON_OPP/.test(an));
  ok("the Analytics view holds no array of bare scores", !/\[\s*\d{2,3}\s*,\s*\d{2,3}\s*,\s*\d{2,3}\s*,/.test(an));
  ok("the season bars are on the performance tab, keyed by the side", /<SeasonBars key=\{teamFilter\?\?"none"\} role=\{role\} team=\{teamFilter\}/.test(an));
  ok("the demonstration worm is drawn ONLY when nobody is signed in", /\{!signedIn\(\)&&<DemoWorm\/>\}/.test(an) && (an.match(/<DemoWorm\/>/g) ?? []).length === 1);
  const worm = read("../src/views/demoworm.jsx");
  ok("...it says Demo through the shared line", /<SourceLine testid="source-line-worm" demo /.test(worm));
  ok("...and nothing else imports the worm", ["AnalyticsView.jsx"].every((f) => read(`../src/views/${f}`).includes("demoworm.jsx")) && !/demoworm/.test(read("../src/views/seasonbars.jsx")));
  const sb = read("../src/views/seasonbars.jsx");
  ok("the wrapper reads career_by_season, the Leagues screen's own read, and no other", /useLive\("career_by_season"/.test(sb) && (sb.match(/useLive\(/g) ?? []).length === 1);
  ok("signed in draws the read's rows; the demonstration is for signed out only", /rows=\{demo \? demoSeasonRows\(demoPlayers\) : read\.rows\}/.test(sb) && /const demo = !signedIn\(\)/.test(sb));
  const lib = read("../src/lib/seasonBars.js");
  ok("the lib calls no clock and no network", !/Date\b|fetch\(|Math\.random|localStorage/.test(lib.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("the Analytics tab adds no new read of its own for the bars", !/useLive\("career_by_season"/.test(an));
}

group("The floors: 12px, 44px, no motion, tokens");
{
  for (const f of ["../src/views/seasonbars.jsx", "../src/views/demoworm.jsx"]) {
    const src = read(f);
    const sizes = [...src.matchAll(/fontSize:\s*"(\d+(?:\.\d+)?)px"/g)].map((m) => Number(m[1]));
    ok(`${f.split("/").pop()}: no font under 12px`, sizes.every((s) => s >= 12), sizes.join());
    ok(`${f.split("/").pop()}: no hex colour and no transition`, !/#[0-9a-fA-F]{3,8}\b/.test(src) && !/transition|animation/.test(src));
  }
  const sb = read("../src/views/seasonbars.jsx");
  ok("every control is T.floor.target tall", (sb.match(/minHeight: `\$\{T\.floor\.target\}px`/g) ?? []).length === 2);
  const html = view({});
  ok("two buttons and two selects, each labelled", (html.match(/<button/g) ?? []).length === 2 && (html.match(/<select/g) ?? []).length === 2 && /Player<\/span>/.test(html) && /Season<\/span>/.test(html));
  ok("the figure chooser says which is pressed, to a reader and not by colour", (html.match(/aria-pressed="true"/g) ?? []).length === 1 && (html.match(/aria-pressed="false"/g) ?? []).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
