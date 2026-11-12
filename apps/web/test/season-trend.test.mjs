/**
 * A player's season, innings by innings (GA-I23 slice 2, B2;
 * docs/design/SCENARIO_AND_TREND_design.md §B2.2, §B3, Q8, Q9, Q12).
 *
 * Held here, on pure figures and on the panel drawn from rows it is handed:
 *
 *   - the read's rows, through the web adapter (asInnings): a scorebook's
 *     missing balls stay null, never 0; `source` is scored or scorebook
 *   - the rolling five: runs an innings over the last five, from the 5th
 *     innings, its denominator fixed at five (a not-out does not move it)
 *   - the floors: no line under 6 innings, none with under 30 balls faced in
 *     the last five; at 6 and 30 it is drawn; the source line's words for each
 *   - not-outs: "23*", no average without a dismissal (never 0)
 *   - scorebook innings: a point each; a null-balls innings counts towards the
 *     6 and its balls towards nothing, out of the strike rate (runs and balls)
 *   - did not bat: "Did not bat this season.", no axis, no zero
 *   - a read that answers nothing says so in words, a refused or failed read
 *     says so through ReadState, and neither draws a chart
 *   - "Show as table" (ChartTable) and a spoken summary (aria-describedby),
 *     the same figures the chart draws, the line's column only with the line
 *   - no verdict words anywhere (Q9)
 *   - the floors of the style lock: nothing under 12px, controls 44px, no
 *     animation, no new dependency; signed in only, gated by the read
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/season-trend.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MIN_BALLS_FACED as RATING_FLOOR } from "@scrbrd/scoring";
import { asInnings, liveResources } from "../src/lib/live.js";
import { readState } from "../src/lib/readState.js";
import {
  LINE_LABEL, MIN_BALLS_FACED, MIN_INNINGS, ROLLING, VERDICT_WORDS, chartGeometry, lastFiveBalls, lineState, rollingFive, runsLabel,
  seasonChoice, seasonFigures, seasonPoints, spokenSummary, trendNotes, trendTable,
} from "../src/lib/seasonTrend.js";
import { denominatorWords } from "../src/ui/sourceLine.jsx";
import { ChartTablesOpen } from "../src/ui/ChartTable.jsx";
import { AnalyticsSeasonTrend, SeasonTrendView, quietWhenEmpty } from "../src/views/seasontrend.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 400)}`); } };
const group = (t) => console.log("\n" + t);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// A row exactly as /api/read/innings_by_season sends it (read-api.mjs), then
// through the adapter the screen uses.
let k = 0;
const raw = (runs, balls, out, o = {}) => ({
  player_id: "p5", full_name: "R Pillay", team_code: "1XI", school_id: "HIL",
  season: o.season ?? "2026", current_season: (o.season ?? "2026") === "2026",
  match_id: `m${++k}`, innings: 1, ended_at: `2026-0${1 + (k % 9)}-1${k % 10}T10:00:00.000Z`,
  starts_at: `2026-0${1 + (k % 9)}-1${k % 10}T07:00:00.000Z`,
  runs, balls_faced: balls, out, source: o.book ? "scorebook" : "scored",
});
const rows = (list) => list.map((r) => asInnings(r));
const pts = (list, season = "2026") => seasonPoints(rows(list), season);
const said = (r) => readState({ rows: r, loading: false, error: null, status: null, live: true }, { what: "R Pillay's innings" });
const view = (r, props = {}) => renderToStaticMarkup(h(SeasonTrendView, { rows: r, said: said(r), who: "R Pillay", ...props }));
const viewOpen = (r, props = {}) => renderToStaticMarkup(h(ChartTablesOpen.Provider, { value: true }, h(SeasonTrendView, { rows: r, said: said(r), who: "R Pillay", ...props })));

group("The adapter: the read's columns renamed, nothing worked out");
{
  const a = asInnings({ player_id: "p", full_name: "N", team_code: "1XI", school_id: "S", season: "2026", current_season: true,
    match_id: "m", innings: "2", ended_at: "2026-03-01T09:00:00Z", runs: "23", balls_faced: null, out: false, source: "scorebook" });
  ok("a scorebook's missing balls stay null, never 0", a.ballsFaced === null);
  ok("runs and innings are numbers", a.runs === 23 && a.innings === 2);
  ok("source is the read's", a.source === "scorebook" && asInnings({ source: "scored" }).source === "scored");
  ok("out is the read's, false unless true", a.out === false && asInnings({ out: true }).out === true && asInnings({}).out === false);
  ok("balls of 0 recorded stay 0", asInnings({ balls_faced: 0 }).ballsFaced === 0);
  ok("the client knows how to read it live", liveResources().includes("innings_by_season"));
  ok("the match's start is carried as the innings' date", asInnings({ starts_at: "2026-03-01T07:00:00Z" }).startsAt === "2026-03-01T07:00:00Z"
     && asInnings({}).startsAt === null);
}

group("The date is the match's start, never the server's insert time (review S3)");
{
  // Scored offline at a ground with no signal on 7 March, sent on 16 March:
  // ended_at (max server_ts) is the 16th; the innings was played on the 7th.
  const late = { ...raw(31, 28, true), starts_at: "2026-03-07T07:00:00.000Z", ended_at: "2026-03-16T18:40:00.000Z" };
  const p = seasonPoints(rows([late]), "2026");
  ok("a point's date is the match's start", p[0].on === "2026-03-07T07:00:00.000Z");
  const t = trendTable({ who: "R Pillay", season: "2026", points: p });
  ok("...and the table's Date column says the day it was played", t[0].rows[0][1] === "7 Mar 2026", t[0].rows[0][1]);
  ok("a row with no start has no date, not the insert time", trendTable({ who: "X", season: "2026", points: seasonPoints(rows([{ ...late, starts_at: null }]), "2026") })[0].rows[0][1] === null);
}

group("The floors are Q12's, and the 30 is the rating's own");
{
  ok("6 innings", MIN_INNINGS === 6);
  ok("a rolling five", ROLLING === 5);
  ok("30 balls, MIN_BALLS_FACED from rating.mjs, not a second copy", MIN_BALLS_FACED === 30 && MIN_BALLS_FACED === RATING_FLOOR);
  ok("the line's label is B3's", LINE_LABEL === "Runs an innings, last five innings");
}

group("The rolling five");
{
  const p = pts([raw(10, 12, true), raw(20, 15, true), raw(30, 25, false), raw(0, 2, true), raw(40, 30, true), raw(5, 8, true), raw(15, 10, false)]);
  const r = rollingFive(p);
  ok("a point at each innings from the 5th", r.map((x) => x.n).join() === "5,6,7", JSON.stringify(r));
  ok("runs ÷ 5 over the five ending there", r[0].v === 20 && r[1].v === 19 && r[2].v === 18, JSON.stringify(r));
  ok("a not-out does not change the denominator", r[0].v === (10 + 20 + 30 + 0 + 40) / 5);
  ok("one decimal place", rollingFive(pts([raw(1, 1, true), raw(1, 1, true), raw(1, 1, true), raw(1, 1, true), raw(2, 1, true)]))[0].v === 1.2);
  ok("under five innings, no point", rollingFive(pts([raw(1, 1, true), raw(2, 2, true), raw(3, 3, true), raw(4, 4, true)])).length === 0);
  ok("the points are in the read's order, numbered from 1", p.map((x) => x.n).join() === "1,2,3,4,5,6,7" && p[2].runs === 30);
}

group("The 6-innings floor");
{
  const five = pts([raw(10, 12, true), raw(20, 15, true), raw(30, 25, false), raw(0, 2, true), raw(40, 30, true)]);
  const st5 = lineState(five);
  ok("5 innings: no line", st5.draw === false && st5.short === "innings");
  ok("...and the basis says so in B3's words", denominatorWords(st5.basis).text === "Only 5 innings, fewer than the 6 this needs. A guide, not a result."
     && denominatorWords(st5.basis).level === "small", denominatorWords(st5.basis)?.text);
  ok("...and the note says when it starts", trendNotes(five)[0] === "The line starts once he has batted 6 times this season. Until then each innings is shown on its own.", trendNotes(five)[0]);
  ok("...to the boy himself, in the second person", /once you have batted 6 times/.test(trendNotes(five, { self: true })[0]));
  const six = pts([raw(10, 12, true), raw(20, 15, true), raw(30, 25, false), raw(0, 2, true), raw(40, 30, true), raw(5, 8, true)]);
  const st6 = lineState(six);
  ok("6 innings and 30 balls in the last five: the line is drawn", st6.draw === true && st6.short === null, JSON.stringify(st6));
  ok("...and the basis says both", denominatorWords(st6.basis).text === "From 6 innings, 80 balls faced in his last five innings.", denominatorWords(st6.basis)?.text);
  const html = view(rows([raw(10, 12, true), raw(20, 15, true), raw(30, 25, false), raw(0, 2, true), raw(40, 30, true)]));
  ok("the panel draws the points and no line under 6", (html.match(/data-testid="season-trend-point"/g) ?? []).length === 5 && !/season-trend-line/.test(html) && /data-line="none"/.test(html));
  ok("...with the warning icon beside the basis, not colour alone", /data-level="small"/.test(html) && /triangle-alert|<svg/.test(html));
}

group("The 30-ball floor, over the last five only");
{
  const p = pts([raw(50, 60, true), raw(3, 4, true), raw(4, 4, true), raw(5, 5, true), raw(2, 5, true), raw(1, 4, true)]);
  ok("the balls are the last five's, not the season's", lastFiveBalls(p) === 22);
  const st = lineState(p);
  ok("6 innings, 22 balls in the last five: no line", st.draw === false && st.short === "balls");
  ok("...in B3's words", denominatorWords(st.basis).text === "Only 22 balls faced in his last five innings, fewer than the 30 this needs. A guide, not a result.", denominatorWords(st.basis)?.text);
  ok("...and a note of when it starts", /^The line starts once his last five innings hold 30 balls faced\./.test(trendNotes(p)[0]), trendNotes(p)[0]);
  const at30 = pts([raw(1, 1, true), raw(3, 6, true), raw(4, 6, true), raw(5, 6, true), raw(2, 6, true), raw(1, 6, true)]);
  ok("exactly 30: drawn", lastFiveBalls(at30) === 30 && lineState(at30).draw === true);
  const at29 = pts([raw(1, 1, true), raw(3, 6, true), raw(4, 6, true), raw(5, 6, true), raw(2, 6, true), raw(1, 5, true)]);
  ok("29: not drawn", lastFiveBalls(at29) === 29 && lineState(at29).draw === false);
  const none = pts([raw(1, 1, true), raw(3, null, true, { book: true }), raw(4, null, true, { book: true }), raw(5, null, true, { book: true }), raw(2, null, true, { book: true }), raw(1, null, true, { book: true })]);
  const stn = lineState(none);
  ok("five book innings with no balls: no line, and the basis does not deny the points", stn.draw === false && stn.short === "balls"
     && denominatorWords(stn.basis).text === "From 6 innings, no balls recorded in his last five innings.", denominatorWords(stn.basis)?.text);
}

group("Not-outs and the average");
{
  const p = pts([raw(23, 20, false), raw(30, 25, false), raw(12, 10, false)]);
  ok("a not-out is marked 23*", runsLabel(p[0]) === "23*" && runsLabel(pts([raw(7, 9, true)])[0]) === "7");
  const f = seasonFigures(p);
  ok("no dismissal: no average, never 0", f.average === null && f.notOuts === 3 && f.dismissals === 0);
  const g = seasonFigures(pts([raw(23, 20, false), raw(30, 25, true), raw(12, 10, true)]));
  ok("runs ÷ dismissals, one decimal place", g.average === 32.5 && g.runs === 65 && g.innings === 3 && g.notOuts === 1);
  ok("strike rate is 100 × runs ÷ balls, whole", g.strikeRate === Math.round(100 * 65 / 55));
  const html = view(rows([raw(23, 20, false), raw(30, 25, false)]));
  ok("the panel says 'no average yet', not 0", /no average yet/.test(text(html)) && !/Average 0\b/.test(text(html)));
  ok("...and writes each not-out with its star", /23\* · 30\*/.test(text(html)));
  ok("...and draws a not-out as an open mark, an out as a filled one", /data-out="false"/.test(html) && !/data-out="true"/.test(html));
}

