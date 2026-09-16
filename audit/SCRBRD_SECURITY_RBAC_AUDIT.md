# SCRBRD OS — Security, RBAC & Privacy Audit

**Pass:** Focused Pass 1 · **Branch:** `claude/ui-refactor-ds2` @ `0783ed5` · **Date:** 2026-09-16
Evidence keys: `[code]` read from the file cited · `[runtime]` observed against a rebuilt local DB or the production verify bundle · `[falsified]` the guard was broken, the test went red, the guard restored, the test went green · `NOT VERIFIED` not checked in this pass.

## 1. Scope

Authentication, capability assignment, scope, RLS, column masking, multi-tenancy, feature gates, minor data and sensitive data. Product-wide UX, performance and most data-architecture questions are out of scope for Pass 1.

## 2. Trust Model

```text
UNTRUSTED  Browser state (role string, capability list, form values)
           └─ used for rendering only; 11 views still gate buttons on role strings (cosmetic)
SEMI       API process (services/api)
           └─ verifies bearer token, sets app.user_id inside a transaction, forwards to Postgres
           └─ withPrincipal(): ROLLBACK on throw — no half-written state survives an error
AUTHORITY  Postgres
           └─ app_can(capability, school, team, person, fixture): one decision function
           └─ RLS on all 74 tables; policies GENERATED from packages/policy (never hand-edited)
           └─ 21 *_masked views, security_invoker=true; sensitive columns gated per tier
           └─ connection role scrbrd_app: no CREATE on any schema, no BYPASSRLS
THIRD PARTY Anthropic (AI text), Firebase (Analytics), Render, Supabase
```

## 3. Authentication Findings

| ID | Finding | Severity | Evidence | Recommendation |
|---|---|---|---|---|
| AUTH-01 | On the production URL, the only path that creates a server session is invite-code redeem. The "Google" button calls `onLogin("schooladmin","Demo User (Google)")` on the client with no token; `signedIn()` is then false and every `useLive()` call serves mock data. A visitor who clicks it sees a fully working app labelled "Demo data" and may believe they are using the product. | **P1** | `[code]` `apps/web/src/auth/LoginPage.jsx:160`; `apps/web/src/lib/api.js:50`; `apps/web/src/lib/live.js:885,961,1005`. `[runtime]` production dashboard screenshot shows "Demo data" label after Google login. | Remove or clearly label the demo entry on the live login page, or wire Google to a real identity provider that mints a server token. |
| AUTH-02 | Dev login is refused outright in production. | Pass | `[code]` `services/api/server.mjs:251` `if (!DEV \|\| process.env.ALLOW_DEV_LOGIN !== "1")`; `render.yaml:30-31` `NODE_ENV=production`; `render.yaml:50-53` documents `ALLOW_DEV_LOGIN` absent. `[runtime]` production `/api/health` could not be reached from the audit container (proxy 403) — the `auth: token_only` line at `server.mjs:564` is `NOT VERIFIED` live; the user's production screenshot shows a code-issued session working. | None. Keep the `render.yaml` comment — it is the only place the invariant is written down for operators. |
| AUTH-03 | `login_code` and `schema_migration` have RLS enabled with zero policies (deny-all for `scrbrd_app`); codes are only touched through `SECURITY DEFINER` functions. | Pass | `[runtime]` `pg_policies` count 0 for both; `relrowsecurity = true`. | None. |
| AUTH-04 | Sign-out clears the IndexedDB `session` and `kv` rows of any trace of the departing person and returns to the landing page. | Pass | `[falsified]` browser walk `smoke-browser-read.mjs` sign-out group: assertion reads stored row after sign-out; guard broken → red; restored → green. | None. |
| AUTH-05 | Session token lifetime, rotation and revocation on password/code reissue. | `NOT VERIFIED` | Not examined in Pass 1. | Cover in Pass 2 (`docs/AUTH_SPEC.md` claims should be tested). |

