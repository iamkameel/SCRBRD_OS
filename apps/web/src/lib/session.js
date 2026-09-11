/**
 * SCRBRD — signing in, and what the client is told afterwards.
 *
 * The important thing this module does NOT do is decide anything. It fetches
 * the signed-in person's assignments so the shell can lay out a workspace —
 * which navigation entries to draw, which cards to request — and every one of
 * those requests is authorised again, server-side, against the same
 * assignments. The widget is presentation; the API is security.
 *
 * So nothing here may be read as "this person may do X". `assignments` is an
 * input to layout. If a view uses it to gate a fetch, that is an optimisation
 * for the person's own benefit — the server refuses regardless.
 */
import { api, setToken, apiStatus, resetApi } from "./api.js";
import { resetFeatures } from "./features.js";
import { roleGrants } from "@scrbrd/policy/roles";
import { deviceId } from "./device.js";

let _profile = null;

/**
 * Sign in.
 *
 * Against a live API this is the real thing and a failure is a failure — it
 * does NOT fall back to the demo accounts. A person who typed a wrong password
 * and got in anyway has been told a lie about a permission decision.
 *
 * `/api/auth/dev-login` is the pilot's route: it issues a token for a seeded
 * address without a code exchange, and the server gates it on not-production
 * plus an explicit opt-in. The magic-link path that replaces it needs the
 * login_code table (see services/api/auth/auth-db.mjs).
 */
export async function signIn(email) {
  const { token } = await api("/api/auth/dev-login", {
    method: "POST",
    body: { email, deviceId: deviceId() },
  });
  setToken(token);
  _profile = await api("/api/session");
  return _profile;
}

/**
 * The real sign-in: an address and a code the school office issued.
 *
 * SCRBRD sends no email and no SMS, so the code was handed over the way a
 * school already hands things over. The exchange is the same one an emailed
 * link would use — only the delivery differs — and it binds the resulting
 * session to THIS DEVICE, which is why a lost phone is re-issued rather than
 * recovered.
 *
 * A failure here is a failure. It does not fall back to the development route,
 * for the reason signIn's neighbours give: a person who typed the wrong code
 * and got in anyway has been told a lie about a permission decision.
 */
export async function signInWithCode(email, code) {
  const { token } = await api("/api/auth/redeem", {
    method: "POST",
    body: { email, code, deviceId: deviceId() },
  });
  setToken(token);
  _profile = await api("/api/session");
  return _profile;
}

/**
 * Whether this server will accept the development sign-in.
 *
 * Read from /api/health rather than assumed, so the screen offers the seeded
 * accounts only where they actually work. A button that mints a session on a
 * developer's laptop and returns an error in production is worse than no
 * button.
 */
export async function devLoginAvailable() {
  const { health } = await apiStatus();
  return health?.auth === "dev_login_enabled";
}

export function signOut() {
  _profile = null;
  resetApi();
  // The module switches too. They are one school's settings, and a shared
  // device that kept them would draw the previous person's menu.
  resetFeatures();
}

/** The signed-in person, or null. Never an authorization answer. */
export function profile() { return _profile; }

/**
 * The schools where this person holds a capability, for filling in a form.
 *
 * NOT an authorization answer, and the distinction is the same one couldScore()
 * makes below: this decides which school to PUT IN A REQUEST, never whether the
 * request succeeds. Every route that takes a school id checks it again,
 * server-side, against these same assignments — so a wrong answer here produces
 * a refusal, and the thing it actually prevents is a form that cannot be
 * submitted because the client had no school to name.
 *
 * A list rather than a value: people hold assignments at more than one school —
 * a director of sport at one and a parent at another — and a form that silently
 * picked the first would be guessing on their behalf.
 */
export function schoolsWhere(capability) {
  const seen = new Map();
  for (const a of _profile?.assignments ?? []) {
    if (!a.school || !roleGrants(a.role, capability)) continue;
    if (!seen.has(a.school)) seen.set(a.school, { id: a.school, name: a.schoolName || "This school" });
  }
  return [...seen.values()];
}

/**
 * Which of this person's assignments could score this match.
 *
 * Used to decide whether to OFFER the scorer, not whether to allow it: the
 * claim is refused server-side by app_can() against the same rows. Getting
 * this wrong shows someone a button that then says no, which is a UI bug —
 * never an access one.
 */
export function couldScore(schoolId, teamCode) {
  const SCORING = new Set(["directorofsport", "sportsadmin", "coach", "assistantcoach", "scorer"]);
  return (_profile?.assignments ?? []).some((a) =>
    SCORING.has(a.role) &&
    (a.school == null || a.school === schoolId) &&
    (a.team == null || a.team === teamCode));
}

/**
 * Is this build talking to a real backend?
 *
 * The answer drives what the UI says out loud. A demo running on mock data
 * must look like a demo — the alternative is someone at a school believing a
 * roster on screen came from their database.
 */
export async function mode() {
  const s = await apiStatus();
  return s.live ? "live" : "demo";
}
