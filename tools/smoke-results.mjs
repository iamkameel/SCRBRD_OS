#!/usr/bin/env node
/**
 * Match results and the league table, through the API and against Postgres
 * (SCRBRD-114 phase 3a, db/69; docs/design/SCRBRD-114_phase3_results_super_over.md
 * §2, §6): a league under the pilot's four figures, its matches scored on the
 * real write path, and every reader and writer of a result.
 *
 *   A. Scored: two matches scored by the scorer through POST /events (the
 *      first event fixes each match's document), marked complete: a win by
 *      6 runs and a tie. GET /result in words, as the fixture's reader.
 *   B. The table: computed, the pilot's 4/2/2/0 from each match's own
 *      document; net run rate in balls; read by a participant; the moved
 *      `league` read gives the same rows; a reader with no reach reads none.
 *   C. Decisions: a walkover on a match with no ball, by the league only;
 *      a reason under ten characters refused; an award with no ball refused;
 *      one standing at a time; withdrawn with a note.
 *   D. Adjustments: conduct and an over-rate penalty (the league counts them
 *      in points), by the league only; withdrawn with a note.
 *   E. A re-fix: M1's table figures from version 2 (a win worth 5), with a
 *      reason; the row says the conditions were adjusted.
 *   F. A correction: the scorer asks for the chase's last ball to be voided,
 *      the director of sport approves; M1 becomes no result and the table
 *      follows on the next read; the audit line names both results.
 *   G. Signed out: the published competition's table and the served
 *      fixture's result — sides, never a boy, never a reason.
 *
 * Every date is explicit (3 October 2026, the 4th Edition); nothing reads the
 * clock but the server.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-results.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { inningsStart, batters, bowler, ball, sealInnings, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";

const PORT = port(8899);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const OWNER = "88888888-0000-0000-0000-000000000022";
const STARTS = "2026-10-03T10:00:00+02:00";
const T0 = Date.parse("2026-10-03T08:00:00Z");
const HIL_XI = ["01", "02", "03", "04", "05"].map((n) => ({ id: `aaaaaaaa-0000-0000-0000-0000000000${n}`, name: `Hilton ${n}` }));
const WES_XI = ["01", "02"].map((n) => ({ id: `bbbbbbbb-0000-0000-0000-0000000000${n}`, name: `Westville ${n}` }));

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 600)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-results-secret", PUBLIC_PAGES: "on",
         PUBLIC_PSEUDONYM_SECRET: "smoke-results-public-pseudonym-secret-0123456789" },
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
const login = async (email, deviceId = "results-desk") => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`;

/** A league under the pilot's figures (version 1, from 28 September) and a later one (version 2, a win worth 5). */
async function league() {
  const [{ id: c }] = await q(`insert into competition (school_id, name, comp_type, format, level) values (null, 'Smoke 069 League', 'league', 'T20', 'school') returning id`);
  const E = {};
  for (const [k, school, team, name] of [["h1", HIL, "1XI", "Smoke Hilton 1st XI"], ["w1", WES, "1XI", "Smoke Westville 1st XI"], ["h2", HIL, "2XI", "Smoke Hilton 2nd XI"]]) {
    E[k] = (await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, $3, $4) returning id`, [c, school, team, name]))[0].id;
  }
  const V = {};
  for (const [v, from, win] of [[1, "2026-09-28", 4], [2, "2026-10-08", 5]]) {
    const [{ id: s }] = await q(`insert into condition_set (competition_id, version, title, effective_from, created_by) values ($1, $2, $3, $4, $5) returning id`,
      [c, v, `Smoke 069 v${v}`, from, OWNER]);
    for (const [k, val] of [["points.win", win], ["points.tie", 2], ["points.no_result", 2], ["points.loss", 0], ["over_rate.kind", "points"]]) {
      await q(`insert into condition_value (set_id, key, value, status, source_document, source_clause, source_date, entered_by)
               values ($1, $2, $3, 'confirmed', 'Pilot league decision, Kameel', '8.3a', '2026-09-30', $4)`, [s, k, JSON.stringify(val), OWNER]);
    }
    await q(`update condition_set set status = 'published', published_by = $2, published_at = '2026-09-27 12:00+02' where id = $1`, [s, OWNER]);
    V[v] = s;
  }
  const fixture = async (school, team, awaySchool, awayTeam) => (await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status, competition_id)
     values ($1, $2, $3, $4, 'x', $5, 'cricket', 'T20', 20, 'scheduled', $6) returning id, opponent`, [school, team, awaySchool, awayTeam, STARTS, c]))[0];
  return { c, E, V, fixture };
}

