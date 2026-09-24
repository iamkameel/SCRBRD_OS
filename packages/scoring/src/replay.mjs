/**
 * SCRBRD — Deterministic replay.
 *
 * `deriveInnings(events)` is a pure fold over the event log. It is the ONLY way
 * an innings state is obtained: nothing in the system stores a score.
 *
 * What this replaces
 * ──────────────────
 * The pre-repo artifact maintained the aggregates (runs, wickets, balls,
 * extras, per-batter and per-bowler figures, fall of wickets, partnerships)
 * *beside* the ball log, mutating both on every commit path. Two states that
 * can disagree eventually do: each new scoring path was a fresh chance to
 * update six counters and miss one, and the failure surfaced as a scorecard
 * that would not reconcile after the match, unfixable without a human
 * reconstructing what happened.
 *
 * Deriving has three consequences worth stating, because they are the reasons
 * this was done before the backend was connected rather than after:
 *
 *   - **Undo is exact and unbounded.** `events.slice(0, -1)` and re-derive.
 *     The artifact's capped 10-entry deep-copy snapshot stack existed only
 *     because aggregates could not be recomputed; a scorer who spotted at ball
 *     14 that ball 2 was wrong could not fix it. Now they can.
 *   - **Replay is the same operation everywhere.** Offline catch-up, scorer
 *     handover verification, realtime reconnect and dispute resolution are one
 *     function, not four.
 *   - **The server agrees with the client by construction**, because both fold
 *     the same log with this same module.
 *
 * Deliberate divergences from the artifact's behaviour are listed in
 * docs/SCORING_RULES.md and each has a test in test/replay.test.mjs. They are
 * places the artifact's hand-maintained counters did not follow the Laws of
 * Cricket; deriving made them visible.
 */

import { KIND, BALL_TYPE, isLegal, normaliseDismissal, chargedToBowler, standsOnFreeHit, DISMISSAL, DISMISSAL_LABEL, INNINGS_END_REASON, DERIVED_END_REASONS, RETIREMENT_DISMISSAL, inningsEnd } from "./events.mjs";
import { CAPTURE_PROFILE } from "./placement.mjs";

/** @import { LogEvent, SquadMember } from "./events.mjs" */
/** @typedef {import("./events.mjs").Loose<import("./events.mjs").BallEvent>} LoggedBall */
/** @typedef {import("./events.mjs").Loose<import("./events.mjs").InningsEndEvent>} LoggedSeal */

/** @type {ReadonlySet<unknown>}  asked of whatever an innings_start carried */
const DECLARABLE = new Set(Object.values(CAPTURE_PROFILE));

// The scoring UI renders on these values: a batter at the crease is "batting",
// and a squad member who never came in is "dnb" (never produced here — a batter
// only exists once they appear in the log).
const BAT_STATUS = { NOT_OUT: "batting", OUT: "out", RETIRED: "retired" };

/**
 * A batter's line on the card.
 * @typedef {object} Batter
 * @property {string} id
 * @property {string} name
 * @property {number} runs
 * @property {number} balls
 * @property {number} fours
 * @property {number} sixes
 * @property {string} status          one of BAT_STATUS: "batting" | "out" | "retired"
 * @property {string | null} dismissal the scorecard line, e.g. "c Naidoo b Mkhize"
 */

/**
 * A bowler's figures.
 * @typedef {object} Bowler
 * @property {string} id
 * @property {string} name
 * @property {number} runs      charged to him: not byes or leg byes
 * @property {number} balls     legal deliveries
 * @property {number} wickets
 * @property {number} wides
 * @property {number} noBalls
 * @property {number} maidens   settled after the fold (computeMaidens)
 */

/**
 * A delivery as the fold logged it: the event, stamped with who was on strike
 * and bowling at the time and where in the innings it fell.
 * @typedef {LoggedBall & {
 *   strikerId: string | null,
 *   bowlerId: string | null | undefined,
 *   over: number,
 *   ballInOver: number,
 *   freeHitSaved?: boolean,
 * }} BallLogEntry
 */

