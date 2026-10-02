#!/usr/bin/env node
/**
 * Accessibility, checked in a real browser — in BOTH themes.
 *
 * design.md's §5.1 audit found zero focus states across 164 buttons, zero
 * labels on 18 inputs, one ARIA attribute in the entire app, and no
 * prefers-reduced-motion support. Those are not polish items. Between them
 * they mean the app cannot be operated without a mouse, cannot be operated by
 * a screen reader, and makes someone with a vestibular disorder unwell on the
 * one screen they cannot look away from.
 *
 * This walk checks the things that would silently come back: a new button with
 * no name, a new input with no label, an outline:none somebody added to make a
 * field look tidier.
 *
 * 2.1 (DESIGN_DIRECTION §3.1, §3.8). The whole walk runs twice — the device
 * set to dark (Floodlit) and to light (Daylight) — and adds:
 *   - the theme in use is the device's, decided before the app's script runs
 *     (no flash of the wrong one), and the browser's theme-color follows it;
 *   - a switch while the app is open applies everywhere: after one, nothing on
 *     screen still wears the previous theme's surfaces (the trap of a colour
 *     copied into a constant at import time);
 *   - the override on the pad's menu wins over the device, and is remembered;
 *   - THE TYPE FLOOR, as a ratchet: rendered text under 12px is counted on
 *     every screen this walk visits, and may not rise above TYPE_FLOOR_CEILING;
 *   - THE TAP FLOOR on the pad (§3.5, step 2): anything tapped under 44px,
 *     against TAP_FLOOR_CEILING — 0;
 *   - RENDERED CONTRAST, as a ratchet: text whose colour does not clear AA
 *     against the background it is actually drawn on, per theme, may not rise
 *     above CONTRAST_CEILING. design.test.mjs proves the TOKENS read; this
 *     proves the SCREENS use them where they read.
 *   - EMOJI IN CONTROLS, as a ratchet (§3.4, step 1b): emoji in the text of a
 *     button, link, tab, label, heading or nav, or in a control's name, per
 *     screen, may not rise above EMOJI_CEILING — which is 0. The static half,
 *     for screens this walk never opens, is apps/web/test/icons.test.mjs.
 *
 *   pnpm build && node tools/smoke-a11y.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { port } from "./db-url.mjs";
import { captainApi, IDS, MATCH } from "./a11y-captain-mock.mjs";
import { cockpitApi, MATCH as COCKPIT } from "./a11y-cockpit-mock.mjs";
import { shellHtml } from "../services/api/public/public-api.mjs";
import { inningsStart, batters, bowler, ball, BALL_TYPE } from "@scrbrd/scoring";

const PORT = port(4331);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

/**
 * Rendered text under 12px, per screen this walk visits — the §3.2 floor
 * ("nothing read is below 12px"), as a RATCHET. Step 1a records where the app
 * is; the screens are resized in later steps and each one lowers its number
 * here. A number may go down and must never go up: a new 9px label is a new
 * failure. The count is the same in both themes (a theme changes colour, not
 * size), and both are checked against it.
 *
 * Measured 2026-09-25 on the demo build, 1280×720, as Head Coach. The pad
 * was 44; step 2 (the pad on the new foundations, 2026-09-26) took it to 0.
 * Step 3 (the day sheet, 2026-09-26) took the dashboard to 18 — the KPI
 * tiles' own 8/9/10/11px labels are gone with them; the 18 that remain are
 * the shell (Sidebar, TopBar) every screen carries, not the day sheet's own
 * markup. Match Centre's own scores, dates and card buttons moved onto the
 * 12px floor the same day, to 31; its remainder is the same shell plus
 * Badge/Pill/WeatherChip, shared components step 3's "light touch" left for
 * their own screens rather than widening this change into every user.
 * Step 3c (the Match Centre rebuilt, 2026-09-26) took it to 18: the card's
 * competition and bus are body text now and WeatherChip is on the floor, so
 * what remains is the shell, as on the day sheet. `matchview` is the
 * fixture's own view (views/matchcentre/), its Scorecard tab, measured from
 * step 3c on: the shell and nothing of its own.
 */
const TYPE_FLOOR_CEILING = {
  landing:     5,
  login:       13,
  dashboard:   17,
  matchcentre: 17,
  matchview:   17,
  pad:         0,
  // Step 3b: the pad again, after an over is recorded, so the chips on the
  // board are on screen and counted. 0, like the pad.
  padOver:     0,
  // SCRBRD-095 item 2: the Pro hub — scoring.jsx's ScoringHub/ScoringPanel
  // and the cards it shows (panels.jsx, charts.jsx' ManhattanChart) — which
  // this walk never opened before. Measured 2026-09-27 at 0, once the hub's
  // own Lbl/Badge eyebrows and pills were brought onto the shared floor.
  pro:         0,
  // SCRBRD-102 (2026-09-28), the first time this walk opened either. Both
  // carried their own sub-12px labels — the Analytics tab's WormChart legend
  // and per-batter/bowler figures (scorer/charts.jsx), the Career tab's
  // headings, roster list and tab strip (ProfilesView.jsx) — brought onto the
  // floor here, same as dashboard's and Match Centre's own labels were.
  // Analytics is left at 18, matching matchcentre/matchview exactly: the
  // shell (Sidebar, TopBar) and nothing of the tab's own. Career was left at
  // 30 — the same 18-item shell, plus 12 the fix above could not plainly
  // reach: eight roster-row avatar initials (ui/primitives.jsx's Avatar,
  // sized off the avatar itself) and four hero badges (that file's own
  // Badge, 9px by default) — both shared by some 28 other screens, so
  // lowering either's own floor was left as the design-system change, not
  // that one.
  //
  // That change: Avatar's initials no longer shrink under 12px — below a
  // ~34px avatar the circle grows to fit the floor instead — and Badge moved
  // its 9px onto the same floor as scorer/ui.jsx's own Badge already drew at
  // (padding grew with it, not a one-off override). Every one of the 28
  // screens these two primitives share inherits it, and Career — the one
  // screen this walk had already found sub-floor instances on — drops
  // straight to the 18-item shell, matching Analytics.
  analytics:   17,
  career:      17,
  // SCRBRD-138 phase A (2026-10-02): the captain's view, on a phone, against
  // the walk's own API (tools/a11y-captain-mock.mjs). The card on a pupil's
  // Home, the section on his fixture, and the Captain tab fielding, batting
  // and after — born at 0, and it stays there: the screens are new, so no
  // shell or shared component is priced in.
  captainhome:    0,
  captainfixture: 0,
  captainfield:   0,
  captainbat:     0,
  captainafter:   0,
  // SCRBRD-133 G1: the ground display at its three sizes — 1920×1080,
  // 1024×768, 390×844 — over every panel the rotation shows. Every size is
  // max(12px, vmin), so 0 from the first measurement, and kept there.
  display1080: 0,
  display768:  0,
  display390:  0,
  // SCRBRD-136/137 phase A (2026-10-02): the coach's cockpit, on a phone, against the
  // walk's own API (tools/a11y-cockpit-mock.mjs): the Dashboard's match-day card, the
  // Coach tab before the first ball and live, and the feed's drawer. Measured inside the
  // cockpit's own regions (the card, the tab, the drawer) — the staff shell around them
  // is priced into dashboard and matchview above, not here. Born at 0, and kept there.
  cockpithome:   0,
  cockpitday:    0,
  cockpitlive:   0,
  cockpitdrawer: 0,
};                   // 103 in all (SCRBRD-131: the bell's count came onto 12px, one off each shell screen)

/**
 * Things tapped under 44px, on the pad (§3.5, §3.8: "no tappable element
 * under 44px on the pad"): every visible button, link, input and control
 * whose box is under 44 in either dimension. The pad is the screen used
 * one-handed, outdoors, under time pressure; step 2 took it to 0 and it
 * stays there. The same in both themes.
 */
const TAP_FLOOR_CEILING = {
  pad:         0,
  padOver:     0,
  // SCRBRD-095 item 2: the Pro hub's own keys and pills, not only the pad's.
  pro:         0,
  // SCRBRD-102 (2026-09-28) considered the Analytics and Career tabs for
  // this ratchet too, and left them out: every tappable thing under 44px on
  // either is the Sidebar/TopBar shell every screen carries (28 on
  // Analytics, 36 on Career, mostly the same nav rail matchcentre and
  // matchview also draw), not a control of the tab's own — the same reason
  // matchcentre, matchview and dashboard are not in this map either. Tracked
  // instead under the type floor below, which already prices the shell in
  // at 18 per screen.
  //
  // SCRBRD-138 phase A: the captain's view, on a phone. Everything the view
  // adds is 44px or more (its section and tab hold no control at all). What
  // is counted is the shell's, not the view's: the skip link (119x34, on
  // every screen) and, on the fixture, the pupil fixture header's own "map"
  // link (29x17, STEP4 S3, found here and left for its own change).
  captainhome:    1,
  captainfixture: 2,
  captainfield:   1,
  captainbat:     1,
  captainafter:   1,
  // SCRBRD-136/137: the cockpit's card, tab and drawer: every control 44px or more.
  cockpithome:   0,
  cockpitday:    0,
  cockpitlive:   0,
  cockpitdrawer: 0,
};

/**
 * Text that does not clear AA (4.5:1; 3:1 at 24px, or 18.66px bold) against
 * the colour actually behind it, per theme and screen. A ratchet for the same
 * reason: under lights these are the 2.0 screens' own misses (white on the
 * cyan end of a gradient, a tint behind a tint), recorded, not fixed here;
 * in daylight they are this step's result. Text on an image or a gradient,
 * or set as a gradient, is not measured — its background is not one colour.
 */
