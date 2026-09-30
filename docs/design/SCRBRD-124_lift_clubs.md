# SCRBRD-124 — Parent lift clubs: the design

**Status:** design, for Kameel's review (2026-09-30). Nothing here is built. Every number that is not already in the repository is an **assumption** and is marked as one.
**Source:** `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md` SCRBRD-124 (the seven rules) and SCRBRD-122 (reconfirmation when a fixture changes); `docs/design/SAFEGUARDING_DSO.md`; `docs/policy/CSA_SAFEGUARDING_CHECK.md`; `db/08` (vehicle, trip, `trip_mark()`, `match_availability`), `db/41`, `db/56`, `db/62`; `docs/design/STEP4_parent_pupil.md` for where a family's screens live. The earlier build (`iamkameel/scrbrd` at 0a90c71) was read for its one idea worth keeping: an arrangement is confirmed only while the guardian's, the driver's and the fixture's versions all agree.
**Reader:** the product owner and information officer first; then Opus, who builds §2–§6 and §8; then Sonnet, who builds the screens named in §8. Plain words open each section.

---

## 0 · What this is, in one page

Parents at a school give each other's boys lifts to Saturday's match and back. They have always done this by phone and at the gate. The platform gives it a place where the three things that go wrong by phone cannot: a boy is put in a car his own parent never agreed to; the arrangement quietly outlives a fixture that moved; nobody knows, at 16:30 at the gate, which adult has which child.

**What a family sees and does.** On the fixture card she already opens for the bus and the availability (STEP4 P3), a parent sees **Lifts**: the offers other parents on the side have made for that match — "Mrs Naidoo, to Kearsney, leaves 07:15 from the school gate, 2 of 3 seats left" — one for the way there, one for the way back. She asks for a seat for her son; Mrs Naidoo accepts; both see "confirmed". On the day the driver's card lists the boys she is taking and, for that day only, their parents' numbers; the parent's card shows the driver's number and the car. The driver marks each boy in and each boy handed over; the coach at the ground marks the boys who arrived with her; on the way home the boy's own parent marks him collected. A missed mark tells both adults. If the fixture moves, every lift on it goes back to "needs reconfirming" and nobody rides on a stale yes. A parent who wants to drive fills in a once-a-year declaration about her licence and car, and offers seats on her own child's fixtures.

**What the school does.** It switches the module on, with its own lift policy in its own words, which every parent reads before offering or asking. It may require of drivers the same clearance it asks of other adults. It sees how many boys are travelling by lift on each fixture and is told by name when something has gone wrong — a driver who has not left, a boy not collected — and it can stop any lift. Its Designated Safeguarding Officer can read, with every read logged, who drove whom and when, and can bar a person from driving without saying why.

**What the school does not take on.** It does not vet cars, insure them, inspect them, assign any child to any car, reassign a child when a driver falls through, or clear each lift as it clears a bus (§4.6). The screen says "arranged between families; the school facilitates and does not operate lifts", and the policy text says it in the school's words. No home address is ever typed, no location is tracked, no adult ever messages a child through the platform, and a pupil under eighteen cannot ask for or accept a lift himself.

The seven rules Kameel agreed are the frame. §7's first table says where each is sharpened and which two are incomplete as written.

---

## 1 · The model

### 1.1 Plain words

A **declaration** says a parent may drive: licence, insured, roadworthy, belts, how many passenger seats, what the car is. One per parent per school per year. An **offer** is one driver, one fixture, **one leg** (there, or back), so many seats, one named meeting point and a time. A round trip is two offers, which the screen makes with one form. A **seat** is one boy on one offer. It is confirmed only when his own guardian has consented to *that* driver for *that* lift and the driver has accepted *that* boy, both against the offer's current version; when the offer or the fixture changes, the version moves and the seat is no longer confirmed until both have said yes again. Nothing carries over: a new fixture is a new offer is new seats. The **marks** are the driver's own acts on the day (left, boy in, boy handed over) and the receiver's acknowledgement; the receiver at the ground is the team's staff, and at home the boy's guardian.

### 1.2 Tables

Hand-written like db/57 (RLS on, `INSERT/UPDATE/DELETE` revoked from `scrbrd_app`, written only through the functions of §1.4), not generated from `tables.mjs`: the generator's permissive policies cannot say "the driver reads names only on the day" or "a guardian reads the other passengers only once her own seat is confirmed".

