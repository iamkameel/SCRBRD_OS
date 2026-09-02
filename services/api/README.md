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

- **Proven against fakes:** authorization decisions, the transaction shape,
  idempotency, seq ordering, quarantine routing, crash recovery, optimistic
  replay, and join/reconnect correctness. 494 assertions across 9 suites.
- **Proven against a real database and a real HTTP server:**
  1. ✅ **RLS live** — `db/99_rls_verify.sql` green on live Postgres with seed
     data, as the same unprivileged role the API connects as.
  2. ✅ **Offline durability** — `tools/smoke-persist.mjs`: score offline in a
     real browser, hard-refresh mid-over, nothing is lost.
  3. ✅ **The airplane-mode over** — `tools/smoke-sync.mjs`: six balls with the
     network down, reconnect, the log reconciles, the scorecard is correct, a
     retried batch is deduplicated, and a stale epoch is quarantined rather
     than merged.
  4. ⬜ **A live two-device handover.** Blocked, deliberately: see below.

Gate 3 changed what the other three mean. Every suite above passed while the
API connected as the schema owner — and row-level security does not apply to a
table's owner. The policies were all present, all generated, all tested, and
all inert. What caught it was a medical officer successfully appending a ball
to a live match in gate 3, because that is the first test that puts a real
request through a real connection. The fix is in `db/06_app_role.sql` and in
`assertRlsApplies()`, which refuses to start the server on a connection RLS
cannot restrain.

### Before gate 4

Two devices scoring one match needs the **undo/sync boundary** enforced first.
Right now undo rewrites the local log freely, which is correct while the log
exists only on one phone. Once the server has an event, a correction must be a
compensating event instead — otherwise two devices can disagree about history
and both be internally consistent. Documented in `apps/web/src/lib/persist.js`,
not yet enforced. The handover routes are written and proven against fakes but
are deliberately **not mounted** until it is.

### Before launch (flagged, not built)

`login_code` and the magic-link path (the pilot signs in through a dev-only
route that mints a token without a code, gated on `ALLOW_DEV_LOGIN=1` and
`NODE_ENV !== production`); token refresh; rate-limiting on login endpoints;
secrets from a real store rather than env; and — for multiple API instances —
a fanout bus (Redis / Postgres LISTEN-NOTIFY) behind the realtime hub.

## The one principle everything rests on

The ball-event log is the only source of truth. Score, scorecards, worms, wagon
wheels and player stats are always **derived by replay**, never stored as
authoritative. That single decision is what makes offline scoring, handover,
realtime catch-up, and dispute resolution all tractable — they are the same
replay from the same log.
