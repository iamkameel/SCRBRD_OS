/**
 * The navigation's league-invitation badge, in a number and in words.
 *
 * A leaf on purpose: the badge (lib/invitations.js, shell/Sidebar.jsx,
 * shell/MobileNav.jsx) is in the entry graph, and lib/league.js, which
 * re-exports both, is not (29 Oct, the entry trim).
 */

/**
 * How many of the invitations the API listed are still waiting for an answer.
 * The API lists only those, but a row that says otherwise is not counted.
 * @param {unknown} rows
 */
export function invitationsWaiting(rows) {
  return Array.isArray(rows) ? rows.filter((r) => r && (r.status ?? "invited") === "invited").length : 0;
}

/** "1 league invitation waiting", "3 league invitations waiting", or "" for none. @param {number} n */
export function invitationsWords(n) {
  return n > 0 ? `${n} league invitation${n === 1 ? "" : "s"} waiting` : "";
}
