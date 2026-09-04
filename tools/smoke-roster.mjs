#!/usr/bin/env node
/**
 * The roster, and the notice that a boy is ageing up.
 *
 * Two things that only make sense together. A coach can now see every child at
 * the school in outline — which is what makes it possible to find a player to
 * ask about, and what makes it possible to be TOLD about one. Without the
 * roster, a notice saying "consider L Mahlangu for U14A trials" would name a
 * child the recipient cannot look up.
 *
 * The assertions that matter are the negative ones. A roster is a list of
 * children, and the whole argument for it is that it stays a list of children
 * rather than becoming a directory: name, side, age. Not an address, not a
 * guardian's phone number, not an ID number, not a medical record.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-roster.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { nextBandUp, bandChangeAhead, BAND_CHANGE_NOTICE_DAYS } from "@scrbrd/policy/teams";

const PORT = 8800;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-roster-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-roster" } })).body?.token;
const read = async (r, token) => (await api(`/api/read/${r}`, { token })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const first   = await login("coach@example.invalid");      // 1XI
  const second  = await login("coach2@example.invalid");     // 2XI
  const u14     = await login("u14coach@example.invalid");   // U14A
  const watcher = await login("watcher@example.invalid");    // spectator
  const parent  = await login("parent@example.invalid");

  group("Every coach sees every child at the school");
  const roster = await read("players", second);
  const teams = new Set(roster.map((p) => p.team_code));
  ok("a 2nd XI coach sees more than their own side", teams.size > 1);
  ok("...including the 1st XI", teams.has("1XI"));
  ok("...and the age groups", [...teams].some((t) => /^U\d/.test(t)));

  group("...in outline, and no further");
  ok("a name is on the roster", roster.every((p) => p.full_name));
  ok("a side is on the roster", roster.every((p) => p.team_code));
  // Age is roster-tier: a coach considering a trial needs it, and so does
  // anyone avoiding a fifteen-year-old in a U13 side.
  ok("an age is on the roster", roster.some((p) => p.born != null));
  // Everything else stays with the side the boy plays for.
  const others = roster.filter((p) => p.team_code !== "2XI");
  ok("a home address is not", others.every((p) => p.address == null));
  ok("a guardian's details are not", others.every((p) => p.guardian == null));
  ok("a national ID number is not", roster.every((p) => p.id_number == null));

  group("The roster stops at the school gate");
  ok("no child from another school appears",
     roster.every((p) => p.school_id === "11111111-1111-1111-1111-111111111111"));

  group("And it is a coach's list, not everyone's");
  ok("a spectator reaches no roster at all", (await read("players", watcher)).length === 0);
  ok("a guardian still sees only their own child", (await read("players", parent)).length === 1);

  group("A boy about to age up — derived, not delivered");
  // No job publishes this and no row records that anyone was told. It is
  // arithmetic on a date that has been in the player row since the child was
  // registered, and it is correct the moment it is asked. The first version
  // was a scheduled function writing notification rows, which is the shape
  // this codebase avoids everywhere else: a derived fact materialised beside
  // the thing it is derived from is a fact that can drift.
  const due = await read("band_changes", u14);
  ok("the view names the boy who is ageing up", due.length === 1);
  ok("...with the age he turns and when", Number(due[0]?.turning) === 14 && due[0]?.next_birthday);
  ok("...inside the thirty-day window", Number(due[0]?.days_until) <= 30 && Number(due[0]?.days_until) >= 0);
  ok("...and the side to trial him for", (due[0]?.trial_for ?? []).includes("U14A"));

  // Same merit level. A U13A player is not a U14 player in general.
  ok("the side named is A, not whichever has a space",
     (due[0]?.trial_for ?? []).every((t) => /A$/.test(t)));

  // The seed carries a second U13A player who turns 13, not 14 — he stays in
  // the band. Without him "only the player ageing out appears" would pass by
  // having nothing to reject.
  ok("the boy who is NOT ageing out does not appear",
     !due.some((d) => /Sithole/.test(d.full_name ?? "")));

  // Asking twice is asking twice. There is no state to guard, which is the
  // whole point: the idempotency machinery the job needed existed only because
  // the job could re-run.
  const again = await read("band_changes", u14);
  ok("reading it again gives the same answer, with nothing accumulated",
     again.length === due.length);
  const notices = (await read("notifications", u14)).filter((n) => n.kind === "selection");
  ok("and nothing was written to the notification table", notices.length === 0);

  group("Scoped like every other read");
  ok("a coach at the school sees it", (await read("band_changes", second)).length === 1);
  ok("a spectator sees nothing", (await read("band_changes", watcher)).length === 0);
  ok("a guardian sees only their own child, who is not ageing up",
     (await read("band_changes", parent)).length === 0);

  group("An injury is still an event, and still delivered");
  // The distinction this whole change rests on: a birthday is arithmetic on
  // state, an injury is something that HAPPENED. No amount of looking at the
  // world afterwards tells you it was recorded on Tuesday, so it stays a row.
  const injuryAlerts = (await read("notifications", first)).filter((n) => n.kind === "injury");
  ok("an injury alert is still a notification row", injuryAlerts.length > 0);

  group("The client and the database agree about the step up");
  ok("U13A steps up to U14A", nextBandUp("U13A")[0] === "U14A");
  ok("U13C steps up to U14C, not U14A", nextBandUp("U13C")[0] === "U14C");
  // No letter maps honestly to a rank at the top of the age groups, so every
  // open side is a candidate and the coaches sort it out.
  ok("U16A steps up to every open side", nextBandUp("U16A").length === 3);
  ok("an open side has nowhere further to step", nextBandUp("1XI").length === 0);
  ok("the notice window is thirty days", BAND_CHANGE_NOTICE_DAYS === 30);
  ok("a boy turning 13 in a U13 side is not ageing out",
     bandChangeAhead("2013-10-20", "U13A", new Date("2026-09-04")) === null);
  ok("...and one turning 14 is",
     bandChangeAhead("2012-10-20", "U13A", new Date("2026-09-04"))?.nextBand === 14);
} catch (e) {
  ok(`the roster walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nROSTER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
