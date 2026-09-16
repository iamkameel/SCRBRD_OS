# SCRBRD OS — System Map

**Pass:** Focused Pass 1 · **Branch audited:** `claude/ui-refactor-ds2` at `0783ed5` · **Date:** 2026-09-16
**Method:** every row below was read from the file named, or observed at runtime against a freshly rebuilt local database (`db/00`–`db/12` + `db/98_seed_pilot.sql`). Anything not checked is marked `NOT VERIFIED`.

## 1. Repository Overview

| Area | Path | Purpose | Status |
|---|---|---|---|
| Web | `apps/web` | React/Vite single-page app. Shell (`src/shell`), views (`src/views`), scorer (`src/scorer`), design tokens (`src/design`), live data adapters (`src/lib/live.js`), auth (`src/auth`). | Builds clean; 970 KB main chunk (`apps/web/dist/assets/index-*.js` = 993,446 bytes). |
| API | `services/api` | Node HTTP server (`server.mjs`) with a regex route table; `read/`, `write/`, `io/`, `handover/`, `ai/`, `rls/`. Every request runs inside `withPrincipal()` (BEGIN … COMMIT, ROLLBACK on throw). | Functional; API smoke 2146 assertions PASS. |
| Policy | `packages/policy` | Canonical RBAC: 81 capabilities (`src/capabilities.mjs`), 25 roles (`src/roles.mjs`), grantable-role matrix, `date-of-birth.mjs` (SA ID ↔ DOB). Generates `db/01_authz.sql` and `db/09_rls_policies.sql` via `pnpm rls:generate`. | Canonical. `superadmin` = all 81 capabilities (`roles.mjs:89`). |
| Scoring | `packages/scoring` | Event-sourced cricket law: `src/replay.mjs` is the deterministic reducer from `ball_event` to scorecard. | Canonical. Dismissal law encoded as regex (`replay.mjs:336`) — see Scoring Audit. |
| Sync | `packages/sync` | Offline outbox / idempotent replay of ball events to `/api/events`. | Functional; `smoke-sync` 52 + `smoke-browser-sync` 19 assertions PASS. |
| Database | `db` | 14 SQL files: schema (`00`,`02`,`08`,`12`), authz + RLS (`01`,`09` generated), sessions/auth (`04`,`05`,`06`), shot placement (`07`), forward-only migrations (`10`,`11`), pilot seed (`98`), verifier (`99`, 171 assertions). | Ledger-tracked by `tools/migrate.mjs` (`schema_migration`, hash-checked; changed applied file → REFUSED). |
| Tooling | `tools` | `run-all-tests.mjs`, `check-imports.mjs`, `check-bundle.mjs`, `migrate.mjs`, `bundle-sql.mjs` (Supabase rebuild/verify bundles), 60+ `smoke-*.mjs` API/browser walks, `run-smoke-api.mjs`. | Functional. `check-imports` has a known blind spot (`check-imports.mjs:105` skips names nothing exports). |
| Docs | `docs` | `ARCHITECTURE.md`, `AUTH_SPEC.md`, `SCORING_RULES.md`, `SCORING_HANDOVER_SPEC.md`, three reconciliation specs, one ADR (`adr/0001-scoped-assignments.md`). | Present. No root `ARCHITECTURE.md` (the audit brief expected one at root). |
| Deploy | `render.yaml`, `DEPLOYING.md`, Supabase | Render web service, `NODE_ENV=production` (`render.yaml:30-31`), `ALLOW_DEV_LOGIN` deliberately absent (`render.yaml:50-53`). Schema deployed by pasting `tools/bundle-sql.mjs` output into the Supabase SQL Editor. | Verified 2026-09-16: verify bundle returned 8/8 OK on production. |

## 2. Runtime Architecture

