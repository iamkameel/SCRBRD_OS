# SCRBRD OS — Role-Based Dashboard Information Architecture

**Version:** 1.1 · 11 November 2026  
**Status:** Product requirements proposal from Kameel, 11 Nov 2026; not a claim that every widget or endpoint exists. Committed by the lead with §3E corrected to Kameel's 11 Nov decisions and two lines on investor and revenue material removed (public repository).  
**Scope:** School cricket OS, across platform operations, schools, teams, matches, player development, welfare, logistics, finance and public consumption.

### Changes in v1.1

v1.0 was drafted in ChatGPT. v1.1 applies the gap analysis held in the *SCRBRD user dashboards: definition brief* (Gap analysis tab), checked against `SCRBRD_OS` at commit `65f52f02`.

**Decisions taken 11 November 2026 (Kameel):**

1. **Canonical codebase is `SCRBRD_OS`.** Its 29 bundles are the role inventory. The `scrbrd` repo (Next.js, D1) is the deployed reference; its 19 roles are mapped onto the 29 in §2.1.
2. **R0 is the scorer and the spectator only.** The first pilot is Kameel scoring Pilot Matches alone, with no school accounts. The one-school set becomes R1 (§9).
3. **No sponsor slots on a pupil's own home or in work modes, for now** (§7.1).

**Corrections against agreed decisions:**

- The canonical layout no longer has a header panel and a KPI tile row. The day sheet is the shell, per `docs/redesign/DESIGN_DIRECTION.md` §1, §5 and decision 5 (§4).
- Fixture readiness is shown as chips, a word and a state each, never a percentage (§4, §6).
- The guardian home shows one section per child, not a selector (§2, §3E).
- `scout` and `unionselector` are marked V2: the scout layer is deferred.
- `clearance.manage` is held by principal, director of sport, school admin and DSO; §8 gap 2 now says so.

**Additions from product decisions:** pupil and guest scorers; the Pilot Match; scorer recognition; Player of the Match; paid tiers and sponsor slots; the Player Passport and public profile fields. Each is marked *(v1.1)* where it lands.

## 1. Product decision

**A dashboard is a decision-and-action surface, not a smaller version of the entire application.** The right unit of personalisation is `(person + current assignment + authorised scope + time + workflow state)`, not a simple `role` string.

Each dashboard must answer: **What is happening? What needs my action? What happens next? How are we progressing? Where do I go to act?**

The app's **permission role** controls what may be read/written. A **persona, title, specialism or captaincy designation** determines what is promoted in the interface. These must remain distinct.

### Priority levels

| Level | Definition | Typical surface | SLA/behaviour |
|---|---|---|---|
| P0 — Critical | A time-sensitive, safety-sensitive or workflow-blocking situation the user is authorised to resolve | One prominent action card/inbox item | Display first; clear actor, deadline and action; no sensitive detail to unauthorised viewers |
| P1 — Important | The next commitments, assigned tasks, selections and confirmations | Next-fixture card, 7-day list, to-do list | Display without scrolling where practicable |
| P2 — Insights | Progress and comparative performance for the user's remit | A short line of figures or one explanatory chart, one tap from home *(v1.1: no KPI tile row)* | Include context, denominators, time range and data freshness |
| P3 — Reference | Historical records, full scorecards and specialist analytics | Links to dedicated modules | Search, drill down, save views; not a home-page data dump |

**Rules:** P0 must be actionable, not simply red. No fictional numbers. A missing event is not a `0`. Privacy is enforced at the server/database; merely hiding a card in React never grants security. Availability, medical status, disciplinary status and safeguarding concern are different confidentiality classes.

## 2. Actual SCRBRD role model

At the time of review, `packages/policy/src/roles.mjs` in `iamkameel/SCRBRD_OS` contains **29 RBAC bundles**: `superadmin`, `platformadmin`, `principal`, `directorofsport`, `schooladmin`, `sportsadmin`, `coach`, `assistantcoach`, `teammanager`, `scorer`, `official`, `player`, `enquiry`, `selfaccess`, `guardian`, `analyst`, `spectator`, `medical`, `fitness`, `finance`, `sponsorship`, `transportcoordinator`, `driver`, `facilities`, `media`, `scout`, `unionselector`, `dso`, `competitionadmin`.

The earlier 16–17-persona proposal is outdated as a permissions inventory. **Do not make 29 distinct interfaces.** Use around eight shared dashboard shells with role-specific widgets and entitlement-driven actions.

