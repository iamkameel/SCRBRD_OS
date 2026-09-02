# ADR 0001 — Authorization is capability + scoped assignment

**Status:** accepted, implemented
**Date:** 2 September 2026

## Decision

A person's authority is a set of **assignments**. Each assignment names a
**role**, which is a bundle of **capabilities**, and a **scope** — institution,
team, season, fixture, or a guardian's named children.

A request is allowed if **one single assignment** both grants the capability and
covers the resource. Capabilities are never unioned across assignments.

```
authorize({ assignments, capability, resource })
  → for each active assignment:
      role grants capability?  AND  assignment scope covers resource?
      → ALLOW, naming the granting assignment
  → DENY
```

Default deny throughout.

## What this replaces

The previous model was `POLICY[role] = { can, scope, only, deny }`: one global
role per person, with `scope` as a *category* (`"team"`) rather than an
*anchor* (which team). The anchor was fabricated per role by
`principalForRole()`.

Three things were wrong with it, in increasing order of severity:

1. **One role per person.** A person who coaches one side, parents a child in
   another and scores a third had to be modelled as whichever role the session
   happened to carry.
2. **Scope without an anchor.** `scope: "team"` cannot answer *which* team, so
   row filtering had to be re-derived at each call site — the classic place for
   an inconsistency to hide.
3. **One school per session.** `app_school_id()` is singular. **A guardian with
   children at two client schools was not merely insecure, it was
   unrepresentable.** Since cross-school siblings are a stated requirement, this
   was a present defect, not a future one.

## Why never union permissions

This is the rule the whole model exists to enforce, so it is worth stating
concretely.

Sarah is Director of Sport at Hilton, coaches Hilton U16A, and is the guardian
of a child in Hilton U14B. A union of her permissions gives her
`player.performance.write` — held through the coaching assignment — and applies
it to every resource she can reach, including her child's team, where she holds
no coaching authority at all.

Evaluating capability and scope on the same assignment denies that, and the
test suite pins it.

The corollary is that **which assignment granted a request is part of the
answer**, not an implementation detail. `authorize()` returns it. It drives the
"why am I seeing this?" affordance, and it is what an aggregate must be scoped
by.

## Aggregates

Counts, charts, search, autocomplete, badges, exports and activity feeds leak
exactly as easily as row reads. "Injured players: 3" computed over a school and
shown to a team-scoped coach has already disclosed, though no row was rendered.

A rule saying "remember to scope your counts" will not survive nineteen modules
and three more sports. So the question is inverted:

```
scopeFilter({ assignments, capability })
  → { unrestricted } | { scopes: [...] }   ← build the query FROM this
```

You do not ask whether a row may be read; you ask what you are permitted to
read *over*, and construct the query from the answer. Unscoped queries become
unwriteable rather than merely forbidden.

`covers()` supports this: a resource that does not state its school is **not**
matched by a school-scoped assignment. A query that forgot its scope fails
closed instead of matching everything.

## Sensitive splits

Where a domain has a safe summary and a confidential detail, they are separate
capabilities:

| Summary | Detail |
|---|---|
| `medical.status.read` — available / unavailable | `medical.details.read` — diagnosis, clinical notes |
| `player.profile.read` — sporting profile | `player.pii.read` — date of birth, guardian, address |

A coach holds the first of each and not the second. Operating the platform is
likewise not a licence to browse a school's records: `platformadmin` has no
`medical.details.read` and no `discipline.read`; support access goes through
`platform.support.impersonate`, which is time-boxed and audited.

## Status

**Implemented, and enforced on both surfaces.**

| Layer | Where | Proof |
|---|---|---|
| Model | `packages/policy/{capabilities,roles,authorize,tables}.mjs` | 49 assertions |
| Client choke point | `apps/web/src/rbac/index.js` | 45 assertions |
| Generated SQL | `services/api/rls/generate-rls.mjs` → `db/02` | 86 assertions |
| Postgres, live | `db/99_rls_verify.sql` | negative-controlled |
| The running app | `tools/smoke.mjs` | signs in, renders 13 destinations, switches 5 roles |

