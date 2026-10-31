# Platform controls: what a SuperAdmin may switch on and off

Status: **design, decided** (Fable, 31 Oct 2026). Kameel answered all 18 questions "as recommended" on the Build Board, 31 Oct 2026 12:17 SAST. Opus builds from it in the slices of §9.
Added to Fable's list by Kameel on 31 Oct: "as a SuperAdmin or platform administrator ... switch on and
off different features or access to people or schools ... based on various reasons and situations."

Written from Haiku's map of 31 Oct (`MAP_platform_controls.md`) and the ranges the brief named. Where the
map leaves a question open, §11 says what this design assumes and Opus confirms it before building.

---

## 0 · In one page

SCRBRD has **one real switchboard today**: the feature flags (db/08). A platform default, a per-school
grant, a school's own hide. It is well built: a school can only hide, never grant itself anything; an
unknown key is off; the gate is in the database. Everything else the brief asks for is **missing or lives
on Render**: no way to pause or archive a school (`school.archived_at` is a column nobody writes), no
freeze, no read-only mode, public pages switched by an environment variable and a redeploy, a school's
front-page listing only the school can touch, and a Modules screen that gives the platform no school to
grant to. Every switch that exists records who and when; only the school's hide records a history.

This design adds **four instruments and one log**, and keeps the shape db/08 got right: a platform switch
never widens anybody's access, and nothing a switch does is enforced by hiding a button.

1. **Features** (what exists, finished): the platform's grant gains a school picker, a required reason and
   an **expiry date** ("on until the plan lapses"), with the school's office told fourteen days before and
   on the day. Nothing is deleted when a module goes off.
2. **A school's standing**: `active`, `suspended`, `archived`. Suspending stops staff and the school's
   fixtures; it never stops a safeguarding concern reaching the DSO, a family or pupil reading their own
   record and changing their consents, a match already in progress, or a POPIA access request. One
   platform person may suspend for **seven days alone**; beyond that, and to archive, **two people**.
   Archiving ends the school's roles, hands the school its records, turns its children's names off the
   public pages for good, and starts the retention clocks. The principal is told the reason; staff,
   families and pupils are told the school is paused and that nothing is lost, never why.
3. **A freeze**, in three scopes: one match, one school, the platform. Writes in scope answer `frozen`,
   which the pad already treats as *hold and retry*: every ball stays on the phone and sends, in order,
   when the freeze lifts. Nothing is lost; nothing quarantines. INCIDENTS D12's `PLATFORM_MODE` variable
   stays as the backstop for the day the database itself is in doubt.
4. **Public pages from inside the app**: a platform-wide off switch that takes effect on the next request,
   and a **hold** on one school's listing. The platform may only take a school off the front page; only
   the school may put itself on. Consents are not touched.
5. **One control log**, append-only, for every switch above: who, what, from and to, why, when, and who
   seconded. The platform reads all of it; a school's auditor reads the rows about that school.

The **owner's key** is the hardest line in here. It reads every child at every school and, by its own
comment, nothing records that it did. That should not stand: first its reads are logged like a support
session's (now); then it stops at the schoolhouse door like `platformadmin` and reaches a school's records
only through a support session (after the pilot). That is the question that matters most (Q7).

**One SuperAdmin home** shows the live freezes first, then the clocks that are running (data events,
unseconded suspensions), then health, support sessions, lapsing grants, the schools, and the log. No
child's name is on it, and no count of concerns.

---

## 1 · Decisions

