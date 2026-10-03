#!/usr/bin/env node
/**
 * The routing of / (SCRBRD-142 §6.2, phase 1): one mistake here serves a
 * stranger the app shell, or a returning user a blank page.
 *
 *   1. firebase.json — Hosting answers an existing file before any rewrite,
 *      and answers / with index.html, so index.html is not uploaded; / and
 *      /privacy rewrite to the home page BEFORE the catch-all, which goes to
 *      app.html (vite.config.js writes it); the public shells still reach the
 *      API, the ground display's among them.
 *   2. sw.js, run against a fake worker scope — the home page is never stored
 *      as the app's offline shell, online it is always the network's answer,
 *      offline a returning user gets the app rather than nothing; the shell
 *      is fetched from /app and the v1 cache (which may hold the home page)
 *      is dropped.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };

// ── 1 · Hosting ──
const hosting = JSON.parse(readFileSync(join(ROOT, "firebase.json"), "utf8")).hosting;
const rewrites = hosting.rewrites;
const at = (source) => rewrites.findIndex((r) => r.source === source);
ok("index.html is not uploaded, so Hosting cannot answer / with the app", hosting.ignore.includes("index.html"));
ok("/ is the home page", rewrites[at("/")]?.destination === "/home.html");
ok("/privacy is the home page", rewrites[at("/privacy")]?.destination === "/home.html");
ok("...both before the catch-all", at("/") >= 0 && at("/privacy") >= 0 && at("/") < at("**") && at("/privacy") < at("**"));
ok("the catch-all is the app, under the name that is uploaded", rewrites[at("**")]?.destination === "/app.html");
ok("the catch-all is last", at("**") === rewrites.length - 1);
for (const p of ["/api/**", "/live/**", "/scorecard/**", "/display/**", "/table/**", "/fixtures/**"]) {
  ok(`${p} reaches the API`, rewrites[at(p)]?.run?.serviceId === "scrbrd-api" && at(p) < at("/"));
}
const vite = readFileSync(join(ROOT, "apps", "web", "vite.config.js"), "utf8");
ok("the build writes app.html beside index.html", /copyFileSync\(join\(out, "index\.html"\), join\(out, "app\.html"\)\)/.test(vite));
ok("...and has the home entry", /home:\s*"home\.html"/.test(vite));

// ── 2 · The service worker ──
const src = readFileSync(join(ROOT, "apps", "web", "public", "sw.js"), "utf8");
/** A worker scope: listeners, a cache store, and a network that is up or down. */
function worker() {
  /** @type {Record<string, Function>} */
  const on = {};
  /** @type {Map<string, Map<string, any>>} */
  const stores = new Map([["scrbrd-shell-v1", new Map([["/index.html", "HOME-PAGE-STORED-BY-V1"]])]]);
  const net = { up: true, fetched: /** @type {string[]} */ ([]) };
  const keyOf = (r) => (typeof r === "string" ? r : new URL(r.url).pathname);
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        add: async (r) => { m.set(keyOf(r), await fetch(r)); },
        put: async (r, v) => { m.set(keyOf(r), v); },
      };
    },
    match: async (r) => { for (const m of stores.values()) if (m.has(keyOf(r))) return m.get(keyOf(r)); return undefined; },
    keys: async () => [...stores.keys()],
    delete: async (k) => stores.delete(k),
  };
  const fetch = async (r) => {
    const path = keyOf(r);
    net.fetched.push(path);
    if (!net.up) throw new TypeError("offline");
    const body = path === "/" || path === "/home.html" || path === "/privacy" ? "HOME-PAGE" : "APP-SHELL";
    return { ok: true, body, clone() { return this; } };
  };
  const self = {
    location: { origin: "https://scrbrd.test" },
    addEventListener: (k, f) => { on[k] = f; },
    skipWaiting: () => {}, clients: { claim: async () => {} },
  };
  vm.runInNewContext(src, { self, caches, fetch, URL, Set, Response: { error: () => "ERROR" } });
  /** Dispatch a fetch; the response, or "network" when the worker left it alone. */
  const request = async (path, mode = "navigate") => {
    let answered = null;
    on.fetch({ request: { method: "GET", url: `https://scrbrd.test${path}`, mode }, respondWith: (p) => { answered = p; } });
    if (!answered) return "network";
    const r = await answered;
    return typeof r === "string" ? r : r?.body;
  };
  const lifecycle = async (k) => { let w; on[k]({ waitUntil: (p) => { w = p; } }); await w; };
  return { stores, net, request, lifecycle };
}

{
  const w = worker();
  await w.lifecycle("install");
  await w.lifecycle("activate");
  ok("the shell is fetched from /app", w.net.fetched.includes("/app"));
  ok("...into a cache of its own", w.stores.get("scrbrd-shell-v2")?.get("/app") != null);
  ok("the v1 cache, which may hold the home page as its shell, is dropped", !w.stores.has("scrbrd-shell-v1"));

  for (const path of ["/", "/home.html", "/privacy"]) {
    const before = [...w.stores.get("scrbrd-shell-v2").values()].map((v) => v.body).join(",");
    ok(`online, ${path} is the network's home page`, (await w.request(path)) === "HOME-PAGE");
    const after = [...w.stores.get("scrbrd-shell-v2").values()].map((v) => v.body).join(",");
    ok(`...and is never stored as the app's shell`, before === after && !/HOME-PAGE/.test(after), after);
  }
  ok("the app at /app is network first", (await w.request("/app")) === "APP-SHELL");
  ok("the home page's assets are not the worker's to answer from cache as a page",
     (await w.request("/", "no-cors")) === "network");
  for (const path of ["/live/x", "/scorecard/x", "/display/x", "/public-app.js", "/api/public/live"]) {
    ok(`${path} is left to the network`, (await w.request(path)) === "network");
  }

  w.net.up = false;
  ok("offline, a returning user at / gets the app, not an error page", (await w.request("/")) === "APP-SHELL");
  ok("offline, /app gets the app", (await w.request("/app")) === "APP-SHELL");
}

console.log(`\n${"─".repeat(52)}\nHOME ROUTING: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
