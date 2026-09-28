/**
 * SCRBRD — may this event be added to this match's log?
 *
 * One function, `lawsRefusal(match, ev)`, answering for every kind of event:
 * null when the event may be recorded, or a code from REFUSAL naming why not.
 * The server asks it at commit time for every live event, inside the per-match
 * lock (services/api/write/events-api.mjs), against the fold of the log as it
 * stands — so what a scoring command may be is decided in one place, by the
 * server, and not by whichever client happened to send it.
 *
 * Why the server and not only the pad
 * ───────────────────────────────────
 * The pad has always had most of these rules — scoringReadiness() will not
 * record a ball with nobody at an end, the new-over sheet greys out the last
 * bowler — and none of them bound anything else. A second client, an older
 * build, a CSV, a queue replayed after a handover or a hand-written POST could
 * append a ball with no bowler, the same bowler twice running, a wicket for a
 * boy who was not batting, or a void of the third-last ball; the log is
 * append-only, so each one became permanent history that every fold then had
 * to make sense of. A rule that only the honest client obeys is advice.
 *
 * What this reads
 * ───────────────
 * The FOLD, never a second one. `match.innings[i]` is deriveInnings() (or
 * MatchFold.view(), which is the same fold) for innings i, and
 * `match.events[i]` that innings' own log. The scorer holds exactly those two
 * arrays (engine.jsx), so the pad can ask the same question the server will.
 * scoring-session.mjs records what happened the last time the Laws were
 * implemented twice: the copy fell behind and a corrected over made a handover
 * impossible.
 *
 * What this deliberately does NOT refuse — each needs a product decision, and
 * a refusal the Laws do not require would strand a real scorer mid-match:
 *   - a dismissal the fold saves on a free hit (SCORING_RULES.md §6 records it
 *     and marks the batter saved; it is not refused);
 *   - a stale or wrong seal (sealRefusal() in replay.mjs records and ignores
 *     it, by design, because an offline queue can replay one);
 *   - a late capture-profile declaration (the fold ignores it; SCRBRD-039);
 *   - how many innings a format has, and whether a player is in the squad
 *     (opposition players are typed names SCRBRD holds no row for);
 *   - a competition's playing conditions (SCRBRD-114, conditions.mjs): a
 *     bowler past a league's innings cap, a spell past its limit. The
 *     innings still ends at its innings_start's overs, as before. Decided
 *     by Kameel (D1, 2026-09-28): the
 *     umpires allowed it, the scorer records it, and the pad says so in
 *     words; this module reads no condition at all.
 */
import { KIND, BALL_TYPE, DISMISSAL, BOWLER_CHANGE_REASONS, NB_RUNS_VALUES, RUN_OUT_ENDS,
  PENALTY_REASON, PENALTY_REASON_SIDE, normalisePenaltyReason,
  SUSPENSION_REASONS, SUSPENSION_SCOPE } from "./events.mjs";
import { WITHDRAWN_PENALTY_REASONS } from "./events.mjs";
import { FACES_NEXT, FACES_NEXT_VALUES, NOT_IN_OVER, suspensionScope, normaliseDismissal } from "./events.mjs";
import { lawsEdition, LAWS_EDITION } from "./edition.mjs";
import { retirementDismissal, isMidOver } from "./replay.mjs";
import { scoringReadiness } from "./readiness.mjs";
import { voidedIds, lastUndoableIndex } from "./undo.mjs";

/** @import { LogEvent, Loose, BallEvent, BattersEvent, RetireEvent, VoidEvent, PenaltyEvent, BowlerSuspendedEvent } from "./events.mjs" */
/** @import { Innings } from "./replay.mjs" */