| # | decision | in one line |
|---|---|---|
| **D1** | Four kinds of switch: feature, standing, freeze, public | each has one table, one definer function, one reason, one row in the control log |
| **D2** | A switch never widens access | standing and freeze live in the liveness rule and the write path; a flag stays what db/08 says it is, never authorisation |
| **D3** | Every switch needs a reason of ten characters or more | db/90's rule; `feature_flag.reason` and `feature_grant.note` become required on change |
| **D4** | `feature_grant.until` (a date) | the grant lapses at midnight Johannesburg on that date; `feature_enabled()` tests it; the office is told at 14 days and on the day |
| **D5** | A school's standing is `active`, `suspended` or `archived` | `school.suspended_at` beside `archived_at`; the application role loses UPDATE on both (db/90's pattern); `school_set_standing()` is the only writer |
| **D6** | Suspension dead-ends every assignment at the school except the keep-list | the liveness rule in db/23 gains one test; the keep-list is `dso`, `guardian`, `selfaccess`, and a scorer's assignment on a fixture already in progress |
| **D7** | A suspension starts at stumps for a fixture in progress | no new fixture starts; a match under way finishes and closes; its pad keeps sending |
| **D8** | One person may suspend for seven days; two people for longer, to archive and to un-archive | a solo suspension lapses at day 7 unless seconded; re-suspending alone is allowed and shown as such |
| **D9** | The second is any other holder of `platform.tenant.manage` | the deputy of INCIDENTS §4.2 is given `platformadmin`; a school's principal may ask for a pause or an archive from inside the app, and the platform's confirmation is the second act |
| **D10** | Archive ends roles, exports, turns names off, starts retention | `role_assignments_end_all()` per person; the school's records handed to its information officer within 30 days; db/47's names-off at school level for good; the retention schedule of AL D22 runs from the archive date; purge is pressed by two people |
| **D11** | Families and pupils read their own record until purge | under suspension and after archive; their consent acts always work; their other acts wait |
| **D12** | A POPIA access request always lands and its clock always runs | the school's information officer answers if his account stands; the platform's answers otherwise |
| **D13** | One `freeze` table, three scopes | `match`, `school`, `platform`; a lift is an update, a new freeze a new row (db/08's suppression shape) |
| **D14** | A frozen write answers in the pad's *hold* class | the same class as `503 platform_read_only`, never the class that quarantines; handover refused with its own reason |
| **D15** | `PLATFORM_MODE` stays as the backstop | the API is read-only when either the variable or a platform-scope freeze says so; `/api/health` reports both |
| **D16** | Public pages: both the variable and the in-app switch must be on | `PUBLIC_PAGES` stays as the deploy-time guard (it also demands the pseudonym secret); the in-app switch is the daily one and takes effect on the next request |
| **D17** | The platform may only hold a school's listing off | `public_listing.held_by`/`held_at`; the school's "on" answers `held_by_platform`; the platform never lists a school |
| **D18** | Suspension does not touch consents or the public rule | the school's listing is held for the duration; fixture pages the other school lists stay; names follow consent as before |
| **D19** | The control log is append-only, one row per change | readers: platform roles; a school's `audit.read` for its own rows; never the person a per-person hide names |
| **D20** | The owner's key is logged now and cut to support sessions after the pilot | Q7 |
| **D21** | No new capability | standing, freeze and public use `platform.tenant.manage`; features use `platform.feature.manage`; a match freeze by the organiser uses the capability under which he confirms an amendment |
| **D22** | Disabling a school's person from the platform goes through a support session | AL D2 stands; the hour's role is `schooladmin`; the school's log shows it |
| **D23** | Unions, federations and leagues are out of this design | the mechanism will fit them; the keep-list for a union will differ (PDSO) and is decided then |

---

## 2 · Who holds what

| the switch | school's office | principal | `platformadmin` | `superadmin` | two people |
|---|---|---|---|---|---|
| Hide a module from the school or one person | yes | yes | yes | yes | |
| Platform default of a flag; lock it | | | yes | yes | |
| Grant or revoke a school's module, with a reason and a date | | | yes | yes | |
| The school's own front-page listing | yes (`broadcast.publish`) | yes | off only | off only | |
| Public pages, platform-wide | | | yes | yes | |
| Freeze one match | | | yes | yes | |
| Freeze one school; read-only platform | | | yes | yes | |
| Suspend a school, up to seven days | | ask | yes | yes | |
| Suspend beyond seven days | | ask | | | **yes** |
| Archive; un-archive | | ask | | | **yes** |
| Purge an archived school after retention | | | | | **yes** |
| Disable a person at the school | yes (`user.invite`) | yes | through a support session | yes (db/81) | |
| End a support session | yes | yes | the one who began it | yes | |
| Read the control log | its own rows (`audit.read`) | its own rows | all | all | |

"Two people" means two different holders of `platform.tenant.manage`. A principal's request from inside
the app counts as the first act for his own school; the platform's confirmation is the second.

Separation of duties, said plainly: **no one person can take a school off SCRBRD for longer than a week,
or for good.** Containment in the first hour (INCIDENTS D10) needs one person, so one person may suspend;
the seventh day is where it stops being containment.

---

## 3 · What never switches off

Whatever standing a school has and whatever is frozen:

1. **Raising a safeguarding concern, and the DSO's queue.** `dso` is on the keep-list; the concern
   function is on no freeze's write list. SAFEGUARDING §1 items 2 and 4 stand; the platform still reads
   none of it. An archived school's DSO assignment ends with the others; a concern raised after that
   routes to the PDSO as SAFEGUARDING Q2 says, and the reporter is told it did.
2. **A family's and a pupil's reads of their own record, and their consent acts.** `guardian` and
   `selfaccess` stay live under suspension and after archive, until purge. Withdrawing a consent, a
   twelve-year-old's "no" to his name, and a passport withdrawal (db/122) are never refused by a freeze.
3. **A match already in progress.** D7. Its scorer's one-fixture assignment stays live; its ball writes
   are accepted; the Match Centre keeps showing it. A freeze is the only thing that pauses scoring, and a
   freeze loses no ball (D14).
4. **A POPIA access request** (D12), and the clocks of INCIDENTS §5.
5. **Sign-out, `/api/health`, and the push worker's own reads** (INCIDENTS D12's list, kept).
6. **The audit log and the control log** are written through every state; nothing here can switch
   logging off. Where a restricted read cannot be logged it is refused, as INCIDENTS D18 already says.

