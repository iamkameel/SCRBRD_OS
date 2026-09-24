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
 *   - a mid-over change of bowler (Law 17.8.1 allows it for an incapacitated or
 *     suspended bowler, and the event model does not say which a change is);
 *   - a stale or wrong seal (sealRefusal() in replay.mjs records and ignores
 *     it, by design, because an offline queue can replay one);
 *   - a late capture-profile declaration (the fold ignores it; SCRBRD-039);
 *   - how many innings a format has, and whether a player is in the squad
 *     (opposition players are typed names SCRBRD holds no row for).
 */
import { KIND, BALL_TYPE } from "./events.mjs";
import { scoringReadiness } from "./readiness.mjs";
import { voidedIds, lastUndoableIndex } from "./undo.mjs";

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
  // Undo.
  VOID_NO_TARGET:         "void_no_target",
  VOID_UNKNOWN_TARGET:    "void_unknown_target",    // names nothing in this innings of this match
  VOID_WRONG_INNINGS:     "void_wrong_innings",
  VOID_ALREADY_VOIDED:    "void_already_voided",
  VOID_OF_VOID:           "void_of_void",
  VOID_FOUNDATION:        "void_foundation",        // innings_start is never undone
  VOID_NOT_LATEST:        "void_not_latest",        // undo is last-in, first-out
});

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
  void_no_target: "the undo named no event",
  void_unknown_target: "the undo named an event this innings does not have",
  void_wrong_innings: "the undo named an event in a different innings",
  void_already_voided: "that event was already undone",
  void_of_void: "an undo cannot itself be undone — record the event again",
  void_foundation: "the start of an innings cannot be undone",
  void_not_latest: "only the latest event can be undone; older ones need an amendment",
  // The idempotency conflict is not a Law, but it is held the same way.
  idempotency_conflict: "a different event was already recorded under this event's id",
});

/**
 * @typedef {object} MatchView
 * @property {any[]}      innings  deriveInnings() state per innings number (sparse)
 * @property {object[][]} [events] each innings' own log, in order, voids included
 */

/** Events that happen at the crease and so need the innings to be in play. */
const PLAY = new Set([KIND.BALL, KIND.BATTERS, KIND.BOWLER, KIND.RETIRE, KIND.INNINGS_END]);

/**
 * Why this event may not be added to this match, or null when it may.
 *
 * Pure: reads the fold, changes nothing. An event of a kind it does not know
 * is not refused — the fold ignores unknown kinds, and a newer client's event
 * is not illegal for being newer.
 *
 * @param {MatchView} match
 * @param {any} ev   the pending event, in the client's shape (events.mjs)
 * @returns {string|null}  one of REFUSAL, or null
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
      return bowledLastOver(inn, ev.bowler) ? REFUSAL.CONSECUTIVE_OVERS : null;
    }
    case KIND.RETIRE: {
      if (inn?.battingTeam == null) return REFUSAL.NO_INNINGS;
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

/** A delivery. */
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

  if (inn.striker === inn.nonStriker) return REFUSAL.SAME_BATTER_BOTH_ENDS;
  if (bowledLastOver(inn, inn.bowler)) return REFUSAL.CONSECUTIVE_OVERS;

  // Whoever is out must be one of the two batting. `dismissed` defaults to
  // the striker at replay; one that names anyone else would record a wicket
  // for a boy who was not at the crease and leave the real pair untouched.
  if ((ev.type ?? BALL_TYPE.RUN) === BALL_TYPE.WICKET && ev.dismissed != null
      && ev.dismissed !== inn.striker && ev.dismissed !== inn.nonStriker) {
    return REFUSAL.NOT_AT_CREASE;
  }
  return null;
}

/** A new batter, the openers, or a change of ends. */
function battersRefusal(inn, ev) {
  const striker = ev.striker ?? inn.striker;
  const nonStriker = ev.nonStriker ?? inn.nonStriker;
  if (striker != null && striker === nonStriker) return REFUSAL.SAME_BATTER_BOTH_ENDS;

  const at = new Set([inn.striker, inn.nonStriker].filter((x) => x != null));
  for (const id of [ev.striker, ev.nonStriker]) {
    if (id == null || at.has(id)) continue;
    // A new arrival. Out is out; retired out is out (Law 25.4.3). Retired
    // hurt — "retired not out" — may resume (Law 25.4.2), and the fold keeps
    // the two apart only in the dismissal text it writes for a retirement.
    const b = inn.batsmen?.find((x) => x.id === id);
    if (b?.status === "out" || (b?.status === "retired" && b.dismissal === "retired out")) {
      return REFUSAL.BATTER_ALREADY_OUT;
    }
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

/** Is there play — a delivery — in any innings after this one? */
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
 * and are not judged here.
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
  const target = log.find((e) => e.id === ev.target);
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
