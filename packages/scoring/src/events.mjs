/**
 * SCRBRD — Scoring event model.
 *
 * The ball log is the ONLY source of truth. Score, scorecards, worms, wagon
 * wheels and player stats are derived by replay (see replay.mjs) and are never
 * stored as authoritative state.
 *
 * These event shapes are the client-side twin of the `ball_event` table in
 * db/01_schema_scoring.sql. The column names there are snake_case and the
 * fields here are camelCase; `toRow()` / `fromRow()` are the only places that
 * translation happens.
 *
 * Why the log carries more than deliveries
 * ────────────────────────────────────────
 * A log of deliveries alone cannot reconstruct an innings. Three things happen
 * between balls and are invisible in a delivery record:
 *
 *   1. which batters are at the crease (openers, and each new arrival)
 *   2. who is bowling each over
 *   3. events that change the score without a delivery (penalty runs, retire)
 *
 * The pre-repo artifact stored those in mutable aggregates beside the log, so
 * the log could not stand alone. Every kind below exists to close one of those
 * gaps, which is what makes `deriveInnings()` total: given the events, there is
 * exactly one correct innings state, and no counter to forget to increment.
 *
 * Undo, and why `void` exists
 * ───────────────────────────
 * While an event has only ever existed on one phone, undo can simply drop it:
 * the log is private, and re-deriving from a shorter log is exact. Once the
 * server has the event that stops being true. The server's log is append-only
 * — no UPDATE, no DELETE, enforced by trigger and by the absence of a policy —
 * and a second device may already have replayed it.
 *
 * So a correction to a synced event is itself an event: `void` names the event
 * it undoes and is appended like any other. Replay honours it by skipping the
 * target. Two devices that have both seen the void derive the same innings;
 * one that has not yet seen it derives the innings as it stood, which is the
 * correct answer for what it knows.
 *
 * This is not a nicety. Truncating a log the server has already accepted is how
 * two devices end up disagreeing about history while each stays internally
 * consistent, and there is no evidence left to reconcile them with.
 */

import { CAPTURE_PROFILE } from "./placement.mjs";
import { LAWS_EDITIONS, lawsEditionOn } from "./edition.mjs";

/** The three declarable profiles. Mirrors the CHECK on ball_event.capture_profile. */
const CAPTURE_PROFILES = new Set(Object.values(CAPTURE_PROFILE));

// ── Event kinds ──────────────────────────────────────────
// `@type {const}` is for the checker only: it makes each value its own literal
// type, so a `switch (ev.kind)` over these narrows the event to its kind.
export const KIND = /** @type {const} */ ({
  INNINGS_START: "innings_start", // opens an innings, carries squads + format
  BATTERS:       "batters",       // striker / non-striker set (openers or new arrival)
  BOWLER:        "bowler",        // bowler set for the coming over
  BALL:          "ball",          // a delivery
  PENALTY:       "penalty",       // penalty runs, no delivery bowled
  RETIRE:        "retire",        // an innings ends or pauses with no delivery: retired hurt, or —
                                  // marked `type: "W"` — retired out / timed out (SCRBRD-081)
  INNINGS_END:   "innings_end",   // declaration, all out, overs complete, rain
  REVISION:      "revision",      // the umpires cut the overs and/or reset the target (rain)
  VOID:          "void",          // undoes an earlier event that has already synced
  BOWLER_SUSPENDED: "bowler_suspended", // the umpires suspended a bowler (Law 41, SCRBRD-094 item 2)
});
/** @typedef {typeof KIND[keyof typeof KIND]} Kind */

/** Delivery types. Mirrors ball_event.ball_type. */
export const BALL_TYPE = /** @type {const} */ ({
  RUN:     "run", // runs off the bat (including 0)
  WICKET:  "W",
  WIDE:    "Wd",
  NO_BALL: "Nb",
  BYE:     "B",
  LEG_BYE: "LB",
});
/** @typedef {typeof BALL_TYPE[keyof typeof BALL_TYPE]} BallType */

/** A delivery that does not count towards the over.
 *  @type {ReadonlySet<string>} */
export const ILLEGAL = new Set([BALL_TYPE.WIDE, BALL_TYPE.NO_BALL]);

/** Does this delivery consume a ball of the over?
 *  @param {string} type */
export const isLegal = (type) => !ILLEGAL.has(type);

/** Runs credited to the batter (as opposed to the extras column) — on a
 *  no-ball only when they came off the bat: see NB_RUNS and runsOffBat().
 *  @type {ReadonlySet<string>} */
export const OFF_THE_BAT = new Set([BALL_TYPE.RUN, BALL_TYPE.WICKET, BALL_TYPE.NO_BALL]);

/**
 * Whose the runs off a no-ball are (SCRBRD-068). A no-ball's `value` is the
 * runs the batters completed, or the boundary allowance — as for a wide, a
 * bye or a leg bye. `nbRuns` says where they came from:
 *
 *   absent     off the bat — the striker's (Law 21.15). Every no-ball recorded
 *              before this has no `nbRuns`, and that is what they were: the
 *              pad's sheet asked for "runs scored off this ball", so an old
 *              no-ball replays exactly as it always did.
 *   "byes"     the ball did not touch the bat or the batter;
 *   "leg_byes" it came off the batter's person, not the bat.
 *
 * How they are scored, by the Code in force from 1 October 2026 (MCC Laws,
 * 2017 Code, 4th Edition 2026: Law 21.15 "Runs resulting from a No ball – how
 * scored", 18.10.2–18.10.3, and Law 23; the 3rd Edition had it at 21.16):
 * the one-run penalty is a No-ball extra, debited to the bowler. Runs off the
 * bat are the striker's, and debited to the bowler. Runs the batters complete,
 * or a boundary, when the ball was NOT hit are Byes or Leg byes — extras of
 * that kind, and NOT debited to the bowler. The no-ball is still not a legal
 * ball, the striker has still faced it, and the runs completed still move the
 * strike. (SCRBRD-068 was first built to the 2000 Code, Law 24.13, which made
 * every run of a no-ball a No-ball extra debited to the bowler; Kameel moved
 * it to the current Code on 2026-09-27, db/52.)
 *
 * So the team's total is the same whichever it is; the extras by type, the
 * bowler's runs conceded and the batter's runs, fours and sixes are not.
 * runsOffBat() and runsToBowler() below are the rule; every SQL reader asks
 * the same of ball_runs_off_bat() (db/40) and ball_runs_to_bowler() (db/52).
 *
 * Carried as a new field rather than by reading `value` differently, so the
 * runs completed stay in one place — which is what strike is rotated by, and
 * what every SQL total already adds (`1 + value`).
 */
export const NB_RUNS = Object.freeze({ BYES: "byes", LEG_BYES: "leg_byes" });

/**
 * Where a batter was out, on a wicket that says (SCRBRD-069): the end the
 * wicket was put down at (Law 38.2). With runs completed before a run out the
 * batters have changed ends (Law 18), and the pre-ball crease no longer says
 * which end is empty; this does. The survivor is at the other end.
 *
 * Asked by the pad on a run out that completed runs, and absent otherwise —
 * then, as in every log before this, the dismissed batter's end before the
 * ball is the one that empties.
 */
export const RUN_OUT_END = Object.freeze({ STRIKER: "striker_end", BOWLER: "bowler_end" });
/** @typedef {typeof RUN_OUT_END[keyof typeof RUN_OUT_END]} RunOutEnd */
/** @type {ReadonlySet<unknown>}  asked of whatever a producer wrote */
export const RUN_OUT_ENDS = new Set(Object.values(RUN_OUT_END));

/**
 * WHO FACES THE NEXT DELIVERY, where the Laws let someone choose (SCRBRD-113;
 * Law 18.13). Recorded on the delivery the choice follows, as `facesNext`,
 * and applied by the fold once the delivery is done — after the change of
 * ends at an over's close, since it is who faces the NEXT ball, from
 * whichever end that is. Named by where the batter stood when this delivery
 * was bowled, so it needs no player id (an opposition batter has none):
 *
 *   striker       the batter who faced this delivery faces the next
 *   non_striker   the other batter at the wicket faces the next
 *   incoming      the batter coming in after a wicket on this delivery faces
 *                 the next; the not-out batter goes to the other end
 *
 * Three occasions, and the server takes the field only on these
 * (lawsRefusal, `faces_next_not_a_choice`):
 *
 *   - deliberate short running (4th Edition, 18.5.2 and 18.13.2): the
 *     fielding captain chooses which batter at the wicket faces — the
 *     incoming batter too, if a wicket fell on the delivery. The 3rd Edition
 *     returned the batters to their original ends, which is the delivery
 *     with no runs and no choice (shortRunning()).
 *   - an obstruction that prevented a catch (4th Edition, 37.5.2 and
 *     18.13.1): a wicket, Obstructing the field, with no runs; the fielding
 *     captain chooses the non-striker or the incoming batter. Without the
 *     field the incoming batter takes the dismissed batter's end, as every
 *     obstruction before this did.
 *   - a fielder's wilful obstruction of a batter (41.5.9 and 18.13.3, both
 *     Editions): the batters choose. The delivery does not count
 *     (`notInOver`, below).
 *
 * Omitted when nobody chose, so every delivery before this is the event it
 * always was. The effect is never more than the pad could already record: a
 * change of ends (a `batters` event with the same two swapped) is always
 * allowed. What the field adds is the record of whose choice it was, on the
 * delivery it follows.
 */
export const FACES_NEXT = Object.freeze({ STRIKER: "striker", NON_STRIKER: "non_striker", INCOMING: "incoming" });
/** @typedef {typeof FACES_NEXT[keyof typeof FACES_NEXT]} FacesNext */
/** @type {ReadonlySet<unknown>}  asked of whatever a producer wrote */
export const FACES_NEXT_VALUES = new Set(Object.values(FACES_NEXT));
/**
 * What kind of no-ball it was, as the umpire called it and the pad's no-ball
 * sheet asks: over the popping crease, a full toss above waist height, or a
 * dangerous one. Recorded because the scorer saw it (a deliberate front-foot
 * no-ball and a second beamer are grounds for suspending the bowler, Law 41);
 * the fold decides nothing by it — every no-ball is followed by a free hit
 * (§6 of docs/SCORING_RULES.md). Omitted when not asked, so a no-ball
 * recorded before is the event it always was.
 */
export const NB_TYPE = Object.freeze({ FRONT_FOOT: "front_foot", HEIGHT: "height", BEAMER: "beamer" });
/** @typedef {typeof NB_TYPE[keyof typeof NB_TYPE]} NbType */
/** @type {ReadonlySet<unknown>}  asked of whatever a producer wrote */
export const NB_TYPES = new Set(Object.values(NB_TYPE));
/** @typedef {typeof NB_RUNS[keyof typeof NB_RUNS]} NbRuns */
/** @type {ReadonlySet<unknown>}  asked of whatever a producer wrote */
export const NB_RUNS_VALUES = new Set(Object.values(NB_RUNS));

