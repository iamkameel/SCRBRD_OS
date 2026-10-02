/**
 * A live weather hint, from Google's Weather API (Kameel, 2026-10-02, for
 * Practice Match).
 *
 *   GET /api/weather/hint?lat=<deg>&lon=<deg>
 *
 * A HINT, NEVER A RECORD. The match's weather is the scorer's own observation
 * (match_weather, POST /api/matches/:id/weather); this route writes nothing
 * there or anywhere else in the database. Google's terms allow the data to be
 * cached only briefly and require attribution, so the one copy kept is an
 * in-process cache keyed on the rounded position, at most CACHE_TTL_MS old,
 * and every answer says "Weather by Google".
 *
 * WHAT GOES TO GOOGLE: the position, rounded to two decimal places (about a
 * kilometre), and nothing else — no name, no match, no user. The key goes in
 * the X-Goog-Api-Key header, so it is in no URL that anything could log.
 *
 * WHO: any signed-in principal, limited per person (RATE). A pad's resume
 * credential never arrives here — server.mjs answers it 403 pad_scope before
 * any route that is not one of its five.
 *
 * WITHOUT GOOGLE_WEATHER_API_KEY the route answers 503 weather_unavailable,
 * and the app falls back to the scorer's buttons. Tests and walks run with it
 * unset, or against a stub (fetchImpl here; a loopback base URL across a
 * process boundary — weatherConfig() below); nothing in the suite calls Google.
 *
 * The response's source: Google's discovery document for Weather API v1,
 * https://weather.googleapis.com/$discovery/rest?version=v1 (revision
 * 20260930) — currentConditions.lookup, LookupCurrentConditionsResponse,
 * WeatherCondition.Type and the unit enums. Human-readable reference:
 * https://developers.google.com/maps/documentation/weather/reference/rest/v1/currentConditions/lookup
 */
import { RateLimit } from "../public/public-api.mjs";
import { principalFromClaims, verifyToken } from "../auth/auth.mjs";

export const ATTRIBUTION = "Weather by Google";
export const GOOGLE_BASE = "https://weather.googleapis.com";
/** Google's terms: brief caching only. Ten minutes is the ceiling, not a target. */
export const CACHE_TTL_MS = 10 * 60_000;
/** Positions remembered at once; a pilot uses a handful of grounds. */
export const CACHE_MAX = 500;
export const RATE = Object.freeze({ perMinute: 30, burst: 30 });
export const UPSTREAM_TIMEOUT_MS = 5_000;

/** Our vocabulary, the scorer's buttons. */
export const CONDITIONS = Object.freeze(["sunny", "partly_cloudy", "overcast", "drizzle", "rain", "storm", "fog", "windy"]);

/**
 * Google's WeatherCondition.Type → ours, every documented value named. A type
 * Google adds later (its documentation warns that codes change) is not here,
 * and maps to null: the hint then carries no condition and the scorer picks.
 *
 * Choices worth saying: CHANCE_OF_SHOWERS is not rain falling now, so it is
 * overcast. Snow is not on the scorer's buttons (it is not unknown in the
 * Midlands); light snow is drizzle, snow is rain, and a snowstorm or blowing
 * snow is a storm — play is off in all of them, which is what the hint is for.
 * Hail in KwaZulu-Natal comes with thunder: storm. Fog has no Google type; it
 * is read from visibility instead (fogFrom()).
 * @type {Readonly<Record<string, string | null>>}
 */
export const CONDITION_MAP = Object.freeze({
  TYPE_UNSPECIFIED: null,
  CLEAR: "sunny",
  MOSTLY_CLEAR: "sunny",
  PARTLY_CLOUDY: "partly_cloudy",
  MOSTLY_CLOUDY: "overcast",
  CLOUDY: "overcast",
  WINDY: "windy",
  WIND_AND_RAIN: "rain",
  LIGHT_RAIN_SHOWERS: "drizzle",
  CHANCE_OF_SHOWERS: "overcast",
  SCATTERED_SHOWERS: "rain",
  RAIN_SHOWERS: "rain",
  HEAVY_RAIN_SHOWERS: "rain",
  LIGHT_TO_MODERATE_RAIN: "rain",
  MODERATE_TO_HEAVY_RAIN: "rain",
  RAIN: "rain",
  LIGHT_RAIN: "drizzle",
  HEAVY_RAIN: "rain",
  RAIN_PERIODICALLY_HEAVY: "rain",
  LIGHT_SNOW_SHOWERS: "drizzle",
  CHANCE_OF_SNOW_SHOWERS: "overcast",
  SCATTERED_SNOW_SHOWERS: "rain",
  SNOW_SHOWERS: "rain",
  HEAVY_SNOW_SHOWERS: "rain",
  LIGHT_TO_MODERATE_SNOW: "rain",
  MODERATE_TO_HEAVY_SNOW: "rain",
  SNOW: "rain",
  LIGHT_SNOW: "drizzle",
  HEAVY_SNOW: "rain",
  SNOWSTORM: "storm",
  SNOW_PERIODICALLY_HEAVY: "rain",
  HEAVY_SNOW_STORM: "storm",
  BLOWING_SNOW: "storm",
  RAIN_AND_SNOW: "rain",
  HAIL: "storm",
  HAIL_SHOWERS: "storm",
  THUNDERSTORM: "storm",
  THUNDERSHOWER: "storm",
  LIGHT_THUNDERSTORM_RAIN: "storm",
  SCATTERED_THUNDERSTORMS: "storm",
  HEAVY_THUNDERSTORM: "storm",
});