```
lift_policy (                                   -- rule 7: the school's own text, signed by the principal
  id uuid PK, school_id uuid NOT NULL → school, version integer NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 200 AND 6000),   -- assumption
  requires_clearance boolean NOT NULL DEFAULT false,       -- D4
  allow_one_to_one   boolean NOT NULL DEFAULT true,        -- D5
  meet_note text CHECK (meet_note IS NULL OR length(meet_note) <= 80),   -- "the Chapel car park": the school's named point
  signed_by uuid NOT NULL → app_user, signed_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz, withdrawn_by uuid → app_user
)
UNIQUE INDEX one_live_policy ON lift_policy (school_id) WHERE withdrawn_at IS NULL

lift_driver_declaration (                       -- rule 2: only known adults drive
  id uuid PK, person_id uuid NOT NULL → app_user, school_id uuid NOT NULL → school,
  vehicle_description text NOT NULL CHECK (length(vehicle_description) BETWEEN 3 AND 60),   -- "silver Toyota Fortuner"
  registration text NOT NULL CHECK (registration ~ '^[A-Z0-9 ]{2,12}$'),
  seats smallint NOT NULL CHECK (seats BETWEEN 1 AND 7),  -- passenger seats with belts, not counting her own children
  licence_held boolean NOT NULL CHECK (licence_held), insured boolean NOT NULL CHECK (insured),
  roadworthy boolean NOT NULL CHECK (roadworthy), belts boolean NOT NULL CHECK (belts),
  code_acknowledged boolean NOT NULL CHECK (code_acknowledged),   -- the school's policy and CSA's code (Annexure G) read and accepted
  policy_version integer NOT NULL,              -- which policy text she read
  declared_at timestamptz NOT NULL DEFAULT now(), expires_on date NOT NULL,   -- declared_at + 1 year (assumption)
  withdrawn_at timestamptz
)
UNIQUE INDEX one_live_declaration ON lift_driver_declaration (person_id, school_id) WHERE withdrawn_at IS NULL

lift_offer (
  id uuid PK, school_id uuid NOT NULL → school, match_id uuid NOT NULL → match ON DELETE CASCADE,
  team_code text NOT NULL,                      -- match_team(match_id) for this school, stamped by trigger
  leg text NOT NULL CHECK (leg IN ('out','back')),
  driver_id uuid NOT NULL → app_user, declaration_id uuid NOT NULL → lift_driver_declaration,
  seats smallint NOT NULL CHECK (seats BETWEEN 1 AND 7),
  meet_kind text NOT NULL CHECK (meet_kind IN ('school','ground')),   -- D3: never free text, never a home
  meet_at timestamptz NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 120),   -- the driver's, to requesters: "leaving sharp; silver Fortuner"
  version integer NOT NULL DEFAULT 1,
  fixture_starts_at timestamptz NOT NULL, fixture_ground_id uuid,    -- the fixture as it stood (SCRBRD-122's shape)
  fixture_changed_at timestamptz,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed','cancelled','void','done')),
  cancel_kind text CHECK (cancel_kind IN ('driver','school','dso','fixture','link_ended','policy_withdrawn')),
  cancelled_at timestamptz, cancelled_by uuid → app_user,
  departed_at timestamptz, arrived_at timestamptz,          -- the driver's marks, only ever null → a time
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cancel_whole CHECK ((state IN ('cancelled','void')) = (cancelled_at IS NOT NULL)),
  CONSTRAINT arrives_after_departing CHECK (arrived_at IS NULL OR departed_at IS NOT NULL)
)

lift_seat (
  id uuid PK, offer_id uuid NOT NULL → lift_offer ON DELETE CASCADE,
  school_id uuid NOT NULL, match_id uuid NOT NULL, leg text NOT NULL,   -- denormalised from the offer, by trigger
  player_id uuid NOT NULL → player ON DELETE CASCADE,
  guardian_link_id uuid → assignment_subject,   -- the live verified link whose holder consented; NULL when he consented for himself (§3.3)
  requested_by uuid NOT NULL → app_user,
  guardian_ok_version integer, driver_ok_version integer,   -- rule 1: confirmed only while both = offer.version
  state text NOT NULL CHECK (state IN ('requested','invited','confirmed','declined','withdrawn','cancelled','void','done')),
  boarded_at timestamptz, handed_over_at timestamptz,
  handover_kind text CHECK (handover_kind IN ('received','not_collected')),
  acknowledged_at timestamptz, acknowledged_by uuid → app_user,
  resolved_at timestamptz, resolved_by uuid → app_user, resolution text CHECK (resolution IN ('collected_late','school_office','other')),
  missed_alerted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
)
UNIQUE INDEX one_live_seat ON lift_seat (match_id, player_id, leg) WHERE state IN ('requested','invited','confirmed')

lift_driver_bar (                               -- phase 3, §4.7: the DSO's act; no reason here, the reason lives in a concern
  id uuid PK, person_id uuid NOT NULL → app_user, school_id uuid NOT NULL → school,
  set_by uuid NOT NULL → app_user, set_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz, lifted_by uuid → app_user,
  CONSTRAINT lift_whole CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
)
UNIQUE INDEX one_open_bar ON lift_driver_bar (person_id, school_id) WHERE lifted_at IS NULL

lift_purge_log (school_id, purged_at, season text, offers integer, seats integer)   -- §5.3: what is left after a purge names nobody
```

No phone number, no address and no name is stored in any of these. Names and numbers are read live, through the functions in §1.4, from `app_user`, `player` and `emergency_contact`, and only when the function's rule allows.

### 1.3 The states, and what moves them

**A seat's status is derived**, not stored, by `lift_seat_status(seat)` → `confirmed` (state `confirmed` and both versions equal the offer's), `awaiting_driver` (the offer's version moved because the fixture did, and the driver has not re-affirmed), `awaiting_guardian` (the driver's version is current, the guardian's is not), else the state word. A view `lift_seat_live` carries it for the screens.

| act | by | offer | seat |
|---|---|---|---|
| create offer | driver | `open`, version 1 | — |
| request a seat | the boy's guardian (or himself from 18, §3.3) | — | `requested`; `guardian_ok_version` = offer.version |
| invite a boy (phase 3, D18) | driver, from the side's sheet | — | `invited`; `driver_ok_version` = offer.version |
| accept | the other party | — | `confirmed` when both versions = offer.version; refused when confirmed seats = `seats` |
| decline | the other party | — | `declined`; no reason stored |
| withdraw consent | any live verified guardian of the boy, any time before `boarded_at` | — | `withdrawn` (D13) |
| edit the offer (time, meeting point, seats, note) | driver | version + 1; `driver_ok_version` on every live seat = new version | `awaiting_guardian` until each guardian re-consents |
| **the fixture's start or ground changes** (SCRBRD-122's trigger family, §1.5) | the platform | version + 1, `fixture_changed_at` | `awaiting_driver`, then `awaiting_guardian` |
| **the fixture is cancelled** | the platform | `void`, `cancel_kind = 'fixture'` | `void` |
| close to new requests | driver | `closed` | unchanged |
| cancel | driver / the school (`transport.lift.oversee`) / the DSO's bar / a link that ended / the policy withdrawn | `cancelled` with its `cancel_kind` | `cancelled`; every guardian told "this lift is no longer available", never why |
| left | driver, on the day | `departed_at` | — |
| boy in | driver | — | `boarded_at` |
| boy handed over | driver | — | `handed_over_at`, `handover_kind = 'received'` |
| could not hand over | driver | — | `handed_over_at`, `handover_kind = 'not_collected'`; §6.2 |
| received | the receiver (§1.6) | — | `acknowledged_at`, `acknowledged_by` |
| arrived | driver | `arrived_at`; `done` when every boarded seat is acknowledged or resolved | `done` |

Every mark is a timestamp that goes from null to a time once, as `trip_mark()`'s do (db/41): a driver reports; she does not re-time, reassign or edit what happened.

### 1.4 The functions

