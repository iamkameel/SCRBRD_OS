/**
 * The DLS Standard Edition calculator (SCRBRD-130 R2; docs/design/SCRBRD-130_rain_and_par.md
 * §3, §4). SYNTHETIC ONLY: every figure below is hand-computed from
 * syntheticTable()'s formula, round(b × (10 − w) ÷ 3) tenths for a 300-ball
 * table — a straight line the real table is not. No resource figure of the
 * published table, and no G50 a document gives, is in this file: the G50
 * below is this file's own constant.
 *
 *   A. the synthetic table: its shape, both grains, its canonical text and
 *      the hash db/99 §54 compares SQL's with
 *   B. the structural checks: each refusing a table broken in that one way
 *   C. resources: ball grain, over grain interpolated exactly, equal at whole overs
 *   D. §3.3's seven cases, the G50 line with and without G50, no table, not limited
 *   E. the proposals: resume at fewer overs, terminate at a stop, par at a point
 *   F. the fold's own figures through a real log
 *   G. the words
 *   H. D5: no resource row and no published table in the repository (the CI grep)
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  syntheticTable, dlsTable, structuralProblems, canonicalText, resourcesOf, inningsResources, parFrom, dlsTarget,
  dlsParAt, dlsWords, differenceWords, DLS_STATUS, DLS_PROBLEM, SYNTHETIC_TITLE, SCALE, deriveMatch,
} from "../src/index.mjs";
import { RAIN_LOGS, RAIN_STARTS_AT } from "./rain-logs.mjs";

let pass = 0, fail = 0;
/** @type {(n: string, c: unknown, detail?: unknown) => void} */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

/** This file's own G50: not a figure any document gives. */
const G50_TEST = 150;
const BALL = syntheticTable({ grain: "ball" });
const OVER = syntheticTable({ grain: "over" });
/** The hash db/99 §54 pins for the ball-grain synthetic table. */
export const SYNTHETIC_BALL_SHA256 = createHash("sha256").update(canonicalText(BALL)).digest("hex");

group("A. The synthetic table");
ok("titled SYNTHETIC, 301 × 10 cells by the ball, 51 × 10 by the over", BALL.title === SYNTHETIC_TITLE && BALL.cells.size === 3010 && OVER.cells.size === 510);
ok("R(300,0) = 1000, R(0,w) = 0, R(120,0) = 400, R(45,3) = 105 (round(45 × 7 ÷ 3))",
   BALL.cells.get("300,0") === 1000 && BALL.cells.get("0,9") === 0 && BALL.cells.get("120,0") === 400 && BALL.cells.get("45,3") === 105);
ok("half up: R(46,3) = round(107.33) = 107; R(1,0) = round(3.33) = 3; R(2,9) = round(0.67) = 1",
   BALL.cells.get("46,3") === 107 && BALL.cells.get("1,0") === 3 && BALL.cells.get("2,9") === 1);
ok("it passes its own structural checks, at both grains", structuralProblems(BALL).length === 0 && structuralProblems(OVER).length === 0);
const text = canonicalText(BALL);
ok("the canonical text: b,w,tenths per line, in (b, w) order", text.startsWith("0,0,0\n0,1,0\n") && text.endsWith("300,9,100\n") && text.split("\n").length === 3011);
// db/99 §54 builds the same text from the rows db/75 stored and pins these two.
ok("the hashes db/99 §54 pins, both grains", SYNTHETIC_BALL_SHA256 === "0847f8f488da304bddc426b9d0d50febfac43e6461fc7016b365da151b1dfa47"
   && createHash("sha256").update(canonicalText(OVER)).digest("hex") === "95766fbf157ef9908c29ab997d53807a2bdaa9eedca81ed7367db0a5d8afc564",
   SYNTHETIC_BALL_SHA256);
ok("a table loaded twice from one file has one hash; one changed by a cell does not",
   canonicalText(dlsTable({ grain: "ball", maxBalls: 300, rows: /** @type {any} */ ([...BALL.cells].map(([k, v]) => [...k.split(",").map(Number), v])) })) === text
   && canonicalText(dlsTable({ grain: "ball", maxBalls: 300, rows: /** @type {any} */ ([...BALL.cells].map(([k, v]) => [...k.split(",").map(Number), k === "120,0" ? 401 : v])) })) !== text);