/** WindDirection.Cardinal → the abbreviation match_weather.wind_dir holds ("SW"). */
const CARDINAL = Object.freeze({
  NORTH: "N", NORTH_NORTHEAST: "NNE", NORTHEAST: "NE", EAST_NORTHEAST: "ENE",
  EAST: "E", EAST_SOUTHEAST: "ESE", SOUTHEAST: "SE", SOUTH_SOUTHEAST: "SSE",
  SOUTH: "S", SOUTH_SOUTHWEST: "SSW", SOUTHWEST: "SW", WEST_SOUTHWEST: "WSW",
  WEST: "W", WEST_NORTHWEST: "WNW", NORTHWEST: "NW", NORTH_NORTHWEST: "NNW",
});
const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** Fog by the meteorological definition: visibility under a kilometre. */
export const FOG_BELOW_KM = 1;

/** @param {unknown} v */
const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** @param {number | null} v */
const whole = (v) => (v == null ? null : Math.round(v));
/** @param {number | null} v */
const pct = (v) => (v == null ? null : Math.min(100, Math.max(0, Math.round(v))));

/**
 * Google's condition type, and the visibility, to one of CONDITIONS or null.
 * Fog wins only over a dry sky: rain or a storm in poor visibility is still
 * rain or a storm.
 * @param {unknown} type
 * @param {number | null} [visibilityKm]
 * @returns {string | null}
 */
export function mapCondition(type, visibilityKm = null) {
  const mapped = typeof type === "string" && Object.hasOwn(CONDITION_MAP, type) ? CONDITION_MAP[type] : null;
  const dry = mapped == null || mapped === "sunny" || mapped === "partly_cloudy" || mapped === "overcast";
  if (dry && visibilityKm != null && visibilityKm < FOG_BELOW_KM) return "fog";
  return mapped;
}

/**
 * LookupCurrentConditionsResponse → our hint. Every field Google leaves out is
 * null; units are converted in case the answer is not the METRIC we asked for.
 * @param {any} g  Google's JSON, as received
 */
export function toHint(g) {
  const t = finite(g?.temperature?.degrees);
  const tempC = t == null ? null : (g.temperature.unit === "FAHRENHEIT" ? (t - 32) * 5 / 9 : t);
  const w = finite(g?.wind?.speed?.value);
  const windKph = w == null ? null : (g.wind.speed.unit === "MILES_PER_HOUR" ? w * 1.609344 : w);
  const v = finite(g?.visibility?.distance);
  const visKm = v == null ? null : (g.visibility.unit === "MILES" ? v * 1.609344 : v);
  const deg = finite(g?.wind?.direction?.degrees);
  const cardinal = g?.wind?.direction?.cardinal;
  const windDir = (typeof cardinal === "string" && Object.hasOwn(CARDINAL, cardinal))
    ? CARDINAL[/** @type {keyof typeof CARDINAL} */ (cardinal)]
    : (deg == null ? null : POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]);
  const at = typeof g?.currentTime === "string" && !Number.isNaN(Date.parse(g.currentTime)) ? g.currentTime : null;
  return {
    condition: mapCondition(g?.weatherCondition?.type, visKm),
    temp_c: whole(tempC),
    humidity_pct: pct(finite(g?.relativeHumidity)),
    wind_kph: whole(windKph),
    wind_dir: windDir,
    rain_chance_pct: pct(finite(g?.precipitation?.probability?.percent)),
    observed_at: at,
    attribution: ATTRIBUTION,
  };
}

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * The query's lat and lon, checked and rounded to two places, or null.
 * Two places is about a kilometre: enough for the weather, not enough to say
 * which house.
 * @param {Record<string, unknown>} query
 * @returns {{ lat: number, lon: number } | null}
 */
