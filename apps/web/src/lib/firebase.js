/**
 * SCRBRD — Firebase, for product analytics only.
 *
 * This project's own data — players, guardians, scores, notes — lives in
 * Postgres, behind capability + scope RLS ("the backend must remain
 * authoritative"). Firebase is not a second backend and must never become
 * one: this file wires up Analytics alone, and nothing here should gain a
 * Firestore or Auth import without deciding on purpose to keep a second copy
 * of data this project already scopes carefully in one place.
 *
 * ONE PROJECT, scrbrd-os, and it is the only Firebase this repository knows
 * about. The earlier prototypes had their own projects and their own
 * Firestore rules; none of that is inherited, referenced, or deployed to from
 * here, and nothing in this build should ever point at another project id.
 * This one starts with nothing collected.
 *
 * Firebase Analytics collects its own generic technical events (session_start
 * and the like) automatically once initialised. Nothing here calls
 * setUserId()/setUserProperties() or logs a custom event carrying a player,
 * guardian, or school identifier — that would hand Google a copy of exactly
 * the scoped data the RLS model exists to contain. Anything added later that
 * logs an app-specific event has to keep to that rule.
 *
 * NOTHING RUNS UNTIL SOMEONE SAYS SO. Analytics used to initialise at boot,
 * for every visitor — a parent, a pupil, a school evaluating the product —
 * before any of them had been asked. Its identifiers are personal
 * information under POPIA, and a child's doubly so. So the SDK is not even
 * imported until a per-device preference says yes (lib/persist.js, key
 * "analytics"; the switch is on the landing page), which also keeps ~200 KB
 * of SDK out of the chunk every visitor downloads to reach the login screen.
 * Push messaging still needs the Firebase app object and asks for it lazily.
 */
const firebaseConfig = {
  apiKey: "AIzaSyAagOmj51ns5R64-IQRI92o4Sa5iagFRPA",
  authDomain: "scrbrd-os.firebaseapp.com",
  projectId: "scrbrd-os",
  storageBucket: "scrbrd-os.firebasestorage.app",
  messagingSenderId: "705280257618",
  appId: "1:705280257618:web:8f5d627b62e3c826c3398b",
  measurementId: "G-978R0NW98E",
};

import { getPref, setPref } from "./persist.js";

const CONSENT_KEY = "analytics";

// The app object, made once, on first need — a dynamic import so firebase/app
// is a chunk that only a consenting visitor or a push subscriber fetches.
let _app = null;
export async function firebaseApp() {
  if (!_app) {
    const { initializeApp, getApps } = await import("firebase/app");
    _app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return _app;
}

/** Has this device said yes to anonymous usage analytics? Default: no. */
export async function analyticsConsented() { return (await getPref(CONSENT_KEY)) === true; }

// Analytics needs a real browser (IndexedDB, cookies) and Firebase's own
// isSupported() is how it says so — a private tab with storage blocked stays
// silent rather than throwing.
let _analytics = null;
async function enableAnalytics(load) {
  if (_analytics) return _analytics;
  try {
    const { getAnalytics, isSupported } = await load();
    if (!(await isSupported())) return null;
    _analytics = getAnalytics(await firebaseApp());
  } catch { _analytics = null; }
  return _analytics;
}

/**
 * Called once at boot. Resolves to the Analytics instance only when this device
 * consented earlier; otherwise resolves null WITHOUT loading the SDK. `load` is
 * injectable so a test can prove the SDK is not fetched without consent.
 */
export async function startAnalyticsIfConsented({ load = () => import("firebase/analytics") } = {}) {
  if (!(await analyticsConsented())) return null;
  return enableAnalytics(load);
}

/** The switch. Turning it on starts Analytics now; turning it off stops future boots from starting it. */
export async function setAnalyticsConsent(on, { load = () => import("firebase/analytics") } = {}) {
  await setPref(CONSENT_KEY, on === true);
  if (on) return enableAnalytics(load);
  // The SDK has no "unload"; the honest promise is "not on the next visit",
  // and the switch says so.
  return null;
}
