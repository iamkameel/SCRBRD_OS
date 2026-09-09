/**
 * SCRBRD — Scoring Session & Handover
 * Reference implementation (framework-agnostic, no I/O).
 *
 * Design invariants:
 *  1. The ball event log is the ONLY source of truth. Score, cards and charts
 *     are always derived by replay — never stored as authoritative state.
 *  2. Exactly one device may write to a match at a time (the scoring token).
 *  3. Handover is explicit and gated on a fully-synced queue.
 *  4. Events from a revoked token epoch are QUARANTINED, never auto-merged.
 *
 * Terminology:
 *  - capability : may this ROLE score at all?          (canScore, RBAC layer)
 *  - token      : is this DEVICE scoring THIS match?   (this module)
 *  Both are required to write a ball.
 */

import { deriveInnings } from "@scrbrd/scoring";

// ─────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────
export const SESSION = {
  IDLE:             "idle",              // no active scorer
  ACTIVE:           "active",            // token held, scoring permitted
  HANDOVER_PENDING: "handover_pending",  // outgoing scorer armed handover
  VERIFYING:        "verifying",         // incoming scorer confirming state
};

export const LEASE_MS      = 90_000;   // token lease; refreshed by heartbeat
export const GRACE_MS      = 30_000;   // extra slack before force-release allowed
export const CHECKPOINT_EVERY = 6;     // force a sync attempt each over

export const REJECT = {
  NO_CAPABILITY:   "no_capability",
  NOT_TOKEN_HOLDER:"not_token_holder",
  STALE_EPOCH:     "stale_epoch",
  LEASE_EXPIRED:   "lease_expired",
  DUPLICATE:       "duplicate",
  UNSYNCED_WORK:   "unsynced_work",
  BALL_IN_FLIGHT:  "ball_in_flight",
  VERIFY_MISMATCH: "verify_mismatch",
  NOT_PENDING:     "not_pending",
  LEASE_ACTIVE:    "lease_active",
};

// ─────────────────────────────────────────────────────────
//  Server-side match session (authoritative)
// ─────────────────────────────────────────────────────────
export class MatchSession {
  /**
   * @param {object} o
   * @param {string} o.matchId
   * @param {(role:string)=>boolean} o.canScore  RBAC capability check
   * @param {()=>number} [o.now]                 injectable clock (ms)
   */
  constructor({ matchId, canScore, now = () => Date.now() }) {
    this.matchId = matchId;
    this.canScore = canScore;
    this.now = now;

    this.state   = SESSION.IDLE;
    this.epoch   = 0;        // increments on every token transfer/claim
    this.holder  = null;     // { scorerId, deviceId, name }
    this.leaseUntil = 0;
    this.pendingHandover = null; // { toScorerId?, code, armedAt, fromEpoch }

    this.events      = [];   // authoritative append-only log
    this.seq         = 0;    // authoritative sequence
    this.seenKeys    = new Set();  // idempotency
    this.quarantine  = [];   // events rejected for stale epoch — human review
    this.audit       = [];   // handover / token history
  }

  // ── internal helpers ──
  _log(type, data) { this.audit.push({ type, at: this.now(), ...data }); }
  _leaseLive() { return this.now() < this.leaseUntil; }

  /** Derived match state — the ONLY way score is obtained. */
  replay() { return replayEvents(this.events); }

  // ── token lifecycle ──
  /** Claim an idle match (or take over an expired lease). */
  claim({ scorerId, deviceId, role, name }) {
    if (!this.canScore(role)) return { ok: false, reason: REJECT.NO_CAPABILITY };
    if (this.state === SESSION.ACTIVE && this._leaseLive() &&
        this.holder?.deviceId !== deviceId) {
      return { ok: false, reason: REJECT.LEASE_ACTIVE, holder: this.holder };
    }
    this.epoch += 1;
    this.holder = { scorerId, deviceId, name };
    this.state = SESSION.ACTIVE;
    this.leaseUntil = this.now() + LEASE_MS;
    this.pendingHandover = null;
    this._log("claim", { scorerId, deviceId, epoch: this.epoch });
    return { ok: true, epoch: this.epoch, state: this.replay() };
  }