/**
 * The runs off a delivery that are the striker's. A no-ball's are unless the
 * event says they were byes or leg byes; a bye or leg bye's never are; a wide
 * scores nothing to the batter.
 * @param {{type?: string | null, value?: number | null, nbRuns?: unknown}} ev
 * @returns {number}
 */
export function runsOffBat(ev) {
  const t = ev.type ?? BALL_TYPE.RUN;
  if (!OFF_THE_BAT.has(t)) return 0;
  if (t === BALL_TYPE.NO_BALL && NB_RUNS_VALUES.has(ev.nbRuns)) return 0;
  return ev.value ?? 0;
}

/**
 * The runs of a delivery debited to the bowler (Law 18.10.3: the striker's
 * runs, No-ball extras and Wides, and nothing else; Law 21.15, 22, 23):
 * a wide's penalty run and every run off it; a no-ball's penalty run and the
 * runs off the bat (not its byes or leg byes); a run or a wicket ball's runs;
 * never a bye or a leg bye. A delivery with no type is a run, as the fold
 * reads it.
 * @param {{type?: string | null, value?: number | null, nbRuns?: unknown}} ev
 * @returns {number}
 */
export function runsToBowler(ev) {
  const t = ev.type ?? BALL_TYPE.RUN;
  if (t === BALL_TYPE.WIDE) return 1 + (ev.value ?? 0);
  if (t === BALL_TYPE.NO_BALL) return 1 + runsOffBat(ev);
  if (t === BALL_TYPE.BYE || t === BALL_TYPE.LEG_BYE) return 0;
  return ev.value ?? 0;
}

/**
 * Why a batter's innings ended, or paused, with no delivery. Retired hurt is
 * not out and may resume (Law 25.4.2). Retired out (Law 25.4.3) and timed out
 * (Law 40) are dismissals: a wicket falls, the over does not move and the
 * bowler takes nothing. retire() says how the event marks the difference.
 */
export const RETIRE_REASON = Object.freeze({ HURT: "hurt", OUT: "out", TIMED_OUT: "timed_out" });

/*
 * HOW A BATTER IS OUT — a closed vocabulary.
 *
 * The law used to be a regular expression over free text: replay.mjs asked
 * /run ?out|retired|obstruct|handled|timed ?out/i whether the bowler was
 * credited, and a second, narrower regex whether a wicket stood on a free
 * hit. The scorer's own sheet happened to spell every mode so the regex
 * caught it; anything else — a CSV, a second client, "r/o", "run-out",
 * "timed-out" — credited the bowler with a wicket that was never his, and the
 * two regexes disagreed about handled ball on a free hit. A law encoded where
 * the display string lived is not a law.
 *
 * The eleven in the Laws. `normaliseDismissal` is the ONLY way in: it takes
 * whatever a producer wrote and returns one of these or null, and the API
 * refuses a wicket it returns null for. Everything downstream — the reducer,
 * SQL, the sheet, a scorecard line — reads the canonical value.
 */
export const DISMISSAL = Object.freeze({
  BOWLED: "bowled", CAUGHT: "caught", LBW: "lbw", RUN_OUT: "run_out", STUMPED: "stumped",
  HIT_WICKET: "hit_wicket", HANDLED_BALL: "handled_ball", OBSTRUCTING_FIELD: "obstructing_field",
  TIMED_OUT: "timed_out", RETIRED_OUT: "retired_out", HIT_TWICE: "hit_twice",
});
/** @typedef {typeof DISMISSAL[keyof typeof DISMISSAL]} Dismissal */
/**
 * Every canonical dismissal. Typed for the question it answers — "is this
 * one?" is asked of whatever a producer wrote, null included — rather than
 * for its contents, which are the Dismissal values.
 * @type {ReadonlySet<unknown>}
 */
export const DISMISSALS = new Set(Object.values(DISMISSAL));
export const DISMISSAL_LABEL = Object.freeze({
  bowled: "Bowled", caught: "Caught", lbw: "LBW", run_out: "Run Out", stumped: "Stumped",
  hit_wicket: "Hit Wicket", handled_ball: "Handled Ball", obstructing_field: "Obstructing the Field",
  timed_out: "Timed Out", retired_out: "Retired Out", hit_twice: "Hit the Ball Twice",
});
/**
 * Not the bowler's, and not saved by a free hit: the six the bowler did not
 * take (Law 21.19 lists the ways out off a free hit — run out, handled,
 * obstructing, hit twice; timed out and retired out need no delivery at all).
 * One set, both questions, so the two can never disagree again.
 * @type {ReadonlySet<unknown>}  asked of anything, like DISMISSALS
 */
export const NON_DELIVERY = new Set([
  DISMISSAL.RUN_OUT, DISMISSAL.HANDLED_BALL, DISMISSAL.OBSTRUCTING_FIELD,
  DISMISSAL.TIMED_OUT, DISMISSAL.RETIRED_OUT, DISMISSAL.HIT_TWICE,
]);
/** @param {unknown} d  a dismissal, canonical (normaliseDismissal) or not */
export const chargedToBowler = (d) => DISMISSALS.has(d) && !NON_DELIVERY.has(d);
/** @param {unknown} d  a dismissal, canonical (normaliseDismissal) or not */
export const standsOnFreeHit = (d) => NON_DELIVERY.has(d);

/** @type {[Dismissal, RegExp][]} */
const DISMISSAL_SPELLINGS = [
  [DISMISSAL.RUN_OUT,           /^(run[ _-]?out|r\/?o)$/],
  [DISMISSAL.STUMPED,           /^(stumped|st)$/],
  [DISMISSAL.CAUGHT,            /^(caught|c|ct|caught (and|&) bowled|c&b)$/],
  [DISMISSAL.BOWLED,            /^(bowled|b)$/],
  [DISMISSAL.LBW,               /^(lbw|leg before( wicket)?)$/],
  [DISMISSAL.HIT_WICKET,        /^(hit[ _-]?wicket|hw)$/],
  [DISMISSAL.HANDLED_BALL,      /^(handled([ _-]the)?[ _-]?ball|handled)$/],
  [DISMISSAL.OBSTRUCTING_FIELD, /^(obstruct(ing|ed)?([ _-]the)?[ _-]?field|obstruction)$/],
  [DISMISSAL.TIMED_OUT,         /^timed[ _-]?out$/],
  [DISMISSAL.RETIRED_OUT,       /^retired([ _-]?out)?$/],
  [DISMISSAL.HIT_TWICE,         /^(hit([ _-]the)?([ _-]ball)?[ _-]?twice|double[ _-]?hit)$/],
];
/**
 * Whatever a producer wrote → one of DISMISSAL, or null for "not a dismissal we know".
 * @param {unknown} text
 * @returns {Dismissal | null}
 */
export function normaliseDismissal(text) {
  if (typeof text !== "string") return null;
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  // DISMISSALS holds exactly the Dismissal values, so has(t) proves t is one.
  if (DISMISSALS.has(t)) return /** @type {Dismissal} */ (t);
  return DISMISSAL_SPELLINGS.find(([, re]) => re.test(t))?.[0] ?? null;
}

export const INNINGS_END_REASON = {
  ALL_OUT:   "all_out",
  OVERS:     "overs_complete",
  TARGET:    "target_reached",
  DECLARED:  "declared",
  ABANDONED: "abandoned",
};

/*
 * WHY FIVE PENALTY RUNS WERE AWARDED — a closed list (SCRBRD-094).
 *
 * The pad's penalty sheet offered free text ("Ball hit helmet on field",
 * "Deliberate time wasting", …), stored as written. The reason decides
 * nothing in the fold — who gets the runs is `toBattingTeam` — but it is
 * what the umpires report to the offending side's executive (Law 41, db/25's
 * disciplinary record), and one offence decides a delivery as well as an
 * award: deliberate short running disallows the runs (shortRunning() below).
 *
 * Two sides, one list. An award to the FIELDING side is for something the
 * batting side did; an award to the BATTING side is for something the
 * fielding side did. Either side can commit some offences. `other` is either
 * side's, for an umpire's award the list does not name. The clause numbers
 * are the Code in force from 1 October 2026 (MCC Laws, 2017 Code, 4th Edition
 * 2026; Law 18.6 lists every source of penalty runs), checked by Kameel on
 * 2026-09-27 (docs/laws/CLAUSE_CHECK.md, Law 41): in these comments and in
 * PENALTY_REASON_TEXT only — no screen shows one (penaltyReasonWords()).
 *
 * Each reason is an award: five runs, to one side. Where the Law does more
 * to the delivery it happened on, the delivery says so, recorded with the
 * award straight after it (SCRBRD-113):
 *
 *   - its runs disallowed and the batters at their original ends: deliberate
 *     short running (18.5.2), and a further offence on the pitch or in the
 *     protected area by a batter (41.14.3, 41.15.3) — RUNS_DISALLOWED,
 *     runsDisallowed(): the delivery with no runs completed;
 *   - it does not count as one of the over (17.3.2.5): a fielder returning
 *     without permission touching the ball (24.4), fielding it illegally
 *     (28.2), distracting or obstructing the striker (41.4) or a batter
 *     (41.5) — NOT_IN_OVER, notInOverDelivery(): the delivery marked
 *     `notInOver`;
 *   - who faces next is chosen: after short running, by the fielding captain
 *     (4th Edition), and after 41.5 by the batters (FACES_NEXT).
 *
 * An award of one of these reasons with no delivery (41.4 called before the
 * ball was bowled, 41.15.3 before the delivery stride, a batter on the pitch
 * between deliveries) is the award alone, as every award was before.
 *
 * THE LIST OFFERED FOR A NEW AWARD. The reasons below; the pad's sheet
 * offers each side its own and either side's (PENALTY_REASON_SIDE). Three
 * reasons an earlier list offered are withdrawn — PENALTY_REASON_WITHDRAWN,
 * after it.
 */
