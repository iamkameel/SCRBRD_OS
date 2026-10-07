/**
 * When a weather reading was taken, and what kind of reading it is (GA-I18).
 *
 * Two different things reach a screen, and they were running together:
 *
 *   an OBSERVATION  what the scorer recorded for THIS fixture (match_weather,
 *                   read as `weather`), with the time he took it. The adapter
 *                   dropped that time, so a reading from yesterday looked like
 *                   one from this morning.
 *   a HINT          the provider's current conditions near a position
 *                   (/api/weather/hint, "Weather by Google"). It may prefill a
 *                   scorer's buttons; it is never the match's record.
 *
 * Neither is ever borrowed. A fixture's weather is the row for that fixture's
 * id: no row, no reading, and the screens say nothing rather than reaching for
 * another match's or another ground's. A reading with no time says so. One that
 * is old, for a match not yet played, says that.
 *
 * Pure: the clock is passed in. apps/web/test/weather-stamp.test.mjs holds it.
 */

/** A reading older than this, for a fixture that has not finished, is flagged. */
export const STALE_AFTER_MS = 6 * 3600e3;
/** A provider hint older than this is called out as old. */
export const HINT_STALE_AFTER_MS = 3 * 3600e3;

const ZONE = "Africa/Johannesburg";
const parts = (ms) => {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
};
const dayKey = (p) => `${p.year}-${p.month}-${p.day}`;
const clock = (p) => `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;

/** An ISO instant as milliseconds, or null. @param {unknown} iso */
const ms = (iso) => {
  const t = typeof iso === "string" || iso instanceof Date ? Date.parse(String(iso)) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** "09:15" the same SA day, else "3 Oct, 09:15". */
function when(at, now) {
  const a = parts(at), n = parts(now);
  return dayKey(a) === dayKey(n) ? clock(a) : `${Number(a.day)} ${a.month}, ${clock(a)}`;
}

/**
 * The line that goes with a recorded observation.
 *
 * @param {{ live?: boolean, observedAt?: string | null } | null | undefined} w  the adapted weather row
 * @param {{ now?: number, status?: string }} [o]  `status` is the fixture's: a finished one is a record, never "out of date"
 * @returns {null | { text: string, at: number | null, stale: boolean }}
 *   null for a demonstration row, which was never observed by anyone
 */
export function observedStamp(w, { now = Date.now(), status } = {}) {
  if (!w || w.live !== true) return null;
  const at = ms(w.observedAt);
  if (at == null) return { text: "Time of observation not recorded", at: null, stale: false };
  const finished = status === "complete" || status === "abandoned";
  const stale = !finished && now - at > STALE_AFTER_MS;
  // A reading dated after "now" is a clock disagreeing, not a forecast; it is shown as taken.
  return { text: `Observed ${when(at, now)}${stale ? ", may be out of date" : ""}`, at, stale };
}

/**
 * How a provider hint is introduced: as a hint, with the provider's own time
 * when it gave one. The caller adds the words of the reading and attribution.
 *
 * @param {{ observed_at?: string | null } | null | undefined} hint
 * @param {number} [now]
 * @returns {{ lead: string, asOf: string | null, stale: boolean }}
 */
export function hintStamp(hint, now = Date.now()) {
  const lead = "Weather hint, not the match's record";
  const at = ms(hint?.observed_at);
  if (at == null) return { lead, asOf: null, stale: false };
  const stale = now - at > HINT_STALE_AFTER_MS;
  return { lead, asOf: `as of ${when(at, now)}${stale ? ", an old reading" : ""}`, stale };
}