/** Every reason an event can be refused. The readiness codes are reused as-is. */
export const REFUSAL = Object.freeze({
  // A ball the pad itself would not have recorded (readiness.mjs, SCRBRD-040).
  NO_INNINGS:     "no_innings",
  INNINGS_CLOSED: "innings_closed",
  INNINGS_OVER:   "innings_over",
  OPENERS:        "openers",
  NEXT_BATTER:    "next_batter",
  OPENING_BOWLER: "opening_bowler",
  NEXT_BOWLER:    "next_bowler",
  // ...and, by the Laws below as well as the pad's gate: a suspended bowler
  // does not bowl again in the innings, or the match (SCRBRD-094 item 2).
  BOWLER_SUSPENDED: "bowler_suspended",
  // The match and its innings, in order.
  MATCH_DECIDED:          "match_decided",          // the chase is over; the result stands
  LATER_INNINGS_STARTED:  "later_innings_started",  // play in an innings after this one
  PREVIOUS_INNINGS_OPEN:  "previous_innings_open",  // the innings before this one has not ended
  // At the crease.
  SAME_BATTER_BOTH_ENDS:  "same_batter_both_ends",
  BATTER_ALREADY_OUT:     "batter_already_out",     // dismissed, or retired out
  RESUME_NOT_YET:         "resume_not_yet",         // retired, and no wicket or other retirement since (SCRBRD-071)
  CONSENT_NOT_RETIRED_OUT: "consent_not_retired_out", // the captain's consent, for nobody who retired out (SCRBRD-071)
  CREASE_OCCUPIED:        "crease_occupied",        // a not-out batter replaced without leaving
  NOT_AT_CREASE:          "not_at_crease",          // dismissed / retiring batter is not batting
  CONSECUTIVE_OVERS:      "consecutive_overs",      // Law 17.6: not two overs, or parts, running
  MID_OVER_NO_REASON:     "mid_over_no_reason",     // Law 17.7.1: a change during an over says why (SCRBRD-080)
  // A dismissal with no delivery (SCRBRD-081).
  NEEDS_A_DELIVERY:       "needs_a_delivery",       // only retired out and timed out happen without a ball
  NOT_NEXT_IN:            "not_next_in",            // timed out: the batter was not the one due in
  // Whose the runs off a no-ball were (SCRBRD-068).
  NB_RUNS_UNKNOWN:        "nb_runs_unknown",        // not off the bat, byes or leg byes, or not on a no-ball
  // Where a batter was out (SCRBRD-069).
  OUT_AT_UNKNOWN:         "out_at_unknown",         // not the striker's or the bowler's end, or not on a wicket
  // Penalty runs (Law 41, SCRBRD-090/094).
  PENALTY_RUNS_INVALID:   "penalty_runs_invalid",   // runs that are not a whole number above nought
  PENALTY_REASON_UNKNOWN: "penalty_reason_unknown", // not one of PENALTY_REASON
  PENALTY_REASON_SIDE:    "penalty_reason_side",    // the reason is the offence of the side awarded the runs
  PENALTY_REASON_WITHDRAWN: "penalty_reason_withdrawn", // a reason the list no longer offers (PENALTY_REASON_WITHDRAWN)
  SHORT_RUN_UNMATCHED:    "short_run_unmatched",    // short running's award follows its delivery, recorded with no run
  // Who faces next, and a delivery that does not count (SCRBRD-113).
  FACES_NEXT_UNKNOWN:     "faces_next_unknown",     // not the striker, the non-striker or the incoming batter — or one who cannot face
  FACES_NEXT_NOT_A_CHOICE: "faces_next_not_a_choice", // the Laws (of this match's Edition) give nobody the choice on this delivery
  NOT_IN_OVER_UNKNOWN:    "not_in_over_unknown",    // not one of the offences that keep a delivery out of the over, or on a wicket
  // A bowler suspended (Law 41, SCRBRD-094 item 2).
  SUSPENSION_UNKNOWN:     "suspension_unknown",     // not a reason on the list, or not the scope its reason carries in this match's Edition
  NOT_BOWLING:            "not_bowling",            // only the bowler on, or who bowled the last ball, can be suspended
  // Undo.
  VOID_NO_TARGET:         "void_no_target",
  VOID_UNKNOWN_TARGET:    "void_unknown_target",    // names nothing in this innings of this match
  VOID_WRONG_INNINGS:     "void_wrong_innings",
  VOID_ALREADY_VOIDED:    "void_already_voided",
  VOID_OF_VOID:           "void_of_void",
  VOID_FOUNDATION:        "void_foundation",        // innings_start is never undone
  VOID_NOT_LATEST:        "void_not_latest",        // undo is last-in, first-out
});
/** @typedef {typeof REFUSAL[keyof typeof REFUSAL]} Refusal */

/** Words for a person reading a held event. Finishes "The server refused this: …".
 *  What probably caused one, where the fold can tell, is likelyCause() beside
 *  it (causes.mjs): the same codes, for every screen that shows a refusal. */
export const REFUSAL_TEXT = Object.freeze({
  no_innings: "nobody had said who was batting in this innings",
  innings_closed: "the innings had already been closed",
  innings_over: "the innings was already over",
  openers: "the opening batters had not been chosen",
  next_batter: "there was no batter at one end",
  opening_bowler: "the opening bowler had not been chosen",
  next_bowler: "nobody had been named to bowl the over",
  bowler_suspended: "that bowler had been suspended by the umpires and may not bowl again in this innings — or, for some offences, in this match",
  match_decided: "the match was already decided",
  later_innings_started: "a later innings had already started",
  previous_innings_open: "the previous innings had not ended",
  same_batter_both_ends: "the same batter was named at both ends",
  batter_already_out: "that batter is already out",
  // Law 25.4.4. No clause number in the words.
  resume_not_yet: "a batter who retired may resume only after a wicket has fallen, or another batter has retired, since he went off",
  // Law 25.4.3. No clause number in the words.
  consent_not_retired_out: "the opposing captain's consent was recorded for a batter who had not retired out",
  crease_occupied: "a batter who is not out was replaced",
  not_at_crease: "that batter is not at the crease",
  consecutive_overs: "a bowler may not bowl two overs in a row",
  // Law 17.7.1. No clause number in the words: Kameel is verifying them against the current Code.
  mid_over_no_reason: "the bowler was changed during an over without saying why — injury or suspension",
  needs_a_delivery: "only retired out and timed out are recorded without a ball — every other way out needs a delivery",
  not_next_in: "a batter can be timed out only while an end is empty and he is the one due in",
  nb_runs_unknown: "runs off a no-ball were said to be something other than off the bat, byes or leg byes",
  out_at_unknown: "the end the batter was out at was not the striker's or the bowler's",
  penalty_runs_invalid: "penalty runs were not a whole number of runs",
  penalty_reason_unknown: "the reason for the penalty runs was not one the scorebook knows",
  penalty_reason_side: "the penalty runs were awarded to the side that committed the offence",
  penalty_reason_withdrawn: "the reason for the penalty runs is no longer one the Laws give for penalty runs",
  short_run_unmatched: "the award for deliberate short running must come straight after its delivery, recorded with no runs",
  faces_next_unknown: "who was to face next was not one of the batters who could",
  faces_next_not_a_choice: "nobody chooses who faces next after that delivery — the batters stay where the delivery left them",
  not_in_over_unknown: "the reason a delivery did not count in the over was not one the scorebook knows, or it was on a wicket",
  suspension_unknown: "the reason for suspending the bowler, or how long it was for, was not one the scorebook knows",
  not_bowling: "only the bowler who is bowling, or who bowled the last ball, can be suspended",
  void_no_target: "the undo named no event",
  void_unknown_target: "the undo named an event this innings does not have",
  void_wrong_innings: "the undo named an event in a different innings",
  void_already_voided: "that event was already undone",
  void_of_void: "an undo cannot itself be undone — record the event again",
  void_foundation: "the start of an innings cannot be undone",
  void_not_latest: "only the latest event can be undone; older ones need an amendment",
  // The idempotency conflict is not a Law, but it is held the same way.
  idempotency_conflict: "a different event was already recorded under this event's id",
  // Nor are these: a value the record has no place for (SCRBRD-077,
  // services/api/write/events-api.mjs), refused per event like a Law.
  contact_unknown: "how the bat met the ball was not one the scorebook knows",
  trajectory_unknown: "the path of the ball off the bat was not one the scorebook knows",
  trajectory_without_contact: "a path off the bat was recorded for a ball the bat did not touch",
  placement_invalid: "where the ball went was not recorded in a form the scorebook can hold",
  capture_profile_unknown: "the capture profile was not one the scorebook knows",
  value_refused: "a value in it is not one the scorebook can hold",
});

