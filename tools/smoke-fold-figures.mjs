#!/usr/bin/env node
/**
 * Every figure SQL keeps about a batter and a bowler is the fold's (db/43).
 *
 * db/40 taught the SQL readers whose runs a no-ball's are and that a
 * retirement can be a wicket; db/42 the free hit. This walk holds the rest:
 * for EVERY generated log, what the fold says each player did is what every
 * SQL reader of ball_event says —
 *
 *   match_live_score            runs, wickets, legal balls         per innings
 *   player_innings              runs, balls faced, out     per batter per innings
 *   player_batting_since        matches, runs, balls, fours, sixes    per batter
 *   player_dismissals_since     dismissals                            per batter
 *   player_dismissal_breakdown  dismissals by method                  per batter
 *   player_bowling_since        runs, legal balls, wides, no-balls, wickets
 *   bowler_innings_figures      wickets, runs conceded   per bowler per innings
 *   player_wicket_breakdown     wickets by method                     per bowler
 *   opposition_squad()          every batting and bowling column, both ways round
 *   scoring_verify_takeover()   the runs, wickets and balls it expects
 *   /api/read/matchups          balls, runs, fours, sixes, dots, dismissals, as a coach
 *
 * — career figures as deltas, so whatever the seed holds cannot pass or fail
 * them. The generator (a small LCG, so a failure reproduces) leans on what
 * db/43 closes:
 *
 *   - run outs at the non-striker's end, before and after he has faced a
 *     ball, with runs completed and the end recorded (SCRBRD-069);
 *   - a batter SCRBRD holds no row for — a typed name — at either end, and
 *     run out at the other one (payload.dismissed: nobody here, never the
 *     striker);
 *   - no-balls hit for four and six, their byes and leg byes to the rope,
 *     wides worth four, byes and leg byes worth four, a wicket ball with runs;
 *   - legacy rows, written past db/43's door as a row stored before it
 *     would have been: a ball with no type (a run, to the fold) and a wicket
 *     with no method (a wicket, nobody's — and saved on a free hit);
 *   - free hits, voids, retirements, typed-name bowlers.
 *
 * And the door itself: a new ball with no type, or a wicket with no
 * method, is refused by the database — and through the API, one event
 * refused and named, the batch written.
 *
 * The rows go into ball_event as toRow() writes them, as the migration owner
 * (as smoke-free-hit does); the fold runs over the rows READ BACK (fromRow,
 * MatchFold), exactly as the server does.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-fold-figures.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import {
  MatchFold, deriveInnings, toRow, fromRow, isLegal, normaliseDismissal, chargedToBowler, runsOffBat,
  inningsStart, batters, bowler, ball, newEventId,
} from "@scrbrd/scoring";

const PORT = 8875;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
// A complete fixture with a toss and no seeded deliveries; nothing else in
// this walk's reset writes to it.
const MATCH = "77777777-0000-0000-0000-000000000001";
// A scheduled fixture the scorer can claim, for the API's door.
const API_MATCH = "77777777-0000-0000-0000-000000000002";
const HIL_1XI = ["01", "02", "03", "04", "05"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const WES_1XI = ["bbbbbbbb-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002"];
const OTHERS = ["06", "11", "12", "13"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const PLAYERS = [...HIL_1XI, ...WES_1XI, ...OTHERS];
// Batters and a bowler SCRBRD holds no row for: the pad types a name, and
// toRow() carries it in the payload.
const TYPED = ["T Typed-Batter", "U Unlisted"];
const TYPED_BOWLER = "Z Typed-Bowler";
// db/43's door: a BEFORE INSERT trigger raising 23514 under these two names.
const DOOR = "ball_event_names_its_delivery";
const DOORS = ["ball_event_ball_has_type", "ball_event_wicket_has_method"];

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const isId = (/** @type {unknown} */ v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// ── The logs ─────────────────────────────────────────────────────
let s = 4343;
const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
/** @template T @param {T[]} xs @returns {T} */
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
/** @template T @param {T[]} xs */
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const BOWLERS_METHODS = ["bowled", "caught", "lbw", "stumped", "hit_wicket"];
const OTHER_METHODS = ["run_out", "handled_ball", "obstructing_field", "hit_twice"];
const ENDS = ["striker_end", "bowler_end"];

let eventNo = 0;
/**
 * One innings under construction. `order` is the batting order (openers
 * first); `bowling` the bowlers, a typed name among them.
 * @param {number} no @param {number} overs @param {{order?: string[], bowling?: string[]}} [o]
 */
