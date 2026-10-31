#!/usr/bin/env node
/**
 * The union selector's screen, from a browser (docs/design/UNION_SELECTOR_FIND.md
 * S3; db/125; Kameel 30 Oct 2026, all six questions as recommended).
 *
 *   - THE SELECTOR REACHES SELECTION from his own navigation, and nothing of a
 *     boy is asked for until he has chosen a school or an age group (D2).
 *   - ONLY CONSENTED ROWS: the rows are exactly the boys whose consent to his
 *     union is in force at that school, by a direct count over passport_consent;
 *     a boy of the same school without one is not there (D1, §4.1).
 *   - A ROW IS A NAME, A SCHOOL AND A SIDE (D3, §4.3–4.4), in the server's order.
 *   - THE EMPTY RESULT and A FAILED OPEN, word for word, with no reason (§4.2).
 *   - OPENING ONE WORKS: his name and his lines, by his id (D6), and the list
 *     is read again on return.
 *   - THE FAMILY SEES BOTH: the 'list' line and the 'passport' line in the
 *     log of who at a union looked, and the reader's name on her own screen.
 *   - NOTHING KEPT: no boy's id or name in localStorage, sessionStorage or
 *     IndexedDB after the walk (D7, §4.6); every union read answered no-store.
 *   - 12px and 44px over the screen at 390 wide.
 *
 *   node tools/migrate.mjs --reset --seed
 *   pnpm build && node tools/smoke-browser-passport-union.mjs
 */
import { chromium } from "playwright-core";
import { launchOptions } from "./chromium.mjs";
import { offline } from "./offline-browser.mjs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import pg from "pg";
import { appUrl, ownerUrl, port } from "./db-url.mjs";
import { afterReads, watchReads } from "./walk-wait.mjs";

const WEB_PORT = port(4391);
const API_PORT = port(8991);
const API = `http://127.0.0.1:${API_PORT}`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".map": "application/json" };

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 260)}`); } };
const group = (t) => console.log("\n" + t);

const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";
const SELECTOR = "selector.screen@example.invalid";

const apiProc = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(API_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "browser-passport-union-secret", WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const apiErr = [];
apiProc.stderr.on("data", (d) => apiErr.push(d.toString()));

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

const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await owner.query(text, params)).rows;
const call = async (path, { token, method = "GET", body } = {}) => {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
                                        body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const tokenOf = async (email) => (await call("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-browser-passport-union" } })).body?.token;
const browser = await chromium.launch({ ...launchOptions() });

/** A fresh context per person. `answers` is every /api/read/ answer: its path and its cache-control. */
async function open({ phone = false } = {}) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1420, height: 900 } });
  await offline(ctx);
  const page = await ctx.newPage();
  watchReads(page);
  const errors = [], answers = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/read/")) answers.push({ path: u.pathname.replace("/api/read/", ""), search: u.search, status: r.status(), cache: r.headers()["cache-control"] ?? "" });
  });
  await page.addInitScript(`window.__SCRBRD_API_BASE__ = ${JSON.stringify(API)};`);
  await page.goto(`http://localhost:${WEB_PORT}/`, { waitUntil: "networkidle" });
  return { ctx, page, errors, answers };
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
const inner = (page, id) => tid(page, id).first().innerText({ timeout: 5000 }).catch(() => "");
const click = async (page, re, ms = 4000) => {
  const l = page.locator("button:not([disabled])", { hasText: re }).first();
  if (!(await l.count())) return false;
  try { await l.click({ timeout: ms }); } catch { return false; }
  await page.waitForTimeout(300);
  return true;
};
async function signIn(page, email) {
  await click(page, /Get Started|Log In/, 5000);
  await page.waitForTimeout(500);
  await page.locator('input[type="email"]').first().fill(email);
  await click(page, /^Sign In$/, 5000);
  await afterReads(page, 1500);
  return (await tid(page, "os-main").count()) === 1;
}
/** Open a destination from the sidebar, the phone's bar, or the phone's More drawer. */
async function go(page, key) {
  let l = page.locator(`[data-testid="nav-${key}"], [data-testid="mnav-${key}"]`).first();
  if (!(await l.count()) && await tid(page, "mnav-more").count()) {
    await tid(page, "mnav-more").click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    l = tid(page, `drawer-${key}`).first();
  }
  if (!(await l.count())) return false;
  try { await l.click({ timeout: 6000 }); } catch { return false; }
  await afterReads(page, 1200);
  return (await tid(page, "os-main").getAttribute("data-page")) === key;
}
/** Wait for the list to answer: rows, the empty words, or a refusal. */
const listed = (page) => page.waitForFunction(() => !!document.querySelector(
  '[data-testid="selection-rows"], [data-testid="selection-empty"], [data-testid="selection-refused"]'), null, { timeout: 15000 }).then(() => true).catch(() => false);
