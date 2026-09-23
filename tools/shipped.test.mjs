// A migration production has run is history: tools/migrate.mjs refuses it on
// a live database the moment its hash moves. CI's regenerate-and-diff check
// cannot see that — it only proves db/01 matches the generator, and a
// regenerated db/01 matches trivially. SCRBRD-030 shipped exactly that edit.
// This holds every file listed in db/SHIPPED.sha256 to the bytes it shipped as.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};

const entries = readFileSync(join(ROOT, "db", "SHIPPED.sha256"), "utf8")
  .split("\n").filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => { const [hash, file] = l.trim().split(/\s+/); return { hash, file }; });

ok("the manifest lists something", entries.length > 0);
for (const { hash, file } of entries) {
  const path = join(ROOT, file);
  const now = existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
  ok(`${file} is byte-identical to what shipped`, now === hash,
     now ? "changed — put the change in a new db/NN file (DEPLOYING.md, 'Changing the schema after go-live')" : "missing");
}

// Shipped files are a prefix of the migration order: a gap would mean a later
// file shipped ahead of an earlier one, which bundle-sql --apply refuses.
const all = readdirSync(join(ROOT, "db")).filter((f) => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f)).sort();
const listed = new Set(entries.map((e) => e.file.replace(/^db\//, "")));
const firstUnshipped = all.findIndex((f) => !listed.has(f));
const gap = firstUnshipped === -1 ? [] : all.slice(firstUnshipped).filter((f) => listed.has(f));
ok("shipped migrations are a prefix of the migration order", gap.length === 0, gap.join(", "));

console.log(`\nSHIPPED MIGRATIONS: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
