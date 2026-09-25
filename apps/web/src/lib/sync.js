/**
 * SCRBRD — the scorer's connection to the server.
 *
 * Runs a durable outbox: every ball is written to IndexedDB before it counts
 * as recorded, sent when this device holds the scoring token and has a
 * connection, and retried when it does not.
 *
 * WHAT THIS MODULE PROMISES, AND WHAT IT DOES NOT
 * ──────────────────────────────────────────────
 * It promises that a ball the scorer taps is never lost. It does NOT promise
 * that the ball has reached the server, and the scoring surface must never
 * wait for it to. A school ground has no signal; the board updates on tap and
 * the outbox catches up later. Everything here is best-effort by design.
 *
 * There are two separate durable stores under the scorer and they are not
 * redundant:
 *
 *   persist.js  keeps the WHOLE LOG so a reload rebuilds the match. It is what
 *               the scorer is looking at.
 *   this outbox keeps the events NOT YET ACKNOWLEDGED so a reload does not
 *               forget to send them. It is what the rest of the school is
 *               waiting for.
 *
 * A match that is fully synced has an empty outbox and a full log; a phone that
 * has been offline all afternoon has both. Losing either one loses something
 * different.
 *
 * THE OUTBOX EXISTS BEFORE THE TOKEN (SCRBRD-078)
 * ──────────────────────────────────────────────
 * It used to be created only once a claim succeeded, and the claim ran once,
 * on mount. A pad that opened with no signal therefore recorded into its log
 * and nowhere else, and never tried again when the signal came back. Now the
 * outbox opens with the pad, UNATTACHED: everything recorded is queued on disk
 * at once, stamped with the token generation this device last held, and sent
 * only after the device holds the token again — which it keeps trying for,
 * on `online` and on a backing-off timer, for as long as the reason is the
 * network. A refusal (someone else is scoring, a handover is waiting, the
 * match is finished, two logs have forked) is said in words and not asked
 * again on a timer. The rules for attaching are packages/sync attach.mjs.
 *
 * THE LEASE (SCRBRD-078)
 * ─────────────────────
 * The server keeps a device's lease for 90 s after the last write it took.
 * A phone that was offline for longer sent everything it had queued straight
 * into quarantine — the lease check failed for the whole batch — and was told
 * "Sent". Every flush now passes the gate below first: a lease not known to
 * be fresh is checked, a lapsed lease that is still this device's (nobody has
 * claimed since: the generation has not moved) is taken back and the queue
 * goes out under it, and anything else is a stop, in words.
 *
 * THE SESSION (SCRBRD-078)
 * ───────────────────────
 * The API token lives in memory only (lib/api.js says why) and a reload
 * loses it; it also expires. A pad that is signed out says so — "sign in to
 * send 5 balls" — keeps everything queued, and never falls back to anything
 * that is not the server.
 */
import { SyncEngine, indexedDbStorage, tryAttach, tossDecision, RETRY } from "@scrbrd/sync";
import { fromRow, tossFromRow } from "@scrbrd/scoring";
import { api, signedIn } from "./api.js";
import { deviceId } from "./device.js";

const RETRY_MS = 4000;
/** Backoff for an attach that failed for want of the network, capped. */
const ATTACH_BACKOFF = [2000, 5000, 15000, 30000, 60000];
/**
 * How long after the server last extended the lease the gate trusts it. The
 * lease is 90 s. Any loss of signal, or a request that got no answer, ends
 * the trust at once.
 */
const LEASE_TRUST_MS = 45000;

/**
 * What went wrong with a request, as a reason the pad can say.
 * `api()` throws ApiError on a non-2xx and the fetch's own error when there
 * was no answer at all (no signal, a timeout).
 * @param {any} e
 * @returns {string}
 */
export function failureReason(e) {
  if (e?.name === "ApiError") {
    if (e.status === 401) return "session_expired";
    if (e.status >= 500) return "server_error";
    return e.code || `http_${e.status}`;
  }
  if (e?.message === "session_expired") return "session_expired";
  return "unreachable";
}

const online = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/**
 * One pad's connection to the server: its outbox, and the token.
 *
 * `hooks.padLog()` is the pad's log as it is now; `hooks.adopt(log)` replaces
 * it with the server's; `hooks.restore(orphans)` puts back queued events its
 * saved log lost; `hooks.followToss(serverToss)` re-opens the first innings
 * from the server's toss; `hooks.onStatus(status)` is told everything the pad
 * shows. None of them may throw.
 */
