#!/usr/bin/env node
/**
 * CRI-0.2: the screenshot set for Sprint 1's redesign of the match page
 * (docs/design/CRICINFO_GAP_PLAN.md section 6, Sprint 0).
 *
 * A tool, not a walk: it asserts nothing and is not in run-smoke-api.mjs. It
 * takes five screens
 *
 *   fixtures    the Match Centre's list of fixtures
 *   summary     the Match Centre of a live fixture (the Summary tab)
 *   scorecard   its Scorecard tab
 *   commentary  its Commentary tab
 *   pad         the scoring pad, opened on that same live fixture
 *
 * at 360, 390, 768 and 1440 wide, in Daylight (colour scheme light) and
 * Floodlit (dark), and for each saves a full-page picture to
 * audit/cri02-screens/<screen>-<width>-<theme>.png. Measures every screen
 * with the narrow walk's own audit (tools/a11y-narrow.mjs), in the page, and
 * writes what it found to audit/cri02-screens/NOTES.md.
 *
 * The match is tools/fixture-matchcentre.mjs's live one, written on the ball
 * log with the seed's invented names, so there are balls to read; no real
 * name appears. The director of sport reads the Match Centre, the seeded
 * scorer scores. Nothing in the app is changed.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/shots-cri02.mjs
 *   CRI02_ONLY=scorecard CRI02_WIDTHS=390 node tools/shots-cri02.mjs      a part of it
 *
 * A picture over about 300 KB is saved as a JPEG at quality 70 (.jpg) instead
 * of a PNG, and one taller than 3200px is cut at 3200 (the notes say which).
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { buildMatchCentreFixture } from "./fixture-matchcentre.mjs";
import { narrowAudit } from "./a11y-narrow.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(5470);
const API_PORT = port(8970);
const API = `http://127.0.0.1:${API_PORT}`;
const OUT = "audit/cri02-screens";
const WIDTHS = (process.env.CRI02_WIDTHS || "360,390,768,1440").split(",").map(Number);
const ONLY = process.env.CRI02_ONLY ? process.env.CRI02_ONLY.split(",") : null;
const HEIGHTS = { 360: 760, 390: 844, 768: 1024, 1440: 900 };
const THEMES = [["light", "Daylight"], ["dark", "Floodlit"]];
const SCREENS = ["fixtures", "summary", "scorecard", "commentary", "pad"];
const MAX_H = 3200;
const BIG = 300 * 1024;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "shots-cri02-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
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
await new Promise((r) => web.listen(WEB_PORT, r));

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await pool.query(text, params)).rows;
const browser = await chromium.launch({ ...launchOptions() });

const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const loaded = (page) => page.waitForFunction(() => !/Loading|Reading/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});

async function open({ width, scheme }) {
  const phone = width < 768;
  const ctx = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] ?? 900 }, colorScheme: scheme,
    ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}),
  });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page };
}
async function signIn(page, email) {
  const lg = page.locator("button:not([disabled])", { hasText: /Get Started|Log In/ }).first();
  if (await lg.count()) { await lg.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500); }
  await page.locator("#login-email").fill(email);
  await page.locator("button:not([disabled])", { hasText: /^Sign In$/ }).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForSelector('[data-testid="os-main"]', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
/** The Match Centre list: the bottom bar's Matches on a phone, the side nav on a desktop. */
async function toMatches(page) {
  await page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await loaded(page);
}
async function openMatch(page, id) {
  await toMatches(page);
  const btn = tid(page, `mc-open-${id}`);
  await btn.first().waitFor({ timeout: 10000 }).catch(() => {});
  if (!(await btn.count())) return false;
  await btn.click({ timeout: 5000 });
  await tid(page, "match-view").waitFor({ timeout: 10000 }).catch(() => {});
  await afterReads(page, 1800);
  return (await tid(page, "match-view").count()) === 1;
}
async function tab(page, id) {
  await tid(page, `mc-tab-${id}`).click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(700);
}
/** The pad's own prompts (a bowler, the next batter), answered so it is the pad that is drawn. */
async function clearBlockers(page) {
  for (let i = 0; i < 6; i++) {
    const b = page.locator("button:not([disabled])", { hasText: /\bBOWL\b/ });
    if (await b.count()) { await b.first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(500); continue; }
    const n = page.locator("button:not([disabled])", { hasText: /Next\s*$/i });
    if (await n.count()) { await n.first().click({ timeout: 1500 }).catch(() => {}); await page.waitForTimeout(500); continue; }
    break;
  }
}
async function openPad(page) {
  await page.locator("nav button, [data-testid^='nav-'], [data-testid^='mnav-']", { hasText: /Match Centre|Matches/ }).first().click({ timeout: 6000 }).catch(() => {});
  await afterReads(page, 1500);
  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    opened = await page.evaluate(() => {
      const isBtn = (b) => /Start Scoring|Open Live Scorer|Resume/i.test(b.textContent || "");
      for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
        let card = b;
        while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
        if (/Westville/i.test(card.textContent || "")) { b.click(); return true; }
      }
      return false;
    });
    if (!opened) await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(2500);
  await clearBlockers(page);
  if (!(await tid(page, "basic-pad").count())) {
    await tid(page, "pad-menu").click({ timeout: 2500 }).catch(() => {});
    await tid(page, "pad-basic-scoring").click({ timeout: 2500 }).catch(() => {});
  }
  await page.waitForTimeout(600);
  return opened;
}

