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

import { KIND, BALL_TYPE, isLegal, normaliseDismissal, chargedToBowler, standsOnFreeHit, DISMISSAL, DISMISSAL_LABEL, INNINGS_END_REASON, DERIVED_END_REASONS, RETIREMENT_DISMISSAL, RUN_OUT_END, SUSPENSION_SCOPE, runsOffBat, inningsEnd } from "./events.mjs";
import { NB_RUNS, runsToBowler } from "./events.mjs";
import { countsInOver, FACES_NEXT } from "./events.mjs";
import { lawsEdition, LAWS_EDITION } from "./edition.mjs";
import { conditionsOf, freeHit, oversPerInnings } from "./conditions.mjs";
import { CAPTURE_PROFILE } from "./placement.mjs";
import { OUTCOME, MARGIN_KIND, applyDecision, hasWinner, marginString, otherSide, resultWords } from "./result.mjs";

/** @import { MatchResult } from "./result.mjs" */

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
 * @property {number} balls   (see SUMMARY_NULLS)
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
 * @property {number} wides     (see SUMMARY_NULLS)
 * @property {number} noBalls
 * @property {number} maidens   settled after the fold (computeMaidens); a
 *   scorebook innings has the book's figure
 */

/*
 * SUMMARY_NULLS. In an innings from a paper scorebook (inn.summarised set;
 * SCRBRD-120) a figure the book did not record is null, never nought (D12):
 * a batter's balls, fours and sixes; a bowler's wides, no-balls and maidens;
 * any of the four kinds of extras; a fall of wicket's score and over. The
 * typedefs say `number` because every innings scored on a pad has one, and
 * the live fold's arithmetic is written against that; a reader that shows a
 * summarised innings asks inn.summarised first and treats null as "not
 * recorded", never as 0.
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
 *   keeperId?: string,
 * }} BallLogEntry
 *
 * `keeperId` is the wicket-keeper when the delivery was bowled (SCRBRD-126):
 * present only once a `keeper` event has named one, so every entry of a log
 * with none is the object it always was.
 */

/**
 * One man's keeping in an innings (SCRBRD-126): who, his name as the squads
 * gave it when he was named, and the dismissals he made as keeper — a catch
 * credited to him while he kept, and every stumping while he kept (Law 39: a
 * stumping is the wicket-keeper's alone). Only wickets that stand: a catch a
 * free hit saved is nobody's.
 * @typedef {{id: string, name: string, catches: number, stumpings: number}} Keeping
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
 *   `penalty` is every penalty run in this innings' total: those awarded to
 *   the batting side here, and `penaltyCarried`. (See SUMMARY_NULLS.)
 * @property {number} penaltyToFielding  penalty runs awarded in this innings to
 *   the FIELDING side (SCRBRD-094). Not in this innings' total: the match's
 *   fold credits them to that side's own innings — see penaltyCredits()
 * @property {number} penaltyCarried    penalty runs in this innings' total that
 *   were awarded in another innings: the batting side's award made while they
 *   were fielding. Only the match's fold (deriveMatch, deriveInningsList,
 *   MatchFold) sets it; deriveInnings() alone knows one innings and says 0
 * @property {Batter[]} batsmen
 * @property {Bowler[]} bowlers
 * @property {{runs: number, wickets: number, batsman: string, overs: string}[]} fow  (see SUMMARY_NULLS)
 * @property {{over: number, batter: string | null, dismissal: string}[]} nonBallWickets
 *   the wickets that fell with no delivery (retired out, timed out: SCRBRD-081),
 *   each with the 0-based over the next delivery is in. They are in `wickets`
 *   and `fow`, and in no ballLog entry.
 * @property {{over: number, ballInOver: number, from: string | null, to: string, reason: string | null}[]} bowlerChanges
 *   bowlers replaced during an over (SCRBRD-080): 0-based over, the legal balls
 *   of it already bowled, who left, who took over, and why (null in a log from
 *   before the pad asked)
 * @property {{bowler: string | null, reason: string, scope: string, over: number, ballInOver: number}[]} suspensions
 *   bowlers the umpires suspended in this innings (SCRBRD-094 item 2): who,
 *   why (SUSPENSION_REASON), for how long (SUSPENSION_SCOPE), and at which
 *   ball — the 0-based over the next delivery is in and the legal balls of it
 *   already bowled, as bowlerChanges. A suspension moves no figure.
 * @property {{batter: string | null, reason: string, out: boolean, wickets: number, over: number, ballInOver: number}[]} retirements
 *   every batter who retired, in order: retired hurt (and a legacy unmarked
 *   retire of any reason), `out: false`; retired out, `out: true` (a wicket,
 *   in nonBallWickets too). Timed out is not a retirement and is not here.
 *   Who, why, the wickets that had FALLEN when he went (his own included —
 *   counting any since taken back, see resumedWithConsent, so the number
 *   only rises), and at which ball, as suspensions. It is what the Laws read
 *   to say when a retired batter may resume (laws.mjs, SCRBRD-071): only
 *   once a wicket has fallen, or another batter has retired, since he went
 *   (Law 25.4.4). It moves no figure.
 * @property {{batter: string, over: number, ballInOver: number}[]} resumedWithConsent
 *   batters who retired out and resumed with the opposing captain's consent
 *   (Law 25.4.3; a `batters` event with `captainConsent`): each took his
 *   wicket back — out of `wickets`, `fow` and `nonBallWickets`, his line
 *   batting again. SQL does the same through ball_event_live (db/53).
 * @property {{bat1: string, bat2: string, runs: number, balls: number, wicket: number}[]} partnerships
 * @property {{runs: number, balls: number, bat1: string | null, bat2: string | null}} curPartner
 * @property {BallLogEntry[]} ballLog
 * @property {{over: number, balls: BallLogEntry[]}[]} overLog
 * @property {string | null} striker
 * @property {string | null} nonStriker
 * @property {string | null | undefined} bowler
 * @property {string | null} keeper  the fielding side's wicket-keeper now (SCRBRD-126): the
 *   last `keeper` event's, null until one. Not cleared at an over's end
 * @property {Keeping[]} keepers     everyone who kept in this innings, in the order each
 *   was first named, with the catches and stumpings each made as keeper. Empty
 *   in a log with no keeper event, and in an innings from a paper scorebook
 * @property {boolean} complete      the laws' answer, or a seal's
 * @property {string | null} endReason one of INNINGS_END_REASON
 * @property {boolean} freeHit
 * @property {boolean} sealed        a scorer confirmed the figures
 * @property {string | null} sealRefused one of SEAL_REFUSAL
 * @property {{overs: number | null, target: number | null, reason: string | null} | null} revised
 * @property {string | null} declaredProfile  one of CAPTURE_PROFILE, or null: never declared
 * @property {number} voided         how many earlier events this log undoes
 * @property {3 | 4} lawsEdition     the Edition of the Laws the match is scored under
 *   (edition.mjs, SCRBRD-113), resolved once per match by the fold and the
 *   same on every innings of it; what lawsEdition(match) reads back
 * @property {boolean} freeHits      whether a no-ball gives a free hit in this match:
 *   its format's answer (format.mjs, SCRBRD-113) — false in a declaration or
 *   timed match, true in every other and in one whose format is not known
 * @property {Readonly<Record<string, unknown>>} conditions  the match's play conditions the
 *   fold was told (FoldContext.conditions, SCRBRD-114), or {} when it was told none:
 *   the same on every innings of the match; what rulesOf() hands back
 * @property {string | null} conditionsHash  match_conditions.doc_hash of the document
 *   the fold was told (computed in SQL, carried here), or null: no document. The
 *   handover check compares it with the server's before any figure
 * @property {boolean} penaltyWin    4th Edition, a chase: this innings had
 *   been completed short of its target, and an award of penalty runs to it
 *   then made its total enough (Law 16.7). The result reads "by penalty runs"
 * @property {Summarised | null} summarised  this innings is known by its figures,
 *   from a paper scorebook (SCRBRD-120, an innings_summary event), not by its
 *   deliveries: its ballLog, overLog and partnerships are empty and stay so, and
 *   every reader of a delivery (a wagon wheel, a worm, a spell) has nothing to
 *   read. null for every innings scored on a pad
 */

