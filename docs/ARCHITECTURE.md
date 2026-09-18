# SCRBRD OS — Architecture

How the pieces fit, and where each claim below is *asserted* rather than just
written down. This is the maintained map; `audit/SCRBRD_SYSTEM_MAP.md` is the
dated snapshot the Pass 1 audit took of the same ground, kept as a record.
Detail lives in each module's README and in the rest of `docs/`.

Figures that drift (chunk sizes, assertion counts, file counts) are not
repeated here. The build prints the first, `db/99` and the smoke runner print
the second, `ls db/` is the third.

## 1 · Repository overview

| Area | Path | What it is |
|---|---|---|
| Web | `apps/web` | React 18 / Vite single-page app. Shell (`src/shell`), the role-scoped views (`src/views`), the scorer (`src/scorer`), design tokens (`src/design`), UI primitives (`src/ui`), live-data adapters (`src/lib/live.js`), auth screens (`src/auth`), capability checks for rendering (`src/rbac`). Offline shell in `public/sw.js`. |
| API | `services/api` | Node HTTP server (`server.mjs`, a regex route table). `auth/`, `read/`, `write/`, `io/` (CSV), `handover/` (scoring sessions), `realtime/`, `notify/` (web push), `rewards/` (the server-only rating coefficients), `ai/`, `rls/` (the policy generator). Every request runs inside `withPrincipal()`: `BEGIN` → `set_config('app.*', …, true)` → handler → `COMMIT`, `ROLLBACK` on throw. |
| Policy | `packages/policy` | The canonical RBAC model: capabilities, roles and their bundles, the grantable-role matrix, team-code and subject scoping, `date-of-birth.mjs` (SA ID ↔ DOB). **Generates** `db/01_authz.sql` and `db/09_rls_policies.sql` (`pnpm rls:generate`). |
| Scoring | `packages/scoring` | Event-sourced cricket law. `replay.mjs` is the deterministic reducer from `ball_event` to a scorecard; the dismissal vocabulary is closed (`db/13`). |
| Sync | `packages/sync` | The offline outbox and idempotent replay of ball events to `/api/events`. |
| Database | `db` | Numbered, forward-only SQL. `00`–`23` are the schema and its corrections; `98` is the pilot seed (invented people, never production); `99` is the live verifier and is not schema. |
| Tooling | `tools` | `migrate.mjs` (the ledger), `bundle-sql.mjs` (Supabase pastes), `run-all-tests.mjs`, `check-imports.mjs`, `check-bundle.mjs`, `run-smoke-api.mjs` and the `smoke-*.mjs` walks it refuses to leave unlisted. `hooks/guard.mjs` is the PreToolUse guard wired up in `.claude/settings.json`: it closes the applied end of the ledger (§9) to editors and to the shell alike, and refuses the deletes and pushes that cannot be undone. |
| Docs | `docs` | This file, `AUTH_SPEC.md`, `SCORING_RULES.md`, `SCORING_HANDOVER_SPEC.md`, the reconciliation specs, and `adr/` (0001 scoped assignments, 0002 the coach's medical overview, 0003 job titles are not roles). |
| Deploy | `DEPLOYING.md`, `render.yaml`, `Dockerfile`, `.github/workflows` | Render (or Cloud Run) for the API serving the built client from one origin; Supabase (or Cloud SQL) for Postgres; CI on every PR. |

## 2 · The spine: one log, everything derived

```
                    ┌─────────────────────────────────────────┐
                    │        ball_event  (append-only)         │  ← the ONLY truth
                    │  seq · epoch · scorer · device · payload  │
                    └─────────────────────────────────────────┘
                          ▲                        │ replay
                       append                      ▼
   ┌──────────────┐                     ┌──────────────────────────┐
   │ offline queue│                     │ live score · scorecard   │
   │ (IndexedDB)  │                     │ worm · wagon · stats     │  ← all derived
   └──────────────┘                     └──────────────────────────┘
```

Nothing stores "the score". Every view is a `replayEvents()` over the log,
which is why offline scoring, handover, realtime catch-up and dispute
resolution are the *same* operation — replay from a cursor — rather than four
hard problems. A ball the server cannot accept (a stale epoch after a
handover) is *quarantined*, never merged; a person releases it (`db/14`)
after reconciling against the paper book.

## 3 · Runtime architecture

```text
 Browser (apps/web)
 ├─ main.jsx          startAnalyticsIfConsented() — Firebase is a separate chunk,
 │                    fetched only on a device that said yes (check-bundle asserts it)
 ├─ auth/             landing → code redeem (POST /api/auth/redeem) → session token
 │                    dev login (POST /api/auth/dev-login) exists only with
 │                    NODE_ENV≠production AND ALLOW_DEV_LOGIN=1
 ├─ lib/api.js        bearer token on every call; signedIn() = a token is held
 ├─ lib/live.js       useLive(resource, role, nonce) → GET /api/read/:resource
 │                    no token → mock data, and the shell says "Demonstration"
 ├─ rbac/             can(capability) for what to DRAW; never what to ALLOW
 ├─ scorer/           ball entry → packages/scoring replay → packages/sync outbox
 ├─ public/sw.js      cache-first for hashed assets, network-first for the page
 └─ IndexedDB `scrbrd` (kv, session, outbox)
              │ HTTPS, same origin (/api/** is the API)
              ▼
 API (services/api/server.mjs)
 ├─ withPrincipal()   BEGIN; set_config('app.user_id', …, LOCAL); route; COMMIT | ROLLBACK
 │                    the answer leaves AFTER COMMIT: the response shim records what a
 │                    handler says and the dispatcher flushes it once the handler resolves
 ├─ read/             GET /api/read/:resource — SELECTs over *_masked views under RLS;
 │                    restricted columns that came back are logged (access_log)
 ├─ write/            POST … — one handler per domain; a retry replays the stored
 │                    response (request_replay, db/15) instead of writing twice
 ├─ handover/         scoring-session: token · lease · epoch · quarantine
 ├─ realtime/         per-match pub/sub over HTTP; broadcast on commit
 ├─ notify/           web push; the payload never names a child (buildPayload)
 ├─ rewards/          rating coefficients — server only; the API returns the figure
 └─ ai/               Anthropic; the client assembles what it sends
              │ pg, as scrbrd_app — no CREATE, no BYPASSRLS; server.mjs refuses to
              │ start on a connection that owns tables
              ▼
 Postgres
 ├─ app_can(cap, school, team, person, fixture) — THE decision; STABLE, SECURITY DEFINER,
 │    search_path pinned (db/16); liveness of role_assignment + assignment_subject per call,
 │    including the hour hand on a support assignment (expires_at, db/22; functions re-emitted in db/23)
 ├─ RLS on every table (generated); login_code and schema_migration have no policy = deny
 ├─ *_masked views, security_invoker — per-row column masking (RLS cannot do columns)
 ├─ module gates (school_module → feature_enabled()) — can only NARROW access
 ├─ access_log — written only by log_restricted_read() (SECURITY DEFINER); no INSERT policy
 ├─ ball_event · ball_event_quarantine · scoring_session
 └─ schema_migration — the ledger (see §9)
```

## 4 · Authorization, in cooperating layers

| Layer | Decides | Where |
|---|---|---|
| **Capability** | may this *role* do this at all | `packages/policy` role bundles → `role_capability` rows → `app_can()` |
| **Scope** | at *which* school / team / person / fixture | `role_assignment` + `assignment_subject`, evaluated live inside `app_can()` (ADR 0001) |
| **Row** | *which rows* | generated RLS policies, all built on `app_can()` |
| **Column** | *which fields* — PII, the three medical tiers | generated `*_masked` views; a coach gets nature + status, not the physio's notes (ADR 0002) |
| **Module** | has the *school* switched this on | `feature_enabled()`; write routes tagged in `server.mjs`; `drs_review` and the sport grant are gated in SQL too |
| **Token / lease** | is this *device* scoring *this match* now | the scoring-session state machine (`docs/SCORING_HANDOVER_SPEC.md`) |
| **Record** | who *actually received* a restricted field, and any read made platform-wide or under support | `access_log`, per school, written by the database |
| **Support** | a platform person reaching *one* school as *one* of its roles, for an hour | `support_access_begin()` (`db/22`): a real assignment with an hour hand (`expires_at`) the decision functions read (`db/23`); the school can end it; every read under it is stamped |

The client's `can()` and the database's policies come from the **same** policy
package, so they cannot drift — CI regenerates the SQL and fails on any
difference. The API handlers contain no authorization of their own: they run
under the principal and let the database decide.

**When, and why it is not a fifth row.** `Roles&Duty.md` §2.1 asks for a fourth
authorisation control beside role, scope and relationship: *when* — the workflow
state the record is in. SCRBRD OS enforces it, and deliberately not here.
Thirty trigger functions in `db/` refuse something; twenty-nine of them consult
no capability at all. A withdrawn honour is not edited, a fixture's sport is
frozen once it has a ball log, `ball_event` is append-only — and the rule is the
same for a scorer and for `superadmin`, because it is about the record and not
about the reader. That is stronger than making it a control alongside the
others, where a sufficiently privileged role could be granted past it: a rule
any capability can bypass is a privilege, not an invariant. The one refusing
trigger that does gate on a capability is `sponsorship_exclusivity_gate`, which
is an approval by design — `sponsorship.exclusivity.waive` exists so a
governance role can take that decision and be named taking it.
`packages/policy/test/invariants.test.mjs` keeps the split honest: an invariant
that acquires a capability check has become a privilege, and goes red there.

**What does not get a layer.** A job title is not a role unless it needs
different data access or different approval authority — ADR 0003, which also
says where the others go instead (a scope, a record of its own like `honour`,
or a specialism). Every role is priced in `roles.mjs`, the RLS matrix, `db/99`
and a production paste, so the question is worth asking before the line is
written rather than after. `packages/policy/test/separation.test.mjs` asserts
the boundaries the roster is supposed to keep, including the ones nobody has
written down anywhere else.

## 5 · Trust boundaries

- **Browser: untrusted.** Role and capability values in React state decide
  what to *draw*. Nothing they say is believed by the API or the database.
- **API: semi-trusted.** It verifies the bearer token, sets `app.user_id` for
  the transaction, and otherwise defers. `withPrincipal()` means a thrown
  handler leaves no partial write; the HTTP walks cannot observe orphan rows.
- **Database: the authority.** `app_can()` is the single decision function
  and every policy is generated from it. `scrbrd_app` cannot create objects
  or bypass RLS; every `SECURITY DEFINER` function names its `search_path`.
- **Between schools.** A platform-wide assignment (`school_id IS NULL`) is
  the owner's key and satisfies every school; it is granted only by
  `tools/bootstrap.mjs --owner`, never from inside the platform (`db/99`
  asserts it), and every read made under it is on each school's record.
- **Third parties.** Render/Cloud Run, Supabase/Cloud SQL, Anthropic, Firebase
  (analytics, consent-gated), web push. Push payloads carry no child's name
  or diagnosis; the notice is fetched under the reader's own policy.

## 6 · Data flows

**Authentication**
```text
school office issues a code ──▶ POST /api/auth/redeem {code}
                                │ login_code consumed (deny-all RLS; only SECURITY DEFINER touches it)
                                ▼
                          session token ──▶ IndexedDB `session`
every request: Authorization: Bearer <token> ──▶ withPrincipal() ──▶ set_config('app.user_id')
sign-out: signOut() + clearSession() — the persisted shell state goes too
owner locked out: /recover.html ──▶ POST /api/auth/owner/recover (db/18; inert without OWNER_RECOVERY_SECRET)
```

**Read**
```text
useLive(resource) ──▶ GET /api/read/<resource> ──▶ SELECT … FROM <table>_masked
   RLS keeps the rows app_can() allows; the masked view drops the columns the tier cannot see
   restricted columns that came back ──▶ log_restricted_read()  (once per school, platform-wide flagged)
   ADAPT[resource] in live.js reshapes rows for the view
```

**Write**
```text
view ──▶ POST /api/<domain> ──▶ withPrincipal() BEGIN ──▶ handler ──▶ INSERT/UPDATE under RLS
                                                        ├─ ok    ──▶ COMMIT, response stored against the Idempotency-Key
                                                        └─ throw ──▶ ROLLBACK (no partial state)
same key again ──▶ the stored response, no second row (db/15)
```

**Scoring and offline**
```text
scorer UI ──▶ ball_event {id = idempotency key, epoch, seq}
   ──▶ packages/sync outbox (IndexedDB) ──▶ POST /api/events
   ──▶ events-api: epoch/lease check ──▶ accepted | duplicate | quarantined
   ──▶ packages/scoring replay ──▶ scorecard
offline: the UI replays locally from the same reducer; the outbox drains in seq order when back
handover: explicit, gated on a drained outbox, verified against a replay; the epoch bump retires the old device
```

## 7 · Domains

| Domain | Schema | Modules | Notes |
|---|---|---|---|
| Identity | `db/05`, `db/01` | `auth/`, `lib/session.js` | `app_user`, `role_assignment`, `assignment_subject`, `login_code`. Codes are handed over by a person (`auth-db.mjs` says why). |
| Schools & modules | `db/00`, `db/08` | `read-api`, `SettingsView`, `ModulesView` | `school`, `school_module`. Off at any school you belong to is off. |
| Teams & players | `db/00`, `db/11`, `db/19` | `SquadView`, `roster-add-api`, `import-api`, `dob-capture-api` | `player.born` required going forward; the gaps the migrations could only warn about are surfaced on Settings. |
| Fixtures | `db/00`, `db/02` | `fixture-api`, `MatchCentreView` | A fixture in a sport the school is not granted is refused in SQL. |
| Scoring | `db/02`, `db/13`, `db/14`, `db/17` | `events-api`, `handover/`, `scorer/` | `ball_event`, `ball_event_quarantine`, `scoring_session`. |
| Guardians | `db/08`, `db/10` | `requests-api` (`enrol_person`) | A link ends on the 18th birthday (`majority_on(born)`); a refused enrolment leaves nothing behind. |
| Medical | `db/08`, generated `injury_masked`, `db/21` | `read-api`, `InjuryView`, `clearance-api` | Three tiers: status, nature, details. |
| Programme | `db/08` | training, skills, workload, logistics, fields, sponsors, officials, kit | Each behind its module switch. |
| News & notices | `db/12`, `notify/` | `news-api`, `NewsView`, `NotificationsView` | Public notices are general; the specific line waits for a signed-in reader. |
| Audit | `db/08`, `db/20`, `db/22` | `read-api` | `access_log`; readable under `audit.read` at the school. `support_access`: who had support access, why, for how long, who ended it. |
| AI | `ai/` | `lib/ai.js`, `TopBar` | Stateless; what the client sends is the client's choice. |

## 8 · Dependency graph

```text
packages/policy ──(rls:generate)──▶ db/01_authz.sql, db/09_rls_policies.sql  (frozen once shipped; see §9)
       │
       ├──▶ services/api   (capability names, GRANTABLE_ROLES, resolveBirthDate)
       └──▶ apps/web       (nav capabilities, role labels, resolveBirthDate)
packages/scoring ──▶ services/api/write/events-api.mjs, apps/web/src/scorer
packages/sync    ──▶ apps/web (outbox) ; services/api (idempotency contract)
db/*             ──▶ tools/migrate.mjs (ledger) ──▶ tools/bundle-sql.mjs ──▶ Supabase SQL Editor
tools/smoke-*    ──▶ services/api + apps/web/dist (Playwright)
```

One-way rule: `packages/*` import nothing from `apps/` or `services/`, and
nothing under `apps/web` may reach `services/api/rewards` (`check-bundle`
reads both the source and the built output to say so).

## 9 · Deploying the schema

The database is not deployed by the workflow; a person changes it, and the
change is always a new file.

```text
db/NN_*.sql (new) ──▶ migrate.mjs --reset --seed --verify (local, with the db/99 section)
                  ──▶ bundle-sql.mjs --apply NN ──▶ paste scrbrd-supabase-apply-NN.sql in the SQL Editor
                  ──▶ bundle-sql.mjs            ──▶ paste scrbrd-supabase-verify.sql — ALL RLS LIVE ASSERTIONS PASSED
                  ──▶ only then: merge / deploy the code that needs it
```

- `schema_migration` records each file with its hash. A changed applied
  file is **refused**; so is an apply paste out of order or run twice.
- `tools/hooks/guard.mjs` refuses the edit *before* it is made, so the
  refusal lands while the change is still cheap to redirect into a new file
  rather than at the deploy. It knows how far the ledger reaches from one
  constant, `FROZEN_THROUGH` — **bump it when a new `db/NN` has been pasted
  into production**, or the guard leaves that file open. `tools/hooks/guard.test.mjs`
  asserts the constant still names a file that exists, which catches it
  pointing past the end but not a number left behind.
- `db/01` and `db/09` are generated and, once applied, as frozen as the rest.
  A capability change after go-live is `roles.mjs` + a new `db/NN` + an
  entry in `WITHDRAWN_SINCE_01` in the generator (`db/21` is the example) —
  or, for a capability that did not exist when `db/01` shipped, an entry in
  `ADDED_SINCE_01`, which keeps the name out of `db/01` and points at the
  `db/NN` that inserts it (`db/24` is the example).
  A change to a *decision function* is the generator emitting it again into
  a new numbered file with the change flagged (`db/23` is the example: the
  same three functions, one more liveness line), while `db/01` stays as shipped.
- `SELECT name FROM schema_migration ORDER BY name;` says where a database
  is when it has fallen behind; apply each missing number in order.
- `--reset` / `--reset-objects` are the demonstration path only.

The full rule and its reasons: `DEPLOYING.md`, "Changing the schema after
go-live".

## 10 · Invariants, and what keeps each one true

| Invariant | Kept by |
|---|---|
| `ball_event` is the only match truth; no stored score | `packages/scoring` replay tests; no score column in `db/02` |
| Authorization is decided in the database, from one policy source | `db/99` live assertions; `rls.test.mjs`; CI "RLS output is current" |
| The owner's key reaches every school, a coach's does not, and neither is a tenant leak | `db/99` tenant sections; the verify bundle on production |
| A module switch can only narrow access | `smoke-modules` (on → off → on, over HTTP) and `db/99` (in SQL) |
| A coach sees an injury's nature and return date, never the clinical notes | `db/99` §3, `rbac.test`, `smoke-read`, `smoke-audit` (ADR 0002) |
| Every disclosure of a restricted field, and every platform-wide read, is on the record and cannot be forged or read by its subject | `smoke-audit` as the real `scrbrd_app` connection |
| A retry never writes twice | `smoke-idempotency`, `db/15` |
| A 200 means a committed row; a COMMIT that refuses is answered 5xx, and leaves no idempotency receipt | `smoke-commit` (COMMIT slowed, then made to refuse, by deferred constraint triggers) |
| Support access is one role at one school, stops by itself within its minutes, can be ended by the school, and leaves every read on the school's record | `db/99` (the hour hand wound back, then read again — no job between), `smoke-support` |
| Offline scoring survives a reload; handover cannot fork the log | `smoke-browser-sync`, `smoke-sync`, `smoke-handover` |
| Guardianship ends at majority; a refused enrolment leaves nothing behind | `db/99`, `smoke-guardian` |
| Nothing confidential, and no Firebase, in the chunk every visitor downloads | `check-bundle` |
| Every module imports what it uses | `check-imports` (self-tested) |
| Every smoke walk on disk is run by something | `run-smoke-api` refuses unlisted walks |
| A file already applied is never edited; a schema change is a new file | the ledger; `bundle-sql --apply`; §9 |

Every guard above was falsified once — broken on purpose, watched go red for
the expected reason, restored — before it was trusted. The convention holds
for new ones.

## 11 · Deliberately deferred

- Multi-scorer capture (one for runs, one for the wagon wheel): the exclusive
  token is conservative for v1; concurrent writers multiply conflict cases.
- Caching on reads: omitted so correctness is obvious; a TTL later if needed.
- Cross-service token verification (RS256), horizontal realtime fan-out, and
  PlayHQ/CSA data exchange: post-pilot; none block the MVP.
- Email/SMS delivery of login codes: a person hands them over, by design.
