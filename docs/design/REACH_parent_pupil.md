# REACH — What a parent and a pupil read, table by table: the design

**Status:** Decided 14 Oct 2026 (D1–D5); build not started.
**Source:** the reach inventory of 14 Oct (Haiku, from code, not run: `scratchpad/reach-inventory.md`; its row numbers are cited as `inv #n`), `docs/design/STEP4_parent_pupil.md`, `docs/design/SCRBRD-083_public_pages.md`, `docs/policy/PUBLIC_DATA.md`, `docs/design/SCRBRD-138_phaseB.md` §2, `docs/design/GA-I27_coach_cards.md` §3.2 and C-D4, `docs/design/SCRBRD-136-137_away_visibility.md` §2, §3, §5, §10; and the source lines the inventory cites, each read in its own neighbourhood only (`db/50_pad_resume.sql:197–277`, `db/96_news_plan.sql:184–222`, `db/12_news.sql:62–91`, `db/09_rls_policies.sql:77, 148, 237, 272, 380, 602`, `db/02_schema_scoring.sql:41–56, 212`, `db/08_schema_programme.sql:1687, 2363, 2436, 6244`, `db/81_signup_google.sql:88–108`, `packages/policy/src/roles.mjs:37, 54, 330, 376, 388, 422, 698`).
**Reader:** Kameel first; then the Opus agent who builds the policies (§6), who should not need to reopen the inventory; then Haiku for the documents (§6.4).

Plain words come first in every section; the exact rule follows.

---

## 0 · In one page

On 14 Oct two builders found a parent's reach wrong in opposite directions from one cause. A guardian's assignment is **school-wide and names her children**: `role_assignment` with `team_code` NULL, one `assignment_subject` row per child. `app_can()` then answers by the **person argument** a policy passes: the all-zeros id ("any person") gives her **every row at the school**; `NULL` or an id that names nobody gives her **nothing**; her child's id gives her **his rows**. Team posts passed zeros, so a U15A post reached every parent at the school. The ball log passed `NULL`, so no parent read a ball. Both policies were "correct" against `app_can()`; neither had asked the question a parent's assignment can answer.

