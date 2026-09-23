#!/usr/bin/env node
/**
 * The API refuses to start on a database behind the code (SCRBRD-066).
 *
 * On 2026-09-23 production was serving the code from PRs #30 and #31 against
 * a database still at db/23. services/api/schema-guard.mjs now makes the
 * server compare the migrations it was built against with the database's
 * ledger at boot, and exit before listening if any is missing — so on Cloud
 * Run or Render the new revision never takes traffic and the old one keeps
 * serving. The unit suite (schema-guard.test.mjs) proves the comparison over
 * a fake pool; this proves the real server, as the real application role,
 * through db/29's function, against a real ledger:
 *
 *   - a complete ledger starts
 *   - a ledger AHEAD of the code starts (schema first is the normal order)
 *   - one missing migration refuses, naming it and the paste that fixes it
 *   - the incident's shape — db/24..db/27 missing — refuses, naming all four
 *   - no db/29 at all refuses rather than guessing
 *   - put back, it starts again
 *
 * Each case edits the ledger as the owner, COMMITS (the server's own
 * connection has to see it), boots the server, and restores in `finally`.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-schema-guard.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8846;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const APP_DB = "postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd";

let pass = 0, fail = 0;
const ok = (n, c, detail = "") => {
  if (c) pass++; else { fail++; console.log("  ✗", n, detail ? `\n      ${detail}` : ""); }
};
const group = (t) => console.log("\n" + t);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

/**
 * Boot the server once. Resolves { started: true } as soon as /api/health
 * answers with the database reachable, or { started: false, code, err } if the
 * process exits first. Either way the process is gone when this returns.
 */
function boot() {
  return new Promise((resolve) => {
    const server = spawn(process.execPath, ["services/api/server.mjs"], {
      env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
             SESSION_SECRET: "smoke-schema-guard-secret" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "", done = false;
    server.stderr.on("data", (d) => { err += d.toString(); });
    const finish = (result) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(limit);
      if (server.exitCode === null) {
        server.once("exit", () => resolve({ ...result, err }));
        server.kill("SIGTERM");
      } else resolve({ ...result, err });
    };
    server.once("exit", (code) => finish({ started: false, code }));
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`);
        const body = await r.json().catch(() => null);
        if (body?.db === "ok") finish({ started: true });
      } catch { /* not up yet */ }
    }, 200);
    const limit = setTimeout(() => finish({ started: false, code: "timeout" }), 20000);
  });
}

/** Take ledger rows out for one case, and put them back exactly afterwards. */
async function withoutRows(names, fn) {
  const saved = await q(`SELECT name, sha256, applied_at, note FROM schema_migration WHERE name = ANY($1)`, [names]);
  if (saved.length !== names.length) throw new Error(`the ledger does not have all of ${names.join(", ")}`);
  await q(`DELETE FROM schema_migration WHERE name = ANY($1)`, [names]);
  try { return await fn(); }
  finally {
    for (const r of saved)
      await q(`INSERT INTO schema_migration (name, sha256, applied_at, note) VALUES ($1, $2, $3, $4)`,
              [r.name, r.sha256, r.applied_at, r.note]);
  }
}

try {
  const ledgerCount = Number((await q(`SELECT count(*) AS n FROM schema_migration`))[0].n);

  group("db/29: the application role reads names, and only through the door");
  {
    const app = new pg.Client({ connectionString: APP_DB });
    await app.connect();
    try {
      const direct = await app.query(`SELECT count(*) AS n FROM schema_migration`);
      ok("scrbrd_app reads no row of the ledger directly (RLS, no policy)", Number(direct.rows[0].n) === 0);
      const names = await app.query(`SELECT schema_migrations_applied() AS name`);
      ok("scrbrd_app reads every applied name through schema_migrations_applied()",
         names.rows.length === ledgerCount && ledgerCount > 0, `${names.rows.length} vs ${ledgerCount}`);
      ok("…names only: no hash, no note", Object.keys(names.rows[0] ?? {}).join() === "name"
         && names.rows.every((r) => /^\d\d_.*\.sql$/.test(r.name)));
    } finally { await app.end(); }
  }

  group("A complete ledger starts");
  {
    const b = await boot();
    ok("the server starts against a freshly migrated database", b.started, b.err.slice(0, 400));
    ok("…and says nothing about refusing", !/Refusing to start/.test(b.err));
  }

  group("A ledger ahead of the code starts (schema first)");
  {
    await q(`INSERT INTO schema_migration (name, sha256, note) VALUES ('30_from_the_future.sql', 'x', 'smoke-schema-guard')`);
    try {
      const b = await boot();
      ok("a migration the code does not know about does not block startup", b.started, b.err.slice(0, 400));
    } finally {
      await q(`DELETE FROM schema_migration WHERE name = '30_from_the_future.sql'`);
    }
  }

  group("One migration missing refuses, and says what to do");
  await withoutRows(["26_dismissal_breakdown.sql"], async () => {
    const b = await boot();
    ok("the server does not start", !b.started);
    ok("…it exits with status 1, before listening", b.code === 1, `exit ${b.code}`);
    ok("…naming the missing file", b.err.includes("missing:  26_dismissal_breakdown.sql"), b.err.slice(0, 400));
    ok("…and only that one", (b.err.match(/missing: {2}/g) ?? []).length === 1);
    ok("…and the paste that fixes it", b.err.includes("scrbrd-supabase-apply-26.sql"));
    ok("…and where the procedure is written down", b.err.includes('DEPLOYING.md') && b.err.includes('"The procedure"'));
  });

  group("The incident: db/24..db/27 never applied");
  await withoutRows(["24_amend_request.sql", "25_disciplinary_record.sql", "26_dismissal_breakdown.sql", "27_sponsorship_role.sql"], async () => {
    const b = await boot();
    ok("the server does not start", !b.started && b.code === 1, `exit ${b.code}`);
    const named = [...b.err.matchAll(/missing: {2}(\S+)/g)].map((m) => m[1]);
    ok("all four are named, in the order they must be pasted",
       JSON.stringify(named) === JSON.stringify(["24_amend_request.sql", "25_disciplinary_record.sql", "26_dismissal_breakdown.sql", "27_sponsorship_role.sql"]),
       named.join(", "));
  });

  group("No db/29 at all refuses rather than guessing");
  await q(`ALTER FUNCTION schema_migrations_applied() RENAME TO schema_migrations_applied_hidden`);
  try {
    const b = await boot();
    ok("the server does not start", !b.started && b.code === 1, `exit ${b.code}`);
    ok("…and says the database cannot report its migrations", /cannot say which migrations/.test(b.err), b.err.slice(0, 400));
    ok("…and how to find where it is", b.err.includes("SELECT name FROM schema_migration ORDER BY name"));
  } finally {
    await q(`ALTER FUNCTION schema_migrations_applied_hidden() RENAME TO schema_migrations_applied`);
  }

  group("Put back, it starts again");
  {
    ok("the ledger is exactly as it was", Number((await q(`SELECT count(*) AS n FROM schema_migration`))[0].n) === ledgerCount);
    const b = await boot();
    ok("the server starts", b.started, b.err.slice(0, 400));
  }
} catch (e) {
  ok(`the schema-guard walk threw: ${e.message?.slice(0, 200)}`, false);
} finally {
  await pool.end().catch(() => {});
}

console.log(`\n${"─".repeat(52)}\nSCHEMA GUARD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
