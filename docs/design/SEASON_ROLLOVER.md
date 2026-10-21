# SEASON ROLLOVER — the new year, the move up, and who still reads what: the design

**Status:** for Kameel's review (Fable, 15 Oct 2026). Nothing built. Kameel's six decisions of 15 Oct are recorded verbatim below and are not reopened; everything else is a recommendation (SR-1…) or a question (§9).
**Source:** `docs/design/REACH_parent_pupil.md` (§1.2 the three spellings, §2.5 the two helpers, §3 the classes, §7 REACH-D1–D5); `db/106_reach_side.sql` on `origin/claude/wip-reach-ra` (`side_reach()`, `fixture_end_reach()`, `fixture_reach()`, `my_fixture_ends()`, `my_sides()`, `my_own_boy()`; its header's (a)–(e)) and `db/99` §83 there (`_v106_stage()`, the labels (reader), (unchanged), (team-less), (spelling), (literal), (agree), (shape)); `db/100_ball_event_guardian_read.sql` (`my_child_fixtures()`, :137–163) and `db/101_news_to_the_side.sql` on the same branch; `docs/design/ACCOUNT_LIFECYCLE.md` §3 (D6–D11, `player_leave()`, `player_return()`), §5 (staff leaving), §6 (D22 retention, D24 minimising), Q8, Q9, slice 3 and 4; `docs/design/GA-I26a_assessment_history.md` (AH-D3, AH-D5, AH-D6, §3.1, §6.1 "changes side"); `docs/design/SCRBRD-138_captains_view.md` (§1.2 the gate, §1.3, D2, D3, A5); `docs/design/RECOGNITION_design.md` (D1, D3, D11, D14, D22, A16); `docs/policy/PUBLIC_DATA.md` (C3, C6, §5a, A11); `docs/design/SCRBRD-083_public_pages.md` §6 (option C, signed off 28 Sep); `packages/policy/src/roles.mjs` (:37 `TEAM_SCOPED_ROLES`, :54 `SUBJECT_SCOPED_ROLES`, :330 `player`, :376 `selfaccess`, :391 `guardian`, :414 `analyst`); `packages/policy/src/teams.mjs` (the age model); `db/00_schema_core.sql` (:63 `player.team_code`, :258 `match` with `team_code`, `away_team_code`, `starts_at` and no season column, :345 `match_squad`, :447 `role_assignment` with its own `team_code`); `db/08_schema_programme.sql` (:4256 `team_membership` and :4330 `player_team_membership_log()`, :5040 `season` and :5069 `season_for()`, :5451 `honour` with `team_code` "kept as it was" and `season_id`, :5941 `decide_role_request()` writing a `player` assignment's `team_code`, :337 `match_squad_age_eligible()`); `db/09_rls_policies.sql` (the 25 policies anchored on `(SELECT p.team_code FROM player …)`, :149 `honour_read`, :415 `development_note_read`, :432 `player_skill_read`, :86 `player_update`); `db/50_pad_resume.sql:197–277` (`app_can()`); `db/60_workload_consent_count.sql:166` (`still_at_school()`); `db/62_guardian_link_past_eighteen.sql` (the link past eighteen; its two membership triggers); `db/70` (`lift_at_school()`, `lift_my_sides()`); `services/api/write/roster-api.mjs:36–95` (`POST /api/players/:id/team`, `app.effective_on`); `services/api/io/import-api.mjs:199` (the CSV import's `coalesce($3, team_code)`); `db/98_seed_pilot.sql:379–420` (the personas; R Pillay's `player` assignment at `1XI`). Line numbers are `origin/main`'s on 15 Oct except where the branch is named.
**Reader:** Kameel on a phone first (§0, the decisions, §9); then the Opus lead who numbers the migrations; then the Opus agent who builds each slice and the Sonnet agent who builds the office's Season screen. Names are the seed's illustrative ones (Hilton, Westville; D Erasmus, R Pillay, K Naidoo, Mr Dlamini), never a real child's.
**Scope:** what happens to reads, writes, consents, honours and the captaincy when the school year turns and a boy's side changes. It does not reopen REACH's spellings, `app_can()`'s body, AV-D1–D5, STEP4's screens, RECOGNITION's twenty-five decisions, GA-I26a's nine, ACCOUNT_LIFECYCLE's twenty-four, or PUBLIC_DATA in any line. Where it must change a helper those designs drew (§2.10) it says which, and why the answer for every reader before the move is unchanged.

Plain words first in every section; the exact rule follows.

---

## Kameel's decisions (15 Oct 2026) — fixed

Recorded word for word. Nothing in this document reopens them; §9 asks only what they leave open.

- **D1 · Families keep previous records.** "A parent and a pupil do not lose sight of last season's fixtures, scorecards, plans and so on when the boy moves up." (Kameel, 15 Oct 2026)
- **D2 · The new coach inherits.** "The boy's new side's coach inherits his assessment history: scores, coaching points and targets." (Kameel, 15 Oct 2026)
- **D3 · Consents, honours and career figures carry over.** "Once a boy is 18, a published record may be kept." (Kameel, 15 Oct 2026)
- **D4 · Captaincy.** "The scorer updates the captain assigned to a side." (Kameel, 15 Oct 2026)
- **D5 · The old coach.** "The coach has oversight but doesn't own the record." (Kameel, 15 Oct 2026)
  The lead's reading, which this design builds and which Kameel should confirm (§4.2): the old coach keeps **read-only oversight** of what was recorded while the boy was in his side; he cannot add to that record or withdraw from it after the move; the new coach inherits the record for writing, per D2; nobody's authorship is erased.
- **D6 · When the old coach's oversight ends.** Kameel's three replies, in order: "ends after they leave the school" · "the child leaves the school" · "both would matter". (Kameel, 15 Oct 2026)
  Read as: the oversight ends at **whichever comes first** — the child leaving the school, or the coach leaving the school. The child's leaving ends it through ACCOUNT_LIFECYCLE slice 3's `player_leave()`; the coach's leaving ends it through ACCOUNT_LIFECYCLE §5's off-board, which ends his roles. Neither runs on a clock: each is an act someone takes, and the ending follows the act (§4.3).

---

## 0 · In one page

On 1 January the sides are re-formed. D Erasmus, U14A in 2026, is U15A in 2027; the matrics leave; the 1st XI has a new captain. Almost every read rule built so far asks "what side is he on **now**": the twenty-five `db/09` policies that anchor on `(SELECT p.team_code FROM player …)`, `side_reach()`'s branch (2), `my_sides()`, `my_fixture_ends()`'s branch (2), `db/100`'s `my_child_fixtures()`, `db/101`'s side rule, GA-I26a's three development tables, and the captain's gate (138 §1.2, "his *current* side"). Asked on 2 January, every one of them answers for U15A. Mrs Erasmus's Matches list would lose the U14A season she watched; Mr Dlamini, who rated the boy nine times, would read none of it; and the U15A coach would inherit nothing he did not already hold — which is what D2 wants, and what the current-side anchor already gives him.

