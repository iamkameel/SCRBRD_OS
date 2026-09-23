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
  ["laws-spec","packages/scoring/test/laws-spec.test.mjs"],
  ["design",   "apps/web/test/design.test.mjs"],
  ["analytics","apps/web/test/analytics.test.mjs"],
  ["teams",    "packages/policy/test/teams.test.mjs"],
  ["sa-id",    "packages/policy/test/sa-id.test.mjs"],
  ["dob",      "packages/policy/test/date-of-birth.test.mjs"],
  ["modules",  "packages/policy/test/modules.test.mjs"],
  ["separation","packages/policy/test/separation.test.mjs"],
  ["sensitivity","packages/policy/test/sensitivity.test.mjs"],
  ["invariants","packages/policy/test/invariants.test.mjs"],
  ["rating",   "packages/scoring/test/rating.test.mjs"],
  ["rubric",   "packages/scoring/test/rubric.test.mjs"],
  ["readiness","packages/scoring/test/readiness.test.mjs"],
  ["phases",   "packages/scoring/test/phases.test.mjs"],
  ["spatial",  "packages/scoring/test/spatial.test.mjs"],
  ["wheel",    "apps/web/test/wheel.test.mjs"],
  ["roadmap",  "apps/web/test/roadmap.test.mjs"],
  // Renders components, so it needs the .jsx transform hook.
  ["system",   "apps/web/test/system.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the scorer's review sheet, so it needs the same transform.
  ["review",   "apps/web/test/innings-review.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the pad's "can't score yet" panel from a folded innings, same transform.
  ["blocked",  "apps/web/test/scoring-blocked.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the profile's dismissal-by-method card, same transform.
  ["dismissal-card", "apps/web/test/dismissal-breakdown.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  // Renders the placement charts and the capture-profile picker (SCRBRD-039).
  ["capture-profile", "apps/web/test/capture-profile.test.mjs", ["--import", "./tools/register-jsx.mjs"]],
  ["client",   "apps/web/src/rbac/rbac.test.mjs"],
  ["handover", "services/api/handover/scoring-session.test.mjs"],
  ["rls",      "services/api/rls/rls.test.mjs"],
  ["auth",     "services/api/auth/auth.test.mjs"],
  ["read",     "services/api/read/read.test.mjs"],
  ["csv",      "services/api/io/csv.test.mjs"],
  ["write",    "services/api/write/write.test.mjs"],
  ["migrate",  "tools/migrate.test.mjs"],
  ["shipped",  "tools/shipped.test.mjs"],
  ["schema-guard", "services/api/schema-guard.test.mjs"],
  ["imports",  "tools/check-imports.test.mjs"],
  ["guard",    "tools/hooks/guard.test.mjs"],
  // The typecheck strict list only grows, and names nothing that is not there.
  ["ts-scope", "tools/typecheck-scope.test.mjs"],
  ["ai",       "services/api/ai/ai.test.mjs"],
  ["realtime", "services/api/realtime/realtime.test.mjs"],
];

let allPass = true;
const summary = [];
for (const [name, path, flags = []] of SUITES) {
  const r = spawnSync("node", [...flags, path], { encoding: "utf8" });
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
