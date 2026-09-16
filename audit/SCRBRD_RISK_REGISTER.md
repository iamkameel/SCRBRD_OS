# SCRBRD OS — Risk Register

**Pass:** Focused Pass 1 · **Branch:** `claude/ui-refactor-ds2` @ `0783ed5` · **Date:** 2026-09-16
Every risk below cites the audit section that holds its evidence. Owner is a role, not a person, until Kameel assigns names. Backlog IDs refer to `SCRBRD_IMPLEMENTATION_BACKLOG.md`.

## Scoring

| ID | Risk | Likelihood | Impact | Priority | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-SCO-001 | Non-UI producer (CSV import, second client, outbox edit) sends a dismissal spelling outside the regex (`run-out`, `r/o`, `RO`, `timed-out`); bowler is wrongly credited and season bowling figures are wrong for every match that contains it. | Medium | High | **P1** | Closed `DISMISSAL` vocabulary in `packages/scoring`, validated at `events-api` — SCRBRD-002. Evidence: Scoring Audit §4. | Scoring |
| RISK-SCO-002 | Two regexes (`replay.mjs:290`, `:336`) encode the non-delivery-dismissal law differently; `handled`/`obstructed` on a free hit is thrown out when the rules say it stands. | Medium | Medium | P2 | Same fix as SCO-001 (one enum, one predicate). | Scoring |
| RISK-SCO-003 | Reduced-overs match cannot be recorded correctly; scorer improvises, result disputed. | Medium | Medium | P2 | Schema + reducer support — SCRBRD-016. | Scoring |
| RISK-SCO-004 | Replay applied to unordered events yields a different scorecard; no test guards ordering. | Low | High | P2 | Determinism test — SCRBRD-017. Scoring Audit §16. | Scoring |

## Security / Privacy

| ID | Risk | Likelihood | Impact | Priority | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-SEC-001 | A school evaluating the product on the live URL clicks "Google", sees a working app on mock data labelled only by a small "Demo data" chip, and forms a wrong belief about what is real — or a real user believes their entries are saved when nothing is. | High | High | **P1** | Remove or label the client-only entry on the production login page; only a code-issued token may enter the shell — SCRBRD-001. Security Audit §3 AUTH-01. | Product / Web |
| RISK-SEC-002 | Pupils' names sent to a third-party AI provider for commentary; StatGuru context assembled by the client can include tier-gated data the browser holds. POPIA exposure for children's information. | High | High | **P1** | Pseudonymise before the call; build StatGuru context server-side against caller's tier — SCRBRD-005. Security Audit §13. | API / Privacy |
| RISK-SEC-003 | Firebase Analytics runs at boot for every visitor, including signed-in pupils, with no consent. | High | Medium | **P1** | Consent gate before `getAnalytics`; default off — SCRBRD-006. Security Audit §14. | Web / Privacy |
| RISK-SEC-004 | Owner's `superadmin` master key is provisioned only by `98_seed_pilot.sql`, which must never run on a database holding real children's data. The first real pilot locks the operator out. | High | High | **P1** | Separate, ledger-tracked owner-provisioning migration — SCRBRD-004. Security Audit §8. | Platform |
| RISK-SEC-005 | 79 `SECURITY DEFINER` functions without `SET search_path`; safe today only because `scrbrd_app` has no CREATE. A future grant or a Supabase role change silently opens it. | Low | Critical | P2 | Generate `SET search_path` everywhere; `db/99` assertion — SCRBRD-007. Security Audit §10. | DB |
| RISK-SEC-006 | `platform.support.impersonate` is granted but enforces nothing; a future feature assumes it is real. | Low | High | P2 | Implement time-boxed audited assignment or remove — SCRBRD-012. | Platform |
| RISK-SEC-007 | Coach tier reads clinical notes (`medical.details.read`); no recorded decision that the school intends this. | Medium | Medium | P2 | ADR recording the decision, or narrow the role — SCRBRD-013. Security Audit §7. | Product / Medical |
| RISK-SEC-008 | Module gate bypass, push payload content, `id_number` retention, seed-refusal guard — none falsified. | Unknown | Medium | P2 | Pass 2 checks — SCRBRD-014, -015. | Audit |

## Data Integrity

| ID | Risk | Likelihood | Impact | Priority | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-DAT-001 | Retry of `POST /api/news` (and training, workload, recognition, scouting, contacts) on a flaky connection creates duplicate rows; the newsfeed shows the same post twice to every parent. | High | Low–Medium | P2 | `Idempotency-Key` header stored per handler — SCRBRD-009. Scoring Audit §12. | API |
| RISK-DAT-002 | Legacy `player` rows with NULL `born` remain (`CHECK … NOT VALID`); guardian links to them were ended today by `db/10` and will not reopen until DOB is entered. Parents lose access silently. | Medium | Medium | P2 | Report of NULL-born pupils on the Settings page; the WARNINGs from `db/10`/`db/11` are only visible in the migration log — SCRBRD-018. | School admin |
| RISK-DAT-003 | Pilot convention still edits `0x` files + `--reset-objects` on demo, while production is ledger-locked; a contributor edits `08` and the production migrator REFUSES. | Medium | Low | P3 | Document in `DEPLOYING.md`: production changes go in new `db/NN` files only — SCRBRD-019. | DB |

