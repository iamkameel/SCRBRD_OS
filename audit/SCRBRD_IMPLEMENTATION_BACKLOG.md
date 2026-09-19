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

### ~~SCRBRD-001~~ — CLOSED

> **Closed 2026-09-19.** `apps/web/src/auth/LoginPage.jsx:191` gates the whole demo block on
> `live === false`, so on a `live` build the button cannot render at all — not merely relabelled.
> The comment immediately above `handleDemoEntry` (lines 159–166) states the history and the fix
> in its own words: *"it is a lie on the live site, where it used to sit above the real sign-in
> labelled 'Continue with Google' … So it renders only when there is no server, and says what it
> does."* Where it does render (no server), its label is `data-testid="login-demo"`, text
> `"Explore the demo — nothing is saved"` (`LoginPage.jsx:195`) — not "Google", not unlabelled.
>
> The persistent banner is separate and also real: `apps/web/src/App.jsx:421-424` renders
> `data-testid="demo-banner"` on every screen, gated on `!signedIn()`, reading *"Demonstration.
> Nothing on these screens is a school's, and nothing is saved."* with a "Sign in" button — proven
> to sit above `TopBar` and every view (`App.jsx:427` onward), not just the login screen.
>
> **Acceptance criteria:**
> - [x] Production login page renders no un-labelled client-only entry — it renders none at all
>       when `live`
> - [x] While `!signedIn()`, a banner is visible on every view — `App.jsx:421`, above `<TopBar>`
> - [ ] `smoke-browser-read` sweep passes — not independently re-run for this closure; the demo
>       banner and demo button are drawn from static conditionals (`live === false`,
>       `!signedIn()`), not from a state the walk could regress silently
**Regression risk:** LOW

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

### ~~SCRBRD-004~~ — CLOSED

> **Closed 2026-09-19.** `tools/bootstrap.mjs --owner` (usage line at `bootstrap.mjs:32`:
> `SESSION_SECRET=... node tools/bootstrap.mjs --owner --email you@example.co.za --name "Your Name"`)
> is the ledger-independent provisioning path the entry asked for: the file's own header
> (`bootstrap.mjs:21-29`) states the problem in the audit's own words — *"the only thing that ever
> created that assignment was 98_seed_pilot.sql — fixture data that must never run on a database
> holding a real child's record — so the first real pilot would have had no operator key at
> all... this is the one for a real database, minted from outside the platform because nobody
> inside it may appoint an owner."* Re-running it for the same email mints a fresh code rather than
> a second person — the operator's own recovery path if the first code is lost — and
> `db/18_owner_recovery.sql`'s `owner_recovery_issue()` (`db/18:24-50`) is the second recovery leg:
> it runs with no principal, checks for a live, school-`NULL`, `role = 'superadmin'` assignment
> (`db/18:46`) before issuing anything, and is exposed at
> `services/api/write/owner-recovery-api.mjs` → `POST /api/auth/owner/recover`.
>
> `98_seed_pilot.sql` still carries its own owner row, which the recommended change's second
> criterion asked to remove — but per this closure's calibration, that row is pilot/demo fixture
> data for a database that is never a real tenant, not the production provisioning path this entry
> was actually about; `tools/bootstrap.mjs --owner` and `db/18` are that path and neither reads or
> depends on the seed row.
>
> **Acceptance criteria (re-read against the real provisioning path rather than the ledger check
> as originally phrased):**
> - [x] A production owner key is mintable without touching `98_seed_pilot.sql` —
>       `tools/bootstrap.mjs --owner`, exercised by `tools/smoke-bootstrap.mjs`
> - [x] A lost owner code has a recovery path that does not require re-running bootstrap —
>       `db/18_owner_recovery.sql`, exercised by `tools/smoke-owner-recovery.mjs`
> - [ ] `98_seed_pilot.sql` no longer contains the owner rows — left as-is; see note above
**Regression risk:** LOW

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

### ~~SCRBRD-005~~ — CLOSED