function builder(no, overs, o = {}) {
  /** @type {any[]} */
  const ev = [];
  const order = o.order ?? shuffle([...PLAYERS, ...TYPED]);
  const bowling = o.bowling ?? [...shuffle(PLAYERS).slice(0, 3), TYPED_BOWLER];
  let next = 2, overIdx = 0;
  /** @param {any} e */
  const push = (e) => { const x = { id: `ff-${++eventNo}`, innings: no, ...e }; ev.push(x); return x; };
  const now = () => deriveInnings(ev);
  push({ kind: "innings_start", overs, squad: [], bowlingSquad: [] });
  push({ kind: "batters", striker: order[0], nonStriker: order[1] });
  const b = {
    ev, now, order,
    /** A delivery, stamped with who was on strike and bowling, as the pad stamps it. */
    deliver(/** @type {any} */ e) {
      if (now().bowler == null) push({ kind: "bowler", bowler: bowling[overIdx++ % bowling.length] });
      const at = now();
      return push({ kind: "ball", striker: at.striker, nonStriker: at.nonStriker, bowler: at.bowler, ...e });
    },
    /** A run out: of the striker, or (`ns`) of the batter at the other end, with runs completed first. */
    runOut(/** @type {boolean} */ ns, /** @type {number} */ runs = 0) {
      const at = now();
      return b.deliver({ type: "W", value: runs, dismissal: "run_out",
                         ...(ns && at.nonStriker ? { dismissed: at.nonStriker } : {}),
                         ...(runs > 0 ? { outAt: pick(ENDS) } : {}) });
    },
    /** Send the next batter in at whichever end is empty, if one is. */
    fill() {
      const at = now();
      if (at.wickets >= 10 || next >= order.length) return;
      if (at.striker == null) push({ kind: "batters", striker: order[next++] });
      else if (at.nonStriker == null) push({ kind: "batters", nonStriker: order[next++] });
    },
    undo() { const last = ev[ev.length - 1]; push({ kind: "void", target: last.id }); },
    retire(/** @type {"out" | "hurt"} */ how) {
      const at = now();
      if (at.striker == null || at.nonStriker == null) return;
      const batter = pick([at.striker, at.nonStriker]);
      push(how === "out" ? { kind: "retire", batter, reason: "out", type: "W", dismissal: "retired_out" }
                         : { kind: "retire", batter, reason: "hurt" });
    },
    timedOut() {
      if (next >= order.length - 1 || now().wickets >= 9) return;
      push({ kind: "retire", batter: order[next++], reason: "timed_out", type: "W", dismissal: "timed_out" });
    },
  };
  return b;
}

/** A generated innings, leaning on what db/43 closes. `legacy` adds the rows the door now refuses. */
function generated(/** @type {number} */ no, /** @type {number} */ overs, legacy = false) {
  const b = builder(no, overs);
  let guard = 0;
  while (guard++ < 3000) {
    const st = b.now();
    if (st.balls >= overs * 6 || st.wickets >= 10) break;
    if (st.striker == null || st.nonStriker == null) {
      // Every arrival comes through here. Now and then the batter at the far
      // end — often the one who has just walked out — is run out before he
      // has faced a ball.
      b.fill();
      const after = b.now();
      if (after.striker == null || after.nonStriker == null) break;   // nobody left to come in
      if (rnd() < 0.2) b.runOut(true, 0);
      continue;
    }
    const r = rnd();
    if (r < 0.10) b.deliver({ type: "Nb", value: pick([0, 1, 2, 4, 4, 6]),
                              ...(rnd() < 0.4 ? { nbRuns: pick(["byes", "leg_byes"]) } : {}) });
    else if (r < 0.16) b.deliver({ type: "Wd", value: pick([0, 0, 1, 2, 4, 4]) });
    else if (r < 0.21) b.deliver({ type: pick(["B", "LB"]), value: pick([1, 2, 4, 4]) });
    else if (r < 0.26) b.runOut(rnd() < 0.6, pick([0, 0, 1, 2, 3]));
    else if (r < 0.31) b.deliver({ type: "W", value: 0, dismissal: pick(BOWLERS_METHODS) });
    else if (r < 0.32) b.deliver({ type: "W", value: 0, dismissal: pick(OTHER_METHODS),
                                   ...(rnd() < 0.5 ? { dismissed: st.nonStriker } : {}) });
    else if (r < 0.33) b.retire(rnd() < 0.5 ? "out" : "hurt");
    else if (r < 0.34 && st.wickets > 0) b.timedOut();
    else if (legacy && r < 0.40) b.deliver({ value: pick([0, 1, 2, 4, 6]) });            // no type: a run
    else if (legacy && r < 0.43) b.deliver({ type: "W", value: 0 });                      // no method
    else b.deliver({ type: "run", value: pick([0, 0, 0, 1, 1, 1, 2, 3, 4, 6]) });
    // Taken back: the last event, a wicket or a retirement as often as a run.
    if (rnd() < 0.04) b.undo();
  }
  return b.ev;
}

/**
 * A hand-written innings. Steps: "run:v", "Nb:v", "Nb:v:byes", "Wd:v", "B:v",
 * "LB:v", "W:method[:v]", "RO:ns|st:runs[:end]", "noType:v", "noMethod",
 * "void". The next batter comes in after a wicket that stood.
 */
function scripted(/** @type {number} */ no, /** @type {string[]} */ steps, /** @type {string[] | undefined} */ order) {
  const b = builder(no, 20, { order: order ?? shuffle(PLAYERS), bowling: [HIL_1XI[3], WES_1XI[0]] });
  for (const step of steps) {
    const [k, a, c, d] = step.split(":");
    const before = b.now().wickets;
    if (k === "run" || k === "Wd" || k === "B" || k === "LB") b.deliver({ type: k, value: Number(a) });
    else if (k === "Nb") b.deliver({ type: "Nb", value: Number(a), ...(c ? { nbRuns: c } : {}) });
    else if (k === "W") b.deliver({ type: "W", value: Number(c ?? 0), dismissal: a });
    else if (k === "RO") {
      const at = b.now();
      b.deliver({ type: "W", value: Number(c), dismissal: "run_out",
                  ...(a === "ns" ? { dismissed: at.nonStriker } : {}), ...(d ? { outAt: d } : {}) });
    } else if (k === "noType") b.deliver({ value: Number(a) });
    else if (k === "noMethod") b.deliver({ type: "W", value: 0 });
    else if (k === "void") b.undo();
    if (b.now().wickets > before) b.fill();
  }
  return b.ev;
}

