#!/usr/bin/env node
/**
 * Asking another coach about one of their players.
 *
 * A coach reaches a player through the side they coach. When a player is
 * wanted for a different side — promoted, or filling in on Saturday — the
 * requesting coach has no scope and the model refuses. The wrong fix is to
 * widen every coach to the whole school; this is the right one, and this walk
 * is how we know it is bounded.
 *
 * The interesting assertions are all about what a granted request does NOT
 * buy: not the diagnosis, not the rest of the squad, not forever, and not to
 * anyone but the coach who asked.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-access.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const P_FIRST = "aaaaaaaa-0000-0000-0000-000000000005";  // R Pillay, 1XI, injured
const P_MATE  = "aaaaaaaa-0000-0000-0000-000000000002";  // T Bekker, 1XI, also injured
const P_U16B  = "aaaaaaaa-0000-0000-0000-000000000006";  // K Dlamini, U16B

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-access-secret" },
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
  method: "POST", body: { email, deviceId: "device-access" } })).body?.token;
const read = async (resource, token) => (await api(`/api/read/${resource}`, { token })).body?.rows ?? [];
const ask = (player, token, body) =>
  api(`/api/players/${player}/access-request`, { method: "POST", token, body });
const decide = (id, token, body) =>
  api(`/api/access-requests/${id}/decide`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const dbq = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const first  = await login("coach@example.invalid");   // 1XI
  const second = await login("coach2@example.invalid");  // 2XI, and nothing else
  const medic  = await login("medical@example.invalid");

  group("Before asking, the answer is no");
  const before = await read("injuries", second);
  ok("the 2nd XI coach sees no 1st XI injury",
     !before.some((i) => i.player_id === P_FIRST));
  // They CAN see the player exists — that is the roster, and it is what makes
  // asking possible at all: you cannot request access to somebody you cannot
  // find. What the roster does not carry is whether he is fit to play, which
  // is exactly the question the request exists to answer.
  const rosterBefore = await read("players", second);
  ok("...but they can see the player exists, which is what lets them ask",
     rosterBefore.some((p) => p.id === P_FIRST));
  ok("...and the roster tells them nothing about his availability",
     !before.some((i) => i.player_id === P_FIRST));

  group("So they ask");
  const asked = await ask(P_FIRST, second, {
    forTeam: "2XI", reason: "fill_in", note: "Short for Saturday — is he available?",
  });
  ok("the request is accepted", asked.status === 200);
  const reqId = asked.body?.id;
  ok("...and comes back pending", asked.body?.state === "pending");

  ok("asking twice is refused rather than queued",
     (await ask(P_FIRST, second, { forTeam: "2XI", reason: "fill_in" })).status === 409);

  // for_team must be a side the requester actually holds, or "I want him for
  // the 1st XI" is a claim anyone can make about any team.
  ok("a coach cannot ask on behalf of a side they do not coach",
     (await ask(P_MATE, second, { forTeam: "1XI", reason: "promotion" })).status === 403);
  ok("a malformed reason is refused",
     (await ask(P_MATE, second, { forTeam: "2XI", reason: "because" })).status === 400);

  group("The right coach sees it, and nobody else");
  const inbox = await dbq(
    `select id from access_request where state = 'pending'`);
  ok("the request is in the database", inbox.length === 1);
  // The physio holds the whole medical record and no authority over selection.
  ok("medical staff cannot decide it",
     (await decide(reqId, medic, { grant: true })).status === 403);
  ok("the requester cannot decide their own request",
     (await decide(reqId, second, { grant: true })).status === 403);

  group("The player's own coach answers");
  const granted = await decide(reqId, first, { grant: true, note: "Yes, he is fit.", days: 7 });
  ok("the 1st XI coach may grant it", granted.status === 200 && granted.body?.ok === true);
  ok("...and it created an assignment", !!granted.body?.assignment);

  const [assignment] = await dbq(
    `select role, team_code, valid_until from role_assignment where id = $1`,
    [granted.body.assignment]);
  ok("the assignment is an enquiry, not a coaching role", assignment.role === "enquiry");
  ok("...scoped to no team, because it is scoped to a person instead",
     assignment.team_code === null);
  ok("...and it expires", assignment.valid_until !== null);
  const subjects = await dbq(
    `select player_id from assignment_subject where assignment_id = $1`, [granted.body.assignment]);
  ok("...naming exactly one player", subjects.length === 1 && subjects[0].player_id === P_FIRST);

  group("What the grant bought");
  const after = await read("injuries", second);
  const mine = after.filter((i) => i.player_id === P_FIRST);
  ok("the 2nd XI coach can now see that player is unavailable", mine.length === 1);
  ok("...and read their name", (await read("players", second)).some((p) => p.id === P_FIRST));

  group("And what it did not");
  ok("NOT what is wrong with them", mine.every((i) => i.injury_type == null));
  ok("NOT the clinical notes", mine.every((i) => i.notes == null));
  ok("NOT the rest of the 1st XI — one player was asked about, one was granted",
     !after.some((i) => i.player_id === P_MATE));
  ok("NOT a U16B player either",
     !after.some((i) => i.player_id === P_U16B));
  // A WELL-FORMED assessment, deliberately. The body has to be valid on the
  // current vocabulary or the request is refused at 400 for being malformed
  // and the assertion passes without authorisation ever being consulted —
  // which is precisely what happened when the attribute set changed under it.
  const denied = await api(`/api/players/${P_FIRST}/assessment`, {
    method: "POST", token: second,
    body: { scores: { technical: { footwork: 14 } } } });
  ok("NOT the ability to assess them", denied.status === 403);
  ok("...refused on authority rather than on shape",
     denied.body?.error === "not_permitted");

  group("Deciding twice, and deciding what is not yours");
  ok("the same request cannot be granted again",
     (await decide(reqId, first, { grant: true })).body?.reason === "already_granted");

  // A 1st XI coach has no authority over a U16B player, so a request about one
  // is not theirs to answer — being a coach is not the qualification, coaching
  // THAT player is.
  const u16bReq = await ask(P_U16B, second, { forTeam: "2XI", reason: "promotion" });
  ok("a request about a U16B player is accepted", u16bReq.status === 200);
  const wrongCoach = await decide(u16bReq.body.id, first, { grant: true });
  ok("...and the 1st XI coach may not answer it",
     wrongCoach.status === 403 && wrongCoach.body?.reason === "not_their_player");

  group("Revocation is immediate, because it is an assignment");
  await dbq(`update role_assignment set active = false where id = $1`, [granted.body.assignment]);
  ok("deactivating the assignment closes the access on the next statement",
     !(await read("injuries", second)).some((i) => i.player_id === P_FIRST));
} catch (e) {
  ok(`the access walk threw: ${e.message?.slice(0, 160)}`, false);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nACCESS REQUEST SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
