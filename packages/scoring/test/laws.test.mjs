/**
 * What a scoring command may be — lawsRefusal() and the fold it reads.
 *
 * Groups A–D translate the AntiGravity spec for its delivery rules
 * (scrbrd_antigravity src/lib/scoring/__tests__/deliveryRules.test.ts) into
 * this event model. Where the two models differ the test says so and asserts
 * what THIS model does, rather than quietly dropping the case:
 *
 *   - AG refuses a bowled on a free hit. Here the fold records the delivery and
 *     saves the batter (SCORING_RULES.md §6), so it is accepted and the wicket
 *     does not stand.
 *   - AG models a wicket ON a no-ball or a wide (extraType + isWicket). Here a
 *     wicket is its own delivery type, W, which is legal; "caught off a
 *     no-ball" and "stumped off a wide" cannot be written, so there is nothing
 *     to refuse. "A single bye off a no-ball" can be written since SCRBRD-068
 *     (`nbRuns: "byes"`) — group M.
 *
 * Groups E onwards are the lifecycle and undo rules this repository adds.
 *
 * Every judgement is asked TWICE — of MatchFold.view() (what the server
 * holds) and of deriveInnings() per innings (what the scorer holds) — and the
 * two must agree. A rule that answered differently on the phone and on the
 * server would be the second implementation this exists to prevent.
 *
 *   node packages/scoring/test/laws.test.mjs
 */
import {
  deriveInnings, deriveMatch, MatchFold, lawsRefusal, REFUSAL, REFUSAL_TEXT,
  inningsStart, batters, bowler, ball, retire, penalty, revision, voidEvent, sealInnings, inningsEnd,
  BALL_TYPE, INNINGS_END_REASON, standsOnFreeHit, DISMISSAL,
  deriveInningsList, shortRunning, PENALTY_REASON, PENALTY_REASON_SIDE, PENALTY_REASON_TEXT, normalisePenaltyReason,
} from "../src/index.mjs";

/** @import { LogEvent, InningsStartInput } from "../src/events.mjs" */
/** @import { Innings } from "../src/replay.mjs" */
/** @import { MatchView } from "../src/laws.mjs" */

let pass = 0, fail = 0;
/** @param {string} n  @param {unknown} c  @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d).slice(0, 200)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
/**
 * The value an assertion reads, which the setup guarantees is there: a
 * missing one fails the suite loudly instead of being read as a property.
 * @template T  @param {T} x  @returns {NonNullable<T>}
 */
const must = (x) => { if (x == null) throw new Error("laws.test: expected a value"); return x; };

const SQ_A = ["p1", "p2", "p3", "p4", "p5"].map((id) => ({ id, name: id.toUpperCase() }));
const SQ_B = ["w1", "w2", "w3", "w4", "w5"].map((id) => ({ id, name: id.toUpperCase() }));

let n = 0;
/**
 * Give every event an id and an innings, the way the scorer's emit() does.
 * @param {number} innings
 * @param {...LogEvent} evs
 * @returns {(LogEvent & {innings: number, id: string})[]}
 */
const at = (innings, ...evs) => evs.map((e) => ({ ...e, innings, id: e.id ?? `e${++n}` }));
const open = (innings = 0, /** @type {InningsStartInput} */ o = {}) => at(innings,
  inningsStart({ battingTeam: innings ? "B" : "A", bowlingTeam: innings ? "A" : "B",
                 squad: innings ? SQ_B : SQ_A, bowlingSquad: innings ? SQ_A : SQ_B, overs: 2, ...o }),
  batters(innings ? { striker: "w1", nonStriker: "w2" } : { striker: "p1", nonStriker: "p2" }),
  bowler({ bowler: innings ? "p5" : "w1" }));
/** @param {number} innings  @param {...number} vs */
const runs = (innings, ...vs) => at(innings, ...vs.map((v) => ball({ type: BALL_TYPE.RUN, value: v })));

/**
 * The scorer's view: per-innings logs, folded by deriveInningsList() — each
 * innings' own fold, with penalty runs to a fielding side credited across
 * innings (SCRBRD-094); deriveInnings() per innings where no such award is
 * in the log, which is every group but N.
 * @param {LogEvent[]} log
 * @returns {MatchView}
 */
function clientView(log) {
  /** @type {LogEvent[][]} */
  const events = [];
  for (const e of log) (events[e.innings ?? 0] ??= []).push(e);
  return { events, innings: deriveInningsList([...events].map((l) => l ?? [])) };
}

/**
 * Ask both sides; report a disagreement as a failure of its own.
 * @param {LogEvent[]} log  @param {LogEvent} ev  @param {string} [label]
 */
function judge(log, ev, label = "") {
  const server = lawsRefusal(new MatchFold(log).view(), ev);
  const client = lawsRefusal(clientView(log), ev);
  ok(`server and scorer agree${label ? ` (${label})` : ""}`, server === client, { server, client });
  return server;
}

