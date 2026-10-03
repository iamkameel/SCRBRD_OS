#!/usr/bin/env node
/**
 * The rest of the prematch checklist: batting order, weather, pitch report.
 *
 * Three findings in one walk.
 *
 * BATTING ORDER was a defect in shipped code. `batting_no` was an
 * unconstrained smallint, so a coach could name two number threes, or a number
 * 47, and the scorer's setup screen would take whichever the sort returned
 * first. Squad selection went out with that hole in it.
 *
 * WEATHER and the PITCH REPORT are the fourth and fifth instances of the
 * pattern this branch keeps closing: a table with a read query and no way on
 * earth to write it. The scorer's wizard showed a weather step that went
 * nowhere.
 *
 * Unlike the toss, conditions stay writable once play has started. Weather
 * changes — that is the reason for recording it — and a scorer who cannot
 * write "rain arrived at 3pm" has been handed something worse than a notebook.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-conditions.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8811);
const BASE = `http://127.0.0.1:${PORT}`;
// A second API, with a weather key and a stub for Google (the hint, below).
const HINT_PORT = port(8812);
const HINT_BASE = `http://127.0.0.1:${HINT_PORT}`;
const STUB_KEY = "walk-stub-key-not-google";
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-conditions-secret",
         // This one has no weather key, whatever the shell has.
         GOOGLE_WEATHER_API_KEY: "", GOOGLE_WEATHER_BASE_URL: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

// Google, stubbed: it records what it was sent and answers in the shape
// LookupCurrentConditionsResponse documents. Nothing in this walk calls Google.
/** @type {{ url: string, headers: import("node:http").IncomingHttpHeaders }[]} */
const upstream = [];
const stub = createServer((req, res) => {
  upstream.push({ url: String(req.url), headers: req.headers });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    currentTime: "2026-10-02T09:15:00Z", isDaytime: true,
    weatherCondition: { type: "LIGHT_RAIN", description: { text: "Light rain", languageCode: "en" } },
    temperature: { degrees: 17.4, unit: "CELSIUS" }, relativeHumidity: 88,
    wind: { direction: { degrees: 45, cardinal: "NORTHEAST" }, speed: { value: 18, unit: "KILOMETERS_PER_HOUR" } },
    precipitation: { probability: { percent: 70, type: "RAIN" } },
    visibility: { distance: 8, unit: "KILOMETERS" },
  }));
});
await new Promise((r) => stub.listen(0, "127.0.0.1", () => r(null)));
const stubPort = /** @type {import("node:net").AddressInfo} */ (stub.address()).port;
const hintServer = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(HINT_PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-conditions-secret",
         GOOGLE_WEATHER_API_KEY: STUB_KEY, GOOGLE_WEATHER_BASE_URL: `http://127.0.0.1:${stubPort}` },
  stdio: ["ignore", "pipe", "pipe"],
});
const hintOut = [];
hintServer.stdout.on("data", (d) => hintOut.push(d.toString()));
hintServer.stderr.on("data", (d) => hintOut.push(d.toString()));
/** GET the hint, with its headers. */
const hint = async (base, query, authorization) => {
  const res = await fetch(`${base}/api/weather/hint?${query}`, { headers: authorization ? { authorization } : {} });
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json().catch(() => null) };
};

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-cond" } })).body?.token;

