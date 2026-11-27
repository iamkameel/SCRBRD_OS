// tools/verify-until.mjs: where db/99 is cut, and that the cut compiles.
//
// The cut is the one thing the tool decides: db/99's own text up to the next
// section's marker, closed. Held here against a small file shaped like db/99
// and against db/99 itself, so a marker moved inside a nested block (where a
// cut would not compile) fails here rather than an hour into a run.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sections, cutThrough } from "./verify-until.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const mark = (n) => `  RAISE NOTICE '%', pg_temp._v_section('§${n} heading of ${n}');`;
const toy = [
  "BEGIN;",
  "-- Each section opens with",
  "--   RAISE NOTICE '%', pg_temp._v_section('§N its heading');",
  "DO $$",
  "BEGIN",
  mark(1), "  PERFORM 1;",
  mark(8), "  PERFORM 8;",
  mark("8b"), "  PERFORM 80;",
  mark(83), "  PERFORM 83;",
  mark(49), "  PERFORM 49;",
  mark(48), "  PERFORM 48;",
  "  RAISE NOTICE '%', pg_temp._v_section_summary();",
  "END $$;",
  "ROLLBACK;",
  "",
].join("\n");

ok("the sections in file order, the comment showing a marker not among them",
  sections(toy).map((s) => s.n).join(" ") === "1 8 8b 83 49 48");
{
  const cut = cutThrough(toy, "8");
  ok("through §8 keeps §8 whole and stops at §8b's marker",
    cut.includes("PERFORM 8;") && !cut.includes("PERFORM 80;") && !cut.includes("§8b heading"));
  ok("the cut is closed: the summary, END $$; and ROLLBACK;",
    /_v_section_summary\(\);\n {2}RAISE NOTICE 'verify-until: stopped after §8, before §8b; rolled back';\nEND \$\$;\n\nROLLBACK;\n$/.test(cut));
  ok("the cut's text before the close is the file's own, line for line",
    toy.startsWith(cut.slice(0, cut.indexOf("  RAISE NOTICE '%', pg_temp._v_section_summary();"))));
}
ok("§83 is not §8, and a leading § is allowed", cutThrough(toy, "§83").includes("PERFORM 83;") && !cutThrough(toy, "§83").includes("PERFORM 49;"));
ok("file order, not number order: through §49 stops before §48",
  cutThrough(toy, "49").includes("PERFORM 49;") && !cutThrough(toy, "49").includes("PERFORM 48;"));
ok("through the last section is the whole file", cutThrough(toy, "48") === toy);
ok("an unknown section is refused", throws(() => cutThrough(toy, "84")));
ok("a section that opens twice is refused", throws(() => cutThrough(toy + mark(83) + "\n", "83")));
ok("a marker that is not a top-level statement of the block is refused",
  throws(() => sections(toy.replace(mark(49), "  IF true THEN\n  " + mark(49) + "\n  END IF;"))));

// db/99 itself.
const real = readFileSync(join(ROOT, "db", "99_rls_verify.sql"), "utf8");
let all = [];
ok("every section marker in db/99 is a top-level statement of its DO block", !throws(() => { all = sections(real); }));
ok("db/99 has the sections this tool is for, in file order",
  ["83", "84", "89", "90", "126", "127"].every((n) => all.some((s) => s.n === n))
    && all.findIndex((s) => s.n === "83") < all.findIndex((s) => s.n === "89")
    && all.findIndex((s) => s.n === "89") < all.findIndex((s) => s.n === "126"));
for (const n of ["83", "89", "126"]) {
  const next = all[all.findIndex((s) => s.n === n) + 1];
  const cut = cutThrough(real, n);
  ok(`db/99 through §${n} ends where §${next.n} opens, then closes`,
    !cut.includes(next.label) && cut.endsWith("END $$;\n\nROLLBACK;\n"));
}
ok("db/99 through its last section is the whole file", cutThrough(real, all[all.length - 1].n) === real);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
