/**
 * SCRBRD — the browser's seam onto the API.
 *
 * One place that knows the base URL, carries the session token, and turns a
 * non-2xx response into a thrown error. Everything else in the client goes
 * through here, so there is exactly one answer to "are we signed in?" and one
 * place a 401 is noticed.
 *
 * TWO MODES, AND WHY THE DIFFERENCE IS LOUD
 * ─────────────────────────────────────────
 * SCRBRD is both a running product and a demo that has to open on a laptop
 * with no backend. So the client can run in DEMO mode against mock data, and
 * that is legitimate — but it must never be mistaken for the real thing.
 *
 * The rule here is that demo mode is a deliberate state the app enters when no
 * API is configured or reachable, is reported through `apiStatus()`, and is
 * shown in the UI. What must never happen is a signed-in-looking session that
 * silently fell back to mock auth after the real one failed: that is a person
 * believing a permission decision was made when none was. A failed login
 * against a live API is a failed login.
 *
 * Nothing on the scoring path awaits this module. Scoring works with the
 * network down; sync is what needs it.
 */

// `window.__SCRBRD_API_BASE__` lets a test point a BUILT bundle at a server on
// an arbitrary port without rebuilding it. It is read once, at module load,
// and only as a fallback behind the build-time variable — so a deployed build
// with VITE_API_BASE set cannot be redirected by anything on the page.
const BASE = import.meta.env.VITE_API_BASE
  ?? (typeof window !== "undefined" ? window.__SCRBRD_API_BASE__ : null)
  ?? "http://localhost:8787";

// Token in module scope, not localStorage: a bearer token in storage is
// readable by any script that gets injected into the page, and this one is
// bound to a device and a person who can score. It is deliberately lost on
// reload — the session restore path signs in again rather than resurrecting a
// credential. What survives a reload is the ball log, which is the part that
// cannot be regenerated.
let _token = null;
let _reachable = null;   // null = not yet asked

export function setToken(t) { _token = t || null; }
export function getToken() { return _token; }
export function signedIn() { return _token != null; }

export class ApiError extends Error {
  constructor(status, code, path) {
    super(`${code || "http_" + status} (${path})`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * One request. Throws ApiError on a non-2xx so callers cannot accidentally
 * treat a refusal as data — the read path in particular must never fall back
 * to mock rows when the server said no, because "no" is an authorization
 * answer and mock rows are not scoped to anybody.
 */
export async function api(path, { method = "GET", body, timeoutMs = 10000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(_token ? { authorization: `Bearer ${_token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.error, path);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is there an API behind this build at all?
 *
 * Asked once and remembered. A ground with no signal is NOT the same question:
 * this decides whether the app is a demo or a client, and that does not change
 * when a phone loses reception mid-over.
 */
export async function apiStatus() {
  if (_reachable !== null) return _reachable;
  try {
    const h = await api("/api/health", { timeoutMs: 3000 });
    _reachable = { live: !!h?.ok, health: h };
  } catch {
    _reachable = { live: false, health: null };
  }
  return _reachable;
}

/** For tests and for signing out on a shared device. */
export function resetApi() { _token = null; _reachable = null; }

export const apiBase = () => BASE;
