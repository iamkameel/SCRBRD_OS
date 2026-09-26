/**
 * The bench's ball log: a Hilton 12XI side, a season of complete fixtures, a
 * log carrying every rule the SQL figures follow. Shared by
 * tools/bench-career.mjs (db/49) and tools/bench-assessment.mjs (SCRBRD-097),
 * so the two benches measure the same volume.
 *
 * NOT A TEST AND NOT IN CI. It writes plain rows into whatever database the
 * pool it is handed points at, as the migration owner, the way the seed and the
 * smoke walks do (every trigger fires, the fingerprint and db/43's door
 * included), and leaves them there.
 *
 * --players boys, --matches complete fixtures a week apart, each an innings
 * batting (the opposition's bowler held by nobody) and an innings bowling (its
 * batters typed names). A small LCG makes the same log every time: wides,
 * no-balls (some of whose runs are byes, db/40), byes and leg byes, every
 * method of dismissal, run outs at the non-striker's end, wickets on a free
 * hit that the free hit saves (db/42), a retirement marked W (db/40) and
 * voided deliveries. One INSERT per fixture, so a fixture is one statement.
 *
 * Options beyond the volume, all off by default so bench-career's log is the
 * log it always was:
 *   tag       the suffix on names and keys (default: the clock, so two loads
 *             never collide). A fixed tag makes two loads into two databases
 *             the same log by name, for a before/after diff.
 *   datedBalls  stamp each delivery's server_ts at its fixture's start plus
 *             twenty seconds a ball, rather than the insert's now(), so a
 *             window on server_ts (the assessment read's) falls between
 *             fixtures instead of after all of them.
 *   explain   run each fixture's INSERT under EXPLAIN (ANALYZE, BUFFERS) and
 *             return, summed over the load, the statement's own time and
 *             buffers and each trigger's time and calls.
 */

/**
 * @param {import("pg").Pool} owner
 * @param {{ players: number, matches: number, balls: number, tag?: string,
 *           datedBalls?: boolean, explain?: boolean }} opts
 */
export async function loadBench(owner, { players: N_PLAYERS, matches: N_MATCHES, balls: N_BALLS,
                                         tag = Date.now().toString(36), datedBalls = false, explain = false }) {
  let seed = 49;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  /** @type {<T>(xs: T[]) => T} */
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const HIL = "11111111-1111-1111-1111-111111111111";

  const scorer = (await owner.query(`select id from app_user where email = 'scorer@example.invalid'`)).rows[0]?.id;
  if (!scorer) throw new Error("no seeded scorer — run node tools/migrate.mjs --reset --seed first");
  const players = [];
  for (let i = 0; i < N_PLAYERS; i++) {
    players.push((await owner.query(
      `insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
       values ($1, '12XI', $2, $3, 'allrounder', current_date - interval '16 years') returning id`,
      [HIL, `Bench ${tag} ${String(i + 1).padStart(2, "0")}`, 100 + i])).rows[0].id);
  }
  const cols = ["match_id", "school_id", "seq", "epoch", "innings", "scorer_user_id", "device_id", "idempotency_key",
                "client_seq", "client_ts", "kind", "ball_type", "value", "striker_id", "non_striker_id", "bowler_id",
                "dismissed_id", "dismissal", "payload", ...(datedBalls ? ["server_ts"] : [])];
  let total = 0;
  const stats = { statementMs: 0, sharedHit: 0, sharedRead: 0, /** @type {Record<string, { ms: number, calls: number }>} */ triggers: {} };
  const t0 = Date.now();
  /** @type {{ id: string, startsAt: Date }[]} */
  const matches = [];
  for (let m = 0; m < N_MATCHES; m++) {
    const { id: match, starts_at: startsAt } = (await owner.query(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1, '12XI', $2, now() - make_interval(days => $3), 'T20', 20, 'complete') returning id, starts_at`,
      [HIL, `Bench XI ${m + 1}`, 7 * (m + 1)])).rows[0];
    matches.push({ id: match, startsAt });
    const xi = Array.from({ length: 11 }, (_, k) => players[(m * 11 + k) % players.length]);
    /** @type {any[][]} */ const rows = [];
    let seq = 0;
    const key = () => `bench:${tag}:${m}:${seq}`;
    /** @param {number} innings @param {any} r */
    const push = (innings, r) => {
      seq++;
      rows.push([match, HIL, seq, 1, innings, scorer, "bench", key(), seq, new Date(), r.kind ?? "ball",
                 r.type ?? null, r.value ?? null, r.striker ?? null, r.nonStriker ?? null, r.bowler ?? null,
                 r.dismissed ?? null, r.dismissal ?? null, JSON.stringify(r.payload ?? {}),
                 ...(datedBalls ? [new Date(startsAt.getTime() + seq * 20_000)] : [])]);
    };
    for (const innings of [0, 1]) {
      const batting = innings === 0;             // Hilton bat first, then bowl
      let striker = 0, nonStriker = 1, next = 2, legal = 0, freeHit = false;
      let bowler = batting ? null : xi[6];
      const target = Math.floor(N_BALLS / 2);
      for (let b = 0; b < target; b++) {
        const who = batting ? { striker: xi[striker], nonStriker: xi[nonStriker] } : { striker: null, nonStriker: null };
        const r = rnd();
        /** @type {any} */
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
    const insert = `insert into ball_event (${cols.join(",")}) values ${values.join(",")}`;
    if (explain) {
      const [{ "QUERY PLAN": [plan] }] = (await owner.query(`explain (analyze, buffers, format json) ${insert}`, rows.flat())).rows;
      stats.statementMs += plan["Execution Time"];
      stats.sharedHit += plan.Plan["Shared Hit Blocks"];
      stats.sharedRead += plan.Plan["Shared Read Blocks"];
      for (const t of plan.Triggers ?? []) {
        const s = (stats.triggers[t["Trigger Name"]] ??= { ms: 0, calls: 0 });
        s.ms += t.Time; s.calls += t.Calls;
      }
    } else {
      await owner.query(insert, rows.flat());
    }
    total += rows.length;
  }
  const seconds = (Date.now() - t0) / 1000;
  console.log(`loaded ${N_PLAYERS} players, ${N_MATCHES} matches, ${total} ball_event rows in ${seconds.toFixed(1)} s`);
  return { players, matches, rows: total, seconds, stats };
}
