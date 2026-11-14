# Experience pass: where things live, and the first run

Status: **decided** (13 Nov 2026). Kameel answered all 25 questions in §5 on the Build Board,
every one as recommended. The slices in §4 are built in order from those answers; slice 1 is built (#327) and slice 2a (#334); the rest are not built yet.

Brief (Kameel, 13 Nov 2026): information is scattered and not always where a person looks
for it. Each person gets one home and a short menu; everything else is reached from the
thing it belongs to (a match, a player, a team, a ground). Someone new gets something real
before we ask for much. Two targets, as hypotheses for the pilot: a person sees what needs
them within **five seconds**, and reaches their most common task in **two steps**.

What stands and is not reopened here: `DESIGN_DIRECTION.md` (all of it), the tokens,
`PUBLIC_DATA.md` and `PUBLIC_BY_TERMS.md`, sponsor slots (`ROLE_DASHBOARDS_v1.1` §7.1), the
floors, no new runtime dependency, the bundle ceilings, and what the pad records, its test
ids and the words the walks assert. Where one of these gets in the way, it is a question at
the end, with a recommendation.

How it was checked: every finding about today names its file and line at `origin/main`
`959df992`. Menu counts come from running `design/roles.js` through `design/homes.js`
(`collapseHomes`), which is what the shell draws. Sections 1 and 2 were drafted before the
screenshots were ready, and the shots were cited afterwards (below). No child is named; "T Bekker" is the placeholder the
consent designs already use, and the schools are invented.

Sections 1 and 2 were the first pass; sections 3 (stats and moments), 4 (six slices) and 5
(the questions, merged) the second, on the same base and the same rules. The screenshots
arrived after both were drafted (`audit/experience-screens/` on `claude/wip-experience-shots`
at `ff9dd6b7`, with `NOTES.md`: 246 pictures, nine personas, 390 and 1366, Daylight and
Floodlit). Each visual finding now cites them by file; `…/` stands for that folder, and `…-1366-daylight.jpg`
after a full name is the same screen at the other width. **Every shot cited here exists at
390 and 1366 in both themes**: swap `-daylight` for `-floodlit` in the name. The exceptions
are the menu drawers (390 only, both themes), the onboarding flow (step one only) and the
signed-in spectator's big screen (not reached in either theme; NOTES.md "Not reached").
Every finding is about layout, order or words, not colour. For every screen cited, NOTES.md's
narrow audit gives the same counts in Floodlit as in Daylight, and the Floodlit shots opened
(the coach's, parent's and scorer's homes, the passport, the public home page) show the same
layout, the board black in both, and no defect of one theme alone. They
were reviewed by hand against the interface-review headings (layout, words, type, colour,
access), as that skill is not installed in this session.

---

## 1. Where things live

### 1.1 What is true today

| # | Finding | Evidence |
|---|---|---|
| A1 | The menu holds **34 destinations in eight groups**. The comment above it still says twenty-two. | `design/roles.js:281-297` (`NAV_GROUPS`), `:199-266` (`NAV_CAPABILITY`), comment `:269` |
| A2 | A school's staff see **17 to 22 menu entries** each (table in §1.7). The menu is the capability map drawn as a list: whatever a role may read becomes an entry. | `roles.js:361-377` (`navGrants`, `navForRoles`); counts by running it |
| A3 | On a phone the bar is the **first four entries in group order plus "More"**. For nearly every staff role that is Dashboard, Newsfeed, Match Centre, Calendar. Squad, To resolve and Alerts sit in the drawer. The director's drawer is a grid of 24 tiles under a row of six other sports marked "SOON". | `shell/MobileNav.jsx:88-89` (`nav.slice(0, 4)`), order from `roles.js:285`; `audit/experience-screens/coach-home-390-daylight.jpg`, `…/coach-home-390-floodlit.jpg` (the bar), `…/director-of-sport-menu-390-daylight.jpg` (the drawer) |
| A4 | The homes pattern gathers **three domains**, and two of them (Logistics, Fields) are the same area linking to each other. It has no home for a match day, a team or the school office. | `design/homes.js:30-60` |
| A5 | **Fourteen destinations are reached only from the menu** in a literal scan of the code: Analytics, Injuries, Calendar, To resolve, Officials, Sponsors, Modules, Newsfeed, Management, Rulebook, Pitch Deck, Selection, and nearly so Squad and Staff. No link was found from a match to its team or its ground. (The scan is literal; a link built another way would not show.) | `MAP.md` §3, checked against `App.jsx:570-607` |
| A6 | Only the Match Centre has an address. Every other screen is one piece of state, and a player's page is a shared variable set before the page changes, so a player, a team and a ground cannot be linked to, shared or returned to. | `App.jsx:168-173` (`page`), `:198` and `:572` (`profileTarget`), `:441` (the one route) |
| A7 | "To resolve" and "Officials" are offered to anyone who may read a fixture, so a **spectator's menu carries "To resolve"** and an umpires' register. His Today also carries the staff readiness chips ("Team sheet · nothing on record", "Transport · nothing on record") and a board of an unlisted U16A match with two boys named (allowed: a spectator of his own school reads names on the signed-in scorecard, `READERS_child_data.md:117`; the finding is the clutter, not a leak). | `roles.js:217`, `:222`; spectator's menu computed (11 entries); `audit/experience-screens/spectator-signed-in-home-390-daylight.jpg` |
| A8 | **A pupil who also scores loses the pupil's four-item app** and gets an 18-entry staff menu with Injuries, Skills, Training, Logistics and Fields. The persona rule needs every role a person holds to be on the persona's list. A parent who scores loses the family app the same way. Most scorers are expected to be under 18 (`ROLE_DASHBOARDS_v1.1` §2). | `roles.js:344-350` (`personaFor`); `player + selfaccess + scorer` computed |
| A9 | Settings is **1,564 lines and nine tabs for five different audiences**. It opens on "People" for everyone, and six tabs have no gate, so a parent who taps her own name lands on "Settings & Access Control", People. Her health-monitoring consent is on the third tab. | `views/SettingsView.jsx:64-77` (tabs), `:143` (opens on `users`), `:268` (filter), `:799`; `shell/PersonaBar.jsx:32` |
| A10 | Landing by capability already exists: a driver, a groundskeeper and a scorer each open on their own day screen, chosen by what they hold, with no role named. That is the precedent for everything below. | `App.jsx:556-569` |
| A11 | Staff and personas have two different headers. Staff reach Alerts, Safeguarding, Settings and the Rulebook from the menu's last group; a parent or pupil reaches Settings and "Raise a concern" from the header. | `roles.js:341` (`PERSONA_ASIDE`), `shell/PersonaBar.jsx:32-42`, `roles.js:296` |

The pattern in A2 and A5 is the scatter Kameel described: the menu answers "what may I
read?", when a person at a ground is asking "what about this match?" or "what about this boy?".

### 1.2 The pattern, extended

`homes.js` already says what a home is: a menu entry that gathers destinations which
already exist, decides nothing about who may see what, and draws a section only when the
reader reaches the destination it came from. That stays exactly as it is. Four additions,
all in the same file and the same shape, none of which names a role:

1. **More homes.** Five beside the three that exist (§1.3).
2. **A home under another** (`under`). Competitions sits under Matches and Fields under
   Logistics. A reader who reaches the parent finds the child as a link on the parent's bar
   (the `links` row `HomeBar` draws today) and on the things it belongs to. A reader who
   does not reach the parent keeps the child as a menu entry. This is what Logistics and
   Fields already do by hand, made a rule. *In plain words: a smaller home is reached from
   the bigger one it belongs to, and stays in the menu only for someone who cannot reach
   the bigger one.*
3. **The header, for everyone** (`aside`). `PERSONA_ASIDE` already puts Settings and
   "Raise a concern" in a parent's and a pupil's header. Staff get the same header: the
   bell, "Raise a concern" and their own name. Those three leave the menu. *In plain words: the same three things sit at the top of
   every screen for everyone, so nobody hunts for them in a menu.*
4. **Things** (`THINGS`): a match, a player, a team, a ground. Each is a page with an
   address, and a list of links in the shape `homes.js` uses now (`{ to, section, label,
   from }`), drawn by the same `HomeBar`, each offered only where the reader reaches its
   source. A thing is where "reached from the thing it belongs to" happens. *In plain words: a
   match, a boy, a team and a ground each get a page you can link to, and that page offers
   the screens about it that you are allowed to open.*

Two small rules follow. A home with one section the reader reaches is named in the menu
by that section (a union selector sees "Selection", not "Team"). And a home keeps the menu
key of a destination that existed (`dashboard`, `matches`, `squad`, `staff`, `pitchdeck`),
as `homes.js` requires, so `nav-<key>` still lands where it did.

The result is that **the menu is the list of homes a person reaches, never more than five
for anyone at a school**, so on a phone the bar holds all of it and the "More" drawer goes.

### 1.3 The homes

| Home (menu word) | Key it keeps | Sections, each from an existing destination | Links on its bar |
|---|---|---|---|
| **Today** | `dashboard` | Today (the day sheet) · To resolve (`readiness`) · News (`news`) | none |
| **Matches** | `matches` | Matches (`matches`) · Calendar (`calendar`) · Officials (`officials`) | Competitions · Rulebook |
| **Competitions** (exists) | `competitions` | Competitions · Leagues, as built. `under: matches` | none |
| **Team** | `squad` | Squad (`squad`) · Players (`profiles`) · Who's out (`injuries`) · Training (`training`) · Skills (`skills`) · Stats (`analytics`) · Selection (`selection`) | none |
| **Logistics** (exists) | `logistics` | Transport · Equipment · Grounds, as built | Fields & pitch profiles |
| **Fields** (exists) | `fields` | Fields & pitches, as built. `under: logistics` | Ground schedule |
| **School** | `staff` | People (`staff`, with Settings' People and Import tabs) · Access (`management`, with Settings' Roles tab) · Record (Settings' School tab) · Modules (`modules`) · Sponsors (`sponsors`) | none |
| **Platform** | `pitchdeck` | Support access · DLS table · What's built (Settings' Support, DLS and Roadmap tabs) · Pitch deck (`pitchdeck`) | none |

The parent's app (Home, Matches, Notices, Family) and the pupil's (Home, Matches, Passport,
Me) are decided and stay as they are: four items, no "More" (`roles.js:332-337`).

Notes on the choices:

- **Today is the day sheet** (`DESIGN_DIRECTION` §5), unchanged in order: Now, Today/next,
  Who is out, This week, Alerts. "To resolve" is its first block when anything applies, and
  the full list is its second section. The driver's, groundskeeper's and scorer's day
  screens stay the Today a holder of those capabilities lands on (A10).
- **Team has seven sections on paper and a coach sees six.** That is the most of any home.
  On a phone the section switch scrolls sideways in one row; it does not wrap to three.
  Splitting Training out as its own home was the alternative; it puts a director at six
  menu entries and a phone back on "More". Question Q21.
- **School** gathers what Settings held "because it had no better place" (§1.6) with the
  three office destinations. Everyone who reaches Access, Modules or Sponsors also reaches
  Staff (checked in `roles.js` reach), so keying the home on `staff` loses nobody.
- **Stats is a section, not a menu entry.** Stats-forward is about figures being on the
  day sheet, the match, the player and the team where a person is already looking, which is
  section 3's work. A menu word does not make an app stats-forward.

### 1.4 The four things, and what is reached from each

Each thing gets an address under `/app` (`/app/matches/:id` exists; a player, a team and a
ground gain one), so a notice, a search result and a "Needs you" row can all land on it.

| Thing | Its page today | Reached from it (each only where the reader reaches the source) |
|---|---|---|
| **A match** | `/app/matches/:id`, tabs Summary, Scorecard, Commentary, More (decision 9) | Its competition → Competitions, on that table. Its ground → the ground. Each side → the team. A player's name → the player. Readiness chips, a word and a state each: Team sheet → Team, Squad, for this fixture; Transport → Logistics, Transport, this trip; Officials → Matches, Officials, this fixture; Ground report → the ground. Playing conditions → the Rulebook at that clause. "Open scorer" for a scorer. The report, and filing a conduct matter, as now. |
| **A player** | Profiles opened on one boy (`App.jsx:572`) | His matches. His passport and honours. His figures and charts. His standing in Who's out (status only, by tier). His skills and assessment → Team, Skills, on him. His training load. For the office: his family links and consents (today under Squad, Edit Profile; `lib/guardianLink.js:2-3`). Where his record may travel (today Settings' Passport tab, `SettingsView.jsx:1062`). |
| **A team** | Squad opened on one side | Its fixtures and results → Matches, filtered. Its next team sheet. Its training week. Who's out. Its figures → Team, Stats. Its transport for the next fixture. |
| **A ground** | Fields opened on one ground | Its pitch profile and last report. Its schedule → Logistics, Grounds, filtered. The matches on it today. |

Nothing in this table is a new read. Each link opens a screen that exists, on the subject
it was opened from. What a link shows is decided where it always was, by the server.

### 1.5 Every destination, once

All 34 keys of `NAV_CAPABILITY`. "Sees" is how many of the 29 roles reach it today (from
running `roles.js`).

| # | Destination (group today) | Sees | Where it lives after | Why |
|---|---|---|---|---|
| 1 | `dashboard` Dashboard (Play) | 28 | **Menu: Today** | The one home. A day sheet, not a dashboard, and the word says so. |
| 2 | `news` Newsfeed (Play) | 25 | Today, section News | News is read where the day is read. Nobody navigates to it as a task. |
| 3 | `matches` Match Centre (Play) | 21 | **Menu: Matches** | The second thing everyone opens. |
| 4 | `calendar` Calendar (Play) | 21 | Matches, section Calendar | The same fixtures, by date. Same capability as Matches. |
| 5 | `competitions` Competitions (Play) | 14 | From a match (its competition line) and the Matches bar; a menu entry only for a reader with no Matches | A table is looked for from a match in it. |
| 6 | `leagues` Leagues (Play) | 14 | Inside Competitions, as built | Unchanged (`homes.js:31-38`). |
| 7 | `officials` Officials (Play) | 21 | Matches, section Officials; and from a match's Officials chip | Who is umpiring is a question about a match. The register is the same screen. |
| 8 | `squad` Squad (People) | 19 | **Menu: Team** | The team is the third thing. |
| 9 | `profiles` Profiles (People) | 17 | The player page, from any name; the list is Team, section Players | Nobody wants "profiles". They want this boy. |
| 10 | `selection` Selection (People) | 2 | Team, section Selection | A union selector's only section, so his menu says "Selection" (V2). |
| 11 | `injuries` Injuries (People) | 12 | Team, section Who's out; from Today's "Who is out" and from a player | The day sheet already asks the question (§5.3). |
| 12 | `staff` Staff (People) | 9 | **Menu: School**, section People | The adults are the office's work, not the team's. |
| 13 | `analytics` Analytics (Develop) | 5 | Team, section Stats; from a match, a player and a team | Figures belong beside what they describe. Section 3 says which. |
| 14 | `skills` Skills (Develop) | 5 | Team, section Skills; from a player | An assessment is about a boy. |
| 15 | `training` Training (Develop) | 8 | Team, section Training; from Today's "This week" | The week's sessions are on the day sheet already. |
| 16 | `logistics` Logistics (Operate) | 11 | **Menu: Logistics**, as built; from a match's Transport chip | Unchanged, and now reached from the match it serves. |
| 17 | `fields` Fields (Operate) | 11 | From a match's ground and the Logistics bar; a menu entry only for a reader with no Logistics (a groundskeeper, a principal) | A ground is looked for from a match on it. |
| 18 | `sponsors` Sponsors (Operate) | 5 | School, section Sponsors | Office work. No slot rule changes (§7.1 stands). |
| 19 | `readiness` To resolve (Operate) | 21 | Today: the "Needs you" block, and the section To resolve | What needs a person is the first thing on their home, not the eighteenth menu entry. |
| 20 | `management` Management (Administer) | 5 | School, section Access | Who may do what, beside the people it is about. |
| 21 | `modules` Modules (Administer) | 4 | School, section Modules | A school setting. Still never a module that can switch itself off. |
| 22 | `pitchdeck` Pitch Deck (Administer) | 2 | **Menu: Platform**, section Pitch deck | The platform's own home. |
| 23 | `children` Home (Family) | 1 | **Parent's bar**, unchanged | Decided (step 4). |
| 24 | `fixtures` Matches (Family) | 1 | Parent's bar, unchanged | Decided. |
| 25 | `notices` Notices (Family) | 1 | Parent's bar, unchanged | Decided. |
| 26 | `family` Family (Family) | 1 | Parent's bar, unchanged; gains the consents that sit in Settings today (§1.6) | Decided. |
| 27 | `myhome` Home (Yours) | persona | **Pupil's bar**, unchanged | Decided. |
| 28 | `mymatches` Matches (Yours) | persona | Pupil's bar, unchanged | Decided. |
| 29 | `passport` Passport (Yours) | persona | Pupil's bar, unchanged | Decided. |
| 30 | `me` Me (Yours) | persona | Pupil's bar, unchanged | Decided. |
| 31 | `notifications` Alerts (You) | 28 | The header's bell, on every screen; unread ones last on Today | The bell is already there (`shell/TopBar.jsx:66`). One place, one count. |
| 32 | `safeguarding` Safeguarding (You) | 28 | The header, on every screen; and the DSO card last on every Today and Home (`SAFEGUARDING_DSO.md` §2.5). A Safeguarding Officer lands on Today like everyone else; his inbox is one tap from the bell (Q7) | "You may raise a concern from any screen" is in the terms a parent agrees to (`lib/guardianLink.js`, Safeguarding). It must never be in a drawer. |
| 33 | `settings` Settings (You) | 28 | The header, under the person's own name, and only what is theirs (§1.6) | A person's settings are about that person. |
| 34 | `rulebook` Rulebook (You) | 28 | The Matches bar, and from a match's playing conditions; under the person's name for a reader with no Matches | Reference, found from the match it governs. |

None is lost. Six become menu words (Today, Matches, Team, Logistics, School, Platform),
eight stay the two persona bars, three move to the header, and seventeen become a section
of a home or a link from a thing, with their routes kept.

### 1.6 Settings, taken apart

`views/SettingsView.jsx`, by tab (`:64-77`). Each part moves whole; nothing is rewritten here.

| Part today (lines) | Who it is for | Where it goes |
|---|---|---|
| People: accounts, who has none, claims (`:368-571`, claims `:289-291`) | The office | School, People |
| Import, and the staff register (`:305`) | The office | School, People |
| Roles: what each role may do (`:597-688`) | Whoever grants roles | School, Access, as its reference |
| School: the record, names-off and listing switches, "who read what" (`:1179-1305`, audit `:1318`) | The office, the director, the principal | School, Record |
| Passport: where a boy's record may travel, scouting consent (`:990-1178`) | The office, for one boy; a family, for their child | The player page (office); Family, on the child's file (parent) |
| Me: appearance, ways to sign in, sign out everywhere, my access, boundaries, alert choices, my clearances (`:723-947`) | The person | The header, under their name. This is all that "Settings" is after |
| Me: health-monitoring consent, the eighteen card (`:745`, `:799`) | A parent, for a child; a pupil at eighteen | Family, on the child's file, beside the terms and the public-name switches that are already there; the pupil's Me |
| Roadmap (`:1516-1561`) | Kameel and the platform | Platform, What's built |
| Support access (`:306`) | Platform support | Platform |
| DLS table (`:307`) | Platform reference | Platform |

A parent then finds every consent for a child in one place, Family, per child. That is
also what the terms tell her ("Family shows his file").

### 1.7 Menus, before and after

"Before" is what the shell draws today (computed). "After" is the homes each persona
reaches. After, three more things are in the header on every screen for everyone: the
bell, "Raise a concern" and their own name. Before, those were menu entries and are in
the count.

| Persona (role) | Before | After |
|---|---|---|
| **Director of sport** | **22**: Dashboard, Newsfeed, Match Centre, Calendar, Competitions, Officials, Squad, Profiles, Injuries, Staff, Analytics, Skills, Training, Logistics, Fields, Sponsors, To resolve, Management, Alerts, Safeguarding, Settings, Rulebook | **5**: Today · Matches · Team · Logistics · School |
| **The office** (school admin) | **21**: as the director, less Analytics and Skills, plus Modules | **5**: Today · Matches · Team · Logistics · School |
| **Sports admin** | **18**: as the office, less Sponsors, Management and Modules | **5**: Today · Matches · Team · Logistics · School |
| **Coach** | **19**: Dashboard, Newsfeed, Match Centre, Calendar, Competitions, Officials, Squad, Profiles, Injuries, Analytics, Skills, Training, Logistics, Fields, To resolve, Alerts, Safeguarding, Settings, Rulebook | **4**: Today · Matches · Team · Logistics |
| **Team manager** | **17**: as the coach, less Analytics and Skills | **4**: Today · Matches · Team · Logistics |
| **Scorer** (adult, scorer only) | **12**: Dashboard, Newsfeed, Match Centre, Calendar, Officials, Squad, Profiles, To resolve, Alerts, Safeguarding, Settings, Rulebook | **3**: Today · Matches · Team |
| **Parent** | **4**: Home, Matches, Notices, Family | **4**: unchanged |
| **Pupil** | **4**: Home, Matches, Passport, Me | **4**: unchanged |
| **Pupil who is captain** | **4**: the pupil's; captaincy is an honour, not a role | **4**: unchanged; the captain's block is on his Home and on his side's match |
| **Pupil who scores** | **18**: a staff menu (A8) | **4**: the pupil's; scoring is a block on his Home and on the match he is appointed to (Q2) |
| **Spectator, signed in** | **11**: Dashboard, Newsfeed, Match Centre, Calendar, Competitions, Officials, To resolve, Alerts, Safeguarding, Settings, Rulebook | **2**: Today · Matches |
| **Spectator, signed out** | no menu: the home page, a match's live page and scorecard | no menu: the same, with "Log in" |
| **Platform admin** | **11**: Dashboard, Newsfeed, Competitions, Staff, Management, Modules, Pitch Deck, Alerts, Safeguarding, Settings, Rulebook | **4**: Today · Competitions · School · Platform |

On a phone, "before" is four of those entries and a drawer with the rest; "after" is the
whole menu on the bar.

### 1.8 The other roles, mapped

The 29 roles in `roles.js`, onto the personas above. Each gets the same shell; what
differs is which homes they reach.

| Role | Persona it follows | Before → after |
|---|---|---|
| `superadmin` | Platform admin. The one menu of six (Today, Matches, Team, Logistics, School, Platform); it is a recovery key, not a daily job | 25 → 6 |
| `principal` | Director of sport; reaches Fields but not Logistics, so Fields is his fourth entry | 20 → 5 |
| `assistantcoach` | Coach | 18 → 4 |
| `official` | Scorer | 11 → 3 |
| `analyst`, `scout`, `medical`, `media` | Coach, reading: Today, Matches, Team | 14, 11, 13, 12 → 3 |
| `fitness` | Coach, reading, with Fields | 15 → 4 |
| `competitionadmin` | Scorer's family (match control): Today, Matches, Team; Competitions is on the Matches bar | 12 → 3 |
| `transportcoordinator` | Team manager: Today, Matches, Team, Logistics | 12 → 4 |
| `driver` | Lands on the driver's day (`App.jsx:556`): Today, Logistics | 7 → 2 |
| `facilities` | Lands on the groundskeeper's day (`App.jsx:557`): Today, Matches, Fields | 11 → 3 |
| `finance`, `sponsorship` | The office: Today, School | 7, 8 → 2 |
| `dso` | The office: Today, Matches, Team, Logistics, School. Lands on Today; the bell's `safeguarding` notice opens his inbox in one tap (Q7) | 14 → 5 |
| `unionselector` | Today, Selection (V2) | 6 → 2 |
| `selfaccess` | Never alone: with `player` it is the pupil | n/a |
| `enquiry` | No home of its own (`ROLE_DASHBOARDS` §2): the one player it was granted, opened from the notice that granted it | 7 → the player page |

### 1.9 What Today leads with

A home changes with the state of the match day. The state is the fixture's own status and
its event stream (scheduled, toss taken, live, innings break, result pending, complete,
postponed or abandoned), as `ROLE_DASHBOARDS` §5 sets out. The date orders the list. It
never declares a match live.

| State (from fixture and events) | Staff Today leads with | Parent and pupil Home leads with |
|---|---|---|
| A fixture of mine is **live** | The `Board`, full width; "Open scorer" or "Match centre" | The `Board` of the child's match, in his section |
| **Innings break** | The `Board` with target and equation; the scorer's check | Target and equation |
| **Result pending** | "Confirm the result" for whoever may; provisional, marked | "Provisional" beside the score |
| **Complete, today** | The result; the report; Player of the Match to pick | His innings in words; the result |
| **Next fixture, not ready** | "Needs you": the chips that are not done, each with its owner and next action | What the parent or pupil must answer (availability, a lift) |
| **Next fixture, ready** | The next-fixture card, calm | His next match and the bus time |
| **Postponed or abandoned** | What changed and who has been told | What changed, first |
| **No fixtures yet** (a new school or season) | The set-up list (§2.7) | "Nothing scheduled yet" and the school's last result |

### 1.10 The two targets, persona by persona

Five seconds is counted from the first signed-in screen. Two steps are taps after that.
"Fails" is said where it fails.

| Persona | Sees what needs them in five seconds? | Most common task, and steps | Verdict |
|---|---|---|---|
| Director of sport | Yes, if "Needs you" is the first block of Today, across his teams | Clear a blocker: tap the row → the exact screen | **Passes only if each row lands on the fix**, not on a list. Today most rows open a whole destination (Squad, Logistics, Competitions, Management, Settings or Staff) rather than the fix; only a fixture's duties, side or result open on that fixture (`views/ReadinessOverview.jsx:235-251`, `:374`). With several teams, any task not in the queue costs a third step (pick the team). **Fails there.** |
| The office | Yes: waiting parents, claims and missing records are "Needs you" rows | Verify a parent's link: row → the pupil's family links → Verify | **Fails by one step** when the claim names a child in free text and the office must find the pupil first. That step is the safeguard (SCRBRD-140 D5) and should stay. |
| Coach | Yes, once the next fixture's chips lead. **Today they do not:** on a phone the next fixture is the fourth card, about 1,480px down, under the cockpit's "Match day" and "Recent matches", and the same fixture is on the screen twice (`audit/experience-screens/coach-home-390-daylight.jpg`, `…/coach-home-390-floodlit.jpg`, `…/coach-home-1366-daylight.jpg`) | Pick the XI: Team sheet chip → the sheet (1). Plan training: Team → Training (2) | Passes on steps; **fails five seconds on a phone today** (Slice 5) |
| Team manager | Yes: transport and answers outstanding | Check the bus: Transport chip → the trip (1) | Passes |
| Scorer | Yes when the match is on this phone: "Now" is what this phone is scoring (`views/ScorerHomeView.jsx:285`). **Not when his side's fixture is live and not yet on this phone:** "Now" says "Nothing on this phone to resume" and the two live fixtures are the third section, about 870px down, each saying only "Live" (`audit/experience-screens/scorer-home-390-daylight.jpg`, `…/scorer-home-1366-daylight.jpg`) | Resume: one tap (`:326`). Start a new match: "Start a match" is one tap, then six set-up screens before the first ball, two of them lists of names (§2.5 step 4) | Resume passes. **Starting a match fails two steps** while the names step stands (Q5; *Q5 was answered yes, as recommended, on 13 Nov: see Slice 1*). Five seconds **fails for a live fixture not on this phone** (Slice 1) |
| Parent | Yes: the action list is near the top of the child's section (second, after the next fixture). **While his match is live, the live card is fourth**, about 1,050px down on a phone, a figure with no sentence (`audit/experience-screens/parent-home-390-daylight.jpg`, `…/parent-home-1366-daylight.jpg`) | Answer availability, in place (1). See his score: the `Board` → the match (1) | Passes on steps. **Fails five seconds while his match is live** (Slice 4). With children at two schools it is two sections and a scroll, by decision (§6); the second child may be below the fold. |
| Pupil | Yes | Answer availability (1). Open his Passport (1) | Passes |
| Captain | Yes, when the captain's block is first on Home on a match day | Pick Player of the Match: card → choose (2) | Passes, subject to SCRBRD-138's rules, not reopened |
| Spectator, signed out | **Fails on the home page today** on a phone: the page opens on the film and the live strip follows it (`home/main.jsx`, `Hero` then `LiveStrip`). With one match live, the first 2,400px are the film and the hero's buttons; the only signs of it are a "1 live" pill in the header and a "Follow a match" button in the hero, with no score (`audit/experience-screens/spectator-signed-out-public-home-390-daylight.jpg`, `…-1366-daylight.jpg`). From a shared link it passes outright: the sentence "Westville Boys' High 1XI need 74 runs off 33 balls" is above the board (`…/spectator-signed-out-live-match-summary-390-daylight.jpg`) | Watch a live match: one tap from the home page; none from a link | Passes on steps; five seconds depends on Q6 |
| Spectator, signed in | Yes, if a followed school's live match leads Today | Open it: one tap | Passes if following exists (Q8); "Follow this match" is not built (`MAP.md` §7f) |
| Platform admin | Yes: incidents first | Open a school's incident: row → the school (2) | Passes |
| Anyone, opening the app cold | **Fails.** A reload drops the session by design, so every cold open is the sign-in screen first (`auth/NoSchool.jsx:321-329`; `App.jsx:396-401`) | n/a | Stated plainly; Q25 |

---

## 2. First run, per role

### 2.1 What is true today

| # | Finding | Evidence |
|---|---|---|
| B1 | There are **two sign-up doors that ask different questions**. "Create an account" opens the older flow, which offers ten role tiles and posts a request. "Continue with Google" opens the newer no-school screen, which offers four kinds of person. | `auth/LoginPage.jsx:327-329` → `App.jsx:280`, `:505-512` → `auth/OnboardingFlow.jsx:96-107`, `:168`; Google → `App.jsx:230-232`, `:495-503` → `auth/NoSchool.jsx:179-203`, `lib/joinSchool.js:40-44` |
| B2 | The older flow shows **nothing real before it asks for a role**. Step one is a line of welcome that promises to "tailor the platform to your role"; step two is the role grid; there are up to six steps. It ends on "You're all set" and a button reading "Enter SCRBRD", which on a live server sends a request and returns the person to sign-in. | `OnboardingFlow.jsx:217-226`, `:228`, `:122-127`, `:361-389`, `:412`, `:161-172`; `App.jsx:283`; `audit/experience-screens/new-account-onboard-1-step-390-daylight.png`, `…-1366-daylight.png` (step one's words, as NOTES.md records them) |
| B3 | Its last step **promises screens the person will not have**: a parent is told about Match Centre and Logistics, a pupil about Analytics, Training and Injuries. Their apps are Home, Matches, Notices, Family and Home, Matches, Passport, Me. | `OnboardingFlow.jsx:187-195`; `roles.js:332-337` |
| B4 | It draws from the 1.0 alias names `D.indigo` and `D.violet`, which now point at `T.brand.blue` and `T.sport.fielding`. No off-palette colour, but it is the old look: a blue-to-violet progress bar and a glass panel. The sign-in page sets its fonts by name, not by type role. | `OnboardingFlow.jsx:207`, `:236-241`; `design/tokens.js:642-643`; `LoginPage.jsx:220-221` |
| B5 | The sign-in page greets everyone with "Welcome back" and shows nothing of the product. | `LoginPage.jsx:220`; `audit/experience-screens/new-account-landing-or-login-390-daylight.jpg`, `…-1366-daylight.jpg`, `…-390-floodlit.jpg`, `…-1366-floodlit.jpg` (NOTES.md: 4 taps under 44px and 2 weak contrasts in each theme) |
| B6 | The no-school screen has the right rules (it assigns nothing, looks no child up, says the same sentence whoever the child is) and the staff register lets a listed member of staff straight in. But it **asks for a school and who you are before showing anything**, and a school that is not listed is a dead end. On this deployment its last card, "Worried about a child?", is a dead end too: "The Guardian's app link has not been set on this platform yet", with no other way to reach a DSO. | `NoSchool.jsx:13-32`, `:77-83`, `:99-108`, `:179-203`, `:213-216`, `:186`, `:194`; `audit/experience-screens/new-account-no-school-390-daylight.png`, `…-1366-daylight.png` |
| B7 | **A new account cannot bowl a ball.** The scorer's home is drawn only for an account that already holds the right to start scoring; the no-school screen has no door to the pad; a Pilot Match is offered only to an account SCRBRD has granted, and a Practice Match can never become one. | `App.jsx:564-565`; `NoSchool.jsx` (no pad entry); `lib/scorerDay.js:296-318`; `lib/pilot.js:28-34` |
| B8 | The pad can already send a scorer to sign in and bring him back with nothing lost. | `App.jsx:526`; `LoginPage.jsx:222` |
| B9 | A parent's link is verified by the office, and the terms she agrees to exist as approved text with a version. But **nobody tells her the office has answered**: SCRBRD sends no email. She finds out by signing in again. | `lib/guardianLink.js:1-21`, `:35`; `LoginPage.jsx:113-115` |
| B10 | The public home page opens on a film. The live strip follows it, and "Follow a match" is offered only when a strip exists. A school that wants in is given an email address. | `home/main.jsx:140-142` (`Hero`, then `LiveStrip`); `home/sections/Hero.jsx:100-101`; `home/sections/Schools.jsx:18-21`; `audit/experience-screens/spectator-signed-out-public-home-390-daylight.jpg`, `…-1366-daylight.jpg` (one match live; the film fills the first 2,400px) |
| B11 | SCRBRD-140's status line says nothing is built. Phases 1 and 2 are (Google sign-in, the no-school account, claims, the staff register). Phase 3 is not (Microsoft, email link, the pupil register). This section designs on that basis. | `docs/design/SCRBRD-140_signup_and_school_linking.md:3`; `MAP.md` §5 |

### 2.2 The rule: give, then ask, one thing at a time

Every first run below follows the same ladder. A rung is climbed only when the person
wants what is on the next one.

| Rung | What is asked | What it gives | Where the rule comes from |
|---|---|---|---|
| 0 | Nothing | A live match, a scorecard, the home page | `PUBLIC_DATA.md` §1; the public pages |
| 1 | A Google sign-in, or a code from the school office | An account that can see only itself; a match to score on this phone | SCRBRD-140 §3, §4 |
| 2 | Which school, and which of four kinds of person | For staff on the register: the school, at once. For everyone else: a request | SCRBRD-140 §5 |
| 3 | For a parent only: the child's name, relationship and year, as free text | "Sent to the school." The same sentence whoever the child is | SCRBRD-140 D5 |
| 4 | Nothing: the office decides | The link, verified by a named person | SCRBRD-140 D9 |
| 5 | For a parent: read and agree to the school's terms, per child | The child's section of Home | `lib/guardianLink.js` (`popia-2026-01`) |
| 6 | Each further consent at the moment it matters, never at sign-up: the public-name switches on the agreement screen, health monitoring only if the school runs it, a lift when one is offered, phone notices when the first one is ready | That one thing | `PUBLIC_BY_TERMS.md` §4.2; SCRBRD-110; SCRBRD-124 |

Three things follow for the screens:

- **One door.** Sign-in is "Continue with Google" or "I have a code". The older role-tile
  flow is retired from the live site (Q13). Nobody is ever asked "what's your role?".
- **The no-school screen becomes a home.** It is the Today of an account with no school,
  in the day sheet's order: *Now* (a match this phone is scoring, if any), *Followed
  schools* (first when one of them is live, otherwise after *Now*; Q8), *Start a match*, *Join a school*, *Your requests*, and "Worried about a child?"
  last, as it is now.
  The join form and its rules are kept word for word.
- **No tour.** The first screen after each rung is the real one. A section that is empty
  says in one line what will appear there.

No sponsor slot is drawn on the sign-in screen, the no-school home or any agreement
screen: these are "other dashboards", which are `none` until a rule is agreed (§7.1).

### 2.3 The public home page

The page keeps its film, its promise to families and its line to schools. Its first screen
changes with what the public read (`/api/public/live`, which it already makes) says:

| State (from the public read) | The first screen |
|---|---|
| A listed fixture is **live** | The `Board` of that match, black, with its status sentence and "Watch": **team rows only** (the score, the overs, the sentence), no batter or bowler row, because the read it comes from names no boy (`db/82_public_listing.sql:132-137`). Never fed from the match's public log. The film plays under it (Q6) |
| Fixtures listed **today**, none live | "Today" and the first start, then the film |
| A listed fixture **finished today** | The result, then the film |
| Nothing listed, or public pages off | The film, as now |

Below it, three doors in place of one "Log in", each saying what it gives: **Watch a
match** (the strip), **Score a match** (rung 1, then the pad), **My child plays** (rung 1,
then the join form on "parent"). "Log in" stays in the header for people who have an
account. The page still names no child, shows team-level facts only, and links to match
pages with `nofollow` (`PUBLIC_DATA.md` rule 7).

### 2.4 Spectator

**Signed out.**

| Step | Sees | Asked | Why then | Gets before the next ask |
|---|---|---|---|---|
| 1 | A link from a parents' group opens `/live/:id`: the `Board`, the over, the commentary. Or the home page's live `Board` | Nothing | A score is public once the school publishes it | The whole match: Summary, Scorecard, Commentary. Names by the public rule only; a Pilot Match shows the score and team names and no player |
| 2 | At a pause (innings break, the result): "Follow Northfield's matches" | Nothing yet. It is an offer, never a wall | The moment he might want more | He can ignore it for ever |
| 3 | He taps Follow | A Google sign-in, with the privacy paragraph on the same screen | Following has to be kept against someone | His Today: the followed school's live match first, then today's, then results (Q8) |

**Signed in, following a school.** He opens the app and lands on Today, which leads with
the `Board` if a followed match is live (§1.9). His menu is Today and Matches. He is
never asked for a "role". If he later wants the signed-in view a school gives its own
community, that is the existing `spectator` request, and the office decides it.

### 2.5 Scorer

| Step | Sees | Asked | Why then | Gets before the next ask |
|---|---|---|---|---|
| 1 | Home page: "Score a match" | Nothing | | The door |
| 2 | Sign-in | Google, or a code | A match sent to SCRBRD has to belong to an account | An account, and the no-school home |
| 3 | The no-school home, "Start a match" first | Nothing | | The pad's own set-up, opened at its first step, as the scorer's home opens it today (`views/ScorerHomeView.jsx:323-326`) |
| 4 | Set-up, **as it stands**: six screens. Where the match goes, the overs, the two schools and age group, each squad's names ("2 to 15 names"), the toss, the openers and opening bowler (`lib/scorerDay.js:305`, "both sides and their players typed in"; `audit/experience-screens/scorer-pilot-1-setup-390-daylight.png` to `…/scorer-pilot-6-pad-first-ball-390-daylight.png`, the names step `…/scorer-pilot-3-players-390-daylight.png`) | Two squads of names, the toss, the openers | What the pad records needs them today. Scoring on positions alone ("Home No. 3", words the pad already has, `lib/pilot.js:36-38`) changes what the pad records, so it is a question for Kameel (Q5), not a design here | The pad |
| 5 | **The first ball** | Nothing | | A real `Board` that moves; the match on his home under "Now"; for a Pilot Match, a live link to share |
| 6 | At the result (never during play, §1a) | "Scoring for a school? Join it" | He has seen what it is | The join form; staff on the register are in at once, others send a request |

Whether step 3 offers a **Pilot Match** (sent to SCRBRD) or a **Practice Match** (this
phone only) to an account with no school is Q3. Today it can offer neither (B7). Whether
names may be skipped is Q5, answered yes (as recommended) on 13 Nov, so a Practice or Pilot Match may start on positions; the names step stays for anyone who wants it. The words the walks
assert stay as they are: "Start Pilot Match", "Start Practice Match", "stays on this
phone", "Resume scoring".

A scorer the school **appoints** goes straight to his real home: Today, with "Appointed
to score" on the fixture and what is missing before the toss (`lib/scorerHome.js`). A
**pupil who scores** gets the same block inside his own Home (Q2).

### 2.6 Parent

| Step | Sees | Asked | Why then | Gets before the next ask |
|---|---|---|---|---|
| 1 | The school's letter or a group message links to the home page or a live match | Nothing | | The score, as any spectator |
| 2 | "My child plays" | Google, or a code from the office | The school needs to know who is asking | The no-school home, opened on Join |
| 3 | Join: the school (filled in when there is only one), "I am a parent or guardian" | The child's name, her relationship, his year: free text, no lookup, no "found" | The office does the matching; a lookup would list every child at the school (SCRBRD-140 §5.3) | "Sent to the school. Somebody there will answer." Her request, with its state |
| 4 | **Waiting.** Her home shows the request, what happens next in one line, and the school's published matches as a spectator sees them | Optionally: "Tell me when the school answers" (a phone notice with no child's name) | The wait is the weak point of this run (Q15) | **The terms, to read now**, marked "You will be asked to agree once the school has checked your link" (Q15). Health monitoring is said to be separate and off, as now (`NoSchool.jsx:259-260`) |
| 5 | The office's side: a "Needs you" row on its Today, "A parent is waiting", opens the claim; the office picks the pupil and verifies against the school's records, by name (`lib/guardianLink.js`, `confirmWords`) | n/a | The decision is a person's, kept against that person | n/a |
| 6 | Her next open: Home has one card, first: "Read and agree to the school's terms for T Bekker" | To read the terms and agree, for this child at this school. When `PUBLIC_BY_TERMS` ships, the public notice and its switches sit above the button, and she can agree with every switch off | Nothing of his is hers to read until she agrees | "Agreed · 13 Nov 2026, 16:02 · popia-2026-01", and **his section of Home**: his next match and bus time, his last innings in words |
| 7 | Over the following days, in his section's action list, one at a time | Availability for Saturday. Later, only if the school runs it, health monitoring. Later, a lift | Each is asked when it is needed, by the thing that needs it | Each answer shows its time and version |

A second child is a second request and a second agreement. Two children at two schools
are two sections that never merge (`DESIGN_DIRECTION` §6). A link that is pending or has
ended is said plainly in its section, in the words `lib/familyLinks.js` already has. A
parent **the office enrolled** (a code on a letter) starts at step 6.

### 2.7 Staff: coach, team manager, the office, director of sport

**A coach or team manager whose school is on SCRBRD.**

| Step | Sees | Asked | Why then | Gets before the next ask |
|---|---|---|---|---|
| 1 | Sign-in | Google | | The no-school home |
| 2 | Join: "I work at the school" | The school | | The staff register is checked against the address Google verified. If the office listed him: "You are on Northfield's staff list" and **Open the school** (`NoSchool.jsx:213-216`). If not, the form asks which job and sends a request; a refusal reads exactly as if nobody were listed |
| 3 | **Today**, in the state his next fixture is in (§1.9) | Nothing | | His next fixture's card and its chips, or the live `Board` |

**The office and the director, setting a school up.** A school is added by the platform
(Q22), and its first office account is enrolled with a code. Its first Today is in the
state "no fixtures yet" and leads with a set-up list. Each line is a row with an owner and
one action, in the shape of every "Needs you" row, and each goes when it is true:

| Line | Opens | Gone when |
|---|---|---|
| List your staff | School, People: the staff register (`views/staffRegister.jsx`) | A row exists |
| Bring in your pupils | School, People: Import | Pupils exist |
| Make your teams | Team | A side has a squad |
| Add your first fixture | Matches | A fixture exists |
| Parents waiting | The claims | None waits |
| Decide what is public | School, Record: the listing and names-off switches | The office has chosen, either way |

This is **enrolment**: staff by the register, pupils by import and the office's code
(under thirteen always by code, SCRBRD-140 §7.2), parents by claim and verification.
Nothing in the list is new machinery. It is where the existing screens are found.

**A school not on SCRBRD.** Today the search says no school's name has those letters
(`NoSchool.jsx:194`). After: "Ask SCRBRD to add my school", and meanwhile "Start a match" (Q22).

### 2.8 Pupil, and a pupil who is captain

| Step | Sees | Asked | Why then | Gets before the next ask |
|---|---|---|---|---|
| 1 | The office gives him a code, or tells him he may use Google once it has confirmed him and his parent has agreed (SCRBRD-140 D6) | The code, or Google | A child's account is the school's and a parent's decision | **His Home**: his next match, and what he must answer |
| 2 | Home, first open | His availability for the next match, answered in place | It is the one thing the side needs from him | His Passport: caps, honours, figures |

A pupil who tries the front door alone is told kindly to ask the office, as now
(`NoSchool.jsx:266-271`), and is offered a match to watch. Nothing is asked of him. No
sponsor slot is drawn on his Home (§7.1).

**Captain.** There is no first run. The honour is recorded by the school; on his next
open, Home carries the captain's block on a match day and Player of the Match after one.
What he may see is SCRBRD-138's, not reopened here.

### 2.9 Platform admin

Assigned, never requested (`OnboardingFlow.jsx:86-87`). He signs in with a code or Google
and lands on Today: incidents and schools needing something, first. His first-day list is
"Add a school", "Enrol its first office account" and "Answer a school that asked to join".

### 2.10 The first run against the two targets

| Persona | Something real before the first ask? | Asks before their own home | Where it fails |
|---|---|---|---|
| Spectator, signed out | Yes: the match | 0 | Five seconds on the home page depends on Q6 |
| Spectator, following | Yes | 1 (Google) | Needs Q8 |
| Scorer | The door, then the first ball | 1 (Google), then the six set-up screens of §2.5 step 4, two squads of names among them | **Fails today** (B7); needs Q3. With names, the first ball is about seven taps and two lists of names from "Start a match", not two steps (Q5; *Q5 was answered yes, as recommended, on 13 Nov: see Slice 1*) |
| Parent | The score, yes. Her child, no: **a wait of a school day or more** sits between asking and seeing | 3 (Google; the child, in free text; the terms) | The wait cannot be designed away. It is the register check. Q15 softens it |
| Coach, team manager on the register | Yes | 2 (Google, the school) | A coach not on the register waits, as a parent does |
| The office, director | Yes, once the platform has added the school | 1 | A school not yet on SCRBRD waits on a person (Q22) |
| Pupil | Yes | 1 (a code) | None, once the office has enrolled him |
| Platform admin | Yes | 1 | None |

---

## Questions from sections 1 and 2

Merged into section 5 and renumbered by importance; §5 gives the old numbers beside the new.

---

## 3. Stats and moments

Figures first, as `DESIGN_DIRECTION` §1 says, carried to every place a person already looks.
Fun lives on the scoreboard and spectator side only (§1a). Every figure below names the read
it comes from; where none gives it, the row says which derivation it needs and from which
stored data. Nothing here ranks a pupil in public, keeps a streak or counts down at a child.

### 3.1 What is true today

| # | Finding | Evidence |
|---|---|---|
| C1 | The **status sentence** ("Westville 1XI need 45 runs off 34 balls") is built and shared by the match list, the match header and the public page. It is **not** on the day sheet's next fixture or week, the scorer's home, the parent's live card or the public home strip. The strip shows figures and, once finished, the result. | `lib/matchCentre.js:435`; callers `views/MatchCentreView.jsx:266`, `views/matchcentre/MatchView.jsx:440`, `public/PublicMatch.jsx:277`; none in `views/DashboardView.jsx`, `views/ScorerHomeView.jsx`, `views/family/cards.jsx:77-92`; `home/sections/LiveStrip.jsx:82-124`. Seen: the sentence above the board on the public page (`audit/experience-screens/spectator-signed-out-live-match-summary-390-daylight.jpg`, `…-1366-daylight.jpg`); the parent's live card is "4.3 · 43/2" and nothing else (`…/parent-home-390-daylight.jpg`, `…-1366-daylight.jpg`); the scorer's live fixtures say only "Live" (`…/scorer-home-390-daylight.jpg`) |
| C2 | The **insight line** (Tier 2) is built and drawn on the Match Centre's Summary, the public page (same `SummaryTab`), the day sheet's Now and the ground display. Its lines are plain strings and some name a boy ("T Bekker needs 4 for fifty"). | `scorer/signals.js:151-188`; `views/matchcentre/tabs-core.jsx:219,232`; `views/DashboardView.jsx:387`; `display/DisplayView.jsx:153,204`; seen with its pause button on the coach's Now and the public Summary, and on the display (`audit/experience-screens/coach-home-390-daylight.jpg`, `…/coach-home-390-floodlit.jpg`, `…/spectator-signed-out-live-match-summary-390-daylight.jpg`, `…/spectator-signed-out-big-screen-display-1366-daylight.png`) |
| C3 | **A child's rates are shown with no floor and no denominator** on his passport's board (AVG, SR, ECON) and on his parent's season card ("average 41"), while Compare refuses a rate under thirty legal balls. Neither screen has a source line. | `views/family/pupil.jsx:203`; `views/family/cards.jsx:141-145`; `lib/compare.js` header (D4); `packages/scoring/src/placement.mjs:531-538` (`evidenceLabel`); `sourceLine` count 0 in both files. The seeded pupil has no runs, so his board reads "AVG — SR — ECON —" (`audit/experience-screens/pupil-passport-390-daylight.png`, `…-1366-daylight.png`); the shots do not exercise a rate from a few balls, which a fixture in Slice 4 must |
| C4 | Two sizes of **moment** are built (a four, six or wicket for 1.2 s; a milestone or the result for 1.5 s). SCRBRD-133's decided catalogue has nineteen, with times of 2.5 s to 6 s, and its `lib/moments.js` is not built. That catalogue was decided on 2 Oct (D1–D16), after `DESIGN_DIRECTION` §3.6 (26 Sep), and its cards never cover the total, so the built times are **a gap against a decision**, not a question: Slice 2 builds to it. The **over story** exists only on the ground display. | `views/matchcentre/live.js:14-22`; `docs/design/SCRBRD-133_immersive_match_centre.md` §5.2 (D1–D16 decided); `display/panels.jsx:260` (`OverStory`) |
| C5 | The board has no **free-hit** or **hat-trick-ball** tag for spectators, though the fold and the facts carry both. | `ui/board.jsx:281` (props); `packages/scoring/src/facts.mjs:104-109`; SCRBRD-133 §5.2 rows 7, 9 |
| C6 | **No match page can be shared.** The only share action in the app is on News. | `grep navigator.share` → `views/NewsView.jsx` only |
| C7 | **Following** is not built, and the notifications model has a closed list of kinds and four audience shapes, none of them "people who follow a school". | `docs/design/NOTIFICATIONS.md` D1, D7; SCRBRD-100 (backlog :4979) |
| C8 | **A team's figures live in three places**: its records under Leagues, its season under Analytics, its squad under Squad. A pupil finds his side's records on his Matches. | `views/LeagueView.jsx:550`; `views/sideseason.jsx`, `views/AnalyticsView.jsx`; `views/family/pupil.jsx:120` |
| C9 | The **record boards** already say their coverage, their minimum and what awaits the scorer's seal. Personal bests already mark "awaiting verification". | `views/records.jsx:101-117`; `lib/bests.js` header |
| C10 | From a chart to its balls is built (CRI-2.3). From a **scorecard figure** to its balls is not: the commentary filters by kind (All, Wickets, Fours, Sixes), never by batter or bowler. | `views/matchcentre/commentaryTools.jsx` (`CHIPS`); `CRICINFO_GAP_PLAN.md` §6 CRI-2.3 merged #306 |
| C11 | Season rankings (top scorers, an MVP order) exist and are **staff only**; a pupil's record board carries no ordered list. | `lib/seasonAwards.js:248` (`showsRankings`); `views/LeagueView.jsx:488-522`; `read-api.mjs:2327-2337` (`reader_view`) |
| C12 | `ROLE_DASHBOARDS` §3D proposes, for R3, a scorer profile "with points, streak badges and partner rewards". Most scorers are expected to be under 18. | `ROLE_DASHBOARDS_v1.1.md:128`, `:64` |
| C13 | **The coach's day sheet is out of its order.** Two cockpit cards ("Match day", "Recent matches") come before the next fixture, so the next fixture is the fourth card and appears twice. "Recent matches" gives a whole card to "No result · No innings on the log" and "from 0 of 2 scorecards". | `views/DashboardView.jsx:411` (`matchDay` slot); `DESIGN_DIRECTION` §5; `audit/experience-screens/coach-home-390-daylight.jpg`, `…/coach-home-390-floodlit.jpg`, `…/coach-home-1366-daylight.jpg` |
| C14 | **On the public Summary the Scenarios stepper is second**, a screen tall, before the worm, the latest balls and the highlights; "Corrected 22:51" is said twice in the header. | `views/matchcentre/tabs-core.jsx:255-277` (Scenarios, then Worm, then Latest); `audit/experience-screens/spectator-signed-out-live-match-summary-390-daylight.jpg`, `…-1366-daylight.jpg` |
| C15 | **The passport's tab row clips its fifth tab** ("C…" for Compare) at 390 with no cue that it scrolls. | `views/family/pupil.jsx:163`; `audit/experience-screens/pupil-passport-390-daylight.png` |
| C16 | **The parent's availability box says "No answer yet" with a button reading "Change"**, while the to-do list below says "Answer" for the same thing. | `views/family/cards.jsx:66` (`self ? "Change or answer" : "Change"`); `audit/experience-screens/parent-home-390-daylight.jpg`, `…-1366-daylight.jpg` |
| C17 | **A signed-in spectator has no big screen.** The Match Centre offers it only to the host's non-pupil staff (decided 12 Nov, PUBLIC_BY_TERMS (a)), and the public display `/display/:id` is linked only from the staff's Publication section. The display itself reads well from the boundary. | `views/matchcentre/MatchView.jsx:477-481`, `:554-559`; `views/publication.jsx:6`; NOTES.md "Not reached" (4 shots); `audit/experience-screens/spectator-signed-out-big-screen-display-1366-daylight.png`, `…-390-daylight.png` |

### 3.2 Who may see what, in short

Each table's "Who" column uses these words. They restate the rules; they decide nothing.

| Word | Means | Rule |
|---|---|---|
| **Public** | Signed out. Team-level facts; a child named only by `publicName()` (initial and surname, with consent or by terms on a finished card, never while play is on without his own yes) | `PUBLIC_DATA.md` L1–L7, A1–A8, D1–D4; `PUBLIC_BY_TERMS.md` §1.1–1.2 |
| **School** | A signed-in reader the server lets read the fixture or side | the read's own gate |
| **Family** | The child himself and his verified guardians, about him only | `REACH_FAMILY_OR_STAFF` (`read-api.mjs:109-112`; used by `personal_bests`, `:2317-2324`) |
| **Staff** | Staff of his side who are not pupils | the same reads' staff branch |

Never on any surface below: N1–N5, a page per player, a leaderboard of children, a figure
across matches in public, a photograph (`PUBLIC_DATA` §3, A3, A4, A8; `PUBLIC_BY_TERMS` §1.2).

### 3.3 The match page (Match Centre and public page)

| Gains | Read | Today | Who | Denominator and coverage |
|---|---|---|---|---|
| The status sentence under the board on every tab, not only the header | `statusSentence()`, `lib/matchCentre.js:435`, over `/api/matches/:id/events` (`server.mjs:636`) or the public log | exists; placement only | Public and school | none needed: it is a fact |
| **Free hit** and **Hat-trick ball** tags beside the over's chips, until the next counted ball | the fold's `inn.freeHit`; `MOMENT_KIND.HAT_TRICK_BALL` (`facts.mjs:108`) | derivation: none, a new `Board` prop the pad never passes | Public and school | none |
| The **over story** on Summary: one row per over, bowler, chips, runs, wickets, score after it; tap opens that over's lines | `OverStory` (`display/panels.jsx:260`), lifted as SCRBRD-133 §6 says | exists on the display; lift | Public (bowler by the name rule) and school | its own: "12 of 20 overs" |
| **From a figure to its balls.** Tap a batter's runs or balls → the commentary of only his balls; a bowler's figures → only his; a stand on Partnerships → only its balls | the commentary lines over the log; the key scheme `lib/toBall.js` and `dismissalKey()` already use | derivation: filter the generator's lines by striker or bowler id, client side, from stored events | **School only.** Public keeps kind filters: a per-boy view of his balls is a per-player page in all but name (A4, L7) | "25 balls, 3 shown as dots off the bat" style count above the list, from the same lines |
| The **innings-break card** promoted to the first thing on Summary while the break lasts | `inningsBreak()`, `lib/matchCentre.js:319`; `InningsBreakCard`, `tabs-core.jsx:41` | exists | Public (names by the live rule) and school | strike rate only from ten balls, as built (`:327`) |
| Par estimate, rate track, worm, Manhattan, partnerships, each with its source line | `/api/matches/:id/par` (`server.mjs:1010`); `chartSeries.js`; `sourcedLazy.jsx` | exists (CRI-1.8, CRI-2.2, CRI-2.5) | Public three charts, school all | exists: "From 214 balls"; shots "captured for N of M balls" |
| A **share** action: the page's own link, with a preview that names no child | `navigator.share`, falling back to copying the link | derivation: none; the page's preview text is team-level (`statusSentence()` and team names); the link's own preview already names nobody (`public-api.mjs:406-409`, asserted at `public.test.mjs:571`) | Anyone who has the page | none |
| Player of the Match, once given, on the result board | `GET /api/matches/:id/player-of-match` (`server.mjs:795`) | exists | Public by the finished-card rule; school | none |

### 3.4 The passport (the pupil's, the parent's child file, the staff player page)

| Gains | Read | Today | Who | Denominator and coverage |
|---|---|---|---|---|
| **Every rate with its denominator and the floor.** Average, strike rate and economy drawn only from thirty legal balls (faced, or bowled); below that the count and the word ("8 balls: a guide, not a figure") | `career` (`read-api.mjs:3208`, `balls_faced`, `balls_bowled`, `UNRECORDED_*`); `evidenceLabel()` | derivation: none, a rule moved from Compare to every child's rate (Q12) | Family, staff | "From 14 innings, 212 balls" |
| A **source line** on the board: how many innings were scored ball by ball and how many came from a scorebook. **Batting only** from a read that exists; bowling has only per-season rows (`player_bowling_by_season`, `read-api.mjs:3339`) | `innings_by_season` (`read-api.mjs:3435-3463`, `source`; batting: runs, balls faced, out) | batting: count by `source`. Bowling: a derivation per innings from each match's event log, client side, as §3.3's filter does, or the line says "batting" | Family, staff | "2 of 14 innings from a scorebook; their balls were not recorded" |
| **Tap a batting figure → the innings behind it → that innings's balls.** Wickets and economy open his seasons only, until the bowling derivation exists | `innings_by_season` (`match_id`, `innings`); the match page's batter filter (§3.3); the match address exists (`/app/matches/:id`), so this does not wait for Slice 5 | batting: none beyond §3.3. Bowling: as the row above | Family, staff; a team-mate's never (REACH-D2) | each step says its count |
| Personal bests, milestones, honours, each with its seal or "awaiting verification" | `personal_bests` (`:2317`), `recognition` (`:2295`) | exists | Family, staff. A pupil reads his own; a parent her child's | the seal is the coverage |
| Form, last innings first, each a link to its match | `career.form`, `innings_by_season` | exists as text (`pupil.jsx:233-237`); links are the derivation | Family, staff | the count of innings shown |

### 3.5 The team (one page, from any side's name; §1.4)

| Gains | Read | Today | Who | Denominator and coverage |
|---|---|---|---|---|
| Results, newest first, each its status sentence; form as W, L, T, D, NR | `matches` (`read-api.mjs:230`), `resultText()` | exists; gathered | School; results Public (A1) | "Last 5 completed; 1 abandoned, not counted" (`ROLE_DASHBOARDS` §6) |
| Season run rate, match by match, with the season line from the fifth match | `side_season` (`:3494`), `lib/sideSeason.js` | exists under Analytics; moved | School | "From 9 completed matches, 1,640 balls"; a match the reader cannot read is said, never zero |
| Its place in each competition table | `GET /api/competitions/:id/standings` (`server.mjs:989`) | exists | Public (A1) and school | "Played 6 of 10" |
| Records: holder, former holders, coverage, awaiting | `record_boards` (`:2338`) | exists under Leagues; moved | Staff full; pupil the holders only; family and Public none | as built (C9) |
| Caps, in cap order | `caps` (`:2347`) | exists | School | none |
| Head to head with the next opponent | `derby_record` (`:3098`) | exists | School | "4 matches since 2024" |

### 3.6 Records and compare

| Surface | Gains | Read | Today | Who | Denominator and coverage |
|---|---|---|---|---|---|
| Records | Reached from the team and from a passport's "school record" line; tap a holder's figure → that innings's balls | `record_boards` (`:2338`); §3.3 filter | exists; links are the derivation | as §3.5 | as built |
| Compare | Each match-up line opens the balls behind it; the coverage line stays above | `matchups` (`:2982`), `matchup_coverage` (`:3057`) | exists (GA-I24 S1); links are the derivation | as decided (GA-I24 D2, D10): nothing widens | as built: the floor and `sourceLine` |

### 3.7 The board and the big screen

| Gains | Read | Today | Who | Denominator and coverage |
|---|---|---|---|---|
| SCRBRD-133's moment catalogue, through one pure `lib/moments.js` shared by the Match Centre, the public page and the display | the commentary lines and the fold before and after each read (`live.js:28-48`) | derivation: built to SCRBRD-133 §5.2, which is decided | Public and school, each card in its surface's names | none |
| Free hit and hat-trick-ball tags (§3.3) | as §3.3 | as §3.3 | as §3.3 | none |
| The insight line, as built, held to team-level lines and the named boy's own on a family's screen | `boardInsights()`, returned as `{text, about}` so a screen can tell which name a line carries | derivation: structure the strings it already makes (Q10) | Public and school as now; on a family screen only lines about nobody or about him | none |

The display already runs itself (`display/Rotation.jsx`) and keeps a marked boy's side by
position (`views/matchcentre/bigscreen.jsx:18-29`, db/153). Nothing here changes what it names.

### 3.8 The spectator's home

| Gains | Read | Today | Who | Denominator and coverage |
|---|---|---|---|---|
| **Signed out:** each strip card says its status sentence ("Northfield need 45 off 34") | `GET /api/public/live` (`public-api.mjs:603-610`), which carries `scores` and `overs` but no target and no revision | derivation: the target is first-innings runs plus one **only when no revision exists**, and the read cannot say. Needs `public_live_fixtures()` to return `target` and `revised` (a migration; Q14) | Public | none |
| **Signed out:** the live `Board` first when a listed match is live (§2.3, Q6): team rows only, no batter or bowler, as the read names no boy (`db/82_public_listing.sql:132-137`) | the same read | exists; order only | Public | none |
| **Signed in, following:** followed schools' live boards first, then today, then results, each its sentence | the same public read, filtered to the schools he follows | derivation: a list of followed schools per account (a migration; Q8) | Public facts only, whatever else he may read | none |

### 3.9 The scorer's home

| Gains | Read | Today | Who | Denominator and coverage |
|---|---|---|---|---|
| Each fixture in "This week" says its status sentence | `scorerFixtures()` rows, `lib/scorerHome.js`; `statusSentence()` with no fold | derivation: none | Him | none |
| After a match: **what he scored**, as a plain record ("126 balls, 2 corrections filed, all sent") | the phone's own store and `GET /api/matches/:id/corrections` (`server.mjs:646`) | derivation: count events and corrections he wrote | Him only | the match's own balls |
| A Pilot Match stays in no figure, standing or record | `lib/scorerDay.js` (`SANDBOX_WORDS`) | exists; the words are asserted (`smoke-browser-scorer-home.mjs:480`) | Him | n/a |

No points, ranks or streaks for scoring (C12, rejected below).

### 3.10 The coach's day sheet

| Gains | Read | Today | Who | Denominator and coverage |
|---|---|---|---|---|
| Next fixture: its status sentence ("Starts at 10:00", "Toss: Eastbrook won and chose to bat") under the opponent | `matches`; `statusSentence()`, `tossWords()` | derivation: none | Staff | none |
| This week: each fixture played says its result; each to come its start | `matches` | derivation: none | Staff | none |
| **Last match**, one line: the result and the side's top score and best bowling, his own squad by name | `inningsBreak()` over the fold of the last completed fixture | exists as a function; placement | Staff | strike rate only from ten balls |
| The side's season, one line: "Season run rate 5.84 from 9 matches" | `side_season` (`:3494`) | exists; placement | Staff | its count of matches and balls |
| Who is out stays the status tier, and the queue stays SCRBRD-136's | `injuries` (`:356`), `cockpit/useQueue.js` | exists | Staff by tier | n/a |

### 3.11 The moments

Every moment is triggered by an event or a fold state that **arrives while the page is open**,
never by the clock and never replayed on a reload (`live.js:1-11`). Motion uses the existing
tokens (`design/tokens.js:556-568`). The global reduced-motion block cuts every animation and
names the moment classes (`tokens.js:985-996`); each fallback below is what is left after it.

| Moment | Trigger (event or state) | Where | Motion | Reduced motion | Public? |
|---|---|---|---|---|---|
| Figure flip and run ticker | a board figure changes | every board, the pad's included | `flip` 190 ms `swift`; ticker one run a flip, last eight runs (`live.js:111-128`) | a cut to the new figure | yes |
| Four, six | a line of kind `four`, `six` arrives | spectator boards | the beat card, 190 ms in, held 2.5 s (SCRBRD-133 §5.2 rows 1–2) | appears, held, gone; the polite live region says it | yes |
| Wicket; fifty and beyond; partnership; five wickets; hat-trick | kind `wicket` or `milestone`, matched as §5.2 rows 3–8 say, merged per §5.3 | spectator boards | big card: `interrupt` 1100 ms in, held, 190 ms out; corner only, never over the total | appears, held, gone | yes, names by the live rule |
| Free hit; hat-trick ball | `inn.freeHit`; two of his in two | spectator boards | a tag beside the chips; no motion | the same | yes |
| **Over summary** | kind `over_end` | Summary, public page, display | the line under the chips, 6 s (`OVER_SUMMARY_MS`), `.mc-moment` entrance | appears and goes | yes |
| **Innings-break card** | `statusSentence()` state `innings_break` (the fold: an innings complete, the next not begun) | Summary first, the display's panel, the parent's live card as team figures | `os-panel-in` 280 ms once, then still | appears | yes; names by the live rule, otherwise "Batter 3" |
| Target set; innings closed; revision; play stopped | `innings_start`, `innings_end`, `revision`, `inn.stopped` | spectator boards | big card, as above; "play stopped" held | appears, held | yes |
| **Result** | the result line (`result:<match>`) | spectator boards; the parent's live card turns into the result | big card, held; then the Summary is the result view (CRI-1.7) | appears | yes, `reasons: false` |
| **Highlights** | every four, six, wicket and milestone, in order | Summary, public page | none: a list | none | yes |
| **Milestones and honours** for a family | a `recognition` notice (`NOTIFICATIONS.md` D1), or a milestone line on his record | the child's section of Home, his Passport's Honours | none beyond the card's `os-panel-in` the first time it is seen | none | an honour only if marked public, by the board rule (A5, R11) |
| An honour or milestone **taken back** by a correction | the notice retracted (NOTIFICATIONS D18, S5) | wherever it showed | it goes; no motion | the same | the public board drops it on the next read |
| **Follow and alerts** | a followed school's listed fixture: its first event (live), the innings break, the result. Result-only by default | push, as a pointer only ("You have a new notice.", D14); the person's Today | none | none | the pointer names nothing; the page is the public one |
| **Share** | the person taps Share | Match Centre, public page | the system sheet | the same | the link only |

**Rejected, and why.**

| Candidate | Why not |
|---|---|
| Points, streaks or badges for scorers (C12) | A pressure mechanic on children who score; the brief rules it out |
| A leaderboard or "top run-scorers" of a competition, in public or to pupils and parents | `PUBLIC_DATA` A3, `PUBLIC_BY_TERMS` §1.2; C11 stays staff only and does not grow |
| A milestone or match **image card** to post on WhatsApp or Instagram | It leaves the platform and cannot be recalled; a named card needs an explicit yes that is not built (`PUBLIC_BY_TERMS` §1.2; SCRBRD-100 item 2). Link only (Q18) |
| Any celebration on the pad | `DESIGN_DIRECTION` §1a: a flash on the pad's own board, at most about 600 ms, and nothing more |
| A countdown to the start, or "live" from the start time | The clock never declares a state (`ROLE_DASHBOARDS` §5) |
| Charts that draw themselves on the analysis tabs | Data being read; motion hinders it. Growth ball by ball stays on the display (SCRBRD-133 §4) |
| A push for every boundary or wicket | Too often to be worth a phone; pupils get no medium push 21:00–06:00 (D21) |
| Moving between homes or sections | Tens to hundreds of times a day; a cut |
| A new predictor or a percentage for a side losing | `DESIGN_DIRECTION` decision 10 stands: the par estimate, labelled, nothing more |
| "Personal best" or "season first" notes in public | A figure across matches is never public (`PUBLIC_BY_TERMS` §1.2) |

## 4. Slices, in build order

Six slices, in Kameel's order. Each is one or more PRs behind the walks that exist, under
CLAUDE.md's routing, including Kameel's rule of 29 Oct: complex frontend (the Match Centre,
the pad, the `Board`, the status sentence, StatsMagic) and anything that renders a child's
data to Opus; a task that spans two tiers to the higher one; Sonnet only for simple screens,
copy and styling; review by Opus; schema by Opus, with **Fable's red-team of the migration
on Kameel's say** (CLAUDE.md, Plugins) and his word before the paste; maps and records by
Haiku. Each starts with **Haiku's map**
(files, routes, tests and walks it will touch, with `file:line`) and ends with **Haiku's
records** (the backlog, the roadmap, `CRICINFO_GAP_PLAN.md`, the gap analysis plan).

**What every slice keeps.** The pad's test ids and asserted words (`MAP.md` §9) do not
change; where a slice comes near them it says so. Floors: nothing under 12px, nothing tapped
under 44px, reduced motion honoured. No new runtime dependency. Bundle ceilings from
`tools/check-bundle.mjs`: the app's entry **500 KB** (`:236`; 441 KB after the 29 Oct trim,
`:243`), the public page's static graph **470 KB** (`:311`; 447 KB when last measured, `:310`),
the home page's first paint **260 KB** (`:394`) and its lazy graph **800 KB** (`:395`). These
are the file's own last measurements; this pass ran no build, so each builder measures first.
The public graph has the least room: anything it gains is a lazy chunk, as Commentary's
chips already are (`commentaryTools.jsx` header).