export const PENALTY_REASON = Object.freeze({
  // To the fielding side: the batting side's offences.
  SHORT_RUNNING:           "short_running",           // 18.5 (18.5.2): deliberate short running; the runs are disallowed (shortRunning())
  TIME_WASTING:            "time_wasting",            // 41.10: a batter wasting time, after a first and final warning
  PITCH_DAMAGE:            "pitch_damage",            // 41.14: a batter damaging the pitch — which includes being on the
                                                      //   protected area without reasonable cause — after a first and final warning
  STEALING_RUN:            "stealing_run",            // 41.16: the batters attempting to steal a run during the bowler's run-up
  STRIKER_POSITION:        "striker_position",        // 41.15: the striker's batting position in or too near the protected
                                                      //   area, after a first and final warning (SCRBRD-113)
  // To the batting side: the fielding side's offences.
  HELMET_STRUCK:           "helmet_struck",           // 28.3: the ball struck a fielder's helmet on the ground
  ILLEGAL_FIELDING:        "illegal_fielding",        // 28.2: fielding the ball with clothing or anything but the person
  FIELDER_RETURNING:       "fielder_returning",       // 24.4: a fielder back on the field without permission touches the ball
  KEEPER_MOVEMENT:         "keeper_movement",         // 27.4.2: the wicket-keeper's unfair movement before the ball reaches the striker
  FIELDER_MOVEMENT:        "fielder_movement",        // 28.6.3: a fielder's unfair movement before the ball reaches the striker
  DISTRACTING_STRIKER:     "distracting_striker",     // 41.4: a fielder, the bowler included, deliberately distracting or
                                                      //   obstructing the striker — a delivery deliberately intercepted too (21.9)
  OBSTRUCTING_BATTER:      "obstructing_batter",      // 41.5: a fielder deliberately distracting, deceiving or obstructing a batter
  FIELDING_TIME_WASTING:   "fielding_time_wasting",   // 41.9: the fielding side wasting time, after the final warning
  FIELDING_PITCH_DAMAGE:   "fielding_pitch_damage",   // 41.12: a fielder damaging the pitch, after a first and final warning
  FIELDING_RESTRICTIONS:   "fielding_restrictions",   // the competition's fielding restrictions (a playing condition, not a Law)
  // Either side.
  BALL_TAMPERING:          "ball_tampering",          // 41.3 (41.3.4): changing the condition of the ball — by either side
  UNFAIR_PLAY:             "unfair_play",             // 41.2.1: an unfair action the Laws do not otherwise cover,
                                                      //   after a first and final warning to the side
  PRACTICE:                "practice_on_field",       // 26.4.2: practice on the field after a warning
  PLAYER_CONDUCT:          "player_conduct",          // Law 42: a player's conduct (42.3 to 42.5), to the opposing side
  OTHER:                   "other",
});
/** @typedef {typeof PENALTY_REASON[keyof typeof PENALTY_REASON]} PenaltyReason */
/** @type {ReadonlySet<unknown>}  asked of whatever a producer wrote */
export const PENALTY_REASONS = new Set(Object.values(PENALTY_REASON));

/**
 * Reasons an earlier list offered (SCRBRD-094, 2026-09-26) that the Laws do
 * not give, withdrawn on 2026-09-27. An award already stored with one still
 * folds (the fold never reads a reason) and still reads — its side and its
 * words are below — but a new award may not use one: penalty() refuses it,
 * and so does the server (lawsRefusal(), `penalty_reason_withdrawn`).
 *
 *   obstruction_distraction  the batting side distracting or obstructing the
 *                            fielders. Not a Law 41 penalty: a batter who
 *                            wilfully obstructs or distracts the fielding side
 *                            is out, Obstructing the field (Law 37), with no
 *                            penalty runs. (41.4 and 41.5 are the FIELDERS'
 *                            offences, 5 to the batting side: above.)
 *   striking_pitch           "striking the pitch unfairly": no such offence.
 *                            A batter damaging the pitch is pitch_damage.
 *   protected_area           a batter on the protected area without reasonable
 *                            cause: part of the one 41.14 offence, with the
 *                            one first and final warning, so it is merged
 *                            into pitch_damage — two reasons for one offence
 *                            read as two warnings, and the name was also the
 *                            BOWLER's suspension reason (41.13) below.
 */
export const PENALTY_REASON_WITHDRAWN = Object.freeze({
  OBSTRUCTION_DISTRACTION: "obstruction_distraction",
  STRIKING_PITCH:          "striking_pitch",
  PROTECTED_AREA:          "protected_area",
});
/** @typedef {typeof PENALTY_REASON_WITHDRAWN[keyof typeof PENALTY_REASON_WITHDRAWN]} WithdrawnPenaltyReason */
/** @type {ReadonlySet<unknown>}  asked of whatever a producer wrote */
export const WITHDRAWN_PENALTY_REASONS = new Set(Object.values(PENALTY_REASON_WITHDRAWN));

/**
 * Which side each reason's five runs go to: `false` the fielding side, `true`
 * the batting side (the event's `toBattingTeam`), `null` either. A withdrawn
 * reason keeps the side it was recorded for.
 * @type {Readonly<Record<string, boolean | null>>}
 */
export const PENALTY_REASON_SIDE = Object.freeze({
  short_running: false, time_wasting: false, pitch_damage: false, stealing_run: false, striker_position: false,
  helmet_struck: true, illegal_fielding: true, fielder_returning: true, keeper_movement: true, fielder_movement: true,
  distracting_striker: true, obstructing_batter: true, fielding_time_wasting: true, fielding_pitch_damage: true,
  fielding_restrictions: true,
  ball_tampering: null, unfair_play: null, practice_on_field: null, player_conduct: null, other: null,
  // Withdrawn: read, never offered.
  obstruction_distraction: false, striking_pitch: false, protected_area: false,
});

/** Words for each reason, for a scorecard, the held sheet and a report. Finishes "Five penalty runs for …".
 *  @type {Readonly<Record<string, string>>} */
export const PENALTY_REASON_TEXT = Object.freeze({
  short_running: "deliberate short running (Law 18.5)",
  time_wasting: "a batter wasting time after a first and final warning (Law 41.10)",
  pitch_damage: "a batter damaging the pitch, or on the protected area without reasonable cause, after a first and final warning (Law 41.14)",
  stealing_run: "the batters attempting to steal a run (Law 41.16)",
  striker_position: "the striker taking guard in or too near the protected area, after a first and final warning (Law 41.15)",
  helmet_struck: "the ball striking a fielder's helmet on the ground (Law 28.3)",
  illegal_fielding: "fielding the ball illegally (Law 28.2)",
  fielder_returning: "a fielder back on the field without permission touching the ball (Law 24.4)",
  keeper_movement: "the wicket-keeper moving unfairly before the ball reached the striker (Law 27.4.2)",
  fielder_movement: "a fielder moving unfairly before the ball reached the striker (Law 28.6.3)",
  distracting_striker: "a fielder deliberately distracting or obstructing the striker, or intercepting the ball before the striker could play it (Law 41.4)",
  obstructing_batter: "a fielder deliberately distracting, deceiving or obstructing a batter (Law 41.5)",
  fielding_time_wasting: "the fielding side wasting time after a first and final warning (Law 41.9)",
  fielding_pitch_damage: "a fielder damaging the pitch after a first and final warning (Law 41.12)",
  fielding_restrictions: "breaking the fielding restrictions",
  ball_tampering: "changing the condition of the ball (Law 41.3)",
  unfair_play: "any other unfair action, after a first and final warning (Law 41.2.1)",
  practice_on_field: "practice on the field after a warning (Law 26.4.2)",
  player_conduct: "a player's misconduct (Law 42)",
  other: "an award the umpires made for another reason",
  // Withdrawn (PENALTY_REASON_WITHDRAWN): how an award stored with one reads.
  obstruction_distraction: "distracting or obstructing the fielders",
  striking_pitch: "striking the pitch",
  protected_area: "a batter on the protected area without reasonable cause (Law 41.14)",
});

/**
 * Words with any Law clause number taken off: "deliberate short running (Law
 * 18.5)" → "deliberate short running". No screen, report line or commentary
 * shows a clause number (Kameel, 2026-09-26); this is the one place that
 * takes them off, and every reader of the reasons' words goes through it.
 * @param {unknown} text
 * @returns {string}
 */
export function withoutLawClause(text) {
  return String(text ?? "").replace(/\s*\((?:Law|Laws)\s[^)]*\)/g, "").trim();
}

/**
 * A penalty reason in words, with no Law clause number — for a screen, the
 * held sheet, a report or the commentary. A reason the list does not know is
 * shown as itself.
 * @param {unknown} reason  one of PENALTY_REASON
 * @returns {string}
 */
export function penaltyReasonWords(reason) {
  const key = String(reason ?? "");
  return withoutLawClause(Object.hasOwn(PENALTY_REASON_TEXT, key) ? PENALTY_REASON_TEXT[key] : key);
}

/**
 * The offences whose delivery does not count as one of the over (Law
 * 17.3.2.5, the same in both Editions; SCRBRD-113): 24.4, 28.2, 41.4 and
 * 41.5, each five penalty runs to the batting side. A delivery marked
 * `notInOver: <one of these>` is bowled and recorded — the runs the Law
 * credits stand, a no-ball's or a wide's one run stands, the striker has
 * received it — but it is not one of the six: not a ball of the over, not a
 * ball in the bowler's figures, and the over does not end on it
 * (countsInOver()). No batter can be out off it (41.4.2, 41.5.4; under 24.4
 * and 28.2 the ball is dead at the offence), so no wicket carries the mark.
 * @type {ReadonlySet<unknown>}  asked of whatever a producer wrote
 */
export const NOT_IN_OVER = new Set([
  PENALTY_REASON.FIELDER_RETURNING, PENALTY_REASON.ILLEGAL_FIELDING,
  PENALTY_REASON.DISTRACTING_STRIKER, PENALTY_REASON.OBSTRUCTING_BATTER,
]);

/**
 * The offences that disallow every run of the delivery they happened on,
 * with the batters back at their original ends and five penalty runs to the
 * fielding side: deliberate short running (18.5.2), and a further instance
 * of a batter damaging the pitch (41.14.3) or of the striker's position in
 * the protected area (41.15.3). A no-ball's or a wide's one run stands in
 * each. The delivery is recorded with no runs completed (runsDisallowed()).
 * Under the 4th Edition, short running alone then lets the fielding captain
 * choose who faces (FACES_NEXT); 41.14.3 and 41.15.3 still return the
 * batters to their ends.
 * @type {ReadonlySet<unknown>}
 */
export const RUNS_DISALLOWED = new Set([
  PENALTY_REASON.SHORT_RUNNING, PENALTY_REASON.PITCH_DAMAGE, PENALTY_REASON.STRIKER_POSITION,
]);

/**
 * Does this delivery count as one of the six balls of the over? A wide and a
 * no-ball do not (17.3.2.3, 17.3.2.4), nor does one marked `notInOver` with
 * a reason NOT_IN_OVER knows (17.3.2.5). The fold's over count, the bowler's
 * balls, the end of an over and a maiden all read this; SQL asks
 * ball_counts_in_over() (db/54) the same question of a stored row.
 * @param {{type?: string | null, notInOver?: unknown} | null | undefined} ev  a delivery
 * @returns {boolean}
 */
export function countsInOver(ev) {
  return isLegal(ev?.type ?? BALL_TYPE.RUN) && !NOT_IN_OVER.has(ev?.notInOver);
}

/**
 * The pad's free-text reasons, as its penalty sheet offered them before the
 * list closed, → the reason each one is. An event already in a queue or a
 * log carries one of these, and an older build still sends them; they are
 * read, never refused. "Deliberate time wasting" is either side's offence,
 * so the side the runs went to says whose.
 * @type {Readonly<Record<string, PenaltyReason | ((toBattingTeam: boolean) => PenaltyReason)>>}
 */
