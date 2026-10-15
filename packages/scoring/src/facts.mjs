/**
 * SCRBRD — recognition facts, from the fold (Recognition R1).
 *
 * One pure function, deriveFacts(), that says what a match's log makes of
 * each player: the fifty and the hundred and the ball each was reached on,
 * the five-for, the hat-trick, and every batting and bowling line that could
 * be a best. The commentary's milestone lines read it, the pad's overlay will
 * (R2), Player of the Match suggestions will (R6), and SQL's player_milestone
 * is its mirror on the server, held equal to it by tools/smoke-fold-figures.
 *
 * WHERE THE FACTS COME FROM
 * ─────────────────────────
 * The fold, and nothing else. Each innings is walked with foldSteps()
 * (replay.mjs), the fold handed out one event at a time, so a figure here is
 * the scorecard's figure at that ball and no rule of the game is written a
 * second time: whose runs a no-ball's are, whose wicket a run out is, whether
 * a free hit saved it, a wicket on a wide or a no-ball, a void and whatever
 * it undoes. A correction is a void, so the facts of a corrected log are the
 * corrected history's (GA-I36): a hundred voided back to 99 is no hundred.
 * Nothing here reads a clock, a store or the network; the same log gives the
 * same facts on every device.
 *
 * WHAT THEY ARE
 * ─────────────
 *   milestones  player_milestone's innings rows (db/08, re-read through
 *               db/87): one `hundred` OR one `fifty` per batter per innings
 *               (a century is not also a fifty), a `five_for` per bowler per
 *               innings with five or more, a `hat_trick` per bowler per
 *               innings with one. Each with the ball it was reached on and
 *               the balls it took, or null for an innings from a scorebook
 *               (a final 104 is a hundred; it cannot say when 100 came up).
 *   batting     every batter's line, with each fifty crossed and its ball:
 *               the "highest innings" candidates, and the timeline that keeps
 *               a century's fifty.
 *   bowling     every bowler's figures: the "best bowling" candidates.
 *   moments     what a narrator says on the ball it happens: a batter
 *               reaching each fifty, a bowler's fifth wicket and each after
 *               it, a hat-trick, and a bowler on one.
 *
 * WHO HOLDS ONE
 * ─────────────
 * Milestones, batting and bowling hold only a player SCRBRD can attribute a
 * figure to (the `roster`; by default a player id, as SQL's striker_id and
 * bowler_id are), and only in a match innings: a name the scorer typed holds
 * nothing, and a super over is never a milestone, a best or a career figure
 * (db/71 §5). Moments are said of everyone, a typed name and a super over
 * included, because the commentary narrates the whole match; each carries
 * `linked` and `superOver` so a reader that records can tell.
 *
 * WHAT IT NEVER DOES
 * ──────────────────
 * Decides anything (an award is a person's), writes anything, or invents a
 * figure the log does not hold: a scorebook's missing balls stay null, never
 * nought.
 *
 * THE RULES, AS THE REPOSITORY ALREADY HOLDS THEM
 * ───────────────────────────────────────────────
 *   fifty, hundred   the striker's runs off the bat, the fold's (a no-ball
 *                    hit is his, its byes are not; a wide is not a ball he
 *                    faced). Crossed when the runs before the ball were under
 *                    the mark and after it at or over (milestone_watch()).
 *   five-for         the bowler's wickets, the fold's: only his ways out
 *                    (chargedToBowler), only one that stood (a free hit), a
 *                    stumping or hit wicket off a wide his too (db/87).
 *   hat-trick        Q8 (decided 2026-10-07): three of the bowler's own
 *                    standing wickets on three of his consecutive balls of
 *                    the over, in one innings (bowler_hat_trick, db/71). A
 *                    wide or a no-ball, wicket or not, neither makes nor
 *                    breaks one; a run out, or a wicket a free hit saved,
 *                    breaks one. One per bowler per innings is the milestone,
 *                    at the ball that first completed it; the commentary's
 *                    moment is said each time a fresh three completes.
 */

import { KIND, isWicketBall, countsInOver, chargedToBowler, normaliseDismissal, isPlayerId } from "./events.mjs";
import { deriveMatch, foldSteps, penaltyCredits } from "./replay.mjs";

/** @import { LogEvent } from "./events.mjs" */
/** @import { Innings, FoldContext } from "./replay.mjs" */

/**
 * The version of the rules this module applies, stamped on its answer (spec
 * §8: "reducer version · recognition rule version"). A change to what any
 * fact means moves it; a reader that stored a fact's evidence can tell which
 * rules made it.
 */
