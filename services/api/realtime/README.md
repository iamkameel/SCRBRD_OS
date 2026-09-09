# SCRBRD — Realtime Sync & Handover Endpoints (Step 5)

Makes the spectator live-score page and a second scorer's device update as balls
land, and wires the handover protocol so a takeover is visible to everyone in
real time.

## Files

| File | Role |
|---|---|
| `realtime.mjs` | Server `MatchHub` (per-match pub/sub) + `makeCommitAndBroadcast` (broadcast on write). |
| `session-routes.mjs` | HTTP endpoints for the token protocol; each transition broadcasts new session state. |
| `live-client.mjs` | Client `MatchStream` — catch-up + live subscribe, gap/reconnect safe, optimistic score. |
| `session_functions.sql` | `scoring_claim_handover` — the one DB function that completes the state machine. |
| `realtime.test.mjs` | 25 assertions incl. the join/reconnect no-gap/no-dupe guarantee. |

Builds on Steps 1–4 (`auth/`, `write/`, `handover/`). Repo: sibling dirs.

## The one thing that's hard: joining without gaps or duplicates

A client joining a live match, or reconnecting after a drop, must not miss events
or apply any twice. The naive "fetch history, then subscribe" loses everything
that arrives in between. `MatchStream` does it correctly:

```
1. open stream, BUFFER incoming events (don't apply yet)
2. fetch history via readEvents(?since = lastSeq)
3. apply history, then flush the buffer — de-duped by seq
```

Every apply is idempotent on `seq`, so overlapping catch-ups, duplicate
broadcasts and reconnects can never double-count. A detected gap (an event whose
seq is beyond `lastSeq + 1`) re-triggers catch-up. Reconnect resumes from
`lastSeq`, never re-fetching the whole match. The suite proves all of this:
events arriving during catch-up land exactly once; a duplicate changes nothing; a
seq gap self-heals; reconnect fetches only the delta.

## Transport adapters (you provide these)

The hub and stream are transport-agnostic. Wire them to WebSocket or SSE:

**Server (per connection):** on connect, `const off = hub.subscribe(matchId, send)`
where `send(msg)` writes JSON to the socket; on disconnect, call `off()`.

**Client:** `connect({ onOpen, onMessage, onClose })` opens the socket, calls
`onMessage(JSON.parse(evt.data))`, and returns a disconnect fn. `fetchSince` is a
`GET /matches/:id/events?since=<seq>`.

SSE is the simpler choice for a spectator page (one-way, auto-reconnect, works
through proxies); WebSocket if a synced second-scorer needs a back-channel.

## Handover endpoints

Thin wrappers over the DB `SECURITY DEFINER` functions; each successful
transition broadcasts the new session state so the incoming scorer and watchers
see it live. The protocol and its guarantees are in `SCORING_HANDOVER_SPEC.md`.

| Endpoint | DB function | Broadcasts |
|---|---|---|
| `POST /session/claim` | `scoring_claim` | ✓ |
| `POST /session/heartbeat` | (inline lease update) | ✗ (high-frequency, no state change) |
| `POST /session/handover/arm` | `scoring_arm_handover` | ✓ |
| `POST /session/handover/claim` | `scoring_claim_handover` | ✓ (also returns the event log to rebuild) |
| `POST /session/handover/verify` | `scoring_verify_takeover` | ✓ |
| `POST /session/force-release` | `scoring_force_release` | ✓ |

Apply order: `schema_scoring.sql` → `rls_policies.sql` → `session_functions.sql`.

## Honest limits

- Unit-tested with fake transports and a fake pool — the pub/sub, the broadcast
  wiring, and (most importantly) the join/reconnect correctness are proven here.
  Not run against a live socket server or Postgres.
- The hub is single-process. For multiple API instances behind a load balancer,
  put a fanout bus (Redis pub/sub, or Postgres `LISTEN/NOTIFY`) between
  `broadcastEvents` and the per-instance hubs. The client contract is unchanged.
- Best-effort delivery by design: the socket is a latency optimisation, never the
  source of truth. Correctness always rests on the event log + `since` cursor, so
  a dropped message self-heals on the next event or reconnect.
- Real gates: a live socket soak (spectator watches a full match, drops wifi
  mid-over, reconnects, score stays correct) and a live handover with two devices.
