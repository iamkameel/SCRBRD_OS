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
 *   - no-balls hit for four and six, their byes and leg byes run and to the
 *     rope, on a free hit and off it — byes and leg byes, not the bowler's
 *     (Law 21.15, db/52) — wides worth four, byes and leg byes worth four, a
 *     wicket ball with runs;
 *   - legacy rows, written past db/43's door as a row stored before it
 *     would have been: a ball with no type (a run, to the fold) and a wicket
 *     with no method (a wicket, nobody's — and saved on a free hit);
 *   - free hits, voids, retirements, typed-name bowlers;
 *   - deliveries that do not count in the over (Law 17.3.2.5, SCRBRD-113,
 *     db/54): a fielder's offence on the ball, marked `notInOver`, with the
 *     five to the batting side — and bowler_over's overs held to the fold's;
 *   - a declaration match (SCRBRD-113, db/54: the free hit follows the
 *     format): a no-ball, then a wicket that stands, where a T20 saves it;
 *   - a batter retiring hurt as the pad records it (SCRBRD-071): the pad's
 *     own builder, retire({batter, reason: "hurt"}), asked of the Laws
 *     first, mid-over, his end filled at once, and — later, once a wicket
 *     has fallen or another batter has retired, as the Laws allow — him walking
 *     back in. Not a wicket, so no career may count it as a dismissal.
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
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import {
  MatchFold, deriveInnings, deriveMatch, toRow, fromRow, isLegal, normaliseDismissal, chargedToBowler, runsOffBat,
  inningsStart, batters, bowler, ball, newEventId, retire, RETIRE_REASON, lawsRefusal,
} from "@scrbrd/scoring";
import { countsInOver, NOT_IN_OVER } from "@scrbrd/scoring";

const PORT = port(8875);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
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
// Penalty runs, targets and revisions (SCRBRD-094, db/48) draw on a stream of
// their own, so every innings the walk generated before them is the same
// innings, event for event, with them added.
let s2 = 4848;
const rnd2 = () => (s2 = (s2 * 1103515245 + 12345) % 2147483648) / 2147483648;
// Bowlers suspended mid-over and batters back from retired hurt (SCRBRD-094
// item 2, SCRBRD-071) draw on a third: an innings with neither is the same
// innings, event for event, as before them.
let s3 = 9494;
const rnd3 = () => (s3 = (s3 * 1103515245 + 12345) % 2147483648) / 2147483648;
const SUSPENSION_REASONS = ["beamers", "short_pitched", "deliberate_no_ball", "protected_area", "fielding_time_wasting", "ball_tampering"];
// Batters retiring hurt as the pad records them (SCRBRD-071) draw on a
// fourth, for the same reason.
let s4 = 7171;
const rnd4 = () => (s4 = (s4 * 1103515245 + 12345) % 2147483648) / 2147483648;
// Batters retired out coming back with the captain's consent (Law 25.4.3,
// SCRBRD-071, db/53) draw on a fifth: until the first of them, every innings
// is the one it was.
let s5 = 5353;
const rnd5 = () => (s5 = (s5 * 1103515245 + 12345) % 2147483648) / 2147483648;
// Deliveries that do not count in the over (SCRBRD-113, db/54) draw on a
// sixth, for the same reason.
let s6 = 1717;
const rnd6 = () => (s6 = (s6 * 1103515245 + 12345) % 2147483648) / 2147483648;
const NOT_IN_OVER_LIST = [...NOT_IN_OVER];
const gen = { suspensions: 0, splitOvers: 0, hurtReturns: 0, padRetires: 0, padMidOver: 0, padReturns: 0, hurtWaits: 0, hurtRefused: 0,
              consentReturns: 0, notInOver: 0 };
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
 * `start` is carried on the innings_start: the sides and a target.
 * `ctx` is the fold's context — a declaration match's format (SCRBRD-113) —
 * so each delivery is stamped with the crease the match's own fold has.
 * @param {number} no @param {number} overs @param {{order?: string[], bowling?: string[], start?: Record<string, any>, ctx?: Record<string, any>}} [o]
 */
function builder(no, overs, o = {}) {
  /** @type {any[]} */
  const ev = [];
  const order = o.order ?? shuffle([...PLAYERS, ...TYPED]);
  const bowling = o.bowling ?? [...shuffle(PLAYERS).slice(0, 3), TYPED_BOWLER];
  let next = 2, overIdx = 0;
  /** @param {any} e */
  const push = (e) => { const x = { id: `ff-${++eventNo}`, innings: no, ...e }; ev.push(x); return x; };
  const now = () => deriveInnings(ev, o.ctx ?? {});
  /** @type {Set<string>} */ const suspended = new Set();
  // Retired hurt as the pad records it; and the one who just went off, whom
  // the pad's batting-order sheet does not offer back to the end he left.
  // (The Laws say that now — fill() asks them — but `justRetired` still
  // gates the draw below, so the random stream is the one it always was.)
  /** @type {Set<string>} */ const padRetired = new Set();
  /** @type {string | null} */ let justRetired = null;
  /**
   * The Laws' answer for an event at this point of the innings, as the pad
   * asks it: the fold so far, in its own innings' slot.
   * @param {any} e
   */
  const refused = (e) => {
    /** @type {any[]} */ const innings = [];
    innings[no] = now();
    return lawsRefusal({ innings, events: [] }, { innings: no, ...e });
  };
  /** Who bowled any of the over before the one the next ball is in (Law 17.6). */
  const lastOver = () => {
    const at = now(), over = Math.floor(at.balls / 6);
    return new Set(at.ballLog.filter((x) => x.over === over - 1).map((x) => x.bowlerId));
  };
  /** The round robin's next bowler, passing over one suspended or who bowled the last over. */
  const nextBowler = () => {
    const barred = lastOver();
    for (let k = 0; k < bowling.length; k++) {
      const who = bowling[overIdx++ % bowling.length];
      if (!suspended.has(who) && !barred.has(who)) return who;
    }
    return null;
  };
  push({ kind: "innings_start", overs, squad: [], bowlingSquad: [], ...(o.start ?? {}) });
  push({ kind: "batters", striker: order[0], nonStriker: order[1] });
  const b = {
    ev, now, order,
    /** Penalty runs (Law 41): five, or `runs` named, to the batting side or the fielding side. */
    award(/** @type {boolean} */ toBattingTeam, /** @type {number | undefined} */ runs) {
      push({ kind: "penalty", toBattingTeam, ...(runs != null ? { runs } : {}),
             reason: toBattingTeam ? "helmet_struck" : "time_wasting" });
    },
    /** The umpires' revised target. */
    revise(/** @type {number} */ target) { push({ kind: "revision", target, reason: "rain" }); },
    /** A delivery, stamped with who was on strike and bowling, as the pad stamps it. */
    deliver(/** @type {any} */ e) {
      if (now().bowler == null) {
        const who = suspended.size ? nextBowler() : bowling[overIdx++ % bowling.length];
        if (who == null) return null;
        push({ kind: "bowler", bowler: who });
      }
      const at = now();
      return push({ kind: "ball", striker: at.striker, nonStriker: at.nonStriker, bowler: at.bowler, ...e });
    },
    /**
     * The umpires suspend the bowler on, mid-over (SCRBRD-094 item 2), and
     * another finishes it: one who bowled none of the last over. As the pad
     * writes it: bowler_suspended, then a bowler with reason "suspended".
     */
    suspend() {
      const at = now();
      const over = Math.floor(at.balls / 6);
      if (at.bowler == null || !at.ballLog.some((x) => x.over === over)) return;
      const barred = lastOver();
      const repl = bowling.find((x) => x !== at.bowler && !suspended.has(x) && !barred.has(x));
      if (repl == null) return;
      const reason = SUSPENSION_REASONS[Math.floor(rnd3() * SUSPENSION_REASONS.length)];
      push({ kind: "bowler_suspended", bowler: at.bowler, reason, scope: reason === "ball_tampering" ? "match" : "innings" });
      suspended.add(at.bowler);
      push({ kind: "bowler", bowler: repl, reason: "suspended" });
      gen.suspensions++;
      if (at.balls % 6 > 0) gen.splitOvers++;
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
      // Now and then a batter who retired hurt walks back in (SCRBRD-071):
      // his line goes on, and SQL — which never read the retirement — must
      // still agree with it.
      // Only one the Laws take back: once a wicket has fallen or another
      // batter has retired since he went (SCRBRD-071) — never straight back
      // into the end he left. Asked after the draw, so the stream is as it
      // was; one the Laws refuse waits, and the next batter in comes instead.
      const hurtOnes = at.wickets < 10 ? at.batsmen.filter((x) => x.status === "retired" && x.dismissal === "retired hurt"
        && x.id !== at.striker && x.id !== at.nonStriker && x.id !== justRetired) : [];
      if (hurtOnes.length > 0 && (at.striker == null || at.nonStriker == null) && rnd3() < 0.6) {
        const back = (/** @type {string} */ id) => (at.striker == null ? { kind: "batters", striker: id } : { kind: "batters", nonStriker: id });
        const hurt = hurtOnes.find((x) => refused(back(x.id)) === null);
        if (hurt) {
          push(back(hurt.id));
          gen.hurtReturns++;
          if (padRetired.delete(hurt.id)) gen.padReturns++;   // back from THIS retirement: counted once
          justRetired = null;
          return;
        }
        gen.hurtWaits++;
      }
      // Now and then a batter who retired out comes back with the opposing
      // captain's consent (Law 25.4.3; db/53): his wicket is taken back, in
      // the fold and — through ball_event_live — in every SQL reader. Only one
      // the Laws take: a wicket or another's retirement since he went.
      const outOnes = at.wickets < 10 ? at.batsmen.filter((x) => x.status === "out" && x.dismissal === "retired out"
        && x.id !== at.striker && x.id !== at.nonStriker) : [];
      if (outOnes.length > 0 && (at.striker == null || at.nonStriker == null) && rnd5() < 0.9) {
        const consent = (/** @type {string} */ id) => (at.striker == null ? { kind: "batters", striker: id, captainConsent: true }
                                                                          : { kind: "batters", nonStriker: id, captainConsent: true });
        const hit = outOnes.find((x) => refused(consent(x.id)) === null);
        if (hit) {
          push(consent(hit.id));
          gen.consentReturns++;
          justRetired = null;
          return;
        }
      }
      justRetired = null;
      if (at.wickets >= 10 || next >= order.length) return;
      if (at.striker == null) push({ kind: "batters", striker: order[next++] });
      else if (at.nonStriker == null) push({ kind: "batters", nonStriker: order[next++] });
    },
    undo() { const last = ev[ev.length - 1]; push({ kind: "void", target: last.id }); },
    retire(/** @type {"out" | "hurt"} */ how) {
      const at = now();
      if (at.striker == null || at.nonStriker == null) return;
      const batter = pick([at.striker, at.nonStriker]);
      // Retired hurt is asked of the Laws (after the pick, so the stream is
      // as it was): none once the innings is over — a chase won, here, which
      // this generator plays on past.
      if (how === "hurt" && refused({ kind: "retire", batter, reason: "hurt" }) !== null) { gen.hurtRefused++; return; }
      push(how === "out" ? { kind: "retire", batter, reason: "out", type: "W", dismissal: "retired_out" }
                         : { kind: "retire", batter, reason: "hurt" });
    },
    /**
     * A batter retires hurt as the pad records it (SCRBRD-071): its builder,
     * retire({batter, reason: "hurt"}) — no W marker — asked of the Laws
     * first, as the pad asks. `end` names which; else either.
     * @param {"striker" | "nonStriker"} [end]
     */
    padRetire(end) {
      const at = now();
      if (at.striker == null || at.nonStriker == null) return null;
      const batter = (end ?? (rnd4() < 0.5 ? "striker" : "nonStriker")) === "striker" ? at.striker : at.nonStriker;
      const ev = retire({ innings: no, batter, reason: RETIRE_REASON.HURT });
      /** @type {any[]} */ const innings = [];
      innings[no] = at;
      if (lawsRefusal({ innings, events: [] }, ev) !== null) return null;
      padRetired.add(batter);
      justRetired = batter;
      gen.padRetires++;
      if (at.balls % 6 > 0) gen.padMidOver++;
      return push(ev);
    },
    /**
     * A batter back from retired hurt — or, with `consent`, from retired out
     * (Law 25.4.3) — at the empty end: one the Laws take.
     * @param {string} id @param {boolean} [consent]
     */
    comeBack(id, consent = false) {
      const at = now();
      const e = { ...(at.striker == null ? { kind: "batters", striker: id } : { kind: "batters", nonStriker: id }),
                  ...(consent ? { captainConsent: true } : {}) };
      if (refused(e) !== null) throw new Error(`the Laws refused the written-out return: ${refused(e)}`);
      push(e);
      gen.hurtReturns++;
      if (padRetired.delete(id)) gen.padReturns++;
    },
    /**
     * A batter retires out (Law 25.4.3), on the fifth stream only — so the
     * innings before the first of these is the one it always was — for the
     * consented returns above to come back from.
     */
    retireOut() {
      const at = now();
      if (at.striker == null || at.nonStriker == null) return;
      const batter = rnd5() < 0.5 ? at.striker : at.nonStriker;
      push({ kind: "retire", batter, reason: "out", type: "W", dismissal: "retired_out" });
    },
    /**
     * A fielder's offence on the delivery (Law 17.3.2.5, SCRBRD-113): the
     * ball, of any kind but a wicket, marked with it — it does not count in
     * the over — and the five to the batting side, as the pad records it
     * (notInOverDelivery()). After a fielder obstructs a batter the batters
     * may choose who faces.
     */
    notInOver() {
      const at = now();
      if (at.striker == null || at.nonStriker == null) return;
      const reason = NOT_IN_OVER_LIST[Math.floor(rnd6() * NOT_IN_OVER_LIST.length)];
      const type = ["run", "run", "B", "LB", "Nb", "Wd"][Math.floor(rnd6() * 6)];
      const value = [0, 1, 2, 4][Math.floor(rnd6() * 4)];
      const choose = reason === "obstructing_batter" && rnd6() < 0.5;
      const d = b.deliver({ type, value, notInOver: reason, ...(choose ? { facesNext: "non_striker" } : {}) });
      if (d) { push({ kind: "penalty", toBattingTeam: true, runs: 5, reason }); gen.notInOver++; }
    },
    timedOut() {
      if (next >= order.length - 1 || now().wickets >= 9) return;
      push({ kind: "retire", batter: order[next++], reason: "timed_out", type: "W", dismissal: "timed_out" });
    },
  };
  return b;
}

/**
 * A generated innings, leaning on what db/43 closes. `legacy` adds the rows
 * the door now refuses. `start` gives it sides (and perhaps a target): then
 * penalty runs are awarded to both sides as it goes, now and then the umpires
 * revise the target, and `awardFirst` opens it with an award to the fielding
 * side (SCRBRD-094, db/48).
 * @param {number} no @param {number} overs @param {boolean} [legacy]
 * @param {Record<string, any>} [start] @param {boolean} [awardFirst]
 */
function generated(no, overs, legacy = false, start = undefined, awardFirst = false) {
  const b = builder(no, overs, start ? { start } : {});
  if (awardFirst) b.award(false);
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
    // The umpires suspend the bowler now and then; another finishes the over.
    if (rnd3() < 0.03) b.suspend();
    // A batter retires hurt, mid-over, as the pad records it (SCRBRD-071).
    if (rnd4() < 0.03 && b.now().balls % 6 > 0) b.padRetire();
    // A batter retires out, to come back later with consent (Law 25.4.3).
    if (rnd5() < 0.012 && b.now().wickets < 8) b.retireOut();
    // A delivery that does not count in the over (SCRBRD-113).
    if (rnd6() < 0.04) b.notInOver();
    if (start) {
      const p = rnd2();
      if (p < 0.02) b.award(false, rnd2() < 0.3 ? undefined : 5);
      else if (p < 0.035) b.award(true, rnd2() < 0.3 ? undefined : 5);
      else if (p < 0.04) b.revise(40 + Math.floor(rnd2() * 120));
    }
  }
  return b.ev;
}