**Worst cases for every slice** (break-ui's catalogue, applied here; each is a fixture in the
slice's walk or unit test, through the same read the demo data uses):

| Case | Value | What must hold |
|---|---|---|
| Long side name | "Westville Boys' High School U14C (Development)" | the board uses `school.code`; the sentence wraps, never truncates a figure |
| Long boy's name | "T Bekker-van der Westhuizen" | wraps on a passport and a team page; the board's batter row ellipsises the name, never the runs |
| Zero | no fixtures, no innings, no balls, no honours | one line saying what will appear, and the next step (SCRBRD-100 "Left, shared" 2) |
| One | 1 innings, 1 ball, 1 match | "1 innings", "1 ball"; no rate (the floor) |
| Huge | 312 innings, 1,284 notices, 48 fixtures this week | counts with a separator; long lists paged or grouped by date |
| Not read | a read that failed | said in words, never "0" (`pupil.jsx:188-192` already does this) |
| Two schools | a parent with children at two schools | two sections that never merge (`DESIGN_DIRECTION` §6) |
| Marked boy | a never-public mark on a team-mate | public surfaces by position, as db/153 and `publicName()` decide |

**How Kameel will know.** Each slice ends with a check on the demo, timed with a phone's
stopwatch at 390 wide: **five seconds** from the first signed-in screen to the thing that
needs the person, and **two taps** to their most common task. A check that fails is reported
as failed, as §1.10 does.

### Slice 1 · The scorer's home and starting a Pilot Match

**Built and merged 14 Nov 2026 (#327, 660a5630).** Not built: adding a name during play.

| | |
|---|---|
| **Scope** | (a) "Start a match" on the no-school home opens the pad's own setup (§2.5 step 3), as it stands, names step included, unless Q5 is answered yes, as a Practice Match for any signed-in account and a Pilot Match for a granted one (Q3). *Q5 was answered yes (as recommended, option b) on 13 Nov: names may be skipped, for Practice and Pilot Matches only.* (b) The scorer's home gains the status sentence on each fixture of "This week" and the plain record after a match (§3.9). (c) After the result on a Practice or Pilot Match: "Scoring for a school? Join it" (§2.5 step 6), never during play. (d) "Now" holds his side's live fixture with its sentence and "Open the pad" when nothing is on this phone, in place of "Nothing on this phone to resume" over two live fixtures lower down (C1; §1.10; `audit/experience-screens/scorer-home-390-daylight.jpg`). The sentence "Nothing on this phone to resume" stays for when nothing of his is live. |
| **Files** | `auth/NoSchool.jsx`, `views/ScorerHomeView.jsx`, `lib/scorerDay.js`, `lib/scorerHome.js`, `lib/pilot.js` (read only unless Q2 widens the grant; *Q2 was answered as recommended on 13 Nov: the persona's app is kept*), `App.jsx:556-569` (landing) |
| **Builds, reviews** | Opus builds (the scorer's surface and its entry to the pad; CLAUDE.md "Scoring engine … the scorer UI's event emission"). Opus reviews a second time, fresh. |
| **Migration** | None for a Practice Match: it never leaves the phone (`lib/pilot.js:29-34`). Widening Pilot Matches beyond granted accounts is a server grant (R1, later): Opus, with Fable's red-team on Kameel's say and his word before the paste. If Q5 is answered yes (it was, on 13 Nov), no migration either: positions are words the pad already has; Opus checks that the events it writes are unchanged. |
| **Walks** | Existing: `scorer-home`, `pilot`, `pilot-flow`, `pilot-r0`, `practice`, `solo`, `pad-resume`, `signup`, `offline-day`, `smoke-a11y`, `check-bundle`. New: `browser-first-score`: a new Google account with no school reaches the first ball, sees the `Board` move, and finds the match under "Now" after a reload |
| **Near the pad's words** | `scorer-home`, `day-sheet`, `scorer-start-pilot`, "Start Pilot Match", "Start Practice Match", "stays on this phone", "Resume scoring", "No finished Pilot Match yet", "Pilot match", "no figure, standing or record" (`smoke-browser-scorer-home.mjs:251-480`). All kept, none reworded. The no-school home reuses `startWords()` (`scorerDay.js:304-318`) rather than writing its own. |
| **Bundle** | The pad stays a lazy chunk (`App.jsx:514-530`); the no-school screen is already outside the entry (`check-bundle.mjs:243-246`). Expected change to the entry: none. |
| **You'll know** | On the demo, sign in as a new account with no school. **Five seconds:** "Start a match" is the first thing on the screen. **Steps, honestly:** one tap opens the set-up; while the names step stands it is six screens (where it goes, the schools, two squads of names, the toss, the openers) before the first ball moves the board, so starting does **not** meet two steps; if Q5 is answered yes (it was, on 13 Nov), it is the overs, the two sides, the toss and the first ball. Reload, then sign in again (a reload signs everyone out, Q25): the match is under "Now" with "Resume scoring". |

### Slice 2 · The spectator's match page

**Slice 2a built 14 Nov 2026 (#334, 0b8f0240).** The rest of slice 2 is not built.

| | |
|---|---|
| **Scope** | §3.3 and §3.7: `lib/moments.js` to SCRBRD-133 §5.2–5.3 on all three surfaces; the free-hit and hat-trick-ball tags; the over story on Summary; the status sentence under the board on every tab; from a scorecard figure to its balls (signed in); the innings-break card first during the break; share (the link); the insight line structured so a family screen keeps only lines about nobody or about the child. The match's links outward (§1.4) wait for Slice 5's addresses, except the player, which exists. On spectator surfaces, Scenarios moves under the charts and "Corrected" is said once (C14). A "Ground display" link to `/display/:id` for a fixture the school has published, if Q19 is answered yes (C17; it was, on 13 Nov, as recommended: the link, for published fixtures only). |
| **Files** | new `lib/moments.js` and its test; `views/matchcentre/live.js`, `spectator.jsx`, `tabs-core.jsx`, `scorecard.jsx`, `commentaryTools.jsx`, `MatchView.jsx`; `ui/board.jsx` (two optional props); `display/panels.jsx` (lift `OverStory`); `public/PublicMatch.jsx`; `scorer/signals.js` (`boardInsights` returns `{text, about}`) |
| **Builds, reviews** | **Opus**: `lib/moments.js` (a wrong trigger is a silent lie on a public screen, SCRBRD-133 §8 G3), the `Board` props (the `Board` sits on the pad), `boardInsights`' shape (it names children), the per-boy filter and its gate, the over story on Summary (a Match Centre component that names bowlers), the status sentence's placement, the Scenarios move and the ground display link. **Sonnet**: the share button, and copy and styling only. **Opus** reviews all, fresh, and checks each card's public safety. |
| **Migration** | None. |
| **Walks** | Existing: `matchcentre`, `public`, `public-live`, `display`, `read`, `narrow`, `superover`, `rain`, `corrections`, `padfeel` and `pad-moments` (the pad must show none of it), `smoke-public` (no child's identity in any signed-out response), `smoke-a11y`, `check-bundle`. New, from SCRBRD-133 §8 G3: a four's card appears once and never on reload; a six that brings a fifty is one card; seven arrivals in one read cut to state with no card; reduced motion leaves no animation class. Plus: the batter filter is absent signed out; the share sheet's text names no child. |
| **Near the pad's words** | `Board` gains props the pad never passes; the pad's own "Free hit" banner (`padfeel.mjs:310`) is untouched. `pad-moments` guards that no spectator moment reaches the pad. |
| **Bundle** | The public graph is the tight one (470 KB). `lib/moments.js` is pure and small; the over story and the batter filter are lazy, fetched with the tab that draws them, as `commentaryTools.jsx` is. The builder reports the public graph's size before and after. |
| **You'll know** | Open a live demo match at 390, signed out, as a parent from a WhatsApp link would. **Five seconds:** the score and its sentence ("Northfield need 45 runs off 34 balls") without scrolling. A four arrives: a card in the board's corner, the total never covered. Turn on reduced motion: the card appears and goes, nothing slides. Signed in, **two steps**: tap Scorecard, tap a batter's runs, and only his balls are listed with their count. |

### Slice 3 · First run

| | |
|---|---|
| **Scope** | §2.2–§2.10: one door (Google or a code); the older role-tile flow retired from the live site (Q13); the no-school screen as a home in the day sheet's order; the public home page's first screen by state (Q6) with its three doors; the strip's status sentences (§3.8); "Ask SCRBRD to add my school" (Q22). **The follow list (Q8)**: "Follow Northfield's matches" at a pause on the public page (§2.4 step 2), one Google sign-in, then a signed-in spectator's Today that leads with his followed schools' live boards, then today's, then results (§3.8), all from the public read filtered to his list. Alerts for followers (Q23) are **not** in this slice: they wait for push delivery, NOTIFICATIONS S3, which has not shipped (no `notification_push_job` in `db/`). *Q23 was answered as recommended on 13 Nov: option (a), a Fable addendum, when push delivery is near.* Until then following changes what leads his Today, and nothing is pushed. |
| **Files** | `auth/LoginPage.jsx`, `auth/NoSchool.jsx`, `auth/OnboardingFlow.jsx` (demo only), `App.jsx:486-512`, `home/main.jsx:128-155`, `home/sections/Hero.jsx`, `LiveStrip.jsx`, `Schools.jsx`; for the sentence, `public_live_fixtures()` and `services/api/public/public-api.mjs:603-610` |
| **Builds, reviews** | **Opus** for the sign-in and the no-school home (SCRBRD-140's rules; who may link to a school), the home page's first screen chosen by state, the strip's status sentence, the follow list's screens, and the migrations. **Sonnet** for the home page's three doors as plain links, and copy and styling. **Opus** reviews. |
| **Migration** | **Three, each with Fable's red-team on Kameel's say and his word before the paste; one file or three, as the builder finds simplest.** (1) `public_live_fixtures()` re-emitted with `target` and `revised` (Q14), with `db/99` proving it returns nothing else new. (2) A request to add a school: a row with the school's name, town and the person's job, read by the platform alone (Q22). (3) **The follow list (Q8)**: a row per account and school, read and written by its owner alone (RLS on `app_user_id()`), holding nothing but the two ids and a date; it grants no read, and the Today it feeds reads only `public_live_fixtures()` filtered by it. `db/99` proves another account cannot read a list, and that a followed school which switches listing off drops out at once. Retention: removed with the account (ACCOUNT_LIFECYCLE). |
| **Walks** | Existing: `signup`, `home`, `listing`, `public-live`, `second-account`, `accounts`, `signout`, `smoke-public`, `smoke-a11y`, `check-bundle` (the home page's 260 KB first paint). New: `browser-first-run`, per persona as §2.4–§2.8 lay out: a spectator from a link to Follow; a parent from "My child plays" to "Sent to the school"; a coach on the register to Today; and the home page in each state of §2.3. |
| **Near the pad's words** | None. |
| **Bundle** | The home page: the live `Board` first means its figures paint before the film; the film stays lazy (`check-bundle.mjs:394-397`). The old onboarding stays out of the entry (`:244`). |
| **You'll know** | On the demo's home page with a listed live match, at 390, signed out: **five seconds**, the live board and its sentence are the first screen. **Two steps** to watch: tap the board, and the match is open. With no match listed, the film plays as now. Sign in with a new Google account: nobody asks "what's your role?". Follow a school from its live page as a new account with no school: after signing in he lands on the **no-school home**, whose *Followed schools* block is first while that school is live (§2.2), and one tap opens the match. A follower who belongs to a school lands on **Today**, which leads with it (§1.9). |

### Slice 4 · Parent and pupil

| | |
|---|---|
| **Scope** | §3.4 and the persona parts of §1: a pupil or parent who scores keeps the four-item app (Q2); health consent to Family, on the child's file (Q16); the waiting parent reads the terms and is told when the office answers (Q15); the passport's rates with their floor and denominator, its source line, and from a figure to its innings and balls; the parent's live card says the status sentence and keeps only lines about nobody or her child; the season card's average under the floor (Q12). From the shots: while his match is live, the live card leads the child's section instead of sitting fourth (§1.9; `audit/experience-screens/parent-home-390-daylight.jpg`, `…-1366-daylight.jpg`); the availability button says "Answer" until there is an answer (C16); the passport's tab row shows that it scrolls (C15); **the DSO card last on the parent's and the pupil's Home** (Q7; `SAFEGUARDING_DSO.md` §2.5). |
| **Files** | `design/roles.js:332-355` (`personaFor`), `views/family/pupil.jsx`, `cards.jsx`, `family.jsx`, `childfile.jsx`, `terms.jsx`, `views/healthconsent.jsx`, `auth/NoSchool.jsx:259-260` (the sentence about health consent), `views/SettingsView.jsx:745,799` (what moves out), `lib/compare.js` (the floor, shared) |
| **Builds, reviews** | **Opus** builds all of it: it renders a child's data and changes the persona rule. **Opus** reviews, fresh. |
| **Migration** | **Yes, one, for Q15's notice.** Checked: nothing tells a parent the office has answered. `guardian_link_verify()` only updates the link (`db/08_schema_programme.sql:987-1035`; `db/128_sa_day.sql:54,198` re-emits it for the date alone); the one trigger on that column settles lift seats (`db/70_lift_clubs.sql:1976-1979`); the grant door that verifies a parent's request writes the link and no notice (`db/92_staff_register.sql:229`, `:277-281`); and a decline tells the school's DSOs, not the asker (`db/93_declined_claim_notice.sql:10-19`). So a `db/NN` writes one `system` notice to the asker (`recipient_id`), **with the same words whether the answer was yes or no**: "The school has answered your request", saying nothing of the answer (her requests list already says "granted" or "declined", `lib/joinSchool.js:178-183`); the push a pointer (NOTIFICATIONS D14). The decline's own `safeguarding` notice still reaches only the DSOs (db/93), unchanged. Opus, with Fable's red-team on your say and your word before the paste; `db/99` proves only the asker receives hers, and that db/93's notice is untouched. |
| **Walks** | Existing: `pupil`, `consent`, `lifts`, `read` (the guardian steps), `passport-union`, `compare`, `awards`, `potm`, `seasons`, `public-name`, `scorer-home` (a pupil who scores), `smoke-a11y`, `db/99` if a migration ships. New: a pupil holding `scorer` keeps the four-item bar and sees "Appointed to score" on Home; a child with one innings of three balls shows runs and "3 balls" and no average; a parent with children at two schools sees two sections; a waiting parent opens the terms and cannot agree; the `safeguarding` walk finds the DSO card on the parent's and the pupil's Home. |
| **Near the pad's words** | "Appointed to score" (`smoke-browser-scorer-home.mjs:257`) is reused on the pupil's Home, word for word. |
| **Bundle** | Entry: the persona change is in `roles.js`, already in the entry; the passport's drill opens the match page, which is lazy. |
| **You'll know** | Sign in as the demo pupil. **Five seconds:** his next match and what he must answer are first. **Two steps:** Passport, then tap his runs, and the innings behind them are listed with how many came from a scorebook. Sign in as the demo parent with two children: both sections, each with its own actions. As a pupil who scores: four items on the bar, the scoring block on Home. |

### Slice 5 · The coach's day sheet, and the homes

| | |
|---|---|
| **Scope** | §1.2–§1.5 and §1.9 for staff: Today, Matches, Team and Logistics as the menu; the header (bell, "Raise a concern", the person's name); "To resolve" only for someone who can act (Q17); addresses for a player, a team and a ground (Q11); the team page of §3.5; the day sheet's figures of §3.10; "Needs you" rows that land on the fix (§1.10). The day sheet back in its order (C13): Now, then the next fixture once, with the cockpit's "Match day" folded into it and "Recent matches" drawn only when a match has figures (`audit/experience-screens/coach-home-390-daylight.jpg`, `…-390-floodlit.jpg`, `…-1366-daylight.jpg`). **The DSO card last on every Today** (Q7; `SAFEGUARDING_DSO.md` §2.5). The shell's 9px "▾" (`shell/MobileNav.jsx:61`), under the 12px floor at 1366 in both themes on the coach's, scorer's and spectator's homes (NOTES.md, `small 1 … 9px "▾"`, `…/coach-home-1366-daylight.jpg` and `-floodlit.jpg`), raised to the floor. |
| **Files** | `design/homes.js`, `design/roles.js:199-297` (Q17 only), `lib/homeNav.js`, `shell/Sidebar.jsx`, `shell/MobileNav.jsx:88-89`, `shell/TopBar.jsx`, `shell/HomeBar.jsx`, `App.jsx:168-173,441,570-607`, `lib/matchTabs.js`, `views/DashboardView.jsx`, `views/ReadinessOverview.jsx:235-251,374`, `views/SquadView.jsx`, `views/sideseason.jsx`, `views/records.jsx` |
| **Builds, reviews** | **Opus**: the shell, the addresses and `roles.js` (cross-cutting; policy), the team page (squad, who's out, players, caps and records are children's data) and the day sheet's lines ("Last match" names the side's boys). **Sonnet**: copy and styling, and the shell's type-floor fix. **Opus** reviews. |
| **Migration** | None. Q17 changes the capability map in code; `db/99` and `rls.test.mjs` prove nothing widens. |
| **Walks** | Existing: `dayof`, `read`, `cockpit`, `queue`, `matchcentre`, `narrow`, `injuries`, `skills-history`, `coaching-points`, `league`, `results`, `smoke-readiness`, `smoke-summary`, `smoke-a11y`, `check-bundle`, and **every walk that taps a folded `nav-` id**: Haiku lists them before the build (Q4), and each moves to `home-<home>-section-<key>`. New: `browser-homes`: each persona of §1.7 sees exactly the "after" menu; the `safeguarding` walk finds the DSO card last on Today and no mark of a concern on any home; a phone bar has no "More"; a team page opened by address shows the same figures as the side's Analytics did. |
| **Near the pad's words** | `day-sheet` (`smoke-browser-scorer-home.mjs:366`) is kept as Today's test id. |
| **Bundle** | Entry: the shell shrinks (fewer menu items); the team page is lazy. |
| **You'll know** | Sign in as the demo coach on a match day. **Five seconds:** the next fixture's sentence and its chips that are not done. **Two steps:** tap "Team sheet" and the sheet is open for that fixture; tap Team, then Training. On a phone, four items on the bar and no "More". As the director with three teams: the first "Needs you" row opens the screen that fixes it. |

### Slice 6 · The office

| | |
|---|---|
| **Scope** | §1.6 and §2.7: the School home (People, Access, Record, Modules, Sponsors); Settings taken apart, each part moved whole; the Platform home; the set-up list for a school with no fixtures; "A parent is waiting" as a "Needs you" row; the Safeguarding Officer's route (Q7): Today, then the bell's `safeguarding` notice, then the inbox, with nothing on Today that says a concern exists. Figures here are counts with their denominators ("12 of 40 pupils cannot sign in yet", from Settings' own `noAccount`, `SettingsView.jsx:175`, `:394`), never a percentage without one (`ROLE_DASHBOARDS` §6). |
| **Files** | `views/SettingsView.jsx` (by part, §1.6), `views/staffRegister.jsx`, `views/importer.jsx`, `views/guardianlink.jsx`, `views/publicname.jsx`, `views/ManagementView.jsx`, `views/ModulesView.jsx`, `views/SponsorsView.jsx`, `views/support.jsx`, `views/dlsTables.jsx`, `design/homes.js`, `App.jsx:556-569` (the DSO's landing) |
| **Builds, reviews** | **Opus**: the parts carry policy gates, the audit, names-off and a child picker (`SettingsView.jsx:1229-1472`). Moving `D` to `T` on a screen it touches goes with it (`DESIGN_DIRECTION` §7). **Opus** reviews. |
| **Migration** | None. |
| **Walks** | Existing: `accounts`, `import`, `management`, `public-name`, `listing`, `consent`, `signup` (claims), `support`, `safeguarding`, `second-account`, `suspension`, `smoke-a11y`, `check-bundle`. New: a parent's own name opens only her own settings; a new school's Today shows the set-up list, each line going as it becomes true. |
| **Near the pad's words** | None. |
| **Bundle** | Entry: Settings is already outside it (`check-bundle.mjs:238`); each moved part stays lazy. |
| **You'll know** | Sign in as the demo office. **Five seconds:** "A parent is waiting" is the first row. **Two steps** to the claim's pupil when the claim names him; three when it names him in free text, by decision (§1.10). Sign in as the demo parent and tap her name: her own settings, no "People" tab. |

### After each merge

Haiku strikes the closed entries through in `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md` with the
PR and commit, and updates `CRICINFO_GAP_PLAN.md` (G2, G3, G10, G11, G15 as each closes) and
the gap analysis plan. Two backlog lines are already stale and should be corrected then:
SCRBRD-100 says Player of the Match has "no data anywhere" (it has a route,
`server.mjs:795`) and that no route lists pending amendments (`GET /api/corrections`,
`server.mjs:1092`).

### What is dropped, and why

| Item | From | Why |
|---|---|---|
| Image cards for WhatsApp and Instagram | SCRBRD-100 "Sharing", `DESIGN_DIRECTION` §10 item 11 | Needs an explicit-yes consent that is not built (`PUBLIC_BY_TERMS` §1.2). The link is shared instead (Slice 2) |
| Scorer points, streaks, partner rewards | `ROLE_DASHBOARDS` §3D R3 | A pressure mechanic on children (§3.11) |
| Impact score as the PoM suggestion | `CRICINFO_GAP_PLAN` G14, CRI-3.3 | Waits on the recognition fixes it already names; not this pass |
| StatsMagic, the explorer | G16, CRI-3.4 | Its own Fable pass; this pass only links into it from figures |
| Natural-language search, editorial recaps | UX-16, UX-17 | Not stats-forward for a school day; after the pilot |
| A crest on every board | `DESIGN_DIRECTION` §10 | Needs its own small migration and an upload; the short code stands in |

## 5. Questions for Kameel

Twenty-five questions, **most important first**: the menu and the persona rule, then the
standing decisions (the walks' words, what the pad records, the 6 Nov hero), then children's
privacy, then the rest; deferred ones last. Each is the finding, the choice, and a
recommendation that can be answered "as recommended".

**Answer these first** (they unblock Slices 1, 3, 4 and 5):

1. **Q1**: the homes as the whole menu.
2. **Q2**: a pupil or parent who scores keeps his own app.
3. **Q3**: who may start a match with no school.
4. **Q4**: the menu's test ids and asserted words change with the homes.
5. **Q5**: a Practice or Pilot Match may skip typed names.

*Renumbered 13 Nov after the Opus review* (sections 1 to 4 use the new numbers; old Q19,
the moment timings, is now a note in C4, as SCRBRD-133 already decided it). Old to new: Q1→Q1, Q2→Q4, Q3→Q2, Q4→Q21, Q5→Q11, Q6→Q7, Q7→Q17, Q8→Q6, Q9→Q8, Q10→Q25, Q11→Q3, Q12→Q13, Q13→Q15, Q14→Q22, Q15→Q16, Q16→Q12, Q17→Q14, Q18→Q23, Q20→Q18, Q21→Q9, Q22→Q10, Q23→Q20, Q24→Q24, Q25→Q19, Q26→Q5.

| # | Finding (evidence) | Options | Recommendation |
|---|---|---|---|
| **Q1** | Staff see 17 to 22 menu entries; the homes pattern covers three domains (A2, A4; `roles.js:281-297`, `homes.js:30-60`). | The homes of §1.3 as the whole menu (Today, Matches, Team, Logistics, School, Platform), or keep the menu | **Adopt them.** At most five entries for anyone at a school, all on a phone's bar, no "More". Slices 5 and 6. **Decided 13 Nov: as recommended.** |
| **Q2** | A pupil or parent who also scores loses the four-item app and gets a staff menu of up to 18 (A8; `roles.js:344-350`). | Keep the persona's app with scoring as a block on Home and on the appointed match, or keep today's | **Keep the persona's app**, no fifth bar item. What a pupil scorer may read is unchanged and still the server's. Opus, Slice 4. **Decided 13 Nov: as recommended.** |
| **Q3** | A new account cannot reach the pad; a Pilot Match needs SCRBRD's grant (B7; `lib/pilot.js:28-34`, `scorerDay.js:304-318`). | Who may start a match with no school | **A Practice Match for any signed-in account** (it never leaves the phone). **A Pilot Match for accounts you grant** while R0 runs; widen at R1 with a limit on open matches per account. Slice 1. **Decided 13 Nov: as recommended.** |
| **Q4** | Seventeen destinations leave the menu (§1.5). Their routes stay, but `nav-news`, `nav-calendar`, `nav-readiness` and the rest go: 20 files in `tools/` tap one of the folded ids (grep for the folded keys, Competitions and Leagues left out). The walks also **assert menu words** that §1.3 renames: `smoke-a11y.mjs:1423`, `:1521`, `:1964`, `:2033`, `:2187` and `:2310` click the button reading "Match Centre"; `:1867` asserts `/Dashboard\|Match Centre/`; `:2178` loops over "Match Centre", "Settings" and "Dashboard". These are words you listed as standing. The pad's ids and words are untouched. | Let the folded `nav-` ids change and the menu words change with the homes (Dashboard → Today, Match Centre → Matches, Squad → Team, Staff → School, Pitch Deck → Platform), each walk moved to the new id or word; or keep the old words as the homes' names | **Let both change**, as Leagues did, in the same PR as the menu (Slice 5), with every walk moved to `home-<home>-section-<key>` or the new word. Haiku lists every file and line before the build. The pad's words, and the scorer home's, stay. **Decided 13 Nov: as recommended.** |
| **Q5** | Starting a Pilot or Practice Match today is six set-up screens, two of them squads of 2 to 15 typed names, before the first ball (`lib/scorerDay.js:305`; `lib/pilot.js:64-65`, the notice shown where names are typed; `audit/experience-screens/scorer-pilot-3-players-390-daylight.png`, `…-1366-daylight.png`). The pad already has position words for a player whose name has gone ("Home No. 3", `lib/pilot.js:36-38`). Letting set-up skip names **changes what the pad records** at the start of a match, which is a standing decision. | (a) Keep the names step; (b) let a Practice or Pilot Match skip names and score on positions, a name addable later; (c) skip only for a Practice Match | **(b), for Practice and Pilot Matches only, never a school fixture.** It brings the scorer's first ball within reach of two steps and keeps typed children's names off the server unless a scorer chooses to add them. Opus, Slice 1; the `pilot`, `practice` and `scorer-home` walks unchanged, and a new walk that a match scored on positions alone folds the same. Until you answer, Slice 1 keeps the names step and §1.10 and §2.10 count it. **Decided 13 Nov: as recommended.** |
| **Q6** | The public home page opens on the film whatever is happening (B10; `home/main.jsx:140-142`). | The live `Board` first while a listed match is live, the film under it; or the film always first | **Board first while live.** The state comes from the read the page already makes. It changes the 6 Nov direction for the hero only while a match is on. Slice 3. **Decided 13 Nov: as recommended.** |
| **Q7** | Safeguarding moves to the header (§1.5 row 32). Checked against `SAFEGUARDING_DSO.md`: (a) a DSO is already told of a new concern by a `high` `safeguarding` notice that names nobody and reaches only `safeguarding.concern.read` (§3.3), so the bell's one count already carries it for him and nobody else; (b) "the audit log does not say a concern exists" (§1 principle 3), so a mark of its own beside "Raise a concern", on a screen others glance at, would say what the bell does not; (c) the design puts a **DSO card on every home** (names, contact line, "Raise a concern", "Report anonymously", §2.5, §8), which today is drawn only on the Safeguarding screen (`views/SafeguardingView.jsx:238`; absent from `audit/experience-screens/coach-home-390-daylight.jpg` and `…/parent-home-390-daylight.jpg`); (d) on this deployment "Report anonymously" has no link, and the no-school screen's "Worried about a child?" ends there (`…/new-account-no-school-390-daylight.png`; `NoSchool.jsx:77-83`). | Land the DSO on his inbox, or on Today with the inbox one tap from the bell; a header mark of its own, or the bell alone; the DSO card on every home | **Land him on Today, like everyone else.** The inbox opens straight onto the concern rows, each with its reference, date, nature and a clock that turns red after 24 hours (`views/SafeguardingView.jsx:234-243`, `:300-305`), so landing there shows anyone who sees his screen open that concerns exist. The `high` notice, which names nobody, takes him to it from the bell in one tap. **No mark of its own: the bell is enough and says less. Put the DSO card last on every Today and Home, as §2.5 already decided**, beside the header's "Raise a concern", which stays. Set the Guardian's app link on the deployment before the pilot, or let the card say whom to call. Slices 4 (the parent's and pupil's Home), 5 (Today) and 6 (the route); Opus reviews anything that shows a concern (§8). **Decided 13 Nov: as recommended.** |
| **Q8** | "Follow this match" is not built; following a school means asking for the `spectator` role and waiting for the office (C7; SCRBRD-140 §5.1). | A personal list of schools whose **public** matches lead a person's Today, with no role and no office step; or the role only | **The personal list, in Slice 3.** It opens no new read: a follower sees what a stranger with the link sees. One small migration (the list, owner-only), Opus, with Fable's red-team on your say and your word before the paste. **Decided 13 Nov: as recommended.** |
| **Q9** | From a scorecard figure to its balls is not built (C10). On a public page it would gather one boy's balls in one list. | Signed in only; or the public page too, under the name rule | **Signed in only.** A per-boy list in public is a player page in all but name (A4, L7). Public keeps the kind filters it has. Slice 2. **Decided 13 Nov: as recommended.** |
| **Q10** | The insight line is plain strings, some naming a boy ("T Bekker needs 4 for fifty"); a family's screen names no other child (C2; `signals.js:151-188`; `DESIGN_DIRECTION` §6). | Each line says whom it is about, and a family's or pupil's screen keeps only lines about nobody or about him; or no insight line there | **The structured line.** "The stand needs 6 for a fifty partnership" and "Projected 148" stay; another boy's milestone goes. Opus, Slice 2. **Decided 13 Nov: as recommended.** |
| **Q11** | Only the Match Centre has an address; a player, a team and a ground cannot be linked to (A6; `App.jsx:168-173,441`). | An address under `/app` by id for each, or not | **Yes**, by id only, never a name, opened only for a reader the server allows. Without it, "from the thing it belongs to" and the team page (§3.5) cannot be built. (A figure's tap to its innings, §3.4, needs only the match address, which exists, so Slice 4 does not wait for this.) Slice 5. **Decided 13 Nov: as recommended.** |
| **Q12** | A child's average, strike rate and economy are shown from a single ball on his passport and his parent's card, while Compare holds a thirty-ball floor (C3; `pupil.jsx:203`, `cards.jsx:143`, `lib/compare.js` D4). | The floor on every child's rate, the count always shown; or the floor on Compare only | **The floor everywhere.** "8 balls: a guide, not a figure" in place of an average of 64.00. Nothing is hidden; the count is always drawn. Slice 4. **Decided 13 Nov: as recommended.** |
| **Q13** | Two sign-up doors ask different questions; the older one asks for a role and promises screens people will not have (B1 to B3). | Retire the older flow from the live site, or keep both | **Retire it.** One door: Google or a code, then the no-school home. The demonstration keeps its demo accounts. Slice 3. **Decided 13 Nov: as recommended.** |
| **Q14** | The home strip cannot say "Northfield need 45 off 34": its read carries scores and overs but no target, and after a rain revision a target worked out in the browser is wrong (§3.8; `public-api.mjs:603-610`; `LiveStrip.jsx:5-20`). | Re-emit `public_live_fixtures()` with `target` and `revised`; or figures only | **Re-emit it.** Opus, with `db/99` proving it returns nothing else new, Fable's red-team on your say, and your word before the paste. Team facts only, as now. Slice 3. **Decided 13 Nov: as recommended.** |
| **Q15** | A waiting parent has nothing to read, and nobody tells her the office has answered (B9; `lib/guardianLink.js`). | Let her read the terms while waiting (not agree), and a phone notice with no child's name when the office answers | **Yes to both.** The text is not secret, and reading early makes her agreement better informed. Today nothing writes that notice on either path (Slice 4's migration row, `db/08_schema_programme.sql:987-1035`, `db/92_staff_register.sql:277-281`), so it takes one small migration, with Fable's red-team on your say. The notice has the same words whether the office said yes or no and says nothing of the answer; her requests list already says which (`lib/joinSchool.js:178-183`). Slice 4. **Decided 13 Nov: as recommended.** |
| **Q16** | Health-monitoring consent is on Settings' third tab, and the join form says it is "under Settings, Me" (A9; `NoSchool.jsx:259-260`). | Move it to Family, on the child's file, beside the terms and the public-name switches | **Move it.** The consent and its record do not change, only where it is found; the join form's sentence changes with it; `popia-2026-01` does not name the place. Slice 4. **Decided 13 Nov: as recommended.** |
| **Q17** | "To resolve" and "Officials" are offered on reading a fixture, so a spectator has both (A7; `roles.js:217,222`). | Draw "To resolve" only for someone who can act on at least one kind of row | **Yes.** A change to the capability map: Opus, with a `db/99` check that nothing widens. Slice 5. **Decided 13 Nov: as recommended.** |
| **Q18** | No match page can be shared (C6). A named image card needs an explicit yes that is not built (`PUBLIC_BY_TERMS` §1.2). | Share the page's link now, with a preview that names no child; image cards later, on their consent | **The link now.** D3 already expects it. Image cards wait for their own consent and design. Slice 2. **Decided 13 Nov: as recommended.** |
| **Q19** | A signed-in spectator has no big screen: the Match Centre's is for the host's staff by your 12 Nov decision (a), and the public ground display is linked only from the staff's Publication section (C17; `MatchView.jsx:477-481`; `views/publication.jsx:6`; NOTES.md "Not reached"). The display is public, names by the public rule, and reads well from the boundary (`audit/experience-screens/spectator-signed-out-big-screen-display-1366-daylight.png`). | A "Ground display" link to `/display/:id` on the public page and the Match Centre, for a fixture the school has published; or staff only, as now | **The link**, for published fixtures only. It opens nothing new: the page is already public at that address. Decision (a) stands for the signed-in big screen with full names. Slice 2. **Decided 13 Nov: as recommended.** |
| **Q20** | `ROLE_DASHBOARDS` §3D proposes scorer points, streak badges and partner rewards for R3; most scorers are under 18 (C12; `ROLE_DASHBOARDS_v1.1.md:64,128`). | Drop them; or keep them for R3 | **Drop them.** In their place, a plain record of what he scored (§3.9). Haiku records it in `ROLE_DASHBOARDS`. **Decided 13 Nov: as recommended.** |
| **Q21** | Team gathers six sections for a coach, and a team's figures live in three places today (§1.3; C8; `LeagueView.jsx:550`, `AnalyticsView.jsx`). | One Team home with its figures; or Training and Skills as a home of their own | **One home.** A separate one takes a director to six entries and brings "More" back. Test it in the pilot. **Decided 13 Nov: as recommended.** |
| **Q22** | An unlisted school is a dead end in the join form; the home page gives schools an email address (B6, B10). | "Ask SCRBRD to add my school": a short note (the school, its town, the person's job) answered by a person, and a match to score meanwhile; or the email | **The note**, with a small migration to hold it (Opus; Fable's red-team on your say). Who answers it, and how fast, is yours to say. Slice 3. **Decided 13 Nov: as recommended.** |
| **Q23** | Alerts for a followed school need an audience the notifications model lacks: it has four shapes and a closed list of kinds (NOTIFICATIONS D1, D7). | (a) A Fable addendum to NOTIFICATIONS for a fifth shape, "followers of a school's public fixtures", public facts only, Result-only by default; (b) an Opus addendum; (c) no alerts for followers | **(a), when push delivery is near.** CLAUDE.md puts notifications ("who receives what") on Fable's list, and a new audience is exactly that. It is in no slice: it waits for NOTIFICATIONS S3, push delivery, which has not shipped (no `notification_push_job` in `db/`). Slice 3's follow list works without it. The push stays a pointer (D14); pupils keep their quiet hours (D21). **Decided 13 Nov: as recommended.** |
| **Q24** | The two targets are hypotheses (`ROLE_DASHBOARDS` §10); nothing measures them, and a timing event about a child's screen would itself be data about a child. | Stopwatch checks on the demo per slice, then pilot observation with a few people per persona; or in-app timing events | **Stopwatch and observation.** No timing event that carries a child, a school or a screen's content. Each slice's "You'll know" is the demo check. **Decided 13 Nov: as recommended.** |
| **Q25** | A reload signs everyone out by design, so every cold open is the sign-in screen (§1.10; `NoSchool.jsx:321-329`, `App.jsx:396-401`). | (a) Keep it, and count five seconds from the first signed-in screen; (b) let a Google session renew itself silently on open (SCRBRD-140 §2.2), so a cold open costs a moment, not a sign-in | **(a) now; (b) as a design question for Opus** with the account-lifecycle rules (a shared phone at a ground), brought back to you with its risks. Until then every target is measured from the first signed-in screen. **Decided 13 Nov: as recommended.** |
