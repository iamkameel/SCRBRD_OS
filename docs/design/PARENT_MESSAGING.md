# Messaging between the school and families (up9): the design

**Status:** design for Kameel's review (Fable, 2026-10-16). Nothing is built. Opus builds the migrations,
functions and routes from §9; Sonnet builds the screens; Opus reviews anything that shows a child's name or a
family's words before it lands.
**Source:** `CLAUDE.md`; `docs/policy/PUBLIC_DATA.md`; `docs/design/SAFEGUARDING_DSO.md` (the DSO, raising a
concern, the four cuts, as built in db/57); `docs/policy/CSA_SAFEGUARDING_CHECK.md` SG-9 (the five proposed
messaging rules); `docs/design/NOTIFICATIONS.md` (the one notice model; S0 and S1 built, db/89, db/91);
`docs/design/SCRBRD-138_captains_view.md` §5; `docs/design/REACH_parent_pupil.md` (side reach; decided, not
built); `docs/design/STEP4_parent_pupil.md`; `docs/design/GA-I20_parent_action_list.md`;
`docs/design/ACCOUNT_LIFECYCLE.md` §3–§6; `docs/design/SCRBRD-124_lift_clubs.md` (the nearest adult-to-adult
model, db/70 and db/76); `apps/web/src/data/roadmap.js` (`up9`); `db/91_notification_one_stream.sql`
(`notification_report()`, the shape the report path copies).
**Reader:** Kameel on a phone first; then the Opus lead; then the Sonnet agent who builds the screens.

---

## 0 · In one page

The roadmap says "secure one-to-one between coach and parent, replacing the WhatsApp group". This design
builds that and draws one line through the middle of it: **messaging on SCRBRD is a surface for adults.** A
pupil is never a participant, never a recipient, never a reader of a message row, and the database refuses him
by a `RESTRICTIVE` policy on every message table, not by a screen that forgot to show him a tab. What a coach
has to say to the boys stays where SCRBRD-138 put it: a post to the side, with every adult on the side reading
it. CSA's "never alone with a child" is kept by construction.

Three kinds of thread, each with an audience the server computes from the reach rules the rest of the app
already uses, never from a list anyone types:

| kind | who is in it | what it is for |
|---|---|---|
| **a child's thread** (slice M1) | his verified, consented guardians; the staff of his current side; the school's office | "Rohan has a dentist at 2; can he leave early?" — the one-to-one the roadmap asked for, except that it is one family to the school, not one parent to one coach |
| **a side's thread** (M2) | every adult the side has: its staff and the guardians of the boys on it | the WhatsApp group's job: "the bus is leaving from the chapel car park, not the gate" and the parents' replies |
| **a lift's thread** (M4) | the driver and the guardians who consented to her lift | the one parent-to-parent case the platform already models (124 §4.3 named it the obvious first use) |

The whole school is not a thread: the school's announcements are `news_post` at school scope, already one
stream with withdrawal and a one-tap report (NOTIFICATIONS D9–D11). Parents do not message each other
privately, and staff do not message each other here.

A message creates one notice through the one notice model (`kind = 'message'`, medium, never high; the push
is the pointer; the notice carries the thread's label and never the message's words). The sender may withdraw
a message; a moderator may hide one with a kind and a reason on the record; neither deletes anything and
neither is silent. Anyone in a thread can report a message in one tap, which puts one no-name notice in front
of the school's DSOs and opens that message to them, logged, exactly as `notification_report()` does for a
notice today. The DSO reads nothing by standing. Messages are kept two years, then purged by the office from a
due list, never a job; a message a DSO attaches to a concern is copied into the concern record at that moment
and lives under the concern's own period.

Fourteen questions for Kameel are in §10. Everything else is decided by the documents above and is not
reopened (§12).

---

## 1 · The rules this design keeps

- **No private channel between an adult and a pupil** (CSA p34 rule 6, p35; SG-9 rule 1; 138 §5.1). Here:
  no channel with a pupil at all.
- **`recipient_id` never names a pupil unless the notice is the system's own** (SG-9 rule 2; db/57's trigger,
  which stays and which this design never has to argue with, because no message notice names a pupil).
- **Every message is kept and can be opened by a DSO on a concern, logged** (SG-9 rule 3). **Anyone can report
  a message in one tap** (rule 4). **No photos** (rule 5; PUBLIC_DATA A8).
