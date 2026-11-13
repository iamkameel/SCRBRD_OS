# Experience pass: where things live, and the first run

Status: **design, for Kameel's review** (13 Nov 2026). Nothing here is built, and nothing is
built until the questions at the end are answered on the Build Board.

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
(`collapseHomes`), which is what the shell draws. Screenshots were not ready when this was
written, so no finding rests on one. No child is named; "T Bekker" is the placeholder the
consent designs already use, and the schools are invented.

Sections 1 and 2 are this pass. Sections 3, 4 and 5 are headings for the passes that follow.

---

## 1. Where things live

### 1.1 What is true today

| # | Finding | Evidence |
|---|---|---|
| A1 | The menu holds **34 destinations in eight groups**. The comment above it still says twenty-two. | `design/roles.js:281-297` (`NAV_GROUPS`), `:199-266` (`NAV_CAPABILITY`), comment `:269` |
| A2 | A school's staff see **17 to 22 menu entries** each (table in §1.7). The menu is the capability map drawn as a list: whatever a role may read becomes an entry. | `roles.js:361-377` (`navGrants`, `navForRoles`); counts by running it |
| A3 | On a phone the bar is the **first four entries in group order plus "More"**. For nearly every staff role that is Dashboard, Newsfeed, Match Centre, Calendar. Squad, To resolve and Alerts sit in the drawer. | `shell/MobileNav.jsx:88-89` (`nav.slice(0, 4)`), order from `roles.js:285` |
| A4 | The homes pattern gathers **three domains**, and two of them (Logistics, Fields) are the same area linking to each other. It has no home for a match day, a team or the school office. | `design/homes.js:30-60` |
| A5 | **Fourteen destinations are reached only from the menu** in a literal scan of the code: Analytics, Injuries, Calendar, To resolve, Officials, Sponsors, Modules, Newsfeed, Management, Rulebook, Pitch Deck, Selection, and nearly so Squad and Staff. No link was found from a match to its team or its ground. (The scan is literal; a link built another way would not show.) | `MAP.md` §3, checked against `App.jsx:570-607` |
| A6 | Only the Match Centre has an address. Every other screen is one piece of state, and a player's page is a shared variable set before the page changes, so a player, a team and a ground cannot be linked to, shared or returned to. | `App.jsx:168-173` (`page`), `:198` and `:572` (`profileTarget`), `:441` (the one route) |
| A7 | "To resolve" and "Officials" are offered to anyone who may read a fixture, so a **spectator's menu carries "To resolve"** and an umpires' register. | `roles.js:217`, `:222`; spectator's menu computed (11 entries) |
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
   Fields already do by hand, made a rule.
3. **The header, for everyone** (`aside`). `PERSONA_ASIDE` already puts Settings and
   "Raise a concern" in a parent's and a pupil's header. Staff get the same header: the
   bell, "Raise a concern" and their own name. Those three leave the menu.
4. **Things** (`THINGS`): a match, a player, a team, a ground. Each is a page with an
   address, and a list of links in the shape `homes.js` uses now (`{ to, section, label,
   from }`), drawn by the same `HomeBar`, each offered only where the reader reaches its
   source. A thing is where "reached from the thing it belongs to" happens.

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
  menu entries and a phone back on "More". Question Q4.
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
| 32 | `safeguarding` Safeguarding (You) | 28 | The header, on every screen; the home a Safeguarding Officer lands on (Q6) | "You may raise a concern from any screen" is in the terms a parent agrees to (`lib/guardianLink.js`, Safeguarding). It must never be in a drawer. |
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
| **Pupil who scores** | **18**: a staff menu (A8) | **4**: the pupil's; scoring is a block on his Home and on the match he is appointed to (Q3) |
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
| `dso` | The office, and lands on Safeguarding (Q6): Today, Matches, Team, Logistics, School | 14 → 5 |
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
| Director of sport | Yes, if "Needs you" is the first block of Today, across his teams | Clear a blocker: tap the row → the exact screen | **Passes only if each row lands on the fix**, not on a list. Today the overview links to Squad and the Match Centre and nowhere else (`views/ReadinessOverview.jsx:235-251`, `:374`). With several teams, any task not in the queue costs a third step (pick the team). **Fails there.** |
| The office | Yes: waiting parents, claims and missing records are "Needs you" rows | Verify a parent's link: row → the pupil's family links → Verify | **Fails by one step** when the claim names a child in free text and the office must find the pupil first. That step is the safeguard (SCRBRD-140 D5) and should stay. |
| Coach | Yes: the next fixture's chips | Pick the XI: Team sheet chip → the sheet (1). Plan training: Team → Training (2) | Passes |
| Team manager | Yes: transport and answers outstanding | Check the bus: Transport chip → the trip (1) | Passes |
| Scorer | Yes: "Now" is what this phone is scoring (`views/ScorerHomeView.jsx:285`) | Resume or start: one tap (`:326`) | Passes today |
| Parent | Yes: the action list is first in the child's section | Answer availability, in place (1). See his score: the `Board` → the match (1) | Passes. With children at two schools it is two sections and a scroll, by decision (§6); the second child may be below the fold. **Partly fails five seconds** for the second child. |
| Pupil | Yes | Answer availability (1). Open his Passport (1) | Passes |
| Captain | Yes, when the captain's block is first on Home on a match day | Pick Player of the Match: card → choose (2) | Passes, subject to SCRBRD-138's rules, not reopened |
| Spectator, signed out | **Fails on the home page today** on a phone: the page opens on the film and the live strip follows it (`home/main.jsx`, `Hero` then `LiveStrip`). From a shared link it passes outright | Watch a live match: one tap from the home page; none from a link | Passes on steps; five seconds depends on Q8 |
| Spectator, signed in | Yes, if a followed school's live match leads Today | Open it: one tap | Passes if following exists (Q9); "Follow this match" is not built (`MAP.md` §7f) |
| Platform admin | Yes: incidents first | Open a school's incident: row → the school (2) | Passes |
| Anyone, opening the app cold | **Fails.** A reload drops the session by design, so every cold open is the sign-in screen first (`auth/NoSchool.jsx:321-329`; `App.jsx:396-401`) | n/a | Stated plainly; Q10 |

---
