/**
 * Settings → Import: what the screen knows about the bulk import, as pure functions.
 *
 * The importer itself is the server's (services/api/io/import-api.mjs): every
 * row is a write under the caller's own policy, a dry run is the default and a
 * file with any error is never committed. This file decides nothing about
 * authority. It holds the list of kinds the screen offers, the one rule the
 * screen adds on top of the server's (Import is offered only after a clean
 * Check of the SAME file), and the words.
 *
 * THE KINDS. The registry is the server's IMPORTS, and no read lists it, so the
 * client keeps this short list beside it. apps/web/test/import-screen.test.mjs
 * reads the two together and fails on a kind the server has and this list
 * lacks, so a new kind cannot ship without its entry: one row here, and the
 * screen offers it with no other change. `cap` is the capability the kind's
 * rows are written under (rbac/index.js: players create under
 * player.profile.manage), used only to decide whether to OFFER the screen.
 * The server's row-level policy decides again on every row.
 */

/** @typedef {{ id: string, label: string, cap: string }} ImportKind */

/** @type {ImportKind[]} */
export const IMPORT_KINDS = [
  { id: "players", label: "Players", cap: "player.profile.manage" },
  // Each row is enrol_person(..., 'guardian', ...): the capability People's Add uses.
  { id: "guardians", label: "Guardians", cap: "user.role.assign" },
];

/**
 * The kinds this person may offer, by capability.
 * @param {(capability: string) => boolean} holds
 * @returns {ImportKind[]}
 */
export const kindsHeld = (holds) => IMPORT_KINDS.filter((k) => holds(k.cap));

/**
 * The file and choices a Check was run on, and the report it got.
 * @typedef {{ kind: string, schoolId: string, text: string, report: any }} Checked
 */

/**
 * Is Import offered? Only when the last Check was of this very kind, school and
 * file, and it was clean, and it read at least one row. Choosing another file,
 * another kind or another school, or editing nothing at all but picking the
 * same name again, goes through here and comes back false until Check is run.
 * @param {Checked | null} checked
 * @param {{ kind: string, schoolId: string, text: string | null }} now
 */
export function mayImport(checked, now) {
  if (!checked || now.text == null) return false;
  return checked.kind === now.kind && checked.schoolId === now.schoolId && checked.text === now.text
    && checked.report?.clean === true && checked.report?.committed === false && checked.report?.rows > 0;
}

/** "line 7, born: must be a date like 2011-04-07 ..." The route's words, with where they are. */
export function errorWords(e) {
  const where = e?.line != null ? `Line ${e.line}` : "File";
  return `${where}${e?.column ? `, ${e.column}` : ""}: ${e?.message ?? "refused"}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The line a Check ends in: how many rows are clean, or how many lines are not.
 * A dry run of a file the server read as zero rows is not "clean": there is
 * nothing to import.
 * @param {any} report a dry-run report
 */
export function checkSummary(report) {
  const errs = report?.errors?.length ?? 0;
  if (errs) return `${plural(errs, "problem")} to fix. Nothing was written.`;
  const rows = report?.rows ?? 0;
  if (!rows) return "The file has no rows to import.";
  const parts = [];
  if (report.wouldInsert) parts.push(`${report.wouldInsert} new`);
  if (report.wouldUpdate) parts.push(`${report.wouldUpdate} already there, to be updated`);
  if (report.unchanged) parts.push(`${report.unchanged} already in place, left as they are`);
  return `${plural(rows, "row")} clean${parts.length ? ` (${parts.join(", ")})` : ""}. Nothing is written until you press Import.`;
}

/**
 * The line an Import ends in, from the committed report.
 * @param {any} report
 */
export function importSummary(report) {
  const parts = [];
  if (report.inserted) parts.push(`${report.inserted} added`);
  if (report.updated) parts.push(`${report.updated} updated`);
  if (report.unchanged) parts.push(`${report.unchanged} already in place`);
  return `Imported ${plural(report.rows, "row")}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

/** The server's refusal codes (import-api.mjs and the door in front of it), in the office's words. */
const REFUSAL = {
  not_permitted: "You may not import into this school.",
  school_required: "Choose the school first.",
  csv_required: "The file is empty.",
  unknown_import: "That kind of file is not one the server imports.",
  payload_too_large: "The file is too large to send in one go (the limit is about 250 KB). Split it and import the parts.",
  invalid_json: "The file could not be sent. Choose it again.",
};
/** @param {{ code?: string, status?: number } | null | undefined} e an ApiError, or whatever was thrown */
export const refusalWords = (e) =>
  (e?.code && Object.hasOwn(REFUSAL, e.code) ? REFUSAL[/** @type {keyof typeof REFUSAL} */ (e.code)] : null)
  ?? (e?.status ? `The server refused it (${e.code || e.status}). Nothing was written.` : "The server did not answer. Nothing was written; try again.");

/** The biggest file worth sending: the server's body cap is 256 KB, and the file travels inside JSON. */
export const MAX_FILE_BYTES = 240 * 1024;
