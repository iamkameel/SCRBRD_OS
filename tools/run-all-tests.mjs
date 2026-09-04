#!/usr/bin/env node
/**
 * Runs every SCRBRD suite and reports a combined pass/fail.
 *
 * The scoring suite runs first: it proves the fold that every other layer
 * derives from, so a failure there makes the rest of the output noise.
 */
import { spawnSync } from "node:child_process";

const SUITES = [
  ["authorize","packages/policy/test/authorize.test.mjs"],
  ["scoring",  "packages/scoring/test/replay.test.mjs"],
  ["design",   "apps/web/test/design.test.mjs"],
  ["rating",   "packages/scoring/test/rating.test.mjs"],
  ["client",   "apps/web/src/rbac/rbac.test.mjs"],
  ["handover", "services/api/handover/scoring-session.test.mjs"],
  ["rls",      "services/api/rls/rls.test.mjs"],
  ["auth",     "services/api/auth/auth.test.mjs"],
  ["read",     "services/api/read/read.test.mjs"],
  ["write",    "services/api/write/write.test.mjs"],
  ["realtime", "services/api/realtime/realtime.test.mjs"],
];

let allPass = true;
const summary = [];
for (const [name, path] of SUITES) {
  const r = spawnSync("node", [path], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const passed = m ? Number(m[1]) : 0;
  const failed = m ? Number(m[2]) : (r.status === 0 ? 0 : "?");
  const ok = r.status === 0 && failed === 0;
  if (!ok) allPass = false;
  summary.push({ name, passed, failed, ok });
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(10)} ${m ? m[0] : "(no summary — see below)"}`);
  if (!ok) console.log(out.split("\n").filter(l => l.includes("✗") || l.includes("Error")).slice(0, 8).join("\n"));
}

const total = summary.reduce((a, s) => a + (typeof s.passed === "number" ? s.passed : 0), 0);
console.log("\n" + "─".repeat(52));
console.log(`${allPass ? "ALL SUITES PASSED" : "SOME SUITES FAILED"} · ${total} assertions across ${SUITES.length} suites`);
process.exit(allPass ? 0 : 1);
