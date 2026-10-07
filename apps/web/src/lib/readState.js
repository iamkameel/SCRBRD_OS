/**
 * What a read can say, and the one sentence for each (GA-I08).
 *
 * `useLive` hands a screen { rows, live, loading, error, disabled }. Screens
 * were reading that as "rows or nothing", so a read that was still coming, one
 * that failed, one the reader may not see and one that came back empty all
 * drew the same blank, and a blank reads as "none". "Nobody is out" over an
 * injuries read that failed is the worst of them: it is good news nobody sent.
 *
 * This is the single place that decides which of nine things a read is. Each
 * one is a different statement and draws a different sentence.
 *
 *   loading     the first answer has not come back. Say nothing about the data.
 *   empty       the server answered, and the answer is none.
 *   unassessed  the person exists and has no assessment. Not a zero: he has
 *               not been rated, and a 0 or an empty radar would say he was.
 *   forbidden   a 403 that is not a switched-off module: this role may not
 *               read it. Retrying cannot change that, so no retry.
 *   disabled    the module is switched off for the school. A setting, not a
 *               fault, and not retried.
 *   failed      unreachable, a timeout, a 5xx, or any other error.
 *   stale       an answer whose observation is older than the given age.
 *   partial     several reads, some answered and some failed.
 *   ok          none of the above.
 *
 * FORBIDDEN VERSUS FAILED is decided by status and code, never by guess:
 *   - 403 with any code but module_disabled           → forbidden
 *   - 403 / error module_disabled                     → disabled
 *   - code 42501 (Postgres insufficient_privilege)    → forbidden. The read
 *     route answers a privilege error as a 500 carrying the bare code
 *     (read-api.mjs: `e.status || 500`, `e.code || e.message`); every other
 *     route maps the same code to 403, so it is read the same way here.
 *   - 401                                             → failed, saying sign in
 *     again, with no retry (the same read would be refused the same way)
 *   - anything else, including no status at all (a timeout or no network)
 *                                                      → failed
 *
 * WORDS. Each sentence is built from the reader's own `what` ("skills
 * assessments", "career figures"), never from a row: no name of a child can
 * reach one because no row is ever read here beyond its count. Loading is
 * "Reading …", a failure is "Could not read …", and an empty answer is
 * "No … on record". None of them says "done" or "ready", or prints a
 * percentage.
 *
 * PURE. No React, no DOM, no clock of its own: `now` is passed in.
 * apps/web/test/readstate.test.mjs holds it.
 */

/** @typedef {"loading"|"empty"|"unassessed"|"forbidden"|"disabled"|"failed"|"stale"|"partial"|"ok"} ReadStateName */

/**
 * @typedef {object} Read  what useLive() returns
 * @property {any[]} [rows]
 * @property {boolean} [live]
 * @property {boolean} [loading]
 * @property {string | boolean | null} [error]
 * @property {string | null} [disabled]  the resource whose module is off
 * @property {number | null} [status]    the HTTP status of the refusal, when there was one
 * @property {string | null} [observedAt]  when the data was observed, where it carries a time
 */

/**
 * @typedef {object} Result
 * @property {ReadStateName} state
 * @property {string | null} sentence  one plain sentence; null only for `ok`
 * @property {boolean} retry           whether a second read could change the answer
 * @property {string[]} [failed]       partial/failed: which reads did not answer
 * @property {{ what: string, state: ReadStateName }[]} [parts]  combined reads: each one's own state
 */

export const READ_STATES = Object.freeze(["loading", "empty", "unassessed", "forbidden", "disabled", "failed", "stale", "partial", "ok"]);

/** The one word a read's own error code can carry for "this role may not". */
const PRIVILEGE = "42501";

const lower = (s) => String(s ?? "").trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const codeOf = (error) => (typeof error === "string" ? error : null);

/**
 * Is this refusal "you may not" rather than "it did not work"?
 * @param {{ status?: number | null, error?: string | boolean | null }} r
 */
export function isForbidden(r) {
  const code = codeOf(r.error);
  if (code === "module_disabled") return false;
  if (r.status === 403) return true;
  return code === PRIVILEGE;
}

/** Is it a switched-off module? */
export function isModuleOff(r) {
  return !!r.disabled || codeOf(r.error) === "module_disabled";
}

/** An ISO instant as milliseconds, or null. @param {unknown} v */
function instant(v) {
  const t = typeof v === "string" || v instanceof Date ? Date.parse(String(v)) : typeof v === "number" ? v : NaN;
  return Number.isFinite(t) ? t : null;
}

