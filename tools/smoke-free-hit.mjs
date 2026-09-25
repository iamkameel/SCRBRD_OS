#!/usr/bin/env node
/**
 * A wicket the free hit saved: the fold and every SQL reader agree (db/42).
 *
 * The fold saves a batter dismissed off a free hit by any method that is the
 * bowler's (`standsOnFreeHit`, events.mjs), and marks the ball `freeHitSaved`.
 * Until db/42 every SQL reader of ball_event counted that ball as a wicket —
 * the live score, the handover check, a batter's dismissals and innings, a
 * bowler's figures, hat-trick and breakdown, the matchups read and the
 * opposition's figures. db/42 asks ball_wicket_stands() in all of them.
 *
 * This is the property that change has to keep: for EVERY log, the fold's
 * wickets per innings, per bowler and per batter are the SQL's. It generates
 * innings in the style of the phases invariant (packages/scoring/test/
 * phases.test.mjs, group L) — a small deterministic LCG, so a failure
 * reproduces — biased hard towards what the rule is about: no-balls, a W ball
 * straight after one, wides carrying the free hit, voids of the no-ball and of
 * the wicket, retirements between the two, every one of the eleven methods,
 * and run outs at either end. A dozen hand-written innings beside them pin
 * the edges by name, so a generator that drifted away from one would not
 * quietly stop testing it.
 *
 * The rows go into ball_event as toRow() writes them, one generated innings
 * per innings number of one fixture, as the migration owner (the way
 * smoke-dismissals and smoke-opposition write synthetic deliveries). The fold
 * is then run over the rows READ BACK — fromRow(), MatchFold, exactly what the
 * server does — so both sides judge the same log, voids and all.
 *
 * Compared, for every generated innings and every player:
 *   match_live_score           runs, wickets, legal balls per innings
 *   bowler_innings_figures     wickets per bowler per innings
 *   bowler_hat_trick           the ball that completes it, per bowler per innings
 *   player_innings.out         per batter per innings
 *   player_dismissals_since    per batter          (career, as deltas)
 *   player_dismissal_breakdown per batter per method
 *   player_bowling_since       wickets per bowler
 *   player_wicket_breakdown    per bowler per method
 *   opposition_squad()         their dismissals and wickets, both ways round
 *   scoring_verify_takeover()  the wickets it expects of an incoming device
 *   /api/read/matchups         dismissals per batter per bowler, as a coach
 *   milestone_watch()          a saved ball announces no career wickets
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-free-hit.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import {
  MatchFold, deriveInnings, toRow, fromRow, isLegal, normaliseDismissal, chargedToBowler, standsOnFreeHit,
} from "@scrbrd/scoring";

const PORT = 8871;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
// A complete fixture with a toss and no seeded deliveries. Nothing else in
// this walk's reset writes to it.
const MATCH = "77777777-0000-0000-0000-000000000001";
const HIL_1XI = ["01", "02", "03", "04", "05"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const WES_1XI = ["bbbbbbbb-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002"];
const OTHERS = ["06", "11", "12", "13"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const PLAYERS = [...HIL_1XI, ...WES_1XI, ...OTHERS];   // eleven, so ten wickets can fall

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

// ── The logs ─────────────────────────────────────────────────────
// Deterministic, so a failure reproduces: a small LCG, not Math.random.
let s = 42;
const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
/** @template T @param {T[]} xs @returns {T} */
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
/** @template T @param {T[]} xs */
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Every canonical method a W ball can carry — the six that stand on a free
// hit among them (a W ball naming timed_out is the pad's shape before
// SCRBRD-081). No NULL: the API refuses a wicket with no method.
const MODES = ["bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket", "handled_ball",
               "obstructing_field", "timed_out", "retired_out", "hit_twice"];