// ── A. The AntiGravity delivery rules, in this model ──────────────
group("A. validateDelivery, translated");
{
  const L = [...open(0), ...runs(0, 1)];
  ok("accepts an ordinary delivery", judge(L, at(0, ball({ value: 0 }))[0]) === null);

  const noPartner = at(0, inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A, overs: 2 }),
                          batters({ striker: "p1" }), bowler({ bowler: "w1" }));
  ok("needs a non-striker (AG: 'both batters')", judge(noPartner, at(0, ball({}))[0]) === REFUSAL.OPENERS);
  ok("needs a bowler", judge(at(0, inningsStart({ battingTeam: "A", squad: SQ_A }), batters({ striker: "p1", nonStriker: "p2" })),
                             at(0, ball({}))[0]) === REFUSAL.OPENING_BOWLER);

  const fullOver = [...open(0), ...runs(0, 0, 0, 0, 0, 0, 0)];
  ok("refuses the same bowler for consecutive overs",
     judge(fullOver, at(0, bowler({ bowler: "w1" }))[0]) === REFUSAL.CONSECUTIVE_OVERS);
  ok("accepts a change of bowler at the end of the over",
     judge(fullOver, at(0, bowler({ bowler: "w2" }))[0]) === null);
  ok("...and a ball once he is on", judge([...fullOver, ...at(0, bowler({ bowler: "w2" }))], at(0, ball({}))[0]) === null);
  ok("lets the same bowler carry on mid-over", judge([...open(0), ...runs(0, 0, 0)], at(0, ball({}))[0]) === null);

  // Divergence 1: a free hit SAVES here; it is not refused.
  const nb = [...open(0), ...at(0, ball({ type: BALL_TYPE.NO_BALL, value: 0 }))];
  const bowledOnFreeHit = at(0, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }))[0];
  ok("a bowled on a free hit is recorded (AG refuses it; the fold saves the batter)", judge(nb, bowledOnFreeHit) === null);
  const saved = deriveInnings([...nb, bowledOnFreeHit]);
  ok("...and the batter is not out", saved.wickets === 0 && saved.ballLog.at(-1)?.freeHitSaved === true);

  const runOutNS = at(0, ball({ type: BALL_TYPE.WICKET, dismissal: "run_out", dismissed: "p2" }))[0];
  ok("accepts a run out of the non-striker on a free hit", judge(nb, runOutNS) === null);
  const ro = deriveInnings([...nb, runOutNS]);
  ok("...and it stands, against the non-striker", ro.wickets === 1 && ro.batsmen.find((b) => b.id === "p2")?.status === "out");

  // Five legal, a no-ball, the legal sixth: the over ends on a legal ball, so
  // the first ball of the next over is not a free hit.
  const endsLegal = [...open(0), ...runs(0, 0, 0, 0, 0, 0), ...at(0, ball({ type: BALL_TYPE.NO_BALL })), ...runs(0, 0),
                     ...at(0, bowler({ bowler: "w2" }))];
  const bowled = at(0, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }))[0];
  ok("does not carry a free hit into the next over", judge(endsLegal, bowled) === null
     && deriveInnings([...endsLegal, bowled]).wickets === 1);

  ok("refuses dismissing a player who is not batting",
     judge(L, at(0, ball({ type: BALL_TYPE.WICKET, dismissal: "run_out", dismissed: "p7" }))[0]) === REFUSAL.NOT_AT_CREASE);
}

group("B. isFreeHitPending, as the fold's own free-hit state");
{
  const fh = (/** @type {string[]} */ ...kinds) => deriveInnings([...open(0), ...at(0, ...kinds.map((t) => ball({ type: t })))]).freeHit;
  ok("is false at the start of an over", fh() === false);
  ok("follows a no-ball", fh(BALL_TYPE.NO_BALL) === true);
  ok("carries over a wide bowled on the free hit", fh(BALL_TYPE.NO_BALL, BALL_TYPE.WIDE) === true);
  ok("is used up by a legal delivery", fh(BALL_TYPE.NO_BALL, BALL_TYPE.RUN) === false);
  ok("is renewed by a second no-ball", fh(BALL_TYPE.NO_BALL, BALL_TYPE.NO_BALL) === true);
  ok("does not follow a wide on its own", fh(BALL_TYPE.WIDE) === false);
}

group("C. isDismissalAllowed on a free hit — one set, NON_DELIVERY");
{
  for (const d of [DISMISSAL.BOWLED, DISMISSAL.CAUGHT, DISMISSAL.STUMPED, DISMISSAL.LBW]) {
    ok(`${d} does not stand on a free hit`, standsOnFreeHit(d) === false);
  }
  for (const d of [DISMISSAL.RUN_OUT, DISMISSAL.OBSTRUCTING_FIELD, DISMISSAL.HANDLED_BALL]) {
    ok(`${d} stands on a free hit`, standsOnFreeHit(d) === true);
  }
}

group("D. runsCompleted — the runs that decide strike, as the fold rotates it");
{
  /** @param {string} type  @param {number} value */
  const strikerAfter = (type, value) => deriveInnings([...open(0), ...at(0, ball({ type, value }))]).striker;
  ok("a plain wide is not a run", strikerAfter(BALL_TYPE.WIDE, 0) === "p1");
  ok("a wide the batters ran one on is one run", strikerAfter(BALL_TYPE.WIDE, 1) === "p2");
  ok("five wides to the boundary is four, so no change of ends", strikerAfter(BALL_TYPE.WIDE, 4) === "p1");
  ok("a no-ball hit for a single is one run", strikerAfter(BALL_TYPE.NO_BALL, 1) === "p2");
  ok("byes and leg byes count in full", strikerAfter(BALL_TYPE.BYE, 2) === "p1" && strikerAfter(BALL_TYPE.LEG_BYE, 1) === "p2");
  ok("runs off the bat count in full", strikerAfter(BALL_TYPE.RUN, 3) === "p2");
}

