#!/usr/bin/env node
/**
 * How long the `career` read takes, at a volume a school will reach (db/49).
 *
 * NOT A TEST AND NOT IN CI. It loads rows into whatever database DATABASE_URL
 * names and leaves them there, so run it against a local database you are
 * about to reset:
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/bench-career.mjs                     the read, at the seed's volume
 *   node tools/bench-career.mjs --load              + 60 players, 20 matches of ~250 balls
 *   node tools/bench-career.mjs --load --players 60 --matches 20 --balls 250
 *   node tools/bench-career.mjs --check             the read against its reference, as eight readers
 *   node tools/bench-career.mjs --dump before.json  every figure db/49 touches, as eight readers
 *
 * THE READ is READ_QUERIES.career itself (services/api/read/read-api.mjs),
 * run as the application role with app.user_id set, as the API runs it — by
 * default as the director of sport (sarah@example.invalid), who reads every
 * Hilton team. It prints EXPLAIN (ANALYZE, BUFFERS)'s execution time and
 * shared-buffer hits, and the wall-clock median of a few plain runs.
 *
 * THE LOAD writes plain rows into ball_event as the migration owner, the way
 * the seed and the smoke walks do (every trigger fires, the fingerprint and
 * db/43's door included): a Hilton "BENCH" side of --players boys, --matches
 * complete fixtures a week apart, each an innings batting (the opposition's
 * bowler held by nobody) and an innings bowling (its batters typed names).
 * A small LCG makes the same log every time: wides, no-balls (some of whose
 * runs are byes, db/40), byes and leg byes, every method of dismissal, run
 * outs at the non-striker's end, wickets on a free hit that the free hit
 * saves (db/42), a retirement marked W (db/40) and voided deliveries.
 *
 * --check runs the read beside its REFERENCE — the same statement with the
 * lifetime views written as db/02 and db/40 defined them (each player's own
 * pass through the *_since() functions) and the form guide as a per-player
 * LATERAL — as eight readers, and reports every row that differs. The
 * reference's form guide breaks ties in `ended_at` as the read does, so a
 * tie cannot pass for a difference; how many ties there were is printed.
 *
 * --dump writes, per reader, the three lifetime views, player_innings,
 * player_dismissal_breakdown, player_milestone, the three season views and
 * the `career` read, canonically sorted, to a JSON file: dump before a
 * migration, dump after, and diff the two files.
 */
import pg from "pg";
import { writeFileSync } from "node:fs";
import { READ_QUERIES } from "../services/api/read/read-api.mjs";

