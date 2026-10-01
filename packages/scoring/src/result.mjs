/**
 * SCRBRD — a match's result, as words and as a shape (SCRBRD-114 phase 3a).
 *
 * docs/design/SCRBRD-114_phase3_results_super_over.md §2. The RULE is the
 * fold's describeResult() (replay.mjs), mirrored in SQL by match_result()
 * (db/69) and held to it by tools/smoke-fold-figures.mjs; this module holds
 * what both share: the outcome vocabulary, the decision layer and the words.
 * So the pad, the scorecard, the standings screen and the public page say
 * one thing about one result, whichever of the two computed it.
 *
 *   outcome      home_win | away_win | tie | draw | no_result | abandoned
 *                | in_progress — the MATCH's, from its scheduled innings.
 *                The fold, told no sides, says `win` for a win (it cannot
 *                know which side is home); told them, as SQL always is, the
 *                side's.
 *   marginKind   runs | wickets | penalty_runs | innings | conceded |
 *                walkover | awarded | null
 *   marginValue  runs, wickets in hand, or runs with an innings; else null
 *   decidedBy    play | super_over | decision | null — who settled who goes
 *                through. super_over (phase 3b): a tied match whose document
 *                provides one, settled by the first super over won; null for
 *                such a tie nothing has settled yet
 *   winnerSide   home | away | null
 *
 * A DECISION (match_result_decision, db/69) is read last: play first, then
 * the decision where play named no winner, and an award that overrides play
 * above everything. A concession or a walkover is a win for the other side
 * (Law 16.3: the umpires award the match); an award without the override
 * names who goes through and leaves the match's own outcome as it was, so a
 * league table reads the tie it was.
 */

/** The outcomes, as match_result() names them. */
export const OUTCOME = Object.freeze({
  HOME_WIN: "home_win", AWAY_WIN: "away_win", WIN: "win",
  TIE: "tie", DRAW: "draw", NO_RESULT: "no_result", ABANDONED: "abandoned", IN_PROGRESS: "in_progress",
});

/** How a win was had. */
export const MARGIN_KIND = Object.freeze({
  RUNS: "runs", WICKETS: "wickets", PENALTY_RUNS: "penalty_runs", INNINGS: "innings",
  CONCEDED: "conceded", WALKOVER: "walkover", AWARDED: "awarded",
});

/** Who settled who goes through. */
export const DECIDED_BY = Object.freeze({ PLAY: "play", SUPER_OVER: "super_over", DECISION: "decision" });

/** A decision's kinds (match_result_decision.kind). */
export const DECISION_KIND = Object.freeze({ CONCEDED: "conceded", WALKOVER: "walkover", AWARDED: "awarded" });

/**
 * A standing decision, as the fold and the words read it.
 * @typedef {{kind: string, side: string, overridesPlay?: boolean, reason?: string | null}} ResultDecision
 */

/**
 * A result. `winner` and `margin` are the shape every caller of
 * deriveMatch().result has always read ("Hilton College", "3 wickets");
 * the rest is SCRBRD-114 phase 3a's.
 * @typedef {object} MatchResult
 * @property {string | null | undefined} winner   the winning innings' battingTeam, or the
 *   decided side's name; null when nobody won
 * @property {string} margin   "3 wickets", "12 runs", "penalty runs", "an innings and 23 runs",
 *   "tie", "draw", "no result", "abandoned", "conceded", "walkover", "award"
 * @property {string} outcome  one of OUTCOME
 * @property {string | null} marginKind  one of MARGIN_KIND, or null
 * @property {number | null} marginValue
 * @property {string | null} decidedBy  one of DECIDED_BY, or null
 * @property {string | null} winnerSide  "home" | "away" | null
 * @property {string | null} winnerKey   the winning innings' teamKey (as innings_start wrote it)
 * @property {string} playOutcome  the outcome play alone gave, before any decision
 * @property {ResultDecision | null} decision  the standing decision, applied or shown beside
 * @property {boolean} decisionApplied  whether the decision settled anything
 * @property {string | null} playWinnerKey  play's winner, kept beside an award that overrides it
 * @property {string | null} playWinnerSide
 * @property {string | null} playMarginKind
 * @property {number | null} playMarginValue
 * @property {string | null} text  the result in words (resultWords())
 * @property {import("./replay.mjs").SuperOver[]} [superOvers]  the match's super overs, where
 *   its document provides one and the match is tied (SCRBRD-114 phase 3b); else []
 */

