# SCRBRD-120 — The scorebook importer: the design

**Status:** for Kameel's review, 2026-09-30. Nothing here is built. Every figure that is not already in the repository is an **assumption to be confirmed** and is marked as one.
**Source:** `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`, SCRBRD-120; the reviewer's verdict at the end of `audit/HARVEST_scrbrd_2026-09-30.md`; the earlier build's importer (`/home/user/scrbrd/apps/product/components/scrbrd/scorecard-importer.tsx`, `lib/server/scorecard-imports.ts`, `lib/server/scorecard-ocr.ts`, `lib/scorecard-import.ts`), read as a pattern and not as a model.
**Reader:** the product owner and information officer first, then whoever builds it. Plain words open each section; the schema and the functions follow. A builder reads §1–§7 and builds §8; §9 is the decision record.

---

## 0 · What this is, in one page

A scorer photographs the pages of a paper scorebook. The platform stores the photos privately, reads them (later; see §6) into a **summary scorecard per innings** with a confidence on every cell, a person checks and corrects every cell beside the photo, a **second** person confirms, and the confirmed card becomes three events in the match's log. From then on the match is an ordinary match: careers, the workload record, the standings and the public scorecard all read it through the same fold and the same SQL as a match scored on the pad. Nothing about the importer is a second source of truth.

The shape, in three sentences:

