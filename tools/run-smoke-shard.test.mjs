/**
 * The walks' shards: every walk runs, and runs once.
 *
 * CI cuts both sets of walks, the API set and the browser set, into parallel
 * shards (`--shard i/n`). A split that dropped a walk would leave a check that
 * exists and never runs, the failure this runner was written to close; one
 * that doubled a walk would only cost minutes, but is just as wrong. So this
 * holds the real CLI to it, for every n from 1 to 6, without a database:
 * `--list` prints the slice and runs nothing.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
};

const cli = (...flags) => {
  const r = spawnSync("node", ["tools/run-smoke-api.mjs", ...flags, "--list"], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, walks: r.stdout.split("\n").filter(Boolean), err: r.stderr };
};

// Every smoke walk on disk, by the name the runner uses.
const onDisk = readdirSync(join(ROOT, "tools"))
  .filter((f) => /^smoke.*\.mjs$/.test(f))
  .map((f) => f.replace(/^smoke-?/, "").replace(/\.mjs$/, ""));
// The walks the runner accounts for but never runs: NO_DB ("" is smoke.mjs)
// and BY_HAND in tools/run-smoke-api.mjs. Anything else on disk must be in
// exactly one of the two sets below.
const NOT_HERE = ["", "scorer", "persist", "a11y", "demo-cast"];

const sets = {};
for (const [label, base] of [["api", []], ["browser", ["--browser"]]]) {
  console.log(`\n${label} walks`);
  const list = (...flags) => cli(...base, ...flags);

  const whole = list();
  sets[label] = whole.walks;
  check(`${label}: --list prints the whole set`, whole.status === 0 && whole.walks.length > 0, `${whole.walks.length} walks`);
  check(`${label}: the set has no walk twice`, new Set(whole.walks).size === whole.walks.length);

  const one = list("--shard", "1/1");
  check(`${label}: --shard 1/1 is today's list, in today's order`, one.status === 0 && JSON.stringify(one.walks) === JSON.stringify(whole.walks));
  check(`${label}: --shard=1/1 reads the same as --shard 1/1`, JSON.stringify(list("--shard=1/1").walks) === JSON.stringify(whole.walks));
  // CI passes --no-rls-verify to every shard: it must not change the slice.
  check(`${label}: --no-rls-verify leaves the slice as it is`,
    JSON.stringify(list("--shard", "2/4", "--no-rls-verify").walks) === JSON.stringify(list("--shard", "2/4").walks));

  for (let n = 1; n <= 6; n++) {
    const shards = [];
    for (let i = 1; i <= n; i++) shards.push(list("--shard", `${i}/${n}`));
    const all = shards.flatMap((s) => s.walks);
    const times = new Map();
    for (const w of all) times.set(w, (times.get(w) ?? 0) + 1);
    const missing = whole.walks.filter((w) => !times.has(w));
    const doubled = [...times].filter(([, c]) => c > 1).map(([w]) => w);
    const unknown = [...times.keys()].filter((w) => !whole.walks.includes(w));
    check(`${label} n=${n}: every walk is in exactly one shard`,
      shards.every((s) => s.status === 0) && !missing.length && !doubled.length && !unknown.length && all.length === whole.walks.length,
      `missing ${missing.join(",") || "none"}; doubled ${doubled.join(",") || "none"}; unknown ${unknown.join(",") || "none"}`);
    check(`${label} n=${n}: every shard has something to run`, shards.every((s) => s.walks.length > 0));
    check(`${label} n=${n}: a shard keeps the list's order`, shards.every((s) => {
      const at = s.walks.map((w) => whole.walks.indexOf(w));
      return at.every((x, k) => k === 0 || at[k - 1] < x);
    }));
    const again = shards.map((_, k) => list("--shard", `${k + 1}/${n}`).walks);
    check(`${label} n=${n}: the split is the same every time`, JSON.stringify(again) === JSON.stringify(shards.map((s) => s.walks)));
  }

  for (const bad of ["0/4", "5/4", "1/0", "x", "1-4", ""]) {
    const r = list("--shard", bad);
    check(`${label}: --shard "${bad}" is refused`, r.status === 1 && r.walks.length === 0);
  }

  // A walk name the set does not carry is refused, never silently skipped:
  // an invented name, and a real walk from the other set.
  const stranger = label === "api" ? "browser-read" : "read";
  for (const name of ["no-such-walk", stranger]) {
    const r = list("--shard", "1/4", name);
    check(`${label}: unknown walk "${name}" is refused`, r.status === 1 && r.walks.length === 0 && /unknown walk/.test(r.err));
  }
}

// The two sets together are every walk on disk the runner is meant to run:
// nothing in both, nothing in neither.
console.log("\nboth sets");
const both = [...sets.api, ...sets.browser];
check("no walk is in both sets", new Set(both).size === both.length);
check("every browser walk on disk is in the browser set",
  JSON.stringify(onDisk.filter((w) => w.startsWith("browser-")).sort()) === JSON.stringify([...sets.browser].sort()));
const expected = onDisk.filter((w) => !NOT_HERE.includes(w)).sort();
check("the API set and the browser set are every runnable walk on disk", JSON.stringify([...both].sort()) === JSON.stringify(expected),
  `on disk but in neither: ${expected.filter((w) => !both.includes(w)).join(",") || "none"}; in a set but not on disk: ${both.filter((w) => !expected.includes(w)).join(",") || "none"}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
