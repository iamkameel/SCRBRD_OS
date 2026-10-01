/**
 * SCRBRD — the DLS Standard Edition calculator (SCRBRD-130 phase R2;
 * docs/design/SCRBRD-130_rain_and_par.md §3, §4).
 *
 * THE UMPIRES' FIGURE IS THE RECORD (D1). This module calculates and the
 * screens show the calculation beside the announced figure, with the
 * difference; a difference never refuses, flags or corrects. Nothing here is
 * written to the log: a proposal is a read, reproducible forever from the
 * log, the match's frozen conditions and the table its document names.
 *
 * THE TABLE IS DATA, NEVER CODE (D5). No resource figure of the published
 * Standard Edition is in this file, in a test, a fixture or a migration: an
 * operator loads the table from the official source through the admin route
 * (db/75's dls_table_load()), and the calculator runs on the server only
 * (D6): no route serves a cell. The one table in the repository is
 * syntheticTable(), a straight line in both directions that the real table is
 * not, titled "SYNTHETIC — tests only", which db/75 refuses to publish.
 *
 * THE SHAPE (§3.2–§3.3). R(b, w): resources remaining with b balls remaining
 * and w wickets lost, in tenths of a percent (R(max, 0) = 1000). Each side's
 * resources are what it started with less what each interruption took away:
 * loss = R(b_stop, w) − R(b_resume, w), terminated b_resume = 0. Then
 *
 *   R₂ < R₁  par = ⌊S × R₂ / R₁⌋
 *   R₂ = R₁  par = S
 *   R₂ > R₁  par = S + ⌊G50 × (R₂ − R₁) / 1000⌋     (G50 the competition's, D7)
 *   target = par + 1
 *
 * Integer arithmetic throughout, one floor per line. Every R is carried
 * scaled by 6 (`SCALE`), so a per-over table's within-over interpolation is
 * exact: R(6k + j) × 6 = (6 − j) × R(6k) + j × R(6k + 6). The ratio, and the
 * G50 line's 1000, scale with it.
 */

/** Every R below is in tenths of a percent × SCALE. */
export const SCALE = 6;
/** R(max, 0), in tenths: the whole of an innings. */
export const FULL_TENTHS = 1000;
/** The synthetic table's title: db/75 refuses to publish a table whose title begins SYNTHETIC. */
export const SYNTHETIC_TITLE = "SYNTHETIC — tests only";

/** What a calculation answers. */
export const DLS_STATUS = Object.freeze({
  OK: "ok", NO_TABLE: "no_table", NO_G50: "no_g50", NOT_LIMITED: "not_limited", NOT_APPLICABLE: "not_applicable",
});

/** Why a table is refused at load (§4.3); db/75's dls_table_problems() names the same. */
export const DLS_PROBLEM = Object.freeze({
  GRAIN: "grain",                         // not ball or over, or a maximum that is not a whole number of overs
  MISSING_CELL: "missing_cell",           // a cell its grain needs is absent, or one it does not need is present
  OUT_OF_RANGE: "out_of_range",           // a value outside 0–1000 tenths, or not a whole number
  NOT_ZERO_AT_END: "not_zero_at_end",     // R(0, w) ≠ 0
  NOT_FULL_AT_START: "not_full_at_start", // R(max, 0) ≠ 1000
  NOT_RISING_IN_BALLS: "not_rising_in_balls",     // R falls as balls remaining rise, for some w
  NOT_FALLING_IN_WICKETS: "not_falling_in_wickets", // R rises as wickets fall, for some b
});

/**
 * A resource table as the calculator reads it.
 * @typedef {object} DlsTable
 * @property {string | null} [id]
 * @property {number | null} [version]
 * @property {string} [title]
 * @property {"ball" | "over"} grain
 * @property {number} maxBalls
 * @property {Map<string, number>} cells   "b,w" → tenths
 */

/** @param {number} b @param {number} w */
const at = (b, w) => `${b},${w}`;

