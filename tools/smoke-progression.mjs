#!/usr/bin/env node
/**
 * Knockout progression, through the API and against Postgres (SCRBRD-114
 * phase 3c, db/72; docs/design/SCRBRD-114_phase3_results_super_over.md §5):
 * a cup of four drawn as a knockout by the planner, published, the
 * semi-finals played, and the final made from their winners.
 *
 *   A. Drawn and published: the two semi-finals made; the final held,
 *      awaiting its winners.
 *   B. The semi-finals played (their logs written as the pad writes them):
 *      publishing again makes the final with the two winners as its sides,
 *      and a row for each side holding the result it came from.
 *   C. A correction before the final is played: the organiser awards a
 *      semi-final to the other side, and the final's side follows.
 *   D. After the final has a ball: withdrawing the award flags the final,
 *      and nothing is rewritten; the organiser reads the flag and clears it
 *      with a note; a school may not.
 *
 * Dates are the planner's: days after the server's own today (sa_today()),
 * as tools/smoke-planner.mjs draws them; every event's time is explicit.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-progression.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8896);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const WM = "ffffffff-0000-0000-0000-000000000002";   // Westville Main (the seed's)
const OVAL = "ffffffff-0000-0000-0000-000000000001"; // Gordon Sherwood Oval (the seed's)
const SCORER = "88888888-0000-0000-0000-000000000006";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 500)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-progression-secret" },
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
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "progression-desk" } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`;

/**
 * A one-over match's log, written as the pad writes it (one row per event,
 * seq in order), at an explicit time. `chase` is the second innings' runs,
 * ball by ball; the first innings is six singles.
 * @param {string} m @param {number[]} chase @param {string} startsAt
 */