const CONTRAST_CEILING = {
  // The pad's one — a run in "this over", emerald figure on an emerald tint
  // of itself, 9px (4.20:1 under lights, 4.39:1 in daylight) — went with step
  // 2: "this over" is on the board now, board.dim on board.face (6.34:1).
  // padOver (step 3b): the chips' figures, black or white on the chip's own
  // fill, and the day sheet's board with its Tier 2 line, are in these.
  //
  // SCRBRD-102 (2026-09-28) found the Analytics tab's Bowling Economy
  // figures, in daylight only — four amber Badges (an economy of 6–9,
  // scorer/ui.jsx's Badge) at 4.06:1, short of 4.5. The Badge's ink was
  // chosen for the full colour (textOn(color)) but drawn on a ~12%-opacity
  // tint of it (background:${color}1e), the same "figure on a tint of
  // itself" pattern padOver's own entry above names.
  //
  // Fixed at the token level rather than re-tuned per call site: warning now
  // has a readable half, semantic.warningText (design/tokens.js), the same
  // pairing critical and fielding already had, and textOn(D.amber) returns it.
  // Floodlit's is identical to warning itself (already 7.14:1 on the Badge's
  // own tint — nothing there needed to move); Daylight's is one shade darker
  // (5.74:1 on the surfaces, 4.92:1 on the Badge's own tint), still amber and
  // still clearly apart from critical's red and positive's green. Every
  // caller of textOn(D.amber) — Badge in both ui/primitives.jsx and
  // scorer/ui.jsx, and the handful of direct reads elsewhere — inherits it.
  // SCRBRD-138 phase A: the captain's view; SCRBRD-133 G1: the ground display's
  // three sizes, Floodlit on the floodlit pass and its own Daylight setting
  // (board.dim lifted) on the daylight one.
  floodlit: { landing: 0, login: 0, dashboard: 0, matchcentre: 0, matchview: 0, pad: 0, padOver: 0, analytics: 0, career: 0,
              captainhome: 0, captainfixture: 0, captainfield: 0, captainbat: 0, captainafter: 0,
              cockpithome: 0, cockpitday: 0, cockpitlive: 0, cockpitdrawer: 0,
              display1080: 0, display768: 0, display390: 0 },
  daylight: { landing: 0, login: 0, dashboard: 0, matchcentre: 0, matchview: 0, pad: 0, padOver: 0, analytics: 0, career: 0,
              captainhome: 0, captainfixture: 0, captainfield: 0, captainbat: 0, captainafter: 0,
              cockpithome: 0, cockpitday: 0, cockpitlive: 0, cockpitdrawer: 0,
              display1080: 0, display768: 0, display390: 0 },
};

/**
 * Emoji in the text of CONTROLS AND LABELS — buttons, links, tabs, menu
 * items, radios, options, form labels, headings, and everything inside a
 * <nav> — per screen, and in any control's aria-label (DESIGN_DIRECTION §3.4,
 * §3.8). Step 1b took every one out and put icons in their place; the ceiling
 * is where it left them, and like the type floor it may only go down. It is
 * the same in both themes. Content somebody wrote (a notice's body, a note)
 * is not a label and is not counted.
 *
 * Measured 2026-09-25 on the demo build, 1280×720, as Head Coach: 0 on every
 * screen. The same walk over the build before step 1b counted landing 1,
 * login 5, dashboard 24, match centre 24, pad 30 — in both themes.
 */
const EMOJI_CEILING = {
  landing:     0,
  login:       0,
  dashboard:   0,
  matchcentre: 0,
  matchview:   0,
  pad:         0,
  padOver:     0,
  // SCRBRD-095 item 2: the Pro hub was never opened by this walk before.
  pro:         0,
  // SCRBRD-102: neither was the Analytics tab or the Career tab.
  analytics:   0,
  career:      0,
  // SCRBRD-138 phase A: the captain's view.
  captainhome:    0,
  captainfixture: 0,
  captainfield:   0,
  captainbat:     0,
  captainafter:   0,
  // SCRBRD-136/137: the coach's cockpit.
  cockpithome:   0,
  cockpitday:    0,
  cockpitlive:   0,
  cockpitdrawer: 0,
  // SCRBRD-133 G1: the ground display (it has no controls at all).
  display1080: 0,
  display768:  0,
  display390:  0,
};

// Each theme's own surfaces and inks — values the other theme never uses — so
// finding one on screen after a switch means something kept the old theme.
// (Floodlit's primary and tertiary inks are also the always-black board's
// figure and dim, and Daylight's white is also every raised card's, so those
// are not evidence of anything and are left out.)
const FLOODLIT_ONLY = ["#05070a", "#0a0d13", "#11151d", "#1a1f29", "#242a36", "#a3adbb"];
const DAYLIGHT_ONLY = ["#eef0ea", "#f7f8f4", "#e3e7dd", "#10140f", "#4a5347", "#5e6857"];
const DAYLIGHT_CANVAS = "#eef0ea", FLOODLIT_CANVAS = "#05070a";

/** The page's theme, its canvas, and every visible element still drawn in one of `stale`. */
const staleOn = (page, stale) => page.evaluate((stale) => {
  const hex = (c) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m || (m[3] != null && Number(m[3]) === 0)) return null;   // transparent is no colour
    return "#" + m.slice(0, 3).map((x) => Number(x).toString(16).padStart(2, "0")).join("");
  };
  const hits = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none") continue;
    for (const p of ["backgroundColor", "color", "borderTopColor"]) {
      if (p === "color" && !el.textContent.trim()) continue;       // an ink with nothing written in it
      if (p === "borderTopColor" && parseFloat(cs.borderTopWidth) === 0) continue;
      const h = hex(cs[p]);
      if (h && stale.includes(h)) { hits.push(`<${el.tagName.toLowerCase()}> ${p}=${h} "${(el.textContent || "").trim().slice(0, 24)}"`); break; }
    }
  }
  return { theme: document.documentElement.dataset.theme, meta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
           body: getComputedStyle(document.body).backgroundColor, hits };
}, stale);

let pass = 0, fail = 0;
const ok = (n, c, detail) => { if (c) pass++; else { fail++; console.log("  ✗", n, detail ? `— ${detail}` : ""); } };
const group = (t) => console.log("\n" + t);
const rgbOf = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

// ── The ground display (SCRBRD-133 G1), served here without an API ──
// The shell the public router serves, and a public header and log as the
// router sends them — labels already decided, pseudonyms for ids — built
// with @scrbrd/scoring's own constructors: a chase, a pair in, two overs and
// a bit, so every panel of the cycle has something. The names are the
// design's own illustrative ones (SCRBRD-133's sketches), nobody real.
const DISPLAY_ID = "77777777-0000-0000-0000-0000000a11d0";
const DISPLAY_HEADER = { match: { id: DISPLAY_ID, homeLabel: "Hilton College 1XI", homeTeam: "1XI", homeCode: "HIL", awayLabel: "Kearsney College 1XI",
  awayTeam: "Kearsney College 1XI", awayOnPlatform: false, sport: "cricket", format: "T20", overs: 20, startsAt: "2026-09-26T08:00:00.000Z",
  ground: "Gordon Sherwood Oval", status: "live", tossWonBy: "home", tossDecision: "bat", published: { home: true, away: false },
  scores: [{ innings: 0, runs: 9, wickets: 0, balls: 8 }], result: null }, fold: { startsAt: "2026-09-26T08:00:00.000Z", format: "T20" } };
const DISPLAY_LOG = (() => {
  const P = (/** @type {number} */ n) => `a11d${String(n).padStart(8, "0")}`;
  const squad = [["D Erasmus", 1], ["R Pillay", 2], ["Batter", 3], ["Batter", 4], ["Batter", 5], ["Batter", 6], ["Batter", 7], ["Batter", 8],
    ["Batter", 9], ["Batter", 10], ["Batter", 11]].map(([label, n]) => ({ id: P(/** @type {number} */ (n)), label }));
  const theirs = [["K Naidoo", 21], ["Bowler", 22], ...Array.from({ length: 9 }, (_, i) => ["Bowler", 23 + i])].map(([label, n]) => ({ id: P(/** @type {number} */ (n)), label }));
  let seq = 0;
  const at = (/** @type {any} */ ev) => ({ ...ev, innings: 0, seq: ++seq, id: `e${String(seq).padStart(15, "0")}`, clientTs: Date.parse("2026-09-26T08:00:00Z") + seq * 30_000 });
  const events = [
    at(inningsStart({ battingTeam: "1XI", bowlingTeam: "Kearsney College 1XI", teamKey: "1XI", bowlingTeamKey: "Kearsney College 1XI", squad, bowlingSquad: theirs, overs: 20 })),
    at(batters({ striker: squad[0].id, nonStriker: squad[1].id })), at(bowler({ bowler: theirs[0].id })),
    ...[1, 0, 4, 0, 2, 1].map((v) => at(ball({ value: v }))), at(bowler({ bowler: theirs[1].id })),
    at(ball({ type: BALL_TYPE.WIDE, value: 0 })), at(ball({ value: 1 })), at(ball({ value: 0 })),
  ];
  return { matchId: DISPLAY_ID, servedOn: "2026-09-26", last: seq, events, people: { [P(1)]: "D Erasmus", [P(2)]: "R Pillay", [P(21)]: "K Naidoo" } };
})();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  if (url === `/display/${DISPLAY_ID}`) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(shellHtml({ view: "display", matchId: DISPLAY_ID, header: { homeLabel: "Hilton College 1XI", awayLabel: "Kearsney College 1XI", scores: [] } }));
    return;
  }
  if (url === `/api/public/matches/${DISPLAY_ID}` || url === `/api/public/matches/${DISPLAY_ID}/log`) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(url.endsWith("/log") ? DISPLAY_LOG : DISPLAY_HEADER));
    return;
  }
  let body, type;
  try {
    const f = join("apps/web/dist", url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile("apps/web/dist/index.html");
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ ...launchOptions() });
const measured = { floodlit: { type: {}, contrast: {}, emoji: {}, tap: {} }, daylight: { type: {}, contrast: {}, emoji: {}, tap: {} } };

