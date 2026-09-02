/**
 * SCRBRD — Scoring event model.
 *
 * The ball log is the ONLY source of truth. Score, scorecards, worms, wagon
 * wheels and player stats are derived by replay (see replay.mjs) and are never
 * stored as authoritative state.
 *
 * These event shapes are the client-side twin of the `ball_event` table in
 * db/01_schema_scoring.sql. The column names there are snake_case and the
 * fields here are camelCase; `toRow()` / `fromRow()` are the only places that
 * translation happens.
 *
 * Why the log carries more than deliveries
 * ────────────────────────────────────────
 * A log of deliveries alone cannot reconstruct an innings. Three things happen
 * between balls and are invisible in a delivery record:
 *
 *   1. which batters are at the crease (openers, and each new arrival)
 *   2. who is bowling each over
 *   3. events that change the score without a delivery (penalty runs, retire)
 *
 * The pre-repo artifact stored those in mutable aggregates beside the log, so
 * the log could not stand alone. Every kind below exists to close one of those
 * gaps, which is what makes `deriveInnings()` total: given the events, there is
 * exactly one correct innings state, and no counter to forget to increment.
 */

// ── Event kinds ──────────────────────────────────────────
export const KIND = {
  INNINGS_START: "innings_start", // opens an innings, carries squads + format
  BATTERS:       "batters",       // striker / non-striker set (openers or new arrival)
  BOWLER:        "bowler",        // bowler set for the coming over
  BALL:          "ball",          // a delivery
  PENALTY:       "penalty",       // penalty runs, no delivery bowled
  RETIRE:        "retire",        // batter leaves the crease without being dismissed
  INNINGS_END:   "innings_end",   // declaration, all out, overs complete, rain
};

/** Delivery types. Mirrors ball_event.ball_type. */
export const BALL_TYPE = {
  RUN:     "run", // runs off the bat (including 0)
  WICKET:  "W",
  WIDE:    "Wd",
  NO_BALL: "Nb",
  BYE:     "B",
  LEG_BYE: "LB",
};

/** A delivery that does not count towards the over. */
export const ILLEGAL = new Set([BALL_TYPE.WIDE, BALL_TYPE.NO_BALL]);

/** Does this delivery consume a ball of the over? */
export const isLegal = (type) => !ILLEGAL.has(type);

/** Runs credited to the batter (as opposed to the extras column). */
export const OFF_THE_BAT = new Set([BALL_TYPE.RUN, BALL_TYPE.WICKET, BALL_TYPE.NO_BALL]);

export const RETIRE_REASON = { HURT: "hurt", OUT: "out" }; // retired hurt may resume

export const INNINGS_END_REASON = {
  ALL_OUT:   "all_out",
  OVERS:     "overs_complete",
  TARGET:    "target_reached",
  DECLARED:  "declared",
  ABANDONED: "abandoned",
};

// ── Constructors ─────────────────────────────────────────
// Each returns a plain, serialisable object. `seq` is assigned by the caller
// (the queue client-side, the database server-side) so that these stay pure.

let _monotonic = 0;
/**
 * Client-side idempotency key. Stable per (device, match, counter) so that a
 * retried POST is recognised as the same ball rather than appended twice —
 * this is what makes the offline queue's retries free.
 */
export function newIdempotencyKey(deviceId, matchId) {
  _monotonic += 1;
  return `${deviceId}:${matchId}:${Date.now().toString(36)}:${_monotonic.toString(36)}`;
}

const base = (kind, o = {}) => ({
  kind,
  innings: o.innings ?? 0,
  clientTs: o.clientTs ?? Date.now(),
  ...(o.seq !== undefined ? { seq: o.seq } : {}),
});

export const inningsStart = (o) => ({
  ...base(KIND.INNINGS_START, o),
  battingTeam: o.battingTeam,
  bowlingTeam: o.bowlingTeam,
  teamKey: o.teamKey ?? o.battingTeam,
  bowlingTeamKey: o.bowlingTeamKey ?? o.bowlingTeam,
  squad: o.squad ?? [],
  bowlingSquad: o.bowlingSquad ?? [],
  twelfthMan: o.twelfthMan ?? null,
  overs: o.overs ?? 20,
  target: o.target ?? null,
});