export function roundedPosition(query) {
  const lat = typeof query?.lat === "string" && DECIMAL.test(query.lat.trim()) ? Number(query.lat) : NaN;
  const lon = typeof query?.lon === "string" && DECIMAL.test(query.lon.trim()) ? Number(query.lon) : NaN;
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) return null;
  // + 0 turns -0 into 0, so -0.001 and 0.001 share a cache entry and a URL.
  const r = (/** @type {number} */ x) => Math.round(x * 100) / 100 + 0;
  return { lat: r(lat), lon: r(lon) };
}

/**
 * The route's configuration from the environment. The key is read here and
 * nowhere else. GOOGLE_WEATHER_BASE_URL exists for the API walk's stub, and
 * is honoured only outside production and only for a loopback address — so
 * no setting can send the key to another host.
 * @param {Record<string, string | undefined>} env
 * @returns {{ key: string | null, baseUrl: string }}
 */
export function weatherConfig(env) {
  const key = (env.GOOGLE_WEATHER_API_KEY ?? "").trim() || null;
  let baseUrl = GOOGLE_BASE;
  const override = env.GOOGLE_WEATHER_BASE_URL;
  if (override && env.NODE_ENV !== "production") {
    try {
      const u = new URL(override);
      if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) baseUrl = u.origin;
    } catch { /* not a URL: Google's */ }
  }
  return { key, baseUrl };
}

/**
 * @typedef {ReturnType<typeof toHint>} Hint
 * @typedef {{ status: number, body: unknown, headers?: Record<string, string> }} Answer
 * @typedef {(url: string, init: { headers: Record<string, string>, signal?: AbortSignal }) =>
 *   Promise<{ ok: boolean, status: number, json: () => Promise<unknown> }>} FetchLike
 */

/**
 * @param {{ secret: string, key: string | null, baseUrl?: string, fetchImpl?: FetchLike,
 *           now?: () => number, log?: (line: string) => void }} opts
 */
export function weatherRoutes({ secret, key, baseUrl = GOOGLE_BASE, fetchImpl = globalThis.fetch, now = Date.now, log = console.error }) {
  const limit = new RateLimit(now, RATE);
  /** @type {Map<string, { at: number, hint: Hint }>} */
  const cache = new Map();

  /** @param {string} k @param {Hint} hint */
  const remember = (k, hint) => {
    const t = now();
    if (cache.size >= CACHE_MAX) {
      for (const [ck, e] of cache) if (t - e.at >= CACHE_TTL_MS) cache.delete(ck);
      // Still full: the oldest goes (a Map iterates in insertion order).
      if (cache.size >= CACHE_MAX) cache.delete(/** @type {string} */ (cache.keys().next().value));
    }
    cache.delete(k);
    cache.set(k, { at: t, hint });
  };

  return {
    configured: () => key != null,
    /** For the unit test: how many positions are held. */
    cacheSize: () => cache.size,

    /**
     * GET /api/weather/hint
     * @param {{ query: Record<string, unknown>, authorization?: string }} req
     * @returns {Promise<Answer>}
     */
    async hint({ query, authorization }) {
      const bearer = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
      if (!bearer) return { status: 401, body: { error: "missing_token" } };
      let userId;
      try { userId = principalFromClaims(verifyToken(bearer, secret, now)).userId; }
      catch (/** @type {any} */ e) { return { status: 401, body: { error: e?.code || "unauthorized" } }; }
      if (!userId) return { status: 401, body: { error: "unauthorized" } };

      const wait = limit.take(userId);
      if (wait) return { status: 429, body: { error: "rate_limited" }, headers: { "retry-after": String(wait) } };

      const pos = roundedPosition(query);
      if (!pos) return { status: 400, body: { error: "bad_param" } };
      if (!key) return { status: 503, body: { error: "weather_unavailable" } };

      const ck = `${pos.lat},${pos.lon}`;
      const held = cache.get(ck);
      if (held && now() - held.at < CACHE_TTL_MS) return { status: 200, body: held.hint };

      const url = `${baseUrl}/v1/currentConditions:lookup?location.latitude=${pos.lat}&location.longitude=${pos.lon}&unitsSystem=METRIC`;
      let g;
      try {
        const res = await fetchImpl(url, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        if (!res.ok) {
          // The status only: never the URL, the headers or Google's body.
          log(`weather: upstream answered ${res.status}`);
          return { status: 502, body: { error: "weather_unavailable" } };
        }
        g = await res.json();
      } catch (/** @type {any} */ e) {
        log(`weather: upstream unreachable (${e?.name || "error"})`);
        return { status: 502, body: { error: "weather_unavailable" } };
      }
      const hint = toHint(g);
      remember(ck, hint);
      return { status: 200, body: hint };
    },
  };
}
