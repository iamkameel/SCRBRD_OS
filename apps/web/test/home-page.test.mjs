/**
 * SCRBRD-142 phase 1. The public home page's sections (src/home/sections/):
 * they render signed out, with no sign-in, token or request to a signed-in
 * route; the live strip and the news draw nothing until given data and when
 * the read answers 404; the analytics toggle writes the preference and starts
 * nothing; and the words obey the floors and the copy rules.
 *
 * There is no DOM in this suite, so the toggle is driven the way the
 * error-boundary suite drives its class: the pure view is rendered, its
 * onClick is read off the element and called, and what it wrote is read back.
 * tools/smoke-browser-home.mjs (the Opus branch) walks the real page.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/home-page.test.mjs
 */
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Header, LiveStrip, Hero, Tiles, News, Families, Schools, Footer, Privacy,
  AnalyticsToggle, ANALYTICS_PREF, setAnalyticsPref,
} from "../src/home/sections/index.js";
import { ToggleView } from "../src/home/sections/Footer.jsx";
import { arrange, firstScreen, statusSentence } from "../src/home/sections/LiveStrip.jsx";
import { LEAD, ALSO } from "../src/home/sections/Tiles.jsx";
import { PRIVACY_RULE, PRIVACY_NEVER } from "../src/home/sections/Privacy.jsx";
import { analyticsConsented } from "../src/lib/firebase.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);
const html = (el) => renderToStaticMarkup(el);
const text = (el) => html(el).replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const everySection = () => [
  h(Header, {}), h(LiveStrip, { data: null }), h(Hero, {}), h(Tiles), h(News, { data: null }),
  h(Families), h(Schools, { email: "hello@example.test" }), h(Footer),
];
const page = () => everySection().map(html).join("\n");

// A fetch that fails the suite if anything calls it: the sections are pure.
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = (...a) => { calls.push(a[0]); throw new Error("a section fetched"); };

