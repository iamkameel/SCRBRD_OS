#!/usr/bin/env node
/**
 * Rain and venue par, through the API and against Postgres (SCRBRD-130 R1,
 * R3; docs/design/SCRBRD-130_rain_and_par.md §2, §5, §6):
 *
 *   A. Interruptions on the real write path: a stop accepted; a ball while
 *      stopped refused by the server (play_stopped); a resumption with none
 *      open refused (play_not_stopped); a revision behind the balls bowled
 *      refused (revision_below_bowled); a par on a first innings refused
 *      (par_without_target); the corrected events accepted.
 *   B. The chase cut short with the umpires' par: GET /result decided on it,
 *      in words "(revised target)"; the signed-out log carries the stop and
 *      the par, never the note.
 *   C. Venue par: five 2-over first innings at a ground written to the log;
 *      GET /api/grounds/:id/venue-par as Hilton's director of sport (the
 *      figure, its evidence, its words); Westville's coach refused; a live
 *      match at the ground: GET /api/matches/:id/venue-par gives par at the
 *      point the innings has reached, by the proportion of overs (no table).
 *
 * Every date is explicit (10 October 2026, the 4th Edition).
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-rain.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { inningsStart, batters, bowler, ball, revision, playStopped, playResumed, sealInnings, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";

const PORT = port(8913);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const STARTS = "2026-10-10T10:00:00+02:00";
const T0 = Date.parse("2026-10-10T08:00:00Z");
const XI = ["01", "02", "03", "04", "05"].map((n) => ({ id: `aaaaaaaa-0000-0000-0000-0000000000${n}`, name: `Hilton ${n}` }));
const VIS = Array.from({ length: 11 }, (_, k) => ({ id: `Rain Visitor ${k + 1}`, name: `Rain Visitor ${k + 1}` }));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 600)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-rain-secret", PUBLIC_PAGES: "on",
         PUBLIC_PSEUDONYM_SECRET: "smoke-rain-public-pseudonym-secret-0123456789" },
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
const login = async (email, deviceId = "rain-desk") => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`;

/** A pad on a match: claim it, then send events one batch at a time, each stamped. */
async function pad(token, match) {
  const device = "rain-pad";
  const claim = await api(`/api/matches/${match}/session/claim`, { method: "POST", token, body: { device } });
  let n = 0;
  /** @type {any[]} */ const log = [];
  /** @param {any[]} evs @returns {Promise<{accepted: number, refused: any[]}>} */
  const send = async (evs) => {
    const stamped = evs.map((e) => { n++; return { ...e, id: `${match}:${device}:${n}`, clientTs: T0 + n * 20_000 }; });
    const r = await api(`/api/matches/${match}/events`, { method: "POST", token, body: { events: stamped.map((ev, k) => ({
      epoch: claim.body?.epoch, deviceId: device, idempotencyKey: ev.id, clientSeq: n - stamped.length + k + 1, clientTs: ev.clientTs,
      innings: ev.innings ?? 0, payload: ev })) } });
    const refused = r.body?.refused ?? [];
    const took = new Set((r.body?.accepted ?? []).map((/** @type {any} */ a) => a.idempotencyKey ?? a));
    for (const ev of stamped) if (!refused.some((/** @type {any} */ x) => x.idempotencyKey === ev.id) && (took.size === 0 || took.has(ev.id))) log.push(ev);
    return { accepted: r.body?.accepted?.length ?? 0, refused };
  };
  return { claim, send, log, inn: (/** @type {number} */ i) => deriveInnings(log.filter((e) => (e.innings ?? 0) === i)) };
}

