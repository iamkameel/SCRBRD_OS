# RLS anchor audit — policies that resolve their scope through a subquery

**Date:** 2026-09-24 · **Branch:** `claude/scrbrd-os-03vb2m` · **Fix:** `db/39_match_anchor_helpers.sql`

Found by the driver day-of screen (SCRBRD-085): a driver-only account reads
zero rows from `/api/read/trips`. The cause is not specific to transport.
`db/09` computes 54 policies' school/team anchor (18 tables × read, insert,
update — more than the 36 first estimated) with a plain subquery, and six
hand-written policies elsewhere do the same —

```sql
app_can('transport.read',
        (SELECT m.school_id FROM match m WHERE m.id = trip.match_id),   -- under the CALLER's RLS
        (SELECT m.team_code FROM match m WHERE m.id = trip.match_id), …, trip.match_id)
```

— and that subquery runs under the caller's own row-level security. A caller
who holds the table's capability but cannot read the anchor row gets a NULL
anchor, NULL on a resource narrows, and `app_can()` refuses. The
`SECURITY DEFINER` helpers `match_school()` / `match_team()` (db/02) exist
for exactly this and are already used by every scoring policy.

This document is the audit the product owner asked to see before any fix
lands, then what `db/39` does and what it deliberately does not.

---

## 0 · Read this first — minors' data, and what is withheld

| | Table | Whose data | What happens |
|---|---|---|---|
| ⚠ **Fixed** | `match_availability` | availability of **named pupils** ("unavailable, family") | A pupil's `selfaccess` now reads and declares **his own** row for any fixture at his school. Nobody reads anybody else's row who could not before. db/99 asserts both halves. |
| ⚠ **Withheld** | `trip` | pickup, driver; the key to `trip_contacts()` — **children's emergency contacts** | Resolving the anchor would show a school-wide driver **every** trip at the school, and with every trip id he can pull every travelling child's parents' phone numbers through `trip_contacts()` (§5.1). Not fixed. Narrower rule proposed. |
| ⚠ **Withheld** | `match_squad` | which **named minors** are selected | A coach holding a granted `enquiry` about one boy would read which of **another side's** fixtures that boy is named for. Not fixed; decision needed. |
| ⚠ **Withheld** | `training_attendance` | which **named minors** attended | Same `enquiry` widening, to another side's training register. Not fixed. |
| ⚠ **Live today, not caused by the anchor** | `trip_contacts()` | **children's emergency contacts** | A school-wide driver **already** receives the manifest — every travelling child's parents' names and numbers — for **any** trip at his school within ±1 day of departure, not just his own, given its id (probe P1: 3 contact rows for a trip he is not driving). The only thing in the way today is that the empty trip read hides the ids. And a driver who also holds `fixture.read` at the school (a parent there) already reads every trip id (probe P2). Needs the fix in §5.1 (2) regardless of anything else here. |
| Unchanged | `injury`, `emergency_contact`, `development_note`, `player_skill`, `honour`, `disciplinary_record`, `bowling_breach`, `team_membership`, `milestone_notice`, `injury_masked` | medical, family PII, coaching notes, discipline | Anchored through `player`. **No role is blind through them** in any assignment shape the product creates, so nothing to fix — and the `player` subquery is the defence in depth `tables.mjs` documents. Left as they are. |

---

## 1 · Every policy anchored through a subquery on an RLS-protected table

### 1a · Generated, `db/09_rls_policies.sql` — 18 tables × 3 policies = 54

Each table has `_read` (capability R), `_insert` and `_update` (capability W; the
update policy uses it in both USING and WITH CHECK). Anchor sources and their
own read gate:

| Anchor source | Read by | 
|---|---|
| `player` | `player.profile.read` at (school, team, person) **or** `player.roster.read` at the school (named exception) |
| `match` | `fixture.read` at (home school, home team, fixture) **or** at the away side |
| `competition` | `competition.read` at the school, or `competition_visible()` |
| `equipment` | `team.read` at the school |
| `training_session` | `team.read` at (school, team) |
| `ground` | `facility.read` at the school |

