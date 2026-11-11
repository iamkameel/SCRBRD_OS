/**
 * The South African day and clock of an instant (Africa/Johannesburg: UTC+2,
 * no summer time), for every screen that names a day or a time. A person
 * using SCRBRD reads the SA day and the SA clock, never UTC's.
 *
 * - An instant (an ISO string with a Z or an offset, a Date, or ms) is moved
 *   onto the SA clock: "2026-11-06T12:30:00Z" reads 14:30 on 6 Nov, and
 *   "2026-11-06T23:30:00Z" reads 01:30 on 7 Nov.
 * - A date-only string ("2026-11-06") is a day already, and is returned as is.
 * - A date and time with no zone ("2026-11-06T14:30") is a wall clock already
 *   written on the SA clock, and is read as written, never shifted twice.
 *
 * Pure, and small: the public bundle may carry it.
 */

const SA_OFFSET_MS = 2 * 3600e3;
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const WALL = /^(\d{4}-\d{2}-\d{2}).(\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/;

/** @param {unknown} ts @returns {Date | null} the instant moved onto the SA clock (read it with toISOString or the getUTC methods) */
function onSaClock(ts) {
  const ms = ts instanceof Date ? ts.getTime() : typeof ts === "number" ? ts : Date.parse(String(ts));
  return Number.isFinite(ms) ? new Date(ms + SA_OFFSET_MS) : null;
}

/** "YYYY-MM-DD", the SA day of an instant; a date-only string unchanged; null if none. @param {unknown} ts */
export function saDate(ts) {
  if (ts == null || ts === "") return null;
  if (typeof ts === "string") {
    const s = ts.trim();
    if (DAY_ONLY.test(s)) return s;
    const w = WALL.exec(s);
    if (w) return w[1];
  }
  const d = onSaClock(ts);
  return d ? d.toISOString().slice(0, 10) : null;
}

/** "HH:MM", the SA clock time of an instant; null for none or a date-only string. @param {unknown} ts */
export function saClock(ts) {
  if (ts == null || ts === "") return null;
  if (typeof ts === "string") {
    const s = ts.trim();
    if (DAY_ONLY.test(s)) return null;
    const w = WALL.exec(s);
    if (w) return w[2];
  }
  const d = onSaClock(ts);
  return d ? d.toISOString().slice(11, 16) : null;
}
