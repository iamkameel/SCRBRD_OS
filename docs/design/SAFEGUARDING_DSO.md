# Safeguarding — the Designated Safeguarding Officer and the concern record: the design

Status: **design, for Kameel's review** (2026-09-27). Nothing here is built. It follows
`docs/policy/CSA_SAFEGUARDING_CHECK.md` (the check), whose §5 questions are all decided
as recommended, and it designs what those decisions need: the DSO role, raising a
concern, the concern record, suspension, the six conflicts' fixes and the smaller
additions. Opus builds from it in the phases of §9. Page numbers are CSA's own
(*Safeguarding Policy: Against Harassment and Abuse in Cricket*, 2025); quotes are short.

Two words, to keep the check's usage: **The Guardian** is CSA's safeguarding partner and
its anonymous-reporting app; SCRBRD's `guardian` role is a parent. **DSO** is a school's
(or club's) Designated Safeguarding Officer; **PDSO** and **NDSO** are the provincial and
national ones.

---

## 0 · Summary

- **`dso` is a role**, tenant-scoped, holding four new capabilities nobody else holds:
  `safeguarding.concern.read`, `safeguarding.concern.manage`, `safeguarding.suspend` and
  `safeguarding.authorise`. It passes both of ADR 0003's tests. The principal appoints
  it; ending the appointment is refused while a concern naming the principal is open. A
  PDSO is a `dso` at a `union` tenant, the NDSO a `dso` at the `federation` tenant. The
  masterkey does not hold `safeguarding.*`.
- **Anyone signed in raises a concern** through one `SECURITY DEFINER` function with
  Annexure A's fields, minimised. It is routed to the tenant whose DSOs hold it: the
  school's DSOs; the union's as well when it is about an adult with authority at the
  school; the union's only when it is about a DSO. The reporter gets a reference and
  "Received — the DSO has it", and nothing more, ever.
- **The concern record is its own set of tables**, never a `disciplinary_record`. Reads
  are permitted only by `safeguarding.concern.read` at the holding tenant and cut by
  `RESTRICTIVE` policies under any support session and any platform-wide assignment.
  The reporter's identity is a separate table. Need-to-know is a recorded share with an
  expiry, opened through a function that logs. Its access-log rows are hidden from
  ordinary `audit.read` holders by a `RESTRICTIVE` policy on `access_log`.
- **Suspension** is a row per person per tenant, set and lifted by a DSO, read by the
  three decision functions as one more liveness condition (the `duty_suspension`
  pattern of db/34–35). Everyone else sees "suspended by the DSO".
- **The six conflicts** each get a small change: a pupil's own media assent from 12 (K1),
  a DSO stream authorisation the overlay cannot publish without (K2),
  `medical.status.read` withdrawn from `player` (K3), the Sexual Offences Register and
  24-month maxima in the clearance register (K4), a DSO-signed emergency-contact role
  list (K5), and `trip.cleared_by` with warn-now-refuse-later (K6).
- **Five phases**, each one migration and one `db/99` section, in the order: the role and
  the record; suspension and the DSO register; clearances; media; provincial referral
  and trips. Go-live needs the information officer's answers on three points (§9.7).

---

## 1 · Principles — what never happens with a concern

1. **It never lands in the disciplinary record.** `discipline.read` reaches
   `competitionadmin` across every school and `discipline.write` a one-fixture umpire
   (db/25 header). A concern is not a disciplinary matter until a DSO makes it one, and
   then the disciplinary record carries the outcome, not the concern.
2. **Nobody but a DSO reads it by standing.** Not the coach, not the parent, not the
   office, not the principal, not the director of sport, not the person it is about.
   Every other reader is a named person, for named parts, until a date, by a DSO's
   recorded act (p52 item 5, p63).
3. **The audit log does not say a concern exists.** Its access-log rows are visible only
   to holders of `safeguarding.concern.read` at that tenant. The notice that tells a DSO
   carries no name. The push is a pointer.
4. **No masterkey read, no support read.** `superadmin` is defined without
   `safeguarding.*`; every safeguarding table carries a `RESTRICTIVE` policy that is false
   under a support session and under a platform-wide assignment. When access is ever
   needed from outside the school, the route is the PDSO or NDSO, who are people with
   assignments, not the operator.
5. **The reporter is not in the concern row.** Their identity is a separate table read
   only by DSOs at the holding tenant, never copied into a share, a referral, a note or
   a notice (p63).
6. **Upward goes only what p27 allows.** A referral carries gender, an age band, the
   nature and where. No name, no reporter, no account.
7. **A concern cannot be edited into a different concern.** The account is written once
   by the reporter; everything after is an appended note with an author and a time.
8. **Deletion is a logged act with a date it may not precede.** CSA's periods are the
   floor (p64). What is kept after a purge names nobody.
9. **A signed-in report is not anonymous, and the screen says so.** Anonymous reporting
   is The Guardian's app, linked beside the DSO card.

---

## 2 · The DSO role

### 2.1 A role, not a capability set on an existing role

ADR 0003's two tests, applied:

- **Different data access.** No existing role may read a concern. Adding
  `safeguarding.concern.read` to `principal` would put the record in front of the person
  a concern may be about, and in front of the one appointment the office cannot
  countermand. Every existing role fails this test in the same way: each is already
  somebody's boss, colleague or parent.
- **Different approval authority.** The DSO signs things nobody else signs: the stream
  authorisation (p73), the trip clearance (p45), the emergency-contact decision (p52
  item 8), the suspension (p42). `safeguarding.authorise` is the second signature ADR
  0003 describes.

So it is a role, `dso`, with its own row in `ROLE_CAPABILITIES` and a line in
`ROLES_ADDED_SINCE_01` (the `sponsorship` precedent, `services/api/rls/generate-rls.mjs`
430). Scoped by `school_id` like any tenant role; the tenant may be a school, a club, an
academy, a union or the federation (`school.kind`, db/00 32–34). A `dso` assignment with
`school_id NULL` is refused by a trigger: there is no platform-wide DSO, and the recovery
path (`platformadmin` may grant any role) must not be able to mint one.

**Several DSOs per tenant** are allowed and expected (p15's instinct; p37's same-sex DSO).
All DSOs at a tenant read all of that tenant's concerns — p63 says "the club's DSOs",
plural — with an `assigned_to` for who is working it. The form lets a child pick which
DSO to raise it with; that sets `assigned_to`, not readership.

**A tour DSO** (p45) is a `dso` assignment scoped to a fixture or a season
(`role_assignment.fixture_id` / `season`): it clears that trip and receives concerns
raised against that fixture. `app_can()` already refuses a fixture-scoped assignment on a
row that does not state the fixture, so a tour DSO reads nothing else.

### 2.2 The capabilities

Four new, in `capabilities.mjs` with a `LEVEL`, each in `ADDED_SINCE_01`:

| capability | level | held by | governs |
|---|---|---|---|
| `safeguarding.concern.read` | 4 | `dso` | `safeguarding_concern`, `_reporter`, `_note`, `_share` (as sharer), `_referral` (both ends), the DSO's notices; the hidden access-log rows |
| `safeguarding.concern.manage` | 4 | `dso` | `safeguarding_concern_note` (append), assign, close, share, refer, purge |
| `safeguarding.suspend` | 3 | `dso` | `safeguarding_suspension` (set, lift) |
| `safeguarding.authorise` | 1 | `dso` | `safeguarding_register` lines, `trip_clear()`, the stream authorisation, the emergency-contact role list |

Level 4 for the two concern capabilities: a concern is the one record on the platform
with no safe tier beneath it, and `SENSITIVE` picks them up automatically
(`capabilities.mjs` 514). Level 1 for `authorise`: a signature on a fixture or a trip
names no child.

The `dso` bundle also holds existing capabilities, every one at the tenant:

- `clearance.read`, `clearance.manage` — p17 a–c, checking and recording the checks;
- `audit.read` — a DSO must answer "who read this child's record" (p52, p63), and the
  access log is what answers it (db/08 505–508);
- `player.public.withhold` — the never-public mark (C5) is a safeguarding mark
  (`db/47` 61–75 gives the same reason);
- `school.read`, `user.read`, `team.read`, `fixture.read`, `news.read`, `transport.read`,
  `player.profile.read` — to name a child, a trip, an adult, a fixture.

It does **not** hold `player.pii.read`, `player.emergency.read` or `player.age.read` by
standing. The check proposed them so a DSO can reach a family; this design reaches the
family through the concern instead: `safeguarding_family(p_concern)` (§4.5) returns the
named child's verified guardians and their numbers, logged under the concern. A DSO with
no open concern about a child has no reason to hold that child's home number, and the
referral's age band is computed inside the function without the DSO reading a date of
birth. Open question **Q3**.

It does not hold `user.role.assign`, `discipline.*`, `medical.*`, `scoring.*`,
`broadcast.publish` or `player.note.read`. `separation.test.mjs` gains those as
assertions (§9).

**The masterkey.** `superadmin` becomes
`ALL_CAPABILITIES.filter((c) => !c.startsWith("safeguarding."))` (`roles.mjs` 90). This
is the one carve-out from "the owner's key holds everything", and it is deliberate: a
key that reads every concern at every school, and records nothing (`roles.mjs` 80–89),
is the reader p63 forbids. `separation.test.mjs`'s standing exception for `superadmin`
narrows to "every capability outside `safeguarding.*`", and `db/99` proves the owner's
key reads zero rows of every safeguarding table. `platformadmin` gains nothing.

### 2.3 Appointment

- **Who appoints.** `GRANTABLE_ROLES.principal` gains `dso` (`roles.mjs` 514). Not
  `schooladmin`, not `directorofsport`: the chairperson appoints (p17), and the director
  of sport is exactly the person a concern about staff may name. The union's and the
  federation's own principal-equivalent appoints theirs (a `principal` assignment at
  that tenant — the tenants already exist; whether their staff are enrolled yet is
  **Q5**). `platformadmin` keeps its recovery-path grant, and the trigger above keeps
  the assignment tenant-scoped.
