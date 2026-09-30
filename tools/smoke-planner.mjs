#!/usr/bin/env node
/**
 * The fixture planner, phase 2, through the API and against Postgres
 * (SCRBRD-123, db/67; docs/design/SCRBRD-123_planner.md §5).
 *
 *   A. The ground owner's inputs: a pitch put on its field, windows on two
 *      grounds, one pitch closed and the field closed for a day — each by
 *      the ground's school and nobody else; a cycle refused
 *   B. Blackouts: the league's, and an entrant school's exam day for its own
 *      side only
 *   C. The inputs read: the manager only; the field, its pitches and their
 *      closures; an existing fixture with the end its format gives it
 *   D. A league of four, drawn and placed by the server: nothing on the
 *      closed pitch, nothing on a pitch the day its field is closed, no side
 *      on its blackout or twice in a day; a draft read by nobody but the
 *      league (an entrant school neither reads nor lists it)
 *   E. A lock: set on the draft, kept by regenerating; a stale lock named
 *   F. Publish: every placed fixture made through the fixture route, with
 *      its competition; the earlier draft superseded; publishing again makes
 *      nothing new; a superseded plan is not published
 *   G. The fixtures on the entrants' own lists, competition_id set; the
 *      published plan now read by an entrant school
 *   H. A refusal leaves nothing half-made: an entrant that left
 *      (invalid_fixture) and a booking typed over a slot (clash) — no match,
 *      no item; the retry after the booking goes makes the rest
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-planner.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8893);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const WM = "ffffffff-0000-0000-0000-000000000002";   // Westville Main (the seed's)
const OVAL = "ffffffff-0000-0000-0000-000000000001"; // Gordon Sherwood Oval (the seed's)

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d !== "" ? `— ${String(d).slice(0, 500)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development", ALLOW_DEV_LOGIN: "1",
         SESSION_SECRET: "smoke-planner-secret" },
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
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "planner-desk" } })).body?.token;
const show = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const league = await login("league@example.invalid");       // competitionadmin, no school: the manager
  const sarah = await login("sarah@example.invalid");          // director of sport, Hilton: facility.manage, fixture.update
  const wesAdmin = await login("registrar.wes@example.invalid"); // schooladmin, Westville
  const coach = await login("coach@example.invalid");          // Hilton 1XI coach: neither
  const wesCoach = await login("coach.wes@example.invalid");   // Westville 1XI coach
  ok("everyone signs in", !!league && !!sarah && !!wesAdmin && !!coach && !!wesCoach);

  const [{ today }] = await q(`select sa_today()::text as today`);
  const dayOf = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const at = (day, hhmm) => `${day}T${hhmm}:00+02:00`;
  const D = [8, 15, 22, 29].map(dayOf);
  const FROM = dayOf(7), TO = dayOf(30);

  // The league and its four sides, and three grounds at Hilton, as a seed would.
  const [{ id: COMP }] = await q(
    `insert into competition (school_id, name, comp_type, format, age_group, gender, level)
     values (null, 'Smoke Planner League', 'league', 'T20', 'open', 'boys', 'school') returning id`);
  const sides = [["Hilton 1st XI", HIL, "1XI"], ["Hilton 2nd XI", HIL, "2XI"], ["Westville 1st XI", WES, "1XI"], ["Westville 2nd XI", WES, "2XI"]];
  const E = {};
  for (const [name, school, team] of sides) {
    const [{ id }] = await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, $3, $4) returning id`,
                             [COMP, school, team, name]);
    E[name] = id;
  }
  const [{ id: FIELD }] = await q(`insert into ground (school_id, name) values ($1, 'Smoke Field') returning id`, [HIL]);
  const [{ id: PA }] = await q(`insert into ground (school_id, name) values ($1, 'Smoke Pitch A') returning id`, [HIL]);
  const [{ id: PB }] = await q(`insert into ground (school_id, name) values ($1, 'Smoke Pitch B') returning id`, [HIL]);

  // ── A ──────────────────────────────────────────────────────────
  group("A. The ground owner's inputs");
  ok("Hilton puts pitch A on its field", (await api(`/api/grounds/${PA}/parent`, { method: "POST", token: sarah, body: { parentId: FIELD } })).body?.parentId === FIELD);
  ok("...and pitch B", (await api(`/api/grounds/${PB}/parent`, { method: "POST", token: sarah, body: { parentId: FIELD } })).body?.parentId === FIELD);
  const cyc = await api(`/api/grounds/${FIELD}/parent`, { method: "POST", token: sarah, body: { parentId: PA } });
  ok("the field on its own pitch is refused (parent_invalid)", cyc.status === 422 && cyc.body?.error === "parent_invalid", show(cyc));
  const far = await api(`/api/grounds/${PA}/parent`, { method: "POST", token: sarah, body: { parentId: WM } });
  ok("a pitch on another school's ground: not permitted, or refused", far.status === 403 || far.body?.error === "parent_invalid", show(far));
  ok("the 1XI coach may not move a ground (403)", (await api(`/api/grounds/${PA}/parent`, { method: "POST", token: coach, body: { parentId: null } })).status === 403);
  const ends = await api(`/api/grounds/${PA}/ends`, { method: "POST", token: sarah, body: { endA: "Pavilion End", endB: "School End" } });
  ok("Hilton names pitch A's two ends", ends.status === 200 && ends.body?.endA === "Pavilion End" && ends.body?.endB === "School End", show(ends));
  ok("...one end alone is refused (ends_invalid)", (await api(`/api/grounds/${PA}/ends`, { method: "POST", token: sarah, body: { endA: "Pavilion End" } })).body?.error === "ends_invalid");
  ok("...the same name twice too", (await api(`/api/grounds/${PA}/ends`, { method: "POST", token: sarah, body: { endA: "Hill End", endB: "hill end" } })).body?.error === "ends_invalid");
  ok("...and the 1XI coach names none (403)", (await api(`/api/grounds/${PA}/ends`, { method: "POST", token: coach, body: { endA: "A End", endB: "B End" } })).status === 403);
  ok("the ground read carries them", (await api("/api/read/grounds", { token: coach })).body?.rows?.find((g) => g.id === PA)?.end_b_name === "School End");

  const win = (token, ground, day, competitionId = null) =>
    api(`/api/grounds/${ground}/windows`, { method: "POST", token, body: { startsAt: at(day, "09:00"), endsAt: at(day, "13:00"), competitionId } });
  let made = 0;
  for (const d of D) {
    if ((await win(sarah, PA, d, COMP)).status === 200) made++;
    if ((await win(sarah, PB, d)).status === 200) made++;
    if ((await win(wesAdmin, WM, d)).status === 200) made++;
  }
  ok("twelve windows: pitches A and B by Hilton, Westville Main by Westville", made === 12, made);
  ok("the league may not offer Hilton's pitch (not_permitted: no facility.manage)", (await win(league, PA, D[0])).status === 403);
  ok("nor Hilton Westville's ground", (await win(sarah, WM, D[0])).status === 403);
  ok("nor the 1XI coach his own school's", (await win(coach, PA, D[0])).status === 403);
  const bare = await api(`/api/grounds/${PA}/windows`, { method: "POST", token: sarah, body: { startsAt: `${D[0]}T09:00:00`, endsAt: `${D[0]}T13:00:00` } });
  ok("a window with no offset is refused (starts_at_invalid)", bare.status === 400 && bare.body?.error === "starts_at_invalid", show(bare));
  const back = await api(`/api/grounds/${PA}/windows`, { method: "POST", token: sarah, body: { startsAt: at(D[0], "13:00"), endsAt: at(D[0], "09:00") } });
  ok("one that ends first (window_invalid)", back.body?.error === "window_invalid", show(back));
  const wk = await api(`/api/grounds/${PA}/windows`, { method: "POST", token: sarah, body: { startsAt: at(D[0], "09:00"), endsAt: at(dayOf(20), "09:00") } });
  ok("one longer than a week (window_invalid, in the database's words)", wk.status === 422 && wk.body?.error === "window_invalid", show(wk));
  const spare = await win(sarah, PA, dayOf(9));
  ok("a spare window, removed by Hilton", spare.status === 200
     && (await api(`/api/ground-windows/${spare.body.id}/remove`, { method: "POST", token: coach })).status === 403
     && (await api(`/api/ground-windows/${spare.body.id}/remove`, { method: "POST", token: sarah })).body?.ok === true);
  ok("Hilton lists pitch A's windows: four", (await api(`/api/grounds/${PA}/windows?from=${FROM}&to=${TO}`, { token: sarah })).body?.windows?.length === 4);

  const closeB = await api(`/api/grounds/${PB}/closures`, { method: "POST", token: sarah,
    body: { from: at(FROM, "00:00"), to: at(TO, "23:00"), reason: "drainage works" } });
  ok("pitch B closed for the range", closeB.status === 200, show(closeB));
  const closeF = await api(`/api/grounds/${FIELD}/closures`, { method: "POST", token: sarah,
    body: { from: at(D[0], "00:00"), to: at(dayOf(9), "00:00"), reason: "square reseeded" } });
  ok("the field closed on the first Saturday", closeF.status === 200, show(closeF));
  ok("a closure with no reason is refused (reason_required)",
     (await api(`/api/grounds/${PA}/closures`, { method: "POST", token: sarah, body: { from: at(D[1], "00:00"), to: at(D[1], "12:00") } })).body?.error === "reason_required");
  ok("the league may not close Hilton's field (403)",
     (await api(`/api/grounds/${FIELD}/closures`, { method: "POST", token: league, body: { from: at(D[1], "00:00"), to: at(D[1], "12:00"), reason: "the league's say" } })).status === 403);

  // ── B ──────────────────────────────────────────────────────────
  group("B. Blackouts");
  const exam = await api(`/api/competitions/${COMP}/blackouts`, { method: "POST", token: wesAdmin,
    body: { day: D[1], entrantId: E["Westville 2nd XI"], reason: "Grade 11 examinations" } });
  ok("Westville marks its 2nd XI's exam day", exam.status === 200 && exam.body?.ok === true, show(exam));
  ok("...the same day again is the same row", (await api(`/api/competitions/${COMP}/blackouts`, { method: "POST", token: wesAdmin,
    body: { day: D[1], entrantId: E["Westville 2nd XI"] } })).body?.id === exam.body?.id);
  const notMine = await api(`/api/competitions/${COMP}/blackouts`, { method: "POST", token: sarah, body: { day: D[1], entrantId: E["Westville 1st XI"] } });
  ok("Hilton may not black out Westville's side (not_permitted)", notMine.status === 403, show(notMine));
  ok("nor the whole competition (the league's alone)", (await api(`/api/competitions/${COMP}/blackouts`, { method: "POST", token: sarah, body: { day: dayOf(10) } })).status === 403);
  const all = await api(`/api/competitions/${COMP}/blackouts`, { method: "POST", token: league, body: { day: dayOf(10), reason: "Heritage Day" } });
  ok("the league blacks out a day for everyone", all.status === 200, show(all));
  const temp = await api(`/api/competitions/${COMP}/blackouts`, { method: "POST", token: league, body: { day: dayOf(11) } });
  ok("...and takes one off again; Hilton may not", (await api(`/api/competition-blackouts/${temp.body?.id}/remove`, { method: "POST", token: sarah })).status === 403
     && (await api(`/api/competition-blackouts/${temp.body?.id}/remove`, { method: "POST", token: league })).body?.ok === true);
  const seen = await api(`/api/competitions/${COMP}/blackouts`, { token: coach });
  ok("Hilton's coach sees the league's day and not Westville's exams",
     seen.body?.blackouts?.length === 1 && seen.body.blackouts[0].entrantId === null, show(seen));
  ok("Westville's 1XI coach sees the same (the 2nd XI's exams are the 2nd XI's)",
     (await api(`/api/competitions/${COMP}/blackouts`, { token: wesCoach })).body?.blackouts?.length === 1);

  // An existing fixture: Hilton 1st XI's friendly on the third Saturday.
  const friendly = await api("/api/fixtures", { method: "POST", token: sarah,
    body: { schoolId: HIL, teamCode: "1XI", opponent: "Smoke Friendly XI", startsAt: at(D[2], "10:00"), groundId: OVAL } });
  ok("Hilton types a friendly for its 1st XI on the third Saturday", friendly.status === 200, show(friendly));

  // ── C ──────────────────────────────────────────────────────────
  group("C. The inputs, read from the database");
  const inp = await api(`/api/competitions/${COMP}/planner/inputs?from=${FROM}&to=${TO}`, { token: league });
  ok("the league reads them", inp.status === 200, show(inp));
  ok("...four entrants, twelve windows", inp.body?.entrants?.length === 4 && inp.body?.windows?.length === 12, JSON.stringify([inp.body?.entrants?.length, inp.body?.windows?.length]));
  const gOf = (id) => inp.body?.grounds?.find((g) => g.id === id);
  ok("...the field and both pitches, each pitch on the field", gOf(FIELD) && gOf(PA)?.parentId === FIELD && gOf(PB)?.parentId === FIELD);
  ok("...with their closures (the field's day, pitch B's range)", gOf(FIELD)?.closed?.length === 1 && gOf(PB)?.closed?.length === 1 && gOf(PA)?.closed?.length === 0);
  const fk = inp.body?.known?.find((k) => k.matchId === friendly.body?.id);
  ok("...the friendly as a known fixture of Hilton 1st XI, ending three hours on (a T20)",
     fk && fk.entrants?.includes(E["Hilton 1st XI"]) && Date.parse(fk.endsAt) - Date.parse(fk.startsAt) === 180 * 60_000 && !("opponent" in fk), JSON.stringify(fk));
  ok("...the blackouts, and the default match length from the league's T20", inp.body?.blackouts?.length === 2 && inp.body?.defaults?.durationMinutes === 180);
  ok("Hilton may not read them (403)", (await api(`/api/competitions/${COMP}/planner/inputs?from=${FROM}&to=${TO}`, { token: sarah })).status === 403);
  ok("a range backwards is refused (range_invalid)", (await api(`/api/competitions/${COMP}/planner/inputs?from=${TO}&to=${FROM}`, { token: league })).body?.error === "range_invalid");

  // ── D ──────────────────────────────────────────────────────────
  group("D. A league of four, drawn and placed on the server");
  const rules = { durationMinutes: 180, preparationMinutes: 30, recoveryMinutes: 15, restMinutes: 60, maxPerDay: 1 };
  const v1 = await api(`/api/competitions/${COMP}/plans`, { method: "POST", token: league,
    body: { format: "round_robin", from: FROM, to: TO, rules } });
  ok("the league drafts version 1", v1.status === 200 && v1.body?.version === 1 && v1.body?.state === "draft", show(v1));
  const P1 = v1.body;
  ok("...six fixtures, three rounds, every pair once", P1?.fixtures?.length === 6
     && new Set(P1.fixtures.map((f) => [f.home.entrantId, f.away.entrantId].sort().join())).size === 6);
  const dayOfFixture = (f) => f.startsAt ? new Date(Date.parse(f.startsAt) + 2 * 3600_000).toISOString().slice(0, 10) : null;
  /** The rules, held by an independent reading of the plan. */
  const holds = (P) => {
    // Placed in a window, or (after publishing) where its match is.
    const placed = P.fixtures.filter((f) => f.startsAt);
    const perDay = new Map();
    for (const f of placed) for (const s of [f.home.entrantId, f.away.entrantId]) {
      const k = `${s}|${dayOfFixture(f)}`; perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    return {
      onPitchB: placed.filter((f) => f.groundId === PB).length,
      onPitchAFieldClosed: placed.filter((f) => f.groundId === PA && dayOfFixture(f) === D[0]).length,
      wes2OnExam: placed.filter((f) => dayOfFixture(f) === D[1] && [f.home.entrantId, f.away.entrantId].includes(E["Westville 2nd XI"])).length,
      hil1OnFriendly: placed.filter((f) => dayOfFixture(f) === D[2] && [f.home.entrantId, f.away.entrantId].includes(E["Hilton 1st XI"])).length,
      twiceADay: [...perDay.values()].filter((n) => n > 1).length,
      windowTwice: placed.filter((f) => f.windowId).length - new Set(placed.filter((f) => f.windowId).map((f) => f.windowId)).size,
      groundTwice: placed.filter((f, i) => placed.some((o, j) => j < i && o.groundId === f.groundId && o.startsAt === f.startsAt)).length,
      placed: placed.length,
    };
  };
  const h1 = holds(P1);
  ok("nothing on the closed pitch B", h1.onPitchB === 0, JSON.stringify(h1));
  ok("nothing on pitch A the day its field is closed", h1.onPitchAFieldClosed === 0, JSON.stringify(h1));
  ok("Westville 2nd XI not on its exam day", h1.wes2OnExam === 0, JSON.stringify(h1));
  ok("Hilton 1st XI not on its friendly's day (one a day, the friendly counted)", h1.hil1OnFriendly === 0, JSON.stringify(h1));
  ok("no side twice in a day, no window twice", h1.twiceADay === 0 && h1.windowTwice === 0, JSON.stringify(h1));
  ok("every fixture placed, or unscheduled with its reasons in words",
     P1.fixtures.every((f) => f.windowId ? f.reasons.length === 0 : f.reasons.length > 0 && f.reasons.every((r) => r.code && r.text)),
     JSON.stringify(P1.fixtures.map((f) => [f.windowId, f.reasons])));
  ok("the summary counts them", P1.summary?.placed === h1.placed && P1.summary?.placed + P1.summary?.unscheduled === 6, JSON.stringify(P1.summary));
  ok("a placed fixture names its ground", P1.fixtures.filter((f) => f.windowId).every((f) => typeof f.groundName === "string"));
  console.log(`    (placed ${h1.placed} of 6)`);
  ok("Hilton, an entrant school, may not read the draft (403)", (await api(`/api/competitions/${COMP}/plans/${P1.id}`, { token: sarah })).status === 403);
  const lst = await api(`/api/competitions/${COMP}/plans`, { token: sarah });
  ok("...nor list it (none listed, canManage false)", lst.status === 200 && lst.body?.plans?.length === 0 && lst.body?.canManage === false, show(lst));
  ok("the league lists it", (await api(`/api/competitions/${COMP}/plans`, { token: league })).body?.plans?.[0]?.id === P1.id);
  ok("an unknown format is refused (format_invalid)",
     (await api(`/api/competitions/${COMP}/plans`, { method: "POST", token: league, body: { format: "swiss", from: FROM, to: TO } })).body?.error === "format_invalid");
  ok("a rule that is not a rule (rules_invalid)",
     (await api(`/api/competitions/${COMP}/plans`, { method: "POST", token: league, body: { format: "round_robin", from: FROM, to: TO, rules: { lunch: 40 } } })).body?.error === "rules_invalid");
  const badRule = await api(`/api/competitions/${COMP}/plans`, { method: "POST", token: league, body: { format: "round_robin", from: FROM, to: TO, rules: { durationMinutes: 5 } } });
  ok("a rule out of range, in the engine's words (plan_input_invalid)", badRule.status === 422 && badRule.body?.error === "plan_input_invalid" && /durationMinutes/.test(badRule.body?.detail), show(badRule));
  ok("Hilton may not draft (403)", (await api(`/api/competitions/${COMP}/plans`, { method: "POST", token: sarah, body: { format: "round_robin", from: FROM, to: TO } })).status === 403);

  // ── E ──────────────────────────────────────────────────────────
  group("E. A lock, kept by regenerating");
  const used = new Set(P1.fixtures.map((f) => f.windowId).filter(Boolean));
  const dayOfW = (w) => new Date(Date.parse(w.startsAt) + 2 * 3600_000).toISOString().slice(0, 10);
  // A window no fixture uses, off the closures, and a placed fixture whose
  // sides are free that day and not blacked out: a lock that should hold.
  let pick = null;
  for (const w of inp.body.windows) {
    if (used.has(w.id) || w.groundId === PB || (w.groundId === PA && dayOfW(w) === D[0])) continue;
    for (const f of P1.fixtures.filter((x) => x.windowId)) {
      const s = [f.home.entrantId, f.away.entrantId];
      const d = dayOfW(w);
      const busy = P1.fixtures.some((o) => o.id !== f.id && o.windowId && dayOfFixture(o) === d && [o.home.entrantId, o.away.entrantId].some((x) => s.includes(x)));
      if (busy || (d === D[1] && s.includes(E["Westville 2nd XI"])) || (d === D[2] && s.includes(E["Hilton 1st XI"]))) continue;
      pick = { fixtureId: f.id, windowId: w.id }; break;
    }
    if (pick) break;
  }
  ok("a free window a placed fixture could move to", !!pick, JSON.stringify([...used]));
  const locked = await api(`/api/competitions/${COMP}/plans/${P1.id}/locks`, { method: "POST", token: league, body: { locks: [pick] } });
  const lf = locked.body?.fixtures?.find((f) => f.id === pick?.fixtureId);
  ok("the league locks it there: the draft is recomputed in place", locked.status === 200 && locked.body?.version === 1 && lf?.windowId === pick?.windowId && lf?.locked === true, show(locked));
  ok("...and the rules still hold", Object.entries(holds(locked.body)).every(([k, v]) => k === "placed" || v === 0), JSON.stringify(holds(locked.body)));
  const v2 = await api(`/api/competitions/${COMP}/plans`, { method: "POST", token: league, body: { basedOn: P1.id } });
  const P2 = v2.body;
  const lf2 = P2?.fixtures?.find((f) => f.id === pick?.fixtureId);
  ok("regenerating from it is version 2, the lock kept", v2.status === 200 && P2.version === 2 && P2.basedOn === P1.id && lf2?.windowId === pick?.windowId && lf2?.locked, show(v2));
  const stale = await api(`/api/competitions/${COMP}/plans/${P2.id}/locks`, { method: "POST", token: league,
    body: { locks: [pick, { fixtureId: "rr:nobody:else:1", windowId: pick.windowId }] } });
  ok("a lock on no fixture is named stale, in words", stale.body?.staleLocks?.length === 1 && stale.body.staleLocks[0].reason === "no_such_fixture" && !!stale.body.staleLocks[0].text, show(stale));
  ok("...and cleared again", (await api(`/api/competitions/${COMP}/plans/${P2.id}/locks`, { method: "POST", token: league, body: { locks: [pick] } })).body?.staleLocks?.length === 0);
  ok("a lock set twice on one fixture is refused (locks_invalid)",
     (await api(`/api/competitions/${COMP}/plans/${P2.id}/locks`, { method: "POST", token: league, body: { locks: [pick, pick] } })).body?.error === "locks_invalid");
  ok("Hilton may not set a lock (403)", (await api(`/api/competitions/${COMP}/plans/${P2.id}/locks`, { method: "POST", token: sarah, body: { locks: [] } })).status === 403);

  // ── F ──────────────────────────────────────────────────────────
  group("F. Publishing, through the fixture route");
  const count = async () => Number((await q(`select count(*) from match where competition_id = $1`, [COMP]))[0].count);
  ok("no fixture exists before publishing", (await count()) === 0);
  ok("Hilton may not publish (403)", (await api(`/api/competitions/${COMP}/plans/${P2.id}/publish`, { method: "POST", token: sarah })).status === 403);
  const pub = await api(`/api/competitions/${COMP}/plans/${P2.id}/publish`, { method: "POST", token: league });
  const placed2 = P2.fixtures.filter((f) => f.windowId).length;
  ok("the league publishes version 2: every placed fixture created", pub.status === 200 && pub.body?.first === true && pub.body?.counts?.created === placed2, show(pub));
  ok("...each result names its sides and its match", pub.body?.results?.filter((r) => r.outcome === "created").every((r) => r.matchId && r.home && r.away && r.sharedWithOpponent === true));
  ok(`...${placed2} matches, each in the league`, (await count()) === placed2);
  const rows = await q(`select m.id, m.school_id, m.team_code, m.away_school_id, m.away_team_code, m.ground_id, m.starts_at, m.format, m.overs, m.competition_id
                          from match m where m.competition_id = $1`, [COMP]);
  const byMatch = new Map(pub.body.results.filter((r) => r.matchId).map((r) => [r.matchId, P2.fixtures.find((f) => f.id === r.fixtureId)]));
  ok("...each on its planned ground, at its planned start, a T20 of twenty overs",
     rows.every((m) => { const f = byMatch.get(m.id); return f && m.ground_id === f.groundId && m.starts_at.toISOString() === f.startsAt && m.format === "T20" && m.overs === 20; }),
     JSON.stringify(rows.slice(0, 2)));
  const items = await q(`select count(*)::int as n from fixture_plan_item where competition_id = $1 and plan_id = $2`, [COMP, P2.id]);
  ok("...and each remembered (fixture_plan_item)", items[0].n === placed2);
  const states = await q(`select version, state from fixture_plan where competition_id = $1 order by version`, [COMP]);
  ok("version 1 superseded, version 2 published", states.map((s) => s.state).join() === "superseded,published", JSON.stringify(states));
  const again = await api(`/api/competitions/${COMP}/plans/${P2.id}/publish`, { method: "POST", token: league });
  ok("publishing again: every one already made, none created", again.status === 200 && again.body?.first === false
     && again.body?.counts?.already === placed2 && again.body?.counts?.created === 0, show(again));
  ok("...no second match", (await count()) === placed2);
  const old = await api(`/api/competitions/${COMP}/plans/${P1.id}/publish`, { method: "POST", token: league });
  ok("the superseded version is not published (superseded)", old.status === 422 && old.body?.error === "superseded", show(old));
  ok("a published plan takes no locks (not_a_draft)",
     (await api(`/api/competitions/${COMP}/plans/${P2.id}/locks`, { method: "POST", token: league, body: { locks: [] } })).body?.error === "not_a_draft");
  const v3 = await api(`/api/competitions/${COMP}/plans`, { method: "POST", token: league, body: { basedOn: P2.id } });
  ok("a version drawn after publishing keeps each made fixture where its match is",
     v3.status === 200 && v3.body.fixtures.filter((f) => f.made).length === placed2
     && v3.body.fixtures.filter((f) => f.made).every((f) => Date.parse(f.startsAt) === Date.parse(f.made.startsAt) && f.groundId === f.made.groundId),
     JSON.stringify(v3.body?.fixtures?.map((f) => [f.startsAt, f.groundId, f.made])));
  ok("...and the fixtures it had not made are placed around them, the rules held",
     Object.entries(holds(v3.body)).every(([k, v]) => k === "placed" || v === 0), JSON.stringify(holds(v3.body)));

  // ── G ──────────────────────────────────────────────────────────
  group("G. On the entrants' own fixture lists");
  const list = async (token) => (await api("/api/read/matches", { token })).body?.rows ?? [];
  const hilSides = rows.filter((m) => m.school_id === HIL || m.away_school_id === HIL).map((m) => m.id);
  const mine = (await list(sarah)).filter((m) => m.competition_id === COMP);
  ok("Hilton's director of sport sees every Hilton fixture of the league, competition_id set",
     hilSides.length > 0 && hilSides.every((id) => mine.some((m) => m.id === id)), JSON.stringify([hilSides.length, mine.length]));
  const wes1 = rows.filter((m) => (m.school_id === WES && m.team_code === "1XI") || (m.away_school_id === WES && m.away_team_code === "1XI")).map((m) => m.id);
  const wesList = (await list(wesCoach)).filter((m) => m.competition_id === COMP);
  ok("Westville's 1XI coach sees his side's, and not the 2nd XI's",
     wes1.every((id) => wesList.some((m) => m.id === id)) && wesList.every((m) => wes1.includes(m.id)), JSON.stringify([wes1.length, wesList.length]));
  const seenPub = await api(`/api/competitions/${COMP}/plans/${P2.id}`, { token: sarah });
  ok("the published plan is now read by an entrant school", seenPub.status === 200 && seenPub.body?.state === "published" && seenPub.body?.canManage === false, show(seenPub));
  ok("...with the inputs as counts, never the bookings", typeof seenPub.body?.inputs?.known === "number"
     && typeof (await api(`/api/competitions/${COMP}/plans/${P2.id}?inputs=1`, { token: sarah })).body?.inputs?.known === "number");
  ok("...but not the superseded draft that was never published (403)", (await api(`/api/competitions/${COMP}/plans/${P1.id}`, { token: sarah })).status === 403);
  ok("the league sees the plan's inputs in full", Array.isArray((await api(`/api/competitions/${COMP}/plans/${P2.id}?inputs=1`, { token: league })).body?.inputs?.known));

  // ── H ──────────────────────────────────────────────────────────
  group("H. A refusal leaves nothing half-made");
  const [{ id: CUP }] = await q(
    `insert into competition (school_id, name, comp_type, format, age_group, gender, level)
     values (null, 'Smoke Planner Cup', 'league', 'T20', 'U15', 'boys', 'school') returning id`);
  const cup = {};
  for (const [name, school, team] of [["Hilton U15A", HIL, "U15A"], ["Westville U15A", WES, "U15A"], ["Hilton U14A", HIL, "U14A"]]) {
    cup[name] = (await q(`insert into competition_entrant (competition_id, school_id, team_code, display_name) values ($1, $2, $3, $4) returning id`,
                         [CUP, school, team, name]))[0].id;
  }
  // Three days: each side plays twice, one a day.
  const D5 = dayOf(36), D6 = dayOf(38);
  for (const day of [D5, dayOf(37), D6]) {
    for (const [g, hh] of [[PA, "09:00"], [WM, "09:00"], [OVAL, "09:00"]]) {
      const token = g === WM ? wesAdmin : sarah;
      await api(`/api/grounds/${g}/windows`, { method: "POST", token, body: { startsAt: at(day, hh), endsAt: at(day, "13:00"), competitionId: CUP } });
    }
  }
  const c1 = await api(`/api/competitions/${CUP}/plans`, { method: "POST", token: league,
    body: { format: "round_robin", from: D5, to: D6, rules: { durationMinutes: 180, preparationMinutes: 30 } } });
  ok("a cup of three, drafted: three fixtures placed", c1.status === 200 && c1.body?.summary?.placed === 3, show(c1));
  const U14 = cup["Hilton U14A"];
  const clean = c1.body?.fixtures?.find((f) => f.home.entrantId !== U14 && f.away.entrantId !== U14);
  // Hilton U14A leaves the cup; a booking is typed over the clean fixture's slot.
  await q(`delete from competition_entrant where id = $1`, [U14]);
  const [{ id: BOOKING }] = await q(
    `insert into match (school_id, team_code, opponent, ground_id, starts_at, sport, format, overs, status)
     values ($1, '3XI', 'Smoke Booking', $2, $3, 'cricket', 'T20', 20, 'scheduled') returning id`,
    [clean.groundId === WM ? WES : HIL, clean.groundId, clean.startsAt]);
  const cp = await api(`/api/competitions/${CUP}/plans/${c1.body.id}/publish`, { method: "POST", token: league });
  const res = (f) => cp.body?.results?.find((r) => r.fixtureId === f.id);
  const u14fx = c1.body.fixtures.filter((f) => f !== clean);
  ok("the side that left: refused in the fixture route's words (invalid_fixture)",
     u14fx.every((f) => res(f)?.outcome === "refused" && res(f)?.error === "invalid_fixture" && /entered/.test(res(f)?.detail ?? "")), show(cp));
  ok("the slot booked since: refused as a clash, with the reason (ground_taken)",
     res(clean)?.outcome === "refused" && res(clean)?.error === "clash" && res(clean)?.reasons?.some((r) => r.code === "ground_taken"), JSON.stringify(res(clean)));
  const cupMatches = await q(`select count(*)::int as n from match where competition_id = $1`, [CUP]);
  const cupItems = await q(`select count(*)::int as n from fixture_plan_item where competition_id = $1`, [CUP]);
  ok("...no match made and no item recorded for any of them", cupMatches[0].n === 0 && cupItems[0].n === 0, JSON.stringify([cupMatches, cupItems]));
  await q(`delete from match where id = $1`, [BOOKING]);
  const retry = await api(`/api/competitions/${CUP}/plans/${c1.body.id}/publish`, { method: "POST", token: league });
  ok("the booking gone, the retry makes the clean fixture and still refuses the others",
     res(clean) && retry.body?.counts?.created === 1 && retry.body?.counts?.refused === 2
     && (await q(`select count(*)::int as n from match where competition_id = $1`, [CUP]))[0].n === 1, show(retry));
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e?.stack ?? e);
} finally {
  server.kill();
  await pool.end();
  if (fail && serverErr.length) console.log("\nserver stderr:\n" + serverErr.join("").slice(-3000));
  console.log("\n" + "─".repeat(52));
  console.log(`PLANNER SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