// ── E. The innings, and the match, in order ──────────────────────
group("E. Innings in order; no ball once the match is decided");
{
  const firstDone = [...open(0), ...runs(0, 1, 0, 0, 0, 0, 0), ...at(0, bowler({ bowler: "w2" })), ...runs(0, 0, 0, 0, 0, 0, 0)];
  ok("the first innings is over at 12 balls (2 overs)", deriveInnings(firstDone).complete === true);
  ok("a ball in it now is refused as over", judge(firstDone, at(0, ball({}))[0]) === REFUSAL.INNINGS_OVER);
  const sealed = [...firstDone, ...at(0, sealInnings(deriveInnings(firstDone)))];
  ok("...and as closed once sealed", judge(sealed, at(0, ball({}))[0]) === REFUSAL.INNINGS_CLOSED);

  const early = [...open(0), ...runs(0, 1), ...open(1)];
  ok("the second innings cannot start while the first is open",
     judge(early, at(1, ball({}))[0]) === REFUSAL.PREVIOUS_INNINGS_OPEN);
  const declared = [...early, ...at(0, inningsEnd({ reason: INNINGS_END_REASON.DECLARED, confirmed: { runs: 1, wickets: 0, balls: 1 } }))];
  ok("...and can once it is declared", judge(declared, at(1, ball({}))[0]) === null);

  // The break re-declares the chase with its target (engine.jsx, SCRBRD-063).
  const chase = [...sealed, ...open(1, { target: 2 }), ...runs(1, 1)];
  ok("once the second innings has a ball, the first takes no more play",
     judge(chase, at(0, batters({ striker: "p3" }))[0]) === REFUSAL.LATER_INNINGS_STARTED);

  // Target is 2 (first innings made 1). One more run wins it.
  const won = [...chase, ...runs(1, 1)];
  ok("the chase is won", deriveMatch(won).result?.winner === "B");
  const winningBall = must(won.at(-1));
  ok("no ball after the match is decided (AG recordBallAction)", judge(won, at(1, ball({}))[0]) === REFUSAL.MATCH_DECIDED);
  ok("...but the winning ball can still be undone", judge(won, at(1, voidEvent({ target: winningBall.id }))[0]) === null);
  const undone = [...won, ...at(1, voidEvent({ target: winningBall.id }))];
  ok("...and then play resumes", judge(undone, at(1, ball({}))[0]) === null);
}

group("F. At the crease");
{
  const L = [...open(0), ...runs(0, 0)];
  ok("the same batter at both ends is refused", judge(L, at(0, batters({ striker: "p2" }))[0]) === REFUSAL.SAME_BATTER_BOTH_ENDS);
  ok("...as openers too", judge(at(0, inningsStart({ battingTeam: "A", squad: SQ_A })),
                                 at(0, batters({ striker: "p1", nonStriker: "p1" }))[0]) === REFUSAL.SAME_BATTER_BOTH_ENDS);
  ok("a not-out batter cannot be replaced once play has started",
     judge(L, at(0, batters({ striker: "p3" }))[0]) === REFUSAL.CREASE_OCCUPIED);
  ok("...but the openers can be corrected before the first ball",
     judge(open(0), at(0, batters({ striker: "p3", nonStriker: "p4" }))[0]) === null);
  ok("...and the ends can always be swapped", judge(L, at(0, batters({ striker: "p2", nonStriker: "p1" }))[0]) === null);

  const out = [...L, ...at(0, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }))];
  ok("a new batter fills the empty end", judge(out, at(0, batters({ striker: "p3" }))[0]) === null);
  ok("a dismissed batter cannot come back", judge(out, at(0, batters({ striker: "p1" }))[0]) === REFUSAL.BATTER_ALREADY_OUT);

  const hurt = [...L, ...at(0, retire({ batter: "p2", reason: "hurt" }), batters({ nonStriker: "p3" })),
                ...runs(0, 0), ...at(0, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }))];
  ok("a batter retired hurt may resume (Law 25.4.2)", judge(hurt, at(0, batters({ striker: "p2" }))[0]) === null);
  const retOut = [...L, ...at(0, retire({ batter: "p2", reason: "out" }))];
  ok("a batter retired out may not (Law 25.4.3)", judge(retOut, at(0, batters({ nonStriker: "p2" }))[0]) === REFUSAL.BATTER_ALREADY_OUT);
  ok("only a batter who is in can retire", judge(L, at(0, retire({ batter: "p4" }))[0]) === REFUSAL.NOT_AT_CREASE);

  // Law 17.8, "or parts thereof": a mid-over change bars BOTH bowlers from the next over.
  const shared = [...open(0), ...runs(0, 0, 0, 0), ...at(0, bowler({ bowler: "w3" })), ...runs(0, 0, 0, 0)];
  // SCRBRD-080: accepted with the reason Law 17.8.1 gives; refused without.
  ok("a mid-over change of bowler is accepted with its reason (Law 17.8.1)",
     judge([...open(0), ...runs(0, 0)], at(0, bowler({ bowler: "w3", reason: "injury" }))[0]) === null);
  ok("...and neither man who shared the over may bowl the next",
     judge(shared, at(0, bowler({ bowler: "w1" }))[0]) === REFUSAL.CONSECUTIVE_OVERS
     && judge(shared, at(0, bowler({ bowler: "w3" }))[0]) === REFUSAL.CONSECUTIVE_OVERS
     && judge(shared, at(0, bowler({ bowler: "w2" }))[0]) === null);
}

