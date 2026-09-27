# SCRBRD-110 — Fast-bowler workload, individually: the design

**Status:** for Kameel's review, 2026-09-27, revised the same day to carry his decisions (§10). Nothing here is built.
**Source:** `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`, SCRBRD-110 (the decisions and Vincent Barnes' case) and SCRBRD-092 (the consent at sign-up).
**Reader:** the product owner first, then whoever builds it. Plain words come first in each section; the schema and policy detail follow. The body is written to Kameel's decisions; a builder need not read §10 to correct it.

---

## 0 · What this is, in one page

Vincent Barnes' case is that a fast bowler gets hurt less from *how much* he bowls than from sudden jumps after little bowling, from intensity, from poor recovery, and from an old injury. The platform already counts a boy's match overs from the ball log (`bowler_over`, `bowler_spell`, `workload()` in `db/08_schema_programme.sql`), compares them to the age-band directive (`bowling_directive`, `bowling_directive_for()`), writes a breach down as a fact (`bowling_breach`) and tells the coach. That is the regulator's question: did he bowl too many overs on Saturday. This design answers the physio's question: is *this* boy's load, taken as a whole, moving in a way worth a conversation.

It adds five things, in the order they will be built:

1. **Every delivery, nets included.** A sport-neutral load record (a session, a quantity, an effort, some minutes). Cricket's unit is the delivery. Match deliveries keep coming from the ball log, wides and no-balls included, exact, and are never typed in again. Nets and training are **an estimate, entered as a band** (under 12 / 12–24 / 24–36 / 36+ deliveries) with an effort; the bowler's own band counts when he entered one, the coach's otherwise, and nobody's figure is set against anybody else's.
2. **The windows and the word.** 7, 14, 28 and 42 days; this week against last; a rolling ratio of recent load to habitual load (an exponentially weighted one, not the coupled 7:28 the current `workload()` uses); the gaps between bowling days; a 3–6-month trend; and a comparison against *his own* baseline. All derived at read time, nothing stored. The word beside the number is a fixed vocabulary and is never a diagnosis; where a band is inside the figure, the screen says "estimate".
3. **The bowler's voice.** A daily check-in (sleep, fatigue, soreness on a body map) and one tap: "something doesn't feel right." He records it himself, on his phone or in the browser; a boy with no phone may have his parent record it for him, labelled as hers, and he sees it when he next signs in. A coach never records one. The tap tells his coach and the physio through the existing notification path. It never marks him injured, never touches selection or availability, and never shows on a team screen. The director of sport may read check-ins and flags when he asks for them, on the access log; he is not alerted, but a coach or the physio may refer a flag to him.
4. **His own profile.** Guidelines set for him by the physio or coach that sit *beside* the age directive, not under it. Passing a guideline writes a line on his profile and nothing else — no breach row, no notice. His injury history is read alongside at the reader's own tier; an optional preseason ramp is read against his actuals.
5. **Capacity tests, technique reviews and pace readings**, each at the tier its sensitivity earns; and a **fitness** role for the strength-and-conditioning coach, who writes and reads the tests, reads the load and the check-ins, and does not read the physio's notes. That is the one exception ADR 0003 allows, and it is recorded there.

Around all of it: **consent, in two layers.** The nets count and a speed-gun reading are ordinary processing, like attendance, under the guardian-link consent the school already holds. Check-ins, flags, tests, reviews, personal guidelines and plans are a child's health information, POPIA special personal information, under a **separate, unbundled health consent** from a competent person that gates every one of those tables for collection and for reading. Without it the platform collects nothing about his body, and the match overs stay exactly as public as a scorecard is. **Reading** follows the existing capability model: the physio, the coach and the fitness coach read; the director of sport reads on request, logged; the bowler reads his own; a parent reads only what a named adult chose to share with her, as a recorded, bounded act; a team-mate reads nothing. After consent ends or he leaves the school, his health rows are hidden for twelve months and then deleted by a job the information officer signs off.

At eighteen, while he is still at school, his parent's consent and her access carry on; the app asks him once, and collection stops only if he declines. That needs the guardian link to outlive his birthday while he is a pupil — one change, in §7.4, that the public-pages design (SCRBRD-083 §6, option C, decided) relies on too.

Nothing is hard-wired to school age bands or to cricket. The age band is one input to a guideline. "Delivery" is one row in a unit vocabulary. Smart health devices (SCRBRD-111) and keeping the record for his whole school career (SCRBRD-112) are later items; this design leaves a seam for the first and names the second, and designs neither.

---

## 1 · The load model

### 1.1 Plain words

A load record answers: *who*, *on which day*, *how much*, *how hard*, *for how long*, *at which session*, and *who says so*. That is the same shape for a cricket bowler at nets, a hockey goalkeeper's drag-flick drill and a rugby prop's scrum session, so the record is sport-neutral and the sport decides what a "unit" is.

Match deliveries are already in the ball log. `bowler_over` counts them per bowler per over, dated by the fixture's day in South African time, and its `deliveries` column already includes wides and no-balls (`legal_balls` is the six-a-side count). The load model reads that view; it does not copy it. Nothing about a match is typed in twice, and the match figure is exact.

Nets and training are not in any log, so they are recorded — **as an estimate.** Kameel's decision: "we're not trying to be 100% accurate on how many balls are bowled in the nets." So a nets or training entry is a **band** — under 12, 12–24, 24–36, 36 or more deliveries — with an effort (low, medium, high) and, if known, the minutes. The windows read a band at its midpoint (6, 18, 30, 42) and say so. Two people may record the same session — the coach for the group, the bowler for himself. One figure is used per session: **the bowler's own band when he entered one, the coach's otherwise.** There is no disagreement flag and no reconciliation screen: two estimates of the same net are not evidence against each other.

### 1.2 The unit vocabulary

A small reference table, platform-owned like `sport` and `bowling_directive`:

| `code` | `label` | `sport_code` | notes |
|---|---|---|---|
| `delivery` | Deliveries | `cricket` | the one shipped in phase 1 |

Another sport adds rows, not columns. A unit belongs to a sport so the screen can say "deliveries" or "throws" rather than "units". The words the summary produces (§2) never name the unit; they say "load".

The bands are the same for every unit in phase 1 — a fixed vocabulary in the CHECK, not a table: `lt12`, `12_24`, `24_36`, `36plus`, read at 6, 18, 30 and 42. If a second sport needs different edges, the bands move to a `load_band` table keyed on `unit_code`; that is a later migration and nothing in the views cares where the midpoint comes from.

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
  band                text CHECK (band IN ('lt12','12_24','24_36','36plus')),   -- nets and training: the estimate
  units               integer CHECK (units BETWEEN 0 AND 1000),                 -- match_elsewhere only: the scorebook's exact count
  rpe                 smallint CHECK (rpe BETWEEN 1 AND 10),   -- effort: the three buttons write 3, 6, 9
  minutes             smallint CHECK (minutes BETWEEN 1 AND 600),
  recorded_by         uuid NOT NULL → app_user,          -- set by trigger, never passed in
  recorded_as         text NOT NULL CHECK (recorded_as IN ('self','staff')),  -- set by trigger; 'device' joins here under SCRBRD-111
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  supersedes          uuid → load_entry,
  CHECK ((kind IN ('nets','training') AND band IS NOT NULL AND units IS NULL)
      OR (kind = 'match_elsewhere'   AND units IS NOT NULL AND band IS NULL))
)
```

**Decisions, and what was rejected:**

- **Nets and training carry a band, never a count.** The screen offers four buttons and the table refuses a number for those kinds, so nobody can be asked to count. The midpoint is applied in the view (`load_band_units(band)`, an `IMMUTABLE` function: 6, 18, 30, 42), not stored, so a change of edges is a change of one function.
  *Rejected — a free count with the band as a screen convenience:* the stored number would look exact and be read as exact.
  *Rejected — a band for `match_elsewhere` too:* a match scored on paper has a scorebook, and the count is knowable. The exact figure is kept for the one kind that has one.
- **`kind` never includes `match`.** A match scored on SCRBRD is in `ball_event` and is derived. `match_elsewhere` exists for the game that was scored on paper at a ground the platform does not host; the day view marks a `match_elsewhere` entry on a day where `bowler_over` already has rows for that bowler as *possibly counted twice*, and a person decides. It does not refuse the row: the log records what happened, and the alternative — silently dropping one — is the invisible error `db/08`'s workload section warns about.
  *Rejected:* storing match deliveries as `load_entry` rows written by a trigger on `ball_event`. It duplicates the truth and breaks the moment a ball is voided or quarantined; the existing views already fold correctly.
- **One effort scale, `rpe` 1–10, three words on the screen.** The phase-1 screen offers low, medium, high and writes 3, 6, 9; there is no numeric option, because an estimate does not need one. The column keeps the 1–10 range so a sport that uses a numeric RPE needs no schema change.
  *Rejected:* separate `intensity_word` and `effort_score` columns — two ways to say one thing, and the summary would have to reconcile them.
- **Session-RPE load** (`rpe × minutes`, the arbitrary-units measure used across sports) is *derived* in the day view when both are present. Cricket's windows run on deliveries because that is what the bowling literature counts; the AU figure is shown beside and becomes the primary measure only for a sport with no unit yet.
  *Rejected:* inventing minutes or RPE for a match from its over count. Nothing that was not recorded is counted.
- **No free text.** A note about a boy's body belongs in the injury record or a check-in, under the tier those carry. An entry is numbers, a band and references.
- **Who recorded it is derived, not declared.** A `BEFORE INSERT` trigger sets `recorded_by = app_user_id()` and `recorded_as = 'self'` when the caller holds a live `selfaccess` assignment naming this player, `'staff'` otherwise. The browser never says which it is. A guardian does not write load entries (she may write a check-in for him, §3.2; the nets count is the coach's or his).

**One figure per session.** The day view groups entries by `(player_id, on_date, coalesce(training_session_id, kind))`. Where a group holds a `self` chain, its last row is the session's figure; otherwise the `staff` chain's last row is. Nothing is compared, nothing is flagged, and the coach's screen does not show the boy's entry beside his own.

*Why the bowler's when both exist.* The coach's group entry is an estimate for everyone — "you all bowled about four overs" — and the bowler's is an estimate for himself. Both are estimates; his is closer. The design is meant to give him a voice, and taking his figure is the cheapest way to do that.
*Rejected — a disagreement flag (the earlier draft):* Kameel's decision is that the two figures are not to be set against each other. A flag would make an estimate into an accusation.
*Rejected — take the larger; average:* numbers nobody recorded, or a reward for rounding up.

### 1.4 How the pieces combine: `load_day`

A `security_invoker` view, one row per player per day:

```
load_day: player_id, school_id, sport_code, on_date,
          match_units      -- sum(bowler_over.deliveries) for cricket, per bowled_on; exact
          entered_units    -- one figure per session (§1.3): the band's midpoint, or the match_elsewhere count
          units            -- match_units + entered_units
          estimated        -- true when entered_units includes any band
          minutes, au      -- from entries only
          sessions         -- distinct groups
          possibly_doubled -- a match_elsewhere entry on a day with match rows
