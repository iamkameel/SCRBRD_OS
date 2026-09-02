# SCRBRD — Scoring Write Path & Offline Queue (Step 4)

The heart of the product, and where the real engineering risk lives. A ball is
recorded to durable local storage first, rendered optimistically, and synced in
the background — so a scorer can keep a full match through dead signal and a dead
battery, and nothing is lost.

## Files

| File | Role |
|---|---|
| `events-api.mjs` | Server: `appendEvents()` / `readEvents()`. Serialises per match, dedupes, allocates seq, quarantines stale-epoch, refreshes the lease. |
| `sync-engine.mjs` | Client: `SyncEngine` — durable persistent queue, ordered flush with backoff, over-boundary checkpoints, optimistic replay score. |
| `indexeddb-storage.mjs` | Browser storage adapter (survives crash/refresh). |
| `write.test.mjs` | 36 assertions — server auth/dedup/seq/quarantine/lease; client crash-recovery, retry, rejection routing, optimistic score. |

Builds on `handover/scoring-session.mjs` (token state machine + replay, 77 tests)
and `auth/` (principal context). Repo layout: `write/`, `handover/`, `auth/` siblings.

## The durability guarantee

```
record(ball)  →  write to IndexedDB  →  add to pending  →  optimistic re-render
                        ▲ barrier: on disk before "recorded"
                                                       ↘ background sync when online
```

A ball is on disk **before** it counts as recorded. If the app dies mid-over,
`SyncEngine.init()` rehydrates the pending queue on restart and finishes syncing —
proven in the tests by constructing a second engine over the same storage after a
simulated crash and recovering all four unsynced balls, with `clientSeq`
continuing so idempotency keys never collide.

## Authorization: the database decides

`appendEvents()` doesn't re-implement RBAC. The `ball_event` INSERT policy
(`schema_scoring.sql`) already requires **capability + token + matching epoch +
live lease**. This layer adds the operational glue:

- **Idempotency** — retries are free; a known `idempotency_key` returns the
  existing seq instead of a second row.
- **Ordering** — writes are serialised on the session row (`FOR UPDATE`), and seq
  is allocated server-side, so the log is contiguous.
- **Quarantine, never merge** — an event whose epoch/device/lease doesn't match
  (e.g. a device that was handed over or force-released, then reconnected) goes to
  `ball_event_quarantine` for human review, never silently into the log.
- **Lease refresh** — a successful write keeps the token alive.

## Wiring to the scorer UI

The 3-phase / quick scorer already commits a ball object. Replace the in-memory
commit with:

```js
const engine = new SyncEngine({
  matchId, deviceId, scorerId, epoch,
  storage: indexedDbStorage({ matchId, deviceId }),
  transport: (mid, batch) => api.appendEvents(mid, batch),   // POST /matches/:id/events
  isOnline: () => navigator.onLine,
  onChange: ui.setSyncBadge,     // { pendingCount, syncing, online }
});
await engine.init();                       // recover any crash survivors

// on each ball:
await engine.record({ kind:"ball", type, value, shot, seg, zone, strikerId, bowlerId });
board.render(engine.score());              // optimistic, instant
if (engine.shouldCheckpoint(legalBalls)) engine.sync();   // force at over boundary

// handover gate (from the handover spec):
if (!engine.safeToHandOver) blockHandover(engine.pendingCount);
```

The score shown is `engine.score()` — a replay of acked + pending events — so the
board updates on tap regardless of network. The server log remains the source of
truth; on reconnect the two converge.

## Honest limits

- Unit-tested with a fake pool and in-memory storage: the transaction shape,
  dedup, seq allocation, quarantine routing, crash-recovery and optimistic replay
  are all proven here. **Not** yet run against live Postgres or a real browser.
- The real gates: (1) `rls_verify.sql` proves the DB rejects unauthorised writes;
  (2) an in-browser test of `indexeddb-storage.mjs` proves durability across a
  hard refresh; (3) a live "airplane-mode over" — score six balls offline,
  reconnect, confirm the log reconciles and the scorecard is correct.
- Batch flush sends all pending in one request. Fine for a single scorer at
  T20 rates; if a batch ever gets large after a long outage, cap it and page.
- The optimistic `score()` tracks runs/wickets/balls/strike (enough for the live
  board). The full batting/bowling scorecard is a richer replay over the same
  event log — build it as a derived read reusing this log, not a separate store.
- This is the step to budget real engineering time against, exactly as flagged:
  offline + handover + reconciliation is genuine distributed-systems work, and
  the pilot is where its edge cases surface.
