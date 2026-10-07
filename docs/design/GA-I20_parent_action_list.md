# GA-I20 — The parent's action list, per child: the design

**Status:** Decided 2026-10-07 (Kameel): D1–D14 as recommended, Q1–Q7 as recommended; A0 approved for before the 12 Oct freeze (merges by 10 Oct or waits). Designed by Fable, 2026-10-07. For after the 15 Oct solo test; §7 A0 is the one slice small enough for before the 12 Oct freeze, only if Kameel wants it.
**Source:** `audit/GAP_ANALYSIS_2026-10-05.md` (I20, phase B; the private report's "a parent sees their selected child's consent, time/place and collection" and "child-specific purpose; version/time/declared-by; pending does not mean approved", not quoted further); `docs/design/GA-I09-I11_match_day_queue.md` §1–§5 (**the staff twin: this mirrors its row shape, its clock rule and its words**); `docs/design/STEP4_parent_pupil.md` (**the base: this extends it; §2.1, §3, §4 and the as-built §10 stand unchanged**); `docs/design/SCRBRD-124_lift_clubs.md` (as built, db/70 and db/76); `docs/design/SCRBRD-140_signup_and_school_linking.md` §3.3, §3.7, §4; `docs/design/SAFEGUARDING_DSO.md` §2.5, §3.1, §4.4; `docs/policy/PUBLIC_DATA.md`; `db/00` 523 (`assignment_subject`), `db/08` 1125 (`guardian_consent_record`), 2973 (`match_availability`), 3052 (`availability_declarant`), 4630 (`emergency_contact`); `db/60` (`health_monitoring_consent`, `my_health_consents()`); `db/62`; `db/70` (`lift_seat_status`, `lift_acting_for`, `lift_offers_for`, the link triggers); `services/api/read/read-api.mjs` (`my_children`, `availability`, `consents`, `role_requests`, `emergency_contacts`); `apps/web/src/views/family/*.jsx`, `lib/family.js`, `views/lifts.jsx`, `views/publicname.jsx`.
**Reader:** Kameel on a phone first; then the Opus lead; then the Sonnet agent who builds the screen.

---

## 0 · In one page

A parent opens the family app on a Friday and the Home tells her where her son is playing and whether she has answered. It does not tell her what else is waiting: the lift she asked for that the driver re-timed, the public-name consent nobody has answered, the number the school has for nobody. This design adds **one list per child, "To do for Rohan"**, drawn from the reads the family app already makes, in the staff queue's shape: **a row is a fact the server can prove, with an owner, a clock and one door**, re-derived every time the screen opens, never marked done, never stored on the device.

Ten kinds of row (§2): an answer owed for a fixture, an answer to give again after a move, a lift seat to confirm again, a seat still only asked for close to the day, requests on her own lift to answer, her own lift to re-offer after a move, a handover to confirm on the day, a consent not yet answered (the terms, the public name, health monitoring where the school runs it), and no number to ring. Beside the list, **"What you have agreed"**: every consent the platform holds about him, each with its version, the time it was recorded and who gave it, in the server's own words.

**Each child is a list of his own, under his own school's name.** Two boys at two schools are two lists and two counts; nothing sums them. A coach who is a parent elsewhere gets her child's list from her child's reads, narrowed to him before anything is counted; the coach's queue (GA-I09) never bleeds in. A pending link is said as pending, with the sentence "this does not mean it was approved"; a revoked one is said as ended. A read that fails is a row that says so, never a zero (I08). The pupil gets the same module with `self`: under eighteen his answer rows only; at eighteen and still at school, his own consents and his own seat.

**No migration in A0 or A1.** Two small count reads are added so the list never makes a logged read on a glance. The revoked-link word and the terms' in-app agreement are A2, Opus.

---

## 1 · The problem and the decisions

### 1.1 Who, and what she asks

| reader | the question on a Friday | what today gives her | what the list adds |
|---|---|---|---|
| **a parent, one child** (`guardian`, one verified link) | what must I do for Rohan before Saturday | the next fixture card with his answer and "Change"; lifts on the fixture; consents behind Family → Consents; contacts behind Who to ring | one list: every owed answer, seat, handover, consent and number, each with by-when and a door |
| **a parent of two, at two schools** (the seed's `db/98` 387–388) | the same, for each, without mixing them | the switcher; Family with a card per child | a list per child on Home, a count per child on Family; no sum |
| **a coach at A who is a parent at B** (Sarah) | the same, as a parent | the staff menu plus the family Home and Family (STEP4 §10 departure 2) | her child's list from her child's reads; nothing of A's side |
| **a parent whose link is pending** | has the office done it yet | "No child is linked to your account yet" | "Your request is with the office · asked 4 days ago · this does not mean it was approved" |
| **a parent whose link was revoked** | why is he gone | the same "No child is linked" | "Your link to a child at Hilton College ended on 3 Oct. Ask the office." (A2) |
| **the pupil** (`player` + `selfaccess`) | have I answered | "You said: available · Change" on his Home | the same list, narrowed to what he may do (§3.5) |

Not readers: the coach (GA-I09 is his), the office, the DSO, a spectator, an account with no school (SCRBRD-140 §4: it reaches its own requests and nothing else, and the join screen already says so).

### 1.2 The decisions

| # | decision | recommendation | alternatives, and why not |
|---|---|---|---|
| **D1** | Where it lives | **On Home, the second card, under the next fixture, for the chosen child; on Family each child's card carries "N to do ›" opening his Home** | first on Home (no: the next fixture is job 1, STEP4 §2.1); a fifth bar item (no: four and no More); only on Family (no: Friday's glance is Home) |
| **D2** | A task table, "done", dismiss, snooze | **None.** A row leaves when its source changes; nothing is stored on the device but the chosen child (STEP4 §3.1, already) | a server-side dismiss (no: the first thing it hides is a consent nobody answered; the queue's D4 and D7 hold here) |
| **D3** | The clocks | **The queue's own clock, labelled as such:** 48 h before `starts_at` for answers (the feed's `isSoon`, GA-I09 §2.4); the offer's `meet_at` for seats; db/76's thirty minutes for a handover; the next fixture's start for a missing number; none for a consent, its age shown | school-set deadlines (no: a `school_setting` and a paste; nothing the pilot asked for) |
| **D4** | The window | **14 days, later fixtures folded under "Later · 2 to answer"** | 7 days as the queue (a parent plans two weekends; the coach plans one) |
| **D5** | What is a row | **Only what she must do.** "Waiting on the driver", "waiting on the office" is said on the fixture card or the link line, not counted. One exception, R4: a seat still only asked for inside 48 h of meeting is hers to decide about | a "waiting on others" section (no: it is a second list, and a count of other people's work reads as hers) |
| **D6** | Which consents make a row | **Only those the platform asks and that have a "not answered" state the server returns: the terms (`consent_state`), the public name (db/47), health monitoring where the module is on (`consents.module_on`).** Scouting and the passport are standing choices and sit in the record only. Each makes one row, never a repeat | every consent (no: a nag for a scouting consent that is off by default and meant to be) |
| **D7** | Agreeing the terms in the app | **A2, Opus:** `POST /api/players/:id/guardians/consent` exists and `guardian_consent_record()` takes the guardian's own say; the screen shows the terms text and its version, both a platform constant Kameel approves. Until then the row says "The office will ask you", as today | office only, for ever (STEP4 §4.3 drew it read-only; the function says otherwise, and the parent's consent is hers to record) |
| **D8** | Logged reads | **Never on a glance.** Contacts are counted through a count read (N2); requests on her lift through a count under RLS (N3); `lift_my_day()` is read on the day only, as `LiftsToday` does now, and a family's own card is not logged (db/76 §5.4) | read `emergency_contacts` for the count (no: the API logs the phone fields on every read, and a parent glancing at Home has asked for no disclosure, `childfile.jsx`'s own rule) |
| **D9** | Pending and revoked links | **Pending from `role_requests` (`mine`, A1); revoked and rejected from a `my_links` read (A2, Opus).** The words in §4.3 | "No child is linked" for both (no: the rule is that pending is said plainly, and a revoked parent should not be told nothing) |
| **D10** | Two children, two schools | **A list per child under the school's name; a count per child on Family; no total anywhere** | a labelled sum "3 to do · Rohan 2 · Anika 1" (allowed by the rule; not needed by anyone) |
| **D11** | A coach who is a parent | **The module takes one child and narrows every read's rows by `child.id` before a rule runs; a static test holds that no rule counts rows for another `playerId`; GA-I09's rows never appear** | — (the rule of STEP4 §3.1 and GA-I07; not open) |
| **D12** | The pupil | **The same module with `self`: under eighteen his answer rows (R1, R2) only; at eighteen and at school, R8b/R8c as his (`ask_at_18`) and his own seat (R3, R4, R7); never contacts (STEP4 Q7)** | nothing for pupils (no: he already declares from his Home; a list of one row is still the honest list) |
| **D13** | Eighteen (db/62) | **No consent row for an adult child: the server's `can_say_yes` and `how = 'guardian_adult'` decide, never an age on the client. A thirty-day information line from `valid_until` when it is dated. Lifts, answers and contacts stay hers while the link is live** | — (STEP4 §3.3 and db/62 decided it) |
| **D14** | The pre-freeze slice | **A0: R1 and R2 only, as a card on Home, pure module and test; only if Kameel wants it before 12 Oct** | nothing before the freeze (fine: the 15 Oct test is Kameel alone, and the invented parents are verified and consented, so A0 is what he would see) |

