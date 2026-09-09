# SCRBRD — Scoring Session & Handover Specification

**Status:** design spec for implementation · **Companions:** `scoring-session.mjs` (reference implementation, 77 passing tests), `schema_scoring.sql` (Postgres + RLS)

---

## 1. Why this exists

School fixtures run two to four hours and are scored by volunteers — a parent, a boy who isn't batting, a teacher juggling three other duties. Handover is not an edge case; it happens on an ordinary Saturday:

- innings break, and the other team's parent takes over
- a phone hits 4% battery at over 12
- the scorer has to leave at tea
- signal dies at a rural ground and the device is later replaced

If the system cannot survive these, it fails in normal use. This spec defines how scoring continuity is guaranteed.

---

## 2. Core principles

**1. The event log is the only truth.** `ball_event` is append-only. Score, cards, worms, wagon wheels and player stats are *always* derived by replay. No "current score" is ever stored as authoritative. This is what makes continuity possible: any device can rebuild exact match state from the log.

**2. Capability and token are different things, and both are required.**

| | Question it answers | Where enforced |
|---|---|---|
| **Capability** (`can_score`) | May this *role* score at all? | RBAC layer / `canScore()` |
| **Token** | Is this *device* scoring *this match* right now? | Session state machine |

A coach has the capability permanently. The token is exclusive, leased, and transfers explicitly.

**3. Handover is gated on a synced queue.** The single most important rule in this document: **a scorer may not hand over while unsynced balls exist on their device.**

**4. Divergent logs are never silently merged.** Events from a revoked token epoch are quarantined for human review.

---

## 3. Session state machine

```
        claim()                    armHandover()
  IDLE ──────────► ACTIVE ──────────────────────► HANDOVER_PENDING
    ▲                ▲  │                                │
    │                │  │ cancelHandover()               │ claimHandover(code)
    │                └──┴────────────────────────────────┤
    │                                                    ▼
    │           verifyAndTakeOver()  ok              VERIFYING
    │◄──────────────────┬──────────────────────────────┘  │
  forceRelease()        └───────────► ACTIVE (new holder)  │ mismatch
  (lease expired)                                          └─► stays VERIFYING
```

**Epoch.** A monotonic integer on the session, incremented on *every* claim, transfer, and force-release. Events carry the epoch they were written under. An event whose epoch ≠ current epoch is stale by definition — this is the mechanism that locks out a replaced device.

**Lease.** The token holder holds a 90-second lease, refreshed by heartbeat (~20s) and by any ball written. An expired lease blocks writes, preventing a "zombie" device from scoring into a match someone else has taken over.

---

## 4. The handover protocol

### Step 1 — Outgoing scorer arms handover
Preconditions, all enforced server-side:
- caller holds the token (user + device match the session)
- **`pendingCount == 0`** — no unsynced balls
- **no ball in flight** — the 3-phase entry (Shot → Area → Outcome) is not part-complete

If unsynced work exists, the app blocks and shows the operator something actionable:

> **8 balls not yet uploaded.** Move to better signal before handing over.

A six-digit code is issued, derived from match + epoch.

### Step 2 — Incoming scorer claims
B supplies the code (read aloud by A, or B is pre-authorised by the sportsmaster via `handover_to`). B receives the **full event log** and rebuilds state locally. **Scoring remains locked.**

### Step 3 — Verification handshake
B confirms what's on the physical scoreboard: runs, wickets, overs, striker, non-striker, bowler. The server compares against a replay of `ball_event` — never against a stored figure. On mismatch, the takeover is refused and a field-level diff is returned:

```json
{ "ok": false, "reason": "verify_mismatch",
  "diff": [{ "field": "runs", "expected": 142, "got": 140 }] }
```

Thirty seconds of work that catches a gap before it becomes a disputed scorecard.

### Step 4 — Transfer
Epoch increments, token moves to B, lease starts. Every ball remains attributed to whoever entered it (`scorer_user_id`, `device_id`). The full history is written to `scoring_audit`.

---

## 5. Offline behaviour

Play never blocks on the network.