const pick    = (m, t, side, players) => api(`/api/matches/${m}/squad`,   { method: "POST", token: t, body: { side, players } });
const weather = (m, t, body)          => api(`/api/matches/${m}/weather`, { method: "POST", token: t, body });
const pitch   = (m, t, body)          => api(`/api/matches/${m}/pitch`,   { method: "POST", token: t, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const head   = await login("sarah@example.invalid");     // directorofsport
  const scorer = await login("scorer@example.invalid");    // scoring.start, no facility.manage
  const parent = await login("parent@example.invalid");
  // facility.read without facility.manage — the boundary the ground record sits on.
  const coach  = await login("coach@example.invalid");

  const newMatch = async (team = "1XI") => (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,$2,'Michaelhouse', now() + interval '1 day','T20',20,'scheduled') returning id`,
    [HIL, team]))[0].id;

  // Only the players the seed leaves REGISTERED. Selection eligibility is
  // smoke-squad's subject, not this walk's — a side half of whose members the
  // registration trigger refuses would fail these assertions for the wrong
  // reason, which is exactly the trap smoke-access fell into once already.
  const xi = await q(
    `select p.id from player p
       join player_guardian_status s on s.player_id = p.id
      where p.team_code = '1XI' and s.registration_state = 'active'
      order by p.full_name`);

  // ── BATTING ORDER ────────────────────────────────────────────
  group("A batting order is an order");
  ok("the seed leaves enough registered players to order", xi.length >= 5);
  const m = await newMatch();
  const inOrder = xi.map((p, i) => ({ playerId: p.id, battingNo: i + 1 }));
  ok("a side numbered from one is accepted", (await pick(m, head, "home", inOrder)).status === 200);
  const stored = await q(
    `select batting_no from match_squad where match_id = $1 and not withdrawn order by batting_no`, [m]);
  ok("and every position is filled, in order",
     stored.length === xi.length && stored.every((r, i) => r.batting_no === i + 1));
  // The boundary. Eleven is the last legal position because every team code in
  // this product names an XI.
  const mB = await newMatch();
  ok("number eleven is legal",
     (await pick(mB, head, "home", [{ playerId: xi[0].id, battingNo: 11 }])).status === 200);
  ok("number twelve is not",
     (await pick(mB, head, "home", [{ playerId: xi[0].id, battingNo: 12 }])).status === 400);

  // The defect. Two number threes used to be accepted silently.
  const m2 = await newMatch();
  const twoThrees = xi.slice(0, 4).map((p, i) => ({ playerId: p.id, battingNo: i === 3 ? 3 : i + 1 }));  // 1,2,3,3
  const dup = await pick(m2, head, "home", twoThrees);
  ok("two boys at number three is refused", dup.status === 400);
  ok("and named as a doubled position, not a generic error", dup.body?.error === "duplicate_batting_no");
  ok("nothing was written", (await q(`select 1 from match_squad where match_id = $1`, [m2])).length === 0);

  const m3 = await newMatch();
  ok("a number 47 is refused",
     (await pick(m3, head, "home", [{ playerId: xi[0].id, battingNo: 47 }])).status === 400);
  ok("so is a number 0",
     (await pick(m3, head, "home", [{ playerId: xi[0].id, battingNo: 0 }])).status === 400);
  ok("and a fractional position",
     (await pick(m3, head, "home", [{ playerId: xi[0].id, battingNo: 3.5 }])).status === 400);
  // A twelfth man does not bat. Naming one at six is a mis-tick, not a plan.
  ok("a twelfth man cannot be given a position",
     (await pick(m3, head, "home", [{ playerId: xi[0].id, battingNo: 6, twelfth: true }])).status === 400);

  group("Reordering a side that is already named");
  // The squad route withdraws the side and re-inserts it, so the partial index
  // must not collide with the order the side is being changed FROM.
  const reversed = xi.map((p, i) => ({ playerId: p.id, battingNo: xi.length - i }));
  ok("the order can be reversed wholesale", (await pick(m, head, "home", reversed)).status === 200);
  const after = await q(
    `select player_id, batting_no from match_squad
      where match_id = $1 and not withdrawn order by batting_no`, [m]);
  ok("and the new order stands",
     after.length === xi.length && after[0].player_id === xi[xi.length - 1].id);
  // Reserves are legitimate: in the squad, no position yet.
  const withReserve = [...xi.slice(0, 3).map((p, i) => ({ playerId: p.id, battingNo: i + 1 })),
                       { playerId: xi[3].id }];
  ok("a squad member with no position is allowed", (await pick(m, head, "home", withReserve)).status === 200);
  ok("...and more than one of them, which a unique index would have blocked",
     (await pick(m, head, "home", [...withReserve, { playerId: xi[4].id }])).status === 200);

  // ── WEATHER ──────────────────────────────────────────────────
  group("The weather, which nothing could write until now");
  const w = await weather(m, head, {
    condition: "Overcast", tempC: 19, humidityPct: 78, windKph: 22,
    windDir: "SSW", uvIndex: 3, rainChancePct: 60, forecast: "Clearing by noon",
  });
  ok("it is recorded", w.status === 200);
  ok("the condition comes back", w.body?.condition === "Overcast");
  ok("and the numbers", w.body?.temp_c === 19 && w.body?.rain_chance_pct === 60);
  ok("playable defaults to true rather than to nothing", w.body?.playable === true);
  ok("calling a match off is a deliberate false",
     (await weather(m, head, { condition: "Heavy rain", playable: false })).body?.playable === false);
  ok("a reading with no condition is refused", (await weather(m, head, {})).status === 400);
  ok("an impossible humidity is refused",
     (await weather(m, head, { condition: "Fine", humidityPct: 140 })).status === 400);
  ok("and a UV index off the scale",
     (await weather(m, head, { condition: "Fine", uvIndex: 99 })).status === 400);
  ok("a second reading replaces the first, it does not stack",
     (await q(`select 1 from match_weather where match_id = $1`, [m])).length === 1);
  // The policy answers first: a match that is not there has no school to
  // anchor on, so the write is not permitted (403) — which also says nothing
  // about whether that id exists. The foreign key (23503 → 404) backs it for a
  // caller the policy would admit. Either way, never a 500, and nothing written.
  const nowhere = await weather("00000000-0000-0000-0000-00000000dead", head, { condition: "Fine" });
  ok("weather for a match that is not there is refused by name, not a 500",
     (nowhere.status === 403 && nowhere.body?.error === "not_permitted") || (nowhere.status === 404 && nowhere.body?.error === "no_such_match"),
     `${nowhere.status} ${JSON.stringify(nowhere.body)}`);
  ok("...and nothing was written for it",
     (await q(`select 1 from match_weather where match_id = $1`, ["00000000-0000-0000-0000-00000000dead"])).length === 0);

  // ── THE WEATHER HINT (Practice Match, 2026-10-02) ───────────
  group("The weather hint: Google's, briefly, and never the record");
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(HINT_BASE + "/api/health").then((r) => r.json()))?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const bearer = `Bearer ${head}`;
  ok("health says unconfigured with no key, and configured with one — never the key",
     (await api("/api/health")).body?.weather === "unconfigured"
     && (await fetch(HINT_BASE + "/api/health").then((r) => r.json()))?.weather === "configured");
  const unset = await hint(BASE, "lat=-29.6012&lon=30.3799", bearer);
  ok("no key: 503 weather_unavailable, no-store", unset.status === 503 && unset.body?.error === "weather_unavailable" && unset.cache === "no-store",
     JSON.stringify(unset));
  ok("signed out: 401", (await hint(BASE, "lat=-29.6&lon=30.4")).status === 401
     && (await hint(HINT_BASE, "lat=-29.6&lon=30.4")).status === 401);
  const padTry = await hint(HINT_BASE, "lat=-29.6&lon=30.4", "ScrbrdPad anything");
  ok("a pad credential: 403 pad_scope, before anything is read", padTry.status === 403 && padTry.body?.error === "pad_scope", JSON.stringify(padTry));
  ok("out of range: 400 bad_param, with or without a key",
     (await hint(BASE, "lat=91&lon=30.4", bearer)).body?.error === "bad_param"
     && (await hint(HINT_BASE, "lat=-29.6&lon=-180.5", bearer)).body?.error === "bad_param"
     && (await hint(HINT_BASE, "lat=&lon=30.4", bearer)).status === 400);
  ok("...and none of those reached Google", upstream.length === 0, upstream.length);

  const weatherRows = (await q(`select count(*)::int as n from match_weather`))[0].n;
  const got = await hint(HINT_BASE, "lat=-29.601234&lon=30.379876", bearer);
  ok("with a key: Google's answer in our words", got.status === 200 && JSON.stringify(got.body) === JSON.stringify({
       condition: "drizzle", temp_c: 17, humidity_pct: 88, wind_kph: 18, wind_dir: "NE", rain_chance_pct: 70,
       observed_at: "2026-10-02T09:15:00Z", attribution: "Weather by Google" }), JSON.stringify(got.body));
  ok("...said to the browser no-store", got.cache === "no-store");
  ok("one request upstream", upstream.length === 1);
  const sentUp = new URL(upstream[0]?.url ?? "/", "http://stub");
  ok("to currentConditions:lookup, the position rounded to two places",
     sentUp.pathname === "/v1/currentConditions:lookup"
     && sentUp.searchParams.get("location.latitude") === "-29.6" && sentUp.searchParams.get("location.longitude") === "30.38",
     upstream[0]?.url);
  ok("nothing else in it: no person, no match, no key",
     [...sentUp.searchParams.keys()].sort().join() === "location.latitude,location.longitude,unitsSystem"
     && !upstream[0].url.includes(STUB_KEY), upstream[0]?.url);
  ok("the key in the header", upstream[0]?.headers["x-goog-api-key"] === STUB_KEY);
  ok("no session token went upstream", !upstream[0]?.headers.authorization && !JSON.stringify(upstream[0]?.headers).includes(head));
  const parentHint = await hint(HINT_BASE, "lat=-29.6049&lon=30.3751", `Bearer ${parent}`);
  ok("anybody signed in may ask; the same rounded place is the cache, not Google again",
     parentHint.status === 200 && parentHint.body?.condition === "drizzle" && upstream.length === 1, upstream.length);
  ok("the hint writes nothing: match_weather is untouched",
     (await q(`select count(*)::int as n from match_weather`))[0].n === weatherRows);
  ok("the server never printed the key", !hintOut.join("").includes(STUB_KEY));

  // ── PITCH REPORT ─────────────────────────────────────────────
  group("The pitch report");
  const pr = await pitch(m, head, {
    surface: "firm", grass: "light", bounce: "even", pace: "medium",
    favours: "seam", coversOn: false, notes: "Rolled Thursday. Slight dampness on a good length.",
  });
  ok("it is recorded", pr.status === 200);
  ok("the surface comes back", pr.body?.surface === "firm");
  ok("and what the square is expected to reward", pr.body?.favours === "seam");
  ok("a partial report is accepted — three boxes beat none",
     (await pitch(await newMatch(), head, { surface: "damp" })).status === 200);
  ok("a report of nothing at all is refused", (await pitch(await newMatch(), head, {})).status === 400);
  ok("an invented surface is refused", (await pitch(m, head, { surface: "spongy" })).status === 400);
  ok("an invented bounce is refused", (await pitch(m, head, { bounce: "trampoline" })).status === 400);
  ok("one report per match", (await q(`select 1 from match_pitch_report where match_id = $1`, [m])).length === 1);
  ok("who filed it is recorded",
     !!(await q(`select reported_by from match_pitch_report where match_id = $1`, [m]))[0].reported_by);

  group("Conditions are authorised, and separately from each other");
  const m4 = await newMatch();
  ok("a parent cannot record the weather", (await weather(m4, parent, { condition: "Fine" })).status === 403);
  ok("a parent cannot file a pitch report", (await pitch(m4, parent, { surface: "firm" })).status === 403);
  // The two capabilities are genuinely different. A scorer starts matches; a
  // groundsman describes squares. Neither implies the other.
  ok("a scorer cannot file a pitch report — that is facility.manage",
     (await pitch(m4, scorer, { surface: "firm" })).status === 403);
  ok("nothing was written by any of them",
     (await q(`select 1 from match_pitch_report where match_id = $1`, [m4])).length === 0);

  group("Conditions stay writable once play has started");
  // The toss freezes at the first delivery. Weather must not: it changes, and
  // that is the reason for recording it at all.
  const scorerUser = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  // A dot ball: a delivery says what it was (db/43 refuses one with no type).
  await q(
    `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id,
                             device_id, idempotency_key, client_seq, client_ts, kind, ball_type, value, payload)
     values ($1, $2, 1, 1, 1, $3, 'device-cond', $4, 1, now(), 'ball', 'run', 0, '{}'::jsonb)`,
    [m, HIL, scorerUser, `cond-smoke-${Date.now()}-${Math.random()}`]);
  ok("rain at three o'clock is still recordable",
     (await weather(m, head, { condition: "Rain", playable: false })).status === 200);
  ok("and the pitch report can still be corrected",
     (await pitch(m, head, { surface: "damp", notes: "Rain from 15:00." })).status === 200);

  group("Conditions reach the read path");
  const read = await api(`/api/read/pitch_report?matchId=${m}`, { token: head });
  ok("the pitch report reads back", read.body?.rows?.[0]?.surface === "damp");
  const wx = await api("/api/read/weather", { token: head });
  ok("the weather reads back", wx.body?.rows?.some((r) => r.match_id === m && r.condition === "Rain"));

  group("The degree, beside the character");
  // 'variable' is not a point on a scale and cannot be written as a number;
  // "steep" covers everything from awkward to unplayable. Neither vocabulary
  // replaces the other, so both are recorded and either may stand alone.
  ok("a rating rides alongside the word",
     (await pitch(m, head, { bounce: "variable", bounceRating: 8, paceRating: 4, outfield: "slow" })).status === 200);
  const rated = (await api(`/api/read/pitch_report?matchId=${m}`, { token: head })).body?.rows?.[0];
  ok("...and both come back", rated?.bounce === "variable" && rated?.bounce_rating === 8);
  ok("the outfield is its own question from how the square plays", rated?.outfield === "slow");
  ok("a rating outside 1-10 is refused by name",
     (await pitch(m, head, { bounceRating: 11 })).status === 400);
  ok("...and so is a fractional one — these are whole-number judgements",
     (await pitch(m, head, { paceRating: 6.5 })).status === 400);
  ok("a word with no number is still a report",
     (await pitch(m, head, { bounce: "steep" })).status === 200);

  group("The ground, as opposed to the square prepared on it");
  // How long after the rain before we can play is a property of the GROUND's
  // drainage, not of whichever fixture happens to be scheduled on it.
  const g = (await q(`select id from ground where school_id = $1 limit 1`, [HIL]))[0].id;
  const condition = (token, body) =>
    api(`/api/grounds/${g}/condition`, { method: "POST", token, body });

  // The negative actor is a COACH, deliberately, not the scorer: a scorer
  // holds neither facility capability, so refusing them proves only that they
  // are not grounds staff. A coach holds facility.read and not facility.manage,
  // which is exactly the boundary this row is governed by — reading what the
  // groundsman recorded is not being able to record it.
  ok("a coach cannot file one — facility.read is not facility.manage",
     [403, 401].includes((await condition(coach, { drainageMin: 40 })).status));
  ok("a scorer cannot either, holding neither facility capability",
     [403, 401].includes((await condition(scorer, { drainageMin: 40 })).status));
  ok("the groundsman can", (await condition(head, {
       moisturePct: 22, grassMm: 12, roller: "heavy", outfield: "fast",
       drainageMin: 45, lastMown: "2026-09-05", notes: "Rolled Thursday.",
     })).status === 200);
  const gc = (await api(`/api/read/ground_conditions?groundId=${g}`, { token: head })).body?.rows?.[0];
  ok("the wet-morning answer reads back", gc?.drainage_min === 45);
  ok("...with the rest of the curator's record", gc?.moisture_pct === 22 && gc?.roller === "heavy");
  ok("a drainage time beyond ten hours is a decision, not a measurement",
     (await condition(head, { drainageMin: 601 })).status === 400);
  ok("a mistyped date is refused by name rather than by type",
     (await condition(head, { lastMown: "05/09/2026" })).status === 400);
  const listDate = await condition(head, { lastMown: ["2026-09-05"] });
  ok("a date sent as a list is refused by name too — it used to reach Postgres and come back 500",
     listDate.status === 400 && listDate.body?.error === "last_mown_must_be_yyyy_mm_dd", JSON.stringify(listDate.body));
  ok("an empty report is not a report",
     (await condition(head, {})).status === 400);
  ok("a second report corrects the first rather than adding to it",
     (await condition(head, { drainageMin: 30 })).status === 200 &&
     (await q(`select count(*)::int as n from ground_condition where ground_id = $1`, [g]))[0].n === 1);
  ok("a parent may read it — it says nothing about a person",
     (await api(`/api/read/ground_conditions?groundId=${g}`, { token: parent })).status === 200);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  hintServer.kill();
  stub.close();
  console.log("\n" + "─".repeat(52));
  console.log(`CONDITIONS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
