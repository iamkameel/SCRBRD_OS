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

/**
 * Rows, as the mock or the API returns them: `any`, like any row.
 * @typedef {(resource: string, params: Record<string, unknown>) => any} MockSource
 *
 * @typedef {object} DataClientOptions
 * @property {string} [apiBase]
 * @property {() => string | null | undefined} [getToken]
 * @property {MockSource} [mockSource]   in practice always given: a read that is not live calls it
 * @property {Record<string, boolean>} [flags]
 * @property {typeof fetch} [fetchImpl]
 * @property {(resource: string, err: unknown) => void} [onError]
 */

/** @param {DataClientOptions} [opts] */
export function createDataClient({
  apiBase,                 // e.g. "https://api.scrbrd.co.za"
  getToken,                // () => current bearer token (or null)
  mockSource,              // (resource, params) => rows   — the existing mock/seed
  flags = {},              // { matches:true, injuries:false, ... } — per-resource live switch
  fetchImpl,               // injectable for tests; defaults to global fetch
  onError,                 // optional (resource, err) => void  (telemetry)
} = {}) {
  const doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);

  /**
   * @param {string} resource @param {Record<string, unknown>} [params]
   * @returns {Promise<any>}  rows
   */
  async function getData(resource, params = {}) {
    // Not flagged live → serve mock unchanged (safe default during rollout).
    // Cast: every caller passes a mockSource; one that did not would throw
    // here, exactly as it always has.
    if (!flags[resource]) return /** @type {MockSource} */ (mockSource)(resource, params);
    if (!doFetch) throw new Error("no fetch implementation available");

    // URLSearchParams stringifies each value; its type only admits strings.
    const qs = new URLSearchParams(/** @type {string[][]} */ (
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    )).toString();
    const url = `${apiBase}/read/${encodeURIComponent(resource)}${qs ? `?${qs}` : ""}`;
    const token = getToken?.();
    /** @type {Record<string, string>} */
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    let res;
    try {
      res = await doFetch(url, { headers });
    } catch (netErr) {
      onError?.(resource, netErr);
      throw netErr;                       // caller decides (retry / offline UI)
    }
    if (!res.ok) {
      const err = /** @type {import("../api-types.mjs").DressedError} */ (new Error(`read_failed_${res.status}`));
      err.status = res.status;
      onError?.(resource, err);
      throw err;                          // do NOT silently fall back to mock — that
                                          // could mask an auth failure with stale data
    }
    const body = await res.json();
    return body.rows ?? body;             // tolerate {rows:[...]} or a bare array
  }

  /**
   * Runtime flip (e.g. from a remote config) without rebuilding the client.
   * @param {string} resource @param {unknown} live
   */
  function setFlag(resource, live) { flags[resource] = !!live; return flags; }
  /** @param {string} resource */
  function isLive(resource) { return !!flags[resource]; }

  return { getData, setFlag, isLive, flags };
}