| Table | R (read) | W (insert/update) | Derived anchors |
|---|---|---|---|
| `honour` | player.profile.read | recognition.manage | team ← player |
| `emergency_contact` | player.emergency.read | player.emergency.manage | team ← player |
| `injury` | medical.status.read | medical.write | team ← player |
| `development_note` | player.note.read | player.note.write | team ← player |
| `player_skill` | player.development.read | player.development.write | school, team ← player |
| `equipment_issue` | player.profile.read | team.manage | school ← equipment, team ← player |
| `training_attendance` | player.profile.read | team.manage | school, team ← training_session |
| `competition_division` | competition.read (+ `competition_visible()`) | competition.manage | school ← competition |
| `ground_condition` | facility.read | facility.manage | school ← ground |
| `match_squad` | player.profile.read | team.select | school, team ← match (home or away by `side`) |
| `match_toss` | fixture.read | scoring.start | school, team ← match |
| `match_broadcast` | fixture.read | broadcast.publish | school, team ← match |
| `drs_review` | fixture.read | scoring.correct | school, team ← match |
| `match_official` | fixture.read | officiating.assign | school, team ← match |
| `match_pitch_report` | fixture.read | facility.manage | school, team ← match |
| `match_weather` | fixture.read | fixture.update | school, team ← match |
| `trip` | transport.read | transport.manage | school, team ← match |
| `match_availability` | availability.read | availability.declare | school, team ← match |

### 1b · Hand-written, same pattern — 6 policies and one view

| Where | Policy | Capability | Derived anchors |
|---|---|---|---|
| db/25 | `disciplinary_record_read` | discipline.read | team ← player |
| db/25 | `disciplinary_record_insert`, `_update` | discipline.write | team ← player |
| db/08 | `team_membership_read` | player.profile.read | team ← player |
| db/08 | `bowling_breach_read` | player.workload.read | team ← player |
| db/08 | `milestone_notice_read` | player.profile.read | school, team ← player |
| db/09 | `injury_masked` (mask columns) | medical.nature.read, medical.details.read | team ← player |

Related but not an anchor: `news_post_read` (db/12) gates competition-scope
news on `EXISTS (SELECT … FROM competition_entrant …)` under the caller's RLS.
See §5.2.

---

## 2 · Who holds the capability but cannot read the anchor

Computed from `roles.mjs`, then checked against the scope each role's
assignments actually carry. Two facts about `app_can()` decide which rows
matter:

- **A NULL school anchor** refuses every school-scoped assignment. Only a
  platform-wide one (`school_id` NULL) survives it.
- **A NULL team anchor** refuses only a **team-scoped** assignment. An
  assignment with `team_code` NULL (school-wide, fixture-scoped, platform)
  passes the team clause whatever the resource says.

