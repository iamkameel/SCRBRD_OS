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
 *
 * Undo, and why `void` exists
 * ───────────────────────────
 * While an event has only ever existed on one phone, undo can simply drop it:
 * the log is private, and re-deriving from a shorter log is exact. Once the
 * server has the event that stops being true. The server's log is append-only
 * — no UPDATE, no DELETE, enforced by trigger and by the absence of a policy —
 * and a second device may already have replayed it.
 *
 * So a correction to a synced event is itself an event: `void` names the event
 * it undoes and is appended like any other. Replay honours it by skipping the
 * target. Two devices that have both seen the void derive the same innings;
 * one that has not yet seen it derives the innings as it stood, which is the
 * correct answer for what it knows.
 *
 * This is not a nicety. Truncating a log the server has already accepted is how
 * two devices end up disagreeing about history while each stays internally
 * consistent, and there is no evidence left to reconcile them with.
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
  VOID:          "void",          // undoes an earlier event that has already synced
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
 * An event's identity, minted on the device that recorded it.
 *
 * This is both the event id and the idempotency key, deliberately: they are the
 * same concept seen from two sides. A retried POST is recognised as the same
 * ball rather than appended twice, and a `void` can name its target using a
 * value that means the same thing on the phone and in the database.
 *
 * Stable per (device, match, counter) and never reused, so two devices scoring
 * the same match cannot collide.
 */
export function newEventId(deviceId, matchId) {
  _monotonic += 1;
  return `${deviceId}:${matchId}:${Date.now().toString(36)}:${_monotonic.toString(36)}`;
}

/** Former name. The value was always the event's identity, not just a dedupe token. */
export const newIdempotencyKey = newEventId;