const PENALTY_REASON_LEGACY = Object.freeze({
  "ball hit helmet on field": PENALTY_REASON.HELMET_STRUCK,
  "ball hitting fielder's helmet on ground": PENALTY_REASON.HELMET_STRUCK,
  "deliberate time wasting": (toBat) => (toBat ? PENALTY_REASON.FIELDING_TIME_WASTING : PENALTY_REASON.TIME_WASTING),
  "changing condition of ball": PENALTY_REASON.BALL_TAMPERING,
  "ball going into fielder's clothing": PENALTY_REASON.ILLEGAL_FIELDING,
  "dangerous/unfair play": PENALTY_REASON.UNFAIR_PLAY,
  "fielding restrictions violation": PENALTY_REASON.FIELDING_RESTRICTIONS,
  "other": PENALTY_REASON.OTHER,
  "penalty runs": PENALTY_REASON.OTHER,   // the sheet's text when nothing was chosen
});

/**
 * Whatever a producer wrote → one of PENALTY_REASON, one of
 * PENALTY_REASON_WITHDRAWN (a stored award still reads as what it was), or
 * null for "not a reason we know". `toBattingTeam` is the event's (anything
 * but `false` awards the batting side, as the fold reads it). Whether a
 * withdrawn reason may be used for a NEW award is not this function's
 * question: penalty() and lawsRefusal() answer it.
 * @param {unknown} text
 * @param {unknown} [toBattingTeam]
 * @returns {PenaltyReason | WithdrawnPenaltyReason | null}
 */
export function normalisePenaltyReason(text, toBattingTeam = true) {
  if (typeof text !== "string") return null;
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  // PENALTY_REASONS holds exactly the PenaltyReason values.
  if (PENALTY_REASONS.has(t)) return /** @type {PenaltyReason} */ (t);
  if (WITHDRAWN_PENALTY_REASONS.has(t)) return /** @type {WithdrawnPenaltyReason} */ (t);
  if (!Object.hasOwn(PENALTY_REASON_LEGACY, t)) return null;
  const hit = PENALTY_REASON_LEGACY[t];
  return typeof hit === "function" ? hit(toBattingTeam !== false) : hit;
}

/*
 * WHY THE UMPIRES SUSPENDED A BOWLER — a closed list (SCRBRD-094 item 2;
 * SCRBRD-113 for the Editions).
 *
 * The Laws have the umpire suspend a bowler as soon as the ball is dead, on
 * these grounds. The clause numbers are the 4th Edition's (2026), in the
 * comments only: no text a screen shows carries one.
 *
 *   beamers                 dangerous non-landing deliveries above waist
 *                           height: a further one after the caution (41.7.4)
 *   deliberate_beamer       a deliberate non-landing delivery above waist
 *                           height, at once (41.7.6)
 *   short_pitched           dangerous short deliveries, repeated after the
 *                           caution (41.6.4)
 *   deliberate_no_ball      a deliberate front-foot no-ball, at once (41.8)
 *   protected_area          the bowler running on the protected area, a third
 *                           time: after a caution and a final warning (41.13;
 *                           the batter's offence on the protected area is
 *                           41.14, a penalty — pitch_damage above)
 *   fielding_time_wasting   time wasting by the fielding side during an over,
 *                           after the final warning (41.9.3)
 *   ball_tampering          changing the condition of the ball, a further
 *                           instance by the fielding side (41.3.5)
 *   throwing                a further delivery thrown, or bowled underarm
 *                           when that is not agreed, after the first and
 *                           final warning (21.3.2)
 *   conduct                 a Level 4 conduct offence: the player is removed
 *                           from the field for the rest of the match (42.5,
 *                           42.5.2.3.2 for a bowler mid-over). A Level 3
 *                           offence (42.4) suspends a player for a number of
 *                           overs, which no scope here can say: not modelled.
 *
 * Until SCRBRD-113 (2026-09-27) there was one reason, `beamers`, for the
 * dangerous series and the deliberate beamer both. It is now the dangerous series only,
 * which is what it always meant for its scope (the innings, in both
 * Editions); a deliberate beamer is `deliberate_beamer`. A stored `beamers`
 * suspension keeps the scope it was recorded with.
 *
 * HOW LONG is the Law's, not the scorer's, and it follows the Edition the
 * match is scored under (SUSPENSION_REASON_SCOPE, suspensionScope()). The 4th
 * Edition (from 1 October 2026) makes a deliberate front-foot no-ball (41.8)
 * and a deliberate beamer (41.7.6) a suspension for the rest of the MATCH;
 * the 3rd had both for the innings. Ball tampering and a Level 4 conduct
 * offence are for the match in both. Every other is for the innings.
 * Warnings are not tracked: the umpire decides when a suspension is due, and
 * the scorer records it.
 */
export const SUSPENSION_REASON = Object.freeze({
  BEAMERS:               "beamers",
  DELIBERATE_BEAMER:     "deliberate_beamer",
  SHORT_PITCHED:         "short_pitched",
  DELIBERATE_NO_BALL:    "deliberate_no_ball",
  PROTECTED_AREA:        "protected_area",
  FIELDING_TIME_WASTING: "fielding_time_wasting",
  BALL_TAMPERING:        "ball_tampering",
  THROWING:              "throwing",
  CONDUCT:               "conduct",
});
/** @typedef {typeof SUSPENSION_REASON[keyof typeof SUSPENSION_REASON]} SuspensionReason */
/** @type {ReadonlySet<unknown>}  asked of whatever a producer wrote */
export const SUSPENSION_REASONS = new Set(Object.values(SUSPENSION_REASON));

/** How long a suspension lasts: the rest of the innings, or of the match. */
export const SUSPENSION_SCOPE = Object.freeze({ INNINGS: "innings", MATCH: "match" });
/** @typedef {typeof SUSPENSION_SCOPE[keyof typeof SUSPENSION_SCOPE]} SuspensionScope */

/**
 * The scope each reason carries, by the Edition of the Laws the match is
 * scored under (edition.mjs): `SUSPENSION_REASON_SCOPE[edition][reason]`.
 * Not the scorer's choice: the Law decides it. Read it through
 * suspensionScope(), which the constructor and the server both ask.
 * @type {Readonly<Record<3 | 4, Readonly<Record<string, SuspensionScope>>>>}
 */
export const SUSPENSION_REASON_SCOPE = Object.freeze({
  3: Object.freeze({
    beamers: "innings", deliberate_beamer: "innings", short_pitched: "innings", deliberate_no_ball: "innings",
    protected_area: "innings", fielding_time_wasting: "innings", ball_tampering: "match",
    throwing: "innings", conduct: "match",
  }),
  4: Object.freeze({
    beamers: "innings", deliberate_beamer: "match", short_pitched: "innings", deliberate_no_ball: "match",
    protected_area: "innings", fielding_time_wasting: "innings", ball_tampering: "match",
    throwing: "innings", conduct: "match",
  }),
});

/**
 * How long a suspension for `reason` lasts under the Edition a match is
 * scored under: "innings" or "match". A reason the list does not know is
 * the innings (as the fold reads a scope it does not know).
 * @param {unknown} reason  one of SUSPENSION_REASON
 * @param {unknown} edition 3 or 4 (lawsEdition(match)); anything else is the 4th
 * @returns {SuspensionScope}
 */
export function suspensionScope(reason, edition) {
  const table = SUSPENSION_REASON_SCOPE[edition === 3 ? 3 : 4];
  const key = String(reason ?? "");
  return Object.hasOwn(table, key) ? table[key] : SUSPENSION_SCOPE.INNINGS;
}

/**
 * Words for each reason, for the pad's sheet, the scorecard, a report and the
 * commentary. Finishes "Suspended for …". No Law clause numbers (above).
 * @type {Readonly<Record<string, string>>}
 */
export const SUSPENSION_REASON_TEXT = Object.freeze({
  beamers: "dangerous non-landing deliveries above waist height (beamers), after a caution",
  deliberate_beamer: "a deliberate non-landing delivery above waist height (a deliberate beamer)",
  short_pitched: "dangerous short deliveries, repeated after a caution",
  deliberate_no_ball: "a deliberate front-foot no-ball",
  protected_area: "running on the protected area after a caution and a final warning",
  fielding_time_wasting: "the fielding side wasting time, repeated after warnings",
  ball_tampering: "changing the condition of the ball (ball tampering)",
  throwing: "throwing the ball, repeated after a warning",
  conduct: "a Level 4 conduct offence (removed from the field)",
});

/**
 * How long, in words. Finishes "He may not bowl again …".
 * @type {Readonly<Record<string, string>>}
 */
export const SUSPENSION_SCOPE_TEXT = Object.freeze({
  innings: "for the rest of the innings",
  match: "for the rest of the match",
});

// ── Event shapes ─────────────────────────────────────────
// The constructors below are the source of truth for these: each typedef is
// exactly what its constructor returns. What the FOLD accepts is looser — see
// LogEvent at the end of this block.

/**
 * A player as the squads on innings_start carry him. The fold and batHandOf()
 * also tolerate a bare id in place of the object (`p?.id ?? p`); that legacy
 * form is not part of the type.
 * @typedef {object} SquadMember
 * @property {string} id
 * @property {string} [name]
 * @property {string} [batHand]         "R" | "L"
 * @property {string} [batting_style]   the roster's spelling, read by batHandOf()
 * @property {string} [battingStyle]
 */

/**
 * The fields every event carries.
 * @typedef {object} EventBase
 * @property {number} innings    0-based innings index
 * @property {number} clientTs   ms since the epoch, on the recording device
 * @property {string} [id]       the event's identity — see newEventId()
 * @property {number} [seq]      assigned by the queue or the database, never here
 */

/**
 * What every constructor takes besides its own fields.
 * @typedef {object} BaseInput
 * @property {number} [innings]
 * @property {number} [clientTs]
 * @property {string} [id]
 * @property {number} [seq]
 */

/**
 * The teams are copied as given, so an innings_start built without them
 * carries them as undefined — which readiness reads as "nobody has said who is
 * batting" (NO_INNINGS), exactly like no innings_start at all.
 * @typedef {EventBase & {
 *   kind: "innings_start",
 *   battingTeam: string | undefined, bowlingTeam: string | undefined,
 *   teamKey: string | undefined, bowlingTeamKey: string | undefined,
 *   squad: SquadMember[], bowlingSquad: SquadMember[],
 *   twelfthMan: string | null,
 *   overs: number, target: number | null,
 *   captureProfile?: string,
 * }} InningsStartEvent
 */
/**
 * @typedef {BaseInput & {
 *   battingTeam?: string, bowlingTeam?: string,
 *   teamKey?: string, bowlingTeamKey?: string,
 *   squad?: SquadMember[], bowlingSquad?: SquadMember[],
 *   twelfthMan?: string | null,
 *   overs?: number, target?: number | null,
 *   captureProfile?: string | null,
 * }} InningsStartInput
 */

