#!/usr/bin/env node
/**
 * Whether a boy can play on Saturday, and whose statement that is.
 *
 * The schema knew whether a player was FIT — the physio's judgement, on
 * injury, behind the medical tiers — and never whether he was AVAILABLE. A
 * perfectly fit fourteen-year-old can be at his grandmother's funeral, and
 * until now a coach named a side without that information.
 *
 *   1. SILENCE IS NOT A YES. No row means "has not answered", and the read
 *      returns those boys first, because they are the ones to chase.
 *   2. THE FAMILY ANSWERS FOR THE FAMILY. A guardian reaches their own child
 *      and no other child at the school.
 *   3. WHO SAID IT IS ON THE ROW. A coach recording what he was told is
 *      recording it in his own name.
 *   4. FITNESS AND AVAILABILITY DO NOT TOUCH. Neither writes the other, and a
 *      squad list shows both.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-availability.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8833);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-availability-secret" },
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
  method: "POST", body: { email, deviceId: "device-availability" } })).body?.token;

const declare = (matchId, token, body) =>
  api(`/api/matches/${matchId}/availability`, { method: "POST", token, body });
const sheet = async (matchId, token) =>
  (await api(`/api/read/availability?matchId=${matchId}`, { token })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach   = await login("coach@example.invalid");     // 1XI
  const coach2  = await login("coach2@example.invalid");    // 2XI
  const parent  = await login("parent@example.invalid");    // guardian of R Pillay
  const boy     = await login("pillay@example.invalid");    // R Pillay himself
  const head    = await login("sarah@example.invalid");
  const watcher = await login("watcher@example.invalid");   // spectator

  const CHILD = "aaaaaaaa-0000-0000-0000-000000000005";     // R Pillay, 1XI
  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() + interval '3 days','T20',20,'scheduled') returning id`,
    [HIL]))[0].id;
  const squad = await q(
    `select id, full_name from player where school_id = $1 and team_code = '1XI' order by full_name`,
    [HIL]);

  group("Silence is not a yes");
  const before = await sheet(m, coach);
  ok("the whole side is on the sheet", before.length === squad.length && before.length > 0);
  // THE ASSERTION THIS READ EXISTS FOR. A query returning only declarations
  // would leave a team manager counting the squad by hand and subtracting.
  ok("...every one of them unanswered", before.every((r) => r.status === null));
  ok("...and nobody is implied available", !before.some((r) => r.status === "available"));

  group("The family answers for the family");
  const mine = await declare(m, parent, {
    playerId: CHILD, status: "unavailable", reasonKind: "family",
    note: "Away at his grandmother's funeral in Ladysmith." });
  ok("a guardian can answer for their own child", mine.status === 200);
  ok("...and it is recorded as unavailable", mine.body?.status === "unavailable");

  // The person anchor doing its work. Without it a guardian holding
  // availability.declare at a school could answer for every boy in it.
  const other = squad.find((p) => p.id !== CHILD);
  ok("a guardian cannot answer for another child",
     [403, 401].includes((await declare(m, parent, {
       playerId: other.id, status: "unavailable" })).status));
  ok("...and nothing was written for them",
     (await q(`select count(*)::int c from match_availability
                where match_id=$1 and player_id=$2`, [m, other.id]))[0].c === 0);

  ok("the boy can answer for himself",
     (await declare(m, boy, { playerId: CHILD, status: "available" })).status === 200);
  ok("...which replaces the earlier answer rather than adding one",
     (await q(`select count(*)::int c from match_availability
                where match_id=$1 and player_id=$2`, [m, CHILD]))[0].c === 1);
  ok("...and the sheet shows the latest",
     (await sheet(m, coach)).find((r) => r.player_id === CHILD)?.status === "available");

  group("Who said it is on the row");
  await declare(m, coach, {
    playerId: other.id, status: "doubtful", reasonKind: "academic",
    note: "Rewrite on Friday, will confirm." });
  const s2 = await sheet(m, coach);
  const byCoach = s2.find((r) => r.player_id === other.id);
  const bySelf  = s2.find((r) => r.player_id === CHILD);
  // "Unavailable, said so himself" and "unavailable, according to the coach"
  // are different degrees of certainty on a Friday afternoon.
  ok("a coach's record is not marked self-declared", byCoach?.self_declared === false);
  ok("...and names who recorded it", !!byCoach?.declared_by_name);
  ok("the boy's own answer is marked self-declared", bySelf?.self_declared === true);
  // declared_by is never taken from the request.
  const spoofed = await declare(m, coach, {
    playerId: other.id, status: "available", declaredBy: CHILD });
  ok("declared_by cannot be spoofed from the request", spoofed.status === 200);
  ok("...it is always the caller",
     (await q(`select declared_by from match_availability
                where match_id=$1 and player_id=$2`, [m, other.id]))[0].declared_by
       === (await q(`select id from app_user where email='coach@example.invalid'`))[0].id);

  group("The vocabulary is closed, and the fixture has to be theirs");
  ok("an unknown status is refused",
     (await declare(m, coach, { playerId: CHILD, status: "probably" })).status === 400);
  ok("an unknown reason is refused",
     (await declare(m, coach, { playerId: CHILD, status: "unavailable", reasonKind: "hungover" })).status === 400);
  ok("a missing status is refused",
     (await declare(m, coach, { playerId: CHILD })).status === 400);
  // A boy at another school on this school's team sheet would be a name a
  // team manager has no business holding.
  const away = (await q(
    `select id from player where school_id <> $1 limit 1`, [HIL]))[0];
  ok("a player from another school is refused",
     [422, 403, 404].includes((await declare(m, coach, {
       playerId: away.id, status: "available" })).status));

  group("Only the people picking the side may read it");
  // availability.read is narrower than team.read on purpose: "unavailable,
  // family" is a small window into a child's home life.
  ok("a spectator reads nothing", (await sheet(m, watcher)).length === 0);
  ok("a coach of another side reads nothing of this one",
     (await sheet(m, coach2)).length === 0);
  ok("the director of sport reads the school's", (await sheet(m, head)).length > 0);
  ok("a guardian sees their own child's answer",
     (await sheet(m, parent)).some((r) => r.player_id === CHILD && r.status !== null));
  ok("...and not another family's note",
     !(await sheet(m, parent)).some((r) => r.player_id === other.id && r.note !== null));

  group("Fitness and availability do not touch");
  {
    // A boy declaring himself unavailable does not become injured, and a
    // physio marking him unfit does not write a declaration in his name.
    const injured = squad.find((p) => p.id !== CHILD && p.id !== other.id);
    await q(`insert into injury (player_id, school_id, injury_type, severity, date_injured, restricted)
             values ($1,$2,'Hamstring strain','moderate',current_date,true)`, [injured.id, HIL]);
    const s3 = await sheet(m, coach);
    const row = s3.find((r) => r.player_id === injured.id);
    ok("the sheet shows a clinical restriction", row?.clinically_restricted === true);
    ok("...and no declaration was invented for him", row?.status === null);
    ok("...so he still counts as unanswered", row?.status === null && row?.declared_at === null);

    await declare(m, coach, { playerId: injured.id, status: "unavailable", reasonKind: "illness" });
    ok("declaring him unavailable writes no injury row",
       (await q(`select count(*)::int c from injury where player_id=$1`, [injured.id]))[0].c === 1);

    // A boy with NO injury record, because R Pillay is the seeded injured 1XI
    // player and cannot demonstrate "unavailable and perfectly fit" — which is
    // the whole case this feature exists for. The first version of this walk
    // used him and the assertion was quietly impossible.
    const fitAndAway = (await q(
      `select p.id from player p
        where p.school_id = $1 and p.team_code = '1XI'
          and not exists (select 1 from injury i where i.player_id = p.id)
        order by p.full_name limit 1`, [HIL]))[0];
    ok("there is a fit boy to ask", !!fitAndAway);
    await declare(m, coach, { playerId: fitAndAway.id, status: "unavailable", reasonKind: "family" });
    ok("a fit boy can be unavailable, and stays fit",
       (await q(`select count(*)::int c from injury where player_id=$1`, [fitAndAway.id]))[0].c === 0);
    // The point of the whole feature, stated as an assertion: a side is picked
    // from the intersection, and both halves are visible.
    const s4 = await sheet(m, coach);
    ok("a selector can see both facts at once",
       s4.some((r) => r.clinically_restricted === true) &&
       s4.some((r) => r.status === "unavailable" && r.clinically_restricted === false));
  }

  group("Unanswered boys sort first, because they are the ones to chase");
  const s5 = await sheet(m, coach);
  const firstAnswered = s5.findIndex((r) => r.status !== null);
  const lastUnanswered = s5.map((r) => r.status).lastIndexOf(null);
  ok("every unanswered name comes before every answered one",
     firstAnswered === -1 || lastUnanswered === -1 || lastUnanswered < firstAnswered);

  // SCRBRD-122 (db/65). An answer is about the fixture as it stood when it
  // was given; when the fixture moves, "available" is no longer a yes.
  group("A moved fixture asks again");
  {
    // An availability notice is tiered (availability.read): listed with its
    // title, its body read on open (NOTIFICATIONS.md D17), as the person would.
    const notices = async (token) => Promise.all(
      ((await api("/api/read/notifications", { token })).body?.rows ?? []).filter((n) => n.subject_id === m).map(async (n) =>
        n.tiered ? { ...n, body: (await api(`/api/notifications/${n.id}/read`, { method: "POST", token, body: {} })).body?.notice?.body ?? null } : n));
    ok("the boy's own answer stands before the fixture moves",
       (await sheet(m, coach)).find((r) => r.player_id === CHILD)?.status === "available");
    const moved = await api(`/api/fixtures/${m}`, { method: "POST", token: head, body: {
      startsAt: new Date(Date.now() + 4 * 86400e3).toISOString() } });
    ok("the director of sport moves the fixture", moved.status === 200);
    const s6 = await sheet(m, coach);
    const his = s6.find((r) => r.player_id === CHILD);
    // Silence is not a yes, and neither is a yes to another day.
    ok("his answer now reads needs_reconfirming, not available", his?.status === "needs_reconfirming");
    ok("...what he said is still there", his?.said_status === "available" && his?.needs_reconfirming === true);
    ok("...with the fixture he said it about",
       /^was available for \w{3} \d{1,2} \w{3} \d\d:\d\d · T20, 20 overs$/.test(his?.was_line ?? ""));
    ok("nobody on the sheet is still available", !s6.some((r) => r.status === "available"));
    const firstAsked = s6.findIndex((r) => r.needs_reconfirming);
    const lastSilent = s6.map((r) => r.status).lastIndexOf(null);
    const firstSettled = s6.findIndex((r) => r.status !== null && !r.needs_reconfirming);
    ok("the ones asked again sort after the silent and before the settled",
       (lastSilent === -1 || lastSilent < firstAsked) && (firstSettled === -1 || firstAsked < firstSettled));

    const toParent = await notices(parent);
    ok("his guardian is asked to answer again, about him and nobody else",
       toParent.length === 1 && toParent[0].subject_person_id === CHILD
       && /please answer again/.test(toParent[0].title) && toParent[0].body.includes("R Pillay"));
    const toBoy = await notices(boy);
    ok("...and so is the boy, who answered for himself, as the system's own notice",
       toBoy.length === 1 && toBoy[0].kind === "system" && toBoy[0].subject_person_id === CHILD);
    const toCoach = await notices(coach);
    ok("the coach is asked about the boys whose answers he recorded, and not about R Pillay",
       toCoach.length > 0 && !toCoach.some((n) => n.subject_person_id === CHILD));
    ok("a spectator and another side's coach are told nothing",
       (await notices(watcher)).length === 0 && (await notices(coach2)).length === 0);

    ok("his guardian answers again",
       (await declare(m, parent, { playerId: CHILD, status: "available" })).status === 200);
    const again = (await sheet(m, coach)).find((r) => r.player_id === CHILD);
    ok("...and the answer is current again",
       again?.status === "available" && again?.needs_reconfirming === false && again?.was_line === null);

    const hist = async (token) =>
      (await api(`/api/read/availability_history?matchId=${m}`, { token })).body?.rows ?? [];
    const mineBefore = (await hist(parent)).filter((r) => r.player_id === CHILD);
    // Nothing is deleted: the guardian's first answer (replaced by the boy's)
    // and the boy's (asked again, then replaced by the guardian's).
    ok("the answers it replaced are kept, newest first",
       mineBefore.length === 2 && mineBefore[0].status === "available" && mineBefore[0].was_stale === true
       && mineBefore[1].status === "unavailable" && mineBefore[1].was_stale === false);
    ok("...and a guardian reads no other boy's earlier answers",
       (await hist(parent)).every((r) => r.player_id === CHILD));
    ok("...nor does a spectator read any", (await hist(watcher)).length === 0);
    ok("the coach reads his side's", (await hist(coach)).some((r) => r.player_id !== CHILD));
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`AVAILABILITY SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