- **What is recorded.** The assignment row, as any appointment (`created_by`, db/00
  467). A `safeguarding_register` line of kind `dso_appointment` is written by the
  appointing trigger with the DSO's name and date, so the register shows the school's
  DSOs since the beginning, and a notice goes to the union's DSOs: "A school in your
  province has appointed a DSO" (p17: "inform the NDSO of that appointment").
- **Clearances.** `clearance_requirement` gains rows for `dso`: the three checks, the
  SAC and `dso_training` (§7.4). The register shows a DSO as "missing" until they are
  recorded, as it does for a coach.
- **Ending an appointment.** `role_assignment_revoke` is an UPDATE under
  `user.role.assign` (db/01 956). A new `BEFORE UPDATE` trigger,
  `dso_appointment_guard()`, `SECURITY DEFINER` so it can see concern rows the revoker
  cannot, refuses to set `active = false` on a `dso` assignment when an open concern
  held at that tenant (or at its union about that tenant) has `about_kind IN
  ('leadership', 'dso')` and either `subject_person_id = app_user_id()` or
  `subject_person_id IS NULL`. The refusal's wording is the same as for any refusal on
  that screen: "This appointment cannot be ended from here. Ask the provincial DSO."
  The PDSO's `safeguarding_authority()` (§2.4) is what may end it instead.

  This leaks one bit — the principal learns that something blocks them — and the
  alternative (a notice period on every DSO removal, confirmed by the PDSO, so the
  principal never learns which case they are in) is better and costs a screen. It is
  **Q1**; the trigger ships in phase 1 either way, because the rule was decided.

### 2.4 Provincial and national DSOs

- A **PDSO** is a `dso` at the `union` tenant of the school's province; the **NDSO** is a
  `dso` at the `federation` tenant. `school_union(p_school)` returns the one `union`
  tenant whose `province` matches the school's (`school.province`, db/00 34); if there
  is none, the federation; if none of those, `NULL`. More than one union in a province
  is **Q4**.
- **They do not read schools' concerns.** RLS on `safeguarding_concern` keys on
  `tenant_id`, the tenant whose DSOs hold the record. A concern routed to the union is
  held at the union: `tenant_id` = the union, `school_id` = the school it is about.
- **`safeguarding_authority(p_capability, p_school)`** — `STABLE SECURITY DEFINER` —
  is true when the caller holds the capability at the school, at its union or at the
  federation. It is used by the *acts* a PDSO may perform on a school (end a DSO
  appointment, suspend an adult, clear a trip when the school has no DSO), never by the
  read policies, so upward authority does not become upward reading.
- **The referral** (`safeguarding_referral`, §4.6) is how a school's DSO informs the
  NDSO within 24 hours (p27) and the only thing the union or federation receives about
  an ordinary concern.

### 2.5 What everyone sees: the DSO card

