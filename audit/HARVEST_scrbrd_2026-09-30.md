# SCRBRD Harvest Report

**Source Repository:** `iamkameel/scrbrd` (shallow clone)  
**Destination Repository:** `iamkameel/SCRBRD_OS`  
**Source Commit:** `5ede49f` — "feat: open school operations independently of cricket fixtures"  
**Report Date:** 2026-09-30

## Repositories Examined

### Source: `/home/user/scrbrd`

**Technology Stack:**
- **Frontend Framework:** Next.js 16 (React 19) with Vite build
- **Styling:** Tailwind CSS 4.2.1
- **UI Components:** shadcn/react with Base UI, Radix UI, lucide-react
- **ORM:** Drizzle 0.45.2
- **Database:** Cloudflare D1 (SQLite) with Drizzle migrations
- **Hosting:** Wrangler (Cloudflare Workers) / Vite / Next.js
- **Backend API:** Next.js API routes
- **Forms:** React Hook Form + Zod validation
- **Charts:** Recharts
- **Notifications:** Sonner
- **Date/Time:** date-fns

**Last Commit:** `5ede49f` (feat: open school operations independently of cricket fixtures)  
**Import Approach:** 173 source files imported from verified source at `6b6b3cbc` with hashes verified.

### Destination: `/home/user/SCRBRD_OS`

**Technology Stack:**
- **Frontend Framework:** Vite + React 18 (no Next.js)
- **Styling:** Inline CSS modules (no Tailwind in web package)
- **UI Components:** lucide-react + custom components
- **Database:** PostgreSQL with Supabase
- **ORM:** SQL with RLS policies (native Postgres)
- **Hosting:** Render (backend) + Firebase Hosting (web static)
- **Backend API:** Node.js services in `services/api/`
- **Authorization:** Row-Level Security (RLS) + capability-based RBAC
- **Package Structure:** Monorepo with `packages/{policy, scoring, sync}`

---

## Inventory Summary

| Status | Count | Details |
|--------|-------|---------|
| **Not in OS** | 8 | Scorecard importer, match setup flows, communications UI, offline session handling, onboarding wizard, workspace management features |
| **Already in OS** | 15 | Dashboard views, news/notifications, profiles, analytics, league tables, match centre, settings, safeguarding, squad management, staff records |
| **Planned in OS** | 7 | Sports science/injury views, duty status lifecycle, escalation rosters, operational features (via SCRBRD backlog) |

---

## Detailed Inventory

### Not in OS — Key Differences

| Item | What It Is | Path in scrbrd | Status in OS | Evidence |
|------|-----------|---|---|---|
| **Scorecard Importer** | Visual OCR-driven scorecard import tool with image zoom, cell editing, and source tracking | `apps/product/components/scrbrd/scorecard-importer.tsx` + API routes `scorecard-imports/[id]/*` | Not in OS | Not found in views/; no scorecard import UI in backlog |
| **Match Setup/Team Assignment** | Pre-match configuration screen: toss, teams, XI selection, captain/keeper assignment, match conditions | `apps/product/components/scrbrd/match-setup.tsx` | Partial in OS | `PitchDeckView.jsx` exists but primarily for pitch/field assignments, not full XI setup; `SCRBRD-037` (match-day duty) planned differently |
| **Communications Module** | News/notifications admin UI: draft posts, scheduled release, role-scoped visibility, approval workflow | `apps/product/components/scrbrd/communications.tsx` + `/api/communications*` | Partial in OS | `NewsView.jsx` and `NotificationsView.jsx` in OS; communications API exists in SCRBRD_OS but lacks the admin composition UI seen in scrbrd |
| **Offline Session Boundary** | Session lock recovery after network loss; prevents scorer sign-out without recovery token | `apps/product/components/scrbrd/offline-session-boundary.tsx` | Planned in OS | `SCRBRD-010` covers offline/handover walks; implementation details differ (IndexedDB vs Supabase sync) |
| **Onboarding Journey** | Multi-step account setup: email→password→school/role assignment→XI roster entry | `apps/product/components/scrbrd/onboarding-journey.tsx` + `/api/onboarding` | Partial in OS | `db/98_seed_pilot.sql` includes bootstrap; no visual onboarding flow component exists |
| **Workspace RBAC Module Selector** | Tabbed role-scoped module directory with role-based module availability and access control panel | `apps/product/components/scrbrd/workspace.tsx` | Partial in OS | `ModulesView.jsx` exists; workspace access control exists in `SCRBRD-014` (module gates falsification) |
| **School Home Dashboard** | Role-specific landing page with module shortcuts, notifications, access centre, role-scoped dashboard | `apps/product/components/scrbrd/school-home.tsx` | Partial in OS | `DashboardView.jsx` in OS; scrbrd version is role-integrated at the component level vs OS modular architecture |
| **Match Scorecard Display** | Live scorecard viewer showing innings state, batting/bowling figures, recent deliveries | `apps/product/components/scrbrd/match-scorecard.tsx` | Partial in OS | `MatchCentreView.jsx` in OS shows fixtures and scores; replay and detailed scorecard rendering logic differs |

