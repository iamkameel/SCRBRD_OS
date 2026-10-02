/**
 * A live weather hint for Practice Match, from our own API's
 * GET /api/weather/hint (services/api/weather/weather-api.mjs), which asks
 * Google. The browser never talks to Google and never holds its key.
 *
 * A HINT: it may prefill the scorer's choice, never stand in for it. The
 * match's weather is what the scorer records (POST /api/matches/:id/weather).
 * Anything shown from it carries `attribution` ("Weather by Google").
 *
 * Resolves null on any failure — signed out, offline, the key unset on the
 * server (503), Google down (502), a slow answer, a reply in a shape we do not
 * know — and the screen falls back to the scorer's buttons. Never throws.
 * The position is rounded to two places before it leaves the device.
 */
import { apiBase, getToken } from "./api.js";

export const WEATHER_CONDITIONS = Object.freeze(["sunny", "partly_cloudy", "overcast", "drizzle", "rain", "storm", "fog", "windy"]);
export const HINT_TIMEOUT_MS = 6000;

/**
 * A coordinate as it leaves the device: two decimal places (about a kilometre),
 * as text. `+ 0` turns -0 into 0 so -0.001 reads "0.00", as the server's own
 * rounding does (services/api/weather/weather-api.mjs roundedPosition).
 * @param {number} x
 */
export const roundedCoord = (x) => (Math.round(x * 100) / 100 + 0).toFixed(2);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" ? v : null);

/**
 * @param {number} lat
 * @param {number} lon
 * @param {{ fetchImpl?: typeof fetch, base?: string, token?: string | null,
 *           online?: boolean, timeoutMs?: number }} [deps]  injected by the test
 * @returns {Promise<null | { condition: string | null, temp_c: number | null, humidity_pct: number | null,
 *   wind_kph: number | null, wind_dir: string | null, rain_chance_pct: number | null,
 *   observed_at: string | null, attribution: string }>}
 */
export async function getWeatherHint(lat, lon, deps = {}) {
  const {
    fetchImpl = globalThis.fetch,
    base = apiBase(),
    token = getToken(),
    online = typeof navigator === "undefined" ? true : navigator.onLine !== false,
    timeoutMs = HINT_TIMEOUT_MS,
  } = deps;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!token || !online || typeof fetchImpl !== "function") return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/api/weather/hint?lat=${roundedCoord(lat)}&lon=${roundedCoord(lon)}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: ctl.signal,
    });
    if (!res?.ok) return null;
    const d = await res.json();
    const attribution = str(d?.attribution);
    if (!attribution) return null;
    const condition = WEATHER_CONDITIONS.includes(d.condition) ? d.condition : null;
    return {
      condition,
      temp_c: num(d.temp_c),
      humidity_pct: num(d.humidity_pct),
      wind_kph: num(d.wind_kph),
      wind_dir: str(d.wind_dir),
      rain_chance_pct: num(d.rain_chance_pct),
      observed_at: str(d.observed_at),
      attribution,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
