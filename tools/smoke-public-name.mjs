#!/usr/bin/env node
/**
 * A child's name on the public pages, over HTTP (SCRBRD-083 C1–C5; PILOT_LOAD
 * gap 5): public-name-api.mjs's routes, each calling db/47's door as the
 * caller, and the public page's answer on the very next request after each.
 *
 * tools/smoke-public.mjs drives the same doors in SQL; this drives them the
 * way the screens do, and holds the public log to them:
 *
 *   1. A guardian consents for his own child, and the public page names the
 *      boy on the next request — no wait: the route drops the cache on
 *      commit. He is refused for another family's child, and cannot read it.
 *   2. Who reads what: the parent his own answer, never a mark nor its
 *      reason; the office every guardian's answer and the mark; the director
 *      of sport the mark and no guardian; a coach nothing at all.
 *   3. The never-public mark overrides a consent at once, and ending it puts
 *      the name back; a coach cannot set it, nor set it without a reason.
 *   4. The office withdraws a consent on the family's word: gone on the next
 *      request, a finished scorecard included (whose cache holds 60 s); the
 *      family's own screen says the office did it. A "yes" from the office
 *      needs the form and its date.
 *   5. Names off for an age group: the director of sport switches the open
 *      sides off and every Hilton name goes; another school's publisher and
 *      a coach are refused; back on, back.
 *   6. A parent's own "no" reaches the finished page on the next request.
 *   7. Malformed requests are refused by name.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-public-name.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { buildPublicFixture, EXPECTED, HIL } from "./fixture-public.mjs";

const PORT = port(8849);
const BASE = `http://127.0.0.1:${PORT}`;
const VERSION = "public-names-2026-10";
const REASON = "A court order, recorded by the walk";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-public-name-secret",
         PORT: String(PORT), PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: "smoke-public-name-pseudonyms-0123456789", PUBLIC_TRUST_PROXY_HOPS: "1" },
  stdio: ["ignore", "pipe", "pipe"] });
const serverErr = /** @type {string[]} */ ([]);
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const owner = new pg.Pool({ connectionString: ownerUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;

let nextIp = 0;
/** One signed-out read, from an address of its own (the rate limit is smoke-public's). */
const publicLog = async (/** @type {string} */ id) => {
  const r = await fetch(`${BASE}/api/public/matches/${id}/log`, { headers: { "x-forwarded-for": `10.84.${(++nextIp >> 8) & 255}.${nextIp & 255}` } });
  return r.status === 200 ? r.json() : { status: r.status, people: {} };
};
/** The names the public log gives, as a sorted list. */
const named = async (/** @type {string} */ id) => Object.values((await publicLog(id)).people ?? {}).sort();

const login = async (/** @type {string} */ email) => (await (await fetch(`${BASE}/api/auth/dev-login`, { method: "POST",
  headers: { "content-type": "application/json" }, body: JSON.stringify({ email, deviceId: "smoke-public-name" }) })).json()).token;
/** @returns {Promise<{status: number, body: any, text: string}>} */
async function call(/** @type {string} */ token, /** @type {string} */ path, /** @type {any} */ body) {
  const r = await fetch(BASE + path, body === undefined ? { headers: { authorization: `Bearer ${token}` } }
    : { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, body: json, text };
}

try {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const fx = await buildPublicFixture(q);
  const { pub, pub2, ids, guardians } = fx;
  const T = {
    erasmusMum: await login("guardian.erasmus@example.invalid"),
    bothaMum: await login("guardian.botha@example.invalid"),
    sarah: await login("sarah@example.invalid"),            // director of sport, Hilton
    registrar: await login("registrar@example.invalid"),    // the office, Hilton
    coach: await login("coach@example.invalid"),
    wes: await login("publisher.wes@example.invalid"),      // Westville's publisher
  };
  for (const m of [pub, pub2]) {
    const r = await call(T.sarah, `/api/matches/${m}/publication`, { side: "home", published: true });
    ok(`Hilton publishes its side of ${m === pub ? "PUB (live)" : "PUB2 (finished)"}`, r.status === 200, r.text);
  }
  ok("before anybody answers, nobody is named", (await named(pub)).length === 0, (await named(pub)).join(","));

  group("1. A guardian consents for his own child, and only his own");
  {
    const before = await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`);
    ok("his read: his own answer, unanswered, and the label the page would use", before.status === 200
       && before.body.mine?.state === "not_answered" && before.body.label === EXPECTED.erasmus, before.text);
    ok("...and nothing of the office's or of a mark", before.body.guardians === null && before.body.mark === null, before.text);
    const yes = await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`, { yes: true, version: VERSION });
    ok("he says yes", yes.status === 200, yes.text);
    ok("the very next public request names D Erasmus (the route dropped the cache)", (await named(pub)).includes(EXPECTED.erasmus), (await named(pub)).join(","));
    const after = (await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`)).body;
    ok("his read: on, recorded by him", after.mine?.state === "given" && after.mine?.actor === "you", JSON.stringify(after.mine));
    const again = await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`, { yes: true, version: VERSION });
    ok("a second yes is 409 already_given", again.status === 409 && again.body?.error === "already_given", again.text);
    const other = await call(T.erasmusMum, `/api/players/${ids.botha}/public-name`, { yes: true, version: VERSION });
    ok("he is refused for another family's child (403 not_permitted)", other.status === 403 && other.body?.error === "not_permitted", other.text);
    ok("...and the other child is not named", !(await named(pub)).includes(EXPECTED.botha));
    const peek = await call(T.erasmusMum, `/api/players/${ids.botha}/public-name`);
    ok("...nor can he read the other child's answer (404)", peek.status === 404, peek.text);
    const ndaba = await call(T.erasmusMum, `/api/players/${ids.ndaba}/public-name`, { yes: true, version: VERSION });
    ok("...nor a child with no guardian at all", ndaba.status === 403, ndaba.text);
    const bothaYes = await call(T.bothaMum, `/api/players/${ids.botha}/public-name`, { yes: true, version: VERSION });
    ok("Liam Botha's own guardian says yes, and he is named on the next request", bothaYes.status === 200
       && (await named(pub)).includes(EXPECTED.botha), bothaYes.text);
  }

  group("2. Who reads what");
  {
    const office = (await call(T.registrar, `/api/players/${ids.erasmus}/public-name`)).body;
    const g = office?.guardians?.find((/** @type {any} */ x) => x.guardianId === guardians.erasmus);
    ok("the office: each guardian's answer — his yes, made by him", g?.state === "given" && g?.actor === "guardian" && office.guardians.length === 1, JSON.stringify(office));
    ok("...and the mark, unset", office?.mark?.marked === false, JSON.stringify(office?.mark));
    const dos = (await call(T.sarah, `/api/players/${ids.erasmus}/public-name`)).body;
    ok("the director of sport: the mark, and no guardian (she does not record links)", dos?.mark?.marked === false && dos?.guardians === null, JSON.stringify(dos));
    const coach = await call(T.coach, `/api/players/${ids.erasmus}/public-name`);
    ok("a coach: not found", coach.status === 404, coach.text);
  }

  group("3. The never-public mark overrides a consent");
  {
    const coach = await call(T.coach, `/api/players/${ids.erasmus}/never-public`, { reason: REASON });
    ok("a coach cannot set it (403)", coach.status === 403 && coach.body?.error === "not_permitted", coach.text);
    const bare = await call(T.sarah, `/api/players/${ids.erasmus}/never-public`, {});
    ok("nor anyone without a reason (422 no_reason)", bare.status === 422 && bare.body?.error === "no_reason", bare.text);
    const set = await call(T.sarah, `/api/players/${ids.erasmus}/never-public`, { reason: REASON });
    ok("the director of sport marks Daniel Erasmus never-public", set.status === 200, set.text);
    ok("the very next public request does not name him, though his consent stands", !(await named(pub)).includes(EXPECTED.erasmus)
       && (await named(pub)).includes(EXPECTED.botha), (await named(pub)).join(","));
    const twice = await call(T.registrar, `/api/players/${ids.erasmus}/never-public`, { reason: "again" });
    ok("a second mark is 409 already_marked", twice.status === 409, twice.text);
    const office = (await call(T.registrar, `/api/players/${ids.erasmus}/public-name`)).body;
    ok("the office reads the mark and its reason", office?.mark?.marked === true && office.mark.reason === REASON, JSON.stringify(office?.mark));
    const mum = await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`);
    ok("his parent's read: her answer still on, no mark, no reason", mum.body?.mine?.state === "given" && mum.body?.mark === null
       && !mum.text.includes(REASON) && !/reason/i.test(mum.text), mum.text);
    const end = await call(T.registrar, `/api/players/${ids.erasmus}/never-public/end`, {});
    ok("the office ends the mark", end.status === 200, end.text);
    ok("...and he is named again on the next request", (await named(pub)).includes(EXPECTED.erasmus));
    const endAgain = await call(T.registrar, `/api/players/${ids.erasmus}/never-public/end`, {});
    ok("ending it again is 409 not_marked", endAgain.status === 409, endAgain.text);
  }

  group("4. The office withdraws a consent on the family's word");
  {
    ok("the finished PUB2 names L Botha", (await named(pub2)).includes(EXPECTED.botha));
    const coachNo = await call(T.coach, `/api/players/${ids.botha}/public-name`, { yes: false, version: VERSION, guardianId: guardians.botha });
    ok("a coach cannot record it (403)", coachNo.status === 403, coachNo.text);
    const t0 = Date.now();
    const no = await call(T.registrar, `/api/players/${ids.botha}/public-name`, { yes: false, version: VERSION, guardianId: guardians.botha });
    ok("the office records the family's no", no.status === 200, no.text);
    const p2 = await named(pub2), p1 = await named(pub);
    ok(`the very next request: gone from the finished scorecard (${Date.now() - t0} ms; its cache holds 60 s)`, !p2.includes(EXPECTED.botha), p2.join(","));
    ok("...and from the live page", !p1.includes(EXPECTED.botha), p1.join(","));
    const mum = (await call(T.bothaMum, `/api/players/${ids.botha}/public-name`)).body;
    ok("the family's own read: off, turned off by the office", mum?.mine?.state === "withdrawn" && mum.mine.actor === "office", JSON.stringify(mum?.mine));
    const bare = await call(T.registrar, `/api/players/${ids.botha}/public-name`, { yes: true, version: VERSION, guardianId: guardians.botha });
    ok("an office yes without the form is 422 form_required", bare.status === 422 && bare.body?.error === "form_required", bare.text);
    const future = await call(T.registrar, `/api/players/${ids.botha}/public-name`,
      { yes: true, version: VERSION, guardianId: guardians.botha, formName: "Admission form", formDate: "2099-01-01" });
    ok("...or with a form dated in the future", future.status === 422 && future.body?.error === "form_in_future", future.text);
    const form = await call(T.registrar, `/api/players/${ids.botha}/public-name`,
      { yes: true, version: VERSION, guardianId: guardians.botha, formName: "Admission form 2026", formDate: "2026-01-20" });
    ok("with the form and its date it is recorded, and he is named on the next request", form.status === 200
       && (await named(pub)).includes(EXPECTED.botha), form.text);
    const office = (await call(T.registrar, `/api/players/${ids.botha}/public-name`)).body;
    ok("...the office's read: on, from a form", office?.guardians?.[0]?.state === "given" && office.guardians[0].fromForm === true, JSON.stringify(office?.guardians));
  }

  group("5. Names off for an age group");
  {
    const read = await call(T.sarah, `/api/schools/${HIL}/public-names`);
    const open = read.body?.groups?.find((/** @type {any} */ g) => g.ageGroup === "open");
    ok("the director of sport reads the switches and may change them", read.status === 200 && read.body.mayChange === true && open?.namesOff === false, read.text);
    ok("...a school's own groups only: U9–U16 and open", read.body?.groups?.map((/** @type {any} */ g) => g.ageGroup).join(",") === "U9,U10,U11,U12,U13,U14,U15,U16,open", read.text);
    const coachRead = await call(T.coach, `/api/schools/${HIL}/public-names`);
    ok("a coach reads them, and may not change them", coachRead.status === 200 && coachRead.body.mayChange === false, coachRead.text);
    const coachSet = await call(T.coach, `/api/schools/${HIL}/public-names`, { ageGroup: "open", off: true });
    ok("...and is refused (403)", coachSet.status === 403, coachSet.text);
    const wes = await call(T.wes, `/api/schools/${HIL}/public-names`, { ageGroup: "open", off: true });
    ok("Westville's publisher is refused at Hilton (403)", wes.status === 403, wes.text);
    const bad = await call(T.sarah, `/api/schools/${HIL}/public-names`, { ageGroup: "U99", off: true });
    ok("an unknown age group is 422 unknown_age_group", bad.status === 422 && bad.body?.error === "unknown_age_group", bad.text);
    const off = await call(T.sarah, `/api/schools/${HIL}/public-names`, { ageGroup: "open", off: true });
    ok("she switches the open sides' names off", off.status === 200, off.text);
    const n = await named(pub);
    ok("the very next request names no Hilton boy", !n.includes(EXPECTED.erasmus) && !n.includes(EXPECTED.botha), n.join(","));
    ok("...and the switch reads off", (await call(T.sarah, `/api/schools/${HIL}/public-names`)).body?.groups?.find((/** @type {any} */ g) => g.ageGroup === "open")?.namesOff === true);
    const on = await call(T.sarah, `/api/schools/${HIL}/public-names`, { ageGroup: "open", off: false });
    ok("back on: both named again on the next request", on.status === 200 && (await named(pub)).includes(EXPECTED.erasmus)
       && (await named(pub)).includes(EXPECTED.botha), (await named(pub)).join(","));
  }

  group("6. A parent's own no reaches the finished page at once");
  {
    ok("the finished PUB2 names D Erasmus", (await named(pub2)).includes(EXPECTED.erasmus));
    const no = await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`, { yes: false, version: VERSION });
    ok("his parent says no", no.status === 200, no.text);
    ok("the very next request: gone from the finished scorecard and the live page",
       !(await named(pub2)).includes(EXPECTED.erasmus) && !(await named(pub)).includes(EXPECTED.erasmus));
    const rec = await q(`select end_reason, ended_on is not null as ended from public_name_consent where player_id = $1 order by seq`, [ids.erasmus]);
    ok("the record is end-dated as withdrawn, not deleted", rec.length === 1 && rec[0].end_reason === "withdrawn" && rec[0].ended, JSON.stringify(rec));
  }

  group("7. Malformed requests");
  {
    ok("no answer: 400 no_answer", (await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`, { version: VERSION })).body?.error === "no_answer");
    ok("no version: 422 no_consent_version", (await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`, { yes: true })).body?.error === "no_consent_version");
    ok("a child id that is not one: 404", (await call(T.erasmusMum, `/api/players/not-a-uuid/public-name`)).status === 404);
    ok("a parent's form: 422 form_is_for_the_office", (await call(T.erasmusMum, `/api/players/${ids.erasmus}/public-name`,
      { yes: true, version: VERSION, formName: "x", formDate: "2026-01-01" })).body?.error === "form_is_for_the_office");
    ok("signed out: 401", (await fetch(`${BASE}/api/players/${ids.erasmus}/public-name`)).status === 401);
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", /** @type {any} */ (e)?.stack ?? e);
} finally {
  server.kill();
  await owner.end();
}

if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
console.log(`\nPUBLIC NAME (API): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