let eventNo = 0;
/** One innings under construction, and the moves a scorer makes in it. */
function builder(no, overs) {
  /** @type {any[]} */
  const ev = [];
  const batting = shuffle(PLAYERS);
  const bowling = shuffle(PLAYERS).slice(0, 3);
  let next = 2, overIdx = 0;
  /** @param {any} e */
  const push = (e) => { const x = { id: `fh-${++eventNo}`, innings: no, ...e }; ev.push(x); return x; };
  const now = () => deriveInnings(ev);
  push({ kind: "innings_start", overs, squad: [], bowlingSquad: [] });
  push({ kind: "batters", striker: batting[0], nonStriker: batting[1] });
  const b = {
    ev, now,
    /** A delivery, stamped with who was on strike and bowling, as the pad stamps it. */
    deliver(/** @type {any} */ e) {
      const st = now();
      if (st.bowler == null) {
        push({ kind: "bowler", bowler: bowling[overIdx++ % 2 === 0 ? 0 : (rnd() < 0.3 ? 2 : 1)] });
      }
      const at = now();
      return push({ kind: "ball", striker: at.striker, nonStriker: at.nonStriker, bowler: at.bowler, ...e });
    },
    /** A W ball; `ns` dismisses the non-striker (a run out at his end). */
    wicket(/** @type {string} */ mode, ns = false) {
      const at = now();
      return b.deliver({ type: "W", value: 0, dismissal: mode,
                         ...(ns && at.nonStriker ? { dismissed: at.nonStriker } : {}) });
    },
    /** Send the next batter in at whichever end is empty, if one is. */
    fill() {
      const at = now();
      if (at.wickets >= 10 || next >= batting.length) return;
      if (at.striker == null) push({ kind: "batters", striker: batting[next++] });
      else if (at.nonStriker == null) push({ kind: "batters", nonStriker: batting[next++] });
    },
    undo() { const last = ev[ev.length - 1]; push({ kind: "void", target: last.id }); },
    retireOut() {
      const at = now();
      if (at.striker == null || at.nonStriker == null) return;
      push({ kind: "retire", batter: pick([at.striker, at.nonStriker]), reason: "out", type: "W", dismissal: "retired_out" });
      b.fill();
    },
    timedOut() {
      if (next >= batting.length - 1 || now().wickets >= 9) return;
      push({ kind: "retire", batter: batting[next++], reason: "timed_out", type: "W", dismissal: "timed_out" });
    },
  };
  return b;
}

/** A generated innings — the phases invariant's shape, tilted at the free hit. */
function generated(no, overs) {
  const b = builder(no, overs);
  let guard = 0;
  while (guard++ < 2000) {
    const st = b.now();
    if (st.balls >= overs * 6 || st.wickets >= 10) break;
    if (st.striker == null || st.nonStriker == null) { b.fill(); continue; }
    const r = rnd();
    if (st.freeHit && rnd() < 0.5) {
      // The case the rule is about: a dismissal on the free hit.
      const mode = pick(MODES);
      b.wicket(mode, mode === "run_out" && rnd() < 0.5);
      const after = b.now();
      if (rnd() < 0.12) b.undo();                // the wicket taken back
      else if (after.wickets > st.wickets) { if (rnd() < 0.1) b.timedOut(); b.fill(); }
    } else if (r < 0.10) {
      b.deliver({ type: "Nb", value: pick([0, 0, 1, 4, 6]), ...(rnd() < 0.2 ? { nbRuns: pick(["byes", "leg_byes"]) } : {}) });
      if (rnd() < 0.12) b.undo();                // the no-ball taken back: no free hit
    } else if (r < 0.16) b.deliver({ type: "Wd", value: pick([0, 0, 1, 4]) });
    else if (r < 0.20) b.deliver({ type: pick(["B", "LB"]), value: pick([1, 2, 4]) });
    else if (r < 0.27) {
      const mode = pick(MODES);
      b.wicket(mode, mode === "run_out" && rnd() < 0.5);
      if (b.now().wickets > st.wickets) b.fill();
    } else if (r < 0.28) b.retireOut();
    else {
      b.deliver({ type: "run", value: pick([0, 0, 0, 1, 1, 1, 2, 3, 4, 6]) });
      if (rnd() < 0.02) b.undo();
    }
  }
  return b.ev;
}

/**
 * A hand-written innings. Steps: "Nb", "Wd", "B", "run", "void" (the last
 * event), "retireW" (retired out, between balls), "W:<method>" and
 * "W:<method>:ns" (the non-striker). A batter comes in after a wicket that
 * stood unless the next step takes it back.
 */
