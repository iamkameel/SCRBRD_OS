/**
 * SCRBRD — the school's staff register, as the screens say it
 * (SCRBRD-140 phase 2; docs/design/SCRBRD-140_phase2_register.md §5).
 *
 * The office lists its staff in advance (Settings → Import → Staff register);
 * a staff member who signs in with Google and chooses the school is granted
 * what was listed for the address Google verified. The server decides all of
 * it (services/api/write/register-api.mjs, db/92, db/93). This file is the
 * pure half of the screens: the template, how a Check's answer is read and when
 * Import is offered, what each state of a row is called, and the words for the
 * people who meet the register from the other side (the staff member signing
 * in, a DSO lifting a pause).
 *
 * WHAT THIS FILE DECIDES: nothing about authority. Whether Import is offered
 * is the screen's courtesy; register_upload() checks every row again.
 *
 * THE RULES THE WORDS KEEP (the design's §2.2, §4.2):
 *   - A signing-in staff member who is granted nothing reads no sentence from
 *     the claim at all, so a refused person learns nothing about whether she
 *     was listed.
 *   - A cooldown is said as the person's own state: it never says why, never
 *     names anyone, and never says a parent's claim was involved.
 *   - The register holds adults who work at the school. No pupil's name is
 *     written anywhere in this file, not even as an example.
 */
import { TEAM_SCOPED_ROLES, roleGrants } from "@scrbrd/policy/roles";
import { ALL_CAPABILITIES } from "@scrbrd/policy/capabilities";
import { ROLES } from "../design/roles.js";
import { MAX_FILE_BYTES } from "./importScreen.js";

export { MAX_FILE_BYTES };

/** The columns of docs/pilot/templates/staff.csv, in its order (register-api.mjs REGISTER_COLUMNS). */
export const REGISTER_COLUMNS = Object.freeze(["name", "email", "role", "team_code", "valid_until"]);
/** The most rows one Check or Import may carry (register_upload, "too_many_rows"). */
export const MAX_ROWS = 200;

/**
 * The template the office downloads. Two made-up adults on a reserved
 * `.invalid` domain, so a row left in by mistake can never be a real person.
 */
export const STAFF_TEMPLATE_CSV = [
  REGISTER_COLUMNS.join(","),
  "Example Coach,example.coach@school.invalid,coach,U14A,",
  "Example Scorer,example.scorer@school.invalid,scorer,,",
  "",
].join("\n");

/** The rule above the table, word for word (design §5). */
export const ADULTS_ONLY = "Adults who work at the school. Never a pupil, never a parent.";

// ── Who is offered the screen, and what the form's role list holds ───────────

/** Roles a register row can never be, whatever the office may grant (db/92 no_child_role and the ceiling). */
const NEVER_LISTED = new Set(["guardian", "selfaccess", "enquiry", "player", "dso", "superadmin", "platformadmin"]);

/**
 * Over the register's ceiling: a role whose bundle reaches a child's clinical
 * notes, a disciplinary record or a safeguarding concern is added from People,
 * with the person in front of the office (P2-D3). Read from the policy, as the
 * database reads role_capability, so there is no second list to drift.
 * @param {string} role
 */
export const overCeiling = (role) =>
  roleGrants(role, "medical.details.read") || roleGrants(role, "discipline.read")
  || ALL_CAPABILITIES.some((c) => c.startsWith("safeguarding.") && roleGrants(role, c));

/**
 * The roles the one-row form offers: what this person may grant, less what a
 * register never lists. Courtesy only; the server refuses the rest in words.
 * @param {string[]} grantable
 */
export const listableRoles = (grantable) => grantable.filter((r) => !NEVER_LISTED.has(r) && !overCeiling(r));

/** Does this role need a side (a coach "needs a side")? @param {string} role */
export const needsSide = (role) => TEAM_SCOPED_ROLES.includes(role);

// ── The words for a role ─────────────────────────────────────────────────────
/** @param {string} role @param {string | null | undefined} team */
export const roleLine = (role, team) => `${ROLES[role]?.label ?? role}${team ? ` (${team})` : ""}`;

