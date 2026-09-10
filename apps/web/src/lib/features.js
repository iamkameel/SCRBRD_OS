/**
 * SCRBRD — which modules this session may see, and what that is NOT.
 *
 * THIS FILE DECIDES NOTHING. The API refuses a switched-off module's reads
 * (readResource in services/api/read/read-api.mjs) and its writes (the route
 * dispatcher in server.mjs), both by asking the database the same question. If
 * every answer here were wrong, a client would draw the wrong menu and receive
 * exactly the same rows it does now.
 *
 * What it is for is laying out a shell. A destination whose reads will all be
 * refused is a destination that should not be in the menu, and a school that
 * has switched off Injuries should not have to explain to its coaches why the
 * screen is there and empty.
 *
 * UNKNOWN MEANS ON, which is the opposite of the database's rule and correct
 * for the opposite reason. In Postgres an unrecognised key is a switch nobody
 * decided about, so it is off — default deny, because the answer gates data.
 * Here the answer gates a MENU: defaulting to off would blank the navigation
 * during the first render of every session, and on a slow connection would
 * blank it for seconds. Nothing is exposed by drawing a destination early; the
 * reads behind it are refused regardless.
 */
import { api, signedIn } from "./api.js";
import { MODULE_OF_NAV } from "@scrbrd/policy/modules";
import { ROLES } from "../design/roles.js";
import { useEffect, useState } from "react";

// key → boolean, or null before the first answer. Module-level rather than
// per-component: the shell, the mobile navigation and the role switcher all
// ask, and three components each firing their own read of the same row set
// would be three round trips for one answer.
let _features = null;
let _inflight = null;

/** Forget everything on sign-out. A shared device must not carry a school's switches. */
export function resetFeatures() { _features = null; _inflight = null; }

async function load() {
  if (_features) return _features;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const { rows } = await api("/api/read/my_features");
      _features = Object.fromEntries(rows.map((r) => [r.key, r.enabled === true]));
    } catch {
      // A failed read is not a school that switched everything off. Leaving the
      // map empty means featureOn() answers true for everything, the menu draws
      // as it always did, and the reads behind it decide — which is where the
      // decision belongs anyway.
      _features = {};
    } finally {
      _inflight = null;
    }
    return _features;
  })();
  return _inflight;
}

/** Is this module or feature on for this session? Unknown is on — see above. */
export function featureOn(key) {
  if (!_features) return true;
  return _features[key] !== false;
}

/**
 * The feature map for this session, fetched once.
 *
 * Returns `{ features, ready }`. `ready` is worth having: an administrator's
 * screen that says "Analytics is on" before the answer arrives is stating
 * something it does not know.
 */
export function useFeatures() {
  const [state, setState] = useState(() => ({ features: _features ?? {}, ready: !!_features }));
  useEffect(() => {
    if (!signedIn()) { setState({ features: {}, ready: true }); return; }
    let cancelled = false;
    load().then((f) => { if (!cancelled) setState({ features: f, ready: true }); });
    return () => { cancelled = true; };
  }, []);
  return state;
}

/**
 * The destinations to draw: the role's navigation, narrowed by what is on.
 *
 * AN AND, in that order, and the order is the whole point. `navFor` has
 * already filtered to the capabilities this role holds; this only removes
 * more. There is no path through this function that adds a destination a role
 * did not already have — switching a module on for somebody who cannot hold
 * its capability gives them nothing, which is what makes the settings screen
 * safe to hand to a school administrator.
 */
export function useNav(role) {
  const { features } = useFeatures();
  const nav = ROLES[role]?.nav ?? [];
  return nav.filter((k) => {
    const module = MODULE_OF_NAV[k];
    return !module || features[module] !== false;
  });
}
