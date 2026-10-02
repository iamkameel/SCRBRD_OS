/**
 * The browser walks' shards: every walk runs, and runs once.
 *
 * CI cuts the browser walks into parallel shards (`--shard i/n`). A split that
 * dropped a walk would leave a check that exists and never runs, the failure
 * this runner was written to close; one that doubled a walk would only cost
 * minutes, but is just as wrong. So this holds the real CLI to it, for every n
 * from 1 to 6, without a database: `--list` prints the slice and runs nothing.
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

const list = (...flags) => {
  const r = spawnSync("node", ["tools/run-smoke-api.mjs", "--browser", ...flags, "--list"], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, walks: r.stdout.split("\n").filter(Boolean), err: r.stderr };
};

const whole = list();
check("--browser --list prints the whole set", whole.status === 0 && whole.walks.length > 0, `${whole.walks.length} walks`);
check("the set has no walk twice", new Set(whole.walks).size === whole.walks.length);

// The set on disk: a smoke-browser-*.mjs the list does not carry is a walk
// nobody runs (the runner refuses that too, so this is the second lock).
const onDisk = readdirSync(join(ROOT, "tools"))
  .filter((f) => /^smoke-browser-.*\.mjs$/.test(f))
  .map((f) => f.replace(/^smoke-/, "").replace(/\.mjs$/, ""))
  .sort();
check("the whole set is the browser walks on disk", JSON.stringify([...whole.walks].sort()) === JSON.stringify(onDisk));

const one = list("--shard", "1/1");
check("--shard 1/1 is today's list, in today's order", one.status === 0 && JSON.stringify(one.walks) === JSON.stringify(whole.walks));
check("--shard=1/1 reads the same as --shard 1/1", JSON.stringify(list("--shard=1/1").walks) === JSON.stringify(whole.walks));

for (let n = 1; n <= 6; n++) {
  const shards = [];
  for (let i = 1; i <= n; i++) shards.push(list("--shard", `${i}/${n}`));
  const all = shards.flatMap((s) => s.walks);
  const times = new Map();
  for (const w of all) times.set(w, (times.get(w) ?? 0) + 1);
  const missing = whole.walks.filter((w) => !times.has(w));
  const doubled = [...times].filter(([, c]) => c > 1).map(([w]) => w);
  const unknown = [...times.keys()].filter((w) => !whole.walks.includes(w));
  check(`n=${n}: every walk is in exactly one shard`,
    shards.every((s) => s.status === 0) && !missing.length && !doubled.length && !unknown.length && all.length === whole.walks.length,
    `missing ${missing.join(",") || "none"}; doubled ${doubled.join(",") || "none"}; unknown ${unknown.join(",") || "none"}`);
  check(`n=${n}: every shard has something to run`, shards.every((s) => s.walks.length > 0));
  check(`n=${n}: a shard keeps the list's order`, shards.every((s) => {
    const at = s.walks.map((w) => whole.walks.indexOf(w));
    return at.every((x, k) => k === 0 || at[k - 1] < x);
  }));
  const again = shards.map((_, k) => list("--shard", `${k + 1}/${n}`).walks);
  check(`n=${n}: the split is the same every time`, JSON.stringify(again) === JSON.stringify(shards.map((s) => s.walks)));
}

for (const bad of ["0/4", "5/4", "1/0", "x", "1-4", ""]) {
  const r = list("--shard", bad);
  check(`--shard "${bad}" is refused`, r.status === 1 && r.walks.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