---

## 2 · The rows

### 2.1 Plain words

A row is one sentence from one record, with four things beside it: whose it is, by when, where it came from, and the one door that opens the exact fixture, seat or card where the answer is given. Nobody closes a row. When the record changes, on this phone or any other, the row changes or goes.

### 2.2 A row

| field | what it holds | rule |
|---|---|---|
| **fact** | one sentence, the child named once, the fixture in its own words | never the reason for anything (§4.4) |
| **source** | the read and the row (`availability?matchId`, `/api/matches/:id/lifts`, `consents`, …) | drawn as "from the fixture's answers", for "why am I seeing this" |
| **owner** | "you", "you or Rohan", "you or his other parent", "you, as the driver" | from the function's own rule of who may write it |
| **clock** | §1.2 D3 | labelled "the list's clock" |
| **door** | one: the fixture (P3), the lifts block on it, the day card, Consents, Who to ring | never "mark done" |
| **state** | `open`, or `could_not_read` with the read's name | a failed read is a row that says so; an empty read is no row (I08) |

### 2.3 The rows, by source

| # | row | source (read) | appears when | clears when | clock | owner; done by someone else? | the one door |
|---|---|---|---|---|---|---|---|
| **R1** | **An answer owed** · "Answer for Sat v Kearsney" | `matches` (the child's side, `isTheirs`), `availability?matchId` → her child's row | the fixture is `upcoming`, inside the window, and the child's row has `status = null` (no row: "silence is not a yes", db/08) | any row exists with a status, whoever wrote it | 48 h before `starts_at` | you or Rohan (`availability.declare` on both); **the boy's answer, the other parent's, or the coach's "according to the coach" clears it for every guardian** (one row per player per match); the fixture card says who said it | P3, the answer block |
| **R2** | **Answer again** · "Sat v Kearsney moved: say again" | the same read, `needs_reconfirming = true` (db/65, SCRBRD-122) | the fixture's time, ground, format or overs changed after the answer | a new declaration (the one-tap "Still available", or a change) | 48 h before the new start, or now if nearer | as R1; a re-declaration by either clears it | P3, "Still available" |
| **R3** | **A seat to confirm again** · "Rohan's seat with Mrs Naidoo for Sat: confirm again" | `GET /api/matches/:id/lifts` (`lift_offers_for`) → `my_seats[].status = 'awaiting_guardian'` | the driver changed the lift, or the fixture moved and she re-affirmed, and the seat's `guardian_ok_version` is behind | `lift_seat_reconfirm()` or `lift_seat_withdraw()` | the offer's `meet_at` | you or his other parent (D13 of 124: either consents, a "no" from either ends it); **the other parent's reconfirm clears it** | P3, the lifts block |
| **R4** | **A seat still only asked for** · "Rohan's seat for Sat is not confirmed; the driver has not answered" | the same read → `my_seats[].status = 'requested'` | inside 48 h of `meet_at` and the status is still `requested` | confirmed, declined, withdrawn, or the lift passes | `meet_at` | you: withdraw and ask another, or ring; the driver's acceptance clears it | P3, the lifts block |
| **R5** | **Requests on your lift** · "2 families have asked for a seat on your lift there on Sat" | **N3** `lift_requests_mine` (counts per offer, under RLS, no name) | her offer is `open` and seats are `requested` on it | she accepts or declines each; the lift closes | `meet_at` | you, as the driver; nobody else can | her driver's card on P3, where the names are read on the tap (logged) |
| **R6** | **Still offering?** · "Sat v Kearsney moved. Do you still offer the lift?" | `lift_offers_for` → `is_mine` and `awaiting_driver` | the fixture trigger moved the offer's version past `driver_version` | `lift_offer_reaffirm()` or cancel | `meet_at` | you, as the driver | her driver's card |
| **R7** | **Confirm collected** · "Mrs Naidoo says Rohan was handed over at 16:35. Confirm." | `GET /api/matches/:id/lifts/day` (`lift_my_day`), **on the day only** → a `back` seat with `mayReceive`, the car left or `handedOverAt` set, no `acknowledgedAt` | as stated | `lift_receive()` (the "Confirm collected" tap); or the office's `lift_resolve()` | thirty minutes from `handed_over_at` (db/76 D14) | any live guardian of the boy; **either parent's tap clears it**; at eighteen the boy's own "I am home" | the family day card on Home |
| **R8a** | **The terms** · "The school's terms for Rohan are not agreed yet" | `my_children.consent_state` ≠ `granted` (`pending` or `withdrawn`) | as stated | `guardian_consent_record()` — the office's today; hers in A2 (D7) | none; "since {valid_from}" | you (your own link; the other parent's link is her own row and does not clear yours) | Family → Consents, the terms card ("The office will ask you" until D7) |
| **R8b** | **His name on public pages** · "Not answered: Rohan is 'Batter' on public pages until someone answers" | `GET /api/players/:id/public-name` → no record from any competent giver (`mine` absent and `answers` empty) ; or `mine.state = 'superseded'` by a newer wording | nobody has answered; or the wording moved | any giver's record: **the other parent's or the office's answer clears it** ("the latest record governs", db/47); a "no" clears it as surely as a "yes" | none; age shown | you or his other parent; the office from a form | Consents, the public-name switch |
| **R8c** | **Health monitoring** · "Not answered, and Hilton College runs it" | `consents` (`my_health_consents()`) → `state = 'not_answered'` and `module_on` and `can_say_yes` | as stated; never where the module is off | any giver's record; the other parent's clears it | none | you or his other parent | Consents, the health card |
| **R9** | **No one to ring** · "No number is on record to ring if Rohan is hurt" | **N2** `emergency_contact_count?playerId` → `active = 0` | zero live contacts | one live contact, by you or the office | the next fixture's `starts_at` | you (`player.emergency.manage`); the office; **the other parent's number clears it** | Family → Who to ring |

