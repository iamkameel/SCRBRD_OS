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
 * A TAKE-OVER IS A PERSON'S ACT (db/126, Kameel 30 Oct 2026)
 * ─────────────────────────────────────────────────────────
 * A claim over a match another device held is refused by the database,
 * `held_elsewhere`, however long ago its lease lapsed. The pad says so with
 * the time of the server's last ball and offers "Take over"; only that press
 * (attach("takeover")) takes it, over the generation shown, and the server
 * writes an audit row. Opening the fixture, or "Try again", never does.
 *
 * THE LEASE (SCRBRD-078)
 * ─────────────────────
 * The server keeps a device's lease for 90 s after the last write it took,
 * or the last heartbeat. The pad HEARTBEATS while it is attached and the page
 * is in view (every HEARTBEAT_MS, the match-day audit's B1, Kameel 30 Oct
 * 2026): a wicket, drinks or the innings break no longer let the lease lapse
 * under a phone that is still scoring. And while attached it holds a screen
 * wake lock where the browser has one, so the screen does not lock between
 * balls (a browser without the Wake Lock API simply goes without).
 *
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
 *
 * THE RESUME CREDENTIAL (SCRBRD-078 option B)
 * ─────────────────────────────────────────
 * Unless it holds this match's resume credential (lib/padKey.js): issued
 * right after a claim made signed in, it signs this match's heartbeat,
 * claim, events and toss read, and nothing else. Once the pad has one, those
 * five go out under it whether or not anybody is signed in — so a reload, or
 * a token that ran out mid-match, changes nothing: the pad re-attaches and
 * sends by itself. When the server says it has ended (midnight, the token
 * moved, the match over, a sign-out, the office), the pad forgets it and
 * falls back to the sign-in if there is one, and otherwise says, in words,
 * that scoring on this phone has ended until somebody signs in. The rest of
 * the app is signed out throughout: nothing else can use it.
 */
import { SyncEngine, indexedDbStorage, tryAttach, tossDecision, padLogFrom, RETRY } from "@scrbrd/sync";
import { fromRow, tossFromRow } from "@scrbrd/scoring";
import { api, signedIn } from "./api.js";
import { deviceId } from "./device.js";
import { isPracticeId } from "./persist.js";
import { padResumeSupported, loadPadCredential, mintPadCredential, forgetPadCredential, padApi, padEnded } from "./padKey.js";

const RETRY_MS = 4000;
/** Backoff for an attach that failed for want of the network, capped. */
const ATTACH_BACKOFF = [2000, 5000, 15000, 30000, 60000];
/** How often a signed-out pad with no server asks again whether there is one. */
const REACH_MS = 5000;
/**
 * How long after the server last extended the lease the gate trusts it. The
 * lease is 90 s. Any loss of signal, or a request that got no answer, ends
 * the trust at once.
 */
const LEASE_TRUST_MS = 45000;
/**
 * How often an attached pad in view tells the server it is still scoring.
 * The lease is 90 s; SCORING_HANDOVER_SPEC §3 asks for ~20 s, which leaves
 * three missed beats of room. A beat is skipped when a send has just
 * refreshed the lease.
 */
const HEARTBEAT_MS = 20000;

/**
 * What went wrong with a request, as a reason the pad can say.
 * `api()` throws ApiError on a non-2xx and the fetch's own error when there
 * was no answer at all (no signal, a timeout).
 * @param {any} e
 * @returns {string}
 */