/** Every visible piece of text on the page: its element, size, and whether it reads. */
const survey = (page, root = null) => page.evaluate((root) => {
  const base = root ? document.querySelector(root) : document.body;
  if (!base) return [];
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  // The colour behind an element: its own and its ancestors' backgrounds,
  // composited, down to the first opaque one. Null where a gradient or an
  // image is in the way — that background is not one colour.
  const behind = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    let c = { r: 255, g: 255, b: 255, a: 1 };
    const root = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (root && root.a > 0) c = over(root, c);
    for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return c;
  };
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    // Visually hidden text is for screen readers, and SVG text is drawn in
    // the drawing's own units; neither is type on the page.
    if (el.closest(".sr-only, svg, script, style, noscript")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const text = n.nodeValue.trim().slice(0, 30);
    // Emoji carry their own colours; a string that is only pictographs has
    // no ink to measure.
    const inked = /[\p{L}\p{N}]/u.test(n.nodeValue);
    const fg = parse(cs.color);
    const gradientText = cs.webkitTextFillColor && /rgba\(0, 0, 0, 0\)|transparent/.test(cs.webkitTextFillColor);
    let ratio = null;
    const bg = behind(el);
    if (inked && fg && bg && !gradientText) {
      const f = over(fg, bg);
      const [a, b] = [lum(f), lum(bg)];
      ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    out.push({ size, text, ratio, need, tag: el.tagName.toLowerCase() });
  }
  return out;
}, root);

/**
 * Every emoji in a control's or a label's rendered text, or in a control's
 * accessible name. The same definition as apps/web/test/icons.test.mjs:
 * Unicode's pictographs, flags' regional indicators and the keycap mark;
 * not ©, ® or ™, which are typography.
 */
const emojiInControls = (page, root = null) => page.evaluate((root) => {
  const base = root ? document.querySelector(root) : document.body;
  if (!base) return [];
  const EMOJI = /(?![©®™])\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/gu;
  const CONTROL = "button, a[href], label, legend, summary, option, nav, h1, h2, h3, h4, h5, h6, th, " +
    "[role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=radio], [role=option], [role=link]";
  const hits = [];
  const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("script, style, noscript")) continue;
    const host = el.closest(CONTROL);
    if (!host) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none") continue;
    for (const m of n.nodeValue.match(EMOJI) ?? []) hits.push(`<${host.tagName.toLowerCase()}> "${host.textContent.trim().slice(0, 30)}" ${m}`);
  }
  for (const el of base.querySelectorAll(`${CONTROL}, input, select, textarea`)) {
    for (const m of (el.getAttribute("aria-label") ?? "").match(EMOJI) ?? []) hits.push(`aria-label "${el.getAttribute("aria-label").slice(0, 30)}" ${m}`);
  }
  return hits;
}, root);

/**
 * Every visible thing a person taps whose box is under 44px either way
 * (§3.5): buttons, links, inputs, and anything with a control's role. What is
 * hidden from everyone (aria-hidden, display:none, a zero box) is not a target.
 */
const smallTargets = (page, root = null) => page.evaluate((root) => {
  const base = root ? document.querySelector(root) : document;
  if (!base) return [];
  const TAPPED = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=switch], [role=checkbox]";
  const out = [];
  for (const el of base.querySelectorAll(TAPPED)) {
    if (el.closest("[aria-hidden=true]")) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || cs.visibility === "hidden") continue;
    if (r.width < 44 || r.height < 44) out.push(`${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}"`);
  }
  return out;
}, root);

/** Record the floor, contrast and emoji counts for one screen, and the tap floor where it is ratcheted. */
const measure = async (page, theme, screen, root = null) => {
  const items = await survey(page, root);
  const small = items.filter((i) => i.size < 12);
  const weak = items.filter((i) => i.ratio != null && i.ratio < i.need);
  const emoji = await emojiInControls(page, root);
  const tiny = screen in TAP_FLOOR_CEILING ? await smallTargets(page, root) : [];
  measured[theme].type[screen] = small.length;
  measured[theme].contrast[screen] = weak.length;
  measured[theme].emoji[screen] = emoji.length;
  if (screen in TAP_FLOOR_CEILING) measured[theme].tap[screen] = tiny.length;
  if (process.env.A11Y_DEBUG) {
    console.log(`[debug] ${theme}/${screen}: ${items.length} texts, ${small.length} under 12px, ${weak.length} below AA, ${emoji.length} emoji in controls${screen in TAP_FLOOR_CEILING ? `, ${tiny.length} targets under 44px` : ""}`);
    for (const t of tiny.slice(0, 8)) console.log(`   small target ${t}`);
    for (const w of weak.slice(0, 8)) console.log(`   weak ${w.ratio.toFixed(2)} <${w.tag}> ${w.size}px "${w.text}"`);
    for (const e of emoji.slice(0, 8)) console.log(`   emoji ${e}`);
  }
};

/** Every control on screen, with whatever name assistive tech would compute. */
const unnamedControlsOf = (page) => page.evaluate(() => {
  const name = (el) =>
    (el.getAttribute("aria-label") ||
     (el.getAttribute("aria-labelledby") &&
       document.getElementById(el.getAttribute("aria-labelledby"))?.textContent) ||
     (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) ||
     el.closest("label")?.textContent ||
     el.textContent || "").replace(/\s+/g, " ").trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  };
  return [...document.querySelectorAll("button, input, select, textarea, a[href]")]
    .filter(visible)
    .filter((el) => el.getAttribute("aria-hidden") !== "true")
    .filter((el) => !name(el))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}` +
             `@${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} ` +
             `html=${el.outerHTML.slice(0, 90).replace(/\s+/g, " ")}`;
    });
});

/**
 * THE CAPTAIN'S VIEW (SCRBRD-138 phase A): a signed-in pupil holding the
 * captaincy honour, on a phone, against tools/a11y-captain-mock.mjs — no
 * server, no database. The card on Home, the section on his fixture, and the
 * Captain tab of a match with his side fielding, batting, and over. Each
 * screen goes through the same ratchets as the rest (12px, 44px, AA, emoji)
 * and has every control named. Who may see what is the pupil walk's, against
 * the real stack; this walk only counts what is drawn.
 */
async function captainWalk(theme) {
  const scheme = theme === "daylight" ? "light" : "dark";
  const T_ = theme === "daylight" ? "Daylight" : "Floodlit";
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await offline(ctx);
  const handle = captainApi();
  await ctx.route((url) => url.hostname === "localhost" && url.pathname.startsWith("/api/"), (route) => {
    const u = new URL(route.request().url());
    const r = handle(route.request().method(), u.pathname, u.searchParams);
    return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = "http://localhost:${PORT}";`);
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const tap = async (id, ms = 800) => { await tid(id).click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(ms); };
  /** Measure a screen, and have every control on it named. */
  const check = async (screen) => {
    await measure(page, theme, screen);
    const unnamed = await unnamedControlsOf(page);
    ok(`${T_} ${screen}: every control has a name`, unnamed.length === 0, unnamed.slice(0, 4).join(", "));
  };
  try {
    group(`${T_} — the captain's view`);
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    for (const re of [/Get Started|Log In/]) {
      const l = page.locator("button:not([disabled])", { hasText: re }).first();
      if (await l.count()) { await l.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500); }
    }
    await page.locator("#login-email").fill("pillay@example.invalid");
    await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2200);
    ok("the pupil signs in, to his own app", await tid("persona-bar").count() === 1);
    ok("Home carries the Captain card", await tid("captain-card").count() === 1);
    await check("captainhome");

    await tap("mnav-mymatches", 1500);
    await tap(`fixture-row-${MATCH.day}`, 1800);
    ok("the fixture carries the Captain section", await tid("captain-section").count() === 1);
    await check("captainfixture");
    await tap("family-back", 600);

    for (const [screen, id, what] of [["captainfield", MATCH.field, "his side fielding"], ["captainbat", MATCH.bat, "his side batting"]]) {
      await tap(`live-row-${id}`, 1800);
      await tap("mc-tab-captain", 1200);
      ok(`the Captain tab is drawn, ${what}`, await tid("mc-captain").count() === 1);
      if (screen === "captainfield") {
        ok("...with overs left in the cap's own words beside the bowler on four", (await tid(`mc-captain-cap-${IDS.naidoo}`).innerText({ timeout: 2000 }).catch(() => "")).trim() === "Has bowled his 4 overs");
      } else {
        ok("...with the next in, from the sheet", /Pillay/.test(await tid("mc-captain-next-in").innerText({ timeout: 2000 }).catch(() => "")));
      }
      await check(screen);
      await tap("mc-back", 700);
    }
    await tap(`played-row-${MATCH.played}`, 1800);
    await tap("mc-tab-captain", 1500);
    ok("the Captain tab is drawn, after the match", await tid("mc-captain").count() === 1);
    await check("captainafter");
    ok(`no page errors on the captain's screens`, errors.length === 0, errors.join(" | "));
  } catch (e) {
    ok(`the ${T_} captain walk threw: ${e.message?.slice(0, 160)}`, false);
  } finally {
    await ctx.close();
  }
}

