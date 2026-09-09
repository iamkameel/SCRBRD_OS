# Assessment spec — reconciliation against the schema

**Spec:** *Player Skill Assessment & Longitudinal Development*, Draft 1
**This document answers:** §11.7, *"every column name here needs checking against
the 22-section schema, which was not available in this sandbox."*

The spec was drafted against `scrbrd_os.jsx`, the single-file artifact. This repo
has moved past it: there is a Postgres schema, a generated RLS layer, and a
capability model the spec's §9 table partly predates. Everything below is
verified against the running database, not read off the source.

The spec's design is adopted as written unless a finding says otherwise. What
follows is where it meets the schema and what has to change.

---

## Adopted without change

- **D1/D2 — append-only, current rating derived.** Already the house pattern:
  `ball_event_live` and `match_live_score` do exactly this for scoring, and the
  one place a fold forgot it (a voided ball still counting) is on record as a
  bug that reached the public scoreboard.
- **D3 — fixed ceiling, derived age view.** Adopted. The reasoning about a
  benchmark that moves faster than the player is correct and is the same shape
  as the promotion problem.
- **D5 — versioned rubrics, series broken not interpolated.** Adopted.
- **D6 — scores and notes separately access-controlled.** Adopted; the masking
  layer already does per-column, per-row gating and this is one more pair.
- **§7 — `skillsFor()` remains display-only.** Already true here: it returns
  `{ assessed:false }` for synthesised values and the profile popover labels
  them *"estimated — no coach assessment yet"*.
- **§8 — build the capture, not the correction.** Agreed. `assessed_by` is
  already recorded on every row.

---

## Findings

### F1 — `window` is a reserved word. The DDL does not run.

```
scrbrd=# create temp table t (window text);
ERROR:  syntax error at or near "window"
```

Verified. `WINDOW` is reserved in PostgreSQL (window functions). The column needs
quoting everywhere it appears, forever, or a different name.

**Recommendation:** `assessment_window`, or `cycle`. Quoting a reserved word in a
column that appears in an index, a policy, a unique constraint and every query is
a small tax paid repeatedly.

### F2 — `assessed_by` cannot reference `staff(id)`. Coaches are not staff here.

```
scrbrd=# select duty, count(*) from staff group by duty;
     duty      | count
---------------+-------
 groundskeeper |     1
 medical       |     1
 driver        |     1
```

`staff` holds non-coaching roles. Coaches are in `coach`. Neither is the right
target: an assessment is authored by a **person with an account**, and the
existing `player_skill.assessed_by` already references `app_user(id)` — which is
also what `app_user_id()` returns inside a policy, so an RLS check comparing
author to caller needs no join.

**Recommendation:** `assessed_by uuid not null references app_user(id)`.

This also settles §11.6 (self-assessment) more cleanly than the spec expected: a
pupil already has an `app_user` row and a `selfaccess` assignment, so allowing a
player to author an assessment about themselves needs no schema change at all.

### F3 — `tenant_id` is `school_id` everywhere else.

Cosmetic but load-bearing. The RLS generator derives every policy's school anchor
from a column named `school_id`; a table calling it `tenant_id` needs a special
case in the generator, and a special case in a security generator is where the
next hole goes.

**Recommendation:** `school_id uuid not null references school(id)`.

### F4 — `age_group` can no longer be split out of the team string. **This one changes the design.**

§5.1 says *"`PLAYERS.team` currently encodes both as one string (`"U19A"`) — split
them on write"*. That was true when the spec was drafted and is not true now.

South African schools have no U19. Above U16 a player is in the **open** category
and their team is the 1st XI, which carries no age at all:

```
scrbrd=# select distinct team_code from player;
 team_code
-----------
 1XI
 U16B
```

There is nothing to split. `1XI` yields no age group, so `benchmark(age_group,
skill)` in §3.2 has no key for any player over sixteen — which is most of a first
team.

Deriving the band from `player.born` instead is **not available**: `born` is
masked behind `player.pii.read`, which a coach does not hold. A coach who cannot
read a date of birth must not be handed an age-relative index computed from one.

**Recommendation, implemented:** `OPEN` is a band. The benchmark table is keyed
`U9…U16, OPEN`, and the band is recorded on the assessment at the time it is
made — which the spec already does, for a different reason. An open-category
player's age-relative index is measured against the terminal standard, which is
coherent: the ceiling is *provincial trial standard* and an open player is being
measured against exactly that.

Also note the §3.2 example curve `{U14: 52, U15: 58, U16: 65, U19: 74}` and the
§3.3 worked example both use U19. Neither is a school band.

### F5 — the partial unique index does not do what §5.2 says it does.

```sql
create unique index on skill_assessment (player_id, window, assessed_by)
  where status = 'committed';
```

§5.2 says this prevents *"a coach silently issuing three assessments in a term"*.
It does not. §6 step 5 moves the prior row to `superseded` on commit — so the
second assessment does not collide with the first, because the first is no longer
`committed`. A coach can issue as many as they like; each supersedes the last.

The two mechanisms are individually sensible and contradict each other.