group("G. Nothing belongs to an innings nobody opened");
{
  for (const [label, ev] of /** @type {[string, LogEvent][]} */ ([
         ["batters", batters({ striker: "p1", nonStriker: "p2" })], ["bowler", bowler({ bowler: "w1" })],
         ["ball", ball({})], ["penalty", penalty({ runs: 5 })], ["revision", revision({ overs: 10 })],
         ["retire", retire({ batter: "p1" })], ["innings_end", inningsEnd({ reason: "abandoned" })]])) {
    ok(`${label} before innings_start is refused`, judge([], at(0, ev)[0], label) === REFUSAL.NO_INNINGS);
  }
  ok("an event kind this build does not know is not refused for being new",
     // @ts-expect-error a kind outside LogEvent is the case under test
     judge(open(0), at(0, { kind: "drinks_break" })[0]) === null);
}

// ── H. Undo is last-in, first-out ─────────────────────────────────
group("H. A live void names the latest event that still counts");
{
  const L = [...open(0), ...runs(0, 1, 4, 6)];
  const [b1, b4, b6] = L.slice(-3);
  ok("the latest ball may be undone", judge(L, at(0, voidEvent({ target: b6.id }))[0]) === null);
  ok("an older one may not — that is an amendment", judge(L, at(0, voidEvent({ target: b1.id }))[0]) === REFUSAL.VOID_NOT_LATEST);
  const once = [...L, ...at(0, voidEvent({ target: b6.id }))];
  ok("after one undo, the next latest is the one before it", judge(once, at(0, voidEvent({ target: b4.id }))[0]) === null);
  ok("the undone one cannot be undone twice", judge(once, at(0, voidEvent({ target: b6.id }))[0]) === REFUSAL.VOID_ALREADY_VOIDED);
  ok("an undo cannot be undone", judge(once, at(0, voidEvent({ target: must(once.at(-1)).id }))[0]) === REFUSAL.VOID_OF_VOID);
  // @ts-expect-error a void with no target is the case under test
  ok("a void must name something", judge(L, at(0, voidEvent({}))[0]) === REFUSAL.VOID_NO_TARGET);
  ok("...that this match has", judge(L, at(0, voidEvent({ target: "nope" }))[0]) === REFUSAL.VOID_UNKNOWN_TARGET);
  ok("...in the innings the void is filed under", judge(L, at(1, voidEvent({ target: b6.id }))[0]) === REFUSAL.VOID_WRONG_INNINGS);
  const onlyStart = at(0, inningsStart({ battingTeam: "A", squad: SQ_A }));
  ok("innings_start is never undone", judge(onlyStart, at(0, voidEvent({ target: onlyStart[0].id }))[0]) === REFUSAL.VOID_FOUNDATION);

  const second = [...L, ...at(0, inningsEnd({ reason: "declared", confirmed: { runs: 11, wickets: 0, balls: 3 } })), ...open(1), ...runs(1, 2)];
  ok("the last event of the first innings cannot be undone once the second has play",
     judge(second, at(0, voidEvent({ target: must(second.find((e) => e.kind === "innings_end")).id }))[0]) === REFUSAL.VOID_NOT_LATEST);
  // The scorer opens BOTH innings at setup (engine.jsx startMatch), so an
  // innings_start for innings 1 sits in the log from the first ball. It is not
  // play, and must not freeze undo in innings 0.
  const upfront = [...open(0).slice(0, 1), ...open(1).slice(0, 1), ...open(0).slice(1), ...runs(0, 1)];
  ok("the second innings opened up front does not block undo in the first",
     judge(upfront, at(0, voidEvent({ target: must(upfront.at(-1)).id }))[0]) === null);
}

// ── I. MatchFold is deriveInnings, extended ──────────────────────
group("I. The incremental fold agrees with the full one");
{
  const log = [...open(0), ...runs(0, 1, 4), ...at(0, ball({ type: BALL_TYPE.WIDE, value: 1 }), ball({ type: BALL_TYPE.NO_BALL, value: 2 })),
               ...runs(0, 6)];
  const six = must(log.at(-1));
  const rest = [...at(0, voidEvent({ target: six.id })), ...runs(0, 0, 0, 0), ...at(0, bowler({ bowler: "w2" })),
                ...runs(0, 1, 1), ...at(0, revision({ overs: 1 }))];
  const f = new MatchFold(log);
  for (const e of rest) f.push(e);
  const all = [...log, ...rest];
  const inc = f.view().innings[0];
  const full = deriveInnings(all);
  const same = /** @type {(keyof Innings)[]} */ (["runs", "wickets", "balls", "striker", "nonStriker", "bowler", "freeHit", "complete", "endReason", "voided", "overs"])
    .every((k) => inc[k] === full[k]);
  ok("same figures, crease and state after pushes, a void and a revision", same,
     { inc: [inc.runs, inc.balls, inc.complete, inc.endReason], full: [full.runs, full.balls, full.complete, full.endReason] });
  ok("the voided six is not in it", inc.runs === full.runs && !inc.ballLog.some((b) => b.id === six.id));
  const reopened = new MatchFold(all);
  reopened.push(at(0, revision({ overs: 5 }))[0]);
  ok("a revision can reopen an innings the view had settled as over",
     new MatchFold(all).view().innings[0].complete === true && reopened.view().innings[0].complete === false);
  ok("view() settles on a copy: the live fold is not marked complete", f.byInnings.get(0)?.inn.complete === false);
}