export class PadSync {
  /**
   * @param {object} args
   * @param {string} args.matchId
   * @param {string|undefined} args.userId
   * @param {"open"|"restore"} args.intent
   * @param {{padLog: () => any[][], adopt: (log: any[][]) => boolean, restore: (orphans: any[]) => void,
   *          followToss: (toss: any) => void, onStatus: (s: any) => void}} args.hooks
   */
  constructor({ matchId, userId, intent, hooks }) {
    this.matchId = matchId;
    this.userId = userId;
    this.intent = intent;
    this.hooks = hooks;
    /** @type {SyncEngine|null} */
    this.engine = null;
    this.stopped = false;
    /** Why the device is not attached, or why it stopped sending: a reason the pad says in words. */
    this.reason = null;
    /** A stop no timer lifts: a person acts (refusals, a fork, a toss conflict). */
    this.halted = false;
    this.attempt = 0;
    this.leaseAt = 0;
    this.attaching = null;
    this.conflict = null;
    this.timer = null;
    this.retryTimer = null;
    this.onOnline = () => {
      if (this.stopped) return;
      if (this.engine?.attached) { if (!this.halted) this.engine.sync().catch(() => {}); }
      else if (!this.halted) this.attach();
      this.status();
    };
    // Losing the signal changes what the pad can offer (no sign-in without
    // it), so the pad is told. And the lease is no longer known to be live —
    // the server lets it lapse 90 s after the last write it took — so the
    // next flush asks before it sends, however soon the signal comes back.
    this.onOffline = () => {
      if (this.stopped) return;
      this.leaseAt = 0;
      if (!this.engine?.attached && !this.halted && this.reason !== "not_signed_in" && this.reason !== "session_expired") this.reason = "offline";
      this.status();
    };
  }

  /** Open the outbox (unattached) from disk, then try to attach. */
  async open() {
    const device = deviceId();
    const engine = new SyncEngine({
      matchId: this.matchId, deviceId: device, scorerId: this.userId ?? "", epoch: null, innings: 0,
      storage: indexedDbStorage({ matchId: this.matchId, deviceId: device }),
      isOnline: online,
      transport: (id, batch) => this.send(id, batch),
      gate: () => this.gate(),
      settleToss: (toss) => this.settleToss(toss),
      onChange: () => this.status(),
    });
    await engine.init();
    if (this.stopped) return null;
    this.engine = engine;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
    this.timer = setInterval(() => {
      if (this.stopped || this.halted || !engine.attached) return;
      if (engine.pendingCount || engine.toss) engine.sync().catch(() => {});
    }, RETRY_MS);
    this.status();
    return engine;
  }

  /**
   * Try to take the token and attach. Safe to call at any time: one attempt
   * runs at once, an attached pad does nothing, and a failure for want of
   * the network schedules the next try.
   * @param {"open"|"restore"} [intent]  a person's "score on this device" passes "open"
   */
  attach(intent) {
    if (intent) { this.intent = intent; this.halted = false; }
    if (this.stopped || !this.engine || this.engine.attached || this.attaching) return this.attaching;
    this.attaching = this._attach().finally(() => { this.attaching = null; });
    return this.attaching;
  }

  async _attach() {
    const engine = /** @type {SyncEngine} */ (this.engine);
    clearTimeout(this.retryTimer);
    if (!signedIn()) { this.reason = "not_signed_in"; this.halted = false; this.status(); return; }
    if (!online()) { this.reason = "offline"; this.status(); return; }
    this.reason = "attaching"; this.status();
    let r;
    try {
      r = await tryAttach({
        engine, intent: this.intent,
        server: {
          probe: (epoch) => this.probe(epoch),
          log: () => this.serverLog(),
          claim: () => api(`/api/matches/${this.matchId}/session/claim`, { method: "POST", body: { device: deviceId() } }),
        },
        padLog: () => this.hooks.padLog(),
        adopt: (log) => this.hooks.adopt(log),
        restore: (orphans) => this.hooks.restore(orphans),
      });
    } catch (e) {
      r = { ok: false, reason: failureReason(e) };
    }
    if (this.stopped) return;
    this.lastAttach = r;
    if (r.ok) {
      this.reason = null; this.halted = false; this.attempt = 0;
      this.leaseAt = Date.now();
      this.status();
      engine.sync().catch(() => {});
      return;
    }
    this.reason = r.reason;
    if (RETRY.has(r.reason)) {
      this.halted = false;
      const wait = ATTACH_BACKOFF[Math.min(this.attempt, ATTACH_BACKOFF.length - 1)];
      this.attempt += 1;
      this.retryTimer = setTimeout(() => this.attach(), wait);
    } else {
      // An answer a person acts on — a refusal, or a session that has ended
      // (only a sign-in, which reopens the pad, changes that).
      this.halted = true;
    }
    this.status();
  }

