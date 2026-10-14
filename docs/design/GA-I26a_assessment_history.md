# GA-I26a — Assessment history and the drill loop: the design

**Status:** Draft for Kameel, 14 Oct 2026; nothing built.
**Source:** `audit/GAP_ANALYSIS_2026-10-05.md` (I06 at line 56; the Phase C row "I26a, I27, I29, I32" at line 98); `docs/design/GA-I27_coach_cards.md` (C-D1, C-D4, C-D5, §5.3, §6, §8, A3, A5); `docs/design/STEP4_parent_pupil.md` (§ "What the parent never sees", "What the pupil never sees"); `docs/design/ACCOUNT_LIFECYCLE.md` (§3, §6.2 D22, Q9, Q12); `docs/design/GA-I24-I25_compare_and_combine.md` (D3, D5, D8, D9, §4); `docs/design/SCRBRD-110_workload.md` (§5 `technique_review`, §6.1); `docs/design/SCRBRD-138_captains_view.md` (:213); `docs/policy/PUBLIC_DATA.md` §3 (N5); `docs/design/REACH_parent_pupil.md` on `origin/claude/wip-design-reach` (§1, §2.5, §3.3 class C, §4 M3, §6.1 R-A); `db/08_schema_programme.sql` :140–206, :1840–1921, :6110–6150; `db/09_rls_policies.sql` :373–439; `packages/policy/src/capabilities.mjs` :105–135, `roles.mjs` :137–180, :250–280, :330–335, :375–395, :414–421, `modules.mjs` :90–105; `services/api/write/assessment-api.mjs`, `training-api.mjs` :1–60, `services/api/read/read-api.mjs` :465–555, :3080–3135; `apps/web/src/lib/focusAreas.js`, `views/SkillsView.jsx` :100–160, :350–530, `lib/live.js` :1515–1550; `packages/scoring/src/rubric.mjs` :120–217. Line numbers are `origin/main`'s on 14 Oct. The map's findings (the brief) were taken as read and not re-derived.
**Reader:** Kameel on a phone first; then the Opus lead; then the Opus agent who builds the tables, functions, policies and proofs, and the Sonnet agent who builds the screens. Names in examples are the seed's illustrative ones (Hilton, Westville, Kearsney; D Erasmus, R Pillay, K Naidoo), never a real child's.
**Scope:** GA-I26a, and the stored coaching point that GA-I27 slice 2 (C3–C4) builds "with I26a … the same pointer rather than a second one". It does not reopen STEP4's reader rules, ACCOUNT_LIFECYCLE's shape (D22, a signed schedule), GA-I24-I25 D5 (no judgement in a comparison), SCRBRD-110's health boundary, GA-I36's two-versions rule, PUBLIC_DATA N5, or REACH's argument spellings. Where it asks I27 to move one thing (§2, AH-D2) it says so in one place and gives the alternative that moves nothing.

---

## What Kameel decides

Each is a recommendation. Everything else in this document follows from these and is the lead's to adjust.