/**
 * Where a summarised innings came from (the event's `source`) and the book's
 * own recorded difference, if it had one (D4).
 * @typedef {{import: string | null, checkedBy: string | null, confirmedBy: string | null,
 *   unreconciled: {runs: number, note: string} | null}} Summarised
 */

/**
 * What the fold may be told from outside the log.
 * @typedef {object} FoldContext
 * @property {(teamKey: string | null | undefined) => string | null | undefined} [flagFor]
 *   team key → flag emoji, for the UI
 * @property {unknown} [startsAt]  the fixture's start (match.starts_at), where the
 *   caller has it: it dates the match, and the date decides the Edition of the
 *   Laws (edition.mjs). Without it, the log's first event dates the match
 * @property {3 | 4} [edition]     the Edition, already resolved for the whole
 *   match; the fold resolves it itself when it is not given (withEdition())
 * @property {unknown} [format]    the fixture's format (match.format): whether a
 *   no-ball gives a free hit (format.mjs, freeHitsApply()). Not given — the
 *   pad's own match, a caller that does not hold the fixture — a free hit
 *   after every no-ball, as before
 * @property {Readonly<Record<string, unknown>> | null} [conditions]  the match's play
 *   conditions (SCRBRD-114): match_conditions.doc.play, as
 *   match_playing_conditions() gives them (db/61), or the pad's copy from the
 *   same read. Absent — the pad's own match, a caller without the fixture,
 *   every match before SCRBRD-114 — every reader falls back to today's rule
 *   (conditions.mjs: the format's free hit, the innings_start's overs)
 * @property {string | null} [conditionsHash]  that document's hash
 *   (match_conditions.doc_hash), stamped on every innings as inn.conditionsHash
 * @property {string | null} [status]  match.status, read by deriveMatch()'s result alone
 *   (describeResult(), ResultOptions); nothing an innings folds reads it
 * @property {{home?: string | null, away?: string | null} | null} [sides]  the result's sides
 * @property {{home?: string | null, away?: string | null} | null} [names]  the result's names
 * @property {import("./result.mjs").ResultDecision | null} [decision]  the result's decision
 */

/**
 * The rules a match's fold was made under (SCRBRD-113), as a context another
 * fold of the same log can be given so it folds alike: the Edition it
 * stamped, and — where no-balls gave no free hit — a declaration format.
 * For a reader that holds a fold but not the fixture (the pad's commentary).
 * @param {(Innings | null | undefined)[] | null | undefined} innings
 * @returns {FoldContext}
 */
export function rulesOf(innings) {
  const inn = (innings ?? []).find((x) => x != null);
  if (!inn) return {};
  // The conditions ride along (SCRBRD-114) so a second fold reads the same
  // free hit and overs the first did; with none, exactly the context it was.
  const told = inn.conditions != null && Object.keys(inn.conditions).length > 0;
  return {
    edition: inn.lawsEdition,
    ...(inn.freeHits === false ? { format: "declaration" } : {}),
    ...(told ? { conditions: inn.conditions, conditionsHash: inn.conditionsHash ?? null } : {}),
  };
}

/**
 * The context with the match's Edition resolved: as given, or from the
 * fixture's start, or from the first event of `events` (the match's log, by
 * innings or flat). One answer per match, so every innings of it is folded
 * under the same Edition — the second day of a two-day match included.
 * @param {FoldContext} ctx
 * @param {unknown} events
 * @returns {FoldContext & {edition: 3 | 4}}
 */
function withEdition(ctx, events) {
  if (ctx.edition === LAWS_EDITION.THIRD || ctx.edition === LAWS_EDITION.FOURTH) {
    return /** @type {FoldContext & {edition: 3 | 4}} */ (ctx);
  }
  return { ...ctx, edition: lawsEdition({ startsAt: ctx.startsAt, events }) };
}

/** Overs in cricket's odd base: 17 legal balls is 2.5 overs.
 *  @param {number} balls */
export const fmtOvers = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

/**
 * Is an over under way, with a bowler on — has a delivery of the over the
 * next ball is in been bowled, by the bowler the fold has? A bowler named now
 * takes over from one who has started it (SCRBRD-080, Law 17.7.1); at an
 * over's start there is nobody to take over from. A wide or no-ball counts: it
 * is part of the over though not one of its six. The log is in order, so the
 * last entry answers.
 *
 * With nobody on there is nobody to replace: a pad whose log holds balls the
 * server refused for want of a bowler (SCRBRD-070's cascade) names one then,
 * and that is naming the bowler, not changing him.
 *
 * @param {Pick<Innings, "balls" | "ballLog" | "bowler"> | Partial<Innings> | null | undefined} inn
 * @returns {boolean}
 */
