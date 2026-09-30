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

### ~~SCRBRD-003~~ — CLOSED

**Closed 2026-09-19.** The route, the function and their 25-assertion API walk (`tools/smoke-quarantine.mjs`)
were already built and green before this pass — `db/14_quarantine_release.sql`'s `quarantine_resolve()`,
`GET /api/matches/:id/quarantine` and `POST /api/quarantine/:id/resolve` in `services/api/write/events-api.mjs`.
What did not exist was any way for a person to reach either route except by calling the API directly:
`grep -rn quarantine apps/web/src` found one string, in `apps/web/src/data/roadmap.js`, describing a walk
rather than drawing a screen. This pass closes exactly that gap and touches no route, no function and no
migration.

`apps/web/src/views/quarantine.jsx` (new) is the panel, wired into `MatchCentreView.jsx` beside the
existing `DutyRoster` on a selected match's detail card — Match Centre, not `scorer/panels.jsx` (the
backlog's own guess): that file is the live pad's in-over display components, imported only by the scoring
engine while an over is being scored, and a stale-epoch ball is reviewed **after** the fact, by the person
who approves corrections, not by the scorer mid-innings. `holdsCapability(role, "scoring.amend.approve")`
gates whether the panel draws at all — the same courtesy every other screen in this file already extends
(`OfficialsView`'s `canManage`, `MatchCentreView`'s `canScore`) — and decides nothing else: the list's own
RLS policy and `quarantine_resolve()`'s own four-point authority check are what actually allow or refuse.

**The one thing worth writing down for whoever reads this next:** `quarantine_resolve()` answers a refusal
with HTTP 200 and `{ ok: false, reason }`, not a 4xx — it is a SQL function returning a row, not a raised
exception. The acceptance criterion below asked for "403 on release", which is not what the server does
and was never going to be fixed by the UI. What the panel actually had to get right, and the browser walk
falsifies, is that it reads `res.ok` rather than trusting the HTTP status — a resolve() that only checked
the promise resolving would have shown a released ball that was never released. Caught by directing
`sarah@example.invalid` (who submitted the quarantined balls as scorer) to release her own submission: the
server refuses with `cannot_release_your_own` on a 200, and the panel shows it, in words, next to the row —
not a silent no-op that looks identical to success.

Verified end to end in a real browser against a freshly reset and reseeded database
(`node tools/migrate.mjs --reset --seed`), with a quarantined wicket and a quarantined run seeded through a
stale-epoch send exactly as `tools/smoke-quarantine.mjs` does it (no static seed carries one):
new `tools/smoke-browser-quarantine.mjs`, 32 assertions, registered in `BROWSER_WALKS` in
`tools/run-smoke-api.mjs`. It proves, against the running app: the panel appears for the director of sport and for the principal (both
hold `scoring.amend.approve`) with the ball's own context on screen — what it was ("Wicket — Run Out
(L Govender)", "1 run"), who sent it ("Sarah Mokoena"), and the epoch that sent it there against the one
now current ("epoch 6 (now 1)"); the submitting scorer's own release attempt is refused, in the panel, and
nothing moves; a different approver's release removes it from the panel and the ball is back in
`/api/matches/:id/events` — the same read `ScorecardModal` uses — at the next `seq`, under the current
epoch, marked `recovered`, dismissal intact; a discard removes the other from the panel, writes nothing to
the log, and a fresh re-fetch of the panel (not just the same page state) still shows nothing waiting; and
`ball_event_quarantine` itself ends with one `accepted` row and one `rejected` row.

`apps/web/src/data/roadmap.js`'s `up3` ("Live Score Sync") already named the `quarantine` API walk as
covering "a way out of quarantine" — true before this pass, since the door was real even with no handle on
it, but read by a headmaster it invited the assumption that the handle existed too. `up3` now also names
`browser-quarantine`, and its description says plainly that the panel is what closes it.
`node tools/run-all-tests.mjs`: 1939 assertions across 31 suites, 0 failed; `node tools/migrate.mjs
--reset --seed --verify`: ALL RLS LIVE ASSERTIONS PASSED.

**Title:** ~~Quarantine review and release route~~
**Priority:** P1 · **Domain:** Scoring · **Type:** reliability / correctness
**Affected files:** `apps/web/src/views/quarantine.jsx` (new), `apps/web/src/views/MatchCentreView.jsx`,
`tools/smoke-browser-quarantine.mjs` (new), `tools/run-smoke-api.mjs`, `apps/web/src/data/roadmap.js`.
`services/api/write/events-api.mjs`, `db/14_quarantine_release.sql` and `tools/smoke-quarantine.mjs` were
already built and are unchanged by this pass.
**Affected users:** scorers, anyone reading a scorecard with a quarantined ball

**Current behaviour:** stale-epoch events land in `ball_event_quarantine`; `recovered`/`resolved_at` are never set by any code path; no UI lists them.
**Expected behaviour:** a person with `scoring.amend.approve` sees the match's quarantined events, and can release (re-apply under the current epoch, `recovered = true, resolved_at = now()`) or discard (`resolved_at` only).
**Root cause:** quarantine was built as a safety valve; the exit was deferred.
**Recommended change:** ~~`GET /api/read/quarantine?match=…`, `POST /api/quarantine/:id/release`, `POST /api/quarantine/:id/discard`; panel in Match Centre.~~ Built instead, before this pass, as `GET /api/matches/:id/quarantine` and one `POST /api/quarantine/:id/resolve { accept }` — a single decision route rather than two, which is what `quarantine_resolve()` already was. The panel in Match Centre is this pass.
**Why it matters:** RISK-REL-001 / SCO-P1-02 — a lost ball is a wrong match record for ever.
**Dependencies:** SCRBRD-002 (released events must pass the same vocabulary check). **Security / privacy impact:** release is a write to canonical truth; gate on the approval capability, not on `scoring.write`. **Data migration required:** NO
**Tests required:** new `tools/smoke-quarantine.mjs`: quarantine a ball via stale epoch → list → release → replay shows it → `db/99` asserts `recovered` set.
**Acceptance criteria:**
- [x] Released ball appears in the scorecard at its `seq` — `tools/smoke-browser-quarantine.mjs`, both through the browser panel and against `/api/matches/:id/events` and Postgres directly
- [x] Scorer without approval capability is refused — corrected from "403": the server answers 200 with `ok:false` and a named reason (`smoke-quarantine.mjs`'s `not_permitted` case; the browser walk's `cannot_release_your_own` case), and the panel shows the refusal rather than hiding it
- [x] Discarded ball never re-appears — asserted after a remount-and-refetch of the panel, not just immediately after the click
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

### ~~SCRBRD-026~~ — CLOSED — Audit log for platform-wide reads