/**
 * A table from its rows, as db/75 stores them or a CSV gives them.
 * @param {{id?: string | null, version?: number | null, title?: string, grain: string, maxBalls: number,
 *          rows: Iterable<[number, number, number] | {b: number, w: number, tenths: number}>}} o
 * @returns {DlsTable}
 */
export function dlsTable({ id = null, version = null, title = "", grain, maxBalls, rows }) {
  /** @type {Map<string, number>} */
  const cells = new Map();
  for (const r of rows) {
    const [b, w, t] = Array.isArray(r) ? r : [r.b, r.w, r.tenths];
    cells.set(at(Number(b), Number(w)), Number(t));
  }
  return { id, version, title, grain: /** @type {"ball" | "over"} */ (grain), maxBalls: Number(maxBalls), cells };
}

/** The balls-remaining values a grain has a cell for. @param {string} grain @param {number} maxBalls */
export function gridBalls(grain, maxBalls) {
  const out = [];
  for (let b = 0; b <= maxBalls; b += grain === "over" ? 6 : 1) out.push(b);
  return out;
}

/**
 * What is wrong with a table, structurally (§4.3), as codes — empty when
 * nothing is. No real figure is needed to check any of these.
 * @param {DlsTable} table
 * @returns {string[]}
 */
export function structuralProblems(table) {
  /** @type {Set<string>} */
  const out = new Set();
  const { grain, maxBalls, cells } = table;
  if ((grain !== "ball" && grain !== "over") || !Number.isInteger(maxBalls) || maxBalls <= 0 || maxBalls % 6 !== 0) {
    return [DLS_PROBLEM.GRAIN];
  }
  const balls = gridBalls(grain, maxBalls);
  const want = new Set(balls.flatMap((b) => Array.from({ length: 10 }, (_, w) => at(b, w))));
  for (const k of want) if (!cells.has(k)) out.add(DLS_PROBLEM.MISSING_CELL);
  for (const k of cells.keys()) if (!want.has(k)) out.add(DLS_PROBLEM.MISSING_CELL);
  for (const v of cells.values()) if (!Number.isInteger(v) || v < 0 || v > FULL_TENTHS) out.add(DLS_PROBLEM.OUT_OF_RANGE);
  if (out.has(DLS_PROBLEM.MISSING_CELL)) return [...out];
  for (let w = 0; w < 10; w++) if (cells.get(at(0, w)) !== 0) out.add(DLS_PROBLEM.NOT_ZERO_AT_END);
  if (cells.get(at(maxBalls, 0)) !== FULL_TENTHS) out.add(DLS_PROBLEM.NOT_FULL_AT_START);
  for (let w = 0; w < 10; w++) {
    for (let i = 1; i < balls.length; i++) {
      if (/** @type {number} */ (cells.get(at(balls[i], w))) < /** @type {number} */ (cells.get(at(balls[i - 1], w)))) out.add(DLS_PROBLEM.NOT_RISING_IN_BALLS);
    }
  }
  for (const b of balls) {
    for (let w = 1; w < 10; w++) {
      if (/** @type {number} */ (cells.get(at(b, w))) > /** @type {number} */ (cells.get(at(b, w - 1)))) out.add(DLS_PROBLEM.NOT_FALLING_IN_WICKETS);
    }
  }
  return [...out];
}

/**
 * The string the table's content hash is taken over (§4.3): "b,w,tenths\n"
 * per cell, in (b, w) order. db/75 builds the same string from the stored
 * rows, so a table loaded twice from one file has one hash, and one copied
 * by hand does not. sha256 of it is the server's (node:crypto, pgcrypto's
 * sha256()): this module runs in the browser too and holds no digest.
 * @param {DlsTable} table
 */
export function canonicalText(table) {
  const keys = [...table.cells.keys()].map((k) => k.split(",").map(Number))
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return keys.map(([b, w]) => `${b},${w},${table.cells.get(at(b, w))}\n`).join("");
}

