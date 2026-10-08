# GA-I36 — Corrections everywhere: the design

**Status:** approved by Kameel on 2026-10-07 for after the pilot; A0 and A1 pulled forward on 2026-10-08 (Kameel). Written by Fable, 2026-10-07. For after the 15 Oct solo test; §8 A0 is the one slice small enough for before the 12 Oct freeze, only if Kameel wants it.
**Source:** `audit/GAP_ANALYSIS_2026-10-05.md` (I36, phase C; the private report's exit test: "same input revision reconciles pad/public/career/report/charts; edits invalidate derived caches and preserve audit; NULL stays distinct from zero"); `db/02` (`ball_event`, `ball_event_live`, `scoring_amendment`, `scoring_amendment_decide`), `db/14` (`quarantine_resolve`), `db/24`, `db/33`, `db/36`, `db/38`/`db/69` (the decide function as it stands, with the result audit), `db/40`, `db/51`, `db/59` §6 (`public_data_changed`), `db/72` §5; `packages/scoring/src/replay.mjs` (`voidedTargets`, `foldSteps`, `MatchFold._refold`), `events.mjs` (`voidEvent`, `KIND`), `laws.mjs` (the `void_*` refusals); `services/api/write/events-api.mjs` (`appendEvents`, `eventRoutes`, `amendmentRoutes`, `quarantineRoutes`), `replay.mjs`, `results-api.mjs`, `publication-api.mjs`, `public/public-api.mjs`, `realtime/realtime.mjs`, `read/read-api.mjs` (`career`, `live_score`, `milestones`, `audit_log`); `apps/web/src/scorer/chartData.js`, `scorer/engine.jsx` (undo), `views/matchcentre/MatchView.jsx`, `live.js`, `public/reads.js`; `docs/design/SCRBRD-114_phase3…` §2.6, §6; `SCRBRD-120` §2.2–2.7, §4.5; `SCRBRD-133` §2.4, §5.
**Reader:** Kameel on a phone first; then the Opus lead; then whoever builds a slice.

---

## 0 · In one page

SCRBRD already has the one thing most systems lack: **there is no stored score to get out of step.** The log is append-only (`db/02`), a correction is a `void` naming the event it undoes, and every reader — the pad, the Match Centre, the public page, the display, careers, results, standings, the charts, the commentary — is a fold over the same log, or a SQL view over `ball_event_live`, which skips voids once, in one place. So the figures already reconcile after every kind of correction, by construction. Nothing in this design changes that model, and nothing adds a second place a score can be true.

What is missing is around the edges, and two of the gaps are real today:

1. **Milestone notices are never taken back.** `milestone_watch()` is an AFTER INSERT trigger: a fifty reached on a ball later voided has already written a `milestone_notice` row and a `notification` ("Fifty for D Erasmus"), and nothing on the void retracts either. **Broken today** (§3, N). The fix needs a migration, so it is after the pilot (A2).
2. **An approved amendment and a released held ball tell nobody.** Only the live scoring path is wrapped by `makeCommitAndBroadcast`, and `ball_event` is not in `db/59`'s notification list. So after `POST /amendments/:id/decide` or `POST /quarantine/:id/resolve` the live hub stays silent until the next ball (on a completed match: for ever), and the public cache serves the old scorecard until its TTL (60 s settled, 120 s hot). Bounded, not wrong, but nobody is told. Two `afterCommit` hooks close it in-process (A0/A1); a void-only trigger reaches the other instances (A2).

The rest is honesty and reach. **The revision is the log's own head `seq`** — no column, no table (D1). "Corrected 18:42" is read off the fold, which already counts the voids and carries each one's time (D2). **The director has no screen to decide an amendment**, and there is no read that lists them; A1 gives him a "Corrections" sheet inside the fixture's Match Centre, reached from a row on his To-resolve screen (GA-I09, O7), and the scorer a "Ask for a correction" tap on the scorecard (D5, D6). Words for the parent and the public say *when*, team-level, and never who asked or which boy (§5). The one real hole in the model — **an amendment can only remove a ball, never replace it** — is A3, Opus, after Kameel decides (D7, Q1).

---

## 1 · The problem and the decisions

### 1.1 What "agree" has to mean

Three readers may legitimately show three different numbers for one match and all be right: the public page (team-level, redacted), a coach (his school's deliveries), the director (everything). Scope is the architecture's own rule (`db/02`, "an aggregate leaks as surely as a row"). So "every projection agrees" means: **for one reader, at one revision of the log, every surface shows the same fold.** Agreement is per revision and per scope, and the test is written that way (§8).

### 1.2 The decisions

| # | decision | recommendation | alternatives, and why not |
|---|---|---|---|
| **D1** | What a revision is | **The match's head `seq`: `max(seq)` over `ball_event` for the match.** Appended under the per-match lock (`scoring_lease_check`, db/37, db/38), `UNIQUE (match_id, seq)`, no UPDATE or DELETE: the log at head N is one fixed thing, and N is monotonic. Already surfaced as `match_live_score.last_seq`, the public log's `last`, the hub's `uptoSeq`, the client's `lastSeq` | a `match.revision` column bumped by trigger (no: a second counter beside the one the log has); a hash over `(seq, fingerprint)` (fine as a check, unnecessary as the name: the head already names the log) |
| **D2** | How "corrected at" is known | **From the fold.** `inn.voided` counts the undone events; each `void` carries `clientTs` (an amendment's is its approval time, `now()`), `reason` and, in its payload, the amendment id; a released ball carries `recovered`. The latest of these is the correction time. No flag stored | `match.corrected_at` (no: a cache of the log; the public log already serves the voids, pseudonymised, so the public fold knows too) |
| **D3** | What invalidates the derived caches | **The two correction routes call the same `afterCommit` hooks the publication route does** (`publicSite.changed({k:'match'})`, `hub.broadcastEvents`) **and a void-only trigger joins `db/59`'s `public_data_changed`** (`WHEN NEW.kind = 'void' OR NEW.recovered`). Never a notification per ball: the live cache's 5 s TTL is the batching | a notification per ball (no: a drop per delivery during play, which the TTL exists to avoid); TTL alone (today: 60–120 s stale after an amendment, and the open socket never) |
| **D4** | Stored notices | **Retract on void.** A trigger on the void re-asks db/51's two questions for the voided ball's striker and bowler; a mark no longer reached sets `retracted_at` on the notice and its notification, and a low-urgency "withdrawn" notice goes to the same audience. Migration, Opus, A2 | delete the rows (no: the audit of what was said is gone); leave them (today: a false notice stands) |
| **D5** | Where the approval screen lives | **Inside the fixture's Match Centre, a staff-only "Corrections" sheet**, reached from a new row on the director's To-resolve screen (GA-I09 §3.2: O7 "1 correction awaiting approval · asked 2 days ago") and from the fixture itself. Pending amendments and held balls in one sheet, each with the ball as recorded, the reason, the effect, Approve/Decline | a Corrections screen of its own (no: a fifth destination, and the decision needs the scorecard beside it) |
| **D6** | Where the request is made | **A tap on a ball in the scorecard — the pad's after an innings, the Match Centre's for staff — "Ask for a correction", with a reason.** Filed under `scoring.amend.request` (the scorer, superadmin: db/24); the route exists, the screen does not | a free-text request to the office (no: the void must name a key, and the scorecard is where the key is) |
| **D7** | Removing versus replacing | **Void-only now, and the approval sheet says so in words ("this removes the ball; nothing replaces it"). A replacement folded in the target's place is A3** (`void.replacement`, §6 N6) | re-open the match and re-score (no: destroys every ball after the error); a replacement appended at the end (no: the fold is order-dependent and the Laws refuse it after the seal) |
| **D8** | A scorer's correction two balls back, during play | **An amendment, not a void.** The Laws' `void_not_latest` stands (undo is last-in, first-out); the request is filed from the pad and the director approves from his phone mid-match (db/38 takes the live lock) | widen the scorer's void (no: a correction with no second name, to a ball a spectator has already seen) |
| **D9** | Words | **Public and parent: when, team-level, time only. Staff: when, by role words ("asked by the scorer, approved by the director of sport"), the ball in the fold's words. The reason: only where `scoring_amendment_read` already admits it** (requester, approver, `audit.read`) | the reason on the match page for every coach (no: it is paperwork about a person's error, and the policy already decided who reads it) |
| **D10** | Careers, standings, season figures | **No "corrected" marker.** A sum has no one correction time; the match page carries it, one tap away | a per-player "figures changed" line (no: it would fire on every match of his) |
| **D11** | Exports and downloads | **Every file says the revision and the time it was computed** ("as at 18:42, 11 Oct · head 412") in its footer | nothing (today): a PDF is a snapshot that cannot say so |
| **D12** | A pending amendment | **Changes nothing anywhere.** Staff the policy admits see "1 correction awaiting approval"; the public never learns one exists | a public "under review" badge (no: it names a dispute about a child's innings) |
| **D13** | The pre-freeze slice | **A0: the two `afterCommit` hooks and the "Corrected HH:MM" chip, only if the solo test will exercise an amendment; otherwise nothing before 12 Oct** | — |

Decided 2026-10-08 (Kameel): keep polling. The realtime hub is not mounted and stays parked; N2 drops the public cache after commit (publicSite.changed) and screens learn of a correction on their next poll ('Updated · refresh'). No hub broadcast.

---

## 2 · The revision model

### 2.1 Plain words

A revision of a match is its log up to a head. Because the log only ever grows, the head number is the revision, and every reader can say which one it folded by remembering the largest `seq` it has seen. A reader is current when its head equals the server's. The log at any head can be re-folded exactly, so "the match as it stood at 18:40" is `events.filter(seq ≤ 400)` and nothing more.

### 2.2 What exists, and what each surfaces

| surface | revision today | correction time today |
|---|---|---|
| `GET /api/matches/:id/events` | `seq` on every row; head = the last row's | voids served (`kind`, `payload.target`, `client_ts`); `recovered` served |
| `GET /api/public/matches/:id/log` | `last` | voids served, target pseudonymised (redact.mjs); `recovered` **not** served |
| hub `events` message | `uptoSeq` | the void is an event in the message |
| `match_live_score` | `last_seq` per innings | — |
| `match_result()` | `result_hash` (the result's own hash; changes when the fold's outcome does) | — |
| fold (`deriveInnings`) | — | `inn.voided` (a count) |

**Nothing new is needed for the name.** A1 adds no field: the client takes head from the rows it has (`events`: `max(seq)`; public: `last`) and the fold adds `inn.corrections` — the list `{at, seq, kind}` of voids and recovered rows it skipped or took in — beside the count it already keeps. `deriveMatch` lifts the latest to `match.correctedAt`.

### 2.3 Telling current from stale

The Match Centre already polls every 15 s while live and reads once on open otherwise; the public page every 5 s (display) or 15 s (phone) with `?since=last`; the hub carries `uptoSeq` and the client catches up on a gap. So staleness is already bounded for a live match. The gap is the *settled* match: a reader that opened a completed fixture before an amendment shows the old fold until it is reopened, and says nothing. A1 (§7) gives every reader one honest line, from its own head against the header's: "Updated · refresh".

---

## 3 · Every projection, one by one

Status: **works** (follows a correction by construction), **gap** (follows, but late, or says nothing), **broken** (does not follow).

| projection | computed where | cached? | invalidated today by | must be invalidated by | "corrected at" | status, with the mechanism |
|---|---|---|---|---|---|---|
| **Pad** (scorer) | `engine.jsx`: own log in memory + `@scrbrd/sync`; `deriveInnings` | the device's log (`packages/sync`, durable) | its own undo (`undoOnPad`: a local drop for an unsent event, a `void` for a sent one); on attach, `reconcile()` sees the server's extra rows (`behind`) and takes the server's log | an amendment approved or a ball released **while the pad is open** (today: not told until the next attach) | the pad's own undo words (`undoWords`) | **gap**: the amendment and release routes do not broadcast; the pad learns on reattach. A1 hooks |
| **Match Centre** | `MatchView.jsx` `useMatchLog`: full log on open, every 15 s while live; `deriveMatch` | no (re-folds each read) | the poll, while live; a reopen otherwise | a hub message, or the user's refresh, on a settled match | none today | **works** for figures; **gap** for words and for a settled match left open |
| **Live hub** | `realtime.mjs` `MatchHub`; `makeCommitAndBroadcast(appendEvents)` in server.mjs | no | a live append (the pad's void included: it is an accepted event) | an approved amendment's void; a released ball (db/37) | — | **gap**: `amendmentRoutes` and `quarantineRoutes` write through their own functions, outside the wrapper; a watcher's socket is silent until the next ball, for ever on a completed match. Single-process hub (README): the trigger of D3 is what reaches other instances |
| **Public page, ground display** | `public-api.mjs`: `PublicCache` per fixture (header, log, shots); the page folds (`public/reads.js` `deriveMatch`) | yes: 5 s live / 60 s settled, ×2 hot; edge `max-age=30` on the header, `no-store` on the log | `public_data_changed` (db/59 §6: publication, consent, names, `match` status/time/ground — **not `ball_event`**); `changed()` from the publication, listing, names and news routes — not the correction routes; the TTL | D3's hooks and trigger | none today; the fold has the voids, so the words need no server change | **gap**: correct within the TTL, never told sooner. Note: `recovered` is not in `public_match_log`, so the public fold cannot date a release; A2's trigger drop makes the figure right, and the word is "corrected" from the void only |
| **Careers** (`career`, `career_by_season`, `dismissal_breakdown`, `passport()`, form guide, `milestones` read) | SQL views over `ball_event_live` / `ball_event_career` (db/02, db/40, db/44, db/71); `player_milestone` is a view (db/08) | no | nothing to invalidate: `ball_event_live` skips the void and its target on every read | — | none (D10) | **works** |
| **Results and standings** | `match_result()` → `innings_result_state()` folds `ball_event_live` in `seq` order (db/69); `competition_standing` is a view over `competition_results()`; `progression_check()` is an AFTER INSERT statement trigger on `ball_event` (db/72), so a void re-runs it | public standings cached 60 s | the read itself; `result_hash` moves when the outcome does; `scoring_audit` `amendment_approved` holds `result_hash` before and after | the public standings entry: D3's hooks (`k:'match'` drops the fixture and the live strip; the competition's entry drops on `k:'competition'` or on a full drop) | the audit line | **works**; **gap** for the public table's TTL only |
| **Reports** (`summary` dashboard figures, `SeasonHistoryView`, `ProfilesView`, the match PDF/CSV exports) | the reads above, derived on each read; an export is a file | a file is a snapshot | a re-read | — | D11: the file's footer | **works** on screen; **gap**: no export says which revision it is |
| **Charts** (`chartData.js`) | pure over the fold; `foldSteps` skips voids as the fold does | no | the fold it is given | — | inherits the fold's | **works**. NULL check: a summarised innings returns `summarised: true` and empty series; `n()` must never turn a NULL `balls` into a drawn 0 (§8 test) |
| **Commentary and moments** | the shared generator over the fold; `useArrivals` keys on lines not seen before; moments are arrivals (133 §5) | no | the fold: a voided ball's lines vanish from `items` | a void should produce one quiet line | none today | **gap**: the Highlights list loses a line silently and no "Corrected" line appears; a card already shown is history and needs nothing. A1 adds a `correction` line, team-level, never a card (133's catalogue stands) |
| **Notices** (`milestone_notice`, `notification` via `milestone_notify()`; `bowling_breach` rows via `bowling_breach_watch()`) | AFTER INSERT triggers on `ball_event` (db/08, db/13, db/40, db/42, db/51, db/71) | **stored** | nothing: no trigger reads a void | D4: a retraction on the void | the withdrawn notice's own time | **broken today**: a fifty, a five-for, a hat-trick, a career 500 or a breach written on a ball later voided stands as written. `ON CONFLICT DO NOTHING` on the PK (player, kind, match, innings) means a fifty voided and re-reached is rightly not noticed twice, and wrongly left standing when never re-reached |

Two things the table does not change: the fold's `voided` count and `ball_event_live`'s exclusion are the single definitions of "the balls that count" (db/02's header), and the new ball kinds on `claude/wip-wicket-on-extra` need nothing here — a `void` names a target id, whatever the target's kind, and every SQL arm reads columns of the voided row (`striker_id`, `bowler_id`, `dismissed_id`), so the retraction of D4 and the tests of §8 must include a voided wicket off a wide.

---

## 4 · The kinds of correction

| # | kind | who may | what it writes | what the audit keeps | what each projection must do |
|---|---|---|---|---|---|
| **K1** | **Pad undo during play** (the latest event; `undo.mjs` LIFO, `void_not_latest` refuses older) | the token holder: `scoring.edit`, the device, the epoch, a live lease (`ball_event_insert`) | unsent: dropped from the log and withdrawn from the outbox, nothing reaches the server; sent: a `void` (`reason: scorer_undo`) at the next `seq` | both rows in `ball_event`: the ball and the void, each with `scorer_user_id`, `device_id`, `client_ts`, `server_ts`; the fold's `voided` | hub: broadcast (works); Match Centre: next poll; public: TTL ≤ 5 s + poll; careers, results, charts: immediate; **notices: retract (A2)** |
| **K2** | **The scorer's correction after an innings, or to an older ball** | the scorer (`scoring.amend.request`, db/24); never an approver | a `scoring_amendment` row, `pending`, naming `target_key` and a reason; **nothing in the log** | the request row (requested_by, requested_at, reason); withdrawal by the requester only | nothing changes (D12); staff the policy admits see "1 awaiting approval" |
| **K3** | **An amendment approved** (usually after completion; mid-match allowed, db/38 takes the live lock) | `scoring.amend.approve` over the match (director of sport, competition admin, principal), not the requester (`cannot_approve_your_own`); the route then judges the void by the Laws less `void_not_latest` (`amendmentRefusal`), rolling back on refusal | a `void` at the next `seq`, authored by the **requester**, device `amendment`, payload `{target, amendment, approved_by}`; the row set `approved`, `applied_key`; `scoring_audit` `amendment_approved` with `outcome` and `result_hash` before and after | the voided ball stays; the void names who asked and who approved; the result before and after | hub: **broadcast the void (A1)**; public: **drop the entry (A1), trigger (A2)**; Match Centre: next open or the hub; careers, results, progression (db/72), charts: immediate; notices: retract (A2); exports: a new file says a new head |
| **K4** | **A held ball released** | `scoring.amend.approve`, not the submitting scorer (`cannot_release_your_own`); the route judges the released ball by the Laws (db/37) | the ball at the next `seq`, under the **current epoch**, `recovered = true`, under the submitting scorer's name; the quarantine row `resolved_at/by`, `resolution` | the held body stays in `ball_event_quarantine`; the released row says `recovered` | as K3; the approval sheet says plainly that a released ball is written at the end of the log (Q5) |
| **K5** | **A scorebook import over existing events** (SCRBRD-120 §2.6) | the import's confirmer (`scorebook.*`, 120 §4.1); an innings with live events is refused (`LIVE_INNINGS`) until an amendment voids them; a wrong import is voided by amendment (target: the summary's key) and imported again | the three events per innings, each with `payload.source = {kind:'scorebook', import, checkedBy, confirmedBy}` | `scorebook_import_revision` holds every card; the void of a wrong summary is K3's | as K3; SQL reads the summary through `ball_event_live`, so a voided summary vanishes everywhere; the fold's `SUMMARY_NULLS` stand: a figure the book did not record is NULL after the import and NULL after any correction, never 0 |

A decision off the field (`match_result_decision`: conceded, walkover, awarded; SCRBRD-114 §2.5) is not a correction to the log and is out of scope here; it already follows its own path and triggers.

---

## 5 · Words

| reader | where | words | never |
|---|---|---|---|
| **the public, a parent on the public page, the ground display** | a chip on the scorecard header and beside the innings line that moved; one quiet commentary line | "Corrected 18:42" · "Hilton 164/7 (20) · corrected 18:42, 11 Oct" · "The scorecard was corrected after the match." | who asked; who approved; the reason; a boy's name in the correction line (`PUBLIC_DATA.md`); "pending", "disputed", "under review"; a moment card |
| **a parent, the family screens** (STEP4, GA-I20) | beside her child's innings line | "Corrected 18:42" · "Rohan's innings was corrected after the match: 23 (18) → 19 (17)." (her child's figure, on her child's screen, which she may read) | the reason; the scorer's or approver's name |
| **the coach, the team manager** (Match Centre, staff) | the Corrections sheet (read-only for him) and the chip | "Corrected 18:42 · asked by the scorer, approved by the director of sport · 12.4 ov: 4 runs to D Erasmus removed" | the reason, unless the policy admits him (`scoring_amendment_read`: requester, approver, `audit.read`) |
| **the approver** | the Corrections sheet | the ball in the fold's words; the reason; "Approving removes this ball; nothing replaces it" (D7); the effect: "Hilton 164/7 → 160/7 · result unchanged" or "result changes: Hilton won by 4 runs → Kearsney won by 1 run"; a refusal in `REFUSAL_TEXT`'s words | "approve your own" as a button (not drawn; the server refuses anyway) |
| **the scorer** | the pad after an innings; the request sheet | "Your request is with the director of sport · asked 18:12 · this does not change the score until it is approved" (the GA-I20 "pending is not approved" rule) | — |
| **a reader whose fold is behind** | every screen | "Updated · refresh" · "Could not refresh · showing the match as at 18:40" (I08) | a silent re-fold under the reader's eye; "live" on a figure that is not |

The time is the void's `clientTs` in the fixture's time zone; a date is added once it is not today. Times, never colour alone; nothing under 12 px; the chip is a 44 px target that opens the correction line.

---

## 6 · Reads, writes and migrations

| # | what | why | tier | migration | paste |
|---|---|---|---|---|---|
| **N1** | `GET /api/matches/:id/corrections` → `{amendments: [...], held: [...]}`: `scoring_amendment` rows under its own read policy (requester, approver, `audit.read`), `ball_event_quarantine` rows under its (`scoring.correct`, and the approver by db/14); each with the target's row from `ball_event` where the reader may read it, and `requested_by` resolved to a role word (a name only to the approver) | there is no list read: the routes are request and decide only; the queue row (O7) and the sheet need one | **Opus** (it joins policy-guarded tables) | none | no |
| **N2** | `amendmentRoutes` and `quarantineRoutes` take `onChange` and `onEvents` deps; on an approval or a release that stood, after commit: `publicSite.changed({k:'match', id})` and `hub.broadcastEvents(matchId, [the written row, as `makeCommitAndBroadcast` shapes one])`; wired in `server.mjs` through `afterCommit` exactly as `publicationRoutes` is | D3, in-process | Opus (the write path) | none | no |
| **N3** | the fold: `inn.corrections = [{seq, at, kind: 'void' \| 'recovered', target?}]` beside `voided`; `deriveMatch` lifts `correctedAt`; the generator emits one `correction` line (kind `correction`, team-level words) | D2; the words of §5 | Opus (scoring engine) | none | no |
| **N4** | `milestone_retract()`: AFTER INSERT on `ball_event` `WHEN (NEW.kind = 'void')`: for the voided row's striker and bowler (and `dismissed_id`), re-ask db/51's `innings_runs_off_bat()`, `career_runs_off_bat()`, `bowler_innings_figures`, `bowler_hat_trick` and the career wicket sum; each `milestone_notice` for that (player, match, innings) whose mark is no longer reached gets `retracted_at`; its `notification` likewise; one low-urgency `notification` ("The notice 'Fifty for D Erasmus' was withdrawn after a correction") to the same `team` scope under `news.read`. `notifications`, `recognition()` and `milestone_notice_read` exclude retracted rows; `bowling_breach_watch`'s rows checked the same way (read first: §9 Q6) | D4; **broken today** | **Opus** (schema, minors' data in notices) | one `db/NN`: `retracted_at` on `milestone_notice` and `notification`, the trigger, the views restated | **yes** |
| **N5** | `public_data_changed` AFTER INSERT on `ball_event` `FOR EACH ROW WHEN (NEW.kind = 'void' OR NEW.recovered)` → `public_data_notify('match', 'match_id')` | D3 across instances; never per ball | Opus | the same `db/NN` as N4 | yes |
| **N6** | `void.replacement`: a `void` may carry one event of the same innings; `foldLog`/`foldSteps`/`MatchFold._refold` apply it in the target's place; `ball_event_live` gains a `UNION ALL` of replacement rows populated from the void's payload at the **target's `seq`** (so every SQL fold in `seq` order sees it where the ball was); `laws.mjs` judges the replacement against the fold up to the target; `scoring_amendment` carries the proposed replacement; the fingerprint (db/36) covers it as payload | D7, Q1 | **Opus**, with a Fable check of the fold rule first | one `db/NN` (the view restated with `security_invoker`; a column or payload on `scoring_amendment`) | yes |
| **N7** | exports (PDF, CSV) carry "as at <time> · head <seq>" | D11 | Sonnet | none | no |
| **N8** | the Corrections sheet, the request sheet, the O7 queue row, the chips and lines of §5, the stale line of §7 | D5, D6, D9 | **Sonnet** builds, **Opus** reviews (approval is a write that moves a child's figures) | none | no |

Nothing in N1–N3, N7–N8 widens a read or adds a gate: every row comes through a policy that exists. N4–N6 each need a `db/NN`, a `db/99` section and a production paste, and are after the pilot.

---

## 7 · States

| state | how it is known | what the reader sees |
|---|---|---|
| **current** | the reader's head = the server's (`events`: the last row; public: `last`; hub: `uptoSeq`) | the figures, and the chip if `correctedAt` is set |
| **stale** | a hub message or a header read says a head beyond the reader's; or a settled match reopened after `correctedAt` moved | "Updated · refresh" (a 44 px line; the figures stay until the tap, so nothing moves under a finger) |
| **refreshing** | a read in flight | the figures stay; the line says "Updating…" |
| **failed to refresh** | the read failed (`unreachable`, 503, 429) | "Could not refresh · showing the match as at 18:40" (I08: a failed read is said, never a zero); the next poll tries again |
| **correction pending approval** | N1 returns a pending row the reader may see | staff: "1 correction awaiting approval ›"; approver: the sheet; scorer: "with the director of sport"; public and parent: nothing (D12) |
| **correction refused** | the decide route answered `laws_refused` or `declined` | the approver: the Law's words; the scorer: "Declined: <note>" where the policy shows him the row |
| **not recorded** (NULL) | `SUMMARY_NULLS`, `UNRECORDED_ZERO`, the public header's `runs == null` | an em dash, never 0, before and after any correction |

---

## 8 · Slices

| slice | ships | migration | who | when |
|---|---|---|---|---|
| **A0 · pre-freeze, optional** (D13) | N2 (the two hooks and their `server.mjs` wiring, with a fake-hub test); the "Corrected HH:MM" chip on the Match Centre scorecard from `inn.voided` and the latest void's `clientTs` (no engine change: the Match Centre already has the events) | **none** | Opus for N2; Sonnet for the chip; Opus review | before 12 Oct, only if the solo test will approve an amendment; otherwise skip |
| **A1 · the product, over what exists** | N1, N3, N7, N8: the Corrections sheet (approve, decline, release, discard, with the effect computed client-side by folding the log with the void applied and the server's result words before and after), the request sheet, O7 on the To-resolve screen, every chip and line of §5, the stale states of §7, the `correction` commentary line; A0 if not shipped | none | Opus (N1, N3), Sonnet (N7, N8), Opus review | post-pilot |
| **A2 · the two triggers** | N4 (notice retraction) and N5 (void-only public notification), one `db/NN`, a `db/99` section | one | Opus | post-pilot |
| **A3 · replacement** | N6, after Kameel's say (Q1) | one | Fable check of the fold rule, then Opus | later |

### 8.1 Tests that prove it

**Unit, `packages/scoring/test` (plain node)**
- `inn.corrections` lists every void and recovered row the fold met, in `seq` order; `correctedAt` is the latest; a log with none has `correctedAt === null`, not `0`.
- A `void` of a `void` is skipped (today's rule); a void whose target is in another innings is refused (`void_wrong_innings`).
- **Property-style:** for 500 random logs (the `result-logs.mjs` generator extended with random K1 voids, a K3 void of any non-foundation event, a K4 appended ball, and a K5 summary then its void), `deriveMatch(events)` equals `deriveMatch(events without the voided rows and the voids)`, innings by innings; `MatchFold` incrementally pushed equals `deriveMatch` of the whole; `chartData.projectMatch` of both is deep-equal and ends on each innings' total; the commentary of both differs only by `correction` lines. Includes a voided wicket off a wide and a voided no-ball with `nbRuns: byes`.
- NULL: a summarised innings's `balls`, `fours`, `sixes` stay `null` through a void and a re-import; `projectInnings` of it draws nothing and says `summarised: true`; `n()` is never applied to a `SUMMARY_NULLS` figure on the way to a drawn number.

**SQL parity, `tools/smoke-fold-figures.mjs` and a new `db/99` section**
- For each seeded match and each kind K1–K5 applied to it: `match_live_score`, `innings_result_state()`, `match_result()`, `player_batting_since()`, `player_bowling_since()`, `player_innings`, `competition_standing` and `public_match_log` folded by the page all equal the fold's figures **for the same reader**, before and after; `result_hash` moves exactly when the fold's outcome words do; `progression_check()` ran (the downstream fixture re-resolved or flagged).
- A2: a fifty on seq 40 voided at seq 41 → `milestone_notice.retracted_at` set, the notification excluded from `notifications`, one "withdrawn" notice to the team under `news.read`; the fifty re-reached at seq 60 → no second notice; a void of an unrelated ball retracts nothing; `bowling_breach` rows behave the same way.
- A2: a void on a published fixture drops its public entry within one notification; an ordinary ball does not notify.

**API walks (`tools/smoke-amend.mjs` extended, `smoke-quarantine.mjs`)**
- K3 approved: within the same process the public log read answers the new `last` at once (no TTL wait); the hub delivered one `events` message with `uptoSeq = head`.
- Refusals: the requester cannot approve (`cannot_approve_your_own`); a scorer cannot approve (`not_permitted`); an approver cannot request (db/24); a void of an `innings_start` (`void_foundation`); a void of a voided ball (`void_already_voided`); a release of your own held ball; `GET /corrections` as a coach without `audit.read` returns rows without `reason`; as a guardian or the public: nothing, 403 or 404 as the route is.
- Scope: the same correction read as the director, the away school's coach and the public gives three folds, each equal to its own SQL figures.

**Browser walks (`smoke-browser-matchcentre.mjs`, `smoke-browser-public.mjs`)**
- A completed fixture open in two browsers; approve an amendment in a third; both show "Updated · refresh" within the poll, and the figures change only on the tap; the public page shows the chip and the line; the rendered public page contains no reason, no requester, no boy's name in the correction line.
- The approver's sheet draws no Approve button on his own request; a declined request shows its note to the scorer; `smoke-a11y`: 12 px floor, 44 px chip and rows, the stale line a live region.

---

## 9 · Open questions for Kameel

| # | question | recommendation |
|---|---|---|
| **Q1** | May an amendment replace a ball, not only remove it (A3, N6)? Without it "the wrong batter credited" can only be fixed by removing the runs from the match | **Yes, as A3**: a `void` with a `replacement` folded in the target's place, one rule in the engine and one view in SQL; Fable checks the fold rule before Opus builds |
| **Q2** | A scorer who spots an error two balls back during play: a void with no second name, or an amendment the director approves from his phone? | **The amendment** (D8). The Laws already say so; the request sheet on the pad makes it a ten-second act |
| **Q3** | Should the public page say "Corrected" at all? | **Yes, time only, team-level.** A scorecard that changes silently after the fact is the thing a parent distrusts; the time is a team fact under `PUBLIC_DATA.md` |
| **Q4** | A retracted notice: hide it, or hide it and say so? | **Both**: `retracted_at` hides it from every read, and one low-urgency notice to the same audience says it was withdrawn; a notice that vanishes without a word is the thing a coach distrusts |
| **Q5** | A released held ball is written at the end of the log (db/14), not where it happened | **Leave it for now and say it on the sheet**; revisit with N6, which gives the fold a way to place an event at an earlier position |
| **Q6** | `bowling_breach_watch()` (db/08): I did not read it; a breach row for a ball later voided likely stands as written, as the notices do | **Opus reads it in A2 and treats it as N4 treats a notice**; a breach is a safety record, so a false one matters more, not less |
| **Q7** | A0 before the freeze? | **No**, unless the solo test will approve an amendment or release a held ball; the figures are right today, and the test's one real risk (a fifty voided) needs A2's migration anyway |

## 10 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | `max(seq)` per match is allocated only under the per-match lock, by every writer (live path, db/37, db/38, the import's commit) | a gap in `seq` is still monotonic; D1 holds, and the property test would show two rows at one `seq` as a constraint error |
| **A2** | the hub's `events` message with a `void` payload is applied by `MatchStream` and `MatchFold._refold` as a live undo is today | N2 ships with the fake-hub test that proves it |
| **A3** | `public_match_header`'s `scores` read `match_live_score` and so follow a void without a change | if they read a stored figure, N5's drop is still what refreshes them, and the parity test catches a stale one |
| **A4** | the notification read (`notifications`) can exclude a row by a new column without a module change | GA-I12's receipts work lands beside it; the two are read in the same place |
| **A5** | `scoring_amendment_read` is the right audience for the reason (requester, approver, `audit.read`) and needs no widening for the coach | D9 and Q-less: widening is a `roles.mjs` change and a paste (ADR 0003), decided then |