```

Match units are a `UNION` of per-sport derived sources; cricket contributes `bowler_over`. A second sport adds a branch when it has a log to fold. Every downstream figure in §2 is computed from `load_day`, so the rule "nothing counted is stored" is kept by construction: there is no table to drift. Every window in §2 carries `estimated` forward: a window with any band inside it is shown with the word "estimate" and the exact match share beside it.

### 1.5 The write route

`POST /api/load-entry` in a new `services/api/write/load-api.mjs`, beside `workload-api.mjs`, under `withPrincipal()` and an `Idempotency-Key` (`db/15`). Two shapes:

- **the group:** `{ trainingSessionId, entries: [{ playerId, band, rpe?, minutes? }] }` — one transaction, one row per player, `recorded_as = 'staff'`; the screen pre-fills the list from `training_attendance` for that session and offers "same for everyone" so a coach can set one band for the group and adjust two boys;
- **the self:** `{ playerId, kind, onDate, band | units, rpe?, minutes?, trainingSessionId? }` — refused by RLS unless the caller is that player's `selfaccess`; `units` accepted only with `kind = 'match_elsewhere'`.

The handler contains no authorization of its own. RLS decides. **There is no health-consent gate on this table** (§7.1): the nets count is ordinary processing under the guardian-link consent, as attendance is, so a boy whose parents have not opted into health monitoring still has a nets count and a load chart. What he does not have is a check-in card.

---

## 2 · The windows and the signal

### 2.1 Plain words

Everything a screen shows about load is worked out when it is asked for, from `load_day`. Nothing is stored. That is the house rule for the score and it is the house rule here, for the same reason: a voided ball, a superseded entry or a withdrawn consent changes the answer immediately and everywhere.

The screen shows, for one bowler:

| measure | what it is |
|---|---|
| **7 / 14 / 28 / 42 days** | units in each trailing window, ending today (SA time); "estimate" when a band is inside it, with the exact match share |
| **week to week** | this 7 days against the 7 before, as a percentage |
| **recent against habitual** | an exponentially weighted moving average ratio (§2.2). One word beside it. |
| **uncoupled ratio** | this 7 days against the mean of the 3 preceding weeks, as a number for those who know it |
| **gaps** | days since he last bowled; the longest gap in 42 days; his usual gap in 28 |
| **trend** | 26 weekly totals for the chart, with 13-week and 26-week means |
| **against his baseline** | this week against his own habitual week (§2.4), with a word |
| **against his plan** | when a ramp exists (§4.4), planned against actual per week |
| **against his guidelines** | the days in 28 on which he passed a personal guideline (§4.2), as a line, nothing more |

### 2.2 The ratio: EWMA, not coupled 7:28

The current `workload()` divides this week by a quarter of the last four weeks. The acute week is *inside* the chronic month, which pulls the ratio toward 1 arithmetically and makes a single big day look smaller than it was. The literature Kameel's note refers to moved on for that reason.

**Decided:** the word comes from an **EWMA ratio**. Two exponentially weighted averages over the daily series (zero-padded), acute with λ = 2/(7+1), chronic with λ = 2/(28+1); the ratio is acute over chronic. It weights yesterday more than three weeks ago, and it handles a fortnight off correctly — the chronic average decays rather than the boy "disappearing" from a window. The **uncoupled 7:21** ratio is shown as a second number. The coupled figure is dropped from the screen; the `acwr` column stays on `workload()` for the existing read (`read-api.mjs`, resource `workload`) until that screen moves.

Bands feed the EWMA at their midpoints. A ratio built on estimates is an estimate, and the screen says so; the thresholds below are wide enough (0.8–1.2 is "steady") that a band's error of ±6 deliveries in a week of 60 does not move a boy across a word on its own.

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

- `load_summary(p_player uuid)` — one row: the windows with their `estimated` marks, the ratios, the gaps, the baseline and its deviation, the words, `possibly_doubled_7d`, and (§4.2) `over_guideline_28d`. The EWMA is a recursive CTE over the last 90 days of `load_day`.
- `load_weeks(p_player uuid, p_weeks int DEFAULT 26)` — one row per ISO week (SA time): `units`, `estimated`, `sessions`, `minutes`, `au`, `planned_units` (§4.4), `match_units`, `entered_units`.

`workload()` itself is re-emitted in the same migration (as `db/23` re-emitted the decision functions) to add `units_7d`, `units_28d`, `estimated_7d`, `ewma_ratio` and `load_word` to its team row, so the coach's list can sort by the new word without a second call. Phase 2 re-emits it once more to add `open_flag` (§3.3). Its old columns and its order (breaches first) do not change.

Read routes: `load` (`load_summary`) and `loadWeeks` (`load_weeks`) in `services/api/read/read-api.mjs`, following the `workload` entry's pattern. The client draws charts and never computes a window. These are level-2 reads and are not logged; the level-3 reads in §3 are.

### 2.4 One bowler's baseline

**Decided:** his baseline is the **median of his weekly totals for the 12 weeks ending two weeks ago** (weeks 3–14 back), and it exists only when at least 6 of those weeks had any load. Deviation is this week against it, with the same words as §2.2. When no baseline exists the screen says "no baseline yet — about N more weeks", never a number.

*Why exclude the two most recent weeks:* otherwise a spike raises its own baseline.
*Why the median:* one huge festival week should not become his "usual".
*Rejected — a season average:* a preseason ramp and a mid-season week are not the same "usual".
*Rejected — a stored baseline the physio sets:* that is a guideline (§4.2), a different thing, and it would be the one number on the screen that does not update itself.

---

## 3 · The bowler's voice

### 3.1 Plain words

Two things, both his — or, when he has no phone, recorded for him by his parent and labelled so.

**The daily check-in** takes thirty seconds: how he slept, how tired he is, whether anything is sore and where. One a day. It is health information at the third tier (candid, about his body), read by the physio, the fitness coach and the coach of his current side, by the director of sport when he asks, and by him. Every staff read of it is on the access log.

**"Something doesn't feel right"** is one tap. It opens a *flag*: his coach and the physio are told through the notification path that already exists, and one of them records that they have spoken to him and what came of it. Either of them may **refer** the flag to the director of sport, who is otherwise not told. It **never** marks him injured, never changes his attendance status, never changes his availability or his place on a selection screen, and never appears on any screen a team-mate can open. If it turns out to be an injury, the physio records one in `injury` as they would have anyway, and the flag's outcome points at it — the flag does not create it.

**Who records it.** He does, on his phone or in the browser. A boy without a phone may have his parent record the check-in for him; the row says "recorded by his mother", he sees it the next time he signs in, and the flag works the same way. A coach never records either: a coach's observation of a boy belongs in `development_note` under `player.note.*`, in the coach's own name.

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
  recorded_by    uuid NOT NULL → app_user,              -- set by the function, never passed in
  recorded_as    text NOT NULL CHECK (recorded_as IN ('self','guardian')),   -- set by the function; 'device' joins here under SCRBRD-111
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, on_date)
)
body_site (code text PK, label text, region text)       -- ~24 sport-neutral sites: lower_back, l_shoulder, r_shoulder, l_knee, …
```

**Decisions:**
- Fields are the three Barnes names — sleep, soreness, fatigue — and no more. No mood, no menstrual field, no free text. Data minimisation is the rule; anything more is a later, separate decision with its own consent wording.
- Body map sites are a closed vocabulary, so a screen can show a silhouette and so nothing typed about a child's body sits in a text column.
- One per day, no editing: a second submission the same day replaces the first — the one place a row is updated, because "how I feel today" is one fact per day, not a log. When his parent recorded it and he then records it himself, his replaces hers and the label changes to `self`.
- **Written through one function, not a direct insert.** `wellness_checkin_set(p_player, p_on_date, p_sleep_quality, p_sleep_hours, p_fatigue, p_soreness, p_sore_sites)` is `SECURITY DEFINER`. It requires the caller to hold `wellness.write` over that player — which only `selfaccess` (himself) and `guardian` (his own parent, through her subject-scoped link) do — sets `recorded_by` and `recorded_as` from which of the two the caller is, checks the health consent (§7), and does the upsert. A coach, a physio, an office user or a support session has no route to it. The function rather than a bare `INSERT … ON CONFLICT` because an upsert under RLS needs a `SELECT` policy for the conflict row, and a parent has no read here (§6.1); the function sidesteps that and puts the who-recorded-it rule in one place.
- **The label is shown wherever the check-in is shown.** His own screen: "recorded by your mother, Tuesday". The physio's: the same. The parent sees the confirmation and nothing else back (§6.1; Q15 in §10 asks whether she should see her own entries again).