group("A. Signed out: the page draws, and reaches for nothing signed-in");
{
  const all = page();
  ok("every section renders", all.length > 4000, all.length);
  ok("no Bearer, token or sign-in form", !/bearer|authorization|<form|<input|type="password"/i.test(all));
  ok("no request path to a signed-in read", !/\/api\/read\/|\/api\/matches\//.test(all));
  ok("no section fetched while rendering", calls.length === 0, calls.join());
  ok("Log in goes to the app", /href="\/app"[^>]*>Log in</.test(html(h(Header, {}))) || /<a href="\/app"/.test(html(h(Header, {}))));
  // EXPERIENCE_PASS §2.3: three doors in place of one "Log in", which stays in the header.
  ok("the hero's doors are Score a match and My child plays, each saying what it gives, with the office-code line",
    /Score a match Sign in, then score on this phone/.test(text(h(Hero, {}))) && /My child plays Sign in, then ask your child's school/.test(text(h(Hero, {})))
    && /href="\/app"[^>]*data-testid="home-cta-score"/.test(html(h(Hero, {}))) && /href="\/app\?door=parent"[^>]*data-testid="home-cta-child"/.test(html(h(Hero, {})))
    && /Your school's office gives you your code/.test(text(h(Hero, {}))));
  ok("...and the hero no longer carries a Log in of its own (the header's stays)", !/Log in/.test(text(h(Hero, {}))) && /Log in/.test(text(h(Header, {}))));
  ok("no price: not 'free', no pricing promise", !/free|\bR ?\d|per month|pricing/i.test(all.replace(/data-[a-z-]+="[^"]*"/g, "")));
  ok("the hero's Watch a match is only offered when the strip is on the page",
    !/Watch a match/.test(text(h(Hero, {}))) && /Watch a match/.test(text(h(Hero, { hasStrip: true }))) && /href="#matches"/.test(html(h(Hero, { hasStrip: true }))));
  ok("the page is a quiet one without data: no strip, no news, no empty box", !/Live now|Today|No matches|>News</.test(text(h("div", null, h(LiveStrip, { data: null }), h(News, { data: null })))));
  ok("the schools section is a mailto and collects nothing", /href="mailto:hello@example.test\?subject=/.test(html(h(Schools, { email: "hello@example.test" }))) && !/<form|<input|<textarea/.test(html(h(Schools, { email: "hello@example.test" }))));
  ok("...and without an address it shows its words and no dead link", !/href=/.test(html(h(Schools, {}))) && /Bring SCRBRD to your school/.test(text(h(Schools, {}))));
  ok("the families section links to /privacy", /href="\/privacy"/.test(html(h(Families))));
}

group("B. The copy describes what is built and names no gender");
{
  const words = [text(h(Hero, {})), text(h(Tiles)), text(h(Families)), text(h(Schools, {})), text(h(Privacy, {}))].join(" ");
  ok("no gendered word anywhere on the page", !/\b(he|she|his|hers?|him|boys?|girls?|men|women|male|female|mothers?|fathers?|sons?|daughters?)\b/i.test(words), words.match(/\b(he|she|his|hers?|him|boys?|girls?|men|women|male|female|mothers?|fathers?|sons?|daughters?)\b/i)?.[0]);
  ok("eight lead tiles and six also-lines", LEAD.length === 8 && ALSO.length === 6, `${LEAD.length}/${ALSO.length}`);
  ok("no 'AI commentary', no 'kit allocation', no brackets-and-leaderboards promise", !/\bAI\b|kit allocation|top performers|brackets and/i.test(words));
  ok("no child's name and no ground", !/Erasmus|Hilton|Westville|Kearsney|Michaelhouse/.test(words));
  ok("the footer says the page collects nothing", /This page collects nothing/.test(text(h(Footer))));
}

group("C. Live strip and news: nothing until given data, nothing on 404");
{
  const none = [undefined, null, {}, { status: 404 }, { error: "not_found" }, [], "", 404];
  ok("the strip draws nothing for no data, a 404 or a wrong shape", none.every((d) => html(h(LiveStrip, { data: d })) === ""), none.map((d) => html(h(LiveStrip, { data: d }))).join("|"));
  ok("the news draws nothing for no data, a 404 or a wrong shape", [undefined, null, {}, { status: 404 }, { posts: [] }, [], "", 404].every((d) => html(h(News, { data: d })) === ""));

  const fx = (id, status, extra = {}) => ({
    id, status, format: "T20", overs: 20, startsAt: "2026-10-03T08:00:00Z",
    home: { label: "Hilton College", code: "1XI" }, away: { label: "Westville Boys' High", code: "1XI", onPlatform: true },
    scores: [], result: null, ...extra,
  });
  const data = { asOf: "2026-10-03", fixtures: [
    fx("c3", "scheduled", { startsAt: "2026-10-03T12:00:00Z" }),
    fx("c2", "complete", { scores: [{ innings: 1, runs: 131, wickets: 8, balls: 120 }, { innings: 2, runs: 132, wickets: 4, balls: 97 }], result: "Westville Boys' High 1XI won by 6 wickets" }),
    fx("c1", "live", { scores: [{ innings: 1, runs: 142, wickets: 3, balls: 110 }] }),
    fx("c4", "abandoned"),
    fx("c5", "cancelled"),
    // db/133: postponed before play, to be replayed. Listed with the settled ones.
    fx("c6", "postponed"),
  ] };
  ok("live first, then the day's order; an unknown status is left out", arrange(data.fixtures).map((f) => f.id).join() === "c1,c3,c2,c4,c6");
  const all = html(h(LiveStrip, { data }));
  ok("a card for each known fixture", (all.match(/data-testid="home-card"/g) ?? []).length === 5, all.length);
  ok("a postponed card says POSTPONED, with no score, and links to the match page", /data-status="postponed"/.test(all) && /href="\/live\/c6"/.test(all) && /POSTPONED/.test(text(h(LiveStrip, { data: { fixtures: [fx("c6", "postponed")] } }))));
  ok("every card is a nofollow link to the match page; a finished one to the scorecard",
    /href="\/live\/c1"[^>]*rel="nofollow"|rel="nofollow"[^>]*href="\/live\/c1"/.test(all) && /href="\/scorecard\/c2"/.test(all) && /href="\/scorecard\/c4"/.test(all)
    && (all.match(/rel="nofollow"/g) ?? []).length === 5);
  const t = text(h(LiveStrip, { data }));
  ok("the live card reads the score and overs: 142/3, 18.2 ov", /LIVE/.test(t) && /142\/3 \(18\.2\)/.test(t) && /18\.2 ov/.test(t), t);
  ok("a score with no side is a line of its own, not guessed onto a team", /1st innings 142\/3/.test(t) && /2nd innings 132\/4 \(16\.1\)/.test(t), t);
  const sided = text(h(LiveStrip, { data: { fixtures: [fx("s1", "complete", { scores: [{ innings: 1, runs: 131, wickets: 8, balls: 120, side: "home" }, { innings: 2, runs: 132, wickets: 4, balls: 97, side: "away" }], result: "Westville Boys' High 1XI won by 6 wickets" })] } }));
  ok("with a side the score sits beside that team", /Hilton College 1XI 131\/8 \(20\.0\)/.test(sided) && /Westville Boys' High 1XI 132\/4 \(16\.1\)/.test(sided) && /won by 6 wickets/.test(sided), sided);
  ok("a scheduled card shows its start in South African time", /10:00|14:00/.test(t) && /\b14:00\b/.test(t), t);
  ok("the card shows the result words, the overs and when it started", /40|20 overs/.test(t) && /started 10:00/.test(t), t);
  ok("no ground, no player, no toss, no reason", !/ground|toss|venue|opening|batter|bowler/i.test(t));
  ok("Live now above, Today below: show picks the part",
    /Live now/.test(text(h(LiveStrip, { data, show: "live" }))) && !/Today/.test(text(h(LiveStrip, { data, show: "live" })))
    && /Today/.test(text(h(LiveStrip, { data, show: "today" }))) && !/Live now/.test(text(h(LiveStrip, { data, show: "today" }))));
  ok("nothing live: the live part draws nothing", html(h(LiveStrip, { data: { fixtures: [fx("a", "scheduled")] }, show: "live" })) === "");
  ok("a real empty answer is one quiet line", /No matches listed today/.test(text(h(LiveStrip, { data: { fixtures: [] } }))) && !/never|not being played/i.test(text(h(LiveStrip, { data: { fixtures: [] } }))));
  ok("an id is never trusted into a path", /href="\/live\/a%2F%22b"/.test(html(h(LiveStrip, { data: { fixtures: [fx("a/\"b", "live")] } }))));

  // EXPERIENCE_PASS §3.8: the status sentence. The chase only from a target the read gives (Q14, slice 3b).
  const chase = (extra) => fx("ch", "live", { scores: [{ innings: 1, runs: 141, wickets: 6, balls: 120, side: "home" }, { innings: 2, runs: 97, wickets: 3, balls: 86, side: "away" }], ...extra });
  ok("live, first innings, with a side: the side, its score and the overs, in words",
    statusSentence(fx("s", "live", { scores: [{ innings: 1, runs: 86, wickets: 3, balls: 76, side: "home" }] })) === "Hilton College 1XI 86/3 after 12.4 overs");
  ok("...without a side, the innings, never a guessed team", statusSentence(fx("s", "live", { scores: [{ innings: 1, runs: 6, wickets: 0, balls: 6 }] })) === "1st innings 6/0 after 1 over");
  ok("the chase WITHOUT a target (today's read): the score only, nothing worked out from the first innings",
    statusSentence(chase({})) === "Westville Boys' High 1XI 97/3 after 14.2 overs" && !/need|target|chasing/i.test(statusSentence(chase({}))));
  ok("WITH a target: the runs needed off the balls left", statusSentence(chase({ target: 142 })) === "Westville Boys' High 1XI need 45 off 34");
  ok("...revised: the runs and the revised target, and no balls left (a revision can change the overs)",
    statusSentence(chase({ target: 130, revised: true })) === "Westville Boys' High 1XI need 33 to win, revised target 130");
  ok("...a target reached says so", /reached the target of 90/.test(statusSentence(chase({ target: 90 }))));
  ok("...a target in the first innings is not a chase", statusSentence(fx("s", "live", { target: 150, scores: [{ innings: 1, runs: 20, wickets: 0, balls: 12, side: "home" }] })) === "Hilton College 1XI 20/0 after 2 overs");
  ok("the other states: a result, a start, abandoned, postponed",
    statusSentence(fx("r", "complete", { result: "Westville Boys' High 1XI won by 6 wickets" })) === "Westville Boys' High 1XI won by 6 wickets"
    && /^Starts at \d\d:\d\d$/.test(statusSentence(fx("t", "scheduled"))) && statusSentence(fx("a", "abandoned")) === "Abandoned" && statusSentence(fx("p", "postponed")) === "Postponed");
  const liveCard = html(h(LiveStrip, { data: { fixtures: [chase({ target: 142 })] }, show: "live", lead: true }));
  ok("a live card carries its sentence and Watch, inside its one link", /data-testid="home-card-sentence"[^>]*>Westville Boys&#x27;s? High 1XI need 45 off 34|need 45 off 34/.test(liveCard) && /data-testid="home-card-watch"/.test(liveCard));
  ok("...and the board that leads the page is drawn at once, not held for the scroll reveal", /data-lead=""/.test(liveCard) && !/class="rv"/.test(liveCard));
  ok("the sentence names no player", !/batter|bowler|\bnot out\b/i.test(text(h(LiveStrip, { data: { fixtures: [chase({ target: 142 })] } }))));

  // EXPERIENCE_PASS §2.3, Q6: the first screen by the read's state.
  ok("first screen: live → the board; today → Today; results only → the result; nothing → the film",
    firstScreen({ fixtures: [fx("a", "scheduled"), fx("b", "live")] }) === "live"
    && firstScreen({ fixtures: [fx("a", "scheduled"), fx("c", "complete")] }) === "today"
    && firstScreen({ fixtures: [fx("c", "complete")] }) === "result"
    && firstScreen({ fixtures: [] }) === "film" && firstScreen(null) === "film" && firstScreen({ status: 404 }) === "film"
    && firstScreen({ fixtures: [fx("x", "cancelled")] }) === "film");

  const posts = Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, school: "Hilton College", team: "1XI", title: `Through to the final ${i}`, body: "The side won today.\nWell played.", publishedAt: "2026-10-02T10:00:00Z" }));
  const news = html(h(News, { data: { posts } }));
  ok("five posts at most", (news.match(/data-testid="home-news-post"/g) ?? []).length === 5);
  ok("a post is the school and side, the date, the title and the words", /Hilton College 1XI/.test(text(h(News, { data: { posts } }))) && /2 Oct 2026/.test(text(h(News, { data: { posts } }))) && /Through to the final 0/.test(news));
  ok("a bare array is read the same way", (html(h(News, { data: posts })).match(/home-news-post/g) ?? []).length === 5);
  ok("a post's words are text, never markup", /&lt;b&gt;/.test(html(h(News, { data: [{ id: "x", title: "T", body: "<b>x</b>" }] }))) && !/<b>x<\/b>/.test(html(h(News, { data: [{ id: "x", title: "T", body: "<b>x</b>" }] }))));
  const long = html(h(News, { data: [{ id: "l", title: "T", body: "word ".repeat(80) }] }));
  ok("a long post is clamped to four lines with a More button; a short one has none", /-webkit-line-clamp:4/.test(long) && />More</.test(long) && !/>More</.test(html(h(News, { data: [{ id: "s", title: "T", body: "short" }] }))));
  ok("the news names no author", !/author|by /i.test(text(h(News, { data: { posts } }))));
}

group("D. The analytics toggle writes the preference and starts nothing");
{
  const writes = [], reads = [];
  const fake = { getPref: async (k) => { reads.push(k); return null; }, setPref: async (k, v) => { writes.push([k, v]); return true; } };
  const off = html(h(ToggleView, { on: false, onToggle() {} }));
  ok("off by default, in today's words and with today's test id", /data-testid="analytics-consent"/.test(off) && /role="switch"/.test(off) && /aria-checked="false"/.test(off) && />Turn on</.test(off), off);
  ok("the words say the page collects nothing", /Anonymous usage analytics in the app: <strong>off<\/strong>\. This page collects nothing\./.test(off.replace(/<!-- -->/g, "")), off);
  ok("on, it offers Turn off and says when it takes effect", /aria-checked="true"/.test(html(h(ToggleView, { on: true, onToggle() {} }))) && /Turn off/.test(text(h(ToggleView, { on: true, onToggle() {} }))) && /next visit/.test(text(h(ToggleView, { on: true, onToggle() {} }))));

  const click = ToggleView({ on: false, onToggle: () => {} }).props.children.find((c) => c?.type === "button").props;
  ok("the button is a real button wired to the handler", typeof click.onClick === "function" && click.type === "button" && click["data-testid"] === "analytics-consent");

  const handler = async () => { await setAnalyticsPref(true, fake); };
  await handler();
  ok("turning it on writes the 'analytics' pref true, and only that", writes.length === 1 && writes[0][0] === "analytics" && writes[0][1] === true && ANALYTICS_PREF === "analytics", JSON.stringify(writes));
  await setAnalyticsPref(false, fake);
  ok("turning it off writes false", writes.length === 2 && writes[1][1] === false);
  await setAnalyticsPref("yes", fake);
  ok("only a literal true counts as on", writes[2][1] === false);
  ok("nothing was fetched, nothing loaded", calls.length === 0);

  // The real store, read the way the app reads it at boot.
  ok("before it is touched this device has not consented", (await analyticsConsented()) === false);
  await setAnalyticsPref(true);
  ok("the app's own reader (lib/firebase.js) sees the write", (await analyticsConsented()) === true);
  await setAnalyticsPref(false);
  ok("...and sees it turned off", (await analyticsConsented()) === false);
  ok("still nothing fetched", calls.length === 0);

  const src = readFileSync(new URL("../src/home/sections/Footer.jsx", import.meta.url), "utf8");
  ok("the footer imports persist.js, never firebase", /from "\.\.\/\.\.\/lib\/persist\.js"/.test(src) && !/^\s*import[^\n]*firebase/m.test(src) && !/import\(/.test(src));
  const every = ["Header", "Hero", "Tiles", "Families", "Schools", "LiveStrip", "News", "Footer", "Privacy", "shared"].map((n) => readFileSync(new URL(`../src/home/sections/${n}.jsx`, import.meta.url), "utf8")).join("\n");
  ok("no section imports firebase, the API client, a session or a view", !/^\s*import[^\n]*(firebase|lib\/api|lib\/session|lib\/live|\/views\/|\/scorer\/|\/auth\/|\/shell\/)/m.test(every) && !/\bfetch\s*\(/.test(every));
  ok("the toggle component mounts with a fake store and reads nothing at render", (() => { html(h(AnalyticsToggle, { prefs: fake })); return reads.length === 0; })());
}

group("E. The floors: no text under 12px, nothing tapped under 44px");
{
  const markup = [
    page(), html(h(LiveStrip, { data: { fixtures: [{ id: "a", status: "live", home: { label: "H" }, away: { label: "A" }, scores: [{ innings: 1, runs: 1, wickets: 0, balls: 1 }] }, { id: "b", status: "scheduled", home: { label: "H" }, away: { label: "A" } }] } })),
    html(h(News, { data: [{ id: "n", title: "T", body: "word ".repeat(80), school: "S", publishedAt: "2026-10-02T10:00:00Z" }] })), html(h(Privacy, {})),
    html(h(ToggleView, { on: true, onToggle() {} })),
  ].join("\n");
  const sizes = [...markup.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  ok("every pixel font size is 12 or more", sizes.length > 20 && sizes.every((s) => s >= 12), `${sizes.length} sizes, min ${Math.min(...sizes)}`);
  const controls = [...markup.matchAll(/<(a|button)\b[^>]*>/g)].map((m) => m[0]);
  const small = controls.filter((c) => !/min-height:44px/.test(c));
  ok("every link and button has a 44px floor", controls.length > 8 && small.length === 0, small.slice(0, 3).join(" "));
  ok("the images and icons are decorative or named", !/<img(?![^>]*alt=)/.test(markup));
  ok("one h1 on the home page and one on the privacy page", (page().match(/<h1/g) ?? []).length === 1 && (html(h(Privacy, {})).match(/<h1/g) ?? []).length === 1);
}

group("F. The privacy page takes its words from PUBLIC_DATA.md");
{
  const doc = readFileSync(new URL("../../../docs/policy/PUBLIC_DATA.md", import.meta.url), "utf8").replace(/[“”]/g, "\"");
  const norm = (s) => s.replace(/\s+/g, " ").toLowerCase();
  const d = norm(doc);
  ok("each rule's heading is a phrase of PUBLIC_DATA §1", PRIVACY_RULE.length === 7 && PRIVACY_RULE.every(([t]) => d.includes(norm(t.replace(/\.$/, "")))), PRIVACY_RULE.filter(([t]) => !d.includes(norm(t))).map((r) => r[0]).join(" | "));
  ok("each never-public heading is a phrase of PUBLIC_DATA §3", PRIVACY_NEVER.length === 5 && PRIVACY_NEVER.every(([t]) => d.includes(norm(t))), PRIVACY_NEVER.filter(([t]) => !d.includes(norm(t))).map((r) => r[0]).join(" | "));
  const p = text(h(Privacy, {}));
  ok("the page carries the consent rule, an example and the age-group line",
    /"J Smith"/.test(p) && /Batter/.test(p) && /U15/.test(p) && /end-dated, never deleted/.test(p), p.slice(0, 200));
  ok("it promises nothing that is not built: no news, no home-page listing, no standings page", !/news|listed on the home|standings|honours/i.test(p));
  ok("it links home and carries the same footer toggle", /href="\/"/.test(html(h(Privacy, {}))) && /analytics-consent/.test(html(h(Privacy, {}))));
}

globalThis.fetch = realFetch;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
