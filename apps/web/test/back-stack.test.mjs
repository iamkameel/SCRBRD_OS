/**
 * Back, named for where the person came from (DESIGN_DIRECTION §2.1; redesign
 * slice 12b, lib/backStack.js): the shell's trail of pages, the name each
 * Back shows, a direct link naming the fixed parent, the Match Centre's
 * address round trip, and nothing of a child kept. Plus the pad's key
 * (scorer/pad.jsx ExitKey) and its result screen's "Back to …", drawn.
 *
 * The browser walks show the same on screen: smoke-browser-matchcentre.mjs
 * (Today and Matches into one match, a direct link, the pad), -pupil and
 * -read (a notice's fixture), -live-from-pad (the pad's bar), -homes (Today's
 * headline).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/back-stack.test.mjs
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BackContext, TRAIL_MAX, cameInto, backTo, openedInside, pageName, startTrail, stopOf, trailStep, useCameFrom,
} from "../src/lib/backStack.js";
import { NAV_META } from "../src/design/roles.js";
import { appPath, parseAppPath } from "../src/lib/matchTabs.js";
import { ExitKey } from "../src/scorer/pad.jsx";
import { FinishGate } from "../src/scorer/finishMatch.jsx";
import { GLOBAL_CSS } from "../src/design/tokens.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

/** A run of moves from a fresh load on `page`. */
const run = (page, ...moves) => moves.reduce(trailStep, startTrail(page));
const go = (key, section = null) => ({ type: "go", key, section });
const BACK = { type: "back" };
const keys = (s) => s.trail.map((t) => t.key).join(",");
/** What a screen's Back says and does, given the trail App would hand it. */
const cameOf = (s, moved = []) => ({ from: s.trail[s.trail.length - 1] ?? null, back: () => moved.push("back") });

group("Push and pop");
{
  const fresh = startTrail();
  ok("a fresh load: Today, with nothing behind it", fresh.page === "dashboard" && fresh.trail.length === 0 && fresh.section === null);
  const s = run("dashboard", go("matches"));
  ok("Today, then Matches: Matches on screen, Today behind it", s.page === "matches" && keys(s) === "dashboard");
  const t = trailStep(s, BACK);
  ok("Back: Today again, and the trail is empty", t.page === "dashboard" && t.trail.length === 0);
  ok("Back with nothing behind changes nothing", trailStep(t, BACK) === t);
  const three = run("children", go("notices"), go("fixtures"));
  ok("a parent's Home, Notices, then Matches: two behind", three.page === "fixtures" && keys(three) === "children,notices");
  const one = trailStep(three, BACK);
  ok("...Back: Notices, with Home behind it", one.page === "notices" && keys(one) === "children");
  ok("...and Back again: Home", trailStep(one, BACK).page === "children" && trailStep(one, BACK).trail.length === 0);
  const sec = run("dashboard", go("logistics", "grounds"), go("fields"));
  ok("a section a link named goes with its page onto the trail", sec.trail[1]?.key === "logistics" && sec.trail[1]?.section === "grounds");
  const back = trailStep(sec, BACK);
  ok("...and comes back with it", back.page === "logistics" && back.section === "grounds");
  ok("the same page again is no move: the trail stays", run("dashboard", go("matches"), go("matches")).trail.length === 1);
  const resec = run("dashboard", go("logistics"), go("logistics", "transport"));
  ok("...a new section on the same page is not a page behind it", resec.page === "logistics" && resec.section === "transport" && keys(resec) === "dashboard");
}