  /** Keep the lease alive. Called every ~20s while scoring. */
  heartbeat({ deviceId, epoch }) {
    if (this.holder?.deviceId !== deviceId) return { ok: false, reason: REJECT.NOT_TOKEN_HOLDER };
    if (epoch !== this.epoch) return { ok: false, reason: REJECT.STALE_EPOCH };
    this.leaseUntil = this.now() + LEASE_MS;
    return { ok: true, leaseUntil: this.leaseUntil };
  }

  /**
   * Append a ball event.
   * Rejects: wrong device, stale epoch, expired lease, duplicate key.
   * Stale-epoch events are quarantined rather than dropped or merged.
   */
  append(event) {
    const { deviceId, epoch, idempotencyKey } = event;
    if (this.seenKeys.has(idempotencyKey)) {
      const existing = this.events.find(e => e.idempotencyKey === idempotencyKey);
      return { ok: true, duplicate: true, seq: existing?.seq };  // idempotent replay
    }
    if (epoch !== this.epoch) {
      this.quarantine.push({ ...event, quarantinedAt: this.now(), currentEpoch: this.epoch });
      this._log("quarantine", { idempotencyKey, epoch, currentEpoch: this.epoch });
      return { ok: false, reason: REJECT.STALE_EPOCH, quarantined: true };
    }
    if (this.holder?.deviceId !== deviceId) return { ok: false, reason: REJECT.NOT_TOKEN_HOLDER };
    if (!this._leaseLive()) return { ok: false, reason: REJECT.LEASE_EXPIRED };

    this.seq += 1;
    const stored = { ...event, seq: this.seq, serverTs: this.now() };
    this.events.push(stored);
    this.seenKeys.add(idempotencyKey);
    this.leaseUntil = this.now() + LEASE_MS;   // activity refreshes lease
    return { ok: true, seq: this.seq };
  }

  // ── handover protocol ──
  /**
   * Step 1 — outgoing scorer arms handover.
   * Blocked while the device still holds unsynced balls or a part-entered ball.
   */
  armHandover({ deviceId, epoch, pendingCount = 0, ballInFlight = false, toScorerId = null }) {
    if (this.holder?.deviceId !== deviceId) return { ok: false, reason: REJECT.NOT_TOKEN_HOLDER };
    if (epoch !== this.epoch) return { ok: false, reason: REJECT.STALE_EPOCH };
    if (pendingCount > 0) return { ok: false, reason: REJECT.UNSYNCED_WORK, pendingCount };
    if (ballInFlight)     return { ok: false, reason: REJECT.BALL_IN_FLIGHT };

    const code = handoverCode(this.matchId, this.epoch);
    this.state = SESSION.HANDOVER_PENDING;
    this.pendingHandover = { toScorerId, code, armedAt: this.now(), fromEpoch: this.epoch };
    this._log("handover_armed", { from: this.holder.scorerId, toScorerId, code });
    return { ok: true, code, state: this.replay() };
  }

  /** Outgoing scorer changes their mind. */
  cancelHandover({ deviceId }) {
    if (this.holder?.deviceId !== deviceId) return { ok: false, reason: REJECT.NOT_TOKEN_HOLDER };
    if (this.state !== SESSION.HANDOVER_PENDING) return { ok: false, reason: REJECT.NOT_PENDING };
    this.state = SESSION.ACTIVE;
    this.pendingHandover = null;
    this._log("handover_cancelled", {});
    return { ok: true };
  }