The finding that makes this cheap: **the model of time already exists, in three places, and nothing has to be invented** (§1). A `season` row (school = the calendar year; `season_for(date)` finds it). A dated side membership, `team_membership`, written by trigger whenever `player.team_code` changes, with `joined_on` and `left_on`. And every fixture carries the side it was played for (`match.team_code`, `away_team_code`) and its own day (`starts_at`), as every honour carries the side it was awarded for and its season. The past does not move; only the pointer called "his current side" does. So the design adds one question beside "his side now": **"his side on that day"** — `side_on(player, school, date)`, read from the membership rows — and asks it wherever a row has a day of its own (a fixture, a bus, a nets session, a post, a plan, a score, a note). Where a row has no day (a consent, a link, a contact, the boy's own file) nothing changes, because nothing about those is about a side.

One real gap, found on the way (§1.2): **a pupil's side is stored twice** — on his `player` row, which the move route writes, and on his `player` assignment (`role_assignment.team_code`, written once at grant by `decide_role_request()`), which nothing moves. After a move he would read his *old* side's fixtures, posts and bus through the assignment and his *new* side's through nothing. SR-1 makes the player row the one truth and has the trigger that already writes the history carry the assignment with it.

The readers, after the move, in a sentence each (§2 has the table per reader):

| reader | last season | this season |
|---|---|---|
| **the parent, the pupil** | every fixture, scorecard, bus, nets, post and plan of the side he was on **on that day** (D1); his own file as always | the new side's, from the day he joined it |
| **the new coach** | the whole development record, scores, points and targets (D2), by the current-side anchor that already exists | writes it |
| **the old coach** | **reads** the scores, points and targets dated within the boy's time in his side (D5); **cannot write or withdraw** one; his name stays on what he wrote | nothing of the boy's new side |
| **a team-mate** | of a boy who joined: honours, caps, milestones — what the old side read too; **never** a score, a note, a target, a register row of the old side (its sessions anchor on their own side) | the side's rows, as today |
| **the captain** | the view is per fixture and per season (138); on 1 January the Home card is off by the season's own date; the scorer's mark on the sheet (D4) says who leads on the day | |
| **the analyst, the office, the director** | school-wide and unchanged: none of them keys on a side | |

**What moves on 1 January: nothing by itself** (§3). The office records leavers (`player_leave()`, lifecycle slice 3), moves boys by side (`POST /api/players/:id/team`, one act per boy, dated the day the side was named), and the director awards the new captains; the scorer marks the captain on each sheet (D4). The one automatic thing is the one that already is: the trigger writes the membership row, and now the assignment with it. The age trigger on the sheet (`match_squad_age_eligible()`) refuses a boy over his side's band for the new season, which is what tells the office whom it has not yet moved. A wrong move is undone by a move back dated the same day; both rows stay.

**What never happens** (§7): no capability that opens a row about a boy changes on the move, so his new side sees nothing his old side could not; the new side's assistant reads the old coach's note under the same tier the old assistant did; the old side's staff read nothing written at the new side; no public read gains a figure across seasons for one child.

**Build** (§8): six Opus slices, one Sonnet screen, in order; the assignment sync first because it is a bug today, the dated reach second because `db/99` §83 is its proof and is being written now.

---

## 1 · The model of time

### 1.1 Plain words

Three things in the schema already know what day it is.

1. **A season row.** `season` (`db/08:5040`): level, label, `starts_on`, `ends_on`, `cutoff_on`. School seasons are the calendar year ("2026", 1 Jan–31 Dec); club and representative seasons straddle ("2025/26"). `season_for(date, level)` finds the row for any day (`:5069`); the rows for 2024–2030 are seeded. `honour.season_id` and `competition.season_id` anchor on it. **`match` has no season column**: its season is `season_for(starts_at)`, and that is right — a stored copy would be a second place for the date to be true.
2. **A dated side membership.** `team_membership` (`db/08:4256`): `player_id`, `school_id` (copied at the time, so a boy who changes schools keeps his old school on his old rows), `team_code`, `joined_on`, `left_on` (NULL = where he is now), `reason` ('joined' | 'moved' and nothing richer, on purpose). Nobody writes it; writing `player.team_code` writes it, through `player_team_membership_log()` (`:4330`), a `SECURITY DEFINER` trigger with no INSERT or UPDATE policy on the table at all. The move route (`roster-api.mjs:36`) sets `app.effective_on` so the row carries the day the side was named, not the day it was typed; a future date is refused; a date earlier than the open row's `joined_on` is refused; same-day churn is kept as two rows. `still_at_school()` (`db/60:166`) reads it; `db/62`'s two triggers on it date and re-open the guardian links.
3. **The fixture's own side and day.** `match.team_code` and `away_team_code` are the sides the fixture was played for and never change; `starts_at` is its day; `match_squad` is who was named, per side, withdrawn rows kept. A scorecard is the log of that fixture. An honour carries `team_code` "kept as it was: an honour does not move sides when he does" (`db/08:5456`) and `season_id`.

So the question "which side was this fixture for" is answered by the fixture; "which side was he on that day" is answered by the membership; and "which side is he on now" is the open membership row, mirrored on `player.team_code`. The design needs no new entity: **not** a season join table, **not** a `season_id` on `match`, **not** a stored "season roster". It needs one derived question and one repair.

### 1.2 The repair: a pupil's side lives in two places

A pupil holds a `player` assignment (unnamed, team-scoped: R Pillay's is `1XI`, `db/98:400`) and a `selfaccess` assignment (named to him). `decide_role_request()` writes the `player` assignment's `team_code` once, at grant (`db/08:5941`, `v_team`). The move route writes `player.team_code` and nothing else; the CSV import the same (`import-api.mjs:199`). Nothing in `services/api` or `db/*.sql` updates a `player` assignment's `team_code` (confirmed by search, 15 Oct). So after Hilton moves D Erasmus from U14A to U15A:

- `my_sides()`, `my_fixture_ends()` branch (2), and every per-boy policy follow `player.team_code` → U15A;
- `app_can()`'s team test for his `player` assignment (`db/50:224`, `a.team_code = p_team`) → still U14A: he passes the **unnamed** branch for U14A's fixtures, posts, bus and sheet, and fails it for U15A's. His parent, reaching through him by name, is on U15A. The boy and his mother read different sides.

REACH-D4 (decided 14 Oct) makes `player` a `TEAM_SCOPED_ROLE` with a CHECK; it does not say who keeps the two in step. **SR-1 · The player row is the truth; the assignment follows it.** `player_team_membership_log()` (or a sibling trigger in the same migration) gains: on a change of `team_code` to a non-NULL value, `UPDATE role_assignment SET team_code = NEW.team_code WHERE role = 'player' AND active AND school_id = NEW.school_id AND person_id IN (the boy's accounts)` — the boy's accounts being `app_user.player_id = NEW.id` or a live verified `selfaccess` subject naming him, exactly the set `my_own_boy()` (`db/106`) computes. A change **to NULL never reaches the assignment**: a NULL team on a `player` assignment is REACH O8's hole, and the only route that sets `player.team_code` NULL is `player_leave()`, which ends the assignment in the same transaction (lifecycle D7 step 4). Until that lands, a NULL leaves the assignment on the old side, which is the narrower error. The trigger is `SECURITY DEFINER` as the history write is; `role_assignment` gains no new policy. A `db/99` section proves: after any move, the live `player` assignment's `team_code` equals `player.team_code`; after a move to NULL it is unchanged; a `guardian` or `selfaccess` row is never touched.

*Rejected: `app_can()` resolving a `player` assignment's team through `player.team_code`.* A role test inside `app_can()` (ADR 0003 forbids); and the assignment's own column is what the generated CHECK and People read.
*Rejected: dropping `team_code` from `player` assignments and letting them be school-wide.* That is O8 for every pupil.

### 1.3 The question: his side on that day

**SR-2 · `side_on(p_player uuid, p_school uuid, p_on date) RETURNS SETOF text`** — the sides a boy was on at a school on a day: the `team_membership` rows for him at that school (sport `cricket`) with `joined_on <= p_on AND (left_on IS NULL OR left_on >= p_on)`. `STABLE SECURITY DEFINER`, pinned path, `scrbrd_app` only, as `db/106`'s helpers are.

- **"Now" is a day like any other.** For today or any future day the open row (and only it) matches, so a policy that asks `side_on(player, school, <the row's day>)` gives the current side for future fixtures and the then-side for past ones in one predicate. No branch says "now"; there is no second rule to keep in step.
- **A day with two sides** (same-day churn: moved to the 1st XI at nine, back at noon, two rows with `joined_on = left_on`) answers both. A fixture on that day reaches the family through either, which is honest: he was named for both that day. It is also how a wrong move is undone (§3.3).
- **A day before his first membership** answers nothing. A fixture his sheet names him for still reaches him and his family through the sheet branch (3), as a boy playing up does; a fixture of his first side dated before he joined it does not. (Q2 asks Kameel to confirm the newcomer's bound: a boy who joins U15A in January does not thereby read U15A's 2026 season.)
- **A departed boy** (`player_leave()`: `team_code` NULL, memberships closed) has closed rows only, so his family keeps every past fixture of his then-sides (ACCOUNT_LIFECYCLE §3.6: "Matches: his past ones") and no future one, with no special case.
- **The row's day.** A fixture: `starts_at` on the Johannesburg calendar (as `sa_today()` spells today; Opus names the one function, `sa_date(timestamptz)` or the existing idiom, and every policy uses it). A trip: its fixture's day. A training session: its own date. A post: `published_at`'s day; a plan: its fixture's day. A notice: its day. A score: `assessed_on`; a note: `observed_on`; a target: `set_on`. A consent, a link, a contact, an injury, a milestone, a cap: **not dated by side at all** — they are about the boy (REACH class C) and anchor on the row's player id, which the move does not change.

### 1.4 What this does not add

No `season_id` on `match` (derive); no `team_membership` write policy (the trigger stays the one door); no "season roster" table (the sheet and the membership are the roster); no stored "previous side" on `player` (the closed membership row is that); no job on a clock (§3).

---

## 2 · Reads after the move, reader by reader

### 2.0 Two kinds of anchor, and which this design touches

Every read rule built so far is one of two shapes. Knowing which is the whole of the analysis.

| shape | rows | the anchor today | after the move | changed here? |
|---|---|---|---|---|
| **row-anchored** | `match` and its satellites, `trip`, `training_session`, `news_post` (team, plan), `match_squad`, `training_attendance` (the session's side), `honour` (`team_code`, `season_id`), `team_cap`, `competition_entrant`, the record boards (RECOGNITION D22) | the row's own side and day | unchanged: the fixture of 14 Dec is U14A's for ever | **no** — but the *family's* reach to them through a boy is (below) |
| **current-side anchored, about one boy** | the 25 `db/09` policies: `injury`, `emergency_contact`, `development_note`, `player_skill`, `equipment_issue`, `honour_read` (:149), `team_membership_read`; GA-I26a's `development_target`; `db/25` discipline, `db/47` consents, `db/60` health, `db/62` | `(SELECT p.team_code FROM player …)` | follow the boy: the new side's staff read, the old side's stop — which is D2 for the development record, and today's rule for health (SCRBRD-110, not reopened) | **three gain the oversight branch** (§4); **`honour_read` gains the row's own side** (§5.2); the rest unchanged |
| **current-side anchored, the family's reach to a side** | `side_reach()` branch (2); `fixture_end_reach()`'s and `my_fixture_ends()`'s `m.team_code = p.team_code`; `my_sides()`; `db/100` `my_child_fixtures()` (:146, :159); `db/101`'s side rule; `lift_my_sides()` (db/70); R-E's notice rule | `player.team_code` | **become dated**: the side he was on on the row's day (§2.10) | **yes** |

### 2.1 The parent

**Plain words.** Mrs Erasmus keeps watching U14A's 2026 season after the move: the fixtures, home and away, with their toss, umpires and weather; the scorecards; the buses and their notes; the nets; the team posts and the plan for each Saturday. From the day he joined U15A she reads U15A's. She reads nothing of U14A dated after he left it, and nothing of U15A dated before he joined it. Everything about *him* as a person — his file, consents, contacts, availability, injuries, honours, career — is hers exactly as before, because none of it is about a side.

| rows | reads after the move | anchor, and why |
|---|---|---|
| U14A fixtures ≤ his last U14A day; their log, toss, umpires, weather, conditions, result | **yes** | `my_fixture_ends('fixture.read')` branch (2), dated (§2.10); `db/100`'s log read re-expressed on the same rule |
| U14A fixtures after that day | no | the then-side does not match; the sheet branch (3) still admits any he is named on |
| U15A fixtures from the day he joined | yes | the open row; "now" is a day (§1.3) |
| U15A fixtures before he joined | **no** (Q2) | he was not on the side; the public page carries the side's results at team level |
| U14A's buses, nets, posts, plans of last season | yes | `trip_read` at its end, `training_session_read`, `db/101`, each dated by the row's day |
| the sheet's names and order (REACH R-H `fixture_sheet()`) for a 2026 U14A fixture | yes | gated by her child on that sheet (branch 3), unchanged |
| her child's file, consents, contacts, availability history, injuries, discipline tier, figures, honours, caps, milestones, Passport | yes, as before | class C: the row's player id; the move changes no player id |
| his development scores, notes, targets | **no**, as before | she holds none of `player.development.read`, `player.note.read` (`roles.mjs:391–412`); GA-I26a AH-D3; D5 is about coaches |
| another boy on U14A or U15A as a person | never | class D |
| a lift seat she holds on a U14A fixture after his move | **voided on the move** (SR-4, §3.1) | the fixture is no longer his side's and she can no longer read it; `db/70`'s void path, as `player_leave()` runs it |

Two children at two schools, a link pending, ended or revoked: as REACH §2.1, nothing here touches `app_can()`'s link test.

**Changed 21 Oct 2026 (Kameel, READERS_child_data Q5, with Q15):** the parent's "discipline tier" in the row above is not in her reads. She gets it only after Westville's information officer signs off, as READERS Q15 defers it; until then the app says nothing of a discipline record, as the letter stays the channel.

### 2.2 The pupil

**Plain words.** D Erasmus's Matches list keeps his U14A season and gains U15A's from the day he joined. Through `selfaccess` he reads his own file at every tier the bundle gives him, unchanged. Through his `player` assignment — now carried to U15A by SR-1 — he reads what U15A reads together: the sheet, the log, the bus, the nets, the posts. Of his old team-mates he now reads nothing new and nothing he could not read before: their names on U14A's 2026 sheets and scorecards (a fixture he may still read), their honours and caps on the U14A board of that season (row-anchored, §5.2). Their season figures and career pages: REACH-D2 left them open to a team-mate; after the move he is no longer their team-mate at team scope, so `player.performance.read` at U14A no longer fits him — the move narrows, which is right, and the scorecards he keeps (Q4) still show their figures for the matches he played.

| rows | reads after the move | anchor, and why |
|---|---|---|
| his then-side's fixtures, log, bus, nets, posts, plans, dated within his membership | yes | `my_fixture_ends()`/`my_sides()` dated, through his `selfaccess` link naming him (branch 2), and `my_own_boy()` for the sheet (branch 4) |
| his new side's, from joining | yes | the `player` assignment at U15A (SR-1), unnamed branch (1) |
| his old side's fixtures after he left | no | neither branch fits |
| a 2026 team-mate's C1 rows (masked row, honours, caps, milestones) | only through a row anchored on U14A for 2026 (the honour's own side, §5.2) — **not** his current `player` row, which no longer fits | `honour_read`'s own-side branch is per honour, season-stamped |
| a 2026 team-mate's career page | no | `player.performance.read` at team scope no longer fits; was open under REACH-D2 while he was there |
| his own scores (history), targets | yes | `selfaccess` holds `player.development.read` (AH-D3) |
| the coach's notes and coaching points about him | never | `player.note.read` is not his (AH-D2) |

**The captain's view** after the move: §6.

### 2.3 The new coach (D2)

**Plain words.** The U15A coach, from the day D Erasmus's row says U15A, reads the boy's whole development record — every score Mr Dlamini gave, every coaching point, every target — and writes the next ones. He reads the boy's U14A **fixtures** only as anyone at Hilton's U15A does: not at all through the boy (the coach is unnamed; branch 2 is for named links), and the side's record is the side's. That is unchanged and right: the scorecards of U14A's season are a thing the U15A coach has no capability over except through the public page or a school-wide role.

| rows | reads | writes | why |
|---|---|---|---|
| `player_skill`, `development_note`, `development_target` for the boy, every row, every date | **yes** | **yes**: new scores, points, targets; `skill_withdraw`/`note_withdraw`/`target_withdraw` (AH-D5) of any row, including Mr Dlamini's | current-side anchor (`db/09:432`, `:415`; GA-I26a §1.2) under `player.development.*`, `player.note.*` at (Hilton, U15A) with the boy's id; D2 says inherit, AH-D5 says a departed coach's point "must be withdrawable by the coach who follows him" |
| his injury record, availability, workload, contacts, discipline tier | as the role holds at the current side, as today | as today | SCRBRD-110, STEP4; not reopened: health follows the current side and has no oversight branch (§4.4) |
| the "since the last look" panel | the window starts at the move: "U15A since 1 Jan" (AH-D6) | — | the panel counts only sessions of his **current** side |
| U14A's 2026 fixtures, sheets, log | no (unless school-wide) | — | unnamed, team-scoped at U15A; row-anchored on U14A |
| the boy's U14A 2026 register rows | no | — | `training_attendance` anchors on the session's side |

**Changed 21 Oct 2026 (Kameel, READERS_child_data Q5):** the coach keeps the discipline tier in the row above: "Coaches now, parents later." The row stands for the coach. Today the coach holds no `discipline.read` (`roles.mjs`; SCRBRD-136-137 says discipline is "not his"), so Opus settles the capability before the row is drawn.

Authorship: every row keeps `assessed_by`, `author_id`, `set_by`; the strip says "R Pillay, coach" or, once his assignment has ended, "a former coach" (AH-D6 "a coach leaves"). Nobody's authorship is erased (D5).

### 2.4 The old coach (D5, D6)

**Plain words.** Mr Dlamini, who coached the boy on U14A in 2026, keeps **oversight**: he can open the scores, coaching points and targets that were recorded while the boy was in his side, read them, see who wrote them and when, and see whether a later coach withdrew one. He cannot add a score, a point or a target for the boy, and he cannot withdraw one — not even his own. He reads nothing recorded at U15A. The oversight lasts until the boy leaves the school, or until he himself leaves the school, whichever is first (D6), and nothing about it runs on a clock. The boy's health, availability, contacts and discipline are not part of it: those are today's current-side rules (SCRBRD-110, STEP4) and this design does not widen them to a former coach.

| rows | reads | writes | why |
|---|---|---|---|
| `player_skill`, `development_note` (notes and coaching points), `development_target` rows for the boy **dated within his time on the coach's side** | **yes**, read-only, every column the tier gives (score, body, target, author, withdrawn marks) | **no**: insert, upsert, withdraw all refused | the oversight branch (§4.2): the caller held the capability at (school, the boy's side on the row's day) on that day, and still holds a live assignment at the school, and the boy is still at the school |
| rows dated after the boy left his side | no | no | the boy's side on that day is U15A, which he did not hold |
| rows dated before the boy joined his side (an earlier coach's) | no | no | the same test; oversight is of what was recorded "while the boy was in his side" (D5) |
| a withdrawal mark on his own 2026 score, made by the U15A coach in 2027 | yes, struck through with who and why | — | AH-D5: a withdrawn row stays readable |
| the boy's injury, availability, load, contacts, discipline | **no** | — | not in D5; current-side anchoring stands (SCRBRD-110 §6.5; STEP4) |
| U14A's 2026 fixtures, sheets, log, posts | yes, as the side's coach, as today | as today | row-anchored on his side; unchanged |
| after the boy leaves the school (`player_leave()`) | **no** | — | D6 first reading; §4.3 |
| after he himself is off-boarded (`role_assignments_end_all()`) | **no** | — | D6 third reading; `app_can()` requires `active`, and the oversight predicate requires a live assignment at the school |

### 2.5 A team-mate

**Plain words.** A boy on U15A in 2027 reads of D Erasmus what the side shares (REACH C1): his masked roster row, his honours, caps and milestones. He reads none of D Erasmus's 2026 U14A register rows (the session's side is U14A), none of his scores, notes or targets (never), and none of U14A's 2026 fixtures (the side's record, through no capability he holds). A boy still on U14A in 2027 reads nothing new about D Erasmus: the 2026 fixtures, sheets and scorecards he could read before (row-anchored on U14A, and he is on U14A) he reads still; D Erasmus's honour of 2026 stays on U14A's 2026 board (§5.2); D Erasmus's current row is U15A's.

| reader | rows about the moved boy | reads | why |
|---|---|---|---|
| new team-mate | masked `player` row, honours, caps, milestones | yes | C1 under `player.profile.read` at the current side; the old side read the same (§7 item 1) |
| new team-mate | 2026 register rows, scores, notes, targets | **never** | the register anchors on the session's side; C2 holds no team-mate capability |
| new team-mate | U14A 2026 fixtures, sheets, scorecards | no | row-anchored on U14A; he is not at U14A |
| old team-mate | U14A 2026 fixtures, sheets, scorecards with D Erasmus named | yes, as before | row-anchored; he is still at U14A |
| old team-mate | D Erasmus's 2026 honour on U14A's board | yes | `honour_read`'s own-side branch (§5.2); RECOGNITION D22 |
| old team-mate | D Erasmus's current masked row, his 2027 honours | no | current side is U15A |

### 2.6 The captain

Unchanged in what he reads (138 §3: nothing beyond `player`'s reads across his side) and changed in **when** the view is on: the honour is season-bound and side-bound, so on 1 January the Home card is off by the season's own date (`season_for(sa_today())` is 2027; the honour's is 2026), and after a move the honour's side no longer equals his (138 §1.3). D4 adds the scorer's mark on the sheet, which says who leads on the day: §6.

### 2.7 The analyst

**Plain words.** School-wide and unchanged. `analyst` (`roles.mjs:414`) holds `team.read`, `fixture.read`, `player.profile.read`, `player.performance.read`, `analytics.read`, `competition.read`, `opposition.read`, with `team_code` NULL, so every side's row-anchored rows and every boy's C1 and figures are his before and after, and no judgement is (GA-I24-I25 D5; AH-D3). The only thing the rollover gives him is the dimension: `career_by_season` folds the log by `season_for(starts_at)`, and a boy's 2026 (U14A) and 2027 (U15A) figures are two rows of one boy, inside the school, never public (§7 item 2).

### 2.8 The office

**Plain words.** School-wide (`schooladmin`, `team_code` NULL) and unchanged in reach. It keeps the record and does not read the judgement (`schooladmin` holds neither development nor note capabilities, `roles.mjs:198`). What the rollover gives it is **work** (§3): the leavers, the moves, the captains' honours, the due list; and one read, `season_rollover_due(school)` (SR-5), that lists what is not yet done.

### 2.9 The director

**Plain words.** School-wide; reads scores, targets, notes (AH-D3) for every boy at the school before and after; decides honours (`recognition.decide`, RECOGNITION A5) and so the new captains; holds `player.profile.manage` and so may record moves and leavers himself (ACCOUNT_LIFECYCLE D7's list). Nothing here changes his reach.

### 2.10 How §2.5's helpers change

**Plain words.** `side_reach()` asked "is this the boy's side"; it now asks "was this the boy's side on the row's day". For a row with no day (a side's reference row read with the zeros fixture) the day is today, which is the open membership row, which is the current side: the answer for every existing caller is unchanged until a row has a day of its own.

The exact changes, each with the line in `db/106` on the branch:

| helper | today | after SR-2 |
|---|---|---|
| `side_reach(cap, school, team, fixture)` branch (2) (`db/106:272–278`) | `JOIN player p … WHERE p.school_id = p_school AND p.team_code = p_team` | `JOIN player p … WHERE p.school_id = p_school AND p_team IN (SELECT side_on(p.id, p_school, side_day(p_fixture)))` where `side_day(zeros) = sa_today()` and otherwise the fixture's day; `app_can()` asked at `(p_school, p_team, p.id, p_fixture)` as now |
| `fixture_end_reach()` branch (3), (4) (`:290–316`) | the sheet | **unchanged**: the sheet is the row's own fact |
| `my_fixture_ends(cap)` (`:333–369`), the two `m.team_code = p.team_code` arms (`:342`, `:354`) | current side | `m.team_code IN (SELECT side_on(p.id, m.school_id, sa_date(m.starts_at)))` (home arm), the away arm likewise with `m.away_school_id`; the sheet arms unchanged; the per-boy `app_can()` asked at the fixture's end as now |
| `my_sides(cap)` (`:373–381`) | `(school_id, team_code)` of the open row, `p.team_code IS NOT NULL` | returns `(school_id, team_code, joined_on, left_on)` from every `team_membership` row of the boys the caller's links name, `app_can()` asked at each row's `(school, team, boy)` with the zeros fixture; a policy over a dated row probes `s.joined_on <= <day> AND (s.left_on IS NULL OR s.left_on >= <day>)`; `training_session_read` (`:482–487`) does so with the session's date |
| `my_child_fixtures()` (`db/100:137–163`) | `m.team_code = p.team_code` (:146) and the away arm (:159) | the same two dated arms; §83 (agree) must still hold, so `db/100` is re-expressed **in the same migration** |
| `db/101`'s side rule for ordinary team posts | side now | the side on the post's `published_at` day; the plan's sheet branch unchanged |
| R-E (`notification_read`, team-and-no-child) | `side_reach(cap, school, team, zeros)` | the notice's day in place of zeros' today |
| `lift_my_sides()` (`db/70:395`) | current side | **unchanged**: a lift is on a fixture ahead and the seat is voided on a move (SR-4); its one-season purge is already built |
| `trip_read` (`:468–478`) | `my_fixture_ends('transport.read')` | unchanged in text; dated through the helper |
| the pad's three tables, `match_squad_read`, `match_availability`, `training_attendance`, `ball_event_read`'s per-boy figures | — | untouched (AV-D4; class E; C1; AV-D3) |

**Widening check, stated once.** For every reader whose assignments name nobody (staff, pupils through `player`, spectators, the office) nothing changes: branch (1) is `app_can()` with all-f and does not read the membership. For every named reader (a guardian, a pupil through `selfaccess`, an enquiry) the set of side rows reachable after SR-2 is, for rows dated today or later, exactly the set before (the open row is the current side); for rows dated in the past it is the then-side's rows instead of the now-side's. So the only rows that become readable that were not are **past rows of a side the boy has left**, which Decision 1 asks for; and the only rows that stop being readable are **past rows of a side the boy had not yet joined**, which nobody decided a family should have (Q2). The proof is §83 (literal) rewritten with `side_on()` in the spelled-out text (§8.2).

**Cost.** `side_on()` is a probe on `team_membership (player_id, school_id, …)`; `my_sides()` returns a few rows per child instead of one; `my_fixture_ends()` adds one `IN (SELECT side_on …)` per candidate fixture of the boy's schools, which the existing index on `team_membership (school_id, sport, team_code, joined_on)` and a new one on `(player_id, school_id, joined_on)` serve. The §83 (cost) figures on the forty-fixture season are re-measured and recorded in the migration's header (SR-2 is refused if the guardian-of-two `match` read exceeds twice `db/106`'s 34 ms).

---

## 3 · What moves on 1 January, or on the office's word

### 3.1 Plain words, then the steps

Nothing moves because the date did. A season row for 2027 already exists; `season_for()` already answers 2027 on 1 January; the captain's Home card already goes off by the season's date (138 §1.3); the age trigger on the sheet already refuses a boy over his band for the new season's cut-off (`match_squad_age_eligible()`, `db/08:337`, on `season_cutoff()`). Everything else is an act by a named person, dated the day it was decided, recorded by the row it writes. ACCOUNT_LIFECYCLE Q8 ("nothing moves by the clock but the link, and that is already the rule") and `db/62`'s header ("nothing widens by the clock") are the rule here too.

| # | step | who presses | what it writes | automatic? |
|---|---|---|---|---|
| 0 | **the Season screen** (SR-5; Sonnet over existing routes, §8.4): the office opens Settings → School → Season and sees three lists derived at read time — boys over their side's band for the coming season (`age_band(born, season_cutoff(next 1 Jan))` against `teams.mjs`'s band of `player.team_code`), sides with no live `captain` honour for the coming season, boys with no side — and the leavers' sheet | the office, the director (`player.profile.manage`) | nothing; it is a read (`season_rollover_due(school)`) | the lists are derived; nothing acts on them |
| 1 | **leavers** (matrics, boys withdrawn): one `player_leave(player, left_on, 'finished', NULL, note)` per boy — ACCOUNT_LIFECYCLE slice 3/4, not re-designed here; the Season screen offers the open-age sides' rosters with a tick per boy and one transaction per tick | the office, the director | closes memberships, `team_code` NULL, the departure row, the `player` role ended, seats voided, the family's and staff's notices (AL D7, steps 1–8); `db/62` dates the guardian links at the later of `left_on` and majority | the consequences are the function's; the act is a person's. **Q5**: AL D7's 30-day backdate limit against a January office recording a December leaving |
| 2 | **moves**, by side: for each boy, `POST /api/players/:id/team { teamCode, effectiveOn }` with `effectiveOn` the day the side was named (trials end; a selection meeting); the Season screen offers the roster by current side with a "next" column **suggested** from the band and never applied without a tap; one request per boy, or one transaction per side with the same `effective_on` (SR-3) | the office, the director (`player_update`: `player.profile.manage`, `db/09:86`); **not** a coach (`team.manage` does not write `player`) | `player.team_code`; the trigger writes the membership row (`moved`) and, with SR-1, the boy's `player` assignment; the trigger refuses a date earlier than the open row's start and the route a future one | the history and the assignment follow; nothing else |
| 2a | **seats on fixtures of the side he has left** dated after `effective_on`: voided, the asker told, as `player_leave()` does (AL D7 step 7; `db/70`'s void path) — **SR-4** | — | `lift_seat` → `void` | yes, inside the move's transaction |
| 3 | **captains**: the director (or principal, office under `recognition.manage`) awards `captain` and `vice_captain` honours for the 2027 season per side (`POST /api/honours`); the Season screen lists sides without one | `recognition.manage` / `recognition.decide` (RECOGNITION A5) | `honour` rows, `season_id` = 2027, `team_code` = his side on the day (`honour_stamp()`) | no; the Home card turns on at next load (138 §1.3) |
| 4 | **the sheet's captain** (D4): on each fixture's sheet the scorer marks who leads the side that day (§6) | the scorer, on the pad; or the coach on the sheet | `match_squad.captain` (SR-6) | no |
| 5 | **the coming season's fixtures and competitions**: as today (`fixture.update`, `competition.manage`); `competition.season_id` = 2027 | the office | — | no |
| 6 | **after**: the Season screen's lists empty; the due list for retention (AL D22) is separate and unchanged | — | — | — |

**Order.** Leavers before moves (a boy who has left should not be moved; `player_leave()` closes his membership and a later move would reopen one); moves before honours (the honour stamps the side at award, `honour_stamp()`); honours before the first fixture (the captain's view and the Player-of-the-Match gate read them); the sheet's mark on match day. None of it is enforced by code except the refusals that already exist (the age trigger, the date trigger, `honour_once_a_season`); the Season screen shows the order.

**What is never on a clock.** No job moves a boy up by his birthday or his band; no job ends a season, withdraws last year's honours, closes memberships, or ends the old coach's oversight; no job prompts the eighteen-year-old (§5.3). The three date comparisons that *look* like clocks are reads: `season_for(today)` for the Home card, `side_on(…, today)` for a side's reference row, and the age trigger on the sheet. Each is a predicate evaluated when somebody asks, as `valid_until` is.

### 3.2 Matrics leaving (lifecycle slice 3)

Not re-designed: `player_leave(kind = 'finished')` as ACCOUNT_LIFECYCLE D6–D11. Two rollover facts for the lead:

- A matric's **guardian link** stays live until his eighteenth birthday if he is still a minor on leaving (`db/62`: `greatest(left_on, majority_on(born))`), and ends on `left_on` if he is already eighteen. The parent of an eighteen-year-old leaver therefore loses her sight of his past fixtures **on the leaving day** (her link names nobody live). D1 says families keep records; this is the one case where the family's reach ends, and it ends because the boy is an adult who has left, which is the rule signed off on 28 Sep (SCRBRD-110 §7.4; SCRBRD-083 §6.4). He himself keeps `selfaccess` and reads his own past fixtures through the dated rows (§1.3). Said plainly in **Q6**.
- The old coach's oversight of a leaver ends with the leaving (D6, §4.3).

### 3.3 Undoing a wrong move

- **A wrong side:** a second move back, `effectiveOn` the same day as the wrong one. The trigger allows an equal date (it refuses only `v_on < v_open.joined_on`), closes the wrong row with `left_on = joined_on`, and opens the old side again from that day (`reason = 'moved'`, both rows kept: "Same-day churn is kept, not collapsed"). SR-1 carries the assignment back. The dated reads give the family both sides for that one day. Nothing is edited or deleted; the history says what happened. *Rejected: a `team_membership` edit or delete door.* The table's value is that it has none.
- **A wrong date** (the move was dated 5 Jan and should have been 12 Jan): no edit exists and none is added. The office records the correct move with the correct date **only if it is later** than the wrong one (the trigger refuses earlier). A wrong date that is too late cannot be moved earlier; the record keeps the typed date and the office's note (a development note is not the place; the roster has no note). **Q7** asks whether a `team_membership_redate()` door under `player.profile.manage`, logged, is worth building; the recommendation is not yet.
- **A wrong leaver:** `player_return(player, joined_on, team_code)` (AL D7): the departure row closes, the membership reopens, `db/62` reopens the links it may, the `player` role is granted anew.
- **A wrong captain honour:** withdrawn with a reason (`honour` is never edited), awarded again. **A wrong sheet mark:** the scorer marks another boy; the mark moves (§6).
- **A move made to the wrong boy:** the same as a wrong side, for that boy; his assignment follows back.

---

## 4 · Assessments under D2, D5 and D6

### 4.1 Inheritance by current side (D2)

Nothing to build. `player_skill_read` (`db/09:432`), `development_note_read` (`:415`) and GA-I26a's `development_target` policy anchor on `(player.school_id, player.team_code, player_id)`, so the moment the row says U15A every U15A holder of `player.development.read` / `player.note.read` reads the whole history, and every holder of the write capabilities writes and withdraws. `coaching_point_write()`, `target_set()`, `skill_withdraw()`, `note_withdraw()`, `target_withdraw()` check the write capability for the boy's current side inside themselves (GA-I26a §1.2, §5), so the new coach may withdraw Mr Dlamini's 2026 score with a reason and the strip shows it struck with "withdrawn 3 Feb by the coach"; `assessed_by` stays Mr Dlamini.

Who inherits, exactly: the U15A coach (reads, writes), the U15A assistant (reads; writes a plain note; cannot write a point or a target, AH-D3), the director (school-wide, as before), the principal (notes only, as before). **Not** the U15A team manager (no development capability), **not** the boy's new team-mates (none), **not** his parents (none), **not** the analyst (none). The tier is unchanged by the move; only who holds it at his side changes. That is §7 item 1.

### 4.2 Oversight (D5): the exact predicate

**Plain words.** The old coach's read is a second branch on the three read policies, and on nothing else. It asks four things: is the boy still at this school; is the caller still at this school; did the caller hold the read capability at the side the boy was on on the day the row was written, on that day; and is this row one of those rows. It never appears on an INSERT or UPDATE policy or inside a write function, so there is no way to write through it.

**SR-7 · `development_oversight(p_capability text, p_player uuid, p_school uuid, p_on date) RETURNS boolean`**, `STABLE SECURITY DEFINER`, pinned path, `scrbrd_app` only:

```sql
SELECT
  -- D6, the child: he is still at this school (an open membership here)
  EXISTS (SELECT 1 FROM team_membership m
           WHERE m.player_id = p_player AND m.school_id = p_school AND m.left_on IS NULL)
  -- D6, the coach: he is still at this school (any live assignment here; db/70's lift_at_school())
  AND lift_at_school(p_school)
  -- D5: an assignment of the caller that granted the capability, at this school,
  --     at the boy's side on the row's day, whose own window covered that day;
  --     unnamed (a coach, an assistant: never an enquiry link); not platform-wide
  AND EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc ON rc.role = a.role AND rc.capability = p_capability
     WHERE a.person_id = app_user_id()
       AND a.school_id = p_school
       AND a.team_code IS NOT NULL
       AND a.team_code IN (SELECT side_on(p_player, p_school, p_on))
       AND coalesce(a.valid_from, a.created_at::date) <= p_on
       AND coalesce(least(a.valid_until, a.revoked_at::date), 'infinity'::date) > p_on
       AND NOT EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id))
```

Notes for the builder:

- **The assignment need not be live**, only the caller's presence at the school (`lift_at_school()`). A coach who moved from U14A to the 2nd XI in 2027 (his U14A assignment ended, a 2nd XI one made) keeps oversight of the boys he coached on U14A in 2026, because he is still at the school and held the side then. A coach off-boarded loses every assignment and `lift_at_school()` is false: D6's third reading. A `duty_suspension` on the then-assignment is not consulted (the row is history); a suspension on his live assignments is `app_can()`'s business and does not cut oversight — **the lead may choose to cut it too**; say so in the migration header either way.
- **Why the assignment's window and not only the side.** Anchoring on "the boy's side then" alone would give the 2027 U14A coach — who never coached the boy — the 2026 rows of every boy who was on U14A then. D5 says *the coach* has oversight, not *the side*; the window test is what makes it his. (Q3 confirms.)
- **Why `team_code IS NOT NULL`.** A school-wide holder (the director) passes `app_can()` at the current side already; the branch is for the side's staff. Keeping school-wide rows out of the oversight branch keeps the two branches disjoint and the proof simple.
- **The row's day:** `player_skill.assessed_on`, `development_note.observed_on`, `development_target.set_on`. A coaching point is a note (AH-D2) and takes the note's day. A withdrawal mark on any of them is a column on the same row and is read with it.
- **`p_on` before the boy's first membership** or on a day with two sides: `side_on()` answers as §1.3; a coach who held either side that day passes.

The three read policies become `<today's app_can() at the current side> OR development_oversight(<cap>, player_id, school_id, <the row's day>)`. The write policies, the five definer functions and the `RESTRICTIVE` cuts (support sessions; AL Q9's departed-pupil cut) are **not** touched. The `skills_history`, `coaching_points`, `targets` and `development_since` reads need no change: RLS is the floor and the rows appear; `development_since` for a boy on another side is a panel about sessions of his current side, which the old coach does not hold, so it shows the scores and targets and no session line (AH §4.2: "a reader who may not read the side's sessions gets no session line"). The access log already names the boy on every read (`RESTRICTED_FIELDS`), so an old coach's oversight read is one row against the boy with the coach's name, which is what oversight should leave behind.

### 4.3 When oversight ends (D6)

| event | what ends it | by whom | on a clock? |
|---|---|---|---|
| **the child leaves the school** (`player_leave()`, lifecycle slice 3/4) | the first conjunct: no open membership at the school | the office, the director | no: an act, dated `left_on` |
| **the coach leaves the school** (off-board, `role_assignments_end_all()`, lifecycle slice 5) | the second conjunct: no live assignment at the school | the office | no: an act |
| the coach's one assignment ends but he holds another at the school | **nothing ends** (§4.2 note 1) | — | — |
| the child comes back (`player_return()`) | oversight **resumes** for the rows dated within the coach's then-window | the office | no |
| the child is minimised (AL D24, years after leaving) | already ended at leaving; the rows are deleted two years after leaving (AH-D6, AL §6.2) | the office | no |
| the season after the move, or any date | **nothing** | — | — |

Both endings follow acts that other designs already define; this design adds no door and no job. Kameel's "both would matter" is read as both endings, whichever is first (the predicate is a conjunction, so either falsifies it), and he should confirm that reading in §9 Q1.

### 4.4 What the boy's file does not open to

- **His new team-mates:** never (no C2 capability in `player`; AH-D3 row "a pupil captain over a team-mate").
- **The old side's assistant:** reads under oversight exactly what he read before the move — the rows dated within the boy's time on his side, under `player.development.read` (scores, targets) and `player.note.read` (notes, points) as `assistantcoach` holds them (`roles.mjs:274`); nothing dated at U15A. Writes nothing (he could not write a point or target before either).
- **The old side's team manager:** nothing (no development capability, before or after).
- **A coach new to the old side in 2027:** nothing of boys who have left it (the window test).
- **The old coach, of the boy's health, load, availability, contacts, discipline:** nothing (§2.4). D5 names "the record" the lead reads as the development record GA-I26a defines; SCRBRD-110's health boundary is not widened to a former coach by this document.
- **A parent, the boy himself:** as AH-D3 (the boy reads his own scores and targets through `selfaccess`; neither reads a note or a point).

---

## 5 · Consents, honours, career, and eighteen (D3)

### 5.1 What carries over unchanged

Everything keyed on the boy and not on a side. Listed so the proof can assert each:

| record | key | on the move | why nothing changes |
|---|---|---|---|
| `public_name_consent`, `player_never_public`, `public_names_off` (the school's per-band switch) | player; school and age band | unchanged | per child, judged on the day served (PUBLIC_DATA §5a); a boy who moves up a band is governed by the band he is in on the day a page is served, through `birth_age_group()` |
| `health_monitoring_consent` (SCRBRD-110) | player | unchanged | per child |
| `passport_consent`, `player_scouting_consent` | player, schools | unchanged | per child |
| the guardian link (`assignment_subject`), the `selfaccess` link | player | unchanged | per child; `db/62`'s dating is on leaving and majority, not on a move |
| `honour` | player, `season_id`, `team_code` at award | unchanged rows; **read** gains the row's own side (§5.2) | "an honour does not move sides when he does" |
| `team_cap`, `player_milestone`, `player_best`, the record boards | the fixture's side (RECOGNITION D22) | unchanged | derived from the log and the sheets |
| `career`, `career_by_season`, `dismissal_breakdown`, `bowler_day` | the log, folded by `season_for(starts_at)` | unchanged | the log carries `player_id`; a season is a date range |
| `emergency_contact`, `injury`, `disciplinary_record`, `player.*` PII | player; read at the current side | the readers follow the side as today | not reopened |

### 5.2 Honours: the row's own side

`honour_read` (`db/09:149`) anchors on the boy's **current** side, so after the move D Erasmus's 2026 U14A captaincy is readable by U15A's staff and side and no longer by U14A's — the opposite of what the table's own comment and RECOGNITION D22 ("a U15A boy reads the U15A board, including a performance by a boy now in the 1st XI … because the honour table already keeps an honour on the side it was awarded for") intend. **SR-8:** `honour_read` becomes `<today's clause> OR app_can('player.profile.read', honour.school_id, honour.team_code, honour.player_id, zeros)`: the side it was awarded for, as well as his side now. Narrowing: none (the current-side clause stays). Widening: the old side's staff and pupils, who read it before the move, read it after; the honour is a C1 fact the side shares and may be public (A5). The boy himself, his parents, the office and the director are unaffected (they pass the first clause). RECOGNITION R5c or R9 is the natural migration to carry it; the lead decides.

### 5.3 Eighteen, and "a published record may be kept"

**Plain words.** D3's second sentence restates what is already decided and signed off, and this design adds no consent and no rule. Until his eighteenth birthday a verified guardian's consent names him (C1); from the birthday "his own consent counts … until he gives it, his guardian's stands" (C6; §5a: a record he made before 18 counts for nothing, and once he has spoken only his records count); while he is still at school a guardian may still say **no** but not **yes** (083 §6 option C, `db/62` item 4); a "no" from anyone competent is immediate and reaches the past (C3). So "a published record kept past 18" means: **his name stays on the scorecards and the honours board under the consent lawfully obtained while he was a child, until he or (while at school) a parent withdraws it** — which is exactly 083 §6.4's officer position. Nothing to build.

Two things the lead should check are in place, because the design relies on them:

1. **The prompt at eighteen** (083 §6.2 C: "the app asks him at 18; a prompt on his Me screen"). It is a read-time check on his next sign-in after the birthday (`majority_on(born) <= sa_today()` and no self record yet), not a job. If the prompt is not yet built it is a Sonnet item over `GET /api/players/:id/public-name` (§8.4 S6).
2. **The departure form's tick** ("Take his name off public pages now", AL D10, default off, Q5 there) for the matric leaver, which is the office's "no" through `public_name_consent_set()`.

### 5.4 The public name when he leaves school

| moment | his public name | why |
|---|---|---|
| the leaving day (`player_leave()`) | **unchanged** by default; the office may tick the "no" | AL D10; consent is judged on the day served |
| a minor who has left, until eighteen | his parent's standing consent names him; she may withdraw (her link is live till his birthday, `db/62`) | C3, AL §3.5 |
| eighteen, having left | his own record governs once given; until then the pre-18 consent stands; a parent can no longer act (her link ended on the later of leaving and majority) | C6, §5a, `db/62` |
| minimised (AL D24, the school's period after leaving) | `full_name` → "Former pupil": `publicName()` answers the position ("Batter") on every past scorecard; the honours board says "Former pupil" unless he consents as an adult to be named (AL §6.2 row 3) | A5 of AL; the one way a public name ends for good |
| never-public mark | untouched by leaving (AL §3.4) | a safeguarding fact |

No cross-season or cross-side figure for one boy ever reaches a public page before, during or after any of this (A3, A4, A11; §7 item 2).

---

## 6 · Captaincy (D4)

### 6.1 The reading of D4

"The scorer updates the captain assigned to a side." Two things exist today: the season's `captain` / `vice_captain` **honour**, awarded under `recognition.manage` by the director, principal or office (138 §1.1; RECOGNITION A5), which switches on the captain's view (138 §1.2) and names the nominator for Player of the Match (RECOGNITION D14); and the **sheet**, `match_squad`, which carries no captain mark (138 A5; D3 there refused a per-match mark; RECOGNITION A16 says "if a per-match captain mark is wanted, 138 D3 is reversed and `is_captain_of()` reads `match_squad` as well").

The lead reads D4 as the second: **the scorer, setting up the match on the pad, marks who captains each side for that fixture**, as he records the toss. A scorer does not award a season's honour: `scorer` is often a pupil and often scoped to one fixture (PUBLIC_DATA §5a), and `recognition.manage` on a scorer is a widening nobody asked for. So D4 reverses 138 D3 and A5 and takes RECOGNITION A16's second path; Kameel should confirm the reading in **Q4**.

### 6.2 The mark

**SR-6 · `match_squad.captain boolean NOT NULL DEFAULT false`**, with a partial unique index `one_captain_a_side ON match_squad (match_id, side) WHERE captain AND NOT withdrawn`, and `captain_set_by uuid → app_user`, `captain_set_at timestamptz`. Written only through **`sheet_captain_set(p_match uuid, p_side text, p_player uuid)`**, `SECURITY DEFINER`, pinned, `scrbrd_app` only, which:

- requires `app_can('scoring.edit', <that end's school>, <that end's team>, zeros, p_match)` (the scorer, including a pad-scoped session: `db/50:204` admits `scoring.edit` for `app_pad_match()`) **or** `app_can('team.select', …)` at that end (the coach who names the side may name its captain on the sheet, as he names the order);
- requires the boy to be on that end's sheet, not withdrawn, not `twelfth`;
- clears the previous mark on that end (`captain = false`, the old `captain_set_by/at` kept on the row — the row is the record that he was captain until the change) and sets the new;
- is refused once the match is `complete` or sealed (`match_verified`), as the sheet's order is; a correction after that is a scoring amendment question (GA-I36), not this door's;
- writes `scoring_audit` as the toss write does.

The mark is **a fact about the match**, read as the sheet is: `match_squad_read` (per side, row id) for staff and team-mates; `fixture_sheet()` (REACH R-H) returns "(c)" beside the name for the family. It opens no read: a boy marked captain holds exactly the `player` reads he held (138 §0). On the pad it is one tap per side on the sheet screen beside the batting order (Sonnet; 56 px; "Captain" word beside the mark, never colour alone).

**Public pages:** the "(c)" is **not** served publicly in this design. A7 keeps sheets private; A5 makes honours public only when the school marks them; a captaincy mark on a public scorecard is a new public fact about a child and needs Kameel's word as information officer (Q4's second half; recommendation: no).

### 6.3 What the honour still does, and how the two meet

| question | answered by | why |
|---|---|---|
| the Home card "CAPTAIN · HILTON U15A", the season label (138 C1) | the season's `captain` honour for his current side (138 §1.2, unchanged) | the honour is the school's word on who leads the side this season |
| the fixture screen's Captain section (C2) and the Match Centre tab (C3–C5) for one fixture | **the sheet's mark** for that fixture; if no mark, the honour-holder on the sheet; if neither, the `vice_captain` on the sheet (138 D1); if none, off | the scorer's fact for the day |
| `is_captain_of(player, team, season)` (138 phase C; RECOGNITION R7) for the Player-of-the-Match nomination | gains a fixture arm: `is_captain_on(player, match)` = the sheet's mark, else RECOGNITION D14's rule (the `captain` honour-holder if on the confirmed sheet, else the `vice_captain`) | D14 stands; the mark says who actually led |
| who may nominate when the marked captain is not the honour-holder | the marked boy | he led the side that day; D16's nine tests otherwise unchanged (never himself; on the sheet; the window) |

### 6.4 The old captain's view ending

| event | the Home card | the fixture section and the tab | the nomination |
|---|---|---|---|
| **the season turns** (1 Jan) | off at next load: `season_for(sa_today())` is 2027 and his honour is 2026 (138 §1.3) | per fixture: a 2026 fixture still shows him (its season is 2026, its sheet marks him); a 2027 fixture shows nobody until the new honour or mark | a 2026 match verified in January is still 2026's: his to nominate within the 48-hour window (D16) |
| **he moves side** | off: the honour's side ≠ his (138 §1.3; the honour does not move) | per fixture by the sheet | by the sheet |
| **mid-season change** (the school names a new captain) | the director withdraws the old honour with a reason and awards the new one (`honour_once_a_season` is per boy, so two boys may hold `captain` in one season until the old one is withdrawn; the office is told to withdraw on the Season screen's list) | the scorer marks the new boy on the next sheet; the old one's section closes with it | by the sheet first |
| **he is injured for a match** | on | the sheet marks the stand-in; his section for that fixture closes; the stand-in's opens | the stand-in nominates |
| **he leaves the school** | the `player` role ends (AL D7); the app is gone | — | — |

Nothing is "demoted" on a screen a team-mate sees (138 §1.3): the sheet shows "(c)" beside a different name, as a printed sheet would.

### 6.5 Separation of duties against the captain's own data

- **A pupil scorer who marks himself captain** (he scores his own side's match, which PUBLIC_DATA §5a allows): gains the captain's view for that fixture, which is a rearrangement of reads `player` already holds (138 §3.1), and the nominator's seat for Player of the Match, where D16 already refuses him as nominee and D9 keeps the decider disjoint. Nothing widens; the mark is logged with his name. A school that does not want a pupil scorer naming the captain gives the sheet to the coach (`team.select`), which the function also admits.
- **The scorer never awards the honour**, never reads a boy's file through the mark, never writes the sheet's names (`team.select` does; the mark is the one column `scoring.edit` touches).
- **The captain never marks himself** except as scorer above; never reads availability, health, notes, ratings or another school's child (138 §4, unchanged); never nominates himself (D16); never decides (D9).
- **The office's rollover** never writes an honour by the band or the previous season: a captain is a decision every year (`honour_once_a_season` makes last year's row irrelevant to this year's gate by its `season_id`).

---

## 7 · The never-list

Each is a sentence, the rule that makes it true, and the test that makes it red.

1. **Nothing about a boy surfaces to his new side that his old side could not see.** The set of capabilities that opens any row about him is unchanged by the move (no bundle changes; no policy gains a capability); what changes is who holds them at (school, his side). A new team-mate reads C1 (masked row, honours, caps, milestones) as an old one did; the new coach and assistant read C2 at the tiers the old coach and assistant held; the new team manager, parents, analyst read what their counterparts did. *Test (`db/99`):* for every table with a policy anchored on the boy, the set of **roles** that can read a staged row is identical before and after a staged move; and for the three development tables the set of **persons** after = holders at the new side ∪ school-wide holders ∪ the oversight set ∪ himself.
2. **No cross-season comparison of children appears publicly.** The public reads are per match, per competition, per school's board (`public_*()`, SCRBRD-083 §1 item 4's allowlist); `career_by_season` is signed-in; no public read takes a player id (A4); boards are signed-in (A11, RECOGNITION D22). The rollover adds no public read. *Test:* `smoke-public` asserts no public response carries a player identifier with more than one season's figures; the `public.mjs` never-list test is unchanged and green.
3. **The old side's staff read nothing written at the new side.** The oversight branch is bounded by the boy's side on the row's day. *Test:* Mr Dlamini reads the 2026 score and not the 2027 one; reversed by writing the 2027 row with `assessed_on` in 2026 — refused by the API's date rule (a score is dated the day it is written) and, if forced as superuser, read — which is the honest answer: a row dated inside his window is one he oversees.
4. **The old coach writes nothing after the move.** No write policy and no definer function carries the oversight branch. *Test:* every INSERT/UPDATE policy and the five functions on the three tables contain no `development_oversight(`; a `db/99` assertion over `pg_policy` and `pg_proc`, as `db/106`'s self-check does.
5. **A boy's health, load, availability, contacts and discipline do not follow a former coach.** Only the three development tables carry the branch. *Test:* `pg_policy` over every other table contains no `development_oversight(`.
6. **A move carries no judgement word.** `team_membership.reason` is 'joined' | 'moved' (the CHECK); the Season screen's "next" column is a band suggestion with the words "suggested from his age; nothing moves until you confirm", and the roster shows "U14A → U15A · 12 Jan" and never "promoted", "dropped", "demoted". *Test:* the browser walk greps the Season screen for those words.
7. **Nobody's authorship moves.** `assessed_by`, `author_id`, `set_by`, `awarded_by`, `decided_by`, `selected_by`, `captain_set_by` are stamped by trigger and never re-stamped (AH-D5 removed the one re-stamp). *Test:* AH's §7.1 item 1 and 2, unchanged.
8. **No capability is widened and none is granted by the date.** `roles.mjs` is untouched by every slice in §8; `separation.test.mjs` is unchanged; nothing runs on a schedule.
9. **The sheet's captain mark is not public.** `public_*()`'s column lists do not gain `captain`; the never-list test for `tables.mjs` lists it under A7 (sheets). *Test:* `assertPublicSelect` on the scorecard reads.
10. **A departed boy is read by nobody at his old side through a dated row except his family and himself.** The oversight branch requires an open membership; AL Q9's `RESTRICTIVE` cut covers the rest when it lands; `side_on()` for the family returns closed rows (D1 for the past) and the sheet, log and fixture of a past match are what they could read then.

---

## 8 · Migration shape

### 8.1 Tables and helpers that change

| thing | change | migration (the lead numbers; `db/106`–`db/108` are spoken for on the branch) |
|---|---|---|
| `player_team_membership_log()` (`db/08:4330`) | re-emitted (md5-guarded, as `db/77`/`db/86` do) with the assignment sync (SR-1), or a sibling `AFTER UPDATE OF team_code` trigger in the same file | **M1** |
| `team_membership` | one index `(player_id, school_id, joined_on DESC)` | M2 |
| new `side_on(uuid, uuid, date)`, `side_day(uuid)` (a fixture's day, zeros → today) | SR-2 | M2 |
| `side_reach()` branch (2), `my_fixture_ends()` arms (2), `my_sides()` signature and body, `training_session_read`, `db/100`'s `my_child_fixtures()`, `db/101`'s side rule, R-E's notice rule if landed | dated (§2.10); each `CREATE OR REPLACE` in place with `db/106`'s grants kept; `db/106`'s self-check (`:490–583`) re-emitted to accept the new text | M2 |
| `lift_seat` void on a move | SR-4: the move's trigger (or `player_move()` if the lead wraps the route's UPDATE in a definer, which also lets one transaction move a side) calls `db/70`'s void path for seats on fixtures of the side he left, dated after `effective_on` | M2 (or M1) |
| `development_oversight(text, uuid, uuid, date)`; `player_skill_read`, `development_note_read`, `development_target_read` gain the branch | SR-7 (§4.2); **after `db/104`/`db/105`** (GA-I26a A1, A2) | **M3** |
| `honour_read` | SR-8: `OR` the row's own side (§5.2) | **M4** (or folded into RECOGNITION R5c/R9) |
| `match_squad.captain`, `captain_set_by/at`, `one_captain_a_side`; `sheet_captain_set()`; `is_captain_on()`; `is_captain_of()` gains the fixture arm; `fixture_sheet()` returns the mark; `public_*()` lists untouched | SR-6 (§6); **with or after RECOGNITION R7** (`is_captain_of()`) | **M5** |
| `season_rollover_due(school)` read (SR-5): over-band boys for the coming season, sides without a 2027 `captain`, boys with no side, the open-age rosters for the leavers' sheet; `player.profile.manage` at the school | §3.1 step 0 | **M6** |
| `player_leave()`'s 30-day backdate | **Q5**; if widened, AL slice 4's file, not this design's | — |
| `roles.mjs`, `app_can()`, `db/01`, `db/09` | **untouched** | — |

### 8.2 Proofs that must be rewritten

| proof | today | after |
|---|---|---|
| **`db/99` §83 (reader)** (`_v106_stage()` and its labels) | g1 reads "the 6XI's fixtures home and away and nothing else"; gup, upboy, aboy, wesg by current side | the stage gains **a move**: A moved from the 6XI to the 7XI on a day between two staged fixtures (f_old, f_new), with `app.effective_on` set; g1 reads f_old (6XI, before the move) and f_new (7XI, after) and **not** the 6XI's fixture after the move nor the 7XI's before it; the same for A's own `selfaccess` read; A's `player` assignment reads the 7XI's unnamed branch (SR-1) and not the 6XI's; gup/upboy by the sheet unchanged; every reader whose assignments name nobody unchanged ((unchanged) holds as is) |
| **§83 (literal)** | `fixture_reach()` equals §2.5's text spelled over every boy on the side | the spelled-out text is **rewritten with `side_on()`** on the fixture's day; the equality holds again; the old text is kept beside it and asserted **unequal** on the moved boy's rows (the falsification that proves the rewrite did something) |
| **§83 (agree)** | `my_child_fixtures()` (`db/100`) = `match_read`; `news_plan_reach()` (`db/96`) = `side_reach('team.read')`; `db/101`'s reach = `fixture_end_reach()` | holds because M2 re-expresses `db/100` and `db/101` on the same dated rule in the same transaction; `db/96`'s plan reach is per fixture through the sheet and the side **on the fixture's day** — Opus checks `news_plan_reach()`'s text (`db/96:184–190`) and dates it if it reads `player.team_code` |
| **§83 (shape), (spelling), (team-less)** | as built | unchanged in form; re-run over the staged move |
| **§83 (cost)** | 34 ms guardian-of-two on the forty-fixture season | re-measured with the move staged and a boy with three memberships; recorded; refused over 2× |
| **`db/99` §49** (`my_children`) | the link states | unchanged; one assertion added: a move changes no `assignment_subject` row |
| **GA-I26a §7.1, §7.2** (`db/104`/`db/105`) | the point invisible under `selfaccess`, `player`, `guardian`, `teammanager`, `analyst`, the other school; the target read by the coach and the boy | **gain the old coach**: after a staged move, the 2026 score, point and target are read by the old coach (struck or not), **not** writable (`42501` on insert; the functions refuse `not_permitted`), **not** withdrawable by him; the 2027 ones invisible to him; the 2027 U14A coach (new to the side) reads none of the moved boy's 2026 rows; after `player_leave()` of the boy: none; after off-board of the old coach: none; after `player_return()`: back |
| **138's pupil walk** (`smoke-browser-pupil`, captain group) | the card, section and tab appear for the seed's captain | gains: the season turned (a 2027 fixture, the honour 2026): Home card off, 2026 fixture's section on; the sheet's mark on a fixture gives the marked boy the section and tab and takes it from the honour-holder for that fixture |
| **RECOGNITION R7's nine gate tests** | the honour-holder nominates | gains: the marked captain nominates when he is not the honour-holder; the honour-holder cannot when another is marked; neither marked nor honoured on the sheet → the vice-captain |
| **`db/99` for `db/47`** (public name) | the 18 cases | unchanged; one assertion that a move changes no consent row |
| **`separation.test.mjs`**, `public.mjs` never-list test, `retention.test.mjs` | — | unchanged and green: no role, no public column, no retention row moves |

### 8.3 Falsifications that should go red

Each is written, run green, then broken once and seen red, as REACH §6.1 requires.

1. **The dated reach.** Replace `side_on(…, <day>)` with `player.team_code` in `my_fixture_ends()`: g1 loses f_old and gains the 6XI's post-move fixture → (reader) red.
2. **The assignment sync.** Disable SR-1's trigger: after the staged move, A's `player` assignment's `team_code` ≠ `player.team_code` → M1's section red; and A reads the 6XI's post-move fixture through the unnamed branch → (reader) red.
3. **Oversight is read-only.** Add `OR development_oversight(…)` to `player_skill_insert`'s `WITH CHECK`: the old coach's insert succeeds → red; the §7 item 4 `pg_policy` scan → red.
4. **Oversight is the coach's, not the side's.** Drop the assignment-window conjunct: the 2027 U14A coach reads the moved boy's 2026 score → red.
5. **Oversight ends with the child.** Drop the open-membership conjunct: after `player_leave()` the old coach reads the 2026 score → red.
6. **Oversight ends with the coach.** Drop `lift_at_school()`: after off-board (every assignment ended, his account still active) the old coach reads the 2026 score through the ended assignment's window → red.
7. **Oversight is bounded by the boy's then-side.** Drop `a.team_code IN side_on(…)`: the old coach reads the 2027 score → red.
8. **The honour's own side.** Remove SR-8's second clause: U14A's 2027 pupil reads none of 2026's U14A board; and (RECOGNITION D22's proof, when R9 lands) the board lacks the boy now in the 1st XI → red.
9. **One captain a side.** Mark two boys on one end: the index refuses → the proof asserts the refusal; drop the index → red.
10. **The mark is a scoring fact.** Drop the `scoring.edit`/`team.select` test in `sheet_captain_set()`: a guardian marks her son → red.
11. **Nothing public.** Add `captain` to a `public_*()` column list: `assertPublicSelect` red.
12. **Nothing on a clock.** `pg_cron`/`cron.job` absent, as today; the proof asserts no job exists that names `team_membership`, `honour`, `role_assignment` or `player`.

### 8.4 Build slices, in order, with tiers

| slice | scope (one line) | migration | tier | waits on |
|---|---|---|---|---|
| **S0 · the map** | this document's rows into the roadmap and the gap analysis; AH-D6's "changes side" row annotated with D5/D6; 138 D3/A5 and RECOGNITION A16 marked "reversed by SEASON_ROLLOVER D4 (Kameel, 15 Oct)"; REACH §2.5 note "branch (2) is the boy's side on the row's day since M2" | none | **Haiku** | Kameel's answers to §9 |
| **S1 · the assignment follows the row** (SR-1) | the trigger; `db/99` M1 section; `roster-api.mjs` unchanged | **M1** | **Opus** (policy, minors, a definer trigger) | nothing; **ships first**: it is a bug today and REACH R-D (`db/108`) makes it a constraint violation waiting to happen |
| **S2 · the dated side** (SR-2, SR-4) | `side_on()`, `side_day()`, the helpers re-emitted, `db/100`/`db/101`/`training_session_read` re-expressed, seats voided on a move, the §83 rewrite and (literal)'s old-text inequality, cost re-measured | **M2** | **Opus** | `db/106` merged (it is the file being changed); `db/100`, `db/101` merged |
| **S3 · oversight** (SR-7; D5, D6) | `development_oversight()`, the three read policies, the `pg_policy`/`pg_proc` self-check, the GA-I26a proof extensions, `access_log` unchanged | **M3** | **Opus** | `db/104`, `db/105` (GA-I26a A1, A2); S2 for `side_on()` |
| **S4 · the honour's own side** (SR-8) | `honour_read`'s second clause; its proof | **M4**, or inside RECOGNITION R5c/R9 | **Opus** | nothing; the lead places it |
| **S5 · the sheet's captain** (SR-6; D4) | the column, index, `sheet_captain_set()`, `is_captain_on()`, `is_captain_of()`'s fixture arm, `fixture_sheet()`'s "(c)", `scoring_audit`; the pad's one tap and the family sheet's "(c)" (Sonnet); 138's walk and R7's gate tests | **M5** | **Opus** the SQL and the read gates; **Sonnet** the pad tap and the card line; **Opus reviews** (a child's name with a mark, on the pad and the family screen) | RECOGNITION R7 for `is_captain_of()`, or S5 builds it first as 138 phase C drew it |
| **S6 · the Season screen** (SR-5) | `season_rollover_due()`; Settings → School → Season: the three lists, the roster-by-side with the suggested "next" column and one confirm per boy (over `POST /api/players/:id/team`), the leavers' sheet (over `POST /api/players/:id/leave`, AL slice 4), the captains list (over `POST /api/honours`); the eighteen prompt on Me if not built (§5.3); the §7 item 6 grep; `interface-review` and `break-ui` (a roster of 400 boys; a boy with no `born`) | **M6** (the read) | **Opus** the read; **Sonnet** the screen; **Opus reviews** (a roster of children, moves of record) | AL slice 4 for the leavers' sheet (the rest ships without it) |
| **S7 · the docs** | after each merge: roadmap and gap-analysis rows, `DEPLOYING.md`'s paste list for M1–M6; REACH §4's order column; GA-I26a §6.1; 138 §1.3; this document's slice table | none | **Haiku** | each merge |

S1 and S2 can go to the pilot before the January rollover and must: without S1 a moved pupil reads the wrong side, and without S2 a moved family loses its season on the day of the move. S3–S6 are for January; S5 is for the first fixture of the new season. Not `db/SHIPPED.sha256`; that stays with the lead.

---

## 9 · Questions for Kameel
All eight decided 15 Oct 2026: as recommended (Kameel).

At most eight; each with a recommendation.

| # | question | recommendation |
|---|---|---|
| **Q1** | **D5 and D6 as read.** Read-only oversight of the rows dated within the boy's time on the coach's side; no write or withdraw; authorship kept; ending at whichever is first of the child leaving the school and the coach leaving the school; a coach who merely changes sides within the school keeps it (§4.2 note 1). Is that the reading? | **Yes.** It is the smallest rule that says "oversight but not ownership" and ties both endings to acts that already exist. If "the coach leaves" should mean "his assignment at that side ends" rather than "he leaves the school", the window conjunct becomes a liveness test and a coach who moves sides loses oversight on the day; say which. **Decided: as recommended (Kameel, 15 Oct 2026).** |
| **Q2** | **The newcomer's bound.** A boy who joins U15A in January does not read U15A's 2026 fixtures, scorecards, posts or plans (dated reach, §1.3). Today's current-side anchor gives him them. Keep the dated bound? | **Yes.** Last season's U15A scorecards name boys now in U16, and the newcomer's family has no reason to hold them that the public page (team level) does not already meet. The alternative — the side's whole history to whoever is on it now — is what REACH-D1 rejected for parents. **Decided: as recommended (Kameel, 15 Oct 2026).** |
| **Q3** | **Whose oversight.** A coach new to U14A in 2027 does not read the 2026 rows of boys who have since left U14A (the assignment-window test, §4.2 note 2). Is that right, or should the side's new coach see the side's past? | **The coach's, not the side's.** D5 says "the coach has oversight"; the 2027 U14A coach never coached the boy, and the U15A coach has the record by D2. **Decided: as recommended (Kameel, 15 Oct 2026).** |
| **Q4** | **D4's reading, and the mark in public.** (a) The scorer marks the captain on each fixture's sheet; the season honour stays the director's; the two meet as §6.3. (b) The "(c)" never appears on a public scorecard without your word as information officer. | **(a) Yes** — a scorer awarding a season honour would put `recognition.manage` on a role a pupil often holds. **(b) No public mark.** It is a new public fact about a named child; A7 keeps sheets private. If you want it, it follows L2 (only a consenting, named boy; "Batter (c)" is not drawn). **Decided: as recommended (Kameel, 15 Oct 2026).** |
| **Q5** | **Recording December leavers in January.** AL D7 limits `left_on` to 30 days back; a matric who left on 4 December recorded on 15 January is 42 days. Widen the window, or ask the office to record leavers before the holiday? | **Record before the holiday, and widen to 60 days as a safety.** The link dating (`db/62`) and the public-name tick are better done in December; 60 days covers the office that did not. Not unlimited: a leaving backdated a year rewrites a season of reads. **Decided: as recommended (Kameel, 15 Oct 2026).** |
| **Q6** | **The adult leaver's parent.** A matric who is eighteen on leaving takes his parent's access with him on the leaving day (`db/62`); she then reads none of his past fixtures, while he reads them through `selfaccess`. D1 says families keep records. Leave it? | **Leave it.** This is the 28 Sep sign-off (SCRBRD-110 §7.4; 083 §6.4): an adult who has left school is the data subject in his own right. The parent of a minor leaver keeps her sight until his birthday; the adult can show his mother his phone. **Decided: as recommended (Kameel, 15 Oct 2026).** |
| **Q7** | **Correcting a wrong move date.** No door exists to re-date a `team_membership` row; a too-late date cannot be moved earlier (§3.3). Build `team_membership_redate()` under `player.profile.manage`, logged? | **Not yet.** The table's worth is that no person edits it; a wrong date is rare and the office's note can say so. Revisit after one rollover if it bites. **Decided: as recommended (Kameel, 15 Oct 2026).** |
| **Q8** | **Where the oversight of health stops.** D5's "the record" is read here as the development record (GA-I26a's three tables). Should a former coach keep sight of anything else — the injury he reported, the load he logged? | **No.** SCRBRD-110 §6.5 and K3 put health behind the current side and the physio; a former coach's sight of a boy's body is the thing the DSO policy exists to narrow. His own authorship on an `injury` row stays, unread by him. **Decided: as recommended (Kameel, 15 Oct 2026).** |

---

## 10 · What this document does not reopen

- **`app_can()`'s body** (`db/50`) and the three spellings (REACH §1.2); **ADR 0001** (one assignment decides), **ADR 0003** (no role tests; SR-1 is a trigger on `player`, not a role branch in `app_can()`).
- **REACH-D1–D5**, `db/100`, `db/101`, `db/102`, `db/106`'s (a)–(e) and its proofs' labels: M2 changes one predicate inside branch (2) and re-expresses the agreeing helpers; every unnamed reader's answer is unchanged.
- **AV-D1–D5**, STEP4's screens and Q4/Q10, PB-D3, GA-I27 C-D4, K3 (`db/55`), `db/57`, `db/70`'s lift tables and their purge.
- **GA-I26a AH-D1–D9**: §4 adds one read branch and touches no write; AH-D6's "changes side" row is annotated, not changed.
- **ACCOUNT_LIFECYCLE D1–D24**, its Q8 (no clock), Q9 (the departed cut), slices 3–5 and 7; **`db/62`**.
- **RECOGNITION D1–D25**; A16's second path is taken (the sheet mark), which that design allowed for; D14–D18 stand with the fixture arm added.
- **138 D1, D2, D4–D11**; D3 and A5 are reversed by Kameel's D4 and this document says so (§6.1).
- **PUBLIC_DATA** in every line; **SCRBRD-083 §6** option C; the 28 Sep sign-off. Nothing here is public but what A5 and A6 already allow.
- **SCRBRD-110**: health follows the current side and the physio; no oversight of it (Q8).
- **The age model** (`teams.mjs`, `season_for()`, `age_band()`, `match_squad_age_eligible()`): used, not changed.

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `season`, `season_for()`, `season_cutoff()`, `age_band()` | `db/08:5040–5115` | the model of time; the Season screen's suggestions; the Home card's season |
| `team_membership`, `player_team_membership_log()`, `app.effective_on` | `db/08:4256–4382`; `roster-api.mjs:36–95` | the dated side; SR-1's home; the undo |
| `still_at_school()`, `lift_at_school()`, `majority_on()` | `db/60:166`; `db/70:409`; `db/08:885` | D6's two conjuncts; eighteen |
| `side_reach()`, `fixture_end_reach()`, `fixture_reach()`, `my_fixture_ends()`, `my_sides()`, `my_own_boy()` and `db/106`'s self-check | `db/106` on `origin/claude/wip-reach-ra` | §2.10's changes |
| `my_child_fixtures()` | `db/100:137–163` on the branch | re-expressed in M2 |
| `db/99` §83 and `_v106_stage()` | `db/99:21410–21710` on the branch | the proofs rewritten |
| the 25 current-side policies; `honour_read`; `player_update` | `db/09:149, 204, 221, 364, 415, 432; :86` | §2.0; SR-8; who may move a boy |
| `honour`, `honour_stamp()`, `honour_once_a_season` | `db/08:5451–5530` | §5.2, §6 |
| `match_squad`, `match_squad_age_eligible()`, `fixture_sheet()` (R-H) | `db/00:345`; `db/08:337`; REACH §3.5 | the mark; the age refusal |
| `decide_role_request()` (the `player` assignment's `team_code`) | `db/08:5893–5960` | the second copy SR-1 repairs |
| `player_leave()`, `player_return()`, `role_assignments_end_all()` | ACCOUNT_LIFECYCLE D7, D15 (slices 4, 5) | the endings of D6; the leavers |
| `coaching_point_write()`, `target_set()`, `skill_withdraw()`, `note_withdraw()`, `target_withdraw()` | GA-I26a §1.2, §2.2, §5 (`db/104`, `db/105`) | the write doors oversight never passes |
| `is_captain_of()`, `recognition_nomination`, D14–D18 | RECOGNITION §4; 138 phase C | §6.3 |
| `public_name_consent_set()`, `public_name_facts()`, `publicName()` | `db/47`, `db/62` item 4, `packages/policy/src/public.mjs` | §5.3, §5.4 |
| `lift_seat` void path | `db/70`, `db/76`; AL D7 step 7 | SR-4 |
| `TEAM_SCOPED_ROLES`, the bundles | `packages/policy/src/roles.mjs:37, 330, 376, 391, 414` | REACH-D4; who holds what |
| the seed personas | `db/98:379–420` | every proof |
| `DEPLOYING.md`'s frozen-file rules, `ADDED_SINCE_01`, `md5`-guarded re-emits | `DEPLOYING.md`; `db/77`, `db/86` | every migration here is a new `db/NN` |
