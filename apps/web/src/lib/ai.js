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

async function post(path, body, { timeoutMs = 8000 } = {}) {
  // Without a timeout a stalled connection leaves the UI spinning until the
  // browser gives up, which on a bad ground is minutes.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

/** Natural-language question over data this user is already allowed to see. */
export async function askStatGuru(question, context) {
  const d = await post("/api/ai/statguru", { question, context });
  return d?.answer ?? null;
}

/** One line of commentary for a delivery, or null. Never blocks scoring. */
export async function fetchCommentary(situation) {
  const d = await post("/api/ai/commentary", { situation }, { timeoutMs: 5000 });
  return d?.line ?? null;
}