Crucial architectural facts from the repository:

- A captain or vice-captain is an honour/designation, **not** a new RBAC role. Show a captain's tactical view as an additional *persona overlay* only when the designation exists; don't widen access.
- Coaches are **team-scoped**. They see medical *status and nature* for their own side, not confidential clinical notes.
- `player` is team-scoped. `selfaccess` is subject-scoped for the person's own sensitive file. A player's team access is not permission to inspect another child's development or medical details.
- `guardian` is subject-scoped to the linked children, potentially across schools. *(v1.1)* The guardian home shows one section per child, never one merged view (`DESIGN_DIRECTION.md` §6); a child selector belongs inside modules such as invoices or transport. No unlinked child data.
- `spectator` has no general `player.profile.read` permission. Public information and licensed media must not rely on a hidden player API.
- A scorer can **request** amendments but cannot approve their own locked-score amendment.
- `dso` safeguarding is a strictly segregated cockpit and its concern details must not seep into leadership, school admin or general platform dashboards.
- `finance` and `sponsorship` are distinct roles. A user can hold both explicitly, but no default cross-over of pupil invoices and commercial contract terms.
- `enquiry` is a time-limited person-specific permission; it is **not** a standalone homepage.
- `platformadmin` should operate the platform without automatic school clinical-record access; `superadmin` is a recovery key and not the everyday operations persona.
- *(v1.1)* One person can hold several bundles at once. A pupil scorer typically holds `player`, `selfaccess` and `scorer`; a guest scorer holds `scorer` assigned to one fixture only. Most scorers are expected to be under 18.

### 2.1 Mapping the `scrbrd` catalogue onto `SCRBRD_OS` *(v1.1)*

| `scrbrd` role (`lib/rbac.ts`) | `SCRBRD_OS` bundle |
|---|---|
| `platform_admin` | `platformadmin` |
| `tenant_admin` | `schooladmin` — to confirm; `SCRBRD_OS` has no separate tenant role |
| `school_admin` | `schooladmin` |
| `director_of_sport` | `directorofsport` |
| `competition_admin` | `competitionadmin` |
| `coach` | `coach` |
| `assistant_coach` | `assistantcoach` |
| `team_manager` | `teammanager` |
| `scorer` | `scorer` |
| `umpire`, `match_official` | `official` |
| `player` | `player` + `selfaccess` |
| `parent_guardian` | `guardian` |
| `medical_staff` | `medical` |
| `scout` | `scout` (V2) |
| `finance_officer` | `finance` |
| `driver` | `driver` |
| `groundskeeper` | `facilities` |
| `transport_coordinator` | `transportcoordinator` |

`SCRBRD_OS` bundles with no `scrbrd` equivalent: `superadmin`, `principal`, `sportsadmin`, `enquiry`, `analyst`, `spectator`, `fitness`, `sponsorship`, `media`, `unionselector`, `dso`.