/** Wait for an open to answer. */
const opened = (page) => page.waitForFunction(() => {
  const e = document.querySelector('[data-testid="selection-passport"]');
  return !!e && e.getAttribute("data-state") !== "loading";
}, null, { timeout: 15000 }).then(() => true).catch(() => false);
async function floors(page, sel) {
  return page.evaluate((s) => {
    const small = [], tiny = [];
    for (const root of document.querySelectorAll(s)) {
      for (const n of [root, ...root.querySelectorAll("*")]) {
        if (n.closest(".sr-only")) continue;
        const cs = getComputedStyle(n);
        const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
        if (own && parseFloat(cs.fontSize) < 12) small.push(`${n.tagName} ${cs.fontSize} "${n.textContent.trim().slice(0, 30)}"`);
        if (/^(BUTTON|SELECT|INPUT)$/.test(n.tagName)) {
          const r = n.getBoundingClientRect();
          if (r.height && r.height < 44) tiny.push(`${n.tagName} ${Math.round(r.height)}px "${(n.textContent || n.id).trim().slice(0, 30)}"`);
        }
      }
    }
    return { small, tiny };
  }, sel);
}
/** Every client store the page can write, as one string. */
const stores = (page) => page.evaluate(async () => {
  const out = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
  const dbs = indexedDB.databases ? await indexedDB.databases() : [];
  for (const { name } of dbs) {
    if (!name) continue;
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const s of db.objectStoreNames) {
      const all = await new Promise((res) => { const t = db.transaction(s).objectStore(s).getAll(); t.onsuccess = () => res(t.result); t.onerror = () => res([]); });
      out.push(JSON.stringify(all));
    }
    db.close();
  }
  return out.join("\n");
});
const cacheNames = (page) => page.evaluate(async () => (self.caches ? await caches.keys() : []).join());

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${API}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The stage: his union, its named selector, and his mother's word ──
  // The union is the province's (school_union() of his school), staged as the
  // API walk stages it; the selector is the union principal's appointment,
  // written here as the owner.
  const HIL = (await q(`select school_id from player where id = $1`, [PILLAY]))[0].school_id;
  const KZN = (await q(`select id from school where kind = 'union' and lower(btrim(province)) = 'kwazulu-natal' and archived_at is null order by id limit 1`))[0]?.id
           ?? (await q(`insert into school (code, name, kind, province) values ('SELKZN', 'Selection KZN Union', 'union', 'KwaZulu-Natal') returning id`))[0].id;
  const KZN_NAME = (await q(`select name from school where id = $1`, [KZN]))[0].name;
  ok("his school's union is the one staged", (await q(`select school_union($1) as u`, [HIL]))[0].u === KZN);
  {
    const id = (await q(`insert into app_user (school_id, email, name, role) values ($1, $2, 'Screen Selector', 'unionselector') returning id`, [KZN, SELECTOR]))[0].id;
    await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'unionselector', $2)`, [id, KZN]);
  }
  const parentTok = await tokenOf("parent@example.invalid");
  const granted = await call("/api/passport/consent", { method: "POST", token: parentTok, body: { playerId: PILLAY, schoolId: KZN } });
  ok("his mother names his union", granted.status === 200, granted.body);
  // A boy of the same school whose family named nobody: never on the screen.
  const unnamed = (await q(`select p.id, p.full_name from player p
                             where p.school_id = $1 and p.id <> $2
                               and not exists (select 1 from passport_consent c where c.player_id = p.id and c.to_school_id = $3 and c.withdrawn_at is null)
                             order by p.full_name limit 1`, [HIL, PILLAY, KZN]))[0];
  ok("the seed has a boy at his school whose family named no union", !!unnamed);
  const expected = (await q(`select c.player_id from passport_consent c join player p on p.id = c.player_id
                              where c.to_school_id = $1 and c.withdrawn_at is null and p.school_id = $2
                                and consent_giver_live(c.granted_by, c.player_id, c.granted_at)`, [KZN, HIL])).map((r) => r.player_id).sort();
  const reads = async () => {
    const rows = (await call("/api/read/passport_union_reads", { token: parentTok })).body?.rows ?? [];
    const mine = rows.filter((r) => r.player_id === PILLAY && r.reader_name === "Screen Selector");
    return { list: mine.filter((r) => r.what === "list").length, passport: mine.filter((r) => r.what === "passport").length };
  };
  const before = await reads();
  ok("before the screen, nothing of hers names the selector", before.list === 0 && before.passport === 0, before);

  // ══ The selector ══
  group("The selector reaches Selection, and is asked for a school or an age group first (D2)");
  const s = await open({ phone: true });
  ok("the selector signs in", await signIn(s.page, SELECTOR));
  const reached = await go(s.page, "selection");
  ok("Selection is in his navigation, and opens", reached && await tid(s.page, "selection").count() === 1);
  await s.page.waitForFunction(() => !!document.querySelector('[data-testid="selection-filters"], [data-testid="selection-no-union"]'), null, { timeout: 10000 }).catch(() => {});
  ok("one institution: no chip to choose between", await s.page.locator('[data-testid^="selection-org-"]').count() === 0);
  ok("no list is asked for on opening", !s.answers.some((a) => a.path === "passport_union_list"));
  ok("the button waits for a school or an age group, and says so",
     await tid(s.page, "selection-list").isDisabled() && /Choose a school or an age group first\./.test(await inner(s.page, "selection-choose")));
  await tid(s.page, "selection-name").fill("pillay");
  ok("...a name alone is no filter", await tid(s.page, "selection-list").isDisabled());
  await tid(s.page, "selection-name").fill("");
  const schoolOptions = await s.page.$$eval('[data-testid="selection-school"] option', (os) => os.map((o) => o.value).filter(Boolean));
  ok("his province's schools are offered, his school among them", schoolOptions.includes(HIL), schoolOptions.length);
  await tid(s.page, "selection-age").selectOption("U15");
  ok("an age group alone is enough", !(await tid(s.page, "selection-list").isDisabled()));
  await tid(s.page, "selection-age").selectOption("");

  group("Only the boys whose families named his union, each a name, a school and a side (D1, D3)");
  await tid(s.page, "selection-school").selectOption(HIL);
  await tid(s.page, "selection-list").click();
  ok("the list answers", await listed(s.page));
  const shown = await s.page.$$eval('[data-testid^="selection-row-"]', (els) => els.map((e) => ({ id: e.getAttribute("data-testid").replace("selection-row-", ""), text: e.innerText })));
  ok("the rows are exactly the boys whose consent to his union is in force at that school",
     shown.map((r) => r.id).sort().join() === expected.join() && expected.includes(PILLAY), { shown: shown.map((r) => r.id), expected });
  ok("...never a boy whose family named nobody", !shown.some((r) => r.id === unnamed?.id) && !(await inner(s.page, "selection")).includes(unnamed?.full_name ?? "\u0000"));
  const side = (await q(`select team_code from player where id = $1`, [PILLAY]))[0].team_code;
  const pRow = shown.find((r) => r.id === PILLAY);
  const words = (pRow?.text ?? "").split("\n").map((t) => t.trim()).filter(Boolean);
  ok("his row is his name, his school and his side, and nothing else",
     words[0] === "R Pillay" && words[1] === `Hilton College · ${side}` && words.slice(2).every((w) => w === "›"), words);
  ok("no figure, honour, rank or birthday anywhere on the list",
     !/\d+ (runs|wickets|innings)|average|honour|cap #|rank|born|birthday|date of birth/i.test(await inner(s.page, "selection")));
  const listAnswer = s.answers.filter((a) => a.path === "passport_union_list").at(-1);
  ok("the list was answered no-store, as were the institutions and the schools",
     /no-store/.test(listAnswer?.cache) && s.answers.filter((a) => /^passport_union_(orgs|schools)$/.test(a.path)).every((a) => /no-store/.test(a.cache)), s.answers);
  const afterList = await reads();
  ok("his mother's log gains the list, under the selector's name", afterList.list === before.list + 1 && afterList.passport === before.passport, afterList);

  group("A name narrows within the list, and an empty answer says so in words (Q6, S3)");
  await tid(s.page, "selection-name").fill("nobody-by-this-name");
  await tid(s.page, "selection-list").click();
  ok("the empty answer", await listed(s.page));
  ok("...says 'No boy's family has named {institution} in that school or age group.' and nothing else",
     (await inner(s.page, "selection-empty")).trim() === `No boy's family has named ${KZN_NAME} in that school or age group.`, await inner(s.page, "selection-empty"));
  await tid(s.page, "selection-name").fill("pill");
  await tid(s.page, "selection-list").click();
  await listed(s.page);
  ok("a fragment of his name finds him", await tid(s.page, `selection-row-${PILLAY}`).count() === 1);
  const fl = await floors(s.page, '[data-testid="selection"]');
  ok(`at 390 wide: nothing read under 12px (${fl.small.length}), nothing tapped under 44px (${fl.tiny.length})`,
     fl.small.length === 0 && fl.tiny.length === 0, [...fl.small, ...fl.tiny].slice(0, 4).join(" · "));

  group("Opening one works, by his id (D6), and the list is read again on return");
  const listsBefore = s.answers.filter((a) => a.path === "passport_union_list").length;
  await tid(s.page, `selection-row-${PILLAY}`).click();
  ok("his passport opens", await opened(s.page) && await tid(s.page, "selection-passport").getAttribute("data-state") === "ok");
  ok("...with his name, from the passport's own door", (await inner(s.page, "selection-passport-name")).trim() === "R Pillay");
  ok("...and his lines, each with its source and how sure", await s.page.locator('[data-testid^="selection-passport-"][data-testid$="cap"], [data-testid="selection-passport-career"]').count() >= 1
     && /derived|verified|asserted|seeded/i.test(await inner(s.page, "selection-passport")));
  ok("...read by his id, no-store", s.answers.some((a) => a.path === "passport" && a.search.includes(PILLAY) && /no-store/.test(a.cache))
     && s.answers.some((a) => a.path === "passport_name" && a.search.includes(PILLAY) && /no-store/.test(a.cache)));
  const fp = await floors(s.page, '[data-testid="selection-passport"]');
  ok(`the passport at 390 wide: 12px (${fp.small.length}), 44px (${fp.tiny.length})`, fp.small.length === 0 && fp.tiny.length === 0, [...fp.small, ...fp.tiny].slice(0, 4).join(" · "));
  await tid(s.page, "selection-back").click();
  ok("back to the list", await listed(s.page));
  ok("...read again on return", s.answers.filter((a) => a.path === "passport_union_list").length === listsBefore + 1);

  group("The family sees both the list and the open (D5, Q1)");
  const afterOpen = await reads();
  ok("his mother's log holds the list lines and the passport line, under the selector's name",
     afterOpen.list >= 1 && afterOpen.passport === before.passport + 1, afterOpen);
  {
    const m = await open({ phone: true });
    ok("his mother signs in", await signIn(m.page, "parent@example.invalid"));
    const famOk = await go(m.page, "family");
    await tid(m.page, `family-open-consents-${PILLAY}`).click({ timeout: 6000 }).catch(() => {});
    await afterReads(m.page, 1500);
    const looked = await inner(m.page, "passport-union-reads");
    const lines = await m.page.locator(`[data-testid="passport-union-read-${PILLAY}"]`).allInnerTexts();
    // S4: the list's appearances are grouped per reader per SA day, in §3's words.
    ok("...and on her own screen, who at which union looked: the list and the open",
       famOk && lines.some((l) => /appeared in Screen Selector's list \(Union Selector\)/.test(l) && l.includes(KZN_NAME))
       && lines.some((l) => /Screen Selector \(Union Selector\), .* · opened his passport on /.test(l) && l.includes(KZN_NAME)), looked.slice(0, 300));
    ok("no page errors for her", m.errors.length === 0, m.errors.slice(0, 3).join(" | "));
    await m.ctx.close();
  }

  group("A consent taken back: the row goes, and a stale open says only 'No longer open' (§4.2)");
  // He is on the list; his family takes the union's name back meanwhile.
  const w = await call(`/api/passport/consent/${granted.body?.id}/withdraw`, { method: "POST", token: parentTok });
  ok("his mother takes the union's name back", w.status === 200 && w.body?.withdrawn === 1, w.body);
  await tid(s.page, `selection-row-${PILLAY}`).click();
  ok("the open from the row he still sees answers", await opened(s.page));
  ok("...'No longer open to {institution}' and nothing more",
     await tid(s.page, "selection-passport").getAttribute("data-state") === "closed"
     && (await inner(s.page, "selection-closed")).trim() === `No longer open to ${KZN_NAME}`
     && (await inner(s.page, "selection-passport")).replace(/‹ Back to the list/, "").trim() === `No longer open to ${KZN_NAME}`,
     await inner(s.page, "selection-passport"));
  ok("...not his name, not a reason", !/Pillay|withdr|laps|moved|left|consent/i.test(await inner(s.page, "selection-passport")));
  await tid(s.page, "selection-back").click();
  ok("on return the list is read again, and his row is gone", await listed(s.page) && await tid(s.page, `selection-row-${PILLAY}`).count() === 0);

  group("Nothing kept (D7, §4.6)");
  const kept = await stores(s.page);
  ok("no boy's id or name in localStorage, sessionStorage or IndexedDB", !kept.includes(PILLAY) && !/Pillay/i.test(kept), kept.slice(0, 200));
  const caches = await cacheNames(s.page);
  const cached = await s.page.evaluate(async () => {
    if (!self.caches) return "";
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(r.url);
    return out.join("\n");
  });
  ok("no union read in the service worker's cache", !/\/api\//.test(cached), caches);
  ok("no export, share or download offered", await s.page.locator('[data-testid="selection"] a[download], [data-testid="selection"] [data-testid*="export"], [data-testid="selection"] [data-testid*="share"]').count() === 0);
  ok("no page errors for him", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.ctx.close();
} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.stack ?? e.message);
  if (apiErr.length) console.log(apiErr.join("").slice(-1500));
} finally {
  await browser.close().catch(() => {});
  await owner.end().catch(() => {});
  apiProc.kill();
  web.close();
  console.log("\n" + "─".repeat(52));
  console.log(`BROWSER PASSPORT UNION SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