/**
 * @typedef {object} MatchView
 * @property {(Innings | null | undefined)[]} innings  deriveInnings() state per innings number (sparse)
 * @property {LogEvent[][]} [events] each innings' own log, in order, voids included
 */

/** Events that happen at the crease and so need the innings to be in play.
 *  @type {ReadonlySet<unknown>}  asked of any event's kind, or of none */
const PLAY = new Set([KIND.BALL, KIND.BATTERS, KIND.BOWLER, KIND.RETIRE, KIND.INNINGS_END, KIND.BOWLER_SUSPENDED]);

/**
 * Why this event may not be added to this match, or null when it may.
 *
 * Pure: reads the fold, changes nothing. An event of a kind it does not know
 * is not refused — the fold ignores unknown kinds, and a newer client's event
 * is not illegal for being newer.
 *
 * @param {MatchView | null | undefined} match
 * @param {LogEvent | null | undefined} ev   the pending event, in the client's
 *   shape (events.mjs). One of a kind this build does not know is not refused.
 * @returns {Refusal | null}
 */
export function lawsRefusal(match, ev) {
  const innings = match?.innings ?? [];
  const i = ev?.innings ?? 0;
  const inn = innings[i] ?? null;
  // The Edition of the Laws this match is scored under (SCRBRD-113): the
  // fixture's date, as the fold stamped it on the innings, or the log's first
  // event (edition.mjs). Read by the three rules that differ by Edition.
  const edition = lawsEdition(match);

  if (ev?.kind === KIND.VOID) return voidRefusal(match, ev);

  if (PLAY.has(ev?.kind)) {
    // Innings are played one after another. A ball, a new batter, a bowler or
    // a seal for an innings that play has already moved on from would be
    // folded into a finished innings and change a total the next innings is
    // being chased against.
    if (laterPlay(innings, i)) return REFUSAL.LATER_INNINGS_STARTED;
  }

  switch (ev?.kind) {
    case KIND.BALL: return ballRefusal(innings, inn, i, ev, edition);
    case KIND.BATTERS: return inn?.battingTeam == null ? REFUSAL.NO_INNINGS : battersRefusal(inn, ev);
    case KIND.BOWLER: {
      if (inn?.battingTeam == null) return REFUSAL.NO_INNINGS;
      // Suspended by the umpires (Law 41, SCRBRD-094 item 2): not again in
      // this innings, or — where its scope is the match — in this match. Asked first: it
      // is the stronger rule, and the words the scorer needs.
      if (ev.bowler != null && suspendedBowlers(innings, i).has(ev.bowler)) return REFUSAL.BOWLER_SUSPENDED;
      // Law 17.6: not two overs running, "nor ... parts of each of two
      // consecutive overs". With Law 17.8 (another bowler finishes the
      // over) this is also the whole of the
      // suspension's rule for the man who finishes the over: he may not have
      // bowled any of the over before it, and — having bowled part of this
      // one — may not bowl the next. Nothing new is needed for either.
      if (bowledLastOver(inn, ev.bowler)) return REFUSAL.CONSECUTIVE_OVERS;
      // Law 17.7.1: an over is finished by another bowler only when the one
      // bowling it is incapacitated or suspended, and the event says which
      // (SCRBRD-080). One with no reason, or one the model does not know, is
      // refused: the reason is what makes the change lawful. A log from
      // before the pad asked still replays; only a new event is judged.
      if (isMidOver(inn) && ev.bowler != null && ev.bowler !== inn.bowler && !BOWLER_CHANGE_REASONS.has(ev.reason)) {
        return REFUSAL.MID_OVER_NO_REASON;
      }
      return null;
    }
    case KIND.RETIRE: {
      if (inn?.battingTeam == null) return REFUSAL.NO_INNINGS;
      if (ev.type === BALL_TYPE.WICKET) return offBallDismissalRefusal(inn, ev);
      // An innings that is over, or closed, takes no retirement: nobody is
      // batting in it any more, and one recorded now would print "retired
      // hurt" on the card of a batter who was not out when it ended. The same
      // codes, in the same order, as a dismissal with no delivery (below).
      if (inn.sealed) return REFUSAL.INNINGS_CLOSED;
      if (inn.complete) return REFUSAL.INNINGS_OVER;
      // Only a batter who is in can retire; anyone else leaving the crease
      // is a fiction the scorecard would print as "retired".
      return ev.batter != null && (ev.batter === inn.striker || ev.batter === inn.nonStriker)
        ? null : REFUSAL.NOT_AT_CREASE;
    }
    // Penalty runs and the umpires' revision change an innings' figures and
    // limits; with no innings_start there is no innings for them to belong to,
    // and a later innings_start would overwrite the revised overs anyway.
    case KIND.PENALTY:
      return inn?.battingTeam == null ? REFUSAL.NO_INNINGS : penaltyRefusal(innings, match?.events?.[i], ev, edition);
    case KIND.REVISION:
    case KIND.INNINGS_END:
      return inn?.battingTeam == null ? REFUSAL.NO_INNINGS : null;
    case KIND.BOWLER_SUSPENDED:
      return inn?.battingTeam == null ? REFUSAL.NO_INNINGS : suspensionRefusal(innings, inn, i, ev, edition);
    default:
      return null;
  }
}

