# SCRBRD-114 phase 3 — Match results, the super over, and the table: the design

**Status:** for Kameel's review, 2026-09-30. Nothing here is built. Design within Kameel's decisions of 2026-09-30 (`SCRBRD-114_playing_conditions.md` §8.3a): KZN schools play the MCC Laws (4th Edition from 1 October 2026) with no further bye-laws; the pilot league scores win 4 / tie 2 / no result 2 / loss 0 with no bonus; **a knockout tie goes to a super over; a league tie stands (Law 16)**; bowling limits are CSA's age-group guidelines.
**Reader:** Kameel first; then Opus, who builds §2–§7 in the phases of §8; then Sonnet for the screens named there.
**Sources of the rules:** the MCC Laws of Cricket for the result (Law 16) and the innings (Law 13); the standard super-over playing conditions as the ICC's men's T20I conditions state them (the appendix on the super over, as amended after 2019). Both are cited from memory, not from a document in the repository; clause numbers are the 2017 Code's and are **to be confirmed against the 4th Edition**, as the other words in `laws.mjs` are. Everything school-specific is marked **A** (assumption) and listed in §9.

---

## 1 · A tied knockout, on the day, in one page

Two sides finish level in a cup match. The scorer's pad has just sealed the second innings; the board says **Match tied**. Because the match's frozen conditions say `result.tie_break = super_over` (a cup is its own competition with its own published set, or the one fixture carries an override, §3.5), the pad shows one more button: **Super over**. In a league match it does not, and the tie is the result.

The scorer presses it. The pad opens a new innings, numbered 2, marked as the first super over, with the side that **batted second in the match batting first** (the standard order), one over, the same eleven on each side, the free hit as the match has it. It is scored exactly like any over: the bowler is named, two openers are named, six legal balls or two wickets end it, the seal reads the figures back. Then innings 3: the other side, one over, chasing one more than that. The fold decides it as it decides any chase: the target reached, the target missed, or level again. Level again means another super over, innings 4 and 5, batting order swapped, a batter out in the first not eligible in the second, the bowler of the first not eligible in the second (the pad says so in words; the umpires decide, and the scorer records what happened). Until a side wins, or the light goes.

The public page shows what a scorecard shows everywhere: **Match tied; Northwood won the super over**, with the super over's two lines under the match's four. The boys' careers do not move for the super over: no run, no wicket, no ball faced in it counts in any career, milestone or dossier, as is standard. The bowler's **workload does** count it: the boy bowled six more balls today, and the day limit is about his arm, not the record book.

The competition's table does not move either. A cup has no table; and if a league match ever recorded a super over, the standings would still read the match as a tie (2 points each), because the outcome of the *match* is a tie and the super over only says who goes through. The next round's fixture, which the planner drafted as "winner of match 7", is created that evening with Northwood as its side, and a `match_progression` row remembers where the side came from. If the result is later corrected by an approved amendment (a wrong seal, a missed no-ball), the platform re-resolves that row while the next fixture is unplayed, and **flags** it if it has been played: nothing downstream is rewritten silently.

If the light goes with the super over unfinished, the log says what it can say: the match was tied, a super over was started and not completed. Who goes through is then the organiser's decision, recorded as one (`match_result_decision`, `awarded`, with a reason), shown beside the play result and never confused with it. The same record carries a concession (Law 16.3's award by the umpires) and a walkover.

---

## 2 · Results: `describeResult()` and `match_result()`

### 2.1 Plain words

A result is read from the log, never stored. The fold's `describeResult()` (`replay.mjs`) is the rule in JavaScript; `match_result()` (new, SQL) is the same rule over `innings_score_as_folded()` and the seals, and the two are held together by the parity proof (§7). A correction of a result is a correction of the log — an approved amendment, a release from quarantine, a void — and every reader follows on the next read. The one thing the log cannot say is a decision taken off the field: a side conceded, a side did not arrive, the organiser awarded an unfinished cup match. That is a **decision row**, kept apart from play and shown apart from it.

### 2.2 The outcomes

`match_result(match_id)` returns one row:

```
outcome        home_win | away_win | tie | draw | no_result | abandoned | in_progress
margin_kind    runs | wickets | penalty_runs | innings | conceded | walkover | awarded | NULL
margin         int (runs, or wickets in hand, or runs with an innings), NULL otherwise
decided_by     play | super_over | decision | NULL        -- who settled who goes through
winner_school_id, winner_team_code                       -- the side that goes through; NULL on tie/draw/no result
super_overs    jsonb [{n, first: 'home'|'away', a: {runs, wickets, balls}, b: {...}, state: 'won'|'tied'|'incomplete', winner}]
decision       jsonb {kind, by, at, reason} | NULL
result_hash    text   -- md5 of (outcome, margin_kind, margin, decided_by, winner): what progression compares (§5)
```

`outcome` is **the match's** outcome, from its scheduled innings alone. A super over never changes it (D7): a knockout decided by a super over is `outcome = tie, decided_by = super_over`, with `winner_*` the super over's winner. The standings read `outcome`; the knockout progression reads `winner_*`. That one split is what makes "a super over never changes league points" true by construction rather than by a special case.

