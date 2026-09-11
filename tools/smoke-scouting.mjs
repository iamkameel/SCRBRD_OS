#!/usr/bin/env node
/**
 * The scouting consent primitive.
 *
 * A second sweep of scrbrd-beta-2 found `ScoutProfile` and
 * `TalentFilterCriteria` — scouts as externally accredited organisations,
 * and a minimum-evidence floor before a player is discoverable at all. Real
 * ideas, wired to nothing: beta-2's own access model is `allow read: if true`.
 *
 * This walk proves the four gates actually hold, together, in the order a
 * real family and a real scout would hit them:
 *
 *   1. accreditation  — a scout's organisation is checked before anything.
 *   2. consent        — a specific guardian said yes for a specific child.
 *   3. evidence       — enough recorded matches to be worth a trial.
 *   4. no override    — a school cannot grant consent on a family's behalf,
 *                       and cannot verify its own scout.
 *
 * Missing ANY of the four and a candidate list of one is a candidate list of
 * zero. That is the whole point of the primitive: it is a conjunction, not a
 * feature flag.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-scouting.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8822;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const R_PILLAY = "aaaaaaaa-0000-0000-0000-000000000005"; // guardian: parent@example.invalid, verified+consented

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-scouting-secret" },
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
  method: "POST", body: { email, deviceId: "device-scouting" } })).body?.token;

const setConsent = (playerId, token, granted) =>
  api(`/api/players/${playerId}/scouting-consent`, { method: "POST", token, body: { granted } });
const register = (token, organisation, scoutRole) =>
  api("/api/scouts/accreditation", { method: "POST", token, body: { organisation, scoutRole } });
const decide = (scoutPersonId, token, verified) =>
  api(`/api/scouts/${scoutPersonId}/accreditation/decide`, { method: "POST", token, body: { verified } });
const candidatesOf = async (token) => (await api("/api/read/scouting_candidates", { token })).body?.rows || [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const parent   = await login("parent@example.invalid");      // guardian of R Pillay
  const coach    = await login("coach@example.invalid");        // 1XI coach, NOT R Pillay's guardian
  const admin    = await login("registrar@example.invalid");    // schooladmin: guardian.link.manage
  const scoutTok = await login("analyst@example.invalid");      // seeded scout role, unaccredited yet
  const platform = await login("platform@example.invalid");     // scouting.accredit
  const scoutId  = (await q(`select id from app_user where email = 'analyst@example.invalid'`))[0].id;

  group("Nothing is visible before any of the four gates are met");
  ok("an unaccredited scout with no consent granted sees nobody",
     (await candidatesOf(scoutTok)).length === 0);

  group("Consent is the guardian's alone, and nobody else's");
  ok("R Pillay's own guardian may grant it",
     (await setConsent(R_PILLAY, parent, true)).status === 200);
  ok("his 1XI coach may not — holding player.profile.read is not being his guardian",
     (await setConsent(R_PILLAY, coach, true)).status === 403);
  ok("the school office may not either — there is no administrative override",
     (await setConsent(R_PILLAY, admin, true)).status === 403);
  const consentRow = (await q(
    `select consent_state, decided_by from player_scouting_consent where player_id = $1`, [R_PILLAY]))[0];
  ok("the grant that stuck was the guardian's", consentRow?.consent_state === "granted");

  group("Consent alone is not enough — the scout is not accredited yet");
  ok("still nobody, even with consent granted", (await candidatesOf(scoutTok)).length === 0);

  group("Accreditation: a claim, and then a check");
  const reg = await register(scoutTok, "KZN Inland Cricket Union", "regional_selector");
  ok("a scout may claim an organisation", reg.status === 200);
  const claimed = (await q(
    `select organisation, verification_status from scout_accreditation where person_id = $1`, [scoutId]))[0];
  ok("the claim is recorded", claimed?.organisation === "KZN Inland Cricket Union");
  ok("...and lands pending, not verified, by itself", claimed?.verification_status === "pending");
  ok("a pending scout still sees nobody", (await candidatesOf(scoutTok)).length === 0);

  ok("a scout cannot verify their own accreditation",
     (await decide(scoutId, scoutTok, true)).status === 403);
  ok("the coach cannot verify one either — scouting.accredit is a platform capability",
     (await decide(scoutId, coach, true)).status === 403);
  ok("the platform can", (await decide(scoutId, platform, true)).status === 200);

  group("Accredited and consented — and still gated on evidence");
  ok("a verified scout with a consented player still sees nobody yet — no recorded matches",
     (await candidatesOf(scoutTok)).length === 0);

  group("Evidence: a body of work, not an afternoon");
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  const stamp = `${Date.now()}-${Math.random()}`;
  const oneMatch = async (n) => {
    const m = (await q(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1,'1XI','Michaelhouse', now() - interval '${n} days','T20',20,'complete') returning id`,
      [HIL]))[0].id;
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind, ball_type, value,
                               striker_id, payload)
       values ($1,$2,1,1,1,$3,'device-scouting',$4,1,now(),'ball','run',4,$5,'{}'::jsonb)`,
      [m, HIL, su, `scout-${stamp}-${n}`, R_PILLAY]);
  };
  await oneMatch(1);
  await oneMatch(2);
  ok("two matches is not enough — the threshold is three",
     (await candidatesOf(scoutTok)).length === 0);
  await oneMatch(3);
  const seen = await candidatesOf(scoutTok);
  ok("a third match crosses the floor and he appears", seen.some((r) => r.player_id === R_PILLAY));

  group("What the scout sees, and what he does not");
  const row = seen.find((r) => r.player_id === R_PILLAY);
  ok("career figures are there", row && Number(row.batting_matches) >= 3 && Number(row.runs) > 0);
  ok("no date of birth — the same masking a coach's own screen respects",
     !("born" in row) && !("dateOfBirth" in row));
  ok("no id number, obviously", !("id_number" in row) && !("idNumber" in row));

  group("Withdrawal reaches the candidate list immediately");
  ok("the guardian withdraws", (await setConsent(R_PILLAY, parent, false)).status === 200);
  ok("and he is gone, evidence and accreditation notwithstanding",
     !(await candidatesOf(scoutTok)).some((r) => r.player_id === R_PILLAY));
  ok("re-granting brings him back", (await setConsent(R_PILLAY, parent, true)).status === 200);
  ok("...immediately", (await candidatesOf(scoutTok)).some((r) => r.player_id === R_PILLAY));

  group("Suspension reaches it just as fast, from the other side");
  ok("the platform suspends the scout", (await decide(scoutId, platform, false)).status === 200);
  ok("a suspended scout sees nobody, consent and evidence notwithstanding",
     (await candidatesOf(scoutTok)).length === 0);

  group("A player nobody has opted in stays invisible, no matter who bowled well");
  const OTHER = "aaaaaaaa-0000-0000-0000-000000000001"; // James Whitfield — no consent row at all
  await decide(scoutId, platform, true); // re-verify to isolate this check
  ok("an un-consented player never appears, verified scout or not",
     !(await candidatesOf(scoutTok)).some((r) => r.player_id === OTHER));

  group("An unauthenticated request is refused, not answered with an empty truth");
  ok("no token, no read", [401, 403].includes((await api("/api/read/scouting_candidates")).status));

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`SCOUTING SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