## 4. Capability + Scope Model

### Verified model

- 81 capabilities, 25 roles `[code]` `packages/policy/src/capabilities.mjs`, `roles.mjs`.
- `app_can()` has **no school wildcard**: a `role_assignment` with `school_id NULL` is a platform-wide key and satisfies any school; any other assignment must match the school `[runtime]` `db/99` "owner's key reaches every tenant" section PASS; coach's key does not.
- Liveness enforced on every call: `role_assignment.valid_from/valid_until` **and** `assignment_subject.valid_from/valid_until` with `valid_until > current_date` `[falsified]` five stale `valid_until IS NULL` predicates were found and replaced in `db/08_schema_programme.sql`; `db/99` expiry section red before fix, green after.
- `superadmin` holds all 81 capabilities (`roles.mjs:89`); `platformadmin` holds 14 platform capabilities and is what the demo alias resolves to. The owner account `88888888-…-0022` carries a platform-wide `superadmin` assignment `[code]` `db/98_seed_pilot.sql`.
- `platform.support.impersonate` is defined and granted (`roles.mjs:96`, `capabilities.mjs:287`) but **no route or function implements it** `[code]` grep of `services/api` finds only the policy definitions. A capability that governs nothing is a latent trap: a future author may assume it is enforced.

### Cross-assignment escalation tests

| Scenario | Expected | Actual | Result |
|---|---|---|---|
| Coach at school A reads school B roster | Deny | 0 rows | PASS `[runtime]` `db/99` tenant section |
| Coach of 1XI writes to 2XI training log | Deny | refused | PASS `[runtime]` `db/99` team-scope section |
| Guardian reads own child's `injury_masked` details | Allow | allowed | PASS `[runtime]` |
| Guardian reads unrelated child at same school | Deny | 0 rows | PASS `[runtime]` |
| Guardian link after child's 18th birthday | Deny | 0 rows | PASS `[falsified]` `_set_born(P_ADULT)` / `_expire_link` |
| Expired `role_assignment` used today | Deny | refused | PASS `[falsified]` |
| Platform-wide `superadmin` reads any tenant | Allow | allowed | PASS `[runtime]` production verify bundle 8/8 OK |
| Capability from role X + scope from role Y (two assignments, cross-applied) | Deny | — | `NOT VERIFIED` — needs a dedicated `db/99` section constructing two disjoint assignments. |

## 5. Tenant Isolation

| Test | Expected | Actual | Result |
|---|---|---|---|
| School-scoped read across tenants (`team`, `player`, `fixture`) | 0 rows | 0 rows | PASS `[runtime]` `db/99` |
| Competition-scoped news read by non-entrant | Deny | 0 rows | PASS `[runtime]` `db/99` newsfeed tiers, `competition_entrant` join `db/12_news.sql:73` |
| Platform-wide key (`school_id NULL`) | Allow everywhere | allowed | PASS `[runtime]` |
| Insert with foreign `school_id` under own role | Deny | refused | PASS `[runtime]` |
| Masked view leaks a gated column cross-tenant | 0 rows (RLS runs before masking) | 0 rows | PASS `[runtime]` all 21 views `security_invoker=true` |

## 6. Guardian / Subject Scoping