export const FACTS_VERSION = 1;

/** A milestone's kind: player_milestone's `kind` for the innings-grain rows. */
export const FACT_KIND = Object.freeze({
  FIFTY: "fifty",
  HUNDRED: "hundred",
  FIVE_FOR: "five_for",
  HAT_TRICK: "hat_trick",
});

/** What a narrator says on the ball (the commentary's milestone lines). */
export const MOMENT_KIND = Object.freeze({
  BATTER_MARK: "batter_mark",       // a batter reaches 50, 100, 150, …
  BOWLER_WICKETS: "bowler_wickets", // a bowler's fifth wicket, and each after it
  HAT_TRICK: "hat_trick",           // three of his in three
  HAT_TRICK_BALL: "hat_trick_ball", // two of his in two: on a hat-trick
});

/** Every fifty is a mark; a fifty and a hundred are the grades. */
const MARK = 50;
const FIVE = 5;

/**
 * Where a fact happened: the innings, the event's position in that innings'
 * log (as the commentary keys it), its `seq` and `id` where the log has them,
 * and the over and ball as the board writes them (12.3 is over 12, ball 3:
 * `over` from nought, `ball` from one; a wide or a no-ball is placed on the
 * ball of the over it was bowled before, as the commentary places it).
 * @typedef {{innings: number, index: number, seq: number | null, id: string | null, over: number, ball: number}} At
 */

/**
 * A fifty crossed: `mark` (50, 100, 150, …), the balls the batter had faced
 * when he reached it (the ball itself included) and where.
 * @typedef {{mark: number, balls: number, at: At}} Crossing
 */

/**
 * @typedef {object} Milestone
 * @property {string} kind      one of FACT_KIND
 * @property {string} player
 * @property {number} innings
 * @property {number} value     runs for a fifty or hundred; wickets for a five-for; 3 for a hat-trick (player_milestone's `value`)
 * @property {At | null} at     the ball it was reached on; null from a scorebook
 * @property {number | null} ballsTo  balls faced to reach 50 or 100; null for a five-for, a hat-trick, or a scorebook innings
 */

/**
 * @typedef {object} BattingLine
 * @property {string} player
 * @property {number} innings
 * @property {number} runs
 * @property {number | null} balls  null where a scorebook did not record them
 * @property {boolean} out
 * @property {boolean} summarised   from a paper scorebook (SCRBRD-120): no ball, so no crossing
 * @property {Crossing[]} crossings every fifty he crossed, in order
 */

/**
 * @typedef {object} BowlingLine
 * @property {string} player
 * @property {number} innings
 * @property {number} wickets
 * @property {number} runs      charged to him
 * @property {number} balls     legal balls
 * @property {boolean} summarised
 */

/**
 * @typedef {object} Moment
 * @property {string} kind      one of MOMENT_KIND
 * @property {string} player    the striker for a mark, the bowler otherwise
 * @property {boolean} linked   a player the roster attributes figures to
 * @property {boolean} superOver
 * @property {At} at
 * @property {number} [mark]    BATTER_MARK: the mark reached
 * @property {number} [runs]    BATTER_MARK: his runs; BOWLER_WICKETS: the runs charged to him
 * @property {number} [balls]   BATTER_MARK: the balls he has faced
 * @property {number} [wickets] BOWLER_WICKETS: his wickets
 */

/**
 * @typedef {object} Facts
 * @property {number} version   FACTS_VERSION
 * @property {Milestone[]} milestones
 * @property {BattingLine[]} batting
 * @property {BowlingLine[]} bowling
 * @property {Moment[]} moments
 */

/**
 * Who can hold a figure: a function of a reference, a set or map of player
 * ids (anything with `has`), a list of them, or nothing, which is SQL's rule
 * (a player id, never a typed name).
 * @typedef {((ref: string) => boolean) | {has: (ref: string) => boolean} | readonly string[] | null | undefined} Roster
 */

/**
 * @param {Roster} roster
 * @returns {(ref: string) => boolean}
 */
function linkedBy(roster) {
  if (roster == null) return isPlayerId;
  if (typeof roster === "function") return (ref) => roster(ref) === true;
  if (Array.isArray(roster)) { const s = new Set(roster); return (ref) => s.has(ref); }
  const r = /** @type {{has: (ref: string) => boolean}} */ (roster);
  return (ref) => r.has(ref) === true;
}

