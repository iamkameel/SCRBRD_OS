#!/usr/bin/env node
/**
 * The signed-out read path (SCRBRD-083 phase 1), against a real server and a
 * real database. Leakage is the point: every public answer for every fixture
 * — the seed's and two of this walk's own — is read in full, in every state
 * the rule has (unpublished, published with nobody consenting, consents,
 * a never-public mark, names switched off for an age group, the other side
 * published, a consent withdrawn), and asserted to carry no player id, no
 * date of birth, no age, no photo, no reason, and no name the rule did not
 * give.
 *
 *   1. Off by default: a server without PUBLIC_PAGES=on answers every public
 *      path with the one 404, for a published fixture too.
 *   2. Unpublished is not found, and reads exactly like a fixture that does
 *      not exist, and a malformed id, on the API and on the shells.
 *   3. Signed out means nobody: the application role with no identity reads
 *      no base table at all, and the public reads still answer — only
 *      through db/59's functions.
 *   4. Names by the rule, on the next request after each change: consents,
 *      the mark, names-off, the away side publishing, the office withdrawing
 *      a consent (a finished fixture, whose cache would otherwise hold 60 s:
 *      so it is the notification, not the clock).
 *   5. Pseudonyms: stable within a match, never shared between two.
 *   6. A staff token changes nothing; noindex and Cache-Control on every
 *      answer; the rate limit answers 429.
 *   7. The shot and where it went (SCRBRD-139, db/78): the page's own
 *      commentary over the public log says "D Erasmus, driven through cover
 *      for four"; an unconsented boy's placed ball names the place and not
 *      him; and no response the walk read, of any kind, carried a
 *      coordinate or anything a placement was made from.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-public.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { buildPublicFixture, PEOPLE, TYPED_FIELDER, KEARSNEY, EXPECTED, HIL } from "./fixture-public.mjs";
import { deriveCommentary } from "@scrbrd/scoring";
import { foldable } from "../apps/web/src/public/publicLog.js";

const PORT = port(8846), OFF_PORT = port(8847);
const BASE = `http://127.0.0.1:${PORT}`, OFF = `http://127.0.0.1:${OFF_PORT}`;
const SEEDED = "77777777-0000-0000-0000-000000000004";   // the seed's scored fixture (96 balls)
const MISSING = "77777777-0000-0000-0000-0000000fffff";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const env = (/** @type {Record<string, string>} */ extra) => ({ ...process.env, DATABASE_URL: appUrl(), NODE_ENV: "development",
  ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-public-secret", ...extra });
const servers = [
  spawn(process.execPath, ["services/api/server.mjs"], { env: env({ PORT: String(PORT), PUBLIC_PAGES: "on",
    PUBLIC_PSEUDONYM_SECRET: "smoke-public-pseudonyms-0123456789abcdef", PUBLIC_TRUST_PROXY_HOPS: "1" }), stdio: ["ignore", "pipe", "pipe"] }),
  spawn(process.execPath, ["services/api/server.mjs"], { env: env({ PORT: String(OFF_PORT), PUBLIC_PAGES: "" }), stdio: ["ignore", "pipe", "pipe"] }),
];
const serverErr = [];
for (const s of servers) s.stderr.on("data", (d) => serverErr.push(d.toString()));

const owner = new pg.Pool({ connectionString: ownerUrl() });
const app = new pg.Pool({ connectionString: appUrl() });
const q = async (/** @type {string} */ t, /** @type {any[]} */ p = []) => (await owner.query(t, p)).rows;
/** SQL as one person, through the application role, as the API runs it. */
async function as(/** @type {string} */ user, /** @type {string} */ text, /** @type {any[]} */ params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.device_id', 'smoke-public', true)", [user]);
    const r = (await c.query(text, params)).rows;
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
const userId = async (/** @type {string} */ email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

/**
 * One public request. Each comes from an address of its own unless the call
 * names one (the server trusts one proxy hop: X-Forwarded-For's last entry),
 * so the walk's own hundreds of reads never meet the rate limit it tests.
 */
let nextIp = 0;
/** Every public answer the walk read, for group 7's check that none carried a coordinate. */
const answers = /** @type {{path: string, body: string}[]} */ ([]);
async function get(/** @type {string} */ path, { base = BASE, ip = `10.83.${(++nextIp >> 8) & 255}.${nextIp & 255}`, token = /** @type {string|undefined} */ (undefined) } = {}) {
  const r = await fetch(base + path, { headers: { "x-forwarded-for": ip, ...(token ? { authorization: token } : {}) } });
  const headers = Object.fromEntries([...r.headers].filter(([k]) => !["date", "connection", "keep-alive"].includes(k)));
  const body = await r.text();
  answers.push({ path, body });
  return { status: r.status, headers, body };
}
/**
 * The placement keys no public answer may carry (PUBLIC_DATA L7 as amended):
 * what the pad records of where a ball went, and db/78's `place`. A ball's
 * `shot` and `area` (a word) are allowed; nothing a word was made from.
 */
const COORDINATES = ["theta", "radius", "seg", "zone", "place", "placement", "placementSource", "placementNull", "closePosition",
  "captureProfile", "contact", "trajectory", "bowlerApproach"];
/** Every key anywhere in a JSON value. @param {unknown} v @returns {string[]} */
const keysIn = (v) => (Array.isArray(v) ? v.flatMap(keysIn)
  : v != null && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keysIn(x)]) : []);
/** The coordinate keys in one answer's body: its JSON keys, or a shell's text. @param {string} body */
const coordinatesIn = (body) => {
  let json;
  try { json = JSON.parse(body); } catch { return COORDINATES.filter((k) => body.includes(`"${k}"`)); }
  return [...new Set(keysIn(json).filter((k) => COORDINATES.includes(k)))];
};
/** Everything a stranger can read about one fixture, as one string. */
async function everything(/** @type {string} */ id) {
  const parts = await Promise.all([`/api/public/matches/${id}`, `/api/public/matches/${id}/log`, `/api/public/matches/${id}/shots`,
    `/live/${id}`, `/scorecard/${id}`].map((p) => get(p)));
  return { parts, text: parts.map((p) => p.body).join("\n") };
}
const log = async (/** @type {string} */ id) => JSON.parse((await get(`/api/public/matches/${id}/log`)).body);
/**
 * The commentary the public page shows for a fixture: its log, folded and
 * said by the page's own generator as PublicMatch.jsx does it (foldable() for
 * commentary, `people` as the names, the header's fold context).
 * @param {string} id @returns {Promise<{lines: string[], l: any}>}
 */
async function pageLines(id) {
  const l = await log(id);
  const header = JSON.parse((await get(`/api/public/matches/${id}`)).body);
  const lines = deriveCommentary(foldable(l.events, l.people, { forCommentary: true }), {
    ctx: header.fold, nameOf: (/** @type {string} */ ref) => l.people[ref] ?? null }).map((x) => x.text);
  return { lines, l };
}

// ── The leak check ──────────────────────────────────────────────
/** Every player the database holds, with what must never leak about each. */
let ALL = /** @type {any[]} */ ([]);
/**
 * What in `text` should not be there, given the names the rule allows.
 * @param {string} text @param {string[]} allowed  the labels publicName() gives on this page
 */
function leaksIn(text, allowed) {
  const found = [];
  const lower = text.toLowerCase();
  const allowedText = allowed.join(" ").toLowerCase();
  for (const p of ALL) {
    if (lower.includes(p.id.toLowerCase())) found.push(`player id ${p.id}`);
    if (p.born && text.includes(p.born)) found.push(`the date of birth of ${p.full_name}`);
    const words = String(p.full_name).split(/\s+/).filter((w) => w.length >= 3);
    for (const w of words) {
      if (new RegExp(`\\b${w}\\b`, "i").test(text) && !allowedText.includes(w.toLowerCase())) found.push(`"${w}" (${p.full_name})`);
    }
    if (words.length >= 2 && text.includes(p.full_name) && !allowed.includes(p.full_name)) found.push(`the full name ${p.full_name}`);
    if (p.known_as && text.includes(p.known_as)) found.push(`the known-as of ${p.full_name}`);
  }
  for (const typed of [TYPED_FIELDER, ...KEARSNEY, "Twelfth Mansfield"]) {
    for (const w of typed.split(" ")) if (new RegExp(`\\b${w}\\b`).test(text)) found.push(`the typed name "${typed}"`);
  }
  for (const w of ["hurt", "injur", "unavail", "suspend", "\"born\"", "\"age\"", "\"dob\"", "photo", "avatar", "\"image",
                   "twelfth", "theta", "radius", "\"seg\"", "\"zone\"", "\"place\"", "placement", "closePosition",
                   "captureProfile", "\"contact\"", "trajectory", "bowlerApproach", "idempotency", "device_id", "\"device", "mc-pad", "pub-0-", "pub2-0-", "said it was two"]) {
    if (lower.includes(w.toLowerCase())) found.push(`"${w}"`);
  }
  return [...new Set(found)];
}
/** The labels a log's squads and people carry. */
const labelsOf = (/** @type {any} */ l) => [...new Set([...Object.values(l.people ?? {}),
  ...(l.events ?? []).flatMap((e) => [...(e.squad ?? []), ...(e.bowlingSquad ?? [])].map((m) => m.label))])].filter(Boolean);
/** Pseudonym → label, for one side's squad in the first innings_start. */
const squadLabels = (/** @type {any} */ l, innings = 0) => {
  const s = l.events.find((e) => e.kind === "innings_start" && e.innings === innings);
  return new Map([...(s?.squad ?? []), ...(s?.bowlingSquad ?? [])].map((m) => [m.id, m.label]));
};

try {
  for (const base of [BASE, OFF]) {
    for (let i = 0; i < 80; i++) {
      try { const r = await fetch(`${base}/api/health`); if ((await r.json()).db === "ok") break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const fx = await buildPublicFixture(q);
  const { pub, pub2, ids } = fx;
  ALL = await q(`select id::text, full_name, known_as, to_char(born, 'YYYY-MM-DD') as born from player`);
  const SARAH = await userId("sarah@example.invalid");          // director of sport, Hilton
  const REGISTRAR = await userId("registrar@example.invalid");  // the office, Hilton
  const login = async (/** @type {string} */ email) => (await (await fetch(`${BASE}/api/auth/dev-login`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ email, deviceId: "smoke-public" }) })).json()).token;
  const sarahToken = await login("sarah@example.invalid");
  const wesToken = await login("publisher.wes@example.invalid");
  const coachToken = await login("coach@example.invalid");
  const publish = async (/** @type {string} */ match, /** @type {string} */ side, /** @type {boolean} */ published, /** @type {string} */ token) =>
    (await fetch(`${BASE}/api/matches/${match}/publication`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ side, published }) })).status;

  group("1. Off by default");
  {
    const health = await (await fetch(`${OFF}/api/health`)).json();
    ok("a server told nothing says the public pages are off", health.public === "off", health.public);
    const onHealth = await (await fetch(`${BASE}/api/health`)).json();
    ok("PUBLIC_PAGES=on says on, and listening", onHealth.public === "on", onHealth.public);
    // Published and withdrawn through the route, as a school does it: the
    // withdrawal must reach group 2's first read, which a notification alone
    // does not promise under load (publication-api.mjs).
    ok("Hilton publishes the seed's fixture for the check", await publish(SEEDED, "home", true, sarahToken) === 200);
    const off = await Promise.all([`/api/public/matches/${SEEDED}`, `/api/public/matches/${SEEDED}/log`, `/live/${SEEDED}`].map((p) => get(p, { base: OFF })));
    ok("off: a published fixture's reads and shell are all 404", off.every((r) => r.status === 404), off.map((r) => r.status));
    ok("off: the same 404 body as an unknown fixture's", off[0].body === (await get(`/api/public/matches/${MISSING}`, { base: OFF })).body);
    const onRead = await get(`/api/public/matches/${SEEDED}`);
    ok("on: the same fixture answers", onRead.status === 200, onRead.body);
    ok("...and withdraws it again", await publish(SEEDED, "home", false, sarahToken) === 200);
  }

  group("2. Unpublished is not found, exactly as nothing is");
  {
    for (const id of [pub, pub2, SEEDED]) {
      const a = await everything(id);
      ok(`unpublished ${id === SEEDED ? "seeded fixture" : "fixture"}: every read and shell is 404`, a.parts.every((p) => p.status === 404), a.parts.map((p) => p.status));
    }
    const pairs = [[`/api/public/matches/${pub}`, `/api/public/matches/${MISSING}`], [`/api/public/matches/${pub}/log`, `/api/public/matches/not-a-uuid/log`],
                   [`/live/${pub}`, `/live/${MISSING}`], [`/scorecard/${pub}`, `/scorecard/x`]];
    for (const [a, b] of pairs) {
      const ra = await get(a), rb = await get(b);
      ok(`${a.replace(pub, ":unpublished")} reads exactly as ${b.replace(MISSING, ":missing")}`,
         ra.status === 404 && ra.status === rb.status && ra.body === rb.body && JSON.stringify(ra.headers) === JSON.stringify(rb.headers),
         `${ra.status} ${rb.status} ${JSON.stringify(ra.headers)} ${JSON.stringify(rb.headers)}`);
    }
    ok("a coach cannot publish a side (the route is the function's door)", await publish(pub, "home", true, coachToken) === 403);
    ok("Hilton's director of sport cannot publish Westville's side", await publish(pub, "away", true, sarahToken) === 403);
    const read = await (await fetch(`${BASE}/api/matches/${pub}/publication`, { headers: { authorization: `Bearer ${sarahToken}` } })).json();
    ok("the fixture screen's read: home may be published by her, away not", read.sides?.find((s) => s.side === "home")?.may_publish === true
       && read.sides?.find((s) => s.side === "away")?.may_publish === false, JSON.stringify(read));
    ok("Hilton publishes its side of PUB, PUB2 and the seed's fixture", await publish(pub, "home", true, sarahToken) === 200
       && await publish(pub2, "home", true, sarahToken) === 200 && await publish(SEEDED, "home", true, sarahToken) === 200);
  }

  group("3. Signed out means nobody: no base table, only db/59's functions");
  {
    const tables = ["player", "match", "ball_event", "injury", "public_name_consent", "player_never_public", "fixture_publication",
                    "assignment_subject", "app_user", "school", "match_toss", "ground", "disciplinary_record", "honour"];
    const counts = await Promise.all(tables.map(async (t) => [t, Number((await as("", `select count(*) as n from ${t}`))[0].n)]));
    const owned = await Promise.all(tables.map(async (t) => Number((await q(`select count(*) as n from ${t}`))[0].n)));
    ok("the application role with no identity reads no row of any of them", counts.every(([, n]) => n === 0), JSON.stringify(counts));
    ok("...though every one of them has rows (so the zero is a refusal)", owned.filter((n) => n > 0).length >= 10, owned.join(","));
    const h = await as("", `select * from public_match_header($1)`, [pub]);
    ok("...and the public header still answers, through the definer", h.length === 1 && h[0].home_label === "Hilton College 1XI");
    const unauth = await fetch(`${BASE}/api/read/players`);
    ok("the signed-in read path still refuses a request with no token", unauth.status === 401);
  }

  group("4. Names by the rule, on the next request after each change");
  {
    let l = await log(pub);
    let labels = labelsOf(l);
    ok("nobody consented yet: every label is a position", labels.every((x) => ["Batter", "Bowler"].includes(x)), labels.join(","));
    let all = await everything(pub);
    ok("...and the whole page leaks nothing", leaksIn(all.text, labels).length === 0, leaksIn(all.text, labels).join(", "));

    // Consents, from each boy's own guardian.
    for (const key of Object.keys(fx.guardians)) {
      const [r] = await as(fx.guardians[key], `select ok, reason from public_name_consent_set($1, true, 'public-names-2026-09')`, [ids[key]]);
      ok(`${PEOPLE[key][0]}'s guardian consents`, r.ok === true, r.reason);
    }
    const [mark] = await as(SARAH, `select ok, reason from player_never_public_set($1, 'a protection order')`, [ids.markham]);
    ok("the director of sport marks Pieter Markham never-public", mark.ok === true, mark.reason);
    // Thabo Nkosi's own age group by birth (the season's rule, db/47), which
    // is not his side's: he plays up in the 1st XI.
    const [{ grp }] = await q(`select birth_age_group(born) as grp from player where id = $1`, [ids.nkosi]);
    ok(`Thabo Nkosi is ${grp} by birth, playing up in the 1st XI`, /^U1[0-6]$/.test(grp), grp);
    const [offU14] = await as(SARAH, `select ok, reason from public_names_off_set($1, $2, true)`, [HIL, grp]);
    ok(`...and the director of sport switches Hilton's ${grp} names off`, offU14.ok === true, offU14.reason);

    l = await log(pub);
    const s1 = squadLabels(l, 0);
    const names = [...s1.values()];
    ok("the next request names the two consenting Hilton boys", names.includes(EXPECTED.erasmus) && names.includes(EXPECTED.botha), names.join(","));
    ok("...and nobody else: the marked boy, the unconsented one and the U14 playing up are 'Batter'",
       names.filter((x) => x === "Batter").length === 3, names.join(","));
    ok("Westville's consenting boy is 'Bowler' while Westville has not published (L5)", !names.includes(EXPECTED.visser) && names.filter((x) => x === "Bowler").length === 2, names.join(","));
    labels = labelsOf(l);
    all = await everything(pub);
    ok("the whole page carries the two names and nothing else of anybody", leaksIn(all.text, labels).length === 0, leaksIn(all.text, labels).join(", "));
    ok("the shell's title names the teams and the score, and nobody", /<title>Hilton College 1XI v Westville Boys&#39; High 1XI · \d+\/\d+/.test(all.parts[3].body)
       && !all.parts[3].body.includes("Erasmus"));

    ok("Westville publishes its own side", await publish(pub, "away", true, wesToken) === 200);
    l = await log(pub);
    ok("the next request names Ruan Visser", [...squadLabels(l, 0).values()].includes(EXPECTED.visser));
    ok("...and still not Musa Zulu", [...squadLabels(l, 0).values()].filter((x) => x === "Bowler").length === 1);
    all = await everything(pub);
    ok("both sides published: still nothing but the three names", leaksIn(all.text, labelsOf(l)).length === 0, leaksIn(all.text, labelsOf(l)).join(", "));
    // SCRBRD-139: the page names the shot and where it went, by the name rule.
    const { lines: said4 } = await pageLines(pub);
    ok("the page's commentary: \"R Visser to D Erasmus, driven through cover for four\"",
       said4.includes("R Visser to D Erasmus, driven through cover for four."), said4.slice(0, 6).join(" | "));

    const [{ grp: g2 }] = await q(`select birth_age_group(born) as grp from player where id = $1`, [ids.nkosi]);
    const [lift] = await as(SARAH, `select ok, reason from public_names_off_set($1, $2, false)`, [HIL, g2]);
    l = await log(pub);
    ok(`names back on for ${g2}: Thabo Nkosi is named on the next request`, lift.ok && [...squadLabels(l, 0).values()].includes("T Nkosi"));

    // The office withdraws Daniel Erasmus's consent, on the family's word. A
    // FINISHED fixture's page is cached for 60 s, so seeing it change on the
    // very next request is the notification at work, not the clock.
    const before = await log(pub2);
    ok("the finished PUB2 names Daniel Erasmus", Object.values(before.people).includes(EXPECTED.erasmus));
    const again = await log(pub2);
    ok("...and a second read inside its TTL is the same answer", JSON.stringify(again) === JSON.stringify(before));
    const t0 = Date.now();
    const [w] = await as(REGISTRAR, `select ok, reason from public_name_consent_set($1, false, 'public-names-2026-09', $2)`, [ids.erasmus, fx.guardians.erasmus]);
    ok("the office withdraws his consent", w.ok === true, w.reason);
    let after = await log(pub2);
    for (let i = 0; i < 10 && Object.values(after.people).includes(EXPECTED.erasmus); i++) {
      await new Promise((r) => setTimeout(r, 100));
      after = await log(pub2);
    }
    const took = Date.now() - t0;
    console.log(`  the withdrawal reached the finished page in ${took} ms`);
    ok(`withdrawn consent reaches the finished page on the next request (${took} ms, the cache holds 60 s)`,
       !Object.values(after.people).includes(EXPECTED.erasmus) && took < 5000, JSON.stringify(after.people));
    ok("...and the live page too", !Object.values((await log(pub)).people).includes(EXPECTED.erasmus));
    const liveAll = await everything(pub2);
    ok("PUB2 (a typed opposition, finished) leaks nothing after the withdrawal", leaksIn(liveAll.text, labelsOf(after)).length === 0, leaksIn(liveAll.text, labelsOf(after)).join(", "));

    // The seed's scored fixture, before and after its boys' families answer.
    let seed = await everything(SEEDED);
    ok("the seed's fixture, published, nobody consented: leaks nothing", leaksIn(seed.text, labelsOf(JSON.parse(seed.parts[1].body))).length === 0,
       leaksIn(seed.text, labelsOf(JSON.parse(seed.parts[1].body))).join(", "));
    for (const [email, pid] of [["parent.bekker@example.invalid", "aaaaaaaa-0000-0000-0000-000000000002"], ["parent.naidoo@example.invalid", "aaaaaaaa-0000-0000-0000-000000000003"]]) {
      await as(await userId(email), `select * from public_name_consent_set($1, true, 'public-names-2026-09')`, [pid]);
    }
    await as(SARAH, `select * from player_never_public_set('aaaaaaaa-0000-0000-0000-000000000003', 'custody')`);
    seed = await everything(SEEDED);
    const seedLog = JSON.parse(seed.parts[1].body);
    ok("the seed's fixture: T Bekker (consented) is named, S Naidoo (marked) and M Cele (nothing) are not",
       Object.values(seedLog.people).join() === "T Bekker", JSON.stringify(seedLog.people));
    ok("...and it leaks nothing else", leaksIn(seed.text, labelsOf(seedLog)).length === 0, leaksIn(seed.text, labelsOf(seedLog)).join(", "));
    for (const id of ["77777777-0000-0000-0000-000000000001", "77777777-0000-0000-0000-000000000002", "77777777-0000-0000-0000-000000000003"]) {
      const u = await everything(id);
      ok(`the seed's unpublished fixture ${id.slice(-1)}: 404 everywhere, and nothing in the 404`, u.parts.every((p) => p.status === 404) && leaksIn(u.text, []).length === 0);
    }
  }

  group("5. Pseudonyms");
  {
    const a = await log(pub), b = await log(pub), c = await log(pub2);
    const idsIn = (/** @type {any} */ l) => new Set(l.events.flatMap((e) => [e.striker, e.nonStriker, e.bowler, e.fielder, e.batter, e.dismissed,
      ...(e.squad ?? []).map((m) => m.id), ...(e.bowlingSquad ?? []).map((m) => m.id)]).filter(Boolean));
    ok("stable within a match: two reads, the same ids", JSON.stringify([...idsIn(a)].sort()) === JSON.stringify([...idsIn(b)].sort()));
    const shared = [...idsIn(a)].filter((x) => idsIn(c).has(x));
    ok("never shared between two matches, though five boys play in both", shared.length === 0, shared.join(","));
    ok("every one is 12 hex characters", [...idsIn(a), ...idsIn(c)].every((x) => /^[0-9a-f]{12}$/.test(x)));
    const eventIds = a.events.map((e) => e.id);
    ok("event ids are pseudonyms too (no device, no key)", eventIds.every((x) => /^e[0-9a-f]{15}$/.test(x)));
    const v = a.events.find((e) => e.kind === "void");
    ok("a void still names the event it undoes", v && eventIds.includes(v.target));
  }

  group("6. The same bytes for a staff token; headers; the rate limit");
  {
    const plain = await get(`/api/public/matches/${pub}/log`);
    const staff = await get(`/api/public/matches/${pub}/log`, { token: `Bearer ${sarahToken}` });
    ok("the director of sport's token changes not one byte", plain.status === 200 && plain.body === staff.body
       && JSON.stringify(plain.headers) === JSON.stringify(staff.headers));
    const all = await everything(pub);
    ok("every answer says noindex", all.parts.every((p) => /noindex/.test(p.headers["x-robots-tag"] ?? "")), all.parts.map((p) => p.headers["x-robots-tag"]).join("|"));
    ok("the shells carry the robots meta", all.parts.slice(3).every((p) => p.body.includes('<meta name="robots" content="noindex, nofollow" />')));
    ok("the log is no-store; the header and sectors public, max-age=30", all.parts[1].headers["cache-control"] === "no-store"
       && all.parts[0].headers["cache-control"] === "public, max-age=30" && all.parts[2].headers["cache-control"] === "public, max-age=30");
    const sectors = JSON.parse(all.parts[2].body).sectors;
    ok("the sectors are team level: innings, sector, shots, runs, and nothing else", sectors.length > 0
       && sectors.every((s) => JSON.stringify(Object.keys(s).sort()) === JSON.stringify(["innings", "runs", "sector", "shots"])), JSON.stringify(sectors));
    const header = JSON.parse(all.parts[0].body).match;
    ok("the header names no official, no weather, and publishes its sides", !("officials" in header) && !("weather" in header)
       && header.published.home === true && header.published.away === true);
    const statuses = [];
    for (let i = 0; i < 35; i++) statuses.push((await get(`/api/public/matches/${pub}`, { ip: "198.51.100.200" })).status);
    const limited = await get(`/api/public/matches/${pub}`, { ip: "198.51.100.200" });
    ok("one address: thirty, then 429", statuses.slice(0, 30).every((s) => s === 200) && statuses.slice(30).every((s) => s === 429), statuses.join(","));
    ok("...with Retry-After and noindex", Number(limited.headers["retry-after"]) >= 1 && /noindex/.test(limited.headers["x-robots-tag"]));
    ok("...and another address is not limited", (await get(`/api/public/matches/${pub}`, { ip: "198.51.100.201" })).status === 200);
    ok("Hilton withdraws its side: the page is gone on the next request", await publish(pub2, "home", false, sarahToken) === 200
       && (await get(`/api/public/matches/${pub2}/log`)).status === 404);
  }

  group("7. The shot and where it went (SCRBRD-139, db/78)");
  {
    // PUB's first ball: D Erasmus's cover drive for four, placed as a point.
    // His consent was withdrawn in group 4: the shot and the place are still
    // said, and he is not.
    const { lines, l } = await pageLines(pub);
    const four = l.events.find((/** @type {any} */ e) => e.kind === "ball" && e.value === 4 && e.innings === 0);
    ok("the four carries its shot and where it went, as a word, and nothing it was made from",
       four?.shot === "drive" && four?.area === "cover" && COORDINATES.every((k) => !(k in four)), JSON.stringify(four));
    const said = lines.join("\n");
    ok("the page's commentary: \"R Visser to the striker, driven through cover for four\" (his consent withdrawn)",
       lines.includes("R Visser to the striker, driven through cover for four.") && !/Erasmus/.test(said), lines.slice(0, 6).join(" | "));
    ok("...an unconsented boy's placed two names the place and not him",
       lines.some((t) => /^R Visser to the striker, to deep mid-wicket, (two runs|they come back for two)\.$/.test(t)), said);
    ok("...a ball with nothing recorded says only the outcome", lines.some((t) => /^.+ to [^,]+, (no run|dot ball)\.$/.test(t)), said);
    ok("...and the lines name nobody the rule does not", leaksIn(said, labelsOf(l)).length === 0, leaksIn(said, labelsOf(l)).join(", "));
    // Every answer this walk read — headers, logs, sectors, shells, 404s,
    // for every fixture in every state — carried no coordinate.
    const carrying = answers.map((a) => ({ path: a.path, keys: coordinatesIn(a.body) })).filter((a) => a.keys.length);
    ok(`no coordinate in any of the ${answers.length} public answers this walk read`, answers.length > 50 && carrying.length === 0,
       carrying.slice(0, 5).map((a) => `${a.path}: ${a.keys.join(",")}`).join(" | "));
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", /** @type {any} */ (e)?.stack ?? e);
} finally {
  for (const s of servers) s.kill();
  await owner.end();
  await app.end();
}

if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
console.log(`\nPUBLIC PAGES (API): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
