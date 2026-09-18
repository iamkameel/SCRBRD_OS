# ADR 0003 — A job title is not a role

**Status:** accepted
**Date:** 18 September 2026

## Decision

A job title becomes an RBAC role **only if it needs different data access or
different approval authority** from every role that already exists. Nothing
else qualifies — not seniority, not a different job description, not a
different title on the staff list, and not "the school calls them that".

A title that fails both tests belongs in one of three other places:

1. **A scope on an existing assignment.** An age-group coordinator is a coach
   or a team manager scoped to several teams. `role_assignment` already carries
   `school_id`, `team_code`, `season` and `fixture_id`; a title that only
   answers *where* is a scope, not a role.
2. **A record of its own.** Captaincy is already an `honour` row
   (`db/08`: `kind IN (…, 'captain', 'vice_captain', …)`) with a season, a
   citation, an awarding user and a withdrawal reason. It is a fact about a
   boy in a season, it appears on his passport, and it grants him nothing. That
   is the right shape, and it was the right shape before this ADR existed.
3. **A specialism carried beside the role.** A bowling coach is
   `coach` + a specialism. What the specialism changes is what the app *shows
   him first*, not what he may read.

## The two tests, stated precisely

**Different data access.** Is there a capability this title must hold that no
existing role holds, or one it must be denied that every candidate role holds?
`medical` is a role for exactly this reason: it holds `medical.details.read`,
and no other operational role does or should (ADR 0002). That is a role.

**Different approval authority.** Does this title decide something, or approve
something another role requested? `scoring.amend.approve` exists separately
from `scoring.correct` because an approval one person can give themselves is
not an approval. A title that is the second signature on something is a role.

If neither is true, the title is a label, and labels do not need a row in the
permission matrix.

## Why the bar is this high

Every role is priced in four places, and only the first is cheap:

- `ROLE_CAPABILITIES` in `packages/policy/src/roles.mjs` — a line;
- the RLS matrix, because every policy that names roles now has one more case;
- `db/99_rls_verify.sql`, which asserts the live behaviour of that matrix;
- **and a production paste.** A capability change after go-live is `roles.mjs`
  plus a new `db/NN` plus a `WITHDRAWN_SINCE_01` entry in the generator plus a
  paste into Supabase (`docs/ARCHITECTURE.md` §9). There is no version of
  adding a role that is a code change only.

There are 25 roles, and taking something back costs more than granting it.
Withdrawing a single *capability* after go-live has its own machinery —
`WITHDRAWN_SINCE_01` in the RLS generator, so `db/01` stays exactly as shipped
while the live behaviour changes, with `db/21` as the worked example of
`medical.details.read` leaving `coach` and `assistantcoach`. That mechanism
exists because the alternative was editing a migration that had already run.

A whole role is that, several times over. So the asymmetry is the point: the
cost of one unnecessary role is paid at every later reading of the matrix, by
whoever next has to answer "who can see this?" against a wider table.

## The titles this rule is about

These recur, and none of them passes either test. They are recorded here so
the argument does not have to be had again:

captain · vice-captain · batting coach · bowling coach · fielding coach ·
wicketkeeping coach · assistant scorer · first-aid volunteer · tour organiser ·
social-media editor · statistician · teacher-in-charge · house master ·
age-group coordinator

Each one is a real job that a real person does. That is not in dispute. The
claim is narrower: none of them needs to see data another role cannot see, or
to approve something another role cannot approve, so none of them needs a row
in the permission matrix to be represented properly.

Two have a wrinkle worth naming. An **assistant scorer** who is actually
scoring is a `scorer` — the title is about who is senior, and the app has no
opinion about that. A **first-aid volunteer** at a fixture may genuinely need
an emergency contact, which is `player.emergency.read` and therefore a real
data-access question; that is a fixture-scoped assignment of an existing role,
and if it turns out no existing role fits, it passes test one and is a role.

## What this does not say

It does not say the roster is closed. `medical`, `finance`,
`transportcoordinator` and `facilities` all exist because they hold
capabilities nothing else should — different data access, test one, passed. Any future title that
passes a test is a role, and this ADR is the argument *for* it rather than
against it.

It also does not say a title is unimportant because it is not a role. A
specialism on a coach, a captaincy honour and a scoped assignment are all
first-class records. The question this ADR settles is only which of the four
shapes a title takes.

## Where it is enforced

Nowhere automatically, and that is honest: no test can tell whether a new role
was justified. What `packages/policy/test/separation.test.mjs` does is make the
*consequence* visible — a role added without thought shows up there as a
crossing it did not intend, because its capability set has to be written down
next to everyone else's.

The enforcement is review, and this document is what review points at.

## Where this came from

The rule is lifted from §15 of `Roles&Duty.md` in the `scrbrd-beta-2`
prototype, which argues it well and then breaks it: the same repository ships
a `CaptainCockpitView` and a `CaptainTacticalCockpit` while its own governance
document says captain is an attribute. That is the failure mode in one
repository — the principle is easy to write and hard to hold, because a cockpit
for captains is a good idea and "so let captain be a role" is one short step
away.

It is not. A cockpit scoped by a captaincy honour is the same screen with none
of the cost.
