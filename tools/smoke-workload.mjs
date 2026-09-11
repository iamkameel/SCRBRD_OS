#!/usr/bin/env node
/**
 * How much has this boy bowled, and should somebody have taken him off?
 *
 * Junior directives limit a pace bowler's overs per spell and per day by
 * age. The log records what happened — nothing here refuses a ball — and
 * from it the platform derives overs, spells and days, writes a breach down
 * the moment it appears, and tells the coach. This walk proves:
 *
 *   1. OVERS AND SPELLS ARE DERIVED FROM THE LOG, correctly: a wide does not
 *      advance the over; alternate overs are one spell; a missed turn ends it.
 *   2. A SPELL OVER THE DIRECTIVE IS A BREACH, once, with a notice to the
 *      people responsible for him and nobody else.
 *   3. A DAY OVER THE DIRECTIVE IS A BREACH across matches and innings.
 *   4. A SPINNER AND AN ADULT ARE NOT UNDER THE DIRECTIVE.
 *   5. THE WORKLOAD READ says one word per boy, and only to those who may
 *      read his development record.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-workload.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8867;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const SCORER = "88888888-0000-0000-0000-000000000006";
const PACE = "aaaaaaaa-0000-0000-0000-0000000000a1";   // U13 pace, seeded below
const SPIN = "aaaaaaaa-0000-0000-0000-0000000000a2";   // U13 leg spin
const BAT  = "aaaaaaaa-0000-0000-0000-0000000000a3";   // a batter to face them
const U19   = "aaaaaaaa-0000-0000-0000-000000000003";  // S Naidoo, 1XI, born 2008: U19 this season
const ADULT = "aaaaaaaa-0000-0000-0000-0000000000a4";  // a nineteen-year-old, seeded below

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-workload-secret" },
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
  method: "POST", body: { email, deviceId: "device-workload" } })).body?.token;
const rows = async (path, tok) => (await api(path, { token: tok })).body?.rows ?? [];
const spells = (m, tok) => rows(`/api/read/bowling_spells?matchId=${m}`, tok);
const workload = (tok, team) => rows(`/api/read/workload${team ? `?teamCode=${team}` : ""}`, tok);
const notices = (tok) => rows(`/api/read/notifications`, tok);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

// Feed the log directly, as the owner: the scoring walks prove the route;
// this one is about what the log MEANS. `overs` is a list of [bowlerId,
// balls] per over in order; a ball is "run" (legal) or "Wd" (not).
let seq = 0, key = 0;
async function feed(matchId, innings, overs) {
  for (const [bowler, balls] of overs) {
    for (const t of balls) {
      await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                                       idempotency_key, client_seq, client_ts, kind, ball_type, value, bowler_id, striker_id)
               values ($1, $2, $3, 0, $4, $5, 'walk', $6, $3, now(), 'ball', $7, 0, $8, $9)`,
              [matchId, HIL, ++seq, innings, SCORER, `wl-${++key}`, t, bowler, BAT]);
    }
  }
}
const six = (b) => [b, ["run", "run", "run", "run", "run", "run"]];
const fixture = async (team, daysAgo, opponent = "Kearsney") => (await q(
  `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
   values ($1, $2, $3, now() - ($4 || ' days')::interval, 'cricket', 'T20', 20, 'complete') returning id`,
  [HIL, team, opponent, String(daysAgo)]))[0].id;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Two thirteen-year-olds and a batter, on the U14A side its coach holds.
  await q(`insert into player (id, school_id, team_code, full_name, squad_no, playing_role, born, bowling_style) values
            ($1, $4, 'U14A', 'L Zondi', 21, 'bowler', '2014-01-15', 'right-arm fast'),
            ($2, $4, 'U14A', 'A Govender', 22, 'bowler', '2014-03-02', 'leg spin'),
            ($3, $4, 'U14A', 'N Mthembu', 23, 'batter', '2013-11-30', null),
            ($5, $4, '1XI', 'J Steyn', 24, 'bowler', '2006-05-01', 'right-arm fast')`, [PACE, SPIN, BAT, HIL, ADULT]);

  const u14   = await login("u14coach@example.invalid");   // coach, U14A
  const coach = await login("coach@example.invalid");      // coach, 1XI
  const head  = await login("sarah@example.invalid");      // director of sport
  const parent = await login("parent@example.invalid");
  const watcher = await login("watcher@example.invalid");
  const medic = await login("medical@example.invalid");

  group("Overs and spells are derived from the log");
  {
    ok("a boy born in January 2014 is U13 this season", (await q(`select age_band('2014-01-15') b`))[0].b === "U13");
    ok("...one born in late 2008 is U19, not open", (await q(`select age_band('2008-11-21') b`))[0].b === "U19");
    ok("...and one born in 2006 is open", (await q(`select age_band('2006-05-01') b`))[0].b === "open");
    // Born 15 August 2013: twelve on 1 September 2025, thirteen on 1 September
    // 2026. U13 all of last season, U15 from the day this one turned over.
    ok("the band is fixed for the season and turns over on 1 September",
       (await q(`select age_band('2013-08-15', '2026-08-31') a, age_band('2013-08-15', '2026-09-01') b`)).map((r) => `${r.a}/${r.b}`)[0] === "U13/U15");
    ok("a boy with no date of birth is unknown, not open", (await q(`select age_band(null) b`))[0].b === "unknown");
    const dir = await rows("/api/read/bowling_directives", watcher);
    ok("anyone signed in reads the directive", dir.find((d) => d.age_band === "U13")?.max_overs_per_spell === 5
       && dir.find((d) => d.age_band === "open")?.max_overs_per_spell === null);

    // Forty days back: out of every window the workload read counts, so the
    // shape of these spells is all this match contributes.
    const m = await fixture("U14A", 40);
    // Pace bowls overs 0,2,4 (a three-over spell with a wide in it), spin bowls
    // the odd overs, then pace misses two turns and comes back for 8: a new spell.
    await feed(m, 0, [
      [PACE, ["run", "Wd", "run", "run", "run", "run", "run"]], six(SPIN),
      six(PACE), six(SPIN), six(PACE), six(SPIN), six(SPIN), six(SPIN), six(PACE),
    ]);
    const s = await spells(m, u14);
    const pace = s.filter((r) => r.bowler_id === PACE);
    ok("the coach reads the match's spells", s.length > 0);
    ok("a wide does not advance the over", (await q(`select count(*)::int c from bowler_over where match_id = $1`, [m]))[0].c === 9);
    ok("alternate overs are one spell", pace[0]?.overs === 3 && pace[0]?.first_over === 0 && pace[0]?.last_over === 4);
    ok("...a missed turn ends it", pace.length === 2 && pace[1]?.first_over === 8 && pace[1]?.overs === 1);
    ok("...and the directive rides beside each", pace.every((r) => r.age_band === "U13" && r.max_overs_per_spell === 5 && r.pace === true));
    ok("the spinner is not under it", s.find((r) => r.bowler_id === SPIN)?.max_overs_per_spell === null && s.find((r) => r.bowler_id === SPIN)?.pace === false);
    ok("nothing here breached", !s.some((r) => r.over_spell_limit) && (await q(`select count(*)::int c from bowling_breach`))[0].c === 0);
    ok("a coach of another side reads no spells of this match", (await spells(m, coach)).length === 0);
  }

  group("A spell over the directive is a breach, once, and the coach is told");
  {
    const before = (await notices(u14)).length;
    const m = await fixture("U14A", 0, "Michaelhouse");
    // Six overs on the trot from one end: the sixth is the breach.
    await feed(m, 0, [six(PACE), six(SPIN), six(PACE), six(SPIN), six(PACE), six(SPIN), six(PACE), six(SPIN), six(PACE), six(SPIN)]);
    ok("five overs is within the directive", (await q(`select count(*)::int c from bowling_breach where match_id = $1`, [m]))[0].c === 0);
    await feed(m, 0, [six(PACE)]);
    const br = await q(`select kind, key, overs, allowed, age_band from bowling_breach where match_id = $1`, [m]);
    ok("the sixth over of the spell is written down as a breach", br.length === 1 && br[0].kind === "spell" && br[0].overs === 6 && br[0].allowed === 5 && br[0].age_band === "U13");
    const sp = (await spells(m, u14)).find((r) => r.bowler_id === PACE);
    ok("...and the spell read says so", sp?.over_spell_limit === true && sp?.breach_recorded === true);
    const n = (await notices(u14)).filter((x) => /Bowling directive/.test(x.title));
    ok("the U14A coach is told", n.length === 1 && /L Zondi \(U13\) is 6 overs into a spell/.test(n[0].body) && n[0].urgency === "high");
    ok("...the director of sport too", (await notices(head)).some((x) => /L Zondi/.test(x.body)));
    ok("...the 1XI coach is not", !(await notices(coach)).some((x) => /L Zondi/.test(x.body)));
    ok("...nor a spectator", !(await notices(watcher)).some((x) => /L Zondi/.test(x.body)));
    ok("...and the physio is, because this is injury prevention", (await notices(medic)).some((x) => /L Zondi/.test(x.body)));
    ok("...but a pupil on the side is not", !(await notices(await login("pillay@example.invalid"))).some((x) => /L Zondi/.test(x.body)));
    ok("...and the notice is not public", (await q(`select is_public from notification where title = 'Bowling directive exceeded'`)).every((x) => x.is_public === false));
    await feed(m, 0, [six(SPIN), six(PACE)]);
    ok("a seventh over is the same breach, not a second", (await q(`select count(*)::int c from bowling_breach where match_id = $1`, [m]))[0].c === 1
       && (await notices(u14)).filter((x) => /Bowling directive/.test(x.title)).length === 1);
    ok("...with the count kept at the first crossing", (await q(`select overs from bowling_breach where match_id = $1`, [m]))[0].overs === 6);
    ok("the coach reads the breach", (await rows("/api/read/bowling_breaches?teamCode=U14A", u14)).length === 1);
    ok("...and the 1XI coach does not", (await rows("/api/read/bowling_breaches", coach)).length === 0);
    ok("the breach is a fact nobody deletes",
       !(await q(`set local role scrbrd_app; delete from bowling_breach`).then(() => true).catch(() => false)));
    ok("the notice count moved by exactly one", (await notices(u14)).length === before + 1);
  }

  group("A day over the directive is a breach across matches");
  {
    // Two matches on the same day two weeks ago: 5 + 6 overs in short spells.
    const a = await fixture("U14A", 14, "DHS");
    const b = await fixture("U14A", 14, "Glenwood");
    await feed(a, 0, [six(PACE), six(SPIN), six(PACE), six(SPIN), six(PACE), six(SPIN), six(SPIN), six(SPIN), six(PACE), six(SPIN), six(PACE)]);
    await feed(b, 0, [six(PACE), six(SPIN), six(PACE), six(SPIN), six(PACE), six(SPIN), six(SPIN), six(SPIN), six(PACE), six(SPIN), six(PACE)]);
    ok("ten overs across two matches is within the day", (await q(`select count(*)::int c from bowling_breach where kind = 'day'`))[0].c === 0);
    await feed(b, 1, [six(PACE)]);
    const d = await q(`select overs, allowed, bowled_on::text from bowling_breach where kind = 'day' and bowler_id = $1`, [PACE]);
    ok("the eleventh is a day breach", d.length === 1 && d[0].overs === 11 && d[0].allowed === 10);
    ok("...dated by the fixture, not by when the row arrived", String(d[0].bowled_on).slice(0, 10) === (await q(`select ((now() - interval '14 days') at time zone 'Africa/Johannesburg')::date::text d`))[0].d);
    ok("...and the coach is told, in different words", (await notices(u14)).some((x) => /has bowled 11 overs today/.test(x.body)));
    await feed(b, 1, [six(SPIN), six(PACE)]);
    ok("a twelfth is the same day, not a second breach", (await q(`select count(*)::int c from bowling_breach where kind = 'day'`))[0].c === 1);
    // The spinner bowled more than anyone and is under no directive.
    ok("the spinner bowled twelve overs in a day and breached nothing", (await q(`select count(*)::int c from bowling_breach where bowler_id = $1`, [SPIN]))[0].c === 0);
  }

  group("An adult is not under the directive; a U19 still is");
  {
    const m = await fixture("1XI", 1);
    await feed(m, 0, Array.from({ length: 16 }, (_, i) => six(i % 2 ? ADULT : U19)));
    ok("eight overs on the trot from a nineteen-year-old is just bowling", (await q(`select count(*)::int c from bowling_breach where bowler_id = $1`, [ADULT]))[0].c === 0);
    ok("...and his spell reads open, no limit", (await spells(m, coach)).find((r) => r.bowler_id === ADULT)?.age_band === "open");
    ok("the same eight from a U19 is one over too many", (await q(`select overs, allowed from bowling_breach where bowler_id = $1 and kind = 'spell'`, [U19]))
       .some((b) => b.overs === 8 && b.allowed === 7));
  }

  group("The workload read says one word per boy, to those who may read him");
  {
    // Training in the window: two sessions this week, one last month, one he skipped.
    const sess = async (daysAgo, mins, status) => {
      const id = (await q(`insert into training_session (school_id, team_code, title, starts_at, duration_min, session_type)
                            values ($1, 'U14A', 'Nets', now() - ($2 || ' days')::interval, $3, 'bowling') returning id`, [HIL, String(daysAgo), mins]))[0].id;
      await q(`insert into training_attendance (session_id, player_id, status) values ($1, $2, $3)`, [id, PACE, status]);
    };
    await sess(2, 90, "present"); await sess(5, 60, "late"); await sess(20, 75, "present"); await sess(3, 45, "absent");
    // And three more overs two days ago, so the week stands out against the month.
    await feed(await fixture("U14A", 2, "Clifton"), 0, [six(PACE), six(SPIN), six(PACE), six(SPIN), six(PACE)]);
    const w = await workload(u14, "U14A");
    const z = w.find((r) => r.player_id === PACE);
    ok("the U14A coach reads his side's workload", w.length === 3 && z);
    // This week: 7 (the spell breach today) + 3 (Clifton). This month adds the
    // 12 of the day breach a fortnight ago. The forty-day-old match is outside.
    ok("...overs this week and this month", z.overs_7d === 10 && z.overs_28d === 22);
    ok("...his longest spell this week", z.longest_spell_7d === 7);
    ok("...the breaches on his name", z.breaches_28d === 2);
    ok("...training he was at, not training he skipped", z.sessions_7d === 2 && z.minutes_7d === 150 && z.sessions_28d === 3 && z.minutes_28d === 225);
    ok("...the ratio", Number(z.acwr) === Number((10 / (22 / 4)).toFixed(2)));
    ok("...and the word", z.load_state === "spike");
    ok("the spinner is steady work with no directive", w.find((r) => r.player_id === SPIN)?.max_overs_per_spell === null && w.find((r) => r.player_id === SPIN)?.breaches_28d === 0);
    ok("a boy who has not bowled says so", w.find((r) => r.player_id === BAT)?.load_state === "no bowling");
    ok("the breaches come first", w[0].player_id === PACE);
    ok("the director of sport reads the whole school", (await workload(head)).length >= 9);
    ok("the 1XI coach reads his own side and not the U14s", (await workload(coach)).every((r) => r.team_code === "1XI") && (await workload(coach, "U14A")).length === 0);
    ok("a spectator reads nothing", (await workload(watcher)).length === 0);
    ok("a parent reads nothing", (await workload(parent)).length === 0);
    ok("the physio reads the school — load is injury prevention", (await workload(medic)).length >= 9);
    const boy = await login("pillay@example.invalid");
    // Through self-access, which names him. The pupil ROLE holds
    // player.development.read across the side; it does not hold this.
    ok("a boy reads his own and nobody else's", (await workload(boy)).every((r) => r.player_id === "aaaaaaaa-0000-0000-0000-000000000005") && (await workload(boy)).length === 1);
    ok("...and not his team-mates' breaches", (await rows("/api/read/bowling_breaches", boy)).every((b) => b.bowler_id === "aaaaaaaa-0000-0000-0000-000000000005"));
    ok("a voided ball drops out of the overs", await (async () => {
      const m = await fixture("U14A", 3, "Maritzburg College");
      await feed(m, 0, [six(SPIN)]);
      const k = (await q(`select idempotency_key from ball_event where match_id = $1 order by seq desc limit 1`, [m]))[0].idempotency_key;
      await q(`insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id, idempotency_key, client_seq, client_ts, kind, payload)
               values ($1, $2, $3, 0, 0, $4, 'walk', $5, $3, now(), 'void', jsonb_build_object('target', $6::text))`, [m, HIL, ++seq, SCORER, `wl-${++key}`, k]);
      return (await q(`select coalesce(sum(legal_balls), 0)::int b from bowler_over where match_id = $1`, [m]))[0].b === 5;
    })());
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
console.log(`\n${"─".repeat(52)}\nWORKLOAD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
