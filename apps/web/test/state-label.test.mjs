/**
 * The honesty labels (GA-I21): demo, practice, read only. One component
 * (ui/stateLabel.jsx), the same words wherever the state is shown.
 *
 * Held here:
 *
 *   - each kind renders its own words, with an icon, and carries its kind;
 *     a reason ("why") follows the words where one is given
 *   - the practice words are the practice screens' own, unchanged, and the
 *     practice test ids stay (practice-label, practice-saved)
 *   - there is no "official": a match's status has no such value and a result
 *     is read from the log (db/69), so the component does not offer one
 *   - nothing is drawn under 12px, in the component or in the practice label
 *   - the screens use it: the shell's banner, the Match Centre header, the
 *     Settings badge and the four read-only panels, with no ad-hoc "Demonstration"
 *     tag left beside them
 *   - the bowling-ceiling refusal has words for every code the route can
 *     answer, and Settings does not show ApiError.message
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/state-label.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { StateLabel, STATE_KINDS, STATE_WORDS } from "../src/ui/stateLabel.jsx";
import { PracticeLabel, PRACTICE_LABEL } from "../src/scorer/practiceLabel.jsx";
import { CEILING_WORDS, ceilingWords } from "../src/lib/ceilingWords.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 240)}`); } };
const group = (t) => console.log("\n" + t);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const apiError = (status, code, detail) => Object.assign(new Error(`${code} (/api/bowling-ceiling)`), { status, code, detail: detail ?? null });
const plain = (w) => typeof w === "string" && /\s/.test(w) && !/_/.test(w);

group("Each state says its words");
{
  ok("three kinds, in the order the brief names them", STATE_KINDS.join(",") === "demo,practice,readonly", STATE_KINDS.join(","));
  ok("there is no official kind: a result is read from the log, not stored", !("official" in STATE_WORDS) && !STATE_KINDS.includes("official"));
  const demo = renderToStaticMarkup(h(StateLabel, { kind: "demo" }));
  ok("demo says Demo", text(demo) === "Demo" && /data-state="demo"/.test(demo) && /data-testid="state-label-demo"/.test(demo), demo);
  const prac = renderToStaticMarkup(h(StateLabel, { kind: "practice" }));
  ok("practice says the practice words", text(prac) === "Practice match · kept on this phone", prac);
  const ro = renderToStaticMarkup(h(StateLabel, { kind: "readonly" }));
  ok("read only says Read only", text(ro) === "Read only" && /data-state="readonly"/.test(ro), ro);
  ok("each has an icon beside the words (colour is never the only signal)", [demo, prac, ro].every((x) => /<svg/.test(x)));
  ok("the words are the table's", STATE_KINDS.every((k) => text(renderToStaticMarkup(h(StateLabel, { kind: k }))) === STATE_WORDS[k]));
  ok("a kind nobody knows draws nothing, not a guess", renderToStaticMarkup(h(StateLabel, { kind: "official" })) === "" && renderToStaticMarkup(h(StateLabel, {})) === "");
}

group("The reason follows the words");
{
  const ro = renderToStaticMarkup(h(StateLabel, { kind: "readonly", why: "only this competition's organiser can change these" }));
  ok("read only, and why", /^Read only · only this competition(&#x27;|')s organiser can change these$/.test(text(ro)), text(ro));
  ok("...with its own test id", /data-testid="state-why-readonly"/.test(ro));
  const none = renderToStaticMarkup(h(StateLabel, { kind: "readonly", why: null }));
  ok("no reason, no empty line", !/state-why/.test(none));
  const d = renderToStaticMarkup(h(StateLabel, { kind: "demo", why: "invented fixtures and players" }));
  ok("demo, and what is invented", text(d) === "Demo · invented fixtures and players", text(d));
  const custom = renderToStaticMarkup(h(StateLabel, { kind: "readonly", testid: "listing-why", id: "listing-why-1" }));
  ok("a screen keeps its own test id and id (the walks and aria-describedby find them)", /data-testid="listing-why"/.test(custom) && /id="listing-why-1"/.test(custom));
}

group("Practice: the practice screens' words, through the shared component");
{
  ok("PRACTICE_LABEL is the shared practice words", PRACTICE_LABEL === STATE_WORDS.practice && PRACTICE_LABEL === "Practice match · kept on this phone");
  const p = renderToStaticMarkup(h(PracticeLabel, {}));
  ok("the label keeps its test id and starts with the words", /data-testid="practice-label"/.test(p) && text(p).startsWith(PRACTICE_LABEL), p);
  const s = renderToStaticMarkup(h(PracticeLabel, { saved: "10:42" }));
  ok("...and when it was last saved, on the same line", /data-testid="practice-saved"/.test(s) && /last saved 10:42/.test(text(s)), s);
  ok("compact is 12px, not smaller", /font-size:12px/.test(renderToStaticMarkup(h(PracticeLabel, { compact: true }))));
  const src = read("../src/scorer/practiceLabel.jsx");
  ok("the label is drawn by StateLabel, not a second copy", /<StateLabel kind="practice"/.test(src));
}

group("Nothing under 12px");
{
  for (const f of ["../src/ui/stateLabel.jsx", "../src/scorer/practiceLabel.jsx"]) {
    const px = [...read(f).matchAll(/fontSize:\s*(?:[a-z?: ]*)?"(\d+(?:\.\d+)?)px"/g)].map((m) => Number(m[1]));
    ok(`${f.split("/").pop()}: every font size is 12px or more`, px.length > 0 && px.every((n) => n >= 12), px.join(","));
  }
  const all = [...STATE_KINDS].flatMap((k) => [false, true].map((c) => renderToStaticMarkup(h(StateLabel, { kind: k, compact: c }))));
  const sizes = all.flatMap((x) => [...x.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])));
  ok("...and as drawn, in every kind and size", sizes.length === all.length && sizes.every((n) => n >= 12), sizes.join(","));
  ok("it is text, not a control: nothing in it can be tapped", all.every((x) => !/<button|<a |onclick|tabindex/i.test(x)));
}

group("The screens use it");
{
  const app = read("../src/App.jsx");
  const banner = app.slice(app.indexOf('data-testid="demo-banner"'), app.indexOf('data-testid="demo-banner-signin"'));
  ok("the shell's banner is the Demo label and one line of why", /<StateLabel kind="demo"/.test(banner) && !/<strong>Demonstration/.test(banner), banner.slice(0, 200));
  ok("Match Centre: the list's header says Demo when nobody is signed in", /signedIn\(\) \? "Live scores[^"]*" : <StateLabel kind="demo"/.test(read("../src/views/MatchCentreView.jsx")));
  ok("Match Centre: a match's header says Demo, with no second tag", /\{log\.demo && <StateLabel kind="demo" compact\/>\}/.test(read("../src/views/matchcentre/MatchView.jsx")));
  const settings = read("../src/views/SettingsView.jsx");
  ok("Settings: the badge is the Demo label", /<StateLabel kind="demo" compact\/>/.test(settings) && !/"Demo"\}<\/Badge>/.test(settings));
  ok("the day sheet says Demo, and the dashboard does not call a signed-in read a demonstration", /<StateLabel kind="demo" compact why=\{demoNote\}\/>/.test(read("../src/views/DashboardView.jsx")) && /live=\{matchesAreLive \|\| signedIn\(\)\}/.test(read("../src/views/DashboardView.jsx")));
  // GA-I23: the performance tab's invented figures are gone from a signed-in screen; what is
  // still a demonstration (the sample worm, the sample season bars) says Demo through the shared
  // line, which draws the StateLabel, and never as a Badge of its own.
  ok("Analytics' demonstrations carry the Demo label through the shared line, not a Badge of its own",
     /<SourceLine testid="source-line-worm" demo /.test(read("../src/views/demoworm.jsx")) && /<SourceLine testid="source-line-season-bars" demo=\{demo\}/.test(read("../src/views/seasonbars.jsx"))
       && !/<Badge color=\{D\.amber\}>demonstration/.test(read("../src/views/AnalyticsView.jsx")));
  ok("the scorer's home says Demo, not its own sentence", /<StateLabel kind="demo" compact why="no server connected"\/>/.test(read("../src/views/ScorerHomeView.jsx")) && !/Demonstration — no server/.test(read("../src/views/ScorerHomeView.jsx")));
  for (const [f, id] of [["planner", "pl-readonly"], ["people", "people-readonly"], ["playingconditions", "pc-readonly"]]) {
    const s = read(`../src/views/${f}.jsx`);
    const at = s.indexOf(`data-testid="${id}"`);
    ok(`${f}: a panel the person may read but not change says Read only, and why (${id})`, at > 0 && /<StateLabel kind="readonly" why="/.test(s.slice(at, at + 400)), s.slice(at, at + 200));
  }
  ok("the school's home-page listing says Read only, with its reason", /<StateLabel kind="readonly"[^>]*testid="listing-why"[^>]*why=\{LISTING_READ_ONLY_WHY\}/.test(read("../src/views/listing.jsx")));
}

group("The bowling-ceiling refusal is in words, for every code the route can answer");
{
  const route = read("../../../services/api/write/workload-api.mjs");
  const body = route.slice(route.indexOf("ceiling: handle"));
  const codes = new Set([
    ...[...route.matchAll(/err\("([a-z_]+)"/g)].map((m) => m[1]),
    ...[...route.matchAll(/overs\([^)]*"([a-z_]+_invalid)"\)/g)].map((m) => m[1]),
  ]);
  ok("the route names at least the four checks and not_permitted", ["school_required", "max_overs_per_spell_invalid", "max_overs_per_day_invalid", "a_ceiling_names_at_least_one_limit", "not_permitted"].every((c) => codes.has(c)), [...codes].join(" "));
  const missing = [...codes].filter((c) => !CEILING_WORDS[c]);
  ok("each code the route raises has words", missing.length === 0, missing.join(" "));
  // The route's wrapper answers these too (handle()).
  const wrapper = route.slice(route.indexOf("const handle ="), route.indexOf("return {"));
  const answered = [...wrapper.matchAll(/error: "([a-z_]+)"/g)].map((m) => m[1]);
  ok("the wrapper's own answers have words (refused, no_such_school, not_permitted)", answered.length >= 2 && /"not_permitted"/.test(wrapper) && answered.every((c) => CEILING_WORDS[c]), answered.join(" "));
  ok("...and so do the sign-in codes", CEILING_WORDS.missing_token && CEILING_WORDS.token_expired);
  const bad = Object.entries(CEILING_WORDS).filter(([, w]) => !plain(w));
  ok("every sentence is words, never a code", bad.length === 0, bad.map(([c]) => c).join(" "));
  for (const code of Object.keys(CEILING_WORDS)) {
    const w = ceilingWords(apiError(code === "not_permitted" ? 403 : 400, code));
    ok(`${code}: its own sentence, with no code and no path in it`, w === CEILING_WORDS[code] && !w.includes(code) && !/\/api\//.test(w), w);
  }
  ok("a code nobody has words for is not shown as a code", (() => { const w = ceilingWords(apiError(500, "odd_new_code")); return /not set/.test(w) && !/odd_new_code/.test(w); })());
  ok("the database's own message is not shown either", !/high school, not a/.test(ceilingWords(apiError(422, "refused", "an Open-band bowling ceiling applies to a high school, not a club"))));
  const gone = ceilingWords(new TypeError("Failed to fetch"));
  ok("no answer at all says the ceiling may or may not be set", /could not be reached/.test(gone) && /may or may not/.test(gone), gone);
  ok("the over limits say the range", /1 to 30/.test(CEILING_WORDS.max_overs_per_spell_invalid) && /1 to 60/.test(CEILING_WORDS.max_overs_per_day_invalid));
  ok("the route's range is the one the words give", /overs\(b\.maxOversPerSpell, 30,/.test(body) && /overs\(b\.maxOversPerDay, 60,/.test(body));
  const settings = read("../src/views/SettingsView.jsx");
  const save = settings.slice(settings.indexOf('"/api/bowling-ceiling"'), settings.indexOf('data-testid="open-ceiling"'));
  ok("Settings says the refusal in words, and not ApiError.message", /setSaid\(ceilingWords\(e\)\)/.test(save) && !/e\.message/.test(save), save.slice(-200));
  ok("...after the reply (the success line is set after the awaited call)", save.indexOf("await api(") < save.indexOf("setDone("));
  ok("...as an alert with a test id the walk reads", /role="alert" data-testid="ceiling-said"/.test(settings));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