**Recommendation:** decide which behaviour is wanted. Either
(a) the index is over `status in ('committed','superseded')`, and a re-assessment
in the same window is genuinely refused; or
(b) re-assessment within a window is allowed, the supersede chain is the record,
and §5.2's stated intent is dropped. **(b)** is more honest about how a term
actually goes — a coach who saw something new in week 8 should be able to say so
— and the supersede chain already makes the history visible.

### F6 — §9's access table contradicts the workflow just built.

The spec gives *Coach (other team)* → scores: **"current only"**, by default.

The model now says the opposite, at your instruction: a coach reaches a player
through the side they coach, and a coach from another team must **request
permission from that player's current coach**. A granted request creates a
time-boxed, single-player `enquiry` assignment carrying a name and availability —
and deliberately not the assessment.

Both cannot be true. **This needs your call**, because it is a policy decision
rather than a technical one:

| | Spec §9 | As built |
|---|---|---|
| Another team's coach | sees current scores | sees nothing without a request |
| Granted request | n/a | name + availability, 14 days |

My reading is that the access-request instruction is the later and more
considered position, and that development scores are at least as sensitive as
availability — so an other-team coach should see assessments only through a
granted request, and the `enquiry` bundle should stay as it is. But that is your
decision to make.

### F7 — "Analyst: scores, de-identified" needs a mechanism that does not exist.

The masking layer nulls **columns**, per row, per capability. It has no
de-identification: it cannot return a score while withholding which child it
belongs to, because the row IS the association.

De-identified analytics needs a separate read — an aggregate or a pseudonymised
export — not a mask. Worth scoping separately; it is a different shape of thing.

The spec's point that a free-text coach note about a fifteen-year-old is PII **in
substance** regardless of the field name is correct and should be enforced by
excluding notes from the analyst path explicitly.

### F8 — the existing seeded assessments have the provenance problem §10 describes.

§10 is about four hardcoded players in `SKILLS_MATRIX`. The same issue exists one
layer down: `db/98_seed_pilot.sql` inserts three `player_skill` rows with a score
and a date and **no assessor**, which is fabricated provenance of exactly the kind
§10 says not to create.

**Recommendation:** Option 1 (discard) when the real table lands. They exist to
make a demo radar chart non-empty and should not survive into a table whose whole
purpose is a defensible record.

---

## What has been built now, and what has not

The spec gates itself: §3.4, *"the schema must not ship before the anchors
exist"*. That is respected.

**Built:**

- `packages/scoring/src/rubric.mjs` — the rubric as data: the attribute set, the
  fixed ceiling written down, bands including `OPEN`, provisional benchmarks
  flagged as provisional, and `technical.footwork` anchored from §3.4 as the
  worked example. The write path no longer keeps its own copy of the attribute
  list — `ASSESSMENT_SHAPE` **is** `TREE`, so the two cannot diverge.
- The gate, made executable. `unanchoredSkills()` reports what is unwritten, and
  a test fails if an assessment schema ever exists while that list is non-empty.
  A paragraph is easy to forget under deadline; a red build is not.
- `ageRelative()` — returns null for an unknown band rather than 1.0, because
  "we do not know" and "exactly average" are different answers.

**Not built, deliberately:** `skill_assessment`, the immutability trigger, the
carry-forward write path, the derived reads. All of it waits on the anchors.

**Currently 1 of 33 attributes anchored.** §11.1 asks who writes `cricket-v1`
and by when. The form is ready for them.

## Two changes to the spec's model, by instruction

**The scale is 1-20, not 0-100.** Twenty points on the Football Manager
convention — 1-5 poor, 6-10 average, 11-15 good, 16-20 excellent. A 0-100
slider invites a precision no coach can defend: nobody can justify a 63 against
a 66, and at that resolution the disagreement between two coaches is larger
than the signal. Since drift between coaches is indistinguishable from a player
changing, false precision does not merely add noise to a longitudinal record —
it makes the record unreadable. Twenty steps is about as fine as human
judgement resolves, and it makes a one-point move mean something.

The performance index moved with it. Both halves of a rating are compared and
adjusted against each other, so an index on a different scale from an
assessment is not a rating; it is a category error with a number on it.

**Attributes are grouped TECHNICAL / MENTAL / PHYSICAL**, not by discipline.
The craft, the head, the body — three things that improve differently, are
coached differently and are observed differently. The four categories this
replaced (batting, bowling, fielding, fitness) read naturally and hid the thing
a development record exists for: a boy whose batting has stalled has either
stopped improving technically or stopped concentrating, and those need opposite
conversations. Grouping by discipline puts *technique* and *temperament* in one
column and makes that distinction unaskable.

The discipline view is not lost. `DISCIPLINES` cuts the same attributes the
other way, and that is what the performance index argues with — the ball log
knows runs off deliveries, not whether they came from footwork or timing, so it
can only speak to a discipline as a whole. Attributes are **grouped** for
coaching and **cross-cut** by discipline for evaluation. Neither grouping is
derivable from the other, so both are written down.

Some attributes appear in two disciplines (`mental.concentration` counts for
batting and bowling), one sits in PHYSICAL but only matters for bowling
(`physical.bowlingPace`), and `mental.leadership` belongs to no discipline at
all — real, assessed, and never measurable from a scorecard.
