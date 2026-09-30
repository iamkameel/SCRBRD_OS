# SCRBRD-130 — Rain: interruptions in the log, a DLS Standard Edition calculator, and venue par

**Status:** for Kameel's review, 2026-09-30. Nothing here is built. Design within Kameel's decisions of 2026-09-30: the rain rule is a playing condition (the MCC Laws have none); the DLS Standard Edition resource table is entered only from an official source Kameel supplies, with permission confirmed, never from memory; the Professional Edition is out of scope; **the umpires' announced figure is the record** — SCRBRD calculates and shows, the scorer records what the umpires announce, and a difference is kept and shown.
**Reader:** Kameel first; then Opus, who builds §2–§6 in the phases of §7; then Sonnet for the screens named there.
**Fits:** `SCRBRD-114_phase3_results_super_over.md` (D1–D17 decided). This design changes two of its rules by a clause each (§5: an abandoned chase with an announced par; NRR's deemed first-innings figures) and slots after 3a as phases R1–R3 (§7).
**Sources:** the DLS Standard Edition method as the ICC's playing conditions describe it, cited from memory as to *shape* only; **no resource-table value and no G50 value appears in this document, in code, in tests or in a migration.** Formulas use the symbolic `R(b, w)`. Everything school-specific is marked **A** (assumption) and listed in §8.

---

## 1 · A Saturday, in one page

Northwood are 87 for 3 after 12.3 overs of a 20-over first innings when the rain comes. The scorer taps **Play stopped** and picks *rain*. The pad shows a banner — *Play stopped (rain) at 12.3 ov, 87/3, 14:32* — and refuses a ball until play resumes; nothing else changes. Forty minutes later the umpires say the innings is cut to 16 overs. The scorer taps **Resume**, and the sheet asks one thing: *Overs now* (prefilled 20; he types 16). Play goes on; the innings ends after the 16th over at 121 for 6, and the board and the public page say *16 overs (revised from 20)*.

Between innings the umpires announce the chase: 16 overs, target 134. The scorer starts the chase's innings with those two figures, as today. Beside the target field the pad says *SCRBRD calculates 133 (DLS Standard, table v1, G50 from the league's conditions)* — or, if no table has been loaded, *No DLS table loaded; enter the umpires' target*. He records what the umpires said. The chase board reads **Target 134 from 16 overs (DLS)**, the required rate and *at this rate* read the revised figures, and under them a small line: *umpires 134 · calculated 133*. The difference is kept because the umpires' figure is the record and the calculation is a check on it, not the other way round.

If the rain returns during the chase at 9 overs, 71 for 4, and play cannot resume, the umpires announce the par score. The scorer taps **Play stopped**, then **End innings (rain)**, and the seal sheet asks *Par score announced by the umpires* (beside it, *SCRBRD calculates 74*). Kearsney on 71 against a par of 74: the result is **Northwood won by 3 runs (DLS)**. Had they been on 75, *Kearsney won by 6 wickets (DLS)*; on 74, *Match tied (DLS)*. The standings take the result as any other, and NRR reads the revised overs, as phase 3 defined it. The boys' careers move exactly as the balls say; rain changes no career figure.

The public page shows the log's own lines — *Rain stopped play, 12.3 ov (14:32)* · *Play resumed; innings reduced to 16 overs* · *Target 134 from 16 overs (DLS); calculated 133* — and the result words. Nothing is invented: every figure is either what happened, what the umpires announced, or a calculation labelled as one with the table version it used.

A coach opening Kearsney's ground page sees **Par at this ground: 128** — *the mean first-innings total in 20-over U15 matches here: 9 innings, 2024/25 to 2026/27, median 126, range 88–176* — or, at a new ground, *Not enough matches here yet (2 of 5)*. On the live board of any match at that ground, first innings or second, a line reads *A typical side here would be 61/3 by now* — venue par times the resources a side at this point has used, by the same table; with no table loaded, the proportion of overs bowled, labelled so. It is evidence from the ground's own record. It is not the invented absolute par `phases.mjs` refuses, and the phase card's "par = the other side in the same phase" stays exactly as it is.

---

## 2 · Interruptions in the log

### 2.1 Plain words

