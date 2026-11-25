/**
 * "Coming of age" (db/173): the words for one row of the office's list.
 * Pure: no fetch, no DOM. The screen is views/comingofage.jsx.
 */

/** A day as the office reads it: 20 December 2026. @param {string | null | undefined} iso YYYY-MM-DD */
function dayOf(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * "R Pillay (U16A): 18 on 20 December 2026, born 20 December 2008".
 * @param {{ fullName: string, teamCode?: string | null, born: string, ofAgeOn: string }} r
 * @param {string} [today] YYYY-MM-DD, for "18 since"
 */
export function comingOfAgeLine(r, today = new Date().toISOString().slice(0, 10)) {
  const side = r.teamCode ? ` (${r.teamCode})` : "";
  const when = r.ofAgeOn <= today ? `18 since ${dayOf(r.ofAgeOn)}` : `18 on ${dayOf(r.ofAgeOn)}`;
  return `${r.fullName}${side}: ${when}, born ${dayOf(r.born)}`;
}

/** How the date on record was written, in words. @param {{ how?: string | null }} r */
export function comingOfAgeWritten(r) {
  return r.how === "import" ? "Written by a roster import."
       : r.how === "capture" ? "Recorded on his profile."
       : r.how === "correction" ? "Corrected on his profile."
       : r.how === "owner" ? "Written by SCRBRD."
       : "Written before dates were recorded.";
}
