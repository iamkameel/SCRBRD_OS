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

## 2. First run, per role

### 2.1 What is true today

| # | Finding | Evidence |
|---|---|---|
| B1 | There are **two sign-up doors that ask different questions**. "Create an account" opens the older flow, which offers ten role tiles and posts a request. "Continue with Google" opens the newer no-school screen, which offers four kinds of person. | `auth/LoginPage.jsx:327-329` → `App.jsx:284`, `:505-512` → `auth/OnboardingFlow.jsx:96-107`, `:168`; Google → `App.jsx:230-232`, `:495-503` → `auth/NoSchool.jsx:179-203`, `lib/joinSchool.js:40-44` |
| B2 | The older flow shows **nothing real before it asks for a role**. Step one is a line of welcome that promises to "tailor the platform to your role"; step two is the role grid; there are up to six steps. It ends on "You're all set" and a button reading "Enter SCRBRD", which on a live server sends a request and returns the person to sign-in. | `OnboardingFlow.jsx:217-226`, `:228`, `:122-127`, `:361-389`, `:412`, `:161-172`; `App.jsx:287` |
| B3 | Its last step **promises screens the person will not have**: a parent is told about Match Centre and Logistics, a pupil about Analytics, Training and Injuries. Their apps are Home, Matches, Notices, Family and Home, Matches, Passport, Me. | `OnboardingFlow.jsx:187-195`; `roles.js:332-337` |
| B4 | It draws from the 1.0 alias names `D.indigo` and `D.violet`, which now point at `T.brand.blue` and `T.sport.fielding`. No off-palette colour, but it is the old look: a blue-to-violet progress bar and a glass panel. The sign-in page sets its fonts by name, not by type role. | `OnboardingFlow.jsx:207`, `:236-241`; `design/tokens.js:642-643`; `LoginPage.jsx:220-221` |
| B5 | The sign-in page greets everyone with "Welcome back" and shows nothing of the product. | `LoginPage.jsx:220` |
| B6 | The no-school screen has the right rules (it assigns nothing, looks no child up, says the same sentence whoever the child is) and the staff register lets a listed member of staff straight in. But it **asks for a school and who you are before showing anything**, and a school that is not listed is a dead end. | `NoSchool.jsx:13-32`, `:99-108`, `:179-203`, `:213-216`, `:186`, `:194` |
| B7 | **A new account cannot bowl a ball.** The scorer's home is drawn only for an account that already holds the right to start scoring; the no-school screen has no door to the pad; a Pilot Match is offered only to an account SCRBRD has granted, and a Practice Match can never become one. | `App.jsx:564-565`; `NoSchool.jsx` (no pad entry); `lib/scorerDay.js:296-318`; `lib/pilot.js:28-34` |
| B8 | The pad can already send a scorer to sign in and bring him back with nothing lost. | `App.jsx:526`; `LoginPage.jsx:222` |
| B9 | A parent's link is verified by the office, and the terms she agrees to exist as approved text with a version. But **nobody tells her the office has answered**: SCRBRD sends no email. She finds out by signing in again. | `lib/guardianLink.js:1-21`, `:35`; `LoginPage.jsx:113-115` |
| B10 | The public home page opens on a film. The live strip follows it, and "Follow a match" is offered only when a strip exists. A school that wants in is given an email address. | `home/main.jsx` (`Hero`, then `LiveStrip`); `home/sections/Hero.jsx:100-101`; `home/sections/Schools.jsx:18-21` |
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
  flow is retired from the live site (Q12). Nobody is ever asked "what's your role?".
- **The no-school screen becomes a home.** It is the Today of an account with no school,
  in the day sheet's order: *Now* (a match this phone is scoring, if any), *Start a match*,
  *Join a school*, *Your requests*, and "Worried about a child?" last, as it is now.
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
| A listed fixture is **live** | The `Board` of that match, black, with its status sentence and "Watch". The film plays under it (Q8) |
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
| 3 | He taps Follow | A Google sign-in, with the privacy paragraph on the same screen | Following has to be kept against someone | His Today: the followed school's live match first, then today's, then results (Q9) |

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
| 4 | Set-up | The two sides' names and the overs. **No player names**: the pad scores on positions ("Home No. 3"), words it already has (`lib/pilot.js:36-38`) | The least a scoreboard needs | The toss, then the pad |
| 5 | **The first ball** | Nothing | | A real `Board` that moves; the match on his home under "Now"; for a Pilot Match, a live link to share |
| 6 | At the result (never during play, §1a) | "Scoring for a school? Join it" | He has seen what it is | The join form; staff on the register are in at once, others send a request |