---

## 4 · The instruments

### 4.1 Features (finished, not redesigned)

What db/08 has stands. Three additions:

- **A school picker for the platform** on Modules. `schoolsWhere()` is empty for a platform account by
  design (ModulesView :36–40), so the per-school column has no school to be about. The platform gets the
  full school list from a `schools` read, chooses one, and sees the three levels for it as a school
  administrator does: the platform default, this school's grant, this school's hides (read-only to the
  platform; `platformadmin` holds `school.feature.manage` and may hide, which stands).
- **A reason on every change** (D3), and **`until`** on a grant (D4). The sheet reads: *Grant {Module} to
  {School} · until {date} or "no end" · why (ten characters or more).* The lapse is a date, so the row
  reads alone; `feature_enabled(key, school, person)` adds `AND (g.until IS NULL OR g.until > current_date
  AT TIME ZONE 'Africa/Johannesburg')` on the grant branch. Nothing recorded in a lapsed module is
  deleted; it is shown again when a new grant is written.
- **Two notices to the school's office** (`required_capability` `school.feature.manage`): fourteen days
  before, and on the day. Words in §5.

`feature_flag` and `feature_grant` keep their current-state shape (a flag's history was never a question
anybody asked). Their changes go to the control log by trigger (§6).

### 4.2 A school's standing

**The states.** `active` (both columns NULL), `suspended` (`suspended_at` set), `archived`
(`archived_at` set). Archived implies nothing about `suspended_at`; an archive clears it.