/**
 * Every bowler suspended for innings `i` of this match, by id: those
 * suspended in innings `i` itself, for whatever scope, and those suspended
 * for the MATCH (suspensionScope()) in any innings before it (SCRBRD-094 item
 * 2). Read from the fold's own record (`inn.suspensions`), so the server
 * (MatchFold.view()) and the pad (its per-innings fold) answer alike.
 *
 * @param {(Innings | null | undefined)[]} innings
 * @param {number} i
 * @returns {Map<string, {reason: string, scope: string, innings: number}>}
 */
export function suspendedBowlers(innings, i) {
  /** @type {Map<string, {reason: string, scope: string, innings: number}>} */
  const out = new Map();
  for (let j = 0; j <= i && j < innings.length; j++) {
    for (const s of innings[j]?.suspensions ?? []) {
      if (s.bowler == null || out.has(s.bowler)) continue;
      if (j === i || s.scope === SUSPENSION_SCOPE.MATCH) out.set(s.bowler, { reason: s.reason, scope: s.scope, innings: j });
    }
  }
  return out;
}

/**
 * A suspension (Law 41; SCRBRD-094 item 2).
 *
 *   - The reason is one of SUSPENSION_REASON, and the scope the one it
 *     carries under the Edition this match is scored under
 *     (suspensionScope(); SCRBRD-113): a deliberate front-foot no-ball or a
 *     deliberate beamer is the match under the 4th and the innings under the
 *     3rd; ball tampering and a Level 4 conduct offence the match; every
 *     other the innings. The scorer does not choose how long; the Law does.
 *     An event with no scope reads as the innings (the fold's default), so
 *     it is taken only where the innings is the Law's scope. A stored
 *     event is never judged again: it keeps the scope it carries.
 *   - The bowler is the one on, or — the ball dead on the last of an over,
 *     with nobody on yet — the one who bowled the last delivery. Nobody else
 *     is bowling to be suspended.
 *   - Not one already suspended for this innings.
 *
 * Not refused once the innings is over: an offence on its last ball is
 * recorded all the same, and a suspension for the match must reach the
 * innings after. A later innings with play in it is refused above
 * (LATER_INNINGS_STARTED), as for every event at the crease.
 *
 * @param {(Innings | null | undefined)[]} innings
 * @param {Innings} inn  innings[i]
 * @param {number} i
 * @param {Loose<BowlerSuspendedEvent>} ev
 * @param {3 | 4} edition  lawsEdition(match)
 * @returns {Refusal | null}
 */
function suspensionRefusal(innings, inn, i, ev, edition) {
  if (!SUSPENSION_REASONS.has(ev.reason)) return REFUSAL.SUSPENSION_UNKNOWN;
  if ((ev.scope ?? SUSPENSION_SCOPE.INNINGS) !== suspensionScope(ev.reason, edition)) return REFUSAL.SUSPENSION_UNKNOWN;
  const log = inn.ballLog ?? [];
  const lastBowler = log[log.length - 1]?.bowlerId ?? null;
  if (ev.bowler == null || (ev.bowler !== inn.bowler && ev.bowler !== lastBowler)) return REFUSAL.NOT_BOWLING;
  if (suspendedBowlers(innings, i).has(ev.bowler)) return REFUSAL.BOWLER_SUSPENDED;
  return null;
}