### Already in OS

| Item | What It Is | Path in scrbrd | Status in OS | Evidence |
|------|-----------|---|---|---|
| **Dashboard** | Main landing/home screen | `apps/product/app/app/page.tsx` | Built | `DashboardView.jsx` (2026-09-27) |
| **News Feed** | Posts/announcements | `apps/product/app` (communications component) | Built | `NewsView.jsx` + `db/12_news.sql` closed `SCRBRD-000` |
| **Login/Auth** | Sign-in flow | `apps/product/app/login/page.tsx` | Built | `LoginPage.jsx` in SCRBRD_OS; `SCRBRD-001` (demo labelling) closed |
| **Match Centre** | Live match display | Reference in `match-scorecard.tsx` | Built | `MatchCentreView.jsx` (2026-09-28, updated for Laws 4th ed via `db/54`) |
| **Profile Management** | Player/user profiles | Not direct in scrbrd | Built | `ProfilesView.jsx` extensive (2026-09-28); `SCRBRD-018` (NULL pupils) closed |
| **Settings** | Account and workspace configuration | Not direct in scrbrd | Built | `SettingsView.jsx` comprehensive (2026-09-28); hardened in `SCRBRD-046` (opposition window) |
| **Analytics** | Season stats, career records, performance metrics | Reference in cricket-engine | Built | `AnalyticsView.jsx` (2026-09-28); career tracking built in `db/40` (career follows fold) |
| **Squad Management** | Team rosters, player lists | Reference via fixture APIs | Built | `SquadView.jsx` (2026-09-28) |
| **League/Competitions** | League standings, tournament brackets | Not direct in scrbrd | Built | `LeagueView.jsx` (2026-09-25) + `CompetitionsView.jsx` |
| **Safeguarding** | Concern logging and routing under CSA policy | Not in scrbrd product | Built | `SafeguardingView.jsx` + `db/57_safeguarding_dso.sql` (2026-09-28); new P1 Fable brief Sep 27 |
| **Skills Assessment** | Player technical/performance ratings | Not in scrbrd product | Built | `SkillsView.jsx` (2026-09-28) |
| **Officials Management** | Umpire/referee assignment and availability | Not in scrbrd product | Built | `OfficialsView.jsx` (2026-09-25); `SCRBRD-023` (officials register UI) closed |
| **Injuries/Medical** | Health status and medical clearance | Not in scrbrd product | Built | `InjuryView.jsx` (2026-09-28); health data in `db/56` (CSA clearance) and `db/60` (workload consent) |
| **Staff Records** | Teachers, coaches, support staff | Not in scrbrd product | Built | `StaffView.jsx` (2026-09-28) |
| **Logistics** | Ground availability, transport, accommodation | Not in scrbrd product | Built | `LogisticsView.jsx` (2026-09-25) |

### Planned in OS (Backlog)

| Item | What It Is | Status in SCRBRD_OS | Backlog ID | Evidence |
|------|-----------|---|---|---|
| **Duty Status Lifecycle** | Roster with status transitions: available, delegated, suspended | Planned | `SCRBRD-034` | P2, RE-SCOPED; `db/30_duty_status.sql` in place; duty authority and time-boxing in `db/34`, `db/35` |
| **Operational Escalation Roster** | Incident response chain with primary/secondary contacts | Planned | `SCRBRD-035` | P2, RE-SCOPED; not imported as written |
| **External Sponsor/Partner Viewer** | Read-only aggregate role for sponsors | Planned | `SCRBRD-036` | P2 (no evidence of build start) |
| **Wagon Wheel Analysis** | Shot placement map with accurate names | Planned | `SCRBRD-101` | P3; requires shot placement in `db/07` (exists) |
| **Wagon Wheel Panel** | Filters, run chips, off/leg by batter hand | Planned | `SCRBRD-102` | P3 (depends on SCRBRD-101) |
| **Run/Catch Maps** | Spatial analysis of scoring patterns | Planned | `SCRBRD-103` | P3 |
| **Live Stream Overlay (Scorebug)** | Broadcast-style graphics for school streams | Planned | `SCRBRD-104` | P3 |
| **Match Centre Summary** | Enhanced summary view per Kameel's earlier design | Planned | `SCRBRD-105` | P3 |
| **Graphics Pack** | Broadcast-style cards from the fold | Planned | `SCRBRD-106` | P3 |
| **Ground Data Desk** | Commentator screen | Planned | `SCRBRD-107` | P3 |
| **Pitch Map (Hand Entry)** | Line and length capture per delivery | Planned | `SCRBRD-108` | P3 |