The old `policy.mjs` is deleted. There is one definition, and the client and
the database are both generated from it.

### Behaviour that changed

Two consequences are visible rather than internal, and both are intended:

- **`superadmin` sees less than it used to.** Under the old model it read
  everything. It now maps to `platformadmin`, which has no
  `medical.details.read` and no `discipline.read`: operating the platform is
  not a licence to browse a school's confidential records. Support access is
  `platform.support.impersonate` — time-boxed and audited.
- **A coach sees availability, not diagnosis**, on every surface at once,
  because masking is now decided per row by capability rather than once per
  role for the whole query.

### Two roles added back

`analyst` and `spectator` were in neither the September 2026 architecture note
nor its notification annex, but the product has a screen for each — the
Analytics module and the public match centre. Dropping them would leave those
two views with no role able to open them. Added with deliberately thin bundles
(`spectator` cannot read a player record at all) and flagged here rather than
resolved silently.

## Decided: RLS under an assignment set

Postgres RLS reads session settings. `app_role()` works because it is one
value; an assignment *set* does not fit that shape. Two options:

1. **Materialise assignments into the session** as a JSON array set by
   `withPrincipal()`. Fast per row, but every query carries the set, it grows
   with multi-role staff, and a revoked assignment stays live until the next
   login.
2. **Look them up inside a `SECURITY DEFINER` function** keyed on
   `app.user_id`. Keeps the session thin and makes revocation take effect
   immediately, at the cost of a lookup per policy evaluation (cacheable within
   a transaction).

**Chosen: (2), and implemented.** `app_can()` is a `STABLE SECURITY DEFINER`
lookup, evaluated once per statement per argument set. Revocation latency on a
platform holding minors' data is a safeguarding property, not a performance
one, and `db/99_rls_verify.sql` asserts it directly: deactivating an assignment
mid-transaction removes access on the very next statement.

Measure the lookup before optimising it away. If it ever needs to be faster,
the first move is a per-transaction cache, not moving assignments into the
session.

## Migration — complete

1. ✅ `role_assignment` + `guardian_child` in the core schema.
2. ✅ `getData()` onto `authorize()` / `scopeFilter()`. The 19 views kept their
   call signatures and did not change.
3. ✅ RLS regenerated from capabilities.
4. ✅ Direct-import bypasses closed. **Twenty modules** imported the mock
   constants directly (handover §8.1 item 3) — every list, count and search
   result was computed over the whole dataset regardless of who was looking.
   `data/mock.js` now has one importer, and a test fails the build if that
   changes.
5. ✅ `policy.mjs` deleted.

### A third scope state was needed

Closing the bypasses surfaced a gap in `covers()`. A resource can say three
different things about its team, and the first version conflated two of them:

| | meaning | effect |
|---|---|---|
| `"U16A"` | belongs to that team | matches a U16A assignment |
| `null` | dimension ABSENT, and that should narrow | a team coach gets no staff directory — and a query that forgot its anchor fails closed |
| `ANY_SCOPE` | dimension does not APPLY | a ground belongs to the school, not a team, so a team coach reads it |

Without the third state a team-scoped coach could not read a ground, a
competition or a notice, because those carry no team. `ANY_SCOPE` must be set
deliberately by the resource descriptor — it is never inferred, so a forgotten
anchor still fails closed. It applies to `team`, `fixture` and `person`; the
tenant boundary (`school`) has no such escape.

## Consequence for the "17 roles" claim

The role list here is **not** the previous one. It adds Match Official, Media,
Scout, Transport Coordinator, Sports Administrator, Director of Sport and
Facilities; it drops `platformsupport`, `analyst` and `spectator`. Both lists
happen to be 17 long, which makes the coincidence more misleading, not less.

Any external claim about role count must be re-verified against
`ROLE_CAPABILITIES` before it is published.
