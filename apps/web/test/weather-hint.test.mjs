// The client's weather hint (lib/weatherHint.js): our route only, the
// position rounded before it leaves, the token as a bearer, and null on every
// failure. A mocked fetch; nothing here reaches a network.
import { getWeatherHint, WEATHER_CONDITIONS } from "../src/lib/weatherHint.js";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${typeof d === "string" ? d : JSON.stringify(d)}`}`); if (c) pass++; else fail++; };

const HINT = { condition: "partly_cloudy", temp_c: 22, humidity_pct: 64, wind_kph: 14, wind_dir: "SW",
  rain_chance_pct: 15, observed_at: "2026-10-02T09:15:00.000Z", attribution: "Weather by Google" };
const calls = [];
const answer = (status, body) => async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
const deps = (fetchImpl, more = {}) => ({ fetchImpl, base: "https://api.test", token: "tok", online: true, ...more });

console.log("A. A good answer");
const h = await getWeatherHint(-29.601234, 30.379876, deps(answer(200, HINT)));
ok("the hint, as the route sent it", JSON.stringify(h) === JSON.stringify(HINT), h);
ok("our route, the position rounded to two places", calls[0].url === "https://api.test/api/weather/hint?lat=-29.60&lon=30.38", calls[0].url);
ok("the session token as a bearer, and no-store", calls[0].init.headers.authorization === "Bearer tok" && calls[0].init.cache === "no-store");
ok("the vocabulary is the route's eight", WEATHER_CONDITIONS.join() === "sunny,partly_cloudy,overcast,drizzle,rain,storm,fog,windy");
const odd = await getWeatherHint(-29.6, 30.4, deps(answer(200, { ...HINT, condition: "volcanic", temp_c: "hot", extra: "x" })));
ok("an unknown condition is null and a non-number is null; nothing extra passes",
  odd?.condition === null && odd.temp_c === null && !("extra" in odd) && odd.attribution === "Weather by Google", odd);

console.log("\nB. Null, never a throw");
const n = calls.length;
ok("503: the key is unset on the server", (await getWeatherHint(-29.6, 30.4, deps(answer(503, { error: "weather_unavailable" })))) === null);
ok("502: Google down", (await getWeatherHint(-29.6, 30.4, deps(answer(502, { error: "weather_unavailable" })))) === null);
ok("401 and 429", (await getWeatherHint(-29.6, 30.4, deps(answer(401, {})))) === null && (await getWeatherHint(-29.6, 30.4, deps(answer(429, {})))) === null);
ok("fetch throws (offline mid-request)", (await getWeatherHint(-29.6, 30.4, deps(async () => { throw new TypeError("Failed to fetch"); }))) === null);
ok("a body that is not JSON", (await getWeatherHint(-29.6, 30.4, deps(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } })))) === null);
ok("an answer without the attribution is not shown", (await getWeatherHint(-29.6, 30.4, deps(answer(200, { ...HINT, attribution: undefined })))) === null);
const slow = getWeatherHint(-29.6, 30.4, deps((url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))), { timeoutMs: 20 }));
ok("a slow answer is abandoned", (await slow) === null);
const before = calls.length;
ok("offline: null without asking", (await getWeatherHint(-29.6, 30.4, deps(answer(200, HINT), { online: false }))) === null);
ok("signed out: null without asking", (await getWeatherHint(-29.6, 30.4, deps(answer(200, HINT), { token: null }))) === null);
ok("a bad position: null without asking",
  (await getWeatherHint(NaN, 30.4, deps(answer(200, HINT)))) === null
  && (await getWeatherHint(-91, 30.4, deps(answer(200, HINT)))) === null
  && (await getWeatherHint(-29.6, 181, deps(answer(200, HINT)))) === null);
ok("...none of those reached fetch", calls.length === before, calls.length - before);
ok("no fetch at all: null", (await getWeatherHint(-29.6, 30.4, deps(undefined, { fetchImpl: null }))) === null);
ok("the refusals above each asked once", calls.length - n === 5, calls.length - n);

console.log(`\nWEATHER-HINT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
