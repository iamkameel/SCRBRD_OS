// The weather hint (weather-api.mjs): Google's condition types mapped by the
// table, the units, the rounding, the gate, the cache's ten minutes, and what
// goes upstream — against a stubbed fetch. Nothing here calls Google.
import {
  ATTRIBUTION, CACHE_TTL_MS, CONDITIONS, CONDITION_MAP, GOOGLE_BASE,
  mapCondition, roundedPosition, toHint, weatherConfig, weatherRoutes,
} from "./weather-api.mjs";
import { signToken } from "../auth/auth.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {unknown} [d] */
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

// Every WeatherCondition.Type in the discovery document (revision 20260930).
const GOOGLE_TYPES = ["TYPE_UNSPECIFIED", "CLEAR", "MOSTLY_CLEAR", "PARTLY_CLOUDY", "MOSTLY_CLOUDY", "CLOUDY", "WINDY",
  "WIND_AND_RAIN", "LIGHT_RAIN_SHOWERS", "CHANCE_OF_SHOWERS", "SCATTERED_SHOWERS", "RAIN_SHOWERS", "HEAVY_RAIN_SHOWERS",
  "LIGHT_TO_MODERATE_RAIN", "MODERATE_TO_HEAVY_RAIN", "RAIN", "LIGHT_RAIN", "HEAVY_RAIN", "RAIN_PERIODICALLY_HEAVY",
  "LIGHT_SNOW_SHOWERS", "CHANCE_OF_SNOW_SHOWERS", "SCATTERED_SNOW_SHOWERS", "SNOW_SHOWERS", "HEAVY_SNOW_SHOWERS",
  "LIGHT_TO_MODERATE_SNOW", "MODERATE_TO_HEAVY_SNOW", "SNOW", "LIGHT_SNOW", "HEAVY_SNOW", "SNOWSTORM",
  "SNOW_PERIODICALLY_HEAVY", "HEAVY_SNOW_STORM", "BLOWING_SNOW", "RAIN_AND_SNOW", "HAIL", "HAIL_SHOWERS",
  "THUNDERSTORM", "THUNDERSHOWER", "LIGHT_THUNDERSTORM_RAIN", "SCATTERED_THUNDERSTORMS", "HEAVY_THUNDERSTORM"];

console.log("A. The condition table");
ok("every documented Google type is in the table, and nothing else is",
  GOOGLE_TYPES.every((t) => Object.hasOwn(CONDITION_MAP, t)) && Object.keys(CONDITION_MAP).length === GOOGLE_TYPES.length);
ok("every mapped value is one of ours (or null)",
  Object.values(CONDITION_MAP).every((v) => v === null || CONDITIONS.includes(v)));
/** @type {[string, string | null][]} */
const CASES = [
  ["CLEAR", "sunny"], ["MOSTLY_CLEAR", "sunny"], ["PARTLY_CLOUDY", "partly_cloudy"],
  ["MOSTLY_CLOUDY", "overcast"], ["CLOUDY", "overcast"], ["CHANCE_OF_SHOWERS", "overcast"],
  ["WINDY", "windy"], ["WIND_AND_RAIN", "rain"],
  ["LIGHT_RAIN", "drizzle"], ["LIGHT_RAIN_SHOWERS", "drizzle"],
  ["RAIN", "rain"], ["HEAVY_RAIN_SHOWERS", "rain"], ["SCATTERED_SHOWERS", "rain"],
  ["THUNDERSTORM", "storm"], ["SCATTERED_THUNDERSTORMS", "storm"], ["HAIL", "storm"],
  ["LIGHT_SNOW", "drizzle"], ["SNOW", "rain"], ["SNOWSTORM", "storm"], ["BLOWING_SNOW", "storm"],
  ["TYPE_UNSPECIFIED", null],
];
for (const [g, ours] of CASES) ok(`${g} → ${ours}`, mapCondition(g) === ours, mapCondition(g));
ok("a type Google adds later maps to null, not a guess", mapCondition("VOLCANIC_ASH") === null);
ok("a type that is not a string maps to null", mapCondition(undefined) === null && mapCondition(7) === null);
ok("an inherited property name is not a type", mapCondition("constructor") === null && mapCondition("__proto__") === null);
ok("fog: a clear sky under 1 km visibility", mapCondition("CLEAR", 0.4) === "fog" && mapCondition("CLOUDY", 0.9) === "fog");
ok("...and an unknown type under 1 km", mapCondition("TYPE_UNSPECIFIED", 0.2) === "fog");
ok("...but rain or a storm in poor visibility stays rain or a storm",
  mapCondition("RAIN", 0.3) === "rain" && mapCondition("THUNDERSTORM", 0.3) === "storm" && mapCondition("LIGHT_RAIN", 0.3) === "drizzle");
