#!/usr/bin/env node
/**
 * The super over, through the API and against Postgres (SCRBRD-114 phase 3b,
 * db/71; docs/design/SCRBRD-114_phase3_results_super_over.md §3–§5): a cup
 * whose published conditions send a tie to a super over, and a friendly whose
 * platform defaults do not, both scored to a tie on the real write path.
 *
 *   A. Tied: the cup's result is a tie nobody has decided; the friendly's a
 *      tie decided by play. The cup tie may not be marked complete
 *      (super_over_pending); the friendly may.
 *   B. The Laws at the door: the first super over numbered 2 is refused
 *      (super_over_number); a revision in a super over is refused
 *      (super_over_no_revision); the friendly's super over is refused by its
 *      document (super_over_not_provided, D10).
 *   C. The super over scored: Westville bat first and make 6; Hilton chase 7
 *      and reach it. GET /result: a tie, decided by the super over, Hilton
 *      through, in words; the pair listed; each innings' marker. The live
 *      score's block. The boys' careers did not move; the bowler's day did.
 *   D. Complete once settled; signed out, the public log carries the marker
 *      and the header says who won the super over.
 *
 * Every date is explicit (3 October 2026, the 4th Edition).
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-superover.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { inningsStart, batters, bowler, ball, revision, sealInnings, deriveMatch, BALL_TYPE } from "@scrbrd/scoring";

const PORT = port(8897);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const OWNER = "88888888-0000-0000-0000-000000000022";
const STARTS = "2026-10-03T10:00:00+02:00";
const T0 = Date.parse("2026-10-03T08:00:00Z");
const HIL_XI = ["01", "02", "03", "04", "05"].map((n) => ({ id: `aaaaaaaa-0000-0000-0000-0000000000${n}`, name: `Hilton ${n}` }));
const WES_XI = ["01", "02"].map((n) => ({ id: `bbbbbbbb-0000-0000-0000-0000000000${n}`, name: `Westville ${n}` }));
const BOWLER = HIL_XI[2].id;   // S Naidoo: bowls the match's chase and the super over

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 600)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-superover-secret", PUBLIC_PAGES: "on",
         PUBLIC_PSEUDONYM_SECRET: "smoke-superover-public-pseudonym-secret-0123456789" },
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
const login = async (email, deviceId = "superover-desk") => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 500)}`;

/** One pad's session on a match: claim once, then post batches of events in order. */
function pad(token, match) {
  const device = "superover-pad";
  let epoch = null, clientSeq = 0, k = 0;
  return {
    async claim() {
      const r = await api(`/api/matches/${match}/session/claim`, { method: "POST", token, body: { device } });
      epoch = r.body?.epoch ?? null;
      return r.body?.ok === true;
    },
    /** @param {any[]} evs  each with its innings */
    async post(evs) {
      const stamped = evs.map((e) => ({ ...e, id: `${match}:${device}:${k}`, clientTs: T0 + (k++) * 20_000 }));
      const r = await api(`/api/matches/${match}/events`, { method: "POST", token, body: { events: stamped.map((ev) => ({
        epoch, deviceId: device, idempotencyKey: ev.id, clientSeq: ++clientSeq, clientTs: ev.clientTs, innings: ev.innings, payload: ev })) } });
      return { accepted: r.body?.accepted?.length ?? 0, refused: r.body?.refused ?? [], status: r.status, stamped };
    },
  };
}

/** An innings' events: its start, the openers, the bowler, its balls. */
const innings = (i, bat, bowl, squad, bowlingSquad, runs, more = {}) => [
  inningsStart({ battingTeam: bat, bowlingTeam: bowl, squad, bowlingSquad, overs: 1, ...more }),
  batters({ striker: squad[0].id, nonStriker: squad[1].id }),
  bowler({ bowler: bowlingSquad[bowlingSquad === HIL_XI ? 2 : 0].id }),
  // As the pad's delivery events carry them (delivery.js): who faced, who bowled.
  ...runs.map((v) => ball({ type: BALL_TYPE.RUN, value: v, striker: squad[0].id, nonStriker: squad[1].id,
                            bowler: bowlingSquad[bowlingSquad === HIL_XI ? 2 : 0].id })),
].map((e) => ({ ...e, innings: i, clientTs: T0 }));