function scripted(no, /** @type {string[]} */ steps) {
  const b = builder(no, 20);
  steps.forEach((step, i) => {
    const [kind, mode, end] = step.split(":");
    const before = b.now().wickets;
    if (kind === "Nb") b.deliver({ type: "Nb", value: 0 });
    else if (kind === "Wd") b.deliver({ type: "Wd", value: 0 });
    else if (kind === "B") b.deliver({ type: "B", value: 1 });
    else if (kind === "run") b.deliver({ type: "run", value: 0 });
    else if (kind === "void") b.undo();
    else if (kind === "retireW") b.retireOut();
    else if (kind === "W") b.wicket(mode, end === "ns");
    if (b.now().wickets > before && steps[i + 1] !== "void") b.fill();
  });
  return b.ev;
}

// Named edges: [steps, wickets the fold must count, what it proves].
const EDGES = [
  [["Nb", "W:bowled"],                          0, "a bowler's dismissal off a free hit is saved"],
  [["Nb", "Wd", "Wd", "W:caught"],              0, "wides carry the free hit forward"],
  [["Nb", "W:run_out"],                         1, "a run out stands on a free hit"],
  [["Nb", "W:run_out:ns"],                      1, "...at the non-striker's end too"],
  [["Nb", "W:handled_ball"],                    1, "handled the ball stands"],
  [["Nb", "W:obstructing_field"],               1, "obstructing the field stands"],
  [["Nb", "W:hit_twice"],                       1, "hit the ball twice stands"],
  [["Nb", "B", "W:lbw"],                        1, "a legal ball (a bye) consumes the free hit"],
  [["Nb", "void", "W:stumped"],                 1, "a no-ball taken back earns no free hit"],
  [["Nb", "Nb", "W:hit_wicket"],                0, "a second no-ball earns a new free hit"],
  [["Nb", "retireW", "W:bowled"],               1, "a retirement is not a ball: the free hit waits (1 = the retirement)"],
  [["Nb", "W:bowled", "void", "W:caught"],      0, "a saved ball taken back consumes nothing"],
  [["W:bowled", "W:caught", "W:lbw"],           3, "a hat-trick"],
  [["W:bowled", "W:caught", "Nb", "W:lbw"],     2, "a saved ball breaks a hat-trick"],
  [["run", "Nb"],                               0, "an innings that ends on a no-ball..."],
  [["W:bowled"],                                1, "...gives the next innings no free hit"],
];

// ── Expectations, from the fold ──────────────────────────────────
/** @param {Map<string, number>} m @param {string} k @param {number} [by] */
const bump = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/**
 * What each SQL reader must say, taken from the fold's own decisions. For a
 * W ball the fold decides whether it stood (freeHitSaved) and whose it was;
 * each map below then applies the SQL reader's OWN grouping to that decision
 * (who is the subject, whose wicket), so the only rule under test is the
 * free hit.
 * @param {Map<number, any>} byInnings innings number → folded innings
 */