/**
 * A hand-written innings. Steps: "run:v", "Nb:v", "Nb:v:byes", "Wd:v", "B:v",
 * "LB:v", "W:method[:v]", "RO:ns|st:runs[:end]", "noType:v", "noMethod",
 * "void". The next batter comes in after a wicket that stood.
 */
function scripted(/** @type {number} */ no, /** @type {string[]} */ steps, /** @type {string[] | undefined} */ order,
                  /** @type {Record<string, any>} */ ctx = {}) {
  const b = builder(no, 20, { order: order ?? shuffle(PLAYERS), bowling: [HIL_1XI[3], WES_1XI[0]], ctx });
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
  [["Nb:0", "Nb:1:byes", "Nb:2:leg_byes", "Nb:4:leg_byes", "Nb:3:byes", "run:0"], [P1, P2, P3],
   "no-balls on a free hit, byes and leg byes run and to the rope: neither the batter's nor the bowler's (Law 21.15)"],
  [["Wd:4", "B:4", "LB:4", "run:4"],              [P1, P2, P3], "a wide worth four, byes and leg byes worth four: only the hit is a four"],
  [["W:run_out:3", "run:0"],                      [P1, P2, P3], "a wicket ball with three run: his runs, no boundary"],
  [["noType:2", "noType:4", "noType:0", "noType:6"], [P1, P2, P3], "balls with no type: runs, a four, a dot and a six"],
  [["run:0", "noMethod"],                         [P1, P2, P3], "a wicket with no method: the batter out, nobody's wicket"],
  [["Nb:0", "noMethod", "run:0"],                 [P1, P2, P3], "...and on a free hit it is saved"],
];

