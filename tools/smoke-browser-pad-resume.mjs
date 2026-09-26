#!/usr/bin/env node
/**
 * A reloaded pad keeps scoring its match, and stops, in words, when it may
 * not (SCRBRD-078 option B, db/50). In a real browser, against the real
 * server, checked against Postgres and IndexedDB:
 *
 *   A. Sign in, open the fixture, answer the toss, score: the claim, made
 *      signed in, earns this phone a resume credential — a key pair whose
 *      private half the page can use and cannot read, kept in IndexedDB.
 *   B. Reload. The API token was in memory and is gone; nothing that could
 *      sign anybody in was stored. The pad reopens, re-attaches with the
 *      credential and sends by itself: every request after the reload is
 *      signed with the phone's key, none carries a token, and the server's
 *      log is the pad's, id for id. Nobody typed anything.
 *   C. A lull past the lease (90 s without a write): the next ball takes the
 *      phone's own token back, with the credential, and goes into the log.
 *   D. A supervisor force-releases the match. Reload: the pad stops, in
 *      words — "Scoring ended for today on this phone — sign in to
 *      continue" — keeps what is scored on the phone, sends nothing, and
 *      forgets the key.
 *   E. Sign in from the pad: what was kept goes, and the phone is issued a
 *      new credential.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-pad-resume.mjs
 *   BROWSER_PAD_RESUME_DEBUG=1 node tools/smoke-browser-pad-resume.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";

const WEB_PORT = 5311;
const API_PORT = 8814;
const API = `http://127.0.0.1:${API_PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEBUG = !!process.env.BROWSER_PAD_RESUME_DEBUG;
const MATCH = "77777777-0000-0000-0000-000000000002";   // 1XI v Michaelhouse: no toss, nothing scored
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const api = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-pad-resume-secret",
         WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
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

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (text, params) => (await pool.query(text, params)).rows;

const browser = await chromium.launch({ ...launchOptions() });
const ctx = await browser.newContext();
await offline(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(t)) errors.push(`console.error: ${t}`);
});
// Every request to the API, with how it was authorised: "pad", "bearer" or "none".
const sent = [];
page.on("request", (r) => {
  if (!r.url().startsWith(API)) return;
  const a = r.headers().authorization ?? "";
  sent.push({ method: r.method(), path: new URL(r.url()).pathname, auth: a.startsWith("ScrbrdPad ") ? "pad" : a.startsWith("Bearer ") ? "bearer" : "none" });
});

const text = () => page.$eval("body", (el) => el.innerText).catch(() => "");
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const click = async (re, ms = 3000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
const tap = async (id, ms = 4000) => {
  const l = tid(id).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(350);
  return true;
};
/** The sync pill's word, from its accessible name. */
const pill = async () => {
  const l = page.locator('[aria-label^="Sync status:"]').first();
  if (!(await l.count())) return "";
  const label = (await l.getAttribute("aria-label", { timeout: 1000 }).catch(() => "")) || "";
  return (label.match(/^Sync status: ([^.]*)\./)?.[1] ?? "").trim();
};
const board = async () => {
  const l = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: / for \d+, / }).first();
  if (!(await l.count())) return "";
  return ((await l.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
};
const banner = async () => ({
  reason: (await tid("sync-banner").first().getAttribute("data-reason", { timeout: 800 }).catch(() => null)) ?? null,
  text: ((await tid("sync-banner").first().innerText({ timeout: 800 }).catch(() => "")) || "").replace(/\s+/g, " ").trim(),
});
const until = async (fn, ms = 15000, step = 400) => {
  for (let t = 0; t < ms; t += step) { if (await fn()) return true; await page.waitForTimeout(step); }
  return !!(await fn());
};
/** The pad's log as persist.js saved it. */
const saved = () => page.evaluate((key) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv"); };
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
    g.onsuccess = () => { db.close(); resolve(g.result ?? null); };
    g.onerror = () => { db.close(); resolve(null); };
  };
}), `match:${MATCH}`);
const padIds = async () => ((await saved())?.events ?? []).flat().map((e) => e?.id);
/**
 * What this phone keeps for the match's credential (lib/padKey.js), as the
 * page sees it — and whether the private key will come out: it must not.
 */
