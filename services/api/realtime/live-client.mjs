/**
 * SCRBRD — Live match stream (Step 5, client)
 *
 * Powers the spectator live-score page and a second scorer's synced view.
 *
 * The subtle part is joining a match in progress without missing or
 * double-applying events. The classic race: fetch history, then subscribe —
 * and lose everything that arrived in between. This does it the robust way:
 *
 *   1. open the stream and BUFFER incoming events (don't apply yet)
 *   2. fetch history via readEvents(?since=lastSeq)
 *   3. apply history, then flush the buffer — de-duped by seq
 *
 * Every apply path is idempotent on seq, so reconnects and overlapping
 * catch-ups can never double-count. A detected gap re-triggers catch-up.
 */
import { replayEvents } from "../handover/scoring-session.mjs";

const BACKOFF = [500, 1000, 2000, 5000, 15000];

export class MatchStream {
  /**
   * @param connect    ({onOpen,onMessage,onClose}) => disconnectFn  (WS/SSE adapter)
   * @param fetchSince (matchId, sinceSeq) => events[]               (GET /events?since=)
   */
  constructor({ matchId, connect, fetchSince, onUpdate, now = () => Date.now() }) {
    this.matchId = matchId;
    this.connect = connect;
    this.fetchSince = fetchSince;
    this.onUpdate = onUpdate;
    this.now = now;

    this.applied = new Map();   // seq -> event  (dedupe + replay source)
    this.lastSeq = 0;
    this.session = null;        // latest session/handover state
    this.buffer = [];           // stream events held during catch-up
    this.buffering = false;
    this.connected = false;
    this.attempt = 0;
    this._disconnect = null;
    this._stopped = false;
  }

  start() { this._stopped = false; this._open(); return this; }

  stop() {
    this._stopped = true;
    try { this._disconnect?.(); } catch { /* ignore */ }
    this._disconnect = null; this.connected = false;
  }

  _open() {
    this.buffering = true;              // buffer until history is caught up
    this.buffer = [];
    this._disconnect = this.connect({
      onOpen: () => { this.connected = true; this.attempt = 0; this._catchUp(); },
      onMessage: msg => this._onMessage(msg),
      onClose: () => { this.connected = false; if (!this._stopped) this._scheduleReconnect(); },
    });
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.type === "session") { this.session = msg; this._emit(); return; }
    if (msg.type === "events") {
      const evs = msg.events || [];
      if (this.buffering) { this.buffer.push(...evs); return; }     // hold during catch-up
      // gap? (we're missing something before these) → re-catch-up
      const minSeq = Math.min(...evs.map(e => e.seq));
      if (minSeq > this.lastSeq + 1) { this._catchUp(); return; }
      this._apply(evs);
    }
  }

  async _catchUp() {
    try {
      const history = await this.fetchSince(this.matchId, this.lastSeq);
      this._apply(history, /*silent*/ true);
    } catch {
      // couldn't fetch history; stay buffering, a reconnect/retry will try again
      if (!this._stopped) this._scheduleReconnect();
      return;
    }
    // flush anything that streamed in while we were catching up
    const held = this.buffer; this.buffer = []; this.buffering = false;
    this._apply(held);
  }

  /** Idempotent on seq — the guarantee that makes joins/reconnects safe. */
  _apply(events, silent = false) {
    let changed = false;
    for (const e of events || []) {
      if (e.seq > this.lastSeq && !this.applied.has(e.seq)) {
        this.applied.set(e.seq, e);
        if (e.seq > this.lastSeq) this.lastSeq = e.seq;
        changed = true;
      } else if (!this.applied.has(e.seq)) {
        // out-of-window but unseen (rare) — keep it so replay is complete
        this.applied.set(e.seq, e);
        changed = true;
      }
    }
    if (changed && !silent) this._emit();
    else if (changed) this._emit();
  }

  _scheduleReconnect() {
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt++;
    this._retryTimer = setTimeout(() => { if (!this._stopped) this._open(); }, delay);
  }
  get backoffMs() { return BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)]; }

  _emit() { this.onUpdate?.({ score: this.score(), session: this.session, lastSeq: this.lastSeq }); }

  /** Current live score, replayed from everything applied so far. */
  score() {
    const ordered = [...this.applied.values()].sort((a, b) => a.seq - b.seq);
    return replayEvents(ordered);
  }
}
