# SCRBRD-110 — Fast-bowler workload, individually: the design

**Status:** for Kameel's review, 2026-09-27. Nothing here is built.
**Source:** `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`, SCRBRD-110 (the decisions and Vincent Barnes' case) and SCRBRD-092 (the consent at sign-up).
**Reader:** the product owner first, then whoever builds it. Plain words come first in each section; the schema and policy detail follow.

---

## 0 · What this is, in one page

Vincent Barnes' case is that a fast bowler gets hurt less from *how much* he bowls than from sudden jumps after little bowling, from intensity, from poor recovery, and from an old injury. The platform already counts a boy's match overs from the ball log (`bowler_over`, `bowler_spell`, `workload()` in `db/08_schema_programme.sql`), compares them to the age-band directive (`bowling_directive`, `bowling_directive_for()`), writes a breach down as a fact (`bowling_breach`) and tells the coach. That is the regulator's question: did he bowl too many overs on Saturday. This design answers the physio's question: is *this* boy's load, taken as a whole, moving in a way worth a conversation.

It adds five things, in the order they will be built:

1. **Every delivery, nets included.** A sport-neutral load record (a session, some units, an intensity, some minutes). Cricket's unit is the delivery. Match deliveries keep coming from the ball log, wides and no-balls included, and are never typed in again. The coach records for the group; the bowler records his own; both are kept, and the screen says when they disagree.
2. **The windows and the word.** 7, 14, 28 and 42 days; this week against last; a rolling ratio of recent load to habitual load (an exponentially weighted one, not the coupled 7:28 the current `workload()` uses); the gaps between bowling days; a 3–6-month trend; and a comparison against *his own* baseline. All derived at read time, nothing stored. The word beside the number is a fixed vocabulary and is never a diagnosis.
3. **The bowler's voice.** A daily check-in (sleep, fatigue, soreness on a body map) and one tap: "something doesn't feel right." The tap tells the physio and the coach through the existing notification path. It never marks him injured and never shows on a team screen.
4. **His own profile.** Limits set for him by the physio or coach that sit *beside* the age directive, not under it; his injury history read alongside; an optional preseason ramp that his actuals are read against.
5. **Capacity tests, technique reviews and pace readings**, each at the tier its sensitivity earns.

Around all of it: **consent**. Check-ins, tests and reviews are a child's health information, POPIA special personal information. A separate, unbundled consent from a competent person gates every new table, for collection and for reading. Without it the platform collects nothing new and the match overs stay exactly as public as a scorecard is. **Reading** follows the existing capability model: the physio and the coach read; the bowler reads his own; a parent reads only what a named adult chose to share with them, as a recorded, bounded act; a team-mate reads nothing.

Nothing is hard-wired to school age bands or to cricket. The age band is one input to a limit. "Delivery" is one row in a unit vocabulary.

---

## 1 · The load model

### 1.1 Plain words

A load record answers: *who*, *on which day*, *how many units*, *how hard*, *for how long*, *at which session*, and *who says so*. That is the same shape for a cricket bowler at nets, a hockey goalkeeper's drag-flick drill and a rugby prop's scrum session, so the record is sport-neutral and the sport decides what a "unit" is.

Match deliveries are already in the ball log. `bowler_over` counts them per bowler per over, dated by the fixture's day in South African time, and its `deliveries` column already includes wides and no-balls (`legal_balls` is the six-a-side count). The load model reads that view; it does not copy it. Nothing about a match is typed in twice.

Nets and training are not in any log, so they are recorded. Two people may record the same session — the coach for the group, the bowler for himself — and both records are kept. When they disagree the derived day total uses **the bowler's own figure**, and the coach's screen shows the disagreement. The reasoning is in §1.3.

### 1.2 The unit vocabulary

A small reference table, platform-owned like `sport` and `bowling_directive`:

| `code` | `label` | `sport_code` | notes |
|---|---|---|---|
| `delivery` | Deliveries | `cricket` | the one shipped in phase 1 |

Another sport adds rows, not columns. A unit belongs to a sport so the screen can say "deliveries" or "throws" rather than "units". The words the summary produces (§2) never name the unit; they say "load".

### 1.3 The record: `load_entry`

One row per person per recording of one session. Never updated: a correction is a new row that names the one it replaces (`supersedes`), exactly as an honour is withdrawn and kept rather than edited. The derived views take the last row in a chain.

```
load_entry (
  id                  uuid PK,
  school_id           uuid NOT NULL → school,
  player_id           uuid NOT NULL → player,
  sport_code          text NOT NULL → sport,
  unit_code           text NOT NULL → load_unit,
  kind                text NOT NULL CHECK (kind IN ('nets','training','match_elsewhere')),
  training_session_id uuid → training_session,          -- when it was one of ours
  on_date             date NOT NULL CHECK (on_date <= sa_today()),
  units               integer NOT NULL CHECK (units BETWEEN 0 AND 1000),
  rpe                 smallint CHECK (rpe BETWEEN 1 AND 10),   -- intensity, one scale
  minutes             smallint CHECK (minutes BETWEEN 1 AND 600),
  recorded_by         uuid NOT NULL → app_user,          -- set by trigger, never passed in
  recorded_as         text NOT NULL CHECK (recorded_as IN ('self','staff')),  -- set by trigger
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  supersedes          uuid → load_entry
)
```

**Decisions, and what was rejected:**

- **`kind` never includes `match`.** A match scored on SCRBRD is in `ball_event` and is derived. `match_elsewhere` exists for the game that was scored on paper at a ground the platform does not host; the day view marks an `match_elsewhere` entry on a day where `bowler_over` already has rows for that bowler as *possibly counted twice*, and a person decides. It does not refuse the row: the log records what happened, and the alternative — silently dropping one — is the invisible error `db/08`'s workload section warns about.
  *Rejected:* storing match deliveries as `load_entry` rows written by a trigger on `ball_event`. It duplicates the truth and breaks the moment a ball is voided or quarantined; the existing views already fold correctly.
- **One intensity scale, `rpe` 1–10.** The screen offers three buttons (low, medium, high → 3, 6, 9) with a numeric option; the table holds one column.
  *Rejected:* separate `intensity_word` and `effort_score` columns — two ways to say one thing, and the summary would have to reconcile them.
- **Session-RPE load** (`rpe × minutes`, the arbitrary-units measure used across sports) is *derived* in the day view when both are present. Cricket's windows run on deliveries because that is what the bowling literature counts; the AU figure is shown beside and becomes the primary measure only for a sport with no unit yet.
  *Rejected:* inventing minutes or RPE for a match from its over count. Nothing that was not recorded is counted.
- **No free text.** A note about a boy's body belongs in the injury record or a check-in, under the tier those carry. An entry is numbers and references.
- **Who recorded it is derived, not declared.** A `BEFORE INSERT` trigger sets `recorded_by = app_user_id()` and `recorded_as = 'self'` when the caller holds a live `selfaccess` assignment naming this player, `'staff'` otherwise. The browser never says which it is.

**Reconciliation.** The day view groups entries by `(player_id, on_date, coalesce(training_session_id, kind))`. Where the group holds both a `self` and a `staff` chain, the total uses the `self` figure and the row carries `disagreement = staff_units − self_units` for the coach's screen (shown when it exceeds 20% or 12 units, whichever is larger).

*Why the bowler's figure.* The coach's group entry is an estimate — "everyone bowled six overs" — and the bowler counted his own. The design is meant to give him a voice; a voice that is overwritten is decorative.
*Rejected — take the larger:* safe-sounding, but it rewards a bowler who inflates and punishes one who is honest, and it hides the disagreement, which is the useful information.
*Rejected — the coach wins:* see above.
*Rejected — average:* a number nobody recorded.
This is **open question Q1**; the rule is one line in the view and cheap to change.

### 1.4 How the pieces combine: `load_day`

A `security_invoker` view, one row per player per day:

```
load_day: player_id, school_id, sport_code, on_date,
          match_units      -- sum(bowler_over.deliveries) for cricket, per bowled_on
          entered_units    -- reconciled per §1.3
          units            -- match_units + entered_units
          minutes, au      -- from entries only
          sessions         -- distinct groups
          disagreement     -- max over groups, NULL when none
          possibly_doubled -- a match_elsewhere entry on a day with match rows
```

Match units are a `UNION` of per-sport derived sources; cricket contributes `bowler_over`. A second sport adds a branch when it has a log to fold. Every downstream figure in §2 is computed from `load_day`, so the rule "nothing counted is stored" is kept by construction: there is no table to drift.

### 1.5 The write route

`POST /api/load-entry` in a new `services/api/write/load-api.mjs`, beside `workload-api.mjs`, under `withPrincipal()` and an `Idempotency-Key` (`db/15`). Two shapes:

- **the group:** `{ trainingSessionId, entries: [{ playerId, units, rpe?, minutes? }] }` — one transaction, one row per player, `recorded_as = 'staff'`; the screen pre-fills the list from `training_attendance` for that session;
- **the self:** `{ playerId, kind, onDate, units, rpe?, minutes?, trainingSessionId? }` — refused by RLS unless the caller is that player's `selfaccess`.

The handler contains no authorization of its own. RLS and the consent trigger (§7) decide.

---

## 2 · The windows and the signal

### 2.1 Plain words

Everything a screen shows about load is worked out when it is asked for, from `load_day`. Nothing is stored. That is the house rule for the score and it is the house rule here, for the same reason: a voided ball, a superseded entry or a withdrawn consent changes the answer immediately and everywhere.

The screen shows, for one bowler:

| measure | what it is |
|---|---|
| **7 / 14 / 28 / 42 days** | units in each trailing window, ending today (SA time) |
| **week to week** | this 7 days against the 7 before, as a percentage |
| **recent against habitual** | an exponentially weighted moving average ratio (§2.2). One word beside it. |
| **uncoupled ratio** | this 7 days against the mean of the 3 preceding weeks, as a number for those who know it |
| **gaps** | days since he last bowled; the longest gap in 42 days; his usual gap in 28 |
| **trend** | 26 weekly totals for the chart, with 13-week and 26-week means |
| **against his baseline** | this week against his own habitual week (§2.4), with a word |
| **against his plan** | when a ramp exists (§4.4), planned against actual per week |

### 2.2 The ratio: EWMA, not coupled 7:28

The current `workload()` divides this week by a quarter of the last four weeks. The acute week is *inside* the chronic month, which pulls the ratio toward 1 arithmetically and makes a single big day look smaller than it was. The literature Kameel's note refers to moved on for that reason.

**Decided:** the word comes from an **EWMA ratio**. Two exponentially weighted averages over the daily series (zero-padded), acute with λ = 2/(7+1), chronic with λ = 2/(28+1); the ratio is acute over chronic. It weights yesterday more than three weeks ago, and it handles a fortnight off correctly — the chronic average decays rather than the boy "disappearing" from a window. The **uncoupled 7:21** ratio is shown as a second number. The coupled figure is dropped from the screen; the `acwr` column stays on `workload()` for the existing read (`read-api.mjs`, resource `workload`) until that screen moves.

*Rejected — keep coupled 7:28 as the word:* the reason above.
*Rejected — plain rolling averages only:* a gap week makes the acute window zero and the chronic window shrink together; the EWMA degrades more gracefully.
*Rejected — one ratio only, no second number:* physios who know the field ask for the uncoupled figure; showing it costs a column.

**The words** are the server's, fixed, and about *load*, never about the body:

| word | rule |
|---|---|
| `no load` | nothing in 28 days |
| `rested` | nothing this week, something this month |
| `too little to say` | chronic average below a floor (fewer than 12 units in 28 days) |
| `light` | ratio < 0.8 |
| `steady` | 0.8 – 1.2 |
| `rising` | 1.2 – 1.5 |
| `spike` | > 1.5 |

Every screen that shows a word shows the same fixed sentence beneath it: **"A guide to a conversation, not a diagnosis."** No word says *risk*, *danger*, *injury* or *unsafe*. The thresholds are the ones `workload()` already uses, so the existing screen and the new one never disagree about what "spike" means.

### 2.3 Where it is computed

Two `SECURITY DEFINER` functions in the phase-1 migration, in the shape of `workload()` — the per-row `app_can('player.workload.read', …)` check is inside the function, so three tables' policies do not each subtract from the answer differently:

- `load_summary(p_player uuid)` — one row: the windows, the ratios, the gaps, the baseline and its deviation, the words, `disagreement_7d`, `possibly_doubled_7d`. The EWMA is a recursive CTE over the last 90 days of `load_day`.
- `load_weeks(p_player uuid, p_weeks int DEFAULT 26)` — one row per ISO week (SA time): `units`, `sessions`, `minutes`, `au`, `planned_units` (§4.4), `match_units`, `entered_units`.

`workload()` itself is re-emitted in the same migration (as `db/23` re-emitted the decision functions) to add `units_7d`, `units_28d`, `ewma_ratio`, `load_word` and `open_flag` (§3) to its team row, so the coach's list can sort by the new word without a second call. Its old columns and its order (breaches first) do not change.

Read routes: `load` (`load_summary`) and `loadWeeks` (`load_weeks`) in `services/api/read/read-api.mjs`, following the `workload` entry's pattern. The client draws charts and never computes a window.

### 2.4 One bowler's baseline

**Decided:** his baseline is the **median of his weekly totals for the 12 weeks ending two weeks ago** (weeks 3–14 back), and it exists only when at least 6 of those weeks had any load. Deviation is this week against it, with the same words as §2.2. When no baseline exists the screen says "no baseline yet — about N more weeks", never a number.

*Why exclude the two most recent weeks:* otherwise a spike raises its own baseline.
*Why the median:* one huge festival week should not become his "usual".
*Rejected — a season average:* a preseason ramp and a mid-season week are not the same "usual".
*Rejected — a stored baseline the physio sets:* that is a limit (§4.2), a different thing, and it would be the one number on the screen that does not update itself.

---

## 3 · The bowler's voice

### 3.1 Plain words

Two things, both his alone to write.

**The daily check-in** takes thirty seconds: how he slept, how tired he is, whether anything is sore and where. One a day. It is health information at the third tier (candid, about his body), read by the physio and the coach of his current side, and by him.

**"Something doesn't feel right"** is one tap. It opens a *flag*: the physio and the coach are told through the notification path that already exists, and one of them records that they have spoken to him and what came of it. It **never** marks him injured, never changes his attendance status, never changes his availability for Saturday, and never appears on any screen a team-mate can open. If it turns out to be an injury, the physio records one in `injury` as they would have anyway, and the flag's outcome points at it — the flag does not create it.

### 3.2 The check-in: `wellness_checkin`

```
wellness_checkin (
  id             uuid PK,
  school_id      uuid NOT NULL → school,
  player_id      uuid NOT NULL → player,
  on_date        date NOT NULL DEFAULT sa_today(),
  sleep_quality  smallint NOT NULL CHECK (1..5),
  sleep_hours    numeric(3,1) CHECK (0..16),           -- optional
  fatigue        smallint NOT NULL CHECK (1..5),
  soreness       smallint NOT NULL CHECK (0..5),        -- 0 = none
  sore_sites     text[] NOT NULL DEFAULT '{}',          -- each ∈ body_site.code
  recorded_by    uuid NOT NULL → app_user,              -- trigger: must be his own selfaccess
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, on_date)
)
body_site (code text PK, label text, region text)       -- ~24 sport-neutral sites: lower_back, l_shoulder, r_shoulder, l_knee, …
```

**Decisions:**
- Fields are the three Barnes names — sleep, soreness, fatigue — and no more. No mood, no menstrual field, no free text. Data minimisation is the rule; anything more is a later, separate decision with its own consent wording.
- Body map sites are a closed vocabulary, so a coach's screen can show a silhouette and so nothing typed about a child's body sits in a text column.
- One per day, no editing: a second submission the same day replaces the first through `ON CONFLICT (player_id, on_date) DO UPDATE` — the one place a row is updated, because "how I feel today" is one fact per day, not a log.
- **Written by him only.** The `BEFORE INSERT` trigger refuses a caller who does not hold a live `selfaccess` assignment naming `player_id`. A coach cannot fill it in for him. **Q6** asks whether a coach may record one on behalf of a boy with no phone; the recommendation is no — the check-in that is not his is not his voice, and a coach's observation of a boy belongs in `development_note` under `player.note.*`.

### 3.3 The flag: `wellness_flag`

```
wellness_flag (
  id             uuid PK,
  school_id      uuid NOT NULL → school,
  player_id      uuid NOT NULL → player,
  raised_at      timestamptz NOT NULL DEFAULT now(),
  raised_by      uuid NOT NULL → app_user,              -- trigger: his own selfaccess
  site           text → body_site,                      -- optional single tap on the map
  acknowledged_at timestamptz, acknowledged_by uuid → app_user,
  closed_at      timestamptz, closed_by uuid → app_user,
  outcome        text CHECK (outcome IN ('spoke_to_him','referred_to_physio','rest_agreed','load_adjusted','injury_recorded','no_action')),
  injury_id      uuid → injury                          -- only with outcome = 'injury_recorded'
)
UNIQUE INDEX one_open_flag ON wellness_flag (player_id) WHERE closed_at IS NULL
```

**Who is told, and how.** An `AFTER INSERT` trigger, `SECURITY DEFINER` like `bowling_breach_watch()`, inserts one `notification` row:

| column | value |
|---|---|
| `school_id`, `team_code` | his school, his current `player.team_code` |
| `scope_level` | `team` |
| `kind` | `welfare` (already used by the breach notice) |
| `urgency` | `high` |
| `required_capability` | **`wellness.read`** (new, §6) |
| `subject_kind` | **`welfare`** (new value; see below) |
| `subject_person_id` | him |
| `title` / `body` | "A bowler has asked to be checked" / "{full_name} says something doesn't feel right. Please talk to him today. This is not an injury record." |

The generated `notification` policy demands `news.read` **and** the row's own capability in the same scope, so: his coach and assistant coach (team-scoped, hold `wellness.read`) receive it; the physio (`medical`, school-scoped, holds `wellness.read`) receives it; every team-mate (`player`, no `wellness.read`) does not; his guardian (no `wellness.read`) does not; the office does not. Web push goes through `fanOut()` in `services/api/notify/push-api.mjs`, whose payload is a *pointer* carrying the notification id and nothing else, so no child's name reaches a phone's lock screen. This is the existing path; nothing new is invented for delivery.

Two small changes it needs: `notification.subject_kind`'s CHECK (frozen in `db/08`) is dropped and re-added in the phase-2 migration with `'welfare'` in the list, and `SUBJECT_KINDS` in `push-api.mjs` gains the same word.

**What it never does — enforced, not promised:**
- It has no path to `injury`, `training_attendance` or `match_availability`. The trigger writes one `notification` row and nothing else; a test asserts the row counts of those three tables before and after a flag.
- `player` holds no capability that reads `wellness_flag`, and the row's anchors resolve through the player, so a team-scoped `player` assignment never reaches it even by accident of scope.
- `workload()`'s team list shows `open_flag` **only** to a reader who holds `wellness.read` for that row (a per-row `app_can` inside the function), so the coach's list shows the dot and a director of sport's does not.
- A second tap while one is open is not a second flag (the partial unique index); the screen says "the physio and your coach have been told".

**Responding.** `wellness_flag_respond(p_flag, p_action, p_outcome, p_injury)` is a `SECURITY DEFINER` function that requires `wellness.read` over the row and refuses the subject himself. Acknowledging and closing are the only updates the table takes.

---

## 4 · The individual profile

### 4.1 Plain words

One screen per bowler, read by the physio, his coach and himself: his load (§2), his check-ins and flags (§3), the limits set for *him*, his injury history under the reader's own medical tier, his preseason plan against his actuals, and his tests, reviews and pace (§5).

### 4.2 Limits for one bowler: `athlete_limit`

```
athlete_limit (
  id               uuid PK,
  school_id, player_id,
  unit_code        text NOT NULL → load_unit,
  max_per_session  integer, max_per_day integer, max_per_week integer,
  max_sessions_per_week smallint,
  basis            text NOT NULL CHECK (basis IN ('returning_from_injury','growth','preseason','physio_judgement','coach_judgement')),
  injury_id        uuid → injury,                       -- when the basis is an injury
  valid_from       date NOT NULL DEFAULT sa_today(),
  valid_until      date,                                -- NULL = until replaced
  set_by           uuid NOT NULL → app_user, set_at timestamptz,
  ended_by, ended_at,
  CHECK (at least one max is set)
)
UNIQUE INDEX one_live_limit ON athlete_limit (player_id, unit_code) WHERE ended_at IS NULL
```

**How it sits beside the directive.** A new function, `effective_limits(p_player)`, returns each ceiling with its source:

| ceiling | inputs, tightest wins |
|---|---|
| overs per spell | `bowling_directive_for()` (age band, or the school's `bowling_ceiling_open`) · `athlete_limit.max_per_session ÷ 6` |
| overs / units per day | directive · `athlete_limit.max_per_day` |
| units per week | `athlete_limit.max_per_week` only |
| sessions per week | `athlete_limit.max_sessions_per_week` only |

The row names the source: "6 overs a spell — U15 directive, clause PACE-U15" (the clause via `rulebook_clause`, `db/32`, as `read-api.mjs` already joins it) or "4 overs a spell — set by the physio on 1 Sep, returning from injury". **The directive is one input.** For an Open-band boy at a school with no ceiling, or for any adult at a club, the only ceiling is the one set for him — which is what "not hard-wired to age bands" means in practice.

*A personal limit is never looser than the directive.* The trigger refuses an `athlete_limit` whose per-spell or per-day figure exceeds the directive for the boy's band that day. A coach may not write a permission slip.

**When he passes his own limit.** The breach trigger on `ball_event` keeps its meaning — a regulatory directive, written as a fact. A personal limit exceeded (in a match, from `bowler_over`; or in a week, from `load_day`) produces a `notification` (`welfare`, `high`, `required_capability = 'player.workload.read'`, `subject_person_id` = him) and a line on his profile; it does **not** write a `bowling_breach` row.
*Rejected — a new `bowling_breach.kind = 'own'`:* it mixes a rule of the game with a clinician's plan; `PUBLIC_DATA.md §5a` lists "bowling-workload breaches" as one thing that is never public, and it should stay one thing.

Written under **`player.workload.plan`** (new, §6): the coach of his side and `medical`. Read under `player.workload.read`.

### 4.3 The injury history

No new column. The profile read joins `injury` for `player_id` through the generated `injury_masked` view, so each reader sees exactly the tier they already hold: the coach sees nature and dates (ADR 0002), the physio sees notes, the boy sees his own record, a director of sport sees status and nature. `load_summary()` adds two derived fields under a per-row `medical.status.read` check: `days_since_last_injury` and `returning` (an `injury` row in `active` or `rehab` with `restricted`). An `athlete_limit` with `basis = 'returning_from_injury'` names the `injury_id`, so the limit explains itself without prose.

### 4.4 The preseason ramp: `load_plan`

```
load_plan      (id, school_id, player_id, unit_code, title, starts_on date, weeks smallint CHECK (1..16),
                set_by, set_at, ended_by, ended_at)
load_plan_week (plan_id, week_no smallint, target_units integer, target_sessions smallint, PRIMARY KEY (plan_id, week_no))
UNIQUE INDEX one_live_plan ON load_plan (player_id, unit_code) WHERE ended_at IS NULL
```

`load_weeks()` left-joins the live plan, so the chart draws planned against actual and the screen says "week 4 of 8: 120 planned, 96 bowled". Optional: a bowler with no plan has empty `planned_units`.
*Rejected — a stored formula (+10 % a week):* a physio writes a plan down; a formula is a plan nobody can read back. The screen may *offer* to fill the weeks from a formula; the table holds the weeks.

Written under `player.workload.plan`; read under `player.workload.read`.

---

## 5 · Capacity tests, technique reviews and pace

Three records, three tiers, because they are three different kinds of fact.

| record | what | written by | read tier | why that tier |
|---|---|---|---|---|
| **`capacity_test`** | a physio's or S&C measurement: hamstring strength, single-leg hop, a named `test_code` and a numeric result with a unit, per side | `medical.write` (the `medical` role) | **`wellness.read`** (level 3) | a clinical measurement of a child's body; more sensitive than a delivery count, less than a diagnosis |
| **`technique_review`** | a coach's judgement of an action: three yes/no/unsure — efficient, repeatable, sustainable — a `discipline` ('bowling'), a date, and the coach's prose | `player.workload.plan` | answers under `player.workload.read`; **`notes` masked under `player.note.read`** | the answers are the boy's to read; the coach's candid prose follows `development_note`'s rule exactly |
| **`pace_reading`** | a speed-gun figure: km/h, `context` ('nets','match','test'), device, optional `match_id` | `player.workload.write` | `player.workload.read` (level 2) | an asset, tracked so a *drop* can flag fatigue; not health information, but not a scorecard either — never public |

**S&C is not a role** (ADR 0003). A strength coach who records tests holds `medical`; one who only reads holds `coach`. If a school wants a person who writes tests but must not read the physio's notes, that fails ADR 0003's first test today and is **Q3**.

`technique_review.notes` is a newly masked column, so `packages/policy/src/public.mjs`'s never-public list must name it or its test fails — which is the intended tripwire. Pace readings and capacity tests are added to the same list in prose even though they mask no column.

---

## 6 · Tables and policy

### 6.1 New capabilities

Six, each in `packages/policy/src/capabilities.mjs` with a `LEVEL`, each listed in `ADDED_SINCE_01` in `services/api/rls/generate-rls.mjs` and inserted by the migration of the phase that first governs a table with it (`db/24` is the worked example). Level 2 or above puts them in `SENSITIVE` automatically.

| capability | level | held by | governs |
|---|---|---|---|
| `player.workload.write` | 2 | coach, assistantcoach, medical, selfaccess | `load_entry`, `pace_reading` |
| `player.workload.plan` | 2 | coach, medical | `athlete_limit`, `load_plan`, `technique_review` |
| `wellness.read` | 3 | coach, assistantcoach, medical, selfaccess | `wellness_checkin`, `wellness_flag`, `capacity_test`; the flag notice |
| `wellness.write` | 3 | selfaccess | `wellness_checkin`, `wellness_flag` (raise) |
| `wellness.share` | 3 | coach, medical | `wellness_share` (create, revoke) |
| `wellness.shared.read` | 3 | guardian, selfaccess | open a share made to you; the share notice |

`player.workload.read` (exists, level 2; coach, assistantcoach, directorofsport, medical, selfaccess) is the read for everything at the load tier and is not widened. `guardian` gains only `wellness.shared.read`. `player` gains nothing. `directorofsport` gains nothing (**Q2**). No new role.

*Rejected — reuse `medical.nature.read` for the wellness tier:* it is held by `teammanager`, `sportsadmin`, `principal` and `schooladmin`, none of whom Kameel named as readers, and by `guardian`, which would make the parent's read a standing permission rather than a share.
*Rejected — fewer capabilities by folding write into read:* `selfaccess` must write its own entries but never set a limit; a coach must set limits but never write a check-in. The split is the point.

### 6.2 The tables, in `tables.mjs`' own shape

Anchors resolve through the player, as `injury` and `development_note` do, so a team-scoped coach reaches his own side and stops, and a `selfaccess` assignment reaches one row's worth of person. A row that cannot resolve its player narrows to nothing (the "derived anchors" note at the top of `tables.mjs`).

```js
const viaPlayer = (t) => ({
  school: "school_id",
  team:   `(SELECT p.team_code FROM player p WHERE p.id = ${t}.player_id)`,
  person: "player_id",
});

load_unit:   { read: "(app_user_id() IS NOT NULL)", write: "platform.feature.manage", anchors: {}, masked: {} },
body_site:   { read: "(app_user_id() IS NOT NULL)", write: "platform.feature.manage", anchors: {}, masked: {} },

load_entry:        { read: "player.workload.read", write: "player.workload.write", anchors: viaPlayer("load_entry"), masked: {} },
athlete_limit:     { read: "player.workload.read", write: "player.workload.plan",  anchors: viaPlayer("athlete_limit"), masked: {} },
load_plan:         { read: "player.workload.read", write: "player.workload.plan",  anchors: viaPlayer("load_plan"), masked: {} },
load_plan_week:    { read: "player.workload.read", write: "player.workload.plan",
                     anchors: { school: "(SELECT l.school_id FROM load_plan l WHERE l.id = load_plan_week.plan_id)",
                                team:   "(SELECT p.team_code FROM load_plan l JOIN player p ON p.id = l.player_id WHERE l.id = load_plan_week.plan_id)",
                                person: "(SELECT l.player_id FROM load_plan l WHERE l.id = load_plan_week.plan_id)" }, masked: {} },
pace_reading:      { read: "player.workload.read", write: "player.workload.write", anchors: viaPlayer("pace_reading"), masked: {} },
technique_review:  { read: "player.workload.read", write: "player.workload.plan",  anchors: viaPlayer("technique_review"),
                     masked: { "player.note.read": ["notes"] } },

wellness_checkin:  { read: "wellness.read", write: "wellness.write", anchors: viaPlayer("wellness_checkin"), masked: {} },
wellness_flag:     { read: "wellness.read", write: "wellness.write", anchors: viaPlayer("wellness_flag"), masked: {} },
capacity_test:     { read: "wellness.read", write: "medical.write",  anchors: viaPlayer("capacity_test"), masked: {} },

wellness_share:    { read: "wellness.share", write: "wellness.share", anchors: viaPlayer("wellness_share"),
                     // the guardian it names, and the boy it is about, may read the share row itself
                     visibleWhen: "wellness_share_is_mine(wellness_share.id) OR is_family_of(wellness_share.player_id)",
                     masked: {} },
health_monitoring_consent: /* hand-written, as public_name_consent is: no INSERT/UPDATE policy, written only by its function */
```

Hand-written beside the generated policies, in the migration:

- **Consent gate** (§7): `BEFORE INSERT` trigger on every table above except the two vocabularies and the consent table, refusing unless `health_consent_live(player_id)`.
- **Consent on read** (§7): a `RESTRICTIVE` `SELECT` policy on the same tables: `health_consent_live(player_id) OR is_family_of(player_id)`.
- **Support** (§6.5): a `RESTRICTIVE` `SELECT` policy on `wellness_checkin`, `wellness_flag`, `capacity_test`, `wellness_share`: `app_support_access_id(school_id) IS NULL`.
- **Self-only writes**: the triggers on `load_entry` (`recorded_as`), `wellness_checkin` and `wellness_flag` (raise) described in §1.3 and §3.

### 6.3 The parent share, as a recorded act: `wellness_share`

**Plain words.** The physio or the coach decides a parent should see something — a run of check-ins, the load chart for the term, a test result. They choose *what* (which kinds of record), *for which dates*, *for whom* (a verified guardian of this child, chosen from the child's links; never an email address), *for how long the parent may open it* (up to 30 days), and *why* (a sentence). That is one row. The parent is told through a notice, opens it, and every opening is on the school's access log with the share's id. The sharer, or anyone holding `wellness.share` at the school, may revoke it. It is not a permission: when it lapses or is revoked the parent sees nothing again, and the school can answer "what did this parent see about their son, and who decided" from two tables.

```
wellness_share (
  id            uuid PK,
  school_id, player_id,
  shared_by     uuid NOT NULL → app_user, shared_at timestamptz NOT NULL DEFAULT now(),
  with_link_id  uuid NOT NULL,                                    -- a verified, consented guardian link for this child
  what          text[] NOT NULL CHECK (what <@ '{load,checkins,flags,tests,reviews,pace,limits,plan}' AND cardinality(what) > 0),
  from_on       date NOT NULL, to_on date NOT NULL CHECK (to_on >= from_on AND to_on <= sa_today()),
  open_until    timestamptz NOT NULL CHECK (open_until <= shared_at + interval '30 days'),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),     -- as support_access.reason
  revoked_at, revoked_by,
  FOREIGN KEY (with_link_id, player_id) REFERENCES assignment_subject (id, player_id)
)
```

- **Opening it:** `wellness_share_open(p_share)` is `SECURITY DEFINER`. It checks the caller is the person on `with_link_id`'s assignment, holds `wellness.shared.read`, the share is live (`revoked_at IS NULL AND now() < open_until`), then returns only the record kinds in `what` between `from_on` and `to_on` — `technique_review.notes` **never**, whatever `what` says — and calls `log_restricted_read('wellness_share', ARRAY[p_share], what, school_id)` so the row lands in `access_log` (`db/22`'s signature). A parent reads through this function or not at all: `guardian` holds none of `wellness.read` or `player.workload.read`.
- **Telling the parent:** an `AFTER INSERT` trigger writes a `notification`: `scope_level = 'school'`, `team_code NULL`, `kind = 'welfare'`, `required_capability = 'wellness.shared.read'`, `subject_kind = 'welfare'`, `subject_person_id` = the child, body: "The school has shared something about your child's training with you. Open his page to read it." Only that child's guardians and the boy himself hold that capability *and* have him in their subject list, so nobody else receives it. The push payload is the usual pointer.
- **The boy sees it.** `selfaccess` holds `wellness.shared.read` and the share row is visible to him, so he knows what was shared about him and with whom. That is the POPIA right of access applied to the disclosure itself.

*Rejected — a time-boxed `enquiry`-style assignment granting the guardian `wellness.read`:* for its hour or its week it *is* a standing permission, and it records who, not what.
*Rejected — an exported PDF or an email:* it leaves the platform and the log.
*Rejected — a permanent "parents may see wellness" switch per school or per child:* Kameel's decision is that it is an act, not a permission, each time.

### 6.4 What the bowler reads of his own

Through `selfaccess` (named to himself in `assignment_subject`): every `load_entry`, `load_day`, `load_summary()` and `load_weeks()` row about him; his `athlete_limit` and `load_plan` with their sources; his `wellness_checkin` and `wellness_flag` rows and their outcomes; his `capacity_test` results; his `technique_review` answers *without* the coach's `notes`; his `pace_reading`s; every `wellness_share` made about him; and his `injury` rows at every tier, as today. That is the data-subject's right of access, and the one thing kept from him — a coach's candid prose — follows the line `player.note.read` already draws and gives the same reason.

### 6.5 Separation from team-mates, and from support

- **Team-mates.** `player` holds none of the six new capabilities and not `player.workload.read`. Every new table anchors `person` on `player_id`, and `selfaccess` is subject-scoped (`SUBJECT_SCOPED_ROLES`), so a boy's own assignment reaches his row and no other. `packages/policy/test/separation.test.mjs` gains the assertion: no capability in `wellness.*` or `player.workload.*` is held by `player`, `spectator`, `analyst`, `scorer`, `official`, `media`, `scout` or `enquiry`. `db/99`'s new section proves it live: a pupil signed in as `player` on the same side reads zero rows of every new table and receives no `welfare` notice about a team-mate.
- **Support access** (`db/22`). `support_access_begin()` grants one real role at one school for at most four hours, and every read under it is stamped with `support_access_id`. Under this design a support session as `coach` could read a squad's load entries, limits and plans — level 2, and on the record — which is acceptable and logged. It **cannot** read check-ins, flags, capacity tests or shares: the `RESTRICTIVE` policy in §6.2 makes them invisible under any support session, whatever role it borrowed. No support ticket needs a fourteen-year-old's soreness map; if one ever does, the school appoints a real `medical` assignment for a named person, which is the door the schema already has.
  *Rejected — allow with logging:* logging is for reads that were legitimate and must be answerable; this read has no legitimate ticket.

---

## 7 · Consent

### 7.1 Plain words

Two consents already exist and are not enough on their own:

- the **guardian-link consent** (`assignment_subject.consent_state`, versioned, shown as `player_guardian_status`) — the terms: the school may run the sport with this child's information at all;
- the **public-name consent** (`public_name_consent`, `db/47`) — a separate, optional opt-in with its own wording.

Health monitoring is a third, of the second kind: **optional, off by default, its own wording, given by a competent person, withdrawable in Settings, recorded and never deleted**. It is specific to a *purpose* — monitoring this child's training load and wellbeing to help keep him on the park — and everything collected for that purpose is under it, including the nets delivery count, which on its own looks like attendance but is being collected for a health purpose (**Q5** offers the split and recommends against it).

Without it: nothing new about the child is written or read. Match overs, spells, the age-band breaches and the existing `workload()` screen carry on exactly as today, because they exist for the directive and were never under this consent. "The overs stay as public as a scorecard is."

### 7.2 The record: `health_monitoring_consent`

The same shape as `public_name_consent`, column for column, so the Settings screen, the office's admission-form path and the "latest record governs" reading are one pattern:

```
health_monitoring_consent (
  id, seq bigint IDENTITY UNIQUE,
  player_id → player,
  given_by  text CHECK (given_by IN ('guardian','self')),          -- 'self' rather than db/47's 'pupil': an adult club athlete is not a pupil
  giver_assignment_id, giver_link_id  → assignment_subject (assignment_id, player_id, id),
  version text, given_on date, ended_on date,
  end_reason CHECK IN ('withdrawn','superseded','refused'),
  form_name, form_date,
  recorded_by, recorded_at, ended_by, ended_at,
  … the same CHECKs as db/47
)
UNIQUE INDEX one_open ON health_monitoring_consent (player_id, giver_link_id) WHERE ended_on IS NULL
```

No `INSERT`/`UPDATE`/`DELETE` policy and the privileges revoked from `scrbrd_app`; the only door is `health_monitoring_consent_set(p_player, p_yes, p_version, p_guardian, p_form_name, p_form_date)`, which mirrors `public_name_consent_set()`: a verified, consented guardian link; the athlete himself from his eighteenth birthday; the office under `guardian.link.manage` naming the form and its date; a guardian's consent given on or after the eighteenth birthday refused.

`health_consent_live(p_player) RETURNS boolean`, `STABLE SECURITY DEFINER`, is the one function every gate calls:

```
the latest open record for the player, by seq, is a 'yes'
AND NOT (given_by = 'guardian' AND majority_on(player.born) <= sa_today())     -- §7.4
AND (given_by = 'guardian' OR player.born IS NOT NULL)
```

### 7.3 How it gates

- **Collection.** Every `BEFORE INSERT` trigger in §6.2 calls it and raises `check_violation` with the message `no_health_consent`; the write handlers map that to `422 { error: "no_consent" }` as `workload-api.mjs` maps `23514`. The screens read `health_consent_live` through a `consents` resource and do not draw the check-in card or the record-a-session form at all when it is false — but the trigger is the authority, not the screen.
- **Reading.** The `RESTRICTIVE` policy in §6.2 hides every row whose player's consent is not live from every reader except the family (`is_family_of()`, `db/08`). `load_summary()`, `load_weeks()` and the re-emitted `workload()` return the existing match-derived figures for a boy without consent and `NULL` for every new one, and `workload()`'s `load_word` for him is `not monitored`.
- **The match overs** are not gated. `bowler_over`, `bowler_spell`, `bowling_breach` and the directive path are unchanged.

### 7.4 Withdrawal, and turning 18

**Withdrawal** is the Settings toggle: `health_monitoring_consent_set(…, false, …)` ends the open record with `withdrawn`. It takes effect on the next statement: collection stops (the trigger), staff reads stop (the policy), the boy still sees his own, and nothing is deleted. Retention of the now-unreadable rows is **Q4**: the recommendation is that they are deleted twelve months after withdrawal or after he leaves the school's roster, by a job the information officer signs off, and that the design ships with the rows kept and the job not yet written — deletion is the one act that cannot be audited afterwards, and it should not be decided in a schema comment.

**Eighteen.** The schema already ends guardianship at majority: `guardian_link_establish()` sets `assignment_subject.valid_until = majority_on(born)` (`db/08`), `db/10` corrected the links that predated that, and `app_can()` reads `valid_until` on every call. So a guardian's *access* ends on the birthday with no job behind it. This design applies the same rule to the guardian's *consent*: `health_consent_live()` treats a guardian's record as lapsed from `majority_on(born)`, derived on the day, not end-dated by a cron — the same way `PUBLIC_DATA.md §5a` has the database "work out he was 18 that day". The screen asks him, from that day, to give his own; until he does, collection pauses and staff reads stop, and the moment he says yes they resume over the whole history.

This is stricter than the public-name rule C6, under which the guardian's standing "yes" carries until he speaks. **Q7** flags the difference; the recommendation is to keep the stricter reading here, because a parent's consent to process an adult's health information is not a lawful basis, while a parent's consent to a name on a scorecard the adult can withdraw at will is a lesser thing.

**Born unknown.** A guardian link cannot exist without a date of birth (`guardian_link_establish()` refuses), so a guardian consent implies `born` is known. A `self` consent with `born IS NULL` is refused: the platform cannot know he is eighteen.

---

## 8 · Beyond schools

**What does not change** for a club, a province, an academy, a union (`school.kind` already carries all of them), or another sport:

- every table in §6 is keyed on `player`, `school` and `sport`, and none names an age band, a school year or an over;
- the words in §2 say *load*, not *overs*; the body map is a body, not a bowler;
- the consent is the same record, with `given_by = 'self'` for an adult;
- an adult's only ceiling is his `athlete_limit`; `bowling_directive_for()` already returns `NULL` for the Open band, and `bowling_ceiling_open` already refuses anything that is not `kind = 'school'`;
- a season label, where a screen wants one, comes from `season_for(date, level)` with the tenant's level.

**What changes, per sport:** one `load_unit` row per unit; one branch in `load_day`'s `match_units` union when the sport has a log to fold (cricket has `bowler_over`; a sport scored on the platform later adds its own); nothing else. `technique_review.discipline` is text so "bowling" is one value, not the column's name.

**What a tenant may need to switch:** whether the module is on at all. The whole feature sits behind a module switch in the existing `feature_flag` / `feature_enabled(key, school, person)` mechanism (key `workload_monitoring`), which can only narrow: a school that has not turned it on shows no check-in card and accepts no entry, and a switch never widens a read.

**What does not travel:** `bowling_breach`, `bowling_directive` and the school ceiling are cricket's regulatory layer and stay where they are. A rugby union's own directives, when they exist, are that sport's equivalent table, not a generalisation of this one.

---

## 9 · Phasing

Each phase is one migration, one policy change regenerated from `tables.mjs`, and a `db/99` section that proves the phase's claim live before anything is pasted to production (`docs/ARCHITECTURE.md §9`). The numbers assume `db/51` is the last shipped (`db/SHIPPED.sha256`) and nothing lands first; if it does, the numbers shift and nothing else.

| phase | migration | ships | proves (in `db/99` and a smoke walk) |
|---|---|---|---|
| **1 · Consent and the count** | `db/52` | `health_monitoring_consent` + `_set()` + `health_consent_live()`; the Settings toggle and the sign-up row (the SCRBRD-092 screen, whose public-name row exists); `load_unit`, `load_entry`, `load_day`; `load_summary()`, `load_weeks()`; `workload()` re-emitted; `player.workload.write`; `POST /api/load-entry`; the `load` and `loadWeeks` reads; the module key | an entry without consent is refused; withdrawal hides rows from a coach on the next statement and not from the boy; a coach and a bowler's entries for one session count once and the disagreement shows; a `match_elsewhere` entry on a scored day is marked; the EWMA word agrees with `workload()`'s thresholds on a constructed series; a `player` on the same side reads nothing; the existing workload screen is unchanged for a boy without consent |
| **2 · The voice** | `db/53` | `body_site`, `wellness_checkin`, `wellness_flag`, `wellness_flag_respond()`; `wellness.read`, `wellness.write`; `notification.subject_kind` gains `welfare`; `SUBJECT_KINDS` in `push-api.mjs`; the support `RESTRICTIVE` policies; the check-in and flag screens | a flag produces exactly one `notification` row and changes nothing in `injury`, `training_attendance`, `match_availability`; the coach and the physio receive it, the team-mate and the guardian do not; the push payload names nobody; a second tap does not make a second flag; a support session as `coach` reads zero check-ins |
| **3 · His own profile** | `db/54` | `athlete_limit`, `load_plan`, `load_plan_week`, `effective_limits()`; `player.workload.plan`; the limit-exceeded notice; the profile screen with the injury history joined through `injury_masked` | a personal limit tighter than the directive is the effective one and names its source; a looser one is refused; an Open-band club adult's only ceiling is his own; planned against actual per week; the profile shows the coach nature and dates and the physio notes, from one read |
| **4 · Tests, reviews, pace** | `db/55` | `capacity_test`, `technique_review`, `pace_reading`; `public.mjs` never-public list gains `technique_review.notes` | a coach reads the three answers and not the notes; the boy the same; the physio writes a test and a coach cannot; a pace reading is not readable under `player.performance.read` |
| **5 · The parent share** | `db/56` | `wellness_share`, `wellness_share_open()`, `wellness_share_is_mine()`; `wellness.share`, `wellness.shared.read`; the share notice; the share screen and the parent's page | a share is bounded to `what`, `from_on..to_on`, `open_until`; the parent's open lands in `access_log` with the share id; the notes never travel whatever `what` says; revocation and expiry each close it on the next statement; a guardian of a different child receives no notice; the boy sees the share row |

Phase 5 could move ahead of 3 and 4 if the first flags show that physios need to tell parents sooner than they can phone them. Phase 1 must be first: it holds the consent that every later table's trigger calls.

Each phase's `tables.mjs` entries regenerate `db/09`'s successor policies into the phase's own file (the generator emits only the new tables; `db/01` and `db/09` stay as shipped). Each new capability is one `ADDED_SINCE_01` line. `tools/hooks/guard.mjs`'s `FROZEN_THROUGH` moves after each paste.

---

## 10 · Open questions for Kameel

Each with the recommendation the design assumes.

| # | question | recommendation |
|---|---|---|
| **Q1** | When the coach's group entry and the bowler's own entry disagree, whose figure does the day total use? | **The bowler's**, with the disagreement shown to the coach (§1.3). Taking the larger hides the disagreement and rewards inflation; taking the coach's makes the boy's voice decorative. One line in a view either way. |
| **Q2** | Does the director of sport read check-ins and flags (`wellness.read`)? The backlog names the physio and the coach. | **No.** He keeps `player.workload.read` (the load tier) as today. Widening a level-3 read to leadership is the decision ADR 0002 declined for the clinical tier. |
| **Q3** | Is a strength-and-conditioning coach `medical` (writes tests, reads the physio's notes) or `coach` (reads tests, writes none)? | **`medical`** when they write tests, under ADR 0003. If schools want "writes tests, cannot read the clinical notes", that is a real data-access difference and a role, to be decided then. |
| **Q4** | How long are rows kept after consent is withdrawn or the boy leaves? | **Twelve months, then deleted by a job the information officer signs off.** Ship with rows kept and unreadable; write the job when the officer confirms. |
| **Q5** | Does the nets delivery count sit under the health consent, or under the ordinary processing consent like attendance does? | **Under the health consent.** It is collected for a health purpose, and POPIA consent is specific to purpose. The cost is that an unconsented boy has no nets count; the alternative is two gates and a screen that half-works. |
| **Q6** | May a coach record a check-in on behalf of a bowler with no phone? | **No.** The check-in is his statement or it is nothing; a coach's observation belongs in `development_note`. Schools can lend a tablet at training. |
| **Q7** | At 18, does a guardian's health consent lapse (this design) or stand until he speaks (the public-name rule C6)? | **Lapse.** A parent's consent to process an adult's health information is not a lawful basis. Collection pauses until he says yes; nothing is lost. |
| **Q8** | Should exceeding a *personal* limit be written as a `bowling_breach` row, like a directive breach? | **No.** A notice and a line on his profile. The breach table is the regulatory record and is on the never-public list as one thing. |
| **Q9** | Should a match day carry an intensity? A bowler could add an RPE for a match through a `load_entry` with no units. | **Not in phase 1.** Deliveries are the primary measure for cricket; add it if physios ask once check-ins exist. |
| **Q10** | The share window: 30 days maximum, and a default of 14? | **Yes.** Long enough to read at the weekend, short enough that it is plainly not a permission. |
| **Q11** | Should an open flag hide him from selection screens or mark him unavailable? | **No, never.** That would make the tap a cost to the boy, and he would stop tapping. It tells two adults; they decide. |
| **Q12** | Who reads the *fact* that a share happened, beyond the sharer, the parent and the boy? | **Anyone holding `wellness.share` at the school** (the coaches and the physio), so a physio can see the coach already told the parent. Not the office. |

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `ball_event`, `ball_event_live` | `db/02_schema_scoring.sql` | the only match truth |
| `bowler_over` (`deliveries`, `legal_balls`, `bowled_on`), `bowler_spell` | `db/08_schema_programme.sql` ~5190–5240 | match load, wides and no-balls included |
| `bowling_directive`, `bowling_ceiling_open`, `bowling_directive_for()` | `db/08` ~5130–5185 | one input to `effective_limits()` |
| `bowling_breach`, `bowling_breach_watch()` | `db/08` ~5258–5340 | unchanged; the regulatory record |
| `workload()` | `db/08` ~5361 | re-emitted with new columns, old ones kept |
| `sa_today()`, `age_band()`, `season_for()` | `db/08` | day boundaries, bands, season labels |
| `training_session`, `training_attendance` | `db/08` 146–178 | pre-filling the group entry; minutes |
| `notification`, `notification_read` | `db/08` 220–288 | the flag, the limit and the share notices |
| `fanOut()`, `buildPayload()`, `SUBJECT_KINDS` | `services/api/notify/push-api.mjs` | push delivery; pointer payload |
| `injury`, `injury_masked` | `db/00_schema_core.sql` 163; generated | history at the reader's tier |
| `access_log`, `log_restricted_read()` | `db/08` 526; `db/22` 218 | the parent's opens on the record |
| `support_access`, `app_support_access_id()` | `db/22_support_access.sql` | the restrictive policy in §6.5 |
| `assignment_subject`, `majority_on()`, `guardian_link_establish()`, `is_family_of()`, `player_guardian_status` | `db/00` 523; `db/08` 885, 889, 1279; `db/10` | consent givers; guardianship ends at 18 |
| `public_name_consent`, `public_name_consent_set()` | `db/47_public_data.sql` 197, 332 | the consent record's shape |
| `feature_flag`, `feature_enabled()` | `db/08` 2326, 2494 | the module switch |
| `school.kind`, `sport` | `db/00` 28, 227 | tenants beyond schools; sport neutrality |
| `rulebook_clause` | `db/32_rulebook_clause.sql` | the clause beside a directive limit |
| `CAPABILITIES`, `LEVEL`, `SENSITIVE` | `packages/policy/src/capabilities.mjs` | six new names, levelled |
| `ROLE_CAPABILITIES`, `SUBJECT_SCOPED_ROLES` | `packages/policy/src/roles.mjs` | who holds what; selfaccess is subject-scoped |
| `TABLES`, `maskedColumns()` | `packages/policy/src/tables.mjs` | the entries in §6.2 |
| never-public list | `packages/policy/src/public.mjs` | `technique_review.notes` |
| `ADDED_SINCE_01`, `WITHDRAWN_SINCE_01` | `services/api/rls/generate-rls.mjs` | new capabilities after go-live |
| `workloadRoutes()` | `services/api/write/workload-api.mjs` | the pattern for `load-api.mjs` |
| `workload` read resource | `services/api/read/read-api.mjs` ~1252 | the pattern for `load`, `loadWeeks` |
| `withPrincipal()`, `Idempotency-Key` | `services/api/server.mjs`; `db/15` | every write |
| `InjuryView.jsx` | `apps/web/src/views/` | today's injury screen: list, KPI cards, `withheld()` for masked fields; the profile's injury panel reuses its rows |
| ADR 0001, 0002, 0003 | `docs/adr/` | one assignment decides; coach's overview; no new roles |
| `PUBLIC_DATA.md` §3, §5a, C6 | `docs/policy/` | never public; breaches; the 18 rule this design departs from |