/** "12 minutes ago", "3 hours ago", "2 days ago": whole units, rounded down, never a percentage. */
export function agoWords(ms) {
  const m = Math.floor(ms / 60e3);
  if (m < 1) return "under a minute ago";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} days ago`;
}

/** The sentence for one state. `what` is the reader's own noun phrase. */
export function sentenceFor(state, what, extra = {}) {
  const named = lower(what);
  const w = named || "this";
  switch (state) {
    case "loading":    return named ? `Reading ${w}…` : "Reading…";
    case "empty":      return named ? `No ${w} on record.` : "Nothing on record.";
    case "unassessed": return "Not assessed yet.";
    case "forbidden":  return `Your role may not read ${w}.`;
    case "disabled":   return named ? `Your school has switched off ${w}.` : "Your school has switched this off.";
    case "failed":     return extra.signedOut
      ? `Could not read ${w}: sign in again.`
      : `Could not read ${w}.`;
    case "stale":      return `${cap(w)} last observed ${agoWords(extra.ageMs ?? 0)}; it may be out of date.`;
    case "partial":    return `Could not read ${(extra.failed ?? [w]).join(" and ")}, so what is shown is incomplete.`;
    default:           return null;
  }
}

/**
 * The state of one read.
 *
 * @param {Read} read
 * @param {object} [o]
 * @param {string} [o.what]        "skills assessments": the reader's own words
 * @param {boolean} [o.subject]    the thing being assessed exists; an answered read with nothing for it is `unassessed`, not `empty`
 * @param {boolean} [o.mayRead]    false when the reader does not hold the capability behind the read: row-level security answers such a reader with nothing, which is not "none on record"
 * @param {string | number | Date | null} [o.observedAt]  overrides read.observedAt
 * @param {number} [o.maxAgeMs]    older than this is stale; without it nothing is
 * @param {number} [o.now]         the clock, passed in
 * @returns {Result}
 */
export function readState(read, o = {}) {
  const r = read ?? {};
  const rows = Array.isArray(r.rows) ? r.rows : [];
  const out = (state, extra) => ({ state, sentence: sentenceFor(state, o.what, extra), retry: false });

  // A switched-off module is a setting; it is the one thing said before the
  // rest because the read behind it was refused on purpose.
  if (isModuleOff(r)) return out("disabled");

  // First answer not back. A refresh that already has rows is not "loading":
  // the screen keeps what it has instead of flashing. A retry after a failure
  // arrives here too (loading with the old error still set, no rows): it is
  // loading, which is what the person who pressed retry should see.
  if (r.loading && rows.length === 0) return out("loading");

  if (r.error) {
    if (isForbidden(r)) return out("forbidden");
    const signedOut = r.status === 401;
    return { ...out("failed", { signedOut }), retry: !signedOut };
  }

  // An answer of nothing from a reader who does not hold the capability behind
  // the read is row-level security filtering, not an absence: "not assessed
  // yet" or "none on record" would be a claim about the record that this
  // reader cannot make. Said as what it is.
  if (rows.length === 0 && o.mayRead === false) return out("forbidden");
  if (rows.length === 0) return out(o.subject ? "unassessed" : "empty");

  const at = instant(o.observedAt ?? r.observedAt);
  if (at != null && Number.isFinite(o.maxAgeMs)) {
    const ageMs = (o.now ?? Date.now()) - at;
    if (ageMs > /** @type {number} */ (o.maxAgeMs)) return { ...out("stale", { ageMs }), retry: true };
  }
  return { state: "ok", sentence: null, retry: false };
}

/**
 * The state of a read for one subject, from the items the read holds for him.
 * `unassessed` when the read answered and there is nothing for him.
 *
 * @param {Read} read  @param {any[]} items  what the read holds for this subject
 * @param {Parameters<typeof readState>[1]} [o]
 */
export function readStateFor(read, items, o = {}) {
  return readState({ ...read, rows: items ?? [] }, { ...o, subject: true });
}

/**
 * Several reads behind one screen.
 *
 * `partial` is the one a single read cannot be: some answered and some did
 * not, so what is drawn is incomplete and must say so. A read the reader may
 * not see (`forbidden`) or one switched off is not a failure, so it does not
 * make a screen partial; it is listed in `parts` for a screen that wants it.
 *
 * @param {{ what: string, read: Read, opts?: Parameters<typeof readState>[1] }[]} reads
 * @param {{ now?: number }} [o]
 * @returns {Result}
 */
export function combineReads(reads, o = {}) {
  const parts = reads.map((p) => ({ what: p.what, res: readState(p.read, { ...p.opts, what: p.what, now: o.now }) }));
  const has = (s) => parts.filter((p) => p.res.state === s);
  const summary = parts.map((p) => ({ what: p.what, state: p.res.state }));
  const answered = parts.filter((p) => ["ok", "empty", "unassessed", "stale"].includes(p.res.state));
  const failed = has("failed");
  const failedWhat = failed.map((p) => p.what);
  const pack = (state, extra = {}, retry = false) => ({ state, sentence: sentenceFor(state, extra.what, extra), retry, parts: summary, ...(extra.failed ? { failed: extra.failed } : {}) });

  if (has("loading").length) return pack("loading", { what: has("loading")[0].what });
  if (failed.length && answered.length) return pack("partial", { failed: failedWhat }, true);
  if (failed.length) return pack("failed", { what: failedWhat.join(" and "), failed: failedWhat, signedOut: failed.every((p) => !p.res.retry) }, failed.some((p) => p.res.retry));
  if (has("forbidden").length && !answered.length) return pack("forbidden", { what: has("forbidden").map((p) => p.what).join(" and ") });
  if (has("disabled").length && !answered.length) return pack("disabled", { what: has("disabled").map((p) => p.what).join(" and ") });
  if (has("stale").length) return { ...has("stale")[0].res, parts: summary };
  if (answered.length && answered.every((p) => p.res.state === "empty")) return pack("empty", { what: parts[0].what });
  if (answered.length && answered.every((p) => p.res.state === "unassessed")) return pack("unassessed");
  return { state: "ok", sentence: null, retry: false, parts: summary };
}
