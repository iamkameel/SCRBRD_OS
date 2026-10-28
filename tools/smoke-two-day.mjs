#!/usr/bin/env node
/**
 * A Two-Day scored live, through the API and against Postgres (Kameel, 28 Oct
 * 2026, the Laws audit Q1, F2): all four innings on the real write path, to
 * its result. Until then the Laws check refused every ball after the second
 * innings as "the match was already decided" (laws.mjs decided()), on the pad
 * and at the server alike.
 *
 *   A. A friendly, format Two-Day: its first event fixes the platform's
 *      defaults (two innings a side, no free hit). Hilton bat and declare at
 *      6 for 0; Westville are all out for 1 — the second innings carries no
 *      target, so passing a total there ends nothing.
 *   B. The third innings is live (it was match_decided): Hilton make 3 and
 *      declare. The fourth: Westville chase 9 (6 + 3, less 1, plus one), and
 *      reach it.
 *   C. The result: Westville won, by wickets; a ball after it is refused
 *      (match_decided). And a second Two-Day, the side following on and
 *      still behind, all out: an innings win, and the fourth innings refused.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-two-day.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { inningsStart, batters, bowler, ball, sealInnings, deriveMatch, BALL_TYPE, INNINGS_END_REASON } from "@scrbrd/scoring";

const PORT = port(8899);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const STARTS = "2026-10-24T09:00:00+02:00";
const T0 = Date.parse("2026-10-24T07:00:00Z");
const HIL_XI = ["01", "02", "03", "04", "05"].map((n) => ({ id: `aaaaaaaa-0000-0000-0000-0000000000${n}`, name: `Hilton ${n}` }));
// The opposition: typed names (no rows here), as the pad writes them. Three:
// two wickets bowl them out.
const OPP_XI = ["W One", "W Two", "W Three"].map((n) => ({ id: n, name: n }));
const BOWLER = HIL_XI[2].id;

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 600)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-two-day-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await pool.query(text, params)).rows;
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email, deviceId = "two-day-desk") => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 500)}`;

/** One pad's session on a match: claim once, then post batches of events in order. */
function pad(token, match) {
  const device = "two-day-pad";
  let epoch = null, clientSeq = 0, k = 0;
  return {
    async claim() {
      const r = await api(`/api/matches/${match}/session/claim`, { method: "POST", token, body: { device } });
      epoch = r.body?.epoch ?? null;
      return r.body?.ok === true;
    },
    /** @param {any[]} evs */
    async post(evs) {
      const stamped = evs.map((e) => ({ ...e, id: `${match}:${device}:${k}`, clientTs: T0 + (k++) * 20_000 }));
      const r = await api(`/api/matches/${match}/events`, { method: "POST", token, body: { events: stamped.map((ev) => ({
        epoch, deviceId: device, idempotencyKey: ev.id, clientSeq: ++clientSeq, clientTs: ev.clientTs, innings: ev.innings, payload: ev })) } });
      return { accepted: r.body?.accepted?.length ?? 0, refused: r.body?.refused ?? [], status: r.status, stamped };
    },
  };
}

