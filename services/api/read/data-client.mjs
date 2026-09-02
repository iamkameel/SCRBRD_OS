/**
 * SCRBRD — Client data accessor (Step 3)
 *
 * The seam the whole frontend already reads through. Today every view calls
 * getData(resource) and gets mock data. This wraps that call so each resource
 * can be flipped to the live API independently, module by module, with the rest
 * still on mock. Views don't change — only the source behind getData does.
 *
 * The client does NO RBAC: the API already returns rows the caller may see,
 * with PII columns nulled. The client just renders what it gets.
 */

export function createDataClient({
  apiBase,                 // e.g. "https://api.scrbrd.co.za"
  getToken,                // () => current bearer token (or null)
  mockSource,              // (resource, params) => rows   — the existing mock/seed
  flags = {},              // { matches:true, injuries:false, ... } — per-resource live switch
  fetchImpl,               // injectable for tests; defaults to global fetch
  onError,                 // optional (resource, err) => void  (telemetry)
} = {}) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);

  async function getData(resource, params = {}) {
    // Not flagged live → serve mock unchanged (safe default during rollout).
    if (!flags[resource]) return mockSource(resource, params);
    if (!doFetch) throw new Error("no fetch implementation available");

    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    const url = `${apiBase}/read/${encodeURIComponent(resource)}${qs ? `?${qs}` : ""}`;
    const token = getToken?.();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    let res;
    try {
      res = await doFetch(url, { headers });
    } catch (netErr) {
      onError?.(resource, netErr);
      throw netErr;                       // caller decides (retry / offline UI)
    }
    if (!res.ok) {
      const err = new Error(`read_failed_${res.status}`);
      err.status = res.status;
      onError?.(resource, err);
      throw err;                          // do NOT silently fall back to mock — that
                                          // could mask an auth failure with stale data
    }
    const body = await res.json();
    return body.rows ?? body;             // tolerate {rows:[...]} or a bare array
  }

  /** Runtime flip (e.g. from a remote config) without rebuilding the client. */
  function setFlag(resource, live) { flags[resource] = !!live; return flags; }
  function isLive(resource) { return !!flags[resource]; }

  return { getData, setFlag, isLive, flags };
}
