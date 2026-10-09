/**
 * One line that says what an analysis panel's figures stand on (GA-I22):
 * source, scope, window and denominator, in plain words, and an honest word
 * when the denominator is small or nothing.
 *
 * Held here:
 *
 *   - each part renders under its own label, in the order Source, Scope,
 *     Window, Basis; a part the panel does not have is left out, not guessed
 *   - the denominator says its count with the right noun ("1 ball", "214
 *     balls"), a detail clause when the panel has one, and thousands with a
 *     space
 *   - zero says so ("No balls on record yet, so there is nothing to read
 *     here") and small says so ("Only 8 balls, fewer than the 30 this
 *     needs"), each with an icon and its own level, never colour alone; a
 *     panel with no floor of its own is never called small
 *   - a demonstration says "Demo" through the shell's StateLabel, claims no
 *     source and no basis, and keeps the scope and window it was given
 *   - nothing is drawn under 12px, in the component or in the helpers
 *   - dates are read as written (a match on the 4th is not the 3rd), a window
 *     is one day or a span, and a row with no date adds none
 *   - the screens use it: Analytics' five tabs, League's ladder, performers
 *     and awards, the profile's career tab and wheel, the season archive, with
 *     none of the per-view ad-hoc lines left beside it
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/source-line.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceLine, denominatorWords, sourceParts, SOURCE_LABELS, LEVELS } from "../src/ui/sourceLine.jsx";
import {
  SRC_BALLS, SRC_ENTERED, SRC_FIXTURES, SRC_RECORD, SRC_RESULTS, WINDOW_ALL,
  ballsFacedBasis, dateWindow, isoDay, seasonWindow,
} from "../src/lib/sourceWords.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 260)}`); } };
const group = (t) => console.log("\n" + t);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const line = (props) => renderToStaticMarkup(h(SourceLine, props));

group("Each part says its words, in order");
{
  ok("four labels, in the order the line reads", Object.values(SOURCE_LABELS).join(",") === "Source,Scope,Window,Basis");
  const html = line({ source: SRC_BALLS, scope: "1XI", window: "This season", denominator: { n: 214, unit: "ball" } });
  ok("all four parts, under their labels",
    text(html) === "Source Scored balls Scope 1XI Window This season Basis From 214 balls.", text(html));
  ok("each part has its own hook for a walk", ["source", "scope", "window", "basis"].every((k) => html.includes(`data-part="${k}"`)));
  const order = ["source", "scope", "window", "basis"].map((k) => html.indexOf(`data-part="${k}"`));
  ok("...in that order", order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), order.join(","));
  ok("the default test id", /data-testid="source-line"/.test(html) && /data-level="ok"/.test(html));
  const named = line({ source: "x", testid: "source-line-h2h" });
  ok("a panel can name its own", /data-testid="source-line-h2h"/.test(named));
  const bare = line({ source: SRC_BALLS });
  ok("a part the panel does not have is left out, not guessed", text(bare) === "Source Scored balls" && !/data-part="(scope|window|basis)"/.test(bare), text(bare));
  ok("a line with nothing to say draws nothing", line({}) === "" && line({ source: null, scope: null, window: null, denominator: null }) === "");
  const note = line({ source: SRC_BALLS, children: "Nothing here is stored." });
  ok("a sentence that is the panel's alone follows the parts", /data-part="note"/.test(note) && text(note).endsWith("Nothing here is stored."), text(note));
  ok("...and a note alone is still a line", text(line({ children: "Only this." })) === "Only this.");
  const parts = sourceParts({ source: "a", scope: "b", window: "c", denominator: { n: 3, unit: "innings", plural: "innings" } });
  ok("the parts are readable without rendering", parts.map((p) => p.key).join(",") === "source,scope,window,basis" && parts[3].text === "From 3 innings.", JSON.stringify(parts));
}

group("The denominator, in words");
{
  ok("214 balls", denominatorWords({ n: 214, unit: "ball" })?.text === "From 214 balls.");
  ok("one is not 'balls'", denominatorWords({ n: 1, unit: "ball", floor: 1 })?.text === "From 1 ball.", denominatorWords({ n: 1, unit: "ball" })?.text);
  ok("a plural that is not unit + s", denominatorWords({ n: 6, unit: "innings", plural: "innings" })?.text === "From 6 innings." && denominatorWords({ n: 1, unit: "innings", plural: "innings" })?.text === "From 1 innings.");
  ok("a detail clause follows the count", denominatorWords({ n: 14, unit: "completed fixture", detail: "9 of them decided" })?.text === "From 14 completed fixtures, 9 of them decided.");
  ok("thousands with a space", /^From 12\s400 balls\.$/.test((denominatorWords({ n: 12400, unit: "ball" })?.text ?? "").replace(/ /g, " ")), denominatorWords({ n: 12400, unit: "ball" })?.text);
  ok("a whole number under ten thousand is left as it is", denominatorWords({ n: 9999, unit: "ball" })?.text === "From 9999 balls.");
  ok("no denominator, none said", denominatorWords(null) === null && denominatorWords(undefined) === null);
  ok("a count that is not a number is not said", denominatorWords({ unit: "ball" }) === null && denominatorWords({ n: NaN, unit: "ball" }) === null && denominatorWords({ n: "12", unit: "ball" }) === null && denominatorWords({ n: -3, unit: "ball" }) === null);
  ok("levels are the four the walks read", LEVELS.join(",") === "ok,small,zero,unknown");
}

group("Zero and small are said, not drawn as a confident figure");
{
  const z = denominatorWords({ n: 0, unit: "ball" });
  ok("zero: nothing on record, nothing to read", z?.level === "zero" && z.text === "No balls on record yet, so there is nothing to read here.", z?.text);
  ok("...the detail clause is not tacked onto 'nothing'", denominatorWords({ n: 0, unit: "ball", detail: "of 300 in the log" })?.text === z.text);
  ok("...with the plural of a unit that has one", denominatorWords({ n: 0, unit: "innings", plural: "innings" })?.text === "No innings on record yet, so there is nothing to read here.");
  const s = denominatorWords({ n: 8, unit: "ball", floor: 30 });
  ok("small: how few, and what it needs", s?.level === "small" && s.text === "Only 8 balls, fewer than the 30 this needs. A guide, not a result.", s?.text);
  ok("...at the floor itself it is enough", denominatorWords({ n: 30, unit: "ball", floor: 30 })?.level === "ok" && denominatorWords({ n: 29, unit: "ball", floor: 30 })?.level === "small");
  ok("...a panel with no floor of its own is never called small", denominatorWords({ n: 2, unit: "ball" })?.level === "ok");
  ok("...a single ball is 'ball'", /^Only 1 ball,/.test(denominatorWords({ n: 1, unit: "ball", floor: 30 })?.text));
  const u = denominatorWords({ unknown: true });
  ok("unknown: said out loud for a panel that should have a count", u?.level === "unknown" && /not stated by this read/.test(u.text), u?.text);

  const zero = line({ source: SRC_BALLS, denominator: { n: 0, unit: "ball" } });
  ok("a zero line carries its level and its words", /data-level="zero"/.test(zero) && /nothing to read here/.test(text(zero)), text(zero));
  ok("...and an icon beside them, so it is never colour alone", /<svg/.test(zero));
  const small = line({ source: SRC_BALLS, denominator: { n: 8, unit: "ball", floor: 30 } });
  ok("a small line carries its level, words and icon", /data-level="small"/.test(small) && /Only 8 balls/.test(text(small)) && /<svg/.test(small), text(small));
  const fine = line({ source: SRC_BALLS, denominator: { n: 214, unit: "ball", floor: 30 } });
  ok("a sound count has no warning icon", /data-level="ok"/.test(fine) && !/<svg/.test(fine));
  ok("the warning is on the basis alone, not on the source", !/data-part="source"[^>]*>[^]*?<svg[^]*?data-part="scope"/.test(small) && small.indexOf("<svg") > small.indexOf('data-part="basis"'));
}

group("A demonstration says Demo and claims no source");
{
  const d = line({ demo: true, source: SRC_RECORD, scope: "1XI, one bar per player", window: WINDOW_ALL, denominator: { n: 500, unit: "ball" } });
  ok("Demo, through the shell's label", /data-testid="state-label-demo"/.test(d) && /data-state="demo"/.test(d) && /^Demo\b/.test(text(d)), text(d));
  ok("...no source claimed", !/Scored balls|Source/.test(text(d)), text(d));
  ok("...no basis claimed", !/Basis|From 500/.test(text(d)), text(d));
  ok("...the scope and window the screen has are kept", /Scope 1XI, one bar per player/.test(text(d)) && /Window Every season on record/.test(text(d)), text(d));
  const w = line({ demo: true, demoWhy: "sample players" });
  ok("...and why, where the screen says", /Demo · sample players/.test(text(w)), text(w));
  ok("a bare demonstration is still a line", text(line({ demo: true })) === "Demo");
  ok("it is marked, for a walk", /data-demo="true"/.test(d));
}

group("Nothing is drawn under 12px");
{
  const all = [
    line({ source: SRC_BALLS, scope: "a", window: "b", denominator: { n: 8, unit: "ball", floor: 30 }, children: "note" }),
    line({ demo: true, scope: "a" }),
    line({ source: SRC_BALLS, denominator: { n: 0, unit: "ball" } }),
  ].join("");
  const sizes = [...all.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  ok("every rendered size is at least 12px", sizes.length >= 3 && sizes.every((s) => s >= 12), sizes.join(","));
  const code = read("../src/ui/sourceLine.jsx");
  ok("...and the file sets none below it", !/fontSize:\s*["'`]?(?:[0-9]|1[01])(?:\.\d+)?px/.test(code) && /T\.floor\.read/.test(code));
  ok("tokens only: no hex colour and no rgb() in the component", !/#[0-9a-fA-F]{3,8}\b/.test(code.replace(/\/\*[^]*?\*\//g, "")) && !/rgba?\(/.test(code));
  ok("it is a line to read, not a control", !/<button|onClick|tabIndex/.test(code));
}

group("Dates are read as written");
{
  ok("a day, as the match was played", isoDay("2026-10-04") === "4 Oct 2026" && isoDay("2026-10-04T23:30:00+02:00") === "4 Oct 2026" && isoDay("2026-01-09") === "9 Jan 2026");
  ok("not a date, not a day", isoDay(null) === null && isoDay("soon") === null && isoDay("2026-13-01") === null && isoDay(20261004) === null);
  ok("one day is one day", dateWindow(["2026-10-04T09:00:00Z", "2026-10-04"]) === "4 Oct 2026");
  ok("a span in one year says the year once", dateWindow(["2026-10-04", "2026-03-12", "2026-05-01"]) === "12 Mar to 4 Oct 2026", dateWindow(["2026-10-04", "2026-03-12"]));
  ok("a span across years says both", dateWindow(["2026-02-01", "2025-11-20"]) === "20 Nov 2025 to 1 Feb 2026");
  ok("a row with no date adds none; no dates, no window", dateWindow([null, undefined, "n/a", "2026-03-12"]) === "12 Mar 2026" && dateWindow([null, "x"]) === null && dateWindow([]) === null && dateWindow(undefined) === null);
  ok("a season is named as the school year", seasonWindow("2026") === "The 2026 school season" && seasonWindow(null) === null && seasonWindow("") === null);
}

group("The balls behind a list of career rows");
{
  const rows = [{ live: true, ballsFaced: 120 }, { live: true, ballsFaced: 94 }, { live: true, ballsFaced: null }];
  const b = ballsFacedBasis(rows);
  ok("the sum of the balls the scorebooks gave, and how many players", b?.n === 214 && b.unit === "ball faced" && /^3 players, as far as the scorebooks recorded them$/.test(b.detail), JSON.stringify(b));
  ok("...worded", denominatorWords(b)?.text === "From 214 balls faced, 3 players, as far as the scorebooks recorded them.", denominatorWords(b)?.text);
  ok("a demonstration carries no career figure: no basis, not nought", ballsFacedBasis([{ name: "x" }, { name: "y", live: false }]) === null && ballsFacedBasis([]) === null && ballsFacedBasis(undefined) === null);
  ok("a player row whose career read has not answered says nothing, not nought", ballsFacedBasis([{ live: true }]) === null);
  ok("a player with no balls recorded counts nought balls (and the line says so)", denominatorWords(ballsFacedBasis([{ live: true, ballsFaced: null }]))?.level === "zero");
  ok("a floor the panel applies is passed through", ballsFacedBasis(rows, 300)?.floor === 300 && denominatorWords(ballsFacedBasis(rows, 300))?.level === "small" && !("floor" in ballsFacedBasis(rows)));
  ok("one player is not 'players'", /^1 player,/.test(ballsFacedBasis([{ live: true, ballsFaced: 5 }]).detail));
}

group("The sources are the reads' own");
{
  ok("scored balls, and the career mix said as a mix", SRC_BALLS === "Scored balls" && SRC_RECORD === "Scored balls and scorebook imports");
  ok("the ladder's two bases and the fixtures", SRC_RESULTS === "Match results" && SRC_ENTERED === "The schools' own entries" && SRC_FIXTURES === "Completed fixtures");
  const lib = read("../src/lib/sourceWords.js");
  ok("the helpers set no font size at all", !/font-?size/i.test(lib));
}

group("The screens use it, with no per-view line left beside it");
{
  const an = read("../src/views/AnalyticsView.jsx");
  ok("Analytics imports it", /import \{ SourceLine \} from "\.\.\/ui\/sourceLine\.jsx"/.test(an));
  for (const id of ["performance", "table", "h2h", "matchups", "phases"]) ok(`Analytics: the ${id} tab has a line`, new RegExp(`testid="source-line-${id}"`).test(an));
  ok("Analytics: the Demo figures sentence is gone from the head-to-head", !/Demo figures, no server connected/.test(an));
  ok("Analytics: the 10px note under the phases is gone", !/fontSize:"10px",color:D\.textMuted,lineHeight:1\.6,maxWidth:"680px"/.test(an));
  ok("Analytics: the coverage sentence is the line's note, at 12px, and not a div of its own", !/fontSize:"11px",color:D\.textSecondary,marginTop:"10px",lineHeight:1\.6/.test(an));
  ok("Analytics: the head-to-head still says it is derived (the dossier walk reads it)", /Derived from completed fixtures you may see/.test(an));
  // GA-I23: the performance tab's blanket "illustrative" card is gone with the
  // invented arrays; Demo is said by the panels that draw a demonstration.
  ok("Analytics: the blanket illustrative card on the performance tab is gone (GA-I23)", !/These figures are illustrative/.test(an) && !/<StateLabel kind="demo" compact\/>/.test(an));
  const lg = read("../src/views/LeagueView.jsx");
  ok("League imports it", /import \{ SourceLine \} from "\.\.\/ui\/sourceLine\.jsx"/.test(lg));
  for (const id of ["ladder", "ladder-demo", "performers"]) ok(`League: ${id} has a line`, new RegExp(`testid="source-line-${id}"`).test(lg));
  ok("League: the awards scope is a line, keeping the id the awards walk reads", /<SourceLine testid="awards-season-scope"/.test(lg) && !/<div data-testid="awards-season-scope"/.test(lg));
  ok("League: the awards line carries the package's sample floor, not a second one", /MIN_BALLS_FACED/.test(lg) && !/\b30\b[^\n]*ballsFacedBasis/.test(lg));
  ok("League: the ladder's basis sentence is the standings words, not a copy", /basisWords\(rows\[0\]\.basis\)/.test(lg) && !/As the schools entered it: the league's points are not confirmed yet\.["`]/.test(lg));
  ok("League: the ladder keeps its basis test id", /data-testid="ladder-basis"/.test(lg));
  const pr = read("../src/views/ProfilesView.jsx");
  for (const id of ["career", "batting", "bowling", "wagon"]) ok(`Profiles: ${id} has a line`, new RegExp(`testid="source-line-${id}"`).test(pr));
  ok("Profiles: the dismissal cards have one", /testid=\{`\$\{testId\}-source`\}/.test(pr));
  ok("Profiles: the floors are the package's", /MIN_BALLS_FACED/.test(pr) && /MIN_BALLS_BOWLED/.test(pr));
  const sh = read("../src/views/SeasonHistoryView.jsx");
  ok("The season archive's ladders have one", /testid=\{`source-line-season-ladder-\$\{comp\.id\}`\}/.test(sh));
  // The public pages must not pull it in: the only importers are the signed-in views.
  const importers = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}${e.name}`;
      if (e.isDirectory()) walk(`${rel}/`);
      else if (/\.(jsx?|mjs)$/.test(e.name) && /ui\/sourceLine\.jsx|sourceWords\.js/.test(read(rel))) importers.push(rel.replace("../src/", ""));
    }
  };
  walk("../src/");
  ok("only the signed-in views import it", importers.length > 0 && importers.every((f) => /^(views\/(AnalyticsView|LeagueView|ProfilesView|SeasonHistoryView|seasonbars|demoworm)\.jsx|lib\/seasonBars\.js|ui\/sourceLine\.jsx|lib\/sourceWords\.js)$/.test(f)), importers.join(" "));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