function expected(byInnings) {
  const e = {
    /** @type {Map<string, number>} */ dismissals: new Map(),     // player
    /** @type {Map<string, number>} */ dismissalBy: new Map(),    // player|method
    /** @type {Map<string, number>} */ wickets: new Map(),        // bowler
    /** @type {Map<string, number>} */ wicketBy: new Map(),       // bowler|method
    /** @type {Map<string, number>} */ matchups: new Map(),       // batter|bowler
    /** @type {Map<string, number>} */ oppDismissals: new Map(),  // player (bowler's method, himself out)
    /** @type {Set<string>} */ outIn: new Set(),                  // player|innings, player_innings.out
    /** @type {Map<string, number>} */ hatTrick: new Map(),       // bowler|innings → seq
    saved: 0, savedAfterWide: 0, standingOnFreeHit: 0, hatTricks: 0, voids: 0, totalWickets: 0,
  };
  for (const [no, inn] of byInnings) {
    e.totalWickets += inn.wickets;
    e.voids += inn.voided;
    /** @type {Map<string, boolean[]>} */ const legalW = new Map();
    /** @type {Map<string, number[]>} */ const legalSeq = new Map();
    let prevType = null, onFreeHit = false;
    for (const ball of inn.ballLog) {
      const type = ball.type ?? "run";
      const mode = normaliseDismissal(ball.dismissal);
      const stood = type === "W" && !ball.freeHitSaved;
      if (type === "W" && ball.freeHitSaved) { e.saved++; if (prevType === "Wd") e.savedAfterWide++; }
      if (stood) {
        const out = ball.dismissed ?? ball.strikerId;
        bump(e.dismissals, out); bump(e.dismissalBy, `${out}|${mode}`);
        // Out on his own innings row, at either end (db/43): a run out at the
        // non-striker's end is his, not nobody's.
        e.outIn.add(`${out}|${no}`);
        if (onFreeHit && standsOnFreeHit(mode)) e.standingOnFreeHit++;
        if (chargedToBowler(mode) && ball.bowlerId) {
          bump(e.wickets, ball.bowlerId); bump(e.wicketBy, `${ball.bowlerId}|${mode}`);
          if (out === ball.strikerId) { bump(e.matchups, `${ball.strikerId}|${ball.bowlerId}`); bump(e.oppDismissals, out); }
        }
      }
      if (isLegal(type) && ball.bowlerId) {
        const k = ball.bowlerId;
        legalW.set(k, [...(legalW.get(k) ?? []), stood && chargedToBowler(mode)]);
        legalSeq.set(k, [...(legalSeq.get(k) ?? []), ball.seq]);
      }
      prevType = type;
      // Tracked here only to say the logs hold the case; the rule under test
      // is the fold's own `freeHitSaved`.
      onFreeHit = type === "Nb" ? true : (isLegal(type) ? false : onFreeHit);
    }
    for (const w of inn.nonBallWickets) {
      bump(e.dismissals, w.batter); bump(e.dismissalBy, `${w.batter}|${w.dismissal}`);
      e.outIn.add(`${w.batter}|${no}`);
    }
    for (const [k, ws] of legalW) {
      const seqs = /** @type {number[]} */ (legalSeq.get(k));
      for (let i = 2; i < ws.length; i++) {
        if (ws[i] && ws[i - 1] && ws[i - 2]) {
          const key = `${k}|${no}`;
          if (!e.hatTrick.has(key)) { e.hatTrick.set(key, seqs[i]); e.hatTricks++; }
        }
      }
    }
  }
  return e;
}

// ── What SQL says ────────────────────────────────────────────────
async function career() {
  const players = PLAYERS;
  /** @type {Map<string, number>} */ const dismissals = new Map();
  /** @type {Map<string, number>} */ const wickets = new Map();
  for (const p of players) {
    dismissals.set(p, Number((await q(`select coalesce(player_dismissals_since($1, null), 0) n`, [p]))[0].n));
    wickets.set(p, Number((await q(`select coalesce((select wickets from player_bowling_since($1, null)), 0) n`, [p]))[0].n));
  }
  const dismissalBy = new Map((await q(
    `select player_id || '|' || coalesce(dismissal, 'null') k, dismissals n from player_dismissal_breakdown where player_id = any($1)`,
    [players])).map((r) => [r.k, Number(r.n)]));
  const wicketBy = new Map((await q(
    `select player_id || '|' || coalesce(dismissal, 'null') k, wickets n from player_wicket_breakdown where player_id = any($1)`,
    [players])).map((r) => [r.k, Number(r.n)]));
  return { dismissals, wickets, dismissalBy, wicketBy };
}

/** opposition_squad() for a fixture against the other school, a day inside the window (db/46), as a coach of this one. */
async function opposition(home, away, coachEmail) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const m = (await c.query(
      `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
       values ($1,'1XI',$2,'1XI','the other side', now() + make_interval(days => opposition_window_days() - 1), 'cricket','T20',20,'scheduled') returning id`,
      [home, away])).rows[0].id;
    await c.query(`update feature_flag set enabled = true, locked = false where key = 'opposition'`);
    await c.query(`delete from feature_suppression where key = 'opposition'`);
    await c.query(`delete from feature_grant where key = 'opposition'`);
    const who = (await c.query(`select id from app_user where email = $1`, [coachEmail])).rows[0].id;
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [who]);
    const rows = (await c.query(`select player_id, dismissals, wickets from opposition_squad($1)`, [m])).rows;
    return new Map(rows.map((r) => [r.player_id, { dismissals: Number(r.dismissals), wickets: Number(r.wickets) }]));
  } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
}

