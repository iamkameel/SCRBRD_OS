/**
 * SCRBRD — Realtime hub (Step 5, server)
 *
 * Transport-agnostic per-match pub/sub. A WebSocket or SSE adapter provides a
 * `send(msg)` per connection; the hub fans out ball events and session/handover
 * transitions to everyone watching a match — spectator live pages and a second
 * scorer's device.
 *
 * Broadcasts carry `seq` so a client can detect a gap and catch up via
 * readEvents(?since=). The hub is best-effort delivery; correctness never
 * depends on it — the event log + since-cursor is the source of truth.
 */
/** One connection's way to be told something. @typedef {(msg: unknown) => void} Send */

export class MatchHub {
  constructor() { /** @type {Map<string, Set<Send>>} */ this.rooms = new Map(); } // matchId -> Set<send>

  /**
   * Subscribe a connection to a match. Returns an unsubscribe fn.
   * @param {string} matchId @param {Send} send
   */
  subscribe(matchId, send) {
    let room = this.rooms.get(matchId);
    if (!room) { room = new Set(); this.rooms.set(matchId, room); }
    room.add(send);
    return () => {
      const r = this.rooms.get(matchId);
      if (!r) return;
      r.delete(send);
      if (r.size === 0) this.rooms.delete(matchId);
    };
  }

  roomSize(/** @type {string} */ matchId) { return this.rooms.get(matchId)?.size || 0; }

  /**
   * Best-effort fanout. A throwing/broken subscriber never affects the others.
   * @param {string} matchId @param {unknown} msg
   */
  publish(matchId, msg) {
    const room = this.rooms.get(matchId);
    if (!room) return 0;
    let delivered = 0;
    for (const send of room) {
      try { send(msg); delivered++; }
      catch { /* drop; the socket adapter will clean up on its own close event */ }
    }
    return delivered;
  }

  /**
   * New ball events landed — full payloads so watchers apply without a round-trip.
   * @param {string} matchId @param {{ seq: number, [k: string]: unknown }[] | null | undefined} events
   */
  broadcastEvents(matchId, events) {
    if (!events?.length) return 0;
    return this.publish(matchId, {
      type: "events",
      matchId,
      uptoSeq: Math.max(...events.map(e => e.seq)),
      events,
    });
  }

  /**
   * Session/handover transition (claim, armed, verifying, complete, released).
   * @param {string} matchId @param {Record<string, unknown>} session
   */
  broadcastSession(matchId, session) {
    return this.publish(matchId, { type: "session", matchId, ...session });
  }
}

/**
 * Wrap appendEvents so a successful write also broadcasts the committed balls.
 * Keeps events-api decoupled: the hub is injected here, not inside the writer.
 *
 * `events` are the request's envelopes as the client sent them, and
 * `accepted` is appendEvents' answer — both typed loosely, since the shapes
 * are events-api's to own.
 * @template {{ accepted: { idempotencyKey: string, seq: number }[] }} R
 * @param {(pool: any, secret: string, bearer: string | undefined, matchId: string, events: any[], deps?: any) => Promise<R>} appendEvents
 * @param {MatchHub} hub
 */
export function makeCommitAndBroadcast(appendEvents, hub) {
  /**
   * @param {any} pool @param {string} secret @param {string | undefined} bearer
   * @param {string} matchId @param {any[]} events @param {any} [deps]
   */
  return async (pool, secret, bearer, matchId, events, deps) => {
    const out = await appendEvents(pool, secret, bearer, matchId, events, deps);
    // Zip accepted seqs back onto the full request events for a rich broadcast.
    const bySeq = new Map(out.accepted.map(a => [a.idempotencyKey, a.seq]));
    const committed = events
      .filter(e => bySeq.has(e.idempotencyKey))
      // filter() kept only keys bySeq has, so get() finds each one.
      .map(e => ({ seq: /** @type {number} */ (bySeq.get(e.idempotencyKey)), epoch: e.epoch, innings: e.innings || 0, payload: e.payload }));
    hub.broadcastEvents(matchId, committed);
    return out;
  };
}