const [P1, P2, P3] = [HIL_1XI[0], HIL_1XI[1], HIL_1XI[2]];
// Named edges: [steps, batting order or undefined, what it proves]. Each is a
// case the generator also reaches; written out so that a generator that
// drifted away from one would not quietly stop testing it.
const EDGES = [
  [["RO:ns:0"],                                   [P1, P2, P3], "the non-striker run out off the first ball, before he faced one"],
  [["run:1", "RO:ns:0"],                          [P1, P2, P3], "...and after he faced one (a single swapped the ends)"],
  [["run:0", "RO:ns:2:striker_end"],              [P1, P2, P3], "...with two run first, out at the striker's end"],
  [["run:0", "RO:st:1:bowler_end"],               [P1, P2, P3], "the striker run out at the bowler's end after a run"],
  [["run:2", "RO:ns:0"],                          [P1, TYPED[0], P3], "a typed-name batter run out at the other end: not the striker's dismissal"],
  [["run:0", "RO:ns:1:bowler_end"],               [TYPED[0], P2, P3], "a typed-name striker, a player run out at the other end"],
  [["Nb:4", "Nb:4:byes", "Nb:6:leg_byes", "Nb:6"], [P1, P2, P3], "no-balls: four and six off the bat are his, byes to the rope are not"],
  [["Wd:4", "B:4", "LB:4", "run:4"],              [P1, P2, P3], "a wide worth four, byes and leg byes worth four: only the hit is a four"],
  [["W:run_out:3", "run:0"],                      [P1, P2, P3], "a wicket ball with three run: his runs, no boundary"],
  [["noType:2", "noType:4", "noType:0", "noType:6"], [P1, P2, P3], "balls with no type: runs, a four, a dot and a six"],
  [["run:0", "noMethod"],                         [P1, P2, P3], "a wicket with no method: the batter out, nobody's wicket"],
  [["Nb:0", "noMethod", "run:0"],                 [P1, P2, P3], "...and on a free hit it is saved"],
];

