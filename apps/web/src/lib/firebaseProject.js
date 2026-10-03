/**
 * SCRBRD — the one Firebase project's web config, scrbrd-os.
 *
 * These are identifiers, not secrets: a Firebase web config is shipped to
 * every browser by design, and what guards the project is its own rules and,
 * for sign-in, the server's check of every ID token's issuer and audience
 * (services/api/auth/firebase-verify.mjs pins scrbrd-os). Kept here, with no
 * import of any SDK, so that the analytics module (lib/firebase.js) and the
 * Google sign-in (lib/google.js) read the same project without either pulling
 * the other's code into its bundle.
 */
export const FIREBASE_PROJECT_CONFIG = Object.freeze({
  apiKey: "AIzaSyAagOmj51ns5R64-IQRI92o4Sa5iagFRPA",
  authDomain: "scrbrd-os.firebaseapp.com",
  projectId: "scrbrd-os",
  storageBucket: "scrbrd-os.firebasestorage.app",
  messagingSenderId: "705280257618",
  appId: "1:705280257618:web:8f5d627b62e3c826c3398b",
  measurementId: "G-978R0NW98E",
});
