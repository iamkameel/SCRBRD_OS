# Account lifecycle: the design

**Decided 2026-10-07 (Kameel): approved as recommended, D1–D24 and Q1–Q13; slice 1 (Disable and Enable on People, no migration) built now, the rest after the pilot.** Pulled forward 2026-10-08 (Kameel): slices 2–7 now, not after the pilot.

**Decided 2026-10-08 (Kameel), Build Board, answer "keep": slice 2 keeps all three calls as built.**

1. Who sees the date an account was disabled: People shows it only to readers holding user.invite or audit.read at the account's school; a reader with user.read alone (finance, sponsorship) sees "Disabled" with no date (design ref C8).
2. other_school: the offboard preview tells the account's OWN school office, before the tap, that the account also holds a role at another school (never which school); the disable itself still answers not_permitted (design §2.3, last row).
3. The person an account_status_change row is about can never read it, even when they hold user.invite or audit.read (stricter than the design's D4/§7/§8 wording).

Also noted, not built in slice 2: the pupil workload-module warning from §2.3 ("His daily check-ins stop…") moves to slice 3.

**Status:** for Kameel's review. Designed by Fable, 2026-10-07. Slice 1 (Disable and Enable on People) is built: #87, merged 2026-10-08. The rest is not built.
**Source:** `CLAUDE.md`; `docs/policy/PUBLIC_DATA.md`, `docs/policy/SIGNIN_PRIVACY_NOTICE.md`; `docs/AUTH_SPEC.md`,
`docs/spec-rbac-reconciliation.md` (G1, W1, A1); `docs/design/SCRBRD-132_end_a_role.md`,
`SCRBRD-140_signup_and_school_linking.md` (§3.3, §3.7, §3.8, §4), `STEP4_parent_pupil.md` (§3.3, §4, §9),
`GA-I20_parent_action_list.md` (§3.3–3.6, §4.3), `SCRBRD-124_lift_clubs.md` (§1.6, §2.2, §6.4),
`SAFEGUARDING_DSO.md` (§1, §4.2, §4.4, §4.5, §5); `packages/policy/src/roles.mjs`; `db/00` (`app_user`),
`db/01` (`app_can()`, `role_assignment` policies and triggers, `assignment_subject_read`), `db/09`
(`app_user_update`), `db/10`, `db/62`, `db/77`, `db/81` (`auth_office_refusal()`, `auth_identity_log()`),
`db/85`, `db/86`; `services/api/auth/signin-api.mjs`; `services/api/read/read-api.mjs` (the `users` read);
`apps/web/src/views/people.jsx`.
**Reader:** Kameel first. Then the Opus lead, who numbers the migrations and the `db/99` sections at build.
Sonnet builds the screens over routes that exist.

Every name in this document is invented. Rohan Pillay and his mother are the family STEP4 drew; Mr Botha,
Ms Adams and Mrs Naidoo are staff and parents who do not exist.

---

## 0 · In one page

An account has four layers, and today only two of them have an end anyone can reach from a screen:

| layer | what it is | how it ends today | gap |
|---|---|---|---|
| **the account** | `app_user`: can this person sign in at all (`active`) | `POST /api/auth/users/:id/disable` and `/enable` (db/85), **no screen**; People lists active accounts only, so a disabled one cannot be found again | **part 1** |
| **authority** | `role_assignment`: what they may do, where | `role_assignment_end()` (db/77), one role at a time, from People | staff leaving is five roles, three duties and a scoring token: **part 4** |
| **relationships** | `assignment_subject`: which child a parent reaches, and the consents the link carries | the child's 18th birthday (db/10, db/62), leaving school (db/62), `guardian_link_revoke()` (no screen), a `guardian` role ending (db/77) | the office cannot see a child's links; a pupil leaving has no door at all: **parts 2 and 3** |
| **the record** | `player`, his match events, his Passport, his file | never; nothing has a retention rule but lifts (db/76) and concerns (SAFEGUARDING §4.7) | **part 5** |

The design keeps the four layers apart and gives each its own door, its own audit row and its own words.
What it refuses to do is collapse them: **disabling an account does not end a role, ending a role does not
revoke a link, revoking a link does not touch the record, and nothing ever touches a match event.**

Six things to decide, said once:

1. **Disable is a sign-in matter, not a dismissal** (D1). It stops every session now and keeps every role.
   It is for a lost phone, a stolen credential, a person asked to step back while something is looked at. A
   person who has left gets their roles ended (db/77) and then, if nothing stands anywhere, the account
   disabled. One screen, "Off-board", does the roles first and the account last (D15).
2. **Who may disable is who may act on the account today** (`auth_office_refusal()`, db/81): `user.invite` at
   the account's school, and every live role one the caller could grant there. So the office cannot disable
   its principal, its director of sport, its DSO or its physio, and the DSO's and the owner's keys stay out of
   the office's hands. Nothing widens (D2).
3. **A pupil leaving is a roster act with one door**, `player_leave()`, under `player.profile.manage` (D7).
   It closes his memberships (db/62 then dates his parents' links by its rule), takes him off his side so no
   coach reaches his file by scope, refuses his selection, ends his `player` role and keeps his `selfaccess`:
   his record stays his to read. **His match record, his team-sheet history and his Passport do not move.**
   A new school on SCRBRD sees what the family lets travel (`passport_consent`, built) and nothing else (D9).
4. **The office gets a read of a child's links in every state** (`child_links`, D12), and a reason is
   recorded for every revocation, kept from the parent, kept from the public read (D13).
5. **Staff leaving is a preview, then acts that exist**: each role ended with db/77, the scoring token
   released, the duties re-linked, the concerns left with the DSO and the DSO told without a name (D16–D19).
6. **Retention is a schedule in the policy package** (D22), with the match record kept for good, the
   identity around it minimised after the school's period, and every deletion a logged act on a date it may
   not precede. A person may ask to see their own, correct it, close their sign-in, and, after the period,
   have the identity on their record minimised. **Score events are never deleted and never edited.**

The smallest slice that closes the solo test's "Disable account and Enable account" gap needs **no
migration**: an `accounts` read that includes inactive rows, and two buttons on People over the routes that
exist (§9, slice 1).

---

## 1 · The model

### 1.1 Plain words

A person is one `app_user` row. They prove who they are with a sign-in (a Google account, an office code).
They may do things because of role assignments. A parent reaches a child because of a link. A pupil is also
a `player` row, which is the school's record of him, and his match events are the shared record of what
happened on the field. Each of those has a state, and the states move separately.

### 1.2 The states

```
app_user.active            true ──disable──► false ──enable──► true
                                         └──erase (140 §3.8)──► false, tombstoned, never enabled again

role_assignment.active     true ──role_assignment_end()──► false            (never back: db/01 trigger)
                           (paused: duty_suspension db/34, safeguarding_suspension db/57 — active stays true)

assignment_subject         pending ──verify──► verified ──revoke / date out──► revoked | ended (valid_until)
                           (a re-established link is a new row: one open link per person per child)

player standing (derived)  enrolled ──player_leave()──► departed ──player_return()──► enrolled
                                                       └──after retention: minimised (D24)

match events               appended. Only ever appended.
```

### 1.3 The one rule that ties them

Every request becomes somebody through `app_session_begin()` (db/85), which refuses an inactive account.
Every row is reached through `app_can()` (db/01), which reads live assignments and live links. So:

- an **inactive account** reaches nothing because it has no session, and its roles and links are untouched;
- an **ended role** reaches nothing on the next statement, and the account signs in fine;
- an **ended link** means the parent's role reaches the other children and not this one;
- a **departed pupil** is a `player` row with no current side, which is what the coach's scope anchors on.

Nothing in this design adds a second way to ask any of those questions.

---

## 2 · Part 1: disable and enable an account

### 2.1 What disabling is for, and what it is not

**D1. Disabling stops sign-in and keeps everything else.** `account_set_active(user, false)` (db/85) sets
`app_user.active = false`; the trigger bumps the session epoch, so every token and every pad credential the
person holds is refused on its next request, and no new session is minted. Roles stay active, links stay
live, duties stay linked. A coach disabled on Friday is still the U15A coach on Saturday's duty card, and
cannot open the app to see it.

It is the right tool for: a phone lost with the app signed in (the office stops everything in one tap, the
person signs in again on a new phone after enable); a credential thought stolen; a person asked to step
back for days while the office looks at something that is not yet a safeguarding matter (which has its own
suspension, SAFEGUARDING §5, and its own holder, the DSO).

It is the wrong tool for a person who has left. Their roles must end, because a role is what the school says
about them to every reader (the team sheet, the duty card, the staff directory), and an inactive account
with a live coaching role is a lie the Squad screen tells for as long as nobody notices. Part 4 is the
leaving flow; it ends with a disable only when nothing stands anywhere.

*Rejected: disabling ends the person's roles.* A lost phone would cost a coach his appointment, and db/01's
trigger means the appointment can never come back; the office would have to appoint him again, with a new
`created_by` and a broken audit trail. *Rejected: disabling pauses roles (a `duty_suspension` on every
assignment).* That is what the DSO's safeguarding suspension is, and giving the office the same effect by a
different name blurs the one line SAFEGUARDING §5 drew.

### 2.2 Who may

**D2. The rule of db/81 stands, unchanged:** `auth_office_refusal(user)`. The caller holds `user.invite` at
the account's school; every live assignment the account holds is one the caller could grant at that school
(`app_may_grant_at()`, db/77; a pupil's `selfaccess` counts as `player`); an account holding any platform-wide
assignment is acted on only by a superadmin; never your own account (`cannot_disable_yourself`). Enabling
asks the same question, so the person who may switch it off may switch it on, and nobody else.

What that means, school by school:

| the account holds | who may disable or enable it |
|---|---|
| `coach`, `scorer`, `teammanager`, `player` + `selfaccess`, `guardian`, `spectator`, `driver`, `media`, … | the school office (`schooladmin`) and the director of sport, each only for the roles on their list in `GRANTABLE_ROLES` |
| `medical`, `fitness` | the director of sport (he appoints them); not the office |
| `directorofsport`, `sportsadmin`, `schooladmin`, `finance`, `sponsorship` | the principal |
| `dso` | nobody at the school: `dso` is grantable by the principal, but the principal holds no `user.invite`. The DSO's appointment ends through db/57 and db/77; their *account* is disabled by the owner on the principal's written request, or by nobody. See Q1 |
| `principal` | nobody at the school (no school role grants `principal`); the owner's key (Q1) |
| any role at a second school | nobody at the first school: the disable is refused `not_permitted`, because a live assignment stands that this caller could not grant. The first school ends its own roles (db/77) and leaves the account alone. **A coach at Hilton who is a parent at Westville keeps her account.** |
| a platform-wide role | a superadmin only (`superadmin_only`) |
| nothing (a school-less Google account, 140 §4) | `auth_office_refusal()` reads `app_user.school_id`, which is NULL, so only a platform-wide `user.invite` passes: the owner's key. See Q2 |

**`platformadmin` cannot disable a school's account.** It holds `user.role.assign` platform-wide and no
`user.invite`. That is right: disabling is the school's act on its own people. The platform's way in, when a
school has nobody who can act, is the support session (db/22), an hour as that school's office, every read
on the school's log. A platform role gains no school authority from being a platform role (db/86).

**Separation of duties, stated:** a person cannot disable themselves (built); the office cannot disable
anyone whose roles it could not have granted (built); the person who disables is on the audit row and the
person who enables is on another (built, `access_log`; §2.4 adds the reason row). Nothing here lets one
person both appoint a role and remove the only other person who could end it, because the second is refused
by the first's grant list.

### 2.3 A parent, a pupil, a coach: the same door, different consequences

**D3. One mechanism for every kind of account; the preview says what it cuts.** `account_set_active()` is
the same call for a parent and a coach. What differs is what is waiting in the data, and the office must see
it before it taps. A new read, `account_offboard_preview(user)` (§2.6), lists, without names of children:

| the account holds | the preview says |
|---|---|
| a live scoring token (`scoring_session` active or `handover_pending`, this person) | "Holds the scoring token for {fixture}, live now. Disabling ends the pad's credential (db/85) and the lease lapses; another scorer takes over or the office releases it." |
| pad credentials | "{n} phone(s) can still score without signing in; disabling ends them (`account_disabled` on the scoring audit)." |
| duties in the next 14 days (db/34) | "{n} match-day duties this fortnight; each card will read 'scorer needed' until re-linked." |
| a lift she drives in the next 14 days (db/70) | "{n} lift(s) offered; a disabled driver cannot mark the day. Nothing is cancelled by this; cancel them first or tell the families." |
| guardian links | "Linked to {n} child(ren) at this school. The links stay; the children stay registered. She cannot answer availability or lifts while disabled." |
| sessions | "{n} device(s) signed in; all end now." |
| roles at another school | "Also holds roles at another school. This account cannot be disabled from here." (the refusal, said before the tap) |

A **parent** disabled: her links stay verified, so her child is still `active` in `player_guardian_status`
and still selectable; her consents stand (they are records, not sessions); her lift seats stand (the link is
live), but she cannot confirm again or acknowledge a handover, so the office should expect "not acknowledged"
alerts on lift days (db/76). The screen says so. If the relationship itself is in question, the act is a link
revocation (part 3), not a disable.

A **pupil** disabled: his `player` and `selfaccess` roles stand; he cannot declare availability or check in;
his parent still can. The office is warned when the workload module is on: "His daily check-ins stop while
he cannot sign in."

A **coach** disabled: see the first three rows above. The one thing that matters on a Saturday is the
scoring token, and the preview names it.

### 2.4 The reason, and the audit

**D4. A reason is recorded for every disable, kept from the person.** db/85 writes `access_log` rows
(`auth.account_disabled`, `auth.account_enabled`) with the actor and the account and no words. A disable
is an act about a person that the office will be asked about, so it gets the shape db/77 gave a role's end:

```
account_status_change (
  id uuid PK, user_id → app_user, school_id → school (the account's, at the time),
  active boolean NOT NULL,                        -- what it became
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10 AND length(reason) <= 2000),
  changed_by uuid NOT NULL → app_user, changed_at timestamptz NOT NULL DEFAULT now(),
  notice_id uuid → notification ON DELETE SET NULL  -- the notice written on enable
)
```

Written only by `account_set_active()`, which gains a `p_reason` argument (the route takes `{ reason }`);
SELECT-only to the application; readable by `user.invite` at the school or `audit.read` at the school; **not
by the person** (the reason is the office's words about them; the office tells them). A pad credential reads
none of it (db/50's guard). A hand-run `UPDATE app_user SET active = false` still bumps the epoch (db/85's
trigger) and writes no reason row: the owner in the SQL editor is the one caller this does not reach, and
db/99 asserts the application role cannot write `app_user.active` any other way than the function (Q3 asks
whether db/09's `app_user_update` should lose `active`).

The `access_log` rows stay as they are: two records of one act, one of them readable under `audit.read`
alone. That is the same doubling db/77 has, and it is cheap.

### 2.5 What each reader sees

| reader | a disabled account |
|---|---|
| **the person**, on a device already signed in | the next request is `401 session_revoked`, the same words for every reason (db/85). The client signs out and says: "You were signed out. Sign in again." Nothing says why, because the token holder may be a thief |
| **the person**, signing in with Google | `403 account_inactive`: "This account is not active. Ask the school office." (`SIGN_IN_REFUSALS`, built) |
| **the person**, asking the office for a code | the office cannot issue one (`auth_account_for_email()` refuses an inactive account, db/05); the office screen says "This account is disabled. Enable it first." |
| **the person**, once enabled and signed in | one notice, kind `system`: "Your account was re-enabled on {date}. Every device was signed out when it was disabled; sign in again where you need to." Never the reason. Read through a door like db/77's `notification_role_ended`, admitted by the audit row (`account_status_change.notice_id`), so a published notice cannot use it |
| **the office** (People) | the row reads "Not active · disabled {date} by the office" in words, drawn muted, never by colour alone; "Enable account" beside it. The reason on a tap for `user.invite` and `audit.read` holders only |
| **the coach, the Squad screen, the duty card** | nothing changes: roles and links stand. A duty whose holder is disabled reads as it does today; the preview warned |
| **the DSO** | nothing by standing: an account's state is not a concern. A disabled person named in an open concern is still on `users`, because the read now includes inactive rows for those who may read them (D5) |
| **a parent whose child's coach is disabled** | nothing; the fixture card is unchanged |
| **the public pages** | nothing; no account state reaches them |
| **the push fan-out** | a disabled recipient is simply not told (db/85, built) |

### 2.6 Reads and routes

**D5. A new read, `accounts`, includes inactive rows; `users` keeps `where active`.** `users` is read by five
screens (People, Staff, Modules, Guardian link, Transport book), and four of them pick a person to act on:
offering a disabled account as a driver or a module grantee is the wrong default. People alone needs the
whole list, so it gets its own resource: the same SELECT and the same `app_user_read` policy (db/09:
`user.read` at the school, or your own row), without the `where active`, plus `active` and, joined from
`account_status_change`, `status_changed_at`. No migration: `read-api.mjs` and `tables.mjs`'s resource map.

`account_offboard_preview(user)` (§2.3) is a `SECURITY DEFINER` function, `db/NN`, refusing by
`auth_office_refusal()` first so a stranger learns nothing, returning counts and the fixture names of live
scoring tokens, never a child's name. Route: `GET /api/auth/users/:id/preview`.

Routes, as they are and as they become:

| route | today | after slice 2 |
|---|---|---|
| `POST /api/auth/users/:id/disable` | no body | `{ reason }` (≥ 10 characters, `reason_required` otherwise) |
| `POST /api/auth/users/:id/enable` | no body | `{ reason }` as well: "phone recovered", "cleared by the DSO" |
| `GET /api/auth/users/:id/preview` | — | new |
| `accounts` (read) | — | new, slice 1 |

### 2.7 The People screen

Slice 1 changes `people.jsx` and nothing else on the client:

- the list reads `accounts`; the status filter's "Not active" option, which today can never match a row,
  starts matching;
- a person's row carries "Disable account" when the reader holds `user.invite` at the person's school
  (`holdsCapability` and `schoolsWhere`, as `mayAddTo()` does) and the account is active; "Enable account"
  when it is not. The server decides again and its refusal is shown in `SIGN_IN_REFUSALS`' words
  (`not_permitted`: "You cannot do this for that account. The school office that enrolled them can.";
  `superadmin_only`; `cannot_disable_yourself`);
- a confirm sheet before disabling: "This signs {name} out of every device now and stops them signing in.
  Their roles stay. To remove them from the school, end their roles first." Two buttons, 44 px, the
  destructive one not the default;
- the line "Suspending an account is coming." goes.

Slice 2 adds the reason field to that sheet and the preview above it, and the "disabled {date}" words.

Floors: nothing under 12 px; the buttons 44 px; the state said in words.

---

## 3 · Part 2: a pupil leaving, or changing school

### 3.1 Plain words

Rohan is in matric, or his family moves to Durban, or his parents withdraw him. The school's roster has to say
so, and five things have to follow from it without anybody remembering them: his coach stops reading his
file, nobody can pick him for Saturday, his parents' access is dated by the rule db/62 already has, his own
record stays his to read, and every match he played stays exactly as it was scored.

### 3.2 What exists, and what the gap is

- `team_membership` has `joined_on` and `left_on` per side; `still_at_school(player)` (db/60) is "an open
  membership at a tenant of kind `school`". db/62's CLOSE trigger dates his guardian links at the later of the
  leaving day and his majority when the last school membership closes.
- `player.school_id` and `player.team_code` are his school and his **current side**. The coach's medical,
  development and note reads anchor on the current side (roles.mjs, "it stops the moment a player changes
  side").
- `match_squad`'s trigger refuses a child who is not `active` in `player_guardian_status`, which is a
  question about links, not about enrolment.
- The Passport (`passport()`, db/08) carries lines with `source_school`; `passport_consent` (built, Settings)
  names a school his record may travel to, and can be withdrawn.
- There is no record that says "he left", and nothing that writes `left_on` from a screen.

So today a boy who has left keeps a current side, keeps appearing in Squad, can be selected, and his coach
still reads his injury record. db/62 fires only when somebody closes the membership by SQL.

### 3.3 The door

**D6. A departure is a record, not a deletion:**

```
player_departure (
  id uuid PK, player_id → player, school_id → school,
  left_on date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('finished', 'moved', 'withdrawn', 'transferred', 'other')),
  to_school_id uuid → school,                      -- only for 'transferred', a school on SCRBRD
  note text CHECK (length(note) <= 300),           -- the office's; never shown to a coach or a parent
  recorded_by uuid NOT NULL → app_user, recorded_at timestamptz NOT NULL DEFAULT now(),
  returned_on date, return_recorded_by uuid → app_user,   -- player_return()
  CHECK (returned_on IS NULL OR returned_on >= left_on)
)
UNIQUE INDEX one_open_departure ON player_departure (player_id) WHERE returned_on IS NULL
```

**D7. `player_leave(player, left_on, kind, to_school, note)`**, `SECURITY DEFINER`, under
`player.profile.manage` at the player's school (`schooladmin`, `sportsadmin`, `directorofsport`; not a coach,
who holds `team.manage` and not this; not a parent; not the DSO). `left_on` may be up to 30 days in the past
(the office records on Monday what happened on Friday) and not in the future (a future leaving date is a note
on the roster, not a departure; Q4). In one transaction:

1. closes every open `team_membership` of his at this school with `left_on` (db/62's deferred CLOSE trigger
   then dates his guardian links at `greatest(left_on, majority_on(born))`, which for a minor means **his
   parents keep their link until his eighteenth birthday**, as db/62 decided and §3.5 explains);
2. sets `player.team_code = NULL`: no current side. Every coach-tier read that anchors on the side, the
   injury overview, the development ratings, the notes, the workload, the check-ins, is false for every coach
   on the next statement, with no policy change. `player.school_id` stays: the record is the school's;
3. writes the `player_departure` row;
4. ends his `player` assignment through `role_assignment_end()` with the reason "left the school on {date}
   ({kind})", so db/77's audit row and notice are written as for any role. **Leaves `selfaccess`.** His
   account stays active; `app_user.school_id` stays, so this office still issues his codes and answers his
   erasure request (140 §4.3). An eighteen-year-old at a club with `player` + `selfaccess` is the shape this
   leaves him in, minus the club;
5. ends his open availability declarations for fixtures after `left_on`? No. They are facts about what was
   said; the fixture's squad trigger does the refusing (next item);
6. **selection refuses him**: `match_squad`'s trigger gains one test beside `player_guardian_status`: no open
   `player_departure`. The coach's words: "Rohan left the school on 30 November and cannot be selected."
   (`player_departed` as the refusal code);
7. his lift seats on fixtures after `left_on` are voided by db/70's existing path when the link ends; while
   the link is live they stand and the fixture is one he will not play. The function voids seats on fixtures
   after `left_on` itself (`lift_seat` → `void`, the asker told as db/76 tells her), so a parent is not left
   confirming a seat for a boy who is gone;
8. tells the people who should know, naming no reason: the pupil (through db/77's notice); each live guardian,
   kind `system`: "The school office recorded that Rohan left Hilton College on 30 November 2026. What you can
   still see is in Family."; the side's coaching staff, kind `team`: "{name} has left the school; he is off
   the U15A list."

**`player_return(player, joined_on, team_code)`**, same capability: closes the departure row, opens a
membership (db/62's OPEN trigger re-opens the guardian links it may), sets the side, appoints `player` again
(a new assignment through the grant door, `decide_role_request()`'s body; db/01 never reactivates). The
re-admitted boy's record is the same `player` row: nothing was duplicated by leaving.

*Rejected: a `player.status` column.* The reconciliation (G1) keeps standing derived rather than stored, and a
departure is one row with dates; `player_standing(player)` → `enrolled | departed | transferred` is a view
over it. *Rejected: `player.school_id` → NULL on leaving.* The record belongs to the school that made it, and
every policy anchors on it; a tenant-less player row is one nobody should reach (db/01's rule).

### 3.4 The record, the Passport, the public pages

**D8. His match record does not move, and nothing about it is rewritten.** `ball_event` rows carry his
`player_id` and stay; `match_squad` rows stay (the team-sheet history is what happened); the career views fold
over the log as before; honours, caps and milestones stay. A departed boy's season figures are still on his
old school's competition tables because he played those matches. Nothing here needs a correction event and
nothing here may write one.

**Public pages after he leaves (PUBLIC_DATA §1, §4).** Consent is judged on the day a page is served (§5a),
and a guardian's consent is competent if her link was verified on the day she gave it. Her link, for a minor,
stays live until his eighteenth birthday, so **his name on past scorecards is as it was, and his parent may
still withdraw it** (the Consents card stays on her Family screen; §3.5). From eighteen, having left, his
own `selfaccess` record governs (C6). The departure form offers the office one tick, "Take his name off public
pages now", which is the office's "no" through `public_name_consent_set()` with the departure form named
(`form_name = 'departure'`, `form_date = left_on`): a "no" needs no family signature (db/62 §4's reasoning).
Default unticked (Q5). The never-public mark is not touched: it is a safeguarding fact, not a roster one.

**The Passport.** `passport()` lines carry `source_school` and `confidence`, made for a record that outlives a
school. They are read under `player.profile.read` over his row, which after leaving is held by his parents
(till the link ends), by him (`selfaccess`), and by the office. **No coach at the old school reads his Passport
once he has no side**, and no school he has not consented to reads anything.

**D9. Changing to another school on SCRBRD is two acts by two schools, joined by the family's consent.**
Hilton records `player_leave(kind = 'transferred', to_school = Westville)`. Westville enrols him as it enrols
any pupil: a new `player` row at Westville, his parents linked and verified there, his account's `player` role
granted there (`decide_role_request()`, which already requires `player_not_at_that_school` to be false for
*its* row). What Westville sees of his Hilton record is exactly what `passport_consent` lets travel: the
family names Westville on his Consents card (built), and Westville's `passport?playerId` for *their* row shows
the Hilton lines with `source_school = Hilton`. For that, the two `player` rows need to be known as one
person: `player_departure.to_school_id` is Hilton's half; Westville's `enrol` screen offers "He comes from a
school on SCRBRD" and, if the family has named Westville in a `passport_consent`, the office picks the
consented Hilton row, which writes `player_departure.successor_player_id` (Q6 asks whether that link needs its
own table). Nothing about his Hilton **file** travels: not his injuries, his notes, his ratings, his
discipline, his PII, his emergency contacts, his consents. Each is Hilton's record under Hilton's retention,
and Westville captures its own. SCRBRD-110 §7.5's health retention and the DSO's concern record (SAFEGUARDING
§4.6: a referral upward carries no name) are untouched by a transfer.

*Rejected: one `player` row moved to the new school.* Every policy anchors on `player.school_id`; moving it
would hand his Hilton injury record to Westville's physio in one UPDATE, and make his Hilton scorecards
Westville's to publish. *Rejected: copying the record.* A copy is a second record to keep, correct and purge.

**A school not on SCRBRD** gets nothing from the platform. The family may ask Hilton for his record (POPIA
right of access; §6.4), and Hilton's office prints the Passport. Q7 asks whether a family export is worth
building.

### 3.5 His parents, his siblings

A minor who leaves keeps his parents' links until his birthday (db/62). That is deliberate: the school still
holds his record; the competent person for a child's record is still his parent; she can still read it,
correct a contact, and withdraw his public name. What she can no longer do is anything about a fixture,
because there are none. Her Family card reads:

> "Rohan left Hilton College on 30 Nov 2026. His record there stays yours to read until his 18th birthday,
> 14 Mar 2029; nothing new is added to it. Consents › · His record › · Who to ring ›"

GA-I20's list draws no row for a departed child: no fixture, no seat, no answer owed. A consent not answered
stays a row, because it still governs his old scorecards.

**A parent with another child still at the school** changes nothing: one `guardian` assignment at the school
carries several subject rows, and only Rohan's is dated. Her switcher drops Rohan from Home and Matches and
keeps him on Family as the closed card above.

**A parent whose only child at this school has left** keeps her `guardian` assignment, live, naming one
dated link. On the birthday, `app_can()` finds no live subject and refuses the assignment outright (db/01).
Nothing ends the assignment row itself; People shows it "live · no linked child" and offers End role, which
db/77 refuses with `last_verified_link` while he is a minor, and allows after. Q8 asks whether the birthday
should also end the assignment automatically; the recommendation is no (nothing widens or narrows by the
clock but the link, and that is already the rule).

### 3.6 Who sees what, after a departure

| reader | sees | no longer |
|---|---|---|
| **his coach** | him on past team sheets and scorecards; "left the school on {date}" if he tries to select him | his row on Squad, his injuries, ratings, notes, load, check-ins, Passport |
| **the office** | everything it saw, plus the departure row and "departed" on his roster line | — |
| **the physio** (`medical`, school-scoped) | his injury record, as the school's record | **Q9**: should departed pupils' clinical records be cut from staff reads except the office's, until purge? Recommendation: yes, a `RESTRICTIVE` policy on the masked health, note, rating and discipline tables, false for a departed player unless the caller is the office, a live guardian or the pupil himself |
| **his parents** | Family's closed card; his record; his consents; his Passport | fixtures, lifts, availability, the To-do list |
| **himself** | Me: his record, his Passport, his consents (his own from eighteen); Matches: his past ones | the team's fixtures, the bus, the check-in card, the team sheet |
| **his new school** | its own row for him; Passport lines from Hilton if the family named Westville | anything else from Hilton |
| **the public** | what the consent rule allows on the day, unchanged | — |
| **the DSO** | nothing new; a departure is not a concern. An open concern naming him stays with the DSO (SAFEGUARDING §1) | — |

### 3.7 The audit

`player_departure` is the audit of the act (who, when, which kind, which school). `role_assignment_ending`
carries the `player` role's end. The notices are on `notification`. Reads of his record after departure are
logged as they are today (restricted fields). Nothing is deleted.

---

## 4 · Part 3: a parent's link ending

### 4.1 The four ways, as they are

| event | mechanism today | state after |
|---|---|---|
| **he turns 18** | `valid_until = majority_on(born)` at establishment (db/08, db/10); at school it stays open past the day (db/62) and ends when he leaves | `verified`, dated out; the parent's Family card closes (STEP4 §3.3); she may still say "no" to his public name while he is at school (db/62 §4) |
| **the family leaves** | `player_leave()` → db/62 CLOSE: `greatest(left_on, majority)` | as above, or open until his birthday for a minor |
| **custody change** | `guardian_link_revoke()` (db/08; route under `/api/players/:id/guardians`, L2) by `guardian.link.manage`; refuses the last verified link of a minor: link the new guardian first | `revoked`, `valid_until = today` |
| **the office revokes** | the same function; or the whole `guardian` role ends (db/77), which revokes every live link it names | as above |

### 4.2 What the link carries, and what goes with it

| record | tied to the link how | when the link ends |
|---|---|---|
| **the terms** (`consent_state`, `consent_version`, `consent_at` on the link) | the link's own columns | end with it; a new link is a new consent (`pending`) |
| **public name** (`public_name_consent.giver_link_id`) | competent only while the giver's link was `verified` on the day given; **a revoked link is read as "revoked as untrue"** (PUBLIC_DATA §6 item 2, db/47) | a *dated-out* link's consents stay competent for the days they covered, so his old scorecards keep his name; a *revoked* link's consents count for nothing, so **he is "Batter" on every page until another competent person answers**. The office's revoke screen says this before the tap |
| **health monitoring** (db/60, read through a link live today) | live link | lapses on the next statement; collection stops; the other parent's or his own at eighteen stands if given |
| **lift seats she consented to** (`lift_seat.guardian_link_id`) | the link | voided by db/70's deferred trigger; the driver told, naming nobody; a boy in the car is never put out (db/76) |
| **lift offers she drives** | her declaration needs a live verified link at the school | cancelled `link_ended` (124 §6.4) |
| **availability she declared** | `declared_by` = her | stays as a fact about the fixture; she can declare no more |
| **emergency contacts** she typed | the child's rows, free text | **stay**: they are the school's record of whom to ring, and her number may still be the right one. The revoke screen lists the child's contacts and asks the office to check them; nothing is removed by the platform |
| **her sight of his record** | `app_can()` | gone on the next statement |
| **`wellness_share` rows to her** (SCRBRD-110) | `with_link_id` or person | lapse: the open function checks the link |
| **safeguarding shares to her** (`safeguarding_share.with_link_id`) | the link | the open function checks the link; revoked by the DSO's rule on closing |

### 4.3 The reason, kept from everyone but the office

**D13. Every revocation records a reason, in a row the parent and the public read never see.** db/47's
reading ("every revoked link counts as untrue, because the schema records no reason") is kept as the public
rule: it is the conservative one, and a consent that can be challenged should not name a child. But the office
will be asked why a link ended, in a custody dispute most of all, and must be able to answer from the record.

```
guardian_link_ending (
  link_id uuid PK → assignment_subject,
  player_id → player, school_id → school, guardian_id → app_user,     -- copied, so the row reads alone
  kind text NOT NULL CHECK (kind IN ('custody', 'family_left', 'guardian_asked', 'office', 'role_ended', 'majority', 'left_school')),
  reason text CHECK (kind IN ('majority','left_school') OR length(btrim(reason)) >= 10),
  ended_by uuid → app_user,                        -- NULL for the two automatic kinds
  ended_at timestamptz NOT NULL DEFAULT now(),
  notice_id uuid → notification ON DELETE SET NULL
)
```

Written by `guardian_link_revoke()` (which gains `p_kind`, `p_reason`), by `role_assignment_end()` for the
links it revokes (`role_ended`, the role's reason), and by db/62's two closing paths (`majority`,
`left_school`, no reason, no actor). Readable by `guardian.link.manage` or `audit.read` at the school; never
by the guardian; never by the DSO by standing (inside a concern, `safeguarding_family()` is the DSO's read, and
it shows verified guardians; Q10 asks whether it should also show ended links and their kind, since a custody
change is exactly what a DSO may need to know). A pad credential reads none of it.

*Rejected: a `revoke_reason` column on `assignment_subject`.* The row is read by the parent's own session
(`assignment_subject_read`, `a.person_id = app_user_id()`), and GA-I20 N4's `my_links` will read it; a reason
on the row leaks on the first read.

### 4.4 The office's read of a child's links

**D12. `child_links?playerId`**: every `assignment_subject` row for the child, in every state, newest first:

| column | from |
|---|---|
| guardian's name and email (adults; `app_user`) | `app_user` |
| `relationship`, `verification_state`, `verified_by` (name), `verified_at`, `verified_note` | the link |
| `consent_state`, `consent_version`, `consent_at` | the link |
| `valid_from`, `valid_until`, `created_by` (name), `created_at` | the link |
| `ending_kind`, `ended_at`, `ended_by` (name); the reason **only** to `guardian.link.manage` or `audit.read` | `guardian_link_ending` |
| whether the guardian's `role_assignment` is live, and whether their account is active | `role_assignment`, `app_user` |
| the derived standing: `player_guardian_status` (`active | pending_consent | pending_verification | unlinked`), `is_minor`, `live_links` | built |

`assignment_subject_read` (db/01) already admits `user.role.assign` and `guardian.link.manage` at the
assignment's school, so the read is `security_invoker` SQL in `read-api.mjs` over that policy; the reason
column comes through `guardian_link_ending`'s own policy. Who may: the office (`schooladmin`), the principal,
and whoever holds `user.role.assign` at the school (the director of sport, by that capability). Not a coach
(no `user.role.assign`); not the DSO by standing (SAFEGUARDING §1 item 2; the DSO's read is
`safeguarding_family()` inside a concern); not a parent (she reads her own rows through `my_links`, GA-I20
N4). **Logged** as a restricted read: it lists the adults around a child, and "who read this boy's family"
is a question the DSO answers from the log (`audit.read`).

The screen: Squad → a pupil → **Family links** (office only): the list above, with the standing line on top
("Active · 2 verified links · consent granted on both"), and beside each live link "Revoke…" (kind, reason ≥
10 characters, the consequences of §4.2 said in the sheet: "His name comes off public pages until another
guardian answers. Her lift seats for him are voided. The contacts stay; check them."), beside the child "Link a
guardian" (the existing establish route), beside a `pending` link "Verify" (existing). Refusals in the
function's words: `last_verified_link` → "He is under 18 and this is his only verified guardian. Link the new
guardian first." The screen never shows `born`; `is_minor` is the server's word.

### 4.5 What the parent is told

| ending | the parent sees |
|---|---|
| **18, at school** | nothing ends; Family says "Rohan is eighteen: his consents are his to give. You may still say no." (GA-I20 §3.2) |
| **18, after leaving** / **leaving after 18** | thirty days out: "Your link to Rohan ends on {date}. After that his record is his own." On the day the card closes (STEP4 §3.3). A notice, kind `system`, on the day: "Your link to Rohan ended on {date}: he is eighteen." The age is his, and it is a fact she knows |
| **revoked** (any kind) | one notice, kind `system`: "Your link to a child at Hilton College ended on {date}. The school office can say why; the platform does not." (GA-I20 §4.3, Q7 decided: the school may be named.) Read through a door admitted by `guardian_link_ending.notice_id`, like db/77's, so it reaches her even when it was her last link there. **No child's name**: the link that admitted her to his name is gone |
| **her `guardian` role ended** | db/77's notice as built (the role, the school, the date) |
| **the child left** | §3.5's words: the link stays; the card says what she still sees |

The pupil, at eighteen, is told once on Me (STEP4 §3.3, built in words): his consents are his. He is told
nothing about a parent's revocation: the reason may be about him, and the office tells the family.

### 4.6 The audit

`guardian_link_ending` (D13) is the audit of the ending; `assignment_subject` keeps the row with its state
and dates; `role_assignment_ending` carries a role's end; the notice ids tie them together; `access_log`
carries every read of `child_links`.

---

## 5 · Part 4: staff leaving

### 5.1 Plain words

Mr Botha coaches the U15A, scores the U14B when needed, and resigns in October. Ms Adams scores the 1st XI's
matches on a one-fixture assignment and is not coming back. Each has things open that the platform knows
about and the office does not: a duty on Saturday, a scoring token still held from a rained-off match, a
safeguarding concern he raised in August. The flow shows them, and ends what should end through the doors
that exist.

### 5.2 The flow: "Off-board"

**D15. Off-boarding is roles first, account last, on one screen, with a preview between.** On People, beside
a person with live roles at a school where the reader may assign: **Off-board…** opens a sheet in three parts:

1. **What is open** (`account_offboard_preview`, §2.3), by kind, with the door for each (§5.3);
2. **End roles**: each live role at this school ticked, one reason (≥ 10 characters) for all of them, each
   ended through `role_assignment_end()` in turn, in one transaction (`role_assignments_end_all(ids[],
   reason)`, a `db/NN` wrapper that calls the db/77 door per row and stops at the first refusal, so the
   office does not end three roles and get refused on the fourth). The refusals are db/77's, by name
   (`last_admin`, `own_dso`, `last_verified_link`, `superadmin_only`, `owners_key`). Roles at another
   school are shown greyed: "At Westville; not yours to end";
3. **Disable the account**, offered only when the preview says no live role remains anywhere after step 2
   (otherwise: "They still hold roles elsewhere; their account stays"). Reason prefilled from step 2.

The person gets db/77's notice per role (never the reason) and, if disabled, sees "This account is not
active" at their next sign-in. The office tells them in person, as it does with the reason today.

**Who:** whoever may grant each role at the school (db/77), for the roles; `auth_office_refusal()` for the
account. The same separation as db/77: nobody off-boards themselves (`cannot_disable_yourself`,
`last_admin`), a DSO is ended by the principal or the PDSO (`own_dso`, `dso_appointment_guard()`), the owner's
key is never ended here. **A leaver who is also a parent at this school** keeps her `guardian` role unless
the office ticks it too, and db/77's `last_verified_link` and `guardian.link.manage` rules then apply; the
default is unticked and the sheet says "She is also a parent here; her guardian role is not ended unless you
tick it."

### 5.3 The open things, each with its door

| open thing | how it is found | what the flow does | the door |
|---|---|---|---|
| **match-day duties** in the next 14 days (db/34) | `duty` rows linked to the assignments being ended | lists them: "Scorer, Sat 10 Oct, U14B v DHS". Ending the assignment leaves the duty card reading "scorer needed" (the SAFEGUARDING §5 convention). db/34's `role_assignment_linked_guard` is the arbiter: if it refuses an end while a duty is linked, the sheet offers "Lift the duty first" (`duty_lift()`) and the lead confirms the guard's behaviour at build (A3) | `duty_lift()`, `duty_link()` to the replacement |
| **a scoring token** held (`scoring_session` active / `handover_pending`, this person) | `scoring_session` | "Holds the token for 1st XI v Kearsney (rain-delayed). Release it so another scorer can claim." One tap calls the existing force-release. Their pad credential ends with the disable, or with `pad_resume_revoke()` under `user.invite` if the account stays | force-release (built); `pad_resume_revoke()` |
| **queued offline events** on their phone | not knowable | nothing: a revoked scorer's queued events are quarantined on reconnection, with the epoch as discriminator (reconciliation §14.2, built). The sheet says so in one line | — |
| **an open handover** (`handover_pending` to or from them) | `scoring_session` | the same release; the receiving scorer is told to claim | built |
| **lifts they drive** (only if they hold `guardian` and a declaration) | `lift_offer` open, this driver | nothing unless the `guardian` role is ticked; then db/70's `link_ended` cancel runs and the families are told. Listed either way so the office knows | db/70 |
| **school bus trips they drive** (`driver` role, `trip`) | `trip` rows naming them | the trip card reads "driver needed"; the transport coordinator reassigns | built |
| **concerns they raised** | the DSO's alone (SAFEGUARDING §1 item 5); **the preview does not list them and cannot** | nothing. The reporter row stays with the DSO. The reporter's departure changes nothing about the concern | — |
| **concerns naming them** | the DSO's alone; **not listed** | nothing refuses the office ending an ordinary role while a concern names the person (db/57 guards DSO appointments only). The concern stays open with the DSO; a `safeguarding_suspension` on them stays on the record (its rows outlive the roles; lifting it is still the DSO's). **D18: the system appends a note of kind `person_left` to every open concern that names the person, and tells the DSO without a name**: "A person named in an open concern has left the school. Open Safeguarding." Written by a `SECURITY DEFINER` hook from `role_assignments_end_all()` that reads nothing back to the caller | db/57's note path; a `safeguarding` notice |
| **their development notes, ratings, availability "according to the coach"** | authored rows | stay, with their uuid as author (reconciliation D1: nothing can be erased; authorship is fixed) | — |
| **their row on the staff register** (140 §5.2) | `school_register` | a claimed row stays claimed; ending a role does not reopen it (built). The upload screen already warns on a recently-ended email | built |
| **their Google sign-in** | `auth_identity` | stays unless the account is disabled; the exchange then answers `account_inactive`. The office may also remove it (`auth_identity_revoke()`, built), which is the right act when the person keeps a role elsewhere but this school issued the sign-in | built |
| **an `enquiry` grant** they hold over another school's boy | `role_assignment` with `valid_until` | ended with the rest, by the granting coach's school if the leaver's own office cannot (it is at the other school) | db/77 |
| **the DSO leaving** | — | the principal or the PDSO ends the appointment (db/57, db/77); the register notice to the union (SAFEGUARDING §2.3); their account is disabled by the owner on request (Q1) | built |

**D16. Nothing about a concern is shown to the office**, even as a count. "2 open concerns name this person"
is a disclosure SAFEGUARDING §1 forbids. The DSO learns of the departure from the note and notice; the office
learns nothing from the flow it did not know.

**D17. A scorer's one-fixture assignment that has passed its match is already dead**; the preview does not
list it and the flow does not end it. Ending it anyway is harmless and noisy. The office sees "ended" on it
already (db/34's expiry).

### 5.4 Who sees what

| reader | after off-boarding Mr Botha |
|---|---|
| **Mr Botha** | one notice per role (role, side, school, date; never why); his next sign-in refused if disabled; his pad credential ends with `account_disabled` on the scoring audit |
| **the U15A squad screen** | no coach line; the duty cards say "coach needed" / "scorer needed" until re-linked |
| **the parents of the U15A** | nothing from the platform; the school's own channels say who the new coach is. (A `team` notice from the office is one tap on Notices; not automatic, because the words are the school's) |
| **his pupils** | his notes about them stay, unreadable to them as before (reconciliation D1); their ratings keep his as author |
| **the DSO** | the no-name notice; the `person_left` note on any open concern naming him; his row still on `users`/`accounts` for `user.read` |
| **the office** | his roles "ended {date}" on People; his account "Not active · disabled {date}"; the reasons on a tap |
| **the public pages** | nothing: adults named on a fixture as officials are outside the rule, and a coach's name was never on one |

### 5.5 The audit

`role_assignment_ending` per role (db/77); `account_status_change` (D4) for the disable; `scoring_audit` for
the token release and the pad credential; `duty_suspension`/`duty` rows for the duty changes; the DSO's note.
One `access_log` row `auth.offboard` from the wrapper, so the five acts are findable as one.

---

## 6 · Part 5: retention under POPIA

### 6.1 Plain words

POPIA says keep personal information no longer than you need it for the purpose you collected it, unless a
law or a legitimate record-keeping purpose says otherwise, and then either delete it or make it no longer
about a person. The match record is the one thing on this platform that is a record of events, kept for its
own sake, and the names in it are governed on every public surface by consent already. Everything around it
(who the child is, where he lives, what hurt, what a coach thought) is kept for a purpose that ends when he
leaves, plus the period the school's own retention schedule and the law give it.

The platform does not know South African education retention law better than the school's information
officer. So the schedule is a declared table Kameel signs, in the policy package, with the periods he chooses,
and the platform does three things with it: shows the office what is due, refuses a deletion before its date,
and makes every deletion a logged act.

### 6.2 The schedule

**D22. `packages/policy/src/retention.mjs`**: one entry per record kind, each with `keep` (`forever` or a
period after an anchor), `then` (`keep | minimise | delete`), the anchor, and who may act. A test asserts every
table in `tables.mjs` that carries a masked column has an entry, as PUBLIC_DATA §3's never-public list is
tested. The periods below are **recommendations for Kameel to confirm or change** (Q11); the shape is the
decision.

| kind | tables | keep | then | anchor | who acts |
|---|---|---|---|---|---|
| **the match record** | `ball_event`, `match`, `match_squad`, `scoring_amendment`, results, the toss | **forever** | keep | — | nobody deletes; corrections are events |
| **the identity on the record** | `player.full_name`, `surname`, `known_as`, `born`, `id_number`, address, phone, `height`, `weight` | the school's period after leaving; **recommend 5 years** | minimise (D24) | `player_departure.left_on` | the office, on the due list or on the family's request after the date |
| **honours, caps, milestones, Passport lines** | `honour`, `player_milestone`, passport | forever | keep | — | they are the match record's companions; after minimisation they say "Former pupil" where they said a name, unless he consents to be named (public name consent, as adult) |
| **health**: injuries, clinical notes, wellness, load, fitness tests | the SCRBRD-110 tables, `injury` | **SCRBRD-110 §7.5's period** (not re-decided here) | delete, per that design | leaving | the office with the physio; §7.5's door |
| **development notes, ratings** | `development_note`, `player_skill` | **recommend 2 years after leaving** | delete | leaving | the office; the author's uuid on the note is not a reason to keep it |
| **discipline** | `disciplinary_record` | the competition's rule, else **recommend 5 years** | delete | the record's date | the office; a competition's record is the competition's (db/25) |
| **emergency contacts, guardian PII** | `emergency_contact`, the guardian's `app_user` row | while any link is live, then **1 year** | delete contacts; the guardian's account follows §6.3 | the last link's end | the office |
| **guardian links and their endings** | `assignment_subject`, `guardian_link_ending` | **recommend 7 years** after the child's majority | minimise (the guardian's uuid stays; name through `app_user` follows that row's fate) | majority | — |
| **role assignments and endings** | `role_assignment`, `role_assignment_ending`, `account_status_change` | **7 years** after ending | keep the row; the person's name follows their account | ending | — |
| **safeguarding** | the db/57 tables | SAFEGUARDING §4.7: **CSA's periods are the floor** | that design's purge | that design | the DSO |
| **lifts** | db/70, db/76 | **one season**, built (`lift_purge_due()`, `lift_purge()`) | built | built | built |
| **access log** | `access_log` | **recommend 5 years** | delete rows; never minimise (a log with holes is not a log) | the row's date | the platform, on a schedule the owner runs |
| **sessions, codes, claims** | `auth_session` (a day past expiry, built), `login_code` (3 days, built), `pending_claim` | pending claims **90 days** then `expired` | — | — | built / small |
| **sign-ins** | `auth_identity` | with the account | deleted on erasure (140 §3.8) | — | — |
| **notifications** | `notification` | **recommend 2 years** | delete | sent | the platform |

### 6.3 The account's own end

140 §3.8's `account_erase()` is the terminal state, as designed and decided (D10 there): `active = false`,
email and name tombstoned, every `auth_identity` deleted, every live role ended through db/77 (refusing a
minor's last verified guardian), the browser deleting the Firebase user, audit rows keeping the uuid. This
design adds three things:

**D23.** A person asks for erasure from Me; **the office may erase only an account that has been inactive or
role-less for 30 days** (a cooling period against a mistaken tap on the wrong row), and never a pupil's account
while he is enrolled (the record is the school's; the account is how he reads it; erasing it is a different
request, by the family, through the office, after he leaves). An `account_status_change` row with `kind =
'erased'` is written. **An erased account is never enabled again** (`account_set_active()` refuses
`account_erased`).

A **guardian's erasure** while a link is live is refused (`live_guardian_link`): the link is a consent record
about a child, and the office must revoke it first (part 3), which writes the reason.

### 6.4 What a person may ask, and how it is answered

| the ask | POPIA right | the answer today | what this adds |
|---|---|---|---|
| **see what you hold about me / my child** | access (s23) | Me and Family show the file; the notes are the one structural exception (reconciliation D1, a policy position to take) | nothing new in code; Q12 raises the notes with the information officer again |
| **correct it** | correction (s24) | the family edits contacts; the office edits the record; a wrong ball is an amendment (`scoring_amendment`) | nothing new |
| **delete my account** | deletion (s24) | `account_erase()` (140 §3.8, phase 3) | D23's guards |
| **delete my child's record** | deletion (s24), weighed against the school's record-keeping | nothing | the office may minimise after the schedule's date (D24); before it, the information officer may override with a recorded reason, except the match record, which is never deleted. The screen says so to the family in plain words: "The scores of matches he played are the shared record of those matches and stay. Everything that says who he is can be removed after {date}." |
| **take his name off public pages** | consent withdrawal | the switch, built (C3) | nothing new; it is immediate and reaches the past |
| **a copy to take to another school** | portability (s23 read with s24) | the Passport under `passport_consent`, to a school on SCRBRD | Q7 (a printable Passport for a school that is not) |
| **why did my link end** | access | the office tells them; the platform says nothing (GA-I20 §4.3) | D13's row is what the office answers from |

### 6.5 Minimising a record

**D24. `player_minimise(player, reason)`**, `SECURITY DEFINER`, under `player.profile.manage` **and**
`guardian.link.manage` at the school (two capabilities, one holder today: `schooladmin`; the principal holds
the second alone and is refused, which is right: the office that keeps the record minimises it). Refused while
the player is enrolled (`still_enrolled`), while any guardian link is live (`live_guardian_link`), and before
the schedule's date unless `p_override` is given with a reason of 20 characters or more and the caller also
holds `audit.read` (the information officer's act, on the record). It:

- replaces `full_name` with "Former pupil", `surname` with `NULL`, `known_as` with `NULL`; `born`, `id_number`,
  address, phone, `height`, `weight` with `NULL`; deletes his `emergency_contact` rows; **leaves `player.id`,
  `school_id`, and every match event, squad row, honour and milestone exactly as they are**;
- sets the never-public mark? **No.** A minimised row has no name to show; `publicName()` on a nameless row
  must answer the position ("Batter"), and the test asserts it (A5);
- ends his `selfaccess` link and role if his account still exists (a record with no identity is not a file to
  read), and tells him once: "Your record at Hilton College was anonymised on {date} at the school's retention
  date. Your match scores remain part of the record of those matches.";
- writes `player_minimisation (player_id, school_id, done_by, done_at, reason, overridden boolean)`,
  SELECT-only to `audit.read` at the school.

`born` → NULL has two readers to check: `birth_age_group()` in `public_name_facts()` (a NULL `born` already
takes the `namesOff` branch conservatively, db/62 §4) and the age-group eligibility of past selections
(history, not re-judged). A5 names both for the lead.

**The due list**: `retention_due(school)`, a read for `player.profile.manage` at the school, from the schedule:
"3 records past their retention date; 12 due this year", each with the kind, the date and the door. Nothing
runs on a clock (db/62's rule); a person acts, and the act is logged.

---

## 7 · Who may: the table

| act | capability, where | separation |
|---|---|---|
| disable / enable an account | `user.invite` at the account's school **and** every live role one the caller could grant there (`auth_office_refusal()`) | never yourself; a platform-wide holder only by a superadmin; the office never a principal's, a DSO's, a physio's |
| read inactive accounts (`accounts`) | `user.read` at the school (the existing policy) | — |
| read the disable reason | `user.invite` or `audit.read` at the school | not the person |
| record a departure / return | `player.profile.manage` at the player's school | not a coach, not a parent, not the DSO |
| take his name off public pages on departure | `guardian.link.manage` (the office's "no" path, db/47) | a "no" needs no family signature; a "yes" always does |
| read a child's links (`child_links`) | `user.role.assign` or `guardian.link.manage` at the school | logged; not the DSO by standing; not a coach |
| revoke a link, with kind and reason | `guardian.link.manage` at the school (built) | not the last verified link of a minor; nobody revokes a link that gives themselves access (G1) |
| end roles in one act | `user.role.assign` and `app_may_grant_at(role, school)` per role (db/77) | db/77's seven refusals |
| release a scoring token | the existing force-release authority | — |
| minimise a record | `player.profile.manage` **and** `guardian.link.manage` at the school; override needs `audit.read` and a 20-character reason | not while enrolled or linked; never the match record |
| erase an account | the person for their own; the office after 30 days inactive or role-less | never an enrolled pupil's; never while a guardian link is live |
| read the due list | `player.profile.manage` at the school | — |

Platform roles: `superadmin` holds every capability above as it holds everything outside `safeguarding.*`,
and its reads of a child's links are the unlogged reads roles.mjs already names as the reason to stop using
it. `platformadmin` holds none of them at a school (no `user.invite`, no `player.profile.manage`, no
`guardian.link.manage`); its route is the support session. **No platform role gains school authority here.**

---

## 8 · The audit entries

| act | row | readable by | the person sees |
|---|---|---|---|
| disable / enable | `account_status_change` (reason) + `access_log` `auth.account_disabled/_enabled` (built) | `user.invite` or `audit.read` at the school | a notice on enable; the sign-in refusal while disabled |
| offboard | `access_log` `auth.offboard` + the rows of each act | `audit.read` | one notice per role |
| departure / return | `player_departure` | `player.profile.manage`, `audit.read` | the pupil's db/77 notice; the parents' notice |
| link revoked / ended | `guardian_link_ending` (kind, reason) | `guardian.link.manage` or `audit.read` | "Your link to a child at {school} ended on {date}." |
| `child_links` read | `access_log` restricted read | `audit.read`, the DSO | — |
| token released | `scoring_audit` (built) | as today | — |
| concern note | `safeguarding_concern_note` kind `person_left` | the DSO | — |
| minimised | `player_minimisation` | `audit.read` at the school | one notice, if he has an account |
| erased | `account_status_change` kind `erased` | `audit.read` | the confirmation on Me, then nothing |

Every one keeps the uuid of the person acted on. Nothing is deleted that an audit row points at: the
tombstone is how an erased person stays referable.

---

## 9 · Decisions

| # | decision | recommendation | why, in one line |
|---|---|---|---|
| **D1** | What disabling does | **Stops every session now, mints no new one, keeps every role and link** | a lost phone must not cost a coach his appointment, which db/01 never gives back |
| **D2** | Who may disable or enable | **db/81's `auth_office_refusal()` unchanged**: `user.invite` at the school, every live role grantable by the caller there, platform-wide only by a superadmin, never yourself | nothing widens; the office cannot act on its principal, DSO or physio |
| **D3** | A parent, a pupil, a coach | **One mechanism; a preview says what each account has open** (token, duties, lifts, links) before the tap | the data differs, the door does not |
| **D4** | A reason for a disable | **Required (≥ 10 chars), in `account_status_change`, kept from the person**, readable by `user.invite` or `audit.read` | db/77's shape; the office will be asked |
| **D5** | How People finds a disabled account | **A new `accounts` read without `where active`; `users` keeps it** | four other screens pick a person to act on and should not offer a disabled one |
| **D6** | A pupil leaving | **A `player_departure` row with `left_on`, `kind`, `to_school_id`; standing derived, never stored** | G1's rule; a departure is dates, not a flag |
| **D7** | The door and its holder | **`player_leave()` under `player.profile.manage`**: closes memberships, clears the side, ends `player`, keeps `selfaccess`, refuses selection, voids future seats, tells family and staff without a reason | one act, every consequence, by the office |
| **D8** | His match record | **Untouched, for ever; team-sheet history and Passport stay** | the shared record of a match is not one child's to take |
| **D9** | Changing to a school on SCRBRD | **Two acts by two schools: Hilton's departure, Westville's enrolment of a new `player` row; what travels is the Passport under `passport_consent`, nothing else** | moving a row hands one school's file to another in one UPDATE |
| **D10** | Public pages on departure | **Unchanged by default; the departure form offers the office a "no" through db/47's office path** | consent is judged on the day served; a withdrawal needs no signature |
| **D11** | Parents of a minor who left | **Keep their links until his birthday (db/62, as decided)**; Family shows a closed card with what she still reads | the school still holds his record; she is still the competent person |
| **D12** | The office's read of a child's links | **`child_links?playerId`**: every state, dates, deciders, standing; logged; `user.role.assign` or `guardian.link.manage` at the school; not the DSO by standing | the office has to see links to work them (db/01's own comment) |
| **D13** | A reason for a revocation | **Recorded in `guardian_link_ending` with a kind; never on `assignment_subject`; never to the parent or the public read**; a revoked link still reads "untrue" for public names | the parent's own row read leaks a column; the public rule stays conservative |
| **D14** | What a revocation takes with it | **Said on the revoke sheet before the tap**: public name off until another answers, health consent lapses, her seats void; contacts stay for the office to check | a silent side effect on a child's public name is the one not to have |
| **D15** | Staff leaving | **"Off-board": preview, end roles in one transaction (`role_assignments_end_all()`), then disable only if nothing stands anywhere** | roles first, because a role is what the school tells every reader |
| **D16** | Concerns in the off-board flow | **Never shown, not even a count** | SAFEGUARDING §1 item 2 |
| **D17** | Expired one-fixture roles | **Not listed, not ended again** | already dead by db/34 |
| **D18** | A leaver named in an open concern | **A `person_left` note on the concern and a no-name notice to the DSO; nothing refuses the ending** | routes stay with the DSO; authority is not kept alive to preserve a concern |
| **D19** | A leaver's scoring token | **Released from the sheet through the existing force-release; queued events quarantine as built** | — |
| **D20** | The notice on enable | **"Your account was re-enabled on {date}. Every device was signed out…"; never the reason** | db/77's words and door |
| **D21** | What a dead token's holder is told | **"You were signed out. Sign in again." for every reason** | the holder may be a thief (db/85) |
| **D22** | Retention | **A declared schedule in `packages/policy/src/retention.mjs`, tested against `tables.mjs`; a due list; nothing on a clock** | the information officer decides periods; the platform enforces dates |
| **D23** | Erasure guards | **The office erases only after 30 days inactive or role-less; never an enrolled pupil; never a live guardian; erased is never enabled again** | a wrong tap on the wrong row is the failure to design against |
| **D24** | Minimising a record | **`player_minimise()` under two capabilities; refused while enrolled or linked or before the date (override needs `audit.read` and 20 chars); identity fields cleared, match record and `player.id` kept, `selfaccess` ended** | POPIA's "no longer about a person" without touching the match record |

## 10 · Open questions

| # | question | recommendation |
|---|---|---|
| **Q1** | Who disables a principal's or a DSO's account, since no school role may? | **The owner's key, on the chair's written request, for the pilot.** No new role (ADR 0003). If it recurs, a `chair` capability set is a design of its own |
| **Q2** | Who disables a school-less Google account (140 §4) that is misbehaving? | **The owner, plus 140 §6's cooldown** (three declined guardian claims suspend requesting). Nothing more for the pilot |
| **Q3** | Should db/09's `app_user_update` policy stop letting `user.role.assign` holders write `active` directly, so the function is the only door? | **Yes**, in slice 2: a column-level revoke on `active` for `scrbrd_app`, with `account_set_active()` as `SECURITY DEFINER` the only writer. db/09 is frozen; a `db/NN` adds the restriction |
| **Q4** | A leaving date in the future ("leaves at the end of term") | **Not now.** Record it on the day; a planned departure is a roster note the office keeps itself |
| **Q5** | The departure form's "take his name off public pages" tick: default on or off? | **Off.** A "no" is immediate and reaches the past; defaulting it on un-names every leaver's old scorecards by an office habit rather than a family's choice |
| **Q6** | Linking a departed Hilton row to its Westville successor: a column on `player_departure` or a `player_identity` table? | **A column for now** (`successor_player_id`, written by the receiving office from a consented `passport_consent`). A person table is right when a third school appears; not before |
| **Q7** | A printable Passport for a family moving to a school not on SCRBRD | **Later, Sonnet**, over `passport?playerId`: honours, caps, career figures; nothing from the file. Worth one screen when a family asks |
| **Q8** | Should a `guardian` assignment end automatically when its last link dates out at eighteen? | **No.** The link is the rule and nothing moves by the clock but it; People shows "no linked child" and the office ends it when it tidies |
| **Q9** | Cut a departed pupil's clinical, note, rating and discipline tiers from staff reads until purge, except the office's, his parents' and his own? | **Yes**, slice 4: a `RESTRICTIVE` policy on those tables, false when `player_standing() = 'departed'` unless the caller holds `player.profile.manage` at the school or reaches him through a live link. The physio who needs a record for a complaint asks the office |
| **Q10** | May `safeguarding_family()` show the DSO ended links and their kind inside an open concern? | **Yes, the kind and the date, never the reason text.** A custody change is what a DSO needs to know; the reason is the office's words |
| **Q11** | The retention periods in §6.2 | **Confirm or change each**; the shape (a signed schedule, dates enforced, nothing on a clock) stands either way. Health follows SCRBRD-110 §7.5; safeguarding follows CSA's floor |
| **Q12** | A guardian's access to the coach's notes (reconciliation D1), raised again because minimisation would delete notes nobody was ever shown | **Take the position before the first minimisation**: either a guardian may request them through the office, logged, or the school states in its notice that they are not disclosed. The platform should not choose |
| **Q13** | Should a disabled parent still count as a verified guardian for selection (`player_guardian_status`)? | **Yes.** Disabling is about her sign-in; the relationship is intact. If it is not, the act is a revocation, which asks for a reason |

## 11 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | `player.team_code = NULL` is tolerated by every reader of a player's side (career views, the Squad screen, `player_team()`) | the lead finds the readers that assume a side and gives them the departed case; `player_standing()` is the test to add |
| **A2** | `match_squad`'s trigger can take one more refusal (`player_departed`) without re-emitting db/08's body unguarded | md5-guard the re-emit, as db/77 and db/86 do |
| **A3** | db/34's `role_assignment_linked_guard` refuses, or allows, ending an assignment with a live duty in a way the off-board sheet can show | Opus reads db/34 and the sheet offers "Lift the duty first" or not |
| **A4** | `assignment_subject_read` admits a `security_invoker` read of every state for `guardian.link.manage` holders (db/01 says so) | `child_links` becomes a definer function and a `db/NN` |
| **A5** | `publicName()` answers the position for a row with no name, and `birth_age_group(NULL, …)` takes the conservative branch | both become tests in the minimisation slice before any row is minimised |
| **A6** | The existing force-release route and `pad_resume_revoke()` are callable by the office from the off-board sheet with no new authority | the sheet links to the scoring screen that holds them |
| **A7** | `account_set_active()` can gain `p_reason` by `CREATE OR REPLACE` with db/85's grants kept, and `signin-api.mjs`'s two handlers pass the body | a wrapper function beside it |

---

## 12 · Build slices, in order

| slice | scope (one line) | migration | routes and screens | tier | tests that prove it |
|---|---|---|---|---|---|
| **1 · Disable and enable, from People** | an `accounts` read with inactive rows; Disable/Enable buttons over the two routes that exist; the confirm sheet; the filter that now matches; the "coming" line removed | **none** | `accounts` in `read-api.mjs` and `tables.mjs` (Opus, one resource over `app_user_read`); `people.jsx` (Sonnet); the client's "You were signed out" for `session_revoked` if not already there | **Opus** for the read (a minute); **Sonnet** for the screen; Opus reviews | `smoke-browser-management`: as the office, disable a seeded coach, see "Not active", filter to it, enable it; as the office, the button is refused for the principal (`not_permitted`) and for yourself (`cannot_disable_yourself`); a disabled account's token is `401` on its next read (`smoke-login`, built) |
| **2 · The reason, the preview, the notice** | `account_status_change`; `account_set_active(user, active, reason)`; `account_offboard_preview()`; the enable notice and its door; db/09's `active` write closed (Q3) | **db/NN** | `{ reason }` on disable/enable; `GET /api/auth/users/:id/preview`; the sheet gains the reason and the preview (Sonnet) | **Opus** (schema, definer, policy) | `db/99`: the row is written by the function alone; the person cannot read it; a live scoring token appears in the preview; a stranger's preview is `not_permitted` with no counts; `app_user.active` is not writable by `scrbrd_app` outside the function |
| **3 · A child's links, and the reason for an ending** | `guardian_link_ending`; `guardian_link_revoke(link, kind, reason)`; db/77 and db/62 write the automatic kinds; `child_links` read; the revoked-link notice and its door; the Family links panel | **db/NN** | `child_links?playerId`; `POST /api/players/:id/guardians/:link/revoke { kind, reason }`; Squad → pupil → Family links (Sonnet) | **Opus** (minors' links) | `db/99`: a parent reads none of the ending rows; the office reads kind and reason; a revoked link's public-name consent is incompetent and the child is "Batter" (db/47 unchanged, asserted); `last_verified_link` refused; the notice reaches the ex-guardian with no child's name |
| **4 · A pupil leaving and returning** | `player_departure`; `player_leave()` / `player_return()`; the `match_squad` refusal; future seats voided; the notices; the departure tick for public name; Q9's `RESTRICTIVE` cut; `player_standing()` | **db/NN** | `POST /api/players/:id/leave`, `/return`; Squad → pupil → "Record that he has left" (Sonnet); Family's closed card words (Sonnet, STEP4's card) | **Opus** | `db/99`: after leaving, the coach's injury read is empty and the office's is not; selection refused by name; db/62's link dating observed (minor: birthday; adult: `left_on`); his `selfaccess` still reads his row; the match events are byte-for-byte unchanged (count and `max(seq)` before and after); the physio's read of a departed boy's notes is cut (Q9) |
| **5 · Off-board** | `role_assignments_end_all()`; the `person_left` note and the DSO's no-name notice; the `auth.offboard` log row; the Off-board sheet with the preview, the roles, the token release and the final disable | **db/NN** | `POST /api/users/:id/offboard { assignments[], reason, disable }`; People → Off-board… (Sonnet) | **Opus** (safeguarding touch, transaction) | `db/99`: three roles ended in one transaction, the fourth refused rolls back the first three; the office's answer carries no concern count; the DSO's notice names nobody; the token is released and the pad credential ends with `account_disabled` |
| **6 · Transfer to a school on SCRBRD** | `successor_player_id` (Q6); Westville's enrol screen picks a consented source row; `passport?playerId` on the new row shows source-school lines | **db/NN** (one column, one function) | the enrol screen's "from a school on SCRBRD" (Sonnet) | **Opus** for the function; Sonnet for the screen | `db/99`: without a `passport_consent` naming Westville nothing links; with it, Passport lines appear and no Hilton injury, note or PII row is readable at Westville |
| **7 · Retention** | `retention.mjs` and its test; `retention_due()`; `player_minimise()` and `player_minimisation`; D23's erasure guards on `account_erase()` (140 phase 3, if built by then) | **db/NN** | `retention_due` read; `POST /api/players/:id/minimise { reason, override? }`; Settings → School → Retention (Sonnet) | **Opus** | `db/99`: refused while enrolled, while linked, before the date; the override needs `audit.read` and 20 chars; after minimising, `publicName()` answers "Batter", the events are unchanged, the honours read "Former pupil"; the schedule test fails on an unlisted masked column |

**The smallest slice that closes the solo test's "Disable account and Enable account" gap is slice 1.** It
has no migration, changes one read and one screen, and the two routes it calls exist and are proved by
db/99 §64. It is the only slice small enough for before a freeze; the rest are for after the 15 October
test.

Tiers follow `CLAUDE.md`: every migration, every `SECURITY DEFINER` function, every policy and every read of
a child's links is Opus; screens over an existing API are Sonnet, with Opus reviewing anything that puts a
child's data on a screen; this document's updates to the backlog are Haiku.
