/**
 * Weather: when it was observed, and what kind of reading it is (GA-I18).
 *
 * The adapter dropped the manual observation's time, so yesterday's reading
 * read as this morning's; the provider's hint ran together with the scorer's
 * observation. Held here: the time is kept and shown, a hint is introduced as
 * a hint, and nothing is borrowed (a fixture with no row shows no weather, a
 * hint kept for one ground is dropped when the position moves).
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/weather-stamp.test.mjs
 */
import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { asWeather } from "../src/lib/live.js";
import { observedStamp, hintStamp, STALE_AFTER_MS, HINT_STALE_AFTER_MS } from "../src/lib/weatherStamp.js";
import { dropHint, applyHint, chooseCondition, WEATHER_SOURCE } from "../src/lib/practice.js";
import { WeatherChip } from "../src/views/shared.jsx";
import { weatherWords } from "../src/lib/cockpit.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (t) => console.log("\n" + t);

// 09:15 SA (UTC+2) on Saturday 3 Oct 2026.
const OBS = "2026-10-03T07:15:00.000Z";
const NOON = Date.parse("2026-10-03T10:00:00Z");          // 12:00 SA, the same day
const row = (over) => ({ match_id: "m1", condition: "Overcast", temp_c: 18, humidity_pct: 70, wind_kph: 14, wind_dir: "SW",
  uv_index: null, rain_chance_pct: 30, forecast: null, playable: true, observed_at: OBS, ...over });

group("The adapter keeps the manual observation's time");
const w = asWeather(row({}));
ok("observedAt is the row's observed_at, untouched", w.observedAt === OBS, w);
ok("the rest of the row is as it was", w.matchId === "m1" && w.condition === "Overcast" && w.tempC === 18 && w.playable === true && w.live === true);
ok("a row with no time carries null, never now", asWeather(row({ observed_at: null })).observedAt === null && asWeather(row({ observed_at: undefined })).observedAt === null);
ok("a time that came back as a Date is kept as an instant", asWeather(row({ observed_at: new Date(OBS) })).observedAt === new Date(OBS).toString() || Number.isFinite(Date.parse(asWeather(row({ observed_at: new Date(OBS) })).observedAt)));

group("It is shown, on the SA clock");
ok("the same day: the time alone", observedStamp(w, { now: NOON })?.text === "Observed 09:15", observedStamp(w, { now: NOON }));
ok("another day: the date too", observedStamp(w, { now: NOON + 24 * 3600e3, status: "complete" })?.text === "Observed 3 Oct, 09:15");
ok("the clock is SA's, not the machine's: 22:30 UTC is 00:30 the next day there", observedStamp(asWeather(row({ observed_at: "2026-10-03T22:30:00Z" })), { now: Date.parse("2026-10-04T10:00:00Z"), status: "complete" })?.text === "Observed 00:30");
ok("no time on the row: it says so, and does not guess", observedStamp(asWeather(row({ observed_at: null })), { now: NOON })?.text === "Time of observation not recorded");
ok("a garbage time is the same as none", observedStamp({ live: true, observedAt: "yesterday" }, { now: NOON })?.text === "Time of observation not recorded");
ok("a demonstration row was never observed by anyone: no stamp", observedStamp({ condition: "Clear", tempC: 24, playable: true }, { now: NOON }) === null);
ok("no row, no stamp", observedStamp(null) === null && observedStamp(undefined) === null);

group("Old is said, for a match still to come");
const old = Date.parse(OBS) + STALE_AFTER_MS + 60e3;
ok("past six hours, for an upcoming fixture: flagged", (() => { const s = observedStamp(w, { now: old, status: "upcoming" }); return s.stale === true && /may be out of date/.test(s.text); })());
ok("exactly six hours is not yet old", observedStamp(w, { now: Date.parse(OBS) + STALE_AFTER_MS, status: "upcoming" }).stale === false);
ok("a finished match's reading is its record, never 'out of date'", observedStamp(w, { now: old + 9 * 86400e3, status: "complete" }).stale === false && !/out of date/.test(observedStamp(w, { now: old, status: "complete" }).text));
ok("a live match's reading older than six hours is flagged", observedStamp(w, { now: old, status: "live" }).stale === true);

