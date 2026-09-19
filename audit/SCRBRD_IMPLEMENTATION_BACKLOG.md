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

### ~~SCRBRD-029~~ — CLOSED, by SCRBRD-054 rather than as written

**Closed 2026-09-18.** `db/24_amend_request.sql` gives the request its own capability,
`scoring.amend.request`, held by the scorer and superadmin and nobody else. `directorofsport` and
`competitionadmin` keep `scoring.correct` — session recovery, the quarantine queue, DRS entry — and
never receive the request, so the requester and approver sets are disjoint without a withdrawal.
`KNOWN` in `separation.test.mjs` is empty; the verifier proves Sarah cannot file and the scorer can;
`smoke-amend` proves the same through the API and that the function's own guard still holds when a
request is planted in her name past the policy. **Nothing changes on production until `db/24` is
pasted**, and `FROZEN_THROUGH` goes to 24 when it has been. The entry below is left as it was written,
because the reverted attempt is the record of why the obvious fix was wrong.


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
**Recommended change:** ~~drop `scoring.correct` from `directorofsport` and `competitionadmin`~~ —
**tried, and wrong. Reverted 2026-09-18.** `db/24_scoring_approval_split.sql` was written, the
withdrawal went through `WITHDRAWN_SINCE_01` correctly (db/01's hash did not move, which is the
check that the mechanism worked), the migration applied cleanly and the live rows were right. Then
the walks ran and three went red: `handover-crash` (5), `amend` (2), `drs` (13).

`scoring.correct` gates **four unrelated things**, and only the last is what its name says:

| | |
|---|---|
| `db/02:453` | force-releasing a stuck scoring lease |
| `db/02:252` | reading the quarantine queue |
| `db/09:504` | writing a DRS review |
| `db/02:790` | the amendment request itself |

So withdrawing it does not narrow self-approval. It strips a Director of Sport of session
recovery, quarantine visibility and DRS entry — on a Saturday morning, when the match is stuck and
he is the only person at the ground with the authority to fix it. That is a worse outcome than the
crossing it was meant to close.

The real defect is the overloading (SCRBRD-054). **The fix is to split the request onto its own
capability** — `scoring.amend.request`, held by the scorer — leaving `scoring.correct` for the
three operational acts. That is a new capability, three policy changes, a `db/NN` and a paste,
which is a larger piece of work than this entry assumed and is why it is being re-scoped rather
than retried.

Worth keeping from the attempt: the withdrawal machinery is proven end to end, and the assertion
that caught it was not the one I expected. An earlier draft asserted that nobody who can append
balls may also approve an amendment; that is larger than §11.2 requires and was narrowed to the
real invariant — the requester and approver sets must be disjoint.
**Why it matters:** the guard the codebase says it has, in the file that says it, is not the guard it has.
**Dependencies:** SCRBRD-028 (records it). **Security / privacy impact:** closes a self-approval path.
**Data migration required:** **YES** — a capability change after go-live is `roles.mjs` + a new `db/NN` +
a `WITHDRAWN_SINCE_01` entry in the generator + a production paste (ARCHITECTURE.md §9). Should ride with
the next ledger file rather than alone.
**Tests required:** `separation.test.mjs` with `KNOWN` emptied; `authorize.test.mjs`; the RLS-output diff.
**Acceptance criteria:**
- [x] Neither role holds both halves
- [x] `KNOWN` is empty and the suite is green
- [ ] Production verify bundle returns OK in every column — after `db/24` is pasted
**Regression risk:** MEDIUM — a DoS who currently corrects a match by themselves will need a scorer to
request it. That is the point, and it needs saying to the pilot schools before it ships.

### SCRBRD-030 — PART ONE DONE

