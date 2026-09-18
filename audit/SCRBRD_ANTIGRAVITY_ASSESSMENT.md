# What `iamkameel/SCRBRD_AntiGravity` has that this tree does not — and what it has that this tree should never build

Requested: an audit of `iamkameel/SCRBRD_AntiGravity` against SCRBRD OS, focused on UI/UX, modals, and
the depth of its data model. Read at `acfb10e` (2026-09-16), read-only clone, no code merged.

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

### 2.2 An NRR "what-if" simulator

SCRBRD OS already reads and renders real net run rate (`LeagueView.jsx`, `net_run_rate` from
`services/api`). What it does not have is `NRRScenarioCalculator.tsx`'s idea: pick a team, propose a
hypothetical result (runs, overs, all-out or not, for both sides), and show the projected NRR and table
movement — clearly a simulation over already-derived standings, never stored, never asserted as a
prediction. That framing keeps it inside this codebase's own honesty rule as long as it is built the same
way: a `(hypothetical)` label that never leaves the screen it was computed on, no new capability, no write.
Filed as **SCRBRD-057**.

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

## Backlog entries filed

See `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`, "Pass 3 — Harvested from the `scrbrd_antigravity`
prototype," for SCRBRD-056 (handover UI), SCRBRD-057 (NRR simulator) and SCRBRD-058 (the pitch-report
screen — schema and routes already shipped; only the form is missing). Nothing in Part 1 is filed — it is
recorded here as a decision, not a task.
