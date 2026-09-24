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
 *   absent     off the bat — the striker's (Law 21.6). Every no-ball recorded
 *              before this has no `nbRuns`, and that is what they were: the
 *              pad's sheet asked for "runs scored off this ball", so an old
 *              no-ball replays exactly as it always did.
 *   "byes"     the ball did not touch the bat or the batter;
 *   "leg_byes" it came off the batter's person, not the bat.
 *
 * Runs not off the bat are not the striker's (Law 23). By the Laws they are
 * scored as No-ball extras, and every run resulting from a no-ball — the
 * penalty, runs off the bat, byes, leg byes — is debited to the bowler; only a
 * five-run penalty award is not (MCC Laws 2017, Law 21: "Runs resulting from
 * a No ball – how scored"). So the team's total and the bowler's figures are
 * the same whichever it is; the batter's runs, fours and sixes are not. The
 * pad still records which of the two it was, because it is what the scorer saw
 * and a competition playing other conditions can read it.
 *
 * Carried as a new field rather than by reading `value` differently, so the
 * runs completed stay in one place — which is what strike is rotated by, and
 * what every SQL fold already adds to the total and the bowler (`1 + value`).
 */
export const NB_RUNS = Object.freeze({ BYES: "byes", LEG_BYES: "leg_byes" });
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

/** @typedef {EventBase & {kind: "batters", striker: string | null, nonStriker: string | null}} BattersEvent */
/** @typedef {BaseInput & {striker?: string | null, nonStriker?: string | null}} BattersInput */

/**
 * `reason` is present only on a change of bowler during an over (SCRBRD-080).
 * @typedef {EventBase & {kind: "bowler", bowler: string | null, reason?: BowlerChangeReason}} BowlerEvent
 */
/** @typedef {BaseInput & {bowler?: string | null, reason?: string | null}} BowlerInput */

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
 *   nbRuns?: NbRuns,
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
 *   nbRuns?: string | null,
 * }} BallInput
 */

/** @typedef {EventBase & {kind: "penalty", runs: number, toBattingTeam: boolean, reason: string | null}} PenaltyEvent */
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
 *   | RetireEvent | VoidEvent | RevisionEvent | InningsEndEvent} ScoringEvent
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
 *   | Loose<RevisionEvent> | Loose<InningsEndEvent>} LogEvent
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

/** Former name. The value was always the event's identity, not just a dedupe token. */
export const newIdempotencyKey = newEventId;

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

/** @param {BattersInput} o  @returns {BattersEvent} */
export const batters = (o) => ({
  ...base(KIND.BATTERS, o),
  striker: o.striker ?? null,
  nonStriker: o.nonStriker ?? null,
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

/** @param {BallInput} o  @returns {BallEvent} */
export const ball = (o) => {
  const type = checkedType(o.type);
  const nbRuns = checkedNbRuns(o.nbRuns, type);
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

/** @param {PenaltyInput} o  @returns {PenaltyEvent} */
export const penalty = (o) => ({
  ...base(KIND.PENALTY, o),
  runs: o.runs ?? 5,
  toBattingTeam: o.toBattingTeam ?? true,
  reason: o.reason ?? null,
});

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
