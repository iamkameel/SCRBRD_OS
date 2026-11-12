#!/usr/bin/env node
/**
 * Old logs fold identically: the scoring engine at a git ref and the one in
 * this tree, over every match's log in a database and the logs the scoring
 * tests hold (RECOGNITION R12's proof, and any change to the fold after it).
 *
 * For each log, both engines fold it (deriveMatch, with the match's start
 * and format as the server folds it) and say its result and its facts; the
 * answers are compared as JSON. Fields this tree adds and the ref never had
 * are reported, never hidden: a log that carries none of the new event
 * fields must fold to exactly the ref's answer, key for key; the only
 * additions allowed are the facts' new keys (NEW_KEYS: facts.fielding empty
 * on a log that names no fielder by reference, facts.unattributed) and the
 * facts' version stamp.
 *
 *   SCRBRD_DB=r12 SCRBRD_DB_PORT=5433 node tools/replay-equality.mjs [--ref origin/main] [--db demo_season ...]
 *
 * The ref's packages/scoring/src is unpacked with `git archive` into a
 * scratch directory and imported from there; nothing in the tree moves.
 * Reads as the schema owner (db-url.mjs ownerUrl), so every match is read.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { ownerUrl, dbName } from "./db-url.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (/** @type {string} */ k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ref = opt("--ref") ?? "origin/main";
const dbs = [dbName(), ...args.flatMap((a, i) => (a === "--db" ? [args[i + 1]] : []))];

// ── The ref's engine, unpacked ────────────────────────────────────────
const scratch = mkdtempSync(join(tmpdir(), "replay-equality-"));
mkdirSync(join(scratch, "src"));
// No shell: the ref is an argument, never spliced into a command line.
const archive = spawnSync("git", ["-C", ROOT, "archive", "--", ref, "packages/scoring/src"], { maxBuffer: 64 * 1024 * 1024 });
const tar = archive.status === 0 ? spawnSync("tar", ["-x", "-C", join(scratch, "src")], { input: archive.stdout }) : archive;
if (tar.status !== 0) { console.error(`replay-equality: could not unpack ${ref}: ${String(tar.stderr ?? "")}`); process.exit(2); }
const before = await import(pathToFileURL(join(scratch, "src/packages/scoring/src/index.mjs")).href);
const after = await import(pathToFileURL(join(ROOT, "packages/scoring/src/index.mjs")).href);

/** The fields an event may carry here that the ref's events never did. */
const NEW_EVENT_FIELDS = ["fielders"];
/**
 * The answer's keys this tree adds, and what each must be for a log without
 * the new fields: no fielding line (nobody is named), and a count of the
 * fielding wickets the log cannot attribute, which is new and any number,
 * and no credit.
 * @type {Record<string, (v: unknown) => boolean>}
 */
const NEW_KEYS = { fielding: (v) => Array.isArray(v) && v.length === 0, unattributed: (v) => Number.isInteger(v), credited: (v) => v === 0 };

/** @param {any} engine @param {any[]} log @param {any} ctx */
function answer(engine, log, ctx) {
  const m = engine.deriveMatch(log, ctx);
  const facts = engine.deriveFacts ? engine.deriveFacts(log, null, { ctx }) : null;
  const result = engine.describeResult ? (() => { try { return engine.describeResult(m); } catch (e) { return `threw ${e}`; } })() : null;
  return { innings: m.innings, result, facts };
}

/** Compare two answers; returns the paths that differ. */
function differences(/** @type {any} */ a, /** @type {any} */ b, path = "") {
  /** @type {string[]} */ const out = [];
  if (a === b) return out;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path || "(root)");
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in a)) {
      // A key the ref never had: allowed only as an empty list, or the stamp.
      if (path === "facts" && NEW_KEYS[k]?.(b[k])) continue;
      out.push(`${p} (new)`);
      continue;
    }
    if (!(k in b)) { out.push(`${p} (gone)`); continue; }
    if (p === "facts.version") continue;   // the rules' stamp moves with a new kind of fact
    out.push(...differences(a[k], b[k], p));
  }
  return out;
}

let logs = 0, same = 0, carriesNew = 0;
/** @type {string[]} */ const bad = [];
/** @param {string} label @param {any[]} log @param {any} ctx */
function check(label, log, ctx = {}) {
  logs++;
  const hasNew = log.some((e) => NEW_EVENT_FIELDS.some((f) => e && f in e));
  if (hasNew) { carriesNew++; return; }   // the ref cannot read what it never knew; fielding.test.mjs holds these
  const d = differences(answer(before, log, ctx), answer(after, log, ctx));
  if (d.length === 0) same++; else bad.push(`${label}: ${d.slice(0, 4).join(", ")}`);
}

// ── The scoring tests' logs ───────────────────────────────────────────
for (const f of ["result-logs.mjs", "rain-logs.mjs"]) {
  const mod = await import(pathToFileURL(join(ROOT, "packages/scoring/test", f)).href);
  for (const list of Object.values(mod)) {
    if (!Array.isArray(list)) continue;
    for (const c of list) if (c && Array.isArray(c.log)) check(`${f} · ${c.name}`, c.log, c.ctx ?? {});
  }
}

// ── Every match in each database ──────────────────────────────────────
for (const db of dbs) {
  const url = ownerUrl().replace(/\/[^/]+$/, `/${db}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows: matches } = await client.query(
    `select distinct b.match_id, m.starts_at, m.format from ball_event b left join match m on m.id = b.match_id order by 1`);
  for (const m of matches) {
    const { rows } = await client.query(`select * from ball_event where match_id = $1 order by seq`, [m.match_id]);
    const log = rows.map(after.fromRow);
    check(`${db} · ${m.match_id}`, log, { startsAt: m.starts_at ?? undefined, format: m.format ?? undefined });
  }
  await client.end();
}
rmSync(scratch, { recursive: true, force: true });

console.log(`replay-equality against ${ref}: ${logs} logs (${dbs.join(", ")} and the scoring tests' logs); `
  + `${same} fold identically, ${bad.length} differ, ${carriesNew} carry fields the ref never had (not compared)`);
for (const b of bad.slice(0, 20)) console.log("  ✗", b);
process.exit(bad.length ? 1 : 0);