/**
 * The log, one list per innings, in innings order, from either shape a caller
 * holds: a match's flat log (each event's `innings` says which) or the pad's
 * list of logs by innings. The same split as the commentary's, so an event's
 * position here is its position there.
 * @param {LogEvent[] | LogEvent[][]} events
 * @returns {Map<number, LogEvent[]>}
 */
function byInningsOf(events) {
  /** @type {Map<number, LogEvent[]>} */
  const out = new Map();
  if (events.some((e) => Array.isArray(e))) {
    /** @type {LogEvent[][]} */ (events).forEach((evs, i) => { if (evs?.length) out.set(i, evs); });
  } else {
    for (const ev of /** @type {LogEvent[]} */ (events)) {
      const i = ev.innings ?? 0;
      const list = out.get(i);
      if (list) list.push(ev); else out.set(i, [ev]);
    }
  }
  return new Map([...out].sort((a, b) => a[0] - b[0]));
}

/**
 * The facts of a match.
 *
 * @param {LogEvent[] | LogEvent[][]} [events]  the match's log (flat, or by innings), voids and all
 * @param {Roster} [roster]  who can hold a figure; by default a player id
 * @param {{ctx?: FoldContext}} [options]  `ctx`: the fold's context, as deriveMatch() takes it
 * @returns {Facts}
 */
