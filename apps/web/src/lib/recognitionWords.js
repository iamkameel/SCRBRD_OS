/**
 * The words a boy's recognition is said in (RECOGNITION_design.md §7), one
 * place for the Honours tab, the family's card and the staff profile.
 *
 * R4 (db/140): recognition() says of each milestone where it came from —
 * `sealedOn` (the day the scorer's seal stands for it, null until then, D6)
 * and `source` ('ball log', 'scorebook', 'team sheet') — and returns a
 * withdrawn honour, with `withdrawnOn` and never its reason, to the pupil,
 * his guardian and the school's deciders only (D3). Every reader that gets a
 * withdrawn row may be shown it; nobody else gets one.
 *
 * The family's milestone line is the server's notice in the same words
 * (milestone_family_tell(), db/140): "Rohan's first fifty · 63 v DHS ·
 * sealed by the scorer, 12 Sep". Before the seal it says "not yet sealed by
 * the scorer" and the star beside it is dashed — a word with the mark, never
 * the mark alone.
 */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (iso) => {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "2026-09-12" → "12 Sep". */
export const dayMonth = (iso) => {
  const d = parse(iso);
  return d ? `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` : "";
};

/** "2026-10-03" → "3 Oct 2026". */
export const dayMonthYear = (iso) => {
  const d = parse(iso);
  return d ? `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` : "";
};

/** The words before the seal (D6). */
export const NOT_SEALED = "not yet sealed by the scorer";
/** A mark read off a scorebook card (db/63), not the ball log. */
export const FROM_BOOK = "from the scorebook";

/**
 * What his family calls him, as the server's notice does: known as; else his
 * first name; else, when the register holds only an initial, his name.
 * @param {{ knownAs?: string|null, name?: string|null }} child
 */
export function familyName(child) {
  const known = (child?.knownAs ?? "").trim();
  if (known) return known;
  const full = (child?.name ?? "").trim();
  const first = full.split(/\s+/)[0] ?? "";
  return first.replace(/\./g, "").length > 1 ? first : full;
}

/** The mark, as a parent says it: "fifty", "five-for", "500 career runs". */
export function whatOf(kind, value) {
  switch (kind) {
    case "fifty": return "fifty";
    case "hundred": return "hundred";
    case "five_for": return "five-for";
    case "hat_trick": return "hat-trick";
    case "career_runs": return `${value} career runs`;
    case "career_wickets": return `${value} career wickets`;
    case "caps": return `${value} caps`;
    default: return String(kind ?? "").replace(/_/g, " ");
  }
}

/** "63 v DHS", "6 wickets v DHS", "v DHS", or "". */
export function figureOf(r) {
  const fig = r.kind === "fifty" || r.kind === "hundred" ? `${r.value}`
    : r.kind === "five_for" ? `${r.value} wickets` : null;
  const opp = r.opponent && String(r.opponent).trim() ? `v ${String(r.opponent).trim()}` : null;
  return [fig, opp].filter(Boolean).join(" ");
}

const INNINGS_MARKS = new Set(["fifty", "hundred", "five_for", "hat_trick"]);

/**
 * Whether this mark is his first of its kind among the rows read (the
 * server orders them newest first, so the last of a kind is the first he
 * made). Career marks and caps are never "first".
 * @param {Array<{family: string, kind: string}>} rows
 * @param {{family: string, kind: string}} r
 */
export function isFirst(rows, r) {
  if (!INNINGS_MARKS.has(r.kind)) return false;
  const same = rows.filter((x) => x.family === "milestone" && x.kind === r.kind);
  return same.length > 0 && same[same.length - 1] === r;
}

/** Whether the scorer's seal stands for a milestone row. */
export const isSealed = (r) => Boolean(r?.sealedOn);

/**
 * The family's line for one milestone (§7):
 *   sealed      "Rohan's first fifty · 63 v DHS · sealed by the scorer, 12 Sep"
 *   not sealed  "Rohan's first fifty · 63 v DHS", with `note` NOT_SEALED
 * and FROM_BOOK in `note` for a scorebook card.
 * @returns {{ line: string, sealed: boolean, note: string|null }}
 */
export function familyMilestoneLine(r, name, first = false) {
  const head = `${name}'s ${first ? "first " : ""}${whatOf(r.kind, r.value)}`;
  const sealed = isSealed(r);
  const parts = [head, figureOf(r)];
  if (sealed) parts.push(`sealed by the scorer, ${dayMonth(r.sealedOn)}`);
  const notes = [r.source === "scorebook" ? FROM_BOOK : null, sealed ? null : NOT_SEALED].filter(Boolean);
  return { line: parts.filter(Boolean).join(" · "), sealed, note: notes.length ? notes.join(" · ") : null };
}

/**
 * Where a milestone came from, as words beside it on the pupil's and the
 * staff screens: "from the scorebook", "not yet sealed by the scorer".
 */
export function provenanceOf(r) {
  if (r?.family !== "milestone") return [];
  return [r.source === "scorebook" ? FROM_BOOK : null, isSealed(r) ? null : NOT_SEALED].filter(Boolean);
}

/** True for a withdrawn honour (only its three readers ever receive one). */
export const isWithdrawn = (r) => r?.family === "honour" && Boolean(r.withdrawnOn);

/**
 * An honour as §7 says it: "Half colours 2026"; withdrawn, "Half colours 2026
 * · withdrawn 3 Oct 2026", and to a parent "· the school can say why". The
 * reason is never on a screen (D4); the server never sends it.
 * @param {{label: string, season?: string|null, withdrawnOn?: string|null}} r
 * @param {{ family?: boolean }} [opts]
 */
export function honourWords(r, { family = false } = {}) {
  // The season once: a Player of the Match label already ends with its date
  // ("… · 21 Oct 2026"), and "21 Oct 2026 2026" says the year twice.
  const season = r.season && !new RegExp(`\\b${String(r.season).replace(/[^0-9A-Za-z/-]/g, "")}\\b`).test(String(r.label ?? "")) ? r.season : null;
  const head = [r.label, season].filter(Boolean).join(" ");
  if (!r.withdrawnOn) return head;
  return [head, `withdrawn ${dayMonthYear(r.withdrawnOn)}`, family ? "the school can say why" : null].filter(Boolean).join(" · ");
}
