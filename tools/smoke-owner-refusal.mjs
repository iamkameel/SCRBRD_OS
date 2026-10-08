#!/usr/bin/env node
/**
 * The API refuses to start on a connection row-level security does not
 * restrain, and says which commit it is (gap analysis I14–I16, claims 12 and 14).
 *
 * services/api/server.mjs asks the database what the connection is, before it
 * listens (assertRlsApplies): a SUPERUSER, a BYPASSRLS role, or the owner of
 * the governed tables would answer every request in full with every policy in
 * db/ inert, and nothing would report it. A misread DATABASE_URL is all it
 * takes, so this starts the REAL server, in production mode, on this walk's
 * own local database, with each wrong URL in turn:
 *
 *   - the schema owner (the URL the migrations run on)
 *   - a login role with BYPASSRLS that owns nothing
 *   - a login role that is a superuser and owns nothing
 *
 * and asserts each exits with status 1, prints "row-level security would not
 * apply" naming the role and the problem, and never answers /api/health. Then
 * the application role's URL starts, and answers db: ok.
 *
 * It also asserts what /api/health says about the revision: RENDER_GIT_COMMIT
 * first, else GIT_COMMIT, else null; a value that is not a commit id is not
 * echoed; no other key appears on the body.
 *
 * The two throwaway roles are created and dropped by this walk on the walk's
 * own cluster (cluster-wide names, so they carry the database's name), and
 * nothing here reaches a remote database.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-owner-refusal.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, dbName, port } from "./db-url.mjs";

const PORT = port(8855);
const BASE = `http://127.0.0.1:${PORT}`;
const OWNER = ownerUrl();

let pass = 0, fail = 0;
const ok = (n, c, detail = "") => {
  if (c) pass++; else { fail++; console.log("  ✗", n, detail ? `\n      ${detail}` : ""); }
};
const group = (t) => console.log("\n" + t);

const pool = new pg.Pool({ connectionString: OWNER });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** The same URL as the owner's, as another login role. */
const urlAs = (role, password) => {
  const u = new URL(OWNER);
  u.username = role;
  u.password = password;
  return u.toString();
};

/**
 * Boot the real server once on `url`. Resolves { started, code, err, health }:
 * started is true as soon as /api/health answers with the database reachable,
 * and `health` is that body. Otherwise the process exited first (code), or
 * 20 s passed. Either way the process is gone when this returns.
 */
function boot(url, extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    // The walk decides what the host says about the commit; the shell's does not count.
    for (const k of ["RENDER_GIT_COMMIT", "GIT_COMMIT", "ALLOW_DEV_LOGIN"]) delete env[k];
    const server = spawn(process.execPath, ["services/api/server.mjs"], {
      env: { ...env, DATABASE_URL: url, PORT: String(PORT), NODE_ENV: "production",
             SESSION_SECRET: "smoke-owner-refusal-secret", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "", done = false, answered = false;
    server.stderr.on("data", (d) => { err += d.toString(); });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(limit);
      if (server.exitCode === null) {
        server.once("exit", () => resolve({ ...result, err, answered }));
        server.kill("SIGTERM");
      } else resolve({ ...result, err, answered });
    };
    server.once("exit", (code) => finish({ started: false, code }));
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        answered = true;
        const text = await r.text();
        const body = JSON.parse(text);
        if (body?.db === "ok") finish({ started: true, health: body, healthText: text });
      } catch { /* not up yet */ }
    }, 200);
    const limit = setTimeout(() => finish({ started: false, code: "timeout" }), 20000);
  });
}

// Cluster-wide names: keep two worktrees' walks off each other's roles.
const suffix = dbName().replace(/[^a-z0-9_]/gi, "_").toLowerCase();
const BYPASS = `smoke_bypass_${suffix}`.slice(0, 60);
const SUPER = `smoke_super_${suffix}`.slice(0, 60);
const PASSWORD = "smoke-owner-refusal";

const ident = (s) => `"${s.replace(/"/g, '""')}"`;
async function dropRoles() {
  for (const r of [BYPASS, SUPER]) {
    await q(`DROP OWNED BY ${ident(r)}`).catch(() => {});
    await q(`DROP ROLE IF EXISTS ${ident(r)}`).catch(() => {});
  }
}