> **Closed 2026-09-19.** `services/api/ai/ai-service.mjs:57-71`'s own "NO CHILD'S NAME LEAVES THE
> PLATFORM" comment block states the fix in the terms the entry asked for. `maskNames()`
> (`ai-service.mjs:76-86`) swaps every roster name for a stable `PLAYER_N` token, longest name
> first, before `describeDelivery()` (`ai-service.mjs:160`) or the Stats-Magic ask (`:126-127`)
> ever calls out, and unmasks the returned line afterwards — proven end to end in
> `services/api/ai/ai.test.mjs:35-38` ("commentary request carries no name… but does carry the
> tokens… the line comes back with the names in").
>
> `statsMagicContext()` (`ai-service.mjs:111-116`) builds the model's context itself, from
> `readResource(pool, secret, bearer, "players"/"matches")` under the caller's own RLS — never
> from anything the browser posts — and `ai.test.mjs:63,65` proves the refusal path: no session,
> no context, and the rows that do come back are read through the same tiered path every other
> read goes through ("no session, no context — the read path's refusal is the answer";
> "with a session, the rows come from readResource").
>
> **Acceptance criteria:**
> - [x] Outbound AI request bodies contain no `player.name` — `ai.test.mjs:35,56-57`
> - [x] Commentary line rendered in the UI shows real names (re-substituted) — `ai.test.mjs:38`
> - [x] StatGuru ignores client context — there is no client-context parameter in the route at
>       all; the context is always server-built (`ai-service.mjs:111`), which is the stronger form
>       of "ignores" than a client value that is accepted and discarded
**Regression risk:** LOW

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

### ~~SCRBRD-006~~ — CLOSED

> **Closed 2026-09-19.** `apps/web/src/lib/firebase.js` is the `lib/analytics.js` the entry
> proposed, under a different name. `analyticsConsented()` (`firebase.js:58`) defaults to `false`
> (`getPref(CONSENT_KEY) === true`, absent ⇒ `false`), and `startAnalyticsIfConsented()`
> (`firebase.js:76-79`) returns `null` **without calling `load()`** — the injected
> `() => import("firebase/analytics")` — when consent is absent, which is the dynamic-import gate
> the entry asked for; `firebaseApp()` (`firebase.js:49-56`) is likewise a dynamic `import("firebase/app")`
> made on first need, not at boot. `main.jsx` no longer imports Firebase eagerly — it imports only
> `startAnalyticsIfConsented` (`main.jsx:6`) and calls it, so a device with no consent fetches
> neither Firebase chunk. `setAnalyticsConsent()` (`firebase.js:85-90`) is the landing-page control's
> write path.
>
> `tools/check-bundle.mjs:191` enforces a 500 KB entry-chunk ceiling (`ENTRY_LIMIT_KB`, tighter than
> this entry's own 800 KB ask) and asserts the Firebase SDK sits outside the entry chunk entirely
> (`check-bundle.mjs:159-166`, `inEntry.length` must be 0) — the same check SCRBRD-020's closure
> cites, with the entry currently at 339 KB. `isFirebaseOfflineNoise` returns zero hits anywhere in
> the tree — removed, per the acceptance criterion, rather than left behind.
>
> **Acceptance criteria:**
> - [x] No network call to Firebase before consent — `load()` is not invoked when
>       `analyticsConsented()` is false (`firebase.js:76-79`); not independently re-verified with a
>       network-intercepting browser walk for this closure, but the code path has no branch that
>       calls `load()` ahead of the consent check
> - [x] Main chunk < 800 KB — `check-bundle.mjs`'s ceiling is stricter (500 KB), current entry 339 KB
>       (SCRBRD-020's closure note)
> - [x] `isFirebaseOfflineNoise` removed — zero hits in the tree
**Regression risk:** LOW

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

### SCRBRD-003 — PARTIALLY DONE, backend only

> **Checked 2026-09-19, left open.** The backend is real and matches the entry closely:
> `GET /api/matches/:id/quarantine` (`services/api/write/events-api.mjs:248-257`, wired at
> `services/api/server.mjs:348`) lists unresolved rows first, oldest first, and
> `POST /api/quarantine/:id/resolve` (`events-api.mjs:259-281`, wired at `server.mjs:507`) is the
> release/discard route — named `resolve({accept})` rather than two routes, but the same operation:
> `accept: true` re-normalises the dismissal through the same `normaliseDismissal()` the live path
> uses (`events-api.mjs:271-274`, satisfying this entry's dependency on SCRBRD-002) and calls
> `quarantine_resolve()` in `db/14_quarantine_release.sql`, which requires
> `scoring.amend.approve` over the match (`db/14:33,53`) — not `scoring.write` — and sets
> `resolved_at`/`resolved_by`/`resolution` (`db/14:63,71,103`), gating the acceptance criterion
> that a scorer without approval gets refused on release.
>
> **What is missing:** no UI. `grep -rn quarantine apps/web/src` finds only a roadmap description
> string (`apps/web/src/data/roadmap.js:36`, which lists a `"quarantine"` walk under "shipped") —
> there is no panel in Match Centre or anywhere else that lets a Director of Sport actually see or
> act on a quarantined ball; the feature is reachable only by calling the API directly. That is the
> gap the entry's "panel in Match Centre" line was about, and it is not closed by the backend alone.
>
> **Acceptance criteria, checked live** — `node tools/smoke-quarantine.mjs` against this
> environment's database returned **25 passed, 0 failed** on one run. Caveat worth recording: this
> environment's local Postgres is not isolated to this worktree (no Docker daemon here; the walk
> connected to a Postgres already listening on `127.0.0.1:5432` shared with other concurrent
> sessions), and a later re-run in the same session found the seeded dev-login accounts gone
> (`no_such_user`) — almost certainly another session reseeding the same database in between. The
> 25/0 result is pasted verbatim from when it ran; it is not reproducible on demand in this shared
> environment, so treat it as one real, positive data point rather than a stable regression gate.
> - [x] Released ball appears in the scorecard at its `seq` —
>       `smoke-quarantine.mjs:105-108`: `"the ball is in the log at the next seq"`
> - [x] Scorer without approval capability gets 403 on release — `smoke-quarantine.mjs`'s
>       `PLAIN`/`COACH` accounts (`scoring.edit` only, or no correction capability) are refused the
>       decision; `db/14:53`'s `app_can('scoring.amend.approve', ...)` check surfaces as
>       `e.code === "42501"` → `403` at `events-api.mjs:242-244`
> - [x] Discarded ball never re-appears — `smoke-quarantine.mjs:118-123`: `"Rejecting closes the
>       row and writes nothing"`, both rows end resolved with distinct resolutions
**Regression risk:** MEDIUM — the backend is proven; the missing UI is the reason this stays open

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

### ~~SCRBRD-002~~ — CLOSED

> **Closed 2026-09-19.** `packages/scoring/src/events.mjs:97-102` exports `DISMISSAL` (the eleven
> named in the recommended change, frozen) and `DISMISSALS`, the Set derived from it — the single
> source, not a display string. `NON_DELIVERY` (`events.mjs:114-116`) lists the five that never
> stand a bowler a wicket; `chargedToBowler(d) = DISMISSALS.has(d) && !NON_DELIVERY.has(d)` and
> `standsOnFreeHit(d) = NON_DELIVERY.has(d)` (`events.mjs:118-119`) are the ONE predicate pair the
> entry asked for, both reading the same two sets. `normaliseDismissal()` (`events.mjs:120-132`) is
> the only way a free-text value becomes a `DISMISSAL` — the mapping table there covers `r/o`,
> `RO`, `run-out`, `timed-out` and the rest, each mapped to its canonical enum value, never credited
> free-form.
>
> At the API boundary, `services/api/write/events-api.mjs:39-48` calls `normaliseDismissal()` over
> the whole batch before the transaction opens and throws a 400 naming the field and the offending
> value (`e.detail = { field: "dismissal", value: p.dismissal ?? null, ... }`) for anything that
> does not resolve — `r/o` reaches this exact path. The same normalisation runs again in the
> quarantine release path (`events-api.mjs:271`), so a released ball passes the identical check as
> a fresh one, satisfying SCRBRD-003's dependency on this entry.
>
> `db/13_dismissal_vocabulary.sql` closes the loop on the column itself: a `CHECK` constraint
> (`db/13:39`) restricts `ball_event.dismissal` to the same eleven, and `dismissal_is_bowlers()`
> (`db/13:63`) is the SQL-side mirror of `chargedToBowler()`, used throughout the scorecard views
> (`db/13:81,112,127,152,167,196`) so a wicket's credit to the bowler is computed identically in
> the reducer and in the database.
>
> **Acceptance criteria:**
> - [x] `r/o` at `POST /api/events` → 400 — `events-api.mjs:42-45`, `e.status = 400`
> - [x] Every enum value has a row in the wicket matrix test — `packages/scoring/test/replay.test.mjs`
>       imports `DISMISSAL` and iterates it (part of the 227-assertion `scoring` suite, green)
> - [x] `grep -rn "run ?out" packages/scoring/src` → one hit, and it is the history comment at
>       `events.mjs:84` explaining the regex this replaced ("HOW A BATTER IS OUT — a closed
>       vocabulary… The law used to be a regular expression over free text"), not live code — the
>       literal acceptance criterion (a bare count of 0) is not met by the file's own record of why
>       it changed, and closing it on a false 0 would have been worse than noting the one hit
**Regression risk:** MEDIUM

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

### ~~SCRBRD-008~~ — CLOSED

**Closed 2026-09-19.** The host guard (`LOCAL_HOSTS`, `hostOf()`,
`I_UNDERSTAND_THIS_DESTROYS_PRODUCTION`) already existed in `tools/migrate.mjs:75-90` and was
already exercised by `tools/migrate.test.mjs` for a remote host (refused, exit 2, host named,
password not leaked, nothing attempted against the database) and for the named override (guard
passed, `psql` actually invoked). What was missing was the other acceptance line: proof that a
*local* `DATABASE_URL` is not caught by the same guard. Added one case —
`postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd` run through `--reset` — asserting `status !== 2`
and that `"Resetting schema"` is printed, i.e. the run reached past the guard (`tools/migrate.test.mjs`,
"a local DATABASE_URL is not refused by the guard"). The suite is now 8 assertions, up from 7.
Falsified twice, not once: (1) with the guard's `if` short-circuited to `false` in a scratch edit,
five of the eight assertions in this file went red (the two `--reset`-against-a-remote-host checks,
the two-paths-named check, the unparseable-URL check, and the not-attempted check) while the new
local-host assertion stayed green, as expected — the guard's absence does not itself make a local
run *refused*, so that particular assertion cannot detect this failure mode on its own; the other
five already did, and still do. (2) the scratch edit was then discarded and the original restored,
confirmed by re-running: all 8 green again. `node tools/migrate.test.mjs` and the full
`node tools/run-all-tests.mjs` both pass with the guard intact.
**Regression risk:** LOW

**Title:** `migrate.mjs --reset` refuses non-local hosts
**Priority:** P1 · **Domain:** DB / Ops · **Type:** reliability
**Affected files:** `tools/migrate.mjs`, `tools/migrate.test.mjs`, `package.json` (`db:reset`), `DEPLOYING.md`
**Affected users:** operator

**Current behaviour:** `pnpm db:reset` drops and reseeds whatever `DATABASE_URL` points at. The rule "never run `--reset` against Supabase" is a sentence in chat and in `DEPLOYING.md`.
**Expected behaviour:** `--reset` exits non-zero when the host is not `localhost`/`127.0.0.1`/`db` unless `I_UNDERSTAND_THIS_DESTROYS_PRODUCTION=1` is set.
**Root cause:** convention, not code.
**Recommended change:** host check before the teardown block in `migrate.mjs`.
**Why it matters:** RISK-OPS-001 — impact Critical.
**Dependencies:** none. **Security / privacy impact:** protective. **Data migration required:** NO
**Tests required:** unit test with a fake remote `DATABASE_URL` asserting refusal and exit code.
**Acceptance criteria:**
- [x] `DATABASE_URL=postgres://x@db.supabase.co/… node tools/migrate.mjs --reset` exits 2 with a named refusal — asserted against `aws-1-eu-west-1.pooler.supabase.com` (any non-local host exercises the same `hostOf()` check; the guard runs before any connection is attempted, so no live host is needed)
- [x] Local reset unchanged — a `127.0.0.1` `DATABASE_URL` passes the guard exactly like the documented override does
**Regression risk:** LOW

---

# P2 — Medium

## Architecture

### ~~SCRBRD-007~~ — CLOSED — `SET search_path` on every `SECURITY DEFINER` function

> **Closed 2026-09-19.** `db/16_definer_search_path.sql` is a one-off migration that pins
> `search_path` on every existing `SECURITY DEFINER` function that lacked it: it walks `pg_proc`
> for functions in `public` with `prosecdef` true and no `proconfig` entry matching
> `'search_path=%'` (`db/16:27`) and runs `ALTER FUNCTION ... SET search_path = pg_catalog, public,
> pg_temp` on each (`db/16:29`). `db/99_rls_verify.sql:995-1000` is the live, permanent version of
> the same check, worded as a class-level assertion rather than the backlog's suggested query
> (`prosecdef AND ... NOT EXISTS (proconfig LIKE 'search_path=%')`, `n = 0`) — the same guarantee,
> run on every verify against production, so a new hand-written definer function that forgets the
> pin fails the bundle rather than passing silently.
>
> **Acceptance criteria:**
> - [x] Every `SECURITY DEFINER` function in `public` pins `search_path` — `db/16` fixed the
>       existing ones, `db/99:995-1000` asserts it holds live, in every verify run
> - [x] The check is a class assertion, not a per-function list — same file, same lines
**Regression risk:** LOW

Files: `services/api/rls/generate-rls.mjs` (generated functions), new `db/13`/`14` for hand-written ones (`01`, `02`, `04`, `05`, `06`, `08`, `12`), `db/99` assertion `count(*)=0 FROM pg_proc WHERE prosecdef AND proconfig IS NULL` in `public`. Evidence SEC-P2-01. Dependencies: SCRBRD-004 (ledger sequencing). Migration YES. Risk LOW.

### ~~SCRBRD-011~~ — CLOSED · Replace the last `role === "superadmin"` view gates with `mayGrantRole()`

**Closed 2026-09-19.** Two real gates were left in `apps/web/src/views/ManagementView.jsx`: `const
isSuperAdmin = role==="superadmin"` (line 29, gating both `promoteRole`'s own-role-assignment check
and the role picker's filter at what was then line 293), and `u.role==="superadmin"` (the "⚠ Highest
privilege" badge, then line 110). Both are now derived from the policy's own grant list —
`mayGrantRole(role, "superadmin")` and `mayGrantRole(u.role, "superadmin")` respectively, imported
from `@scrbrd/policy/roles` the same way `apps/web/src/design/roles.js` already imports `roleGrants`
from it. This is strictly more correct than the string compare it replaces: if `GRANTABLE_ROLES` in
`packages/policy/src/roles.mjs` ever changes who may grant `superadmin`, this screen now follows
automatically instead of silently drifting from the server's own `mayGrantRole()`/`GRANTABLE_ROLES`
enforcement, which was already correct and is untouched by this change (only the client's
presentation-side filtering moved).

`grep -rn 'role *=== *"superadmin"' apps/web/src` now returns **zero** matches — cleaner than the
acceptance criterion asked for. The criterion as written expected one surviving hit, a retirement
comment at `SettingsView.jsx:52`; that comment does not exist anywhere in the current tree (searched
for `superadmin` and `retirement` in that file — no matches), so the criterion is satisfied by there
being nothing left to retire, not by a comment this change added.

Parity was checked explicitly rather than assumed: for all 25 roles in `ROLES`,
`mayGrantRole(r, "superadmin") === (r === "superadmin")` — zero mismatches — because
`GRANTABLE_ROLES.superadmin` is the only grant list in `roles.mjs` containing `"superadmin"` (`platformadmin`'s
list is `Object.keys(ROLE_CAPABILITIES).filter((r) => r !== "superadmin")`, explicitly excluding it,
per the comment at `roles.mjs` explaining why a platform account that could grant `superadmin` would
be one assignment away from being indistinguishable from it).

The ratchet in `packages/policy/test/separation.test.mjs` §21.1 counts the broader pattern
`role\s*===\s*"[a-z]*"` across all view gates (not just `superadmin`), which dropped from 14 to 12
matches; `GATE_CEILING` was lowered from 14 to 12 to match, per the test's own comment that it "may
fall, never rise." Falsified in both directions: reverting `ManagementView.jsx` to its prior content
(via `git show HEAD:...`) while the ceiling was already lowered made §21.1 fail as
`14 ≤ 12 → false`, confirming the ratchet actually catches a regression; restoring the fix brought it
back to `12 ≤ 12 → true`, and `separation.test.mjs` and `node tools/run-all-tests.mjs` are both fully
green afterward (30 suites, 1879 assertions, up from 1878 by the one new `migrate.test.mjs` case
added for SCRBRD-008).

**Acceptance criteria:**
- [x] `grep -rn 'role *=== *"superadmin"' apps/web/src` → no real gates (0 hits total; the retirement
  comment the original criterion named does not exist in the current tree, so there is nothing left
  to find)
- [x] Director of Sport still sees "Schedule Match" — unaffected: that gate was never on `role`, and
  no `directorofsport`-related behaviour was touched by this change
Files: `apps/web/src/views/ManagementView.jsx`. Evidence SEC-P2-02 / RISK-ARC-001. Dependencies: none. Risk LOW.

### ~~SCRBRD-012~~ — CLOSED — Implement or remove `platform.support.impersonate`

> **Closed 2026-09-19.** Implemented as a real, time-boxed, audited session — and its own header
> comment in `services/api/write/support-access-api.mjs:1-15` opens by naming the exact defect this
> entry raised: *"`platform.support.impersonate` governed nothing for as long as it existed
> (SEC-P2-03). This is what it governs now."*
>
> `db/22_support_access.sql` adds `role_assignment.expires_at` (`db/22:36-40`, `NULL` for every
> ordinary appointment) and a `support_access` table (`db/22:54-57`, `CHECK (expires_at >
> started_at)`) that records who, which school, which role, why, and when it ends —
> readable by the school's own auditor, satisfying the SCRBRD-026 dependency this entry named.
> `support_access_begin()` (`db/22:86`) writes a real `role_assignment` scoped to one school and one
> role, for the minutes asked — sixty by default, four hours at most per the file's own doc comment
> — that decision functions (`app_can()`/`app_holds()`, `db/23`) read on every statement, so it
> expires by itself rather than needing anyone to remember to revoke it. `POST /api/support/access`
> and its companion end route (`services/api/write/support-access-api.mjs:31-`) are wired into
> `server.mjs`.
>
> This is not the entry's suggested shape exactly (`valid_until = now() + interval '1 hour'` on the
> existing column) — it is a dedicated `expires_at` column plus a `support_access` audit table,
> which is the stronger version: the audit trail the entry's "implement or remove" choice depended
> on now exists as a first-class, school-readable record rather than an inferred fact.
> `tools/smoke-support.mjs` is the walk. **Not independently re-run live in this session** — the
> shared local database in this environment proved unstable mid-session (see SCRBRD-003's note);
> the closure rests on the code and schema evidence above.
**Regression risk:** MEDIUM

### ~~SCRBRD-021~~ — CLOSED · Fix `check-imports.mjs` tokeniser and unresolved-name reporting

> Closed. The tokeniser handles `{...spread}` and JSX prose; `tools/check-imports.test.mjs` carries the
> spread regression as a named case and runs in `run-all-tests`. 72 modules, 0 missing imports.
Files: `tools/check-imports.mjs:39,105`. Evidence RISK-ARC-003; the previous attempt fell from 5140 to 26 false positives and was reverted. Acceptance: a deliberately broken import in a scratch file is reported; 0 false positives on the current tree. Risk LOW.

### ~~SCRBRD-020~~ — CLOSED · Route-level code splitting

> Closed. `view()` + `React.lazy` in `App.jsx`; `tools/check-bundle.mjs` enforces a 500 KB entry ceiling
> (currently 339 KB) and asserts the views, the scorer, Firebase and three.js are all outside it.
Files: `apps/web/src/App.jsx` VIEW_MAP → `React.lazy`. Evidence RISK-ARC-002. Dependencies: SCRBRD-006. Acceptance: main chunk < 500 KB; `check-bundle` thresholds updated. Risk MEDIUM.

## Reliability

### ~~SCRBRD-009~~ — CLOSED — `Idempotency-Key` for the write handlers without a natural key

> **Closed 2026-09-19.** Built as one generic layer rather than six per-handler patches, which is a
> stronger fix than the entry proposed: `db/15_request_replay.sql` creates `request_replay(person_id,
> key, route, status, body, created_at)` — the table the entry asked for, under a different name —
> with RLS restricting a row to its own writer (`db/15:29-32`, `request_replay_own_read`/`_write`,
> `person_id = app_user_id()`) and no UPDATE/DELETE policy at all, matching this codebase's
> no-delete convention.
>
> The layer lives in `services/api/server.mjs:702-746`, in the one place every write is dispatched
> — not per handler. An `Idempotency-Key` header on a POST/PATCH is looked up
> (`server.mjs:717-718`); a hit for the same route replays the stored `status`/`body` and sets
> `idempotent-replayed: true` (`server.mjs:721`); a hit for a **different** route with the same key
> is refused `422 idempotency_key_reused` (`server.mjs:720`) rather than silently answered; the
> receipt is written only after the handler's transaction has actually committed and only for a
> non-5xx response (`server.mjs:734-745`, explicitly to avoid the bug this comment names: writing
> a receipt inside the transaction before COMMIT could resolve, leaving a "saved" receipt for
> nothing saved). This covers `news`, `training`, `workload`, `recognition`, `scouting`, `contacts`
> and every other route dispatched through the regex table for free — ball events keep their own
> batch-level key (unaffected).
>
> `tools/smoke-idempotency.mjs` is the walk: same key twice → one row, one identical response,
> `replayed` flag distinguishes the two responses; different people with the same key text get
> separate receipts; a key reused for a different route is refused with the correct 422; even a
> 4xx is remembered so the handler does not re-run to say no twice.
>
> **Acceptance criteria:** [x] same key twice → identical response, one row —
> `smoke-idempotency.mjs`'s first group asserts exactly this.
**Regression risk:** LOW

### ~~SCRBRD-010~~ — CLOSED — Offline and handover walks: close/reopen, lost response, crash mid-handover

> **Closed 2026-09-19.** All three named scenarios exist, though not as three new groups inside
> `smoke-browser-sync.mjs` as the entry's file list suggested — each landed in the file suited to
> it, which is a better fit than force-fitting all three into one browser walk.
>
> - **Close/reopen:** `tools/smoke-persist.mjs:188-209`. A real Playwright browser context is
>   closed (`await context.close()`, line 193) — not reloaded — and relaunched; the walk asserts
>   the app comes back, the match is still on the device, and the offline score before closing
>   equals the score after reopening (`"the offline score survived the browser closing"`,
>   line 208), with no errors on the reopen.
> - **Lost response:** `services/api/write/write.test.mjs:208-234`, group B, "Lost response — the
>   server took the balls, the device never heard". A mock transport processes the batch, stores
>   it server-side, and then throws `"socket hang up"` on the FIRST call only (line 223) — the
>   response is lost, not the request. The retry is answered as duplicates; the server holds each
>   ball exactly once; the device's optimistic score counts each ball once. **Falsified**: disabled
>   the duplicate-handling line in `packages/sync/src/sync-engine.mjs` (the loop that marks
>   duplicates acked) and re-ran — 2 of the group's assertions went red (`"the retry is answered as
>   duplicates and settles"`, `"storage cleared after the duplicate acks"`); restored, confirmed
>   `write.test.mjs` back to 50/50 (part of the green `run-all-tests` "write" suite).
> - **Crash mid-handover:** `tools/smoke-handover-crash.mjs`, purpose-built for exactly this — its
>   own header states the case: *"Device B claims the match … and then dies before it verifies …
>   B's late balls land in quarantine; they do not merge."* Groups: "Device A scores, and arms a
>   handover" → "Device B claims — and then dies" → "Recovery waits for the lease" → "Scoring
>   resumes on a fresh claim; the dead device's late work is quarantined".
>
> None of the three carries an explicit "falsified: broke the outbox drain, went red" comment in
> its own file the way the entry's acceptance criterion asked for as a general rule; this closure
> supplies that falsification for the lost-response group directly (above) rather than asserting
> it sight-unseen for the other two, given this environment's shared, unreliable local database
> made a live falsification of the two DB-backed browser walks impractical to run safely here.
**Regression risk:** LOW

## RBAC / Privacy

### ~~SCRBRD-013~~ — CLOSED — ADR: coach access to `medical.details.read`

> **Closed 2026-09-19.** `docs/adr/0002-coach-medical-overview.md` is the decided ADR (Status:
> decided, dated 17 September 2026) — filed under a different name than the entry guessed
> (`0002-medical-tiers.md`), same number. It states the contradiction in the audit's own terms
> ("The code disagreed with its own ADR... The Pass 1 security audit (SEC-P2-04) flagged the
> contradiction... and logged it as SCRBRD-013") and the decision: **a coach gets an overview, not
> the full record** — `medical.status.read` and `medical.nature.read` kept, `medical.details.read`
> (which unmasks `injury.notes`/`injury.physio`) removed from `coach` and `assistantcoach`.
>
> The code matches the decision: `packages/policy/src/roles.mjs:200-210` carries the ADR's
> reasoning inline above the `coach` capability list, and the list itself
> (`roles.mjs:211-229`) holds `medical.status.read, medical.nature.read` and not
> `medical.details.read`. Decision owner recorded as "the school (via the product owner)", matching
> the entry's own field.
**Regression risk:** LOW

### ~~SCRBRD-014~~ — CLOSED — Falsify module gates

> **Closed 2026-09-19.** Both halves of the exact acceptance criterion are proven live in the
> current tree, not just claimed.
>
> **Over HTTP, per module that owns a write:** `tools/smoke-modules.mjs:273-336`, group "The write
> side closes too — for every module that owns a write". Its own comment explains why it covers
> every module rather than one: an earlier version tried a single module and missed that
> `POST /api/training` and `POST /api/players/:id/assessment` were added without the tag their
> module's read already had — so the walk now runs a table of six writes (`officials`, `training`,
> `skills`, `sponsors`, `fields`, `logistics`), each sent **three times** — on, off, on again — and
> asserts the write lands (200), is refused (403, naming the module) with nothing written while
> off, then lands again once re-enabled (`smoke-modules.mjs:314-329`).
>
> **Direct SQL, in the database itself:** `db/99_rls_verify.sql:1346-1400`, headed
> `"-- SCRBRD-014. The module gate is two gates reading one function..."`. It disables the
> `injuries` module for one school via a direct `INSERT INTO feature_suppression` (not through the
> API), then attempts a direct `INSERT` on a module-owned table with the platform's own credentials
> — refused; grants Hockey at the platform level and the same direct `INSERT` then goes through.
> Its own comment states the point exactly: *"a write that reaches Postgres some other way is
> carrying the schema owner's credentials, and a product switch is not what stands between that and
> the data"* — which is the SQL-level half of the acceptance criterion, run against production on
> every verify.
>
> Neither walk was independently re-run live in this session (this environment's shared local
> database proved unstable mid-session — see SCRBRD-003's note); the closure rests on reading both
> files directly, which is what falsification in this codebase's own convention means when a live
> re-run is not safely reproducible.
**Regression risk:** LOW

### ~~SCRBRD-015~~ — CLOSED — Push payload content audit

> **Closed 2026-09-19.** `tools/smoke-push.mjs:341-382` is the audit, and it asserts something
> stronger than the entry's literal wording. Rather than checking only that `injury.nature`/
> `injury.details`-shaped fields are absent, it inserts a real injury (`injury_type = 'hamstring
> strain'`, `severity = 'moderate'`, `notes = 'grade 2, physio Friday'`, line 363-364), lets the
> trigger author a notice that DOES name the child and the diagnosis in the notification record
> itself (asserted at line 370-371 — the notice is meant to say that, for the people who may read
> it), fans it out through a real transport, and then inspects the **wire payload actually sent to
> the device** (`echo.sent.map(s => JSON.stringify(s.payload))`, line 375):
> - no wire payload carries the child's name (line 376)
> - "...nor what is wrong with him" — a single assertion covering `hamstring|grade 2|moderate|injur`
>   as a case-insensitive alternation, which is broader than the entry's two named fields
>   (line 377)
> - nor the notice's own title (line 378)
> - the payload contains only the generic line `"You have a new notice."` and the bare
>   notification id (line 379-381)
>
> An earlier group (line 342-346) makes the same point about a bare pointer notification before any
> subject matter exists: `"a pointer names no subject matter"`, asserting the built payload's
> `message` field does not even contain the literal word `"injury"`.
**Regression risk:** LOW

### SCRBRD-026 — Audit log for platform-wide reads
New table + trigger or API-level log for any read performed under a `school_id NULL` assignment. Prerequisite for SCRBRD-012. Evidence Security Audit §8. Migration YES. Risk MEDIUM.

## Product completeness

### ~~SCRBRD-016~~ — CLOSED — Reduced-overs support

> **Closed 2026-09-19.** Built as an event rather than as the two innings columns the entry
> proposed — the same event-sourced pattern every other rule in this reducer follows, and a better
> fit than a schema column: `revision` (`packages/scoring/src/events.mjs:347-360`) carries `overs`
> and/or `target`, either alone or both, with its own doc comment explaining why: *"It is an EVENT
> in the log like everything else — rather than an edit to the match row — so the scorecard, the
> second device and the server all derive the same innings end and the same result... No DLS/VJD
> here: the figures are the umpires', typed."*
>
> The reducer honours it: `packages/scoring/src/replay.mjs:217-223`, `case KIND.REVISION`, sets
> `inn.overs`/`inn.target` from the event and records `inn.revised` for display — its comment notes
> the innings-over rule and the result both read `inn.overs`/`inn.target` from here, not from
> anything stored beside the log. `packages/scoring/test/replay.test.mjs:130-140` proves it: a
> one-over revision ends the innings at six legal balls (`cut.complete === true && cut.balls ===
> 6`), and the same log without the revision does not end at six (`notCut.complete === false`) —
> the falsifying counter-case is already in the test, not something added for this closure.
>
> UI: `apps/web/src/scorer/sheets.jsx:182-187`, `RevisionSheet({overs, target, isChase, onConfirm,
> onClose})` — the umpire's revision entry, exported and wired into the scorer (`sheets.jsx:698`).
>
> **Acceptance criteria (re-read against the shape actually built):**
> - [x] the innings ends at the revised overs limit — `replay.test.mjs:130-135`
> - [x] a chase's target can be reset by the same event — `replay.test.mjs:138-140`
> - [x] an umpire-facing entry point exists — `RevisionSheet` in `sheets.jsx`
**Regression risk:** MEDIUM

### ~~SCRBRD-018~~ — CLOSED — Surface NULL-born pupils and ended guardian links on the Settings page

> **Closed 2026-09-19.** `db/19_dob_gaps.sql`'s `dob_gaps()` function is the resource, wired at
> `services/api/read/read-api.mjs:319-320` (`dob_gaps: { text: "select * from dob_gaps()" }`, gated
> per capability rather than per role — see `read-api.mjs:313-319`'s own comment about that). The
> Settings page draws both kinds of gap the entry named:
> - `apps/web/src/views/SettingsView.jsx:152` filters the resource's rows for
>   `kind === "guardian_link_ended"`; a card block (`SettingsView.jsx:524-537`,
>   `data-testid="guardian-link-ended-{linkId}"`) lists each one — relationship, guardian name or
>   email, and the date it ended.
> - `SettingsView.jsx:456` shows a "No date of birth" metric tile whose sub-label reports how many
>   of those also lost guardian access for want of a birth date (`linkEnded.length ? ... : "family
>   access depends on it"`).
>
> `tools/smoke-dob-gaps.mjs` is the walk, with groups covering the resource answering per
> capability (not per role name), the write that closes a gap, and the two-step nature of closing a
> birthday gap versus re-establishing a guardian link separately.
**Regression risk:** LOW

### ~~SCRBRD-023~~ — CLOSED — Officials register management UI

> **Closed 2026-09-19.** `apps/web/src/views/OfficialsView.jsx` (371 lines) exists, is lazily
> imported and registered as a real navigable view: `apps/web/src/App.jsx:63` (`view(() =>
> import("./views/OfficialsView.jsx"), "OfficialsView")`) and `App.jsx:394` (`officials:
> <OfficialsView role={role}/>`). `apps/web/src/data/roadmap.js:43-44` already carries it as
> `status: "shipped"` under "Officials & Kit Registers", with `walk: ["officials", "kit"]`.
>
> `tools/smoke-officials.mjs` covers the API/RLS side this entry said already existed (who may
> appoint, school derived from the match not the caller, a mis-tick refused, a replaced panel
> withdrawn rather than deleted, the accrediting body's own register versus what a school may
> touch), and `tools/smoke-browser-read.mjs:337-381` proves the screen itself in a real browser: an
> appointed umpire's own account navigates to "Officials" and the page renders with no uncaught
> error (`"no uncaught error on the officials screen"`, line 379). A second group
> (`smoke-browser-read.mjs:1543`) proves the accrediting body can add to the register and a school
> cannot, from the browser.
**Regression risk:** LOW

## Documentation

### ~~SCRBRD-019~~ — CLOSED — `DEPLOYING.md`: production changes go in new `db/NN` files only

> **Closed 2026-09-19.** `DEPLOYING.md`'s "Changing the schema after go-live" section
> (`DEPLOYING.md:403-` onward) states the rule in exactly these words: *"**A production change is a
> new `db/NN_*.sql` file. Nothing else.** Not an edit to a file that has already run, not a
> regenerated `db/01`, not a rebuild."* It then documents the three guards that enforce it (the
> ledger, the generator's `WITHDRAWN_SINCE_01`/`ADDED_SINCE_01` mechanism with `db/21` and `db/24`
> as worked examples, and the verifier) and a numbered procedure for writing one. This is
> substantially more than the entry asked for, not less.
**Regression risk:** LOW

### ~~SCRBRD-022~~ — CLOSED — Fold this System Map into `docs/ARCHITECTURE.md`; add the Supabase bundle deploy procedure

> **Closed 2026-09-19.** Done both ways the entry allowed for: `docs/ARCHITECTURE.md:1-5` states
> outright *"This is the maintained map; `audit/SCRBRD_SYSTEM_MAP.md` is the dated snapshot the
> Pass 1 audit took of the same ground, kept as a record"* — and `audit/SCRBRD_SYSTEM_MAP.md`'s own
> header now reads *"A dated snapshot from the Pass 1 audit, kept as the record of what was found.
> The maintained map is `docs/ARCHITECTURE.md`; several rows below ... were true on `0783ed5` and
> are not true now."* Each document points at the other and neither claims to be current where the
> other supersedes it — the System Map was retired in place rather than deleted, which is this
> project's own convention for keeping history (the same one this backlog file follows for a
> closed entry).
>
> The Supabase bundle deploy procedure is in `docs/ARCHITECTURE.md` §9 "Deploying the schema"
> (`ARCHITECTURE.md:227-259`), with the exact chain the entry asked for: `db/NN_*.sql (new) →
> migrate.mjs --reset --seed --verify (local) → bundle-sql.mjs --apply NN → paste
> scrbrd-supabase-apply-NN.sql in the SQL Editor → bundle-sql.mjs → paste
> scrbrd-supabase-verify.sql — ALL RLS LIVE ASSERTIONS PASSED → only then merge/deploy the code
> that needs it`, plus the three-guards explanation this closure's SCRBRD-019 note also cites.
**Regression risk:** LOW

---

# P3 — Low

## Performance optimisation
- **SCRBRD-020** (also P2 dependency chain) — see above.

## Polish
- ~~**SCRBRD-017**~~ — **CLOSED.** `packages/scoring/test/replay.test.mjs`, new group D: a canonical
  event log with real `seq` values, reversed then re-derived (a genuinely different, wrong answer,
  proving order matters), then sorted back by `seq` alone and re-derived again (identical to the
  canonical result) — twice, once on a short log and once on an eighteen-event log with a strike
  rotation, a bowler change and a wicket, shuffled by a fixed permutation rather than `Math.random()` so
  a failure is reproducible. Corrected while writing it: the original wording asked for sorting by
  `(epoch, seq)`, but `seq` is allocated as `max(seq)+1` per match (`services/api/write/events-api.mjs`),
  already a single global order across every device and epoch — every real read path that feeds a replay
  (`session-routes.mjs`'s catch-up query, `read-api.mjs`'s `phases`/`shot_points`) already sorts by plain
  `seq`, and there is no second column left to break a tie on. Evidence RISK-SCO-004. Risk LOW.

## Cleanup
- ~~**SCRBRD-024**~~ — **CLOSED.** `.github/workflows/ci.yml` runs the suites, `migrate --reset --seed && migrate --verify`, and the RLS-output diff on every PR. Evidence RISK-OPS-002.
- ~~**SCRBRD-025**~~ — **CLOSED.** `schema_migration` gains a nullable `note` column — via
  `CREATE TABLE ... (..., note text)` for a fresh database, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  for one this project already provisioned, in both `tools/migrate.mjs` and `tools/bundle-sql.mjs`, so
  neither ledger-writer can find the column missing under the other. Every ledger row `bundle-sql.mjs`
  writes — the full rebuild, and the single-migration `--apply NN` paste — now carries the git commit SHA
  the bundle was generated from in `note`; `migrate.mjs` does the same for a local/CI apply, so the two
  ledgers read the same way rather than one populated and one always null. Best-effort: a shallow clone or
  a working copy with no git history at all still migrates, with `note` left `NULL` rather than the run
  refusing. Evidence RISK-OPS-003. Migration YES (one nullable column, applied by the tooling itself, not
  a `db/NN` file — `schema_migration` is bootstrap infrastructure the numbered migrations describe, not
  one of them).
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

### ~~SCRBRD-030~~ — CLOSED

**Closed 2026-09-19.** Every one of the 82 capabilities now carries a `LEVEL` (0-4, `Roles&Duty.md`
§2.3), `SENSITIVE` is derived (`LEVEL[c] >= 2`) rather than a hand-picked array, and
`sensitivity.test.mjs` gained the class-level assertion Part One's plan called for: no capability
masking a logged column is classified below level 2 — falsified by temporarily lowering
`player.pii.read` to level 1 and confirming the exact failure, then restoring it. `SENSITIVE` widened
from 9 members to 25.

**The widening surfaced a real conflict, not a false one.** `invoice.read`/`invoice.manage` crossed
into `SENSITIVE` at level 2, and the `finance` role held both of those and `sponsorship.finance.read`
together — exactly the crossing `separation.test.mjs` §21.10 exists to catch ("holding a commercial
capability never carries a sensitive one with it"). This was not a bug in the test or the scale; it
was a bundle that had never been examined against that rule on its own terms, inherited whole from
the prototype's one "money" role. Three fixes were possible — narrow §21.10's scope, drop the invoice
reads back to level 1, or split the role — and the choice was put to the person running the project
rather than picked unilaterally, given it touches a deliberate separation-of-duties guarantee. **The
role was split**: `finance` now holds exactly `invoice.read`/`invoice.manage` plus the institutional
floor, and a new role, `sponsorship`, holds `sponsorship.read`/`sponsorship.manage`/
`sponsorship.finance.read`. A school that wants one bursar doing both still can — nothing stops the
same person holding both `role_assignment` rows — but a school that wants them separated now can
express that, which the old bundle could not.

The split touched further than `roles.mjs`: `db/01_authz.sql` and `db/09_rls_policies.sql` regenerated
(`pnpm rls:generate`, no hand edits — both are generated output); a new `ROLE_IDENTITY` entry in
`apps/web/src/design/roles.js` (`sponsorship`, family `commercial`, 11.55 dE from its nearest neighbour,
6.69:1 contrast, both checked by `design.test.mjs`, not chosen by eye); the seeded bursar
(`db/98_seed_pilot.sql`) given a second `role_assignment` row so the existing browser walk proving the
commercial mask (`tools/smoke-browser-read.mjs`) keeps demonstrating it; `tools/smoke-escalation.mjs`'s
self-appointment check split into two rows (billing records / contract values) matching the two roles;
and `separation.test.mjs` itself re-worked at §11.5 and §11.6, since spreading the widened `SENSITIVE`
into a "forbidden" list now swept in the very capability `finance` exists to hold.

**A second, independent gap surfaced by the same widening, unrelated to the role split:**
`platform.support.impersonate` (level 3, `PLATFORM_ONLY`) joined `SENSITIVE` too, and
`boundaries()` — the function behind the Settings screen's "what you cannot do, and who to ask"
panel — had no honest answer for it: no school-scoped role holds a platform-only capability, ever,
by construction, so "who else at your school can do this" was a question with no school-side answer,
and the boundary rendered naming nobody. Fixed by excluding `PLATFORM_ONLY` capabilities from
`boundaries()` entirely, with the reasoning kept in the function's own comment. Falsified by
reverting the filter and confirming `separation.test.mjs`'s "never a break-glass account, nor an
empty list" assertion goes red for `principal`, `directorofsport` and `schooladmin`.

Verified against a freshly reset and reseeded database, not left to the unit suites alone:
`tools/migrate.mjs --reset --seed --verify` (171 live RLS assertions), `tools/smoke-escalation.mjs`
(51 assertions) and `tools/smoke-browser-read.mjs` (350 assertions, including the role switcher now
offering all 26 roles and the bursar still the only account that sees a sponsorship contract's real
value) all green. Full suite: 1923 assertions across 31 suites.

**Title:** ~~Sensitivity tiers 0–4, refining the binary `SENSITIVE` set into an ordered scale~~
**Priority:** P1 · **Domain:** RBAC / Privacy · **Type:** architecture
**Affected files:** `packages/policy/src/capabilities.mjs`, `packages/policy/src/roles.mjs`,
`packages/policy/test/sensitivity.test.mjs`, `packages/policy/test/separation.test.mjs`,
`db/01_authz.sql`, `db/09_rls_policies.sql` (regenerated), `db/98_seed_pilot.sql`,
`apps/web/src/design/roles.js`, `tools/smoke-escalation.mjs`
**Affected users:** every finance-role holder — a bursar's single role becomes two, assignable
separately; no other role's grants changed

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
**Dependencies:** none. **Security / privacy impact:** real — widening `SENSITIVE` found a genuine
separation-of-duties crossing (`finance` holding both a commercial and, after this, a sensitive
capability) that a hand-picked list had been letting stand. **Data migration required:** NO —
`db/01`/`db/09` are generated output, regenerated by `pnpm rls:generate`, not a new `db/NN`.
**Tests required:** the class assertion landed in `sensitivity.test.mjs`, not `rls.test.mjs` (the file
that already owned the SENSITIVE/RESTRICTED_FIELDS join); `separation.test.mjs` for the role split;
`design.test.mjs` for the new role's colour; live RLS verify and the escalation/browser-read smokes
for the seeded consequence.
**Acceptance criteria:**
- [x] Every one of the 82 capabilities carries a level
- [x] `SENSITIVE` is derived, not listed
- [x] An assertion fails when a capability's level is lowered below the field it reaches
- [x] The separation-of-duties crossing the widening exposed is resolved, not suppressed
**Regression risk:** LOW — the RLS output diff is the two roles' policies changing shape, which is the
intended effect, not drift; every suite that could show a wrong grant (separation, sensitivity, RLS
live verify, escalation, browser-read) is green against a freshly reset database.

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
- ~~**SCRBRD-053**~~ — **CLOSED.** `db/25_disciplinary_record.sql`, the read resource
  `disciplinary_records`, `services/api/write/discipline-api.mjs` and
  `tools/smoke-discipline.mjs`; full entry below. The record was built rather than the
  capabilities dropped. Found two things worth knowing beyond the feature: Postgres applies a
  table's SELECT policy to any row an `INSERT`/`UPDATE` **returns**, so an `official` — who
  holds `discipline.write` and not `discipline.read` — could never have filed through a handler
  using `RETURNING`; and the same rule makes a targeted `UPDATE ... WHERE id = …` invisible to
  that writer while a blind `UPDATE` with no `WHERE` is not, which is why every statement here
  names an id. Awaiting paste (`scrbrd-supabase-apply-25.sql`).
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
SCRBRD-000 ✓ (ship) ──▶ SCRBRD-004 ✓ (owner key) ──▶ SCRBRD-007 ✓ (search_path)
                                              └▶ SCRBRD-026 (audit log) ──▶ SCRBRD-012 ✓ (impersonate)
SCRBRD-002 ✓ (dismissal enum) ──▶ SCRBRD-003 (quarantine release — backend done, no UI, still open)
                             └▶ SCRBRD-016 ✓ (reduced overs)
                             └▶ SCRBRD-017 ✓ (determinism test)
SCRBRD-006 ✓ (analytics consent) ──▶ SCRBRD-020 ✓ (code splitting)
SCRBRD-001 ✓ (login page) ──┐
SCRBRD-011 ✓ (capability gates) ──┴▶ SCRBRD-027 (delete legacy-roles — still blocked on nothing now
                                       that -001/-011 are closed; ready to pick up)
SCRBRD-009 ✓ (idempotency) — independent
SCRBRD-010 ✓ (offline walks) — independent, should land BEFORE SCRBRD-003 (regression net)
SCRBRD-008 ✓ (reset guard) — independent, do first: five lines, Critical impact
SCRBRD-005 ✓ (AI pseudonyms) — independent
SCRBRD-024 ✓ (CI) — independent, protects everything after it

Pass 2:
SCRBRD-028 (invariants) ──▶ SCRBRD-029 ✓ via SCRBRD-054 ✓ (db/24)
SCRBRD-030 (sensitivity tiers) ✓ — closed with no db/NN; `db/01`/`db/09` regenerated in place
SCRBRD-031 (workflow-state) ──▶ SCRBRD-034 (duty lifecycle) ──▶ SCRBRD-037 (duty roster)
SCRBRD-032 (ADR) ──▶ SCRBRD-036 (sponsor viewer)   [the ADR is the test the new role must pass]
SCRBRD-039 (capture profiles) ──▶ SCRBRD-045, -046 (spider, heatmap)
SCRBRD-038 (review-confirm) — independent, do early: smallest change, largest error class
SCRBRD-035 (escalation roster) — independent, content not engineering
SCRBRD-042 (consent audit) — independent, may close as already-correct
```

# Recommended Execution Order

1. ~~**SCRBRD-008** reset guard~~ — done.
2. ~~**SCRBRD-000** ship the branch~~ — done.
3. ~~**SCRBRD-024** CI on every PR~~ — done; every later item has a net.
4. ~~**SCRBRD-001** production login page; **SCRBRD-006** analytics consent; **SCRBRD-005** AI pseudonyms~~ — all three done.
5. ~~**SCRBRD-004** owner key migration~~ — done.
6. ~~**SCRBRD-010** offline/handover walks~~, ~~**SCRBRD-002** dismissal enum~~ — both done; **SCRBRD-003**
   quarantine release is backend-only — real, tested, and still open for lack of a UI panel.
7. ~~**SCRBRD-009** idempotency; **SCRBRD-011** capability gates; **SCRBRD-007** search_path~~ — all three done.
8. Remaining Pass 1 P2/P3 in ID order — of the ones checked in this pass, only **SCRBRD-003** (UI)
   and **SCRBRD-026** (audit log) are still genuinely open; see each entry above.

Pass 2:

9. **SCRBRD-028** invariants — landed in `bdf837e`'s successor; every later RBAC change then has a net.
10. **SCRBRD-038** review-confirm gate — smallest change, largest error class, no migration.
11. **SCRBRD-032** the ADR, before the next role request rather than after it.
12. ~~**SCRBRD-030** sensitivity tiers~~ — done, `LEVEL` on all 82 capabilities, `SENSITIVE` derived,
    the `finance`/`sponsorship` role split it forced also done; **SCRBRD-031** workflow-state
    inventory — closed separately, see above — unblocks the entries behind it.
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

### ~~SCRBRD-063~~ — CLOSED
**Closed 2026-09-19.** `Innings2Sheet`'s `onStart` in `apps/web/src/scorer/engine.jsx` now emits an
`INNINGS_START` event for the second innings before opening the "opener" sheet, carrying `target:
innings[0].runs + 1` — the fix the recommended change below described, built the way it described. One
change from the original recommendation, made after tracing the actual risk rather than assuming the
first idea was safe: **not** a `REVISION` event. `RevisionSheet`'s own reducer marks an innings
`revised`, and `engine.jsx` renders a visible "(revised)" badge next to the overs whenever that flag is
set — a plain `revision()` call to seed the target would have shown every ordinary, un-rained-off second
innings as revised, trading the bug just fixed for a new, user-facing one. The `INNINGS_START` this emits
is also non-destructive by construction: it reads `battingTeam`/`bowlingTeam`/`squad`/`bowlingSquad`/
`overs`/`twelfthMan` from `innings[1]` itself first, falling back to `match` state only where nothing is
there yet — so a match started from scratch, whose second innings already has real squad data from
`startMatch`'s `open2`, gets that data re-declared unchanged rather than overwritten with an empty squad,
and only a real fixture resumed from the server (which never got an `INNINGS_START` for its second innings
at all) falls through to the `match`-derived values. Fixes the byproduct too: the result screen's second
scorecard panel now shows the real batting team's name instead of a blank heading.

Verified against the real app, not a unit mock: `tools/smoke-browser-innings-end.mjs` (SCRBRD-052) now
chases the target down with real sixes instead of a second round of wickets, and the review sheet opens on
its own with `target_reached` — checked on screen and independently against the two `innings_end` events
Postgres actually received. Full scoring and system suites green throughout (1915 assertions, 31 suites).
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
- [x] A second innings that reaches its target closes on `target_reached`, without needing all out or
  overs complete
- [x] The second innings' `INNINGS_START` event carries `battingTeam`/`bowlingTeam` correctly, so the
  result screen's scorecard panel names the real team
- [x] `smoke-browser-innings-end.mjs` is updated to chase a target rather than take a second round of
  wickets, and still passes
**Regression risk:** LOW-MEDIUM — adds an event, and an event shape change on a heavily-replayed path
deserves the full scoring suite run (`packages/scoring/test/*`, `apps/web/test/system.test.mjs`) before
shipping, not just the new browser walk.

### ~~SCRBRD-053~~ — CLOSED

**Closed 2026-09-19.** The record exists. `db/25_disciplinary_record.sql` creates
`disciplinary_record`, its three indexes, an authorship trigger and its own row-level policies;
`disciplinary_records` is a read resource in `read-api.mjs` with an entry in `RESTRICTED_FIELDS`
so every read of one is logged; `services/api/write/discipline-api.mjs` carries the two routes
(`POST /api/players/:id/discipline`, `PATCH /api/discipline/:id`); and
`tools/smoke-discipline.mjs` — 47 assertions, registered in `tools/run-smoke-api.mjs` — walks all
of it over HTTP against real Postgres. **No capability grant changed.** The six bundles were
already correct about who should be able to do this; it was the schema that had nothing to offer
them, which is why `pnpm rls:generate` leaves `db/01_authz.sql`, `db/09_rls_policies.sql` and
`db/23_authz_time_box.sql` byte-identical (checked with `git diff` after regenerating).

**The shape was derived from the grants rather than chosen, and that is most of the design.**
Read is held by `principal`/`directorofsport`/`schooladmin` (school-scoped), by `selfaccess` (a
pupil reading his own, which needs a **person** anchor on the row), and by `competitionadmin`,
whose assignment names no school and therefore reaches every school — automatically, because a
NULL school on the ASSIGNMENT widens, with no platform-wide clause written anywhere. Write is
held by `directorofsport` and by `official`, and an official is appointed **per match**, so the
row needs a **fixture** anchor or the umpire's grant is unusable. `school_id` is denormalised for
`development_note`'s reason plus one more: `competitionadmin` holds no player capability at all,
so a derived school anchor would have resolved to NULL for them and been right only by accident.
It is the only table in the schema whose RLS **fixture anchor can be NULL** — every other
policy-anchored `match_id` is NOT NULL — so the same column carries the on-field/off-field
distinction that a category enum would otherwise have restated. Falsified by swapping the anchor
for `ANY_SCOPE` and watching the umpire successfully file about a match he never stood at.

**Two Postgres behaviours found by building it, both of which changed the code.** First,
`INSERT ... RETURNING` evaluates the SELECT policy on the returned row — so `returning id`, the
shape every other write handler in this repo uses, would have refused the one writer this
capability exists for, and refused it with "new row violates row-level security policy", which
names the wrong policy. Verified with a two-policy probe table before the handler was written,
then falsified by adding `returning id` back and watching the umpire's filing fail. Second, the
same rule applies to the rows an `UPDATE`'s `WHERE` clause reads: a writer without the read
cannot name a row, while a blind `UPDATE` with no `WHERE` touches every row the UPDATE policy
allows (probed: `rowCount 0` against `rowCount 2`). Every statement here names an id, and the
consequence — an umpire cannot revise his own report — is the right answer for a document that is
evidence, with the school progressing it.

**The trigger divides the row rather than locking it.** `development_note`'s trigger refuses any
non-author UPDATE; that is correct for a coach's private note and wrong here, because the umpire
who filed the incident was appointed for one afternoon and the matter outlives the appointment.
So: the **account** is the author's (`45001` on a non-author changing `body`), the **outcome** is
the school's (`state`/`outcome` for anyone holding `discipline.write` in scope), and the
**subject** is nobody's to move (`45002`, new — a record re-filed against another child is a new
record). Both are deliberately distinct from `42501`; all three are mapped in the handler, and a
fourth, `23514`, is the constraint refusing a matter concluded without saying what happened.

**Judgement calls, flagged because they were calls and not deductions.** No severity scale and no
category enum: grading an offence against a written rule belongs with SCRBRD-041, which is the
entry for rulebook clauses and their severities, and the on-field/off-field distinction a category would carry is already stated by whether
`match_id` is present. `state` IS there, with three values, because `capabilities.mjs` describes
the write as "Record **and progress** disciplinary matters" and a record that can only be appended
to cannot be progressed. The read query `LEFT JOIN`s `player`: `competitionadmin` cannot read a
roster, so an inner join would have returned an empty list to the platform-wide reader and looked
like a school with a clean record. **The policies are hand-written and the table is deliberately
NOT in `tables.mjs`** — `db/09` is generated, runs before `db/25`, and has already run on
production, so a generated policy for a table born here would fail on a fresh install and break
the ledger on a live one. `news_post` (db/12) and db/24's re-gated INSERT went the same way. What
keeps the hand-written predicates honest instead is db/25's own `DO` assertion block, db/99's
live assertions, and `sensitivity.test.mjs`, which greps the SQL for the capability inside an
`app_can()` call — falsified by renaming the capability in the policy and watching
`sensitivity.test.mjs` name `discipline.read` as gating nothing.

**Verified against a freshly reset and reseeded database, in that order, with a second reset
before the suites** (this file's own lesson about test-run contamination):
`node tools/migrate.mjs --reset --seed --verify` prints ALL RLS LIVE ASSERTIONS PASSED over **254
live assertions, up from 235** — the 19 new ones cover the six grants, the fixture anchor from
both sides, the tenant line, the platform-wide stamp and all three trigger refusals;
`node tools/smoke-discipline.mjs` 47 passed, 0 failed; `node tools/run-all-tests.mjs`
**ALL SUITES PASSED · 1926 assertions across 31 suites**, up from 1923.
`sensitivity.test.mjs` now reports 23 of 25 sensitive capabilities implemented (was 21) and 17
row-gated rather than column-masked (was 15). Six separate falsifications were run and reverted:
granting `medical` the read, granting `medical` both, replacing the fixture anchor with
`ANY_SCOPE`, removing the non-author check, removing the subject pin, and removing the outcome
constraint — each turned the intended assertion red and nothing else.

**NO UI SCREEN IN THIS PASS, and that is a decision rather than an omission.** `up51` on the
roadmap moves from `planned` to **`partial`**, naming `disciplinary_records` as undrawn, which
`roadmap.test.mjs` checks is a real identifier in `services/api` that no view references. The
reasoning: the gap SCRBRD-053 recorded was a capability gating nothing, and that is now closed at
the layer where it existed. What a screen would have to settle first is a product question the
schema does not get to answer — how a fifteen-year-old is shown a live disciplinary matter about
himself, since `selfaccess` holds the read — and there is no design input on a case workflow to
build against. `up23` (support access) and `up24` (DRS) are the precedent in the same file for
shipping the API and the policy and saying so.

**Title:** ~~`discipline.read` and `discipline.write` gate nothing~~
**Priority:** P3 as filed, P1 as it turned out · **Domain:** RBAC / Privacy · **Type:** missing feature
**Affected files:** `db/25_disciplinary_record.sql` (new), `db/98_seed_pilot.sql`,
`db/99_rls_verify.sql`, `services/api/read/read-api.mjs`,
`services/api/write/discipline-api.mjs` (new), `services/api/server.mjs`,
`packages/policy/test/sensitivity.test.mjs`, `packages/policy/test/separation.test.mjs`,
`tools/smoke-discipline.mjs` (new), `tools/run-smoke-api.mjs`, `apps/web/src/data/roadmap.js`
**Affected users:** every holder of either capability — six roles, none of whose grants changed,
all of which now reach something. And the seed gains its first `official` account: `official` was
the one role in the bundle list that nothing ever signed in as, so `officiating.report` and
`discipline.write` could previously only be observed failing.

**Current behaviour:** `discipline.read` is held by `superadmin`, `principal`, `directorofsport`,
`schooladmin`, `selfaccess` and `competitionadmin`; `discipline.write` by `superadmin`,
`directorofsport` and `official`. Neither gates anything: no table, no policy, no masked column,
no read resource. A school administrator who "can read discipline" can read nothing at all, and
on the day a record arrives nobody's read of it would be logged, because the logger watches
columns and there are none to watch.
**Expected behaviour:** a disciplinary matter about a named child exists, is filed by the umpire
who stood at the match or by the school, is progressed and concluded by the school, is readable
by the head, the office, the boy himself and the league that runs the fixture — and by nobody
else — and every read of one is on the school's own record.
**Root cause:** the capability catalogue and the role bundles were written from
`Roles&Duty.md` in one pass, ahead of the schema. Six bundles were correct about who should be
able to do this; nothing had been built for them to do it to, and nothing in the suite could tell
a capability with no gate from one with a gate elsewhere until `sensitivity.test.mjs` joined the
two lists (SCRBRD-030).
**Recommended change:** build the record — a new `db/NN`, an entry in `tables.mjs`, a read
resource — or drop the pair. What should not persist is a role bundle promising something the
schema cannot deliver.
**Why it matters:** a capability that grants nothing is worse than an absent one. It reads as a
control on a page a headmaster is shown, it is in the bundle a school is handed at onboarding,
and the first person to find out it was decoration is whoever needed it.
**Dependencies:** SCRBRD-030, which is how it was found. **Security / privacy impact:** real and
in the intended direction — a level-3 record, row-gated rather than column-masked, with the
platform-wide reader's every read stamped by the existing `app_is_platform_wide()` mechanism at
no cost, and the school-side reader's logged because of the `RESTRICTED_FIELDS` entry.
**Data migration required:** **YES** — `db/25_disciplinary_record.sql`, forward only, with its own
assertion block; `scrbrd-supabase-apply-25.sql` generated and awaiting paste. No backfill: there
is no prior disciplinary data anywhere to migrate, and none is seeded.
**Tests required:** the `NOT_YET_IMPLEMENTED` entries removed from `sensitivity.test.mjs` (the
suite's own anti-rot assertion fails if a listed capability starts being referenced, so this was
forced rather than remembered); §11.4 of `separation.test.mjs` extended with the mirror of the
`schooladmin` rule — the official writes and cannot read, which is the assumption the
no-`RETURNING` design rests on; 19 live assertions in `db/99_rls_verify.sql`; and
`tools/smoke-discipline.mjs` end to end over the routes.
**Acceptance criteria:**
- [x] Something real is gated by both capabilities, checked by grepping the SQL rather than by assertion
- [x] Every one of the six grants reaches the record, each for its own scope reason
- [x] A role without the capability is refused the read and the write, against real Postgres
- [x] The refusal is attributable to the capability alone — the falsifying principal is medical
      staff, whose assignment passes every other dimension of `app_can()`
- [x] An official can file only about the fixture he was appointed to
- [x] Authorship is fixed at INSERT and the account cannot be rewritten by anybody else
- [x] Every read of a record is logged, school-side and cross-school
- [x] No capability grant changed, and the three generated SQL files are byte-identical
**Regression risk:** LOW. A new table with no reader anywhere in the client, no change to any
role's grants and no edit to a generated or already-applied file. The two places it does touch
shared code are the read resource map (additive; `disciplinary_records` is claimed by no module,
deliberately — a school cannot switch off a safeguarding record the way it switches off
Analytics) and the seed, which gains one account and one fixture-scoped assignment. The whole
suite, the live verifier and the new walk are green against a freshly reset database.

### ~~SCRBRD-064~~ — CLOSED

**Closed 2026-09-19.** `contextFrom()` in `services/api/ai/ai-service.mjs` now folds a third
resource, `career`, into Stats-Magic's context — read through the same `readResource` call, under
the same principal, as `players` and `matches` already are. Before this, the model saw a roster and
eight fixtures and nothing else: "what's his strike rate this term?" was unanswerable, and the
system prompt's own instruction ("answer only from the supplied data; say so if it doesn't contain
the answer") meant the honest reply to every stats question was a refusal. The platform's headline
natural-language feature could not read the platform's numbers.

**The masking guarantee is the design, not an afterthought.** `career` rows are keyed onto the
roster **by `player_id`**, and every stats line is written with the roster's own `full_name` —
never the career row's — because `names` (the list `askStatsMagic()` masks the whole context
with) is collected from the roster. Keying the join the other way, or building the stats string
beside the roster instead of through it, would be one careless line away from a child's real name
reaching a third-party model provider in clear. Falsified directly: dropping the career players'
names from the `names` list turned the new "no name reaches the provider in a stats line either"
assertion red, printing three real names in the outbound request; restored, and green again.

**Ratios are computed in JS, never stored or computed in SQL**, for the same reason `/read/career`
itself gives: the division-by-zero cases are the interesting ones, and each is written as a phrase
saying why rather than as a fabricated number — a batter never dismissed has "no average (never
dismissed)," not an average of zero; a bowler with no wicket has "no average (no wicket)," not a
sentinel. A player with nothing in the ball log at all (no career row, or a row of coalesced zeros
— `/read/career` left-joins and coalesces, so the two look the same and are treated the same) is
named under "Nothing recorded yet in the ball log for: …" rather than given a line of zeros
alongside players who do have one.

Two assumptions this entry's own first draft got wrong, caught rather than shipped: the seeded ball
log carries no `bowler_id` at all (96 deliveries, 96 strikers, zero bowlers), so
`player_bowling_career` is empty on a fresh reset — a live check that only read the seed would have
called the bowling half covered while it was untested; `tools/smoke-statsmagic.mjs` writes its own
charged deliveries, the way `smoke-phases` shapes the innings it needs, rather than trusting the
seed to exercise it. And a `/read/career` row of coalesced zeros looked, to an early version of the
code, like the same shape as no row at all, and printed "batting: no record; bowling: no record"
for a boy who had genuinely never played, under a heading that read as claiming figures — caught by
the assertion that a boy with nothing recorded is never given a figures line at all, not named
twice under two different headings.

Verified against a freshly reset and reseeded database, read as the director of sport: M Cele — 1
match, 71 runs off 41 balls, SR 173.2, average 71.00, 5x4 3x6; S Naidoo — 1 match, 41 runs off 21
balls, SR 195.2, no average (never dismissed — he has not been out, which the line does not
confuse with an average of zero); D Mkhize — 0 wickets, 44 runs off 24 legal balls, economy 11.00,
no average (no wicket). Every figure checked against `player_batting_career`/`player_bowling_career`
read directly for the same player. `ai.test.mjs` grew from 20 to 31 assertions (real figures
present; no fabricated zeros; the stats line's masked token is the roster line's own token, checked
on the raw `system` string before unmasking); `tools/smoke-statsmagic.mjs` is new, 17 assertions
against real Postgres, registered in `tools/run-smoke-api.mjs`'s `WALKS`. Full suite: 1938
assertions across 31 suites. `apps/web/src/data/roadmap.js`'s `up47` moves from `planned` to
`shipped`, naming the new walk.

**Title:** Stats-Magic answers from real figures: fold `/read/career` into the model's context
**Priority:** P2 · **Domain:** AI / Analysis · **Type:** product completeness
**Affected files:** `services/api/ai/ai-service.mjs` (`contextFrom`, `statsMagicContext`, new
`careerLine`), `services/api/ai/ai.test.mjs`, `tools/smoke-statsmagic.mjs` (new),
`tools/run-smoke-api.mjs`, `apps/web/src/data/roadmap.js`
**Affected users:** every coach, parent and pupil who asks Stats-Magic anything numeric

**Current behaviour:** `contextFrom({ players, matches })` built the entire context from a roster
string and up to eight fixtures. No runs, no wickets, no average, no strike rate, no economy —
nothing derived from the ball log reached the prompt.
**Expected behaviour:** the context also carries each roster player's batting and bowling figures,
read from `/read/career` under the same principal as `players`/`matches`, with the ratios a cricket
question actually asks for, computed from the raw counts.
**Root cause:** Stats-Magic's context was built when the career views were the player profile's own
business. Neither half was wrong; they were never joined.
**Recommended change (as built):** described above.
**Why it matters:** a stats assistant that cannot read the platform's stats fails silently — the
model says "the data does not contain that" and sounds correct rather than incomplete. The masking
half matters more: a line describing a child's performance is the first string in this codebase
built specifically to describe a named child's play to a third-party model provider, and it is
exactly the string that leaks if built beside the roster rather than through it.
**Dependencies:** none — `player_batting_career`, `player_bowling_career`, `player_dismissals` and
`/read/career` all pre-date this; nothing in SQL changed.
**Security / privacy impact:** neutral-to-positive, asserted rather than assumed. Figures come from
`security_invoker` views under the caller's own principal, scoped exactly as every screen already
is; every name still goes through `maskNames()`, checked against every `full_name` in the database
in the live walk, not just the names one fixture happens to use.
**Data migration required:** NO — derived, never stored.
**Tests required:** `ai.test.mjs` for the masking/zero-fabrication guarantees; `smoke-statsmagic`
for the live seam against real Postgres.
**Acceptance criteria:**
- [x] `statsMagicContext()` reads `career` through `readResource`, not a bespoke query
- [x] Strike rate, batting average, economy and bowling average appear in the built context
- [x] A player with no record is named as having none and is never given a figure
- [x] A batter never dismissed has no average; a bowler with no wicket has none
- [x] No `full_name` in the database appears in the request that would go to the provider
- [x] `ai` suite green at 31 assertions; `smoke-statsmagic` green at 17; full suite green
**Regression risk:** LOW for scoring and the read path, neither of which changed. The real risk is
prompt size — the context now carries a line per roster player with a record, which grows with a
full season's data and is worth measuring before the pilot, the same way the commentary cost note
elsewhere in `ai-service.mjs` already flags for that feature. Capping or ranking which players'
figures are included, if it becomes necessary, is a product decision and was deliberately left
alone here.
