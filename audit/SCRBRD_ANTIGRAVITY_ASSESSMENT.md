# What `iamkameel/SCRBRD_AntiGravity` has that this tree does not — and what it has that this tree should never build

Requested: an audit of `iamkameel/SCRBRD_AntiGravity` against SCRBRD OS, focused on UI/UX, modals, and
the depth of its data model. Read at `acfb10e` (2026-09-16), read-only clone, no code merged. Part 4 is a
later, separate request — a focused look at player passports and profiles specifically.

## What this repository is

Its own `README.md` still titles it "SCRBRD Beta 2" and its own `package.json` names it `scrbrd`: this
is the same Next.js/Firebase lineage as `scrbrd-beta-2` (audited in Pass 2 below), diverged much further
— 454 component files and 255 app-route files against beta-2's 121 and 32. It ships its own audit of
itself, current as of two days before this one (`Audit Pack/audit/*.md`, dated 2026-09-16), written with
a route-classification tool that crawled all 142 routes four import-levels deep for their real data
source. That audit's own numbers: **65 routes on real data, 43 partially mocked or randomised, 13 fully
mocked, 21 static.** `CURRENT_PROBLEMS.md` self-rates the build "MOSTLY GOOD ⚠️" with E2E tests at 4
passed / 3 failed on login. Its own `SCRBRD_UI_UX_AUDIT.md` opens by asking "one operating system or
several prototypes?" and answers "several, under one skin" — three separate scorer UIs, three separate
Manhattan/Worm/WagonWheel chart implementations, duplicate `Badge`/`Btn`/`Sheet`/`Card` primitives.

That self-assessment is corroborated everywhere this audit looked, and is the single most important fact
about the repository: **treat every screen as a concept sketch, not a proven implementation, and verify
against the actually-wired code before borrowing anything** — which is what the rest of this document
does, file by file, the same way Pass 2 did for beta-2. A UI that looks finished and a UI that is wired
to real data are, in this tree, frequently two different things behind the same component.

