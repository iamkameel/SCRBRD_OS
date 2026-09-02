/**
 * SCRBRD — Scoring sync engine (Step 4, client)
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
import { replayEvents } from "../handover/scoring-session.mjs";

const CHECKPOINT_EVERY = 6;               // sync at each over boundary
const BACKOFF = [0, 1000, 2000, 5000, 15000, 30000]; // ms, capped
const kEvt  = n => `evt:${String(n).padStart(9, "0")}`;
const kMeta = "meta:clientSeq";

export class SyncEngine {
  constructor({ matchId, deviceId, scorerId, epoch, innings = 0,
                storage, transport, isOnline = () => true, now = () => Date.now(), onChange }) {
    this.matchId = matchId; this.deviceId = deviceId; this.scorerId = scorerId;
    this.epoch = epoch; this.innings = innings;
    this.storage = storage; this.transport = transport;
    this.isOnline = isOnline; this.now = now; this.onChange = onChange;

    this.clientSeq = 0;
    this.pending = [];        // persisted, awaiting server ack
    this.acked = [];          // confirmed by server (kept for optimistic replay)
    this.rejected = [];       // stale-epoch / quarantined server-side
    this.syncing = false;
    this.lastError = null;
    this.attempt = 0;
  }

  /** Rehydrate persisted pending events after a restart. Call once at startup. */
  async init() {
    const items = await this.storage.list("evt:");
    this.pending = items
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

  _emit() { this.onChange?.({ pendingCount: this.pending.length, syncing: this.syncing, lastError: this.lastError, online: this.isOnline() }); }

  /**
   * Record a ball. Persists FIRST, then queues. Always succeeds locally — this
   * is what keeps play going with no signal. Returns the event.
   */
  async record(payload) {
    this.clientSeq += 1;
    const ev = {
      matchId: this.matchId, deviceId: this.deviceId, scorerId: this.scorerId,
      epoch: this.epoch, innings: this.innings, clientSeq: this.clientSeq,
      clientTs: this.now(),
      idempotencyKey: `${this.deviceId}:${this.epoch}:${this.clientSeq}`,
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

  /** True at an over boundary — caller may force a checkpoint sync. */
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
      // res: { accepted:[{idempotencyKey,seq}], duplicates:[...], quarantined:[...] }
      const settled = new Map();
      for (const a of res.accepted || [])   settled.set(a.idempotencyKey, { state: "acked", seq: a.seq });
      for (const d of res.duplicates || []) settled.set(d.idempotencyKey, { state: "acked", seq: d.seq });
      for (const qd of res.quarantined || []) settled.set(qd.idempotencyKey, { state: "rejected", reason: qd.reason });

      const stillPending = [];
      for (const ev of this.pending) {
        const r = settled.get(ev.idempotencyKey);
        if (!r) { stillPending.push(ev); continue; }      // server didn't reach it — retry
        await this.storage.delete(kEvt(ev.clientSeq));      // clear persisted copy
        if (r.state === "acked") { this.acked.push({ ...ev, seq: r.seq }); flushed++; }
        else { this.rejected.push({ ...ev, reason: r.reason }); }
      }
      this.pending = stillPending;
      this.lastError = null; this.attempt = 0;
    } catch (e) {
      this.lastError = e.message || String(e);
      this.attempt = Math.min(this.attempt + 1, BACKOFF.length - 1);
    } finally {
      this.syncing = false; this._emit();
    }
    return { flushed, remaining: this.pending.length, rejected: this.rejected.length };
  }

  /** Delay before the next retry after a failure (exponential, capped). */
  get backoffMs() { return BACKOFF[this.attempt]; }

  /** Optimistic score: replay everything the device knows (acked + pending). */
  score() {
    const all = [...this.acked, ...this.pending]
      .map((e, i) => ({ seq: e.seq ?? 1e9 + i, payload: e.payload }))  // pending sort after acked
      .sort((a, b) => a.seq - b.seq);
    return replayEvents(all);
  }
}

// ── In-memory storage (tests) ──
export function memoryStorage() {
  const m = new Map();
  return {
    async put(k, v) { m.set(k, v); },
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async delete(k) { m.delete(k); },
    async list(prefix) { return [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })); },
    _dump: () => m,
  };
}
