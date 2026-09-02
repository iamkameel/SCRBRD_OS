# SCRBRD Backend — Architecture

One page on how the pieces fit. Detail lives in each module's README and in
`docs/`.

## The spine: one log, everything derived

```
                    ┌─────────────────────────────────────────┐
                    │        ball_event  (append-only)         │  ← the ONLY truth
                    │  seq · epoch · scorer · device · payload  │
                    └─────────────────────────────────────────┘
                          ▲                        │ replay
             append (Step 4)                       ▼
   ┌──────────────┐                     ┌──────────────────────────┐
   │ offline queue│                     │ live score · scorecard   │
   │ (IndexedDB)  │                     │ worm · wagon · stats     │  ← all derived
   └──────────────┘                     └──────────────────────────┘
```

Nothing stores "the score". Every view is a `replayEvents()` over the log. This
is why offline scoring, handover, realtime catch-up and dispute resolution are
all the *same* operation — replay from a cursor — rather than four hard problems.

## Request lifecycle (a scored ball)

```
scorer taps 6
  → sync-engine.record()         persist to IndexedDB FIRST, render optimistically
  → POST /matches/:id/events     (background; retries are free — idempotency key)
      → auth: verifyToken → resolvePrincipal
      → withPrincipal(): BEGIN; set_config(app.*, LOCAL); …            (Step 2)
      → events-api.appendEvents(): lock session, dedupe, allocate seq,
          insert (RLS WITH CHECK: capability+token+epoch+lease), refresh lease  (Step 4)
      → hub.broadcastEvents()                                            (Step 5)
  → COMMIT
spectators & 2nd scorer
  → live-client applies the broadcast (idempotent on seq)               (Step 5)
```

## Authorization, in three cooperating layers

| Layer | Enforces | Where |
|---|---|---|
| **Capability** | may this *role* do this at all | `policy.mjs` → `rbac_can_write`, `can_score` |
| **Row scope** | *which rows* (own / team / school / all) | RLS `rbac_can_read` (mirrors app `inScope`) |
| **Column mask** | *which fields* (PII / clinical) | `*_masked` views (RLS can't do columns) |
| **Token** | is this *device* scoring *this match* now | session state machine + lease |

The client `getData()` and the database RLS are generated from the **same**
`policy.mjs`, so they cannot drift. The server read/write handlers contain **no**
RBAC — they run under the principal and let the database decide.

## Trust & isolation (the two footguns, handled)

- **Trust boundary:** role/school come from a *signed* token minted after a DB
  check at login — never from a header. Tampering fails signature verification.
- **No context bleed:** `app.*` vars are transaction-local, so a pooled
  connection never leaks one user's identity to the next request. `withPrincipal`
  enforces the `BEGIN → set LOCAL → query → COMMIT` shape.

## Continuity (why a wet Saturday doesn't break it)

- **Offline:** every ball is on disk before it counts; the queue rehydrates after
  a crash and finishes syncing.
- **Handover:** explicit, gated on a fully-synced queue, with a verification
  handshake against a replay of the log; epoch bumps invalidate the old device.
- **Divergence:** events from a revoked epoch are *quarantined*, never merged —
  a human reconciles against the paper book.
- **Realtime:** best-effort delivery over the log + `since` cursor, so a dropped
  socket message self-heals on the next event or reconnect.

## Layer map ↔ files

```
Step 1  authorization     rls/ + db/02_rls_policies.sql
Step 2  request context   auth/
Step 3  read path         read/
Step 4  write path        write/ + handover/ + db/01
Step 5  realtime+handover realtime/ + db/03
```

## Deliberately deferred

- Multi-scorer capture (one for runs, one for wagon wheel): the exclusive token
  is conservative for v1; concurrent writers multiply conflict cases.
- Caching on reads: omitted so correctness is obvious; add a TTL later if needed.
- Cross-service token verification (RS256), horizontal realtime fanout, and
  PlayHQ/CSA data exchange: post-pilot, none block the MVP.
