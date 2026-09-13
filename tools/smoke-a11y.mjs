#!/usr/bin/env node
/**
 * Accessibility, checked in a real browser.
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
 *   pnpm build && node tools/smoke-a11y.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const PORT = 4326;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, detail) => { if (c) pass++; else { fail++; console.log("  ✗", n, detail ? `— ${detail}` : ""); } };
const group = (t) => console.log("\n" + t);

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
const page = await browser.newPage();
await offline(page.context());

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

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });

  group("The stylesheet");
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

  group("Landing and login");
  let unnamed = await unnamedControls();
  ok("every control on the landing page has a name", unnamed.length === 0, unnamed.slice(0, 4).join(", "));

  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(700);
  unnamed = await unnamedControls();
  ok("every control on the login page has a name", unnamed.length === 0, unnamed.slice(0, 4).join(", "));
  const labelled = await page.evaluate(() =>
    [...document.querySelectorAll("input")].every((i) =>
      i.getAttribute("aria-label") || (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`))));
  ok("every input is labelled, not merely placeheld", labelled);

  group("Keyboard");
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

  group("Inside the app");
  await click("Head Coach", 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(1600);
  ok("signed in", /Dashboard|Match Centre/i.test(await page.$eval("body", (e) => e.innerText)));

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

  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(900);
  await click(/^Live$/, 2500);
  await click(/Open Live Scorer|Start Scoring/i, 5000);
  await page.waitForTimeout(1600);

  // The new-over sheet is up the moment the scorer opens, which makes this
  // the natural place to check the dialog contract rather than trying to
  // provoke one later.
  group("Dialogs");
  // A resumed fixture already has batters and a bowler, so nothing blocks the
  // pad. Recording a wicket opens the dismissal sheet, which is the modal a
  // scorer meets most often and under the most time pressure.
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

  group("The scoring pad");
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

} catch (e) {
  ok(`the accessibility walk threw: ${e.message?.slice(0, 100)}`, false);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${"─".repeat(52)}\nACCESSIBILITY SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
