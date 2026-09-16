# SCRBRD OS — Full Audit

**Pass:** Focused Pass 1 · **Branch:** `claude/ui-refactor-ds2` @ `0783ed5` · **Date:** 2026-09-16
**Scope of this pass:** §1 Executive Summary, §2 Repository Health, Top 10 Problems, Audit Conclusion. §3 points to the System Map. §§4–30 and Top 10 Opportunities are **not covered** in Pass 1 and are left as the brief's template. Sections the focused pass did populate live in their own documents: `SCRBRD_SYSTEM_MAP.md`, `SCRBRD_SECURITY_RBAC_AUDIT.md`, `SCRBRD_SCORING_AUDIT.md` (partial), `SCRBRD_RISK_REGISTER.md`, `SCRBRD_IMPLEMENTATION_BACKLOG.md`.

## 1. Executive Summary

### Overall state
SCRBRD OS is a genuinely database-authoritative system. Authorisation is one Postgres function (`app_can`) behind RLS on every one of 74 tables, with policies generated from a single policy package rather than hand-written; the match record is an event log replayed by a pure reducer; every API write runs inside a transaction that rolls back on error. Those three decisions hold up under falsification — each guard tested tonight went red when broken and green when restored. The most recent work (guardian majority expiry, DOB enforcement, enrolment atomicity, owner master key, sign-out, newsfeed) is tested end to end: 1544 unit assertions, 2146 API-walk assertions, 305 browser assertions, 171 database assertions, all passing on a fresh database.

The weaknesses are at the **edges**, not the core: what a visitor sees on the live URL before they have a code, what leaves the platform to third parties, how the operator gets their own key onto a real production database, and two scoring paths (free-text dismissal, quarantine with no exit) where the law is encoded loosely or the safety valve has no release.

### Production-readiness classification
- **Demo:** READY. The live URL runs the full shell on mock data; verify bundle 8/8 OK on production Supabase.
- **Pilot:** READY WITH CONDITIONS — the P1 items SCRBRD-000, -001, -004, -005, -006, -008 must land before a real child's data is admitted. None is more than a day's work; all have tests specified.
- **Production:** NOT YET. Requires the pilot conditions plus SCRBRD-002, -003 (scoring integrity), -007 (defence in depth), -009 (idempotency), -026 (audit log), and a Pass 2 covering the sections this pass did not.
- **Scale:** NOT ASSESSED. No load, index, or historical-volume testing was performed (Scoring Audit §17 not covered).

### Highest-risk finding
**RISK-SEC-004 / SCRBRD-004:** the owner's `superadmin` master key is provisioned only by `db/98_seed_pilot.sql`, and `DEPLOYING.md` forbids that seed on any database holding a real child's data. As written, the first real pilot has no operator key. Closely followed by **RISK-SEC-001**: the production login page's "Google" entry is client-only and lands visitors in mock demo mode with one small chip to say so.

### Strongest architectural decision
Generating RLS from `packages/policy` and routing every decision through `app_can()` with liveness (`valid_until > current_date`) on both `role_assignment` and `assignment_subject`. It is what made "guardianship ends on the 18th birthday" a one-file change with a one-section test, and it is why cross-tenant and cross-child access was not found anywhere in this pass.

### Most important product opportunity
Not assessed in Pass 1 (Top 10 Opportunities deferred). The single observation from the evidence: the DB already authorises Directors of Sport and other roles to do things the UI hides behind `role === "superadmin"` (11 gates). Fixing SCRBRD-011 unlocks existing capability at near-zero cost.

---

## 2. Repository Health

All results from this container on `0783ed5`, fresh `pnpm install`, fresh local database (`docker` Postgres 16, `db/00`–`db/12` + `98_seed_pilot.sql`). Where a check was run as its components rather than as the single package script, that is stated.