1. **AH-D1 · The loop and the smallest model.** Recommendation: **keep `player_skill` as the history (it already is one; the screen hides it), add two small tables — `development_target` (one boy, one metric, a number to reach, the drill for it) and `training_session_drill` (the side's plan, keyed to the library) — give `training_attendance` the write route it never had, and derive "since the last look" at read time from those four tables.** No stored "progress", no stored "met". Alternative: a `drill_prescription` table per boy beside the targets. Why not: a boy's drills are the side's plan intersected with his attendance; a second place to say which drill he did is a second place for the truth to drift.
2. **AH-D2 · The coaching point and the one pointer.** Recommendation: **the coaching point is a `development_note` row carrying the evidence pointer (I27 §6's `evidence_*` columns added to `development_note`), not a new table; `development_target` points at that note by id and at the `player_skill` row it stood on by id; nothing copies the pointer.** The reason is a leak I27 did not see: `selfaccess` holds `player.development.read` (`roles.mjs:382`), so a `coaching_point` table under that capability reaches the boy himself, which C-D4 says it must not. The note tier (`player.note.read`) is exactly C-D4's reader set. Alternative (moves nothing of I27's shape): keep I27's `coaching_point` table and change its read policy's capability to `player.note.read`. Why not preferred: it builds a second prose table at the same tier with the same author trigger, the same logging entry and the same retention row as the one that exists.
3. **AH-D3 · Who reads each part.** Recommendation: **scores and their history and targets: coach, assistant coach, director of sport and the boy himself; notes and coaching points: coach, assistant, director, principal; the side's session plan: everyone at the side under `team.read`, parents included; the register: `player.profile.read`, as today; the public, another school, an analyst, a pupil captain over a team-mate, a team manager: none of the judgements.** The history reveals a direction a single score does not, and that changes no reader: every reader of one row already reads them all (long-form table, no DELETE policy, the API returns every row). It changes the words (§4). Alternative: hide the trend from the pupil. Why not: it is his record, he reads every row today through the same read, and STEP4 item 7 gives him his ratings.
4. **AH-D4 · The history screens.** Recommendation: **one strip per metric on the Skills screen, dated points on the 1–20 axis in one colour, no verdict word; a "Since the last look" panel per discipline naming the date, the sessions his side held, which he attended, which carried his target's drill, and the target as it stands; the author and date on every point; nothing about health, load, absence reasons or conduct.** No new destination.
5. **AH-D5 · Corrections and withdrawal.** Recommendation: **append-and-withdraw for scores, targets and coaching points; a coach still corrects his own score on the same day (the upsert stays); another coach's score is never overwritten; a withdrawn row stays readable, struck through, with who withdrew it and why; a plain note keeps author-only edits as built.** Alternative: let any coach of the side edit any score (today's UPDATE policy). Why not: the API already re-stamps `assessed_by` on conflict, so a correction by a colleague re-attributes the judgement to him.
6. **AH-D6 · Side, school, link, eighteen; retention.** Recommendation: **a target follows the boy to his new side (current-side anchoring, as notes do), stays with the school when he leaves, and is deleted with his scores and notes 2 years after leaving (ACCOUNT_LIFECYCLE §6.2's row, extended by name); the register's rows about him go with them; the side's plan stays with the session and names nobody.** The guardian link's end and his eighteenth birthday change nothing here, because his parents read none of it and he keeps reading his own.
7. **AH-D7 · Slices and tiers.** Recommendation: **two migrations (`db/104`: corrections and the coaching point on the note; `db/105`: targets, the plan, the register route), Opus; the pure drill map in `packages/scoring`, Opus; the screens, Sonnet with Opus reviewing; Haiku's rows after each merge.** The lead may fold the two migrations into one; they are split so the correction layer can ship before the loop.
8. **AH-D8 · The Training module's gate.** Recommendation: **`modules.mjs` gates `training` by `team.read`, matching the table.** It widens the nav to the team manager, the pupil, the parent and the analyst; the data they then see is what RLS already gives them. Alternative: leave it. Why not: a parent who may read "training moved to 06:30" cannot find the screen.
9. **AH-D9 · The register's `injured` status.** Recommendation: **the new attendance route never writes `injured`; reads render an existing `injured` as `excused`; a later migration retires the value from the CHECK.** The register is a side-shared table (REACH class C1) and `injured` is a health word on it, which the schema's own comment says it must not carry.

---

## 0 · In one page

A coach at Hilton rates D Erasmus's `againstPace` an 8 in March and an 11 in September. The database has both rows; the Skills screen shows the 11 and nothing of the 8 (`useSkills`, `live.js:1535–1545`: newest row wins). The focus-areas card says "No target is set; one appears here when a coach saves it" (`SkillsView.jsx` ~:514), and nothing can save one (`focusAreas.js` header). The training screen lists sessions whose `drills` are free text (`db/08:159`), the drill library sits beside them unlinked (`db/08:6115`), and the register has a table, a policy and no route. So the loop a coach actually runs — look, decide what to work on, run the drill, look again — is four tables that do not know about each other, and the one that does hold the history hides it.

This design closes the loop with the smallest additions that make it a loop:

```
player_skill  ──(the score it stood on)──▶  development_target  ──(drill_id)──▶  drill
  ▲  history, already long-form               one boy, one metric, a number        the library
  │                                                 │ note_id (why: staff only)
  │                                                 ▼
  │                                           development_note  ◀── the coaching point lives here,
  │                                             + evidence_* pointer      carrying I27's pointer
  │
  └── the next look   ◀── "since the last look": sessions his side held (training_session),
                          the plan they ran (training_session_drill → drill),
                          which he attended (training_attendance)
```

Two new tables, two altered ones, two write routes, one pure mapping, two migrations. Nothing is stored that can be derived; the loop's closing is a read.

---

## 1 · The loop (AH-D1)

### 1.1 Six steps, what is stored, by whom

| step | what the coach does | stored where | written by (capability) | new? |
|---|---|---|---|---|
| **look** | rates what he watched, per attribute, 1–20 | `player_skill` (player, assessed_on, assessed_by, category, metric, score) | `player.development.write` — the coach of the current side | no; the history is already there |
| **decide** | names what to work on and where to get to | `development_target` (player, category, metric, target_score, due_on, from_skill_id, drill_id, note_id) | `player.development.write` | **yes** |
| **say why** | a sentence, pinned to what he saw | `development_note` with the evidence pointer (the coaching point) | `player.note.write` and `player.development.write` both, through `coaching_point_write()` | the table exists; the pointer columns are **new** |
| **plan** | puts drills on the side's next sessions | `training_session_drill` (session, drill, position, minutes) | `team.manage` | **yes** |
| **run** | marks who was there | `training_attendance` (session, player, status) | `team.manage` | the table exists; the route is **new** |
| **look again** | rates again; the screen shows the line, the target, what was done between | derived: `player_skill` × `development_target` × sessions × plan × attendance | — | the reads are **new** |

### 1.2 `development_target`

```
development_target (
  id             uuid PK,
  player_id      uuid NOT NULL → player ON DELETE CASCADE,
  school_id      uuid NOT NULL → school,              -- denormalised, as development_note is: the row states its tenant
  category       text NOT NULL CHECK (category IN ('technical','mental','tactical','physical')),
  metric         text NOT NULL,                       -- validated against TREE in the API, as assessment-api does; no SQL copy
  target_score   smallint NOT NULL CHECK (target_score BETWEEN 2 AND 20),
  from_skill_id  uuid → player_skill,                 -- the row it stood on; NULL when the metric was unassessed
  drill_id       uuid → drill,                        -- the drill for it; NULL = "no drill, just watch it"
  note_id        uuid → development_note,             -- the reasoning: staff-tier prose, reached by its own policy
  set_by         uuid NOT NULL → app_user,            -- stamped by trigger, never passed in
  set_on         date NOT NULL DEFAULT current_date,
  due_on         date,                                -- "by the end of term"; NULL = no date
  withdrawn_at   timestamptz, withdrawn_by uuid → app_user, withdrawn_reason text,
  CHECK (withdrawn_at IS NULL OR withdrawn_by IS NOT NULL)
)
-- one open target per metric per boy
CREATE UNIQUE INDEX development_target_open ON development_target (player_id, category, metric)
  WHERE withdrawn_at IS NULL;
```

- **Written through `target_set(p_player, p_category, p_metric, p_score, p_due, p_drill, p_note)`**, `SECURITY DEFINER`, pinned path, revoked from `PUBLIC`/`anon`/`authenticated`, granted to `scrbrd_app` (the `db/60:1156–1182` pattern I27 §6 names). It checks `app_can('player.development.write', player_school(p_player), player_team(p_player), p_player, zeros)` itself; finds `from_skill_id` as the newest non-withdrawn `player_skill` row for that metric; refuses `p_score <= that score` ("a target below where he stands is not a target"); refuses a `p_note` whose `player_id` is not `p_player`; refuses a `p_drill` that is retired; withdraws any open target for the metric in the same transaction (reason `'replaced'`) and inserts the new one. `target_withdraw(p_id, p_reason)` is the only other write.
- **Met or not is derived**, never stored: the newest non-withdrawn `player_skill` for the metric with `assessed_on >= set_on` and `score >= target_score` means "reached on {date}"; a later row below it means "reached, then rated lower" — both are said, neither is a verdict (§4). A withdrawn or corrected score (§5) moves the answer with it, which is GA-I36's rule arriving for free.
- **Policy:** class C2 (REACH §3.3): read `app_can('player.development.read', school_id, player_team(player_id), player_id, zeros)`; no INSERT/UPDATE/DELETE policy at all (the functions are the only door). The `RESTRICTIVE` cut for `support_access` sessions that I27 §6 asked for on its table applies here, in the `db/60:240–243` shape.
- **Logged:** `targets` joins `RESTRICTED_FIELDS` with `["target_score"]`; a target is a coach's judgement of where a child should be, which is N5's class.

### 1.3 `training_session_drill`

```
training_session_drill (
  session_id  uuid NOT NULL → training_session ON DELETE CASCADE,
  drill_id    uuid NOT NULL → drill,
  position    smallint NOT NULL CHECK (position BETWEEN 1 AND 20),
  minutes     smallint CHECK (minutes BETWEEN 5 AND 180),   -- NULL = the drill's own duration
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, drill_id)
)
```

- **Names no boy and carries no target.** This is the rule that keeps the side's plan side-readable: a `target_id` here would tie a drill on a shared noticeboard to a named child's judgement. The link from a boy's target to the drills he did is computed on his development screen, under `player.development.read`, from `development_target.drill_id ∩ training_session_drill.drill_id` over sessions he attended.
- **Policy:** it is a satellite of `training_session` and takes its spelling. Today that is `app_can('team.read', school_id, team_code, zeros, zeros)` for read and `team.manage` for write, resolved through the session (`db/09:380–389`). REACH R-A re-creates `training_session_read` as `side_reach('team.read', school, team, zeros)` (M3); the lead adds `training_session_drill_read` to that re-create list so the plan narrows with the session. Until R-A lands, the plan is as wide as the session is, no wider.
- **`training_session.drills text[]` stays** as it is, read-only, drawn as "Other" items under the keyed plan. New plans write the link table. A later migration may drop the column once no row at a pilot school still uses it; this design does not.
- **Routes (`training-api.mjs`):** `PUT /api/training/:id/plan { drills: [{drillId, minutes?}] }` replaces the plan in one statement (delete then insert under the UPDATE/INSERT policies); `PUT /api/training/:id/attendance { rows: [{playerId, status}] }` upserts the register. Both do what every write path there does: shape only, and the policy decides.

### 1.4 The register's write route (AH-D9)

`training_attendance`'s policy is `team.manage` for writes (`db/09:400–409`) and has no route. The new route accepts `present`, `absent`, `late`, `excused` and refuses `injured` with `422 status_not_accepted`. The schema's own comment (`db/08:170–172`) says why: the reason for an absence is a medical fact and lives in the injury record behind `medical.status.read`. `injured` on a table every team-mate reads (REACH C1: `training_attendance` under `player.profile.read`, row id) breaks that in the one place it was written down. Reads render an existing `injured` as `excused`; the `training_attendance` read (`read-api.mjs:481–488`) does the mapping in SQL (`CASE WHEN status = 'injured' THEN 'excused' ELSE status END`). Retiring the value from the CHECK is a later migration after the pilot's rows are re-spelled; `db/08` is not a frozen file but the rows are real, and the lead schedules it.

### 1.5 One vocabulary mapping

Four lists exist and none maps to another: `player_skill.category` (4), `development_note.about_discipline` and `DISCIPLINES` (4), `drill.category` (6), `training_session.session_type` (7). The bridge is the rubric's own `DISCIPLINES` (`rubric.mjs:177–217`), which already cuts every attribute by discipline. One pure function, in `packages/scoring/src/rubric.mjs` beside it:

```
drillCategoriesFor(category, metric) → Set<'batting'|'bowling'|'fielding'|'keeping'|'fitness'|'tactical'>
```

- the disciplines whose list contains `${category}.${metric}` (from `DISCIPLINES`);
- plus `fitness` when `category === 'physical'`;
- plus `tactical` when `category === 'tactical'`;
- `leadership`, `teamwork`, `workRate`, `determination` (in no discipline) map to the empty set, which is honest: no drill in the library teaches them.

It is used **only to order the drill picker** (matching categories first, with a "suits againstPace" word), never to refuse a drill: a coach who wants fielding drills for a batter's concentration is coaching, not mistyping. `session_type → drill.category` is the same shape for the plan editor's default filter (`batting`→`batting`, `bowling`→`bowling`, `fielding`→`fielding`, `fitness`→`fitness`, `technical`/`skills`/`match-prep` → all). One test in `packages/scoring/test` pins every attribute in `TREE` to its set, so a renamed attribute fails here and not on a screen. No SQL copy; the server never needs the map.

---

## 2 · The coaching point: one pointer, in the note (AH-D2)

### 2.1 The finding

I27 C-D4 (decided 14 Oct) gates `coaching_point` under `player.development.read` and says it "reaches no pupil and no parent through this design". I27 A3 names the holders as coach, assistant and director, and the lead's review checked `roles.mjs:178, 260, 277`. `roles.mjs:382` is `selfaccess: [..., "player.development.read", ...]`. Through `selfaccess` the boy reads his own `player_skill` rows (STEP4 item 7, by design) and would read every coaching point written about him, body included, the moment the table exists. I27 §7's proof lists `player` (D Erasmus himself) as a persona who sees nothing, and he would pass that proof under `player` and fail it under `selfaccess`, which the proof does not SET ROLE to. This is the one thing in I27 this design must move, and the brief told it to settle the pointer, so it settles both together.

### 2.2 The recommendation: the pointer rides on `development_note`

`development_note` is already "a sentence the coach writes about one boy" at the tier C-D4 wanted: `player.note.read` is held by coach, assistant coach, director of sport and principal (`roles.mjs:161, 179, 261, 278`), by neither `selfaccess` nor `guardian`, every read is logged (`RESTRICTED_FIELDS.notes`), the author is stamped and fixed by trigger (`db/08:1890–1920`), `school_id` is denormalised, the retention row exists (ACCOUNT_LIFECYCLE §6.2: 2 years after leaving) which closes I27 A5, and the policy anchors on the boy's current side as ADR 0002 wants. So `db/104` adds I27 §6's pointer to it:

```
ALTER TABLE development_note
  ADD COLUMN match_id        uuid REFERENCES match(id),
  ADD COLUMN evidence_rule   text CHECK (evidence_rule IN ('S2a','S2b','S2c','S5','S11')),
  ADD COLUMN evidence_read   text,                 -- 'matchups', 'career_by_season', 'bowler_day', …, or 'skills'
  ADD COLUMN evidence_params jsonb,                -- {teamCode, matchId, batterId: this boy} or {skillId: the player_skill row}
  ADD COLUMN evidence_head   int,
  ADD COLUMN evidence_as_of  timestamptz,
  ADD COLUMN evidence_text   text[],               -- the card's lines, ONLY for S2a / S5 (C-D4)
  ADD COLUMN withdrawn_at    timestamptz,
  ADD COLUMN withdrawn_by    uuid REFERENCES app_user(id),
  ADD CONSTRAINT note_evidence_text_tier CHECK (evidence_text IS NULL OR evidence_rule IN ('S2a','S5')),
  ADD CONSTRAINT note_evidence_whole     CHECK (evidence_read IS NULL OR evidence_as_of IS NOT NULL),
  ADD CONSTRAINT note_withdrawn_whole    CHECK (withdrawn_at IS NULL OR withdrawn_by IS NOT NULL);
```

A **coaching point** is a `development_note` with `evidence_read IS NOT NULL`. I27's `coaching_points` read is `notes` filtered so, with the pointer columns added to the select; `RESTRICTED_FIELDS.notes` already logs `body`. Everything else in I27 §6 stands and moves across unchanged:

- **`coaching_point_write(p_player, p_match, p_body, p_evidence)`**, `SECURITY DEFINER`, pinned, granted to `scrbrd_app` only. It inserts a `development_note` with `body` of 1–500 characters (the column's own CHECK stays at non-empty, for plain notes up to 4000; the function is the 500 floor for points), `observed_on = current_date`, `about_discipline` and `adjustment` NULL (a point never moves a rating; the coach's number is a target, §1.2), and the pointer. It checks **both** `app_can('player.note.write', …)` and `app_can('player.development.write', …)` for the boy's current side — the second keeps the writer to the coach, as C-D4 chose, where `note.write` alone would admit the assistant and the director. It refuses `evidence_params.batterId` ≠ `p_player`, a body matching the SQL copy of the forbidden words (kept in step by I27's two-list test), and a body containing another boy's full name from the fixture's `match_squad`, exactly as I27 §6 wrote.
- **A skill-anchored point** — the one this design adds — has `evidence_rule NULL`, `evidence_read = 'skills'`, `evidence_params = {"skillId": <player_skill.id>}`, `evidence_as_of` = that row's `assessed_on` at midnight SAST, no `evidence_text` (the score is re-read from the row, which §5 keeps even when withdrawn). "Make a coaching point of this" from a skill's history strip pre-fills it, as I27 C-D6 has S5 do.
- **Withdraw is the only update on a point.** `development_note_author()` gains two lines: when `OLD.evidence_read IS NOT NULL` and any column other than `withdrawn_at`/`withdrawn_by` changes, raise `45002 'a coaching point is withdrawn, not edited'`. A plain note keeps author-only edits (`45001`), as built and as `reviseNote` expects. `note_withdraw(p_id)` sets both columns under `player.note.write` for the side, any holder — a departed coach's point must be withdrawable by the coach who follows him.
- **S13 and the development panel** (I27 §5.3, C4) draw from `coaching_points`; the stood-on/now drawing re-derives the load figures under the reader's own `player.workload.read` (C-D4) and, for a skill-anchored point, draws the `player_skill` row by id beside the metric's newest row.
- **Never a `notification`, never a push, never in the generic CSV** (I27 §6, GA-I24-I25 D9).

### 2.3 The alternative, if Kameel keeps I27's table

Build `coaching_point` exactly as I27 §6 draws it, with one change to its read policy: `app_can('player.note.read', …)` in place of `player.development.read`; write stays `player.development.write`. `development_target.note_id` then references `coaching_point` instead of `development_note`, and `RESTRICTED_FIELDS.coaching_points = ["body"]` is added as I27 planned. The retention row A5 asked for is added by name (§6). Everything in §1 and §3–§6 reads the same. The cost is a second prose table at the note tier, a second author trigger, a second logging entry and a second purge target for one kind of fact.

### 2.4 Why one pointer and not a copy

`development_target.from_skill_id` and `development_target.note_id` are foreign keys, not copies of a pointer; the note's `evidence_params.skillId` is the same `player_skill.id`. So a corrected score (§5) is found by every row that stood on it by one join, and GA-I36's "both versions kept" holds without a stored snapshot. The only copied text anywhere is I27's `evidence_text` for S2a/S5 cards, which C-D4 allowed because those cards' capabilities are the reader's own.

---

## 3 · Who reads each part (AH-D3)

### 3.1 The rule, as the argument

Every row in this design is either **about one boy** (class C2: `player_skill`, `development_target`, `development_note`; class C1: `training_attendance`) or **about the side** (`training_session`, `training_session_drill`). REACH §3.3 and §3.1 give each its one spelling of `app_can()`'s person argument, and this design adds no spelling:

| table | capability | person argument | team argument |
|---|---|---|---|
| `player_skill` | `player.development.read` / `.write` | **the row's `player_id`** | the boy's current side (`player.team_code`), as `db/09:425–439` |
| `development_target` | `player.development.read`; writes only through `target_set()`/`target_withdraw()` | the row's `player_id` | the boy's current side |
| `development_note` (notes and coaching points) | `player.note.read`; writes `player.note.write` and, for a point, `player.development.write` too | the row's `player_id` | the boy's current side |
| `training_attendance` | `player.profile.read` / `team.manage` | the row's `player_id` | the session's side |
| `training_session`, `training_session_drill` | `team.read` / `team.manage` | **zeros** today; **`side_reach('team.read', school, team, zeros)`** when REACH R-A lands | the session's side |

A guardian passes the boy rule for her child only where she holds the capability, and she holds none of `player.development.read`, `player.note.read` (`roles.mjs:391–400`). She passes the side rule for her child's side under `team.read`. A pupil passes the boy rule for himself through `selfaccess` (`:376–386`: `player.development.read`, not `player.note.read`) and the side rule through `player` (`:330–335`: `team.read`). A coach passes both for his side. The office passes the boy rule school-wide only where it holds the capability, and `schooladmin` holds neither development nor note capabilities (`:198`), which is right: the office keeps the record (§6) and does not read the judgement.

### 3.2 Reader by reader, in plain words

| reader | scores, the history, the trend | targets | notes and coaching points | the side's plan | the register | why |
|---|---|---|---|---|---|---|
| **the coach** of his side | reads and writes | reads, sets, withdraws | reads, writes, withdraws | reads, writes | reads, writes | `coach` (`roles.mjs:250–272`) holds every capability named |
| **the assistant coach** | reads | reads | reads, writes a plain note; **cannot write a coaching point** | reads; writes only if his bundle holds `team.manage` (see note) | reads; writes the same way | `assistantcoach` (`:274–285`) holds `player.development.read` but not `.write`, so `target_set()` and `coaching_point_write()` refuse him; `player.note.write` lets him write a note |
| **the director of sport** | reads, school-wide | reads | reads, writes a plain note | reads, writes | reads, writes | `:169–182` |
| **the principal** | **no** | **no** | reads | reads | reads | `:137–168`: `player.note.read` without `player.development.read`. The head reads what the coach wrote and not the numbers; this design records it and does not change it |
| **the team manager** | no | no | no | reads, writes | reads, writes | `:287–294`: `team.manage`, `team.select`, nothing of development or notes. He runs the session, not the judgement |
| **the boy himself** (`selfaccess`) | reads his own, every row, the trend | reads his own | **no** | reads his side's | reads his side's | STEP4 item 7 and `capabilities.mjs:113–131`: his scores yes, the prose no |
| **his parents** (`guardian`) | **no** | **no** | **no** | reads her child's side's (once R-A: her side, not the school) | reads her child's row (`player.profile.read`, row id; the side's other rows too, C1) | STEP4 "What the parent never sees"; "his drills this week" is answered by the **side's** plan, which names nobody, and not by his targets |
| **a pupil captain** over a team-mate | no | no | no | his side's | his side's | `player` holds none of the development or note capabilities (138 :213); the honour adds nothing |
| **an analyst** | no | no | no | reads | reads (the register is C1 under `player.profile.read`, which he holds; §3.4) | `:414–421`; GA-I24-I25 D5 keeps judgements out of his workspace |
| **the other school** | no | no | no | no | no | the side rule is this school's side; `opposition_squad()` names its own columns and none of these |
| **a scorer, an official, a spectator, the office, finance, a driver** | no | no | no | per `team.read` where held and scoped | per `player.profile.read` where held | none holds a development or note capability |
| **the public** | never | never | never | never | never | PUBLIC_DATA §3 N5: judgements; the plan and register are signed-in rows under `team.read`/`player.profile.read` and no `public_*()` function serves them |
| **a `support_access` session** | no | no | no | — | — | the `RESTRICTIVE` cut I27 §6 asked for, on all three class-C2 tables (Opus verifies `development_note` and `player_skill` have one today, and adds it where they do not) |

Note on the assistant and the plan: `assistantcoach` spreads `READ_TEAM` (`team.read`, not `team.manage`) in the lines read (`:274–285`); the lead confirms from the full bundle whether he holds `team.manage`. If he does not, the plan is the coach's and the team manager's to write, which is how a school runs a session anyway.

### 3.3 What the history reveals that one score does not

A trend is a **direction** — "D Erasmus's `againstPace` has gone 8, 9, 11 since March" — and a direction about a named child's judged ability is more than a number: it says whether the coaching is working and whether the boy is. Two things follow and one does not.

- **It changes no reader.** Every row of `player_skill` is already returned by the `skills` read to every holder of `player.development.read` for the boy (`read-api.mjs:494–500` has no date filter; `db/09:425` has no DELETE policy). The screen throws the older rows away in the browser. Making the line visible discloses nothing to anyone who could not already fetch it with the same token.
- **It changes the words** (§4): a falling line drawn to a fourteen-year-old with the word "declining" beside it is a verdict; the same line with its dates and "rated 11 on 14 Sep by your coach" is his record. GA-I24-I25 D3's rule — figures, no verdict, no colour that scores — applies to the trend exactly as to a comparison.
- **It does not reach a comparison or a workspace** (GA-I24-I25 D5, §4 item 2), a pupil captain, a parent or a public page. A trend across two boys would be a selection verdict written by the app, and I24-I25 refused it by name.

### 3.4 Two existing reaches this design does not widen but names

1. **The register is side-shared.** `training_attendance` is REACH class C1 under `player.profile.read` with the row's player id — a team-mate (through `player` at team scope), the analyst and the scorer may read who was at training. REACH decided C1 and this design keeps it. What it adds is AH-D9: no health word on that table. "Did not attend" is a fact the side shares; why is not.
2. **The principal reads notes, not scores.** Recorded in §3.2; not changed. If Kameel wants the head to read the ratings too, it is one line in `roles.mjs` and his to say.

---

## 4 · The history screens (AH-D4)

No new destination (136 D2's rule applies by analogy). Everything below is on the **Skills screen** (`SkillsView.jsx`), which is already the development tier's surface, and on the **Training screen** for the plan and the register. Sonnet builds; Opus reviews because every screen here shows a named child's judgement.

### 4.1 The strip: one metric's history

Under each attribute bar (`SkillsView.jsx` ~:455–480), a strip: the 1–20 axis across, one dot per non-withdrawn `player_skill` row for that metric, dated, joined by a hairline in one neutral colour (`D.textMuted`), no band colour on the line. The newest dot carries the score already shown in the bar's colour; the older dots are the same grey. A withdrawn row is a hollow dot with a strike, and the word "withdrawn" on hover and in its `aria-label`. Tapping a dot opens a sheet with: the score, the date, the author ("R Pillay, coach" to staff; "your coach" to the boy — the author's name is on the `coach` table the side reads anyway, so the choice is words, not disclosure), and, for staff, the coaching points that stood on this row (`evidence_params.skillId`). **No word for the direction.** "8 → 11 since March" is said as the two figures and the dates; "improving", "declining", "stalled", "plateau" are not written anywhere, and `apps/web/test/skillsHistory.test.mjs` greps the rendered strip for them.

A target shows as a tick mark on the axis at `target_score` with "target 12 · by 30 Nov · set 14 Sep", and the focus-areas card (`focusAreas.js`) finally receives `saved` from the `targets` read: `{ [metric]: target_score }` for the open targets. When the newest score is at or above the target: "reached 11 Oct" under the strip, the target struck; the row is still there for the coach to withdraw or replace. A target is never auto-closed, never auto-raised; `target_set()` is the only way it moves.

### 4.2 "Since the last look"

A panel per discipline (batting, bowling, fielding, keeping), because the anchor is per discipline, exactly as `ratingsQuery()` anchors (`read-api.mjs:502–520`): the last look is the newest `assessed_on` among the discipline's attributes (`DISCIPLINES`). It says, in this order and these words:

> **Batting · last looked 14 Sep** (your coach)
> Since then the U15A held **6 sessions**; D Erasmus was marked present at **5**, late at 1.
> Drills on those sessions: throw-downs ×4, short-pitch defence ×2, running between wickets ×3.
> Target: `againstPace` **12** by 30 Nov, set 14 Sep — the drill for it, throw-downs, ran **4 times**; he was there for **3**.

The panel never says "missed", "absent" or counts sessions he was not at as a figure of its own; it counts what he attended (GA-I24-I25 D8's rule, applied to training). A session with no register says "no register taken", not a zero. A boy with no assessment in a discipline says "not yet rated for batting" and the panel ends there. A boy whose side held no sessions says so. Every figure names its source and window in the panel's footer, as every Phase C item must ("From training, training_attendance and the plan; U15A, 14 Sep to today").

**One read, `development_since?playerId`**, invoker-rights SQL under the caller's own capabilities: it joins `player_skill` (the anchor per discipline), `training_session` for the boy's current side between the anchor and `sa_today()`, `training_session_drill` + `drill` for the plan, `training_attendance` for his rows, and the open `development_target` rows. RLS is the floor inside it: a reader who may not read the boy's targets gets the panel with no target line; one who may not read the side's sessions gets no session line. The `skills_history?playerId` read returns every row with `assessed_by`, `withdrawn_at`, `withdrawn_by`, `withdrawn_reason`; the existing `skills` read adds `WHERE s.withdrawn_at IS NULL` so the pivot keeps meaning "the newest standing score". Both new reads join `RESTRICTED_FIELDS` (`skills_history: ["score"]`, `development_since: ["target_score"]`) with `SUBJECT_ID` set to `player_id`, so every open of a boy's history is one access-log row against him. The lead decides whether Opus writes `development_since` as one SQL read or the client composes it from four; one read is preferred, because four reads are four log rows for one glance.

### 4.3 Writing a target and a plan

- **Target:** on the attribute row, "Set target" (44 px, `player.development.write` only): a number picker 1–20 that refuses values at or below the standing score with the word "already there", a date (optional), a drill picker ordered by `drillCategoriesFor()` with a "suits againstPace" badge on matches and every library drill below it, and one line of 200 characters, labelled **"Why — staff only; the boy sees the target, not this"**, which becomes the coaching point (`coaching_point_write` with `evidence_read='skills'`) and the target's `note_id`. The label is the honesty: the same form writes to two tiers and says which words land where.
- **Plan:** on a session on the Training screen, "Plan" (`team.manage`): the library grouped by category with the session type's default filter, drag to order (keyboard: move up/down buttons, 44 px), minutes editable, the legacy `drills` text shown as "Other" and not editable. Nothing here names a boy.
- **Register:** on a session, the side's roster with four states (present, late, excused, absent), one tap each, 44 px, saved as a whole. No "injured". No free text.

### 4.4 What never appears on these screens

- **No health or workload inference** (SCRBRD-110 §3.3, §5): no load figure, no `bowler_day`, no `wellness` dot, no "fatigue", no "rest", no "injured" on the register; a `technique_review` (110 §5, `player.workload.plan`) is not drawn here even to a coach who holds it, because it is under the health consent and this is the development tier. If a coach wants it beside the history, it is 110's screen that gains a link, not this one that gains a read.
- **No discipline** (`disciplinary_record`): never on the Skills screen; STEP4 Q5, Q6 stand.
- **No absence as a figure** (GA-I24-I25 D8): attended counts only.
- **No verdict words, rank, colour score or composite** (GA-I24-I25 D3): no "top of the side", no percentile, no "form".
- **No team-mate on the boy's own view**: the pupil's Skills screen lists him alone (it lists `assessed` players from `SKILLS_MATRIX`, which for `selfaccess` is one boy already).
- **No comparison** of two boys' histories, trends or targets (D5), and no "Compare" link from this screen.
- **No export**: `skills`, `skills_history`, `targets`, `development_since`, `notes`, `coaching_points` are refused by the generic CSV route (GA-I24-I25 D9's rule, extended; Opus confirms what it serves today).
- **No public page, no share card, no post to the side.** A target is not news.
- **No `player_skill.note`**: the per-row prose column is not returned by any read today and stays unreturned; the sentence belongs on `development_note` with the pointer. The assessment modal's single `note` field, which today is copied into every row written (`recordAssessment`), is removed from the form; what a coach wants to say becomes a coaching point on the row he means.

Floors: nothing under 12 px (the strip's date labels are 12 px and may be hidden under 360 px width in favour of the sheet), nothing tapped under 44 px (dots are 24 px marks inside 44 px hit areas), the hairline draws with no animation under `prefers-reduced-motion` and a 200 ms draw otherwise. The browser walk greps the rendered Skills screen for the never-words (§7).

---

## 5 · Corrections and withdrawal (AH-D5)

The existing shape is uneven: a plain note has author-only edits enforced by trigger (`db/08:1890–1920`); a score has an UPDATE policy open to every `player.development.write` holder of the side (`db/09:433–436`) and an API upsert that re-stamps `assessed_by = excluded.assessed_by` on conflict (`assessment-api.mjs:104–112`). So a colleague who re-rates D Erasmus's `footwork` on the same day a coach did overwrites the number **and takes the authorship**. GA-I36's rule is both versions kept, the audit saying who changed what.

| record | correcting yourself | correcting another's | removing a wrong one | the audit |
|---|---|---|---|---|
| **a score** (`player_skill`) | same day: the upsert stays (`assessed_by = app_user_id()` must equal the row's, else refused); a later day: a new row, as today | **never by overwrite**: a later-dated row of your own; a same-day row by a different author is refused with `45003 'rate it yourself on your own row'` | `skill_withdraw(p_id, p_reason)`: sets `withdrawn_at/by/reason`; any `player.development.write` holder for the boy's current side; the original `assessed_by` is untouched | the row stays; `skills` omits it, `skills_history` shows it struck; `ratings` (`ratingsQuery`) and `focusAreas` exclude it; a target that stood on it shows "stood on a withdrawn score" and keeps standing |
| **a target** (`development_target`) | `target_set()` again: the old one is withdrawn with reason `'replaced'` in the same transaction | the same — a target has one standing row per metric; whoever sets the next is named on it | `target_withdraw(p_id, p_reason)` | both rows remain, the old one struck with "replaced 2 Oct by R Pillay" |
| **a coaching point** (`development_note` with a pointer) | withdraw and write again (I27 §5.3: Save and Withdraw are the only acts) | `note_withdraw()` by any `player.note.write` holder for the side | `note_withdraw(p_id)` | the row stays; the panel shows it struck; the stood-on figure is still re-derived |
| **a plain note** | author-only edits, as built (`45001`); `updated_at` stamped | never (trigger) | `note_withdraw()` | as today, plus the strike |
| **the plan** | re-save the plan (`PUT`), the old rows go | the same; the plan names nobody and is the side's | — | `training_session_drill` has no history; the plan is a noticeboard, not a record of a child (an audit trigger is a later ask if a school wants it) |
| **the register** | re-save; upsert on `(session_id, player_id)` | the same, under `team.manage` | — | `recorded_at` moves; no history (the same reasoning) |

Mechanics, all in `db/104`:

- `player_skill` gains `withdrawn_at timestamptz, withdrawn_by uuid → app_user, withdrawn_reason text CHECK (length ≤ 200)` and the CHECK `withdrawn_at IS NULL OR withdrawn_by IS NOT NULL`.
- A `BEFORE UPDATE` trigger `player_skill_revision()`: if any of `score, note, category, metric, assessed_on, player_id` changes and `OLD.assessed_by <> app_user_id()`, raise `45003`; if `OLD.withdrawn_at IS NOT NULL` and anything changes, raise `45004 'a withdrawn score is not revised'`; `assessed_by` never changes hands (`NEW.assessed_by := OLD.assessed_by`). The API's `on conflict … do update set assessed_by = excluded.assessed_by` loses that clause, and maps `45003` to `403 not_the_assessor`, as `45001` maps to `not_the_author` today.
- `skill_withdraw`, `target_withdraw`, `note_withdraw`: `SECURITY DEFINER`, pinned path, grants as `db/60:1192–1224`; each checks the write capability for the boy's current side itself and sets the three columns; each refuses a row already withdrawn.
- No DELETE policy appears on any of the four tables. A row leaves only by the retention purge (§6).
- Every read of a withdrawn row is still a read of a score (`RESTRICTED_FIELDS`), so the log keeps its holes-free record (ACCOUNT_LIFECYCLE §6.2, access log).

What a correction reaches, in GA-I36's terms: the strip (struck dot), the bar and radar (next standing row), the focus areas (recomputed), the `ratings` coach index (recomputed over standing rows), the target's "stood on" line, the coaching point's stood-on/now pair, and the "since the last look" anchor (which moves to the newest standing row, so a withdrawn newest look re-opens the window to the one before). Nothing is cached in the browser beyond the read's own state; a withdraw bumps `nonce` and every read re-runs.

---

## 6 · Side, school, link, eighteen — and retention (AH-D6)

### 6.1 Events

| event | scores and history | targets | notes and coaching points | plan | register |
|---|---|---|---|---|---|
| **changes side** (U14A → U15A, `player.team_code` moves) | the new coach reads all of it; the old coach reads none from the next statement (current-side anchoring, `db/09:425`; ACCOUNT_LIFECYCLE §3) | follow the boy; the new coach sees "set by R Pillay, U14A, 3 Sep" and may withdraw or replace | follow the boy; the same | stays with the old side's sessions | stays with the sessions; his rows are his (C1) and the "since the last look" panel counts only sessions of his **current** side, so the window after a move starts at the move — the panel says "U15A since 1 Oct" |
| **leaves the school** (`player_departure`, `team_code = NULL`) | no coach reads them (ACCOUNT_LIFECYCLE §3: every side-anchored read is false); he keeps `selfaccess` and reads his own until purge; the office holds the record but not the capability | the same; open targets stay open and unread — nothing closes them, nothing needs to | the same (AL Q9's slice-4 `RESTRICTIVE` for departed pupils applies to all three class-C2 tables when it lands) | untouched | his rows stay until purge |
| **transfers to a school on SCRBRD** | **nothing travels** (AL §3.4: "not his notes, his ratings"); Westville's coach starts a fresh history; the Passport carries honours and figures, never a skill | nothing travels | nothing travels | — | — |
| **a guardian link ends** (revoked, pending, dated out) | no change: she read none | none | none | she loses the side (REACH: an ended link reads nothing of the side) | she loses it |
| **turns eighteen** (still at school) | no change: he reads his own, the coach reads his side; the policy shift at eighteen (STEP4 §3.3) is about his parents, who read none of this | none | none | none | none |
| **turns eighteen and requests erasure** (140 §4.3) | deleted with the file | deleted | deleted | untouched (names nobody) | his rows deleted |
| **a coach leaves** | rows keep `assessed_by`; the name follows the account (AL §6.2 role assignments: "the person's name follows their account"); the strip then says "a former coach" | `set_by` the same | `author_id` the same (AL: "the author's uuid on the note is not a reason to keep it") | `drill.created_by` the same | — |

### 6.2 Retention, by table

ACCOUNT_LIFECYCLE §6.2 (D22) is the schedule; its row "development notes, ratings — `development_note`, `player_skill` — recommend 2 years after leaving — delete — anchor leaving — the office" is **extended by name**, not re-decided. New rows for `packages/policy/src/retention.mjs`, each a recommendation under AL Q11:

| kind | table | keep | then | anchor | who acts | why this period |
|---|---|---|---|---|---|---|
| development targets | `development_target` | **2 years after leaving** (the same row as notes and ratings) | delete | `player_departure.left_on` | the office | a target without its scores is a number with no subject; it lives and dies with them |
| coaching points | `development_note` rows with a pointer | the notes' row, unchanged | delete | leaving | the office | I27 A5 asked for the row; the fold (§2) means it is the same row |
| the register | `training_attendance` | **2 years after leaving** | delete his rows | leaving | the office | it is evidence in the development loop and names a child; it has no row in AL today and this design proposes one (open call for Kameel) |
| the side's plan | `training_session_drill` | with `training_session` (no AL row; **propose: keep with the school's programme record, no child named**) | keep | — | — | a noticeboard of what the side did; nothing about a person |

Erasure at eighteen (140 §4.3) and the departed-pupil cut (AL Q9) apply to the three class-C2 tables and the register exactly as to `player_skill`. The purge job AL §6 builds takes the two new table names; `retention.test.mjs` (D22: every masked table has an entry) will fail until they are added, which is the intended tripwire.