export function deriveFacts(events = [], roster = null, options = {}) {
  const linked = linkedBy(roster);
  const foldCtx = options.ctx ?? {};
  const byInnings = byInningsOf(events);
  const numbers = [...byInnings.keys()];
  // The match's fold first, as the commentary walks it: the Edition the whole
  // match is scored under (its first innings' date), and each innings' final
  // state — whether it is a super over, whether a scorebook gave it.
  const flat = [...byInnings].flatMap(([i, evs]) => evs.map((e) => ((e.innings ?? 0) === i ? e : { ...e, innings: i })));
  const match = deriveMatch(flat, foldCtx);
  /** @type {Map<number, Innings>} */
  const final = new Map(numbers.map((n, j) => [n, match.innings[j]]));
  const credits = penaltyCredits(final);
  const edition = match.innings.find((x) => x != null)?.lawsEdition;
  const ctx = edition == null ? foldCtx : { ...foldCtx, edition };

  /** @type {Milestone[]} */ const milestones = [];
  /** @type {BattingLine[]} */ const batting = [];
  /** @type {BowlingLine[]} */ const bowling = [];
  /** @type {Moment[]} */ const moments = [];

  for (const n of numbers) {
    const evs = /** @type {LogEvent[]} */ (byInnings.get(n));
    const fin = /** @type {Innings} */ (final.get(n));
    const superOver = fin.superOver != null;
    const summarised = fin.summarised != null;

    /** @type {Map<string, Crossing[]>} */ const crossings = new Map();
    /** @type {Map<string, At>} */ const fiveAt = new Map();
    /** @type {Map<string, At>} */ const hatAt = new Map();
    // Each figure after the previous event: what this ball changed is the
    // fold's after it against these.
    /** @type {Map<string, number>} */ let runsBefore = new Map();
    /** @type {Map<string, number>} */ let wktsBefore = new Map();
    // Each bowler's balls of the over, in order: was it a wicket of his that stood?
    /** @type {Map<string, boolean[]>} */ const run = new Map();

    const steps = foldSteps(evs, { carried: credits.carried.get(n) ?? 0, ctx });
    for (let step = steps.next(); !step.done; step = steps.next()) {
      const { ev, index, inn } = step.value;
      if (ev.kind === KIND.BALL) {
        const entry = inn.ballLog[inn.ballLog.length - 1];
        /** @type {At} */
        const at = { innings: n, index, seq: typeof ev.seq === "number" ? ev.seq : null,
                     id: typeof ev.id === "string" ? ev.id : null, over: entry.over, ball: entry.ballInOver + 1 };
        /** @param {string} kind  @param {string} player  @param {Partial<Moment>} more */
        const moment = (kind, player, more) =>
          moments.push({ kind, player, linked: linked(player), superOver, at, ...more });

        const strikerId = entry.strikerId ?? ev.striker ?? null;
        if (strikerId != null) {
          const b = inn.batsmen.find((x) => x.id === strikerId);
          const before = runsBefore.get(strikerId) ?? 0;
          if (b) {
            for (let mark = MARK; mark <= b.runs; mark += MARK) {
              if (before >= mark) continue;
              const list = crossings.get(strikerId) ?? [];
              list.push({ mark, balls: b.balls, at });
              crossings.set(strikerId, list);
              moment(MOMENT_KIND.BATTER_MARK, strikerId, { mark, runs: b.runs, balls: b.balls });
            }
          }
        }

        const bowlerId = entry.bowlerId ?? ev.bowler ?? null;
        if (bowlerId != null) {
          const w = inn.bowlers.find((x) => x.id === bowlerId);
          const before = wktsBefore.get(bowlerId) ?? 0;
          if (w && w.wickets > before && w.wickets >= FIVE) {
            if (before < FIVE && !fiveAt.has(bowlerId)) fiveAt.set(bowlerId, at);
            moment(MOMENT_KIND.BOWLER_WICKETS, bowlerId, { wickets: w.wickets, runs: w.runs });
          }
          // Q8: the balls of the over alone. A wide or a no-ball, a wicket
          // on one included, is not one of them: it neither makes nor breaks.
          if (countsInOver(ev)) {
            const mine = isWicketBall(ev) && !entry.freeHitSaved && chargedToBowler(normaliseDismissal(ev.dismissal));
            const seq = run.get(bowlerId) ?? [];
            seq.push(mine);
            run.set(bowlerId, seq);
            const k = seq.length;
            if (mine && k >= 3 && seq[k - 2] && seq[k - 3] && !seq[k - 4]) {
              if (!hatAt.has(bowlerId)) hatAt.set(bowlerId, at);
              moment(MOMENT_KIND.HAT_TRICK, bowlerId, {});
            } else if (mine && k >= 2 && seq[k - 2] && !(k >= 3 && seq[k - 3])) {
              moment(MOMENT_KIND.HAT_TRICK_BALL, bowlerId, {});
            }
          }
        }
      }
      runsBefore = new Map(inn.batsmen.map((b) => [b.id, b.runs]));
      wktsBefore = new Map(inn.bowlers.map((b) => [b.id, b.wickets]));
    }

    // The lines, from the innings as it ended: who can hold a figure, and
    // never in a super over.
    if (superOver) continue;
    /** @type {Milestone[]} */ const mine = [];
    const faced = new Set(fin.ballLog.map((x) => x.strikerId));
    const bowled = new Set(fin.ballLog.map((x) => x.bowlerId));
    for (const b of fin.batsmen) {
      if (!linked(b.id)) continue;
      // SQL's player_innings: a batter who faced a delivery or was out. A
      // scorebook's card lists exactly the batters who batted.
      if (!summarised && !faced.has(b.id) && b.status !== "out") continue;
      const cs = summarised ? [] : (crossings.get(b.id) ?? []);
      const balls = /** @type {number | null} */ (b.balls);
      batting.push({ player: b.id, innings: n, runs: b.runs, balls: balls ?? null, out: b.status === "out", summarised, crossings: cs });
      // One grade per innings: a hundred is not also a fifty (spec §5.3);
      // its crossings keep the fifty.
      if (b.runs >= MARK) {
        const grade = b.runs >= 2 * MARK ? 2 * MARK : MARK;
        const c = cs.find((x) => x.mark === grade) ?? null;
        mine.push({ kind: grade === MARK ? FACT_KIND.FIFTY : FACT_KIND.HUNDRED, player: b.id, innings: n, value: b.runs,
                    at: c?.at ?? null, ballsTo: c?.balls ?? null });
      }
    }
    for (const w of fin.bowlers) {
      if (!linked(w.id)) continue;
      // SQL's bowler_innings_figures: a bowler with a delivery to his name.
      if (!summarised && !bowled.has(w.id)) continue;
      bowling.push({ player: w.id, innings: n, wickets: w.wickets, runs: w.runs, balls: w.balls, summarised });
      if (w.wickets >= FIVE) {
        mine.push({ kind: FACT_KIND.FIVE_FOR, player: w.id, innings: n, value: w.wickets,
                    at: summarised ? null : (fiveAt.get(w.id) ?? null), ballsTo: null });
      }
      const h = summarised ? undefined : hatAt.get(w.id);
      if (h) mine.push({ kind: FACT_KIND.HAT_TRICK, player: w.id, innings: n, value: 3, at: h, ballsTo: null });
    }
    // In the order they happened; a scorebook's, which have no ball, as listed.
    const order = (/** @type {Milestone} */ m) => m.at?.index ?? Number.MAX_SAFE_INTEGER;
    milestones.push(...mine.map((m, k) => ({ m, k })).sort((a, b) => order(a.m) - order(b.m) || a.k - b.k).map((x) => x.m));
  }

  return { version: FACTS_VERSION, milestones, batting, bowling, moments };
}