/** @typedef {EventBase & {kind: "batters", striker: string | null, nonStriker: string | null, captainConsent?: true}} BattersEvent */
/** @typedef {BaseInput & {striker?: string | null, nonStriker?: string | null, captainConsent?: boolean}} BattersInput */

/**
 * `reason` is present only on a change of bowler during an over (SCRBRD-080).
 * @typedef {EventBase & {kind: "bowler", bowler: string | null, reason?: BowlerChangeReason}} BowlerEvent
 */
/** @typedef {BaseInput & {bowler?: string | null, reason?: string | null}} BowlerInput */

/**
 * The umpires suspended a bowler (SCRBRD-094 item 2). `scope` is the reason's
 * (SUSPENSION_REASON_SCOPE); see bowlerSuspended().
 * @typedef {EventBase & {kind: "bowler_suspended", bowler: string | null, reason: SuspensionReason,
 *   scope: SuspensionScope}} BowlerSuspendedEvent
 */
/** @typedef {BaseInput & {bowler?: string | null, reason: string, scope?: string | null, edition?: number | null}} BowlerSuspendedInput */

/**
 * A delivery. Player references are ids where SCRBRD holds a row, typed names
 * where it does not (see asPlayerId). `dismissal` is canonical where it can
 * be, and otherwise the producer's own spelling, kept so the API can refuse it
 * by name.
 * @typedef {EventBase & {
 *   kind: "ball",
 *   type: BallType, value: number,
 *   striker: string | null, nonStriker: string | null, bowler: string | null,
 *   shot: string | null, contact: string | null, trajectory: string | null,
 *   seg: number | null, zone: string | null, bowlerApproach: string | null,
 *   dismissal: string | null, fielder: string | null, dismissed: string | null,
 *   freeHit: boolean,
 *   theta: number | null, radius: number | null,
 *   placementSource: string | null, placementNull: string | null,
 *   closePosition: string | null, captureProfile: string | null,
 *   nbRuns?: NbRuns, nbType?: NbType, outAt?: RunOutEnd,
 *   facesNext?: FacesNext, notInOver?: PenaltyReason,
 * }} BallEvent
 */
/**
 * `type` is a string rather than a BallType because checkedType() is the guard
 * that refuses a misspelt one; `dismissal` is whatever the producer wrote.
 * @typedef {BaseInput & {
 *   type?: string | null, value?: number,
 *   striker?: string | null, nonStriker?: string | null, bowler?: string | null,
 *   shot?: string | null, contact?: string | null, trajectory?: string | null,
 *   seg?: number | null, zone?: string | null, bowlerApproach?: string | null,
 *   dismissal?: string | null, fielder?: string | null, dismissed?: string | null,
 *   freeHit?: boolean,
 *   theta?: number | null, radius?: number | null,
 *   placementSource?: string | null, placementNull?: string | null,
 *   closePosition?: string | null, captureProfile?: string | null,
 *   nbRuns?: string | null, nbType?: string | null, outAt?: string | null,
 *   facesNext?: string | null, notInOver?: string | null,
 * }} BallInput
 */

/**
 * `reason` is one of PENALTY_REASON (see penalty()); a log from before the list
 * closed may carry the pad's free text, and one from before 2026-09-27 one of
 * PENALTY_REASON_WITHDRAWN — neither of which the fold reads.
 * @typedef {EventBase & {kind: "penalty", runs: number, toBattingTeam: boolean, reason: PenaltyReason | WithdrawnPenaltyReason | null}} PenaltyEvent
 */
/** @typedef {BaseInput & {runs?: number, toBattingTeam?: boolean, reason?: string | null}} PenaltyInput */

/**
 * A retirement. `type` and `dismissal` are present exactly when it is a
 * dismissal (retired out, timed out): see retire().
 * @typedef {EventBase & {kind: "retire", batter: string, reason: string,
 *   type?: "W", dismissal?: Dismissal}} RetireEvent
 */
/** @typedef {BaseInput & {batter: string, reason?: string}} RetireInput */

/**
 * `target` is the id of the event undone.
 * @typedef {EventBase & {kind: "void", target: string, reason: string}} VoidEvent
 */
/** @typedef {BaseInput & {target: string, reason?: string}} VoidInput */

/** @typedef {EventBase & {kind: "revision", overs: number | null, target: number | null, reason: string}} RevisionEvent */
/** @typedef {BaseInput & {overs?: number | null, target?: number | null, reason?: string}} RevisionInput */

/**
 * The figures a seal was confirmed against. See sealRefusal() in replay.mjs.
 * @typedef {{runs: number | null, wickets: number | null, balls: number | null}} Confirmed
 */
/** @typedef {EventBase & {kind: "innings_end", reason: string | null, confirmed: Confirmed | null}} InningsEndEvent */
/**
 * @typedef {BaseInput & {
 *   reason?: string | null,
 *   confirmed?: {runs?: number | null, wickets?: number | null, balls?: number | null} | null,
 * }} InningsEndInput
 */

/**
 * Any event a constructor here can build.
 * @typedef {InningsStartEvent | BattersEvent | BowlerEvent | BallEvent | PenaltyEvent
 *   | RetireEvent | VoidEvent | RevisionEvent | InningsEndEvent | BowlerSuspendedEvent} ScoringEvent
 */

/**
 * An event with its kind and any subset of its other fields.
 * @template {{kind: string}} T
 * @typedef {Pick<T, "kind"> & Partial<Omit<T, "kind">>} Loose
 */

/**
 * An event as the FOLD receives it: its kind, and any of that kind's fields.
 *
 * Looser than ScoringEvent on purpose. A log may come from anywhere — the
 * wire (fromRow omits every NULL column), an older build, a test — and replay
 * reads every field through a default (`ev.type ?? BALL_TYPE.RUN`) rather
 * than trusting it to be present. A constructed event is always one of these.
 *
 * Only the kinds this build knows are in the union. The fold ignores any
 * other kind (a newer client's event is not an error); a caller holding one
 * says so with a cast.
 *
 * @typedef {Loose<InningsStartEvent> | Loose<BattersEvent> | Loose<BowlerEvent>
 *   | Loose<BallEvent> | Loose<PenaltyEvent> | Loose<RetireEvent> | Loose<VoidEvent>
 *   | Loose<RevisionEvent> | Loose<InningsEndEvent> | Loose<BowlerSuspendedEvent>} LogEvent
 */

// ── Constructors ─────────────────────────────────────────
// Each returns a plain, serialisable object. `seq` is assigned by the caller
// (the queue client-side, the database server-side) so that these stay pure.

let _monotonic = 0;
/**
 * An event's identity, minted on the device that recorded it.
 *
 * This is both the event id and the idempotency key, deliberately: they are the
 * same concept seen from two sides. A retried POST is recognised as the same
 * ball rather than appended twice, and a `void` can name its target using a
 * value that means the same thing on the phone and in the database.
 *
 * Stable per (device, match, counter) and never reused, so two devices scoring
 * the same match cannot collide.
 *
 * @param {string} deviceId
 * @param {string} matchId
 * @returns {string}
 */
export function newEventId(deviceId, matchId) {
  _monotonic += 1;
  return `${deviceId}:${matchId}:${Date.now().toString(36)}:${_monotonic.toString(36)}`;
}

/**
 * @template {Kind} K
 * @param {K} kind
 * @param {BaseInput} [o]
 */
const base = (kind, o = {}) => ({
  kind,
  innings: o.innings ?? 0,
  clientTs: o.clientTs ?? Date.now(),
  // `id` is the event's own identity, set by whatever records it. Optional
  // here so the constructors stay pure and usable in tests; the scoring
  // surface always supplies one, because without it an event cannot be voided.
  ...(o.id !== undefined ? { id: o.id } : {}),
  ...(o.seq !== undefined ? { seq: o.seq } : {}),
});

/**
 * Reject a capture profile the model does not define. SCRBRD-039.
 *
 * Same reasoning as checkedType below: a misspelt declaration ("Full",
 * "standrad") is not a harmless null. It would be refused by the CHECK on
 * ball_event.capture_profile when it synced — rejecting the innings_start and
 * with it the squads — so it is refused here, on the device, where the scorer
 * who chose it is still looking at the screen.
 *
 * @param {string} p
 */
const checkedProfile = (p) => {
  if (!CAPTURE_PROFILES.has(p)) {
    throw new TypeError(
      `unknown capture profile ${JSON.stringify(p)} — expected one of ${[...CAPTURE_PROFILES].join(", ")}`);
  }
  return p;
};

/**
 * Open an innings.
 *
 * `captureProfile` is the DECLARED capture intent for the whole innings
 * (SCRBRD-039): what the scorer chose, at setup, to collect on every ball —
 * `full` (an exact point), `standard` (a sector) or `quick` (runs only). It is
 * not the per-ball `captureProfile` on a delivery, which still records the code
 * path each ball actually took (placement.mjs); this is the promise those balls
 * are read against, so that a heat map with nothing on it can say "never asked
 * for" rather than "missing".
 *
 * Carried here, on the event, rather than in a column set beside the log: the
 * log is the only source of truth (see the top of this file), and a
 * declaration that lived anywhere else could disagree with the innings it
 * describes. It travels through toRow() into ball_event.capture_profile on the
 * innings_start row — the column and its CHECK already exist (db/07) — and
 * db/31 derives the per-innings declaration from that row, the same way the
 * fold below derives it from this event.
 *
 * OMITTED, not null, when undeclared. Every innings_start already on a phone,
 * in an outbox or in the server's log has no such key, and an undeclared
 * innings built today must be the same object those are — byte for byte
 * through the wire round trip — so that nothing about an old match reads
 * differently for this having shipped.
 *
 * @param {InningsStartInput} o
 * @returns {InningsStartEvent}
 */
export const inningsStart = (o) => ({
  ...base(KIND.INNINGS_START, o),
  battingTeam: o.battingTeam,
  bowlingTeam: o.bowlingTeam,
  teamKey: o.teamKey ?? o.battingTeam,
  bowlingTeamKey: o.bowlingTeamKey ?? o.bowlingTeam,
  squad: o.squad ?? [],
  bowlingSquad: o.bowlingSquad ?? [],
  twelfthMan: o.twelfthMan ?? null,
  overs: o.overs ?? 20,
  target: o.target ?? null,
  ...(o.captureProfile != null ? { captureProfile: checkedProfile(o.captureProfile) } : {}),
});

/**
 * The openers, a new batter, a change of ends — or a batter walking back in.
 *
 * `captainConsent: true` is a batter who RETIRED OUT resuming with the
 * opposing captain's consent (Law 25.4.3; SCRBRD-071): the one return the
 * Laws allow a retired-out batter, and only at the fall of a wicket or the
 * retirement of another batter (25.4.4). The fold takes his wicket back
 * (replay.mjs); ball_event_live does the same for every SQL reader (db/53).
 * Present exactly when given as true, so every other batters event is the
 * object it always was.
 *
 * @param {BattersInput} o  @returns {BattersEvent}
 */