/** What scoring_verify_takeover() expects of an incoming device for MATCH. */
async function verifyExpects() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const scorer = (await c.query(`select id from app_user where email = 'scorer@example.invalid'`)).rows[0].id;
    await c.query(`update match set status = 'live' where id = $1`, [MATCH]);
    await c.query(`delete from scoring_session where match_id = $1`, [MATCH]);
    await c.query(`insert into scoring_session (match_id, school_id, state, epoch, holder_user_id, holder_device,
                                                claimant_user_id, claimant_device)
                   values ($1, $2, 'verifying', 1, $3, 'fh-out', $3, 'fh-in')`, [MATCH, HIL, scorer]);
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [scorer]);
    const r = (await c.query(`select ok, reason, exp_runs, exp_wkts, exp_balls from scoring_verify_takeover($1, 'fh-in', -1, -1, -1)`, [MATCH])).rows[0];
    return r;
  } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
}

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-free-hit-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
async function matchups(token) {
  const rows = (await api(`/api/read/matchups`, { token })).body?.rows ?? [];
  return new Map(rows.map((r) => [`${r.batter_id}|${r.bowler_id}`, Number(r.dismissals)]));
}

/** @param {Map<string, number>} a @param {Map<string, number>} b */
const delta = (a, b) => { const d = new Map(); for (const k of new Set([...a.keys(), ...b.keys()])) { const v = (b.get(k) ?? 0) - (a.get(k) ?? 0); if (v) d.set(k, v); } return d; };
/** @param {Map<string, number>} want @param {Map<string, number>} got */
const differences = (want, got) => [...new Set([...want.keys(), ...got.keys()])]
  .filter((k) => (want.get(k) ?? 0) !== (got.get(k) ?? 0))
  .map((k) => `${k}: fold ${want.get(k) ?? 0}, SQL ${got.get(k) ?? 0}`);