group("B. The structural checks, each refusing one break");
{
  const broken = (/** @type {(b: number, w: number, v: number) => number | undefined} */ f, grain = "ball") => {
    const t = grain === "ball" ? BALL : OVER;
    const rows = [];
    for (const [k, v] of t.cells) { const [b, w] = k.split(",").map(Number); const x = f(b, w, v); if (x !== undefined) rows.push([b, w, x]); }
    return structuralProblems(dlsTable({ grain, maxBalls: 300, rows: /** @type {any} */ (rows) }));
  };
  ok("a cell missing", JSON.stringify(broken((b, w, v) => (b === 77 && w === 5 ? undefined : v))) === JSON.stringify([DLS_PROBLEM.MISSING_CELL]));
  ok("an over table with a cell inside an over", structuralProblems(dlsTable({ grain: "over", maxBalls: 300, rows: /** @type {any} */ ([...OVER.cells].map(([k, v]) => [...k.split(",").map(Number), v]).concat([[7, 0, 2]])) })).includes(DLS_PROBLEM.MISSING_CELL));
  ok("R(0, w) not nought", JSON.stringify(broken((b, w, v) => (b === 0 && w === 4 ? 1 : v))).includes(DLS_PROBLEM.NOT_ZERO_AT_END));
  ok("R(max, 0) not 1000", broken((b, w, v) => (b === 300 && w === 0 ? 999 : v)).includes(DLS_PROBLEM.NOT_FULL_AT_START));
  ok("falling as balls remaining rise", broken((b, w, v) => (b === 150 && w === 2 ? 10 : v)).includes(DLS_PROBLEM.NOT_RISING_IN_BALLS));
  ok("rising as wickets fall", broken((b, w, v) => (b === 150 && w === 6 ? 900 : v)).includes(DLS_PROBLEM.NOT_FALLING_IN_WICKETS));
  ok("a value outside 0–1000", broken((b, w, v) => (b === 299 && w === 0 ? 1001 : v)).includes(DLS_PROBLEM.OUT_OF_RANGE));
  ok("a grain that is neither", JSON.stringify(structuralProblems(dlsTable({ grain: "inning", maxBalls: 300, rows: [] }))) === JSON.stringify([DLS_PROBLEM.GRAIN]));
}

group("C. Resources, in tenths × 6");
ok("ball grain: R(45,3) × 6 = 630", resourcesOf(BALL, 45, 3) === 630 && SCALE === 6);
ok("over grain, within an over, exact: (6 − 3) × R(42,3) + 3 × R(48,3) = 3 × 98 + 3 × 112 = 630", resourcesOf(OVER, 45, 3) === 630);
ok("over grain at 46 balls: 2 × 98 + 4 × 112 = 644 (the ball table's 642 rounds first)", resourcesOf(OVER, 46, 3) === 644 && resourcesOf(BALL, 46, 3) === 642);
{
  let same = true;
  for (let b = 0; b <= 300; b += 6) for (let w = 0; w < 10; w++) if (resourcesOf(OVER, b, w) !== resourcesOf(BALL, b, w)) same = false;
  ok("over grain equals ball grain at every whole over", same);
}
ok("no balls left, ten down: nothing; past the table's end: no answer", resourcesOf(BALL, 0, 0) === 0 && resourcesOf(BALL, 50, 10) === 0 && resourcesOf(BALL, 301, 0) === null);

