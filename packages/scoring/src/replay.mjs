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

import { KIND, BALL_TYPE, isLegal } from "./events.mjs";

// The scoring UI renders on these values: a batter at the crease is "batting",
// and a squad member who never came in is "dnb" (never produced here — a batter
// only exists once they appear in the log).
const BAT_STATUS = { NOT_OUT: "batting", OUT: "out", RETIRED: "retired" };

/** Overs in cricket's odd base: 17 legal balls is 2.5 overs. */
export const fmtOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

const newBatter = (id, name) => ({
  id, name,
  runs: 0, balls: 0, fours: 0, sixes: 0,
  status: BAT_STATUS.NOT_OUT, dismissal: null,
});

const newBowler = (id, name) => ({
  id, name,
  runs: 0, balls: 0, wickets: 0, wides: 0, noBalls: 0, maidens: 0,
});

/**
 * Fold the event log into a complete innings.
 *
 * @param {object[]} events  ordered event log (see events.mjs)
 * @param {object}  [ctx]
 * @param {(key:string)=>string} [ctx.flagFor]  team key → flag emoji, for the UI
 * @returns {object} innings state, shaped as the views already expect
 */
export function deriveInnings(events = [], ctx = {}) {
  const inn = {
    battingTeam: null, bowlingTeam: null,
    teamKey: null, bowlingTeamKey: null, teamFlag: "🏏",
    squad: [], bowlingSquad: [], twelfthMan: null,
    overs: 20, target: null,

    runs: 0, wickets: 0, balls: 0,
    extras: { wide: 0, noBall: 0, bye: 0, legBye: 0, penalty: 0 },

    batsmen: [], bowlers: [], fow: [],
    partnerships: [], curPartner: { runs: 0, balls: 0, bat1: null, bat2: null },
    ballLog: [], overLog: [],

    striker: null, nonStriker: null, bowler: null,
    complete: false, endReason: null, freeHit: false,
  };

  // Name resolution comes from the squads carried on innings_start, so a
  // scorecard replays correctly even on a device that never loaded the roster.
  const nameOf = (id) => {
    if (id == null) return null;
    const all = [...(inn.squad || []), ...(inn.bowlingSquad || [])];
    const hit = all.find((p) => (p?.id ?? p) === id);
    return hit?.name ?? String(id);
  };

  const batterFor = (id) => {
    if (id == null) return null;
    let b = inn.batsmen.find((x) => x.id === id);
    if (!b) { b = newBatter(id, nameOf(id)); inn.batsmen.push(b); }
    return b;
  };
  const bowlerFor = (id) => {
    if (id == null) return null;
    let b = inn.bowlers.find((x) => x.id === id);
    if (!b) { b = newBowler(id, nameOf(id)); inn.bowlers.push(b); }
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
  const logBall = (ev, at) => {
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

  for (const ev of events) {
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
        const b = batterFor(ev.batter);
        if (b) { b.status = BAT_STATUS.RETIRED; b.dismissal = `retired ${ev.reason ?? "hurt"}`; }
        closePartnership();
        if (inn.striker === ev.batter) inn.striker = null;
        if (inn.nonStriker === ev.batter) inn.nonStriker = null;
        break;
      }

      case KIND.INNINGS_END:
        inn.complete = true;
        inn.endReason = ev.reason ?? null;
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
          // A free hit cannot be lost to a bowled/caught dismissal; run outs
          // still stand. Guarding here keeps the rule in one place.
          const runOut = /run ?out/i.test(ev.dismissal ?? "");
          if (!wasFreeHit || runOut) {
            const outId = ev.dismissed ?? inn.striker;
            const outBat = batterFor(outId);
            inn.wickets += 1;
            if (outBat) {
              outBat.status = BAT_STATUS.OUT;
              outBat.dismissal = describeDismissal(ev, nameOf(inn.bowler));
            }
            if (bow && chargedToBowler(ev.dismissal)) bow.wickets += 1;
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
  }

  computeMaidens(inn);
  if (!inn.complete) inn.complete = isInningsOver(inn);
  return inn;
}

/** Dismissals not credited to the bowler. */
const UNCREDITED = /run ?out|retired|obstruct|handled|timed ?out/i;
const chargedToBowler = (mode) => !UNCREDITED.test(mode ?? "");

function describeDismissal(ev, bowlerName) {
  const mode = ev.dismissal ?? "out";
  const f = ev.fielder ? ` ${ev.fielder}` : "";
  if (/run ?out/i.test(mode)) return `run out${f ? ` (${ev.fielder})` : ""}`;
  if (/stumped|^st\b/i.test(mode)) return `st${f} b ${bowlerName ?? "?"}`;
  if (/caught|^c\b/i.test(mode)) return `c${f || " ?"} b ${bowlerName ?? "?"}`;
  if (/bowled|^b\b/i.test(mode)) return `b ${bowlerName ?? "?"}`;
  if (/lbw/i.test(mode)) return `lbw b ${bowlerName ?? "?"}`;
  return bowlerName ? `${mode} b ${bowlerName}` : mode;
}

/**
 * A maiden is a completed over off which the bowler conceded nothing. Byes and
 * leg byes are not the bowler's, so they do not spoil it; wides and no-balls
 * are, so they do.
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

function isInningsOver(inn) {
  const allOut = inn.wickets >= Math.min(10, Math.max(1, (inn.squad?.length || 11) - 1));
  const oversDone = inn.balls >= (inn.overs ?? 20) * 6;
  const chased = inn.target != null && inn.runs >= inn.target;
  return allOut || oversDone || chased;
}

// ── Match-level derivation ───────────────────────────────

/**
 * Split a flat event log by innings index and derive each.
 * The log is one stream per match — `innings` on each event is the selector —
 * which is what lets a single `since` cursor drive realtime catch-up.
 */
export function deriveMatch(events = [], ctx = {}) {
  const byInnings = new Map();
  for (const ev of events) {
    const i = ev.innings ?? 0;
    if (!byInnings.has(i)) byInnings.set(i, []);
    byInnings.get(i).push(ev);
  }
  const indices = [...byInnings.keys()].sort((a, b) => a - b);
  const innings = indices.map((i) => deriveInnings(byInnings.get(i), ctx));
  return { innings, current: innings.length ? innings.length - 1 : 0, result: describeResult(innings) };
}

function describeResult(innings) {
  if (innings.length < 2) return null;
  const [a, b] = innings;
  if (!b.complete) return null;
  if (b.runs > a.runs) {
    const wktsLeft = Math.min(10, (b.squad?.length || 11) - 1) - b.wickets;
    return { winner: b.battingTeam, margin: `${wktsLeft} wicket${wktsLeft === 1 ? "" : "s"}` };
  }
  if (a.runs > b.runs) return { winner: a.battingTeam, margin: `${a.runs - b.runs} run${a.runs - b.runs === 1 ? "" : "s"}` };
  return { winner: null, margin: "tie" };
}

// ── Compatibility with the server's minimal replay ───────

/**
 * The shape `MatchSession.replay()` returns, used by the handover verification
 * handshake. Derived from the same fold so the two can never disagree.
 */
export function confirmationState(inn) {
  return {
    runs: inn.runs, wickets: inn.wickets, balls: inn.balls,
    striker: inn.striker, nonStriker: inn.nonStriker, bowler: inn.bowler,
  };
}