| Check | Result | Evidence / Notes |
|---|---|---|
| Install | PASS | `pnpm install` clean; no peer warnings acted on. |
| Test | PASS | `pnpm test` → `tools/run-all-tests.mjs`, **1544** assertions including `dob` (29), `design` (contrast/ΔE), `replay`, `phases`, `rating`, `rubric`, `write`. |
| Imports | PASS | `pnpm check:imports`. Known blind spot: `check-imports.mjs:105` skips names nothing exports; `codeOf()` (`:39`) mis-tokenises apostrophes in comments (RISK-ARC-003). |
| Build | PASS | `pnpm build`; main chunk `index-HZv-z_aC.js` 993,446 bytes (~970 KB), Firebase `index.esm-*.js` 38,394 bytes. |
| Bundle | PASS | `pnpm check:bundle`. Note: the 970 KB main chunk passes the current threshold. |
| DB verify | PASS | `pnpm db:verify` → `db/99_rls_verify.sql` **171** assertions, all OK, including tonight's new sections (DOB constraint, guardianship ends at 18, enrolment leaves nothing behind, owner's key reaches every tenant, newsfeed tiers). Production Supabase: verify bundle **8/8 OK** (user screenshot). |
| API smoke | PASS | `pnpm smoke:api` → **2146** assertions across 60+ `smoke-*.mjs` walks including `enrol` (31), `guardian`, `csv`, `roster-add`, `scorer` (Pro Mode group), `handover` (35), `sync` (52). |
| Browser smoke | PASS | `pnpm smoke:browser` → **305** assertions; includes enrolment group, sign-out group (IndexedDB inspection), full `nav-*` sweep (no destination lands on null). |
| Full verify | **NOT RUN as one command** | `pnpm verify` chains test → imports → build → bundle → smoke → smoke:api. Every component above was run and passed individually in this session; the single chained invocation was not executed. Likewise `pnpm db:up` (docker compose) was not used — Postgres was started directly with `pg_ctlcluster 16 main start` after a stale-pid failure. SCRBRD-024 puts both in CI. |

Additional health observations:
- **Migrator discipline holds.** `schema_migration` ledger hash-checks applied files; a changed applied file is REFUSED. New work on existing DBs goes in `db/10`, `11`, `12` (forward-only, `NOT VALID` where legacy rows exist). Pilot convention (edit `0x` + `--reset-objects`) is documented as demo-only.
- **Falsification record.** Guards broken and restored this session, each observed red then green on a fresh DB: guardian majority predicate, guard-before-INSERT ordering, `enrol_person` subtransaction, sign-out storage, DOB constraint, owner key reach, newsfeed tiers, Pro Mode render.
- **Unshipped.** `origin/main..HEAD` = `37c22f7`, `d4175dc`, `0783ed5`. `db/12_news.sql` is not on production (RISK-PRO-001).
- **Docs.** `docs/ARCHITECTURE.md`, `AUTH_SPEC.md`, `SCORING_RULES.md`, `SCORING_HANDOVER_SPEC.md`, three reconciliation specs, one ADR. No root `ARCHITECTURE.md`.

---

## 3. Actual Architecture

See `SCRBRD_SYSTEM_MAP.md`.

## 4. Product Capability Map
*Not covered in Pass 1.*

## 5. Data Architecture
*Not covered in Pass 1.* (Partial evidence: `SCRBRD_SYSTEM_MAP.md` §5; migration discipline above.)

## 6. Cricket Scoring Integrity
See `SCRBRD_SCORING_AUDIT.md` (partial: §1, §2, §4 bowler credit, §10–16, §18–19).

## 7. Offline + Sync Integrity
See `SCRBRD_SCORING_AUDIT.md` §11–14.

## 8. Authentication
See `SCRBRD_SECURITY_RBAC_AUDIT.md` §3.

## 9. RBAC
See `SCRBRD_SECURITY_RBAC_AUDIT.md` §4, §8, §9.

## 10. Multi-Tenancy
See `SCRBRD_SECURITY_RBAC_AUDIT.md` §5.

## 11. POPIA / Minor Data Risks
See `SCRBRD_SECURITY_RBAC_AUDIT.md` §13–14.

## 12. Security
See `SCRBRD_SECURITY_RBAC_AUDIT.md` §10, §15.

## 13. API Architecture
*Not covered in Pass 1* beyond the write path and idempotency table (`SCRBRD_SCORING_AUDIT.md` §12).

## 14. Front-End Architecture
*Not covered in Pass 1* beyond bundle size and the eleven role-string gates.

## 15. UI/UX
*Not covered in Pass 1.*

## 16. Mobile
*Not covered in Pass 1.*

## 17. Accessibility
*Not covered in Pass 1.* (`design.test.mjs` contrast rule and `smoke-a11y.mjs` both PASS.)

## 18. Performance
*Not covered in Pass 1* beyond bundle size.

