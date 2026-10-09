/**
 * The menu with its homes drawn (GA-I30), and what a home shows a reader.
 *
 * Both are asked of `useNav`, which is the menu as it has always been: the
 * role's destinations narrowed by capability and then by the school's module
 * switches. A home takes that list and folds it (design/homes.js); it never
 * widens it, and it cannot add a destination `useNav` did not hold. Kept apart
 * from lib/features.js, which the public pages' graph reaches.
 */
import { collapseHomes, homeParts } from "../design/homes.js";
import { useNav } from "./features.js";

/** The destinations to draw: each home once, a home only if one of its sections is reached. */
export function useMenu(role) {
  return collapseHomes(useNav(role));
}

/** `{ sections, links }` this reader is shown of one home, from the same reach as the menu. */
export function useHome(role, homeKey) {
  const { sections, links } = homeParts(homeKey, useNav(role));
  return { sections, links };
}
