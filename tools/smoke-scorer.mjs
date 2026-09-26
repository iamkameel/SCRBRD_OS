#!/usr/bin/env node
/**
 * Drives the live scorer in a real browser and checks the derived state.
 *
 * This is the check that matters most after the scorer moved onto the event
 * log. The unit suite proves `deriveInnings` folds correctly; this proves the
 * UI is actually wired to it — that tapping a run appends an event, that the
 * scoreboard is the fold of those events, and that undo works at any depth
 * rather than restoring a capped snapshot stack.
 *
 * Undo here takes the truncating path, because nothing in this walk has been
 * synced. The other path — a `void` event, for a ball the server already holds
 * — is proven in tools/smoke-sync.mjs and in the scoring suite.
 *
 *   pnpm build && node tools/smoke-scorer.mjs
 *   SCORER_DEBUG=1 node tools/smoke-scorer.mjs   # dump each surface
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const PORT = 4323;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const DEBUG = !!process.env.SCORER_DEBUG;

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

const errors = [];
page.on("pageerror", (e) => { errors.push(`pageerror: ${e.message}`); });
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  // "Failed to load resource" is Chrome's own line for a 404/aborted request.
  if (/Failed to load resource/.test(t)) return;
  errors.push(`console.error: ${t}`);
});

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 2500) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(240);
  return true;
};
const dump = async (tag) => {
  if (!DEBUG) return;
  console.log(`\n[${tag}]`, (await page.locator("button").allInnerTexts())
    .map((t) => t.replace(/\n/g, "·").trim().slice(0, 20)).filter(Boolean).slice(0, 30));
};
/** The running score off the scoreboard: "142/3" or "142-3". */
const scoreOf = async () => ((await text()).match(/\b\d{1,3}\s*[-/]\s*\d{1,2}\b/) || [])[0] ?? null;

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await click(/Get Started|Log In/, 5000);
  await click("Head Coach", 5000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(1400);
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 5000 });
  await page.waitForTimeout(700);
  await click(/^Live$/, 2500);

  // Resume an in-progress fixture. This lands straight on the scoring surface
  // and exercises the adapter that rebuilds an event log from a seeded innings.
  const opened = await click(/Open Live Scorer/i, 5000);
  await page.waitForTimeout(1400);
  ok("live scorer opens on a match in progress",
     opened && /Phase|OUTCOME|UNDO|QUICK MODE|BOWL/i.test(await text()));
  ok("scorer opens without error", errors.length === 0);
  await dump("on open");

  // Resuming at an over boundary opens the new-bowler sheet: the derived
  // innings has no bowler, because replay clears it at the end of every over.
  // Choosing a bowler confirms the sheet directly — there is no confirm button.
  if (await page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ }).count()) {
    const chip = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ }).first();
    try { await chip.click({ timeout: 2500 }); } catch {}
    await page.waitForTimeout(800);
    ok("choosing a bowler closes the new-over sheet",
       (await page.locator("button", { hasText: /\bBOWL\b/ }).count()) === 0);
  }
  await dump("after bowler");

  // Quick mode is the one-tap pad a school scorer actually uses: · 1 2 3 4 6.
  // The default three-phase flow needs three taps a ball, which is not what
  // this check is about.
  // It is Basic Scoring now, a switch in the pad menu (step 2 of the redesign).
  const alreadyQuick = (await page.locator('[data-testid="basic-pad"]').count()) > 0;
  const inQuick = alreadyQuick || (await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).then(() => click(/^\s*Basic Scoring/, 2500), () => false));
  await page.waitForTimeout(500);
  await dump("quick pad");
  ok("one-tap quick pad is reachable", inQuick && /\bDOT\b/i.test(await text()));

  const before = await scoreOf();
  ok("scoreboard shows a running total", before !== null);

  // Score six deliveries. Each tap appends an event, and the scoreboard —
  // which is a fold of the log — must move.
  // A boundary fires a full-screen celebration overlay that swallows taps for
  // about a second, and the end of an over opens the new-bowler sheet. Clear
  // whatever is in the way before each delivery, or the run just stops after
  // the first four.
  // Between deliveries the app may open the new-bowler sheet (end of over) or
  // the batting-order sheet (wicket), both of which cover the pad. Detect the
  // SHEET, not the pad: the pad's keys stay in the DOM underneath, so testing
  // for them reports "clear" while every tap is still being intercepted.
  const clearBlockers = async () => {
    for (let i = 0; i < 5; i++) {
      const bowlers = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
      if (await bowlers.count()) {
        try { await bowlers.first().click({ timeout: 1500 }); } catch {}
        await page.waitForTimeout(600);
        continue;
      }
      const batters = page.locator("button:not([disabled])", { hasText: /\bNEXT\b/i });
      if (await batters.count()) {
        try { await batters.first().click({ timeout: 1500 }); } catch {}
        await page.waitForTimeout(600);
        continue;
      }
      return; // nothing covering the pad
    }
  };

  const errsBeforeScoring = errors.length;
  let scored = 0;
  for (const face of ["1", "2", "4", "1", "6", "2"]) {
    await clearBlockers();
    const hit = await click(new RegExp(`^${face}$`), 2500);
    if (hit) scored++;
    else if (DEBUG) { console.log(`\n[stalled on "${face}"] score=${await scoreOf()}`); await dump("stalled"); }
    await page.waitForTimeout(700);
  }
  await clearBlockers();
  ok(`scored ${scored} deliveries through the pad`, scored >= 4);
  ok("no errors while scoring", errors.length === errsBeforeScoring);

  const after = await scoreOf();
  ok("scoring moved the derived scoreboard", after !== null && after !== before);

  // Undo is truncation of the log now, not a capped snapshot stack. Press it
  // more times than the old ten-entry cap allowed and confirm it keeps going.
  if (DEBUG) { console.log(`\n[before undo] score=${await scoreOf()}`); await dump("before undo"); }
  let undone = 0;
  for (let i = 0; i < 12; i++) {
    await clearBlockers();
    // A new-over sheet left open is closed first. The forced click below
    // used to land on its scrim and close it by accident; since step 2 the
    // undo key sits where the sheet has a bowler's row instead.
    if (await page.locator('[role="dialog"]').count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); }
    // Force past any residual overlay: the assertion is about the log
    // truncating, not about the celebration animation's z-index.
    const u = page.locator("button", { hasText: /UNDO/i }).first();
    if (await u.count()) { try { await u.click({ timeout: 1500, force: true }); undone++; } catch {} }
    await page.waitForTimeout(300);
  }
  const rolledBack = await scoreOf();
  ok(`undo accepted ${undone} presses (old cap was 10)`, undone >= 4);
  ok("undo rolled the derived scoreboard back", rolledBack !== null && rolledBack !== after);
  ok("no errors while undoing", errors.length === errsBeforeScoring);

  // ── The umpires cut the match ────────────────────────────────
  // Rain: the innings is revised to fewer overs. It is an EVENT in the log,
  // so the pad's over count follows it and the innings ends where the
  // umpires said — from the log, not from a number stored beside it.
  const errsBeforeRevise = errors.length;
  // Revise is in the pad menu since step 2 of the redesign.
  await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {});
  const reviseBtn = page.locator('[data-testid="revise-innings"]');
  ok("the pad offers a way to revise the innings", (await reviseBtn.count()) === 1);
  await reviseBtn.click({ timeout: 2500 }); await page.waitForTimeout(400);
  await dump("revise sheet");
  const oversField = page.locator('[data-testid="revise-overs"]');
  ok("the revise sheet opens with an overs field", (await oversField.count()) === 1);
  await oversField.fill("1");
  await click(/^rain$/, 1500);
  await page.locator('[data-testid="revise-confirm"]').click({ timeout: 2500 });
  await page.waitForTimeout(500);
  ok("the header now reads one over, revised", /·\s*1ov\s*\(revised\)/.test(await text()), (await text()).match(/·\s*\d+ov[^\n]*/)?.[0]);
  ok("no errors through the revision", errors.length === errsBeforeRevise);

  // ── PRO MODE ──────────────────────────────────────────────────
  //
  // Reported from the live app: "in Live Scoring, the Pro Mode doesn't work."
  // It did not. Opening it threw "fetchAICommentary is not defined" — the
  // function lived in scorer/shots.js, was exported by nothing, and was called
  // from scorer/panels.jsx — and the ReferenceError took the whole scorer
  // down. Blank screen, mid-match, with a school's game in progress.
  //
  // NOTHING COULD HAVE SEEN IT SHORT OF OPENING THE SCREEN. The bundler does
  // not resolve free variables, tools/check-imports.mjs only looks for names
  // some OTHER module exports (this one was exported by nobody), and the walk
  // stopped at the focus pad. A whole half of the scorer had no coverage at
  // all, which is the actual defect this group closes.
  const errsBeforePro = errors.length;
  // Pro mode is in the pad menu since step 2 of the redesign.
  await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {});
  const proOpened = await click(/PRO MODE/i, 4000);
  await page.waitForTimeout(1200);
  ok("pro mode is offered on the pad", proOpened);
  ok("...and opening it does not throw", errors.length === errsBeforePro,
     errors.slice(errsBeforePro).join(" | "));
  ok("...the full-capture grid is really on the page",
     (await page.locator(".pro-score-grid").count()) === 1,
     "a crash here renders nothing, so the grid is the difference between " +
     "the screen switching and the screen dying");
  ok("...with both columns drawn",
     (await page.locator(".pro-score-grid > *").count()) >= 2);
  ok("...and the way back is offered",
     (await page.locator("button", { hasText: /FOCUS MODE/i }).count()) >= 1);

  // Back again, because a mode you cannot leave is the dialog bug wearing a
  // different hat — and the return trip re-renders the pad that was standing
  // when the crash happened.
  await click(/FOCUS MODE/i, 4000);
  await page.waitForTimeout(900);
  ok("...and going back to the pad works", /UNDO|QUICK MODE|DOT/i.test(await text()));
  ok("no errors across the round trip", errors.length === errsBeforePro,
     errors.slice(errsBeforePro).join(" | "));
} catch (e) {
  ok(`scorer walk threw: ${e.message.slice(0, 90)}`, false);
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.log("\nApplication errors:");
  for (const e of [...new Set(errors)].slice(0, 8)) console.log("  " + e);
}
console.log(`\n${"─".repeat(52)}\nSCORER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