// ── K. Dismissals with no delivery (SCRBRD-081) ─────────────────
group("K. Timed out and retired out: a retire marked W");
{
  const L = [...open(0), ...runs(0, 1, 0)];   // p2 on strike, p1 at the other end
  ok("retired out of a batter who is in is accepted",
     judge(L, at(0, retire({ batter: "p1", reason: "out" }))[0]) === null);
  ok("...of one who is not, refused", judge(L, at(0, retire({ batter: "p4", reason: "out" }))[0]) === REFUSAL.NOT_AT_CREASE);

  const out = [...L, ...at(0, ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }))];
  ok("timed out of the batter due in, after a wicket, is accepted",
     judge(out, at(0, retire({ batter: "p3", reason: "timed_out" }))[0]) === null);
  ok("...of a batter at the crease, refused: he got there", judge(out, at(0, retire({ batter: "p1", reason: "timed_out" }))[0]) === REFUSAL.NOT_NEXT_IN);
  ok("...while both ends are filled, refused: nobody is due",
     judge(L, at(0, retire({ batter: "p3", reason: "timed_out" }))[0]) === REFUSAL.NOT_NEXT_IN);
  ok("...of an opener, refused: Law 40 is the incoming batter's",
     judge(at(0, inningsStart({ battingTeam: "A", squad: SQ_A }), batters({ striker: "p1" }), bowler({ bowler: "w1" })),
           at(0, retire({ batter: "p2", reason: "timed_out" }))[0]) === REFUSAL.NOT_NEXT_IN);
  ok("...of a batter already out, refused", judge(out, at(0, retire({ batter: "p2", reason: "timed_out" }))[0]) === REFUSAL.BATTER_ALREADY_OUT);
  const timed = [...out, ...at(0, retire({ batter: "p3", reason: "timed_out" }))];
  ok("a batter timed out does not come in afterwards", judge(timed, at(0, batters({ striker: "p3" }))[0]) === REFUSAL.BATTER_ALREADY_OUT);
  ok("...the next one does", judge(timed, at(0, batters({ striker: "p4" }))[0]) === null);
  const retOut = [...L, ...at(0, retire({ batter: "p1", reason: "out" }))];
  ok("a batter retired out does not come back", judge(retOut, at(0, batters({ nonStriker: "p1" }))[0]) === REFUSAL.BATTER_ALREADY_OUT);

  /** @type {LogEvent} */
  const bowledNoBall = { kind: "retire", batter: "p1", reason: "out", type: "W", dismissal: "bowled" };
  ok("no other way out is recorded without a ball", judge(L, at(0, bowledNoBall)[0]) === REFUSAL.NEEDS_A_DELIVERY);

  // The over does not move, so Law 17.8 reads the same after one.
  const overDone = [...open(0), ...runs(0, 0, 0, 0, 0, 0, 0), ...at(0, retire({ batter: "p1", reason: "out" }), batters({ striker: "p3" }))];
  ok("the over is still over: the same bowler may not start the next",
     judge(overDone, at(0, bowler({ bowler: "w1" }))[0]) === REFUSAL.CONSECUTIVE_OVERS);
  const midOver = [...open(0), ...runs(0, 0, 0), ...at(0, retire({ batter: "p1", reason: "out" }), batters({ striker: "p3" }))];
  ok("...and mid-over the same bowler carries on", judge(midOver, at(0, ball({}))[0]) === null
     && deriveInnings([...midOver, ...at(0, ball({}))]).bowler === "w1");

  // The last man out on no ball ends the innings; nothing more is recorded.
  const small = at(0, inningsStart({ battingTeam: "A", bowlingTeam: "B", squad: SQ_A.slice(0, 2), bowlingSquad: SQ_B, overs: 2 }),
                   batters({ striker: "p1", nonStriker: "p2" }), bowler({ bowler: "w1" }), ball({}));
  const allOut = [...small, ...at(0, retire({ batter: "p2", reason: "out" }))];
  ok("retired out can end an innings", deriveInnings(allOut).complete === true);
  ok("...after which a ball is refused", judge(allOut, at(0, ball({}))[0]) === REFUSAL.INNINGS_OVER);
  ok("...and so is another dismissal without one", judge(allOut, at(0, retire({ batter: "p1", reason: "out" }))[0]) === REFUSAL.INNINGS_OVER);

  // The shape before SCRBRD-081 is still taken: an older build's queue syncs.
  ok("a W delivery naming timed out (the old shape) is still accepted",
     judge(L, at(0, ball({ type: BALL_TYPE.WICKET, dismissal: "timed_out" }))[0]) === null);
  ok("retired hurt is judged as it always was", judge(L, at(0, retire({ batter: "p1", reason: "hurt" }))[0]) === null);
}

