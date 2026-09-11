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
 */
import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAagOmj51ns5R64-IQRI92o4Sa5iagFRPA",
  authDomain: "scrbrd-os.firebaseapp.com",
  projectId: "scrbrd-os",
  storageBucket: "scrbrd-os.firebasestorage.app",
  messagingSenderId: "705280257618",
  appId: "1:705280257618:web:8f5d627b62e3c826c3398b",
  measurementId: "G-978R0NW98E",
};

export const firebaseApp = initializeApp(firebaseConfig);

// Analytics needs a real browser (IndexedDB, cookies) and Firebase's own
// isSupported() is how it says so — a private tab with storage blocked stays
// silent rather than throwing. Exported as a promise rather than a value: any
// call site that wants the instance awaits it instead of racing a variable
// that starts null and is filled in later.
export const analyticsReady = isSupported()
  .then((ok) => (ok ? getAnalytics(firebaseApp) : null))
  .catch(() => null);
