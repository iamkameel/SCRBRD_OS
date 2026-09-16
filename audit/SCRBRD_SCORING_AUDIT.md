# SCRBRD OS — Cricket Scoring Audit

**Pass:** Focused Pass 1 — **partial**. Sections 1, 2, 4 (dismissal credit only), 10–16 and 18 are populated from fresh forensic reads of `packages/scoring/src/replay.mjs`, `services/api/write/events-api.mjs`, `services/api/handover/scoring-session.mjs` and the smoke walks. Sections 3, 5–9 and 17 are **not covered** in this pass and are left as the brief's template for Pass 2.
Evidence keys as in the Security Audit: `[code]`, `[runtime]`, `[falsified]`, `NOT VERIFIED`.

## 1. Scoring Architecture

### Canonical event source
`ball_event` (`db/02_schema_scoring.sql`) with `id` doubling as the idempotency key, plus `epoch` and `seq` from the scoring session. `ball_event_quarantine` (`db/02:164`) holds events rejected for a stale epoch or missing session; it carries `recovered boolean` (`db/02:145`) and `resolved_at` (`db/02:182` index) `[code]`.

### Reducer / replay path
`packages/scoring/src/replay.mjs` `deriveInnings(events)` — pure, deterministic, no I/O. Batter, bowler, extras, partnerships, free-hit state and result all derive from it `[code]` lines 49–340. Unit tests in `packages/scoring/test/replay.test.mjs` `[runtime]` PASS as part of the 1544-assertion `pnpm test`.

### Offline path
`packages/sync` outbox in IndexedDB; drains in `seq` order to `POST /api/events`; server returns `{accepted, duplicates, quarantined}` `[code]` `events-api.mjs:28,48`. `[runtime]` `smoke-sync` 52, `smoke-browser-sync` 19 PASS.

### Realtime path
`smoke-broadcast.mjs` PASS `[runtime]`; mechanism `NOT VERIFIED` in this pass.