/**
 * Penalty runs (Law 41; SCRBRD-090, SCRBRD-094).
 *
 *   - The runs are a whole number above nought, or absent (five). The fold
 *     adds them (`ev.runs ?? 5`): a string or a fraction made a total nothing
 *     could read, and a handover that could never verify (SCRBRD-090).
 *   - The reason is one of PENALTY_REASON, or one of the pad's free-text
 *     reasons from before the list closed (normalisePenaltyReason), or none
 *     (a log from elsewhere; the pad always sent one). One of
 *     PENALTY_REASON_WITHDRAWN is refused: the Laws do not give it (Law 41,
 *     2026-09-27). An award already stored with one is never judged again —
 *     only a new event is — so it folds and reads as it did.
 *   - The runs go to the side that did NOT commit the offence the reason
 *     names: the fielding side for the batting side's (short running,
 *     damaging the pitch …), the batting side for the fielding side's.
 *   - Deliberate short running (Law 18.5.2) is two events, the delivery with
 *     every run disallowed and then this award (shortRunning() in
 *     events.mjs): the award must come straight after a delivery of this
 *     innings that scored no run completed. It is part of that delivery, so
 *     it is taken even when that delivery ended the match.
 *   - Under the 3rd Edition, any other award to the fielding side once the
 *     match is decided is refused: it would move the target of a chase that
 *     is over — the result stands, as it does for a ball. Under the 4th
 *     (SCRBRD-113; Law 41.17.2) penalty runs are awarded "up until the
 *     umpires leave the field at the end of the match, even if a result has
 *     already been achieved", and an award that undoes the result reopens
 *     the match (the fold: the PENALTY case of replay.mjs). So it is taken.
 *     The umpires leaving the field is the match being concluded: once the
 *     fixture is marked complete (match.status, db/33), the write path holds
 *     every event for a person to decide — this one too — and nothing more
 *     is scored. An award to the batting side is judged as it always was,
 *     in either Edition.
 *
 * @param {(Innings | null | undefined)[]} innings
 * @param {LogEvent[] | undefined} log  this innings' own log, when the caller has it
 * @param {Loose<PenaltyEvent>} ev
 * @param {3 | 4} edition  lawsEdition(match)
 * @returns {Refusal | null}
 */
function penaltyRefusal(innings, log, ev, edition) {
  if (ev.runs != null && !(Number.isInteger(ev.runs) && ev.runs > 0)) return REFUSAL.PENALTY_RUNS_INVALID;
  const toFielding = ev.toBattingTeam === false;
  const reason = ev.reason == null ? null : normalisePenaltyReason(ev.reason, ev.toBattingTeam);
  if (ev.reason != null && reason == null) return REFUSAL.PENALTY_REASON_UNKNOWN;
  if (WITHDRAWN_PENALTY_REASONS.has(reason)) return REFUSAL.PENALTY_REASON_WITHDRAWN;
  const side = reason == null ? null : PENALTY_REASON_SIDE[reason];
  if (side != null && side === toFielding) return REFUSAL.PENALTY_REASON_SIDE;
  if (reason === PENALTY_REASON.SHORT_RUNNING) {
    const events = log ?? [];
    const prev = events[lastUndoableIndex(events)];
    return prev?.kind === KIND.BALL && (prev.value ?? 0) === 0 ? null : REFUSAL.SHORT_RUN_UNMATCHED;
  }
  if (toFielding && innings[1]?.complete && edition === LAWS_EDITION.THIRD) return REFUSAL.MATCH_DECIDED;
  return null;
}

/**
 * A delivery.
 * @param {(Innings | null | undefined)[]} innings
 * @param {Innings | null} inn  innings[i]
 * @param {number} i
 * @param {Loose<BallEvent>} ev
 * @param {3 | 4} edition  lawsEdition(match)
 * @returns {Refusal | null}
 */
function ballRefusal(innings, inn, i, ev, edition) {
  // The chase is over: the result is decided. The AntiGravity rule
  // (recordBallAction: "the match is complete"), and the reason a phone that
  // was offline for the winning run cannot keep adding balls after it.
  if (innings[1]?.complete) return REFUSAL.MATCH_DECIDED;
  // An innings begins when the one before it has ended — by the laws, or by a
  // seal the scorer confirmed (a declaration, an abandonment).
  if (i > 0 && !innings[i - 1]?.complete) return REFUSAL.PREVIOUS_INNINGS_OPEN;

  // The pad's own gate, not a copy of it: no innings, closed or over, an
  // empty end, nobody bowling. One answer, three readers now.
  const ready = scoringReadiness(inn);
  if (!ready.ready) return ready.blocked[0].code;
  // Ready means an innings: scoringReadiness blocks NO_INNINGS on a null one.
  const inPlay = /** @type {Innings} */ (inn);

  if (inPlay.striker === inPlay.nonStriker) return REFUSAL.SAME_BATTER_BOTH_ENDS;
  // A bowler suspended in this innings is already the gate's (readiness
  // BOWLER_SUSPENDED); one suspended for the match in an earlier innings is
  // this: the gate sees one innings, the Laws the whole match.
  if (inPlay.bowler != null && suspendedBowlers(innings, i).has(inPlay.bowler)) return REFUSAL.BOWLER_SUSPENDED;
  if (bowledLastOver(inPlay, inPlay.bowler)) return REFUSAL.CONSECUTIVE_OVERS;

  // Runs off a no-ball are off the bat (no `nbRuns`), byes or leg byes
  // (SCRBRD-068). Anything else — or the field on a delivery that is not a
  // no-ball — the fold would read as off the bat, crediting a batter with
  // runs the scorer said were not his.
  if (ev.nbRuns != null && ((ev.type ?? BALL_TYPE.RUN) !== BALL_TYPE.NO_BALL || !NB_RUNS_VALUES.has(ev.nbRuns))) {
    return REFUSAL.NB_RUNS_UNKNOWN;
  }

  // The end a batter was out at is the striker's or the bowler's, and only
  // a wicket has one (SCRBRD-069). The fold ignores anything else — and would
  // leave the survivor where the scorer said he was not.
  if (ev.outAt != null && ((ev.type ?? BALL_TYPE.RUN) !== BALL_TYPE.WICKET || !RUN_OUT_ENDS.has(ev.outAt))) {
    return REFUSAL.OUT_AT_UNKNOWN;
  }

  // Whoever is out must be one of the two batting. `dismissed` defaults to
  // the striker at replay; one that names anyone else would record a wicket
  // for a boy who was not at the crease and leave the real pair untouched.
  if ((ev.type ?? BALL_TYPE.RUN) === BALL_TYPE.WICKET && ev.dismissed != null
      && ev.dismissed !== inPlay.striker && ev.dismissed !== inPlay.nonStriker) {
    return REFUSAL.NOT_AT_CREASE;
  }

  // A delivery that does not count in the over (Law 17.3.2.5; SCRBRD-113):
  // one of the four offences that keep it out, and never a wicket — nobody
  // is out off one. The fold ignores a reason it does not know, and would
  // count the ball the scorer said did not.
  if (ev.notInOver != null
      && (!NOT_IN_OVER.has(ev.notInOver) || (ev.type ?? BALL_TYPE.RUN) === BALL_TYPE.WICKET)) {
    return REFUSAL.NOT_IN_OVER_UNKNOWN;
  }
  if (ev.facesNext != null) return facesNextRefusal(inPlay, ev, edition);
  return null;
}