The question a parent's assignment *can* answer is "may this caller read **this boy**?" The question most team-level tables ask is "is this caller **at this side**?" — and a guardian is at a side only through a boy on it. So this design adds one derived question, **side reach**: *does the caller hold the capability, at this school and team, either through an assignment that names nobody (the side's staff, its players, a spectator the office admitted) or through a named boy whose side this is (a guardian, a pupil's self link)?* `db/96` already wrote that question for the coach's plan (`news_plan_reach()`); `db/100` and `db/101` are being built on the same idiom. This design names it once, for every class of table, so the 166 policies become eight rules.

The rules, in a sentence each (§2 has the exact argument):

| reader | reads |
|---|---|
| **a guardian** | her own child, as a person; her child's **side** as a side (its fixtures home and away, the log, the sheet's names and order, the bus, the training, the team's posts); the school's reference data. Of another boy, only what the side shares: his name on the sheet and the scorecard. A link that is pending, ended or revoked reads nothing about that child and nothing about his side. |
| **a pupil** | himself through his self link, at every tier the model gives him; his side through his team link, exactly as his parent reads it; of a team-mate, the sheet and the scorecard and nothing of the person (his aggregate figures are §7 D2). A `player` row with no team reaches no side (§7 D4). |
| **a spectator** | the school's fixtures and results at team level with the signed-in scorecard (Q4, AV-D5), the school's posts; a team's posts only when the office scoped him to that side (§7 D3); never a boy as a person. |
| **the adults at the side** | unchanged: coach, assistant and team manager are unnamed, team-scoped assignments and pass every spelling of the argument for their side. The rule meets theirs at the sheet, the log and the posts, which the side reads together. |

Eight classes of table (§3) carry those rules: **A** the fixture and its log; **B** news and notices; **C** a boy's own record and figures; **D** another boy's record (never, as a person); **E** the sheet and availability; **F** transport and lifts; **G** school-level reference; **H** adult-only. Each class names its one `app_can()` person argument (zeros for "the school", the row's player id for "this boy", side reach for "this side", the all-f id for "unnamed assignments only"), the capability stays the table's own, and `NULL` is retired as a spelling for new policies because it reads as "nothing" and was the ball-log bug.

Fourteen mismatches (§4). Three are in hand (`db/100` the log, `db/101` team posts, `db/102` suppressions) and this design fits them without reopening. The top three by risk that remain: **every guardian reads every fixture, trip (driver, pickup, notes) and training session at the school** (M3); **every guardian and pupil at a receiving school reads every family's passport and scouting consents** (O5, O6); and **the raw `official` table, with ID numbers and dates of birth, is open to every enrolled person, pupils included** (O4). One more may be the worst of all if any such row exists: **a pupil whose `player` assignment has no team reads every side at the school** (O8) — the first thing to verify live.

Five decisions for Kameel (§7). Everything else is already decided in the documents named above and is not reopened (§8).

---

## 1 · The cause, exactly

### 1.1 Plain words

`app_can(capability, school, team, person, fixture)` says yes if the caller holds an assignment with that capability whose scope fits every argument. A coach's assignment fits "school = Hilton, team = U15A" and names nobody, so it does not care what the person argument says. A guardian's assignment fits "school = Hilton, any team" and names R Pillay, so **the person argument is the only thing that scopes her**: ask about him and she passes; ask about "anyone" and she passes for the whole school; ask about nobody and she fails. A pupil holds both shapes at once — a team-scoped `player` row that names nobody (the team argument scopes him) and a `selfaccess` row that names himself (the person argument scopes him).

### 1.2 The three spellings and what each means

From `db/50_pad_resume.sql:222–270` (the live body; the generator's copy agrees on this logic, `services/api/rls/generate-rls.mjs:220–293`):

| spelling | meaning | guardian (child C live) | pupil's `player` (team T) | pupil's `selfaccess` | coach (team T) |
|---|---|---|---|---|---|
| `'00000000-…'` zeros | **any person** | **every row at the school** (team NULL) | rows at T, or team `'*'` | every row at the school | rows at T, or `'*'` |
| the row's player id | **this boy** | his rows only | rows at T | himself only | rows at T |
| `'ffffffff-…'` all-f | **unnamed assignments only** (an id no subject names) | nothing | rows at T | nothing | rows at T |
| `NULL` | the same answer as all-f, by a different path (`db/50:246` fails on `IS NOT NULL`; `:265` passes `NOT EXISTS subjects`) | nothing | rows at T | nothing | rows at T |

Two consequences the design stands on:

1. **No single spelling says "this side" for a guardian.** Zeros is the school; the child's id is the boy; all-f and `NULL` are nobody. A team-level row (a fixture, a trip, a training session, a post) has no boy on it to name, so every policy over such a row has had to pick between too wide (zeros, `inv #61, #127, #130, #78`) and too narrow (`NULL`, `inv #10, #66, #67, #116`). The answer is a derived question (§2.5), not a fourth spelling: `app_can()` is `db/50`'s and is not changed here.
2. **The team argument scopes a pupil's `player` row, not the person argument.** `a.team_code = 'U15A'` passes only `'U15A'` or `'*'` (`db/50:224`). So for a pupil the question "is this row about the side?" is already answered by the team argument — unless his `player` row has no team, in which case `a.team_code IS NULL` passes every team and he reads the whole school (§4 O8, §7 D4).

### 1.3 Why the three narrow fixes already decided are instances of one rule

- **`db/96`** (`news_plan_reach()`, `db/96:184–190`): `news.read` with zeros, **and** (`team.read` with all-f **or** a boy on the side the caller may read under `team.read`). That is side reach under `team.read`, spelled for one table.
- **`db/100`** (building): a guardian reads the balls of fixtures her child's side plays, home and away. That is side reach under `fixture.read` over both anchors of the match (AV-D1's two branches with a person argument that admits a named boy on either side).
- **`db/101`** (building): ordinary team posts reach the side; a boy on the sheet (playing up) and his guardians read that fixture's plan. That is side reach under `news.read` plus the sheet branch.

This design asks none of them to change. §6.1's first proof is that the general helper gives **the same answer** as each of them on every seed person and row, so a later migration may re-express them on the helper as a refactor and nothing else.

---

## 2 · One rule per reader

### 2.1 A guardian

**Plain words.** Mrs Pillay reads Rohan: his record, his health at every tier, his contacts, his availability, his figures, his consents, his honours. She reads Rohan's side as a side: U15A's fixtures wherever they are played, the ball log and the scorecard of those fixtures with every boy named as the pad wrote him (Q4, decided), the sheet's names and order once published (Q10, decided), the bus, the training sessions, the team's posts and the notices that follow them. She reads the school's reference data (grounds, competitions, seasons, equipment, the lift policy). She reads nothing about another boy as a person — not his availability, his injury, his career, his profile, his consents, his contacts — and nothing about a side her child is not on. Of D Erasmus she knows what the boundary knows: his name on the sheet and his 34 on the scorecard.

- **Two children at one school** (Rohan on U15A, a brother on U13B): the union, child by child. Her assignment names both; every class-C argument is one boy's id, every class-A/E/F argument is one side. Nothing merges on the screen (STEP4 §3.1, kept).
- **Two children at two schools** (Sarah: D Mkhize at one school, K Dlamini at another, `db/99` §49): the union, school by school. Each school's rows carry that school's id and a guardian row reaches them only with `a.school_id = p_school` (`db/50:222`). The builder verifies live whether the seed's two-school guardian is **two assignments** (one per school) or **one with `school_id` NULL and two subjects** (§5 item 4): the class rules below give the same answer either way for classes A–F, but a school-NULL assignment would reach **every school's** class-G rows under zeros + `'*'`, which is a shape to close if it exists.
- **A link pending, ended or revoked:** `app_can()` counts only a subject row that is `verified`, started and not ended (`db/50:245–251`). A pending or revoked link is not verified; an ended one has `valid_until` in the past (majority, `db/08:889`; leaving, `db/62`). Such a link reaches **nothing about the child and nothing about his side** (side reach asks `app_can()` about a boy, and the boy is not hers). If it was her only link she holds a guardian row with no live subject, which reaches nothing at all, class G included (`app_can()` refuses it outright; `app_enrolled()` does the same, `db/81:100–106`). The screen says "pending", "ended on …", or shows no card, from `my_children` (built, STEP4 §10). Revocation never widens: the `NOT EXISTS` in the unnamed branch counts every subject row, live or not (`db/50:258–266`), so a staff member whose single `enquiry` link was revoked does not become school-wide.

**The rule, as the argument.** For a row about a boy: **the row's player id**. For a row about a side or a fixture: **`side_reach()` / `fixture_reach()`** (§2.5). For a school reference row: **zeros with team `'*'`**. For an adult-only row: the table's capability, which she does not hold; the spelling is **all-f** so that a future capability grant to `guardian` would still not open it by accident.

### 2.2 A pupil

**Plain words.** Rohan holds two assignments. Through `selfaccess` (named to him) he reads his own file at every tier the bundle gives him: profile, PII, DOB, figures, ratings, his medical record with the physio's notes, his discipline, his load (`roles.mjs:376–386`). Through `player` (U15A, unnamed) he reads what the side reads together: the fixtures home and away, the log and the scorecard, the sheet with every name and place, the bus, the training, the team's posts. Of a team-mate he reads the sheet and the scorecard — and today also the team-mate's `player` row (masked by the API's view, M4), his honours, his caps, his milestones, which the side shares (A5 and A6 make honours and milestones public even). He does not read a team-mate's availability, injury, PII, contacts, ratings, notes, load or discipline (STEP4:421–423, K3 `db/55`). Whether he may open a team-mate's **career, season and wagon wheel** — a dossier about one boy, built from the log he may read plus `player.performance.read` held at team scope — is **§7 D2**.

- **A boy playing up** (named on the 1st XI's sheet while his `player` row says U15A): he and his guardians read **that fixture** — its row, its log, its sheet, its bus, its plan (`db/101`) — through the sheet branch of `fixture_reach()`. They do not thereby read the 1st XI's other fixtures, posts or training. When the office moves his `player` row to the 1st XI, he reads the 1st XI as a side and his parent with him.
- **A boy with no team** (`player` with `team_code` NULL): today `a.team_code IS NULL` passes every team (`db/50:224`) and he reads every side at the school — every sheet, every post, every bus, every team-mate-level row. The rule is that **`player` is team-scoped** like `coach` (§7 D4); until that lands, no such row may exist (§5 item 1).
- **At eighteen:** nothing changes for him; his guardian's link ends by its date (STEP4 §3.3; the SCRBRD-110 Q7 exception for health is that design's, not this one's).

**Changed 21 Oct 2026 (Kameel, READERS_child_data Q1):** the "At eighteen" line above is superseded in its date. Her link stays open while he is at school (SCRBRD-110 §7.4); from 18 she may say "no" and never a new "yes"; the link ends on the later of his leaving school and his 18th birthday.

**The rule, as the argument.** Identical to the guardian's: the row's player id for a boy, `side_reach()`/`fixture_reach()` for a side, zeros + `'*'` for the school. His `player` row passes the side rule through the unnamed branch (the team argument scopes it); his `selfaccess` row passes the boy rule for himself.

### 2.3 A self-registered follower (`spectator`)

**Plain words.** Anyone may ask to follow a school; the office grants the assignment, and the label alone carries nothing (`roles.mjs:681–690, 698–700`). Once granted, a spectator holds `fixture.read`, `news.read`, `competition.read` and no player capability (`roles.mjs:422`). He reads the school's fixtures and results at team level and, being signed in, the scorecard with names as the pad wrote them (Q4; AV-D5 confirmed this for the away school's spectators on 14 Oct). He reads the school's school-scope posts. He reads **a team's posts only when the office scoped him to that side** (`team_code` set on his assignment; §7 D3). He reads nothing about any boy as a person, because no capability he holds is a person capability.

**The rule, as the argument.** The spectator is an unnamed assignment, so he passes the **unnamed branch** of `side_reach()` wherever his team scope fits: a school-wide spectator fits every side's fixtures; a team-scoped one fits his side's. Class C and E arguments (a boy's id) refuse him because he holds no capability over any boy. Nothing is spelled for him by role name (ADR 0003).

### 2.4 The adults at the side

Coach, assistant coach and team manager are unnamed, team-scoped assignments (`TEAM_SCOPED_ROLES`, `roles.mjs:37`). Every spelling of the person argument passes them for their side; the row's player id passes them for every boy on it. The rule meets theirs at three places and changes nothing there: the **sheet** (they read every row under `player.profile.read` at the team; the parent reads names and order under Q10's narrow read), the **log** (they read it under `fixture.read` at either anchor, AV-D1; the parent reads it under `db/100`), and the **posts** (PB-D3: the audience is the side; a parent sees what her child was told). A coach's `enquiry` grant is a named assignment and follows the boy rule, as today. A school-wide staff role (office, director) is unnamed with `team_code` NULL and passes every side's unnamed branch, as today.

### 2.5 The two helpers, exactly

Both are `STABLE SECURITY DEFINER`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO scrbrd_app`, `SET search_path = pg_catalog, public, pg_temp`, as `news_plan_reach()` is (`db/96:191–193`). Names are the lead's; the semantics are not.

**`side_reach(p_capability text, p_school uuid, p_team text, p_fixture uuid)`** — *is the caller at this side, for this capability?*

```sql
SELECT
  -- (1) an assignment that names nobody, fitting this school and team:
  --     the side's staff, its players, school-wide staff, a spectator the office admitted
  app_can(p_capability, p_school, p_team, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, p_fixture)
  -- (2) a named assignment (guardian, selfaccess, enquiry) naming a boy whose side this is
  OR EXISTS (SELECT 1 FROM player p
              WHERE p.school_id = p_school AND p.team_code = p_team
                AND app_can(p_capability, p_school, p_team, p.id, p_fixture))
```

**`fixture_reach(p_capability text, p_match uuid)`** — *is the caller at either side of this fixture, or named on its sheet?*

```sql
SELECT EXISTS (SELECT 1 FROM match m WHERE m.id = p_match AND (
     side_reach(p_capability, m.school_id, m.team_code, m.id)
  OR (m.away_school_id IS NOT NULL
      AND side_reach(p_capability, m.away_school_id, m.away_team_code, m.id))
  -- (3) playing up: a boy on this fixture's sheet, and whoever may read him
  OR EXISTS (SELECT 1 FROM match_squad ms
              WHERE ms.match_id = m.id
                AND app_can(p_capability,
                            CASE WHEN ms.side = 'away' THEN m.away_school_id ELSE m.school_id END,
                            CASE WHEN ms.side = 'away' THEN m.away_team_code ELSE m.team_code END,
                            ms.player_id, m.id))))
```

Notes for the builder:

- **Branch (1) uses all-f, not `NULL`.** They answer alike today (§1.2) and `db/96` spelled it all-f; one spelling, with the comment "unnamed assignments only", so nobody reads it as "nothing". §5 item 2 verifies the equivalence live before it is relied on.
- **Branch (2) is `player.team_code`, the boy's current side.** A parent's reach follows her child's side as the office moves him; past fixtures of a side he has left stay hers only where he was on the sheet (branch 3). That is the intended answer, and it is what makes the helper cheap to reason about.
- **The capability is the table's own.** `fixture.read` for class A, `transport.read` for F, `team.read` for training, `news.read` for B. A guardian passes branch (2) only for capabilities her bundle holds over her child, so the helper never widens a bundle.
- **Cost.** Branch (2) runs `app_can()` up to once per boy on the side per row evaluated; `db/96` accepted that for posts. For `match` (hundreds of rows a season) the builder measures with `EXPLAIN` on the seed and a forty-fixture season (§5 item 11). If it matters, the shape change — not the rule change — is a set-returning `my_sides(p_capability)` computed once per statement, as `lift_my_sides()` already does for lifts (`db/70:395`), with policies reading `(school_id, team_code) IN (SELECT …)`. The proof is the same either way.
- **`is_family_of(p)`** (`db/08:6231`, definer: the caller's own verified guardian or self link to this boy) stays the spelling for "the family" where a table is the family's and the office's and nobody else's (class C's consents, §3.3).

---

## 3 · Classes of table

Each class: who reads what and why, the argument every policy in it must pass, and the policies from the inventory that belong to it (by table; `inv #` is the inventory's row). Where today's spelling differs from the class rule the row is in §4.

### 3.1 Class A · The fixture and its log

**Plain words.** A fixture belongs to both sides. Whoever is at either side — staff, players, their parents, the school's spectators — reads the fixture, its log, and the facts around it: the toss, the officials' names (adults, outside the child rule), the pitch report, the weather, the broadcast settings, the playing conditions and overrides, the result decision, the DRS reviews. The pad's own tables — the scoring session, the quarantine, the audit — stay the host's (AV-D4, decided) and are adult-only anyway.

**Argument:** `fixture_reach('fixture.read', <match id>)`. For `match` itself the helper is called with `match.id`; satellites pass their `match_id`. No `match_school()`/`match_team()` home-only anchoring remains in this class except the three pad tables.

| table | inv # | today | class rule gives a guardian | a pupil | a spectator |
|---|---|---|---|---|---|
| `match` | 61 | zeros, both anchors → every fixture at the school (M3) | her child's side's fixtures, home and away, plus any he is on the sheet of | his side's, home and away | the school's (team-scoped: his side's) |
| `ball_event` | 10 | `NULL` on main (none); `db/100` building | as `db/100` gives; the helper must agree (§6.1 proof 1) | same | same |
| `match_toss`, `match_official`, `match_pitch_report`, `match_weather`, `match_broadcast` | 73, 68, 69, 74, 65 | zeros, **home only** → every home fixture at the school; the away side's parent sees no umpires or weather on P3 | both anchors, her side's fixtures only | same | same |
| `match_conditions`, `match_condition_override` | 67, 66 | `NULL`, home only → no guardian; P3's "20 overs" line blank for her | both anchors, her side's | same | same |
| `match_result_decision`, `drs_review` | 71, 35 | zeros (result: both anchors; DRS: home only) | both anchors, her side's | same | same |
| `fixture_publication` | 45 | zeros, side → every published row at the school (columns UNSURE) | her side's; if the columns are only "published yes/no per side" this may stay in class G — §5 item 9 | — | — |
| `scoring_session`, `ball_event_quarantine`, `scoring_audit` | 116, 11–13, 115 | host-only, `NULL`/own | **unchanged** (AV-D4) | unchanged | unchanged |
| `match_trip_driver_read` | 62 | own driven matches | unchanged (a driver reads what he drives) | — | — |

This extends AV-D1's "the log follows the fixture" to the fixture's satellites. It is consistent with 136-137 §3.3, which lists none of them as never-changing, and with AV-D5 (spectators in).

### 3.2 Class B · Team news and notices

**Plain words.** A team post reaches the side (PB-D3; `db/101` building): its roster, their guardians, its staff. A school post reaches the school — every guardian, pupil and spectator at it; a school post that names a child reaches the whole signed-in school, which is the school's own channel (PUBLIC_DATA D4) and the writer's judgement. A competition post reaches the entered schools. A **notice** follows what it is about: a notice about a post follows the post (`db/96`, `db/101`); a notice about a child follows the child (the row's `subject_person_id`); a notice with a team and no child — "training moved", "team sheet published" — follows the side; a notice with a recipient reaches only him (restrictive, `db/57:579`).

**Argument:** team scope → `side_reach(<capability>, school_id, team_code, zeros)`; school scope → zeros with `'*'`; a child named → the row's `subject_person_id`.

| table | inv # | today | note |
|---|---|---|---|
| `news_post` (team) | 78 | zeros → every guardian at the school (M2) | **`db/101`**, decided; not reopened |
| `news_post` (school, competition) | 78 | zeros + `'*'` | **class rule already** |
| `news_post_plan_side`, `notification_plan_side` | 77, 82 | `db/96`, live | unchanged |
| `news_post_read_own`, `news_post_public` | 79, 80 | own rows | unchanged |
| `notification` (`notification_read`) | 83 | `app_can(required_capability, school, COALESCE(team,'*'), COALESCE(subject_person, zeros?))` — UNSURE per row | **O-N (§4):** a team notice with no child passes zeros for a guardian with team NULL, so every guardian at the school reads every side's "sheet published". After `db/101` lands, the builder enumerates `required_capability`/`subject_kind` values in use (§5 item 10) and moves the team-no-child case to `side_reach()`. A notice naming a child already follows the child. |
| `milestone_notice` | 76 | `player.profile.read`, row id | class C1 (the side shares milestones; A6) |
| `notification_delivery`, `notification_read`, `device_push_token` | 87, 88, 32 | own | unchanged |

### 3.3 Class C · A boy's own record and figures

**Plain words.** Rows about one boy. The argument is **always the row's player id** — never zeros, never `NULL`. A guardian passes for her child, a pupil for himself, a coach for his side, the office school-wide. Two sub-classes, because the pupil's `player` row holds `player.profile.read` at team scope and so passes for team-mates on every table under that capability:

- **C1 — facts the side shares** (a team-mate may know them; several are public under A5/A6): `player` (the row — masked by `player_masked` for the API, M4), `honour`, `team_cap`/caps, `milestone_notice`, `team_membership`, `training_attendance`, `equipment_issue`. Capability `player.profile.read`, row id.
- **C2 — the boy as a person** (nobody but his family, himself, and the staff tier the capability names): `emergency_contact` (`player.emergency.read`), `injury` (`medical.status.read`, tiers by `injury_masked`), `match_availability` and its history (`availability.read`), `disciplinary_record` (`discipline.read`), `player_skill` and `development_note` (`player.development.read`, `player.note.read`), `load_entry`, `bowling_breach` (`player.workload.read`), `lift_seat` (`transport.lift.arrange`, `db/70`), the **consents**: `public_name_consent` and `health_monitoring_consent` (table: `guardian.link.manage`; the family through definers `my_health_consents()` and db/47's), and — **today in the wrong place** — `player_scouting_consent` (`player.profile.read`, row id: the side reads them, O6) and `passport_consent` (`player.profile.read`, **zeros, `'*'`**: the whole receiving school reads every family's, O5).

**Argument:** the row's player id under the table's capability. For the four consent tables: **`is_family_of(player_id) OR app_can('guardian.link.manage', <school>, '*', zeros, zeros)`** — the family and the office, as db/47 and db/60 already spell it. For `passport_consent` the school in that clause is `to_school_id` (the receiving office sees what has travelled to it); the receiving coach reads the passport itself through `passport()` (`db/08:6284`), which is definer and unchanged.

The pupil's figures: `career`, `career_by_season`, `dismissal_breakdown`, `player_shot_points`, `bowler_day`, `milestones` are reads over invoker views of `ball_event` gated per boy by `player.performance.read` (AV-D3). Himself: yes through `selfaccess`. His team-mates: **yes today**, because `player` holds `player.performance.read` at team scope (`roles.mjs:333`) and he reads his side's log (M5; §7 D2).

### 3.4 Class D · Another boy's record and figures

**Plain words.** Never, as a person. The only facts a guardian or a pupil reads about a boy who is not theirs are the ones the side shares (C1) and the fixture carries (A: his name and figures on the scorecard of a match they may read, Q4; his name and place on the sheet of a fixture they may read, Q10 and the pupil's side read). There is no class-D policy to write: class D is what classes A–C refuse when the argument is the row's player id. The design's test for it is in §6.1: for every seed guardian and pupil, the set of `player_id`s reachable through any class-C2 table equals {own children} or {self}.

### 3.5 Class E · The sheet and availability

**Plain words.** The sheet, once published, is the side's: every boy on it, his guardians, and its staff read the names and the order. Kameel decided (STEP4 Q10, 27 Sep) that a parent sees the eleven — "signed in, her own child's side and fixture only, the named players and their order — names only, no profiles, ages or photos. A narrow read over `match_squad`, not `player.profile.read`." That read is not yet built (M1): today `match_squad_read` gives her one row, her child's. Availability stays per boy: his family, himself, and the staff holding `availability.read` at the side; a team-mate never (STEP4:421).

**Argument.** `match_squad` keeps `match_squad_read` as it is (row id under `player.profile.read`, per side — the staff's and the team-mate's full read; AV §3.3 "per side already"). The parent's eleven is a definer read **`fixture_sheet(p_match)`** returning `(side, position, display name)` — no `player_id`, no profile field — gated by: *the sheet is published* **and** *the caller may read some boy on this side's sheet under `player.profile.read`* (branch 3 of `fixture_reach()` with `player.profile.read`). That gate admits the parent (her child is on it), the pupil (himself), the side's staff and the office; it refuses a spectator (no `player.profile.read`) and the other school's family (their boy is on the other side's sheet, which is why the function returns one side at a time, or both only to a caller who passes for both). "Published" is whatever `match_squad` records today — §5 item 8 verifies the column. The route is `GET /api/matches/:id/sheet`; the P3 and S3 "TEAM SHEET" card draws it (Sonnet, after the read).

`match_availability`, `match_availability_history`: row id under `availability.read` — **class rule already** (`inv #63, #64`).

### 3.6 Class F · Transport and lifts

**Plain words.** The bus belongs to the fixture: whoever is at the side reads the trip — departure, return, pickup, the driver's name, the status word. A trip row also carries `notes`, which may name a child ("collect R Pillay at the gate"), so it is a side-level row with a child's name on it and must not reach other sides' parents. Lifts (`db/70`, decided) are the guardian's own offers and her children's sides, never a pupil's (`not_pupil`).

**Argument:** `trip` → `fixture_reach('transport.read', trip.match_id)`; `trip_driver_own_read`/`trip_driver_own_only` unchanged (a driver reads his own). `vehicle` → class G unless its columns carry a person's details (registration and owner? §5 item 9). The five `lift_*` tables → **unchanged** (`db/70`: `lift_my_sides()`, `lift_my_offers()`, `not_pupil`), which is already this design's shape.

| table | inv # | today |
|---|---|---|
| `trip` (`trip_read`) | 130 | zeros, home anchor → every trip at the school with driver, pickup, notes (M3) |
| `vehicle` | 131 | zeros, `'*'` → every vehicle at the school (columns UNSURE) |
| `lift_*` | 54–58 | class rule already |

### 3.7 Class G · School-level reference data

**Plain words.** Rows that belong to the school or the platform and name no child: the school row, grounds and their windows, closures and conditions, equipment, competitions, divisions, entrants, publications, standings, condition sets and values, fixture plans, seasons, sports, drills, the rulebook, playing-condition keys, feature flags, the bowling directives and ceilings, clearance kinds, sponsor categories, load units, names-off switches, derbies, cap baselines. A parent at the school reads the school's; everyone enrolled reads the platform's. **A table in this class may never carry a child's name or a person's details**; one that does moves class (`feature_suppression` named a person — `db/102` moves it; `feature_grant` is a school's plan and belongs to that school — O2).

**Argument:** zeros with team `'*'` under the table's capability, or `app_enrolled()` for platform catalogues (`db/81`). For a school-scoped row that every assignment-holder at the school may read regardless of capability, the existing `lift_at_school(school)` idiom (`db/70:409`, "any live assignment at this school") is the spelling; the lead may rename it `at_school()` when it gains a second caller.

Policies in this class (class rule already, unless noted): `school` (110), `ground*` (46–49), `equipment` (38), `competition*` (22–28), `competition_entrant` (25: coalesced team — the pupil sees his side's entry and team-less entries, fine), `match_progression`, `competition_points_adjustment` (70, 26: organiser-only, UNSURE bodies — low risk), `fixture_plan*` (43, 44), `condition_set/value` (28, 29), `derby` (30), `season`, `sport`, `drill`, `rulebook_*`, `playing_condition_key`, `feature_flag`, `clearance_*`, `sponsor_category`, `load_unit`, `bowling_directive`, `bowling_ceiling_open`, `public_names_off`, `cap_baseline` (UNSURE columns, §5 item 9), `capability`/`role_capability`/`role_grantable` (catalogues, `USING (true)`). **Not in class:** `feature_grant` (41, O2 → school-scoped), `feature_suppression` (42, `db/102`), `official`, `official_accreditation` (89, 90, O4 → class H).

### 3.8 Class H · Adult-only

**Plain words.** Staff, officials, finance, audit, safeguarding, the pad's credentials, the office's registers. No capability a guardian, pupil or spectator holds opens them; the person argument is irrelevant to the answer but is spelled **all-f** (or the row's own `person_id = app_user_id()` for "my own row") so that a capability added to a family bundle later cannot open a whole table by accident. The safeguarding tables' restrictive set (`db/57`) and the lift tables' `not_pupil` are the pattern.

| table(s) | inv # | note |
|---|---|---|
| `staff`, `coach` (`user.read`, row), `app_user` (own row) | 123, 21, 8 | class rule already |
| `role_assignment`, `assignment_subject`, `role_request`, `role_assignment_ending`, `duty_suspension`, `account_status_change` | 103, 9, 107, 104, 36, 5 | own rows / `user.role.assign` — already |
| `access_log`, `scoring_audit`, `support_access`, `pad_resume_credential`, `public_listing`, `player_never_public`, `adult_clearance`, `scout_accreditation` | 1–3, 115, 124, 91, 98, 94, 6–7, 117 | already |
| `safeguarding_*` (4 tables, 16 policies) | §3b | already (`db/57`) |
| `scorebook_import*` | 111–113, §3b | already (`db/63`) |
| `scoring_amendment` (own requests), `request_replay` (own) | 114, 101 | already |
| `sponsor`, `sponsorship`, `reward_weight` | 119, 121, 102 | already |
| **`official`, `official_accreditation`** | 89, 90 | **`app_enrolled()` → every enrolled person reads `id_number`, `born`, `phone`, `email`** (O4, §7 D5) |
| **`feature_grant`** | 41 | `app_enrolled()`, no school scope (O2) |
| `feature_suppression` | 42 | **`db/102`**, decided |
| `health_monitoring_consent`, `public_name_consent` (tables) | 51, 99 | office; the family through definers — already |

---

## 4 · Every mismatch, and the design's answer

Order of fixing is by risk, after the three in hand. "Narrows" means fewer rows reach a family reader; "widens" means more.

| # | mismatch (inventory) | the design's answer | narrows / widens | risk if left | order |
|---|---|---|---|---|---|
| **O8** | a pupil's `player` row may have no team (`roles.mjs:37`; `db/50:224`): such a boy reads every side at the school (§7 "other findings") | `player` joins `TEAM_SCOPED_ROLES`; the CHECK constraint is re-emitted; existing NULL rows are given a side by the office before the constraint lands (§7 D4) | narrows | **highest if any such row exists**: every sheet, post, bus list and team-mate-level row at the school to one child; zero if none exists | **verify first (§5 item 1)**; build 1st if any row exists, else 4th |
| **M3** | `match_read`, `trip_read`, `training_session_read` and the home-only satellites give a guardian every row at her school (zeros); the browser filters (`family.js:64–66`) | class A and F: `fixture_reach('fixture.read' / 'transport.read', match)`; `training_session` → `side_reach('team.read', school, team, zeros)`; the `matches` route's own zeros call (`read-api.mjs:149`) is aligned or dropped, RLS being the floor | narrows (and **widens** for the away side's parent on toss, officials, weather, pitch, conditions, which she cannot read today) | **high**: every trip at the school with driver, pickup and `notes` that may name a child; every side's training; every fixture — to every parent, one `?team=` away in the API | **1st** (or 2nd after O8) |
| **O5** | `passport_consent_read` (`db/08:6244`): zeros + `'*'` under `player.profile.read` at `to_school_id` → every guardian and pupil at the receiving school reads every family's consents naming it | `is_family_of(player_id) OR app_can('guardian.link.manage', to_school_id, '*', zeros, zeros)` — the family and the receiving office, as db/47/db/60 spell consents; `passport()` unchanged | narrows | **high**: another family's child named with the school his record is travelling to — a move not yet announced, readable by every parent and pupil there | **2nd** |
| **O6** | `player_scouting_consent_read` (`db/08:2106`): `player.profile.read`, row id → a pupil reads his team-mates' scouting consents | same spelling as O5 at `player_school(player_id)` | narrows | **medium**: "scouting interest" is N5's never-public class; a side reads who is being watched | **2nd**, same migration as O5 |
| **O4** | `official_read` (`db/08:1687`, `db/81`): `app_enrolled()` over a table holding `id_number`, `born`, `phone`, `email`; the API reads `official_masked` (`read-api.mjs:910–931`) | **close it** (§7 D5): `official_read` → `officiating.registry.manage` (and the official's own row if a person link exists, §5 item 6); the panel's open view becomes a definer function naming its columns (the SCRBRD-083 `public_*()` pattern), gated `app_enrolled()`, tested against the never-list; the API switches to it | narrows | **medium**: the API is safe by one route's discipline; the table is one join away in any future route; and a **pupil who scores is an official** (PUBLIC_DATA §5a), so a child's ID number and date of birth sit in an open table | **3rd** |
| **O2** | `feature_grant_read` (`db/08:2363`, `db/81`): `app_enrolled()`, no school scope → anyone enrolled reads every school's plan | `app_enrolled() AND (school_id IS NULL OR lift_at_school(school_id))` — "not a secret from that school" (the policy's own comment), and from no other | narrows | **low**: which modules a school pays for; no child | **3rd**, same migration as O4 |
| **O-N** | `notification_read` (`db/09:448`): a team notice with no child (sheet published, training moved) passes zeros for a guardian → every guardian at the school; UNSURE per row | class B: team-and-no-child → `side_reach(required_capability, school, team, zeros)`; child named → the child; after `db/101` lands and the row values are enumerated (§5 item 10) | narrows | **medium**: every side's operational notices to every parent; the titles carry no child's name by the notifications design, but "U15A team sheet published" to a U13 parent is noise and a leak of who plays when | **4th** |
| **M5** | `player` holds `player.performance.read` (`roles.mjs:333`); a pupil reads his side's log; the invoker career views therefore give him a team-mate's career, season and wheel (GA-I27:121 "another boy's figures in any form") | **§7 D2**, recommended closed: remove `player.performance.read` from `player` (keep in `selfaccess`) if 138's captain tab does not depend on it at team scope; otherwise gate the per-boy reads (`career`, `career_by_season`, `dismissal_breakdown`, `player_shot_points`, `bowler_day`) on `is_family_of(player) OR` a staff capability `OR` 138's captain gate (REACH-D2, 14 Oct: left open; not fixed). | narrows | **medium**: a dossier about one boy (wagon wheel, dismissal breakdown, season by season) to every team-mate; the public rule says no page per player (A4) and a parent is refused the same row (STEP4:227) | **5th**, after the decision and §5 item 12 |
| **O7** | `spectator` is self-registrable and school-wide when team is NULL: every team post and every fixture at the school | **§7 D3**: team posts reach him only when the office scoped him to the side (`db/101`'s side rule already does this if it uses `news.read` in branch (1); §5 item 3 verifies); fixtures as today (AV-D5); the office's approval screen says what a spectator sees | narrows (posts) | **low–medium**: the office is the gate; a school-wide spectator reading every side's posts is the M2 shape for a stranger | **5th** |
| **M1** | `match_squad_read` gives a guardian one row; STEP4:227/Q4/Q10 say she sees the eleven; Kameel decided Q10 "yes, names and order, a narrow read" on 27 Sep; not built | class E: `fixture_sheet(match)` definer read, published sheets only, gated by `player.profile.read` over some boy on that side's sheet; names and order, no id | **widens** (decided) | **low**: a decided feature missing; parents arrange lifts off-app meanwhile | **6th** |
| **M4** | `player_read` gives a pupil his team-mates' raw rows (`player.profile.read`, side); `player_masked` (`db/58:66`, invoker) does the masking for the API only | not restructured now: `player_masked` is an invoker view and needs the base policy to pass, so closing the table means a definer read of `player` — a large change. Instead: a static test that no API route selects a masked column from `player` except through `player_masked` or `tables.mjs`'s mask (§5 item 7), and a `db/99` assertion that the pupil's reachable `player` columns through the API are the masked set | — (defence in depth) | **medium–low**: today's exposure is table-level only; a future route that joins `player` for an email is the failure | **7th**, after the above |
| **M2** | team posts to every guardian at the school (`db/12:73`, zeros) | **`db/101`**, decided and building; class B names it | narrows | in hand | — |
| **O1** | the ball log to no guardian (`db/02:212`, `NULL`; `db/97` keeps `NULL`) | **`db/100`**, decided and building; class A names it; §6.1 proof 1 checks the helper agrees | widens | in hand | — |
| **O3** | `feature_suppression_read`: every school's suppressions with `person_id` and `reason` to anyone enrolled | **`db/102`**, decided and building | narrows | in hand | — |
| drift | STEP4:54 cites `roles.mjs` 271–336; live lines are 330–335 and 376–386 | Haiku corrects the citation and marks Q10 "decided 27 Sep, built in <this design>" when it lands | — | none | docs pass |

**`official`, specifically.** The brief asks whether the table-level open read should still be closed when the API reads only `official_masked`. **Yes, for three reasons, in order of weight:** a pupil can be an official (a scorer), so this is not only adults' data; the masked view protects one path and the table is one join away in any route written tomorrow; and the project's own rule for the public pages (SCRBRD-083 §1 item 4, "allowlist, never denylist; a field added later reaches nobody until somebody puts it on a list") is the right rule for a table of ID numbers too. The cost is that `official_masked` as an invoker view cannot survive a narrowed base policy, so the open panel must become a definer function with named columns (§4 O4). That is a day's work and a `db/99` section, not a redesign.

---

## 5 · What the builder verifies live before anything is built

The inventory was derived from code, not run. Each item names what to check, how, and which migration waits on it. Rows the inventory marked UNSURE are items 9–10. The lead or Opus runs these (Haiku does not run SQL).

| # | verify | against | gates |
|---|---|---|---|
| 1 | **Any `role_assignment` with `role = 'player'` and `team_code IS NULL`** (count, by school), in the pilot database and the seed | `db/50:224` passes every team for such a row | O8's order (§4); D4 |
| 2 | **`NULL` and all-f give the same answer** for a guardian, a `selfaccess` holder, a coach and a spectator on one `match` row each; and that the live `app_can()` body is `db/50`'s (`pg_get_functiondef`) and not the generator's older copy | §1.2; `generate-rls.mjs:170–182` | every helper |
| 3 | **The final text of `db/100`, `db/101`, `db/102`** as merged: which person spelling each uses, whether `db/101`'s side test is under `news.read` or `team.read` (a team-scoped spectator passes the first and not the second) | §1.3; D3 | 6.1 proof 1; O7 |
| 4 | **The two-school guardian's assignment shape** in the seed (`db/98:387–388`) and in the pilot: one assignment per school, or one with `school_id` NULL | §2.1; `db/50:222` | class G's zeros + `'*'` closes nothing if every guardian row is school-scoped; if a school-NULL row exists, group R-A adds a `CHECK` that a `guardian` row names a school |
| 5 | **Which tables are home-only today** through `match_school()`/`match_team()`: the list in §3.1 against `pg_policies` | AV §3.3's never-change list (session, quarantine, audit stay) | the class-A migration |
| 6 | **`official`'s columns and whether it links to a person** (`person_id`?); the table grants on `official` and `player` to `scrbrd_app`; which routes read `official` other than `read-api.mjs:910–931` | §4 O4, M4 | O4's migration |
| 7 | **Every API route that reads `player` raw** and which columns; `tables.mjs`'s mask list for `player` | M4 | the static test |
| 8 | **How `match_squad` records "published"** (a column, a status, a timestamp) and what the P3/S3 "Team sheet" card reads today | §3.5 | M1's `fixture_sheet()` |
| 9 | **Columns of** `vehicle`, `cap_baseline`, `load_unit`, `public_names_off`, `fixture_publication` — does any carry a person's name, registration or a child? | §3.6, §3.7; inv §3d | whether each stays class G |
| 10 | **`notification` rows in use:** distinct `(kind, subject_kind, required_capability, team_code IS NULL, subject_person_id IS NULL)` | §3.2 O-N; inv §3d | the class-B notice migration |
| | **Run 29 Oct 2026 (R-E, `db/123`).** On a database at `db/121` with the pilot seed: team set and no child — `notice/news/news.read` ×1 ("Nets moved to Thursday", `db/101`'s already), `notice/training/news.read` ×1 ("U16B training moved"), `injury/injury/medical.status.read` ×1 ("Availability update", 1st XI); a child named — `injury/injury/medical.nature.read` ×3; school-wide — `notice/news` ×1, `system/system` ×1; no recipient row. Writers in the schema with a team and no child or recipient: `fixture/match/fixture.read` from `db/72` `progression_check()` and `db/114` `result_official_notices()`, and `db/89`'s retraction copy of any notice. Everything else names a child (`db/65`, `db/70`/`76`, `db/113`), a recipient, or no team (safeguarding `db/57`/`93`/`111`/`116`, `db/114`'s competition notice, the system notices). No other shape. Result: the rule is written on the row's shape (team set, no child, no recipient, not safeguarding, not a post's notice), not on its kind. | | |
| 11 | **`EXPLAIN (ANALYZE)` of `match_read` and `trip_read`** with `fixture_reach()` on the seed and a synthetic forty-fixture season, as a guardian with two children | §2.5 "cost" | whether `my_sides()` is needed |
| 12 | **What the captain's tab reads and under which gate**: `captain.jsx:123` reads `career_by_season`; does 138's design admit team-mates' season figures to the captain, and does that rely on `player` holding `player.performance.read`? | M5; D2 | D2's path |
| 13 | **`competition_conditions_manager()` and `competition_organiser()` bodies** (inv §3d) | class G | none; confirm they name no child |
| 14 | **The seed personas' exact reach today**, per class, as the baseline each `db/99` section asserts against: the one-child guardian (`db/98:382`), the two-school guardian (`:387–388`), the pupil (`:404–405`), a coach, a spectator, the office | §6.1 | every proof |

---

## 6 · The build plan

Opus builds every policy, helper and migration (CLAUDE.md: authorization, schema, minors' data). Each group is one migration with its own `db/99` section; **the lead numbers it** — `db/96`–`db/102` are taken. Nothing below starts before §5's items that gate it. Sonnet takes the one screen (M1's card) after its read exists. Haiku does §6.10 after each merge.

### 6.1 Group R-A · The side helpers and the fixture (M3, satellites; prepares everything else)

- `side_reach()`, `fixture_reach()` as §2.5, with comments naming the three spellings.
- Re-create: `match_read`, `match_toss_read`, `match_official_read`, `match_pitch_report_read`, `match_weather_read`, `match_broadcast_read`, `match_conditions_read`, `match_condition_override_read`, `match_result_decision_read`, `drs_review_read`, `trip_read`, `training_session_read` (and `fixture_publication_read` if §5 item 9 keeps it in class A). The pad's three tables untouched (AV-D4).
- Align `read-api.mjs:149` (the `matches` route's zeros call) — drop it or pass the same question; RLS is the floor either way.
- `ADDED_SINCE_01` lines for each policy re-created, per `DEPLOYING.md`.
- **`db/99` proofs, each broken once and seen red:**
  1. **Agreement:** for every seed person and every `ball_event` row, `fixture_reach('fixture.read', match_id)` equals `db/100`'s predicate; for every `news_post` of kind plan, `side_reach('news.read', …) AND …` equals `news_plan_reach()` — the design fits the decided fixes (verified text, §5 item 3).
  2. **The guardian's fixtures:** Mrs Pillay reads exactly U15A's fixtures, home and away; none of the 1st XI's; the away fixture's toss, umpires and weather now reach her; after her link is ended (`valid_until` yesterday) she reads none. Sarah reads D Mkhize's side's at one school and K Dlamini's at the other and nothing else at either.
  3. **Playing up:** a U15A boy seeded onto a 1st XI sheet: he and his parent read that fixture, its trip and its toss; not the 1st XI's next fixture.
  4. **The pupil:** his side's fixtures both anchors; a boy on another side, none of his.
  5. **The spectator:** the school's fixtures (school-wide) or his side's (team-scoped); no trip (no `transport.read`).
  6. **The coach:** unchanged set before and after (the regression guard).
  7. **Trips:** a guardian reads her side's trips only; `notes` of another side's trip never reach her.
  8. **Cost:** the `EXPLAIN` of §5 item 11 recorded in the section's comment.

### 6.2 Group R-B · The family's consents (O5, O6)

- `passport_consent_read`, `player_scouting_consent_read` → `is_family_of(player_id) OR app_can('guardian.link.manage', <school>, '*', zeros, zeros)`.
- `db/99`: a guardian reads her child's and not another family's at the same receiving school; a pupil reads his own and not a team-mate's; the receiving office reads what names it; the receiving coach still opens the passport through `passport()`; a coach at the sending school reads none.

### 6.3 Group R-C · Adults' tables closed (O4, O2)

- `official_read` → `officiating.registry.manage` (plus own row if §5 item 6 finds a person link); `official_accreditation_read` likewise; a definer `official_panel()` (name the lead's) returning the masked columns, `app_enrolled()`-gated, with an `assertPublicSelect`-style column list tested against the never-list; `read-api.mjs:910–931` switched to it; `official_masked` dropped or left for the registry manager only.
- `feature_grant_read` → `app_enrolled() AND (school_id IS NULL OR lift_at_school(school_id))`.
- `db/99`: a pupil, a guardian and a coach read no `official` row; the panel function returns name, grade and accreditation and no `id_number`, `born`, `phone`, `email`; a seeded pupil-scorer's row is reachable raw only by the registry manager; a Hilton parent reads no Westville `feature_grant`.

### 6.4 Group R-D · `player` is team-scoped (O8; after §7 D4)

- `TEAM_SCOPED_ROLES` gains `player` (`roles.mjs:37`); the generator re-emits the CHECK; the migration first lists any NULL-team `player` rows (§5 item 1) and refuses to run while one exists, so the office assigns sides first (a notice to the office, as `db/10` did for links with no date of birth).
- `db/99`: inserting a `player` assignment with no team is refused; the pupil's reach is unchanged.
- `separation.test.mjs` gains the assertion.

### 6.5 Group R-E · Notices follow the side (O-N; after `db/101` and §5 item 10)

**Built 29 Oct 2026: `db/123_reach_notices.sql`, proof `db/99` §100.** A RESTRICTIVE read, `notification_follows_side`: a notice with a team, no child and no recipient, not safeguarding and not a post's notice (which follows the post, `db/96`/`db/101`), is read only by whom `side_reach(required_capability, school_id, team_code, zeros)` admits; everything else as before. `notification_report()` (`db/101`) asks the same clause, so a parent of another side is told the notice is not there. Family Notices leans on the server (no side filter on the screen). §5 item 10's result is recorded in §5. Two points left open for Kameel: the boy playing up does not get his sheet's fixture notices (that would be `fixture_end_reach()` on the notice's match), and the side is today's, not the notice's day.

- `notification_read`: team-and-no-child → `side_reach(required_capability, school_id, team_code, zeros)`; the rest as today.
- `db/99`: "U15A team sheet published" reaches the U15A parent and not the U13B parent; a notice about a child reaches his family only; a recipient notice reaches him only (unchanged).

### 6.6 Group R-F · A team-mate's figures (M5; after §7 D2 and §5 item 12)

**Not built: REACH-D2 decided "Leave them open" (14 Oct).**

- Path (a), if 138 does not depend on it: `player.performance.read` leaves the `player` bundle (`roles.mjs:330–335`); `role_capability` updated by the migration; `selfaccess` keeps it.
- Path (b), otherwise: the five per-boy reads gate on `is_family_of(player) OR app_can(<staff capability>, …) OR <138's captain gate>`, in `read-api.mjs`, with `read.test.mjs` holding the SQL equal to `db/99`'s copy as `my_children` does.
- `db/99` / pupil walk: his own career and wheel; a team-mate's `career?playerId=` refused; the captain's tab exactly as 138 decided; the match scorecard unchanged (Q4).

### 6.7 Group R-G · The spectator and team posts (O7; after §7 D3)

- Only if §5 item 3 shows `db/101`'s branch (1) refuses a team-scoped spectator: the spelling is changed to `news.read`, nothing else.
- `db/99`: a school-wide spectator reads school posts and no team post; a U15A-scoped spectator reads U15A's posts and no other side's; neither reads a plan (`team.read`, `db/96`, unchanged).
- The office's approval screen for a `spectator` request (SCRBRD-140) says in one line what he will see (Sonnet; copy from §2.3).

### 6.8 Group R-H · The sheet to the parent (M1, decided Q10)

- `fixture_sheet(p_match)` definer read as §3.5; `GET /api/matches/:id/sheet`; `ADDED_SINCE_01`.
- `db/99`: Mrs Pillay reads U15A's eleven names and order for Saturday and nothing for the 1st XI's fixture; a spectator reads nothing; the other school's parent reads her own side's eleven and not Hilton's; no `player_id` in the result; an unpublished sheet returns nothing.
- Sonnet: the "TEAM SHEET" card on P3 and S3 lists names and order (today's line "Named · batting 4" stays as the first line); Opus reviews (minors' names on screen).

### 6.9 Group R-I · Defence in depth on `player` (M4)

- The static test of §4 M4 over `services/api`; a `db/99` assertion that the pupil's reachable `player` columns through `players` are the masked set.

### 6.10 Haiku, after each merge

Roadmap and gap-analysis status rows; `DEPLOYING.md`'s paste list for each migration; STEP4's line drift and Q10's status; this document's §4 "order" column marked as each lands. Not `db/SHIPPED.sha256`.

---

## 7 · Decisions for Kameel

**Decided 14 October 2026 (Kameel), in chat:** D1, D3, D4, D5 as recommended; D2 the alternative ("Leave them open").

Only where the documents do not already decide. Each with the recommendation, the alternative, and why.

| # | decision | recommendation | alternative | why |
|---|---|---|---|---|
| **REACH-D1** | **A parent's fixture list: her child's side, or the school's.** Today the API returns every fixture at the school and the browser filters to the side. | **The side only, by policy** — class A as §3.1. The school's other matches are what the public home page lists at team level (SCRBRD-142, PUBLIC_DATA §1 item 7). — **decided 14 Oct** | Keep every fixture at the school at team level for a guardian (as today), and narrow only trips, training and sheets to the side. | STEP4:184 already says "for the child's team"; the trip row carries a driver, a pickup and `notes` that may name a child, and it belongs to the fixture — one rule for class A and F is what makes the proof one section; a parent who wants the 1st XI's score has the public page, or a `spectator` assignment, which is what it is for. |
| **REACH-D2** | **A team-mate's career, season and wagon wheel to a pupil** (M5). | **Closed.** The only other-boy figures a pupil sees are the scorecard of a match he may read (Q4) and whatever 138 decided for the captain. Path (a) — `player.performance.read` out of the `player` bundle — if §5 item 12 finds 138 does not stand on it; else path (b), the reads gate per boy. — **not taken: Kameel chose the alternative, "Leave them open" (14 Oct)** | Leave it: every boy at a cricket school knows every boy's average, and the scorebook on the pavilion wall shows it. — **decided 14 Oct** | GA-I27 §3.2 and C-D4 say a pupil never sees "another boy's figures in any form"; a career page with a dismissal breakdown and a wheel is a dossier about one boy — the thing A4 forbids in public and STEP4:227 refuses to a parent; the parent and the pupil should hold the same line about other boys. Does not touch AV-D3's cross-school gates: a Hilton boy stays refused to a Westville reader either way. |
| **REACH-D3** | **A spectator and team posts.** | **A team's posts reach him only when the office scoped him to that side** (`team_code` set); a school-wide spectator reads school posts and fixtures. The approval screen says so. — **decided 14 Oct** | Spectators never read a team post, scoped or not; or spectators read the public projection of the scorecard instead of the signed-in one (rejected in AV §2.3: a second scorecard shape for one reader class). | `db/101`'s side rule gives this for free if its unnamed branch is under `news.read` (§5 item 3); the office's grant is the gate SCRBRD-140 built; a grandparent the office admitted to U15A is the boundary crowd, a stranger admitted school-wide is not the side's. Not reopening Q4/AV-D5 on names. |
| **REACH-D4** | **`player` becomes team-scoped** (a CHECK, like `coach`). | **Yes.** The office gives every pupil a side; a boy not yet selected is on his age-group squad (the register is the side list). — **decided 14 Oct** | Allow NULL and have `app_can()` treat a NULL-team `player` row as reaching no team-level row — a change to `db/50`'s body for one role, against ADR 0003's "no role tests". | `roles.mjs:30–32` already says a team-less coach "reads every child at the school" and closes it with the CHECK; a team-less pupil is the same hole for a child; the fix is one line in the list the constraint is generated from. |
| **REACH-D5** | **Close the raw `official` table** when the API already reads `official_masked`. | **Yes**, as §4 O4: registry managers and the official's own row read the table; everyone enrolled reads a definer panel function with named columns. — **decided 14 Oct** | Leave the table open and add a static test that no route reads `official` raw. | A pupil who scores is an official (PUBLIC_DATA §5a), so the table holds a child's ID number and date of birth today; the allowlist rule the public pages follow (SCRBRD-083 §1 item 4) is the right rule for any table of ID numbers; a test guards routes, a policy guards the table. |

---

## 8 · What this document does not reopen

- **`db/96`** (the coach's plan reaches the side; `news_plan_reach()`), **`db/100`** (a guardian reads the balls of her child's side's fixtures, home and away; per-boy figures stay gated), **`db/101`** (ordinary team posts reach the side; a boy on the sheet and his guardians read that fixture's plan), **`db/102`** (named suppressions to the school's managers and the person named). This design's helper must agree with them (§6.1 proof 1); it does not change them.
- **STEP4's decided screens and questions:** the four-item bars; one child at a time; Q4 (names on the scorecard, signed in, as the pad wrote them); Q5 and Q7 (no widening of discipline or emergency contacts); Q6 (his conduct record behind a tap); Q10's shape (names and order, a narrow read — this design builds it, §6.8); §10's departure 11 (a reader may open any batter's row on the scorecard) is **not** this design's: REACH-D2 is about the per-boy career reads, not the scorecard's row expansion, which stays STEP4 §11's question.
- **PUBLIC_DATA** in every line, and SCRBRD-083's option C at eighteen. Nothing here is public; every reader in this document is signed in.
- **AV-D1–D5** (the log follows the fixture; names unmasked to the away side's signed-in readers; per-boy gates unchanged cross-school; the pad's tables host-only; spectators in). Class A extends AV-D1 to the fixture's satellites and does not touch §3.3's never-change list.
- **PB-D3** (the plan's audience is the side's roster, on the sheet or not, with its guardians and staff) and **GA-I27 C-D4** (no coaching point to a pupil or parent).
- **K3 (`db/55`)**: no medical tier in `player`. **`db/70`'s lift tables** and their `not_pupil` restrictive. **`db/57`'s safeguarding set.** **SCRBRD-110 Q7** (a parent's health access past eighteen while at school) and **SCRBRD-140** (who grants a `spectator`).
- **ADR 0001** (one assignment decides; capabilities apply within the assignment's own scope), **ADR 0003** (no new roles, no role names in policies): every rule here is a capability and an argument, never a role test.
- **`app_can()`'s body** (`db/50`): the three spellings keep their meaning; the design adds two derived questions beside it and retires one spelling for new policies by convention, not by code.

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `app_can()` | `db/50_pad_resume.sql:197–277` | the three spellings (§1.2) |
| `news_plan_reach()`, `news_notice_reach()` | `db/96_news_plan.sql:184–207` | the idiom `side_reach()` generalises |
| `is_family_of()`, `passport()`, `passport_open()` | `db/08_schema_programme.sql:6231, 6264, 6284` | class C's consents; the receiving coach's passport read |
| `lift_at_school()`, `lift_my_sides()`, `lift_my_offers()` | `db/70_lift_clubs.sql:409, 395, 659` | class G's "any assignment at this school"; the set-returning shape if cost demands it |
| `app_enrolled()` | `db/81_signup_google.sql:88–108` | class G platform catalogues; O2, O4 |
| `match_school()`, `match_team()` | `db/02_schema_scoring.sql:41–52` | the home-only anchoring class A retires for satellites |
| `match_read` (two anchors) | `db/09_rls_policies.sql:237–239` | the shape `fixture_reach()` keeps |
| `match_squad_read` (per side, row id) | `db/09:272` | unchanged; the sheet's staff read |
| `player_masked`, `injury_masked`, `official_masked` | `db/58:66`, `db/09:863`, `db/08:1751` | M4, O4 |
| `TEAM_SCOPED_ROLES`, `SUBJECT_SCOPED_ROLES`, the bundles | `packages/policy/src/roles.mjs:37, 54, 330, 376, 388, 422` | D4; who holds what |
| `my_children` read and `db/99` §49 | `read-api.mjs:2715`; STEP4 §10 | the link states a screen shows (§2.1) |
| the seed personas | `db/98_seed_pilot.sql:382, 387–388, 404–405` | every proof in §6 |
| `tools/smoke-browser-read.mjs` guardian group, `smoke-browser-pupil.mjs` | STEP4 §10 | the walks each group extends |
| `DEPLOYING.md`'s frozen-file rules, `ADDED_SINCE_01` | `DEPLOYING.md` | every migration here is a new `db/NN` |
