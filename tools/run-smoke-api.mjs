#!/usr/bin/env node
/**
 * The API walks, each against a freshly seeded database.
 *
 * This replaces a single 1,400-character `smoke:api` line in package.json that
 * repeated `migrate --reset --seed && node tools/smoke-X.mjs` sixteen times.
 * Nobody could read it, and the predictable thing happened: smoke-squad.mjs
 * was written, passed, committed — and never added, so the walk proving that a
 * fifteen-year-old cannot be named for a U13 fixture had never once run in a
 * verify. A check that exists and never runs is the shape of failure this
 * whole feature was written to close, and it had reappeared in the tooling.
 *
 * So the list is a list, and UNLISTED() below fails the run if a smoke walk
 * exists on disk that neither this file nor `smoke` in package.json names. You
 * cannot quietly add a walk that nobody runs any more.
 *
 *   node tools/run-smoke-api.mjs            all of them
 *   node tools/run-smoke-api.mjs toss squad  just these
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

// Every walk here gets a reset first: they assert against seeded rows and a
// previous walk's writes would make them pass or fail for the wrong reason.
const WALKS = [
  "read", "sync", "handover", "browser-sync", "browser-read", "fold",
  "assess", "access", "eligibility", "roster", "audit", "guardian",
  "rating", "notes", "amend", "login",
  // Pre-match: naming the side, calling the toss, and the conditions
  // both sides play in.
  "squad", "toss", "conditions",
];

// Walks that need no database, run by `pnpm smoke` instead. Named here only so
// the completeness check below knows they are accounted for.
const NO_DB = ["", "scorer", "persist", "a11y"];

const onDisk = readdirSync("tools")
  .filter((f) => /^smoke.*\.mjs$/.test(f))
  .map((f) => f.replace(/^smoke-?/, "").replace(/\.mjs$/, ""));
const known = new Set([...WALKS, ...NO_DB]);
const unlisted = onDisk.filter((n) => !known.has(n));
if (unlisted.length) {
  console.error(`\n✗ smoke walks exist that nothing runs: ${unlisted.map((n) => `smoke-${n}`).join(", ")}`);
  console.error("  Add them to WALKS in tools/run-smoke-api.mjs (or to NO_DB if they need no database).");
  process.exit(1);
}

const only = process.argv.slice(2);
const run = only.length ? WALKS.filter((w) => only.includes(w)) : WALKS;
if (only.length && run.length !== only.length) {
  console.error(`✗ unknown walk: ${only.filter((o) => !WALKS.includes(o)).join(", ")}`);
  process.exit(1);
}

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let allPass = true;
const summary = [];

for (const walk of run) {
  const reset = sh("node", ["tools/migrate.mjs", "--reset", "--seed"]);
  if (reset.status !== 0) {
    console.log(`✗ ${walk.padEnd(14)} could not reset the database`);
    console.log((reset.stdout + reset.stderr).split("\n").slice(-6).join("\n"));
    allPass = false; summary.push({ walk, ok: false, passed: 0 });
    continue;
  }
  const r = sh("node", [`tools/smoke-${walk}.mjs`]);
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const passed = m ? Number(m[1]) : 0;
  const failed = m ? Number(m[2]) : (r.status === 0 ? 0 : "?");
  const ok = r.status === 0 && failed === 0;
  if (!ok) allPass = false;
  summary.push({ walk, ok, passed });
  console.log(`${ok ? "✓" : "✗"} ${walk.padEnd(14)} ${m ? m[0] : "(no summary — see below)"}`);
  // On failure show the failing assertions, not the whole walk: the group
  // headings are context and the ✗ lines are the finding.
  if (!ok) console.log(out.split("\n").filter((l) => l.includes("✗") || l.includes("Error")).slice(0, 10).join("\n"));
}

const total = summary.reduce((a, s) => a + s.passed, 0);
console.log("\n" + "─".repeat(52));
console.log(`${allPass ? "ALL WALKS PASSED" : "SOME WALKS FAILED"} · ${total} assertions across ${run.length} walks`);
process.exit(allPass ? 0 : 1);
