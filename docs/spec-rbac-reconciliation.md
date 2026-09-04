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
| 3 | `guardian_links` + constraints | **Done** — see G1 |
| 4 | `role_assignments`; retire `users.role` | **Done** |
| 5 | Workflow state; `amendments` | **Partial** — see W1 |
| 6 | `access_log`; write from the choke point | **Done** — see A1 |
| 7 | Split namespace; retire `profiles` | **Partial** — see N1 |
| 8 | Split `biometric` from `pii` | **Done** — see F1 |
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

### G1 — guardian links are a verified relationship, with a lifecycle

**Built.** The lifecycle lives on `assignment_subject`, which already carried
the relationship, rather than in a new `guardian_links` table. A second table
would be a second answer to the only question that matters — may this person
reach this child — and a revoked link with a live subject row is not a bug
anybody notices; it is a parent who still reads a record after the school
revoked the relationship.

`relationship`, `verification_state`, `verified_by`, `verified_at`,
`verified_note`, `consent_state`, `consent_version`, `consent_at`,
`valid_from`, `valid_until`, `created_by`. The key is widened by a surrogate
id and a partial unique index keeps one OPEN link per person per child, so a
revoked link is kept and a re-established one is a new row.

**The two states do different jobs**, and conflating them was the trap:

| | governs | withdrawing it |
|---|---|---|
| verification | **access** — `app_can()` counts only verified, unended links | reaches nothing |
| consent | **processing** — whether the child may be acted on | does *not* blind the parent; unregisters the child |

`pending` is the column default, so an import, a half-written registration, or
a workflow that forgets to finish grants nothing.

**Two asymmetries in `app_can()` are load-bearing**, and both are falsified in
`tools/smoke-guardian.mjs`:

- The half that asks "does this assignment name anybody" counts **every** link,
  live or not. Filtering it to live links would mean that revoking a guardian's
  last link turns their assignment into a school-wide one — revocation would
  **widen** access.
- The half that asks "is this row about one of them" counts **only live** links.
  Without it, a parent of two children keeps reading the child whose link was
  ended, because the other child satisfies the first half.

**A subject-scoped role that names nobody is now refused outright.** `guardian`,
`selfaccess` and `enquiry` only mean anything about a person; an assignment in
one of them with no live subject reaches nothing at all — not the school, not
a fixture. That hole had been open for as long as `assignment_subject` had
existed: a guardian row with no subject rows was "about nobody in particular",
which is to say school-wide.

**§6.3's three constraints:**

1. *No learner active without a verified link* — enforced, and **derived rather
   than stored**. There is no `player.active` flag. `player_guardian_status`
   answers `active | pending_consent | pending_verification | unlinked` from
   the links that exist right now, and a `match_squad` trigger refuses to
   select a child who is not `active`. A stored flag is a fact that eventually
   disagrees with what it was derived from — the same reasoning that keeps the
   live score, career figures, the ladder and the ageing-up notice out of
   columns. MINOR here means actual age today, not the 1 January cricket
   cut-off: the cut-off decides which side a boy plays for and has nothing to
   do with whether the law treats him as a child.
2. *The last verified link cannot be revoked* — enforced in
   `guardian_link_revoke()`, for minors. Link the new guardian first.
3. *Who may establish a link* — the design question that held this back, and
   the answer turned out not to interact with the access-request workflow at
   all. Establishing a guardian link needs `guardian.link.manage` **at the
   child's school**; the `enquiry` grant needs `player.access.grant` over the
   child's **current side**. They are different authorities over different
   relationships, and the only thing they share is the table. What they do
   share is written down: `access_request_decide()` now marks its link verified
   *by the coach who decided*, because a pending link would have granted the
   requesting coach nothing — the grant would silently have been no grant.

**Nobody creates or verifies a link that gives themselves access**, which is
§12.11 applied to the one relationship where self-assignment would be most
useful and least visible. **A coach cannot be linked to a child in a side they
coach** — refused whoever asks, including the office — because that converts a
scoped, term-limited, revocable coaching relationship into a standing personal
one over the child's whole record.

**All four acts are functions.** `assignment_subject` has no INSERT, UPDATE or
DELETE policy: the application role cannot write a link at all, and each
`SECURITY DEFINER` function checks its own authority rather than inheriting one.

**What this cost the fixture, and why that is the finding.** The seed had no
registrar — a demonstration school with coaches, a physiotherapist, parents and
a head of sport, but nobody who could admit a pupil. And a side that used to
need five player rows now needs five families. Both are what a school actually
has to have before it can field a team.

**One departure worth naming.** Capture and verification are separate acts and
deserve separate holders, but they are behind a single capability. *Who*
verifies is a school's own governance and not something this model should
invent; the states are separate, the calls are separate, and `verified_by`
names a person, so splitting the capability later changes a grant and nothing
else.

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
| 2 | Every minor has a verified guardian link | **Enforced** — see G1 |
| 3 | A guardian sees only their linked children | **Enforced and live-verified** |
| 4 | Coaching roles never see clinical notes | **Superseded by instruction** — see M1 |
| 5 | Scoring append-only, no hard delete | **Enforced** — no DELETE policy anywhere |
| 6 | Aggregates are derived | **Enforced** — every aggregate is a view |
| 7 | Public-tier roles never receive contact information | **Enforced** — spectator reaches no player row |
| 8 | Every Restricted read is logged | **Enforced** — see A1 |
| 9 | Role assignments end-dated, never erased | **Enforced** — `valid_until`, `active` |
| 10 | Cross-school denied by default | **Enforced and live-verified** |
| 11 | No role is self-assignable | **Partial** — writing `role_assignment` needs `user.role.assign`, which no self-service path grants; there is no nomination-and-approval workflow |
| 12 | Nav visibility is courtesy | **Enforced** — nav derives from capabilities and decides nothing |

---

## What is now the shortest path to a pilot with real learner data

1. ~~`guardian_links` verification and consent (G1)~~ — **done**.
2. **Amendment approval** (W1) — a void records who corrected, not who approved.
3. **Retire the `profiles` alias** (N1). Cosmetic, cheap.
4. **§14.2 — scorer offline authority.** Already answered in part: a revoked
   scorer's queued events are quarantined on reconnection rather than merged,
   with the epoch as the discriminator. Worth confirming that is the intended
   answer, because it is implemented and live-verified.