/**
 * The pad's retired hurt, written out (SCRBRD-071): P1 hits a four and
 * retires hurt mid-over; P3 comes in at his end; P2 is bowled; P1 walks back
 * in and hits two. His line: 6 (2), not out — and no dismissal anywhere.
 */
function padRetireEdge(/** @type {number} */ no) {
  // Sides of its own: the Laws take no retirement in an innings nobody said
  // was batting (no_innings), and no award in the walk is made to either.
  const b = builder(no, 20, { order: [P1, P2, P3, HIL_1XI[3]], bowling: [WES_1XI[0], WES_1XI[1]],
                              start: { battingTeam: "Retired Hurt XI", bowlingTeam: "Pad XI" } });
  b.deliver({ type: "run", value: 4 });
  if (!b.padRetire("striker")) throw new Error("the Laws refused the written-out retirement");
  b.fill();
  b.deliver({ type: "run", value: 1 });
  b.deliver({ type: "W", value: 0, dismissal: "bowled" });
  b.comeBack(P1);
  b.deliver({ type: "run", value: 2 });
  return b.ev;
}

/**
 * Retired out, and back with the captain's consent (Law 25.4.3; SCRBRD-071,
 * db/53), written out: P1 hits a four and retires out; P3 comes in; P2 is
 * bowled; P1 walks back in with consent and hits two. His line: 6 (2), not
 * out; one wicket in the innings, P2's.
 */
