# SCRBRD OS — Implementation Backlog

**Pass:** Focused Pass 1 · **Branch:** `claude/ui-refactor-ds2` @ `0783ed5` · **Date:** 2026-09-16

## Rules

- Order by dependency, not merely severity.
- P0/P1 foundational work precedes cosmetic refactoring.
- Every task must include evidence and acceptance criteria.
- High-risk changes require regression tests before implementation.
- Pass 1 rule honoured: **no production code was altered to produce this backlog.** Every entry is a proposal.

Cross-references: `RISK-*` → `SCRBRD_RISK_REGISTER.md`; `SEC-*` → `SCRBRD_SECURITY_RBAC_AUDIT.md`; `SCO-*` → `SCRBRD_SCORING_AUDIT.md`.

---

# P0 — Critical

None open. No finding in Pass 1 met the P0 bar (cross-tenant read/write, session without a code, destruction of production data by the shipped code path).

---

# P1 — High

## Product blockers

### SCRBRD-000

**Title:** Ship the three unreleased commits and apply `db/12_news.sql` to Supabase
**Priority:** P1 · **Domain:** Release · **Type:** product
**Affected files:** `db/12_news.sql`, `tools/bundle-sql.mjs` output, `apps/web/src/views/NewsView.jsx`, `services/api/write/news-api.mjs`, `apps/web/src/shell/Sidebar.jsx`
**Affected users:** every production user (newsfeed, sign-out)

**Current behaviour:** `37c22f7`, `d4175dc`, `0783ed5` exist only on `claude/ui-refactor-ds2`. Production Render build has no sign-out and no newsfeed; production Supabase has no `news_post`.
**Expected behaviour:** `main` carries the commits; Supabase has `db/12` in its ledger; web build deployed.
**Root cause:** work completed after the last merge/rebuild cycle.
**Recommended change:** PR → merge → regenerate `scrbrd-supabase-rebuild.sql` and `scrbrd-supabase-verify.sql` → paste rebuild, then verify → confirm 8/8 OK → Render redeploys from `main`.
**Why it matters:** RISK-PRO-001 — a web build that ships ahead of the schema turns the Newsfeed nav item into an error.
**Dependencies:** none. **Security / privacy impact:** none new. **Data migration required:** YES (`db/12`, additive).
**Tests required:** existing `db/99` newsfeed tiers section (already green); production verify bundle.
**Acceptance criteria:**
- [ ] `git log origin/main` contains `0783ed5`
- [ ] Production verify bundle returns OK in every column
- [ ] Production login → Newsfeed shows the four seeded posts for a signed-in pilot account
**Regression risk:** LOW

## Security

### SCRBRD-001

**Title:** Remove or unmistakably label the client-only "Google" entry on the production login page
**Priority:** P1 · **Domain:** Auth · **Type:** security / UX
**Affected files:** `apps/web/src/auth/LoginPage.jsx:160,241`, `apps/web/src/lib/live.js:885,961,1005`, `apps/web/src/App.jsx`
**Affected users:** every visitor to the live URL

**Current behaviour:** `onLogin("schooladmin","Demo User (Google)")` sets React state with no token; `signedIn()` is false; all reads return mock data with one "Demo data" chip.
**Expected behaviour:** on a `live` build, only a code-issued token enters the shell. If a demo is wanted on the live URL it is entered through a button labelled "Explore the demo (no data is saved)" and the shell shows a persistent banner while `!signedIn()`.
**Root cause:** the demo path predates server sessions and was never gated on `live`.
**Recommended change:** in `LoginPage.jsx` render the Google/demo entry only when `!live`, or relabel and add a `Banner` component driven by `signedIn()`.
**Why it matters:** RISK-SEC-001 / SEC-P1-01.
**Dependencies:** none. **Security / privacy impact:** removes a misleading entry point. **Data migration required:** NO
**Tests required:** browser walk: on `live`, `login-google` testid absent or labelled demo; banner present while unsigned.
**Acceptance criteria:**
- [ ] Production login page renders no un-labelled client-only entry
- [ ] While `!signedIn()`, a banner is visible on every view
- [ ] `smoke-browser-read` sweep passes
**Regression risk:** LOW

### SCRBRD-004

**Title:** Provision the owner's `superadmin` key outside `98_seed_pilot.sql`
**Priority:** P1 · **Domain:** Platform · **Type:** security
**Affected files:** new `db/13_owner_key.sql` (or a documented SQL Editor step), `db/98_seed_pilot.sql`, `DEPLOYING.md`, `db/99_rls_verify.sql`
**Affected users:** operator