  /**
   * Step 2 — incoming scorer claims the pending handover and receives the
   * full log to rebuild from. Scoring stays LOCKED until verify() passes.
   */
  claimHandover({ scorerId, deviceId, role, name, code }) {
    if (!this.canScore(role)) return { ok: false, reason: REJECT.NO_CAPABILITY };
    if (this.state !== SESSION.HANDOVER_PENDING) return { ok: false, reason: REJECT.NOT_PENDING };
    const ph = this.pendingHandover;
    if (ph.code !== code) return { ok: false, reason: REJECT.VERIFY_MISMATCH };
    if (ph.toScorerId && ph.toScorerId !== scorerId) return { ok: false, reason: REJECT.NO_CAPABILITY };

    this.state = SESSION.VERIFYING;
    this.pendingHandover = { ...ph, claimant: { scorerId, deviceId, name } };
    this._log("handover_claimed", { scorerId, deviceId });
    return { ok: true, events: this.events.slice(), expect: this.replay() };
  }

  /**
   * Step 3 — incoming scorer confirms the on-field state against the
   * physical scoreboard. Only on a match does the token transfer.
   */
  verifyAndTakeOver({ deviceId, confirm }) {
    if (this.state !== SESSION.VERIFYING) return { ok: false, reason: REJECT.NOT_PENDING };
    const claimant = this.pendingHandover?.claimant;
    if (claimant?.deviceId !== deviceId) return { ok: false, reason: REJECT.NOT_TOKEN_HOLDER };

    const truth = this.replay();
    const diff = diffConfirmation(truth, confirm);
    if (diff.length) {
      this._log("handover_verify_failed", { diff });
      return { ok: false, reason: REJECT.VERIFY_MISMATCH, diff, expect: truth };
    }
    const from = this.holder;
    this.epoch += 1;                       // invalidates the old device's token
    this.holder = { scorerId: claimant.scorerId, deviceId, name: claimant.name };
    this.state = SESSION.ACTIVE;
    this.leaseUntil = this.now() + LEASE_MS;
    this.pendingHandover = null;
    this._log("handover_complete", { from: from?.scorerId, to: claimant.scorerId, epoch: this.epoch });
    return { ok: true, epoch: this.epoch, state: truth };
  }

  /**
   * Recovery path — a dead/lost device holding the token. An authorised
   * admin may force-release only after the lease has expired plus grace.
   */
  forceRelease({ byRole, byScorerId, override = false }) {
    if (!this.canScore(byRole)) return { ok: false, reason: REJECT.NO_CAPABILITY };
    if (!override && this._leaseLive()) {
      return { ok: false, reason: REJECT.LEASE_ACTIVE, retryAfter: this.leaseUntil + GRACE_MS };
    }
    const prev = this.holder;
    this.epoch += 1;                       // any in-flight events become stale
    this.holder = null;
    this.state = SESSION.IDLE;
    this.leaseUntil = 0;
    this.pendingHandover = null;
    this._log("force_release", { by: byScorerId, from: prev?.scorerId, epoch: this.epoch });
    return { ok: true, epoch: this.epoch };
  }

  /** Operator review of quarantined events (e.g. offline device that died). */
  reviewQuarantine(idempotencyKey, decision) {
    const idx = this.quarantine.findIndex(e => e.idempotencyKey === idempotencyKey);
    if (idx < 0) return { ok: false };
    const [ev] = this.quarantine.splice(idx, 1);
    if (decision === "accept") {
      this.seq += 1;
      this.events.push({ ...ev, seq: this.seq, serverTs: this.now(), recovered: true });
      this.seenKeys.add(ev.idempotencyKey);
      this._log("quarantine_accepted", { idempotencyKey });
      return { ok: true, seq: this.seq };
    }
    this._log("quarantine_rejected", { idempotencyKey });
    return { ok: true, discarded: true };
  }
}

// ─────────────────────────────────────────────────────────
//  Client-side offline queue
// ─────────────────────────────────────────────────────────
export class ScoringQueue {
  constructor({ deviceId, scorerId, epoch, now = () => Date.now() }) {
    this.deviceId = deviceId;
    this.scorerId = scorerId;
    this.epoch = epoch;
    this.now = now;
    this.clientSeq = 0;
    this.pending = [];    // not yet acknowledged by the server
    this.acked = [];      // confirmed
    this.rejected = [];
  }