// ── Expectations, from the fold ──────────────────────────────────
/** @param {Map<string, any>} m @param {string} k @param {() => any} init */
const at = (m, k, init) => { if (!m.has(k)) m.set(k, init()); return m.get(k); };
/** @param {Map<string, number>} m @param {string} k @param {number} [by] */
const bump = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/** What each SQL reader must say, from the fold's own figures and decisions. @param {Map<number, any>} byInnings */
function expected(byInnings) {
  const e = {
    /** @type {Map<number, {runs: number, wickets: number, balls: number}>} */ live: new Map(),
    /** @type {Map<string, {runs: number, balls: number, out: boolean}>} */ inningsRows: new Map(),
    /** @type {Map<string, {matches: number, runs: number, balls: number, fours: number, sixes: number}>} */ bat: new Map(),
    /** @type {Map<string, number>} */ dismissals: new Map(),
    /** @type {Map<string, number>} */ dismissalBy: new Map(),
    /** @type {Map<string, {runs: number, balls: number, wides: number, noBalls: number, wickets: number}>} */ bowl: new Map(),
    /** @type {Map<string, {wickets: number, runs: number}>} */ figures: new Map(),
    /** @type {Map<string, number>} */ wicketBy: new Map(),
    /** @type {Map<string, any>} */ opp: new Map(),
    /** @type {Map<string, any>} */ matchups: new Map(),
    totals: { runs: 0, wickets: 0, balls: 0 },
    cases: { nsRunOut: 0, nsBeforeFacing: 0, typedOut: 0, nbBoundaryOffBat: 0, nbByesToRope: 0, wideFour: 0, byeFour: 0,
             wicketWithRuns: 0, noType: 0, noMethod: 0, noMethodSaved: 0, saved: 0, voids: 0 },
  };
  const oppOf = (/** @type {string} */ p) => at(e.opp, p, () => ({ innings: 0, balls: 0, runs: 0, dismissals: 0, fours: 0, sixes: 0,
                                                                  dots: 0, ballsBowled: 0, runsConceded: 0, wickets: 0 }));
  /** @type {Set<string>} */ const battedIn = new Set();
  /** @type {Set<string>} */ const facedIn = new Set();
  for (const [no, inn] of byInnings) {
    e.live.set(no, { runs: inn.runs, wickets: inn.wickets, balls: inn.balls });
    e.totals.runs += inn.runs; e.totals.wickets += inn.wickets; e.totals.balls += inn.balls;
    e.cases.voids += inn.voided;
    const faced = new Set(inn.ballLog.map((/** @type {any} */ x) => x.strikerId));
    for (const b of inn.batsmen) {
      if (!isId(b.id) || (!faced.has(b.id) && b.status !== "out")) continue;
      e.inningsRows.set(`${b.id}|${no}`, { runs: b.runs, balls: b.balls, out: b.status === "out" });
      const c = at(e.bat, b.id, () => ({ matches: 0, runs: 0, balls: 0, fours: 0, sixes: 0 }));
      c.runs += b.runs; c.balls += b.balls; c.fours += b.fours; c.sixes += b.sixes;
      battedIn.add(b.id);
      const o = oppOf(b.id); o.balls += b.balls; o.runs += b.runs; o.fours += b.fours; o.sixes += b.sixes;
      if (faced.has(b.id)) facedIn.add(b.id);
    }
    for (const w of inn.bowlers) {
      if (!isId(w.id)) continue;
      const c = at(e.bowl, w.id, () => ({ runs: 0, balls: 0, wides: 0, noBalls: 0, wickets: 0 }));
      c.runs += w.runs; c.balls += w.balls; c.wides += w.wides; c.noBalls += w.noBalls; c.wickets += w.wickets;
      e.figures.set(`${w.id}|${no}`, { wickets: w.wickets, runs: w.runs });
      const o = oppOf(w.id); o.ballsBowled += w.balls; o.runsConceded += w.runs; o.wickets += w.wickets;
    }
    /** @type {Set<string>} */ const hasFaced = new Set();
    for (const x of inn.ballLog) {
      const type = x.type ?? "run";
      const legal = isLegal(type);
      const value = x.value ?? 0;
      if (x.type == null) e.cases.noType++;
      if (type === "Nb" && runsOffBat(x) >= 4) e.cases.nbBoundaryOffBat++;
      if (type === "Nb" && runsOffBat(x) === 0 && value >= 4) e.cases.nbByesToRope++;
      if (type === "Wd" && value === 4) e.cases.wideFour++;
      if ((type === "B" || type === "LB") && value === 4) e.cases.byeFour++;
      if (type === "W") {
        const mode = normaliseDismissal(x.dismissal);
        if (mode == null) { e.cases.noMethod++; if (x.freeHitSaved) e.cases.noMethodSaved++; }
        if (x.freeHitSaved) e.cases.saved++;
        if (!x.freeHitSaved) {
          const out = x.dismissed ?? x.strikerId;
          if (value > 0) e.cases.wicketWithRuns++;
          if (out !== x.strikerId) {
            if (isId(out)) { e.cases.nsRunOut++; if (!hasFaced.has(out)) e.cases.nsBeforeFacing++; }
            else e.cases.typedOut++;
          }
          if (isId(out)) { bump(e.dismissals, out); bump(e.dismissalBy, `${out}|${mode ?? "null"}`); }
          if (chargedToBowler(mode) && isId(x.bowlerId)) bump(e.wicketBy, `${x.bowlerId}|${mode}`);
          // The opposition's and the matchup's own grouping: the bowler's
          // dismissal of the batter who faced it.
          if (chargedToBowler(mode) && isId(out) && out === x.strikerId) {
            oppOf(out).dismissals++;
            if (isId(x.bowlerId)) at(e.matchups, `${out}|${x.bowlerId}`, muInit).dismissals++;
          }
        }
      }
      if (isId(x.strikerId)) {
        hasFaced.add(x.strikerId);
        if (legal && value === 0) oppOf(x.strikerId).dots++;
        if (isId(x.bowlerId)) {
          const m = at(e.matchups, `${x.strikerId}|${x.bowlerId}`, muInit);
          if (legal) m.balls++;
          if (legal && value === 0) m.dots++;
          m.runs += runsOffBat(x);
          if ((type === "run" || type === "Nb") && runsOffBat(x) === 4) m.fours++;
          if ((type === "run" || type === "Nb") && runsOffBat(x) === 6) m.sixes++;
        }
      }
    }
    for (const w of inn.nonBallWickets) {
      if (isId(w.batter)) { bump(e.dismissals, w.batter); bump(e.dismissalBy, `${w.batter}|${w.dismissal}`); }
    }
  }
  // One fixture: a match batted in is one match, however many innings.
  for (const p of battedIn) at(e.bat, p, () => ({ matches: 0, runs: 0, balls: 0, fours: 0, sixes: 0 })).matches = 1;
  for (const p of facedIn) oppOf(p).innings = 1;
  return e;
}
function muInit() { return { balls: 0, runs: 0, fours: 0, sixes: 0, dots: 0, dismissals: 0 }; }

// ── What SQL says ────────────────────────────────────────────────
async function career() {
  /** @type {Map<string, any>} */ const bat = new Map();
  /** @type {Map<string, any>} */ const bowl = new Map();
  /** @type {Map<string, number>} */ const dismissals = new Map();
  for (const p of PLAYERS) {
    const [b] = await q(`select matches, runs, balls_faced, fours, sixes from player_batting_since($1, null)`, [p]);
    bat.set(p, { matches: Number(b?.matches ?? 0), runs: Number(b?.runs ?? 0), balls: Number(b?.balls_faced ?? 0),
                 fours: Number(b?.fours ?? 0), sixes: Number(b?.sixes ?? 0) });
    const [w] = await q(`select runs_conceded, legal_balls, wides, no_balls, wickets from player_bowling_since($1, null)`, [p]);
    bowl.set(p, { runs: Number(w?.runs_conceded ?? 0), balls: Number(w?.legal_balls ?? 0), wides: Number(w?.wides ?? 0),
                  noBalls: Number(w?.no_balls ?? 0), wickets: Number(w?.wickets ?? 0) });
    dismissals.set(p, Number((await q(`select coalesce(player_dismissals_since($1, null), 0) n`, [p]))[0].n));
  }
  const dismissalBy = new Map((await q(
    `select player_id || '|' || coalesce(dismissal, 'null') k, dismissals n from player_dismissal_breakdown where player_id = any($1)`,
    [PLAYERS])).map((r) => [r.k, Number(r.n)]));
  const wicketBy = new Map((await q(
    `select player_id || '|' || coalesce(dismissal, 'null') k, wickets n from player_wicket_breakdown where player_id = any($1)`,
    [PLAYERS])).map((r) => [r.k, Number(r.n)]));
  return { bat, bowl, dismissals, dismissalBy, wicketBy };
}