/**
 * THE SYNTHETIC TABLE: tests only (§4.5). Chosen to be obviously not the
 * real one — linear in both directions, which the real table is not:
 *
 *   tenths = round( 1000 × (b / max) × (1 − w / 10) ),  half up
 *
 * With max = 300 that is round(b × (10 − w) ÷ 3): R(120, 0) = 400,
 * R(45, 3) = 105. Every worked example in the tests and db/99 §54 is
 * hand-computed from it.
 * @param {{grain?: "ball" | "over", maxBalls?: number}} [o]
 * @returns {DlsTable}
 */
export function syntheticTable({ grain = "ball", maxBalls = 300 } = {}) {
  const rows = [];
  for (const b of gridBalls(grain, maxBalls)) {
    for (let w = 0; w < 10; w++) {
      const num = FULL_TENTHS * b * (10 - w), den = 10 * maxBalls;
      rows.push([b, w, Math.floor((2 * num + den) / (2 * den))]);
    }
  }
  return dlsTable({ id: null, version: null, title: SYNTHETIC_TITLE, grain, maxBalls, rows: /** @type {any} */ (rows) });
}

/**
 * R(b, w) × SCALE, or null where the table cannot say (b past its maximum, a
 * cell missing). No balls left, or ten wickets down, is nothing.
 * @param {DlsTable | null | undefined} table
 * @param {number} b  balls remaining
 * @param {number} w  wickets lost
 * @returns {number | null}
 */
export function resourcesOf(table, b, w) {
  if (!table || !Number.isInteger(b) || !Number.isInteger(w) || w < 0) return null;
  if (b <= 0 || w >= 10) return 0;
  if (b > table.maxBalls) return null;
  if (table.grain === "ball") {
    const v = table.cells.get(at(b, w));
    return v == null ? null : SCALE * v;
  }
  const k = Math.floor(b / 6), j = b % 6;
  const lo = table.cells.get(at(6 * k, w));
  const hi = j === 0 ? lo : table.cells.get(at(6 * (k + 1), w));
  if (lo == null || hi == null) return null;
  return (6 - j) * lo + j * hi;
}

/**
 * The interruptions an innings had, as losses (§3.2): each stop, closed by a
 * resumption (its allotment then) or a termination (b_resume 0), and each cut
 * of the allotment made with no stop open, at its position.
 *
 *   open stop   ignored, unless `resumeOvers` says where it would resume, or
 *               `terminate` says it ends here
 *
 * @param {DlsTable} table
 * @param {any} inn  a folded innings (replay.mjs): startOvers, overs, interruptions, overCuts
 * @param {{resumeOvers?: number | null, terminate?: boolean}} [o]
 * @returns {{available: number, losses: number[], terminated: boolean, interrupted: boolean} | null}
 */
export function inningsResources(table, inn, { resumeOvers = null, terminate = false } = {}) {
  const N = (inn?.startOvers ?? inn?.overs ?? 0) * 6;
  const full = resourcesOf(table, N, 0);
  if (full == null || N <= 0) return null;
  /** @type {{balls: number, wickets: number, from: number, to: number | null}[]} */
  const cuts = [];
  for (const x of inn.interruptions ?? []) {
    const to = x.oversAtResume === undefined ? (terminate ? null : resumeOvers) : x.oversAtResume;
    if (to === undefined || (to == null && x.oversAtResume === undefined && !terminate)) continue;
    cuts.push({ balls: x.balls, wickets: x.wickets, from: x.oversAtStop, to });
  }
  for (const c of inn.overCuts ?? []) cuts.push({ balls: c.balls, wickets: c.wickets, from: c.from, to: c.to });
  /** @type {number[]} */
  const losses = [];
  let terminated = false;
  for (const c of cuts) {
    const before = resourcesOf(table, Math.max(0, c.from * 6 - c.balls), c.wickets);
    const after = c.to == null ? 0 : resourcesOf(table, Math.max(0, c.to * 6 - c.balls), c.wickets);
    if (before == null || after == null) return null;
    if (c.to == null) terminated = true;
    losses.push(before - after);
  }
  return { available: full - losses.reduce((n, l) => n + l, 0), losses, terminated, interrupted: cuts.length > 0 };
}