try {
  const me = (await q(`SELECT current_user AS u, rolsuper FROM pg_roles WHERE rolname = current_user`))[0];
  const ownedGoverned = Number((await q(`
    SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
       AND pg_has_role(current_user, c.relowner, 'USAGE')`))[0].n);
  ok("the walk's owner connection owns governed tables (the migrated database is there)", ownedGoverned > 0, `${ownedGoverned}`);

  group("The schema owner's URL is refused");
  {
    const b = await boot(OWNER);
    ok("the server does not start", !b.started);
    ok("…it exits with status 1", b.code === 1, `exit ${b.code}`);
    ok("…saying row-level security would not apply", /Refusing to start: row-level security would not apply/.test(b.err), b.err.slice(0, 400));
    ok("…naming the role it connected as", b.err.includes(`connected as: ${me.u}`), b.err.slice(0, 400));
    ok("…and that it owns the governed tables", /problem:\s+it owns \d+ of the tables it would query/.test(b.err), b.err.slice(0, 400));
    ok("…pointing at scrbrd_app and the right file", b.err.includes("scrbrd_app") && b.err.includes("db/06_app_role.sql") && !b.err.includes("db/05_app_role.sql"));
    ok("…never listening: /api/health was not answered", !b.answered);
    // (The owner's password is its own name here, so the URL is what is looked for.)
    ok("…and the connection string is not printed", !/postgres(ql)?:\/\//.test(b.err));
  }

  await dropRoles();
  try {
    group("A BYPASSRLS role that owns nothing is refused");
    await q(`CREATE ROLE ${ident(BYPASS)} LOGIN BYPASSRLS PASSWORD '${PASSWORD}'`);
    {
      const b = await boot(urlAs(BYPASS, PASSWORD));
      ok("the server does not start", !b.started);
      ok("…it exits with status 1", b.code === 1, `exit ${b.code}`);
      ok("…saying row-level security would not apply", /row-level security would not apply/.test(b.err), b.err.slice(0, 400));
      ok("…naming the role", b.err.includes(`connected as: ${BYPASS}`), b.err.slice(0, 400));
      ok("…and BYPASSRLS as the problem", /problem:\s+it has BYPASSRLS/.test(b.err), b.err.slice(0, 400));
      ok("…and only that: not a superuser, not an owner", !/SUPERUSER/.test(b.err) && !/it owns/.test(b.err), b.err.slice(0, 400));
      ok("…never listening: /api/health was not answered", !b.answered);
    }

    group("A superuser that owns nothing is refused");
    await q(`CREATE ROLE ${ident(SUPER)} LOGIN SUPERUSER PASSWORD '${PASSWORD}'`);
    {
      const b = await boot(urlAs(SUPER, PASSWORD));
      ok("the server does not start", !b.started);
      ok("…it exits with status 1", b.code === 1, `exit ${b.code}`);
      ok("…saying row-level security would not apply", /row-level security would not apply/.test(b.err), b.err.slice(0, 400));
      ok("…naming the role and SUPERUSER", b.err.includes(`connected as: ${SUPER}`) && /problem:\s+it is a SUPERUSER/.test(b.err), b.err.slice(0, 400));
      ok("…never listening: /api/health was not answered", !b.answered);
    }
  } finally {
    await dropRoles();
  }

  group("The application role's URL starts, and says so");
  {
    const b = await boot(appUrl());
    ok("the server starts as scrbrd_app, in production mode", b.started, b.err.slice(0, 400));
    ok("…and says nothing about refusing", !/Refusing to start/.test(b.err));
    ok("/api/health reports db: ok", b.health?.db === "ok" && b.health?.ok === true);
    ok("…dev login is not on", b.health?.auth === "token_only");
    ok("revision is null when the host says nothing", b.health && "revision" in b.health && b.health.revision === null,
       JSON.stringify(b.health?.revision));
  }

  group("/api/health says which commit this is");
  const FULL = "0148454a1b2c3d4e5f60718293a4b5c6d7e8f901";
  const OTHER = "ffffffffffffffffffffffffffffffffffffffff";
  const KEYS = ["ok", "db", "ai", "auth", "read", "write", "handover", "public", "pages", "reader", "weather", "revision"].sort();
  {
    const b = await boot(appUrl(), { RENDER_GIT_COMMIT: FULL });
    ok("Render's RENDER_GIT_COMMIT is the revision, in full", b.health?.revision === FULL, JSON.stringify(b.health?.revision));
    ok("…and the only new key: the body is the health keys plus revision, nothing more",
       JSON.stringify(Object.keys(b.health ?? {}).sort()) === JSON.stringify(KEYS), Object.keys(b.health ?? {}).join());
    ok("…and the commit appears once on the body", (b.healthText?.split(FULL).length ?? 0) === 2);
  }
  {
    const b = await boot(appUrl(), { GIT_COMMIT: FULL });
    ok("GIT_COMMIT is used when Render's is not set", b.health?.revision === FULL, JSON.stringify(b.health?.revision));
  }
  {
    const b = await boot(appUrl(), { RENDER_GIT_COMMIT: FULL, GIT_COMMIT: OTHER });
    ok("RENDER_GIT_COMMIT wins when both are set", b.health?.revision === FULL, JSON.stringify(b.health?.revision));
  }
  {
    const secret = "/opt/render/project/src/SECRET-not-a-commit";
    const b = await boot(appUrl(), { RENDER_GIT_COMMIT: secret });
    ok("a value that is not a commit id reads as null", b.health?.revision === null, JSON.stringify(b.health?.revision));
    ok("…and is not echoed anywhere on the body", !!b.healthText && !b.healthText.includes("SECRET-not-a-commit") && !b.healthText.includes("/opt/"));
  }
} catch (e) {
  ok(`the owner-refusal walk threw: ${e.message?.slice(0, 200)}`, false);
} finally {
  await dropRoles().catch(() => {});
  await pool.end().catch(() => {});
}

console.log(`\n${"─".repeat(52)}\nOWNER REFUSAL SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