**The door.** `school_set_standing(p_school, p_standing, p_reason)` and `school_second_standing(p_change)`,
both `SECURITY DEFINER`, `platform.tenant.manage` through `app_holds()` (no tenant to anchor on, as
`feature_flag`'s policies say). Refusals in order: `not_signed_in` · `not_permitted` · `no_such_school` ·
`reason_required` · `already_in_that_state` · `second_needed` (archive or un-archive by one person: the
row is written as *proposed* and nothing changes until seconded) · `cannot_second_your_own`.

**The record.** `school_standing_change` (id, school_id, standing, reason, changed_by, changed_at,
seconded_by, seconded_at, lapses_at, proposed boolean, notice ids). A solo suspension has `lapses_at =
changed_at + 7 days`; a second clears it. At `lapses_at` with no second, the next request that evaluates
the school's standing finds it lapsed and the school is active again (no job: the lapse is a comparison,
like db/22's hour hand). A school may be re-suspended alone; the home shows "suspended alone, 2nd time".

**What suspension does.**

| who | reads | writes |
|---|---|---|
| staff (every role not on the keep-list) | nothing of the school's; one screen (§5) | nothing |
| DSO | everything the role reads | everything the role writes |
| parent | her own children, as before | consents, the access request; the rest waits |
| pupil | himself (`selfaccess`); not the side (`player` is dead-ended) | his own consents |
| scorer on a fixture in progress | the sheet | balls, until the match closes |
| the other school | the shared fixture, as before | as before |
| the public | fixture pages the other school lists; the suspended school's listing is held | — |
| the platform | its reads as today (Q7 changes this) | the lift |

Fixtures after the suspension do not start: `match` state changes out of `scheduled` are refused
`school_suspended` for either side's fixture while a side is suspended. Notices from the school stop
(the writers are dead-ended). Lifts and the bus: the seats stand as records; nothing is voided, since
the fixtures simply do not happen; db/70's rule for a cancelled fixture applies if the office cancels.

**Lifting a suspension** is one person's act with a reason; it writes an `active` row. Nothing comes
back by itself except access: no session is minted, no notice is re-sent.

**What archive does** (two people, D10):

1. every assignment at the school that is not `guardian` or `selfaccess` is ended through
   `role_assignments_end_all()` with the reason "the school left SCRBRD on {date}"; the DSO's last, so
   the concern record's custody is written to the PDSO first (SAFEGUARDING §4.6);
2. the public listing is held and db/47's school-level names-off is set, for good;
3. every live scoring token at the school is force-released through the existing path (AL D19);
4. the retention schedule (AL D22) starts for every record kind that runs from "the school's tenure";
   the match record is kept for good (AL D8) and the Passport stays the boy's;
5. the school's information officer is handed an export within 30 days (the same shape as a POPIA access
   answer, for the whole school; the platform's officer signs it);
6. families and pupils keep reading until purge; the purge is pressed by two people from the due list.

**Un-archive** is two people; it restores nothing but the standing. Roles are appointed again, by the
recovery path if nobody at the school can.

### 4.3 A freeze

**The record.** `freeze` (id, scope in (`match`,`school`,`platform`), match_id, school_id, reason,
set_by, set_at, lifted_at, lifted_by), with db/08's lift-only trigger and partial unique indexes so one
scope is frozen once at a time. `freeze_set()` and `freeze_lift()` are definers; `platform.tenant.manage`
for every scope; the organiser's capability for `match` scope on a fixture in his competition.

**What it does.** Every write in scope answers `409 frozen` with the scope and the reason's first line,
except the never-off list (§3). In scope means:

- `match`: `ball_event`, innings and match state, handover, the squad on the sheet, for that fixture;
- `school`: every write anchored on the school, including its fixtures' scoring, by either side's scorer
  (the fixture is the school's too);
- `platform`: every write, as INCIDENTS D12 `read_only` describes, plus the variable's own cases.

The check is one function, `write_frozen(school, match)`, called from the API's write middleware (the
place D12 said Opus would build) and from `ball_event`'s insert trigger, so a fetch call does not go
round the middleware. STABLE, SECURITY DEFINER, indexed on the live rows; the cost is one indexed read per
write.

**The pad.** It must never lose a ball (the match-day fixes of 31 Oct). `frozen` is answered in the class
the pad already holds on: the ball stays `Held` / `On device`, the strip says why (§5), the scorer keeps
scoring. No token is revoked, so nothing quarantines. On lift, the pad's normal resend sends the held
balls in sequence; the server accepts them as the events they are, timestamps as recorded on the phone.
The Match Centre and the pavilion screen show "Scoring paused" over the last ball, not "live". Handover
is refused `frozen` with the sheet reading "no handover until it lifts" (D12's words).

**Lifting** is one person's act, by the one who set it or any other holder. No freeze lifts by itself: a
freeze that fell off during a breach would be worse than one that stood. Instead every live freeze is the
first thing on the home, with its age, and `/api/health` reports it so the keep-warm check (INCIDENTS P9)
emails when one has stood for more than 24 hours.

### 4.4 Public pages from inside the app

- **Platform-wide**: `platform_control` (key, value, reason, changed_by, changed_at), one row
  `public_pages` = `on`/`off`, under `platform.tenant.manage`. The public router checks `PUBLIC_ON AND
  platform_public_on()` per request (one cached read, refreshed every few seconds, falling closed: if the
  database cannot answer, the pages are off). Off means every public path answers 404 as today, and the
  pavilion screen shows one line (§5).
- **One school**: `public_listing` gains `held_by`, `held_at`, `hold_reason`. `public_listing_hold(school,
  on/off, reason)` under `platform.tenant.manage`. While held, `public_listing_set(school, true)` answers
  `held_by_platform` and the office's switch reads "Held by SCRBRD; ask us." The platform never sets
  `listed = true`.
- **Withdraw** in Match Details, db/47's names-off and the Render variable all stand; the production sheet
  (INCIDENTS §9.4) is rewritten to name the in-app switch first and Render second.

---

## 5 · The words people see

Never the reason to staff, families, pupils or the public. The principal, as the school's information
officer, is told the reason. Role names, never a person's name.

**Staff, on sign-in, suspended** (the only screen that loads):
> **{School} is paused on SCRBRD.** Your principal has been told why. Nothing you recorded is lost.
> You can still raise a safeguarding concern below, and your DSO's work carries on.
> *[DSO card]* · *[Raise a concern]*

**Staff, archived:**
> **{School} has left SCRBRD.** Your role here has ended. Nothing recorded was deleted today; the school
> holds its records. *[DSO card]* · *[Sign out]*

**Parent, suspended** (a notice, and a banner on her child's card):
> **{School} is paused on SCRBRD.** You can still see your child's record and change your consents.
> Fixtures, availability and notices from the school are paused until it is back. Nothing about your
> child is deleted.

**Parent, archived:**
> **{School} has left SCRBRD.** You can still see your child's record here until {retention date}, and
> change your consents. The school holds its own copy. Your child's name is no longer shown on public
> pages.

**Pupil** (any age): the parent's first two sentences, nothing more.

**Principal, suspended** (a notice and an email from the platform's information officer):
> **{School} was paused on SCRBRD on {date} by SCRBRD.** Reason: {reason}. It lifts on {date} unless
> confirmed; to talk to us: {contact}. Families and staff have been told the school is paused, not why.

**Principal, archived:** the same with "left" and the 30-day export date.

**Lifted:** "**{School} is back on SCRBRD.**" to everyone who was told it was paused.

**Pad, frozen:**
> **Scoring is paused** by {SCRBRD / the league}. Every ball you score is safe on this phone and sends
> when it lifts.

**App banner, platform read-only** (D12's words, kept): "SCRBRD is read-only while we fix something.
Scoring carries on on your phone and sends when we are back."

**Match Centre and pavilion screen, frozen:** "Scoring paused" in the place of "Live", the last ball
shown.

**Pavilion screen, public pages off:** "Not available right now." Nothing else; the public is owed no
reason.

**Office, a grant lapsing** (14 days before): "**{Module} switches off for {School} on {date}**, when
your plan ends. Nothing recorded in it is deleted; it is shown again when the plan is renewed." On the
day: "**{Module} is off for {School} from today.**"

**Office, listing held:** on the listing switch, "Held by SCRBRD; ask us." No reason on the switch.

---

## 6 · Logging

**The control log.** `control_change` (id, kind in (`feature_flag`,`feature_grant`,`feature_suppression`,
`standing`,`freeze`,`public_pages`,`listing_hold`), key or scope, school_id, match_id, person_id,
before jsonb, after jsonb, reason, changed_by, changed_at, seconded_by, seconded_at). Append-only: RLS
with INSERT only through the definer functions and triggers, no UPDATE or DELETE policy and no privilege.
Flags and grants write it by trigger on UPDATE and INSERT; everything new writes it inside its function.

**Who reads it.** `superadmin` and `platformadmin` read all of it (this is the platform's own record of
its own acts, not a school's access log, so INCIDENTS D22's narrowing of `platformadmin`'s `audit.read`
does not reach it). A school's `audit.read` holders read every row whose `school_id` is theirs: the
school must be able to see what the platform did to it. A person a per-person hide names never reads the
row (ModulesView's own rule). No child's name is in any row; `person_id` is an adult or a pupil account
id, drawn as a role on the screen.

**Retention.** Five years, with the audit log (INCIDENTS D17).

**The owner's key.** `superadmin` reads every child's record at every school and, by `roles.mjs`'s own
comment, nothing records it; `READERS_child_data` §2 repeats "unlogged". db/22's header suggests db/20
began logging platform-wide readers in read-api; which is true today is for Opus to confirm (§11). Either
way the design's answer is the same: **that must not stand.**

- **Step 1, now:** every read the owner's key makes that returns rows at a school is stamped in that
  school's `access_log` as a support session's is (`log_restricted_read()`), with the actor shown as
  "platform owner". The school's auditor sees it. The parent's view (INCIDENTS D20) shows "the platform"
  as the reader's role.
- **Step 2, after the pilot:** the key stops at the schoolhouse door. The RESTRICTIVE cut db/57 wrote for
  safeguarding is generalised to every table that holds a child's data (READERS §1's classes A–V), false
  for any platform-wide assignment. The owner reaches a school's records the way `platformadmin` does:
  `support_access_begin()`, one role, one school, one hour, every read logged, ended by the school if it
  wants. Recovery (appointing a principal where nobody is left) is a write on `role_assignment`, which
  the cut does not touch. INCIDENTS §4.2's "nobody checks him" becomes "the school's log checks him".

The cost of step 2 is real: during an incident the owner borrows a role instead of reading freely. The
support session is sixty minutes by default and four hours at most, which is the containment window. I
think that is the right price.

---

## 7 · One SuperAdmin home

One screen, `/platform`, for `superadmin` and `platformadmin`. In order of urgency, top to bottom; a
section that is empty collapses to one grey line so the first red thing is at the top of the phone.

1. **Frozen now.** Every live freeze: scope, school or fixture (by school code and date, no names),
   reason, age, who set it, *Lift*. Platform read-only from either source shows here too.
2. **Clocks running.** Data events past or near their clock (INCIDENTS §5); suspensions awaiting a
   second, with days to lapse; archive proposals awaiting a second; access requests the platform must
   answer (count and oldest, no names).
3. **Health.** API, database, push worker, keep-warm's last check, `PUBLIC_PAGES`, `PLATFORM_MODE`,
   expected migrations present.
4. **Support sessions live.** Who (role), which school, which role borrowed, ends when, *End*.
5. **Schools.** Every school: standing, listed or held, modules granted, grants lapsing within 14 days,
   last activity date. Tap for the school's page: standing acts, listing hold, its grants, its rows of
   the control log.
6. **Features.** Flags by kind with default, locked, reason and the count of schools granted.
7. **The control log**, newest first, filterable by school and kind.

Never on it: a child's name, a concern or its count, a reason a school gave for a hide (that is the
school's), the content of any record. The home renders no child's data, but it is complex frontend code
and goes to Opus (CLAUDE.md, 29 Oct).

---

## 8 · Questions for Kameel

Each with a recommendation; "as recommended" is an answer to any of them.

**Kameel's answer (31 Oct 2026, 12:17 SAST, Build Board): all eighteen as recommended.** Q7 in particular: the SuperAdmin key's reads of children's data are logged now (slice 6a), and after the pilot the key loses children's data and borrows a role through an audited support session (slice 6b). Q18 is deferred.

1. **Two-person rule.** One platform person may suspend a school for up to seven days; longer, archive
   and un-archive need two; a solo suspension lapses at day 7 unless seconded. **Recommend: yes.**
2. **Who the second is.** Any other `platform.tenant.manage` holder; the deputy of INCIDENTS §4.2 gets
   `platformadmin` for it. **Recommend: yes**, and name the deputy in writing as that design asked.
3. **The keep-list under suspension.** `dso`, `guardian`, `selfaccess`, and a scorer on a fixture in
   progress; everything else dead-ends. **Recommend: yes.**
4. **A match under way when a school is suspended finishes.** No new fixture starts; one in progress is
   scored to its close. **Recommend: yes.**
5. **Who hears the reason.** The principal, as the school's information officer. Staff, families, pupils
   and the public hear "paused", never why. **Recommend: yes.**
6. **Public pages under suspension and archive.** Suspension holds the listing and leaves consent alone;
   archive turns the school's children's names off for good, because nobody at the school remains to
   serve a withdrawal. **Recommend: yes.**
7. **The owner's key.** Log its reads now; after the pilot cut it from children's data by standing and
   make it borrow a role through a support session like `platformadmin`. **Recommend: both, in that
   order.** This is the question that matters most: it is the one place one person reads every child on
   the platform and no school can see him do it.
8. **An in-app read-only switch beside `PLATFORM_MODE`.** D12's variable stays as the backstop; the
   platform-scope freeze is the daily tool; the API honours either. **Recommend: yes.**
9. **Who may freeze one match.** The platform and the competition's organiser; a school's director of
   sport asks one of them. **Recommend: yes.**
10. **The platform may only hold a school's listing off, never list it.** **Recommend: yes.**
11. **Grants expire on a date,** the office told at 14 days and on the day, nothing deleted.
    **Recommend: yes.**
12. **Disabling a school's person from the platform** stays with AL D2: `platformadmin` borrows
    `schooladmin` for an hour through a support session; no new capability. **Recommend: yes.**
13. **A principal may ask for a pause or an archive from inside the app,** and the platform's
    confirmation is the second act. **Recommend: yes**, in slice 4.
14. **Archive hands the school an export within 30 days** and families read until purge; purge by two
    from the due list. **Recommend: yes.**
15. **Who reads the control log.** Platform roles read all; a school's `audit.read` reads its own rows;
    not narrowed by INCIDENTS D22. **Recommend: yes.**
16. **A reason becomes required on every flag and grant change** (today optional). **Recommend: yes.**
17. **No freeze lifts by itself**; the home and the keep-warm check nag instead. **Recommend: yes.**
18. **Unions, federations and leagues** are out of this design and get the same mechanism later with
    their own keep-list. **Recommend: defer.**

---

## 9 · Build plan, in slices

Each slice is one PR, pushed as it goes (CLAUDE.md's cadence). Haiku maps before each and records after.

| # | slice | tier | proof |
|---|---|---|---|
| 1 | **Control log and features**: `control_change`, triggers on flag and grant, required reason, `feature_grant.until` in `feature_enabled()`, the platform's school picker on Modules, the two lapse notices | Opus (schema, policy) | db tests: an unknown key off; a lapsed grant off at midnight Johannesburg; a school's `audit.read` reads only its rows; `tools/smoke-modules` grants with a date and sees the notice |
| 2 | **Public pages in-app**: `platform_control.public_pages`, the per-request check falling closed, `public_listing` hold | Opus (public rule, RLS) | public walk: pages 404 on the next request with the switch off; the office's "on" answers `held_by_platform`; the platform cannot set `listed = true` |
| 3 | **Freeze**: table, `write_frozen()`, middleware and `ball_event` trigger, pad's hold class, Match Centre "Scoring paused", handover refusal, `/api/health` and keep-warm | Opus (scoring, sync) | a solo-run walk: freeze mid-over, six balls held on the pad, lift, all six land in order with their phone timestamps; handover refused with its reason; `PLATFORM_MODE` still works alone |
| 4 | **Standing**: columns and privilege revoke, `school_set_standing()`/`school_second_standing()`, the liveness test and keep-list in db/23, the seven-day lapse, fixture start refusal, the notices and screens of §5, the principal's request | Opus (authorization, minors' data) | db tests per role under suspension (every READERS §2 reader); a concern raised at a suspended school reaches the DSO; a parent withdraws consent; a fixture in progress scores to close; a solo suspension lapses at day 7 in a clock-moved test; archive ends roles, holds listing, sets names-off, writes the retention start |
| 5 | **SuperAdmin home** `/platform` | Opus (complex frontend) | a11y and browser walks; `break-ui` with forty schools and ten live freezes; no child's name in the DOM under any fixture |
| 6a | **Owner's key logged** | Opus | a read by the key at a school lands in that school's `access_log` and the parent's view |
| 6b | **Owner's key cut to support sessions** (after the pilot) | Opus, then a Fable red-team on Kameel's say | a red-team reading list of every table in READERS §1; recovery still works with the cut in place |
| 7 | **Records**: DEPLOYING paste list, the production sheet and runbook pointing at the in-app switches first, backlog and roadmap rows | Haiku | the lead's review |

Order: 1 and 2 are small and useful alone; 3 before 4 because suspension's "a match under way finishes"
leans on the freeze's hold class being proven; 5 after 3 and 4 have something to show; 6a any time; 6b
after the pilot and after Q7.

---

## 10 · Assumptions

1. Haiku's map is right: no suspension, freeze or read-only switch exists; `school.archived_at` has no
   write path; `PUBLIC_PAGES` and `ALLOW_DEV_LOGIN` are read at boot; the platform cannot touch a school's
   listing.
2. The pad's 31 Oct match-day fixes class a refused write by status and reason into *hold and retry* or
   *quarantine*, and a `409 frozen` can be placed in the first class without touching the second. If the
   pad quarantines on any 4xx today, slice 3 changes that first.
3. `ball_event` carries the phone's timestamp and a sequence, so held balls land in order after a lift.
4. The access-requests design (30 Oct) names the school's information officer as the answerer; D12 adds
   the platform's officer as the fallback and does not change who answers for an active school.
5. Whether db/20 already logs the owner's key's reads in read-api is unsettled between `roles.mjs`'s
   comment and db/22's header; Opus confirms before slice 6a, which is either new or a check that it holds.
6. A public fixture page is reachable through either school's listing; if only the host's listing shows
   it, D18's "fixture pages the other school lists stay" narrows to the host's and is still right.
7. `role_assignments_end_all()` (AL D15) and the force-release of a scoring token (AL D19) exist as
   named, and archive calls them rather than writing its own.
8. `competitionadmin` holds a capability under which it confirms an amendment; the match-scope freeze
   uses it, and Opus names it.
9. The deputy of INCIDENTS §4.2 exists as a person by the time slice 4 ships; until then every archive is
   a principal's request confirmed by the owner, which is still two people.
10. Nothing in this design changes `db/01` or `db/09` (DEPLOYING.md's frozen files); the liveness test
    goes in db/23's generated rule as db/22's `expires_at` did.
