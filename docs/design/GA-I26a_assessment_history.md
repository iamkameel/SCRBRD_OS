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

