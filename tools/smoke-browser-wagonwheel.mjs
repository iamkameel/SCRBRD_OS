#!/usr/bin/env node
/**
 * The wagon wheel (SCRBRD-101), in a real browser against a real API and
 * Postgres, at a phone's 390 × 844.
 *
 * Kameel's frame (2026-09-27): the batter's end at the top, the bowler's at
 * the bottom, the keeper behind the batter; off side and leg side follow the
 * batter's hand; the pad's Area step captures a POINT.
 *
 *   A  a right-hander (J Whitfield) taps the screen's right, square: the field
 *      says LEG on the right for him, the pad names "square leg" as the tap
 *      lands, the server stores theta 90 — leg side — and the API's
 *      player_shot_points read gives the theta back;
 *   B  a left-hander (S Naidoo) taps the same spot: the field says OFF on the
 *      right for him, the pad names his point, the server stores theta 270 —
 *      off side — and the right-hander's single is drawn on HIS leg side;
 *      the spoke is the board's chip colour for a 1;
 *   C  the Pro hub records the same tap, for the same batter, as the same
 *      placement, column for column (the pad is the point path's event);
 *   D  the Match Centre's whole-innings wheel mixes hands: laid out for a
 *      right-hander, the left-hander's point drawn on the off side (left),
 *      with its note; one batter's wheel follows his hand;
 *   E  an old sector-era ball of the left-hander's (the screen's sector 3,
 *      stored as the pad of before stored it) reads "to point" in the
 *      commentary, not "square leg".
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-wagonwheel.mjs
 *   WHEEL_SHOTS=/some/dir node tools/smoke-browser-wagonwheel.mjs      # screenshots, both themes
 *   WHEEL_BEFORE=1 WHEEL_DIST=/old/dist WHEEL_SHOTS=… node tools/smoke-browser-wagonwheel.mjs
 *     — the same screens from an older build, for a before/after: it
 *       navigates and shoots and asserts nothing.
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5351;
const API_PORT = 8851;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_WHEEL_DEBUG;
const SHOTS = process.env.WHEEL_SHOTS || null;
const BEFORE = !!process.env.WHEEL_BEFORE;
const DIST = process.env.WHEEL_DIST || "apps/web/dist";
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: nothing scored in the seed
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001"; // bats right
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";    // bats left (db/98)
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };
const PLACEMENT = ["theta", "radius", "seg", "zone", "placement_source", "placement_null", "capture_profile", "close_position"];

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  if (BEFORE) return;
  if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); }
};
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-wheel-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
api.stderr.on("data", (d) => apiErr.push(d.toString()));

const web = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  let body, type;
  try {
    const f = join(DIST, url === "/" ? "index.html" : url);
    body = await readFile(f);
    type = TYPES[extname(f)] ?? "application/octet-stream";
  } catch {
    body = await readFile(join(DIST, "index.html"));
    type = "text/html";
  }
  res.writeHead(200, { "content-type": type });
  res.end(body);
});
await new Promise((r) => web.listen(WEB_PORT, r));

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (text, params) => (await pool.query(text, params)).rows;
/** The server's balls for this match, in order, with their placement columns. */
const serverBalls = async () => dbq(
  `select seq, striker_id, ball_type, value, shot, payload, ${PLACEMENT.join(", ")}
     from ball_event where match_id = $1 and kind = 'ball' order by seq`, [MATCH]);
const num = (v) => (v == null ? null : Number(v));