// ── L. A mid-over change of bowler says why (SCRBRD-080) ────────
group("L. A bowler replaced during an over: injury or suspended");
{
  const two = [...open(0), ...runs(0, 0, 0, 1)];   // three balls of the first over
  ok("with no reason, refused", judge(two, at(0, bowler({ bowler: "w3" }))[0]) === REFUSAL.MID_OVER_NO_REASON);
  ok("injured, accepted", judge(two, at(0, bowler({ bowler: "w3", reason: "injury" }))[0]) === null);
  ok("suspended, accepted", judge(two, at(0, bowler({ bowler: "w3", reason: "suspended" }))[0]) === null);
  /** @type {LogEvent} */
  const odd = /** @type {LogEvent} */ (/** @type {unknown} */ ({ kind: "bowler", bowler: "w3", reason: "tired" }));
  ok("a reason the model does not know, refused", judge(two, at(0, odd)[0]) === REFUSAL.MID_OVER_NO_REASON);
  let threw = false;
  try { bowler({ bowler: "w3", reason: "tired" }); } catch { threw = true; }
  ok("...and the constructor will not build one", threw);
  ok("naming the bowler already on is no change, and needs none", judge(two, at(0, bowler({ bowler: "w1" }))[0]) === null);
  // A wide is part of the over: a change after it is mid-over too.
  const wide = [...open(0), ...runs(0, 0, 0, 0, 0, 0), ...at(0, bowler({ bowler: "w2" }), ball({ type: BALL_TYPE.WIDE }))];
  ok("after a wide that opened an over, a change is mid-over", judge(wide, at(0, bowler({ bowler: "w3" }))[0]) === REFUSAL.MID_OVER_NO_REASON);
  // Not mid-over: the start of an over, or before the first ball.
  const done = [...open(0), ...runs(0, 0, 0, 0, 0, 0, 0)];
  ok("a new over needs no reason", judge(done, at(0, bowler({ bowler: "w2" }))[0]) === null);
  ok("nor does correcting the opening bowler before a ball", judge(open(0), at(0, bowler({ bowler: "w2" }))[0]) === null);
  // A pad holding balls the server refused for want of a bowler (the held
  // cascade, SCRBRD-070) has balls in an over and nobody on: naming one then
  // replaces nobody.
  const nobodyOn = [...open(0), ...runs(0, 0, 0, 0, 0, 0, 0), ...runs(0, 4)];
  ok("with balls in the over and nobody on, naming a bowler needs no reason",
     deriveInnings(nobodyOn).bowler === null && judge(nobodyOn, at(0, bowler({ bowler: "w2" }))[0]) === null
     && deriveInnings([...nobodyOn, ...at(0, bowler({ bowler: "w2" }))]).bowlerChanges.length === 0);
  // Law 17.8, "or parts thereof", still binds the man who finished the over.
  const finished = [...two, ...at(0, bowler({ bowler: "w3", reason: "injury" })), ...runs(0, 0, 0, 0)];
  ok("the replacement may not bowl the next over", judge(finished, at(0, bowler({ bowler: "w3" }))[0]) === REFUSAL.CONSECUTIVE_OVERS);
  ok("...nor the injured man", judge(finished, at(0, bowler({ bowler: "w1" }))[0]) === REFUSAL.CONSECUTIVE_OVERS);
  // The fold records who took over, when, and why; the balls are his.
  const inn = deriveInnings(finished);
  ok("the fold records the change: over 1, after 3 balls, w1 to w3, injury",
     inn.bowlerChanges.length === 1 && inn.bowlerChanges[0].over === 0 && inn.bowlerChanges[0].ballInOver === 3
     && inn.bowlerChanges[0].from === "w1" && inn.bowlerChanges[0].to === "w3" && inn.bowlerChanges[0].reason === "injury");
  ok("...and splits the over's balls between them",
     inn.bowlers.find((b) => b.id === "w1")?.balls === 3 && inn.bowlers.find((b) => b.id === "w3")?.balls === 3);
  // A log from before the pad asked still replays, and says it did not say.
  const old = deriveInnings([...two, { kind: "bowler", bowler: "w3", innings: 0 }, ...runs(0, 0, 0)]);
  ok("an old mid-over change with no reason replays, its reason unknown",
     old.bowler === "w3" && old.bowlerChanges.length === 1 && old.bowlerChanges[0].reason === null && old.balls === 5);
  ok("a bowler for a new over is not a change", deriveInnings(done).bowlerChanges.length === 0
     && deriveInnings([...done, ...at(0, bowler({ bowler: "w2" }))]).bowlerChanges.length === 0);
}