export function isMidOver(inn) {
  if (inn?.bowler == null) return false;
  const log = inn.ballLog ?? [];
  const last = log[log.length - 1];
  return last != null && last.over === Math.floor((inn.balls ?? 0) / 6);
}

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
 * `carried` is penalty runs this innings opens on: an award to its batting
 * side made in an earlier innings, before they had batted (SCRBRD-094; the
 * match's fold works it out — penaltyCredits()). They are in the total from
 * before the first ball, so a chase reaches its target, and a wicket's fall
 * is recorded, with them in.
 *
 * @param {FoldContext} [ctx]
 * @param {number} [carried]
 * @returns {{ inn: Innings, apply: (ev: LogEvent) => void }}
 */
function inningsFolder(ctx = {}, carried = 0) {
  /** @type {Innings} */
  const inn = {
    battingTeam: null, bowlingTeam: null,
    teamKey: null, bowlingTeamKey: null, teamFlag: "🏏",
    squad: [], bowlingSquad: [], twelfthMan: null,
    overs: 20, target: null,

    runs: carried, wickets: 0, balls: 0,
    extras: { wide: 0, noBall: 0, bye: 0, legBye: 0, penalty: carried },
    penaltyToFielding: 0, penaltyCarried: carried,

    batsmen: [], bowlers: [], fow: [], nonBallWickets: [], bowlerChanges: [], suspensions: [], retirements: [], resumedWithConsent: [],
    partnerships: [], curPartner: { runs: 0, balls: 0, bat1: null, bat2: null },
    ballLog: [], overLog: [],

    striker: null, nonStriker: null, bowler: null,
    // The wicket-keeper (SCRBRD-126): state, as the bowler is, set by a
    // `keeper` event and kept until the next one.
    keeper: null, keepers: [],
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
    // The Edition of the Laws this match is scored under (SCRBRD-113): the
    // caller resolved it for the whole match (withEdition()). A folder built
    // without one is the 4th's only in a context that says so.
    lawsEdition: ctx.edition === LAWS_EDITION.THIRD ? LAWS_EDITION.THIRD : LAWS_EDITION.FOURTH,
    penaltyWin: false,
    // A free hit after a no-ball is a limited-overs playing condition, not a
    // Law: the match's format decides it (format.mjs, SCRBRD-113) — or, where
    // the match has a conditions document, its `format.free_hit` (SCRBRD-114,
    // conditions.mjs). No document is the format's answer, as before.
    freeHits: freeHit(conditionsOf(ctx), ctx.format),
    // The document the fold was told, and its hash (SCRBRD-114): the same on
    // every innings; {} and null when there is none.
    conditions: conditionsOf(ctx),
    conditionsHash: typeof ctx.conditionsHash === "string" ? ctx.conditionsHash : null,
    summarised: null,
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

  // The keeper's name as the squads gave it when he was named (SCRBRD-126).
  // A fielder is the keeper when the event names his reference or this name
  // (isKeeperRef): the pad's wicket sheet writes a fielder by name. db/68
  // reads the same name the same way, from the innings_start before the
  // keeper event.
  /** @type {string | null} */
  let keeperName = null;

  /**
   * Put whoever was chosen on strike for the next ball (FACES_NEXT). `s0`
   * and `n0` are the striker and non-striker the delivery was bowled to.
   *
   *   Both still in (no wicket stood): "striker" puts the batter who faced
   *     it on strike, "non_striker" the other; "incoming" has nobody to name.
   *   A wicket fell (an end is empty — a delivery is only bowled with both
   *     filled): "incoming" leaves the striker's end for the batter coming
   *     in and puts the not-out batter at the other; the not-out batter's own
   *     role puts him on strike and leaves the other end for the incoming
   *     batter. The dismissed batter's role names nobody.
   *
   * Anything else is left as the delivery left it.
   * @param {unknown} choice  @param {string | null} s0  @param {string | null} n0
   */
  const placeFacing = (choice, s0, n0) => {
    if (s0 == null || n0 == null) return;
    if (inn.striker != null && inn.nonStriker != null) {
      const same = (inn.striker === s0 && inn.nonStriker === n0) || (inn.striker === n0 && inn.nonStriker === s0);
      if (!same) return;
      if (choice === FACES_NEXT.STRIKER) { inn.striker = s0; inn.nonStriker = n0; }
      else if (choice === FACES_NEXT.NON_STRIKER) { inn.striker = n0; inn.nonStriker = s0; }
      return;
    }
    const survivor = inn.striker ?? inn.nonStriker;
    if (survivor == null) return;
    const survivorRole = survivor === s0 ? FACES_NEXT.STRIKER : survivor === n0 ? FACES_NEXT.NON_STRIKER : null;
    if (choice === FACES_NEXT.INCOMING) { inn.striker = null; inn.nonStriker = survivor; }
    else if (survivorRole != null && choice === survivorRole) { inn.striker = survivor; inn.nonStriker = null; }
    else return;
    inn.curPartner = { ...inn.curPartner, bat1: inn.striker, bat2: inn.nonStriker };
  };

  // A batter who retired hurt and walks back in (Law 25.4.2: "retired, not
  // out" may resume) is batting again, on the same line: his runs and balls
  // go on from where he left them (SCRBRD-071). Only a retirement that was
  // not a dismissal — a legacy unmarked retire "out" wrote "retired out" as
  // its line and is out to the Laws (laws.mjs isOut), so it stays as it was;
  // one marked W is status OUT already and never matches here.
  /** @param {Batter | null} b */
  const resume = (b) => {
    if (b?.status === BAT_STATUS.RETIRED && b.dismissal !== "retired out") {
      b.status = BAT_STATUS.NOT_OUT;
      b.dismissal = null;
    }
  };

  // Wickets fallen in this innings, counting any since taken back by a
  // consented resume: the number the Laws' 25.4.4 timing reads, which must
  // only rise (laws.mjs mayResume).
  const fallen = () => inn.wickets + inn.resumedWithConsent.length;

  // The wicket a retired out made — its fall-of-wicket entry and its
  // nonBallWickets entry, by identity — for as long as it stands, so a
  // consented resume (Law 25.4.3) can take exactly that wicket back.
  /** @type {Map<string, {fow: object, nbw: object}>} */
  const retiredOutWicket = new Map();

  // A batter who retired out walks back in with the opposing captain's
  // consent (Law 25.4.3; SCRBRD-071). His wicket is taken back: one fewer
  // in `wickets`, his entry out of the fall of wickets (the later ones
  // renumbered, so they count the wickets that stand) and out of
  // nonBallWickets, and his line batting again, runs and balls going on.
  // Only a wicket a retired out made and that still stands: anything else
  // named with consent is left as the batters event always left it (the
  // Laws refuse it at commit). New arrays, not edits in place: a view
  // already handed out (MatchFold.view() copies shallowly) keeps its own.
  /** @param {string} id */
  const resumeWithConsent = (id) => {
    const b = batterFor(id);
    const w = retiredOutWicket.get(id);
    if (!b || !w || b.status !== BAT_STATUS.OUT) return;
    retiredOutWicket.delete(id);
    const gone = /** @type {{wickets: number}} */ (w.fow);
    inn.wickets -= 1;
    inn.fow = inn.fow.filter((x) => x !== w.fow).map((x) => (x.wickets > gone.wickets ? { ...x, wickets: x.wickets - 1 } : x));
    inn.nonBallWickets = inn.nonBallWickets.filter((x) => x !== w.nbw);
    b.status = BAT_STATUS.NOT_OUT;
    b.dismissal = null;
    inn.resumedWithConsent = [...inn.resumedWithConsent, { batter: id, over: Math.floor(inn.balls / 6), ballInOver: inn.balls % 6 }];
  };

  // Whether the target now standing is one the umpires typed (a revision)
  // rather than the one the innings opened with. An award to the fielding
  // side moves the second; the first is the umpires' figure and stands until
  // they revise it again. See the PENALTY case.
  let targetTyped = false;

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
      ...(inn.keeper != null ? { keeperId: inn.keeper } : {}),
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
          // The innings_start's overs, as always; only one that states none
          // takes the conditions' figure before the 20 it always fell back
          // to (conditions.mjs oversPerInnings(), SCRBRD-114).
          overs: oversPerInnings(conditionsOf(ctx), ev), target: ev.target ?? null,
        });
        targetTyped = false;
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
        // With the opposing captain's consent, a batter who retired out is
        // named: his wicket is taken back before he takes his end.
        if (ev.captainConsent === true) {
          for (const id of [ev.striker, ev.nonStriker]) if (id != null && id !== inn.striker && id !== inn.nonStriker) resumeWithConsent(id);
        }
        if (ev.striker != null) { resume(batterFor(ev.striker)); inn.striker = ev.striker; }
        if (ev.nonStriker != null) { resume(batterFor(ev.nonStriker)); inn.nonStriker = ev.nonStriker; }
        // Opening the innings, or a new arrival after a wicket: either way the
        // pair changed, so a fresh partnership starts here.
        if (!hadPair || ev.striker != null || ev.nonStriker != null) openPartnership();
        break;
      }

      case KIND.BOWLER:
        // A change during an over (SCRBRD-080): recorded with the reason the
        // event gives — none, in a log from before the pad asked — so a card
        // can say who finished whose over, and why.
        if (isMidOver(inn) && ev.bowler != null && ev.bowler !== inn.bowler) {
          const last = inn.ballLog[inn.ballLog.length - 1];
          inn.bowlerChanges.push({
            over: Math.floor(inn.balls / 6), ballInOver: inn.balls % 6,
            from: inn.bowler ?? last?.bowlerId ?? null, to: ev.bowler, reason: ev.reason ?? null,
          });
        }
        bowlerFor(ev.bowler);
        inn.bowler = ev.bowler;
        break;

      // The wicket-keeper from here on (SCRBRD-126): state, as the bowler
      // is. He is on the record of who kept from the first time he is named,
      // and his dismissals are counted at the wicket (the BALL case).
      case KIND.KEEPER: {
        // A reference is a non-empty string; anything else names nobody.
        // His name is the squads' when it is a string, else his reference
        // (db/68's keeper_at() reads both the same way).
        const id = typeof ev.keeper === "string" && ev.keeper !== "" ? ev.keeper : null;
        const nm = nameOf(id);
        inn.keeper = id;
        keeperName = id == null ? null : typeof nm === "string" ? nm : id;
        if (id != null) {
          // Named again (the gloves back after a spell without them): the
          // same line, under his name as the squads give it now.
          const had = inn.keepers.find((k) => k.id === id);
          if (had) had.name = /** @type {string} */ (keeperName);
          else inn.keepers.push({ id, name: /** @type {string} */ (keeperName), catches: 0, stumpings: 0 });
        }
        break;
      }

      // The umpires suspended a bowler (Law 41; SCRBRD-094 item 2). Recorded,
      // and nothing else: no figure moves, and the bowler stays "on" until
      // someone else is named — so the one who finishes the over is a change
      // during it (bowlerChanges, reason "suspended"), exactly as for an
      // injury. That he may not bowl again is the Laws' to refuse
      // (lawsRefusal), from this record; the fold does not second-guess a log.
      case KIND.BOWLER_SUSPENDED:
        inn.suspensions.push({
          bowler: ev.bowler ?? null, reason: String(ev.reason ?? ""),
          scope: ev.scope === SUSPENSION_SCOPE.MATCH ? SUSPENSION_SCOPE.MATCH : SUSPENSION_SCOPE.INNINGS,
          over: Math.floor(inn.balls / 6), ballInOver: inn.balls % 6,
        });
        break;

      // Law 41.17 (41.17.4). To the batting side: in this total, now. To the fielding
      // side (SCRBRD-094): in THEIR total — their most recently completed
      // innings, or their next if they have not batted — which is the match's
      // fold's to credit (penaltyCredits()); this innings only counts it.
      //
      // A chase's target is the total it is chasing plus one, so an award
      // to the fielding side here — the side that set it — raises it by the
      // same runs, from this event on: the innings-over rule and the result
      // read the new figure. The target the innings opened with is taken to
      // include every award made before it was set; an umpires' revised
      // target is their figure and does not move (they revise it again).
      //
      // AFTER A RESULT (4th Edition, SCRBRD-113; Laws 41.17.2, 16.6.1, 16.7).
      // Penalty runs are awarded until the umpires leave the field, even
      // once a result has been reached, and "if the award of Penalty runs
      // means that a result has no longer been achieved, the match
      // continues". Two things follow here, and only for a 4th-Edition match
      // (inn.lawsEdition), so a 3rd-Edition log folds exactly as it did:
      //
      //   - A chase that ended by reaching its target, and was sealed, is
      //     reopened by an award to the fielding side that lifts the target
      //     above its runs: the seal no longer closes it (it was checked
      //     against figures that no longer decide the match), and play
      //     resumes. Unsealed, nothing is needed: whether the innings is
      //     over is re-derived after the last event (settleInnings), from
      //     the target as it now stands — it was never sticky.
      //   - A chase whose innings had been completed short — all out, or its
      //     overs bowled — made enough by an award to it: the result is a
      //     win "by Penalty runs" (16.7), not by wickets (`penaltyWin`).
      case KIND.PENALTY: {
        const r = ev.runs ?? 5;
        if (ev.toBattingTeam !== false) {
          const endedShort = inn.lawsEdition === LAWS_EDITION.FOURTH && inn.target != null && inn.runs < inn.target
            ? inningsOverReason(inn) : null;
          inn.runs += r;
          inn.extras.penalty += r;
          if ((endedShort === INNINGS_END_REASON.ALL_OUT || endedShort === INNINGS_END_REASON.OVERS)
              && inn.target != null && inn.runs >= inn.target) inn.penaltyWin = true;
        } else {
          inn.penaltyToFielding += r;
          if (inn.target != null && !targetTyped) inn.target += r;
          if (inn.lawsEdition === LAWS_EDITION.FOURTH && inn.sealed && inn.endReason === INNINGS_END_REASON.TARGET
              && inn.target != null && inn.runs < inn.target) {
            inn.sealed = false;
            inn.complete = false;
            inn.endReason = null;
          }
        }
        break;
      }

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
          const fowEntry = { runs: inn.runs, wickets: inn.wickets, batsman: outBat?.name ?? "?", overs: fmtOvers(inn.balls) };
          inn.fow.push(fowEntry);
          // The over the next delivery is in — where a phase breakdown files it.
          const nbw = { over: Math.floor(inn.balls / 6), batter: ev.batter ?? null, dismissal: how };
          inn.nonBallWickets.push(nbw);
          // Retired out is a retirement too (Law 25.4.3): on the record the
          // Laws read for when he may resume, and — while it stands — the
          // wicket a consented resume would take back.
          if (how === DISMISSAL.RETIRED_OUT && ev.batter != null) {
            inn.retirements.push({ batter: ev.batter, reason: String(ev.reason ?? "out"), out: true, wickets: fallen(),
                                   over: Math.floor(inn.balls / 6), ballInOver: inn.balls % 6 });
            retiredOutWicket.set(ev.batter, { fow: fowEntry, nbw });
          }
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
        // When he went, for the Laws' "may he resume yet?" (laws.mjs).
        inn.retirements.push({ batter: ev.batter ?? null, reason: String(ev.reason ?? "hurt"), out: false, wickets: fallen(),
                               over: Math.floor(inn.balls / 6), ballInOver: inn.balls % 6 });
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
        if (ev.target != null) { inn.target = ev.target; targetTyped = true; }
        inn.revised = { overs: ev.overs ?? null, target: ev.target ?? null, reason: ev.reason ?? null };
        break;

      case KIND.BALL: {
        const type = ev.type ?? BALL_TYPE.RUN;
        const v = ev.value ?? 0;
        // Two questions that were one until SCRBRD-113. `legal`: not a wide or
        // a no-ball — the one-run penalty, and the free hit, are the TYPE's.
        // `counts`: one of the six balls of the over (Law 17.3), which a fair
        // delivery marked `notInOver` (17.3.2.5) is not. A delivery with no
        // such mark counts exactly when it is legal, as every one before did.
        const legal = isLegal(type);
        const counts = countsInOver(ev);
        const bat = batterFor(inn.striker);
        const bow = bowlerFor(inn.bowler);
        const wasFreeHit = inn.freeHit;
        const at = inn.balls; // legal-ball index of this delivery, before it counts
        // Who stood where when it was bowled, for a choice of who faces next.
        const s0 = inn.striker, n0 = inn.nonStriker;

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

          case BALL_TYPE.NO_BALL: {
            // `v` is the runs completed; they are the striker's only when they
            // came off the bat (SCRBRD-068, NB_RUNS in events.mjs). Law 21.15:
            // the one-run penalty is a No-ball extra, debited to the bowler;
            // runs off the bat are the striker's, debited to the bowler; runs
            // not off the bat are Byes or Leg byes, and not the bowler's.
            const offBat = runsOffBat(ev);
            inn.runs += penaltyRun + v;
            inn.extras.noBall += penaltyRun;
            if (ev.nbRuns === NB_RUNS.LEG_BYES) inn.extras.legBye += v - offBat;
            else inn.extras.bye += v - offBat;
            bowlerCharged = runsToBowler(ev);
            if (bow) bow.noBalls += 1;
            // A no-ball is a ball faced even when no run is scored off it.
            if (bat) {
              bat.balls += 1; bat.runs += offBat;
              if (offBat === 4) bat.fours += 1;
              if (offBat === 6) bat.sixes += 1;
            }
            break;
          }

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

        if (counts) inn.balls += 1;
        if (bow) { bow.runs += bowlerCharged; if (counts) bow.balls += 1; }

        // Partnership: run delta keeps extras in, balls counts the balls of the over.
        if (inn.curPartner) {
          inn.curPartner.runs = inn.runs - partnerStartRuns;
          if (counts) inn.curPartner.balls += 1;
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
              outBat.dismissal = describeDismissal(ev, nameOf(inn.bowler), mode === DISMISSAL.STUMPED ? keeperName : null);
            }
            if (bow && chargedToBowler(mode)) bow.wickets += 1;
            // The keeper's (SCRBRD-126): every stumping while he keeps (Law
            // 39), and a catch the event credits to him by his reference or
            // his name. Nothing while no keeper is on the record.
            const k = inn.keeper == null ? null : inn.keepers.find((x) => x.id === inn.keeper);
            if (k && mode === DISMISSAL.STUMPED) k.stumpings += 1;
            else if (k && mode === DISMISSAL.CAUGHT && isKeeperRef(inn.keeper, keeperName, ev.fielder)) k.catches += 1;
            inn.fow.push({
              runs: inn.runs, wickets: inn.wickets,
              batsman: outBat?.name ?? "?", overs: fmtOvers(inn.balls),
            });
            closePartnership();
            // Which end is now empty. With the end recorded (SCRBRD-069, a
            // run out that completed runs: the batters have crossed, Law 18),
            // it is that end, and the survivor is at the other (Law 38.4).
            // Without it — every log before the pad asked — the dismissed
            // batter's end before the ball, as it always was.
            const survivor = outId === inn.striker ? inn.nonStriker : outId === inn.nonStriker ? inn.striker : undefined;
            if (survivor !== undefined && ev.outAt === RUN_OUT_END.STRIKER) { inn.striker = null; inn.nonStriker = survivor; }
            else if (survivor !== undefined && ev.outAt === RUN_OUT_END.BOWLER) { inn.striker = survivor; inn.nonStriker = null; }
            else if (inn.striker === outId) inn.striker = null; else inn.nonStriker = null;
            inn.curPartner = { runs: 0, balls: 0, bat1: inn.striker, bat2: inn.nonStriker };
            partnerStartRuns = inn.runs;
          } else {
            entry.freeHitSaved = true;
          }
        }

        // Strike rotation — odd runs actually run, then the change of ends at
        // the close of an over. Runs off a no-ball and byes run off a wide both
        // rotate: they were run between the wickets like any other. A wicket
        // does not rotate: the survivor's end is set above (from the end the
        // batter was out at, when the event says), and the incoming batter's
        // by the next `batters` event.
        if (type !== BALL_TYPE.WICKET && v % 2 === 1) rotate();
        if (counts && inn.balls % 6 === 0) { rotate(); inn.bowler = null; }

        // Free hit is set by a no-ball — in a match whose format gives one
        // (inn.freeHits; a declaration or timed match does not) — and
        // consumed by the next legal delivery, by its type: a fair delivery
        // that does not count in the over (17.3.2.5) was still the free-hit
        // ball bowled, as SQL's ball_wicket_stands() reads it too.
        inn.freeHit = type === BALL_TYPE.NO_BALL ? inn.freeHits : (legal ? false : inn.freeHit);

        // Who faces next, where the Laws let someone choose (FACES_NEXT,
        // SCRBRD-113): placed last, after the change of ends at an over's
        // close, because it is who faces the NEXT ball. The server takes the
        // field only where the Laws give the choice; the fold places whatever
        // a log says, and ignores what it cannot place.
        if (ev.facesNext != null) placeFacing(ev.facesNext, s0, n0);
        break;
      }

      // An innings known by its figures (SCRBRD-120 §2.3): a paper scorebook,
      // checked by one person and confirmed by another. The card's figures ARE
      // the innings' — its total (on top of any penalty runs it opened on, as
      // for any innings), wickets, legal balls from its overs, extras, each
      // batter's and bowler's line and the fall of wickets — and nothing is
      // derived that the book does not give: no ball is logged, no over, no
      // partnership, no maiden counted (the book's maidens, or none). A figure
      // the book does not record stays null (D12). The seal after it is
      // checked against these figures like any seal, so a card whose ending
      // disagrees with its figures ("all out" with seven down) is refused
      // there. A card this fold cannot read is ignored, as an unknown kind is.
      case KIND.INNINGS_SUMMARY: {
        const c = /** @type {Record<string, any> | null | undefined} */ (ev.card);
        const balls = ballsOfOvers(c?.overs);
        if (c == null || typeof c !== "object" || !isCount(c.total) || !isCount(c.wickets) || balls == null) break;
        const typed = /** @type {Record<string, unknown>} */ (ev.typed != null && typeof ev.typed === "object" ? ev.typed : {});
        /** @param {unknown} ref @returns {string | null} */
        const label = (ref) => {
          if (typeof ref !== "string" || !ref) return null;
          const t = typed[ref];
          return typeof t === "string" && t.trim() ? t.trim() : nameOf(ref);
        };
        // A figure the book records, or null (SUMMARY_NULLS): typed as the
        // number the live fold always has, which is the one lie told here.
        /** @param {unknown} v @returns {number} */
        const count = (v) => /** @type {number} */ (isCount(v) ? v : null);
        const x = c.extras != null && typeof c.extras === "object" ? c.extras : {};
        const carried = inn.penaltyCarried;
        inn.runs = carried + c.total;
        inn.wickets = c.wickets;
        inn.balls = balls;
        inn.extras = {
          wide: count(x.wides), noBall: count(x.noBalls), bye: count(x.byes), legBye: count(x.legByes),
          penalty: isCount(x.penalty) ? x.penalty + carried : count(carried || null),
        };
        const rows = (Array.isArray(c.batting) ? c.batting : []).slice()
          .sort((a, b) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
        inn.batsmen = rows.filter((b) => typeof b?.ref === "string" && b.ref).map((b) => {
          const how = String(b.howOut ?? "");
          const out = how !== CARD_NOT_OUT && how !== CARD_RETIRED_HURT;
          return {
            id: b.ref, name: /** @type {string} */ (label(b.ref)),
            runs: count(b.runs) ?? 0, balls: count(b.balls), fours: count(b.fours), sixes: count(b.sixes),
            status: how === CARD_RETIRED_HURT ? BAT_STATUS.RETIRED : out ? BAT_STATUS.OUT : BAT_STATUS.NOT_OUT,
            dismissal: how === CARD_RETIRED_HURT ? "retired hurt"
              : out ? describeDismissal({ kind: KIND.BALL, dismissal: how, fielder: label(b.fielderRef) }, label(b.bowlerRef))
              : null,
          };
        });
        inn.bowlers = (Array.isArray(c.bowling) ? c.bowling : []).filter((b) => typeof b?.ref === "string" && b.ref)
          .map((b) => ({
            id: b.ref, name: /** @type {string} */ (label(b.ref)),
            runs: count(b.runs) ?? 0, balls: ballsOfOvers(b.overs) ?? 0, wickets: count(b.wickets) ?? 0,
            wides: count(b.wides), noBalls: count(b.noBalls), maidens: count(b.maidens),
          }));
        inn.fow = (Array.isArray(c.fallOfWickets) ? c.fallOfWickets : []).map((f, k) => ({
          runs: count(f?.score), wickets: count(f?.wicket) ?? k + 1,
          batsman: label(f?.ref) ?? "?", overs: /** @type {string} */ (typeof f?.over === "string" && f.over ? f.over : null),
        }));
        inn.striker = null; inn.nonStriker = null; inn.bowler = null;
        const src = /** @type {Record<string, unknown>} */ (ev.source != null && typeof ev.source === "object" ? ev.source : {});
        const u = c.unreconciled;
        inn.summarised = {
          import: typeof src.import === "string" ? src.import : null,
          checkedBy: typeof src.checkedBy === "string" ? src.checkedBy : null,
          confirmedBy: typeof src.confirmedBy === "string" ? src.confirmedBy : null,
          unreconciled: u != null && typeof u === "object" && Number.isInteger(u.runs)
            ? { runs: u.runs, note: String(u.note ?? "") } : null,
        };
        break;
      }

      default: break; // unknown kinds are ignored, never fatal
    }
  };

  return { inn, apply };
}

