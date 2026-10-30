/**
 * SCRBRD — what may leave as a file (GET /api/export/:resource).
 *
 * A screen shows a reader what they may see while their grant stands. A file
 * keeps it after the grant ends: a coach moved off a side, a consent
 * withdrawn, an enquiry's week over, a link ended. Nothing in the audit trail
 * follows a file, so the rule is written here, beside the capabilities, and
 * not as a list in the API.
 *
 * TWO LISTS, HELD APART BY A TEST (packages/policy/test/exports.test.mjs and
 * services/api/read/read.test.mjs):
 *
 *   EXPORTABLE  the two reads the office needs as a file: the roster
 *               without its masked columns, and the fixtures. Nothing else
 *               leaves.
 *   notExported the reads that must never leave, DERIVED rather than listed:
 *                 - every read whose watched columns (the API's
 *                   RESTRICTED_FIELDS) are not all dropped from its file;
 *                 - every read of a table governed by a capability of level
 *                   2 (Restricted Personal) or more (capabilities.mjs LEVEL);
 *                 - the named reads below, which the first two cannot see
 *                   (their SQL calls a function, or their rows are a child's
 *                   home life, health or conduct under a lower capability).
 *
 * A read on neither list is refused too: the allowlist is the door. The
 * derived list exists so that a read on the allowlist which later gains a
 * restricted column, or starts reading a sensitive table, fails a test
 * instead of quietly leaving as a file.
 *
 * No health or conduct record ever leaves as a file (Kameel, 22 October
 * 2026): injuries and their reviews, discipline, emergency and trip
 * contacts, consents, scouting consent, a child's links, availability and
 * its reasons, workload and breaches. The roster and the fixtures are the
 * only files.
 */
import { LEVEL } from "./capabilities.mjs";
import { TABLES, maskedColumns, isCapabilityExpression } from "./tables.mjs";

/** The level from which a table's rows do not leave as a file. */
export const EXPORT_LEVEL_CEILING = 2;

/** The roster's columns that never reach a file: every column the player table masks. */
const PLAYER_MASKED = Object.freeze(
  [...new Set(Object.values(maskedColumns(TABLES.player)).flat())].sort());

/**
 * The reads that may leave as a file, the columns each one drops, and the
 * capabilities (any one of them, at the school) a caller must hold for the
 * file at all.
 * `drop` is applied to every caller alike: the office's roster file carries
 * no address or ID number even though the office may read them on screen.
 * `needsAny`: the roster file is the staff's who keep the roster (Kameel, 22
 * October 2026) — player.roster.read or player.profile.manage at the
 * school. A parent, a pupil, a scorer or a physio reads the squad on the
 * screen and gets no file; the rows of a school where the caller holds
 * neither are left out.
 * @type {Readonly<Record<string, Readonly<{ drop: readonly string[], needsAny?: readonly string[] }>>>}
 */
export const EXPORTABLE = Object.freeze({
  players:  Object.freeze({ drop: PLAYER_MASKED,
                            needsAny: Object.freeze(["player.roster.read", "player.profile.manage"]) }),
  matches:  Object.freeze({ drop: Object.freeze([]) }),
});

/**
 * Reads refused by name. The first twelve were refused before this file
 * existed (GA-I26a AH-D4: the development judgements; GA-I24-I25 D9: the
 * reads that name another school's boys). The rest are a child's home life,
 * body, family or figures, read under capabilities the level rule does not
 * reach or through functions it cannot see into.
 */