/** The seal of innings i on the figures the log so far folds to. @param {any[]} log */
const sealOf = (log, i) => ({ ...sealInnings(deriveMatch(log).innings[i]), innings: i, clientTs: T0 });

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const sarah = await login("sarah@example.invalid");            // director of sport, Hilton: fixture.update
  const scorer = await login("scorer@example.invalid", "superover-pad");
  ok("everyone signs in", !!sarah && !!scorer);

  // A cup: its published conditions send a tie to a super over.
  const [{ id: cup }] = await q(`insert into competition (school_id, name, comp_type, format, level) values ($1, 'Smoke 071 Cup', 'knockout', 'T20', 'school') returning id`, [HIL]);
  for (const [school, team, name] of [[HIL, "1XI", "Smoke Hilton 1st XI"], [WES, "1XI", "Smoke Westville 1st XI"]]) {
    await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, $3, $4)`, [cup, school, team, name]);
  }
  const [{ id: set }] = await q(`insert into condition_set (competition_id, version, title, effective_from, created_by) values ($1, 1, 'Smoke 071 Cup v1', '2026-09-28', $2) returning id`, [cup, OWNER]);
  await q(`insert into condition_value (set_id, key, value, status, source_document, source_clause, source_date, entered_by)
           values ($1, 'result.tie_break', '"super_over"', 'confirmed', 'Pilot league decision, Kameel', '8.3a', '2026-09-30', $2)`, [set, OWNER]);
  await q(`update condition_set set status = 'published', published_by = $2, published_at = '2026-09-27 12:00+02' where id = $1`, [set, OWNER]);
  const [M] = await q(`insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status, competition_id)
                       values ($1, '1XI', $2, '1XI', 'Westville 1XI', $3, 'cricket', 'T20', 1, 'scheduled', $4) returning id`, [HIL, WES, STARTS, cup]);
  const [F] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                       values ($1, '1XI', 'Smoke 071 Friendly', $2, 'cricket', 'T20', 1, 'scheduled') returning id`, [HIL, STARTS]);

  // ── A ──────────────────────────────────────────────────────────
  group("A. Both tied on the real write path; the cup tie waits for its super over");
  const pm = pad(scorer, M.id), pf = pad(scorer, F.id);
  ok("the scorer claims both matches", await pm.claim() && await pf.claim());
  /** @type {any[]} */ const logM = [];
  /** @type {any[]} */ const logF = [];
  for (const [p, log, opp] of [[pm, logM, "Westville 1XI"], [pf, logF, "Smoke 071 Friendly"]]) {
    const i0 = innings(0, "1XI", opp, HIL_XI, WES_XI, [1, 1, 1, 0, 0, 0]);
    const r0 = await p.post([...i0, sealOf(i0, 0)]);
    log.push(...r0.stamped);
    const i1 = innings(1, opp, "1XI", WES_XI, HIL_XI, [1, 1, 1, 0, 0, 0], { target: 4 });
    const r1 = await p.post([...i1, sealOf([...log, ...i1], 1)]);
    log.push(...r1.stamped);
    ok(`${opp}: 3 each — every event taken`, r0.accepted === 10 && r1.accepted === 10 && !r0.refused.length && !r1.refused.length, JSON.stringify([r0.refused, r1.refused]));
  }
  const doc = (await q(`select doc->'play'->>'result.tie_break' tb, doc->'play'->>'format.kind' k from match_conditions where match_id = $1`, [M.id]))[0];
  ok("the cup match's first event fixed its document: a tie goes to a super over, limited overs", doc?.tb === "super_over" && doc?.k === "limited", JSON.stringify(doc));
  const a1 = await api(`/api/matches/${M.id}/result`, { token: sarah });
  ok("the cup's result: tied, and nobody has decided who goes through", a1.body?.result?.outcome === "tie" && a1.body.result.decidedBy === null
     && a1.body.result.text === "Match tied", show(a1));
  const a2 = await api(`/api/matches/${F.id}/result`, { token: sarah });
  ok("the friendly's: tied, decided by play — a tie stands", a2.body?.result?.outcome === "tie" && a2.body.result.decidedBy === "play", show(a2));
  const c1 = await api(`/api/fixtures/${M.id}`, { method: "POST", token: sarah, body: { status: "complete" } });
  ok("the cup tie may not be marked complete before its super over: super_over_pending", c1.status === 422 && c1.body?.error === "super_over_pending", show(c1));
  const c2 = await api(`/api/fixtures/${F.id}`, { method: "POST", token: sarah, body: { status: "complete" } });
  ok("...the friendly's tie may", c2.status === 200 && c2.body?.status === "complete", show(c2));

  // ── B ──────────────────────────────────────────────────────────
  group("B. The Laws and the document at the door");
  const wrong = await pm.post([{ ...inningsStart({ battingTeam: "Westville 1XI", bowlingTeam: "1XI", squad: WES_XI, bowlingSquad: HIL_XI, overs: 1, superOver: 2 }), innings: 2, clientTs: T0 }]);
  ok("the first super over numbered 2 is refused: super_over_number", wrong.accepted === 0 && wrong.refused[0]?.reason === "super_over_number", JSON.stringify(wrong.refused));
  // The friendly is complete: its pad's events go to quarantine, not the Laws.
  // Its document's rule is asked of a third match, a friendly left live.
  const [G] = await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
                       values ($1, '1XI', 'Smoke 071 Friendly II', $2, 'cricket', 'T20', 1, 'scheduled') returning id`, [HIL, STARTS]);
  const pg2 = pad(scorer, G.id);
  await pg2.claim();
  /** @type {any[]} */ const logG = [];
  for (const [i, bat, bowl, sq, bsq, more] of [[0, "1XI", "Smoke 071 Friendly II", HIL_XI, WES_XI, {}], [1, "Smoke 071 Friendly II", "1XI", WES_XI, HIL_XI, { target: 4 }]]) {
    const evs = innings(i, bat, bowl, sq, bsq, [1, 1, 1, 0, 0, 0], more);
    const r = await pg2.post([...evs, sealOf([...logG, ...evs], i)]);
    logG.push(...r.stamped);
  }
  const notProvided = await pg2.post([{ ...inningsStart({ battingTeam: "Smoke 071 Friendly II", bowlingTeam: "1XI", squad: WES_XI, bowlingSquad: HIL_XI, overs: 1, superOver: 1 }), innings: 2, clientTs: T0 }]);
  ok("a super over in a match whose document provides none is refused: super_over_not_provided (D10)",
     notProvided.accepted === 0 && notProvided.refused[0]?.reason === "super_over_not_provided", JSON.stringify(notProvided.refused));
  const noMarker = await pg2.post([{ ...inningsStart({ battingTeam: "Smoke 071 Friendly II", bowlingTeam: "1XI", squad: WES_XI, bowlingSquad: HIL_XI, overs: 1 }), innings: 2, clientTs: T0 }]);
  ok("...and a third innings with no marker, by the Laws: super_over_after_match_innings",
     noMarker.accepted === 0 && noMarker.refused[0]?.reason === "super_over_after_match_innings", JSON.stringify(noMarker.refused));

  // ── C ──────────────────────────────────────────────────────────
  group("C. The super over, scored: Westville bat first and make 6; Hilton chase 7");
  const careers = async () => JSON.stringify(await q(
    `select (select row(c.*)::text from player_batting_career c where c.player_id = $1) bat,
            (select row(c.*)::text from player_bowling_career c where c.player_id = $2) bowl,
            (select count(*) from player_innings x where x.match_id = $3) inns`, [HIL_XI[0].id, BOWLER, M.id]));
  const dayOf = async () => Number((await q(`select coalesce(sum(deliveries), 0)::int d from bowler_over where bowler_id = $1 and match_id = $2`, [BOWLER, M.id]))[0].d);
  const careersBefore = await careers();
  const dayBefore = await dayOf();
  const so2 = innings(2, "Westville 1XI", "1XI", WES_XI, HIL_XI, [4, 1, 1], { superOver: 1 });
  const r2a = await pm.post(so2);
  logM.push(...r2a.stamped);
  const rev = await pm.post([{ ...revision({ overs: 0, target: null, reason: "rain" }), innings: 2, clientTs: T0 }]);
  ok("a revision in the super over is refused: super_over_no_revision", rev.accepted === 0 && rev.refused[0]?.reason === "super_over_no_revision", JSON.stringify(rev.refused));
  const rest2 = [0, 0, 0].map((v) => ({ ...ball({ type: BALL_TYPE.RUN, value: v, striker: WES_XI[0].id, nonStriker: WES_XI[1].id, bowler: BOWLER }),
                                        innings: 2, clientTs: T0 }));
  const r2b = await pm.post([...rest2, sealOf([...logM, ...rest2], 2)]);
  logM.push(...r2b.stamped);
  const so3 = innings(3, "1XI", "Westville 1XI", HIL_XI, WES_XI, [6, 1], { superOver: 1, target: 7 });
  const r3 = await pm.post([...so3, sealOf([...logM, ...so3], 3)]);
  logM.push(...r3.stamped);
  ok("the pair, opened and played on the pad's events, every one taken", r2a.accepted === 6 && r2b.accepted === 4 && r3.accepted === 6
     && ![...r2a.refused, ...r2b.refused, ...r3.refused].length, JSON.stringify([r2a.refused, r2b.refused, r3.refused]));
  const c3 = await api(`/api/matches/${M.id}/result`, { token: sarah });
  const res = c3.body?.result;
  ok("GET /result: the match a tie, decided by the super over, Hilton through, in words",
     res?.outcome === "tie" && res.decidedBy === "super_over" && res.winnerSide === "home" && /won the super over$/.test(res.text ?? ""), show(c3));
  ok("...the pair listed: Westville first, 6 for 0; Hilton 7; won by Hilton",
     res?.superOvers?.length === 1 && res.superOvers[0].first === "away" && res.superOvers[0].state === "won" && res.superOvers[0].winner === "home"
     && res.superOvers[0].a?.runs === 6 && res.superOvers[0].b?.runs === 7, JSON.stringify(res?.superOvers));
  ok("...and each innings' marker: two match innings, then the first super over's two",
     JSON.stringify((c3.body?.innings ?? []).map((/** @type {any} */ i) => i.superOver)) === "[null,null,1,1]", JSON.stringify(c3.body?.innings));
  const ls = await api(`/api/read/live_score?matchId=${M.id}`, { token: scorer });
  ok("the live score marks the super over's innings for the board's block",
     JSON.stringify((ls.body?.rows ?? ls.body ?? []).map((/** @type {any} */ r) => r.super_over)) === "[null,null,1,1]", show(ls));
  ok("the boys' careers did not move (never, D6)", (await careers()) === careersBefore, `${careersBefore} → ${await careers()}`);
  ok("...and the bowler's day counts the six balls of the super over he bowled (D5, D6)", (await dayOf()) - dayBefore === 6, `${dayBefore} → ${await dayOf()}`);

  // ── D ──────────────────────────────────────────────────────────
  group("D. Complete once settled; signed out, the public log carries the marker");
  const c4 = await api(`/api/fixtures/${M.id}`, { method: "POST", token: sarah, body: { status: "complete" } });
  ok("the cup tie settled by its super over may be marked complete", c4.status === 200 && c4.body?.status === "complete", show(c4));
  await q(`insert into fixture_publication (match_id, side, school_id, team_code, published, set_by) values ($1, 'home', $2, '1XI', true, $3)`, [M.id, HIL, OWNER]);
  const pl = await api(`/api/public/matches/${M.id}/log`);
  const starts = (pl.body?.events ?? []).filter((/** @type {any} */ e) => e.kind === "innings_start");
  ok("the public log: each innings_start, the super over's two with superOver 1",
     pl.status === 200 && JSON.stringify(starts.map((/** @type {any} */ e) => e.superOver ?? null)) === "[null,null,1,1]", show(pl));
  const ph = await api(`/api/public/matches/${M.id}`);
  ok("the public header: tied, and who won the super over", /^Match tied; .* won the super over$/.test(ph.body?.match?.result?.text ?? ""), show(ph));
} catch (err) {
  ok(`the walk threw: ${err.message?.slice(0, 300)}`, false);
  console.log(err.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  server.kill("SIGTERM");
  await pool.end();
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 16).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nSUPER OVER SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