/**
 * The innings state deriveInnings() returns — the shape the views read.
 *
 * The four team fields are null until an innings_start, and undefined if one
 * arrived without them: the fold copies them as found. `bowler` likewise takes
 * whatever a bowler event carried, and is cleared to null at the end of each
 * over.
 *
 * @typedef {object} Innings
 * @property {string | null | undefined} battingTeam
 * @property {string | null | undefined} bowlingTeam
 * @property {string | null | undefined} teamKey
 * @property {string | null | undefined} bowlingTeamKey
 * @property {string} teamFlag
 * @property {SquadMember[]} squad
 * @property {SquadMember[]} bowlingSquad
 * @property {string | null} twelfthMan
 * @property {number} overs
 * @property {number | null} target
 * @property {number} runs
 * @property {number} wickets
 * @property {number} balls          legal deliveries
 * @property {{wide: number, noBall: number, bye: number, legBye: number, penalty: number}} extras
 * @property {Batter[]} batsmen
 * @property {Bowler[]} bowlers
 * @property {{runs: number, wickets: number, batsman: string, overs: string}[]} fow
 * @property {{over: number, batter: string | null, dismissal: string}[]} nonBallWickets
 *   the wickets that fell with no delivery (retired out, timed out: SCRBRD-081),
 *   each with the 0-based over the next delivery is in. They are in `wickets`
 *   and `fow`, and in no ballLog entry.
 * @property {{bat1: string, bat2: string, runs: number, balls: number, wicket: number}[]} partnerships
 * @property {{runs: number, balls: number, bat1: string | null, bat2: string | null}} curPartner
 * @property {BallLogEntry[]} ballLog
 * @property {{over: number, balls: BallLogEntry[]}[]} overLog
 * @property {string | null} striker
 * @property {string | null} nonStriker
 * @property {string | null | undefined} bowler
 * @property {boolean} complete      the laws' answer, or a seal's
 * @property {string | null} endReason one of INNINGS_END_REASON
 * @property {boolean} freeHit
 * @property {boolean} sealed        a scorer confirmed the figures
 * @property {string | null} sealRefused one of SEAL_REFUSAL
 * @property {{overs: number | null, target: number | null, reason: string | null} | null} revised
 * @property {string | null} declaredProfile  one of CAPTURE_PROFILE, or null: never declared
 * @property {number} voided         how many earlier events this log undoes
 */

/**
 * What the fold may be told from outside the log.
 * @typedef {object} FoldContext
 * @property {(teamKey: string | null | undefined) => string | null | undefined} [flagFor]
 *   team key → flag emoji, for the UI
 */

/** Overs in cricket's odd base: 17 legal balls is 2.5 overs.
 *  @param {number} balls */
export const fmtOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

/**
 * The dismissal a retire event records, or null when it records none.
 * SCRBRD-081: a retirement is a dismissal exactly when it is marked
 * `type: "W"` — see retire() in events.mjs — and then it is retired out or
 * timed out, nothing else: every other way out needs a delivery. The reason
 * stands in for a dismissal a W-marked event does not spell out.
 *
 * @param {LogEvent} ev  a retire event
 * @returns {"retired_out" | "timed_out" | null}
 */
export function retirementDismissal(ev) {
  if (ev.kind !== KIND.RETIRE || ev.type !== BALL_TYPE.WICKET) return null;
  const how = normaliseDismissal(ev.dismissal)
    ?? (Object.hasOwn(RETIREMENT_DISMISSAL, ev.reason ?? "") ? RETIREMENT_DISMISSAL[/** @type {string} */ (ev.reason)] : null);
  return how === DISMISSAL.RETIRED_OUT || how === DISMISSAL.TIMED_OUT ? how : null;
}

/** @param {string} id  @param {string} name  @returns {Batter} */
const newBatter = (id, name) => ({
  id, name,
  runs: 0, balls: 0, fours: 0, sixes: 0,
  status: BAT_STATUS.NOT_OUT, dismissal: null,
});

/** @param {string} id  @param {string} name  @returns {Bowler} */
const newBowler = (id, name) => ({
  id, name,
  runs: 0, balls: 0, wickets: 0, wides: 0, noBalls: 0, maidens: 0,
});

/**
 * The fold itself, one event at a time.
 *
 * deriveInnings() below is this, applied to a whole log. It is split out so
 * the server can extend a fold it has already built rather than start again
 * for every event it is asked to judge (see MatchFold) — WITHOUT a second
 * implementation of any rule: there is one switch over the event kinds, and
 * both callers go through it. A second fold is how the handover replay fell
 * behind this one (scoring-session.mjs), and it must not happen again here.
 *
 * `apply` never sees a void or a voided event; the caller filters them, because
 * which events are voided is a property of the whole log, not of one event.
 *
 * @param {FoldContext} [ctx]
 * @returns {{ inn: Innings, apply: (ev: LogEvent) => void }}
 */