**Current behaviour:** owner account `88888888-…-0022` and assignment `a5510000-…-0022` exist only in the seed, which `DEPLOYING.md` forbids on a database holding real children's data.
**Expected behaviour:** a ledger-tracked migration (idempotent `INSERT … ON CONFLICT DO NOTHING`) creates the owner's account and platform-wide `superadmin` assignment; the seed no longer does.
**Root cause:** master key was introduced during the pilot phase where seed == provisioning.
**Recommended change:** move the two INSERTs to `db/13`, reference them from `db/99` "owner's key reaches every tenant" so the test still passes on a seed-less DB.
**Why it matters:** RISK-SEC-004 — the first real pilot locks the operator out.
**Dependencies:** SCRBRD-000 (ledger state). **Security / privacy impact:** the key is highly privileged; the migration must not carry a password or code. **Data migration required:** YES (additive, idempotent).
**Tests required:** `db/99` run against a DB migrated **without** `--seed` still passes the owner section.
**Acceptance criteria:**
- [ ] `pnpm db:migrate` (no seed) then `db:verify` → owner section OK
- [ ] `98_seed_pilot.sql` no longer contains the owner rows
**Regression risk:** LOW

### SCRBRD-005

**Title:** Pseudonymise minors' names before AI calls; build StatGuru context server-side
**Priority:** P1 · **Domain:** AI / Privacy · **Type:** security
**Affected files:** `services/api/ai/ai-service.mjs`, `services/api/server.mjs:282`, `apps/web/src/lib/ai.js`
**Affected users:** every pupil whose match is scored with commentary on

**Current behaviour:** `describeDelivery({situation})` receives batter/bowler names; StatGuru receives a client-assembled context.
**Expected behaviour:** server substitutes stable per-match pseudonyms before the call and re-substitutes on return; StatGuru context is built server-side from tables the caller's tier may read.
**Root cause:** AI was added as a rendering nicety with no data-minimisation step.
**Recommended change:** `pseudonymise(situation, matchId)` map in `ai-service.mjs`; new `GET`-side context builder under RLS for StatGuru.
**Why it matters:** RISK-SEC-002 / SEC-P1-02, POPIA §19 (security safeguards) and §35 (children).
**Dependencies:** none. **Security / privacy impact:** removes third-party processing of children's names. **Data migration required:** NO
**Tests required:** unit test asserting the outbound body contains no roster name; walk asserting StatGuru refuses a client-supplied context.
**Acceptance criteria:**
- [ ] Outbound AI request bodies contain no `player.name`
- [ ] Commentary line rendered in the UI shows real names (re-substituted)
- [ ] StatGuru ignores client context
**Regression risk:** LOW

### SCRBRD-006

**Title:** Consent gate for Firebase Analytics; default off; lazy-load the SDK
**Priority:** P1 · **Domain:** Web / Privacy · **Type:** security / performance
**Affected files:** `apps/web/src/main.jsx:6`, `apps/web/src/lib/firebase.js:37,45`, landing page
**Affected users:** every visitor, including pupils

**Current behaviour:** `initializeApp` + `getAnalytics` at boot, unconditionally, inside the 970 KB main chunk.
**Expected behaviour:** analytics loads only after an explicit opt-in stored in `kv`; the Firebase chunk is a dynamic `import()`.
**Root cause:** analytics wired for launch metrics before privacy review.
**Recommended change:** `lib/analytics.js` exporting `enable()` that dynamically imports Firebase; landing-page consent control; remove the eager import from `main.jsx`.
**Why it matters:** RISK-SEC-003, RISK-ARC-002.
**Dependencies:** none. **Security / privacy impact:** positive. **Data migration required:** NO
**Tests required:** unit test that `getAnalytics` is not reached without consent; `check-bundle` main chunk shrinks by the Firebase size; `isFirebaseOfflineNoise` filter can be deleted from tests.
**Acceptance criteria:**
- [ ] No network call to Firebase before consent (browser walk intercepts requests)
- [ ] Main chunk < 800 KB
- [ ] `isFirebaseOfflineNoise` removed
**Regression risk:** LOW

## Reliability

### SCRBRD-003

**Title:** Quarantine review and release route
**Priority:** P1 · **Domain:** Scoring · **Type:** reliability / correctness
**Affected files:** `services/api/write/events-api.mjs`, `services/api/handover/scoring-session.mjs`, `db/02_schema_scoring.sql:145,164-182`, `apps/web/src/scorer/panels.jsx`, `packages/policy` (new capability or reuse `scoring.amend.approve`)
**Affected users:** scorers, anyone reading a scorecard with a quarantined ball

