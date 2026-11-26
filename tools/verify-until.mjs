#!/usr/bin/env node
/**
 * Runs db/99_rls_verify.sql from its start through one section, then rolls
 * back: a way to time or check a slow section without the whole file's hours.
 *
 *   node tools/verify-until.mjs --through §89    §1 … §89, stopping where the next section starts
 *   node tools/verify-until.mjs --through 89     the same
 *   node tools/verify-until.mjs --list           the sections, in file order
 *   node tools/verify-until.mjs --through 89 --print
 *                                                write the cut file to stdout and run nothing
 *
 * From the start, never a section alone. db/99 is one transaction and its
 * later sections read what the earlier ones leave: §83 and §89 walk every
 * person holding an active assignment, §126 the whole ball log. A section run
 * alone would time, and prove, something else.
 *
 * What runs is db/99's own text, unchanged, up to the line of the NEXT
 * section's marker (`RAISE NOTICE '%', pg_temp._v_section('§N …')`), then
 * four closing lines: the slowest-sections summary, a NOTICE naming where it
 * stopped, `END $$;` and `ROLLBACK;`. Every marker is a statement of the
 * file's one DO block at its top level (two spaces in), so the cut leaves a
 * block that compiles; cutThrough() refuses a file where that is not so.
 * Sections run in file order, not number order (§49 runs before §48), and
 * "through §N" is through N in file order. Through the last section is the
 * whole file.
 *
 * Connection and session as `node tools/migrate.mjs --verify` has them:
 * ownerUrl() (SCRBRD_DB, SCRBRD_DB_PORT, DATABASE_URL), `SET jit = off`, and
 * psql's output streamed as it arrives, so the section timer's lines show
 * each section's time. It does not migrate or seed: run
 * `node tools/migrate.mjs --reset --seed` first, and wrap both in the same
 * flock as any verify. It does not persist the verifier's role membership
 * either (migrate.mjs --verify does that on this machine); without it db/99
 * grants the membership inside its own transaction, which holds a row every
 * other verify on the cluster waits for, so it says so before it starts.
 */
import { readFileSync, writeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ownerUrl } from "./db-url.mjs";

const MARKER = /^  RAISE NOTICE '%', pg_temp\._v_section\('§(\d+[a-z]?) /;
const ANY_MARKER = /pg_temp\._v_section\('§/;

/** The sections in file order: [{ n ("89", "3b"), line (0-based), label }]. */
export function sections(text) {
  const out = [];
  text.split("\n").forEach((l, i) => {
    if (!ANY_MARKER.test(l) || /^\s*--/.test(l)) return;   // a comment that shows the marker is not one
    const m = MARKER.exec(l);
    if (!m) throw new Error(`line ${i + 1}: a section marker that is not a top-level statement of the DO block:\n  ${l}`);
    out.push({ n: m[1], line: i, label: l.slice(l.indexOf("'§") + 1, l.lastIndexOf("')")) });
  });
  return out;
}

/** db/99's text through section n ("89", "3b"), closed so it compiles and rolls back. */
export function cutThrough(text, n) {
  n = String(n).replace(/^§/, "");
  const all = sections(text);
  const at = all.findIndex((s) => s.n === n);
  if (at < 0) throw new Error(`no section §${n} in db/99`);
  if (all.filter((s) => s.n === n).length > 1) throw new Error(`§${n} opens more than once in db/99`);
  const next = all[at + 1];
  if (!next) return text;
  const lines = text.split("\n");
  return [
    ...lines.slice(0, next.line),
    "  RAISE NOTICE '%', pg_temp._v_section_summary();",
    `  RAISE NOTICE 'verify-until: stopped after §${n}, before §${next.n}; rolled back';`,
    "END $$;",
    "",
    "ROLLBACK;",
    "",
  ].join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const FILE = join(ROOT, "db", "99_rls_verify.sql");
  const argv = process.argv.slice(2);
  const text = readFileSync(FILE, "utf8");
  if (argv.includes("--list")) {
    for (const s of sections(text)) console.log(`${String(s.line + 1).padStart(6)}  ${s.label}`);
    process.exit(0);
  }
  const i = argv.indexOf("--through");
  const n = i >= 0 ? String(argv[i + 1] || "").replace(/^§/, "") : "";
  if (!/^\d+[a-z]?$/.test(n)) {
    console.error("usage: node tools/verify-until.mjs --through §N [--print] | --list");
    process.exit(2);
  }
  let sql;
  try { sql = cutThrough(text, n); } catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
  if (argv.includes("--print")) { writeSync(1, sql); process.exit(0); }   // sync: exit() would cut a piped write short

  const URL = ownerUrl();
  const member = spawnSync("psql", [URL, "-X", "-At", "-c",
    "SELECT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = 'scrbrd_app') AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user) AND m.set_option)"],
    { encoding: "utf8" });
  if ((member.stdout || "").trim() !== "t") {
    console.log("! the verifier's role membership is not persisted on this cluster: db/99 will grant it inside its transaction,\n" +
      "  and every other verify on the cluster waits on that until this run ends. `node tools/migrate.mjs --verify` persists it locally.");
  }
  console.log(`Verifying db/99 through §${n}, then rolling back…`);
  const t0 = Date.now();
  const v = spawnSync("psql", [URL, "-v", "ON_ERROR_STOP=1", "-q", "-X", "-c", "SET jit = off", "-f", "-"],
    { input: sql, stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 30 });
  const took = `${Math.round((Date.now() - t0) / 1000)} s`;
  if (v.status !== 0) { console.error(`✗ db/99 through §${n} (after ${took})`); process.exit(1); }
  console.log(`✓ db/99 through §${n} (${took})`);
}
