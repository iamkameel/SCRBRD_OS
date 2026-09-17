# ADR 0002 — A coach holds a medical overview, not the clinical record

**Status:** decided
**Date:** 17 September 2026
**Decision owner:** the school (via the product owner)

## Background

ADR 0001 described the medical tiers as a strict ladder — status, then nature,
then details — and said in two places that a coach stops at the first: "A
coach holds the first of each and not the second" and "a coach sees
availability, not diagnosis." The code disagreed with its own ADR. `coach`
and `assistantcoach` had held `medical.details.read` — the tier that unmasks
`injury.notes` and `injury.physio`, the physio's clinical write-up — since
before ADR 0001 was written, on an explicit instruction: a school coach is
the person managing a child's load week to week, and making him phone the
physio to find out whether a shoulder may bowl was judged a worse outcome
than him reading it directly.

The Pass 1 security audit (SEC-P2-04) flagged the contradiction rather than
resolve it — this is a policy decision for the school, not a code review
finding — and logged it as SCRBRD-013.

## Decision

**A coach gets an overview, not the full record.**

He needs to know what a player's injury is and roughly how long the boy is
expected to be out. He does not need, and does not get, the physio's own
notes or who is treating the boy.

Concretely, `coach` and `assistantcoach` hold:

| Tier | Capability | Columns | Kept? |
|---|---|---|---|
| Status | `medical.status.read` | `rtw_date`, `restricted` | ✅ (unchanged) |
| Nature | `medical.nature.read` | `injury_type`, `severity`, `phase` | ✅ (unchanged) |
| Details | `medical.details.read` | `notes`, `physio` | ❌ **removed** |

This reverses the instruction ADR 0001 recorded incompletely: `coach` and
`assistantcoach` no longer hold `medical.details.read`. Every other role that
held it — `medical`, `guardian`, `selfaccess`, `superadmin` — is unaffected.
`teammanager`, which never held the details tier, is likewise unaffected.

## Why nature and not just status

`medical.status.read` alone (available / unavailable, and when) is what a
selector strictly needs to pick a side. It is not what a coach needs to
*manage* one: deciding whether a bowler comes back into the attack this
month, or whether the training load has to change, needs to know it is a
hamstring rather than a finger, and how severe. That is exactly the nature
tier, and it is unchanged by this decision — it was already granted and
stays granted.

## Why not the details tier

The details tier is the physio's own clinical writing about a named child,
plus who is treating him. It is not what "manage a bowling load" requires,
and holding it made a coach's phone the wider net for a document intended to
stay in a clinical file. The line the product now draws is the same one the
availability/nature split already draws one tier up: a summary a coach acts
on, and a clinical document that stays with the person who wrote it.

## What stays the same

- **Scope, not tier, is still the safety property for the nature tier a
  coach keeps.** A coach assignment must name a team, and the injury policy
  anchors on the player's *current* side — this is unchanged. A coach still
  reaches only the children he actually coaches, this term.
- **`selfaccess` and `guardian` are untouched.** A boy's own family, and the
  boy through self-access, still reach the full record for him specifically
  — that is a different question (whose record is this?) from the one this
  ADR answers (what does a coach who is not the family see?).
- **`medical` (the physio's own role) is untouched.**

## Consequence for ADR 0001

ADR 0001's "Sensitive splits" table row —
`medical.status.read` (summary) / `medical.details.read` (detail), "A coach
holds the first of each and not the second" — was **wrong when it was
written** (the code granted both) and is **accurate now**. No text change to
ADR 0001 is needed; this decision is what makes that sentence true rather
than aspirational. Its other claim, "a coach sees availability, not
diagnosis," conflated the nature and details tiers; read charitably it meant
"not the clinical write-up," which is now precisely what holds.

## What changed

- `packages/policy/src/roles.mjs` — `medical.details.read` removed from
  `coach` and `assistantcoach`. This is the live model: `authorize()`,
  `scopeFilter()`, the client's rbac choke point, and every test read it
  directly, and the narrowing is immediate there.
- `db/21_coach_medical_overview.sql` (new) — the actual withdrawal, as its
  own file. `db/01_authz.sql` already ran on a database that must not be
  reset — its ledger hash is fixed the moment it is applied, the same rule
  that has kept `db/00`–`db/14` frozen since go-live — so this could not be
  made by editing `role_capability`'s seed rows in place and regenerating.
  It is the same shape as `db/10` correcting data `db/08` got wrong without
  rewriting `db/08`.
- `services/api/rls/generate-rls.mjs` — gained `WITHDRAWN_SINCE_01`, so
  regenerating `db/01_authz.sql` from the now-narrower `ROLE_CAPABILITIES`
  keeps reproducing the two rows at the exact position they already shipped
  in, rather than silently rewriting an already-applied file the next time
  anyone runs `pnpm rls:generate`. `db/01_authz.sql` and `db/09_rls_policies.sql`
  are therefore byte-identical to before this change; only `db/21` is new.
- `packages/policy/test/authorize.test.mjs`, `db/99_rls_verify.sql`,
  `tools/smoke-read.mjs` — the assertions that a coach reads
  `injury.notes`/`injury.physio` for their own squad now assert the
  opposite; the assertions that a coach reads `injury_type`/`severity`
  (nature tier) are unchanged.

## Status

**Implemented.** A fresh install applies `db/01_authz.sql` (granting the old
bundle, exactly as shipped) and then `db/21_coach_medical_overview.sql`
(withdrawing the one capability) in sequence — replaying, rather than
rewriting, what a database that was already live goes through. Production
needs `db/21` applied via the usual `bundle-sql.mjs --apply 21` paste; it
does not touch `db/01_authz.sql`'s already-recorded ledger row at all.
