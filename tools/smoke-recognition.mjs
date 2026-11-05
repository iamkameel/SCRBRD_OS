#!/usr/bin/env node
/**
 * Honours are awarded, caps are earned, milestones happen. None is a score.
 *
 *   1. AN HONOUR IS A SCHOOL'S STATEMENT: awarded by the people who sign the
 *      board, stamped from the session, one of each kind a season, never
 *      edited — withdrawn with a reason, and it stays. Read by whoever reads
 *      the roster he is on; public only when somebody says so.
 *   2. A CAP IS DERIVED FROM THE TEAM SHEETS: the eleven, not the twelfth
 *      man, not a withdrawn name, not a fixture still to come. Numbered from
 *      the baseline the school sets for the caps it awarded before.
 *   3. A MILESTONE IS DERIVED FROM THE LOG: fifty, hundred, five-for,
 *      hat-trick, career marks — and noticed once, the ball it lands on.
 *   4. THE PROFILE'S VIEW IS GATED ON THE ROSTER READ, per boy.
 *   5. PLAYER OF THE MATCH, THE COACH'S PATH (RECOGNITION R6, db/142): the
 *      side's coach or the director of sport decides it for a verified
 *      match, from the side's sheet, with R1's suggestions shown and stored;
 *      never another side's coach, never a guardian of the boy; one per side;
 *      the side is told and no child alone; a withdrawal says its kind, and
 *      only a correction is told; the audit log words it.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-recognition.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";
import { inningsStart, batters, bowler, ball, sealInnings, deriveInnings, BALL_TYPE } from "@scrbrd/scoring";

const PORT = port(8868);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = ownerUrl();
const HIL = "11111111-1111-1111-1111-111111111111";
const SCORER = "88888888-0000-0000-0000-000000000006";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";  // colours 2025/26, public
const BEKKER    = "aaaaaaaa-0000-0000-0000-000000000002";
const NAIDOO    = "aaaaaaaa-0000-0000-0000-000000000003";  // captain 2026/27
const CELE      = "aaaaaaaa-0000-0000-0000-000000000004";
const PILLAY    = "aaaaaaaa-0000-0000-0000-000000000005";
const DLAMINI   = "aaaaaaaa-0000-0000-0000-000000000006";  // U16B
const NEWBOY    = "aaaaaaaa-0000-0000-0000-0000000000b1";
const SEEDED_MATCH = "77777777-0000-0000-0000-000000000001";   // complete, a week ago

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(d).slice(0, 500)}`); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-recognition-secret" },
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
  method: "POST", body: { email, deviceId: "device-recognition" } })).body?.token;
const rows = async (path, tok) => (await api(path, { token: tok })).body?.rows ?? [];
const recog = (id, tok) => rows(`/api/read/recognition?playerId=${id}`, tok);
const caps = (team, tok) => rows(`/api/read/caps?teamCode=${team}`, tok);
const award = (tok, body) => api("/api/honours", { method: "POST", token: tok, body });
const withdraw = (id, tok, reason = "Awarded to the wrong boy") => api(`/api/honours/${id}/withdraw`, { method: "POST", token: tok, body: { reason } });
const notices = (tok) => rows("/api/read/notifications", tok);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

let seq = 0, key = 0;
async function feed(matchId, innings, balls) {
  for (const b of balls) {
    await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key,
                                     client_seq, client_ts, kind, ball_type, value, striker_id, bowler_id, dismissal)
             values ($1, $2, $3, 0, $4, $5, 'walk', $6, $3, now(), 'ball', $7, $8, $9, $10, $11)`,
            [matchId, HIL, ++seq, innings, SCORER, `rc-${++key}`, b.t, b.v ?? 0, b.s ?? null, b.b ?? null, b.d ?? null]);
  }
}
const fours = (striker, bowler, n) => Array.from({ length: n }, () => ({ t: "run", v: 4, s: striker, b: bowler }));
const wicket = (striker, bowler, how = "bowled") => ({ t: "W", v: 0, s: striker, b: bowler, d: how });
const dot = (striker, bowler) => ({ t: "run", v: 0, s: striker, b: bowler });
const fixture = async (team, daysAgo, status = "complete", opponent = "Kearsney") => (await q(
  `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
   values ($1, $2, $3, now() - ($4 || ' days')::interval, 'cricket', 'T20', 20, $5) returning id`,
  [HIL, team, opponent, String(daysAgo), status]))[0].id;
const pick = (m, id, extra = "") => q(`insert into match_squad (match_id, player_id, side${extra ? ", " + extra : ""}) values ($1, $2, 'home'${extra ? ", true" : ""})`, [m, id]);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach   = await login("coach@example.invalid");        // 1XI
  const coach2  = await login("coach2@example.invalid");       // 2XI
  const head    = await login("sarah@example.invalid");        // director of sport: recognition.manage
  const registrar = await login("registrar@example.invalid");
  const principal = await login("principal@example.invalid");
  const parent  = await login("parent@example.invalid");       // R Pillay's
  const watcher = await login("watcher@example.invalid");
  const wesCoach = await login("coach.wes@example.invalid");
  const idOf = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

  group("An honour is a school's statement");
  {
    const r = await recog(WHITFIELD, coach);
    ok("the coach reads his player's recognition", r.length > 0);
    ok("...with the seeded colours on it", r.some((x) => x.family === "honour" && x.kind === "colours" && x.season === "2025" && x.is_public === true));
    ok("...and a label, not a code", r.find((x) => x.kind === "colours")?.label === "Full colours");
    const a = await award(head, { playerId: BEKKER, kind: "half_colours", season: "2026", citation: "Forty wickets." });
    ok("the director of sport awards half colours", a.status === 200 && a.body?.kind === "half_colours");
    ok("...stamped from the session", a.body?.awardedBy === await idOf("sarah@example.invalid"));
    ok("...with the school and side from the boy, not the request", a.body?.schoolId === HIL && a.body?.teamCode === "1XI");
    ok("...not public until somebody says so", a.body?.isPublic === false);
    ok("the office can", (await award(registrar, { playerId: CELE, kind: "vice_captain", season: "2026" })).status === 200);
    ok("the principal can", (await award(principal, { playerId: PILLAY, kind: "award", name: "Fielder of the Year", season: "2026" })).status === 200);
    ok("a coach cannot", [403, 401].includes((await award(coach, { playerId: BEKKER, kind: "colours", season: "2026" })).status));
    ok("another school's coach cannot", [403, 401].includes((await award(wesCoach, { playerId: BEKKER, kind: "colours", season: "2026" })).status));
    ok("one of each kind a season", (await award(head, { playerId: BEKKER, kind: "half_colours", season: "2026" })).status === 422);
    ok("...but two named awards are two awards", (await award(head, { playerId: PILLAY, kind: "award", name: "Most Improved", season: "2026" })).status === 200);
    ok("an award without a name is refused", (await award(head, { playerId: BEKKER, kind: "award", season: "2026" })).status === 400);
    ok("a kind outside the vocabulary is refused", (await award(head, { playerId: BEKKER, kind: "legend", season: "2026" })).status === 400);
    ok("a season that is not a season is refused", (await award(head, { playerId: BEKKER, kind: "honours", season: "next year" })).status === 400);
    ok("a club season is not a school season, however it is typed",
       (await award(head, { playerId: BEKKER, kind: "honours", season: "2026/27" })).body?.error === "season_unknown_at_school_level");
    ok("...nor is a year the calendar does not hold", (await award(head, { playerId: BEKKER, kind: "honours", season: "2041" })).status === 400);
    ok("a boy who does not exist is a 404", (await award(head, { playerId: "00000000-0000-0000-0000-00000000dead", kind: "honours", season: "2026" })).status === 404);
    ok("the citation cannot be edited after",
       !(await q(`update honour set citation = 'Fifty wickets.' where id = $1`, [a.body.id]).then(() => true).catch(() => false)));
    ok("a coach cannot withdraw", (await withdraw(a.body.id, coach)).body?.withdrawn === 0);
    ok("a withdrawal needs a reason", (await withdraw(a.body.id, head, "")).status === 400);
    ok("the director of sport withdraws it", (await withdraw(a.body.id, head)).body?.withdrawn === 1);
    const w = (await q(`select withdrawn_by, withdrawn_reason from honour where id = $1`, [a.body.id]))[0];
    ok("...stamped with who and why", w.withdrawn_by === await idOf("sarah@example.invalid") && /wrong boy/.test(w.withdrawn_reason));
    ok("...and it leaves the boy's recognition", !(await recog(BEKKER, coach)).some((x) => x.id === a.body.id));
    ok("...but not the table", (await q(`select count(*)::int c from honour where id = $1`, [a.body.id]))[0].c === 1);
    ok("...and is not un-withdrawn", !(await q(`update honour set withdrawn_at = null, withdrawn_reason = null where id = $1`, [a.body.id]).then(() => true).catch(() => false)));
    ok("it can be awarded again", (await award(head, { playerId: BEKKER, kind: "half_colours", season: "2026" })).status === 200);
    const pub = (await q(`select id from honour where player_id = $1 and kind = 'vice_captain'`, [CELE]))[0].id;
    ok("putting a name on the board is the director's call", (await api(`/api/honours/${pub}/public`, { method: "POST", token: head, body: { isPublic: true } })).body?.updated === 1
       && (await recog(CELE, coach)).find((x) => x.kind === "vice_captain")?.is_public === true);
    ok("...and not a coach's", (await api(`/api/honours/${pub}/public`, { method: "POST", token: coach, body: { isPublic: false } })).body?.updated === 0);
    const board = await rows("/api/read/honours?teamCode=1XI", coach);
    ok("the side's honours read lists the live ones, newest first", board.length >= 5 && !board.some((h) => h.id === a.body.id)
       && board.every((h, i) => i === 0 || String(board[i - 1].awarded_on) >= String(h.awarded_on)));
    ok("a parent reads their own child's honours", (await recog(PILLAY, parent)).filter((x) => x.family === "honour").length === 2);
    ok("...and not a team-mate's", (await recog(WHITFIELD, parent)).length === 0);
    ok("a spectator reads none", (await recog(WHITFIELD, watcher)).length === 0);
    ok("the 2XI coach reads none of the 1XI's", (await recog(WHITFIELD, coach2)).length === 0 && (await rows("/api/read/honours?teamCode=1XI", coach2)).length === 0);
  }

  group("A cap is earned, and numbered from where the board left off");
  {
    const ledger = await caps("1XI", coach);
    ok("the 1XI has a caps ledger from the seeded fixture", ledger.length >= 3);
    ok("...numbered from the baseline", ledger[0].cap_no === 412 && ledger[0].baseline_set === true);
    ok("...in a stable order", ledger.every((c, i) => i === 0 || c.cap_no === ledger[i - 1].cap_no + 1));
    ok("...one appearance each so far", ledger.every((c) => c.appearances === 1));
    const before = ledger.length;
    // A fixture still to come adds nothing; a twelfth man on a played one adds nothing; a withdrawn name adds nothing.
    const soon = await fixture("1XI", -3, "scheduled");
    // An adult, so the selection rule (a minor needs a verified guardian and consent) is not what this walk is about.
    await q(`insert into player (id, school_id, team_code, full_name, squad_no, playing_role, born) values ($1, $2, '1XI', 'Z Ngwenya', 31, 'batter', '2007-06-06')`, [NEWBOY, HIL]);
    await pick(soon, NEWBOY);
    ok("a fixture still to come is not a cap", (await caps("1XI", coach)).length === before);
    const played = await fixture("1XI", 2, "complete", "Michaelhouse");
    for (const id of [WHITFIELD, BEKKER, NAIDOO]) await pick(played, id);
    await pick(played, NEWBOY, "twelfth");
    ok("the twelfth man does not get a cap", !(await caps("1XI", coach)).some((c) => c.player_id === NEWBOY));
    ok("...while the eleven who played again have two appearances", (await caps("1XI", coach)).find((c) => c.player_id === WHITFIELD)?.appearances === 2);
    await q(`update match_squad set withdrawn = true where match_id = $1 and player_id = $2`, [played, NAIDOO]);
    ok("a withdrawn name is not an appearance", (await caps("1XI", coach)).find((c) => c.player_id === NAIDOO)?.appearances === 1);
    const debut = await fixture("1XI", 1, "complete", "DHS");
    await pick(debut, NEWBOY);
    const n = (await caps("1XI", coach)).find((c) => c.player_id === NEWBOY);
    ok("a debut is the next number", n && n.cap_no === 411 + before + 1 && n.appearances === 1);
    ok("...and shows on his recognition", (await recog(NEWBOY, coach)).some((x) => x.family === "cap" && x.value === n.cap_no && /1XI cap #/.test(x.label)));
    ok("a side with no baseline says so", await (async () => {
      const m = await fixture("U16B", 1, "complete");
      await pick(m, DLAMINI);
      const c = (await caps("U16B", head))[0];
      return c && c.cap_no === 1 && c.baseline_set === false && /no baseline set/.test((await recog(DLAMINI, head)).find((x) => x.family === "cap")?.label ?? "");
    })());
    ok("the director of sport sets a baseline", (await api("/api/cap-baselines", { method: "POST", token: head, body: { schoolId: HIL, teamCode: "U16B", capsBefore: 88, asOf: "2025-12-31" } })).status === 200
       && (await caps("U16B", head))[0].cap_no === 89);
    ok("...and a coach cannot", [403, 401].includes((await api("/api/cap-baselines", { method: "POST", token: coach, body: { schoolId: HIL, teamCode: "1XI", capsBefore: 0, asOf: "2025-12-31" } })).status));
    ok("...nor is a cap number ever typed in", !(await q(`set local role scrbrd_app; insert into team_cap values (null)`).then(() => true).catch(() => false)));
    ok("the 2XI coach reads no 1XI ledger", (await caps("1XI", coach2)).length === 0);
    ok("a spectator reads none", (await caps("1XI", watcher)).length === 0);
  }

  group("A milestone happens, and is noticed once");
  {
    const before = (await notices(coach)).filter((x) => x.kind === "recognition").length;
    const m = await fixture("1XI", 0, "live", "Glenwood");
    // Whitfield: 12 fours is 48, the thirteenth is fifty.
    await feed(m, 0, fours(WHITFIELD, "aaaaaaaa-0000-0000-0000-000000000001", 12));
    ok("forty-eight is not a fifty", !(await recog(WHITFIELD, coach)).some((x) => x.kind === "fifty" && x.match_id === m));
    await feed(m, 0, fours(WHITFIELD, null, 1));
    const fifty = (await recog(WHITFIELD, coach)).find((x) => x.family === "milestone" && x.match_id === m);
    ok("fifty-two is", fifty?.kind === "fifty" && fifty?.value === 52 && fifty?.opponent === "Glenwood");
    const n1 = (await notices(coach)).filter((x) => /Fifty for James Whitfield/.test(x.title));
    // is_public is dormant and no longer in the list read (NOTIFICATIONS.md D6,
    // db/89): the row itself says false, as every row does.
    ok("...and the side is told, the ball it lands on", n1.length === 1 && /against Glenwood/.test(n1[0].body)
       && (await q(`select is_public from notification where id = $1`, [n1[0].id]))[0]?.is_public === false);
    await feed(m, 0, fours(WHITFIELD, null, 5));
    ok("seventy-two is still one fifty and one notice", (await notices(coach)).filter((x) => /Fifty for James Whitfield/.test(x.title)).length === 1);
    await feed(m, 0, fours(WHITFIELD, null, 7));
    const ton = (await recog(WHITFIELD, coach)).filter((x) => x.family === "milestone" && x.match_id === m && ["fifty", "hundred"].includes(x.kind));
    ok("a hundred replaces the fifty on his record", ton.length === 1 && ton[0].kind === "hundred" && ton[0].value === 100);
    ok("...and is its own notice", (await notices(coach)).some((x) => /Hundred for James Whitfield/.test(x.title)));
    // Naidoo: four wickets, then a run out that is not his, then a fifth.
    await feed(m, 1, [wicket(CELE, NAIDOO), dot(CELE, NAIDOO), wicket(CELE, NAIDOO), wicket(CELE, NAIDOO), dot(CELE, NAIDOO), wicket(CELE, NAIDOO, "caught")]);
    await feed(m, 1, [wicket(CELE, NAIDOO, "run_out")]);
    ok("a run out is not the bowler's", !(await recog(NAIDOO, coach)).some((x) => x.kind === "five_for"));
    await feed(m, 1, [wicket(CELE, NAIDOO, "lbw")]);
    ok("the fifth is a five-for", (await recog(NAIDOO, coach)).some((x) => x.kind === "five_for" && x.value === 5));
    ok("...and noticed", (await notices(coach)).some((x) => /Five-for for S Naidoo/.test(x.title)));
    // Bekker: three in three legal balls with a wide in between, which is no ball at all.
    await feed(m, 1, [wicket(CELE, BEKKER), { t: "Wd", v: 0, s: CELE, b: BEKKER }, wicket(CELE, BEKKER), wicket(CELE, BEKKER)]);
    ok("three in three legal deliveries is a hat-trick, wide or no wide", (await recog(BEKKER, coach)).some((x) => x.kind === "hat_trick"));
    ok("...noticed once", (await notices(coach)).filter((x) => /Hat-trick for T Bekker/.test(x.title)).length === 1);
    await feed(m, 1, [wicket(CELE, BEKKER)]);
    ok("a fourth in a row is the same hat-trick", (await recog(BEKKER, coach)).filter((x) => x.kind === "hat_trick").length === 1);
    // Career: Whitfield is on 100; four hundred more, across a second match, passes five hundred.
    const m2 = await fixture("1XI", 0, "live", "Westville");
    await feed(m2, 0, fours(WHITFIELD, null, 99));
    ok("four hundred and ninety-six is not five hundred", !(await recog(WHITFIELD, coach)).some((x) => x.kind === "career_runs"));
    await feed(m2, 0, fours(WHITFIELD, null, 1));
    const cr = (await recog(WHITFIELD, coach)).find((x) => x.kind === "career_runs");
    ok("five hundred career runs, in the match that passed it", cr?.value === 500 && cr?.match_id === m2);
    ok("...and noticed", (await notices(coach)).some((x) => /passes 500 career runs/.test(x.title)));
    ok("a voided ball takes the milestone with it", await (async () => {
      const k = (await q(`select idempotency_key from ball_event where match_id = $1 order by seq desc limit 1`, [m2]))[0].idempotency_key;
      await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq, client_ts, kind, payload)
               values ($1, $2, $3, 0, 0, $4, 'walk', $5, $3, now(), 'void', jsonb_build_object('target', $6::text))`, [m2, HIL, ++seq, SCORER, `rc-${++key}`, k]);
      return !(await recog(WHITFIELD, coach)).some((x) => x.kind === "career_runs");
    })());
    // Two hundreds, a five-for, a hat-trick; the career mark went with the voided ball.
    // The four this walk produced — two hundreds, a five-for and a hat-trick —
    // present and in order, rather than "these are the only four in the side".
    //
    // It asserted a bare count, which held only while the pilot seed carried no
    // ball log at all. The moment one was added, a seeded fifty became a fifth
    // milestone and this went red with nothing wrong. A count over SHARED
    // fixture data tests the fixture, not the endpoint, and the name of this
    // assertion says ordering — so ordering is what it checks.
    //
    // Fifties are excluded rather than the walk's players named, because one of
    // its four belongs to a bowler outside that list. If the seed ever gains a
    // hundred this needs revisiting; that is a smaller trap than a bare count.
    const ms = await rows("/api/read/milestones?teamCode=1XI", coach);
    const mine = ms.filter((x) => x.kind !== "fifty");
    ok(`milestones by side, newest first (${mine.length} of this walk's, ${ms.length} in the side)`,
       mine.length === 4 &&
       ms.every((x, i, a) => i === 0 || new Date(a[i - 1].played_on) >= new Date(x.played_on)));
    ok("the 2XI coach reads none of them", (await rows("/api/read/milestones?teamCode=1XI", coach2)).length === 0);
    ok("a parent reads their child's, if any", (await rows("/api/read/milestones", parent)).every((x) => x.player_id === PILLAY));
    ok("the notices went to the side and nobody else", (await notices(coach2)).filter((x) => x.kind === "recognition").length === 0
       && (await notices(coach)).filter((x) => x.kind === "recognition").length >= before + 5);   // the notice of the career mark stays: it was true when it was sent
    ok("the milestone ledger is trigger-only", !(await q(`set local role scrbrd_app; delete from milestone_notice`).then(() => true).catch(() => false)));
  }

  group("Player of the Match, the coach's path (RECOGNITION R6, db/142)");
  {
    const WES = "22222222-2222-2222-2222-222222222222";
    const STARTS = "2026-10-03T10:00:00+02:00";
    const T0 = Date.parse("2026-10-03T08:00:00Z");
    const HXI = [WHITFIELD, BEKKER, NAIDOO, PILLAY].map((id, i) => ({ id, name: `Hilton ${i + 1}` }));
    const WXI = ["01", "02"].map((n) => ({ id: `bbbbbbbb-0000-0000-0000-0000000000${n}`, name: `Westville ${n}` }));
    const scorer = await login("scorer@example.invalid");
    const potm = (m, tok) => api(`/api/matches/${m}/player-of-match`, { token: tok });
    const give = (m, tok, playerId, headSeq) => api(`/api/matches/${m}/player-of-match`, { method: "POST", token: tok, body: { playerId, headSeq } });
    const take = (m, tok, body) => api(`/api/matches/${m}/player-of-match/withdraw`, { method: "POST", token: tok, body });
    const [{ id: M }] = await q(
      `insert into match (school_id, team_code, away_school_id, away_team_code, opponent, starts_at, sport, format, overs, status)
       values ($1, '1XI', $2, '1XI', 'Westville', $3, 'cricket', 'T20', 1, 'scheduled') returning id`, [HIL, WES, STARTS]);
    for (const p of HXI) await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'home')`, [M, p.id]);
    for (const p of WXI) await q(`insert into match_squad (match_id, player_id, side) values ($1, $2, 'away')`, [M, p.id]);
    // Scored on the real write path: Hilton 17 off the over, all Whitfield's
    // (17* off 6), Westville two dots and a wicket for Bekker: 1/0 off three
    // balls, all out. Both innings sealed.
    const claim = await api(`/api/matches/${M}/session/claim`, { method: "POST", token: scorer, body: { device: "device-recognition" } });
    let cs = 0, k = 0;
    const innings = [
      { bat: "1XI", bowl: "Westville 1XI", squad: HXI, bowlingSquad: WXI, balls: [6, 4, 6, 0, 0, 1].map((v) => ball({ type: BALL_TYPE.RUN, value: v })) },
      { bat: "Westville 1XI", bowl: "1XI", squad: WXI, bowlingSquad: [HXI[1], HXI[0]], target: 18,
        balls: [ball({ type: BALL_TYPE.RUN, value: 0 }), ball({ type: BALL_TYPE.RUN, value: 0 }), ball({ type: BALL_TYPE.WICKET, value: 0, dismissal: "bowled" })] },
    ];
    let refused = [];
    for (const [i, inn] of innings.entries()) {
      const evs = [inningsStart({ battingTeam: inn.bat, bowlingTeam: inn.bowl, squad: inn.squad, bowlingSquad: inn.bowlingSquad, overs: 1, target: inn.target ?? null }),
        batters({ striker: inn.squad[0].id, nonStriker: inn.squad[1].id }), bowler({ bowler: inn.bowlingSquad[0].id }), ...inn.balls]
        .map((e) => ({ ...e, innings: i }));
      evs.push({ ...sealInnings(deriveInnings(evs)), innings: i });
      const r = await api(`/api/matches/${M}/events`, { method: "POST", token: scorer, body: { events: evs.map((ev) => ({
        epoch: claim.body?.epoch, deviceId: "device-recognition", idempotencyKey: `potm-${M}-${++k}`, clientSeq: ++cs, clientTs: T0 + k * 20_000, innings: i, payload: ev })) } });
      refused = refused.concat(r.body?.refused ?? []);
    }
    if (!(claim.body?.ok === true && refused.length === 0)) console.log("   ", JSON.stringify(claim.body).slice(0, 200), JSON.stringify(refused).slice(0, 400));
    ok("the match is scored on the write path, both innings sealed", claim.body?.ok === true && refused.length === 0);

    // Not yet verified: the match is not finished.
    const early = await potm(M, coach);
    ok("before the match is finished the coach is told it waits", early.status === 200 && early.body?.sides?.length === 1
       && early.body.sides[0].side === "home" && early.body.sides[0].mayAward === false && early.body.sides[0].refusal === "not_verified"
       && /once the match is finished and the scorer has sealed every innings/.test(early.body.sides[0].refusalWords ?? ""), JSON.stringify(early.body));
    const head0 = early.body?.sides?.[0]?.headSeq;
    const e1 = await give(M, coach, BEKKER, head0);
    ok("...and an award is refused, not_verified", e1.status === 422 && e1.body?.error === "not_verified", JSON.stringify(e1.body));
    await q(`update match set status = 'complete' where id = $1`, [M]);
    ok("the database calls it verified", (await q(`select match_verified($1) v`, [M]))[0].v === true);

    // The coach of this side: the suggestions, from R1, with their figures.
    // A guardian link (pending: a parent is a parent before the office
    // verifies her) makes him Naidoo's guardian too.
    const coachId = await idOf("coach@example.invalid");
    const coachName = (await q(`select name from app_user where id = $1`, [coachId]))[0].name;
    const [{ id: gA }] = await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [coachId, HIL]);
    await q(`insert into assignment_subject (assignment_id, player_id, relationship) values ($1, $2, 'parent')`, [gA, NAIDOO]);
    const st = await potm(M, coach);
    const home = st.body?.sides?.[0];
    ok("the coach of the side may award it", st.status === 200 && st.body.sides.length === 1 && home?.mayAward === true && !home.standing, JSON.stringify(st.body));
    ok("...based on batting and bowling only", st.body?.basis === "Based on batting and bowling only.");
    ok("...two suggestions, the wicket (20) before the seventeen, figures in words",
       home?.suggestions?.length === 2 && home.suggestions[0].playerId === BEKKER && home.suggestions[0].figures === "1/0 (0.3)"
       && home.suggestions[1].playerId === WHITFIELD && home.suggestions[1].figures === "17* (6)", JSON.stringify(home?.suggestions));
    ok("...the sheet is his side's four, never the other side's", home?.sheet?.length === 4 && home.sheet.every((x) => HXI.some((p) => p.id === x.playerId)));
    ok("...and the boy he is guardian of cannot be chosen, with who decides instead",
       home?.sheet?.find((x) => x.playerId === NAIDOO)?.conflict === true
       && home.sheet.find((x) => x.playerId === NAIDOO).conflictWords === "You are his guardian, so the director of sport decides."
       && home.sheet.filter((x) => x.conflict).length === 1);
    ok("another side's coach of the same school gets no side", (await potm(M, coach2)).body?.sides?.length === 0);
    const wes = await potm(M, wesCoach);
    ok("the other school's coach gets his own side only", wes.body?.sides?.length === 1 && wes.body.sides[0].side === "away"
       && wes.body.sides[0].sheet.every((x) => WXI.some((p) => p.id === x.playerId)), JSON.stringify(wes.body));
    ok("a parent gets nothing", (await potm(M, parent)).body?.sides?.length === 0);

    const hs = home?.headSeq;
    ok("a 2XI coach is refused", (await give(M, coach2, BEKKER, hs)).status === 403);
    const other = await give(M, wesCoach, BEKKER, hs);
    ok("the other side's coach is refused for this side's boy", other.status === 403 && other.body?.error === "not_permitted", JSON.stringify(other.body));
    const off = await give(M, coach, DLAMINI, hs);
    ok("a boy not on the sheet is refused", off.status === 422 && off.body?.error === "not_on_sheet", JSON.stringify(off.body));
    const g = await give(M, coach, NAIDOO, hs);
    ok("the guardian is refused, and told who decides", g.status === 422 && g.body?.error === "guardian_conflict" && g.body?.detail === "directorofsport"
       && g.body?.message === "You are his guardian, so the director of sport decides.", JSON.stringify(g.body));
    const stale = await give(M, coach, BEKKER, hs - 1);
    ok("a decision on an older reading of the log is refused, stale", stale.status === 422 && stale.body?.error === "stale", JSON.stringify(stale.body));
    ok("the ordinary honours route does not make one", (await award(head, { playerId: BEKKER, kind: "player_of_match", season: "2026" })).status === 400);
    ok("...nor does the application's own INSERT (honour_match_award_door)",
       !(await q(`set local role scrbrd_app; select set_config('app.user_id', '${await idOf("sarah@example.invalid")}', true);
                 insert into honour (player_id, kind, season_id, match_id, derived_from) values ('${BEKKER}', 'player_of_match', season_named('2026'), '${M}', '{}')`)
          .then(() => true).catch(() => false)));
    const before = (await notices(coach)).length;

    const a1 = await give(M, coach, BEKKER, hs);
    ok("the coach awards it", a1.status === 200 && a1.body?.ok === true && !!a1.body.honourId, JSON.stringify(a1.body));
    const h = (await q(`select * from honour where id = $1`, [a1.body?.honourId]))[0];
    const hash = (await q(`select result_hash from match_result_compute($1)`, [M]))[0].result_hash;
    ok("...an honour of kind player_of_match, on the match's side", h?.kind === "player_of_match" && h.match_id === M && h.team_code === "1XI" && h.school_id === HIL);
    ok("...decided by the coach (D5), from the session", h?.decided_by === coachId && h.awarded_by === coachId);
    ok("...with its working: the suggestions, his figures, the head and the result's hash",
       h?.derived_from?.basis === "batting_bowling" && h.derived_from.suggestions?.length === 2
       && h.derived_from.suggestions[0].playerId === BEKKER && h.derived_from.awardee?.figures === "1/0 (0.3)"
       && h.derived_from.headSeq === hs && h.derived_from.resultHash === hash, JSON.stringify(h?.derived_from));
    ok("...named for the match", /^v Westville/.test(h?.name ?? "") && /3 Oct 2026$/.test(h.name), h?.name);
    ok("a second award for the side is refused", (await give(M, coach, WHITFIELD, hs)).body?.error === "already_awarded");
    ok("...by the director too", (await give(M, head, WHITFIELD, hs)).body?.error === "already_awarded");
    const said = await q(`select title, body, scope_level, team_code, school_id, recipient_id, subject_person_id, kind, required_capability
                            from notification where kind = 'recognition' and subject_kind = 'match' and subject_id = $1 order by published_at`, [M]);
    ok("the side is told, once, at team scope, no child alone",
       said.length === 1 && said[0].title === "Player of the Match · Sat 3 Oct v Westville Boys' High 1XI: T Bekker"
       && said[0].scope_level === "team" && said[0].team_code === "1XI" && said[0].school_id === HIL && said[0].recipient_id === null
       && said[0].required_capability === "news.read", JSON.stringify(said));
    ok("...the coach reads it", (await notices(coach)).length === before + 1);
    ok("...the 2XI coach does not", !(await notices(coach2)).some((x) => /^Player of the Match · /.test(x.title)));
    ok("his recognition carries it", (await recog(BEKKER, coach)).some((x) => x.family === "honour" && x.kind === "player_of_match"
       && /^Player of the Match — v Westville/.test(x.label)));
    const st2 = (await potm(M, coach)).body?.sides?.[0];
    ok("the sheet now shows the standing award, and no suggestions", st2?.standing?.playerId === BEKKER && st2.mayAward === false
       && st2.suggestions.length === 0 && st2.mayWithdraw === true, JSON.stringify(st2));
    const audit = await rows("/api/read/audit_log?kinds=recognition", head);
    ok("the audit log words it, and names the decider", audit.some((r) => r.kind === "recognition" && /^Awarded Player of the Match — v Westville/.test(r.action)
       && r.actor === coachName && r.subject === "T Bekker"), JSON.stringify(audit.slice(0, 2)));

    ok("the 2XI coach may not withdraw it", (await take(M, coach2, { honourId: h.id, kind: "correction", reason: "The scorecard was corrected" })).status === 403);
    ok("a withdrawal needs its kind", (await take(M, coach, { honourId: h.id, kind: "oops", reason: "The scorecard was corrected" })).body?.error === "kind_invalid");
    ok("...and a reason", (await take(M, coach, { honourId: h.id, kind: "correction", reason: "x" })).body?.error === "reason_required");
    const w1 = await take(M, coach, { honourId: h.id, kind: "correction", reason: "The scorecard was corrected" });
    ok("the coach withdraws it after a correction", w1.status === 200 && w1.body?.ok === true, JSON.stringify(w1.body));
    const after = await q(`select title, body, subject_person_id, retracted_at, retraction_kind, scope_level, recipient_id
                             from notification where kind = 'recognition' and subject_kind = 'match' and subject_id = $1 order by published_at`, [M]);
    ok("...the side's notice is taken back, and one more says why, naming nobody",
       after.length === 2 && after[0].retracted_at !== null && after[1].retracted_at === null && after[1].subject_person_id === null
       && after[1].recipient_id === null && after[1].scope_level === "team"
       && after[1].body === "Player of the Match · Sat 3 Oct v Westville Boys' High 1XI: the award was withdrawn after the scorecard was corrected."
       && !/Bekker/.test(after[1].title + after[1].body), JSON.stringify(after));
    ok("...kind correction on the row", (await q(`select withdrawn_kind from honour where id = $1`, [h.id]))[0].withdrawn_kind === "correction");
    const a2 = await give(M, head, WHITFIELD, hs);
    ok("the director of sport awards another boy, as a new honour", a2.status === 200 && a2.body?.honourId !== h.id, JSON.stringify(a2.body));
    const w2 = await withdraw(a2.body?.honourId, registrar, "Awarded in error at the office");
    ok("the office withdraws it through the ordinary route", w2.body?.withdrawn === 1);
    const last = await q(`select retracted_at from notification where kind = 'recognition' and subject_kind = 'match' and subject_id = $1 order by published_at`, [M]);
    ok("...for another reason: its notice taken back and nothing said", last.length === 3 && last[2].retracted_at !== null
       && (await q(`select withdrawn_kind from honour where id = $1`, [a2.body?.honourId]))[0].withdrawn_kind === "other");
    const audit2 = await rows("/api/read/audit_log?kinds=recognition", head);
    ok("the audit log words the withdrawal after a correction, and never the reason",
       audit2.some((r) => /^Withdrew Player of the Match — .* after a correction$/.test(r.action))
       && !JSON.stringify(audit2).includes("The scorecard was corrected") && !JSON.stringify(audit2).includes("Awarded in error"));
    const ca = await api("/api/read/audit_log?kinds=recognition", { token: coach });
    ok("a coach reads no audit log", (ca.body?.rows?.length ?? 0) === 0, JSON.stringify(ca.body).slice(0, 300));
  }

  ok("the server logged no errors", serverErr.join("").trim() === "");
  if (serverErr.length) console.log(serverErr.join("").slice(0, 600));
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e.message);
} finally {
  server.kill();
  await pool.end();
}
console.log(`\n${"─".repeat(52)}\nRECOGNITION SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
