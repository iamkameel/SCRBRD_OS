# Step 4 — Parent and pupil screens: the design

**Status:** for Kameel's review, 2026-09-27. Nothing here is built.
**Source:** `docs/redesign/DESIGN_DIRECTION.md` §6 and §8 (step 4), `docs/policy/PUBLIC_DATA.md`, `docs/design/SCRBRD-110_workload.md`, the backlog items SCRBRD-083, 092, 099, 100, 102–107 and 110, and the policy package (`packages/policy/src/{roles,capabilities,tables}.mjs`).
**Reader:** the product owner first, then the Opus agent who builds the policy and data parts (§5, §8) and the Sonnet agent who builds the screens over reads that already exist. Plain words come first in each section; the detail follows.

---

## 0 · What this is, in one page

Today a parent and a pupil sign in to a staff application with the staff parts removed. A guardian is offered sixteen destinations (`apps/web/src/design/roles.js` `NAV_CAPABILITY` against the `guardian` bundle): Dashboard, News, Matches, Calendar, Competitions, Leagues, Officials, Readiness, Squad, Profiles, Injuries, Logistics, Fields, Notifications, Settings and Rulebook. A pupil, who holds `player` and `selfaccess` together (`ROLE_IDENTITY.player.also`), is offered eighteen, Skills and Training included. Each of those screens is a table or a list built for a coach, filtered by row-level security down to one child. The filtering is correct. The screens are wrong: a parent does not want a Readiness screen, a Fields screen and an Officials screen. She wants to know whether her son is playing on Saturday, where, how he gets there, and how he did.

This design replaces the two menus with **two small applications inside the same shell**: a family app for the guardian and a player's app for the pupil. Each has four destinations on a phone's bottom bar and nothing behind a "More" drawer. Each screen is built from reads the API already serves, under the capabilities the two roles already hold, and this document names the read for every card. Where a screen needs something the API does not have — a consent toggle, a list of one's own children, an invoice, a health share — §5 lists it, says whether it needs a migration, and routes it to Opus or Sonnet.

Five decisions shape everything below:

1. **The parent's app is about one child at a time.** With several children the top of the home screen switches between them; nothing is ever merged into one list (§6 of the design direction, kept). A child at a second school is just another child: the guardian's assignment already carries children across schools (ADR 0001).
2. **The pupil's app is his passport and his Saturday.** His caps, honours, figures and milestones on the `Board`, his team's fixtures with his own availability, and — when the workload module is on and consent is live — his daily check-in and the one tap that says "something doesn't feel right" (SCRBRD-110 §3, taken as designed).
3. **What the family sees is what the capability model already grants, drawn properly.** No capability is widened for either role in this step. Where a family screen wants more than the model grants (a pupil's own emergency contacts, a parent's sight of a disciplinary matter, a parent's sight of wellness), the screen says who to ask, using `boundaries()` from `roles.mjs`, and §9 raises the question rather than answering it in a view.
4. **Consent lives in one place the family can read and change.** A "Consents" screen per child shows every optional consent the platform holds about him — public name (`db/47`), scouting (`player_scouting_consent`), the passport (`passport_consent`), and, when their migrations land, photos (SCRBRD-092) and health monitoring (SCRBRD-110 §7) — each as a card with the wording agreed, the date, who gave it, and one switch. Withdrawal is the same switch. Nothing new is invented; two write routes are missing and named.
5. **Delight is the board's, and it is safe by construction.** A parent watching live sees the same black `Board` as the ground does, with the moments (§3.6) and the Tier 2 line; after the match, her son's innings in words from the shared commentary engine and a milestone card from the graphics pack (SCRBRD-106). Signed in, names are the ones the log carries. Sharing outside the app waits for the public page (SCRBRD-083 step 3) and then follows `publicName()`. No photo appears anywhere; the monogram stands in until SCRBRD-092.

Nothing here is hard-wired to "school" or "cricket": the words on the screen come from `school.kind` and `sport`, and the one cricket-shaped block — the figures on the passport — is a component per sport (§7).

---

## 1 · Who they are, and what they come for

### 1.1 The parent

She is the `guardian` role: an assignment carrying `assignment_subject` rows that name her children (`SUBJECT_SCOPED_ROLES`, `roles.mjs`), each link verified by the school and consented (`consent_state = 'granted'`, `db/00` 523–570), and each ending automatically on the child's eighteenth birthday (`guardian_link_establish()` sets `valid_until = majority_on(born)`, `db/08` 889; `db/10` corrected the older links). The seed already has the two shapes that matter: a guardian with one child (`R Pillay`'s parent, `db/98` 382, the case `tools/smoke-browser-read.mjs` walks) and a guardian with children at two schools (`db/98` 387–388).

She opens the app on a phone, in portrait, usually on a Friday evening or a Saturday morning, often on the boundary with the sun on the screen. Her jobs, in the order she asks them:

| # | Job | Today's answer | Feeds it |
|---|---|---|---|
| 1 | **Is he playing Saturday, where, and how does he get there?** | Matches list, Logistics screen, Fields screen — three destinations | `matches`, `trips?matchId`, `grounds`, `weather`, `match_squad?matchId` |
| 2 | **How did he do?** | Profiles → his row → career figures, in a table built for a coach | `career`, `career_by_season`, `milestones?playerId`, `GET /api/matches/:id/events` + `deriveMatch()` |
| 3 | **Declare him unavailable** (a funeral, a trip, a cold) | Not reachable: no family screen calls `POST /api/matches/:id/availability` though `guardian` holds `availability.declare` | `availability`, the route above |
| 4 | **Watch the match while I am at work** | Match Centre (built, step 3c) — but reached through a staff list | `GET /api/matches/:id/events`, `live_score` |
| 5 | **What has the school told me?** | Notifications and News, two screens | `notifications`, `news` |
| 6 | **Who do they ring if he is hurt, and is it right?** | Nowhere on a family screen; the route exists | `emergency_contacts?playerId`, `POST /api/players/:id/emergency-contacts` |
| 7 | **Is he hurt, and when is he back?** | Injuries screen, a coach's list with one row in it | `injuries` (a guardian reads all three tiers for her own child) |
| 8 | **What have I agreed to about him, and can I change it?** | Settings → Passport tab (school named), scouting consent beside it; public-name consent has no screen at all | `passport_consents`, `scouting_consent`; `public_name_consent_set()` (`db/47`, no route) |
| 9 | **What did the physio share with me?** | Nothing exists until SCRBRD-110 phase 5 | `wellness_share_open()` (designed) |
| 10 | **What do I owe?** | Nothing exists: `guardian` holds `invoice.read` and there is no invoice table | — |

Jobs 1–5 are weekly. Jobs 6–8 are once a season. Job 9 is rare and important. Job 10 is a question for §9.

*Rejected — one job list for both roles:* the pupil's first question is "am I in the side?", which the parent cannot answer about him; the parent's first is transport, which the pupil never thinks about. They are two products.

### 1.2 The pupil

He is between about nine and eighteen. He holds two assignments: `player`, scoped to his school and team, which reaches the things about the team (the fixture list, the squad, who is out and until when, the bus), and `selfaccess`, named to him alone, which reaches his own file (`roles.mjs` 271–336: his profile and PII, his figures, his development ratings, his medical record at every tier, his disciplinary record, and, when SCRBRD-110 lands, his load and his check-ins). He does not hold `availability.read`, so he cannot see a team-mate's declaration; he holds `availability.declare`, so he can make his own. He does not hold `medical.nature.read` on the team, so he knows a team-mate is out until the 12th and not why.

His jobs, in order:

| # | Job | Feeds it |
|---|---|---|
| 1 | **Am I playing Saturday, and what time is the bus?** | `matches`, `match_squad?matchId` (he reads the sheet under `player.profile.read` across his side), `trips?matchId` |
| 2 | **Say I am available, or not** | `availability` (his own row through `selfaccess`), `POST /api/matches/:id/availability` |
| 3 | **How am I doing?** — caps, fifties, wickets, my best, my season | `passport?playerId`, `career`, `career_by_season`, `milestones?playerId`, `honours`, `caps`, `player_shot_points?playerId`, `dismissal_breakdown` |
| 4 | **How did the match go?** (his team, live or after) | Match Centre, `GET /api/matches/:id/events` |
| 5 | **How do I feel today?** (the check-in) and **something doesn't feel right** (the flag) | SCRBRD-110 phase 2 (`wellness_checkin`, `wellness_flag`), only when consent is live and the module is on |
| 6 | **What has the coach posted?** | `news`, `notifications` |
| 7 | **What is on my record?** — his injury record, his ratings, his disciplinary record | `injuries`, `skills`, `ratings`, `disciplinary_records` — all through `selfaccess`, all his own |