Information lines beside the list, counted as nothing: a pending request (§3.3), a link ending within thirty days (§3.6), an adult child's consents being his own (§3.6), the never-public mark (as STEP4 §4.2 draws it: a fact, never a reason).

### 2.4 Why one parent's answer clears the other's row

Every source above is **one record per child** (one availability row per match, one seat per boy per leg, one governing consent, one contact list), so the question "is this done" has one answer for the family. The list draws that answer, and the fixture or consent card says who gave it ("said by Dad, Tue"; "On since 14 Jan, recorded by the guardian"). The one record that is per link, not per child, is the terms (R8a): each parent's link carries its own `consent_state`, and the list says so ("your own agreement").

### 2.5 Grouping and order

Inside one child's list: **by date, the nearest first**; rows with no date (consents, the number) after the dated ones, in the fixed order R8a, R8b, R8c, R9. Fixtures beyond fourteen days fold under "Later". Nothing is ranked and nothing is a priority: a consent is not "high".

---

## 3 · Who sees what

### 3.1 The screen

```
┌──────────────────────────────────────┐
│ [ Rohan ]  [ Anika ]                 │  the switcher, as today
│ Rohan · Hilton College · U15A        │
├──────────────────────────────────────┤
│ SATURDAY 10 OCT                      │  the next fixture card, unchanged (P1)
│ …                                    │
├──────────────────────────────────────┤
│ TO DO FOR ROHAN · 3                  │  the count: rows open, after every read answered
│  Answer for Sat v Kearsney           │  R1
│   you or Rohan · by Thu 09:00        │  owner, the list's clock
│   from the fixture's answers Answer ›│  source, door (44 px row)
│  Rohan's seat with Mrs Naidoo for    │  R3 — an adult's name; never another boy's
│  Sat: confirm again                  │
│   you or his other parent · by 07:15 │
│                          Lifts ›     │
│  No number on record to ring if      │  R9, from a count: no phone on this screen
│  Rohan is hurt                       │
│   you · before Sat        Who to ring ›│
│  Could not read the lifts for Wed    │  I08: a failed read is a row
│   [ Try again ]                      │
│  Later · 1 fixture to answer (24 Oct)│  folded
├──────────────────────────────────────┤
│ WHAT YOU HAVE AGREED                 │  the record, not the list
│  Name on public pages: on            │
│   given by you · 14 Jan 2026 14:02 · v1│  giver, time as recorded, version
│  Health monitoring: not in use here  │  module off: no row, said once
│  The terms: agreed · 12 Jan 2026 · v3│  consent_at, consent_version
│                           All consents ›│
└──────────────────────────────────────┘
```