> **Coherence landed; the ordered scale does not.** `packages/policy/test/sensitivity.test.mjs`
> now joins `SENSITIVE` (capabilities) to `RESTRICTED_FIELDS` (the logger's watched columns)
> through the mask map, so the two lists cannot drift apart in silence. 16 assertions.
> It found `discipline.read` and `discipline.write` gating nothing at all — see SCRBRD-053 —
> and replaced a vacuous line in `rls.test.mjs` that claimed the join while checking spelling.
>
> The five-level scale is still open and is the rest of this entry. It needs a judgement call
> per capability across all 81, and the decision that matters is whether `SENSITIVE` becomes
> `level >= 2` — which would WIDEN its membership (adding `player.age.read`,
> `guardian.link.manage`, `medical.status.read`, the invoice reads and more) and therefore
> widen what the deck claims is logged. That is a behaviour change, not a classification, and
> it wants deciding rather than assuming.

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

### ~~SCRBRD-031~~ — CLOSED, with the premise corrected

> **The inventory said the entry was wrong, which is what an inventory is for.**
> Workflow state is not a missing authorisation layer here. It is enforced BELOW
> authorisation, as a record invariant in the database: of the thirty refusing trigger
> functions in `db/`, twenty-nine consult no capability at all, so the rule is the same
> for a scorer and for `superadmin`. That is stronger than beta-2's model, where "when"
> sits beside role and scope and is therefore something a privileged role could be
> granted past. The single capability gate, `sponsorship_exclusivity_gate`, is an
> approval by design and is recorded as one.
>
> No signature change to `authorize()`, which is what this entry existed to decide.
> `packages/policy/test/invariants.test.mjs` (15 assertions) holds the split, and
> `ARCHITECTURE.md` §4 states it. SCRBRD-034's duty lifecycle no longer depends on this.

**Title:** ~~Name workflow-state as the fourth authorisation layer~~
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

### ~~SCRBRD-033~~ — CLOSED, at a third of the size, and with my own claim corrected

> **`ungrantedCapabilities()` does not do what this entry said it did.** It returns
> capabilities NO role grants — dead weight across the roster — not the complement for one
> role. The entry claimed the "must not" list was derivable from it. Misread; recorded rather
> than quietly rewritten, because the same misreading produced the harvest write-up's claim too.
>
> The idea survived the correction, the shape did not. A role's complement IS trivially
> computable, and it is **useless**: a scorer lacks seventy-three capabilities. Two narrowings
> were measured against the real roster before anything was built —
> sensitive-not-held gives 3–9 lines per role, held-by-few-roles gives 11–13 and mostly
> irrelevant ones. The first is the boundary that matters and the second was dropped.
>
> `boundaries(role)` in `roles.mjs` returns the sensitive capabilities a role does not hold,
> each naming who does; break-glass accounts are excluded from the hand-off with the reason.
> `BoundariesSection` draws it on Settings › Me. Nothing is written per role: move a capability
> and the text moves with it. 8 assertions in `separation.test.mjs`, 6 in `smoke-browser-read`,
> and the browser ones were falsified by granting `coach` `medical.details.read` and rebuilding
> — the walk went red, which is the proof they track the policy rather than a string.
>
> Not built, and not needed: the executive summary and recommended display mode from beta-2's
> version. Settings › Roles already lists what every role may do, thoroughly. What was missing
> was only the second person — what **you** may not do, and who decides instead.

**Title:** ~~Role-entry briefing: what this role may not do, and who it hands off to~~
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

### SCRBRD-035 — Operational escalation roster — **RE-SCOPED, do not import as written**

> Checked the 18 rows against the real roster before building. **Four of the roles they escalate
> TO do not exist here** — Support Admin, Compliance/Safeguarding Officer, Audit Reviewer, Match
> Referee/Commissioner — and they are the terminal target in most rows. Importing the table
> wholesale produces a screen telling a school administrator to escalate to nobody, which is worse
> than no screen.
>
> Adding those four roles is not a shortcut either: each has to pass ADR 0003's two tests first,
> and at least Compliance/Safeguarding plausibly would.
>
> What is buildable now is narrower and mostly already built: `boundaries(role)` answers "I cannot
> do this, who can" by derivation, for every sensitive capability. The rows this roster adds beyond
> that are the ones routing to the four missing roles. So the useful order is ADR 0003 tests →
> whichever of those roles passes → then this. Left open and depending on that rather than closed.
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

### ~~SCRBRD-042~~ — CLOSED as already-correct, which is what the entry said might happen

> Audited both consent surfaces. Neither lets absence and refusal read the same, and the
> enforcement is stronger than this entry assumed.
>
> **`passport_consent`** keeps withdrawn rows — `withdrawn_at` and `withdrawn_by`, never a delete —
> and `SettingsView` draws them dimmed, labelled `withdrawn`, carrying both dates ("named 3 Mar ·
> withdrawn 14 Jun"), with live grants sorted first. A partial unique index keeps one live grant per
> player per school while leaving the history intact.
>
> **`player_scouting_consent`** uses an explicit `consent_state IN ('granted','withdrawn')` with
> one row per player, so a withdrawal is an UPDATE and not a disappearance. And it is **enforced**:
> `scouting_candidates()` inner-joins on `consent_state = 'granted'`, so a withdrawn consent and a
> consent never given both fall out — the same inner-join shape that keeps cross-school pairings out
> of match-ups. `smoke-scouting` covers the primitive including that a school cannot consent on a
> family's behalf; `smoke-passport` covers the authorisation side.
>
> **One real gap, and it is not this one:** `player_scouting_consent` is drawn on no screen, so a
> family cannot see or change whether their son may be scouted. Filed as SCRBRD-055.

**Title:** ~~Consent register: `redacted` as a terminal state~~
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
- ~~**SCRBRD-055**~~ — **CLOSED** in #29: `ScoutingConsentSection` on Settings › Passport over a
  `scouting_consent` read, with the toggle writing through the existing route. As filed:
  Scouting consent is enforced and invisible. `player_scouting_consent` gates
  `scouting_candidates()` correctly and is written through `/api/players/:id/scouting-consent`, but
  no screen draws it: a parent cannot see whether their son is visible to accredited scouts, nor
  change their mind, without someone making an API call for them. Consent that cannot be inspected
  by the person who gave it is consent in name. The passport equivalent is drawn in Settings and is
  the shape to copy. Files: a section on Settings › Passport or the player's own profile, reading a
  new `scouting_consent` resource. Risk LOW. Migration NO — the table and the write route exist.
- ~~**SCRBRD-054**~~ — **CLOSED.** `scoring.amend.request` in `capabilities.mjs`, on the scorer in
  `roles.mjs`; `ADDED_SINCE_01` in the generator is the mirror of `WITHDRAWN_SINCE_01` and keeps
  `db/01` byte-identical (hash checked before and after); `db/24_amend_request.sql` inserts the
  catalogue row, the two grants and recreates `scoring_amendment_insert` on the new name, with its
  own assertion block; `rls.test.mjs` B2 holds the mirror honest (falsified by swapping a holder in
  db/24); `db/99` and `smoke-amend` prove it live (both falsified against the pre-db/24 policy).
  `scoring.correct` stays with the three roles that recover a session. Awaiting paste.
  As filed: `scoring.correct` is four capabilities wearing one name: force-release a stuck
  lease, read the quarantine queue, write a DRS review, and request an amendment. The first three
  are operational recovery and belong with whoever is senior at the ground; the fourth is half of a
  separation-of-duties pair and belongs with the person who noticed the mistake. Because they share
  a name they cannot be held separately, which is what makes SCRBRD-029 unfixable as written.
  Splitting the request out (`scoring.amend.request`) is the prerequisite for that entry. Files:
  `capabilities.mjs`, `roles.mjs`, `db/02`'s three policies via a new `db/NN`, `db/09` regenerated.
  Risk MEDIUM. **Migration YES.** Discovered by writing db/24 and running the walks.
- **SCRBRD-053** — `discipline.read` and `discipline.write` gate nothing. Six roles hold one or
  both (`superadmin`, `principal`, `directorofsport`, `schooladmin`, `selfaccess`,
  `competitionadmin` read; `superadmin`, `directorofsport`, `official` write) and there is no disciplinary
  record in the schema: no table, no policy, no masked column, no read resource. So the
  capability grants nothing today, and on the day a record arrives the reader of one would not
  be logged, because the logger watches columns and there are none to watch. Found by
  `sensitivity.test.mjs`, recorded there in `NOT_YET_IMPLEMENTED` with the reason, and the
  suite fails if either starts being referenced without the entry being removed. Either build
  the record or drop the capabilities — what should not persist is a role bundle that promises
  something the schema cannot deliver. Files: a new `db/NN`, `tables.mjs`, `read-api.mjs`.
  Risk LOW. **Migration YES** if built.
- ~~**SCRBRD-052**~~ — **CLOSED.** `tools/smoke-browser-innings-end.mjs`, full entry below. Found and
  fixed two `Badge` components that silently dropped `data-testid`; found and filed **SCRBRD-063** (a
  second innings can never close on reaching its target — nothing wires the two together).
- **SCRBRD-051** — Two shapes worth keeping from `aiCoachAssistant.ts`, without its fabrication:
  per-drill `safetyCleared` driven by `medicalRestrictions` (a drill blocked by a restriction **without
  exposing the file** — §11.3 rendered as a feature, and `TrainingView`'s drill library is where it goes),
  and `confidence: HIGH | MODERATE | LOW` per recommendation, which is `evidence_label()` under another
  name. Risk LOW.

## Roadmap corrections, 2026-09-18

`up16` (Caps, Honours & Milestones on the Passport) was listed **partial — "simply not shown"**.
It has been shown since it was built: `recognition()` in `db/08` returns all three families,
`RecognitionCard` renders on the player profile (`ProfilesView.jsx:126`), `smoke-recognition`
carries 73 assertions and `smoke-browser-read.mjs:769` asserts the card in a real browser.
Moved to **shipped**, which takes the public count from 10 to 11.

The other three partials were checked and are accurate: `up11` has no year-on-year view over
seasons, `up23`'s platform side is an API route with no screen (the school side in Settings is
the half that exists), and `up24`'s DRS panel is drawn nowhere. `up6` and `up10` are labelled
*effort Low* and are not — the first needs a new table and therefore a production paste, the
second a PDF library against 161 KB of entry-chunk headroom.

Both directions are now checked. `apps/web/test/roadmap.test.mjs` holds shipped items to naming
a walk that exists and is registered, and partials to naming a real identifier from
`services/api` that no view references. The second half is what up16 needed and the first
version did not have.

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
SCRBRD-028 (invariants) ──▶ SCRBRD-029 ✓ via SCRBRD-054 ✓ (db/24) ──┐
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
13. ~~**SCRBRD-029** split request/approve~~ — done as `db/24` via SCRBRD-054; the pilot schools are
    told before it is pasted, because a head of sport who filed corrections herself will now need a scorer to.
14. **SCRBRD-035** escalation roster; **SCRBRD-042** consent audit — independent, cheap, and -042 may
    close itself.
15. **SCRBRD-033** role-entry briefing — the best product item, and derivable rather than written.
16. Remaining Pass 2 P2/P3 in ID order.

Pass 3:

17. **SCRBRD-056** handover UI — the backend and its tests already exist; this is the highest-value item
    in Pass 3 because it closes a real product gap rather than adding a new one.
18. ~~**SCRBRD-057** NRR simulator~~ — blocked; checking the schema before writing the code found there
    is no aggregate data to simulate from. Re-scoped to a prerequisite entry once "derived or typed" is
    answered. **SCRBRD-058** pitch report screen — independent, low priority, not blocked.
19. **SCRBRD-060** knockout bracket — independent, clean UI-only gap over an existing `comp_type`, once
    the round/seed derivation question is answered. **SCRBRD-061** bowling pitch map — blocked on its own
    capture step (new `ball_event` columns); do not build the chart before the capture exists.
20. ~~**SCRBRD-062** multi-fixture duty-coverage overview~~ — CLOSED; reused the already-correct,
    already-shipped `match_duties` read (`SCRBRD-037`'s `DutyRoster`) across several fixtures instead of
    one, no schema or server change.

# Blocked Work

| Task | Blocked by | Reason |
|---|---|---|
| SCRBRD-012 impersonate | SCRBRD-026 | "audited" is in the capability's own description; cannot be implemented without a log to write to |
| SCRBRD-003 quarantine release | SCRBRD-002 | a released event must pass the same vocabulary check as a fresh one |
| SCRBRD-020 code splitting | SCRBRD-006 | Firebase is the largest single removable chunk; split after it is lazy |
| SCRBRD-027 delete legacy-roles | SCRBRD-001, -011 | login page and view gates still read it |
| SCRBRD-007 search_path | SCRBRD-004 | both add ledger files; sequence them to avoid a ledger conflict on production |
| ~~SCRBRD-029 split request/approve~~ | `db/24` | done — it took a new capability, so it got its own file after all, and `ADDED_SINCE_01` in the generator for it |
| SCRBRD-034 duty lifecycle | SCRBRD-031 | `delegated` and an expiring fixture role are workflow states; naming the layer comes first |
| SCRBRD-036 sponsor viewer | SCRBRD-032 | the ADR is the test a new role has to pass, and this is the first role request it would govern |
| SCRBRD-037 duty roster | SCRBRD-034 | readiness is duty status; without the lifecycle the roster can only show names, which is the thing §17.3 says not to do |
| SCRBRD-042 consent register | an audit of the existing consent reads | the entry may be already-satisfied; writing the change before the audit would be inventing work |
| SCRBRD-057 NRR simulator | the runs/legal-balls-for-and-against derivation from `ball_event` (not yet built) | no runs/overs-for-and-against exist to simulate from today, only a stored final `net_run_rate` — computing a projection from that alone would be a fabricated number; "derived, not typed" is now the answer, but the derivation itself is unbuilt |
| SCRBRD-061 bowling pitch map | its own capture step | no delivery has ever had a real line or length recorded; a chart today would heat-map every innings to one identical cell |

# Pass 3 — Harvested from the `scrbrd_antigravity` prototype

`iamkameel/SCRBRD_AntiGravity` is the same Next.js/Firebase lineage as `scrbrd-beta-2` (Pass 2 above),
diverged much further — 454 component files against beta-2's 121. Full assessment, including the parts
deliberately **not** adopted and the reasoning for each, is `audit/SCRBRD_ANTIGRAVITY_ASSESSMENT.md`.
Its own self-audit (`Audit Pack/audit/*.md`, dated two days before this read) rates 65 of its 142 routes
on real data, 43 partially mocked or randomised, 13 fully mocked — read as a warning to verify every
screen against the wired code before borrowing it, which is what the assessment file does file by file.

Six concrete gaps this tree does not yet cover, checked against the tree before being written here — the
first three from the initial pass, the next two from a follow-up request for "rich data, dynamic UI/UX"
(`audit/SCRBRD_ANTIGRAVITY_ASSESSMENT.md` Part 5), and the last from a wider sweep of the directories that
pass had not yet reached (Parts 6–7):

### ~~SCRBRD-056~~ — CLOSED
**Closed 2026-09-18.** `HandoverSheet` (arm/claim/verify tabs), `apps/web/src/lib/handover.js`, a
client-side pre-check in `sync.js` that declines to auto-claim into a pending handover, and
`tools/smoke-browser-handover.mjs` (two real browser contexts, two real logins, a wrong confirmation
refused with a field-level diff before a correct one transfers the token). Found and fixed along the way:
the reference `.mjs`'s `diffConfirmation` shape does not match what `scoring_verify_takeover` actually
returns (flat `exp_runs`/`exp_wkts`/`exp_balls`, not a `diff` array) — built the diff client-side from
what the function really answers with; and a naive "re-run startSync after a takeover" cost the new holder
a spurious second epoch, fixed with `resumeSync()`. `SCRBRD-059` records a gap this surfaced but does not
fix: `scoring_claim()` itself does not check for a pending handover, only this screen's own client-side
courtesy check does.
**Title:** The scoring-session handover has a full backend and no screen
**Priority:** P1 · **Domain:** Scoring / Sync · **Type:** product gap
**Affected files:** new scorer-facing modal, `apps/web/src/scorer/`; no server changes
**Affected users:** every match with a scorer change mid-innings — the common case is a phone handed to
whoever is free, not the same person for the whole match

**Current behaviour:** `services/api/handover/scoring-session.mjs` implements the complete protocol —
`armHandover` issues a code, `claimHandover` takes it, a cross-device diff confirmation compares both
sides' derived state before the token actually transfers, the epoch increments to invalidate the old
device. Routes are wired (`server.mjs:340-341`) and a full API walk exists (`WALKS` in
`tools/run-smoke-api.mjs`). Nothing in `apps/web/src` calls either route — a scorer at the ground has no
way to trigger a handover through the app today.
**Expected behaviour:** a modal reachable from the scoring screen: outgoing scorer arms it and sees a
code with a countdown; incoming scorer enters it and claims it; if the derived states disagree, both are
shown before anything transfers, per the backend's own diff-confirmation step.
**Root cause:** the protocol was built and proven (`scoring-session.test.mjs`) before the screen was, and
nothing has asked for the screen since.
**Recommended change:** a two-step dialog (generate / claim), modelled on the shape in
`SCRBRD_ANTIGRAVITY_ASSESSMENT.md` §2.1 — four-box PIN entry, live countdown — with the diff-confirmation
step that source lacks (its own audit calls its version of this feature "PIN issued, never enforced").
No PIN embedded in a URL. A browser walk to go with it, since none exists.
**Why it matters:** the offline/handover story is the one this product's own roadmap already claims
(`up3`, shipped) — the API-level walk it names is real, but "shipped" reads differently once it is clear
a human cannot do this from the app itself.
**Dependencies:** none — the routes and protocol already exist. **Security / privacy impact:** none new;
same auth as every other scorer action. **Data migration required:** NO.
**Tests required:** a browser walk exercising arm → claim → diff-confirm → epoch increment through the UI.
**Acceptance criteria:**
- [ ] A scorer can arm and claim a handover from the app, with no direct API call
- [ ] A disagreement between the two devices' derived state is shown before the token transfers
- [ ] The code is never carried in a URL
**Regression risk:** LOW — additive UI over an already-tested backend.

### SCRBRD-057
**Title:** No what-if tool over the standings — and it cannot be built honestly yet
**Priority:** P3 · **Domain:** Competitions / Analytics · **Type:** blocked, re-scoped
**Affected files:** `db/08_schema_programme.sql` (`competition_entrant`), a new `db/NN`, then
`apps/web/src/views/LeagueView.jsx`
**Affected users:** competition admins and coaches following a run-in

**Current behaviour, corrected from the first draft of this entry:** the first draft assumed a "what-if"
simulator was a small client-side addition over data already read. Checking `competition_entrant`
(`db/08`) before writing the code found the opposite: the table stores `played`, `won`, `lost`, `drawn`,
`no_result`, `points` and a single stored **`net_run_rate` number** — no runs-for, overs-for, runs-against
or overs-against. NRR is `(runs for ÷ overs for) − (runs against ÷ overs against)`; without the four raw
aggregates a "projected NRR" cannot be computed, only guessed at by treating the stored rate as if it
composed linearly with a new match's rate, which it does not — a rate is not an average of rates unless
weighted by the overs each one covers. Doing that would be exactly the fabrication this codebase's culture
exists to refuse: a confident-looking number computed from data that is not there.

Worse, `LADDER`/`LiveLadder` (the real, `useLive("league", ...)` path, `comp.live === true`) is the only
honest half of `LeagueView.jsx`. The DEMO half — `comp.table`, rendered when `comp.live` is falsy, with an
"Edit Standings" / "✓ Save Changes" flow — writes only to local React state (`tableEdit`); no route exists
under `services/api/write` for `competition_entrant` at all. A competition admin's "Save" on that screen
persists nothing.
**Expected behaviour:** either the simulator is dropped until the prerequisite exists, or the prerequisite
is built first: `competition_entrant` gains real per-side aggregate columns (runs/legal-balls for and
against), maintained from actual results — which itself needs an answer to a question this entry cannot
answer alone: are those aggregates derived from `ball_event`/`match` results automatically, or typed by a
competition admin as the authoritative record (the same "a human said so" standing a typed DLS revision
target has)? That choice decides whether this is a read-side feature or a write-pipeline one.

**Update 2026-09-18, "derived or typed" now answered:** a wider AntiGravity sweep (assessment file §6.3)
found `pointsTableActions.ts` there deriving the same four aggregates at read time from completed matches,
rather than storing them — but doing it by parsing a `"245/8"` score string and assuming
`balls = overs × 6`, which is wrong whenever an innings ends early. SCRBRD OS does not need that guesswork:
`ball_event` is already the authoritative per-delivery log (`innings`, `ball_type`, `value`, legal-ball
tracking `packages/scoring/src/replay.mjs` already relies on), so the same aggregates AntiGravity
reconstructs approximately from a parsed string, SCRBRD OS can derive exactly from the real ball log —
**derived, not typed**, consistent with every other number this schema already computes rather than stores
(replay, `HeadToHead` in `live.js`). This answers the open question; it does not build the prerequisite —
a derivation (materialized view or read-time aggregation over `ball_event`, per competition) is still
unbuilt, real work.
**Root cause:** the standings model was built far enough to show a ladder, not far enough to recompute one.
**Recommended change:** **do not build the simulator on top of the stored `net_run_rate` alone.** File the
real prerequisite — a derivation of runs-for/legal-balls-for/against per team from `ball_event`, exposed
either as a read resource or a materialized view — as its own entry now that "derived, from the ball log"
answers the design question; this entry stays blocked until that prerequisite ships.
**Why it matters:** almost shipped a plausible-looking number with no real arithmetic behind it, on a
screen a competition admin would act on.
**Dependencies:** the runs-for/legal-balls-for/against derivation from `ball_event`, filed as its own
prerequisite entry — no schema-design decision left outstanding.
**Security / privacy impact:** none. **Data migration required:** possibly NO for the derivation itself
(a read-time aggregation needs no new columns; a materialized view would), **YES** if the simulator later
needs its own storage.
**Tests required:** N/A until re-scoped.
**Acceptance criteria:**
- [ ] Not attempted before the aggregate data exists
**Regression risk:** N/A — nothing was built.

### ~~SCRBRD-058~~ — CLOSED
**Closed 2026-09-18.** `PitchReportModal` in `FieldsView.jsx`, wired to the existing write route and the
`pitch_report` read resource (new `asPitchReport` adapter in `lib/live.js` — no resource previously had
one). Every field optional, matching the server's own "empty report" refusal. Pre-fills from any existing
report before rendering the form: `on conflict (match_id) do update` overwrites every column with whatever
is submitted, so a blank form re-opened on an already-reported fixture would have silently wiped it —
found and fixed while writing the browser walk, which proves the fix by reopening the same fixture and
checking the form shows what was actually saved, not a blank one. 10 new assertions in
`smoke-browser-read.mjs`.
**Title:** The pitch report has a schema, a write route and a read resource, and no screen reaches any of them
**Priority:** P3 · **Domain:** Facilities / Duty roster · **Type:** product gap
**Affected files:** `apps/web/src/views/FieldsView.jsx` (the button already there), or the duty roster's
`ground` slot; no server or schema changes
**Affected users:** groundskeepers and whoever checks a ground is fit to play on

**Current behaviour, corrected from the first draft of this entry:** this was originally filed as a
missing table, on the assumption AntiGravity's `LogGroundStatusDialog.tsx` covered ground reporting that
SCRBRD OS lacked entirely. It does not lack it. `db/08_schema_programme.sql` already has
`match_pitch_report` (surface, grass, bounce, pace as words; `bounce_rating`/`pace_rating` as OPTIONAL 1–10
numbers, with its own comment on exactly why a word and a number are not the same fact: *"a groundsman
says 'two-paced' out loud; a director of sport asking which of five squares has got slower since September
needs the number"*) and a separate `ground_condition` for the ground itself, deliberately kept apart from
the per-fixture report so a drainage figure is not copied across every match at that venue and left to
drift. `events-api.mjs:896` already writes it; `read-api.mjs`'s `pitch_report` resource already reads it
back; the duty roster's `match_duties` read already unions it in as the `ground` arm's state. **This
schema is already a stronger worked example of "a word plus an optional number where the number means
something" than anything in `SCRBRD_ANTIGRAVITY_ASSESSMENT.md` §2.3 proposed inventing** — see Part 3 of
that document, corrected alongside this entry.

What is actually missing is narrower: `FieldsView.jsx:112` has a "+ Pitch Report" button with no
`onClick` at all, and nothing in `apps/web/src` calls `useLive("pitch_report", ...)`. The schema, the
write route and the read resource all exist and reach nothing.
**Expected behaviour:** the button opens a form over the real columns (surface, grass, bounce, pace,
the two optional ratings, outfield, favours, covers_on, notes) and posts to the existing route; the
report reads back through the existing resource, on `FieldsView` and/or the duty roster's `ground` slot.
**Root cause:** the write and read paths were built for the schema and the duty-roster summary; nobody
has yet built the form.
**Recommended change:** wire the existing button to a sheet/modal using the columns as they already are —
no new enum, no new table, no flattening a word-plus-optional-number field into a single score.
**Why it matters:** closes a real, narrow gap without repeating the false-precision mistake the source
material would have imported were the schema not already there to check against.
**Dependencies:** none for the form itself; SCRBRD-034 (duty lifecycle) for the roster slot to mean more
than "recorded" once it reads the fuller record.
**Security / privacy impact:** none — no sensitive data, and the RLS policies (`facility.manage` to write,
`fixture.read` to read) already exist. **Data migration required:** NO — schema, write route and read
resource are all already shipped.
**Tests required:** a browser walk exercising the form against the existing write route and reading the
result back.
**Acceptance criteria:**
- [ ] The "+ Pitch Report" button opens a working form and the report round-trips through the real route
- [ ] The duty roster's `ground` slot reflects a submitted report, not only "recorded"
**Regression risk:** LOW — additive UI over an already-shipped schema and routes.

### SCRBRD-059
**Title:** `scoring_claim()` does not check for a pending or in-progress handover
**Priority:** P2 · **Domain:** Scoring / Sync · **Type:** correctness
**Affected files:** `db/02_schema_scoring.sql` (`scoring_claim`), a new `db/NN`
**Affected users:** every match where a handover is armed while a second device is also open

**Current behaviour, found while building SCRBRD-056:** `scoring_claim(p_match, p_device)` refuses only
when `state = 'active' AND lease_until > now() AND holder_device IS DISTINCT FROM p_device` — a
colleague's live lease. It does **not** check for `handover_pending` or `verifying`. So while a handover
is armed, any device with `scoring.start` that calls the plain `/session/claim` route — which is exactly
what the scoring screen does on ordinary mount — takes the token outright, skipping the code and the
verification handshake entirely. The reference implementation (`scoring-session.mjs`'s in-memory
`claim()`) has the identical shape, so this is a property of the design, not a divergence between the two.
**Expected behaviour:** a plain claim while `handover_pending` or `verifying` is refused with a reason
naming the state, the same way a live lease is refused today — steering the caller toward the code/verify
path rather than silently completing it for them.
**Root cause:** the guard was written for the one case it was asked to prevent (two devices scoring at
once) and never extended to the handover states, which did not exist yet when it was first written.
**Recommended change:** add `OR s.state IN ('handover_pending', 'verifying')` to the refusal condition,
with its own reason (`handover_pending` / `verifying`) rather than folding it into `lease_active`, since
the remedy is different — enter the code, not wait out a lease.
**Interim mitigation, already shipped in SCRBRD-056:** `apps/web/src/lib/handover.js`'s `sessionState()`
and `sync.js`'s `startSync()` read the session state client-side before calling `/session/claim` and
decline to auto-claim into a pending or verifying handover. This narrows the window for anyone going
through the app in the ordinary way; it does not close it — a direct API call, or a race between the read
and the claim, still bypasses it. Recorded rather than left silent, per this file's own convention.
**Why it matters:** the handover UI SCRBRD-056 just built is only as trustworthy as the state machine
underneath it; a client-side courtesy check is not the same guarantee as a database-enforced one.
**Dependencies:** none. **Security / privacy impact:** none — everyone who could exploit this already
holds `scoring.start` on this match; it is a workflow-integrity gap, not an authorisation one.
**Data migration required:** **YES** — a decision-function change after go-live needs its own `db/NN`
(no capability or bundle changes, so no `WITHDRAWN_SINCE_01`/`ADDED_SINCE_01` entry is needed).
**Tests required:** a unit assertion in `scoring-session.test.mjs` (or its DB-level equivalent) that a
plain claim during `handover_pending`/`verifying` is refused; the client-side pre-check already has
coverage via the browser handover walk (SCRBRD-056).
**Acceptance criteria:**
- [ ] A plain claim while a handover is pending or verifying is refused, at the database function, not
  only in the client
- [ ] The refusal names which state blocked it
**Regression risk:** LOW — narrows an existing function's success cases; every currently-passing walk
claims into `idle` or a genuinely dead `active` lease, neither of which this touches.

### SCRBRD-060
**Title:** No bracket view for a knockout competition, though the schema already names one
**Priority:** P3 · **Domain:** Competitions · **Type:** product gap
**Affected files:** `apps/web/src/views/CompetitionsView.jsx`, `apps/web/src/views/LeagueView.jsx` (or a
new `BracketView.jsx`); no server or schema changes
**Affected users:** anyone following a knockout or festival competition

**Current behaviour, checked against `scrbrd_antigravity`:** `competition.comp_type` (`db/00_schema_core.sql`)
is already `league | knockout | festival`, but every competition screen in this codebase only ever renders
a league table — there is no bracket UI anywhere, for any `comp_type`. `KnockoutBracket.tsx` in the
AntiGravity tree is honestly built: every value on a match card (team names, scores, date, winner
highlighting, a live pulse, a trophy on the final) comes from a typed `BracketRound[]` prop, with an honest
`"TBD"` fallback for a team or date genuinely not yet known rather than an invented one; the connectors
between rounds are layout math, not data. `CompetitionViewClient.tsx` passes `bracketRounds` straight
through with no fabrication at the call site either. Zero fabrication found in this feature, unlike the
player-passport and pitch-map findings in the same review pass.
**Expected behaviour:** a competition with `comp_type = 'knockout'` (or `'festival'`) renders a bracket —
rounds and matches derived from real `fixture`/`match` rows for that competition, not a league table.
**Root cause:** the data model was built wide enough to name a knockout competition; the view layer was
only ever built for the league case.
**Recommended change:** a `BracketView` component modelled on `KnockoutBracket.tsx`'s shape (round columns,
match cards, "TBD" for not-yet-known teams/dates, connector lines as pure layout), fed by real fixtures for
the competition rather than a new prop shape invented for the port — the round/seeding structure needs its
own derivation from `fixture` (e.g. round number, bracket position) since nothing in `db/00`/`db/08`
currently records bracket position explicitly; that derivation is this entry's real scope, not the card UI.
**Why it matters:** a real, currently-invisible product gap — a knockout competition is a named, supported
`comp_type` with no way to see its bracket.
**Dependencies:** a decision on how bracket position/round is derived or stored for a `fixture` in a
knockout competition (may need a `db/NN` if round/seed is not already inferable from existing columns).
**Security / privacy impact:** none — same read data as any other fixture view (`fixture.read`).
**Data migration required:** possibly, depending on the dependency above.
**Tests required:** a browser walk against a seeded knockout competition, once the derivation is decided.
**Acceptance criteria:**
- [ ] A `comp_type = 'knockout'` competition renders a real bracket, not a league table
- [ ] Not-yet-known teams or dates show an honest placeholder, never an invented one
**Regression risk:** LOW — additive view over existing fixture data; does not touch the league path.

### SCRBRD-061
**Title:** No bowling line/length capture, so a pitch map can only ever show one identical cell
**Priority:** P3 · **Domain:** Scoring / Analytics · **Type:** capture gap, blocked-then-product
**Affected files:** `packages/scoring/src/placement.mjs` and the ball-entry UI (capture), a new `db/NN`
adding line/length columns to `ball_event`, then a new pitch-map chart component (display)
**Affected users:** coaches and analysts reviewing a bowler's or an innings' line and length

**Current behaviour, checked against `scrbrd_antigravity`:** `PitchMap.tsx` (a line/length heat grid, 4
lengths × 5 lines) is itself honestly built — a real prop-driven density grid, no fabrication in the
component. But its one call site, `TabsAnalysis.tsx:92`, feeds it `b?.length || 'Good'` and
`b?.line || 'Off Stump'` — and nothing anywhere in that codebase's scoring path ever captures a real line
or length on a delivery, so those are not a fallback for the rare missing case, they are the only value any
delivery has. Every innings would heat-map to one identical cell. SCRBRD OS is in the same position,
honestly: `packages/scoring/src/placement.mjs` captures where the ball went AFTER contact (batting
placement — theta/radius, already powering the wheel, heat map and spider chart from SCRBRD-045/046). It
captures nothing about where the ball was BOWLED.
**Expected behaviour:** a scorer can optionally record a delivery's line and length at the point of
scoring; a pitch-map chart renders real density from those recorded values, with no delivery defaulted into
a cell it wasn't actually bowled to.
**Root cause:** the scoring UI and `ball_event` schema were built for outcome and batting-placement capture;
bowling line/length was never part of that capture step.
**Recommended change:** **do not build the chart first.** This is capture-plus-chart, not chart alone: (1)
a line/length selector in the scoring UI, optional like placement capture; (2) new columns on `ball_event`
for line and length; (3) only then a pitch-map chart reading real values, following the same
honest-placeholder discipline as SCRBRD-060 (an unrecorded delivery is omitted, never defaulted into a
cell).
**Why it matters:** the source's own component is clean, but adopting it as-is would silently import the
one-cell fabrication its caller has, and SCRBRD OS has no capture to feed an honest version yet either —
flagged now rather than after a small "just add the chart" misestimate.
**Dependencies:** SCRBRD-039 (capture profiles) precedent — same shape of problem, optional in-scoring
capture feeding a chart — worth building alongside or after it rather than as a one-off.
**Security / privacy impact:** none. **Data migration required:** **YES** — new `ball_event` columns.
**Tests required:** unit coverage for the new capture path once built; a browser walk once the chart exists.
**Acceptance criteria:**
- [ ] Not attempted as chart-only; capture ships first
- [ ] An innings with no recorded line/length data shows an honestly empty map, never a fabricated one
**Regression risk:** N/A — nothing built yet.

### ~~SCRBRD-062~~ — CLOSED
**Closed 2026-09-19.** `apps/web/src/views/ReadinessOverview.jsx`, a new `readiness` nav destination
(`fixture.read`, "Operate" group), and `useDutyCoverage()` in `lib/live.js` — the same `match_duties` read
and `asDuty` adapter `DutyRoster` already uses, fanned out with `Promise.all` across a school's next 8
upcoming fixtures rather than one at a time. No new schema, server route, or RLS. A new browser-walk group
in `smoke-browser-read.mjs` reads ground truth for a seeded fixture directly from `/api/read/match_duties`,
confirms the overview's coverage count matches it, then cross-checks the same fixture's own `DutyRoster` on
`MatchCentreView` shows the identical count — proving the two screens cannot drift from each other by
construction, not just by inspection.

**Correction on the same day:** the closing note above first reported four failures in unrelated screens
(a guardian's school name, a Logistics trip, Add Player, onboarding) as pre-existing bugs, on the strength
of them reproducing with this change stashed out. That stash test controlled for the wrong variable —
it ruled out this change, but not the fact that the same un-reset database had already been driven through
five consecutive walk runs, each one writing state (a withdrawn passport grant, an extra trip, an extra
onboarded account) the next run's assertions did not expect. A `tools/migrate.mjs --reset --seed` followed
by exactly one run of `smoke-browser-read.mjs` came back **350 passed, 0 failed** — all four "failures"
were this session's own repeated-run contamination, not product bugs, and are retracted. A second such
clean run caught one further one-off timing flake in the ratings screen that did not reproduce on a third;
also not filed. Left here so the wrong conclusion doesn't get re-derived the same way twice.
**Title:** No way to see duty-roster coverage across several fixtures at once
**Priority:** P3 · **Domain:** Facilities / Duty roster · **Type:** product gap
**Affected files:** a new view (e.g. `apps/web/src/views/ReadinessOverview.jsx`), reusing the existing
`match_duties` read resource across multiple `matchId`s; no server, schema, or RLS changes
**Affected users:** a sportsmaster / director of sport with several fixtures on a given weekend

**Current behaviour, checked against `scrbrd_antigravity`:** its `SportsmasterDashboard` shows a
"Readiness Status Board" — the next 5 fixtures, each with squad/venue/transport/officials status pills —
traced to `getFixtureReadinessAction`. Venue and transport are real (a real field record, a real transport
trip); squad and officials are both the identical `f.status === 'scheduled' ? 'ready' : 'pending'` test,
one of them commented `// Static for now` — every scheduled fixture reads "ready" on both regardless of
whether a lineup was picked or an umpire appointed.

SCRBRD OS does not have this fabrication, because it does not have this screen at all — and the real
building block for it already exists and is already correct: `apps/web/src/views/duties.jsx`'s
`DutyRoster` computes genuine per-fixture coverage (umpires, third umpire, referee, scorer, scoring
session, team sheet, pitch report, transport) from the `match_duties` union, under the same "READINESS,
NOT NAMES" discipline documented in `services/api/read/read-api.mjs` — "nothing on record" rather than
"pending" wherever nothing has actually happened. It is rendered only inside `MatchCentreView.jsx`, for
one selected match at a time. There is no screen that lists several upcoming fixtures side by side with
their coverage counts, the way a sportsmaster would actually want to scan a coming weekend.
**Expected behaviour:** a compact table or card list — the school's next N fixtures, each showing a
coverage count (e.g. "6/8 duties on record") and which slots are covered — built by running the existing
`match_duties` read across those fixtures, not a new per-fixture formula.
**Root cause:** `DutyRoster` was built and proven for the single-match detail screen (`SCRBRD-037`); nobody
has yet needed the same real data summarised across fixtures.
**Recommended change:** a new view that queries `match_duties` for each of the next N upcoming fixtures for
a school (or reuses a batched version of the same query) and renders the same `SLOTS`/coverage logic
`duties.jsx` already has, once per fixture, in a scannable list — explicitly not the AntiGravity formula of
inferring squad/officials readiness from the fixture's own `scheduled` status, which restates the same fact
twice under two labels instead of checking anything.
**Why it matters:** the one piece of this idea genuinely missing from SCRBRD OS is UI, not data or
discipline — the existing `match_duties` read already refuses exactly the fabrication the source commits,
so this is close to the smallest kind of gap this backlog files.
**Dependencies:** none for a first version reading `match_duties` as it is today; SCRBRD-034 (duty
lifecycle) would let a covered slot mean more than "recorded" once it lands, the same as SCRBRD-037's own
dependency.
**Security / privacy impact:** none — same `match_duties` read, same per-table RLS, as the existing
single-match roster. **Data migration required:** NO.
**Tests required:** a browser walk confirming coverage counts for a small set of seeded fixtures with
different duty states match what `MatchCentreView`'s own `DutyRoster` shows for the same fixtures.
**Acceptance criteria:**
- [ ] A sportsmaster can see coverage across several upcoming fixtures without opening each one
- [ ] A slot with nothing on record reads as absent, never as "pending" or "ready"
- [ ] The coverage count for a fixture matches what that fixture's own `DutyRoster` shows
**Regression risk:** LOW — additive read-only view over an already-correct, already-tested resource.

### ~~SCRBRD-052~~ — CLOSED
**Closed 2026-09-19.** `tools/smoke-browser-innings-end.mjs`: a real browser scores a real fixture to a
closed first innings (wickets through `WicketSheet`, however many the seeded squad actually takes — not a
hardcoded ten), confirms `InningsReviewSheet`'s review gate, starts the second innings from
`Innings2Sheet`, confirms the real target reaches the pad, closes the second innings the same way, and
lands on the result screen — with the two `innings_end` events cross-checked directly against Postgres.

Two real bugs found and fixed while building it, both in components no browser walk had exercised before
because nothing had ever driven an innings to completion:
- **`Badge` silently dropped `data-testid`, in two places.** `apps/web/src/scorer/ui.jsx`'s `Badge` (used
  by `InningsReviewSheet`'s `review-reason`) and `apps/web/src/ui/primitives.jsx`'s separate `Badge` did
  not spread extra props onto the underlying `<span>`, unlike `Card`'s already-established pattern in the
  same file. `review-reason`'s own `data-testid` was accepted by JSX and thrown away — a real defect
  waiting for the first thing to actually look for it, which this walk was. Fixed both to spread `...rest`,
  matching `Card`.
- **A second innings never gets a real target for the replay to close on** — filed separately as
  **SCRBRD-063** below rather than fixed inline, since it is a scoring-engine correctness change, not
  something a test file should carry.
**Title:** A browser walk that scores an innings to its end
**Priority:** P3 · **Domain:** Scoring · **Type:** test coverage
**Affected files:** `tools/smoke-browser-innings-end.mjs` (new); `apps/web/src/scorer/ui.jsx`,
`apps/web/src/ui/primitives.jsx` (the `Badge` fix)
**Affected users:** none directly — coverage for a path every real match eventually takes

**Current behaviour, before this:** `smoke-browser-sync.mjs` opens the real scorer and taps four
deliveries of twenty overs — enough to prove the pad reaches Postgres, nothing more. Nothing exercised the
review gate (SCRBRD-038), the innings break, the second innings' target, or the result screen.
**Expected behaviour:** an innings closed by wickets rather than overs — the cheap route, ten dismissals
through the wicket sheet against a hundred and twenty taps — covering the handover and quarantine paths
under a closed innings as a side effect of existing.
**Root cause:** nobody had needed a browser walk to run this long before.
**Recommended change:** done, as described above.
**Why it matters:** this is the first walk to ever reach `InningsReviewSheet`, `Innings2Sheet`, or the
result screen in a real browser, and it found two real bugs in its first hour of existing.
**Dependencies:** none. **Security / privacy impact:** none. **Data migration required:** NO.
**Tests required:** itself.
**Acceptance criteria:**
- [x] A real browser closes a first innings by wickets and confirms the review gate
- [x] The second innings' real target reaches the pad
- [x] The result screen is reached and Postgres agrees with what both screens showed
**Regression risk:** LOW — a new test file plus a two-line prop-spreading fix matching an existing pattern.

### SCRBRD-063
**Title:** A second innings never gets a real target, so it can never end on reaching one
**Priority:** P1 · **Domain:** Scoring · **Type:** correctness
**Affected files:** `apps/web/src/scorer/engine.jsx` (wherever the second innings' event log is opened —
today, nowhere), `packages/scoring/src/replay.mjs` (`inningsOverReason`, unchanged but worth re-reading
alongside the fix)
**Affected users:** every match that goes to a second innings and is won by reaching the target rather
than by the chasing side being bowled out or running out of overs — which, for a run-chase that succeeds,
is the common case, not the rare one

**Current behaviour, found building SCRBRD-052's browser walk:** `packages/scoring/src/replay.mjs`'s
`inningsOverReason()` only returns `target_reached` when `inn.target != null && inn.runs >= inn.target` —
and `inn.target` is set **only** by an explicit `target` field on that innings' own `INNINGS_START` event
(or a `REVISION` event). `packages/scoring/test/replay.test.mjs` already asserts this directly: its "chase
completed on the last legal ball" case passes `target: 6` on `inningsStart()` by hand. Checking
`apps/web/src/scorer/engine.jsx` for where the second innings gets its own `INNINGS_START` event with a
computed target found nothing, on either of this codebase's two paths into a second innings: the
from-scratch match setup (`open2` at engine.jsx, no `target` field) and the far more common path, resuming
a real fixture through `closeInnings()`'s `curIn===0` branch, which sets `modal:"innings2"` and never
emits an `INNINGS_START` for innings 1 at all — `addBatsman`/`addBowler` just emit `battersEvent`/
`bowlerEvent` straight into an innings whose derived object has never been told what it needs to win.

The pad itself is unaffected and already correct — `scoring.jsx`'s `target=curIn===1?(innings[0]?.runs||0)+1:null` computes and shows a real, correct target entirely client-side, independent of the replay
model. What is missing is the wiring from that number to the thing that is actually supposed to check it:
today, a real run-chase that reaches its target does not close the innings. It keeps going — by all out, or
by running out overs — however many further deliveries get bowled after the match was already effectively
over. A byproduct spotted along the way, from the same root cause: the result screen's `ScorecardPanel` for
the second innings shows a blank team-name heading (`{i.battingTeam} · Innings 2`) whenever `i.battingTeam`
was never set, because nothing set it.
**Expected behaviour:** the moment a second innings' runs reach its target, `inningsOverReason()` returns
`target_reached`, `InningsReviewSheet` opens on its own exactly as it does for all-out or overs-complete,
and the second innings' scorecard panel shows the real batting team's name.
**Root cause:** the review-gate refactor (SCRBRD-038) correctly wired `all_out` and `overs_complete`
through `after.complete`/`inningsOverReason`, both derivable from the innings' own ball log alone. `target`
is the one completion reason that is NOT derivable from one innings' own log — it needs the other innings'
result — and nothing was added at the point the second innings actually begins to carry that fact forward
into an event the replay can see.
**Recommended change:** when the second innings genuinely begins (the natural point is `Innings2Sheet`'s
`onStart`, before `setModal("opener")`, or the first `addBatsman`/`addBowler` call for that innings if
lazier initialisation is preferred), emit an `INNINGS_START` event for innings 1 carrying `target:
innings[0].runs + 1` alongside the same `battingTeam`/`bowlingTeam`/`teamKey`/`bowlingTeamKey`/`squad`/
`bowlingSquad`/`overs` fields the first innings' own `INNINGS_START` already carries, sourced from the
same `resume.cfg`/`match` state already available at that point (a home team confirmed by `resume.cfg`, an
away team's squad handled the same honest way an away bowler already is — typed, not invented, when there
is no roster to offer). A revised target (`RevisionSheet`) already overwrites `inn.target` via its own
`REVISION` event and needs no change.
**Why it matters:** this is a correctness gap in when a match is allowed to be over, not a display
polish item — a scorer has no signal that the chase is done, and would keep recording deliveries that,
under the Laws, should never have been bowled.
**Dependencies:** none. **Security / privacy impact:** none. **Data migration required:** NO — an event
shape change, not a schema one.
**Tests required:** a unit case in `packages/scoring/test/replay.test.mjs`-adjacent coverage (or extending
the existing "chase completed on the last legal ball" style) asserting `engine.jsx`'s own second-innings
event construction includes `target`; then `tools/smoke-browser-innings-end.mjs` rescoped to chase a
target down with real deliveries instead of a second round of wickets, once this lands.
**Acceptance criteria:**
- [ ] A second innings that reaches its target closes on `target_reached`, without needing all out or
  overs complete
- [ ] The second innings' `INNINGS_START` event carries `battingTeam`/`bowlingTeam` correctly, so the
  result screen's scorecard panel names the real team
- [ ] `smoke-browser-innings-end.mjs` is updated to chase a target rather than take a second round of
  wickets, and still passes
**Regression risk:** LOW-MEDIUM — adds an event, and an event shape change on a heavily-replayed path
deserves the full scoring suite run (`packages/scoring/test/*`, `apps/web/test/system.test.mjs`) before
shipping, not just the new browser walk.