/**
 * THE COACH'S COCKPIT (SCRBRD-136/137 phase A): a signed-in coach of the 1XI, on
 * a phone, against tools/a11y-cockpit-mock.mjs — no server, no database. The
 * match-day card on his Dashboard, the Coach tab before the first ball and with
 * the match live, and the feed's drawer. Each is measured inside its own region
 * (the card, the tab, the drawer) by the same ratchets as the rest (12px, 44px,
 * AA, emoji), every control is named, and the drawer is reached by keyboard:
 * focus moves into it, Tab stays inside, Escape closes it and focus comes back.
 * Who may see what is the cockpit walk's, against the real stack.
 * @param {"floodlit" | "daylight"} theme
 */
async function cockpitWalk(theme) {
  const scheme = theme === "daylight" ? "light" : "dark";
  const T_ = theme === "daylight" ? "Daylight" : "Floodlit";
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await offline(ctx);
  const handle = cockpitApi();
  await ctx.route((url) => url.hostname === "localhost" && url.pathname.startsWith("/api/"), (route) => {
    const u = new URL(route.request().url());
    const r = handle(route.request().method(), u.pathname, u.searchParams);
    return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = "http://localhost:${PORT}";`);
  const tid = (id) => page.locator(`[data-testid="${id}"]`);
  const tap = async (id, ms = 800) => { await tid(id).click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(ms); };
  /** Measure a screen inside its region, and have every control in it named. */
  const check = async (screen, region) => {
    ok(`${T_} ${screen}: the region is on the page`, await page.locator(region).count() === 1);
    await measure(page, theme, screen, region);
    const unnamed = (await unnamedControlsOf(page)).filter((c) => c);
    const inRegion = await page.evaluate((region) => [...document.querySelectorAll(`${region} button, ${region} a[href], ${region} input, ${region} select`)]
      .filter((el) => !(el.getAttribute("aria-label") || el.textContent || "").trim()).length, region);
    ok(`${T_} ${screen}: every control in it has a name`, inRegion === 0, unnamed.slice(0, 3).join(", "));
  };
  try {
    group(`${T_} — the coach's cockpit`);
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    const lg = page.locator("button:not([disabled])", { hasText: /Get Started|Log In/ }).first();
    if (await lg.count()) { await lg.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500); }
    await page.locator("#login-email").fill("coach@example.invalid");
    await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2400);
    ok("the coach signs in", await tid("os-main").count() === 1);
    await page.waitForSelector('[data-testid="matchday-count"]', { timeout: 8000 }).catch(() => {});
    ok("his Dashboard carries the match-day card", await tid("day-matchday").count() === 1);
    await check("cockpithome", '[data-testid="day-matchday"]');

    await tap("matchday-open", 3000);
    ok("one tap opens the Coach tab of the fixture", await tid("mc-coach").count() === 1);
    await page.waitForFunction(() => !document.querySelector('[data-testid="mc-coach-loading"]'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    ok("...with the day, the side and the week drawn", await tid("coach-day").count() === 1 && await tid("coach-side").count() === 1 && await tid("coach-week").count() === 1);
    await check("cockpitday", '[data-testid="mc-coach"]');

    // The drawer, by keyboard.
    await tid("coach-signals-open").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    ok("Enter on the Signals button opens the drawer, and focus moves into it", await tid("signals").count() === 1 && await page.evaluate(() => !!document.activeElement?.closest('[data-testid="signals"]')));
    ok("the cards are articles, each with its evidence as text", await page.evaluate(() => { const a = [...document.querySelectorAll('[data-testid="signals"] article')]; return a.length > 0 && a.every((x) => x.innerText.trim().length > 10 && x.getAttribute("aria-labelledby")); }));
    await check("cockpitdrawer", '[data-testid="signals"]');
    for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
    ok("Tab stays inside the open drawer", await page.evaluate(() => !!document.activeElement?.closest('[data-testid="signals"]')));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    ok("Escape closes it and focus returns to the button that opened it", await tid("signals").count() === 0 && await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "coach-signals-open");

    await tap("mc-back", 800);
    await tap(`mc-open-${COCKPIT.live}`, 1800);
    await tap("mc-tab-coach", 2500);
    ok("the live match has the Coach tab, with the Board and the bowlers' overs left", await tid("coach-board").count() === 1 && await tid("coach-bowlers").count() === 1);
    await check("cockpitlive", '[data-testid="mc-coach"]');
    ok("no page errors on the cockpit's screens", errors.length === 0, errors.join(" | "));
  } catch (e) {
    ok(`the ${T_} cockpit walk threw: ${e.message?.slice(0, 160)}`, false);
  } finally {
    await ctx.close();
  }
}

async function walk(theme) {
  const scheme = theme === "daylight" ? "light" : "dark";
  const ctx = await browser.newContext({ colorScheme: scheme });
  await offline(ctx);
  const page = await ctx.newPage();

  const click = async (re, ms = 4000) => {
    const l = page.locator("button:not([disabled])", { hasText: re }).first();
    if (!(await l.count())) return false;
    try { await l.click({ timeout: ms }); } catch { return false; }
    await page.waitForTimeout(300);
    return true;
  };

  const unnamedControls = () => unnamedControlsOf(page);

  const T_ = theme === "daylight" ? "Daylight" : "Floodlit";
  try {
    group(`${T_} — the theme is decided before the app runs`);
    // Hold the app's own script back, so what is on screen is only what
    // index.html did: if the page is already the right colour, it cannot
    // flash the wrong one while the bundle loads.
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => { await held; await route.continue().catch(() => {}); });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "commit" });
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-theme"), null, { timeout: 5000 }).catch(() => {});
    const early = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.documentElement).backgroundColor,
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
      app: document.getElementById("root")?.childElementCount ?? 0,
    }));
    const canvas = theme === "daylight" ? DAYLIGHT_CANVAS : FLOODLIT_CANVAS;
    ok(`before the app has drawn anything, the page is ${theme}`, early.app === 0 && early.theme === theme, JSON.stringify(early));
    ok("...painted in its canvas", early.bg === rgbOf(canvas), early.bg);
    ok("...with the browser's theme-color to match", early.meta === canvas, early.meta);
    release();
    await page.waitForLoadState("networkidle");
    ok("the app agrees once it runs", await page.evaluate(() => document.documentElement.dataset.theme) === theme);

    group(`${T_} — the stylesheet`);
    const css = await page.evaluate(() =>
      [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; } }).join("\n"));
    ok("a visible focus ring is defined", /:focus-visible[^{]*\{[^}]*outline:/.test(css));
    // One rule is allowed to remove the outline: the one that suppresses it for
    // MOUSE interaction, immediately after :focus-visible has defined it. Any
    // other outline:none is a focus indicator someone deleted.
    const outlineKills = (css.match(/[^}]*\{[^}]*outline:\s*(none|0)[^}]*\}/g) || [])
      .filter((r) => !/:focus:not\(:focus-visible\)/.test(r));
    ok("focus is never removed without a replacement", outlineKills.length === 0,
       outlineKills.slice(0, 2).join(" "));
    ok("prefers-reduced-motion is honoured", /prefers-reduced-motion/.test(css));
    ok("there is a skip link", /\.skip-link/.test(css));
    ok("the board's flip is defined, and cut by reduced motion with everything else", /\.os-board-flip/.test(css));

    group(`${T_} — landing and login`);
    // Both counts have to be able to fail: a 9px line, and pale grey on
    // white, put on the page and taken off again.
    const probe = await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = '<p style="font-size:9px">probe small</p><p style="color:#eeeeee;background:#ffffff;font-size:14px">probe pale</p>';
      document.body.appendChild(d);
      return true;
    });
    const probed = probe && await survey(page);
    await page.evaluate(() => document.body.lastElementChild.remove());
    ok("the floor count sees a 9px line", probed.some((i) => i.text === "probe small" && i.size < 12));
    ok("...and the contrast count sees pale grey on white", probed.some((i) => i.text === "probe pale" && i.ratio != null && i.ratio < 4.5));
    // ...and the emoji count sees one on a button, in a nav and in a name,
    // and not one in a paragraph somebody wrote.
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = '<button>🏏 Drive</button><nav><span>📅 Calendar</span></nav><button aria-label="🔔 Alerts">x</button><p>Great knock 🎉</p>';
      document.body.appendChild(d);
    });
    const emojiProbe = await emojiInControls(page);
    await page.evaluate(() => document.body.lastElementChild.remove());
    ok("...and the emoji count sees them in controls and names, not in prose", emojiProbe.length === 3, emojiProbe.join(" · "));
    // ...and the tap floor sees a 30px key, and not one hidden from everyone.
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = '<button style="width:30px;height:30px">probe key</button><button aria-hidden="true" style="width:30px;height:30px">hidden</button>';
      document.body.appendChild(d);
    });
    const tapProbe = await smallTargets(page);
    await page.evaluate(() => document.body.lastElementChild.remove());
    ok("...and the tap floor sees a 30px key, not a hidden one", tapProbe.some((t) => /probe key/.test(t)) && !tapProbe.some((t) => /hidden/.test(t)), tapProbe.join(" · "));
    // "landing" is the public home page since SCRBRD-142 (home.html, at / in
    // production; this walk's server answers / with the app, so it is asked
    // for by name). The app's own first screen is the login page.
    await page.goto(`http://localhost:${PORT}/home.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await measure(page, theme, "landing");
    let unnamed = await unnamedControls();
    ok("every control on the home page has a name", unnamed.length === 0, unnamed.slice(0, 4).join(", "));

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    await click(/Get Started|Log In/, 5000);
    await page.waitForTimeout(700);
    await measure(page, theme, "login");
    unnamed = await unnamedControls();
    ok("every control on the login page has a name", unnamed.length === 0, unnamed.slice(0, 4).join(", "));
    const labelled = await page.evaluate(() =>
      [...document.querySelectorAll("input")].every((i) =>
        i.getAttribute("aria-label") || (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`))));
    ok("every input is labelled, not merely placeheld", labelled);

    group(`${T_} — keyboard`);
    // Tab from the top and confirm focus actually lands somewhere visible.
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, text: (el.textContent || "").trim().slice(0, 30), outline: s.outlineStyle, width: s.outlineWidth };
    });
    ok("Tab moves focus off the body", first !== null);
    // Inline styles beat the stylesheet, and 17 inputs carried outline:none —
    // so every field in the app was focusable with no way to see it.
    const inputRing = await page.evaluate(() => {
      const i = document.querySelector("input");
      if (!i) return null;
      i.focus();
      return getComputedStyle(i).outlineStyle;
    });
    ok("a focused input is not stripped of its outline inline", inputRing !== "none", inputRing);

    group(`${T_} — inside the app`);
    await click("Head Coach", 4000);
    await click(/^Sign In$/, 5000);
    await page.waitForTimeout(1600);
    ok("signed in", /Dashboard|Match Centre/i.test(await page.$eval("body", (e) => e.innerText)));
    await measure(page, theme, "dashboard");
    // SCRBRD-131: the bell's count was 9px, under the floor, and the ratchet let it by.
    const bell = page.locator('[data-testid="nav-alerts-badge"]');
    ok("the notification bell shows its unread count", (await bell.count()) === 1);
    if (await bell.count()) {
      const size = await bell.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
      ok(`...in 12px at the least (${size}px)`, size >= 12);
    }

    unnamed = await unnamedControls();
    ok("every control in the shell has a name", unnamed.length === 0, unnamed.slice(0, 5).join(", "));

    // The day sheet's board carries the Tier 2 line (DESIGN_DIRECTION §10),
    // which rotates by itself — so it has a pause button (WCAG 2.2.2). Its
    // type and contrast are in the dashboard's counts above; its size and its
    // name are checked here, and that it does what it says.
    const pause = page.locator('[data-testid="day-board-insight-pause"]');
    ok("the day sheet's board has its rotating line, and a pause button for it", (await pause.count()) === 1);
    if (await pause.count()) {
      const box = await pause.boundingBox();
      ok(`...44px or more (${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)})`, box && box.width >= 44 && box.height >= 44);
      ok("...named for what it does", await pause.getAttribute("aria-label") === "Pause the rotating line");
      await pause.click({ timeout: 2000 });
      ok("...and does it: paused, it offers to play",
         await pause.getAttribute("aria-label") === "Play the rotating line"
         && await page.locator('[data-testid="day-board-insight"]').getAttribute("data-paused") === "true");
      await pause.click({ timeout: 2000 });
      ok("...and the line is not a live region",
         await page.evaluate(() => !document.querySelector('[data-testid="day-board-insight"]')?.closest("[aria-live]")));
    }
    const boardTargets = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="day-board"] button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
    ok("nothing tapped on the board is under 44px", boardTargets === 0, String(boardTargets));

    const landmarks = await page.evaluate(() => ({
      nav: document.querySelectorAll("nav").length,
      main: document.querySelectorAll("main").length,
      current: document.querySelectorAll("[aria-current]").length,
    }));
    ok("the page has navigation and main landmarks", landmarks.nav >= 1 && landmarks.main === 1);
    // The skip link exists so a keyboard user can reach the content without
    // tabbing through up to nineteen navigation entries on every page change.
    // It only has to precede the navigation, not every control in the document.
    ok("a skip link precedes the navigation",
       await page.evaluate(() => {
         const a = document.querySelector(".skip-link");
         const nav = document.querySelector("nav");
         return !!a && !!nav && !!(a.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING);
       }));
    ok("...and it targets the main region",
       await page.evaluate(() => {
         const a = document.querySelector(".skip-link");
         return !!a && !!document.querySelector(a.getAttribute("href"));
       }));
    ok("the active page is marked, not just tinted", landmarks.current >= 1);

    // A view change is told (WCAG 4.1.3) and focus follows it (2.4.3): the shell
    // swaps views without a page load, so without this a screen-reader user
    // hears nothing when they choose one and focus stays on the menu item.
    const announcer = page.locator('[data-testid="view-announcer"]');
    const viewRegion = await announcer.evaluate((e) => ({ live: e.getAttribute("aria-live"), atomic: e.getAttribute("aria-atomic"), text: e.textContent,
      hidden: getComputedStyle(e).position === "absolute" && e.getBoundingClientRect().width <= 1 })).catch(() => null);
    ok("view changes have a polite, atomic live region, visually hidden", viewRegion?.live === "polite" && viewRegion.atomic === "true" && viewRegion.hidden, JSON.stringify(viewRegion));
    ok("...which is empty on first load: nothing is announced for the page the app opens on", viewRegion?.text === "", JSON.stringify(viewRegion));
    const inMain = () => page.evaluate(() => { const m = document.getElementById("os-content"), a = document.activeElement;
      return { isMain: a === m, tag: a?.tagName, inside: !!m && m.contains(a), landmark: m?.tagName }; });

    // Settings → Me carries the theme control (DESIGN_DIRECTION §3.1).
    await page.locator("nav button", { hasText: /Settings/ }).first().click({ timeout: 6000 });
    await page.waitForTimeout(700);
    ok("choosing Settings says \"Settings, page loaded\"", await announcer.textContent() === "Settings, page loaded", await announcer.textContent());
    const afterSettings = await inMain();
    ok("...and moves focus to the main landmark, off the menu item", afterSettings.isMain && afterSettings.tag === "MAIN", JSON.stringify(afterSettings));
    await page.keyboard.press("Tab");
    const afterTab = await inMain();
    ok("...so the next Tab lands on the page's first control", afterTab.inside && !afterTab.isMain, JSON.stringify(afterTab));
    await page.locator('[role="tab"]', { hasText: /^Me$/ }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
    const onTab = await page.evaluate(() => document.activeElement?.getAttribute("role") + ":" + document.activeElement?.textContent?.trim());
    await page.waitForTimeout(2500);
    ok("a background refresh of the data moves nothing: focus is where the person left it",
       await page.evaluate(() => document.activeElement?.getAttribute("role") + ":" + document.activeElement?.textContent?.trim()) === onTab
       && onTab === "tab:Me", onTab);
    ok("...and says nothing more", await announcer.textContent() === "Settings, page loaded");
    const settingsChoice = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="theme-choice"]');
      return g ? { role: g.getAttribute("role"), radios: [...g.querySelectorAll('[role="radio"]')].map((b) => [b.textContent.trim(), b.getAttribute("aria-checked")]) } : null;
    });
    ok("Settings offers System, Daylight and Floodlit as one radiogroup",
       settingsChoice?.role === "radiogroup" && settingsChoice.radios.map((r) => r[0]).join() === "System,Daylight,Floodlit", JSON.stringify(settingsChoice));
    ok("...with System chosen on a device that has chosen nothing", settingsChoice?.radios.find((r) => r[0] === "System")?.[1] === "true");

    await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
    await page.waitForTimeout(900);
    ok("a second view change: the words change to \"Match Centre, page loaded\"", await announcer.textContent() === "Match Centre, page loaded", await announcer.textContent());
    ok("...and focus is on the main landmark again", (await inMain()).isMain);
    await measure(page, theme, "matchcentre");
    // The fixture's own view (step 3c): its Scorecard, the densest tab.
    await page.locator('[data-testid^="mc-open-"]').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(900);
    await page.locator('[data-testid="mc-tab-scorecard"]').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    ok("the Match Centre opens a fixture into its own view", await page.locator('[data-testid="mc-scorecard"]').count() === 1);
    await measure(page, theme, "matchview");

    // SCRBRD-102: the Analytics tab, on the same fixture — the wagon-wheel
    // analysis panel (scorer/wagonAnalysisPanel.jsx's WagonAnalysisPanel),
    // never opened by this walk before.
    await page.locator('[data-testid="mc-tab-analytics"]').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
    ok("the Match Centre's Analytics tab is drawn", await page.locator('[data-testid="mc-analytics"]').count() === 1);
    // The falsification: a 9px line, pale-on-white text and an emoji in a
    // control, planted on THIS screen — proving the ratchets below would
    // actually catch them, not just read a number they never had a chance to
    // move (the same three probes the landing page's own floors get, §"landing
    // and login" above).
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = '<p style="font-size:9px">analytics probe small</p>' +
        '<p style="color:#eeeeee;background:#ffffff;font-size:14px">analytics probe pale</p>' +
        '<button>🎯 Probe</button>';
      document.body.appendChild(d);
    });
    const analyticsProbeText = await survey(page);
    const analyticsProbeEmoji = await emojiInControls(page);
    await page.evaluate(() => document.body.lastElementChild.remove());
    ok("...the Analytics probe: a 9px line is seen", analyticsProbeText.some((i) => i.text === "analytics probe small" && i.size < 12));
    ok("...pale-on-white text is seen", analyticsProbeText.some((i) => i.text === "analytics probe pale" && i.ratio != null && i.ratio < 4.5));
    ok("...and an emoji in a control is seen", analyticsProbeEmoji.length > 0, analyticsProbeEmoji.join(" · "));
    await measure(page, theme, "analytics");

    await page.locator('[data-testid="mc-back"]').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);

    // A player profile's Career tab — season and career figures, dismissal
    // and wicket breakdowns, and the career wagon wheel — never opened by
    // this walk before either.
    group(`${T_} — a player profile's Career tab`);
    await page.locator("nav button", { hasText: /Profiles/ }).first().click({ timeout: 6000 });
    await page.waitForTimeout(700);
    await page.locator('[data-testid^="roster-player-"]').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('[data-testid="profile-tab-career"]').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    ok("the profile's Career tab is drawn", await page.locator('[data-testid="dismissal-breakdown-batting"]').count() === 1);
    // The falsification, same as the Analytics tab's above.
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = '<p style="font-size:9px">career probe small</p>' +
        '<p style="color:#eeeeee;background:#ffffff;font-size:14px">career probe pale</p>' +
        '<button>🎯 Probe</button>';
      document.body.appendChild(d);
    });
    const careerProbeText = await survey(page);
    const careerProbeEmoji = await emojiInControls(page);
    await page.evaluate(() => document.body.lastElementChild.remove());
    ok("...the Career probe: a 9px line is seen", careerProbeText.some((i) => i.text === "career probe small" && i.size < 12));
    ok("...pale-on-white text is seen", careerProbeText.some((i) => i.text === "career probe pale" && i.ratio != null && i.ratio < 4.5));
    ok("...and an emoji in a control is seen", careerProbeEmoji.length > 0, careerProbeEmoji.join(" · "));
    await measure(page, theme, "career");

    await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
    await page.waitForTimeout(800);
    await click(/^Live$/, 2500);
    await click(/Open Live Scorer|Start Scoring/i, 5000);
    await page.waitForTimeout(1600);

    // The new-over sheet is up the moment the scorer opens, which makes this
    // the natural place to check the dialog contract rather than trying to
    // provoke one later.
    group(`${T_} — dialogs`);
    // A resumed fixture already has batters and a bowler, so nothing blocks the
    // pad. Recording a wicket opens the dismissal sheet, which is the modal a
    // scorer meets most often and under the most time pressure.
    await measure(page, theme, "pad");
    if (!(await page.locator('[data-testid="basic-pad"]').count())) { await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {}); await page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 }).catch(() => {}); }
    await page.waitForTimeout(400);
    await page.locator('button[aria-label="Wicket"]').first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (process.env.A11Y_DEBUG) console.log("[debug] scorer:\n" + (await page.$eval("body", (e) => e.innerText)).slice(0, 300));
    const dlg = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? { modal: d.getAttribute("aria-modal"), named: !!d.getAttribute("aria-labelledby"),
                   focusInside: d.contains(document.activeElement) } : null;
    });
    ok("the dismissal sheet is a modal dialog", dlg?.modal === "true");
    ok("...with a name", !!dlg?.named);
    ok("...and focus moved into it", !!dlg?.focusInside);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    ok("Escape closes it", await page.evaluate(() => !document.querySelector('[role="dialog"]')));

    group(`${T_} — the scoring pad`);
    for (let i = 0; i < 4; i++) {
      const b = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ }).first();
      if (await b.count()) { try { await b.click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); }
    }
    if (!(await page.locator('[data-testid="basic-pad"]').count())) { await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {}); await page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 }).catch(() => {}); }
    await page.waitForTimeout(500);

    unnamed = await unnamedControls();
    ok("every key on the pad has a name", unnamed.length === 0, unnamed.slice(0, 5).join(", "));

    // The keys read "4" and "·" and "↩". None of those is a cricket outcome.
    const names = await page.evaluate(() =>
      [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")));
    ok("the boundary key says what it does", names.some((n) => /four/i.test(n)), names.slice(0, 6).join(" | "));
    ok("the dot ball key says what it does", names.some((n) => /dot ball/i.test(n)));
    ok("undo says what it undoes", names.some((n) => /undo/i.test(n)));

    ok("the score is in a live region",
       await page.evaluate(() => !!document.querySelector('[aria-live="polite"]')));

    // The pad's own change of view (its tab bar) moves focus to the pad's main,
    // like the shell's; nothing else the pad does does (checked after the taps).
    await page.locator('[data-testid="pad-tabs"] button', { hasText: /Cards/ }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    const padFocus = await page.evaluate(() => ({ id: document.activeElement?.id, tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute("aria-label") }));
    ok("choosing the pad's Cards view moves focus to its main landmark, named for the view", padFocus.id === "pad-content" && padFocus.tag === "MAIN" && padFocus.label === "Cards", JSON.stringify(padFocus));
    await page.locator('[data-testid="pad-tabs"] button', { hasText: /Score/ }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);

    // ── The over as chips (DESIGN_DIRECTION §10, step 3b) ──
    // A run, a four and a wide, so the board draws chips of three kinds; then
    // the pad is measured again as "padOver", against the same floors as the
    // pad: the chips' figures are text on their own fill, so the contrast
    // count measures them on the colour they sit on.
    // An extra is two taps since SCRBRD-100: the kind, then its runs.
    for (const keys of [["run-1"], ["run-4"], ["key-wide", "extra-run-0"]]) {
      for (const key of keys) await page.locator(`[data-testid="${key}"]`).first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    const chips = await page.evaluate(() => [...document.querySelectorAll('[data-testid="board-over"] [data-chip]')].map((c) => {
      const r = c.getBoundingClientRect();
      return { kind: c.dataset.chip, text: c.textContent, w: r.width, h: r.height, tab: getComputedStyle(c).fontVariantNumeric };
    }));
    ok(`the over is drawn as chips, each carrying its figure (${chips.map((c) => c.text).join(" ")})`,
       chips.length >= 3 && chips.every((c) => c.text.trim().length > 0) && chips.some((c) => c.kind === "four") && chips.some((c) => c.kind === "extra"));
    ok("...every chip at least 24px, with tabular figures",
       chips.every((c) => c.w >= 24 && c.h >= 24 && /tabular-nums/.test(c.tab)), JSON.stringify(chips.filter((c) => c.w < 24 || c.h < 24)));
    ok("...and the over is said in words", /This over: .*4 runs.*wide/.test(await page.locator('[data-testid="board-over"] .sr-only').textContent().catch(() => "")));
    ok("scoring balls never moved focus to the main landmark (only a change of view does)", await page.evaluate(() => document.activeElement?.id !== "pad-content"));
    await measure(page, theme, "padOver");

    // ── Pro mode (SCRBRD-095 item 2) ──
    // The hub (scoring.jsx) and the cards it shows (panels.jsx, charts.jsx'
    // ManhattanChart) kept their pre-2.1 styling — sub-12px labels, badges and
    // pills below the tap floor — because this walk never opened them: the
    // pad it measures every run is the three-phase or Basic Scoring one.
    // Falsified below, on this exact screen, before it is trusted.
    group(`${T_} — Pro mode`);
    await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="pad-pro-mode"]').click({ timeout: 2500 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    ok("Pro mode replaces the three-phase pad with the hub",
       await page.evaluate(() => !document.querySelector('[data-testid="three-phase-pad"]') && !document.querySelector('[data-testid="basic-pad"]')));
    // The falsification: a 9px line, a 30px key and an emoji, planted on THIS
    // screen — proving the plumbing a "pro" ceiling relies on actually sees
    // what is on it, not only what the landing page's own probe (above)
    // already proved of the shared survey/smallTargets/emoji functions.
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.innerHTML = '<p style="font-size:9px">pro probe small</p><button style="width:30px;height:30px">🎯</button>';
      document.body.appendChild(d);
    });
    const proProbeText = await survey(page);
    const proProbeTiny = await smallTargets(page);
    const proProbeEmoji = await emojiInControls(page);
    await page.evaluate(() => document.body.lastElementChild.remove());
    ok("...the Pro mode probe: a 9px line is seen", proProbeText.some((i) => i.text === "pro probe small" && i.size < 12));
    ok("...a 30px key is seen", proProbeTiny.some((t) => /30x30/.test(t)));
    ok("...and an emoji in a control is seen", proProbeEmoji.length > 0, proProbeEmoji.join(" · "));
    await measure(page, theme, "pro");
    unnamed = await unnamedControls();
    ok("every control in Pro mode has a name", unnamed.length === 0, unnamed.slice(0, 5).join(", "));
    // Back to the ordinary pad, so the rest of this walk (menu, theme,
    // Colours) drives the screen it always has.
    await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="pad-pro-mode"]').click({ timeout: 2500 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // ── A switch while the app is open ──
    const flipTo = theme === "daylight" ? "floodlit" : "daylight";
    group(`${T_} → ${flipTo === "daylight" ? "Daylight" : "Floodlit"} while the app is open`);
    // Every screen above has been drawn in this theme, and the lazy views
    // have loaded in it. Now the device switches — as a phone does at dusk or
    // at sunrise — and every screen, the pad first, must be in the new theme
    // without a reload: nothing may still wear one of the old theme's own
    // surfaces or inks. A colour copied into a constant when its module
    // loaded is exactly what this finds.
    await page.emulateMedia({ colorScheme: flipTo === "daylight" ? "light" : "dark" });
    await page.waitForTimeout(800);
    const stale = theme === "floodlit" ? FLOODLIT_ONLY : DAYLIGHT_ONLY;
    const pad = await staleOn(page, stale);
    ok("the device's switch applies without a reload", pad.theme === flipTo, pad.theme);
    ok("...the page and the browser's theme-color follow it",
       pad.body === rgbOf(flipTo === "daylight" ? DAYLIGHT_CANVAS : FLOODLIT_CANVAS) && pad.meta === (flipTo === "daylight" ? DAYLIGHT_CANVAS : FLOODLIT_CANVAS),
       `${pad.body} ${pad.meta}`);
    ok("...and nothing on the pad keeps the old theme", pad.hits.length === 0, pad.hits.slice(0, 4).join(" · "));
    // Out of the pad and through the screens the walk has already loaded.
    await page.locator(".os-exit-scorer").click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(900);
    for (const [label, to] of [["Match Centre", /Match Centre/], ["Settings", /Settings/], ["Dashboard", /Dashboard/]]) {
      await page.locator("nav button", { hasText: to }).first().click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(800);
      const s = await staleOn(page, stale);
      ok(`...nor on ${label}`, s.hits.length === 0, s.hits.slice(0, 4).join(" · "));
    }
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(500);
    ok("...and back again", await page.evaluate(() => document.documentElement.dataset.theme) === theme);
    await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
    await page.waitForTimeout(800);
    await click(/^Live$/, 2500);
    await click(/Open Live Scorer|Start Scoring/i, 5000);
    await page.waitForTimeout(1200);

    // ── The pad's menu: the override, live and remembered ──
    group(`${T_} — the pad's menu`);
    const menu = page.locator('[data-testid="pad-menu"]');
    ok("the pad has a menu, and it is named", (await menu.count()) === 1 && (await menu.getAttribute("aria-label")) === "Pad menu");
    await menu.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    ok("...which opens, and says so", (await menu.getAttribute("aria-expanded")) === "true"
       && await page.locator('[data-testid="pad-theme-choice"][role="radiogroup"]').count() === 1);
    const other = flipTo;
    await page.locator(`[data-testid="pad-theme-choice-${other}"]`).click({ timeout: 3000 });
    await page.waitForTimeout(400);
    const afterOverride = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      stored: (() => { try { return localStorage.getItem("scrbrd:theme"); } catch { return "x"; } })(),
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
      checked: document.querySelector('[data-testid="pad-theme-choice"] [aria-checked="true"]')?.textContent.trim(),
    }));
    ok(`choosing ${other} on the pad overrides the device (${scheme})`, afterOverride.theme === other, JSON.stringify(afterOverride));
    ok("...is the checked choice", afterOverride.checked?.toLowerCase() === other);
    ok("...is stored on this device", afterOverride.stored === other);
    ok("...and the browser's theme-color follows", afterOverride.meta === (other === "daylight" ? DAYLIGHT_CANVAS : FLOODLIT_CANVAS));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    ok("Escape closes the menu", (await menu.getAttribute("aria-expanded")) === "false");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    ok("the override survives a reload", await page.evaluate(() => document.documentElement.dataset.theme) === other);
    // System again, through the control where it is on screen: the device's
    // own setting decides once more, and nothing is left stored.
    if (await page.locator('[data-testid="pad-menu"]').count()) {
      await page.locator('[data-testid="pad-menu"]').click({ timeout: 3000 });
      await page.waitForTimeout(300);
      await page.locator('[data-testid="pad-theme-choice-system"]').click({ timeout: 3000 });
    } else {
      await page.evaluate(() => { try { localStorage.removeItem("scrbrd:theme"); } catch { /* nothing to remove */ } });
      await page.reload({ waitUntil: "networkidle" });
    }
    await page.waitForTimeout(600);
    ok("choosing System hands the decision back to the device",
       await page.evaluate(() => document.documentElement.dataset.theme) === theme
       && await page.evaluate(() => { try { return localStorage.getItem("scrbrd:theme"); } catch { return null; } }) === null);

    // ── Colours (§3.9): beside the theme on the pad's menu ──
    group(`${T_} — Colours on the pad's menu`);
    const chipFills = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="board-over"] [data-chip]')]
      .filter((c) => c.dataset.chip !== "dot").map((c) => `${c.dataset.chip}:${getComputedStyle(c).backgroundColor}`).join("|"));
    const standardFills = await chipFills();
    if (!(await page.locator('[data-testid="pad-vision-choice"]').count())) {
      await page.locator('[data-testid="pad-menu"]').click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    ok("the menu offers Colours as one radiogroup: Standard, Red-green safe, Blue-yellow safe",
       await page.evaluate(() => [...document.querySelectorAll('[data-testid="pad-vision-choice"][role="radiogroup"] [role="radio"]')]
         .map((b) => b.textContent.trim()).join()) === "Standard,Red-green safe,Blue-yellow safe");
    await page.locator('[data-testid="pad-vision-choice-redgreen"]').click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    const rg = await page.evaluate(() => ({
      vision: document.documentElement.dataset.vision, theme: document.documentElement.dataset.theme,
      stored: (() => { try { return localStorage.getItem("scrbrd:vision"); } catch { return "x"; } })(),
    }));
    ok("choosing Red-green safe applies it, and keeps the theme", rg.vision === "redgreen" && rg.theme === theme, JSON.stringify(rg));
    ok("...is stored on this device", rg.stored === "redgreen");
    const rgFills = await chipFills();
    ok("...and the chips change colour (and nothing else about them)", standardFills !== "" && rgFills !== standardFills
       && rgFills.split("|").map((x) => x.split(":")[0]).join() === standardFills.split("|").map((x) => x.split(":")[0]).join(), `${standardFills} → ${rgFills}`);
    await page.keyboard.press("Escape");
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    ok("Colours survives a reload", await page.evaluate(() => document.documentElement.dataset.vision) === "redgreen");
    if (await page.locator('[data-testid="pad-menu"]').count()) {
      await page.locator('[data-testid="pad-menu"]').click({ timeout: 3000 });
      await page.waitForTimeout(300);
      await page.locator('[data-testid="pad-vision-choice-standard"]').click({ timeout: 3000 });
    } else {
      await page.evaluate(() => { try { localStorage.removeItem("scrbrd:vision"); } catch { /* nothing to remove */ } });
      await page.reload({ waitUntil: "networkidle" });
    }
    await page.waitForTimeout(400);
    ok("choosing Standard puts the colours back and stores nothing",
       await page.evaluate(() => document.documentElement.dataset.vision) === "standard"
       && await page.evaluate(() => { try { return localStorage.getItem("scrbrd:vision"); } catch { return "x"; } }) === null);
  } catch (e) {
    ok(`the ${theme} accessibility walk threw: ${e.message?.slice(0, 100)}`, false);
  } finally {
    await ctx.close();
  }
}