---

## Architecture and Data Model Differences

### Key Gaps / Design Differences

1. **Technology Stack Divergence**
   - scrbrd: Next.js 16 + Tailwind CSS + shadcn, D1/SQLite + Drizzle
   - SCRBRD_OS: Vite + React 18, PostgreSQL + native SQL + RLS
   - **Implication:** Components cannot be ported without rebuild; data models and queries differ structurally.

2. **Database & Authorization**
   - scrbrd: Simple D1 schema with role checks in application logic
   - SCRBRD_OS: PostgreSQL with row-level security (RLS), capability-based RBAC, schema versions 61+ with frozen first 9 migrations
   - **Implication:** SCRBRD_OS is production-ready for multi-tenant, PII/health-data isolation; scrbrd is single-school prototype.

3. **Reference Material & Cricket Engine**
   - **Scoring/Events:** scrbrd references `reference/cricket-engine/packages/scoring/` with laws.mjs, events.mjs, replay.mjs
   - **In OS:** Equivalent logic in `packages/scoring/` (closed `SCRBRD-002` via Laws 4th ed in `db/54`)
   - **Status:** OS has integrated this; scrbrd references package-form copy

4. **Offline Sync & Replay**
   - scrbrd: IndexedDB + sync-engine (`reference/cricket-engine/packages/sync/`)
   - SCRBRD_OS: Supabase sync + Postgres append-only event log
   - **Implication:** scrbrd's offline model is client-side caching; OS uses deterministic replay with server-as-source-of-truth.

5. **Roles & Governance**
   - scrbrd: 17 implied roles, no explicit role catalogue documented
   - SCRBRD_OS: 26 roles in `packages/policy/`, with explicit assignment and per-role module/data gates; `db/01_authz.sql` 47KB of RLS policies
   - **Implication:** SCRBRD_OS is governance-auditable; scrbrd is application-logic-only.

---

## Reference Materials & Source Documents

### In scrbrd

- **Cricket Rules Engine:** `reference/cricket-engine/packages/scoring/`
  - `laws.mjs` — ICC Laws implementation
  - `events.mjs` — Scoring event definitions
  - `replay.mjs` — Deterministic match replay
  - `readiness.mjs` — Fixture setup validation
  - `spatial.mjs` — Shot placement zones
  - Test coverage: `laws.test.mjs`, `laws-spec.test.mjs` (Laws spec conformance)

- **Sync Engine:** `reference/cricket-engine/packages/sync/`
  - Offline IndexedDB sync with conflict resolution
  - Test coverage: sync-engine.test.mjs, attach.test.mjs, held.test.mjs

### In SCRBRD_OS

- **Database Migrations:** `db/00`–`db/61` (frozen at db/01–db/09)
  - Scoring rules in `db/02_schema_scoring.sql`, `db/54_laws_4th_edition.sql`
  - Authorization in `db/01_authz.sql`, `db/09_rls_policies.sql`, `db/23_authz_time_box.sql`, `db/35_authz_suspension.sql`
  - Business rules: duty status (`db/30`), playing conditions (`db/61`), safeguarding (`db/57`)

- **Documentation:** `docs/ARCHITECTURE.md`, `docs/SCORING_RULES.md` (referenced in backlog)

- **Architecture Decision Records (ADRs):** Implied in backlog closure rationale

---

## Production Readiness Observations

| Dimension | scrbrd | SCRBRD_OS |
|-----------|--------|----------|
| **Schema Migrations** | 8 Drizzle migrations (auto-generated) | 61 versioned SQL migrations with frozen ledger |
| **Authorization** | Application-layer role checks | Row-level security + RBAC policies |
| **PII/Health Data** | D1 prototype, no explicit PII segregation | `db/56`, `db/57`, `db/58` explicit consent and segregation |
| **Audit Trail** | Not observed | `db/20` (platform reads), `db/29` (migration ledger), implicit in event append-only log |
| **Multi-Tenancy** | Single school only | Full multi-tenant via RLS (tenant = school) |
| **Safeguarding** | None | Full `db/57` + DSO roles per CSA brief |
| **Data Consent** | None | POPIA consent, workload, medical clearance in `db/60` |
| **Testing** | 72 tests in source (D1 product) | 4,129 assertions in 50 suites (Postgres) |

---

## Top 10 Items Not in OS (Priority Take List)

1. **Scorecard Importer Component** — Visual OCR-driven import from images; scrbrd shows a complete UI flow with extraction API, source image zoom, cell editing, and approval workflow. OS backlog contains no equivalent. Worth harvesting: the OCR extraction logic and cell-edit UX pattern.