Sources: [SCRBRD RBAC roles](https://github.com/iamkameel/SCRBRD_OS/blob/main/packages/policy/src/roles.mjs); [Architecture](https://github.com/iamkameel/SCRBRD_OS/blob/main/docs/ARCHITECTURE.md); [ADR 0003](https://github.com/iamkameel/SCRBRD_OS/blob/main/docs/adr/0003-job-titles-are-not-roles.md); [ADR 0002](https://github.com/iamkameel/SCRBRD_OS/blob/main/docs/adr/0002-coach-medical-overview.md).

## 3. Role inventory — Dashboard requirements

P0 means *when an applicable item exists*, not that every role must be shown an urgent warning.

### A. Platform and governance

| Role | P0: critical / immediately actionable | P1: important / next | P2: trends and context | Main action |
|---|---|---|---|---|
| `platformadmin` | Failed match sync at multiple tenants; access incident; service unavailable; blocked school onboarding | Tenants needing support; live match count; support engagements; pending configuration | Activated schools, first-match activation, weekly active scorers, score-event integrity, reliability | Resolve incident; open time-boxed audited support session |
| `superadmin` | Disaster recovery, failed authorisation or platform-wide integrity fault | Health and controls only; recovery tasks | Aggregated health; high-level adoption | Recover platform; not browse children's records by default |
| `dso` | Unread safeguarding disclosure, overdue follow-up, immediate protection escalation | Named case ownership, scheduled actions, adult clearance issues | Restricted process measures only (e.g., unresolved-age count) | Record, escalate, authorise or close via authorised case workflow |

### B. School leadership and administration

| Role | P0 | P1 | P2 | Main action |
|---|---|---|---|---|
| `principal` | Approvals reserved for the principal; serious governance exceptions routed through approved workflows | Whole-school fixtures and highlights, participation, decisions requiring signature | Participation trend, programme results, year/season comparison, facility utilisation, governed spend | Approve/appoint, open strategic programme report |
| `directorofsport` | Clashes; teams missing selection; unavailable facilities/transport; unconfirmed results; staffing/clearance gaps | Seven-day school-wide fixture diary, readiness by team, staffing, venue and travel status | Match completion rate, participation, performance by division, workload and season trends | Resolve clash, publish/update fixture, assign staff |
| `sportsadmin` | Fixtures blocked or missing official/field/transport; readiness anomalies | Scheduling workload, team line-ups, field allocation and transport coordination | Booking utilisation, match execution reliability, workload | Edit fixture, assign official, confirm logistics |
| `schooladmin` | Missing consent/guardian links, invalid imports, expired clearance, missing required details | User invitations, registrations, school modules, season-rollover tasks | Completeness of records, activation, exception counts | Resolve registration, update assignment or consent |

### C. Coaching and team management

| Role | P0 | P1 | P2 | Main action |
|---|---|---|---|---|
| `coach` | Unresolved availability for next fixture, training restriction affecting selection, team sheet due, scorer/handover problem if acting as scorer; *(v1.1)* post-match: Player of the Match to pick, with system suggestions | Squad availability, training plan, next match and opponent, selection readiness | Last five results, batting/bowling/fielding trends, development assessments, workload, attendance | Select XI, plan training, assign player-development action |
| `assistantcoach` | Delegated preparation tasks; restricted player relevant to own side; match scoring duty if assigned | Training execution, availability overview, own-side notes and coaching tasks | Assigned-unit progress, player development context and workload | Submit notes, assist scoring, update delegated tasks |
| `teammanager` | Travel/attendance uncertainty; missing player/guardian confirmation; team-sheet blocker | Next fixture pack, team attendance, transport, training register | Team readiness completion and punctuality (if recorded) | Coordinate team and communications |

**Captain overlay:** display team fixture, XI, personal tactical duties, publicly shareable opposition context, captaincy decisions (*v1.1:* including Player of the Match where the captain picks it) and match-day live cricket information; hide coach-only notes, other players' assessments, health details and confidential feedback. Not a separate RBAC role.

### D. Match day and competition control

| Role | P0 | P1 | P2 | Main action |
|---|---|---|---|---|
| `scorer` | Active session, offline queue not synced, lease/handover conflict, ball correction, scoring dispute | Fixture, toss, XI, playing conditions, bowler limits, next innings/score validation; *(v1.1)* "Start Pilot Match": venue from location, start time, players typed in for both sides; Pilot Matches awaiting promotion | Match-level scoring accuracy and completed assignments; *(v1.1, R3)* scorer profile with points, streak badges and partner rewards suitable for minors, visible only under strict RBAC | Resume score; score next ball; reconcile/handover; *(v1.1)* start or promote a Pilot Match |
| `official` | Required match report or urgent on-field report | Assigned fixtures, venue, playing conditions, participating teams | Reports completed, officiating assignments | File official report; signal/verify match events with scorer |
| `competitionadmin` | Result pending confirmation, contested score amendment, abandoned fixture, ineligible teams/official, knockout dependency | Round schedule, official appointments, points table and outstanding results | Competition progression, standings and net run rate where format applicable | Confirm result, advance bracket, amend fixture/rules within authority |

### E. Player, family and community

| Role | P0 | P1 | P2 | Main action |
|---|---|---|---|---|
| `player` | Availability response due, personally actionable selection/training task, important individual notice | Next match, training, own selection status, own squad news | *(v1.1)* The Player Passport is the centre: own form, strengths, progress, Colours, honours and Player of the Match awards as badges, development goals | Respond to availability; open Passport |
| `selfaccess` | Correct own personal data, own relevant alerts | Personal health, development and restricted records through a deliberate private journey | Personal progress/history | Inspect own file; submit request via permitted workflow |
| `guardian` | Child-specific permission/consent required, urgent transport change, payment due, action requiring guardian response | Per-child upcoming fixtures, transport arrangements, training, school communication | **Own child's** progress and accolades, from that child's Passport; one section per child *(v1.1)* | Consent, respond, arrange own child's transport, pay invoice |
| `spectator` | Match status changed or live match started (informational, not an alarm) | Followed live matches, recent results, next fixtures, competition tables | Public team form and season narratives | Watch live match; follow school/team |

*(v1.1, corrected 11 Nov 2026 by Kameel's decision)* **Public player fields.** What a child shows publicly is `docs/design/PUBLIC_BY_TERMS.md` (approved 11 Nov 2026): by default, after a parent agrees and seven days pass, his initial and surname on finished scorecards and the school's honours board; the live page and the stream caption need their own yes; never an age or a photograph (CLAUDE.md, `docs/policy/PUBLIC_DATA.md`); `player.public.withhold` is honoured; counsel signs off before it ships. **Pilot Match (decided 11 Nov 2026):** the typed-in names go to the server but are never shown publicly; the spectator view of a Pilot Match shows the score and team names only. A retention rule for those names and counsel's view on holding them are needed before R0 ships.

### F. Health, fitness, talent and intelligence

| Role | P0 | P1 | P2 | Main action |
|---|---|---|---|---|
| `medical` | New injury/incident requiring assessment, treatment follow-up | Rehabilitation tasks, injured-player schedule, clinical workload | Return-to-play progression and case trend (confidential) | Record examination and treatment; communicate permitted summary |
| `fitness` | Exceeded training-load threshold or capacity concern backed by evidence | Planned conditioning and fitness tests, return-to-training constraints | Load and capacity change, objective test trends | Record workload, run fitness test |
| `analyst` | Requested report due, match event data incomplete for report | Upcoming opponent, match tape/data review, team performance analysis | Match-up data, phase and opponent trends | Open analysis; produce evidence-backed dossier |
| `scout` *(V2)* | Accreditation/consent barrier for candidate access | Opted-in candidate list and visits | Consent-permitted career metrics and scout report history | File scouting assessment |
| `unionselector` *(V2)* | Consent/authorisation issue affecting named selection | Consent-permitted player passports, squad selection milestones | Eligible pathway pool comparisons | Review authorised passport; record selection decision through permitted workflow |
| `enquiry` | Time-limited permission expiry | Only granted named player(s) and permitted availability information | Not applicable | Open granted enquiry; no dashboard shell |

### G. Logistics, facilities and match operations

| Role | P0 | P1 | P2 | Main action |
|---|---|---|---|---|
| `transportcoordinator` | Unassigned trip, vehicle conflict, passenger issue, late departure | Next 7 days' trip board, driver/vehicle allocation, trip manifests when authorised | On-time departure, capacity use, trip completion | Assign trip/driver, review same-day manifest |
| `driver` | Departure imminent, route change, vehicle incident, child pick-up accountability issue | Today's run, stops, authorised passengers, departure and arrival requirements | Recent completed trips, driving duties | Start trip, acknowledge stop, report incident, finish trip |
| `facilities` | Unsafe/unplayable pitch, field booking conflict, unresolved inspection | Ground preparation, upcoming field use, maintenance schedule | Field utilisation and downtime | Update ground status, close field, report maintenance |

### H. Commercial, finance and communications

| Role | P0 | P1 | P2 | Main action |
|---|---|---|---|---|
| `finance` | Failed payment/reconciliation, overdue invoices or dispute assigned to this user | Collections due, current unpaid/paid invoices, billing tasks | Collections trend, invoice ageing, budget versus actual where available | Reconcile invoice, resolve account issue |
| `sponsorship` | Placement approval/exclusivity conflict, expiring agreement, unfulfilled asset | Active sponsors, rights and placement calendar, upcoming deliverables | Contracted value, fulfilment and renewal pipeline | Update sponsorship/placement, request principal waiver where needed |
| `media` | Content with missing publication consent/approval; incorrect public child information | Match results ready for coverage, approved school/team stories, asset queue | Published-content engagement if collected and consented | Draft/publish approved story or match highlight |

## 4. Suggested dashboard families and shared components

Instead of duplicating 29 React pages, build **eight compositions**:

1. **Operations & governance** — platformadmin, superadmin, dso *with its own isolated, restricted case composition*.
2. **School command** — principal, directorofsport, sportsadmin, schooladmin.
3. **Team preparation** — coach, assistantcoach, teammanager; captain overlay for a designated player.
4. **Match control** — scorer, official, competitionadmin with distinct action permissions.
5. **My cricket & community** — player, selfaccess, guardian, spectator.
6. **Performance & welfare** — medical, fitness, analyst, scout, unionselector, enquiry; last is a narrow temporary view.
7. **Ground & transport operations** — transportcoordinator, driver, facilities.
8. **School business & publishing** — finance, sponsorship, media.

**Family is a composition pattern, not a substitute for individual role permissions.** DSO and medical must have separately protected information and workflows despite sharing layout primitives with other workbenches.

### Universal shell

- Context bar: `organisation/school → season → team/child/competition → active assignment`, with clear switching. Never combine multiple schools into an unexplained aggregate.
- Top status: present workflow state; live match, upcoming fixture or programme overview as appropriate. A live score is always drawn by the one `Board` component: black board, white and lime figures, in both themes.
- P0 task inbox: *role-authorised*, specific, with owner/action/time and optional due time.
- P1 next-events list: 7 days by default, as a list, not a calendar grid; timezone labels.
- P2: a short line of figures or one explanatory chart, one tap from home, with comparison, correct denominator and data freshness. *(v1.1)* No KPI tile row.
- Deeper analytics one click away.
- Contextual quick actions only for capabilities that genuinely exist.
- Notifications, global navigation, powerful search and an explicit `View all` for each module.

### Canonical layout: the day sheet *(v1.1)*

v1.0 placed a header panel over a row of four KPI tiles. That pattern was retired on 25 September 2026: "a scoreboard, not a dashboard", and decision 5, "the day sheet replaces the KPI dashboard" (`docs/redesign/DESIGN_DIRECTION.md` §1, §5, §9). The shell is the day sheet, in the order the day happens:

```text
[School / Role / Season switcher]                     [Search] [Notifications]
[Critical task — only if authorised and actionable]
1. Now         Live fixture: the Board, full width; "Open scorer" or "Match centre"
2. Today/next  Next fixture card: opponent, time, ground, bus time, weather in one line,
               readiness chips (team sheet · transport · officials · ground report)
3. Who is out  Injured and restricted players, with return date (status tier)
4. This week   Training and fixtures, as a list
5. Alerts      Last, unread only
```

Emphasis comes from the section's size (`bento-a` for the live board, `bento-b` for the next fixture, `bento-c` for the rest), not from colour or tiles. Each family includes or omits sections by capability; it does not add a different layout.

### Mobile hierarchy

`Critical notice (if any) → One primary action → Today/next event → 2–3 useful metrics → Task list → Links to analysis`.

A scorer's active scoring interface, a driver's in-trip view and a DSO's urgent-case workflow should be focused **work modes**, not endlessly scrolling dashboard cards.

## 5. Match-day state engine

| Context | Detect using | Dashboard response |
|---|---|---|
| Pilot *(v1.1)* | a Pilot Match created by quick-start, not yet promoted | Scorer: full live control as normal. Excluded from every stat, standing, record and P2 figure until promoted. Spectator: score and team names only, no player names (§3E). |
| Season setup | season active, fixtures absent or school incomplete | Registration, fixtures, users, consent and season-rollover tasks |
| Training week | future fixture 2–7 days away | Coach: practice and development; parent: attendance; sport: readiness |
| Pre-match | fixture imminent, confirmed vs outstanding | Scorer: toss/line-up; coach: XI/readiness; manager: transport; spectator: countdown |
| Live match | fixture state live and event stream active | Scorer: live control; coach/captain: tactics; parent/spectator: score and over |
| Innings break | event/replay state | Scorer: validate innings/target; fan: target and equation |
| Result pending | innings complete, not yet officially confirmed | Scorer: reconciliation; authorised confirmers: result task; spectator: provisional state clearly marked |
| Post-match | signed result, records fresh | Coach: review/feedback; player: personal scorecard; media: approved story |
| Postponed/abandoned | fixture status changed | Relevant users receive changed venue/time/action, not stale next-match card |

Never infer a match is live solely from the clock; use authoritative fixture/event state.

## 6. Core metric dictionary and definitions

| Metric | Formula or definition | Guardrail |
|---|---|---|
| Upcoming fixtures | Authorised fixtures with future start and non-cancelled state | Show venue, local time and latest revision |
| Fixture readiness | Required checklist items completed / applicable required items | Reveal which items are missing; do not treat non-applicable as failed. *(v1.1)* Shown as chips, each a word and a state, never as a percentage. |
| Participation count | Distinct players participating in at least one qualifying cricket activity in chosen season | Distinguish *registered*, *selected*, *attended*, and *played* |
| Participation rate | Distinct participating pupils / **eligible school pupil population** | Don't present until denominator exists and its coverage is verified |
| Team form | Chronological results of last N completed matches | Label W/L/T/D/NR by competition rules; don't count abandoned as loss |
| Win rate | Wins / decided matches for selected period | Define inclusion of ties and walkovers |
| Net run rate | Run rate scored minus run rate conceded under competition playing conditions | Handle all-out innings and adjusted innings properly; not a universal cross-format KPI |
| Match finalisation | Fixtures with confirmed result / applicable completed fixtures | Provisional vs confirmed is a first-class status |
| Player runs/wickets | Derived from canonical accepted ball events and rules | Never treat a stat projection as source of truth |
| Player trend | Rolling recent performance with sample size and format split | Comparisons must be age/format-aware; no unqualified ranking of children |
| Assessment progress | Repeat coach assessment across **four configured skill groups** | Group definitions, scale and date must be versioned; average only comparable scores |
| Availability | Explicit current response for a player and relevant fixture/training | “No response” ≠ “unavailable”; do not equate medical with availability |
| Transport readiness | Assigned driver + fit-for-use vehicle + authorised passenger plan + required confirmations | Capacity cannot exceed vehicle's approved seats |
| Invoice ageing | Outstanding amount grouped by invoice due-date bucket | Restricted to finance/linked guardian; currency ZAR by default, not hard-coded |
| School activation | School with verified staff setup, roster, fixture and a successfully scored/tested match | Signed contract, account created and activated school are distinct |
| Scoring sync integrity | Accepted, pending and quarantined events by current scoring lease/session | Surface offline state prominently to current scorer |
| Safeguarding timeliness | Case actions by status and required deadline for authorised DSO only | Never expose narrative/identities via ordinary school analytics |

**Statistical caution:** a huge-looking KPI is useless without timeframe, scope, eligible denominator and comparator. Use “last 5 innings: 145 runs, 34.2 avg” only when those values have actually been derived from accepted ball data.

## 7. Data contracts by widget

Every widget requires these fields before build:

```yaml
widget_id: string
persona: string
required_capabilities: [capability]
scope: { school_id: string?, team_code: string?, fixture_id: string?, person_id: string? }
source: canonical table | trusted computed read model
filters: { season_id: string?, window: string?, format: string? }
state: live | pending | confirmed | cancelled | empty | stale | error | gated   # v1.1: gated = above the school's tier
freshness: ISO8601
priority: P0 | P1 | P2 | P3
tier: free | paid                       # v1.1: lowest commercial tier that sees this widget
sponsor_slot: none | allowed            # v1.1: see §7.1
implementation_status: exists | partial | missing   # v1.1: against SCRBRD_OS, with file reference
release: R0 | R1 | R2 | R3 | V2         # v1.1
primary_action: { capability: string?, route: string?, label: string? }
empty_state: explanatory copy
loading_state: skeleton/no fabricated value
error_state: recoverable with retry
privacy_class: public | school | team | personal | clinical | safeguarding
analytics_event: widget_action_name
```

A `gated` widget says what it would show and which tier unlocks it. It never shows a blurred or invented figure.

### 7.1 Commercial tiers and sponsor slots *(v1.1)*

Paid tiers gate information, stats, data and tools; sponsor placements appear across the app, scorecards and the 3D broadcast, with ads that link out.

| Surface | Sponsor slot |
|---|---|
| A pupil's own home (`player`, `selfaccess`) | None, for now (decided 11 November 2026) |
| Work modes: live scoring, driver in-trip, DSO case | None, for now (decided 11 November 2026) |
| Spectator live view, public scorecard, broadcast | Allowed — the primary placement surfaces |
| Other dashboards | Not decided; `none` until a rule is agreed |

Sponsor categories shown where children are the audience must suit minors, as already decided for scorer rewards.

### Canonical data dependencies

| Dashboard group | Main domain sources | Important derived reads |
|---|---|---|
| School command | seasons, teams, fixtures, fields, bookings, role assignments, transport | `school_week_readiness`, `fixture_conflicts`, `participation_snapshot` |
| Team preparation | team roster, availability, training logs, skill ratings, workload, fixture, opponent | `team_readiness`, `development_snapshot`, `opposition_summary` |
| Scorer & match | **append-only `ball_event`**, scoring session, outbox, fixture/line-up/playing conditions | Replay-based live state, innings score, over, targets, scorecard and worm |
| Player & guardian | subject-scoped profile, fixtures, availability, invoices, transport, notifications | `my_upcoming`, `my_progress`, `linked_children_summary` |
| Operations | vehicles, trips, drivers, fields, condition/booking records | `trip_readiness`, `facility_conflicts`, `same_day_manifest` |
| Finance & sponsors | invoices, transactions, commercial agreements and rights | `collections_aging`, `sponsor_deliverables` |
| Governance | audit/access logs, case workflow, platform health | `support_incidents`, segregated `dso_case_queue` |

In the current `SCRBRD_OS` architecture, the canonical ball log is `ball_event`, and scorecards are produced by deterministic replay. Do **not** implement a new independent mutable score-total database merely to populate dashboards. Use materialised/read models or cached derived responses with validation/replay consistency.

## 8. Gaps to resolve before visual design is final

1. **Dashboard catalogue vs capability catalogue.** The live role inventory is 29; the older proposal is smaller. Capture the distinction in product docs.
2. **Who can perform medical clearance?** `medical` currently has `medical.write`, while formal `clearance.manage` is held by `principal`, `directorofsport`, `schooladmin` and `dso` (`roles.mjs` lines 184, 229, 261, 631). Confirm whether one capability covers both medical return-to-play and adult vetting clearance; if it does, the dashboards must label which is meant. The UI must separate clinical advice from official clearance and should not manufacture a treatment-to-clearance button.
3. **School participation denominator.** The draft schema may not include the eligible-pupil population needed for trustworthy participation percentages. Use counts until the denominator is sourced.
4. **Fixture readiness calculation.** Define mandatory checklist requirements per match format, fixture level and school; no magic readiness score.
5. **Competition playing conditions.** Standings, bonuses, ties, DLS and knockout progression require versioned rules. Label provisional results and standings appropriately.
6. **Event-state triggers.** Clarify sources for live scoring, confirmation, travel departures, pitch closures and consent expiry.
7. **Youth privacy.** Clinical and safeguarding data are segregated. Under-18 comparative player rankings, scout access, photography and public player data require specific checks and consent policy.
8. **Data quality.** Every data-rich card needs no-data, invalid-data, stale-data, loading and offline states.
9. **Multiple assignments.** Same person may be director of sport at one school, coach for one team and guardian at a second school. Show explicit scopes and avoid leaking mixed totals.
10. **Metrics ownership.** Assign source-of-truth, calculation, permission reviewer and product owner for each KPI.
11. **Avoid dashboard sprawl.** One shared pattern, not a different component library for every job title; keep DSO and in-match scorer as specialised protected workspaces.

## 9. Release priorities

*(v1.1)* The releases are renumbered. The first pilot is Kameel scoring Pilot Matches alone, so R0 is the scorer and the spectator only; v1.0's R0 becomes R1.

**R0 — Solo Pilot Matches (decided 11 November 2026)**
- Scorer: Start Pilot Match → toss and line-ups typed in → score → offline queue and sync state → finalise → promote or keep as sandbox.
- Spectator: live score and public scorecard of a Pilot Match, with no player names until the open question in §3E is decided.

**R1 — First pilot school**
- Scorer: assigned fixture → start/resume → score/handover → verify → finalise, fully offline-aware; pupil and guest scorers.
- Coach/team manager: fixture, XI, availability, training, restricted readiness, match result, Player of the Match.
- Guardian/player: own upcoming events, consent/availability, notifications, results; Player Passport.
- Director of sport/sports admin: calendar and readiness exceptions.
- School administrator: invites, guardian linkage and registration exceptions.
- Spectator: safe public fixtures, live scores and results, with the four public player fields.

**R2 — School operating system**
- Transport coordinator/driver/facilities, competition administration, official reporting.
- Principal, finance and sponsorship oversight with denominators and access checks.
- Medical and DSO **must have their core secure workflows at pilot time if those modules are enabled**; otherwise gate them off, not faux-dashboards.

**R3 — Analytical differentiation**
- Four-skill-group development assessments, coach report trends, opposition dossier, robust records explorer, sponsor insights, scorer recognition and wider programme analytics.
- Union pathways and scouting are V2, after R3.
- No AI-generated evaluations of children as facts; show evidence, confidence, sample size and review controls.

## 10. Test scenarios and acceptance criteria

- **A head of sport + coach + guardian:** switching assignment changes scope and widgets, preserving authenticated session but not leaking another team's private data.
- **Player vs own self-access:** a child can read only their own restricted development/health information and cannot read a team-mate's.
- **Guardian with children in two schools:** the child switcher scopes invoices, medical records, fixtures and travel independently.
- **Coach vs assistant coach:** assistant must not see unsupported `team.select` action when the capability is absent.
- **Scorer offline:** the screen shows pending count; no false confirmation; handover stays blocked until reconciliation per scoring-session rules.
- **Official vs competition admin:** only authorised user sees result confirmation/amendment approval.
- **Spectator:** public API offers no internal player profile or clinical information, even if requesting endpoint directly.
- **Platform support:** time-boxed, approved access; school can revoke; access is logged; no platform-wide browsing of child records.
- **DSO:** no case detail in headmaster, school admin, coach or operator dashboard, including aggregated notifications that expose an identity.
- **Incomplete data:** missing participation denominator yields count, not percentage; missing training assessment yields an informative empty state, not score 0.
- *(v1.1)* **Pilot Match sandbox:** a Pilot Match scored end to end appears in no player stat, team record, standing or P2 figure until promoted; promoting it adds it once.
- *(v1.1)* **Pilot Match public view:** the spectator page of an unpromoted Pilot Match shows no typed-in player name.
- *(v1.1)* **Pupil scorer:** a pupil holding `player`, `selfaccess` and `scorer` sees the scoring session and his own file, and no team-mate's medical or development data through the scorer bundle.
- *(v1.1)* **Guest scorer:** a scorer assigned one fixture cannot open, start or score any other fixture.
- *(v1.1)* **Sponsor slots:** no placement renders on a pupil's own home or in any work mode, including when the school's tier allows placements elsewhere.
- *(v1.1)* **Gated widget:** a free-tier school sees a gated widget's label and unlock tier, never a blurred or invented figure.
- **Mobile:** first screen communicates the next action/event; keyboard accessibility, contrast, screen-reader labels, offline/low-bandwidth behaviour verified.

Dashboard acceptance standard: a user can recognise what needs their attention in **five seconds**, complete their most common task in **at most two meaningful navigation steps**, and understand why any metric is shown. The numerical timing/step targets are **design hypotheses** to be validated by user testing, not research-proven guarantees.

## 11. Recommended next deliverables

*(v1.1: reordered for R0.)*

1. An **R0 widget registry** for the scorer and spectator only: every §7 field, with `implementation_status` checked against `SCRBRD_OS` (the day sheet in `apps/web/src/views/DashboardView.jsx`, the scorer under `apps/web/src/scorer/`, the public pages in `apps/web/src/public/`).
2. **Two low-fidelity screens**, drawn against `DESIGN_DIRECTION.md`: the scorer's home (Start Pilot Match, resume, sync state) and the spectator's live view.
3. **Solo pilot walkthroughs:** a Pilot Match from quick-start to promotion, offline scoring and reconnection, a ball correction, and an abandoned Pilot Match.
4. Then, for R1: the **role-mapping matrix** for all 29 bundles plus overlays, the four key homes (director of sport, coach, scorer, parent/player), and school walkthroughs (match week, postponement, consent missing, result correction, Player of the Match).
5. Instrumented validation with real school users once R1 is in a school: observed task completion, permission checks, data accuracy, empty states and clarity.
6. **Align public claims:** the public materials should say 29 permission roles served by eight dashboard families on one shell.

### References

- SCRBRD source: [Roles](https://github.com/iamkameel/SCRBRD_OS/blob/main/packages/policy/src/roles.mjs), [Architecture](https://github.com/iamkameel/SCRBRD_OS/blob/main/docs/ARCHITECTURE.md).
- [Nielsen Norman Group: dashboard data visualisations](https://www.nngroup.com/articles/dashboards-preattentive/).
- [Nielsen Norman Group: complex applications](https://www.nngroup.com/articles/complex-application-design/).
- [Cricket South Africa: safeguarding policy](https://www.cricket.co.za/policies/).
- [POPIA, children's information and consent — Section 35](https://popia.co.za/section-35-general-authorisation-concerning-personal-information-of-children/).