The count line reads "3 to do", "Nothing to do for Rohan" (only when every read answered and nothing fired), or "2 to do · 1 read failed". The record block is read from the reads the list already made and from `consents`; it names the giver as the server does ("you", "the guardian", "the office, from a signed form") and never the other parent's name.

### 3.2 By reader

| reader | sees | never sees |
|---|---|---|
| **a parent, one child** | his list, his record | the reason for any answer; another child's anything |
| **a parent of two at two schools** | two lists, one per child, each under the school's name; Family shows "Rohan · 2 to do", "Anika · 1 to do"; the switcher chooses; nothing sums | a row of Anika's on Rohan's Home (the body is keyed on the child, as today: a switch starts every card afresh) |
| **a coach at A, parent at B** (Sarah) | her child's list from reads made with her child's `matchId`s; `availability?matchId` at A returns A's whole side to her and the module keeps one row; at B it returns her child only | "4 have not answered" or any side-wide count; the coach's cockpit rows; A's fixtures on B's child's Home |
| **a parent whose request is pending** | §3.3 | any child's name from the platform (the request's note is her own words) |
| **a parent whose link was revoked or rejected** | §3.4 | the child's record, fixtures or figures (the link no longer admits them) |
| **the parent of a boy of eighteen at school** | his list without consent rows; "Rohan is eighteen: his consents are his to give. You may still say no." (db/62 option C); lifts (`guardian_adult`), answers and contacts as before | a consent "to answer" she cannot give (`can_say_yes = false`; a "yes" is refused `adult_consents_for_himself`) |
| **the parent of a boy who has left** (`valid_until` dated) | the list until the date; the thirty-day line | anything after the date (`my_children` drops him; the card closes as STEP4 §3.3) |
| **the pupil under eighteen** | R1 and R2 as "Answer for Sat v Kearsney · you or your parents" | a seat, a handover, a consent to answer, a contact (124 decision 4; STEP4 §4.1, Q7) |
| **the pupil, eighteen and at school** | R1, R2; R8b and R8c as his ("Your parents said yes; from your birthday it is yours", `ask_at_18`); his own seat (R3, R4) and "I am home" (R7) | contacts; anybody else's seat; a number |
| **a support session, the pad, the platform key** | nothing: `my_children` cuts them (db/99 §49), `my_health_consents()` cuts them, every lift function cuts them | — |