- **No child's name on a lock screen or a public page** (PUBLIC_DATA; NOTIFICATIONS D14). Every push is a
  pointer; no message table is ever public (`public.mjs`'s never-public list gains the three tables).
- **The DSO's notices name nobody; a safeguarding notice is the system's** (SAFEGUARDING §1 item 3; db/57).
- **Nothing is deleted silently.** A withdrawal and a hide each leave a stub that says so; a purge is a logged
  act from a due list with a date it may not precede (SAFEGUARDING §1 item 8; lifecycle D22).
- **Audiences are computed, never typed** (REACH §2; db/70's `lift_acting_for()`; db/57's
  `safeguarding_concern_raise()` refusing a child the reporter cannot already see).
- **No new runtime dependency; the floors stand** (`CLAUDE.md`): plain text, 44 px rows, 12 px minimum,
  reduced motion honoured.
- **ADR 0001 and 0003:** one assignment decides, by capability and argument, never by role name; no new role.

---

## 2 · Who may message whom

### 2.1 Plain words

A parent writes to the school about her own child, and the school writes back; the people who read it are the
people who already read his name and his fixtures. A coach writes to the parents of his side, and they reply
where the other parents and the other staff can see. A driver and the parents whose boys are in her car talk
about Saturday's lift. Nobody writes to a child. Nobody writes to another parent in private. Nobody writes
across a school boundary.

### 2.2 The table

| from \ to | a family (about their child) | a side's parents | one other parent | the whole school | a pupil |
|---|---|---|---|---|---|
| **staff of the side** (coach, assistant, team manager) | **yes** — the child's thread | **yes** — the side's thread | no | no (a `news_post` at school scope needs `news.publish.school`) | **never** (a post to the side, 138 §5.2) |
| **the office** (schooladmin, sportsadmin, director of sport) | **yes** | **yes** | no | `news_post`, as today | **never** |
| **a parent** | **yes** — her own child's thread, to the school | **yes, a reply** — if the school allows parents to reply (M2, Q4) | **only inside a lift thread** (M4) | no | **never** |
| **a pupil**, under or over eighteen while at school | never | never | never | never | never |
| **the DSO**, the physio, a scorer, an official, a driver, a spectator, a support session, the pad, the owner's key | no (§4; §2.6) | no | no | — | — |

### 2.3 D1 · Pupils are outside messaging, entirely, in v1

**Decision.** No message table admits a session that `person_is_pupil()` (db/57:292) says is a pupil's: not
as reader, writer, recipient or reporter. That includes the eighteen-year-old still at school.

**Why.** SG-9 rule 1 allows "to the pupil with his guardian copied". Copying is a screen's promise; a
`RESTRICTIVE` policy is a database's. The one thing a coach needs to tell the boys — the plan, the sheet, the
bus — is already a post to the side under db/96 and db/101, read by every adult on the side, which 138 §5.2
called "the clearest form of visible to a second adult". A pupil's route to the DSO is the persona header's
"Raise a concern" and the one-tap report on any notice (db/91). Lift clubs took the same line (124 decision
4) and carved out the adult pupil for his own seat because he had to be able to get home; nothing here is
that necessary. **Q1** asks whether the eighteen-year-old at school should be in his own lift's thread; the
recommendation is no, because `lift_contacts()` already gives him the driver's number on the day.

**Enforced by:** `message_not_pupil` (`RESTRICTIVE`, `NOT person_is_pupil(app_user_id())`) on `message_thread`,
`message` and `message_moderation`; the same test inside every `SECURITY DEFINER` function
(`pupil_excluded`, db/70's word); `separation.test.mjs` asserting `player` and `selfaccess` hold neither
`message.*` capability; the notice shapes of §6, none of which can name a pupil; and db/57's trigger as the
last line.

### 2.4 D2 · One capability for the family-facing conversation, decided by the argument

`message.family` (level 2: it reaches a child's name and a family's words), `ADDED_SINCE_01`, held by:

| role | scope | passes for |
|---|---|---|
| `guardian` | her assignment, through a **verified link with consent granted** | her own child's thread; the side thread of a side her child is on; a lift thread she consented into |
| `coach`, `assistantcoach`, `teammanager` | team | the child threads of boys on the side; the side's thread |
| `schooladmin`, `sportsadmin`, `directorofsport` | school | every child thread and side thread at the school |

The same capability on both ends, and `app_can()`'s person argument decides (REACH §1): a child thread asks
with **the child's id**, so a guardian passes for her own boy and a coach for his side's boys; a side thread
asks with **side reach** (REACH §2.5), so a guardian passes through a boy on the side and the staff through
their team scope; a lift thread asks **the lift's own parties** (db/70's shape). A guardian whose link is
pending, revoked or dated out passes none of them on the next statement (REACH §2.1).

Not holders: `principal` (leadership is not the side's daily correspondent; the office is; **Q3**), `medical`
(health has its own screens and its own share model, SCRBRD-110 §6.3), `dso` (§4), `scorer`, `official`,
`driver`, `spectator`, `player`, `selfaccess`, `enquiry`. `superadmin` holds it as it holds everything outside
`safeguarding.*`, and reads no row anyway: every message table carries db/57's `NOT app_is_platform_wide()`
cut, as the lift tables do.

### 2.5 D3 · A second capability for moderation

`message.moderate` (level 2), held by `schooladmin`, `sportsadmin`, `directorofsport`, `principal` at school
scope and by `coach`, `assistantcoach`, `teammanager` at team scope. It hides a message (§7), reads a hidden
message's body, and closes a thread. The side's staff hold it because on a Saturday morning they are the
adults present when a parent names another child's illness in the side thread; the principal holds it because
the office's own messages must be moderable by someone who is not the office. A guardian never holds it.

### 2.6 D4 · What never exists

- **A parent-to-parent private message.** The school is not a party, the platform would be holding a
  conversation between two adults about (usually) a third family's child, and "message any parent at the
  school" is an enumeration of parents. The lift thread (M4) is the parent-to-parent case the platform can
  justify: an arrangement about named boys, consented to by their own guardians, already recorded.
- **A staff-to-staff message.** Staff have the school's channels; this design is "the school and families".
- **A cross-school thread.** Every thread has one `school_id`; the away side's parents are at their own
  school. The opposition dossier is not a conversation.
- **A thread with a child, a thread among children, or a child as a recipient.** D1.
- **A whole-school thread.** `news_post` at school scope, one stream, with withdrawal and a report (db/91).

---

## 3 · Threads and audiences

### 3.1 Plain words

A thread is a place with a fixed anchor: one child at one school, one side at one school, or one lift offer.
Who is in it is a question the database answers on every read from the anchor and the live assignments, so a
parent whose link ended at ten o'clock reads nothing at one minute past, and a new team manager appointed on
Monday reads the side's thread on Monday. Nobody adds or removes anyone, and nobody can.

### 3.2 D5 · Three kinds, one standing thread per anchor

```
message_thread (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL REFERENCES school(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('child', 'side', 'lift')),
  team_code         text,                                         -- side: required
  subject_player_id uuid REFERENCES player(id) ON DELETE CASCADE, -- child: required
  lift_offer_id     uuid REFERENCES lift_offer(id) ON DELETE CASCADE,  -- lift: required
  opened_by         uuid REFERENCES app_user(id) ON DELETE SET NULL,   -- stamped from the session
  opened_at         timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  closed_by         uuid REFERENCES app_user(id) ON DELETE SET NULL,   -- NULL for a derived close
  close_kind        text CHECK (close_kind IN ('office', 'departed', 'no_guardian', 'season_end', 'lift_done', 'module_off')),
  CONSTRAINT thread_anchored CHECK (
       (kind = 'child' AND subject_player_id IS NOT NULL AND lift_offer_id IS NULL)
    OR (kind = 'side'  AND team_code IS NOT NULL AND subject_player_id IS NULL AND lift_offer_id IS NULL)
    OR (kind = 'lift'  AND lift_offer_id IS NOT NULL AND subject_player_id IS NULL)),
  CONSTRAINT closes_whole CHECK ((closed_at IS NULL) = (close_kind IS NULL))
)
UNIQUE INDEX one_child_thread ON message_thread (school_id, subject_player_id) WHERE kind = 'child' AND closed_at IS NULL
UNIQUE INDEX one_side_thread  ON message_thread (school_id, team_code)         WHERE kind = 'side'  AND closed_at IS NULL
UNIQUE INDEX one_lift_thread  ON message_thread (lift_offer_id)                WHERE kind = 'lift'
```

`db/12`'s `news_post_anchored` is the pattern: a thread whose audience cannot be worked out is a thread the
policy would have to guess about. One open thread per child per school, per side per school, per lift offer.

**Why one standing thread per child, not one per topic or per parent.** GA-I20's rule is one record per
child so that "is this done" has one answer for the family; a conversation is the same: the coach should not
find Monday's dentist note in one thread and Tuesday's in another, and two guardians of one boy should not be
two threads the coach has to reconcile. The cost is **D6**.

### 3.3 D6 · Both guardians of a child are in his thread, and the screen says so

Where a child has two live consented links, both guardians read the whole thread, each other's messages
included, by name (they are adults, and a conversation cannot be read without its speakers). The compose
screen says, above the body, "Rohan's other guardian reads this too." A parent who wants a word with the coach
that the other parent does not see has the phone. A link that is revoked (custody, lifecycle §4) drops that
guardian from the thread on the next statement; her past messages stay, authored by her, because the record
of what the school was told is the school's. **Q2.**

*Rejected — one thread per guardian link:* the coach answers the same question twice; the "one record per
child" rule (GA-I20 §2.4) is broken for the one record where it matters most; and a separated parent who
cannot see what the other told the coach is a worse safeguarding position than one who can.

### 3.4 D7 · The audience, as the function

`thread_member(p_thread uuid) RETURNS boolean` — `STABLE SECURITY DEFINER`, `search_path` pinned, as
`news_plan_reach()` and `lift_acting_for()` are. The caller is a member when **not a pupil** and:

| kind | the test |
|---|---|
| `child` | `app_can('message.family', t.school_id, coalesce(p.team_code, '*'), t.subject_player_id, ZERO)` where `p` is the child's live `player` row **and**, when the passing assignment is a guardian's, that link's `consent_state = 'granted'` (db/70's `consent_not_granted` rule; the office's and staff's assignments carry no link and are not asked) |
| `side` | `side_reach('message.family', t.school_id, t.team_code, ZERO)` (REACH §2.5) — branch 1 the side's and the school's unnamed staff, branch 2 a guardian through a boy on the side with consent granted |
| `lift` | the offer's `driver_id`, or a guardian whose live consented link is the `guardian_link_id` of a seat on the offer whose state is `confirmed` (db/70's test); the office is **not** a party and reads a lift thread only as a moderator (§7) |