/** @type {ReadonlySet<string>} */
const WIN_OUTCOMES = new Set([OUTCOME.HOME_WIN, OUTCOME.AWAY_WIN, OUTCOME.WIN]);

/** Did this outcome name a winner? @param {string | null | undefined} o */
export const hasWinner = (o) => o != null && WIN_OUTCOMES.has(o);

/** @param {string | null | undefined} side @returns {"home" | "away" | null} */
export const otherSide = (side) => (side === "home" ? "away" : side === "away" ? "home" : null);

/** @param {string | null} side */
const sideWin = (side) => (side === "home" ? OUTCOME.HOME_WIN : side === "away" ? OUTCOME.AWAY_WIN : OUTCOME.WIN);

/** "3 wickets", "1 run". @param {number} n @param {string} unit */
const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * The compatible `margin` string for a result's kind and value.
 * @param {string} outcome @param {string | null} kind @param {number | null} value
 */
export function marginString(outcome, kind, value) {
  switch (kind) {
    case MARGIN_KIND.WICKETS: return plural(value ?? 0, "wicket");
    case MARGIN_KIND.RUNS: return plural(value ?? 0, "run");
    case MARGIN_KIND.PENALTY_RUNS: return "penalty runs";
    case MARGIN_KIND.INNINGS: return `an innings and ${plural(value ?? 0, "run")}`;
    case MARGIN_KIND.CONCEDED: return "conceded";
    case MARGIN_KIND.WALKOVER: return "walkover";
    case MARGIN_KIND.AWARDED: return "award";
    default: break;
  }
  switch (outcome) {
    case OUTCOME.TIE: return "tie";
    case OUTCOME.DRAW: return "draw";
    case OUTCOME.NO_RESULT: return "no result";
    case OUTCOME.ABANDONED: return "abandoned";
    default: return "";
  }
}

/**
 * Play's answer, with a standing decision applied (design §2.2, §2.5):
 * an award with `overridesPlay` always; any other decision only where play
 * named no winner; otherwise play stands and the decision is shown beside it.
 *
 * @param {{outcome: string, marginKind: string | null, marginValue: number | null,
 *          winnerSide: string | null, winnerKey: string | null, winner: string | null | undefined}} play
 * @param {ResultDecision | null | undefined} decision
 * @param {(side: string | null) => string | null} [nameOfSide]  for `winner` when a decision names the side
 */
