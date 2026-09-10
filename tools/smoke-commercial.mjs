#!/usr/bin/env node
/**
 * Sponsorship: what may be advertised to children, and what stays confidential.
 *
 * scrbrd-beta-2 had a commercial model, and two things about it are the reason
 * this walk exists.
 *
 * Its brandCategory list was Automotive, Banking, Sportswear, Nutrition,
 * Education and Telecom. Alcohol, gambling and tobacco were not on it — by
 * ABSENCE. A list that merely fails to mention betting is a list somebody
 * widens in a year without ever confronting the question, because there is
 * nothing there to argue with. Here those categories are PRESENT and refused,
 * with a note saying why, and the refusal is a trigger rather than a dropdown.
 *
 * And it counted impressions, viewableImpressions and clickThroughs. Delivery
 * counting is ordinary commercial reporting; the shape it invites on a
 * platform whose audience is children and their families is per-viewer
 * tracking. Nothing here records who saw anything, and the last group proves
 * there is nowhere for it to be recorded.
 *
 *   1. A PROHIBITED CATEGORY IS REFUSED, AND SAYS WHY.
 *   2. THE TERMS ARE MASKED. A director of sport sees the board is committed;
 *      only finance sees what it was sold for.
 *   3. THE OVERLAY CARRIES THE BOARD, NOT THE CONTRACT.
 *   4. NOTHING COUNTS AUDIENCES.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-commercial.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8831;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-commercial-secret" },
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
  method: "POST", body: { email, deviceId: "device-commercial" } })).body?.token;

const sign  = (token, body) => api("/api/sponsors", { method: "POST", token, body });
const place = (token, body) => api("/api/sponsorships", { method: "POST", token, body });
const read  = (what, token, qs = "") => api(`/api/read/${what}${qs}`, { token });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

const today = new Date().toISOString().slice(0, 10);
const nextYear = new Date(Date.now() + 300 * 864e5).toISOString().slice(0, 10);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const office  = await login("registrar@example.invalid");      // schooladmin: read + manage
  const bursar  = await login("bursar@example.invalid");         // finance: + finance.read
  const head    = await login("sarah@example.invalid");          // directorofsport: read only
  const coach   = await login("coach@example.invalid");          // neither
  const parent  = await login("parent@example.invalid");
  const wesAdmin = await login("registrar.wes@example.invalid"); // another school entirely

  group("A brand that may not be advertised to children is refused, and told why");
  for (const bad of ["gambling", "alcohol", "tobacco_vaping", "political"]) {
    const r = await sign(office, { schoolId: HIL, name: `Test ${bad}`, category: bad });
    ok(`${bad} is refused`, r.status === 422);
    // The note, not a code. "not_permitted" tells a school office nothing.
    ok(`...with the reason, not just a refusal`,
       typeof r.body?.detail === "string" && r.body.detail.length > 40);
  }
  ok("and none of them exists",
     (await q(`select count(*)::int c from sponsor where name like 'Test %'`))[0].c === 0);
  // THE POINT OF THE TABLE. The refused categories are not missing from the
  // vocabulary — they are in it, marked, with the argument written down.
  const cats = (await read("sponsor_categories", office)).body?.rows ?? [];
  ok("the refused categories are in the vocabulary, not omitted from it",
     ["gambling", "alcohol", "tobacco_vaping"].every((c) => cats.some((r) => r.name === c)));
  ok("...each marked refused", cats.filter((c) => !c.permitted).length >= 4);
  ok("...each carrying its reason", cats.filter((c) => !c.permitted).every((c) => !!c.note));

  group("Signing a sponsor is the school office's job");
  const bank = await sign(office, {
    schoolId: HIL, name: "Ridgeway Bank", category: "banking",
    logoText: "RIDGEWAY", logoBg: "#0b3d2e" });
  ok("a school administrator can sign one", bank.status === 200);
  ok("...and it is stored as given", bank.body?.logo_text === "RIDGEWAY");
  ok("a coach cannot sign a sponsor",
     [401, 403].includes((await sign(coach, { schoolId: HIL, name: "Coach Co", category: "retail" })).status));
  ok("nor a parent",
     [401, 403].includes((await sign(parent, { schoolId: HIL, name: "Parent Co", category: "retail" })).status));
  // Scope, not seniority. A school administrator is senior at their own school
  // and is nobody at somebody else's.
  ok("nor another school's administrator, who is senior — at their own school",
     [401, 403].includes((await sign(wesAdmin, { schoolId: HIL, name: "Westville Co", category: "retail" })).status));
  ok("...and Westville's own sponsor is fine",
     (await sign(wesAdmin, { schoolId: WES, name: "Westville Motors", category: "automotive" })).status === 200);
  ok("a malformed colour is refused before the database sees it",
     (await sign(office, { schoolId: HIL, name: "Bad Colour", category: "retail", logoBg: "green" })).status === 400);

  group("Placing them, and the terms that come with it");
  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now(),'T20',20,'live') returning id`, [HIL]))[0].id;

  const season = await place(office, {
    sponsorId: bank.body.id, placement: "broadcast_overlay",
    startsOn: today, endsOn: nextYear,
    contractValueZar: 185000, schoolSharePct: 70 });
  ok("the office can place a sponsor on the overlay", season.status === 200);
  ok("a coach cannot place one",
     [401, 403].includes((await place(coach, {
       sponsorId: bank.body.id, placement: "fixture_list",
       startsOn: today, endsOn: nextYear })).status));
  ok("an unknown placement is refused",
     (await place(office, { sponsorId: bank.body.id, placement: "assembly_hall",
                            startsOn: today, endsOn: nextYear })).status === 400);
  ok("a contract that ends before it starts is refused",
     (await place(office, { sponsorId: bank.body.id, placement: "ground_board",
                            startsOn: nextYear, endsOn: today })).status === 400);
  // The school on the placement is taken from the SPONSOR, never from the
  // request: a row whose two halves disagreed about whose board it is would be
  // a row the masking view anchors wrongly.
  ok("the placement inherits the sponsor's school",
     (await q(`select school_id from sponsorship where id = $1`, [season.body.id]))[0].school_id === HIL);

  group("What a board costs is not what a board says");
  const forBursar = (await read("sponsorships", bursar)).body?.rows ?? [];
  const forHead   = (await read("sponsorships", head)).body?.rows ?? [];
  const bursarRow = forBursar.find((r) => r.id === season.body.id);
  const headRow   = forHead.find((r) => r.id === season.body.id);

  ok("finance sees the value", Number(bursarRow?.contract_value_zar) === 185000);
  ok("...and the school's share", Number(bursarRow?.school_share_pct) === 70);
  // The director of sport is not being kept out of the placement. They need to
  // know the 1st XI overlay is committed until October. They do not need the
  // rand value, and that distinction is the entire reason for the mask.
  ok("the director of sport sees the placement", !!headRow);
  ok("...and the sponsor's name on it", headRow?.sponsor_name === "Ridgeway Bank");
  ok("...and the dates it runs", headRow?.starts_on != null && headRow?.ends_on != null);
  ok("...but not what it was sold for", headRow?.contract_value_zar === null);
  ok("...nor the split the school negotiated", headRow?.school_share_pct === null);
  // Masked at the source, not omitted by the query. The number is nowhere in
  // the bytes that left the server.
  ok("185000 is not anywhere in the director of sport's payload",
     !JSON.stringify(forHead).includes("185000"));

  group("A sponsor list is commercial information about the school");
  ok("a coach reads no sponsors at all",
     ((await read("sponsors", coach)).body?.rows ?? []).length === 0);
  ok("nor any placements", ((await read("sponsorships", coach)).body?.rows ?? []).length === 0);
  ok("a parent reads none either",
     ((await read("sponsors", parent)).body?.rows ?? []).length === 0);
  ok("another school's administrator reads none of Hilton's",
     !((await read("sponsors", wesAdmin)).body?.rows ?? []).some((r) => r.name === "Ridgeway Bank"));
  ok("...and none of Hilton's placements",
     !((await read("sponsorships", wesAdmin)).body?.rows ?? []).some((r) => r.sponsor_name === "Ridgeway Bank"));

  group("The overlay carries the board and nothing behind it");
  await api(`/api/matches/${m}/broadcast`, {
    method: "POST", token: head, body: { published: true, strapline: "Hilton v Michaelhouse" } });
  // Read as the spectator the overlay is actually for, not as an administrator.
  const spectator = await login("spectator@example.invalid");
  const raw = await read("broadcast_state", spectator, `?matchId=${m}`);
  const st = raw.body?.rows?.[0];
  ok("the overlay has state", !!st);
  ok("the sponsor is on it", st?.sponsor_name === "Ridgeway Bank");
  ok("...with what to draw", st?.sponsor_logo === "RIDGEWAY" && st?.sponsor_bg === "#0b3d2e");
  // broadcast_state() is SECURITY DEFINER, so the masking view would not have
  // saved this — the function has to not select the column at all.
  ok("the contract value is not in the overlay payload",
     !JSON.stringify(raw.body).includes("185000"));
  ok("...nor the share", !JSON.stringify(raw.body).includes('"school_share_pct"'));
  ok("no key on the overlay mentions money",
     !Object.keys(st ?? {}).some((k) => /value|zar|price|share|contract|fee/i.test(k)));

  group("A fixture-specific board outranks the season deal");
  const derbyBrand = await sign(office, {
    schoolId: HIL, name: "Derby Day Outfitters", category: "sportswear", logoText: "DDO" });
  await place(office, {
    sponsorId: derbyBrand.body.id, placement: "broadcast_overlay",
    matchId: m, startsOn: today, endsOn: nextYear, contractValueZar: 9000 });
  ok("the one-off board wins for that fixture",
     (await read("broadcast_state", spectator, `?matchId=${m}`)).body?.rows?.[0]?.sponsor_name
       === "Derby Day Outfitters");
  const other = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Kearsney', now(),'T20',20,'live') returning id`, [HIL]))[0].id;
  await api(`/api/matches/${other}/broadcast`, {
    method: "POST", token: head, body: { published: true } });
  ok("...and the season deal still runs everywhere else",
     (await read("broadcast_state", spectator, `?matchId=${other}`)).body?.rows?.[0]?.sponsor_name
       === "Ridgeway Bank");
  // A board is sold for a period. An expired contract is not a board.
  // Both dates moved, not just the end: ends_on >= starts_on is a CHECK, and a
  // contract that finished last week started before that.
  await q(`update sponsorship set starts_on = current_date - 30, ends_on = current_date - 1
            where sponsor_id in ($1,$2)`, [bank.body.id, derbyBrand.body.id]);
  ok("an expired contract is off the screen",
     (await read("broadcast_state", spectator, `?matchId=${m}`)).body?.rows?.[0]?.sponsor_name == null);

  group("Nothing counts the audience");
  // beta-2 carried impressions, viewableImpressions and clickThroughs. The
  // assertion is not that this code declines to increment them — it is that
  // there is no column anywhere for a per-viewer count to be written to, so a
  // future feature has to add one deliberately rather than find one waiting.
  const cols = await q(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('sponsor','sponsorship','sponsor_category','match_broadcast')`);
  ok("no impression counters anywhere in the commercial tables",
     !cols.some((c) => /impression|view_count|views|click|reach|audience|viewer/i.test(c.column_name)));
  ok("...and nothing keyed to a person who watched",
     !cols.some((c) => /(viewed|watched|seen)_by/i.test(c.column_name)));

  group("The vocabulary is not editable through the API");
  // Not "an admin cannot"; NOBODY can. Changing what may be advertised to
  // children is a migration somebody reviews, and sponsor_category has a read
  // policy and no write policy at all.
  const wr = await q(
    `select count(*)::int c from pg_policies
      where tablename = 'sponsor_category' and cmd <> 'SELECT'`);
  ok("sponsor_category has no write policy for anyone", wr[0].c === 0);
  ok("...and its read policy exists",
     (await q(`select count(*)::int c from pg_policies
                where tablename = 'sponsor_category' and cmd = 'SELECT'`))[0].c === 1);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`COMMERCIAL SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