/** A coach's read through the API. */
let coachToken = null;
async function read(resource, q) {
  coachToken ??= (await (await fetch(`${API}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "coach@example.invalid", deviceId: "wheel-walk-coach" }) })).json())?.token;
  const r = await fetch(`${API}/api/read/${resource}?${new URLSearchParams(q)}`, { headers: { authorization: `Bearer ${coachToken}` } });
  return (await r.json().catch(() => ({})))?.rows ?? [];
}

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await offline(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/Failed to load resource/.test(t)) errors.push(`console.error: ${t}`);
});

const text = () => page.$eval("body", (el) => el.innerText);
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const tap = async (id, ms = 4000) => { await tid(id).first().click({ timeout: ms }); await page.waitForTimeout(350); };
const has = async (id) => (await tid(id).count()) > 0;
const said = async (id) => ((await tid(id).first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
const settle = async () => { await page.waitForTimeout(2600); };

/** The pad's own prompts, answered: Whitfield opens, Naidoo with him, a typed bowler. */
const clearBlockers = async () => {
  for (let i = 0; i < 12; i++) {
    const body = await text();
    if (/Available to Bat|Batting Order/i.test(body)) {
      const pick = page.locator("button:not([disabled])", { hasText: /James Whitfield/ });
      const next = (await pick.count()) ? pick : page.locator("button:not([disabled])", { hasText: /S Naidoo/ });
      if (await next.count()) { try { await next.first().click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
    }
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill(`Bowler ${Math.floor(Math.random() * 1e6)}`);
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 });
        } catch {}
        await page.waitForTimeout(600);
        continue;
      }
    }
    return;
  }
};
const makeReady = async () => {
  for (let i = 0; i < 8; i++) {
    await clearBlockers();
    if (!(await has("scoring-blocked-fix"))) {
      if (!/Batting Order|Opening Bowler|Over \d+ Complete|Available to Bat/i.test(await text())) return true;
      continue;
    }
    try { await tid("scoring-blocked-fix").first().click({ timeout: 2000 }); } catch {}
    await page.waitForTimeout(700);
  }
  return false;
};

/** Both themes, through the system setting the app follows by default. */
async function shoot(name, pg = page) {
  if (!SHOTS) return;
  for (const [theme, scheme] of [["daylight", "light"], ["floodlit", "dark"]]) {
    await pg.emulateMedia({ colorScheme: scheme });
    await pg.waitForTimeout(500);
    await pg.screenshot({ path: join(SHOTS, `${BEFORE ? "before" : "after"}-${name}-${theme}.png`) });
  }
  await pg.emulateMedia({ colorScheme: null });
  await pg.waitForTimeout(300);
}

/** The field's box on screen, and the point just outside its rope, square on the right. */
const SQUARE_RIGHT = 0.97;   // of the half-width: past the rope (124 of 150), so radius clamps to 1.00
async function fieldBox(scope) {
  const svg = page.locator(`${scope} svg`).first();
  const b = await svg.boundingBox({ timeout: 4000 }).catch(() => null);
  return b && { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
/** Press on the field, read what the pad says while the finger is down, release. */
async function tapField(scope) {
  const b = await fieldBox(scope);
  if (!b) return { pressed: "", box: null };
  const x = b.cx + (b.width / 2) * SQUARE_RIGHT, y = b.cy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const pressed = await said("area-prompt");
  await page.mouse.up();
  await page.waitForTimeout(400);
  return { pressed, box: b };
}
/** The three-phase pad, not Basic Scoring. */
const threePhase = async () => {
  if (await has("basic-pad")) { await tap("pad-menu").catch(() => {}); await tap("pad-basic-scoring").catch(() => {}); }
  await page.waitForTimeout(300);
  return has("three-phase-pad");
};
/** A hex from a computed rgb(). */
const hexOf = (rgb) => { const m = String(rgb).match(/\d+/g); return m ? `#${m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : null; };
/** The spokes of the wheel inside `scope`: key, colour, and which side of the middle they end. */
const spokes = (scope) => page.locator(`${scope} [data-spoke]`).evaluateAll((els) => els.map((g) => {
  const l = g.querySelectorAll("line")[1];
  const x2 = Number(l?.getAttribute("x2")), svg = g.closest("svg");
  return { key: g.getAttribute("data-spoke"), colour: g.getAttribute("data-colour"), stroke: l?.getAttribute("stroke"),
           side: x2 > 150.5 ? "right" : x2 < 149.5 ? "left" : "middle", inSvg: !!svg };
}));

try {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  // The home side bats first (SCRBRD-067).
  await dbq(`insert into match_toss (match_id, school_id, won_by, decision)
             select id, school_id, 'home', 'bat' from match where id = $1 on conflict (match_id) do nothing`, [MATCH]);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });

  group("Opening the pad on a real fixture, at 390 × 844");
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  ok("a seeded scorer gets in", /Match Centre|Dashboard/i.test(await text()));
  await page.locator("nav button", { hasText: /Match Centre/ }).first().click({ timeout: 6000 });
  await page.waitForTimeout(1200);
  const opened = await page.evaluate(() => {
    const isBtn = (b) => /Start Scoring|Open Live Scorer/i.test(b.textContent || "");
    for (const b of [...document.querySelectorAll("button")].filter(isBtn)) {
      let card = b;
      while (card.parentElement && [...card.parentElement.querySelectorAll("button")].filter(isBtn).length === 1) card = card.parentElement;
      if (/Michaelhouse/i.test(card.textContent || "")) { b.click(); return true; }
    }
    return false;
  });
  ok("the 1XI fixture offers the scorer", opened);
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 390, height: 844 });
  ok("the openers (Whitfield on strike, Naidoo) and a bowler are named", await makeReady());
  ok("the pad is the three-phase pad", await threePhase());

  // ── A ────────────────────────────────────────────────────────
  group("A. A right-hander taps the screen's right, square: leg side, square leg");
  await tap("shot-flick");
  ok("the Area step is on screen", await has("phase-area"));
  const handA = await tid("field-labels").getAttribute("data-hand").catch(() => null);
  ok(`the field is laid out for the right-hander (${handA})`, handA === "R");
  ok("OFF on the left, LEG on the right", (await said("field-side-left")) === "OFF" && (await said("field-side-right")) === "LEG",
     `${await said("field-side-left")} / ${await said("field-side-right")}`);
  ok("the ends are marked: Batter at the top, Bowler at the bottom", await (async () => {
    const t = await tid("field-end-batter").boundingBox({ timeout: 2000 }).catch(() => null), bw = await tid("field-end-bowler").boundingBox({ timeout: 2000 }).catch(() => null);
    return !!t && !!bw && t.y < bw.y && (await said("field-end-batter")) === "Batter" && (await said("field-end-bowler")) === "Bowler";
  })());
  const rimR = await page.locator('[data-testid="phase-area"] [data-rim]').evaluateAll((els) => Object.fromEntries(els.map((e) => {
    const r = e.getBoundingClientRect(), f = e.closest('[data-testid="wagon-wheel"]').getBoundingClientRect();
    return [e.getAttribute("data-rim"), { text: e.textContent, right: r.left + r.width / 2 > f.left + f.width / 2, size: parseFloat(getComputedStyle(e).fontSize) }];
  })));
  ok("the rim names the positions, mid-wicket and square leg on his right, cover and point on his left",
     rimR.mid_wicket?.right && rimR.square_leg?.right && rimR.fine_leg?.right && !rimR.cover?.right && !rimR.point?.right && !rimR.third?.right, JSON.stringify(rimR));
  ok("every word on the field is at least 12px", await page.locator('[data-testid="field-labels"] span').evaluateAll((els) =>
     els.every((e) => parseFloat(getComputedStyle(e).fontSize) >= 12 && e.getBoundingClientRect().height > 0)));
  await shoot("area-right-hander");
  const a = await tapField('[data-testid="phase-area"]');
  ok(`as the tap lands, the pad names it: "${a.pressed}"`, /square leg/i.test(a.pressed), a.pressed);
  ok("...and it is one tap: the pad is on the outcome", await has("phase-outcome"));
  const step2 = (await tid("step-2").getAttribute("aria-label").catch(() => "")) ?? "";
  ok(`the stepper keeps the position (${step2})`, /Area: Deep square leg/.test(step2), step2);
  await tap("run-1");
  await settle();
  let balls = await serverBalls();
  const rBall = balls.at(-1);
  ok("the server has the right-hander's ball as a point: theta 90, radius 1.00, the screen's sector 3",
     rBall?.striker_id === WHITFIELD && num(rBall.theta) === 90 && num(rBall.radius) === 1 && rBall.seg === 3
       && rBall.placement_source === "point" && rBall.capture_profile === "full" && rBall.zone === "boundary", JSON.stringify(rBall));
  const readR = (await read("player_shot_points", { playerId: WHITFIELD })).filter((r) => r.match_id === MATCH);
  ok("the API's read-back has the theta", readR.length === 1 && Number(readR[0].theta) === 90 && readR[0].placement_source === "point",
     JSON.stringify(readR));

  // ── B ────────────────────────────────────────────────────────
  group("B. A left-hander taps the same spot: off side, point");
  await clearBlockers();
  await tap("shot-cut");
  const handB = await tid("field-labels").getAttribute("data-hand").catch(() => null);
  ok(`the field is laid out for the left-hander (${handB})`, handB === "L");
  ok("LEG on the left, OFF on the right, for him", (await said("field-side-left")) === "LEG" && (await said("field-side-right")) === "OFF",
     `${await said("field-side-left")} / ${await said("field-side-right")}`);
  const rimL = await page.locator('[data-testid="phase-area"] [data-rim]').evaluateAll((els) => Object.fromEntries(els.map((e) => {
    const r = e.getBoundingClientRect(), f = e.closest('[data-testid="wagon-wheel"]').getBoundingClientRect();
    return [e.getAttribute("data-rim"), r.left + r.width / 2 > f.left + f.width / 2];
  })));
  ok("the rim is mirrored: cover and point on his right, mid-wicket on his left", rimL.cover && rimL.point && rimL.third && !rimL.mid_wicket && !rimL.square_leg, JSON.stringify(rimL));
  const sp = await spokes('[data-testid="phase-area"]');
  ok("the right-hander's single to square leg is drawn on the left: HIS leg side", sp.length === 1 && sp[0].key === "1" && sp[0].side === "left", JSON.stringify(sp));
  const chipOne = await page.locator('[data-chip="one"]').first().evaluate((e) => getComputedStyle(e).backgroundColor).catch(() => null);
  ok(`the spoke for a 1 is the board's chip for a 1 (${sp[0]?.stroke} / ${hexOf(chipOne)})`,
     !!chipOne && sp[0]?.stroke?.toLowerCase() === hexOf(chipOne), `${sp[0]?.stroke} vs ${chipOne}`);
  await shoot("area-left-hander");
  const b = await tapField('[data-testid="phase-area"]');
  ok(`as the tap lands, the pad names his point: "${b.pressed}"`, /point/i.test(b.pressed) && !/square leg/i.test(b.pressed), b.pressed);
  await tap("run-2");
  await settle();
  balls = await serverBalls();
  const lBall = balls.at(-1);
  ok("the server has the left-hander's ball mirrored: theta 270 — his off side — and the screen's sector 3",
     lBall?.striker_id === NAIDOO && num(lBall.theta) === 270 && num(lBall.radius) === 1 && lBall.seg === 3
       && lBall.placement_source === "point" && lBall.capture_profile === "full", JSON.stringify(lBall));
  const readL = (await read("player_shot_points", { playerId: NAIDOO })).filter((r) => r.match_id === MATCH);
  ok("...and the API reads it back", readL.length === 1 && Number(readL[0].theta) === 270, JSON.stringify(readL));

  // ── C ────────────────────────────────────────────────────────
  group("C. The Pro hub records the same tap as the same placement");
  await tap("pad-menu"); await tap("pad-pro-mode");
  await page.waitForTimeout(600);
  await clearBlockers();
  await click(/Over the Wicket/);
  const hubShot = page.locator("button:not([disabled])", { hasText: /^Cut$/ }).first();
  await hubShot.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  const hubTap = await fieldBox('[data-testid="wagon-wheel"]');
  if (hubTap) { await page.mouse.click(hubTap.cx + (hubTap.width / 2) * SQUARE_RIGHT, hubTap.cy); await page.waitForTimeout(500); }
  await page.locator("button:not([disabled])", { hasText: /^2$/ }).first().click({ timeout: 3000 }).catch(() => {});
  await settle();
  balls = await serverBalls();
  const hBall = balls.at(-1);
  ok("the hub's ball is the left-hander's, a new row", hBall?.striker_id === NAIDOO && hBall.seq > lBall.seq, JSON.stringify(hBall));
  const diff = PLACEMENT.filter((k) => String(hBall?.[k]) !== String(lBall?.[k]));
  ok("...with the pad's placement, column for column (theta, radius, seg, zone, source, null, profile, close position)",
     diff.length === 0, diff.map((k) => `${k}: pad ${lBall?.[k]} / hub ${hBall?.[k]}`).join("; "));
  ok("...the same shot, type and runs; only the approach the hub asks for differs",
     hBall?.shot === lBall?.shot && hBall?.ball_type === lBall?.ball_type && hBall?.value === lBall?.value
       && (hBall?.payload?.bowlerApproach ?? null) !== null && (lBall?.payload?.bowlerApproach ?? null) === null,
     JSON.stringify({ hub: hBall?.payload, pad: lBall?.payload }));
  await click(/^Focus mode$/);

  // ── E (stored now, read in the Match Centre) ─────────────────
  // A ball as the pad of before recorded it: the screen's sector 3, standard,
  // no point — faced by the left-hander. Written after the pad has stopped,
  // with the next seq, as the seed writes the sector era.
  await tap("exit-scorer").catch(() => {});
  await page.waitForTimeout(1500);
  if (!BEFORE) {
    await dbq(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                 client_seq, client_ts, kind, ball_type, value, shot, seg, zone, placement_source, capture_profile,
                 striker_id, non_striker_id, bowler_id, payload)
               select match_id, school_id, seq + 1, epoch, innings, scorer_user_id, device_id, 'wheel-walk-sector-era',
                      client_seq + 1, client_ts, 'ball', 'run', 1, 'cut', 3, 'outer', 'sector', 'standard',
                      $2, non_striker_id, bowler_id, payload - 'bowlerApproach'
                 from ball_event where match_id = $1 order by seq desc limit 1`, [MATCH, NAIDOO]);
  }

  // ── D ────────────────────────────────────────────────────────
  group("D. The Match Centre's whole-innings wheel: both hands, one frame, said");
  await page.locator('[data-testid="nav-matches"], [data-testid="mnav-matches"]').first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await tid(`mc-open-${MATCH}`).first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2000);
  ok("the match opens", await has("match-view"));
  await tap("mc-tab-analytics").catch(() => {});
  await page.waitForTimeout(800);
  await click(/^Whole innings$/).catch(() => {});
  const wheel = '[data-testid="shot-wheel"]';
  ok("the whole innings is laid out for a right-hander", (await page.locator(wheel).first().getAttribute("data-frame").catch(() => null)) === "R");
  const note = await said("wheel-mirror-note");
  ok(`...and says so: "${note}"`, /Left-handers.*mirrored so leg side is always on the right/.test(note), note);
  ok("OFF on the left and LEG on the right stay true", await page.locator(`${wheel} [data-testid="field-side-left"]`).first().innerText({ timeout: 2000 }).catch(() => "") === "OFF"
     && await page.locator(`${wheel} [data-testid="field-side-right"]`).first().innerText({ timeout: 2000 }).catch(() => "") === "LEG");
  const all = await spokes(wheel);
  const points = all.filter((s) => s.key !== "0");
  ok(`the right-hander's square leg is on the right, the left-hander's points mirrored to the left (${all.map((s) => `${s.key}:${s.side}`).join(" ")})`,
     all.length === 4 && all.filter((s) => s.side === "right").length === 1 && all.filter((s) => s.side === "left").length === 3, JSON.stringify(all));
  ok("the spokes are the chips' colours: a 1 pink, a 2 green", points.every((s) => s.stroke === s.colour)
     && all.find((s) => s.key === "1")?.stroke === "#ec4899" && all.find((s) => s.key === "2")?.stroke === "#b2e358", JSON.stringify(all));
  await shoot("whole-innings");
  // One batter: his own hand.
  await click(/^S Naidoo$/).catch(() => {});
  await page.waitForTimeout(500);
  ok("the left-hander's own wheel is laid out for him, OFF on the right, no note",
     (await page.locator(wheel).first().getAttribute("data-frame").catch(() => null)) === "L"
       && await page.locator(`${wheel} [data-testid="field-side-right"]`).first().innerText({ timeout: 2000 }).catch(() => "") === "OFF" && !(await has("wheel-mirror-note")));
  const his = await spokes(wheel);
  ok("...his balls on HIS off side, the right", his.length === 3 && his.every((s) => s.side === "right"), JSON.stringify(his));
  await shoot("left-hander-wheel");

  // ── E ────────────────────────────────────────────────────────
  group("E. An old sector-era ball of the left-hander's is worded for him");
  await tap("mc-tab-commentary").catch(() => {});
  await page.waitForTimeout(800);
  const lines = await page.locator('[data-testid="mc-line"]').evaluateAll((els) => els.map((e) => e.innerText));
  const sector = lines.find((l) => /Naidoo/.test(l) && /cut/.test(l) && /(one run|a single|they take one)/.test(l));
  ok(`the screen's sector 3, for him, is point: "${sector}"`, !!sector && /cut to point/.test(sector) && !/square leg/.test(sector), lines.slice(0, 6).join(" | "));
  const pointLine = lines.find((l) => /Naidoo/.test(l) && /cut to deep point/.test(l));
  ok("...the same words as his point-era balls there", !!pointLine, lines.slice(0, 6).join(" | "));

  ok("no console errors across the walk", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 200)}`, false);
  if (DEBUG || BEFORE) console.log(e.stack?.split("\n").slice(0, 8).join("\n"));
  if (DEBUG) console.log("[debug] body:\n" + (await text().catch(() => "")).slice(0, 1500));
} finally {
  await browser.close().catch(() => {});
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER WAGON WHEEL SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
