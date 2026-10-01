#!/usr/bin/env node
/**
 * A competition's playing conditions, phase 1, through the API and against
 * Postgres (SCRBRD-114, db/61; docs/design/SCRBRD-114_playing_conditions.md).
 *
 * ("Playing conditions", not smoke-conditions: that walk is the weather and
 * the pitch.)
 *
 *   A. The catalogue: read by anyone signed in; the deny-list is the schema's
 *   B. A version: drafted, figures entered with their citations, published —
 *      and only by the league's conditions manager; a scorer reads none of it
 *   C. Published is immutable: a change is a new version, which copies it
 *   D. Never retroactive: a version dated today or earlier is not published;
 *      a support session publishes nothing
 *   E. The fixture: in a competition its sides entered, or refused; the
 *      screen's pre-fill from the version in force on its day
 *   F. The day decides: a fixture resolves the version in force on its start
 *      day, not one published after; a friendly resolves defaults and the
 *      fixture; a departure before play, with a reason
 *   G. The first event fixes the document, on the live path: the version's
 *      free hit decides the wicket, and nothing afterwards moves it — a later
 *      version, an override, a change of competition, an UPDATE
 *   H. The first event fixes it on the pad's resume credential too
 *   I. The handover: the conditions' hash is asked before the board, and a
 *      mismatch is refused in words
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-playing-conditions.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { newPadKeyPair, padPublicJwk, padProof, padAuthorization } from "@scrbrd/sync";
import { inningsStart, batters, bowler, ball, BALL_TYPE, newEventId, fromRow, deriveMatch, CONDITION } from "@scrbrd/scoring";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8877);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const LEAGUE = "99999999-0000-0000-0000-000000000001";   // KZN Schools T20 League: no organising school
const P = ["01", "02", "03", "04", "05"].map((n) => `aaaaaaaa-0000-0000-0000-0000000000${n}`);
const DEV_A = "pc-phone-a", DEV_B = "pc-phone-b";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 400)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-playing-conditions-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
const pool = new pg.Pool({ connectionString: DB });
const q = async (text, params) => (await pool.query(text, params)).rows;

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email, deviceId = "pc-desk") =>
  (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;

let seq = 0;
const envelope = (payload, epoch, deviceId) => {
  seq += 1;
  const withId = { ...payload, id: payload.id ?? newEventId(deviceId) };
  return { epoch, deviceId, clientSeq: seq, clientTs: Date.now(), innings: 0, idempotencyKey: withId.id, payload: withId };
};
/** The first over of a match: the start, the pair, a bowler, a no-ball, then the striker bowled. */
const nbThenBowled = () => [
  inningsStart({ battingTeam: "Hilton 1st XI", bowlingTeam: "Opposition", squad: P.map((id, i) => ({ id, name: `Player ${i + 1}` })),
                 bowlingSquad: [{ id: "M Bowler", name: "M Bowler" }], overs: 20 }),
  batters({ striker: P[0], nonStriker: P[1] }), bowler({ bowler: "M Bowler" }),
  ball({ type: BALL_TYPE.NO_BALL }), ball({ type: BALL_TYPE.WICKET, dismissal: "bowled" }),
];