group("Scorebook innings");
{
  const list = [raw(20, 18, true), raw(40, null, true, { book: true }), raw(10, 12, false, { book: true }), raw(5, 6, true)];
  const p = pts(list);
  const f = seasonFigures(p);
  ok("each is a point of its own, marked as the book's", p.length === 4 && p.filter((x) => x.source === "scorebook").length === 2);
  ok("its runs are in the season's runs", f.runs === 75);
  ok("a null-balls innings is out of the strike rate, runs and balls both", f.ballsFaced === 36 && f.strikeRate === Math.round(100 * 35 / 36), JSON.stringify(f));
  ok("...counted as a book innings with no balls", f.bookInnings === 2 && f.bookNoBalls === 1);
  ok("the note says what the book lacks, in B3's words",
     trendNotes(p).includes("2 innings are from a scorebook; 1 has no balls recorded, so it is not in the strike rate."), JSON.stringify(trendNotes(p)));
  ok("one book innings with its balls: singular, nothing it lacks", trendNotes(pts([raw(10, 12, false, { book: true })])).includes("1 innings is from a scorebook."));
  // It counts towards the 6, its balls towards nothing.
  const six = pts([raw(10, 12, true), raw(20, 15, true), raw(40, null, true, { book: true }), raw(0, 2, true), raw(40, 30, true), raw(5, 8, true)]);
  ok("a null-balls innings counts towards the 6", six.length === 6 && lineState(six).short !== "innings");
  ok("...and its balls towards nothing in the 30", lastFiveBalls(six) === 15 + 0 + 2 + 30 + 8);
  ok("only book innings with no balls: no strike rate, said in words", seasonFigures(pts([raw(40, null, true, { book: true })])).strikeRate === null
     && /no balls recorded/.test(text(view(rows([raw(40, null, true, { book: true })])))));
  const html = view(rows(list));
  ok("the panel draws a book innings as a square, and says so in the legend", (html.match(/<rect[^>]*data-source="scorebook"|data-source="scorebook"[^>]*<\/rect>|<rect data-testid="season-trend-point"/g) ?? []).length >= 2
     && /from a scorebook/.test(text(html)));
}