## 19. Reliability
See `SCRBRD_RISK_REGISTER.md` Reliability / Offline.

## 20. Testing
See §2 above and the Required Regression tables in the Security and Scoring audits.

## 21. Deployment
See `SCRBRD_SYSTEM_MAP.md` §1 (Deploy row) and `SCRBRD_RISK_REGISTER.md` Deployment / Operations.

## 22. Documentation Drift
*Not covered in Pass 1* beyond RISK-ARC-004 and RISK-DAT-003.

## 23. Legacy / Duplicate Code
See `SCRBRD_SYSTEM_MAP.md` §7.

## 24. Missing Functionality
Partial: quarantine release, reduced overs, officials UI, impersonate — see backlog SCRBRD-003, -016, -023, -012.

## 25. Product Opportunities
*Not covered in Pass 1.*

## 26. Technical Debt
See backlog P2 Architecture.

## 27. Product Debt
*Not covered in Pass 1.*

## 28. Design Debt
*Not covered in Pass 1.*

## 29. Security Debt
See `SCRBRD_SECURITY_RBAC_AUDIT.md` §15.

## 30. Recommended Target Architecture
*Not covered in Pass 1.* The current architecture (policy-generated RLS, event-sourced scoring, transactional API) is the recommended target; the backlog hardens edges rather than redirecting it.

---

# Top 10 Problems

| Rank | Finding | Priority | Consequence | Evidence |
|---:|---|---|---|---|
| 1 | Owner's master key exists only in the pilot seed, which must not run on production | P1 | Operator lockout on the first real pilot | Security Audit §8; `db/98_seed_pilot.sql`; `DEPLOYING.md` |
| 2 | Production login page "Google" entry is client-only; visitors land in mock demo mode | P1 | Misleading evaluation; users may believe entries are saved | `LoginPage.jsx:160`; `api.js:50`; `live.js:885` |
| 3 | Pupils' names sent to a third-party AI model; StatGuru context client-assembled | P1 | POPIA exposure for children's information | `server.mjs:282`; `ai-service.mjs:41-42` |
| 4 | Firebase Analytics at boot with no consent | P1 | Personal information processed without consent; 970 KB bundle | `main.jsx:6`; `firebase.js:37,45` |
| 5 | Dismissal law as regex over free text; four spellings credit the bowler; two regexes disagree on free-hit | P1 | Wrong bowling figures from any non-UI producer | `replay.mjs:290,336`; `events-api.mjs:88,98` |
| 6 | Quarantine has no release path | P1 | A quarantined ball is lost to the scorecard for ever | `db/02:145,164-182`; no route found |
| 7 | `pnpm db:reset` will run against any `DATABASE_URL` | P1 | Destruction of production data by convention failure | `tools/migrate.mjs`; `package.json` |
| 8 | Three commits + `db/12` unshipped | P1 | Newsfeed nav item fails on production once the build ships | `git log origin/main..HEAD` |
| 9 | 79 `SECURITY DEFINER` functions without `SET search_path` | P2 | Latent privilege escalation if `scrbrd_app` ever gains CREATE | `grep search_path db/*.sql` → 0 |
| 10 | Eleven `role === "superadmin"` view gates hide authorised controls | P2 | Director of Sport cannot schedule a match the DB lets them schedule | Security Audit §8 file list |

# Top 10 Opportunities
*Not covered in Pass 1.*

# Audit Conclusion

The core of SCRBRD OS — authorisation, tenancy, guardianship, and the match record — is built on decisions that survived being attacked tonight, and it is tested to a depth (171 database assertions, 2146 API assertions, falsification of every new guard) that most systems at this stage do not reach. No P0 was found: no cross-tenant or cross-child access path, no session minted without a code in production, no destructive code path in the shipped build.

The eight P1 items are all edge conditions and all small. Six of them (ship, login page, owner key, AI pseudonyms, analytics consent, reset guard) are pre-conditions for admitting a real child's data and should be done in the order the backlog gives, starting with the five-line reset guard. The two scoring items (dismissal vocabulary, quarantine release) are correctness debts that will surface the first time a match is imported or a handover goes wrong.

Everything in this document is either cited to a file and line, observed at runtime, or marked `NOT VERIFIED`. Pass 2 should take the `NOT VERIFIED` list as its starting scope.