/** Write a completed 2-over first innings of `runs` at a ground, as the owner (the pool's evidence). */
async function bookedInnings(groundId, day, runs, scorerId) {
  const [{ id: m }] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status, ground_id)
                               values ($1, '1XI', 'Rain Par Visitors', $2, 'cricket', 'T20', 2, 'complete', $3) returning id`,
    [HIL, `${day}T10:00:00+02:00`, groundId]);
  const rows = [{ kind: "innings_start", payload: { battingTeam: "1XI", bowlingTeam: "Rain Par Visitors", overs: 2, squad: VIS } }];
  for (let g = 1; g <= 12; g++) rows.push({ kind: "ball", bt: "run", v: g <= Math.floor(runs / 6) ? 6 : g === Math.floor(runs / 6) + 1 ? runs % 6 : 0, payload: {} });
  let seq = 0;
  for (const r of rows) {
    seq++;
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq, client_ts,
                                     kind, ball_type, value, payload)
             values ($1, $2, $3, 1, 0, $4, 'rain-book', $5, $3, $6, $7, $8, $9, $10)`,
      [m, HIL, seq, scorerId, `rain-par:${m}:${seq}`, `${day}T10:00:00+02:00`, r.kind, r.bt ?? null, r.v ?? null, JSON.stringify(r.payload)]);
  }
  return m;
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const sarah = await login("sarah@example.invalid");           // director of sport, Hilton
  const scorer = await login("scorer@example.invalid", "rain-pad");
  const wesCoach = await login("coach.wes@example.invalid");    // Westville 1XI coach
  ok("everyone signs in", !!sarah && !!scorer && !!wesCoach);
  const [{ id: scorerId }] = await q(`select id from app_user where email = 'scorer@example.invalid'`);
  const [{ id: ground }] = await q(`insert into ground (school_id, name) values ($1, 'Rain Smoke Oval') returning id`, [HIL]);
  const [{ id: M }] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status, ground_id)
                               values ($1, '1XI', 'Rain Visitors', $2, 'cricket', 'T20', 2, 'live', $3) returning id`, [HIL, STARTS, ground]);

  // ── A ──────────────────────────────────────────────────────────
  group("A. Interruptions on the real write path: the server's Laws");
  const p = await pad(scorer, M);
  ok("the scorer claims the match", p.claim.body?.ok === true, show(p.claim));
  const open0 = [inningsStart({ battingTeam: "1XI", bowlingTeam: "Rain Visitors", squad: XI, bowlingSquad: VIS, overs: 2 }),
                 batters({ striker: XI[0].id, nonStriker: XI[1].id }), bowler({ bowler: VIS[0].id }),
                 ...Array.from({ length: 6 }, () => ball({ type: BALL_TYPE.RUN, value: 1 })),
                 bowler({ bowler: VIS[1].id }), ...Array.from({ length: 3 }, () => ball({ type: BALL_TYPE.RUN, value: 1 }))];
  let r = await p.send(open0);
  ok("nine singles accepted", r.refused.length === 0 && r.accepted === open0.length, JSON.stringify(r));
  r = await p.send([playResumed({})]);
  ok("a resumption with no stop open is refused: play_not_stopped", r.refused[0]?.reason === "play_not_stopped", JSON.stringify(r));
  r = await p.send([playStopped({ reason: "rain", note: "covers on, a private note" })]);
  ok("play stopped: accepted", r.refused.length === 0, JSON.stringify(r));
  r = await p.send([ball({ type: BALL_TYPE.RUN, value: 4 })]);
  ok("a ball while play is stopped is refused: play_stopped", r.refused[0]?.reason === "play_stopped", JSON.stringify(r));
  r = await p.send([revision({ overs: 1 })]);
  ok("a revision behind the balls bowled is refused: revision_below_bowled", r.refused[0]?.reason === "revision_below_bowled", JSON.stringify(r));
  r = await p.send([revision({ par: 30 })]);
  ok("a par on a first innings is refused: par_without_target", r.refused[0]?.reason === "par_without_target", JSON.stringify(r));
  r = await p.send([playResumed({})]);
  ok("the resumption accepted", r.refused.length === 0, JSON.stringify(r));
  r = await p.send([...Array.from({ length: 3 }, () => ball({ type: BALL_TYPE.RUN, value: 1 }))]);
  r = await p.send([sealInnings(p.inn(0))]);
  ok("the first innings is played out and sealed: 12 off 2 overs", r.refused.length === 0 && p.inn(0).runs === 12, JSON.stringify(r));

  // ── B ──────────────────────────────────────────────────────────
  group("B. The chase cut short with the umpires' par");
  const open1 = [inningsStart({ battingTeam: "Rain Visitors", bowlingTeam: "1XI", squad: VIS, bowlingSquad: XI, overs: 2, target: 13 }),
                 batters({ striker: VIS[0].id, nonStriker: VIS[1].id }), bowler({ bowler: XI[2].id }),
                 ...Array.from({ length: 5 }, () => ball({ type: BALL_TYPE.RUN, value: 1 }))].map((e) => ({ ...e, innings: 1 }));
  r = await p.send(open1);
  ok("the chase's opening five singles", r.refused.length === 0, JSON.stringify(r));
  r = await p.send([{ ...playStopped({ reason: "bad_light" }), innings: 1 }]);
  r = await p.send([{ ...revision({ par: 8 }), innings: 1 }, { ...sealInnings(p.inn(1), "abandoned"), innings: 1 }]);
  ok("the par and the seal, abandoned, accepted", r.refused.length === 0, JSON.stringify(r));
  await q(`update match set status = 'complete' where id = $1`, [M]);
  const res = await api(`/api/matches/${M}/result`, { token: sarah });
  ok(`GET /result is decided on the par: ${res.body?.result?.text}`, res.body?.result?.outcome === "home_win" && res.body?.result?.margin === 3
     && /won by 3 runs \(revised target\)$/.test(res.body?.result?.text ?? ""), show(res));
  const rows = await q(`select kind, payload from ball_event where match_id = $1 and kind in ('play_stopped', 'revision') order by seq`, [M]);
  ok("the server holds the stops' reasons and the note, and the par", rows.length === 3 && rows[0].payload.note === "covers on, a private note"
     && rows[2].payload.par === 8, JSON.stringify(rows));

  // ── C ──────────────────────────────────────────────────────────
  group("C. Venue par at a ground, and at a point in a live innings");
  // Five completed 2-over first innings at the oval, 2024–2026 — 10, 14, 18,
  // 22, 26 — and M's own 12 (stopped and resumed, its overs never cut: it
  // counts, §6.2): six, par round(102 ÷ 6) = 17, median 16.
  for (const [day, runs] of [["2026-09-01", 10], ["2026-09-02", 14], ["2025-09-03", 18], ["2024-09-04", 22], ["2026-09-05", 26]]) {
    await bookedInnings(ground, day, runs, scorerId);
  }
  const v = await api(`/api/grounds/${ground}/venue-par?overs=2&band=open&on=2026-10-31`, { token: sarah });
  ok(`the ground's par (${v.body?.venuePar?.words})`, v.status === 200 && v.body?.venuePar?.par === 17 && v.body.venuePar.n === 6
     && v.body.venuePar.sufficient === true && v.body.venuePar.words === "Par at this ground: 17", show(v));
  ok("...with its evidence: median, range, seasons, the six innings, M's among them", v.body?.venuePar?.median === 16 && v.body.venuePar.low === 10
     && v.body.venuePar.high === 26 && v.body.venuePar.firstSeason === 2024 && v.body.venuePar.innings.length === 6
     && v.body.venuePar.innings.some((/** @type {any} */ i) => i.matchId === M && i.runs === 12), show(v));
  const refused = await api(`/api/grounds/${ground}/venue-par?overs=2&band=open&on=2026-10-31`, { token: wesCoach });
  ok("Westville's coach reads no Hilton ground's par", refused.status === 403, show(refused));
  const bad = await api(`/api/grounds/${ground}/venue-par?overs=0&band=open`, { token: sarah });
  ok("an allotment that is not one is refused", bad.status === 400 && bad.body?.error === "overs_invalid", show(bad));
  // A live match at the oval, six balls into its first innings, 3 for 1.
  const [{ id: L }] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status, ground_id)
                               values ($1, '1XI', 'Rain Live Visitors', '2026-10-31T10:00:00+02:00', 'cricket', 'T20', 2, 'live', $2) returning id`, [HIL, ground]);
  const pl = await pad(scorer, L);
  const live = await pl.send([inningsStart({ battingTeam: "1XI", bowlingTeam: "Rain Live Visitors", squad: XI, bowlingSquad: VIS, overs: 2 }),
                 batters({ striker: XI[0].id, nonStriker: XI[1].id }), bowler({ bowler: VIS[0].id }),
                 ball({ type: BALL_TYPE.RUN, value: 1 }), ball({ type: BALL_TYPE.RUN, value: 2 }),
                 // the single turned the strike: XI[1] is out, XI[0] stays in
                 ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" }), batters({ striker: XI[2].id, nonStriker: XI[0].id }),
                 ball({ type: BALL_TYPE.RUN, value: 0 }), ball({ type: BALL_TYPE.RUN, value: 0 }), ball({ type: BALL_TYPE.RUN, value: 0 })]);
  ok("the live match's six balls, a wicket among them, accepted", live.refused.length === 0, JSON.stringify(live.refused));
  const at = await api(`/api/matches/${L}/venue-par?on=2026-10-31`, { token: sarah });
  // Par 17 (the five innings and M's 12); 17 × 6 ÷ 12 = 8.5 → 9; the side is 1 down.
  ok(`par at a point, by the proportion of overs (${at.body?.words})`, at.status === 200 && at.body?.parAt?.runs === 9
     && at.body.parAt.wickets === 1 && at.body.parAt.method === "proportion" && at.body.words === "A typical side here would be 9/1 by now", show(at));
} catch (e) {
  ok("the walk ran to the end", false, e?.stack ?? String(e));
} finally {
  server.kill();
  await pool.end();
}
if (fail) console.log(serverErr.join("").slice(-1500));
console.log(`\n${"─".repeat(52)}\nRAIN SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