**Current behaviour:** stale-epoch events land in `ball_event_quarantine`; `recovered`/`resolved_at` are never set by any code path; no UI lists them.
**Expected behaviour:** a person with `scoring.amend.approve` sees the match's quarantined events, and can release (re-apply under the current epoch, `recovered = true, resolved_at = now()`) or discard (`resolved_at` only).
**Root cause:** quarantine was built as a safety valve; the exit was deferred.
**Recommended change:** `GET /api/read/quarantine?match=…`, `POST /api/quarantine/:id/release`, `POST /api/quarantine/:id/discard`; panel in Match Centre.
**Why it matters:** RISK-REL-001 / SCO-P1-02 — a lost ball is a wrong match record for ever.
**Dependencies:** SCRBRD-002 (released events must pass the same vocabulary check). **Security / privacy impact:** release is a write to canonical truth; gate on the approval capability, not on `scoring.write`. **Data migration required:** NO
**Tests required:** new `tools/smoke-quarantine.mjs`: quarantine a ball via stale epoch → list → release → replay shows it → `db/99` asserts `recovered` set.
**Acceptance criteria:**
- [ ] Released ball appears in the scorecard at its `seq`
- [ ] Scorer without approval capability gets 403 on release
- [ ] Discarded ball never re-appears
**Regression risk:** MEDIUM

## Scoring

### SCRBRD-002

**Title:** Closed dismissal vocabulary; validate at the API boundary; one predicate for the non-delivery law
**Priority:** P1 · **Domain:** Scoring · **Type:** correctness
**Affected files:** `packages/scoring/src/replay.mjs:290,336-337`, `services/api/write/events-api.mjs:88,98`, `services/api/io/import-api.mjs`, `apps/web/src/scorer/sheets.jsx:316`
**Affected users:** every bowler whose figures are computed

**Current behaviour:** `UNCREDITED` regex over free text; `run-out`, `r/o`, `RO`, `timed-out` credit the bowler; free-hit rule uses a second, narrower regex so `handled`/`obstructed` on a free hit do not stand.
**Expected behaviour:** `DISMISSAL` enum exported from `packages/scoring` (`bowled, caught, lbw, run_out, stumped, hit_wicket, handled_ball, obstructing_field, timed_out, retired_out, hit_twice`); `NON_DELIVERY = new Set([...])`; one `standsOnFreeHit()` and one `chargedToBowler()` both read from it; `events-api` and `import-api` reject any other string with 400 naming the field.
**Root cause:** the law was encoded where the display string lived, not as a type.
**Recommended change:** as above; UI list imports the enum and maps to labels. Existing `ball_event.dismissal` rows: a one-off `db/NN` normalises known variants and reports unknowns as WARNINGs.
**Why it matters:** RISK-SCO-001, -002 / SCO-P1-01.
**Dependencies:** none. **Security / privacy impact:** none. **Data migration required:** YES (normalisation of existing rows; report-only where ambiguous).
**Tests required:** `replay.test.mjs` table test over every enum value × (credited?, stands on free hit?); `write.test.mjs` 400 on unknown string; `smoke-csv` rejects an unknown dismissal in an import row.
**Acceptance criteria:**
- [ ] `r/o` at `POST /api/events` → 400
- [ ] Every enum value has a row in the wicket matrix test
- [ ] `grep -c "run ?out" packages/scoring/src` → 0
**Regression risk:** MEDIUM

## Deployment

### SCRBRD-008

**Title:** `migrate.mjs --reset` refuses non-local hosts
**Priority:** P1 · **Domain:** DB / Ops · **Type:** reliability
**Affected files:** `tools/migrate.mjs`, `package.json` (`db:reset`), `DEPLOYING.md`
**Affected users:** operator

**Current behaviour:** `pnpm db:reset` drops and reseeds whatever `DATABASE_URL` points at. The rule "never run `--reset` against Supabase" is a sentence in chat and in `DEPLOYING.md`.
**Expected behaviour:** `--reset` exits non-zero when the host is not `localhost`/`127.0.0.1`/`db` unless `I_UNDERSTAND_THIS_DESTROYS_PRODUCTION=1` is set.
**Root cause:** convention, not code.
**Recommended change:** host check before the teardown block in `migrate.mjs`.
**Why it matters:** RISK-OPS-001 — impact Critical.
**Dependencies:** none. **Security / privacy impact:** protective. **Data migration required:** NO
**Tests required:** unit test with a fake remote `DATABASE_URL` asserting refusal and exit code.
**Acceptance criteria:**
- [ ] `DATABASE_URL=postgres://x@db.supabase.co/… node tools/migrate.mjs --reset` exits 2 with a named refusal
- [ ] Local reset unchanged
**Regression risk:** LOW

