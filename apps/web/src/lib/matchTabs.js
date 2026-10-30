/**
 * CRI-1.3: the match page's tabs on a phone, and one address per tab
 * (docs/design/CRICINFO_GAP_PLAN.md §6). Pure, with no import, so the public
 * pages' bundle (src/public/) and the signed-in Match Centre share it.
 *
 * ON A PHONE the strip is Summary, Scorecard and Commentary, and a More
 * control holding the rest in the order the wide strip has them: the reader's
 * own tab (Coach, Captain) where he has one, then Partnerships, Analytics and
 * Match details. Every tab is two taps away at most. Wider, every tab shows.
 *
 * ONE ROUTE PER TAB. The Summary is the match's own address; every other tab
 * is a segment after it. The signed-in app: /app/matches/:id and
 * /app/matches/:id/commentary, its list /app/matches. The public page keeps
 * the shells it already has, /live/:id (the Summary) and /scorecard/:id, and
 * its other tabs are /live/:id/commentary and the like
 * (services/api/public/public-api.mjs serves the shell for exactly those).
 */

/** The three a phone shows in the strip, in this order. */
export const STRIP_TABS = Object.freeze(["summary", "scorecard", "commentary"]);

/** The match page's own phone breakpoint (MatchView's `phone`, `.mc-short`). */
export const NARROW_PX = 640;

/**
 * The strip and the More menu for this many tabs at this width. Wide, the
 * strip is every tab and More holds nothing.
 * @template {{id: string}} T
 * @param {T[]} tabs  in the wide strip's order
 * @param {boolean} narrow
 * @returns {{strip: T[], more: T[]}}
 */
export function splitTabs(tabs, narrow) {
  if (!narrow) return { strip: [...tabs], more: [] };
  const strip = STRIP_TABS.map((id) => tabs.find((t) => t.id === id)).filter(Boolean);
  // A menu of one is a tab that would fit: never seen with today's tabs, but
  // the rule holds whatever a later reader's tab list is.
  const more = tabs.filter((t) => !STRIP_TABS.includes(t.id));
  return more.length > 1 ? { strip: /** @type {T[]} */ (strip), more } : { strip: [...tabs], more: [] };
}

/**
 * The tab to show for an address's tab: the one asked if this reader has it,
 * the Summary otherwise (an old link, a role tab he does not hold).
 * @param {{id: string}[]} tabs  @param {string | null | undefined} asked
 */
export const tabOr = (tabs, asked) => (asked && tabs.some((t) => t.id === asked) ? asked : "summary");

const SEGMENT = /^[a-z]+$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The signed-in Match Centre list's address. */
export const APP_MATCHES = "/app/matches";

/**
 * The signed-in Match Centre's address: null for any other, the list as
 * `{matchId: null}`, a fixture with its tab (null is the Summary).
 * @param {string} pathname
 * @returns {{matchId: string | null, tab: string | null} | null}
 */
export function parseAppPath(pathname) {
  const p = String(pathname ?? "").replace(/\/+$/, "");
  if (p === APP_MATCHES) return { matchId: null, tab: null };
  const m = /^\/app\/matches\/([^/]+)(?:\/([^/]+))?$/.exec(p);
  if (!m || !ID.test(m[1]) || (m[2] != null && !SEGMENT.test(m[2]))) return null;
  return { matchId: m[1], tab: m[2] && m[2] !== "summary" ? m[2] : null };
}

/** @param {string} matchId  @param {string | null} [tab] */
export const appPath = (matchId, tab = null) =>
  `${APP_MATCHES}/${encodeURIComponent(matchId)}${tab && tab !== "summary" ? `/${tab}` : ""}`;

/** The public page's tabs that live after /live/:id (the Summary is /live/:id, the Scorecard /scorecard/:id). */
export const PUBLIC_LIVE_TABS = Object.freeze(["commentary", "partnerships", "analytics", "details"]);

/**
 * The public page's tab from its address: null for an address that is not a
 * public match page.
 * @param {string} pathname
 * @returns {{matchId: string, tab: string} | null}
 */
export function parsePublicPath(pathname) {
  const p = String(pathname ?? "").replace(/\/+$/, "");
  const m = /^\/(live|scorecard)\/([^/]+)(?:\/([^/]+))?$/.exec(p);
  if (!m) return null;
  if (m[1] === "scorecard") return m[3] == null ? { matchId: m[2], tab: "scorecard" } : null;
  if (m[3] == null) return { matchId: m[2], tab: "summary" };
  return PUBLIC_LIVE_TABS.includes(m[3]) ? { matchId: m[2], tab: m[3] } : null;
}

/** @param {string} matchId  @param {string} tab */
export const publicPath = (matchId, tab) => {
  const id = encodeURIComponent(matchId);
  return tab === "scorecard" ? `/scorecard/${id}` : PUBLIC_LIVE_TABS.includes(tab) ? `/live/${id}/${tab}` : `/live/${id}`;
};