Nothing from this repository is proposed as code to copy. What follows is organised into what to build
(a concept worth having, checked against what SCRBRD OS already does), and what to refuse (a pattern
this codebase's own culture — derive, never fabricate, fail closed, honest absence — exists to prevent).

---

## Part 1 — Refuse these, and why the refusal is the finding

### 1.1 A computed DLS/rain target — already decided, and this repo is evidence the decision was right

`src/components/scoring/DlsRainInterruptionModal.tsx` and `src/lib/scoring/dlsEngine.ts` implement a real
Duckworth-Lewis-Stern Standard Edition resource table (a genuine 20×10 published percentage grid,
interpolated between key overs) and compute a live par score and revised target from it. It is one of the
more carefully built pieces of math in the repository.

SCRBRD OS has already decided against this, on purpose, in two places:

- `packages/scoring/src/phases.mjs`: *"A 'par score' as an absolute number... is the kind of figure that
  has to come from somewhere: par depends on the ground, the opposition, the surface and the weather, and
  a number invented to fill the column is exactly the fabrication this project keeps removing."*
- `apps/web/src/scorer/sheets.jsx`, the `RevisionSheet`: *"No DLS here. The figures are the umpires',
  read off their sheet and typed; a wrong automatic target is worse than a typed one, and a school ground
  has no resource tables."*

`dlsEngine.ts`'s own header confirms the risk rather than refuting it: the file used to carry its own copy
of the resource table, which **diverged from the published standard by up to 4.7 percentage points from
four wickets down**, so the two DLS surfaces in that app produced different targets for an identical match
state until someone noticed and consolidated them onto one table. That is precisely the class of silent
drift this codebase's mirror-rule tests (`wheel.test.mjs`, the sensitivity/separation suites) exist to
catch by construction rather than by someone happening to notice. A typed target, entered once by the
umpires and recorded as an event with who set it and why (`revision`, already built), cannot diverge from
itself.

**Verdict: do not build. `RevisionSheet` is the correct answer and this repository is a worked example of
what the alternative costs.**

### 1.2 A "potential" score for a school-age player — refuse this one specifically

`dataconnect/schema/schema.gql`'s `PotentialProjection` table stores, per person per season:
`ceilingScore` (0–100, "target ability"), `readinessScore`, `riskScore` (0–100, "risk of not reaching
potential"), and `potentialTier` (1 "Elite" to 5 "Monitor"). It is wired up: `src/services/scoutingService.ts`
has a live `getPotentialProjection()`, and `src/components/scouting/PotentialVsAbilityRadar.tsx` renders it
as a two-line radar chart, "current" against "potential," per skill dimension.

There is no algorithm anywhere in the repository that computes `ceilingScore`, `riskScore`, or
`potentialTier` — a search for those three names outside the type definitions and the radar component
returns nothing. `scoutingService.ts`'s own fetch is honest about the gap (`if (existing) return existing;
return null;`), but the radar component that renders it ships with **hardcoded fabricated defaults**
(`current: 78, potential: 94`, `current: 82, potential: 96`, and so on across six dimensions) that render
with full visual confidence — a filled polygon, a school-age player's name in the title — the moment
nothing real is passed in. This is the vacuous-assertion pattern this session has spent all day hunting in
its own test suite, except here it is a UI default, aimed at a child, dressed as a ranking.

SCRBRD OS's own culture is the reason to say so plainly rather than skip past it: "nothing on record,
never pending" (reads never invent rows); `useSummary`'s own comment, *"a card that renders 0 because a
request failed has stated something false. Absent is honest; zero is not"*; the entire reason
`services/api/rewards` is a confidential, server-only, versioned, capability-gated coefficient rather than
a number a client could compute or a coach could see the shape of. A "ceiling" and a "risk of not reaching
potential" for an actual child, generated by nothing, labelled with a tier as blunt as "Monitor," is the
single sharpest violation of that culture found anywhere in this audit.

**Verdict: do not build anything shaped like this. If a real, disclosed, validated statistical projection
is ever wanted, it needs its own ADR, the same server-side confidentiality `services/api/rewards` already
has, and it must never render a number it does not have — which rules out a default.**

### 1.3 A sponsor-linked rewards wallet for minors

Schema layer 15 (`RewardsWallet`, `RewardTransaction`, `RewardRule`, `SponsorOffer`, `RewardRedemption`)
models a redeemable-currency incentive system tied to sponsor offers. SCRBRD OS already has a "rewards"
concept — `services/api/rewards/` — and it is a confidential player-rating coefficient, not a currency; the
distance between the two is the point. `tools/check-bundle.mjs` fails the build if that module is ever
reachable from the client specifically so nobody can reverse-engineer or game the formula it protects.
Recognition in SCRBRD OS (caps, honours, milestones — SCRBRD-055, shipped) is already the right shape for
"the platform can single a child out for something they earned": school-issued, unmonetised, tied to a
real match record.

**Verdict: do not build a currency or a sponsor-linked redemption system for children. If a sponsor wants
visibility, `sponsorship.read`/exclusivity gates already exist for that and stop well short of a wallet.**

### 1.4 A flat "primary role + additional roles" model

`MULTIPLE_ROLES_IMPLEMENTATION.md` documents bolting a `roles: string[]` array onto the user record, with
a primary-role dropdown and an additional-roles checklist in the edit dialog. This is exactly the shape
`docs/adr/0003-job-titles-are-not-roles.md` argues against, replaced here by scoped **assignments** — a
person can hold several, each anchored to a school or team, rather than a flat set of strings on the
account. Nothing to take; a second, independent confirmation that the assignment model was the right call.

### 1.5 The data model underneath the scoring, generally

`API_AND_DATA_MODELS.md` documents `Match.liveScore` and `Person.stats` as mutable fields updated by
`recordBallAction`, and `undoLastBallAction` as "reverts the last recorded delivery" — a stack pop, not an
append. `packages/scoring`'s own README states the rule this violates: *"If you find yourself reaching for
a mutable counter, add an event kind instead."* `voidEvent`'s own comment is sharper still: the log is
"a record of what the scorer did, not a stack." Tellingly, a **different** file in the same AntiGravity
repository — `src/lib/scoring/projectionService.ts` — independently re-derives SCRBRD OS's own principle
almost verbatim (*"ScoringAction[] is the ONLY input... All stats, scorecards, and views are DERIVED from
this... deterministic - same input = same output"*), and that file coexists with the mutable model above
without either replacing it. That coexistence, more than either file alone, is the argument for keeping
the discipline this codebase already has of one implementation per concept, checked by a test that fails
if a second one grows back — the wheel's mirror-rule test and the roadmap's registered-walk requirement are
exactly that discipline, applied.

---

## Part 2 — Worth having, once checked against what already exists

### 2.1 A UI for the handover this codebase already built the hard part of

`services/api/handover/scoring-session.mjs` is a complete arm → code → claim → **cross-device diff
confirmation** → epoch-increment protocol, with routes wired (`server.mjs:340-341`) and a full walk
(`WALKS` in `tools/run-smoke-api.mjs`). Nothing in `apps/web/src` calls `armHandover` or `claimHandover` —
a grep across the whole client for either name returns nothing outside the API and its test. A scorer at
the ground has no way today to actually trigger a device handover through the app; the roadmap's `up3`
entry is honest by the bar `roadmap.test.mjs` sets (a registered, real walk exists), but that walk is
API-only, not a browser walk, and there is no scorer-facing screen at all.

AntiGravity's `ScorerHandoverModal.tsx` is a good **shape** to build that screen from: a two-tab dialog
(generate / claim), a 4-digit PIN entered as four boxes with auto-advance, a live countdown to expiry, a
success/error state per tab. Its own audit calls the feature "PIN issued, never enforced" — a defect — and
the code confirms why: there is no cross-device state check at all, and the QR code it also offers encodes
the PIN **in a URL query string**, which is a needless leak through browser history and referrers for a
value that is supposed to be a shared secret.

**Recommendation:** build the arm/claim screen with that visual shape, but where AntiGravity's modal ends
(claim succeeds, done), SCRBRD OS's must add the step its own backend already demands and AntiGravity's
does not have: `diffConfirmation` — the incoming device's derived score compared against the outgoing
device's, both sides shown, before the epoch actually transfers. That is not extra polish; it is the one
property `scoring-session.mjs`'s own comment says the handshake exists to provide: *"Silent auto-merge...
is exactly what the handover handshake exists to detect."* No PIN in a URL. No new capability required —
the routes exist. Filed as **SCRBRD-056**.

### 2.2 An NRR "what-if" simulator — blocked, and worth stating why

`NRRScenarioCalculator.tsx`'s idea — pick a team, propose a hypothetical result, see the projected NRR and
table movement — looked like a small addition over the real net run rate SCRBRD OS already renders
(`LeagueView.jsx`, `LiveLadder`). Checking `competition_entrant` (`db/08_schema_programme.sql`) before
writing any code found it stores only a single final `net_run_rate` number — no runs-for, overs-for,
runs-against or overs-against. NRR is a rate over cumulative totals; a "projection" built from the stored
rate alone, without those totals, would be exactly the fabricated-number pattern this document spends
Part 1 refusing, just aimed at a competition table instead of a player. It is not filed as buildable work —
see `SCRBRD-057`, re-scoped to the real prerequisite (the aggregate columns, and a decision on whether they
are derived from match results or typed by a competition admin, before anything simulates from them). The
closest parallel already in this tree: a typed DLS revision target is honest because a person stated it; a
computed one is not, for the same reason a computed NRR projection over data that is not there would not be.

While checking this, `LeagueView.jsx`'s OTHER standings path — `comp.table`, the "Edit Standings" / "✓ Save
Changes" flow shown for a demo competition — turned out to write only to local React state. No route
exists to persist a competition_entrant row at all. That is a separate, pre-existing gap, recorded in
`SCRBRD-057` rather than filed fresh here, since fixing it is the same prerequisite this section already
needed.

### 2.3 A pre-match ground/pitch status check — checked against the tree, and mostly already there

`LogGroundStatusDialog.tsx` lets a groundskeeper log pitch/outfield readiness and equipment status ahead
of a match. First instinct was that this filled a real gap behind SCRBRD OS's duty roster (which already
has a `ground` slot, `apps/web/src/views/duties.jsx`) — checking it against the tree found the opposite.

SCRBRD OS already has this, and a stronger version of it: `db/08_schema_programme.sql`'s
`match_pitch_report` (surface, grass, bounce, pace as words, plus **optional** `bounce_rating`/
`pace_rating` 1–10 numbers, with its own comment on exactly why a word and a number are not the same
fact — a groundsman says "two-paced" out loud, a director of sport comparing five squares across a season
needs the number) and a separate, deliberately-not-per-match `ground_condition` for the ground itself
(drainage minutes, moisture, last rolled/mown — facts of the venue, not of Saturday's fixture, kept apart
so they are not copied onto every match there and left to drift). The write route
(`events-api.mjs:896`) and the read resource (`pitch_report`) both already exist, and the duty roster's
own `match_duties` read already unions the report in as the `ground` slot's state.

What is actually missing, once the schema is checked rather than assumed absent, is one screen:
`FieldsView.jsx:112` has a "+ Pitch Report" button with **no `onClick` at all**, and nothing in
`apps/web/src` calls the `pitch_report` read. `LogGroundStatusDialog.tsx`'s 0–100 readiness sliders and
its `equipmentReadiness: equipmentReady ? 100 : 0` ("mapping boolean to numeric for schema consistency")
would have been a **regression** if copied — SCRBRD OS's own word-plus-optional-number columns are the
more honest version of the same idea, already shipped, already better than the source material.

**Recommendation:** wire the existing button to a form over the existing columns; invent nothing. Filed
as **SCRBRD-058**, corrected from an earlier draft that proposed new schema before checking for old.

### 2.4 A command palette — with the read path made explicit up front

`CommandMenu.tsx` (`cmdk`, ⌘K) searching schools/matches/players and jumping to them is a well-worn,
useful pattern with nothing cricket-specific about it. The thing worth stating before it is built, because
it is exactly the kind of thing that is easy to get right for the demo and wrong for a real tenant: a
search box is a read path like any other, and every result it can surface has to pass through the same
`scopeFilter`/capability check as the view it would otherwise be found in — a coach typing a name must not
learn that a player exists at a school they cannot see, the way a raw client-side Firestore query in the
AntiGravity version would. Built on top of the existing `read-api` resources with their existing
capability gates, this costs nothing new in the policy model. Not filed as a numbered entry — it is a
nice-to-have interaction pattern, not a gap in what the product must do, and can ride with whichever screen
wants it first.

### 2.5 Two planning artifacts worth reusing as *templates*, not as data

`Audit Pack/audit/SCRBRD_PRODUCT_GAP_ANALYSIS.md` §4 is a per-role table — **needs now / needs soon / might
need / should never see** — for every role in that product. The rows are AntiGravity's own and mostly do
not transfer (its role list and screens differ), but the four-column shape is a genuinely useful frame for
SCRBRD OS's own dashboard work going forward: it makes "should never see" a first-class column next to the
feature wish list, rather than something inferred after the fact from a capability grep. Worth adopting as
a habit the next time a role's dashboard is scoped, not as a document to copy.

`SCRBRD_UI_UX_AUDIT.md` §7 gives a priority order for a spectator-facing rebuild: *live score + context →
players at the crease → scorecard → commentary → wagon wheel → momentum → sponsors.* That ordering (what a
parent glancing at a phone actually wants, in the order they want it) is worth keeping in mind for any
future spectator/broadcast surface, independent of anything else in that repository.

---

## Part 3 — What the comparison confirms was already right

Several of this session's earlier decisions come back validated rather than extended:

- **Event-sourced replay over mutable fields** (§1.5 above) — confirmed by AntiGravity's own
  `projectionService.ts` re-deriving the same principle, while a different, unreconciled part of the same
  codebase still mutates `liveScore` directly.
- **Scoped assignments over a flat role list** (§1.4) — confirmed by `MULTIPLE_ROLES_IMPLEMENTATION.md`
  needing a bespoke primary/additional-roles UI to work around exactly the ambiguity ADR 0003 avoids by
  construction.
- **Confidential, server-only reward coefficients** (§1.3) — confirmed by contrast with a rewards model
  that is a client-visible schema and a sponsor-facing currency.
- **"Absent is honest; zero is not," and no invented par score** (§1.1, §1.2) — confirmed twice over: once
  by a real algorithm (DLS) whose own history includes a silent-divergence bug, and once by a fabricated
  score (potential/risk) with no algorithm behind it at all, shipped with confident-looking defaults.
- **One implementation per concept, held to a mirror-rule test** — AntiGravity's own audit describes three
  parallel scorer UIs and duplicate primitive components as its top structural finding. SCRBRD OS's
  `wheel.test.mjs`, `roadmap.test.mjs` and `separation.test.mjs` exist specifically to make that outcome a
  test failure instead of a slow accumulation nobody notices until an audit is commissioned to find it.

- **A word alongside an optional number, only where the number means something** (§2.3) — confirmed by
  finding SCRBRD OS had already built the stronger version of the exact pattern this document first
  proposed inventing: `match_pitch_report`'s `bounce`/`pace` as words with `bounce_rating`/`pace_rating` as
  genuinely optional numbers, against `LogGroundStatusDialog.tsx`'s readiness sliders standing in for a
  feeling and a boolean dressed as a percentage. The first draft of §2.3 and SCRBRD-058 did not check this
  before writing it, found only a missing screen, and both were rewritten once the schema turned up —
  itself a small demonstration of the same discipline this document keeps asking for.

None of this is a reason to stop looking at other codebases — beta-2 and this one both produced real,
adopted ideas (recognition, the workflow-state inventory, duty rosters; here, the handover screen and the
NRR simulator). It is a reason to keep checking every borrowed idea the same way this document did: against
the actual wired code, not the README — and, as SCRBRD-058 shows, against this tree's own schema before
assuming a gap is really empty.

---

## Part 4 — Player passports and profiles, investigated on request (2026-09-18)

Requested separately: a focused look at how `SCRBRD_AntiGravity` builds a player's own passport/profile
page. Checked against the tree the same way as everything above. The finding here is sharper than
anything in Part 1: not an absent algorithm, but **hardcoded fabricated content, live, on a real child's
own dashboard.**

### 4.1 `PlayerPassportView.tsx` — the one that ships, and what it actually shows

`PlayerDetailClient.tsx` (`/players/[id]`) and `player-dashboard.tsx` — the latter fed by
`fetchPersonByEmail`, i.e. **the signed-in player's own real identity** — both render
`PlayerPassportView`. Of everything on that page, `player?.dateOfBirth`, `battingHand`/`bowlingHand`, and
`schoolName` are the only fields read from the real player passed in. Every other figure is a literal in
the component:

- **Batting Core / Bowling Core stat blocks** — `value={42}` matches, `{1248}` runs, `{48.0}` average,
  `{136.5}` strike rate, `{96.2}` overs, `{41}` wickets, `{3.1}` economy, `{22.1}` bowling average.
  Identical for every player who opens the page, real or not.
- **"Professional Trajectory" timeline** — five hardcoded steps (`U11 2020-21 Greenfields Primary A` …
  `OPEN 2025-26 Riverside First XI High`), naming schools that have nothing to do with whoever is
  actually being viewed.
- **`DOB: {player?.dateOfBirth || '14 MAY 2008'}`** — a specific, plausible fallback birthdate for a
  minor, shown with the same styling as a real one, the moment the real field is empty.
- **"Biometric Status: Secured & Verified"**, a fingerprint icon, and **"Eligibility Verified — Cleared
  for Regional Representation"**, a shield-check icon — both permanently on, gating nothing, backed by no
  biometric or eligibility system anywhere else in the codebase. Presented as compliance/security facts
  about a specific child.
- **`ScoutingIntel`**, called with **zero props**, so its defaults are the only values ever shown: rating
  `A+`, potential ceiling `Professional / Elite` at `85%`, growth `+12%`, risk `Low`, and the canned
  sentence *"Exceptional talent with a strong work ethic. Shows great promise for future development and
  impact."* — for every player, unconditionally. This is `SCRBRD_ANTIGRAVITY_ASSESSMENT.md` §1.2's
  `PotentialProjection` finding again, in a worse form: not merely undercomputed, but hardcoded as the
  only behaviour that exists.
- **`PassportRadarChart`** and **`FormTrendTracker`**, also called with zero props: a fixed six-axis skill
  radar (120/98/86/99/85/65 of 150) and a fixed six-month form line (4.2→8.4), for every player alike.
- **`TacticalComparison`** — a fixed strike-rate/average/boundary-%/dot-ball-% comparison against a "League
  Avg," for every player alike.
- **Avatar fallback** — `https://ui-avatars.com/api/?name=${firstName}+${lastName}…`: when no photo
  exists, the child's actual name is sent to a third-party public API to generate one. A minor's name
  leaving the system boundary to an uncontrolled external service, on a page styled "Personnel Data Sheet
  v4.2 · Official Record · Powered by SCRBRD OS Intel Core."

Every one of these renders with full visual authority — badges, checkmarks, "verified," a signature line —
on a real child's own screen, logged in as themselves.

### 4.2 The honest version exists, and was never wired up

`PlayerProfileHeader.tsx` is a different, better-behaved header for the same concept: every field reads
from the real `player` prop, conditionally (`player.battingStyle && <Badge>…`), with an honest fallback
("Team not assigned") rather than an invented one, and DOB rendered only `{player.dateOfBirth && …}`. A
search of the whole tree finds no import of it anywhere — it is dead code, superseded in practice by the
component that fabricates. The codebase contains its own refutation of `PlayerPassportView` and shipped
the other one.

### 4.3 One real, honest exception, on fake inputs only

`src/lib/intelligence/athletePassportEngine.ts` is a different thing entirely and is **not** part of this
finding: a pure, transparent cross-sport training-load calculator (session-RPE style — duration × intensity
per appearance, rolled into a 0–100 load score with alerts for back-to-back competition days, too many
disciplines in a week, no rest day). Every number traces to a real session, and nothing about the
computation itself is fabricated. Its one honest caveat: `intensity` is a fixed formula per event type
(cricket: a function of overs bowled; swimming/athletics: a constant per category), not a real per-athlete
perceived-exertion rating, so the score's precision is better than its inputs deserve — worth knowing, not
worth refusing. Wired into `MultiSportPlatform` (`/sports/multi-sport`), which per that repo's own gap
analysis (Part 1 of this document, §self-audit) only ever receives `MOCK_SWIMMING_GALA` /
`MOCK_ATHLETICS_MEET` data — real logic, currently exercised only on fake inputs, in contrast to §4.1's
fake logic on real inputs.

**Verdict: do not adopt anything from `PlayerPassportView.tsx`, `PassportWidgets.tsx`,
`PassportRadarChart.tsx`, or `FormTrendTracker.tsx`.** SCRBRD OS's own passport (confidence-tiered —
`derived`/`verified`/`asserted`/`seeded`, each row naming its source and recorder) is already the correct
answer to "how sure are we of this fact about this child," which is the exact question this file gets
backwards by never asking it. The workload-engine's shape (§4.3) is worth a look purely as a load-scoring
method, separately from anything in this section, if SCRBRD OS ever extends `player.workload` beyond
bowling-overs ceilings to a cross-discipline picture — not filed as a numbered entry, since SCRBRD OS's own
workload model already serves a narrower, real purpose (a school-enforced overs ceiling, not a monitoring
score) and widening it is a product decision, not a bug fix.

---

## Backlog entries filed

See `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`, "Pass 3 — Harvested from the `scrbrd_antigravity`
prototype," for SCRBRD-056 (handover UI, closed), SCRBRD-057 (NRR simulator, blocked on missing aggregate
data — see §2.2's correction) and SCRBRD-058 (the pitch-report screen — schema and routes already shipped;
only the form was missing). Nothing in Part 1 is filed — it is recorded here as a decision, not a task.
