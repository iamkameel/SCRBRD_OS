# GA-I09 / I10 / I11 — The match-day queue: the design

**Status:** for Kameel's review (Fable, 2026-10-07). Nothing built.
**Source:** `audit/GAP_ANALYSIS_2026-10-05.md` (GA-I09–I11, and the private comparative report it is built from, §3 "the key product gap", §5 and §6 — not quoted here, the repository is public); `docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md` (**the base: this extends it; D1–D16, the signal table and the never-list stand unchanged**); ADR 0001, 0003; `packages/policy/src/roles.mjs`, `capabilities.mjs`; `apps/web/src/lib/cockpit.js` (`cockpitGate`, `PANEL_CAPABILITY`), `lib/signals.js` (S1–S12 as built), `views/cockpit/MatchDayCard.jsx`, `useCockpit.js`, `views/ReadinessOverview.jsx`, `views/DashboardView.jsx`; `services/api/read/read-api.mjs` (`readiness`, `availability`, `match_duties`, `match_squad`, `trips`, `role_requests`, `sign_in_claims`, `clearance_register`, `notifications`, `matches`); `db/84` (`asked_unverified`).
**Reader:** Kameel on a phone first; then the Opus lead; then the Sonnet agent who builds the pre-freeze slice.

---

## 0 · In one page

OS can say what is on record. It rarely says *what should I resolve now*. This design adds one queue, drawn for four readers from the same source records, with no task table and no KPI grid.

**A row is a fact the data can prove, with an owner, a clock and one door.** "U15A v Kearsney, Sat: 4 have not answered · the U15A coach or team manager · by Thu 09:00 · *Open the side*." The fact is re-derived from its source every time the queue is opened (the readiness read, a duty row, a trip, a link request, a clearance). Nothing is marked done: a row leaves when the fact changes, and "Seen" stays what 136 D13 made it — *I have looked*, per person, per device, never resolution.

