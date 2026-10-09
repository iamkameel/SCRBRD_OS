/**
 * The words the analysis panels give to <SourceLine> (ui/sourceLine.jsx,
 * GA-I22): where a panel's figures come from, and the small sums that turn
 * rows the panel already holds into a window and a denominator. Nothing here
 * reads the network and nothing here guesses: a value the rows do not carry
 * comes back null, and the line then leaves that part out.
 *
 * WHERE THE FIGURES COME FROM, AS FAR AS THE READS SAY.
 *   - The ball log reads (phases, matchups, player_shot_points,
 *     dismissal_breakdown) fold delivery events, so their source is SRC_BALLS.
 *   - The career reads (career, career_by_season) count the ball log AND
 *     innings imported from a scorebook (db/64), added together; no row says
 *     which innings was which, so the line says both, as the passport does
 *     ("the match record"), instead of claiming one.
 *   - A ladder is worked out from results, or is the schools' own entries
 *     (the read's `basis`).
 *   - A demonstration is not a source: <SourceLine demo> says "Demo".
 */

/** Delivery events, scored on a pad or imported as events. */
export const SRC_BALLS = "Scored balls";
/** Career figures: scored balls and scorebook imports counted together. */
export const SRC_RECORD = "Scored balls and scorebook imports";
/** A ladder worked out from the results under the league's confirmed points. */
export const SRC_RESULTS = "Match results";
/** A ladder as the schools entered it. */
export const SRC_ENTERED = "The schools' own entries";
/** Completed fixtures and the toss that decided each. */
export const SRC_FIXTURES = "Completed fixtures";

/** Career reads carry no date filter: every match this reader may see. */
export const WINDOW_ALL = "Every season on record";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "12 Mar 2026" from an ISO date or timestamp, read as written (the first ten
 * characters), never through a Date and a time zone: a match played on the
 * 4th must not turn up on the 3rd for a reader in another zone.
 * @param {unknown} v @returns {string | null}
 */
export function isoDay(v) {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/**
 * A window from the first and last dates a panel's rows carry.
 * @param {unknown[]} dates  ISO dates or timestamps, any order; anything unreadable is ignored
 * @returns {string | null}  "4 Oct 2026" for one day, "12 Mar to 4 Oct 2026" for a span, null when no row has a date
 */
export function dateWindow(dates) {
  const days = [...new Set((dates ?? []).map((d) => (typeof d === "string" ? d.slice(0, 10) : null)).filter((d) => isoDay(d)))].sort();
  if (!days.length) return null;
  const first = isoDay(days[0]), last = isoDay(days[days.length - 1]);
  if (first === last) return first;
  // "12 Mar to 4 Oct 2026" when both are in one year; both years when not.
  const sameYear = days[0].slice(0, 4) === days[days.length - 1].slice(0, 4);
  return `${sameYear ? first.replace(/ \d{4}$/, "") : first} to ${last}`;
}

/**
 * One school season, named the way the awards tab names it.
 * @param {string | null | undefined} season  "2026" or "2025/26", exactly as the server filed it
 */
export const seasonWindow = (season) => (season ? `The ${season} school season` : null);

/**
 * The balls faced and the players behind a list of career rows, for the
 * panels that rank or chart them. `n` is the sum of the balls the scorebooks
 * recorded: a row whose balls were not recorded (null) adds nothing, so the
 * figure is "at least this many", which is what "recorded" says. Null when no
 * row carries a career figure at all (a demonstration, or a career read that
 * has not answered: the key is absent then), so the line leaves the basis out
 * rather than saying nought.
 * @param {{ ballsFaced?: number | null, live?: boolean }[]} players
 * @param {number} [floor]  the fewest balls the panel's own ranking needs (a sample floor it already applies), if it has one
 * @returns {{ n: number, unit: string, plural: string, detail: string, floor?: number } | null}
 */
export function ballsFacedBasis(players, floor) {
  const live = (players ?? []).filter((p) => p && p.live === true && "ballsFaced" in p);
  if (!live.length) return null;
  const n = live.reduce((s, p) => s + (typeof p.ballsFaced === "number" ? p.ballsFaced : 0), 0);
  return {
    n, unit: "ball faced", plural: "balls faced",
    detail: `${live.length} player${live.length === 1 ? "" : "s"}, as far as the scorebooks recorded them`,
    ...(typeof floor === "number" ? { floor } : null),
  };
}