- Every ball is written to a local queue immediately and is **always** accepted.
- Each event carries `idempotencyKey = deviceId:epoch:clientSeq`, so retries are free — the server dedupes on a unique index.
- The queue flushes **in order**; a failure stops the flush and preserves ordering.
- **Checkpoint at every over boundary** (6 legal balls) — a natural, frequent sync point that bounds worst-case data loss to one over.

### The hard case: offline **and** handover

If A is offline holding unsynced balls, those balls exist nowhere else. Mitigations, in order of preference:

1. **Prevent** — handover is blocked while `pendingCount > 0` (§4 Step 1).
2. **Bound** — over-boundary checkpoints limit exposure.
3. **Recover** — if A's device dies, an admin force-releases after lease + 30s grace. When A's device later reconnects, its events arrive under a stale epoch and are **quarantined**, not merged. An operator reviews them against the paper book and accepts or rejects each one.

Never auto-merge two divergent ball logs. A wrong scorecard that looks authoritative is worse than one flagged for review.

---

## 6. API contract

| Endpoint | Purpose | Key failure modes |
|---|---|---|
| `POST /matches/:id/session/claim` | Take an idle match | `no_capability`, `lease_active` |
| `POST /matches/:id/session/heartbeat` | Refresh lease (~20s) | `not_token_holder`, `stale_epoch` |
| `POST /matches/:id/events` | Append ball(s), idempotent | `stale_epoch` (→quarantine), `lease_expired`, `not_token_holder` |
| `POST /matches/:id/session/handover/arm` | Arm, returns code | `unsynced_work` (+count), `ball_in_flight` |
| `POST /matches/:id/session/handover/claim` | Claim with code, returns log | `not_pending`, `verify_mismatch` |
| `POST /matches/:id/session/handover/verify` | Confirm + take over | `verify_mismatch` (+diff) |
| `POST /matches/:id/session/force-release` | Admin recovery | `lease_active` (+retryAfter) |
| `GET  /matches/:id/events?since=seq` | Incremental sync / rebuild | — |
| `GET  /matches/:id/quarantine` | Operator review queue | supervisory roles only |

Write authorisation is enforced at **three** layers: API check, `SECURITY DEFINER` function, and an RLS `WITH CHECK` policy that requires capability **and** token **and** matching epoch **and** a live lease. `ball_event` has no UPDATE or DELETE policy and immutability triggers — append-only at the database.

---

## 7. Corrections

Because the log is append-only, a mistake is fixed by a **compensating event**, not an edit. The current in-app "undo" maps to a `void` event referencing the voided `seq`; replay skips voided balls. This preserves the full audit trail — essential when a scorecard is disputed after the match.

---

## 8. UI requirements

- **Persistent session badge:** who holds the token, sync state, pending count.
- **Sync indicator on every ball:** pending vs confirmed. Scorers must be able to see, at a glance, that their work is safe.
- **Handover blocked state:** never a bare error — always the count and the remedy.
- **Verification screen:** large, readable figures to check against the physical board; explicit Confirm.
- **Takeover banner for the incoming scorer:** "You are now scoring. Last ball entered by Alice at 14:32."

---

## 9. Pilot guidance (Westville)

1. **Hand over at the innings break** wherever possible — a natural boundary with no ball in flight and nothing partially entered.
2. **Two devices logged in from the start**, so a handover is a transfer rather than a scramble.
3. **Keep the paper scorebook running in parallel for the first few fixtures** — not as a fallback for the app, but as *independent ground truth* to reconcile against. It is how you learn whether the event log is actually correct before schools trust it.
4. **Instrument everything:** count handovers, offline durations, queue depths, verification mismatches. A mismatch is a signal worth chasing, not noise.

---

## 10. Open questions

- **Multi-scorer capture** (one for runs, one for wagon wheel) — deferred; the exclusive token is deliberately conservative for v1.
- **Cross-innings token policy:** does the token auto-release at the innings break? Recommendation: yes, prompt to confirm or hand over.
- **Spectator live view** reads the derived score; confirm the read path is cacheable and cannot leak PII (see RBAC deny rules).
- **Retention of quarantined events** for churned tenants (POPIA) — inherits whatever the tenant retention policy sets.