```text
 Browser (apps/web, Vite SPA, ~970 KB)
 ├─ main.jsx ─── import "./lib/firebase.js"  → initializeApp + getAnalytics at boot (no consent gate)
 ├─ auth/LoginPage.jsx
 │    live ? PILOT_ACCOUNTS : DEMO_ACCOUNTS   (LoginPage.jsx:241)
 │    code redeem → POST /api/auth/redeem   → server session token
 │    dev login   → POST /api/auth/dev-login → REFUSED unless NODE_ENV!=production && ALLOW_DEV_LOGIN=1 (server.mjs:251)
 │    Google btn  → onLogin("schooladmin","Demo User (Google)")  CLIENT-ONLY, no token (LoginPage.jsx:160)
 ├─ lib/api.js      signedIn() = _token != null   (api.js:50)
 ├─ lib/live.js     useLive(resource, role, nonce); demo = !signedIn()  → mock data when no token (live.js:885,961,1005)
 ├─ scorer/         ball entry → packages/scoring replay → packages/sync outbox → POST /api/events
 └─ IndexedDB `scrbrd` (kv, session, outbox)
              │ HTTPS (bearer token)
              ▼
 API (services/api/server.mjs, Node, Render)
 ├─ withPrincipal(): BEGIN; set_config('app.user_id', …); route; COMMIT | ROLLBACK
 ├─ read/read-api.mjs     GET /api/read/:resource   (RLS-filtered SELECTs, *_masked views)
 ├─ write/*-api.mjs       POST … (events, fixture, roster, roster-add, requests/enrol, news, …)
 ├─ io/import-api.mjs     CSV import/export (id_number, born)
 ├─ handover/             scoring-session.mjs: epoch / lease / quarantine
 └─ ai/ai-service.mjs     Anthropic SDK, claude-opus-5 (statguru 400 tok, commentary 120 tok)
              │ pg (role scrbrd_app — no CREATE, no BYPASSRLS)
              ▼
 Postgres (Supabase in production; docker `db` locally)
 ├─ app_can(cap, school, team, person, fixture)  — liveness of role_assignment + assignment_subject enforced per call
 ├─ RLS on all 74 tables (login_code, schema_migration have 0 policies = deny-all)
 ├─ 21 *_masked views, security_invoker = true
 ├─ ball_event (canonical truth) + ball_event_quarantine (recovered flag, no release route)
 └─ schema_migration ledger
```

## 3. Trust Boundaries

- **Browser:** untrusted. Role/capability values held in React state are for rendering only; eleven views still gate buttons on `role === "superadmin"` string compares (see Security Audit §8) — cosmetic, not authoritative.
- **API:** semi-trusted. Verifies the bearer token, sets `app.user_id` in the transaction, and otherwise relies on Postgres for authorisation. `withPrincipal()` guarantees no partial writes reach the DB on a thrown error (verified: HTTP walks cannot observe orphan rows; only direct SQL in `db/99` can).
- **Database:** the authority. `app_can()` is the single decision function; RLS policies are generated from `packages/policy`, not hand-written.
- **RLS:** enabled on every table. `scrbrd_app` connects as a non-superuser with no `CREATE` on any schema (verified via `information_schema`), which is what makes the 79 `SECURITY DEFINER` functions without `SET search_path` a defence-in-depth gap rather than an exploitable one today.
- **External services:** Render (hosting), Supabase (Postgres), Anthropic (AI), Firebase (Analytics), Web Push. Firebase and Anthropic are the only ones that receive user-derived data from the app.
- **AI provider:** receives match situation text for commentary (`services/api/server.mjs:282` → `describeDelivery({situation})`) which includes player names, i.e. minors' names. StatGuru context is assembled client-side (`apps/web/src/lib/ai.js`) — the server does not filter what the client chooses to send.
- **Push:** `smoke-push` walk PASS; subscription storage `NOT VERIFIED` in this pass.
- **Analytics:** Firebase Analytics initialised eagerly at boot (`apps/web/src/lib/firebase.js:37,45`) with no consent gate. Tests carry an `isFirebaseOfflineNoise` filter — the SDK's network chatter is known well enough to be suppressed, which is itself evidence it runs unconditionally.

## 4. Data Flow

### Authentication
```text
school office issues code ──▶ POST /api/auth/redeem {code}
                              │ login_code row consumed (deny-all RLS; only SECURITY DEFINER touches it)
                              ▼
                        session token ──▶ browser IndexedDB `session`
                              ▼
        every request: Authorization: Bearer <token> ──▶ withPrincipal() ──▶ set_config('app.user_id')
Sign-out: signOut() + clearSession() ──▶ stored row has no trace of departing person (verified by browser walk)
No token ──▶ signedIn() false ──▶ live.js returns MOCK data; dashboard labelled "Demo data"
```