export const batters = (o) => ({
  ...base(KIND.BATTERS, o),
  striker: o.striker ?? null,
  nonStriker: o.nonStriker ?? null,
});

export const bowler = (o) => ({
  ...base(KIND.BOWLER, o),
  bowler: o.bowler ?? null,
});

/**
 * A delivery.
 *
 * `value` means runs off the bat for `run`/`W`/`Nb`, and the number of extras
 * run for `B`/`LB`/`Wd`. The one-run penalty for a wide or no-ball is implicit
 * and added during replay — never baked into `value`, so that the penalty can
 * never be double-counted by a caller that already added it.
 */
export const ball = (o) => ({
  ...base(KIND.BALL, o),
  // `type` is the delivery kind (run | W | Wd | Nb | B | LB). It is named to
  // match both the ball_event.ball_type column and the log entries the scoring
  // UI already reads, so a log entry needs no translation on either side.
  type: o.type ?? BALL_TYPE.RUN,
  value: o.value ?? 0,
  shot: o.shot ?? null,
  seg: o.seg ?? null,
  zone: o.zone ?? null,
  bowlerApproach: o.bowlerApproach ?? null,
  // Dismissal detail. `fielder` was dropped by the artifact's log and is
  // carried here so a scorecard line reads "c Naidoo b Mkhize" after replay.
  dismissal: o.dismissal ?? null,
  fielder: o.fielder ?? null,
  dismissed: o.dismissed ?? null, // player id; defaults to the striker at replay
  freeHit: o.freeHit ?? false,
});

export const penalty = (o) => ({
  ...base(KIND.PENALTY, o),
  runs: o.runs ?? 5,
  toBattingTeam: o.toBattingTeam ?? true,
  reason: o.reason ?? null,
});

export const retire = (o) => ({
  ...base(KIND.RETIRE, o),
  batter: o.batter,
  reason: o.reason ?? RETIRE_REASON.HURT,
});

export const inningsEnd = (o) => ({
  ...base(KIND.INNINGS_END, o),
  reason: o.reason ?? INNINGS_END_REASON.OVERS,
});

// ── Wire translation (client camelCase ↔ ball_event snake_case) ──
const ROW_SCALARS = ["shot", "seg", "zone", "dismissal"];

/** Client event → a `ball_event` row body for POST /matches/:id/events. */
export function toRow(ev) {
  const row = {
    kind: ev.kind,
    innings: ev.innings ?? 0,
    client_ts: new Date(ev.clientTs ?? Date.now()).toISOString(),
    ball_type: ev.type ?? null,
    value: ev.value ?? null,
    striker_id: ev.striker ?? null,
    non_striker_id: ev.nonStriker ?? null,
    bowler_id: ev.bowler ?? null,
    payload: {},
  };
  for (const k of ROW_SCALARS) if (ev[k] !== undefined) row[k] = ev[k];
  // Everything the table has no column for rides in `payload` untouched, so
  // adding a captured dimension never needs a migration.
  for (const [k, v] of Object.entries(ev)) {
    if (["kind", "innings", "clientTs", "type", "value", "striker", "nonStriker", "bowler", "seq", ...ROW_SCALARS].includes(k)) continue;
    row.payload[k] = v;
  }
  return row;
}

/** `ball_event` row → client event. Inverse of toRow(). */
export function fromRow(row) {
  return {
    kind: row.kind,
    innings: row.innings ?? 0,
    seq: row.seq,
    clientTs: row.client_ts ? new Date(row.client_ts).getTime() : Date.now(),
    ...(row.ball_type != null ? { type: row.ball_type } : {}),
    ...(row.value != null ? { value: row.value } : {}),
    ...(row.striker_id != null ? { striker: row.striker_id } : {}),
    ...(row.non_striker_id != null ? { nonStriker: row.non_striker_id } : {}),
    ...(row.bowler_id != null ? { bowler: row.bowler_id } : {}),
    ...Object.fromEntries(ROW_SCALARS.filter((k) => row[k] != null).map((k) => [k, row[k]])),
    ...(row.payload ?? {}),
  };
}