export function applyDecision(play, decision, nameOfSide = () => null) {
  // A super over (phase 3b) comes with its own: super_over when one was won,
  // null for a tie none has settled. Otherwise play's, as before.
  const own = /** @type {{decidedBy?: string | null}} */ (play).decidedBy;
  const base = {
    ...play,
    decidedBy: own !== undefined ? own
      : hasWinner(play.outcome) || play.outcome === OUTCOME.TIE || play.outcome === OUTCOME.DRAW ? DECIDED_BY.PLAY : null,
    playOutcome: play.outcome, decision: decision ?? null, decisionApplied: false,
    // What play said, kept beside an award that overrides it, so the words
    // say both ("Northwood won by 3 wickets; awarded to Kearsney …").
    playWinnerKey: play.winnerKey, playWinnerSide: play.winnerSide,
    playMarginKind: play.marginKind, playMarginValue: play.marginValue,
  };
  const d = decision;
  if (!d || (d.side !== "home" && d.side !== "away")) return base;
  const decided = (/** @type {string} */ outcome, /** @type {string | null} */ kind, /** @type {string | null} */ side) => ({
    ...base, outcome, marginKind: kind, marginValue: null, winnerSide: side, winnerKey: null,
    winner: nameOfSide(side), decidedBy: DECIDED_BY.DECISION, decisionApplied: true,
  });
  if (d.kind === DECISION_KIND.AWARDED && d.overridesPlay === true) return decided(sideWin(d.side), MARGIN_KIND.AWARDED, d.side);
  // Play first, the super over second (design §2.5): either naming a winner
  // stands, and the decision is shown beside it.
  if (hasWinner(play.outcome) || base.decidedBy === DECIDED_BY.SUPER_OVER) return base;
  if (d.kind === DECISION_KIND.CONCEDED) return decided(sideWin(otherSide(d.side)), MARGIN_KIND.CONCEDED, otherSide(d.side));
  if (d.kind === DECISION_KIND.WALKOVER) return decided(sideWin(d.side), MARGIN_KIND.WALKOVER, d.side);
  if (d.kind === DECISION_KIND.AWARDED) {
    // Who goes through, where play could not say: the match's own outcome
    // (a tie, a no result) is what it was, and the table reads it.
    return { ...base, winnerSide: d.side, winner: nameOfSide(d.side), winnerKey: null,
             decidedBy: DECIDED_BY.DECISION, decisionApplied: true };
  }
  return base;
}

/**
 * A result in words (design §2.4). `nameOf(key, side)` names a side: by the
 * innings' key where play decided it, by home/away where a decision did.
 * `reasons: false` leaves a decision's reason out — the public page's words,
 * since an organiser's free text is not a team fact (PUBLIC_DATA §3).
 *
 *   "Kearsney won by 3 wickets" · "… by 12 runs" · "… by penalty runs" ·
 *   "… by an innings and 23 runs" · "Match tied" · "Match drawn" ·
 *   "No result" · "Match abandoned" · "Kearsney conceded; awarded to
 *   Northwood" · "Walkover to Northwood" · "Match tied; awarded to Northwood
 *   by the organiser: <reason>" · "Northwood won by 3 wickets; awarded to
 *   Kearsney by the organiser: <reason>" · "Match tied; Northwood won the
 *   super over" · "Match tied; two super overs tied; Northwood won the third"
 *   · "Match tied; the super over was not completed" (phase 3b, §2.4)
 *
 * @param {Pick<MatchResult, "outcome" | "marginKind" | "marginValue" | "winnerSide" | "winnerKey" | "playOutcome" | "decision" | "decisionApplied"> & {winner?: string | null, playWinnerKey?: string | null, playWinnerSide?: string | null, playMarginKind?: string | null, playMarginValue?: number | null, superOvers?: import("./replay.mjs").SuperOver[]}} r
 * @param {{nameOf?: (key: string | null, side: string | null) => string, reasons?: boolean}} [o]
 * @returns {string | null}
 */
export function resultWords(r, { nameOf = (key, side) => key ?? side ?? "—", reasons = true } = {}) {
  if (!r) return null;
  const d = r.decisionApplied ? r.decision : null;
  const reason = d?.reason && reasons ? `: ${String(d.reason).trim()}` : "";
  /** The words play alone gives. */
  const playWords = () => {
    const o = r.playOutcome ?? r.outcome;
    if (hasWinner(o)) {
      const key = r.playWinnerKey !== undefined ? r.playWinnerKey : r.winnerKey;
      const side = r.playWinnerSide !== undefined ? r.playWinnerSide : r.winnerSide;
      const kind = r.playMarginKind !== undefined ? r.playMarginKind : r.marginKind;
      const value = r.playMarginValue !== undefined ? r.playMarginValue : r.marginValue;
      return `${nameOf(key ?? null, side ?? null)} won by ${marginString(o, kind, value)}`;
    }
    switch (o) {
      case OUTCOME.TIE: return `Match tied${superOverWords(r.superOvers ?? [], nameOf)}`;
      case OUTCOME.DRAW: return "Match drawn";
      case OUTCOME.NO_RESULT: return "No result";
      case OUTCOME.ABANDONED: return "Match abandoned";
      default: return null;
    }
  };
  if (!d) return playWords();
  const to = nameOf(null, r.winnerSide ?? null);
  switch (d.kind) {
    case DECISION_KIND.CONCEDED: return `${nameOf(null, d.side)} conceded; awarded to ${to}`;
    case DECISION_KIND.WALKOVER: return `Walkover to ${to}`;
    default: {
      const before = playWords();
      return before ? `${before}; awarded to ${to} by the organiser${reason}` : `Awarded to ${to} by the organiser${reason}`;
    }
  }
}