/**
 * Who faces next (FACES_NEXT; SCRBRD-113), where the Laws give someone the
 * choice, and only there:
 *
 *   - a fielder's obstruction of a batter (41.5.9, both Editions): the
 *     batters choose — a delivery marked `notInOver: "obstructing_batter"`;
 *   - deliberate short running (4th Edition, 18.5.2): the fielding captain
 *     chooses — the delivery recorded with no runs, whose award follows it
 *     (the award is refused unless it comes straight after:
 *     short_run_unmatched). A choice on a delivery with runs is no choice
 *     the Laws give;
 *   - a wicket with no runs, Obstructing the field (4th Edition, 37.5.2: an
 *     obstruction that prevented a catch) or Run out (short running with a
 *     wicket on the same delivery, 18.5.2's "including the incoming batter"):
 *     the fielding captain chooses the not-out batter or the incoming one.
 *
 * Under the 3rd Edition short running returns the batters to their original
 * ends and an obstruction's incoming batter takes the dismissed batter's
 * end: no choice. The value must name a batter who can face: the dismissed
 * batter cannot, and nobody is incoming without a wicket.
 *
 * @param {Innings} inn  the innings in play
 * @param {Loose<BallEvent>} ev
 * @param {3 | 4} edition
 * @returns {Refusal | null}
 */
function facesNextRefusal(inn, ev, edition) {
  const type = ev.type ?? BALL_TYPE.RUN;
  const choice = ev.facesNext;
  if (!FACES_NEXT_VALUES.has(choice)) return REFUSAL.FACES_NEXT_UNKNOWN;
  const noRuns = (ev.value ?? 0) === 0;
  if (type === BALL_TYPE.WICKET) {
    const outId = ev.dismissed ?? inn.striker;
    const outRole = outId === inn.striker ? FACES_NEXT.STRIKER : FACES_NEXT.NON_STRIKER;
    if (choice === outRole) return REFUSAL.FACES_NEXT_UNKNOWN;
    const how = normaliseDismissal(ev.dismissal);
    const chosenAfter = how === DISMISSAL.OBSTRUCTING_FIELD || how === DISMISSAL.RUN_OUT;
    return edition === LAWS_EDITION.FOURTH && noRuns && chosenAfter ? null : REFUSAL.FACES_NEXT_NOT_A_CHOICE;
  }
  if (choice === FACES_NEXT.INCOMING) return REFUSAL.FACES_NEXT_UNKNOWN;
  if (ev.notInOver === PENALTY_REASON.OBSTRUCTING_BATTER) return null;
  return edition === LAWS_EDITION.FOURTH && noRuns ? null : REFUSAL.FACES_NEXT_NOT_A_CHOICE;
}

/**
 * A dismissal with no delivery: a retire event marked `type: "W"`
 * (SCRBRD-081, retire() in events.mjs). It changes the wickets, so an innings
 * that is over or closed takes none; and it is one of the two ways out that
 * need no ball, of the batter the Law is about:
 *
 *   - retired out (Law 25.4.3): a batter who is in — the same rule as any
 *     retirement;
 *   - timed out (Law 40.1): the INCOMING batter, so an end must be empty
 *     after a wicket or a retirement, and he must not be at the crease or
 *     already out. Openers are not timed out: Law 40 applies to a batter
 *     coming in after a wicket or a retirement.
 *
 * A W delivery that names either (the shape before SCRBRD-081) is not
 * refused: an older build's queue must still sync, and the fold replays it
 * as it always did.
 *
 * @param {Innings} inn
 * @param {Loose<RetireEvent>} ev
 * @returns {Refusal | null}
 */