group("D. §3.3's cases against hand figures (synthetic, 20-over innings)");
/** A folded innings, as far as the calculator reads one. */
const inn = (/** @type {any} */ o) => ({ startOvers: 20, overs: 20, runs: 0, balls: 0, wickets: 0, interruptions: [], overCuts: [], ...o });
const T = (/** @type {any[]} */ innings, /** @type {any} */ o = {}) => dlsTarget(innings, { table: BALL, g50: G50_TEST, ...o });
{
  // 1. Delayed start: both to 16 overs. R₁ = R₂ = R(96,0) = 320 → target S + 1.
  const r = T([inn({ startOvers: 16, overs: 16, runs: 121 }), inn({ startOvers: 16, overs: 16, target: 122 })]);
  ok("case 1, a delayed start: equal resources, target 122 from 121", r.status === "ok" && r.target === 122 && r.case === "1" && r.line === "equal", r);
}
{
  // 2. First innings stopped at 12.3 (75 balls, 3 down), resumed at 16:
  //    loss = R(45,3) − R(21,3) = 105 − 49 = 56; R₁ = 400 − 56 = 344.
  //    Chase 16 overs: R₂ = 320 < 344: ⌊121 × 320 ÷ 344⌋ = ⌊112.56⌋ = 112 → 113.
  const a = inn({ overs: 16, runs: 121, balls: 96, interruptions: [{ balls: 75, wickets: 3, oversAtStop: 20, oversAtResume: 16 }] });
  const r = T([a], { chaseOvers: 16 });
  ok("case 2, the first innings cut: R₁ 344, chase of 16 overs, target 113", r.target === 113 && r.case === "2"
     && r.resources?.first === 344 * 6 && r.resources.second === 320 * 6, r);
  // ...a chase of 18 overs: R₂ = 360 > 344: 121 + ⌊150 × 16 ÷ 1000⌋ = 121 + 2 = 123 → 124.
  const g = T([a], { chaseOvers: 18 });
  ok("...a chase given more than the first side had: the G50 line, 121 + ⌊G50 × 16 ÷ 1000⌋ → 124", g.target === 124 && g.line === "g50", g);
  const n = T([a], { chaseOvers: 18, g50: null });
  ok("...with no G50 set: no_g50, the first two lines still answer", n.status === DLS_STATUS.NO_G50 && n.target === null
     && T([a], { chaseOvers: 16, g50: null }).target === 113, n);
}
{
  // 3. First innings terminated at 12.3, 3 down: R₁ = 400 − 105 = 295.
  //    Chase 12 overs: R₂ = 240: ⌊87 × 240 ÷ 295⌋ = ⌊70.78⌋ = 70 → 71.
  const r = T([inn({ runs: 87, balls: 75, wickets: 3, interruptions: [{ balls: 75, wickets: 3, oversAtStop: 20, oversAtResume: null }] })], { chaseOvers: 12 });
  ok("case 3, the first innings terminated: target 71", r.target === 71 && r.case === "3", r);
}
{
  // 4. Interval lost: S 150 in 20; chase 15: R₂ = 300: ⌊150 × 300 ÷ 400⌋ = 112 → 113.
  const r = T([inn({ runs: 150, balls: 120 })], { chaseOvers: 15 });
  ok("case 4, the interval lost: target 113", r.target === 113 && r.case === "4", r);
}
{
  // 5. Chase stopped at 10.0, 2 down, resumed at 15: loss = R(60,2) − R(30,2) = 160 − 80 = 80;
  //    R₂ = 320: ⌊150 × 320 ÷ 400⌋ = 120 → 121.
  const r = T([inn({ runs: 150, balls: 120 }), inn({ overs: 15, balls: 60, wickets: 2, interruptions: [{ balls: 60, wickets: 2, oversAtStop: 20, oversAtResume: 15 }] })]);
  ok("case 5, the chase cut: target 121", r.target === 121 && r.case === "5" && r.kind === "target", r);
}
{
  // 6. Chase terminated at 9.0, 4 down: loss = R(66,4) = 132; R₂ = 268:
  //    ⌊150 × 268 ÷ 400⌋ = ⌊100.5⌋ = 100: the par.
  const r = T([inn({ runs: 150, balls: 120 }), inn({ balls: 54, wickets: 4, interruptions: [{ balls: 54, wickets: 4, oversAtStop: 20, oversAtResume: null }] })]);
  ok("case 6, the chase terminated: par 100", r.par === 100 && r.kind === "par" && r.case === "6", r);
}
{
  // n. Two in the first innings, one mid-over: stopped at 5.3 (33 balls, 1 down) → 18 overs:
  //    R(87,1) − R(75,1) = 261 − 225 = 36; stopped at 14.0 (84, 4 down) → 16 overs:
  //    R(24,4) − R(12,4) = 48 − 24 = 24; R₁ = 400 − 60 = 340. Chase 16: ⌊130 × 320 ÷ 340⌋ = 122 → 123.
  const r = T([inn({ overs: 16, runs: 130, balls: 96, interruptions: [
    { balls: 33, wickets: 1, oversAtStop: 20, oversAtResume: 18 }, { balls: 84, wickets: 4, oversAtStop: 18, oversAtResume: 16 }] })], { chaseOvers: 16 });
  ok("case n, two interruptions, one mid-over: target 123", r.target === 123 && r.case === "n" && r.resources?.first === 340 * 6, r);
}
{
  // A cut with no stop open (the revision sheet) is an interruption at its position:
  // at 12.3, 3 down, 20 → 16 is case 2's loss.
  const r = T([inn({ overs: 16, runs: 121, balls: 96, overCuts: [{ balls: 75, wickets: 3, from: 20, to: 16 }] })], { chaseOvers: 16 });
  ok("a cut made with no stop open counts as case 2's", r.target === 113, r);
}
ok("over grain gives the same at whole overs (case 4: 113)", dlsTarget([inn({ runs: 150, balls: 120 })], { table: OVER, g50: G50_TEST, chaseOvers: 15 }).target === 113);
ok("no table: no_table", dlsTarget([inn({ runs: 150 })], { table: null, chaseOvers: 15 }).status === DLS_STATUS.NO_TABLE);
ok("two innings a side, or a declaration match: not_limited",
   T([inn({ runs: 150 })], { conditions: { "format.innings_per_side": 2 } }).status === DLS_STATUS.NOT_LIMITED
   && T([inn({ runs: 150 })], { conditions: { "format.kind": "declaration" } }).status === DLS_STATUS.NOT_LIMITED);