const CONDITIONS = { conditions: { "format.innings_per_side": 2 } };
/** An innings: its start, the openers, the bowler, its balls (a number is runs, "W" bowled), the batters coming in. */
function innings(i, bat, bowl, squad, bowlingSquad, steps, more = {}) {
  const bowlerId = bowlingSquad === HIL_XI ? BOWLER : bowlingSquad[0].id;
  let next = 2;
  /** @type {any[]} */ const evs = [
    inningsStart({ battingTeam: bat, bowlingTeam: bowl, squad, bowlingSquad, overs: 80, ...more }),
    batters({ striker: squad[0].id, nonStriker: squad[1].id }),
    bowler({ bowler: bowlerId }),
  ];
  for (const s of steps) {
    if (s === "W") {
      evs.push(ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }));
      if (next < squad.length) evs.push(batters({ striker: squad[next++].id }));
    } else evs.push(ball({ type: BALL_TYPE.RUN, value: s }));
  }
  return evs.map((e) => ({ ...e, innings: i, clientTs: T0 }));
}
/** The seal of innings i: the reason the Laws derive, or the one the scorer declares. */
const sealOf = (log, i, reason) => {
  const inn = deriveMatch(log, CONDITIONS).innings[i];
  return { ...sealInnings(inn, reason ?? inn.endReason), innings: i, clientTs: T0 };
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const sarah = await login("sarah@example.invalid");
  const scorer = await login("scorer@example.invalid", "two-day-pad");
  ok("everyone signs in", !!sarah && !!scorer);
  const [M] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                       values ($1, '1XI', 'Smoke Two-Day', $2, 'cricket', 'Two-Day', 80, 'scheduled') returning id`, [HIL, STARTS]);
  const [N] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                       values ($1, '1XI', 'Smoke Two-Day Follow-On', $2, 'cricket', 'Two-Day', 80, 'scheduled') returning id`, [HIL, STARTS]);

  // ── A ──
  group("A. A Two-Day: its document, the first innings declared, the second all out");
  const p = pad(scorer, M.id);
  ok("the scorer claims the match", await p.claim());
  /** @type {any[]} */ const log = [];
  const i0 = innings(0, "1XI", "Smoke Two-Day", HIL_XI, OPP_XI, [4, 2]);
  const r0 = await p.post([...i0, sealOf(i0, 0, INNINGS_END_REASON.DECLARED)]);
  log.push(...r0.stamped);
  ok("Hilton 6 for 0, declared: every event taken", r0.accepted === i0.length + 1 && !r0.refused.length, JSON.stringify(r0.refused));
  const doc = (await q(`select doc->'play'->'format.innings_per_side' ips, doc->'play'->>'format.kind' k from match_conditions where match_id = $1`, [M.id]))[0];
  ok("the first event fixed the platform's document: two innings a side", Number(doc?.ips) === 2, JSON.stringify(doc));
  const i1 = innings(1, "Smoke Two-Day", "1XI", OPP_XI, HIL_XI, [1, "W", 0, "W"]);
  const r1 = await p.post([...i1, sealOf([...log, ...i1], 1)]);
  log.push(...r1.stamped);
  ok("Westville all out for 1: every event taken", r1.accepted === i1.length + 1 && !r1.refused.length, JSON.stringify(r1.refused));

  // ── B ──
  group("B. The third innings is live (it was match_decided), and the fourth chases");
  const i2 = innings(2, "1XI", "Smoke Two-Day", HIL_XI, OPP_XI, [3]);
  const r2 = await p.post([...i2, sealOf([...log, ...i2], 2, INNINGS_END_REASON.DECLARED)]);
  log.push(...r2.stamped);
  ok("Hilton's second innings: 3, declared — every event taken", r2.accepted === i2.length + 1 && !r2.refused.length, JSON.stringify(r2.refused));
  const i3 = innings(3, "Smoke Two-Day", "1XI", OPP_XI, HIL_XI, [4, 4, 1], { target: 9 });
  const r3 = await p.post([...i3, sealOf([...log, ...i3], 3)]);
  log.push(...r3.stamped);
  ok("Westville's chase of 9: reached, every event taken", r3.accepted === i3.length + 1 && !r3.refused.length, JSON.stringify(r3.refused));

  // ── C ──
  group("C. The result, and nothing after it");
  const res = await api(`/api/matches/${M.id}/result`, { token: sarah });
  ok("GET /result: Westville won, by wickets", res.body?.result?.outcome === "away_win" && res.body.result.marginKind === "wickets", show(res));
  const after = await p.post([{ ...ball({ type: BALL_TYPE.RUN, value: 1 }), innings: 3, clientTs: T0 }]);
  ok("a ball after the result is refused: match_decided", after.accepted === 0 && JSON.stringify(after.refused).includes("match_decided"), JSON.stringify(after));

  const pn = pad(scorer, N.id);
  ok("the second Two-Day is claimed", await pn.claim());
  /** @type {any[]} */ const logN = [];
  const n0 = innings(0, "1XI", "Smoke Two-Day Follow-On", HIL_XI, OPP_XI, [4, 2]);
  const s0 = await pn.post([...n0, sealOf(n0, 0, INNINGS_END_REASON.DECLARED)]); logN.push(...s0.stamped);
  const n1 = innings(1, "Smoke Two-Day Follow-On", "1XI", OPP_XI, HIL_XI, [1, "W", 0, "W"]);
  const s1 = await pn.post([...n1, sealOf([...logN, ...n1], 1)]); logN.push(...s1.stamped);
  const n2 = innings(2, "Smoke Two-Day Follow-On", "1XI", OPP_XI, HIL_XI, [2, "W", "W"]);
  const s2 = await pn.post([...n2, sealOf([...logN, ...n2], 2)]); logN.push(...s2.stamped);
  ok("Westville follow on and are all out for 2, still 3 behind: every event taken",
     [s0, s1, s2].every((x) => x.refused.length === 0), JSON.stringify([s0.refused, s1.refused, s2.refused]));
  const rn = await api(`/api/matches/${N.id}/result`, { token: sarah });
  ok("GET /result: Hilton won by an innings and 3 runs", rn.body?.result?.outcome === "home_win" && rn.body.result.marginKind === "innings"
     && rn.body.result.marginValue === 3, show(rn));
  const n3 = innings(3, "1XI", "Smoke Two-Day Follow-On", HIL_XI, OPP_XI, [1]);
  const s3 = await pn.post(n3);
  ok("a fourth innings' ball is refused: match_decided", JSON.stringify(s3.refused).includes("match_decided"), JSON.stringify(s3.refused));
} catch (err) {
  fail++;
  console.log("  ✗ the walk threw:", err?.stack ?? err);
} finally {
  server.kill();
  await pool.end();
  if (fail && serverErr.length) console.log(serverErr.join("").slice(-2000));
  console.log(`\nTWO-DAY: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