He is nine at one end and an adult at the other. The screens do not change with age (the policy does, at eighteen, §3.3), but the words are chosen so a nine-year-old can read them and an eighteen-year-old is not patronised: "You're in the side", "Bus leaves 07:15", "Your best: 63 v Kearsney".

*Rejected — a "junior mode" with fewer screens for younger pupils:* it needs an age on the client, which is exactly the datum kept off every surface; and the school's own decision about who gets a login (§9 Q2) does the same job at the right layer.

---

## 2 · The screens

### 2.0 The shell, shared

Both apps use the existing shell (`apps/web/src/shell/MobileNav.jsx`, `Sidebar.jsx`): a four-item bottom bar on a phone, a rail on a laptop. What changes is the **destination list**: `NAV_CAPABILITY` in `roles.js` today derives a role's menu from capabilities, which is how a guardian comes to be offered Readiness. Step 4 adds a **persona menu**: for `guardian`, and for `player`-with-`selfaccess`, `navFor()` returns a fixed short list drawn in `design/roles.js`, still checked against capabilities (a destination whose read the role cannot make is not drawn), so the menu can only ever be narrower than the capability map, never wider. The design test that asserts every destination is in the capability map keeps holding.

The bottom bar has **four items and no "More"**. Every screen below is reached from one of the four or from a card on them.

| | Parent | Pupil |
|---|---|---|
| 1 | **Home** (per child) | **Home** |
| 2 | **Matches** | **Matches** |
| 3 | **Notices** | **Passport** |
| 4 | **Family** | **Me** |