/** @param {unknown} v  a whole number of nought or more */
const isCount = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A scorebook card's howOut for a batter still in, and for one who retired hurt (summary.mjs). */
const CARD_NOT_OUT = "not_out";
const CARD_RETIRED_HURT = "retired_hurt";

/**
 * Legal balls in "overs.balls" as a scorebook writes it — "47.3" is 285, six
 * to the over — or null for anything else: "47.6", "", a number. The one
 * reading of an overs figure, shared with summary.mjs and, in SQL,
 * scorebook_overs_balls() (db/63).
 * @param {unknown} text
 * @returns {number | null}
 */
export function ballsOfOvers(text) {
  if (typeof text !== "string") return null;
  const m = /^(\d{1,3})(?:\.([0-5]))?$/.exec(text.trim());
  return m ? Number(m[1]) * 6 + Number(m[2] ?? 0) : null;
}

/**
 * Fold the event log into a complete innings.
 *
 * @param {LogEvent[]} [events]  ordered event log (see events.mjs)
 * @param {FoldContext} [ctx]
 * @returns {Innings} innings state, shaped as the views already expect
 */
export function deriveInnings(events = [], ctx = {}) {
  return foldLog(events, ctx, 0);
}

/**
 * deriveInnings(), opening on `carried` penalty runs (see inningsFolder).
 * @param {LogEvent[]} events  @param {FoldContext} ctx  @param {number} carried
 * @returns {Innings}
 */
