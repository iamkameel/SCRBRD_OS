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
export class MatchHub {
  constructor() { this.rooms = new Map(); } // matchId -> Set<send>

  /** Subscribe a connection to a match. Returns an unsubscribe fn. */
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

  roomSize(matchId) { return this.rooms.get(matchId)?.size || 0; }

  /** Best-effort fanout. A throwing/broken subscriber never affects the others. */
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

  /** New ball events landed — full payloads so watchers apply without a round-trip. */
  broadcastEvents(matchId, events) {
    if (!events?.length) return 0;
    return this.publish(matchId, {
      type: "events",
      matchId,
      uptoSeq: Math.max(...events.map(e => e.seq)),
      events,
    });
  }

  /** Session/handover transition (claim, armed, verifying, complete, released). */
  broadcastSession(matchId, session) {
    return this.publish(matchId, { type: "session", matchId, ...session });
  }
}

/**
 * Wrap appendEvents so a successful write also broadcasts the committed balls.
 * Keeps events-api decoupled: the hub is injected here, not inside the writer.
 */
export function makeCommitAndBroadcast(appendEvents, hub) {
  return async (pool, secret, bearer, matchId, events, deps) => {
    const out = await appendEvents(pool, secret, bearer, matchId, events, deps);
    // Zip accepted seqs back onto the full request events for a rich broadcast.
    const bySeq = new Map(out.accepted.map(a => [a.idempotencyKey, a.seq]));
    const committed = events
      .filter(e => bySeq.has(e.idempotencyKey))
      .map(e => ({ seq: bySeq.get(e.idempotencyKey), epoch: e.epoch, innings: e.innings || 0, payload: e.payload }));
    hub.broadcastEvents(matchId, committed);
    return out;
  };
}