Whether step 3 offers a **Pilot Match** (sent to SCRBRD) or a **Practice Match** (this
phone only) to an account with no school is Q11. Today it can offer neither (B7). Whether
the set-up lets every name be skipped is to be confirmed at build. The words the walks
assert stay as they are: "Start Pilot Match", "Start Practice Match", "stays on this
phone", "Resume scoring".

A scorer the school **appoints** goes straight to his real home: Today, with "Appointed
to score" on the fixture and what is missing before the toss (`lib/scorerHome.js`). A
**pupil who scores** gets the same block inside his own Home (Q3).

### 2.6 Parent

| Step | Sees | Asked | Why then | Gets before the next ask |
|---|---|---|---|---|
| 1 | The school's letter or a group message links to the home page or a live match | Nothing | | The score, as any spectator |
| 2 | "My child plays" | Google, or a code from the office | The school needs to know who is asking | The no-school home, opened on Join |
| 3 | Join: the school (filled in when there is only one), "I am a parent or guardian" | The child's name, her relationship, his year: free text, no lookup, no "found" | The office does the matching; a lookup would list every child at the school (SCRBRD-140 §5.3) | "Sent to the school. Somebody there will answer." Her request, with its state |
| 4 | **Waiting.** Her home shows the request, what happens next in one line, and the school's published matches as a spectator sees them | Optionally: "Tell me when the school answers" (a phone notice with no child's name) | The wait is the weak point of this run (Q13) | **The terms, to read now**, marked "You will be asked to agree once the school has checked your link" (Q13). Health monitoring is said to be separate and off, as now (`NoSchool.jsx:259-260`) |
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
(Q14), and its first office account is enrolled with a code. Its first Today is in the
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
(`NoSchool.jsx:194`). After: "Ask SCRBRD to add my school", and meanwhile "Start a match" (Q14).

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
| Spectator, signed out | Yes: the match | 0 | Five seconds on the home page depends on Q8 |
| Spectator, following | Yes | 1 (Google) | Needs Q9 |
| Scorer | The door, then the first ball after one ask | 1 (Google), then two team names and the overs | **Fails today** (B7); needs Q11 |
| Parent | The score, yes. Her child, no: **a wait of a school day or more** sits between asking and seeing | 3 (Google; the child, in free text; the terms) | The wait cannot be designed away. It is the register check. Q13 softens it |
| Coach, team manager on the register | Yes | 2 (Google, the school) | A coach not on the register waits, as a parent does |
| The office, director | Yes, once the platform has added the school | 1 | A school not yet on SCRBRD waits on a person (Q14) |
| Pupil | Yes | 1 (a code) | None, once the office has enrolled him |
| Platform admin | Yes | 1 | None |

---

## Questions from sections 1 and 2

Each gives the finding first, then the recommendation. The lead turns these into Kameel's questions.