---

# P2 — Medium

## Architecture

### SCRBRD-007 — `SET search_path` on every `SECURITY DEFINER` function
Files: `services/api/rls/generate-rls.mjs` (generated functions), new `db/13`/`14` for hand-written ones (`01`, `02`, `04`, `05`, `06`, `08`, `12`), `db/99` assertion `count(*)=0 FROM pg_proc WHERE prosecdef AND proconfig IS NULL` in `public`. Evidence SEC-P2-01. Dependencies: SCRBRD-004 (ledger sequencing). Migration YES. Risk LOW.

### SCRBRD-011 — Replace eleven `role === "superadmin"` view gates with `can(capability)`
Files listed in Security Audit §8. Evidence SEC-P2-02 / RISK-ARC-001. Acceptance: Director of Sport sees "Schedule Match"; `grep -rn 'role *=== *"superadmin"' apps/web/src` → only the retirement comment in `SettingsView.jsx:52`. Dependencies: none. Risk LOW.

### SCRBRD-012 — Implement or remove `platform.support.impersonate`
Files: `packages/policy/src/roles.mjs:86-96`, `capabilities.mjs:287,345`, new route. Evidence SEC-P2-03. If implemented: a `role_assignment` with `valid_until = now() + interval '1 hour'` and an audit row; `db/99` asserts expiry. Dependencies: audit log (SCRBRD-026). Risk MEDIUM.

### SCRBRD-021 — Fix `check-imports.mjs` tokeniser and unresolved-name reporting
Files: `tools/check-imports.mjs:39,105`. Evidence RISK-ARC-003; the previous attempt fell from 5140 to 26 false positives and was reverted. Acceptance: a deliberately broken import in a scratch file is reported; 0 false positives on the current tree. Risk LOW.

### SCRBRD-020 — Route-level code splitting
Files: `apps/web/src/App.jsx` VIEW_MAP → `React.lazy`. Evidence RISK-ARC-002. Dependencies: SCRBRD-006. Acceptance: main chunk < 500 KB; `check-bundle` thresholds updated. Risk MEDIUM.

## Reliability

### SCRBRD-009 — `Idempotency-Key` for the write handlers without a natural key
Files: `services/api/write/{news,training,workload,recognition,scouting,contacts}-api.mjs`, shared helper, new table `request_idempotency(key, user_id, response, created_at)` in `db/NN`. Evidence RISK-DAT-001 / SCO-P2-01. Acceptance: same key twice → identical response, one row. Migration YES. Risk LOW.

### SCRBRD-010 — Offline and handover walks: close/reopen, lost response, crash mid-handover
Files: `tools/smoke-browser-sync.mjs`, `tools/smoke-handover.mjs`, `tools/offline-browser.mjs`. Evidence RISK-REL-002, -003 / SCO-P2-02. Acceptance: three new groups, each falsified once (break the outbox drain → red). Risk LOW.

## RBAC / Privacy

### SCRBRD-013 — ADR: coach access to `medical.details.read`
Files: `docs/adr/0002-medical-tiers.md`, possibly `roles.mjs:211,228`. Evidence SEC-P2-04 / RISK-SEC-007. Decision owner: the school. Risk LOW.

### SCRBRD-014 — Falsify module gates
Files: `tools/smoke-modules.mjs`, `db/99`. Disable a module → gated write refused over HTTP **and** direct SQL → re-enable → allowed. Evidence SEC-P2-05. Risk LOW.

### SCRBRD-015 — Push payload content audit
Files: `services/api` push sender, `tools/smoke-push.mjs`. Assert no payload carries `injury.nature`/`details`. Evidence SEC-P2-05. Risk LOW.

### SCRBRD-026 — Audit log for platform-wide reads
New table + trigger or API-level log for any read performed under a `school_id NULL` assignment. Prerequisite for SCRBRD-012. Evidence Security Audit §8. Migration YES. Risk MEDIUM.

## Product completeness