function inningsFolder(ctx = {}) {
  /** @type {Innings} */
  const inn = {
    battingTeam: null, bowlingTeam: null,
    teamKey: null, bowlingTeamKey: null, teamFlag: "🏏",
    squad: [], bowlingSquad: [], twelfthMan: null,
    overs: 20, target: null,

    runs: 0, wickets: 0, balls: 0,
    extras: { wide: 0, noBall: 0, bye: 0, legBye: 0, penalty: 0 },

    batsmen: [], bowlers: [], fow: [], nonBallWickets: [],
    partnerships: [], curPartner: { runs: 0, balls: 0, bat1: null, bat2: null },
    ballLog: [], overLog: [],

    striker: null, nonStriker: null, bowler: null,
    complete: false, endReason: null, freeHit: false,
    // Over and closed are different facts. `complete` is the laws' answer and
    // needs nobody's permission; `sealed` means a scorer read the figures back
    // and confirmed them, and `sealRefused` says why a seal did not count.
    sealed: false, sealRefused: null,
    revised: null,                 // { overs, target, reason } once the umpires revised the innings
    // What the scorer declared this innings would capture — see inningsStart()
    // in events.mjs and the INNINGS_START case below. null is "never
    // declared", which is every innings scored before SCRBRD-039 and reads
    // exactly as they always did: nothing is excused as "not captured".
    declaredProfile: null,
    voided: 0,   // how many earlier events this log undoes — see the fold below
  };

  // Name resolution comes from the squads carried on innings_start, so a
  // scorecard replays correctly even on a device that never loaded the roster.
  /** @param {string | null | undefined} id  @returns {string | null}  null exactly when id is */
  const nameOf = (id) => {
    if (id == null) return null;
    const all = [...(inn.squad || []), ...(inn.bowlingSquad || [])];
    const hit = all.find((p) => (p?.id ?? p) === id);
    return hit?.name ?? String(id);
  };

  // nameOf() is null only for a null id, and both of these return first on one.
  /** @param {string | null | undefined} id */
  const batterFor = (id) => {
    if (id == null) return null;
    let b = inn.batsmen.find((x) => x.id === id);
    if (!b) { b = newBatter(id, /** @type {string} */ (nameOf(id))); inn.batsmen.push(b); }
    return b;
  };
  /** @param {string | null | undefined} id */
  const bowlerFor = (id) => {
    if (id == null) return null;
    let b = inn.bowlers.find((x) => x.id === id);
    if (!b) { b = newBowler(id, /** @type {string} */ (nameOf(id))); inn.bowlers.push(b); }
    return b;
  };

  const rotate = () => { const s = inn.striker; inn.striker = inn.nonStriker; inn.nonStriker = s; };

  // Partnership is measured as the run delta while a pair is together, so it
  // includes extras — which is how partnerships are actually reported.
  let partnerStartRuns = 0;
  const openPartnership = () => {
    partnerStartRuns = inn.runs;
    inn.curPartner = { runs: 0, balls: 0, bat1: inn.striker, bat2: inn.nonStriker };
  };
  const closePartnership = () => {
    const cp = inn.curPartner;
    if (cp && (cp.runs > 0 || cp.balls > 0)) {
      inn.partnerships.push({
        bat1: nameOf(cp.bat1) ?? "?", bat2: nameOf(cp.bat2) ?? "?",
        runs: cp.runs, balls: cp.balls, wicket: inn.wickets,
      });
    }
  };

  // The striker and bowler are stamped onto each log entry as it is written.
  // They are state at the time of the delivery, not properties of the event, so
  // without this the wagon wheel and the maiden calculation would have to guess
  // who was on strike — and `bowler` is cleared at the end of every over.
  // `at` is the legal-ball count BEFORE this delivery. It has to be captured by
  // the caller rather than read from `inn.balls` here: by the time a ball is
  // logged the count is already incremented, which would push the sixth ball of
  // every over into the next over and silently break maiden detection.
  /** @param {LoggedBall} ev  @param {number} at */
  const logBall = (ev, at) => {
    /** @type {BallLogEntry} */
    const entry = {
      ...ev,
      strikerId: inn.striker, bowlerId: inn.bowler,
      over: Math.floor(at / 6), ballInOver: at % 6,
    };
    inn.ballLog.push(entry);
    const last = inn.overLog[inn.overLog.length - 1];
    if (!last || last.over !== entry.over) inn.overLog.push({ over: entry.over, balls: [entry] });
    else last.balls.push(entry);
    return entry;
  };

  /** @param {LogEvent} ev */
  const apply = (ev) => {
    switch (ev.kind) {
      case KIND.INNINGS_START: {
        Object.assign(inn, {
          battingTeam: ev.battingTeam, bowlingTeam: ev.bowlingTeam,
          teamKey: ev.teamKey ?? ev.battingTeam,
          bowlingTeamKey: ev.bowlingTeamKey ?? ev.bowlingTeam,
          squad: ev.squad ?? [], bowlingSquad: ev.bowlingSquad ?? [],
          twelfthMan: ev.twelfthMan ?? null,
          overs: ev.overs ?? 20, target: ev.target ?? null,
        });
        if (ctx.flagFor) inn.teamFlag = ctx.flagFor(inn.teamKey) ?? "🏏";
        // THE DECLARED CAPTURE PROFILE. SCRBRD-039. Three rules, each one a
        // way a declaration could otherwise rewrite what the evidence means:
        //
        //   - It is a promise about the balls to come, so it is honoured only
        //     BEFORE the first delivery. A declaration that arrives after balls
        //     have been folded — typed in late, or released from quarantine to
        //     a seq behind them — would excuse a thin record retrospectively
        //     ("that innings was only ever quick"), which is exactly the
        //     misreading this exists to prevent in the other direction. It is
        //     ignored, and the innings reads as it did before it arrived.
        //   - Absence is not a retraction. The second innings is re-declared
        //     at the break (SCRBRD-063) by code that may not carry the field,
        //     and a device on an older build re-opens innings without it; a
        //     missing key keeps what was declared rather than erasing it.
        //   - A value the model does not know is not a declaration. Replay is
        //     a fold over a log that may have come from anywhere and does not
        //     throw; the constructor is where a bad value is refused.
        //
        // db/31's innings_declared_profile applies the same three rules to
        // the innings_start rows, so the device and the database agree.
        if (DECLARABLE.has(ev.captureProfile) && inn.ballLog.length === 0) {
          // DECLARABLE holds only the profile strings, so has() proves one.
          inn.declaredProfile = /** @type {string} */ (ev.captureProfile);
        }
        break;
      }

      case KIND.BATTERS: {
        const hadPair = inn.striker != null && inn.nonStriker != null;
        if (ev.striker != null) { batterFor(ev.striker); inn.striker = ev.striker; }
        if (ev.nonStriker != null) { batterFor(ev.nonStriker); inn.nonStriker = ev.nonStriker; }
        // Opening the innings, or a new arrival after a wicket: either way the
        // pair changed, so a fresh partnership starts here.
        if (!hadPair || ev.striker != null || ev.nonStriker != null) openPartnership();
        break;
      }

      case KIND.BOWLER:
        bowlerFor(ev.bowler);
        inn.bowler = ev.bowler;
        break;

      case KIND.PENALTY:
        if (ev.toBattingTeam !== false) {
          inn.runs += ev.runs ?? 5;
          inn.extras.penalty += ev.runs ?? 5;
        }
        break;

      case KIND.RETIRE: {
        // A dismissal with no delivery (SCRBRD-081): retired out, timed out.
        // A wicket falls; the over, the free hit and the bowler's figures do
        // not move, because nothing was bowled. See retire() in events.mjs for
        // why the `type: "W"` marker, and not the reason, decides it.
        const how = retirementDismissal(ev);
        if (how) {
          const outBat = batterFor(ev.batter);
          inn.wickets += 1;
          if (outBat) { outBat.status = BAT_STATUS.OUT; outBat.dismissal = DISMISSAL_LABEL[how].toLowerCase(); }
          inn.fow.push({ runs: inn.runs, wickets: inn.wickets, batsman: outBat?.name ?? "?", overs: fmtOvers(inn.balls) });
          // The over the next delivery is in — where a phase breakdown files it.
          inn.nonBallWickets.push({ over: Math.floor(inn.balls / 6), batter: ev.batter ?? null, dismissal: how });
          // Retired out is a batter at the crease: his partnership ends and
          // his end empties, as on a wicket ball. Timed out is the batter due
          // in, who never reached it: nothing at the crease changes.
          if (ev.batter != null && (inn.striker === ev.batter || inn.nonStriker === ev.batter)) {
            closePartnership();
            if (inn.striker === ev.batter) inn.striker = null; else inn.nonStriker = null;
            inn.curPartner = { runs: 0, balls: 0, bat1: inn.striker, bat2: inn.nonStriker };
            partnerStartRuns = inn.runs;
          }
          break;
        }
        const b = batterFor(ev.batter);
        if (b) { b.status = BAT_STATUS.RETIRED; b.dismissal = `retired ${ev.reason ?? "hurt"}`; }
        closePartnership();
        if (inn.striker === ev.batter) inn.striker = null;
        if (inn.nonStriker === ev.batter) inn.nonStriker = null;
        break;
      }

      // The seal, and the only thing in this fold that may be refused. Checked
      // HERE rather than after the loop because the figures have to be the ones
      // the log produces at THIS point in it — which is what ties a seal to the
      // occurrence of the innings ending that the scorer actually reviewed.
      case KIND.INNINGS_END: {
        const refusal = sealRefusal(ev, inn, inningsOverReason(inn));
        if (refusal) { inn.sealRefused = refusal; break; }
        inn.sealed = true;
        inn.sealRefused = null;
        inn.complete = true;
        // sealRefusal() refuses NO_REASON for a null reason, so it is set here.
        inn.endReason = /** @type {string} */ (ev.reason);
        break;
      }

      // The umpires' revision. The innings-over rule and the result below read
      // inn.overs and inn.target, so a cut to ten overs ends the innings at
      // sixty balls and a reset target decides the match — from this event,
      // not from anything stored beside the log.
      case KIND.REVISION:
        if (ev.overs != null) inn.overs = ev.overs;
        if (ev.target != null) inn.target = ev.target;
        inn.revised = { overs: ev.overs ?? null, target: ev.target ?? null, reason: ev.reason ?? null };
        break;

      case KIND.BALL: {
        const type = ev.type ?? BALL_TYPE.RUN;
        const v = ev.value ?? 0;
        const legal = isLegal(type);
        const bat = batterFor(inn.striker);
        const bow = bowlerFor(inn.bowler);
        const wasFreeHit = inn.freeHit;
        const at = inn.balls; // legal-ball index of this delivery, before it counts

        // The one-run penalty for a wide/no-ball is applied here and only here,
        // so `value` never has to carry it and can never double-count it.
        const penaltyRun = legal ? 0 : 1;
        let bowlerCharged = 0;

        switch (type) {
          case BALL_TYPE.WIDE:
            inn.runs += penaltyRun + v;
            inn.extras.wide += penaltyRun + v;
            bowlerCharged = penaltyRun + v;
            if (bow) bow.wides += 1;
            break;

          case BALL_TYPE.NO_BALL:
            inn.runs += penaltyRun + v;
            inn.extras.noBall += penaltyRun;
            bowlerCharged = penaltyRun + v;
            if (bow) bow.noBalls += 1;
            // A no-ball is a ball faced even when no run is scored off it.
            if (bat) {
              bat.balls += 1; bat.runs += v;
              if (v === 4) bat.fours += 1;
              if (v === 6) bat.sixes += 1;
            }
            break;

          case BALL_TYPE.BYE:
            inn.runs += v; inn.extras.bye += v;
            if (bat) bat.balls += 1;      // faced, but scored nothing
            break;                         // byes are not charged to the bowler

          case BALL_TYPE.LEG_BYE:
            inn.runs += v; inn.extras.legBye += v;
            if (bat) bat.balls += 1;
            break;                         // nor are leg byes

          case BALL_TYPE.WICKET:
            inn.runs += v; bowlerCharged = v;
            if (bat) { bat.balls += 1; bat.runs += v; }
            break;

          default: // BALL_TYPE.RUN
            inn.runs += v; bowlerCharged = v;
            if (bat) {
              bat.balls += 1; bat.runs += v;
              if (v === 4) bat.fours += 1;
              if (v === 6) bat.sixes += 1;
            }
            break;
        }

        if (legal) inn.balls += 1;
        if (bow) { bow.runs += bowlerCharged; if (legal) bow.balls += 1; }

        // Partnership: run delta keeps extras in, balls counts legal deliveries.
        if (inn.curPartner) {
          inn.curPartner.runs = inn.runs - partnerStartRuns;
          if (legal) inn.curPartner.balls += 1;
        }

        const entry = logBall(ev, at);

        if (type === BALL_TYPE.WICKET) {
          // A free hit cannot be lost to the bowler's dismissals; the
          // non-delivery ones stand. One set decides that AND the bowler's
          // credit below (events.mjs NON_DELIVERY), so they cannot disagree.
          // Normalised here too, so a log written before the vocabulary was
          // closed still replays under the law.
          const mode = normaliseDismissal(ev.dismissal);
          if (!wasFreeHit || standsOnFreeHit(mode)) {
            const outId = ev.dismissed ?? inn.striker;
            const outBat = batterFor(outId);
            inn.wickets += 1;
            if (outBat) {
              outBat.status = BAT_STATUS.OUT;
              outBat.dismissal = describeDismissal(ev, nameOf(inn.bowler));
            }
            if (bow && chargedToBowler(mode)) bow.wickets += 1;
            inn.fow.push({
              runs: inn.runs, wickets: inn.wickets,
              batsman: outBat?.name ?? "?", overs: fmtOvers(inn.balls),
            });
            closePartnership();
            if (inn.striker === outId) inn.striker = null; else inn.nonStriker = null;
            inn.curPartner = { runs: 0, balls: 0, bat1: inn.striker, bat2: inn.nonStriker };
            partnerStartRuns = inn.runs;
          } else {
            entry.freeHitSaved = true;
          }
        }

        // Strike rotation — odd runs actually run, then the change of ends at
        // the close of an over. Runs off a no-ball and byes run off a wide both
        // rotate: they were run between the wickets like any other. A wicket
        // does not rotate; the incoming batter's end is set by the next
        // `batters` event.
        if (type !== BALL_TYPE.WICKET && v % 2 === 1) rotate();
        if (legal && inn.balls % 6 === 0) { rotate(); inn.bowler = null; }

        // Free hit is set by a no-ball and consumed by the next legal delivery.
        inn.freeHit = type === BALL_TYPE.NO_BALL ? true : (legal ? false : inn.freeHit);
        break;
      }

      default: break; // unknown kinds are ignored, never fatal
    }
  };

  return { inn, apply };
}