function offBallDismissalRefusal(inn, ev) {
  if (inn.sealed) return REFUSAL.INNINGS_CLOSED;
  if (inn.complete) return REFUSAL.INNINGS_OVER;
  const how = retirementDismissal(ev);
  if (!how) return REFUSAL.NEEDS_A_DELIVERY;
  const atCrease = ev.batter != null && (ev.batter === inn.striker || ev.batter === inn.nonStriker);
  if (how === DISMISSAL.RETIRED_OUT) return atCrease ? null : REFUSAL.NOT_AT_CREASE;
  // Timed out.
  if (ev.batter == null || atCrease) return REFUSAL.NOT_NEXT_IN;
  const endEmpty = inn.striker == null || inn.nonStriker == null;
  const pastOpeners = (inn.batsmen?.length ?? 0) >= 2;
  if (!endEmpty || !pastOpeners) return REFUSAL.NOT_NEXT_IN;
  if (isOut(inn, ev.batter)) return REFUSAL.BATTER_ALREADY_OUT;
  return null;
}

/**
 * Out is out; retired out is out (Law 25.4.3). Retired hurt — "retired not
 * out" — is not (Law 25.4.2). A retirement before SCRBRD-081 kept the two
 * apart only in the text it wrote; one since is a dismissal, status "out".
 * @param {Innings} inn  @param {string} id
 */
function isOut(inn, id) {
  const b = inn.batsmen?.find((x) => x.id === id);
  return b?.status === "out" || (b?.status === "retired" && b.dismissal === "retired out");
}

/**
 * May a batter who retired resume now? Law 25.4.4: "only at the fall of a
 * wicket or the retirement of another batter". SCRBRD-071. The same for
 * retired hurt and for retired out with the captain's consent (25.4.3).
 *
 * Read from the fold's own record of retirements (`inn.retirements`, in
 * order, each with the wickets fallen when he went): he may come back once,
 * since HIS LATEST retirement, a wicket has fallen or another batter has
 * retired. Anything else is the end he left, straight back: an end is only
 * ever empty after a wicket or a retirement, so with neither since he went,
 * the vacancy he would fill is his own. "Fallen" counts a wicket since
 * taken back by a consented resume (it fell; a batter could have resumed at
 * it), so it only rises.
 *
 *   - A wicket with no delivery (retired out, timed out) is a wicket: it
 *     counts, as the Law's "fall of a wicket" does.
 *   - Two batters retired hurt at once: the first may come back at the
 *     second's retirement; the second waits for a wicket or a third.
 *   - A batter who resumed and retired again is judged from the second
 *     retirement.
 *   - Any retirement of another batter counts, whatever its reason: the Law
 *     says "the retirement of another batter".
 *   - A batter with no retirement on the record is not judged here.
 *
 * Not modelled: the last batter retiring hurt with nobody left to come in.
 * The Laws end the innings there; the fold does not derive that ending yet
 * (SCRBRD-071's note in the backlog). This refuses only his walking straight
 * back, which the pad's sheet never offered either.
 *
 * @param {Innings} inn  @param {string} id
 */
function mayResume(inn, id) {
  const list = inn.retirements ?? [];
  let k = -1;
  for (let j = list.length - 1; j >= 0; j--) if (list[j].batter === id) { k = j; break; }
  if (k < 0) return true;
  if ((inn.wickets ?? 0) + (inn.resumedWithConsent?.length ?? 0) > list[k].wickets) return true;
  // Any retirement after his latest is another batter's.
  return k < list.length - 1;
}

/**
 * Retired out, and still out from it: the latest retirement on the record is
 * his retired out, and his line still says so (not out since, by a ball).
 * Timed out is not a retirement; an old W delivery naming retired out left
 * no record, and stays out. @param {Innings} inn  @param {string} id
 */
function isRetiredOut(inn, id) {
  const b = inn.batsmen?.find((x) => x.id === id);
  const last = (inn.retirements ?? []).filter((r) => r.batter === id).at(-1);
  return b?.status === "out" && b.dismissal === "retired out" && last?.out === true;
}

/** Retired, and not out: the batter mayResume() is asked about. @param {Innings} inn  @param {string} id */
function isRetiredNotOut(inn, id) {
  const b = inn.batsmen?.find((x) => x.id === id);
  return b?.status === "retired" && b.dismissal !== "retired out";
}

/**
 * A new batter, the openers, or a change of ends.
 * @param {Innings} inn
 * @param {Loose<BattersEvent>} ev
 * @returns {Refusal | null}
 */