  /**
   * The session as the server has it, changing nothing: the heartbeat, which
   * refreshes only a live lease this device already holds.
   * @param {number|null} epoch
   */
  async probe(epoch) {
    const r = await api(`/api/matches/${this.matchId}/session/heartbeat`, {
      method: "POST", body: { device: deviceId(), epoch: epoch ?? 0 },
    });
    return { ok: !!r?.ok, epoch: r?.epoch ?? null, state: r?.state ?? null, reason: r?.reason ?? null };
  }

  /** The server's log for this match, as events, in its order. */
  async serverLog() {
    const r = await api(`/api/matches/${this.matchId}/events`);
    return (r?.events ?? []).map(fromRow);
  }

  /**
   * The gate every flush passes (SCRBRD-078): is this device's lease live,
   * and if it lapsed, is the token still this device's to take back?
   */
  async gate() {
    const engine = /** @type {SyncEngine} */ (this.engine);
    if (Date.now() - this.leaseAt < LEASE_TRUST_MS) return { ok: true };
    let hb;
    try { hb = await this.probe(engine.epoch); }
    catch (e) { throw new Error(failureReason(e), { cause: e }); }
    if (hb.ok) { this.leaseAt = Date.now(); return { ok: true }; }
    if (hb.reason === "match_complete") return this.stop_("match_complete");
    if (hb.state === "handover_pending" || hb.state === "verifying") return { ok: false, reason: hb.state };
    if (hb.epoch === engine.epoch && hb.state === "active") {
      // Lapsed, and nobody has claimed since: the generation has not moved,
      // so this is still this device's token. Take it back; the queue goes
      // out under the new generation (the epoch rule in engine.attach).
      let c;
      try { c = await api(`/api/matches/${this.matchId}/session/claim`, { method: "POST", body: { device: deviceId() } }); }
      catch (e) { throw new Error(failureReason(e), { cause: e }); }
      if (!c?.ok || c.epoch == null) return this.stop_(c?.reason ?? "claim_refused");
      this.leaseAt = Date.now();
      return { ok: true, epoch: c.epoch };
    }
    // Somebody else holds the token now. Nothing more goes out from here.
    return this.stop_("token_moved");
  }

  /**
   * The token is not this device's to use: stop sending, keep everything
   * queued, and say why.
   * @param {string} reason
   */
  stop_(reason) {
    this.halted = true;
    this.reason = reason;
    this.engine?.detach(reason);
    return { ok: /** @type {false} */ (false), reason };
  }

  /**
   * One batch to the server. A 401 is a session that has ended (a reload, or
   * the token's own expiry) and says so; everything the server did not take
   * as this device's (quarantine) makes the gate ask about the lease next time.
   * @param {string} id
   * @param {any[]} batch
   */
  async send(id, batch) {
    let res;
    try { res = await api(`/api/matches/${id}/events`, { method: "POST", body: { events: batch } }); }
    catch (e) {
      const why = failureReason(e);
      // The session has ended: nothing will send until the scorer signs in
      // again (which reopens the pad), so the timer stops asking.
      if (why === "session_expired") { this.reason = "session_expired"; this.halted = true; }
      // No answer: the lease may have lapsed meanwhile, so it is asked about
      // before the next try.
      this.leaseAt = 0;
      throw new Error(why, { cause: e });
    }
    if ((res?.quarantined ?? []).length) this.leaseAt = 0;
    else if ((res?.accepted ?? []).length) this.leaseAt = Date.now();
    return res;
  }

