import { useSyncExternalStore } from "react";

/**
 * The page's address, for the screens that have one (CRI-1.3: the match
 * page's tabs, lib/matchTabs.js). The shell keeps its page in state, not in
 * the address; this is the small part that is in the address: read with
 * usePath(), changed with navigate(), and the back button is the browser's.
 * React only, so the public pages' bundle carries it too.
 */
const NAV = "scrbrd:navigate";
/** @param {() => void} fn */
const subscribe = (fn) => {
  window.addEventListener("popstate", fn);
  window.addEventListener(NAV, fn);
  return () => { window.removeEventListener("popstate", fn); window.removeEventListener(NAV, fn); };
};

/** The page's path, kept current through the back button and navigate(). */
export function usePath() {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => "");
}

/**
 * Go to a path in this page: a new history entry (so Back returns), or the
 * current one replaced. The query, where there is one, stays.
 * @param {string} path  @param {{replace?: boolean}} [opts]
 */
export function navigate(path, { replace = false } = {}) {
  if (typeof window === "undefined" || window.location.pathname === path) return;
  const to = path + window.location.search;
  if (replace) window.history.replaceState(window.history.state, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAV));
}
