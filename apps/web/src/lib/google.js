/**
 * SCRBRD — Google sign-in, in the browser (SCRBRD-140 phase 1, design §2).
 *
 * WHAT THIS IS FOR. Google tells the browser "this person holds that Google
 * account, whose email is verified", as a Firebase ID token. This file gets
 * that token and hands it to lib/signin.js, which gives it to the API ONCE;
 * the API checks Google's signature and answers with SCRBRD's own session
 * token. Firebase is a verifier here. It is not our session, not a user store
 * we read, and not where anyone's role lives.
 *
 *   - NO KEYS IN CODE. The project's web config comes from the build's
 *     environment (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN,
 *     VITE_FIREBASE_PROJECT_ID, and optionally VITE_FIREBASE_APP_ID). A build
 *     without them has no Google button and says why; it never reaches for
 *     lib/firebase.js's analytics config, which is a different decision.
 *   - THE SDK IS NOT AT BOOT. `firebase/auth` is a dynamic import, fetched when
 *     somebody presses the button, so the chunk every visitor downloads to reach
 *     the sign-in screen does not carry it (tools/check-bundle.mjs holds that).
 *   - NOTHING IS KEPT. The Firebase session is held in memory only (never in
 *     IndexedDB or localStorage) and ended the moment the ID token is in hand:
 *     a school's shared computer is not left holding somebody's Google sign-in.
 *     The token is used once and never stored.
 *   - THE ACCOUNT CHOOSER IS ALWAYS ASKED. A second Google account from Me
 *     ("Add a way to sign in") must be a different sign-in, not a silent
 *     re-use of the one the browser already holds.
 *
 * It decides nothing about who anyone is or what they may do.
 */
import { api } from "./api.js";

const KEYS = ["apiKey", "authDomain", "projectId"];

/**
 * The web config from a Vite env object, or null when this build has none.
 * `env` is import.meta.env, which is undefined under plain node.
 * @param {Record<string, string | undefined> | undefined} [env]
 * @returns {{ apiKey: string, authDomain: string, projectId: string, appId?: string } | null}
 */
export function googleConfig(env = /** @type {any} */ (import.meta).env) {
  if (!env) return null;
  const cfg = {
    apiKey: String(env.VITE_FIREBASE_API_KEY ?? "").trim(),
    authDomain: String(env.VITE_FIREBASE_AUTH_DOMAIN ?? "").trim(),
    projectId: String(env.VITE_FIREBASE_PROJECT_ID ?? "").trim(),
    appId: String(env.VITE_FIREBASE_APP_ID ?? "").trim(),
  };
  if (KEYS.some((k) => !cfg[/** @type {"apiKey"} */ (k)])) return null;
  return { apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, ...(cfg.appId ? { appId: cfg.appId } : {}) };
}

/** Is Google sign-in switched on in this build? */
export const googleAvailable = () => googleConfig() !== null;

// THE WALKS' DOOR. A build made for the browser walks (SCRBRD_TEST_HOOKS=1, into dist-test/ —
// vite.config.js) lets window.__SCRBRD_TEST_GOOGLE__ answer in place of the
// popup, with an ID token the walk signed with its own key. In every other
// build the constant is the literal `false`, the branch is dead code and the
// name is not in the bundle (tools/check-bundle.mjs fails the build if it is).
// The SDK is still loaded first, so the walk can see WHEN it is fetched.
// (See googleIdToken below.)

/**
 * What a failure to get a token from Google is called, in our words. Firebase's
 * codes are not for people; an unknown one is `google_failed`, never shown raw.
 * @param {any} e
 * @returns {GoogleFailure}
 */
export function googleFailure(e) {
  const code = String(e?.code ?? "");
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/user-cancelled") return "cancelled";
  if (code === "auth/popup-blocked") return "popup_blocked";
  if (code === "auth/network-request-failed") return "network";
  if (code === "auth/unauthorized-domain" || code === "auth/operation-not-allowed" || code === "auth/invalid-api-key"
      || code === "auth/api-key-not-valid" || code === "auth/configuration-not-found") return "not_set_up";
  if (code === "auth/too-many-requests") return "too_many";
  if (code === "auth/user-disabled") return "google_disabled";
  if (e?.message === "not_configured") return "not_configured";
  return "google_failed";
}

