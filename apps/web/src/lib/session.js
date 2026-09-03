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

export function signOut() {
  _profile = null;
  resetApi();
}

/** The signed-in person, or null. Never an authorization answer. */
export function profile() { return _profile; }

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