export const batters = (o) => ({
  ...base(KIND.BATTERS, o),
  striker: o.striker ?? null,
  nonStriker: o.nonStriker ?? null,
  ...(o.captainConsent === true ? { captainConsent: /** @type {true} */ (true) } : {}),
});

/**
 * Why a bowler was replaced during an over. Law 17.8.1: only a bowler who is
 * incapacitated (injured, taken ill) or suspended (Law 41) may be; the
 * over is finished by another, who may not have bowled the previous over and
 * may not bowl the next (17.8, "or parts thereof").
 */
export const BOWLER_CHANGE_REASON = Object.freeze({ INJURY: "injury", SUSPENDED: "suspended" });
/** @typedef {typeof BOWLER_CHANGE_REASON[keyof typeof BOWLER_CHANGE_REASON]} BowlerChangeReason */
/** @type {ReadonlySet<unknown>}  asked of whatever a producer wrote */
export const BOWLER_CHANGE_REASONS = new Set(Object.values(BOWLER_CHANGE_REASON));

/**
 * The bowler for the coming over — or, with `reason`, the one who takes over
 * DURING an over from a bowler injured or suspended (SCRBRD-080). The reason
 * is omitted when not given, so a bowler event for a new over is the same
 * object it always was; an unknown one is refused here, where the scorer who
 * chose it is still looking at the screen (the server refuses one too).
 *
 * @param {BowlerInput} o
 * @returns {BowlerEvent}
 */
export const bowler = (o) => {
  if (o.reason != null && !BOWLER_CHANGE_REASONS.has(o.reason)) {
    throw new TypeError(`unknown bowler change reason ${JSON.stringify(o.reason)} — expected one of ${[...BOWLER_CHANGE_REASONS].join(", ")}`);
  }
  return {
    ...base(KIND.BOWLER, o),
    bowler: o.bowler ?? null,
    ...(o.reason != null ? { reason: /** @type {BowlerChangeReason} */ (o.reason) } : {}),
  };
};

/**
 * The umpires suspended a bowler (Law 41; SCRBRD-094 item 2). Recorded as
 * soon as the ball is dead, before anything else happens.
 *
 * What it does, in the fold and at commit (replay.mjs, laws.mjs):
 *   - the fold records who, why, for how long and at which ball
 *     (`inn.suspensions`); no figure moves — a suspension bowls nothing;
 *   - he may not bowl again for the rest of the innings, or, where the
 *     scope is the match (suspensionScope()), the rest of the match — a
 *     later innings included;
 *   - if the over is not finished, another bowler finishes it: a `bowler`
 *     event with reason "suspended", who may not have bowled any part of the
 *     previous over and may not bowl any part of the next (Law 17.8, "or parts
 *     thereof" — the rule the Laws check already applies to every change).
 *
 * `scope` is the reason's under the Edition of the Laws the match is scored
 * under (suspensionScope(); SCRBRD-113), not a choice: omitted, it is filled
 * in; given and different, it is refused here, where the scorer who chose it
 * can still see it — as the server refuses one too. `edition` is the match's
 * (lawsEdition(match), which the pad passes); without one, the Edition on the
 * event's own day. It is not stored: the scope is, and a stored event keeps
 * the scope it was recorded with whatever Edition a later reader is under.
 *
 * A new kind rather than a flag on `bowler`: the suspension is a fact about
 * the man who LEFT, and it must stand whether or not anyone finishes the over
 * (the offence can come on the last ball of one). Every SQL reader of
 * ball_event counts deliveries (`kind = 'ball'`), so a row of this kind moves
 * no figure anywhere; the bowler rides in bowler_id like a `bowler` row's.
 *
 * @param {BowlerSuspendedInput} o
 * @returns {BowlerSuspendedEvent}
 */
export const bowlerSuspended = (o) => {
  if (!SUSPENSION_REASONS.has(o.reason)) {
    throw new TypeError(`unknown suspension reason ${JSON.stringify(o.reason)} — expected one of ${[...SUSPENSION_REASONS].join(", ")}`);
  }
  const reason = /** @type {SuspensionReason} */ (o.reason);
  const edition = LAWS_EDITIONS.has(o.edition) ? o.edition : lawsEditionOn(o.clientTs ?? Date.now());
  const scope = suspensionScope(reason, edition);
  if (o.scope != null && o.scope !== scope) {
    throw new TypeError(`a suspension for ${reason} is for the ${scope}, not ${JSON.stringify(o.scope)}`);
  }
  return {
    ...base(KIND.BOWLER_SUSPENDED, o),
    bowler: o.bowler ?? null,
    reason,
    scope,
  };
};

/**
 * A suspension in words, for the commentary generator (SCRBRD-098) and a
 * report: "Suspended for a deliberate front-foot no-ball, for the rest of the
 * innings." No names — the caller has them — and no Law clause numbers.
 * @param {{reason?: unknown, scope?: unknown}} ev  a bowler_suspended event
 * @returns {string}
 */
export function suspensionWords(ev) {
  const reason = String(ev.reason ?? "");
  // The scope the event was recorded with; one that carries none (never built
  // here) reads as the fold reads it — the innings.
  const scope = String(ev.scope ?? SUSPENSION_SCOPE.INNINGS);
  const why = Object.hasOwn(SUSPENSION_REASON_TEXT, reason) ? SUSPENSION_REASON_TEXT[reason] : "a reason the scorebook does not know";
  const long = Object.hasOwn(SUSPENSION_SCOPE_TEXT, scope) ? SUSPENSION_SCOPE_TEXT[scope] : SUSPENSION_SCOPE_TEXT.innings;
  return `Suspended for ${why}, ${long}.`;
}

/**
 * A delivery.
 *
 * `value` means runs off the bat for `run`/`W`, the number of extras run for
 * `B`/`LB`/`Wd`, and for `Nb` the runs completed — off the bat unless
 * `nbRuns` says byes or leg byes (NB_RUNS, SCRBRD-068). The one-run penalty for a wide or no-ball is implicit
 * and added during replay — never baked into `value`, so that the penalty can
 * never be double-counted by a caller that already added it.
 */
/**
 * A delivery.
 *
 * Placement (theta / radius / placementSource / …) is documented in
 * placement.mjs and is built by placementFromTap() or noPlacement() rather
 * than assembled here — the derived fields have to stay in step with the
 * captured ones, and one constructor that can do it wrong is one too many.
 *
 * Defaults are the sector era: no point, no source. A ball that carries
 * `seg`/`zone` but no `theta` is a sector-era ball and is excluded from
 * anything needing a position. It is NEVER upgraded by synthesising a point
 * from its sector.
 */
/**
 * The delivery kinds a ball may be, for the guard below.
 * @type {ReadonlySet<unknown>}  asked of whatever the caller passed
 */
const BALL_TYPES = new Set(Object.values(BALL_TYPE));

/**
 * Reject a delivery kind the model does not define.
 *
 * An unrecognised type is NOT harmless: `type` defaults to a run, so a bad
 * value becomes a legal delivery worth whatever `value` says, and both the
 * device fold and the SQL fold agree on it — consistently, which is worse than
 * disagreeing, because nothing anywhere reports a problem. The scorecard is
 * simply wrong.
 *
 * What this catches: a literal typo, `type: "nb"` instead of BALL_TYPE.NO_BALL.
 *
 * What it CANNOT catch, and it is worth being honest about: a typo in the
 * constant itself. `BALL_TYPE.NOBALL` (the export is NO_BALL) evaluates to
 * undefined in the caller, before this function is reached, and undefined is
 * indistinguishable from "not specified" — which legitimately means a run.
 * That one is only ever caught by asserting the score independently, which is
 * how it was found: tools/smoke-fold.mjs made exactly that mistake and the
 * "both folds agree" assertion passed while the arithmetic one did not.
 *
 * @param {string | null | undefined} t
 * @returns {BallType}
 */
const checkedType = (t) => {
  if (t == null) return BALL_TYPE.RUN;
  if (!BALL_TYPES.has(t)) {
    throw new TypeError(
      `unknown ball type ${JSON.stringify(t)} — expected one of ${[...BALL_TYPES].join(", ")}`);
  }
  // BALL_TYPES holds exactly the BallType values, so has(t) proves t is one.
  return /** @type {BallType} */ (t);
};

/**
 * Reject an `nbRuns` the model does not define, or one on a delivery that is
 * not a no-ball: refused where the scorer who chose it can still see it.
 * @param {string | null | undefined} n  @param {BallType} type
 * @returns {NbRuns | null}
 */
const checkedNbRuns = (n, type) => {
  if (n == null) return null;
  if (!NB_RUNS_VALUES.has(n) || type !== BALL_TYPE.NO_BALL) {
    throw new TypeError(`nbRuns ${JSON.stringify(n)} is for a no-ball, one of ${[...NB_RUNS_VALUES].join(", ")}`);
  }
  return /** @type {NbRuns} */ (n);
};

/**
 * Reject an `outAt` the model does not define, or one on a delivery that is
 * not a wicket.
 * @param {string | null | undefined} e  @param {BallType} type
 * @returns {RunOutEnd | null}
 */
const checkedOutAt = (e, type) => {
  if (e == null) return null;
  if (!RUN_OUT_ENDS.has(e) || type !== BALL_TYPE.WICKET) {
    throw new TypeError(`outAt ${JSON.stringify(e)} is for a wicket, one of ${[...RUN_OUT_ENDS].join(", ")}`);
  }
  return /** @type {RunOutEnd} */ (e);
};

/**
 * Reject an `nbType` the model does not define, or one on a delivery that is
 * not a no-ball.
 * @param {string | null | undefined} n  @param {BallType} type
 * @returns {NbType | null}
 */
const checkedNbType = (n, type) => {
  if (n == null) return null;
  if (!NB_TYPES.has(n) || type !== BALL_TYPE.NO_BALL) {
    throw new TypeError(`nbType ${JSON.stringify(n)} is for a no-ball, one of ${[...NB_TYPES].join(", ")}`);
  }
  return /** @type {NbType} */ (n);
};

/**
 * Reject a `facesNext` the model does not define, or "incoming" on a
 * delivery that is not a wicket (nobody is coming in). Whether the Laws give
 * anyone the choice on this delivery is the server's question
 * (lawsRefusal, `faces_next_not_a_choice`): it needs the match.
 * @param {string | null | undefined} f  @param {BallType} type
 * @returns {FacesNext | null}
 */
const checkedFacesNext = (f, type) => {
  if (f == null) return null;
  if (!FACES_NEXT_VALUES.has(f) || (f === FACES_NEXT.INCOMING && type !== BALL_TYPE.WICKET)) {
    throw new TypeError(`facesNext ${JSON.stringify(f)} is one of ${[...FACES_NEXT_VALUES].join(", ")} ("incoming" only on a wicket)`);
  }
  return /** @type {FacesNext} */ (f);
};