ok("parFrom: one floor per line", parFrom(10, 3, 2, null).par === 6 && parFrom(10, 3, 3, null).par === 10 && parFrom(10, 1000, 1006, 1000).par === 11);

group("E. The proposals");
{
  const a = inn({ runs: 150, balls: 120 });
  const open = inn({ balls: 60, wickets: 2, interruptions: [{ balls: 60, wickets: 2, oversAtStop: 20, oversAtResume: undefined }] });
  ok("a stop still open is no loss yet: the chase's target stands at 151", T([a, open]).target === 151);
  ok("the Resume sheet's proposal: resumed at 15 overs → 121 (case 5)", T([a, open], { resumeOvers: 15 }).target === 121);
  const end = inn({ balls: 54, wickets: 4, interruptions: [{ balls: 54, wickets: 4, oversAtStop: 20, oversAtResume: undefined }] });
  ok("the end sheet's proposal: terminated here → par 100 (case 6)", T([a, end], { terminate: true }).par === 100 && T([a, end], { terminate: true }).kind === "par");
  // Par at a point: 10.0, 2 down: R₂ = 400 − R(60,2) = 240: ⌊150 × 240 ÷ 400⌋ = 90.
  const p = dlsParAt([a, inn({ balls: 60, wickets: 2, runs: 70 })], { table: BALL, g50: G50_TEST });
  ok("par at a point: 90 at 10.0 for 2 (the chase on 70 is behind it)", p.par === 90 && p.kind === "par", p);
  ok("a later version of the table, given, changes nothing the earlier one said (each result names its table)",
     T([a], { chaseOvers: 15, table: { ...BALL, id: "t1", version: 1 } }).tableVersion === 1);
}

group("F. The fold's own figures, through a real log");
{
  const m = deriveMatch(RAIN_LOGS[0].log, { startsAt: RAIN_STARTS_AT });
  const [a] = m.innings;
  ok("the fold carries the allotment it started with, and the stop", a.startOvers === 5 && a.overs === 4 && a.interruptions.length === 1);
  const r = inningsResources(BALL, a);
  // N 30 balls: R(30,0) = 100; stopped at 2.0 (12 balls) → 4 overs: R(18,0) − R(12,0) = 60 − 40 = 20; R₁ = 80.
  ok("its resources: R(30,0) − [R(18,0) − R(12,0)] = 100 − 20 = 80 tenths", r?.available === 80 * 6, r);
  const cut = deriveMatch([...RAIN_LOGS[10].log], { startsAt: RAIN_STARTS_AT }).innings[0];
  ok("a log with no cut has none", cut.overCuts.length === 0);
}

