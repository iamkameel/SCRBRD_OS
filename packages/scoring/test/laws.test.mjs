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
 *     to refuse. Nor can "a single bye off a no-ball" (Nb's value is runs off
 *     the bat).
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
 * The scorer's view: per-innings logs, each folded by deriveInnings().
 * @param {LogEvent[]} log
 * @returns {MatchView}
 */
function clientView(log) {
  /** @type {LogEvent[][]} */
  const events = [];
  for (const e of log) (events[e.innings ?? 0] ??= []).push(e);
  return { events, innings: [...events].map((l) => (l ? deriveInnings(l) : null)) };
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
  ok("a mid-over change of bowler is accepted (Law 17.8.1 — not refused here)",
     judge([...open(0), ...runs(0, 0)], at(0, bowler({ bowler: "w3" }))[0]) === null);
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

group("J. Every reason has words for the person who has to clear it");
{
  const missing = Object.values(REFUSAL).filter((r) => typeof REFUSAL_TEXT[r] !== "string");
  ok("REFUSAL_TEXT covers every REFUSAL", missing.length === 0, missing);
}

console.log("\n" + "─".repeat(52));
console.log(`LAWS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