const padStore = () => page.evaluate((matchId) => new Promise((resolve) => {
  const req = indexedDB.open("scrbrd-pad", 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("credentials")) req.result.createObjectStore("credentials"); };
  req.onerror = () => resolve({ error: String(req.error) });
  req.onsuccess = () => {
    const db = req.result;
    const g = db.transaction("credentials", "readonly").objectStore("credentials").get(matchId);
    g.onsuccess = async () => {
      db.close();
      const rec = g.result;
      if (!rec) return resolve(null);
      let exported = false;
      try { await crypto.subtle.exportKey("jwk", rec.privateKey); exported = true; } catch { exported = false; }
      resolve({ keys: Object.keys(rec).sort(), isKey: rec.privateKey instanceof CryptoKey,
                extractable: rec.privateKey?.extractable, usages: rec.privateKey?.usages, type: rec.privateKey?.type,
                exported, expiresAt: rec.expiresAt });
    };
    g.onerror = () => { db.close(); resolve(null); };
  };
}), MATCH);
/** Anything in the page's storage that looks like a sign-in token (a JWT). */
const storedTokens = () => page.evaluate(() => {
  const found = [];
  for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) {
    const v = s.getItem(s.key(i)) ?? "";
    if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(v)) found.push(s.key(i));
  }
  return found;
});
const serverIds = async () => (await dbq(`select idempotency_key from ball_event where match_id = $1 order by seq`, [MATCH]))
  .map((r) => r.idempotency_key);