/**
 * The page's full height. The shell scrolls its main, not the document, so a
 * full-page picture of it is only the screen: grow the viewport to the height
 * of whatever scrolls (up to MAX_H), look, and put it back.
 */
async function snap(page, name, width) {
  const need = await page.evaluate(() => {
    const els = [document.documentElement, ...document.querySelectorAll("*")];
    let extra = 0;
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (el !== document.documentElement && !/(auto|scroll)/.test(cs.overflowY)) continue;
      if (el.scrollHeight > el.clientHeight + 1) extra = Math.max(extra, el.scrollHeight - el.clientHeight);
    }
    return extra;
  });
  const vh = page.viewportSize().height;
  const height = Math.min(MAX_H, vh + need);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(500);
  const doc = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const cut = Math.max(height, doc) > MAX_H;
  const opts = { fullPage: true, ...(cut ? { clip: { x: 0, y: 0, width, height: MAX_H } } : {}) };
  let buf = await page.screenshot({ ...opts, type: "png" });
  let file = `${name}.png`;
  if (buf.length > BIG) { buf = await page.screenshot({ ...opts, type: "jpeg", quality: 70 }); file = `${name}.jpg`; }
  await writeFile(join(OUT, file), buf);
  await page.setViewportSize({ width, height: vh });
  await page.waitForTimeout(300);
  return { file, bytes: buf.length, cut, pageHeight: Math.max(height, doc) };
}

/** Findings, keyed by screen then by kind then by what, with where it was seen. */
const found = {};
const record = (screen, kind, what, where) => {
  const k = ((found[screen] ??= {})[kind] ??= new Map());
  (k.get(what) ?? k.set(what, new Set()).get(what)).add(where);
};
const files = [];
const KINDS = ["sideways", "offscreen", "clipped", "overlap", "small", "tiny", "weak"];

/** The shell around every screen (sidebar, bottom bar, top bar): its findings are the same on each, so they are written once. */
const isShell = (item) => /<button (nav-|mnav-|sidebar-)/.test(item) || /"Cricket▾"|<span> "▾"/.test(item);

