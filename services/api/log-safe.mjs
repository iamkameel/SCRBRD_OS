/**
 * What an error may say in a server log (INCIDENTS_AND_BREACHES §9.1, D24).
 *
 * A server log line may carry a code, a route, an id, a time and a count.
 * Never a value a person typed or a value that is a person: an email, an ID
 * number, a name, a request body, or Postgres's DETAIL string, which on a
 * unique violation is the duplicate value itself ("Key (email)=(…) already
 * exists", app_user.email; official.id_number the same).
 *
 * So an error is logged as its SQLSTATE or code, and the constraint, table and
 * column it names, which are identifiers and never values. Postgres's message
 * is logged only when it is code-shaped (`pupil_consent_required`, the
 * snake_case words this schema's RAISEs use): a message like `invalid input
 * syntax for type uuid: "…"` or a RAISE with `%` can embed what was typed. A
 * message from our own JavaScript is logged as it stands; ours are codes and
 * sentences, and `detail` is never read.
 */

const SQLSTATE = /^[0-9A-Z]{5}$/;
const CODE_SHAPED = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_$.]{0,62}$/;

/** @param {any} e @returns {boolean} the error came from Postgres */
export function isPostgresError(e) {
  if (typeof e?.severity === "string") return true;  // pg's DatabaseError
  return typeof e?.code === "string" && SQLSTATE.test(e.code) && /\d/.test(e.code);
}

/**
 * The error, in words a log may keep: `code constraint=… table=… column=… message`.
 * @param {any} e
 * @returns {string}
 */
export function safeErr(e) {
  if (e == null) return "(no error)";
  /** @type {string[]} */
  const parts = [];
  if (typeof e.code === "string" || typeof e.code === "number") parts.push(String(e.code));
  for (const k of /** @type {const} */ (["constraint", "table", "column"])) {
    const v = e[k];
    if (typeof v === "string" && IDENT.test(v)) parts.push(`${k}=${v}`);
  }
  const msg = typeof e.message === "string" ? e.message : "";
  if (msg && msg !== e.code && (!isPostgresError(e) || CODE_SHAPED.test(msg))) parts.push(msg);
  return parts.join(" ") || (e.name ? String(e.name) : "error");
}