try {
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const h = await api("/api/health"); if (h.body?.db === "ok") { up = true; break; } } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the API comes up", up, serverErr.join("").split("\n").slice(0, 3).join(" "));
  const coach = up ? (await api("/api/auth/dev-login", { method: "POST",
    body: { email: "coach@example.invalid", deviceId: "device-free-hit" } })).body?.token : null;

  const existing = Number((await q(`select count(*) n from ball_event where match_id = $1`, [MATCH]))[0].n);
  ok("the fixture this walk scores has no deliveries yet", existing === 0, `${existing}`);

  // ── Before ──
  const car0 = await career();
  const oppH0 = await opposition(HIL, WES, "coach@example.invalid");
  const oppW0 = await opposition(WES, HIL, "coach.wes@example.invalid");
  const ver0 = await verifyExpects();
  const mu0 = coach ? await matchups(coach) : new Map();

  // ── The logs, written ──
  /** @type {any[][]} */
  const logs = [];
  let no = 0;
  const edgeInnings = [];
  for (const [steps, want, what] of EDGES) { no++; edgeInnings.push({ no, want, what }); logs.push(scripted(no, /** @type {string[]} */ (steps))); }
  for (const overs of [20, 8, 15, 5, 20, 12, 3, 10, 20, 6, 4, 20]) {
    for (let rep = 0; rep < 4; rep++) { no++; logs.push(generated(no, overs)); }
  }
  const scorer = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  let seq = 0;
  for (const log of logs) {
    const cols = ["match_id", "school_id", "seq", "epoch", "innings", "scorer_user_id", "device_id", "idempotency_key",
                  "client_seq", "client_ts", "kind", "ball_type", "value", "striker_id", "non_striker_id", "bowler_id",
                  "dismissed_id", "dismissal", "payload"];
    const values = [];
    const params = [];
    for (const ev of log) {
      const r = toRow(ev);
      seq++;
      const row = [MATCH, HIL, seq, 1, r.innings, scorer, "device-free-hit", ev.id, seq, r.client_ts, r.kind,
                   r.ball_type, r.value, r.striker_id, r.non_striker_id, r.bowler_id, r.dismissed_id,
                   r.dismissal ?? null, JSON.stringify(r.payload)];
      values.push(`(${row.map((_, i) => `$${params.length + i + 1}`).join(",")})`);
      params.push(...row);
    }
    await q(`insert into ball_event (${cols.join(",")}) values ${values.join(",")}`, params);
  }

  // ── The fold, over the rows as the database holds them ──
  const rows = await q(`select * from ball_event where match_id = $1 order by seq`, [MATCH]);
  const fold = new MatchFold(rows.map(fromRow));
  /** @type {Map<number, any>} */
  const byInnings = new Map([...fold.byInnings].map(([k, b]) => [k, b.inn]));
  const e = expected(byInnings);

  group(`The fold, over ${logs.length} innings (${EDGES.length} written by hand) and ${rows.length} events`);
  // The fold's own totals are the sum of the decisions the maps above read.
  const inningsWickets = [...byInnings.values()].reduce((a, i) => a + i.wickets, 0);
  const counted = [...e.dismissals.values()].reduce((a, n) => a + n, 0);
  ok("every wicket the fold counts is one the expectations count", inningsWickets === counted, `${inningsWickets} vs ${counted}`);
  const bowlerWickets = [...byInnings.values()].flatMap((i) => i.bowlers).reduce((a, b) => a + b.wickets, 0);
  ok("...and every bowler's wicket", bowlerWickets === [...e.wickets.values()].reduce((a, n) => a + n, 0));
  for (const { no: n, want, what } of edgeInnings) {
    ok(`edge — ${what}: the fold counts ${want}`, byInnings.get(n)?.wickets === want, `${byInnings.get(n)?.wickets}`);
  }
  // Not vacuous: the logs hold the cases the rule exists for.
  ok(`...wickets the free hit saved (${e.saved})`, e.saved >= 40);
  ok(`...saved after a wide carried the free hit (${e.savedAfterWide})`, e.savedAfterWide > 0);
  ok(`...dismissals that stood on a free hit (${e.standingOnFreeHit})`, e.standingOnFreeHit > 0);
  ok(`...voids (${e.voids})`, e.voids >= 10);
  ok(`...hat-tricks (${e.hatTricks})`, e.hatTricks >= 1);
  console.log(`  ${e.totalWickets} wickets; ${e.saved} saved by the free hit (${e.savedAfterWide} after a wide), ` +
              `${e.standingOnFreeHit} stood on one, ${e.voids} voids, ${e.hatTricks} hat-tricks`);

  group("Per innings: match_live_score is the fold");
  const live = new Map((await q(`select innings, runs, wickets, legal_balls from match_live_score where match_id = $1`, [MATCH]))
    .map((r) => [Number(r.innings), r]));
  const liveBad = [...byInnings].filter(([n, inn]) => {
    const r = live.get(n);
    return !r || Number(r.runs) !== inn.runs || Number(r.wickets) !== inn.wickets || Number(r.legal_balls) !== inn.balls;
  }).map(([n, inn]) => `innings ${n}: fold ${inn.runs}/${inn.wickets} off ${inn.balls}, SQL ${JSON.stringify(live.get(n))}`);
  ok(`runs, wickets and balls agree in every innings (${byInnings.size})`, liveBad.length === 0, liveBad.slice(0, 5).join("; "));

  group("Per bowler per innings: bowler_innings_figures and bowler_hat_trick are the fold");
  const figs = new Map((await q(`select player_id, innings, wickets from bowler_innings_figures where match_id = $1`, [MATCH]))
    .map((r) => [`${r.player_id}|${r.innings}`, Number(r.wickets)]));
  const foldFigs = new Map([...byInnings].flatMap(([n, inn]) => inn.bowlers.map((b) => [`${b.id}|${n}`, b.wickets])));
  const figBad = differences(foldFigs, figs);
  ok(`every bowler's wickets in every innings agree (${foldFigs.size} spells)`, figBad.length === 0, figBad.slice(0, 5).join("; "));
  const hats = new Map((await q(`select player_id, innings, completed_at_seq from bowler_hat_trick where match_id = $1`, [MATCH]))
    .map((r) => [`${r.player_id}|${r.innings}`, Number(r.completed_at_seq)]));
  const hatBad = differences(e.hatTrick, hats);
  ok(`every hat-trick, and the ball that completed it (${e.hatTrick.size})`, hatBad.length === 0, hatBad.slice(0, 5).join("; "));

  group("Per batter per innings: player_innings.out");
  const outs = new Set((await q(`select player_id, innings from player_innings where match_id = $1 and out`, [MATCH]))
    .map((r) => `${r.player_id}|${r.innings}`));
  const outBad = [...new Set([...outs, ...e.outIn])].filter((k) => outs.has(k) !== e.outIn.has(k));
  ok(`every innings' out agrees (${e.outIn.size} outs)`, outBad.length === 0, outBad.slice(0, 5).join("; "));

  group("A career: what moved is what the fold took");
  const car1 = await career();
  const dBad = differences(e.dismissals, delta(car0.dismissals, car1.dismissals));
  ok("player_dismissals_since, per batter", dBad.length === 0, dBad.slice(0, 5).join("; "));
  const dmBad = differences(e.dismissalBy, delta(car0.dismissalBy, car1.dismissalBy));
  ok("player_dismissal_breakdown, per batter per method", dmBad.length === 0, dmBad.slice(0, 5).join("; "));
  const wBad = differences(e.wickets, delta(car0.wickets, car1.wickets));
  ok("player_bowling_since wickets, per bowler", wBad.length === 0, wBad.slice(0, 5).join("; "));
  const wmBad = differences(e.wicketBy, delta(car0.wicketBy, car1.wicketBy));
  ok("player_wicket_breakdown, per bowler per method", wmBad.length === 0, wmBad.slice(0, 5).join("; "));

  group("The opposition's figures, both ways round");
  const oppH1 = await opposition(HIL, WES, "coach@example.invalid");
  const oppW1 = await opposition(WES, HIL, "coach.wes@example.invalid");
  for (const [label, before, after, squad] of [["Westville's, read by Hilton", oppH0, oppH1, WES_1XI],
                                               ["Hilton's, read by Westville", oppW0, oppW1, HIL_1XI]]) {
    ok(`${label}: the squad is read at all`, squad.every((p) => after.has(p)), [...after.keys()].join(","));
    const got = (/** @type {"dismissals" | "wickets"} */ k) => new Map(squad.map((p) => [p, (after.get(p)?.[k] ?? 0) - (before.get(p)?.[k] ?? 0)]));
    const want = (/** @type {Map<string, number>} */ m) => new Map(squad.map((p) => [p, m.get(p) ?? 0]));
    const dB = differences(want(e.oppDismissals), got("dismissals"));
    ok(`${label}: dismissals`, dB.length === 0, dB.join("; "));
    const wB = differences(want(e.wickets), got("wickets"));
    ok(`${label}: wickets`, wB.length === 0, wB.join("; "));
  }

  group("The handover check");
  const ver1 = await verifyExpects();
  ok("scoring_verify_takeover answers the probe", ver0?.reason === "verify_mismatch" && ver1?.reason === "verify_mismatch",
     `${ver0?.reason} / ${ver1?.reason}`);
  // The check verifies the innings being played, as the fold totals it
  // (SCRBRD-088, db/45) — not the match: the incoming scorer reads it off the
  // scoreboard. Every innings is held to the fold through the helper the
  // check counts with, so the rules the probe proved over the whole log are
  // still proved over the whole log, innings by innings.
  const cur = Math.max(...byInnings.keys());
  const now = byInnings.get(cur);
  ok(`it expects the innings being played (innings ${cur}): the fold's ${now.runs}/${now.wickets} off ${now.balls}`,
     ver1.exp_runs === now.runs && ver1.exp_wkts === now.wickets && ver1.exp_balls === now.balls,
     `SQL ${ver1.exp_runs}/${ver1.exp_wkts} off ${ver1.exp_balls}`);
  const perInnings = new Map((await q(`select i.n, f.runs, f.wickets, f.legal_balls
                                      from (select distinct innings as n from ball_event where match_id = $1) i,
                                           innings_score_as_folded($1, i.n) f`, [MATCH]))
    .map((r) => [Number(r.n), r]));
  const countBad = [...byInnings].filter(([n, inn]) => {
    const r = perInnings.get(n);
    return !r || Number(r.runs) !== inn.runs || Number(r.wickets) !== inn.wickets || Number(r.legal_balls) !== inn.balls;
  }).map(([n, inn]) => `innings ${n}: fold ${inn.runs}/${inn.wickets} off ${inn.balls}, SQL ${JSON.stringify(perInnings.get(n))}`);
  ok(`...and counts every innings as the fold does (${byInnings.size})`, countBad.length === 0, countBad.slice(0, 5).join("; "));

  group("The matchups read, as a coach");
  // The read joins player for both names, under the coach's own policies, so
  // a pair with a Westville boy in it is not his to read: the expectation is
  // the Hilton pairs, and nothing else may appear.
  const mu1 = coach ? await matchups(coach) : new Map();
  const hilton = (/** @type {string} */ k) => k.split("|").every((id) => id.startsWith("aaaaaaaa-"));
  const muWant = new Map([...e.matchups].filter(([k]) => hilton(k)));
  const muBad = differences(muWant, delta(mu0, mu1));
  ok(`dismissals per batter per bowler (${muWant.size} pairs)`, coach != null && muWant.size > 0 && muBad.length === 0,
     muBad.slice(0, 5).join("; "));

  group("The milestone trigger: a saved ball announces nothing");
  // milestone_watch() fires "passes 25 career wickets" when his career total
  // IS 25 after the ball, not when it crosses 25 — so a ball that does not
  // move the total re-announces it, in whichever match it is bowled. Within
  // one match the notice's key absorbs the repeat; the next match's does not.
  // Last, and in innings nobody above reads, so nothing above counts it.
  const M4 = "77777777-0000-0000-0000-000000000004";
  const mile = (await q(`insert into player (school_id, team_code, full_name, born)
                         values ($1, '1XI', 'A Free-Hit Bowler', '2009-03-01') returning id`, [HIL]))[0].id;
  const twentyFive = Array.from({ length: 25 }, (_, i) => i + 1);
  await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                   client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id, dismissal)
           select $1, $2, 5000 + k, 1, 7, $3, 'device-free-hit', 'fh-mile-' || k, 5000 + k, now(), 'ball', 'W', 0, $4, $5, 'bowled'
             from unnest($6::int[]) k`, [M4, HIL, scorer, PLAYERS[0], mile, twentyFive]);
  const notices = async () => Number((await q(
    `select count(*) n from milestone_notice where player_id = $1 and kind = 'career_wickets'`, [mile]))[0].n);
  ok("twenty-five wickets announce his twenty-five, once", await notices() === 1);
  const lastSeq = Number((await q(`select max(seq) n from ball_event where match_id = $1`, [MATCH]))[0].n);
  for (const [k, type, dismissal] of [[1, "Nb", null], [2, "W", "bowled"]]) {
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                     client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id, dismissal)
             values ($1, $2, $3, 1, 99, $4, 'device-free-hit', $5, $3, now(), 'ball', $6, 0, $7, $8, $9)`,
      [MATCH, HIL, lastSeq + k, scorer, `fh-mile-fh-${k}`, type, PLAYERS[0], mile, dismissal]);
  }
  const saved = new MatchFold((await q(`select * from ball_event where match_id = $1 and innings = 99 order by seq`, [MATCH]))
    .map(fromRow)).byInnings.get(99)?.inn;
  ok("the next match's bowled is on a free hit: the fold saves it", saved?.wickets === 0 && saved?.ballLog.at(-1)?.freeHitSaved === true);
  ok("...his career is still twenty-five",
     Number((await q(`select wickets from player_bowling_since($1, null)`, [mile]))[0].wickets) === 25);
  ok("...and nothing announces it again", await notices() === 1, `${await notices()} career-wickets notices`);
} catch (err) {
  ok(`the walk threw: ${err.message?.slice(0, 160)}`, false);
  console.log(err.stack?.split("\n").slice(0, 5).join("\n"));
} finally {
  server.kill("SIGTERM");
  await pool.end();
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nFREE-HIT SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