2. **Match Setup Wizard** — Pre-match XI configuration with toss, team assignment, captain/keeper selection. OS has `PitchDeckView` but for field positions only. The multi-step setup UX is not in OS; related backlog item `SCRBRD-037` is narrower (duty roster, not XI setup).

3. **Communications Admin Panel** — Draft, schedule, and publish role-scoped news/notifications. OS has `NewsView` and `NotificationsView` as read-only; no composition/approval UI. The scrbrd admin panel is not replicated.

4. **Offline Session Recovery UI** — Visible recovery flow when scorer loses connection. OS has sync logic; UI affordance for recovery is not documented in backlog.

5. **Role-Scoped Workspace Dashboard** — scrbrd's `school-home.tsx` integrates role detection and module filtering at the layout level. OS has separate views; the role-integrated dashboard component is not in OS.

6. **Detailed Match Scorecard Component** — Innings-by-innings scorecard with live update capability. OS has `MatchCentreView` for fixture listing and recent scores; the detailed scorecard replay component seen in scrbrd is not isolated as a reusable view.

7. **Player/Bowler Statistics Table** — Recent deliveries, analysis cards, and performance metrics rendered from match events. OS has analytics views but not a live-match scorecard sub-component.

8. **Onboarding Visual Journey** — Multi-step account setup UI with form validation and progress. OS has bootstrap data and RLS but no guided onboarding component.

9. **Cricket Engine Reference Package** — scrbrd has the cricket-engine as a reference in `reference/cricket-engine/`. While SCRBRD_OS has its own, the scrbrd reference package structure (sync, scoring, readiness) could be a pattern reference.

10. **Drizzle ORM Migration Approach** — scrbrd uses auto-generated Drizzle migrations; SCRBRD_OS uses hand-written SQL. The Drizzle approach is simpler for prototyping but not production-safe per SCRBRD's own architecture notes.

---

## Conclusion for Reviewer

**Scope of scrbrd:** Single-school, D1-backed prototype with D1-to-Postgres migration incomplete (per PRODUCT_IMPORT.md: "production D1-to-Postgres migration remains a separate task").

**Scope of SCRBRD_OS:** Production-ready KZN pilot with PostgreSQL, multi-tenant RLS, explicit safeguarding, CSA compliance, and comprehensive audit trail.

**Harvest Decision:** The scorecard importer, match setup flow, and communications admin UI are UI patterns worth studying. The cricket-engine reference (scoring, sync, readiness logic) is already integrated into SCRBRD_OS; direct code reuse is not safe without porting to Postgres + RLS. The database and authorization models are incompatible; porting requires redesign, not copy-paste.

**Recommendation:** Prioritize the scorecard importer UI and match setup wizard as design patterns (not code). Set expectations that porting will require a rebuild on SCRBRD_OS's stack. Safeguarding and medical data handling in SCRBRD_OS exceed scrbrd scope and are non-negotiable for school production.

---

## Reviewer's verdict (Opus, 2026-09-30): what to take

The inventory above over-counts. Checked against the code, most of its "not in OS" items already exist in SCRBRD_OS in another form:

| Item | Verdict |
|---|---|
| Match setup wizard (XI, toss, captain) | **Already in OS.** `scorer/setup.jsx`, including the recorded toss (SCRBRD-067). |
| Offline session recovery | **Already in OS, and stronger.** The outbox, resume credential and sync banner (SCRBRD-075/078/079, db/50). |
| Match scorecard / player statistics | **Already in OS.** The pad's panels, Match Centre, post-match report (082), the public scorecard (db/59) and careers. |
| Onboarding journey | **Already in OS.** `auth/OnboardingFlow.jsx`. |
| Role-scoped home | **Already in OS.** Menus derive from capabilities; step 4 designs the parent and pupil versions. |
| Drizzle migrations / D1 | **Skip.** OS's hand-written, frozen SQL with RLS proofs is the stronger model. |
| Cricket engine reference | **Skip.** `packages/scoring` supersedes it (4th Edition, parity with SQL). |
| **Scorecard importer** (photo of a paper scorebook, OCR, review and edit the cells, then import) | **Take, as a new item.** OS has nothing like it. Schools score many matches on paper: away games, lower sides, and the "match elsewhere" loads in SCRBRD-110. Turning a scorebook photo into ball-by-ball or summary events would fill the careers, workload and tables. Needs a design pass (what the OCR produces, how a reviewed import becomes events in the log with a source mark, who may import, and privacy of the stored photos) before any build. |
| Communications with audience and approval | **Compare, maybe take the approval step.** OS news already scopes by anchor and has `published_at` (db/12). What scrbrd adds is a draft-then-approve step before a post reaches its audience. Worth a small backlog item if Kameel wants a second pair of eyes on posts to pupils. |