All `SECURITY DEFINER`, `search_path` pinned (db/16), `REVOKE ALL FROM PUBLIC` then `GRANT EXECUTE TO scrbrd_app`, each deciding WHO inside itself (db/57's shape), each writing a `notification` where the table says so. Every refusal is a word, never a sentence that reveals a row the caller may not see.

| function | who | does |
|---|---|---|
| `lift_policy_sign(school, body, requires_clearance, allow_one_to_one, meet_note)` | `transport.lift.policy` at the school | withdraws the live policy, writes the next version; no open offer is touched by a re-sign (drivers re-acknowledge at their next declaration) |
| `lift_policy_withdraw(school)` | same | `withdrawn_at`; every open offer at the school `cancelled / policy_withdrawn` |
| `lift_module_live(school)` STABLE | anyone signed in | `feature_enabled('lift_club', school)` **and** a live `lift_policy`: both keys (D17) |
| `lift_driver_declare(school, vehicle_description, registration, seats, checks)` | a person with a live verified guardian link at the school; the module live | withdraws her live declaration, writes one; `policy_version` = the live policy's |
| `lift_driver_declaration_withdraw(school)` | the declarant | `withdrawn_at`; her open offers `cancelled / driver` |
| `lift_driver_eligible(person, school)` STABLE | internal, and the screens through `my_lift_standing()` | true when: the module is live; a live verified guardian link at the school; a live unexpired declaration; no open `lift_driver_bar`; **no live `self` link** (a pupil never drives, D8); and, when the policy requires clearance, `police_clearance`, `child_protection` and `sexual_offences_register` each `current` for her at the school by `clearance_status()` (db/56). **Missing refuses here**, unlike `trip_driver_cleared()`: the school chose the requirement, and a parent is on no register that could show the gap |
| `lift_offer_create(match, leg, seats, meet_kind, meet_at, note)` | `transport.lift.arrange`; eligible; her own child on the fixture's side at this school (D2); the match not cancelled and not started; `seats` ≤ the declaration's; `leg = 'out'` ⇒ `meet_at < starts_at` | the offer with the fixture snapshot |
| `lift_offer_update(offer, seats, meet_kind, meet_at, note, version)` | the driver; optimistic on `version` | version + 1; seats' `driver_ok_version`; a notice to each live seat's guardian: "Mrs Naidoo changed the lift for Saturday. Please confirm again." |
| `lift_offer_reaffirm(offer, version)` | the driver, after a fixture change | `driver_ok_version` on live seats = version; the guardians' notice above |
| `lift_offer_close(offer)` / `lift_offer_cancel(offer)` | the driver; `transport.lift.oversee` at the school for cancel (`cancel_kind = 'school'`) | as §1.3 |
| `lift_offers_for(match)` | `transport.lift.arrange` with a child on the side; the module live | the open offers on this fixture at her school: driver's **name**, leg, meeting point and time, seats left, note, and her own child's seat status; **not** the other passengers (D6) |
| `lift_seat_request(offer, player)` | a live verified guardian of the boy (`assignment_subject`, `verification_state = 'verified'`, live today), the boy on the side; or the boy himself from 18 (§3.3) | `requested`; a notice to the driver: "A parent has asked for a seat on your lift to Kearsney" (no name in the notice) |
| `lift_seat_accept(seat)` | the driver (for a request) or the boy's guardian (for an invite); `FOR UPDATE` on the offer | confirmed count < seats, else `seats_full`; `confirmed`; a notice to the other party |
| `lift_seat_decline(seat)` / `lift_seat_withdraw(seat)` / `lift_seat_reconfirm(seat)` | as §1.3 | as §1.3; a withdrawal after `boarded_at` is refused `already_boarded` — she phones |
| `lift_passengers(offer)` | the driver; a guardian whose own seat on it is `confirmed` (D6); `transport.lift.receive` on the side for the `out` leg (§1.6); `transport.lift.oversee` only for a seat in exception (§6) | each confirmed seat's boy: **full name and nothing else**; logs `('lift_passengers', ARRAY[offer], '{name}', school)` |
| `lift_contacts(offer)` | inside the day window only (the day before to the day after `meet_at`, db/41's window) | to the driver: for each confirmed seat, the consenting guardian's name and phone (`app_user`) and the boy's active `emergency_contact` rows; to a confirmed seat's guardian: the driver's name, phone, `vehicle_description`, `registration`; logs `('lift_contacts', ARRAY[offer], '{phone,emergency}', school)` |
| `lift_mark(offer, event)` / `lift_seat_mark(seat, event)` | the driver, holding `transport.lift.arrange` still (a revoked or suspended guardian is refused on an offer that still names her, db/41's rule) | `departed`, `arrived`; `boarded`, `handed_over`, `not_collected`; forwards only |
| `lift_receive(seat)` | `out`: `transport.lift.receive` on the fixture's side; `back`: any live verified guardian of the boy, or himself from 18 | `acknowledged_at/by` |
| `lift_resolve(seat, resolution)` | `transport.lift.oversee` | closes a `not_collected` seat (§6.2) |
| `lift_expected(match)` | `transport.lift.receive` on the side | for the `out` leg: boy, driver's name, `meet_at`, status, `boarded_at` — the coach's head count |
| `lift_summary(match)` | `transport.lift.oversee` | per leg: offers, confirmed seats, boys still `requested`; the exceptions of §6 **by name**; no other name |
| `lift_history(school, from_date, to_date, person, player)` | `safeguarding.authorise` at the school (the DSO) | offers and seats with driver, boys, versions, every mark and acknowledgement; logs `('lift_history', …, '{driver,passengers,marks}', school)` — a plain `access_log` row, not a `safeguarding%` one: reading who drove whom is not evidence that a concern exists |
| `my_lifts()` | a session with a live `self` link | the pupil's own confirmed seats: driver's name, meeting point, time, `vehicle_description`; **no phone number** (rule 4) |
| `my_lift_standing(school)` | anyone signed in | whether the caller may drive here and, if not, which condition fails, in the school's words |
| `lift_driver_bar(person, school)` / `lift_driver_bar_lift(id)` | `safeguarding_authority('safeguarding.suspend', school)` (db/57); nobody bars themselves | phase 3, §4.7 |
| `lift_missed_watch()` | the platform's key, on a schedule (db/51's `milestone_watch()` shape) | §6.1 and §6.2's notices, once per seat (`missed_alerted_at`) |
| `lift_purge_due(school)` / `lift_purge(offer)` | `transport.lift.oversee`, from a due list; never a job | §5.3 |

### 1.5 When the fixture moves or is cancelled

SCRBRD-122 records the fixture as it stood on each availability answer and reads `needs_reconfirming` when start time, ground, format or overs change. A lift depends on two of those four: **the start and the ground**. So `lift_offer` carries `fixture_starts_at` and `fixture_ground_id`, and the same `AFTER UPDATE OF starts_at, ground_id, status ON match` trigger family that SCRBRD-122 adds (Opus builds them together, or the later one finds the earlier's trigger and adds a second function on the same events) does, for every live offer on the match at either school:

- start or ground changed: `version + 1`, `fixture_changed_at = now()`, and one notice to the driver ("Saturday's fixture has moved to Wednesday 14:00 at DHS. Do you still offer the lift?") — she re-affirms or cancels; until she re-affirms every seat reads `awaiting_driver` and no guardian is asked yet, because there may be no lift to consent to;
- `status` becomes cancelled or abandoned: every live offer `void / fixture`, every live seat `void`, one notice to the driver and one to each seat's guardian.

Format and overs alone do not touch a lift. A `meet_at` that is now after the new start is not corrected by the platform: the driver edits it when she re-affirms, and the screen says so.

### 1.6 Handover: who receives

Rule 5 says "the receiving guardian acknowledges". On the way **home** that is right: the boy's guardian, at the gate, from her own phone. On the way **out**, the boy is handed to the ground, where no guardian is. The adult who actually receives him there is the team's staff, who count heads before every match. So the `out` leg's receiver is a holder of `transport.lift.receive` on the fixture's side — coach, assistant coach, team manager — with a one-tap "with us" beside each expected boy on the coach's fixture screen (D7). The alternative — the guardian acknowledging a notice that her son was dropped somewhere she is not — confirms nothing.

---

## 2 · Who may

### 2.1 Capabilities

Four new capabilities, `ADDED_SINCE_01`, with `LEVEL`. Opus confirms the holder role keys against `roles.mjs`; the holder lists below are the recommendation.

| capability | level | held by | governs |
|---|---|---|---|
| `transport.lift.arrange` | 2 (reaches children's names on the day and adults' phone numbers) | `guardian` | declare as a driver; offer; request, accept, withdraw and reconfirm for **her own** children (the person anchor, ADR 0001: `app_can()` with the child); the marks on her own offer; `lift_contacts()` |
| `transport.lift.receive` | 1 | `coach`, `assistantcoach`, `teammanager`, team-scoped | `lift_expected()` for the side's fixtures; `lift_receive()` on the `out` leg; `lift_passengers()` on the `out` leg |
| `transport.lift.oversee` | 2 | the roles holding `transport.manage` today (assumption: `transportcoordinator`, `schooladmin`, `directorofsport`) | `lift_summary()`; cancel any offer at the school; `lift_resolve()`; the purge list |
| `transport.lift.policy` | 1 | `principal` | `lift_policy_sign()`, `_withdraw()` |

`superadmin` holds all four as it holds everything outside `safeguarding.*`. `dso` gains nothing: its reach is through `safeguarding.authorise` (history) and `safeguarding.suspend` (the bar), which it already holds (db/57). `driver` (the school's bus drivers) and `transportcoordinator` as such gain nothing about lifts beyond oversight: a lift is not a trip and never appears in `trip`.

### 2.2 The roles, in words

- **A guardian acting for her own child.** Requests, consents, withdraws, reconfirms, receives at home; sees the offers on her child's side's fixtures; sees the other passengers once her own seat is confirmed; sees the driver's number on the day. Every act runs through her live verified link to that child (`guardian_link_id` on the seat records which link consented). Her link ends by db/62's rule, and with it every seat it consented to (§6.4).
- **A guardian as driver.** Everything above, plus: declares (yearly), offers on fixtures her own child's side plays, accepts and declines requests, marks the day, sees her passengers' names and their guardians' and emergency numbers on the day. Not the side's list, not another team's fixture, not another driver's passengers.
- **A pupil.** Sees his own confirmed lift on his Home (S1's bus line: "Lift with Mrs Naidoo · 07:15 · school gate · silver Fortuner"), through `my_lifts()`, and nothing else: no phone number, no other boy's arrangement. Under eighteen he requests nothing and accepts nothing — consent is his guardian's, rule 1. **From eighteen while still at school** (db/62 keeps his guardian's link open): he requests and accepts for himself through his `self` link (`guardian_link_id` NULL, `requested_by` him); his guardian still sees the seat and may withdraw it — a "no" only, the shape db/62 §4 gives her post-18 public-name act — but may no longer consent for him. He never drives (§4.2, D8).
- **The principal.** Switches the module on for the school by signing the policy, and off by withdrawing it. Holds no other lift read by standing (`audit.read` shows the `lift_*` access-log rows, as for any resource).
- **The office and the transport coordinator** (`transport.lift.oversee`). Counts per fixture; exceptions by name; cancel; resolve; purge. Not the ordinary passenger lists.
- **The coach** (`transport.lift.receive`). Which boys are arriving by lift, with whom, when; "with us".
- **The DSO.** `lift_history()`, logged; the bar (phase 3). Not a party to any arrangement; no notice about ordinary lifts.
- **Support sessions, the platform-wide key, a pad credential.** Nothing: the three `RESTRICTIVE` cuts of db/57 §4.2 and db/50's `pad_scope_select` on every table.

### 2.3 Reads by policy

`lift_offer`: SELECT for the driver (`driver_id = app_user_id()`), for a guardian holding `transport.lift.arrange` over a child on the offer's side (an uncorrelated `SECURITY DEFINER` helper, db/41's `trip_driven_matches()` shape, so the policy reads no table under the caller's RLS), for `transport.lift.receive` on the side (the `out` leg) and `transport.lift.oversee` at the school. `lift_seat`: the driver of its offer; a guardian through her live link to `player_id`; `receive` and `oversee` as above. `lift_policy`: anyone signed in at the school (the text is meant to be read). `lift_driver_declaration`: the declarant and `oversee`. `lift_driver_bar`: `safeguarding.suspend` at the school only, plus the cuts; `lift_driver_eligible()` reads it as a definer and returns a boolean. A seat row carries `player_id`, but `player` is behind its own policies, so a driver who reads seat rows reads no name by SQL: names come only from `lift_passengers()`, logged.

---

## 3 · The school's switch, the policy text, and the day

### 3.1 Two keys (D17)

`lift_club` is a `feature_flag` of kind `module`, off by default, granted per school by the platform as `scorebook_import` and `workload_monitoring` are — so Kameel controls which schools it reaches. Within a school it is live only while the principal's signed `lift_policy` stands. The write route and every definer ask `lift_module_live(school)`. Withdrawing the policy cancels every open offer at once; parents are told the school has paused lift clubs.

### 3.2 The policy text

The screen shows the school's `body` in full before the first declaration and the first request, and the declaration records which version was read (`policy_version`). The platform supplies a template a school may start from (Sonnet, a constant, Kameel's words), covering: lifts are arranged between families; the school does not inspect or insure cars; the driver undertakes the four declared facts; what a driver does if a child is not collected (stay with the child, phone the school office at this number); the school's named meeting point; whether a boy may be the only passenger not the driver's own (D5); whether a clearance is required (D4); and how to raise a concern (the DSO card is one tap away on every screen). Two of those are switches on the row so the platform can enforce them; the rest is the school's to write.

### 3.3 The pupil past eighteen

Stated once, because db/62 makes it exact: his guardian's link is open while `still_at_school()`; from `majority_on(born)` the platform treats his consent as his own (the health and public-name precedents), so he requests and accepts through his `self` link; his guardian's remaining act is to withdraw a seat, never to make one. When he leaves school the link ends and with it her sight of anything. A pupil under eighteen with a `self` link is refused `not_yet_eighteen` on every request path, the word db/62 already uses.

---

## 4 · Safeguarding

What the CSA check's items say about a car full of other people's children, and what this design does about each.

### 4.1 The policy items a lift club touches

| CSA item (the check's label) | page | what a lift club does |
|---|---|---|
| **Transport of children**: every trip cleared by a DSO; the transport policy's vehicle and driver checks | p45–46; K6, SG-11 | Not applied to a lift (§4.6, D15). K6 is for the school's own trips; a DSO clearing each parent's car would make the school the operator. The four vehicle facts of p46 are what the declaration asks the parent to declare (licence, insurance, roadworthy, belts); nothing is verified by the platform |
| **Who may collect a child**: only a parent or guardian; anyone else needs two hours' notice with name, ID and relationship | p43; SG-13 | The per-lift consent by the boy's own guardian, given before the day, naming the driver, *is* the notice, recorded and dated. The driver's ID number is not stored (SG-13's reason stands). Whether the school's policy treats that as meeting p43 is the school's (D16) |
| **Adults in positions of trust**: the three checks every 24 months for coaches, administrators, officials; anyone working more than 5 days in 3 months | p19, p24–26; K4 | A parent giving occasional lifts is none of those by the letter. So clearance is the school's choice on its policy row (D4); when required, db/56's kinds and periods apply and a missing check refuses. A school that requires it records the checks in `adult_clearance` for the parent as for any adult |
| **Codes of conduct and the acknowledgement** | p17, p65, Annexure G; SG-7 | `code_acknowledged` on the declaration: the parent read the school's policy and the code before driving. Recorded, never a scan, yearly |
| **Never alone with a child** | p34 rule 6, p35 | §4.2 |
| **Reporting**: a concern reaches the DSO; The Guardian's app for anonymous reports | p27, p53; SG-2, SG-6 | §4.4: `safeguarding_concern_raise()` and nothing new |
| **Messaging** | SG-9 (the check's proposed rules) | §4.3: adults to adults only; no channel exists yet, and the design adds none |
| **Suspension** | p42; SG-4 | §4.7 |
| **Protection of information** | p52 | §5 |

### 4.2 One adult, one unrelated child

The platform makes two things true by construction and leaves the third to the school:

1. **The driver's own child is on the side** (D2): she is driving to her own son's match, so the ordinary car has her child in it. A parent whose own child is not on the fixture cannot offer on it. (The literal "sibling's parent" case — a boy riding with the parent of a boy on a different side playing the same morning — is therefore not possible in phase 1; it is a fixture she cannot read and a car her own child is not in. It can be revisited when a school asks, D2.)
2. **A pupil never drives** (D8): an eighteen-year-old still at school is an adult with a licence and a `self` link, and `lift_driver_eligible()` refuses him. A matric driving the U13s is what p19's "position of trust" is about, and no parent consented to him.
3. **A car with exactly one confirmed passenger who is not the driver's child** is shown, to the consenting guardian before she consents and to the driver when she accepts, as "Rohan would be the only other boy in the car" (the screen counts the driver's own children on the side as present). The school's policy either allows it (`allow_one_to_one`, the platform's default, because it is what a parent's lift home has always been) or refuses it, in which case `lift_seat_accept()` refuses `one_to_one_not_allowed` while the confirmed count would be one. This is the school's policy, not the platform's (D5).

### 4.3 Adults talk to adults

No message of any kind exists on the platform, and this design adds none. What it gives instead: the driver's 120-character note on the offer (read by requesters, all adults); each party's phone number to the other, on the day only, through `lift_contacts()`, logged; notices with `recipient_id` naming an adult. A pupil is never a recipient of any lift notice (SG-9's rule, already a test in db/57); his Home shows the lift line from `my_lifts()`, which carries no number. When `up9` is designed under SG-9, a lift thread between the driver and the consenting guardians is the obvious first use; the rule that a pupil is never in it holds there too (D12).

### 4.4 A concern

Any party — a parent, the driver, a coach, the boy — raises it through `safeguarding_concern_raise()` (db/57) exactly as for anything else, from the DSO card on every screen; the referral's `where_kind` already has `transport`. Nothing lift-specific is added to the concern record. What the lift record gives the DSO is `lift_history()` (§1.4): who drove whom, when each mark was made, which guardian consented and on which version — the facts a DSO needs to take a concern about a lift further, read through a logged function and never by a list read. The reporter's screen adds one line: "If this is about a lift, the DSO can see who drove and when; you need not say more than what happened."

### 4.5 What the DSO sees, and does not

Sees: `lift_history()` for any period, person or child at the school, every read logged; `lift_driver_bar` rows (phase 3). Does not see: contact numbers (those are `safeguarding_family()`'s under an open concern, db/57 §4.5), the declaration's checks (the office's), any notice about an ordinary lift. The DSO is not a party to any arrangement and is not asked to clear one (D15).

### 4.6 Why the DSO does not clear a lift

K6 puts every school trip in front of the DSO because the school operates it: its bus, its driver, its manifest. A lift is a family's car; rule 7's "the school facilitates, it does not operate" means the school's judgement is expressed once, in the policy and its two switches, not per car. A DSO who wants to stop a particular adult driving has the bar (§4.7), which is the safeguarding act, and needs no clearance step to exercise it.

### 4.7 Suspension and the bar: what this needs from safeguarding phase 2

Safeguarding phase 2 (`safeguarding_suspension`, SAFEGUARDING_DSO §5, §9.2) is not built. When it is, a suspension covers every assignment the person holds at the tenant, and `app_can()` reads it as one more liveness condition; a suspended guardian then holds nothing — she cannot offer, accept or mark, and `lift_mark()` refuses her on an offer that still names her, as `trip_mark()` refuses a suspended driver. That is free once phase 2 lands and this design relies on it. Two things it does not give, which phase 3 here adds:

1. **A bar narrower than a suspension.** A DSO who has a concern about a parent's driving, but no reason to cut a mother off from her son's fixtures and availability, needs to stop the driving alone. `lift_driver_bar` is that: set and lifted under `safeguarding.suspend` (held by `dso`, gating nothing yet, db/57 §9.1), one open row per person per school, no reason column (the reason is the concern, as `safeguarding_suspension.concern_id` keeps it), and the effect is `lift_driver_eligible()` false on the next statement, her open offers `cancelled / dso`, every guardian on them told "this lift is no longer available" and nothing else, and one notice with `recipient_id` to her: "You may not offer lifts at {school}. Contact the DSO." The office's screens never say why; `my_lift_standing()` says "the DSO has asked you not to drive at present" (the words are D11).
2. **What phase 2's build should know** so the two fit: the bar must not be folded into `safeguarding_suspension` (different reach, and a suspension's `one_open` index would make a bar and a suspension collide); and `suspension_status()`'s "suspended by the DSO" must not be the text a barred parent sees, because she is not suspended.

Until safeguarding phase 2 exists, a DSO's only lever is the bar (phase 3 here) and the office's cancel; a general suspension waits for its own migration.

---

## 5 · Privacy (POPIA)

### 5.1 The minimum each party sees

| party | sees | never sees |
|---|---|---|
| a guardian browsing offers | driver's name, leg, meeting point, time, seats left, the note | the passengers; the registration; any phone number |
| a guardian with a confirmed seat | the above, the other confirmed passengers' names (D6), and on the day the driver's number, car and registration | the other passengers' guardians |
| the driver | her requesters' boys by name (a request is a name: she must know whom she is accepting), her confirmed passengers, and on the day each consenting guardian's name and number and each boy's emergency contacts | the side's list; any other offer's passengers; anything after the day window |
| the pupil | his own lift: driver's name, point, time, car | any number; any other boy's lift |
| the coach | for his side's fixture: boy, driver's name, expected time, "with us" | the numbers; the `back` leg; other sides |
| the office | counts; exceptions by name; the declarations (the four facts, the car) | ordinary passenger lists |
| the DSO | the whole record through `lift_history()`, logged | contact numbers outside a concern |
| the principal, `audit.read` | the access-log rows for `lift_*` reads (who read whose name and when) | the records themselves, unless they also hold `oversee` |

### 5.2 Never

No home address: the meeting point is one of two named places and the only free text is the driver's 120-character note, whose screen says "a public place, never a home; no addresses". No location tracking: every mark is a tap, no coordinate is read or stored, and the ground's map link is the fixture's own. No photo. No ID number. No phone number or name in any `lift_*` row, in any notice body or in any push payload (pointer only, as everywhere).

### 5.3 Retention

The lift record is the answer to "who drove my son on 3 October, and when did he arrive". A concern about a lift may be raised long after the day, and CSA keeps an ordinary complaint's records three years (p64). So:

- **offers, seats and marks are kept three years after the fixture's day** (assumption; D9), then `lift_purge()` deletes them and writes one `lift_purge_log` row per school per season with counts and no names;
- **declarations** are kept while live and one year past `expires_on` or `withdrawn_at` (assumption), so "was she declared on the day" can be answered for a year, then purged;
- **bars** are the DSO's authority record and stay, like `safeguarding_suspension` rows;
- **the access-log rows** follow `access_log`'s own retention;
- **contact numbers and emergency contacts are never copied** into any lift row, so nothing about them is retained by this design at all.

Purge is pressed by `transport.lift.oversee` from a due list, never a job (Q6's rule in SAFEGUARDING_DSO §10). The number is the information officer's.

### 5.4 Audit of reads

`lift_passengers()`, `lift_contacts()`, `lift_history()` and `lift_expected()` each write `access_log` with a resource starting `lift_` and the school as `p_school`, so a parent's "who saw my son's name" and "who had my number" are answered from the one log, and the principal's `audit.read` answers "which adults' names did the DSO look at" without seeing the record. A guardian reading her own child's seat, a driver reading her own offer row, and a pupil reading `my_lifts()` are their own data and are not logged. No `lift_*` table is a `read-api.mjs` resource; the functions are the only doors.

### 5.5 For the information officer

Three points to note before a school goes live: the driver's sight of a boy's emergency contacts on the day, as processing in the child's interest through the same window `trip_contacts()` gives a bus driver (K5's decision by the DSO covers the role list; a lift driver holds no role and reaches them only through a confirmed seat inside the window); the three-year retention and its reason; and that the declaration's four facts are the parent's own statement, not a record the school verified, and the policy text says so.

---

## 6 · Failure cases

### 6.1 The driver does not arrive

No `departed` mark by `meet_at` + 45 minutes (assumption): `lift_missed_watch()` sends one notice to the driver ("Has your lift to Kearsney left? Mark it, or cancel it.") and one to each confirmed seat's guardian ("Mrs Naidoo's lift has not been marked as leaving. Ring her; the number is on the fixture card."), and the coach's expected list shows "not left" against each boy. The platform reassigns nobody: the guardian withdraws the seat and takes him herself, or asks for another offer, and the school's policy says what the family does. If the driver later marks `departed`, the notice stands as history and the marks continue.

### 6.2 A boy not collected at handover

The `back` leg, at the gate, no parent. The driver marks `not_collected`: one notice to every live verified guardian of the boy and, by name, to the `transport.lift.oversee` holders ("Rohan Pillay was not collected from Mrs Naidoo's lift at the school gate, 16:40"); `lift_contacts()` already gives the driver the guardians' and emergency numbers inside the window; the school's policy tells her what to do meanwhile. The seat stays in exception, and the offer cannot reach `done`, until a guardian arrives and acknowledges it from her phone (`lift_receive()`, which sets `acknowledged_at` beside the `not_collected` mark, and the resolution `collected_late`) or the office records `school_office` or `other` through `lift_resolve()`. "A missing child or an unconfirmed handover remains an explicit exception": the summary shows it red until resolved. A driver who cannot mark (no signal, no phone) is the same case as the bus driver who does not mark, and the office's resolve is the answer.

An `out`-leg drop-off with no "with us" from the coach within 30 minutes (assumption) sends one notice to the coach's side (`transport.lift.receive`, the side's staff) and to the guardian, and shows in the summary. The `back` leg's `handed_over` with no acknowledgement within 30 minutes sends one to the guardian: "Mrs Naidoo says she handed Rohan to you at 16:35. Confirm."

### 6.3 A guardian withdraws consent mid-season

There is nothing season-long to withdraw: every seat is per lift. She withdraws the seats she no longer wants, one act each (the screen offers "withdraw all future lifts", which is the same function in a loop, and says so), and the drivers are told "a seat was withdrawn" without a reason. If instead she withdraws the **link's** consent to processing (`assignment_subject.consent_state`, the office's route) or the office revokes the link, the trigger of §6.4 voids every seat that link consented to.

### 6.4 A lift offered by a guardian whose link ends

Her link ends by db/62's rule (her son leaves the school system; he turns eighteen away from school; the office revokes it) or her `guardian` assignment ends. `lift_driver_eligible()` is false on the next statement, so nothing new; and a deferred trigger on `assignment_subject` (and on `role_assignment` for a `guardian` row) — the same events db/62's triggers already watch — cancels her open offers `cancel_kind = 'link_ended'` and voids the seats she consented to as a guardian (`guardian_link_id` = the ended link), with the notices of §1.3. db/62 keeps a link open while the boy is at school past eighteen, so a parent of a matric may still drive and still consent, or withdraw, exactly as before his birthday (§3.3 gives him the making of a seat).

### 6.5 The smaller ones

- **Her own child drops off the side** (withdrawn from the squad, moved sides): the offer stands — she may still be going — and her card says "Rohan is not in this side; you may still offer, or cancel". A driver whose child leaves the *team* loses the side's fixtures by RLS and the offer is cancelled `link_ended` by the same trigger reading `team_membership`, or on her next act, whichever is first.
- **Two guardians of one boy** (two parents, both linked): either may request or consent; the later act stands, as for availability (STEP4 Q3); **a withdrawal by either ends the seat** (D13), the public-name shape in which a "no" from any competent giver wins.
- **Two requests for one boy on one leg**: refused by `one_live_seat`; the screen says which offer he is already on.
- **More requests than seats**: they wait as `requested`; the driver accepts whom she will; a seat freed by a withdrawal is not filled automatically (D18).
- **The driver's declaration expires between offer and day**: `lift_driver_eligible()` is false, `lift_offer_create()` refuses new offers, and the existing offer shows "declaration expired" to her and to the office's summary; the marks still work, because refusing the record of what happened helps nobody (db/08's reasoning on cover at "we have left"). Her next declaration clears it.
- **The fixture's day arrives with seats `awaiting_guardian`**: they are not confirmed; the driver's card lists them under "not confirmed — do not take", the coach's list does not expect them, and no contact is exchanged for them.

---

## 7 · The seven rules, sharpened

| rule | as agreed | sharpened, and where |
|---|---|---|
| 1 Consent per child, per lift | his own guardian accepts that driver for that lift | any live verified guardian; a "no" from any guardian ends it (D13); versions, not a tick, so a changed lift is a new consent (§1.3); from eighteen at school he consents for himself and she may only withdraw (§3.3) |
| 2 Only known adults drive | a linked guardian who declares a licence; clearance the school's choice | **incomplete**: add that a pupil never drives, that the declaration expires yearly and names the car, and that a DSO may bar (§4.2, §4.7) |
| 3 Least shared | names to the driver and the accepting guardians; named points; no tracking | **incomplete as written**: the receiver at the ground (the coach), the school on an exception, and the DSO on a logged read also see names, and must (§1.6, §5.1); a guardian sees the others only once her own seat is confirmed (D6); the meeting point is one of two, never typed (D3) |
| 4 Adults talk to adults | no adult messages a child | also: no notice to a child, no number to a child (§4.3) |
| 5 Handover confirmed | driver marks; the receiving guardian acknowledges; a miss alerts both | the `out` leg's receiver is the side's staff, not a guardian (§1.6); "boy in" is marked as well as "handed over"; not-collected is its own mark and stays an exception until resolved (§6.2) |
| 6 A route to the DSO | `safeguarding_concern_raise()` | unchanged; plus `lift_history()` so the DSO can act on what is raised (§4.4) |
| 7 The school decides | module off; the principal switches it on with the policy | two keys: the platform grants the module, the principal signs the policy (D17); the policy carries two enforceable switches (D4, D5) and its named meeting point |

One rule is missing and is added: **no child is ever assigned to a car by the platform or the school**; every seat is two people's acts, and a freed seat stays empty until someone asks (D18).

---

## 8 · Phasing

One migration per phase, its proof in `db/99` (the next free section), a smoke walk, and `DEPLOYING.md`'s frozen-file rules. Numbers assume SCRBRD-122 takes the next migration after db/64 and SCRBRD-123 needs none (its planner is plain JS and publishes through the fixture route); so phase 1 here is **db/66** (assumption) and the section numbers follow whatever has landed. The module goes live for a school after phase 2: an arrangement without the day's marks is a noticeboard.

| phase | migration | tier | ships | proves (db/99 and a walk) |
|---|---|---|---|---|
| **1 · The arrangement** | db/66 | **Opus**: the five tables of §1.2 (not the bar), their policies and the three cuts, the four capabilities (`ADDED_SINCE_01`), `lift_club` flag row, the functions of §1.4 down to `lift_contacts()` plus `lift_offers_for()`, `my_lift_standing()`, `lift_summary()` (counts only), the fixture trigger of §1.5 (with SCRBRD-122's), the link trigger of §6.4, `lift_seat_live`, the route file `services/api/write/lift-api.mjs`. **Sonnet**: the principal's policy screen (Settings); the parent's declaration form and standing line (Family); the offer form (round trip = two offers) and the Lifts block on P3 (offers, request, status words, withdraw, reconfirm); the driver's offer card with requests to accept or decline; the office's counts on the fixture | a parent at another school, a parent with no child on the side, a pupil under eighteen, a coach, a support session, the owner's key and a pad credential can neither offer nor request and read zero `lift_offer` rows; a guardian requests for her own child and is refused for a team-mate; a pupil of eighteen at school requests for himself and one of seventeen is refused `not_yet_eighteen`; a request for a boy already on another offer's same leg is refused; accept beyond `seats` is refused; a policy with `allow_one_to_one = false` refuses the lone passenger; the driver's own child off the side refuses the offer; `requires_clearance` with a missing check refuses and with three current checks allows; a fixture's start change moves the version and every confirmed seat reads `awaiting_driver`, then `awaiting_guardian` after the reaffirm, then `confirmed` after the reconsent; a fixture cancelled voids everything and writes one notice per adult and none to a pupil; a link ended cancels the driver's offers and voids the seats it consented to; `lift_passengers()` returns names to the driver and to a confirmed guardian, nothing to a requester, and lands in `access_log`; `lift_contacts()` returns numbers inside the window and nothing outside, and logs; no `lift_*` row holds a phone, an address or a name (a column-name assertion); withdrawing the policy cancels every open offer. Walk: `smoke-lifts` (policy, declaration, offer, request, accept, fixture move, reconfirm) and `smoke-browser-lifts` (the parent's P3 block and the driver's card) |
| **2 · The day** | db/67 | **Opus**: `lift_mark()`, `lift_seat_mark()`, `lift_receive()`, `lift_resolve()`, `lift_expected()`, `lift_summary()`'s exceptions, `my_lifts()`, `lift_missed_watch()` and its route for the platform's key, the purge pair and `lift_purge_log`. **Sonnet**: the driver's day card (left, boy in, handed over, not collected; the numbers); the guardian's day card (the driver's number and car; "confirm collected"); the coach's expected list with "with us"; the pupil's Home line; the office's exceptions and resolve; the purge list | marks go forward only and a second `departed` is refused; a mark by a guardian who is not the driver is refused; the `out` receiver is the coach and a guardian is refused there; the `back` receiver is a guardian and the coach is refused there; `not_collected` writes a notice to every live guardian and to `oversee` by name, and the offer cannot reach `done` until resolved; the watch alerts once per seat; `my_lifts()` returns the pupil's own seat with no number and nothing for a team-mate; purge deletes rows past the date, refuses before it, and leaves a log row naming nobody; a revoked guardian is refused a mark on an offer that still names her |
| **3 · Safeguarding and invitations** | db/68 | **Opus**: `lift_driver_bar` and its two functions under `safeguarding.suspend` (with `safeguarding_authority()`); `lift_history()`; the driver's invitation path (`lift_seat_invite()`, over the side's sheet read STEP4 Q10 decided, which must exist first); the bar's notices. **Sonnet**: the DSO's history screen (under Safeguarding); the "invite a boy" action on the driver's card; the barred parent's standing line | the DSO bars and every open offer cancels `dso` with nameless notices; the barred parent's `my_lift_standing()` says the agreed words and the office's screen says nothing; the owner's key, the office and the principal read zero bar rows; the bar and (once safeguarding phase 2 lands) a suspension coexist; `lift_history()` is refused to everyone but `safeguarding.authorise` at the school and logs a plain `lift_history` row; an invitation waits on the guardian and the driver cannot confirm it herself |
| **4 · Later, if asked** | — | — | a lift thread under SG-9 when `up9` exists; a driver whose child plays a different fixture at the same ground; a school-level retention setting; the sibling case | — |

Phase 1 must be first. Phase 3's invitation path waits on STEP4 Q10's team-sheet read and on nothing else; its bar waits on nothing.

---

## 9 · Decisions for Kameel

Each with the recommendation the body assumes. Where the answer is the school's policy rather than the platform's, the row says so.

| # | decision | recommendation |
|---|---|---|
| **D1** | One offer per leg; a round trip is two offers made by one form | **Yes.** A boy goes out with one parent and back with another every Saturday; one state machine per leg keeps consent and handover exact |
| **D2** | The driver's own child must be on the fixture's side; a parent whose child is not on it cannot offer | **Yes, for now.** It is the car her son is in, it is the only fixture she can read, and it makes "never alone with an unrelated child" true by construction. The sibling case is phase 4 if a school asks |
| **D3** | Meeting points are two named places — the school (the policy names the spot) or the ground — and never free text | **Yes.** The one way to keep a home address off the platform is to have nowhere to type it |
| **D4** | Clearance for drivers: required or the school's choice? | **The school's** (a switch on the policy row, default off). CSA's checks are for coaches, administrators and officials; a parent's occasional lift is not that by the letter. When a school switches it on, a missing check refuses |
| **D5** | A car whose only other boy is not the driver's child: refuse, or allow and say so? | **Allow by default and say so to both adults; the school's policy may refuse.** It is what a lift home has always been. **The school's** |
| **D6** | When does a guardian see the other passengers' names? | **Once her own seat is confirmed.** Before that, "2 of 4 seats taken". Rule 3's "accepting guardians", read narrowly |
| **D7** | The receiver on the way out is the side's staff (coach, assistant, manager) with a one-tap "with us"; on the way home, the boy's guardian | **Yes.** A guardian cannot acknowledge a handover she was not at; the coach counts heads anyway |
| **D8** | The pupil: sees his own lift (no number); never requests under eighteen; from eighteen at school requests and accepts for himself and his guardian may only withdraw; never drives at any age while at school | **Yes.** db/62's post-18 shape applied to lifts, and a matric behind the wheel is exactly p19's position of trust |
| **D9** | Retention: three years after the fixture for offers, seats and marks; a year past expiry for declarations; then a logged purge to counts; contacts never stored | **Three years.** CSA's ordinary complaint period; a lift is the record a late concern is checked against. The number is the information officer's |
| **D10** | The school's oversight is counts and exceptions by name plus cancel and resolve; the DSO's is the whole record, logged | **Yes.** "Facilitates, does not operate": ordinary passenger lists are the families' |
| **D11** | A DSO's bar on driving, separate from a general suspension, under `safeguarding.suspend`; the parent sees "the DSO has asked you not to drive at present"; the office sees nothing | **Yes.** A concern about driving should not cut a mother off from her son's fixture card; the words are yours |
| **D12** | No messaging in phases 1–3: the note on the offer, and phone numbers to each other on the day | **Yes.** No channel exists; adding one here would pre-empt `up9`'s SG-9 design. Numbers on the day are what parents exchange anyway |
| **D13** | Two guardians of one boy: the later act stands, but a withdrawal by either ends the seat | **Yes.** A "no" from any competent giver wins, as for his public name |
| **D14** | The clocks: 45 minutes for an unmarked departure, 30 for an unacknowledged handover, one alert per seat | **Those numbers, as assumptions.** Tune after a term |
| **D15** | The DSO does not clear each lift (K6 applies to the school's trips), and no trip checklist (SG-11) applies | **Yes.** Per-car clearance makes the school the operator. The bar is the safeguarding lever |
| **D16** | CSA p43 (two hours' notice with name, ID and relationship for a non-parent collecting a child): the dated per-lift consent naming the driver is the notice; no ID number is stored | **Yes, and it is the school's** to say in its policy whether that satisfies p43 for its parents. SG-13's reason for not storing an ID stands |
| **D17** | Two keys: the platform grants `lift_club` per school; the principal signs the policy; withdrawing the policy cancels every open offer | **Yes.** You choose which schools; the school chooses whether and on what terms |
| **D18** | No automatic assignment ever: requests may exceed seats and wait; a freed seat stays empty; the driver's invitation (phase 3) still needs the guardian's yes | **Yes.** The line the earlier build got right |

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `trip`, `trip_mark()`, the forwards-only marks; `trip_contacts()`'s day window and per-child anchor; `trip_driver_own_only` (`RESTRICTIVE`) and db/41's rule that a policy reads no table under the caller's RLS | `db/08` 2785–2938; `db/41` | the marks' shape; the contact window; the policy shape |
| `match_availability`'s "silence is not a yes" and `declared_by`; SCRBRD-122's fixture snapshot and `needs_reconfirming` | `db/08` 2941–3063; backlog SCRBRD-122 | versions instead of a status; the fixture trigger family |
| `assignment_subject` (`verification_state`, `valid_until`), `guardian_link_establish()`, `still_at_school()`, `majority_on()`, the deferred triggers on `team_membership`, the post-18 "no only" shape | `db/62`; `db/00` 523; `db/60` | who is a guardian and until when; the pupil at eighteen; the link-ended trigger |
| `adult_clearance`, `clearance_status()`, `clearance_kind_max_days`, the three kinds | `db/56` | D4 |
| `safeguarding_concern_raise()`, `safeguarding_authority()`, `safeguarding.suspend` and `.authorise` in the `dso` bundle, `notification.recipient_id` and its `RESTRICTIVE` policy, SG-9's pupil rule, the three `RESTRICTIVE` cuts, `log_restricted_read()` | `db/57`; SAFEGUARDING_DSO §2.2, §3.3, §4.2, §5 | the concern route; the bar; the notices; the cuts; the log |
| `safeguarding_suspension` (designed, phase 2) | SAFEGUARDING_DSO §5, §9.2 | §4.7 |
| `feature_flag` of kind `module`, `feature_enabled()` | `db/08`; SCRBRD-120 §4.1 | `lift_club` |
| `access_log`, `access_log_read` | `db/08` 526–598 | every named read |
| `milestone_watch()`'s scheduled shape | `db/08` 5721; `db/51` | `lift_missed_watch()` |
| `pad_scope_guard_install()` | `db/50`; `db/56` 129 | the pad cut on every table |
| P3 (the fixture card), S1 (the pupil's Home), P6 (Family), Q3 and Q10 | STEP4 §2.1, §2.2, §9 | where the screens live; two guardians; the side's sheet for invitations |
| CSA p19, p24–26, p34–35, p43, p45–46, p52, p64, Annexure G; K4, K5, K6, SG-2, SG-6, SG-7, SG-9, SG-11, SG-13 | `docs/policy/CSA_SAFEGUARDING_CHECK.md` | §4 |