/**
 * §4 rule 1 — no scrolling to reach a key — for the strip the pad always
 * carries (Wide, No ball, Dot, Undo), on phones, where the bottom bar sits
 * over the page. Step 3b grew the board (the partnership, the chips) and
 * a chase's two-line target pushed the strip 19px under the bar at 390×844;
 * this keeps it from coming back.
 *
 *   390×844  the strip's bottom at least STRIP_CLEAR above the bar's top,
 *            in its own place (no key under it or below it), page unscrolled —
 *            three-phase (the Shot phase it opens on, and Outcome) and Basic
 *            Scoring, first innings and a chase;
 *   360×740  a small Android: the strip on screen above the bar without
 *            scrolling (it docks there: .pad-strip-dock), the number printed.
 *
 * The chase is the board's own sub-line element given a chase's words —
 * "Need 45 off 34 · CRR 9.91 · RRR 7.94", two lines at 390 — because the
 * demo has no second innings to open. The over is a real one: a run, a four,
 * a six, a wide and a no-ball, recorded on the pad.
 */
const STRIP_CLEAR = 16;
async function padFit() {
  for (const [w, hgt] of [[390, 844], [360, 740]]) {
    const ctx = await browser.newContext({ colorScheme: "dark", viewport: { width: w, height: hgt } });
    await offline(ctx);
    const page = await ctx.newPage();
    try {
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
      const click = async (re) => { const l = page.locator("button:not([disabled])", { hasText: re }).first(); if (await l.count()) { await l.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(400); } };
      await click(/Get Started|Log In/); await click("Head Coach"); await click(/^Sign In$/); await page.waitForTimeout(1500);
      await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
      await page.waitForTimeout(800); await click(/^Live$/); await click(/Open Live Scorer|Start Scoring/i); await page.waitForTimeout(1600);
      const basic = async (on) => {
        if (((await page.locator('[data-testid="basic-pad"]').count()) > 0) === on) return;
        await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 });
        await page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      };
      await basic(true);
      for (const k of ["run-1", "run-4", "run-6"]) { await page.locator(`[data-testid="${k}"]`).click({ timeout: 3000 }); await page.waitForTimeout(1900); }
      // The extras in two taps (SCRBRD-100): the kind, then the runs.
      for (const k of ["key-wide", "key-noball"]) {
        await page.locator(`[data-testid="${k}"]`).click({ timeout: 3000 });
        await page.locator('[data-testid="extra-run-0"]').click({ timeout: 3000 });
        await page.waitForTimeout(1900);
      }
      await page.waitForTimeout(600);
      const where = () => page.evaluate(() => {
        scrollTo(0, 0);
        const strip = document.querySelector('[data-testid="pad-strip"]').getBoundingClientRect();
        const bar = document.querySelector('[data-testid="pad-tabs"]').getBoundingClientRect();
        const pad = document.querySelector('[data-testid="three-phase-pad"], [data-testid="basic-pad"]');
        const keys = [...pad.querySelectorAll("button")].filter((k) => !k.closest('[data-testid="pad-strip"]')).map((k) => k.getBoundingClientRect());
        return { clear: Math.round(bar.top - strip.bottom), stripBottom: Math.round(strip.bottom), barTop: Math.round(bar.top), scrollY: scrollY,
                 covered: keys.filter((k) => k.bottom > strip.top).length, chips: document.querySelectorAll('[data-testid="board-over"] [data-chip]').length };
      });
      const chase = () => page.evaluate(() => { document.querySelector('[data-testid="board-sub"]').textContent = "Need 45 off 34 · CRR 9.91 · RRR 7.94"; });
      const cases = [["three-phase, Shot", false, null], ["three-phase, Outcome", false, "outcome"], ["Basic Scoring", true, null]];
      for (const [name, isBasic, phase] of cases) {
        for (const innings of ["first innings", "a chase"]) {
          await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(1500);
          await basic(isBasic);
          if (phase === "outcome") {
            await page.locator('[data-testid="shot-drive"]').click({ timeout: 3000 });
            await page.locator('[data-testid="area-none"]').click({ timeout: 3000 });
          }
          if (innings === "a chase") await chase();
          const m = await where();
          const at = `${w}×${hgt} ${name}, ${innings}: strip ${m.clear}px above the bar (${m.chips} chips; ${m.covered} key${m.covered === 1 ? "" : "s"} under or below it)`;
          console.log(`  (${at})`);
          if (w === 390) ok(`${at} — at least ${STRIP_CLEAR}, in its place, unscrolled`, m.clear >= STRIP_CLEAR && m.covered === 0 && m.scrollY === 0 && m.chips >= 6, JSON.stringify(m));
          else ok(`${at} — on screen without scrolling`, m.clear >= 0 && m.stripBottom <= hgt && m.scrollY === 0, JSON.stringify(m));
          // An extra's second tap (SCRBRD-100 item 3) asks its runs in the
          // pad's own space: the strip stays where the thumb is, and the
          // runs are on screen above it. The no-ball's is the tallest.
          if (innings === "a chase") {
            const before = await page.evaluate(() => Math.round(document.querySelector('[data-testid="pad-strip"]').getBoundingClientRect().top));
            await page.locator('[data-testid="key-noball"]').click({ timeout: 3000 });
            await page.waitForTimeout(250);
            const open = await page.evaluate(() => {
              const strip = document.querySelector('[data-testid="pad-strip"]').getBoundingClientRect();
              const keys = [...document.querySelectorAll('[data-testid="extra-panel"] button')].map((k) => k.getBoundingClientRect());
              const board = document.querySelector('[data-testid="pad-board"]').getBoundingClientRect();
              return { stripTop: Math.round(strip.top), keys: keys.length, above: keys.every((k) => k.bottom <= strip.top + 1),
                       onScreen: keys.every((k) => k.top >= 0), overBoard: keys.some((k) => k.top < board.bottom), scrollY };
            });
            ok(`${w}×${hgt} ${name}: the no-ball's runs open over the pad's keys, the strip unmoved (${before} → ${open.stripTop}), none over the board`,
               open.keys >= 10 && open.stripTop === before && open.above && open.onScreen && !open.overBoard && open.scrollY === 0, JSON.stringify(open));
            await page.locator('[data-testid="extra-cancel"]').click({ timeout: 3000 });
          }
        }
      }
    } catch (e) {
      ok(`the ${w}×${hgt} pad-fit walk threw: ${e.message?.slice(0, 100)}`, false);
    } finally {
      await ctx.close();
    }
  }
}

