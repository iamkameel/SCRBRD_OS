/**
 * SCRBRD — the offline outbox.
 *
 * Wraps the queue with DURABILITY. Every ball is written to storage BEFORE it's
 * considered recorded, so a crash / dead battery / accidental refresh mid-over
 * loses nothing — the queue rehydrates on restart and finishes syncing. This is
 * the whole point of the offline path; an in-memory queue would defeat it.
 *
 * Storage is injected (get/put/delete/list) so this is testable in node with an
 * in-memory impl; production uses the IndexedDB adapter (see README).
 *
 * The score shown to the scorer is OPTIMISTIC: derived by replaying local
 * (acked + pending) events, so the board updates on tap, independent of the
 * network. The server log stays the source of truth on reconcile.
 */
import { deriveInnings } from "@scrbrd/scoring";

const CHECKPOINT_EVERY = 6;               // sync at each over boundary
const BACKOFF = [0, 1000, 2000, 5000, 15000, 30000]; // ms, capped
const kEvt  = (/** @type {number} */ n) => `evt:${String(n).padStart(9, "0")}`;
// Held for a person: refused by the server's Laws, or a conflicting identity.
// A separate prefix so init() never rehydrates them into the outbox — sending
// them again would be refused again — and so a restart does not lose them:
// the server wrote NOTHING for these, so this is the only copy there is.
const kHeld = (/** @type {number} */ n) => `held:${String(n).padStart(9, "0")}`;
const kMeta = "meta:clientSeq";

/**
 * Where the queue is made durable. Values are whatever the adapter stores —
 * the engine writes JSON strings, and reads back strings or structured
 * clones — so they are `any` at this boundary on purpose.
 * @typedef {object} OutboxStorage
 * @property {(key: string, value: any) => Promise<unknown>} put
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string) => Promise<unknown>} delete
 * @property {(prefix: string) => Promise<{key: string, value: any}[]>} list
 *
 * One queued ball, as persisted and as sent.
 * @typedef {object} OutboxEvent
 * @property {string} matchId
 * @property {string} deviceId
 * @property {string} scorerId
 * @property {number} epoch
 * @property {number} innings
 * @property {number} clientSeq
 * @property {number} clientTs
 * @property {string} idempotencyKey
 * @property {any} payload            a scoring event, whose shape the scoring package owns
 * @property {number} [seq]           server sequence, once acked
 * @property {string} [reason]        why the server quarantined, refused or conflicted it
 * @property {"conflict"|"refused"} [state]  set on a held event
 *
 * What the server says about a batch.
 * @typedef {object} TransportResult
 * @property {{idempotencyKey: string, seq: number}[]} [accepted]
 * @property {{idempotencyKey: string, seq: number}[]} [duplicates]
 * @property {{idempotencyKey: string, reason: string}[]} [quarantined]
 * @property {{idempotencyKey: string, seq: number|null, reason?: string}[]} [conflicts]  same key, different body (db/36)
 * @property {{idempotencyKey: string, reason: string}[]} [refused]   the Laws refused it; nothing written
 *
 * @typedef {(matchId: string, batch: OutboxEvent[]) => Promise<TransportResult>} Transport
 *
 * @typedef {object} OutboxStatus
 * @property {number} pendingCount
 * @property {boolean} syncing
 * @property {string|null} lastError
 * @property {boolean} online
 * @property {number} heldCount       refused or conflicting events waiting on a person
 */

export class SyncEngine {
  /**
   * @param {object} options
   * @param {string} options.matchId
   * @param {string} options.deviceId
   * @param {string} options.scorerId
   * @param {number} options.epoch
   * @param {number} [options.innings]
   * @param {OutboxStorage} options.storage
   * @param {Transport} options.transport
   * @param {() => boolean} [options.isOnline]
   * @param {() => number} [options.now]
   * @param {(status: OutboxStatus) => void} [options.onChange]
   */
  constructor({ matchId, deviceId, scorerId, epoch, innings = 0,
                storage, transport, isOnline = () => true, now = () => Date.now(), onChange }) {
    this.matchId = matchId; this.deviceId = deviceId; this.scorerId = scorerId;
    this.epoch = epoch; this.innings = innings;
    this.storage = storage; this.transport = transport;
    this.isOnline = isOnline; this.now = now; this.onChange = onChange;

    this.clientSeq = 0;
    /** @type {OutboxEvent[]} */
    this.pending = [];        // persisted, awaiting server ack
    /** @type {OutboxEvent[]} */
    this.acked = [];          // confirmed by server (kept for optimistic replay)
    /** @type {OutboxEvent[]} */
    this.rejected = [];       // stale-epoch / quarantined server-side
    // Refused by the Laws or in conflict with an event already stored under
    // the same id. Unlike `rejected`, the server holds no copy of these —
    // quarantine is a person's decision on the server; these are a person's
    // decision on THIS device. Persisted, and never resent on their own.
    /** @type {Array<any>} each is the queued event plus {state: "refused"|"conflict", reason} */
    this.held = [];
    this.syncing = false;
    /** @type {string|null} */
    this.lastError = null;
    this.attempt = 0;
  }