group("Did not bat");
{
  const old = rows([raw(12, 10, true, { season: "2025" }), raw(30, 31, false, { season: "2025" })]);
  const c = seasonChoice(old);
  ok("no innings this season: nothing to open on", c.open === null && c.current === null && c.seasons.join() === "2025");
  const html = view(old);
  ok("'Did not bat this season.', no axis, no zero", /Did not bat this season\./.test(text(html)) && !/<svg[^>]*season-trend-chart/.test(html)
     && !/data-testid="season-trend-chart"/.test(html) && !/data-testid="season-trend-point"/.test(html));
  ok("...with his earlier season a choice away", /data-testid="season-trend-season"/.test(html) && /<option value="2025">2025<\/option>/.test(html));
  const opened = view(old, { initial: { season: "2025" } });
  ok("choosing it draws that season's innings, under 'that season'", (opened.match(/data-testid="season-trend-point"/g) ?? []).length === 2
     && /batted fewer than 6 times that season/.test(text(opened)) && /The 2025 school season/.test(text(opened)));
  ok("...and the select stays, with this season a choice back (review N4)", /data-testid="season-trend-season"/.test(opened)
     && /<option value="">This season<\/option>/.test(opened) && /<option value="2025" selected="">2025<\/option>/.test(opened), opened.slice(opened.indexOf("<select"), opened.indexOf("</select>")));
  const one = view(rows([raw(12, 10, true)]));
  ok("one season, this season: no select to offer", !/data-testid="season-trend-season"/.test(one));
}