| Test | Expected | Actual | Result |
|---|---|---|---|
| `assignment_subject.valid_until = greatest(majority_on(born), valid_from)` backfilled | every open link to an adult closed | 0 open links to adults | PASS `[runtime]` `db/10_guardian_majority.sql` |
| Child with NULL `born` | link ended today + named WARNING | as expected | PASS `[runtime]` `db/10` |
| New guardian request for a pupil born > 18 years ago | refused **before** any INSERT | refused, no orphan `role_assignment` | PASS `[falsified]` guards moved ahead of INSERT in `db/08`; direct-SQL count assertion in `db/99` (HTTP could not observe the orphan because `withPrincipal()` rolls back) |
| `enrol_person` refusal | no `app_user`, no assignment, no subject left behind | counts unchanged | PASS `[falsified]` subtransaction `RAISE … ERRCODE check_violation`; `db/99` "enrolment leaves nothing behind" |
| DOB required for new pupils | `player_born_required CHECK (born IS NOT NULL) NOT VALID` | enforced forward-only; legacy rows warned | PASS `[runtime]` `db/11`; `smoke-roster-add`, `smoke-csv` DOB groups |
| SA ID ↔ DOB disagreement | 400/422 with named reason | as expected | PASS `[runtime]` `packages/policy/test/date-of-birth.test.mjs` (29), `smoke-enrol` (31) |

## 7. Medical Data Boundaries

| Capability | Data exposed | Intended users | Verified? |
|---|---|---|---|
| `medical.status.read` | available / unavailable only | player, enquiry, teammanager, principal, DoS, schooladmin, sportsadmin, coach, guardian, medical, selfaccess | `[runtime]` generated `injury_masked` (`db/09_rls_policies.sql:822-863`) exposes only status columns to this tier |
| `medical.nature.read` | what the injury is and its severity | coach, assistantcoach, teammanager, principal, DoS, schooladmin, sportsadmin, guardian, medical, selfaccess | `[runtime]` nature columns NULL for a `player` principal, populated for `coach` |
| `medical.details.read` | clinical notes | coach, assistantcoach, guardian, medical, selfaccess, superadmin | `[runtime]` details NULL for `schooladmin`, populated for `medical` |
| `medical.write` | create/update injury | medical, superadmin | `[runtime]` `smoke-clearance` PASS |

Observation (P2, not a defect): `coach` and `assistantcoach` hold `medical.details.read` (`roles.mjs:211,228`). The capability comment (`capabilities.mjs:24-25`) frames `details` as clinical. Whether a coach should read clinical notes is a policy decision for the school, not the code; record it as a conscious choice in an ADR or narrow it.

## 8. Superadmin / Platform Support

### Current behaviour
- `superadmin` = every capability, platform-wide, assigned to the owner account in the seed and (per the user) intended as the operator's master key, not a demo alias `[code]` `roles.mjs:89`; `db/98_seed_pilot.sql` owner rows.
- Front-end: `apps/web/src/design/roles.js` labels it "Super Admin" 🗝️ gold; `legacy-roles.js` maps it to `{role:"superadmin", school:null}`.
- Eleven view-level gates still compare `role === "superadmin"` `[code]` `MatchCentreView.jsx:32`, `LeagueView.jsx:34`, `ManagementView.jsx:26,107`, `CompetitionsView.jsx:18`, `LogisticsView.jsx:49`, `TrainingView.jsx:41`, `SkillsView.jsx:100`, `StaffView.jsx:24`, `FieldsView.jsx:28`. These hide controls from roles that the DB *does* authorise (e.g. Director of Sport cannot see "Schedule Match"). Not a security hole — the DB is the authority — but a correctness and trust gap.

### Auditability
- Every write runs with `app.user_id` set; `news_post_author()` trigger stamps the author from the session, not the payload `[code]` `db/12_news.sql`.
- A dedicated audit log of superadmin actions across tenants: `NOT VERIFIED` (`smoke-audit.mjs` exists and passes; its coverage of platform-wide reads was not examined).

### Production exposure
- The owner assignment is created by `db/98_seed_pilot.sql`. Per `DEPLOYING.md` ("a demonstration is not a pilot") the seed must not run against a database holding a real child's data. **The owner's master key therefore has no production provisioning path other than the seed.** This is a gap: the day the seed is withheld from production is the day the operator loses the key.