group("G. The words");
{
  const r = T([inn({ runs: 150, balls: 120 })], { chaseOvers: 15, table: { ...BALL, id: "t1", version: 1 } });
  ok("a target", dlsWords(r) === "SCRBRD calculates 113 (DLS Standard, table v1)", dlsWords(r));
  ok("the G50 line says so", /G50 from the league's conditions/.test(String(dlsWords(T([inn({ overs: 16, runs: 121, balls: 96, interruptions: [{ balls: 75, wickets: 3, oversAtStop: 20, oversAtResume: 16 }] })], { chaseOvers: 18 })))));
  ok("over grain says it interpolated", /interpolated within the over/.test(String(dlsWords(dlsTarget([inn({ runs: 150, balls: 120 })], { table: OVER, chaseOvers: 15 })))));
  ok("no table, no G50", dlsWords({ ...r, status: DLS_STATUS.NO_TABLE }) === "No DLS table loaded; enter the umpires' figures"
     && dlsWords({ ...r, status: DLS_STATUS.NO_G50 }) === "G50 not set for this competition: enter the umpires' target");
  ok("a par, from a withdrawn table", /^SCRBRD calculates a par of 100 .*table since withdrawn/.test(String(dlsWords({ ...r, kind: "par", par: 100 }, { withdrawn: true }))));
  ok("the difference: kept and shown, only when there is one", differenceWords(134, 133) === "umpires 134 · calculated 133"
     && differenceWords(134, 134) === "umpires 134" && differenceWords(null, 133) === null);
}

group("H. D5: no resource row, no published table, in the repository");
{
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
  /** @param {string} dir @param {RegExp} keep @returns {string[]} */
  const walk = (dir, keep) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "node_modules" || f === "dist" || f.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p, keep) : keep.test(f) ? [p] : [];
  });
  const self = fileURLToPath(import.meta.url);
  const files = [...walk(join(root, "db"), /\.sql$/), ...walk(join(root, "packages"), /\.(mjs|js|json|csv)$/),
                 ...walk(join(root, "services"), /\.(mjs|js|json|csv)$/), ...walk(join(root, "tools"), /\.(mjs|js|json|csv)$/)]
    .filter((f) => f !== self);   // this file names the patterns it looks for
  // A row of resources is an INSERT … VALUES of literals into dls_resource;
  // db/75's loader inserts from its jsonb argument, the proofs from the
  // synthetic formula (SELECT … generate_series), never a literal row.
  const rows = files.filter((f) => /INSERT\s+INTO\s+(public\.)?dls_resource\s*\([^)]*\)\s*VALUES\s*\(\s*['\d]/i.test(readFileSync(f, "utf8")));
  ok(`no file writes a resource row as a literal (${files.length} files read)`, rows.length === 0, rows);
  const tables = files.filter((f) => /INSERT\s+INTO\s+(public\.)?dls_resource_table\b[^;]*VALUES\s*\(\s*['\d]/i.test(readFileSync(f, "utf8")));
  ok("no file writes a table row as a literal", tables.length === 0, tables);
  const csv = files.filter((f) => f.endsWith(".csv") && /^\s*\d+\s*,\s*\d\s*,\s*\d+\s*$/m.test(readFileSync(f, "utf8")));
  ok("no CSV of b,w,tenths rows", csv.length === 0, csv);
  const published = files.filter((f) => !f.endsWith("dls.mjs") && /title[^\n]*DLS Standard Edition[^\n]*status[^\n]*published/i.test(readFileSync(f, "utf8")));
  ok("no published Standard Edition table described in code", published.length === 0, published);
}

console.log(`\n${"─".repeat(52)}\nDLS SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