export const NAMED_NOT_EXPORTED = Object.freeze([
  // A coach's judgement of a child.
  "skills", "skills_history", "ratings", "notes", "coaching_points", "targets", "development_since",
  // Another school's boys, on a grant that closes.
  "opposition_squad", "opposition_context", "passport", "passport_consents", "scouting_candidates",
  // Who at a union read his passport (db/124): his family's to see, not a file.
  "passport_union_reads",
  // A record about a boy's body (PUBLIC_DATA §5a), and his load: read
  // through definers under player.workload.read (level 2), which the table
  // rule cannot see into.
  "bowling_breaches", "workload", "bowler_day", "load", "load_weeks",
  // Why a boy cannot play: a window into his home.
  "availability",
  // What a family agreed to, and may withdraw.
  "consents", "scouting_consent",
  // A child's guardians, and why a link ended.
  "child_links",
  // His figures across matches (GA-I24-I25 D9: compare exports nothing).
  "career", "career_by_season", "matchups", "matchup_coverage",
  // His conduct (db/116): a league's read of its competition's records, the
  // standing file the narrow door exists to prevent, and a coach's read of
  // his side's, read on a screen and not filed.
  "competition_discipline", "side_discipline",
]);

/**
 * The highest LEVEL among the capabilities a table's rows are read under.
 * A capability written as an SQL expression cannot be levelled here, so it
 * counts as the ceiling: unknown is refused, never allowed.
 * @param {string} table
 * @returns {number}  -1 for a name that is not a governed table
 */
export function readLevelOf(table) {
  const def = Object.hasOwn(TABLES, table) ? TABLES[table] : undefined;
  if (!def) return -1;
  const levelOf = (/** @type {string|undefined} */ cap) =>
    cap == null ? -1 : isCapabilityExpression(cap) ? EXPORT_LEVEL_CEILING : (LEVEL[cap] ?? EXPORT_LEVEL_CEILING);
  return Math.max(levelOf(def.read), levelOf(def.readAlso));
}

/**
 * The tables an SQL text reads, by the names after FROM and JOIN. A masking
 * view (`player_masked`) counts as its table. Crude on purpose: it only has to
 * find governed tables, and a name it cannot place is ignored.
 * @param {string} sql
 * @returns {string[]}
 */
export function tablesIn(sql) {
  const out = new Set();
  for (const m of String(sql ?? "").matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)) {
    const name = m[1].toLowerCase();
    const base = name.endsWith("_masked") ? name.slice(0, -"_masked".length) : name;
    if (Object.hasOwn(TABLES, base)) out.add(base);
  }
  return [...out].sort();
}

/**
 * The reads that never leave as a file, derived.
 * @param {{ restricted: Readonly<Record<string, readonly string[]>>,
 *           tablesRead: Readonly<Record<string, readonly string[]>> }} inputs
 *   restricted: resource → its watched columns (the API's RESTRICTED_FIELDS);
 *   tablesRead: resource → the governed tables its SQL reads (tablesIn())
 * @returns {ReadonlySet<string>}
 */
export function notExported({ restricted, tablesRead }) {
  const out = new Set(NAMED_NOT_EXPORTED);
  for (const [resource, cols] of Object.entries(restricted)) {
    const dropped = new Set(EXPORTABLE[resource]?.drop ?? []);
    if (cols.some((c) => !dropped.has(c))) out.add(resource);
  }
  for (const [resource, tables] of Object.entries(tablesRead)) {
    if (tables.some((t) => readLevelOf(t) >= EXPORT_LEVEL_CEILING)) out.add(resource);
  }
  return Object.freeze(out);
}

/**
 * May this read leave as a file? Only when it is on the allowlist and not on
 * the refused list. Everything else is refused.
 * @param {string} resource
 * @param {ReadonlySet<string>} refused  notExported()'s answer
 */
export const exportAllowed = (resource, refused) =>
  Object.hasOwn(EXPORTABLE, resource) && !refused.has(resource);

/** The columns a read's file leaves out (none for a read not on the allowlist). */
export const exportDrops = (/** @type {string} */ resource) =>
  Object.hasOwn(EXPORTABLE, resource) ? EXPORTABLE[resource].drop : [];

/** The capabilities, any one at the school, a caller needs for this file ([] for none). */
export const exportNeeds = (/** @type {string} */ resource) =>
  Object.hasOwn(EXPORTABLE, resource) ? (EXPORTABLE[resource].needsAny ?? []) : [];
