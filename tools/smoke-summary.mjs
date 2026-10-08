#!/usr/bin/env node
/**
 * The dashboard's figures, and the scope they are counted over.
 *
 * Eleven KPI cards were hard-coded string literals — value="53", value="72%",
 * value="48.2" — rendering identically for a superadmin and a team coach
 * because they were not computed from anything. The two that WERE real
 * (injuries, unread alerts) were counted in the browser with .filter().length
 * over rows the server had already scoped.
 *
 * That second pattern is correct today and fragile by construction: it needs
 * every row shipped to the client to count it, and the day someone adds a
 * LIMIT to a read query for performance, every badge silently becomes a
 * smaller-but-plausible number. Nothing fails. The card is just wrong, in the
 * direction that looks fine.
 *
 * THE ASSERTION THAT MATTERS is that a count equals the length of the detail
 * query for the same principal — not that it equals some expected constant.
 * An aggregate discloses as surely as a row, so the two must receive the
 * identical authorisation scope, and the only way to know they do is to check
 * them against each other for every kind of reader.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-summary.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8816);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-summary-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { token } = {}) => {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json().catch(() => null);
};
/** A POST as somebody, with the status kept. */
const send = async (path, token, body = {}) => {
  const res = await fetch(BASE + path, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = (email, deviceId = "device-summary") => post("/api/auth/dev-login", { email, deviceId }).then((b) => b?.token);
const rowsOf = async (res, token) => (await api(`/api/read/${res}`, { token })).body?.rows || [];
const summaryOf = async (token) => (await api("/api/read/summary", { token })).body?.rows?.[0];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

// Every kind of reader the seed provides. The point is breadth: a count that
// happens to match for a school administrator proves nothing about a guardian.
const WHO = ["sarah", "coach", "parent", "spectator", "medical", "analyst", "scorer"];

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const tokens = {};
  for (const who of WHO) tokens[who] = await login(`${who}@example.invalid`);
  ok("every reader signed in", WHO.every((w) => !!tokens[w]));

  group("A count equals the records it counts, for every reader");
  const seen = {};
  for (const who of WHO) {
    const t = tokens[who];
    const s = await summaryOf(t);
    seen[who] = s;
    ok(`${who}: the summary answers at all`, !!s);
    if (!s) continue;
    // The whole architecture in one assertion, three times over.
    const players = await rowsOf("players", t);
    ok(`${who}: active players equals the roster they can read`, s.active_players === players.length);
    const injuries = await rowsOf("injuries", t);
    ok(`${who}: active injuries equals the restricted rows they can read`,
       s.injuries_active === injuries.filter((i) => i.restricted).length);
    const notifs = await rowsOf("notifications", t);
    ok(`${who}: unread alerts equals their own unread notifications`,
       s.unread_alerts === notifs.filter((n) => !n.read).length);
    const matches = await rowsOf("matches", t);
    ok(`${who}: the match scope equals the fixtures they can read`, s.scope_matches === matches.length);
    ok(`${who}: upcoming equals the scheduled fixtures they can read`,
       s.upcoming_matches === matches.filter((m) => m.status === "scheduled").length);
  }

  group("Read state is the person's, on every device, and the count moves with it (NOTIFICATIONS.md D17)");
  // Before S1 nothing wrote a receipt, so `read` was always false and the
  // assertion above held trivially (map 8.1, 8.2). Now: a notice opened on one
  // phone is read on the other, the count falls by exactly one on both, and
  // nobody else's count moves.
  {
    const phone = await login("parent@example.invalid", "device-summary-phone");
    const laptop = await login("parent@example.invalid", "device-summary-laptop");
    ok("the guardian is signed in on two devices", !!phone && !!laptop && phone !== laptop);
    const otherBefore = (await summaryOf(tokens.coach))?.unread_alerts;
    const before = (await summaryOf(laptop))?.unread_alerts;
    const list0 = await rowsOf("notifications", laptop);
    const target = list0.find((n) => !n.read && !n.tiered);
    ok("the guardian has an unread notice to open", !!target && before > 0, { before, n: list0.length });
    if (target) {
      const opened = await send(`/api/notifications/${target.id}/read`, phone);
      ok("opening it on the phone answers the notice, read", opened.status === 200 && opened.body?.notice?.id === target.id
         && opened.body?.notice?.read === true && opened.body?.notice?.body === target.body, opened);
      const after = (await summaryOf(laptop))?.unread_alerts;
      ok("on the laptop, unread_alerts fell by exactly one", after === before - 1, { before, after });
      ok("...and the open's own count is the summary's", opened.body?.unread === after);
      const list1 = await rowsOf("notifications", laptop);
      ok("...and the laptop's list says that notice is read", list1.find((n) => n.id === target.id)?.read === true);
      ok("...and still counts what it lists", after === list1.filter((n) => !n.read).length);
      const again = await send(`/api/notifications/${target.id}/read`, laptop);
      ok("opening it again is not a second receipt: the count stands", again.status === 200 && (await summaryOf(phone))?.unread_alerts === after);
      ok("another reader's count did not move", (await summaryOf(tokens.coach))?.unread_alerts === otherBefore);
      const all = await send("/api/notifications/read-all", phone);
      ok("Mark all read on the phone answers 0 unread", all.status === 200 && all.body?.unread === 0 && all.body?.marked === after, all.body);
      ok("...the laptop's count is 0 and every row it lists is read",
         (await summaryOf(laptop))?.unread_alerts === 0 && (await rowsOf("notifications", laptop)).every((n) => n.read));
      ok("...and the other reader's still did not move", (await summaryOf(tokens.coach))?.unread_alerts === otherBefore);
      ok("the receipts are the guardian's own, in the table",
         (await q(`select count(*)::int as n from notification_read r join app_user u on u.id = r.person_id
                    where u.email <> 'parent@example.invalid'`))[0].n === 0);
    }
  }

  group("A tiered notice lists its title; its body is read on open, and logged (D17)");
  {
    const medic = tokens.medical;
    const list = await rowsOf("notifications", medic);
    const tiered = list.find((n) => n.tiered);
    ok("the medical officer's list holds a tiered notice", !!tiered, list.map((n) => [n.kind, n.tiered]));
    if (tiered) {
      ok("...listed with its title and without its body", !!tiered.title && tiered.body === null);
      const logged = async () => (await q(
        `select count(*)::int as n from access_log where resource = 'notification.open' and $1 = any(record_ids)`, [tiered.id]))[0].n;
      const l0 = await logged();
      const opened = await send(`/api/notifications/${tiered.id}/read`, medic);
      ok("opening it answers the body", opened.status === 200 && typeof opened.body?.notice?.body === "string" && opened.body.notice.body.length > 0);
      ok("...and the open is on the record, once", (await logged()) === l0 + 1);
    }
    const plain = list.find((n) => !n.tiered);
    if (plain) {
      const l0 = (await q(`select count(*)::int as n from access_log where resource = 'notification.open' and $1 = any(record_ids)`, [plain.id]))[0].n;
      await send(`/api/notifications/${plain.id}/read`, medic);
      ok("a news.read notice's open is not logged",
         (await q(`select count(*)::int as n from access_log where resource = 'notification.open' and $1 = any(record_ids)`, [plain.id]))[0].n === l0);
    }
    // Somebody the injury notice is not for: the same answer as nonsense.
    if (tiered) {
      const watcher = await login("watcher@example.invalid");
      const r = await send(`/api/notifications/${tiered.id}/read`, watcher);
      const nonsense = await send(`/api/notifications/00000000-0000-4000-8000-000000000000/read`, watcher);
      ok("a reader the notice is not for gets 404 in D16's one sentence", r.status === 404 && r.body?.detail === "This notice is no longer available.", r);
      ok("...the same answer as an id that never existed", nonsense.status === 404 && nonsense.body?.detail === r.body?.detail);
      ok("...and no receipt was written for him",
         (await q(`select count(*)::int as n from notification_read r join app_user u on u.id = r.person_id
                    where u.email = 'watcher@example.invalid'`))[0].n === 0);
    }
  }

  group("Different readers legitimately get different numbers");
  // If every figure were identical across readers the endpoint would be
  // school-wide, which is the leak it was written to close.
  const playerCounts = new Set(WHO.map((w) => seen[w]?.active_players));
  ok("the roster count is not the same for everybody", playerCounts.size > 1);
  const parentSees = seen.parent?.active_players;
  const headSees = seen.sarah?.active_players;
  ok("a guardian sees fewer players than the director of sport", parentSees < headSees);
  ok("and a guardian's roster is small enough to be their own child",
     parentSees != null && parentSees <= 2);

  group("An absent figure says absent, not zero");
  // A dashboard that renders 0 for "no matches played" has stated something
  // false. These have to be null so a card can tell the difference.
  const medic = seen.medical;
  ok("a reader with no competitions gets null, not 0%, for win rate",
     medic && medic.win_rate_pct === null);
  ok("a reader who is not a player gets null for their own average",
     seen.sarah && seen.sarah.my_batting_average === null);
  ok("...and null for their own strike rate", seen.sarah && seen.sarah.my_strike_rate === null);

  group("Own career figures come from the ball log, not a constant");
  // The player card used to read 48.2 and 135 for everybody, forever.
  const pupil = (await q(
    `select u.email, u.player_id from app_user u where u.player_id is not null limit 1`))[0];
  ok("the seed links a pupil account to a player", !!pupil);

  // Before any deliveries exist. This is the honest state for most pupils most
  // of the season, and the card has to be able to say so rather than showing a
  // zero that reads as "averages nothing".
  const pt = await login(pupil.email);
  const before = await summaryOf(pt);
  ok("with no deliveries faced, the average is null rather than 0",
     before && before.my_batting_average === null);
  ok("...and so is the strike rate", before && before.my_strike_rate === null);

  // Now give them an innings. Written straight to the log: how the balls got
  // there is the scoring path's subject, not this walk's.
  const mid = (await q(
    `select id, school_id from match where status = 'complete' limit 1`))[0];
  const scorerUser = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  const stamp = `${Date.now()}-${Math.random()}`;
  // seq is per match and unique, so it is derived rather than assumed: a fixed
  // range makes this walk pass once and collide on the next run.
  const base = Number((await q(
    `select coalesce(max(seq), 0) + 1 as n from ball_event where match_id = $1`, [mid.id]))[0].n);
  for (let i = 0; i < 6; i++) {
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id,
                               device_id, idempotency_key, client_seq, client_ts, kind,
                               ball_type, value, striker_id, payload)
       values ($1, $2, $3, 1, 1, $4, 'device-summary', $5, $3, now(), 'ball', 'run', $6, $7, '{}'::jsonb)`,
      [mid.id, mid.school_id, base + i, scorerUser, `summary-${stamp}-${i}`, i % 3, pupil.player_id]);
  }
  const after = await summaryOf(pt);
  // /read/career answers for every player in scope, so the row has to be found
  // by id. Taking rows[0] compares this pupil's figures against whoever sorts
  // first — which is how this assertion failed for the wrong reason once.
  const career = ((await api("/api/read/career", { token: pt })).body?.rows || [])
    .find((r) => r.player_id === pupil.player_id);
  ok("once deliveries exist, the runs are reported", after?.my_runs != null && Number(after.my_runs) > 0);
  ok("and they match /read/career for the same person, to the run",
     career != null && Number(after.my_runs) === Number(career.runs));
  ok("a strike rate is derived rather than fixed", after?.my_strike_rate != null);
  ok("the figures are not the old hard-coded pair",
     Number(after.my_strike_rate) !== 135 && Number(after.my_batting_average) !== 48.2);

  group("Nothing is countable that is not readable");
  // Signed out, the endpoint must refuse rather than answer with totals.
  const anon = await api("/api/read/summary");
  ok("an unauthenticated request is refused", anon.status === 401 || anon.status === 403);
  ok("and returns no figures", !anon.body?.rows?.length);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`SUMMARY SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