| Table · op | Capability | Role blind at capability level | Assignment shape in practice | Blind today? |
|---|---|---|---|---|
| `trip` · read | transport.read | **driver** (no fixture.read) | school-wide, team NULL (db/98; `role_request_grant`) | **Yes** — school anchor NULL |
| `match_availability` · read | availability.read | **selfaccess** (no fixture.read) | school, one subject (himself) | **Yes**, for fixtures his `player` assignment cannot see (another side's) |
| `match_availability` · insert/update | availability.declare | **selfaccess** | same | **Yes**, same fixtures |
| `match_squad` · read | player.profile.read | **selfaccess**, **enquiry** (no fixture.read) | school, one subject | **Yes**, for fixtures outside the holder's other assignments |
| `training_attendance` · read | player.profile.read | **selfaccess**, **enquiry** (no team.read) | school, one subject | **Yes**, for another side's sessions |
| `equipment_issue` · read | player.profile.read | selfaccess, enquiry (no team.read) | school, one subject | Only for a person holding **nothing else**: equipment is school-anchored, so any `team.read` at the school (every pupil, every coach) resolves it |
| `emergency_contact` · read | player.emergency.read | transportcoordinator (no player read) | school-wide, team NULL | **No** — only the team anchor is derived; would bite a team-scoped coordinator, which nothing creates |
| `disciplinary_record` · insert/update | discipline.write | official (no player read) | one fixture, team NULL | **No** — same reason |
| `disciplinary_record` · read | discipline.read | competitionadmin (no player read) | platform-wide | **No** |
| every other row of §1 | — | none | — | No |

Every holder of `scoring.start`, `broadcast.publish`, `scoring.correct`,
`officiating.assign`, `facility.manage`, `fixture.update`, `team.select`,
`transport.manage`, `recognition.manage`, `medical.write`,
`player.note.*`, `player.development.*`, `competition.manage` holds the anchor
table's read capability **in the same bundle**, so at the same scope.

---

## 3 · What changes, per (role, table, operation), if the anchor used the helpers

The helpers return the true school/team whether or not the caller can read the
match. So the change is exactly: rows where `app_can(capability, true anchors)`
passes but the caller cannot read the anchor row through any of their
assignments.

| Role · table · op | Change with `match_school()`/`match_team()` | Verdict |
|---|---|---|
| any · `match_toss`, `match_broadcast`, `drs_review`, `match_official`, `match_pitch_report`, `match_weather` · read | **None, provably.** R is `fixture.read` and the table has no person anchor, so `app_can('fixture.read', match_school, match_team, ANY, match_id)` *is* the home arm of `match_read`. Visible after ⇔ visible before. | Converted (db/39) |
| any · the same six · insert/update | **None for any role.** Every holder of the six write capabilities holds `fixture.read` in the same bundle at the same scope. A future bundle that broke that would be decided by `app_can()` on the write capability — which is what it is for. | Converted (db/39) |
| **selfaccess** · `match_availability` · read | A pupil newly reads **his own** declarations for every fixture at his school, including another side's that his `player` assignment cannot see (the call-up case). The person anchor is his own id, so nobody else's row. | **Intended** — converted (db/39) |
| **selfaccess** · `match_availability` · insert/update | A pupil may newly declare **his own** availability for any fixture at his school. His guardian could always do this (guardian holds `fixture.read`); `availability_player_belongs()` still refuses another school's fixture. | **Intended** — converted (db/39) |
| **driver** · `trip` · read | Newly reads **every trip at every school where he holds transport.read** — all trips at his school, not just his own. And with the ids, every manifest through `trip_contacts()` (§5.1). | **Beyond intent** — withheld |
| **enquiry** · `match_squad` · read | A coach granted an enquiry about boy B newly reads B's squad rows for **every** fixture at the school for the enquiry's term — which of another side's matches B is selected for (the match row itself stays hidden). | **Ambiguous** — withheld |
| **selfaccess** · `match_squad` · read | A pupil newly reads his own selection for another side's fixture. | Intended, but on the same policy as the enquiry row above — withheld with it |
| **enquiry** · `training_attendance` · read | A coach granted an enquiry reads B's attendance at **another side's** training sessions. | **Ambiguous** — withheld (no helper exists either) |
| **selfaccess** · `training_attendance` · read | A pupil reads his own attendance at another side's sessions. | Intended; coupled to the enquiry row — withheld |
| selfaccess / enquiry · `equipment_issue` · read | Nil for any real account (see §2). | Not converted — nothing to fix, and no helper exists |
| transportcoordinator · `emergency_contact` · read; official · `disciplinary_record` · write; competitionadmin · `disciplinary_record` · read | Nil for every assignment shape the product creates. | Not converted — nothing to fix; defence in depth kept |
| everything anchored through `player`, `competition`, `ground` | Nil. | Not converted |

---

## 4 · What `db/39` changes, exactly

`db/39_match_anchor_helpers.sql` is generated by
`services/api/rls/generate-rls.mjs` the way db/23 and db/35 are: `tables.mjs`
now declares the helper anchors (`viaMatch()`), `REANCHORED_IN_39` in the
generator lets it keep emitting db/09 byte-for-byte as shipped, and db/39
re-creates **21 policies** — `_read`, `_insert`, `_update` on:

`match_toss`, `match_broadcast`, `drs_review`, `match_official`,
`match_pitch_report`, `match_weather`, `match_availability`

Each anchor changes from `(SELECT m.school_id FROM match m WHERE m.id = t.match_id)`
to `(match_school(t.match_id))`, and likewise team → `match_team()`. Capability,
person anchor and fixture anchor are unchanged. The file ends in a generated
`DO $check$` that reads `pg_policies` and refuses to commit unless all 21 use
the helpers and none still reads `match`, and that both helpers are still
`SECURITY DEFINER` with a pinned `search_path`.

Net effect on access: **one** — a pupil's own availability, §3. The other six
tables change nothing for anybody; they are converted so that whether a row's
anchor resolves no longer depends on which *other* assignments a person holds.

`db/99` gains a section asserting: the 21 policies use the helpers; the pupil
reads his own U16B declaration and not the U16B boy's beside it, and in total
exactly his own rows; he can declare his own and cannot declare or change
another boy's; he still cannot read the U16B fixture itself; for eleven
principals no row of the six tables is visible without its fixture; and the
driver still reads no trips (the withheld case, as a tripwire).

---

## 5 · What the current behaviour hides

### 5.1 · `trip` — hidden by accident, and a real leak behind it

- **Latent bug.** A driver cannot see the trip he is driving. `trip.driver_id`
  names him and `trip_mark()` accepts his marks, but the read is empty.
- **Correctly hidden, would leak.** His assignment is school-wide
  (`role_assignment(driver, HIL, team NULL)` in db/98, and the role-request
  grant path creates the same shape). With the helper anchor he would read
  every trip at the school. Worse, `trip_contacts()` gates the driver path on
  `app_can('transport.drive', school, team, ANY, match)` inside a ±1-day
  window — which a school-wide driver passes for **every** trip. Confirmed
  live (probe P1): the seeded driver, asking about a trip with no driver
  named, receives 3 emergency-contact rows. Today the only thing between a
  driver and every travelling child's contacts is that he cannot enumerate
  trip ids. `trip_mark()` has the same shape: a school-wide driver may mark
  any trip at the school.
- **Already leaking, for some drivers.** The subquery resolves under the
  caller's *whole* RLS. A driver who also holds `fixture.read` at the school —
  a parent there, a spectator account — reads every trip already (probe P2),
  and so reaches every manifest.

**Proposed narrower rule (not implemented — product decision):**

1. `trip` read gains a named exception: `trip.driver_id = app_user_id()` —
   the named driver reads his own trip. Nothing else about the anchor changes.
2. `trip_contacts()` and `trip_mark()` gate the driver path on
   `t.driver_id = app_user_id()` instead of school-wide `transport.drive`.
3. Decide whether a driver should hold school-wide `transport.read` at all.
   It is what makes (2) necessary and what the multi-assignment leak rides
   on. The `vehicle` read the day-of card needs could come the same way as
   (1): the vehicle on a trip you drive.

(1) alone fixes the day-of screen without widening anything; (2) closes the
manifest leak whether or not (1) lands. After (1), the dayof walk and the
db/99 tripwire flip to "sees his own trip, and not the other one".

### 5.2 · Other things hidden that arguably should not be

- **A pupil's own call-ups** (`match_squad`) and **attendance at another
  side's training** (`training_attendance`), via `selfaccess` — see 5.3.
- **Competition news** (`news_post`, scope `competition`) is invisible to
  every role holding `news.read` without `competition.read`: scorer, official,
  driver, facilities, media, medical, finance, sponsorship,
  transportcoordinator, scout. A league notice about a fixture a scorer is
  scoring does not reach him. Hand-written in db/12, not in scope here.

### 5.3 · Hidden correctly, and would become a leak

- `trip` for a school-wide driver — §5.1.
- `match_squad` / `training_attendance` for a granted **enquiry**. `roles.mjs`
  describes the enquiry as answering "is this boy available on Saturday —
  availability and a name". Reading which of *another side's* fixtures he is
  selected for, or which of their sessions he attended, is plausibly inside
  that (it is still `player.profile.read` about him) and plausibly not.
  **Proposed:** keep the subquery, and give the pupil his own rows with a
  named exception — `player_id = (SELECT player_id FROM app_user WHERE id =
  app_user_id())` — so the latent pupil bug is fixed without deciding the
  enquiry question. `match_squad` also needs a side-aware helper
  (the away side's school and team), which `match_school()` is not.

### 5.4 · The general inconsistency

Because the subquery runs under the caller's *union* of assignments, whether a
row's anchor resolves depends on unrelated appointments — the property
`app_can()` was written never to have ("never a union across assignments").
That is why converting even the no-change tables is worth doing, and why the
withheld tables need a rule that does not ride on it.

---

## 6 · Evidence

Capability matrix: `ROLE_CAPABILITIES` × `TABLES` in `@scrbrd/policy`
(computed, not read by eye). Live probes against a seeded database with db/39
applied, each inside a rolled-back transaction as `scrbrd_app`:

| Probe | Principal | Result |
|---|---|---|
| P1 | driver (school-wide), as shipped | trips 0 · matches 0 · **`trip_contacts()` on a trip he is not driving: 3 rows** |
| P2 | the same driver also holding a guardian assignment at the school | trips **2 of 2** — every trip, via the guardian's `fixture.read` |
| P3 | driver, `trip_read` recreated with the helpers | trips **2**, of which his own **1** — the widening that keeps `trip` out of db/39 |
| P4 | pupil (1XI + selfaccess), as shipped | own U16B squad row **0**; U16B fixture 0 |
| P5 | `match_squad_read` recreated with the helpers | 2XI coach holding an enquiry about the pupil: his U16B squad row **1** (fixture 0) · the pupil himself: **1** |

`db/99` on the same database: `ALL RLS LIVE ASSERTIONS PASSED`. Each new
assertion was then falsified once, by a sabotage applied in the same
never-committed transaction ahead of the whole file:

| Sabotage | Assertion that failed |
|---|---|
| `match_weather_read` put back on the subquery | 20 of db/39's 21 policies anchor through match_school() |
| `selfaccess` granted `fixture.read` | the pupil reads the U16B fixture itself |
| `match_availability_read` on invoker-rights copies of the helpers (the pre-db/39 semantics) | a pupil cannot read his own availability for a fixture his team assignment cannot see |
| read policy's person anchor → ANY | a pupil reads another boy's availability |
| `player` granted `availability.read`, a team-mate's row added | a pupil reads 2 availability rows; his own number 1 |
| insert policy on invoker-rights helpers | a pupil cannot declare his own availability … |
| insert policy's person anchor → ANY | a pupil declared availability for another boy |
| read and update policies' person anchor → ANY | a pupil changed another boy's availability |
| `match_toss_read` gated on `news.read` | the driver reads 1 match_toss row for a fixture he cannot read |
| `match_toss` emptied | db/39's no-change claim has nothing to be tested against |
| `driver` granted `fixture.read` | the driver reads 12 fixture-condition rows with no fixture.read |
| `trip_read` recreated with the helpers | the driver reads 1 trip: trip was withheld from db/39 |
| (db/39's own `DO $check$`) `match_weather_read` on the subquery | db/39: policy match_weather_read does not anchor through match_school()/match_team() |