| outcome | when (limited-overs, one innings a side; `t` = the chase's target, revised or `first + 1`) |
|---|---|
| `home_win` / `away_win` by **wickets** | the chase reached `t` (`target_reached`); margin = wickets in hand, as today |
| … by **runs** | the chase ended (`all_out`, `overs_complete`, or a revision's overs reached) short of `t`; margin = `t − 1 − runs` |
| … by **penalty runs** | Law 16.7 (4th Edition): the chase was completed short and an award then made it enough (`penaltyWin`), as today |
| `tie` | the chase ended level: `runs = t − 1` |
| `no_result` | play began and no result could be reached: the chase's innings ended `abandoned`, or ended `overs_complete` with fewer overs than `result.min_overs_per_side` (§2.3), or the match is `complete` with the chase never started or never completed |
| `abandoned` | `match.status = 'abandoned'` (db/33): the fixture was called off before a delivery, or the umpires abandoned it and the organiser recorded the status |
| `in_progress` | everything else |
| `draw` | two innings a side only (`format.innings_per_side = 2`): the match is `complete` and the fourth innings was not completed, or was not reached (D11) |
| … by **an innings and N runs** | two innings a side: the side batting twice did not pass the other's single total; margin = the difference |

Two fixes to today's `describeResult()` fall out of the table: an innings sealed `abandoned` is `complete` in the fold, and today's function would read it as a win by runs; and a two-innings match is read from innings 0 and 1 alone. Both are corrected in phase 3a, in the fold first and the SQL mirror second.

A **decision** (`match_result_decision`, §2.5) supplies `conceded`, `walkover` and `awarded`. A concession or walkover is a win for the other side (`outcome = home_win`/`away_win`, `margin_kind = conceded`/`walkover`, `decided_by = decision`), because Law 16.3 says the umpires award the match; points follow `points.win` / `points.loss` (**A**: the pilot treats a concession as a win and a loss; an organiser who wants otherwise adjusts, §6.3). An `awarded` decision names the side that goes through when play could not settle it (an unfinished super over, §3.6) and, with a reason of at least ten characters and only under the capability of §2.5, may override a played result (a protest upheld). The public words then say both: "Won by 3 wickets; awarded to Kearsney by the organiser: …".

### 2.3 What `result.min_overs_per_side` does

The standard condition says a result needs the side batting second to have had the opportunity to face at least N overs, unless it was all out or reached its target first. So the key is read on **the chase's innings only**: if the overs it was given (`revised.overs`, else its `innings_start`'s overs) are fewer than N and it ended by `overs_complete` or `abandoned`, the outcome is `no_result`. A chase that reached its target in three overs is a win whatever N is. The platform default is none (today's behaviour: the fold's result stands whenever the chase resolves), and Kameel's decision sets no figure, so the key does nothing in the pilot; it is here because `match_result()` is where it would act and the parity proof covers it now.

**DLS is out of scope.** `target.method` stays `umpires_revision`: the umpires compute a revised target however they compute it (a DLS sheet by hand is fine) and the scorer records it as the `revision` event carries it today. The platform never computes a target.

### 2.4 The words

`describeResult()` keeps its shape (`{winner, margin}`) for every caller it has, and gains a `text` and the `decidedBy` the pad and the public page read:

| case | words |
|---|---|
| win | "Kearsney won by 3 wickets" · "… by 12 runs" · "… by penalty runs" · "… by an innings and 23 runs" |
| tie, no tie-break | "Match tied" |
| tie, super over won | "Match tied; Northwood won the super over" · "…; two super overs tied; Northwood won the third" |
| tie, super over unfinished | "Match tied; the super over was not completed" (+ the decision's words if one exists) |
| no result / abandoned / draw | "No result" · "Match abandoned" · "Match drawn" |
| decision | "Kearsney conceded; awarded to Northwood" · "Walkover to Northwood" · "Awarded to Northwood by the organiser: <reason>" |

The super over's own figures ("Northwood 9/0, Kearsney 8/1") are the scorecard's, not the result line's.

### 2.5 The decision row

```
match_result_decision (
  id uuid PK, match_id uuid NOT NULL → match,
  kind text NOT NULL CHECK (kind IN ('conceded','walkover','awarded')),
  side text NOT NULL CHECK (side IN ('home','away')),     -- conceded: who conceded; walkover/awarded: who goes through
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  overrides_play boolean NOT NULL DEFAULT false,          -- 'awarded' only; true when play had a winner
  decided_by uuid NOT NULL → app_user, decided_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_by uuid, withdrawn_at timestamptz, withdrawn_note text
)
```

Written under `competition.manage` for a match in a competition and under the home school's `fixture.update` for a friendly (**A**; D8); at most one standing row per match (a partial unique index on `withdrawn_at IS NULL`); never deleted, withdrawn with a note, as `competition_points_adjustment` is. The trigger refuses `overrides_play` on any kind but `awarded`, and refuses a row on a match with no `ball_event` unless the kind is `walkover` or `conceded`. `match_result()` reads it last: play first, the super over second, the decision third, an `overrides_play` award above all three. A decision is not scoring: it needs no scoring capability and never touches the log, which is why it can be withdrawn and a seal cannot.

### 2.6 Correcting a result, and what it triggers

There is no "edit result". The paths are the ones that exist: `scoring.amend.request` → `scoring_amendment_decide()` (db/38) appends the void or the corrected events; a release from quarantine (db/33); the organiser's status change; a decision row or its withdrawal. Each changes what `match_result()` returns on the next read, and:

1. `competition_standing` follows (nothing stored, §6);
2. the public page re-reads (db/59's read path re-reads on `match.updated_at`, as §5.3 of the parent asks the builder to confirm; a decision row touches `match.updated_at` through its trigger for the same reason);
3. `progression_check(match_id)` runs (§5): the downstream fixture is re-resolved or flagged;
4. the amendment decision's audit line names the result before and after (`result_hash` both sides), so an amendment that flips a result is visible in the audit as one that did.

---

## 3 · The super over in the log

### 3.1 Innings indexes with a marker, not a new kind (D1)

A super over is **two more innings** in the same log, at the next indexes (2 and 3 for a one-innings-a-side match; 4 and 5 for the second super over), each opened by an `innings_start` that carries `superOver: n` (1-based, the nth super over), `overs: 1`, the match's squads, and on the second of the pair `target = first.runs + 1`. Nothing else is new on the wire: the balls, the batters, the bowler, the seal are the events they are in any innings.

Why not a new kind, as the scorebook's `innings_summary` was: the summary needed one because no existing event could say "known by its figures" without fabricating balls. A super over is *play*, and every reader of play — readiness, the Laws, the seal, `MatchFold`, `innings_score_as_folded()`, `match_live_score`, the handover's `confirmationState()`, the commentary, the pad's board — already works per innings index. A marker on the innings' first event costs each of those nothing; a new kind would have cost each of them a branch. What the marker does cost is the **exclusion**: every reader that must not count a super over has to see the marker, which is §4's list, and it is the same shape of work db/64 did for the book.

The key is **omitted, not null**, on every match innings, as `captureProfile` is (`events.mjs`): an `innings_start` built today is byte-for-byte what it was. `toRow()` puts it in the row's payload; `fromRow()` reads it back; the fold sets `inn.superOver = n | null`. SQL derives an innings' role once: `ball_event_live` gains a column `super_over smallint` (NULL for a match innings, `n` for the nth super over), from the `innings_start` row of its `(match_id, innings)` — the way db/31 derives `innings_declared_profile` from the same row.

### 3.2 The rules the fold applies

Under the standard conditions, cited as such:

| rule | source | in the fold |
|---|---|---|
| one over a side | standard | `overs: 1` on the `innings_start`; the innings ends at six legal balls as any innings does (`inningsOverReason`) |
| the loss of two wickets ends the innings | standard | `inningsOverReason()` uses `2` where `inn.superOver` is set, in place of `min(10, squad − 1)`; the derived reason stays `all_out` (the seal check, `DERIVED_END_REASONS`, and SQL's mirror need no new code); the words say "two wickets down" |
| the side batting second in the match bats first; in a further super over, the side batting second in the previous one bats first | standard (the post-2019 conditions) | the pad pre-fills the order; the fold records whatever was played (D2) |
| the second innings of the pair chases one more than the first | Law 16 as for any chase | `target` on the `innings_start`, as a chase carries it today |
| the super over is decided like a match: target reached, short, or level | Law 16 | `describeResult()` reads innings in **pairs**: the scheduled pair, then each super-over pair in order; a pair is `won`, `tied`, or `incomplete` (its second innings not complete, or either sealed `abandoned`) |
| a tied super over is followed by another; no boundary count; no cap | standard since 2019 (the boundary count was abolished) | nothing bounds `n`; the restrictions below bound it in practice (a side has eleven bowlers) (D3) |
| a batter dismissed in an earlier super over may not bat in a later one; the bowler of an earlier super over may not bowl a later one | standard | **words on the pad, not a refusal** (D4): the umpires decide on the day, and a refusal would strand the scorer against the game in front of him, exactly as the parent's D1 argues for conditions |
| any member of the eleven may bowl the first super over, whatever he bowled in the match | standard | nothing to do; the Laws' consecutive-overs rule cannot bite across an innings boundary |
| three batters at most | standard | by construction: two wickets end it. A retirement could let a fourth in; recorded, not refused |
| extras, free hits, penalty runs, wides and no-balls | as the match: Law 41 and `format.free_hit` from the frozen document | nothing new. **One fix:** `penaltyCredits()` sends an award to the fielding side to "that side's last completed innings, or its next", which would send a super-over award to a *match* innings. Credits are scoped **within a pair** (the scheduled pair; each super-over pair), so an award in innings 2 lands in innings 3 or nowhere |
| no revision | standard: a super over is not shortened; weather ends it | `revision` in a super-over innings is refused (§3.3) |
| ends, the interval, fielding restrictions, nominated batters | standard | not modelled: the log records no end, no clock the umpires keep, no nomination. Said in the pad's words once, when the super over opens |

Which innings are "scheduled" is `format.innings_per_side × 2` from the frozen document (`conditionsOf(ctx)`; 1 × 2 for a limited-overs match, and every match before db/61, as today). A super over exists only in a limited-overs match; a two-innings match's tie is a tie (D11).

### 3.3 New Laws refusals

`lawsRefusal()` gains these, keyed as the rest of `REFUSAL` with words in `REFUSAL_TEXT`. Each reads the fold and the log alone; **none reads a condition**.

| refusal | when |
|---|---|
| `SUPER_OVER_NOT_TIED` | an `innings_start` with `superOver` when the pair before it is not `tied` — the match innings are not both complete, or were not level; or the previous super over was won or is incomplete |
| `SUPER_OVER_NUMBER` | `superOver` is not `1` for the first pair after the scheduled innings, or not the previous pair's `n` for its second innings, or not `n + 1` for the next pair; or a super-over innings at an index below the scheduled innings |
| `SUPER_OVER_AFTER_MATCH_INNINGS` | an `innings_start` **without** `superOver` at an index at or beyond the scheduled innings (a third innings in a one-innings match) |
| `SUPER_OVER_NO_REVISION` | a `revision` in a super-over innings |
| `MATCH_DECIDED` (redefined) | today: any ball once `innings[1].complete`. Now: any play event once the **last pair is won**, or once the last pair is tied and no tie-break innings has been opened after it; a ball in a match innings once a super over has opened is `LATER_INNINGS_STARTED`, as today for any earlier innings |

`PREVIOUS_INNINGS_OPEN`, `INNINGS_OVER`, `INNINGS_CLOSED` and the crease rules apply unchanged. `laws.mjs` keeps its header's promise: it reads no condition. Whether a super over *belongs* in this match is the write path's question (§3.5).

### 3.4 The seal

The scorer seals each super-over innings as any innings: `sealInnings()` reads the figures off the fold, `sealRefusal()` checks them, `all_out` at two wickets or `overs_complete` at six balls or `target_reached`. An `abandoned` seal is allowed and makes the pair `incomplete` (§3.6). db/33's completion gate must learn one thing: a tied match under `result.tie_break = super_over` is not complete at the second innings' seal; it is complete when a pair is won, or a pair is `incomplete`, or the organiser records a decision. Opus confirms where that gate reads the result today and re-emits it.

### 3.5 How the pad starts one

The pad offers **Super over** when all of these hold, and otherwise shows "Match tied" as today:

1. the frozen document (`match_playing_conditions()`, `applies = true`) says `result.tie_break = super_over` and `format.kind = limited`;
2. the fold's last pair is `tied` (the scheduled pair, or the last super over);
3. the pair's second innings is sealed.

"The match is a knockout" is not a separate test: it is what the document says. A cup is its own competition row with its own published set (`result.tie_break = super_over`); the one cup fixture inside a league — a final, a play-off — carries a `match_condition_override` for the key with its reason before play is fixed (parent §2.2, D9). No new flag on `match` or `competition`. When the planner adds group-then-knockout stages, the key moves to the stage's grain and nothing here changes.

The pad builds the pair from what it holds: the batting order of §3.2 (pre-filled, changeable with a one-line notice "the standard order is …"), the two squads from the match's `innings_start`s, `overs: 1`, `superOver: n`, and on the second innings `target`. The write path (`appendEvents()`, `services/api/write/events-api.mjs`) refuses an `innings_start` with `superOver` when the match's frozen document does not say `super_over` — reason `super_over_not_provided`, with words — **outside `laws.mjs`** (D10): it is the one place a condition refuses an event, it refuses an innings and never a delivery, and the alternative is a public page announcing a "super over winner" in a league whose rules have none. An older pad build cannot send the key, so nothing already scored is touched.

### 3.6 Bad light, time, and the unfinished super over

A super over is played to a finish or not at all; there is no shortened super over. If it cannot be completed, the pair is `incomplete` (its second innings not sealed, or either sealed `abandoned`), `match_result()` says `outcome = tie, decided_by = NULL`, the words are §2.4's, and who goes through is the organiser's `awarded` decision with its reason (an ICC event names a fallback such as the higher group finisher; a school cup's is whatever its organiser decides, **A**). There is no boundary count, a bowl-out or a toss in the platform: if the organiser used one, the reason says so.

---

## 4 · What the super over feeds, and what it must not

| reader | super over |
|---|---|
| the scorecard, the live board, `match_live_score` | **yes**, as its own block after the match's innings: `match_live_score` gains `super_over` (from `ball_event_live`), and the pad's board and db/59's scorecard show "Super over 1" over the pair's two lines |
| the public log (`public_match_log`) and the public scorecard | **yes**, the events as they are, pseudonymised as any; the result line of §2.4 |
| the commentary (`commentary.mjs`) | **yes**, with its own opening words ("Super over. Northwood to bat first; …") and no career milestone words |
| the result, `match_result()`, progression | **yes**, as §2 says: `decided_by = super_over`, `winner_*` |
| the workload record (`load_day`, `bowler_over`, `bowler_spell`, `bowling_breach_watch()`, SCRBRD-110's load model) | **yes, unchanged**: the boy bowled the balls; a super over is one more over of the day and a new spell, and the age-group day limit judges it as it judges any over. A U13 on ten for the day who bowls the super over gets the breach row the guidelines say he should (D6) |
| careers: `player_innings`, `player_batting_career`, `player_bowling_career`, `player_dismissals`, `player_dismissal_breakdown`, `player_dismissals_since()`, the three `*_by_season` views, `player_batting_since()`, `player_bowling_since()`, `bowler_innings_figures`, `player_wicket_breakdown`, `player_milestone`, the rewards' score, the passport's career line, the form guide | **never** (D6, as is standard everywhere: super-over figures are not career figures). Every reader in db/64's list, which is exactly the set that had to learn the book, gains `AND super_over IS NULL` on its live branch |
| `milestone_watch()`, `innings_runs_off_bat()`, `career_runs_off_bat()` | **never**: a super-over six is not a career run and a five-for cannot happen in one over |
| the ratings read, the opposition dossier (`opposition_squad()`), the matchups, the phases (`phases.mjs`, powerplay/middle/death by over number), the worm, the wagon wheel aggregates (`public_shot_sectors`, the player's placement views) | **never**: each is a career-shaped read or a per-over-number model that a one-over innings would distort. The match's own wagon wheel screen may show the super over's balls under its block (the balls carry placements) but no aggregate takes them |
| the standings, `competition_standing` | **never**: it reads `outcome` (§6) |
| handover and resume | nothing new: the log carries the pair; the claim returns `deriveMatch()`'s innings array, which now has four or six entries; `confirmationState()` is per innings; the conditions hash is unchanged |

The proof (§7) is db/64's `(typed)` proof again: a match with a super over is folded and every career reader is held to the figures of the match innings alone, before and after the super over is appended.

---

## 5 · Knockout progression

### 5.1 Plain words

The planner (SCRBRD-123) drafts a knockout with later-round sides as `{ winnerOf: fixtureId }` and holds those drafts back (`awaiting_winner`) until the side is known. Phase 3 of the planner says "knockout rounds published as results resolve their sides". This section is the contract between the two: **a result resolves a reference; a corrected result re-resolves it while nothing has been played and flags it once something has.**

### 5.2 The record

```
match_progression (
  match_id uuid NOT NULL → match,                 -- the downstream fixture
  side text NOT NULL CHECK (side IN ('home','away')),
  from_match_id uuid NOT NULL → match,            -- the upstream match
  take text NOT NULL CHECK (take IN ('winner','loser')),   -- 'loser' for a placement match, later
  resolved_school_id uuid, resolved_team_code text, resolved_at timestamptz,
  resolved_result_hash text,                      -- match_result(from_match_id).result_hash when resolved
  conflict_at timestamptz, conflict_note text,    -- set when the upstream result changed after play downstream
  PRIMARY KEY (match_id, side)
)
```

The planner's publish step (its phase 3) creates the downstream fixture through `POST /api/fixtures` once `match_result(from)` has `winner_*`, writes the row with the hash, and fills `draftFixture.body`'s side from it. Until then the draft stays held, as today.

### 5.3 `progression_check(match_id)`

Called after every path of §2.6 for the upstream match, and by the planner's publish. For each row whose `from_match_id` is that match:

| downstream fixture | upstream result now | action |
|---|---|---|
| no event yet | has a winner, hash differs | re-resolve: amend the fixture's side through the fixture amend route's own rule (a correction before the first ball), write the new hash, notify the organiser and both schools |
| no event yet | no winner any more (an amendment made it a tie, a decision withdrawn) | clear `resolved_*`, leave the fixture with the old side and `conflict_at` set with the note "awaiting a winner of …": the organiser sees it on the bracket; nothing is deleted |
| has an event | hash differs | **flag only**: `conflict_at`, `conflict_note` ("the result of … changed after this match was played"); the played fixture is never rewritten; the organiser resolves it with a decision row (§2.5) or an adjustment, and clears the flag with a note |

A `progression_conflict` view (per competition, `security_invoker`, under `competition.read`) lists the flags for the bracket screen and the organiser's inbox.

---

## 6 · The table: `competition_standing`

### 6.1 Plain words

The table is arithmetic over `match_result()` under each match's own frozen `table` document, computed on every read, exactly as the parent's §5 says; nothing here is folded and nothing is stored. A super over is invisible to it: it reads `outcome`, and a knockout has no table.

### 6.2 The view

One row per `competition_entrant`, per division, over its competition's matches with `match.competition_id = c.id` and `status IN ('complete','abandoned')`:

- `played` = matches with `outcome <> 'in_progress'`; `won`, `lost`, `tied`, `drawn`, `no_result` (`no_result` + `abandoned`) from `outcome` and which side the entrant was;
- `points` = Σ over matches of `doc->'table'->'points.<outcome-for-this-side>'`, where a win is `points.win`, a loss `points.loss`, a tie `points.tie`, a draw `points.draw`, a no result `points.no_result`, an abandoned match `points.abandoned` **falling back to `points.no_result`** when the set states none (Kameel's four figures state none for abandoned); a conceded or walkover match is a win and a loss (**A**, §2.2); plus Σ `competition_points_adjustment.points` for the entrant not withdrawn (§6.3); `bonus.kind` is `none` in the pilot and the view carries the hook and no arithmetic;
- `nrr` as §6.4; `basis` and `unattested_results` as the parent's §5.3;
- ordered by `table.order`, default `[points, wins, nrr]`, then `fewer_losses` when listed; `head_to_head` is accepted in the list and **not applied** in phase 3 (the screen says "head-to-head: not applied"), because it needs a sub-table over the tied entrants' mutual matches and no pilot competition lists it (D13). Entrants equal on every listed key share a rank (`RANK()`), as a printed table does.

### 6.3 Adjustments

`competition_points_adjustment` as the parent's §5.4, unchanged: entered, never computed, withdrawn with a note. The `over_rate.kind` sheet is offered only when the key is not `none`; the pilot's is `none`, so the sheet is one screen Sonnet builds and no pilot organiser sees.

### 6.4 Net run rate, exactly

`nrr.method = standard`, defined in **balls**, so SQL and the proof's hand arithmetic are exact integers until the last division:

- Over the entrant's matches in the competition with `outcome IN ('home_win','away_win','tie')` — a no result, an abandoned match, a draw and a conceded or walkover match contribute nothing (standard; a match with no play has no rate). A super over contributes nothing (`super_over IS NULL`).
- For each such match, for the entrant's own innings: `runs_for += runs` (the fold's total, penalty runs and `penaltyCarried` included, as `innings_score_as_folded()` gives it); `balls_for += (all_out ? allotted × 6 : legal balls)`, where `all_out` is the innings' end reason and `allotted = revised.overs ?? innings overs` (the `innings_start`'s, else the document's, else 20: `play_overs()`). A scorebook innings gives its card's balls and its end reason the same way. The opponent's innings likewise into `runs_against`, `balls_against`.
- `nrr = runs_for × 6 / balls_for − runs_against × 6 / balls_against`, `numeric`, NULL when either denominator is 0; shown to three decimals; ordered on the unrounded value with NULL last.

A chase that wins in 14.3 overs is charged 87 balls. A side all out in 17 overs of a 20-over match is charged 120. A side all out in 8 of a match revised to 12 is charged 72. Wides and no-balls add runs and no balls.

### 6.5 The pilot's set

Kameel enters the four figures as the pilot league's first published set (parent §8.3a); the view shows `basis = computed` for it from the first complete match. A cup competition publishes `result.tie_break = super_over` and no points, and has no standings screen (the bracket is the planner's).

---

## 7 · Determinism and parity

The fold and SQL must agree on, for every log in `tools/smoke-fold-figures.mjs`'s list plus the new ones below: each innings' `runs, wickets, balls, endReason, revised, superOver` (already held for the first four); `match_result()`'s `outcome, margin_kind, margin, decided_by, winner side, super_overs[].state` against `describeResult()`; and `ball_event_live.super_over` against `inn.superOver`. NRR and the standings are SQL-only (nothing in the fold to compare) and are proved against hand-computed figures.

New logs for the list, each folded both ways: a tie under `none`; a tie under `super_over` won by wickets; won by runs; two super overs tied then the third won; a super over left incomplete (second innings unsealed) and one sealed `abandoned`; a super over in a match whose document says `none` (recorded through a fixture — the write path refuses it, so the log is built directly — and the proof shows `outcome = tie` and `points.tie` on both sides); a chase sealed `abandoned`; a chase under `min_overs_per_side = 5` revised to 4 and ended `overs_complete`, and the same chase reaching its target in 3; a penalty-runs win; a two-innings draw and an innings win (D11); a book chase won by wickets and a book tie (db/64 §9.3 item 8 asked for these); a conceded match, a walkover, an award that overrides play.

db/99 sections (continuing from the last), each falsified before it passes, in the parent's style:

- **§results**: `match_result()` = `describeResult()` on the list; an `abandoned` seal is no result, not a win; the decision precedence (play < super over < decision < `overrides_play`); a decision on a match with no event is refused unless `walkover`/`conceded`; a second standing decision is refused; withdrawal restores play's answer; `result_hash` changes when and only when the tuple changes.
- **§super over**: the five refusals of §3.3, each shown refusing and then accepting the corrected event; `MATCH_DECIDED` no longer refuses innings 2 after a tie under `super_over` and still refuses innings 2 after a win; the two-wicket end; the pair's target; a penalty award in innings 2 credited to innings 3 and never to innings 0 or 1; `super_over_not_provided` at the write path; the completion gate: not complete at the tie, complete at the decided pair; every career reader of §4 unchanged before and after the super over (db/64's `(typed)` proof shape); `load_day` and `bowler_spell` gaining the over; `match_live_score` showing `super_over = 1` on innings 2 and 3; `public_match_log` serving the events; a handover claim returning six innings.
- **§table**: a competition with confirmed points computes and one without shows the typed ladder; each `outcome` maps to its `points.*`; abandoned falls back to `points.no_result`; NRR's four worked examples of §6.4 to the ball; a no result contributes nothing to NRR; a super over contributes nothing to points, wins or NRR; a points change effective next week leaves this week's matches on the old figure; an approved amendment that flips a result flips the table on the next read; an adjustment lands and its withdrawal restores; a re-fix keeps `table_doc_before` and cannot change `play`; a support session cannot re-fix or decide; ranks are shared on a full tie; the public page shows confirmed figures and no draft.
- **§progression**: resolution writes the hash; a correction re-resolves an unplayed fixture and flags a played one; the flag is cleared only with a note; a school cannot resolve or clear.

JS tests beside them: `replay.test.mjs` for the pairs and `describeResult()`'s text; `laws.test.mjs` for the refusals; `conditions.test.mjs` unchanged (no new key; the catalogue string does not move).

---

## 8 · Phasing

One migration per phase, its proof in db/99, a smoke walk, and `DEPLOYING.md`'s shipped-file rules. Numbers (corrected by the lead, 2026-09-30) follow db/66 shipped, db/67 (the planner and league wizard) and db/68 (the wicket-keeper, SCRBRD-126) in that order; a function a later phase changes is re-emitted in that phase's file, as `bowling_breach_watch()` was.

| phase | migration | tier | ships | proves |
|---|---|---|---|---|
| **3a · Results and the table** | `db/69` | Opus (fold, `match_result()`, decisions, view, adjustments, proofs); Sonnet (standings screen, adjustment sheet, decision sheet, the result line on the scorecard and public page) | `describeResult()` fixed for the abandoned seal and two innings a side, with `text` and `decidedBy`, exported; `match_result()`; `match_result_decision` and its trigger; `competition_points_adjustment`; `competition_standing`; `match_conditions_refix_table()`; the standings and public reads moved to the view; `over_rate.kind` sheet; the amendment audit line carrying `result_hash` | §7's results and table sections, less the super-over logs |
| **3b · The super over** | `db/70` | Opus (events, fold, Laws, write path, `ball_event_live.super_over`, the career exclusions, `match_result()` re-emitted, the completion gate, proofs); Sonnet (the pad's Super over button and the pair's flow, the board's block, the eligibility words, the scorecard block, the commentary words) | `superOver` on `innings_start`, `toRow()`/`fromRow()`, `inn.superOver`; pairs in `describeResult()`; the two-wicket end; scoped `penaltyCredits()`; the five refusals and `MATCH_DECIDED`; `super_over_not_provided`; `ball_event_live.super_over`; every §4 reader re-emitted with the exclusion; `match_live_score.super_over`; db/33's gate | §7's super-over section and the super-over logs added to the results parity |
| **3c · Progression** | `db/71` | Opus (table, `progression_check()`, the hooks on the four paths, RLS, proofs); Sonnet (the bracket screen's resolved sides and flags, with the planner's phase 3 screen) | `match_progression`, `progression_check()`, `progression_conflict`; the planner's publish writing the row | §7's progression section; `planner-drafts.test.mjs` extended so an `awaiting_winner` draft is posted once the upstream result exists |

3a first. 3b and 3c are independent of each other and both need 3a. The pilot league's season can run on 3a alone (league ties stand); a cup needs 3b before its first tied match, and 3c before its second round is drawn from results rather than by hand.

---

## 9 · Decisions for Kameel

Each with the recommendation the body assumes and one line of why. The parent's D1–D12 stand; these are this document's.

| # | decision | recommendation |
|---|---|---|
| **D1** | A super over as two more innings with `superOver: n` on the `innings_start`, or a new event kind | **The marker.** A super over is play, and every reader of play works per innings; only the exclusions need to see the marker, and that is the same list db/64 already touched once |
| **D2** | Batting order: the side batting second in the match bats first; a further super over swaps. Pre-filled on the pad, not refused | **Yes, the standard order; words, not a refusal.** The umpires order the day; the scorer records it |
| **D3** | A tied super over is followed by another, with no boundary count and no cap | **Yes.** It is the standard since 2019; the eligibility rules bound it in practice, and a cap would be a number nobody set |
| **D4** | The eligibility rules (a batter out earlier, the bowler of an earlier super over) as words on the pad, not Laws refusals; the structural rules (only after a tie, the pair's numbering, no revision) refused | **Yes.** Structure keeps the log well-formed; eligibility is the umpires' call, as the parent's D1 says of every condition |
| **D5** | Any of the eleven may bowl the first super over whatever he bowled in the match; the age-group day limit still counts it and writes a breach | **Yes.** It is the standard condition, and the guideline is about the boy's arm |
| **D6** | Careers, milestones, dossiers, ratings, matchups and phases exclude the super over; workload, spells and breaches include it; the scorecard, log, board and commentary show it | **Yes.** Career figures exclude super overs everywhere; a bowled ball is a bowled ball |
| **D7** | `outcome` is the match's (a tie); the super over sets `decided_by` and `winner_*` only. League points never move; a knockout reads the winner | **Yes.** One split makes "a super over never changes league points" true by construction |
| **D8** | `match_result_decision` for conceded, walkover and awarded, under `competition.manage` (a friendly: the home school's `fixture.update`), with a reason; an award may override play only with `overrides_play` and is shown beside the play result | **Yes.** Law 16.3's award and an unfinished cup match need a record that is not scoring; showing both never hides what was played |
| **D9** | `result.min_overs_per_side` reads the chase's innings only: its allotted overs below N and ended by overs or abandonment is no result; a target reached is a win whatever N. Default none | **Yes.** It is the standard meaning; the pilot sets no figure, so it changes nothing this season |
| **D10** | A super over in a match whose document does not provide one is refused at the write path (`super_over_not_provided`), outside `laws.mjs` | **Refuse.** It refuses an innings, never a delivery; the alternative is a public "super over winner" in a league whose rules have none |
| **D11** | Two innings a side get `draw` and "an innings and N runs" in 3a, and no super over | **Yes, minimally.** `match_result()` cannot leave `draw` unreachable, and today's `describeResult()` misreads a two-innings match |
| **D12** | NRR in balls, over matches with a result only; all out charged the allotted (revised) overs; ties count; super overs, no results, draws and concessions contribute nothing | **Yes.** It is the standard method, exact in integers, and the proof can check it to the ball |
| **D13** | `table.order`: `points`, `wins`, `nrr`, `fewer_losses` applied; `head_to_head` accepted and not applied in phase 3; equal entrants share a rank | **Yes.** No pilot competition lists head-to-head, and a shared rank is honest |
| **D14** | Progression: a corrected upstream result re-resolves an unplayed downstream fixture and flags a played one; nothing downstream is rewritten silently; the flag clears only with a note | **Yes.** The brief's rule, made a row the bracket screen and the inbox can read |
| **D15** | Points for a concession or walkover: `points.win` and `points.loss`; an abandoned match takes `points.abandoned`, falling back to `points.no_result` | **Yes.** It is what leagues do; an organiser who wants otherwise has the adjustment sheet |
| **D16** | An unfinished super over leaves the tie in the log and the knockout to an `awarded` decision; no boundary count, bowl-out or toss is modelled | **Yes.** The log says what happened; the reason says how the cup was decided |
| **D17** | A knockout is whatever the frozen document says (`result.tie_break = super_over`): a cup is its own competition, a final inside a league is a per-fixture override. No flag on `match` or `competition` | **Yes.** It already exists (parent D9), and a stage grain can take it over later without a schema change here |

**Assumptions (A)**, each to be confirmed: the standard super-over conditions as stated in §3.2 are the ICC's current ones from memory; a concession is a win and a loss for points; the decision capability is `competition.manage` / `fixture.update`; a school cup with an unfinished super over is decided by its organiser; the 4th-Edition clause numbers for Law 16.

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `describeResult()`, `deriveMatch()`, `MatchFold`, `inningsOverReason()`, `sealRefusal()`, `penaltyCredits()` | `packages/scoring/src/replay.mjs` | the result rule; the pairs; the two-wicket end; the scoped credits |
| `KIND`, `inningsStart()`, `inningsEnd()`, `toRow()`/`fromRow()`, `captureProfile`'s omitted-key rule, `DERIVED_END_REASONS` | `packages/scoring/src/events.mjs` | the marker on the wire |
| `lawsRefusal()`, `REFUSAL`, `REFUSAL_TEXT`, `ballRefusal()`'s `MATCH_DECIDED`, `PREVIOUS_INNINGS_OPEN`, `LATER_INNINGS_STARTED` | `packages/scoring/src/laws.mjs` | the new refusals and the redefined one |
| `conditionsOf()`, `oversPerInnings()`, `CONDITION["result.tie_break"]`, `CONDITION["result.min_overs_per_side"]`, `format.innings_per_side` | `packages/scoring/src/conditions.mjs` | the keys read; no new key |
| `match_playing_conditions()`, `match_conditions.doc`, `match_condition_override`, `play_overs()` | `db/61` | the frozen document the pad and `match_result()` read |
| `innings_score_as_folded()`, `match_live_score`, `ball_event_live`, `innings_declared_profile` | `db/45`, `db/48`, `db/31` | the SQL figures; the derived-from-innings_start pattern |
| the career readers and `summary_*_line` | `db/64` (§9.3 of SCRBRD-120) | the exclusion list |
| `bowler_over`, `bowler_spell`, `bowling_breach_watch()`, `load_day` | `db/08`, `db/62`, SCRBRD-110 | what keeps counting |
| `scoring_amendment_decide()`, quarantine release, `match.status` and the completion gate | `db/38`, `db/33` | the correction paths and the gate |
| `pairings()` `winnerOf`, `toFixtureDrafts()` `awaiting_winner`, `POST /api/fixtures`, the fixture amend route | `packages/scoring/src/planner.mjs`, `services/api/write/` | progression |
| `competition_publication`, db/59's public reads, `public_match_log` | `db/47`, `db/59`, `db/63` | the public page |
| `competition.manage`, `competition.read`, `fixture.update`, `ADDED_SINCE_01` | `db/01`, `packages/policy/src/roles.mjs` | who decides, who reads |