1. **The reader produces a summary, never deliveries.** A paper book supports batting and bowling figures, extras, the total and the fall of wickets with confidence; it does not support who faced which ball. So the checked card is stored as **one new event kind, `innings_summary`**, bracketed by the existing `innings_start` and `innings_end`, every event marked with its source (the import's id, who checked, who confirmed), and the fold, the Laws check and every SQL reader learn that one kind. No ball is ever fabricated.
2. **An innings is live-scored or imported, never both.** A summary is refused for an innings with a delivery in the live log, a delivery is refused for a summarised innings, and a second summary is refused; the correction path is the amendment (a `void` of the summary, then a new import), as for any other event. The match's playing conditions are fixed at the commit under the version in force on the match's start day (SCRBRD-114 §3.2 already anticipates "a fixture scored from the book a week late"), and the commit completes the match (db/33).
3. **Two people, and the photos are evidence with a clock on them.** The person who reads and edits the cells cannot be the person who confirms; the confirmer may return the card with a note but may not edit it. The photos carry children's names and handwriting: they are stored privately, stripped of metadata, readable only by the two roles above at the school, every read logged in `access_log`, and **deleted thirty days after confirmation** (assumption, §5.3). Nothing about an import is ever public beyond what the public scorecard already shows of a live match, and a name a scorer typed is never public (PUBLIC_DATA C2, N-rules).

What is out: ball-by-ball reconstruction from a bowling analysis; wagon wheels, worms, phases, matchups' dot-ball figures and spell breaches for an imported innings (none of these exist without deliveries, and the design makes sure no reader pretends otherwise); a photo feature of any other kind (STEP4 Q12 stands); creating `player` rows for opposition children.

---

## 1 · What the reader produces

### 1.1 Plain words

The school scorebook in use across the pilot (assumption: the standard club/school book with a batting section, a bowling analysis by over, an extras line, a cumulative run tally and a fall-of-wickets line) records, per innings:

- **per batter**, in order: name, how out (with fielder and bowler), runs, and — in a well-kept book — balls faced, fours and sixes;
- **per bowler**: the over-by-over symbols, and the totals overs, maidens, runs, wickets, wides, no-balls;
- **extras** by kind (byes, leg byes, wides, no-balls, penalties), the **total**, **wickets**, **overs**, and the **fall of wickets** (score, wicket number, batter, sometimes the over).

What a book does *not* reliably record is which batter faced each ball of each over: the bowling analysis has the sequence of an over, the batting section has each batter's runs, and matching the two is a puzzle that is solvable for a tidy 1st XI book and hopeless for a lower side's. A ball-by-ball reconstruction would be a guess written into the source of truth, and everything downstream (partnerships by balls, strike rotation, wagon wheels, `bowler_spell`) would read the guess as fact.

**Recommendation: a summary scorecard per innings.** It is what the book supports, it is what careers, tables and the workload record need, and it is honest about what it does not know. Ball-by-ball is not a later phase of this design; if a league ever needs it, it is its own design.

### 1.2 The card: `ScorebookCard` v1

One card per innings. Every figure is `null` when the book does not give it; nothing is ever filled with zero on the reader's or the screen's initiative (the earlier build's rule, kept).

```
ScorebookCard {
  v: 1,
  innings: 0..3,                         -- 0-based, as the log's `innings`
  battingSide: "home" | "away",
  batting: [{ order, ref, howOut, fielderRef, bowlerRef, runs, balls, fours, sixes }],   -- ≤ 15 rows
  didNotBat: [ref],
  bowling: [{ ref, overs: "17.3", maidens, runs, wickets, wides, noBalls }],              -- ≤ 15 rows
  extras: { byes, legByes, wides, noBalls, penalty },
  total, wickets, overs: "47.3",
  fallOfWickets: [{ wicket, score, ref, over }],
  endReason: "all_out" | "overs" | "declared" | "target" | "time" | "other",
  unreconciled: { runs: n, note } | null   -- §2.5, if Kameel allows it (D4)
}
```

A `ref` is either a `player.id` (one of the importing school's own players, chosen by a person from the roster; never by the reader) or a typed key `t:<n>` whose name lives in the card's `typed` map (§4.4). `howOut` is the vocabulary `normaliseDismissal()` already accepts (`events.mjs` `DISMISSAL`), plus `not_out`, `retired_hurt` and `retired_out`.

---

## 2 · How a checked import becomes the match's record

### 2.1 Plain words

The log is append-only and every reader folds it (`events.mjs` header, `db/02`). An import must therefore *be* events, and the only honest event for a summary is a new kind that says "this innings is known by its figures, not its deliveries". The alternative the brief offers — events of existing kinds marked with their source — cannot express a summary without fabricating `ball` rows, so it is rejected. The new kind is wrapped in the two existing ones the fold already needs to open and close an innings, so readiness, the seal check, result words and completion all work unchanged.

### 2.2 The three events per innings

Written by `scorebook_import_commit()` (§4.3), inside the per-match lock, with the provenance the amendment path set as precedent (db/38: not a scoring device, authored by the requester, approved by the caller):

| column | `innings_start` | `innings_summary` (new) | `innings_end` |
|---|---|---|---|
| `kind` | `innings_start` | `innings_summary` | `innings_end` |
| `idempotency_key` | `scorebook:<import>:<innings>:start` | `scorebook:<import>:<innings>:summary` | `scorebook:<import>:<innings>:end` |
| `scorer_user_id` | the submitter (who checked the cells) | same | same |
| `device_id` | `scorebook:<import>` | same | same |
| `epoch` | `coalesce(max(epoch), 1)` for the match, as db/38 | same | same |
| `client_ts` / `client_seq` | commit time / the seq, as db/38 | same | same |
| `payload` | the pad's own shape (`inningsStart()`): `battingTeam`, `bowlingTeam`, `teamKey`, `bowlingTeamKey`, `squad`, `bowlingSquad` (ids for our side, `t:<n>` keys for typed players), `overs`, `target`; **no `captureProfile`** (never declared: nothing was captured) | the card (§1.2) plus `typed` (§4.4) | `reason` from the card's `endReason`; `confirmed = {runs: total, wickets, balls}` from the card, so `sealRefusal()` passes against the summary's own figures |
| `payload.source` (all three) | `{"kind":"scorebook","import":<uuid>,"checkedBy":<uuid>,"confirmedBy":<uuid>}` | | |

`ball_event`'s kind vocabulary (the CHECK and `ball_event_names_its_delivery()`, db/43) gains `innings_summary`; a row of that kind has no `ball_type`, no `value` and no id columns, exactly as `innings_start` has none. `toRow()` / `fromRow()` in `events.mjs` learn the kind; a constructor `inningsSummary(card)` is the only place its shape is made.

### 2.3 The fold, the Laws check and the seal

**`replay.mjs`.** On `innings_summary`, `inningsFolder` sets the innings' aggregates from the card — `runs = total`, `wickets`, `balls` (from `overs`, base six), `extras`, `batters[]` (runs, balls, fours, sixes, status, the dismissal line built by the same `DISMISSAL_LABEL` words the pad uses), `bowlers[]` (runs, balls from overs, wickets, wides, noBalls, maidens as given: `computeMaidens()` has nothing to count), `fallOfWickets` — and marks `inn.summarised = {import, checkedBy, confirmedBy}`. The ball log stays empty, `partnerships` stays empty (the fall of wickets gives runs per stand but not balls or who; phase 1 shows the fall of wickets and no partnership table), `declaredProfile` stays null. `inningsOverReason()` then derives `all_out` / `overs` from the same figures it reads on a live innings, and `sealRefusal()` compares the `innings_end`'s `confirmed` against them: a card whose `endReason` disagrees with the figures (say "all out" with 7 wickets) is refused at the seal with `NOT_THE_LAWS_REASON`, which is the correct answer.

**`laws.mjs`.** `lawsRefusal()` gains three rules, each with a `REFUSAL` reason and words:

| rule | reason |
|---|---|
| `innings_summary` in an innings that has a delivery, a `batters`, a `bowler`, a `penalty` or a `retire` that still counts | `LIVE_INNINGS` — "this innings was scored live; a book cannot replace it" |
| a `ball`, `batters`, `bowler`, `penalty`, `retire` or `bowler_suspended` in a summarised innings | `SUMMARISED_INNINGS` |
| a second `innings_summary` in one innings | `ALREADY_SUMMARISED` |

The existing rules still apply: an innings starts only when the one before ended, no play once a later innings has a delivery, no ball once the match is decided.

**`summary.mjs` (new, `packages/scoring/src/`).** `summaryRefusal(card)` is the arithmetic, one function run by the review screen as the person types and by the commit route before the events are written: batting runs + extras = total (or the difference is declared, §2.5); dismissals in the batting rows = wickets; each bowler's wickets = the rows crediting him (`chargedToBowler()`); the sum of bowlers' runs + byes + leg byes + penalties to the batting side = total; legal balls from the bowlers' overs = legal balls from the innings' overs; the fall of wickets is ascending and its count = wickets; fours × 4 + sixes × 6 ≤ runs per batter; every `ref` in a dismissal, a fielder or the fall of wickets names a row. Refusals are per cell, named for the screen.

### 2.4 SQL agrees with the fold

The parity rule (`docs/SCORING_RULES.md`, db/40–db/54) is that every SQL reader of `ball_event` produces the fold's figures. Today every reader aggregates `kind = 'ball'` rows of `ball_event_live`; an imported innings has none, so each reader must gain one branch or it silently reports zero for a match the fold reports in full. The branch is the same everywhere and comes from two views, `security_invoker` like `bowler_over`:

```
summary_batting_line (match_id, school_id, innings, ref, player_id, order_no, runs, balls, fours, sixes,
                      how_out, bowler_ref, fielder_ref, is_dismissal, is_bowlers)    -- one row per batting row
summary_bowling_line (match_id, school_id, innings, ref, player_id, overs_text, legal_balls, wides, no_balls,
                      deliveries, maidens, runs, wickets, bowled_on)                    -- one row per bowling row
```

Both are `jsonb_to_recordset` over `ball_event_live WHERE kind = 'innings_summary'` (so a voided summary vanishes from SQL as it does from the fold), with `player_id = public_ref_uuid(ref)` (db/59: a uuid, or NULL for a typed key). Which readers gain the branch, and in which phase, is in §8. In phase 1 only the two the commit and the handover rely on: `innings_score_as_folded()` and `match_live_score` (runs, wickets, balls of a summarised innings from the summary event, not from balls). The `doc_hash` parity with `match_conditions` is unchanged: the fold is told the frozen document as for any match.

**Proved the way db/54 and db/61 are:** a db/99 section commits a fixed card and compares `innings_score_as_folded()` with `deriveInnings()`'s answer serialised by `tools/smoke-fold-figures.mjs`; phase 2 extends the list to careers.

### 2.5 When the book does not add up

Real books disagree with themselves. The umpires' agreed total at the close is the innings' total (Law 4th ed., the scorers' agreed figures); the batting rows are what they are. Two choices, for Kameel (**D4**):

- **Refuse until reconciled.** The reviewer must change a figure until the card adds up. Honest about the log, dishonest about the book: the figure changed is a guess.
- **Allow, and record the difference.** The card carries `unreconciled = {runs, note}`, the total stands, the rows stand, the scorecard shows a footnote ("the book's batting figures differ from its total by 3"), and careers take the rows. The event is the record of what the book said.

**Recommended: allow and record**, with the confirmer's explicit acknowledgement (a tick on the confirm screen, kept in the audit). It is the same choice `bowling_breach` makes: record what happened and say so.

### 2.6 Conflict with a live-scored innings

**Refuse, at the innings level** (§2.3's `LIVE_INNINGS`), never keep both: two records of one innings is the exact thing the log exists to make impossible, and "flagged" is a state no reader honours. The cases:

- *The other innings was live-scored* (the pad died at tea; the second innings went to paper): the import fills the second innings only; the first stays as scored. Allowed, and the common case.
- *This innings was partly live-scored, then paper:* the person completes it on the pad from the book (the pad records what the book says), or files an amendment voiding the partial innings' events and then imports. The importer does not do either for them; the review screen says which innings already have deliveries before any cell is typed.
- *A completed live match, imported again:* refused (`LIVE_INNINGS` on every innings; also `db/33`'s completion gate on nothing — the import path has its own gate, §4.3).
- *A wrong import:* `scoring.amend.request` names the summary's key; `scoring_amendment_decide()` (db/38) appends the `void`; a new import is then allowed for that innings (`ALREADY_SUMMARISED` reads the live log, which no longer has one).

### 2.7 What a summary feeds, and what it must not

| reader | imported innings |
|---|---|
| careers (`player_innings`, `player_batting_career`, `player_bowling_career`, `player_dismissals`, `*_by_season`, `player_batting_since`, `player_bowling_since`) | **yes**, from the two views; balls, fours, sixes only where the card gives them (`null` stays null; strike rate shows an em dash below `evidence_label()`'s floor as today) |
| the innings score, the result, the standings (`innings_score_as_folded()`, `match_live_score`, SCRBRD-114's `match_result()` and `competition_standing`) | **yes** |
| the workload record (`load_day`) | **yes**, §3 |
| the opposition dossier (`opposition_squad()`) | runs, balls, dismissals, wickets, runs conceded — **yes**; `dots` and `dot_pct` **never** (no deliveries): the summary branch contributes 0 dots and the evidence label says why |
| the public scorecard (db/59) | **yes**, with "from the scorebook" and no over-by-over; `public_match_log` serves the summary event with `typed` removed (§4.4) |
| wagon wheels, `public_shot_sectors`, phases, matchups, the worm, partnerships by balls, `bowler_spell`, spell breaches, `milestone_watch()`, DRS, the live board | **never**; each already reads `kind = 'ball'` and gains no branch. db/99 proves a summarised innings appears in none of them |

---

## 3 · The workload record

### 3.1 Plain words

SCRBRD-110 §1.3 gives a coach `match_elsewhere` for the game scored on paper, with the scorebook's exact count, and marks a day where the boy also has `bowler_over` rows as *possibly counted twice*. Once the book is imported the platform holds the exact figure and the estimate is redundant; the estimate must be retired, not doubled, and not silently.

### 3.2 The rule

- `load_day`'s `match_units` (`db/60`) gains a second branch in its UNION beside `bowler_over`: `summary_bowling_line.deliveries` per `player_id`, `bowled_on`. An imported innings' bowling therefore counts exactly as a live one's, in deliveries (legal balls + wides + no-balls), on the match's SAST date.
- **Retiring the estimate is a person's act, not the commit's.** The confirm screen lists, for every bowler in the card who has a `match_elsewhere` entry on the match's date at this school, that entry ("Mr Dlamini logged 42 balls elsewhere on 14 Sep for T. Ngcobo"), and the confirmer ticks the ones this book *is*. Two matches in one day at a festival is real, so nothing is retired automatically. Each tick writes, in the commit's transaction, a **superseding `load_entry` row** (§1.3: "a correction is a new row that names the one it replaces") with `kind = 'match_elsewhere'`, `units` copied, `supersedes` the estimate, and a new column `resolved_match_id uuid REFERENCES match(id)`; `load_day` takes the last row of a chain as today and **excludes a chain whose last row names a match**, because the match's own deliveries now count. CHECK: `resolved_match_id` only with `kind = 'match_elsewhere'`.
- `possibly_doubled` stays true for an unticked estimate on an imported day, so the coach's screen still asks. It is never set by an import for the boys whose estimate was ticked.
- Written through `load_entry_resolve_match(entry, match)`, SECURITY DEFINER, called only by `scorebook_import_commit()`; `load_entry` keeps its REVOKE on UPDATE.
- **Spells and breaches.** `bowler_spell` and `bowling_breach_watch()` read `bowler_over`, which gains no branch: a summary has no over sequence, so no spell is known and no spell breach is written. The day limit (`bowling.limit.{band}.day`, SCRBRD-114 §4) *is* knowable from the card; whether `bowling_breach_watch()` writes a `day` breach from an imported innings is phase 3's question (§8), and until then the coach's day view shows the figure without a breach row. `workload()` reads `load_day` and so sees the imported day.

---

## 4 · Who may import, who confirms, and the audit

### 4.1 Capabilities and holders

Three capabilities, `ADDED_SINCE_01`, level 1 (they touch the log and a child's name in a photo, not a medical or disciplinary record):

| capability | what it allows | holders (recommendation; Opus confirms the role keys against `roles.mjs`) |
|---|---|---|
| `scoring.import.read` | open an import at its school for its team's fixture; see its pages and its card | whoever holds `scoring.import.write` or `.confirm` over the scope; `audit.read` holders see the card and the audit rows, **not the pages** |
| `scoring.import.write` | create an import, add pages, run the reader, edit cells, submit, abandon | the roles that hold `scoring.amend.request` today: `scorer`, `coach`, `assistantcoach`, `teammanager`, scoped as their assignments scope them (a scorer to a fixture) |
| `scoring.import.confirm` | confirm or return a submitted import; tick the workload estimates it replaces | the roles that hold `scoring.amend.approve` today (`competitionadmin`), plus the school's director of sport for a match in no competition. Never a role that holds `.write`, so the two-person rule is a rule of the role catalogue as it is for amendments (`capabilities.mjs` 152–158) |

The module is `scorebook_import` (`feature_flag`, kind `module`, off by default; the platform grants it per school as `workload_monitoring` is), and the write route refuses where it is off.

### 4.2 Separation of duties

- `scorebook_import_confirm()` refuses `cannot_confirm_your_own` when the caller is the import's `submitted_by` **or appears as the author of any revision** of it (a person who typed a cell cannot confirm the card that contains it).
- The confirmer cannot edit. If a cell is wrong she returns the import (`state = 'returned'`, with a note); the submitter edits and resubmits, and the revision chain shows both.
- A support session (`db/22`) may neither write, confirm, nor read a page: a RESTRICTIVE cut as db/57's.
- The pad's resume credential answers for nobody here (`app_pad_scoped()` guards, as db/60 does).

### 4.3 The tables and the state machine

```
scorebook_import (
  id            uuid PK, school_id uuid NOT NULL → school, match_id uuid NOT NULL → match,
  team_code     text NOT NULL,                       -- match_team(match_id), stamped by trigger
  state         text NOT NULL CHECK (state IN ('draft','reading','review','submitted','returned','confirmed','abandoned')),
  card          jsonb NOT NULL DEFAULT '[]',         -- ScorebookCard[] — one per innings in this import
  typed         jsonb NOT NULL DEFAULT '{}',         -- t:<n> → name, §4.4
  read_by       jsonb,                               -- {provider, model, at, pageHashes[]}: the processing record (POPIA s17), §6
  created_by    uuid NOT NULL → app_user, created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by  uuid → app_user, submitted_at timestamptz,
  confirmed_by  uuid → app_user, confirmed_at timestamptz, confirm_note text,
  returned_note text, abandoned_at timestamptz,
  applied_keys  text[],                              -- the idempotency keys the commit wrote (approved_rows_name_their_event, db/02)
  pages_purged_at timestamptz,
  CONSTRAINT confirmed_rows_name_their_events CHECK (state <> 'confirmed' OR applied_keys IS NOT NULL),
  CONSTRAINT two_people CHECK (confirmed_by IS NULL OR confirmed_by <> submitted_by)
)
scorebook_import_page (
  id uuid PK, import_id uuid NOT NULL → scorebook_import ON DELETE CASCADE, school_id uuid NOT NULL,
  page_no smallint NOT NULL, object_key text NOT NULL,   -- the store's key, §5
  sha256 text NOT NULL, bytes integer NOT NULL, width int, height int,
  added_by uuid NOT NULL → app_user, added_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,                             -- the row outlives the object: "there was a page" is audit
  UNIQUE (import_id, page_no), UNIQUE (import_id, sha256)
)
scorebook_import_revision (
  id uuid PK, import_id uuid NOT NULL, school_id uuid NOT NULL, version integer NOT NULL,
  card jsonb NOT NULL, typed jsonb NOT NULL, checked jsonb NOT NULL,   -- checked: cell path → true, the per-cell tick (§6.3)
  action text NOT NULL CHECK (action IN ('create','pages','read','save','submit','return','confirm','abandon')),
  actor_id uuid NOT NULL → app_user, at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, version)
)
```

RLS through `tables.mjs` (`TABLES_ADDED_SINCE_09`): read under `scoring.import.read` at `(school_id, team_code, NULL, match_id)`; no direct INSERT/UPDATE for the application; every transition is a SECURITY DEFINER function that decides WHO and writes a revision:

| function | who | does |
|---|---|---|
| `scorebook_import_open(match)` | `.write` over the match; the module on; the match not `complete`; no open import for the match | `draft` |
| `scorebook_import_page_add(import, key, sha256, …)` | `.write`; state `draft`/`review`/`returned`; ≤ 12 pages (assumption) | page row; state `draft` |
| `scorebook_import_read_start(import)` / `_read_done(import, card, typed, provider, model)` | `.write`; the module `scorebook_reader` on (§6) | `reading` → `review`, `read_by` written, a `read` revision |
| `scorebook_import_save(import, card, typed, checked, version)` | `.write`; state `review`/`returned`; optimistic on `version` | a `save` revision |
| `scorebook_import_submit(import, version)` | `.write`; every cell ticked; `summaryRefusal()` clean (checked in the route, and the arithmetic re-checked in SQL by a small `summary_reconciles(card)` so no client can skip it) | `submitted` |
| `scorebook_import_return(import, note)` | `.confirm`; not own | `returned` |
| `scorebook_import_commit(import, resolve_entries uuid[], acknowledge_unreconciled boolean)` | `.confirm`; not own; the match not `complete`; the lock | §2.2's events, `match.status = 'complete'`, the workload rows (§3.2), `confirmed`, `applied_keys` |
| `scorebook_import_abandon(import)` | `.write` (the submitter) or `.confirm` | `abandoned`; pages purged (§5.3) |

**The commit, in the amendment route's shape** (`services/api/write/events-api.mjs` `amendmentRoutes`, db/38): the route opens a transaction and a savepoint; `scorebook_import_commit()` decides WHO, takes the live path's lock (the `scoring_session` row FOR UPDATE where one exists, then `match_conditions_lock()`), calls `match_conditions_fix()` (SCRBRD-114 §3.3, so the document is fixed before the first event under the start day's version), reads `max(seq)`, and writes the events; the route then folds the match's log through `MatchFold` with the new events, asks `lawsRefusal()` about each and `summaryRefusal()` about each card, and rolls back to the savepoint with the reason in words if any is refused. Under the lock, the log it judges is the log the events land on. SQL cannot run the Laws; the route can; the pair is one transaction. Then `scoring_audit` gets a row (`event = 'scorebook_import'`, `detail = {import, innings[], keys[]}`), and `match.status` becomes `complete` — after which `scoring_claim()` refuses (`db/33`), which is what makes "imported" and "live" exclusive at the match level too.

### 4.4 Names: our players and the opposition

- **Our side:** a person chooses each row's player from the roster of the match's team plus the school's other players (a boy playing up), through the same read the pad's squad sheet uses. The reader never assigns an id (the earlier build's rule, kept: "a model must never assign authority or link identities"). A row left unmatched cannot be submitted.
- **The opposition, not on the platform:** the name is typed, stored as `t:<n>` in the card and its spelling in `typed`. It goes into the event payload's `typed` map exactly as the pad's typed `striker` / `bowler` text does today (`db/59` §2 "a player the scorer typed"), and **nowhere else**: no `player` row, no roster, no dossier entry. `public_match_log` serves the summary event with `typed` removed and every `t:<n>` rendered as its position ("Batter 3", "Bowler"), which is the C2 rule applied to a typed name; `public_match_people` returns `player` rows only, as now.
- **The opposition, a tenant** (`match.away_school_id` set): phase 1 still types them, because the importing school cannot read another tenant's roster outside the five-day window (db/46). A later phase lets the away school's confirmer *claim* typed rows to its own players by a function that rewrites nothing in the log and records the mapping beside it (`scorebook_row_claim`, deferred; **D6**).

### 4.5 Audit

`scorebook_import_revision` holds every card as it stood, who and when; `scoring_audit` holds the commit; `access_log` holds every page read (`resource = 'scorebook_page'`, `record_ids = {import}`, `fields = {page:<n>}`) so a parent's "who looked at the photo with my son's name on it" has an answer. The three events carry `payload.source` forever; the amendment path is the only way to undo them.

---

## 5 · The photos

### 5.1 Plain words

A page carries the names of twenty-two children, their handwriting, sometimes an umpire's, and — in the file's metadata — the phone's location and identity. It is personal information of children from two schools, one of which is not a tenant and has consented to nothing. It is needed for exactly one thing: a person checking figures. So it is held for that, seen by those people, and then deleted.

### 5.2 Where, and who sees them

- **Store:** a private object store in the same region and under the same operator as the database — for the pilot, a Supabase Storage bucket `scorebook-pages` (assumption: the platform's Supabase project; Opus confirms the residency of the project's storage matches the database's before the first page is stored). No public access; no signed URL longer than sixty seconds; the API proxies or signs on every read after `scoring.import.read` over the import passes and the `access_log` row is written. SCRBRD_OS has no object storage today (`services/api/io` is CSV); this is the first, and it is one adapter (`services/api/io/object-store.mjs`) so the store can move.
- **Before storing:** the API re-encodes every page (JPEG or PNG in, JPEG out, longest edge 2400 px — assumption), which drops EXIF, GPS and the device identity; only the derived image is stored; the original bytes are not. ≤ 8 MB in per page, ≤ 12 pages per import (assumptions).
- **Who:** holders of `scoring.import.read` over the import's school, team and match — in practice the submitter and the confirmer. Not `audit.read` (they get the card and the revisions), not a parent, not a pupil, not the opposition's tenant, not a support session, not a pad credential, never the public. RLS on `scorebook_import_page` says so; the API's read route asks the same predicate; db/99 proves each zero.

### 5.3 How long

| state | pages deleted |
|---|---|
| `confirmed` | **thirty days after `confirmed_at`** (assumption; **D7**): long enough for a returned scorecard to be disputed and the amendment path used, short enough that the platform does not become an archive of other schools' children |
| `abandoned` | at once |
| `draft` / `review` / `returned` untouched | thirty days after the last revision, then the import is abandoned and the pages deleted |
| `submitted` awaiting a confirmer | not deleted; the confirmer's inbox shows the age |

`scorebook_import_purge_due()` runs daily (the same scheduler as `health_retention_due()`'s purge when that lands; until then a route the platform's key calls), deletes the objects, sets `deleted_at` on the page rows and `pages_purged_at` on the import, and keeps the rows: "there were four pages, read by these two people, deleted on this day" is the audit. The card and the events stay: they are the match's record, and they carry no more than a live match's log does.

### 5.4 The third-party reader: the processor question

Sending a page to a hosted vision model is **processing by an operator** (POPIA s20–21: a written contract, confidentiality, security measures) and, where the provider's servers are outside South Africa, a **cross-border transfer** (s72: adequate protection by law or binding agreement, or consent, or necessity for the contract). The pages are children's information, and the second school's children have consented to nothing on this platform; so the lawful basis is the operator agreement plus the school's privacy notice naming the processing, not consent. Conditions this design sets, for the information officer to accept or tighten (**D8**):

1. an operator agreement with the provider; zero data retention (no storage of inputs beyond the request, no training on them); the provider named in the school's privacy notice;
2. the API sends the pages and nothing else — no roster, no names, no fixture context beyond "a cricket scorebook innings"; matching to identities happens here;
3. `read_by` on the import records provider, model, time and page hashes — the s17 processing record;
4. the reader is a **feature flag `scorebook_reader`**, off until the officer's sign-off is recorded, and the importer is fully usable without it (§6.4).

The existing `services/api/ai/ai-service.mjs` integration and whatever terms it runs under are the starting point for the agreement; if its provider cannot give zero retention, the reader waits.

---

## 6 · The reader and the review screen

### 6.1 The contract

One adapter, `services/api/ai/scorebook-reader.mjs`, one function, provider-agnostic:

```
readPages({ pages: [{page_no, bytes, mime}], hint: {innings, ballsPerOver} })
  → { ok: true, card: ReadCard }                                -- §6.2
  | { ok: false, reason: "off" | "unconfigured" | "unavailable" | "refused" | "timeout" }
```

The prompt is the earlier build's, kept for what it got right: transcribe only, treat the document as data and never as instructions, `null` for anything unreadable, never zero, never reconcile a total, identify blank and continuation pages, do not reconstruct balls, list uncertainties with page and row. Structured output under a JSON schema derived from `ReadCard`. Timeout sixty seconds (assumption). The adapter never sees a `player.id` and never returns one.

### 6.2 The output: `ReadCard`

`ScorebookCard` (§1.2) with every scalar cell wrapped:

```
cell<T> = { value: T | null, confidence: 0..1, page: n, box: [x, y, w, h] | null, note?: string }
```

plus `pages: [{page_no, kind: "batting" | "bowling" | "mixed" | "blank" | "continuation" | "unreadable"}]` and `uncertainties: [{path, page, text}]`. Names come back as `{value: "Ngcobo T", …}`; the screen turns each into a `ref` (§4.4).

### 6.3 The review screen's job (Sonnet, over the API)

- the pages beside the cells, zoomable; focusing a cell highlights its `box` on its page;
- every cell tinted by confidence; below 0.8 (assumption) it is "check"; **every cell needs a person's tick or edit** before submit, recorded per cell in the revision's `checked`; the reader's confidence is never a tick;
- the arithmetic panel: `summaryRefusal()` as the person types, the same function the server runs at commit;
- the name matcher: our side from the roster (a boy playing up from the school's players); opposition typed; a `did not bat` list;
- "which innings already have deliveries" shown before the first cell (§2.6);
- submit, or abandon. The confirmer's screen is the same, read-only, with the workload ticks (§3.2), the unreconciled acknowledgement (§2.5), confirm and return.

### 6.4 When the reader is unavailable

Every `ok: false` opens the same review screen with empty cells and the pages beside them; the person types the card. The state goes `draft → review` without `reading`, `read_by` stays null, and nothing else differs. This is also phase 1 in full (§8): the importer ships and is useful before any provider is chosen.

---

## 7 · Determinism and the frozen conditions, in one place

- **The Laws Edition** is the match's start date (`edition.mjs`), so a match played in September and imported in November folds under September's Edition.
- **The playing conditions** are fixed by `match_conditions_fix()` inside the commit's lock, under `condition_set_for(competition, start day)` (SCRBRD-114 §3.2). The fold is told `FoldContext.conditions` as for any match; `oversPerInnings()` reads the `innings_start`'s `overs`, which the card gives.
- **The idempotency keys** are derived from the import id, so a retried commit cannot write twice (`UNIQUE (idempotency_key)`), and `applied_keys` on the import names what was written.
- **A re-fold anywhere** — the public page in the browser, the Match Centre, a handover that can no longer happen because the match is complete — produces the same innings from the same three events, because the summary is the only input.

---

## 8 · Phasing

One migration per phase, its proof in `db/99`, a smoke walk, and the shipped-file rules of `DEPLOYING.md` (db/01 and db/09 never change; a shipped file never changes; each phase's policies are emitted into its own file). Numbers assume db/62 is SCRBRD-114's phase 2 and nothing else lands first; db/99 sections continue from the last (db/61 is §39; **assumption** db/62 takes §40).

| phase | migration | tier | ships | proves (db/99 and a smoke walk) |
|---|---|---|---|---|
| **1 · The record, by hand** | `db/63` (§41) | **Opus** (schema, RLS, the event kind, the fold, `laws.mjs`, `summary.mjs`, the commit route, the object store, the purge, privacy); **Sonnet** (the three screens over the API) | `scorebook_import`, `_page`, `_revision` and their policies; the three capabilities (`ADDED_SINCE_01`) and the module flag; the state functions of §4.3 without the two `_read_*`; `innings_summary` in the kind vocabulary, `toRow`/`fromRow`, `inningsSummary()`, the fold (§2.3), the three Laws rules, `summaryRefusal()` and `summary_reconciles()`; `scorebook_import_commit()` and `services/api/write/scorebook-api.mjs` in the amendment route's shape; `innings_score_as_folded()` and `match_live_score` reading a summary; `public_match_log` serving it without `typed`; `object-store.mjs`, re-encoding, `access_log` on page reads, `scorebook_import_purge_due()`; the upload, review and confirm screens | a submitter cannot confirm; a revision author cannot confirm; the confirmer cannot save; another school's import, a parent, the pupil, a support session and a pad credential see no import and no page; a page read writes `access_log`; the commit writes exactly three events per innings with the derived keys, and a second commit is refused by the key; a summary for an innings with a live ball is refused with `LIVE_INNINGS` and a ball after a summary with `SUMMARISED_INNINGS`; a card whose reason disagrees with its figures is refused at the seal; a card that does not reconcile is refused unless acknowledged (D4); the fold and `innings_score_as_folded()` give the same runs, wickets, balls; `match_conditions` is fixed at the commit under the start day's version and a later publish does not touch it; the match is `complete` after and `scoring_claim()` refuses; an approved amendment voiding the summary lets a new import through; the purge deletes the objects after the window and keeps the rows; the public log carries no `typed` key and no typed name; a summarised innings appears in no `public_shot_sectors`, no `milestone_watch` notice, no `bowler_spell`. Walks: `smoke-scorebook` (API) and `smoke-browser-scorebook` (upload two pages, type a card, submit as the scorer, confirm as the director of sport, see the scorecard say "from the scorebook") |
| **2 · Careers and tables** | `db/64` (§42) | **Opus** | `summary_batting_line`, `summary_bowling_line`; the UNION branch in `player_innings`, `player_batting_career`, `player_bowling_career`, `player_dismissals`, `player_dismissal_breakdown`, the `*_by_season` views, `player_batting_since`, `player_bowling_since`, `opposition_squad()` (no dots); `match_result()` if SCRBRD-114 phase 3 has landed (else a note there) | a boy's career after an import equals the fold's line for him, balls and boundaries null where the card had none; the season view places the match by its start day; the opposition dossier shows his runs and no dot percentage; voiding the summary removes him from every view; `tools/smoke-fold-figures.mjs` gains the summarised innings |
| **3 · The workload record** | `db/65` (§43) | **Opus** | `load_entry.resolved_match_id`, `load_entry_resolve_match()`, `load_day`'s second match branch and the exclusion, the confirm screen's ticks wired; `bowling_breach_watch()`'s day count reading the summary (or the decision that it does not) | an estimate ticked at confirm leaves the day's units equal to the card's deliveries; an unticked one stays and `possibly_doubled` stays true; a boy with two matches on one day keeps both; no spell breach is ever written from a summary; `workload()` shows the imported day |
| **4 · The reader** | `db/66` (§44): the `scorebook_reader` flag row and `read_by`'s policy; else application only | **Opus** (adapter, privacy record, the flag's gate); **Sonnet** (confidence tint, box highlight) | `scorebook-reader.mjs` behind the flag; `_read_start`/`_read_done`; the processing record; the screen's confidence and boxes | with the flag off the route says `off` and the screen is the manual one; with it on and the key missing, `unconfigured`, same screen; a read writes `read_by` with page hashes; a returned id in a name cell is dropped before the card is saved; the reader is never sent a roster (the request body is asserted in the adapter's test) |
| **5 · Later, if asked** | — | — | the away tenant claims typed rows (`scorebook_row_claim`); a school-level retention setting; the primary-school book (eight-ball overs: `hint.ballsPerOver` is already in the contract) | — |

Phase 1 must be first and is useful alone. Phases 2 and 3 are independent of each other. Phase 4 waits on D8 and on nothing else.

---

## 9 · Decisions for Kameel

Each with the recommendation the body assumes.

| # | decision | recommendation |
|---|---|---|
| **D1** | The reader produces a summary scorecard per innings, never ball by ball, and ball-by-ball is not a later phase | **Yes.** The book does not know who faced what; a guess in the log is the one thing this platform has never allowed |
| **D2** | One new event kind, `innings_summary`, between the existing `innings_start` and `innings_end`, marked with its source; the fold, the Laws check and every SQL reader learn it | **Yes.** Existing kinds cannot say "known by figures" without fabricating balls; three events keep readiness, the seal and completion unchanged |
| **D3** | An innings is live-scored or imported, never both: refuse, never keep both and flag; a partly live innings is finished on the pad or voided by amendment first | **Refuse.** Two records of one innings is what the log exists to prevent; the amendment path already exists for the fix |
| **D4** | A card whose batting figures do not add to its total: refuse until reconciled, or allow with the difference recorded on the event and shown as a footnote, acknowledged by the confirmer | **Allow and record.** The umpires' total stands, the rows stand, and nobody edits a figure to make a book lie less |
| **D5** | Two people, by the role catalogue: `.write` with the roles holding `scoring.amend.request`, `.confirm` with those holding `scoring.amend.approve` and the school's director of sport; a revision author can never confirm; the confirmer cannot edit, only return | **Yes.** It is the amendment split again, and the only shape where the audit says who read and who confirmed |
| **D6** | Opposition names are typed into the card and the event's `typed` map, never `player` rows, never public; an away tenant claims its rows in a later phase | **Yes.** It is what the pad does today, and a `player` row for another school's child is a record nobody consented to |
| **D7** | Pages deleted thirty days after confirmation, at once on abandonment, thirty days after the last touch of a stale draft; the rows and the audit kept | **Thirty days.** Long enough to dispute a scorecard; the alternative (season end) makes the platform an archive of other schools' children. The number is the information officer's |
| **D8** | The hosted reader is a third-party operator and, likely, a cross-border transfer: it ships only behind `scorebook_reader`, after an operator agreement with zero retention, a notice in the school's privacy notice and a processing record; the pages are sent alone, never a roster | **Yes, and phase 1 ships without it.** The importer is useful by hand; the reader is a convenience that needs the officer's signature, not the other way round |
| **D9** | The pages live in a private bucket in the database's region, re-encoded without metadata, readable only by the two roles at the school, each read logged | **Yes.** The first object store on the platform, one adapter, so it can move |
| **D10** | The commit completes the match (`db/33`), so live scoring can never follow an import; a wrong import is corrected by amendment and a new import | **Yes.** "Imported" and "live" are exclusive at the match as at the innings |
| **D11** | Retiring a coach's `match_elsewhere` estimate is the confirmer's tick per entry, never automatic, written as a superseding row naming the match | **Yes.** A festival has two matches a day; the log records what a person decided |
| **D12** | Balls faced, fours and sixes stay null where the book has none; careers count them only where recorded; nothing is zero-filled | **Yes.** SCRBRD-110's rule: nothing that was not recorded is counted |
| **D13** | The module `scorebook_import` is off by default and granted per school by the platform; the fixture must exist before an import (created through the fixture route as today) | **Yes.** No new bypass for creating a match; the pilot's schools are switched on by Kameel |

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `ball_event`, its append-only triggers, `UNIQUE (idempotency_key)`, `ball_event_live` | `db/02`, `db/43` | the three events; a voided summary vanishing everywhere |
| `scoring_amendment`, `scoring_amendment_decide()`, the amendment route's savepoint-then-Laws order | `db/02`, `db/38`, `services/api/write/events-api.mjs` | the commit's shape; the only way to undo an import |
| `KIND`, `inningsStart()`, `inningsEnd()`, `toRow()`/`fromRow()`, `DISMISSAL`, `normaliseDismissal()`, `chargedToBowler()` | `packages/scoring/src/events.mjs` | the new kind's shape and vocabulary |
| `deriveInnings()`, `inningsFolder`, `sealRefusal()`, `inningsOverReason()`, `FoldContext`, `rulesOf()`, `MatchFold` | `packages/scoring/src/replay.mjs` | folding a summary; the seal against its own figures |
| `lawsRefusal()`, `REFUSAL`, `REFUSAL_TEXT` | `packages/scoring/src/laws.mjs` | the three new rules |
| `innings_score_as_folded()`, `match_live_score`, `player_innings`, `player_*_career`, `*_by_season`, `player_batting_since`, `player_bowling_since`, `opposition_squad()`, `evidence_label()` | `db/45`, `db/48`, `db/54`, `db/40`, `db/43`, `db/44`, `db/49` | SQL parity, per phase |
| `match_conditions_fix()`, `match_conditions_lock()`, `condition_set_for()`, `match_playing_conditions()` | `db/61` | freezing at the commit |
| `match.status` and the completion gate | `db/00`, `db/33` | the match is complete after an import |
| `load_entry`, `supersedes`, `load_day`, `bowler_over`, `bowler_spell`, `workload()` | `db/60`, `db/08` | the workload record |
| `public_match_log()`, `public_ref_uuid()`, `public_match_people()`, `publicName()` | `db/59`, `packages/policy/src/public.mjs` | the public scorecard; typed names never public |
| `access_log` | `db/08` | every page read |
| `feature_flag`, `feature_grant` | `db/08` | `scorebook_import`, `scorebook_reader` |
| `app_can()`, `ADDED_SINCE_01`, `TABLES_ADDED_SINCE_09`, the RESTRICTIVE support cut, `app_pad_scoped()` | `db/01`, `packages/policy`, `db/57`, `db/60` | the capabilities and their policies |
| `services/api/io/import-api.mjs` (the CSV importer's rule: the caller's own principal, no bypass) | `services/api/io` | the importer's route follows it |
| `services/api/ai/ai-service.mjs` | `services/api/ai` | the reader adapter's neighbour and the operator agreement's starting point |