group("A page is on the trail at most once, never the page on screen");
{
  const loop = run("dashboard", go("matches"), go("calendar"), go("matches"));
  ok("Today, Matches, Calendar, Matches: Matches leaves the trail, and Calendar, where he came from, is behind it", loop.page === "matches" && keys(loop) === "dashboard,calendar");
  ok("...so Back names Calendar, then Today", trailStep(loop, BACK).page === "calendar" && trailStep(trailStep(loop, BACK), BACK).page === "dashboard");
  const home = run("dashboard", go("matches"), go("dashboard"));
  ok("...and the menu's Today from Matches: Today leaves the trail, Matches is behind it", home.page === "dashboard" && keys(home) === "matches");
  let far = startTrail("dashboard");
  const all = Object.keys(NAV_META);
  for (let i = 0; i < 60; i++) far = trailStep(far, go(all[i % all.length]));
  ok(`never longer than ${TRAIL_MAX}, never the page on screen, no page twice`,
     far.trail.length <= TRAIL_MAX && !far.trail.some((t) => t.key === far.page) && new Set(far.trail.map((t) => t.key)).size === far.trail.length, keys(far));
}

group("The name shown: the menu's own word");
{
  ok("Today is Today, Matches is Matches, a parent's and a pupil's Home is Home", pageName("dashboard") === "Today" && pageName("matches") === "Matches"
     && pageName("children") === "Home" && pageName("myhome") === "Home" && pageName("fixtures") === "Matches" && pageName("notices") === "Notices");
  ok("every name is the menu's label (design/roles.js NAV_META)", Object.entries(NAV_META).every(([k, m]) => pageName(k) === m.label));
  ok("a key the menu has no word for has no name", pageName("nowhere") === null && pageName(null) === null && pageName("constructor") === null);
  const fromToday = run("dashboard", go("matches"));
  const moved = [];
  const b = backTo({ here: "matches", arrived: true, came: cameOf(fromToday, moved), close: () => moved.push("close") });
  ok("Today, then a match Today opened: Back reads Today", b.name === "Today" && b.away === true);
  b.go();
  ok("...and goes back to Today, not to the list", moved.join() === "back");
  const fromList = run("dashboard", go("matches"));
  const m2 = [];
  const b2 = backTo({ here: "matches", arrived: false, came: cameOf(fromList, m2), close: () => m2.push("close") });
  ok("Matches, then the same match from its list: Back reads Matches", b2.name === "Matches" && b2.away === false);
  b2.go();
  ok("...and closes to the list", m2.join() === "close");
  const notice = run("children", go("notices"), go("fixtures"));
  ok("a parent's notice, then its fixture: Back reads Notices", backTo({ here: "fixtures", arrived: true, came: cameOf(notice), close: () => {} }).name === "Notices");
  ok("...a fixture from her Home's card names Home", backTo({ here: "children", close: () => {} }).name === "Home");
  ok("a key with no word still says Back, never nothing", backTo({ here: "nowhere", close: () => {} }).name === "Back");
}

group("A direct link names the fixed parent");
{
  // A link to /app/matches/:id signed in: the shell's page is replaced, not moved to (App.jsx), so nothing is behind it.
  const link = run("dashboard", { type: "forget" }, { type: "replace", key: "dashboard" }, { type: "replace", key: "matches" });
  ok("arriving on a link: the Match Centre, nothing behind it", link.page === "matches" && link.trail.length === 0);
  const moved = [];
  const b = backTo({ here: "matches", arrived: true, came: cameOf(link, moved), close: () => moved.push("close") });
  ok("...its fixture's Back reads Matches, the fixed parent", b.name === "Matches" && b.away === false);
  b.go();
  ok("...and closes to the list, as it always did", moved.join() === "close");
  ok("a news post's link names the Newsfeed", backTo({ here: "news", arrived: true, came: { from: null, back: null }, close: () => {} }).name === "Newsfeed");
  const restored = run("dashboard", { type: "replace", key: "fixtures" });
  ok("a session restored on its page is not a move: nothing behind it", restored.page === "fixtures" && restored.trail.length === 0);
  const pageBefore = run("dashboard", go("calendar"), { type: "replace", key: "dashboard" });
  ok("a page sent home (switched off) leaves no stop for the page it replaced", pageBefore.page === "dashboard" && pageBefore.trail.length === 0);
  const newRole = trailStep(run("dashboard", go("matches"), go("squad")), { type: "forget" });
  ok("a new role, or a new person: the trail starts again", newRole.trail.length === 0 && newRole.page === "squad");
}

