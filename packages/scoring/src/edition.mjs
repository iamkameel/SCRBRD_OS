/**
 * WHICH EDITION OF THE LAWS A MATCH IS SCORED UNDER (SCRBRD-113).
 *
 * The MCC Laws of Cricket, 2017 Code: the 3rd Edition (2022) until 30
 * September 2026, the 4th Edition (2026) from 1 October 2026. Decided by
 * Kameel (2026-09-27): THE EDITION FOLLOWS THE MATCH DATE. A match that
 * starts before 1 October 2026 is scored under the 3rd Edition for the whole
 * of it — the second day of a two-day match included — and one that starts
 * on or after it under the 4th. So a log written under the 3rd replays, on
 * any day, exactly as it did. There is no per-competition setting (one is
 * added only if a school's competition adopts the 4th Edition later).
 *
 * THE MATCH DATE, in order:
 *
 *   1. The fixture's start (`match.starts_at`), where the reader has it: the
 *      server always (services/api/write/events-api.mjs reads it beside the
 *      log), the pad for a fixture it opened from the server (cfg.startsAt).
 *      It is what the school scheduled, and it is right for a match scored
 *      afterwards from a paper book.
 *   2. Otherwise the match's first event: the `clientTs` of the first event
 *      of its lowest-numbered innings — the innings_start the pad wrote when
 *      play began. Every reader holds the log, so a match with no fixture
 *      (the pad's own, the demo) is dated the same everywhere.
 *   3. A match with neither — no fixture date and nothing in its log yet —
 *      is under the Edition in force now. Nothing in an empty log depends
 *      on it.
 *
 * Dates are South African (SAST, UTC+2, no daylight saving), as every SQL
 * reader already dates a fixture (`starts_at AT TIME ZONE
 * 'Africa/Johannesburg'`): a match that starts at 00:30 on 1 October SAST is
 * a 4th-Edition match although it is still 30 September in UTC.
 *
 * WHERE IT IS READ. The fold resolves the Edition once per match from its
 * context (FoldContext.startsAt) and its log, and stamps it on every innings
 * it returns (`inn.lawsEdition`); lawsRefusal() and the pad's sheets read it
 * back through lawsEdition(match), so a caller that holds the fold's innings
 * needs nothing more. What differs by Edition, and nothing else:
 *
 *   - how long a suspension for a deliberate front-foot no-ball or a
 *     deliberate beamer lasts (suspensionScope(), events.mjs);
 *   - who chooses the striker after deliberate short running, and after an
 *     obstruction that prevented a catch (`facesNext`, laws.mjs);
 *   - penalty runs after a result, which may reopen a chase, and a result
 *     "by penalty runs" (the PENALTY case of the fold, penaltyRefusal()).
 */

/** The two Editions a match can be scored under. */
export const LAWS_EDITION = Object.freeze({ THIRD: 3, FOURTH: 4 });
/** @typedef {typeof LAWS_EDITION[keyof typeof LAWS_EDITION]} LawsEdition */
/** @type {ReadonlySet<unknown>}  asked of whatever a caller holds */
export const LAWS_EDITIONS = new Set(Object.values(LAWS_EDITION));

/** The first day of the 4th Edition, as a South African calendar date. */
export const FOURTH_EDITION_FROM = "2026-10-01";

/** South African Standard Time is UTC+2 all year. */
const SAST_MS = 2 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The South African calendar date of a moment: "2026-10-01". A bare date
 * ("2026-10-01") is itself; a timestamp in ms, a Date or an ISO date-time
 * (a Postgres timestamptz as JSON) is read as the instant it is and dated in
 * SAST. Anything that is not a moment is null.
 * @param {unknown} when
 * @returns {string | null}
 */
export function matchDay(when) {
  if (typeof when === "string" && ISO_DAY.test(when)) return when;
  let ms = NaN;
  if (when instanceof Date) ms = when.getTime();
  else if (typeof when === "number") ms = when;
  else if (typeof when === "string" && when.trim() !== "") ms = Date.parse(when);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + SAST_MS).toISOString().slice(0, 10);
}

/**
 * The Edition in force on a day. A moment matchDay() cannot read is taken as
 * now: the Edition in force today.
 * @param {unknown} when
 * @returns {LawsEdition}
 */
export function lawsEditionOn(when) {
  const day = matchDay(when) ?? /** @type {string} */ (matchDay(Date.now()));
  return day >= FOURTH_EDITION_FROM ? LAWS_EDITION.FOURTH : LAWS_EDITION.THIRD;
}

/**
 * The `clientTs` of a match's first event: the first event of its
 * lowest-numbered innings, in log order. `events` is the log by innings (the
 * pad's and the Laws' shape, `events[i]` innings i's log) or one flat log in
 * seq order (a fold's input). Null when no event carries a time.
 * @param {unknown} events
 * @returns {number | null}
 */
export function firstEventTs(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  /** @type {any[]} */
  let flat;
  if (events.some(Array.isArray)) {
    const first = events.find((l) => Array.isArray(l) && l.length > 0);
    flat = first ?? [];
  } else {
    flat = events;
  }
  let low = Infinity;
  for (const e of flat) if (e && typeof e === "object") low = Math.min(low, Number(e.innings ?? 0));
  for (const e of flat) {
    if (e && typeof e === "object" && Number(e.innings ?? 0) === low && Number.isFinite(e.clientTs)) return e.clientTs;
  }
  return null;
}

/**
 * THE EDITION A MATCH IS SCORED UNDER — the one helper every
 * Edition-dependent rule reads. `match` is any of:
 *
 *   - a match as the Laws read it, `{innings, events}` (MatchFold.view(), or
 *     the pad's fold and log), optionally with `startsAt`: the fixture's
 *     start first, then the Edition the fold stamped on its innings, then
 *     the log's first event;
 *   - `{startsAt, events}`: what the fold itself asks with (see replay.mjs);
 *   - a date (a bare day, a timestamp, a Date): the Edition on that day.
 *
 * @param {unknown} match
 * @returns {LawsEdition}
 */
export function lawsEdition(match) {
  if (match == null || typeof match !== "object" || match instanceof Date) {
    return lawsEditionOn(match ?? Date.now());
  }
  const m = /** @type {{startsAt?: unknown, innings?: unknown, events?: unknown}} */ (match);
  if (matchDay(m.startsAt) != null) return lawsEditionOn(m.startsAt);
  if (Array.isArray(m.innings)) {
    for (const inn of m.innings) {
      const e = inn?.lawsEdition;
      if (LAWS_EDITIONS.has(e)) return /** @type {LawsEdition} */ (e);
    }
  }
  return lawsEditionOn(firstEventTs(m.events) ?? Date.now());
}
