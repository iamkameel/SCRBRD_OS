/**
 * A day in words, and a parent's own guardian links that are not live, in
 * words (GA-I20 A2, D9, §4.3). A leaf module with no imports: lib/family.js
 * re-exports both, and the no-school home reads them without drawing the
 * match centre and the scoring package into its first load.
 */
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2029-03-14" → "14 Mar 2029". */
export function longDate(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Her own links that are not live, in §4.3's words (GA-I20 A2, D9, §3.3,
 * §3.4), from the `my_links` read: a link the office established and has not
 * verified, one it did not verify, and one that ended. A live link is
 * my_children's to draw, and a link another of hers has replaced is not said.
 * No child is named: the read carries none on these rows, and the school is
 * named from the public list. No reason, ever: the platform holds none.
 *
 * @param {any[] | null | undefined} links  the my_links read
 * @param {number} now
 * @returns {{id: string, kind: "pending" | "rejected" | "ended", words: string}[]}
 */
export function linkWords(links, now) {
  const at = (/** @type {string} */ school) => `a child at ${school || "the school"}`;
  /** @type {{id: string, kind: "pending" | "rejected" | "ended", words: string}[]} */
  const out = [];
  for (const l of Array.isArray(links) ? links : []) {
    if (!l?.current) continue;
    if (l.status === "pending") {
      const asked = Date.parse(`${l.askedOn ?? ""}T00:00:00+02:00`);
      const days = !Number.isFinite(asked) ? null : Math.max(0, Math.floor((now - asked) / 864e5));
      const ago = days == null ? "" : days === 0 ? " · asked today" : ` · asked ${days} day${days === 1 ? "" : "s"} ago`;
      out.push({ id: l.id, kind: "pending",
        words: `Your request to be linked to ${at(l.schoolName)} is with the office${ago}. `
          + "This does not mean it was approved. When the office verifies the link, your child appears here." });
    } else if (l.status === "rejected") {
      const on = longDate(l.askedOn);
      out.push({ id: l.id, kind: "rejected",
        words: `The school office did not verify your request${on ? ` of ${on}` : ""}. Ask them.` });
    } else if (l.status === "ended") {
      const on = longDate(l.endedOn);
      out.push({ id: l.id, kind: "ended",
        words: `Your link to ${at(l.schoolName)} ended${on ? ` on ${on}` : ""}. The school office can say why; the platform does not.` });
    }
  }
  return out;
}