const OWNER_URL = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const APP_URL = process.env.APP_DATABASE_URL || "postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const DIRECTOR = "88888888-0000-0000-0000-000000000007";
// The readers --check and --dump read as (db/99's principals).
const READERS = {
  director: DIRECTOR,
  owner: "88888888-0000-0000-0000-000000000022",
  coach1XI: "88888888-0000-0000-0000-000000000004",
  coach2XI: "88888888-0000-0000-0000-00000000000a",
  scorer: "88888888-0000-0000-0000-000000000006",
  parent: "88888888-0000-0000-0000-000000000005",
  westvilleAdmin: "88888888-0000-0000-0000-00000000000d",
  pupil: "88888888-0000-0000-0000-000000000009",
  nobody: "",
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const N_PLAYERS = Number(opt("--players", 60));
const N_MATCHES = Number(opt("--matches", 20));
const N_BALLS = Number(opt("--balls", 250));
const RUNS = Number(opt("--runs", 3));
const AS = opt("--as", DIRECTOR);

const owner = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
const app = new pg.Pool({ connectionString: APP_URL, max: 2 });

/** One statement as the application role, as `who`, in its own transaction. */
async function asReader(who, text, params = []) {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.user_id', $1, true)", [who]);
    return (await c.query(text, params)).rows;
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

// ── The load ─────────────────────────────────────────────────────
let seed = 49;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

async function load() {
  const tag = Date.now().toString(36);
  const scorer = (await owner.query(`select id from app_user where email = 'scorer@example.invalid'`)).rows[0]?.id;
  if (!scorer) throw new Error("no seeded scorer — run node tools/migrate.mjs --reset --seed first");
  const players = [];
  for (let i = 0; i < N_PLAYERS; i++) {
    players.push((await owner.query(
      `insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
       values ($1, 'BENCH', $2, $3, 'allrounder', current_date - interval '16 years') returning id`,
      [HIL, `Bench ${tag} ${String(i + 1).padStart(2, "0")}`, 100 + i])).rows[0].id);
  }
  const cols = ["match_id", "school_id", "seq", "epoch", "innings", "scorer_user_id", "device_id", "idempotency_key",
                "client_seq", "client_ts", "kind", "ball_type", "value", "striker_id", "non_striker_id", "bowler_id",
                "dismissed_id", "dismissal", "payload"];
  let total = 0;
  const t0 = Date.now();
  for (let m = 0; m < N_MATCHES; m++) {
    const match = (await owner.query(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1, 'BENCH', $2, now() - make_interval(days => $3), 'T20', 20, 'complete') returning id`,
      [HIL, `Bench XI ${m + 1}`, 7 * (m + 1)])).rows[0].id;
    const xi = Array.from({ length: 11 }, (_, k) => players[(m * 11 + k) % players.length]);
    /** @type {any[][]} */ const rows = [];
    let seq = 0;
    const key = () => `bench:${tag}:${m}:${seq}`;
    const push = (innings, r) => {
      seq++;
      rows.push([match, HIL, seq, 1, innings, scorer, "bench", key(), seq, new Date(), r.kind ?? "ball",
                 r.type ?? null, r.value ?? null, r.striker ?? null, r.nonStriker ?? null, r.bowler ?? null,
                 r.dismissed ?? null, r.dismissal ?? null, JSON.stringify(r.payload ?? {})]);
    };
    for (const innings of [0, 1]) {
      const batting = innings === 0;             // Hilton bat first, then bowl
      let striker = 0, nonStriker = 1, next = 2, legal = 0, freeHit = false;
      let bowler = batting ? null : xi[6];
      const target = Math.floor(N_BALLS / 2);
      for (let b = 0; b < target; b++) {
        const who = batting ? { striker: xi[striker], nonStriker: xi[nonStriker] } : { striker: null, nonStriker: null };
        const r = rnd();
        let row;
        if (r < 0.04) row = { type: "Wd", value: rnd() < 0.15 ? 4 : 0 };
        else if (r < 0.07) row = { type: "Nb", value: pick([0, 1, 4, 6]), payload: rnd() < 0.3 ? { nbRuns: pick(["byes", "leg_byes"]) } : {} };
        else if (r < 0.10) row = { type: pick(["B", "LB"]), value: pick([1, 1, 4]) };
        else if (r < 0.145 || (freeHit && r < 0.30)) {
          const method = pick(["bowled", "caught", "caught", "lbw", "stumped", "run_out"]);
          row = { type: "W", value: method === "run_out" ? pick([0, 1]) : 0, dismissal: method };
          // A run out at the other end: the non-striker is out (SCRBRD-069).
          if (method === "run_out" && rnd() < 0.5) {
            if (batting) row.dismissed = xi[nonStriker];
            else row.payload = { dismissed: `Opposition ${b}` };
          }
        } else row = { type: "run", value: pick([0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 4, 6]) };
        push(innings, { ...row, ...who, bowler });
        // The free hit the fold keeps: a no-ball earns it, a wide carries it,
        // any other delivery consumes it (db/42).
        if (row.type === "Nb") freeHit = true; else if (row.type !== "Wd") freeHit = false;
        const saved = row.type === "W" && row.dismissal !== "run_out" && rows.length > 1 && rows[rows.length - 2][11] === "Nb";
        if (batting && row.type === "W" && !saved) {
          if (next > 10) break;                  // all out
          if (row.dismissed === xi[nonStriker]) nonStriker = next++; else striker = next++;
        }
        if (row.type !== "Wd" && row.type !== "Nb") {
          if (++legal % 6 === 0) {
            [striker, nonStriker] = [nonStriker, striker];
            if (!batting) bowler = xi[6 + (legal / 6) % 5];
          }
        }
        if (batting && row.type === "run" && row.value % 2 === 1) [striker, nonStriker] = [nonStriker, striker];
        // Now and then the scorer takes the last delivery back.
        if (b % 61 === 60) push(innings, { kind: "void", payload: { target: key() } });
        // Once a match, a batter retires out (db/40): a W marker, no ball.
        if (batting && b === 40 && next <= 10) {
          push(innings, { kind: "retire", type: "W", dismissal: "retired_out", payload: { batter: xi[striker], reason: "out" } });
          striker = next++;
        }
      }
    }
    const values = rows.map((r, i) => `(${r.map((_, j) => `$${i * cols.length + j + 1}`).join(",")})`);
    await owner.query(`insert into ball_event (${cols.join(",")}) values ${values.join(",")}`, rows.flat());
    total += rows.length;
  }
  console.log(`loaded ${N_PLAYERS} players, ${N_MATCHES} matches, ${total} ball_event rows in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ── The read ─────────────────────────────────────────────────────
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function bench(text, label) {
  const [{ "QUERY PLAN": [plan] }] = await asReader(AS, `explain (analyze, buffers, format json) ${text}`);
  const wall = [];
  let rows = 0;
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    rows = (await asReader(AS, text)).length;
    wall.push(performance.now() - t);
  }
  console.log(`${label}: ${rows} rows · execution ${plan["Execution Time"].toFixed(1)} ms · ` +
              `shared hit ${plan.Plan["Shared Hit Blocks"]} (+${plan.Planning?.["Shared Hit Blocks"] ?? 0} planning) · ` +
              `wall-clock median ${median(wall).toFixed(1)} ms of ${RUNS}`);
}

async function volume() {
  const [all] = (await owner.query(`select count(*)::int n, count(*) filter (where kind = 'ball')::int balls from ball_event`)).rows;
  const [seen] = await asReader(AS, `select (select count(*)::int from ball_event_live where kind = 'ball') balls,
                                           (select count(*)::int from player) players`);
  console.log(`volume: ${all.n} ball_event rows (${all.balls} deliveries); as ${AS}: ${seen.balls} live deliveries, ${seen.players} players`);
}

// ── The reference: the read as it was before db/49 ───────────────
// READ_QUERIES.career with each lifetime view spelled as db/02/db/40 left it
// and the form guide as the per-player LATERAL it was. Ties in ended_at are
// broken as the read now breaks them.
const REFERENCE = `
select p.id as player_id, p.full_name, p.team_code, p.school_id,
       coalesce(bat.matches, 0) as bat_matches, coalesce(bat.runs, 0) as runs,
       coalesce(bat.balls_faced, 0) as balls_faced, coalesce(bat.fours, 0) as fours,
       coalesce(bat.sixes, 0) as sixes, coalesce(d.dismissals, 0) as dismissals,
       coalesce(bowl.matches, 0) as bowl_matches, coalesce(bowl.runs_conceded, 0) as runs_conceded,
       coalesce(bowl.legal_balls, 0) as balls_bowled, coalesce(bowl.wickets, 0) as wickets,
       coalesce(f.form, '{}') as form
  from player p
  left join (select q.id as player_id, c.* from player q cross join lateral player_batting_since(q.id, null) c
              where c.matches > 0) bat on bat.player_id = p.id
  left join (select q.id as player_id, player_dismissals_since(q.id, null) as dismissals from player q
              where player_dismissals_since(q.id, null) > 0) d on d.player_id = p.id
  left join (select q.id as player_id, c.* from player q cross join lateral player_bowling_since(q.id, null) c
              where c.matches > 0) bowl on bowl.player_id = p.id
  left join lateral (
    select array_agg(x.runs order by x.ended_at desc, x.match_id desc, x.innings desc) as form
      from (select i.runs, i.ended_at, i.match_id, i.innings from player_innings i
             where i.player_id = p.id
             order by i.ended_at desc, i.match_id desc, i.innings desc limit 8) x
  ) f on true
 order by p.full_name, p.id`;
const LIFETIME_REFERENCE = {
  player_batting_career: `select p.id as player_id, c.* from player p cross join lateral player_batting_since(p.id, null) c where c.matches > 0`,
  player_bowling_career: `select p.id as player_id, c.* from player p cross join lateral player_bowling_since(p.id, null) c where c.matches > 0`,
  player_dismissals: `select p.id as player_id, player_dismissals_since(p.id, null) as dismissals from player p where player_dismissals_since(p.id, null) > 0`,
};
const canon = (rows) => rows.map((r) => JSON.stringify(r)).sort();

async function check() {
  let bad = 0;
  const ties = (await owner.query(
    `select count(*)::int n from (select player_id, ended_at from player_innings group by 1, 2 having count(*) > 1) t`)).rows[0].n;
  console.log(`ties in player_innings.ended_at (same player, same instant), owner's view: ${ties}`);
  for (const [name, who] of Object.entries(READERS)) {
    const got = canon(await asReader(who, READ_QUERIES.career.text));
    const want = canon(await asReader(who, REFERENCE));
    const miss = want.filter((r) => !got.includes(r)), extra = got.filter((r) => !want.includes(r));
    const lines = [`career ${got.length}/${want.length} rows`];
    for (const [view, ref] of Object.entries(LIFETIME_REFERENCE)) {
      const v = canon(await asReader(who, `select * from ${view}`));
      const r = canon(await asReader(who, ref));
      const d = v.filter((x) => !r.includes(x)).length + r.filter((x) => !v.includes(x)).length;
      lines.push(`${view} ${v.length}/${r.length}${d ? ` — ${d} DIFFER` : ""}`);
      bad += d;
    }
    bad += miss.length + extra.length;
    console.log(`${miss.length + extra.length || lines.some((l) => l.includes("DIFFER")) ? "✗" : "✓"} ${name.padEnd(15)} ${lines.join(" · ")}`);
    for (const r of [...miss.map((x) => `  reference only: ${x}`), ...extra.map((x) => `  read only:      ${x}`)].slice(0, 6)) console.log(r);
  }
  console.log(bad ? `\n${bad} difference(s)` : "\nno differences: the read and every lifetime view are their reference, row for row, for every reader");
  return bad === 0;
}

// ── The dump ─────────────────────────────────────────────────────
const DUMPED = {
  player_batting_career: "select * from player_batting_career",
  player_bowling_career: "select * from player_bowling_career",
  player_dismissals: "select * from player_dismissals",
  player_innings: "select * from player_innings",
  player_dismissal_breakdown: "select * from player_dismissal_breakdown",
  player_milestone: "select * from player_milestone",
  player_batting_by_season: "select * from player_batting_by_season",
  player_bowling_by_season: "select * from player_bowling_by_season",
  player_dismissals_by_season: "select * from player_dismissals_by_season",
  career_read: READ_QUERIES.career.text,
};
async function dump(file) {
  const out = {};
  for (const [name, who] of Object.entries(READERS)) {
    out[name] = {};
    for (const [what, text] of Object.entries(DUMPED)) out[name][what] = canon(await asReader(who, text));
  }
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  const n = Object.values(out).reduce((a, r) => a + Object.values(r).reduce((b, x) => b + x.length, 0), 0);
  console.log(`dumped ${n} rows across ${Object.keys(READERS).length} readers to ${file}`);
}

let exit = 0;
try {
  if (flag("--load")) await load();
  await volume();
  if (flag("--check")) exit = (await check()) ? 0 : 1;
  else if (opt("--dump")) await dump(opt("--dump"));
  else await bench(READ_QUERIES.career.text, `career as ${AS}`);
} catch (e) {
  console.error(e);
  exit = 2;
} finally {
  await owner.end();
  await app.end();
}
process.exit(exit);