ok("1 km and over is not fog", mapCondition("CLEAR", 1) === "sunny");

console.log("\nB. Google's answer, in our words");
// The shape LookupCurrentConditionsResponse documents, as METRIC.
const GOOGLE = {
  currentTime: "2026-10-02T09:15:00.000Z",
  timeZone: { id: "Africa/Johannesburg" },
  isDaytime: true,
  weatherCondition: { iconBaseUri: "https://maps.gstatic.com/weather/v1/partly_cloudy", description: { text: "Partly cloudy", languageCode: "en" }, type: "PARTLY_CLOUDY" },
  temperature: { degrees: 21.6, unit: "CELSIUS" },
  feelsLikeTemperature: { degrees: 21, unit: "CELSIUS" },
  relativeHumidity: 64,
  uvIndex: 6,
  precipitation: { probability: { percent: 15, type: "RAIN" }, qpf: { quantity: 0, unit: "MILLIMETERS" } },
  thunderstormProbability: 5,
  airPressure: { meanSeaLevelMillibars: 1017.2 },
  wind: { direction: { degrees: 225, cardinal: "SOUTHWEST" }, speed: { value: 14, unit: "KILOMETERS_PER_HOUR" }, gust: { value: 25, unit: "KILOMETERS_PER_HOUR" } },
  visibility: { distance: 16, unit: "KILOMETERS" },
  cloudCover: 40,
};
const h = toHint(GOOGLE);
ok("the mapped hint, whole", JSON.stringify(h) === JSON.stringify({
  condition: "partly_cloudy", temp_c: 22, humidity_pct: 64, wind_kph: 14, wind_dir: "SW",
  rain_chance_pct: 15, observed_at: "2026-10-02T09:15:00.000Z", attribution: "Weather by Google" }), h);
ok("the attribution is Google's words", ATTRIBUTION === "Weather by Google");
const imp = toHint({ ...GOOGLE, temperature: { degrees: 71.6, unit: "FAHRENHEIT" }, wind: { speed: { value: 10, unit: "MILES_PER_HOUR" }, direction: { degrees: 22 } }, visibility: { distance: 0.5, unit: "MILES" } });
ok("Fahrenheit, mph and miles are converted", imp.temp_c === 22 && imp.wind_kph === 16 && imp.condition === "fog", imp);
ok("no cardinal: the direction from degrees", imp.wind_dir === "NNE" && toHint({ wind: { direction: { degrees: 359 } } }).wind_dir === "N");
const bare = toHint({});
ok("an empty answer is all nulls, still attributed",
  Object.entries(bare).every(([k, v]) => (k === "attribution" ? v === ATTRIBUTION : v === null)), bare);
ok("an unparseable time is null", toHint({ currentTime: "yesterday" }).observed_at === null);
ok("percentages are held to 0–100", toHint({ relativeHumidity: 140, precipitation: { probability: { percent: -3 } } }).humidity_pct === 100
  && toHint({ precipitation: { probability: { percent: -3 } } }).rain_chance_pct === 0);
ok("nothing of Google's beyond our fields passes through (no icon, no description)",
  !JSON.stringify(h).includes("gstatic") && !JSON.stringify(h).includes("Partly cloudy"));