Settings (theme, colours, devices — `SettingsView`'s Me tab) sit behind the person's name at the top of Home, as they do in every phone application, and not on the bar.

*Rejected — keep the drawer and simply shorten the list:* a drawer with six items is still a menu to read; four thumb-reachable items are the whole product for these two people.
*Rejected — a separate build or route for families:* one shell, one theme engine, one `Board`; the difference is a menu and a set of views.

### 2.1 The parent's app

#### P1 · Home — one child

```
┌──────────────────────────────────────────┐
│ SCRBRD            Mrs Pillay ▾   ⋯       │  name → Settings; ⋯ → theme, colours
├──────────────────────────────────────────┤
│ [ Rohan ]  [ Anika ]                     │  child switcher: chips, one lit (hidden with one child)
│ Hilton College · U15A · Cricket          │  body, secondary
├──────────────────────────────────────────┤
│ SATURDAY 3 OCT                           │  label
│ Hilton U15A v Kearsney                   │  title.md
│ 09:00 · Kearsney, Botha's Hill  › map    │  body
│ Bus 07:15 from the Chapel car park       │  body, only if a trip exists
│ 22° overcast, rain after 4               │  one line, only if weather exists
│ ┌──────────────────────────────────────┐ │
│ │ Rohan is AVAILABLE  · said by you Tue │ │  availability state + declared_by
│ │             [ Change ]               │ │  → declare sheet (P3)
│ └──────────────────────────────────────┘ │
│ Team sheet: named, batting 4      (or:)  │  from match_squad, when published
│ Team sheet: not out yet                  │
├──────────────────────────────────────────┤
│ ████████████ BOARD (black) ████████████ │  ONLY while his fixture is live
│  HILTON U15A               142 / 3       │  figure.lg
│  14.2 · need 45 off 34 · CRR 9.91        │
│  ● R Pillay 17 (12)   D Erasmus 5 (1)    │  his row lit
│  Partnership 22 (13)                     │
│                    [ Follow the match ]  │  → P4
├──────────────────────────────────────────┤
│ LAST MATCH · Sat 26 Sep · v Michaelhouse │  label
│ 17 off 12, run out. Hilton won by 4 wkts │  body — the commentary engine's words
│ 1 catch.                       [ Open ]  │  → P4 (past)
├──────────────────────────────────────────┤
│ THIS SEASON                              │  label
│ 214 runs · best 63 · 6 wkts · 3 caps     │  figure.md
│ ★ First fifty · 12 Sep v DHS             │  milestone line, if any this season
├──────────────────────────────────────────┤
│ SHARED WITH YOU                          │  only when a live wellness_share exists
│ Rohan's physio shared his check-ins for  │
│ 1–21 Sep. Open by 14 Oct.        [ Open ]│  → P7c
├──────────────────────────────────────────┤
│ NOTICES · 2 unread                       │
│ Training moved to 06:30 Thursday         │
│ U15A team sheet published                │
└──────────────────────────────────────────┘
```

Order of cards: **the next fixture first, always**, because it is job 1. The board appears only while his fixture is live and sits second so that the answer to "where is he" is never pushed down by a score. Then the last match in words, the season line, anything shared, and notices last and unread only (the day sheet's rule, §5 of the design direction).

A section a read cannot fill is not drawn. There is no "—" tile. With no fixture arranged the first card reads "No fixture is arranged for Rohan yet" and offers the team's Matches.

| Card | Read | Capability (held by `guardian`) |
|---|---|---|
| Child switcher | the children the session reaches: today `players` (RLS returns only her children) joined to `assignments`; **better, a `my_children` read (§5 G1)** | `player.profile.read` over her children |
| Next fixture | `matches` (the child's team's next `upcoming`), `grounds`, `weather` | `fixture.read`, `facility.read` |
| Bus | `trips?matchId` (`depart_at`, `pickup`, the one-word `status`) | `transport.read` |
| Availability | `availability` (her child's row: `status`, `declared_at`, `self_declared`, `declared_by_name`) | `availability.read` |
| Team sheet | `match_squad?matchId` — RLS returns her own child's row only, which is exactly the fact she wants | `player.profile.read` |
| Live board | `GET /api/matches/:id/events` → `deriveMatch()` → `boardFromInnings()` (`scorer/boardData.js`), `boardInsights()` (`scorer/signals.js`) — the day sheet's `useLiveScore` as it stands | `fixture.read` |
| Last match | the same events read, `deriveCommentary()` (`packages/scoring/src/commentary.mjs`) filtered to lines whose subject is her child, and `resultText()` (`lib/matchCentre.js`) | `fixture.read` |
| This season | `career_by_season?season=` for the child, `milestones?playerId` | `player.performance.read` |
| Shared with you | SCRBRD-110 phase 5: the share notice and `wellness_share_open()` | `wellness.shared.read` (designed, not built) |
| Notices | `notifications` (unread), `news` | `news.read` and the row's own capability |

*Rejected — the day sheet with the staff cards hidden:* the day sheet is "the day in the order it happens" for someone running it; a parent's day has one item in it. Same components (`Board`, `BentoCard`, `EmptyState`), a different screen.
*Rejected — a merged home for several children:* decided in the design direction §6 and kept; a merged list is where one child's information ends up beside another's, and the switcher makes "nothing on the screen names another child" true by construction.

#### P2 · Matches — his fixtures

```
┌──────────────────────────────────────────┐
│ Matches · Rohan            [U15A ▾]      │  the child's sides this season; usually one
├──────────────────────────────────────────┤
│ COMING UP                                │
│ Sat 3 Oct  09:00  v Kearsney (away)      │  ● available
│ Wed 7 Oct  14:00  v DHS (home)           │  ○ not answered  [Answer]
│ Sat 10 Oct 09:00  v Westville (away)     │  ✕ unavailable — travel
├──────────────────────────────────────────┤
│ PLAYED                                   │
│ Sat 26 Sep  v Michaelhouse   W by 4 wkts │  17 (12) · 1 ct
│ Sat 19 Sep  v Glenwood       L by 23     │  4 (9)
│ Sat 12 Sep  v DHS            W by 41     │  63* (58) ★ fifty · 2/18
└──────────────────────────────────────────┘
```

One list, upcoming then played, each row carrying **his** answer or **his** line. Tap an upcoming row for P3; a played row for P4. The chip is a word and a mark, never colour alone (§3.7).

| Element | Read |
|---|---|
| Rows | `matches` for the child's team (both anchors: `match.readAnchors` lets an away side's parent read the shared fixture) |
| Availability chip | `availability` |
| His line | `career`'s per-match source is not a read; the line is derived from the match's events (`deriveMatch()`), cached per match on the device. **If that proves slow on a season of forty matches, §5 G7 names the read to add** |

#### P3 · Fixture — where, when, how, and the declaration

```
┌──────────────────────────────────────────┐
│ ‹ Sat 3 Oct · Hilton U15A v Kearsney     │
├──────────────────────────────────────────┤
│ 09:00 start · 20 overs · Under 15 League │  the match line (§10 item 5)
│ Kearsney College, Botha's Hill    › map  │  ground + a maps link from ground.lat/lng
│ Umpires: appointed                       │  match_official — names shown (adults, outside the rule)
│ Pitch: firm, good grass cover            │  match_pitch_report, if filed
│ 22° overcast, rain after 4               │
├──────────────────────────────────────────┤
│ BUS                                      │
│ Leaves 07:15 · Chapel car park           │
│ Back about 15:30 · Driver: Mr Dlamini    │  trips: depart_at, return_at, pickup, driver_name, status word
│ Rohan's seat: taken                      │  seats_taken is a count; "taken" only if the manifest names him
├──────────────────────────────────────────┤
│ ROHAN                                    │
│ ● Available · said by you, Tue 29 Sep    │
│ [ Available ] [ Doubtful ] [ Unavailable ]│  three keys, 56 tall
│   Why? (only for doubtful/unavailable)   │  reason_kind: illness · family · academic · travel · religious · other sport · other
│   A note for the coach (optional, 280)   │
│                    [ Tell the coach ]    │  POST /api/matches/:id/availability
├──────────────────────────────────────────┤
│ TEAM SHEET                               │
│ Named · batting 4          (or) Not out  │
└──────────────────────────────────────────┘
```

The declaration writes the row the coach already reads (`match_availability`, `declared_by` = her, so the coach's list says "declared by the parent"). The vocabulary is the table's own `reason_kind` list; the note is capped at 280 by the schema. Nothing about *why* is shown to anyone but the people holding `availability.read` — the coach, the manager, leadership, and her.

"What he needs to bring" has no data behind it (§5 G8). Until it does, the card is not drawn; a coach who wants to say "whites and a packed lunch" says it as a team notice (`news.publish.team`), which lands in Notices.

*Rejected — the availability sheet as a modal from the list:* the fixture screen is where she is already looking at the bus time; the declaration belongs beside it.

#### P4 · The match — live or past

The Match Centre as built in step 3c (`views/matchcentre/MatchView.jsx`: Summary, Scorecard, Commentary, Partnerships, Analytics, Match details), opened **in family mode**: her child's rows are lit on the scorecard and his commentary lines are marked; the Analytics tab's per-player wagon wheel (SCRBRD-102) opens for **her child only**, because `player_shot_points?playerId` for another child is refused by RLS and the screen does not offer a row it cannot open. The moments (§3.6) and the Tier 2 line arrive as they do for any spectator. Nothing else changes.

**Names.** The scorecard shows the names the log carries, as the pad wrote them (`MatchView.jsx` header comment). A parent who may read the fixture therefore sees every child on the sheet by name, exactly as the board at the ground shows them. This is today's behaviour for every signed-in reader and this design keeps it (§9 Q4 asks it as a question). Opening a *row* — another boy's career, wagon wheel or profile — is refused, because those reads are under `player.profile.read` and `player.performance.read`, which her assignment holds over her own children only.

#### P5 · Notices

`notifications` and `news` in one list, newest first, unread lit, each row saying which child it is about when it names one (`subject_person_id`). A medical notice about her child reaches her because she holds `medical.status.read` over him; nothing about any other child can (`notification.readAlso`, `tables.mjs`). There is no filtering on the client.

Push follows the existing device path (`lib/push.js`, `POST /api/devices`), whose payload is a pointer and carries no name. Per-child or per-kind preferences ("only match results, not training") do not exist (§5 G9); Notices shows what RLS delivers.

#### P6 · Family — the file

```
┌──────────────────────────────────────────┐
│ Family                                   │
├──────────────────────────────────────────┤
│ ROHAN PILLAY                             │
│ Hilton College · U15A · link verified    │
│ Your guardianship on SCRBRD ends on his  │
│ 18th birthday, 14 Mar 2029.              │  from assignment_subject.valid_until — HER child, HER screen only
│  › Who to ring          3 contacts       │  P7a
│  › His record           name, DOB, ID    │  P7b
│  › His health           1 injury, back 12 Oct │ injuries at every tier (guardian holds all three)
│  › Consents             4 held, 1 to answer │  P7d
│  › Shared with you      1 open           │  P7c
│  › Account              none — invite    │  P7e
├──────────────────────────────────────────┤
│ ANIKA PILLAY                             │
│ Westville Girls' High · U13 Netball …    │  a second school is just a second card
│  › …                                     │
├──────────────────────────────────────────┤
│ Invoices                                 │  drawn only when the school's billing exists (§5 G6)
└──────────────────────────────────────────┘
```

**P7a · Who to ring.** The emergency contacts in priority order (`emergency_contacts?playerId`), edit and add (`POST /api/players/:id/emergency-contacts`), retire (`POST /api/emergency-contacts/:id/retire`). `guardian` holds `player.emergency.manage`. The screen says who else can see them: "the coach on the bus, the team manager, the physio, the driver on the day" — from `boundaries()`-style derivation over who holds `player.emergency.read`, not prose.

**P7b · His record.** What the school holds about him that she may read: full name, known-as, date of birth (`player.age.read`), address and phone (`player.pii.read`), height and weight (`player.biometric.read`), the ID number (`player.identity.read`) — from the `players` read, masked per row by the policy. The ID number is **hidden behind a tap** ("Show") and never in a list, because it is level 4 and a phone is left on tables. This is the one screen where a date of birth appears, and it is her own child on her own screen: the rule against ages on shared surfaces is about surfaces another person sees.

**P7c · Shared with you.** SCRBRD-110 §6.3 as designed: the list of `wellness_share` rows naming her, each with what was shared, for which dates, by whom, why, and until when it may be opened. Opening one calls `wellness_share_open()` and lands in the school's `access_log`. When it lapses the row stays and reads "closed". This screen is not built until SCRBRD-110 phase 5.

**P7d · Consents.** §4.

**P7e · Account.** Whether the child has his own login (a `selfaccess` link with `relationship = 'self'`), and — if the school allows one at his age (§9 Q2) — a request to the office to create it (`POST /api/requests`, the existing role-request path, with the child named as the request's subject). She cannot create it herself: appointments are `user.role.assign`, the office's.

#### What the parent never sees, against the model

| Never | Why (the capability she does not hold) |
|---|---|
| Another child's anything — name, availability, injury, figures | every capability is applied within her assignment's subject list (ADR 0001; `app_can()` refuses a guardian row with no subjects) |
| The coach's notes on her son | `player.note.read` — held by coaches and leadership, not guardians (`capabilities.mjs` 98–117, a stated policy decision with its POPIA cost named there) |
| His skill ratings and assessments | `player.development.read` — not in `guardian` (`tables.mjs` `player_skill`: "not a document the platform hands over without the school choosing to") |
| His disciplinary record | `discipline.read` — not in `guardian` (§9 Q5) |
| His bowling load, check-ins, flags, tests | `player.workload.read`, `wellness.read` — not in `guardian`; only a recorded share reaches her (SCRBRD-110 §6.3) |
| Why a team-mate is out | she holds `medical.status.read` only over her own child |
| Photos | none exist (A8, SCRBRD-092) |
| Sponsorship values, staff directory, audit | `sponsorship.finance.read`, `user.read`, `audit.read` |

Where one of these is asked for on a screen ("Why can't I see his ratings?"), the answer is `boundaries("guardian")` rendered as help: what it is, and who to ask.

### 2.2 The pupil's app

#### S1 · Home

```
┌──────────────────────────────────────────┐
│ SCRBRD                 Rohan ▾    ⋯      │
├──────────────────────────────────────────┤
│ SATURDAY 3 OCT                           │
│ v Kearsney (away) · 09:00                │  title.md
│ You're in the side · batting 4           │  match_squad (his row, his team)   (or) "Side not out yet"
│ Bus 07:15 · Chapel car park              │  trips
│ ┌──────────────────────────────────────┐ │
│ │ You said: AVAILABLE   [ Change ]     │ │  his own availability row (selfaccess)
│ └──────────────────────────────────────┘ │
├──────────────────────────────────────────┤
│ HOW ARE YOU TODAY?                       │  ONLY if workload module on AND health consent live
│ Sleep ○○○○○  Tired ○○○○○  Sore ○○○○○     │  SCRBRD-110 §3.2, 30 seconds, one a day
│                          [ Done ]        │
│ Something doesn't feel right?  [ Tell ]  │  the flag, one tap then a confirm sheet
├──────────────────────────────────────────┤
│ ████████████ BOARD (black) ████████████ │  while his team is live
│  HILTON U15A               142 / 3       │
│  …                                       │
├──────────────────────────────────────────┤
│ LAST MATCH · v Michaelhouse · W by 4 wkts│
│ You: 17 off 12, run out · 1 catch        │
├──────────────────────────────────────────┤
│ THIS SEASON                              │
│ 214 runs · best 63 · 6 wkts              │  figure.md
│ 23 more for 500 career runs              │  a milestone in reach — his own, from career + milestone thresholds
├──────────────────────────────────────────┤
│ TRAINING · Thu 06:30 · Nets, Main Oval   │  training_session (team.read)
├──────────────────────────────────────────┤
│ NOTICES · 1 unread                       │
└──────────────────────────────────────────┘
```

The check-in card and the flag sit **above the board** on purpose. On a training morning they are the thing he opens the app for, and SCRBRD-110 §3 needs them to take thirty seconds. The flag opens a confirm sheet ("This tells your coach and the physio to check on you today. It does not mark you injured and nobody else in the team sees it.") and then says who was told. Neither card exists on any screen a team-mate can open, because both are read under `wellness.read`, which `player` does not hold (SCRBRD-110 §6.5).

| Card | Read | Capability |
|---|---|---|
| Next fixture, team sheet, bus | `matches`, `match_squad?matchId`, `trips?matchId` | `fixture.read`, `player.profile.read`, `transport.read` (all in `player`) |
| His availability | `availability` (his row through `selfaccess`, which holds `availability.read`; `db/39` made this reach him even when his team assignment cannot read the fixture) | `availability.read`, `availability.declare` |
| Check-in and flag | SCRBRD-110 phase 2 | `wellness.write` (`selfaccess`) |
| Board, last match | the events read and the fold, as P1 | `fixture.read` |
| Season, milestone in reach | `career_by_season`, `career`, `milestones?playerId` | `player.performance.read` |
| Training | `training` | `team.read` |

*Rejected — showing him the team's availability so he can see who else is playing:* `player` does not hold `availability.read`, and the design direction's line — "unavailable, family" is a window into a child's home life — is right. He learns the side from the team sheet when it is published.

#### S2 · Matches — his team's

The same list as P2, for his team, with his own chip and line on each row, and the team sheet on a fixture once published (every name — he holds `player.profile.read` across his side, and a team sheet is what a team-mate reads). Tap for the fixture (S3, the P3 layout without the parent's declaration wording: "You said…") or the match (the Match Centre, as P4, with his own rows lit).

#### S3 · Passport

The screen the design direction §6 promises: "his own passport: caps, honours, career figures, the form guide, drawn with the same `Board` and figure roles."

```
┌──────────────────────────────────────────┐
│ Rohan Pillay                             │  title.lg
│ Hilton College · U15A · right-hand bat   │  body
├──────────────────────────────────────────┤
│ ████████████ BOARD (black) ████████████ │  the passport board: his career, figures-first
│  CAPS 23      RUNS 1 204    WKTS 41      │  figure.lg
│  HS 87*   AVG 31.7   SR 92   BB 5/18     │  figure.md
│  U15A 2026 · U14A 2025 · U13A 2024       │  board.dim
├──────────────────────────────────────────┤
│ [ Season ] [ Career ] [ Wheel ] [ Honours ]│  four tabs
│                                          │
│ SEASON 2026                              │
│ 9 inns · 214 runs · avg 26.8 · best 63   │  career_by_season
│ 6 wkts · econ 5.2 · best 2/18            │
│ Form: 17 · 4 · 63* · 22 · 0 · 31         │  last six innings, plain figures, no colour
│                                          │
│ MILESTONES                               │
│ ★ First fifty · 63* v DHS · 12 Sep 2026  │  milestones (milestone_label())
│ ★ 1 000 career runs · v Glenwood · 2025  │
│                                          │
│ HONOURS                                  │
│ U15A colours 2026 · Vice-captain 2026    │  honours, recognition, caps
│                                          │
│ PASSPORT LINES                           │
│ Cap 23 · verified · Hilton · 12 Sep 2026 │  passport(): family, label, value, source_school, confidence
└──────────────────────────────────────────┘
```

The **Wheel** tab is SCRBRD-102's panel over `player_shot_points?playerId`: filters, the run chips in the chip colours (§3.9), off side against on side, the areas per side. It is his own points only. The **Career** tab is `career` and `dismissal_breakdown`. Everything is a figure in the figure face, tabular; nothing is a KPI tile.

| Element | Read | Capability (via `selfaccess` or `player`) |
|---|---|---|
| Board, Career | `career` (his row), `caps` | `player.performance.read`, `player.profile.read` |
| Season, form | `career_by_season`, the events read for the last innings | `player.performance.read`, `fixture.read` |
| Wheel | `player_shot_points?playerId` | `player.performance.read` |
| Milestones | `milestones?playerId` (`player_milestone`, `milestone_label()`) | `player.profile.read` |
| Honours | `honours`, `recognition?playerId` (`honour`, read under `player.profile.read`) | `player.profile.read` |
| Passport lines | `passport?playerId` (`passport()` in `db/08`) — `ProfilesView.jsx`'s `PassportCard` already draws these | `player.profile.read` |

*Rejected — the Profiles screen's player row, restyled:* `ProfilesView.jsx` is a coach's list with a card per player, `D`-token styled, desktop-first. The passport is one boy, portrait, on a board. Its `PassportCard` and the wagon-wheel code are reused; the screen is not.

#### S4 · Me — his own file

```
┌──────────────────────────────────────────┐
│ Me                                       │
├──────────────────────────────────────────┤
│ MY BODY                                  │  SCRBRD-110 §4 — only when consented and the module is on
│ Load this week: steady · 7d 84 · 28d 310 │  load_summary(): the word, the windows, "a guide to a conversation, not a diagnosis"
│ Check-ins: 5 this week        › history  │  wellness_checkin
│ Flags: 1 · closed · "spoke to him"       │  wellness_flag + outcome
│ My limit: 6 overs a spell (U15 directive)│  effective_limits()
│ Shared about me: physio → Mum, 1–21 Sep  │  wellness_share rows he may read
├──────────────────────────────────────────┤
│ MY HEALTH                                │
│ Hamstring · rehab · back 12 Oct          │  injuries, all three tiers (selfaccess): nature, and the physio's notes on tap
├──────────────────────────────────────────┤
│ MY RATINGS                               │  skills, ratings (player.development.read via selfaccess)
│ Batting 6.8 · Bowling 5.9 · Fielding 6.1 │
├──────────────────────────────────────────┤
│ MY RECORD                       › show   │  players (his row): DOB, address, ID (hidden behind a tap)
│ Conduct matters                 › show   │  disciplinary_records — his own; on request, never on Home (§9 Q6)
├──────────────────────────────────────────┤
│ CONSENTS                                 │  read-only under 18 — "Your parents hold these. From your 18th birthday they are yours."
│ Name on public pages: yes (Mum, Jan 26)  │  at 18: the same cards as P7d, his to switch
├──────────────────────────────────────────┤
│ Settings: theme, colours, devices        │
└──────────────────────────────────────────┘
```

Everything on this screen is his through `selfaccess` and reaches one row's worth of person. "My body" is drawn only when `health_consent_live()` is true and the `workload_monitoring` module is on (SCRBRD-110 §7.3, §8), read through the `consents` and `my_features` resources; the trigger is the authority, not the screen.

#### What the pupil never sees, against the model

| Never | Why |
|---|---|
| A team-mate's availability, or why anyone is out | `player` holds `availability.declare` but not `availability.read`; `medical.status.read` shows `rtw_date`/`restricted` and not `injury_type` (`tables.mjs` `injury`) |
| A team-mate's ratings, notes, PII, DOB, emergency contacts | `player` holds none of `player.development.read`, `player.note.read`, `player.pii.read`, `player.age.read`, `player.emergency.read` |
| Any team-mate's load, check-in or flag | `player` holds no `wellness.*` or `player.workload.*` (SCRBRD-110 §6.5, to be asserted in `separation.test.mjs`) |
| The coach's notes on **him** | `player.note.read` is not in `selfaccess` either — the line `capabilities.mjs` draws, with its POPIA cost named |
| His own emergency contacts | `selfaccess` does not hold `player.emergency.read` (§9 Q7) |
| Invoices | `invoice.read` is the guardian's |
| Photos | none exist |

---

## 3 · Several children, and a child who is also a user

### 3.1 Switching between children

The switcher is a row of chips at the top of Home and Matches (P1, P2): one per child, the current one lit, hidden when there is one child. It is **not** in the bottom bar and not a drop-down, because it must be visible: the design direction's rule is that nothing on the screen names another child, and a parent glancing at a bus time must see whose it is without a tap. Family (P6) shows every child as a section, because Family is the one screen that is about all of them.

The choice is remembered on the device (`localStorage`, as the theme is) and defaults to the child with the nearest fixture. A child at a second school changes the school line under his name and nothing else: the reads are per child (`?playerId`, `?matchId`), each under that child's school's rows, and the guardian's assignment already spans schools (ADR 0001 named cross-school siblings as the case the model exists for).

*Rejected — one screen per child with a swipe between:* discoverable on iOS, invisible on the web, and it hides the second child entirely until found.

### 3.2 The pupil's account and the guardian's view

They are two assignments about one person, reading the same rows under different scopes, and the schema keeps them distinct on purpose:

- **Availability.** Either may declare; `match_availability` is one row per player per match, so the later statement stands and `declared_by` names who made it. The parent's screen says "said by Rohan, Wed"; the pupil's says "Mum said: unavailable, Tue"; the coach's list already says "declared by the player / parent" (`availability` read's `self_declared`, `declared_by_name`). No rule is added about who overrides whom (§9 Q3 asks whether one should be).
- **Health.** Both read his injury record at every tier (`guardian` and `selfaccess` both hold `medical.details.read`). His wellness (SCRBRD-110) is his alone until a named adult shares it; when they do, **he sees the share row** — what was shared, with whom, why (SCRBRD-110 §6.3, "the POPIA right of access applied to the disclosure itself"). The pupil's Me screen shows it under "Shared about me".
- **Consents.** Under eighteen the parent holds them and the pupil's Me screen shows them read-only, in plain words, with the date and the giver. At eighteen they become his (§3.3).
- **Ratings and the coach's notes.** He reads his ratings; she does not. Neither reads the notes. The two screens say so in the same words.
- **Discipline.** He reads his own record (`selfaccess` holds `discipline.read`); she does not (§9 Q5).

The parent's Family screen shows whether he has an account (P7e) and, if the school allows one at his age, asks the office for it. The school decides the minimum age, not the platform (§9 Q2).

### 3.3 Eighteen

The schema already ends guardianship at majority, and it does so with no job behind it: `guardian_link_establish()` writes `assignment_subject.valid_until = majority_on(born)` (`db/08` 885–889), `db/10` set the same date on every older link (and ended the ones with no date of birth, warning the office by name), and `app_can()` reads `valid_until` on every call. On his birthday the parent's assignment covers nothing about him from the next statement.

What the screens do with that:

**The parent, before the day.** Family (P6) shows the date once, on her own screen ("Your guardianship on SCRBRD ends on his 18th birthday, 14 Mar 2029") — read from `assignment_subject.valid_until`, never from `born`, and drawn nowhere else. Thirty days out a notice says so and says what she will and will not see afterwards.

**The parent, after the day.** The child's card on Family becomes a closed card: "Your link to Rohan ended on 14 Mar 2029. His record is his own now." The switcher drops him. His past fixtures and his figures are gone from her app, because she no longer holds any capability over him. If she wants to keep following his matches, that is a `spectator` assignment at his school (`fixture.read`, `news.read`, `competition.read`, no player profiles) — granted by the office at his request, no new role (ADR 0003). §9 Q8 asks whether that should be offered in the app.

**The pupil, on the day.** His Me screen's Consents section turns from read-only to his:
- **Public name:** C6 — his own record counts from his birthday; until he gives one his guardian's stands (`public_name_consent_set()` refuses a guardian's consent given on or after the birthday, `db/47`). The screen asks him once, plainly, and does not nag.
- **Health monitoring:** SCRBRD-110 §7.4 — the guardian's consent **lapses** on the day (`health_consent_live()` derives it; nothing is end-dated by a job), collection pauses and staff reads stop until he says yes, and then resume over the whole history. The check-in card disappears until he answers. This is stricter than C6 and is that design's Q7; this document assumes it.
- **Scouting and the passport:** `player_scouting_consent` and `passport_consent` are today set through the family's routes; from eighteen they are his to set (§5 G3 includes his `self` link as a giver).

Nothing about his own account changes. `player` and `selfaccess` were his before and remain his; an adult player at a club is the same two assignments with no guardian ever having existed.

*Rejected — a "transfer" step where the parent hands the account over:* there is nothing to transfer; the account was always his, and the parent's access ends by the row's own date.

---

## 4 · Consent and data, shown to the family

### 4.1 Plain words

The platform holds, or will hold, five optional consents about a child. Each is a record, versioned, end-dated and never deleted, given by a verified guardian (or the athlete himself from eighteen), and each is *separate* from the terms (SCRBRD-092: "one sign-up flow, separate consents"). The family sees them in one place — **Consents**, on the child's Family card (P7d) — as cards in one shape, and changes them with one switch each. The pupil sees the same cards on Me, read-only until eighteen.

```
┌──────────────────────────────────────────┐
│ ‹ Rohan · Consents                       │
├──────────────────────────────────────────┤
│ NAME ON PUBLIC PAGES              [ on ] │  public_name_consent (db/47)
│ "R Pillay" may appear on public score-   │  the wording of the version agreed
│ cards and the live page. Never a photo,  │
│ never a date of birth.                   │
│ Given by you · 14 Jan 2026 · v1          │
├──────────────────────────────────────────┤
│ PHOTOS AND VIDEO, INSIDE THE APP  [ off ]│  SCRBRD-092 — not built; the card is drawn when its table exists
│ Registered users at his school may see   │
│ photos of him. Never public.             │
│ Not yet answered                         │
├──────────────────────────────────────────┤
│ HEALTH MONITORING                 [ on ] │  health_monitoring_consent (SCRBRD-110 §7)
│ His training load and daily check-ins    │
│ are collected to help keep him playing.  │
│ Read by the physio and his coach; shared │
│ with you only as a recorded act.         │
│ Given by you · 2 Feb 2026 · v1           │
├──────────────────────────────────────────┤
│ SEEN BY ACCREDITED SCOUTS         [ off ]│  player_scouting_consent (built; SettingsView's ScoutingConsentSection)
├──────────────────────────────────────────┤
│ HIS RECORD MAY TRAVEL TO…         1 school│  passport_consent (built; SettingsView's PassportTab)
│ Westville Boys' High · named 3 Sep 2026  │
│                            [ Withdraw ]  │
├──────────────────────────────────────────┤
│ THE TERMS                                │
│ Your link to Rohan was verified by the   │  assignment_subject: verification_state, consent_version, consent_at
│ school on 12 Jan 2026 and you agreed to  │  read-only; withdrawing the terms is a conversation with the office
│ the terms (v3). › Read them              │
├──────────────────────────────────────────┤
│ Not on any list: Rohan is marked never   │  ONLY if player_never_public is set — the mark, never the reason
│ to appear on a public page. Ask the      │
│ school office about this.                │
└──────────────────────────────────────────┘
```

### 4.2 How withdrawal works on the screen

The switch is the withdrawal. Turning "Name on public pages" off calls `public_name_consent_set(player, false, version, …)`, which ends the open record with `withdrawn` and the rule takes effect on the next page served (C3: "immediate and reaches the past"). The card then reads "Withdrawn by you · 3 Oct 2026" and the switch is off. Turning it back on makes a new record. Nothing is deleted and the history is one tap away ("› history": every record, its giver, its dates, its end reason — `superseded`, `withdrawn`, `refused`).

Health monitoring behaves the same through `health_monitoring_consent_set()` (SCRBRD-110 §7.4: collection stops on the next statement, staff reads stop, the boy still sees his own, nothing is deleted). The screen says exactly that under the switch before she confirms.

The never-public mark (C5) is **shown as a fact and never explained**: the parent learns that he is on no list and is told to ask the office. `player_never_public`'s reason is readable only under `player.public.withhold` and the read `public_name_facts()` returns `neverPublic` as a boolean. The screen must not imply the parent set it, because she cannot.

### 4.3 The models used, and the one thing not invented

| Consent | Record | Set through | State today |
|---|---|---|---|
| Terms (processing at all) | `assignment_subject.consent_state/version/at` (`db/00`) | `guardian_consent_record()` (`db/08`), the office | built; shown read-only |
| Public name | `public_name_consent` (`db/47`) | `public_name_consent_set()` | **table built; no API route, no screen** (§5 G2) |
| Photos in-app | designed in SCRBRD-092 §3 "records like db/47's" | its own `_set()` | **not built** (§5 G4, migration, Opus) |
| Health monitoring | `health_monitoring_consent` (SCRBRD-110 §7.2) | `health_monitoring_consent_set()` | **not built** (SCRBRD-110 phase 1, Opus) |
| Scouting | `player_scouting_consent` (`db/08` 2087) | `POST /api/players/:id/scouting-consent` | built (Settings) |
| Passport travel | `passport_consent` | `POST /api/passport/consent`, `…/withdraw` | built (Settings) |

Nothing new is invented. One thing is *added* and named as such: a **`consents` read** (§5 G2) returning, per child the caller may answer for, one row per consent kind with its state, version, giver kind and dates — the read SCRBRD-110 §7.3 already assumes ("the screens read `health_consent_live` through a `consents` resource"). It exposes no reason and no guardian identity beyond "you" / "the office" / "his other guardian".

*Rejected — consents under Settings as today:* Settings is where the theme lives; a consent is about a child and belongs on his card. The existing `PassportTab` and `ScoutingConsentSection` move into P7d for a guardian and stay where they are for the office.
*Rejected — one master consent switch:* POPIA consent is specific to purpose (SCRBRD-092, SCRBRD-110 Q5); one switch is the bundling the design was written to avoid.

---

## 5 · Gaps in reads and policy

Everything a screen above needs that does not exist. **Sonnet** means a screen over an existing read, no policy change. **Opus** means a new read over minors' rows, a route that writes a consent or a family record, RLS, or a migration.

| # | Gap | What it takes | Migration? | Who |
|---|---|---|---|---|
| **G1** | **A `my_children` read.** The children the caller answers for: `player_id`, name, `school_id`, school name and `kind`, `team_code`, sport, `verification_state`, `consent_state`, `valid_until`, whether a `self` link exists. Today derivable from `players` (RLS-scoped) + `assignments`, but that gives no link state and no end date. | A `security_invoker` read over `assignment_subject` joined to `player` and `school`, restricted to the caller's own guardian assignments, in `read-api.mjs`. | No | Opus (minors' link data), small |
| **G2** | **Public-name consent: route and read.** `public_name_consent_set()` exists (`db/47` 332) with no `POST` and no screen. | `POST /api/players/:id/consents/public-name` `{ yes, version }` under `withPrincipal()`; a **`consents` read** (§4.3) covering public name, scouting, passport, and — when built — photos and health. | No | Opus |
| **G3** | **The pupil at eighteen as giver** for scouting and passport consents. `scouting_consent_set()` and `/api/passport/consent` accept a guardian; whether they accept the athlete's own `self` link from `majority_on(born)` must be checked and, if not, added, as `public_name_consent_set()` already does. | Function change, mirroring `db/47`'s C6 branch. | Yes, if the functions change | Opus |
| **G4** | **Photo/video consent record** (SCRBRD-092 §3). The Consents card cannot be drawn without it. | The migration SCRBRD-092 names: a table shaped like `public_name_consent`, its `_set()`, its live check. Storage and moderation are not step 4's. | Yes | Opus |
| **G5** | **Health monitoring consent, check-in, flag, share** — SCRBRD-110 phases 1, 2 and 5. Step 4 draws their cards; it does not build them. | As designed there. | Yes (theirs) | Opus |
| **G6** | **Invoices.** `guardian` holds `invoice.read`; `finance` holds `invoice.manage`; there is no `invoice` table, no read, no entry in `tables.mjs`. | A table, an RLS entry (`read: "invoice.read"`, person anchor on the child, school anchor), a read, a `finance` screen to raise them. Or a decision not to (§9 Q1). | Yes | Opus |
| **G7** | **A per-match line for one player** ("17 off 12, run out · 1 ct") without folding every match on the client. P2 and S2 derive it from `GET /api/matches/:id/events` per match, which is one fetch per row. | Either accept the fetches (a season is ~20 matches, each cached on the device), or add a `player_match_lines?playerId` read over `player_batting_since()`'s per-match composition (`db/44`'s season views are the pattern). Recommendation: ship with the fold and measure. | No (a view if added) | Sonnet first; Opus if the read is added |
| **G8** | **"What he needs to bring."** No data: `match` carries no kit note; `equipment_issue` says what school kit he holds, not what to pack. | Nothing in step 4. A team notice does the job today. If wanted later: a `kit_note` on `match` under `fixture.update` (a small migration) or a per-team standing note. | Later | — |
| **G9** | **Notification preferences per child or per kind.** `my_devices` and push are per device (`lib/push.js`, `POST /api/devices`). | Nothing in step 4; Notices shows what RLS delivers. Later: a preference table keyed on person + kind, read by `fanOut()`. | Later | Opus |
| **G10** | **The child's account request** (P7e). `POST /api/requests` exists for role requests; whether it can carry a subject child for a `player`+`selfaccess` appointment must be checked. | Route check; possibly a `subject_player_id` on the request. | Maybe | Opus |
| **G11** | **`assignment_subject.valid_until` on a read** for the guardianship-end line (P6, §3.3). | Part of G1. | No | Opus |
| **G12** | **A persona menu** in `design/roles.js` (`navFor()` for `guardian` and for `player`+`selfaccess`) and the family/pupil views, over the reads named in §2. | Screens. | No | Sonnet, Opus review (minors' data on screen) |
| **G13** | **Family mode in the Match Centre** (his rows lit, the Analytics tab offering only rows the reader can open). | Screen change to `MatchView.jsx` and the SCRBRD-102 panel. | No | Sonnet |
| **G14** | **The milestone card and the match story for a family** (§6). Components from SCRBRD-106; the share-outside action stays disabled until SCRBRD-083 step 3. | Screens. | No | Sonnet |
| **G15** | **Words per tenant kind and sport** (§7): a `words()` helper reading `school.kind` and `sport` for "school / club / academy", "pupil / player", "parent / guardian". | A small client module; no data change (`school.kind` and `sport` exist, `db/00` 28 and 227). | No | Sonnet |

No capability is added or widened for `guardian`, `player` or `selfaccess` in this step. Every widening a screen might have wanted is a question in §9 instead.

---

## 6 · What delights, within §1a

"The pad is for speed, the board is for emotion." A parent never holds the pad. Everything below is a spectator surface, so the whole of §3.6's interrupt slot is available to her, and none of it is available to a scorer.

1. **The board on her phone, live.** The same black `Board`, her son's row lit when he is in (`board.figure`, the other batter `board.dim`), the partnership row, the Tier 2 line rotating every 8 s with a pause control. When a four, a wicket or a fifty arrives while she is watching, the moment (`useMoments`/`MomentMark`, `views/matchcentre/live.js`) — never replayed on a reload, never over the score for more than 1.5 s. His fifty on her phone at her desk is the product's best moment and it already exists; step 4 puts it on the first screen she sees.

2. **His innings in words.** The commentary engine (`deriveCommentary()`, SCRBRD-098) already produces "Pillay drives through the covers for four" and the dismissal line; filtered to his lines and read in order they are his innings as a story, on P1's Last match card and on the Match Centre's Commentary tab with his lines marked. Deterministic, no AI line reaches a spectator (SCRBRD-098's rule).

3. **The milestone card.** When `player_milestone` gains a row for him (`milestone_watch()`, `db/08` 5721), Notices carries it and P1's season card shows the star. The card itself is SCRBRD-106's lower-third in portrait: "R PILLAY · 63* · 58 balls · first fifty · v DHS · 12 Sep 2026", his surname bold, figures tabular, balls as a subscript, a sponsor slot, **no photo** (a monogram in the board's lime until SCRBRD-092), **no age**. In the family app it is his full name, because the family is signed in and holds his profile. The **Share** action on it is drawn disabled with the reason ("Sharing outside SCRBRD comes with the public page") until SCRBRD-083 step 3; when it ships, the shared card is rendered on the server with `publicName()` — "R Pillay" with consent, "Batter" without — and carries `noindex`.

4. **The innings story and the summary** (SCRBRD-106 items 4 and 7) on the post-match screen the family opens from P1: each phase, the top performers, one closing line — "Hilton won by 4 wickets". Built once for the Match Centre, reused here unchanged.

5. **The passport board for the pupil.** His career on a black board in `figure.lg`, the flip (190 ms) when a figure changes after a match. A milestone in reach on his Home ("23 more for 500 career runs") is the Tier 2 idea applied to a season rather than an innings, computed from `career` and the thresholds `milestone_label()` already knows. It is his own figure about himself and appears nowhere a team-mate can see.

What is **not** done: no confetti, no sound, no push that names a child (the payload is a pointer), no leaderboard of the team's parents' children on a family screen (A3 keeps leaderboards off public pages and the same instinct keeps them off a screen about one child), no win-probability (parked in the design direction §10).

---

## 7 · Beyond schools

A club's junior section, an academy, a provincial programme and a union already exist as `school.kind` (`db/00` 28); `sport` is a table (`db/00` 227) and the shell's sport switcher reads it (`useSports()`). SCRBRD-110 §8 has already made the health side sport- and tenant-neutral. What step 4 does to stay that way:

- **Words from the tenant, not the code** (G15). "School" → the tenant's own noun ("club", "academy"); "pupil" → "player"; "parent" → "guardian" where the relationship is not `parent`; "Family" stays "Family" (it is a family at a club too). One helper, one place.
- **The passport's frame is sport-neutral; its figures are a component per sport.** Caps, honours, milestones, seasons, the passport lines (`passport()`), the check-in and the load word are the same for every sport. The figures block on the board (runs, wickets, the wheel, `dismissal_breakdown`) is cricket's, from cricket's reads, and is one component keyed on `sport.code`. Netball's figures block is a later component over its own reads; until it exists the frame draws caps, honours and milestones and no figures, without an empty tile.
- **The fixture, bus and availability screens are already sport-neutral:** `match`, `trip`, `match_availability`, `match_squad` carry no over and no run.
- **Adults.** At a club an athlete over eighteen has `player` and `selfaccess` and no guardian; the family app simply has no users there, and the pupil's app is the player's app, word for word except "pupil". His consents are his (`given_by = 'self'` in SCRBRD-110's record; `'pupil'` in `db/47`'s — the two words for one thing are noted in §9 Q9).
- **Age bands** appear on a family screen only as a team's name ("U15A"), which is how the team is named; nothing computes one on the client.
- **Season labels** come from `season_for(date, level)` with the tenant's level, as the career-by-season read does (`db/44`).

What does not travel and is not pretended to: the `bowling_directive` ceilings (cricket's regulatory layer) appear on the pupil's Me under "My limit" only for cricket, from `effective_limits()`, whose non-cricket answer is the athlete's own limit or nothing.

---

## 8 · Phasing

Each phase ships on its own, behind the walks that exist, and adds its own. The parent walk extends `tools/smoke-browser-read.mjs`'s guardian group ("A guardian sees one child": signs in as Pillay's parent, opens Squad, asserts Pillay is present and Bekker, Naidoo, Cele, Whitfield are not, names a school on the Passport tab and withdraws it, and asserts no scoping refusals). The pupil persona already exists in the seed (`db/98` 404–405: `player` on 1XI plus `selfaccess`) and has no walk yet. `db/99`'s last section is §28 (`db/50`); new sections take the next free numbers after whatever has landed first (SCRBRD-110's five, if it goes first).

| Phase | Ships | Guard | Who |
|---|---|---|---|
| **A · The two apps over what exists** | The persona menus (G12); P1, P2, P3, P4 in family mode (G13), P5, P6 with P7a and P7b; S1 (without the check-in card), S2, S3 without the Wheel tab if SCRBRD-102 has not landed, S4 without "My body"; G1 and G15. The existing `PassportTab` and `ScoutingConsentSection` reachable from P7d as they are. | `smoke-browser-read`'s guardian group extended: the four-item bar and no drawer; Home names one child and no other; the child switcher for the two-school guardian (`db/98` 387–388) shows two chips and each Home names only its child; a declaration from P3 lands as a row the coach's Squad screen shows as "declared by the parent"; emergency contacts edited and retired. **New `smoke-browser-pupil.mjs`:** signs in as the pupil, Home shows his team sheet line and his own availability and no team-mate's; Passport shows his figures; Me shows his own injury record with the nature and notes visible (selfaccess) and the Squad shows a team-mate's `rtw_date` and no `injury_type`; no scoping refusals. `db/99`: one new section proving `my_children` returns the caller's own links and nothing for a coach, a spectator or a second guardian. | Sonnet builds the screens; Opus builds G1 and reviews every screen (minors' data) |
| **B · Consents** | G2 (route + `consents` read) and G3; P7d in full for the consents that exist (public name, scouting, passport, the terms read-only, the never-public fact); S4's read-only Consents; the thirty-day and on-the-day notices for eighteen (§3.3). The SCRBRD-092 sign-up consent screen's public-name row draws from the same `consents` read. | `db/99` section: a guardian sets and withdraws public-name consent for her own child and is refused for another; a pupil's `self` consent is refused before `majority_on(born)` and accepted from it; the `consents` read shows no reason for a never-public mark and no other guardian's identity. Walk: the guardian switches public name off and `public_name_facts()` answers no on the next read; on again; history shows both records. | Opus |
| **C · The board's emotion for the family** | G14: the milestone card (portrait, monogram, no age, share disabled with its reason), the innings story and summary on the family's post-match screen, the passport's Wheel tab (after SCRBRD-102), the milestone-in-reach line. | `smoke-browser-pupil`/guardian walks: a seeded fifty produces the card with the full name signed in and no photo element; the share control is disabled; `smoke-a11y`'s emoji and type-floor checks over the new screens. No `db/99` change. | Sonnet, Opus review |
| **D · Photos consent record** (SCRBRD-092 step 1) | G4: the migration and `_set()`; the Consents card. No photo storage, no upload. | `db/99` section shaped like `db/47`'s §25: given, withdrawn, superseded; refused for another child; the never-public mark overrides it. | Opus |
| **E · The body, on the family screens** | When SCRBRD-110 phases 1–2 land: S1's check-in card and flag, S4's "My body"; when phase 5 lands: P7c and P1's "Shared with you" card. | That design's own `db/99` sections and walks; the pupil walk gains: with consent live the card is drawn and a check-in lands; with consent withdrawn the card is gone on the next load; a team-mate's Home never shows it. The guardian walk gains: a share opens and lands in `access_log`; after `open_until` it reads "closed". | Opus |
| **F · Invoices** (if §9 Q1 says yes) | G6 and the Family "Invoices" card. | `db/99`: a guardian reads her own child's invoices and no other's; `finance` reads the school's; a coach reads none. | Opus |

Phase A is the whole product for most families and needs no migration. Nothing in a later phase changes a screen shipped in an earlier one; each adds a card that was not drawn.

---

## 9 · Open questions for Kameel

### Decided (Kameel, 2026-09-27)

Every recommendation below stands, except:
- **Q10 — a parent sees the team sheet before the match.** Kameel: "it can allow for logistics between parents to
  be arranged or communicated." The shape to build: signed in, her own child's side and fixture only, the named
  players and their order — names only, no profiles, ages or photos. A narrow read over `match_squad`, not
  `player.profile.read`; it needs a `db/NN` and an `ADDED_SINCE_01` line (Opus).
- **Q6 — confirmed as drawn:** his disciplinary record on his Me screen, on request, behind a tap, never on Home.
- **Q12 — confirmed:** no photo feature in step 4.

Each with the recommendation the design assumes.

| # | Question | Recommendation |
|---|---|---|
| **Q1** | **Invoices.** `guardian` holds `invoice.read` and nothing exists behind it. Is billing part of SCRBRD, or does a school's bursar system stay where it is? | **Defer; draw nothing.** Phase F only when a school asks. A "coming soon" card on a family screen is the KPI tile again. |
| **Q2** | **Who gets a login, and at what age?** A nine-year-old with a phone is one school's normal and another's never. The check-in (SCRBRD-110) needs the boy's own account. | **The school decides**, as a setting per tenant (`school` has settings; no migration if it is a `feature_flag`-style key, a small one if a column). Platform default: no minimum, because the parent's Family card requests the account through the office (P7e) and the office is the gate either way. Under the school's minimum, P7e says so. |
| **Q3** | **When a parent and the pupil disagree on availability**, the later statement stands today and the coach sees who said it. Should a guardian's "unavailable" for a minor be changeable only by a guardian or staff? | **Leave it.** The coach reads `declared_by`; a rule here is a rule about families the platform has no business writing. Revisit if coaches report it. |
| **Q4** | **Names on a parent's scorecard.** A signed-in parent sees every child on the sheet by name, as the pad wrote them and as the board at the ground shows them. The public rule (initial and surname, consent) is for strangers. Keep it so? | **Yes.** Signed in, verified, linked to a child on the side: she is the boundary crowd, not the public. The dossier's cross-school reads are logged; hers are the same school's fixture. |
| **Q5** | **A parent and her child's disciplinary record.** `guardian` does not hold `discipline.read`; the pupil does through `selfaccess`. The school tells parents by letter today. Should the app? | **Not in step 4.** It is a widening of a level-3 read to a role, needs a `db/NN` and an `ADDED_SINCE_01` line, and the letter is the school's process. Raise it with the information officer alongside the notes' asymmetry (`capabilities.mjs` 110–116). |
| **Q6** | **Should a pupil's own disciplinary record be on his Me screen?** He may read it (`selfaccess`, `discipline.read`, level 3). A nine-year-old reading "conduct matters" on his phone is a different thing from a seventeen-year-old exercising a right. | **On request, behind a tap, never on Home** (as drawn). The right of access is his; the placement is ours. |
| **Q7** | **A pupil's own emergency contacts.** `selfaccess` holds no `player.emergency.read`, so a sixteen-year-old cannot check that the number the school has for his mother is right. | **Not in step 4.** Level 2, a small widening, and a correct one; do it as its own `db/NN` when the family app has been used for a term. |
| **Q8** | **After eighteen, may the parent keep following?** Her access ends by the row's date. A `spectator` assignment at his school gives fixtures, news and standings and no player record. Should the app offer it (the adult son invites, the office grants)? | **Yes, later, through the existing request path** (`POST /api/requests`). No new role (ADR 0003). |
| **Q9** | **`'pupil'` and `'self'`.** `db/47` calls the athlete's own consent `given_by = 'pupil'`; SCRBRD-110 uses `'self'` because a club athlete is not a pupil. Two words for one thing. | **`'self'` from here on**; `db/47` is shipped and stays. The `consents` read translates. |
| **Q10** | **The team sheet before the match, to a parent.** `match_squad` returns her own child's row, so she learns "named, batting 4" and nothing else. A7 kept sheets off public pages; signed-in team-mates see the whole sheet. Should a parent see the eleven? | **Not in step 4.** It is `player.profile.read` over the side, a real widening, and the team's own channels announce sides today. Ask coaches after a term. |
| **Q11** | **Words per tenant.** "Family", "Passport", "Me" as the bar's labels for every kind of tenant and sport? | **Yes.** "Home · Matches · Notices · Family" and "Home · Matches · Passport · Me" read the same at a school and a club; the nouns inside the screens come from `school.kind` (G15). |
| **Q12** | **Photos.** This design draws the SCRBRD-092 consent card (phase D) and no photo anywhere. Confirm no photo feature — upload, view, moderation — is part of step 4. | **Confirm.** The consent record first; the feature is its own design with storage and moderation. |

---

## Appendix A · Existing things this design relies on, by name

| Thing | Where | Used for |
|---|---|---|
| `guardian`, `player`, `selfaccess`, `enquiry`, `SUBJECT_SCOPED_ROLES`, `boundaries()` | `packages/policy/src/roles.mjs` | who holds what; "who to ask" on every refusal |
| `CAPABILITIES`, `LEVEL`, `SENSITIVE` | `packages/policy/src/capabilities.mjs` | the tiers named in §2's "never" tables |
| `TABLES` — `player`, `injury`, `match`, `match_squad`, `match_availability`, `trip`, `vehicle`, `emergency_contact`, `notification`, `honour`, `training_session` | `packages/policy/src/tables.mjs` | which capability governs each card's read; the person anchors that scope a guardian to her child |
| `publicName()`, `public_name_facts()` | `packages/policy/src/public.mjs`, `db/47_public_data.sql` 794 | the shared card, when the public page exists |
| `public_name_consent`, `public_name_consent_set()`, `player_never_public` | `db/47_public_data.sql` 197, 332, 481 | P7d |
| `assignment_subject`, `guardian_link_establish()`, `majority_on()`, `is_family_of()`, `player_guardian_status` | `db/00` 523; `db/08` 885–973, 1279, 6231; `db/10` | the link, its consent, its end at eighteen |
| `match_availability`, `POST /api/matches/:id/availability` | `db/08` 2973; `services/api/write/events-api.mjs` 1097; `server.mjs` 461 | P3, S1 |
| `emergency_contact`, `emergency_contacts` read, `POST /api/players/:id/emergency-contacts`, `…/retire` | `db/08` 4630; `read-api.mjs` 1165; `contacts-api.mjs` | P7a |
| `trip`, `trips` read, `trip_contacts()` | `db/08` 2785, 4724; `read-api.mjs` 1011 | the bus |
| `player_milestone`, `milestone_notice`, `milestone_label()`, `milestones` read | `db/08` 5662–5755; `read-api.mjs` 1374 | the star, the card |
| `career`, `career_by_season`, `dismissal_breakdown`, `player_shot_points`, `passport()` | `read-api.mjs` 2003, 2080, 2139, 204, 1438; `db/44`, `db/49` | the passport, the season line |
| `GET /api/matches/:id/events`, `deriveMatch()`, `deriveCommentary()`, `boardFromInnings()`, `boardInsights()`, `resultText()` | `packages/scoring`; `apps/web/src/scorer/boardData.js`, `signals.js`; `lib/matchCentre.js` | the board, the last match in words |
| `Board`, `useMoments`/`MomentMark`, the Match Centre's six tabs | `apps/web/src/ui/board.jsx`; `views/matchcentre/` | P4, S1 |
| `notification`, `notifications` read, `fanOut()`, `lib/push.js` | `db/08` 220; `read-api.mjs` 535; `services/api/notify/push-api.mjs` | Notices |
| `player_scouting_consent`, `passport_consent`, `PassportTab`, `ScoutingConsentSection` | `db/08` 2087; `SettingsView.jsx` 996, 1040 | P7d's two built cards |
| `NAV_CAPABILITY`, `NAV_GROUPS`, `navFor()`, `ROLE_IDENTITY.player.also` | `apps/web/src/design/roles.js` | the persona menu |
| `MobileNav`, `Sidebar`, `useNav()` | `apps/web/src/shell/`; `lib/features.js` | the four-item bar |
| `school.kind`, `sport`, `season_for()`, `feature_enabled()` | `db/00` 28, 227; `db/08` | §7 |
| the guardian group, the drawer sweep | `tools/smoke-browser-read.mjs` 161–191, 1375 | the walks phase A extends |
| the seed's personas: one-child guardian, two-school guardian, the pupil | `db/98_seed_pilot.sql` 382, 387–388, 404–405 | who the walks sign in as |
| SCRBRD-110's design: §3 the voice, §6.3 the share, §7 consent, §7.4 eighteen, §8 beyond schools | `docs/design/SCRBRD-110_workload.md` | taken as designed; not reopened |
| ADR 0001, 0002, 0003 | `docs/adr/` | one assignment decides; the coach's overview; no new roles |
| `PUBLIC_DATA.md` §1–§5a | `docs/policy/` | every name that leaves the signed-in app |