const ZA = "Africa/Johannesburg";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/**
 * "31 Mar" for a date or a timestamp (a timestamp as the school's day, South
 * Africa's); "" when there is none. Written out rather than left to the
 * browser's locale, which says "03 Sept" for en-ZA.
 * @param {string | null | undefined} v
 */
export function dayWords(v) {
  if (!v) return "";
  const s = String(v);
  let ymd = s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    ymd = d.toLocaleDateString("en-CA", { timeZone: ZA });
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return s;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

// ── Reading the file the office chose, to label the Check's lines ───────────
/**
 * A small CSV reader, used only to put a name beside the line a Check talks
 * about. The server parses the file for real (and is the one that counts):
 * this mirrors its line numbers (the header is line 1; wholly blank lines are
 * dropped before counting) and nothing else. apps/web/test/staff-register.test.mjs runs it
 * beside the server's parseCsv over awkward files.
 * @param {string} text
 * @returns {{ line: number, name: string, email: string }[]}
 */
export function previewRows(text) {
  const s = typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : String(text ?? "");
  /** @type {string[][]} */
  const records = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = ""; records.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); records.push(row); }
  const [header = [], ...rest] = records;
  const cols = header.map((h) => String(h).trim().toLowerCase());
  const at = (/** @type {string} */ c) => cols.indexOf(c);
  // The server drops wholly blank lines BEFORE it counts, so a line number it
  // gives is the row's place among the rows, not its place in the spreadsheet
  // once a blank line sits above it. Named the same way here so a Check's
  // "Row 5" and the name beside it are the same row.
  return rest
    .filter((cells) => cells.some((c) => String(c).trim() !== ""))
    .map((cells, n) => ({ cells, line: n + 2 }))
    .map(({ cells, line }) => ({
      line,
      name: at("name") >= 0 ? String(cells[at("name")] ?? "").trim() : "",
      email: at("email") >= 0 ? String(cells[at("email")] ?? "").trim() : "",
    }));
}

// ── The one-row form ─────────────────────────────────────────────────────────
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The form's fields into the one row POST /api/register/:school takes, or the
 * first thing to fix. The server checks again, in the same words as for a file.
 * @param {{ name?: string, email?: string, role?: string, team?: string, until?: string }} f
 * @returns {{ ok: true, row: Record<string, string | number> } | { ok: false, problem: string }}
 */
export function rowFromForm(f) {
  const name = String(f.name ?? "").replace(/\s+/g, " ").trim();
  const email = String(f.email ?? "").trim();
  if (name.length < 2) return { ok: false, problem: "Type the person's name." };
  if (!EMAIL.test(email)) return { ok: false, problem: "Type the Google address they will sign in with." };
  if (!f.role) return { ok: false, problem: "Choose what they do at the school." };
  if (needsSide(f.role) && !f.team) return { ok: false, problem: `A ${(ROLES[f.role]?.label ?? f.role).toLowerCase()} needs a side.` };
  const until = String(f.until ?? "").trim();
  if (until && !DATE.test(until)) return { ok: false, problem: "Give the claim-by date as a date like 2026-12-31, or leave it empty." };
  /** @type {Record<string, string | number>} */
  const row = { line: 1, name, email, role: f.role };
  if (needsSide(f.role) && f.team) row.team_code = f.team;
  if (until) row.valid_until = until;
  return { ok: true, row };
}

// ── Check, then Import ───────────────────────────────────────────────────────
/**
 * What a Check was run on and what it answered. `source` is the file's text or
 * the form's rows; `school` is where.
 * @typedef {{ school: string, key: string, report: { ok: boolean, committed: boolean, rows: any[] } }} RegisterChecked
 */

/** The identity of what a Check read, so a Check counts only for the same file and school. @param {string} text */
export const sourceKey = (text) => `csv:${text}`;
/** @param {Record<string, unknown>[]} rows */
export const rowsKey = (rows) => `rows:${JSON.stringify(rows)}`;