The side's audience follows `player.team_code` live: when the office moves a boy to the 1st XI his parents
leave the U15A thread and join the 1st XI's on the next read. A boy playing up on one fixture does not put
his parents in that side's thread (the sheet branch of `fixture_reach()` is for the fixture, not the side).

If REACH's `side_reach()` is not built when M2 is cut, M2 spells the two branches inline as `db/96:184–190`
does, and the REACH refactor re-expresses it later (REACH §6.1 proof 1).

### 3.5 D8 · Opening and closing

| act | by | how |
|---|---|---|
| **open a child thread** | the first message, by any member | `thread_for_child(p_player)` gets or creates it; the caller must already pass D7 for that child, so a parent cannot open a thread about a child she is not linked to and a coach cannot open one about a boy not on his side |
| **open a side thread** | the school's office or the side's staff (`message.moderate` at that side) | `thread_open_side(p_school, p_team)`; it is a deliberate act, because it creates a place thirty adults will write in |
| **open a lift thread** | the platform | `AFTER UPDATE ON lift_seat` when a seat first becomes `confirmed`: one thread per offer, derived, nobody presses anything |
| **close** | `message.moderate` at the thread's school (`office`); or derived: a departed pupil (`departed`, when `player_standing()` says so — lifecycle D6), a child with no live consented guardian link (`no_guardian`), a lift offer `done`, `cancelled` or `void` plus one day (`lift_done`), the module switched off (`module_off`) | a closed thread is read-only to its members: "This thread closed on 30 Nov 2026." No message can be sent; reports still can (§4.3) |
| **season end** | the office | the side thread is closed `season_end` and a new one opened at the first message of the new season; the old one stays readable until purge |

Nothing reopens. A wrongly closed thread is a new thread.

### 3.6 D9 · The school's switch

`messaging` is a `feature_flag` of kind `module`, off for every school, granted per school by the platform as
`lift_club` is (124 §3.1). Within a school, the principal signs one `messaging_policy` row (`school_id`,
`body` 0–2000 characters shown above every compose box in the school's own words, `parents_reply boolean`
default true, `signed_by`, `signed_at`, `withdrawn_at`) under a new `message.policy` capability held by
`principal`, mirroring `transport.lift.policy`. Two keys (124 D17): the module live **and** a signed policy.
Withdrawing the policy closes every open thread `module_off` and tells each member once, naming no child.

---

## 4 · The DSO

### 4.1 By standing: nothing

`dso` holds neither `message.*` capability. A DSO who also coaches reads his side's threads as a coach, and
the design says so in one line on the Safeguarding screen: "What you read as a coach, you read as a coach."
This is SAFEGUARDING §1 item 2 applied: nobody but a DSO reads a concern, and a DSO reads nothing but a
concern by standing.

### 4.2 D10 · A reported message opens to the DSO, with its neighbourhood

`message_report(p_message)` is `notification_report()` (db/91:208–261) for a message, and copies its shape
line for line:

1. the caller must be a member of the thread today and not a pupil (D1), the message not already hidden by
   the caller's own act; anything else answers `no_such_message`, the same for all of them;
2. once per person per message, under an advisory lock, recorded as an `access_log` row with resource
   `safeguarding.message_report` (hidden from ordinary `audit.read` by db/57's `access_log_safeguarding_hidden`
   policy, which already hides every resource starting `safeguarding`);
3. one `notification` to the school's DSOs: `kind 'safeguarding'`, `urgency 'high'`, `scope_level 'school'`,
   `required_capability 'safeguarding.concern.read'`, title "A message was reported at your school", body
   "Someone reported a message in a thread at your school on {date}. Open Safeguarding to read it.",
   `subject_kind 'message'`, `subject_id` the message id. No name, no thread label, no words from the message;