group("A finished season says no \"yet\" and no \"Until then\" (review N3)");
{
  const four = pts([raw(10, 12, true, { season: "2025" }), raw(20, 15, false, { season: "2025" }), raw(30, 25, false, { season: "2025" }), raw(0, 2, false, { season: "2025" })], "2025");
  const done = trendNotes(four, { current: false }).join(" ");
  ok("under 6 innings: why there is no line, in the past", done.includes("There is no line: he batted fewer than 6 times that season, so each innings is shown on its own."), done);
  ok("...and never 'yet' or 'Until then'", !/\byet\b|Until then/.test(done));
  const thin = pts([50, 3, 4, 5, 2, 1].map((r, i) => raw(r, [60, 4, 4, 5, 5, 4][i], true, { season: "2025" })), "2025");
  const thinNote = trendNotes(thin, { current: false }).join(" ");
  ok("under 30 balls: the same, in the past", thinNote.includes("There is no line: his last five innings that season hold fewer than 30 balls faced, so each innings is shown on its own.") && !/Until then/.test(thinNote), thinNote);
  const sum = spokenSummary({ who: "X", season: "2025", points: four, current: false });
  ok("the summary: 'No line is drawn.', 'none, no dismissal'", /No line is drawn\./.test(sum) && !/\byet\b/.test(sum)
     && /Average none, no dismissal/.test(spokenSummary({ who: "X", season: "2025", points: pts([raw(4, 4, false, { season: "2025" })], "2025"), current: false })), sum);
  ok("this season keeps B3's words", /The line starts once he has batted 6 times this season\. Until then/.test(trendNotes(four).join(" "))
     && /No line is drawn yet\./.test(spokenSummary({ who: "X", season: "2025", points: four })));
  const html = view(rows([raw(9, 9, false, { season: "2025" }), raw(1, 1, false, { season: "2025" })]), { initial: { season: "2025" } });
  ok("the panel: 'no average', not 'no average yet', for a finished season", /no average\b/.test(text(html)) && !/no average yet/.test(text(html)) && !/\byet\b/.test(text(html)), text(html).slice(0, 300));
}