## Reliability / Offline

| ID | Risk | Likelihood | Impact | Priority | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-REL-001 | A ball quarantined for a stale epoch cannot be released: `recovered`/`resolved_at` exist, no route or UI sets them. The over is short on the scorecard for ever. | Medium | High | **P1** | Quarantine review + release route — SCRBRD-003. Scoring Audit §18 SCO-P1-02. | Scoring / API |
| RISK-REL-002 | Browser closed (not reloaded) mid-innings, or response lost after the request was received: behaviour untested. | Medium | High | P2 | Extend `smoke-browser-sync` — SCRBRD-010. Scoring Audit §11. | Sync |
| RISK-REL-003 | Crash mid-handover (lease taken, epoch unacknowledged) untested. | Low | High | P2 | Extend `smoke-handover` — SCRBRD-010. | Scoring |
| RISK-REL-004 | Enrichment (Phase 3) failure isolation asserted by tests but never falsified. | Low | Medium | P3 | Pass 2 falsification. | Scoring |

## Architecture

| ID | Risk | Likelihood | Impact | Priority | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-ARC-001 | Eleven views gate controls on `role === "superadmin"` strings; the DB authorises Director of Sport (and others) to do things the UI hides. Users conclude the product "doesn't do X". | High | Medium | P2 | Replace with capability checks — SCRBRD-011. Security Audit §8. | Web |
| RISK-ARC-002 | 970 KB main bundle including Firebase SDK; slow first load on school Wi-Fi and mobile data. | High | Medium | P2 | Lazy-load Firebase behind consent; route-level code splitting — SCRBRD-006, -020. | Web |
| RISK-ARC-003 | `tools/check-imports.mjs` skips any name nothing exports (`:105`) and mis-tokenises apostrophes in comments (`:39`); a genuinely broken import can pass. | Medium | Medium | P2 | Fix `codeOf()` tokeniser; report unresolved names — SCRBRD-021. | Tooling |
| RISK-ARC-004 | No root `ARCHITECTURE.md`; `docs/ARCHITECTURE.md` exists but the deploy pattern (bundle → SQL Editor) lives only in chat history and `tools/bundle-sql.mjs` comments. | High | Low | P3 | Fold this System Map into `docs/ARCHITECTURE.md` — SCRBRD-022. | Docs |

## Product

| ID | Risk | Likelihood | Impact | Priority | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-PRO-001 | Three commits (`37c22f7`, `d4175dc`, `0783ed5` — bundle columns, sign-out, newsfeed) are on the branch but not on `main` or production; `db/12_news.sql` has not been applied to Supabase. The newsfeed nav item will 404/mock on production once the web build ships without the schema. | High | Medium | **P1** | Merge via PR, then rebuild bundle and paste into Supabase in the documented order (schema first) — SCRBRD-000. | Release |
| RISK-PRO-002 | Officials register has API and RLS coverage (`smoke-officials`) but no management UI. | Medium | Medium | P2 | SCRBRD-023. | Product |

## UX / Accessibility

| ID | Risk | Likelihood | Impact | Priority | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-UX-001 | Demo/live distinction rests on one "Demo data" chip; no persistent banner. | High | Medium | P2 | Persistent banner when `!signedIn()` — part of SCRBRD-001. | Web |
| RISK-UX-002 | Design token contrast (WCAG 4.5:1, ΔE ≥ 8) is enforced by `design.test.mjs` — **controlled**. | Low | Low | P3 | Keep the test. | Web |

## Deployment / Operations

| ID | Risk | Likelihood | Impact | Priority | Mitigation | Owner |
|---|---|---|---|---|---|---|
| RISK-OPS-001 | Someone runs `pnpm db:reset` (`--reset --seed`) against Supabase. | Low | Critical | **P1** | `migrate.mjs --reset` refuses when the host is not localhost/docker unless `I_UNDERSTAND_THIS_DESTROYS_PRODUCTION=1` — SCRBRD-008. | DB / Ops |
| RISK-OPS-002 | `pnpm verify` and `pnpm db:up` were not run as single commands in this audit (component checks all PASS individually). | Low | Low | P3 | Run in CI on every PR — SCRBRD-024. Full Audit §2. | CI |
| RISK-OPS-003 | Supabase deploy is a manual paste of two generated files; no record on the server of which bundle was applied beyond the ledger rows the bundle inserts. | Medium | Medium | P2 | Bundle prints its git SHA into a `schema_migration` note column — SCRBRD-025. | Ops |

## Risk Definitions

### Likelihood
- **Low** — requires an unusual sequence or a future change to occur.
- **Medium** — plausible in a normal season of use.
- **High** — will occur in ordinary use, or has already occurred.

### Impact
- **Low** — cosmetic or self-correcting.
- **Medium** — wrong data or lost access for some users; recoverable with effort.
- **High** — wrong match record, loss of a child's data protection, or operator lockout.
- **Critical** — destruction or exposure of a production database.

### Priority
- **P0** — stop and fix before any other work. None open.
- **P1** — fix before the first real pilot admits a real child's data.
- **P2** — fix during the pilot.
- **P3** — schedule.