/** opposition_squad() for a fixture against the other school, a day inside the window (db/46), as a coach of this one. */
async function opposition(/** @type {string} */ home, /** @type {string} */ away, /** @type {string} */ coachEmail) {
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
    const rows = (await c.query(`select * from opposition_squad($1)`, [m])).rows;
    return new Map(rows.map((r) => [r.player_id, {
      innings: r.innings, balls: r.balls, runs: r.runs, dismissals: r.dismissals, fours: r.fours, sixes: r.sixes, dots: r.dots,
      ballsBowled: r.balls_bowled, runsConceded: r.runs_conceded, wickets: r.wickets }]));
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
                   values ($1, $2, 'verifying', 1, $3, 'ff-out', $3, 'ff-in')`, [MATCH, HIL, scorer]);
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [scorer]);
    return (await c.query(`select ok, reason, exp_runs, exp_wkts, exp_balls from scoring_verify_takeover($1, 'ff-in', -1, -1, -1)`, [MATCH])).rows[0];
  } finally { await c.query("ROLLBACK").catch(() => {}); c.release(); }
}

/**
 * Write rows as the migration owner. Rows the door now refuses (a ball with no
 * type, a wicket with no method) are what a database held before db/43, so
 * the door is lifted for the load and put back — one transaction, so a
 * failure leaves it where it stood.
 * @param {any[][]} logs
 */
async function writeLogs(logs, scorer) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const door = (await c.query(
      `select 1 from pg_trigger where tgrelid = 'ball_event'::regclass and tgname = $1 and tgenabled = 'O'`, [DOOR])).rows.length > 0;
    if (door) await c.query(`alter table ball_event disable trigger ${DOOR}`);
    let seq = 0;
    const cols = ["match_id", "school_id", "seq", "epoch", "innings", "scorer_user_id", "device_id", "idempotency_key",
                  "client_seq", "client_ts", "kind", "ball_type", "value", "striker_id", "non_striker_id", "bowler_id",
                  "dismissed_id", "dismissal", "payload"];
    for (const log of logs) {
      const values = [];
      const params = [];
      for (const ev of log) {
        const r = toRow(ev);
        seq++;
        const row = [MATCH, HIL, seq, 1, r.innings, scorer, "device-fold-figures", ev.id, seq, r.client_ts, r.kind,
                     r.ball_type, r.value, r.striker_id, r.non_striker_id, r.bowler_id, r.dismissed_id,
                     r.dismissal ?? null, JSON.stringify(r.payload)];
        values.push(`(${row.map((_, i) => `$${params.length + i + 1}`).join(",")})`);
        params.push(...row);
      }
      await c.query(`insert into ball_event (${cols.join(",")}) values ${values.join(",")}`, params);
    }
    if (door) await c.query(`alter table ball_event enable trigger ${DOOR}`);
    await c.query("COMMIT");
    return door;
  } catch (err) { await c.query("ROLLBACK").catch(() => {}); throw err; } finally { c.release(); }
}

/** One raw INSERT as the owner, outside any lift: the door's own answer. */
async function tryInsert(/** @type {string} */ matchId, /** @type {number} */ seq, /** @type {Record<string, any>} */ cols, scorer) {
  try {
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                     client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id, dismissal, payload)
             values ($1, $2, $3, 1, 0, $4, 'device-fold-figures', $5, $3, now(), $6, $7, $8, $9, $10, $11, $12)`,
      [matchId, HIL, seq, scorer, `ff-door-${seq}`, cols.kind, cols.ball_type ?? null, cols.value ?? null,
       cols.striker ?? null, cols.bowler ?? null, cols.dismissal ?? null, JSON.stringify(cols.payload ?? {})]);
    return { ok: true };
  } catch (err) {
    const e = /** @type {any} */ (err);
    return { ok: false, code: e.code, table: e.table, constraint: e.constraint };
  }
}

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-fold-figures-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const api = async (/** @type {string} */ path, /** @type {any} */ { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
async function matchups(/** @type {string} */ token) {
  const rows = (await api(`/api/read/matchups`, { token })).body?.rows ?? [];
  return new Map(rows.map((/** @type {any} */ r) => [`${r.batter_id}|${r.bowler_id}`, r]));
}

/** @param {Map<string, number>} want @param {Map<string, number>} got */
const differences = (want, got) => [...new Set([...want.keys(), ...got.keys()])]
  .filter((k) => (want.get(k) ?? 0) !== (got.get(k) ?? 0))
  .map((k) => `${k}: fold ${want.get(k) ?? 0}, SQL ${got.get(k) ?? 0}`);
/** Field by field, for maps of records. @param {Map<string, any>} want @param {Map<string, any>} got @param {string[]} fields */
const fieldDifferences = (want, got, fields) => {
  const out = [];
  for (const k of new Set([...want.keys(), ...got.keys()])) {
    for (const f of fields) {
      const a = want.get(k)?.[f] ?? 0, b = got.get(k)?.[f] ?? 0;
      if (Number(a) !== Number(b)) out.push(`${k} ${f}: fold ${a}, SQL ${b}`);
    }
  }
  return out;
};
/** after − before, per key and field. @param {Map<string, any>} before @param {Map<string, any>} after @param {string[]} fields */
const deltas = (before, after, fields) => new Map([...new Set([...before.keys(), ...after.keys()])].map((k) => [k,
  Object.fromEntries(fields.map((f) => [f, Number(after.get(k)?.[f] ?? 0) - Number(before.get(k)?.[f] ?? 0)]))]));
/** @param {Map<string, number>} a @param {Map<string, number>} b */
const delta = (a, b) => { const d = new Map(); for (const k of new Set([...a.keys(), ...b.keys()])) { const v = (b.get(k) ?? 0) - (a.get(k) ?? 0); if (v) d.set(k, v); } return d; };
const show = (/** @type {string[]} */ xs) => xs.slice(0, 6).join("; ");

try {
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const h = await api("/api/health"); if (h.body?.db === "ok") { up = true; break; } } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("the API comes up", up, serverErr.join("").split("\n").slice(0, 3).join(" "));
  const coach = up ? (await api("/api/auth/dev-login", { method: "POST",
    body: { email: "coach@example.invalid", deviceId: "device-fold-figures" } })).body?.token : null;
  const scorer = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;

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
  /** @type {{no: number, what: string}[]} */
  const edgeInnings = [];
  for (const [steps, order, what] of EDGES) {
    no++; edgeInnings.push({ no, what: /** @type {string} */ (what) });
    logs.push(scripted(no, /** @type {string[]} */ (steps), /** @type {string[]} */ (order)));
  }
  // Sixteen generated innings, half of them carrying legacy rows. Enough for
  // every case above many times over; not so many that the per-row triggers
  // (the milestone and bowling-breach watches each read the whole log) make
  // the load quadratic in minutes rather than seconds.
  for (const overs of [20, 8, 15, 5]) {
    for (let rep = 0; rep < 4; rep++) { no++; logs.push(generated(no, overs, rep % 2 === 1)); }
  }
  const lifted = await writeLogs(logs, scorer);
  console.log(lifted ? "  (the door lifted for the legacy rows, and put back)" : "  (no door to lift: the code before db/43)");

  // ── The fold, over the rows as the database holds them ──
  const rows = await q(`select * from ball_event where match_id = $1 order by seq`, [MATCH]);
  const fold = new MatchFold(rows.map(fromRow));
  /** @type {Map<number, any>} */
  const byInnings = new Map([...fold.byInnings].map(([k, b]) => [k, b.inn]));
  const e = expected(byInnings);

  group(`The fold, over ${logs.length} innings (${EDGES.length} written by hand) and ${rows.length} events`);
  const c = e.cases;
  console.log(`  ${e.totals.wickets} wickets: ${c.nsRunOut} of a player at the non-striker's end (${c.nsBeforeFacing} before he faced), ` +
              `${c.typedOut} of a typed name at the other end, ${c.wicketWithRuns} with runs; ${c.noMethod} with no method ` +
              `(${c.noMethodSaved} saved by a free hit), ${c.saved} saved in all; ${c.noType} balls with no type; ` +
              `no-balls ${c.nbBoundaryOffBat} to the rope off the bat, ${c.nbByesToRope} in byes; ${c.wideFour} wides and ` +
              `${c.byeFour} byes worth four; ${c.voids} voids`);
  // Not vacuous: the logs hold every case db/43 is about.
  ok(`...run outs at the non-striker's end (${c.nsRunOut}), before he faced (${c.nsBeforeFacing})`, c.nsRunOut >= 20 && c.nsBeforeFacing >= 3);
  ok(`...a typed name run out at the other end (${c.typedOut})`, c.typedOut >= 1);
  ok(`...no-ball boundaries off the bat (${c.nbBoundaryOffBat}) and byes to the rope (${c.nbByesToRope})`, c.nbBoundaryOffBat >= 5 && c.nbByesToRope >= 5);
  ok(`...wides worth four (${c.wideFour}), byes worth four (${c.byeFour})`, c.wideFour >= 5 && c.byeFour >= 5);
  ok(`...balls with no type (${c.noType}), wickets with no method (${c.noMethod}, ${c.noMethodSaved} on a free hit)`,
     c.noType >= 10 && c.noMethod >= 5 && c.noMethodSaved >= 1);
  const stored = (await q(`select count(*) filter (where kind = 'ball' and ball_type is null) t,
                                  count(*) filter (where kind = 'ball' and ball_type = 'W' and dismissal is null) m
                             from ball_event where match_id = $1`, [MATCH]))[0];
  ok(`...and they are in ball_event as a database before db/43 held them (${stored.t} with no type, ${stored.m} with no method)`,
     Number(stored.t) >= c.noType && Number(stored.m) >= c.noMethod);
  for (const { no: n, what } of edgeInnings) {
    ok(`edge ${n} — ${what}: in the fold`, (byInnings.get(n)?.ballLog.length ?? 0) > 0);
  }

  group("Per innings: match_live_score is the fold");
  const live = new Map((await q(`select innings, runs, wickets, legal_balls from match_live_score where match_id = $1`, [MATCH]))
    .map((r) => [Number(r.innings), r]));
  const liveBad = [...e.live].filter(([n, f]) => {
    const r = live.get(n);
    return !r || Number(r.runs) !== f.runs || Number(r.wickets) !== f.wickets || Number(r.legal_balls) !== f.balls;
  }).map(([n, f]) => `innings ${n}: fold ${f.runs}/${f.wickets} off ${f.balls}, SQL ${live.get(n)?.runs}/${live.get(n)?.wickets} off ${live.get(n)?.legal_balls}`);
  ok(`runs, wickets and legal balls agree in every innings (${e.live.size})`, liveBad.length === 0, show(liveBad));

  group("Per batter per innings: player_innings is the fold");
  const inn = new Map((await q(`select player_id, innings, runs, balls_faced, out from player_innings where match_id = $1`, [MATCH]))
    .map((r) => [`${r.player_id}|${r.innings}`, { runs: Number(r.runs), balls: Number(r.balls_faced), out: r.out === true }]));
  const missing = [...e.inningsRows.keys()].filter((k) => !inn.has(k));
  const extra = [...inn.keys()].filter((k) => !e.inningsRows.has(k));
  ok(`an innings row for every batter who faced a ball or was out, and no other (${e.inningsRows.size})`,
     missing.length === 0 && extra.length === 0, `missing ${show(missing)} | extra ${show(extra)}`);
  const outBad = [...e.inningsRows].filter(([k, f]) => inn.has(k) && inn.get(k).out !== f.out)
    .map(([k, f]) => `${k}: fold ${f.out ? "out" : "not out"}, SQL ${inn.get(k).out ? "out" : "not out"}`);
  ok("out agrees on every innings row — the non-striker run out is out on his own", outBad.length === 0, show(outBad));
  const rbBad = fieldDifferences(new Map([...e.inningsRows].filter(([k]) => inn.has(k))),
                                 new Map([...inn].filter(([k]) => e.inningsRows.has(k))), ["runs", "balls"]);
  ok("runs and balls faced agree on every innings row", rbBad.length === 0, show(rbBad));

  group("A career: what moved is what the fold did");
  const car1 = await career();
  const batD = deltas(car0.bat, car1.bat, ["matches", "runs", "balls", "fours", "sixes"]);
  const wantBat = new Map(PLAYERS.map((p) => [p, e.bat.get(p) ?? {}]));
  for (const f of ["matches", "runs", "balls", "fours", "sixes"]) {
    const bad = fieldDifferences(wantBat, batD, [f]);
    ok(`player_batting_since ${f}, per batter`, bad.length === 0, show(bad));
  }
  const dBad = differences(new Map([...e.dismissals].filter(([p]) => PLAYERS.includes(p))), delta(car0.dismissals, car1.dismissals));
  ok("player_dismissals_since, per batter", dBad.length === 0, show(dBad));
  const dmBad = differences(e.dismissalBy, delta(car0.dismissalBy, car1.dismissalBy));
  ok("player_dismissal_breakdown, per batter per method", dmBad.length === 0, show(dmBad));
  const bowlD = deltas(car0.bowl, car1.bowl, ["runs", "balls", "wides", "noBalls", "wickets"]);
  const wantBowl = new Map(PLAYERS.map((p) => [p, e.bowl.get(p) ?? {}]));
  for (const f of ["runs", "balls", "wides", "noBalls", "wickets"]) {
    const bad = fieldDifferences(wantBowl, bowlD, [f]);
    ok(`player_bowling_since ${f}, per bowler`, bad.length === 0, show(bad));
  }
  const wmBad = differences(e.wicketBy, delta(car0.wicketBy, car1.wicketBy));
  ok("player_wicket_breakdown, per bowler per method — a wicket with no method is nobody's", wmBad.length === 0, show(wmBad));

  group("Per bowler per innings: bowler_innings_figures is the fold");
  const figs = new Map((await q(`select player_id, innings, wickets, runs_conceded from bowler_innings_figures where match_id = $1`, [MATCH]))
    .map((r) => [`${r.player_id}|${r.innings}`, { wickets: Number(r.wickets), runs: Number(r.runs_conceded) }]));
  const figBad = fieldDifferences(e.figures, figs, ["wickets", "runs"]);
  ok(`every bowler's wickets and runs conceded in every innings (${e.figures.size} spells)`, figBad.length === 0, show(figBad));

  group("The opposition's figures, both ways round");
  const oppH1 = await opposition(HIL, WES, "coach@example.invalid");
  const oppW1 = await opposition(WES, HIL, "coach.wes@example.invalid");
  const OPP_FIELDS = ["innings", "balls", "runs", "dismissals", "fours", "sixes", "dots", "ballsBowled", "runsConceded", "wickets"];
  for (const [label, before, after, squad] of /** @type {[string, Map<string, any>, Map<string, any>, string[]][]} */ (
    [["Westville's, read by Hilton", oppH0, oppH1, WES_1XI], ["Hilton's, read by Westville", oppW0, oppW1, HIL_1XI]])) {
    ok(`${label}: the squad is read at all`, squad.every((p) => after.has(p)), [...after.keys()].join(","));
    const got = deltas(new Map(squad.map((p) => [p, before.get(p)])), new Map(squad.map((p) => [p, after.get(p)])), OPP_FIELDS);
    const want = new Map(squad.map((p) => [p, e.opp.get(p) ?? {}]));
    for (const f of OPP_FIELDS) {
      const bad = fieldDifferences(want, got, [f]);
      ok(`${label}: ${f}`, bad.length === 0, show(bad));
    }
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
  // Both names are joined under the coach's own policies, so the pairs are
  // the Hilton ones.
  const mu1 = coach ? await matchups(coach) : new Map();
  const hilton = (/** @type {string} */ k) => k.split("|").every((id) => id.startsWith("aaaaaaaa-"));
  const MU_FIELDS = ["balls", "runs", "fours", "sixes", "dots", "dismissals"];
  const muWant = new Map([...e.matchups].filter(([k]) => hilton(k)));
  const muGot = deltas(new Map([...mu0].filter(([k]) => hilton(k))), new Map([...mu1].filter(([k]) => hilton(k))), MU_FIELDS);
  ok(`the pairs are read at all (${muWant.size})`, coach != null && muWant.size > 0);
  for (const f of MU_FIELDS) {
    const bad = fieldDifferences(muWant, muGot, [f]);
    ok(`${f} per batter per bowler`, bad.length === 0, show(bad));
  }

  group("The door: a new ball with no type, or a wicket with no method, is refused");
  const M_DOOR = (await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                           values ($1, '1XI', 'Door XI', now() - interval '1 day', 'T20', 20, 'complete') returning id`, [HIL]))[0].id;
  const t1 = await tryInsert(M_DOOR, 1, { kind: "ball", value: 1, striker: PLAYERS[0], bowler: PLAYERS[5] }, scorer);
  ok("a ball with no type is refused by the database, as a CHECK on ball_event would be",
     !t1.ok && t1.code === "23514" && t1.table === "ball_event" && t1.constraint === DOORS[0],
     JSON.stringify(t1));
  const t2 = await tryInsert(M_DOOR, 2, { kind: "ball", ball_type: "W", value: 0, striker: PLAYERS[0], bowler: PLAYERS[5] }, scorer);
  ok("a wicket with no method is refused by the database",
     !t2.ok && t2.code === "23514" && t2.table === "ball_event" && t2.constraint === DOORS[1],
     JSON.stringify(t2));
  // Not a door for anything else: every other kind carries no type, and a
  // retirement marked W carries its reason where a method would be.
  const t3 = await tryInsert(M_DOOR, 3, { kind: "batters", payload: { striker: PLAYERS[0], nonStriker: PLAYERS[1] } }, scorer);
  const t4 = await tryInsert(M_DOOR, 4, { kind: "retire", ball_type: "W", payload: { batter: PLAYERS[0], reason: "out" } }, scorer);
  const t5 = await tryInsert(M_DOOR, 5, { kind: "ball", ball_type: "W", value: 0, dismissal: "bowled", striker: PLAYERS[1] }, scorer);
  ok("...and nothing else is: a batters row, a retirement marked W, a wicket that names its method",
     t3.ok && t4.ok && t5.ok, JSON.stringify([t3, t4, t5]));

  // The API: a ball with no type from a client that sends one is refused on
  // its own, named, and the rest of the batch written (SCRBRD-077).
  const DEVICE = "device-fold-figures";
  const tok = (await api("/api/auth/dev-login", { method: "POST", body: { email: "scorer@example.invalid", deviceId: DEVICE } })).body?.token;
  const claim = await api(`/api/matches/${API_MATCH}/session/claim`, { method: "POST", token: tok, body: { device: DEVICE } });
  let clientSeq = 0;
  const envelope = (/** @type {any} */ ev) => ({ epoch: claim.body?.epoch, deviceId: DEVICE, idempotencyKey: ev.id,
    clientSeq: ++clientSeq, clientTs: Date.now(), innings: ev.innings, payload: ev });
  const stampEv = (/** @type {any} */ ev) => ({ ...ev, innings: 0, id: newEventId(DEVICE, API_MATCH) });
  const post = async (/** @type {any[]} */ ...evs) => (await api(`/api/matches/${API_MATCH}/events`, {
    method: "POST", token: tok, body: { events: evs.map(envelope) } })).body;
  const squad = HIL_1XI.map((id, i) => ({ id, name: `Player ${i + 1}` }));
  const opened = await post(stampEv(inningsStart({ battingTeam: "Hilton 1st XI", bowlingTeam: "Michaelhouse", squad, overs: 20 })),
                            stampEv(batters({ striker: HIL_1XI[0], nonStriker: HIL_1XI[1] })),
                            stampEv(bowler({ bowler: "S Dlamini" })));
  ok("the scorer claims a fixture and opens an innings", claim.body?.ok === true && opened?.accepted?.length === 3,
     JSON.stringify([claim.body, opened]));
  const untyped = { ...stampEv(ball({ type: "run", value: 1 })), type: undefined };
  const typed = stampEv(ball({ type: "run", value: 2 }));
  const res = await post(untyped, typed);
  const stored1 = await q(`select idempotency_key, ball_type from ball_event where match_id = $1 and idempotency_key = any($2)`,
    [API_MATCH, [untyped.id, typed.id]]);
  ok("the API refuses the ball with no type, and names the door",
     res?.refused?.length === 1 && res.refused[0].idempotencyKey === untyped.id && res.refused[0].constraint === DOORS[0],
     JSON.stringify(res));
  ok("...writes the ball after it", res?.accepted?.length === 1 && res.accepted[0].idempotencyKey === typed.id);
  ok("...and stores nothing with no type", stored1.length === 1 && stored1[0].ball_type === "run", JSON.stringify(stored1));
} catch (err) {
  ok(`the walk threw: ${/** @type {any} */ (err).message?.slice(0, 200)}`, false);
  console.log(/** @type {any} */ (err).stack?.split("\n").slice(0, 5).join("\n"));
} finally {
  server.kill("SIGTERM");
  await pool.end();
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nFOLD FIGURES SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
