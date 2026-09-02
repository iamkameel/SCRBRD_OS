/**
 * SCRBRD — this device's identity.
 *
 * A device id is not a convenience. Three things are built on it:
 *
 *   - The scoring lease is held by a (user, device) pair, so the server can
 *     tell "the same scorer, still going" from "a second phone that has picked
 *     up the same login".
 *   - Every event id begins with it, which is what lets two devices score the
 *     same match without their ids colliding.
 *   - The session token is signed to it, so a token lifted off one device
 *     cannot be used to write from another.
 *
 * All three break if the id changes, so it is minted once and kept.
 *
 * Deliberately localStorage rather than IndexedDB, which the rest of lib/ uses:
 * this value has to be readable SYNCHRONOUSLY, before the first event can be
 * stamped, and it is a single short string written once in the device's life —
 * the blocking-write cost that rules localStorage out for the ball log does not
 * apply to it. If storage is unavailable (private mode, blocked cookies) the id
 * is still generated, and lasts as long as the tab: scoring keeps working, and
 * what is lost is continuity across reloads rather than the match.
 */

const KEY = "scrbrd:device-id";
let cached = null;

function mint() {
  // crypto.randomUUID is not available on http:// origins in some browsers,
  // which includes a scorer connecting to a laptop on the ground's wifi.
  try {
    if (globalThis.crypto?.randomUUID) return `dev-${crypto.randomUUID()}`;
  } catch { /* fall through */ }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** This device's stable id. Same value for the life of the browser profile. */
export function deviceId() {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) { cached = stored; return cached; }
    cached = mint();
    localStorage.setItem(KEY, cached);
  } catch {
    cached = mint();   // no storage: stable for this tab, which is enough to score
  }
  return cached;
}

/**
 * Forget this device. Only for signing out on a shared school device, where
 * the next person must not inherit the previous scorer's lease.
 */
export function forgetDevice() {
  cached = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}