4. the DSO who wrote the reported message does not receive the notice and cannot open it (db/57's fourth cut,
   `notification_report_about_me()`'s shape);
5. returns `(ok, reason, unheld)`; `unheld` true when no DSO holds the appointment, and the screen says "This
   school has not yet appointed a DSO. Tell the school directly, or use The Guardian's app."

`safeguarding_message_open(p_message)` — `SECURITY DEFINER`, `safeguarding.concern.read` at the school, a
report row for this message in `access_log`, the caller not its author — returns the reported message, the
thread's kind and label, and **the thread's messages from the 48 hours before it**, hidden and withdrawn ones
included with their stubs and their bodies, each author named (adults). It logs
`log_restricted_read('safeguarding.message', ARRAY[p_message], ARRAY['body','thread'], school)`. Forty-eight
hours is enough to read a message in its conversation and not enough to read a family's year; the whole thread
is a concern's read (§4.3). **Q11.**

What the reporter gets back: "Reported — the DSO has it." and nothing more, ever (SAFEGUARDING §3.5). The
author of the reported message is told nothing by the platform; a DSO who takes it up does so as a person.

### 4.3 D11 · A concern raised from a message, and the thread under a concern

- **Raising.** "Raise a concern" is on every message's long-press menu beside "Report". It opens the
  existing form (db/57, SAFEGUARDING §3.1) pre-filled: `p_school` the thread's school; `p_subject_player` the
  child, for a child thread; `p_subject_person` the message's author, when the author is an adult the reporter
  may already see in the school's people list; `p_about_kind` left for the reporter. Nothing new is written by
  the raise itself and the receipt is unchanged.
- **Attaching.** After the raise, the same tap calls `safeguarding_message_attach(p_reference, p_message)`:
  the reporter must be the concern's reporter and a member of the thread. It writes one row:

```
safeguarding_message_link (
  id uuid PRIMARY KEY, concern_id uuid NOT NULL REFERENCES safeguarding_concern(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES school(id),
  message_id uuid REFERENCES message(id) ON DELETE SET NULL,     -- the live pointer, until purge
  thread_kind text NOT NULL, thread_label text NOT NULL,         -- copied: "Rohan Pillay · Hilton College"
  author_id uuid NOT NULL REFERENCES app_user(id), sent_at timestamptz NOT NULL,
  body text NOT NULL,                                            -- copied at attach time (D11)
  attached_by uuid NOT NULL REFERENCES app_user(id), attached_at timestamptz NOT NULL DEFAULT now()
)
```

  with db/57's three policy layers and the fourth cut (the named adult never reads it). **The body is copied
  at attach time** so the concern record stands alone when the message is purged on its own schedule (§5),
  which is SAFEGUARDING §1 item 7's "written once" and the referral's "no `concern_id` column" independence
  turned round. A DSO may also attach, from `safeguarding_message_open()`, with the concern reference.
- **Reading the thread.** `safeguarding_thread_open(p_concern, p_thread)` — the DSO at the holding tenant, the
  concern open, the thread linked to it by at least one attached message — returns the whole thread, logged
  `('safeguarding.thread', ARRAY[p_thread], ARRAY['body'], tenant)`. That is SG-9 rule 3's "every message
  kept and openable by a DSO on a concern", and the only read of a whole thread anyone outside it ever has.
- **A share** (SAFEGUARDING §4.4) gains no new word: `what` has no `messages`; a DSO who must show a coach a
  message reads it to him.

### 4.4 What the DSO never has

A list of threads; a search; a message's push; a parent's number from a thread (`safeguarding_family()` under
the concern is the route, as today); any message about a concern that names the DSO (the fourth cut).

---

## 5 · Children's names and data in messages

### 5.1 D12 · Where a child's name appears, and to whom

| surface | what it shows | why that is allowed |
|---|---|---|
| a child thread's label | "Rohan Pillay · Hilton College" to its members | every member already holds his name: a consented guardian; the side's staff and the office under `player.profile.read` |
| a side thread | whatever an adult writes, including children's names | the readers are the side's adults, who read the sheet (STEP4 Q10 decided) and the scorecard by name (Q4); the compose words and moderation (§7) hold the line on *what* is said |
| a lift thread | the boys' names the driver already reads through `lift_passengers()` | 124 §5.1: a request is a name |
| **the notice** (§6) | the thread's label as the body; "New message" as the title | the row is admitted by `message.family` with the child as person anchor, so only his members read it; no message words are ever copied into a notice |
| **the push** | "SCRBRD — You have a new notice." | NOTIFICATIONS D14; a pointer |
| **a public page** | nothing, ever | the three message tables join `public.mjs`'s never-public list, tested against `tables.mjs` as PUBLIC_DATA §3 is |
| **a lock screen, a browser tab title, a URL** | no name | the route is `/app/threads/<uuid>`; the tab title is "Messages" |

A child is never **addressed**: there is no "to" field and no name is typed to find a thread. A child thread
is reached from the child's card (Family for a parent; Squad for staff), so the picker is the list the caller
already reads, as `safeguarding_concern_raise()` refuses a child the reporter cannot see.

### 5.2 D13 · Health, home and discipline words

Not machine-checkable (NOTIFICATIONS D11), so the shape is tied and the words are nudged:

| thread | staff writing | a parent writing |
|---|---|---|
| **child** | **refused** on the word list, with the word handed back: "Health goes through the Health screen, which reaches the physio and is kept properly." Staff have the screens; a message is not where a boy's injury is recorded | **warned**, not refused: "This reads like a health matter. The school keeps health on its own screen; a message here is read by the coach, the team manager and the office. Send anyway?" — a parent telling the coach her son has a cold is what the thread is for, and GA-I20 §4.4 already says the reason is between the family and the coach |
| **side** | **refused** for everyone, as 138 §5.2 refuses a plan's health words and GA-I27 keeps health off every side-readable surface | **refused**, same list |
| **lift** | — | **refused**: the car is not the place |

The list is the SG-10 tone list's shape (a constant in `packages/policy/src/messaging.mjs`, tested), covering
injury, illness, medication, concussion, "unavailable because", and the discipline vocabulary of PUBLIC_DATA
N3; Kameel owns the words. Above every compose box, in every thread, the school's own `messaging_policy.body`
and one platform line: "Nothing about any child's health, home or discipline. Those have their own screens.
Anyone here can report a message to the school's safeguarding officer in one tap."

What a refusal never does: store the refused draft. What a warning never does: block a parent from telling the
school something about her own child. **Q6.**

### 5.3 What a message may not carry at all

No attachment, no image, no voice, no link preview fetched by the server, no location, no phone number
harvested into a row. Body: plain text, 1–2000 characters, the `news_post` CHECK shape. Links are allowed as
text and are not followed.

---

## 6 · Notices: quiet hours, counts, withdrawal

### 6.1 D14 · One notice per message, through the contract

`kind` gains `message` in the closed list (NOTIFICATIONS D1): the CHECK is dropped and re-added in this
design's `db/NN`, `KINDS` in `packages/policy/src/notifications.mjs` gains the word, and the agreement test
holds. `subject_kind` gains `message_thread` the same way (D5's precedent). The contract row:

| kind | writer | required_capability | audience anchor | urgency | pushed | retractable | lives |
|---|---|---|---|---|---|---|---|
| `message` | **only** `message_send()` | `message.family` | child thread: team + `subject_person_id` the child (the "about one child" shape, D7) · side thread: team, no person · lift thread: one row per party with `recipient_id` (db/76's shape) | **medium, always**; never high, never low | yes; preference allowed | yes, by the author's withdrawal (`withdrawn`) and by a hide (`superseded`) | 60 days |

Title "New message"; body the thread's label. **The message's words are never in the notice**, so a withdrawn
message leaves no copy in `notification`, a muted parent misses nothing she cannot read in the thread, and
the open of a `message` notice is **not** logged although its capability is above `news.read` (an exception
to D17's tiered-open rule, written into the contract table, because the row discloses nothing the label did
not). The sender's own row is excluded from `my_notifications` (`published_by = app_user_id()`).

**Side thread notices wait for REACH R-E.** Today `notification_read` passes zeros for a team row with no
person, which admits every guardian at the school (REACH §3.2 O-N). A U15A side-thread notice would reach the
1st XI's parents. So M2 lands after REACH group R-E, or writes one row per member with `recipient_id` until it
does; the lead picks on the day. Child-thread notices are safe now: the person anchor is the child.

### 6.2 D15 · Why never high, and no quiet hours of its own

`high` is for a page: a boy left in a car, a welfare breach, a concern. "The bus leaves in five minutes" is
medium and in-app; the coach who needs a parent *now* has `lift_contacts()`'s window or the emergency
contacts, which are phone numbers for a reason. A `message` can therefore be muted per kind and per child by a
parent (D20; the thread is in-app regardless) and would be held through a minor's quiet hours (D21) if a minor
could receive one, which he cannot. Adults have no quiet hours in v1 (NOTIFICATIONS Q5, decided); a school
that wants "no messages after nine" writes it in `messaging_policy.body`. **Q10.**

### 6.3 D16 · One read state, no read receipts

Read state is `notification_read` and nothing else (D17): opening a thread marks every `message` notice for
that thread read (`thread_read(p_thread)`: `INSERT … SELECT id FROM my_notifications WHERE subject_kind =
'message_thread' AND subject_id = p_thread AND NOT read ON CONFLICT DO NOTHING`), so the Notices badge, the
Family card's "2 unread" and the thread list agree because they are one view. There is no
`message_thread_read` table. **Nobody is shown whether anybody else has read a message** — a coach seeing a
parent has not read is pressure, a parent seeing the coach has not read is grievance — and nobody is shown
"typing". The sender sees "sent 14:02" and, if withdrawn, "withdrawn 14:05". **Q7.**

### 6.4 D17 · Withdrawing a message

The author, any time while the thread is open: `message_withdraw(p_message)` sets `withdrawn_at`, keeps the
body, and calls `notification_retract(notice_id, 'withdrawn', p_say => false)`. Readers see, in the message's
place, "Withdrawn by the sender, 14:05" and nothing else; the author sees the same stub with "Your words are
kept on the school's record and are not shown to anyone." No second notice goes out: D18's "withdrawn" notice
exists so that a phone told a false fifty is told it was false, and a phone here was told only "You have a new
notice"; the stub in the thread is the correction. The data-only recall (D19) runs as for any retraction. A
withdrawn message is still openable by a DSO (§4) and still reportable (the stub carries the report button).

There is no edit. A wrong message is withdrawn and a right one sent.

---

## 7 · Moderation

### 7.1 D18 · Hide, with a kind and a reason, never silently

`message_hide(p_message, p_kind, p_reason)` — `message.moderate` at the thread's school and, for a team-scoped
holder, the thread's side; nobody hides their own (withdraw is theirs); a hidden message cannot be hidden again:

```
message_moderation (
  id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  school_id uuid NOT NULL, thread_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('names_another_child', 'health', 'home_or_contact', 'discipline', 'abusive', 'other')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  hidden_by uuid NOT NULL REFERENCES app_user(id), hidden_at timestamptz NOT NULL DEFAULT now()
)
```

Effect: `message.hidden_at` is set; ordinary members see "Hidden by the school, 3 Oct" in its place, with the
**kind in words** ("it named another child") and never the reason text; the author gets one `system` notice
with `recipient_id` (always an adult): "A message of yours in {thread label} was hidden by the school: it named
another child. The office can say more." — the kind, never the reason; the notice is retracted
(`superseded`, no say); an `access_log` row `message.hide` with the school is written, readable by `audit.read`
at the school; the hidden body stays readable to `message.moderate` holders at the school through
`thread_messages()` and to a DSO under §4. No unhide in v1: a wrongly hidden message is said so to the author
by the office, who asks them to send it again. **Q8.**

### 7.2 D19 · What else a moderator may do

Close a thread (`office`); open a side thread; nothing else. A moderator cannot remove a member (the audience
is computed), cannot write as someone else, cannot edit a message, and cannot delete one. Deletion is the
purge (§8), from a due list, by the office, after the date.

### 7.3 Nothing is deleted, nothing is silent

| act | leaves | who sees the body afterwards |
|---|---|---|
| withdraw | the stub, the body, the author's notice retracted | the author (stub only), a moderator (no: a withdrawal is the author's; `thread_messages()` returns no body for a withdrawn row to anyone but a DSO), a DSO under §4 |
| hide | the stub with the kind, the moderation row, the author's `system` notice, the log row | `message.moderate` at the school; a DSO under §4 |
| close | "This thread closed on {date}" | every member, read-only |
| purge | one `message_purge_log` row per school per period with counts and no names | nobody |

---

## 8 · Retention and endings

### 8.1 D20 · Two years, then purged by the office from a due list

A message is the school's record of what it told a family and was told; it is not the match record and it is
not a health record. The schedule row in `packages/policy/src/retention.mjs` (lifecycle D22):

| kind | tables | keep | then | anchor | who acts |
|---|---|---|---|---|---|
| **messages** | `message`, `message_moderation`; a `message_thread` with no messages left | **recommend 2 years**, the notices' period | delete | `sent_at` | the office (`message.moderate` at school scope), from `message_purge_due(school)`; never a job |
| **a message attached to a concern** | `safeguarding_message_link` | the **concern's** period (SAFEGUARDING §4.7) | the concern's purge | the concern | the DSO |
| **messaging policy rows** | `messaging_policy` | with the school | — | — | — |

`message_purge(p_school, p_before)` deletes messages sent before `p_before` where `p_before <= sa_today() - 2
years`, their moderation rows, their notices' remaining rows (cascade), and threads left empty and closed; it
writes `message_purge_log (school_id, purged_at, purged_by, period_from, period_to, messages integer,
threads integer)`. A linked message's `safeguarding_message_link.message_id` goes `NULL` and its copied body
stands. The period is the information officer's (**Q9**, with lifecycle Q11).

### 8.2 D21 · Endings, each by the rule already decided

| event | what happens to the thread | source rule |
|---|---|---|
| **a parent's link is revoked** (custody, office) | she is out of the child's thread, the side's and any lift thread on the next statement (`app_can()`; D7); her messages stay, authored by her; she gets the link-ended `system` notice and nothing about the thread (it would name the child) | lifecycle §4.2, §4.5; REACH §2.1 |
| **a parent's link dates out** at eighteen after school, or on leaving | the same, on the date; the child's thread closes `no_guardian` when no live consented link remains and it is the office that would otherwise be talking to nobody | STEP4 §3.3; db/62 |
| **the pupil leaves school** (a minor) | the child's thread closes `departed`; his parents keep reading it until their link dates out (they keep his record, lifecycle D11); his side's thread drops them when `player.team_code` is cleared by `player_leave()` | lifecycle §3.3, §3.5 |
| **the pupil turns eighteen at school** | nothing changes: his guardians' links stay open (db/62) and he is still not a member | 138 §6; D1 |
| **staff leave** (`role_assignment_end()`, off-board) | out of every thread on the next statement; their messages stay with their uuid as author; the thread continues; nothing is said in the thread | lifecycle §5.3 ("authored rows stay") |
| **an account is disabled** | sessions stop; membership is untouched; re-enabling restores the reads | lifecycle D1 |
| **an account is erased** (140 §3.8) | the author's name tombstones; the thread shows "Former user" against their messages | lifecycle §6.3 |
| **a child's record is minimised** (lifecycle D24) | `player_minimise()` also deletes his child thread's remaining messages and closes the thread; the label reads "Former pupil" | the identity goes; a conversation about him is identity |
| **the module is switched off** or the policy withdrawn | every open thread closes `module_off`; readable, not writable | 124 §3.1's withdrawal rule |

Nothing moves by the clock but the links (lifecycle Q8's rule); `player_standing()` and `app_can()` are read
on every statement.

---

## 9 · The build

### 9.1 Tables, policies and functions, by name

All hand-written like db/57 and db/70 (RLS on, `INSERT/UPDATE/DELETE` revoked from `scrbrd_app`, written
only through the functions), not generated from `tables.mjs`: the generator cannot say "a hidden body is the
moderator's". `SELECT` is granted to `scrbrd_app` with the policy set below so a `security_invoker` list read
is safe, but no message table is a `read-api.mjs` resource; the functions are the doors (SAFEGUARDING §4.2's
rule).

```
message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES message_thread(id) ON DELETE CASCADE,
  school_id uuid NOT NULL,                                         -- denormalised by trigger
  author_id uuid NOT NULL REFERENCES app_user(id),                 -- stamped from the session; never a parameter
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  sent_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  hidden_at timestamptz,
  notice_id uuid REFERENCES notification(id) ON DELETE SET NULL,   -- child and side threads: the one row
  CONSTRAINT one_fate CHECK (NOT (withdrawn_at IS NOT NULL AND hidden_at IS NOT NULL))
)
INDEX ON message (thread_id, sent_at DESC)
```

Policies on `message_thread`, `message`, `message_moderation`, `messaging_policy` (the last readable by any
enrolled person at the school, as `lift_policy` is):

1. permissive SELECT: `thread_member(thread_id)` — on `message`, additionally `hidden_at IS NULL AND
   withdrawn_at IS NULL OR author_id = app_user_id() OR app_can('message.moderate', school_id, …)`;
   on `message_moderation`: `message.moderate` at the school;
2. `RESTRICTIVE` `message_not_pupil`: `NOT person_is_pupil(app_user_id())`;
3. `RESTRICTIVE` support: `app_support_access_id(school_id) IS NULL` (db/22);
4. `RESTRICTIVE` platform-wide: `NOT app_is_platform_wide()`;
5. db/50's pad guard.

Each asserted restrictive in its own file (db/41:289's shape).

| function | who | does |
|---|---|---|
| `thread_member(thread)` STABLE | internal; the policies | D7 |
| `thread_label(thread)` STABLE | members | "Rohan Pillay · Hilton College" / "U15A parents · Hilton College" / "Lift to Kearsney, Sat 10 Oct · Mrs Naidoo" |
| `thread_for_child(player)` | a would-be member | gets or opens the child's thread (D8); `module_off`, `not_permitted`, `pupil_excluded`, `consent_not_granted`, `departed` |
| `thread_open_side(school, team)` | `message.moderate` at the side | opens; `already_open` |
| `message_send(thread, body)` | a member; the thread open | the word rule of D13 (`word_refused` with the word; `word_warned` is the client's, from the same list); inserts; writes the notice(s) of D14; returns `(ok, reason, id)` |
| `message_withdraw(message)` | the author | D17 |
| `message_hide(message, kind, reason)` | `message.moderate` at the school and side | D18 |
| `message_report(message)` | a member | D10; `(ok, reason, unheld)` |
| `thread_close(thread, kind)` | `message.moderate` at the school; the platform's triggers for the derived kinds | D8 |
| `my_threads()` | anyone signed in, not a pupil | the caller's open and closed threads: kind, label, `last_at`, unread (from `my_notifications`), `closed_at`; a child thread only where D7 passes today |
| `thread_messages(thread, before, limit)` | a member | messages newest first, 50 at a time; author name (adult; "Former user" if tombstoned), `sent_at`, body or the stub of §7.3; hidden bodies only to `message.moderate` |
| `thread_read(thread)` | a member | D16 |
| `safeguarding_message_open(message)` | `safeguarding.concern.read`; a report on it; not its author | D10 |
| `safeguarding_message_attach(reference, message)` | the concern's reporter who is a member; or a DSO at the holding tenant | D11 |
| `safeguarding_thread_open(concern, thread)` | the DSO at the holding tenant; the concern open and linked | D11 |
| `messaging_policy_sign(school, body, parents_reply)` / `_withdraw(school)` | `message.policy` | D9 |
| `message_purge_due(school)` / `message_purge(school, before)` | `message.moderate` at school scope | D20 |

Capabilities (`capabilities.mjs`, each `ADDED_SINCE_01` with a `LEVEL`): `message.family` (2),
`message.moderate` (2), `message.policy` (1). Roles as §2.4–§2.5. `separation.test.mjs`: `dso`, `player`,
`selfaccess`, `spectator`, `medical`, `scorer`, `official`, `driver`, `enquiry` hold no `message.*`; no bundle
holds both `message.*` and `safeguarding.*`; `guardian` holds `message.family` and not `message.moderate`.

### 9.2 Routes and screens

Routes in `services/api/write/messaging-api.mjs` (`/api/threads/*`), each calling one door as the caller:
`GET /api/threads` (`my_threads`), `GET /api/threads/:id?before=` (`thread_messages`; marks read),
`POST /api/players/:id/thread` (`thread_for_child`), `POST /api/threads/:id/messages` (`message_send`),
`POST /api/messages/:id/withdraw`, `/hide`, `/report`, `POST /api/threads/:id/close`,
`POST /api/schools/:id/messaging-policy`, `/withdraw`, `GET /api/safeguarding/messages/:id`,
`POST /api/safeguarding/concerns/:ref/attach`, `GET /api/safeguarding/concerns/:ref/threads/:id`,
`GET /api/schools/:id/messages/purge-due`, `POST …/purge`.

| screen | who | where it lives |
|---|---|---|
| **Messages** (the thread list) | parents, staff | parents: Family → each child's card gains "Messages · 2 unread ›"; staff: a "Messages" destination in the "You" group; both open the same list screen filtered to that child or side |
| **A thread** | members | one screen for every kind: label, the school's policy line and the platform line above the box, messages oldest at the bottom, the compose box (44 px send); long-press a message: Withdraw (own) · Hide (moderator) · Report · Raise a concern |
| **Open a side thread** | `message.moderate` at the side | Squad → the side → "Parents' thread" |
| **Settings → School → Messaging** | principal | the policy words, `parents_reply`, sign and withdraw; the purge due list for the office |
| **Safeguarding** (existing) | DSO | the reported-message notice opens `safeguarding_message_open()`; a concern's page gains "Messages attached" with `safeguarding_thread_open()` |
| **Notices** (existing) | members | a `message` row opens the thread |

Not in the pupil app: no tab, no card, no empty state about messaging, as 138 §7 keeps a missing honour
invisible.

### 9.3 Slices

| slice | scope | migration | tier | proof |
|---|---|---|---|---|
| **M1 · a child's thread** | `message_thread` (`child` only live), `message`, `message_moderation`, `messaging_policy`; the three capabilities and role rows; `thread_member`, `thread_label`, `thread_for_child`, `message_send` (D13's refuse list for staff), `message_withdraw`, `message_hide`, `message_report`, `safeguarding_message_open`, `thread_close` (`office`, `departed`, `no_guardian`, `module_off`), `my_threads`, `thread_messages`, `thread_read`, `messaging_policy_sign/_withdraw`; the `message` kind and `message_thread` subject kind in the CHECKs and `notifications.mjs`; `public.mjs` never-public; `retention.mjs` row; the `messaging` module flag; the routes; the parent's and staff's screens; Settings → Messaging | **one `db/NN`** | **Opus** migration, policy, routes; **Sonnet** screens; **Opus** review | `db/99` section: a pupil (`player`+`selfaccess`, under and over eighteen) reads zero rows of every message table and is refused every function; a parent reads her child's thread and not another family's; a pending-consent link reads nothing; a revoked link reads nothing on the next statement; the coach reads his side's boys' threads and not another side's; the office reads all at its school and none at another; the DSO reads nothing by standing, reads a reported message with its 48 hours, is refused one he wrote; a support session, the pad and the owner's key read zero rows; a withdrawn body is returned to nobody but a DSO; a hidden body only to `message.moderate`; a hide writes the row, the log and the author's notice with the kind and not the reason; a report writes one no-name DSO notice and refuses a repeat; the `message` notice reaches both guardians and the side's staff and no other parent at the school; `recipient_id` never a pupil (db/57's trigger, re-asserted). `tools/smoke-messaging.mjs` and `smoke-browser-messaging.mjs` (the parent's Family card, the thread, send, withdraw, the warning on a health word, report; the coach's Squad path, hide; the DSO's open). `smoke-a11y` floors. `interface-review` on the diff |
| **M2 · the side's thread** | `side` kind live; `thread_open_side`; `parents_reply` honoured in `message_send`; D13's refuse list for everyone; `season_end` | **`db/NN`**, after REACH R-E (or per-recipient notice rows, §6.1) | Opus; Sonnet | `db/99`: a U15A parent reads the U15A thread and not the 1st XI's; a boy moved by the office moves his parents on the next read; a 1st XI parent receives no U15A notice; `parents_reply = false` refuses a guardian's send and admits staff |
| **M3 · the thread under a concern** | `safeguarding_message_link`, `safeguarding_message_attach`, `safeguarding_thread_open`; the raise-from-message prefill | **`db/NN`** | Opus | `db/99`: the link row holds a copied body; the DSO reads the whole thread only while the concern is open and linked; the named adult reads none of it; purge nulls the pointer and the copy stands |
| **M4 · the lift's thread** | `lift` kind; the `lift_seat` trigger; per-party notices; `lift_done` | **`db/NN`** | Opus | `db/99`: the driver and the consenting guardians read it, the office and the eighteen-year-old passenger do not; a withdrawn seat leaves the thread on the next statement |
| **M5 · purge and lifecycle hooks** | `message_purge_due`, `message_purge`, `message_purge_log`; `player_minimise()`'s hook; the due list on Settings | **`db/NN`**, with lifecycle slice 7 | Opus | `db/99`: refused before the date; a linked message's pointer nulls and its copy stands; the log names nobody |

**M1 is the first slice**: one migration, one route file, two screens and a Settings panel. It is the
roadmap's "one-to-one between coach and parent", made one family to one school. M2 is the WhatsApp group. M3
and M4 are each one small migration. M5 waits for the retention schedule to be signed.

---

## 10 · Questions for Kameel

Each with the recommendation; "as recommended" answers all fourteen.

1. **Pupils are outside messaging entirely in v1, the eighteen-year-old at school included.** The coach's
   words to the boys stay a post to the side. *Recommendation:* **yes.** A `RESTRICTIVE` policy is a stronger
   promise than "with his guardian copied", and nothing a boy needs from the school is a message.
2. **Both guardians of a child read his one thread, each other's messages included, and the screen says so.**
   *Recommendation:* **yes.** One record per child; a separated parent who can see what the other told the
   coach is the safer position.
3. **Who reads a family's thread on the school's side: the side's coach, assistant and team manager; the
   office (schooladmin, sportsadmin, director of sport). Not the principal, the physio or the DSO by
   standing.** *Recommendation:* **as listed.** The principal moderates (D3) and reads a hidden body that way;
   the physio has the Health screens; the DSO has the concern.
4. **The side's thread lets parents reply, as a school switch (`parents_reply`) defaulting to on.**
   *Recommendation:* **yes, default on.** Without replies the side thread is a `news_post`; the switch lets a
   school start one-way.
5. **No private parent-to-parent messages; the lift thread is the parent-to-parent case.**
   *Recommendation:* **yes.** The platform should hold no conversation between two adults the school is not
   party to.
6. **Health, home and discipline words: refused to staff in a child's thread, warned for a parent there;
   refused to everyone in a side or lift thread.** *Recommendation:* **yes.** A parent must be able to say
   her son has a cold; a coach must not write a boy's injury where no health policy reads it.
7. **No read receipts and no typing indicator; the sender sees "sent" only.** *Recommendation:* **yes.**
8. **A hidden message shows the kind to the author and the thread, never the reason text; no unhide.**
   *Recommendation:* **yes.** The reason is the office's record; a wrongly hidden message is sent again.
9. **Retention: two years from sending, purged by the office from a due list; a message attached to a
   concern is copied into the concern at attach time and follows the concern's period.** *Recommendation:*
   **yes**, with the period confirmed by you as information officer alongside lifecycle Q11.
10. **Message notices are medium always: pushed, mutable by a parent's preference, never high; no quiet
    hours of their own.** *Recommendation:* **yes.** A page is for safety; a school's "not after nine" is a
    line in its policy text.
11. **A reported message opens to the DSO with the thread's messages from the 48 hours before it; the whole
    thread only under a concern.** *Recommendation:* **yes.** Enough to read a message in its conversation,
    not enough to read a family's year.
12. **The module is off for every school until you grant it, and live within a school only while the
    principal's signed messaging policy stands (two keys, as lift clubs).** *Recommendation:* **yes.**
13. **The whole school stays `news_post`; there is no school-wide thread.** *Recommendation:* **yes.**
14. **The withdrawal of a message sends no second "withdrawn" notice; the stub in the thread is the
    correction.** *Recommendation:* **yes.** The phone was told only "You have a new notice."

---

## 11 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| A1 | `person_is_pupil()` (db/57:292) answers true for a `player` or `selfaccess` holder of any age while at school, as db/70's `not_pupil` relies on | the `RESTRICTIVE` cut uses db/70's `lift_uncut()` test instead; same proof |
| A2 | `notification`'s `kind` and `subject_kind` CHECKs can be dropped and re-added in a `db/NN` (NOTIFICATIONS D1 and D5 did it in db/89) | the kind is added `NOT VALID` and validated in the same file |
| A3 | `notification_retract()` (db/89) accepts `p_say = false` from a `SECURITY DEFINER` caller that is not a trigger | `message_withdraw()` sets the retraction columns directly under the same rules |
| A4 | `player_standing()` (lifecycle D6) exists when M1 lands, or `player.team_code IS NULL` after `player_leave()` is a usable stand-in for `departed` | `thread_close('departed')` is called from `player_leave()` as a hook instead of derived |
| A5 | REACH group R-E (notices follow the side) lands before M2 | M2 writes one notice row per member with `recipient_id` (D7's family shape); a thirty-parent side is thirty rows per message, which `notification_push_job` handles |
| A6 | `side_reach()` exists when M2 lands | M2 spells the two branches inline, as `db/96:184–190` does |
| A7 | A `feature_flag` of kind `module` can be granted per school by the platform exactly as `lift_club` is (db/70) | the switch is a column on `messaging_policy` instead and the platform key is the owner's |
| A8 | The compose warning for a parent (D13) can be a client-side pass over the same word list the server refuses with, so a warned send carries `p_acknowledged = true` and the server logs nothing about it | the server returns `word_warned` once and accepts the second send |

---

## 12 · What this document does not reopen

- **SG-9's five rules** (`CSA_SAFEGUARDING_CHECK.md` §4.3), db/57's `recipient_id` trigger, and 138 §5's
  "to the side, never to him alone".
- **NOTIFICATIONS D1–D22**: this design adds one kind and one subject kind to the closed lists and one row to
  the contract table, and changes no mechanism; a message's push, read state, retraction and preferences are
  that design's.
- **REACH D1–D5** and the two helpers; the side thread's audience is `side_reach()` and waits for it.
- **SAFEGUARDING §1–§4**: the concern record, the four cuts, the hidden log rows, the share's `what` list. A
  message reaches a DSO only through a report or a concern.
- **PUBLIC_DATA** in every line: nothing here is public.
- **Lifecycle D11–D24**: links, departures, minimisation and the retention schedule's shape; this design adds
  one row to the schedule and one hook to `player_minimise()`.
- **124's lift model**: the lift thread reads the seats and offers db/70 wrote and writes none.
- **Photos, voice, attachments** (A8; SCRBRD-092's own design), **group chats among pupils**, **search across
  threads**, **editing**, **reactions**, **email or SMS fallback**, **scheduled sending**, **staff-to-staff
  and cross-school threads**: none in v1; each would be a design of its own.