### 3.3 The flag: `wellness_flag`

```
wellness_flag (
  id             uuid PK,
  school_id      uuid NOT NULL → school,
  player_id      uuid NOT NULL → player,
  raised_at      timestamptz NOT NULL DEFAULT now(),
  raised_by      uuid NOT NULL → app_user,              -- set by the function
  raised_as      text NOT NULL CHECK (raised_as IN ('self','guardian')),
  site           text → body_site,                      -- optional single tap on the map
  acknowledged_at timestamptz, acknowledged_by uuid → app_user,
  referred_to    uuid → app_user, referred_by uuid → app_user, referred_at timestamptz,   -- the director of sport, §3.4
  closed_at      timestamptz, closed_by uuid → app_user,
  outcome        text CHECK (outcome IN ('spoke_to_him','referred_to_physio','rest_agreed','load_adjusted','injury_recorded','no_action')),
  injury_id      uuid → injury                          -- only with outcome = 'injury_recorded'
)
UNIQUE INDEX one_open_flag ON wellness_flag (player_id) WHERE closed_at IS NULL
```

Raised through `wellness_flag_raise(p_player, p_site)`, `SECURITY DEFINER`, with the same caller rule as the check-in: `wellness.write` over the player, so himself or his parent, labelled.

**Who is told, and how.** An `AFTER INSERT` trigger, `SECURITY DEFINER` like `bowling_breach_watch()`, inserts one `notification` row:

| column | value |
|---|---|
| `school_id`, `team_code` | his school, his current `player.team_code` |
| `scope_level` | `team` |
| `kind` | `welfare` (already used by the breach notice) |
| `urgency` | `high` |
| `required_capability` | **`wellness.alert`** (new, §6.1) |
| `subject_kind` | **`welfare`** (new value; see below) |
| `subject_person_id` | him |
| `title` / `body` | "A bowler has asked to be checked" / "{full_name} says something doesn't feel right. Please talk to him today. This is not an injury record." |

The generated `notification` policy demands `news.read` **and** the row's own capability in the same scope, so: his coach and assistant coach (team-scoped, hold `wellness.alert`) receive it; the physio (`medical`, school-scoped, holds `wellness.alert`) receives it; the director of sport (holds `wellness.read`, not `wellness.alert`) does not; the fitness coach (the same) does not; every team-mate (`player`) does not; his guardian does not; the office does not. Web push goes through `fanOut()` in `services/api/notify/push-api.mjs`, whose payload is a *pointer* carrying the notification id and nothing else, so no child's name reaches a phone's lock screen. This is the existing path; nothing new is invented for delivery.

*Why a capability of its own for being told.* `wellness.read` now includes two people Kameel does not want alerted — the director of sport, who reads on request, and the fitness coach. The notification table addresses a capability in a scope, so the recipient rule needs a name that only the coach, the assistant coach and the physio hold. `wellness.alert` is that name, and it also governs acting on a flag (below).

Two small changes it needs: `notification.subject_kind`'s CHECK (frozen in `db/08`) is dropped and re-added in the phase-2 migration with `'welfare'` in the list, and `SUBJECT_KINDS` in `push-api.mjs` gains the same word.

**What it never does — enforced, not promised:**
- It has no path to `injury`, `training_attendance`, `match_availability` or any selection table. The trigger writes one `notification` row and nothing else; a test asserts the row counts of those tables before and after a flag, and the selection screen's read (`team.select`) joins none of the wellness tables.
- `player` holds no capability that reads `wellness_flag`, and the row's anchors resolve through the player, so a team-scoped `player` assignment never reaches it even by accident of scope.
- `workload()`'s team list shows `open_flag` **only** to a reader who holds `wellness.alert` for that row (a per-row `app_can` inside the function), so the coach's list shows the dot and the director of sport's does not — he is not alerted, even by a dot.
- A second tap while one is open is not a second flag (the partial unique index); the screen says "the physio and your coach have been told".

**Responding.** `wellness_flag_respond(p_flag, p_action, p_outcome, p_injury)` is a `SECURITY DEFINER` function that requires `wellness.alert` over the row and refuses the subject himself and his parent. Acknowledging, referring and closing are the only updates the table takes.

### 3.4 The director of sport: reads on request, referred when asked

He holds `wellness.read` (§6.1), so he can open any bowler's check-ins and flags at his school. That is a level-3 read of a child's health information, and **every** read of these two tables — his, the physio's, the coach's, the fitness coach's — goes through the `checkins` and `flags` read resources, which call `log_restricted_read()` (`db/22`) with the rows returned, so the school can answer "who read this boy's check-ins" from `access_log`. The self-read is not logged; a boy reading his own words is not a disclosure.

He is not told when a flag is raised. **A coach or the physio may refer one to him:** `wellness_flag_refer(p_flag, p_to)`, under `wellness.alert`, sets `referred_to/by/at` on the flag and writes one `notification` addressed to him alone — `kind = 'welfare'`, `required_capability = 'wellness.read'`, `subject_kind = 'welfare'`, `subject_person_id` him, and **`recipient_id = p_to`**, a new nullable column on `notification` (phase 2) with a `RESTRICTIVE` policy `recipient_id IS NULL OR recipient_id = app_user_id()`, which `fanOut()` honours. `p_to` must hold `wellness.read` at the school, or the function refuses. The referral is on the flag row and in the notice, so it is recorded like a share: who sent what to whom, when.

*Rejected — a school-scoped `wellness.read` notice with no recipient:* it would reach the physio and the fitness coach as well, which is not a referral.
*Rejected — a pull-only "referred to you" list with no notice:* Kameel's words are that the act "sends him that flag"; a list he must remember to open does not. The recipient column is the smaller change and is useful again for the parent share (§6.3). Q17 in §10 confirms it.

---

## 4 · The individual profile

### 4.1 Plain words

One screen per bowler, read by the physio, the fitness coach, his coach and himself: his load (§2), his check-ins and flags (§3), the guidelines set for *him*, his injury history under the reader's own medical tier, his preseason plan against his actuals, and his tests, reviews and pace (§5).

### 4.2 Guidelines for one bowler: `athlete_limit`

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

The table is called a limit; the screen calls it a **guideline**, because that is what Kameel decided it is: a figure the physio or coach wrote down for this boy, which the platform shows and does not enforce.

**How it sits beside the directive.** A new function, `effective_limits(p_player)`, returns each figure with its source and its *kind* — `directive` or `guideline`:

