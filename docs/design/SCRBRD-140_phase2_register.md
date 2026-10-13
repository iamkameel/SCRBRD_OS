# SCRBRD-140 phase 2 — The school staff register: the design

Status: **for Kameel's review (Fable, 2026-10-13).** Phase 1 of SCRBRD-140 is built and shipped
(`db/81_signup_google.sql`; the parent doc's status line, line 3, still says "nothing here is
built yet" and is stale — see §10). Nothing of phase 2 exists: no `school_register`, no
`register_upload()`, no `register_claim()`, no `role_request_grant_as()`, no route, no screen.
`tools/smoke-register.mjs` is the unrelated officials register. A code freeze stands until the
15 October pilot, so nothing here ships before it.

**Lead's review (2026-10-13).** Checked against the code: `email_at_link` (db/81:180), the
`safeguarding` notice kind (db/89:130), `safeguarding.concern.read` (roles.mjs:517) and
`app_may_grant_at()` (db/77:116-138) are as cited. Two notes for the builder, neither changing a
decision: (1) the cooldown's `BEFORE INSERT ON role_request` trigger (§4.2) also fires at
`register_claim()` step 2 (§2.2), outside step 3's caught sub-block, so a person under a cooldown
gets the cooldown sentence from a claim too; that is the right answer, but `db/99` should prove
it. (2) Redaction (§1.8) runs only when someone at the school presses "Clear", so an unattended
school keeps expired rows past ninety days; the scheduled job §1.8 leaves to the lead should be
on the list before a second school joins.

This document refines §5.2, §6 and the phase 2 rows of §9 in
`docs/design/SCRBRD-140_signup_and_school_linking.md` (the "140 doc") against what phase 1
actually shipped. Where the two differ, this one wins; §10 lists each difference. Opus builds
from it; the lead numbers nothing here differently from §9.

## What Kameel decides

1. **The ceiling on what the register may grant** (P2-D3): refuse at upload any role whose
   bundle holds `medical.details.read`, `discipline.read` or a `safeguarding.*` capability, so a
   mistyped email never hands a stranger a child's clinical notes. Recommended **yes**.
2. **Who lifts a request cooldown** (P2-D12): a DSO at a school where the declined claims were,
   never the office. Recommended **the DSO**.
3. **Retention of unclaimed register rows** (P2-D13): name and email redacted ninety days after
   the row expires or is withdrawn unclaimed. Kameel signs this as information officer.
   Recommended **ninety days**.
4. **The pilot's staff** (P2-D16): phase 1's path (sign in with Google, request, one tap from
   the office per head), no bulk staff import before 15 October. Recommended **phase 1's path**.
5. **Whether the cooldown ships beside the register** (P2-D17, `db/93`) or waits for its own
   day. Recommended **ships beside it**, as a separate file so it can wait without holding
   `db/92`.

---

## 0 · Summary, in plain words

- **A register row is one grant the office decided in advance.** The office uploads its staff
  list; each row is checked against exactly the authority a hand grant is checked against
  (`app_may_grant_at()`, db/77:116-138), at upload *and again* when it is claimed.
- **A staff member claims by signing in with Google and choosing the school.** The match is the
  email Google verified for that account (`auth_identity.email_at_link`, db/81:180), lower-cased,
  exact, at that school, on an open row. Every open row for that email at that school is claimed
  in one go. A row claims once.
- **The grant goes through the same body as a hand grant.** `decide_role_request()`'s grant half
  (db/62:194-245, with db/81's school seam at db/81:685-686) is factored into an internal
  `role_request_grant_as(request, decider, …)`; the decider recorded is the uploader. There is
  one door, not a copy.
- **Whatever cannot be granted becomes an ordinary request.** An uploader who has since lost
  authority, a claimant whose account is a pupil's, a refusal from any trigger on
  `role_assignment`: the row is consumed, a pending `role_request` is written, and the person
  reads the same sentence a no-match reads. Nothing is said about why.
- **No child enters through it.** Guardian, pupil and DSO roles are refused at upload by a CHECK;
  a pupil's account is refused at claim; the register holds adults' work emails and is read only
  by the office and the auditor.
- **The suspended-person proof waits for the suspension.** `safeguarding_suspension` does not
  exist (db/57:10-12). Phase 2 proves what exists: a person holding any active assignment at the
  school, suspended or not, cannot claim. The safeguarding proof is a named obligation on that
  later migration (§3).
- **The D7 notice and the cooldown ship as `db/93`**, a trigger on a declined `guardian`
  request writing a `safeguarding`-kind notice with no name on it, and a cooldown after repeated
  declines that a DSO lifts.

---

## 1 · The register's model

### 1.1 The table

```
school_register (
  id               uuid PK DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL → school,
  email            text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name             text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  role             text NOT NULL,                        -- see 1.3
  team_code        text,                                 -- required for coach/assistantcoach/teammanager
  valid_until      date NOT NULL,                        -- the row's claim window, not the role's life (P2-D6)
  uploaded_by      uuid NOT NULL → app_user, uploaded_at timestamptz NOT NULL DEFAULT now(),
  upload_id        uuid NOT NULL,                        -- one id per upload call; the access_log row names it
  warned_ended_on  date,                                 -- the recently-ended warning the uploader acknowledged (1.6)
  claimed_at       timestamptz, claimed_by uuid → app_user, claimed_identity uuid → auth_identity,
  claimed_request  uuid → role_request,                  -- the request that records the grant, or the fallback
  outcome          text CHECK (outcome IN ('granted', 'requested')),
  outcome_reason   text,                                 -- 'uploader_authority_lapsed' · 'refused' · NULL when granted
  withdrawn_at     timestamptz, withdrawn_by uuid → app_user,
  redacted_at      timestamptz,                          -- 1.8: name and email replaced
  CONSTRAINT claimed_whole CHECK ((claimed_at IS NULL) = (claimed_by IS NULL) AND (claimed_at IS NULL) = (outcome IS NULL)),
  CONSTRAINT open_or_done  CHECK (NOT (claimed_at IS NOT NULL AND withdrawn_at IS NOT NULL)),
  CONSTRAINT no_child_role CHECK (role NOT IN ('guardian', 'selfaccess', 'enquiry', 'player', 'dso'))
)
UNIQUE INDEX school_register_one_open ON school_register (school_id, email, role, coalesce(team_code, ''))
  WHERE claimed_at IS NULL AND withdrawn_at IS NULL;
INDEX school_register_email_idx ON school_register (school_id, email) WHERE claimed_at IS NULL AND withdrawn_at IS NULL;
```

RLS on, **no policy, no table privilege** for `scrbrd_app`: `login_code`'s shape one step further,
exactly as `auth_identity` and `pending_claim` are (db/81:211-217). Every read and write is one
of the `SECURITY DEFINER` functions in §1.9. Against the 140 doc's sketch (lines 344-355): the
`season` column goes (`decide_role_request()` takes no season, db/62:179), `valid_until` is
defined as the claim window only, and `outcome`, `claimed_request`, `upload_id`,
`warned_ended_on` and `redacted_at` are added.

### 1.2 Who may upload, and the two checks per row

The caller must hold `user.role.assign` at the school (`app_can`, as `role_assignment_end()`
asks at db/77:307-310) and, **for each row**, `app_may_grant_at(row.role, school)` must be true
(db/77:116-138): a sports administrator cannot list a principal, and the platform-only floor at
db/77:133-136 keeps platform roles out without naming them. A pad's credential is refused
(`app_pad_scoped()`, db/77:117). Both are the questions a hand grant asks (db/62:186-189), so
the register is bounded by exactly the authority a grant is bounded by.

The upload is **all or nothing**, as the players import is (PILOT_LOAD.md:126-127): a file with
one bad row commits nothing, and the report says each row's problem in words. A dry run is the
default; commit needs `commit: true` and, for each warned row, that row's acknowledgement
(§1.6). At most 200 rows per upload, at most 5 open rows per email per school.

### 1.3 What a row may hold

Staff only (D4). Three fences, from the inside out:

| fence | what it refuses | where |
|---|---|---|
| the CHECK `no_child_role` | `guardian`, `selfaccess`, `enquiry` (a row cannot name a child), `player`, `dso` (the principal's live act, SAFEGUARDING_DSO §2.3) | the table |
| `app_may_grant_at()`'s floor | every platform role, and any role the uploader may not grant here | db/77:130-136 |
| **the sensitive-bundle ceiling (P2-D3, Kameel decides)** | any role whose bundle holds `medical.details.read`, `discipline.read` or a `safeguarding.*` capability, read from `role_capability` at upload time, not from a list | `register_upload()` |

Why the third fence. The register grants on an email match. The one thing that can go wrong is
the office typing the wrong address, and the damage is whatever the role reads. For `coach` that
is availability and a squad list; for `medical` it is children's clinical notes
(ADR 0001:86-99, the sensitive split). A role on the far side of that split is granted by hand,
with the person in front of the office, and the upload says so: "Medical staff are added from
People, not from the register." Reading the ceiling from `role_capability` means it follows
`roles.mjs` without a second list to drift (DEPLOYING.md:1100-1119 on why there must not be one).

A team-scoped role (`coach`, `assistantcoach`, `teammanager`) must name a side, or the row is
refused: `decide_role_request()` would refuse the grant at db/62:199-201, and a row that can
never grant should not be stored. `team_code` is checked against the school's teams.

### 1.4 Matching a signing-in person to a row

`register_claim(p_school)` is called by a **signed-in** account (not a pad's). It matches
`lower(email_at_link)` of every **live** (`revoked_at IS NULL`) `auth_identity` row of the
caller's account (db/81:172-190) against open rows at `p_school`: `claimed_at IS NULL AND
withdrawn_at IS NULL AND valid_until >= current_date`. Exact, lower-cased, nothing else — no
name, no domain, no "looks like" (the 140 doc's rejection at line 406 stands).

| question | answer | why |
|---|---|---|
| Which identity fields? | `auth_identity.email_at_link` only, **never** `app_user.email` | `email_at_link` is what a provider verified (db/81:178-180); `app_user.email` on an office-enrolled account is what the office typed. A person with no identity (code only) matches nothing and is told to ask the office — the register needs Google, as A3 assumed |
| Two rows match? | every open row for that email at that school is claimed in one transaction, each through its own request and grant | the office listed three grants; the person should not sign in three times. `FOR UPDATE` on the rows, in `id` order |
| A changed Google email? | no match; the Me screen already shows the mismatch (140 §3.5, lines 225-232); the person adds the new Google account as a second sign-in (D11, `auth_identity_link_self()`, db/81:484-529), which writes a fresh `email_at_link`, and claims | falls out of D11 and D12 with no new rule |
| The email is on the register at two schools? | only the chosen school's rows | the row is per school; the join screen names one |
| Fresh `auth_time` needed? | **no** | the session is device-bound and tracked (db/85, AUTH_SPEC.md:39-42); a stolen token could claim only the grant the account's owner would claim at the next sign-in |

### 1.5 One-shot claims, and the register as the first door

A row is consumed by its first claim, whatever the outcome (§2.2): `claimed_at`, `claimed_by`,
`claimed_identity`, `claimed_request` and `outcome` are written, and the partial unique index
lets a fresh row for the same person be listed later.

**The register is the first door (P2-D4).** A claim is refused when the caller holds **any
`active` assignment at the school** — live, dated out, or paused under a `duty_suspension`
(db/77:126-127). Three reasons: a second role on an account the school already knows is one tap
on People (`enrol_person()`, db/08); a paused person must not use the register to walk round the
pause with a new assignment (§3); and the register's worth is for the person the office has not
yet met on the platform. The refusal reads as the ordinary request path (§2.2).

So the join screen's trigger widens (P2-D15): today it is for an account with no school
(joinSchool.js:2-4); in phase 2 it is shown when `app_enrolled()` is false (db/81:88-108) —
no live assignment anywhere — which also covers the ex-coach whose account kept its
`school_id` when his roles ended. Without this the recently-ended warning below would guard a
path nobody could walk.

### 1.6 Expiry, withdrawal, and the recently-ended warning

- **Expiry.** `valid_until` defaults to the end of the current season (A-P2-1) and may be set
  earlier; it may not be more than eighteen months out. A row past it matches nothing.
- **Withdrawal.** `register_withdraw(id)`: `user.role.assign` and `app_may_grant_at(row.role,
  school)` for the caller, open rows only. A claimed row is not withdrawn: the office ends the
  assignment with End role (`role_assignment_end()`, db/77:287), which writes its own notice and
  `role_assignment_ending` row (db/77:406-420). Ending a role never reopens a row.
- **The twelve-month warning.** At upload, a row whose email belongs to an account with a
  `role_assignment_ending` row at this school in the last twelve months (db/77:418-420), or an
  inactive assignment there with no ending row, comes back as a **warning**: "Ended 3 Sep
  (Coach, U14A) — list anyway?" Commit requires the row's acknowledgement, recorded in
  `warned_ended_on`. A row whose email belongs to an account holding a **live** assignment at
  this school is a **refusal**: "Already Coach (U14A) here. Add a role from People." The uploader
  can read both facts on People already, so nothing new is learned. Accounts at other schools
  are never mentioned: such a row is simply never claimed and expires.

### 1.7 Children and privacy, exactly

| rule | how it is held |
|---|---|
| No row can name a child | `no_child_role` CHECK (§1.1); a `guardian` row is refused at upload with "A parent is linked by the office from a request, never from a list" |
| No pupil can enter through it | at claim, `person_is_pupil(caller)` (db/57:600) → the row is consumed as `requested`/`refused` and the office decides by hand; the office's decide path has its own rules (db/62:202-243) |
| No child's name is ever on the register | the table holds adults' names and work emails; the upload screen says "Adults only. Never a pupil." and the API's CSV parse stores no file, only rows |
| Who reads it | `user.role.assign` or `audit.read` at the school, through `school_register_rows(p_school)`; never the claimant (who learns only "listed" or "not listed" about their own email), never a pad, never a public page |
| What the DSO sees | nothing by standing (SAFEGUARDING_DSO §1); the register is not a safeguarding record |
| The notice to the office | names the adult who joined, the role, the side; no child (§2.3) |

### 1.8 Retention (P2-D13, Kameel decides as information officer)

An unclaimed row is personal information about someone who may never sign in. Ninety days after
`valid_until` or `withdrawn_at`, an unclaimed row has `name` and `email` replaced ("Redacted",
`redacted+<id>@invalid`) and `redacted_at` set; `role`, `team_code`, `uploaded_by` and dates
stay, so the audit of what the office listed survives without the person. A **claimed** row is
kept as it is: it is the record of a grant, and the person is now an account holder under
`app_user`'s own retention (ACCOUNT_LIFECYCLE). `register_redact_due(p_school)` lists what is
due; `register_redact(p_school)` does it under `user.role.assign`; the register screen offers
"Clear 4 expired rows". Nothing runs unattended in phase 2; a scheduled job is the lead's later
call, as `safeguarding_purge_due()` set the precedent (SAFEGUARDING_DSO.md:550-555).

### 1.9 The functions

| function | who | answers |
|---|---|---|
| `register_upload(p_school, p_rows jsonb, p_commit boolean, p_acknowledged uuid[])` | `user.role.assign` at school, each row `app_may_grant_at` | per row: `line, ok, problem, warning, ended_on`; on commit the row ids and one `upload_id` |
| `register_claim(p_school)` | any signed-in non-pad account with no active assignment at `p_school` | per matched row: `role, team_code, outcome`; or `no_match` |
| `register_withdraw(p_row)` | as upload, for that row's role | `(ok, reason)` |
| `school_register_rows(p_school, p_state)` | `user.role.assign` or `audit.read` at school | the rows, with uploader's and claimant's names |
| `register_redact_due(p_school)`, `register_redact(p_school)` | `user.role.assign` at school | the due rows; the count redacted |
| `app_may_grant_at_for(p_person, p_role, p_school)` | internal | db/77:116-138's body with `app_user_id()` → `p_person`, the pad clause dropped, `AND u.active` added |
| `app_may_assign_at_for(p_person, p_school)` | internal | a live assignment of `p_person` at `p_school` or the platform whose role holds `user.role.assign` (`role_capability`), with db/81:93-98's liveness clauses |
| `role_request_grant_as(p_request, p_decider, p_note, p_player, p_team)` | internal | §2.1 |
| `register_log(p_resource, p_school, p_ids uuid[])` | internal | an `access_log` row in `auth_identity_log()`'s shape (db/81:381-385) with the register's school |

Every one `SECURITY DEFINER`, `search_path` pinned (DEPLOYING.md:1131), granted to `scrbrd_app`
only where the table says so, revoked from `anon`/`authenticated` as db/81:730-739 does.

---

## 2 · What a claim grants, and how

### 2.1 Factoring `role_request_grant_as()` — from db/81's patched text

The body to start from is **not** db/62's: it is db/62:179-247 with db/81's school seam inserted
before the final UPDATE (db/81:681, 685-686, 699). The lead takes `md5(prosrc)` of
`decide_role_request(uuid,boolean,text,uuid,text)` from a database at `db/91`, and `db/92`
refuses to run unless the function in place has that hash (db/77:175-178 and db/81:692-694 are
the pattern), or already calls `role_request_grant_as(` (a second run).

The split, by line of db/62:

| lines | stays in `decide_role_request()` | moves to `role_request_grant_as()` |
|---|---|---|
| 183-189 | the lookup, `already_decided`, the caller's authority (`app_can` + `app_may_grant_at`, as db/77 scoped it) | |
| 190-193 | the decline branch (`decided_by = app_user_id()`) | |
| 194-226 | | `v_player`, `v_team`, `team_required`, `player_not_at_that_school`, `player_required`, the guardian age rules |
| 227-243 | | the `role_assignment` INSERT and the subject rows, with **`app_user_id()` → `p_decider` at 231, 236, 241 and 242** (`verified_by`, `created_by`) |
| db/81:685-686 | | the school seam, unchanged |
| 244-245 | | the final UPDATE, with **`app_user_id()` → `p_decider`** as `decided_by`, and `p_note` as the note |

`decide_role_request()` ends `RETURN QUERY SELECT * FROM role_request_grant_as(p_request,
app_user_id(), p_note, p_player, p_team)`. The new function has **no EXECUTE for `scrbrd_app`**
(internal, as db/81:719-721 keeps its helpers): each of its two callers has already established
authority — the office's for itself, the register's for the uploader — before it passes a
decider. The in-file check asserts that nothing but those two callers names it, in the shape of
db/77:484-488.

Why factor rather than copy: the 140 doc's §8 (lines 497-498) made `decide_role_request()` the
only door a grant goes through, and the parent doc already named the shape (lines 383-385). A
copy would drift at the next guardian rule, as db/62 itself shows a rule that had to be added
in two places (db/62:171-178).

### 2.2 What is granted at once, what stays a request

`register_claim(p_school)`, for each matched row in `id` order, inside one transaction:

1. **Re-check the uploader, now.** `app_user.active` for `uploaded_by`, `app_may_assign_at_for(uploaded_by, school)`
   and `app_may_grant_at_for(uploaded_by, row.role, school)`. If any is false → step 4 with
   `outcome_reason = 'uploader_authority_lapsed'`. A departed office's list grants nothing.
2. **Write or reuse the request.** `INSERT INTO role_request (person_id, school_id, role,
   team_code, note)` with the note `from the staff register, row <id>, uploaded <date>`; if the
   person already has an open request for that role at that school (the existing one-open
   index), reuse it and append the note.
3. **Grant through the door.** `role_request_grant_as(request, row.uploaded_by, <the note>, NULL,
   row.team_code)`. On `ok` → `outcome = 'granted'`. A refusal answered by the body
   (`team_required` cannot happen — §1.3 refused the row), or a `check_violation` raised by any
   trigger on `role_assignment` (the pupil-consent trigger does not fire here; SAFEGUARDING §5's
   future trigger would) → caught, the sub-block rolled back, step 4 with `'refused'`.
4. **Fall back to a request.** The request stays `pending`; the row is consumed with `outcome =
   'requested'`. Someone at the school decides it by hand, and that decision runs the same
   body with the same rules.
5. **Record.** `register_log('register.claim', school, ARRAY[row.id])`; and one `notification`
   (§2.3) per claim call, listing what was granted and what was only requested.

The person reads one of two sentences, chosen only by whether anything was granted: "You're in.
The office listed you as Coach (U14A) and Scorer." or "Your request has gone to the school
office." The second is the sentence a no-match reads, so a refused claimant learns nothing from
it (140 §6's "same answer either way", line 419).

### 2.3 The audit trail

| record | what it holds |
|---|---|
| `school_register` row | who listed whom, as what, when; who claimed it with which identity; the outcome and the request |
| `role_request` row | `state = 'granted'`, `decided_by = uploaded_by`, `decided_note` naming the row and upload date; or `pending` with the same note |
| `role_assignment` row | indistinguishable from a hand grant — on purpose (P2-D6) |
| `access_log` | `register.upload` (the upload id and row ids), `register.claim`, `register.withdraw`, `register.redact` |
| `notification` to the office | kind `system`, scope `school`, `required_capability = 'user.role.assign'`, no `recipient_id`, title "Joined from the staff register", body "{name} joined as {role_words(role)} ({team}) today, from the row {uploader} uploaded on {date}. If this is wrong, end the role on People." — db/77:406-415's shape and `role_words()` (db/77:270-283) |
| `role_assignment_ending` | the undo, as today (db/77:418-420) |

**`linked_how = 'register'` is not written (P2-D9).** The CHECK allows it (db/81:182) and the 140
doc's step 3 (line 386-387) asks for it, but by the time a row is claimed the identity already
exists with its honest `linked_how`. Rewriting it would say the register linked the sign-in,
which it did not. `claimed_identity` records which identity matched; the value stays in the
CHECK for phase 3's pupil register, which may link at the exchange.

---

## 3 · The suspended-person proof

The 140 doc's phase 2 proof "a suspended person is refused" (line 512) and §6's row (line 422)
rest on `safeguarding_suspension` and a `role_assignment_write` trigger (SAFEGUARDING_DSO.md:
569-585). Neither exists: db/57's header (lines 10-12) names suspension as a later phase.

Three ways through, weighed:

| option | verdict |
|---|---|
| Make phase 2 wait for the suspension phase | **No.** It couples a register to a safeguarding phase with its own Fable brief and Kameel decisions; the register's own risks are bounded without it |
| Write a minimal check against what exists | **Yes, as P2-D4 already does:** any `active` assignment at the school refuses the claim, and `duty_suspension` pauses an *active* assignment (db/77:126-127), so a duty-suspended person cannot take a fresh role through the register. `db/99` proves it |
| Defer the safeguarding proof, named | **Yes, as an obligation (P2-OB1):** the suspension migration must add a `db/99` section "a register row for a person under an open `safeguarding_suspension` at the school is consumed as `requested`, not granted", and must re-emit `app_may_grant_at_for()` beside `app_may_grant_at()` with the same new clause |

Why the inheritance is real and not hoped for: the register grants only through
`role_request_grant_as()`, which writes `role_assignment` (db/62:227-228). SAFEGUARDING §5's
trigger refuses that INSERT for a suspended person (line 584-585); §2.2 step 3 catches the
`check_violation` and falls back to a pending request, which the same trigger refuses the office
too. To keep the two authority functions from drifting, `db/92`'s in-file check asserts that
`app_may_grant_at_for()`'s source is `app_may_grant_at()`'s with the one substitution and the
pad clause removed, so a later re-emit of one without the other refuses to apply.

---

## 4 · The D7 notice and the cooldown (`db/93`)

Both were decided (D7, 140 doc line 544) and neither has a phase or a table: `request_cooldown_until`
and the declined-guardian notice exist nowhere. They go in **phase 2, as `db/93`**, after
`db/92`, so the register is not held by them and they are not held by it (P2-D17).

### 4.1 The notice

**Trigger.** `AFTER UPDATE OF state ON role_request`, when `NEW.state = 'declined'` and
`NEW.role = 'guardian'`: that is the `decide_role_request()` decline branch (db/62:190-193)
whatever route called it. And, as a refinement in D7's own reasoning, `pending_claim_decline()`
(db/81:601-614) when the account claimed is a pupil's (`person_is_pupil`, db/57:600) or holds a
`guardian` assignment: a stranger's Google sign-in reaching for a child's or a parent's
account, declined.

**The notice.** `INSERT INTO notification (school_id, scope_level, kind, urgency, title, body,
required_capability, is_public)` with `kind = 'safeguarding'`, `required_capability =
'safeguarding.concern.read'` (held by `dso` and nobody else, db/57:16-18), title "A parent claim
was declined", body "A request to be linked to a child at your school was declined by the office
on {date}. The office can tell you who asked. If anything about it concerns you, raise a
concern." **No child's name** (the free-text description in the request's note is never copied),
**no claimant's name**, no email. `recipient_id` is NULL (the DSO fan-out is by capability; the
no-pupil-recipient trigger at db/57:597-609 is untouched). The writing function is `SECURITY
DEFINER`, which is how a `safeguarding`-kind row gets past the RESTRICTIVE insert cut at
db/57:588-590 that stops the application writing one.

Not "open People to see it" (140 §6, line 420): a DSO holds no `user.role.assign` (D9) and
`role_request_read` would show him nothing (db/81:666-670). The DSO asks the office, or raises a
concern, which anyone signed in may do (db/57:22-24).

### 4.2 The cooldown

```
request_cooldown (
  id uuid PK, person_id uuid NOT NULL → app_user,
  set_at timestamptz NOT NULL DEFAULT now(), until timestamptz NOT NULL,
  reason text NOT NULL CHECK (reason IN ('repeated_declines', 'many_schools')),
  school_ids uuid[] NOT NULL,                           -- where the declines were; who may lift
  lifted_at timestamptz, lifted_by uuid → app_user, lift_note text,
  CONSTRAINT lift_whole CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
)
UNIQUE INDEX request_cooldown_one_open ON request_cooldown (person_id) WHERE lifted_at IS NULL AND until > now();
```

- **Rule.** In the same trigger as §4.1: when this person's declined `guardian` requests in the
  last thirty days reach **three**, or their `guardian` requests in thirty days span **more than
  two schools**, insert a cooldown `until = now() + 30 days`, and write §4.1's notice to the DSOs
  of every school in `school_ids` with the body "An account has been paused from asking after
  repeated declined parent claims at your school."
- **Effect.** `BEFORE INSERT ON role_request`: an open cooldown for `person_id` raises
  `check_violation 'request_cooldown'`; the API turns it into "You can't send a request right
  now. Ask the school office." It is the person's own account state, so saying so reveals
  nothing about anyone else. A trigger, not a policy, so it holds whichever route inserts
  (`onboard_request()`, `POST /api/requests`).
- **Who lifts (P2-D12, Kameel decides).** `request_cooldown_lift(id, note)` under
  `safeguarding.concern.manage` at a school in `school_ids` — a DSO there. Not the office: D7's
  reasoning is that a stranger claiming a child is a safeguarding matter before it is an IT one,
  and the office is the party whose declines set it. The owner's key holds no `safeguarding.*`
  (db/57:20) and cannot lift it either. It expires on its own at thirty days.

---

## 5 · The screens, described

Floors throughout: nothing under 12px, nothing tapped under 44px, `prefers-reduced-motion`
honoured, the existing tokens (CLAUDE.md). No new dependency.

**Settings → Import → Staff register** (the Import screen's pattern, PILOT_LOAD.md:138-143:
Check, then Import only after a clean Check of the same file). Two ways in: a CSV with the
`staff.csv` columns (`name, email, role, team_code, valid_until`; PILOT_LOAD.md:151-152 says the
template already matches), or one row typed into a form with the same fields, the role a list of
what *this* uploader may grant here, the side a list of the school's teams. The Check report is
a table, one line per row, with the problem in words: "Row 4: 'Principal' is not a role you can
list here." / "Row 7: a coach needs a side." / "Row 9: medical staff are added from People." /
"Row 12: already Scorer here — add a role from People." Warnings carry a checkbox: "Ended 3 Sep
(Coach, U14A). List anyway?" — Import stays disabled until every warning is ticked. A one-line
rule above the table: "Adults who work at the school. Never a pupil, never a parent."

**The register list** (same screen, below): filters Open · Claimed · Expired · Withdrawn; each
row shows name, email, role and side, claim-by date, who uploaded it and when, and its state in
words ("Open until 31 Mar", "Joined 14 Oct", "Requested instead — the uploader may no longer
grant Coach here", "Expired", "Withdrawn 2 Nov by …"). Withdraw on open rows (44px, confirm in
words). "Clear N expired rows" when `register_redact_due()` is not empty.

**People**: an assignment that came from the register carries "from the staff register, listed
by {uploader} on {date}", read from the request's note, beside the existing **End role** button
(`role_assignment_end()`, db/77:287). Nothing else changes.

**The signing-in staff member**: the join screen (shown when `app_enrolled()` is false, §1.5):
Choose school → "I work at the school" → before any role is offered, the client calls
`POST /api/join/register-claim {schoolId}`. Granted: "You're in. The office listed you as Coach
(U14A) and Scorer." and the app reloads into the school. Nothing granted: the existing request
form (joinSchool.js:29-36, `STAFF_ROLES`) and, on sending, "Your request has gone to the school
office." Mixed: "You're in as Scorer. Your Coach (U14A) request has gone to the school office."

**The DSO**: nothing new; §4.1's notices arrive in the existing stream under the
`safeguarding` kind.

---

## 6 · The pilot (P2-D16, Kameel decides)

PILOT_LOAD.md:147-152 leaves bulk staff enrolment as Kameel's call and notes staff "could instead
wait for the SCRBRD-140 phase 2 register". The code freeze runs to 15 October; phase 2 cannot
ship before it, and schema ships before code (DEPLOYING.md:1150).

**Recommend: the pilot's staff use phase 1 as built.** Each signs in with Google, picks the
school and asks for a role (joinSchool.js); the office grants from Requests, one tap per head,
which for a dozen people is a dozen taps on one afternoon. Staff the office already enrolled
by hand sign in through Claims (db/81:466-470 → `pending_claim_confirm()`, db/81:572). No bulk
staff import is built before the pilot: a staff import under `enrol_person()` would be a third
grant path a week before go-live, and the register makes it unnecessary. The pilot then tells
us whether the office wants the register at all, and the dozen rows are its first upload.

---

## 7 · Abuse, the phase 2 rows

| threat | what stops it |
|---|---|
| Probing the register with other people's addresses | only the caller's own verified identities match (§1.4); the answer is one of two sentences, the second shared with no-match (§2.2) |
| A stale list granting after the office changed | the uploader is re-checked at claim (§2.2 step 1); rows expire; a row claims once; withdrawal |
| A row for a child, or a parent | the CHECK; `person_is_pupil` at claim; guardian rows refused with a sentence that says where parents are linked |
| A mistyped email reaching a sensitive bundle | the ceiling (P2-D3) |
| A paused person taking a new role | any active assignment at the school refuses the claim (P2-D4); the safeguarding suspension inherits through the door (§3) |
| A stranger learning who works at a school | the register is read by `user.role.assign`/`audit.read` at that school only; the upload never speaks of accounts at other schools |
| Repeated parent claims | the D7 notice; the cooldown (§4) |
| A stolen session token | gains the account's own pending grant and nothing more (§1.4) |

---

## 8 · The build plan

Migrations are numbered from the next free file, `db/92`; `db/01` and `db/09` never move
(DEPLOYING.md:1100-1119); `db/99` is never ledgered and takes every new section
(DEPLOYING.md:1121-1124). Tiers per CLAUDE.md: SQL, RLS, policy and anything touching minors'
data to Opus; screens to Sonnet; the ground map and the doc updates to Haiku.

| # | item | tier |
|---|---|---|
| 1 | **Haiku maps the ground**: `role_request`'s unique open-request index and the route that inserts it; `templates/staff.csv`'s header; the join screen's routing condition; `season`'s end-date column; the notification fan-out by `required_capability` (db/89, db/91); `role_assignment`'s team constraint | Haiku |
| 2 | **`db/92_staff_register.sql`** (Opus): the table and indexes; `app_may_grant_at_for()`, `app_may_assign_at_for()`; the md5-guarded factoring of `role_request_grant_as()` out of db/81's patched `decide_role_request()`; `register_upload()`, `register_claim()`, `register_withdraw()`, `school_register_rows()`, `register_redact_due()`/`register_redact()`, `register_log()`; grants and revokes as db/81:709-739; in-file checks: RLS on and no privilege, `_for` mirrors `app_may_grant_at()`, only two callers of `grant_as`, every function pins `search_path`; `services/api/expected-migrations.json` | Opus |
| 3 | **`db/93_declined_claim_notice.sql`** (Opus): the §4.1 trigger and writer; `request_cooldown`, its triggers and `request_cooldown_lift()` | Opus |
| 4 | **`db/99` sections**: a row by an uploader who lost `user.role.assign`, or lost the grant of that role, is consumed `requested` and grants nothing; a `guardian`, `player`, `dso` or platform row is refused at upload; a row for a role over the ceiling is refused; a claimed row cannot be claimed again; two open rows for one email at one school both grant in one call; a person with an active, duty-suspended assignment at the school cannot claim; a pupil's account cannot claim; a code-only account (no identity) matches nothing; `app_user.email` alone never matches; a hand grant through `decide_role_request()` still writes `decided_by = app_user_id()` and still refuses the unauthorised caller; the register is unreadable to a coach, a parent, a DSO, a pad and a school-less account; a declined `guardian` request writes exactly one `safeguarding` notice readable by the DSO and not by the office, with no name in it; the third decline in thirty days opens a cooldown that refuses the next request; the owner's key is never claimable through the register | Opus |
| 5 | **API**: `POST /api/register/:schoolId` (check/commit), `GET /api/register/:schoolId`, `POST /api/register/rows/:id/withdraw`, `POST /api/register/:schoolId/redact`, `POST /api/join/register-claim`, `POST /api/cooldowns/:id/lift`; the People read gains the request note | Opus (authority on every route) |
| 6 | **API walk** `tools/smoke-register-staff.mjs` (named apart from the officials' `smoke-register.mjs`), in `smoke-end-role.mjs`'s shape: upload as the office; claim as a fixture Google identity; assert the squad appears on the next read; end it; claim again and assert `requested`; end the uploader's role, upload fresh, claim, assert `requested`; decline a guardian request and assert the DSO's notice has no name | Opus |
| 7 | **Screens**: Settings → Import → Staff register (check, warnings, import, list, withdraw, clear); the join screen's claim step and three sentences; People's origin line; the join screen's `app_enrolled()` trigger | Sonnet; Opus reviews the join screen's sentences for enumeration |
| 8 | **Browser walk** `tools/smoke-browser-register.mjs`: a bad row's problem is shown in words; Import disabled until the warning is ticked; the signing-in coach sees "You're in" without choosing a role; the register is absent from a coach's Settings | Sonnet |
| 9 | **Docs** (Haiku, after Kameel decides): the 140 doc's §10 list below; `DEPLOYING.md`'s paste list for `db/92`/`db/93`; the roadmap and gap-analysis rows; PILOT_LOAD.md:147-152's note | Haiku |
| 10 | **Review** of 2-6 before merge: security review, and the `_for` mirror check broken on purpose and seen to fail | Opus |

Order: 1 → 2 → 4 (the `db/92` sections) → 5 → 6 → 7 → 8, with 3 and its `db/99` sections
beside 2 or after, as Kameel decides (item 5 at the top). Nothing merges before 15 October.

---

## 9 · Decisions and assumptions

### 9.1 Decisions

| | decision | recommendation | why, in one line |
|---|---|---|---|
| **P2-D1** | One row, one grant; a claim takes every open row for that email at that school | **Yes** | the office listed three grants; one sign-in |
| **P2-D2** | What matches | **live `auth_identity.email_at_link`, lower-cased, exact; never `app_user.email`** | a verified address is one a provider attested, not one the office typed |
| **P2-D3** | A ceiling on roles the register may grant | **Refuse roles holding `medical.details.read`, `discipline.read` or `safeguarding.*`, read from `role_capability`** — *Kameel decides* | a mistyped email should cost availability, never a child's clinical notes |
| **P2-D4** | Who may claim | **Any signed-in account with no `active` assignment at the school** (paused counts as active) | the register is the first door; a second role is the office's one tap; no walking round a pause |
| **P2-D5** | A claim that cannot be granted | **Consumed as `requested`; an ordinary pending request; the same sentence as no-match** | nothing is learned from the refusal; the office decides with the same rules |
| **P2-D6** | `valid_until` | **The claim window only; the assignment is open-ended as a hand grant is** | a register grant and a hand grant are the same row; End role is the office's lever |
| **P2-D7** | The grant body | **Factor `role_request_grant_as(request, decider, …)` from db/81's patched `decide_role_request()`, md5-guarded; internal, two callers** | one door; a copy drifts |
| **P2-D8** | The uploader at claim time | **Re-checked with `app_may_assign_at_for()` and `app_may_grant_at_for()`, mirror-guarded against db/77's body** | a departed office's list grants nothing; the mirror cannot drift silently |
| **P2-D9** | `linked_how = 'register'` | **Not written in phase 2**; `claimed_identity` records the match | the identity existed before the claim; the value waits for phase 3's pupil register |
| **P2-D10** | The suspended-person proof | **Prove `duty_suspension` and P2-D4 now; name the `safeguarding_suspension` proof as P2-OB1 on that migration** | the table does not exist; the inheritance is through the one door |
| **P2-D11** | The D7 notice | **Trigger on a declined `guardian` request, and on a declined claim of a pupil's or a guardian's account; `safeguarding` kind; DSOs only; no name; "ask the office", not "open People"** | the DSO cannot read requests and should not |
| **P2-D12** | The cooldown | **Three declines, or more than two schools, in thirty days → thirty days; a trigger refuses new requests; a DSO at an involved school lifts it** — *who lifts: Kameel decides* | a safeguarding matter before an IT one |
| **P2-D13** | Retention of unclaimed rows | **Redact name and email ninety days after expiry or withdrawal; keep claimed rows as grant audit** — *Kameel decides as information officer* | PI about people who never signed in |
| **P2-D14** | Who reads the register | **`user.role.assign` or `audit.read` at the school, through functions; no policy; never the claimant, a pad or the public** | adults' work emails, one school's business |
| **P2-D15** | When the join screen shows | **When `app_enrolled()` is false, not when `school_id` is null** | the ex-coach kept his `school_id`; the warning needs a path |
| **P2-D16** | The pilot's staff | **Phase 1's path; no bulk staff import before 15 October** — *Kameel decides* | a dozen taps on one afternoon; no third grant path in freeze week |
| **P2-D17** | Files | **`db/92` the register; `db/93` the notice and cooldown; neither before the pilot** — *whether `db/93` ships beside `db/92`: Kameel decides* | each can wait without holding the other |

### 9.2 Assumptions

- **A-P2-1** The `season` table (db/08; its read policy at db/81:129) carries an end date the
  default `valid_until` can read; if not, the default is the uploader's typed date and the
  screen asks for it.
- **A-P2-2** `templates/staff.csv`'s header is `name, email, role, team_code, valid_until` or
  a superset of it (PILOT_LOAD.md:151-152); Haiku confirms in step 1.
- **A-P2-3** `role_request` has one unique index on open requests per person, role and school
  (140 doc line 424); step 2 reuses the row it protects.
- **A-P2-4** The route behind `POST /api/requests` inserts `role_request` under RLS or through
  `onboard_request()`; a `BEFORE INSERT` trigger covers both, so the cooldown needs no route
  change beyond the error's words.
- **A-P2-5** Notification fan-out honours `required_capability` with a NULL `recipient_id`, as
  the db/77 notice relies on (db/77:406-414) and the db/89 contract describes.
- **A-P2-6** `person_is_pupil(uuid)` (db/57:600) answers for any account, not only at the
  caller's school, inside a `SECURITY DEFINER` function.
- **A-P2-7** The pilot school's staff each hold a Google account the office can list (140 A3).
- **A-P2-8** The join screen's routing can be keyed on an `app_enrolled()`-shaped answer from
  the session profile; if the profile does not carry one today, it gains that one boolean.
- **A-P2-9** Nothing in the client reads `auth_identity.linked_how = 'register'` yet, so leaving
  it unwritten breaks nothing.

---

## 10 · What this supersedes in the 140 doc

Haiku records these after Kameel decides, word for word:

| where | stale text | now |
|---|---|---|
| line 3 (status) | "nothing here is built yet" | phase 1 built and shipped as `db/81` (and `db/85`'s sessions); phase 2 designed here |
| §8, lines 487-488 | the token is `{iss, aud, sub, did, iat, exp}` and "`signToken()` and `verifyToken()` are not edited" | db/85 added `sid` and `sep`; a token without them is `401 incomplete_claims` (AUTH_SPEC.md:39-42) |
| §5.2 sketch, lines 344-355 | `season text`; `valid_until` "until when" | no `season`; `valid_until` is the claim window (P2-D6); the added columns of §1.1 |
| §5.2 step 1, lines 373-378 | "Opus adds a `_for(person)` variant … or reads `role_assignment` and `role_grantable` directly" | the two `_for` functions of §1.9, mirror-guarded (P2-D8) |
| §5.2 step 3, lines 386-387 | "writes the identity `linked_how = 'register'`" | not written; `claimed_identity` instead (P2-D9) |
| §5.2 step 4, lines 388-390 | the notice text | §2.3's text, with the uploader and the undo named |
| §6, line 420 | the DSO notice says "open People to see it"; the cooldown is `request_cooldown_until` | "the office can tell you who asked"; the `request_cooldown` table (§4) |
| §6, line 422 | "`role_assignment_write`'s trigger refuses (SAFEGUARDING_DSO §5)" | not built; P2-D4 now, P2-OB1 on the suspension migration (§3) |
| §9, line 512 | phase 2's proof "a suspended person is refused" | the `duty_suspension` and active-assignment proofs; the safeguarding one deferred, named |
| §9, line 513 | "the D7 DSO notice" under Sonnet screens | a trigger and a notice: `db/93`, Opus (§4, §8) |
| D4, line 541 | the register's exclusions | plus the sensitive-bundle ceiling if Kameel takes P2-D3 |

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `auth_identity`, `email_at_link`, `linked_how` CHECK | db/81:172-190 | the match (§1.4); why `'register'` is not written (§2.3) |
| `auth_identity_sign_in()`'s `claim_required` path | db/81:466-470 | why already-enrolled staff do not come through the register (§6) |
| `auth_identity_link_self()` | db/81:484-529 | a changed Google email reaches a row (§1.4) |
| `pending_claim_decline()` | db/81:601-614 | the second trigger site for the D7 notice (§4.1) |
| `app_enrolled()` | db/81:88-108 | the join screen's trigger (§1.5); the liveness clauses the `_for` functions copy |
| `auth_identity_log()`, `access_log`'s columns | db/81:381-385 | `register_log()`'s shape |
| the md5-guarded re-emit and its hash | db/81:674-706; db/77:148-179 | the factoring's guard (§2.1) |
| the grants-and-revokes block | db/81:709-739 | every new function's rights |
| `app_may_grant_at()` | db/77:116-138 | per-row authority at upload; the body `_for` mirrors |
| `role_assignment_end()`, its notice, `role_assignment_ending`, `role_words()` | db/77:287-423, 270-283 | End role beside a register grant; the notice's shape; the twelve-month warning's source |
| the "no unscoped `app_may_grant()`" check | db/77:484-491 | the shape of `db/92`'s "only two callers" check |
| `decide_role_request()` as db/62 wrote it | db/62:179-247 | the body to factor, after db/81's seam |
| `person_is_pupil()`, the no-pupil-recipient trigger, the `safeguarding` insert cut, the DSO's capabilities | db/57:597-609, 588-590, 16-18 | the pupil refusal at claim; the D7 notice's kind and reader |
| `safeguarding_suspension` and the write trigger, designed and not built | SAFEGUARDING_DSO.md:560-589; db/57:10-12 | §3 |
| the Import screen's check-then-import pattern; the staff import left as Kameel's call | PILOT_LOAD.md:138-143, 147-152 | the upload screen (§5); the pilot (§6) |
| the join screen's rules and `STAFF_ROLES` | joinSchool.js:12-27, 29-36 | what the claim step sits in front of |
| `sid` and `sep` on the token | AUTH_SPEC.md:39-42 | why no fresh `auth_time` is needed; the stale §8 line |
| the sensitive splits; never union | ADR 0001:86-99, 45-57 | the ceiling (P2-D3); two separate authority questions at claim |
| a title is not a role | ADR 0003:8-11 | no new role and no new capability anywhere here |
| the signed privacy paragraph | SIGNIN_PRIVACY_NOTICE.md:4, 11-22 | unchanged: the register adds nothing Google holds; the retention rule (§1.8) is SCRBRD's own notice to amend if Kameel takes P2-D13 |
| frozen files, the verifier, the procedure | DEPLOYING.md:1100-1150 | `db/92`, `db/93`, `db/99`, schema before code |