// ── M. Whose the runs off a no-ball are (SCRBRD-068) ────────────
group("M. No-ball byes and leg byes at commit");
{
  const L = [...open(0), ...runs(0, 1)];
  ok("byes off a no-ball are accepted", judge(L, at(0, ball({ type: BALL_TYPE.NO_BALL, value: 2, nbRuns: "byes" }))[0]) === null);
  ok("leg byes off one too", judge(L, at(0, ball({ type: BALL_TYPE.NO_BALL, value: 1, nbRuns: "leg_byes" }))[0]) === null);
  ok("a no-ball hit for runs, as always", judge(L, at(0, ball({ type: BALL_TYPE.NO_BALL, value: 4 }))[0]) === null);
  const odd = /** @type {LogEvent} */ (/** @type {unknown} */ ({ kind: "ball", type: "Nb", value: 2, nbRuns: "overthrows" }));
  ok("anything else is refused: the fold would read it as off the bat", judge(L, at(0, odd)[0]) === REFUSAL.NB_RUNS_UNKNOWN);
  const onBye = /** @type {LogEvent} */ (/** @type {unknown} */ ({ kind: "ball", type: "B", value: 2, nbRuns: "byes" }));
  ok("...and so is the field on a delivery that is not a no-ball", judge(L, at(0, onBye)[0]) === REFUSAL.NB_RUNS_UNKNOWN);
  // Both folds agree on what it scored.
  const log = [...L, ...at(0, ball({ type: BALL_TYPE.NO_BALL, value: 3, nbRuns: "leg_byes" }))];
  const server = new MatchFold(log).view().innings[0];
  const client = deriveInnings(log);
  ok("the server's fold and the pad's agree on it",
     server.runs === client.runs && server.extras.noBall === client.extras.noBall && server.striker === client.striker
     && server.batsmen.find((b) => b.id === "p2")?.runs === client.batsmen.find((b) => b.id === "p2")?.runs
     && client.batsmen.find((b) => b.id === "p2")?.runs === 0);
}

// ── N. The end a run out happened at (SCRBRD-069) ─────────────
group("N. A run out that completed runs, and the end it was at");
{
  const L = [...open(0), ...runs(0, 0)];
  const ro = at(0, ball({ type: BALL_TYPE.WICKET, value: 1, dismissal: "run_out", dismissed: "p2", outAt: "striker_end" }))[0];
  ok("a run out with its end is accepted", judge(L, ro) === null);
  const bad = /** @type {LogEvent} */ (/** @type {unknown} */ ({ kind: "ball", type: "W", value: 1, dismissal: "run_out", outAt: "long_leg" }));
  ok("an end that is neither is refused", judge(L, at(0, bad)[0]) === REFUSAL.OUT_AT_UNKNOWN);
  const onRun = /** @type {LogEvent} */ (/** @type {unknown} */ ({ kind: "ball", type: "run", value: 1, outAt: "bowler_end" }));
  ok("...and so is an end on a delivery that is not a wicket", judge(L, at(0, onRun)[0]) === REFUSAL.OUT_AT_UNKNOWN);
  let threw = false;
  try { ball({ type: BALL_TYPE.RUN, value: 1, outAt: "bowler_end" }); } catch { threw = true; }
  ok("...which the constructor will not build", threw);
  // Both folds put the survivor at the same end, and the next batter the
  // server takes is the one sent to the empty end.
  const log = [...L, ro];
  const server = new MatchFold(log).view().innings[0];
  const client = deriveInnings(log);
  ok("server and pad agree: the striker's end is empty, p1 at the other",
     server.striker === null && client.striker === null && server.nonStriker === "p1" && client.nonStriker === "p1");
  ok("the new batter goes to the striker's end", judge(log, at(0, batters({ striker: "p3" }))[0]) === null);
  ok("...not over the survivor", judge(log, at(0, batters({ nonStriker: "p3" }))[0]) === REFUSAL.CREASE_OCCUPIED);
}