/**
 * Fold the event log into a complete innings.
 *
 * @param {LogEvent[]} [events]  ordered event log (see events.mjs)
 * @param {FoldContext} [ctx]
 * @returns {Innings} innings state, shaped as the views already expect
 */
export function deriveInnings(events = [], ctx = {}) {
  const { inn, apply } = inningsFolder(ctx);
  // A `void` event undoes an earlier one. Collect the targets in one pass
  // first, because a void necessarily appears AFTER the event it undoes and
  // the fold below is single-pass and order-dependent — a ball that has been
  // voided must never be counted, not counted and then subtracted. Subtracting
  // is where the artifact's aggregates went wrong: a wicket cannot be
  // un-taken by decrementing, because the batter who came in afterwards is
  // already at the crease.
  //
  // Voiding a void does nothing on purpose. Undoing an undo means appending
  // the original event again; the log records what the scorer did, in order,
  // and is not a stack.
  const voided = voidedTargets(events);
  inn.voided = voided.size;
  for (const ev of events) {
    if (ev.kind === KIND.VOID) continue;
    if (ev.id != null && voided.has(ev.id)) continue;
    apply(ev);
  }
  settleInnings(inn);
  return inn;
}

/**
 * The targets of every void in this log.
 * @param {LogEvent[]} events
 */