### Correction path
`scoring.correct` (scorer's own fix within the session) and `scoring.amend.approve` (a second person approves a post-match amendment) are distinct capabilities `[code]` `packages/policy/src/capabilities.mjs`; `smoke-amend.mjs` PASS `[runtime]`.

## 2. Single-Source-of-Truth Verification

- [x] No stored canonical score outside the event log — no `runs`/`wickets` total column on `fixture` or `innings` tables in `db/02` `[code]`.
- [x] Batter figures derive from replay — `replay.mjs` `[code]`.
- [x] Bowler figures derive from replay — `replay.mjs:299` `[code]`.
- [x] Partnerships derive from replay `[code]`.
- [x] Result derives from replay `[code]`.
- [ ] Wagon-wheel data cannot contradict delivery truth — `db/07_shot_placement.sql:6` states the invariant ("a sector can never be recovered as a point"); constraint-level enforcement `NOT VERIFIED`.

## 4. Wicket Matrix (bowler-credit column only)

The law "run outs and the other non-delivery dismissals are not credited to the bowler" (`docs/SCORING_RULES.md:120`) is implemented as a **regex over free text**:

```js
// packages/scoring/src/replay.mjs:336-337
const UNCREDITED = /run ?out|retired|obstruct|handled|timed ?out/i;
const chargedToBowler = (mode) => !UNCREDITED.test(mode ?? "");
```

`ev.dismissal` is a free string at the API boundary (`events-api.mjs` performs no vocabulary check `[code]`). The in-app scorer sheet offers a fixed list — `["Bowled","Caught","LBW","Run Out","Stumped","Hit Wicket","Handled Ball","Obstructed Field"]` (`apps/web/src/scorer/sheets.jsx:316`) — and every entry in that list is classified correctly by the regex. The defect is reachable by **any other producer**: CSV import, a second scoring client, a hand-edited outbox, or a future UI string change.

| Dismissal string | Bowler credited? | Correct? | Evidence |
|---|---:|---:|---|
| `Run Out` (UI) | no | ✅ | `[runtime]` `replay.test.mjs:98` |
| `run out` | no | ✅ | `[runtime]` `replay.test.mjs:96-98` |
| `runout` | no | ✅ | regex `run ?out` `[code]` |
| `run-out` | **yes** | ❌ | `[runtime]` reducer call with `dismissal:"run-out"` → `bowlers[0].wickets === 1` |
| `r/o` | **yes** | ❌ | `[runtime]` same |
| `RO` | **yes** | ❌ | `[runtime]` same |
| `timed-out` | **yes** | ❌ | `[runtime]` same (regex `timed ?out` needs space or nothing) |
| `Timed Out` | no | ✅ | regex |
| `Retired hurt` | n/a (separate RETIRED event, `replay.mjs:204`) | ✅ | `[code]` |
| Bowled / Caught / LBW / Stumped / Hit Wicket | yes | ✅ | `[code]` |

Free-hit interaction: `replay.mjs:290` uses a second, narrower regex `/run ?out/i` to decide whether a wicket stands on a free hit. `handled`/`obstructed` on a free hit therefore **do not stand** even though they are non-delivery dismissals (`SCORING_RULES.md:107-109` says "run out, and the other non-delivery dismissals" stand). Two regexes encode one law differently. `NOT VERIFIED` by a failing test yet — listed as SCRBRD-002 acceptance.

Legal-delivery, batter-out and strike-consequence columns of the brief's matrix: **not covered in Pass 1**.

## 10. Three-Phase Scoring

`phases.test.mjs` PASS and `smoke-phases.mjs` PASS `[runtime]`. Whether an enrichment (Phase 3) failure is isolated from Phase 2 outcome persistence: the tests exist; falsification (make enrichment throw, confirm the outcome still commits) `NOT VERIFIED` in this pass.

## 11. Offline Integrity

| Scenario | Covered | Evidence |
|---|---|---|
| Reload mid-innings, events survive | yes | `smoke-browser-sync` `[runtime]` |
| Duplicate retry after network drop | yes | `smoke-sync` duplicates array `[runtime]` |
| Stale epoch after handover | yes | `smoke-handover` 35 `[runtime]` |
| Browser **closed and reopened** (not reload) | **no** | no walk drives a new browser context against the same IndexedDB |
| Degraded connectivity (request sent, response lost) | **no** | no walk severs the response half of a request |
| Crash mid-handover (lease taken, epoch not yet acknowledged by old scorer) | **no** | `smoke-handover` covers clean handover and stale-epoch rejection only |

## 12. Idempotency

| Handler | Idempotency refs | Verdict |
|---|---:|---|
| `write/events-api.mjs` | 14 | key = event id; duplicates returned, not re-applied `[runtime]` |
| `write/news-api.mjs` | 0 | a retried `POST /api/news` publishes twice `[code]` |
| all 13 other `write/*-api.mjs` | 0 | fixture, roster, roster-add, requests/enrol, kit, clearance, competitions, contacts, recognition, scouting, training, workload, assessment |

Of these, `enrol` and `roster-add` are protected by unique constraints (`already_linked` 409, unique violation caught) so a retry is refused rather than doubled `[runtime]` `smoke-enrol`, `smoke-roster-add`. `news`, `training`, `workload`, `recognition`, `scouting`, `contacts` have no such natural key: **a retry duplicates the row.** `NOT VERIFIED` per handler by walk; `[code]` by grep.

## 13. Scorer Token / Lease / Epoch

`services/api/handover/scoring-session.mjs`: lease with expiry, epoch increments on takeover, events from a prior epoch are quarantined not applied `[code]`; `write.test.mjs:4,156` and `smoke-handover` 35 assertions `[runtime]` PASS, including "recovered 4 balls after restart" (server-side recovery of the in-memory session from the DB).

## 14. Handover

Clean handover, stale-epoch rejection and server restart are tested. Gaps: crash mid-handover and the departing scorer's browser continuing to score offline for many overs before reconnecting (only single-event stale rejection is asserted). `NOT VERIFIED`.

## 15. Correction + Approval

Capabilities separated (`scoring.correct` vs `scoring.amend.approve`) `[code]`; `smoke-amend` PASS `[runtime]`. Whether the approver can be the same person as the scorer (four-eyes rule): `NOT VERIFIED`.

## 16. Replay Determinism

`deriveInnings` is pure and takes an ordered array `[code]`. Ordering is by `seq` within `epoch`; a test that shuffles input and asserts identical output, or that asserts the server sorts before replay, was not found. `NOT VERIFIED`.

## 18. Findings

### P0
None.

### P1
- **SCO-P1-01** Bowler-credit law encoded as a regex over free text with no closed vocabulary at the API boundary; four realistic spellings (`run-out`, `r/o`, `RO`, `timed-out`) credit the bowler. Reachable via import or any non-UI producer. Two different regexes (`:290`, `:336`) encode the non-delivery-dismissal law inconsistently.
- **SCO-P1-02** `ball_event_quarantine` has a `recovered` flag and `resolved_at` but **no route, function or UI** releases an event from quarantine. A quarantined ball is lost to the scorecard for ever unless an operator edits the table by hand.

### P2
- **SCO-P2-01** No idempotency on 14 of 15 write handlers; six of them have no natural unique key and duplicate on retry.
- **SCO-P2-02** Offline walks miss close/reopen, lost-response and crash-mid-handover.
- **SCO-P2-03** Reduced-overs matches (rain, D/L-style revised targets) not supported anywhere in schema or reducer.

### P3
- **SCO-P3-01** Replay-determinism-under-reordering test absent.

## 19. Required Regression Suite

| Test | Where |
|---|---|
| `DISMISSAL` closed enum exported from `packages/scoring`; `events-api` rejects any other string with 400; UI list imports the enum | `packages/scoring/test/replay.test.mjs`, `services/api/write/write.test.mjs`, `tools/smoke-scorer.mjs` |
| Every non-delivery dismissal stands on a free hit; every delivery dismissal does not | `replay.test.mjs` |
| `POST /api/quarantine/:id/release` (or equivalent) re-applies the event under the current epoch and sets `recovered=true, resolved_at` | new `tools/smoke-quarantine.mjs` |
| `Idempotency-Key` header honoured on news/training/workload/recognition/scouting/contacts | `tools/smoke-*` per handler |
| Shuffled `ball_event` input replays to identical scorecard | `replay.test.mjs` |
| Browser context closed and reopened; outbox drains | `tools/smoke-browser-sync.mjs` |
