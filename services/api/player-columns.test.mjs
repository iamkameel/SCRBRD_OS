// REACH R-I (docs/design/REACH_parent_pupil.md §4 M4, §5 item 7, §6.9):
// no API route reads a masked column of `player` except through
// player_masked.
//
// player_read lets a pupil read his team-mates' rows (player.profile.read at
// his side), and player_masked — an invoker view over that same policy —
// does the masking per row and per column. So the table is open to him and
// only the view stands between him and a team-mate's address, ID number or
// fitness. Today every route that names those columns reads them from the
// view; the failure is the route written tomorrow that joins `player` for an
// email. This walks every SQL string under services/api (tests aside) and
// refuses a read of a masked column from `player` itself, or a `*` that
// would carry them all.
//
// The masked set is tables.mjs's own (maskedColumns(TABLES.player)), so a
// column masked later is held here the day it is masked.
//
// Its live half is db/99 §110: as a pupil, the `players` read word for word
// gives no masked column of a team-mate. The copy there is held to
// READ_QUERIES.players below, so the two cannot drift apart.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TABLES, maskedColumns } from "@scrbrd/policy/tables";
import { READ_QUERIES } from "./read/read-api.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
let passes = 0, fails = 0;
/** @param {string} label @param {unknown} cond @param {string} [detail] */
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};

const MASKED = [...new Set(Object.values(maskedColumns(TABLES.player)).flat())].sort();
ok("the masked set is tables.mjs's, and is not empty", MASKED.length >= 11, MASKED.join(", "));
for (const c of ["born", "id_number", "email", "phone", "address", "guardian", "height", "weight", "fitness"])
  ok(`...and holds ${c}`, MASKED.includes(c));

/**
 * The reads that name a masked column of `player` on purpose, each with its
 * reason. Each must still be there (a stale entry fails), and nothing else
 * may join them without a line here, where a reviewer sees it.
 * @type {{ file: string, column: string, count: number, why: string }[]}
 */
const ALLOWED = [
  { file: "services/api/io/import-api.mjs", column: "born", count: 2,
    why: "the players and guardians imports' `find`: the office matching a file's row to a boy by name, and " +
         "whether his birthday is already on record decides insert or update. As the office, under RLS; the " +
         "value is compared, never returned to a client." },
];

/** @param {string} dir @returns {string[]} */
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p);
  return /\.mjs$/.test(e.name) && !/\.test\.mjs$/.test(e.name) ? [p] : [];
});

// SQL keywords that may follow `from player` where an alias would stand.
const KEYWORDS = new Set(["where", "on", "join", "left", "inner", "right", "full", "cross", "order", "group",
  "limit", "using", "set", "as", "natural", "union", "returning", "for", "and", "or", "having", "window",
  "lateral", "offset", "fetch", "except", "intersect"]);

/** Every string a file holds that could be SQL: template literals and quoted strings. @param {string} src */
const literals = (src) => [
  ...[...src.matchAll(/`((?:[^`\\]|\\.)*)`/gs)].map((m) => ({ text: m[1], at: m.index ?? 0 })),
  ...[...src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)].map((m) => ({ text: m[1] ?? m[2] ?? "", at: m.index ?? 0 })),
];

/** @type {{ file: string, line: number, what: string }[]} */
const found = [];
let scanned = 0, reads = 0;
for (const path of files(join(ROOT, "services", "api"))) {
  const file = relative(ROOT, path);
  const src = readFileSync(path, "utf8");
  scanned++;
  for (const { text, at } of literals(src)) {
    for (const m of text.matchAll(/\b(?:from|join)\s+(?:public\.)?player\b(?![_.])(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
      reads++;
      const line = src.slice(0, at).split("\n").length + text.slice(0, m.index).split("\n").length - 1;
      const alias = m[1] && !KEYWORDS.has(m[1].toLowerCase()) ? m[1] : null;
      const names = alias ? [alias, "player"] : ["player"];
      for (const a of names) {
        if (new RegExp(`\\b${a}\\.\\*`).test(text)) found.push({ file, line, what: `${a}.*` });
        for (const c of MASKED) if (new RegExp(`\\b${a}\\.${c}\\b`).test(text)) found.push({ file, line, what: c });
      }
      // A star over player itself (a star over a view or a CTE is that one's business).
      if (/\bselect\s+\*\s+from\s+(?:public\.)?player\b(?![_.])/i.test(text)) found.push({ file, line, what: "select *" });
      // With no alias, a bare column name in the same statement is read from player.
      if (!alias) for (const c of MASKED) if (new RegExp(`(?<![.\\w])${c}(?!\\w)`).test(text)) found.push({ file, line, what: c });
    }
  }
}
ok(`the walk read every API file (${scanned}) and found reads of player to look at (${reads})`, scanned > 50 && reads > 10);

const key = (/** @type {{file: string, what: string}} */ f) => `${f.file} ${f.what}`;
const unexplained = found.filter((f) => !ALLOWED.some((a) => a.file === f.file && a.column === f.what));
ok("no API route reads a masked column of `player` from the table itself: player_masked, or a line in ALLOWED",
   unexplained.length === 0, unexplained.map((f) => `${f.file}:${f.line} ${f.what}`).join("\n    "));
for (const a of ALLOWED) {
  const n = found.filter((f) => key(f) === `${a.file} ${a.column}`).length;
  ok(`...ALLOWED ${a.file} ${a.column} is still there, ${a.count} time(s), and no more`, n === a.count, `found ${n}`);
}

// ── The `players` read, and db/99 §110's copy of it ─────────────────
const players = READ_QUERIES.players.text;
ok("the players read is from player_masked, never from player", /\bfrom player_masked pm\b/.test(players)
   && !/\b(?:from|join)\s+player\b(?![_.])/i.test(players), players);
const sql = (/** @type {string} */ s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const db99 = readFileSync(join(ROOT, "db", "99_rls_verify.sql"), "utf8");
const copy = /-- players:begin\n([\s\S]*?)-- players:end/.exec(db99)?.[1] ?? "";
ok("db/99 §110 asks the players read word for word", copy !== "" && sql(copy) === sql(players),
   `db/99:  ${sql(copy)}\n    API:    ${sql(players)}`);

console.log(`\nPLAYER COLUMNS: ${passes} passed, ${fails} failed`);
if (fails) process.exit(1);