function foldLog(events, ctx, carried) {
  const { inn, apply } = inningsFolder(withEdition(ctx, events), carried);
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
 * The fold of one innings, event by event, for a reader that narrates it
 * (commentary.mjs). The same fold as deriveInnings() — the same filter, the
 * same apply — with the innings handed out after each event that counts, so
 * the reader sees what that event changed without a second set of rules.
 *
 * A void and every event it undoes are skipped, exactly as foldLog skips
 * them, so the steps are the corrected history and nothing else.
 *
 * `inn` is the fold's live object: read what you need before asking for the
 * next step, which changes it. The generator returns the settled innings —
 * deriveInnings() of the same log, opening on `carried` penalty runs (see
 * inningsFolder) — when it is done.
 *
 * @param {LogEvent[]} events  one innings' log
 * @param {{carried?: number, ctx?: FoldContext}} [o]
 * @returns {Generator<{ev: LogEvent, index: number, inn: Innings}, Innings, void>}
 *   `index` is the event's position in `events`
 */
export function* foldSteps(events, { carried = 0, ctx = {} } = {}) {
  const { inn, apply } = inningsFolder(withEdition(ctx, events), carried);
  const voided = voidedTargets(events);
  inn.voided = voided.size;
  for (let index = 0; index < events.length; index++) {
    const ev = events[index];
    if (ev.kind === KIND.VOID) continue;
    if (ev.id != null && voided.has(ev.id)) continue;
    apply(ev);
    yield { ev, index, inn };
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
  // A scorebook innings has no overs to count maidens in: its bowlers carry
  // the book's figure, and a count of nothing would overwrite it with nought.
  if (inn.summarised == null) computeMaidens(inn);
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
 * Is this fielder the keeper (SCRBRD-126)? The event names him by his
 * reference (an id, or the typed name he was recorded under) or by his name
 * as the squads gave it when he was named — the pad's wicket sheet writes a
 * fielder by name. Nobody is the keeper while none is recorded. One rule:
 * the fold's keeper catches, the Laws' stumping check (laws.mjs) and, in
 * SQL, db/68's keeper_dismissal all read it.
 * @param {string | null | undefined} keeperRef  inn.keeper
 * @param {string | null | undefined} keeperName  his name when he was named
 * @param {unknown} fielder  the event's
 * @returns {boolean}
 */
export function isKeeperRef(keeperRef, keeperName, fielder) {
  if (keeperRef == null || typeof fielder !== "string" || fielder === "") return false;
  return fielder === keeperRef || (keeperName != null && fielder === keeperName);
}

/**
 * The keeper now and his name (SCRBRD-126), for a reader holding the fold:
 * the Laws, the pad's wicket sheet, the scorecard. Null while none is
 * recorded.
 * @param {{keeper?: string | null, keepers?: Keeping[]} | null | undefined} inn
 * @returns {{id: string, name: string} | null}
 */
export function keeperOf(inn) {
  const id = inn?.keeper ?? null;
  if (id == null) return null;
  const k = (inn?.keepers ?? []).find((x) => x.id === id);
  return { id, name: k?.name ?? id };
}

/**
 * The scorecard line, from the canonical dismissal.
 * @param {LoggedBall} ev
 * @param {string | null} bowlerName
 * @param {string | null} [keeperName]  a stumping with no fielder named is
 *   the keeper's (SCRBRD-126): his name, when one is recorded
 * @returns {string}
 */
function describeDismissal(ev, bowlerName, keeperName = null) {
  const mode = normaliseDismissal(ev.dismissal);
  const fielder = ev.fielder || (mode === DISMISSAL.STUMPED ? keeperName : null);
  const f = fielder ? ` ${fielder}` : "";
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
 * Is this over a maiden: six legal balls, all by ONE bowler, and nothing
 * charged to him? Byes and leg byes are not the bowler's, so they do not
 * spoil it; wides and no-balls are, so they do. One rule, read by the fold's
 * maiden count and by the commentary's end-of-over line.
 *
 * An over two bowlers shared — one injured or suspended during it, another
 * finishing it (SCRBRD-080, SCRBRD-094 item 2) — is a maiden for neither:
 * neither bowled a completed over, which is what a maiden is
 * (docs/SCORING_RULES.md §4). Before this the first of them was credited
 * with it. A delivery the fold stamped with no bowler (nobody on: a pad's held
 * cascade) is not a second bowler.
 *
 * @param {ReadonlyArray<{type?: string | null, value?: number | null, bowlerId?: string | null, bowler?: string | null, notInOver?: unknown}>} balls
 *   one over's deliveries (overLog), each with the bowler the fold stamped
 * @returns {boolean}
 */
export function isMaiden(balls) {
  // The balls of the over: not a wide or a no-ball, nor one that does not
  // count (countsInOver(), Law 17.3.2.5) — whose runs, if charged to the
  // bowler, still spoil it below.
  const legalCount = balls.filter((b) => countsInOver(b)).length;
  if (legalCount < 6) return false;
  const by = new Set(balls.map((b) => ("bowlerId" in b ? b.bowlerId : b.bowler) ?? null).filter((x) => x != null));
  if (by.size > 1) return false;
  const charged = balls.reduce((sum, b) => sum + runsToBowler(b), 0);
  return charged === 0;
}

/**
 * A maiden is a completed over off which the bowler conceded nothing
 * (isMaiden), credited to the bowler of that over.
 *
 * @param {Innings} inn
 */
function computeMaidens(inn) {
  for (const b of inn.bowlers) b.maidens = 0;
  for (const over of inn.overLog) {
    if (!isMaiden(over.balls)) continue;
    const bowlerId = over.balls[0]?.bowlerId ?? over.balls[0]?.bowler ?? null;
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

/*
 * PENALTY RUNS TO THE FIELDING SIDE CROSS INNINGS (SCRBRD-094, Law 41.17.4).
 *
 * Five runs awarded to the fielding side are added to the fielding side's
 * total: to its most recently completed innings, or, if it has not batted
 * yet, to its next innings. An innings is one side's, so the award made in
 * innings N — which the event records, and which deriveInnings() counts in
 * N's `penaltyToFielding` — belongs in another innings' total, and only a
 * fold of the whole match can put it there. penaltyCredits() says where; the
 * three match folds below (deriveMatch, deriveInningsList, MatchFold) apply
 * it the same way:
 *
 *   THE FIELDING SIDE is N's `bowlingTeamKey`, and an innings is theirs when
 *     its `teamKey` is the same — the keys innings_start carries (the batting
 *     team's name when it carries no key). An innings with no key, or an
 *     award in one whose fielding side has none, is nobody's: nothing moves.
 *   MOST RECENTLY COMPLETED is the highest-numbered innings before N that
 *     they batted. Innings are played in order — no play in one until the
 *     one before it has ended (lawsRefusal) — so every innings before N has
 *     ended. The runs are added to its total at the END, after its last
 *     event: its fall of wickets, partnerships and seal were recorded before
 *     them and stay as they were. Batting first and complete, their total
 *     rises mid-chase, and the chase's target with it (the PENALTY case in
 *     inningsFolder, from the award on).
 *   THEIR NEXT INNINGS, when they have none before N, is the lowest-numbered
 *     innings after N that they bat. It OPENS on the runs: they are in its
 *     total from before its first ball (inningsFolder's `carried`), so its
 *     fall of wickets, the target it reaches and the figures a seal confirms
 *     include them. Batting second, they start their chase on 5.
 *   NOT YET: an award whose side has no innings on either side of N yet —
 *     the first innings, with the second not opened — is in nobody's total
 *     until that innings' innings_start is in the log; penaltyCredits()
 *     lists it as `pending` so a screen can say the next innings opens on it.
 *
 * Where no award to the fielding side is in the log, all three folds are
 * exactly what they were: nothing is credited and nothing is re-folded.
 */

/**
 * Where each award to a fielding side goes.
 *
 * @param {Iterable<[number, Pick<Innings, "teamKey" | "bowlingTeamKey" | "penaltyToFielding">]>} innings
 *   each innings of the match that has a log, with its number
 * @returns {{
 *   carried: Map<number, number>,
 *   added: Map<number, number>,
 *   pending: {from: number, team: string, runs: number}[],
 * }}  `carried`: innings number → runs it opens on; `added`: innings number →
 *   runs added to its total after its last event; `pending`: awards whose
 *   side's next innings is not in the log yet
 */
export function penaltyCredits(innings) {
  const list = [...innings].sort((a, b) => a[0] - b[0]);
  /** @type {Map<number, number>} */ const carried = new Map();
  /** @type {Map<number, number>} */ const added = new Map();
  /** @type {{from: number, team: string, runs: number}[]} */ const pending = [];
  for (const [n, inn] of list) {
    const runs = inn.penaltyToFielding;
    const side = inn.bowlingTeamKey;
    if (!runs || side == null) continue;
    const before = list.filter(([k, x]) => k < n && x.teamKey === side).pop();
    const after = before ? undefined : list.find(([k, x]) => k > n && x.teamKey === side);
    if (before) added.set(before[0], (added.get(before[0]) ?? 0) + runs);
    else if (after) carried.set(after[0], (carried.get(after[0]) ?? 0) + runs);
    else pending.push({ from: n, team: side, runs });
  }
  return { carried, added, pending };
}

/**
 * An innings with `runs` more penalty runs in its total, awarded while its
 * side was fielding after it had batted. A copy: the fold's own object is
 * left as it was.
 * @param {Innings} inn  @param {number} runs
 * @returns {Innings}
 */
function withAdded(inn, runs) {
  return {
    ...inn,
    runs: inn.runs + runs,
    extras: { ...inn.extras, penalty: inn.extras.penalty + runs },
    penaltyCarried: inn.penaltyCarried + runs,
  };
}

/**
 * Fold each innings' own log, then credit the awards to fielding sides.
 * @param {Map<number, LogEvent[]>} byInnings
 * @param {FoldContext} ctx0
 * @returns {Map<number, Innings>}
 */
function foldMatch(byInnings, ctx0) {
  // One Edition for the whole match: dated by the fixture, or by the first
  // event of its lowest-numbered innings (edition.mjs).
  const ctx = withEdition(ctx0, [...byInnings.keys()].sort((a, b) => a - b).map((i) => byInnings.get(i)));
  /** @type {Map<number, Innings>} */
  const folded = new Map();
  for (const [i, evs] of byInnings) folded.set(i, foldLog(evs, ctx, 0));
  // Who fields and who bats, and what was awarded to whom, are the same
  // whatever an innings opens on, so one pass decides every credit.
  const { carried, added } = penaltyCredits(folded);
  for (const [i, runs] of carried) folded.set(i, foldLog(/** @type {LogEvent[]} */ (byInnings.get(i)), ctx, runs));
  for (const [i, runs] of added) folded.set(i, withAdded(/** @type {Innings} */ (folded.get(i)), runs));
  return folded;
}

/**
 * Split a flat event log by innings index and derive each.
 * The log is one stream per match — `innings` on each event is the selector —
 * which is what lets a single `since` cursor drive realtime catch-up.
 * Penalty runs to a fielding side are credited across innings (above).
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
  const folded = foldMatch(byInnings, ctx);
  const indices = [...byInnings.keys()].sort((a, b) => a - b);
  // `indices` are byInnings' own keys, and foldMatch folds each.
  const innings = indices.map((i) => /** @type {Innings} */ (folded.get(i)));
  return { innings, current: innings.length ? innings.length - 1 : 0,
           result: describeResult(innings, { conditions: conditionsOf(ctx), status: ctx.status ?? null, sides: ctx.sides ?? null,
                                             names: ctx.names ?? null, decision: ctx.decision ?? null }) };
}

/**
 * Each innings of a match from its own log, indexed by innings number — the
 * shape the pad holds (`events[i]` is innings i's log) — with penalty runs to
 * a fielding side credited across innings. An innings with no events is
 * null, as the pad has it. This is deriveInnings() for a screen that shows
 * more than one innings, or any innings' total once an award to a fielding
 * side may be in the log: deriveInnings() alone cannot see an award made in
 * another innings.
 *
 * @param {LogEvent[][]} [eventsByInnings]
 * @param {FoldContext} [ctx]
 * @returns {(Innings | null)[]}
 */
export function deriveInningsList(eventsByInnings = [], ctx = {}) {
  /** @type {Map<number, LogEvent[]>} */
  const byInnings = new Map();
  eventsByInnings.forEach((evs, i) => { if (evs?.length) byInnings.set(i, evs); });
  const folded = foldMatch(byInnings, ctx);
  return eventsByInnings.map((_, i) => folded.get(i) ?? null);
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
 *
 * Penalty runs to a fielding side are credited as deriveMatch() credits them
 * (penaltyCredits()), when view() is asked: an innings that opens on an award
 * made earlier is folded again from its own log with it, once, when that
 * changes; one that gains an award after it ended has it added on the copy.
 */
/**
 * One innings of a MatchFold: its own log, the voids in it, its fold, and the
 * penalty runs it opens on.
 * @typedef {{events: LogEvent[], voided: Set<string>, inn: Innings, apply: (ev: LogEvent) => void, carried: number}} FoldBucket
 */

export class MatchFold {
  /** @param {LogEvent[]} [events] the match's log in seq order  @param {FoldContext} [ctx] */
  constructor(events = [], ctx = {}) {
    // The match's Edition (edition.mjs), resolved from the fixture's start
    // or the log's first event before any innings is folded; a fold opened
    // on an empty log resolves it from the first event pushed. A copy: the
    // caller's context is not written to.
    /** @type {FoldContext} */
    this.ctx = { ...ctx };
    if (events.length > 0 || this.ctx.startsAt != null) this.ctx = withEdition(this.ctx, events);
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
      b = { events: [], voided: new Set(), inn, apply, carried: 0 };
      this.byInnings.set(i, b);
    }
    return b;
  }

  /** Fold one innings again from its own log — exactly deriveInnings' loop.
   *  @param {FoldBucket} b */
  _refold(b) {
    const { inn, apply } = inningsFolder(this.ctx, b.carried);
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
    if (this.ctx.edition == null) this.ctx = withEdition(this.ctx, [ev]);
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
    const credits = penaltyCredits([...this.byInnings].map(([i, b]) => [i, b.inn]));
    for (const [i, b] of this.byInnings) {
      const carried = credits.carried.get(i) ?? 0;
      if (carried !== b.carried) { b.carried = carried; this._refold(b); }
    }
    /** @type {Innings[]} */ const innings = [];
    /** @type {LogEvent[][]} */ const events = [];
    for (const [i, b] of this.byInnings) {
      const inn = b.inn;
      const why = inn.complete ? null : inningsOverReason(inn);
      const settled = why ? { ...inn, complete: true, endReason: why } : { ...inn };
      const added = credits.added.get(i);
      innings[i] = added ? withAdded(settled, added) : settled;
      events[i] = b.events;
    }
    return { innings, events };
  }
}

/**
 * What a result is told beside the innings (SCRBRD-114 phase 3a, design §2):
 * all optional, and a caller that tells it nothing gets what the fold always
 * gave — a win, a tie, or nothing yet — less the two misreadings §2.2 names.
 * @typedef {object} ResultOptions
 * @property {Readonly<Record<string, unknown>> | null} [conditions]  the match's play
 *   conditions (FoldContext.conditions): `format.innings_per_side` (2: two innings a side)
 *   and `result.min_overs_per_side`
 * @property {string | null} [status]  match.status: a `complete` match whose chase never
 *   finished is a no result (a draw, two innings a side); an `abandoned` one with no
 *   result is abandoned
 * @property {{home?: string | null, away?: string | null} | null} [sides]  each side's key as
 *   innings_start writes it (the pad: the fixture's team code, else "Home"; the opponent):
 *   told them, a win is home_win or away_win, as match_result() says
 * @property {{home?: string | null, away?: string | null} | null} [names]  each side's name
 *   for the words; else the innings' battingTeam
 * @property {import("./result.mjs").ResultDecision | null} [decision]  the standing
 *   match_result_decision (db/69)
 */

/**
 * The result of a match, from its innings (SCRBRD-114 phase 3a; design §2.2).
 * match_result() (db/69) is the same rule in SQL; tools/smoke-fold-figures.mjs
 * holds the two together over its logs.
 *
 * ONE INNINGS A SIDE (a limited-overs match, and every match whose document
 * says nothing — every match before db/61): the second innings is the chase.
 *   - not complete: in progress, or a no result once the match is `complete`;
 *   - sealed `abandoned`: a no result — the umpires called it, and it is never
 *     a win by the runs it was short (the old misreading, fixed);
 *   - the target reached (the revised one, else one more than the first
 *     innings): a win by wickets in hand, or by penalty runs (Law 16.7);
 *   - short, with the chase's allotted overs fewer than
 *     `result.min_overs_per_side` and its overs bowled: a no result;
 *   - short: a win by the runs short; level: a tie.
 * TWO INNINGS A SIDE (`format.innings_per_side` = 2, D11): an innings win once
 * the side batting twice is all out behind the other's single innings; a
 * fourth innings decided as a chase when it reaches its target or is all out;
 * otherwise a draw once the match is `complete` (the fourth innings not
 * completed, or not reached). The second innings is NOT a chase here: a side
 * passing the other's first innings has won nothing yet (the old misreading,
 * which read innings 0 and 1 alone, fixed).
 * An `abandoned` match with no result is abandoned. A decision is read last
 * (result.mjs applyDecision()).
 *
 * Null while nothing is decided — the shape every caller already reads.
 *
 * @param {(Innings | null | undefined)[]} innings  by innings number, or compacted (deriveMatch's)
 * @param {ResultOptions} [o]
 * @returns {MatchResult | null}
 */
export function describeResult(innings, o = {}) {
  const list = /** @type {Innings[]} */ ((innings ?? []).filter((x) => x != null));
  const conditions = o.conditions ?? {};
  const done = o.status === "complete";
  const keyOf = (/** @type {Innings} */ x) => x.teamKey ?? x.battingTeam ?? null;
  const eq = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
    a != null && b != null && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  // Which side bats each innings: by name, as the fixture wrote it; the first
  // innings' side failing that is the other of the first other side named,
  // and failing both the home side. match_result_sides() in SQL, one rule.
  const told = o.sides != null && (o.sides.home != null || o.sides.away != null);
  const byName = (/** @type {string | null} */ k) =>
    (!told ? null : eq(k, o.sides?.home) ? "home" : eq(k, o.sides?.away) ? "away" : null);
  const key0 = list.length ? keyOf(list[0]) : null;
  const firstOther = list.find((x) => keyOf(x) != null && !eq(keyOf(x), key0));
  const side0 = !told ? null : byName(key0) ?? otherSide(byName(firstOther ? keyOf(firstOther) : null)) ?? "home";
  /** @param {Innings} x @returns {string | null} */
  const sideOf = (x) => (side0 == null ? null : eq(keyOf(x), key0) ? side0 : otherSide(side0));

  /** @param {Innings} x @param {string} kind @param {number | null} value */
  const win = (x, kind, value) => {
    const side = sideOf(x);
    return { outcome: side === "home" ? OUTCOME.HOME_WIN : side === "away" ? OUTCOME.AWAY_WIN : OUTCOME.WIN,
             marginKind: kind, marginValue: value, winnerSide: side, winnerKey: keyOf(x), winner: x.battingTeam };
  };
  /** @param {string} outcome */
  const none = (outcome) => ({ outcome, marginKind: null, marginValue: null, winnerSide: null, winnerKey: null, winner: null });
  /** Wickets in hand: the squad less one, at most ten, less those down. @param {Innings} x */
  const inHand = (x) => Math.min(10, (x.squad?.length || 11) - 1) - x.wickets;
  /** @param {Innings} x */
  const reached = (x) => (x.penaltyWin ? win(x, MARGIN_KIND.PENALTY_RUNS, null) : win(x, MARGIN_KIND.WICKETS, inHand(x)));
  /** @param {Innings[]} xs @param {string | null} key @param {boolean} same */
  const runsOf = (xs, key, same) => xs.filter((x) => eq(keyOf(x), key) === same).reduce((n, x) => n + x.runs, 0);

  const play = (() => {
    if (conditions["format.innings_per_side"] === 2) {
      const [i0, i1, i2, i3] = list;
      if (i0?.complete && i1?.complete && i2?.complete && i2.endReason === INNINGS_END_REASON.ALL_OUT) {
        const twice = keyOf(i2);
        const three = [i0, i1, i2];
        const once = three.find((x) => !eq(keyOf(x), twice));
        const lead = runsOf(three, twice, false) - runsOf(three, twice, true);
        if (once && lead > 0) return win(once, MARGIN_KIND.INNINGS, lead);
      }
      if (i3?.complete && i3.endReason !== INNINGS_END_REASON.ABANDONED) {
        const chasing = keyOf(i3);
        const three = [i0, i1, i2];
        const other = three.find((x) => !eq(keyOf(x), chasing));
        const target = i3.target ?? runsOf(three, chasing, false) - runsOf(three, chasing, true) + 1;
        if (i3.runs >= target) return reached(i3);
        if (i3.endReason === INNINGS_END_REASON.ALL_OUT && other) {
          const short = target - 1 - i3.runs;
          return short > 0 ? win(other, MARGIN_KIND.RUNS, short) : none(OUTCOME.TIE);
        }
      }
      return none(done ? OUTCOME.DRAW : OUTCOME.IN_PROGRESS);
    }
    const [a, b] = list;
    if (!a || !b || !b.complete) return none(done ? OUTCOME.NO_RESULT : OUTCOME.IN_PROGRESS);
    if (b.endReason === INNINGS_END_REASON.ABANDONED) return none(OUTCOME.NO_RESULT);
    // The chase is judged against the TARGET, which is one more than the first
    // innings unless the umpires revised it. Comparing the two totals was right
    // only while those were the same number; in a rain-cut chase of 90 to beat
    // a 150, 100 is a win, not a loss by fifty.
    const target = b.target ?? a.runs + 1;
    // Reached is a win, whatever result.min_overs_per_side says; Law 16.7
    // (4th Edition, SCRBRD-113): a chase completed short, an award of penalty
    // runs then making it enough, is a win "by penalty runs".
    if (b.runs >= target) return reached(b);
    const least = conditions["result.min_overs_per_side"];
    if (typeof least === "number" && Number.isInteger(least) && least > 0 && b.overs < least
        && b.endReason === INNINGS_END_REASON.OVERS) return none(OUTCOME.NO_RESULT);
    const short = target - 1 - b.runs;
    return short > 0 ? win(a, MARGIN_KIND.RUNS, short) : none(OUTCOME.TIE);
  })();
  const decided = hasWinner(play.outcome) || play.outcome === OUTCOME.TIE || play.outcome === OUTCOME.DRAW;
  const played = o.status === "abandoned" && !decided ? none(OUTCOME.ABANDONED) : play;

  /** @param {string | null} side @returns {string | null} */
  const nameOfSide = (side) => (side !== "home" && side !== "away" ? null : o.names?.[side] ?? o.sides?.[side] ?? side);
  const r = applyDecision(played, o.decision, nameOfSide);
  if (r.outcome === OUTCOME.IN_PROGRESS && !r.decisionApplied) return null;
  /** A side named by an innings' key: its name for the words, else its battingTeam. @param {string} key */
  const keyName = (key) => {
    const x = list.find((y) => eq(keyOf(y), key));
    const side = x ? sideOf(x) : null;
    return (side === "home" || side === "away" ? o.names?.[side] : null) ?? x?.battingTeam ?? key;
  };
  /** @type {MatchResult} */
  const out = { ...r, margin: marginString(r.outcome, r.marginKind, r.marginValue), text: null };
  out.text = resultWords(out, { nameOf: (key, side) => (key != null ? keyName(key) : nameOfSide(side) ?? "—") });
  return out;
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
