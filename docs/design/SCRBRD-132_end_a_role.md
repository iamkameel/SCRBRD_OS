# SCRBRD-132 C1 — Ending a role

Built 2026-10-01 (Opus). Migration `db/77_role_assignment_end.sql`; route
`POST /api/assignments/:id/end { reason }`; component `EndRoleButton` in
`apps/web/src/views/endrole.jsx`; proofs in `db/99` §56 and
`tools/smoke-end-role.mjs`.

## The problem

A role could be added from a screen (`POST /api/users` → `enrol_person()` →
`decide_role_request()`, db/08) and could only be ended by SQL. db/01 already
had the shape — `role_assignment_revoke` lets `user.role.assign` set `active`
false, and `role_assignment_revoke_only()` stamps `revoked_by`/`revoked_at` —
but nothing called it, and nothing asked whether the person ending a role could
have granted it.

## What ends, and how

- **One assignment, withdrawn, never deleted.** `active` goes false; db/01's
  trigger stamps who and when. No new column on `role_assignment`: the
  withdrawal columns fit. `valid_until` is left alone (db/34 keeps a duty's
  authority in the duty's shape, and every liveness test begins `a.active`).
- **The reason** (at least ten characters, as support access asks) goes on a new
  audit row, `role_assignment_ending` — one per ended assignment, in db/34's
  `duty_suspension` pattern: written only by the function, SELECT-only to the
  app, readable by `user.role.assign` over the assignment's scope or
  `audit.read` at its school, and **not by the person**. The office tells them;
  it is on the record if they ask.
- **The notice** goes to the person, kind `system` (SG-9 allows a private notice
  to a pupil only as the system's own): role, side, school, date. Never the
  reason. A new permissive SELECT policy, `notification_role_ended`, lets them
  read it even when the ended role was their last one there, admitted only
  through `role_end_notice_is_mine()`, which asks the audit row, so a notice
  someone publishes cannot use that door. The RESTRICTIVE cuts on
  `notification` still apply over it.
- **Live links end with it.** Every live link the assignment names (pending or
  verified, not yet ended) is marked `revoked` and dated today, as
  `guardian_link_revoke()` does. Several readers ask whether a link is live
  without asking whether its assignment is (`player_guardian_link_counts()`
  behind `player_guardian_status`, the consent functions); left alone, they
  would go on counting a parent whose role had ended.

## Who may end a role

Whoever may grant it at that school. That means the two questions every
grant asks, asked the same way:
`app_can('user.role.assign', school, '*', ANY, ANY) AND app_may_grant_at(role, school)`.
The platform is already in that set. A platform-wide assignment can only be
ended from another platform-wide assignment.

**Grant authority is now asked at one school.** db/01's `app_may_grant(role)`
answered the role question across all of the caller's assignments, at every
school. So someone who was a schooladmin at Hilton and a principal at
Westville could appoint (and so end) a `medical` role at Hilton: the scope
came from Hilton's office and the role from Westville's principal. db/77 adds
`app_may_grant_at(role, school)`. The assignment that lists the role in
`role_grantable` must itself be at that school, or the platform's, and live
by the usual rule.

Every caller moves to it: the `role_assignment_write` and `role_request_read`
policies; `decide_role_request()` and `enrol_person()`; `duty_link()` and
`duty_lift()`; `dso_appointment_guard()`; `role_assignment_end()`; and the
read API's `decidable`. The functions are re-emitted from the bodies in
place with the one call replaced, md5-guarded. db/01's `app_may_grant(text)`
stays defined and frozen. db/77's check asserts that no function or policy
calls it.

**Who may not, whatever they hold** (each answers with its own code and the
route's words):

| code | rule |
|---|---|
| `owners_key` | The platform-wide superadmin assignment (db/18's and db/99's test) is not ended here by anybody, itself included. |
| `superadmin_only` | Only a superadmin may end any assignment held by somebody who holds a live superadmin assignment. |
| `last_admin` | Nobody may end their own assignment that carries `user.role.assign` when they have no other live, permanent one over the same school. A support hour does not count. |
| `own_dso` | Nobody may end their own DSO appointment. |
| `support_session` | A support hour is ended by `support_access_end()`, which closes its record. |
| `last_verified_link` | The last verified guardian of a child under 18 stays (see below). |
| `dso_blocked` | db/57's `dso_appointment_guard()` refused the update (its own generic words). |

## Decisions

**Guardian roles do not get round the guardian link's rules.** Ending a
`guardian` assignment applies `guardian_link_revoke()`'s two rules. The caller
must also hold `guardian.link.manage` at the school, and the last verified link
of a minor is not ended: the new guardian is linked first. So a platform
administrator, who may grant `guardian` but does not hold
`guardian.link.manage`, is refused and has to ask the school. The owner's key
holds it. The ended parent's links are revoked with the role.

**DSO.** db/57's trigger already limits who may end a DSO appointment (whoever
may appoint one, or the DSO above) and refuses while an open leadership or DSO
concern names the person ending it, or names nobody. This adds one rule: nobody
may end their own DSO appointment. A DSO who steps down asks the principal or
the provincial DSO, so that ending is someone else's act on the record. That
matters only for a principal who is also the DSO, since a DSO alone cannot
grant `dso` and is refused anyway. The phase 5 notice period (design §10 Q1)
is still to come; until then the trigger's generic words stand.

## For Kameel

1. **The reason is kept from the person.** They are told that the role ended,
   not why. POPIA may entitle them to the reason on request. It is on the
   record for the office to produce.
2. **A platform-wide role held by someone with no school of their own** gets no
   notice, because `notification` needs a school. The audit row is still
   written.
3. **Ending `player` leaves `selfaccess`.** A pupil's two assignments are ended
   one at a time, by design.