const quarantined = async () => (await dbq(`select idempotency_key from ball_event_quarantine where match_id = $1`, [MATCH]));
const credentials = async () => dbq(`select c.id, c.device_id, c.revoked_reason, c.last_used_at, u.email
                                       from pad_resume_credential c join app_user u on u.id = c.user_id
                                      where c.match_id = $1 order by c.issued_at`, [MATCH]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Answer the pad's openers and bowler sheets. */
let named = 0;
const clearBlockers = async () => {
  for (let i = 0; i < 12; i++) {
    const body = await text();
    if (/Available to Bat|Batting Order/i.test(body)) {
      const pick = page.locator("button:not([disabled])", { hasText: /^\s*\d+\s*\n?\s*[A-Z]/ }).first();
      if (await pick.count()) { try { await pick.click({ timeout: 1500 }); } catch {} await page.waitForTimeout(500); continue; }
      const nameField = page.locator('input[aria-label="Player name"]');
      if (await nameField.count()) {
        try { named++; await nameField.fill(`Batter ${named}`); await nameField.press("Enter"); } catch { /* next pass */ }
        await page.waitForTimeout(500);
        continue;
      }
    }
    if (/Opening Bowler|Over \d+ Complete/i.test(body)) {
      const field = page.locator("input[placeholder*='name' i], input[placeholder*='Search bowler' i]").last();
      if (await field.count()) {
        try {
          await field.fill(named % 2 ? "A Nel" : "B Botha");
          await page.locator("button:not([disabled])", { hasText: /^Go$/ }).first().click({ timeout: 1500 });
        } catch { /* next pass */ }
        await page.waitForTimeout(600);
        continue;
      }
    }
    return;
  }
};
const basicPad = async () => {
  if (!(await page.locator('[data-testid="basic-pad"]').count())) {
    await page.locator('[data-testid="pad-menu"]').click({ timeout: 2500 }).catch(() => {});
    await page.locator('[data-testid="pad-basic-scoring"]').click({ timeout: 2500 }).catch(() => {});
  }
};
const onPad = async () => {
  const fix = tid("scoring-blocked-fix");
  if (await fix.count()) { await fix.first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); }
  await clearBlockers();
  await basicPad();
  await page.waitForTimeout(300);
  return /\bDOT\b/i.test(await text());
};
/** Tap one run value on the one-tap pad; true when the board moved. */
const score = async (face) => {
  await clearBlockers();
  await basicPad();
  const before = await board();
  if (!(await click(face === "0" ? /^\s*·\s*dot\s*$/i : new RegExp(`^${face}$`), 2500))) {
    if (DEBUG) console.log(`[debug] no "${face}" key; buttons:`, JSON.stringify(await page.$$eval("button", (bs) => bs.map((b) => b.innerText.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 40))));
    return false;
  }
  await page.waitForTimeout(600);
  return (await board()) !== before;
};
const signInFromLanding = async () => {
  await click(/Get Started|Log In/, 5000);
  await page.waitForTimeout(600);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  await page.waitForTimeout(2200);
  return /Match Centre|Dashboard/i.test(await text());
};
const openFixture = async () => {
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
  await page.waitForTimeout(2500);
  return opened;
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the fixture has nothing scored and no credential", (await serverIds()).length === 0 && (await credentials()).length === 0);

  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 15000 }).catch(() => {});
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  group("A. Signed in, the fixture open and scored: the claim earns this phone a credential");
  ok("the page is a secure context (localhost), so it can hold one", await page.evaluate(() => window.isSecureContext && !!crypto.subtle));
  ok("a seeded scorer gets in", await signInFromLanding());
  const device = await page.evaluate(() => localStorage.getItem("scrbrd:device-id"));
  ok("the 1XI fixture opens", await openFixture());
  ok("the server has no toss, so the pad asks", await until(async () => (await tid("toss-sheet").count()) === 1, 8000));
  await tap("toss-won-home");
  await tap("toss-decision-bat");
  await tap("toss-confirm");
  await page.waitForTimeout(800);
  ok("the scorer is on the pad", await onPad());
  let tapped = 0;
  for (const f of ["1", "4"]) if (await score(f)) tapped++;
  ok("two balls", tapped === 2, tapped);
  ok("...sent", await until(async () => (await pill()) === "Sent", 15000), await pill());
  ok("a credential was issued to this phone, for this match", await until(async () =>
    (await credentials()).some((c) => c.device_id === device && c.email === "scorer@example.invalid" && c.revoked_reason === null), 8000),
    JSON.stringify(await credentials()));
  const store = await padStore();
  ok("the phone keeps it in IndexedDB: the id, when it ends, and a CryptoKey",
     store?.isKey === true && same(store.keys, ["credential", "deviceId", "expiresAt", "matchId", "offset", "privateKey"]), JSON.stringify(store));
  ok("...a private signing key the page cannot export",
     store?.type === "private" && store?.extractable === false && same(store?.usages, ["sign"]) && store?.exported === false, JSON.stringify(store));
  ok("no sign-in token is stored anywhere on the page", (await storedTokens()).length === 0, JSON.stringify(await storedTokens()));
  const pA = await padIds();
  ok("the server's log is the pad's", same(await serverIds(), pA), `${(await serverIds()).length} v ${pA.length}`);

  group("B. Reload: nobody signs in, and the pad goes on scoring and sending by itself");
  const boardA = await board();
  sent.length = 0;
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  ok("the pad reopens with the same score", await until(async () => (await board()) === boardA, 10000), `${await board()} v ${boardA}`);
  ok("...and says nothing about signing in", await until(async () => !/Sign in/i.test((await banner()).text), 6000), JSON.stringify(await banner()));
  ok("scoring goes on", (await onPad()) && await score("2"));
  ok("...and is sent, with nobody signed in", await until(async () => (await pill()) === "Sent", 15000), `${await pill()} ${JSON.stringify(await banner())}`);
  const pB = await padIds();
  ok("the server's log is the pad's, id for id", same(await serverIds(), pB) && pB.length === pA.length + 1, `${(await serverIds()).length} v ${pB.length}`);
  ok("nothing was quarantined", (await quarantined()).length === 0, JSON.stringify(await quarantined()));
  const toPad = sent.filter((r) => r.path.startsWith(`/api/matches/${MATCH}/`));
  if (DEBUG) console.log("[debug] after reload:", JSON.stringify(sent));
  ok("every request to the match after the reload was signed with the phone's key",
     toPad.length >= 3 && toPad.every((r) => r.auth === "pad"), JSON.stringify(toPad.slice(0, 8)));
  ok("...the heartbeat, the log, the claim and the balls among them",
     ["session/heartbeat", "events", "session/claim"].every((p) => toPad.some((r) => r.path.endsWith(p))), JSON.stringify(toPad.map((r) => `${r.method} ${r.path.split("/").slice(4).join("/")}`)));
  ok("no request carried a sign-in token: the rest of the app stayed signed out", !sent.some((r) => r.auth === "bearer"), JSON.stringify(sent.filter((r) => r.auth === "bearer")));
  const live = (await credentials()).filter((c) => c.revoked_reason === null);
  ok("the credential is the one issued before the reload, and has been used", live.length === 1 && live[0].last_used_at != null, JSON.stringify(live));
  const epochB = (await dbq(`select epoch from scoring_session where match_id = $1`, [MATCH]))[0]?.epoch;

  group("C. A lull past the lease: the next ball takes the phone's own token back");
  // The pad trusts a lease it refreshed in the last 45 s (lib/sync.js); a
  // lull long enough to lapse one is longer than that, and so is a spell
  // with no signal, which is how it is made here (as smoke-browser-offline-day
  // does): the ball waits on the phone while the server lets the lease go.
  await ctx.setOffline(true);
  await page.waitForTimeout(300);
  ok("a ball with no signal", await score("1"));
  await dbq(`update scoring_session set lease_until = now() - interval '5 minutes' where match_id = $1`, [MATCH]);
  await ctx.setOffline(false);
  ok("...is sent when it returns", await until(async () => (await pill()) === "Sent", 20000), await pill());
  ok("...into the log, not quarantine, under the next generation of this phone's token",
     (await quarantined()).length === 0 && (await dbq(`select epoch from scoring_session where match_id = $1`, [MATCH]))[0]?.epoch === epochB + 1);
  ok("the server's log is still the pad's", same(await serverIds(), await padIds()));

  group("D. Force-released, then reloaded: the pad stops, in words");
  await dbq(`update scoring_session set lease_until = now() - interval '5 minutes' where match_id = $1`, [MATCH]);
  const sarah = (await (await fetch(`${API}/api/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "sarah@example.invalid", deviceId: "browser-pad-resume-sarah" }) })).json()).token;
  const fr = await (await fetch(`${API}/api/matches/${MATCH}/session/force-release`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sarah}` }, body: "{}" })).json();
  ok("the director of sport force-releases the match", fr?.ok === true, JSON.stringify(fr));
  ok("...which ends the phone's credential", (await credentials()).every((c) => c.revoked_reason !== null));
  const beforeD = await serverIds();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  ok("the pad says scoring has ended on this phone, and why", await until(async () => {
    const b = await banner();
    return b.reason === "pad_ended" && /Scoring ended for today on this phone — sign in to continue/.test(b.text) && /released this match/.test(b.text);
  }, 10000), JSON.stringify(await banner()));
  ok("...with the way on: sign in", (await tid("sync-signin").count()) === 1);
  ok("the phone forgot the key", (await padStore()) === null, JSON.stringify(await padStore()));
  ok("a ball scored now is kept on the phone", (await onPad()) && await score("0"));
  ok("...the state line says so", await until(async () => /^Saved on this phone · 1 to send$/.test(await pill()), 6000), await pill());
  await page.waitForTimeout(2500);
  ok("...and nothing is sent", same(await serverIds(), beforeD));
  ok("the match stays released", (await dbq(`select state from scoring_session where match_id = $1`, [MATCH]))[0]?.state === "idle");

  group("E. Signed in from the pad: what was kept goes, and the phone is issued a new credential");
  await tap("sync-signin");
  await page.waitForTimeout(1000);
  await click(/Scorer/, 4000);
  await click(/^Sign In$/, 5000);
  ok("back on the pad", await until(async () => (await board()) !== "", 8000));
  ok("the kept ball is sent", await until(async () => (await pill()) === "Sent", 20000), `${await pill()} ${JSON.stringify(await banner())}`);
  ok("the server's log is the pad's", same(await serverIds(), await padIds()), `${(await serverIds()).length} v ${(await padIds()).length}`);
  ok("a new credential for this phone", await until(async () =>
    (await credentials()).filter((c) => c.revoked_reason === null && c.device_id === device).length === 1, 8000), JSON.stringify(await credentials()));
  ok("no application errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  ok(`the browser walk threw: ${e.message?.slice(0, 160)}`, false);
  if (DEBUG) console.log(e.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  await browser.close();
  web.close();
  api.kill("SIGTERM");
  await pool.end();
}

if (errors.length) {
  console.log("\nApplication errors:");
  for (const e of [...new Set(errors)].slice(0, 6)) console.log("  " + e);
}
if (fail && apiErr.length) {
  console.log("\nAPI stderr:");
  console.log(apiErr.join("").split("\n").slice(0, 10).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nBROWSER PAD RESUME SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