function voidedTargets(events) {
  /** @type {Set<string>} */
  const voided = new Set();
  for (const ev of events) if (ev.kind === KIND.VOID && ev.target != null) voided.add(ev.target);
  return voided;
}

/** What the fold settles once the events are in. Idempotent.
 *  @param {Innings} inn */
function settleInnings(inn) {
  computeMaidens(inn);
  // A seal that stood has already set both fields and wins: it is what the
  // scorer recorded. Without one — none written yet, or one refused — the
  // innings is still over when the laws say it is, and the reason is derivable
  // from the same three facts that decide it, so an innings that ended before
  // anyone pressed anything can still say why. What it cannot say is that it
  // was closed, which is the whole distinction SCRBRD-038 needed.
  if (!inn.complete) {
    const why = inningsOverReason(inn);
    if (why) { inn.complete = true; inn.endReason = why; }
  }
}

/**
 * The scorecard line, from the canonical dismissal.
 * @param {LoggedBall} ev
 * @param {string | null} bowlerName
 * @returns {string}
 */
function describeDismissal(ev, bowlerName) {
  const mode = normaliseDismissal(ev.dismissal);
  const f = ev.fielder ? ` ${ev.fielder}` : "";
  const b = bowlerName ?? "?";
  switch (mode) {
    case DISMISSAL.RUN_OUT:    return `run out${ev.fielder ? ` (${ev.fielder})` : ""}`;
    case DISMISSAL.STUMPED:    return `st${f} b ${b}`;
    case DISMISSAL.CAUGHT:     return `c${f || " ?"} b ${b}`;
    case DISMISSAL.BOWLED:     return `b ${b}`;
    case DISMISSAL.LBW:        return `lbw b ${b}`;
    case DISMISSAL.HIT_WICKET: return `hit wicket b ${b}`;
    case null:                 return ev.dismissal ?? "out";   // a log from before the vocabulary closed
    default:                   return DISMISSAL_LABEL[mode].toLowerCase(); // not the bowler's: no "b"
  }
}

