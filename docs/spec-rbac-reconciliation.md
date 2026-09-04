# RBAC & CRUD scope — reconciliation against the schema

**Spec:** *SCRBRD — RBAC & CRUD Permissions Scope*, Draft for implementation
**Source of truth it cites:** `scrbrd_os.jsx` lines 37–55, 901–1029
**This document answers:** §11 (enforcement coverage) and §13 (implementation
sequence), against the running database rather than the single-file artifact.

The spec is a good one. Its four-layer model — role, scope, field, state — is
the model this codebase implements, and its hard rules (§12) are the rules the
policies enforce. What follows is where it meets a schema that has moved on
since it was drafted.

---

## §13 implementation sequence, as built

| # | Item | State |
|---|---|---|
| 1 | Route all data reads through `getData()` | **Done, and further** |
| 2 | Resolve tenancy from session | **Done** |
| 3 | `guardian_links` + constraints | **Partial** — see G1 |
| 4 | `role_assignments`; retire `users.role` | **Done** |
| 5 | Workflow state; `amendments` | **Partial** — see W1 |
| 6 | `access_log`; write from the choke point | **Done in this commit** |
| 7 | Split namespace; retire `profiles` | **Partial** — see N1 |
| 8 | Split `biometric` from `pii` | **Done in this commit** |
| 9 | Apply the §9 matrix | **Divergent by instruction** — see M1 |

### Item 1 went further than the spec asks

The spec's concern is that `getData()` is called once in 11,410 lines. It is
now the only path, and in a live session it does not answer at all: it returns
nothing and warns which call site asked. Reads go to the API, which reads
through row-level policies in Postgres.

That matters for §10, and changes where the log belongs — see A1.

### Item 2 is done, and `principalForRole()` is now demo-only

`school:"HIL"` survives in `data/mock.js` and `rbac/legacy-roles.js`, which are
the demonstration vocabulary for a build with no backend. Nothing in a live
session reaches them: identity comes from a signed token, and `app_user_id()`
inside the database resolves every scope from `role_assignment`.

### Item 4 is done, with one difference worth naming

`role_assignment` carries `person_id, role, school_id, team_code, season,
fixture_id, active, valid_from, valid_until, created_by`. The spec's `scopeType`
/ `scopeId` pair is instead four typed nullable anchors, because the decision
function compares them individually and a polymorphic `scopeId` cannot be
compared without a type switch in the hot path of every authorization check.

