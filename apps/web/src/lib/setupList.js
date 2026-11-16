/**
 * THE SET-UP LIST (EXPERIENCE_PASS §1.9 "No fixtures yet", §2.7; Slice 6).
 *
 * A new school's first Today leads with a list of what setting it up takes,
 * each line a row with an owner and one action, in the shape of every "Needs
 * you" row, and each going when it is true. Nothing here is new machinery:
 * every line opens a screen that exists, under the gate it already has, and a
 * line is drawn only for a reader who reaches that screen.
 *
 * It makes no read of its own (review S2's no-tap rule, as Today's "Needs
 * you"): whether pupils, sides and fixtures exist is read off the rows Today
 * already reads (the fixtures and the players), and whether a parent waits off
 * the queue's own requests and claims rows. Whether the staff register has a
 * row, and whether the office has chosen what is public, are not read on
 * Today: the screen each line opens says so when it draws it (`learnSetup`),
 * and the line goes then. In memory only, so after a reload those two lines
 * come back until their screen is opened again; that is the price of not
 * reading the register or the listing from Today.
 *
 * Pure apart from the small note below, so it is proved under plain node.
 */

/** What the screens a line opens have said this session: "staff" (a register row), "public" (a listing choice). */
const learned = new Set();

/** A screen says a line is true (staffRegister.jsx: a row is listed; listing.jsx: the school has chosen). @param {"staff" | "public"} kind */
export function learnSetup(kind) { learned.add(kind); }

/** For a test: what has been said. */
export const setupLearned = () => new Set(learned);
/** For a test: forget. */
export const forgetSetup = () => learned.clear();

/**
 * @typedef {{ key: string, fact: string, owner: string, door: { label: string, page: string, section?: string | null, fix?: string | null } }} SetupLine
 */

const OFFICE = "The office";

/**
 * The lines for this reader, in §2.7's order, or null when the list is not
 * drawn at all: fixtures exist, the fixtures read has not answered whole, or
 * the reader reaches none of the screens.
 * @param {{
 *   reach: string[],                 the destinations this reader reaches (useNav)
 *   mayDo: (cap: string) => boolean, a capability this reader mayDo (layout only)
 *   matches: { answered: boolean, count: number },
 *   players: any[],                  the players Today read
 *   parentsWaiting: number,          the queue's parents row count
 *   claimsWaiting: number,           the queue's claims row count
 *   known?: Set<string>,             what the screens have said (defaults to this session's)
 * }} o
 * @returns {SetupLine[] | null}
 */
export function setupLines({ reach, mayDo, matches, players, parentsWaiting, claimsWaiting, known = learned }) {
  if (!matches.answered || matches.count > 0) return null;
  // The office and the director, setting a school up: whoever reaches the School home.
  if (!reach.includes("staff")) return null;
  /** @type {SetupLine[]} */
  const lines = [];
  // Staff by the register (views/staffRegister.jsx), for whoever may list people on it.
  if (mayDo("user.role.assign") && !known.has("staff"))
    lines.push({ key: "staff", fact: "List your staff", owner: OFFICE,
      door: { label: "Open the staff register", page: "staff", fix: '[data-testid="register-panel"]' } });
  // Pupils by import (views/importer.jsx), for whoever may import players.
  if (mayDo("player.profile.manage") && players.length === 0)
    lines.push({ key: "pupils", fact: "Bring in your pupils", owner: OFFICE,
      door: { label: "Open Import", page: "staff", fix: '[data-testid="import-panel"]' } });
  if (reach.includes("squad") && !players.some((p) => p.team))
    lines.push({ key: "teams", fact: "Make your teams", owner: OFFICE, door: { label: "Open Team", page: "squad" } });
  if (reach.includes("matches"))
    lines.push({ key: "fixture", fact: "Add your first fixture", owner: OFFICE, door: { label: "Open Matches", page: "matches" } });
  // Parents by request and verification: the queue's own count of parents asking to be linked to a child, opening
  // the same panel. A Google sign-in claim is not counted here: the claims read does not say whose account it is
  // (a parent's or a teacher's), so it stays Needs you's own row, in its own words.
  void claimsWaiting;
  if (parentsWaiting > 0 && reach.includes("management"))
    lines.push({ key: "parents", fact: parentsWaiting === 1 ? "A parent is waiting" : `${parentsWaiting} parents are waiting`, owner: OFFICE,
      door: { label: "Decide", page: "management", fix: '[data-testid="requests-panel"]' } });
  // What is public: the listing and names-off switches on School, Record, for whoever may change them.
  if (reach.includes("record") && mayDo("broadcast.publish") && !known.has("public"))
    lines.push({ key: "public", fact: "Decide what is public", owner: OFFICE,
      door: { label: "Open Record", page: "record", fix: '[data-testid^="listing-"]' } });
  return lines.length ? lines : null;
}