/**
 * A maiden is a completed over off which the bowler conceded nothing. Byes and
 * leg byes are not the bowler's, so they do not spoil it; wides and no-balls
 * are, so they do.
 *
 * @param {Innings} inn
 */
function computeMaidens(inn) {
  for (const b of inn.bowlers) b.maidens = 0;
  for (const over of inn.overLog) {
    const legalCount = over.balls.filter((b) => isLegal(b.type ?? BALL_TYPE.RUN)).length;
    if (legalCount < 6) continue;
    const bowlerId = over.balls[0]?.bowlerId ?? over.balls[0]?.bowler ?? null;
    const charged = over.balls.reduce((sum, b) => {
      const t = b.type ?? BALL_TYPE.RUN;
      if (t === BALL_TYPE.BYE || t === BALL_TYPE.LEG_BYE) return sum;
      return sum + (isLegal(t) ? 0 : 1) + (b.value ?? 0);
    }, 0);
    if (charged !== 0) continue;
    const bow = bowlerId != null
      ? inn.bowlers.find((x) => x.id === bowlerId)
      : inn.bowlers.find((x) => x.balls >= 6);
    if (bow) bow.maidens += 1;
  }
}

/**
 * Why this innings is over, or null while it is not.
 *
 * The three conditions are ordered the way the laws settle a tie between them.
 * A chase that is completed by the winning run ends there whatever the over
 * count would have said a ball later, and a side that is all out is all out
 * even on the last ball of the last over — so the reason a scorer is shown,
 * and the reason written into the log when they confirm it, is the one that
 * actually closed the innings rather than whichever test happened to run
 * first.
 *
 * Returning the reason rather than a boolean is what lets the review sheet
 * name it. `declared` and `abandoned` are not derivable — nothing in a ball log
 * implies a captain's decision or an umpire's — so those two only ever arrive
 * as an explicit innings_end event.
 *
 * @param {Innings} inn
 * @returns {string | null}  one of INNINGS_END_REASON
 */
function inningsOverReason(inn) {
  if (inn.target != null && inn.runs >= inn.target) return INNINGS_END_REASON.TARGET;
  if (inn.wickets >= Math.min(10, Math.max(1, (inn.squad?.length || 11) - 1))) return INNINGS_END_REASON.ALL_OUT;
  if (inn.balls >= (inn.overs ?? 20) * 6) return INNINGS_END_REASON.OVERS;
  return null;
}