function consentEdge(/** @type {number} */ no) {
  const b = builder(no, 20, { order: [P1, P2, P3, HIL_1XI[3]], bowling: [WES_1XI[0], WES_1XI[1]],
                              start: { battingTeam: "Retired Out XI", bowlingTeam: "Consent XI" } });
  b.deliver({ type: "run", value: 4 });
  b.ev.push({ id: `ff-${++eventNo}`, innings: no, kind: "retire", batter: P1, reason: "out", type: "W", dismissal: "retired_out" });
  b.fill();
  b.deliver({ type: "run", value: 0 });
  b.deliver({ type: "W", value: 0, dismissal: "bowled" });
  b.comeBack(P1, true);
  b.deliver({ type: "run", value: 2 });
  return b.ev;
}

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
    cases: { nsRunOut: 0, nsBeforeFacing: 0, typedOut: 0, nbBoundaryOffBat: 0, nbByesToRope: 0, nbByesRun: 0, nbLegByesRun: 0,
             nbLegByesToRope: 0, nbByesOnFreeHit: 0, wideFour: 0, byeFour: 0,
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
    let onFreeHit = false;   // the fold's rule: a no-ball earns it, a legal ball takes it
    for (const x of inn.ballLog) {
      const type = x.type ?? "run";
      const legal = isLegal(type);
      const value = x.value ?? 0;
      if (type === "Nb" && x.nbRuns && value > 0) {
        if (value < 4) { if (x.nbRuns === "byes") e.cases.nbByesRun++; else e.cases.nbLegByesRun++; }
        else if (x.nbRuns === "leg_byes") e.cases.nbLegByesToRope++;
        if (onFreeHit) e.cases.nbByesOnFreeHit++;
      }
      onFreeHit = type === "Nb" ? true : legal ? false : onFreeHit;
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
      // The balls of the over, as the fold counts them: not a delivery that
      // does not count (Law 17.3.2.5, db/54).
      const counts = countsInOver(x);
      if (isId(x.strikerId)) {
        hasFaced.add(x.strikerId);
        if (counts && value === 0) oppOf(x.strikerId).dots++;
        if (isId(x.bowlerId)) {
          const m = at(e.matchups, `${x.strikerId}|${x.bowlerId}`, muInit);
          if (counts) m.balls++;
          if (counts && value === 0) m.dots++;
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
  // The lifetime views, which db/49 made one pass over the log rather than
  // one call of the functions above per player: the same figures, read
  // through the views every career screen reads.
  /** @type {Map<string, any>} */ const batView = new Map();
  /** @type {Map<string, any>} */ const bowlView = new Map();
  /** @type {Map<string, number>} */ const dismissalsView = new Map();
  for (const r of await q(`select * from player_batting_career where player_id = any($1)`, [PLAYERS])) {
    batView.set(r.player_id, { matches: Number(r.matches), runs: Number(r.runs), balls: Number(r.balls_faced),
                               fours: Number(r.fours), sixes: Number(r.sixes) });
  }
  for (const r of await q(`select * from player_bowling_career where player_id = any($1)`, [PLAYERS])) {
    bowlView.set(r.player_id, { runs: Number(r.runs_conceded), balls: Number(r.legal_balls), wides: Number(r.wides),
                                noBalls: Number(r.no_balls), wickets: Number(r.wickets) });
  }
  for (const r of await q(`select * from player_dismissals where player_id = any($1)`, [PLAYERS])) {
    dismissalsView.set(r.player_id, Number(r.dismissals));
  }
  return { bat, bowl, dismissals, dismissalBy, wicketBy, batView, bowlView, dismissalsView };
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
async function writeLogs(logs, scorer, matchId = MATCH) {
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
        const row = [matchId, HIL, seq, 1, r.innings, scorer, "device-fold-figures", ev.id, seq, r.client_ts, r.kind,
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
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
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

  // A DECLARATION MATCH (SCRBRD-113, db/54): no free hit after a no-ball.
  // Written before the careers are read, so its figures are in "before" and
  // "after" alike, and every delta below is the main fixture's alone.
  const DECL = (await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                         values ($1, '1XI', 'Declaration XI', now() - interval '2 days', 'One-Day Declaration', 100, 'complete')
                         returning id`, [HIL]))[0].id;
  const declLog = scripted(0, ["run:1", "Nb:0", "W:bowled", "Nb:1", "W:lbw", "run:0", "Nb:0", "Wd:0", "W:caught",
                               "Nb:0", "RO:ns:0", "Nb:2:byes", "run:4", "Nb:0", "noMethod"], [P1, P2, P3, HIL_1XI[3], HIL_1XI[4], ...OTHERS],
                         { format: "One-Day Declaration" });
  await writeLogs([declLog], scorer, DECL);

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
  no++;
  const padEdgeNo = no;
  edgeInnings.push({ no, what: "a batter retired hurt by the pad, mid-over, and back after the next wicket" });
  logs.push(padRetireEdge(no));
  // Sixteen generated innings, half of them carrying legacy rows. Enough for
  // every case above many times over; not so many that the per-row triggers
  // (the milestone and bowling-breach watches each read the whole log) make
  // the load quadratic in minutes rather than seconds.
  // They are played by two sides in turn, Hilton first (SCRBRD-094): penalty
  // runs are awarded to both, and an award to the fielding side goes to its
  // last innings — or, in the first, to Westville's first, which opens on
  // it. Half of them carry a target.
  let g = 0;
  for (const overs of [20, 8, 15, 5]) {
    for (let rep = 0; rep < 4; rep++) {
      no++;
      const [bat, bowl] = g % 2 ? ["Westville 1XI", "Hilton 1XI"] : ["Hilton 1XI", "Westville 1XI"];
      const start = { battingTeam: bat, bowlingTeam: bowl, ...(rnd2() < 0.5 ? { target: 40 + Math.floor(rnd2() * 120) } : {}) };
      logs.push(generated(no, overs, rep % 2 === 1, start, g === 0));
      g++;
    }
  }
  // After the generated innings, so their numbers and ids are what they were.
  no++;
  edgeInnings.push({ no, what: "a batter retired out, and back with the opposing captain's consent after the next wicket" });
  logs.push(consentEdge(no));
  const lifted = await writeLogs(logs, scorer);
  console.log(lifted ? "  (the door lifted for the legacy rows, and put back)" : "  (no door to lift: the code before db/43)");

  // ── The fold, over the rows as the database holds them ──
  const rows = await q(`select * from ball_event where match_id = $1 order by seq`, [MATCH]);
  const fold = new MatchFold(rows.map(fromRow));
  // The match's view: each innings as the laws read it, penalty runs to a
  // fielding side credited across innings (SCRBRD-094).
  /** @type {Map<number, any>} */
  const byInnings = new Map();
  fold.view().innings.forEach((inn, k) => byInnings.set(k, inn));
  const e = expected(byInnings);

  group(`The fold, over ${logs.length} innings (${EDGES.length} written by hand) and ${rows.length} events`);
  const c = e.cases;
  console.log(`  ${e.totals.wickets} wickets: ${c.nsRunOut} of a player at the non-striker's end (${c.nsBeforeFacing} before he faced), ` +
              `${c.typedOut} of a typed name at the other end, ${c.wicketWithRuns} with runs; ${c.noMethod} with no method ` +
              `(${c.noMethodSaved} saved by a free hit), ${c.saved} saved in all; ${c.noType} balls with no type; ` +
              `no-balls ${c.nbBoundaryOffBat} to the rope off the bat, ${c.nbByesToRope} in byes, ${c.nbLegByesToRope} of them leg byes; ` +
              `${c.nbByesRun} no-balls with byes run and ${c.nbLegByesRun} with leg byes run, ${c.nbByesOnFreeHit} of all those on a free hit; ${c.wideFour} wides and ` +
              `${c.byeFour} byes worth four; ${c.voids} voids`);
  // Not vacuous: the logs hold every case db/43 is about.
  ok(`...run outs at the non-striker's end (${c.nsRunOut}), before he faced (${c.nsBeforeFacing})`, c.nsRunOut >= 20 && c.nsBeforeFacing >= 3);
  ok(`...a typed name run out at the other end (${c.typedOut})`, c.typedOut >= 1);
  ok(`...no-ball boundaries off the bat (${c.nbBoundaryOffBat}) and byes to the rope (${c.nbByesToRope})`, c.nbBoundaryOffBat >= 5 && c.nbByesToRope >= 5);
  ok(`...no-ball byes run (${c.nbByesRun}), leg byes run (${c.nbLegByesRun}) and to the rope (${c.nbLegByesToRope}), on a free hit (${c.nbByesOnFreeHit})`,
     c.nbByesRun >= 5 && c.nbLegByesRun >= 5 && c.nbLegByesToRope >= 3 && c.nbByesOnFreeHit >= 3);
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
  // SCRBRD-094 item 2 and SCRBRD-071: suspensions (a row of their own kind,
  // bowler_id set, no ball) and split overs, and batters back from retired
  // hurt. Every figure below is checked with them in the log.
  const suspRows = rows.filter((r) => r.kind === "bowler_suspended");
  const split = [...byInnings.values()].reduce((n, inn) => n + inn.bowlerChanges.filter((c) => c.reason === "suspended").length, 0);
  const folded = [...byInnings.values()].reduce((n, inn) => n + inn.suspensions.length, 0);
  console.log(`  ${suspRows.length} suspensions stored (${gen.splitOvers} mid-over), ${folded} in the fold, ${split} overs finished by another; ` +
              `${gen.hurtReturns} batters back from retired hurt`);
  ok(`...bowlers suspended mid-over and overs finished by another (${suspRows.length}, ${split})`,
     suspRows.length >= 5 && split >= 3 && folded >= 3 && suspRows.every((r) => r.ball_type == null && r.value == null));
  ok(`...batters back from retired hurt (${gen.hurtReturns}), batting again in the fold`,
     gen.hurtReturns >= 2 && [...byInnings.values()].some((inn) => inn.batsmen.some((x) => x.status !== "retired"
       && rows.some((r) => r.kind === "retire" && r.innings === [...byInnings.keys()].find((k) => byInnings.get(k) === inn)
         && (r.payload?.batter === x.id) && r.ball_type == null))));
  // Every retirement hurt and every return from one in these logs is one the
  // Laws take (SCRBRD-071): none once the innings is over, and nobody straight
  // back into the end he left. Asked of each, at its own point in its log.
  /** @type {string[]} */ const lawless = [];
  let judgedRetire = 0, judgedReturn = 0, judgedConsent = 0;
  for (const log of logs) {
    for (let k = 0; k < log.length; k++) {
      const x = log[k];
      if (x.kind !== "retire" && x.kind !== "batters") continue;
      if (x.kind === "retire" && x.type === "W") continue;
      const before = deriveInnings(log.slice(0, k));
      const returning = x.kind === "batters" && [x.striker, x.nonStriker].some((id) => before.batsmen.some((b) => b.id === id
        && (b.status === "retired" || (x.captainConsent === true && b.status === "out"))));
      if (x.kind === "batters" && !returning) continue;
      if (x.kind === "retire") judgedRetire++; else if (x.captainConsent === true) judgedConsent++; else judgedReturn++;
      /** @type {any[]} */ const innings = [];
      innings[x.innings] = before;
      const why = lawsRefusal({ innings, events: [] }, x);
      if (why) lawless.push(`${x.id} ${x.kind}: ${why}`);
    }
  }
  console.log(`  ${judgedRetire} retirements hurt and ${judgedReturn} returns asked of the Laws; the generator held back ` +
              `${gen.hurtWaits} returns the Laws would refuse and ${gen.hurtRefused} retirements in an innings already over`);
  ok(`...every retirement hurt (${judgedRetire}), every return (${judgedReturn}) and every return with consent (${judgedConsent}) is one the Laws take`,
     lawless.length === 0 && judgedRetire >= 5 && judgedReturn >= 2 && judgedConsent >= 3, lawless.slice(0, 5));
  // Law 25.4.3 (db/53): batters retired out, back with consent — their
  // wickets taken back in the fold, and every SQL figure above agreeing.
  const resumedOut = [...byInnings.values()].reduce((n, inn) => n + (inn.resumedWithConsent?.length ?? 0), 0);
  console.log(`  ${gen.consentReturns} batters back from retired out with the captain's consent (generated), ${resumedOut} in the fold`);
  ok(`...batters back from retired out with consent (${gen.consentReturns} generated, ${resumedOut} in the fold), their wickets taken back`,
     gen.consentReturns >= 2 && resumedOut >= gen.consentReturns);

  // SCRBRD-071: retired hurt as the pad records it. Stored as a retire with
  // no W marker, which every SQL reader of a career answers with nothing:
  // the rule functions they all count dismissals through say no batter and
  // no dismissal for each one.
  const padIds = new Set(logs.flat().filter((x) => x.kind === "retire" && x.reason === "hurt" && x.clientTs != null).map((x) => x.id));
  const padRows = rows.filter((r) => padIds.has(r.idempotency_key));
  const ruled = await q(
    `select count(*) filter (where ball_retired_batter(kind, ball_type, dismissal, payload) is not null) b,
            count(*) filter (where ball_retirement_dismissal(kind, ball_type, dismissal, payload) is not null) d
       from ball_event where match_id = $1 and idempotency_key = any($2)`, [MATCH, [...padIds]]);
  console.log(`  ${gen.padRetires} retired hurt as the pad records it (${gen.padMidOver} mid-over), ${gen.padReturns} of them back later; ` +
              `${padRows.length} such rows stored`);
  ok(`...batters retired hurt by the pad, mid-over (${gen.padRetires}, ${gen.padMidOver}), and some back later (${gen.padReturns})`,
     gen.padRetires >= 5 && gen.padMidOver >= 5 && gen.padReturns >= 2 && padRows.length === gen.padRetires);
  ok("...stored with no W marker and no dismissal: not a wicket",
     padRows.every((r) => r.ball_type == null && r.dismissal == null && r.dismissed_id == null && r.value == null));
  ok("...and the career rule functions count none of them as a dismissal",
     Number(ruled[0].b) === 0 && Number(ruled[0].d) === 0, `${ruled[0].b} batters, ${ruled[0].d} dismissals`);
  const edge = byInnings.get(padEdgeNo);
  const back = edge?.batsmen.find((/** @type {any} */ x) => x.id === P1);
  ok("the written-out case: P1 is batting again, 6 (2), one wicket in the innings (P2's)",
     back?.status === "batting" && back.runs === 6 && back.balls === 2 && edge.wickets === 1, JSON.stringify(back));

  group("Per innings: match_live_score is the fold");
  const live = new Map((await q(`select innings, runs, wickets, legal_balls from match_live_score where match_id = $1`, [MATCH]))
    .map((r) => [Number(r.innings), r]));
  const liveBad = [...e.live].filter(([n, f]) => {
    const r = live.get(n);
    return !r || Number(r.runs) !== f.runs || Number(r.wickets) !== f.wickets || Number(r.legal_balls) !== f.balls;
  }).map(([n, f]) => `innings ${n}: fold ${f.runs}/${f.wickets} off ${f.balls}, SQL ${live.get(n)?.runs}/${live.get(n)?.wickets} off ${live.get(n)?.legal_balls}`);
  ok(`runs, wickets and legal balls agree in every innings (${e.live.size})`, liveBad.length === 0, show(liveBad));

  group("The balls of the over: a delivery that does not count (Law 17.3.2.5, SCRBRD-113, db/54)");
  {
    const marked = rows.filter((r) => r.kind === "ball" && r.payload?.notInOver != null);
    const chose = marked.filter((r) => r.payload?.facesNext != null).length;
    console.log(`  ${marked.length} deliveries not in the over (${gen.notInOver} generated, ${chose} with the batters' choice of who faces)`);
    ok(`...not vacuous: deliveries that do not count, of each offence (${marked.length})`,
       marked.length >= 10 && NOT_IN_OVER_LIST.every((r) => marked.some((x) => x.payload.notInOver === r)));
    // bowler_over: every bowler's balls of the over and deliveries, over by
    // over, as the fold stamps them (the over each ball is in, and whether it
    // counts) — the workload read, its spells and the day check.
    /** @type {Map<string, {legal: number, deliveries: number}>} */
    const want = new Map();
    for (const [n, inn] of byInnings) {
      for (const x of inn.ballLog) {
        if (!isId(x.bowlerId)) continue;
        const k = `${x.bowlerId}|${n}|${x.over}`;
        const w = at(want, k, () => ({ legal: 0, deliveries: 0 }));
        w.deliveries++; if (countsInOver(x)) w.legal++;
      }
    }
    const got = new Map((await q(`select bowler_id, innings, over_no, legal_balls, deliveries from bowler_over where match_id = $1`, [MATCH]))
      .map((r) => [`${r.bowler_id}|${r.innings}|${r.over_no}`, { legal: Number(r.legal_balls), deliveries: Number(r.deliveries) }]));
    const bad = fieldDifferences(want, got, ["legal", "deliveries"]);
    ok(`bowler_over is the fold's, over by over (${want.size} overs)`, bad.length === 0, show(bad));
    // The hat-trick: none here that a delivery that does not count made or broke.
    const hat = await q(`select count(*) n from bowler_hat_trick where match_id = $1`, [MATCH]);
    ok("bowler_hat_trick reads (a count, whatever it is)", Number(hat[0].n) >= 0);
  }

  group("A declaration match: no free hit after a no-ball (SCRBRD-113, db/54)");
  {
    const drows = await q(`select * from ball_event where match_id = $1 order by seq`, [DECL]);
    const dfold = new MatchFold(drows.map(fromRow), { format: "One-Day Declaration" }).view().innings[0];
    const asT20 = new MatchFold(drows.map(fromRow), { format: "T20" }).view().innings[0];
    console.log(`  the declaration fold: ${dfold.runs}/${dfold.wickets} off ${dfold.balls}; the same log as a T20: ${asT20.runs}/${asT20.wickets}`);
    ok(`...not vacuous: the wickets after a no-ball stand here, and a T20 would save them (${dfold.wickets} against ${asT20.wickets})`,
       dfold.wickets >= asT20.wickets + 3 && dfold.freeHits === false && asT20.freeHits === true);
    const [live] = await q(`select runs, wickets, legal_balls from match_live_score where match_id = $1 and innings = 0`, [DECL]);
    ok("match_live_score is the declaration fold", Number(live.runs) === dfold.runs && Number(live.wickets) === dfold.wickets
       && Number(live.legal_balls) === dfold.balls, JSON.stringify(live));
    const [folded] = await q(`select * from innings_score_as_folded($1, 0::smallint)`, [DECL]);
    ok("...and so is the handover check's count", folded.runs === dfold.runs && folded.wickets === dfold.wickets && folded.legal_balls === dfold.balls,
       JSON.stringify(folded));
    const figs = new Map((await q(`select player_id, wickets, runs_conceded from bowler_innings_figures where match_id = $1`, [DECL]))
      .map((r) => [r.player_id, { wickets: Number(r.wickets), runs: Number(r.runs_conceded) }]));
    const fwant = new Map(dfold.bowlers.filter((w) => isId(w.id)).map((w) => [w.id, { wickets: w.wickets, runs: w.runs }]));
    const fbad = fieldDifferences(fwant, figs, ["wickets", "runs"]);
    ok("bowler_innings_figures: the bowler's wickets off the ball after a no-ball are his", fbad.length === 0 && fwant.size > 0, show(fbad));
    const pinn = new Map((await q(`select player_id, runs, balls_faced, out from player_innings where match_id = $1`, [DECL]))
      .map((r) => [r.player_id, { runs: Number(r.runs), balls: Number(r.balls_faced), out: r.out === true }]));
    const pbad = dfold.batsmen.filter((x) => isId(x.id) && pinn.has(x.id))
      .filter((x) => pinn.get(x.id).out !== (x.status === "out") || pinn.get(x.id).runs !== x.runs || pinn.get(x.id).balls !== x.balls)
      .map((x) => `${x.id}: fold ${x.runs} (${x.balls}) ${x.status}, SQL ${JSON.stringify(pinn.get(x.id))}`);
    ok("player_innings: the batters out off the ball after a no-ball are out", pbad.length === 0, show(pbad));
    const [fh] = await q(`select count(*) filter (where ball_on_free_hit(match_id, innings, seq)) n from ball_event where match_id = $1`, [DECL]);
    ok("ball_on_free_hit() finds no free hit in it", Number(fh.n) === 0);
  }

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
  const p1Row = inn.get(`${P1}|${padEdgeNo}`);
  ok("the pad's retired hurt, back: player_innings says 6 off 2, not out", p1Row?.runs === 6 && p1Row.balls === 2 && p1Row.out === false,
     JSON.stringify(p1Row));

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

  group("A career through the lifetime views (db/49): the fold, and the functions, figure for figure");
  // What moved through the views is what the fold did...
  const batVD = deltas(car0.batView, car1.batView, ["matches", "runs", "balls", "fours", "sixes"]);
  for (const f of ["matches", "runs", "balls", "fours", "sixes"]) {
    const bad = fieldDifferences(wantBat, batVD, [f]);
    ok(`player_batting_career ${f}, per batter`, bad.length === 0, show(bad));
  }
  const dVBad = differences(new Map([...e.dismissals].filter(([p]) => PLAYERS.includes(p))), delta(car0.dismissalsView, car1.dismissalsView));
  ok("player_dismissals, per batter", dVBad.length === 0, show(dVBad));
  const bowlVD = deltas(car0.bowlView, car1.bowlView, ["runs", "balls", "wides", "noBalls", "wickets"]);
  for (const f of ["runs", "balls", "wides", "noBalls", "wickets"]) {
    const bad = fieldDifferences(wantBowl, bowlVD, [f]);
    ok(`player_bowling_career ${f}, per bowler`, bad.length === 0, show(bad));
  }
  // ...and, before and after, the views ARE the functions: every figure, not
  // just the change. (A player with no row in a view reads 0 here, which is
  // what the function answers for him.)
  for (const [when, car] of /** @type {[string, any][]} */ ([["before the logs", car0], ["after them", car1]])) {
    const bBad = fieldDifferences(car.bat, car.batView, ["matches", "runs", "balls", "fours", "sixes"]);
    const wBad = fieldDifferences(car.bowl, car.bowlView, ["runs", "balls", "wides", "noBalls", "wickets"]);
    const dBad2 = differences(car.dismissals, car.dismissalsView);
    ok(`the three lifetime views are the three functions, ${when}`, bBad.length + wBad.length + dBad2.length === 0,
       show([...bBad, ...wBad, ...dBad2]));
  }

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

  group("Penalty runs, both sides: every SQL total is the fold's (SCRBRD-090, SCRBRD-094, db/48)");
  {
    const all = [...byInnings.values()];
    const awardsToField = all.reduce((n, inn) => n + (inn.penaltyToFielding > 0 ? 1 : 0), 0);
    const carriedIn = [...byInnings].filter(([, inn]) => inn.penaltyCarried > 0);
    const opened = carriedIn.filter(([n, inn]) => inn.penaltyCarried > 0 && [...byInnings].some(([k, x]) => k < n && x.bowlingTeamKey === inn.teamKey && x.penaltyToFielding > 0)
                                                 && ![...byInnings].some(([k, x]) => k < n && x.teamKey === inn.teamKey));
    const toBat = rows.filter((r) => r.kind === "penalty" && r.payload?.toBattingTeam === true).length;
    const toField = rows.filter((r) => r.kind === "penalty" && r.payload?.toBattingTeam === false).length;
    const targets = all.filter((inn) => inn.target != null).length;
    console.log(`  ${toBat} awards to the batting side, ${toField} to the fielding side (made in ${awardsToField} innings); ` +
                `${carriedIn.length} innings credited, ${opened.length} of them opening on the award; ${targets} with a target`);
    ok(`...not vacuous: awards both ways (${toBat}, ${toField}), innings credited (${carriedIn.length}), one opened on it (${opened.length}), targets (${targets})`,
       toBat >= 5 && toField >= 5 && carriedIn.length >= 5 && opened.length >= 1 && targets >= 3);

    // The whole-log fold (deriveMatch) and the server's (MatchFold) credit alike.
    const whole = deriveMatch(rows.map(fromRow)).innings;
    const idx = [...byInnings.keys()].sort((a, b) => a - b);
    const foldsBad = idx.filter((n, i) => {
      const a = byInnings.get(n), b = whole[i];
      return a.runs !== b.runs || a.target !== b.target || a.penaltyCarried !== b.penaltyCarried;
    });
    ok(`deriveMatch and MatchFold credit every innings alike (${idx.length})`, foldsBad.length === 0, foldsBad.slice(0, 5).join(", "));

    const sql = new Map((await q(`select i.n, penalty_credit_as_folded($1, i.n) credit, innings_target_as_folded($1, i.n) target,
                                          (select l.runs from match_live_score l where l.match_id = $1 and l.innings = i.n) live,
                                          (select f.runs from innings_score_as_folded($1, i.n) f) folded
                                     from (select distinct innings as n from ball_event where match_id = $1) i`, [MATCH]))
      .map((r) => [Number(r.n), r]));
    const bad = [...byInnings].filter(([n, inn]) => {
      const r = sql.get(n);
      return !r || Number(r.credit) !== inn.penaltyCarried || (r.target == null ? null : Number(r.target)) !== (inn.target ?? null)
          || Number(r.live) !== inn.runs || Number(r.folded) !== inn.runs;
    }).map(([n, inn]) => `innings ${n}: fold ${inn.runs} (carried ${inn.penaltyCarried}, target ${inn.target}), SQL ${JSON.stringify(sql.get(n))}`);
    ok(`the credit, the target, the live score and the handover's count agree in every innings (${byInnings.size})`,
       bad.length === 0, bad.slice(0, 4).join("; "));
  }

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