/** Insert a fixture as the owner, as a seed would. */
const fixture = async ({ team = "1XI", competition = null, days, format = "T20", overs = 20, opponent = "Opposition" }) => (await q(
  `insert into match (school_id, team_code, opponent, starts_at, format, overs, status, competition_id)
   values ($1, $2, $3, (sa_today() + $4::int)::timestamp AT TIME ZONE 'Africa/Johannesburg' + interval '10 hours', $5, $6, 'scheduled', $7)
   returning id`, [HIL, team, opponent, days, format, overs, competition]))[0].id;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const league = await login("league@example.invalid");     // competitionadmin, no school
  const scorer = await login("scorer@example.invalid", DEV_A);
  const scorerB = await login("scorer@example.invalid", DEV_B);
  const sarah = await login("sarah@example.invalid");        // director of sport, Hilton
  const platform = await login("platform@example.invalid");  // platformadmin: support sessions
  ok("everyone signs in", !!league && !!scorer && !!scorerB && !!sarah && !!platform);
  const [{ today }] = await q(`select sa_today()::text as today`);
  const dayOf = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  // ── A ──────────────────────────────────────────────────────────
  group("A. The catalogue");
  const cat = await api("/api/playing-conditions/catalogue", { token: scorer });
  // 33: SCRBRD-130 added target.g50 (db/73) and target.dls_table (db/75).
  ok("anyone signed in reads it: 33 keys", cat.status === 200 && cat.body?.keys?.length === 33, JSON.stringify(cat.body).slice(0, 200));
  ok("...with the reserved keys marked, and the age bands a limit is given for",
     cat.body?.keys?.find((k) => k.key === "over.max_balls")?.reserved === true && cat.body?.ageBands?.includes("U15")
     && !cat.body?.ageBands?.includes("unknown"));
  const dflt = (k) => cat.body?.keys?.find((x) => x.key === k)?.platformDefault;
  ok("a key's platformDefault is what applies when a league sets nothing: the enum and list defaults, and false",
     dflt("result.tie_break") === "none" && JSON.stringify(dflt("table.order")) === '["points","wins","nrr"]' && dflt("eligibility.bona_fide_scholar") === false);
  ok("...null only where the reader's own fallback applies (the fixture's format, no cap)", dflt("format.kind") === null && dflt("bowling.max_overs_per_bowler_innings") === null);
  ok("...every key agrees with conditions.mjs's CONDITION, the fold's truth",
     cat.body.keys.every((k) => k.key === "bowling.limit" || JSON.stringify(k.platformDefault) === JSON.stringify(CONDITION[k.key]?.platformDefault ?? null)));
  ok("...and the bowling limit's is the directive, per band: U13 5/10, U16 7/18, open none",
     JSON.stringify(dflt("bowling.limit")?.U13) === '{"spell":5,"day":10}' && JSON.stringify(dflt("bowling.limit")?.U16) === '{"spell":7,"day":18}'
     && JSON.stringify(dflt("bowling.limit")?.open) === '{"spell":null,"day":null}' && dflt("bowling.limit")?.unknown === undefined);
  ok("signed out: not read", (await api("/api/playing-conditions/catalogue")).status >= 400);
  let refused = null;
  try { await q(`insert into playing_condition_key (key, part, value_type, readers) values ('quota.black_players', 'sheet', 'int', '{}')`); }
  catch (e) { refused = e.code; }
  ok("the schema refuses a quota key, even for the owner (the deny-list is a CHECK)", refused === "23514", refused);

  // ── B ──────────────────────────────────────────────────────────
  group("B. A version: drafted, entered with citations, published — by the league alone");
  const D1 = dayOf(2), D2 = dayOf(6);
  const v1 = await api(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: league,
    body: { title: "KZN Schools T20 2026/27, first issue", effectiveFrom: D1 } });
  ok("the league drafts version 1", v1.status === 200 && v1.body?.version === 1, JSON.stringify(v1.body));
  const V1 = v1.body?.setId;
  const notMine = await api(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: sarah, body: { title: "mine", effectiveFrom: D1 } });
  ok("a school's director of sport may not (403 not_permitted)", notMine.status === 403 && notMine.body?.error === "not_permitted");
  ok("nor a scorer", (await api(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: scorer, body: { title: "mine", effectiveFrom: D1 } })).status === 403);

  const enter = (set, body, token = league) => api(`/api/condition-sets/${set}/values`, { method: "POST", token, body });
  ok("a figure, unconfirmed", (await enter(V1, { key: "format.free_hit", value: false, status: "unconfirmed", sourceNote: "extracted, not checked" })).body?.ok === true);
  const noCite = await enter(V1, { key: "bowling.max_overs_per_bowler_innings", value: 4, status: "confirmed" });
  ok("a confirmed figure with no citation is refused (citation_required)", noCite.status === 422 && noCite.body?.error === "citation_required");
  ok("...with its document, clause and date it is taken",
     (await enter(V1, { key: "bowling.max_overs_per_bowler_innings", value: 4, status: "confirmed",
                        sourceDocument: "KZN Schools T20 bye-laws 2026/27", sourceClause: "7.3", sourceDate: "2026-09-15" })).body?.ok === true);
  ok("format and overs, for the fixture screen", (await enter(V1, { key: "format.kind", value: "limited", status: "unconfirmed" })).body?.ok === true
     && (await enter(V1, { key: "format.overs_per_innings", value: 20, status: "unconfirmed" })).body?.ok === true);
  const bad = await enter(V1, { key: "format.free_hit", value: "no", status: "unconfirmed" });
  ok("a value of the wrong type is refused, and says why", bad.status === 422 && bad.body?.error === "value_invalid" && /yes or no/.test(bad.body?.detail ?? ""), JSON.stringify(bad.body));
  ok("a key outside the catalogue: no_such_key", (await enter(V1, { key: "quota.black_players", value: 4, status: "unconfirmed" })).body?.error === "no_such_key");
  ok("a limit by age band", (await enter(V1, { key: "bowling.limit", ageBand: "U15", value: { spell: 6, day: 12 }, status: "unconfirmed" })).body?.ok === true);
  ok("...never for a boy with no birth date (unknown)", (await enter(V1, { key: "bowling.limit", ageBand: "unknown", value: { spell: 6, day: 12 }, status: "unconfirmed" })).body?.error === "value_invalid");
  ok("...and a day shorter than a spell is refused", (await enter(V1, { key: "bowling.limit", ageBand: "U14", value: { spell: 6, day: 5 }, status: "unconfirmed" })).body?.error === "value_invalid");

  const seen = async (token) => (await api(`/api/competitions/${LEAGUE}/playing-conditions`, { token })).body;
  const sarahSees = await seen(sarah);
  ok("a draft is the league's alone: Hilton's director of sport sees no version", sarahSees?.sets?.length === 0 && sarahSees?.canManage === false, JSON.stringify(sarahSees));
  const scorerSees = await seen(scorer);
  ok("a scorer reads no condition_set at all", (scorerSees?.sets?.length ?? 0) === 0);
  ok("the league sees its draft, with its figures", (await seen(league))?.sets?.[0]?.values?.length === 5 && (await seen(league))?.canManage === true);

  const pub1 = await api(`/api/condition-sets/${V1}/publish`, { method: "POST", token: league });
  ok("version 1 is published", pub1.body?.ok === true, JSON.stringify(pub1.body));
  const afterPub = await seen(sarah);
  ok("...and Hilton, an entrant, now reads it", afterPub?.sets?.length === 1 && afterPub.sets[0].status === "published");
  ok("...the scorer still reads nothing", ((await seen(scorer))?.sets?.length ?? 0) === 0);
  const named = (await seen(league))?.sets?.[0];
  const leagueUser = (await q(`select id, name from app_user where email = 'league@example.invalid'`))[0];
  ok("a version names who made and published it, beside the ids (uuids kept)",
     named?.createdBy === leagueUser.id && named?.createdByName === leagueUser.name
     && named?.publishedBy === leagueUser.id && named?.publishedByName === leagueUser.name
     && named?.withdrawnBy === null && named?.withdrawnByName === null, JSON.stringify(named).slice(0, 300));
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  ok("dates are plain YYYY-MM-DD, not a timestamp: a version's day and a figure's source date",
     named?.effectiveFrom === D1 && DAY.test(named.effectiveFrom)
     && named.values.find((v) => v.key === "bowling.max_overs_per_bowler_innings")?.sourceDate === "2026-09-15"
     && named.values.find((v) => v.key === "format.free_hit")?.sourceDate === null,
     JSON.stringify([named?.effectiveFrom, named?.values?.map((v) => v.sourceDate)]));
  ok("...and each figure who entered it", named?.values?.length > 0 && named.values.every((v) => v.enteredBy === leagueUser.id && v.enteredByName === leagueUser.name));
  ok("...a reader who may not read that user gets the id and no name (app_user's own policy)",
     afterPub.sets[0].createdBy === leagueUser.id && [null, leagueUser.name].includes(afterPub.sets[0].createdByName));

  // ── C ──────────────────────────────────────────────────────────
  group("C. Published is immutable; a change is a new version");
  const late = await enter(V1, { key: "format.free_hit", value: true, status: "unconfirmed" });
  ok("a published figure is not re-entered (published_is_immutable)", late.status === 422 && late.body?.error === "published_is_immutable");
  refused = null;
  try { await q(`update condition_value set value = 'true' where set_id = $1 and key = 'format.free_hit'`, [V1]); }
  catch (e) { refused = e.code; }
  ok("...not even by the owner, straight at the table (the trigger)", refused === "23514", refused);
  refused = null;
  try { await q(`update condition_set set effective_from = effective_from + 1 where id = $1`, [V1]); } catch (e) { refused = e.code; }
  ok("...nor its date", refused === "23514", refused);
  const v2 = await api(`/api/condition-sets/${V1}/new-version`, { method: "POST", token: league });
  ok("a new version copies it, as a draft that supersedes it", v2.body?.ok === true && v2.body?.version === 2);
  const V2 = v2.body?.setId;
  const v2row = (await seen(league))?.sets?.find((s) => s.id === V2);
  ok("...every figure, and `supersedes` set", v2row?.values?.length === 5 && v2row?.supersedes === V1 && v2row?.status === "draft");
  ok("the new version says free hit yes, from D2",
     (await enter(V2, { key: "format.free_hit", value: true, status: "unconfirmed" })).body?.ok === true
     && (await api(`/api/condition-sets/${V2}`, { method: "POST", token: league, body: { effectiveFrom: D2 } })).body?.ok === true);

  // ── D ──────────────────────────────────────────────────────────
  group("D. Never retroactive; never by a support session");
  const vToday = await api(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: league, body: { title: "Dated today", effectiveFrom: today } });
  const pToday = await api(`/api/condition-sets/${vToday.body?.setId}/publish`, { method: "POST", token: league });
  ok("a version dated today is not published (effective_from_not_future)", pToday.status === 422 && pToday.body?.error === "effective_from_not_future", JSON.stringify(pToday.body));
  const vPast = await api(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: league, body: { title: "Dated last week", effectiveFrom: dayOf(-7) } });
  ok("...nor one dated last week", (await api(`/api/condition-sets/${vPast.body?.setId}/publish`, { method: "POST", token: league })).body?.error === "effective_from_not_future");
  ok("the abandoned drafts are withdrawn, with a note",
     (await api(`/api/condition-sets/${vToday.body?.setId}/withdraw`, { method: "POST", token: league, body: { note: "dated wrongly, abandoned" } })).body?.ok === true
     && (await api(`/api/condition-sets/${vPast.body?.setId}/withdraw`, { method: "POST", token: league, body: { note: "dated wrongly, abandoned" } })).body?.ok === true);
  ok("a withdrawal says why", (await api(`/api/condition-sets/${V2}/withdraw`, { method: "POST", token: league, body: { note: "no" } })).body?.error === "note_required");
  ok("version 2 is published, from D2", (await api(`/api/condition-sets/${V2}/publish`, { method: "POST", token: league })).body?.ok === true);
  const vBehind = await api(`/api/competitions/${LEAGUE}/playing-conditions`, { method: "POST", token: league, body: { title: "Behind v2", effectiveFrom: D1 } });
  ok("a later version may not reach back behind the newest one's date",
     (await api(`/api/condition-sets/${vBehind.body?.setId}/publish`, { method: "POST", token: league })).body?.error === "effective_from_behind_latest");

  // Support: a league Hilton organises, and support reaching Hilton as its competitionadmin.
  const [{ id: HLEAGUE }] = await q(`insert into competition (school_id, name, comp_type, format, age_group, level)
                                      values ($1, 'Hilton Festival', 'festival', 'T20', '1XI', 'school') returning id`, [HIL]);
  await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, '1XI', 'Hilton 1st XI')`, [HLEAGUE, HIL]);
  const sup = await api("/api/support/access", { method: "POST", token: platform,
    body: { schoolId: HIL, role: "competitionadmin", reason: "ticket 5114: festival conditions not showing" } });
  ok("the platform opens a support session at Hilton as competitionadmin", sup.status === 200 && !!sup.body?.id, JSON.stringify(sup.body));
  const sDraft = await api(`/api/competitions/${HLEAGUE}/playing-conditions`, { method: "POST", token: platform, body: { title: "Support's draft", effectiveFrom: D1 } });
  ok("...which may draft, as the role would", sDraft.body?.ok === true, JSON.stringify(sDraft.body));
  const sPub = await api(`/api/condition-sets/${sDraft.body?.setId}/publish`, { method: "POST", token: platform });
  ok("...and may not publish (support_session)", sPub.status === 422 && sPub.body?.error === "support_session", JSON.stringify(sPub.body));
  ok("...nor withdraw", (await api(`/api/condition-sets/${sDraft.body?.setId}/withdraw`, { method: "POST", token: platform, body: { note: "support tidying up" } })).body?.error === "support_session");
  await api(`/api/support/access/${sup.body?.id}/end`, { method: "POST", token: platform });

  // ── E ──────────────────────────────────────────────────────────
  group("E. The fixture: in a competition its sides entered; pre-filled from its day");
  const at = (d) => new Date(`${d}T08:00:00Z`).toISOString();
  const f1 = await api("/api/fixtures", { method: "POST", token: sarah,
    body: { schoolId: HIL, teamCode: "1XI", opponent: "Michaelhouse 1st XI", startsAt: at(dayOf(3)), competitionId: LEAGUE, format: "T20", overs: 20 } });
  ok("Hilton's 1st XI, an entrant, is arranged in the league", f1.status === 200 && f1.body?.competitionId === LEAGUE, JSON.stringify(f1.body));
  const f2 = await api("/api/fixtures", { method: "POST", token: sarah,
    body: { schoolId: HIL, teamCode: "U16B", opponent: "Kearsney U16B", startsAt: at(dayOf(3)), competitionId: LEAGUE } });
  ok("a side that never entered it is refused, in words", f2.status === 422 && /home side has not entered/.test(f2.body?.detail ?? ""), JSON.stringify(f2.body));
  const f3 = await api("/api/fixtures", { method: "POST", token: sarah,
    body: { schoolId: HIL, teamCode: "1XI", awaySchoolId: WES, awayTeamCode: "U15A", startsAt: at(dayOf(3)), competitionId: LEAGUE } });
  ok("...and so is an away tenant side that did not enter it", f3.status === 422 && /away side has not entered/.test(f3.body?.detail ?? ""), JSON.stringify(f3.body));
  const pre = await api(`/api/competitions/${LEAGUE}/playing-conditions/preview?on=${dayOf(3)}`, { token: sarah });
  ok("the screen's pre-fill for a fixture on D1+1: version 1, T20 at 20 overs",
     pre.body?.set?.version === 1 && pre.body?.prefill?.format === "T20" && pre.body?.prefill?.overs === 20, JSON.stringify(pre.body));
  ok("...its dates are plain YYYY-MM-DD, not a timestamp: the day asked, the version's day",
     pre.body?.on === dayOf(3) && pre.body?.set?.effectiveFrom === D1, JSON.stringify(pre.body?.set));
  const preToday = await api(`/api/competitions/${LEAGUE}/playing-conditions/preview?on=${today}`, { token: sarah });
  ok("...and for a fixture today, no version yet: nothing to pre-fill from the set", preToday.body?.set === null);

  // ── F ──────────────────────────────────────────────────────────
  group("F. The start day decides; a friendly; a departure before play");
  const M1 = await fixture({ competition: LEAGUE, days: 3 });   // under v1
  const M2 = await fixture({ competition: LEAGUE, days: 7 });   // under v2
  const doc = async (m, token = sarah) => (await api(`/api/matches/${m}/playing-conditions`, { token })).body;
  const d1 = await doc(M1), d2 = await doc(M2);
  ok("a fixture on D1+1 resolves version 1 (no free hit), not version 2 published after it",
     d1?.fixed === false && d1?.setVersion === 1 && d1?.doc?.play?.["format.free_hit"] === false, JSON.stringify(d1));
  ok("a fixture on D2+1 resolves version 2 (free hit)", d2?.setVersion === 2 && d2?.doc?.play?.["format.free_hit"] === true);
  ok("every figure names its source", d1?.sources?.["format.free_hit"]?.from === "set" && d1?.sources?.["format.free_hit"]?.status === "unconfirmed"
     && d1?.sources?.["bowling.max_overs_per_bowler_innings"]?.clause === "7.3"
     && d1?.sources?.["format.overs_per_innings"]?.from === "fixture" && d1?.sources?.["result.min_overs_per_side"]?.from === "platform_default");
  const FR = await fixture({ days: 3, format: "Two-Day", overs: 80 });
  const fr = await doc(FR);
  ok("a friendly resolves the platform's defaults and the fixture: a Two-Day, no free hit, no version",
     fr?.setId === null && fr?.doc?.play?.["format.free_hit"] === false && fr?.doc?.play?.["format.kind"] === "declaration"
     && fr?.doc?.play?.["format.overs_per_innings"] === 80 && fr?.doc?.play?.["format.innings_per_side"] === 2
     && fr?.doc?.table?.["nrr.method"] === "standard", JSON.stringify(fr?.doc));
  const ov = (m, body, token = league) => api(`/api/matches/${m}/playing-conditions/override`, { method: "POST", token, body });
  ok("a departure needs a reason", (await ov(M1, { key: "bowling.max_overs_per_bowler_innings", value: 3, reason: "short" })).body?.error === "reason_required");
  ok("the league departs from it for M1 before play", (await ov(M1, { key: "bowling.max_overs_per_bowler_innings", value: 3, reason: "festival day: shortened spells agreed" })).body?.ok === true);
  ok("Hilton may not depart from a league's conditions", (await ov(M1, { key: "format.free_hit", value: true, reason: "we would like free hits" }, sarah)).status === 403);
  ok("...but departs from its own friendly's (fixture.update)", (await ov(FR, { key: "format.overs_per_innings", value: 70, reason: "rain forecast, agreed shorter" }, sarah)).body?.ok === true);
  const d1b = await doc(M1);
  ok("the departure is in the document, with its reason", d1b?.doc?.play?.["bowling.max_overs_per_bowler_innings"] === 3
     && d1b?.sources?.["bowling.max_overs_per_bowler_innings"]?.from === "override" && d1b?.overrides?.length === 1);

  // ── G ──────────────────────────────────────────────────────────
  group("G. The first event fixes it, on the live path, inside the lock");
  const c1 = await api(`/api/matches/${M1}/session/claim`, { method: "POST", token: scorer, body: { device: DEV_A } });
  ok("the scorer claims M1", c1.body?.ok === true, JSON.stringify(c1.body));
  ok("claiming fixes nothing", (await q(`select 1 from match_conditions where match_id = $1`, [M1])).length === 0);
  const sent = await api(`/api/matches/${M1}/events`, { method: "POST", token: scorer,
    body: { events: nbThenBowled().map((e) => envelope(e, c1.body.epoch, DEV_A)) } });
  ok("the first over is accepted — a condition never refuses a delivery", sent.body?.accepted?.length === 5, JSON.stringify(sent.body));
  const [row] = await q(`select set_version, doc, doc_hash, fixed_by from match_conditions where match_id = $1`, [M1]);
  ok("the first event fixed the document: version 1, the departure in it, by the scorer",
     row?.set_version === 1 && row?.doc?.play?.["format.free_hit"] === false && row?.doc?.play?.["bowling.max_overs_per_bowler_innings"] === 3
     && row?.fixed_by === "88888888-0000-0000-0000-000000000006", JSON.stringify(row));
  const [{ wickets }] = await q(`select wickets from match_live_score where match_id = $1 and innings = 0`, [M1]);
  ok("no free hit in this league: the bowled after the no-ball stands (match_live_score)", Number(wickets) === 1);
  const read = await api(`/api/matches/${M1}/events`, { token: scorer });
  ok("the events read tells a pad the document and its hash", read.body?.fold?.conditions?.["format.free_hit"] === false
     && read.body?.fold?.conditionsHash === row?.doc_hash && read.body?.fold?.conditionsFixed === true, JSON.stringify(read.body?.fold));
  const folded = deriveMatch(read.body.events.map(fromRow), read.body.fold);
  ok("...and the fold of the log under it agrees with SQL", folded.innings[0].wickets === 1 && folded.innings[0].conditionsHash === row?.doc_hash);
  ok("an override after fixing is refused (conditions_fixed)", (await ov(M1, { key: "format.free_hit", value: true, reason: "changed our minds" })).body?.error === "conditions_fixed");
  const move = await api(`/api/fixtures/${M1}`, { method: "POST", token: sarah, body: { competitionId: null } });
  ok("the competition it was played under does not change once scored", move.status === 422, JSON.stringify(move.body));
  refused = null;
  try { await q(`update match_conditions set doc = jsonb_set(doc, '{play,format.free_hit}', 'true') where match_id = $1`, [M1]); } catch (e) { refused = e.code; }
  ok("the play part is frozen, even to the owner (the trigger)", refused === "23514", refused);
  const v3 = await api(`/api/condition-sets/${V2}/new-version`, { method: "POST", token: league });
  await enter(v3.body?.setId, { key: "format.free_hit", value: true, status: "unconfirmed" });
  await api(`/api/condition-sets/${v3.body?.setId}`, { method: "POST", token: league, body: { effectiveFrom: D2 } });
  ok("a later version is published", (await api(`/api/condition-sets/${v3.body?.setId}/publish`, { method: "POST", token: league })).body?.ok === true);
  const [again] = await q(`select doc_hash from match_conditions where match_id = $1`, [M1]);
  ok("...and M1's document is untouched", again?.doc_hash === row?.doc_hash);
  const more = await api(`/api/matches/${M1}/events`, { method: "POST", token: scorer,
    body: { events: [envelope(batters({ striker: P[2], nonStriker: P[1] }), c1.body.epoch, DEV_A)] } });
  const [after2] = await q(`select doc_hash, fixed_at from match_conditions where match_id = $1`, [M1]);
  ok("a second batch is written and fixes nothing again", more.body?.accepted?.length === 1 && after2?.doc_hash === row?.doc_hash,
     JSON.stringify(more.body));

  // No backfill: a match with events and no row stays without one.
  const OLD = "77777777-0000-0000-0000-000000000004";
  ok("the seed's scored match has no document, and never gets one (D4)",
     (await q(`select 1 from match_conditions where match_id = $1`, [OLD])).length === 0
     && (await q(`select applies from match_playing_conditions($1)`, [OLD])).length <= 1);

  // ── H ──────────────────────────────────────────────────────────
  group("H. The pad's resume credential fixes it the same way");
  const M3 = await fixture({ competition: LEAGUE, days: 4 });
  const c3 = await api(`/api/matches/${M3}/session/claim`, { method: "POST", token: scorer, body: { device: DEV_A } });
  const pair = await newPadKeyPair();
  const iss = await api(`/api/matches/${M3}/session/pad-credential`, { method: "POST", token: scorer, body: { jwk: await padPublicJwk(pair) } });
  ok("the phone holding M3 is issued a resume credential", iss.body?.ok === true, JSON.stringify(iss.body));
  const padSend = async (path, { method = "GET", body } = {}) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const proof = await padProof({ credentialId: iss.body.credential, privateKey: pair.privateKey, method, path, bodyText: text });
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: padAuthorization(proof) },
                                            body: body === undefined ? undefined : text });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const padRead0 = await padSend(`/api/matches/${M3}/events`);
  ok("the pad reads the preview before the first ball: no free hit, not fixed",
     padRead0.body?.fold?.conditions?.["format.free_hit"] === false && padRead0.body?.fold?.conditionsFixed === false, JSON.stringify(padRead0.body?.fold));
  const padSent = await padSend(`/api/matches/${M3}/events`, { method: "POST",
    body: { events: nbThenBowled().map((e) => envelope(e, c3.body.epoch, DEV_A)) } });
  ok("the first over, sent on the credential, is accepted", padSent.body?.accepted?.length === 5, JSON.stringify(padSent.body));
  const [row3] = await q(`select set_version, doc_hash, fixed_by from match_conditions where match_id = $1`, [M3]);
  ok("...and fixed the document, by the scorer, the hash the preview had", row3?.set_version === 1 && row3?.fixed_by === "88888888-0000-0000-0000-000000000006"
     && row3?.doc_hash === padRead0.body?.fold?.conditionsHash, JSON.stringify(row3));
  ok("the credential reaches no version (403 pad_scope)", (await padSend(`/api/competitions/${LEAGUE}/playing-conditions`)).status === 403);

  // ── I ──────────────────────────────────────────────────────────
  group("I. A handover asks the conditions' hash before the board");
  const arm = await api(`/api/matches/${M1}/session/handover/arm`, { method: "POST", token: scorer, body: { device: DEV_A, pending: 0, ballInFlight: false } });
  ok("phone A arms a handover of M1", arm.body?.ok === true, JSON.stringify(arm.body));
  const claimB = await api(`/api/matches/${M1}/session/handover/claim`, { method: "POST", token: scorerB, body: { device: DEV_B, code: arm.body?.code } });
  ok("phone B claims it, and is handed the log and the conditions' hash",
     claimB.body?.ok === true && claimB.body?.fold?.conditionsHash === row?.doc_hash, JSON.stringify(claimB.body?.fold));
  const board = deriveMatch(claimB.body.events.map(fromRow), claimB.body.fold).innings[0];
  const stale = await api(`/api/matches/${M1}/session/handover/verify`, { method: "POST", token: scorerB,
    body: { device: DEV_B, runs: board.runs, wickets: board.wickets, balls: board.balls, conditionsHash: "a-hash-from-a-stale-preview" } });
  ok("a different hash is refused first, in words, the board unread",
     stale.body?.ok === false && stale.body?.reason === "conditions_changed" && /conditions changed/.test(stale.body?.text ?? ""), JSON.stringify(stale.body));
  const [{ state }] = await q(`select state from scoring_session where match_id = $1`, [M1]);
  ok("...and nothing moved: still verifying", state === "verifying");
  const good = await api(`/api/matches/${M1}/session/handover/verify`, { method: "POST", token: scorerB,
    body: { device: DEV_B, runs: board.runs, wickets: board.wickets, balls: board.balls, conditionsHash: row?.doc_hash } });
  ok("the same hash and the right board: phone B has the match", good.body?.ok === true, JSON.stringify(good.body));
} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.stack ?? e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`PLAYING CONDITIONS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