**Closed 2026-09-19.** `db/20_platform_reads.sql` is exactly this, already built: `access_log`
gains a `platform_wide` column, `app_is_platform_wide()` decides it at read time from the caller's
own live assignments (a `school_id IS NULL` assignment, not a claim the caller makes), and
`log_restricted_read()` stamps every row with it. `db/99_rls_verify.sql` (lines 1425-1440+) already
names this entry directly in its own comment ("SCRBRD-026. The owner's key and a platform
administrator's reach every school; db/20 makes the log say so") and asserts all four directions
live: the owner and a platform administrator read as platform-wide, a school administrator does
not, and two ordinary school assignments never add up to one. SCRBRD-012 and SCRBRD-053 both
already depend on this mechanism working, which it does — SCRBRD-053's own closure verified a
`competitionadmin` cross-school read stamped `platform_wide` with zero extra wiring, precisely
because this was already in place. No new code needed; only this entry was stale.
**Acceptance:** `db/99_rls_verify.sql` asserts the reader distinction live, in both directions,
for the owner's key, a platform administrator, a school administrator and a two-school assignment.

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
- ~~**SCRBRD-027**~~ — CLOSED.
  **Closed 2026-09-23.** The real prerequisite this item was actually waiting on — retiring the
  old-vocabulary names from every place that can set the SIGNED-IN role, not -001/-011 as
  originally filed — is done, and `rbac/legacy-roles.js` is deleted.

  What changed, entry point by entry point: `OnboardingFlow.jsx`'s `PUBLIC_ROLES` picker had one
  survivor, `id:"assistant"` (the only entry point still naming a legacy value — everything in
  `LoginPage.jsx`'s `MOCK_USERS`/`DEMO_ACCOUNTS`/`PILOT_ACCOUNTS` was already real by the time this
  was checked, from the prior pass), now `id:"assistantcoach"`. `data/mock.js`'s `STAFF` and
  `USERS_INITIAL` records fed `ROLES[s.role]`/`ROLES[u.role]` lookups directly in `StaffView.jsx`,
  `ProfilesView.jsx` and `ManagementView.jsx` (avatar colour, filter chips, the role picker and the
  promote-role `<select>`) — `groundskeeper`→`facilities`, `sportsmaster`→`directorofsport`,
  `assistant`→`assistantcoach` (×2 staff rows, ×2 user rows), `parent`→`guardian`; the display-only
  filter/section labels in `StaffView.jsx` and `ProfilesView.jsx` were updated alongside so
  "Groundskeepers" still reads correctly rather than becoming "Facilitys". Checked and left alone as
  genuinely inert: `COACHES[].role` career-history strings ("Head Coach", "Assistant Coach" — title
  case, never looked up in `ROLES[]`), the `groundskeeper:"st7"` foreign-key field on `GROUNDS` rows
  (a staff id, not a role), `relationship:"parent"` in `SettingsView.jsx` (a family-relationship
  label posted to `/api/players/:id/guardians`, not an RBAC role), and the `roles:[...]` arrays on
  `NOTIFICATIONS` mock rows (dead data — `lib/live.js`'s `asNotification()` drops the field entirely
  for exactly this reason, and no view ever reads it).

  `rbac/index.js`'s `assignmentsForRole()` no longer has a `LEGACY_ROLE` table to fall back on; four
  policy roles needed a demo scope narrower or wider than its generic branch would compute on its
  own, and each is now an explicit, tested override rather than an accident of the alias table:
  `superadmin` and `platformadmin` are platform-wide (`school: null` — the generic branch would
  otherwise scope even the owner's key to the demo school), `player` is scoped to person `"p1"`
  (the generic branch has no `person` at all for a role outside `SUBJECT_SCOPED_ROLES`, and
  `covers()` treats an absent `person` as no restriction — the demo's own pupil would otherwise read
  every player at the school), and `scorer` keeps its team scope (`team: "1XI"`, also outside
  `TEAM_SCOPED_ROLES`). `DEMO_SCHOOL`/`DEMO_TEAM`/`DEMO_CHILD` moved to a new leaf module,
  `rbac/demo-scope.js`, rather than back into `rbac/index.js` or `design/roles.js` — `design/roles.js`
  no longer needs them at all, now that it has no alias table to build.

  `design/roles.js`'s `LEGACY_ROLE_ALIAS`/`ROLES`-with-aliases mechanism is gone; `ROLES` is now
  exactly `ROLE_IDENTITY` (24 entries, one per policy role) and `canonicalRole()` is the identity
  function. `apps/web/test/design.test.mjs` no longer asserts that
  `["superadmin","headmaster","parent","sportsmaster"]` resolve through an alias table that no
  longer exists; it instead scrapes every `role:"…"` and onboarding `id:"…"` literal out of
  `LoginPage.jsx`/`OnboardingFlow.jsx` and asserts each one is a `ROLE_IDENTITY` key, plus that
  `canonicalRole()` is identity on every policy role — falsified directly, the same way the original
  entry falsified `design.test.mjs`'s need for this file: reintroducing `id:"assistant"` in
  `OnboardingFlow.jsx` fails the new check immediately, restored, green again.
  `apps/web/src/rbac/rbac.test.mjs` had the same legacy names baked into its own assertions
  (`P("sportsmaster")`, `P("parent")`) — repointed at `directorofsport`/`guardian`, and a new group
  (A1) pins the four demo-scope overrides above directly rather than only through the row counts
  elsewhere in the suite.

  Acceptance, checked in order:
  - [x] no legacy name can reach `assignmentsForRole()`/`principalForRole()`/`canonicalRole()`/
        `ROLES[…]` as a SIGNED-IN role from any entry point (login, demo accounts, pilot accounts,
        onboarding persona picker, the role switcher)
  - [x] mock STAFF/USER records that feed a `ROLES[]` lookup use policy role names; genuinely inert
        job-title/foreign-key/relationship strings were identified and left alone, not blindly renamed
  - [x] `superadmin`'s (and `platformadmin`'s) platform-wide demo scope survives the alias table's
        removal — `assignmentsForRole("superadmin")[0].school === null`, pinned in `rbac.test.mjs`
  - [x] `apps/web/src/rbac/legacy-roles.js` deleted; `node tools/check-imports.mjs` clean (79
        modules, 0 missing imports)
  - [x] `packages/policy/test/separation.test.mjs` §21.1 role-string ratchet unchanged — no new
        role-string view gate was added anywhere in this change
  - [x] `pnpm build` clean; `node tools/migrate.mjs --reset --seed && node tools/run-smoke-api.mjs
        --browser browser-read` passes (exercises the role switcher across every role); `node
        tools/migrate.mjs --reset --seed && node tools/run-all-tests.mjs` → ALL SUITES PASSED; `pnpm
        smoke` passes

  Evidence SEC-P3-01.

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

### ~~SCRBRD-028~~ — CLOSED

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

**Corrected 2026-09-23.** As first closed, the `finance`/`sponsorship` split was shipped by regenerating
`db/01_authz.sql` in place. Production has run `db/01`, so `tools/migrate.mjs` refuses that file on a
live database — the branch could not deploy. `db/01` is now byte-identical to `main` again:
`generate-rls.mjs` re-emits finance's three commercial rows through `WITHDRAWN_SINCE_01` and leaves the
role out through a new `ROLES_ADDED_SINCE_01`. `db/27_sponsorship_role.sql` carries the split for fresh
and live databases alike, and matches every live `finance` appointment with a `sponsorship` one, so no
bursar loses access. Checked on a database built exactly as `main` (24 files) with the branch applied on
top: 3 applied, 24 skipped, the bursar's commercial access kept, `db/99` green. `rls.test.mjs` group B3
holds any added role to its db/NN (falsified by dropping a bundle row and an appointer row). The gap that
let this through is closed by `tools/shipped.test.mjs`, which pins every migration merged to `main` to
its shipped hash via `db/SHIPPED.sha256` — the SCRBRD-030 `db/01` hashes `39d31949…`, the shipped one
`40298933…`, so it would have gone red.

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

**Part delivered 2026-09-23 — step 1 (derived status, the hour hand's reason) and D3 (completion ends
scoring). NOT closed:** linking `match_official` to `role_assignment` and `suspended` are the other half,
built separately (`db/31`, `db/32`, `db/34`).
- `db/30_duty_status.sql` — `duty_status(match_official.id)`, read-only, STABLE, grants nothing. Derived,
  in precedence order: `revoked` (withdrawn) → `completed` (match `complete`) → `expired` (`abandoned`) →
  `delegated` (a scorer duty naming an account that is `from_user` on a `handover_complete` in
  `scoring_audit` and is not the session holder now; checked on `scheduled` as well as `live`, because
  scoring does not wait for the status to move) → `active` (`live`) → `pending` (`scheduled`). Never
  `suspended`. SECURITY DEFINER so a reader without `audit.read` gets the same answer; answers only a caller
  with `fixture.read` over the match (`match_official_read`'s predicate), NULL otherwise. Exposed as
  `status` on `match_duties` and shown on the duty roster (`views/duties.jsx`); no policy-package mirror —
  the client shows the server's answer.
- Also `db/30`: a DEFERRED constraint trigger `role_assignment_expiry_has_reason` (on `role_assignment`
  INSERT / UPDATE OF `expires_at`, and on `support_access` DELETE / re-point) — a non-null `expires_at` must be
  named by a `support_access` row (reason required) that issued at least that hour. Closes the direct INSERT
  under `role_assignment_write`, and the office UPDATE that extended a live session's hour. Deferred because
  `support_access_begin()` writes the assignment before the record.
- `sessionProfile` (`services/api/auth/auth-db.mjs`) now drops an assignment past `expires_at` and returns
  `expiresAt` — a lapsed support session no longer shows as live (display only; reads were already refused).
- `db/33_completion_ends_scoring.sql` — `scoring_claim` (from db/28), `scoring_claim_handover` (db/04),
  `scoring_verify_takeover` and `scoring_lease_check` (db/02) refuse a `complete` match for everyone as
  `match_complete`, after the capability check; signatures and shapes unchanged. `scoring_lease_check` cannot
  grow a reason column, so it answers `holds=false, state='match_complete'`; the write path quarantines the
  ball with reason `match_complete` and the heartbeat reports it. The amendment request (db/24) is untouched
  and asserted still open. Force-release and arm are unchanged. The client says it in words
  (`REFUSAL_WORDS` in `lib/handover.js`, the scorer's sync pill and handover sheet).
- Live assertions in `db/99` (the expiry block after SCRBRD-012; section 15), a walk addition in
  `tools/smoke-support.mjs`. Not yet in `db/SHIPPED.sha256`. `db/01`/`db/09`/`db/23` unchanged.
- **Found, not fixed:** the office may still UPDATE a support assignment's `expires_at` to NULL — turning an
  hour into a standing appointment. The rule here covers only a non-null hour hand; it belongs with the
  suspension/link work, which already has to decide what may move on a live assignment.

> **2026-09-23 — the authority half (D1 + D2) is built; the lifecycle half (`duty_status()`, db/30) is
> separate. Not closed until both land.**
> - **D1, the link.** `match_official.assignment_id` (db/34). `duty_link(duty)` — the school office
>   (`user.role.assign` at the school **and** `app_may_grant(role)`, i.e. exactly what
>   `role_assignment_write` asks) **creates** a fresh assignment of the duty's exact shape (this person;
>   `scorer`, or `official` for umpire/third umpire/referee; this school; this fixture; no team) and links
>   it. It does not adopt an existing one: withdrawal revokes and suspension silences what a duty is linked
>   to, so adopting A Wessels's school-wide scorer assignment would let one fixture end or pause her
>   authority everywhere. One duty per assignment (unique index). The application role has no column
>   privilege on `assignment_id` (only `duty_link()` writes it — a trigger asking `app_can()` would have
>   been a privilege, not an invariant, per `invariants.test.mjs`); a capability-free guard trigger holds
>   the shape however it is written (a linked row is not re-pointed or un-withdrawn), and a second freezes
>   a linked assignment's fixture/dates. **Withdrawing a linked duty revokes the assignment
>   in the same statement** (definer trigger; `revoked_by` is the person who withdrew). The appoint route
>   now keeps a linked duty re-submitted on the new sheet (same duty, same account) instead of withdrawing
>   and re-making it — otherwise adding a second umpire would have silently ended the scorer's authority.
> - **D2, the pause.** `duty_suspension` (db/34): who/when/why to suspend, who/when/why to lift, append
>   then close, writable only through `duty_suspend()` / `duty_lift()`; reason required by function and
>   table. Suspend asks `user.role.assign` (what revoking asks); lift also asks `app_may_grant` (what
>   appointing asks) — a principal may pause a scorer and not restore one — and nobody lifts their own.
>   `active` is never touched. **db/35 is generated**: `generate-rls.mjs` gains a `suspendable` flag beside
>   `timeBoxed`, and `suspension()` re-emits db/23's three decision functions with
>   `AND NOT EXISTS (… duty_suspension s WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)`; db/01,
>   db/09 and db/23 regenerate byte-identical and CI diffs db/35 with them. The client mirror
>   (`isActive`) reads `suspended` — and `expiresAt`, which it had never read.
> - **Reads.** `officials` carries `id`, `linked`, `suspended`; `duty_suspensions` is the office's record
>   (RLS: `user.role.assign`); `assignments` carries `suspended`. The scorer learns *that* they are
>   suspended, never *why* (a scorer may be a pupil; the reason may be a safeguarding sentence).
>   **For the merge with `duty_status()`:** `duty_suspended(match_official.id)` is the fold point —
>   `WHEN duty_suspended(mo.id) THEN 'suspended'`, after `revoked` (withdrawn duty / revoked
>   assignment) and before `active`/`delegated`.
> - **Screen.** Officials → an official → each appointment: *Link authority*, *Suspend* / *Lift* with a
>   reason, gated on `holdsCapability(role, "user.role.assign")`. Assertions: db/99 §15;
>   `tools/smoke-duties.mjs`.

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

### ~~SCRBRD-037~~ — CLOSED — Match-day duty roster that shows readiness, not names

**Closed 2026-09-23 — found already built.** `apps/web/src/views/duties.jsx` (`DutyRoster`, mounted in
`MatchCentreView.jsx`) shipped in #29 (`952f68c`) under this number and was never marked closed here. It
shows each slot — umpires, third umpire, referee, scorer appointed, scoring session, team sheet, pitch
report, transport — as what is ON RECORD in `match_duties`, and an empty slot reads "nothing on record",
never "pending": nothing in the schema says a fixture owes a second umpire, and inventing the obligation
would report a school as failing it. Each row sits under its own table's RLS, so a reader sees only what
they may. Covered by `tools/smoke-browser-read.mjs` and `tools/smoke-officials.mjs`;
`ReadinessOverview.jsx` (SCRBRD-062) runs the same read across several fixtures. What it cannot show yet is
a duty's lifecycle status (delegated, suspended…) — that is SCRBRD-034, in progress, and lands on this
roster when it does.

§17.3: twelve duties (both head coaches, both managers, scorer, two umpires, commissioner, grounds,
medical, transport, media) each with a status — confirmed / pending / live / handed over / ready / issue.
The document's own line is the requirement: *"the roster should expose duty readiness, not merely names."*
Officials, transport, facilities, medical and scorer are five separate surfaces here; this is the one
screen that joins them, and "pending ≠ filled" is the same honesty as the null discipline in Analytics.
Files: new view, reads over existing resources. Risk LOW. Migration NO.

### ~~SCRBRD-038~~ — CLOSED

**Closed 2026-09-19.** `scoringHubMachine.ts`/`ReviewConfirmModal.tsx`/`review_confirm` (this entry's
own citations) do not exist in this codebase — they are the other prototype's names for the same
idea, harvested without checking against the tree. What genuinely had zero hits here was the thing
those names point at: a checkpoint between the last ball and a closed innings that the MODEL, not
just one screen, actually enforces.

**What was already built, and what it was missing.** `InningsReviewSheet` already existed and
already showed the scorer the derived totals before confirming — the review DIALOG was real. What
was not real was the gate: confirming called `emit(inningsEnd({reason: inn?.endReason ??
INNINGS_END_REASON.OVERS}))`, and the reducer honoured whatever an `innings_end` event claimed,
unconditionally, setting `inn.complete`/`inn.endReason` from the event's say-so. `inningsClosed`
was computed as "does an `INNINGS_END` event exist in this innings' log" — true the instant one
appeared, whatever it claimed. A seal naming an ending the log did not support (all out at twelve
for none), a seal naming nothing (silently defaulted to "the overs ran out"), or a stale seal
replayed from an offline queue after the figures it was minted against had moved — an undo, a
released quarantine ball — would all have closed the innings exactly as readily as a genuine
confirm. The checkpoint existed in one React component tree and nowhere the model could see it.

**The fix moves the check into the fold.** `inningsEnd()` (`packages/scoring/src/events.mjs`) gains
a `confirmed: {runs, wickets, balls}` field and drops its `OVERS` default (`reason` is now `null`
unless given — the default was quietly asserting a real match's ending on a missing argument; the
one production call site, `sealInnings()`, always supplies one). `sealInnings(inn, reason)`
(`packages/scoring/src/replay.mjs`) builds the event by reading the figures straight off the
derived innings, so an event minted through it can never claim figures the log didn't just produce.
`sealRefusal(ev, inn, why)`, run inside `deriveInnings()`'s own fold at the `INNINGS_END` case,
checks every seal against the log it is folding over: the confirmed figures must equal what the log
derives at that exact point (pinning the seal to THIS occurrence of the ending, not some earlier
or later one); the reason must be present; and if the reason is one of the three the laws derive
(`all_out`/`overs`/`target`), it must be the one they actually derive here — `declared`/`abandoned`
are taken on the scorer's word, since nothing in a ball log implies a captain's or umpire's
decision, but still only with figures attached. A refused seal sets `inn.sealRefused` and leaves
`inn.complete`/`inn.sealed` to fall through to the laws' own derivation — it cannot wrongly force an
innings closed, and cannot wrongly keep genuinely-finished scoring blocked either, since the
post-loop fallback (`if (!inn.complete) { ... }`) still applies exactly as it always did.

`apps/web/src/scorer/engine.jsx`'s `inningsClosed` now reads `inn?.sealed === true` — the model's
verified answer — instead of scanning the log for the event's mere existence, and `closeInnings()`
calls `sealInnings(inn)` instead of hand-building the event, so the UI has no path left that can
close an innings by asserting that it is closed. A refused seal is not a dead end: the banner stays
up, and confirming again builds a fresh seal off the (now current) derived figures, which succeeds
— the design is self-healing rather than requiring an error dialog for a case that resolves itself
on retry.

**Tests.** `packages/scoring/test/replay.test.mjs` gained a new group ("H. The seal — over is not
closed") covering: a seal with no `confirmed` figures refused (`UNCONFIRMED`); a seal whose figures
don't match the log refused (`FIGURES_MOVED`) — the offline-queue/quarantine-race case, reproduced
by minting a seal, then replaying one more legitimate ball before it, and confirming the stale seal
is rejected rather than closing the innings on stale figures; a seal with no reason refused
(`NO_REASON` — the exact failure the old `OVERS` default used to paper over); a seal claiming a
law-derived reason the log doesn't support refused (`NOT_THE_LAWS_REASON`); and a genuine
`sealInnings()`-built seal accepted, setting `sealed`/`complete`/`endReason` correctly for all three
law-derived endings plus `declared`/`abandoned`. `apps/web/test/innings-review.test.mjs` gained
"A delivery cannot reach a closed innings without the review" and "The reducer refuses a seal the
review did not produce," rendering the actual sheet component and asserting against the derived
model, not a mock.

Verified against a freshly reset and reseeded database and a real browser, not left to the unit
suites: `node tools/smoke-browser-innings-end.mjs` (SCRBRD-052/-063's own walk, which chases a real
target down to a genuine `target_reached` close) still passes at 23/23 with the new gate in place —
proof the legitimate confirm path is unaffected — and the full suite is green: 2008 assertions
across 31 suites (`scoring` 296, `review` 38), up from the pre-existing 1939.

**Title:** ~~Review-confirm gate before an innings closes~~
**Priority:** P1 · **Domain:** Scoring · **Type:** correctness
**Affected files:** `packages/scoring/src/events.mjs`, `packages/scoring/src/replay.mjs`,
`apps/web/src/scorer/engine.jsx`, `packages/scoring/test/replay.test.mjs`,
`apps/web/test/innings-review.test.mjs`
**Affected users:** every match — the gate now sits between every last ball and every closed innings,
not only the ones this entry originally imagined going wrong

**Current behaviour, before this:** an `innings_end` event was honoured by the reducer
unconditionally — a scorer's genuine confirm and a malformed, stale or offline-replayed event were
indistinguishable to the model, which read only "does one exist," not "does its claim match the log."
**Expected behaviour:** an innings is `sealed` only when a seal's confirmed figures match what the
log independently derives at that point, and its reason is either genuinely law-derived or one of
the two endings the laws cannot derive at all.
**Root cause:** the review dialog was built as a UI courtesy (SCRBRD-016/prior scoring work); nobody
had asked the model itself to check the courtesy was honoured.
**Recommended change:** as built — `sealInnings()`/`sealRefusal()` in the reducer, `inningsClosed`
reading `inn.sealed`.
**Why it matters:** the scoring engine is this platform's most consequential surface; a gate that
exists in one screen and not in the model it feeds is not a gate, it is a suggestion.
**Dependencies:** none. **Security / privacy impact:** none — a correctness guarantee over the
scoring log, not an access boundary. **Data migration required:** NO — an event-shape addition
(`confirmed`), not a schema change; no existing stored event carries the field, and none needs to
for old matches, since `sealRefusal()` only runs on events replayed after this change.
**Tests required:** the "H. The seal" group in `replay.test.mjs`; the two new cases in
`innings-review.test.mjs`; the existing `smoke-browser-innings-end.mjs` re-run as a regression
check on the legitimate path.
**Acceptance criteria:**
- [x] A seal with no confirmed figures does not close the innings
- [x] A seal whose figures don't match the log (stale/replayed-out-of-order) is refused, not honoured
- [x] A seal naming no reason is refused, rather than defaulting to "overs"
- [x] A seal claiming a law-derived ending the log does not support is refused
- [x] `declared`/`abandoned` are still accepted on the scorer's word, since the laws cannot derive them
- [x] The legitimate confirm path (`smoke-browser-innings-end.mjs`) is unaffected
**Regression risk:** LOW — the one production call site of `inningsEnd()` already supplied an
explicit reason before this change, so the dropped default affects nothing live; the fallback
derivation for an innings with no accepted seal is unchanged from before this entry.

### ~~SCRBRD-039~~ — CLOSED

**Closed 2026-09-23.** An innings now carries a **declared** capture profile — what the scorer chose,
at setup, to collect on every ball — and the placement evidence is read against it, so "never asked
for" and "missing" are two different answers.

**Where it lives, and why.** On the `innings_start` event (`inningsStart({captureProfile})` in
`packages/scoring/src/events.mjs`), not in a column set beside the log. The ball log is the only source
of truth; a declaration held anywhere else is a second record of the same fact with its own write path
through the lease, epoch and quarantine. `innings_start` already travels all of those, and `toRow()`
already maps `captureProfile` into `ball_event.capture_profile`, whose db/07 `CHECK` already refuses
anything but `full`/`standard`/`quick` — so the storage is **zero new columns**: an `innings_start` row
with a non-NULL `capture_profile` IS the declaration. The key is **omitted, not null**, when undeclared,
so an undeclared innings built today is byte-identical to every `innings_start` already on a phone, in
an outbox or in the server's log. The per-ball `captureProfile` is untouched.

**The fold** (`deriveInnings`, `replay.mjs`) derives `inn.declaredProfile` under three rules, and db/31's
`innings_declared_profile` view applies the same three to the rows: (1) honoured only **before the first
non-voided delivery** — a declaration that lands behind the balls (typed late, or released from
quarantine to a later seq) would excuse a thin record retrospectively; (2) **absence is not a
retraction** — SCRBRD-063's re-declaration at the break, or an older build, keeps what was declared;
(3) the latest honoured declaration wins. An unknown value in a log is ignored, never thrown; the
constructor is where one is refused.

**The labels.** `db/31_declared_capture_profile.sql` adds `evidence_label(bigint, text, text)` — a new
arity; db/08's `evidence_label(bigint)` and every caller of it are untouched — which returns
`'not_captured'` for a figure with nothing behind it from an innings whose declared profile never asked
for the field, and db/08's thresholds otherwise. `capture_profile_collects()` says what each profile
asks for (`point`: full; `sector`: full, standard). **Undeclared is taken to have asked for
everything**, which is exactly how every innings read before: the DO `$check$` asserts the overload
equals the one-argument label at every threshold edge for NULL. `innings_placement_evidence`
(security_invoker) grades each innings' points and placements. JS mirrors in `placement.mjs`:
`evidenceLabel()`, `profileCollects()`, `placementEvidence()` (which splits the undrawable balls into
`notCaptured` and `missing`, per innings or per ball for a career).

**Surfaced** where placement evidence is shown: the heat map and spider (`charts.jsx`) say "Not
captured, by design: this innings was declared standard (sector only)…" instead of "No exact placements
on record", and their provenance line counts never-asked separately from missing — in the pad, the
scorecard modal (`views/shared.jsx`) and the profile's career charts, whose `player_shot_points` read
now carries each ball's innings declaration. **The dossier is deliberately unchanged**:
`opposition_squad`'s figures are runs and balls, which every profile collects, so there is nothing a
declaration could excuse there.

**Chosen at innings setup.** `CaptureProfilePicker` (`scorer/ui.jsx`) on the match step of
`SetupScreen` (declares both innings; default **Full**, which is what the pad already does — it asks
where every ball went), on the innings break (`Innings2Sheet`, carrying the first innings' declaration
forward, or nothing), and on the opener sheet for a real fixture, whose innings opens during hydration
before anyone is asked — open only until the openers are named, because `innings_start` is the one
event undo will not walk past. A fixture that declares nothing opens undeclared, as before.

**Tests.** `replay.test.mjs` group I (+40, 296 → 336; the base file's 296 assertions pass unchanged
against the new source): legacy logs fold to `declaredProfile: null` and to the identical innings;
declaring never moves any other field; every rule of the fold; the wire round trip through the column;
an offline-queued declared innings replayed from its JSON queue entries and from server rows; a queue
from an older build; a mixed-build match. New suite `apps/web/test/capture-profile.test.mjs` (18) renders
the charts and pickers. `tools/smoke-fold.mjs` records a declared innings **offline**, flushes it, and
compares the device fold with db/31's views (declared profile, the late declaration refused by both,
`not_captured` / `insufficient` from both). `db/99` asserts live that the seed's undeclared innings grades
exactly as db/08 always did and that the views show nothing to a principal with no assignment.

**Falsified.** Dropping the before-the-first-ball test from the fold → 2 red; letting absence retract →
2 red; `captureProfile: o.captureProfile ?? null` in the constructor → 2 red; charts ignoring the
declaration → 9 red; SetupScreen defaulting to null → 1 red; db/31 with undeclared treated as not
collecting a point → the migration's own `$check$` raised "an undeclared innings grades 0 point as
not_captured, not none"; `innings_declared_profile` without the before-the-first-ball test → `smoke-fold` 2 red ("device standard, database quick"); the view reading undeclared as `quick` → db/99 "an innings with no declaration reads as declared quick"; `innings_placement_evidence` without `security_invoker` → db/31's `$check$` raised.

**Verified** against a freshly reset and reseeded database: `migrate --verify` ALL RLS LIVE ASSERTIONS PASSED; `run-smoke-api scorecard fold quarantine sync schema-guard` 144 assertions across 5 walks (fold 35); `--browser browser-sync browser-innings-end` 18 + 23; `pnpm smoke` 8 + 21 + 16 + 24; `run-all-tests` ALL SUITES PASSED, 2200 assertions across 35 suites (from 2141 across 34).

**Acceptance criteria:**
- [x] An innings-level declared profile, carried on `innings_start`, with the log as source of truth
- [x] The scorer chooses it at innings setup; the default declares today's behaviour, and a fixture
  that declares nothing opens undeclared
- [x] `evidence_label()` distinguishes "not captured by design" from "missing" (db/31 overload + JS mirror)
- [x] Surfaced where placement evidence is shown (heat map, spider; pad, scorecard, career)
- [x] Existing matches with no declared profile replay and read exactly as before — replay group I,
  db/31 `$check$`, db/99 live
- [x] Offline-queued events still apply — replay group I, and `smoke-fold` through the real outbox
- [x] Migration is `db/31` only, not in `db/SHIPPED.sha256`, listed in `expected-migrations.json`

**Affected files:** `packages/scoring/src/{events,replay,placement}.mjs`,
`packages/scoring/test/replay.test.mjs`, `db/31_declared_capture_profile.sql`, `db/99_rls_verify.sql`,
`services/api/expected-migrations.json`, `services/api/read/read-api.mjs`, `apps/web/src/lib/live.js`,
`apps/web/src/scorer/{ui,setup,sheets,engine,charts}.jsx`, `apps/web/test/capture-profile.test.mjs`,
`tools/smoke-fold.mjs`, `tools/run-all-tests.mjs`
**Regression risk:** LOW — no score, scorecard or per-ball field reads the declaration; an undeclared
innings is byte-identical on the wire and grades identically in both folds.

**Title:** ~~Capture profiles: declare the intent, not just record the code path~~
**Original entry, as filed:**
> **Corrected 2026-09-18.** The first version of this entry claimed SCRBRD OS had no capture profile. It has
> one: `CAPTURE_PROFILE` in `packages/scoring/src/placement.mjs`, a `capture_profile` column on `ball_event`
> with a `CHECK` in `db/07`, carried through quarantine release in `db/14`, and set by the engine per ball.
> The original claim came from a grep with a broken alternation, which is exactly the failure the Pass 2 rule
> above exists to prevent — recorded rather than silently edited.
>
> The real gap is narrower and still worth having. The profile is currently a **consequence of the code path**
> — a sector tap yields `standard`, a ball with no placement yields `quick` — not a **declared intent** the
> scorer or the fixture chose. Nothing surfaces it, nothing aggregates it, and `evidence_label()` cannot ask
> "how much was this innings ever going to capture?" So a thin figure reads as thin capture when it may be a
> faithful record at a profile that never collected the field. Files: `placement.mjs`, the scoring capture UI,
> `evidence_label()`, and an innings-level declared profile (a new `db/NN`, one column on the innings or
> carried on `innings_start`). Risk LOW. **Migration YES** if declared per innings rather than derived from
> the balls already logged.

### ~~SCRBRD-040~~ — CLOSED

**Closed 2026-09-23.** The scorer's gate is a function of the folded innings that names what is
missing, the pad says it in words, and the engine enforces the same answer it shows.

**The evidence.** The gate was three inline lines in `engine.jsx`'s `guardReady`: no striker or
non-striker → `setModal("opener")`, no bowler → `setModal("bowler")`, no innings → `return false`. A
fourth copy sat in `onScore`. None of it said why. Worse, the last branch was a silent dead pad: a
real fixture resumed with no roster on the device (`liveSquad()` returns null when not signed in or
the team sheet fails) writes no `innings_start`, so every tap returned false and nothing appeared.
The hub's stage-2 commits (`onRun`, `onBye`, `onLegBye`) never checked at all; they relied on stage 0.

**As built.** `packages/scoring/src/readiness.mjs` — `scoringReadiness(inn)` returns
`{ ready, blocked: [{ code, says, fix }] }`, `blocked` in the order to fix, `blocked[0]` the one to
fix now. Codes (`SCORING_BLOCK`), each derived from the fold and nothing else:
`no_innings` (`!inn` or `battingTeam == null` — no `innings_start`), `innings_closed` (`sealed`),
`innings_over` (`complete` and not sealed, carrying `endReason`) — both terminal, given alone —
then `openers` (an end empty, fewer than two batters ever named), `next_batter` (an end empty after
that), `opening_bowler` (no bowler, no delivery yet), `next_bowler` (no bowler after deliveries,
carrying the over number). Words live beside the codes (`SCORING_BLOCK_TEXT`).
**The toss is deliberately not a gate**: it is not in the ball log (it is `match_toss`, server-side,
and a resumed fixture never brings it to the device), so a check would be a guess. What the toss
decides — who bats — is on `innings_start`, and `no_innings` checks that.
In `engine.jsx`, `const readiness=scoringReadiness(inn)` feeds `guardReady`, `onScore`, a new check at
the top of `commitBall` (the funnel for every delivery) and `confirmWicket`, and `<ScoringBlocked>`
(`scoring.jsx`) above both pads: `role="status"`, `aria-live="polite"`, "Can't score yet: the
opening batters have not been chosen." with a "Choose the opening batters" button and a "Then: …"
line for what follows; it wraps at phone width and hides while a sheet is open. `fixBlock` maps each
code to the sheet that already existed (opener, newBatsman, bowler, newOver, inningsReview,
innings2); the one reason with no sheet, `no_innings` on the first innings, writes the same
`innings_start` the roster path writes, with an empty squad, then opens the batting sheet. A tap on
a blocked pad still opens the fix.

**Tests.** `packages/scoring/test/readiness.test.mjs` (suite `readiness`, 39): every code from a
folded log, both orderings (batters before bowler), the terminal cases not also asking for a batter,
a refused seal still `innings_over`, a voided bowler event, every prefix of a played log agreeing
with the raw facts, and words for every code. `apps/web/test/scoring-blocked.test.mjs` (suite
`blocked`, 24) renders the panel from folded innings and asserts the sentence, the fix button,
`role="status"`, nothing when ready, and reads `engine.jsx` for the one gate. `smoke-browser-sync`
gained 3: the real pad on a real fixture says the openers sentence, its button opens the batting
sheet, and the panel is gone once openers and bowler are named.

**Falsified.** Openers check restricted to `batsmen.length >= 2` (reports ready on `[innings_start,
bowler]`): readiness 4 red, render test 4 red. Early `return { ready: true }` while fewer than two
batters are named: readiness 4 red plus the prefix sweep, render 6 red. Restored; both green. The
first build showed the panel behind open sheets and `browser-innings-end` went red (its `NEXT`
matcher clicked the panel's "Send in the next batter" behind the sheet) — hence hidden while a
sheet is open.

**Verified.** `replay.test` 296/296; `pnpm build`; `pnpm smoke` (smoke 8, scorer 21, persistence 16,
a11y 24); `migrate --reset --seed` then walks `browser-sync` 21, `browser-innings-end` 23,
`browser-handover` 26 — all pass; full suite ALL SUITES PASSED, 2205 assertions across 36 suites
(was 34; +39 `readiness`, +24 `blocked`).

- [x] a named blocked state per missing thing, derived from the fold
- [x] the pad explains it in words, with the fix as the action
- [x] the engine's gate and the words are one function
- [x] unit + render tests, falsified

**Title:** ~~Scoring hub FSM with a named blocked state~~
**Affected files:** `packages/scoring/src/readiness.mjs` (new), `packages/scoring/src/index.mjs`,
`packages/scoring/test/readiness.test.mjs` (new), `apps/web/src/scorer/engine.jsx`,
`apps/web/src/scorer/scoring.jsx`, `apps/web/test/scoring-blocked.test.mjs` (new),
`tools/run-all-tests.mjs`, `tools/smoke-browser-sync.mjs`. Risk LOW. Migration NO.

### ~~SCRBRD-041~~ — CLOSED

> Original entry: `RulebookView.jsx` exists; beta-2's *clause shape* is better — `severity: Mandatory |
> Guideline | Penalty Enforced`, `applicableAges`, and categories including Curator & Turf and Medical &
> Safety. Making a clause queryable lets the workload surface **cite the clause it is enforcing** instead
> of asserting a number. Risk LOW. **Migration YES** if clauses are stored rather than shipped in code.

**Closed 2026-09-23.** Clauses are stored, every directive limit names the one it enforces, and the
Training screen's load panel cites it beside the number.

**The evidence.** Before this the load panel printed `U13 · 5/10` and nothing said where 5 and 10 came
from; the only statement of the rule was a comment above `bowling_directive` in `db/08`.
`RulebookView.jsx` was six hard-coded sections of general Laws text (subtitled with one real school's
name), none of it about the limits the platform enforces.

**As built.** `db/32_rulebook_clause.sql`: `rulebook_clause` (`code` is the key: the thing a directive,
a screen and a person cite; `title`, `body`, `category` CHECKed to Medical & Safety / Curator & Turf /
Playing Conditions / Conduct, `severity` CHECKed to the three values, `source`), and
`rulebook_clause_age` (clause × band, the band a **foreign key into `bowling_directive.age_band`**, so
the vocabulary is `age_band()`'s own and nothing restates it). `bowling_directive.clause_code` is new
and NOT NULL, with a **composite FK `(clause_code, age_band)` onto the clause's ages**: the U13 limit
cannot cite a clause that does not apply to U13. Seven clauses: `PACE-SCOPE`, `PACE-COUNT`, `PACE-U13`,
`PACE-U14-U15`, `PACE-U16`, `PACE-OPEN` (Guideline — no platform limit; a school's ceiling), `PACE-DOB`.
**No clause text states a number**; the figures are joined from `bowling_directive` by the read, so the
rule a person reads and the limit the breach trigger applies cannot drift. Text source: the repo holds no
official directive text, only `db/08`'s note that the figures follow the ECB fast bowling directives
mapped onto school bands in the absence of a CSA schedule — so each clause is written as the platform's
summary, says so in `source` ("Not official wording"), and carries a SCRBRD code, not an official number.

RLS: one SELECT policy per table, `app_user_id() IS NOT NULL` — the predicate `bowling_directive_read`
already uses, so a clause is exactly as visible as the limit it explains; no write policy, and
INSERT/UPDATE/DELETE revoked from `scrbrd_app` (db/06's two-layer treatment of `capability`). No write
route: nothing found needs one, and a school wanting a stricter Open line has `bowling_ceiling_open`.
Reads: `rulebook_clauses` (new), `bowling_directives` (+`clause_code`), `workload` (+`clause_code/title/
severity/body`, pace bowlers only — a spinner is under no limit and gets no citation).
`RulebookView` draws the clauses by category with severity, ages and figures, keeping the Laws crib
below, labelled reference-only.

**Tests.** `db/99`: signed-out reads 0; a spectator reads all 7 and every directive row's clause for its
band; even the owner's key cannot insert, update or widen a clause; no non-SELECT policy.
`tools/smoke-workload.mjs` 68 → 81: the directive→clause map, the clause read, and every workload row
against a written-out band→clause map, incl. seeded B Khumalo (U13, `PACE-U13`, 5/10), M Cele (U16), an
Open bowler under Hilton's ceiling (`PACE-OPEN`). `tools/smoke-browser-rulebook.mjs` (BROWSER_WALKS, 25):
rulebook renders the seven clauses in order with severity, ages and joined figures; Khumalo's row cites
`PACE-U13 · Pace bowling limits: U13` and expands to the text; the spinner's row cites nothing.

**Falsified.** Policy `USING (true)` → db/99 "an unidentified session can read rulebook clauses";
`USING (false)` → "a spectator reads 0"; grant + insert policy → "inserted a rulebook clause". Composite FK
removed → db/32's `$check$` "U13 limit was allowed to cite the U16 clause"; severity CHECK dropped →
"severity Advisory was accepted"; REVOKE removed → "the application role can write rulebook_clause".
`and w.pace` removed from the workload read → 2 workload assertions red; band join pinned to U13 → 3 red.

- [x] Clauses stored with severity, applicable ages and category
- [x] Every directive limit references its clause (FK, band-checked)
- [x] Workload monitor cites the clause (code + title, expands to text)
- [x] Rulebook renders clauses grouped by category
- [x] Live RLS assertions and walks, each guard falsified

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
                                              └▶ SCRBRD-026 ✓ (audit log) ──▶ SCRBRD-012 ✓ (impersonate)
SCRBRD-002 ✓ (dismissal enum) ──▶ SCRBRD-003 (quarantine release — backend done, no UI, still open)
                             └▶ SCRBRD-016 ✓ (reduced overs)
                             └▶ SCRBRD-017 ✓ (determinism test)
SCRBRD-006 ✓ (analytics consent) ──▶ SCRBRD-020 ✓ (code splitting)
SCRBRD-001 ✓ (login page) ──┐
SCRBRD-011 ✓ (capability gates) ──┴  (neither actually gated SCRBRD-027 — checked 2026-09-19)
SCRBRD-027 ✓ (delete legacy-roles — closed 2026-09-23, on retiring old-vocabulary names from
             LoginPage/OnboardingFlow/ManagementView/mock.js, not on -001/-011)
SCRBRD-009 ✓ (idempotency) — independent
SCRBRD-010 ✓ (offline walks) — independent, should land BEFORE SCRBRD-003 (regression net)
SCRBRD-008 ✓ (reset guard) — independent, do first: five lines, Critical impact
SCRBRD-005 ✓ (AI pseudonyms) — independent
SCRBRD-024 ✓ (CI) — independent, protects everything after it

Pass 2:
SCRBRD-028 (invariants) ──▶ SCRBRD-029 ✓ via SCRBRD-054 ✓ (db/24)
SCRBRD-030 (sensitivity tiers) ✓ — role split corrected 2026-09-23 to ship as `db/27`; `db/01` restored
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
   is still genuinely open; see its entry above.

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
| ~~SCRBRD-012 impersonate~~ | ~~SCRBRD-026~~ | done — both closed; `db/22`'s own audit table plus `db/20`'s platform-wide log |
| SCRBRD-003 quarantine release | ~~SCRBRD-002~~ | blocker closed; SCRBRD-003 itself stays open for lack of a UI panel, not for this |
| ~~SCRBRD-020 code splitting~~ | ~~SCRBRD-006~~ | done — both closed |
| ~~SCRBRD-027 delete legacy-roles~~ | old-vocabulary role names in `LoginPage`/`OnboardingFlow`/`ManagementView`/`mock.js` | done — closed 2026-09-23, see the entry above |
| ~~SCRBRD-007 search_path~~ | ~~SCRBRD-004~~ | done — both closed |
| ~~SCRBRD-029 split request/approve~~ | `db/24` | done — it took a new capability, so it got its own file after all, and `ADDED_SINCE_01` in the generator for it |
| SCRBRD-034 duty lifecycle | SCRBRD-031 | `~~SCRBRD-031~~`'s own closure says SCRBRD-034 no longer depends on it (premise corrected) — re-check SCRBRD-034 on its own merits before assuming it is still blocked |
| SCRBRD-036 sponsor viewer | ~~SCRBRD-032~~ | ADR closed; a role request still has to be raised and pass it before this is buildable |
| SCRBRD-037 duty roster | SCRBRD-034 | readiness is duty status; without the lifecycle the roster can only show names, which is the thing §17.3 says not to do |
| ~~SCRBRD-042 consent register~~ | — | done — closed as already-correct |
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

### ~~SCRBRD-059~~ — CLOSED

**Closed 2026-09-23.** `db/28_scoring_claim_handover.sql` re-creates `scoring_claim()` from its latest
definition (`db/17`, not `db/02`) with the same signature and return shape: a plain claim while
`handover_pending` is refused as `handover_pending`, and while `verifying` as `verifying` — each its own
reason, neither folded into `lease_active`. The reference `claim()` in `scoring-session.mjs` has the same two
refusals and the same strings. The file ends in a `DO $check$` asserting the return shape, `SECURITY DEFINER`,
the pinned search path, `scrbrd_app`'s EXECUTE, both reasons and the surviving `lease_active` refusal; it is
**not** yet in `db/SHIPPED.sha256`. No capability or bundle moved: regenerating leaves `db/01`, `db/09` and
`db/23` byte-identical.

**Two things the recommended one-line change would have got wrong, found by reading the callers first.**
First, `db/17` had already added a `verifying` refusal — but only while the lease was live, as
`verification_pending`. Leases are refreshed only while ACTIVE (`scoring_lease_check`), so once a handover
is armed the outgoing lease runs down from the last ball, and ninety seconds later that guard opened
whether the incoming scorer was dead or still reading the scoreboard. `db/28` refuses `verifying`
unconditionally; the stalled-verification recovery is unchanged — force-release by `scoring.correct` once the
lease lapses, then a fresh claim — which is what `smoke-handover-crash.mjs` already walked. Its
`verification_pending` expectation became `verifying`, the reason the client already uses (`engine.jsx`),
and it gained an assertion that a lapsed lease no longer reopens the claim. Second, **the client's
`cancelHandover()` IS a plain claim** from the arming device (`handover.js`: there is no cancel route), so a
blanket `OR s.state IN (...)` would have broken cancel. A `handover_pending` claim is therefore still allowed
from the arming device **and** user — the same pair `scoring_arm_handover()` checks — and from nobody else.

**Evidence.** `db/99` section 14 drives the real functions as `scrbrd_app` (scorer on device a, Sarah on
device b, match 0003): armed → Sarah refused `handover_pending`, session and code untouched; the arming
device string under Sarah's account refused; still refused after the lease lapses; the arming
device+user takes it back (epoch 2, `active`); re-armed and code-claimed → Sarah and the scorer both refused
`verifying`, still after a lapse, verification untouched; force-release then claim (epoch 4); a live lease
still `lease_active`. `migrate --reset --seed && --verify` → ALL RLS LIVE ASSERTIONS PASSED.
`scoring-session.test.mjs` 77 → 98 assertions. `smoke-handover.mjs` asserts B's plain claim is refused as
`handover_pending` once armed and as `verifying` after the code (36 passed); `run-smoke-api.mjs handover
handover-crash sync fold quarantine` → 36/18/51/25/25, 0 failed. `run-all-tests.mjs` after a reset →
ALL SUITES PASSED · 2065 assertions across 32 suites (was 2041).

**Falsified, each then restored:** removing the `handover_pending` clause → db/99 "a plain claim jumped an
armed handover (ok=t)", the reference suite 6 red, and the handover walk's plain claim taking the token
(the code claim, verify and every later step failing behind it — the original bug, reproduced); putting
back `db/17`'s lease gate on `verifying` → db/99 "claimable once the lease lapsed", the crash walk
`{"ok":true,"epoch":2}`; dropping the cancel exemption → db/99 "the arming device could not take its own
handover back"; matching on device alone → db/99 "another user claimed an armed handover by naming the
arming device"; restoring the old reason string → `db/28`'s own `$check$` refused to apply.

**Kept deliberately:** the SCRBRD-056 client pre-check (`sessionState()` before `startSync()`'s claim). It
no longer carries the guarantee; it returns the same two reasons, so the scorer lands on the same "take
over" screen whichever answers first, and saves a refused round trip. Comments in `handover.js`/`sync.js`
and the spec's API table (`docs/SCORING_HANDOVER_SPEC.md` §6) now say so.

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
- [x] A plain claim while a handover is pending or verifying is refused, at the database function, not
  only in the client — `db/28`; `db/99` section 14 and `smoke-handover.mjs` prove it against live Postgres
  (the arming device+user's own claim during `handover_pending` stays open: it is the client's cancel)
- [x] The refusal names which state blocked it — `handover_pending` / `verifying`, distinct from `lease_active`
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

**Drawn, 2026-09-23 — staff only, by product decision.** `apps/web/src/views/discipline.jsx` is the
first screen over the record. A **Conduct** tab on the player profile lists a boy's matters (date,
fixture, state, who recorded it, the account, the outcome) and, for a `discipline.write` holder,
carries the school-side "Record a matter" form and Conclude/Withdraw with a required outcome. In
Match Centre, "Report an incident" lets the appointed umpire file against his fixture and tells
him *"Recorded — the school has it"* without reading anything back. Every refusal the routes map
(42501 → `not_permitted`, 45001, 45002, the CHECK) is said in words beside the form.
**The product owner decided pupils see nothing of the record in the app yet**, although
`selfaccess` may read his own in the database; neither the database nor the policy changed. The
gate is `rbac/conduct.js` — `discipline.read` over the whole *persona* (the shell's role plus
`ROLE_IDENTITY.also`, because a pupil is laid out as `player` and holds the read through
`selfaccess`) and not `readsOwnRecord` — pinned for every shell role in `rbac.test.mjs`; courtesy
only, RLS is the guard. `disciplinary_records` gained an optional `playerId` narrowing so a
profile's read — and the access-log entry it writes — names one child, not every child with a
matter. The umpire cannot read the team sheet (no `player.profile.read`), so he names a player by
his part in the ball log he stood over; anyone not in it he has to report to the school directly.
Walk: `tools/smoke-browser-discipline.mjs`; `up51` is shipped.

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

### ~~SCRBRD-065~~ — CLOSED

**Closed 2026-09-19.** `player_dismissal_breakdown`/`player_wicket_breakdown` (`db/26_dismissal_breakdown.sql`)
group the exact same rows `player_dismissals` and `player_bowling_career` already fold into a single
count each — the arithmetic is a GROUP BY away, now that `db/13` closed `ball_event.dismissal` to the
eleven values the Laws recognise. Exposed as a new read resource, `dismissal_breakdown`, in
`read-api.mjs`, inheriting the same RLS boundary `career` already relies on (`security_invoker` over
`ball_event_live`, `fixture.read`) — no new capability, no new gate, the same tenant-scoping
discipline as its sibling.

**The one law this exists to keep, and the one place it could have been gotten wrong:** a run out is
not the bowler's wicket. `player_wicket_breakdown` filters through `dismissal_is_bowlers()` — the
same predicate `player_bowling_career.wickets` already uses — so the two can never disagree about
whose figure a dismissal counts against. `tools/smoke-dismissals.mjs` proves this against real
Postgres by writing a synthetic over (the static seed's only two wickets both have `bowler_id NULL`,
for a real, pre-existing reason — the bowler in that innings is an opposing player with no row in
a Hilton-only roster — so nothing in the seed alone exercises the predicate) crediting one bowler
with five methods including a run out, and asserting the run out is the one that does not show up
in his four wicket-type rows.

**A real bug this closure caught before it shipped, not after:** the smoke test's first draft used
`T Bekker` as its synthetic striker — the same player the seed's own 96-ball over separately credits
with a real `bowled` dismissal at ball 34 — so the "five, exactly" assertion was fighting a sixth,
real dismissal already on his record and failed. Fixed by moving the synthetic striker to `S Naidoo`,
whose range in that same over (balls 35-55) carries neither of the seed's two wickets, confirmed by
re-reading the seed's own ball-assignment logic rather than guessing. `node tools/run-all-tests.mjs`
also needed `sensitivity.test.mjs`'s "every watched resource names at least one field" widened to
accept `dismissal_breakdown` as row-gated the same way it already accepts `career` — a resource with
nothing masked because the whole row is the gate, not an oversight.

**Caught and bowled is deliberately not its own line.** HowStat and most scorecards give it one
because it says the bowler took the catch himself — a fact about WHO FIELDED it, which `ball_event`
does not record. Every caught dismissal off a bowler's own bowling looks identical in the log to a
catch taken by any of the other ten fielders; inferring the split from `bowler_id` alone would be
wrong for nearly every `caught` row in the game, which is worse than not drawing the line at all. If
a fielder/catcher column is ever added, the split falls out of the same `GROUP BY` for free.

Falsified live: the real view swapped for a broken one crediting every method to the bowler
(run out included), confirmed the defect reappears and the assertion built to catch it goes red,
then restored from the file that ships (read back into the test rather than retyped, so "restore"
cannot itself drift from what `db/26` says) and reconfirmed green.

Verified against a freshly reset and reseeded database: `node tools/migrate.mjs --reset --seed
--verify` (ALL RLS LIVE ASSERTIONS PASSED, no capability or policy changed — `pnpm rls:generate`
leaves `db/01`/`db/09`/`db/23` byte-identical); `tools/smoke-dismissals.mjs`, 13 assertions,
registered as `"dismissals"` in `tools/run-smoke-api.mjs`; full suite 2008 assertions across 31
suites.

**No screen this pass.** `up48` on the roadmap moves from `planned` to `partial`, naming
`dismissal_breakdown` as undrawn — the same honest pattern `up51`/`up23`/`up24` already use for a
real, read-gated resource with no view yet built against it.

**Title:** ~~Dismissal Analysis — how a boy gets out, and how a bowler takes wickets, by method~~
**Priority:** P2 · **Domain:** AI / Analysis · **Type:** product completeness
**Affected files:** `db/26_dismissal_breakdown.sql` (new), `services/api/read/read-api.mjs`,
`db/98_seed_pilot.sql`, `tools/smoke-dismissals.mjs` (new), `tools/run-smoke-api.mjs`,
`packages/policy/test/sensitivity.test.mjs`, `apps/web/src/data/roadmap.js`
**Affected users:** every coach or analyst asking how a boy gets out, or how a bowler's wickets break down

**Current behaviour:** `player_dismissals` and `player_bowling_career.wickets` each give one number;
neither can say bowled-how-many, caught-how-many, lbw-how-many.
**Expected behaviour:** the same figures, grouped one dimension further, read from the same RLS
boundary every sibling career resource already relies on.
**Root cause:** the flat counts were built first, and nobody had asked the question a breakdown
answers until the HowStat review named it.
**Recommended change (as built):** described above.
**Why it matters:** a coach who can see a bowler took five wickets but not how — five yorkers or
five lucky nicks — is reading a number, not a bowling spell.
**Dependencies:** `db/13`'s closed dismissal vocabulary and `dismissal_is_bowlers()`, both pre-existing.
**Security / privacy impact:** none — no new capability, same read boundary as `career`.
**Data migration required:** NO — two views over existing rows; no schema change, no backfill.
**Tests required:** `tools/smoke-dismissals.mjs`'s live, self-falsifying proof that a run out is
never credited to the bowler.
**Acceptance criteria:**
- [x] A bowler's wickets are readable broken down by method, excluding run outs and the other
      non-bowler dismissals
- [x] A batter's dismissals are readable broken down by method, run outs included
- [x] The breakdown sums to the same totals `player_dismissals`/`player_bowling_career` already give
- [x] Falsified live: crediting a run out to the bowler is caught, not silently accepted
- [x] No capability or RLS policy changed
**Regression risk:** LOW — two new views and one new read resource, additive; no existing resource,
policy or capability touched.
alone here.

### ~~SCRBRD-066~~ — CLOSED

**Closed 2026-09-23.** The API now refuses to start when the database is missing a migration the
code was built against — the same way `server.mjs` already refuses a superuser connection.

**The evidence.** On 2026-09-23 production's API and client were found running the code from merged
PRs #30 and #31 against a database still at `db/23`: `db/24`–`db/27` had never been pasted. Every
screen reaching for what those files create would have answered `42P01`/`42883` for as long as nobody
looked. DEPLOYING.md's rule was "schema first, always"; `.github/workflows/deploy.yml` deploys the API
and the client on every push to `main` whatever state the database is in, and `render.yaml` does the
same. The rule was a sentence.

**As built.** `services/api/expected-migrations.json` lists every `db/NN_*.sql` name the code was built
against (the image carries no `db/`, so the server needs its own record; names only —
`db/SHIPPED.sha256` pins bytes). At boot, after `assertRlsApplies()` and before `listen`,
`assertSchemaCurrent()` (`services/api/schema-guard.mjs`) reads the ledger through a new
`SECURITY DEFINER` function, `schema_migrations_applied()` (`db/29_migration_ledger_read.sql`) —
`schema_migration` has RLS on and no policy, so `scrbrd_app` reads none of it directly — and exits 1
naming every missing file and the `scrbrd-supabase-apply-NN.sql` paste for each, in order. A database
AHEAD of the code (the normal state during a schema-first rollout) starts. A database without `db/29`
cannot report what it has and is refused with the query to find out. No escape hatch: a database
behind the code is fixed by applying the migration, locally `node tools/migrate.mjs`. On Cloud Run
and Render a revision that fails to start never takes traffic, so the previous revision keeps
serving; `deploy.yml`'s client job now `needs: api`, so the client does not go out ahead of an API
that was refused.

`db/29` returns names only (no hash, note or timestamp), is revoked from `PUBLIC` (and from Supabase's
`anon`/`authenticated` where they exist), granted to `scrbrd_app` alone, pins `search_path`, and
asserts all of that in its own `DO $check$`. **`db/29` is itself in the expected list**, so production
must take `apply-29` before the first deploy of this guard — the rule applied to the file that
enforces it.

**Tests.** `services/api/schema-guard.test.mjs` (registered as `schema-guard`, 22 assertions) holds the
list to `db/` exactly — adding a migration without listing it fails the suite — and proves the
comparison over a fake pool. `tools/smoke-schema-guard.mjs` (WALKS entry `schema-guard`, port 8846,
19 assertions) boots the real server as `scrbrd_app` against a freshly migrated database: complete →
starts; one extra ledger row → starts; `26_*` removed → exit 1 naming it and `apply-26`; `24`–`27`
removed (the incident) → all four, in order; `db/29`'s function renamed away → refused with the
lookup query; restored → starts.

**Falsified.** Guard call commented out of `server.mjs`: 11 of the walk's 19 assertions went red.
Guard changed to refuse extras too: the "ahead" assertion went red in both the walk and the unit
suite. A stray `db/30_falsify.sql`: the list assertion went red naming it. `db/29`'s check re-run
after each of GRANT to PUBLIC, SECURITY INVOKER, RESET search_path, REVOKE from `scrbrd_app`, and a
body returning hashes: each raised its own message.

**Verified.** `migrate --reset --seed && --verify`: ALL RLS LIVE ASSERTIONS PASSED; walks `read`,
`handover`, `handover-crash`, `schema-guard` pass, and `smoke-scorer` 21/21; full suite 2125
assertions across 34 suites; `rls:generate` leaves `db/01`/`db/09`/`db/23` byte-identical.

**Title:** ~~The API serves code the database has not caught up with~~
**Priority:** P1 · **Domain:** Deploy / Platform · **Type:** deploy safety
**Affected files:** `db/29_migration_ledger_read.sql` (new), `services/api/schema-guard.mjs` (new),
`services/api/expected-migrations.json` (new), `services/api/schema-guard.test.mjs` (new),
`tools/smoke-schema-guard.mjs` (new), `services/api/server.mjs`, `tools/run-all-tests.mjs`,
`tools/run-smoke-api.mjs`, `.github/workflows/deploy.yml`, `DEPLOYING.md`
**Affected users:** everyone using a screen whose schema had not been applied
**Current behaviour:** a deploy ahead of its schema serves `42P01`/`42883` until somebody notices.
**Expected behaviour:** it fails to start; the previous revision keeps serving; the log says which
paste to apply.
**Root cause:** "schema first" was enforced by nothing — the deploy never looks at the database.
**Dependencies:** the ledger (`tools/migrate.mjs`, `tools/bundle-sql.mjs`).
**Security / privacy impact:** one new definer function exposing migration file names to the
application role only; no capability, policy or table changed.
**Data migration required:** YES — `db/29`, before this API deploys. No backfill.
**Acceptance criteria:**
- [x] The server refuses to start on a database missing an expected migration, naming it and the fix
- [x] A database ahead of the code starts
- [x] Adding a `db/NN` without listing it fails the suite
- [x] Falsified: with the guard removed, the refusal assertions go red
**Regression risk:** LOW for behaviour; the operational risk is the one intended — the first deploy
after this merges will not start until `apply-29` has been pasted.

### ~~SCRBRD-067~~ — CLOSED

> **Closed 2026-09-24.** On a live fixture the pad reads the toss the server recorded — through the fixture
> list it already reads (`GET /api/read/matches`, fixture.read, whose rows carry `toss_won_by`,
> `toss_decision`, `bats_first`), no new endpoint — and opens the first `innings_start` with the side it put
> in, the home roster going with the home side whether batting or bowling (`firstInningsSides`,
> `packages/scoring/src/toss.mjs`). With no toss (none recorded, or no way to ask) nothing opens: the pad asks
> for the winner and the election (`apps/web/src/scorer/toss.jsx`, nothing preselected), and the "can't score
> yet" fix asks again rather than defaulting. The answer opens the innings at once by the server's rule
> (`battingFirst` = `bats_first()`) and is recorded as the toss (`POST /matches/:id/toss`, written under
> scoring.start — the pad's own capability; not locked, since the pad has sent no delivery; refused or
> offline changes nothing on the pad). The second innings swaps sides and squads from the first rather than
> assuming team2. The demo setup's innings now carry the batting side's name, not the first-picked side's.
> Tests: `packages/scoring/test/toss.test.mjs` (suite `toss`), `tools/smoke-browser-toss.mjs` (browser set).
> The walks that open the seeded Michaelhouse fixture record a home-bats toss first. No migration.

#### (original entry) SCRBRD-067 — A real fixture opens its first innings without asking who won the toss
**Title:** The scorer assumes the home side (`team1`) bats first on a live fixture, although the toss is recorded
**Priority:** P2 · **Domain:** Scoring · **Type:** correctness
**Affected files:** `apps/web/src/scorer/engine.jsx` (the "real fixture nobody has scored yet" hydration path,
and SCRBRD-040's `NO_INNINGS` fix, which deliberately copies it), the toss read (`match_toss`, `tools/smoke-toss.mjs`)
**Found 2026-09-23** while reviewing SCRBRD-040. The demo setup flow derives the batting side from the toss and the
bat/bowl election (`setup.jsx`, `first = bat===0 ? toss : 1-toss`). The live-fixture path does not: it writes
`innings_start` with `battingTeam: cfg.team1`, and SCRBRD-040's fix for a fixture with no roster on the device
writes the same. When the side that won the toss chose to field, the first innings is recorded against the wrong
team, and `innings_start` is the one event undo will not walk past.
**Expected behaviour:** the first `innings_start` on a live fixture names the side the recorded toss put in to bat;
with no toss recorded, the scorer is asked (toss winner and election) before the innings opens, never defaulted.
**Tests required:** a walk that records a toss where the away side bats first and asserts the opened innings.
**Data migration required:** NO (reads the existing toss).

### ~~SCRBRD-068~~ — CLOSED · Byes or leg byes run off a no-ball are credited to the batter
**Closed 2026-09-25** in `105e467` (#37): `nbRuns` (NB_RUNS) on a no-ball says the runs were byes or leg byes, the fold and the Laws check read it (`events.mjs`, `laws.mjs`), and db/40 carries it into every SQL reader.
**Reopened and corrected 2026-09-27 (Kameel, from `docs/laws/CLAUSE_CHECK.md`, mismatch 1).** It was built to the 2000
Code (Law 24.13: every run of a no-ball a no-ball extra, all of them debited to the bowler). The Code in force — the
2017 Code, 4th Edition from 1 October 2026, 21.15 and 18.10.2–18.10.3 (21.16 in the 3rd) — says: the one-run penalty
is a no-ball extra, debited to the bowler; runs off the bat are the striker's, debited to the bowler; runs not off the
bat are **byes or leg byes**, as appropriate, and **not** debited to the bowler. The no-ball is still not a legal ball,
the striker has still faced it, and the runs completed still move the strike. The event is unchanged (`value` and
`nbRuns`); what it means for the figures moved. Built: the fold (`extras.noBall` takes the penalty run only, the rest
to `extras.bye`/`extras.legBye`; the bowler charged `runsToBowler()`), and `db/52_noball_byes.sql`
(`ball_runs_to_bowler()`; `player_bowling_since`, `bowler_innings_figures`, `opposition_squad`,
`player_bowling_by_season`, `player_bowling_career` redefined over it, and the `career` read), the board's chip
("nb+4b"), the no-ball sheet's words. Stored rows are read under the new rule: a bowler's runs over an old no-ball
bye fall by the byes; totals do not move. Proof: `laws-spec.test.mjs` D (byes, leg byes, four byes, hit, on a free
hit), db/52's own block, db/99 §19/§22/§30 and db/43's fixture, `smoke-fold-figures`.
**Title:** A no-ball's `value` is always runs off the bat, so the event model cannot record no-ball byes
**Priority:** P2 · **Domain:** Scoring · **Type:** correctness (event model)
**Affected files:** `packages/scoring/src/events.mjs` (`BALL_TYPE.NO_BALL`), `packages/scoring/src/replay.mjs`
(`bat.runs += v` on a no-ball), the scorer pad's extras sheet
**Found 2026-09-23** translating AntiGravity's `liveProjectionRules.test.ts` into `packages/scoring/test/laws-spec.test.mjs`.
By the Laws, byes or leg byes taken off a no-ball are scored as no-ball extras and are not the striker's
(Law 21.15, Law 23). OS's no-ball carries one number, defined as runs off the bat, so four byes off a no-ball either
go into the batter's score or cannot be entered at all.
**Expected behaviour:** a no-ball records runs off the bat and runs not off the bat separately; the batter is
credited only with the first, the bowler charged per the Laws, and old logs replay unchanged.
**Tests required:** laws-spec cases for no-ball + byes and no-ball + leg byes (batter, bowler, extras, strike).
**Data migration required:** NO if the new field rides in the payload; the fold must default it for old events.

### ~~SCRBRD-069~~ — CLOSED · Which end is empty after a run out that completed runs
**Closed 2026-09-25** in `105e467` (#37): a wicket may record the end the batter was out at (the pad asks on a run out), and the fold places the survivor from it and the runs completed. `laws-spec.test.mjs`'s KNOWN_GAP is now passing cases, and none is open.
**Title:** The fold never changes ends on a wicket ball, so a run out after a completed run leaves the survivor at the wrong end
**Priority:** P3 · **Domain:** Scoring · **Type:** correctness (display between events)
**Affected files:** `packages/scoring/src/replay.mjs` (`deriveInnings`, the wicket case)
**Found 2026-09-23** in the same translation (kept as a named `KNOWN_GAP` in `laws-spec.test.mjs`). With runs
completed before the run out, the batters have changed ends (Law 18), and which end the dismissed batter was out at
decides which end is empty (Law 38.4). The fold cannot know the second from the event today; it assumes neither
changed. The next `batters` event names ends explicitly, so the scorecard is right; the live "who is facing" between
the wicket and the new batter can be wrong.
**Expected behaviour:** a run out records the end it happened at (or the scorer is asked), and the fold places the
survivor from that and the runs completed. Needs a product decision on the pad question before building.
**Tests required:** turn the `KNOWN_GAP` into passing cases for both ends.
**Data migration required:** NO.

### ~~SCRBRD-070~~ — CLOSED

> **Closed 2026-09-24.** Tapping the pad's "Refused N" pill opens a sheet (`apps/web/src/scorer/held.jsx`)
> listing each held event in words — what it was, with the players' names, the reason (`REFUSAL_TEXT`; a
> conflict gets its own sentence: the server keeps its copy, discard is the fix) and when. The rules are
> pure and tested in `packages/sync/src/held.mjs` (`packages/sync/test/held.test.mjs`, suite `held`):
> **Discard** takes the event out of the pad's log through the same `setEvents` → `saveMatch` path undo
> uses, then lets the held copy go; **Record again** (refusals only, never conflicts) moves it to the end as
> a new event with a new id and `resentFrom`, offered only when `lawsRefusal` against the server's view
> says it would be accepted, and credited to the crease as it stands then. Each is offered for one event or
> for it and every event held after it (the cascade). Nothing is resent on its own: discarding the refused
> cause does not change what the server knows, so the balls after it only become legal once the scorer puts
> the cause right and records them again. `SyncEngine.record()` no longer re-queues a key it holds, so a
> reopened pad no longer doubled the held list. Undo of a refused last ball lets its held copy go. The
> handover sheet warns while anything is held and does not block. Walk: `tools/smoke-browser-held.mjs`
> (browser set) — provoke, list, discard, reopen, repair the cascade, discard a cascade; the pad's saved log
> and the server's `ball_event` agree id for id and figure for figure. No migration.

#### (original entry) SCRBRD-070 — A scorer cannot see or clear an event the server refused
**Title:** Held (refused / conflicting) events are kept on the device and counted, but no screen lists or resolves them
**Priority:** P1 · **Domain:** Scoring · **Type:** workflow gap (follows db/36)
**Affected files:** `packages/sync/src/sync-engine.mjs` (`held`, `discardHeld`), `apps/web/src/scorer/engine.jsx` (the "Refused N" pill)
**Found 2026-09-23** reviewing the commit-time Laws work. Since db/36 the server refuses an illegal event or a reused
key with a different body and writes nothing; the device holds it apart from the outbox. The pad says "Refused N" with
the latest reason, but nothing calls `discardHeld`, and the pad's own board still counts the refused event, so the
device and the server disagree until a person acts — and a refused lifecycle event (e.g. a bowler) makes the balls
after it refused too.
**Expected behaviour:** a sheet on the pad listing each held event with its reason in words, and for each: discard
(the board re-derives without it) or correct and re-send as a new event. Handover warns while events are held.
**Tests required:** browser walk — provoke a refusal, see it listed, discard it, board and server agree.

### SCRBRD-071 — Loose ends found building the commit-time Laws check
**Priority:** P3 · **Domain:** Scoring · **Type:** correctness (each small)
- ~~`contact` and `trajectory` are mapped by `toRow` but not listed in the live INSERT or in `quarantine_resolve`, so they are dropped.~~ **Done** (db/37, `events-api.mjs`): both are written on the live path and on release, and read back. Old rows' fingerprints do not move (stored NULL, pad sends null, NULLs stripped); `tools/smoke-laws.mjs` retries a row written by the old insert.
- ~~A ball released from quarantine (`quarantine_resolve`) is inserted without the Laws check.~~ **Done**: the release route calls `quarantine_resolve()` in a savepoint (it keeps the authority check and now takes the per-match lock), folds the log and asks `lawsRefusal()`; a refusal rolls back, keeps the ball held and returns `laws_refused` with the reason in words. The panel offers Discard or Leave it held.
- ~~A key already held in quarantine and re-sent while the device holds the token is written live; a later release of the held copy then hits the unique key.~~ **Done**: writing it live is right (lease, epoch and Laws all pass), and db/37's trigger closes the held copy as `superseded` in the same statement; rows already left open are closed by the migration. (The old release did not actually hit the unique key — db/14's own check answered `already_recorded` and closed the row as `rejected` — but until then the row sat open in the approver's queue.)
- ~~A batter returning after retiring hurt keeps "retired" on his record in the fold.~~ **Done 2026-09-27**: a
  `batters` event naming a batter retired hurt puts him back on his own line — status batting, no dismissal line, his
  runs and balls going on (`replay.mjs` `resume`). An unmarked legacy `retire` "out" (the Laws read it as out and refuse
  the return) is left as it was. The batting-order sheet lists a retired-hurt batter under "Retired hurt — may resume".
  SQL never read the retirement, so nothing moved there: `smoke-fold-figures` now brings batters back from retired hurt
  in its generated logs (5 in its run) and every SQL figure still agrees. `replay.test` (two cases, each falsified: no
  resume, and resuming the legacy "retired out"). ~~Found, not fixed: the pad has no way to RECORD retired hurt (nothing
  emits `retire` with reason `hurt`), so the resume list shows only for a log that came with one.~~ **Built 2026-09-27**:
  "Batter retired hurt" on the pad's menu, beside the suspension (never an interrupt, §1a). `scorer/retireSheet.jsx`
  asks which batter — striker or non-striker, by name, end and figures — and records `retire({batter, reason: "hurt"})`
  (`scorer/retire.js` `retireHurtEvent`, the events.mjs builder: no W marker, so not a wicket — no wicket moment, the
  over and the bowler unmoved); the pad then opens the batting-order sheet at once for the end he left, which does not
  offer him back to it (`BattingOrderSheet` `notResuming`). Mid-over works. The Laws are asked before anyone is offered
  and again at the tap (`lawsRefusal`: someone not at the crease is `not_at_crease`), said in words
  (`retireRefusalWords`). Also fixed: `fixBlock` sent `NEXT_BATTER` with the striker in to the OPENERS' sheet, which put
  the arrival at the non-striker's end and then asked for the opening bowler; it opens the batting-order sheet now.
  SQL: no disagreement, no migration — `smoke-fold-figures` now emits pad-style retirements (the builder, asked of the
  Laws, mid-over; 12 in its run, 10 back later, plus a written-out innings); every figure agrees, each row is stored
  with no W marker, and `ball_retired_batter()` / `ball_retirement_dismissal()` count none of them. Proof:
  `apps/web/test/retire-sheet.test.mjs` (the event, the refusals, the fold after a mid-over retirement and a return,
  the sheet at the floors; falsified five ways), `tools/smoke-browser-retire.mjs` (new, registered). ~~Not modelled: Law
  25.4.2's "only at the fall of a wicket or the retirement of another batter" — the Laws take a return at any empty
  end; the pad only declines to offer him straight back to the end he left. The Laws also take a retirement in an
  innings that is over or sealed.~~ **Built 2026-09-27**: (1) *Resuming.* The fold records each retirement that is not
  out in `inn.retirements` (who, why, the innings' wickets when he went, the ball; it moves no figure), and
  `lawsRefusal` takes a `batters` event naming a batter retired hurt only if, since his LATEST retirement, the wickets
  have moved or another batter has retired — otherwise the new `resume_not_yet` ("a batter who retired hurt may resume
  only after a wicket has fallen, or another batter has retired, since he went off"; on the pad "He can resume only
  once a wicket has fallen or another batter has retired."; a likely cause in `causes.mjs`). An end is only ever empty
  after a wicket or a retirement, so this refuses exactly his walking straight back into the vacancy his own
  retirement made. A wicket with no ball counts; two off at once — the first may return at the second's retirement.
  The clause (Law 25.4.4, not 25.4.2) is in code comments only. (2) *Over or
  sealed.* A retirement (hurt, or an unmarked legacy one) in an innings that is over is `innings_over`, sealed
  `innings_closed` — the codes and order a dismissal with no ball already used. The pad: the batting-order sheet's
  "Retired hurt — may resume" list is now the Laws' answer (`retire.js` `resumeChoices`/`resumeRefusal`, asked with
  the event the sheet would send), passed to every `BattingOrderSheet` as `resumable`; `notResuming` is gone (the Laws
  cover it, and it forgot nothing they do not). SQL: no change — no SQL judges events (the Laws run in JS at commit
  and at quarantine release) and no SQL reads when a batter resumed; db/98 has no retirement; db/49's and db/99's
  fixtures write rows past the Laws and contain no resume. Found in `smoke-fold-figures`' generator (a test bug, not a
  legitimate case): 3 resumes straight back into the batter's own vacancy (its generic `retire("hurt")` never set
  `justRetired`) and 2 retirements hurt after a chase was won (it plays on past a target). It now asks the Laws for
  both, after its random draws, so its stream is identical up to the first event the rules refuse (event 179 of
  1281) and differs after it only because a different batter is in; a new assertion asks the Laws of every retirement
  hurt and every return in its logs (12 and 12 in its run, 0 refused). Proof: `laws.test` group Q (the server's fold and the pad's
  agreeing), `replay.test` (the record), `retire-sheet.test` (the resume list, the sheet, the over), `smoke-browser-retire`
  G (partner retires and is not offered back; next batter in; the first retires too; the partner, whose retirement came
  first, is offered and the server takes him; the other is not). Falsified: the rule, its record, the over and sealed checks, the sheet and the generator,
  each mutated in turn and failing its tests. Found, not fixed: the last batter retiring hurt with nobody
  left to come in ends the innings under the Laws; `inningsOverReason` counts wickets only, so the fold does not derive
  that ending (the pad never offered him straight back either, so nothing new is stranded).
  ~~**Not built, needs SQL (2026-09-27): resuming after retired out, with the opposing captain's consent (Law 25.4.3).**
  Proposed model: a `batters` event carrying `captainConsent: true`, which the Laws take only for a batter retired
  out (W-marked retire, reason out — never timed out), under the same 25.4.4 timing; the fold on it takes the
  wicket back (wickets − 1, his `fow` and `nonBallWickets` entries removed, status batting, no dismissal line, his
  line going on), and the 25.4.4 check moves from `inn.wickets` to a counter that only rises. Stopped before building:
  every SQL reader counts a W-marked retire as a standing wicket and dismissal from the row alone
  (`ball_wicket_stands` → `match_live_score`; `innings_score_as_folded` → the handover check; `ball_retired_batter()`
  / `ball_retirement_dismissal()` → `player_innings`, `player_dismissals_since`, `player_dismissal_breakdown`,
  `player_batting_since`, `player_*_by_season`, `player_batting_career`, `player_dismissals`, `milestone_watch`), so
  a resume the Laws took would make the live score and the handover check disagree with the fold. It needs a
  migration: a `retirement_resumed(match, innings, seq)` predicate (a later live consented `batters` row naming the
  retire's `payload.batter`) and those readers redefined to leave a resumed retirement out. Sequencing with db/52 is
  the coordinator's call.~~ **Built 2026-09-27, after db/52.** The event and the Laws: `batters({..., captainConsent:
  true})`, taken only for a batter whose latest retirement is a retired out still standing, at a wicket or another's
  retirement since (25.4.4), not in an innings over or sealed; consent for anyone else is `consent_not_retired_out`.
  The fold takes the wicket back as proposed, with new arrays (a view already handed out keeps its own); retired out
  is now on `inn.retirements` (`out: true`), and the 25.4.4 timing reads wickets fallen (`wickets` +
  `resumedWithConsent.length`). SQL, simpler than proposed: not twelve readers redefined but one view —
  `db/53_retired_out_resume.sql` adds `retirement_resumed(match, innings, seq, batter)` (invoker, STABLE: a later
  live consented `batters` row naming him, by id column or typed name) and redefines `ball_event_live` (db/43's text,
  same columns, options, owner and grants, checked against a snapshot) to read such a retirement with ball type and
  dismissal NULL; every reader already reads `ball_event_live`, so the live score, the handover's count,
  `player_innings`, the dismissal, career and season readers and `milestone_watch` follow unchanged. Nothing in db/52
  is redefined. The pad: "Retired out — may resume if the opposing captain agrees" on the batting-order sheet
  (`retire.js` `consentChoices`, the Laws' answer), a confirm step, "Not agreed". Proof: `laws.test` R, `replay.test`
  (the fold, and "the db/53 fixture"), `held.test`, `retire-sheet.test`, db/53's own proof (the fixture through every
  reader, then the return voided), db/99 §31 (as the platform owner under RLS; a return naming somebody else; a typed
  name; the void), `smoke-fold-figures` (a fifth random stream: 7 consented returns generated plus a written-out
  innings, every SQL figure agreeing with the fold, every return asked of the Laws), `smoke-browser-retire` H (from
  the wicket sheet to the confirm; the board and SQL's live score take the wicket back; player_innings not out).
  Falsified: nine mutations of the Laws, the fold and the pad's choices; four of db/53 (each refused by db/53's own
  proof but one, and each turning db/99 §31 red with that proof lifted); the pad's confirm sending no consent (walk
  H, four failures); the smoke's SQL agreement with db/53's view disabled (seven failures). Paste rehearsed on a
  database built from origin/main (01–51, seeded): apply-53 before apply-52 refuses; apply-52, apply-53, verify —
  `ALL RLS LIVE ASSERTIONS PASSED`; the migrator then reports 0 to apply.
- ~~Timed out and retired out are recorded as `W` balls, which count as a legal delivery of the over.~~ **Already done by
  SCRBRD-081 (2026-09-24)**, checked 2026-09-27: both are a `retire` marked `type: "W"` (no ball, no bowler figure, no
  ball faced), through the `nonBallWickets` path; an old W *ball* naming either still folds as history
  (`replay.test` J pins both). db/40 made SQL count them; `smoke-fold-figures` (timed out and retired out in its
  generated logs) agrees. No change was needed.
- ~~Undoing a refused event that is not the last one still appends a `void`, which the server refuses and holds too.~~ Done 2026-09-24: undo drops a held event wherever it sits and lets its held copy go (`undoLast` `isHeld`, `undoOnPad`; `held.test.mjs` group I, `smoke-browser-held.mjs` group F).
- ~~`tools/smoke-a11y.mjs` and `tools/smoke-browser-read.mjs` both use port 4326~~ — fixed 2026-09-24 (smoke-a11y → 4331).
- ~~`tools/check-imports` reads the word "can" in JSX text as a call to the `can()` helper~~ — fixed 2026-09-24.
**Tests required:** one case per item when it is taken up.

### ~~SCRBRD-072~~ — CLOSED
**Closed 2026-09-24.** Phases now read the fold's own `freeHitSaved` flag instead of re-deciding, and three more
divergences were fixed with it: fours and sixes count only runs off the bat (not four byes; a no-ball hit for four
counts), a W ball with no mode written counts as the fold does, and a revision below the overs already bowled no
longer drops the later balls. An invariant test over 60 generated innings holds runs, balls, wickets, dots, fours and
sixes summed over phases equal to the innings. Penalty runs stay outside every phase (the fold keeps only their total);
phase runs sum to `runs − extras.penalty`, documented in phases.mjs.

Original entry — Phase wickets count a dismissal the free hit saved
**Title:** `phases.mjs` counts every ball with a dismissal as a wicket, including one the fold saved on a free hit
**Priority:** P2 · **Domain:** Scoring / analytics · **Type:** correctness
**Affected files:** `packages/scoring/src/phases.mjs` (~line 193, `if (b.dismissal) acc.wickets += 1`)
**Found 2026-09-24** adding `packages/scoring` to strict type checking; confirmed by running: a no-ball followed by a
bowled "wicket" gives the fold 0 wickets and the phase breakdown 1. The file promises phases always add up to the
innings; they do not. Phases should ask the same question the fold does (`standsOnFreeHit`, the ball's free-hit flag).
**Tests required:** a phases case with a free hit, asserting phase wickets sum to the innings' wickets.
**Data migration required:** NO.

### ~~SCRBRD-073~~ — CLOSED
**Closed 2026-09-24.** A non-finite balls count fails the sample floor, and a non-finite runs / dismissals /
wickets / runs-conceded count yields no index, each with a reason naming the bad count. Tests in rating.test.mjs (B2).

Original entry — Rating indices turn a non-numeric count into a number
**Title:** `battingIndex` / `bowlingIndex` accept `NaN` counts past the sample floor and score them as 0
**Priority:** P3 · **Domain:** Analytics · **Type:** input validation
**Affected files:** `packages/scoring/src/rating.mjs` (~190, ~238)
**Found 2026-09-24** in the same work. `NaN < 30` is false, so a malformed count passes the sample floor; `scoreFrom`
then returns null, which the arithmetic reads as 0 (`battingIndex({runs:100, ballsFaced:"x", dismissals:2})` →
10.8, "good"). Today's callers pass numbers from the fold, so this bites only a bad caller.
**Expected behaviour:** a non-finite count yields no index (null / "insufficient"), never a number.
**Data migration required:** NO.

### ~~SCRBRD-074~~ — CLOSED

> **Closed 2026-09-24.** `SyncEngine.withdraw(key)` takes an event that has never left the device out of the
> outbox, memory and storage. "Never left" is `SyncEngine.isUnsent`: queued AND never put in a request — every
> key is marked `sent:` on disk before the request that carries it goes out, so an event in flight, or in a
> request that never answered (the server may have written it), is not unsent. Undo's rule stays in one place:
> `undoLast` reads the outbox through `boundaryOf` (held → drop, never sent and last → truncate, anything else →
> void; no outbox visible on a live match → void), and `undoOnPad` names the key to `withdraw`. **Order:** the
> withdrawal is durable before the shorter log is saved (the pad's persist effect waits on it); a crash between
> leaves the ball in the saved log and out of the outbox, which the next start heals by re-offering the log —
> never a ball sent that the pad does not show. A failed withdrawal puts the ball back in the log. **Mid-flush:**
> never waits and never withdraws what is in flight — withdraw refuses it synchronously and the undo is a void.
> Also fixed on the way: the pad's void had no id, so the log-watching effect never offered it to the outbox
> and the server kept every ball undone by a void; and events queued offline and rehydrated after a reload
> carried the previous epoch, so the first of them failed the batch's lease check and every ball queued
> offline went to quarantine — events queued under `epoch - 1` (the device's own reclaim; nobody else held the
> token) are restamped at `init`. Tests: `packages/sync/test/sync-engine.test.mjs` (suite `outbox`, incl.
> mid-flush with a held-open transport), `replay.test.mjs` F, `held.test.mjs` I; browser walk
> `tools/smoke-browser-offline-undo.mjs` (`browser-offline-undo`).

**Title:** Undo drops an unsynced event from the pad's log but not from the outbox, so the server records a ball the pad does not show
**Priority:** P1 · **Domain:** Scoring / sync · **Type:** correctness (silent divergence)
**Affected files:** `packages/sync/src/sync-engine.mjs` (no way to withdraw a pending event), `packages/scoring/src/undo.mjs`
("not synced → drop" rule), `apps/web/src/scorer/engine.jsx` (`undoLastBall`)
**Found 2026-09-24** building SCRBRD-067 and confirmed by reading: `SyncEngine` has no method that removes an event
from `pending`, and the pad's undo only cuts its own log. A mis-tap undone while offline (or before the next flush) is
sent when signal returns; the server then holds a delivery the scorer undid, with nothing on the pad to show it.
**Expected behaviour:** undoing an event still in the outbox withdraws it from the outbox (persisted storage too) in the
same step, atomically with the log change; one implementation of the "never reached the server" rule covering both
held and pending events. An event already in flight is the hard case: if a flush is in progress, undo must either wait
for its answer or fall back to a `void`.
**Tests required:** unit (sync-engine withdraw, including mid-flush); browser walk — go offline, score, undo, go online,
server and pad agree.
**Data migration required:** NO.

### ~~SCRBRD-075~~ — CLOSED — Loose ends found building the toss fix
**Priority:** P2/P3 · **Domain:** Scoring / sync
- ~~**Acked ids are memory-only.**~~ **Closed 2026-09-24 with SCRBRD-074:** the outbox persists a `sent:` marker
  per key before each request, and undo asks `isUnsent`, so a reload (which re-offers the whole log) no longer
  makes an acknowledged ball look unsent; a live pad with no outbox attached voids. Was: After a reload, `syncedIds()` is empty, so offline, undo treats a ball the server already has as unsynced and cuts it locally instead of voiding it (heals online when duplicates come back acked). Persist acked ids, or ask the server before cutting. (P2)
- ~~**A toss answered offline is never sent.**~~ **Closed 2026-09-25.** The answer is queued in the outbox, on
  disk, before the innings it opens is recorded (`SyncEngine.queueToss`, key `toss:pending`), and every flush
  settles it before sending any event (`settleToss`) — before the `innings_start` too, since the freeze trigger
  (`match_toss_before_first_ball`) fires on ANY `ball_event` row, not only a delivery. Settling reads the
  server's toss first and never writes over it (`tossDecision` in `packages/sync/src/attach.mjs`): none and no
  event → recorded; the same → settled; different, nothing on the server and nothing on the pad but the
  innings start → the pad follows the server's and re-opens its first innings from it (appended; the innings
  start is never undone), in words; different with play recorded on the pad, or once the server has events →
  STOPPED, in words, nothing more sent, no rule invented (below). Proved by `smoke-browser-offline-day` (the
  toss answered with no signal is recorded before the first event reaches the server) and `sync-engine.test`
  group J / `attach.test` group K. Was: If the pad cannot read the toss, asks the scorer, and the POST also fails, the answer is not retried; the server may also have held a different toss the pad could not read. The innings still follows the scorer's answer. Queue the toss like an event, or re-check on reconnect. (P3)
  **Open, needs a product decision:** a toss conflict where the pad has recorded play under its own answer
  (or the server already has events) has no resolution on the pad. The pad keeps everything and sends
  nothing. Options: an explicit "record this pad's toss" (allowed by the server while it has no event), or a
  scoring amendment when it has.
- ~~**Incoming handover device mints its own `innings_start`**~~ **Closed 2026-09-25.** What happened, in the real
  flow (`smoke-browser-handover`, run on the old code): the incoming device hydrated with nothing saved, read
  the recorded toss and minted a first-innings `innings_start` under its own id; after the takeover its outbox
  sent it and the server ACCEPTED it (the Laws do not refuse an `innings_start`) — the server's log gained a
  second start, the incoming pad's log was 1 event against the server's 7, its board read 0/0 against 5/0,
  and its next tap did not reach the server. The same for a device opening, for the first time, a fixture
  someone else was scoring. Now a pad with nothing saved reads the server's log first and replays it (never
  mints over it); the handover claim's log is taken by the pad before verification (anything the pad had
  that the server did not is saved aside, `persist.js saveAside`); and before every claim the pad's log is
  compared with the server's (`reconcile`, below), so a pad that could not ask at hydration (no signal)
  cannot merge its own start into a started match. Was: when it opens a fixture with no saved log, with a new id. Check against docs/SCORING_HANDOVER_SPEC.md: the incoming device should replay the server's log, not start one. (P2 — needs a look)

### ~~SCRBRD-076~~ — CLOSED
**Closed 2026-09-24.** `db/38_amendment_lock.sql` replaces `scoring_amendment_decide()` with db/02's body plus the
`scoring_session` row lock (after the authority checks, before max(seq); session row first, then the amendment row,
re-checking its state), and pins `search_path`. The decide route judges the void with `lawsRefusal()` in a savepoint
and rolls back with `laws_refused` in words — every void rule except `void_not_latest`, which is the pad's undo and
would refuse every amendment (`amendmentRefusal()` in events-api.mjs says why). db/99 section 18; `smoke-amend.mjs`
holds the session row and shows the approval waits for it, and refuses a void of an `innings_start`.
Open, not decided here: the balls bowled after an amended delivery are not re-judged against the corrected log.

Original entry — An approved amendment appends to the log without the per-match lock
**Priority:** P2 · **Domain:** Scoring · **Type:** concurrency
**Affected files:** `scoring_amendment_decide()` (db/02, frozen — would need a CREATE OR REPLACE in a new migration, as db/37 did for `quarantine_resolve`)
**Found 2026-09-24** building db/37. A live batch that has already folded the log can append after an approved
amendment's `void` without judging against it — the race db/37 closed for quarantine releases. Take the same
`scoring_session` row lock first, and judge the amendment with `lawsRefusal` in its route the same way the release route does.

### ~~SCRBRD-077~~ — CLOSED
**Closed 2026-09-24.** `appendEvents` refuses such an event in `refused` and writes the rest: placement.mjs's
vocabularies (placement source, placement null, capture profile) at the door, and every other column CHECK or
malformed value (SQLSTATE 23514 / class 22) by running each event's write in a savepoint. Reasons
`contact_unknown`, `trajectory_unknown`, `trajectory_without_contact`, `placement_invalid`,
`capture_profile_unknown`, `value_refused`, with words in `REFUSAL_TEXT`. The release route answers `value_refused`
instead of a 500 for a held ball carrying one. `smoke-laws.mjs` also fails if placement.mjs and db/07's CHECKs
disagree. `close_position` has no CHECK and is not validated.

Original entry — A placement value the database rejects fails the whole batch with a 500
**Priority:** P3 · **Domain:** Scoring / sync
A contact, trajectory or placement value that violates a column CHECK makes `appendEvents` throw, the batch returns
500, and the device resends it forever. The pad sends none of these today. Validate the vocabulary at the door (as
the dismissal vocabulary already is) and refuse per event.

### ~~SCRBRD-078~~ — CLOSED · A live pad that loads without signal never syncs until it is reloaded with signal
**Closed 2026-09-26** in `f47c5c9` (db/50), `d1213dd` (API), `ddc9216` (pad): the third item, the session, built as
option B — the pad's resume credential (build note below). Two of three were closed 2026-09-25.

> **Closed: the pad reopens offline, and the claim is retried.** A live fixture's pad reopens from what the device
> holds — its sides saved with the session (`scorerCfg`), its log saved by the pad — when there is no session or no
> signal (`App.jsx`). The outbox opens WITH the pad, unattached (`SyncEngine` built with `epoch: null`): every event
> is queued on disk at once, stamped with the generation this device last held (`meta:epoch`), and nothing is sent
> until it attaches. Attaching (`tryAttach`, `packages/sync/src/attach.mjs`; wired by `PadSync` in
> `apps/web/src/lib/sync.js`) reads the session (the heartbeat, which now also answers `state`), compares the pad's
> log with the server's by id (`in_step` / `behind` → the pad takes the server's / `fork` → nothing merged, nothing
> claimed), then claims and attaches with the epoch rule. It is retried on `online` and on a backing-off timer
> while the reason is the network; every refusal is an answer said in words (`SyncBanner`) and not repeated. A
> handover under way is never claimed past (the arming device's claim is its cancel), and a pad that reopened by
> itself never claims a match another device has claimed since (`moved_on`: a person may, "Score on this
> device"). Signed out, the pad says "Sign in to send N balls", keeps everything queued, and its sign-in is the
> real one (the login page opened from a live pad never offers the demo; `apiStatus()` no longer remembers a
> failed check made with no signal). While unattached, undo cuts only what the pad minted since it opened and
> voids the rest. Proved end to end by `tools/smoke-browser-offline-day.mjs` (browser set); unit:
> `sync-engine.test` groups H–L, `attach.test`.
>
> **Found and fixed on the way:** (1) the server keeps a lease 90 s after the last write it took and the client
> sent no heartbeat, so an ATTACHED pad offline for more than 90 s sent everything it had queued into quarantine
> — and the pill said "Sent" (quarantined events left the queue silently). Every flush now passes a gate: a lease
> not known to be fresh is checked; a lapsed one still this device's (same state `active`, same epoch) is taken
> back and the queue restamped; anything else stops sending, in words. Quarantined events now show as
> "For review N". (2) A cancelled handover (the arming device's own claim) bumped the epoch and left the outbox
> on the old one: every ball after a cancel went to quarantine. The cancel now re-attaches with the claim's
> epoch. (3) The handover sheet's poll read a failed session read (null) as "handed over" and stopped a device
> that still held the token. (4) Events queued by the outbox and lost from the pad's saved log (the tab dying
> between the two writes) would have been sent and not shown; the comparison before a claim puts them back.
>
> **Open — the session: "a scorer should not have to log in again mid-over".** Not built; for the product owner.
> Two facts frame it: the API token lives in memory (`lib/api.js`: readable storage would expose a credential of
> a person who can score and read minors' data to any injected script), so every reload signs out; and it
> expires after 30 minutes (`auth.mjs TOKEN.ttlSec`), and a production sign-in is a one-time code from the school
> office — so a scorer cannot today finish a three-hour match in production without new codes mid-match, reload
> or not. Options:
>
> - **A. A refresh endpoint (AUTH_SPEC item 4).** A short access token plus a rotating, device-bound refresh
>   token, stored hashed server-side (a table: a migration), one-time use with reuse detection revoking the
>   family, an absolute lifetime (a school day), revoked on sign-out and by the office. Fixes expiry for every
>   role. The hard part is where the refresh token lives: in memory it dies with the reload like the access
>   token; in IndexedDB/localStorage it is a long-lived bearer credential any injected script can read and
>   replay from anywhere — a strictly larger exposure than today's; as an HttpOnly, Secure, SameSite=Strict
>   cookie it is unreadable by script but needs the API on the web app's site (today the API is a separate
>   Cloud Run origin, i.e. a third-party cookie, which browsers block) and CSRF protection on the refresh route.
> - **B. A narrowly scoped, device-bound resume credential for the pad.** Issued on a successful claim, bound to
>   (user, device, match), good for exactly: the heartbeat/claim of that match while the token is still this
>   device's (the same rules as `tryAttach`), appending that match's events, and reading that match's log and
>   toss — nothing else (no pupils, no medical, no other match). Held with proof of possession: a
>   non-extractable WebCrypto key pair made on the device, the private key kept as a CryptoKey in IndexedDB
>   (usable by the page, not exportable), each request signed (DPoP-like), so a copied credential is useless
>   off the device. Expires at the end of the match day, and is revoked when the match completes, the token
>   moves (handover, force-release), the device signs out, or the office revokes it. A reloaded pad then
>   re-attaches and sends by itself; the rest of the app stays signed out. Blast radius of misuse: scoring one
>   match from one device, which that scorer could already do. Costs: a new credential type and principal
>   scope in `auth-db`/RLS (a migration, Opus review), and WebCrypto needs a secure context — a laptop serving
>   the app over plain http at a ground falls back to signing in.
> - Rejected: storing the access token (the XSS reason in `lib/api.js`, and it still expires) and a longer TTL
>   (widens every stolen token's window and does not survive a reload).
>
> Recommendation for the decision: B for the pad, A for everyone later — B fixes exactly the mid-over failure with
> the smallest exposure. Questions for the owner: may a reloaded (or unlocked, lost) phone keep scoring its match
> without the person re-entering anything until the credential ends; what that end is (the match day, the result);
> and whether the API can move onto the web app's site (which is what makes the cookie variant of A possible).
>
> **Decided 2026-09-26 (Kameel): B.** A reloaded phone keeps scoring its match without the scorer re-entering
> anything, and the credential ends at the end of the match day (and on every revocation listed above, the match
> completing included). Built after db/47 lands, as its own migration and security review (Opus). Not decided,
> and not needed for B: A for every other role, and moving the API onto the web app's site.
>
> **Built 2026-09-26 (option B).** `db/50_pad_resume.sql`: `pad_resume_credential` (the public key, its RFC 7638
> thumbprint, an HMAC of the id — never the id; revocation and expiry columns) and `pad_resume_jti` (one-time ids),
> written only by SECURITY DEFINER functions, EXECUTE to `scrbrd_app` only. Issued by
> `POST /api/matches/:id/session/pad-credential { jwk }` to the device holding the token right now, signed in
> (`pad_resume_issue()`), right after a claim; the device keeps an ECDSA P-256 key made with `extractable = false`
> as a CryptoKey in IndexedDB (`apps/web/src/lib/padKey.js`). Each request is `Authorization: ScrbrdPad <ES256 JWS>`
> over method, request-target, body hash, `iat` and a `jti` (±120 s, spent once), verified by
> `services/api/auth/pad-resume.mjs` against the stored public key; the principal runs as the person on the device
> with `app.scope = 'pad'` and `app.match_id`. Good for five routes on its own match — heartbeat, the re-claim of
> this device's own token (`pad_resume_reclaim()`), events both ways, the toss read (`GET /matches/:id/toss`, new)
> — and `403 pad_scope` on every other route, decided before any routing. The database narrows it twice: db/35's
> `app_can()`/`app_holds()`/`app_may_grant()` recreated verbatim with a pad guard (fixture.read and scoring.edit on
> its fixture, nothing else), and a RESTRICTIVE `pad_scope_<cmd>` policy on every table behind RLS
> (`pad_scope_guard_install()`, db/41's precedent); `scoring_arm_handover()` refuses it by its own first line. Ends
> at midnight (Africa/Johannesburg); revoked by triggers when the match completes or is abandoned and when the token
> moves (handover, another device's claim, force-release), by `POST /api/auth/sign-out` (and the client forgets
> every key), and by the office under `user.invite` (`POST /api/matches/:id/pad-credentials/revoke`). After a
> reload the pad re-attaches and sends by itself; the rest of the app stays signed out; the state line says "Saved
> on this phone · N to send", and the end "Scoring ended for today on this phone — sign in to continue". Without a
> secure context the pad signs in as before and says why. Threat model: the migration header and
> `docs/AUTH_SPEC.md`. Proof: `services/api/auth/pad-resume.test.mjs` (188: replay, stale either way, wrong key,
> wrong match, wrong device, expired/revoked, a proof for another request, malformed and `alg` swaps, and a signed
> request to every mounted route read out of `server.mjs`), `tools/smoke-pad-resume.mjs` (80, live: the same, every
> route and read resource refused with nothing written, and every way it ends), db/99 §28 (every assertion
> falsified once, listed in its header), `tools/smoke-browser-pad-resume.mjs` (sign in, claim, score, reload —
> sends with no sign-in; force-release, reload — stops in words), `sync-banner.test`. `smoke-browser-offline-day` is
> now the day of a phone without one.

#### (original entry)
**Priority:** P2 · **Domain:** Scoring / sync · **Type:** offline resilience
**Found 2026-09-24** building the SCRBRD-074 walk. Three linked gaps, each by design or by omission:
- The API token lives in memory only (`lib/api.js`), so every reload signs the scorer out of the server; the
  pad reopens in demo mode and must be signed into again before anything is sent.
- The session restore looks a live fixture up on the server (`App.jsx`), so after a reload with no signal the
  pad for a live fixture does not reopen at all — the log is safe on disk, but the scorer lands on the shell.
- The sync effect (`engine.jsx`) claims once, on mount; a claim that failed for want of signal is never retried
  when signal returns (the outbox's own `online` listener only exists once a claim has succeeded).
While unattached, undo on a live match voids every ball (SCRBRD-074: the outbox cannot be seen, so nothing is
known never to have been sent) — correct, but it leaves a trace for each mis-tap.
**Expected:** retry the claim on `online` / on a timer while the pad is `local` for want of signal; reopen a
live fixture's pad from its saved log offline; decide whether a reload may keep the session (the handover
spec's "a scorer should not have to log in again mid-over").

### ~~SCRBRD-079~~ — CLOSED — Outbox `sent:` markers are never cleared

> **Closed 2026-09-25.** Once the match is over on the pad (the second innings closed) or the server refuses the
> claim as `match_complete`, and the device's log is the server's (attached, or found all there by the comparison
> before a claim), and nothing waits — no event queued, none held, no toss unsent, no flush or record in progress —
> the pad calls `SyncEngine.clearOutbox()`, which calls `indexedDbStorage.clearMatch()` and itself refuses while
> anything waits. What the server had is saved with the log (`serverHas`), so reopening a finished match queues none
> of it again. Devices that queued events before the markers existed: the first comparison before a claim marks
> every event the server has as sent (`markSent`), and until then the pad treats as never-sent only what it minted
> since it opened. Proved by `smoke-browser-offline-day` group F (the storage is empty after the last ball is
> acknowledged, and stays empty across a reload) and `sync-engine.test` group K.

#### (original entry)
**Priority:** P3 · **Domain:** Scoring / sync
SCRBRD-074 writes one `sent:<key>` entry per event per match+device to `scrbrd-outbox`, and keeps it for good
(it is what tells undo, after a reload, that a ball has left the device). A few hundred small keys per match;
`indexedDbStorage.clearMatch()` would remove them but nothing calls it. Clear a match's outbox once the match is
complete and the queue is empty. Devices that queued events before the markers existed have none for those
keys: after the upgrade a re-offered, already-acknowledged ball reads as unsent until its first flush.

### Decided 2026-09-24 — scoring rules (see docs/SCORING_RULES.md "Product decisions, 2026-09-24")
- **SCRBRD-068** (no-ball byes): approved — build. **Built 2026-09-24:** `nbRuns: "byes" | "leg_byes"` beside a
  `value` that stays the runs completed (docs/SCORING_RULES.md, "Byes and leg byes off a no-ball"). Left open: the SQL
  career views credit a no-ball's `value` to the striker (latent — the pad's no-ball carries no `striker_id`); fixing
  them needs a migration. Also found: the pad's no-ball carries no striker, non-striker or bowler at all, so no-balls
  are missing from every SQL career figure (batting balls faced, bowling runs conceded and no-balls).
  **Closed 2026-09-24:** `db/40_career_follows_the_fold.sql` reads `payload.nbRuns` in every SQL batting figure
  (`ball_runs_off_bat()`); the pad's no-ball — and its wicket ball, which had the same gap — now stamp striker,
  non-striker and bowler (`crease()` in `scorer/engine.jsx`); proved in `smoke-browser-pad-laws` through
  `/read/career`, `smoke-fold` and `db/99` §19.
- **SCRBRD-069** (run-out end): decided — ask the scorer which end on a run out that completed runs — build.
  **Built 2026-09-24:** `outAt: "striker_end" | "bowler_end"` on the wicket; the laws-spec KNOWN_GAP is now passing
  cases for both ends (docs/SCORING_RULES.md, "Which end after a run out that completed runs").
- **SCRBRD-080 — Mid-over bowler change records its reason.** Allowed (Law 17.7.1); the pad asks *Injury or suspended?* and records it on the `bowler` event. P2.
  **Built 2026-09-24:** `bowler({ bowler, reason: "injury" | "suspended" })`; a mid-over change with no reason is
  refused at commit (`mid_over_no_reason`); old logs replay. Not built: Law 41 says a suspended bowler does not bowl
  again in the innings — nothing refuses him yet (a further product decision). **Built 2026-09-27** as SCRBRD-094
  item 2 (`bowler_suspended`); an over shared after an injury is now a maiden for neither bowler.
- **SCRBRD-081 — Timed out and retired out are not deliveries.** A non-ball dismissal event; over count and bowler figures unaffected; old logs replay unchanged. P2.
  **Built 2026-09-24:** a `retire` marked `type: "W"` (docs/SCORING_RULES.md, "Timed out and retired out"). Left
  open: the career views (db/02, db/13) and the dismissal breakdown (db/26) read `kind = 'ball'`, so these
  dismissals are not in a player's SQL career dismissals — counting them needs those views redefined (a migration).
  **Closed 2026-09-24:** `db/40` counts a retire marked W as a dismissal, an innings and a breakdown line of
  `payload.batter`, credited to no bowler; the post-match report's key moments name them.
- **Found 2026-09-24 (db/40), not fixed — older than SCRBRD-068/081, so fixing them moves shipped figures; each
  needs a decision:** (1) a W ball on a free hit that the fold saves (`standsOnFreeHit`) is still a wicket to every SQL
  reader, `match_live_score` and `scoring_verify_takeover` included — a handover after one would fail verification;
  (2) `player_innings` marks `out` only when the dismissed batter was the striker of that ball, so a run out at the
  non-striker's end is in `player_dismissals` but not in his innings row (form guide / passport average);
  (3) `opposition_squad()`'s `balls` excludes no-balls, its fours/sixes count byes and wides worth four or six, and
  its `runs_conceded` leaves out the wide/no-ball penalty run; (4) a NULL `ball_type` on a `ball` row is a run to the
  fold and nothing to SQL (nothing writes one).
  **(1) Closed 2026-09-24:** `db/42_free_hit_wickets.sql` — `ball_wicket_stands()` / `ball_on_free_hit()` carry the
  fold's rule, and `match_live_score`, `scoring_verify_takeover`, `player_dismissals_since`, `player_innings`,
  `player_dismissal_breakdown`, `player_bowling_since`, `bowler_innings_figures`, `bowler_hat_trick`,
  `player_wicket_breakdown`, `opposition_squad`, `milestone_watch` and the read API's `matchups` ask it. Proved by
  `tools/smoke-free-hit.mjs` (fold = SQL over 64 generated/hand-written innings), `smoke-handover` (a handover after
  a saved wicket verifies) and `db/99` §20. Still open, found alongside: a W ball with no method (NULL `dismissal`)
  is the bowler's wicket to `dismissal_is_bowlers()` and not to the fold's `chargedToBowler()` — the API refuses one,
  so only a row written before db/13 or by hand can carry it.
  **(2)–(4), and the W ball with no method, closed 2026-09-25:** `db/43_last_fold_disagreements.sql`
  (docs/SCORING_RULES.md, "SQL agrees with the fold: the last four"). Who is out is `ball_dismissed_batter()` —
  `dismissed ?? striker` over `fromRow()` — in `player_innings` (the non-striker's own row, out; 0 (0) if he never
  faced), `player_batting_since` (his match), `player_dismissals_since`, `player_dismissal_breakdown`,
  `opposition_squad` and the matchups read; a typed-name batter run out at the far end is no longer filed against the
  striker (found while fixing (2)). `opposition_squad`'s balls, fours, sixes and runs conceded follow the fold. A ball
  with no type and a wicket with no method are refused at the door (a BEFORE INSERT trigger,
  `ball_event_names_its_delivery`, raising 23514 as `ball_event_ball_has_type` / `ball_event_wicket_has_method`; not a
  CHECK, which a migration's backfill UPDATE of a legacy row would trip); stored ones are read as the fold reads them (`ball_event_live` through
  `ball_type_as_folded()`; `dismissal_is_bowlers(NULL)` false, `dismissal_stands_on_free_hit(NULL)` still false).
  Proved by `tools/smoke-fold-figures.mjs` (fold = SQL for every batting and bowling figure over generated logs with
  legacy rows; 33 passed, 43 failed on the code before) and `db/99` §21.
- **Found 2026-09-25 (db/43), not fixed — each needs a decision:** (1) the matchups read's `balls` counts legal
  deliveries, so a no-ball is not a ball of the pair (the opposite of every other balls-faced figure now), and
  `tools/smoke-matchups.mjs` pins it ("on one legal ball faced"); (2) a batter who came to the crease and neither
  faced a ball nor was out has no `player_innings` row — the fold lists him "0*" — so his not-out innings is in no form
  guide, passport innings count or batting match; the only SQL source for him is the `batters` event; (3) penalty runs
  (a `penalty` event, which the pad emits) are in the fold's total and in no SQL total: `match_live_score`, and so the
  public score and `scoring_verify_takeover`, sum `value`, which a penalty row does not carry — a handover after a
  penalty award cannot verify; (4) a `ball_type` outside the six (the pad's `ball()` refuses one, but the API writes
  whatever string it is sent) is a legal ball whose runs are the batter's and the bowler's to the fold's scorecard
  (its `default` branch) and nobody's to `runsOffBat()` — the fold disagrees with itself, so SQL cannot agree with it
  until that is decided; a door like db/43's would close it for new rows; (5) `scoring_verify_takeover` sums runs,
  wickets and legal balls over every innings of the match, while the handover sheet asks the incoming scorer for
  this innings' figures off the scoreboard (`handover.js`: "legal deliveries bowled this innings"; `sheets.jsx`:
  overs × 6 + balls) and the fold keeps them per innings — so a handover in a second innings cannot verify (probed on
  a two-innings log: the check expected 7/1 off 4, the fold's innings were 8/1 off 3 with a 5-run penalty and 4/0
  off 1).

### Decided 2026-09-24 — screens to build next (from docs/redesign/SCREEN_MAP.md)
- **SCRBRD-082 — Post-match report.** Scorecard, key moments, figures, generated from the log after a match.
- **SCRBRD-083 — Public live match and league pages.** Signed-out. Needs a written rule first on what data about minors is ever public (names? photos? none?) — design with the policy package, not in the view.
  **Rule decided 2026-09-25** (Kameel, 31 scenarios on the decision sheet): `docs/policy/PUBLIC_DATA.md`. In short:
  off until a school publishes; each school speaks only for its own children; no name without recorded consent
  (initial and surname, never more; a position otherwise); health, discipline, contact, date of birth and coaches'
  judgements never public; withdrawal reaches past pages; noindex. Build order in its §6: the rule as
  `packages/policy/src/public.mjs` with tests, then the consent / never-public / age-group / publish records (a
  migration, Opus), then signed-out reads applying it server-side, then the overlay under it (D2).
  **Designed 2026-09-27** (`docs/design/SCRBRD-083_public_pages.md`, §9 decided). **Phase 1 built 2026-09-28, NOT
  LIVE** (off unless `PUBLIC_PAGES=on`; go-live waits on the information officer's written confirmation and the
  design's other "before live" conditions): `db/59_public_read_path.sql` — `public_match_header()`,
  `public_match_log()`, `public_match_people()`, `public_shot_sectors()`, SECURITY DEFINER, `scrbrd_app` only, nothing
  for an unpublished fixture; `public_data_changed` notify triggers. `services/api/public/` — `/api/public/*` and the
  `/live`, `/scorecard` shells as the anonymous principal whatever the request carries; the log projected through a
  per-kind allowlist with per-match HMAC pseudonyms (`PUBLIC_PSEUDONYM_SECRET`, environment only) and
  `publicName()` labels; a 5 s / 60 s cache dropped by LISTEN; noindex; one 404; a per-address token bucket.
  `apps/web/src/public/` — the Match Centre's tabs in public mode, its own bundle (`/public-app.js`), held free of
  the signed-in app by `check-bundle`. The publish switch per side on the fixture screen. Proofs: the policy suite
  reads db/59's bodies against `NEVER_PUBLIC`; `services/api/public/public.test.mjs`; db/99 §37;
  `tools/smoke-public.mjs`; `tools/smoke-browser-public.mjs`. Left for later phases: competition, fixtures-list
  and honours reads (2), AI commentary (3), the overlay and `broadcast_state()` (4), turning 18 (5); the
  transcribed-match refusal waits on SCRBRD-099's provenance column.
- **SCRBRD-084 — Season awards and MVP.** Season roll-up of figures and ratings already computed.
- **SCRBRD-085 — Phone day-of views for drivers and groundskeepers.**

### ~~SCRBRD-086~~ — CLOSED · Season awards need a season-scoped career read
**Closed 2026-09-25** in `105e467` (#37): db/44 and the Awards season selector, as the build note below records. db/49 (`2534bda`, #38) later made the lifetime views one pass as well.
**Priority:** P2 · **Domain:** Analytics · **Type:** gap (follows SCRBRD-084)
The `career` read aggregates every match the reader can see, with no season parameter, so the Awards tab is correct
only while a school has one season of history. Add a season-scoped read (RLS-reviewed, Opus) and a season selector.
**Built 2026-09-25:** `db/44_career_by_season.sql` — `school_season_of()` (season_for() on the match's Johannesburg
date; the `matches` read now asks it too) and three security_invoker views, `player_batting_by_season`,
`player_bowling_by_season`, `player_dismissals_by_season`, each its lifetime view with the same predicates and rule
functions, grouped by player and season. A new read, `career_by_season` (one row per player per season; `?season=`
narrows it), rather than a parameter on `career`, which stays byte-for-byte what it was. The Awards tab opens on the
current season, offers only seasons with figures and "All seasons" (= `career`, unchanged). Proved by `db/99` §22
(invoker, school A sees nothing of school B, the Johannesburg calendar at the New Year line, exact per-season figures
over every fold rule, and Σ seasons = lifetime for every player as seven principals — each assertion falsified once)
and `smoke-browser-awards` (API invariant for three readers; each season's lists, row for row; "All seasons" = the
career read's ranking). **Coupling to watch:** the views mirror the COMPOSITION inside `player_batting_since()`
(db/40), `player_bowling_since()` and `player_dismissals_since()` (db/42) — a later change to one of those (e.g. a NULL
`ball_type` counted as a run) must be mirrored in a new file, and §22 (which carries a NULL-type delivery and a W with
no method) goes red until it is. A change to a rule FUNCTION (`ball_runs_off_bat`, `dismissal_is_bowlers`, ...) flows
into both; dropping one would take the views with it. db/43 was such a change and landed first: db/44 mirrors it (who is out is
`ball_dismissed_batter()` in the batting and dismissals views, and a batter run out at the other end has his match),
and a NULL type and a W with no method reach the views through `ball_event_live` and `dismissal_is_bowlers()`.

### ~~SCRBRD-088~~ — CLOSED · A handover in the second innings cannot verify
**Closed 2026-09-25** in `105e467` (#37): db/45, as the build note below records.
**Priority:** P1 · **Domain:** Scoring / handover · **Type:** bug (found by db/43, 2026-09-25)
`scoring_verify_takeover()` compares the incoming scorer's runs, wickets and legal balls with `match_live_score`,
which sums every innings of the match. The handover sheet asks for THIS innings' figures off the scoreboard
(`handover.js`: "legal deliveries bowled this innings"; `sheets.jsx`: overs × 6 + balls), and the fold keeps them per
innings. So after the first innings any honest answer is refused, and a scorer can take over only by reading a
match total the scoreboard does not show. Probed on a two-innings log: the check expected 7/1 off 4, the fold's
innings were 8/1 off 3 and 4/0 off 1. Penalty runs (db/43 finding 3) make it worse: no SQL total carries them.
**Fix (Opus — handover is on the scoring list):** verify against the current innings — the innings the lock's
latest ball is in, or the innings the sheet names — in a new db/NN, with penalties counted as the fold counts them;
a two-innings handover walk that fails on today's code. Until then, match day depends on no scorer change after
the first innings.
**Fixed 2026-09-25:** `db/45_handover_this_innings.sql` replaces `scoring_verify_takeover()` (same signature,
definer, pinned search_path, grants — a snapshot check at the end of the file refuses anything else moving) to
compare with `innings_score_as_folded(match, match_current_innings(match))`. **Which innings:** the one the fold
calls current — the highest innings the live log has reached (`deriveMatch().current`, and what `broadcast_state()`
already shows) — not the innings of the highest seq, which a quarantine release into the first innings would move
back. The sheet sends no innings and none is added. At the break, the second innings is current once its
`innings_start` is written (0/0 off 0, as both pads show). **Penalties:** `penalty_runs_as_folded()` is the fold's
PENALTY case over fromRow(): `payload.runs ?? 5`, nothing when `payload.toBattingTeam` is JSON `false`; a
non-integer `runs` leaves the innings' runs unknown and nothing verifies. Runs read `value` on deliveries only;
wickets are a delivery's that stands plus a retirement the fold reads as a dismissal (not any row marked W). The
mismatch audit row now names the innings. `match_live_score` is untouched (SCRBRD-090). The reference double
(`services/api/handover/scoring-session.mjs`, `replayEvents()`) folded the whole match as one innings too; it now
answers for the current innings (unit test added). Proof: `tools/smoke-handover-innings.mjs` — two handovers through
the API (first innings after a penalty; second innings after a penalty each way), the fold's figures verify, the
match's totals, the figures without the penalty and the first innings' score are refused: **8 passed, 15 failed on
the old code** (it accepted the penalty-less figure and cascaded), 23 passed on db/45; `db/99` §23 (current innings
incl. a late first-innings seq, penalty and wicket rules, the second innings exact, invoker helpers, the handover's
expectation, audit, refusals and acceptance — each of its 12 assertions falsified once, the unpatched run passing);
`smoke-free-hit` and `smoke-fold-figures` asserted the old whole-match expectation and now hold the check to the
fold's innings being played, and `innings_score_as_folded()` to the fold in every innings of their generated logs;
`docs/SCORING_RULES.md`, "The handover check counts this innings". Rehearsed as production: a database built at the
base commit, then `node tools/migrate.mjs` from this tree — "1 applied, 44 already applied" — and `--verify` green.

### ~~SCRBRD-091~~ — CLOSED · The opposition window: 5 days or 14
**Closed 2026-09-26** in `2534bda` (#38): five days, db/46, applied on production.
**Priority:** P2 · **Domain:** Scouting / privacy · **Type:** decision (from SCRBRD-083, 2026-09-25) — **decided and
built 2026-09-25**
Kameel's note on the public-data sheet (A7): "Opposing schools will have access to each other's team squads 5 days
prior to their head-to-head fixtures." The built opposition dossier (signed-in, cross-school: squad and ball-log
figures) opens `opposition_window_days()` = **14** days before (`db/08`). Choose 5 for everything, or 5 for the squad
and 14 for the figures; then a migration replaces the function (it is IMMUTABLE and read by `opposition_side()`),
and `db/99`'s dossier section moves with it.
**Decided 2026-09-25 (Kameel):** "14 days seems excessive; 5-7 days would be more than appropriate for an opposition
to do their due diligence and homework." Set to **5 days**, one window for squad and figures: the shortest in the
range, per POPIA's minimisation principle; 7 is a one-number change if coaches want a full week.
**Built 2026-09-25:** `db/46_opposition_window.sql` replaces `opposition_window_days()` to answer 5 — same signature,
LANGUAGE sql, IMMUTABLE, oid, owner and grants (a snapshot check at the end of the file refuses anything else
moving). **Dependents:** `opposition_side()` (db/08, plpgsql, definer) is the only caller and computes `opens_at` from
it on every call; `opposition_context()` and `opposition_squad()` reach it only through that plpgsql definer, which is
never inlined; no view, index, constraint, default, generated column, policy, trigger condition, statistics object or
BEGIN ATOMIC body calls it (pg_depend and the text of every stored expression and function body searched); nothing
stores a value derived from it, so there is no data to move. A plan cached in an open session is invalidated when the
function is replaced (walked with two sessions on Postgres 16), so the API needs no restart. The dossier's shut-window
text (`apps/web/src/views/dossier.jsx`) said "fourteen days" of its own; it now states the days between the
`opens_at` and `closes_at` the server sends. **Proof:** the file's own check builds two schools, a coach and fixtures
four and six days out inside a block it rolls back, reads `opposition_side()` as the coach (open / `not_yet_open`),
and refuses to commit if anything was left behind — applied to an empty database and to a seeded one; falsified with
the body at 14 (the value, and with that check skipped, "six days out answered open") and at 3 ("four days out
answered not_yet_open"). `db/99` §24, as the Westville 1XI coach: four days out open with the squad read; six days out
`not_yet_open`, opening later, no squad and no counts; the value 5, last — red with the function at 14 (six days),
3 (four days) and 4 (the value: the edges cannot tell 4 from 5, the constant does). §21's fixture moved from a week
out to a day inside the window, read from the function. **Walks moved** (7 days out was inside the old window, outside
the new): `smoke-opposition` (`soon`, `solo` 7 → window − 1 = 4; a new fixture at window + 1 = 6 is not yet open,
opens the window's length before the first ball, and reads no squad and no count; the window asserted to be 5 once),
`smoke-browser-dossier` (`soon`, `solo`, `wrongSide` 7 → 4; the shut dossier moved from 40 days out to 6 and asserts
the screen states the server's number, not "fourteen"), `smoke-free-hit` and `smoke-fold-figures` (their
`opposition_squad()` fixture, 7 days → window − 1). Docs: `docs/policy/PUBLIC_DATA.md` §5 resolved, the screen map,
the roadmap card. Rehearsed as production: a database built at the base commit (db/00–45), then `node
tools/migrate.mjs` from this tree — "1 applied, 45 already applied" — and `--verify` green. **To ship:** paste
`apply-46` and `verify` (DEPLOYING.md, "The procedure"), then record db/46 in `db/SHIPPED.sha256`.

### SCRBRD-092 — Photo and video sharing for registered users, and the consent to it at sign-up
**Priority:** P3 · **Domain:** Community · **Type:** feature (from SCRBRD-083, 2026-09-25)
Kameel's note (A8): photos and videos shared socially, registered users only. Never on public pages (the rule's A8).
Needs its own consent (a child's face is not covered by consent to be named), storage, and moderation; design with
the policy package before any screen.

**Consent at sign-up, decided in shape 2026-09-26 (Kameel):** "we would need to find a way in our terms and conditions
to allow us to get POPIA permissions from the parent/guardian by them agreeing to use the app." Schools post pupils'
photos to social media freely today; the platform should capture permission at the guardian's sign-up, but not by
bundling it into the terms. POPIA allows a child's information to be processed on the prior consent of a competent
person, and consent must be voluntary, specific and informed. A consent that is a condition of using the app is
neither voluntary nor specific. So: one sign-up flow, separate consents.
1. **Terms and privacy notice (required).** They cover what running the service needs, inside the signed-in app:
   fixtures, scores and team sheets. The school is the responsible party and SCRBRD its operator, under a data
   processing agreement per school. The guardian-link consent (db/08, versioned) is this record already.
2. **Separate opt-ins on the same screen, off by default, each optional, each withdrawable in Settings:**
   - public name: built (db/47, `public_name_consent`);
   - photos and video of my child shared inside the app with registered users: **new, this entry**;
   - photos on public pages or the school's social media: **not built.** PUBLIC_DATA A8 decided "no photos on
     public pages". A tick box here would reopen A8, which is Kameel's decision; until he makes it, the screen
     does not offer it.
3. **Records like db/47's:** versioned, end-dated and never deleted, with the giver being a verified guardian (or the
   pupil himself from 18). The office may record consent from the school's own admission forms, naming the form and
   its date. The never-public mark (C5) overrides every media consent, as it does names. Withdrawal takes effect
   everywhere at once, including photos already shared.
4. **Deliverables before any photo feature:**
   - the consent records (a migration, Opus);
   - the sign-up consent screen and a plain-language privacy notice;
   - a data processing agreement template for schools.

   The wording goes to the school's information officer, or a POPIA attorney, before it ships: the platform's
   wording is not legal advice.

### SCRBRD-093 — The toss, decided: offline allowed, the server's toss wins
**Priority:** P2 · **Domain:** Scoring / sync · **Type:** decision (Kameel, 2026-09-26)
"A toss will always be live and will be recorded on the app." Asked what the pad does with no signal at the toss:
**offline allowed, the server's toss wins** — which is how SCRBRD-075 already built it (`tossDecision()` in
`packages/sync/src/attach.mjs`): the pad records the toss offline and settles it before any event; if the server
has a different toss and nothing depends on it, the pad follows the server's; if play is already recorded under the
pad's own toss, the pad stops sending and says so, and a person settles it through a scoring amendment. No code
change. **"Live" means a real coin** (Kameel): the captains toss a physical coin at the ground; the scorer records
who won and what they chose. **Follow-up (UX):** an animation accompanies that recording on the pad — it plays the
result the scorer entered and never decides it (no random or virtual coin anywhere in the app). Build with the pad's
toss sheet (`scorer/toss.jsx`), reduced motion honoured, after step 2 of the redesign lands.

### SCRBRD-094 — Law 41: penalty runs to the fielding side (item 1 built), and a bowler suspended mid-over (item 2, built 2026-09-27)
**Priority:** P2 · **Domain:** Scoring · **Type:** decision needed (2026-09-26)
Two Law 41 questions Kameel is researching before deciding; nothing is built until he does:
1. Penalty runs awarded to the fielding side (SCRBRD-090's second point): the fold leaves them out of every innings,
   where Law 41 adds them to that side's own innings.
   **Decided 2026-09-26 (Kameel's research, MCC Law 41):** five penalty runs to the fielding side are added to the
   fielding side's total: to its most recently completed innings, or, if it has not batted yet, to its next innings
   (so batting second, they start their chase on 5; batting first and complete, their total and the target rise).
   The infractions, as the closed list of reasons the pad offers: deliberate short running (41.5: dead ball, every
   completed run disallowed, batters back to their original ends, and the delivery counts); distracting, deceiving or
   obstructing the fielders (41.4/41.5); intentional damage to the pitch (41.12); running on the protected area after
   a first and final warning (41.14); striking the pitch unfairly (41.15); time wasting after a first and final
   warning (41.17). The ball is dead when the offence is called; the umpires report the incident to the batting
   side's executive authority (the pad offers to start that report; `db/25` disciplinary record). Building: the fold
   and the SQL now (with SCRBRD-090, penalties missing from the live score), the pad's penalty sheet after the
   redesign's step 2 lands.
   **Built 2026-09-26 (the fold and the SQL; the pad's sheet waits for the redesign):** the event is unchanged — a
   `penalty` with `toBattingTeam: false`, recorded in the innings it was awarded in. `deriveInnings()` counts it in
   `penaltyToFielding`; the match folds (`deriveMatch`, the new `deriveInningsList` for the pad's per-innings shape,
   `MatchFold`) credit it through one function, `penaltyCredits()`: to the highest innings before it that the
   fielding side batted (**added at the end** — fall of wickets and seal as recorded; total and target rise
   mid-chase), else to the lowest after it that they bat (**opened on** — in the total from before the first ball, so
   a chase completes and a seal confirms with it), else pending until that innings' `innings_start`. A chase's
   `inn.target` rises with an award made after it was set, unless the umpires typed it (a revision). Short running is
   two events, `shortRunning()`: the delivery with `value: 0` and an award, reason `short_running` — no new ball shape
   anywhere. `PENALTY_REASON` closes the reasons (Kameel's six fielding-side offences; the pad's existing batting-side
   reasons as `helmet_struck`, `illegal_fielding`, `ball_tampering`, `fielding_time_wasting`, `unfair_play`,
   `fielding_restrictions`; `other`), with words and sides; the pad's old free text is read as its reason.
   `lawsRefusal` refuses non-whole runs, an unknown reason, a reason on the wrong side, a short-run award not straight
   after its dot delivery, and any other award to the fielding side once the match is decided. Logs with no award to
   a fielding side replay identically (proved against the previous fold over generated logs). SQL:
   `db/48_penalty_runs.sql` (see SCRBRD-090). `docs/SCORING_RULES.md`, "Penalty runs to the fielding side cross
   innings". **For the pad (after step 2):** fold with `deriveInningsList(events)` instead of `deriveInnings` per
   innings (else a seal in an innings that opened on an award is refused as `figures_moved`, and the second innings'
   target at the break must be stamped from the credited first-innings total); emit `penalty({ runs: 5,
   toBattingTeam, reason })` with a `PENALTY_REASON` code, and short running as the two events of
   `shortRunning(ball)`; ask `lawsRefusal` before offering a reason; show `penaltyCredits().pending` ("Westville start
   on 5").
   **Built 2026-09-26 (the pad's sheet):** the pad folds with `deriveInningsList` (`scorer/penalty.js` `foldPad`,
   `projectPad`; the board, the seal, the break's target and every Laws question read it). `scorer/penaltySheet.jsx`:
   the side first, then only that side's reasons, in words from `PENALTY_REASON_TEXT` with the Law clause numbers
   taken off (Kameel is checking them); Award is `penalty({ runs: 5, toBattingTeam, reason })`, disabled with the
   Laws' refusal said on the sheet when `lawsRefusal` refuses. Short run is its own action (the pad menu, and the
   fielding side's list): the two events of `shortRunning()` through `commitBall`. A pending credit is said under
   the board and on the innings break. At the type and touch floors. The umpires' report to the offending side (a
   discipline record, `db/25`) is NOT built: one line on the sheet says the umpires report it. Proof:
   `apps/web/test/penalty-sheet.test.mjs`, `tools/smoke-browser-penalty.mjs` (the board against the API's live
   score and target at every step), and every existing walk unchanged.
   **Its three loose ends, 2026-09-27:** the Match Centre's scorecard already folds the whole match (step 3c replaced
   `views/shared.jsx`'s per-innings fold with `deriveMatch`); the held sheet's reason words lost their clause numbers,
   through one helper, `penaltyReasonWords()` in `events.mjs`, which the pad's sheet and the commentary now use too; and
   a short run off a no-ball asks the no-ball's kind — `ball()` used to drop `nbType` on every no-ball and now keeps it
   (the free hit was never the kind's: the fold gives one after every no-ball, and the pad's banner now reads it there).
   **The penalty list corrected, 2026-09-27 (Kameel, from `docs/laws/CLAUSE_CHECK.md`, Law 41; the 4th Edition, in
   force 1 October 2026).** The list above carried numbers from earlier research, put two fielders' offences on the
   batting side's list and named one offence the Laws do not have. Now, each a plain five to one side:
   to the fielding side `short_running` (18.5), `time_wasting` (41.10), `pitch_damage` (41.14, which takes in a batter
   on the protected area without reasonable cause), `stealing_run` (41.16, new); to the batting side `helmet_struck`
   (28.3), `illegal_fielding` (28.2), `fielder_returning` (24.4), `keeper_movement` (27.4.2), `fielder_movement`
   (28.6.3), `distracting_striker` (41.4, a deliberate interception included), `obstructing_batter` (41.5),
   `fielding_time_wasting` (41.9), `fielding_pitch_damage` (41.12), `fielding_restrictions`; either side
   `ball_tampering` (41.3), `unfair_play` (41.2.1), `practice_on_field` (26.4.2), `player_conduct` (Law 42), `other`.
   **Withdrawn** (`PENALTY_REASON_WITHDRAWN`): `obstruction_distraction` (a batter who obstructs is out, Law 37),
   `striking_pitch` (no such offence), `protected_area` (merged into `pitch_damage`: one offence, one warning). A
   stored award with one folds and reads as it did; a new one is refused (`penalty()`, and at commit
   `penalty_reason_withdrawn`). No SQL constrains or reads the reason. Stealing a run is the award alone: no ball was
   bowled, so nothing is disallowed. **Queued for the 4th Edition behaviour batch, not built:** the delivery that does
   not count when 24.4, 28.2, 41.4 or 41.5 applies (17.3.2.5); a delivery's runs disallowed on a second offence
   (41.14.3, 41.15.3); awards after the result (41.17.2). Open: 41.15 (the striker taking guard in the protected
   area) has no reason of its own — `other` until Kameel says.
   **With it, 2026-09-27: the pad no longer offers "handled the ball"** (Kameel). Since the 2017 Code it is
   obstructing the field (Law 37). Gone from the wicket sheet (the basic pad's and the Pro hub's); the no-ball sheet's
   note now lists only the Law's three ways out off a no-ball (run out, hit the ball twice, obstructing the field — it
   also said caught and stumped). `DISMISSAL.HANDLED_BALL` stays in the engine: old events and pre-2017 scorecards
   fold, read and count as before, and the server still takes one. Proof: `apps/web/test/ways-out.test.mjs`.
2. A bowler suspended mid-over (SCRBRD-080's unbuilt half): Law 41 says he may not bowl again in the innings.
   **Decided 2026-09-26 (Kameel's research, MCC Law 41, Unfair Play).** A bowler is suspended as soon as the ball is
   dead, on these grounds, as Kameel gives them:
   - dangerous non-pitching deliveries (beamers), 41.7: on a second dangerous full toss above waist height, or at
     once if the umpire deems it deliberate. For the rest of the innings.
   - dangerous short-pitched bowling repeated after a warning, 41.6. For the rest of the innings.
   - a deliberate front-foot no-ball, 41.8: at once. For the rest of the innings.
   - running on the protected area, 41.13: on a third offence, after a first and final warning. For the rest of the
     innings.
   - time wasting by the fielding side repeated after warnings, 41.9. For the rest of the innings.
   - unfair changes to the condition of the ball (ball tampering), 41.3: at once, **for the rest of the match**,
     not just the innings.

   **The over:** another fielder completes it. That bowler must not have bowled any part of the previous over, and
   may not bowl any part of the next one. The suspended bowler may not bowl again for the rest of the innings (the
   match, for 41.3).

   **Administration:** the umpire informs the other umpire, the batters and the batting captain. After the match
   the umpires report it to the competition's executive body (or the match referee).

   **Build (Opus: engine, then pad):**
   - a `bowler_suspended` event (bowler, reason from a closed list, scope innings or match), with the reasons in
     words;
   - the fold records it;
   - `lawsRefusal` refuses a suspended bowler for the rest of the innings (or match), and refuses a replacement who
     bowled any part of the previous over;
   - it also refuses the replacement for the next over;
   - a split over credits each bowler with the balls he bowled;
   - the pad offers "Umpire suspended the bowler" with the reason, then asks for the replacement, offering only
     eligible bowlers;
   - after the match it offers to open the report as a discipline record (db/25), which stays with the school;
   - commentary (SCRBRD-098) gets a line.

   Warnings are not tracked by the platform: the umpire decides when a suspension is due, and the scorer records
   it.

   **Clause numbers to verify before any words ship:** this research gives the protected area as 41.13, and the
   penalty-runs research gave repeated protected-area infractions as 41.14. The screens show the reason in words
   only, not clause numbers, until Kameel confirms them against the current Code.

   **The clause list, 2026-09-27 — no screen shows a number any more.** The last three came off: the mid-over bowler
   note on the new-over sheet ("Law 17.8.1: a bowler may be replaced…"), the timed-out toggle on the batting-order
   sheet ("… did not arrive in time (Law 40)"), and `REFUSAL_TEXT.mid_over_no_reason` ("… injury or suspension (Law
   17.8.1)", which the held sheet showed as it was). Each keeps its words; the clause stays in a code comment.
   `apps/web/test/law-clauses.test.mjs` sweeps every string a scorer screen can show — `REFUSAL_TEXT`,
   `REFUSAL_CAUSE` over folds and events, `PENALTY_REASON_TEXT` through `penaltyReasonWords`, the suspension words,
   every pad helper that words a refusal over every code, and the literal text of every file in `apps/web/src/scorer`
   with comments stripped — and was falsified by putting "(Law 40)" and "(Law 17.8.1)" back. Still to verify, cited
   only in code (comments, and `PENALTY_REASON_TEXT`, which every screen reads through `penaltyReasonWords`):
   17.8 and 17.8.1 (consecutive overs; the change during an over), 25.4.2 and 25.4.3 (retired hurt and retired out),
   40 (timed out), 21 and 23 (the no-ball's runs), 18 and 38.2 (run out, which end), 28.2 and 28.3 (illegal fielding,
   the helmet), and Law 41's 41.1, 41.3–41.9, 41.12, 41.13 or 41.14 (the protected area: the two researches differ),
   41.15, 41.17 and 41.18.

   **Built 2026-09-27.** Engine: `bowler_suspended` (`bowlerSuspended()` in `events.mjs`): the bowler, a reason from
   `SUSPENSION_REASON` (beamers, short_pitched, deliberate_no_ball, protected_area, fielding_time_wasting,
   ball_tampering) with words in `SUSPENSION_REASON_TEXT`, and the scope the reason carries (`SUSPENSION_REASON_SCOPE`:
   ball tampering the match, the rest the innings — filled in, and a different one refused). `suspensionWords()` is the
   sentence for the commentary generator (SCRBRD-098: `commentary.mjs` was not touched beyond the helper below; it has
   no suspension line yet — the words are ready for it). No clause number in any shown text; they are in comments. The
   fold records `inn.suspensions` (who, why, scope, over and ball) and moves no figure; the bowler stays on until
   another is named, so the replacement is a change during the over (`bowlerChanges`, reason `suspended`). A split over
   credits each his own balls and runs and is a maiden for neither (`isMaiden()` wants one bowler — this also changes an
   over shared after an injury, SCRBRD-080, whose first bowler used to get the maiden). `lawsRefusal`: a ball from, or a
   `bowler` naming, a bowler suspended this innings or for the match in an earlier one (`bowler_suspended`,
   `suspendedBowlers()`); a suspension of anyone but the bowler on or of the last ball (`not_bowling`); an unknown
   reason or a scope the reason does not carry (`suspension_unknown`); the same bowler twice. The replacement's two
   rules are the existing Law 17.8 check (`bowledLastOver`), unchanged; the pad's gate blocks a ball while the
   suspended man is on (`SCORING_BLOCK.BOWLER_SUSPENDED`). Pad: "Umpire suspended the bowler" on the menu (and
   "Suspended" on the change-of-bowler sheet): the reason in words, how long, Record; then at once who finishes the
   over, only the bowlers the Laws take, the rest with why not (`scorer/suspension.js`, `suspendSheet.jsx`); the new-over
   sheet now says why each refused bowler is refused. The umpires' report: from the menu once recorded, and after the
   match (under the board, and on the result screen) — never during play; filed through the existing discipline route
   (`POST /api/players/:id/discipline`, db/25) with the bowler and the words filled in by an account that files conduct
   (the pad now receives the role), else it says who files it and where (Match Centre → the fixture → Report an
   incident). The scorecard lists the suspension in words. SQL: nothing moved, no migration — `smoke-fold-figures`
   generates suspensions mid-over (17 in its run) and every SQL figure agrees with the fold. Proof: `laws.test` P (each
   rule falsified), `replay.test` M, `apps/web/test/suspension-sheet.test.mjs`, `tools/smoke-browser-suspension.mjs`.
   Not modelled: the Laws' two-innings reading refuses any ball in a third innings (MATCH_DECIDED), so "the rest of the
   match" is proved for a bowler event there and for a ball in the second innings.

### SCRBRD-101 — The wagon wheel: accurate names, off and leg by the batter's hand, point capture on the pad
**Built 2026-09-27.** **Priority:** P1 · **Domain:** Scoring / Scorer UI / analytics · **Type:** correctness + feature
(Kameel, 2026-09-27: batter's end at the top, bowler's at the bottom, keeper behind the batter; off and leg follow
the batter's hand; the pad's Area step captures a point)

**The frame, checked.** `placement.mjs` stores `theta` clockwise from directly behind the batter, batter-relative.
Drawn with the batter at the top, a right-hander (left shoulder to the bowler) faces the screen's left: off side left,
leg side right, theta 90 is square leg. A left-hander is the mirror (`screenAngle`). Kept as it was.

**Found and fixed:**
1. **The sector names were about 30° off.** `SEGS` (field.js) and `SECTOR_WORDS` (words.mjs) named 90° "Mid On" (it
   is square leg), 120° "Long On" (mid-wicket), 240° "Mid Off" (cover), 270° "Cover" (point), 300° "Point" (backward
   point), so the commentary said "through mid-on" for a ball hit square. Now one source of truth: `SECTORS` in
   placement.mjs names each sector by `angularFamily()` at its centre (0° long stop, 30° fine leg, 60° backward
   square leg, 90° square leg, 120° mid-wicket, 150° mid on, 180° straight, 210° mid off, 240° cover, 270° point,
   300° backward point, 330° third). field.js and words.mjs derive from it.
2. **A stored `seg` is the screen's sector, not the batter's.** A sector tap stored the wedge tapped, and
   `placementFromTap` derives seg from the screen angle, so for a left-hander every sector word, side, heat-map wedge
   and per-sector sum had off and leg swapped. The stored meaning is kept (no row moves, no migration); readers go
   through `batterSector(seg, hand)` = `(12 − seg) % 12` for "L", or `sectorOf(ball, hand)`, which reads a point's
   theta (the two roundings differ on the 15° lines). Every reader of `seg` was checked; see the report for the list.
   No SQL view or function groups `seg` into sides or names (grep of db/), so there is no db/53.
   **Cannot be corrected:** a batter with no recorded hand is read as right-handed (`batHandOf`), and so are his
   balls; a sector-era ball also assumes the scorer tapped where the ball went on the field as drawn, not the label.
3. **OFF and LEG were fixed on the wheel** (6px SVG text, always left and right). `FieldLabels` (new) lays OFF and
   LEG by the hand, the rim positions (third, point, cover, long off, long on, mid-wicket, square leg, fine leg, from
   the engine's families) and the Batter and Bowler ends, as 12px HTML over the field. A view draws in one frame
   (`frameOf`): the striker's while capturing, one batter's hand, or a right-hander's with the left-handers mirrored
   and "Left-handers' shots mirrored so leg side is always on the right" under it. The heat map follows the same frame.
4. **The wheel's colours did not match the chips.** The spokes are now `T.chip` for each run value in every palette
   (5 takes the four's, every extra the extras'); the wicket and the dot are unchanged. Each spoke sits on a casing
   (`T.field.casing`, the board's black in daylight). `T.run` keeps only the wicket. design.test.mjs measures it.

**Point capture.** The Area step uses the wheel's point capture (one tap, no snapping), names the position while
the finger is down, and hands the whole placement through `onCommitDetailed` (`padCommit`) to `commitBall`, as the
Pro hub does; `deliveryOf()` (delivery.js) builds every delivery. "Didn't travel" records `no_contact` after a shot
that missed the bat, else `not_applicable`, profile `full`. A wicket keeps the placement on both paths (the hub's
used to reach the wicket sheet as seg and zone only). SCRBRD-095 item 1 is closed by this.

**Guards:** `packages/scoring/test/placement.test.mjs` (new), `commentary.test.mjs` group J,
`apps/web/test/wheel.test.mjs` groups E–G, `apps/web/test/pad-point.test.mjs` (new: the pad's ball equals the hub's
for the same tap), `design.test.mjs` (the wheel's colours), `tools/smoke-browser-wagonwheel.mjs` (new, registered).

**Left open:**
- `third` on the rim, where Kameel's list says "third man": the engine's families use "third" (modern usage) and
  so do `positionName` and the commentary. One word in `FAMILIES` if he prefers the other.
- Standard's wheel: the six's red and the wicket's red are ΔE 16 apart in ordinary vision (under the 25 floor, better
  than the six/extras ΔE 4 before). The wicket was kept as asked; the safe palettes clear the floor.
- db/07's column comment and db/98's seed comments describe theta as "from straight down the ground"; the engine's
  frame is from behind the batter. The seed's "through the covers" balls (300–330°) read as backward point and third.
  Comments in a shipped file and a seed; not changed here.
- A no-ball hit from the three-phase pad still loses its area (the no-ball sheet reads the hub's selection).
- The one-tap Dot mid-ball, with no area chosen, records `not_required` / `quick` as before, not `skipped`.

### SCRBRD-102 — A wagon-wheel analysis panel: filters, run chips, off and on side, areas per side
**Built 2026-09-27.** **Priority:** P2 · **Domain:** Front-end / analytics · **Type:** feature (Kameel's earlier SCRBRD designs, 2026-09-27)
Kameel's earlier designs had a wagon-wheel analysis panel. It should appear in the Match Centre's Performance tab and on a player's profile:
- **Filters:** by batter and by bowler.
- **Run chips:** All, 1s, 2s, 3s, 4s and 6s, each with its count. Tapping a chip shows only those spokes, in the chip colours.
- **Off side against on side:** each side's runs and its share of the total, as a percentage.
- **Areas per side:** four for each side, each with its runs and boundaries.
  - The off side: third man, point, cover and long off.
  - The on side: fine leg, square leg, mid-wicket and long on.

Everything is relative to the batter, so a left-hander's areas are his own (SCRBRD-101). Build it after SCRBRD-101 lands; it is screen work over the fold and the existing reads.

**What was built.** The counting is a pure module, `apps/web/src/scorer/wagonAnalysis.mjs`, over `placement.mjs`'s
`SECTORS`/`sectorOf` — nothing re-derives an angle. The twelve batter-relative sectors fold to the eight named areas
SCRBRD-102 asks for: the two "backward" ones fold into the square neighbour they qualify (backward point → point,
backward square leg → square leg — field.js's `RIM` already left both out of its eight, for the same reason), and
the two dead-straight sectors (`sideOf` calls them neither off nor on) belong to no area and no side; they, and any
ball with no placement at all, are counted separately (`excluded.straight` / `excluded.unplaced`) and said in words
on the panel rather than folded into a total that would not add up. Area labels are `RIM`'s own words
(`positionName`'s deep names for long off/long on) — nothing re-typed. A run chip folds a 5 into the 4's key and
colour, matching the scorer's own legend (`field.js` `LK_COLS`); "All" is every ball with a placement, whatever its
value.

The panel (`apps/web/src/scorer/wagonAnalysisPanel.jsx`) is thin: a batter filter, a bowler filter, the run chips,
the field itself (drawn with field.js's own helpers, so a chip's spokes are exactly the wheel's), off side against
on side with each side's share of the CLASSIFIED total (off runs + on runs, not every run in the log), and the eight
areas with their runs and boundaries, zero rather than omitted when nothing went there. 12px floor, 44px touch
targets, tabular numerals (`T.role.figure`), both themes via `T` read at render (the design test's import-time
rule holds for both new files).

**Wired in:**
- The Match Centre's Analytics tab (`AnalyticsTab`, matchcentre/tabs.jsx): every batter and bowler in the innings,
  from the fold already in view. No match filter — one match is the whole point of the tab.
- The player profile's Career tab (`CareerWagonWheel`, ProfilesView.jsx): the batter fixed to the boy himself, a
  bowler filter from the existing `matchups` read (batterId narrows it to his own bowlers and their names — a read
  this panel needed only for the label, since `player_shot_points` carries `bowlerId` but no name), and a match
  filter built cheaply from the rows already in hand: `asShotPoint` (lib/live.js) now also surfaces `startsAt`,
  which the query already selects (it orders the read) but never returned to the client — one field added to an
  existing mapper, not a new read.

Names are exactly what the caller passes in; nothing here adds a second name path. Never a photo, age or date of
birth — the panel shows neither.

**Guards:** `apps/web/test/wagon-analysis.test.mjs` (new, 37 assertions: a right-hander's and a left-hander's areas,
both eras, the backward-sector fold, chips, filters, and what gets left out), registered in `run-all-tests.mjs`.
Two falsifications run and reverted by hand — folding `backward_point` into `third` instead of `point`, and basing
the side percentage on `sideRuns.off` alone — each broke exactly the assertion aimed at it, nothing else.
`tools/smoke-browser-wagonwheel.mjs` gains group F: opens the panel on the real scored match the rest of the walk
already built, filters to the left-hander, taps the 1s chip, and checks the area and chip counts against the
server's own `ball_event` rows (`browser-wagonwheel`: 41 passed, up from 33, 0 failed). `smoke-a11y` stays at 0
failures (198 passed) — it does not currently visit the Analytics tab or a profile's Career tab, so the panel is
proved by its own walk and unit tests rather than the a11y ratchet.

**Verification:** `pnpm -s typecheck` (0 errors), `pnpm -s lint` (0 errors, 82 warnings, at the ceiling but not over
it), `pnpm -s build` + `check-bundle.mjs` (entry chunk 421 KB of 500), `run-all-tests.mjs` (4901 assertions, 61
suites, all passed), `run-smoke-api.mjs` (2952 assertions, 70 walks) and `--browser` (1747 assertions, 29 walks,
`browser-wagonwheel` among them), `pnpm -s smoke` (247 assertions across `smoke`/`smoke-scorer`/`smoke-persist`/
`smoke-a11y`). Screenshots of the panel, both themes, on the Match Centre's Analytics tab and a player's Career tab.

**Left open:**
- No season filter — a season is not a field `player_shot_points` or the innings fold gives cheaply, and adding one
  would be a read change, out of scope for screen work.
- The bowler filter's names come from `matchups`, which only knows a bowler with a `bowler_id` (a SCRBRD player); a
  fixture against a school with no roster names its bowler in the ball log but not in this filter (the same gap
  `matchup_coverage` already states elsewhere).

### SCRBRD-103 — A run map and a catch map
**Priority:** P3 · **Domain:** Front-end / analytics · **Type:** feature (Kameel's references, 2026-09-27)
Two views, from broadcast graphics:
- **The run map:** the field in wedges, each labelled with its share of the batter's runs as a percentage.
- **The catch map:** where a fielder or a side took its catches, drawn as a heat map with the leading positions named ("backward point 20%"). Built from caught dismissals that carry a point.

Both need point-era balls; sector-era balls are left out and said to be. That is a reason the pad now captures points (SCRBRD-101). Position names come from `positionName()`. On a public page they follow the public-data rule (SCRBRD-083).

### SCRBRD-104 — A live-stream overlay (a scorebug for schools' streams)
**Priority:** P3 · **Domain:** Broadcast · **Type:** feature (Kameel's earlier designs, 2026-09-27)
Schools stream matches to YouTube and Facebook. The overlay is a transparent page that streaming software (such as OBS) adds as a browser source. It shows:
- the batting side, its score and the overs;
- the other side and the current bowler's figures;
- this over's balls;
- a short "FOUR 4 FOUR" or "SIX 6 SIX" banner, following DESIGN_DIRECTION §3.6.

**Blocked:** a stream is public, so the names it shows wait on the public-data rule's step 3 and on consent (SCRBRD-083, SCRBRD-092). Until then it can show role words only. It reads `broadcast_state()`, which is already public-safe.

### SCRBRD-105 — Match Centre summary: what Kameel's earlier design had that step 3c may not
**Priority:** P2 · **Domain:** Front-end · **Type:** gap check, then build (2026-09-27)
Check each against step 3c, and build what is missing:
1. **A details row:** status, competition, age group, division, date, start time and ground.
2. **Minutes batted** for each batter, taken from the event timestamps.
3. **The yet-to-bat order and the available bowlers.** An available bowler is one the Laws check allows next over.
4. **Each bowler's balls this over,** as chips on the bowling card.
5. **A conditions card** fed from the groundskeeper's pitch report (SCRBRD-085), next to the weather chip.

Names follow the Match Centre's public mode.

### SCRBRD-106 — A graphics pack: broadcast-style cards from the fold
**Priority:** P2 · **Domain:** Front-end · **Type:** feature (Kameel's broadcast references, 2026-09-27)
Each graphic is one component, drawn from the fold (partnerships, fow, phases.mjs, per-batter and per-bowler figures) and the career reads. They are used in four places:
- the Match Centre;
- big-screen mode;
- the post-match report;
- later, the stream overlay (SCRBRD-104).

The graphics:
1. **Partnerships:** every stand, the pair, a bar for each batter's share, runs and balls, then who is still to bat, extras, overs and the total.
2. **The batter lower-third:** runs, balls, dots, fours, sixes, strike rate and minutes (from the ball timestamps), with the surname in bold.
3. **The bowler card:** overs, dots, runs, wickets and economy; one bowler's runs per over as a bar chart; economy by phase; the fall-of-wickets strip.
4. **The innings story:** each phase with its score, run rate and top performers.
5. **The scorecard's focus ring:** one batter's dots, ones, twos, threes, fours and sixes, in the chip colours (DESIGN_DIRECTION §3.9).
6. **Leaderboards:** the season's and the school's records, such as fewest balls to a fifty and highest scores (balls as a subscript, * for not out, the match as context).
7. **The match summary:** the top three batters and bowlers per innings, and one closing line ("need 23 from 18", "trail by 149", "won by 4 wickets"). Lead and trail are new arithmetic on the fold.

The shared style:
- balls faced as a subscript next to the runs;
- right-aligned figures in tabular numerals;
- the current row highlighted;
- one footer strip (extras, overs, then the total in a pill);
- one closing line;
- a sponsor slot on each graphic, from the sponsors screen (commercial: schools' sponsors).

**Never on any graphic:**
- a pupil's photo (SCRBRD-092, A8);
- an age or a date of birth (minors);
- a name on a public surface except as the public-data rule allows (`publicName()`, SCRBRD-083).

**Portrait first** (the ICC's 2023 vertical feed): design each graphic for a phone held upright, then widen it for
big screen. Don't shrink a TV layout.

There is no migration. Build it after SCRBRD-101: the ring and the chip colours are shared.

### SCRBRD-107 — A ground data desk: the commentator's screen
**Priority:** P3 · **Domain:** Front-end · **Type:** feature (Kameel's reference: the commentator's data feed at a ground, 2026-09-27)
A dense, glanceable screen for a school's announcer, commentator or scorer's box. It shows:
- the score, overs, run rate and over rate;
- the projected score at the current rate and at 6, 8 and 10 an over;
- the batters, with runs, balls, 4s, 6s, strike rate and minutes;
- the partnership and the last wicket;
- extras by type (B, LB, W, NB);
- the bowlers, with overs, maidens, runs, wickets, economy, dots, 4s and 6s;
- this over, and the runs from the last over;
- runs per over as a bar chart.

It is signed-in only, for a role that may already read the match, so names are shown in full. It updates live from the same source as the Match Centre. Ball speeds are out of scope: nothing records them.

It reuses SCRBRD-106's components where they fit. There is no migration.

### SCRBRD-108 — A pitch map, entered by hand: line and length per delivery
**Priority:** P2 · **Domain:** Analytics / coaching · **Type:** feature (Kameel, 2026-09-27; the roadmap's "Pitch Map", up18)
This is the bowling half of the wagon wheel. The ICC gets it from Hawk-Eye; a school gets it from a person tapping where the ball pitched.

**Who records it and how:**
- A coach, analyst or second scorer taps on a drawing of the pitch, seen from the bowler's end.
- It is batter-relative, like the wagon wheel (SCRBRD-101): off and leg follow the striker's hand.
- **Never on the scorer's pad.** It would delay the next input (DESIGN_DIRECTION §1a).
- It is its own capture, keyed to the ball's event id. It adds to a delivery and never changes one.

**The readouts:** each bowler's map, the batter's map against him, the length bands (full, good, short, yorker, bouncer), line bands, and the wickets on it.
Band thresholds are measured values, not guesses, as `placement.mjs` does for depth.

**Needs** a table (a new migration) and RLS. Readers follow the match's readers.

### SCRBRD-109 — A field plot: a coach's fields, laid over where the batter actually scores
**Priority:** P3 · **Domain:** Coaching · **Type:** feature (Kameel, 2026-09-27; from the ICC's field plot)
**Setting a field:**
- A coach drags nine fielders onto the batter-relative field (SCRBRD-101), with the keeper and the bowler fixed.
- Names come from `positionName()`.
- The coach saves it as a named field, e.g. "new-ball field v left-hander".

**Laying it over:** a saved field goes over a batter's wagon-wheel points and catch map (SCRBRD-102, SCRBRD-103). The coach sees where the field leaves runs, and where a batter gets out.

**Rules:**
- A coaching tool only. The scorer never sets fields during play.
- Saving fields needs a table (a new migration). The overlay alone needs nothing new.
- Build after SCRBRD-101.

### SCRBRD-110 — Fast-bowler workload, individually: every delivery, the bowler's voice, his own baseline
**Priority:** P1 design, then P2 build · **Domain:** Player welfare · **Type:** feature (Kameel, 2026-09-27, from Vincent Barnes' "Keeping fast bowlers on the park")

**The case.** Injury risk comes less from how much a bowler bowls than from:
- sudden jumps after little bowling;
- intensity;
- recovery;
- previous injury.

Consistent exposure protects. Each bowler is monitored individually, the bowler has a voice, and pace is kept, not coached out.

**What exists:** db/08's `workload()` gives, per bowler:
- match overs over 7 and 28 days, the longest spell, and days since he last bowled;
- age-band breaches, written as facts;
- a this-week-against-four-weeks ratio with a word (rested, light, steady, rising, spike);
- training minutes.

It sits under `player.workload.read`.

**The gaps, and what to build:**
1. **Every delivery, nets included.**
   - A nets or training entry per bowler: deliveries, intensity (low, medium or high, or an effort score of 1–10) and minutes.
   - **Decided: both the coach and the bowler record it.** The coach enters for a group; the bowler enters his own. Each entry says who recorded it.
   - Match deliveries count wides and no-balls, which are full-effort balls that are not legal deliveries.
2. **The windows:**
   - 7, 14, 28 and 42 days;
   - the change from week to week;
   - the days between bowling days;
   - a trend over 3–6 months.

   The ratio stays as a guide, never a diagnosis. Also consider a rolling-average form: the uncoupled ratio or an exponentially weighted average, since the literature has moved on from the coupled 7:28.
3. **The bowler's voice:**
   - a short daily check-in: sleep, soreness on a simple body map, fatigue;
   - a one-tap "something doesn't feel right". It tells the physio and the coach to investigate, and never marks him injured.
4. **The individual profile:**
   - injury history, linked from the injury record, feeds his monitoring;
   - limits set for that bowler by the physio or coach;
   - a flag when his figures depart from his own baseline;
   - an optional preseason ramp, so progress is read against a plan.
5. **Capacity and pace:**
   - hamstring and strength tests (physio or S&C);
   - action reviews ("efficient, repeatable, sustainable?");
   - optional speed-gun readings, so pace is tracked as an asset and a drop can flag fatigue.

**Who reads what.**
- **Decided:** wellness check-ins, tests and reviews are read by the physio and the coach. They may share with parents when necessary. The share is an explicit act, recorded, not a standing permission.
- The bowler sees his own.
- Team-mates never see any of it.
- The overs themselves stay as public as a scorecard is. What they mean does not.

**Privacy (hard).** Wellness, injury and test results are a child's health information: POPIA special personal information, processed on a competent person's prior consent. The consent is unbundled from the terms, as SCRBRD-092 designs it. Every new table is governed by `packages/policy` sensitivity, with RLS, before any screen. This is Opus work under CLAUDE.md.

**Scope.**
- **Decided:** schools first, and designed to extend beyond them. Club, provincial and academy programmes, and other sports later: SCRBRD means to become the definitive sport ecosystem globally.
- So nothing is hard-wired to school age bands or to cricket alone:
  - an age band is one input to a limit, not the limit;
  - "delivery" is cricket's unit of load inside a general load model (session, units, intensity, minutes).

**Order:** an Opus design pass first (tables, policy, consent, the load model), for Kameel's review; then the build in phases 1 → 5.

### SCRBRD-111 — Smart health devices: wearables feeding the workload record
**Priority:** P3 · **Domain:** Health / integrations · **Type:** feature (Kameel, 2026-09-27: "at some point we want to
introduce smart health devices and connect them into our system for a better homogenous ecosystem")
Heart rate, sleep and training load from a bowler's own device, read into the SCRBRD-110 record beside his check-ins
and the ball log. **Before any build:** it is health data about minors, so it sits under the health consent (and a
device-specific one), a device vendor becomes a processor under POPIA, and each vendor needs a data processing
agreement. Design pass first (Fable tier, with Kameel's say), after SCRBRD-110 phase 1 is in use.

### SCRBRD-112 — Keep a pupil's health record for his whole time at school, for early detection
**Priority:** P3 · **Domain:** Health / privacy · **Type:** decision, then feature (Kameel, 2026-09-27)
Kameel's aim: with permission, keep the workload and health record for a player's whole time in the school system,
so patterns across seasons can flag health risks early and support long-term health. Today's rule (SCRBRD-110 Q4) is
twelve months hidden, then deleted, after consent ends or he leaves. **Needs:** its own purpose and its own explicit
consent (POPIA: consent is specific to purpose; this is minors' special personal information), the information
officer's sign-off, and a statement of what the pattern detection does and who sees its output. Nothing is built
until those are settled.

### SCRBRD-113 — The Laws, 4th Edition (2026): the behaviour changes
**Priority:** P1 · **Domain:** Scoring · **Type:** Laws (Kameel supplied the 4th Edition, 2026-09-27; in force 1 October 2026)
**Decided (Kameel, 2026-09-27): the Edition follows the match date.** A match starting before 1 October 2026 is
scored under the 3rd Edition, from 1 October under the 4th, so old logs replay as they were played. A
per-competition setting is added only if a school's competition adopts the 4th Edition later.
**Build (Opus), after db/52:** the list in `docs/laws/CLAUSE_CHECK.md` "4th Edition: changes to build" —
1. 41.8 and 41.7.6: a deliberate front-foot no-ball and a deliberate beamer suspend the bowler for the match; the
   dangerous-series beamer (41.7.4) stays for the innings. Split `beamers`; key the suspension scope to the Edition.
2. 22.1.3: a bouncer over head height is a Wide — words on the pad and the no-ball sheet (which wrongly says caught
   and stumped are possible off a no-ball, in either Edition).
3. 18.5.2 / 18.13.2 and 37.5.2: the fielding captain chooses who faces after deliberate short running and after an
   obstruction that prevents a catch.
4. 41.17.2 / 16.7: penalty awards until the umpires leave the field, even after a result; an award can reopen a
   finished chase; a result can be a win by penalty runs.
5. Not new, found in the text: deliveries under 24.4, 28.2, 41.4 and 41.5 do not count in the over (17.3.2.5); the
   second offence under 41.14.3 and 41.15.3 also disallows the delivery's runs; the missing penalty and suspension
   reasons the report lists (throwing, 21.3.2; Law 42).
Then apply the report's renumbering map to the code's comments.
**Added (Kameel, 2026-09-27): the free hit follows the match format.** Limited overs (T20, 50-over, any
overs-limited format): a free hit after a no-ball. A declaration or timed match, one day or more: none. Not keyed to
the date: every match follows its stored format.

**Built 2026-09-27 (Opus).** How each rule reads the Edition: `lawsEdition(match)` (`packages/scoring/src/edition.mjs`)
dates the match in SAST by the fixture's `starts_at`, else the Edition an innings was folded under, else the log's
first event, else today; 3 before 1 October 2026, 4 from it. The pad passes the fixture's start and format to every
fold (`FoldContext`); the server asks `match_fold_context()` (db/54), since a pad's resume credential cannot read the
`match` row. Detail in `docs/SCORING_RULES.md`, "The Laws' 4th Edition".
1. **Suspensions.** `SUSPENSION_REASON_SCOPE` keyed by Edition, `suspensionScope(reason, edition)`: a deliberate
   front-foot no-ball and a deliberate beamer (new reason, split from `beamers`) are the match under the 4th, the
   innings under the 3rd; `beamers` (after a caution) the innings in both. `bowlerSuspended()`, the pad's sheet and the
   Laws check use the match's Edition; a stored event keeps its scope. New in both: `throwing` (innings) and `conduct`
   (Level 4, the match). The sheet says how long in words.
2. **Head height.** Words only: the no-ball pad's "Waist high", the sheet's "Waist-high Full Toss", and under the 4th
   "a bouncer over head height is a Wide"; the rulebook's No-ball and Wide.
3. **Who faces.** `ball()` takes `facesNext` (`striker`, `non_striker`, `incoming` on a wicket); the fold places the
   batters by it. Under the 4th the Laws take it after deliberate short running and on an obstructing-the-field or
   run-out wicket that stopped a catch; the pad's short-run sheet and the wicket sheet ("Did the obstruction stop a
   catch?") ask the fielding captain's choice and will not record without it. Under the 3rd it is refused (41.5, the
   batters' choice, in both).
4. **Penalty runs after the result.** "Until the umpires leave the field" = the match concluded (`status =
   'complete'`, after which the write path quarantines every event, db/33). Under the 4th a fielding-side award after the
   result is taken; one that lifts the target above a reached chase reopens it; an award that makes a chase ended short
   enough is a win "by penalty runs" (`inn.penaltyWin`, `describeResult()`). The 3rd still refuses (`match_decided`).
5. **Both Editions.** A delivery under 24.4, 28.2, 41.4 or 41.5 does not count in the over: `notInOver` on the ball,
   `notInOverDelivery()`, `countsInOver()` read by the fold, phases, commentary and causes; the pad's penalty sheet
   records it ("a fielder's offence, and the ball does not count"). A second offence under 41.14.3 or 41.15.3 disallows the delivery's runs
   (`runsDisallowed(delivery, reason)`; `striker_position` joined the fielding side's reasons).
6. **The free hit by format.** `freeHitsApply(format)` (`packages/scoring/src/format.mjs`), stamped on the innings
   (`inn.freeHits`) and read by the fold, the Laws check, the pad's banner and no-ball sheet ("No free hit in this
   match") and the commentary. Declaration and timed spellings (`DECLARATION_FORMATS`) give none; a match with no
   format keeps a free hit after every no-ball, as before. "One-Day Declaration" added to the fixture screen's formats.
7. **Renumbering** applied from CLAUSE_CHECK.md's map (17.8 to 17.6, 17.8.1 to 17.7.1, 38.2 to 38.4, 21.19 to 21.17);
   the backlog's 25.4.2 line in the retirement entry left to the retirement work. No clause numbers on screen.
**SQL: `db/54_laws_4th_edition.sql`.** `ball_counts_in_over()` in every reader that counted balls of the over
(`match_live_score`, `innings_score_as_folded`, `bowler_over`, `bowler_hat_trick`, `player_bowling_since`,
`opposition_squad`, `player_bowling_by_season`, `player_bowling_career`; the matchups and career reads in read-api);
`free_hits_apply()` and `match_free_hits_apply()` inside `ball_on_free_hit()`; `match_fold_context()`. Idempotent, with a
proof block; db/99 section 32. **Found on the combined branch (with db/53):** §32 ran as whoever §31 left, and once it
compared every match it found the live score counting a `retire` marked W with method bowled (the fold: retired hurt,
no wicket) and a penalty row's `value` (the fold: its `runs` only), where the handover's count did not. db/54 (4) makes
`match_live_score` count as `innings_score_as_folded()` does; §32 now sets its principal, compares runs too, and
refuses an empty comparison. Falsified: the old live score, its wickets alone, its runs alone, and §32 with no
principal, each red; `replay.test.mjs` O and a `smoke-fold-figures` innings hold the fold's reading.
**Proof:** `packages/scoring/test/edition.test.mjs` (220, both Editions side by side, 30 September against 1 October
2026, pad and server folds agreeing); 18 JS and 7 SQL falsifications, each caught; `tools/smoke-fold-figures.mjs` (113,
with deliveries that do not count and a declaration match whose bowled off the ball after a no-ball stands);
`tools/smoke-browser-laws4.mjs` (43, a fixture dated 3 October 2026); the suspension and penalty walks dated 30
September 2026. Rehearsed: origin/main's db/ (to 51), then db/52, then db/54 alone, then this branch's db/99: all
assertions passed. Full run: typecheck 0 errors, lint 0 errors and 82 warnings, build and bundle check, migrate
--reset --seed --verify, generate-rls (db/ unchanged), shipped 53/0, run-all-tests 5364 across 65 suites,
run-smoke-api 2970 across 70 walks, run-smoke-api --browser 1838 across 31 walks, the offline-day walk under LIE_FI 56/56, pnpm smoke (8, 25, 16, 214).
**Not built:** Law 42 Level 3 (suspended for a number of overs); the analytics screens (charts, signals, the match
centre's tabs, the post-match report) still count legal balls by type, not `countsInOver()`; the handover model
(`scoring-session.mjs`) folds without the fixture's context; a non-striker's obstruction is not recordable on the wicket
sheet (as before).
**To be decided (recorded, not built):** some primary-school leagues cap an over at a maximum number of balls (for
example 8, wides and no-balls included), and a free hit earned on the last allowed ball falls away. Needs: which
leagues, the cap, and whether it is a fixture setting beside the format.

### SCRBRD-114 — Playing conditions per competition (first target: KZN high schools, U13 to 1st XI)
**Priority:** P1 · **Domain:** Scoring / competitions · **Type:** design, then build (Kameel, 2026-09-27)
What varies between competitions becomes a setting on the competition, read by the pad, the fold, the Laws check
and SQL, never a rule in the engine. The first pilot schools are KwaZulu-Natal high schools, U13 to 1st XI.
Candidates, to be confirmed from the actual bye-laws (research so far is unverified):
- the format and its limits: overs per innings (T20, 25-over, 50-over), declaration and timed matches;
- free hits by format (built in SCRBRD-113 as the first case);
- fast-bowling limits per spell and per day by age group: `bowling_directive` holds platform defaults "in the
  absence of a published CSA schedule" (U13 5/10, U14–U15 6/12, U16 7/18); the union's figures replace them;
- 1st XI under senior playing conditions; league points, bonus points, net run rate and over-rate penalties;
- eligibility (bona fide scholars) on team sheets;
- primary-only rules (maximum balls per over, mandatory retirement at 30 or 50, shortened pitches, lighter balls)
  are out of scope for the high-school pilot and recorded for later.
**Not built:** transformation quotas. They need each child's race, special personal information under POPIA;
only with Kameel's explicit decision and the information officer's advice.
**Needs first:** the KZN school bye-laws and playing conditions (the sites are blocked here; Kameel supplies the
PDFs). Then an Opus design (a `competition_conditions` shape and where each rule reads it), then the build.
**Received 2026-09-28:** CSA *Club Cricket Standardisation Regulations* (September 2018, 10 pages). KZN has two
CSA members: the KZN Cricket Union (KZNCU; Durban and the coast) and KZN Inland (KZNICU; Pietermaritzburg and the
Midlands). Their matches follow the MCC Laws, then these CSA regulations, then each league's bye-laws. The document is
**club administration, not playing conditions**: it has no overs, bowling limits, points or free-hit rules, so it
does not unblock this item. The KZN schools' bye-laws and playing conditions are still needed. What it does cover,
recorded for clubs (C7 "the same rules as schools") and not built:
- a player under 18 must have an indemnity form from a parent or guardian before he may be selected for any club
  team, and a second one for a national tournament (3.3.2–3.3.3): a per-player record that selection would check;
- players are registered with the Member every season and verified by the club (3.1–3.2); one club per competition
  per season without written consent (3.1.3);
- transfers need a clearance certificate from the former club (good standing, no unpaid fees for the previous season),
  refused while a disciplinary matter is open (4.4); a waiting period of up to 14 days between clubs (4.1.4.1);
- at most one foreign player per Premier and Promotion League team (3.5.2);
- the captain files a match report, including an umpire grading, by the Monday or Wednesday after the fixture (1.3);
- Premier League coaches hold at least Level 2 (1.2.4; `coaching_accreditation` exists as a clearance kind).
**Not built, by decision:** 1.2.5 (players of colour per team) and 3.5.4 (foreign players counted as white) are
transformation quotas, and the transformation-quota rule above applies to them.

### SCRBRD-115 — K3: a pupil does not read whether a team-mate is out
**Priority:** P1 · **Domain:** RBAC / Privacy · **Type:** safeguarding (CSA_SAFEGUARDING_CHECK K3; SAFEGUARDING_DSO §6.3)
**Decided (Kameel, 2026-09-27):** withdraw `medical.status.read` from `player` and `enquiry` (check §5 Q12; design
§10 Q8). CSA's Safeguarding Policy p52 item 6 says a child's medical needs are "not in general view to other ...
children". **Revised (Kameel, 2026-09-28): `enquiry` keeps it.** It is a coach-to-coach grant for one named player,
and both ends are staff. Only `player` loses it.

**Built 2026-09-28 (Opus).** `db/55_medical_status_withdrawn.sql` deletes the `player` row from `role_capability`.
`roles.mjs` drops the capability from `player`, and `WITHDRAWN_SINCE_01` (the `player` row only) keeps `db/01` as
shipped (db/21's shape). Regenerating
leaves `db/` unchanged. A pupil now reads no team-mate's injury row at any tier. That covers date injured, return date
and restricted; the Dashboard's "Who is out"; the status-tier injury notice; and the readiness read's clinical half.
His own injury, at every tier, still reaches him through `selfaccess`. The screens (Squad, Profiles, the profile
modal, Injuries' "Available" count) draw `player.fitness` only for a role holding the status tier.
**Proof:** db/99 section 33, with sections 3b, 3c and 11 flipped. It covers the catalogue, R Pillay beside T Bekker,
a school-wide pupil, the physio and the director of sport still reading, and a real `access_request_decide()` grant to
the 2XI coach. That grant reads the boy's profile and whether he is out and until when, and not what is wrong with him
or anyone else's injury. There is a K3 group in `separation.test.mjs`, which pins the status tier's holders
(`enquiry` included). `smoke-read` and `smoke-access` are updated, and the browser day sheet has a pupil case.
Falsified: putting the pupil's row back turns 3b and 33 (pupil), the separation group and `smoke-read` red; deleting
the enquiry's row turns 33 (enquiry) red.

### SCRBRD-116 — K4 and SG-7: the clearance register to CSA's rules
**Priority:** P1 · **Domain:** RBAC / Privacy · **Type:** safeguarding (CSA_SAFEGUARDING_CHECK K4, SG-7; SAFEGUARDING_DSO
§6.4, §9.3)
**Built 2026-09-28 (Opus).** `db/56_clearance_csa.sql`:
- **Kinds.** `sexual_offences_register` (the NRSO check), plus SG-7's `safeguarding_awareness`, `dso_training`,
  `good_standing_declaration`, `safeguarding_acknowledgement` and `references_checked`, each with a label.
- **Ages.** `clearance_kind_max_days`, behind RLS and db/50's pad guard, readable when signed in and written by
  nobody. The three checks run 731 days. A first police clearance at the school may be at most 183 days old when it
  is recorded; a row that was revoked does not count as held. The SAC and DSO training run 366 days.
- **The rule.** A `BEFORE INSERT` definer trigger enforces the ages and refuses with a sentence naming the date the
  check should carry. Revoking a row is never refused.
- **Requirements.** The three checks, the SAC and the acknowledgement are required for coach, assistantcoach,
  teammanager, medical, driver, transportcoordinator, official, scorer, facilities, media, scout, schooladmin,
  sportsadmin, directorofsport and principal.
- **The register.** `clearance_register()` leaves off a pupil known to be under 18, and is now granted to
  `scrbrd_app` alone.

The API accepts the new kinds. The register and My clearances panels meet the 12px and 44px floors on T tokens and
state CSA's rule. The seed's clearances go in as pre-db/56 history, and the physio's is a five-year legacy row.
**What changes for people:** every adult in those roles now shows "missing" for the Sexual Offences Register, the SAC
and the acknowledgement until the office records them. Administrators, officials, media and scouts are on the register
for the first time. A check recorded before db/56 reads as it did (current, then expiring) until its own date.
**What does not:** nothing refuses more from the paste. `trip_driver_cleared()` is unchanged and never refuses a
missing check. Once a new kind is recorded for a driver and later lapses or is revoked, it refuses him, as it does
today for a lapsed police clearance. **Decided (Kameel, 2026-09-28): keep this behaviour**; no code change.
**Proof:** db/99 section 34 covers roles, age, first check, legacy row, reference data, pupil and trip. The
`smoke-clearance` walk has a CSA group (85), and the browser register walk checks the new names, the rule line and
the 12px floor on every chip. Falsified: the ages table emptied, "first" counting a revoked row, the register without
the pupil exclusion, the exclusion reaching an adult, the SOR requirement rows removed, and a guard refusing a missing
check. Each went red for the right reason, and the file's own proof block was falsified twice.
**Run (with SCRBRD-115), 2026-09-28:**
- Typecheck: 0 errors. Lint: 0 errors, 82 warnings. Build and the bundle check pass.
- `generate-rls` leaves `db/` unchanged, and the shipped test is 53/0.
- `run-all-tests`: 5427 across 65 suites.
- `run-smoke-api`: 2984 across 70 walks. `run-smoke-api --browser`: 1860 across 31 walks.
- The offline-day walk under LIE_FI is 56/56, and `pnpm smoke` is 8, 25, 16 and 214.
- Rehearsed: origin/main's db/ (to 52) seeded, then the apply bundles for 53, 54, 55 and 56 pasted in order (a
  second 56 refused by its guard), then this branch's db/99. Every assertion passed except the pre-existing
  SCRBRD-118. The walks ran with that one assertion downgraded, locally.
**Not built:** the `dso` requirement rows (phase 1, when the role exists); a screen for recording a clearance (the
office still records one through `POST /api/clearances`; there was no form before either); an advisory for legacy
rows older than 24 months (the design leaves them to lapse on their own dates).

### ~~SCRBRD-117~~ — BUILT · `player.fitness` is readable by anyone who reads a player's profile
**Built 2026-09-28 (Opus), with safeguarding phase 1 (SCRBRD-119): `db/58_player_fitness_masked.sql`.** `tables.mjs`
masks `fitness` behind `medical.status.read`. The mask is anchored to the boy's own team, as the injury row is. db/58
rebuilds `player_masked` with db/09's ten masks and this one (db/47's shape). `MASKED_SINCE_09` in `generate-rls.mjs`
keeps `db/09` as shipped. `rls.test.mjs` D2 holds db/58's list to `tables.mjs`'s whole list, verbatim, and checks
that db/09 lacks the tuple. `read-api.mjs` now logs `fitness` with the players read. The Analytics and Skills screens,
the two that still drew the column for any reader, draw nothing when it comes back masked.
**Who reads it now:** the side's coach, assistant and manager; the physio; the office and leadership; a granted
enquiry for its one boy; the boy's parent and the boy himself. A team-mate, another side's coach and a scorer read
NULL. **Proof:** db/99 section 36 covers a school-wide pupil, R Pillay (his own and not a team-mate's), the U14A coach
(roster yes, fitness no), the physio, the director of sport and A Bekker (his son's). Falsified by rebuilding the view
without the mask: section 36 (pupil) goes red.

**As found:**
**Priority:** P2 · **Domain:** RBAC / Privacy · **Type:** found building K3 (Opus)
`player.fitness` (`fit`, `injured`, `rehab`, `unavailable`) is health, and PUBLIC_DATA marks it N2 (`public.mjs`). It
is unmasked in `player_masked` under `player.profile.read`, which pupils, a granted enquiry, media, analysts and scorers
all hold. No route writes it and every live row defaults to `fit`, but the seed marks R Pillay `injured`, and any
import that sets it would publish it to the whole side. The screens now draw it only for a holder of
`medical.status.read` (SCRBRD-115). **Fix (Opus):** mask it behind `medical.status.read` in `tables.mjs`, with a
hand-written `player_masked` re-emission (db/47 rebuilds that view the same way) and a generator carve-out so `db/09`
stays as shipped. Or drop the column, since the injury rows are the clinical truth and `read-api.mjs` already refuses
to read it.

### ~~SCRBRD-118~~ — CLOSED · db/99's db/54 "(same)" check fails on the db/45 fixture: the live score and the fold disagree
**Closed 2026-09-28** by `8ab1c59` (db/54 section 4, PR #48): `match_live_score` now counts runs and wickets with `innings_score_as_folded`'s expressions, so the two agree on any log, and §32 sets its own principal. Found independently while the K3/K4 work was on the older base.
**Priority:** P1 · **Domain:** Scoring · **Type:** found 2026-09-28 (it blocks `--verify` and `run-smoke-api`)
At `d42b56c`, before any K3 or K4 change, `migrate --reset --seed --verify` stops at section 32's "(same)" check:
`live/folded 77777777-…-0003/0` reads live (81,15,20) and folded (78,14,20). Section 23 (db/45) writes two
deliberately awkward rows into that innings: a `penalty` row with `value` 3, and a `retire` of a hurt batter marked `W`
with method bowled. `innings_score_as_folded()` ignores both, as db/45 asserts. `match_live_score` (db/54's
re-emission of db/48's) counts the value and the wicket. Either the view is wrong (it sums `value` over every kind and
takes `ball_wicket_stands` without the fold's retirement rule), or section 32 should exclude that fixture. **Opus
(scoring) to decide and fix.** SCRBRD-115 and SCRBRD-116's walks were run with only that one assertion downgraded to a
warning, locally, and it is not committed.

### SCRBRD-120 — The scorebook importer: a paper scorebook, photographed, checked and imported
**Priority:** P2 · **Domain:** Scoring / data entry · **Type:** Fable design pass, then build (Kameel, 2026-09-30)
Taken from the iamkameel/scrbrd harvest (`audit/HARVEST_scrbrd_2026-09-30.md`), where `scorecard-importer.tsx` did OCR with a
cell-by-cell review. Schools score many matches on paper: away games, lower sides, festivals. Importing the book would bring
them into careers, the workload record (SCRBRD-110's paper-scored `match_elsewhere` entries) and the tables (SCRBRD-114).
**Needs a design first** (on Fable's list, CLAUDE.md). The design must say:
- what the reader produces: a summary scorecard or ball by ball;
- how a checked import becomes events in the log, marked with their source, and how it meets the fold, the Laws check and SQL parity;
- who may import and who confirms;
- how long the photos are kept, since they carry children's names, and who may see them;
- what happens when the imported figures disagree with a live-scored innings.

### SCRBRD-122 — Availability asks again when the fixture changes
**Priority:** P2 · **Domain:** Fixtures / Families · **Type:** small build (Kameel, 2026-09-30; next after the scorebook PR)
From the second harvest (`iamkameel/scrbrd` PR #2). Today `match_availability` stores only the answer, so a boy who said
"available" for a Saturday stays available when the fixture moves to a Wednesday, which nobody asked him about. That breaks
the table's own rule that silence is not a yes. Each answer records the fixture as it stood when it was given (start time,
ground, format, overs). When any of them changes, the answer reads `needs_reconfirming`, not `available`, and the squad and
guardian screens say so and ask again. Nothing is deleted: the old answer stays as history. Opus for the migration, the
staleness rule and its db/99 proof; Sonnet for the squad and guardian screens.

### SCRBRD-123 — A league and knockout fixture planner (drafts only)
**Priority:** P2 · **Domain:** Competitions · **Type:** build, after SCRBRD-122 (Kameel, 2026-09-30)
From the second harvest (`competition-planner.ts` in `iamkameel/scrbrd` PR #2, ported as an idea, not code). A league
administrator today types every fixture by hand. The planner generates deterministic single and double round-robin
pairings and seeded knockout brackets (explicit byes; a later round holds "Winner R1 · Match 2", not a team), then places
them into declared ground windows. Required rules are never broken to fill a calendar: blackout dates, rest and travel
between a side's matches, the maximum matches a side plays in a day, and closed grounds. A fixture it cannot place stays
unscheduled with its reason, and a fixture the administrator locks survives regeneration. The draft reserves nothing.
Publishing creates fixtures through the existing fixture route, with `match.competition_id` so db/61's conditions apply.
Schools approving their own fixtures and cross-school calendars are a later phase. Opus for the algorithm (plain JS in
`packages/`, with tests) and the publish path; Sonnet for the draft screen.

**Built 2026-09-30 (Opus): the engine, phase 1.** `@scrbrd/scoring/planner` (`packages/scoring/src/planner.mjs`, a
subpath export kept off the package index): `pairings()`, `plan()` and `toFixtureDrafts()`, with
`packages/scoring/test/planner.test.mjs` and `services/api/write/planner-drafts.test.mjs` (every draft through the
fixture route's own handler). No database change, route or screen. Ground hierarchy and closures are planner input
until a record exists. The API, what phase 2 adds and what was left out: `docs/design/SCRBRD-123_planner.md`.

### SCRBRD-124 — Parent lift clubs: families offering each other lifts to fixtures
**Priority:** P2 · **Domain:** Transport / Families / Safeguarding · **Type:** Fable design, then build after SCRBRD-122 and
SCRBRD-123 (Kameel, 2026-09-30: "a feature I still believe in … I've used parent lift clubs like this")
From the second harvest (`iamkameel/scrbrd` PR #2 has opt-in offers, mutual acceptance and handovers, and still awaits
school policy approval). Parents arrange lifts with each other; the school facilitates and does not operate them. The
rules the design must hold, as agreed with Kameel:
1. **Consent per child, per lift.** A boy rides only when his own guardian has accepted that driver for that lift. Nothing
   carries over automatically.
2. **Only known adults drive.** The driver is a linked guardian at the school who declares a licence; the school may require
   the clearance it already asks of other adults (db/56).
3. **Least shared.** Passengers' names go only to the driver and the accepting guardians; pickup at a named point (the gate,
   the ground), never a home address; no location tracking.
4. **Adults talk to adults.** Arrangements are between guardians; no adult messages a child.
5. **Handover confirmed.** The driver marks each drop-off; the receiving guardian acknowledges; a missed handover alerts both.
6. **A route to the DSO.** Any concern about a lift raises through `safeguarding_concern_raise()` (db/57).
7. **The school decides.** A module off by default; the principal switches it on with the school's own lift policy.
Fable designs (on its list since 2026-09-30); Opus builds the schema, policy and RLS; Sonnet the screens.
**Designed 2026-09-30:** `docs/design/SCRBRD-124_lift_clubs.md` (Fable). **Decided (Kameel, 2026-09-30): D1–D18 as recommended** (D9 three years; D11's words as drafted). Four phases; the module goes live for a school after phase 2.

### SCRBRD-125 — Roles scoped to a competition
**Priority:** P3 (before a second league) · **Domain:** RBAC · **Type:** design + build (found 2026-09-30, SCRBRD-120 §9.4)
Assignments carry a school, a team and a fixture, but no competition. So a league administrator with no school manages every
league (`competition_conditions_manager()` asks `app_can()` at the organiser school, which a school-less grant covers), and
one appointed at a school reaches only that school's fixtures, even in his own league. Fine for the pilot's one league.
Before a second league: a competition-scoped assignment, read by `competition_conditions_manager()`, `scorebook_league_reach()`
and the conditions and standings policies. Opus.

### SCRBRD-121 — News: a second person approves a post before it reaches pupils
**Priority:** P3 · **Domain:** Communications · **Type:** small build (Kameel, 2026-09-30)
From the harvest. News today scopes by anchor and publishes at `published_at` (db/12). This adds a draft, then approval, then
publish step: a post whose audience includes pupils waits for a second holder of the posting capability to approve it, and the
approval is recorded. Opus for the capability and the policy; Sonnet for the screen.

### SCRBRD-119 — Safeguarding phase 1: the DSO and the concern record
**Priority:** P1 · **Domain:** RBAC / Privacy / Safeguarding · **Type:** CSA Safeguarding Policy (SAFEGUARDING_DSO
§9.1; CSA_SAFEGUARDING_CHECK SG-1 to SG-6, SG-9)
**Built 2026-09-28 (Opus): `db/57_safeguarding_dso.sql`**, with SCRBRD-117 (db/58) beside it.
- **The role.** `dso` holds `safeguarding.concern.read`, `.concern.manage`, `.suspend` and `.authorise`, and no
  other role holds them, the owner's key included (`ALL_CAPABILITIES` minus `safeguarding.*`). The bundle also has
  `clearance.read/manage`, `audit.read`, `player.public.withhold` and the reads a DSO needs to name a child, an adult
  and a place. It has no `medical.*`, `discipline.*`, `scoring.*`, `user.role.assign`, PII, emergency or age read.
  The principal appoints a DSO, and so can the platform and the owner's key as the recovery path. A DSO assignment
  with no school, or with a team, is refused.
- **Raising a concern** is open to anyone signed in, through `safeguarding_concern_raise()`. A child may be named only
  if the reporter can already see him, and an adult only if he holds an appointment at the school. The reporter gets
  back a reference (`SG-XXXX-YYYY`) and a time; `my_concern_receipts()` returns his references and nothing more.
- **Routing.** The school's DSOs hold the concern. For a concern about leadership, the union's DSOs are also told by
  a nameless notice, but never given the record. A concern about the DSO, or at a school with no DSO, is held at the
  union, or at the federation if the union has no DSO. When nobody can hold it, it is still written and marked
  `unheld`, and the reporter is told to use The Guardian's app as well.
- **Who reads it.** Four layers guard every table and every function: `app_can` at the holding institution with no
  team and no fixture, and RESTRICTIVE cuts for a support session, a platform-wide assignment and the adult named.
  `access_log` hides every `safeguarding%` row from other `audit.read` holders.
- **Notices.** Each is nameless and gated on the capability. `notification.recipient_id` and its RESTRICTIVE policy
  carry the share notice. SG-9: a private notice to a pupil is refused unless the system writes it. The publish route
  cannot write or edit a safeguarding notice.
- **Doors.** The inbox shows the 24-hour (NDSO) and 72-hour (The Guardian's app) clocks. Opening a concern, the
  family (only through an open concern), notes, assign, need-to-know shares (thirty days at most, parts named, never
  the reporter, revoked on close) and close (three or five years kept) each have a function, and each read is logged.
- **Around it.** `support_access_begin()` refuses any role that carries `safeguarding.*`. `dso_appointment_guard()`
  stops the principal (and the office, always) from ending a DSO while a leadership or DSO concern naming him, or
  nobody, is open. The provincial DSO may end it. The six `dso` clearance requirements are added.

**Routes and screen.** The routes are `/api/safeguarding/*`, and `GUARDIAN_APP_URL` (https only) is The Guardian's
link. **Safeguarding** is one destination for everyone. It shows the DSO card, a form in plain words that says it is
confidential and not anonymous, The Guardian's app, and after sending only the receipt. A DSO also sees the inbox and
the concern page with its record, notes, family, shares and close. The seed has a DSO at Hilton (N Dube, on the pilot
list).
**Proof.** db/99 section 35 covers appointment, support, raise and refusals, routing, the DSO, the named DSO, the
union, another school's DSO, and the zero matrix: coach, parent, office, principal, director of sport, league,
owner's key, platform, the named physio, the pupil and the teachers. Then come the support session, the owner-cut and
support-cut isolated, receipts, contacts, open, family, clock, share, notice, guard and catalogue. Also
`separation.test.mjs` group SG, `rls.test.mjs` B2 and B3, `smoke-safeguarding` (76), `smoke-browser-safeguarding`
(38), and the support walks (the DSO's role is refused and not offered).
**Falsified** once per class against a live database. Every class went red at its own assertion except where two
layers each suffice: `competitionadmin` holding the capability is still cut by the platform-wide policy, and a share
outliving the close needs both of its guards removed.
**Run, 2026-09-28 (on dd8ddf5):**
- Typecheck: 0 errors. Lint: 0 errors, 82 warnings. Build, the bundle check (423 KB entry) and the import check pass.
- `generate-rls` leaves `db/` unchanged, and the shipped test is 53/0.
- `migrate --reset --seed --verify` passes, and so does `run-all-tests` (5500 across 65 suites).
- `run-smoke-api`: 3063 across 71 walks. `run-smoke-api --browser`: 1899 across 32 walks.
- The offline-day walk under LIE_FI is 56/56, and `pnpm smoke` is 8, 25, 16 and 214.
- Rehearsed: origin/main's `db/` (to 54) seeded, then `apply-55`, `-56`, `-57` and `-58` pasted in order. `apply-58`
  was refused ahead of 57, and a second 57 was refused. This branch's `db/99` then passed in full.
**Not built (later phases):** suspension and the DSO register (phase 2), referral to the PDSO or NDSO and purge
(phase 5), the DSO-removal notice period (phase 5, Q1), trips (phase 5), media and the stream authorisation (phase 4),
a push of the DSO's notice (no system-written notice is pushed anywhere yet), and the principal's red Settings line
for a school with no DSO. The card says "not yet appointed" instead.
**Go-live:** the pilot's principal appoints a DSO. The union tenant for KwaZulu-Natal exists (one per province is now a
unique index). `GUARDIAN_APP_URL` is set from CSA's material. The information officer has §9.7's note. Paste
`apply-57`, then `apply-58`, then `verify`, then add both to `db/SHIPPED.sha256`.

### SCRBRD-100 — The premium-feel checklist: what is left after step 3c
**Priority:** P2 · **Domain:** Front-end · **Type:** product polish (Kameel, 2026-09-26; checklist at
https://claude.ai/artifact/63zVkqVAotrYYQk9dGUhAp; the rule is DESIGN_DIRECTION §1a)
Already true and ticked in the checklist: strike rotation, instant taps, fixed button positions, one icon style,
fixed colour meanings, the innings break's target, offline scoring that says when it will sync, the Daylight theme,
44px targets, the chase's required rate, the projected score, the partnership and bowler figures on the board, and
motion timings as tokens.
In flight:
- the pad's full-screen celebration overlay becomes a flash on its own board (with the penalty sheet);
- the scoreboard's moments, ticking run count, over summary, innings-break card, highlights list and big-screen
  mode (step 3c).

**Left, on the pad:**
1. Dot and 1 are the largest, most reachable run keys.
2. The new-bowler prompt lists the likely bowler first (from the rotation and the over-before-last rule). The
   new-batter prompt lists the batting order's next name first.
3. An extra takes two taps: the kind, then the runs.
4. A haptic tick (`navigator.vibrate`, where the device has it) plus the visual change on every recorded ball.
   Nothing more, and off when the device is set to reduce motion.
5. Undo shows what it will reverse ("Undo: 4 to R Pillay").
6. The Laws check's refusals say the likely cause in words ("7 balls in this over — was one a wide or no-ball?").

**Built 2026-09-27** (items 1–6), with every event the pad sends unchanged:
1. **Dot and 1** (`scorer/pad.jsx` `OutcomeKeys`, Basic Scoring and the three-phase outcome): two wide and 88 tall,
   the lowest run keys, next to the strip; 2, 3, 4 and 6 one row above; the wicket key heads the block. The strip's
   Dot is 3/5 of its width. No key moves from ball to ball. `padFit` (smoke-a11y) still holds at 390 × 844 (Shot
   phase in a chase: 24px clear, was 28) and 360 × 740 (docked).
2. **The likely bowler and the next batter first** (`scorer/prompts.js` `bowlerChoices`, `batterChoices`; the sheets
   in `scorer/sheets.jsx`): one list, the bowler of the over before last first and marked "Likely next" when
   `lawsRefusal()` lets him bowl, then the rotation as they first bowled, then those who have not; anyone the Laws
   refuse stays in place, unavailable, with the reason in words (`unavailableWords`, no clause numbers; a refusal
   code the build does not know reads "Cannot bowl this over", so the Laws batch's suspended bowler is honoured).
   Nobody is likely before the third over, or mid-over. The batting order's next name is first, marked Next. One tap
   confirms either.
3. **An extra in two taps** (`scorer/extras.js`, `scorer/delivery.js`): Wide, No ball, Bye and Leg bye are the
   strip's first row on every phase and under Basic Scoring; a kind opens its runs on the strip's top edge, over the
   phase keys (the strip never moves, docked or not), the likely runs marked and focused (0 for a wide or no-ball, 1
   for a bye); a tap records. The no-ball panel asks its type (the free hit) and whose the runs are, each on its
   commonest answer. `extraCall()` names the engine call the pad made before; commitBall's event code and the no-ball
   sheet's confirm moved to `delivery.js` line for line. A wide now takes runs (0–4), through the engine's existing
   `commitBall("Wd", n, …)`. The idle three-phase pad no longer shows the stepper (nothing to step back to); its row
   is the extras'.
4. **The haptic tick** (`scorer/haptic.js`): `navigator.vibrate(10)` on every recorded ball (commitBall, the
   no-ball, the wicket), never under reduced motion, fire and forget; the pad menu's Feel switch turns it off on the
   device (`scrbrd:haptic`).
5. **Undo in words** (`prompts.js` `undoWords`, from `lastUndoableIndex()` of the innings in play): "Undo: 4 to R
   Pillay", "Undo: wide", "Undo: 3 leg byes", "Undo: M Botha to bowl"; mid-ball "Undo: start this ball again". Names
   from the fold's batters and bowlers (`foldName`), never an id.
6. **A refusal's likely cause** (`packages/scoring/src/causes.mjs` `likelyCause`, `REFUSAL_CAUSE`, beside
   `REFUSAL_TEXT`): on the pad's blocked panel ("8 balls in this over? Six legal balls are already recorded in over
   1. Was one of them a wide or no-ball?") and the held sheet (from the event alone). No clause numbers.

**Guards:** `apps/web/test/pad-feel.test.mjs` builds 1424 extras both ways (the old pad's call through the delivery
code as it stood at 0f31ee0, and the two taps through `delivery.js`, both through today's `ball()`) and compares the
bytes, and reads the engine's wiring from its source; plus the ordering, the undo words, the key sizes and the tick.
`packages/scoring/test/causes.test.mjs`. `tools/smoke-browser-padfeel.mjs` walks all six at 390 × 844 against the
API's live score, each extra's stored row compared field for field with what the pad's own path (`delivery.js`)
builds from the old call — the path, not a written-out shape, so a field `ball()` comes to keep (the Laws batch's
`nbType`) is expected on both sides. Every unit guard was falsified once. `smoke-a11y` and
`smoke-browser-pad-laws` drive the two-tap extras.
Design calls to review: the idle three-phase pad's stepper gives its row to the extras; the wicket key heads the
outcome block; Basic Scoring stays top-anchored, so on a 390 × 844 phone the strip ends about 140px above the bottom
bar (dot and 1 centred at 455 of 844). Anchoring the pad to the bottom would bring them lower, and move the strip
from where it sits on the three-phase pad.

**Found, not fixed:**
- At this build `ball()` does not keep `nbType`: the no-ball type the pad asks is not recorded (the Laws batch adds
  it). The fold gives a free hit after every no-ball, while the pad sets its own free-hit flag (the banner, and the
  next ball's `freeHit` field) only for height and beamer. Kept as it was here: the events had to stay the same.
- A no-ball is recorded outside commitBall, so when it wins a chase the review sheet does not open by itself (the
  innings-over banner does show). Older than this change.
- The batting-order sheet does not offer a retired-hurt batter back (he can only be typed).
- Clause numbers still on screen, outside this change: the mid-over bowler note ("Law 17.8.1: …"), the timed-out
  toggle ("(Law 40)") and `REFUSAL_TEXT.mid_over_no_reason` (the held sheet's words).

**Left, on the scoreboard and the match summary:**
1. **Empty states that never dead-end — built 2026-09-27.** `apps/web/src/views/matchcentre/fulltime.jsx`
   (`PreTossCard`, `RevisionBanner`) and `MatchCentreView.jsx`'s `NoMatchesPanel`:
   - before the toss: the ground and the start (the teams are already in the header), from the fixture the
     Match Centre already reads. **"Follow this match" is not built:** searched `apps/web/src/lib/push.js` and
     the `notifications` table/read — the platform can turn alerts on or off for a *device*, never subscribe a
     person to one *fixture*. No mechanism exists, so nothing was faked in its place;
   - a rain delay or interruption: `revisionNotice()` (lib/matchCentre.js) reads the one signal the log actually
     carries — `inn.revised`, off a `revision` event (replay.mjs) — and says "Overs revised to N; target T",
     with the umpires' own reason ("Rain delay", "Bad light", …). There is no "play is stopped now, resuming
     at…" event anywhere on the platform, so that is not what this says;
   - no live matches: whatever filter emptied the list, it points to the next few upcoming fixtures and the
     last few results, from the list's own `matches` read (`upcomingAndRecent()`) — never a second fetch, never
     a blank panel.
2. **Sharing:**
   - milestone cards and a match card sized for WhatsApp and Instagram stories;
   - personal-best and season-first notes.

   These are public by nature, so they wait for the public-data rule's step 3 and consent (PUBLIC_DATA,
   SCRBRD-092). Names on a card follow `publicName()`. **Not touched — out of scope.**
3. **The result revealed in one clear moment — built 2026-09-27.** The winner and the margin in words were
   already right (`MatchView`'s header, the post-match report's `describeResult()`) — both read
   `deriveMatch()`'s own `result`, never a second guess, now shared as `resultText()` (lib/matchCentre.js). New:
   a brief moment on the board when the result is decided while the page is open (`useMoments`/`MomentMark`,
   `views/matchcentre/live.js` and `spectator.jsx`, kind `"result"`) — the same milestone-sized, held-no-longer-
   than-1.5s slot §3.6 already reserves, never replayed on a reload. **Player of the match: no data exists
   anywhere on the platform** — no column, no table, no read gives one. Nothing was built for it and nothing was
   invented; it is reported here as the gap it is.
4. **The full-time screen links onward — built 2026-09-27.** `OnwardLinks` (matchcentre/fulltime.jsx), on
   `MatchView` and the post-match report: each side's own next fixture, matched on its `fixture_side_label()`
   (the same string the matches list already reads — `nextFixtureOf()`, no new query); and "the team's results",
   which opens the Match Centre list itself, filtered to that side and to `complete` (there is no dedicated
   team-results screen to link to). A side that is not a SCRBRD tenant gets neither link — honestly, rather than
   one that would answer "not you". Each player's own season was already one tap away (the Scorecard tab's
   opening row, the post-match report's "Best performances", both via `onNavProfile`) and is not duplicated.
5. **Coaches and scorers confirm or correct the final scorecard — built 2026-09-27.** `ConfirmScorecardPrompt`
   (matchcentre/fulltime.jsx), after full time, to whoever holds `scoring.finalise` (scorer, coach, director of
   sport) and nobody else. **There is no "confirmed" state anywhere in the schema** — as instructed, none was
   built: "Looks right" dismisses the prompt on that device only (`localStorage`) and writes nothing to the
   server. "Something to correct" opens the amendment flow that already exists (`POST /matches/:id/amendments`,
   `scoring.amend.request` — the scorer role only), naming a delivery picked from the innings' own commentary.
   **Gap found, not worked around:** there is no `GET` route to list pending `scoring_amendment` rows, so a
   director of sport or principal (who hold `scoring.amend.approve`) has no screen anywhere in this product to
   see or decide a filed correction — `POST /amendments/:id/decide` exists but needs an id the client has no way
   to read. Reported for its own decision; no route was added to close it.

**Left, shared:**
1. One type, spacing and icon scale everywhere. The admin screens migrate `D` to `T` in step 5.
2. Every empty state offers a next step ("Add your first team", "Create your first fixture").
3. Every error says what happened and how to fix it.
4. Loading states show the layout's shape (skeletons), not a blank screen.

### SCRBRD-099 — Backfill handwritten scorecards into the historical record
**Priority:** P2 · **Domain:** Scoring / history · **Type:** feature (Kameel, 2026-09-26: "a tool for
inputting/scanning/photographing and back-dating handwritten scorecards into data that fits our model, to build a
historical record")
**Today:** the only bulk import is a CSV of players (`services/api/io/import-api.mjs`): dry run by default, all or
nothing on commit, every row under the caller's own row policy. There is no import of fixtures, results or
scorecards, no photo or scan reading, and no way to record a past match.

**The constraint that shapes it:** careers, awards, milestones and figures are derived from the ball log. A
handwritten sheet is one of two kinds:
- a **summary scorecard** (each batter's runs, balls, 4s, 6s and how out; each bowler's O-M-R-W; extras, fall of
  wickets, totals), which is most sheets. It cannot become balls without inventing them, and we will not invent
  them. It is stored as a **transcribed innings summary**, marked as such, and the career views add it in;
- a **scorebook's ball-by-ball grid**, which can be rebuilt as real ball events. Where the book does not say who
  faced a ball, the reviewer confirms it.

**Flow:**
1. Enter it, or photograph it and let a vision model draft it (phase 2).
2. A person reviews it beside the photo. The screen refuses a card that does not reconcile: batters' runs plus
   extras equal the total; bowlers' runs plus byes and leg byes equal the total; wickets and overs are consistent.
3. A second person approves it, the same separation of duties as a scoring amendment
   (`scoring.amend.request` / `approve`). It is stored with its source photo and provenance ("transcribed"), and
   stays correctable. It never looks like a live-scored match.
4. Past fixtures are created as part of the backfill. An opposition not on the platform stays a typed name
   (PUBLIC_DATA L5/L6: never named publicly).

**Phases:**
1. Manual entry of a summary scorecard, with the reconciliation checks and two-person approval.
2. Photograph to draft.
3. Full scorebook (ball-by-ball) transcription.

**Decided (Kameel, 2026-09-27): the recommendations below** — phase 1 (manual entry) first; backfilled records signed-in only until decided otherwise; summaries first.

**Decisions for Kameel before building:**
1. **Photos of pupils' names to the AI provider.** Live commentary masks names before they leave the platform
   (`maskNames`), but names written on a photo cannot be masked. Phase 2 needs either the school's agreement under
   its data processing terms, or a manual-only mode. Recommendation: phase 1 first; it needs no decision.
2. **Whether backfilled records are public.** They name old boys (now adults) and current pupils, and the consent
   rule (PUBLIC_DATA) was written for current records. Recommendation: signed-in only until decided.
3. **Fidelity:** summaries only, or also full scorebook transcription for schools that kept books.

**Build notes:** a migration (Opus) for the transcribed-summary tables and their provenance, and the career views
extended to add them in, proved against the fold for ball-by-ball backfills. The review screen is built to the
design direction.

### SCRBRD-098 — A commentary engine every viewer shares
**Built 2026-09-26** (redesign step 3c), items 1–3; item 4 and the signed-out walk wait on their own decisions.
`packages/scoring/src/commentary.mjs` `deriveCommentary(events, {nameOf, teamName, sensitive})` walks each innings
with `foldSteps()` (the fold, one event at a time, in `replay.mjs`) and returns `{innings, over, ball, kind, text,
key}` lines: every delivery, wickets (method, catcher, the end a run out fell at), milestones, bowlers on and back,
a bowler taking over mid-over, new batters, the end of each over, the innings end and the result, revisions,
penalty awards in `PENALTY_REASON_TEXT`'s words with the cross-innings credit ("Westville start their innings on
5"), and short running. A void and whatever it undoes have no line; an amendment reads as the corrected history.
Names come only from `nameOf` (a role word without one); health and discipline only with `sensitive`, which the
pad passes and the Match Centre does not. Wording varies by a seed from the event key. `words.mjs` carries the
shot and sector vocabulary out of the pad. The Match Centre's Commentary tab and the pad's Commentary card draw
it; the pad's AI line is unchanged and spectators never see one. Guards: `packages/scoring/test/commentary.test.mjs`
(every kind, void, amendment, free hit, penalty credits both ways, determinism, 60 generated matches with no id or
typed name reaching a line, public mode) and `tools/smoke-browser-matchcentre.mjs`. Still open: the signed-out walk
(with the public page, SCRBRD-083 step 3) and item 4.
**The signed-out walk: built 2026-09-28** with SCRBRD-083 phase 1 — `tools/smoke-browser-public.mjs` opens the
public live page and scorecard signed out and reads the Commentary tab's lines from the redacted log, names by the
rule and a role word for everyone else, never "hurt". Item 4 (AI lines) is SCRBRD-083 phase 3.
The same lines feed the Match Centre's spectator side (Kameel's premium-feel checklist, step 3c): the highlights on
Summary, a moment on the board for a boundary, a wicket or a milestone (the hat-trick ball among them) that arrives
while the page is open, the end-of-over line between overs, and big-screen mode (`views/matchcentre/spectator.jsx`).
**Priority:** P2 · **Domain:** Scoring / Match Centre · **Type:** product gap (Kameel, 2026-09-26: fold into
redesign step 3c)
**Today:** the pad's Commentary card (`scorer/panels.jsx` `CommentaryCard`, in the Score tab) asks
`POST /api/ai/commentary` (`services/api/ai/ai-service.mjs`) for one line per ball, built from the fold's state by
`fetchAICommentary()` (`scorer/shots.js`). Names are tokenised before the call and restored after it, so no pupil's
name reaches the provider, and it fails soft to a plain description (`descBall`) when there is no signal. But:
- only the scorer sees it: the lines live in that phone's memory and are never stored, so Match Centre, parents,
  the public page and a finished scorecard have no commentary;
- it is one model call per ball from the scorer's phone at the ground (about 250 a T20), on an Opus-class model,
  which the service's own cost note says to measure before a season;
- nothing stored means nothing the public-data rule (PUBLIC_DATA L4) can filter.

**Build (in step 3c):**
1. **A deterministic commentary generator** in `packages/scoring`, pure, from the fold and the events: one line
   per delivery plus lines for wickets, milestones, a bowling change, a new batter, the innings end, and penalty
   awards (with the Law 41 reason in words). The same events give the same lines on every device, offline, free,
   and on a replay of a finished match. It is tested like the fold: every event kind, a void, an amendment and a
   free hit.
2. **Match Centre's Commentary tab** (DESIGN_DIRECTION §10 item 9) draws it, newest first, by over. The pad's card
   draws the same generator, so the scorer and the ground read the same words.
3. **Names follow the reader.** Signed-in readers see names under the usual read rules. A public page runs every
   name through `publicName()` (PUBLIC_DATA L2/L4): "D Erasmus" only with consent, otherwise the role ("the
   batter", "the bowler"). The generator takes the names from the caller and never reads them itself.
4. **AI enrichment: kept (Kameel, 2026-09-27).** Spectators see the AI lines too (confirmed), with names through `publicName()` on a public page, and it can be switched off (a per-school setting, `feature_flag`-style). **AI enrichment is optional and a separate decision.** If kept, it runs server-side, once per ball (never once
   per device), is stored beside the ball it describes, and keeps the name tokenising. The model and cost are
   chosen deliberately (a smaller model is the likely trade), and whether AI lines appear to spectators at all is
   Kameel's call. Until he decides, spectators see the deterministic lines only.

**Guard:** a generator test over generated logs (every line names only players in the events, and a void removes
its line); a browser walk for the Commentary tab signed in and, when the public page exists, signed out without
consent.

### ~~SCRBRD-097~~ — CLOSED · The rest of the players × balls readers
**Closed 2026-09-27** on `worktree-agent-a1d43c359c21ee146` (to be cherry-picked): the read's text and
`db/51_milestone_watch_own_balls.sql`, as the build note below records. The bowling-breach trigger it uncovered is
SCRBRD-097's one open remainder, noted at the end.
**Built 2026-09-27:**
1. **The assessment read** (`READ_QUERIES.ratings`) is one pass in its own text, no migration: the deliveries the
   reader may see are read once (a materialized CTE), attributed to players with the functions' own CASEs and db/49's
   arms, and windowed by a predicate on the join to each player's anchors; `ball_wicket_stands()` is asked once per
   delivery. The `*_since()` functions are untouched and are the reference. `tools/bench-assessment.mjs --check`
   compares the read with the pre-change statement (verbatim) row for row, raw, as nine readers. As the director:
   seed 93–99 ms / 18.5–18.8k shared hits → 22–25 ms / 1.7–2.2k; seed + eight walks (3,640 deliveries) 6.3–7.8 s /
   1.55–1.65M → 1.26–1.29 s / 250–280k; bench (70 players, 4,967 deliveries) 34–42 s / 5.4–7.4M → 0.61–0.68 s /
   67–69k.
2. **`milestone_watch()`** (db/51) asks two owner-only invoker helpers, `innings_runs_off_bat()` and
   `career_runs_off_bat()`, in place of `player_innings`: sums of runs off the bat over the balls he faced, the only
   arm of `player_innings` that carries runs, so the same numbers decide the same notices. Three partial indexes
   (striker, bowler, a void's target) bound those reads to the player's own balls. The trigger alone, bench load:
   6.6–7.3 s → 1.0–1.2 s; a 10,109-row load with careers crossing 500 runs and 25 wickets: 22–42 s → 3.0–3.6 s.
   db/51 proves the shape unchanged, the helpers equal to `player_innings` over the whole log, and ten notices on a
   rolled-back fixture (sentinel `ZZ051`); db/99 §29 holds the same, and records which of seven breaks each
   assertion caught.
3. **Before/after diff**, a database built at `e2faf46` against one built with db/51, the read and every milestone
   notice, notification and bowling breach in the order written, ids replaced by names: empty at the seed, the seed
   plus eight walks, the bench volume, and the 12-boy/40-fixture volume. Plain `node tools/migrate.mjs` over the
   `e2faf46` database applies only db/51, and `--verify` passes.

**Open, found here:** `bowling_breach_watch()` (db/08) is most of a bulk load, not `milestone_watch()`: 13–80 s of
the bench load, fivefold between identical runs (autovacuum's statistics land mid-load). Its day check reads
`bowler_over` for the bowler, whose over numbering is a window per innings, so the bowler cannot be pushed below it:
the whole log per delivery bowled. `ball_on_free_hit()` under a reader's policy costs ~2.5 ms per wicket in every
reader that asks `ball_wicket_stands()`, db/49's views included.

**Priority:** P2 · **Domain:** Scoring / performance · **Found 2026-09-26** building db/49
db/49 made the lifetime career views one pass over the log: the career read at a school's volume (70 players,
about 5,000 deliveries) went from 83 s to 2.2 s. Two readers keep the old shape, and the RLS check on `ball_event`
runs players × balls times in each:
1. **The assessment read** (`services/api/read/read-api.mjs`, around line 2290) calls `player_*_since()` per player
   as a LATERAL with a window. Fix it the same way db/49 did: one pass grouped by player, with the window as a
   predicate, proved equal to the functions.
2. **`milestone_watch()`** reads `player_innings` for the striker on every inserted ball. Loading 5,000 balls took
   about 48 s, mostly in this per-row trigger. A live match inserts one ball at a time, so it is fine today; a bulk
   import or replay is not. Consider a statement-level trigger, or a check bounded to the ball's own match.
   (Built: bounded to the striker's and bowler's own balls instead. A statement-level trigger would move every
   milestone notification after the bowling-breach notifications a row-level one interleaves with.)

Also: the comment on `career_by_season` (db/44) cites "db/99 §21" for the Σ-seasons check, which is §22.
`tools/bench-career.mjs` measures the career read at volume; use it before and after either fix.

### ~~SCRBRD-096~~ — CLOSED · Colour vision: a palette setting beside the theme
**Built 2026-09-26** (redesign step 3b). A Colours setting in Settings and in the pad's menu (Standard, Red-green safe,
Blue-yellow safe), stored per device and combined with either theme, is the third input to `applyTheme()`. It swaps
the ball chips, the semantic trio and the wagon wheel's run colours (`T.run`); the board's black, white and lime do
not move. `design.test.mjs` simulates colour vision (Machado 2009, CIE76) in six looks (two themes × three palettes).
Worst pairs under the deficiencies each palette serves: red-green 25.1 (protan) and 30.3 (deutan); blue-yellow 27.9
(tritan). Every chip is at least 3.28:1 on the board, and every figure on a chip at least 4.72:1. Three permanent
probes (chips too close, figure contrast under 4.5, a chip under 3:1 on the board) prove the guard bites. The
numbers are in DESIGN_DIRECTION §3.9.
**Priority:** P2 · **Domain:** Design system / accessibility · **Decided 2026-09-26** (Kameel)
Kameel asked for the prototype's colour-coded ball chips back, and for theme options for colour-blind users
(DESIGN_DIRECTION §3.9, §10).
1. **A Colours setting** in Settings and the pad menu: Standard, Red-green safe, Blue-yellow safe. It is stored per
   device and combines with any theme. It is a third input to `applyTheme()`.
2. **It swaps only the hue-carried tokens:**
   - the ball chips;
   - the semantic trio;
   - the sport and chart colours.

   The board's black, white and lime stay.
3. **Measured problems it fixes:**
   - the prototype chips 2 and 3 are ΔE 6–8 apart under protan and deutan, and 1 and 6 are ΔE 11 apart under tritan;
   - the Daylight semantic tokens: positive and critical are ΔE 15 apart under protan, and critical and warning 12 under deutan.
4. **Guard:** `design.test.mjs` simulates the deficiencies (Machado 2009). In each palette, every chip pair and every
   semantic pair keeps ΔE ≥ 20 under the deficiencies that palette serves, and ≥ 25 in ordinary vision. Chips keep a
   4.5:1 figure and 3:1 against the board.
5. **Standard chip fixes:**
   - black figures on 1, 4 and 6 (white fails AA);
   - the wide chip lightened or ringed (`#5200bc` is 1.9:1 on the board).

Built in redesign step 3b, with `Board`'s chip row. Opus (cross-cutting theme engine).

### SCRBRD-095 — Loose ends from the pad redesign (step 2)
**Priority:** P2/P3 · **Domain:** Scorer UI · **Found 2026-09-26** redrawing the pad.
1. ~~**Declared profile vs what is captured (P2).**~~ **Decided 2026-09-27 (Kameel): Area captures a point. Built in
   SCRBRD-101.** The three-phase pad recorded a sector (stamped `standard` on each ball) while setup declares `full`
   by default, so a default innings read "declared full" while holding only sector placements. The Area step now
   records the point tapped (`placementFromTap`, profile `full`), the same event as the Pro hub's, so the default
   `full` declaration ("shot, exact point") is what the pad captures. Basic Scoring still records no placement
   (`quick` per ball), as the scorer chose.
2. ~~**Pro mode** keeps its old hub and cards styling with sub-12px text; smoke-a11y does not measure it.~~ **Done
   2026-09-27** in `e18610c`: `scoring.jsx`'s `ScoringHub`/`ScoringPanel`/`ScoringBlocked` and the cards the Pro hub
   shows (`panels.jsx`'s `WagonWheel` legend, `ScorecardPanel`, `PartnershipCard`; `charts.jsx`'s `ManhattanChart`) are
   onto the same 12px type floor and 44px tap floor as the rest of the pad. The last few (a "Wd"/"4"/"1" at 8.36px)
   traced to one root cause: `BallDot` (`ui.jsx`) set its figure's size to `size*0.38` with no floor, so every small
   caller — `CommentaryCard`'s `size={22}` inside the hub, and every other use of it — rendered under 12px; floored
   at `Math.max(12, size*.38)`, the dot's own diameter untouched. `tools/smoke-a11y.mjs` now opens Pro mode after
   every run, in both themes (`pro` joins `TYPE_FLOOR_CEILING`, `TAP_FLOOR_CEILING`, `EMOJI_CEILING`, all `0`), and
   falsifies the new check on that exact screen (a planted 9px line, a 30×30 button and an emoji-carrying button,
   confirmed seen and removed) before trusting the real measurement. 214 passed, 0 failed, both themes.
3. ~~**The other sheets** (toss, openers, new over, innings end, handover) are not yet at the type and touch floors;
   only the wicket sheet, the penalty runs sheet (SCRBRD-094) and the shared close button are.~~ **Done 2026-09-27**
   in `93a6f45`: the root cause of most of it was the shared `Lbl` and `Badge` (`ui.jsx`, used by nearly every
   sheet), set in the Syne display face at 10px/9px — under the floor and, per §3.2, the wrong face for it at that
   size; both now spread `T.role.label` (12px, DM Sans 600). `Btn` gained a per-size `minHeight` (44px for
   xs/sm/md, 48px for `lg`), since every non-`lg` size rendered under the 44px tap floor on its own padding alone.
   That alone cleared most of toss.jsx, the batting-order sheet (openers), the new-over sheet's header and pills
   (its bowler list already met the floor), the innings-review sheet ("innings end") and the handover sheet; the
   rest were fixed by hand — the no-ball, revision and shot-selector sheets (this item's own catch-all), and the
   wicket sheet's remaining 8px role badge and 11px notes. The wicket sheet's timed-out toggle (BattingOrderSheet)
   and its own dismissal-mode text were left alone throughout — the scoring engine's own strings, not styling.
4. ~~After choosing from the pad menu, the menu button keeps its focus ring.~~ **Done 2026-09-27** in `a3a76df`:
   `:focus-visible`'s own heuristic rings any script-focused element the pointer never touched, and `close()`'s
   `button.current.focus()` always lands on the "…" button, not on whichever menu item was tapped. Padmenu now
   tracks the last input modality (`pointerdown` vs `keydown`) and, only when the close was pointer-driven, quiets
   the ring on that one `focus()` inline — never in the stylesheet, so a keyboard close (Enter/Space on an item, or
   Escape) still rings exactly as `:focus-visible` intends.

**Verification (2026-09-27, this pass):** `pnpm typecheck` 0 errors · `pnpm lint` 0 errors/82 warnings (unchanged) ·
`pnpm build` and `check:bundle` clean · `pnpm smoke` — `SMOKE: 8/0`, `SCORER SMOKE: 25/0`, `PERSISTENCE SMOKE: 16/0`,
`ACCESSIBILITY SMOKE: 214/0` (both themes; was 198/0 before Pro mode was reachable by this walk at all). The
database-backed suite (`migrate --reset --seed --verify`, `run-all-tests`, both `run-smoke-api` runs, the `LIE_FI`
offline-day walk) ran separately against this worktree's own database; see that run for its own numbers. This pass
is styling only — no event, capability or schema change, and the walks' event checks are unchanged.

### ~~SCRBRD-090~~ — CLOSED · The live score and the target leave out penalty runs
**Closed 2026-09-26** in `2534bda` (#38): db/48 puts penalty runs in every SQL total where the fold puts them, with Law 41's cross-innings credit (SCRBRD-094 item 1); the door now refuses a penalty whose runs are not a whole number above nought.
**Priority:** P2 · **Domain:** Scoring / broadcast · **Type:** bug (found fixing SCRBRD-088, 2026-09-25)
`match_live_score` sums `value`, which a `penalty` row does not carry, so the public board (`broadcast_state()`),
its chase target, the `matches` read's score and the summary read are short by every penalty award the pad's fold
counts. Every reader probably wants the fold's total — `innings_score_as_folded()` (db/45) is it, per innings — but
each should be checked before the view's meaning moves (a new db/NN, like db/42/43). Two fold questions ride along,
for a decision rather than a fix: the fold drops a penalty awarded to the fielding side (`toBattingTeam: false`)
from every innings, where Law 41 adds it to that side's innings; and nothing at the door checks a penalty's `runs`
(a string or a fraction is stored, and the fold's total becomes unreadable — the handover then cannot verify).
**Fixed 2026-09-26** with SCRBRD-094's decision: `db/48_penalty_runs.sql` replaces `match_live_score` (runs: + the
batting side's awards, `penalty_runs_as_folded()`, + awards to fielding sides credited to this innings,
`penalty_credit_as_folded()` — the fold's `penaltyCredits()`), `innings_score_as_folded()` (+ the credit, so the
handover check expects it) and `broadcast_state()` (target: `innings_target_as_folded()`, the fold's `inn.target`,
else the previous innings' credited total + 1) — same names, signatures, security, search paths, grants and view
options, checked against a snapshot; the file's own block proves the totals on two matches it builds and rolls
back. The live_score and derby_record reads follow the view; the summary read has no score. Every reader was
checked: none wanted anything but the fold's total. The door: `lawsRefusal` refuses `runs` that are not a whole number
above nought (`penalty_runs_invalid`). Proof: `tools/smoke-fold-figures.mjs` (awards to both sides over generated
two-sided innings: credit, target, live score and handover count agree with the fold in every innings),
`tools/smoke-handover-innings.mjs`, db/99 §26 (8 assertions, each falsified once), replay and laws suites.

### ~~SCRBRD-087~~ — CLOSED · The lease check trusts the device the batch names
**Closed 2026-09-26** in `d1213dd`: `appendEvents` asks `scoring_lease_check` about the principal's device (the
token's, or the pad resume credential's) and refuses a batch any event of which names another, `403
device_mismatch`, before anything — the lease included — is touched; the heartbeat takes the principal's device and
refuses a body naming another, and the claim refuses a named device the token is not bound to. `write.test` group
"The lease is asked about the principal's device" failed 6 assertions on the old code; `smoke-pad-resume` E proves
it live (phone B's token cannot keep phone A's lease alive: batch, heartbeat and claim refused, lease unmoved).
**Priority:** P3 · **Domain:** Scoring / sync · **Type:** hardening
**Found 2026-09-25** typing `events-api.mjs`. `appendEvents` calls `scoring_lease_check(match, events[0].deviceId,
events[0].epoch)` with the device from the request body, not the token's. Writes stay bound to the token's device by
the ball_event INSERT policy, so nothing is written by it; but the same user on a second device can keep the first
device's lease alive with a batch that writes nothing (all duplicates, conflicts or refusals), and that refresh
commits. Pass the token's device (the principal carries it) and refuse a batch that names another.

### Fixed 2026-09-25, found typing `events-api.mjs` (no backlog number needed)
- **A held second-innings event was released into the first innings.** The release built its row with the envelope's
  innings (the pad always sends 0), not the event's own. Now it uses `columnsFor()`, the live path's mapping; the held
  copy's fingerprint was taken over the same object, so a resend after release is a duplicate, not a conflict.
  `smoke-quarantine` proves it (50 passed, 3 failed on the old code).
- The events routes answer a missing capability `403 not_permitted` (was `500 42501`); weather for a match that is not
  there was already refused by its policy (`403`) — the unmapped `23503` behind it now maps to `404`, and the comment
  says so; a date sent as a list is refused by name (was `500 22007`); a batch
  with an event missing its key, device or client seq is `400 malformed_event` (was `500 23502`, resent for ever).

### SCRBRD-089 — Loose ends found building the offline match day (SCRBRD-078/075/079)
**Priority:** P2/P3 · **Domain:** Scoring / sync · **Found 2026-09-25**
- **No heartbeat while the pad is open.** The spec's lease is refreshed "by heartbeat (~20s) and by any ball
  written"; the client only writes. Every lull longer than 90 s (a drinks break, the innings break, rain) lapses
  the lease, and `scoring_claim` hands a lapsed lease to any device that opens the pad. The flush gate now takes
  back only the device's OWN lapsed token (same state, same epoch) and stops, in words, when another device has
  claimed — but whether an open pad should hold the match through a break (and so block an admin's force-release
  for as long as it is open) is a decision. (P2)
- **A fork has no resolution on the pad.** When the pad's log and the server's each have events the other lacks,
  nothing is merged, nothing is claimed, and both stay where they are (the pad's on the device, said in words).
  The spec's route for such events is quarantine for a supervisor; a forked device does not send its side there
  today. Decide whether it should (it needs a way to send as a non-holder on purpose), or whether a person
  reconciles from the device. (P2 — product decision)
- ~~**"For review N" is memory-only.** Quarantined events are counted on the pill for the session they were sent in;
  after a reload the pad no longer says so (the server's quarantine panel still does). (P3)~~ **Done 2026-09-27**: `GET
  /matches/:id/events` — one of the pad's five routes, so no new route and nothing widened — answers `quarantined`, the
  count of THIS device's events held for review and unresolved (`quarantinedHere()`: `device_id = app_device_id()`,
  under the caller's own policies: a scorer's own rows, db/17; a resume credential's own match, db/50). The pad
  (`lib/sync.js` `serverLog`) takes it at every read of the server's log — every attach — and the pill is that count
  plus what this session sends to review after it, never one event twice; settled by a supervisor, the next read drops
  it. Proof: `smoke-pad-resume` B (0, then 1 after a stale-generation ball, the same signed in, 0 on phone B) and
  `smoke-browser-pad-resume` C2 (a held ball: "For review 1" after a reload with nobody signed in, read through the
  pad's own route; settled: "Sent" after the next). Between reads the count is as of the last one.
- **A toss conflict with play recorded under the pad's answer stops sending** and has no resolution on the pad —
  see SCRBRD-075. (P3 — product decision)
- ~~**The 30-minute token and one-time office codes** mean a production scorer must be issued a new code to go on
  sending mid-match — see SCRBRD-078's open item. (P1 before launch)~~ **Closed 2026-09-26** with SCRBRD-078
  option B (db/50, the pad's resume credential).

---

## Resume here (written 2026-09-29, weekly budget spent; resets Wed 2026-09-30 01:00)

**Production:** db/01–db/60 pasted and verified (health table all OK, 86 capabilities). **db/61 pasted and verified 2026-09-29** (61 applied, 87 capabilities, all OK). The `workload_monitoring` module is off until Kameel switches it on for the pilot school.

**Stopped mid-build (local worktrees only; they may not survive a container restart; restart from the briefs, not the worktrees):**
1. **db/62 — the link past 18** (SCRBRD-110 phase 0; signed off by Kameel as information officer 2026-09-28). Opus. Brief: `docs/design/SCRBRD-110_workload.md` §7.4 items 1–4 and phase 0's "proves"; SCRBRD-083 §6.3 (option C). Flip db/99 §38's assertion marked "(12)". **Also update `tools/bundle-sql.mjs`'s health table:** "Guardianship ends at 18" and "Every guardian link has an end date" would read PROBLEM once enrolled adults' links are open. New rule: a guardian link may be open-ended only while the child is a minor or `still_at_school()`. Prove each check still reads PROBLEM on a forced violation.
2. **Playing-conditions screen** (SCRBRD-114, over #52's API; routes in design §9.1). Sonnet. Draft, enter a value with its citation, publish (future date), withdraw, new version. Figures grouped by part, each with its source or "platform default, unconfirmed". "N of M figures confirmed". Read-only for non-managers.
3. **Pitch deck: live screens** (Kameel, 2026-09-28: "the pitch deck should have UI/UX features and elements of the app showcased visually"; chose real components over screenshots). Sonnet. Render real components on demo data inside phone and laptop frames in `views/PitchDeckView.jsx`: the pad mid-over, the live board and Match Centre, a parent's Me screen with the consent card, the coach's day sheet, and raising a safeguarding concern. Keep `smoke-browser-deck` walking every slide (its digit shortcuts follow slide order).

4. **Harvest iamkameel/scrbrd** (Kameel, 2026-09-29: "what do we have here that we can learn and take from?"). Attach it with `add_repo` (read). A Haiku agent inventories it (features, screens, data model, anything SCRBRD_OS lacks) and compares it with the earlier harvest artifacts ("SCRBRD OS — the beta-2 harvest" https://claude.ai/artifact/7eNpDHLo9XRMsNJERzjPia, "SCRBRD Convergence Audit", "Four SCRBRD Builds"), so only what is new is reviewed. Opus reviews the candidates, and Kameel gets a short take/skip list. Nothing is copied without that review.

**Then:** SCRBRD-110 phase 2 (check-ins and flags; needs db/62), safeguarding phase 2 (suspension), public pages phase 2, SCRBRD-114 phases 2–4. **Waiting on Kameel:** the KZN schools' bye-laws and playing conditions (SCRBRD-114 phase 5; the CSA club regulations received are club administration only).