  /** Rehydrate persisted pending events after a restart. Call once at startup. */
  async init() {
    const items = await this.storage.list("evt:");
    this.pending = items
      .map(i => /** @type {OutboxEvent} */ (typeof i.value === "string" ? JSON.parse(i.value) : i.value))
      .sort((a, b) => a.clientSeq - b.clientSeq);
    this.held = (await this.storage.list("held:"))
      .map(i => (typeof i.value === "string" ? JSON.parse(i.value) : i.value))
      .sort((a, b) => a.clientSeq - b.clientSeq);
    const meta = await this.storage.get(kMeta);
    const persistedSeq = meta ? Number(typeof meta === "string" ? meta : meta.value ?? meta) : 0;
    this.clientSeq = Math.max(persistedSeq, this.pending.length ? this.pending[this.pending.length - 1].clientSeq : 0);
    this._emit();
    return { recovered: this.pending.length };
  }

  get pendingCount() { return this.pending.length; }
  /** Handover is only safe when nothing is left unsynced (§ handover spec). */
  get safeToHandOver() { return this.pending.length === 0; }

  get heldCount() { return this.held.length; }

  _emit() {
    this.onChange?.({ pendingCount: this.pending.length, heldCount: this.held.length,
                      syncing: this.syncing, lastError: this.lastError, online: this.isOnline() });
  }

  /**
   * A person has looked at a held event and let it go. The only way one
   * leaves the device: the engine never drops one by itself.
   * @param {string} idempotencyKey
   */
  async discardHeld(idempotencyKey) {
    const ev = this.held.find(h => h.idempotencyKey === idempotencyKey);
    if (!ev) return false;
    await this.storage.delete(kHeld(ev.clientSeq));
    this.held = this.held.filter(h => h !== ev);
    this._emit();
    return true;
  }

  /**
   * Record a ball. Persists FIRST, then queues. Always succeeds locally — this
   * is what keeps play going with no signal. Returns the event.
   *
   * @param {any} payload  the scoring event
   * @returns {Promise<OutboxEvent>}
   */
  async record(payload) {
    this.clientSeq += 1;
    /** @type {OutboxEvent} */
    const ev = {
      matchId: this.matchId, deviceId: this.deviceId, scorerId: this.scorerId,
      epoch: this.epoch, innings: this.innings, clientSeq: this.clientSeq,
      clientTs: this.now(),
      // An event that already knows its own id keeps it. The two used to be
      // separate — the scorer minted `id` when it appended, the queue minted a
      // key when it sent — and that is one identity too many: a `void` names
      // its target by `id`, the server dedupes and returns `idempotency_key`,
      // so after a round trip the correction pointed at nothing. They are the
      // same concept seen from two sides (see newEventId), and now the same
      // string. The fallback covers callers with no scoring surface behind
      // them, and is unique per device, epoch and position.
      idempotencyKey: payload?.id ?? `${this.deviceId}:${this.epoch}:${this.clientSeq}`,
      payload,
    };
    // Durability barrier: on disk before we consider it recorded.
    await this.storage.put(kEvt(this.clientSeq), JSON.stringify(ev));
    await this.storage.put(kMeta, String(this.clientSeq));
    this.pending.push(ev);
    this._emit();

    // Opportunistic sync; over-boundary is a forced checkpoint.
    if (this.isOnline()) this.sync().catch(() => {});
    return ev;
  }

  /**
   * True at an over boundary — caller may force a checkpoint sync.
   * @param {number} legalBallsThisInnings
   */
  shouldCheckpoint(legalBallsThisInnings) { return legalBallsThisInnings > 0 && legalBallsThisInnings % CHECKPOINT_EVERY === 0; }

