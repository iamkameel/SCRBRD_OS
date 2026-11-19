/**
 * THE THINGS' ADDRESSES (EXPERIENCE_PASS §1.2 rule 4, §1.4, Q11 decided 13 Nov):
 * a player, a team and a ground each get a page under /app that a notice, a
 * search result or a "Needs you" row can land on, beside the Match Centre's
 * /app/matches/:id (lib/matchTabs.js).
 *
 *   /app/players/<player id>
 *   /app/teams/<school id>.<team code>     a side has no id of its own: its school's and its code, "U15A"
 *   /app/grounds/<ground id>
 *
 * BY ID ONLY, NEVER A NAME. An address is kept in a browser's history, a
 * server's log and a shared link, so it carries no child's name, no side's
 * name and no school's: an id that is not of the expected shape is not an
 * address at all, and the app lands on /app.
 *
 * AN ADDRESS DECIDES NOTHING. It names the screen that already shows the
 * thing (Team, Players; Team, a side; Fields) and the thing on it. The shell
 * opens it only for a reader whose menu reaches that screen, and the screen
 * asks its existing read, which refuses the rest: a reader who may not read
 * that boy is told so, and is shown nothing of him.
 *
 * No import, on purpose: App.jsx reads this, and the entry has a ceiling.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A side's code as the fixture read has it (team_code): "1XI", "U15A", "U13B". No spaces, so never a name. */
const TEAM_CODE = /^[A-Za-z0-9_-]{1,16}$/;
/** The demo's seeded ids ("p1", "g2"): short, lowercase, no spaces. Signed out only; still never a name. */
const DEMO_ID = /^[a-z]{1,3}\d{1,4}$/;

/** kind → the destination whose screen shows it */
export const THING_PAGE = Object.freeze({ players: "profiles", teams: "squad", grounds: "fields" });

const idOk = (/** @type {string} */ kind, /** @type {string} */ id) => {
  if (kind === "teams") {
    const dot = id.indexOf(".");
    if (dot < 1) return false;
    const school = id.slice(0, dot), code = id.slice(dot + 1);
    return (UUID.test(school) || DEMO_ID.test(school)) && TEAM_CODE.test(code);
  }
  return UUID.test(id) || DEMO_ID.test(id);
};

/**
 * The thing an address names, or null when it names none (or names one by
 * anything but an id).
 * @param {string} pathname
 * @returns {{ kind: "players" | "teams" | "grounds", id: string } | null}
 */
export function thingOf(pathname) {
  const m = /^\/app\/(players|teams|grounds)\/([^/?#]+)\/?$/.exec(pathname ?? "");
  if (!m) return null;
  let id;
  try { id = decodeURIComponent(m[2]); } catch { return null; }
  const kind = /** @type {"players" | "teams" | "grounds"} */ (m[1]);
  return idOk(kind, id) ? { kind, id } : null;
}

/**
 * The address of a thing, or null when its id would not be one.
 * @param {"players" | "teams" | "grounds"} kind @param {string} id
 */
export function thingPath(kind, id) {
  return THING_PAGE[kind] && typeof id === "string" && idOk(kind, id) ? `/app/${kind}/${encodeURIComponent(id)}` : null;
}

/** A side's id for its address: its school's id and its code. @param {string} school @param {string} code */
export const teamId = (school, code) => `${school}.${code}`;

/** The school and code a side's id names. @param {string} id */
export function teamParts(id) {
  const dot = String(id ?? "").indexOf(".");
  return dot < 1 ? null : { school: id.slice(0, dot), code: id.slice(dot + 1) };
}
