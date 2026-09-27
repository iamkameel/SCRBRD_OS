#!/usr/bin/env node
/**
 * The assessment read, and the milestone trigger under a bulk load
 * (SCRBRD-097).
 *
 * NOT A TEST AND NOT IN CI. It loads rows into whatever database DATABASE_URL
 * names and leaves them there, so run it against a local database you are
 * about to reset:
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/bench-assessment.mjs                  the read, at the seed's volume, and its reference
 *   node tools/bench-assessment.mjs --load           + bench-career's log (tools/bench-log.mjs), timed
 *   node tools/bench-assessment.mjs --load --players 60 --matches 20 --balls 250
 *   node tools/bench-assessment.mjs --check          the read against its reference, as nine readers
 *   node tools/bench-assessment.mjs --dump out.json  the read and the milestones, by name, for a diff
 *
 * THE READ is READ_QUERIES.ratings (services/api/read/read-api.mjs), run as
 * the application role with app.user_id set, as the API runs it — by default
 * as the director of sport. Its REFERENCE is the same statement as it stood
 * before SCRBRD-097, verbatim below: the three *_since() functions per player,
 * as a LATERAL, windowed by that player's anchors. Both are timed with
 * EXPLAIN (ANALYZE, BUFFERS) and a few plain runs.
 *
 * THE LOAD is bench-career's (the same LCG, the same volume), with two things
 * the assessment needs and the career read does not: each delivery is stamped
 * at its fixture's start (so a window on server_ts falls between fixtures),
 * and the bench boys are assessed on dates that cut their season — batting
 * only, bowling only, both on different days, on a match day itself (the
 * midnight edge) and not at all. The names carry a fixed tag, so two loads
 * into two databases are the same log by name. Each fixture's INSERT runs
 * under EXPLAIN (ANALYZE, BUFFERS): the load reports the statements' time,
 * each trigger's time and calls, and the database's shared-buffer counters
 * across it.
 *
 * --check runs the read and its reference as nine readers (db/49's eight and
 * the 1XI coach) and reports every row that differs, raw — before the
 * composer, so a type that moved (bigint to numeric) is a difference too —
 * and how many players' windows actually cut their evidence.
 *
 * --dump writes, per reader, the read's rows and the reference's; and, as the
 * owner, every milestone_notice row and every notification, in the order
 * they were written (ctid) and with every id replaced by a name, so a dump
 * from a database built before a change and one built after can be diffed
 * although their uuids differ.
 */
import pg from "pg";
import { writeFileSync } from "node:fs";
import { DISCIPLINES } from "@scrbrd/scoring";
import { READ_QUERIES } from "../services/api/read/read-api.mjs";
import { loadBench } from "./bench-log.mjs";