**The coach's queue is the match-day card grown to a list** (136 §3.2's card picks the first fixture within seven days; this shows every fixture the reader's assignments admit, one card each, a chooser when there is more than one). **The team manager gets the same list through the same gate**, which already withholds load, opposition and matchups from him. **The director's queue is the Readiness screen grown**: every fixture at the school in the window, grouped by date and team, each row a count with an owner, a deadline and a door into the fixture; **no name of a child on any school-wide row**. **The office gets a "Needs office action" list** on the same screen: link and claim requests (db/84's "asked before the email was verified" beside the ones that were), clearance gaps, duties nobody holds, fixtures that moved or were called off with work still on record, and lift exceptions on a tap, because that read is logged.

**The server authorises every row.** The queue is a pure module (`lib/queue.js`) over reads the app already makes; a read that fails produces "could not read", never an empty row, so zero blockers and a failed read look different (I08). One assignment per fixture, never a union (ADR 0001): a coach at Hilton who is a parent at Kearsney never sees Kearsney's fixtures here.

**The pre-freeze slice is small**: the chooser on the coach's card, a tap on each Readiness row that opens the fixture, and the per-fixture count. No migration, no new gate. Everything else is after the pilot.

---

## 1 · The readers and their jobs

| reader | the question on a Thursday | what today gives him | what the queue adds |
|---|---|---|---|
| **R1 coach / assistant**, several squads or two fixtures on one Saturday | which of my sides is not ready, and which first | one fixture: `MatchDayCard` takes the first within seven days that any one assignment admits | every admitted fixture, a chooser, a count per fixture, the same rows from any signed-in device |
| **R2 team manager** | who has not answered, who is on the bus against who is travelling, which handover is open | the same cockpit, narrowed by the gate (no load, no opposition, no matchups: 136 §1.2) | the same list as R1; the rows he holds the capability for; nothing clinical, no reason for an absence |
| **R3 director of sport / principal** | which fixtures across the school have a blocker, who owns it, by when | `ReadinessOverview`: eight fixtures' duty chips, no tap, no owner | rows grouped by date and team, each a count, an owner, a deadline, one door; a failed read said as a failed read |
| **R4 the school office** (`schooladmin`, and `sportsadmin` for the rows it holds) | what needs the office today | Management for requests, Settings for people, the register for clearances, each opened on purpose | one list: requests, claims, clearances, duties, moved and called-off fixtures, lifts on a tap |

Not readers: a scorer (136 D3; his home is GA-I13), a pupil, a parent (STEP4 and GA-I20), the DSO (his concern queue is his own, SAFEGUARDING_DSO), the physio (GA-I19). The queue draws nothing for them and does not say a thing is missing.

### 1.1 Who enters, by capability

The coach's and manager's list uses 136's entry rule unchanged: one school- or team-scoped assignment that covers the fixture's side and grants `team.select` or `player.workload.read` (`cockpitGate`). The director enters the same way, through a school-scoped assignment with no team, which covers every side at the school.

The school-wide screen has its own door, so the principal and the office reach it without the cockpit: **one school-scoped assignment granting any of** `fixture.read` (duties, moved fixtures), `clearance.read` (the register), `user.role.assign` (requests), `user.invite` (claims), `guardian.link.manage` (link gaps, phase B), `transport.lift.oversee` (lift exceptions). Each row checks its own capability, as every cockpit panel does. The table below is derived from `roles.mjs` at build time, as 136 A1 derives its own; it is written here so Kameel can see the consequence.

| role | fixture rows (counts) | answers, sheet (S3, S6, S7) | restricted on the sheet (count) | bus (S1) | lifts | duties (S8) | requests | claims | clearances | moved / called off |
|---|---|---|---|---|---|---|---|---|---|---|
| `directorofsport` | yes | yes | yes | yes | no (holds neither lift capability) | yes | yes (`user.role.assign`) | yes (`user.invite`) | yes | yes |
| `principal` | yes | **no** (no `availability.read`, no `team.select`) | yes (`medical.status.read`) | no | no | yes | yes | no | yes | yes |
| `schooladmin` | yes | answers yes (`availability.read`); sheet **no** | yes | yes | exceptions (`oversee`) | yes | yes | yes | yes | yes |
| `sportsadmin` | yes | yes | yes | yes | exceptions | yes | **no** | no | yes (`clearance.read`) | yes |
| `transportcoordinator` | bus and lift rows only | no | no | yes | exceptions | no | no | no | yes | no |

The principal's thin row is the policy's answer, not a bug: widening it is a `roles.mjs` change plus a paste (ADR 0003), and D9 asks whether that is wanted.

---

## 2 · The queue model

### 2.1 Plain words

A row is not a task. It is a sentence derived from one record, with four things beside it: whose it is, by when, where it came from, and the one door that opens the exact fixture or record. When the record changes, the row changes or goes. Nobody closes a row by hand.

### 2.2 A row

| field | what it holds | rule |
|---|---|---|
| **fact** | one sentence in the source's own words, with its count | 136 §4.1: nothing scored, weighted or ranked |
| **source** | the read and the row it came from (`readiness`, `match_duties`, `trips`, `role_requests`, …) | shown on the row as "from the side read", for ADR 0001's "why am I seeing this" |
| **owner** | the capability that can change the fact, said as a role word on the fixture's side ("the U15A coach or team manager"); a name only where the reader holds `user.read` and phase B's lookup exists | derived from `PANEL_CAPABILITY` and the office table above; never typed per row |
| **deadline** | the queue's own clock off the fixture's `starts_at` (§2.4), or the record's own date (`expires_on`, `requested_at`) | labelled "the queue's clock", never "the school's rule", until a school can set one (D3) |
| **action** | exactly one: a door into the exact fixture tab, record or register | never "mark done", never "seen = resolved" |
| **state** | `open`, or `could_not_read` with the read's error | a failed read is a row that says so; an empty read is no row (I08) |

### 2.3 Where rows come from

Every row is one of 136's twelve signals evaluated for one fixture, or one of six office rules below. **No new rule is invented for the coach or the manager**: S1–S12 as built are the coach's rows, with the fixture as the grouping key.

| # | office row | source (read) | capability (school-scoped) | the fact, as worded | owner | deadline | the one door |
|---|---|---|---|---|---|---|---|
| **O1** | A request to join or to be linked | `role_requests`: `state = 'pending'` and `decidable`; `asked_unverified` from db/84 | `user.role.assign` (the read already computes `decidable` with `app_may_grant_at`) | "3 requests waiting · 1 asked before the email was verified · oldest 4 days" | the office | none; age shown | Management → requests |
| **O2** | A sign-in waiting to be claimed | `sign_in_claims` (`pending_claims()`) | `user.invite` at the account's school (inside the function) | "2 Google sign-ins match an enrolled account · oldest 2 days" | the office | age shown | Settings → people → claims |
| **O3** | An adult without a current clearance | `clearance_register`: `status IN ('missing','expired','revoked','expiring')` | `clearance.read` | "2 adults on Saturday's duties: 1 clearance expired, 1 expiring 20 Oct" — adults' names may be shown (the register names adults, not children) | `clearance.manage` holders | `expires_on`; a missing one: the first duty's date | the register, that person |
| **O4** | Nobody on record for a duty, school-wide | `match_duties` per fixture, as `ReadinessOverview` fans it out; S8's rule (scorer, umpire) | `fixture.read` | "No scorer on record for U13A Sat" | `officiating.assign` holders; the office | first ball | the fixture's duties |
| **O5** | A fixture moved or called off with work still on record | `matches.status = 'abandoned'` with duty rows or a trip; `availability.needs_reconfirming > 0` (the only on-record trace of a move: the amend route writes no `amended_at`) | `fixture.read` + `availability.read` for the count | "U15A v Kearsney moved: 6 answers to ask again, 2 duties appointed before the move" — the second clause only once `amended_at` exists (phase B) | the office; the side's coach for the answers | the new start | the fixture |
| **O6** | A lift exception by name | `lift_exceptions()` (S4b as built) | `transport.lift.oversee`; **logged** by db/76 | S4b's five sentences | the office, by `lift_resolve()` | db/76's thirty minutes | the lift day screen |

**O6 is read only on a tap** ("Check today's lifts"), never on opening the queue, because every call writes an access-log row naming children; a queue that opened it on every glance would fill the school's log with reads nobody meant (D6).

### 2.4 The queue's clock

| row | deadline | why this figure |
|---|---|---|
| answers (S7), restricted or unavailable on the sheet (S3) | 48 hours before `starts_at` | `isSoon()`'s own threshold, already the feed's |
| the sheet thin or unpublished (S6) | 24 hours before | a side is named the day before; the pad reads `match_squad` at the toss |
| duties (S8, O4), conditions (S10) | first ball | nothing says how many a fixture ought to have (duties.jsx); the pad needs the conditions at the first ball |
| bus (S1), lifts (S4a) | the trip's `depart_at`, else first ball | the trip's own column |
| requests (O1), claims (O2) | none: age shown | the office decides its own pace; a deadline here would be invented |
| clearances (O3) | `expires_on`; missing: the person's next duty | the record's own date |

These are constants in `lib/queue.js`, labelled on the screen as the queue's clock. A school-set deadline is a `school_setting` row and a paste; D3 asks whether the pilot wants it.

### 2.5 Grouping and order

- **The coach, the manager:** one card per admitted fixture, in `starts_at` order, today's first; inside a card, 136's fixed rule order. More than one fixture on a day is two cards, never merged.
- **The director, the office:** grouped by **date, then team**, each group's header "Sat 10 Oct · U15A v Kearsney · 3 to resolve"; inside, rows in the fixed order S7, S3, S6, S1, S8, S10, S9 then O-rows. The office list (O1–O3, O6) sits above the fixture groups because it has no date.
- **Window:** seven days, as the card has today (D5); fixtures after that are folded under "Later" and drawn on a tap. **No paging**: "show more" reveals the next eight (I09's acceptance says paging reveals beyond the first eight; a fold does that on a phone without page numbers).
- **Nothing is ranked.** A date is a date and a rule order is fixed; no row is "high priority".

### 2.6 Why there is no task table

Every row above has an owner in the capability, a deadline in the record or the fixture's clock, and a close condition in the source. The one case that looked like it needed a lifecycle, a lift handover not closed, already has one in db/76 (`lift_receive()`, `lift_resolve()`, thirty minutes). A task row beside these would be a second place a fact could be true, and the first thing "Seen" would quietly become. **This design adds no task table** (D4). If the pilot shows a row that nobody owns and no record can close, that is the case for one, argued then.

---

## 3 · Per-reader screens

### 3.1 The coach and the manager: the card grown to a list

```
┌──────────────────────────────────────┐
│ MATCH DAY · 2 fixtures this week     │
│ ┌──────────────────────────────────┐ │
│ │ U15A v Kearsney · Sat 09:00      │ │  cockpitGate(assignments, m) → U15A coach
│ │ 11 named · 1 to chase ·          │ │  sideFoot(), as the card has it
│ │ 1 restricted · bus 22 seats      │ │
│ │ 3 to resolve                     │ │  feed.open.length
│ │ [ Open the Coach tab ] [ Signals]│ │  44 px each
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ U14B v Michaelhouse · Sat 11:00  │ │  a second assignment, or the same one
│ │ No sheet published yet           │ │
│ │ Could not read the bus (timeout) │ │  I08: a failed read is said
│ │ 1 to resolve                     │ │
│ └──────────────────────────────────┘ │
│ Later · 1 fixture (Wed 21 Oct)  ›    │  folded
└──────────────────────────────────────┘
```

| card line | read | capability | wording rule |
|---|---|---|---|
| the fixture | `matches` | `fixture.read` | opponent and `humanDateTime` as the card has it |
| the side's foot | `readiness?matchId` → `sideRows`, `sideFoot` | `team.read`, `availability.read`; `medical.status.read` for "restricted" | counts only; a name is on the tab |
| the bus | `trips?matchId` → `busOf` | `transport.read` | "bus 22 seats"; short only when the lifts were counted or the reader may not count them (S1 as built) |
| the count | `evaluate()` over `useCockpit` | per rule | "N to resolve"; "Nothing to resolve" when the rules fire nothing and every read answered; a failed read is its own line |
| the doors | `requestCoach(matchId, drawer)` | — | the two buttons as built, 44 px, always drawn |

**The team manager sees this same card.** `cockpitGate` gives him `side`, `select`, `status`, `bus`, `lifts`, `team`, `day` and not `load`, `opposition`, `matchups`; so his rows are S1, S3, S4a, S6, S7, S8, S9, S10, S12. His handover row is S4a (head count, "with us"), never S4b. Nothing is drawn where his gate is false and nothing says a panel is missing.

**The lifts are read only on the match day**, as the card does today, because the read is logged. A card before Saturday says "lifts not counted" in S1's own words.

### 3.2 The director: Readiness grown

```
┌──────────────────────────────────────┐
│ TO RESOLVE · Hilton · this week      │
│ 5 open · 1 read failed · 7 fixtures  │  the three numbers, always
├──────────────────────────────────────┤
│ SAT 10 OCT                           │
│ U15A v Kearsney · 09:00 · 3 open     │
│  4 have not answered                 │  S7, count
│   the U15A coach or manager · by Thu │  owner, clock
│   from the side read         Open ›  │  source, door (44 px row)
│  1 restricted boy on the sheet       │  S3, COUNT (never the name here)
│   the U15A selector · by Thu  Open › │
│  No scorer on record                 │  S8
│   the office · first ball     Open › │
│ U13A v Clifton · 11:00               │
│  Could not read duties (unreachable) │  I08, in its own words
│   [ Try again ]                      │
│ U14B v Michaelhouse · 11:00          │
│  Nothing to resolve                  │  zero, said as zero
├──────────────────────────────────────┤
│ WED 14 OCT …                         │
└──────────────────────────────────────┘
```

| row | read | capability on the director's school-scoped assignment | wording | the door |
|---|---|---|---|---|
| answers | `readiness?matchId` per fixture | `availability.read` | "4 have not answered · 1 to answer again" (S7's words) | the fixture's Coach tab, Side panel |
| on the sheet but not available | `readiness` | `team.select` + `availability.read`; `medical.status.read` for restricted | **"1 restricted boy on the sheet"**, "1 marked unavailable on the sheet": a count; the name is one tap deeper, inside the fixture, where 136 already shows it to him | the Coach tab |
| the sheet | `match_squad?matchId` | `team.select` | S6's words | the Coach tab, Pick side |
| the bus | `trips?matchId` + `match_squad` | `transport.read` + `team.read` | S1's words, "lifts not counted" (he holds no lift capability) | Logistics, that trip |
| duties | `match_duties?matchId` | `fixture.read` | S8's words per empty slot | the fixture's duties |
| conditions | `/api/matches/:id/playing-conditions` | `fixture.read` | S10's words | the competition's conditions |
| weather | `weather` | `fixture.read` | S9's words | — (no action; drawn as information, counted as none) |
| moved / called off | O5 | `fixture.read`, `availability.read` | O5's words | the fixture |
| a request, a claim, a clearance | O1–O3 | as §2.3 | as §2.3 | as §2.3 |

The header's three numbers are always drawn: open rows, reads that failed, fixtures in the window. A screen with 0 open and 1 failed says "0 open · 1 read failed", never "all clear". **No "Seen" on this screen** (D7): a school-wide blocker is open until its fact changes.

### 3.3 The office: "Needs office action"

Above the fixture groups on the same screen, for a reader whose school-scoped assignment holds any of the office capabilities (§1.1):

```
┌──────────────────────────────────────┐
│ NEEDS OFFICE ACTION                  │
│  3 requests waiting · 1 asked before │  O1
│  the email was verified · oldest 4 d │
│                             Decide › │
│  2 sign-ins to claim · oldest 2 d    │  O2
│                            Confirm › │
│  1 clearance expired · 1 expiring    │  O3
│  Mr Khoza (umpire Sat): expired      │  an adult's name: clearance.read
│                       The register › │
│  U15A v Kearsney moved: 6 to ask     │  O5
│  again                      Fixture ›│
│  [ Check today's lifts ]             │  O6, on a tap, logged
└──────────────────────────────────────┘
```

`sportsadmin` sees O3–O6 and not O1–O2 (no `user.role.assign`, no `user.invite`). `transportcoordinator` sees the bus rows and O6 only. The office's door for O1 is the Management screen's request list, which already decides them; the queue adds no second decision surface.

### 3.4 The phone

Portrait at 390. Every row is one tap target of at least 44 px, the whole row, with the door's chevron at the right; nothing under 12 px (the Readiness chips today are 9–11 px and the queue does not inherit them: they are replaced by rows). Words, never colour alone: "could not read" is a sentence, not a red. Groups are static; rows do not animate in; a fold opens as a cut under `prefers-reduced-motion`. The laptop draws the same rows in two columns, office left, fixtures right.

---

## 4 · The multi-squad chooser and context rules

### 4.1 Plain words

A coach with three sides sees three cards. A tap on a card sets one context, the fixture and the single assignment that admitted it, and every panel and signal inside is drawn for that pair. Context grants nothing: the server reads decide what comes back, and a second signed-in device shows the same rows because the rows are the server's.

### 4.2 The rules

1. **One row per (assignment, fixture).** `cockpitGate(assignments, m)` runs for every fixture within the window, not only the first; the result list is the chooser. When two assignments admit one fixture (a coach who is also the school's director of sport), the gate's own tie rule stands: the one granting the most panels, the first on a tie, and the card names which ("as U15A coach").
2. **Context is one assignment plus one fixture, never a union** (ADR 0001). Opening the U14B card as the U15A coach is impossible: the U14B card exists only if some single assignment admits it.
3. **Two schools never blend** (GA-I07). A guardian assignment is subject-scoped and never passes the gate; a coach assignment at school A covers no fixture of school B (`endCovered`). So the staff queue holds school A's fixtures only, and the family screens hold the child at B. A person who coaches at both schools sees two groups with the school's name on each header, and each row's reads were made under the assignment that admits that fixture.
4. **Switching clears.** Opening a card clears any selection from another fixture (`requestCoach` already carries the fixture id; the tab's state is keyed by it). The Squad screen opens on the chosen side, not `1XI` (I07's own fix).
5. **A second session sees the same thing.** Rows are derived on open from server reads; publishing the XI on one phone changes `match_squad`, and the other phone's next open derives the new rows. "Seen" is per device by design (D13) and hides nothing on the school-wide screen (D7).
6. **A fixture that admits nobody draws nothing**, and nothing says a card is missing (136's own rule for the scorer, the pupil, the parent).

---

## 5 · Never surfaces

136 §3.7 and §4.4 stand whole. The queue adds these, because a school-wide screen is a wider room than a cockpit:

| never, on this screen | why |
|---|---|
| **a child's name on a school-wide row** where a count would do: "1 restricted boy on the sheet", "4 have not answered" | the director reads the name one tap deeper, inside the fixture his gate admits, as 136 already draws it; a list of names across every side is a roster of who is hurt or absent, which no row needs |
| `rtw_date`, `reason_kind`, `note`, `injury_type`, `severity`, `phase`, `acwr`, `ewma_ratio`, `open_flag` | 136 D4, D5; a static check over `lib/queue.js` holds it, as `signals.test.mjs` holds the rules |
| a wellness flag, a check-in, a load word, a directive breach as a row for the director | 110 §3.3 and 136 §4.4: the notice is the channel (S12), and S11 stays on the coach's own card |
| a safeguarding concern, a suspension, a clearance gap *reason* | the DSO's alone; a suspended adult's duty already reads "suspended by the DSO" where it matters (db/34–35) and that is enough |
| a disciplinary matter, an unpaid fee | each has its holder's screen; no row here |
| a guardian's phone, email or address | O1 shows the requester's name and the request; the family file holds the rest under `player.pii.read` |
| another school's child in any row | the queue reads nothing the cockpit does not; §3.5 of 136 bounds it |
| a lift exception by name, unless `transport.lift.oversee` and a tap | D6; the read is logged |
| a risk percentage, a priority score, a readiness percentage, "ready" for a duty that is only on record | 136 §5; the honest word is "on record" |
| "done", "cleared", "resolved" as something a reader clicks | §2.6 |

---

## 6 · New reads and migrations

| # | what | why | tier | migration | paste |
|---|---|---|---|---|---|
| **N1** | `lib/queue.js`: the chooser (`cockpitGate` over every fixture in the window), the grouping, the clock constants, the row shape, the office rules O1–O5 over existing reads; pure, tested under node | the whole of phase A | **Sonnet** builds, **Opus** reviews (minors' data on screen) | none | no |
| **N2** | `useQueue()`: `useCockpit` per admitted fixture (the reads it already makes, lifts only on the match day), `role_requests`, `sign_in_claims`, `clearance_register`, `matches` | phase A's reads | Sonnet | none | no |
| **N3** | `match.amended_at` (and `amended_by`), written by the amend route | O5's second clause: a duty appointed before the move; today nothing records that a fixture moved except the availability snapshot | **Opus** (schema) | one `db/NN`; a trigger on `match` | **yes** |
| **N4** | `link_gaps(p_school)` → counts per team of children on a sheet with no verified guardian link, under `guardian.link.manage` | the office's "enrolment gap"; no read holds it (`my_children` is the guardian's own) | **Opus** (minors, consent) | one function in a `db/NN` | **yes** |
| **N5** | `school_queue(p_school, p_from, p_to)`: the director's rows in SQL, counts only, one call | if the fan-out (eight fixtures × ~ten reads) is slow on a phone; 136 phase C's shape | Opus | one function | yes |
| **N6** | owner names: the side's staff through the existing `users` read under `user.read` | "the U15A coach" → "Mr Dlamini" | Sonnet | none | no |
| — | `bowler_day`, `signal_ack` | 136 phase B, unchanged; not this design's | Opus | as 136 | yes |

Nothing in N1–N2 widens a read, adds a gate or writes a row. N3 and N4 each need a `db/NN`, a `db/99` section and a production paste, and are after the pilot.

---

## 7 · Build phases

| phase | ships | migration | who | when |
|---|---|---|---|---|
| **A0 · pre-freeze slice** (by 12 Oct) | (i) `MatchDayCard` draws one card per admitted fixture within seven days with a "Later" fold (the chooser), the gate and reads unchanged; (ii) each `ReadinessOverview` row becomes a 44 px tap that opens the fixture's duties, and its chips move to 12 px; (iii) the card's count says "N to resolve" and "could not read X" per failed read | **none** | **Sonnet** builds; **Opus** reviews; `interface-review` on the diff | pilot |
| **A1 · the queue over what exists** | `lib/queue.js`, `useQueue()`; the director's grouped screen (counts, owner words, the clock, doors); the office list O1, O2, O3, O4, O5's first clause; O6 on a tap; the header's three numbers; the static never-list test | none | Sonnet builds; Opus reviews every screen | post-pilot |
| **B · the two Opus reads** | N3 `amended_at` (O5's second clause); N4 `link_gaps` (the office's enrolment row) | two | Opus | post-pilot |
| **C · if slow, or if asked** | N5 `school_queue()`; N6 owner names; school-set deadlines (D3) | one | Opus; Sonnet for N6 | later |

A0 is three small changes to two files and a test; it ships the one thing the coach with two Saturday sides needs on 15 Oct and nothing a reviewer must think hard about. A1 is the product.

---

## 8 · Acceptance

**Unit (`apps/web/test/queue.test.mjs`, plain node)**
- The chooser lists every fixture one assignment admits and none that two must be joined to admit; a guardian assignment admits nothing; a coach at A admits nothing at B.
- Grouping is by date then team; order inside a group is the fixed order; nothing is ranked.
- Each clock constant: fires at its threshold, not one short.
- A `null` read yields a `could_not_read` row with the read's name and never an empty group; a `[]` read yields no row.
- The school-wide rows carry counts and no `name`, `playerId`, `rtw_date`, `reason_kind` field; the static check over `lib/queue.js` finds none of the never-words of §5 (as `NEVER_ON_THE_TAB` does).
- O1 counts `asked_unverified` separately and never drops a request for it.

**API walks (`tools/smoke-queue.mjs`)**
- Signed in as the seed's director: `readiness`, `match_duties`, `trips`, `match_squad` answer for every fixture at the school; `lift_expected` and `lift_exceptions` return nothing (he holds neither).
- As the office: `role_requests` returns the pending rows with `decidable` and `asked_unverified`; `sign_in_claims` returns rows; `clearance_register` returns the seed's expired clearance; `lift_exceptions` writes one access-log row per call and the queue made no call until the tap.
- As the principal: `readiness` returns no rows; `match_duties` returns rows.
- As a coach holding U15A and U14B: `readiness` answers for both and for nothing else at the school.
- As the seed's scorer, pupil, guardian: every queue read answers nothing or 403, and the screen is not offered.

**Browser walks (`tools/smoke-browser-queue.mjs`, and `smoke-browser-cockpit.mjs` extended for A0)**
- A0: a coach with two Saturday fixtures sees two cards; tapping the second opens the Coach tab for that fixture and the Squad screen on that side; a coach with one fixture sees exactly what he sees today. A Readiness row opens its fixture's duties.
- A1: the director's screen groups Saturday's three fixtures under one date; the restricted row reads "1 restricted boy on the sheet" and the rendered page contains no child's name outside a fixture he then opens; swapping the seed's vehicle for a smaller one adds the bus row and swapping it back removes it; killing the duties read for one fixture draws "could not read duties" for that fixture and "0 open · 1 read failed" in the header, not "all clear".
- Two sessions: publish the XI as the coach on one browser; the director's and the second coach session's next open show the sheet row gone; "Seen" on one device changes nothing on the other.
- Grep the rendered queue for the never-words: no `injury_type`, `reason_kind`, `rtw` value, no "%", no phone number, no "ready", no "done".
- `smoke-a11y`: 12 px floor, 44 px rows, each group a landmark, each row's fact and owner as text, keyboard-reachable doors.

**db/99 (phase B only; A adds no SQL) — a new §64**
- `amended_at` is set by the amend route and by nothing else; a reader with `fixture.read` at the school reads it and a reader at another school does not.
- `link_gaps(p_school)` returns counts to `guardian.link.manage` at that school; to a coach, the director, a `support_access` session: nothing; a child with a verified link is not counted; a captured-not-verified link is.
- Re-asserted in the same section: `role_requests.decidable` is false for `sportsadmin`; `pending_claims()` returns rows only under `user.invite` at the account's school; `clearance_register()` refuses another school.

---

## 9 · Decisions for Kameel

| # | decision | recommendation | why, in one line |
|---|---|---|---|
| **D1** | The pre-freeze slice | **A0 only: the chooser on the card, a tap on each Readiness row, the per-fixture count** | no migration, no new gate, two files; the coach with two Saturday sides is the pilot's real case |
| **D2** | Where the queue lives | **the coach's inside the match-day card; the director's and the office's on the Readiness screen, renamed "To resolve"** | no fifth destination; both screens exist and are already in the sidebar for these roles |
| **D3** | Deadlines | **the queue's own clock (§2.4), labelled as such; a school-set deadline only if the pilot asks** | a deadline nobody set is an invention; the clock is derived from thresholds the feed already uses |
| **D4** | A task table | **none** | every row has an owner, a clock and a close condition in its source; a task row is where "Seen" would become "done" |
| **D5** | The window | **seven days, "Later" folded** | the card's today; a fold is paging on a phone |
| **D6** | Lift exceptions on the office queue | **on a tap, never on open** | every call is logged against children's names (db/76) |
| **D7** | "Seen" on the school-wide screen | **none; a blocker stays until its fact changes** | one director's glance is not another's; a school-wide list that hides rows is not a list of what is open |
| **D8** | Children on the director's rows | **counts only; the name one tap deeper, inside the fixture** | his gate admits the fixture and 136 shows him the name there; a school-wide list of names is a roster of the hurt and absent |
| **D9** | The principal's thin row (no answers, no sheet) | **leave it; the office and the director hold those rows** | widening is `roles.mjs` plus a paste (ADR 0003); nothing the principal decides on a Thursday needs the count |
| **D10** | Owner shown as a role word, names in phase C | **role word now** | the capability is the owner; a name needs a staff lookup per side and is not what the pilot lacks |
| **D11** | `match.amended_at` (N3) | **phase B, Opus, a paste** | the only honest way to say "appointed before the move"; without it O5 says only what the answers say |
| **D12** | `link_gaps()` (N4) | **phase B, Opus, a paste** | no read holds it; it touches consent state and must be a function with its own gate |
| **D13** | GA-I12 and I13 | **adjacent, not here: S12's lane will show persisted receipts when I12 lands; the scorer's "matches you can score" is I13's home and the queue's duties rows say "scoring session not claimed" to the office only** | the queue never depends on read state, and the scorer is not a reader (136 D3) |

## 10 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | `cockpitGate` over every fixture in the window is cheap (pure, no read) | the chooser is memoised per assignments and matches |
| **A2** | eight fixtures × `useCockpit`'s reads is acceptable on a phone (ReadinessOverview already fans eight `match_duties`) | phase C's `school_queue()` |
| **A3** | `clearance_register()` returns duty holders at the school, with `status` words as read | O3 says "adults at the school" rather than "on Saturday's duties" |
| **A4** | `pending_claims()` is readable by `schooladmin` through `user.invite` | O2 waits for the read's gate to be confirmed by the lead |
| **A5** | `requestCoach(matchId)` plus the Squad screen's I07 fix is enough to clear a stale selection | the tab keys its state by fixture id |
| **A6** | the seed has one coach with two sides on one Saturday, or the walk makes it inside its run | the walk seeds it |