/**
 * Reject a `notInOver` that is not one of NOT_IN_OVER, or one on a wicket:
 * nobody is out off a delivery that does not count (41.4.2, 41.5.4).
 * @param {string | null | undefined} r  @param {BallType} type
 * @returns {PenaltyReason | null}
 */
const checkedNotInOver = (r, type) => {
  if (r == null) return null;
  if (!NOT_IN_OVER.has(r) || type === BALL_TYPE.WICKET) {
    throw new TypeError(`notInOver ${JSON.stringify(r)} is one of ${[...NOT_IN_OVER].join(", ")}, never on a wicket`);
  }
  return /** @type {PenaltyReason} */ (r);
};

/** @param {BallInput} o  @returns {BallEvent} */
export const ball = (o) => {
  const type = checkedType(o.type);
  const nbRuns = checkedNbRuns(o.nbRuns, type);
  const nbType = checkedNbType(o.nbType, type);
  const outAt = checkedOutAt(o.outAt, type);
  const facesNext = checkedFacesNext(o.facesNext, type);
  const notInOver = checkedNotInOver(o.notInOver, type);
  return {
  ...base(KIND.BALL, o),
  // `type` is the delivery kind (run | W | Wd | Nb | B | LB). It is named to
  // match both the ball_event.ball_type column and the log entries the scoring
  // UI already reads, so a log entry needs no translation on either side.
  type,
  value: o.value ?? 0,
  // Runs off a no-ball that were not off the bat (SCRBRD-068). Omitted when
  // they were, so a no-ball hit for runs is the same event it always was.
  ...(nbRuns ? { nbRuns } : {}),
  // What kind of no-ball (NB_TYPE), when the pad asked. The pad's no-ball
  // sheet always passed it; the constructor dropped it until now, so no
  // stored no-ball carries it and every one reads as it did.
  ...(nbType ? { nbType } : {}),

  // WHO WAS INVOLVED
  // ────────────────
  // The striker who faced it, the non-striker at the other end, and the bowler
  // who sent it down. Recorded ON THE EVENT rather than left to replay state.
  //
  // deriveInnings() does not read these — it tracks the crease itself, from
  // `batters` and `bowler` events plus strike rotation, and it must keep doing
  // so or a log from an older device stops replaying. They exist because
  // ATTRIBUTION has to be available to readers that are not the device: a
  // career batting average in SQL, a heat map for one batter, a bowler's
  // spell. The alternative was re-implementing strike rotation as a window
  // function, which is a third fold over the log and by far the most intricate
  // of them.
  //
  // Nullable, and readers must treat NULL as "not attributable" rather than
  // guessing: balls recorded before this existed carry no striker, and a
  // delivery faced by an opposition batter SCRBRD holds no row for carries a
  // name in `payload` instead of an id. See asPlayerId.
  striker: o.striker ?? null,
  nonStriker: o.nonStriker ?? null,
  bowler: o.bowler ?? null,
  shot: o.shot ?? null,
  // What the bat did, and the path off it. See db/07_shot_placement.sql: runs
  // record what happened, these record how well. NULL is "not captured", never
  // "no contact" — `beat` is the value that says the bat missed.
  contact: o.contact ?? null,
  trajectory: o.trajectory ?? null,
  seg: o.seg ?? null,
  zone: o.zone ?? null,
  bowlerApproach: o.bowlerApproach ?? null,
  // Dismissal detail. `fielder` was dropped by the artifact's log and is
  // carried here so a scorecard line reads "c Naidoo b Mkhize" after replay.
  // Canonical where it can be. An unknown spelling is kept as written so the
  // API can refuse it by name rather than quietly recording a null wicket.
  dismissal: normaliseDismissal(o.dismissal) ?? o.dismissal ?? null,
  fielder: o.fielder ?? null,
  dismissed: o.dismissed ?? null, // player id; defaults to the striker at replay
  // The end the batter was out at (SCRBRD-069), when the scorer was asked.
  // Omitted otherwise, so every other wicket is the event it always was.
  ...(outAt ? { outAt } : {}),
  // Who faces next, where someone chose (FACES_NEXT, SCRBRD-113), and why
  // this delivery is not one of the over (NOT_IN_OVER). Omitted otherwise,
  // so every other delivery is the event it always was.
  ...(facesNext ? { facesNext } : {}),
  ...(notInOver ? { notInOver } : {}),
  freeHit: o.freeHit ?? false,

  // ── Shot placement ──
  // Batter-relative polar coordinates. See placement.mjs for the frame and
  // for why a point is never reconstructed from a sector.
  theta: o.theta ?? null,                    // 0-359, leg-side positive from straight
  radius: o.radius ?? null,                  // 0.00-1.00, fraction of the boundary
  placementSource: o.placementSource ?? null, // "point" | "sector" | null
  placementNull: o.placementNull ?? null,     // why there is no placement
  closePosition: o.closePosition ?? null,     // set only inside the catching ring
  captureProfile: o.captureProfile ?? null,   // "full" | "standard" | "quick"
  };
};

/**
 * Penalty runs: five (Law 41.17), awarded to the batting side or — with
 * `toBattingTeam: false` — to the fielding side. No ball is bowled.
 *
 * Where the runs go is the fold's (replay.mjs): an award to the batting side
 * is in this innings' total; one to the fielding side is in THEIR total —
 * their most recently completed innings, or, if they have not batted yet,
 * their next innings, which opens on the award (SCRBRD-094). The award is
 * recorded in the innings it was made in; the event names no other innings.
 *
 * `reason` is one of PENALTY_REASON. One of the pad's free-text reasons from
 * before the list closed is read as the reason it is (normalisePenaltyReason);
 * anything else — a withdrawn reason (PENALTY_REASON_WITHDRAWN) included —
 * is refused here, where the scorer who chose it can still see it — as
 * bowler() refuses an unknown change reason. The server refuses one too, and
 * a reason that belongs to the other side (lawsRefusal).
 *
 * @param {PenaltyInput} o
 * @returns {PenaltyEvent}
 */
export const penalty = (o) => {
  const toBattingTeam = o.toBattingTeam ?? true;
  const reason = o.reason == null ? null : normalisePenaltyReason(o.reason, toBattingTeam);
  if (o.reason != null && (reason == null || WITHDRAWN_PENALTY_REASONS.has(reason))) {
    throw new TypeError(`${reason == null ? "unknown" : "withdrawn"} penalty reason ${JSON.stringify(o.reason)} — expected one of ${[...PENALTY_REASONS].join(", ")}`);
  }
  return {
    ...base(KIND.PENALTY, o),
    runs: o.runs ?? 5,
    toBattingTeam,
    reason,
  };
};

/**
 * A delivery whose runs the umpire disallowed, and the five penalty runs to
 * the fielding side that go with it (RUNS_DISALLOWED): deliberate short
 * running (Law 18.5.2), a further instance of a batter damaging the pitch
 * (41.14.3) or of the striker's position in the protected area (41.15.3).
 * The umpire disallows every run completed off the delivery and awards five
 * to the fielding side; a no-ball's or a wide's one run stands; the delivery
 * still counts.
 *
 * TWO EVENTS, NOT A NEW SHAPE. The delivery as it stands after the call — a
 * ball of the type it was, with no runs completed (`value: 0`) — and the
 * award, to the fielding side. So the fold needs nothing new for the
 * delivery: no runs to the batter, the bowler or the side; no change of ends
 * (nothing was run, and the ends are the ones the batters started from); a
 * legal delivery counts in the over and is a ball faced; a no-ball's or a
 * wide's one-run penalty stands. Every SQL reader of a delivery — the live
 * score, the handover check, every career figure — reads a dot ball too,
 * with no migration. The five are the award's, credited like any award to
 * the fielding side. The server takes a short-running award only straight
 * after a delivery that scored no run completed (lawsRefusal,
 * `short_run_unmatched`); the other two may also be awarded alone, for an
 * offence with no delivery (41.15.3 before the delivery stride, a batter on
 * the pitch between deliveries).
 *
 * WHO FACES NEXT. Under the 3rd Edition, and for 41.14.3 and 41.15.3 under
 * either, the batters return to their original ends: the delivery as it is.
 * Under the 4th Edition, after deliberate short running the fielding captain
 * chooses which batter faces (18.5.2, 18.13.2): `facesNext` on the delivery
 * (FACES_NEXT) says whom, and the fold places him. The server takes the
 * field only where the Laws give the choice.
 *
 * @param {BallInput} o  the delivery, as bowled: type, who was involved, where
 *   it went, and `facesNext` where the fielding captain chose. `value` is
 *   ignored — every run completed is disallowed.
 * @param {string} [reason]  one of RUNS_DISALLOWED; short running when omitted
 * @returns {[BallEvent, PenaltyEvent]}  append both, in this order, to the same innings
 */
export const runsDisallowed = (o, reason = PENALTY_REASON.SHORT_RUNNING) => {
  if (!RUNS_DISALLOWED.has(reason)) {
    throw new TypeError(`runs are disallowed for ${[...RUNS_DISALLOWED].join(", ")}, not ${JSON.stringify(reason)}`);
  }
  return [
    ball({ ...o, value: 0 }),
    penalty({ innings: o.innings, clientTs: o.clientTs, runs: 5, toBattingTeam: false, reason }),
  ];
};

/**
 * Deliberate short running (Law 18.5.2): runsDisallowed() for its reason.
 * @param {BallInput} o
 * @returns {[BallEvent, PenaltyEvent]}
 */
export const shortRunning = (o) => runsDisallowed(o, PENALTY_REASON.SHORT_RUNNING);

/**
 * A delivery that does not count as one of the over, and the five penalty
 * runs to the batting side that go with it (NOT_IN_OVER, Law 17.3.2.5):
 * a fielder returning without permission touches the ball (24.4), a fielder
 * fields it illegally (28.2), a fielder distracts or obstructs the striker
 * (41.4) or a batter (41.5). Both Editions (SCRBRD-113).
 *
 * TWO EVENTS. The delivery, marked `notInOver` with the reason, carrying the
 * runs the Law lets stand — completed runs, and the run in progress where
 * the Law says (24.4, 28.2.3, 41.5.8); none where the ball was dead before
 * any (41.4) — and a no-ball's or a wide's one run; then the award to the
 * batting side. The fold scores the delivery as its type says and does not
 * count it in the over (countsInOver()): not a ball of the six, not one of
 * the bowler's balls, and no over ends on it. After 41.5 the batters choose
 * who faces next (41.5.9): `facesNext`.
 *
 * @param {BallInput} o  the delivery, as bowled, with the runs that stand
 * @param {string} reason  one of NOT_IN_OVER
 * @returns {[BallEvent, PenaltyEvent]}  append both, in this order, to the same innings
 */