/**
 * SCRBRD-133 G1: the ground display at its three sizes, through every panel
 * of its rotation (the dwell shortened by its own test hook), measured by the
 * same three ratchets as every other screen: the type floor, contrast on what
 * is actually behind the text, emoji in controls. The daylight pass opens the
 * display's own Daylight setting. Falsified on the display itself first.
 * @param {"floodlit" | "daylight"} theme
 */
async function displayWalk(theme) {
  for (const [w, h, screen] of [[1920, 1080, "display1080"], [1024, 768, "display768"], [390, 844, "display390"]]) {
    const ctx = await browser.newContext({ colorScheme: theme === "daylight" ? "light" : "dark", viewport: { width: w, height: h } });
    await offline(ctx);
    const page = await ctx.newPage();
    try {
      await page.addInitScript("window.__SCRBRD_DISPLAY_DWELL_MS__ = 900;");
      await page.goto(`http://localhost:${PORT}/display/${DISPLAY_ID}${theme === "daylight" ? "?theme=daylight" : ""}`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="display-panel"] section', { timeout: 8000 }).catch(() => {});
      const drawn = await page.evaluate(() => document.querySelector('[data-testid="display"]')?.getAttribute("data-theme-display"));
      ok(`${theme} ${w}×${h}: the ground display is drawn${theme === "daylight" ? ", in its own Daylight" : ""}`, drawn === theme, String(drawn));
      if (screen === "display1080") {
        await page.evaluate(() => {
          const d = document.createElement("div");
          d.innerHTML = '<p style="font-size:9px">display probe small</p><p style="color:#1a1f1a;font-size:14px">display probe dark</p>';
          document.querySelector('[data-testid="display-panel"]').appendChild(d);
        });
        const probe = await survey(page);
        await page.evaluate(() => document.querySelector('[data-testid="display-panel"]').lastElementChild.remove());
        ok(`${theme}: the display probe — a 9px line is seen`, probe.some((i) => i.text === "display probe small" && i.size < 12));
        ok(`${theme}: ...and near-black on the board's black is seen`, probe.some((i) => i.text === "display probe dark" && i.ratio != null && i.ratio < 4.5));
      }
      const most = { type: 0, contrast: 0, emoji: 0 };
      const panels = new Set();
      for (let i = 0; i < 5; i++) {
        panels.add(await page.evaluate(() => document.querySelector('[data-testid="display"]')?.getAttribute("data-panel")));
        await measure(page, theme, screen);
        for (const k of /** @type {const} */ (["type", "contrast", "emoji"])) most[k] = Math.max(most[k], measured[theme][k][screen]);
        await page.waitForTimeout(900);
      }
      for (const k of /** @type {const} */ (["type", "contrast", "emoji"])) measured[theme][k][screen] = most[k];
      ok(`${theme} ${w}×${h}: measured over the cycle's three panels (${[...panels].join(", ")})`,
         ["partnership", "overs", "bowling"].every((p) => panels.has(p)), [...panels].join(", "));
    } catch (e) {
      ok(`the ${theme} ${w}×${h} display walk threw: ${/** @type {any} */ (e).message?.slice(0, 100)}`, false);
    } finally {
      await ctx.close();
    }
  }
}

