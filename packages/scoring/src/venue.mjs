/**
 * SCRBRD — par at a ground, and par at a point (SCRBRD-130 phase R3;
 * docs/design/SCRBRD-130_rain_and_par.md §6).
 *
 * Par at a ground is the mean of what sides have actually made batting first
 * there, in the same kind of match: venue_par() (db/74) computes it from the
 * log on every read and stores it nowhere. This module holds the two things
 * JavaScript needs of it:
 *
 *   VENUE_PAR_MIN_INNINGS  the floor, a platform constant (D11), pinned beside
 *                          db/74's venue_par_min_innings() by the string
 *                          VENUE_PAR_PIN: venue.test.mjs pins it here and
 *                          db/99 §53 builds the same string from SQL.
 *   parAt()                par at a point in an innings at that ground (§6.5),
 *                          either innings: the venue par times the resources a
 *                          side at this point has used — by the DLS table when
 *                          the caller has one (R2: server-side only, D6), else
 *                          the proportion of overs bowled, labelled so.
 *
 * It is evidence from the ground's own record, not the invented absolute par
 * phases.mjs refuses (the phase card's par stays the other side's figure in
 * the same phase), and never a substitute for G50 (D7). Integer arithmetic,
 * one rounding (half up), as dls.mjs.
 */

/** The fewest first innings a ground's par is given from (D11). */
export const VENUE_PAR_MIN_INNINGS = 5;

/** The pin db/99 §53 compares SQL's floor with. */
export const VENUE_PAR_PIN = `venue_par.min_innings=${VENUE_PAR_MIN_INNINGS}`;

/** How par at a point was reckoned. */
export const PAR_AT_METHOD = Object.freeze({ DLS: "dls_resources", PROPORTION: "proportion" });

/** The label each method carries on the board. */
export const PAR_AT_LABEL = Object.freeze({
  dls_resources: "DLS resources used, of a full innings here",
  proportion: "proportion of overs; no DLS table loaded",
});

/** round(num / den), half up, for den > 0 and num >= 0, in integers. @param {number} num @param {number} den */
const roundDiv = (num, den) => Math.floor((2 * num + den) / (2 * den));

/**
 * Par at a point (§6.5): what a typical side at this ground would have by now.
 *
 *   with a table:  round( P × (R(N,0) − R(b,w)) / R(N,0) )
 *   no table:      round( P × (N − b) / N )
 *
 * `N` is the innings' allotment in balls (its current one: a reduced innings
 * is measured against the full-length par, the only pool there is, and the
 * label says "of a full innings here"); `b` the balls remaining; `w` the
 * wickets down. `resources(b, w)` is dls.mjs resourcesOf() bound to a table,
 * in tenths of a percent; absent, the proportion.
 *
 * @param {number | null | undefined} par  the ground's par (venue_par().par); null when insufficient
 * @param {{allottedBalls: number, balls: number, wickets: number}} at  the innings now
 * @param {{resources?: ((ballsRemaining: number, wickets: number) => number | null) | null}} [o]
 * @returns {{runs: number, wickets: number, method: string, label: string} | null}
 */
export function parAt(par, at, { resources = null } = {}) {
  if (!Number.isInteger(par) || /** @type {number} */ (par) < 0) return null;
  const N = at?.allottedBalls, bowled = at?.balls, w = at?.wickets;
  if (!Number.isInteger(N) || /** @type {number} */ (N) <= 0 || !Number.isInteger(bowled) || /** @type {number} */ (bowled) < 0
      || !Number.isInteger(w) || /** @type {number} */ (w) < 0) return null;
  const P = /** @type {number} */ (par), n = /** @type {number} */ (N);
  const used = Math.min(/** @type {number} */ (bowled), n);
  const left = n - used;
  if (resources) {
    const full = resources(n, 0), now = resources(left, Math.min(/** @type {number} */ (w), 10));
    if (Number.isInteger(full) && /** @type {number} */ (full) > 0 && Number.isInteger(now) && /** @type {number} */ (now) >= 0) {
      const spent = Math.max(0, /** @type {number} */ (full) - /** @type {number} */ (now));
      return { runs: roundDiv(P * spent, /** @type {number} */ (full)), wickets: /** @type {number} */ (w),
               method: PAR_AT_METHOD.DLS, label: PAR_AT_LABEL.dls_resources };
    }
  }
  return { runs: roundDiv(P * used, n), wickets: /** @type {number} */ (w), method: PAR_AT_METHOD.PROPORTION, label: PAR_AT_LABEL.proportion };
}

/**
 * The board's line (§1): "A typical side here would be 61/3 by now", or, below
 * the floor, "No venue par here yet (2 of 5)".
 * @param {{par: number | null, n: number, floor?: number, sufficient: boolean} | null | undefined} venue
 * @param {ReturnType<typeof parAt>} at
 * @returns {string | null}
 */
export function parAtWords(venue, at) {
  if (!venue) return null;
  if (!venue.sufficient) return `No venue par here yet (${venue.n} of ${venue.floor ?? VENUE_PAR_MIN_INNINGS})`;
  if (!at) return null;
  return `A typical side here would be ${at.runs}/${at.wickets} by now`;
}

/**
 * The ground page's line (§1): "Par at this ground: 128", or "Not enough
 * matches here yet (2 of 5)".
 * @param {{par: number | null, n: number, floor?: number, sufficient: boolean} | null | undefined} venue
 */
export function venueParWords(venue) {
  if (!venue) return null;
  return venue.sufficient && venue.par != null ? `Par at this ground: ${venue.par}`
    : `Not enough matches here yet (${venue.n} of ${venue.floor ?? VENUE_PAR_MIN_INNINGS})`;
}