### Read path
```text
useLive(resource, role, nonce) ──▶ GET /api/read/<resource> ──▶ SELECT … FROM <table>_masked
                                   RLS filters rows via app_can(); masked view drops columns the tier cannot see
                                   ADAPT[resource] reshapes rows for the view
```

### Write path
```text
view ──▶ POST /api/<domain> ──▶ withPrincipal() BEGIN ──▶ handler ──▶ INSERT/UPDATE under RLS
                                                        ├─ ok    ──▶ COMMIT
                                                        └─ throw ──▶ ROLLBACK (no partial state)
Idempotency: only events-api carries idempotency keys (14 refs); all 14 other write handlers carry 0.
```

### Scoring path
```text
scorer UI (sheets.jsx: fixed mode list) ──▶ ball_event {id = idempotency_key, epoch, seq}
   ──▶ packages/sync outbox (IndexedDB) ──▶ POST /api/events
   ──▶ events-api: epoch/lease check ──▶ accepted | duplicates | quarantined (ball_event_quarantine)
   ──▶ packages/scoring replay.mjs ──▶ scorecard (batter, bowler, partnerships, result)
```

### Offline sync path
```text
offline: events queue in IndexedDB outbox; UI replays locally from the same reducer
online:  outbox drains in seq order; server dedupes on idempotency_key; stale epoch → quarantine
Verified: reload mid-innings, duplicate retry, stale epoch (smoke-sync 52, smoke-browser-sync 19, smoke-handover 35).
NOT VERIFIED: browser close/reopen (not merely reload), degraded connectivity (partial response), crash mid-handover.
```

## 5. Major Domains

| Domain | Canonical source | Primary modules | Persistence | Key risks |
|---|---|---|---|---|
| Identity | `db/05_auth.sql`, `db/01_authz.sql` | `services/api/server.mjs` auth routes, `apps/web/src/lib/session.js` | `app_user`, `role_assignment`, `assignment_subject`, `login_code` | Production login path for non-code users is client-only demo mode (RISK-SEC-001). |
| Schools | `db/00_schema_core.sql` | `read-api`, `SettingsView` | `school`, `school_module` | Platform-wide assignment (`school_id NULL`) satisfies any school — intended for `superadmin`, must never be granted otherwise. |
| Teams | `db/00_schema_core.sql` | `SquadView`, `roster-add-api`, `import-api` | `team`, `player`, `team_membership` | `player.born` now required forward-only (`db/11`, `NOT VALID`); legacy NULL rows tolerated. |
| Fixtures | `db/00`, `db/02` | `fixture-api`, `MatchCentreView` | `fixture`, `match_squad` | Reduced-overs (D/L-style) not supported. |
| Scoring | `db/02_schema_scoring.sql`, `packages/scoring` | `events-api`, `handover/scoring-session.mjs`, `scorer/*` | `ball_event`, `ball_event_quarantine`, `scoring_session` | Free-text dismissal at API boundary (RISK-SCO-001); quarantine has no release route (RISK-REL-001). |
| Guardians | `db/08_schema_programme.sql`, `db/10` | `requests-api` (`enrol_person`), `decide_role_request` | `assignment_subject.valid_until = majority_on(born)` | Verified: link ends on 18th birthday; refusal leaves no orphan rows. |
| Medical | `db/08`, generated `injury_masked` | `read-api`, `ClearanceView` | `injury` (+ masked view) | Tiers `status`/`nature`/`details` correctly split in generated view (verified). |
| Skills / Training / Workload | `db/08` | `TrainingView`, `SkillsView`, `workload-api` | programme tables | UI edit gates on `role === "superadmin"||"coach"` strings (cosmetic). |
| News | `db/12_news.sql` | `news-api`, `NewsView` | `news_post` (team/school/competition anchor) | 0 idempotency; unshipped to production (`0783ed5` not yet merged). |
| Analytics / AI | `services/api/ai/ai-service.mjs` | `lib/ai.js`, `GlobalSearch`, `TopBar` | none (stateless) | Minors' names sent to third-party model; client-assembled context. |
| Sponsorship / Commercial | `db/08` | `smoke-commercial` | programme tables | `NOT VERIFIED` beyond smoke pass. |

