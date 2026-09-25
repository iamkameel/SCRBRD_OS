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
 *   - RENDERED CONTRAST, as a ratchet: text whose colour does not clear AA
 *     against the background it is actually drawn on, per theme, may not rise
 *     above CONTRAST_CEILING. design.test.mjs proves the TOKENS read; this
 *     proves the SCREENS use them where they read.
 *
 *   pnpm build && node tools/smoke-a11y.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const PORT = 4331;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

/**
 * Rendered text under 12px, per screen this walk visits — the §3.2 floor
 * ("nothing read is below 12px"), as a RATCHET. Step 1a records where the app
 * is; the screens are resized in later steps and each one lowers its number
 * here. A number may go down and must never go up: a new 9px label is a new
 * failure. The count is the same in both themes (a theme changes colour, not
 * size), and both are checked against it.
 *
 * Measured 2026-09-25 on the demo build, 1280×720, as Head Coach.
 */
const TYPE_FLOOR_CEILING = {
  landing:     5,
  login:       13,
  dashboard:   91,
  matchcentre: 59,
  pad:         44,
};                   // 212 in all

/**
 * Text that does not clear AA (4.5:1; 3:1 at 24px, or 18.66px bold) against
 * the colour actually behind it, per theme and screen. A ratchet for the same
 * reason: under lights these are the 2.0 screens' own misses (white on the
 * cyan end of a gradient, a tint behind a tint), recorded, not fixed here;
 * in daylight they are this step's result. Text on an image or a gradient,
 * or set as a gradient, is not measured — its background is not one colour.
 */
const CONTRAST_CEILING = {
  // The one on the pad, in both: a run in "this over" — emerald figure on an
  // emerald tint of itself, 9px (4.20:1 under lights, 4.39:1 in daylight).
  floodlit: { landing: 0, login: 0, dashboard: 0, matchcentre: 0, pad: 1 },
  daylight: { landing: 0, login: 0, dashboard: 0, matchcentre: 0, pad: 1 },
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
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
const measured = { floodlit: { type: {}, contrast: {} }, daylight: { type: {}, contrast: {} } };

/** Every visible piece of text on the page: its element, size, and whether it reads. */
const survey = (page) => page.evaluate(() => {
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
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
});

/** Record the floor and contrast counts for one screen. */
const measure = async (page, theme, screen) => {
  const items = await survey(page);
  const small = items.filter((i) => i.size < 12);
  const weak = items.filter((i) => i.ratio != null && i.ratio < i.need);
  measured[theme].type[screen] = small.length;
  measured[theme].contrast[screen] = weak.length;
  if (process.env.A11Y_DEBUG) {
    console.log(`[debug] ${theme}/${screen}: ${items.length} texts, ${small.length} under 12px, ${weak.length} below AA`);
    for (const w of weak.slice(0, 8)) console.log(`   weak ${w.ratio.toFixed(2)} <${w.tag}> ${w.size}px "${w.text}"`);
  }
};

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

  /** Every control on screen, with whatever name assistive tech would compute. */
  const unnamedControls = () => page.evaluate(() => {
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
    await measure(page, theme, "landing");
    let unnamed = await unnamedControls();
    ok("every control on the landing page has a name", unnamed.length === 0, unnamed.slice(0, 4).join(", "));

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

    unnamed = await unnamedControls();
    ok("every control in the shell has a name", unnamed.length === 0, unnamed.slice(0, 5).join(", "));

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

    // Settings → Me carries the theme control (DESIGN_DIRECTION §3.1).
    await page.locator("nav button", { hasText: /Settings/ }).first().click({ timeout: 6000 });
    await page.waitForTimeout(700);
    await page.locator('[role="tab"]', { hasText: /^Me$/ }).first().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
    const settingsChoice = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="theme-choice"]');
      return g ? { role: g.getAttribute("role"), radios: [...g.querySelectorAll('[role="radio"]')].map((b) => [b.textContent.trim(), b.getAttribute("aria-checked")]) } : null;
    });
    ok("Settings offers System, Daylight and Floodlit as one radiogroup",
       settingsChoice?.role === "radiogroup" && settingsChoice.radios.map((r) => r[0]).join() === "System,Daylight,Floodlit", JSON.stringify(settingsChoice));
    ok("...with System chosen on a device that has chosen nothing", settingsChoice?.radios.find((r) => r[0] === "System")?.[1] === "true");

    await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
    await page.waitForTimeout(900);
    await measure(page, theme, "matchcentre");
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
    if (!/\bDOT\b/i.test(await page.$eval("body", (e) => e.innerText))) await click(/QUICK MODE/i, 2500);
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
    if (!/\bDOT\b/i.test(await page.$eval("body", (e) => e.innerText))) await click(/QUICK MODE/i, 2500);
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
  } catch (e) {
    ok(`the ${theme} accessibility walk threw: ${e.message?.slice(0, 100)}`, false);
  } finally {
    await ctx.close();
  }
}

try {
  await walk("floodlit");
  await walk("daylight");

  group("The type floor (§3.2) — a ratchet");
  for (const th of ["floodlit", "daylight"]) {
    for (const [screen, ceiling] of Object.entries(TYPE_FLOOR_CEILING)) {
      const n = measured[th].type[screen];
      ok(`${th} ${screen}: ${n} rendered text under 12px (ceiling ${ceiling})`, n != null && n <= ceiling);
    }
  }
  const lower = Object.entries(TYPE_FLOOR_CEILING).filter(([s, c]) => measured.floodlit.type[s] != null && measured.floodlit.type[s] < c);
  if (lower.length) console.log(`  (lower the ceiling: ${lower.map(([s]) => `${s} ${measured.floodlit.type[s]}`).join(", ")})`);

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
