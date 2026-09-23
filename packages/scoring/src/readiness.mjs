/**
 * SCRBRD-040 — can a delivery be recorded right now, and if not, why not.
 *
 * The scorer's gate used to be three lines inside a React component: no
 * striker or non-striker, pop the batting sheet; no bowler, pop the bowler
 * sheet; no innings at all, return false and do nothing. The gate was real and
 * it was implicit. A scorer who tapped "4" and got a sheet had to infer why;
 * one who tapped it on a fixture that had no innings open yet got nothing at
 * all, on the one screen where silence reads as "the ball registered".
 *
 * So the gate is a function of the folded innings, and it returns reasons, not
 * a boolean. The engine asks it before recording anything and the pad shows
 * what it said — one answer, two readers, so the words on screen and the gate
 * enforced cannot disagree. The pattern is the rubric's (rubric.test.mjs: "the
 * gate is legible — the rubric reports its own readiness").
 *
 * Only what the fold can see is named. The toss is deliberately absent: it is
 * not in the ball log (it lives in match_toss, server-side, and a resumed
 * fixture never carries it to the device), so a toss check here would be a
 * guess dressed as a gate. What the toss DECIDES — who is batting — is in the
 * log, on innings_start, and that is checked.
 */

/** Why a delivery cannot be recorded. Order below is the order to fix them in. */
export const SCORING_BLOCK = Object.freeze({
  NO_INNINGS:     "no_innings",      // no innings_start: nobody has said who is batting
  INNINGS_CLOSED: "innings_closed",  // the scorer confirmed the review; the innings is sealed
  INNINGS_OVER:   "innings_over",    // the laws say it is over; the review is still to confirm
  OPENERS:        "openers",         // the opening pair has not been named
  NEXT_BATTER:    "next_batter",     // an end is empty after a wicket or a retirement
  OPENING_BOWLER: "opening_bowler",  // nobody has bowled yet and nobody is named to
  NEXT_BOWLER:    "next_bowler",     // the over ended and replay cleared the bowler
});

/**
 * The words for each reason. `says` finishes the sentence "Can't score yet: …";
 * `fix` is the action that resolves it, worded as a button. Kept beside the
 * codes so a new reason cannot reach the screen without something to say.
 */
export const SCORING_BLOCK_TEXT = Object.freeze({
  [SCORING_BLOCK.NO_INNINGS]:     { says: "the batting side for this innings has not been set", fix: "Open the innings" },
  [SCORING_BLOCK.INNINGS_CLOSED]: { says: "this innings has been closed", fix: null },
  [SCORING_BLOCK.INNINGS_OVER]:   { says: "the innings is over — the figures are waiting to be confirmed", fix: "Review the innings" },
  [SCORING_BLOCK.OPENERS]:        { says: "the opening batters have not been chosen", fix: "Choose the opening batters" },
  [SCORING_BLOCK.NEXT_BATTER]:    { says: "there is no batter at one end", fix: "Send in the next batter" },
  [SCORING_BLOCK.OPENING_BOWLER]: { says: "the opening bowler has not been chosen", fix: "Choose the opening bowler" },
  [SCORING_BLOCK.NEXT_BOWLER]:    { says: "nobody is bowling the next over", fix: "Choose the bowler" },
});

const reason = (code, extra = {}) => ({ code, ...SCORING_BLOCK_TEXT[code], ...extra });

/**
 * Can the next delivery be recorded against this innings?
 *
 * @param {object|null} inn  a derived innings (deriveInnings), or null when the
 *                           log for this innings is empty
 * @returns {{ ready: boolean, blocked: {code:string, says:string, fix:string|null}[] }}
 *   `blocked` is empty exactly when `ready`, and otherwise lists every missing
 *   thing in the order the scorer has to supply them — `blocked[0]` is the one
 *   to fix now.
 */
export function scoringReadiness(inn) {
  // No innings, or a log with no innings_start in it: nothing says who is
  // batting, so there is nobody for a delivery to be scored to.
  if (!inn || inn.battingTeam == null) return { ready: false, blocked: [reason(SCORING_BLOCK.NO_INNINGS)] };

  // An innings that is over is over, whoever is or is not at the crease — all
  // out leaves an end empty, and that is not something to fix. Terminal, so
  // it is the only reason given.
  if (inn.sealed) return { ready: false, blocked: [reason(SCORING_BLOCK.INNINGS_CLOSED)] };
  if (inn.complete) return { ready: false, blocked: [reason(SCORING_BLOCK.INNINGS_OVER, { endReason: inn.endReason ?? null })] };

  const blocked = [];
  // Batters before the bowler: it is the order the sheets ask in, and the
  // order a scorer at the crease thinks in.
  if (inn.striker == null || inn.nonStriker == null) {
    // Nobody has been named at both ends yet, which only the opening pair can
    // be; after that, an empty end is a new arrival.
    const opening = (inn.batsmen?.length ?? 0) < 2;
    blocked.push(reason(opening ? SCORING_BLOCK.OPENERS : SCORING_BLOCK.NEXT_BATTER));
  }
  if (inn.bowler == null) {
    const opening = (inn.ballLog?.length ?? 0) === 0;
    blocked.push(opening
      ? reason(SCORING_BLOCK.OPENING_BOWLER)
      : reason(SCORING_BLOCK.NEXT_BOWLER, { over: Math.floor((inn.balls ?? 0) / 6) + 1 }));
  }
  return { ready: blocked.length === 0, blocked };
}