### 3.3 A pending link

`my_children` returns verified live links only, so a parent whose request the office has not decided sees nothing today but "No child is linked to your account yet". Her own `role_request` rows are hers to read (`role_requests` → `mine`, SCRBRD-140 §4.2). The family screen's empty state becomes:

> "Your request to be linked to a child at Hilton College is with the office · asked 4 days ago. **This does not mean it was approved.** When the office verifies the link, your child appears here."

The sentence names the school from `public_schools()` (the read already joins it) and the request's own `note`; it names no child from the platform, because the `player` row is not hers to read until the link is verified, and must not be (SCRBRD-140 §6, enumeration). A link the office established but has not verified (`verification_state = 'pending'`, no request) is invisible to her by every read today; A2's `my_links` says it as the same sentence.

### 3.4 A revoked or rejected link

Nothing today distinguishes it from "no child". A2 adds `my_links` (§5.2 N4): her own subject rows in every state, through her own guardian assignments, with the school's name, the relationship she claimed, the state words and the dates, **and no player name unless the link is verified and live** (which is `my_children`'s job). The screen says:

> "Your link to a child at Hilton College ended on 3 Oct 2026. The school office can say why; the platform does not." (revoked)
> "The school office did not verify your request of 12 Sep. Ask them." (rejected)

No reason is ever carried: the schema records none for a revocation (`db/47`'s reading, PUBLIC_DATA §6 item 2), and the list invents none. Everything she could do for him stops on the same statement her link ended (the lift triggers of db/70 void the seats she consented to; a declaration is refused `not_permitted`).

### 3.5 The pupil's list

The same `lib/todo.js` with `self = true`, on his Home under the next fixture (S1), rows worded as "you". Under eighteen it holds R1 and R2 and nothing else, because he holds `availability.declare` and no lift, consent or contact act (124 decision 4; STEP4 §3.2). At eighteen and still at school the server says what else is his: `consents.ask_at_18` (R8c), the public-name read's `mine` for a `self` giver (R8b), `lift_offers_for` with `how = 'self'` (R3, R4) and `lift_my_day` with `self` seats (R7). The client computes no age, ever.

### 3.6 Eighteen, and leaving

The link's end is the row's own date (`my_children.valid_until`, STEP4 §3.3). Dated within thirty days, one line: "Your link to Rohan ends on 14 Mar 2029. After that his record is his own." Open (`null`, at school past eighteen, db/62): no line; the consent rows are withheld by the server's `can_say_yes` and `how = 'guardian_adult'`, and one line says his consents are his. Nothing here reads `born`.

---

## 4 · The words

### 4.1 Rules

Plain sentences, the child named once per row. **Counts, never percentages.** "To do", never "done", "ready", "complete", "cleared". "Not answered" never reads as a yes or as a no. "Could not read the lifts" is a sentence in the row's place, never a red mark and never a zero. The adult who drives is named (she is an adult, outside PUBLIC_DATA's rule, and 124 names her on the offer); no other child is ever named in a row.