async function measure(page, screen, width, theme) {
  await loaded(page);
  await afterReads(page, 400);
  const r = await narrowAudit(page, {});
  // What the audit does not list: a box that scrolls sideways with its content cut at the edge until it is scrolled
  // (a tab strip, a table), which a person may not know is there.
  r.scrolls = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowX) || el.scrollWidth <= el.clientWidth + 1) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || cs.display === "none") continue;
      const t = el.getAttribute("data-testid");
      const text = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
      out.push(`<${el.tagName.toLowerCase()}${t ? ` ${t}` : ""}${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}> "${text}" content ${el.scrollWidth}px in a ${el.clientWidth}px box`);
    }
    return out;
  });
  const where = `${width} ${theme}`;
  for (const k of [...KINDS, "scrolls"]) {
    for (const item of r[k]) {
      const scr = isShell(item) ? "shell" : screen;
      if (k === "clipped") record(scr, /\(ellipsis\)/.test(item) ? "ellipsis" : "clipped", item.replace(/ \(ellipsis\)$/, ""), where);
      else record(scr, k, item, where);
    }
  }
  return r;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const fx = await buildMatchCentreFixture(q);
  const want = (s) => !ONLY || ONLY.includes(s);

  for (const [scheme, theme] of THEMES) {
    for (const width of WIDTHS) {
      const label = `${width} ${theme}`;
      const take = async (page, screen) => {
        await measure(page, screen, width, theme);
        const s = await snap(page, `${screen}-${width}-${theme.toLowerCase()}`, width);
        files.push({ screen, width, theme, ...s });
        console.log(`${screen.padEnd(11)} ${label.padEnd(14)} ${s.file}  ${(s.bytes / 1024).toFixed(0)} KB${s.cut ? "  (cut at " + MAX_H + ")" : ""}`);
      };
      // The director of sport: the list and the match.
      if (SCREENS.slice(0, 4).some(want)) {
        const { ctx, page } = await open({ width, scheme });
        try {
          await signIn(page, "sarah@example.invalid");
          await toMatches(page);
          if (want("fixtures")) await take(page, "fixtures");
          if (await openMatch(page, fx.live)) {
            for (const t of ["summary", "scorecard", "commentary"]) {
              if (!want(t)) continue;
              await tab(page, t);
              await take(page, t);
            }
          } else console.log(`!! ${label}: the live fixture did not open`);
        } catch (e) { console.log(`!! ${label}: ${e.message}`); } finally { await ctx.close(); }
      }
      // The scorer: the pad.
      if (want("pad")) {
        // Each shot is a new phone: let go of the last one's hold on the match, or the pad shows "someone else is scoring".
        await q(`delete from scoring_session where match_id = $1`, [fx.live]).catch(() => {});
        const { ctx, page } = await open({ width, scheme });
        try {
          await signIn(page, "scorer@example.invalid");
          if (!(await openPad(page))) console.log(`!! ${label}: the pad did not open from the list`);
          await take(page, "pad");
        } catch (e) { console.log(`!! ${label}: ${e.message}`); } finally { await ctx.close(); }
      }
    }
  }

  // ── NOTES.md ──
  const NAMES = { fixtures: "Fixtures list (Match Centre)", summary: "Match Centre, Summary", scorecard: "Scorecard", commentary: "Commentary", pad: "Scoring pad" };
  const WHAT = {
    sideways: "Sideways scroll (the page or the shell is wider than the screen)",
    offscreen: "Off the screen (text or a tap target outside it, with no scroller of its own)",
    clipped: "Clipped or truncated without an ellipsis",
    ellipsis: "Truncated with an ellipsis (information, not a fault)",
    scrolls: "Scrolls sideways, content cut at the edge until scrolled",
    overlap: "Drawn over something else that reads or taps",
    small: "Text under 12px",
    tiny: "Tap target under 44px",
    weak: "Contrast below WCAG (text 4.5:1, large 3:1, edges and icons 3:1)",
  };
  const order = ["sideways", "offscreen", "clipped", "scrolls", "overlap", "small", "tiny", "weak", "ellipsis"];
  const wOrder = (s) => { const [w, t] = s.split(" "); return Number(w) * 10 + (t === "Daylight" ? 0 : 1); };
  const md = [];
  md.push("# CRI-0.2 screenshot set: what clips");
  md.push("");
  md.push("Evidence for Sprint 1's redesign of the match page (docs/design/CRICINFO_GAP_PLAN.md section 6, Sprint 0). Produced by `tools/shots-cri02.mjs`; no app code changed.");
  md.push("");
  md.push(`- Screens: ${SCREENS.filter(want).join(", ")}. Widths: ${WIDTHS.join(", ")}. Themes: Daylight (colour scheme light), Floodlit (dark).`);
  md.push("- Data: the seed plus tools/fixture-matchcentre.mjs's live fixture (Hilton College 1XI v Westville Boys' High 1XI, ten overs, second innings under way). Invented names only. The Match Centre is read as the seeded director of sport, the pad as the seeded scorer.");
  md.push("- Measured in the page by `narrowAudit` (tools/a11y-narrow.mjs), the narrow walk's own audit, with its floors: 12px text, 44px taps. Widths 360 and 390 are drawn as a touch phone, 768 and 1440 as a desktop; the 44px tap floor is the phone floor, so on 768 and 1440 read the \"tap target\" lists as secondary.");
  md.push(`- Pictures are PNG, or JPEG at quality 70 where the PNG ran over about 300 KB; a page taller than ${MAX_H}px is cut at ${MAX_H}px. The shell scrolls its main, so the viewport is grown to the content's height before each picture; on a phone the fixed bottom bar is therefore drawn at the foot of the picture, over the last content, not at the foot of the first screen.`);
  md.push("- Each line is one element, written as the audit describes it, with the width and theme it was seen at. Identical elements are merged. Lines are capped at 25 per kind per screen; the count is given.");
  md.push("");
  md.push("## Pictures");
  md.push("");
  md.push("| Screen | Width | Theme | File | Size | Note |");
  md.push("|---|---|---|---|---|---|");
  for (const f of files) md.push(`| ${NAMES[f.screen]} | ${f.width} | ${f.theme} | ${f.file} | ${(f.bytes / 1024).toFixed(0)} KB | ${f.cut ? `cut at ${MAX_H}px of ${f.pageHeight}` : ""} |`);
  md.push("");
  md.push("## Seen in the pictures, not measured");
  md.push("");
  md.push("Read off the 360 and 390 pictures by eye; the audit above does not flag these. They are layout facts for Sprint 1, not faults of the floors.");
  md.push("");
  md.push("- Match header (Summary, Scorecard, Commentary), 360 and 390: the title \"Hilton College 1XI v Westville Boys' High 1XI\" wraps and leaves \"1XI\" alone on a line; the \"Corrected\" note appears twice (a line under the score and a chip under the venue); the header, its buttons and the tab strip take about 450px before any score content, which is most of the first screen.");
  md.push("- Tab strip, 360 and 390: seven tabs scroll sideways and the Commentary label is cut at the right edge (\"Commentar\") with no fade or arrow to say there is more; Partnerships, Analytics and Match details are off screen.");
  md.push("- Scorecard, 360 and 390: 11 batters' rows with \"Did not bat\" each take a full row, so the bowling card and fall of wickets sit below the second screen; the dismissal line wraps to two lines (\"c P Govender b P Govender\").");
  md.push("- Commentary, every width: grouped by over, newest over first, with an end-of-over summary line, but no filter (wickets, boundaries, an over) and no jump to an over; the whole match is one scroll (5168px at 1440). At 1440 the column runs the full content width (about 950px), so a commentary line sits far from its ball number. On a phone the Summary label is cut on the left when the Commentary tab is selected (the strip has scrolled to it).");
  md.push("- Fixtures list, 360: the three buttons of an upcoming card wrap onto two rows (\"Dossier\" alone); opponents are shortened to codes (\"WES 1XI\", \"WBH\") on some cards and written in full on others.");
  md.push("- Pad, 360 and 390: the match title in the header wraps to two or three lines and pushes the board down; the board's team name wraps (\"WESTVILLE BOYS' HIGH / 1XI\"). At 768 and 1440 the pad is the phone layout in a wider column, with empty space either side.");
  md.push("");
  NAMES.shell = "Shell around every screen (sidebar, bottom bar, top bar)";
  for (const screen of [...SCREENS.filter(want), "shell"]) {
    md.push(`## ${NAMES[screen]}`);
    md.push("");
    const by = found[screen] ?? {};
    const shotsFor = screen === "shell" ? 1 : files.filter((f) => f.screen === screen).length;
    if (!shotsFor) { md.push("No picture was taken.", ""); continue; }
    let any = false;
    for (const kind of order) {
      const m = by[kind];
      if (!m || !m.size) continue;
      any = true;
      md.push(`### ${WHAT[kind]}: ${m.size} element${m.size === 1 ? "" : "s"}`);
      md.push("");
      const rows = [...m.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 25);
      for (const [what, where] of rows) md.push(`- ${what.replace(/\|/g, "/")} (${[...where].sort((a, b) => wOrder(a) - wOrder(b)).join("; ")})`);
      if (m.size > 25) md.push(`- ... and ${m.size - 25} more`);
      md.push("");
    }
    if (!any) md.push("Nothing found at any width or theme.", "");
  }
  await writeFile(join(OUT, "NOTES.md"), md.join("\n"));
  const total = files.reduce((n, f) => n + f.bytes, 0);
  console.log(`\n${files.length} pictures, ${(total / 1024 / 1024).toFixed(2)} MB, notes in ${OUT}/NOTES.md`);
  if (apiErr.join("").trim()) console.log("API stderr:", apiErr.join("").slice(0, 300));
} finally {
  await browser.close();
  api.kill();
  web.close();
  await pool.end();
}