A rain break is three facts: play stopped at a point, play resumed, and what the umpires decided in between. The first two are events, positioned in the log after the last ball bowled, so the over, ball, runs and wickets at the stop are read from the log and never typed. The third is the **`revision` event the log already has** (the umpires' overs and target for an innings), which gains one optional figure: the announced **par** when an innings cannot resume. Nothing about DLS is written into the log: the calculation is a read (§3), reproducible forever from the log and the match's frozen conditions.

### 2.2 The events

| kind | payload | who | where in the log |
|---|---|---|---|
| `play_stopped` | `{innings, reason: rain \| bad_light \| wet_ground \| other, note?, at?}` | the scorer, one tap | inside an open innings, after the last ball bowled (or at 0.0 before the first) |
| `play_resumed` | `{innings, at?}` | the scorer, from the Resume sheet, **after** the sheet's `revision` if the figures changed | inside the same innings |
| `revision` (existing) | `{innings, overs?, target?}` + **`par?`** (int, the umpires' announced par score at a termination) | the scorer, from the Resume or End-innings sheet | as today: any time in an open innings |

`at` is an optional wall-clock time for the public log's words; the event's own `occurred_at` stands when it is absent. Keys are omitted, not null, as `captureProfile` and `superOver` are: nothing already scored changes by a byte. `toRow()`/`fromRow()` carry them; `ball_event_live` needs no new column for the stop itself, but `innings_score_as_folded()` (db/45) gains `stopped boolean` (a stop with no resumption yet) and `par int` (the last `revision.par` on the innings), from the same rows.

A delay **between innings** is not a stop: the chase's `innings_start` carries the reduced overs and the announced target as today. A delayed start is the same: the first `innings_start.overs` is what the umpires set. The calculator reads both (§3.3, cases 1 and 4).

An innings **cut short** (no resumption) ends with the existing `abandoned` seal, preceded by its `play_stopped` (whose `reason` gives the words: "innings closed — rain"). Reusing the seal reason costs no reader a branch; the meaning is read from the stop before it (D2). For the chase, `revision.par` before that seal is what turns "abandoned" into a result (§5.1).

### 2.3 How the fold reads them

`MatchFold` keeps, per innings, `inn.stopped` (`{over, ball, runs, wickets, reason, at} | null` while a stop is open) and `inn.interruptions[]` — one entry per stop, closed by a resumption or by the seal, each carrying the position at the stop, the allotment in force at the stop, and the allotment in force at the resumption (or `null`: terminated). Balls bowled do not move; the innings' overs move with `revision.overs` exactly as they do today (`oversPerInnings()` reads the `innings_start`'s figure, which a revision replaces). `inn.par` is the last `revision.par`. Nothing here computes a resource: the fold records positions and allotments, the calculator (§3) turns them into resources at read time, so the fold stays free of the table and SQL parity needs no table (§3.5).

Mid-over: a stop at 12.3 resumes at 12.4 with the same bowler and batters; the position is in balls, and the calculator's `R(b, w)` is in balls remaining. The Laws' consecutive-overs rule is unaffected (the over is the same over). If the umpires change the bowler after a long break, the scorer changes the bowler as for any injury (recorded, not refused).

### 2.4 Laws refusals

`lawsRefusal()` gains these, in `REFUSAL`/`REFUSAL_TEXT`, each reading the fold and the log alone; **none reads a condition** (the parent's D1 and §3.7):

| refusal | when |
|---|---|
| `PLAY_STOPPED` | any play event (ball, wicket, retirement, bowler change, penalty) in an innings with an open stop |
| `PLAY_ALREADY_STOPPED` | a `play_stopped` while one is open |
| `PLAY_NOT_STOPPED` | a `play_resumed` with no open stop |
| `STOP_OUTSIDE_INNINGS` | a stop or resumption naming an innings that is not open (not started, or sealed) |
| `REVISION_BELOW_BOWLED` | `revision.overs` below the whole overs needed to finish the over in progress: `overs < ceil(balls / 6)` (**A**: today's revision check may already refuse this; Opus confirms and names it) |
| `PAR_WITHOUT_TARGET` | `revision.par` on an innings with no target (a first innings), or on a super-over innings (3b's `SUPER_OVER_NO_REVISION` already covers the latter) |

Balls after a revised allotment are refused **already**: the revision moves the innings' overs and `INNINGS_OVER` fires at the new figure. A `revision` that *raises* the allotment is not refused: it is not a Law, the umpires decide, and the calculator's arithmetic treats a gain as a negative loss (D3). A seal while a stop is open is allowed only with reason `abandoned` (that is a termination); any other reason is `PLAY_STOPPED`. `PREVIOUS_INNINGS_OPEN` already refuses starting the chase while the first innings is stopped and unsealed. A super over may be stopped and resumed (weather ends it or it is played out, 3b §3.6) but never revised.

### 2.5 What the pad shows

Stopped: the banner of §1, and two buttons — **Resume** and **End innings (rain)**; the ball buttons are off (the one place the pad greys out, because the Law refuses the ball). **Resume** opens a sheet: *Overs now* (prefilled with the current allotment); in the chase also *Target now* (blank, the umpires' figure), and beside both the calculator's proposal or *No DLS table loaded* (§3.6). It emits `revision` (only if a figure changed) then `play_resumed`. **End innings (rain)** opens the seal with reason `abandoned`, and in the chase asks *Par score announced by the umpires* (emits `revision {par}` then the seal). The chase's `innings_start` sheet gains the same proposal beside its target field. Offline, the pad has no calculator and says so; the sheet works without it (D6).

---

## 3 · The calculator: DLS Standard Edition, in `packages/scoring/src/dls.mjs`

### 3.1 Plain words

The Standard Edition is a table and three lines of arithmetic. The table says what fraction of a full innings' resources a side still has with `b` balls left and `w` wickets down. Each side's resources are what it started with less what each interruption took away. If the chasing side has fewer resources than the first side had, its target is the first side's score scaled down; if it has the same, one more; if it has **more** (the first innings was cut short), the difference is priced at a published average-score constant, G50, rather than by scaling up a score that was never completed. The calculator is a pure function of the fold's positions, the frozen conditions and one table; it holds nothing and rounds once.

### 3.2 Definitions

- `R(b, w)`: resources remaining with `b` balls remaining and `w` wickets lost, in **tenths of a percent** (integer; the published table's precision). `R(0, w) = 0`; `R(b, 10) = 0`. `R(300, 0) = 1000` is the full 50-over innings, and a 20-over innings starts with `R(120, 0)` — the Standard table is one table for every length.
- `N₁`, `N₂`: the allotment each innings started with (`innings_start.overs`), in balls.
- `S`: the first innings' total (the fold's `runs`, penalty runs included as `innings_score_as_folded()` gives them).
- `G50`: the Standard Edition's average full-innings score, a published constant (§3.4).
- For an interruption in an innings at position `(b_stop, w)` — `b_stop` = balls remaining under the allotment in force at the stop — resumed under an allotment leaving `b_resume` balls: **loss = `R(b_stop, w) − R(b_resume, w)`**; terminated: `b_resume = 0`, loss = `R(b_stop, w)`.
- `R₁ = R(N₁, 0) − Σ losses in innings 1`. A side all out has used everything it had left, so `R₁` is unchanged by being all out (it is already the resources available). `R₂` likewise for the chase, with `N₂` the chase's starting allotment (already reduced if the interval was lost).

### 3.3 The target

```
if R₂ <  R₁ :  par = ⌊ S × R₂ / R₁ ⌋
if R₂ =  R₁ :  par = S
if R₂ >  R₁ :  par = S + ⌊ G50 × (R₂ − R₁) / 1000 ⌋
target = par + 1
```

Integer arithmetic throughout (`S`, `G50`, and `R` in tenths are integers; one floor per line). With an over-grain table (§4.2) every `R` is first scaled by 6 so a within-over interpolation is exact; the ratio is unchanged.

The cases the calculator names in its result (`case`), so the pad's words say which applied:

| case | what happened | R₁ | R₂ |
|---|---|---|---|
| 1 delayed start | both sides reduced to `N` before the first ball | `R(N,0)` | `R(N,0)` → `target = S + 1` |
| 2 first innings interrupted, resumed shorter | stop at `(b, w)`, resume at `N₁'` | `R(N₁,0) − [R(b,w) − R(N₁'·6 − bowled, w)]` | `R(N₂,0)`, `N₂` as announced; usually `R₂ > R₁` → the G50 line |
| 3 first innings terminated | stop, seal `abandoned` | `R(N₁,0) − R(b,w)` | as above |
| 4 interval lost | chase starts with `N₂ < N₁` | full | `R(N₂,0) < R₁` → scaled down |
| 5 chase interrupted, resumed shorter | stop at `(b, w)`, resume at `N₂'` | as it was | `R₂ − [R(b,w) − R(N₂'·6 − faced, w)]` |
| 6 chase terminated | stop, seal `abandoned` | as it was | `R₂ − R(b, w)` → **par** at that point |
| n | several interruptions | Σ of the losses, each under the allotment in force at its stop | likewise |

**Par at a point** in the chase, for the board's "ahead of par by 3" and for a termination proposal: `par_now = par(S, R₁, R₂ − R(b_now, w_now))` — the target the chase would have if it ended here, less one. Ahead if `runs > par_now`, level at it, behind below it.

### 3.4 G50

The Standard Edition needs G50 only in the third line, when the chase has **more** resources than the first side had. The ICC publishes the value it uses for its own matches and expects other levels of the game to set their own (**A**: the document Kameel supplies states one for the level it covers). It is therefore a **playing condition**, `target.g50` (play, int, runs, no platform default), entered on the competition's set with its source like every other value, and frozen with the match. Without it, the calculator answers the first two lines and, for the third, says *G50 not set for this competition: enter the umpires' target*. Venue par (§6) is **not** a substitute for G50: the umpires do not use it, and the platform's figure would then disagree with the record by construction (D7).

### 3.5 Where it runs, and what SQL needs

`dls.mjs` exports `dlsTarget(fold, innings, {table, g50})`, `dlsParAt(fold, innings, position, {table, g50})` and `resourcesOf(table, b, w)`, all pure, all integer, all returning `{status: ok | no_table | no_g50 | not_limited | not_applicable, ...figures, case, tableId}`. It is called by the read API (`services/api/read`) for the pad's proposal, the match page's rain panel and the public log — server-side only (D6). **SQL needs no calculator**: the result, the standings, NRR and `min_overs_per_side` all read the umpires' figures from the log (`target`, `revised.overs`, `par`), which the fold and `innings_score_as_folded()` already hold in parity. The table lives in SQL only as storage (§4). The one parity that is new is `par` and `stopped` on `innings_score_as_folded()` against `inn.par` and `inn.stopped`, and `match_result()` against `describeResult()` on the new logs (§7).

### 3.6 The difference, kept and shown

Nothing is stored: the announced figure is in the log (`innings_start.target`, `revision.target`, `revision.par`), the calculated figure is `dlsTarget()` over the same log with the table the frozen document names (§4.4) and the frozen G50. The read API returns both and the difference; the board, the match page and the public log show *umpires 134 · calculated 133* when they differ and only the announced figure when they agree. A difference is information for the organiser, never a flag, a refusal or a correction (D1). If the document names no table (the match was fixed before one was loaded), the calculator uses the current published table and the line says so.

### 3.7 Average run rate

Recommend **not** a method (D4). It is a known-poor rule (it ignores wickets and hands the chase a discount for every over lost), no KZN document is in hand that names it (**A**), and an umpire who does use it announces a figure the scorer records under `umpires_revision` exactly as today. Its one useful shape — a proportion of overs — survives as the labelled fallback for venue par at a point when no table is loaded (§6.5), where it is evidence, not a target.

---

## 4 · The resource table: storage, provenance, loading, absence

### 4.1 Storage

```
dls_resource_table (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition text NOT NULL CHECK (edition = 'standard'),          -- the Professional Edition is never a row
  version smallint NOT NULL,                                    -- the platform's own numbering: 1, 2, …
  title text NOT NULL,                                          -- "DLS Standard Edition, <publisher> <year>"
  grain text NOT NULL CHECK (grain IN ('ball','over')),
  max_balls smallint NOT NULL CHECK (max_balls > 0),            -- 300 for the published table
  source_publisher text NOT NULL, source_document text NOT NULL, source_edition_date date NOT NULL,
  permission_note text NOT NULL CHECK (length(btrim(permission_note)) >= 20),   -- who gave permission, for what use, when
  permission_confirmed_by uuid NOT NULL → app_user, permission_confirmed_at timestamptz NOT NULL,
  content_hash text NOT NULL,                                   -- sha256 over the canonical rows (§4.3)
  row_count int NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn')),
  supersedes uuid → dls_resource_table,
  loaded_by uuid NOT NULL → app_user, loaded_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid, published_at timestamptz, withdrawn_by uuid, withdrawn_at timestamptz, withdrawn_note text,
  UNIQUE (edition, version)
)
dls_resource (
  table_id uuid NOT NULL → dls_resource_table ON DELETE CASCADE,
  balls_remaining smallint NOT NULL, wickets_lost smallint NOT NULL CHECK (wickets_lost BETWEEN 0 AND 9),
  resource_tenths smallint NOT NULL CHECK (resource_tenths BETWEEN 0 AND 1000),
  PRIMARY KEY (table_id, balls_remaining, wickets_lost)
)
```

A published table is **immutable** (a trigger refuses any write to its rows, as a published `condition_set` is); a correction is a new version with `supersedes`; withdrawal keeps the rows (a match whose document names a withdrawn table still reads it, and the screen says *table since withdrawn*). Numbers live in the database only: **no migration, seed, fixture or test in the repository ever contains a row of `dls_resource`**, and CI greps `db/*.sql` and `packages/**` for `INSERT INTO dls_resource` and for a `dls_resource_table` row with `edition = 'standard'` outside the synthetic generator (§4.5).

### 4.2 Grain

The published Standard table is per over; the ICC also issues a per-ball form. A `ball` table has every `(0..max_balls) × (0..9)` cell; an `over` table has cells at multiples of six only, and the calculator interpolates linearly within the over (exact, §3.3) and says *interpolated within the over* in its result. Load the per-ball form if the source supplies it (D5).

### 4.3 Structural checks at load (no real numbers needed)

The loader refuses a table that fails any of: every cell present for its grain; `R(0, w) = 0` for all `w`; `R(max_balls, 0) = 1000`; non-decreasing in `balls_remaining` for each `w`; non-increasing in `wickets_lost` for each `b`; `content_hash` = sha256 of the rows serialised `b,w,tenths\n` in `(b, w)` order — the same string JS and SQL both produce, so a table loaded twice from the same file has the same hash and a table copied by hand does not.

### 4.4 Loading, and the frozen reference

An operator with `platform.reference.manage` (**A**: the capability name; the parent's §7.1 reserves catalogue changes to migrations, and this is the one piece of reference data that must *not* be a migration) posts the CSV and the provenance fields to `POST /api/admin/dls-tables` (draft), reviews the structural report, and publishes. RLS: the two tables are readable by the API's service role only; **no route serves the cells** to a browser or a device (D6), so the permission note need cover server-side use alone.

The catalogue gains `target.dls_table` (play, `object` `{id, version, hash}`, no default, readers pad/sql), which `match_conditions_resolve()` fills from the published table in force at fix time with `sources[key] = 'platform'`, so a match reads one table forever, as it reads one Laws Edition. A competition never sets this key by hand.

### 4.5 Absence, and tests

No published table: `dlsTarget()` returns `status: no_table`; the pad's sheets say *No DLS table loaded; enter the umpires' figures*; the match page shows the announced figures with no calculated line; venue par at a point uses the proportional fallback (§6.5). Nothing else changes: the record is the umpires' figure in every case.

Tests (`dls.test.mjs`, and the db/99 §dls proof) use **`syntheticTable()`**: a table generated from a formula chosen to be obviously not the real one (**A**: e.g. tenths = `round(1000 × (b / max) × (1 − w / 10))`, linear in both, which the real table is not), at both grains. Every worked example in the proof is hand-computed from that formula. The generator is the only table in the repository, its title is "SYNTHETIC — tests only", and the loader refuses to *publish* a table whose title begins with "SYNTHETIC".

---

## 5 · What reads the revised figures

| reader | reads |
|---|---|
| chase board, required rate, "at this rate", the worm's target line | `target` and `revised.overs` as today; now also `inn.stopped` (the banner) and the DLS par-at-a-point line when a table is loaded (§3.3) |
| `describeResult()` / `match_result()` (3a) | **one new clause (D2, changes 3a §2.2):** a chase sealed `abandoned` **with `inn.par`** is decided: `runs > par` → win by wickets in hand; `= par` → tie; `< par` → the first side wins by `par − runs`. Without `par`, no result, as 3a says. A first innings sealed `abandoned` followed by a chase is read as any chase (already so) |
| the words | suffix by the frozen `target.method`: `dls_standard` → "won by 12 runs (DLS)", "won by 4 wickets (DLS)", "Match tied (DLS)"; `umpires_revision` with a revised target or a par → "(revised target)". A chase that never faced a revision carries no suffix |
| `result.min_overs_per_side` (3a D9) | **refined:** on an `abandoned` chase, the overs *faced* (whole overs of legal balls) must reach N; on `overs_complete`, the allotment, as decided. The standard figure for a T20 is five overs and for a 50-over match twenty (**A**; the pilot sets none, so this changes nothing until it does) |
| NRR (3a §6.4, D12) | **one added rule (D8):** where the chase's target was revised (a `revision.target`, an `innings_start.target` other than `S + 1`, or a `par`), the first side's figures for NRR are deemed `par` runs (the last announced target − 1, or the announced par) off the chase's allotted balls (or the balls the chase faced, when terminated). This is the standard NRR rule for DLS matches and applies under `umpires_revision` too — a revised target is a revised target. Balls stay integers; the proof works it to the ball |
| the super over (3b) | a DLS tie is a tie: the pad offers **Super over** on the same three conditions as 3b §3.5 (the umpires decide whether there is light and time); an unplayable one is 3b's `incomplete` and the organiser's award. A super over is never itself revised (3b) |
| careers, milestones, dossiers, ratings, phases | **unchanged**: rain changes no ball. `phases.mjs` already draws phases over the overs actually bowled when the innings was cut |
| workload | unchanged: a stopped innings has no balls to count |
| the public log and page | the stop and resume lines (reason, position, time), the revision lines with the announced figure and the calculated one where they differ, the result words; pseudonymised as any event |
| the commentary | a line at the stop ("Rain stops play at 12.3, Northwood 87/3"), the resumption with the new allotment, and the target line |
| handover and resume, sync | nothing new: three payload keys the log carries; `confirmationState()` per innings is unchanged; `deriveMatch()` exposes `stopped` so a claiming pad shows the banner |

---

## 6 · Venue par

### 6.1 Plain words

Par at a ground is the mean of what sides have actually made batting first there, in the same kind of match, shown with the innings it came from. It is a figure about a ground, from team totals, derived on every read and stored nowhere. It says "not enough matches here yet" until it has enough. It is the evidence-based cousin of the figure `phases.mjs` refuses, and it lives beside that refusal, not in place of it: the phase card's par stays the other side's figure in the same phase.

### 6.2 The grain and the pool

`venue_par(ground_id, overs_per_innings, age_band)`, limited-overs only (`format.kind = limited`, one innings a side). Age band is the match's competition's `age_group`, else the band of the home team's code, else `open` (**A**: the mapping db/08's `age_band()` gives). The **first innings** of the match counts when all of these hold:

- the match is `complete` or its first innings is sealed `all_out` or `overs_complete` (a first innings completed and then a washed-out chase still counts: the innings happened);
- the innings has **no `revision.overs` and no `play_stopped` followed by an `abandoned` seal** — it was played to its allotment, and that allotment equals the grain's overs;
- `super_over IS NULL`; not a friendly *excluded* — a friendly at the ground is the ground's record (D9);
- a scorebook innings (db/64 `innings_summary`) counts on the same tests when its card states the overs; the evidence says how many came from books.

Rain-shortened first innings are **excluded**, not scaled (D10): scaling needs the table (absent at first), and a scaled total is an estimate in a pool that is meant to be plain record. If the sample floor bites at a wet ground, scaling can be added later as a labelled second pool.

### 6.3 Floor, window, and the figure

- **Floor:** `VENUE_PAR_MIN_INNINGS = 5`, one platform constant in `venue.mjs` and the SQL view, pinned together by the catalogue-string method (D11). Below it the read returns `sufficient = false` with `n` and the floor, and the screen says *Not enough matches here yet (2 of 5)*. Not a playing condition: it is not a competition's rule.
- **Window:** the current school season and the two before it (db/08 `season_for`), so a relaid square or a new age group ages out (D12).
- **Figure:** `par = round(mean(runs))`, whole runs, as Kameel asked; shown with `n`, the seasons spanned, the median, the range, and the innings behind it (date, sides, total — all public results already). The median guards the reader against a 40-all-out in a pool of six.

### 6.4 Grounds

The match's `ground_id`. db/67 gives a ground its named ends and, optionally, its boundary sizes, inside a hierarchy (**A**: a school's field with one or more pitches or ovals beneath it). A pitch's innings **pool with its parent** for the par (D13): a school's two ovals rarely differ more than a small sample's noise, and the floor is reached sooner; the evidence lists the breakdown by child when there is one, so a coach who wants "Oval B alone" can see it and its `n`.

### 6.5 Par at a point

For any innings at that ground, either innings, at position `(b, w)` in an innings allotted `N` balls with venue par `P` for the grain's overs:

```
with a table:   par_at = round( P × (R(N,0) − R(b,w)) / R(N,0) )      label "DLS resources used"
no table:       par_at = round( P × (N − b) / N )                         label "proportion of overs; no DLS table loaded"
```

`N` is the innings' current allotment; a reduced innings is measured against the full-length venue par because that is the only pool there is, and the label says "of a full innings here". The board line reads *A typical side here would be 61/3 by now*; it is one line, greyed when `sufficient = false` (*no venue par here yet*). Computed in the read API (JS, `venue.mjs` over the SQL view's `P` and the table), never in SQL — nothing in SQL needs it.

### 6.6 Privacy

None to consider: the inputs are innings totals, overs and grounds, all already public on the results page; no player, no name, no age of a child, no per-batter figure. The evidence list shows fixtures, not people. Confirmed.

---

## 7 · Phasing, proofs, parity

One migration per phase, its proof in db/99, a smoke walk, `DEPLOYING.md`'s shipped-file rules. Numbers follow 3a–3c (db/69–71); if 3b or 3c is deferred, the lead renumbers and R1 takes the next free file. R1 needs 3a (`match_result()`, `describeResult().text`, NRR). R2 and R3 are independent of each other and of 3b/3c; R3 can ship before R2 (its fallback needs no table) and should, since the table arrives when Kameel's source does.

| phase | migration | tier | ships | proves |
|---|---|---|---|---|
| **R1 · Interruptions** | `db/72` | Opus (events, fold, the six refusals, `revision.par`, `innings_score_as_folded().stopped/par`, `match_result()` and `describeResult()` re-emitted with the par clause and the words, the NRR deemed rule, `min_overs` on balls faced, `target.method` values, `target.g50`, proofs); Sonnet (the pad's Stop/Resume/End-innings flow and banner, the board's revised line, the public log lines, the commentary words) | §2 entire; §5 less the calculated lines | §results-rain (below) |
| **R2 · The table and the calculator** | `db/73` | Opus (`dls_resource_table`/`dls_resource`, the loader and its checks, RLS, `target.dls_table` in the resolver, `dls.mjs`, the proposal read, proofs); Sonnet (the admin loading screen with its structural report, the proposal beside the target and par fields, the match page's rain panel with the difference) | §3, §4, §3.6 | §dls |
| **R3 · Venue par** | `db/74` | Opus (the `venue_par` view and its pool rules, the constant pinned both sides, proofs); Sonnet (the ground page's par with evidence, the board's "typical side here" line, `venue.mjs`'s par-at-a-point) | §6 | §venue-par |

**Logs for the parity list** (`tools/smoke-fold-figures.mjs`, each folded both ways): a first-innings stop and resume at fewer overs; a first innings terminated then a chase with an announced target, won and lost; an interval lost; a chase stopped and resumed with a new target; a chase terminated with a par — above, level and below; a chase terminated with **no** par (no result); two interruptions in one innings, one mid-over; a stop before the first ball; a super over stopped and resumed; each refusal of §2.4 shown refusing and then accepting the corrected event; a match under `umpires_revision` with the same events (the words differ, nothing else).

**db/99 sections**, each falsified before it passes:

- **§results-rain:** `match_result()` = `describeResult()` on the list; `stopped` and `par` in parity; the par clause's three outcomes and the no-par no result; `min_overs` on balls faced for an abandoned chase; the NRR deemed rule worked to the ball for a revised target, a par and an unrevised match (unchanged); the words' suffix by method; a `play_stopped` in the public log; careers identical before and after a stop/resume pair; the completion gate unchanged.
- **§dls:** the synthetic table loads at both grains and its hash matches JS's; each structural check refuses a table broken in that one way; a published table refuses a write; withdrawal keeps rows; the resolver freezes `target.dls_table`; a later version does not move an earlier match's proposal; the seven cases of §3.3 against hand figures from the synthetic formula, including a multi-interruption and a mid-over one; the G50 line with and without `target.g50`; over-grain interpolation equals the ball-grain value at whole overs; `no_table`; the proposal never appears in the log; no route returns a cell; the CI grep passes on the repository.
- **§venue-par:** the floor (4 innings says insufficient, 5 says a figure); each exclusion (a revised innings, a terminated one, a super over, a second innings, a 50-over innings in a 20-over pool, a fourth season); a book innings counted; a friendly counted; a child ground pooled with its parent and listed in the breakdown; the mean, median and range against hand figures; par at a point with the synthetic table and the proportional fallback, labelled.

JS tests beside them: `replay.test.mjs` (interruptions, par, words), `laws.test.mjs` (the refusals), `conditions.test.mjs` (the catalogue string re-pinned for `target.method`'s values, `target.g50`, `target.dls_table`), `dls.test.mjs` (synthetic only), `venue.test.mjs`.

---

## 8 · Decisions for Kameel

**Decided (Kameel, 2026-09-30): D1–D14 as recommended.** Order: R1 interruptions (db/72, after phase 3a), R3 venue par (db/74), R2 the DLS table and calculator (db/73) once Kameel supplies the official Standard Edition document and permission is confirmed; Opus checks the formulas against it before R2.

Each with the recommendation the body assumes and one line of why.

| # | decision | recommendation |
|---|---|---|
| **D1** | The umpires' announced figure is the record; SCRBRD's calculation is shown beside it with the difference; a difference never refuses, flags or corrects | **Yes** (Kameel's rule). The umpires stand on their sheet; the platform's job is to be checkable, not to overrule |
| **D2** | An innings cut short ends with the existing `abandoned` seal, read with the `play_stopped` before it; a chase so sealed with `revision.par` is decided on par, without one it is no result (amends 3a §2.2 by a clause) | **Reuse the seal.** No reader learns a new end reason; the par turns abandonment into a result exactly when the umpires said it did |
| **D3** | Three event shapes: `play_stopped`, `play_resumed`, and `par` on the existing `revision`; a revision that raises the allotment is recorded, not refused | **Yes.** The existing revision stays the umpires' figure; a raise is not a Law's business |
| **D4** | `target.method` values: `umpires_revision` (default, today) and `dls_standard`; **no `average_run_rate`** | **Drop ARR.** A poor rule nobody has cited; an umpire who uses it is recorded under `umpires_revision`; its proportion survives only as venue par's labelled fallback |
| **D5** | The table stored versioned, cited, permissioned, immutable once published, in the database only; loaded by an operator from Kameel's source; per-ball grain preferred, per-over accepted with exact interpolation | **Yes.** Provenance is a row, not a comment; the repository never holds a number |
| **D6** | The calculator runs server-side only; no route serves table cells; the offline pad has no proposal and says so | **Server-side.** The record is the umpires' figure anyway; shipping the table to every scorer's device widens the permission needed for no gain on the day |
| **D7** | G50 is a playing condition `target.g50`, cited from the supplied document, no default; venue par never substitutes for it | **Yes.** It is a published constant the umpires use; a venue-derived one would make the platform disagree with the record by design |
| **D8** | NRR: where the chase's target was revised, the first side is deemed `par` off the chase's allotted (or faced) balls; under both methods (amends 3a §6.4 by a rule) | **Yes.** The standard rule; without it a rain-affected match distorts the table |
| **D9** | Venue par's pool: first innings played to its allotment, at the grain ground × overs × age band, friendlies and scorebook innings included, super overs and second innings excluded | **Yes.** A ground's record is every innings played out on it |
| **D10** | Rain-shortened first innings excluded from venue par, not scaled | **Exclude.** Plain record over estimate; scaling can be a labelled second pool later if the floor bites |
| **D11** | Sample floor 5 innings as a platform constant pinned in JS and SQL, not a playing condition | **Yes, 5.** It is not a competition's rule; five is the fewest a mean of school totals can bear (**A**) |
| **D12** | Recency window: this school season and the two before | **Yes.** Squares change; three seasons is enough innings at a busy ground and not too old at a quiet one |
| **D13** | A pitch pools with its parent ground for par, with a per-child breakdown in the evidence | **Pool.** Small samples first; the breakdown keeps the finer figure visible |
| **D14** | Phasing R1 (db/72) → R3 (db/74) → R2 (db/73 by number, last by time, when the source arrives); R1 needs 3a only | **Yes.** Interruptions and venue par need no table; the calculator waits for permission, and nothing else waits for it |

**Assumptions (A)**, each to be confirmed: the Standard Edition's shape as stated in §3 (from memory; the supplied document is the authority and Opus checks the formulas against it before R2); the document supplies a G50 for the level it covers; today's revision check on overs below those bowled; the capability name for loading reference data; the synthetic generator's formula; the standard `min_overs_per_side` figures (five and twenty); db/67's ground hierarchy shape; the age-band mapping for a match without a competition; that no KZN document names average run rate; the floor of five.

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `revision` (`overs`, `target`), `innings_start.overs/target`, `toRow()`/`fromRow()`, the omitted-key rule, `DERIVED_END_REASONS` (`abandoned`) | `packages/scoring/src/events.mjs` | the umpires' figures; the three payload keys |
| `MatchFold`, `inningsOverReason()`, `describeResult()`, `sealRefusal()` | `packages/scoring/src/replay.mjs` | positions, the par clause, the words |
| `lawsRefusal()`, `REFUSAL`, `INNINGS_OVER`, `PREVIOUS_INNINGS_OPEN` | `packages/scoring/src/laws.mjs` | the six refusals; balls past a revision |
| `conditionsOf()`, `oversPerInnings()`, `CONDITION["target.method"]` (reserved today), `catalogueString()` | `packages/scoring/src/conditions.mjs` | the method's words; `target.g50`, `target.dls_table` |
| `phases.mjs`'s refusal of an absolute par, and its `par` | `packages/scoring/src/phases.mjs` | what venue par is and is not |
| `match_conditions_resolve()`, `match_playing_conditions()`, `sources[key]`, `play_overs()` | `db/61` | freezing the table reference and G50 |
| `innings_score_as_folded()`, `ball_event_live`, `match_live_score` | `db/45`, `db/48` | `stopped`, `par`; the board |
| `match_result()`, `competition_standing`'s NRR, `result.min_overs_per_side` | 3a (`db/69`) | the par clause, the deemed rule, balls faced |
| `innings_summary` (scorebook innings) | `db/64` | the venue pool's book innings |
| `ground` with named ends, boundary sizes and its hierarchy | `db/67` | the grain and the roll-up |
| `season_for()`, `age_band()` | `db/08` | the window and the band |
| `public_match_log`, db/59's reads, `commentary.mjs` | `db/63`, `db/59` | the lines the public sees |