### Recommended governance
1. Provision the owner's `superadmin` assignment through a one-off, ledger-tracked migration (or a documented SQL Editor step) that is separate from `98_seed_pilot.sql`.
2. Implement `platform.support.impersonate` as a time-boxed, audited assignment (`valid_until = now() + interval`) or remove the capability until it is real.
3. Add a `db/99` section asserting that every row `superadmin` reads across tenants leaves an audit row, once such a log exists.

## 9. RLS Audit

| Table / View | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|
| all 74 tables | RLS enabled | RLS enabled | RLS enabled | RLS enabled | `[runtime]` `pg_class.relrowsecurity` true for every table in `public` |
| `login_code`, `schema_migration` | deny-all | deny-all | deny-all | deny-all | 0 policies; reached only via `SECURITY DEFINER` |
| `news_post` | `news_post_read` (tier ∈ team/school/competition via `competition_entrant`), `news_post_read_own` | `news_post_insert` (tier = anchor) | `news_post_update` | none | `[code]` `db/12_news.sql:73,91,97,118` `[runtime]` `db/99` newsfeed tiers PASS. No DELETE policy — withdraw is an UPDATE (`published_at` cleared). |
| `injury` → `injury_masked` | tiered by column | — | `medical.write` | — | `[runtime]` §7 |
| 21 `*_masked` views | `security_invoker = true` | — | — | — | `[runtime]` all 21 checked; RLS of the base table applies to the caller |
| Policy count | 111 in `db/09` (generated) + 7 `db/01` + 9 `db/02` + 55 `db/08` + 4 `db/12` | | | | `[code]` `grep -c "CREATE POLICY"` |

## 10. SECURITY DEFINER / search_path Audit

- `[runtime]` 79 `SECURITY DEFINER` functions in `public`; `[code]` **zero** occurrences of `search_path` in `db/*.sql`.
- `[runtime]` `scrbrd_app` has no `CREATE` privilege on any schema (`information_schema.role_usage_grants` / `has_schema_privilege` false for all), so an attacker cannot plant a shadowing object today. The Postgres-documented mitigation (`SET search_path = pg_catalog, public` on each definer function) is still missing, which means the safety depends on a privilege configuration that lives outside the migrations.
- Severity: **P2** (defence in depth). Fix: generate `SET search_path` into every definer function from a single place (`rls:generate` for the generated ones; a one-off `db/13` for the rest) and add a `db/99` assertion `count(*) = 0` over `pg_proc` where `prosecdef AND proconfig IS NULL`.

## 11. Feature / Module Gate Bypass Tests

- `school_module` gates narrow access; `smoke-modules.mjs` PASS `[runtime]`.
- Direct falsification (disable a module, attempt the gated write over HTTP and via direct SQL): `NOT VERIFIED` in Pass 1. Listed as backlog SCRBRD-014.

## 12. Sensitive Notification Audit

- `smoke-push.mjs` and `smoke-escalation.mjs` PASS `[runtime]`.
- Whether any push payload carries a minor's medical nature or details: `NOT VERIFIED`. Listed as SCRBRD-015.

## 13. AI Data Exposure Audit

| Path | What leaves the platform | Evidence | Concern |
|---|---|---|---|
| `POST /api/ai/commentary` | the current match "situation" — includes batter and bowler names, i.e. pupils' names | `[code]` `services/api/server.mjs:282`; `services/api/ai/ai-service.mjs:42` (`claude-opus-5`, 120 tokens) | Third-party processing of minors' names without a documented lawful basis or a name-redaction step. |
| `POST /api/ai/statguru` | a context the **client** assembles in `apps/web/src/lib/ai.js` | `[code]` `ai-service.mjs:41` (400 tokens) | The server forwards whatever the browser sends; a masked column the browser legitimately holds (e.g. injury nature for a coach) can be sent onward. Filter server-side against the caller's tier or restrict to a fixed, server-built context. |
| Credentials | `aiConfigured()` false → both return `null` | `[code]` `server.mjs:658` | Fine. |

