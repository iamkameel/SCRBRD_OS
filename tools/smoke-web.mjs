#!/usr/bin/env node
/**
 * One process, one origin: the API serving the client beside its own routes.
 *
 * A single container is the simplest correct deployment — no CORS, no second
 * host, no build-time API address to get wrong — and a static file server is
 * also the classic place to give away the filesystem. So this walk is mostly
 * about what must NOT be served:
 *
 *   1. THE CLIENT IS SERVED when SERVE_CLIENT names a directory, and is not
 *      served at all when it does not.
 *   2. A ROUTE THE CLIENT OWNS gets the app's index, because the address bar
 *      is the client's to read — but /api never does, or a mistyped route
 *      would arrive at a fetch() as a page of HTML.
 *   3. NOTHING OUTSIDE THE DIRECTORY is reachable, by traversal, by encoded
 *      traversal, or by a sibling directory whose name merely starts the same.
 *   4. THE INDEX IS NEVER CACHED, because it names the hashed bundles.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-web.mjs
 */
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8873, BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

// A pretend build: an index, a hashed asset, and a secret one directory up
// that no request may ever reach.
const root = await mkdtemp(join(tmpdir(), "scrbrd-web-"));
const dist = join(root, "dist");
await mkdir(join(dist, "assets"), { recursive: true });
await writeFile(join(dist, "index.html"), "<!doctype html><title>SCRBRD</title><div id=root></div>");
await writeFile(join(dist, "assets", "app-abc123.js"), "console.log('the bundle')");
await writeFile(join(root, "secret.txt"), "NOT-FOR-THE-BROWSER");
// A sibling whose name starts with the served directory's, which a prefix
// check on the string alone would wave through.
await mkdir(`${dist}-evil`, { recursive: true });
await writeFile(join(`${dist}-evil`, "index.html"), "EVIL-SIBLING");

const start = (env) => spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-web", ...env },
  stdio: ["ignore", "pipe", "pipe"],
});
const up = async () => {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
/*
 * A RAW request, because fetch() is the wrong instrument here.
 *
 * The first draft of this walk asked fetch() for "/../secret.txt" and
 * asserted nothing leaked — and it passed with the traversal check DELETED,
 * because WHATWG URL parsing resolves the dot segments away client-side and
 * the server was never asked the dangerous question. A test that cannot fail
 * is not evidence.
 *
 * So the request line goes out over a socket exactly as written, which is
 * what a hostile client does.
 */
const rawGet = (line) => new Promise((done) => {
  const s = connect(PORT, "127.0.0.1", () =>
    s.write(`GET ${line} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`));
  let buf = "";
  s.setTimeout(5000, () => { s.destroy(); done(buf); });
  s.on("data", (d) => { buf += d; });
  s.on("end", () => done(buf));
  s.on("error", () => done(buf));
});

const get = async (path) => {
  const r = await fetch(BASE + path, { redirect: "manual" });
  return { status: r.status, type: r.headers.get("content-type") ?? "",
           cache: r.headers.get("cache-control") ?? "", body: await r.text() };
};

let server = start({ SERVE_CLIENT: dist });
try {
  ok("the server comes up with a client directory", await up());

  group("The client is served beside the API, from one origin");
  {
    const index = await get("/");
    ok("the root is the app's index", index.status === 200 && /id=root/.test(index.body));
    ok("...as HTML", /text\/html/.test(index.type));
    ok("...and never cached, because it names the hashed bundles", /no-cache/.test(index.cache));
    const asset = await get("/assets/app-abc123.js");
    ok("a hashed asset is served", asset.status === 200 && /the bundle/.test(asset.body));
    ok("...as JavaScript", /javascript/.test(asset.type));
    ok("...cached hard, because its name changes when it changes", /immutable/.test(asset.cache));
  }

  group("The address bar belongs to the client, except under /api");
  {
    const route = await get("/squad");
    ok("a route the client owns gets the index, not a 404", route.status === 200 && /id=root/.test(route.body));
    const deep = await get("/profiles/aaaaaaaa-0000-0000-0000-000000000005");
    ok("...however deep it goes", deep.status === 200 && /id=root/.test(deep.body));
    const missing = await get("/api/read/no_such_thing");
    ok("an unknown API path is still a refusal, not a page", missing.status >= 400 && !/id=root/.test(missing.body));
    const bogus = await get("/api/not/a/route");
    ok("...and an unknown route under /api answers JSON, never HTML",
       /json/.test(bogus.type) && /not_found/.test(bogus.body));
    const health = await get("/api/health");
    ok("the API's own routes are untouched", health.status === 200 && /"db":"ok"/.test(health.body));
  }

  group("Nothing outside the directory is reachable");
  {
    // Sent raw, so the dot segments actually arrive. The index is the right
    // answer for all of them: a 403 for a path that exists and a 404 for one
    // that does not is itself a map of the filesystem.
    for (const [name, line] of [
      ["a plain traversal", "/../secret.txt"],
      ["a doubled traversal", "/../../etc/passwd"],
      ["an encoded traversal", "/%2e%2e/secret.txt"],
      ["a doubly encoded traversal", "/%252e%252e/secret.txt"],
      ["a backslash traversal", "/..\\secret.txt"],
      ["a traversal inside a longer path", "/assets/../../secret.txt"],
      ["a sibling directory that starts the same", "/../dist-evil/index.html"],
      // THE ONE THAT MATTERS. new URL() resolves ordinary dot segments away
      // before this code sees them, including the %2e spellings — so every
      // line above is stopped upstream and proves little. An encoded SLASH is
      // different: the URL parser leaves %2f alone, and decodeURIComponent
      // here turns it back into a separator, rebuilding the traversal that
      // parsing had removed. This is the vector the resolve-and-compare check
      // actually stops, and deleting that check turns this line red.
      ["an encoded slash, rebuilding the traversal", "/assets%2f..%2f..%2fsecret.txt"],
      ["...and its uppercase spelling", "/assets%2F..%2F..%2Fsecret.txt"],
    ]) {
      const body = await rawGet(line);
      ok(`${name} leaks nothing`, !/NOT-FOR-THE-BROWSER|EVIL-SIBLING|root:x:/.test(body));
    }
    // The control: the same mechanism DOES fetch a real file, so the
    // assertions above are not passing because nothing was served at all.
    ok("...while a legitimate raw request still works",
       /the bundle/.test(await rawGet("/assets/app-abc123.js")));
  }
} catch (e) {
  fail++; console.log("  ✗ threw:", e.message);
} finally {
  server.kill();
}

// And with no directory named, the process is an API and nothing else.
group("Without SERVE_CLIENT it serves no files at all");
server = start({});
try {
  ok("the server comes up without one", await up());
  const index = await get("/");
  ok("the root is a refusal, not a page", index.status === 404 && /not_found/.test(index.body));
  ok("...answered as JSON", /json/.test(index.type));
  const health = await get("/api/health");
  ok("the API still works", health.status === 200);
} catch (e) {
  fail++; console.log("  ✗ threw:", e.message);
} finally {
  server.kill();
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${"─".repeat(52)}\nWEB SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