/** Why this seal does not close the innings, or null when it does. */
export const SEAL_REFUSAL = Object.freeze({
  UNCONFIRMED: "unconfirmed",       // no figures on the event: nobody read anything back
  NO_REASON:   "no_reason",         // closed, unsaid — the fault the OVERS default used to hide
  FIGURES_MOVED: "figures_moved",   // the log no longer produces what was confirmed
  NOT_THE_LAWS_REASON: "not_the_laws_reason", // claims an ending the laws do not derive here
});

/**
 * Does this seal stand? SCRBRD-038.
 *
 * An innings_end event is the scorer saying "I have read these figures back and
 * they are right". The reducer used to take the saying without the reading: it
 * set `complete` and `endReason` from whatever the event claimed, unconditionally.
 * So the checkpoint between the last ball and a closed innings existed once, in
 * one React component tree, and the model underneath it would have honoured
 *
 *   - a seal naming an ending the log does not support — all out at twelve for
 *     none, a target reached in an innings that has no target;
 *   - a seal naming none at all, which the constructor turned into "the overs
 *     ran out";
 *   - a stale seal: one minted before an undo, replayed out of an offline queue,
 *     or overtaken by a delivery released from quarantine, closing an innings
 *     whose figures had moved since the review it claims to record.
 *
 * None of those needs bad faith to happen; the last one needs only a queue and
 * a bad afternoon of signal. So the review's evidence travels on the event and
 * is checked against the fold:
 *
 *   - the figures must be the figures the log produces at this point, which is
 *     what pins the seal to THIS occurrence of the innings ending;
 *   - a seal naming one of the three endings the laws derive must name the one
 *     they actually derive here. `declared` and `abandoned` are nobody's
 *     arithmetic — a captain's decision and an umpire's — so they are taken on
 *     the scorer's word, but still only with the figures attached.
 *
 * A refusal is recorded rather than thrown. Replay is a fold over a log that
 * may have come from anywhere, and a scoring surface that stops working because
 * one event was malformed is worse than one that says which event it will not
 * honour.
 *
 * @param {LoggedSeal} ev
 * @param {Innings} inn  the fold at the seal
 * @param {string | null} why  inningsOverReason(inn)
 * @returns {string | null}  one of SEAL_REFUSAL
 */
function sealRefusal(ev, inn, why) {
  const c = ev.confirmed;
  if (!c || c.runs == null || c.wickets == null || c.balls == null) return SEAL_REFUSAL.UNCONFIRMED;
  if (c.runs !== inn.runs || c.wickets !== inn.wickets || c.balls !== inn.balls) return SEAL_REFUSAL.FIGURES_MOVED;
  if (ev.reason == null) return SEAL_REFUSAL.NO_REASON;
  if (DERIVED_END_REASONS.has(ev.reason) && ev.reason !== why) return SEAL_REFUSAL.NOT_THE_LAWS_REASON;
  return null;
}

/**
 * The event that closes an innings the scorer has just reviewed.
 *
 * The figures are read off the innings rather than passed in, which is the
 * point: the seal carries what the review sheet showed, because the sheet was
 * drawn from this same object. `reason` defaults to the one the laws derived —
 * the scorer is being asked to check the figures, not to classify the ending —
 * and is overridable only for the two endings nothing in a ball log implies.
 *
 * @param {Pick<Partial<Innings>, "runs" | "wickets" | "balls" | "endReason"> | null} [inn]
 * @param {string | null} [reason]
 * @returns {import("./events.mjs").InningsEndEvent}
 */
export function sealInnings(inn, reason = inn?.endReason ?? null) {
  return inningsEnd({ reason, confirmed: { runs: inn?.runs, wickets: inn?.wickets, balls: inn?.balls } });
}

// ── Match-level derivation ───────────────────────────────

/**
 * Split a flat event log by innings index and derive each.
 * The log is one stream per match — `innings` on each event is the selector —
 * which is what lets a single `since` cursor drive realtime catch-up.
 *
 * @param {LogEvent[]} [events]
 * @param {FoldContext} [ctx]
 * @returns {{innings: Innings[], current: number, result: MatchResult | null}}
 */
export function deriveMatch(events = [], ctx = {}) {
  /** @type {Map<number, LogEvent[]>} */
  const byInnings = new Map();
  for (const ev of events) {
    const i = ev.innings ?? 0;
    if (!byInnings.has(i)) byInnings.set(i, []);
    // Set on the line above when it was missing.
    /** @type {LogEvent[]} */ (byInnings.get(i)).push(ev);
  }
  const indices = [...byInnings.keys()].sort((a, b) => a - b);
  // `indices` are byInnings' own keys.
  const innings = indices.map((i) => deriveInnings(/** @type {LogEvent[]} */ (byInnings.get(i)), ctx));
  return { innings, current: innings.length ? innings.length - 1 : 0, result: describeResult(innings) };
}

