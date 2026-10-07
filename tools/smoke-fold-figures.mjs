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
 *   keeper_dismissal            the keeper's catches and stumpings, per innings and keeper
 *   player_keeping_career       matches and innings kept, catches, stumpings  per keeper
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
 * And the wicket-keeper (SCRBRD-126, db/68): keepers named at the start of
 * most generated innings, the gloves changing hands now and then (mid-over
 * too, and once in a while named and undone), catches credited to the
 * keeper by his id or his name and to other fielders, stumpings by the
 * keeper named or by nobody; and an innings written out (keeperEdge). What
 * the fold credits each keeper with is what keeper_dismissal and
 * player_keeping_career say, and every stumping is one the Laws take.
 *
 * And an innings from a paper scorebook (SCRBRD-120, db/64): two cards
 * written as scorebook_import_commit() writes them, folded, and every career
 * reader above moved by exactly the fold's line for each of our boys — a
 * figure the book did not record (balls, fours, sixes, wides, no-balls) NULL
 * for a boy with no other record, never nought; the dossier with his runs and
 * no dot; the matchups untouched; voided, all of it gone.
 *
 * And a wicket on a wide or a no-ball (Law 22.9, 21.17; db/87): stumped,
 * hit wicket, run out and obstructing off a wide; run out, hit twice and
 * obstructing off a no-ball — the striker's or the non-striker's, a run out
 * with runs and the end it fell at, a stumping off a wide on a free hit
 * saved. Every reader above counts each as the fold does.
 *
 * And the door itself: a new ball with no type, a wicket with no method, or
 * a wide or no-ball naming a way out the Law does not allow off it (db/87),
 * is refused by the database — and through the API, one event
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
  inningsStart, inningsEnd, inningsSummary, batters, bowler, ball, newEventId, retire, RETIRE_REASON, lawsRefusal,
} from "@scrbrd/scoring";
import { countsInOver, NOT_IN_OVER, keeperOf, isKeeperRef, isWicketBall } from "@scrbrd/scoring";
import { resultFromRow } from "@scrbrd/scoring";   // SCRBRD-130 R1
import { baseCard, TYPED as BOOK_TYPED } from "../packages/scoring/test/scorebook-cards.mjs";
// SCRBRD-114 phase 3a: the logs a result is proved on (result.test.mjs folds the same).
import { RESULT_LOGS, RESULT_SIDES, RESULT_NAMES, RESULT_STARTS_AT } from "../packages/scoring/test/result-logs.mjs";
// SCRBRD-130 R1: the logs rain is proved on (rain.test.mjs folds the same).
import { RAIN_LOGS, RAIN_SIDES, RAIN_NAMES, RAIN_STARTS_AT } from "../packages/scoring/test/rain-logs.mjs";

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
// Who keeps (SCRBRD-126): three of our boys and a typed name, named on the
// fielding squad so a catch can be credited to a keeper by his name.
const TYPED_KEEPER = "Y Typed-Keeper";
const KEEPERS = ["aaaaaaaa-0000-0000-0000-000000000004", "aaaaaaaa-0000-0000-0000-000000000005",
                 "bbbbbbbb-0000-0000-0000-000000000002", TYPED_KEEPER];
