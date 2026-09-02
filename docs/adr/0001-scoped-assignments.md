# ADR 0001 — Authorization is capability + scoped assignment

**Status:** accepted, partially implemented
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

## Status — what is and is not done

**Implemented and tested** (49 assertions, `packages/policy/test/`):
`capabilities.mjs`, `roles.mjs`, `authorize.mjs`.

**Not yet migrated. The old model is still live:**

- `packages/policy/src/policy.mjs` still holds the role→scope POLICY map, and
  `db/02_rls_policies.sql` is still generated from it.
- The web client's `rbac/index.js` still calls the old `can()` / `getData()`.
- The database session still carries `app_role()` and `app_school_id()`,
  singular.

Until those three move, **the new model decides nothing in production.** It is
the target, not the current behaviour.

## The open question: RLS under an assignment set

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

**Recommendation: (2).** Revocation latency on a platform holding minors' data
is a safeguarding property, not a performance one. Measure the lookup before
optimising it away.

## Migration order

1. Add `role_assignment` to the core schema; backfill one row per existing user
   from their current single role.
2. Move `getData()` onto `authorize()` / `scopeFilter()`, keeping the resource
   names the 19 views already use. Views do not change.
3. Regenerate RLS from capabilities, per the decision above.
4. Close the direct-import bypasses (handover §8.1 item 3) — a view reading
   `PLAYERS` directly is outside the choke point and outside this model.
5. Retire `policy.mjs`.

## Consequence for the "17 roles" claim

The role list here is **not** the previous one. It adds Match Official, Media,
Scout, Transport Coordinator, Sports Administrator, Director of Sport and
Facilities; it drops `platformsupport`, `analyst` and `spectator`. Both lists
happen to be 17 long, which makes the coincidence more misleading, not less.

Any external claim about role count must be re-verified against
`ROLE_CAPABILITIES` before it is published.