try {
  await walk("floodlit");
  await captainWalk("floodlit");
  await cockpitWalk("floodlit");
  await walk("daylight");
  await captainWalk("daylight");
  await cockpitWalk("daylight");

  group("The ground display (SCRBRD-133 G1) — three sizes, every panel");
  await displayWalk("floodlit");
  await displayWalk("daylight");

  group("The pad's strip on a phone (§4 rule 1) — no scrolling to reach it");
  await padFit();

  group("The type floor (§3.2) — a ratchet");
  for (const th of ["floodlit", "daylight"]) {
    for (const [screen, ceiling] of Object.entries(TYPE_FLOOR_CEILING)) {
      const n = measured[th].type[screen];
      ok(`${th} ${screen}: ${n} rendered text under 12px (ceiling ${ceiling})`, n != null && n <= ceiling);
    }
  }
  const lower = Object.entries(TYPE_FLOOR_CEILING).filter(([s, c]) => measured.floodlit.type[s] != null && measured.floodlit.type[s] < c);
  if (lower.length) console.log(`  (lower the ceiling: ${lower.map(([s]) => `${s} ${measured.floodlit.type[s]}`).join(", ")})`);

  group("The tap floor on the pad (§3.5) — a ratchet");
  for (const th of ["floodlit", "daylight"]) {
    for (const [screen, ceiling] of Object.entries(TAP_FLOOR_CEILING)) {
      const n = measured[th].tap[screen];
      ok(`${th} ${screen}: ${n} tapped under 44px (ceiling ${ceiling})`, n != null && n <= ceiling);
    }
  }

  group("Emoji in controls and labels (§3.4) — a ratchet");
  for (const th of ["floodlit", "daylight"]) {
    for (const [screen, ceiling] of Object.entries(EMOJI_CEILING)) {
      const n = measured[th].emoji[screen];
      ok(`${th} ${screen}: ${n} emoji in controls and labels (ceiling ${ceiling})`, n != null && n <= ceiling);
    }
  }
  const fewer = Object.entries(EMOJI_CEILING).filter(([s, c]) => measured.floodlit.emoji[s] != null && measured.floodlit.emoji[s] < c);
  if (fewer.length) console.log(`  (lower the ceiling: ${fewer.map(([s]) => `${s} ${measured.floodlit.emoji[s]}`).join(", ")})`);

  group("Rendered contrast, per theme — a ratchet");
  for (const th of ["floodlit", "daylight"]) {
    for (const [screen, ceiling] of Object.entries(CONTRAST_CEILING[th])) {
      const n = measured[th].contrast[screen];
      ok(`${th} ${screen}: ${n} text below AA on what is behind it (ceiling ${ceiling})`, n != null && n <= ceiling);
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${"─".repeat(52)}\nACCESSIBILITY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