| # | Finding | Question | Recommendation |
|---|---|---|---|
| Q1 | Staff see 17 to 22 menu entries; the homes pattern covers three domains (A2, A4). | Adopt the homes of §1.3 as the whole menu, with the words Today, Matches, Team, Logistics, School and Platform (in place of Dashboard, Match Centre, Squad, Staff, Pitch Deck)? | **Yes.** At most five entries for anyone at a school, all of it on a phone's bar, no drawer. |
| Q2 | Seventeen destinations stop being menu entries (§1.5). Their routes and views stay, but `nav-news`, `nav-calendar`, `nav-readiness` and the rest leave the menu, and a walk that taps one must open the home's section instead (`home-<home>-section-<key>`, as `HomeBar` names them). The pad's ids and the walks' asserted words are untouched. | May menu test ids change for folded destinations? | **Yes**, as happened to Leagues. Haiku lists every walk that taps a folded `nav-` id before any build. |
| Q3 | A pupil or a parent who also scores loses the four-item app and gets a staff menu of up to 18 (A8). | Should holding `scorer` beside a persona keep the persona's app, with scoring as a block on Home and on the appointed match? | **Yes**, and no fifth bar item. It changes `personaFor`, so Opus builds it. What a pupil scorer may read is unchanged and still the server's. |
| Q4 | Team gathers six sections for a coach (§1.3). | Six sections in one home, or Training (with Skills) as a home of its own? | **One home.** A separate home takes a director to six entries and brings the drawer back. Test it in the pilot. |
| Q5 | Only the Match Centre has an address; a player, a team and a ground cannot be linked to (A6). | Give each an address under `/app`, by id? | **Yes**: an id only, never a name, opened only for a signed-in reader the server allows. Without it "reached from the thing it belongs to" cannot be built. |
| Q6 | Safeguarding moves to the header for everyone. A Safeguarding Officer's work is that screen. `SAFEGUARDING_DSO.md` was not on this pass's reading list. | Should a Safeguarding Officer land on Safeguarding, as a driver lands on his day? May the header show him a plain mark (no count, no name) when something is unread? | **Land there: yes.** The mark: only if it fits the safeguarding design. Check that document before deciding. |
| Q7 | "To resolve" and "Officials" are offered on the capability to read a fixture, so a spectator has both (A7). | Should "To resolve" be drawn only for someone who can act on at least one kind of row? | **Yes.** It is a change to the capability map, so it goes to Opus, with a `db/99` check that nothing widens. |
| Q8 | The public home page opens on the film whatever is happening (B10). | When a listed match is live, should its `Board` be the first screen, with the film under it? | **Yes.** The state comes from the public read the page already makes. It asks the 6 Nov direction for the hero to give way while a match is on. |
| Q9 | "Follow this match" is not built, and the only way to follow a school is to request the `spectator` role and wait for the office (SCRBRD-140 §5.1). | Should following be a personal list of schools whose **public** matches lead a person's Today, with no role and no office step? | **Yes.** It opens no new read. The `spectator` request stays for the signed-in view. |
| Q10 | A reload signs everyone out by design, so every cold open is the sign-in screen and the five-second target fails there (§1.10). | Keep that, and count five seconds from the first signed-in screen? | **Keep it.** Measure from the first signed-in screen. Ask Opus whether the Google session may fetch a fresh token on open with no tap, which SCRBRD-140 §2.2 already describes; if so a cold open costs a moment, not a screen. |
| Q11 | A new account cannot reach the pad, and a Pilot Match needs a grant from SCRBRD (B7). | Who may start a match with no school? | **A Practice Match for any signed-in account with no school** (it never leaves the phone). **A Pilot Match for accounts Kameel grants** while R0 runs; widen at R1, with a limit on open matches per account. Typed names stay optional. |
| Q12 | Two sign-up doors ask different questions; the older one asks for a role first and promises screens people will not have (B1 to B3). | Retire the older flow from the live site? | **Yes.** One door: Google or a code, then the no-school home. The demonstration keeps its demo accounts on the sign-in page. |
| Q13 | A parent waits for the office with nothing to read, and nobody tells her when it answers (B9). | May a waiting parent read the terms (without agreeing), and be told by a phone notice with no child's name when the office answers? | **Yes to both.** The text is not secret, and reading it early makes her agreement better informed. The school's letter should also say "open the app again in a day or two". |
| Q14 | A school that is not listed is a dead end in the join form; the home page gives schools an email address (B6, B10). | What does someone from an unlisted school get? | **"Ask SCRBRD to add my school"**: a short note to the platform (the school's name, its town, their job), answered by a person, and a match to score meanwhile. Who answers, and how fast, is yours to say. |
| Q15 | Health-monitoring consent sits on the third tab of Settings, and the join form tells parents it is "under Settings, Me" (A9; `NoSchool.jsx:259-260`). | Move it to Family, on the child's file, beside the terms and the public-name switches? | **Yes.** The consent and its record do not change, only where it is found. The join form's sentence changes with it. The agreed terms text (`popia-2026-01`) does not name the place and is not touched. |

---

## 3. Stats and moments

To be written by the next pass. Not part of sections 1 and 2.

## 4. Slices, in build order

To be written after section 3. Not part of sections 1 and 2.

## 5. Questions for Kameel

To be written by the lead, from "Questions from sections 1 and 2" above and from sections 3 and 4.