console.log("\nC. The position");
ok("rounded to two places", JSON.stringify(roundedPosition({ lat: "-29.60123", lon: "30.37987" })) === JSON.stringify({ lat: -29.6, lon: 30.38 }));
ok("-0 becomes 0", Object.is(roundedPosition({ lat: "-0.001", lon: "0" })?.lat, 0));
ok("the edges are allowed", roundedPosition({ lat: "90", lon: "-180" }) !== null && roundedPosition({ lat: "-90", lon: "180" }) !== null);
for (const [lat, lon] of [["91", "0"], ["-90.5", "0"], ["0", "180.01"], ["0", "-181"], ["", "0"], ["0", ""], ["abc", "0"],
  ["NaN", "0"], ["Infinity", "0"], ["1e2", "0"], ["0x10", "0"], [undefined, "0"]])
  ok(`refused: lat=${lat} lon=${lon}`, roundedPosition({ lat, lon }) === null);

console.log("\nD. The configuration");
ok("unset key: null", weatherConfig({}).key === null && weatherConfig({ GOOGLE_WEATHER_API_KEY: "  " }).key === null);
ok("the key, trimmed", weatherConfig({ GOOGLE_WEATHER_API_KEY: " k " }).key === "k");
ok("Google's host by default", weatherConfig({}).baseUrl === GOOGLE_BASE);
ok("a loopback stub outside production", weatherConfig({ GOOGLE_WEATHER_BASE_URL: "http://127.0.0.1:9999/x" }).baseUrl === "http://127.0.0.1:9999");
ok("never in production", weatherConfig({ NODE_ENV: "production", GOOGLE_WEATHER_BASE_URL: "http://127.0.0.1:9999" }).baseUrl === GOOGLE_BASE);
ok("never another host", weatherConfig({ GOOGLE_WEATHER_BASE_URL: "http://evil.example:80" }).baseUrl === GOOGLE_BASE
  && weatherConfig({ GOOGLE_WEATHER_BASE_URL: "https://127.0.0.1.evil.example" }).baseUrl === GOOGLE_BASE
  && weatherConfig({ GOOGLE_WEATHER_BASE_URL: "not a url" }).baseUrl === GOOGLE_BASE);

console.log("\nE. The route, against a stubbed fetch");
const SECRET = "weather-test-secret";
let clock = 1_790_000_000_000;
const now = () => clock;
const token = (/** @type {string} */ u) => `Bearer ${signToken({ userId: u, deviceId: "d1" }, SECRET, now)}`;
/** @type {{ url: string, headers: Record<string, string> }[]} */
let calls = [];
/** @type {any} */
let reply = { ok: true, status: 200, json: async () => GOOGLE };
/** @type {string[]} */
const logged = [];
/** @type {import("./weather-api.mjs").FetchLike} */
const fetchImpl = async (url, init) => { calls.push({ url, headers: init.headers }); if (reply instanceof Error) throw reply; return reply; };
const KEY = "AIza-test-key-not-real";
const route = weatherRoutes({ secret: SECRET, key: KEY, fetchImpl, now, log: (l) => logged.push(l) });
const q = (/** @type {string} */ lat, /** @type {string} */ lon) => ({ lat, lon });

ok("no token: 401", (await route.hint({ query: q("-29.6", "30.4") })).status === 401 && calls.length === 0);
ok("a forged token: 401", (await route.hint({ query: q("-29.6", "30.4"), authorization: "Bearer a.b.c" })).status === 401);
ok("a pad credential is not a bearer: 401 here (server.mjs answers it 403 pad_scope first)",
  (await route.hint({ query: q("-29.6", "30.4"), authorization: "ScrbrdPad x" })).status === 401);
const bad = await route.hint({ query: q("95", "30.4"), authorization: token("u1") });
ok("out of range: 400 bad_param, nothing sent", bad.status === 400 && /** @type {any} */ (bad.body).error === "bad_param" && calls.length === 0);