/** @typedef {"cancelled" | "popup_blocked" | "network" | "not_set_up" | "too_many" | "google_disabled" | "not_configured" | "google_failed"} GoogleFailure */

/** The words for each, on a sign-in screen. None names a Firebase code. */
export const GOOGLE_FAILURE_WORDS = {
  cancelled: "The Google window was closed before you finished. Press Continue with Google to try again.",
  popup_blocked: "Your browser blocked the Google window. Allow pop-ups for this page, then press the button again.",
  network: "Could not reach Google. Check your connection and try again, or use a code from your school office.",
  not_set_up: "Google sign-in is not set up for this address yet. Use a code from your school office.",
  too_many: "Google is asking you to wait a little before trying again. Use a code from your school office if you cannot wait.",
  google_disabled: "Google says this account is disabled. Use a different Google account, or a code from your school office.",
  not_configured: "Google sign-in is not switched on for this site. Use a code from your school office.",
  google_failed: "Google sign-in did not finish. Try again, or use a code from your school office.",
};

/** @type {Promise<{ auth: any, sdk: any }> | null} */
let _ready = null;

/**
 * The SDK and an Auth instance that keeps nothing. Made once.
 * `load` is injectable so a test can count fetches without Google.
 * @param {{ load?: () => Promise<[any, any]> }} [opts]
 */
export function authReady({ load = () => Promise.all([import("firebase/app"), import("firebase/auth")]) } = {}) {
  if (!_ready) {
    const cfg = googleConfig();
    if (!cfg) return Promise.reject(Object.assign(new Error("not_configured"), { code: "not_configured" }));
    _ready = load().then(([appSdk, authSdk]) => {
      // A named app of its own: lib/firebase.js's default app belongs to the
      // analytics decision, and this one belongs to a sign-in.
      const app = appSdk.getApps().find((a) => a.name === "scrbrd-signin") ?? appSdk.initializeApp(cfg, "scrbrd-signin");
      const auth = authSdk.initializeAuth(app, {
        persistence: authSdk.inMemoryPersistence,
        popupRedirectResolver: authSdk.browserPopupRedirectResolver,
      });
      return { auth, sdk: authSdk };
    }).catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}

/**
 * Ask Google who this is. Always the account chooser, always a fresh
 * sign-in, so the token's auth_time is now (the API wants that to attach a
 * second account to an existing one).
 * @returns {Promise<{ ok: true, idToken: string, email: string | null } | { ok: false, failure: GoogleFailure }>}
 */
export async function googleIdToken() {
  try {
    const { auth, sdk } = await authReady();
    // Written out here rather than through a named constant: a constant the
    // minifier does not inline leaves the condition behind, name and all.
    if (typeof __SCRBRD_TEST_HOOKS__ !== "undefined" && __SCRBRD_TEST_HOOKS__) {
      if (typeof window.__SCRBRD_TEST_GOOGLE__ === "function") {
        const t = await window.__SCRBRD_TEST_GOOGLE__();
        return { ok: true, idToken: String(t.idToken), email: t.email ?? null };
      }
    }
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const cred = await sdk.signInWithPopup(auth, provider);
    const idToken = await cred.user.getIdToken();
    const email = cred.user.email ?? null;
    // The token is the whole of what we came for. End Google's session here.
    await sdk.signOut(auth).catch(() => {});
    return { ok: true, idToken, email };
  } catch (e) {
    return { ok: false, failure: googleFailure(e) };
  }
}

/**
 * Add a way to sign in to the signed-in account (POST /api/auth/sign-ins). The
 * server's refusals are `{ error, detail }`; `detail` is the sentence to show.
 * @param {string} idToken
 * @param {typeof api} [post]
 */
export async function addSignIn(idToken, post = api) {
  return post("/api/auth/sign-ins", { method: "POST", body: { idToken } });
}