### 4.2 The count line

| state | words |
|---|---|
| open rows, every read answered | "3 to do" |
| nothing fired, every read answered | "Nothing to do for Rohan" |
| some read failed | "2 to do · 1 read failed" — never "Nothing to do" while a read is unanswered |
| still reading | "Reading…" with the rows that have arrived |
| the lift module off at his school | no lift row and no line about it (a switched-off module is not a failure, `live.js`) |

### 4.3 Links

| state | words |
|---|---|
| pending request | "Your request to be linked to a child at {school} is with the office · asked {n} days ago. This does not mean it was approved." |
| pending consent on a verified link | "The school's terms for Rohan are not agreed yet. The office will ask you." (A2: "Read and agree ›") |
| consent withdrawn on the link | "You withdrew the terms for Rohan on {date}. Lifts and health monitoring are off until they are agreed again." |
| revoked | "Your link to a child at {school} ended on {date}. The school office can say why; the platform does not." |
| rejected | "The school office did not verify your request of {date}. Ask them." |
| ending | "Your link to Rohan ends on {date}. After that his record is his own." |

### 4.4 Never on the list

| never | why |
|---|---|
| `reason_kind`, `note` of an availability row; "ill", "family" | the reason is between the family and the coach (db/08: "not a place to write about a child's home circumstances"); the list says only "answered" or "not answered" |
| an injury, `rtw_date`, "restricted", "unavailable on clinical grounds" | Health is its own panel, opened on purpose |
| a lift exception's reason, `not_collected` as a word to anyone but the parties | db/76's notices already go to the live guardians; the list repeats the handover row (R7) and nothing else |
| another boy's name on a lift row; the other passengers | D6 of 124; the fixture's lifts block shows them once her seat is confirmed, not the list |
| a phone number, an address, an email | R9 is a count; Who to ring is the door |
| the never-public reason, a safeguarding concern, a disciplinary matter | the office's and the DSO's (SAFEGUARDING §4.4: parents have no standing access; a share is its own notice) |
| the other parent's name as a giver | the server says "the guardian" (`publicname.jsx` `standing()`) and the list keeps the word |
| a percentage, a score, "ready", "all done" | GA-I09 §5 |

### 4.5 The route to the DSO

The persona header already carries "Raise a concern" on every family screen (STEP4 §10 departure 3; db/57). The list adds nothing and moves nothing. Two lines keep their places: the lifts block's "If this is about a lift, the DSO can see who drove and when" (124 §4.4), and the DSO card on Home (SAFEGUARDING §2.5). The list never names a DSO and never counts a concern.

---

## 5 · Reads and writes

### 5.1 What serves each row today