Resolution rules §8.3 hold: verbs union across assignments, **scope is never
unioned** (a capability held through one assignment applies only within that
assignment's scope), and past assignments are end-dated rather than deleted.

---

## Findings

### A1 — the access log cannot live in `getData()`

§10 says the log is "written inside `getData()`, which is why §11 is a
prerequisite". `getData()` is in the browser. A log written there is a log the
reader can switch off, which is not a log.

**Built instead:** written on the server in `readResource()`, after the rows
come back, through a `SECURITY DEFINER` function. `access_log` has **no**
INSERT, UPDATE or DELETE policy — the application role cannot write it at all,
and the only way a row appears is that function.

Two departures from §10 worth stating:

- It records **what was received, not what was asked for**. Masking is per row
  and per capability, so the same query returns different columns to different
  people; logging the query would record a disclosure that never happened for
  one of them.
- A read that returns no restricted field writes **nothing**. Opening a screen
  is not a disclosure, and a log that records attempts fills with noise and
  stops being read.

The log is not readable by the person who generated its entries. A log the
reader can read tells them exactly what to avoid next time.

### M1 — the §9 matrix conflicts with instructions given since

Two rows are superseded by decisions taken directly, and the later instruction
wins:

| | Spec §9 / §12.4 | As built |
|---|---|---|
| Coach → injuries | "R summary", never clinical notes | **Full record for their own side** |
| `born` | Restricted, coaches denied | **`player.age.read`, coaches hold it** |

The coach change is bounded by SCOPE rather than by tier: a coach assignment
must name a team, and the injury policy anchors through the player's current
side, so it is the notes for the children they actually coach and no further.

`born` moved because a coach picking a U13 side who cannot see an age cannot
avoid selecting a fifteen-year-old into it. §12.7 ("public-tier roles never
receive contact information") is untouched — age is not contact information,
and a spectator receives neither.

`id_number` is new and gated harder than anything in the spec: school office
only. It is the most dangerous field about a child in the schema.

### N1 — `profiles` is still an alias

§4.2 is correct and unfixed. `profiles` and `coaches` both map to the `coach`
table in the client's legacy resource map. It is now cosmetic rather than a
bypass — the alias exists only in the demo layer, and the live read path has no
`profiles` resource — but §4.2's reasoning stands and it should go.

`dashboard`, `management`, `settings` and `rulebook` are already nav-only:
`NAV_CAPABILITY` maps navigation to capabilities and carries no scope.

### W1 — scoring integrity is stronger than §7 asks, and the lifecycle is thinner

Stronger:

- `scoring` is append-only and **no table in the schema has a DELETE policy**,
  for any role. The generator emits none. §7.1 and §12.5 are exceeded rather
  than met.
- Correction is a compensating `void` event referencing the original, exactly
  as §7.1 requires — and `ball_event_live` is the single definition every
  reader folds over, after a bug where the scoreboard counted voided balls.
- Aggregates are views over the log. There is no writable aggregate for any
  role including the owner. §7.5 / §12.6 hold.
- Create on `scoring` is gated on capability **plus** a live scoring session,
  matching device and matching epoch — stricter than §7.2's "state is live".

Thinner:

- Fixture status is `scheduled | live | complete | abandoned`, not the
  eight-state lifecycle in §7.2. The scoring SESSION has its own state machine
  (`idle → active → verifying → handover_pending`) which covers the parts §7
  cares about operationally, but `submitted`, `verified`, `locked` and
  `archived` do not exist.
- There is no `amendments` table. A `void` records the correction and its
  author; it does not record an **approver**. §7.3 and §7.4 — amendment after
  lock, approved by sportsmaster or above — are not implemented.

### G1 — guardian links are a relationship, not yet a verified one

`assignment_subject` links an assignment to named players, and it carries the
guardian relationship today. It is also what gives a pupil access to their own
file, which is the same mechanism honestly named.

What §6 requires and does not exist: `verificationState`, `verifiedBy`,
`verifiedAt`, `consentState`, `consentVersion`, and end-dating on the link
itself. Nor the constraints — no learner may be active without a verified link,
the last verified link cannot be revoked, a coach cannot self-create a link to a
player in their own side.

**This is the largest remaining gap in the spec, and the spec is right that it
is the highest priority.** It is a POPIA obligation, it is schema shape, and it
must land before real learner data enters a database. It was not built in this
commit because §6.3 constraint 3 (who may establish a link) interacts with the
access-request workflow already built, and that is a design conversation rather
than a migration.

### F1 — field classes map, with one addition

§5's three classes map onto the capability tiers, with the age tier added since:

| Spec class | As built |
|---|---|
| Public | ungated columns on `player` |
| Internal | `player.profile.read`, `team.read`, `medical.status.read` |
| Restricted | `player.pii.read`, `player.biometric.read`, `player.identity.read`, `medical.nature.read`, `medical.details.read` |
| — | `player.age.read` — new, sits between Internal and Restricted |

§5.1's `biometric` split is done: `height` and `weight` are now
`player.biometric.read`, out of the contact group. They are information about a
child's body rather than a way to reach them, and a role that needs a bowler's
height for load management does not thereby need his home address.

`financial` remains a denial group with no table behind it — there is no
`finance` resource in the live read path.

### R1 — the role register differs

17 roles in the spec, 24 in the model. The tiers match; several names differ
(`sportsmaster` → `directorofsport`, `headcoach`/`assistant` →
`coach`/`assistantcoach`). Additions since: `selfaccess` (a pupil's own file),
`enquiry` (a time-boxed grant from another coach), `teammanager`,
`transportcoordinator`, `facilities`, `official`, `media`, `scout`.

`scout` and `analyst` are both present and both flagged in `roles.mjs` as
retained-for-a-screen rather than designed-for — the spec defers `scout`
entirely, which is the better position and worth acting on.

---

## §12 hard rules, checked

| # | Rule | State |
|---|---|---|
| 1 | Role alone is never sufficient | **Enforced** — `app_can()` takes capability and scope together |
| 2 | Every minor has a verified guardian link | **Not enforced** — see G1 |
| 3 | A guardian sees only their linked children | **Enforced and live-verified** |
| 4 | Coaching roles never see clinical notes | **Superseded by instruction** — see M1 |
| 5 | Scoring append-only, no hard delete | **Enforced** — no DELETE policy anywhere |
| 6 | Aggregates are derived | **Enforced** — every aggregate is a view |
| 7 | Public-tier roles never receive contact information | **Enforced** — spectator reaches no player row |
| 8 | Every Restricted read is logged | **Enforced as of this commit** |
| 9 | Role assignments end-dated, never erased | **Enforced** — `valid_until`, `active` |
| 10 | Cross-school denied by default | **Enforced and live-verified** |
| 11 | No role is self-assignable | **Partial** — writing `role_assignment` needs `user.role.assign`, which no self-service path grants; there is no nomination-and-approval workflow |
| 12 | Nav visibility is courtesy | **Enforced** — nav derives from capabilities and decides nothing |

---

## What is now the shortest path to a pilot with real learner data

1. **`guardian_links` verification and consent** (G1). The one blocking item.
2. **Amendment approval** (W1) — a void records who corrected, not who approved.
3. **Retire the `profiles` alias** (N1). Cosmetic, cheap.
4. **§14.2 — scorer offline authority.** Already answered in part: a revoked
   scorer's queued events are quarantined on reconnection rather than merged,
   with the epoch as the discriminator. Worth confirming that is the intended
   answer, because it is implemented and live-verified.
