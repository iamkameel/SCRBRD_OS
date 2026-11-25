/**
 * SCRBRD — the family list's words (SCRBRD-140 honesty model, Migration C, db/174).
 *
 * The office lists, in advance, a child from its own roster, an address and
 * a kind: a parent's or guardian's address, or the pupil's own. A parent who
 * signs in with Google at that address and types his date of birth is linked
 * at once, where the school has switched that on; otherwise her request waits
 * in Requests with one line saying what the list found. The screen
 * (views/familyList.jsx) only asks: every decision is the database's.
 *
 * None of these words is ever shown to the person who asked: the line on a
 * request is the office's (family_register_line() answers nobody else), and
 * it never carries the date she typed, which is kept nowhere.
 */

/** The line on a request the list did not link (design §5.3), by the server's code. */
export const FAMILY_LINE_WORDS = Object.freeze({
  details_disagree: "On the family list. The details did not agree.",
  uploader_lapsed: "On the family list. The person who listed it can no longer make this link.",
  details_agree: "On the family list. The details agree. Linking at once is not switched on for your school.",
  has_account: "On the family list. This pupil already has an account, so nothing was merged.",
  refused: "On the family list. It could not be linked from the list; decide it here.",
});

/** @param {unknown} code @returns {string | null} */
export const familyLine = (code) => (typeof code === "string" && code in FAMILY_LINE_WORDS
  ? FAMILY_LINE_WORDS[/** @type {keyof typeof FAMILY_LINE_WORDS} */ (code)] : null);

export const FAMILY_INTRO = "List a parent's or guardian's email address against a child on your roster, or a pupil's own. When that person signs in with Google at that address and types the child's date of birth, the list confirms them. Each row is used once.";

/** The switch (Q1), said as it stands for this school. @param {boolean} on */
export const switchWords = (on) => (on
  ? "A full match links at once. You are told of each link, with End link beside it."
  : "A match does not link by itself here: it waits in Requests, marked. Linking at once is switched on for a school only after the school has said yes.");

export const KIND_WORDS = Object.freeze({ guardian: "Parent or guardian", pupil: "The pupil's own" });
export const RELATIONSHIP_CHOICES = Object.freeze([
  { id: "parent", label: "Parent" }, { id: "guardian", label: "Guardian" },
  { id: "grandparent", label: "Grandparent" }, { id: "other", label: "Other" },
]);

/** A row's state, in words, from family_register_rows(). @param {any} r */
export function rowStateWords(r) {
  if (r?.state === "withdrawn") return "Withdrawn";
  if (r?.state === "expired") return "Past its claim-by date";
  if (r?.state === "open") return "Open";
  if (r?.outcome === "granted") return r?.kind === "pupil" ? "Claimed: his account opened" : "Claimed: linked";
  if (r?.outcome === "recognised") return "Claimed: recognised, waiting for a parent's yes";
  return familyLine(r?.outcome_reason === "uploader_authority_lapsed" ? "uploader_lapsed"
    : r?.outcome_reason === "not_switched_on" ? "details_agree" : r?.outcome_reason) ?? "Claimed";
}

/** What the office is told after a check or an upload. @param {{ ok: boolean, committed: boolean, rows: any[] }} r */
export function uploadWords(r) {
  const n = r.rows?.length ?? 0;
  if (r.committed) return n === 1 ? "Listed 1 row." : `Listed ${n} rows.`;
  if (r.ok) return n === 1 ? "1 row is ready to list." : `${n} rows are ready to list.`;
  const bad = (r.rows ?? []).filter((x) => !x.ok).length;
  return bad === 1 ? "1 row needs attention. Nothing was listed." : `${bad} rows need attention. Nothing was listed.`;
}

/** A refusal from the family list's routes, in words. @param {any} e */
export function familyListError(e) {
  if (e?.status === undefined || e?.status === null) return "Could not reach SCRBRD. Check your connection and try again.";
  if (typeof e?.detail === "string" && e.detail) return e.detail;
  if (e?.status === 403) return "Only the school office and the principal can use its family list.";
  return "That did not work. Try again.";
}

/** "Clear N expired rows". @param {number} n */
export const clearWords = (n) => (n === 1 ? "Clear 1 expired row" : `Clear ${n} expired rows`);