  /**
   * Flush pending to the server IN ORDER. Batches all pending in one request.
   * Acked/duplicate → cleared from storage. Quarantined → moved to rejected.
   * Any transient/offline failure stops the flush and preserves order.
   */
  async sync() {
    if (this.syncing || this.pending.length === 0) return { flushed: 0, remaining: this.pending.length };
    if (!this.isOnline()) return { flushed: 0, remaining: this.pending.length, offline: true };
    this.syncing = true; this._emit();
    let flushed = 0;
    try {
      const batch = this.pending.slice();          // ordered
      const res = await this.transport(this.matchId, batch);
      // res: { accepted:[{idempotencyKey,seq}], duplicates:[...], quarantined:[...],
      //        conflicts:[{idempotencyKey,seq,reason}], refused:[{idempotencyKey,reason}] }
      const settled = new Map();
      for (const a of res.accepted || [])   settled.set(a.idempotencyKey, { state: "acked", seq: a.seq });
      for (const d of res.duplicates || []) settled.set(d.idempotencyKey, { state: "acked", seq: d.seq });
      for (const qd of res.quarantined || []) settled.set(qd.idempotencyKey, { state: "rejected", reason: qd.reason });
      // Nothing was written for these. Treating either as acked would tell
      // the scorer the ball is on the server when it is not — the silent
      // drop db/36 exists to end — and leaving it pending would resend it
      // forever and hold the whole outbox (and any handover) behind it.
      for (const c of res.conflicts || []) settled.set(c.idempotencyKey, { state: "conflict", reason: c.reason || "idempotency_conflict" });
      for (const r of res.refused || [])   settled.set(r.idempotencyKey, { state: "refused", reason: r.reason });

      const stillPending = [];
      for (const ev of this.pending) {
        const r = settled.get(ev.idempotencyKey);
        if (!r) { stillPending.push(ev); continue; }      // server didn't reach it — retry
        if (r.state === "conflict" || r.state === "refused") {
          // Move, not delete: the held copy is written before the outbox
          // copy goes, so a crash between the two leaves it in one place or
          // both, never neither.
          const h = { ...ev, state: r.state, reason: r.reason };
          await this.storage.put(kHeld(ev.clientSeq), JSON.stringify(h));
          await this.storage.delete(kEvt(ev.clientSeq));
          this.held.push(h);
          continue;
        }
        await this.storage.delete(kEvt(ev.clientSeq));      // clear persisted copy
        if (r.state === "acked") { this.acked.push({ ...ev, seq: r.seq }); flushed++; }
        else { this.rejected.push({ ...ev, reason: r.reason }); }
      }
      this.pending = stillPending;
      this.lastError = null; this.attempt = 0;
    } catch (e) {
      // `any`, not narrowed: a non-Error with a .message is reported by that
      // message, as it always has been. (A thrown null or undefined would
      // throw again here — noted in the typecheck notes, left as found.)
      this.lastError = /** @type {any} */ (e).message || String(e);
      this.attempt = Math.min(this.attempt + 1, BACKOFF.length - 1);
    } finally {
      this.syncing = false; this._emit();
    }
    return { flushed, remaining: this.pending.length, rejected: this.rejected.length, held: this.held.length };
  }

  /** Delay before the next retry after a failure (exponential, capped). */
  /** @returns {number} */
  get backoffMs() { return BACKOFF[this.attempt]; }

  /**
   * Optimistic score: replay everything the device knows (acked + pending).
   *
   * The same fold the scorer and the server use — deriveInnings() — because a
   * queue that reported the score its own way is a queue that can disagree
   * with the board it sits under. Pending events sort after acked ones, which
   * is their real order: the server has not numbered them yet.
   *
   * Identity travels with each event, since that is what a `void` names. A
   * correction the device has made but not yet sent still has to take its ball
   * back off the board it is showing the scorer.
   */
  score() {
    const all = [...this.acked, ...this.pending]
      .map((e, i) => ({ ...e.payload, id: e.idempotencyKey, seq: e.seq ?? 1e9 + i }))
      .sort((a, b) => a.seq - b.seq);
    return deriveInnings(all);
  }
}

// ── In-memory storage (tests) ──
/** @returns {OutboxStorage & {_dump: () => Map<string, any>}} */
export function memoryStorage() {
  /** @type {Map<string, any>} */
  const m = new Map();
  return {
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async delete(k) { m.delete(k); },
    async list(prefix) { return [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })); },
    _dump: () => m,
  };
}
