/**
 * The union selector's screen, in words and query strings
 * (docs/design/UNION_SELECTOR_FIND.md D2, D3, D6, D7, §4; slice S3).
 *
 * Pure, so the rules the screen draws are tested without a browser:
 *   - never "everyone": a school or an age group before any list is asked for;
 *   - a row is a name, a school and a side, and nothing else;
 *   - an open that fails says "No longer open to {institution}" and no reason.
 * Nothing here stores anything: the screen holds a row only while it is shown.
 */

/** Age-group sides a union picks (§1: U13 to U19). The list reads the side's code, never a date of birth. */
export const AGE_GROUPS = Object.freeze(["U13", "U14", "U15", "U16", "U17", "U18", "U19"]);

/** May a list be asked for: an institution, and a school or an age group (D2). A name alone is no filter. */
export const canList = ({ org, school, ageGroup }) => !!org && (!!school || AGE_GROUPS.includes(ageGroup));

/** The list's query string, or null when it may not be asked for. */
export function listQuery({ org, school, ageGroup, q }) {
  if (!canList({ org, school, ageGroup })) return null;
  const p = new URLSearchParams({ org });
  if (school) p.set("school", school);
  if (AGE_GROUPS.includes(ageGroup)) p.set("ageGroup", ageGroup);
  const name = String(q ?? "").trim();
  if (name) p.set("q", name);
  return p.toString();
}

/**
 * The three things a row carries (D3), from the server's row. Its id and the
 * institution that admits him ride along for the open and are not drawn.
 * Anything else the server might ever add is dropped here, not drawn.
 */
export const asRow = (r) => ({
  id: r.player_id, name: r.name, school: r.school_name, side: r.team_code, org: r.org_id,
});

/** The institution's name for the words, or a plain stand-in. */
const named = (institution) => institution || "your union";

/** The empty result (S3): no reason, no count, no hint of the other institution (§4.2, §4.8). */
export const emptyWords = (institution) => `No boy's family has named ${named(institution)} in that school or age group.`;

/** A failed open (§4.2): this and nothing more. */
export const closedWords = (institution) => `No longer open to ${named(institution)}`;

/** The institution chip is drawn only when the caller reads at two (D2). */
export const showsChip = (orgs) => (orgs?.length ?? 0) > 1;
