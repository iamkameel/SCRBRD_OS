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
// Offered to the server: written for each event, by key, BEFORE the request
// that carries it goes out, and never removed. The one fact undo needs that
// the queue alone cannot give — an event still pending may already be in the
// server's log (its request timed out after the server wrote it), and after a
// reload the pad re-offers its whole log, so "pending" also names events the
// server acknowledged in an earlier session (SCRBRD-074, SCRBRD-075).
const kSent = (/** @type {string} */ key) => `sent:${key}`;
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
    // Every key this device has ever put in a request for this match
    // (persisted under `sent:`). Membership is decided before the request
    // leaves, synchronously, so an undo in the same tick already sees it.
    /** @type {Set<string>} */
    this.sent = new Set();
    this.syncing = false;
    /** @type {Promise<any>|null} the flush in progress, which a second sync() call waits on */
    this._inflight = null;
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
    for (const i of await this.storage.list("sent:")) this.sent.add(i.key.slice("sent:".length));
    const meta = await this.storage.get(kMeta);
    const persistedSeq = meta ? Number(typeof meta === "string" ? meta : meta.value ?? meta) : 0;
    this.clientSeq = Math.max(persistedSeq, this.pending.length ? this.pending[this.pending.length - 1].clientSeq : 0);
    // Events queued under the token generation just before this one are this
    // device's own, carried across its own reclaim: every claim, transfer and
    // force-release bumps the epoch by exactly one, so `epoch - 1` means
    // nobody else held the token in between and the server's log has not
    // moved except by this device. They go out under the token it holds now.
    // Left stale, the first of them decides the lease check for the whole
    // batch (events-api reads events[0].epoch), so every ball the scorer
    // queued offline — and every one re-offered behind them — went to
    // quarantine on the first reload with signal. Anything older is left as
    // it is: another device held the token since, and quarantine is what
    // those are for (SCORING_HANDOVER_SPEC §4). The epoch is not part of an
    // event's fingerprint, so a restamped resend of an event the server
    // already has is still a duplicate, not a conflict.
    for (const ev of this.pending) {
      if (ev.epoch !== this.epoch - 1) continue;
      ev.epoch = this.epoch;
      await this.storage.put(kEvt(ev.clientSeq), JSON.stringify(ev));
    }
    this._emit();
    return { recovered: this.pending.length };
  }

  get pendingCount() { return this.pending.length; }
  /** Handover is only safe when nothing is left unsynced (§ handover spec). */
  get safeToHandOver() { return this.pending.length === 0; }

  get heldCount() { return this.held.length; }

  /**
   * Did the server answer for this event and write nothing? (Refused, or a
   * conflicting id — see `held`.)
   * @param {string} key
   * @returns {boolean}
   */
  isHeld(key) { return this.held.some(h => h.idempotencyKey === key); }

  /**
   * Has this event never left the device? True only for an event in the
   * queue that has never been put in a request, by this session or any
   * earlier one on this device. Everything else may be on the server: an
   * event in flight, one whose request failed without an answer (the server
   * may have written it before the connection dropped), one acknowledged in
   * an earlier session and re-offered since, and one the queue has not been
   * handed yet.
   *
   * This is the fact undo's NOT SYNCED rule rests on (undo.mjs), and
   * `withdraw` asks it again, in the same tick, before it acts.
   *
   * It relies on what the pad guarantees today: every event it offers the
   * queue was minted on this device. A log replayed FROM the server (the
   * incoming device at a handover, SCRBRD-075) must mark those keys sent
   * before offering them, or they would read as never sent.
   * @param {string} key
   * @returns {boolean}
   */
  isUnsent(key) { return !this.sent.has(key) && this.pending.some(e => e.idempotencyKey === key); }

  /**
   * Take back an event that has never left this device: the undo of a ball
   * nobody else has seen (undo.mjs, NOT SYNCED). It leaves the queue in
   * memory at once — before the first await, so no flush that starts after
   * this call can carry it — and then leaves storage.
   *
   * Refused (false) when the event is not unsent: in flight, in a request
   * that never answered, acknowledged, held, or not queued at all. The
   * caller undoes it with a `void` instead, which is right whatever the
   * server holds. That is the whole of the mid-flush rule: an event the
   * server may have accepted is never withdrawn, and nothing waits on the
   * network to decide.
   *
   * ORDER. The caller saves its log only once this has resolved. A crash
   * between the two leaves the event in the pad's saved log and out of the
   * queue; the next start re-offers the log, so it is queued and sent again
   * — the pad shows it and the server has it, and only the undo is lost.
   * The other order could leave it out of the log and still in the queue:
   * sent, and not shown. That is the divergence this exists to prevent.
   *
   * If storage refuses the delete, the event goes back in the queue and the
   * promise rejects: the copy on disk will be sent, so the caller must put
   * the event back in its log.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  async withdraw(key) {
    if (!this.isUnsent(key)) return false;
    const gone = this.pending.filter(e => e.idempotencyKey === key);
    this.pending = this.pending.filter(e => e.idempotencyKey !== key);
    this._emit();
    try {
      for (const ev of gone) await this.storage.delete(kEvt(ev.clientSeq));
    } catch (e) {
      this.pending = [...this.pending, ...gone].sort((a, b) => a.clientSeq - b.clientSeq);
      this._emit();
      throw e;
    }
    return true;
  }

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
    // An event this device already holds is not recorded twice. The pad
    // offers its whole log to the queue whenever it (re)attaches — it cannot
    // know what an earlier session sent — so without this a reload would
    // send every held event again, be refused again, and hold a second copy
    // under the same key: the Refused count doubling on every reload, and a
    // person asked to resolve the same event twice (SCRBRD-070). A held
    // event leaves only by a person's hand (discardHeld); recording it again
    // is a NEW event with a new id (held.mjs recordAgain), which passes.
    //
    // The same for an event already waiting in the queue: after a reload the
    // queue rehydrates from disk AND the pad re-offers its log, and a second
    // copy under one key doubled the pending count and would outlive a
    // withdrawal of the first.
    const known = payload?.id != null
      ? this.held.find(h => h.idempotencyKey === payload.id) ?? this.pending.find(e => e.idempotencyKey === payload.id)
      : null;
    if (known) return known;
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
   *
   * A call while a flush is out waits for THAT flush and answers with its
   * result, rather than returning at once as if there were nothing to do:
   * `await engine.sync()` then always means a flush has settled. (It used to
   * be true only by luck of timing — the flush started by record() usually
   * finished within the microtasks a caller's await took, and the sent
   * markers written before each request make that no longer so.)
   * @returns {Promise<{flushed: number, remaining: number, offline?: boolean, rejected?: number, held?: number}>}
   */
  sync() {
    if (this._inflight) return this._inflight;
    if (this.pending.length === 0) return Promise.resolve({ flushed: 0, remaining: 0 });
    if (!this.isOnline()) return Promise.resolve({ flushed: 0, remaining: this.pending.length, offline: true });
    const p = this._flush().finally(() => { if (this._inflight === p) this._inflight = null; });
    this._inflight = p;
    return p;
  }

  /** One flush; only sync() starts it. */
  async _flush() {
    this.syncing = true; this._emit();
    let flushed = 0;
    try {
      const batch = this.pending.slice();          // ordered
      // Sent is decided here, before the first await: from this line on an
      // undo of any of these is a void (isUnsent, withdraw). Then it is made
      // durable, and only then does the request go out — a crash after the
      // request left and before its marker was written would leave an event
      // the server may hold looking as if it had never left.
      const fresh = batch.filter(ev => !this.sent.has(ev.idempotencyKey));
      for (const ev of fresh) this.sent.add(ev.idempotencyKey);
      for (const ev of fresh) await this.storage.put(kSent(ev.idempotencyKey), "1");
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
