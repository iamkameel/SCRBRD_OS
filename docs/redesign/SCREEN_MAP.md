# Screen Map — what the product needs, read from AntiGravity

Source: AntiGravity (AG) at `/home/user/scrbrd_antigravity`, 142 page routes under
`src/app/**/page.tsx`, checked out read-only. This document does not copy AG code —
every row is a paraphrase of the job a route does, written from reading the route,
its `export default function` name, and (where the name didn't say enough) its
top-level imports and markup.

OS status is verified against this repo, not guessed: `apps/web/src/design/roles.js`
(the capability→nav map, `NAV_CAPABILITY`/`NAV_GROUPS`), `apps/web/src/data/roadmap.js`
(the shipped/planned ledger, which itself cites the walks that prove each "shipped"
claim), `packages/policy/src/{roles,capabilities,tables}.mjs`, the view files under
`apps/web/src/views/` and `apps/web/src/scorer/`, and the write modules under
`services/api/write/`.

**Counts:** 142 AG routes → 61 distinct jobs (after collapsing add/edit/[id]/redirect
variants and separating out 16 routes that are dev tools, marketing/pitch pages, or
stubs rather than jobs). Of the 61 jobs: **34 has**, **11 partial**, **16 missing** in OS.

---

## 1. Dev tools, marketing, stubs, and redirects (not jobs)

These AG routes exist to build/demo/pitch AntiGravity itself, or are placeholders.
They are listed so nobody later mistakes them for a job the redesign must cover.

| AG route | What it actually is |
|---|---|
| `src/app/page.tsx` | Marketing landing page |
| `src/app/pitch-deck/page.tsx` | Investor pitch deck |
| `src/app/features/page.tsx` | Marketing features list |
| `src/app/ecosystem/page.tsx` | "Platform Ecosystem & AI Architecture" marketing page |
| `src/app/roles/page.tsx` | Marketing copy describing roles ("System Architect — God-tier access, bypass all restrictions"), not a working role screen |
| `src/app/operating-system/page.tsx` | Kitchen-sink showcase bundling DRS review, weather widget, commercial view, multi-sport engine, parent portal and historical archive on one page — a demo, not a job |
| `src/app/admin/system/page.tsx`, `src/app/architect/page.tsx` | "System Architect & Platform Audit Hub" — dev/ops dashboards for AG's own build |
| `src/app/seed/page.tsx`, `src/app/migrate/page.tsx` | Seed/migration dev tools |
| `src/app/data-management/page.tsx` | Dev tool: generate sample data, export/import all data, delete all data |
| `src/app/testing-arena/page.tsx` | Dev test harness |
| `src/app/sports/multi-sport/page.tsx` | Marketing page for the multi-sport story |
| `src/app/matches/page.tsx` | Redirects to `/fixtures` |
| `src/app/live-scoring/page.tsx` | Redirects to `/fixtures` |
| `src/app/(authenticated)/ai-scouting/page.tsx` | Redirects into `/scouting` |
| `src/app/help/page.tsx` | Static help copy |
| `src/app/scoring-zones/page.tsx` | Explicit placeholder ("Scoring Zones Placeholder") |

---

## 2. Jobs, by person and match-day timeline

Status legend: **has** = a working OS screen/API exists; **partial** = the data
model/API exists but the screen is thin, stubbed, or missing a step; **missing** =
nothing in OS today.

### Public / prospective school / spectator

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Before season | Browse leagues, divisions, schools | `browse-leagues`, `browse-divisions`, `divisions`, `directory/leagues/[id]`, `schools`, `schools/[id]` | **missing** — OS has no public, unauthenticated directory; `LeagueView`/`CompetitionsView` are behind sign-in |
| Match day | Watch a live match (no login) | `live/[fixtureId]` (`PublicLiveMatchCenter`) | **missing** — OS's live scoring fold (`up3`, Match Centre) is read behind role capabilities, not exposed publicly |
| Match day | Broadcast overlay (score bug for a stream/OBS) | `broadcast/[matchId]` (chroma-key lower-third overlay) | **missing** — no broadcast-overlay output anywhere in OS |
| Reference | Laws of the game | `rulebook` | **has** — `apps/web/src/views/RulebookView.jsx`, clauses drawn by category/severity/age (`up15`) |

### School office / admin (schooladmin, sportsadmin, principal)

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Before season | Onboard a school, set up seasons | `schools/add`, `seasons`, `seasons/add`, `seasons/[id]/edit` | **has** — season/competition CRUD via `CompetitionsView`/`LeagueView`; `up11` Season History Archive is shipped |
| Before season | Manage staff & pupil records | `people`, `people/add`, `people/[id]`, `people/[id]/edit`, `coaches`, `coaches/add`, `coaches/[id]` | **has** — `StaffView.jsx`, `ProfilesView.jsx` |
| Before season | Manage teams/squads | `teams`, `teams/add`, `teams/[id]`, `teams/[id]/edit`, `teams/[id]/roster` | **has** — `SquadView.jsx` |
| Before season | Register/manage players | `players`, `players/add`, `players/[id]`, `players/[id]/edit` | **has** — `ProfilesView.jsx` |
| Before season | Kit / equipment register | `equipment`, `equipment/add`, `equipment/[id]/edit` | **has** — `up19` Officials & Kit Registers, shipped |
| Fixture set-up | Create a single fixture | `fixtures/create`, `fixtures/edit/[fixtureId]` | **partial** — `fixture.create` capability is checked and gates a "+ Schedule Match" button in `MatchCentreView.jsx:43`, but the button's `onClick` is a no-op (`onClick={()=>{}}`); no create/edit form exists anywhere in `apps/web/src` |
| Fixture set-up | Bulk-create a season's fixtures | `fixtures/multi-create` | **missing** — no batch-fixture path at all |
| Fixture set-up | Run a league/competition (standings, bracket) | `leagues`, `leagues/add`, `leagues/[id]/edit`, `leagues/[id]/standings`, `leagues/[id]/bracket`, `competitions`, `browse-leagues` | **has** — `LeagueView.jsx`, `CompetitionsView.jsx` |
| Fixture set-up | Inter-house competitions | `inter-house`, `schools/[id]/inter-house` | **missing** — no inter-house/house-competition concept in OS's data model or nav |
| Anytime | Reporting / data export | `reports` ("Sportsmaster Reporting & Export Hub") | **missing** — no export/reporting screen; `up10` (PDF scorecard export) is `planned`, not built |
| Anytime | Finance / invoicing | `financials`, `financials/add`, `financials/[id]/edit` | **missing** — `up13` Invoicing & Subscriptions is `planned`: `invoice.read`/`invoice.manage` capabilities are granted to schooladmin/principal/finance roles with **no table behind either** (roadmap.js's own words) |
| Anytime | Sponsor register | `sponsors` | **has** — `SponsorsView.jsx`; read/manage split on `sponsorship.read`/`.manage` |
| Anytime | Role & permission management | `user-management` | **has** — `ManagementView.jsx`, `user.role.assign` |
| Anytime | Module on/off switches | *(no direct AG equivalent — OS-specific)* | **has** — `up20` Module Switches, shipped, `ModulesView.jsx` |
| Anytime | Platform/school audit trail | `audit-log` | **has** — `up21` Who Read What, shipped, under Settings › School |
| Anytime | School admin settings | `settings` | **has** — `SettingsView.jsx` |
| Anytime | Messaging / inbox | `inbox` | **missing** — `up9` In-App Parent Messaging is `planned`, nothing modelled |
| Anytime | Season awards / MVP | `awards` (mock MVP calc) | **partial** — `up16` Caps, Honours & Milestones is shipped (colours, honours, captaincy, milestones on the player passport), but there is no season-end "awards ceremony" roll-up screen naming a Player/Bowler/Fielder of the Season the way AG's page sketches |
| Anytime | School sport calendar (exam clashes etc.) | `strategic-calendar`, `planner` (coach-side; see below) | **has** — `CalendarView.jsx` for fixtures; **missing** the exam-clash/strategic overlay AG's page adds |

### Director of sport

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Anytime | Cross-team command dashboard | `director` ("Director Command") | **partial** — no dedicated director dashboard view, but the `directorofsport` role is a first-class policy role (`packages/policy/src/roles.mjs`) with its own capability set reaching Match Centre, discipline (`up51`), dossier (`up5`) and the rest; the "one screen that rolls it all up" AG sketches doesn't exist as a single view |

### Coach / assistant coach / team manager

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Before season | Player development plans, skill assessments | `coach/development`, `development/squad`, `development/assessments` | **has** — `SkillsView.jsx`, `TrainingView.jsx` |
| Week before | Plan training sessions, drills | `development/training`, `drills`, `planner` | **has** — `TrainingView.jsx`; `up15` Bowling Workload & Welfare (spells, breaches, directives) is shipped on this screen |
| Week before | Select/name the team sheet | `prematch-team/[fixtureId]` | **has** — squad naming via `SquadView.jsx`/roster write API, surfaced as the "Team sheet" readiness slot in `duties.jsx` |
| Match day (pre-match) | Match-day logistics/readiness (ground, transport, officials, team sheet, all in one place) | `match-operations`, `matches/[id]/manage`, `matches/[id]/pre-match`, `prematch` | **has** — `duties.jsx` (`DutyRoster`, "READINESS, NOT NAMES") for one fixture, and `ReadinessOverview.jsx` (SCRBRD-062) for several fixtures at a glance |
| After | Post-match recap | `recap` | **missing** — `up1` Post-Match Report is `planned` |

### Scorer

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Before match | Scorer register / accreditation | `scorer-profiles`, `scorer/[scorerId]` | **has** — `OfficialsView.jsx`, backed by `db/08` accreditation ladder and `officials-register-api.mjs` |
| Match day (toss) | Match/team/toss/opening setup | (part of `matches/[id]/pre-match` in AG) | **has** — `apps/web/src/scorer/setup.jsx`, explicit `STEPS = ["Match","Team 1","Team 2","Toss","Opening"]` |
| Match day (scoring) | Live ball-by-ball scoring console | `matches/[id]/score`, `matches/[id]/scoring-hub` | **has** — `apps/web/src/scorer/{engine,scoring,panels,sheets}.jsx`; `up3` Live Score Sync (offline queue, handover, quarantine, reduced-overs replay `up22`) is shipped and is the most heavily-tested part of OS (`packages/scoring/`) |
| Match day (scoring) | Voice-driven scoring | `scoring/voice` | **missing** — no voice input path anywhere in OS's scoring engine |
| Match day | DLS / net-run-rate calculators | `match-calculators` | **partial** — DLS target recompute exists as part of `up22` (reduced-overs replay, entered by the umpire and replayed by the reducer), but there is no standalone "what-if" calculator screen a scorer/umpire can use before publishing a decision, the way AG's page is framed |
| After | Scorecard | `scorecard/[fixtureId]` | **has** — drawn from the same read Match Centre uses |
| After | Analytics charts (wagon wheel, spider chart) | `wagon-wheel`, `spider-chart` | **has** — `up2` Shot Pattern Wagon Wheel, `up45` Contact Density Map, `up46` Directional Reach Chart, `up48` Dismissal Analysis, all shipped and drawn on the player profile, not as standalone pages |
| Planned analytics gap | Pitch map (line/length) | *(no direct AG route; adjacent to wagon-wheel)* | **missing** — `up18` Pitch Map is `planned`, "the only chart form genuinely missing" per roadmap.js |

### Umpire / match official

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Before match | Umpire register / accreditation | `umpire-profiles`, `umpire/[umpireId]` | **has** — same `OfficialsView.jsx` register as scorers |
| Week before | Appoint officials to a fixture | *(covered inside `match-operations` in AG)* | **has** — `duty-authority-api.mjs`, appointment lifecycle in `duties.jsx`/`OfficialsView.jsx` |
| Match day | Decision review (DRS-style) | `umpire-review` | **has, but switched off by design** — `up24` DRS Review Panel is built end-to-end (Law 36 components, always says how the decision was known) but is kept off for every school via a platform module switch (`drs_review` in `packages/policy/src/modules.mjs`, enforced again by a Postgres trigger) until real ball-tracking exists — a deliberate call-out that a person's judgement should not wear the visual language of a measurement |
| After | File a disciplinary/conduct matter | *(no direct AG route — AG has no discipline concept)* | **has, OS-only** — `up51` Disciplinary Record; filed by the umpire from Match Centre or the school, read by head/office/director of sport, staff-only for now by product decision even though the DB would let a pupil read his own — **sensitive** (named-minor conduct data) |

### League / competition admin

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Before season | Manage a competition, rankings | `competitions/rankings`, `rankings`, `(authenticated)/rankings` | **partial** — `LeagueView.jsx`/`CompetitionsView.jsx` cover standings; no cross-competition "global rankings" screen the way AG's `GlobalRankingsClient` frames it |
| Anytime | Opposition scouting dossier | `scouting/dossier`, `(authenticated)/scouting` | **has** — `up5` Opposition Dossier: squad + ball-log-derived figures inside a 5-day pre-match window (db/46, SCRBRD-091), floor of 30 balls before a figure is shown, every cross-school read logged |
| Anytime | AI query/analysis over the data | `analysis` | **has** — `up47` Stats-Magic (`contextFrom()` folds `/read/career` in, never fabricates a zero for a batter never dismissed) |
| Anytime | Player/team comparison tools | `players/compare`, `teams/compare` | **missing** — no head-to-head player/team comparison screen; the closest is the Head-to-Head figure inside the Opposition Dossier, which is fixture-derived, not a general compare tool |

### Parent / guardian

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Match day | Push alerts when something happens to their child | *(covered inside `community` in AG)* | **has** — `up4` Parent Broadcast Alerts, per-person and permission-scoped; the prompt itself names nobody |
| Anytime | Parent portal (children, notification prefs) | `community` (uses `MOCK_CHILD_PROFILES`, `MOCK_NOTIF_PREFS` — itself a mock in AG) | **partial** — notification delivery exists (`up4`) but there's no single parent-facing "my children" hub screen; a guardian reads through the ordinary nav scoped to their linked player(s) |
| Anytime | Newsfeed | `newsfeed` | **has** — `NewsView.jsx`, `db/12_news.sql` |
| After | Guardian link management (grant/withdraw scouting access etc.) | *(no AG equivalent)* | **has, OS-only** — guardian-link route in `services/api/write/scouting-api.mjs` per roadmap comments |

### Player

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Anytime | Own profile: caps, honours, stats, career history | `players/[id]` (own), `players/[id]/history` | **has** — `ProfilesView.jsx`, `up16` recognition, `up47`/`up48` career stats |
| Anytime | Own medical/PII record | *(rolled into AG's flat `/medical`)* | **partial, by design** — OS deliberately splits `medical.status.read` (availability only) from `medical.nature.read` (clinical detail, a higher sensitivity tier); a pupil's own read of his own file is not yet drawn (see Medical staff row) |

### Medical staff

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Week before / anytime | Injury tracking, rehab phases | `medical` | **has** — `InjuryView.jsx` (phases: Immobilisation → Reconditioning → Strengthening → Return to bowl/bat → Cleared) |
| Week before | Medical clearance register | *(rolled into AG's `/medical`)* | **has** — `up12` Medical Clearance Workflow, shipped |
| Sensitive gap | A pupil reading his own clinical detail | *(rolled into AG's `/medical`)* | **missing, flagged sensitive** — `medical.nature.read` exists as a capability tier above plain availability, but nothing today grants or draws a self-read of a minor's own clinical detail; this is a data-model line OS drew on purpose and should be decided again explicitly, not inherited from AG's flatter model |

### Transport coordinator / driver

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Week before | Plan trips, assign drivers/vehicles | `transport` ("Transport & Fleet Operations Hub") | **has** — `LogisticsView.jsx` |
| Match day | Driver's own trip (their assigned run) | `transport/driver`, `transport/driver/[tripId]` | **partial** — the `driver` role holds `transport.drive` ("operate an assigned trip") and can report on a trip through the same `LogisticsView.jsx` the coordinator uses (`transport.manage || transport.drive` gate); there is no driver-specific mobile/simplified screen the way AG gives the driver their own dedicated page |

### Groundskeeper / facilities

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Week before | Ground/pitch condition, bookings | `facilities`, `fields`, `fields/[id]`, `fields/[id]/edit`, `fields/new`, `grounds` | **has** — `FieldsView.jsx` (`facility.manage`); surfacing includes last-mown date, surface type, outfield grade, mow height, drainage |
| Week before | Groundskeeper register | `groundskeeper-profiles`, `groundskeepers`, `groundskeeper/[groundskeeperId]` | **has** — staff records via `StaffView.jsx`, ground-report authorship via `facility.manage` |
| Match day | Groundskeeper's own mobile checklist | `facilities/groundskeeper`, `groundskeeper/mobile`, `groundskeeper/dashboard` | **missing** — `FieldsView.jsx` is one desktop-form screen for whoever holds `facility.manage`; there is no groundskeeper-specific, mobile-first day-of view the way AG gives this role three of its own routes |

### Sport hubs outside cricket

| Phase | Job | AG routes | OS status |
|---|---|---|---|
| Anytime | Athletics meet management | `athletics` (`AthleticsMeetHubView`) | **missing** — OS's scoring engine, roadmap and views are cricket-specific throughout; `SPORT_ICON`/`useSports()` in `MobileNav.jsx` list other sports as enabled/disabled flags from the database, but no athletics screen exists |
| Anytime | Swimming gala management | `swimming` (`SwimmingGalaHubView`) | **missing** — same as above |
| Anytime | Multi-sport engine/hub | `sports` (`MultiSportHub`) | **missing** — `useSports()` is the only multi-sport plumbing in OS; nothing draws a hub |

---

## 3. Gaps worth deciding

Grouped by theme, one line each on who needs it and why. No implementation plans.

**Fixture creation is a stub, not a gap in scope.** The "+ Schedule Match" button
schooladmin/sportsadmin see in `MatchCentreView.jsx` is wired to a real capability
check but does nothing (`onClick={()=>{}}`). Every other fixture-set-up job (leagues,
standings, brackets, season history) is built. This is the single highest-leverage
gap: nobody can create a fixture through the OS UI today.

**Money is entirely unbuilt.** Invoicing/subscriptions (`up13`) is `planned` with
capabilities already granted and no table behind them; sponsor read/manage exists but
there's no reporting/export screen for a bursar or director of sport to hand to a
finance committee. Needed by: school admin, finance role, sponsorship role.

**Public-facing / unauthenticated screens don't exist.** League/division browsing,
a public live-match view, and a broadcast overlay are all things AG builds for
spectators, parents without accounts, and media, and OS has none of them — everything
in OS sits behind a signed-in role. Needed by: parents/spectators without accounts,
league admins wanting a public results board, media wanting a stream overlay.

**Voice scoring and a standalone match calculator are missing from the scoring
toolkit.** Not core to correctness (the DLS engine itself exists inside the
reduced-overs replay), but scorers/umpires have no quick what-if tool independent of
committing a decision. Needed by: scorer, umpire.

**Post-match and season-level write-ups are unbuilt.** Post-Match Report (`up1`) and
a season awards/MVP roll-up are both `planned`/absent, though the raw data (ball log,
recognition ledger) already exists. Needed by: coach, director of sport, parents.

**Cross-team/cross-sport comparison and rankings are thin.** Player/team compare
tools and a cross-competition rankings board don't exist; the closest OS gets is the
fixture-scoped Head-to-Head inside the Opposition Dossier. Needed by: analyst, scout,
league admin.

**Two roles have no screen shaped for how they actually work.** The driver and the
groundskeeper both hold real capabilities (`transport.drive`, `facility.manage`) but
share the coordinator's desktop screen rather than getting a simplified, mobile,
day-of view. Needed by: driver, groundskeeper — likely a genuine UX gap, not a
missing capability.

**Non-cricket sports have no screens at all.** Athletics and swimming hubs exist in
AG; OS's `useSports()` plumbing can flag a sport as enabled but nothing is drawn for
it. Needed by: any school running athletics/swimming/rugby/hockey/netball
alongside cricket — a scope decision (is OS cricket-only, or genuinely multi-sport?)
more than a screen gap.

**Sensitive — flagged explicitly.** Two items above touch minors' medical/PII/
discipline data and deserve a deliberate decision rather than inheriting AG's flatter
model:
- A pupil reading his own clinical detail (`medical.nature.read` vs `medical.status.read`)
  is a capability tier OS already drew a line around; nothing grants or draws it yet.
- The Disciplinary Record (`up51`) is staff-only "for now, by product decision" even
  though the database would let a boy read his own matter — worth revisiting
  explicitly rather than by default, especially since the league holds read access
  through the API with no roster to open a profile from.
