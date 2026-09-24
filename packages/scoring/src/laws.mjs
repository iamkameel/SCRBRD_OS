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
 *     (opposition players are typed names SCRBRD holds no row for).
 */
import { KIND, BALL_TYPE, DISMISSAL, BOWLER_CHANGE_REASONS, NB_RUNS_VALUES } from "./events.mjs";
import { retirementDismissal, isMidOver } from "./replay.mjs";
import { scoringReadiness } from "./readiness.mjs";
import { voidedIds, lastUndoableIndex } from "./undo.mjs";

/** @import { LogEvent, Loose, BallEvent, BattersEvent, RetireEvent, VoidEvent } from "./events.mjs" */
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
  // The match and its innings, in order.
  MATCH_DECIDED:          "match_decided",          // the chase is over; the result stands
  LATER_INNINGS_STARTED:  "later_innings_started",  // play in an innings after this one
  PREVIOUS_INNINGS_OPEN:  "previous_innings_open",  // the innings before this one has not ended
  // At the crease.
  SAME_BATTER_BOTH_ENDS:  "same_batter_both_ends",
  BATTER_ALREADY_OUT:     "batter_already_out",     // dismissed, or retired out
  CREASE_OCCUPIED:        "crease_occupied",        // a not-out batter replaced without leaving
  NOT_AT_CREASE:          "not_at_crease",          // dismissed / retiring batter is not batting
  CONSECUTIVE_OVERS:      "consecutive_overs",      // Law 17.8: not two overs, or parts, running
  MID_OVER_NO_REASON:     "mid_over_no_reason",     // Law 17.8.1: a change during an over says why (SCRBRD-080)
  // A dismissal with no delivery (SCRBRD-081).
  NEEDS_A_DELIVERY:       "needs_a_delivery",       // only retired out and timed out happen without a ball
  NOT_NEXT_IN:            "not_next_in",            // timed out: the batter was not the one due in
  // Whose the runs off a no-ball were (SCRBRD-068).
  NB_RUNS_UNKNOWN:        "nb_runs_unknown",        // not off the bat, byes or leg byes, or not on a no-ball
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

/** Words for a person reading a held event. Finishes "The server refused this: …". */
export const REFUSAL_TEXT = Object.freeze({
  no_innings: "nobody had said who was batting in this innings",
  innings_closed: "the innings had already been closed",
  innings_over: "the innings was already over",
  openers: "the opening batters had not been chosen",
  next_batter: "there was no batter at one end",
  opening_bowler: "the opening bowler had not been chosen",
  next_bowler: "nobody had been named to bowl the over",
  match_decided: "the match was already decided",
  later_innings_started: "a later innings had already started",
  previous_innings_open: "the previous innings had not ended",
  same_batter_both_ends: "the same batter was named at both ends",
  batter_already_out: "that batter is already out",
  crease_occupied: "a batter who is not out was replaced",
  not_at_crease: "that batter is not at the crease",
  consecutive_overs: "a bowler may not bowl two overs in a row",
  mid_over_no_reason: "the bowler was changed during an over without saying why — injury or suspension (Law 17.8.1)",
  needs_a_delivery: "only retired out and timed out are recorded without a ball — every other way out needs a delivery",
  not_next_in: "a batter can be timed out only while an end is empty and he is the one due in",
  nb_runs_unknown: "runs off a no-ball were said to be something other than off the bat, byes or leg byes",
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
const PLAY = new Set([KIND.BALL, KIND.BATTERS, KIND.BOWLER, KIND.RETIRE, KIND.INNINGS_END]);

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

  if (ev?.kind === KIND.VOID) return voidRefusal(match, ev);

  if (PLAY.has(ev?.kind)) {
    // Innings are played one after another. A ball, a new batter, a bowler or
    // a seal for an innings that play has already moved on from would be
    // folded into a finished innings and change a total the next innings is
    // being chased against.
    if (laterPlay(innings, i)) return REFUSAL.LATER_INNINGS_STARTED;
  }

  switch (ev?.kind) {
    case KIND.BALL: return ballRefusal(innings, inn, i, ev);
    case KIND.BATTERS: return inn?.battingTeam == null ? REFUSAL.NO_INNINGS : battersRefusal(inn, ev);
    case KIND.BOWLER: {
      if (inn?.battingTeam == null) return REFUSAL.NO_INNINGS;
      if (bowledLastOver(inn, ev.bowler)) return REFUSAL.CONSECUTIVE_OVERS;
      // Law 17.8.1: an over is finished by another bowler only when the one
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
      // Only a batter who is in can retire; anyone else leaving the crease
      // is a fiction the scorecard would print as "retired".
      return ev.batter != null && (ev.batter === inn.striker || ev.batter === inn.nonStriker)
        ? null : REFUSAL.NOT_AT_CREASE;
    }
    // Penalty runs and the umpires' revision change an innings' figures and
    // limits; with no innings_start there is no innings for them to belong to,
    // and a later innings_start would overwrite the revised overs anyway.
    case KIND.PENALTY:
    case KIND.REVISION:
    case KIND.INNINGS_END:
      return inn?.battingTeam == null ? REFUSAL.NO_INNINGS : null;
    default:
      return null;
  }
}

/**
 * A delivery.
 * @param {(Innings | null | undefined)[]} innings
 * @param {Innings | null} inn  innings[i]
 * @param {number} i
 * @param {Loose<BallEvent>} ev
 * @returns {Refusal | null}
 */
function ballRefusal(innings, inn, i, ev) {
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
  if (bowledLastOver(inPlay, inPlay.bowler)) return REFUSAL.CONSECUTIVE_OVERS;

  // Runs off a no-ball are off the bat (no `nbRuns`), byes or leg byes
  // (SCRBRD-068). Anything else — or the field on a delivery that is not a
  // no-ball — the fold would read as off the bat, crediting a batter with
  // runs the scorer said were not his.
  if (ev.nbRuns != null && ((ev.type ?? BALL_TYPE.RUN) !== BALL_TYPE.NO_BALL || !NB_RUNS_VALUES.has(ev.nbRuns))) {
    return REFUSAL.NB_RUNS_UNKNOWN;
  }

  // Whoever is out must be one of the two batting. `dismissed` defaults to
  // the striker at replay; one that names anyone else would record a wicket
  // for a boy who was not at the crease and leave the real pair untouched.
  if ((ev.type ?? BALL_TYPE.RUN) === BALL_TYPE.WICKET && ev.dismissed != null
      && ev.dismissed !== inPlay.striker && ev.dismissed !== inPlay.nonStriker) {
    return REFUSAL.NOT_AT_CREASE;
  }
  return null;
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
  for (const id of [ev.striker, ev.nonStriker]) {
    if (id == null || at.has(id)) continue;
    // A new arrival. A dismissed batter does not come back; one retired hurt
    // may (Law 25.4.2). isOut() says which.
    if (isOut(inn, id)) return REFUSAL.BATTER_ALREADY_OUT;
  }

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
 * Did this bowler bowl any of the previous over? Law 17.8: "a bowler shall not
 * bowl two overs, or parts thereof, consecutively in the same innings". Read
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