Severity: **P1** for POPIA purposes (children's personal information processed by an operator abroad). Mitigation is cheap: substitute stable pseudonyms (`Batter A`, `Bowler 1`) before the call and re-substitute on return; build StatGuru context server-side.

## 14. POPIA / Child Safeguarding Gaps

| Gap | Evidence | Severity |
|---|---|---|
| Firebase Analytics initialised at boot with no consent gate; runs in demo mode for anonymous visitors and for signed-in pupils alike | `[code]` `apps/web/src/main.jsx:6` imports `lib/firebase.js`; `firebase.js:37` `initializeApp`, `:45` `getAnalytics` when supported; tests carry `isFirebaseOfflineNoise` suppression | **P1** — analytics identifiers are personal information; no consent, no privacy notice link on the landing page checked (`NOT VERIFIED` whether a notice exists elsewhere). |
| Minors' names to AI provider | §13 | P1 |
| DOB now mandatory and SA ID accepted — both are special-category identifiers | `db/11`, `packages/policy/src/date-of-birth.mjs` | Handled correctly at collection (validation, Luhn, plausibility). Retention and deletion policy for `id_number`: `NOT VERIFIED` / not found in docs. P2. |
| Guardian access terminates at majority | §6 | Pass — this is the strongest safeguarding control in the system. |
| Demo/production separation | `DEPLOYING.md` rule; seed contains relative birthdates and Luhn-valid synthetic IDs only | Pass at the documentation level; the technical guard (refuse `98_seed_pilot.sql` when real rows exist) `NOT VERIFIED`. P2. |

## 15. Findings

### P0
None found in Pass 1. No path was found by which a caller reads or writes another tenant's or another child's data, and no path mints a server session without a code in production.

### P1
- **SEC-P1-01** Production login page offers a client-only "Google" entry that lands the visitor in mock demo mode with no indication at the point of entry (§3 AUTH-01).
- **SEC-P1-02** Minors' names leave the platform to a third-party model; StatGuru context is client-assembled (§13).
- **SEC-P1-03** Firebase Analytics runs without consent for every visitor including pupils (§14).
- **SEC-P1-04** The owner's master key has no provisioning path except the pilot seed, which must not run on production (§8).

### P2
- **SEC-P2-01** 79 `SECURITY DEFINER` functions without `SET search_path` (§10).
- **SEC-P2-02** Eleven view gates on `role === "superadmin"` hide authorised controls (§8).
- **SEC-P2-03** `platform.support.impersonate` granted but unimplemented (§4).
- **SEC-P2-04** Coach tier holds `medical.details.read` — needs a recorded decision (§7).
- **SEC-P2-05** Module-gate falsification, push-payload content, `id_number` retention, seed-refusal guard — all `NOT VERIFIED` (§11, §12, §14).

### P3
- **SEC-P3-01** `legacy-roles.js` alias table survives only for the login page; delete once capability-driven.

## 16. Required Regression Tests

| Test | Where | Guards |
|---|---|---|
| Two disjoint assignments cannot be combined into capability-A-at-scope-B | `db/99_rls_verify.sql` new section | §4 escalation |
| `count(*) = 0` of `pg_proc` where `prosecdef AND proconfig IS NULL` | `db/99` | §10 |
| Production login page renders no client-only entry, or renders it with a "demo" label (`data-testid`) | `tools/smoke-browser-read.mjs` | AUTH-01 |
| Commentary/StatGuru request bodies contain no `player.name` from the roster (pseudonym check) | `services/api/ai` unit test | §13 |
| `getAnalytics` not called before consent flag set | `apps/web` unit test around `lib/firebase.js` | §14 |
| Disable a `school_module`; gated write refused over HTTP and via SQL; re-enable; allowed | `tools/smoke-modules.mjs` | §11 |
| Owner `superadmin` assignment exists on a DB that has **never** run `98_seed_pilot.sql` | `db/99` (post SCRBRD-004) | §8 |