const base = (kind, o = {}) => ({
  kind,
  innings: o.innings ?? 0,
  clientTs: o.clientTs ?? Date.now(),
  // `id` is the event's own identity, set by whatever records it. Optional
  // here so the constructors stay pure and usable in tests; the scoring
  // surface always supplies one, because without it an event cannot be voided.
  ...(o.id !== undefined ? { id: o.id } : {}),
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
/**
 * A delivery.
 *
 * Placement (theta / radius / placementSource / …) is documented in
 * placement.mjs and is built by placementFromTap() or noPlacement() rather
 * than assembled here — the derived fields have to stay in step with the
 * captured ones, and one constructor that can do it wrong is one too many.
 *
 * Defaults are the sector era: no point, no source. A ball that carries
 * `seg`/`zone` but no `theta` is a sector-era ball and is excluded from
 * anything needing a position. It is NEVER upgraded by synthesising a point
 * from its sector.
 */
/** The delivery kinds a ball may be, for the guard below. */
const BALL_TYPES = new Set(Object.values(BALL_TYPE));

/**
 * Reject a delivery kind the model does not define.
 *
 * An unrecognised type is NOT harmless: `type` defaults to a run, so a bad
 * value becomes a legal delivery worth whatever `value` says, and both the
 * device fold and the SQL fold agree on it — consistently, which is worse than
 * disagreeing, because nothing anywhere reports a problem. The scorecard is
 * simply wrong.
 *
 * What this catches: a literal typo, `type: "nb"` instead of BALL_TYPE.NO_BALL.
 *
 * What it CANNOT catch, and it is worth being honest about: a typo in the
 * constant itself. `BALL_TYPE.NOBALL` (the export is NO_BALL) evaluates to
 * undefined in the caller, before this function is reached, and undefined is
 * indistinguishable from "not specified" — which legitimately means a run.
 * That one is only ever caught by asserting the score independently, which is
 * how it was found: tools/smoke-fold.mjs made exactly that mistake and the
 * "both folds agree" assertion passed while the arithmetic one did not.
 */
const checkedType = (t) => {
  if (t == null) return BALL_TYPE.RUN;
  if (!BALL_TYPES.has(t)) {
    throw new TypeError(
      `unknown ball type ${JSON.stringify(t)} — expected one of ${[...BALL_TYPES].join(", ")}`);
  }
  return t;
};

export const ball = (o) => ({
  ...base(KIND.BALL, o),
  // `type` is the delivery kind (run | W | Wd | Nb | B | LB). It is named to
  // match both the ball_event.ball_type column and the log entries the scoring
  // UI already reads, so a log entry needs no translation on either side.
  type: checkedType(o.type),
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

  // ── Shot placement ──
  // Batter-relative polar coordinates. See placement.mjs for the frame and
  // for why a point is never reconstructed from a sector.
  theta: o.theta ?? null,                    // 0-359, leg-side positive from straight
  radius: o.radius ?? null,                  // 0.00-1.00, fraction of the boundary
  placementSource: o.placementSource ?? null, // "point" | "sector" | null
  placementNull: o.placementNull ?? null,     // why there is no placement
  closePosition: o.closePosition ?? null,     // set only inside the catching ring
  captureProfile: o.captureProfile ?? null,   // "full" | "standard" | "quick"
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

/**
 * Undo an event the server already has.
 *
 * `target` is the earlier event's id — the same string the server dedupes on,
 * so a void can be resolved against a log that came back from the API just as
 * well as against the one in memory.
 *
 * A void is never itself voided. Undoing an undo means appending the original
 * again, because the log is a record of what the scorer did, not a stack.
 */
export const voidEvent = (o) => ({
  ...base(KIND.VOID, o),
  target: o.target,
  reason: o.reason ?? "scorer_undo",
});

export const inningsEnd = (o) => ({
  ...base(KIND.INNINGS_END, o),
  reason: o.reason ?? INNINGS_END_REASON.OVERS,
});

// ── Wire translation (client camelCase ↔ ball_event snake_case) ──
// Fields that have a column of their own on ball_event. Placement joins them
// because the query layer has to filter on placement_source — a heat map that
// reads it out of a jsonb payload cannot be indexed, and a rule enforced by
// convention in report code is not enforced.
const ROW_SCALARS = ["shot", "seg", "zone", "dismissal"];
const ROW_SNAKE = {
  theta: "theta",
  radius: "radius",
  placementSource: "placement_source",
  placementNull: "placement_null",
  closePosition: "close_position",
  captureProfile: "capture_profile",
};

/**
 * Is this player reference something the database can store in a uuid column?
 *
 * Most of the time, no. ball_event.striker_id and bowler_id are foreign keys
 * into `player`, and SCRBRD holds rows for its OWN schools' players — not for
 * the opposition. A fixture against a school that is not a tenant has no away
 * roster at all, so the scorer types the bowler's name, and that name is the
 * only identity that will ever exist for them. The same goes for an unlisted
 * batter pressed into a side at the last minute, which happens constantly at
 * school level.
 *
 * Sending a typed name to a uuid column is a 22P02 that rejects the whole
 * delivery — every ball of every over bowled by an opposition bowler, which is
 * to say almost all of them.
 *
 * So a reference that is a real player id goes in the column and can be joined
 * on; anything else rides in the payload as free text. Replay treats them
 * identically, because it only ever compares ids for equality.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asPlayerId = (v) => (typeof v === "string" && UUID.test(v) ? v : null);

/** Client event → a `ball_event` row body for POST /matches/:id/events. */
export function toRow(ev) {
  const row = {
    kind: ev.kind,
    innings: ev.innings ?? 0,
    client_ts: new Date(ev.clientTs ?? Date.now()).toISOString(),
    ball_type: ev.type ?? null,
    value: ev.value ?? null,
    striker_id: asPlayerId(ev.striker),
    non_striker_id: asPlayerId(ev.nonStriker),
    bowler_id: asPlayerId(ev.bowler),
    payload: {},
  };
  for (const k of ROW_SCALARS) if (ev[k] !== undefined) row[k] = ev[k];
  for (const [k, col] of Object.entries(ROW_SNAKE)) if (ev[k] !== undefined) row[col] = ev[k];
  // Everything the table has no column for rides in `payload` untouched, so
  // adding a captured dimension never needs a migration. A player reference
  // that is not a real id is carried here too — see asPlayerId — so nothing is
  // lost when the column cannot hold it.
  const MAPPED = ["kind", "innings", "clientTs", "type", "value", "seq",
                  ...ROW_SCALARS, ...Object.keys(ROW_SNAKE)];
  for (const [k, v] of Object.entries(ev)) {
    if (MAPPED.includes(k)) continue;
    if (k === "striker" && row.striker_id) continue;
    if (k === "nonStriker" && row.non_striker_id) continue;
    if (k === "bowler" && row.bowler_id) continue;
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
    // The event's identity comes back off the idempotency_key column, because
    // that IS its identity — see newEventId(). Without this a log fetched from
    // the server has anonymous events, and a `void` in that same log names a
    // target nothing matches: the correction would silently do nothing, and
    // the two devices would disagree by exactly the ball that was undone.
    ...(row.idempotency_key != null ? { id: row.idempotency_key } : {}),
    clientTs: row.client_ts ? new Date(row.client_ts).getTime() : Date.now(),
    ...(row.ball_type != null ? { type: row.ball_type } : {}),
    ...(row.value != null ? { value: row.value } : {}),
    ...(row.striker_id != null ? { striker: row.striker_id } : {}),
    ...(row.non_striker_id != null ? { nonStriker: row.non_striker_id } : {}),
    ...(row.bowler_id != null ? { bowler: row.bowler_id } : {}),
    ...Object.fromEntries(ROW_SCALARS.filter((k) => row[k] != null).map((k) => [k, row[k]])),
    ...Object.fromEntries(Object.entries(ROW_SNAKE)
      .filter(([, col]) => row[col] != null)
      // numeric(3,2) comes back from pg as a string; radius is a number.
      .map(([k, col]) => [k, k === "radius" ? Number(row[col]) : row[col]])),
    ...(row.payload ?? {}),
  };
}
