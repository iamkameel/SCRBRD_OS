/**
 * WHETHER A SCORECARD ROW OFFERS A BOY'S PASSPORT (CRI-3.2, G13: "parent own
 * child; coach squad; public nothing").
 *
 * The passport read is `passport($1)` (services/api/read/read-api.mjs, db/124),
 * and it decides who reads what: it answers a reader it refuses with no line at
 * all. This module decides only whether to DRAW the link, and its rule is to be
 * no wider than that read. A row that offered a link the read then refused would
 * be a door that opens on nothing; so where this cannot be sure from what the
 * session says, it draws no link.
 *
 * passport() lets a reader in on any of passport_open_not_union()'s arms, or as
 * a union's named reader (db/124 §3). The arms, and what this draws for each:
 *
 *   1 is_family_of(boy) (db/119)          a guardian or self-access assignment
 *                                         naming him on a link verified and
 *                                         live today: the session's
 *                                         `liveSubjects`. DRAWN.
 *   2 app_can('team.select' or            an assignment at his school, on his
 *     'player.profile.manage', his        side or school-wide, naming nobody or
 *     school, his side, him, no fixture)  naming him live, not one fixture's:
 *                                         his coach, team manager, director,
 *                                         sports or school admin. DRAWN.
 *   3 app_can('guardian.link.manage',     the office at his school, any side.
 *     his school, any side, anybody)      DRAWN.
 *   4 a school his family named           NOT DRAWN. A consent is the family's
 *     (passport_consent, db/122)          and the named school's office's to
 *                                         read (db/115); a coach there cannot
 *                                         see it, so cannot be told it is in
 *                                         force. Narrower than the read.
 *   5 his union's named reader (db/124)   NOT DRAWN: the read is logged to his
 *                                         family as a union read, so it is
 *                                         opened only on purpose, from the
 *                                         selector's own screen.
 *
 * What the session cannot say, and so where the read may still refuse a link
 * this draws: an assignment under an unlifted duty suspension (db/35), which
 * the session lists as live. The sheet then says "Nothing on his record" (an
 * answer of no lines), never a figure of somebody else's.
 *
 * Signed out, in the demonstration (no assignments), and on the public page
 * (which passes no `passportOf` at all): no link. Pure, so
 * apps/web/test/passport-link.test.mjs proves it under plain node.
 */
import { roleGrants, SUBJECT_SCOPED_ROLES } from "@scrbrd/policy/roles";

/** The two roles is_family_of() reads (db/119). */
export const FAMILY_ROLES = Object.freeze(["guardian", "selfaccess"]);

/**
 * The capabilities of passport_open_not_union()'s own-school arms (db/124),
 * and how each is scoped: `side` is app_can at his school, his team and him;
 * `school` is app_can at his school with any team ('*') and anybody (the zero
 * id). The test holds these equal to the SQL.
 */
export const PASSPORT_ARMS = Object.freeze({
  side: Object.freeze(["team.select", "player.profile.manage"]),
  school: Object.freeze(["guardian.link.manage"]),
});

const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : []);

/**
 * Does one non-family assignment reach this boy on one arm, as app_can()
 * scopes it (db/50)? Its school (none names every school), its side unless
 * the arm is school-wide, no single fixture (passport() asks with none), and,
 * if it names anybody, him on a live link (the arm that asks about anybody
 * passes any naming).
 * @param {any} a  @param {{id: string, school: string, team: string | null}} p  @param {"side" | "school"} arm
 */
function reaches(a, p, arm) {
  if (!PASSPORT_ARMS[arm].some((c) => roleGrants(a.role, c))) return false;
  if (a.fixture != null) return false;
  if (a.school != null && a.school !== p.school) return false;
  if (arm === "school") return true;
  if (a.team != null && a.team !== p.team) return false;
  return list(a.subjects).length === 0 || list(a.liveSubjects).includes(p.id);
}

/**
 * Whether to draw the passport link on a boy's scorecard row.
 *
 * `player.school` and `player.team` are HIS (the roster read's school_id and
 * team_code), never the fixture's: the read asks app_can at the side he is
 * registered to, so a boy playing up for another side is his own side's coach's.
 * Without them only the family arm can be decided.
 * @param {{id?: string | null, school?: string | null, team?: string | null} | null | undefined} player
 * @param {any[] | null | undefined} assignments  the session's (lib/session.js profile().assignments)
 * @param {{now?: number}} [o]  the clock, for a support session's hour (the session already lists live ones)
 */
export function opensPassportOf(player, assignments, o = {}) {
  const id = player?.id;
  if (!id || typeof id !== "string") return false;
  const now = o.now ?? Date.now();
  for (const a of list(assignments)) {
    if (!a || !a.role) continue;
    if (a.expiresAt != null && !(Date.parse(a.expiresAt) > now)) continue;
    if (FAMILY_ROLES.includes(a.role)) {
      // liveSubjects only: `subjects` names a pending or ended link too, and
      // is_family_of() does not.
      if (list(a.liveSubjects).includes(id)) return true;
      continue;
    }
    // enquiry, and any role that only means something about a named person:
    // not a staff arm, whatever it grants.
    if (SUBJECT_SCOPED_ROLES.includes(a.role)) continue;
    if (!player?.school) continue;
    const p = { id, school: player.school, team: player.team ?? null };
    if (reaches(a, p, "side") || reaches(a, p, "school")) return true;
  }
  return false;
}
