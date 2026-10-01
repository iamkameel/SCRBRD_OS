/**
 * The league table's words and choices (SCRBRD-114 phase 3a; the screens are
 * views/standings.jsx). Pure, so every rule here is tested without a browser
 * (apps/web/test/standings.test.mjs).
 *
 * Nothing here computes a figure: the table, its ranks and its net run rate
 * are db/69's (competition_standing), read through
 * GET /api/competitions/:id/standings. This module only says them.
 */

/** A refusal from a results route, in words. */
export const RESULTS_REFUSAL = Object.freeze({
  not_permitted: "You may not change this league's results or its table.",
  support_session: "A support session does not change a result or a table.",
  kind_invalid: "Choose what was decided: a concession, a walkover or an award.",
  side_invalid: "Choose the side.",
  reason_required: "Say why, in ten characters or more.",
  note_required: "Say why it is withdrawn, in ten characters or more.",
  override_not_award: "Only an award can set aside a result that was played.",
  needs_play: "No ball has been bowled in this match: record a walkover or a concession.",
  already_decided: "This match already has a decision. Withdraw it first.",
  already_withdrawn: "That has already been withdrawn.",
  points_invalid: "Enter the points to a tenth, and not nought: −2, or 1.5.",
  entrant_invalid: "Choose a side in this league.",
  match_invalid: "That match is not played in this league.",
  no_document: "This match was scored before playing conditions, so it has no table figures to re-fix.",
  set_invalid: "Choose a published version of this league's conditions.",
});

/**
 * @param {any} e  an ApiError
 * @returns {string}
 */
export function resultsRefusal(e) {
  const code = e?.code;
  if (code === "over_rate_not_points" && typeof e.detail === "string" && e.detail) return cap(e.detail) + ".";
  if (code && Object.hasOwn(RESULTS_REFUSAL, code)) return RESULTS_REFUSAL[/** @type {keyof typeof RESULTS_REFUSAL} */ (code)];
  return e?.status ? `Not changed. The server said ${code || `HTTP ${e.status}`}.` : "Could not reach the server. Nothing was changed.";
}

const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Net run rate to three places, with its sign; a dash when there is none. @param {number | null | undefined} nrr */
export function nrrText(nrr) {
  if (nrr == null || !Number.isFinite(nrr)) return "—";
  const r = Math.round(nrr * 1000) / 1000;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(3)}`;
}

/** Points as a table prints them: whole where whole, else to a tenth. @param {number | null | undefined} p */
export function pointsText(p) {
  if (p == null || !Number.isFinite(p)) return "—";
  return Number.isInteger(p) ? String(p) : p.toFixed(1);
}

/** The basis of a table, in words. @param {string | null | undefined} basis */
export function basisWords(basis) {
  if (basis === "computed") return "Worked out from the results, under the league's confirmed points.";
  if (basis === "entered") return "As the schools entered it: the league's points are not confirmed yet, so nothing is worked out.";
  return "";
}

/** The order a table is ranked by, in words; head-to-head said as not applied (D13). @param {unknown} order */
export function orderWords(order) {
  const NAME = { points: "points", wins: "wins", nrr: "net run rate", fewer_losses: "fewer losses", head_to_head: "head-to-head (not applied)" };
  const list = (Array.isArray(order) ? order : ["points", "wins", "nrr"]).map((k) => NAME[/** @type {keyof typeof NAME} */ (k)] ?? String(k));
  return `Ranked by ${list.join(", then ")}. Sides level on every one share a place.`;
}

/**
 * The kinds of adjustment the sheet offers: an over-rate penalty in points
 * only where the league counts them in points (over_rate.kind, design §6.3).
 * @param {string | null | undefined} overRateKind
 * @returns {{value: string, label: string}[]}
 */
export function adjustmentKinds(overRateKind) {
  return [
    ...(overRateKind === "points" ? [{ value: "over_rate", label: "Over rate (the umpires' penalty)" }] : []),
    { value: "conduct", label: "Conduct" },
    { value: "correction", label: "A correction" },
    { value: "other", label: "Something else" },
  ];
}

/** What the league's over-rate setting means for the sheet, or nothing. @param {string | null | undefined} overRateKind */
export function overRateWords(overRateKind) {
  if (overRateKind === "points") return "This league's over-rate penalties are in points: enter the umpires' figure as an over-rate adjustment.";
  if (overRateKind === "runs") return "This league's over-rate penalties are in runs: the scorer records them as penalty runs on the pad, not here.";
  return "";
}

/**
 * The decisions the sheet offers for a match, and what each needs: a walkover
 * or a concession for a match with no ball bowled; an award may set aside a
 * result play reached (a protest upheld) and says so.
 * @param {{ outcome?: string | null, playOutcome?: string | null } | null | undefined} result
 * @param {boolean} played  whether a ball has been bowled
 */
export function decisionChoices(result, played) {
  const playWon = result?.playOutcome === "home_win" || result?.playOutcome === "away_win";
  return {
    kinds: [
      { value: "conceded", label: "Conceded", side: "Who conceded" },
      { value: "walkover", label: "Walkover", side: "Who goes through" },
      ...(played ? [{ value: "awarded", label: "Awarded by the organiser", side: "Who goes through" }] : []),
    ],
    // An award on a match play decided changes nothing unless it says it sets the result aside.
    overridable: playWon,
  };
}

/** A standing decision, in words, for the result row. @param {any} d @param {{home: string, away: string}} names */
export function decisionWords(d, names) {
  if (!d) return "";
  const side = d.side === "away" ? names.away : names.home;
  if (d.kind === "conceded") return `${side} conceded.`;
  if (d.kind === "walkover") return `Walkover to ${side}.`;
  return `Awarded to ${side} by the organiser${d.overridesPlay ? ", setting aside the result played" : ""}.`;
}
