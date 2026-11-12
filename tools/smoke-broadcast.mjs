#!/usr/bin/env node
/**
 * The broadcast overlay, and the names that do not go on it.
 *
 * scrbrd-beta-2's answer to broadcast was a 4,172-line scorer that kept its
 * own idea of the score. This is presentation over the same replay everything
 * else reads — there is no second engine here, and no stored score to drift.
 *
 * The assertions that matter are about what leaves the API, not about what a
 * screen draws. A scoreboard at the boundary is seen by people who walked to
 * the ground; a stream overlay is permanent, copyable, and watched by an
 * audience nobody at the match chose.
 *
 *   1. NOT PUBLISHED, NOTHING. A fixture nobody has opted in yields no state.
 *   2. NO CHILD IS NAMED (db/149; Kameel, 11 Nov 2026, Q1(e): "the stream
 *      caption: role words ('Batter') until its own consent"). Whatever the
 *      fixture's name_display, and even for a boy the public page would name,
 *      the overlay says "Batter", "Non-striker", "Bowler": no name, initial or
 *      surname anywhere in the payload, signed in or signed out.
 *   3. PUBLISHING IS ITS OWN CAPABILITY. Scheduling a match is not
 *      broadcasting one.
 *   4. THE OVERLAY CARRIES NOTHING ELSE. No identifiers, no dates of birth, no
 *      contact details — only what is already being read over a PA system.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-broadcast.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { nameFor } from "../services/api/public/redact.mjs";

const PORT = port(8830);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 240)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-broadcast-secret" },
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
  method: "POST", body: { email, deviceId: "device-broadcast" } })).body?.token;

const publish = (matchId, token, body) =>
  api(`/api/matches/${matchId}/broadcast`, { method: "POST", token, body });
// The raw response, not just the rows: an assertion about what is NOT in a
// payload has to look at the payload.
const overlayRaw = async (matchId, token) =>
  await api(`/api/read/broadcast_state?matchId=${matchId}`, { token });
const overlay = async (matchId, token) => (await overlayRaw(matchId, token)).body?.rows?.[0] ?? null;

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const head   = await login("sarah@example.invalid");   // directorofsport: broadcast.publish
  const coach  = await login("coach@example.invalid");   // fixture.read, no broadcast.publish
  const scorer = await login("scorer@example.invalid");
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;

  // Three children with GIVEN NAMES IN FULL, which the seed does not have.
  //
  // This matters more than it looks. The seeded roster is already written the
  // way a scorecard writes it — "K Botha" — so masking it to initials returns
  // the same string, and an assertion that "the full name is not in the
  // payload" passes without the masker doing anything at all. The first
  // version of this walk proved nothing for exactly that reason. A name has to
  // have something to lose before you can prove it was taken away.
  const picked = await q(
    `select id from player where team_code = '1XI' and school_id = $1
      order by full_name limit 3`, [HIL]);
  const NAMES = ["Thandeka Mahlangu", "Sipho Ngcobo", "Werner van Rensburg"];
  const [bat, other, bowl] = await Promise.all(picked.map(async (p, i) =>
    (await q(`update player set full_name = $2 where id = $1 returning id, full_name`,
             [p.id, NAMES[i]]))[0]));

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now(),'T20',20,'live') returning id`, [HIL]))[0].id;
  const stamp = `${Date.now()}-${Math.random()}`;
  let seq = 0;
  // Counted rather than asserted as a constant: the last time this walk
  // hard-coded a total it was wrong, and a test that disagrees with its own
  // fixture teaches nothing about the code.
  let expectedRuns = 0;
  const ball = async (value) => {
    seq += 1;
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind, ball_type, value,
                               striker_id, non_striker_id, bowler_id, payload)
       values ($1,$2,$3,1,0,$4,'device-bcast',$5,$3,now(),'ball','run',$6,$7,$8,$9,'{}'::jsonb)`,
      [m, HIL, seq, su, `bc-${stamp}-${seq}`, value, bat.id, other.id, bowl.id]);
  };
  for (let i = 0; i < 12; i++) {
    const v = i % 6 === 0 ? 4 : 1;
    expectedRuns += v;
    await ball(v);
  }

  group("A fixture nobody published is not on the air");
  ok("no state for an unpublished fixture", (await overlay(m, head)) === null);
  ok("...not even for the person who could publish it", (await overlay(m, head)) === null);

  group("Publishing is its own capability");
  ok("a coach cannot put a fixture on a public screen",
     [403, 401].includes((await publish(m, coach, { published: true })).status));
  ok("nor a scorer, who is the one actually at the ground",
     [403, 401].includes((await publish(m, scorer, { published: true })).status));
  ok("nor an unauthenticated caller",
     [401, 403].includes((await publish(m, undefined, { published: true })).status));
  ok("still nothing on the air", (await overlay(m, head)) === null);

  // The batter is a boy the PUBLIC PAGE would name: a verified guardian's
  // consent, live, and Hilton's side of the fixture published. The overlay
  // still does not (Q1(e)): its own consent does not exist yet.
  const office = (await q(`select id from app_user where email = 'registrar@example.invalid'`))[0]?.id
    ?? (await q(`select id from app_user where school_id = $1 order by email limit 1`, [HIL]))[0].id;
  {
    const gu = (await q(`insert into app_user (school_id, email, name, role)
                         values ($1, 'broadcast.parent@example.invalid', 'Broadcast Parent', 'guardian') returning id`, [HIL]))[0].id;
    const ga = (await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [gu, HIL]))[0].id;
    const gl = (await q(
      `insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                       consent_state, consent_version, consent_at, created_by, valid_from)
       values ($1, $2, 'parent', 'verified', $3, now() - interval '30 days', 'granted', 'popia-2026-01',
               now() - interval '30 days', $3, sa_today() - 30) returning id`, [ga, bat.id, office]))[0].id;
    await q(`insert into public_name_consent (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on, recorded_by)
             values ($1, 'guardian', $2, $3, 'public-names-2026-09', sa_today() - 10, $4)`, [bat.id, ga, gl, office]);
    await q(`update public_names_off set names_off = false where school_id = $1`, [HIL]);
    await q(`insert into fixture_publication (match_id, side, school_id, team_code, published, set_by)
             values ($1, 'home', $2, '1XI', true, $3)`, [m, HIL, office]);
  }
  const people = await q(`select * from public_match_people($1)`, [m]);
  const servedOn = people[0]?.served_on;
  ok("control: the public page would name the batter (publicName() over its own read)",
     !!nameFor(people.find((p) => p.player_id === bat.id), servedOn));

  /** Every word of every child's name, which no overlay payload may carry. */
  const nameWords = [bat, other, bowl].flatMap((p) => p.full_name.split(" "));
  const leaks = (/** @type {string} */ s) => nameWords.filter((w) => s.includes(w));
  const roles = (/** @type {any} */ s) =>
    s?.striker === "Batter" && s?.non_striker === "Non-striker" && s?.bowler === "Bowler";

  group("No child is named: role words, whatever the school chose");
  const up = await publish(m, head, { published: true, strapline: "Hilton v Michaelhouse · 1st XI" });
  ok("the director of sport can publish", up.status === 200);
  ok("...and it defaults to initials without anybody choosing", up.body?.name_display === "initials");

  const raw = await overlayRaw(m, head);
  const payload = JSON.stringify(raw.body);
  const st = raw.body?.rows?.[0];
  ok("the overlay has state", !!st);
  ok("the score is the derived one, not a stored one",
     Number(st?.runs) === expectedRuns && Number(st?.legal_balls) === 12);
  ok("...with the overs a human says out loud", st?.overs === "2.0");
  // THE ONE THAT MATTERS. Not "the widget renders a role" — no name, initial
  // or surname is in the response at all, the consented boy's included.
  ok("the striker, non-striker and bowler are role words", roles(st));
  ok("no word of any child's name is in the payload", leaks(payload).length === 0);

  // Signed out: the database function the API reads, called as the
  // application with nobody signed in, gives the same row.
  {
    const app = new pg.Client({ connectionString: appUrl() });
    await app.connect();
    try {
      await app.query("begin");
      await app.query("select set_config('app.user_id', '', true)");
      const out = (await app.query("select * from broadcast_state($1)", [m])).rows[0];
      await app.query("rollback");
      ok("signed out reads the same row as the director of sport",
         JSON.stringify(out) === JSON.stringify(st) && roles(out));
    } finally { await app.end(); }
  }
  ok("a coach signed in reads the same names: none", roles(await overlay(m, coach)));

  group("The overlay carries nothing but the scoreboard");
  const keys = Object.keys(st ?? {});
  ok("no identifiers of any kind",
     !keys.some((k) => /id_number|identity|passport/i.test(k)) && !/id_number/.test(payload));
  ok("no dates of birth", !keys.some((k) => /born|dob|birth/i.test(k)));
  ok("no contact details", !keys.some((k) => /email|phone|address|guardian/i.test(k)));
  ok("the strapline the school chose is there", st?.strapline === "Hilton v Michaelhouse · 1st XI");

  group("A school choosing full names still names nobody (Q1(e))");
  const full = await publish(m, head, { published: true, nameDisplay: "full" });
  ok("the setting is kept as the school chose it", full.body?.name_display === "full");
  const named = await overlayRaw(m, head);
  ok("...and the overlay still says only the roles", roles(named.body?.rows?.[0]));
  ok("...with no word of any child's name in the payload", leaks(JSON.stringify(named.body)).length === 0);
  ok("the row remembers who decided",
     !!(await q(`select published_by from match_broadcast where match_id = $1`, [m]))[0]?.published_by);

  // PUBLIC_BY_TERMS slice 1: "a marked, a switched-off and an unanswered child
  // are role words on the overlay read". The non-striker under a never-public
  // mark (the DSO's), the school's names switched off for the consenting
  // batter, and the bowler, whose family never answered. Each is controlled
  // against the public page's own read first, so the overlay is proved for
  // the three states and not for boys who only looked like them.
  group("A marked, a switched-off and an unanswered child: role words (PUBLIC_BY_TERMS slice 1)");
  const dso = (await q(`select id from app_user where email = 'dso@example.invalid'`))[0]?.id ?? office;
  await q(`insert into player_never_public (player_id, reason, set_on, set_by) values ($1, 'Smoke: a mark', sa_today(), $2)`, [other.id, dso]);
  await q(`insert into public_names_off (school_id, age_group, names_off, set_by)
           select $1, birth_age_group(p.born, sa_today()), true, $2 from player p where p.id = $3 and p.born is not null
           on conflict (school_id, age_group) do update set names_off = true`, [HIL, office, bat.id]);
  {
    const facts = new Map((await q(`select player_id, facts from public_match_people($1)`, [m])).map((r) => [r.player_id, r.facts]));
    ok("control: the non-striker is marked, the batter's names are off, the bowler has no answer on file",
       facts.get(other.id)?.neverPublic === true && facts.get(bat.id)?.namesOff === true
       && Array.isArray(facts.get(bowl.id)?.consents) && facts.get(bowl.id).consents.length === 0,
       JSON.stringify([...facts.values()]));
    const marked = await overlayRaw(m, head);
    ok("the overlay says only the roles", roles(marked.body?.rows?.[0]), JSON.stringify(marked.body?.rows?.[0]));
    ok("...with no word of any of the three names in the payload", leaks(JSON.stringify(marked.body)).length === 0,
       leaks(JSON.stringify(marked.body)).join(", "));
    ok("...and the same for a coach signed in", roles(await overlay(m, coach)));
  }
  await q(`update player_never_public set ended_on = sa_today(), ended_by = set_by, ended_at = now()
            where player_id = $1 and ended_on is null`, [other.id]);
  await q(`update public_names_off set names_off = false where school_id = $1`, [HIL]);

  group("An age group a school will not name at all");
  await publish(m, head, { published: true, nameDisplay: "none" });
  const anon = await overlayRaw(m, head);
  const anonSt = anon.body?.rows?.[0];
  ok("no player is named: the same role words", roles(anonSt));
  ok("...and no name is in the payload either", leaks(JSON.stringify(anon.body)).length === 0);
  ok("but the score still goes out — that is the point of the screen",
     Number(anonSt?.runs) === expectedRuns);

  group("Officials are adults doing a public job");
  await q(
    `insert into match_official (match_id, school_id, duty, person_name, panel, appointed_by)
     values ($1,$2,'umpire','Thandeka Mahlangu','KZN Cricket Umpires',$3)`, [m, HIL, su]);
  await publish(m, head, { published: true });
  ok("an umpire is named in full even when the players are initialled",
     (await overlay(m, head))?.officials === "Thandeka Mahlangu");
  await publish(m, head, { published: true, showOfficials: false });
  ok("...unless the school turns it off", (await overlay(m, head))?.officials === null);

  group("Taking it off the air stops the overlay dead");
  ok("the fixture is unpublished", (await publish(m, head, { published: false })).status === 200);
  ok("...and there is no state to serve", (await overlay(m, head)) === null);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`BROADCAST SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