const first = await route.hint({ query: q("-29.601234", "30.379876"), authorization: token("u1") });
ok("signed in: 200 and the hint", first.status === 200 && /** @type {any} */ (first.body).condition === "partly_cloudy", first);
ok("one call upstream", calls.length === 1);
const sent = new URL(calls[0].url);
ok("to currentConditions:lookup", sent.origin + sent.pathname === `${GOOGLE_BASE}/v1/currentConditions:lookup`, calls[0].url);
ok("the position rounded to two places", sent.searchParams.get("location.latitude") === "-29.6" && sent.searchParams.get("location.longitude") === "30.38", calls[0].url);
ok("and nothing else but the units: no user, no match, no key in the URL",
  [...sent.searchParams.keys()].sort().join() === "location.latitude,location.longitude,unitsSystem"
  && sent.searchParams.get("unitsSystem") === "METRIC" && !calls[0].url.includes(KEY) && !calls[0].url.includes("u1"));
ok("the key in the header, the only header", calls[0].headers["x-goog-api-key"] === KEY && Object.keys(calls[0].headers).length === 1);

const again = await route.hint({ query: q("-29.6049", "30.3751"), authorization: token("u2") });
ok("the same rounded position within ten minutes: the cache, nobody else's name in it",
  again.status === 200 && calls.length === 1 && JSON.stringify(again.body) === JSON.stringify(first.body));
clock += CACHE_TTL_MS - 1;
await route.hint({ query: q("-29.6", "30.38"), authorization: token("u3") });
ok("...still held a millisecond short of ten minutes", calls.length === 1);
clock += 1;
await route.hint({ query: q("-29.6", "30.38"), authorization: token("u3") });
ok("ten minutes on: asked again", calls.length === 2);
ok("CACHE_TTL_MS is ten minutes or less", CACHE_TTL_MS <= 10 * 60_000);

reply = { ok: false, status: 403, json: async () => ({ error: { message: `API key ${KEY} invalid` } }) };
const refused = await route.hint({ query: q("-30", "31"), authorization: token("u4") });
ok("Google refuses: 502 weather_unavailable", refused.status === 502 && /** @type {any} */ (refused.body).error === "weather_unavailable");
reply = new TypeError("fetch failed");
const down = await route.hint({ query: q("-30.5", "31"), authorization: token("u4") });
ok("Google unreachable: 502", down.status === 502);
ok("a failure is not cached", route.cacheSize() === 1);
ok("the log says what failed and never the key or the position",
  logged.length === 2 && logged.every((l) => !l.includes(KEY) && !l.includes("-30")), logged);

reply = { ok: true, status: 200, json: async () => GOOGLE };
let limited = null;
for (let i = 0; i < 40 && !limited; i++) {
  const r = await route.hint({ query: q("-29.6", "30.38"), authorization: token("busy") });
  if (r.status === 429) limited = { r, i };
}
ok("30 a minute each: the 31st is 429 with Retry-After", limited?.i === 30 && limited.r.headers?.["retry-after"] === "2", limited);
ok("...and somebody else is not held up by it", (await route.hint({ query: q("-29.6", "30.38"), authorization: token("calm") })).status === 200);

const unset = weatherRoutes({ secret: SECRET, key: null, fetchImpl, now });
calls = [];
const off = await unset.hint({ query: q("-29.6", "30.38"), authorization: token("u1") });
ok("no key: 503 weather_unavailable, and nothing sent", off.status === 503 && /** @type {any} */ (off.body).error === "weather_unavailable" && calls.length === 0);
ok("no key: still 401 signed out, 400 on a bad position",
  (await unset.hint({ query: q("-29.6", "30.38") })).status === 401
  && (await unset.hint({ query: q("x", "30.38"), authorization: token("u1") })).status === 400);
ok("configured() says which", route.configured() === true && unset.configured() === false);

console.log(`\nWEATHER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