const KEEPER_SQUAD = KEEPERS.map((id, k) => ({ id, name: id === TYPED_KEEPER ? TYPED_KEEPER : `Keeper ${k + 1}` }));
const OTHER_FIELDER = "X Other-Fielder";
// db/43's door: a BEFORE INSERT trigger raising 23514 under these two names.
const DOOR = "ball_event_names_its_delivery";
const DOORS = ["ball_event_ball_has_type", "ball_event_wicket_has_method"];
// db/87's: a wide or a no-ball naming a way out the Law does not allow off it.
const DOOR_OFF_EXTRA = "ball_event_out_off_extra";

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
// The wicket-keeper (SCRBRD-126, db/68) draws on a seventh: keeper rows
// change no other figure, so every innings is otherwise the one it was.
let s7 = 6868;
const rnd7 = () => (s7 = (s7 * 1103515245 + 12345) % 2147483648) / 2147483648;
// A wicket on a wide or a no-ball (Law 22.9, 21.17; db/87) draws on an eighth.
let s8 = 8686;
const rnd8 = () => (s8 = (s8 * 1103515245 + 12345) % 2147483648) / 2147483648;
const OFF_WIDE = ["run_out", "stumped", "hit_wicket", "obstructing_field"];
const OFF_NO_BALL = ["run_out", "hit_twice", "obstructing_field"];
const gen = { suspensions: 0, splitOvers: 0, hurtReturns: 0, padRetires: 0, padMidOver: 0, padReturns: 0, hurtWaits: 0, hurtRefused: 0,
              consentReturns: 0, notInOver: 0, keepers: 0, keeperChanges: 0, keeperMidOver: 0, keeperUndone: 0,
              catchByRef: 0, catchByName: 0, catchOther: 0, stumpByRef: 0, stumpByName: 0, stumpNobody: 0,
              offWide: 0, offNoBall: 0 };
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
 * `keepers`: name keepers (keep()) and credit catches and stumpings
 * (SCRBRD-126) on the seventh stream.
 * @param {number} no @param {number} overs @param {{order?: string[], bowling?: string[], start?: Record<string, any>, ctx?: Record<string, any>, keepers?: boolean}} [o]
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
  // A keeper to name before the next delivery (SCRBRD-126), and whether the
  // scorer then undoes it: applied inside deliver(), just before the ball,
  // so the event an undo takes is still the ball.
  /** @type {{id: string, undo: boolean} | null} */ let pendingKeeper = null;
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
    /** The keeper from the next delivery on (SCRBRD-126); `undo`: named, then undone. */
    keep(/** @type {string} */ id, undo = false) { pendingKeeper = { id, undo }; },
    /** A delivery, stamped with who was on strike and bowling, as the pad stamps it. */
    deliver(/** @type {any} */ e) {
      if (now().bowler == null) {
        const who = suspended.size ? nextBowler() : bowling[overIdx++ % bowling.length];
        if (who == null) return null;
        push({ kind: "bowler", bowler: who });
      }
      if (pendingKeeper) {
        const before = now();
        const k = push({ kind: "keeper", keeper: pendingKeeper.id });
        if (pendingKeeper.undo) { push({ kind: "void", target: k.id }); gen.keeperUndone++; }
        else {
          if (before.keeper == null) gen.keepers++; else gen.keeperChanges++;
          if (before.balls % 6 > 0) gen.keeperMidOver++;
        }
        pendingKeeper = null;
      }
      const at = now();
      // Who took it (SCRBRD-126): a catch or a stumping, when the log names
      // nobody, is credited on the seventh stream — the keeper by his id or
      // his name, another fielder, or nobody; a stumping never another
      // fielder while a keeper is recorded (the Laws refuse it, Law 39).
      let fielder = {};
      const how = isWicketBall(e) ? normaliseDismissal(e.dismissal) : null;
      if (o.keepers && (how === "caught" || how === "stumped") && e.fielder === undefined) {
        const k = keeperOf(at);
        const r7 = rnd7();
        if (k == null) fielder = r7 < 0.5 ? { fielder: OTHER_FIELDER } : {};
        else if (r7 < 0.35) { fielder = { fielder: k.id }; if (how === "caught") gen.catchByRef++; else gen.stumpByRef++; }
        else if (r7 < 0.6) { fielder = { fielder: k.name }; if (how === "caught") gen.catchByName++; else gen.stumpByName++; }
        else if (how === "caught" && r7 < 0.85) { fielder = { fielder: OTHER_FIELDER }; gen.catchOther++; }
        else if (how === "stumped") gen.stumpNobody++;
      }
      return push({ kind: "ball", striker: at.striker, nonStriker: at.nonStriker, bowler: at.bowler, ...e, ...fielder });
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
    /**
     * A wicket on a wide or a no-ball (Law 22.9, 21.17; db/87): a method the
     * Law allows off it, the striker's or (a run out, an obstruction) the
     * non-striker's, a run out with runs completed and the end it fell at.
     */
    offExtra() {
      const at = now();
      if (at.striker == null || at.nonStriker == null) return;
      const type = rnd8() < 0.5 ? "Wd" : "Nb";
      const list = type === "Wd" ? OFF_WIDE : OFF_NO_BALL;
      const how = list[Math.floor(rnd8() * list.length)];
      const runs = how === "run_out" ? [0, 1, 1, 2][Math.floor(rnd8() * 4)] : 0;
      const ns = (how === "run_out" || how === "obstructing_field") && rnd8() < 0.5;
      const d = b.deliver({ type, value: runs, dismissal: how,
                            ...(type === "Nb" && runs > 0 && rnd8() < 0.3 ? { nbRuns: "byes" } : {}),
                            ...(ns ? { dismissed: at.nonStriker } : {}),
                            ...(runs > 0 ? { outAt: rnd8() < 0.5 ? "striker_end" : "bowler_end" } : {}) });
      if (d) { if (type === "Wd") gen.offWide++; else gen.offNoBall++; }
    },
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
  // The fielding squad names the keepers (SCRBRD-126); nothing else reads it.
  const b = builder(no, overs, { ...(start ? { start: { ...start, bowlingSquad: KEEPER_SQUAD } } : {}), keepers: true });
  if (awardFirst) b.award(false);
  // Most innings name a keeper with the first bowler, as the pad asks.
  if (rnd7() < 0.85) b.keep(KEEPERS[Math.floor(rnd7() * KEEPERS.length)]);
  let guard = 0;
  while (guard++ < 3000) {
    // The gloves change hands now and then — and once in a while the scorer
    // names a keeper and undoes it.
    if (rnd7() < 0.03) b.keep(KEEPERS[Math.floor(rnd7() * KEEPERS.length)], rnd7() < 0.2);
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
    // A wicket on a wide or a no-ball (db/87).
    if (rnd8() < 0.03) b.offExtra();
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
 * "void", and a wicket on a wide or a no-ball (db/87) "XWd|XNb:method:runs[:ns][:end]".
 * The next batter comes in after a wicket that stood.
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
    else if (k === "XWd" || k === "XNb") {
      const at = b.now();
      const [, , , who, end] = step.split(":");
      b.deliver({ type: k.slice(1), value: Number(c), dismissal: a,
                  ...(who === "ns" ? { dismissed: at.nonStriker } : {}), ...(end ? { outAt: end } : {}) });
    }
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
  [["run:1", "XWd:stumped:0", "XNb:run_out:2:ns:striker_end", "XWd:stumped:0", "run:0"], [P1, P2, P3, HIL_1XI[4]],
   "stumped off a wide; run out off a no-ball with two run; stumped off a wide on the free hit, saved (Law 22.9, 21.17)"],
  [["XWd:run_out:1:st:bowler_end", "XNb:hit_twice:0", "XWd:obstructing_field:0:ns", "XWd:hit_wicket:0"], [P1, P2, P3, HIL_1XI[4], TYPED[0]],
   "run out off a wide with a run; hit twice off a no-ball; the non-striker obstructing off a wide; hit wicket off a wide"],
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

/**
 * Rows the Laws refuse, as a table can still hold them (db/54, 4): P1 hits a
 * four; P2 is recorded retired with a W marker and the method bowled (reason
 * hurt), which the fold reads as retired hurt, not a wicket; a penalty of two
 * whose row carries a value of three, which the fold reads as two; then P3
 * comes in and P1 is bowled. The innings: 4 + 2 = 6 for 1 — the live score,
 * the handover's count and every player reader must say so.
 */
function refusedRowsEdge(/** @type {number} */ no) {
  const b = builder(no, 20, { order: [P1, P2, P3, HIL_1XI[3]], bowling: [WES_1XI[0], WES_1XI[1]],
                              start: { battingTeam: "Refused Rows XI", bowlingTeam: "Table XI" } });
  b.deliver({ type: "run", value: 4 });
  b.ev.push({ id: `ff-${++eventNo}`, innings: no, kind: "retire", batter: P2, reason: "hurt", type: "W", dismissal: "bowled" });
  b.ev.push({ id: `ff-${++eventNo}`, innings: no, kind: "penalty", runs: 2, toBattingTeam: true, value: 3 });
  b.fill();
  b.deliver({ type: "W", value: 0, dismissal: "bowled" });
  return b.ev;
}

/**
 * The wicket-keeper, written out (SCRBRD-126, db/68): Keeper 1 keeps and
 * catches one (by his name); a no-ball, and a stumping the free hit saves;
 * the gloves go to Keeper 2 mid-over; he stumps one (nobody named) and
 * catches one (by his id) and stumps another (by his name); Keeper 1
 * catches one more (not as keeper now); a catch by another fielder. Keeper
 * 1: one catch; Keeper 2: one catch, two stumpings.
 */
function keeperEdge(/** @type {number} */ no) {
  const b = builder(no, 20, { order: [P1, P2, P3, HIL_1XI[3], HIL_1XI[4], ...OTHERS], bowling: [WES_1XI[0], WES_1XI[1]],
                              start: { battingTeam: "Keeper Edge XI", bowlingTeam: "Gloves XI", bowlingSquad: KEEPER_SQUAD } });
  const [K1, K2] = KEEPER_SQUAD;
  b.keep(K1.id);
  const W = (/** @type {string} */ dismissal, /** @type {string | undefined} */ fielder) => {
    b.deliver({ type: "W", value: 0, dismissal, ...(fielder === undefined ? {} : { fielder }) });
    b.fill();
  };
  b.deliver({ type: "run", value: 1 });
  W("caught", K1.name);
  b.deliver({ type: "Nb", value: 0 });
  b.deliver({ type: "W", value: 0, dismissal: "stumped" });          // saved: the free hit
  b.keep(K2.id);                                                       // mid-over
  W("stumped");
  W("caught", K2.id);
  W("stumped", K2.name);
  W("caught", K1.name);
  W("caught", OTHER_FIELDER);
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
    /** @type {Map<string, {matches: number, innings: number, catches: number, stumpings: number}>} */ keeping: new Map(),
    /** @type {Map<string, number>} */ keeperDis: new Map(),
    totals: { runs: 0, wickets: 0, balls: 0 },
    cases: { nsRunOut: 0, nsBeforeFacing: 0, typedOut: 0, nbBoundaryOffBat: 0, nbByesToRope: 0, nbByesRun: 0, nbLegByesRun: 0,
             nbLegByesToRope: 0, nbByesOnFreeHit: 0, wideFour: 0, byeFour: 0,
             wicketWithRuns: 0, noType: 0, noMethod: 0, noMethodSaved: 0, saved: 0, voids: 0,
             offWide: 0, offNoBall: 0, offExtraSaved: 0, offExtraNs: 0 },
  };
  const oppOf = (/** @type {string} */ p) => at(e.opp, p, () => ({ innings: 0, balls: 0, runs: 0, dismissals: 0, fours: 0, sixes: 0,
                                                                  dots: 0, ballsBowled: 0, runsConceded: 0, wickets: 0 }));
  /** @type {Set<string>} */ const battedIn = new Set();
  /** @type {Set<string>} */ const facedIn = new Set();
  for (const [no, inn] of byInnings) {
    // The keepers (SCRBRD-126): his line in inn.keepers, per innings.
    for (const k of inn.keepers) {
      if (k.catches) e.keeperDis.set(`${no}|${k.id}|caught`, k.catches);
      if (k.stumpings) e.keeperDis.set(`${no}|${k.id}|stumped`, k.stumpings);
      if (!isId(k.id)) continue;
      const c = at(e.keeping, k.id, () => ({ matches: 1, innings: 0, catches: 0, stumpings: 0 }));
      c.innings++; c.catches += k.catches; c.stumpings += k.stumpings;
    }
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
      // A W, or a wicket on a wide or a no-ball (isWicketBall(), db/87).
      if (isWicketBall(x)) {
        const mode = normaliseDismissal(x.dismissal);
        if (type === "Wd" || type === "Nb") {
          if (x.freeHitSaved) e.cases.offExtraSaved++;
          else if (type === "Wd") e.cases.offWide++; else e.cases.offNoBall++;
          if (!x.freeHitSaved && (x.dismissed ?? x.strikerId) !== x.strikerId) e.cases.offExtraNs++;
        }
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
async function career(/** @type {string[]} */ players = PLAYERS) {
  /** @type {Map<string, any>} */ const bat = new Map();
  /** @type {Map<string, any>} */ const bowl = new Map();
  /** @type {Map<string, number>} */ const dismissals = new Map();
  for (const p of players) {
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
    [players])).map((r) => [r.k, Number(r.n)]));
  const wicketBy = new Map((await q(
    `select player_id || '|' || coalesce(dismissal, 'null') k, wickets n from player_wicket_breakdown where player_id = any($1)`,
    [players])).map((r) => [r.k, Number(r.n)]));
  // The lifetime views, which db/49 made one pass over the log rather than
  // one call of the functions above per player: the same figures, read
  // through the views every career screen reads.
  /** @type {Map<string, any>} */ const batView = new Map();
  /** @type {Map<string, any>} */ const bowlView = new Map();
  /** @type {Map<string, number>} */ const dismissalsView = new Map();
  for (const r of await q(`select * from player_batting_career where player_id = any($1)`, [players])) {
    batView.set(r.player_id, { matches: Number(r.matches), runs: Number(r.runs), balls: Number(r.balls_faced),
                               fours: Number(r.fours), sixes: Number(r.sixes) });
  }
  for (const r of await q(`select * from player_bowling_career where player_id = any($1)`, [players])) {
    bowlView.set(r.player_id, { runs: Number(r.runs_conceded), balls: Number(r.legal_balls), wides: Number(r.wides),
                                noBalls: Number(r.no_balls), wickets: Number(r.wickets) });
  }
  for (const r of await q(`select * from player_dismissals where player_id = any($1)`, [players])) {
    dismissalsView.set(r.player_id, Number(r.dismissals));
  }
  // The keeping (SCRBRD-126, db/68).
  /** @type {Map<string, any>} */ const keeping = new Map();
  for (const r of await q(`select * from player_keeping_career where player_id = any($1)`, [players])) {
    keeping.set(r.player_id, { matches: Number(r.matches), innings: Number(r.innings_kept), catches: Number(r.catches),
                               stumpings: Number(r.stumpings) });
  }
  return { bat, bowl, dismissals, dismissalBy, wicketBy, batView, bowlView, dismissalsView, keeping };
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
      ballsBowled: r.balls_bowled, runsConceded: r.runs_conceded, wickets: r.wickets,
      strikeRate: r.strike_rate, dotPct: r.dot_pct }]));
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

  // UNDER A COMPETITION'S PLAYING CONDITIONS (SCRBRD-114, db/61): the match's
  // frozen document decides the free hit, not its format — a T20 whose
  // league says no free hit, and a declaration match whose league says one.
  // Written before the careers are read, like DECL, so no delta moves. The
  // documents are written as the owner, as the fix would have written them.
  const CONDITIONED = [];
  for (const [format, overs, free] of /** @type {const} */ ([["T20", 20, false], ["One-Day Declaration", 100, true]])) {
    const id = (await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                         values ($1, '1XI', $2, now() - interval '2 days', $3, $4, 'complete') returning id`,
                       [HIL, `Conditions XI (${format})`, format, overs]))[0].id;
    const doc = { v: 1, play: { "format.free_hit": free }, table: {}, sheet: {} };
    const [{ doc_hash }] = await q(`insert into match_conditions (match_id, doc, sources, doc_hash) values ($1, $2, '{}', '') returning doc_hash`,
                                   [id, JSON.stringify(doc)]);
    const ctx = { format, conditions: doc.play, conditionsHash: doc_hash };
    const log = scripted(0, ["run:1", "Nb:0", "W:bowled", "Nb:1", "W:lbw", "run:0", "Nb:0", "Wd:0", "W:caught",
                             "Nb:0", "RO:ns:0", "Nb:2:byes", "run:4", "Nb:0", "W:bowled"],
                         [P1, P2, P3, HIL_1XI[3], HIL_1XI[4], ...OTHERS], ctx);
    await writeLogs([log], scorer, id);
    CONDITIONED.push({ id, format, free, ctx });
  }

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
  no++;
  const refusedNo = no;
  edgeInnings.push({ no, what: "rows the Laws refuse: a retire marked W with the method bowled, a penalty row carrying a value" });
  logs.push(refusedRowsEdge(no));
  no++;
  const keeperNo = no;
  edgeInnings.push({ no, what: "the wicket-keeper: named, his catch by name, a free hit's saved stumping, the gloves changed mid-over" });
  logs.push(keeperEdge(no));
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
              `${c.byeFour} byes worth four; ${c.voids} voids; wickets on a wide ${c.offWide}, on a no-ball ${c.offNoBall} ` +
              `(${c.offExtraNs} of the non-striker, ${c.offExtraSaved} saved by a free hit)`);
  // Not vacuous: the logs hold every case db/43 is about.
  ok(`...run outs at the non-striker's end (${c.nsRunOut}), before he faced (${c.nsBeforeFacing})`, c.nsRunOut >= 20 && c.nsBeforeFacing >= 3);
  ok(`...a typed name run out at the other end (${c.typedOut})`, c.typedOut >= 1);
  ok(`...no-ball boundaries off the bat (${c.nbBoundaryOffBat}) and byes to the rope (${c.nbByesToRope})`, c.nbBoundaryOffBat >= 5 && c.nbByesToRope >= 5);
  ok(`...no-ball byes run (${c.nbByesRun}), leg byes run (${c.nbLegByesRun}) and to the rope (${c.nbLegByesToRope}), on a free hit (${c.nbByesOnFreeHit})`,
     c.nbByesRun >= 5 && c.nbLegByesRun >= 5 && c.nbLegByesToRope >= 3 && c.nbByesOnFreeHit >= 3);
  ok(`...wides worth four (${c.wideFour}), byes worth four (${c.byeFour})`, c.wideFour >= 5 && c.byeFour >= 5);
  // db/87: wickets on wides (stumped, hit wicket, run out, obstructing) and
  // no-balls (run out, hit twice, obstructing) — some of the batter at the
  // other end, some saved by a free hit (a stumping off a wide on one).
  ok(`...wickets on a wide (${c.offWide}) and a no-ball (${c.offNoBall}), ${c.offExtraNs} of the non-striker, ${c.offExtraSaved} saved by a free hit (${gen.offWide} + ${gen.offNoBall} generated)`,
     c.offWide >= 5 && c.offNoBall >= 5 && c.offExtraNs >= 2);
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
  // SCRBRD-114 phase 3a (db/69): what a result is read from — each innings'
  // ending (a seal that stands, or the Laws' own), its overs and target after
  // revisions and awards, and the 4th Edition's penalty-runs win — is the
  // fold's, over every generated innings.
  const stateBad = [];
  for (const [n, f] of byInnings) {
    const [s] = await q(`select * from innings_result_state($1, $2::smallint, '{}'::jsonb, $3)`, [MATCH, n, f.lawsEdition === 4]);
    const a = [f.runs, f.wickets, f.balls, f.overs, f.target, f.complete, f.endReason, f.penaltyWin].join("/");
    const b = [s.runs, s.wickets, s.balls, s.overs, s.target, s.complete, s.end_reason, s.penalty_win].join("/");
    if (a !== b) stateBad.push(`innings ${n}: fold ${a}, SQL ${b}`);
  }
  const ended = [...byInnings.values()].filter((f) => f.complete);
  ok(`each innings' ending, overs and target agree (${byInnings.size}; ${ended.length} over, ${ended.filter((f) => f.sealed).length} sealed): `
     + "innings_result_state() is the fold (db/69)", stateBad.length === 0 && ended.length > 0, show(stateBad));

  const refused = byInnings.get(refusedNo);
  const refusedLive = live.get(refusedNo);
  ok("rows the Laws refuse (db/54, 4): the fold reads 6 for 1, P2 retired hurt — and so does the live score",
     refused?.runs === 6 && refused.wickets === 1
     && refused.batsmen.find((/** @type {any} */ x) => x.id === P2)?.dismissal === "retired hurt"
     && Number(refusedLive?.runs) === 6 && Number(refusedLive?.wickets) === 1,
     `fold ${refused?.runs}/${refused?.wickets}, SQL ${refusedLive?.runs}/${refusedLive?.wickets}`);

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

  group("Under a competition's conditions: the document's free hit, both ways round (SCRBRD-114, db/61)");
  for (const c of CONDITIONED) {
    const rows = await q(`select * from ball_event where match_id = $1 order by seq`, [c.id]);
    const fold = new MatchFold(rows.map(fromRow), c.ctx).view().innings[0];
    const byFormat = new MatchFold(rows.map(fromRow), { format: c.format }).view().innings[0];
    const label = `${c.format} under free_hit = ${c.free}`;
    console.log(`  ${label}: the fold ${fold.runs}/${fold.wickets} off ${fold.balls}; by its format alone ${byFormat.runs}/${byFormat.wickets}`);
    ok(`${label}: not vacuous — the document and the format disagree on the wickets`, fold.wickets !== byFormat.wickets
       && fold.freeHits === c.free && fold.conditionsHash === c.ctx.conditionsHash);
    const [live] = await q(`select runs, wickets, legal_balls from match_live_score where match_id = $1 and innings = 0`, [c.id]);
    ok(`${label}: match_live_score is the fold`, Number(live.runs) === fold.runs && Number(live.wickets) === fold.wickets
       && Number(live.legal_balls) === fold.balls, JSON.stringify(live));
    const [folded] = await q(`select * from innings_score_as_folded($1, 0::smallint)`, [c.id]);
    ok(`${label}: innings_score_as_folded() is the fold`, folded.runs === fold.runs && folded.wickets === fold.wickets
       && folded.legal_balls === fold.balls, JSON.stringify(folded));
    const overs = new Map((await q(`select bowler_id, sum(legal_balls)::int n from bowler_over where match_id = $1 group by bowler_id`, [c.id]))
      .map((r) => [r.bowler_id, r.n]));
    const obad = fold.bowlers.filter((w) => isId(w.id) && (overs.get(w.id) ?? 0) !== w.balls).map((w) => `${w.id}: fold ${w.balls}, SQL ${overs.get(w.id)}`);
    ok(`${label}: bowler_over holds each bowler's balls of the over as the fold does`, obad.length === 0 && overs.size > 0, show(obad));
    const figs = new Map((await q(`select player_id, wickets, runs_conceded from bowler_innings_figures where match_id = $1`, [c.id]))
      .map((r) => [r.player_id, { wickets: Number(r.wickets), runs: Number(r.runs_conceded) }]));
    const fbad = fieldDifferences(new Map(fold.bowlers.filter((w) => isId(w.id)).map((w) => [w.id, { wickets: w.wickets, runs: w.runs }])), figs, ["wickets", "runs"]);
    ok(`${label}: bowler_innings_figures: the wickets after a no-ball are the document's`, fbad.length === 0, show(fbad));
    const [fh] = await q(`select count(*) filter (where ball_on_free_hit(match_id, innings, seq))::int n from ball_event where match_id = $1`, [c.id]);
    ok(`${label}: ball_on_free_hit() ${c.free ? "finds the free hits" : "finds none"}`, c.free ? fh.n > 0 : fh.n === 0);
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

  group("The wicket-keeper: keeper_dismissal and player_keeping_career are the fold (SCRBRD-126, db/68)");
  {
    const keeperRows = rows.filter((r) => r.kind === "keeper");
    const kept = [...byInnings.values()].reduce((n, inn) => n + inn.keepers.length, 0);
    console.log(`  ${keeperRows.length} keeper rows (${gen.keepers} named first, ${gen.keeperChanges} changes, ${gen.keeperMidOver} mid-over, ` +
                `${gen.keeperUndone} undone); catches credited by id ${gen.catchByRef}, by name ${gen.catchByName}, to another ${gen.catchOther}; ` +
                `stumpings by id ${gen.stumpByRef}, by name ${gen.stumpByName}, by nobody ${gen.stumpNobody}`);
    ok(`...not vacuous: keepers named (${gen.keepers}), changed (${gen.keeperChanges}, ${gen.keeperMidOver} mid-over), undone (${gen.keeperUndone})`,
       gen.keepers >= 10 && gen.keeperChanges >= 5 && gen.keeperMidOver >= 3 && gen.keeperUndone >= 1 && kept >= gen.keepers);
    // The generator's own draws, few (a wicket by a bowler's method is one
    // ball in twenty); the written-out innings has each case for certain.
    ok(`...catches credited to the keeper by id (${gen.catchByRef}) and by name (${gen.catchByName}), and to another (${gen.catchOther})`,
       gen.catchByRef >= 1 && gen.catchByName >= 1 && gen.catchOther >= 1);
    ok(`...stumpings by the keeper by id (${gen.stumpByRef}) and by name (${gen.stumpByName})`,
       gen.stumpByRef >= 1 && gen.stumpByName >= 1);
    ok("...and a typed keeper with a dismissal", [...e.keeperDis.keys()].some((k) => k.includes(TYPED_KEEPER)));
    // Every stumping in these logs is one the Laws take (Law 39): credited
    // to the keeper at that ball, or to nobody, or made with no keeper on
    // the record — the rule laws.mjs applies, asked of the fold at each
    // one's own point in its log. (The whole-match Laws would refuse many of
    // these balls for other reasons: the generator plays on past a chase
    // won.) db/68's door, which asks the same of every row, let each in.
    /** @type {string[]} */ const lawless = [];
    let judged = 0, withKeeper = 0, nobody = 0;
    for (const log of logs) {
      for (let k = 0; k < log.length; k++) {
        const x = log[k];
        if (x.kind !== "ball" || x.type !== "W" || normaliseDismissal(x.dismissal) !== "stumped") continue;
        judged++;
        const keeper = keeperOf(deriveInnings(log.slice(0, k)));
        if (keeper) withKeeper++;
        if (keeper && !x.fielder) nobody++;
        if (keeper && x.fielder && !isKeeperRef(keeper.id, keeper.name, x.fielder)) lawless.push(`${x.id}: ${x.fielder} while ${keeper.id} kept`);
      }
    }
    ok(`every stumping (${judged}; ${withKeeper} with a keeper recorded, ${nobody} naming nobody) is the keeper's`,
       lawless.length === 0 && withKeeper >= 5 && nobody >= 1, show(lawless));
    const wantEdge = byInnings.get(keeperNo)?.keepers.map((/** @type {any} */ k) => `${k.name}:${k.catches}/${k.stumpings}`).join(" ");
    ok("the written-out case: Keeper 1 one catch, Keeper 2 one catch and two stumpings", wantEdge === "Keeper 1:1/0 Keeper 2:1/2", wantEdge);
    const gotDis = new Map((await q(`select innings, keeper_ref, dismissal, count(*)::int n from keeper_dismissal where match_id = $1
                                      group by innings, keeper_ref, dismissal`, [MATCH]))
      .map((r) => [`${r.innings}|${r.keeper_ref}|${r.dismissal}`, r.n]));
    const disBad = differences(e.keeperDis, gotDis);
    ok(`keeper_dismissal: every keeper's catches and stumpings in every innings (${e.keeperDis.size})`, disBad.length === 0 && e.keeperDis.size >= 10,
       show(disBad));
    const keepD = deltas(car0.keeping, car1.keeping, ["matches", "innings", "catches", "stumpings"]);
    const wantKeep = new Map(PLAYERS.map((p) => [p, e.keeping.get(p) ?? {}]));
    for (const f of ["matches", "innings", "catches", "stumpings"]) {
      const bad = fieldDifferences(wantKeep, keepD, [f]);
      ok(`player_keeping_career ${f}, per keeper`, bad.length === 0, show(bad));
    }
  }

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

  group("A summarised innings (SCRBRD-120, db/64): the book's figures are the fold's, in every career reader");
  {
    // Two boys whose only record will be the book's, and five of the 1XI
    // who have one already. A fixture of its own, complete, as the import's
    // commit leaves it; our innings and theirs, each start → summary → end
    // as scorebook_import_commit() writes them (db/63), the summary through
    // the door as the commit alone may (the owner, naming the import).
    const BOOK_BAT = "aaaaaaaa-0000-0000-0000-0000000064f1";   // run out 25, the book has no balls column for him
    const BOOK_BOWL = "aaaaaaaa-0000-0000-0000-0000000064f2";  // 4-0-30-2, no wides or no-balls on the book
    const WATCH = [...PLAYERS, BOOK_BAT, BOOK_BOWL];
    await q(`insert into player (id, school_id, team_code, full_name, born)
             values ($1, $3, '1XI', 'Book Batter', '2009-02-01'), ($2, $3, '1XI', 'Book Bowler', '2009-02-01')`, [BOOK_BAT, BOOK_BOWL, HIL]);
    const SUMM = (await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                           values ($1, '1XI', 'Book XI', now() - interval '20 days', 'T20', 20, 'complete') returning id`, [HIL]))[0].id;
    const imp = crypto.randomUUID();
    const TYPED_BOOK = { ...BOOK_TYPED, "t:6": "Opp Six", "t:7": "Opp Seven", "t:8": "Opp Eight", "t:9": "Opp Nine" };
    const cards = [
      baseCard([HIL_1XI[0], HIL_1XI[1], HIL_1XI[2], BOOK_BAT, HIL_1XI[3], HIL_1XI[4]]),
      { v: 1, innings: 1, battingSide: "away",
        batting: [
          { order: 1, ref: "t:6", howOut: "bowled",  fielderRef: null,     bowlerRef: BOOK_BOWL,  runs: 20, balls: 18,   fours: 2,    sixes: 0 },
          { order: 2, ref: "t:7", howOut: "caught",  fielderRef: BOOK_BAT, bowlerRef: HIL_1XI[1], runs: 15, balls: null, fours: null, sixes: null },
          { order: 3, ref: "t:8", howOut: "lbw",     fielderRef: null,     bowlerRef: BOOK_BOWL,  runs: 10, balls: null, fours: null, sixes: null },
          { order: 4, ref: "t:9", howOut: "not_out", fielderRef: null,     bowlerRef: null,       runs: 8,  balls: null, fours: null, sixes: null },
        ],
        didNotBat: [],
        bowling: [
          { ref: BOOK_BOWL,  overs: "4",   maidens: null, runs: 30, wickets: 2, wides: null, noBalls: null },
          { ref: HIL_1XI[1], overs: "3.2", maidens: 0,    runs: 24, wickets: 1, wides: 1,    noBalls: 0 },
        ],
        extras: { byes: 2, legByes: 0, wides: 1, noBalls: 0, penalty: 0 },
        total: 56, wickets: 3, overs: "7.2",
        fallOfWickets: [{ wicket: 1, score: 20, ref: "t:6", over: "3.1" }, { wicket: 2, score: 38, ref: "t:7", over: "5" },
                        { wicket: 3, score: 50, ref: "t:8", over: "6.4" }],
        endReason: "time", unreconciled: null },
    ];
    const [recon] = await q(`select summary_reconciles($1::jsonb, $3::jsonb, 'home') a, summary_reconciles($2::jsonb, $3::jsonb, 'home') b`,
      [JSON.stringify(cards[0]), JSON.stringify(cards[1]), JSON.stringify(TYPED_BOOK)]);
    ok("both cards are cards the commit would take (summary_reconciles(), db/63)", recon.a.length === 0 && recon.b.length === 0,
       JSON.stringify(recon));
    const source = { kind: "scorebook", import: imp, checkedBy: scorer, confirmedBy: scorer };
    /** @type {{ev: any, device: string}[]} */
    const evs = [];
    cards.forEach((card, k) => {
      const sides = k === 0 ? { battingTeam: "Hilton 1XI", bowlingTeam: "Book XI" } : { battingTeam: "Book XI", bowlingTeam: "Hilton 1XI" };
      const key = (/** @type {string} */ part) => `scorebook:${imp}:${k}:${part}`;
      evs.push({ ev: { ...inningsStart({ ...sides, overs: 20 }), innings: k, id: key("start"), source }, device: "device-fold-figures" });
      evs.push({ ev: { ...inningsSummary({ card, typed: TYPED_BOOK, source }), innings: k, id: key("summary") }, device: `scorebook:${imp}` });
      evs.push({ ev: { ...inningsEnd({ reason: k === 0 ? "overs_complete" : "time",
                                       confirmed: { runs: card.total, wickets: card.wickets, balls: k === 0 ? 120 : 44 } }),
                       innings: k, id: key("end"), source }, device: "device-fold-figures" });
    });
    /** Rows as the owner, the summary through the commit's door; or a void of each summary. @param {{ev: any, device: string}[]} list */
    const writeSumm = async (list) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT set_config('scrbrd.scorebook_commit', $1, true)", [imp]);
        let seq = Number((await c.query(`select coalesce(max(seq), 0) n from ball_event where match_id = $1`, [SUMM])).rows[0].n);
        for (const { ev, device } of list) {
          const r = toRow(ev);
          seq++;
          await c.query(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                                 client_seq, client_ts, kind, payload)
                         values ($1, $2, $3, 1, $4, $5, $6, $7, $3, $8, $9, $10)`,
            [SUMM, HIL, seq, r.innings, scorer, device, ev.id, r.client_ts, r.kind, JSON.stringify(r.payload)]);
        }
        await c.query("COMMIT");
      } catch (err) { await c.query("ROLLBACK").catch(() => {}); throw err; } finally { c.release(); }
    };

    const carS0 = await career(WATCH);
    const oppS0 = await opposition(WES, HIL, "coach.wes@example.invalid");
    const muS0 = coach ? await matchups(coach) : new Map();
    await writeSumm(evs);

    // The fold, over the rows as the database holds them, as the server reads them.
    const srows = await q(`select * from ball_event where match_id = $1 order by seq`, [SUMM]);
    const sfold = new MatchFold(srows.map(fromRow)).view().innings;
    ok("the fold reads both innings from the book: 127/4 and 56/3", sfold.length === 2 && sfold.every((i) => i.summarised != null)
       && sfold[0].runs === 127 && sfold[0].wickets === 4 && sfold[1].runs === 56 && sfold[1].wickets === 3,
       JSON.stringify(sfold.map((i) => [i.runs, i.wickets, i.summarised?.import])));

    // What each reader must say: the fold's line for each of our boys; the
    // method of a dismissal is the card's, which the fold's line names in words.
    // A figure the book did not record adds nothing (D12).
    const plus = (/** @type {number|null} */ a, /** @type {number|null} */ b) => (b == null ? a : (a ?? 0) + b);
    /** @type {Map<string, any>} */ const wInn = new Map();
    /** @type {Map<string, any>} */ const wBat = new Map();
    /** @type {Map<string, any>} */ const wBowl = new Map();
    /** @type {Map<string, any>} */ const wFig = new Map();
    /** @type {Map<string, any>} */ const wOpp = new Map();
    /** @type {Map<string, number>} */ const wOut = new Map();
    /** @type {Map<string, number>} */ const wOutBy = new Map();
    /** @type {Map<string, number>} */ const wWktBy = new Map();
    const oppOf = (/** @type {string} */ p) => at(wOpp, p, () => ({ innings: 0, balls: null, runs: 0, dismissals: 0, fours: null, sixes: null,
                                                                   dots: 0, ballsBowled: 0, runsConceded: 0, wickets: 0 }));
    sfold.forEach((inn, no) => {
      const card = cards[no];
      for (const b of inn.batsmen) {
        if (!isId(b.id)) continue;
        const how = card.batting.find((r) => r.ref === b.id)?.howOut;
        const out = b.status === "out";
        wInn.set(`${b.id}|${no}`, { runs: b.runs, balls: b.balls, out });
        const c = at(wBat, b.id, () => ({ matches: 1, runs: 0, balls: null, fours: null, sixes: null }));
        c.runs += b.runs; c.balls = plus(c.balls, b.balls); c.fours = plus(c.fours, b.fours); c.sixes = plus(c.sixes, b.sixes);
        if (out) { bump(wOut, b.id); bump(wOutBy, `${b.id}|${how}`); }
        const o = oppOf(b.id);
        o.innings = 1; o.runs += b.runs; o.balls = plus(o.balls, b.balls); o.fours = plus(o.fours, b.fours); o.sixes = plus(o.sixes, b.sixes);
        if (chargedToBowler(how)) o.dismissals++;
      }
      for (const r of card.batting) if (chargedToBowler(r.howOut) && isId(r.bowlerRef)) bump(wWktBy, `${r.bowlerRef}|${r.howOut}`);
      for (const w of inn.bowlers) {
        if (!isId(w.id)) continue;
        const c = at(wBowl, w.id, () => ({ runs: 0, balls: 0, wides: null, noBalls: null, wickets: 0 }));
        c.runs += w.runs; c.balls += w.balls; c.wides = plus(c.wides, w.wides); c.noBalls = plus(c.noBalls, w.noBalls); c.wickets += w.wickets;
        wFig.set(`${w.id}|${no}`, { wickets: w.wickets, runs: w.runs });
        const o = oppOf(w.id); o.ballsBowled += w.balls; o.runsConceded += w.runs; o.wickets += w.wickets;
      }
    });
    ok("...and it holds what this group is about: a batter with no balls, a bowler with no extras, a typed name on each side",
       wBat.get(BOOK_BAT)?.balls === null && wBowl.get(BOOK_BOWL)?.wides === null
       && sfold[0].bowlers.some((w) => !isId(w.id)) && sfold[1].batsmen.every((b) => !isId(b.id)));

    // player_innings: every batting row of our boys, figure for figure, NULL included.
    const sInn = new Map((await q(`select player_id, innings, runs, balls_faced, out from player_innings where match_id = $1`, [SUMM]))
      .map((r) => [`${r.player_id}|${r.innings}`, { runs: Number(r.runs), balls: r.balls_faced == null ? null : Number(r.balls_faced), out: r.out }]));
    const innBad = [...new Set([...wInn.keys(), ...sInn.keys()])]
      .filter((k) => JSON.stringify(wInn.get(k)) !== JSON.stringify(sInn.get(k)))
      .map((k) => `${k}: fold ${JSON.stringify(wInn.get(k))}, SQL ${JSON.stringify(sInn.get(k))}`);
    ok(`player_innings is the fold's line for each of our boys, and nobody typed (${wInn.size})`, innBad.length === 0 && wInn.size === 6, show(innBad));
    const [live] = await q(`select string_agg(format('%s/%s/%s', runs, wickets, legal_balls), ' ' order by innings) s
                              from match_live_score where match_id = $1`, [SUMM]);
    ok("match_live_score is the fold's, both innings", live.s === sfold.map((i) => `${i.runs}/${i.wickets}/${i.balls}`).join(" "), live.s);

    // The careers: what moved is the fold's line (a figure not recorded moved nothing)...
    const carS1 = await career(WATCH);
    const zeroed = (/** @type {Map<string, any>} */ m) => new Map(WATCH.map((p) => [p, Object.fromEntries(
      Object.entries(m.get(p) ?? {}).map(([k, v]) => [k, v ?? 0]))]));
    const BAT_F = ["matches", "runs", "balls", "fours", "sixes"], BOWL_F = ["runs", "balls", "wides", "noBalls", "wickets"];
    const sBad = [
      ...fieldDifferences(zeroed(wBat), deltas(carS0.bat, carS1.bat, BAT_F), BAT_F).map((x) => `player_batting_since ${x}`),
      ...fieldDifferences(zeroed(wBat), deltas(carS0.batView, carS1.batView, BAT_F), BAT_F).map((x) => `player_batting_career ${x}`),
      ...fieldDifferences(zeroed(wBowl), deltas(carS0.bowl, carS1.bowl, BOWL_F), BOWL_F).map((x) => `player_bowling_since ${x}`),
      ...fieldDifferences(zeroed(wBowl), deltas(carS0.bowlView, carS1.bowlView, BOWL_F), BOWL_F).map((x) => `player_bowling_career ${x}`),
      ...differences(wOut, delta(carS0.dismissals, carS1.dismissals)).map((x) => `player_dismissals_since ${x}`),
      ...differences(wOut, delta(carS0.dismissalsView, carS1.dismissalsView)).map((x) => `player_dismissals ${x}`),
      ...differences(wOutBy, delta(carS0.dismissalBy, carS1.dismissalBy)).map((x) => `player_dismissal_breakdown ${x}`),
      ...differences(wWktBy, delta(carS0.wicketBy, carS1.wicketBy)).map((x) => `player_wicket_breakdown ${x}`),
    ];
    ok("every career reader moved by the fold's line for each boy, and no other", sBad.length === 0, show(sBad));
    // ...the two boys with no other record read it exactly, NULL where the book has none...
    const exact = await q(`select 'bat' f, row(c.matches, c.runs, c.balls_faced, c.fours, c.sixes)::text v from player_batting_career c where c.player_id = $1
                           union all select 'batfn', row(c.matches, c.runs, c.balls_faced, c.fours, c.sixes)::text from player_batting_since($1, null) c
                           union all select 'bowl', row(c.runs_conceded, c.legal_balls, c.wides, c.no_balls, c.wickets)::text from player_bowling_career c where c.player_id = $2
                           union all select 'bowlfn', row(c.runs_conceded, c.legal_balls, c.wides, c.no_balls, c.wickets)::text from player_bowling_since($2, null) c
                           union all select 'fig', row(f.wickets, f.runs_conceded)::text from bowler_innings_figures f where f.player_id = $2`, [BOOK_BAT, BOOK_BOWL]);
    const csv = (/** @type {any[]} */ xs) => `(${xs.map((x) => x ?? "").join(",")})`;
    const wb = wBat.get(BOOK_BAT), ww = wBowl.get(BOOK_BOWL), wf = wFig.get(`${BOOK_BOWL}|1`);
    const want = { bat: csv([1, wb.runs, wb.balls, wb.fours, wb.sixes]), batfn: csv([1, wb.runs, wb.balls, wb.fours, wb.sixes]),
                   bowl: csv([ww.runs, ww.balls, ww.wides, ww.noBalls, ww.wickets]), bowlfn: csv([ww.runs, ww.balls, ww.wides, ww.noBalls, ww.wickets]),
                   fig: csv([wf.wickets, wf.runs]) };
    const exactBad = exact.filter((r) => want[/** @type {keyof typeof want} */ (r.f)] !== r.v)
      .map((r) => `${r.f}: fold ${want[/** @type {keyof typeof want} */ (r.f)]}, SQL ${r.v}`);
    ok(`a boy whose only innings is the book's reads the fold's line exactly: ${want.bat} batting, ${want.bowl} bowling (NULL where unrecorded)`,
       exact.length === 5 && exactBad.length === 0, show(exactBad));
    // ...and the views are the functions, before and after.
    for (const [when, car] of /** @type {[string, any][]} */ ([["before the book", carS0], ["after it", carS1]])) {
      const bad = [...fieldDifferences(car.bat, car.batView, BAT_F), ...fieldDifferences(car.bowl, car.bowlView, BOWL_F),
                   ...differences(car.dismissals, car.dismissalsView)];
      ok(`the three lifetime views are the three functions, ${when}`, bad.length === 0, show(bad));
    }
    const sFig = new Map((await q(`select player_id, innings, wickets, runs_conceded from bowler_innings_figures where match_id = $1`, [SUMM]))
      .map((r) => [`${r.player_id}|${r.innings}`, { wickets: Number(r.wickets), runs: Number(r.runs_conceded) }]));
    const figB = fieldDifferences(wFig, sFig, ["wickets", "runs"]);
    ok(`bowler_innings_figures is the fold's for each of our bowlers (${wFig.size})`, figB.length === 0 && sFig.size === wFig.size, show(figB));

    // The opposition's dossier on Hilton, as Westville's coach: the book's
    // runs, balls where recorded, the bowler's dismissals; no dots, ever.
    const oppS1 = await opposition(WES, HIL, "coach.wes@example.invalid");
    const oppSquad = [...HIL_1XI, BOOK_BAT, BOOK_BOWL];
    const oppGot = deltas(new Map(oppSquad.map((p) => [p, oppS0.get(p)])), new Map(oppSquad.map((p) => [p, oppS1.get(p)])), OPP_FIELDS);
    const oppBad = OPP_FIELDS.flatMap((f) => fieldDifferences(new Map(oppSquad.map((p) => [p, Object.fromEntries(
      Object.entries(wOpp.get(p) ?? {}).map(([k, v]) => [k, v ?? 0]))])), oppGot, [f]));
    ok("opposition_squad(): what moved is the fold's line, and not one dot", oppBad.length === 0, show(oppBad));
    const bb = oppS1.get(BOOK_BAT);
    ok("...and the boy whose only innings is the book's: his runs, no balls, no boundaries, no dots, no strike rate, no dot percentage",
       bb?.runs === 25 && bb.innings === 1 && bb.balls === null && bb.fours === null && bb.sixes === null
       && bb.dots === null && bb.strikeRate === null && bb.dotPct === null, JSON.stringify(bb));
    const unmoved = HIL_1XI.filter((p) => String(oppS0.get(p)?.dotPct) !== String(oppS1.get(p)?.dotPct));
    ok("...and no boy's dot percentage moved for a book innings", unmoved.length === 0, unmoved.join(","));
    const muS1 = coach ? await matchups(coach) : new Map();
    ok("the matchups read has nothing from the book", JSON.stringify([...muS0]) === JSON.stringify([...muS1]));

    // Voided by an approved amendment (as scoring_amendment_decide() writes
    // the void), the book is in no reader: every figure back where it stood.
    await writeSumm([0, 1].map((k) => ({ ev: { kind: "void", innings: k, id: `ff-void-summary-${k}`, target: `scorebook:${imp}:${k}:summary` },
                                        device: "amendment" })));
    const carS2 = await career(WATCH);
    const back = [
      ...fieldDifferences(carS0.bat, carS2.bat, BAT_F), ...fieldDifferences(carS0.batView, carS2.batView, BAT_F),
      ...fieldDifferences(carS0.bowl, carS2.bowl, BOWL_F), ...fieldDifferences(carS0.bowlView, carS2.bowlView, BOWL_F),
      ...differences(carS0.dismissals, carS2.dismissals), ...differences(carS0.dismissalsView, carS2.dismissalsView),
      ...differences(carS0.dismissalBy, carS2.dismissalBy), ...differences(carS0.wicketBy, carS2.wicketBy),
    ];
    const [left] = await q(`select (select count(*) from player_innings where match_id = $1) + (select count(*) from bowler_innings_figures where match_id = $1)
                                 + (select count(*) from player_batting_career where player_id = any($2)) + (select count(*) from player_bowling_career where player_id = any($2))
                                 + (select count(*) from player_unrecorded_figures where player_id = any($2)) n`, [SUMM, [BOOK_BAT, BOOK_BOWL]]);
    const oppS2 = await opposition(WES, HIL, "coach.wes@example.invalid");
    const oppBack = OPP_FIELDS.flatMap((f) => fieldDifferences(new Map(oppSquad.map((p) => [p, oppS0.get(p)])), new Map(oppSquad.map((p) => [p, oppS2.get(p)])), [f]));
    ok("voided, the book is in no career reader and no dossier: every figure is what it was",
       back.length === 0 && Number(left.n) === 0 && oppBack.length === 0, show([...back, ...oppBack, `${left.n} rows left`]));
  }

  // ── SCRBRD-114 phase 3a (db/69): a match's result, both ways ──────────
  // Every log of result-logs.mjs written as toRow() writes it (a scorebook
  // card through the commit's door), its frozen play part and its decision
  // beside it; folded from the rows read back, as the server folds; and SQL's
  // match_result() held to the fold — the outcome, the margin, who won and
  // who decided, and each innings' figures, ending, overs and target — and
  // both to what the design says the log is.
  group(`The result (SCRBRD-114 phase 3a, db/69; the super over, 3b, db/71): match_result() is describeResult(), over ${RESULT_LOGS.length} logs`);
  for (const x of RESULT_LOGS) {
    const [{ id: rm }] = await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                                  values ($1, $2, $3, $4, 'T20', 20, $5) returning id`,
      [HIL, RESULT_SIDES.home, RESULT_SIDES.away, RESULT_STARTS_AT, x.status]);
    if (x.play) {
      await q(`insert into match_conditions (match_id, doc, sources, doc_hash) values ($1, $2, '{}', '')`,
        [rm, JSON.stringify({ v: 1, play: x.play, table: {}, sheet: {} })]);
    }
    const imp = crypto.randomUUID();
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('scrbrd.scorebook_commit', $1, true)", [imp]);
      let seq = 0;
      for (const ev of x.log) {
        const book = ev.kind === "innings_summary";
        const r = toRow(book ? { ...ev, source: { kind: "scorebook", import: imp } } : ev);
        seq++;
        await c.query(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                               client_seq, client_ts, kind, ball_type, value, striker_id, non_striker_id, bowler_id,
                                               dismissed_id, dismissal, payload)
                       values ($1, $2, $3, 1, $4, $5, $6, $7, $3, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [rm, HIL, seq, r.innings, scorer, book ? `scorebook:${imp}` : "device-fold-figures", `${rm}:${ev.id}`, r.client_ts, r.kind,
           r.ball_type, r.value, r.striker_id, r.non_striker_id, r.bowler_id, r.dismissed_id, r.dismissal ?? null, JSON.stringify(r.payload)]);
      }
      if (x.decision) {
        await c.query(`insert into match_result_decision (match_id, kind, side, reason, overrides_play, decided_by) values ($1, $2, $3, $4, $5, $6)`,
          [rm, x.decision.kind, x.decision.side, x.decision.reason, x.decision.overridesPlay === true, scorer]);
      }
      await c.query("COMMIT");
    } catch (err) { await c.query("ROLLBACK").catch(() => {}); throw err; } finally { c.release(); }

    const back = await q(`select * from ball_event where match_id = $1 order by seq`, [rm]);
    const folded = deriveMatch(back.map(fromRow), {
      startsAt: RESULT_STARTS_AT, conditions: x.play ?? undefined, status: x.status,
      sides: RESULT_SIDES, names: RESULT_NAMES, decision: x.decision,
    });
    const [sql] = await q(`select * from match_result_compute($1)`, [rm]);
    const f = folded.result;
    const fold = f == null
      ? { outcome: "in_progress", marginKind: null, margin: null, decidedBy: null, winnerSide: null, playOutcome: "in_progress" }
      : { outcome: f.outcome, marginKind: f.marginKind, margin: f.marginValue, decidedBy: f.decidedBy, winnerSide: f.winnerSide, playOutcome: f.playOutcome };
    const said = { outcome: sql.outcome, marginKind: sql.margin_kind, margin: sql.margin, decidedBy: sql.decided_by,
                   winnerSide: sql.winner_side, playOutcome: sql.play_outcome };
    // Phase 3b (db/71): each innings' super over beside its figures, and each pair as both list it.
    const inn = folded.innings.map((i) => [i.runs, i.wickets, i.balls, i.overs, i.target, i.complete, i.endReason, i.penaltyWin, i.superOver].join("/"));
    const sinn = (sql.innings ?? []).map((/** @type {any} */ i) => [i.runs, i.wickets, i.balls, i.overs, i.target, i.complete, i.end_reason, i.penalty_win, i.super_over].join("/"));
    const figs = (/** @type {any} */ x) => (x == null ? null : [x.runs, x.wickets, x.balls]);
    const pairs = (f?.superOvers ?? []).map((p) => JSON.stringify([p.n, p.first, figs(p.a), figs(p.b), p.state, p.winner, p.winnerKey]));
    const spairs = (sql.super_overs ?? []).map((/** @type {any} */ p) => JSON.stringify([p.n, p.first, figs(p.a), figs(p.b), p.state, p.winner, p.winner_key]));
    ok(`${x.name}: the super overs are the fold's`, JSON.stringify(pairs) === JSON.stringify(spairs), JSON.stringify({ sql: spairs, fold: pairs }));
    const liveSo = await q(`select innings, max(super_over) as so from ball_event_live where match_id = $1 group by innings order by innings`, [rm]);
    ok(`...and ball_event_live.super_over is inn.superOver`,
       JSON.stringify(liveSo.map((/** @type {any} */ r) => r.so)) === JSON.stringify(folded.innings.map((i) => i.superOver)),
       JSON.stringify({ sql: liveSo, fold: folded.innings.map((i) => i.superOver) }));
    ok(`${x.name}: match_result() is the fold's`, JSON.stringify(said) === JSON.stringify(fold) && JSON.stringify(sinn) === JSON.stringify(inn),
       JSON.stringify({ sql: said, fold, sqlInnings: sinn, foldInnings: inn }));
    ok(`...and is what the design says it is`,
       sql.outcome === x.expect.outcome && sql.margin_kind === x.expect.marginKind && sql.margin === x.expect.marginValue
       && sql.decided_by === x.expect.decidedBy && sql.winner_side === x.expect.winnerSide,
       JSON.stringify({ sql: said, expect: x.expect }));
  }

  // ── SCRBRD-130 R1 (db/73): rain, both ways ──────────────────────────
  // Every log of rain-logs.mjs written as toRow() writes it, its frozen play
  // part beside it, folded from the rows read back; SQL's match_result() held
  // to describeResult() (outcome, margin, who won, each innings' figures and
  // end) and to the design; innings_stop_as_folded() and the result's
  // innings entries held to the fold's inn.stopped and inn.par; and the
  // chase's revised-target method to revisedTargetMethod().
  group(`Rain (SCRBRD-130 R1, db/73): stops, par and the result, both ways, over ${RAIN_LOGS.length} logs`);
  for (const x of RAIN_LOGS) {
    const [{ id: rm }] = await q(`insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
                                  values ($1, $2, $3, $4, 'T20', 20, $5) returning id`,
      [HIL, RAIN_SIDES.home, RAIN_SIDES.away, RAIN_STARTS_AT, x.status]);
    if (x.play) {
      await q(`insert into match_conditions (match_id, doc, sources, doc_hash) values ($1, $2, '{}', '')`,
        [rm, JSON.stringify({ v: 1, play: x.play, table: {}, sheet: {} })]);
    }
    let seq = 0;
    for (const ev of x.log) {
      const r = toRow(ev);
      seq++;
      await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                       client_seq, client_ts, kind, ball_type, value, striker_id, non_striker_id, bowler_id,
                                       dismissed_id, dismissal, payload)
               values ($1, $2, $3, 1, $4, $5, 'device-rain', $6, $3, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [rm, HIL, seq, r.innings, scorer, `${rm}:${ev.id}`, r.client_ts, r.kind,
         r.ball_type, r.value, r.striker_id, r.non_striker_id, r.bowler_id, r.dismissed_id, r.dismissal ?? null, JSON.stringify(r.payload)]);
    }
    const back = await q(`select * from ball_event where match_id = $1 order by seq`, [rm]);
    const folded = deriveMatch(back.map(fromRow), {
      startsAt: RAIN_STARTS_AT, conditions: x.play ?? undefined, status: x.status, sides: RAIN_SIDES, names: RAIN_NAMES,
    });
    const [sql] = await q(`select * from match_result_compute($1)`, [rm]);
    const f = folded.result;
    const fold = f == null
      ? { outcome: "in_progress", marginKind: null, margin: null, winnerSide: null, revisedTarget: null }
      : { outcome: f.outcome, marginKind: f.marginKind, margin: f.marginValue, winnerSide: f.winnerSide, revisedTarget: f.revisedTarget ?? null };
    const said = { outcome: sql.outcome, marginKind: sql.margin_kind, margin: sql.margin, winnerSide: sql.winner_side,
                   revisedTarget: resultFromRow(sql)?.revisedTarget ?? null };
    const inn = folded.innings.map((i) => [i.runs, i.wickets, i.balls, i.overs, i.target, i.complete, i.endReason, i.par, i.stopped != null].join("/"));
    const sinn = (sql.innings ?? []).map((/** @type {any} */ i) => [i.runs, i.wickets, i.balls, i.overs, i.target, i.complete, i.end_reason, i.par, i.stopped].join("/"));
    ok(`${x.name}: match_result() is the fold's`, JSON.stringify(said) === JSON.stringify(fold) && JSON.stringify(sinn) === JSON.stringify(inn),
       JSON.stringify({ sql: said, fold, sqlInnings: sinn, foldInnings: inn }));
    ok("...and is what the design says it is", sql.outcome === x.expect.outcome && sql.margin_kind === x.expect.marginKind
       && sql.margin === x.expect.marginValue && sql.winner_side === x.expect.winnerSide, JSON.stringify({ sql: said, expect: x.expect }));
    const stops = [];
    for (let i = 0; i < folded.innings.length; i++) {
      const [s] = await q(`select * from innings_stop_as_folded($1, $2::smallint)`, [rm, i]);
      stops.push({ stopped: s.stopped, par: s.par });
    }
    const want = x.innings.map((i) => ({ stopped: i.stopped, par: i.par }));
    ok("...innings_stop_as_folded() is inn.stopped and inn.par, as the design gives them", JSON.stringify(stops) === JSON.stringify(want),
       JSON.stringify({ sql: stops, want }));
  }
  // ── end SCRBRD-130 R1 ──

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
  // db/87's door: a wide or a no-ball names only a way out the Law allows
  // off it (Law 22.9, Law 21.17); one it allows is taken.
  const offExtra = await Promise.all([
    ["Wd", "bowled"], ["Wd", "caught"], ["Wd", "lbw"], ["Nb", "bowled"], ["Nb", "caught"], ["Nb", "lbw"], ["Nb", "stumped"],
  ].map(([bt, d], i) => tryInsert(M_DOOR, 10 + i, { kind: "ball", ball_type: bt, value: 0, dismissal: d, striker: PLAYERS[1] }, scorer)));
  ok("bowled, caught or lbw off a wide, and those or a stumping off a no-ball, are refused by the database (db/87)",
     offExtra.every((t) => !t.ok && t.code === "23514" && t.table === "ball_event" && t.constraint === DOOR_OFF_EXTRA),
     JSON.stringify(offExtra));
  const takenOff = await Promise.all([["Wd", "stumped"], ["Wd", "run_out"], ["Nb", "run_out"], ["Nb", "hit_twice"]]
    .map(([bt, d], i) => tryInsert(M_DOOR, 20 + i, { kind: "ball", ball_type: bt, value: 0, dismissal: d, striker: PLAYERS[1] }, scorer)));
  ok("...a stumping or a run out off a wide, a run out or hit twice off a no-ball, taken", takenOff.every((t) => t.ok), JSON.stringify(takenOff));

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
  // A wicket on a wide the Law does not allow, as an older build or a
  // hand-written request could send it: the Laws refuse it on its own, by
  // name, before the door; the batch's next ball is written.
  const caughtOffWide = { ...stampEv(ball({ type: "Wd", value: 0 })), dismissal: "caught", fielder: "Player 9" };
  const dot = stampEv(ball({ type: "run", value: 0 }));
  const res2 = await post(caughtOffWide, dot);
  ok("the API refuses a catch off a wide by the Laws' name (not_out_off_wide), and writes the ball after it",
     res2?.refused?.length === 1 && res2.refused[0].idempotencyKey === caughtOffWide.id && res2.refused[0].reason === "not_out_off_wide"
     && res2?.accepted?.length === 1 && res2.accepted[0].idempotencyKey === dot.id, JSON.stringify(res2));
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