/** Score a match on the real write path: claim, then each innings' events and its seal. */
async function score(token, match, innings) {
  const device = "results-pad";
  const claim = await api(`/api/matches/${match}/session/claim`, { method: "POST", token, body: { device } });
  if (claim.body?.ok !== true) return { claim };
  let clientSeq = 0;
  const all = [];
  let accepted = 0;
  for (const [i, inn] of innings.entries()) {
    const evs = [
      inningsStart({ battingTeam: inn.bat, bowlingTeam: inn.bowl, squad: inn.squad, bowlingSquad: inn.bowlingSquad, overs: 1, target: inn.target ?? null }),
      batters({ striker: inn.squad[0].id, nonStriker: inn.squad[1].id }),
      bowler({ bowler: inn.bowlingSquad[0].id }),
      ...inn.runs.map((v) => ball({ type: BALL_TYPE.RUN, value: v })),
    ].map((e) => ({ ...e, innings: i }));
    evs.push({ ...sealInnings(deriveInnings(evs)), innings: i });
    const stamped = evs.map((e) => ({ ...e, id: `${match}:${device}:${all.length + evs.indexOf(e)}`, clientTs: T0 + (all.length + evs.indexOf(e)) * 20_000 }));
    all.push(...stamped);
    const r = await api(`/api/matches/${match}/events`, { method: "POST", token, body: { events: stamped.map((ev) => ({
      epoch: claim.body.epoch, deviceId: device, idempotencyKey: ev.id, clientSeq: ++clientSeq, clientTs: ev.clientTs, innings: ev.innings, payload: ev })) } });
    accepted += r.body?.accepted?.length ?? 0;
    if ((r.body?.refused ?? []).length) return { refused: r.body.refused };
  }
  return { accepted, keys: all.map((e) => e.id) };
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const lg = await login("league@example.invalid");            // competitionadmin, no school
  const sarah = await login("sarah@example.invalid");           // director of sport, Hilton
  const scorer = await login("scorer@example.invalid", "results-pad");
  const wesCoach = await login("coach.wes@example.invalid");    // Westville 1XI coach
  const scout = await login("analyst@example.invalid");         // scout: no competition.read
  ok("everyone signs in", !!lg && !!sarah && !!scorer && !!wesCoach && !!scout);

  const L = await league();
  const M1 = await L.fixture(HIL, "1XI", WES, "1XI");
  const M3 = await L.fixture(HIL, "1XI", WES, "1XI");
  const M2 = await L.fixture(WES, "1XI", HIL, "2XI");

  // ── A ──────────────────────────────────────────────────────────
  group("A. Two matches scored on the real write path");
  const s1 = await score(scorer, M1.id, [
    { bat: "1XI", bowl: M1.opponent, squad: HIL_XI, bowlingSquad: WES_XI, runs: [1, 1, 1, 1, 1, 1] },
    { bat: M1.opponent, bowl: "1XI", squad: WES_XI, bowlingSquad: HIL_XI, runs: [0, 0, 0, 0, 0, 0], target: 7 },
  ]);
  ok("M1: Hilton 6 off an over; Westville 0 chasing 7 — every event taken", s1.accepted === 20, JSON.stringify(s1));
  const s3 = await score(scorer, M3.id, [
    { bat: "1XI", bowl: M3.opponent, squad: HIL_XI, bowlingSquad: WES_XI, runs: [1, 1, 1, 0, 0, 0] },
    { bat: M3.opponent, bowl: "1XI", squad: WES_XI, bowlingSquad: HIL_XI, runs: [1, 1, 1, 0, 0, 0], target: 4 },
  ]);
  ok("M3: 3 each: every event taken", s3.accepted === 20, JSON.stringify(s3));
  const docs = await q(`select match_id, doc->'table'->>'points.win' w from match_conditions where match_id = any($1)`, [[M1.id, M3.id]]);
  ok("the first event fixed each match's document, under version 1 (a win is 4)", docs.length === 2 && docs.every((d) => d.w === "4"), JSON.stringify(docs));
  // M1 is marked complete; M3 is left as the pad leaves a match, live.
  await q(`update match set status = 'complete' where id = $1`, [M1.id]);
  const r1 = await api(`/api/matches/${M1.id}/result`, { token: sarah });
  ok("GET /result: Hilton won by 6 runs, in words, the side by its label", r1.status === 200
     && r1.body?.result?.outcome === "home_win" && r1.body.result.text === "Hilton College 1XI won by 6 runs"
     && r1.body.result.decidedBy === "play" && r1.body.innings?.length === 2, show(r1));
  ok("...and Hilton's director of sport may not decide a league match (canDecide false); the league may",
     r1.body?.canDecide === false && (await api(`/api/matches/${M1.id}/result`, { token: lg })).body?.canDecide === true);
  const r3 = await api(`/api/matches/${M3.id}/result`, { token: wesCoach });
  ok("M3, read by the visitors' coach: Match tied", r3.body?.result?.outcome === "tie" && r3.body.result.text === "Match tied", show(r3));

  // ── B ──────────────────────────────────────────────────────────
  group("B. The table: computed from the results under the league's figures");
  const st = async (token = wesCoach) => api(`/api/competitions/${L.c}/standings`, { token });
  const line = (b) => (b?.rows ?? []).map((r) => `${r.side.replace("Smoke ", "")}=${r.played},${r.won},${r.lost},${r.tied},${r.noResult},${r.points},${r.rank}`).join(" ");
  const b0 = await st();
  ok("computed, ranked: Hilton 1st XI 6 (a win and a tie), Westville 1st XI 2, Hilton 2nd XI nothing yet",
     b0.status === 200 && b0.body?.basis === "computed"
     && line(b0.body) === "Hilton 1st XI=2,1,0,1,0,6,1 Westville 1st XI=2,0,1,1,0,2,2 Hilton 2nd XI=0,0,0,0,0,0,3", line(b0.body) || show(b0));
  const h1 = b0.body?.rows?.[0];
  ok("net run rate in balls: Hilton 9 off 12 for, 3 off 12 against — +3.000",
     h1?.runsFor === 9 && h1?.ballsFor === 12 && h1?.runsAgainst === 3 && h1?.ballsAgainst === 12 && h1?.nrr === 3, JSON.stringify(h1));
  const m3 = b0.body?.results?.find((r) => r.matchId === M3.id);
  ok("M3, decided on the field and never marked complete (nothing on the pad does), counts",
     m3?.status !== "complete" && m3?.counted === true && m3?.text === "Match tied", JSON.stringify(m3));
  ok("the results, in words", b0.body?.results?.length === 3 && b0.body.results.find((r) => r.matchId === M1.id)?.text === "Hilton College 1XI won by 6 runs"
     && b0.body.results.find((r) => r.matchId === M2.id)?.text === null, JSON.stringify(b0.body?.results?.map((r) => r.text)));
  ok("...ranked by the order in force: points, wins, net run rate", JSON.stringify(b0.body?.order) === '["points","wins","nrr"]', JSON.stringify(b0.body?.order));
  ok("a participant reads it; it may not adjust", b0.body?.canAdjust === false && b0.body?.overRateKind === "points");
  const ladder = await api(`/api/read/league?competitionId=${L.c}`, { token: wesCoach });
  ok("the League screen's ladder read is the same table (moved to competition_standing)",
     ladder.status === 200 && ladder.body?.rows?.length === 3 && ladder.body.rows[0].display_name === "Smoke Hilton 1st XI"
     && Number(ladder.body.rows[0].points) === 6 && ladder.body.rows[0].basis === "computed" && ladder.body.rows[0].rank === 1, show(ladder));
  ok("a reader with no competition.read reads no table", (await st(scout)).status === 403);

  // ── C ──────────────────────────────────────────────────────────
  group("C. Decisions taken off the field");
  ok("Hilton may not decide a league match (403)",
     (await api(`/api/matches/${M2.id}/result-decision`, { method: "POST", token: sarah, body: { kind: "walkover", side: "home", reason: "Hilton's 2nd XI did not arrive" } })).status === 403);
  const shortR = await api(`/api/matches/${M2.id}/result-decision`, { method: "POST", token: lg, body: { kind: "walkover", side: "home", reason: "late" } });
  ok("a reason under ten characters is refused, by name", shortR.status === 422 && shortR.body?.error === "reason_required", show(shortR));
  const award = await api(`/api/matches/${M2.id}/result-decision`, { method: "POST", token: lg, body: { kind: "awarded", side: "home", reason: "the higher seed goes through" } });
  ok("no ball bowled: an award is refused (needs_play)", award.status === 422 && award.body?.error === "needs_play", show(award));
  const walk = await api(`/api/matches/${M2.id}/result-decision`, { method: "POST", token: lg, body: { kind: "walkover", side: "home", reason: "Hilton's 2nd XI did not arrive" } });
  ok("a walkover to Westville, by the league", walk.status === 200 && walk.body?.ok === true, show(walk));
  ok("one standing at a time (already_decided)",
     (await api(`/api/matches/${M2.id}/result-decision`, { method: "POST", token: lg, body: { kind: "conceded", side: "away", reason: "Hilton conceded by letter" } })).body?.error === "already_decided");
  const b1 = await st();
  ok("the walkover is a win and a loss in the table, with no status changed",
     line(b1.body) === "Hilton 1st XI=2,1,0,1,0,6,1 Westville 1st XI=3,1,1,1,0,6,2 Hilton 2nd XI=1,0,1,0,0,0,3"
     && b1.body.results.find((r) => r.matchId === M2.id)?.text === "Walkover to Westville Boys' High 1XI", line(b1.body));
  const withdrawShort = await api(`/api/result-decisions/${walk.body?.id}/withdraw`, { method: "POST", token: lg, body: { note: "no" } });
  const withdrawn = await api(`/api/result-decisions/${walk.body?.id}/withdraw`, { method: "POST", token: lg, body: { note: "recorded against the wrong fixture" } });
  ok("withdrawn with a note, not without", withdrawShort.body?.error === "note_required" && withdrawn.body?.ok === true);
  ok("...and the table is play's again", line((await st()).body) === line(b0.body));
  await api(`/api/matches/${M2.id}/result-decision`, { method: "POST", token: lg, body: { kind: "walkover", side: "home", reason: "Hilton's 2nd XI did not arrive" } });

  // ── D ──────────────────────────────────────────────────────────
  group("D. Points adjustments, entered by the league");
  const E = L.E;
  ok("Hilton may not adjust (403)", (await api(`/api/competitions/${L.c}/adjustments`, { method: "POST", token: sarah,
    body: { entrantId: E.w1, kind: "conduct", points: -2, reason: "umpires' report: dissent" } })).status === 403);
  const adj = await api(`/api/competitions/${L.c}/adjustments`, { method: "POST", token: lg,
    body: { entrantId: E.w1, matchId: M3.id, kind: "conduct", points: -2, reason: "umpires' report: dissent at M3", sourceClause: "Code 2.1" } });
  const rate = await api(`/api/competitions/${L.c}/adjustments`, { method: "POST", token: lg,
    body: { entrantId: E.h1, matchId: M1.id, kind: "over_rate", points: -1, reason: "two overs short of the rate at M1" } });
  ok("a conduct deduction and an over-rate penalty in points (the league counts them in points)", adj.body?.ok === true && rate.body?.ok === true, show(rate));
  const b2 = await st(lg);
  ok("the table has them, and the league may adjust", b2.body?.canAdjust === true && b2.body?.adjustments?.length === 2
     && line(b2.body) === "Hilton 1st XI=2,1,0,1,0,5,1 Westville 1st XI=3,1,1,1,0,4,2 Hilton 2nd XI=1,0,1,0,0,0,3", line(b2.body));
  await api(`/api/points-adjustments/${adj.body?.id}/withdraw`, { method: "POST", token: lg, body: { note: "the report was withdrawn by the umpires" } });
  await api(`/api/points-adjustments/${rate.body?.id}/withdraw`, { method: "POST", token: lg, body: { note: "the umpires corrected their sheet" } });
  const b3 = await st(lg);
  ok("withdrawn, never deleted: the table restored", b3.body?.adjustments?.length === 2 && b3.body.adjustments.every((a) => a.withdrawnAt)
     && line(b3.body) === "Hilton 1st XI=2,1,0,1,0,6,1 Westville 1st XI=3,1,1,1,0,6,2 Hilton 2nd XI=1,0,1,0,0,0,3", line(b3.body));

  // ── E ──────────────────────────────────────────────────────────
  group("E. A played match's table figures, re-fixed");
  ok("Hilton may not re-fix (403)", (await api(`/api/matches/${M1.id}/playing-conditions/refix-table`, { method: "POST", token: sarah,
    body: { setId: L.V[2], reason: "version 2 corrected the win" } })).status === 403);
  const refix = await api(`/api/matches/${M1.id}/playing-conditions/refix-table`, { method: "POST", token: lg,
    body: { setId: L.V[2], reason: "version 2 corrected the win to five points" } });
  ok("the league re-fixes M1 from version 2, with a reason", refix.body?.ok === true, show(refix));
  const b4 = await st();
  ok("M1's win is now worth 5, and the table says the conditions were adjusted",
     b4.body?.rows?.[0]?.points === 7 && b4.body.rows[0].conditionsAdjusted === 1 && b4.body.results.find((r) => r.matchId === M1.id)?.conditionsAdjusted === true,
     line(b4.body));
  const [play] = await q(`select doc->'play' p, table_doc_before b from match_conditions where match_id = $1`, [M1.id]);
  ok("...play as it was, the replaced figures kept beside it", play?.b?.["points.win"] === 4 && play?.p?.["format.kind"] === "limited", JSON.stringify(play));

  // ── F ──────────────────────────────────────────────────────────
  group("F. A correction flips a result, and the table follows");
  const target = s1.keys[s1.keys.length - 2];   // the chase's last ball, before its seal
  const reqd = await api(`/api/matches/${M1.id}/amendments`, { method: "POST", token: scorer, body: { targetKey: target, reason: "the last ball was a dead ball" } });
  const dec = await api(`/api/amendments/${reqd.body?.id}/decide`, { method: "POST", token: sarah, body: { approve: true, note: "agreed with both umpires" } });
  ok("the scorer asks, the director of sport approves", reqd.status === 200 && dec.body?.ok === true, `${show(reqd)} ${show(dec)}`);
  const after = await api(`/api/matches/${M1.id}/result`, { token: sarah });
  ok("M1 is now no result: the chase was never completed", after.body?.result?.outcome === "no_result" && after.body.result.text === "No result", show(after));
  const b5 = await st();
  ok("the table follows on the next read: Westville top",
     line(b5.body) === "Westville 1st XI=3,1,0,1,1,8,1 Hilton 1st XI=2,0,0,1,1,4,2 Hilton 2nd XI=1,0,1,0,0,0,3", line(b5.body));
  const [audit] = await q(`select detail from scoring_audit where match_id = $1 and event = 'amendment_approved'`, [M1.id]);
  ok("the audit line names the result before and after",
     audit?.detail?.outcome_before === "home_win" && audit.detail.outcome_after === "no_result" && audit.detail.result_changed === true
     && audit.detail.result_hash_after === after.body.result.resultHash && audit.detail.result_hash_before !== audit.detail.result_hash_after,
     JSON.stringify(audit?.detail));

  // ── G ──────────────────────────────────────────────────────────
  group("G. Signed out: sides, never a boy, never a reason");
  ok("an unpublished competition's table is not found", (await api(`/api/public/competitions/${L.c}/standings`)).status === 404);
  await q(`insert into competition_publication (competition_id, published, set_by) values ($1, true, $2)`, [L.c, OWNER]);
  await q(`insert into fixture_publication (match_id, side, school_id, team_code, published, set_by) values ($1, 'home', $2, '1XI', true, $3)`, [M3.id, HIL, OWNER]);
  const pub = await api(`/api/public/competitions/${L.c}/standings`);
  ok("published: the table, by side", pub.status === 200 && pub.body?.rows?.length === 3 && pub.body.rows[0].side === "Smoke Westville 1st XI"
     && pub.body.rows[0].points === 8, show(pub));
  ok("...with no reason, no adjustment, no player", !/reason|adjust|aaaaaaaa|bbbbbbbb/i.test(JSON.stringify(pub.body)));
  const ph = await api(`/api/public/matches/${M3.id}`);
  ok("a served fixture's result, in words", ph.status === 200 && ph.body?.match?.result?.text === "Match tied" && !/reason/i.test(JSON.stringify(ph.body)), show(ph));
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
console.log(`\n${"─".repeat(52)}\nRESULTS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
