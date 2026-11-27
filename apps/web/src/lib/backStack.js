import { createContext, useContext } from "react";
import { NAV_META } from "../design/roles.js";

/**
 * Back, named for where the person came from (DESIGN_DIRECTION §2.1; redesign
 * slice 12b): "it names where the person came from ('Home', 'Matches'). On a
 * direct link it names the fixed parent."
 *
 * The shell swaps pages in state (App.jsx), so it keeps a small trail of the
 * pages behind the one on screen: each a page key, the section a link named
 * on it, and its human name, which is the menu's own word for it (NAV_META in
 * design/roles.js). Nothing else goes on it: no person, no child, no match, no
 * address. It lives in memory only, in App's state; a reload starts it empty,
 * and so does signing in, signing out and changing role.
 *
 * A page appears on the trail at most once, and never the page on screen:
 * going to a page that is already on it takes it, and every page after it,
 * off the trail, and the page he left goes on as for any move. So Back always
 * names the page he came from, never the page he is on, and the trail is never
 * longer than the pages there are (TRAIL_MAX bounds it anyway).
 *
 * Presentation only, like the menu: a page Back opens asks its own reads,
 * which refuse what this person may not see.
 */

/** @typedef {{ key: string, section: string | null, name: string }} Stop */
/** @typedef {{ page: string, section: string | null, trail: Stop[] }} Trail */
/** @typedef {{ type: "go" | "replace", key: string, section?: string | null } | { type: "back" } | { type: "forget" }} TrailMove */

export const TRAIL_MAX = 12;

/** A page's human name: the menu's own word for it, or null for a key the menu has no word for. @param {string | null | undefined} key */
export const pageName = (key) => (key && Object.hasOwn(NAV_META, key) ? NAV_META[/** @type {keyof typeof NAV_META} */ (key)].label : null);

/**
 * A page as a stop on the trail: its key, its section and its name, and
 * nothing else, whatever else it was handed. Null for a key with no name: a
 * page Back could not name is not a page Back goes to.
 * @param {string} key  @param {string | null} [section]
 * @returns {Stop | null}
 */
export function stopOf(key, section = null) {
  const name = pageName(key);
  return name ? { key, section: typeof section === "string" ? section : null, name } : null;
}

/** The trail on a fresh load: the page, and nothing behind it. @param {string} [page] @returns {Trail} */
export const startTrail = (page = "dashboard") => ({ page, section: null, trail: [] });

/**
 * One move of the shell's page.
 *   go       the person moved on (the menu, a link on a page): where he was goes on the trail
 *   back     a Back control: the last stop is the page again, with its section, and leaves the trail
 *   replace  a move nobody made (a saved session restored, an address arrived on, a switched-off
 *            page sent home): the page changes and nothing goes on the trail
 *   forget   a new person, or a new role: the trail starts again
 * @param {Trail} state  @param {TrailMove} move
 * @returns {Trail}
 */
export function trailStep(state, move) {
  switch (move?.type) {
    case "go": {
      const { key } = move, section = move.section ?? null;
      if (!key) return state;
      if (key === state.page) return section === state.section ? state : { ...state, section };
      const cut = state.trail.findIndex((s) => s.key === key);
      const kept = cut >= 0 ? state.trail.slice(0, cut) : state.trail;
      const here = stopOf(state.page, state.section);
      const trail = here ? [...kept.filter((s) => s.key !== here.key), here] : kept;
      return { page: key, section, trail: trail.slice(-TRAIL_MAX) };
    }
    case "back": {
      const top = state.trail[state.trail.length - 1];
      return top ? { page: top.key, section: top.section, trail: state.trail.slice(0, -1) } : state;
    }
    case "replace": {
      const { key } = move;
      if (!key) return state;
      return { page: key, section: move.section ?? null, trail: state.trail.filter((s) => s.key !== key) };
    }
    case "forget":
      return state.trail.length ? { ...state, trail: [] } : state;
    default:
      return state;
  }
}

/** Where the person came from, as the screens read it: the last stop (null on a direct link or a fresh load), and the move back to it. */
/** @typedef {{ from: Stop | null, back: (() => void) | null }} CameFrom */
export const BackContext = createContext(/** @type {CameFrom} */ ({ from: null, back: null }));

/** The page this one was reached from, and the way back to it. @returns {CameFrom} */
export const useCameFrom = () => useContext(BackContext);

/**
 * The words and the move for a screen's Back.
 *
 * A screen opened inside its own page (a row of the list, a card on Home)
 * names that page, the one the menu calls it by, and closes back to it. A
 * screen a page opened on arriving (a notice's "See the fixture", Today's
 * match, a match's address) names the page the person came from and goes back
 * there; and when nothing came before it (a direct link, a fresh load), it
 * names its own page, the fixed parent, and closes to it.
 * @param {{ here: string, arrived?: boolean, close: () => void, came?: CameFrom | null }} p
 * @returns {{ name: string, go: () => void, away: boolean }}
 */
export function backTo({ here, arrived = false, close, came = null }) {
  if (arrived && came?.from && came.back) return { name: came.from.name, go: came.back, away: true };
  return { name: pageName(here) ?? "Back", go: close, away: false };
}

/**
 * What a page opened inside itself, by page key: its id, and nothing else. The
 * pad is drawn in the shell's place, so closing it mounts the page again; a
 * fixture opened from the Match Centre's own list is found again by its
 * address, and this says it was opened there, not arrived at. In memory only.
 */
const inside = new Map();

/** Note (or, with null, forget) the thing a page opened inside itself. @param {string} page  @param {string | null} id */
export function openedInside(page, id) {
  if (id == null) inside.delete(page); else inside.set(page, String(id));
}

/**
 * Whether a thing a page shows on mounting was arrived at, rather than opened
 * inside the page: a note another page left (a door) always is; one an
 * address names is, unless this page opened that very thing itself.
 * @param {string} page  @param {string | null | undefined} id  @param {{ door?: boolean }} [o]
 */
export function cameInto(page, id, { door = false } = {}) {
  if (door) return true;
  if (id == null) return false;
  return inside.get(page) !== String(id);
}