export const notInOverDelivery = (o, reason) => {
  if (!NOT_IN_OVER.has(reason)) {
    throw new TypeError(`a delivery is not one of the over for ${[...NOT_IN_OVER].join(", ")}, not ${JSON.stringify(reason)}`);
  }
  return [
    ball({ ...o, notInOver: reason }),
    penalty({ innings: o.innings, clientTs: o.clientTs, runs: 5, toBattingTeam: true, reason }),
  ];
};

/**
 * The dismissal each retirement reason is, when it is one.
 * @type {Readonly<Record<string, Dismissal>>}
 */
export const RETIREMENT_DISMISSAL = Object.freeze({
  [RETIRE_REASON.OUT]: DISMISSAL.RETIRED_OUT,
  [RETIRE_REASON.TIMED_OUT]: DISMISSAL.TIMED_OUT,
});

/**
 * A batter's innings ends, or pauses, without a delivery. SCRBRD-081.
 *
 * Retired hurt is the event as it always was: `{batter, reason: "hurt"}`, no
 * wicket, and he may come back.
 *
 * Retired out (Law 25.4.3) and timed out (Law 40) are DISMISSALS WITHOUT A
 * BALL. They used to be recorded as W deliveries — the pad's wicket sheet
 * offered them beside bowled and caught — which counted a legal ball of the
 * over and put the ball in the bowler's figures. Neither involves the bowler
 * or a delivery: a boy who does not walk out within three minutes is out, and
 * so is one who walks off without the umpire's leave to do so.
 *
 * So they are this event, marked with `type: "W"` and the canonical
 * `dismissal`. Why a retirement and not a new kind:
 *
 *   - `retire` already IS "a batter's innings ends with no delivery". Retired
 *     out was already one of its reasons; the server already judges it (the
 *     batter must be in, and a batter retired out may not return), the sync
 *     sheet already names it, and an older build that folds one still empties
 *     the end instead of ignoring an unknown kind and leaving him at the crease.
 *   - `type: "W"` is how every shipped SQL fold over ball_event says "a
 *     wicket" (match_live_score, scoring_verify_takeover: ball_type = 'W'),
 *     and `kind = 'ball'` is how each says "a delivery". A retire row with
 *     ball_type 'W' is therefore, to every one of them, a wicket that is not a
 *     ball — the public score and the handover check agree with the device
 *     with no migration. A new kind would need the same marker to be counted,
 *     and would be one more kind for every reader to learn.
 *
 * The marker is also what keeps old logs as they were: a `retire` with
 * reason "out" written before this (none was ever emitted by the pad, but the
 * model allowed it) has no `type`, and replays exactly as it always did — no
 * wicket. Only a retirement built here, or by anything that says `type: "W"`,
 * is a dismissal.
 *
 * @param {RetireInput} o
 * @returns {RetireEvent}
 */
export const retire = (o) => {
  const reason = o.reason ?? RETIRE_REASON.HURT;
  const dismissal = Object.hasOwn(RETIREMENT_DISMISSAL, reason) ? RETIREMENT_DISMISSAL[reason] : null;
  return {
    ...base(KIND.RETIRE, o),
    batter: o.batter,
    reason,
    ...(dismissal ? { type: /** @type {"W"} */ (BALL_TYPE.WICKET), dismissal } : {}),
  };
};

/**
 * Undo an event the server already has.
 *
 * `target` is the earlier event's id — the same string the server dedupes on,
 * so a void can be resolved against a log that came back from the API just as
 * well as against the one in memory.
 *
 * A void is never itself voided. Undoing an undo means appending the original
 * again, because the log is a record of what the scorer did, not a stack.
 *
 * @param {VoidInput} o
 * @returns {VoidEvent}
 */
export const voidEvent = (o) => ({
  ...base(KIND.VOID, o),
  target: o.target,
  reason: o.reason ?? "scorer_undo",
});

/**
 * A reduced-overs revision: the umpires cut the innings to `overs`, and for
 * a chase set a new `target`. Either alone is fine. It is an EVENT in the log
 * like everything else — rather than an edit to the match row — so the
 * scorecard, the second device and the server all derive the same innings
 * end and the same result, and the revision itself is on the record with
 * who made it and when. No DLS/VJD here: the figures are the umpires', typed.
 *
 * @param {RevisionInput} o
 * @returns {RevisionEvent}
 */
export const revision = (o) => ({
  ...base(KIND.REVISION, o),
  overs: o.overs ?? null,
  target: o.target ?? null,
  reason: o.reason ?? "rain",
});

/**
 * The seal on an innings. SCRBRD-038.
 *
 * `confirmed` is the figures the scorer read back on the review sheet, carried
 * on the event so the reducer can check the seal against the log instead of
 * taking its word for it: see sealRefusal() in replay.mjs, which is what makes
 * the review a gate rather than a dialog. Build it with sealInnings() — the
 * figures come off the derived innings there, so an event cannot claim figures
 * the sheet never showed.
 *
 * `reason` has no default on purpose. It used to default to OVERS, so
 * `inningsEnd({})` — a seal that does not say why — asserted that the overs ran
 * out. That is a sentence about a real match invented by a missing argument.
 *
 * @param {InningsEndInput} o
 * @returns {InningsEndEvent}
 */
export const inningsEnd = (o) => ({
  ...base(KIND.INNINGS_END, o),
  reason: o.reason ?? null,
  confirmed: o.confirmed
    ? { runs: o.confirmed.runs ?? null, wickets: o.confirmed.wickets ?? null, balls: o.confirmed.balls ?? null }
    : null,
});

/** The three endings the laws derive from a ball log, and so the three a seal
 *  may not simply assert. `declared` and `abandoned` are not in here: nothing in
 *  a ball log implies a captain's decision or an umpire's. */
export const DERIVED_END_REASONS = new Set([
  INNINGS_END_REASON.ALL_OUT, INNINGS_END_REASON.OVERS, INNINGS_END_REASON.TARGET,
]);

// ── Wire translation (client camelCase ↔ ball_event snake_case) ──
// Fields that have a column of their own on ball_event. Placement joins them
// because the query layer has to filter on placement_source — a heat map that
// reads it out of a jsonb payload cannot be indexed, and a rule enforced by
// convention in report code is not enforced.
const ROW_SCALARS = ["shot", "contact", "trajectory", "seg", "zone", "dismissal"];
const ROW_SNAKE = {
  theta: "theta",
  radius: "radius",
  placementSource: "placement_source",
  placementNull: "placement_null",
  closePosition: "close_position",
  captureProfile: "capture_profile",
};

/**
 * Is this player reference something the database can store in a uuid column?
 *
 * Most of the time, no. ball_event.striker_id and bowler_id are foreign keys
 * into `player`, and SCRBRD holds rows for its OWN schools' players — not for
 * the opposition. A fixture against a school that is not a tenant has no away
 * roster at all, so the scorer types the bowler's name, and that name is the
 * only identity that will ever exist for them. The same goes for an unlisted
 * batter pressed into a side at the last minute, which happens constantly at
 * school level.
 *
 * Sending a typed name to a uuid column is a 22P02 that rejects the whole
 * delivery — every ball of every over bowled by an opposition bowler, which is
 * to say almost all of them.
 *
 * So a reference that is a real player id goes in the column and can be joined
 * on; anything else rides in the payload as free text. Replay treats them
 * identically, because it only ever compares ids for equality.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** @param {unknown} v  @returns {string | null} */
const asPlayerId = (v) => (typeof v === "string" && UUID.test(v) ? v : null);

/**
 * Client event → a `ball_event` row body for POST /matches/:id/events.
 *
 * @param {Readonly<Record<string, any>>} ev  any event (a LogEvent), read
 *   field by field: whatever has no column rides in `payload`
 * @returns {Record<string, any>}  column → value, with `payload` the jsonb rest
 */
export function toRow(ev) {
  /** @type {Record<string, any>} */
  const row = {
    kind: ev.kind,
    innings: ev.innings ?? 0,
    client_ts: new Date(ev.clientTs ?? Date.now()).toISOString(),
    ball_type: ev.type ?? null,
    value: ev.value ?? null,
    striker_id: asPlayerId(ev.striker),
    non_striker_id: asPlayerId(ev.nonStriker),
    bowler_id: asPlayerId(ev.bowler),
    dismissed_id: asPlayerId(ev.dismissed),
    payload: {},
  };
  for (const k of ROW_SCALARS) if (ev[k] !== undefined) row[k] = ev[k];
  for (const [k, col] of Object.entries(ROW_SNAKE)) if (ev[k] !== undefined) row[col] = ev[k];
  // Everything the table has no column for rides in `payload` untouched, so
  // adding a captured dimension never needs a migration. A player reference
  // that is not a real id is carried here too — see asPlayerId — so nothing is
  // lost when the column cannot hold it.
  const MAPPED = ["kind", "innings", "clientTs", "type", "value", "seq",
                  ...ROW_SCALARS, ...Object.keys(ROW_SNAKE)];
  for (const [k, v] of Object.entries(ev)) {
    if (MAPPED.includes(k)) continue;
    if (k === "striker" && row.striker_id) continue;
    if (k === "nonStriker" && row.non_striker_id) continue;
    if (k === "bowler" && row.bowler_id) continue;
    if (k === "dismissed" && row.dismissed_id) continue;
    row.payload[k] = v;
  }
  return row;
}

/**
 * `ball_event` row → client event. Inverse of toRow().
 *
 * @param {Record<string, any>} row  as the database returned it
 * @returns {LogEvent}  `kind` is the column's, which its CHECK confines to KIND
 */
export function fromRow(row) {
  return {
    kind: row.kind,
    innings: row.innings ?? 0,
    seq: row.seq,
    // The event's identity comes back off the idempotency_key column, because
    // that IS its identity — see newEventId(). Without this a log fetched from
    // the server has anonymous events, and a `void` in that same log names a
    // target nothing matches: the correction would silently do nothing, and
    // the two devices would disagree by exactly the ball that was undone.
    ...(row.idempotency_key != null ? { id: row.idempotency_key } : {}),
    clientTs: row.client_ts ? new Date(row.client_ts).getTime() : Date.now(),
    ...(row.ball_type != null ? { type: row.ball_type } : {}),
    ...(row.value != null ? { value: row.value } : {}),
    ...(row.striker_id != null ? { striker: row.striker_id } : {}),
    ...(row.non_striker_id != null ? { nonStriker: row.non_striker_id } : {}),
    ...(row.bowler_id != null ? { bowler: row.bowler_id } : {}),
    ...(row.dismissed_id != null ? { dismissed: row.dismissed_id } : {}),
    ...Object.fromEntries(ROW_SCALARS.filter((k) => row[k] != null).map((k) => [k, row[k]])),
    ...Object.fromEntries(Object.entries(ROW_SNAKE)
      .filter(([, col]) => row[col] != null)
      // numeric(3,2) comes back from pg as a string; radius is a number.
      .map(([k, col]) => [k, k === "radius" ? Number(row[col]) : row[col]])),
    ...(row.payload ?? {}),
  };
}