/**
 * A match's fold that can be extended one event at a time. For the server's
 * commit path: appendEvents() judges each event in a batch against the log as
 * it stands INCLUDING the events of the same batch it has just accepted, and
 * re-deriving the whole match for every one of them is a fold per event where
 * one per request will do.
 *
 * It is the same fold. Each innings is an inningsFolder() — the one switch
 * deriveInnings() runs — fed the same events, filtered the same way. Two
 * differences, both about WHEN, not what:
 *
 *   - A void cannot be applied incrementally: it removes an event already
 *     folded, and the fold does not subtract (see deriveInnings). So pushing a
 *     void re-folds that one innings from its own log. The server only accepts
 *     a void of the latest event that still counts, and undo is rare, so this
 *     is the exception and not the rule.
 *   - view() does not settle maidens: nothing that judges the next event
 *     reads them, and recounting every over for every event is the cost this
 *     exists to avoid. `complete` and `endReason` ARE settled, on a copy, so a
 *     later revision can still reopen an innings the way it does in a full
 *     replay.
 */
/**
 * One innings of a MatchFold: its own log, the voids in it, and its fold.
 * @typedef {{events: LogEvent[], voided: Set<string>, inn: Innings, apply: (ev: LogEvent) => void}} FoldBucket
 */

export class MatchFold {
  /** @param {LogEvent[]} [events] the match's log in seq order  @param {FoldContext} [ctx] */
  constructor(events = [], ctx = {}) {
    this.ctx = ctx;
    /** @type {Map<number, FoldBucket>} */
    this.byInnings = new Map();
    for (const ev of events) this._bucket(ev.innings ?? 0).events.push(ev);
    for (const b of this.byInnings.values()) this._refold(b);
  }

  /** @param {number} i */
  _bucket(i) {
    let b = this.byInnings.get(i);
    if (!b) {
      const { inn, apply } = inningsFolder(this.ctx);
      b = { events: [], voided: new Set(), inn, apply };
      this.byInnings.set(i, b);
    }
    return b;
  }

  /** Fold one innings again from its own log — exactly deriveInnings' loop.
   *  @param {FoldBucket} b */
  _refold(b) {
    const { inn, apply } = inningsFolder(this.ctx);
    b.inn = inn; b.apply = apply;
    b.voided = voidedTargets(b.events);
    inn.voided = b.voided.size;
    for (const ev of b.events) {
      if (ev.kind === KIND.VOID) continue;
      if (ev.id != null && b.voided.has(ev.id)) continue;
      apply(ev);
    }
  }

  /** Extend the fold with an event the log has just accepted.
   *  @param {LogEvent} ev */
  push(ev) {
    const b = this._bucket(ev.innings ?? 0);
    b.events.push(ev);
    if (ev.kind === KIND.VOID) { this._refold(b); return; }
    if (ev.id != null && b.voided.has(ev.id)) return;
    b.apply(ev);
  }

  /**
   * The match as the laws read it: each innings' state and its own log, both
   * indexed by innings number. The same shape the scorer already holds
   * (engine.jsx keeps `innings` and `events` as arrays by innings), so the
   * laws take one argument from either side.
   *
   * @returns {{ innings: Innings[], events: LogEvent[][] }}
   */
  view() {
    /** @type {Innings[]} */ const innings = [];
    /** @type {LogEvent[][]} */ const events = [];
    for (const [i, b] of this.byInnings) {
      const inn = b.inn;
      const why = inn.complete ? null : inningsOverReason(inn);
      innings[i] = why ? { ...inn, complete: true, endReason: why } : { ...inn };
      events[i] = b.events;
    }
    return { innings, events };
  }
}

/**
 * @typedef {{winner: string | null | undefined, margin: string}} MatchResult
 *   `winner` is a battingTeam (null on a tie); `margin` reads "3 wickets", "12 runs" or "tie"
 */

/** @param {Innings[]} innings  @returns {MatchResult | null} */
function describeResult(innings) {
  if (innings.length < 2) return null;
  const [a, b] = innings;
  if (!b.complete) return null;
  // The chase is judged against the TARGET, which is one more than the first
  // innings unless the umpires revised it. Comparing the two totals was right
  // only while those were the same number; in a rain-cut chase of 90 to beat
  // a 150, 100 is a win, not a loss by fifty.
  const target = b.target ?? a.runs + 1;
  if (b.runs >= target) {
    const wktsLeft = Math.min(10, (b.squad?.length || 11) - 1) - b.wickets;
    return { winner: b.battingTeam, margin: `${wktsLeft} wicket${wktsLeft === 1 ? "" : "s"}` };
  }
  const short = target - 1 - b.runs;
  if (short > 0) return { winner: a.battingTeam, margin: `${short} run${short === 1 ? "" : "s"}` };
  return { winner: null, margin: "tie" };
}

// ── Compatibility with the server's minimal replay ───────

/**
 * The shape `MatchSession.replay()` returns, used by the handover verification
 * handshake. Derived from the same fold so the two can never disagree.
 *
 * @param {Innings} inn
 */
export function confirmationState(inn) {
  return {
    runs: inn.runs, wickets: inn.wickets, balls: inn.balls,
    striker: inn.striker, nonStriker: inn.nonStriker, bowler: inn.bowler,
  };
}
