#!/usr/bin/env node
/**
 * Making a league, through the API and against Postgres (SCRBRD-123, db/67
 * §8a–8c; docs/design/SCRBRD-123_planner.md §5.7): the walk the league
 * wizard makes, then the planner over what it made.
 *
 *   A. Create: competition.manage at the organiser, and nobody else; the
 *      creator manages it; renamed while it has no fixtures
 *   B. Entrants: four teams invited; each school answers for its own, the
 *      organiser for none — three accept, one declines
 *   C. Conditions from the platform's defaults: every figure unconfirmed with
 *      where it came from; points 4/2/2/0 and a super over set; published by
 *      db/61's path. Copied from a competition in force, citations and all.
 *   D. The planner draws only the three accepted; publishing makes their
 *      fixtures and nothing for the side that declined; the ladder is three;
 *      and the league keeps its name once it has fixtures
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-competition.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8894);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const OVAL = "ffffffff-0000-0000-0000-000000000001";
const WM = "ffffffff-0000-0000-0000-000000000002";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 500)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-competition-secret" },
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
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "league-desk" } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const league = await login("league@example.invalid");        // competitionadmin, no school
  const sarah = await login("sarah@example.invalid");           // director of sport, Hilton
  const wesAdmin = await login("registrar.wes@example.invalid"); // schooladmin, Westville
  const wesCoach = await login("coach.wes@example.invalid");    // Westville 1XI coach
  ok("everyone signs in", !!league && !!sarah && !!wesAdmin && !!wesCoach);
  const [{ today }] = await q(`select sa_today()::text as today`);
  const dayOf = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const at = (day, hhmm) => `${day}T${hhmm}:00+02:00`;

  // ── A ──────────────────────────────────────────────────────────
  group("A. Creating a league");
  const body = { name: "Smoke Schools League", format: "T20", ageGroup: "1XI", gender: "boys", season: "2026" };
  const made = await api("/api/competitions", { method: "POST", token: league, body });
  ok("the league's administrator creates it, with no organising school", made.status === 200 && made.body?.organiserSchoolId === null
     && made.body?.season === "2026" && made.body?.canManage === true, show(made));
  const C = made.body?.id;
  ok("Hilton's director of sport may not (no competition.manage), for no school or her own",
     (await api("/api/competitions", { method: "POST", token: sarah, body })).status === 403
     && (await api("/api/competitions", { method: "POST", token: sarah, body: { ...body, organiserSchoolId: HIL } })).status === 403);
  ok("an unknown season is refused (season_unknown)",
     (await api("/api/competitions", { method: "POST", token: league, body: { ...body, season: "1999" } })).body?.error === "season_unknown");
  ok("a format the fixture screen does not offer (format_invalid)",
     (await api("/api/competitions", { method: "POST", token: league, body: { ...body, format: "Hundred" } })).body?.error === "format_invalid");
  const renamed = await api(`/api/competitions/${C}`, { method: "POST", token: league, body: { name: "Smoke KZN Schools League" } });
  ok("renamed while it has no fixtures", renamed.status === 200 && renamed.body?.name === "Smoke KZN Schools League", show(renamed));
  ok("...by its manager only", (await api(`/api/competitions/${C}`, { method: "POST", token: sarah, body: { name: "Mine now" } })).status === 403);

  // ── B ──────────────────────────────────────────────────────────
  group("B. Entrants: invited by the league, answered by the school");
  const schools = await api(`/api/competitions/${C}/schools`, { token: league });
  ok("the league lists the schools it may invite", schools.body?.schools?.some((s) => s.id === HIL) && schools.body?.schools?.some((s) => s.id === WES), show(schools));
  ok("...and a school's director of sport lists none", (await api(`/api/competitions/${C}/schools`, { token: sarah })).body?.schools?.length === 0);
  const E = {};
  for (const [k, school, team] of [["h1", HIL, "1XI"], ["h2", HIL, "2XI"], ["w1", WES, "1XI"], ["w2", WES, "2XI"]]) {
    const r = await api(`/api/competitions/${C}/entrants`, { method: "POST", token: league, body: { schoolId: school, teamCode: team } });
    E[k] = r.body?.id;
    ok(`invites ${k}: invited`, r.status === 200 && r.body?.status === "invited", show(r));
  }
  ok("the same team again is the same row", (await api(`/api/competitions/${C}/entrants`, { method: "POST", token: league, body: { schoolId: HIL, teamCode: "1XI" } })).body?.id === E.h1);
  ok("a team that is not a team (team_invalid)", (await api(`/api/competitions/${C}/entrants`, { method: "POST", token: league, body: { schoolId: HIL, teamCode: "Firsts" } })).body?.error === "team_invalid");
  ok("Hilton may not invite (403)", (await api(`/api/competitions/${C}/entrants`, { method: "POST", token: sarah, body: { schoolId: HIL, teamCode: "U15A" } })).status === 403);
  const inv = await api("/api/competition-invitations", { token: sarah });
  ok("Hilton's director of sport sees Hilton's two invitations, and not Westville's",
     inv.body?.invitations?.length === 2 && inv.body.invitations.every((i) => i.schoolId === HIL && i.competitionName === "Smoke KZN Schools League"), show(inv));
  ok("the league has none to answer (it cannot answer for a school)", (await api("/api/competition-invitations", { token: league })).body?.invitations?.length === 0);
  const forced = await api(`/api/competition-entrants/${E.h1}/accept`, { method: "POST", token: league });
  ok("the league may not accept on Hilton's behalf (not_permitted)", forced.status === 403 && forced.body?.error === "not_permitted", show(forced));
  ok("Hilton may not accept for Westville", (await api(`/api/competition-entrants/${E.w1}/accept`, { method: "POST", token: sarah })).status === 403);
  ok("nor Westville's 1XI coach for his own side (no fixture.update)", (await api(`/api/competition-entrants/${E.w1}/accept`, { method: "POST", token: wesCoach })).status === 403);
  ok("Hilton accepts both its sides", (await api(`/api/competition-entrants/${E.h1}/accept`, { method: "POST", token: sarah })).body?.status === "accepted"
     && (await api(`/api/competition-entrants/${E.h2}/accept`, { method: "POST", token: sarah })).body?.status === "accepted");
  ok("Westville accepts its 1st XI and declines its 2nd XI",
     (await api(`/api/competition-entrants/${E.w1}/accept`, { method: "POST", token: wesAdmin })).body?.status === "accepted"
     && (await api(`/api/competition-entrants/${E.w2}/decline`, { method: "POST", token: wesAdmin })).body?.status === "declined");
  ok("an answer is given once (not_invited)", (await api(`/api/competition-entrants/${E.w2}/accept`, { method: "POST", token: wesAdmin })).body?.error === "not_invited");
  const ents = await api(`/api/competitions/${C}/entrants`, { token: league });
  ok("the league reads three accepted and one declined",
     ents.body?.entrants?.filter((e) => e.status === "accepted").length === 3 && ents.body.entrants.find((e) => e.id === E.w2)?.status === "declined", show(ents));

  // ── C ──────────────────────────────────────────────────────────
  group("C. Conditions from the platform's defaults, then published");
  const st = await api(`/api/competitions/${C}/playing-conditions/start`, { method: "POST", token: league, body: { from: "defaults" } });
  ok("version 1, a draft, pre-filled", st.status === 200 && st.body?.version === 1 && st.body?.entered > 5, show(st));
  const SET = st.body?.setId;
  ok("...once (already_started)", (await api(`/api/competitions/${C}/playing-conditions/start`, { method: "POST", token: league, body: { from: "defaults" } })).body?.error === "already_started");
  ok("Hilton may not start it (403)", (await api(`/api/competitions/${C}/playing-conditions/start`, { method: "POST", token: sarah, body: { from: "defaults" } })).status === 403);
  const listed = await api(`/api/competitions/${C}/playing-conditions`, { token: league });
  const v1 = listed.body?.sets?.find((s) => s.id === SET);
  const vals = v1?.values ?? [];
  const val = (k, band = null) => vals.find((v) => v.key === k && v.ageBand === band);
  ok("every figure unconfirmed, each saying where it came from", vals.length === st.body?.entered && vals.every((v) => v.status === "unconfirmed" && v.sourceNote), JSON.stringify(vals.slice(0, 3)));
  ok("the tie break: none, citing the Laws (Law 16)", val("result.tie_break")?.value === "none" && /Law 16/.test(val("result.tie_break")?.sourceNote));
  ok("the bowling limit per band, from the directive's own words (U13 5/10, not official wording)",
     JSON.stringify(val("bowling.limit", "U13")?.value) === '{"day":10,"spell":5}' && /Not official wording/.test(val("bowling.limit", "U13")?.sourceNote), JSON.stringify(val("bowling.limit", "U13")));
  ok("the format from the league's T20: limited, twenty overs, a free hit",
     val("format.kind")?.value === "limited" && val("format.overs_per_innings")?.value === 20 && val("format.free_hit")?.value === true);
  ok("no points invented: the league sets its own", !val("points.win"));
  const enter = (key, value) => api(`/api/condition-sets/${SET}/values`, { method: "POST", token: league,
    body: { key, value, status: "unconfirmed", sourceNote: "smoke: the league's own figure" } });
  let set = 0;
  for (const [k, v] of [["points.win", 4], ["points.tie", 2], ["points.no_result", 2], ["points.loss", 0], ["result.tie_break", "super_over"]]) {
    if ((await enter(k, v)).body?.ok) set++;
  }
  ok("points 4/2/2/0 and a super over entered", set === 5, set);
  const pub = await api(`/api/condition-sets/${SET}/publish`, { method: "POST", token: league });
  ok("published by db/61's path, from tomorrow", pub.status === 200 && pub.body?.ok !== false, show(pub));
  const early = await api(`/api/competitions/${C}/planner/inputs?from=${dayOf(7)}&to=${dayOf(30)}`, { token: league });
  ok("the planner's default match length is the T20's", early.body?.defaults?.durationMinutes === 180, show(early));

  // Copied from a competition whose version is in force today (as a seed would make it).
  const [{ id: SRC }] = await q(`insert into competition (school_id, name, comp_type, format) values (null, 'Smoke Source League', 'league', 'T20') returning id`);
  const [{ id: SRCSET }] = await q(`insert into condition_set (competition_id, version, title, effective_from, created_by)
                                    values ($1, 1, 'Source conditions', sa_today() - 10, '88888888-0000-0000-0000-000000000021') returning id`, [SRC]);
  await q(`insert into condition_value (set_id, key, value, status, source_document, source_clause, source_date, entered_by)
           values ($1, 'points.win', '3', 'confirmed', 'Source League Bye-Laws 2026', '7.1', '2026-01-15', '88888888-0000-0000-0000-000000000021')`, [SRCSET]);
  await q(`update condition_set set status = 'published', published_by = created_by, published_at = now() where id = $1`, [SRCSET]);
  const C2 = (await api("/api/competitions", { method: "POST", token: league, body: { name: "Smoke Copy League", format: "T20" } })).body?.id;
  const cp = await api(`/api/competitions/${C2}/playing-conditions/start`, { method: "POST", token: league, body: { from: "competition", sourceCompetitionId: SRC } });
  ok("copied from a competition in force: one figure", cp.status === 200 && cp.body?.entered === 1, show(cp));
  const cv = (await q(`select value, status, source_document, source_clause, source_note from condition_value where set_id = $1`, [cp.body?.setId]))[0];
  ok("...its citation and status copied, and a note saying from where", cv?.status === "confirmed" && cv?.source_document === "Source League Bye-Laws 2026"
     && cv?.source_clause === "7.1" && /Copied from Smoke Source League, version 1/.test(cv?.source_note ?? ""), JSON.stringify(cv));
  const C3 = (await api("/api/competitions", { method: "POST", token: league, body: { name: "Smoke Copy League Two", format: "T20" } })).body?.id;
  ok("a competition with nothing in force today cannot be copied (source_has_no_conditions)",
     (await api(`/api/competitions/${C3}/playing-conditions/start`, { method: "POST", token: league, body: { from: "competition", sourceCompetitionId: C } })).body?.error === "source_has_no_conditions");

  // ── D ──────────────────────────────────────────────────────────
  group("D. The planner draws the three that accepted");
  const days = [8, 15, 22].map(dayOf);
  for (const d of days) {
    await api(`/api/grounds/${OVAL}/windows`, { method: "POST", token: sarah, body: { startsAt: at(d, "09:00"), endsAt: at(d, "13:00"), competitionId: C } });
    await api(`/api/grounds/${WM}/windows`, { method: "POST", token: wesAdmin, body: { startsAt: at(d, "09:00"), endsAt: at(d, "13:00"), competitionId: C } });
  }
  const inputs = await api(`/api/competitions/${C}/planner/inputs?from=${dayOf(7)}&to=${dayOf(30)}`, { token: league });
  ok("the inputs list the three accepted entrants only", inputs.body?.entrants?.length === 3 && !inputs.body.entrants.some((e) => e.id === E.w2), show(inputs));
  ok("a draw naming the side that declined is refused (entrants_invalid)",
     (await api(`/api/competitions/${C}/plans`, { method: "POST", token: league, body: { format: "round_robin", from: dayOf(7), to: dayOf(30), entrants: [E.h1, E.h2, E.w2] } })).body?.error === "entrants_invalid");
  const plan = await api(`/api/competitions/${C}/plans`, { method: "POST", token: league, body: { format: "round_robin", from: dayOf(7), to: dayOf(30) } });
  ok("a round robin of three: three fixtures, all placed", plan.status === 200 && plan.body?.fixtures?.length === 3 && plan.body?.summary?.placed === 3, show(plan));
  const published = await api(`/api/competitions/${C}/plans/${plan.body?.id}/publish`, { method: "POST", token: league });
  ok("published: three fixtures made", published.body?.counts?.created === 3, show(published));
  const rows = await q(`select school_id, team_code, away_school_id, away_team_code, format, overs from match where competition_id = $1`, [C]);
  ok("...none for Westville's 2nd XI", rows.length === 3 && !rows.some((m) => (m.school_id === WES && m.team_code === "2XI") || (m.away_school_id === WES && m.away_team_code === "2XI")), JSON.stringify(rows));
  ok("...each a T20 of twenty overs, from the published conditions", rows.every((m) => m.format === "T20" && m.overs === 20), JSON.stringify(rows));
  const typed = await api("/api/fixtures", { method: "POST", token: wesAdmin, body: { schoolId: WES, teamCode: "2XI", awaySchoolId: HIL, awayTeamCode: "1XI",
    startsAt: at(dayOf(29), "10:00"), competitionId: C } });
  ok("a fixture typed for the side that declined is refused in the route's words (invalid_fixture)",
     typed.status === 422 && typed.body?.error === "invalid_fixture" && /not entered/.test(typed.body?.detail ?? ""), show(typed));
  const ladder = (await api(`/api/read/league?competitionId=${C}`, { token: sarah })).body?.rows ?? [];
  ok("the ladder is the three that accepted", ladder.length === 3 && !ladder.some((r) => r.id === E.w2), JSON.stringify(ladder.map((r) => r.display_name)));
  ok("the league keeps its name now it has fixtures (has_fixtures)",
     (await api(`/api/competitions/${C}`, { method: "POST", token: league, body: { name: "Too late" } })).body?.error === "has_fixtures");
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e?.stack ?? e);
} finally {
  server.kill();
  await pool.end();
  if (fail && serverErr.length) console.log("\nserver stderr:\n" + serverErr.join("").slice(-3000));
  console.log("\n" + "─".repeat(52));
  console.log(`COMPETITION SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