group("O. Penalty runs: whole runs, a reason from the list, the right side (SCRBRD-090/094)");
{
  const L = [...open(0), ...runs(0, 1)];
  const pen = (/** @type {Parameters<typeof penalty>[0]} */ o) => at(0, penalty(o))[0];
  ok("five to the batting side, for a fielding offence, is taken", judge(L, pen({ reason: "helmet_struck" })) === null);
  ok("five to the fielding side, for a batting offence, is taken",
     judge(L, pen({ toBattingTeam: false, reason: "pitch_damage" })) === null);
  ok("...and one with no reason (a log from elsewhere)", judge(L, pen({})) === null);
  for (const [runs_, label] of /** @type {[unknown, string][]} */ ([["5", "a string"], [2.5, "a fraction"], [0, "nought"], [-5, "negative"]])) {
    const ev = /** @type {LogEvent} */ (/** @type {unknown} */ ({ ...pen({}), runs: runs_ }));
    ok(`runs that are ${label} are refused`, judge(L, ev, label) === REFUSAL.PENALTY_RUNS_INVALID);
  }
  const unknown = /** @type {LogEvent} */ (/** @type {unknown} */ ({ ...pen({}), reason: "being cheeky" }));
  ok("a reason the list does not name is refused", judge(L, unknown) === REFUSAL.PENALTY_REASON_UNKNOWN);
  let threw = false;
  try { penalty({ reason: "being cheeky" }); } catch { threw = true; }
  ok("...which the constructor will not build", threw);
  ok("a batting side's offence awarded to the batting side is refused",
     judge(L, pen({ toBattingTeam: true, reason: "short_running" })) === REFUSAL.PENALTY_REASON_SIDE);
  ok("...and a fielding side's to the fielding side",
     judge(L, pen({ toBattingTeam: false, reason: "ball_tampering" })) === REFUSAL.PENALTY_REASON_SIDE);
  ok("'other' is either side's", judge(L, pen({ toBattingTeam: false, reason: "other" })) === null
     && judge(L, pen({ reason: "other" })) === null);

  // The pad's free text from before the list closed: read, never refused.
  const legacy = /** @type {LogEvent} */ (/** @type {unknown} */ ({ ...pen({}), reason: "Ball hit helmet on field" }));
  ok("the pad's old free-text reasons are read as the reason they are", judge(L, legacy) === null
     && normalisePenaltyReason("Ball going into fielder's clothing") === "illegal_fielding"
     && normalisePenaltyReason("Penalty runs") === "other");
  ok("...'Deliberate time wasting' is whichever side wasted it",
     normalisePenaltyReason("Deliberate time wasting", true) === "fielding_time_wasting"
     && normalisePenaltyReason("Deliberate time wasting", false) === "time_wasting");
  ok("...and the constructor stores the reason, not the text", penalty({ reason: "Changing condition of ball" }).reason === "ball_tampering");
  ok("every reason has a side and words", Object.values(PENALTY_REASON).every((r) => r in PENALTY_REASON_SIDE && typeof PENALTY_REASON_TEXT[r] === "string"));
  ok("the fielding side's reasons are Kameel's Law 41 list",
     JSON.stringify(Object.values(PENALTY_REASON).filter((r) => PENALTY_REASON_SIDE[r] === false).sort())
     === JSON.stringify(["obstruction_distraction", "pitch_damage", "protected_area", "short_running", "striking_pitch", "time_wasting"]));

  // Deliberate short running: the delivery with no run, then the award.
  const [dot, award] = at(0, ...shortRunning({ type: BALL_TYPE.RUN, value: 2 }));
  ok("the short-run delivery is an ordinary ball", judge(L, dot) === null);
  ok("...and its award, straight after it, is taken", judge([...L, dot], award) === null);
  ok("the award with no delivery before it is refused", judge(open(0), award) === REFUSAL.SHORT_RUN_UNMATCHED);
  ok("...and after a delivery that scored", judge([...L, ...runs(0, 2)], award) === REFUSAL.SHORT_RUN_UNMATCHED);
  ok("...and after anything else", judge([...L, dot, ...at(0, penalty({ reason: "helmet_struck" }))], award) === REFUSAL.SHORT_RUN_UNMATCHED);
  const scored = runs(0, 2);
  ok("...a delivery undone is not the one it follows: the one before it that counts is",
     judge([...L, dot, ...scored, ...at(0, voidEvent({ target: scored[0].id }))], award) === null
     && judge([...L, ...runs(0, 1), dot, ...at(0, voidEvent({ target: dot.id }))], award) === REFUSAL.SHORT_RUN_UNMATCHED);

  // Once the match is decided, an award to the fielding side would move a
  // target nobody is chasing any more; short running's belongs to its ball.
  const decided = [...open(0), ...runs(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1), ...open(1, { target: 2 }), ...runs(1, 2)];
  ok("the chase is over", new MatchFold(decided).view().innings[1]?.complete === true);
  ok("an award to the fielding side is refused: the match is decided",
     judge(decided, at(1, penalty({ toBattingTeam: false, reason: "pitch_damage" }))[0]) === REFUSAL.MATCH_DECIDED);
  ok("...an award to the batting side is judged as it always was",
     judge(decided, at(1, penalty({ reason: "helmet_struck" }))[0]) === null);
  const lastBall = [...open(0), ...runs(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1), ...open(1, { target: 3 }), ...runs(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)];
  const [lastDot, lastAward] = at(1, ...shortRunning({ type: BALL_TYPE.RUN, value: 2 }));
  ok("short running on the last ball: the ball ends the chase", new MatchFold([...lastBall, lastDot]).view().innings[1]?.complete === true);
  ok("...and its award is still taken", judge([...lastBall, lastDot], lastAward) === null);
  const after = new MatchFold([...lastBall, lastDot, lastAward]).view();
  ok("...A's innings rises and the margin with it", after.innings[0].runs === 6
     && deriveMatch([...lastBall, lastDot, lastAward]).result?.margin === "7 runs");

  // Credited across innings on both sides of the wire alike: B open on 5.
  const carried = [...open(0), ...runs(0, 0), ...at(0, penalty({ toBattingTeam: false, reason: "pitch_damage" })),
                   ...runs(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1), ...open(1, { target: 2 })];
  ok("B open on 5 against a target of 2: the chase is over before a ball", new MatchFold(carried).view().innings[1]?.complete === true);
  ok("...so a ball is refused, by the server and by a pad folding the match", judge(carried, at(1, ball({}))[0]) === REFUSAL.MATCH_DECIDED);
}

group("J. Every reason has words for the person who has to clear it");
{
  const missing = Object.values(REFUSAL).filter((r) => typeof REFUSAL_TEXT[r] !== "string");
  ok("REFUSAL_TEXT covers every REFUSAL", missing.length === 0, missing);
}

console.log("\n" + "─".repeat(52));
console.log(`LAWS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
