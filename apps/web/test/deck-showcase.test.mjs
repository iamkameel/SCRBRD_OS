/**
 * The pitch deck's live slides (views/pitchdeck/): the app's own screens, drawn
 * on demonstration data, in frames nobody can operate.
 *
 * The browser walk (tools/smoke-browser-deck.mjs) holds the slides to what a
 * viewer sees and cannot do. This is what can be said without a browser:
 *
 *   - the demonstration match is a real ball log, folded by the scoring
 *     package: a ten-over innings sealed, a chase part-way through, the same
 *     match at every showing;
 *   - the showcase reads nothing: none of the three files that build it
 *     imports the API client or the live reader, so drawing it cannot ask a
 *     server for anything (the components it draws import them for the
 *     writes they were always able to make, and the rows handed to those are
 *     marked `demo`, which the write sites refuse);
 *   - every slide draws the components' own test ids, and every frame says it
 *     is inert;
 *   - the pad opens on Shot unless it is told otherwise, so the `preset` the
 *     deck passes changes nothing on a ground;
 *   - the scorebook slide's card is one the scoring package would accept
 *     (summaryRefusal: the sums, the names), so the deck never shows a card
 *     the product would refuse;
 *   - the day sheet's demonstration data has every section's rows, and
 *     DashboardView still hands DaySheet what it reads.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/deck-showcase.test.mjs
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { KIND, summaryRefusal } from "@scrbrd/scoring";
import { buildMatch, buildDaySheet, CONSENT_ROWS, SAFEGUARDING, SCOREBOOK, SCOREBOOK_CARD } from "../src/views/pitchdeck/demo.js";
import Showcase, { SHOWCASE_IDS } from "../src/views/pitchdeck/Showcase.jsx";
import { Pad } from "../src/scorer/pad.jsx";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

group("The demonstration match is a real log, folded");
const m = buildMatch();
const [first, second] = m.played;
ok("two innings", m.played.length === 2);
ok("the first is a sealed ten-over innings", first.complete === true && first.balls === 60 && first.wickets === 5, [first.complete, first.balls, first.wickets]);
ok("the second is a chase in progress", second.complete !== true && second.balls === 33 && second.wickets === 2, [second.complete, second.balls, second.wickets]);
ok("its target is the first innings' total and one", m.target === first.runs + 1);
ok("the chase is live: runs still needed, balls still left", m.target - second.runs > 0 && second.balls < 60);
ok("nobody has won yet", m.result === null);
ok("the events are the scoring package's own kinds", m.events.every((e) => Object.values(KIND).includes(e.kind)));
ok("every event has an id, so it could be voided", m.events.every((e) => typeof e.id === "string"));
ok("the commentary is the generator's, from the log", m.commentary.length > 50 && m.commentary.every((c) => typeof c.text === "string" && c.text.length > 0));
ok("the pad's undo says what it would take back, in words", typeof m.undoWhat === "string" && m.undoWhat.length > 0, m.undoWhat);
const again = buildMatch();
ok("the same match at every showing", JSON.stringify(again.events) === JSON.stringify(m.events));

group("Nothing here reads a server");
for (const f of ["demo.js", "Showcase.jsx", "Device.jsx", "ScorebookPhoto.jsx"]) {
  const src = readFileSync(new URL(`../src/views/pitchdeck/${f}`, import.meta.url), "utf8");
  ok(`${f} does not import the API client or the live reader`, !/from\s+["'][^"']*lib\/(api|live)\.js["']/.test(src));
  ok(`${f} makes no request of its own`, !/\bfetch\s*\(|\bXMLHttpRequest\b|\bapi\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")));
}
ok("every consent row the deck draws is marked demo, so the write site refuses it", [CONSENT_ROWS.ask, ...CONSENT_ROWS.section, CONSENT_ROWS.eighteen, CONSENT_ROWS.self].every((r) => r.demo === true));
ok("the safeguarding contacts point nowhere real", SAFEGUARDING.contacts.guardianAppUrl === "#");
const wc = readFileSync(new URL("../src/views/healthconsent.jsx", import.meta.url), "utf8");
const sg = readFileSync(new URL("../src/views/SafeguardingView.jsx", import.meta.url), "utf8");
ok("the consent row refuses a demo row before it reaches the API", /if \(c\.demo\) return;\s*setBusy\(true\)/.test(wc));
ok("the raise form refuses to send when it is the deck's", /if \(demo\) return;\s*setSaid\(""\)/.test(sg));
const showSrc = readFileSync(new URL("../src/views/pitchdeck/Showcase.jsx", import.meta.url), "utf8");
ok("the deck's raise form is given `demo`", /<RaiseFormView[^>]*\bdemo\b/.test(showSrc));

group("Every slide draws the components' own ids, in a frame that says it is inert");
const expect = {
  day: ["showcase-day", "day-sheet", "day-now", "day-board", "day-next", "ready-squad", "ready-ground", "day-out", "day-week", "day-alerts"],
  field: ["showcase-field-outcome", "showcase-field-area", "pad-board", "three-phase-pad", "key-wicket", "phase-area"],
  centre: ["showcase-centre", "mc-summary", "mc-board", "mc-latest"],
  scorebook: ["showcase-scorebook", "deck-scorebook-photo", "deck-read-hook", "sb-read-0", "sb-read-total-0", "sb-read-extras-0", "deck-from-scorebook", "deck-scorecard-head"],
  families: ["showcase-families-parent", "showcase-families-pupil", "eighteen-card", "health-consent-section", "health-consent-prompt-deck-child-a"],
  safeguard: ["showcase-safeguard-form", "showcase-safeguard-receipt", "sg-form", "sg-honesty", "sg-account", "sg-send", "sg-reference"],
};
ok("the six slides are the ones the deck lists", JSON.stringify(SHOWCASE_IDS) === JSON.stringify(Object.keys(expect)));
for (const id of SHOWCASE_IDS) {
  const html = renderToStaticMarkup(h(Showcase, { id }));
  for (const t of expect[id]) ok(`${id}: ${t}`, html.includes(`data-testid="${t}"`));
  const frames = (html.match(/class="deck-dev"/g) || []).length;
  ok(`${id}: every frame is marked inert`, frames > 0 && (html.match(/data-inert="true"/g) || []).length === frames);
  ok(`${id}: every frame is a named group`, (html.match(/role="group" aria-label="[^"]{12,}"/g) || []).length >= frames);
}
ok("the pupil's frame and the parent's do not draw one heading id twice", (() => {
  const html = renderToStaticMarkup(h(Showcase, { id: "families" }));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]);
  return ids.length === new Set(ids).size;
})());
ok("no slide puts a real concern, or a real child, on screen: the form is empty", !/<textarea[^>]*>[^<]+<\/textarea>/.test(renderToStaticMarkup(h(Showcase, { id: "safeguard" }))));

group("The scorebook slide's card is one the product would accept");
const refused = summaryRefusal(SCOREBOOK_CARD, { typed: SCOREBOOK.typed, ours: "home" });
ok("the scoring package finds nothing to refuse in it (the sums, the names, our side and theirs)", refused.length === 0, refused);
ok("the batting adds up to the total with the extras",
   SCOREBOOK_CARD.batting.reduce((a, b) => a + b.runs, 0) + Object.values(SCOREBOOK_CARD.extras).reduce((a, b) => a + b, 0) === SCOREBOOK_CARD.total);
ok("every name on the card resolves to a spelling",
   [...SCOREBOOK_CARD.batting.flatMap((b) => [b.ref, b.fielderRef, b.bowlerRef]), ...SCOREBOOK_CARD.bowling.map((b) => b.ref), ...SCOREBOOK_CARD.didNotBat]
     .filter(Boolean).every((r) => SCOREBOOK.nameOf(r).length > 0));
ok("the drawn page's hook is idle and empty", /data-hook="read-the-pages" data-testid="deck-read-hook" data-state="idle"[^>]*><\/g>/.test(renderToStaticMarkup(h(Showcase, { id: "scorebook" }))));

group("The day sheet's demonstration data");
const day = buildDaySheet(m);
ok("the coach's day, not the server's: live is false", day.role === "coach" && day.live === false);
ok("the Now tile has a board from the demonstration chase", day.liveMatch?.status === "live" && !!day.board && day.board.wickets === 2, day.board?.wickets);
ok("every section has something to draw", !!day.next && day.weekMatches.length === 2 && day.weekTraining.length === 2 && day.out.length === 2 && day.unread.length === 2);
ok("the ground report is the one ready chip left empty", !day.dutyRows.some((r) => r.duty === "ground") && day.dutyRows.length === 3);
ok("this week is this week: the fixtures and sessions are dated within six days of today", [...day.weekMatches, ...day.weekTraining].every((r) => {
  const d = (Date.parse(`${r.date}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 864e5;
  return d >= 0 && d <= 6;
}));
const dash = readFileSync(new URL("../src/views/DashboardView.jsx", import.meta.url), "utf8");
ok("DashboardView still draws through DaySheet, and exports it", /<DaySheet\b/.test(dash) && /export \{ DashboardView, DaySheet \}/.test(dash));

group("The pad opens where it always did, unless the deck says otherwise");
const noop = () => {};
const pad = (extra = {}) => renderToStaticMarkup(h(Pad, { inn: m.chasing, basic: false, onCommitDetailed: noop, onWicketCtx: noop, onWide: noop, onNoBall: noop, onUndo: noop, ...extra }));
ok("no preset: the Shot step, as on every ground", /data-testid="three-phase-pad" data-phase="1"/.test(pad()));
ok("a preset of the outcome step opens there", /data-testid="three-phase-pad" data-phase="3"/.test(pad({ preset: { phase: 3, shot: "drive" } })));

console.log("\n" + "─".repeat(52));
console.log(`DECK SHOWCASE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