/** The rows of a report that carry a warning to tick. @param {any} report */
export const warnedRows = (report) => (report?.rows ?? []).filter((/** @type {any} */ r) => r.warning && r.ack);

/** @param {any} report */
export const problemRows = (report) => (report?.rows ?? []).filter((/** @type {any} */ r) => !r.ok);

/**
 * Is Import offered? Only after a Check of this very file and school with no
 * problem and at least one row, and with every warning ticked.
 * @param {RegisterChecked | null} checked
 * @param {{ school: string, key: string | null }} now
 * @param {string[]} acknowledged  the `ack` of each ticked warning
 */
export function mayCommit(checked, now, acknowledged) {
  if (!checked || now.key == null) return false;
  if (checked.school !== now.school || checked.key !== now.key) return false;
  const rows = checked.report?.rows ?? [];
  if (rows.length === 0 || checked.report?.committed === true || problemRows(checked.report).length > 0) return false;
  return warnedRows(checked.report).every((/** @type {any} */ r) => acknowledged.includes(r.ack));
}

const plural = (/** @type {number} */ n, /** @type {string} */ one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The line a Check ends in.
 * @param {any} report
 * @param {number} [ticked]  how many of the warnings are ticked
 */
export function checkWords(report, ticked = 0) {
  const rows = report?.rows ?? [];
  const bad = problemRows(report).length;
  if (rows.length === 0) return "The file has no rows to check.";
  if (bad) return `${plural(bad, "row")} to fix. Nothing was listed.`;
  const warned = warnedRows(report).length;
  if (warned > ticked) return `${plural(rows.length, "row")} read. Tick ${warned === 1 ? "the warning" : "each warning"} to list ${warned === 1 ? "that person" : "those people"} anyway. Nothing is listed until you press Import.`;
  return `${plural(rows.length, "row")} clean. Nothing is listed until you press Import.`;
}

/** After an Import. @param {any} report */
export function importedWords(report) {
  const n = (report?.rows ?? []).length;
  return `${plural(n, "person", "people")} listed. They join by signing in with Google and choosing the school; the office is told when they do.`;
}

/**
 * A refusal from the register's routes, in words. The route's own `detail` is
 * already a sentence, and is used as it comes; the rest is said here.
 * @param {any} e
 */
export function registerErrorWords(e) {
  if (e?.status === undefined || e?.status === null) return "Could not reach SCRBRD. Check your connection and try again; nothing was changed.";
  if (e?.detail) return String(e.detail);
  const byCode = /** @type {Record<string, string>} */ ({
    csv_columns: "The file is missing a column. Download the template and use its first line.",
    rows_required: "Choose a file, or fill in the form, first.",
    state_invalid: "That list is not one the register has.",
    school_required: "Choose the school first.",
    not_permitted: "Only somebody who may appoint staff at this school can use its register.",
    missing_token: "You were signed out. Sign in again.",
    token_expired: "You were signed out. Sign in again.",
    payload_too_large: "That file is too large. A register file holds at most 200 people.",
  });
  return byCode[e?.code] ?? "That did not work. Try again, or ask the school's office.";
}

// ── The list ─────────────────────────────────────────────────────────────────
export const STATES = Object.freeze([
  { id: "open", label: "Open" },
  { id: "claimed", label: "Claimed" },
  { id: "expired", label: "Expired" },
  { id: "withdrawn", label: "Withdrawn" },
]);

/**
 * A row's state in words (design §5): "Open until 31 Mar", "Joined 14 Oct",
 * "Requested instead — the uploader may no longer grant Coach here", "Expired",
 * "Withdrawn 2 Nov by …".
 * @param {any} r  a row of GET /api/register/:school
 */
export function stateWords(r) {
  if (r.state === "open") return `Open until ${dayWords(r.valid_until)}`;
  if (r.state === "claimed") {
    if (r.outcome === "granted") return `Joined ${dayWords(r.claimed_at)}`;
    if (r.outcome_reason === "uploader_authority_lapsed") {
      return `Requested instead — the uploader may no longer grant ${ROLES[r.role]?.label ?? r.role} here`;
    }
    return `Requested instead — ${r.claimed_by_name ?? "the person"} asked, and the office decides`;
  }
  if (r.state === "expired") return `Expired ${dayWords(r.valid_until)}`;
  if (r.state === "withdrawn") return `Withdrawn ${dayWords(r.withdrawn_at)}${r.withdrawn_by_name ? ` by ${r.withdrawn_by_name}` : ""}`;
  return String(r.state ?? "");
}

/** "Listed by Registrar on 3 Oct", or just the date when the name is not there. @param {any} r */
export const listedWords = (r) => `Listed ${r.uploaded_by_name ? `by ${r.uploaded_by_name} ` : ""}on ${dayWords(r.uploaded_at)}`;

/** True when a row's name and email have been cleared (retention, design §1.8). @param {any} r */
export const isCleared = (r) => !!r?.redacted_at;

/** The sentence a withdraw asks first, in words. @param {any} r */
export const withdrawAsk = (r) =>
  `Take ${isCleared(r) ? "this row" : r.name} off the register? They will no longer be able to join with this row. Nobody is told.`;

/** "Clear 4 expired rows". @param {number} n */
export const clearLabel = (n) => `Clear ${plural(n, "expired row")}`;

/** What clearing does, said before it is done. @param {number} n */
export const clearAsk = (n) =>
  `Clear the name and email on ${plural(n, "row")} nobody claimed? This is ninety days after they expired or were withdrawn. The role, side and dates stay, so the record of what was listed stays. It cannot be undone.`;

/** @param {number} n */
export const clearedWords = (n) => (n === 0 ? "There was nothing to clear." : `Cleared ${plural(n, "row")}.`);

/** Words for a withdraw that did not happen: the route's, else ours. @param {any} e */
export const withdrawErrorWords = (e) => registerErrorWords(e);

// The staff member signing in is lib/registerClaim.js's: the join screen is in
// the entry bundle, and this file is not.

// ── The DSO lifting a pause ──────────────────────────────────────────────────
/** The notice a DSO is sent when an account is paused from asking (db/93): the title is the key, with its subject. */
export const PAUSE_TITLE = "An account has been paused from asking";

/**
 * Is this notice one a DSO can lift a pause from? It names the pause by id
 * (subject_kind 'system', subject_id), never the person.
 * @param {{ type?: string, title?: string, subjectKind?: string | null, subjectId?: string | null }} n
 */
export const liftable = (n) =>
  n?.type === "safeguarding" && n?.title === PAUSE_TITLE && n?.subjectKind === "system" && !!n?.subjectId;

export const LIFT_NOTE_MAX = 500;

/** @param {any} e */
export function liftErrorWords(e) {
  if (e?.status === undefined || e?.status === null) return "Could not reach SCRBRD. Check your connection and try again; the pause may or may not have been lifted.";
  if (e?.detail) return String(e.detail);
  if (e?.code === "missing_token" || e?.code === "token_expired") return "You were signed out. Sign in again.";
  return "The pause was not lifted. Try again.";
}

/** After a lift. */
export const LIFTED_WORDS = "The pause is lifted. The account can send a request again.";

// ── People: where an appointment came from ───────────────────────────────────
/**
 * The origin line beside an appointment that came from the register, read from
 * the request's note ("from the staff register, row <id>, uploaded 2026-10-03",
 * db/92). Anything else is no register's business: null.
 *
 * The note carries the day it was listed but not who listed it; the register
 * list says who. The line says what it knows.
 * @param {string | null | undefined} note
 */
export function registerOrigin(note) {
  const m = /from the staff register, row [0-9a-f-]{36}, uploaded (\d{4}-\d{2}-\d{2})/i.exec(String(note ?? ""));
  return m ? `From the staff register, listed ${dayWords(m[1])}` : null;
}
