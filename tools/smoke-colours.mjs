#!/usr/bin/env node
/**
 * Colours: the side's coach nominates, the school decides (RECOGNITION R8,
 * db/146), over HTTP.
 *
 *   1. THE SIDE'S COACH NOMINATES a boy of his side, with an optional
 *      rationale that passes the side's list of words (D2); nobody else
 *      nominates — not another side's coach, the other school, a parent, a
 *      pupil, the office — and never twice.
 *   2. THE NOMINATION IS READ BY THE SIDE'S STAFF AND THE SCHOOL'S DECIDERS
 *      (D8), rationale and all; never by the boy, his parents, a spectator.
 *      Nobody is told anything about it.
 *   3. THE SCHOOL DECIDES (A17, D9, D10): the principal awards, with a
 *      citation that passes the same list; the ordinary honour row, decided
 *      by her; twice is refused. A director who nominated, and is the boy's
 *      guardian, decides neither way and is told the principal does.
 *   4. THE ORDINARY ROUTE KEEPS THE SAME CHECKS: the office recording the
 *      principal's decision answers the open nomination, and she is told.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-colours.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8876);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const BEKKER  = "aaaaaaaa-0000-0000-0000-000000000002";   // 1XI
const CELE    = "aaaaaaaa-0000-0000-0000-000000000004";   // 1XI
const PILLAY  = "aaaaaaaa-0000-0000-0000-000000000005";   // 1XI, signs in as himself; his mother is parent@
const DLAMINI = "aaaaaaaa-0000-0000-0000-000000000006";   // U16B: Sarah coaches it, directs sport, and is his guardian

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 500)}`); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-colours-secret" },
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
  method: "POST", body: { email, deviceId: "device-colours" } })).body?.token;
const rows = async (path, tok) => (await api(path, { token: tok })).body?.rows ?? [];
const noms = (tok) => rows("/api/colours/nominations", tok);
const nominate = (tok, body) => api("/api/colours/nominations", { method: "POST", token: tok, body });
const decide = (tok, id, body) => api(`/api/colours/nominations/${id}/decide`, { method: "POST", token: tok, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const coach     = await login("coach@example.invalid");        // 1XI
  const coach2    = await login("coach2@example.invalid");       // 2XI
  const sarah     = await login("sarah@example.invalid");        // director of sport, U16B coach, K Dlamini's guardian
  const principal = await login("principal@example.invalid");
  const registrar = await login("registrar@example.invalid");    // the office
  const parent    = await login("parent@example.invalid");       // R Pillay's
  const pupil     = await login("pillay@example.invalid");       // R Pillay himself
  const watcher   = await login("watcher@example.invalid");
  const wesCoach  = await login("coach.wes@example.invalid");
  const idOf = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;
  const WHY = "Thirty wickets and a fifty in the final.";

  group("The side's coach nominates");
  let bekker;
  {
    const refused = await nominate(coach, { playerId: BEKKER, kind: "colours", rationale: "Bowled through a hamstring niggle." });
    ok("a rationale passes the side's list of words (D2), refused with the words named", refused.status === 422
       && refused.body?.error === "rationale_refused" && refused.body?.words?.join() === "hamstring,niggle"
       && /A rationale is read by the side's staff and the school's deciders/.test(refused.body?.message ?? ""),
       JSON.stringify(refused.body));
    const r = await nominate(coach, { playerId: BEKKER, kind: "colours", rationale: WHY });
    ok("the 1XI coach nominates T Bekker for Full colours, with a rationale", r.status === 200 && r.body?.ok && r.body?.nominationId, JSON.stringify(r.body));
    bekker = r.body?.nominationId;
    const row = (await q(`select * from recognition_nomination where id = $1`, [bekker]))[0];
    ok("...one row: his account, the side, the season, no match, no pupil, no window", row?.nominated_by_user_id === await idOf("coach@example.invalid")
       && row?.team_code === "1XI" && row?.kind === "colours" && row?.match_id === null && row?.nominated_by_player_id === null
       && row?.closes_at === null && row?.rationale === WHY && row?.status === "open", JSON.stringify(row));
    const again = await nominate(coach, { playerId: BEKKER, kind: "colours" });
    ok("...never twice", again.status === 422 && again.body?.error === "already_nominated", JSON.stringify(again.body));
    for (const [who, tok, id] of [["another side's coach", coach2, BEKKER], ["the 1XI coach, for a U16B boy", coach, DLAMINI],
                                  ["the other school's coach", wesCoach, BEKKER], ["a parent", parent, PILLAY],
                                  ["a pupil", pupil, CELE], ["the office", registrar, CELE], ["the principal", principal, CELE]]) {
      const x = await nominate(tok, { playerId: id, kind: "half_colours" });
      ok(`${who} does not nominate`, x.status === 403 && x.body?.error === "not_permitted", `${x.status} ${JSON.stringify(x.body)}`);
    }
    ok("a kind that is not Colours is refused", (await nominate(coach, { playerId: CELE, kind: "captain" })).body?.error === "kind_invalid");
    ok("a rationale out of bounds is refused", (await nominate(coach, { playerId: CELE, kind: "half_colours", rationale: "x".repeat(301) })).body?.error === "rationale_invalid");
  }

  group("Who reads a nomination (D8)");
  {
    const mine = (await noms(coach)).find((n) => n.nominationId === bekker);
    ok("the coach reads his nomination, with its rationale, and is not offered the decision", mine?.mine === true
       && mine?.rationale === WHY && mine?.mayDecide === false && mine?.status === "open" && mine?.kindWords === "Full colours", JSON.stringify(mine));
    const p = (await noms(principal)).find((n) => n.nominationId === bekker);
    ok("the principal reads it and may decide it", p?.mayDecide === true && p?.rationale === WHY && p?.nominatedBy, JSON.stringify(p));
    ok("the office reads it, and does not decide it", (await noms(registrar)).some((n) => n.nominationId === bekker && !n.mayDecide));
    for (const [who, tok] of [["the boy's parents' account", parent], ["a pupil", pupil], ["a spectator", watcher],
                              ["another side's coach", coach2], ["the other school's coach", wesCoach]]) {
      ok(`${who} reads no nomination of T Bekker`, !(await noms(tok)).some((n) => n.nomineeId === BEKKER));
    }
    const bekkerParent = await login("parent.bekker@example.invalid");
    ok("...nor does his own mother: a boy never learns he was nominated and not chosen", !(await noms(bekkerParent)).some((n) => n.nomineeId === BEKKER));
  }

  group("A director who is the boy's guardian decides neither way (D10)");
  let dlamini;
  {
    const r = await nominate(sarah, { playerId: DLAMINI, kind: "half_colours" });
    ok("Sarah, the U16B coach, nominates K Dlamini", r.status === 200 && r.body?.ok, JSON.stringify(r.body));
    dlamini = r.body?.nominationId;
    const line = (await noms(sarah)).find((n) => n.nominationId === dlamini);
    ok("...her line does not offer her the decision, and says the principal decides", line?.mayDecide === false
       && line?.refusal === "guardian_conflict" && line?.refusalWords === "You are his guardian, so the principal decides.", JSON.stringify(line));
    for (const action of ["award", "no_award"]) {
      const x = await decide(sarah, dlamini, { action });
      ok(`...and her ${action} is refused in those words`, x.status === 422 && x.body?.error === "guardian_conflict"
         && x.body?.message === "You are his guardian, so the principal decides.", JSON.stringify(x.body));
    }
    ok("the coach who nominated is not a decider", (await decide(coach, bekker, { action: "award" })).status === 403);
    ok("nor is the office, through the door", (await decide(registrar, bekker, { action: "award" })).status === 403);
  }

  group("The principal decides");
  {
    const refused = await decide(principal, bekker, { action: "award", citation: "For bowling through his hamstring." });
    ok("the citation passes the same list (D2)", refused.status === 422 && refused.body?.error === "citation_refused"
       && refused.body?.words?.join() === "hamstring" && /A citation is read by his side and his parents/.test(refused.body?.message ?? ""),
       JSON.stringify(refused.body));
    const r = await decide(principal, bekker, { action: "award", citation: WHY });
    ok("she awards T Bekker Full colours", r.status === 200 && r.body?.ok && r.body?.honourId, JSON.stringify(r.body));
    const h = (await q(`select * from honour where id = $1`, [r.body?.honourId]))[0];
    ok("...the ordinary honour, decided by her, with its citation, on his side", h?.kind === "colours" && h?.decided_by === await idOf("principal@example.invalid")
       && h?.awarded_by === h?.decided_by && h?.citation === WHY && h?.team_code === "1XI" && h?.withdrawn_at === null, JSON.stringify(h));
    const n = (await noms(coach)).find((x) => x.nominationId === bekker);
    ok("...and the coach reads his nomination as awarded", n?.status === "confirmed" && n?.honourId === r.body?.honourId && n?.decidedBy, JSON.stringify(n));
    ok("...twice is refused", (await decide(principal, bekker, { action: "award" })).body?.error === "already_decided");
    const recog = await rows(`/api/read/recognition?playerId=${BEKKER}`, coach);
    ok("...and it is on his recognition, as any honour is", recog.some((x) => x.family === "honour" && x.kind === "colours" && x.citation === WHY));
    const d = await decide(principal, dlamini, { action: "no_award" });
    ok("she records no award on K Dlamini's half colours", d.status === 200 && d.body?.ok
       && (await noms(sarah)).find((x) => x.nominationId === dlamini)?.status === "no_award");
    ok("...and nothing about a nomination is told to anybody",
       !(await q(`select 1 from notification where body ilike '%nominat%' or title ilike '%nominat%'`)).length);
  }

  group("The ordinary route keeps the same checks");
  {
    const r = await nominate(coach, { playerId: CELE, kind: "half_colours" });
    ok("the coach nominates M Cele for half colours", r.status === 200);
    const viaOffice = await api("/api/honours", { method: "POST", token: registrar,
      body: { playerId: CELE, kind: "half_colours", season: "2026", decidedBy: await idOf("principal@example.invalid") } });
    ok("the office records the principal's decision", viaOffice.status === 200, JSON.stringify(viaOffice.body));
    const n = (await noms(coach)).find((x) => x.nominationId === r.body?.nominationId);
    ok("...which answers the open nomination", n?.status === "confirmed" && n?.honourId === viaOffice.body?.id, JSON.stringify(n));
    const told = (await rows("/api/read/notifications", principal)).filter((x) => /^Recorded as your decision: Half colours/.test(x.title ?? ""));
    ok("...and she is told it was recorded as hers (D5)", told.length === 1);
    const dl = await api("/api/honours", { method: "POST", token: registrar,
      body: { playerId: DLAMINI, kind: "colours", season: "2026", decidedBy: await idOf("sarah@example.invalid") } });
    ok("the office naming the boy's guardian as decider is refused, saying who decides", dl.status === 422
       && dl.body?.error === "guardian_conflict" && dl.body?.detail === "principal", JSON.stringify(dl.body));
  }
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e?.stack ?? e);
} finally {
  server.kill();
  await pool.end();
}

if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
console.log(`\n────────────────────────────────────────────────────\nCOLOURS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