  get pendingCount() { return this.pending.length; }
  /** Handover is only safe when nothing is left unsynced. */
  get safeToHandOver() { return this.pending.length === 0; }

  /** Record a ball locally. Always succeeds — this is what keeps play going. */
  enqueue(payload) {
    this.clientSeq += 1;
    const ev = {
      matchId: payload.matchId,
      deviceId: this.deviceId,
      scorerId: this.scorerId,
      epoch: this.epoch,
      clientSeq: this.clientSeq,
      clientTs: this.now(),
      idempotencyKey: `${this.deviceId}:${this.epoch}:${this.clientSeq}`,
      payload,
    };
    this.pending.push(ev);
    return ev;
  }

  /** Attempt to flush. `transport` returns the server's append() result. */
  async flush(transport) {
    const results = [];
    while (this.pending.length) {
      const ev = this.pending[0];
      let res;
      try { res = await transport(ev); }
      catch { break; }                       // offline — stop, keep order
      if (res.ok) { this.acked.push(ev); this.pending.shift(); }
      else if (res.reason === REJECT.STALE_EPOCH) {
        this.rejected.push({ ev, ...res });   // quarantined server-side
        this.pending.shift();
      } else break;                           // transient — retry later
      results.push(res);
    }
    return { flushed: results.length, remaining: this.pending.length, rejected: this.rejected.length };
  }

  /** Over-boundary checkpoint: a natural, frequent sync point. */
  shouldCheckpoint(ballsThisOver) { return ballsThisOver % CHECKPOINT_EVERY === 0; }
}

// ─────────────────────────────────────────────────────────
//  Deterministic replay — derived state, never stored
// ─────────────────────────────────────────────────────────
/**
 * The handover confirmation state, folded from the log.
 *
 * This used to be its own implementation of the Laws — a second fold beside
 * deriveInnings(), counting runs and rotating strike in its own way. It was a
 * cut-down copy and it had already fallen behind: it knew nothing about
 * penalty runs, nothing about a retirement, and nothing about a `void`. That
 * last one mattered. An over containing one correction replayed to a different
 * total here than in the scorer, which is precisely the disagreement the
 * handover handshake exists to detect — so a corrected over would have made a
 * handover impossible, with both sides certain they were right.
 *
 * There is one fold now. This is a projection of it.
 */
export function replayEvents(events) {
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  // Envelopes carry the event in `payload` and its identity in
  // `idempotencyKey`; that identity is what a void names, so it has to travel
  // into the fold or the correction matches nothing.
  const inn = deriveInnings(ordered.map((e) => ({
    ...(e.payload ?? e),
    ...(e.idempotencyKey != null ? { id: e.idempotencyKey } : {}),
    seq: e.seq,
  })));
  return {
    runs: inn.runs, wickets: inn.wickets, balls: inn.balls,
    striker: inn.striker, nonStriker: inn.nonStriker, bowler: inn.bowler,
    lastSeq: ordered.length ? (ordered[ordered.length - 1].seq ?? 0) : 0,
    ballCount: inn.ballLog.length,
  };
}

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────
/** Short human-readable code the outgoing scorer reads aloud. */
export function handoverCode(matchId, epoch) {
  let h = 2166136261;
  const s = `${matchId}:${epoch}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return String((h >>> 0) % 1_000_000).padStart(6, "0");
}

/** Fields the incoming scorer must confirm against the physical scoreboard. */
export const CONFIRM_FIELDS = ["runs", "wickets", "balls", "striker", "nonStriker", "bowler"];

export function diffConfirmation(truth, confirm) {
  return CONFIRM_FIELDS
    .filter(f => confirm[f] !== undefined && confirm[f] !== truth[f])
    .map(f => ({ field: f, expected: truth[f], got: confirm[f] }));
}

export function fmtOvers(balls) {
  return `${Math.floor(balls / 6)}${balls % 6 ? "." + (balls % 6) : ""}`;
}