const OWNER_URL = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const APP_URL = process.env.APP_DATABASE_URL || "postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd";
const DIRECTOR = "88888888-0000-0000-0000-000000000007";
// db/49's eight readers (tools/bench-career.mjs), and the 1XI coach.
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
const flag = (/** @type {string} */ name) => args.includes(name);
const opt = (/** @type {string} */ name, /** @type {any} */ dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const N_PLAYERS = Number(opt("--players", 60));
const N_MATCHES = Number(opt("--matches", 20));
const N_BALLS = Number(opt("--balls", 250));
const RUNS = Number(opt("--runs", 3));
const AS = opt("--as", DIRECTOR);
const TAG = opt("--tag", "b097");

const owner = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
const app = new pg.Pool({ connectionString: APP_URL, max: 2 });

/** One statement as the application role, as `who`, in its own transaction. */
async function asReader(/** @type {string} */ who, /** @type {string} */ text, /** @type {any[]} */ params = []) {
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

// ── The reference: READ_QUERIES.ratings before SCRBRD-097, verbatim ─
// ratingsQuery() as e2faf46 left it: the per-discipline anchors, scores and
// notes exactly as the read still has them, and the evidence as a LATERAL
// call of each *_since() function per player.
const DISCIPLINE_NAMES = Object.keys(DISCIPLINES);
function referenceQuery() {
  /** @type {string[]} */
  const cols = [], joins = /** @type {string[]} */ ([]);
  DISCIPLINE_NAMES.forEach((d, i) => {
    const n = i + 1;
    cols.push(`${d}_a.anchor as ${d}_anchor`, `${d}_a.scores as ${d}_scores`,
              `coalesce(${d}_n.adjustment, 0) as ${d}_note_adjustment`,
              `coalesce(${d}_n.notes, 0) as ${d}_note_count`);
    joins.push(`
             left join lateral (
               select max(x.assessed_on) as anchor,
                      jsonb_object_agg(x.category || '.' || x.metric, x.score) as scores
                 from (select distinct on (s.category, s.metric)
                              s.category, s.metric, s.score, s.assessed_on
                         from player_skill s
                        where s.player_id = p.id
                          and (s.category || '.' || s.metric) = any($${n}::text[])
                        order by s.category, s.metric, s.assessed_on desc) x
             ) ${d}_a on true
             left join lateral (
               select sum(dn.adjustment)::int as adjustment, count(*)::int as notes
                 from development_note dn
                where dn.player_id = p.id
                  and dn.about_discipline = '${d}'
                  and dn.adjustment is not null
                  and (${d}_a.anchor is null or dn.observed_on >= ${d}_a.anchor)
             ) ${d}_n on true`);
  });
  return `select p.id as player_id, p.full_name, p.team_code, p.school_id,
                  ${cols.join(",\n                  ")},
                  coalesce(bs.runs, 0)          as runs,
                  coalesce(bs.balls_faced, 0)   as balls_faced,
                  coalesce(bd.dismissals, 0)    as dismissals,
                  coalesce(ws.runs_conceded, 0) as runs_conceded,
                  coalesce(ws.legal_balls, 0)   as balls_bowled,
                  coalesce(ws.wickets, 0)       as wickets
             from player p${joins.join("")}
             -- Evidence since the coach last looked. A date cast to timestamptz
             -- is midnight, so a match on the afternoon of the assessment day
             -- counts towards it — which is the right way round: the coach
             -- rated him in the nets that morning.
             left join lateral player_batting_since(p.id, batting_a.anchor::timestamptz) bs on true
             left join lateral (select player_dismissals_since(p.id, batting_a.anchor::timestamptz)
                                  as dismissals) bd on true
             left join lateral player_bowling_since(p.id, bowling_a.anchor::timestamptz) ws on true
            order by p.full_name`;
}
const REFERENCE = referenceQuery();
const READ = READ_QUERIES.ratings.text;
const PARAMS = READ_QUERIES.ratings.params();
/** @param {any[]} rows */
const canon = (rows) => rows.map((r) => JSON.stringify(r)).sort();

// ── The load ─────────────────────────────────────────────────────
async function load() {
  const before = await dbCounters();
  const { players, matches, stats } = await loadBench(owner, { players: N_PLAYERS, matches: N_MATCHES, balls: N_BALLS,
                                                                tag: TAG, datedBalls: true, explain: true });
  const after = await dbCounters();
  const trig = Object.entries(stats.triggers).map(([k, v]) => `${k} ${v.ms.toFixed(0)} ms/${v.calls}`).join(", ");
  console.log(`load: statements ${stats.statementMs.toFixed(0)} ms (plan shared hit ${stats.sharedHit}, read ${stats.sharedRead}); ` +
              `triggers: ${trig}`);
  console.log(`load: database shared hit ${after.hit - before.hit}, read ${after.read - before.read} across it`);
  // The assessments. Fixture m started 7(m+1) days ago, so a date 7k days ago
  // is fixture k-1's own day (its balls count: the anchor is that midnight)
  // and 7k-1 days ago is the day after it (they do not).
  const skill = [];
  players.forEach((id, i) => {
    const k = 1 + (i * 7) % N_MATCHES;            // somewhere in the season
    switch (i % 5) {
      case 0: break;                                // never assessed: no window at all
      case 1: skill.push([id, 7 * k, "technical", "footwork", 12]); break;               // batting, on a match day
      case 2: skill.push([id, 7 * k - 1, "technical", "lineAndLength", 13]); break;      // bowling, the day after one
      case 3: skill.push([id, 7 * k, "technical", "timing", 14],                         // both, a fortnight apart
                         [id, Math.max(1, 7 * k - 14), "technical", "lineAndLength", 11]); break;
      case 4: skill.push([id, 7 * k + 3, "mental", "concentration", 15],                 // an older look at both
                         [id, 7 * k - 3, "technical", "footwork", 16]); break;           // (concentration is in
                                                                                         // both); batting later
    }
  });
  for (const [id, daysAgo, category, metric, score] of skill) {
    await owner.query(`insert into player_skill (player_id, assessed_on, category, metric, score)
                       values ($1, current_date - $2::int, $3, $4, $5)`, [id, daysAgo, category, metric, score]);
  }
  console.log(`load: ${skill.length} assessments across ${players.length} bench players, ${matches.length} fixtures`);
}

async function dbCounters() {
  await owner.query("select pg_stat_force_next_flush()");
  await new Promise((r) => setTimeout(r, 1100));
  const [r] = (await owner.query(`select blks_hit::bigint hit, blks_read::bigint read from pg_stat_database
                                   where datname = current_database()`)).rows;
  return { hit: Number(r.hit), read: Number(r.read) };
}

// ── The read ─────────────────────────────────────────────────────
const median = (/** @type {number[]} */ xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function bench(/** @type {string} */ text, /** @type {string} */ label) {
  const [{ "QUERY PLAN": [plan] }] = await asReader(AS, `explain (analyze, buffers, format json) ${text}`, PARAMS);
  const wall = [];
  let rows = 0;
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    rows = (await asReader(AS, text, PARAMS)).length;
    wall.push(performance.now() - t);
  }
  console.log(`${label}: ${rows} rows · execution ${plan["Execution Time"].toFixed(1)} ms · ` +
              `shared hit ${plan.Plan["Shared Hit Blocks"]} (+${plan.Planning?.["Shared Hit Blocks"] ?? 0} planning) · ` +
              `wall-clock median ${median(wall).toFixed(1)} ms of ${RUNS}`);
}

async function volume() {
  const [all] = (await owner.query(`select count(*)::int n, count(*) filter (where kind = 'ball')::int balls,
                                           (select count(*)::int from player_skill) skills,
                                           (select count(*)::int from milestone_notice) notices from ball_event`)).rows;
  const [seen] = await asReader(AS, `select (select count(*)::int from ball_event_live where kind = 'ball') balls,
                                           (select count(*)::int from player) players`);
  console.log(`volume: ${all.n} ball_event rows (${all.balls} deliveries), ${all.skills} assessments, ${all.notices} milestone notices; ` +
              `as ${AS}: ${seen.balls} live deliveries, ${seen.players} players`);
}

// ── The check ────────────────────────────────────────────────────
async function check() {
  let bad = 0;
  // How many players' windows cut anything, as the owner: evidence since the
  // anchor that is not the lifetime figure. A check where every window is
  // "everything" would prove the predicate is harmless, not that it is right.
  const [cut] = await asReader(READERS.owner, `
    select count(*) filter (where r.runs + r.balls_faced + r.dismissals
                                  <> coalesce(l.runs, 0) + coalesce(l.balls_faced, 0) + coalesce(d.dismissals, 0))::int bat,
           count(*) filter (where r.runs_conceded + r.balls_bowled + r.wickets
                                  <> coalesce(w.runs_conceded, 0) + coalesce(w.legal_balls, 0) + coalesce(w.wickets, 0))::int bowl,
           count(*) filter (where r.batting_anchor is not null or r.bowling_anchor is not null)::int anchored,
           count(*)::int players
      from (${READ}) r
      left join player_batting_career l on l.player_id = r.player_id
      left join player_dismissals d on d.player_id = r.player_id
      left join player_bowling_career w on w.player_id = r.player_id`, PARAMS);
  console.log(`as the owner: ${cut.players} players, ${cut.anchored} with an anchor; the window cuts the batting evidence of ` +
              `${cut.bat} and the bowling evidence of ${cut.bowl}`);
  for (const [name, who] of Object.entries(READERS)) {
    const got = canon(await asReader(who, READ, PARAMS));
    const want = canon(await asReader(who, REFERENCE, PARAMS));
    const miss = want.filter((r) => !got.includes(r)), extra = got.filter((r) => !want.includes(r));
    bad += miss.length + extra.length;
    console.log(`${miss.length + extra.length ? "✗" : "✓"} ${name.padEnd(15)} ratings ${got.length}/${want.length} rows`);
    for (const r of [...miss.map((x) => `  reference only: ${x}`), ...extra.map((x) => `  read only:      ${x}`)].slice(0, 6)) console.log(r);
  }
  console.log(bad ? `\n${bad} difference(s)` : "\nno differences: the read is its reference, row for row, for every reader");
  return bad === 0;
}

// ── The dump ─────────────────────────────────────────────────────
async function names() {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const r of (await owner.query(`select id::text, 'player:' || full_name || '#' || coalesce(squad_no::text, '-') || '/' || coalesce(team_code, '-') n from player`)).rows) m.set(r.id, r.n);
  for (const r of (await owner.query(`select id::text, 'match:' || opponent || '@' || (starts_at at time zone 'Africa/Johannesburg')::date n from match`)).rows) m.set(r.id, r.n);
  return m;
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
async function dump(/** @type {string} */ file) {
  const byName = await names();
  /** @param {any[]} rows */
  const named = (rows) => rows.map((r) => JSON.stringify(r).replace(UUID, (u) => byName.get(u) ?? u));
  /** @type {Record<string, any>} */
  const out = { readers: {}, milestones: {} };
  for (const [name, who] of Object.entries(READERS)) {
    out.readers[name] = {
      ratings_read: named(await asReader(who, READ, PARAMS)).sort(),
      ratings_reference: named(await asReader(who, REFERENCE, PARAMS)).sort(),
    };
  }
  // As the owner, and in the order written: what the triggers left behind.
  out.milestones.milestone_notice = named((await owner.query(
    `select player_id, kind, match_id, innings, value from milestone_notice order by ctid`)).rows);
  out.milestones.notification = named((await owner.query(
    `select school_id, team_code, scope_level, kind, urgency, title, body, required_capability, is_public,
            subject_kind, subject_id, subject_person_id from notification order by ctid`)).rows);
  out.milestones.bowling_breach = named((await owner.query(
    `select match_id, innings, bowler_id, kind, key, overs, allowed, age_band, bowled_on from bowling_breach order by ctid`)).rows);
  out.milestones.player_milestone = named((await owner.query(`select * from player_milestone`)).rows).sort();
  writeFileSync(file, JSON.stringify(out, null, 1) + "\n");
  const kinds = (await owner.query(`select kind, count(*)::int n from milestone_notice group by kind order by kind`)).rows
    .map((r) => `${r.kind} ${r.n}`).join(", ");
  const n = Object.values(out.readers).reduce((a, r) => a + r.ratings_read.length, 0);
  console.log(`dumped ${n} ratings rows across ${Object.keys(READERS).length} readers, ` +
              `${out.milestones.milestone_notice.length} milestone notices (${kinds || "none"}), ` +
              `${out.milestones.notification.length} notifications to ${file}`);
}

let exit = 0;
try {
  if (flag("--load")) await load();
  await volume();
  if (flag("--check")) exit = (await check()) ? 0 : 1;
  if (opt("--dump")) await dump(opt("--dump"));
  if (!flag("--check") && !opt("--dump")) {
    await bench(REFERENCE, `reference (the *_since() calls per player) as ${AS}`);
    await bench(READ, `ratings read (one pass) as ${AS}`);
  }
} catch (e) {
  console.error(e);
  exit = 2;
} finally {
  await owner.end();
  await app.end();
}
process.exit(exit);
