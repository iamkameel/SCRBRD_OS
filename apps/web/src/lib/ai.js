/**
 * Client seam for the two AI features.
 *
 * The browser never talks to api.anthropic.com. It calls our own service,
 * which holds the credential — see services/api/ai/ai-service.mjs.
 *
 * Both functions fail soft and return null. Commentary is an enhancement
 * layer over scoring, and school grounds routinely have no usable data
 * connection: nothing on the scoring path may await one of these.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

import { getToken } from "./api.js";
const authHeaders = () => (getToken() ? { authorization: `Bearer ${getToken()}` } : {});

async function post(path, body, { timeoutMs = 8000, headers = {} } = {}) {
  // Without a timeout a stalled connection leaves the UI spinning until the
  // browser gives up, which on a bad ground is minutes.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Natural-language question over data this user is already allowed to see.
 * The question is all that goes: the service builds the data from the read
 * path under this session, so the browser cannot hand the model anything
 * the read path would not. Needs a session; the caller checks signedIn().
 */
export async function askStatGuru(question) {
  const d = await post("/api/ai/statguru", { question }, { headers: authHeaders() });
  return d?.answer ?? null;
}

/**
 * One line of commentary for a delivery, or null. Never blocks scoring.
 * `names` are the people the situation mentions; the service swaps each for a
 * token before the model sees it and back afterwards.
 */
export async function fetchCommentary(situation, names = []) {
  const d = await post("/api/ai/commentary", { situation, names }, { timeoutMs: 5000 });
  return d?.line ?? null;
}
