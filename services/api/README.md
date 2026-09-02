# SCRBRD Backend — Reference Implementation & Specs

The tested backend for SCRBRD's scoring platform: authorization, auth, the read
and write paths, offline durability, realtime sync, and scorer handover. Every
module is framework-agnostic and dependency-free, with a test suite. **260
assertions pass across 6 suites** (`node run-all-tests.mjs`).

This is a reference implementation and specification, not a deployed service. It
is designed to drop into a Node/TypeScript API over Postgres. See **Honest
status** below for exactly what is and isn't proven.

## What's here

```
db/         SQL migrations, apply in numeric order
  01_schema_scoring.sql      event-sourced ball log, sessions, quarantine, audit
  02_rls_policies.sql        GENERATED row-level security + column masking
  03_session_functions.sql   scoring_claim_handover (completes the state machine)
  99_rls_verify.sql          live-DB assertions (run after applying, with seed data)

rls/        Authorization, generated from one policy
  policy.mjs                 single source of truth (POLICY, decide, canScore)
  generate-rls.mjs           emits 02_rls_policies.sql from policy.mjs
  rls.test.mjs               55 assertions (policy correctness + SQL faithfulness)

auth/       Request context that makes RLS fire
  auth.mjs                   JWT, principal resolution, transaction-local config
  auth-db.mjs                Postgres adapter + magic-link login
  auth.test.mjs              37 assertions (incl. no-pooling-bleed guard)

read/       Read path — the frontend accessor seam
  read-api.mjs               reads through RLS + masked views (server does no RBAC)
  data-client.mjs            getData(): mock ↔ live per feature flag
  read.test.mjs              30 assertions

write/      Scoring write path + offline durability
  events-api.mjs             append-only, idempotent, seq-ordered, quarantine
  sync-engine.mjs            crash-durable queue, optimistic replay
  indexeddb-storage.mjs      browser storage adapter
  write.test.mjs             36 assertions (incl. crash recovery)

realtime/   Live sync + handover endpoints
  realtime.mjs               per-match pub/sub hub
  live-client.mjs            catch-up + stream, gap/reconnect safe
  session-routes.mjs         token/handover HTTP endpoints
  realtime.test.mjs          25 assertions (incl. join/reconnect no-gap/no-dupe)

handover/   Token state machine (foundation for write + realtime)
  scoring-session.mjs        MatchSession, ScoringQueue, replay
  scoring-session.test.mjs   77 assertions

docs/
  SCORING_HANDOVER_SPEC.md   protocol, API contract, pilot guidance
  AUTH_SPEC.md               login flow, trust boundary, pooling pitfall
```

Each module directory has its own README with the design detail.

## Build sequence

The dependency order — and the recommended order to build and demo — is:

1. **Database** — apply `db/01…03` to Postgres. Verify with `db/99_rls_verify.sql`
   against seed data. (RLS is generated: change `rls/policy.mjs`, run
   `node rls/generate-rls.mjs > db/02_rls_policies.sql`.)
2. **Auth** — magic-link login issues a JWT; every request sets `app.*` session
   vars transaction-local via `withPrincipal()`. Nothing in RLS fires until this
   is correct.
3. **Reads** — point the client `getData()` seam at `read-api.mjs`, one resource
   flag at a time. A real match rendering from Postgres proves the pipe.
4. **Writes** — wire the scorer to `sync-engine.mjs`; balls persist locally and
   sync in the background. This is the MVP proof point: a match survives offline.
5. **Realtime + handover** — the hub + session routes; spectators and a second
   scorer update live, and takeover works.
6. **Migrate remaining reads** — add queries to `READ_QUERIES`, flip flags.

## Run the tests

```
node run-all-tests.mjs        # all suites
node write/write.test.mjs     # one suite
```

No dependencies to install — pure Node ESM.

## Honest status

- **Proven here:** the logic. Authorization decisions, the transaction shape,
  idempotency, seq ordering, quarantine routing, crash recovery, optimistic
  replay, and the join/reconnect correctness are all unit-tested against fakes.
- **NOT proven here:** behaviour against live Postgres, a real browser
  (IndexedDB), or a real socket server. These are the gates that turn "tested
  logic" into "working system":
  1. `db/99_rls_verify.sql` green on live Postgres with seed data.
  2. In-browser: score offline, hard-refresh mid-over, confirm nothing is lost.
  3. End-to-end: an "airplane-mode over" — six balls offline, reconnect, log
     reconciles, scorecard correct.
  4. A live two-device handover.
- **Before launch (flagged, not built):** token refresh, rate-limiting on login
  endpoints, secrets moved to env, and — for multiple API instances — a fanout
  bus (Redis / Postgres LISTEN-NOTIFY) behind the realtime hub.
- **Frontend:** the existing `scrbrd_os.jsx` artifact is the product spec and UX
  reference. Wiring this backend means graduating it into a real build (Vite,
  files, IndexedDB, a socket client) — implementation, not redesign.

## The one principle everything rests on

The ball-event log is the only source of truth. Score, scorecards, worms, wagon
wheels and player stats are always **derived by replay**, never stored as
authoritative. That single decision is what makes offline scoring, handover,
realtime catch-up, and dispute resolution all tractable — they are the same
replay from the same log.
