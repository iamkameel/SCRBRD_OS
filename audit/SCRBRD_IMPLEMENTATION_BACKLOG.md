# SCRBRD OS — Implementation Backlog

**Pass 1:** Focused · `claude/ui-refactor-ds2` @ `0783ed5` · 2026-09-16
**Pass 2:** Harvest from the `scrbrd-beta-2` prototype · `claude/ui-refactor-ds2` @ `bdf837e` · 2026-09-18

## Rules

- Order by dependency, not merely severity.
- P0/P1 foundational work precedes cosmetic refactoring.
- Every task must include evidence and acceptance criteria.
- High-risk changes require regression tests before implementation.
- Pass 1 rule honoured: **no production code was altered to produce this backlog.** Every entry is a proposal.
- Pass 2 rule: an entry may only claim a gap that was **checked against the tree**, and an entry whose
  cost includes a production paste says so in its own line rather than in a footnote.
- Closed entries are struck through with the commit that closed them, never deleted — the same rule the
  migration ledger follows, for the same reason.

Cross-references: `RISK-*` → `SCRBRD_RISK_REGISTER.md`; `SEC-*` → `SCRBRD_SECURITY_RBAC_AUDIT.md`; `SCO-*` → `SCRBRD_SCORING_AUDIT.md`.

---

# P0 — Critical

None open. No finding in Pass 1 met the P0 bar (cross-tenant read/write, session without a code, destruction of production data by the shipped code path).

---

# P1 — High

## Product blockers

### ~~SCRBRD-000~~ — CLOSED

> Closed. `origin/main` carries 188 commits through `c1abbba`; `db/12_news.sql` is in the ledger.

**Title:** ~~Ship the three unreleased commits and apply `db/12_news.sql` to Supabase~~
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

### ~~SCRBRD-021~~ — CLOSED · Fix `check-imports.mjs` tokeniser and unresolved-name reporting

> Closed. The tokeniser handles `{...spread}` and JSX prose; `tools/check-imports.test.mjs` carries the
> spread regression as a named case and runs in `run-all-tests`. 72 modules, 0 missing imports.
Files: `tools/check-imports.mjs:39,105`. Evidence RISK-ARC-003; the previous attempt fell from 5140 to 26 false positives and was reverted. Acceptance: a deliberately broken import in a scratch file is reported; 0 false positives on the current tree. Risk LOW.

### ~~SCRBRD-020~~ — CLOSED · Route-level code splitting

> Closed. `view()` + `React.lazy` in `App.jsx`; `tools/check-bundle.mjs` enforces a 500 KB entry ceiling
> (currently 339 KB) and asserts the views, the scorer, Firebase and three.js are all outside it.
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
- ~~**SCRBRD-024**~~ — **CLOSED.** `.github/workflows/ci.yml` runs the suites, `migrate --reset --seed && migrate --verify`, and the RLS-output diff on every PR. Evidence RISK-OPS-002.
- **SCRBRD-025** — `bundle-sql.mjs` writes the git SHA into a `schema_migration.note` column so Supabase records which bundle it received. Evidence RISK-OPS-003. Migration YES (one nullable column).
- **SCRBRD-027** — Delete `apps/web/src/rbac/legacy-roles.js` once SCRBRD-001 and -011 land. Evidence SEC-P3-01.

---

# Pass 2 — Harvested from the `scrbrd-beta-2` prototype

`iamkameel/scrbrd-beta-2` is a Next.js/Firebase design prototype, and partly downstream of this
repository rather than ahead of it — `src/components/scrbrd/performanceRatingEngine.ts` opens
*"Derived from SCRBRD_OS packages/scoring/src/rating.mjs"*, and its `placementEngine.ts` reimplements the
clock convention already in `packages/scoring/src/placement.mjs`. Its views carry hardcoded defaults
(`currentRunRate = 7.42`) and its `PermissionViewContext` simulates roles client-side with no server
check. **None of its code is proposed for adoption.**

What it does carry is a governance document — `Roles&Duty.md`, 1,516 lines — and a set of product
concepts that this tree does not have. Every entry below was checked against the tree before it was
written; several describe boundaries SCRBRD OS **already honours and does not assert**, which is why
they sit at P1 despite costing nothing.

Two things were deliberately **not** harvested, and are recorded here so the decision is not re-made:

- `src/services/aiMatchReporter.ts` fabricates a press release with hardcoded figures and an invented
  quote attributed to a named head coach. `src/services/aiCoachAssistant.ts` presents
  `if (dotBallPercentage > 45)` branches as AI diagnosis. Both are the class of thing removed from
  Analytics in `c1abbba`. Two *shapes* inside them are worth keeping and appear as SCRBRD-051.
- `src/contexts/PermissionViewContext.tsx` — a client-side `SIMULATED_ROLES` list defaulting to
  "Super Admin". The RLS architecture exists so this cannot work.

## P1 — Governance boundaries that exist but are not asserted

### SCRBRD-028

**Title:** Separation-of-duties and production-rule invariants as named tests
**Priority:** P1 · **Domain:** RBAC · **Type:** test
**Affected files:** `packages/policy/test/separation.test.mjs` (new), `tools/run-all-tests.mjs`
**Affected users:** none directly; protects every user of every role

**Current behaviour:** every policy suite asks whether a role *can* do what it is meant to. Nothing asks
what a role must never reach. Granting a capability is a one-line change that makes a screen work, and
nothing anywhere fails when that same line hands a scout a minor's phone number.
**Expected behaviour:** `Roles&Duty.md` §11 (seven separation rules) and §21 (twelve production "nevers")
are assertions over the real capability sets, run in `run-all-tests`.
**Root cause:** the boundaries were designed into `roles.mjs` and documented in comments, never encoded.
**Recommended change:** landed — see acceptance criteria.
**Why it matters:** the rules mostly describe the tree **as it already is**. The value is that they can no
longer be undone by accident, and that the suite names the four rules it cannot check mechanically
instead of dropping them.
**Dependencies:** none. **Security / privacy impact:** additive assurance. **Data migration required:** NO
**Tests required:** the suite is the deliverable. Falsified by granting `scout` `player.pii.read` (§11.7
and §21.5 both go red) and by emptying the recorded-exception list (§11.2 reports both roles).
**Acceptance criteria:**
- [x] §11.1–§11.7 and the checkable half of §21 assert against `ROLE_CAPABILITIES`
- [x] Recorded exceptions each carry a reason, and each is checked to still be a real crossing
- [x] §21.1 is a ratchet on role-string view gates that may fall and never rise
- [x] The four prose-only rules are printed with the reason each resists assertion
**Regression risk:** NONE — no production code path is touched.

### SCRBRD-029

**Title:** One pair of hands can request and approve a correction to a locked match
**Priority:** P1 · **Domain:** RBAC / Scoring · **Type:** security
**Affected files:** `packages/policy/src/roles.mjs` (`directorofsport`, `competitionadmin`), new `db/NN`
**Affected users:** every school and competition whose scoring disputes are settled by those two roles

**Current behaviour:** `capabilities.mjs:127-130` states the intent outright — *"an approval one person can
give themselves is a formality. `scoring.correct` is held by the scorer … and the approval is deliberately
not."* But `directorofsport` and `competitionadmin` hold **both** `scoring.correct` and
`scoring.amend.approve`, and `directorofsport` also holds `scoring.edit`. Either can amend a locked match
unilaterally, and the DoS can append balls to a live one as well.
**Expected behaviour:** whoever approves an amendment does not also request it. The Director of Sport is
the escalation target for a scoring dispute, so the approval is the capability to keep and
`scoring.correct` is the redundant one in that pair of hands.
**Root cause:** both roles were given the scoring block wholesale; the two-capability split was applied to
the scorer and not re-applied upward.
**Recommended change:** drop `scoring.correct` from `directorofsport` and `competitionadmin`, keeping
`scoring.amend.approve`. Then delete the entry from `KNOWN` in `separation.test.mjs` — the suite fails
until it is removed, which is the intended sequence.
**Why it matters:** the guard the codebase says it has, in the file that says it, is not the guard it has.
**Dependencies:** SCRBRD-028 (records it). **Security / privacy impact:** closes a self-approval path.
**Data migration required:** **YES** — a capability change after go-live is `roles.mjs` + a new `db/NN` +
a `WITHDRAWN_SINCE_01` entry in the generator + a production paste (ARCHITECTURE.md §9). Should ride with
the next ledger file rather than alone.
**Tests required:** `separation.test.mjs` with `KNOWN` emptied; `authorize.test.mjs`; the RLS-output diff.
**Acceptance criteria:**
- [ ] Neither role holds both halves
- [ ] `KNOWN` is empty and the suite is green
- [ ] Production verify bundle returns OK in every column
**Regression risk:** MEDIUM — a DoS who currently corrects a match by themselves will need a scorer to
request it. That is the point, and it needs saying to the pilot schools before it ships.