| row | read | write (the door) | capability on `guardian` | gap |
|---|---|---|---|---|
| R1, R2 | `matches`; `availability?matchId` (RLS: her child's row; a side-wide read for a coach) | `POST /api/matches/:id/availability` | `availability.read`, `availability.declare` | none |
| R3, R4, R6 | `GET /api/matches/:id/lifts` (`lift_offers_for`: her own children's seats by `lift_acting_for()`, `is_mine` offers) | `/api/lift-seats/:id/reconfirm`, `/withdraw`; `/api/lifts/:id/reaffirm`, `/cancel` | `transport.lift.arrange` | none; the read already refuses a `consent_pending` link and a pupil under eighteen |
| R5 | — | `/api/lifts/:id/accept`, `/api/lift-seats/:id/decline` | `transport.lift.arrange` | **N3**: a count of `requested` seats on her offers without reading a name |
| R7 | `GET /api/matches/:id/lifts/day` (`lift_my_day`, family card not logged, on the day) | `/api/lift-seats/:id/receive` | `transport.lift.arrange` | none |
| R8a | `my_children.consent_state`, `consent_version`, `consent_at` | `POST /api/players/:id/guardians/consent` (exists; the office's screen uses it) | — (the function takes `p_guardian = app_user_id()`) | **N6**: the terms' screen and version constant (A2, D7) |
| R8b | `GET /api/players/:id/public-name` (`mine`, `answers`, `label`) | `POST` the same | a verified live link (db/47) | **N5**: the read must carry the record's `version` and `recorded_at`; the columns exist |
| R8c | `consents` (`my_health_consents()`: `state`, `module_on`, `can_say_yes`, `version`, `given_on`, `by_you`, `from_form`) | the health consent route in `load-api.mjs` (`health_monitoring_consent_set()`) | the link, consent granted | none |
| R9 | `emergency_contacts?playerId` — **logged** (the API logs `phone`, `phone_alt`, `email` per read) | `POST /api/players/:id/emergency-contacts` | `player.emergency.read`, `.manage` | **N2**: a count read that logs nothing because it reads no number |
| pending | `role_requests` (`mine`) | — | none needed (`role_request_read`: `person_id = app_user_id()`) | none |
| revoked, rejected | — | — | — | **N4**: `my_links` (A2) |

### 5.2 New reads, and what each must allow and refuse

| # | what | tier | migration | RLS intent: allows | refuses |
|---|---|---|---|---|---|
| **N1** | `apps/web/src/lib/todo.js`: the rules R1–R9 over rows already fetched, the clock constants, the row shape, the fold, `self`; `useTodo(child)` making the reads of §5.1 (lifts on the day only); pure, tested under node | Sonnet builds, **Opus reviews** (a child's data on screen) | none | — | — |
| **N2** | `emergency_contact_count?playerId` in `read-api.mjs`: `player_id`, `active_count`, nothing else; not in the logged resources list | Opus (a child's record), small | none: the same `emergency_contact` SELECT policy the table has | the child's guardian; the office; the roles holding `player.emergency.read` | another family's child (no row, by RLS); a pupil (`selfaccess` holds no `player.emergency.read`, STEP4 Q7); a support session as the table already cuts it |
| **N3** | `lift_requests_mine`: `offer_id, match_id, leg, requested_count` over `lift_seat` where `state = 'requested'` and `offer_id in (select lift_my_offers())`; no `player_id` leaves | Opus, small | none: `lift_seat`'s SELECT policy admits the offer's driver (124 §2.3), the RESTRICTIVE cuts stand, and the read carries no name so nothing is logged | the driver, for her own open offers | anyone else (no rows); a pupil (db/70's pupil cut); the office (not the driver: counts are `lift_summary()`'s, under `oversee`) |
| **N4** | `my_links`: the caller's own `assignment_subject` rows through her own `guardian` assignments, every `verification_state`, with `relationship`, `consent_state`, `valid_from`, `valid_until`, `verified_at`, the school's name from `public_schools()`; **no `player_id` and no name unless the link is verified and live** | **Opus** (the link lifecycle; minors) | none if `assignment_subject`'s policy admits her own rows to a security-invoker read; **one `db/NN` definer function if it does not** — Opus decides on reading the policy | the person on the assignment | everybody else; a support session; the pad; proven in `db/99` as §49 proved `my_children` |
| **N5** | the public-name read carries `version` and `recorded_at` for `mine` and each of `answers` | Sonnet | none (columns in db/47) | as the route already gates | — |
| **N6** | the terms' screen: the text and version as a constant, "Read and agree", the POST above | Opus (consent; the version string is the record) | none | the guardian for her own link | another guardian's link (the function updates only hers: `a.person_id = p_guardian`); an adult child (not applicable: the terms are the link's, and the link stays) |

Nothing widens a capability, adds a gate or writes a row the parent could not write today. N2 and N3 are the price of D8.

---

## 6 · States

| state | what the screen does |
|---|---|
| **loading** | the card is drawn with "Reading…" and the rows already in; the count waits for every read |
| **empty** | "Nothing to do for Rohan", only when every read answered and no rule fired; never while a read is out |
| **failed** | a row in the source's place: "Could not read the lifts for Wed v DHS" with "Try again"; the count says "N to do · 1 read failed" |
| **forbidden** (a 403 that is not `module_disabled`) | the same as failed, in the read's own words; the list never asks for a child outside `my_children`, so this is a fault, not a refusal to draw |
| **module off** (`disabled`) | the source is skipped; no row, no line; the record block says "Health monitoring: not in use at Hilton College" once |
| **partial** | the count line's second clause; rows that answered are drawn; nothing pretends |
| **pending link** | §3.3; the family screen's empty state, not a row |
| **revoked, rejected** | §3.4 (A2); until then "No child is linked to your account yet", as today |
| **child turned eighteen, at school** | no consent rows; the one line of §3.6; everything else unchanged |
| **link ending** | the thirty-day line; after the date the card closes (STEP4 §3.3) |
| **signed out, the demonstration** | the family screens already say "Sign in to see your family"; the list is not drawn |

---

## 7 · Slices

| slice | what | tests that prove it | refusals tested | who | when |
|---|---|---|---|---|---|
| **A0** · *only if Kameel wants it before 12 Oct* | `lib/todo.js` with R1 and R2 only; a "To do for Rohan" card on Home under the next fixture, drawing those rows, the fold, the count line with "could not read"; no new read | **unit** `apps/web/test/todo.test.mjs`: R1 fires on a null status and not on any status; R2 on `needs_reconfirming`; a side's worth of rows in, one row out; a `null` read → `could_not_read`, `[]` → no row; the fourteen-day fold; the words contain no `reason_kind`/`note`. **browser** `smoke-browser-read` guardian group: the card shows "1 to do" for the unanswered fixture; declaring on P3 drops it on return and on a second signed-in tab's reload; the count never reads "Nothing to do" while the availability read is killed | the two-school guardian's Rohan card draws no Anika row; Sarah's child card shows one row where her coach read returned the side | Sonnet builds; **Opus reviews**; `interface-review` on the diff | pre-freeze |
| **A1** · the list over what exists | R3–R9 (N2, N3), the record block (N5), the pending-request sentence, the pupil's list (D12), the count on each Family card, the never-words static test | **unit**: each rule's fire and clear; `self` under eighteen yields R1/R2 only; the record block's giver words are the server's; the module exposes no `playerId` but the child's. **API** `tools/smoke-family-todo.mjs`: as the two-school guardian, `availability`, `lifts`, `consents`, `emergency_contact_count` answer per child and nothing across; as the driver, `lift_requests_mine` counts her requests and returns no name; as a stranger with a pending request, `role_requests` returns it and `my_children` nothing. **browser** `smoke-browser-read` and `smoke-browser-pupil`: a seat confirm-again appears after the seeded fixture move and leaves after "Confirm again"; retiring the last contact adds R9 and adding one removes it; the pupil's Home shows one row and no lift, consent or contact row; `smoke-a11y` floors | another family's child: `emergency_contact_count?playerId=` returns no row and the screen draws nothing; another school: a Kearsney parent's `availability?matchId` for a Hilton fixture returns nothing; a revoked link: `my_children` empty, a POST availability refused, `lift_offers_for` empty | Sonnet builds screens; Opus builds N2, N3 and reviews all | post-pilot |
| **A2** · the two Opus pieces | N4 `my_links` and §4.3's revoked and rejected words; N6 the terms' screen (D7) with Kameel's version text | `db/99` §NN (only if N4 is a definer): her own rows in every state, nothing for a coach, a spectator, support, the pad; no name on a pending or ended row. API: the terms agreed by the parent land as `consent_state = 'granted'` with the version; refused for another guardian's link | a revoked guardian reads her ended row and nothing of the child; a second guardian cannot agree the first's terms | Opus | post-pilot |
| **later, if asked** | a yearly "check the numbers" row (needs `emergency_contact.confirmed_at`, a migration); school-set clocks | — | — | Opus | — |

A0 is one new module, one card and a test; it changes no read and no write, and the 15 Oct test would show it to Kameel as the invented parents see it. A1 is the product.

---

## 8 · Open questions for Kameel

| # | question | recommendation |
|---|---|---|
| **Q1** | Build A0 before the 12 Oct freeze? | **Only if you want to see it on 15 Oct.** It is small and touches nothing the test depends on; it is also not what the test is for |
| **Q2** | May a parent agree the school's terms in the app (D7), given the function and route already allow it? | **Yes, in A2**, with the terms text and version as a constant you approve. Until then the row says "The office will ask you" |
| **Q3** | R4, a seat still only asked for inside 48 h: a row, or a line on the fixture? | **A row.** It is the one "waiting" that is hers to resolve before Saturday, and the fixture card alone is where she does not look on Thursday |
| **Q4** | The window: 14 days or the queue's 7? | **14**, later folded. Two weekends is how a family plans |
| **Q5** | Should the pupil under eighteen see his own lift as a nameless line ("Lift with Mrs Naidoo · 07:15")? 124 left it with you | **Not here.** It is 124's question, not the list's; the list follows whatever you decide there |
| **Q6** | A yearly "are these numbers still right" row for emergency contacts? | **Not now.** It needs `confirmed_at` on the table (a migration) and the school's enrolment forms do this yearly already |
| **Q7** | May the revoked sentence name the school (§3.4)? | **Yes.** She asked to be linked at that school; the school's name is public and the sentence carries nothing about the child |

## 9 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | `lift_seat`'s SELECT policy admits the driver's own seat rows under RLS (124 §2.3 says so) | N3 becomes a small definer function and a `db/NN` |
| **A2** | `assignment_subject`'s policy admits the caller's own rows | N4 is a definer function and a `db/NN` (Opus decides) |
| **A3** | the public-name read can carry `version` and `recorded_at` without a route change beyond the SELECT | N5 is the same work in the route file |
| **A4** | eight upcoming fixtures × the availability and lifts reads is acceptable on a phone (P2 already makes the availability read per row) | the lifts read is folded to the next two fixtures and "Later" reads on a tap |
| **A5** | `lift_my_day()` is not logged for a family's own card (db/76's header says so) | R7 is read on a tap, as the office's O6 is |