async function play(m, chase, startsAt) {
  const [x] = await q(`select school_id, team_code, opponent from match where id = $1`, [m]);
  const t0 = Date.parse(startsAt);
  let seq = 0;
  const ev = async (innings, kind, ballType, value, payload) => {
    seq++;
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                     client_seq, client_ts, kind, ball_type, value, payload)
             values ($1, $2, $3, 1, $4, $5, 'progression-pad', $6, $3, $7, $8, $9, $10, $11)`,
      [m, x.school_id, seq, innings, SCORER, `prog:${m}:${seq}`, new Date(t0 + seq * 20_000).toISOString(), kind, ballType, value, JSON.stringify(payload ?? {})]);
  };
  await ev(0, "innings_start", null, null, { battingTeam: x.team_code, bowlingTeam: x.opponent, overs: 1 });
  for (let i = 0; i < 6; i++) await ev(0, "ball", "run", 1);
  await ev(0, "innings_end", null, null, { reason: "overs_complete", confirmed: { runs: 6, wickets: 0, balls: 6 } });
  await ev(1, "innings_start", null, null, { battingTeam: x.opponent, bowlingTeam: x.team_code, overs: 1, target: 7 });
  for (const v of chase) await ev(1, "ball", "run", v);
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const league = await login("league@example.invalid");        // competitionadmin, no school: the organiser
  const wesAdmin = await login("registrar.wes@example.invalid"); // schooladmin, Westville: an entrant school
  ok("everyone signs in", !!league && !!wesAdmin);

  const [{ today }] = await q(`select sa_today()::text as today`);
  const dayOf = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const at = (day, hhmm) => `${day}T${hhmm}:00+02:00`;
  const SEMIS = dayOf(8), FINAL = dayOf(15);

  const [{ id: CUP }] = await q(`insert into competition (school_id, name, comp_type, format, level) values (null, 'Smoke 072 Cup', 'knockout', 'T20', 'school') returning id`);
  const E = {};
  for (const [name, school, team] of [["Hilton 1st XI", HIL, "1XI"], ["Westville 1st XI", WES, "1XI"], ["Hilton 2nd XI", HIL, "2XI"], ["Westville 2nd XI", WES, "2XI"]]) {
    E[name] = (await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, $3, $4) returning id`,
                       [CUP, school, team, name]))[0].id;
  }
  for (const [ground, day] of [[OVAL, SEMIS], [WM, SEMIS], [OVAL, FINAL]]) {
    await q(`insert into ground_window (ground_id, starts_at, ends_at, competition_id) values ($1, $2, $3, $4)`, [ground, at(day, "09:00"), at(day, "13:00"), CUP]);
  }

  // ── A ──────────────────────────────────────────────────────────
  group("A. Drawn as a knockout and published: the semi-finals made, the final held");
  const v1 = await api(`/api/competitions/${CUP}/plans`, { method: "POST", token: league,
    body: { format: "knockout", from: SEMIS, to: FINAL, rules: { durationMinutes: 180, preparationMinutes: 30 } } });
  ok("the organiser draws the cup: two semi-finals and a final", v1.status === 200 && v1.body?.fixtures?.length === 3, show(v1));
  const P = v1.body;
  const final = P?.fixtures?.find((f) => f.home.winnerOf || f.away.winnerOf);
  ok("...the final names the semi-finals' winners, and is placed", final && final.windowId && final.home.winnerOf && final.away.winnerOf, JSON.stringify(final));
  const pub1 = await api(`/api/competitions/${CUP}/plans/${P.id}/publish`, { method: "POST", token: league });
  ok("published: the two semi-finals created, the final held (awaiting_winner)", pub1.status === 200 && pub1.body?.counts?.created === 2
     && pub1.body?.counts?.held === 1 && pub1.body.results.find((r) => r.fixtureId === final.id)?.held === "awaiting_winner", show(pub1));
  const semi = Object.fromEntries(pub1.body.results.filter((r) => r.matchId).map((r) => [r.fixtureId, r.matchId]));
  const S1 = semi[final.home.winnerOf], S2 = semi[final.away.winnerOf];

  // ── B ──────────────────────────────────────────────────────────
  group("B. The semi-finals played; publishing again makes the final from their winners");
  await play(S1, [0, 0, 0, 0, 0, 0], at(SEMIS, "09:00"));   // the home side by 6 runs
  await play(S2, [6, 1], at(SEMIS, "09:00"));               // the away side reaches 7
  await q(`update match set status = 'complete' where id = any($1)`, [[S1, S2]]);
  const pub2 = await api(`/api/competitions/${CUP}/plans/${P.id}/publish`, { method: "POST", token: league });
  const made = pub2.body?.results?.find((r) => r.fixtureId === final.id);
  ok("the final is created", pub2.status === 200 && made?.outcome === "created" && made.matchId, show(pub2));
  const F = made?.matchId;
  const sides = async () => (await q(`select school_id || ':' || team_code || ' v ' || away_school_id || ':' || away_team_code as s from match where id = $1`, [F]))[0]?.s;
  const winnerOf = async (m) => (await q(`select winner_school_id || ':' || winner_team_code as w, result_hash from match_result_compute($1)`, [m]))[0];
  const w1 = await winnerOf(S1), w2 = await winnerOf(S2);
  ok("...its sides the two winners", (await sides()) === `${w1.w} v ${w2.w}`, `${await sides()} — winners ${w1.w}, ${w2.w}`);
  const rows = await q(`select side, from_match_id, resolved_result_hash, fixture_key from match_progression where match_id = $1 order by side`, [F]);
  ok("...and a row for each side, holding the result it came from",
     rows.length === 2 && rows[0].side === "away" && rows[0].from_match_id === S2 && rows[0].resolved_result_hash === w2.result_hash
     && rows[1].from_match_id === S1 && rows[1].resolved_result_hash === w1.result_hash && rows[1].fixture_key === final.home.winnerOf, JSON.stringify(rows));
  const again = await api(`/api/competitions/${CUP}/plans/${P.id}/publish`, { method: "POST", token: league });
  ok("publishing once more makes nothing new", again.body?.counts?.created === 0 && again.body?.counts?.already === 3, show(again));
  const pr = await api(`/api/competitions/${CUP}/progression`, { token: wesAdmin });
  ok("an entrant school reads the bracket's sides, and may not clear", pr.status === 200 && pr.body?.sides?.length === 2 && pr.body.canClear === false, show(pr));

  // ── C ──────────────────────────────────────────────────────────
  group("C. A correction before the final is played: the final's side follows");
  const award = await api(`/api/matches/${S1}/result-decision`, { method: "POST", token: league,
    body: { kind: "awarded", side: "away", reason: "protest upheld: an ineligible player in the home side", overridesPlay: true } });
  ok("the organiser awards the first semi-final to the other side", award.status === 200 && award.body?.ok === true, show(award));
  const w1b = await winnerOf(S1);
  ok("...and the final's home side is that side now", (await sides()) === `${w1b.w} v ${w2.w}` && w1b.w !== w1.w, await sides());
  const notices = await q(`select count(*)::int n from notification where subject_kind = 'match' and subject_id = $1 and kind = 'fixture'`, [F]);
  ok("...both schools told (the organiser has no school here)", notices[0].n === 2, JSON.stringify(notices));

  // ── D ──────────────────────────────────────────────────────────
  group("D. After the final's first ball, a change is flagged, never rewritten");
  const [{ school_id: fs, team_code: ft, opponent: fo }] = await q(`select school_id, team_code, opponent from match where id = $1`, [F]);
  await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq, client_ts, kind, payload)
           values ($1, $2, 1, 1, 0, $3, 'progression-pad', $4, 1, $5, 'innings_start', $6)`,
    [F, fs, SCORER, `prog:${F}:1`, at(FINAL, "09:05"), JSON.stringify({ battingTeam: ft, bowlingTeam: fo, overs: 1 })]);
  const before = await sides();
  const wd = await api(`/api/result-decisions/${award.body.id}/withdraw`, { method: "POST", token: league, body: { note: "the protest was itself withdrawn" } });
  ok("the award is withdrawn", wd.status === 200, show(wd));
  ok("...the played final is not rewritten", (await sides()) === before, `${before} → ${await sides()}`);
  const pr2 = await api(`/api/competitions/${CUP}/progression`, { token: league });
  const flag = pr2.body?.sides?.find((s) => s.side === "home")?.conflict;
  ok("...and the organiser reads the flag on the bracket", pr2.body?.canClear === true && flag && flag.played === true
     && /changed after this match was played$/.test(flag.note), show(pr2));
  const c1 = await api(`/api/matches/${F}/progression/clear`, { method: "POST", token: wesAdmin, body: { side: "home", note: "Westville accept the final as played" } });
  ok("a school may not clear it", c1.status === 403, show(c1));
  const c2 = await api(`/api/matches/${F}/progression/clear`, { method: "POST", token: league, body: { side: "home", note: "ok" } });
  ok("...nor the organiser without a note of ten characters (note_required)", c2.status === 422 && c2.body?.error === "note_required", show(c2));
  const c3 = await api(`/api/matches/${F}/progression/clear`, { method: "POST", token: league, body: { side: "home", note: "the final stands as played; recorded by the committee" } });
  ok("...with one, cleared", c3.status === 200 && c3.body?.ok === true, show(c3));
  const pr3 = await api(`/api/competitions/${CUP}/progression`, { token: league });
  ok("...and the bracket has no flag", (pr3.body?.sides ?? []).every((s) => s.conflict === null), show(pr3));
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
console.log(`\n${"─".repeat(52)}\nPROGRESSION SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