group("The provider's hint is a hint");
const HINT = { condition: "overcast", temp_c: 18, observed_at: "2026-10-03T07:00:00.000Z", attribution: "Weather by Google" };
const hs = hintStamp(HINT, NOON);
ok("introduced as a hint, not the match's record", /^Weather hint, not the match's record$/.test(hs.lead), hs);
ok("with the provider's own time", hs.asOf === "as of 09:00" && hs.stale === false, hs);
ok("an old reading says so", hintStamp(HINT, Date.parse(HINT.observed_at) + HINT_STALE_AFTER_MS + 60e3).asOf.endsWith(", an old reading"));
ok("no time from the provider: no time claimed", hintStamp({ attribution: "x" }, NOON).asOf === null && hintStamp(null, NOON).asOf === null);
const pr = readFileSync(new URL("../src/scorer/practice.jsx", import.meta.url), "utf8");
ok("Practice shows its hint through that label in both places (the setup and the sheet)", (pr.match(/hintLine\(/g) ?? []).length >= 3 && !/`Now: /.test(pr));

group("Nothing is borrowed");
// A hint read for one ground does not stay on screen under another.
const OBSERVED = { condition: "overcast", playable: true, observation: { conditions: "overcast", source: WEATHER_SOURCE, edited_by_scorer: false, attribution: "Weather by Google", captured_at: HINT.observed_at, temperature_c: 18 } };
ok("the venue moved: a hint the scorer never touched goes, with the condition only it had filled in", (() => { const d = dropHint(OBSERVED); return d.condition === null && d.observation === null; })());
ok("...but what the scorer chose is his, and stays as his own manual observation", (() => {
  const edited = chooseCondition(OBSERVED, "rain");
  const d = dropHint(edited);
  return d.condition === "rain" && d.observation.source === "manual" && d.observation.attribution === null && d.observation.temperature_c === null;
})());
ok("a manual observation is not a hint and is left alone", (() => { const m = chooseCondition({ condition: null, playable: null }, "sunny"); return dropHint(m) === m; })());
ok("no weather at all is left alone", (() => { const e = { condition: null, playable: null }; return dropHint(e) === e; })());
ok("the new place's hint then fills in the empty weather", (() => { const d = applyHint(dropHint(OBSERVED), { ...HINT, condition: "rain", temp_c: 11, humidity_pct: null, wind_kph: null, wind_dir: null, rain_chance_pct: null }); return d.condition === "rain" && d.observation.temperature_c === 11; })());
ok("Practice drops the hint when its position changes, and asks again", /hintAt\.current === here/.test(pr) && /dropHint\(d\.weather\)/.test(pr));

// A fixture's weather is its own row. No row is no reading.
const lv = readFileSync(new URL("../src/lib/live.js", import.meta.url), "utf8");
ok("weather is keyed by match id, with no fallback to another match's row", /Object\.fromEntries\(rows\.map\(\(w\) => \[w\.matchId, w\]\)\)/.test(lv));
const consumers = ["MatchCentreView", "LeagueView", "DashboardView", "CalendarView", "LogisticsView", "matchcentre/MatchView"];
ok("every consumer reads WEATHER[<this fixture's id>] and no other key", consumers.every((f) => {
  const s = readFileSync(new URL(`../src/views/${f}.jsx`, import.meta.url), "utf8");
  return [...s.matchAll(/WEATHER\[([^\]]+)\]/g)].every((m) => /^(m|match|next|selMatch|ev)\.id$/.test(m[1].trim()));
}));
ok("a fixture with no reading shows nothing: the chip is null for none", renderToStaticMarkup(h(WeatherChip, { w: null })) === "");

group("What the chip draws");
const chip = renderToStaticMarkup(h(WeatherChip, { w: asWeather(row({ temp_c: null, humidity_pct: null, wind_kph: null, wind_dir: null, rain_chance_pct: null })), status: "upcoming" }));
ok("a condition with no temperature does not print '°C', 'null' or 'undefined'", !/°C/.test(chip) && !/null|undefined|NaN/.test(chip), chip.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
ok("...and draws no empty tiles", !/Humidity|Wind|Rain|UV/.test(chip));
const full = renderToStaticMarkup(h(WeatherChip, { w: { ...asWeather(row({})), observedAt: "2026-10-03T07:15:00.000Z" }, status: "complete" }));
const text = full.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
ok("a full reading shows its numbers and when it was observed", /18°C/.test(text) && /Wind/.test(text) && /14 km\/h SW/.test(text) && /data-testid="weather-observed"/.test(full) && /Observed 3 Oct, 09:15|Observed \d\d:\d\d/.test(text), text);
const stale = renderToStaticMarkup(h(WeatherChip, { w: asWeather(row({ observed_at: new Date(Date.now() - 30 * 3600e3).toISOString() })), status: "upcoming" }));
ok("an old reading for a match to come says it may be out of date", /may be out of date/.test(stale));
ok("a forecast note is labelled as one, apart from the observation", /Forecast note: Rain from 14:00/.test(renderToStaticMarkup(h(WeatherChip, { w: asWeather(row({ forecast: "Rain from 14:00" })) })).replace(/<[^>]+>/g, "")));
ok("the cockpit's one-liner is unchanged by it", weatherWords({ tempC: 18, condition: "Showers", rainChancePct: 70 }) === "18° showers, rain likely");

console.log(`\n${fail ? "✗" : "✓"} weather-stamp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