Every signed-in person, on their home screen, sees their tenant's DSOs by name with the
contact line each DSO chose, the words "Raise a concern" (§3) and "Report anonymously"
(The Guardian's app, §7.1), and the school's policy links (§7.5). `dso_contacts(p_school)`
returns the live `dso` assignments' names and the `dso_contact` register line; it needs
nothing but a session. A tenant with no DSO shows "This school has not yet appointed a
DSO" and the union's DSOs instead, and the Settings screen shows the principal a red
line until one is appointed (p17: "must appoint").

### 2.6 The DSO register

`safeguarding_register` is the small dated, signed record the check calls for (SG-1):

```
safeguarding_register (
  id          uuid PK,
  school_id   uuid NOT NULL → school,
  kind        text NOT NULL CHECK (kind IN ('dso_appointment','dso_contact',
                'emergency_contact_roles','stream_authorisation','policy_links')),
  subject_id  uuid,                 -- a fixture for a stream authorisation; else NULL
  season      text,                 -- a season-long stream authorisation
  body        text NOT NULL,        -- the role list, the contact line, the links, the condition
  signed_by   uuid NOT NULL → app_user,  signed_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz, withdrawn_by uuid → app_user
)
```

Written only through `safeguarding_register_sign(p_school, p_kind, p_body, p_subject,
p_season)` and `_withdraw(p_id)`, both requiring `safeguarding.authorise` at the school
(a tour DSO may sign a stream authorisation for their fixture). Readable under
`safeguarding.authorise` or `audit.read` at the school: this register is not
confidential — it is the DSO's visible record of what they approved — and it is what
P7a reads to say "approved by the DSO on 3 February". Trip clearances are not here; they
are columns on `trip` (§6.6).

---

## 3 · Raising a concern

### 3.1 The function

`safeguarding_concern_raise(...)` is `SECURITY DEFINER`, granted to `scrbrd_app`, and
requires nothing but `app_user_id() IS NOT NULL`. It is deliberately not a capability: a
capability lives in bundles, and a bundle that forgot it would be a pupil who cannot
report (p18 a, p53). It returns `(ok, reason, reference, raised_at)`.

Arguments, and what the form asks:

| argument | the form | notes |
|---|---|---|
| `p_school` | picked from the reporter's own tenants; a guardian sees the child's school | the school it concerns; the holding tenant is decided by routing |
| `p_about_kind` | "This is about: a pupil / an adult at this school / the school's leadership / the DSO / I'm not sure" | `child`, `adult`, `leadership`, `dso`, `unknown` |
| `p_subject_player` | picked from children the reporter can already see (`player.profile.read` or a guardian link); optional | never typed; the DSO sees the record |
| `p_subject_person` | an adult picked from the school's people list, optional | `app_user.id` |
| `p_subject_text` | "or describe who" | free text, ≤ 500 |
| `p_nature` | Annexure A's list: psychological, physical, sexual harassment, sexual abuse, neglect, bullying, other | `text[]`, one or more |
| `p_certainty` | "a suspicion" / "recognised" (p68) | |
| `p_occurred_on`, `p_occurred_where` | date if known; where in words | |
| `p_account` | "What happened. Use the child's own words where you can." (p29) | ≥ 20 characters; the only long text |
| `p_how_learned` | witness / someone told me / I am the victim / other (p66) | |
| `p_authorities_told` | "Has anyone already been told? (SAPS, The Guardian, a social worker)" | optional text |
| `p_named_ok` | "The DSO may tell others that it was me who reported this" | default false (p63) |
| `p_preferred_dso` | one of the tenant's DSOs, optional | sets `assigned_to` |

Contact details are not asked: the DSO reaches the reporter through `app_user` and the
child through `safeguarding_family()`. The function:

1. refuses `p_subject_player` unless the reporter can see that child today (the
   generated `player` read policy is checked with `app_can('player.profile.read', …)` or
   a live guardian link) — so the form cannot be used to enumerate children;
2. computes the holding tenant (§3.2), writes `safeguarding_concern` and
   `safeguarding_concern_reporter`, and a first `safeguarding_concern_note` of kind
   `raised`;
3. writes one `notification` per holding tenant (§3.3);
4. calls `log_restricted_read('safeguarding_concern_raise', ARRAY[id], '{}', school)`
   so the raise itself is on the hidden log;
5. returns a reference like `SG-7K3M-2026`, the only thing the reporter keeps.

### 3.2 Routing

`safeguarding_route(p_school, p_about_kind)` returns the tenant that holds the record and
whether the union is told as well:

| about | held at | union DSOs told |
|---|---|---|
| a child, an adult without authority, unsure | the school | no |
| leadership (`principal`, `directorofsport`, `schooladmin`, `sportsadmin` at that school — read from the subject's live assignments, or the reporter's tick) | the school | **yes**: a second `notification` at the union tenant and a `safeguarding_referral` written at once (§4.6) |
| the DSO (the subject holds `dso` at the school, or the reporter ticked it) | **the union** (or the federation if none) | — (they hold it) |
| a school with no DSO | the union (or the federation) | — |

If no union or federation DSO exists either, the concern is still written, held at the
school with `tenant_id` = the school and `unheld = true`; the reporter's receipt adds
"This school has no DSO yet. Please also use The Guardian's app or phone." and the
principal's Settings line turns red. Nothing is lost and nobody unqualified reads it.

### 3.3 Telling the DSO

One `notification` row per holding tenant (db/08 220–268): `school_id` = that tenant,
`scope_level = 'school'`, `team_code NULL`, `kind = 'safeguarding'`, `urgency = 'high'`,
`required_capability = 'safeguarding.concern.read'`, `subject_kind NULL`,
`subject_person_id NULL`, title "A safeguarding concern has been raised", body "Open
SCRBRD to read it. You have 24 hours to inform the NDSO if it is child abuse." The
generated policy demands `news.read` and the row's capability in the same scope, so only
that tenant's DSOs receive it. The push through `fanOut()` is the usual pointer.
`notification.subject_kind`'s CHECK is not touched: the notice names no subject.

`notification.recipient_id` (SCRBRD-110 §3.4 plans it in its phase 2, a nullable column
with the `RESTRICTIVE` policy `recipient_id IS NULL OR recipient_id = app_user_id()`,
which `fanOut()` honours) is needed here for the share notice (§4.4) and the suspension
notice (§5). Whichever design lands first adds the column and the policy in exactly that
shape; the other finds it there. The SG-9 rule "a `recipient_id` never names a pupil
unless the notice is the system's own" is a test in this phase (§9.1).

### 3.4 The clocks the screen shows

- To the reporter, before they submit: "CSA asks that a concern reach the DSO within 24
  hours of a disclosure" (p27).
- To the DSO, on the inbox: hours since `raised_at`, red past 24 (the NDSO referral,
  p27), and a separate 72-hour clock on anything that arrived by referral from The
  Guardian's app, recorded by the DSO with `how_learned = 'anonymous_app'` (p53).

### 3.5 What the reporter gets back

"Received — the DSO has it", the reference and the time. `my_concern_receipts()` returns
the reporter's own references and dates and nothing else: not the state, not who has
it, not whether it was read (the check, SG-2). The reference is what a reporter shows
if asked whether they reported within 24 hours.

### 3.6 Anonymous reporting

Not built. The card links The Guardian's app (SG-6, decided Q10), and the in-app form
says in one line: "This report is confidential, not anonymous: the DSO will know it came
from you. To report anonymously, use The Guardian's app." The link's URL is a platform
constant set by Kameel from CSA's material (phase 0).

---

## 4 · The concern record

### 4.1 The tables

All hand-written, like db/25 and db/47, not generated from `tables.mjs`: the generator's
permissive policies are the wrong tool for a record that is mostly about who may *not*
read it. Every table below has RLS on, `INSERT/UPDATE/DELETE` revoked from `scrbrd_app`,
and is written only through the functions named.

```
safeguarding_concern (
  id             uuid PK,
  reference      text NOT NULL UNIQUE,             -- what the reporter keeps
  tenant_id      uuid NOT NULL → school,           -- whose DSOs hold it (§3.2)
  school_id      uuid NOT NULL → school,           -- the school it concerns
  raised_at      timestamptz NOT NULL DEFAULT now(),
  about_kind     text NOT NULL CHECK (about_kind IN ('child','adult','leadership','dso','unknown')),
  subject_player_id uuid → player ON DELETE SET NULL,
  subject_person_id uuid → app_user ON DELETE SET NULL,
  subject_text   text,
  nature         text[] NOT NULL CHECK (nature <@ '{psychological,physical,sexual_harassment,sexual_abuse,neglect,bullying,other}' AND cardinality(nature) > 0),
  certainty      text NOT NULL CHECK (certainty IN ('suspicion','recognised')),
  occurred_on    date, occurred_where text,
  account        text NOT NULL CHECK (length(btrim(account)) >= 20),   -- written once
  authorities_told text,
  assigned_to    uuid → app_user,
  position_of_trust boolean NOT NULL DEFAULT false, -- set by the DSO; drives retention
  unheld         boolean NOT NULL DEFAULT false,    -- no DSO anywhere when raised
  state          text NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  closed_at      timestamptz, closed_by uuid → app_user,
  outcome        text CHECK (outcome IN ('no_action','supported','referred_saps',
                   'referred_social_development','disciplinary_enquiry','handed_to_union','other')),
  retain_until   date,                              -- set at close (§4.7)
  CONSTRAINT closes_whole CHECK ((state = 'open') = (closed_at IS NULL)
                                 AND (closed_at IS NULL) = (outcome IS NULL)
                                 AND (closed_at IS NULL) = (retain_until IS NULL))
)
safeguarding_concern_reporter (                     -- p63: apart, DSO-only
  concern_id   uuid PK → safeguarding_concern ON DELETE CASCADE,
  tenant_id    uuid NOT NULL → school,
  reporter_id  uuid NOT NULL → app_user,
  how_learned  text NOT NULL CHECK (how_learned IN ('witness','told','victim','anonymous_app','other')),
  named_ok     boolean NOT NULL DEFAULT false,
  device_id    text
)
safeguarding_concern_note (                         -- append-only; the actions log
  id uuid PK, concern_id → safeguarding_concern ON DELETE CASCADE, tenant_id → school,
  kind text NOT NULL CHECK (kind IN ('raised','note','assigned','family_contacted','saps_contacted',
        'guardian_contacted','social_development_contacted','ndso_informed','shared','share_revoked',
        'suspended','suspension_lifted','referred','position_of_trust_set','closed','reopened')),
  body text, written_by uuid NOT NULL → app_user, written_at timestamptz NOT NULL DEFAULT now()
)
```

A trigger fixes `written_by`, `reporter_id` and `closed_by` from the session, as
`disciplinary_record_author()` does (db/25 114). `account` has no UPDATE path; a
correction is a note.

### 4.2 Reads: the policy approach

Three layers on every safeguarding table, in this order, because each catches what the
one above would miss:

1. **Permissive:** `app_can('safeguarding.concern.read', tenant_id, '*', nil, nil)`. The
   tenant is the holder, so a school's DSO reads the school's, the union's DSO reads the
   union's, and neither reads the other's. `safeguarding_concern_reporter` has the same
   policy and no other: it is DSO-only even inside a share.
2. **`RESTRICTIVE`, support:** `app_support_access_id(tenant_id) IS NULL` (SCRBRD-110
   §6.5's rule, `db/22` 176). A support session borrows a real role at one school;
   `dso` is not a role support may borrow (`support_access_begin()` gains `dso` beside
   the subject-scoped refusals, `db/22` ~100), and this policy makes the tables invisible
   to a session even if it were.
3. **`RESTRICTIVE`, platform-wide:** `NOT app_is_platform_wide()` (`db/22` ~245). The
   owner's key lacks the capability already (§2.2); this is the belt to that brace, and
   it also refuses any future platform-scoped assignment from reading a concern whatever
   it holds.

`db/41` 250 and `db/50` 738 are the existing `RESTRICTIVE` shapes, and `db/41` 289 the
assertion that the policy really is restrictive; each safeguarding policy gets the same
assertion in its migration.

**Every read is logged.** The DSO's screens read through `safeguarding_concern_open(p_id)`
— `SECURITY DEFINER`, checks the capability at `tenant_id`, returns the concern, its
reporter (if the caller may), its notes and its shares, and calls
`log_restricted_read('safeguarding_concern', ARRAY[p_id], ARRAY['account','reporter'], tenant_id)`.
The inbox (`safeguarding_inbox(p_tenant)`) returns references, dates, `about_kind`,
`nature`, state and the hours-elapsed clocks, and logs as `'safeguarding_inbox'`. No
safeguarding table is a `read-api.mjs` resource; the functions are the only doors, so
the log cannot be bypassed by a list read.

### 4.3 Hiding the log entries

`access_log_read` is a permissive policy under `audit.read` (db/08 554). One
`RESTRICTIVE` policy is added:

```sql
CREATE POLICY access_log_safeguarding_hidden ON access_log AS RESTRICTIVE
  FOR SELECT USING (
    resource NOT LIKE 'safeguarding%'
    OR app_can('safeguarding.concern.read', access_log.school_id, '*'::text, nil, nil));
```

Every safeguarding function logs with a resource that starts `safeguarding` and the
holding tenant as `p_school`, so the principal, the director of sport, the office and
the platform (db/20's `platform_wide` reads; the owner's key holds `audit.read`) see no
row that would say a concern exists, and the DSO sees exactly those rows. A parent asking
"who read my child's record" (db/08 505) will not see a DSO's read under a concern; that
is p38's rule that the DSO decides what a parent is told, and it is written down for the
information officer (§9.7).

### 4.4 Need-to-know shares

The `wellness_share` pattern (SCRBRD-110 §6.3), for people rather than record kinds:

```
safeguarding_share (
  id uuid PK, concern_id → safeguarding_concern ON DELETE CASCADE, tenant_id → school,
  shared_by uuid NOT NULL → app_user, shared_at timestamptz NOT NULL DEFAULT now(),
  with_person_id uuid NOT NULL → app_user,          -- a coach, the principal, the physio…
  with_link_id   uuid → assignment_subject,          -- …or a verified guardian of the child (§4.5)
  what text[] NOT NULL CHECK (what <@ '{summary,child,account,actions}' AND cardinality(what) > 0),
  open_until timestamptz NOT NULL CHECK (open_until <= shared_at + interval '30 days'),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  revoked_at timestamptz, revoked_by uuid → app_user
)
```

- `what` has no word for the reporter. There is no way to share who reported (p63).
- `safeguarding_share_open(p_share)` is `SECURITY DEFINER`: the caller must be
  `with_person_id`, the share live, and it returns only the parts in `what` — `summary`
  is `nature`, `certainty`, `occurred_on`, `about_kind`; `child` is the child's name;
  `account` the account; `actions` the notes of kinds other than `shared`, `suspended`
  and `referred` — and logs `('safeguarding_share', ARRAY[p_share], what, tenant_id)`.
  No capability is needed to open a share: it is a named act to a named person, and
  the person's ordinary session is the credential.
- The notice: one `notification` with `recipient_id = with_person_id`, `kind =
  'safeguarding'`, body "The DSO has shared something with you. Open Safeguarding to
  read it." No name.
- Revoked by the sharer or any DSO at the tenant; lapses at `open_until`; closing the
  concern revokes every open share. A note of kind `shared` records each.
- **A coach learns nothing by default** (decided Q3). The coach who raised it sees the
  receipt. If the DSO judges he must know (p52 item 5), that is a share.
- **Parents have no standing access** (decided Q4). Telling a parent is a share to a
  verified guardian link (`with_link_id`), or a `guardian_contacted` note when it
  happened by phone. No notice goes to a parent that was not a share.

### 4.5 The family, and the child's name

`safeguarding_family(p_concern)` — `SECURITY DEFINER`, `safeguarding.concern.read` at
the tenant, the concern open and naming a child — returns the child's verified guardians
(`assignment_subject`, db/00 523, `verification_state = 'verified'`) with their names,
emails and phone numbers from `app_user`, and the child's emergency contacts
(`emergency_contact`, db/08 ~4630); logs `('safeguarding_family', ARRAY[p_concern],
ARRAY['guardian','emergency'], tenant_id)`. That is the whole of a DSO's reach into a
family, and it exists only while a concern is open (**Q3**).

### 4.6 The referral upward

```
safeguarding_referral (
  id uuid PK,
  from_school_id uuid NOT NULL → school, to_tenant_id uuid NOT NULL → school,
  sent_by uuid NOT NULL → app_user, sent_at timestamptz NOT NULL DEFAULT now(),
  child_gender text CHECK (child_gender IN ('male','female','other','unknown')),
  child_age_band text CHECK (child_age_band IN ('under_12','12_to_15','16_to_17','adult','unknown')),
  nature text[] NOT NULL, where_kind text NOT NULL CHECK (where_kind IN
     ('school_grounds','away_venue','transport','tour','online','home','other')),
  occurred_on date,
  reason text NOT NULL CHECK (reason IN ('child_abuse_24h','staff_or_leadership','about_dso','advice')),
  acknowledged_at timestamptz, acknowledged_by uuid → app_user
)
```

Exactly p27's four facts, the school, the date and why it was sent. No name, no
reporter, no account, no `concern_id` column: the sender's link to it is a
`safeguarding_concern_note` of kind `referred` whose `body` is the referral id, on the
school's side. `safeguarding_refer(p_concern, p_to, p_reason, p_where)` computes the age
band from the child's date of birth inside the function (the DSO never reads it) and
gender from `player` if held. RLS: `safeguarding.concern.read` at `to_tenant_id` or at
`from_school_id`, with the two `RESTRICTIVE` cuts. The PDSO acknowledges; the
acknowledgement is what the school's DSO sees as "NDSO informed, 14:02".

The PDSO can ask the school's DSO for more by phone. Nothing on the platform lets a
union read the account, by decision (SG-5).

### 4.7 Retention and purge

At close the DSO sets `position_of_trust` (p64: information "that may indicate that a
participant in a position of trust is unsuitable") and `retain_until` is computed:

- position of trust: `closed_at + 5 years`; at purge time the function also refuses
  while `subject_person_id` holds any live assignment anywhere on the platform ("as long
  as the participant remains active in the sport", p64 — the platform can only see its
  own part of the sport, so the DSO confirms the rest by hand);
- otherwise: `closed_at + 3 years` (p64);
- if the information officer says so (§9.7): where `subject_player_id` was the victim,
  never before `majority_on(born) + 3 years` (db/08 885), so the record exists when he
  can act on it as an adult.

`safeguarding_purge_due(p_tenant)` lists what is past its date;
`safeguarding_purge(p_concern)` — `safeguarding.concern.manage` at the tenant — deletes
the concern, its reporter row, notes and shares, sets `safeguarding_suspension.concern_id`
NULL where it pointed here (the suspension row is an authority record and stays), and
writes `safeguarding_purge_log (tenant_id, purged_at, purged_by, year_raised, nature,
position_of_trust)`. Nothing automatic deletes a concern (**Q6**). Referrals are the
receiving tenant's records under the same periods.

---

## 5 · Suspending an adult

p42: a child's complaint of sexual harassment means the DSO "must immediately suspend
all interactions between the suspect and the club". `duty_suspension` (db/34 104–133)
pauses one assignment linked to one match duty, under `user.role.assign`. A safeguarding
suspension is a different thing — every assignment the person holds at the tenant, and
any made while it is open — so it is its own row, read by the same liveness rule:

```
safeguarding_suspension (
  id uuid PK, person_id uuid NOT NULL → app_user, school_id uuid NOT NULL → school,
  concern_id uuid → safeguarding_concern ON DELETE SET NULL,   -- the reason lives there
  set_by uuid NOT NULL → app_user, set_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz, lifted_by uuid → app_user, lift_note text,
  CONSTRAINT lift_whole CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
)
UNIQUE INDEX one_open ON safeguarding_suspension (person_id, school_id) WHERE lifted_at IS NULL
```

- **Effect.** A generated file re-emits `app_can()`, `app_holds()` and `app_may_grant()`
  (db/35's shape, from db/23's) with one more condition beside the `duty_suspension`
  one: `AND NOT EXISTS (SELECT 1 FROM safeguarding_suspension s WHERE s.person_id =
  a.person_id AND s.school_id = a.school_id AND s.lifted_at IS NULL)`. Every assignment
  at that tenant grants nothing on the next statement; assignments elsewhere are
  untouched (**Q2**). `role_assignment_write` gains a trigger refusing a new assignment
  for a suspended person at that tenant. `trip_mark()` and the scorer's claim already
  read `app_can()`, so a suspended driver cannot mark a trip and a suspended scorer
  cannot score.
- **Who.** `safeguarding_suspend(p_person, p_school, p_concern)` and
  `safeguarding_suspension_lift(p_id, p_note)` require `safeguarding_authority
  ('safeguarding.suspend', p_school)`: the school's DSO, or the PDSO where the
  concern is held at the union (about the DSO or leadership). Nobody suspends
  themselves; nobody lifts their own. Each writes a note on the concern.
- **What others see.** `suspension_status(p_person, p_school)` — `SECURITY DEFINER`,
  returns `(suspended boolean, since timestamptz)` and nothing else — is what the
  office's People screen and the person's own "why can't I…" screen read. The words
  are "suspended by the DSO" (decided Q5). The table itself is readable only under
  `safeguarding.suspend` at the school plus the two `RESTRICTIVE` cuts; `concern_id`
  never leaves the function that reads it. The suspended person gets one notice with
  `recipient_id`: "Your assignments at {school} are suspended by the DSO. Contact the
  DSO." Trips and duties that named them show "driver needed" / "coach needed" / "scorer
  needed" — the existing cards already say this for an unfilled slot.
- **Not a revocation.** `role_assignment.active` is untouched (db/01's trigger never
  lets it go back to true, 960–1000); lifting restores everything. If the outcome is
  dismissal, the office revokes as it would anyone.

---

## 6 · The six conflicts, fixed

### 6.1 K1 · A pupil's own consent from 12, for images, video and a name on them

`public_name_consent` (db/47 197) already carries `given_by IN ('guardian','pupil')`
through a giver link, and `public_name_consent_set()` accepts the pupil's own record from
18 (C6). Two changes:

1. **Text names — a "no" only, from 12** (decided Q6). `public_name_consent_set()`
   accepts a pupil's record from his 12th birthday when `p_yes = false` (a `refused`
   record), and still refuses a pupil's `yes` before 18. `public_name_facts()` treats an
   open pupil `refused` record as a "no" whatever the guardian's says. PUBLIC_DATA C1/C4
   gain the sentence; that wording is Kameel's.
2. **Images and video — both, from 12.** A new `media_consent` table of the same shape
   (giver link, `given_by`, `version`, `given_on`, `ended_on`, `end_reason`, the form
   pair) with `purpose IN ('stream_name','filmed','photo')`, written through
   `media_consent_set()`. A pupil's record is accepted from 12 for `yes` and `no`; the
   guardian's is accepted at any age. `media_consent_live(player, purpose)` is true only
   when the guardian's is open and, from 12, the pupil's is too. The overlay's name
   path (SCRBRD-083 §5.2, `publicName()`) requires `stream_name`; SCRBRD-092's photos
   will require `photo`; `filmed` is SG-10's (§7.6).

Whether a pupil's record needs his own account or may be recorded by the office from a
signed form (Annexure C is a paper form the child signs, p72) is **Q7**; the
recommendation keeps db/47's giver-link foreign key and lets the office record it
against the pupil's `self` link, creating the link if the pupil has no account yet.

### 6.2 K2 · A DSO authorises the stream

A `safeguarding_register` line of kind `stream_authorisation`, per fixture (`subject_id`)
or per season (`season`), `body` holding the DSO's condition if any (p73). `broadcast_state()`
(SCRBRD-083 phase 4 replaces it) and `/api/public/matches/:match/board` serve a side's
names only when `match_broadcast.published`, that side's `fixture_publication` **and** a
live authorisation for the fixture or its season exist; otherwise the role word. Withdrawal
takes names off on the next read, as a consent withdrawal does. `stream_readiness(p_fixture)`
(§7.6) is what the DSO looks at before signing. For SCRBRD-092 the DSO holds the takedown
through `player.public.withhold`, which they already hold.

### 6.3 K3 · Pupils lose `medical.status.read`

`player: […]` in `roles.mjs` 288–293 loses `"medical.status.read"`;
`WITHDRAWN_SINCE_01.player = [{ after: "player.performance.read", capability:
"medical.status.read" }]`; a migration of its own, db/21's shape, deletes the
`role_capability` row. `enquiry` (`roles.mjs` 308) also holds it and should lose it for
the same reason — an enquiring family is not staff — unless Kameel says otherwise
(**Q8**). STEP4 phase A's pupil walk flips its assertion ("the Squad shows a team-mate's
`rtw_date`" becomes "shows none"). His own injury still reaches him through `selfaccess`.

### 6.4 K4 · The clearance register

One migration on `adult_clearance` and `clearance_requirement` (db/08 4794–4860):

1. `kind` CHECK dropped and re-added with `sexual_offences_register` and the
   safeguarding kinds of §7.4.
2. A `clearance_kind_max_days` reference table (`kind`, `max_days`, `first_max_days`):
   the three checks 731 days (24 months, p19, p24–26); `police_clearance` first recorded
   no older than 183 days (p26); `safeguarding_awareness` and `dso_training` 366 days
   (annual, p19, p22). A trigger refuses `expires_on > issued_on + max_days` and, for a
   person's first `police_clearance` at the tenant, `issued_on < sa_today() - 183`.
   `clearance_expiry_within_reason` (1,827 days) stays as the outer bound.
3. Requirement rows: `police_clearance`, `child_protection` and
   `sexual_offences_register` for `coach`, `assistantcoach`, `teammanager`, `medical`,
   `driver`, `transportcoordinator`, `official`, `scorer`, `facilities`, `media`,
   `scout`, `schooladmin`, `sportsadmin`, `directorofsport`, `principal`, `dso`;
   `safeguarding_awareness` and `safeguarding_acknowledgement` for all of those;
   `dso_training` for `dso`.
4. Existing rows are left alone; they lapse on their own dates.
5. `clearance_register(p_school)` (db/08 4946) excludes a person who is a `player` at
   any tenant and under 18 (`majority_on`): a pupil scorer is not "missing" (p19 says
   adults).

`tools/smoke-clearance.mjs` and `services/api/write/clearance-api.mjs` gain the kinds
and the refusals.

### 6.5 K5 · The emergency-contact role list, approved by the DSO

No policy change. A `safeguarding_register` line of kind `emergency_contact_roles` whose
`body` is the list derived from `holders('player.emergency.read')` at signing time. P7a
(STEP4 260) shows "approved by the DSO on {date}" beside "who else can see these", or
"not yet approved by the DSO". The office's Settings shows the same line to the
principal. Re-signed whenever the holder list changes (a test compares the register line
to the model and fails the build when they differ without a new line — see §9.2).

### 6.6 K6 · Trips cleared by a DSO

`trip` gains `cleared_by uuid → app_user` and `cleared_at timestamptz`, written only by
`trip_clear(p_trip)` and `trip_clearance_withdraw(p_trip)`, both requiring
`safeguarding_authority('safeguarding.authorise', trip.school_id)` (the school's DSO, a
tour DSO on that fixture, or the PDSO when the school has none). The coordinator's card
and STEP4's bus card (P3) show "not yet cleared by the DSO". `trip_mark(p_trip,
'departed')` (db/41 154) adds one refusal, `'not_cleared'`, applied **only when the
school has a live `dso` assignment**: warn now, refuse once the school has a DSO (decided
Q11 — read as "a school is refused only for what it can fix"; by the time every school
has one, every school is refused). Changing a trip's driver or vehicle after clearance
clears `cleared_at` (the DSO cleared *that* driver and *that* bus, p46).

---

## 7 · The other additions

| item | placed | why there |
|---|---|---|
| **SG-6** The Guardian's app link | phase 1, the DSO card | one constant and a line on the form |
| **SG-7** clearance kinds `safeguarding_awareness`, `dso_training`, `good_standing_declaration`, `safeguarding_acknowledgement`, `references_checked` | phase 3, with K4 | one CHECK change; the same recording rule (reference and date, never a scan) |
| **SG-8** policy links | phase 2, a `policy_links` register line, shown on the DSO card | Sonnet; no storage of documents |
| **SG-9** messaging rules | the `recipient_id` test in phase 1; the rest is a design constraint written into `up9`'s brief | `up9` is not designed yet; the rule that a pupil is never a private recipient is enforceable today, so it is |
| **SG-10** consent to being filmed; the tone check | phase 4: `media_consent` purpose `filmed`; `stream_readiness(p_fixture)` returns, for each squad, the count of children without a live `filmed` consent and no names, to `safeguarding.authorise` and `broadcast.publish` holders. The tone check is a word list added to SCRBRD-083 §4.1's discard filter and a line in the prompt — code, no migration, in 083's phase 3 | before SCRBRD-104's block lifts |
| **SG-11** the trip checklist (Annexure F) | phase 5: `trip_checklist` (one row per trip, the annexure's items as booleans and short text, `completed_by` a DSO, `sent_at`) and a referral of `reason = 'trip_checklist'` to the federation two days before; the four vehicle facts (licence age, business-use cover, breakdown cover, first-aid kit) as nullable columns on `vehicle` and `adult_clearance` | P3 in the check; needs the federation tenant staffed |
| **SG-12** serious incidents and workload patterns | phase 5: an `AFTER INSERT` trigger on `injury` (most serious severity, or emergency services called) and one on `bowling_breach` (a second breach for the same boy within 28 days) write the §3.3 DSO notice with no name; a flag unanswered after 72 hours is a `milestone_watch`-style check (db/51) | waits for SCRBRD-110 phase 2 |
| **SG-13** who may collect a child | not built; the bus card shows the return time and the rule | a third party's ID number on the platform, and no school has asked |

---

## 8 · Screens

Named so Sonnet can build each over the functions above, with Opus reviewing anything
that shows a concern.

| screen | who | reads | writes |
|---|---|---|---|
| **DSO card** on every home | everyone signed in | `dso_contacts()` | — |
| **Raise a concern** | everyone signed in | children the reporter can see; the school's people | `safeguarding_concern_raise()` |
| **My reports** (in Me / Family) | the reporter | `my_concern_receipts()` | — |
| **Safeguarding inbox** | `dso` | `safeguarding_inbox()`; the clocks | assign |
| **Concern** | `dso` | `safeguarding_concern_open()`, `safeguarding_family()` | notes; `safeguarding_share`, `_refer`, `_suspend`, `position_of_trust`, close; purge from the due list |
| **A shared concern** | the named person | `safeguarding_share_open()` | — |
| **DSO register** | `dso`; `audit.read` at the school | `safeguarding_register` | `_sign()`, `_withdraw()`: contact line, emergency-contact roles, stream authorisations, policy links |
| **People** (existing) | office | `suspension_status()` | — ("suspended by the DSO") |
| **Trip card** (existing) | coordinator, family, DSO | `trip.cleared_at` | `trip_clear()` on the DSO's view |
| **Broadcast / Settings** (existing) | `broadcast.publish`, `dso` | `stream_readiness()`; the authorisation line | `_sign('stream_authorisation')` |
| **Consent** (SCRBRD-092's screen, STEP4 §4) | guardian, pupil from 12 | `media_consent` | `media_consent_set()`; the pupil's text-name "no" |
| **Clearance register** (existing) | `clearance.read` | the new kinds, "first police clearance too old" | as today |

What a concern screen never shows: a child's date of birth, address or medical record
(the DSO reaches contacts through `safeguarding_family()` and nothing else); the reporter
to anyone but a DSO; the concern to the person it names.

---

## 9 · Phased build plan

Numbers are placeholders: db/52 and db/53 are taken by the Laws work, db/54 is likely
taken too, and SCRBRD-110 has planned six numbers after those. Each phase takes **the
next free number** when it is cut; `tools/hooks/guard.mjs`'s `FROZEN_THROUGH` moves after each
paste. Each phase is Opus for the migration, policy and tests, Sonnet for screens, Opus
review before it lands. Every new capability is one `ADDED_SINCE_01` line; the role is
one `ROLES_ADDED_SINCE_01` line; each `RESTRICTIVE` policy is asserted restrictive in its
own file (db/41 289's shape).

### 9.1 Phase 1 — The role and the record (P1)

**Migration (one file):** the `dso` role and its `role_capability` and `role_grantable`
rows; the four capabilities; `safeguarding_concern`, `_reporter`, `_note`, `_share`;
`safeguarding_route()`, `_concern_raise()`, `_inbox()`, `_concern_open()`, `_family()`,
`_share()`, `_share_open()`, `_close()`, `my_concern_receipts()`, `dso_contacts()`,
`school_union()`, `safeguarding_authority()`; the three policy layers on each table; the
`RESTRICTIVE` policy on `access_log`; `dso_appointment_guard()`; the tenant-scoped `dso`
trigger; `notification.recipient_id` and its `RESTRICTIVE` policy if SCRBRD-110 has not
added it; `support_access_begin()` refusing `dso`; `clearance_requirement` rows for `dso`.
**Policy:** `roles.mjs` (`dso`, the masterkey carve-out, `GRANTABLE_ROLES.principal`),
`capabilities.mjs`, the generator lists. K3's withdrawal ships as its own small file in
this phase.
**Tests.** `separation.test.mjs`: `safeguarding.*` held by `dso` and no other role;
`superadmin` holds none of it and everything else; SCRBRD-110's `fitness` role, if it has
landed, holds none of it; `dso` holds none of `medical.*`,
`discipline.*`, `scoring.*`, `user.role.assign`, `player.pii.read`,
`player.emergency.read`, `player.age.read`; `player` and `enquiry` hold no
`medical.status.read`. `rls.test.mjs`: the generator entries. `db/99`, one section: a
coach, a parent (of the named child), the office, the principal, the director of sport,
`competitionadmin`, the owner's key, a `platformadmin`, a support session as `coach` and
as `schooladmin`, and the adult the concern names each read **zero rows** of every
safeguarding table, zero `access_log` rows whose resource starts `safeguarding`, and
zero `safeguarding` notifications; the DSO reads the concern and the reporter; a second
DSO at the same school reads it; the union's DSO reads it only when routed there; a
concern about the DSO is invisible to that DSO; the reporter reads a receipt and nothing
else; a share opens for its person, returns only `what`, never the reporter, lands in
`access_log`, and closes on revocation, expiry and the concern's close on the next
statement; the guard refuses the principal's revocation while a leadership concern is
open and allows the PDSO's; a `dso` assignment with no tenant is refused; a
`recipient_id` naming a pupil is refused unless `kind = 'system'`. **Walks:**
`tools/smoke-safeguarding.mjs` (raise as a pupil, a parent, a coach, an official;
inbox; open; share; close) and `smoke-browser-safeguarding.mjs` (the card, the form's
honesty line, the receipt, the inbox clocks). `smoke-support.mjs` and
`smoke-browser-support.mjs` gain "a support session sees no Safeguarding entry".
**Go-live:** the pilot school's principal has appointed a DSO; the union tenant for the
pilot's province exists (a `union` row with `province`) even if its DSO is not yet
enrolled; The Guardian's app URL is set; the information officer has the §9.7 note.

### 9.2 Phase 2 — Suspension and the DSO register (P1)

**Migrations (two):** `safeguarding_suspension`, `_suspend()`, `_suspension_lift()`,
`suspension_status()`, the new-assignment refusal, `safeguarding_register`, `_sign()`,
`_withdraw()`; and a generated re-emission of the three decision functions with the
suspension condition (db/35's shape — the generator gains the clause beside the
`duty_suspension` one). K5's register line; SG-8's links. **Tests.** `db/99`: a
suspended coach's `app_can()` is false for every capability at that school on the next
statement and true at another school; the office reads "suspended" and no reason; the
person reads "suspended" and no reason; `trip_mark()` refuses the suspended driver; a
new assignment for the suspended person is refused; lifting restores; `active` is
untouched throughout. `separation.test.mjs`: the emergency-contact role list in the
model matches the newest `emergency_contact_roles` line in `db/98`'s seed, so a widening
of `player.emergency.read` fails the build until a DSO re-signs. **Walks:**
`smoke-browser-suspension.mjs` gains the safeguarding case; `smoke-contacts.mjs` the
"approved by the DSO" line. **Go-live:** the pilot's DSO has signed the emergency-contact
line.

### 9.3 Phase 3 — Clearances (P1)

**Migration (one):** K4 and SG-7: the kinds, `clearance_kind_max_days`, the trigger, the
requirement rows, `clearance_register()` re-emitted for the pupil exclusion. **Tests.**
`db/99`: a 25-month `child_protection` is refused; a first `police_clearance` issued 7
months ago is refused and a renewal is not; a pupil scorer is not "missing"; an existing
five-year row still reads as current until its date. `smoke-clearance.mjs` gains the
kinds. **Go-live:** none beyond the paste; existing rows lapse on their own.

### 9.4 Phase 4 — Media (P2, before SCRBRD-104's block lifts)

**Migration (one):** `media_consent`, `media_consent_set()`, `media_consent_live()`;
`public_name_consent_set()` and `public_name_facts()` re-emitted for the pupil's "no"
from 12; `stream_readiness()`; the board read requiring a `stream_authorisation` line
(with SCRBRD-083 phase 4's `broadcast_state()` change — same migration if they land
together). The tone-check word list in the commentary service. **Tests.** `db/99` and
`public.test.mjs`: a pupil of 11 cannot record; a pupil of 12 can refuse and not
accept; an overlay name needs the guardian's `stream_name`, the pupil's from 12, the
side's publication and a live authorisation, and loses it on the withdrawal of any one
on the next read; `stream_readiness()` returns counts and no names to a DSO and nothing
to a coach. `smoke-broadcast.mjs` gains the authorisation cases. **Go-live:** PUBLIC_DATA
C1/C4 amended by Kameel; the pilot's DSO has signed a season authorisation.

### 9.5 Phase 5 — Provincial referral, trips, incidents (P2–P3)

**Migrations (one or two):** `safeguarding_referral`, `_refer()`, `_acknowledge()`;
`trip.cleared_by/cleared_at`, `trip_clear()`, `_withdraw()`, `trip_mark()`'s
`not_cleared` under the has-a-DSO condition, the clearance-clearing trigger on driver or
vehicle change; `trip_checklist` and the vehicle facts (SG-11); the SG-12 triggers;
`safeguarding_purge_due()`, `_purge()`, `_purge_log`; if Kameel takes Q1's notice
period, `dso_appointment_end()` and the PDSO's confirmation. **Tests.** `db/99`: a
referral row holds no name and no account; the union's DSO reads it and cannot reach
the concern; the school's DSO sees the acknowledgement; a school without a DSO warns on
an uncleared trip and one with a DSO refuses `departed`; a driver change clears the
clearance; a serious injury produces one nameless DSO notice; purge refuses before
`retain_until` and while the subject is active, and leaves a log row naming nobody.
`smoke-transport.mjs` gains the clearance. **Go-live:** a PDSO enrolled at the union
tenant; the information officer's answer on the victim case applied to `retain_until`.

### 9.6 Later, or not at all

`up9` messaging under SG-9's rules (Opus design when `up9` is briefed); SG-13 only if a
school asks.

### 9.7 For the information officer, before phase 1 goes live

1. The concern record and the reporter's identity as the p63 "safeguarding records"
   class (decided Q13), hidden from the school's own audit readers and from the platform
   operator; and that a parent's "who read my child's record" answer excludes a DSO's
   reads under a concern (§4.3).
2. Retention: CSA's periods as minimums, and whether a concern where a child was the
   victim is kept until three years after his majority (decided Q8; the officer's
   answer sets §4.7's third rule).
3. `safeguarding_family()`'s use of guardian contact details for a child named in a
   concern, as processing in the child's interest (p52 item 8, with the DSO making the
   decision), logged.

---

## 10 · Open questions for Kameel

Only what the decisions leave open. Each has a recommendation.

1. **Ending a DSO appointment: an immediate refusal, or a notice period?** The decided
   rule (a principal cannot remove a DSO while a concern naming the principal is open)
   ships in phase 1 as a trigger. Its refusal tells the principal that *something*
   blocks them. *Recommendation:* in phase 5, make every DSO removal by a principal a
   seven-day notice confirmed by the PDSO, so the principal learns nothing either way
   and p17's "inform the NDSO" is met by the same act. Until PDSOs exist, the trigger's
   generic wording stands.
2. **A suspension's reach.** A DSO's suspension covers every assignment at that tenant.
   An adult who also coaches at a club or a second school keeps those. *Recommendation:*
   keep it per tenant; the DSO's referral tells the PDSO, who may suspend at other
   tenants in the province by hand. Automatic cross-tenant suspension would let one
   school's DSO act on another school's people without that school knowing why.
3. **The DSO's reach into a family.** The check proposed standing `player.pii.read`,
   `player.emergency.read` and `player.age.read` for `dso`. *Recommendation:* no
   standing reads; `safeguarding_family()` gives the guardians and emergency contacts of
   a child named in an open concern, logged under it, and the age band is computed
   inside the referral. Narrower, and every read has a concern behind it.
4. **One union per province?** `school_union()` assumes it. *Recommendation:* yes, with
   a `province` on the union tenant and a test that no province has two; if CSA's
   structure needs more (a district union), a `parent_tenant_id` on `school` is the
   next step, not now.
5. **Who appoints the PDSO and the NDSO on the platform?** A `principal` assignment at
   the union or federation tenant, made by the platform account (the recovery path),
   after which that principal appoints the `dso`. *Recommendation:* yes; the first union
   and federation principals are appointments Kameel makes with CSA's names, recorded
   as any other.
6. **Who presses purge?** *Recommendation:* the tenant's DSO, from a "due for deletion"
   list, never a job; the purge log is what shows the officer it happened.
7. **A pupil's own consent without an account.** K1's assent from 12 runs through the
   pupil's `self` link in db/47's shape. *Recommendation:* the office may record it from
   a signed form (Annexure C, p72) against the pupil's `self` link, creating the link
   without an invitation when he has no account; a pupil with an account gives or
   withdraws it himself. Otherwise K1 waits on every 12-year-old having a login.
8. **`enquiry` and `medical.status.read`.** K3 withdraws it from `player`; `enquiry` (a
   family asking about admission) holds it too. *Recommendation:* withdraw it there as
   well, in the same file — an enquiring family is not staff (p52 item 6).

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `ROLE_CAPABILITIES`, `superadmin: [...ALL_CAPABILITIES]`, `platformadmin` | `packages/policy/src/roles.mjs` 84–123 | the masterkey carve-out; platform gains nothing |
| `principal` bundle; `player` and `enquiry` bundles; `guardian` bundle | `roles.mjs` 124–150, 288–293, 308, 341–358 | K3; parents hold no safeguarding read |
| `GRANTABLE_ROLES`, `mayGrantRole()` | `roles.mjs` 491–550 | principal appoints `dso` |
| `SUBJECT_SCOPED_ROLES`, `boundaries()` | `roles.mjs` 54, 587 | support's refusals; the DSO card's "who else" |
| `CAPABILITIES`, `LEVEL`, `SENSITIVE`, `PLATFORM_ONLY` | `packages/policy/src/capabilities.mjs` 37, 415, 514, 369 | the four capabilities and their levels |
| `audit.read`, `clearance.read/manage`, `player.public.withhold`, `broadcast.publish`, `platform.support.impersonate` | `capabilities.mjs` 44, 92–93, 232, 288, 314 | the `dso` bundle; K2; support |
| `WITHDRAWN_SINCE_01`, `ROLES_ADDED_SINCE_01`, `ADDED_SINCE_01` | `services/api/rls/generate-rls.mjs` 414, 430, 454 | K3; the role; the capabilities |
| `separation.test.mjs` and its `superadmin` standing exception | `packages/policy/test/separation.test.mjs` 1–60 | the new assertions |
| `school.kind` (`union`, `federation`), `school.province` | `db/00_schema_core.sql` 32–34 | PDSO and NDSO tenants; `school_union()` |
| `role_assignment` (`school_id`, `fixture_id`, `season`, `active`, `created_by`, `revoked_*`) | `db/00` 447–487 | the `dso` assignment; tour DSO; the guard |
| `assignment_subject` (`verification_state`, `relationship`) | `db/00` 523 | guardian links for shares and `safeguarding_family()` |
| `role_grantable`, `app_may_grant()` | `db/01_authz.sql` 620–629, 720; `db/23_authz_time_box.sql` 178 | who may appoint a DSO |
| `role_assignment_read/write/revoke`, `role_assignment_revoke_only()` | `db/01` 919–1000 | the removal guard; `active` never returns to true |
| `notification` (`required_capability` FK, `subject_*`, `is_public`) | `db/08_schema_programme.sql` 220–268 | the DSO notice; the share and suspension notices |
| `access_log`, `access_log_read`, `log_restricted_read()` | `db/08` 526–598; `db/20_platform_reads.sql` 20, 43; `db/22_support_access.sql` 206–240 | every safeguarding read on the log; the hidden rows |
| `player_school()`, `player_team()`, `majority_on()`, `sa_today()` | `db/08` 624, 633, 885, 5027 | anchors; retention; the age band |
| `guardian_link_verify()` | `db/08` 987 | a verified guardian for a share |
| `trip_mark()`, `trip_contacts()`, `trip_driver_own_only` (`RESTRICTIVE`) | `db/41_trip_driver_own.sql` 154–192, 95, 250, 289 | K6; the restrictive shape and its assertion |
| `trip_vehicle_fits()`, `trip_driver_cleared()` | `db/08` 2829, 4979 | the driver guard's "missing does not refuse" |
| `clearance_requirement`, `adult_clearance`, `clearance_expiry_within_reason`, `clearance_status()`, `clearance_register()` | `db/08` 4794–4860, 4909, 4946 | K4, SG-7 |
| `support_access`, `support_access_begin()`, `app_support_access_id()`, `app_is_platform_wide()` | `db/22` 44–120, 176, ~245 | the two `RESTRICTIVE` cuts; `dso` not supportable |
| `disciplinary_record`, `disciplinary_record_author()`, its policies | `db/25_disciplinary_record.sql` 38, 114, 191–197 | what a concern is kept apart from; the fixed-author trigger |
| `duty_suspension`, the liveness clause in `app_can()` | `db/34_duty_authority.sql` 104–133; `db/35_authz_suspension.sql` | the suspension pattern |
| `public_name_consent` (`given_by`), `public_name_consent_set()`, `player_never_public`, the capability insert | `db/47_public_data.sql` 197–260, 332, 440–522, 131–142 | K1; C5; `ADDED_SINCE_01`'s worked example |
| `pad_scope_<cmd>` `RESTRICTIVE` emission | `db/50_pad_resume.sql` 738 | the restrictive pattern |
| the owner's key seed | `db/98_seed_pilot.sql` 362–368 | `db/99`'s masterkey assertions |
| `db/99_rls_verify.sql` (79 sections) | `db/99` | the new sections |
| `FROZEN_THROUGH` | `tools/hooks/guard.mjs` 54 | moves after each paste |
| `read-api.mjs`'s logging call | `services/api/read/read-api.mjs` 2650 | no safeguarding resource is added there |
| `clearance-api.mjs`, `smoke-clearance.mjs`, `smoke-transport.mjs`, `smoke-broadcast.mjs`, `smoke-browser-suspension.mjs`, `smoke-support.mjs`, `smoke-contacts.mjs` | `services/api/write/`, `tools/` | the walks that grow |
| `wellness_share`, `wellness_share_open()`, `wellness_flag`'s notice, `recipient_id` and its `RESTRICTIVE` policy, §6.5's support cut, the `fitness` role, the phase numbering | `docs/design/SCRBRD-110_workload.md` (main checkout, revised 2026-09-27) §3.3, §3.4 (line 287), §6.2 (444–447), §6.3, §6.5 (484), §9 (615–620) | the share pattern; the column; the support cut; a role that must hold no `safeguarding.*`; the next free number |
| `broadcast_state()` under the rule; phase 4 | `docs/design/SCRBRD-083_public_pages.md` §5.2, §8 phase 4 | K2 |
| P7a, phase A's pupil walk, Q5 | `docs/design/STEP4_parent_pupil.md` 260, 610, 631 | K5; K3; parents and discipline |
| C1–C7, N1–N5, A8, D2 | `docs/policy/PUBLIC_DATA.md` 77–90 | K1's wording is Kameel's |
| the check, its decided §5 | `docs/policy/CSA_SAFEGUARDING_CHECK.md` | everything above |