export function failureReason(e) {
  // Our own Error(reason), thrown by send() and the gate with a reason the
  // pad already says ("unreachable", "pad_ended", …), is that reason.
  if (e && e.name === "Error" && /^[a-z][a-z_]*$/.test(e.message ?? "") && e.cause !== undefined) return e.message;
  if (e?.name === "ApiError") {
    // The resume credential has ended (SCRBRD-078): only a sign-in changes that.
    if (padEnded(e)) return "pad_ended";
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
 * from the server's toss; `hooks.forked(reconcile)` writes the pad's log aside
 * when it has forked from the server's (P5); `hooks.onStatus(status)` is told
 * everything the pad shows. None of them may throw.
 */
export class PadSync {
  /**
   * @param {object} args
   * @param {string} args.matchId
   * @param {string|undefined} args.userId
   * @param {"open"|"restore"|"takeover"} args.intent
   * @param {{padLog: () => any[][], adopt: (log: any[][]) => boolean, restore: (orphans: any[]) => void,
   *          followToss: (toss: any) => void, onStatus: (s: any) => void,
   *          forked?: (reconcile: any) => void | Promise<void>}} args.hooks
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
    /**
     * The server's count of this device's events held for review, at the last
     * read of its log, and how many this session's engine had then (SCRBRD-089;
     * serverLog(), status()). null until the server has been asked.
     * @type {{server: number, seen: number} | null}
     */
    this.review = null;
    /**
     * This match's resume credential (lib/padKey.js): undefined until the
     * store has been asked, null when there is none (or it has ended).
     * @type {any}
     */
    this.pad = undefined;
    /** Why the server ended the last one ("expired", "token_moved", …), or null. */
    this.padEnd = null;
    /** An issue in flight, so two claims do not ask twice. */
    this.minting = null;
    this.timer = null;
    this.retryTimer = null;
    this.hbTimer = null;
    /** A heartbeat in flight. */
    this.beating = false;
    /** The screen wake lock while attached (navigator.wakeLock), and a request in flight. */
    this.wakeLock = null;
    this.waking = false;
    /**
     * The server's last ball, from the last read of its log: its time
     * (server_ts, the figure match_live_score.last_ball_at reports) and seq.
     * @type {{at: string|null, seq: number|null} | null}
     */
    this.serverLast = null;
    /**
     * A refusal a person may confirm past (db/126): another device held this
     * match and its lease lapsed. The generation the person is shown, which
     * is the one "Take over" asks for, and the server's last ball then.
     * @type {{epoch: number|null, at: string|null, seq: number|null} | null}
     */
    this.heldElsewhere = null;
    /**
     * The incoming scorer's note (the audit's P4): this device now holds a
     * match another device scored, and this is how far the server's log got.
     * Shown until the scorer says they have checked it.
     * @type {{at: string|null, seq: number|null} | null}
     */
    this.takeoverNote = null;
    /** Why the outbox could not open (P6): this phone cannot queue anything. */
    this.outboxError = null;
    /** Balls sent for a person's review (P5/P7) in flight, and why the last try failed. */
    this.reviewing = null;
    this.reviewError = null;
    /**
     * Whether the server answered the last time a signed-out pad asked
     * (/api/health, which needs no session): null before it has asked.
     * `navigator.onLine` alone is not the signal: it is true on a phone with
     * a connection that reaches nothing (a ground's weak signal, a captive
     * portal) and, under some browsers, in a tab its service worker serves.
     * A pad that is signed out cannot learn it from a failed claim — it never
     * makes one — so it asks, and offers a sign-in only when the server is
     * there to take it.
     * @type {boolean|null}
     */
    this.reachable = null;
    this.onOnline = () => {
      if (this.stopped) return;
      this.reachable = null;
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

  /**
   * Open the outbox (unattached) from disk, then try to attach.
   *
   * NEVER FOR A PRACTICE MATCH. Its names stay on the phone (lib/practice.js):
   * a pad on one has no outbox, takes no token and sends nothing. The pad does
   * not make one for it; this is the second lock, so that an id that starts
   * `practice-` cannot be put in a queue by any caller, and call() below is
   * the third.
   */
  async open() {
    if (isPracticeId(this.matchId)) { this.stopped = true; return null; }
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
    // The outbox not opening is said, not swallowed (the audit's P6): a
    // storage fault here used to leave the pad saying "On device" all
    // afternoon, queueing nothing and sending nothing, with nobody told.
    // The pad still records into its saved log (persist.js); it says that
    // this phone cannot send, and to score on the other one.
    try {
      await engine.init();
    } catch (e) {
      if (this.stopped) return null;
      this.outboxError = /** @type {any} */ (e)?.name || /** @type {any} */ (e)?.message || "storage_fault";
      this.reason = "outbox_unavailable";
      this.halted = true;
      this.status();
      return null;
    }
    if (this.stopped) return null;
    this.engine = engine;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisible);
    this.timer = setInterval(() => {
      if (this.stopped || this.halted || !engine.attached) return;
      if (engine.pendingCount || engine.toss) engine.sync().catch(() => {});
    }, RETRY_MS);
    this.hbTimer = setInterval(() => { this.heartbeat(); }, HEARTBEAT_MS);
    this.status();
    return engine;
  }

  /** The page came back into view: the screen lock and the lease, at once. */
  onVisible = () => {
    if (this.stopped || typeof document === "undefined" || document.visibilityState !== "visible") return;
    this.heartbeat({ now: true });
    this.status();
  };

  /**
   * The heartbeat (B1): while attached, not halted, in view and online, tell
   * the server this device is still scoring. The gate does the asking — a
   * live lease is extended, this device's own lapsed one is taken back, and
   * a token another device holds now stops the pad in words — so a beat and
   * a flush judge the token by one rule. Skipped while a flush is out, or
   * when a send has just refreshed the lease.
   * @param {{now?: boolean}} [opts]
   */
  async heartbeat({ now = false } = {}) {
    const engine = this.engine;
    if (this.stopped || this.halted || !engine?.attached || this.beating || engine.syncing) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (!online()) return;
    if (!now && Date.now() - this.leaseAt < HEARTBEAT_MS - 5000) return;
    this.beating = true;
    try {
      this.leaseAt = 0;
      const g = await this.gate();
      if (g.ok && g.epoch != null && g.epoch !== engine.epoch) await engine.attach(g.epoch);
      if (g.ok && (engine.pendingCount || engine.toss)) engine.sync().catch(() => {});
    } catch { /* no answer: the next beat, or the next flush, asks again */ }
    finally { this.beating = false; this.status(); }
  }

  /**
   * Hold the screen awake while this device holds the token (Kameel, 30 Oct
   * 2026: the Wake Lock API, a browser API, not a dependency). The browser
   * lets it go when the page is hidden; it is asked again when the page is
   * back. A browser without it, or one that refuses, goes on without it.
   */
  holdWake() {
    if (this.stopped || this.wakeLock || this.waking) return;
    if (typeof navigator === "undefined" || typeof navigator.wakeLock?.request !== "function") return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    this.waking = true;
    navigator.wakeLock.request("screen").then((lock) => {
      if (this.stopped || !this.engine?.attached) { lock.release().catch(() => {}); return; }
      this.wakeLock = lock;
      lock.addEventListener?.("release", () => { if (this.wakeLock === lock) this.wakeLock = null; });
    }).catch(() => { /* refused (battery saver, no permission): the pad works without it */ })
      .finally(() => { this.waking = false; });
  }

  releaseWake() {
    const lock = this.wakeLock;
    this.wakeLock = null;
    lock?.release?.().catch?.(() => {});
  }

  /**
   * Try to take the token and attach. Safe to call at any time: one attempt
   * runs at once, an attached pad does nothing, and a failure for want of
   * the network schedules the next try.
   * @param {"open"|"restore"|"takeover"} [intent]  a person's "score on this device" passes "open";
   *        "takeover" only from the confirmed Take over (db/126), over heldElsewhere's generation
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
    // Signed out, with no credential to sign by: a sign-in is the only way
    // on — and when the credential this pad had has ended, the pad says so.
    if (!signedIn() && !(await this.padRecord())) {
      this.reason = this.padEnd ? "pad_ended" : "not_signed_in";
      this.halted = false; this.status(); await this.checkReach(); return;
    }
    if (!online()) { this.reason = "offline"; this.status(); return; }
    this.reason = "attaching"; this.status();
    let r;
    const intent = this.intent;
    // A take-over is asked once, for the press that confirmed it: a retry
    // on a timer, or the next attach, is a plain claim again.
    if (intent === "takeover") this.intent = "open";
    try {
      r = await tryAttach({
        engine, intent, takeoverEpoch: intent === "takeover" ? (this.heldElsewhere?.epoch ?? null) : null,
        server: {
          probe: (epoch) => this.probe(epoch),
          log: () => this.serverLog(),
          claim: (opts) => this.claimCall(opts),
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
      this.heldElsewhere = null;
      // The incoming scorer is told how far the server got (P4): this device
      // took the server's log, or the session had moved on since it last
      // held it — a take-over, a claim after a force-release.
      if ((r.adopted || r.followed) && this.serverLast?.at) this.takeoverNote = { ...this.serverLast };
      this.status();
      engine.sync().catch(() => {});
      return;
    }
    if (intent === "takeover" && r.reason === "held_elsewhere") this.intent = "open";
    if (r.reason === "held_elsewhere") this.heldElsewhere = { epoch: r.sessionEpoch ?? null, ...(this.serverLast ?? { at: null, seq: null }) };
    // A fork keeps this device's balls for the lead: written aside at once
    // (Kameel, 30 Oct 2026, as the handover path does), listed in words.
    if (r.reason === "fork" && r.reconcile) { try { await this.hooks.forked?.(r.reconcile); } catch { /* the banner still lists them */ } }
    // A finished match takes nothing more into its log; what this device
    // still has queued goes to the lead's review rather than nowhere (P7).
    if (r.reason === "match_complete" && engine.pendingCount) this.forReview();
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
   * Signed out: is the server there? Asked of /api/health, and asked again
   * every REACH_MS for as long as it is not (one small unauthenticated GET).
   * The pad then says "no signal" rather than offering a sign-in that cannot
   * reach anyone, and offers it the moment the server answers. A sign-in
   * reopens the pad, which ends this.
   */
  async checkReach() {
    if (!online()) { this.reachable = false; this.status(); return; }
    let ok;
    try { await api("/api/health", { timeoutMs: 3000 }); ok = true; } catch { ok = false; }
    if (this.stopped || signedIn()) return;
    this.reachable = ok;
    this.status();
    if (!ok) {
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => { if (!this.stopped && !signedIn()) this.checkReach(); }, REACH_MS);
    }
  }

  /**
   * The session as the server has it, changing nothing: the heartbeat, which
   * refreshes only a live lease this device already holds.
   * @param {number|null} epoch
   */
  async probe(epoch) {
    const r = await this.call(`/api/matches/${this.matchId}/session/heartbeat`, {
      method: "POST", body: { device: deviceId(), epoch: epoch ?? 0 },
    });
    return { ok: !!r?.ok, epoch: r?.epoch ?? null, state: r?.state ?? null, reason: r?.reason ?? null };
  }

  /**
   * The server's log for this match, as events, in its order.
   *
   * It also says how many of this device's events the server holds for
   * review (SCRBRD-089): the count the pill's "For review N" is, which used
   * to live only in the memory of the session that sent them. Taken as of
   * this read, beside how many this session's engine had counted by then, so
   * the pill is the server's count plus whatever this session sends to
   * review after it — never the same event twice (see status()).
   */
  async serverLog() {
    const r = await this.call(`/api/matches/${this.matchId}/events`);
    if (Number.isInteger(r?.quarantined)) {
      this.review = { server: r.quarantined, seen: this.engine?.rejected?.length ?? 0 };
    }
    const rows = r?.events ?? [];
    // The server's last ball, as the read gave it (P4, B1): its server time
    // and seq. fromRow keeps neither — the pad's events do not carry them.
    const last = [...rows].reverse().find((x) => x?.kind === "ball") ?? null;
    this.serverLast = last ? { at: last.server_ts ?? null, seq: last.seq ?? null } : { at: null, seq: null };
    return rows.map(fromRow);
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
    if (hb.reason === "match_complete") {
      // A result declared while this pad still had balls to send (P7): they
      // never reach the log, but they reach the lead — sent for review, where
      // the server files them under match_complete, rather than kept on this
      // phone with no road anywhere. The flush stops here; the review send
      // waits for it.
      const r = this.stop_("match_complete");
      if (engine.pendingCount) this.forReview();
      return r;
    }
    if (hb.state === "handover_pending" || hb.state === "verifying") return { ok: false, reason: hb.state };
    if (hb.epoch === engine.epoch && hb.state === "active") {
      // Lapsed, and nobody has claimed since: the generation has not moved,
      // so this is still this device's token. Take it back; the queue goes
      // out under the new generation (the epoch rule in engine.attach).
      let c;
      try { c = await this.claimCall(); }
      catch (e) {
        const why = failureReason(e);
        if (why === "pad_ended") return this.stop_(why);
        throw new Error(why, { cause: e });
      }
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
    this.releaseWake();
    return { ok: /** @type {false} */ (false), reason };
  }

  /**
   * What this device still has queued, sent for a person's review (P5, P7):
   * unattached and as stamped, so the server writes it to quarantine, where
   * the lead sees it, releases it or rejects it. Only after the server has
   * said the match is complete, or that its log holds another device's
   * events this one lacks (a fork). One at a time.
   */
  forReview() {
    const engine = this.engine;
    if (!engine || this.stopped || this.reviewing) return this.reviewing;
    this.reviewing = (async () => {
      try { await engine.sendForReview(); this.reviewError = null; }
      catch (e) { this.reviewError = failureReason(e); }
      finally { this.reviewing = null; this.status(); }
    })();
    this.status();
    return this.reviewing;
  }

  /**
   * A fork, settled from this phone (P5): its balls the server lacks go to
   * the lead's review (quarantine), its whole log stays written aside (the
   * fork already did that), and the pad takes the server's log and asks to
   * score on it — a plain claim, so a take-over is still a person's
   * confirmed act. Nothing is merged: the balls reach the scorebook only if
   * the lead releases them, or somebody types them in on the holding phone.
   */
  async settleFork() {
    const engine = this.engine;
    if (!engine || this.stopped || engine.attached || this.reason !== "fork") return;
    const r = this.lastAttach?.reconcile;
    this.reason = "fork_settling"; this.status();
    try {
      if (r) await this.hooks.forked?.(r);
      // The toss this phone answered belongs to the log it sets aside.
      await engine.setTossAside();
      if (engine.pendingCount) await engine.sendForReview();
      // Every ball is the lead's now, or it stays here: a refusal (held) or a
      // ball the server did not reach keeps the pad on its own log.
      if (engine.pendingCount) throw new Error("not_all_sent");
      const server = await this.serverLog();
      await engine.markSent(server.map((e) => e?.id).filter((id) => id != null));
      if ((await this.hooks.adopt(padLogFrom(server))) === false) throw new Error("busy");
    } catch (e) {
      const m = /** @type {any} */ (e)?.message;
      this.reviewError = m === "not_all_sent" || m === "busy" ? m : failureReason(e);
      this.reason = "fork"; this.halted = true; this.status();
      return;
    }
    this.reviewError = null;
    this.attach("open");
  }

  /** The incoming scorer has checked the server's last ball against the book. */
  dismissNote() { this.takeoverNote = null; this.status(); }

  /**
   * One batch to the server. A 401 is a session that has ended (a reload, or
   * the token's own expiry) and says so; everything the server did not take
   * as this device's (quarantine) makes the gate ask about the lease next time.
   * @param {string} id
   * @param {any[]} batch
   */
  async send(id, batch) {
    let res;
    try { res = await this.call(`/api/matches/${id}/events`, { method: "POST", body: { events: batch } }); }
    catch (e) {
      const why = failureReason(e);
      // The session has ended, or the resume credential has: nothing will
      // send until the scorer signs in again (which reopens the pad), so the
      // timer stops asking.
      if (why === "session_expired" || why === "pad_ended") { this.reason = why; this.halted = true; }
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
    // This match's toss only — which the resume credential may read, where
    // every fixture's (/api/read/matches) it may not.
    let row;
    try { ({ toss: row } = await this.call(`/api/matches/${this.matchId}/toss`)); }
    catch (e) { throw new Error(failureReason(e), { cause: e }); }
    const server = tossFromRow(row);
    let serverHasEvents = false;
    if (!server || server.wonBy !== mine.wonBy || server.decision !== mine.decision) {
      try { serverHasEvents = (await this.serverLog()).length > 0; }
      catch (e) { throw new Error(failureReason(e), { cause: e }); }
    }
    const d = tossDecision({ mine, server, serverHasEvents, log: this.hooks.padLog() });
    if (d.action === "settled") return { settled: /** @type {true} */ (true) };
    if (d.action === "send") {
      // Written under whichever credential call() picks: the resume
      // credential may write its match's toss while the token is this
      // device's (db/126, Kameel 30 Oct 2026), so a toss answered with no
      // signal no longer waits for a sign-in that ran out mid-innings. With
      // neither a credential nor a sign-in, the pad asks for a sign-in.
      if (!signedIn() && !(await this.padRecord())) return { settled: /** @type {false} */ (false), reason: "toss_needs_sign_in" };
      try {
        await this.call(`/api/matches/${this.matchId}/toss`, { method: "POST", body: { wonBy: mine.wonBy, decision: mine.decision } });
        return { settled: /** @type {true} */ (true) };
      } catch (e) {
        // Frozen between the read and the write: something reached the
        // match first. A person settles it; nothing is sent after it.
        if (/** @type {any} */ (e)?.code === "toss_locked" || (/** @type {any} */ (e)?.status === 409 && !/** @type {any} */ (e)?.code)) {
          return this.tossStop({ mine, server: null, serverHasEvents: true }, "toss_locked");
        }
        // The token moved under the credential: nothing more goes from here.
        if (/** @type {any} */ (e)?.code === "token_moved") return { settled: /** @type {false} */ (false), reason: this.stop_("token_moved").reason };
        const why = failureReason(e);
        if (why === "session_expired" || why === "pad_ended") { this.reason = why; this.halted = true; }
        throw new Error(why, { cause: e });
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
    // A takeover is a claim: this device holds the token now, signed in.
    if (!(await this.padRecord()) && signedIn()) this.ensurePad();
  }

  // ── The resume credential (SCRBRD-078 option B) ─────────────────

  /** This match's credential, read from the device once. */
  async padRecord() {
    if (this.pad === undefined) this.pad = await loadPadCredential(this.matchId);
    return this.pad;
  }

  /**
   * One request to this match's pad routes: under the resume credential when
   * the pad has one, else under the sign-in. A credential the server says has
   * ended is forgotten here, and the request goes again signed in if somebody
   * is — or fails as "pad_ended" if nobody is.
   * @param {string} path
   * @param {{method?: string, body?: any}} [opts]
   */
  async call(path, opts = {}) {
    if (isPracticeId(this.matchId)) throw new Error("practice_match_stays_on_this_phone");
    const rec = await this.padRecord();
    if (rec) {
      try { return await padApi(rec, path, opts); }
      catch (e) {
        if (!padEnded(e)) throw e;
        this.endPad(/** @type {any} */ (e));
        if (!signedIn()) throw e;
      }
    }
    return api(path, opts);
  }

  /**
   * The claim, under whichever credential call() picks. One made signed in
   * is followed by an issue: that is the moment the pad earns a credential,
   * holding the token on this device.
   */
  /** @param {{takeover: true, epoch: number|null}} [opts] */
  async claimCall(opts) {
    const r = await this.call(`/api/matches/${this.matchId}/session/claim`, { method: "POST", body: { device: deviceId(), ...(opts ?? {}) } });
    if (r?.ok && !this.pad && signedIn()) this.ensurePad();
    return r;
  }

  /** The server ended the credential: forget it here too, and remember why. @param {any} e */
  endPad(e) {
    this.pad = null;
    this.padEnd = e?.detail || e?.code || "ended";
    forgetPadCredential(this.matchId).catch(() => {});
  }

  /** Ask for a credential, once at a time; a page that cannot hold one says so (status). */
  ensurePad() {
    if (this.minting || this.stopped || !padResumeSupported()) { this.status(); return this.minting; }
    this.minting = mintPadCredential(this.matchId)
      .then((rec) => { if (rec && !this.stopped) { this.pad = rec; this.padEnd = null; } })
      .catch(() => { /* the pad goes on signed in; a reload will ask it to sign in again */ })
      .finally(() => { this.minting = null; this.status(); });
    return this.minting;
  }

  /** This device handed the match over: it sends nothing more. */
  handedOver() {
    this.halted = true;
    this.reason = "handed_over";
    this.engine?.detach("handed_over");
    this.releaseWake();
    this.status();
  }

  /** Tell the pad what to say. */
  status() {
    if (this.stopped) return;
    const e = this.engine;
    if (e?.attached) this.holdWake(); else this.releaseWake();
    this.hooks.onStatus({
      open: !!e,
      // The outbox could not open (P6): the banner says this phone cannot send.
      outboxUnavailable: !!this.outboxError,
      attached: !!e?.attached,
      attaching: this.reason === "attaching",
      reason: e?.attached ? (e.lastError ?? null) : this.reason,
      halted: this.halted,
      // Signed out, "online" also means the server answered (checkReach):
      // the pad offers a sign-in only then.
      online: online() && (signedIn() || !!this.pad || this.reachable !== false),
      signedIn: signedIn(),
      // The resume credential: "live" (the pad sends by itself after a
      // reload), "none", or "unavailable" (no secure context: a reload asks
      // for a sign-in); and why the last one ended, if it did.
      padResume: !padResumeSupported() ? "unavailable" : this.pad ? "live" : "none",
      padEnd: this.padEnd,
      pending: e?.pendingCount ?? 0,
      pendingList: e ? e.pending.slice() : [],
      held: e?.heldCount ?? 0,
      heldList: e ? e.held.slice() : [],
      heldReason: e?.held?.length ? e.held[e.held.length - 1].reason : null,
      // For review: the server's count at the last read of its log, plus what
      // this session has sent to review since (SCRBRD-089). With no read yet,
      // what this session sent.
      rejected: this.review
        ? this.review.server + Math.max(0, (e?.rejected?.length ?? 0) - this.review.seen)
        : e?.rejected?.length ?? 0,
      syncing: !!e?.syncing,
      tossPending: !!e?.toss,
      conflict: this.conflict,
      reconcile: this.lastAttach?.reconcile ?? null,
      cleared: !!e?.cleared,
      // B1/P4: the server's last ball, a take-over a person may confirm, and
      // the incoming scorer's note.
      serverLast: this.serverLast,
      heldElsewhere: this.heldElsewhere,
      takeoverNote: e?.attached ? this.takeoverNote : null,
      // P5/P7: balls going to the lead's review, and why the last try did not.
      reviewing: !!this.reviewing,
      reviewError: this.reviewError,
    });
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearInterval(this.hbTimer);
    clearTimeout(this.retryTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisible);
    this.releaseWake();
  }
}