/**
 * Par from the first innings' total and the two sides' resources (§3.3).
 * `g50` in runs, a whole number, or null: the third line then answers no_g50.
 * @param {number} S  @param {number} R1  @param {number} R2  @param {number | null | undefined} g50
 * @returns {{status: string, par: number | null, line: "scaled" | "equal" | "g50"}}
 */
export function parFrom(S, R1, R2, g50) {
  if (R1 <= 0) return { status: DLS_STATUS.NOT_APPLICABLE, par: null, line: "scaled" };
  if (R2 < R1) return { status: DLS_STATUS.OK, par: Math.floor((S * R2) / R1), line: "scaled" };
  if (R2 === R1) return { status: DLS_STATUS.OK, par: S, line: "equal" };
  if (!Number.isInteger(g50) || /** @type {number} */ (g50) <= 0) return { status: DLS_STATUS.NO_G50, par: null, line: "g50" };
  return { status: DLS_STATUS.OK, par: S + Math.floor((/** @type {number} */ (g50) * (R2 - R1)) / (FULL_TENTHS * SCALE)), line: "g50" };
}

/**
 * @typedef {object} DlsResult
 * @property {string} status          one of DLS_STATUS
 * @property {"target" | "par"} kind  a target for a chase in play or to start; a par at a termination
 * @property {number | null} target
 * @property {number | null} par
 * @property {string | null} case     "1"…"6", or "n" for more than one interruption (§3.3's table)
 * @property {"scaled" | "equal" | "g50" | null} line
 * @property {boolean} interpolated   an over-grain table, read within an over
 * @property {string | null} tableId
 * @property {number | null} tableVersion
 * @property {{first: number, second: number} | null} resources  R₁ and R₂, tenths × SCALE
 */

/** @param {Partial<DlsResult>} o @returns {DlsResult} */
const answer = (o) => ({ status: DLS_STATUS.NOT_APPLICABLE, kind: "target", target: null, par: null, case: null, line: null,
                         interpolated: false, tableId: null, tableVersion: null, resources: null, ...o });

/**
 * The DLS target (or, at a termination, the par) for a one-innings-a-side
 * match's chase (§3.3), from the fold.
 *
 *   innings      the match's innings (deriveMatch().innings): the first, and
 *                the chase if it has begun
 *   chaseOvers   for a chase not begun: the allotment it would start with
 *   resumeOvers  the chase (or, before it, the first innings) stopped: the
 *                allotment it would resume with — the Resume sheet's proposal
 *   terminate    the chase stopped: end it here — the par the end sheet proposes
 *   conditions   the frozen play part: limited overs, one innings a side
 *
 * @param {any[]} innings
 * @param {{table?: DlsTable | null, g50?: number | null, conditions?: Record<string, unknown> | null,
 *          chaseOvers?: number | null, resumeOvers?: number | null, terminate?: boolean}} [o]
 * @returns {DlsResult}
 */
export function dlsTarget(innings, { table = null, g50 = null, conditions = null, chaseOvers = null, resumeOvers = null, terminate = false } = {}) {
  const c = conditions ?? {};
  if (c["format.innings_per_side"] === 2 || (c["format.kind"] != null && c["format.kind"] !== "limited")) {
    return answer({ status: DLS_STATUS.NOT_LIMITED });
  }
  const meta = { tableId: table?.id ?? null, tableVersion: table?.version ?? null, interpolated: table?.grain === "over" };
  if (!table) return answer({ status: DLS_STATUS.NO_TABLE });
  const [a, b] = (innings ?? []).filter((x) => x != null);
  if (!a) return answer(meta);
  const chasing = b != null;
  // The first innings: complete, or stopped with the umpires' resumption to come.
  const r1 = inningsResources(table, a, chasing ? {} : { resumeOvers });
  if (!r1) return answer(meta);
  let r2;
  if (chasing) r2 = inningsResources(table, b, { resumeOvers, terminate });
  else {
    const n2 = chaseOvers ?? a.startOvers ?? a.overs;
    const full = resourcesOf(table, (n2 ?? 0) * 6, 0);
    r2 = full == null || !n2 ? null : { available: full, losses: [], terminated: false, interrupted: false };
  }
  if (!r2) return answer(meta);
  const p = parFrom(a.runs, r1.available, r2.available, g50);
  const kind = r2.terminated ? "par" : "target";
  const stops = r1.losses.length + r2.losses.length;
  const N1 = (a.startOvers ?? a.overs) * 6, N2 = chasing ? (b.startOvers ?? b.overs) * 6 : (chaseOvers ?? a.startOvers ?? a.overs) * 6;
  const kase = stops > 1 ? "n" : r2.terminated ? "6" : r2.interrupted ? "5" : r1.terminated ? "3" : r1.interrupted ? "2" : N2 < N1 ? "4" : "1";
  return answer({ ...meta, status: p.status, kind, par: p.par, target: p.par == null ? null : p.par + 1, case: kase, line: p.line,
                  resources: { first: r1.available, second: r2.available } });
}