group("Analytics' picker waits for the roster, and says so (review S1)");
{
  const pick = (read, players = []) => renderToStaticMarkup(h(AnalyticsSeasonTrend, { role: "coach", players, read }));
  const loading = pick({ rows: [], loading: true, error: null, status: null });
  ok("loading: 'Reading the players…', never 'No player of this side'", /Reading the players/.test(text(loading)) && !/No player of this side/.test(text(loading)) && !/season-trend-player"/.test(loading), text(loading));
  const failed = pick({ rows: [], loading: false, error: "unreachable", status: null });
  ok("failed: 'Could not read the players', never 'No player'", /Could not read the players/.test(text(failed)) && !/No player of this side/.test(text(failed)), text(failed));
  const refused = pick({ rows: [], loading: false, error: "forbidden", status: 403 });
  ok("refused: 'Your role may not read the players'", /Your role may not read the players/.test(text(refused)) && !/No player of this side/.test(text(refused)), text(refused));
  const none = pick({ rows: [], loading: false, error: null, status: null });
  ok("answered with none: only then 'No player of this side that you may see'", /No player of this side that you may see/.test(text(none)));
  const two = pick({ rows: [{}, {}], loading: false, error: null, status: null }, [{ id: "a", name: "A One" }, { id: "b", name: "B Two" }]);
  ok("answered with players: the list, none picked, and the sentence that says so", /data-testid="season-trend-player"/.test(two) && /data-testid="season-trend-none-picked"/.test(two) && /A One/.test(two));
  const src = read("../src/views/seasontrend.jsx");
  ok("a new pick remounts the boy's panel, so the last boy's answer never flashes (review N5)", /<SeasonTrend key=\{who\.id\}/.test(src));
  ok("Analytics hands the roster read in", /<AnalyticsSeasonTrend [^\n]*read=\{CAREER\.players\}\/>/.test(read("../src/views/AnalyticsView.jsx")));
}

group("The family screens are quiet with no innings at all (review S4)");
{
  ok("answered, no rows: quiet", quietWhenEmpty({ loading: false, error: null, rows: [] }) === true);
  ok("loading: drawn, saying so", quietWhenEmpty({ loading: true, error: null, rows: [] }) === false);
  ok("failed: drawn, saying so", quietWhenEmpty({ loading: false, error: "unreachable", rows: [] }) === false);
  ok("innings: drawn", quietWhenEmpty({ loading: false, error: null, rows: [{}] }) === false);
  const fam = read("../src/views/family/family.jsx"), pup = read("../src/views/family/pupil.jsx"), v = read("../src/views/seasontrend.jsx");
  ok("the parent's Home and the Passport ask for it, the card inside the frame so none is left empty",
     /quietWhenNone\s+frame=\{\(panel\) => <Card label="Innings by innings" testid="family-trend">/.test(fam)
     && /quietWhenNone\s+frame=\{\(panel\) => <Card label="Innings by innings" testid="passport-trend">/.test(pup));
  ok("...and the panel returns nothing, frame and all, when quiet", /if \(quietWhenNone && quietWhenEmpty\(read\)\) return null;/.test(v));
  ok("Analytics does not: there a staff reader picked the boy, and the careful words stay", !/quietWhenNone/.test(read("../src/views/AnalyticsView.jsx"))
     && !/<SeasonTrend key=\{who\.id\}[^>]*quietWhenNone/.test(v));
}

group("A read with nothing, or refused, or failed: words, never an empty chart");
{
  const none = view([]);
  ok("no rows: said plainly, and claiming nothing about the record", /No innings for R Pillay that you may see\./.test(text(none))
     && !/data-testid="season-trend-chart"/.test(none), text(none));
  ok("...for the boy himself", /No innings of yours on record yet\./.test(text(view([], { self: true, who: "You" }))));
  const refused = renderToStaticMarkup(h(SeasonTrendView, { rows: [], who: "R Pillay",
    said: readState({ rows: [], loading: false, error: "forbidden", status: 403 }, { what: "R Pillay's innings" }) }));
  ok("a 403: 'Your role may not read …', no chart", /Your role may not read R Pillay's innings\./.test(text(refused)) && !/season-trend-chart/.test(refused), text(refused));
  const failed = renderToStaticMarkup(h(SeasonTrendView, { rows: [], who: "R Pillay", onRetry: () => {},
    said: readState({ rows: [], loading: false, error: "unreachable", status: null }, { what: "R Pillay's innings" }) }));
  ok("a failure: 'Could not read …', with a retry, no chart", /Could not read R Pillay's innings\./.test(text(failed)) && /Retry|Try again/i.test(text(failed)) && !/season-trend-chart/.test(failed), text(failed));
  const loading = renderToStaticMarkup(h(SeasonTrendView, { rows: [], who: "R Pillay",
    said: readState({ rows: [], loading: true, error: null, status: null }, { what: "R Pillay's innings" }) }));
  ok("loading: 'Reading …', no chart", /Reading R Pillay's innings/.test(text(loading)) && !/season-trend-chart/.test(loading));
}

group("The table and the spoken summary (GA-I31)");
{
  const list = [raw(10, 12, true), raw(20, 15, true), raw(30, 25, false), raw(0, 2, true), raw(40, 30, true), raw(5, 8, true, { book: true })];
  const p = pts(list);
  const t = trendTable({ who: "R Pillay", season: "2026", points: p });
  ok("one table, a row per innings, the same runs the chart draws", t.length === 1 && t[0].rows.length === 6 && t[0].rows.map((r) => r[2]).join() === p.map((x) => x.runs).join());
  ok("...with the line's column where the line is drawn, its values the line's", t[0].columns.includes(LINE_LABEL)
     && t[0].rows.map((r) => r[6]).join() === ",,,,20,19", JSON.stringify(t[0].rows.map((r) => r[6])));
  ok("...how out and where from, in words", t[0].rows[2][4] === "not out" && t[0].rows[0][4] === "out" && t[0].rows[5][5] === "scorebook");
  const noLine = trendTable({ who: "R Pillay", season: "2026", points: p.slice(0, 5) });
  ok("no line drawn: no line column", !noLine[0].columns.includes(LINE_LABEL));
  ok("a scorebook innings with no balls: a blank, not 0", trendTable({ who: "X", season: "2026", points: pts([raw(4, null, true, { book: true })]) })[0].rows[0][3] === null);
  const html = view(rows(list));
  ok("the panel carries a Show as table button, 44px", /data-testid="season-trend-table-toggle"/.test(html) && /Show as table/.test(html) && /min-height:44px/.test(html));
  const open = viewOpen(rows(list));
  ok("opened, it is a real table with a caption and row headers", /<caption[^>]*>R Pillay: runs in each innings, the 2026 school season<\/caption>/.test(open)
     && (open.match(/<th scope="row"/g) ?? []).length === 6, open.slice(open.indexOf("<table"), open.indexOf("<table") + 300));
  const s = spokenSummary({ who: "R Pillay", season: "2026", points: p });
  ok("the summary says the season's figures and each innings", /R Pillay, the 2026 school season: 6 innings, 105 runs, 1 not out\./.test(s)
     && /in order: 10, 20, 30 not out, 0, 40, 5\./.test(s), s);
  ok("...and the line, first and latest", /Runs an innings, last five innings: 20 at innings 5, 19 at innings 6\./.test(s), s);
  ok("...and says when no line is drawn", /No line is drawn yet\./.test(spokenSummary({ who: "X", season: "2026", points: p.slice(0, 3) })));
  const sumId = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  ok("the chart is an image whose description is the summary", !!sumId && new RegExp(`id="${sumId.replace(/[:]/g, "\\:")}" class="sr-only"`).test(html) && /role="img"/.test(html));
  ok("the summary in the page is the same sentence", text(html).includes(s.replace(/"/g, "")));
}

group("The chart's geometry");
{
  const p = pts([raw(10, 12, true), raw(20, 15, true), raw(30, 25, false), raw(0, 2, true), raw(40, 30, true), raw(5, 8, true)]);
  const g = chartGeometry(p, { w: 320, h: 140, pad: 12, draw: true });
  ok("the y axis runs from 0 to the season's most", g.top === 40 && g.dots[4].y === 12 && g.dots[3].y === 128);
  ok("x by innings, first to last across the width", g.dots[0].x === 12 && g.dots[5].x === 308);
  ok("the line sits at its innings", g.line.length === 2 && g.line[0].x === g.dots[4].x && g.line[1].x === g.dots[5].x);
  ok("no line asked for: none", chartGeometry(p, { w: 320, h: 140, pad: 12, draw: false }).line.length === 0);
  ok("one innings sits in the middle", chartGeometry(p.slice(0, 1), { w: 320, h: 140, pad: 12, draw: false }).dots[0].x === 160);
  const html = view(rows([raw(10, 12, true), raw(20, 15, true), raw(30, 25, false), raw(0, 2, true), raw(40, 30, true), raw(5, 8, true)]));
  ok("drawn: a polyline, and the panel says it is drawn", /data-testid="season-trend-line"/.test(html) && /data-line="drawn"/.test(html));
}

group("No verdict words (Q9)");
{
  const cases = [
    [], [raw(10, 12, true)],
    [raw(10, 12, true), raw(20, 15, true), raw(30, 25, false), raw(0, 2, true), raw(40, 30, true), raw(5, 8, true)],
    [raw(50, 60, true), raw(3, 4, true), raw(4, 4, true), raw(5, 5, true), raw(2, 5, true), raw(1, 4, true)],
    [raw(20, 18, true), raw(40, null, true, { book: true })],
  ];
  const said = cases.map((c) => text(viewOpen(rows(c)))).join(" ").toLowerCase()
    + " " + cases.map((c) => [...trendNotes(pts(c)), spokenSummary({ who: "X", season: "2026", points: pts(c) })].join(" ")).join(" ").toLowerCase();
  for (const w of VERDICT_WORDS) ok(`the panel never says "${w}"`, !new RegExp(`\\b${w}\\b`).test(said));
  ok("the list holds the design's words", ["in form", "improving", "declining", "best", "struggling"].every((w) => VERDICT_WORDS.includes(w)));
}

group("The floors, the style lock, and who it is for");
{
  const v = read("../src/views/seasontrend.jsx");
  const lib = read("../src/lib/seasonTrend.js");
  const sizes = [...v.matchAll(/fontSize:\s*"(\d+)px"/g)].map((m) => Number(m[1]));
  ok("nothing under 12px", sizes.every((n) => n >= 12) && !/fontSize:\s*"(?:[0-9]|1[01])px"/.test(v), sizes.join());
  ok("its controls are 44px", /minHeight: `\$\{T\.floor\.target\}px`/.test(v));
  ok("no animation or transition (reduced motion has nothing to stop)", !/transition|animation|@keyframes|requestAnimationFrame/.test(v));
  ok("colours are tokens: no hex in the view", !/#[0-9a-fA-F]{3,8}\b/.test(v));
  ok("no new dependency: React, the tokens and the app's own modules only",
     [...v.matchAll(/from "([^"]+)"/g)].every((m) => m[1] === "react" || m[1].startsWith(".")), [...v.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).join());
  ok("the figures do not read the network or a clock", !/fetch\(|Date\.now|new Date/.test(lib));
  ok("the read is made for one boy only, through useBoyRead", /useBoyRead\("innings_by_season", role, playerId/.test(v) && !/useLive\("innings_by_season"/.test(v));
  ok("signed out: no read and no panel, never a demonstration", /if \(!signedIn\(\) \|\| !playerId\) return null/.test(v) && !/demo/i.test(v.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  const an = read("../src/views/AnalyticsView.jsx");
  ok("Analytics draws it on the performance tab, signed in only", /\{signedIn\(\)&&<AnalyticsSeasonTrend /.test(an)
     && an.indexOf("<AnalyticsSeasonTrend") > an.indexOf('subView==="performance"') && an.indexOf("<AnalyticsSeasonTrend") < an.indexOf('subView==="phases"'));
  const fam = read("../src/views/family/family.jsx");
  ok("the parent's Home draws her child's, read for him alone (Q8)", /<SeasonTrend role=\{role\} playerId=\{child\.id\}/.test(fam));
  const pup = read("../src/views/family/pupil.jsx");
  ok("the pupil's Passport draws his own, and only his (Q7)", /<SeasonTrend role=\{role\} playerId=\{me\.id\} who="You" self/.test(pup)
     && (pup.match(/<SeasonTrend /g) ?? []).length === 1);
  ok("no public page imports it", !/seasontrend/.test(read("../src/public/PublicMatch.jsx")));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