### SCRBRD-030

**Title:** Sensitivity tiers 0–4, refining the binary `SENSITIVE` set into an ordered scale
**Priority:** P1 · **Domain:** RBAC / Privacy · **Type:** architecture
**Affected files:** `packages/policy/src/capabilities.mjs`, `packages/policy/src/tables.mjs`,
`services/api/rls/rls.test.mjs`, `db/99_rls_verify.sql`
**Affected users:** none directly; changes what the RLS suite is able to assert

**Current behaviour:** `capabilities.mjs` exports `SENSITIVE` — 9 capabilities, a flag. The distinction
between public and internal-operational data is not represented at all, and the 243 RLS assertions are
each written per policy, so a new table gets a boundary only if somebody writes one for it.
**Expected behaviour:** `Roles&Duty.md` §2.3's five levels — 0 Public, 1 Internal Operational,
2 Restricted Personal, 3 Highly Sensitive, 4 Ultra-Restricted — as an ordered classification on capability
(and where useful, on masked column group), with a **class-level** assertion: no level-3 field is reachable
by a capability cleared to level 2.
**Root cause:** `SENSITIVE` was added for the one question being asked at the time.
**Recommended change:** add `LEVEL` to `capabilities.mjs` keyed by capability, derive `SENSITIVE` from it
(level ≥ 2) so there is one source; assert monotonicity in `rls.test.mjs`.
**Why it matters:** the single highest-leverage change available to the RLS suite — it turns per-policy
assertions into a per-class one, so a new table is covered by default instead of by diligence.
**Dependencies:** none. **Security / privacy impact:** assurance only. **Data migration required:** NO —
classification is policy-side; `db/09` is regenerated from it only if a policy expression changes.
**Tests required:** `rls.test.mjs` class assertion; `modules.test.mjs` unchanged; RLS-output diff must be
empty if no expression changed.
**Acceptance criteria:**
- [ ] Every one of the 81 capabilities carries a level
- [ ] `SENSITIVE` is derived, not listed
- [ ] An assertion fails when a capability's level is lowered below the field it reaches
**Regression risk:** LOW if the RLS output diff stays empty; MEDIUM if it does not, which would mean the
classification disagrees with a shipped policy and is itself the finding.

### SCRBRD-031

**Title:** Name workflow-state as the fourth authorisation layer
**Priority:** P1 · **Domain:** RBAC · **Type:** architecture / documentation
**Affected files:** `packages/policy/src/authorize.mjs`, `docs/ARCHITECTURE.md`, write handlers
**Affected users:** none directly