/**
 * Par at a point in the chase (§3.3): the target the chase would have if it
 * ended here, less one — for "ahead of par by 3". `position` defaults to
 * where the chase now stands.
 * @param {any[]} innings
 * @param {{table?: DlsTable | null, g50?: number | null, conditions?: Record<string, unknown> | null}} [o]
 * @returns {DlsResult}
 */
export function dlsParAt(innings, o = {}) {
  const [a, b] = (innings ?? []).filter((x) => x != null);
  if (!a || !b || !o.table) return dlsTarget(innings, o);
  const r2 = inningsResources(o.table, b, {});
  const now = resourcesOf(o.table, Math.max(0, (b.overs ?? 0) * 6 - b.balls), b.wickets);
  if (!r2 || now == null) return answer({ tableId: o.table.id ?? null, tableVersion: o.table.version ?? null });
  const r1 = inningsResources(o.table, a, {});
  if (!r1) return answer({});
  const p = parFrom(a.runs, r1.available, r2.available - now, o.g50);
  return answer({ status: p.status, kind: "par", par: p.par, target: p.par == null ? null : p.par + 1, case: "par_at",
                  line: p.line, tableId: o.table.id ?? null, tableVersion: o.table.version ?? null,
                  interpolated: o.table.grain === "over", resources: { first: r1.available, second: r2.available - now } });
}

/**
 * The calculator's words beside a figure (§1, §3.4, §4.5).
 * @param {DlsResult | null | undefined} r
 * @param {{current?: boolean, withdrawn?: boolean}} [o]  the table is the current one because the
 *   match's document names none; the table has since been withdrawn
 * @returns {string | null}
 */
export function dlsWords(r, { current = false, withdrawn = false } = {}) {
  if (!r) return null;
  switch (r.status) {
    case DLS_STATUS.NO_TABLE: return "No DLS table loaded; enter the umpires' figures";
    case DLS_STATUS.NO_G50: return "G50 not set for this competition: enter the umpires' target";
    case DLS_STATUS.NOT_LIMITED: return "The DLS method is for limited-overs matches";
    case DLS_STATUS.OK: {
      const notes = [`DLS Standard, table v${r.tableVersion ?? "?"}`];
      if (r.line === "g50") notes.push("G50 from the league's conditions");
      if (r.interpolated) notes.push("interpolated within the over");
      if (current) notes.push("the current table: this match's conditions name none");
      if (withdrawn) notes.push("table since withdrawn");
      return r.kind === "par" ? `SCRBRD calculates a par of ${r.par} (${notes.join(", ")})` : `SCRBRD calculates ${r.target} (${notes.join(", ")})`;
    }
    default: return null;
  }
}

/**
 * The umpires' figure beside the calculated one (§3.6): "umpires 134 ·
 * calculated 133" when they differ, and only the announced figure when they
 * agree. A difference is information, never a flag.
 * @param {number | null | undefined} announced  @param {number | null | undefined} calculated
 */
export function differenceWords(announced, calculated) {
  if (announced == null) return null;
  if (calculated == null || calculated === announced) return `umpires ${announced}`;
  return `umpires ${announced} · calculated ${calculated}`;
}