| figure | inputs, tightest wins |
|---|---|
| overs per spell | `bowling_directive_for()` (age band, or the school's `bowling_ceiling_open`) · `athlete_limit.max_per_session ÷ 6` |
| overs / units per day | directive · `athlete_limit.max_per_day` |
| units per week | `athlete_limit.max_per_week` only |
| sessions per week | `athlete_limit.max_sessions_per_week` only |

The row names the source: "6 overs a spell — U15 directive, clause PACE-U15" (the clause via `rulebook_clause`, `db/32`, as `read-api.mjs` already joins it) or "4 overs a spell — guideline set by the physio on 1 Sep, returning from injury". **The directive is one input.** For an Open-band boy at a school with no ceiling, or for any adult at a club, the only figure is the one set for him — which is what "not hard-wired to age bands" means in practice.

*A guideline is never looser than the directive.* The trigger refuses an `athlete_limit` whose per-spell or per-day figure exceeds the directive for the boy's band that day. A coach may not write a permission slip; a guideline that says "more than the law" is not a guideline.

**When he passes a guideline — a line, nothing more.** The breach trigger on `ball_event` keeps its meaning — a regulatory directive, written as a fact, and a notice. A guideline passed (in a match, from `bowler_over`; or in a day or a week, from `load_day`) is **derived** in `load_summary()` as `over_guideline_28d`: the dates in the last 28 days on which a live guideline was passed, by how much, and which one. The profile shows those as one line under the guidelines panel ("passed his weekly guideline in 2 of the last 4 weeks"). Nothing is stored, no `notification` is written, and no `bowling_breach` row is written.
*Rejected — a notice (the earlier draft):* Kameel's decision. A guideline that pages the coach is a limit with a softer name.
*Rejected — a new `bowling_breach.kind = 'own'`:* it mixes a rule of the game with a clinician's plan; `PUBLIC_DATA.md §5a` lists "bowling-workload breaches" as one thing that is never public, and it should stay one thing.

Written under **`player.workload.plan`** (new, §6.1): the coach of his side and `medical`. Read under `player.workload.read`. Under the health consent (§7.1): a guideline is a judgement about his body.

### 4.3 The injury history

No new column. The profile read joins `injury` for `player_id` through the generated `injury_masked` view, so each reader sees exactly the tier they already hold: the coach sees nature and dates (ADR 0002), the physio sees notes, the boy sees his own record, a director of sport sees status and nature, the fitness coach sees what §5 gives him. `load_summary()` adds two derived fields under a per-row `medical.status.read` check: `days_since_last_injury` and `returning` (an `injury` row in `active` or `rehab` with `restricted`). An `athlete_limit` with `basis = 'returning_from_injury'` names the `injury_id`, so the guideline explains itself without prose.

### 4.4 The preseason ramp: `load_plan`

```
load_plan      (id, school_id, player_id, unit_code, title, starts_on date, weeks smallint CHECK (1..16),
                set_by, set_at, ended_by, ended_at)
load_plan_week (plan_id, week_no smallint, target_units integer, target_sessions smallint, PRIMARY KEY (plan_id, week_no))
UNIQUE INDEX one_live_plan ON load_plan (player_id, unit_code) WHERE ended_at IS NULL
```

`load_weeks()` left-joins the live plan, so the chart draws planned against actual and the screen says "week 4 of 8: 120 planned, about 96 bowled". Optional: a bowler with no plan has empty `planned_units`.
*Rejected — a stored formula (+10 % a week):* a physio writes a plan down; a formula is a plan nobody can read back. The screen may *offer* to fill the weeks from a formula; the table holds the weeks.

Written under `player.workload.plan`; read under `player.workload.read`; under the health consent.

---

## 5 · Capacity tests, technique reviews and pace

Three records, three tiers, because they are three different kinds of fact.

| record | what | written by | read tier | why that tier |
|---|---|---|---|---|
| **`capacity_test`** | a physio's or S&C coach's measurement: hamstring strength, single-leg hop, a named `test_code` and a numeric result with a unit, per side | **`fitness.test.write`** (new, §6.1: `medical`, `fitness`) | **`wellness.read`** (level 3) | a clinical measurement of a child's body; more sensitive than a delivery count, less than a diagnosis |
| **`technique_review`** | a coach's judgement of an action: three yes/no/unsure — efficient, repeatable, sustainable — a `discipline` ('bowling'), a date, and the coach's prose | `player.workload.plan` | answers under `player.workload.read`; **`notes` masked under `player.note.read`** | the answers are the boy's to read; the coach's candid prose follows `development_note`'s rule exactly |
| **`pace_reading`** | a speed-gun figure: km/h, `context` ('nets','match','test'), device, optional `match_id` | `player.workload.write` | `player.workload.read` (level 2) | an asset, tracked so a *drop* can flag fatigue; not health information, but not a scorecard either — never public |

**The fitness role.** Kameel's decision (Q3): a strength-and-conditioning coach writes and reads fitness tests, reads the bowlers' load figures and check-ins, and does not read the physio's clinical notes. No existing role has that shape — `medical` reads the notes, `coach` cannot write a test — so it passes ADR 0003's first test ("a capability this title must hold that no existing role holds, or one it must be denied that every candidate role holds") and is a role, working name **`fitness`**. The builder records it in ADR 0003 under "What this does not say", beside `medical` and `finance`, as the worked case of a title that passed. Its capabilities are in §6.1; what it is denied is `medical.details.read` and `player.note.read`, and `packages/policy/test/separation.test.mjs` asserts both. A school appoints one through the director of sport, so `GRANTABLE_ROLES.directorofsport` in `roles.mjs` gains `fitness`.

`technique_review.notes` is a newly masked column, so `packages/policy/src/public.mjs`'s never-public list must name it or its test fails — which is the intended tripwire. Pace readings and capacity tests are added to the same list in prose even though they mask no column.

Consent: `capacity_test` and `technique_review` are under the health consent (a measurement and a judgement of his body); `pace_reading` is under the ordinary consent, like the nets count (§7.1).

---

## 6 · Tables and policy

### 6.1 New capabilities and the new role

Eight capabilities, each in `packages/policy/src/capabilities.mjs` with a `LEVEL`, each listed in `ADDED_SINCE_01` in `services/api/rls/generate-rls.mjs` and inserted by the migration of the phase that first governs a table with it (`db/24` is the worked example). Level 2 or above puts them in `SENSITIVE` automatically.

| capability | level | held by | governs |
|---|---|---|---|
| `player.workload.write` | 2 | coach, assistantcoach, medical, fitness, selfaccess | `load_entry`, `pace_reading` |
| `player.workload.plan` | 2 | coach, medical | `athlete_limit`, `load_plan`, `technique_review` |
| `wellness.read` | 3 | coach, assistantcoach, medical, fitness, directorofsport, selfaccess | `wellness_checkin`, `wellness_flag`, `capacity_test`; every staff read logged (§3.4) |
| `wellness.write` | 3 | selfaccess, guardian | `wellness_checkin_set()`, `wellness_flag_raise()` — his own, or his parent's for him |
| `wellness.alert` | 3 | coach, assistantcoach, medical | the flag notice; `wellness_flag_respond()`, `wellness_flag_refer()`; the `open_flag` dot in `workload()` |
| `wellness.share` | 3 | coach, medical | `wellness_share` (create, revoke); see that a share happened |
| `wellness.shared.read` | 3 | guardian, selfaccess | open a share made to you; the share notice |
| `fitness.test.write` | 3 | medical, fitness | `capacity_test` |

`player.workload.read` (exists, level 2; coach, assistantcoach, directorofsport, medical, selfaccess) is the read for everything at the load tier and gains `fitness`. `guardian` gains `wellness.write` and `wellness.shared.read` — both reach only her own children through her subject-scoped link — and no read of the wellness tables. `player` gains nothing. `directorofsport` gains `wellness.read` and not `wellness.alert`: he can look, he is not paged. The office gains nothing.

**The new role, `fitness`** (`roles.mjs`, phase 1, with its full list so the person is appointed once): `...READ_TEAM`, `player.profile.read`, `player.age.read`, `player.biometric.read` (height and weight are the inputs to a strength test, as they are for `medical`), `player.workload.read`, `player.workload.write`, `wellness.read`, `fitness.test.write`, `medical.status.read`, `medical.nature.read` (the coach's tier under ADR 0002, so he knows a boy is back from a hamstring — Q13 in §10 confirms). Not `medical.details.read`, not `player.note.read`, not `player.workload.plan`, not `wellness.alert`, not `wellness.share`. School-scoped, like `medical`. Added to `GRANTABLE_ROLES.directorofsport`.

*Rejected — reuse `medical.nature.read` for the wellness tier:* it is held by `teammanager`, `sportsadmin`, `principal` and `schooladmin`, none of whom Kameel named as readers, and by `guardian`, which would make the parent's read a standing permission rather than a share.
*Rejected — fewer capabilities by folding write into read:* `selfaccess` must write its own entries but never set a guideline; a coach must set guidelines but never write a check-in; a director may read a flag but must not be paged by one. The splits are the point.
*Rejected — `fitness` as `medical` minus a withdrawal:* `WITHDRAWN_SINCE_01` takes a capability from a role, not from one person; two people holding `medical` cannot hold different things.

### 6.2 The tables, in `tables.mjs`' own shape

Anchors resolve through the player, as `injury` and `development_note` do, so a team-scoped coach reaches his own side and stops, and a `selfaccess` or `guardian` assignment reaches one row's worth of person. A row that cannot resolve its player narrows to nothing (the "derived anchors" note at the top of `tables.mjs`).

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

// written only through wellness_checkin_set() / wellness_flag_raise() / _respond() / _refer(); the write entry exists for the generator
wellness_checkin:  { read: "wellness.read", write: "wellness.write", anchors: viaPlayer("wellness_checkin"), masked: {} },
wellness_flag:     { read: "wellness.read", write: "wellness.write", anchors: viaPlayer("wellness_flag"), masked: {} },
capacity_test:     { read: "wellness.read", write: "fitness.test.write", anchors: viaPlayer("capacity_test"), masked: {} },

wellness_share:    { read: "wellness.share", write: "wellness.share", anchors: viaPlayer("wellness_share"),
                     // the guardian it names, and the boy it is about, may read the share row itself
                     visibleWhen: "wellness_share_is_mine(wellness_share.id) OR is_family_of(wellness_share.player_id)",
                     masked: {} },
health_monitoring_consent: /* hand-written, as public_name_consent is: no INSERT/UPDATE policy, written only by its function */
```

Hand-written beside the generated policies, in the migration:

- **Consent gate** (§7): on the **health tables** — `wellness_checkin`, `wellness_flag`, `capacity_test`, `technique_review`, `athlete_limit`, `load_plan`, `load_plan_week` — a `BEFORE INSERT` trigger refusing unless `health_consent_live(player_id)`. **Not** on `load_entry` or `pace_reading`, which are ordinary processing.
- **Consent on read** (§7): a `RESTRICTIVE` `SELECT` policy on the same health tables: `health_consent_live(player_id) OR is_family_of(player_id)`.
- **Support** (§6.5): a `RESTRICTIVE` `SELECT` policy on `wellness_checkin`, `wellness_flag`, `capacity_test`, `wellness_share`: `app_support_access_id(school_id) IS NULL`.
- **Who recorded it**: the trigger on `load_entry` (`recorded_as`, §1.3) and the functions that are the only doors to `wellness_checkin` and `wellness_flag` (§3.2, §3.3).
- **The personal notice**: the `RESTRICTIVE` policy on `notification` for `recipient_id` (§3.4), phase 2.

### 6.3 The parent share, as a recorded act: `wellness_share`

**Plain words.** The physio or the coach decides a parent should see something — a run of check-ins, the load chart for the term, a test result. They choose *what* (which kinds of record), *for which dates*, *for whom* (a verified guardian of this child, chosen from the child's links; never an email address), *for how long the parent may open it* (**14 days by default, 30 at most**), and *why* (a sentence). That is one row. The parent is told through a notice, opens it, and every opening is on the school's access log with the share's id. The sharer, or anyone holding `wellness.share` at the school, may revoke it. It is not a permission: when it lapses or is revoked the parent sees nothing again, and the school can answer "what did this parent see about their son, and who decided" from two tables. **Who sees that a share happened:** anyone holding `wellness.share` at the school — the coaches and the physio — so a physio can see the coach already told the parent; not the office.

```
wellness_share (
  id            uuid PK,
  school_id, player_id,
  shared_by     uuid NOT NULL → app_user, shared_at timestamptz NOT NULL DEFAULT now(),
  with_link_id  uuid NOT NULL,                                    -- a verified, consented guardian link for this child
  what          text[] NOT NULL CHECK (what <@ '{load,checkins,flags,tests,reviews,pace,limits,plan}' AND cardinality(what) > 0),
  from_on       date NOT NULL, to_on date NOT NULL CHECK (to_on >= from_on AND to_on <= sa_today()),
  open_until    timestamptz NOT NULL DEFAULT now() + interval '14 days'
                CHECK (open_until <= shared_at + interval '30 days'),
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),     -- as support_access.reason
  revoked_at, revoked_by,
  FOREIGN KEY (with_link_id, player_id) REFERENCES assignment_subject (id, player_id)
)
```

- **Opening it:** `wellness_share_open(p_share)` is `SECURITY DEFINER`. It checks the caller is the person on `with_link_id`'s assignment, holds `wellness.shared.read`, the share is live (`revoked_at IS NULL AND now() < open_until`), then returns only the record kinds in `what` between `from_on` and `to_on` — `technique_review.notes` **never**, whatever `what` says — and calls `log_restricted_read('wellness_share', ARRAY[p_share], what, school_id)` so the row lands in `access_log` (`db/22`'s signature). A parent reads through this function or not at all: `guardian` holds none of `wellness.read` or `player.workload.read`. The `recorded_as` label travels with a shared check-in, so a parent who recorded one sees her own name on it.
- **Telling the parent:** an `AFTER INSERT` trigger writes a `notification`: `scope_level = 'school'`, `team_code NULL`, `kind = 'welfare'`, `required_capability = 'wellness.shared.read'`, `subject_kind = 'welfare'`, `subject_person_id` = the child, **`recipient_id`** = the guardian on the link (§3.4; before phase 2's column exists the capability-and-subject rule alone reaches only that child's guardians and the boy, which is acceptable and stays as the fallback), body: "The school has shared something about your child's training with you. Open his page to read it." The push payload is the usual pointer.
- **The boy sees it.** `selfaccess` holds `wellness.shared.read` and the share row is visible to him, so he knows what was shared about him and with whom. That is the POPIA right of access applied to the disclosure itself.

*Rejected — a time-boxed `enquiry`-style assignment granting the guardian `wellness.read`:* for its hour or its week it *is* a standing permission, and it records who, not what.
*Rejected — an exported PDF or an email:* it leaves the platform and the log.
*Rejected — a permanent "parents may see wellness" switch per school or per child:* Kameel's decision is that it is an act, not a permission, each time.

### 6.4 What the bowler reads of his own

Through `selfaccess` (named to himself in `assignment_subject`): every `load_entry`, `load_day`, `load_summary()` and `load_weeks()` row about him; his `athlete_limit` and `load_plan` with their sources; his `wellness_checkin` and `wellness_flag` rows, with who recorded each and their outcomes and referrals; his `capacity_test` results; his `technique_review` answers *without* the coach's `notes`; his `pace_reading`s; every `wellness_share` made about him; and his `injury` rows at every tier, as today. That is the data-subject's right of access, and the one thing kept from him — a coach's candid prose — follows the line `player.note.read` already draws and gives the same reason. After a withdrawal of consent he still reads all of it until it is deleted (§7.5).

### 6.5 Separation from team-mates, and from support

- **Team-mates.** `player` holds none of the eight new capabilities and not `player.workload.read`. Every new table anchors `person` on `player_id`, and `selfaccess` and `guardian` are subject-scoped (`SUBJECT_SCOPED_ROLES`), so a boy's own assignment reaches his row and no other, and a parent's reaches her child's. `packages/policy/test/separation.test.mjs` gains the assertions: no capability in `wellness.*`, `player.workload.*` or `fitness.*` is held by `player`, `spectator`, `analyst`, `scorer`, `official`, `media`, `scout` or `enquiry`; `fitness` holds neither `medical.details.read` nor `player.note.read`; `guardian` holds no `wellness.read`; `directorofsport` holds no `wellness.alert`. `db/99`'s new section proves it live: a pupil signed in as `player` on the same side reads zero rows of every new table and receives no `welfare` notice about a team-mate.
- **Support access** (`db/22`). `support_access_begin()` grants one real role at one school for at most four hours, and every read under it is stamped with `support_access_id`. Under this design a support session as `coach` could read a squad's load entries, guidelines and plans — level 2, and on the record — which is acceptable and logged. It **cannot** read check-ins, flags, capacity tests or shares: the `RESTRICTIVE` policy in §6.2 makes them invisible under any support session, whatever role it borrowed. No support ticket needs a fourteen-year-old's soreness map; if one ever does, the school appoints a real `medical` assignment for a named person, which is the door the schema already has.
  *Rejected — allow with logging:* logging is for reads that were legitimate and must be answerable; this read has no legitimate ticket.

---

## 7 · Consent

### 7.1 Plain words: two layers

Two consents already exist:

- the **guardian-link consent** (`assignment_subject.consent_state`, versioned, shown as `player_guardian_status`) — the terms: the school may run the sport with this child's information at all;
- the **public-name consent** (`public_name_consent`, `db/47`) — a separate, optional opt-in with its own wording.

**The nets count and the pace reading sit under the first.** Kameel's decision (Q5): a count of deliveries in the nets is a record of what he did at training, like attendance, and is ordinary processing under the consent the school already holds. So `load_entry` and `pace_reading` have no gate of their own, and a boy whose parents have not opted into health monitoring still has a nets band, a load chart and a word beside it.

**Everything about his body sits under a third consent.** Health monitoring is of the second kind — **optional, off by default, its own wording, given by a competent person, withdrawable in Settings, recorded and never deleted** — and specific to a *purpose*: monitoring this child's wellbeing to help keep him on the park. Under it: check-ins, flags, capacity tests, technique reviews, personal guidelines and plans — a statement, a measurement or a judgement about his body. Without it nothing in those tables is written or read. Match overs, spells, the age-band breaches and the existing `workload()` screen carry on exactly as today, because they exist for the directive and were never under either consent. "The overs stay as public as a scorecard is."

**A future, separate purpose** — keeping his record for his whole time in the school system so patterns across years can flag a risk early — is SCRBRD-112. It needs its own wording, its own consent and the information officer, and this design does not take it on; §7.5's retention rule is written so that consent, if given, is the one thing that would extend it.

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

No `INSERT`/`UPDATE`/`DELETE` policy and the privileges revoked from `scrbrd_app`; the only door is `health_monitoring_consent_set(p_player, p_yes, p_version, p_guardian, p_form_name, p_form_date)`, which mirrors `public_name_consent_set()`: a verified, consented guardian link with a **live** assignment (§7.4 says when that is); the athlete himself from his eighteenth birthday; the office under `guardian.link.manage` naming the form and its date. **A guardian's "yes" on or after his eighteenth birthday is refused** (`adult_consents_for_himself`, the same reason and the same word SCRBRD-083 §6.3 gives `public_name_consent_set()` under option C); a guardian's "no" — a withdrawal or a refusal — is accepted while her link is live, because stopping needs no lawful basis.

`health_consent_live(p_player) RETURNS boolean`, `STABLE SECURITY DEFINER`, is the one function every gate calls:

```
let r = the latest open record for the player, by seq
r is a 'yes'
AND (r.given_by = 'self'
     OR (r.given_by = 'guardian' AND r.given_on < majority_on(player.born)            -- given while he was a child
         AND (majority_on(player.born) > sa_today() OR still_at_school(p_player))))   -- and either he still is, or he is a pupil
AND (r.given_by = 'guardian' OR player.born IS NOT NULL)
AND NOT EXISTS (a 'self' record for the player)  -- once he has spoken, only his records count (below)
    OR r.given_by = 'self'
```

Read plainly: a parent's yes counts while he is a child and, if given while he was a child, goes on counting while he is a pupil; his own record, once he has given one, is the only one that counts.

### 7.3 How it gates

- **Collection.** Every `BEFORE INSERT` trigger on a health table (§6.2), and the `wellness_checkin_set()` / `wellness_flag_raise()` functions, call it and raise `check_violation` with the message `no_health_consent`; the write handlers map that to `422 { error: "no_consent" }` as `workload-api.mjs` maps `23514`. The screens read `health_consent_live` through a `consents` resource and do not draw the check-in card, the flag button or the guideline form at all when it is false — but the trigger is the authority, not the screen. The record-a-session form is drawn regardless: it is not under this consent.
- **Reading.** The `RESTRICTIVE` policy in §6.2 hides every health row whose player's consent is not live from every reader except the family (`is_family_of()`, `db/08`). `load_summary()`, `load_weeks()` and the re-emitted `workload()` return the load figures for every boy (they are ordinary processing) and `NULL` for `over_guideline_28d`, `planned_units`, `days_since_last_injury`, `returning` and `open_flag` for a boy without a live health consent; `workload()`'s row carries `monitored = false` so the screen can say "not monitored" beside his check-in column rather than an empty cell.
- **The match overs** are not gated. `bowler_over`, `bowler_spell`, `bowling_breach` and the directive path are unchanged.

### 7.4 Eighteen while still at school — the one change both designs rely on

**What the schema does today.** A guardian link ends at the child's majority: `guardian_link_establish()` writes `assignment_subject.valid_until = majority_on(born)` (`db/08` ~967), `db/10` corrected the links that predated that, and `app_can()` and a dozen other places test `valid_until IS NULL OR valid_until > current_date`. So today a parent's *access* ends on the birthday, and `public_name_consent_set()` refuses her act from that day.

**What Kameel decided.** For health data (Q7): at 18, while the boy is still in the school system, his parent's consent stays valid — no pause in collection — and her access continues. The app asks him once, from his birthday, to give his own answer; until he answers, collection continues on her consent; if he declines, it stops. For the public name (SCRBRD-083 §6, **option C, decided**): her standing consent from before 18 carries on; while he is at school she may take his name off but never newly put it on; the app asks him for his own answer at 18. SCRBRD-083 says plainly that option C depends on this design's change to the link, because without it she has no access with which to act.

**The change, stated once.** *A guardian link's `valid_until` is the later of the child's eighteenth birthday and the day he leaves the school system; while he is at school it is open.* Concretely, in one migration (`db/52`, §9):

1. `still_at_school(p_player) RETURNS boolean`, `STABLE`: there is a `team_membership` row for him with `left_on IS NULL` at a `school` whose `kind = 'school'`. This is the test SCRBRD-083 §6.3 left for Opus to pick; both documents now use this one. A club, an academy or a union is not "the school system".
2. `guardian_link_establish()` writes `valid_until = NULL` when `still_at_school(child)`, `majority_on(born)` otherwise (as today), and still refuses a new link for an adult (`player_is_an_adult`) — the rule is that an existing link carries on, not that new ones may be made for adults (Q16 asks whether that should change).
3. Two triggers on `team_membership`: when a row **closes** (`left_on` set) and the player has no other open school membership, every open guardian link for him gets `valid_until = greatest(left_on, majority_on(born))` — a minor who leaves keeps his parent until his birthday, exactly as today; an adult who leaves loses her access that day. When a row **opens** for a player whose guardian links carry `valid_until = majority_on(born)`, in the future or already passed but not otherwise ended, `valid_until` is set back to `NULL` — the boy who comes back, or who is enrolled after his link was made.
4. A data step: open guardian links for players who are `still_at_school()` get `valid_until = NULL`, including the links `db/10` closed on the birthday for boys still enrolled. `db/10` itself does not move.

Nothing else changes. `app_can()`, `is_family_of()`, `player_guardian_status`, the consent functions and the ten other `valid_until` tests keep their code, because the meaning they test — "is this link live today" — is still what the column says. The birthday is no longer written as the end of the link when the boy is a pupil; it stays the date the consent functions compare against, so "a yes given while he was a child" is still `given_on < majority_on(born)`. SCRBRD-083 §6.3's two `CREATE OR REPLACE`s of `db/47`'s functions sit on top of this and need nothing more from it.

*Rejected — a liveness function replacing every `valid_until` test:* a dozen `CREATE OR REPLACE`s of shipped functions, including `app_can()`, for the same result.
*Rejected — a nightly job that re-opens links:* a job that widens access is the wrong shape; the two triggers fire on the events that matter and nothing widens by the clock.

**How the health rule and the public-name rule stand, side by side — both decided.**

| | health consent (this design, Q7) | public name (SCRBRD-083 §6, option C) |
|---|---|---|
| her pre-18 "yes" | carries on while he is at school | carries on (C6 unchanged) |
| her act after 18, at school | may **stop** it (withdraw or refuse); may not newly say yes | may take his name **off**; may not put it on |
| her access after 18 | continues while he is at school — §7.4's link change | the same link |
| him at 18 | asked once, on his Me screen; collection continues until he answers; his no stops it; once he has spoken only his record counts | asked at 18; his record displaces hers once given |
| after he leaves | her link ends that day; his own consent, if any, stands; the retention clock in §7.5 runs | her link ends that day |
| the footing | *processing* special personal information (POPIA s 26–27) | *publishing* ordinary personal information (s 11, s 35) |

The two rules now have the same shape, and the office learns one sentence for both consents: "after 18, while he is at school, a parent can say no but not yes; the platform asks him." The earlier draft of this design, under which a parent's health consent lapsed on the birthday and collection paused, is withdrawn. The difference that remains is the footing, which is the information officer's question.

**For the information officer.** Under POPIA a parent consents *for a child*; for an adult the consent must be his own. The decided rule stands on the position SCRBRD-083 §6.4 sets out: while he is a child the ground is a competent person's consent (s 35(1)(a)); from his eighteenth birthday the platform continues under the consent lawfully obtained while he was a child, tells him so on that day, and gives him the means to stop or replace it at any time (s 11(2)(b), (3)); no new consent is taken from anyone but him; his parent's only act after 18 is to stop, which needs no basis. Two things make health data the harder case, and the officer should confirm them: check-ins and tests are **special personal information** (s 26), for which the general ground is the data subject's consent (s 27(1)(a)), and "continuing under a child's consent" is a reading the officer must be willing to defend for that category; and the parent's continued *access* to an adult's health information is a disclosure to a third party, justified here by his being a pupil in the school's care and by the access ending the day he leaves. **The fallback, if the officer will not sign that off,** is the earlier draft's rule and is one line in `health_consent_live()`: a guardian's record stops counting at `majority_on(born)` whatever his enrolment, collection pauses until he says yes, and nothing is lost. The link change itself (`db/52`) would stand under that fallback, because option C for the public name needs it regardless. `db/52` goes to the officer with this note before it is pasted; §9 says what else waits on it.

**Born unknown.** A guardian link cannot exist without a date of birth (`guardian_link_establish()` refuses), so a guardian consent implies `born` is known. A `self` consent with `born IS NULL` is refused: the platform cannot know he is eighteen.

### 7.5 Withdrawal, leaving, and deletion

**Withdrawal** is the Settings toggle: `health_monitoring_consent_set(…, false, …)` ends the open record with `withdrawn`. It takes effect on the next statement: collection stops (the trigger), staff reads stop (the policy), the boy still sees his own, and nothing is deleted yet. A parent may withdraw while her link is live (§7.4); he may from 18. His decline at 18 is a `self` record with `refused`, and has the same effect.

**Leaving.** When his last school membership closes (`team_membership.left_on`), his parent's link ends if he is an adult (§7.4), and the retention clock below starts whether or not a consent is still open — the purpose was his wellbeing at this school, and he has left it.

**Deletion (Q4).** Twelve months after the later of (a) the day his last health consent ended and (b) the day he left the school system, his health rows — `wellness_checkin`, `wellness_flag`, `capacity_test`, `technique_review`, `athlete_limit`, `load_plan`, `load_plan_week` — are deleted. The consent records themselves are kept, as `public_name_consent` rows are: they are the proof of what was agreed. `load_entry` and `pace_reading` are not touched: they are ordinary processing, and the nets band is part of the load history the school keeps as it keeps attendance. The match figures are the scorecard's and are not touched.

The rule is fixed here; the job is not written in phase 1. `health_retention_due(p_player) RETURNS date` (derived: the later of the two dates plus twelve months, `NULL` while a consent is live or he is at school) ships with the consent so the screen and the officer can see when a boy's rows fall due; `health_records_purge()` — `SECURITY DEFINER`, callable only under `platform.feature.manage`, deleting only rows whose `health_retention_due() <= sa_today()`, and writing one `health_purge_log` row per player (player id, counts per table, run by, run at) because deletion is the one act that cannot be audited afterwards — is written when the information officer signs off, as its own migration. A consent given again inside the twelve months makes the rows readable again by construction: the policy tests the live consent, and nothing was deleted. SCRBRD-112, if it comes, is the one consent that would set `health_retention_due()` to `NULL` for the boy who gave it.

---

## 8 · Beyond schools, and what is left as a seam

**What does not change** for a club, a province, an academy, a union (`school.kind` already carries all of them), or another sport:

- every table in §6 is keyed on `player`, `school` and `sport`, and none names an age band, a school year or an over;
- the words in §2 say *load*, not *overs*; the body map is a body, not a bowler;
- the consent is the same record, with `given_by = 'self'` for an adult; `still_at_school()` is false for a club member of any age, so a guardian link there ends at 18 as today;
- an adult's only figure is his `athlete_limit`; `bowling_directive_for()` already returns `NULL` for the Open band, and `bowling_ceiling_open` already refuses anything that is not `kind = 'school'`;
- a season label, where a screen wants one, comes from `season_for(date, level)` with the tenant's level.

**What changes, per sport:** one `load_unit` row per unit; one branch in `load_day`'s `match_units` union when the sport has a log to fold (cricket has `bowler_over`; a sport scored on the platform later adds its own); the band edges, if the sport's cannot be the same four (§1.2); nothing else. `technique_review.discipline` is text so "bowling" is one value, not the column's name.

**What a tenant may need to switch:** whether the module is on at all. The whole feature sits behind a module switch in the existing `feature_flag` / `feature_enabled(key, school, person)` mechanism (key `workload_monitoring`), which can only narrow: a school that has not turned it on shows no check-in card and accepts no entry, and a switch never widens a read.

**What does not travel:** `bowling_breach`, `bowling_directive` and the school ceiling are cricket's regulatory layer and stay where they are. A rugby union's own directives, when they exist, are that sport's equivalent table, not a generalisation of this one.

**The seam for smart health devices (SCRBRD-111).** A wearable will one day write sleep hours or a session's minutes. The place it joins is `recorded_as`: `load_entry` and `wellness_checkin` each carry that column with a closed CHECK, and `'device'` is the value a later migration adds, with a `device_id` reference beside it. Nothing else is reserved, and nothing here reads a device. Whether a device's figure counts as *his* voice, and under which consent, is that item's design.

---

## 9 · Phasing

Each phase is one migration, one policy change regenerated from `tables.mjs`, and a `db/99` section that proves the phase's claim live before anything is pasted to production (`docs/ARCHITECTURE.md §9`). The numbers assume `db/51` is the last shipped (`db/SHIPPED.sha256`) and nothing lands first; if it does, the numbers shift and nothing else. **They have:** `db/52` (no-ball byes and the penalty list) and `db/53` (retired out resuming with consent) are taken by the Laws work, so phase 0 builds as the next free number after those, and every phase below moves up with it.

| phase | migration | ships | proves (in `db/99` and a smoke walk) |
|---|---|---|---|
| **0 · The link past 18** | `db/52` | `still_at_school()`; `guardian_link_establish()` re-emitted; the two `team_membership` triggers; the data step re-opening enrolled pupils' links (§7.4). Goes to the information officer with §7.4's note first. Both this design and SCRBRD-083 §6 (option C) depend on it; 083's own `db/47` function changes follow it in their own migration. | a pupil's guardian link is open on his eighteenth birthday and `app_can()` still grants her; a club member's ends on the birthday as today; a minor who leaves keeps his link until his birthday; an adult who leaves loses it that day; a boy re-enrolled has his link re-opened; `guardian_link_establish()` still refuses a new link for an adult; `db/10`'s file is unchanged |
| **1 · Consent and the count** | `db/53` | `health_monitoring_consent` + `_set()` + `health_consent_live()` + `health_retention_due()`; the Settings toggle, the sign-up row (the SCRBRD-092 screen, whose public-name row exists) and the "you are 18 — is this still all right?" card on his Me screen; `load_unit`, `load_band_units()`, `load_entry` (band), `load_day`; `load_summary()`, `load_weeks()`; `workload()` re-emitted (units, `estimated_7d`, EWMA word, `monitored`); `player.workload.write`; the `fitness` role in `roles.mjs` and `GRANTABLE_ROLES`; `POST /api/load-entry`; the `load`, `loadWeeks` and `consents` reads; the module key | a nets entry is accepted for a boy **without** health consent and the chart shows it as an estimate; a nets entry with a count is refused and a `match_elsewhere` entry with a band is refused; the bowler's band and the coach's for one session count once, his; a `match_elsewhere` entry on a scored day is marked; the EWMA word agrees with `workload()`'s thresholds on a constructed series; a guardian's health "yes" for a 17-year-old is live on his 18th birthday while he is enrolled, dead if he is at a club, dead when he declines, and a guardian's "yes" after 18 is refused; a `player` on the same side reads nothing; the existing workload screen is unchanged; a `fitness` assignment reads a load chart and cannot read an injury's notes |
| **2 · The voice** | `db/54` | `body_site`, `wellness_checkin`, `wellness_flag`, `wellness_checkin_set()`, `wellness_flag_raise()`, `_respond()`, `_refer()`; `wellness.read`, `wellness.write`, `wellness.alert` (with `guardian` on `wellness.write`, `directorofsport` and `fitness` on `wellness.read`); `notification.subject_kind` gains `welfare`; `notification.recipient_id` and its restrictive policy; `SUBJECT_KINDS` in `push-api.mjs`; the health-consent gates and restrictive read policies; the support `RESTRICTIVE` policies; `workload()` re-emitted with `open_flag`; the logged `checkins` and `flags` reads; the check-in and flag screens, for him and for his parent on his behalf | a check-in without health consent is refused and a nets entry the same day is not; a parent's check-in is labelled `guardian`, the boy sees it and his own later entry replaces it as `self`; a coach cannot record one; a flag produces exactly one `notification` row and changes nothing in `injury`, `training_attendance`, `match_availability` or selection; the coach and the physio receive it, the director of sport, the fitness coach, the team-mate and the guardian do not; the director opens the flag and the read is in `access_log`, as is the physio's; a referral reaches the director alone; the push payload names nobody; a second tap does not make a second flag; the director's team list shows no dot and the coach's does; a support session as `coach` reads zero check-ins; withdrawal hides check-ins from the coach on the next statement and not from the boy |
| **3 · His own profile** | `db/55` | `athlete_limit`, `load_plan`, `load_plan_week`, `effective_limits()`; `player.workload.plan`; `over_guideline_28d` in `load_summary()`; the profile screen with the injury history joined through `injury_masked` | a guideline tighter than the directive is the effective figure and names its source and kind; a looser one is refused; passing a guideline writes no `notification` and no `bowling_breach` row and appears as a line on the profile; an Open-band club adult's only figure is his own; planned against actual per week; the profile shows the coach nature and dates and the physio notes, from one read; a guideline for a boy without health consent is refused |
| **4 · Tests, reviews, pace** | `db/56` | `capacity_test`, `technique_review`, `pace_reading`; `fitness.test.write`; `public.mjs` never-public list gains `technique_review.notes` | a coach reads the three answers and not the notes; the boy the same; the fitness coach and the physio write a test and a coach cannot; the fitness coach reads a test and not the physio's injury notes; a pace reading is accepted without health consent and is not readable under `player.performance.read` |
| **5 · The parent share** | `db/57` | `wellness_share`, `wellness_share_open()`, `wellness_share_is_mine()`; `wellness.share`, `wellness.shared.read`; the share notice with `recipient_id`; the share screen and the parent's page | a share defaults to 14 days and refuses 31; it is bounded to `what`, `from_on..to_on`, `open_until`; the parent's open lands in `access_log` with the share id; the notes never travel whatever `what` says; revocation and expiry each close it on the next statement; a guardian of a different child receives no notice; the boy sees the share row; the physio sees the coach's share row and the office does not |
| **6 · Deletion** | later, its own `db/NN` | `health_records_purge()` and `health_purge_log`, after the information officer signs off §7.5 | a boy twelve months past withdrawal has his health rows deleted and his load entries, pace readings and consent records kept; one whose consent was renewed inside the year keeps everything; the log row names the counts |

Phase 5 could move ahead of 3 and 4 if the first flags show that physios need to tell parents sooner than they can phone them. Phase 0 must be first for the Q7 rule to be true in the database, and phase 1 before 2: it holds the consent that every health table's trigger calls. If the information officer holds `db/52`, phase 1 can still be built and pasted — `health_consent_live()` calls `still_at_school()`, so `db/53` would carry that one function itself and `db/52` would become the link change alone — and a parent's health consent would, until `db/52` lands, end on the birthday with her access, which is today's behaviour and the officer's fallback.

Each phase's `tables.mjs` entries regenerate `db/09`'s successor policies into the phase's own file (the generator emits only the new tables; `db/01` and `db/09` stay as shipped). Each new capability is one `ADDED_SINCE_01` line; the `fitness` role is one `roles.mjs` entry plus its `db/99` section. `tools/hooks/guard.mjs`'s `FROZEN_THROUGH` moves after each paste.

---

## 10 · Decisions, and the questions they opened

### Decided so far (Kameel, 2026-09-27)

- **Nets counts are an estimate, not a tally (Q1).** "We're not trying to be 100% accurate on how many balls
  are bowled in the nets", and the coach's and the bowler's figures are not to be set against each other. So:
  no disagreement flag; one figure per session, the bowler's own when he logged one, else the coach's.
  **Entered as a band** (decided): under 12 / 12–24 / 24–36 / 36+ deliveries, with the effort (low, medium,
  high). The windows read a band at its midpoint (6, 18, 30, 42) and say they are estimates; match deliveries
  from the ball log stay exact. §1.3's record and reconciliation rule change accordingly before phase 1 is
  built: `load_entry` carries the band, not a free count, for nets and training.
- **The director of sport may read check-ins and flags, but is not alerted to them (Q2).** He can open a
  bowler's check-ins and flags when he asks for them: a level-3 read, so it is logged
  (`log_restricted_read()`), the same as the physio's. The flag's notification goes to the coach and the physio
  only, so it follows its own recipient rule rather than `wellness.read` as §3.3 has it. A coach or physio can
  **recommend** a flag to him: one act that sends him that flag, recorded like a share. This changes §3.3 (the
  recipients), §6.1 (`directorofsport` gains `wellness.read`) and ADR 0002's reasoning, which a builder must
  revisit with it.

### Decided, second round (Kameel, 2026-09-27)

- **Q3 — a strength-and-conditioning coach is fitness, not medical.** He writes and reads fitness tests and does
  not read the physio's clinical notes. That is the "real data-access difference" ADR 0003 allows a role for, so a
  builder adds one (working name `fitness`) and records the exception in ADR 0003. He also reads the bowlers' load
  figures and check-ins (Kameel, 2026-09-27): `player.workload.read` and `wellness.read`, but not the physio's notes.
- **Q5 — the nets count sits under the ordinary processing consent,** like attendance, not the health consent. The
  check-in (how his body feels) stays under the health consent. §7's gates change accordingly: an unconsented boy
  still has a nets count; he has no check-ins or flags.
- **Q7 — at 18, a parent's consent stays valid while he is still in the school system.** Collection does not pause
  at 18. **Flag for the information officer:** under POPIA a parent consents for a child; for an adult the consent
  must be his own. The proposed shape (to confirm): the parent's consent carries on with no pause; at 18 the app
  asks him once to confirm; until he answers collection continues; if he declines it stops. This also bears on
  whether the parent's *access* continues past 18 while he is at school (today the guardian link ends by date).
  **Confirmed (Kameel, 2026-09-27):** that shape — carried over, asked once, stops only if he declines — and the
  parent's access continues past 18 while he is in the school system. The guardian link's end at 18 (`majority_on()`)
  changes for a pupil still at school: a `db/NN` (Opus), with the information officer's sign-off on the POPIA basis.
- **Q8 — personal limits are guidelines.** Exceeding one writes a line on his profile only: no breach row, no
  notice.
- **Q9, Q10, Q11, Q12 — as recommended.** No match intensity in phase 1; a share lasts 14 days by default, 30 at
  most; an open flag never hides him from selection or marks him unavailable; the coaches and the physio see that a
  share happened, the office does not.
- **Q4 — hidden for 12 months, then deleted.** After consent is withdrawn or he leaves, his check-ins, flags,
  tests and notes are unreadable for twelve months, then deleted by a job the information officer signs off. His
  match figures are the scorecard's and are not touched. Kameel's longer aim, not phase 1: ask permission to keep the
  record for his whole time in the school system, so patterns across years can flag health risks early. That is a
  purpose of its own, needing its own explicit consent and the information officer (SCRBRD-112).
- **Q6 — the check-in is his own, or his parent's.** He records it himself, on his phone or in a browser (the web
  portal). A boy without a phone may have a parent record it for him. A coach does not record one. The entry says
  who recorded it ("recorded by his mother"), he sees it when he next signs in, and the flags read it the same way.
  This gives `guardian` a write on check-ins for her own child only: a new capability line (`ADDED_SINCE_01`) and a
  `db/NN` (Opus), and it follows the consent rule in Q7 past 18.
- **Later: smart health devices** (wearables) feeding the same record — SCRBRD-111.
- **From SCRBRD-083 §6, the public name at 18 — option C (Kameel, 2026-09-27).** A parent's standing consent from
  before 18 carries on; while he is at school she may take his name off but never newly put it on; the app asks him
  for his own answer at 18. Recorded here because §7.4's link change is what both rules stand on.

The body above (§0–§9) is written to these decisions. Where a decision named a section, that section now says the decided thing and the earlier reading is marked *rejected* with the reason.

### Open, third round — what the decisions opened

Each with the recommendation the body assumes.

**Decided (Kameel, 2026-09-27): Q13–Q19 as recommended** ("all recommendations for the rest"). The table is kept as the record of what each one means.

| # | question | recommendation |
|---|---|---|
| **Q13** | The `fitness` role's medical tier: `medical.status.read` only (available or not), or status **and** nature (the coach's tier under ADR 0002: "a hamstring strain", dates), still never the physio's notes? | **Status and nature.** A strength coach bringing a boy back needs to know it was a hamstring; that is the tier every coach already holds, and it is not the notes. §6.1 assumes it. |
| **Q14** | Q6 says "the flags read it the same way". The body reads that as: a parent may also **raise the flag** on his behalf, labelled `guardian`, and it reaches the coach and the physio as his own would. Is that the reading? | **Yes.** A mother whose phoneless son says at home that his back is sore is the case the flag exists for. The label keeps it honest; the recipients decide, as always. |
| **Q15** | A parent who records check-ins for her son reads nothing back except the confirmation — she holds no `wellness.read`, and a share is a staff act. Should she see **her own entries** again (only rows where `recorded_by` is her, say the last 14 days)? | **Yes, her own entries only.** They are her words, not a read of his voice or of anything staff wrote, so it is not the standing permission Kameel refused; one `visibleWhen` clause on `wellness_checkin`. Without it she cannot tell whether she already recorded today. |
| **Q16** | With the link now outliving 18 for a pupil, may the office **make a new** guardian link for an adult pupil (a boy who arrives at 18, or whose parent was never linked)? Today `guardian_link_establish()` refuses. | **No, not in this design.** The decided rule is that an existing consent and link *carry on*; creating one for an adult is a different act and the officer's harder case. If it is wanted, it is his to grant, later, and his own screen would do it. |
| **Q17** | The referral to the director of sport as a notice **to one person** needs `notification.recipient_id` (a nullable column and one restrictive policy, phase 2) — the table addresses a capability in a scope today. Take that, or make the referral a list he opens? | **Take the column.** "Sends him that flag" is a notice; the column is small, honours the existing `fanOut()` pointer rule, and the parent share notice (§6.3) uses it too. |
| **Q18** | Phase 0 (`db/52`, the link past 18) goes to the information officer with §7.4's note. If he will not sign off the health reading, the fallback is the earlier rule for health only (her consent stops counting on the birthday; collection pauses until the boy says yes) while the link change stands for option C. Should phase 1 **wait** for his answer, or ship with today's birthday rule and pick up `db/52` when it lands? | **Do not wait.** Phase 1 collects only the nets count and the consent record; nothing about a body is written until phase 2. Build `db/53` so it stands without `db/52` (§9's last paragraph), and let the officer's answer decide whether `db/52` is pasted before phase 2. |
| **Q19** | The retention clock starts when he **leaves** even if a consent is still open (§7.5). A boy who moves to another SCRBRD school: his old school's rows fall due twelve months after he left it, and his new school starts fresh. Is that right, or should the record follow him with a new consent at the new school? | **Falls due; the new school starts fresh.** The purpose was his wellbeing *at this school*, and the consent was to this school. A record that follows him is SCRBRD-112's question, not this one's. |

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `ball_event`, `ball_event_live` | `db/02_schema_scoring.sql` | the only match truth |
| `bowler_over` (`deliveries`, `legal_balls`, `bowled_on`), `bowler_spell` | `db/08_schema_programme.sql` ~5190–5240 | match load, wides and no-balls included, exact |
| `bowling_directive`, `bowling_ceiling_open`, `bowling_directive_for()` | `db/08` ~5130–5185 | one input to `effective_limits()` |
| `bowling_breach`, `bowling_breach_watch()` | `db/08` ~5258–5340 | unchanged; the regulatory record |
| `workload()` | `db/08` ~5361 | re-emitted with new columns, old ones kept |
| `sa_today()`, `age_band()`, `season_for()` | `db/08` | day boundaries, bands, season labels |
| `training_session`, `training_attendance` | `db/08` 146–178 | pre-filling the group entry; minutes |
| `team_membership` (`left_on`) | `db/08` ~4256 | `still_at_school()`; the triggers that end or re-open a guardian link (§7.4) |
| `notification`, `notification_read` | `db/08` 220–288 | the flag, the referral and the share notices; gains `recipient_id` and `subject_kind = 'welfare'` |
| `fanOut()`, `buildPayload()`, `SUBJECT_KINDS` | `services/api/notify/push-api.mjs` | push delivery; pointer payload; honours `recipient_id` |
| `injury`, `injury_masked` | `db/00_schema_core.sql` 163; generated | history at the reader's tier |
| `access_log`, `log_restricted_read()` | `db/08` 526; `db/22` 218 | every staff read of check-ins and flags; the parent's opens |
| `support_access`, `app_support_access_id()` | `db/22_support_access.sql` | the restrictive policy in §6.5 |
| `assignment_subject`, `majority_on()`, `guardian_link_establish()`, `is_family_of()`, `player_guardian_status` | `db/00` 523; `db/08` 885, ~930–967, 1279; `db/10` | consent givers; the link's `valid_until` past 18 (§7.4) |
| `public_name_consent`, `public_name_consent_set()` | `db/47_public_data.sql` 197, 332 | the consent record's shape; the same guardian-after-18 refusal under option C |
| `feature_flag`, `feature_enabled()` | `db/08` 2326, 2494 | the module switch |
| `school.kind`, `sport` | `db/00` 28, 227 | tenants beyond schools; "the school system" is `kind = 'school'` |
| `rulebook_clause` | `db/32_rulebook_clause.sql` | the clause beside a directive figure |
| `CAPABILITIES`, `LEVEL`, `SENSITIVE` | `packages/policy/src/capabilities.mjs` | eight new names, levelled |
| `ROLE_CAPABILITIES`, `SUBJECT_SCOPED_ROLES`, `GRANTABLE_ROLES`, `READ_TEAM` | `packages/policy/src/roles.mjs` | who holds what; `selfaccess` and `guardian` are subject-scoped; the `fitness` role and who may appoint it |
| `TABLES`, `maskedColumns()` | `packages/policy/src/tables.mjs` | the entries in §6.2 |
| never-public list | `packages/policy/src/public.mjs` | `technique_review.notes` |
| `ADDED_SINCE_01`, `WITHDRAWN_SINCE_01` | `services/api/rls/generate-rls.mjs` | new capabilities after go-live |
| `workloadRoutes()` | `services/api/write/workload-api.mjs` | the pattern for `load-api.mjs` |
| `workload` read resource | `services/api/read/read-api.mjs` ~1252 | the pattern for `load`, `loadWeeks`, `checkins`, `flags`, `consents` |
| `withPrincipal()`, `Idempotency-Key` | `services/api/server.mjs`; `db/15` | every write |
| `InjuryView.jsx` | `apps/web/src/views/` | today's injury screen: list, KPI cards, `withheld()` for masked fields; the profile's injury panel reuses its rows |
| ADR 0001, 0002, 0003 | `docs/adr/` | one assignment decides; coach's overview; the `fitness` exception is recorded in 0003 |
| `PUBLIC_DATA.md` §3, §5a, C6 | `docs/policy/` | never public; breaches; the 18 rule this design now matches in shape |
| SCRBRD-083 §6 (option C, decided) | `docs/design/SCRBRD-083_public_pages.md` | the public-name rule at 18 that relies on §7.4's link change |