**Current behaviour:** `Roles&Duty.md` §2.1 requires every action to pass four controls — role, scope,
relationship, **workflow state**. The first three are implemented (`authorize()`, team/subject scope,
guardian and self relationships, plus `db/23`'s time-box). `workflow_state` returns **zero hits** in the
tree. The fourth control exists, scattered through write handlers as *"you may amend while the innings is
open"* — correct behaviour with no name, so it cannot be enumerated, tested as a class, or audited.
**Expected behaviour:** the dimension is named, `authorize()` (or a sibling) takes it, and the write
handlers declare which state they require instead of checking inline.
**Root cause:** grew per-handler as each write was built.
**Recommended change:** inventory the implicit state checks first — the inventory is the deliverable, and
it decides whether this is a signature change or only documentation.
**Why it matters:** an unnamed control cannot be shown to be complete. It is also the layer that
SCRBRD-034's duty lifecycle needs in order to expire a fixture-scoped role.
**Dependencies:** informs SCRBRD-034. **Security / privacy impact:** none directly. **Data migration:** NO
**Tests required:** `authorize.test.mjs`; whichever write walks cover the states found.
**Acceptance criteria:**
- [ ] Every implicit workflow-state check in the write handlers is listed with its state
- [ ] `docs/ARCHITECTURE.md` describes four layers, not three
- [ ] A test asserts at least one write refused purely on state, with role and scope both valid
**Regression risk:** LOW as an inventory; MEDIUM if it becomes a signature change.

### ~~SCRBRD-032~~ — CLOSED

> Closed. `docs/adr/0003-job-titles-are-not-roles.md`, cross-referenced from
> `ARCHITECTURE.md` §1 and §4. The two tests are different data access or different
> approval authority; the three alternatives are a scope, a record of its own, or a
> specialism. Captaincy already followed the second — `honour.kind` in `db/08` — which
> is the worked example the ADR points at rather than a pattern it invents.

**Title:** ~~ADR — job titles that must not become RBAC roles~~
**Priority:** P1 · **Domain:** RBAC · **Type:** documentation
**Affected files:** `docs/adr/0003-job-titles-are-not-roles.md` (new)
**Affected users:** none directly; governs every future role request

**Current behaviour:** 25 roles. `Roles&Duty.md` proposes 35 and simultaneously argues in §15 against
exactly that: captain, vice-captain, batting/bowling/fielding/wicketkeeping coach, assistant scorer,
first-aid volunteer, tour organiser, social-media editor, statistician, teacher-in-charge, house master and
age-group coordinator should be **assignment attributes, specialisms or permission bundles** — never new
roles — unless they need different data access or approval authority.
**Expected behaviour:** the rule is written down with the test a role request must pass.
**Root cause:** no recorded principle, so each request is argued from scratch and the pressure is one-way.
**Recommended change:** ADR stating the test — *does this title need different data access or different
approval authority? If not, it is an attribute* — with the beta-2 list as worked examples, and the
counter-example from the prototype itself: it ships a `CaptainCockpitView` **and** a
`CaptainTacticalCockpit` while its own §15 says captain is an attribute. The resolution is the ADR's
point: a cockpit scoped by `isCaptain`, not a `captain` role.
**Why it matters:** every added role multiplies the RLS matrix, and `roles.mjs` + `db/NN` + a paste is the
cost of getting one wrong.
**Dependencies:** none. **Security / privacy impact:** prevents role explosion. **Data migration:** NO
**Tests required:** none. `separation.test.mjs` is where a role added against the ADR shows up.
**Acceptance criteria:**
- [ ] ADR committed with the test and the worked examples
- [ ] Referenced from `docs/ARCHITECTURE.md`'s RBAC section
**Regression risk:** NONE

## P2 — Concepts the tree does not have

### SCRBRD-033 — Role-entry briefing: what this role may not do, and who it hands off to
`roles.mjs` encodes what a role *may* do. Nothing tells a person what they may **not** do or who receives
the next decision. `Roles&Duty.md` §4–§9 gives every role a *Must not* and a *Hand-offs* section, and
beta-2 renders it at sign-in (`src/ai/flows/onboarding-briefing.ts`) as summary, responsibilities,
operational boundaries, hand-off protocol and recommended display mode. Beta-2 asks an LLM and keeps a
hardcoded fallback; **this tree can derive the boundaries** — `ungrantedCapabilities` is already an export
of `roles.mjs`, so the "must not" list is computed, not written. The hand-off is the one part that is
editorial and belongs in `roles.mjs` beside the capability set. Files: `packages/policy/src/roles.mjs`,
`apps/web/src/views/` (a briefing surface), the role switcher. Risk LOW. Migration NO.

### SCRBRD-034 — Duty status lifecycle, including `delegated`
§16: `pending / active / delegated / completed / suspended / expired / revoked`, distinct from the role
assignment — *"a person may remain historically recorded as the scorer for a completed fixture while no
longer retaining active scoring permission."* `role_assignment` already carries `valid_from`,
`valid_until`, `expires_at`, `granted_by`, `withdrawn_at`, `withdrawn_by`; §13 adds `status`, `reason` and
`approved_by`, and *"temporary elevated access requires reason and expiry"* — which the support-access path
currently takes on trust. `delegated` is the state handover has no name for. Files: new `db/NN`,
`packages/policy/src/authorize.mjs`. Depends on SCRBRD-031. Risk MEDIUM. **Migration YES.**

### SCRBRD-035 — Operational escalation roster
§12: 18 rows of issue → primary owner → escalates to (guardian-link dispute → School Admin →
Safeguarding; locked-score dispute → Match Commissioner → league governance; suspected unauthorised access
→ Compliance → Super Admin **and** Audit Reviewer). `tools/smoke-escalation.mjs` is about *privilege*
escalation and is a different thing entirely — this routing does not exist. It is content, not
engineering, and it is what the support and audit surfaces need in order to say who is next. Files: a
policy-side table, `SupportView`, `AuditView`. Risk LOW. Migration NO.

### SCRBRD-036 — External sponsor / partner viewer role, aggregate-only
§11.6. No sponsor role exists; `sponsorship.*` is held by governance roles and `finance`.
`separation.test.mjs` §11.6 already carries the assertion that will hold it to aggregate-only on the day it
is added. Note the trap the rule names: *"sponsor entitlement must never become a back door into protected
participant data."* Files: `roles.mjs`, new `db/NN`. Risk MEDIUM. **Migration YES.**

### SCRBRD-037 — Match-day duty roster that shows readiness, not names
§17.3: twelve duties (both head coaches, both managers, scorer, two umpires, commissioner, grounds,
medical, transport, media) each with a status — confirmed / pending / live / handed over / ready / issue.
The document's own line is the requirement: *"the roster should expose duty readiness, not merely names."*
Officials, transport, facilities, medical and scorer are five separate surfaces here; this is the one
screen that joins them, and "pending ≠ filled" is the same honesty as the null discipline in Analytics.
Files: new view, reads over existing resources. Risk LOW. Migration NO.

### SCRBRD-038 — Review-confirm gate before an innings closes
`scoringHubMachine.ts` has a `reviewConfirm` state and `CONFIRM_INNINGS_END { verified: boolean }`;
`ReviewConfirmModal.tsx` reads the totals back before the innings is sealed. `review_confirm` returns
**zero hits** here — there is commit, amend and handover, but no checkpoint between the last ball and a
closed innings. Cheapest available reduction in the error class that is most expensive afterwards.
Files: `apps/web/src/views/` scoring surface, `services/api/write/`. Risk LOW. Migration NO.

### SCRBRD-039 — Capture profiles: declare the intent, not just record the code path
**Corrected 2026-09-18.** The first version of this entry claimed SCRBRD OS had no capture profile. It has
one: `CAPTURE_PROFILE` in `packages/scoring/src/placement.mjs`, a `capture_profile` column on `ball_event`
with a `CHECK` in `db/07`, carried through quarantine release in `db/14`, and set by the engine per ball.
The original claim came from a grep with a broken alternation, which is exactly the failure the Pass 2 rule
above exists to prevent — recorded rather than silently edited.

The real gap is narrower and still worth having. The profile is currently a **consequence of the code path**
— a sector tap yields `standard`, a ball with no placement yields `quick` — not a **declared intent** the
scorer or the fixture chose. Nothing surfaces it, nothing aggregates it, and `evidence_label()` cannot ask
"how much was this innings ever going to capture?" So a thin figure reads as thin capture when it may be a
faithful record at a profile that never collected the field. Files: `placement.mjs`, the scoring capture UI,
`evidence_label()`, and an innings-level declared profile (a new `db/NN`, one column on the innings or
carried on `innings_start`). Risk LOW. **Migration YES** if declared per innings rather than derived from
the balls already logged.

### SCRBRD-040 — Scoring hub FSM with a named blocked state
`blockedMissingSetup` — "cannot score because toss, openers or bowler are not set" as a state that
explains itself, rather than a disabled button. The pattern already exists here
(`rubric.test.mjs`: *"the gate is legible — the rubric reports its own readiness"*); this extends it to the
scoring hub, where the gate is currently implicit. Files: scoring surface, `packages/scoring`.
Risk LOW. Migration NO.

### SCRBRD-041 — Rulebook clauses with severity and applicable ages, cited by the workload monitor
`RulebookView.jsx` exists; beta-2's *clause shape* is better — `severity: Mandatory | Guideline | Penalty
Enforced`, `applicableAges`, and categories including Curator & Turf and Medical & Safety. Making a clause
queryable lets the workload surface **cite the clause it is enforcing** instead of asserting a number. The
limits themselves are already here (`bowling_directive` with age bands in `db/08`), so this is
presentation over existing data plus a clause store. Files: `RulebookView.jsx`, new `db/NN` for clauses.
Risk LOW. **Migration YES** if clauses are stored rather than shipped in code.

### SCRBRD-042 — Consent register: `redacted` as a terminal state
`GovernanceView.tsx` models consent as `GRANTED | PENDING | REDACTED`. Consent appears in 240 places here;
what needs checking is whether **withdrawn** consent is visibly withdrawn rather than simply absent.
Absence and refusal reading the same is the failure mode — the same distinction the dossier makes between
"no rows" and "shut, and here is why". Files: audit of the consent reads first; this entry may close as
already-correct. Risk LOW. Migration UNKNOWN until the audit.

## P3 — Product ideas, small and specific

- **SCRBRD-043** — Scorer audio confirmation. `scorerAudioEngine.ts`: Web Audio synth plus Web Speech,
  no external assets, ~100 lines, no dependency. `audio|speech` returns **zero hits** here. For a scorer
  watching the field rather than the tablet, hearing what was just recorded is both an accuracy and an
  accessibility gain. Risk LOW.
- **SCRBRD-044** — Practice scoring sandbox, spotlight tour, readiness banner
  (`onboarding/PracticeScoringSandbox.tsx`, `SpotlightTour.tsx`, `OnboardingReadinessBanner.tsx`). §18
  lists training mode as a first-class item on the Scorer dashboard. `OnboardingFlow.jsx` is all that
  exists. The banner's framing is the good part: *you are not yet ready to perform your duty, and here is
  what is missing.* Risk LOW.
- **SCRBRD-045** — Spider chart. From `docs/blueprint.md`: *"batting power, precision and directionality
  based on the distance the ball travels in various directions."* `radius` 0..1 is already captured, so
  this is a **new read over existing columns**. `spider|radar` returns zero hits. Risk LOW.
- **SCRBRD-046** — KDE heatmap over the wagon wheel. `placementEngine.ts` specifies continuous 2D Gaussian
  kernel density for shot distribution; `kde|density` returns zero hits. Same story as -045: the data is
  captured, the read does not exist. Pairs with the blueprint's zone-based comparative analytics. Risk LOW.
- **SCRBRD-047** — Player skill radar over the rubric axes (`PlayerSkillRadarChart.tsx`). The rubric
  exists and is tested; the radar does not. Risk LOW.
- **SCRBRD-048** — Notifications name the role and scope that generated them. §19: *"multi-role users
  should see the role and scope that generated each notification."* Also §13's *"a role switch visibly
  changes action and dashboard context"* — worth auditing whether the switcher shows the active role **and
  its scope**, not just the role. Risk LOW.
- **SCRBRD-049** — Promotion/demotion tier movement surface (`PromotionDemotionView.tsx`). Player moves
  already carry `reason IN ('promotion','fill_in','selection','other')` (`db/08:650`) and `LeagueView`
  exists; the standings-plus-tier-movement screen is the gap. Risk LOW.
- **SCRBRD-050** — Prematch auto-select from performances (`docs/blueprint.md`). Availability and
  selection exist. **Caveat that belongs in the entry:** an auto-selection must show its rationale or it is
  a black box a coach cannot defend to a parent — the same standard applied to a selection decision
  instead of a statistic. Risk MEDIUM, and mostly on the explanation rather than the arithmetic.
- **SCRBRD-052** — A browser walk that scores an innings to its end. `smoke-browser-sync` opens the real
  scorer on a real match and taps four deliveries of twenty overs, so nothing exercises what happens when an
  innings completes: not the review gate (SCRBRD-038), not the innings break, not the result screen, not the
  second innings' target. Completing an innings by wickets rather than overs is the cheap route — ten
  dismissals through the wicket sheet instead of a hundred and twenty taps — and it would also be the first
  coverage of the handover and quarantine paths under a closed innings. Files: `tools/smoke-browser-sync.mjs`
  or a walk of its own. Risk LOW. Migration NO.
- **SCRBRD-051** — Two shapes worth keeping from `aiCoachAssistant.ts`, without its fabrication:
  per-drill `safetyCleared` driven by `medicalRestrictions` (a drill blocked by a restriction **without
  exposing the file** — §11.3 rendered as a feature, and `TrainingView`'s drill library is where it goes),
  and `confidence: HIGH | MODERATE | LOW` per recommendation, which is `evidence_label()` under another
  name. Risk LOW.

## Not harvested, and why

| Prototype asset | Decision |
|---|---|
| `aiMatchReporter.ts` | Reject. Fabricates figures and a quote attributed to a named coach. |
| `aiCoachAssistant.ts` | Reject the engine; keep two shapes as SCRBRD-051. |
| `PermissionViewContext.tsx` | Reject. Client-side role simulation defaulting to Super Admin. |
| `placementEngine.ts` clock helpers | Already here — `packages/scoring/src/placement.mjs:12-17`. |
| Guardian majority at 18 | Already here — `db/10_guardian_majority.sql`. |
| Age-band fast-bowling limits | Already here — `bowling_directive` in `db/08`. |
| Stats query engine | Already here — the Stats-Magic palette. |
| Null-reason placement vocabulary | Already here — `placement.mjs:38-40`. |
| `BroadcastScorer.tsx` (321 KB, one file) | Reject as structure; `check-bundle.mjs` would refuse it. |

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

Pass 2:
SCRBRD-028 (invariants) ──▶ SCRBRD-029 (split request/approve) ──┐
SCRBRD-030 (sensitivity tiers) ───────────────────────────────────┴▶ ride together on one db/NN
SCRBRD-031 (workflow-state) ──▶ SCRBRD-034 (duty lifecycle) ──▶ SCRBRD-037 (duty roster)
SCRBRD-032 (ADR) ──▶ SCRBRD-036 (sponsor viewer)   [the ADR is the test the new role must pass]
SCRBRD-039 (capture profiles) ──▶ SCRBRD-045, -046 (spider, heatmap)
SCRBRD-038 (review-confirm) — independent, do early: smallest change, largest error class
SCRBRD-035 (escalation roster) — independent, content not engineering
SCRBRD-042 (consent audit) — independent, may close as already-correct
```

# Recommended Execution Order

1. **SCRBRD-008** reset guard — smallest change, Critical impact, no dependencies.
2. **SCRBRD-000** ship the branch; Supabase rebuild with `db/12`.
3. **SCRBRD-024** CI on every PR — every later item then has a net.
4. **SCRBRD-001** production login page; **SCRBRD-006** analytics consent; **SCRBRD-005** AI pseudonyms — the three P1 privacy/trust items, all independent.
5. **SCRBRD-004** owner key migration — before any real pilot.
6. **SCRBRD-010** offline/handover walks, then **SCRBRD-002** dismissal enum, then **SCRBRD-003** quarantine release.
7. **SCRBRD-009** idempotency; **SCRBRD-011** capability gates; **SCRBRD-007** search_path.
8. Remaining Pass 1 P2/P3 in ID order.

Pass 2:

9. **SCRBRD-028** invariants — landed in `bdf837e`'s successor; every later RBAC change then has a net.
10. **SCRBRD-038** review-confirm gate — smallest change, largest error class, no migration.
11. **SCRBRD-032** the ADR, before the next role request rather than after it.
12. **SCRBRD-030** sensitivity tiers; **SCRBRD-031** workflow-state inventory — both policy-side, both
    unblock the entries behind them.
13. **SCRBRD-029** split request/approve — **rides with the next `db/NN`**, never alone, and the pilot
    schools are told before it ships.
14. **SCRBRD-035** escalation roster; **SCRBRD-042** consent audit — independent, cheap, and -042 may
    close itself.
15. **SCRBRD-033** role-entry briefing — the best product item, and derivable rather than written.
16. Remaining Pass 2 P2/P3 in ID order.

# Blocked Work

| Task | Blocked by | Reason |
|---|---|---|
| SCRBRD-012 impersonate | SCRBRD-026 | "audited" is in the capability's own description; cannot be implemented without a log to write to |
| SCRBRD-003 quarantine release | SCRBRD-002 | a released event must pass the same vocabulary check as a fresh one |
| SCRBRD-020 code splitting | SCRBRD-006 | Firebase is the largest single removable chunk; split after it is lazy |
| SCRBRD-027 delete legacy-roles | SCRBRD-001, -011 | login page and view gates still read it |
| SCRBRD-007 search_path | SCRBRD-004 | both add ledger files; sequence them to avoid a ledger conflict on production |
| SCRBRD-029 split request/approve | a `db/NN` slot | a capability change after go-live needs `roles.mjs` + a ledger file + a `WITHDRAWN_SINCE_01` entry + a production paste; not worth a file of its own |
| SCRBRD-034 duty lifecycle | SCRBRD-031 | `delegated` and an expiring fixture role are workflow states; naming the layer comes first |
| SCRBRD-036 sponsor viewer | SCRBRD-032 | the ADR is the test a new role has to pass, and this is the first role request it would govern |
| SCRBRD-037 duty roster | SCRBRD-034 | readiness is duty status; without the lifecycle the roster can only show names, which is the thing §17.3 says not to do |
| SCRBRD-042 consent register | an audit of the existing consent reads | the entry may be already-satisfied; writing the change before the audit would be inventing work |