group("The Match Centre's address round trip still works");
{
  const id = "77777777-0000-0000-0000-000000000042";
  for (const tab of [null, "scorecard", "commentary", "coach"]) {
    const back = parseAppPath(appPath(id, tab));
    ok(`${tab ?? "the bare address"}: the address reads back to the fixture`, back?.matchId === id && (tab === null || back.tab === tab), back);
  }
  openedInside("matches", null);
  ok("a fixture its address names on mounting, with no note: arrived at", cameInto("matches", parseAppPath(appPath(id, "scorecard"))?.matchId));
  openedInside("matches", id);
  ok("...one the list opened, found again by its address once the pad closes over it: opened here", !cameInto("matches", parseAppPath(appPath(id, "scorecard"))?.matchId));
  ok("...another fixture's address: arrived at", cameInto("matches", "77777777-0000-0000-0000-000000000043"));
  ok("...a note from another page (Today's card, a notice) is an arrival whatever the list opened", cameInto("matches", id, { door: true }));
  ok("...the list itself (no fixture) is no arrival", !cameInto("matches", null));
  openedInside("matches", null);
  ok("...and closing it forgets it", cameInto("matches", id));
  ok("moving the trail reads no address and writes none: the moves are plain values", typeof globalThis.window === "undefined"
     && JSON.stringify(run("dashboard", go("matches"), BACK)) === JSON.stringify(startTrail("dashboard")));
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  ok("App still pushes a fixture's address for Watch the score and the menu's Matches, and listens for the back button",
     /pushState\(null, "", `\/app\/matches\/\$\{encodeURIComponent\(id\)\}`/.test(app) && /pushState\(null, "", "\/app\/matches"/.test(app)
     && (app.match(/addEventListener\("popstate", popped\)/g) ?? []).length === 2);
  ok("...and arriving on an address replaces the page; only the back button moves it", /\(arrive \? replacePage : setPage\)\("matches"\)/.test(app)
     && /\(arrive \? replacePage : setPage\)\(THING_PAGE\[t\.kind\]\)/.test(app));
  const news = readFileSync(new URL("../src/views/NewsView.jsx", import.meta.url), "utf8");
  ok("NewsView still closes a post it pushed with the browser's own back", /window\.history\.back\(\)/.test(news));
}

group("Nothing of a child is kept");
{
  const s0 = trailStep(startTrail("profiles"), go("matches"));
  const stop = stopOf("profiles", "career");
  ok("a stop is a key, a section and the menu's word, and nothing else", JSON.stringify(Object.keys(stop)) === JSON.stringify(["key", "section", "name"]) && stop.name === "Profiles");
  const handed = /** @type {any} */ ({ type: "go", key: "matches", section: null, child: "R Pillay", name: "R Pillay", player: "aaaaaaaa-0000-0000-0000-000000000001" });
  const s1 = trailStep(startTrail("profiles"), handed);
  ok("a move that carries a boy's name or id stores neither", JSON.stringify(s1).includes("Pillay") === false && JSON.stringify(s1).includes("aaaaaaaa") === false
     && JSON.stringify(s1) === JSON.stringify(s0));
  ok("...nor does a section that is not a word", stopOf("squad", /** @type {any} */ ({ child: "R Pillay" })).section === null);
  const names = new Set(Object.values(NAV_META).map((m) => m.label));
  let far = startTrail();
  for (const k of Object.keys(NAV_META)) far = trailStep(far, go(k));
  ok("every name ever on the trail is one of the menu's words", far.trail.every((t) => names.has(t.name) && t.name === NAV_META[t.key].label));
  const src = readFileSync(new URL("../src/lib/backStack.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok("the module keeps nothing on the device: no storage, no IndexedDB, no cookie, no history state",
     !/localStorage|sessionStorage|indexedDB|document\.cookie|history\.(push|replace)State|saveSession/.test(src));
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const save = app.slice(app.indexOf("saveSession({"), app.indexOf("}, [appState, role, userName, page"));
  ok("...and the shell's saved session carries the page, never the trail", save.length > 0 && !/trail|here\b/.test(save), save.slice(0, 120));
  const inside = readFileSync(new URL("../src/lib/backStack.js", import.meta.url), "utf8");
  ok("what a page opened inside itself is an id in memory, by page key", /const inside = new Map\(\)/.test(inside) && /inside\.set\(page, String\(id\)\)/.test(inside));
}

group("The screens read it: the context");
{
  function Reads() { const c = useCameFrom(); return h("span", { "data-from": c.from?.name ?? "none" }, c.back ? "can go back" : "no way back"); }
  const bare = renderToStaticMarkup(h(Reads));
  ok("with no shell around it: nowhere, and no way back", /data-from="none"/.test(bare) && /no way back/.test(bare));
  const s = run("dashboard", go("matches"));
  const inShell = renderToStaticMarkup(h(BackContext.Provider, { value: { from: s.trail[0], back: () => {} } }, h(Reads)));
  ok("under the shell: Today, and the way back", /data-from="Today"/.test(inShell) && /can go back/.test(inShell));
}

group("The pad's bar: Back, named for where he came from");
{
  const bar = renderToStaticMarkup(h(ExitKey, { onExit: () => {}, inBar: true, to: "Today" }));
  ok("in the bar: ‹ Today, the glyph hidden from a screen reader", /<span aria-hidden="true" class="os-exit-glyph"[^>]*>‹<\/span>Today<\/button>/.test(bar), bar);
  ok("...its accessible name starts with the words it shows", /aria-label="Today: leave the scorer"/.test(bar));
  ok("...44 tall, at least 44 wide, on one line, its words at 15px", /min-width:44px/.test(bar) && /height:44px/.test(bar) && /white-space:nowrap/.test(bar) && /font-size:15px/.test(bar));
  ok("...the test id the walks know it by", /data-testid="exit-scorer"/.test(bar) && /class="os-exit-scorer pressBtn"/.test(bar));
  const m = renderToStaticMarkup(h(ExitKey, { onExit: () => {}, inBar: true, to: "Matches" }));
  ok("from the Match Centre: ‹ Matches", />‹<\/span>Matches<\/button>/.test(m) && /aria-label="Matches: leave the scorer"/.test(m));
  const none = renderToStaticMarkup(h(ExitKey, { onExit: () => {}, inBar: true }));
  ok("with no name handed it: Back, never a bare glyph", />‹<\/span>Back<\/button>/.test(none) && /aria-label="Back: leave the scorer"/.test(none));
  const floating = renderToStaticMarkup(h(ExitKey, { onExit: () => {}, to: "Today" }));
  ok("floating on the setup and result screens: the same words", />‹<\/span>Today<\/button>/.test(floating) && !/SCRBRD OS/.test(floating));
  ok("no way out, no key", renderToStaticMarkup(h(ExitKey, { onExit: null, to: "Today" })) === "");
  ok("where the bar is narrow the glyph goes and the word stays", /@media\(max-width:359px\)\{\.os-exit-scorer \.os-exit-glyph\{display:none\}\}/.test(GLOBAL_CSS)
     && !/\.os-exit-scorer\{[^}]*display:none/.test(GLOBAL_CSS));
  const done = renderToStaticMarkup(h(FinishGate, { offer: "done", onBack: () => {}, backTo: "Matches", balls: 6 }));
  ok("the result screen's one primary names it too: Back to Matches", /data-testid="pad-done-back"[^>]*>Back to Matches<\/button>|>Back to Matches</.test(done), done.slice(0, 300));
  const today = renderToStaticMarkup(h(FinishGate, { offer: "done", onBack: () => {}, balls: 6 }));
  ok("...and Back to Today where nothing named it", />Back to Today</.test(today));
}

console.log(`\nBACK STACK: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