## 6. Dependency Graph

```text
packages/policy ──(rls:generate)──▶ db/01_authz.sql, db/09_rls_policies.sql
       │                                     │
       ├──▶ services/api (capability names, GRANTABLE_ROLES, resolveBirthDate)
       ├──▶ apps/web (NAV_CAPABILITY, role labels/colours, resolveBirthDate)
       │
packages/scoring ──▶ services/api/write/events-api.mjs, apps/web/src/scorer
packages/sync    ──▶ apps/web (outbox) ; services/api (idempotency contract)
db/*             ──▶ tools/migrate.mjs (ledger) ──▶ tools/bundle-sql.mjs ──▶ Supabase SQL Editor
tools/smoke-*    ──▶ services/api + apps/web (Playwright, /opt/pw-browsers/chromium)
```

One-way rule holds: `packages/*` import nothing from `apps/` or `services/` (checked by `tools/check-imports.mjs`, PASS).

## 7. Canonical vs Legacy Implementations

| Concern | Canonical | Legacy / duplicate | Action |
|---|---|---|---|
| Authorisation | `app_can()` + generated RLS from `packages/policy` | `role === "superadmin"` string gates in 11 view files (`MatchCentreView.jsx:32`, `LeagueView.jsx:34`, `ManagementView.jsx:26,107`, `CompetitionsView.jsx:18`, `LogisticsView.jsx:49`, `TrainingView.jsx:41`, `SkillsView.jsx:100`, `StaffView.jsx:24`, `FieldsView.jsx:28`; `SettingsView.jsx:52` already documents the retirement) | Replace with `can(capability)` so Director of Sport and others see the controls the DB already lets them use (SCRBRD-011). |
| Role aliases | `packages/policy/src/roles.mjs` | `apps/web/src/rbac/legacy-roles.js` maps display roles to `{role, school}` | Keep until the login page is capability-driven; then delete. |
| Bowler credit | `replay.mjs:336` regex `UNCREDITED` | `sheets.jsx:316` fixed mode list (agrees with regex) | Promote the fixed list to `packages/scoring` as the closed vocabulary; validate at `events-api` (SCRBRD-002). |
| Dev login | `POST /api/auth/dev-login` refused in production (`server.mjs:251`) | Google button `onLogin(...)` client-only (`LoginPage.jsx:160`) | Either wire to a real identity provider or remove from the live login page (SCRBRD-001). |
| Deploy | `tools/bundle-sql.mjs` (rebuild + verify bundles) | `pnpm db:reset` (`--reset --seed`) — must **never** run against Supabase | Keep the `--reset-objects` / bundle path as the only documented Supabase route. |

## 8. Verified Architectural Invariants

- [x] `ball_event` is canonical match truth — `packages/scoring/src/replay.mjs` derives batter, bowler, partnership and result; no stored score column found in `db/02_schema_scoring.sql`.
- [x] RBAC and scope are enforced server/database-side — `app_can()` on every policy; `db/99` 171 assertions PASS; owner's platform-wide key reaches every tenant, coach's does not.
- [x] Feature gating can only narrow access — `smoke-modules` PASS (`NOT VERIFIED` by direct falsification in this pass).
- [x] Offline scoring survives reload — `smoke-browser-sync` 19 PASS. Close/reopen `NOT VERIFIED`.
- [x] Retry is idempotent — for ball events (`events-api`, idempotency_key = event id). **Not** for any other write handler.
- [x] Cross-tenant access is denied — `db/99` tenant sections PASS; verified negative on production via verify bundle (8/8 OK).
- [x] Guardianship ends at majority — `db/10` backfill, `db/99` "guardianship ends at 18" section, `smoke-guardian` PASS; falsified by breaking each guard (red), restored (green).
- [x] Refused enrolment leaves nothing behind — `enrol_person` subtransaction; `db/99` counts of assignments/subjects/accounts unchanged after refusal.
