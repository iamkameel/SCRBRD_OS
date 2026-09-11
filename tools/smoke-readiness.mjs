#!/usr/bin/env node
/**
 * The intersection three people own, which a coach has been doing in his head.
 *
 * A boy plays on Saturday if the family says he is coming, the physio says he
 * is cleared, and the coach picks him. Each of those was already recorded, on
 * three tables owned by three different people, and NOTHING JOINED THEM — so
 * the check that a named XI is a fit and willing XI happened on a Friday
 * afternoon by flicking between two screens.
 *
 *   1. WORST WINS. The least favourable thing anybody has said is the state,
 *      and a declaration of "available" does not overrule the physio.
 *   2. BOTH COMPONENTS STAY VISIBLE. Not a score. A clinical restriction is
 *      the physio's to lift and a family's answer is not the coach's to
 *      appeal, so the read has to say WHICH one said no.
 *   3. SILENCE IS NOT READY. No declaration is "unanswered", never available.
 *   4. player.fitness IS NOT AN INPUT. It is written by no route in this
 *      product and already disagrees with the injury records; changing it must
 *      change nothing here.
 *   5. A CONFLICT IS THE POINT. Somebody picked who should not be is the row a
 *      selector needs first.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-readiness.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8841;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-readiness-secret" },
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
  method: "POST", body: { email, deviceId: "device-readiness" } })).body?.token;

const declare = (matchId, token, body) =>
  api(`/api/matches/${matchId}/availability`, { method: "POST", token, body });
const suppress = (key, token, body) =>
  api(`/api/admin/modules/${key}/suppress`, { method: "POST", token, body });
const sheet = async (matchId, token) =>
  (await api(`/api/read/readiness?matchId=${matchId}`, { token })).body?.rows ?? [];
const rowFor = (rows, id) => rows.find((r) => r.player_id === id);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach     = await login("coach@example.invalid");    // 1XI
  const coach2    = await login("coach2@example.invalid");   // 2XI
  const head      = await login("sarah@example.invalid");    // director of sport
  const watcher   = await login("watcher@example.invalid");  // spectator
  const registrar = await login("registrar@example.invalid");// school.feature.manage at HIL

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Kearsney', now() + interval '4 days','T20',20,'scheduled') returning id`,
    [HIL]))[0].id;

  // TWO boys, not three, and the constraint is deliberate rather than
  // convenient: a squad row is refused for a minor without a verified guardian
  // link and consent, so the only Hilton 1XI players who can actually be
  // SELECTED and who start with a clean clinical record are these. The first
  // version of this walk took the first three alphabetically, one of whom is
  // pending_consent, and the registration trigger was right to refuse him.
  const clean = await q(
    `select p.id, p.full_name from player p
       join player_guardian_status g on g.player_id = p.id
      where p.school_id = $1 and p.team_code = '1XI'
        and g.registration_state = 'active'
        and not exists (select 1 from injury i where i.player_id = p.id)
      order by p.full_name`, [HIL]);
  ok("there are two selectable boys with a clean clinical record", clean.length === 2);
  const [hurt, unwilling] = clean;
  // The seeded restricted boy, whose record this walk does not touch.
  const seeded = (await q(
    `select p.id from player p
      join injury i on i.player_id = p.id and i.restricted
     where p.school_id = $1 and p.team_code = '1XI' limit 1`, [HIL]))[0];
  ok("and a seeded restricted boy to leave alone", !!seeded);

  group("Silence is not ready");
  {
    const s = await sheet(m, coach);
    ok("the whole side is on the sheet", s.length > 0);
    ok("...nobody is available before anybody answers",
       !s.some((r) => r.state === "available"));
    // The absence of a row is a state with a name, because "has not answered"
    // is the thing a team manager chases.
    ok("...both our boys read as unanswered",
       rowFor(s, hurt.id)?.state === "unanswered"
       && rowFor(s, unwilling.id)?.state === "unanswered");
    ok("...with no declaration invented for them",
       rowFor(s, hurt.id)?.declared_status === null);
    // FALSE, not null. A boy with no injury history has been asked and is
    // clear; a school with Injuries switched off has not been asked at all.
    // Left-joined raw, those two were the same value.
    ok("...and a clean clinical record reads as clear, not as unknown",
       rowFor(s, hurt.id)?.clinically_restricted === false);
  }

  group("A side named before anybody answers");
  {
    // The real Tuesday: a coach names an XI and the families reply on
    // Thursday. Both boys are picked while nobody has said anything.
    await pick(m, hurt.id, 1);
    await pick(m, unwilling.id, 2);
    const s = await sheet(m, coach);
    ok("both are in the side",
       rowFor(s, hurt.id)?.selected === true && rowFor(s, unwilling.id)?.selected === true);
    ok("...and each is flagged as picked without an answer",
       rowFor(s, hurt.id)?.conflict === "selected_without_answer"
       && rowFor(s, unwilling.id)?.conflict === "selected_without_answer");
    ok("conflicts sort to the top", s.findIndex((r) => r.conflict !== null) === 0);
    ok("an unpicked boy is no conflict, whatever he has said",
       s.filter((r) => !r.selected).every((r) => r.conflict === null));
    ok("...and the selection comes with the order it was given",
       rowFor(s, hurt.id)?.batting_no === 1 && rowFor(s, hurt.id)?.selected_side === "home");
  }

  group("Worst wins, and the read says which half said no");
  {
    await declare(m, coach, { playerId: hurt.id, status: "available" });
    {
      const r = rowFor(await sheet(m, coach), hurt.id);
      ok("a boy who is willing and fit is available", r?.state === "available");
      ok("...and picking him is no longer a conflict", r?.conflict === null);
    }

    await declare(m, coach, { playerId: unwilling.id, status: "unavailable", reasonKind: "family" });
    {
      const r = rowFor(await sheet(m, coach), unwilling.id);
      ok("an unavailable boy is unavailable, not restricted", r?.state === "unavailable");
      ok("...on family grounds", r?.reason_kind === "family");
      ok("...with nothing clinical asserted about him", r?.clinically_restricted === false);
      ok("...and the side still has him in it, which is the problem",
         r?.conflict === "selected_while_unavailable");
    }

    // THE ASSERTION THIS WHOLE READ EXISTS FOR. The family says yes; the
    // physio says no; the answer is no, and it is legible WHICH one said it.
    await q(`insert into injury (player_id, school_id, injury_type, severity,
                                 date_injured, rtw_date, restricted, phase)
             values ($1,$2,'Grade 2 hamstring strain','moderate',
                     current_date, current_date + 14, true, 'rehab')`, [hurt.id, HIL]);
    const r = rowFor(await sheet(m, coach), hurt.id);
    ok("a declaration of available does not overrule the physio", r?.state === "restricted");
    ok("...the family's answer is still on the row", r?.declared_status === "available");
    ok("...and so is the clinical one", r?.clinically_restricted === true);
    ok("...and when he is expected back", !!r?.rtw_date);
    ok("...so a selector can see which of them to ring",
       r?.declared_status === "available" && r?.clinically_restricted === true);
    // Two flags rather than one number, because they need two different phone
    // calls: the physio lifts a restriction, the family is not appealed to.
    ok("a restricted pick and an unwilling pick are flagged differently",
       r?.conflict === "selected_while_restricted"
       && rowFor(await sheet(m, coach), unwilling.id)?.conflict === "selected_while_unavailable");
  }

  group("The diagnosis stays behind its tier");
  {
    // The state must not depend on `phase`, which is masked behind
    // medical.nature.read — a state that changed according to who was asking
    // would be worse than no state at all.
    const cols = Object.keys(rowFor(await sheet(m, coach), hurt.id) ?? {});
    ok("readiness returns no injury_type", !cols.includes("injury_type"));
    ok("...no severity", !cols.includes("severity"));
    ok("...and no phase", !cols.includes("phase"));
    ok("only the restriction and the return date", cols.includes("clinically_restricted")
       && cols.includes("rtw_date"));
  }

  group("player.fitness is not an input");
  {
    // A column written by no route in this product, which already disagrees
    // with the injury records it claims to summarise. If readiness read it,
    // a fourth unmaintained opinion would be deciding who plays.
    const before = rowFor(await sheet(m, coach), unwilling.id)?.state;
    await q(`update player set fitness = 'injured' where id = $1`, [unwilling.id]);
    ok("marking a boy injured on player.fitness changes nothing here",
       rowFor(await sheet(m, coach), unwilling.id)?.state === before);
    await q(`update player set fitness = 'fit' where id = $1`, [hurt.id]);
    ok("...and marking a restricted boy fit does not clear him",
       rowFor(await sheet(m, coach), hurt.id)?.state === "restricted");
  }

  group("A withdrawn selection is not a selection");
  {
    await q(`update match_squad set withdrawn = true
              where match_id = $1 and player_id = $2`, [m, hurt.id]);
    const r = rowFor(await sheet(m, coach), hurt.id);
    ok("withdrawing him unpicks him here too", r?.selected === false);
    ok("...and the conflict goes with it", r?.conflict === null);
    ok("...while the restriction stands, because that is not the coach's to lift",
       r?.state === "restricted");
    await pick(m, hurt.id, 1);
    ok("re-selecting him brings the conflict back",
       rowFor(await sheet(m, coach), hurt.id)?.conflict === "selected_while_restricted");
  }

  group("The clinical half belongs to the Injuries module");
  {
    ok("the school can switch Injuries off",
       (await suppress("injuries", registrar, { schoolId: HIL, hidden: true })).status === 200);
    const s = await sheet(m, coach);
    // The read is nobody's module — chasing a side is not an Injuries feature
    // — so it keeps answering. Its clinical half does belong to Injuries and
    // goes dark from the inside, exactly as the dashboard's figure does.
    ok("readiness still answers", s.length > 0);
    ok("...but the clinical column is absent, not false",
       rowFor(s, hurt.id)?.clinically_restricted === null);
    ok("...and the return date goes with it", rowFor(s, hurt.id)?.rtw_date === null);
    ok("...so the state falls back to what the family said",
       rowFor(s, hurt.id)?.state === "available");
    ok("...while the family's half is untouched",
       rowFor(s, unwilling.id)?.state === "unavailable");
    // A school choosing not to run the module is not a bypass: nothing about
    // the record changed, and the physio's own screen still holds it.
    ok("no injury row changed",
       (await q(`select count(*)::int c from injury where player_id=$1 and restricted`,
                [hurt.id]))[0].c === 1);
    ok("the school can switch it back on",
       (await suppress("injuries", registrar, { schoolId: HIL, hidden: false })).status === 200);
    ok("...and the clinical half comes back",
       rowFor(await sheet(m, coach), hurt.id)?.state === "restricted");
  }

  group("Only the people picking the side may read it");
  {
    ok("a spectator reads nothing", (await sheet(m, watcher)).length === 0);
    ok("a coach of another side reads nothing of this one", (await sheet(m, coach2)).length === 0);
    ok("the director of sport reads the school's", (await sheet(m, head)).length > 0);
    ok("...and the seeded boy's restriction is not this walk's doing",
       (await q(`select count(*)::int c from injury where player_id=$1`, [seeded.id]))[0].c >= 1);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`READINESS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

/** Name a boy in the side, or put him back after a withdrawal. */
async function pick(matchId, playerId, battingNo) {
  await q(`insert into match_squad (match_id, player_id, side, batting_no)
           values ($1,$2,'home',$3)
           on conflict (match_id, player_id) do update set withdrawn = false`,
          [matchId, playerId, battingNo]);
}
