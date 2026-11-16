/**
 * The menu with its homes drawn (GA-I30; EXPERIENCE_PASS §1.2), and what a
 * home shows a reader.
 *
 * Both are asked of `useNav`, which is the menu as it has always been: the
 * role's destinations narrowed by capability and then by the school's module
 * switches. A home takes that list and folds it (design/homes.js); it never
 * widens it, and it cannot add a destination `useNav` did not hold. Kept apart
 * from lib/features.js, which the public pages' graph reaches.
 */
import { collapseHomes, entryFor, entryLabel, homeParts } from "../design/homes.js";
import { useNav } from "./features.js";

/** The destinations to draw: each home once, a home only if one of its sections is reached. */
export function useMenu(role) {
  return collapseHomes(useNav(role));
}

/**
 * The menu as the shell draws it: each entry's key, its word where a home
 * names it (null: the destination's own, NAV_META), and which entry is lit
 * while `page` is open.
 * @param {string} role @param {string | null} page
 * @returns {{ keys: string[], label: (k: string) => string | null, active: string | null }}
 */
export function useMenuItems(role, page) {
  const reach = useNav(role);
  const keys = collapseHomes(reach);
  return { keys, label: (k) => entryLabel(k, reach), active: page ? entryFor(page, keys) : null };
}

/** `{ sections, links }` this reader is shown of one home, from the same reach as the menu. */
export function useHome(role, homeKey) {
  const { sections, links } = homeParts(homeKey, useNav(role));
  return { sections, links };
}