function battersRefusal(inn, ev) {
  const striker = ev.striker ?? inn.striker;
  const nonStriker = ev.nonStriker ?? inn.nonStriker;
  if (striker != null && striker === nonStriker) return REFUSAL.SAME_BATTER_BOTH_ENDS;

  const at = new Set([inn.striker, inn.nonStriker].filter((x) => x != null));
  // The opposing captain's consent (Law 25.4.3): the one way a batter who
  // retired out comes back. Not once the innings is over or closed — his
  // retirement may have been its last wicket — and it must be for a batter
  // who retired out: consent recorded for anyone else is a false record.
  const consent = ev.captainConsent === true;
  if (consent && inn.sealed) return REFUSAL.INNINGS_CLOSED;
  if (consent && inn.complete) return REFUSAL.INNINGS_OVER;
  let consented = 0;
  for (const id of [ev.striker, ev.nonStriker]) {
    if (id == null || at.has(id)) continue;
    // A new arrival. A dismissed batter does not come back; one retired hurt
    // may (Law 25.4.2), and one retired out with the captain's consent
    // (25.4.3). isOut() says which — and mayResume() says when (25.4.4).
    if (consent && isRetiredOut(inn, id)) {
      if (!mayResume(inn, id)) return REFUSAL.RESUME_NOT_YET;
      consented++;
      continue;
    }
    if (isOut(inn, id)) return REFUSAL.BATTER_ALREADY_OUT;
    if (isRetiredNotOut(inn, id) && !mayResume(inn, id)) return REFUSAL.RESUME_NOT_YET;
  }
  if (consent && consented === 0) return REFUSAL.CONSENT_NOT_RETIRED_OUT;

  // Once play has started, a batter leaves the crease by being dismissed or
  // by retiring — both events the fold records, both of which empty the end.
  // Naming someone new over a not-out batter would drop him from the
  // scorecard with no dismissal at all. Before the first ball the openers can
  // still be corrected, and a change of ends (the same two, swapped) is
  // always allowed: it corrects who is on strike, not who is in.
  if ((inn.ballLog?.length ?? 0) > 0) {
    const after = new Set([striker, nonStriker]);
    for (const id of at) if (!after.has(id)) return REFUSAL.CREASE_OCCUPIED;
  }
  return null;
}

/**
 * Did this bowler bowl any of the previous over? Law 17.6: a bowler may not
 * "bowl two overs consecutively, nor bowl parts of each of two consecutive
 * overs, in the same innings". Read
 * from the fold's own ball log, where every delivery carries the over it was
 * in and the bowler the fold had at the time — so a mid-over change is
 * covered: both men who shared the last over are barred from the next one.
 *
 * @param {Innings} inn
 * @param {string | null | undefined} bowlerId
 */
function bowledLastOver(inn, bowlerId) {
  if (bowlerId == null) return false;
  const over = Math.floor((inn.balls ?? 0) / 6);   // the over the next delivery is in
  if (over === 0) return false;
  const log = inn.ballLog ?? [];
  for (let k = log.length - 1; k >= 0; k--) {
    const b = log[k];
    if (b.over === over) continue;
    if (b.over < over - 1) break;
    if (b.bowlerId === bowlerId) return true;
  }
  return false;
}

/**
 * Is there play — a delivery — in any innings after this one?
 * @param {(Innings | null | undefined)[]} innings
 * @param {number} i
 */
function laterPlay(innings, i) {
  for (let j = i + 1; j < innings.length; j++) if ((innings[j]?.ballLog?.length ?? 0) > 0) return true;
  return false;
}

/**
 * Undo is last-in, first-out, on the server as on the pad.
 *
 * The pad only ever voids lastUndoableIndex() of the innings in play
 * (undo.mjs), and that is the rule here, applied to the same log with the same
 * function. A void of anything older is not an undo: it rewrites history under
 * the balls bowled since — the batter who came in after an undone wicket is
 * still at the crease — and that is what an amendment is for
 * (scoring_amendment: a second person, a reason, an approval). Amendments
 * write their void through scoring_amendment_decide(), not through this door,
 * and their route judges it by this function less VOID_NOT_LATEST
 * (amendmentRefusal() in services/api/write/events-api.mjs, SCRBRD-076) —
 * which relies on the last-in-first-out question being asked LAST, below.
 *
 * @param {MatchView | null | undefined} match
 * @param {Loose<VoidEvent>} ev
 * @returns {Refusal | null}
 */
function voidRefusal(match, ev) {
  if (ev.target == null) return REFUSAL.VOID_NO_TARGET;
  const i = ev.innings ?? 0;
  const all = match?.events ?? [];

  // Where is the target? A void is folded with its own innings (deriveMatch
  // groups by innings), so a void filed under another innings would be
  // accepted and then do nothing in the device's fold while ball_event_live —
  // which does not look at innings — removed the ball. Two folds, two answers.
  let home = -1;
  for (let j = 0; j < all.length; j++) {
    if ((all[j] ?? []).some((e) => e.id === ev.target)) { home = j; break; }
  }
  if (home < 0) return REFUSAL.VOID_UNKNOWN_TARGET;
  if (home !== i) return REFUSAL.VOID_WRONG_INNINGS;

  const log = all[i];
  // Found: `home` is the innings whose log has an event with this id.
  const target = /** @type {LogEvent} */ (log.find((e) => e.id === ev.target));
  if (target.kind === KIND.VOID) return REFUSAL.VOID_OF_VOID;
  if (voidedIds(log).has(ev.target)) return REFUSAL.VOID_ALREADY_VOIDED;
  if (target.kind === KIND.INNINGS_START) return REFUSAL.VOID_FOUNDATION;

  // The latest event that still counts in this innings, by the pad's rule...
  const k = lastUndoableIndex(log);
  if (k < 0 || log[k].id !== ev.target) return REFUSAL.VOID_NOT_LATEST;
  // ...and this innings is the one in play: nothing counts in a later one.
  for (let j = i + 1; j < all.length; j++) {
    const voided = voidedIds(all[j] ?? []);
    if ((all[j] ?? []).some((e) => e.kind !== KIND.VOID && e.kind !== KIND.INNINGS_START
                                   && !(e.id != null && voided.has(e.id)))) {
      return REFUSAL.VOID_NOT_LATEST;
    }
  }
  return null;
}