/** "two", "three" … for the words; a figure past ten. @param {number} n */
const numberWord = (n) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
/** "first", "second" … @param {number} n */
const ordinalWord = (n) => ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"][n] ?? `${n}th`;

/**
 * What the super overs add to "Match tied" (SCRBRD-114 phase 3b, §2.4): who
 * won, how many tied before, or that one was not completed. Nothing where
 * none was played. The super over's own figures are the scorecard's.
 * @param {import("./replay.mjs").SuperOver[]} pairs
 * @param {(key: string | null, side: string | null) => string} nameOf
 */
export function superOverWords(pairs, nameOf) {
  if (!pairs.length) return "";
  let tied = 0;
  for (const p of pairs) {
    if (p.state === "won") {
      const who = nameOf(p.winnerKey ?? null, p.winner ?? null);
      return tied === 0 ? `; ${who} won the super over`
        : `; ${tied === 1 ? "the first super over" : `${numberWord(tied)} super overs`} tied; ${who} won the ${ordinalWord(tied + 1)}`;
    }
    if (p.state !== "tied") {
      return tied === 0 ? "; the super over was not completed"
        : `; ${tied === 1 ? "the first super over" : `${numberWord(tied)} super overs`} tied; the ${ordinalWord(tied + 1)} was not completed`;
    }
    tied++;
  }
  return tied === 1 ? "; the super over tied" : `; ${numberWord(tied)} super overs tied`;
}

/**
 * A row of match_result() (db/69), in the shape the words and the screens
 * read: the SQL mirror's answer, as describeResult() gives the fold's.
 * @param {any} row
 * @returns {MatchResult | null}
 */
export function resultFromRow(row) {
  if (!row) return null;
  const dec = row.decision && typeof row.decision === "object"
    ? { kind: row.decision.kind, side: row.decision.side, overridesPlay: row.decision.overrides_play === true,
        reason: row.decision.reason ?? null }
    : null;
  const r = {
    outcome: row.outcome, marginKind: row.margin_kind ?? null,
    marginValue: row.margin == null ? null : Number(row.margin),
    decidedBy: row.decided_by ?? null, winnerSide: row.winner_side ?? null, winnerKey: row.winner_key ?? null,
    winner: row.winner_key ?? null, playOutcome: row.play_outcome ?? row.outcome,
    decision: dec, decisionApplied: row.decision_applied === true,
    playWinnerKey: row.play_winner_key ?? null, playWinnerSide: row.play_winner_side ?? null,
    playMarginKind: row.play_margin_kind ?? null, playMarginValue: row.play_margin == null ? null : Number(row.play_margin),
    text: null,
    // Phase 3b: the super overs, as describeResult() lists them.
    superOvers: (Array.isArray(row.super_overs) ? row.super_overs : []).map((/** @type {any} */ p) => ({
      n: p.n, first: p.first ?? null, a: p.a ?? null, b: p.b ?? null, state: p.state,
      winner: p.winner ?? null, winnerKey: p.winner_key ?? null })),
  };
  return { ...r, margin: marginString(r.outcome, r.marginKind, r.marginValue) };
}
