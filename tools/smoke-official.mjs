#!/usr/bin/env node
/**
 * When a result becomes official, through the API and against Postgres
 * (docs/design/OFFICIAL_RESULT.md S1, §6 "Walks"; db/114). A league match and
 * a friendly, scored on the real write path with both innings sealed, and
 * every reader and writer of the word:
 *
 *   A. Provisional: complete and unconfirmed. Hilton's director of sport reads
 *      it and may not confirm a league result (the organiser's, D2, Q1); the
 *      scorer may not either; the league may.
 *   B. A correction pending blocks it (amendment_pending); approved, the
 *      result may be confirmed (the seal broken only by the two-hand path).
 *   C. Confirmed by the league: "official", the role word, one low notice per
 *      side naming nobody; the public page says so at once in this process,
 *      and in a second process within the TTL; the table's provisional count
 *      falls by one and its points do not move (D10).
 *   D. Disputed by Westville's director (a short note refused): "under review"
 *      for staff, its words to the disputant and not to a coach, the public
 *      page "not official" with no "review" in it; Hilton may not clear a
 *      league dispute; the league clears it: official again.
 *   E. Reopened by an amendment: provisional, "was official", the reopening
 *      said to both sides at medium; re-confirmed: a second row beside the
 *      first; withdrawn by the league within the window.
 *   F. A friendly, its away side not on the platform (Q8): the director who
 *      approved its correction may not confirm it (you_wrote_this_log, D5);
 *      the principal does, and it stands alone. The organiser's To-resolve
 *      list and the director's.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-official.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { inningsStart, batters, bowler, ball, sealInnings, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";

const PORT = port(8944);
const PORT2 = port(8945);
const BASE = `http://127.0.0.1:${PORT}`;
const BASE2 = `http://127.0.0.1:${PORT2}`;
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

const env = (secret) => ({ ...process.env, DATABASE_URL: appUrl(), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
  SESSION_SECRET: "smoke-official-secret", PUBLIC_PAGES: "on", PUBLIC_PSEUDONYM_SECRET: secret });
const SECRET = "smoke-official-public-pseudonym-secret-0123456789";
const server = spawn(process.execPath, ["services/api/server.mjs"], { env: { ...env(SECRET), PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
const second = spawn(process.execPath, ["services/api/server.mjs"], { env: { ...env(SECRET), PORT: String(PORT2) }, stdio: ["ignore", "pipe", "pipe"] });
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));
second.stderr.on("data", (d) => serverErr.push(d.toString()));
const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (text, params) => (await pool.query(text, params)).rows;

const call = async (base, path, { method = "GET", token, body } = {}) => {
  const res = await fetch(base + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
};
const api = (path, opts) => call(BASE, path, opts);
const login = async (email, deviceId = "official-desk") => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 500)}`;
const official = (m, token) => api(`/api/matches/${m}/official`, { token });
const post = (path, token, body) => api(path, { method: "POST", token, body });

/** A league under the pilot's figures. */
async function league() {
  const [{ id: c }] = await q(`insert into competition (school_id, name, comp_type, format, level) values (null, 'Smoke 114 League', 'league', 'T20', 'school') returning id`);
  for (const [school, team, name] of [[HIL, "1XI", "Smoke 114 Hilton 1st XI"], [WES, "1XI", "Smoke 114 Westville 1st XI"]])
    await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, $3, $4)`, [c, school, team, name]);
  const [{ id: s }] = await q(`insert into condition_set (competition_id, version, title, effective_from, created_by) values ($1, 1, 'Smoke 114 v1', '2026-09-28', $2) returning id`, [c, OWNER]);
  for (const [k, val] of [["points.win", 4], ["points.tie", 2], ["points.no_result", 2], ["points.loss", 0]])
    await q(`insert into condition_value (set_id, key, value, status, source_document, source_clause, source_date, entered_by)
             values ($1, $2, $3, 'confirmed', 'Pilot league decision, Kameel', '8.3a', '2026-09-30', $4)`, [s, k, JSON.stringify(val), OWNER]);
  await q(`update condition_set set status = 'published', published_by = $2, published_at = '2026-09-27 12:00+02' where id = $1`, [s, OWNER]);
  await q(`insert into competition_publication (competition_id, published, set_by) values ($1, true, $2)`, [c, OWNER]);
  return c;
}

/** Score a match on the real write path: claim, then each innings' events and its seal. */
async function score(token, match, innings) {
  const device = "official-pad";
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

/** The fixture notices about a match, as the owner reads them. */
const notes = (m) => q(`select school_id, team_code, scope_level, urgency, title, body, retraction_kind, retracts_id, subject_person_id, recipient_id
                          from notification where kind = 'fixture' and subject_kind = 'match' and subject_id = $1
                         order by published_at, id`, [m]);

const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last.done) return last; await new Promise((r) => setTimeout(r, 200)); }
  return last;
};

try {
  for (const base of [BASE, BASE2]) {
    for (let i = 0; i < 80; i++) {
      try { const r = await call(base, "/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  await q(`insert into app_user (school_id, email, name, role) values ($1, 'smoke114.wesdos@example.invalid', 'Smoke114 Westville Director', 'directorofsport')`, [WES]);
  await q(`insert into role_assignment (person_id, role, school_id)
           select id, 'directorofsport', $1 from app_user where email = 'smoke114.wesdos@example.invalid'`, [WES]);
  const lg = await login("league@example.invalid");            // competitionadmin, no school: the organiser
  const sarah = await login("sarah@example.invalid");           // director of sport, Hilton
  const principal = await login("principal@example.invalid");   // principal, Hilton
  const scorer = await login("scorer@example.invalid", "official-pad");
  const wesCoach = await login("coach.wes@example.invalid");    // Westville 1XI coach
  const wesDos = await login("smoke114.wesdos@example.invalid");
  ok("everyone signs in", !!lg && !!sarah && !!principal && !!scorer && !!wesCoach && !!wesDos);

  const C = await league();
  const [{ id: M1 }] = await q(
    `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status, competition_id)
     values ($1, '1XI', $2, '1XI', 'x', $3, 'cricket', 'T20', 20, 'scheduled', $4) returning id`, [HIL, WES, STARTS, C]);
  const s1 = await score(scorer, M1, [
    { bat: "1XI", bowl: "Westville 1XI", squad: HIL_XI, bowlingSquad: WES_XI, runs: [1, 1, 1, 1, 1, 1] },
    { bat: "Westville 1XI", bowl: "1XI", squad: WES_XI, bowlingSquad: HIL_XI, runs: [0, 0, 0, 0, 0, 0], target: 7 },
  ]);
  ok("M1 scored on the write path, both innings sealed: every event taken", s1.accepted === 20, JSON.stringify(s1));
  await q(`update match set status = 'complete' where id = $1`, [M1]);
  await q(`insert into fixture_publication (match_id, side, school_id, team_code, published, set_by) values ($1, 'home', $2, '1XI', true, $3)`, [M1, HIL, OWNER]);

  // ── A ──────────────────────────────────────────────────────────
  group("A. Provisional, and who may make it official");
  const a1 = await official(M1, sarah);
  ok("Hilton's director reads it: provisional, staff, and he may not confirm a league result",
     a1.status === 200 && a1.body?.state === "provisional" && a1.body.staff === true && a1.body.may?.confirm === false
     && a1.body.confirmRefusal === null && a1.body.home === "Hilton College 1XI", show(a1));
  const a2 = await post(`/api/matches/${M1}/confirm`, sarah);
  ok("...and his confirm is refused: 403 not_permitted", a2.status === 403 && a2.body?.error === "not_permitted", show(a2));
  const a3 = await post(`/api/matches/${M1}/confirm`, scorer);
  ok("the scorer's confirm is refused: 403 not_permitted", a3.status === 403 && a3.body?.error === "not_permitted", show(a3));
  const a4 = await official(M1, lg);
  ok("the league may confirm it", a4.body?.state === "provisional" && a4.body.may?.confirm === true, show(a4));
  const a5 = await api(`/api/matches/${M1}/official`, {});
  ok("signed out: not this route (401 or 403)", a5.status === 401 || a5.status === 403, show(a5));

  // ── B ──────────────────────────────────────────────────────────
  group("B. A correction pending blocks it; approved, it does not");
  const req1 = await post(`/api/matches/${M1}/amendments`, scorer, { targetKey: s1.keys[3], reason: "the fourth ball was a dot" });
  const b1 = await post(`/api/matches/${M1}/confirm`, lg);
  ok("a pending amendment: 422 amendment_pending", req1.status === 200 && b1.status === 422 && b1.body?.error === "amendment_pending", `${show(req1)} ${show(b1)}`);
  const b2 = await official(M1, lg);
  ok("...and the state says why", b2.body?.state === "provisional" && b2.body.blockedBy === "amendment_pending" && b2.body.confirmRefusal === "amendment_pending", show(b2));
  const dec1 = await post(`/api/amendments/${req1.body?.id}/decide`, principal, { approve: true, note: "agreed with both umpires" });
  ok("the principal approves it", dec1.body?.ok === true, show(dec1));
  const b3 = await official(M1, lg);
  ok("...and the league may confirm the corrected result (the seal broken only by the two-hand path)",
     b3.body?.state === "provisional" && b3.body.may?.confirm === true && b3.body.blockedBy === null, show(b3));

  // ── C ──────────────────────────────────────────────────────────
  group("C. Confirmed by the league");
  const pubBefore = await api(`/api/public/matches/${M1}`);
  const pub2Before = await call(BASE2, `/api/public/matches/${M1}`);
  ok("the public page, read before (and cached in both processes): not official",
     pubBefore.body?.match?.result?.official === false && pub2Before.body?.match?.result?.official === false, show(pubBefore));
  const stBefore = await api(`/api/competitions/${C}/standings`, { token: lg });
  const c1 = await post(`/api/matches/${M1}/confirm`, lg);
  ok("the league confirms it", c1.status === 200 && c1.body?.ok === true && !!c1.body.id, show(c1));
  const c2 = await official(M1, lg);
  ok("official, confirmed as the organiser, his to withdraw", c2.body?.state === "official" && c2.body.confirmedAs === "organiser"
     && c2.body.confirmer === "you" && c2.body.may?.withdraw === true && c2.body.confirmRefusal === "already_official", show(c2));
  const c3 = await post(`/api/matches/${M1}/confirm`, lg);
  ok("a second confirm: 422 already_official", c3.status === 422 && c3.body?.error === "already_official", show(c3));
  const n1 = await notes(M1);
  ok("one low notice per side, a fixture's, naming nobody",
     n1.length === 2 && n1.every((n) => n.urgency === "low" && n.scope_level === "team" && n.subject_person_id === null
                                     && n.title === "Official result · Hilton College 1XI v Westville Boys' High 1XI")
     && new Set(n1.map((n) => n.school_id)).size === 2, JSON.stringify(n1));
  const pubAfter = await api(`/api/public/matches/${M1}`);
  ok("the public page says it at once, in this process: official, and when — never who",
     pubAfter.body?.match?.result?.official === true && typeof pubAfter.body.match.result.officialAt === "string"
     && !/organiser|confirmed_by|league@/i.test(pubAfter.text), show(pubAfter));
  const pub2 = await until(async () => { const r = await call(BASE2, `/api/public/matches/${M1}`); return { r, done: r.body?.match?.result?.official === true }; });
  ok("...and a second process within the TTL (its cache dropped by db/114's notification)", pub2?.done === true, show(pub2?.r ?? {}));
  const stAfter = await api(`/api/competitions/${C}/standings`, { token: lg });
  const pts = (b) => (b?.rows ?? []).map((r) => `${r.side}=${r.points}/${r.played}`).join(" ");
  ok("the table's points do not move (D10); its provisional count falls by one",
     pts(stAfter.body) === pts(stBefore.body) && stBefore.body?.provisionalResults === 1 && stAfter.body?.provisionalResults === 0,
     `${pts(stBefore.body)} → ${pts(stAfter.body)}; ${stBefore.body?.provisionalResults} → ${stAfter.body?.provisionalResults}`);
  const pubSt = await api(`/api/public/competitions/${C}/standings`);
  ok("...and the public table carries the count", pubSt.status === 200 && pubSt.body?.provisionalResults === 0, show(pubSt));

  // ── D ──────────────────────────────────────────────────────────
  group("D. Disputed by Westville, cleared by the league");
  const d0 = await official(M1, wesDos);
  ok("Westville's director may dispute it", d0.body?.state === "official" && d0.body.may?.dispute === true, show(d0));
  const d1 = await post(`/api/matches/${M1}/dispute`, wesDos, { note: "short" });
  ok("a short note: 422 note_required", d1.status === 422 && d1.body?.error === "note_required", show(d1));
  const d2 = await post(`/api/matches/${M1}/dispute`, scorer, { note: "the scorer disagrees with it" });
  ok("the scorer's dispute: 403 not_permitted", d2.status === 403, show(d2));
  const d3 = await post(`/api/matches/${M1}/dispute`, wesDos, { note: "our book shows the fifth ball as a dot" });
  ok("Westville disputes it", d3.status === 200 && d3.body?.ok === true, show(d3));
  const d4 = await official(M1, wesDos);
  ok("under review for staff, by the away school, its words to the disputant",
     d4.body?.state === "under_review" && d4.body.disputedAs === "away_school" && d4.body.disputeNote === "our book shows the fifth ball as a dot", show(d4));
  const d5 = await official(M1, wesCoach);
  ok("...a coach reads that it is under review, and not its words", d5.body?.state === "under_review" && d5.body.disputeNote === null
     && d5.body.may?.clear === false, show(d5));
  const d6 = await api(`/api/public/matches/${M1}`);
  ok("the public page: not official, and no word of a review or its note",
     d6.body?.match?.result?.official === false && d6.body.match.result.officialAt === null && !/review|dispute|fifth ball/i.test(d6.text), show(d6));
  const d7 = await post(`/api/results/disputes/${c1.body?.id}/clear`, sarah, { note: "Hilton has checked its book" });
  ok("Hilton may not clear a league dispute: 403", d7.status === 403, show(d7));
  const d8 = await post(`/api/results/disputes/${c1.body?.id}/clear`, lg, { note: "both books checked; the single stands" });
  ok("the league clears it: official again", d8.body?.ok === true && (await official(M1, lg)).body?.state === "official", show(d8));

  // ── E ──────────────────────────────────────────────────────────
  group("E. Reopened by a correction, confirmed again, withdrawn");
  const req2 = await post(`/api/matches/${M1}/amendments`, scorer, { targetKey: s1.keys[4], reason: "the fifth ball was a dot too" });
  const dec2 = await post(`/api/amendments/${req2.body?.id}/decide`, principal, { approve: true, note: "agreed again" });
  ok("a second correction, asked and approved", req2.status === 200 && dec2.body?.ok === true, `${show(req2)} ${show(dec2)}`);
  const e1 = await official(M1, lg);
  ok("provisional again by itself: reopened by a correction, was official", e1.body?.state === "provisional"
     && e1.body.lapsedReason === "correction" && !!e1.body.wasOfficialAt && e1.body.may?.confirm === true, show(e1));
  const n2 = await notes(M1);
  ok("the official notices taken back superseded, saying nothing; the reopening said to both sides at medium",
     n2.filter((n) => n.urgency === "low" && n.retraction_kind === "superseded").length === 2
     && n2.filter((n) => n.retracts_id).length === 0
     && n2.filter((n) => n.urgency === "medium" && n.scope_level === "team" && n.title.startsWith("Result reopened · ")
                         && n.body.includes("is no longer official: the scorecard was corrected at")).length === 2, JSON.stringify(n2));
  const [{ id: LEAGUE }] = await q(`select id from app_user where email = 'league@example.invalid'`);
  ok("...and the league's organiser by name (it has no organising school: D8, D9)",
     n2.filter((n) => n.scope_level === "competition" && n.recipient_id === LEAGUE && n.urgency === "medium"
                      && n.body.includes("the scorecard was corrected at")).length === 1, JSON.stringify(n2));
  const pubE = await api(`/api/public/matches/${M1}`);
  ok("the public page follows at once: not official", pubE.body?.match?.result?.official === false, show(pubE));
  const e2 = await post(`/api/matches/${M1}/confirm`, lg);
  const [{ n: rows }] = await q(`select count(*)::int n from match_result_confirmation where match_id = $1`, [M1]);
  ok("confirmed again: a second row, the first kept", e2.body?.ok === true && rows === 2, `${show(e2)} rows=${rows}`);
  const e3 = await post(`/api/results/confirmations/${e2.body?.id}/withdraw`, lg, { note: "no" });
  ok("a withdrawal needs a note", e3.status === 422 && e3.body?.error === "note_required", show(e3));
  const e4 = await post(`/api/results/confirmations/${e2.body?.id}/withdraw`, sarah, { note: "not his to take back" });
  ok("...and is the confirmer's alone: 403", e4.status === 403, show(e4));
  const e5 = await post(`/api/results/confirmations/${e2.body?.id}/withdraw`, lg, { note: "confirmed before the umpires' sheet arrived" });
  const e6 = await official(M1, lg);
  ok("withdrawn within the window: provisional, and both sides told", e5.body?.ok === true && e6.body?.state === "provisional"
     && (await notes(M1)).filter((n) => n.scope_level === "team" && n.body.includes("the confirmation was withdrawn at")).length === 2, `${show(e5)} ${show(e6)}`);

  // ── F ──────────────────────────────────────────────────────────
  group("F. A friendly whose away side is not on the platform (Q8, D5)");
  const [{ id: F }] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, '2XI', 'Kearsney College', $2, 'cricket', 'T20', 20, 'scheduled') returning id`, [HIL, STARTS]);
  const sf = await score(scorer, F, [
    { bat: "2XI", bowl: "Kearsney College", squad: HIL_XI, bowlingSquad: WES_XI, runs: [2, 2, 2, 0, 0, 0] },
    { bat: "Kearsney College", bowl: "2XI", squad: WES_XI, bowlingSquad: HIL_XI, runs: [1, 0, 0, 0, 0, 0], target: 7 },
  ]);
  await q(`update match set status = 'complete' where id = $1`, [F]);
  const reqF = await post(`/api/matches/${F}/amendments`, scorer, { targetKey: sf.keys[6], reason: "the last ball was a dead ball" });
  const decF = await post(`/api/amendments/${reqF.body?.id}/decide`, sarah, { approve: true, note: "agreed with the umpire" });
  ok("the friendly scored, and a correction approved by Hilton's director", sf.accepted === 20 && decF.body?.ok === true, `${JSON.stringify(sf).slice(0, 200)} ${show(decF)}`);
  const f1 = await official(F, sarah);
  ok("he reads why he may not confirm it: you_wrote_this_log", f1.body?.may?.confirm === false && f1.body.confirmRefusal === "you_wrote_this_log", show(f1));
  const f2 = await post(`/api/matches/${F}/confirm`, sarah);
  ok("...and his confirm is refused in those words (422)", f2.status === 422 && f2.body?.error === "you_wrote_this_log", show(f2));
  const qs = await api(`/api/results/to-confirm`, { token: sarah });
  ok("his To-resolve list has it, blocked, so somebody else does it",
     qs.status === 200 && qs.body?.rows?.some((r) => r.matchId === F && r.kind === "blocked" && r.blockedBy === "you_wrote_this_log"), show(qs));
  const qp = await api(`/api/results/to-confirm`, { token: principal });
  ok("the principal's list has it to confirm", qp.body?.rows?.some((r) => r.matchId === F && r.kind === "confirm"), show(qp));
  const ql = await api(`/api/results/to-confirm`, { token: lg });
  ok("the organiser's list has the league match, and not the friendly",
     ql.body?.rows?.some((r) => r.matchId === M1 && r.kind === "confirm") && !ql.body.rows.some((r) => r.matchId === F), show(ql));
  const f3 = await post(`/api/matches/${F}/confirm`, principal);
  const f4 = await official(F, principal);
  ok("the principal confirms it, as the home school, and it stands alone",
     f3.body?.ok === true && f4.body?.state === "official" && f4.body.confirmedAs === "home_school", `${show(f3)} ${show(f4)}`);
  ok("...one notice, to the home side only", (await notes(F)).length === 1);
} catch (err) {
  ok(`the walk threw: ${err.message?.slice(0, 300)}`, false);
  console.log(err.stack?.split("\n").slice(0, 6).join("\n"));
} finally {
  server.kill("SIGTERM");
  second.kill("SIGTERM");
  await pool.end();
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:");
  console.log(serverErr.join("").split("\n").slice(0, 16).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nOFFICIAL SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
