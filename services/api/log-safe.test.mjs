// No personal value in a server log (INCIDENTS_AND_BREACHES §9.1, D24).
//
// A. safeErr() over the errors that carry a person: Postgres's unique
//    violation on app_user.email (db/00) and official.id_number (db/08), whose
//    DETAIL is the duplicate value; a bad-input message that quotes what was
//    typed. Nothing email-shaped and no DETAIL comes out.
// B. Every console.log/error/warn/info under services/, outside the tests:
//    its arguments, read as code (string text dropped, `${…}` kept), name no
//    `.detail`, email, ID number, name, phone, request body or row, and a
//    caught error's message only through safeErr(). The catch-all in
//    server.mjs goes through safeErr().
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { safeErr, isPostgresError } from "./log-safe.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== undefined ? `— ${JSON.stringify(d)}` : ""); } };
/** @param {string} t */
const group = (t) => console.log("\n" + t);

const EMAIL = /[^\s@"'()]+@[^\s@"'()]+\.[a-z]{2,}/i;

/** @param {Record<string, unknown>} fields */
const pgError = (fields) => Object.assign(new Error(String(fields.message)), { severity: "ERROR", ...fields });

group("A. safeErr() keeps the code and the constraint, never the value");
{
  const dupEmail = pgError({
    code: "23505", constraint: "app_user_email_key", table: "app_user", schema: "public",
    message: 'duplicate key value violates unique constraint "app_user_email_key"',
    detail: "Key (email)=(thandi.parent@example.co.za) already exists.",
  });
  const line = safeErr(dupEmail);
  ok("a duplicate email: the SQLSTATE is logged", line.includes("23505"), line);
  ok("a duplicate email: the constraint and table are logged",
     line.includes("constraint=app_user_email_key") && line.includes("table=app_user"), line);
  ok("a duplicate email: nothing email-shaped", !EMAIL.test(line), line);
  ok("a duplicate email: no DETAIL", !line.includes("Key (") && !line.includes("already exists"), line);

  const dupId = pgError({
    code: "23505", constraint: "official_id_number_key", table: "official",
    message: 'duplicate key value violates unique constraint "official_id_number_key"',
    detail: "Key (id_number)=(0801015800084) already exists.",
  });
  const idLine = safeErr(dupId);
  ok("a duplicate ID number: no digits of it", !idLine.includes("0801015800084") && !idLine.includes("Key ("), idLine);

  const typed = pgError({ code: "22P02", message: 'invalid input syntax for type uuid: "sipho@example.org"' });
  const typedLine = safeErr(typed);
  ok("a message quoting what was typed is dropped", typedLine === "22P02", typedLine);

  const raised = pgError({ code: "23514", message: "pupil_consent_required", table: "workload_entry" });
  ok("a code-shaped RAISE message is kept", safeErr(raised) === "23514 table=workload_entry pupil_consent_required", safeErr(raised));

  const sentence = pgError({ code: "P0001", message: "ball_event: a stumping credited to someone who was not keeping wicket (match 7, key x)" });
  ok("a RAISE sentence with values is dropped", safeErr(sentence) === "P0001", safeErr(sentence));

  const ours = Object.assign(new Error("store_put_failed"), { status: 503, detail: "500 bucket said jo@example.com" });
  ok("our own Error: the message stays, the detail goes", safeErr(ours) === "store_put_failed", safeErr(ours));

  ok("a constraint that is not an identifier is not echoed",
     !safeErr(pgError({ code: "23505", constraint: "x) jo@example.com", message: "m" })).includes("@"));
  ok("node's EPIPE is not taken for Postgres", !isPostgresError({ code: "EPIPE" }));
  ok("no error at all still says something", safeErr(undefined) === "(no error)");
}

group("B. Every log call under services/ names no personal value");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICES = join(ROOT, "services");

/** @param {string} dir @returns {string[]} */
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = join(dir, e.name);
  if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(full);
  return /\.m?js$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
});

/**
 * The code of a call's arguments, from just after its "(" to the ")" that
 * closes it: string and template text dropped, `${…}` kept, comments dropped.
 * @param {string} src @param {number} i @param {string} closer
 * @returns {[string, number]}
 */
function scanCode(src, i, closer) {
  let out = "", depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 2; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++; out += '""'; continue;
    }
    if (c === "`") {
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") { const [inner, j] = scanCode(src, i + 2, "}"); out += ` ${inner} `; i = j; continue; }
        i++;
      }
      i++; out += '""'; continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0 && c === closer) return [out, i + 1];
      depth--;
    }
    out += c; i++;
  }
  return [out, i];
}

const FORBIDDEN = [
  [/\.detail\b/, "a DETAIL"],
  [/\bemail\b/i, "an email"],
  [/\bid_?number\b/i, "an ID number"],
  [/\b(?:full_?name|first_?name|last_?name|surname|display_?name)\b/i, "a name"],
  [/\b(?:phone|cell(?:phone)?|mobile)\b/i, "a phone number"],
  [/\bbody\b/, "a request body"],
  [/\brows?\b/, "a row's values"],
  // A caught error goes through safeErr(): its own message may be Postgres's,
  // and Postgres's can quote what was typed.
  [/\b(?:e|err|error)\??\.message\b/, "an error's raw message (use safeErr)"],
];
const CALL = /\bconsole\.(?:log|error|warn|info|debug)\s*\(/g;

/** @type {string[]} */
const offences = [];
let calls = 0;
/** @type {string | null} */
let catchAll = null;
for (const file of walk(SERVICES)) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(CALL)) {
    const start = (m.index ?? 0) + m[0].length;
    const [args] = scanCode(src, start, ")");
    calls++;
    const at = `${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length}`;
    for (const [re, what] of /** @type {[RegExp, string][]} */ (FORBIDDEN)) {
      if (re.test(args)) offences.push(`${at} logs ${what}: ${args.trim().slice(0, 120)}`);
    }
    if (file.endsWith(join("api", "server.mjs")) && src.slice(Math.max(0, (m.index ?? 0) - 120), m.index).includes("if (!err.status)")) catchAll = args;
  }
}
ok(`the walk found the log calls (${calls})`, calls > 20, calls);
ok("no log call names a personal value", offences.length === 0, offences);
ok("server.mjs's catch-all is found", catchAll !== null);
ok("server.mjs's catch-all logs safeErr(err), and no err.message or err.detail of its own",
   catchAll !== null && catchAll.includes("safeErr(err)") && !/\berr\.(?:detail|message)\b/.test(catchAll), catchAll);

console.log(`\n${"─".repeat(52)}\nLOG HYGIENE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