  /**
   * A toss answered on this pad, settled against the server's before any
   * event goes out (SCRBRD-075). The rule is tossDecision's.
   * @param {{wonBy: "home"|"away", decision: "bat"|"bowl"}} mine
   */
  async settleToss(mine) {
    let rows;
    try { ({ rows } = await api("/api/read/matches")); }
    catch (e) { throw new Error(failureReason(e), { cause: e }); }
    const server = tossFromRow((rows ?? []).find((r) => r.id === this.matchId));
    let serverHasEvents = false;
    if (!server || server.wonBy !== mine.wonBy || server.decision !== mine.decision) {
      try { serverHasEvents = (await this.serverLog()).length > 0; }
      catch (e) { throw new Error(failureReason(e), { cause: e }); }
    }
    const d = tossDecision({ mine, server, serverHasEvents, log: this.hooks.padLog() });
    if (d.action === "settled") return { settled: /** @type {true} */ (true) };
    if (d.action === "send") {
      try {
        await api(`/api/matches/${this.matchId}/toss`, { method: "POST", body: { wonBy: mine.wonBy, decision: mine.decision } });
        return { settled: /** @type {true} */ (true) };
      } catch (e) {
        // Frozen between the read and the write: something reached the
        // match first. A person settles it; nothing is sent after it.
        if (e?.status === 409) return this.tossStop({ mine, server: null, serverHasEvents: true }, "toss_locked");
        throw new Error(failureReason(e), { cause: e });
      }
    }
    if (d.action === "follow") {
      this.conflict = { mine, server, serverHasEvents, reason: "toss_followed" };
      this.hooks.followToss(server);
      this.status();
      return { settled: /** @type {true} */ (true) };
    }
    return this.tossStop({ mine, server, serverHasEvents }, d.reason);
  }

  /**
   * Two tosses and no rule to choose: stop sending, keep everything, say so.
   * @param {{mine: any, server: any, serverHasEvents: boolean}} c
   * @param {string} reason
   */
  tossStop(c, reason) {
    this.conflict = { ...c, reason };
    this.halted = true;
    this.reason = reason;
    this.status();
    return { settled: /** @type {false} */ (false), reason };
  }

  /**
   * The device now holds the token under this generation without a claim of
   * its own here: a completed takeover (verifyTakeover's epoch), or the
   * arming device's cancel (its claim's epoch). What the server has is
   * marked, so nothing it sent is queued again. `rebase` when what is queued
   * here is this device's continuation of the server's log — its own cancel,
   * or a takeover where the server had nothing the pad lacked; not when the
   * pad took the server's log over its own, where anything queued under an
   * older token goes to quarantine by the epoch rule (engine.jsx decides).
   * @param {number} epoch
   * @param {any[]} [serverEvents]
   * @param {{rebase?: boolean}} [opts]
   */
  async reattach(epoch, serverEvents = [], { rebase = false } = {}) {
    const engine = this.engine;
    if (!engine || this.stopped) return;
    clearTimeout(this.retryTimer);
    await engine.markSent(serverEvents.map((e) => e?.id).filter((x) => x != null));
    await engine.attach(epoch, { rebase });
    this.reason = null; this.halted = false; this.attempt = 0;
    this.leaseAt = Date.now();
    this.status();
    engine.sync().catch(() => {});
  }

  /** This device handed the match over: it sends nothing more. */
  handedOver() {
    this.halted = true;
    this.reason = "handed_over";
    this.engine?.detach("handed_over");
    this.status();
  }

  /** Tell the pad what to say. */
  status() {
    if (this.stopped) return;
    const e = this.engine;
    this.hooks.onStatus({
      open: !!e,
      attached: !!e?.attached,
      attaching: this.reason === "attaching",
      reason: e?.attached ? (e.lastError ?? null) : this.reason,
      halted: this.halted,
      online: online(),
      signedIn: signedIn(),
      pending: e?.pendingCount ?? 0,
      pendingList: e ? e.pending.slice() : [],
      held: e?.heldCount ?? 0,
      heldList: e ? e.held.slice() : [],
      heldReason: e?.held?.length ? e.held[e.held.length - 1].reason : null,
      rejected: e?.rejected?.length ?? 0,
      syncing: !!e?.syncing,
      tossPending: !!e?.toss,
      conflict: this.conflict,
      reconcile: this.lastAttach?.reconcile ?? null,
      cleared: !!e?.cleared,
    });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.retryTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
  }
}