### SCRBRD-016 — Reduced-overs support
Schema: `innings.overs_limit`, `revised_target`; reducer: innings end on revised limit; UI: umpire's revision entry. Evidence RISK-SCO-003. Dependencies: SCRBRD-002 (same reducer). Migration YES. Risk MEDIUM.

### SCRBRD-018 — Surface NULL-born pupils and ended guardian links on the Settings page
Files: `apps/web/src/views/SettingsView.jsx`, `read-api` resource. Evidence RISK-DAT-002; today the only record is the migration WARNING. Risk LOW.

### SCRBRD-023 — Officials register management UI
Files: new `OfficialsView.jsx`; API and RLS exist (`smoke-officials`). Evidence RISK-PRO-002. Risk LOW.

## Documentation

### SCRBRD-019 — `DEPLOYING.md`: production changes go in new `db/NN` files only
Evidence RISK-DAT-003. Risk LOW.

### SCRBRD-022 — Fold this System Map into `docs/ARCHITECTURE.md`; add the Supabase bundle deploy procedure
Evidence RISK-ARC-004. Risk LOW.

---

# P3 — Low

## Performance optimisation
- **SCRBRD-020** (also P2 dependency chain) — see above.

## Polish
- **SCRBRD-017** — Replay determinism test: shuffle `ball_event` input, assert identical scorecard; assert server sorts by `(epoch, seq)` before replay. Evidence RISK-SCO-004. Risk LOW.

## Cleanup
- **SCRBRD-024** — CI job running `pnpm verify` and `pnpm db:up && pnpm db:migrate --seed && pnpm db:verify` on every PR. Evidence RISK-OPS-002.
- **SCRBRD-025** — `bundle-sql.mjs` writes the git SHA into a `schema_migration.note` column so Supabase records which bundle it received. Evidence RISK-OPS-003. Migration YES (one nullable column).
- **SCRBRD-027** — Delete `apps/web/src/rbac/legacy-roles.js` once SCRBRD-001 and -011 land. Evidence SEC-P3-01.

---

# Dependency Graph

```text
SCRBRD-000 (ship) ──▶ SCRBRD-004 (owner key) ──▶ SCRBRD-007 (search_path)
                                              └▶ SCRBRD-026 (audit log) ──▶ SCRBRD-012 (impersonate)
SCRBRD-002 (dismissal enum) ──▶ SCRBRD-003 (quarantine release)
                             └▶ SCRBRD-016 (reduced overs)
                             └▶ SCRBRD-017 (determinism test)
SCRBRD-006 (analytics consent) ──▶ SCRBRD-020 (code splitting)
SCRBRD-001 (login page) ──┐
SCRBRD-011 (capability gates) ──┴▶ SCRBRD-027 (delete legacy-roles)
SCRBRD-009 (idempotency) — independent
SCRBRD-010 (offline walks) — independent, should land BEFORE SCRBRD-003 (regression net)
SCRBRD-008 (reset guard) — independent, do first: five lines, Critical impact
SCRBRD-005 (AI pseudonyms) — independent
SCRBRD-024 (CI) — independent, protects everything after it
```

# Recommended Execution Order

1. **SCRBRD-008** reset guard — smallest change, Critical impact, no dependencies.
2. **SCRBRD-000** ship the branch; Supabase rebuild with `db/12`.
3. **SCRBRD-024** CI on every PR — every later item then has a net.
4. **SCRBRD-001** production login page; **SCRBRD-006** analytics consent; **SCRBRD-005** AI pseudonyms — the three P1 privacy/trust items, all independent.
5. **SCRBRD-004** owner key migration — before any real pilot.
6. **SCRBRD-010** offline/handover walks, then **SCRBRD-002** dismissal enum, then **SCRBRD-003** quarantine release.
7. **SCRBRD-009** idempotency; **SCRBRD-011** capability gates; **SCRBRD-007** search_path.
8. Remaining P2/P3 in ID order.

# Blocked Work

| Task | Blocked by | Reason |
|---|---|---|
| SCRBRD-012 impersonate | SCRBRD-026 | "audited" is in the capability's own description; cannot be implemented without a log to write to |
| SCRBRD-003 quarantine release | SCRBRD-002 | a released event must pass the same vocabulary check as a fresh one |
| SCRBRD-020 code splitting | SCRBRD-006 | Firebase is the largest single removable chunk; split after it is lazy |
| SCRBRD-027 delete legacy-roles | SCRBRD-001, -011 | login page and view gates still read it |
| SCRBRD-007 search_path | SCRBRD-004 | both add ledger files; sequence them to avoid a ledger conflict on production |
