# SCRBRD-123 — the fixture planner: the engine

Status: **phase 1 built** (2026-09-30): the engine, with tests, and no database change, route or screen.
**Phase 2 built** (2026-09-30): `db/67_fixture_planner.sql`, `services/api/write/planner-api.mjs`, the API
contract in §5 for the screen (a Sonnet build). The screen is not built.
The backlog item is `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md` → SCRBRD-123. The idea came from
`competition-planner.ts` in `iamkameel/scrbrd` (0a90c71); the behaviour was taken, not the code.

## 1 · Where it lives, and why

`packages/scoring/src/planner.mjs`, exported as **`@scrbrd/scoring/planner`** (a subpath, like
`@scrbrd/scoring/commentary`), and deliberately **not** on the package index. It is pure JavaScript about a
competition, like `conditions.mjs` beside it; it dates a day with `matchDay()` (`edition.mjs`, SAST, as
`sa_today()` does in SQL) and names a format with `fixtureFormatFrom()` (`conditions.mjs`); and both tiers
that will call it, the API and the web client, already depend on the package. A new package would have
cost workspace wiring for one module. The index is what the pad and every web screen load, so keeping the
planner off it keeps it out of the web entry graph until a screen imports the subpath. It is on the
typecheck's strict list because `packages/scoring/src` already is.

## 2 · The API

```js
import { pairings, plan, toFixtureDrafts } from "@scrbrd/scoring/planner";

pairings({ format, entrants })            // → { format, rounds, fixtures, byes }
plan({ pairings, windows, rules,          // → { format, fixtures, byes, staleLocks, placed, unscheduled }
       blackouts, known, locks, grounds })
toFixtureDrafts(plan, competition)        // → { drafts: [{ fixtureId, body }], held: [{ fixtureId, reason }] }
```

- **`pairings`**: `format` is `round_robin`, `double_round_robin` or `knockout`; `entrants` are `{ id }` in
  seed order, at most 16. A round robin uses the circle method: every pair once, a side at most once a
  round, one bye a round when the count is odd. Venues are decided by the pair, so each side hosts half its
  matches (give or take one when the count is even); the double round robin repeats the draw with venues
  reversed. A knockout uses the standard seeding (1 v 16, 8 v 9, …); byes fall to the top seeds and are
  listed as byes, never fixtures; a later round's side is `{ winnerOf: fixtureId }`. Ids are stable: a
  round-robin fixture is `rr:<a>:<b>:<leg>` (its pair), so it survives reordering; a knockout fixture is
  `ko:r<round>:m<position>:<fingerprint of who could reach it>`, so a redraw changes it and its lock goes
  stale rather than following another pair.
- **`plan`**: `windows` are `{ id, groundId, startsAt, endsAt }` a ground's owner offered (instants with an
  offset; a bare local time is refused). `rules` are minutes: `durationMinutes`, and optional
  `preparationMinutes`, `recoveryMinutes`, `restMinutes`, `travelMinutes`, `maxPerDay` (1). `blackouts`
  are `{ day, entrant? }` on the SA calendar. `known` are existing commitments `{ entrants?, groundId?,
  startsAt, endsAt? }`; one with no end takes its whole SA day. `grounds` are `{ id, parentId?, closed? }`,
  because SCRBRD_OS has no field hierarchy or closure record yet (§4). `locks` are `{ fixtureId, windowId }`.
  The required rules, each a reason code with words in `PLAN_REASON_TEXT`: `window_short`, `blackout`,
  `ground_closed` (the ground, a field it lies on, or a pitch on it), `ground_taken` (one fixture per
  window, and no overlap on related ground or with a known booking), `rest` (plus travel between sites),
  `daily_cap` (known commitments counted), `feeder` and `feeder_unscheduled`; and `no_windows`. A later
  knockout round is checked for every entrant that could reach it. Locks are placed first, only in their
  window; one that breaks a rule leaves its fixture unscheduled with the reasons, and one naming no fixture
  or window is in `staleLocks`. Greedy and deterministic: fixtures in the draw's order, windows earliest
  first, the first window that breaks nothing. Valid, not optimal. Bounded: 16 entrants, 256 windows; worst
  case O(F · W · (F + K + B + C)), the ceiling (240 fixtures, 256 windows) in about 0.1 s.
- **`toFixtureDrafts`**: each placed fixture whose two sides are entrants becomes the body `POST
  /api/fixtures` takes: `schoolId`/`teamCode` (home entrant), `awaySchoolId`/`awayTeamCode` (away entrant),
  `startsAt` (after preparation), `groundId`, `competitionId`, `sport`, and `format`/`overs` from
  `fixtureFormatFrom()` when it says something. Held back: `unscheduled`, `awaiting_winner` (a knockout side
  not yet known), `no_team_code` (the route needs one; `competition_entrant.team_code` is nullable).
  `services/api/write/planner-drafts.test.mjs` posts every draft through the route's own handler.

## 3 · What the later phases add

- **Phase 2, drafts and publishing.** A versioned draft record per competition (inputs, locks, the
  computed plan) in a new `db/NN` with RLS: who may plan a competition (the organiser's assignment, not the
  entrant schools' administration). A read path for the windows (declared by ground owners), blackouts,
  closures and each entrant's known fixtures (`match` rows of its school and team, `starts_at` plus the
  format's length, since `match` has no end time). The Sonnet screen: inputs, a calendar and bracket
  preview, reasons in words, locks, regenerate. Publishing: a loop over `toFixtureDrafts()` through the
  existing route, idempotent (a draft fixture remembers the match it made), reporting each refusal (the
  route's `invalid_fixture` for an entrant that has left, `not_permitted` where the organiser may not
  arrange the home school's fixture).
- **Phase 3, approvals.** Each school approves its own fixtures, the ground owner the slot, and publication
  rechecks everything atomically; knockout rounds are published as results resolve their sides.

## 4 · Deliberately left out

- **No database, route or screen** (phase 1). The plan reserves nothing; windows are what the caller declares.
  Phase 2 (§5) gives windows, closures and the ground hierarchy a home; the plan still reserves nothing.
- **Ground hierarchy and closures are input.** `ground` has no parent and `ground_condition` has no closed
  state, so `plan()` takes `grounds` with `parentId` and `closed` spans; phase 2 decides where they live
  (`ground.parent_id` and `ground_closure`, db/67).
- **Soft preferences** (preferred weekdays, less travel, home/away alternation across rounds) and
  **optimality**: the search is greedy and says why a fixture was not placed rather than backtracking.
- **Pools, group-then-knockout, placement matches, reserve days.** Same model, later.
- **Surface, sport and inspection checks** (the source's warnings): `ground.surface` is free text today.
- **Travel times are not guessed**: one `travelMinutes` between different sites, from the organiser.

## 5 · Phase 2 as built

Built 2026-09-30 (Opus): `db/67_fixture_planner.sql` (db/99 §45), `services/api/write/planner-api.mjs`
(registered in `services/api/server.mjs`), `tools/smoke-planner.mjs` (in `run-smoke-api`), and two engine
helpers, `fixtureLength()` and `knownFixtureEnd()` (§5.3, `planner.test.mjs` G). The screen is not built;
§5.5 is its contract.

### 5.1 · The tables, and who

| Table / column | What | Who writes | Who reads |
|---|---|---|---|
| `ground.parent_id` | the field a pitch lies on: same school, never a cycle, at most 8 deep (`ground_parent_guard()`) | `facility.manage` at the ground's school (the ground's own policy) | as the ground (`facility.read`) |
| `ground_closure` | a span a ground cannot be used, reason 3–120 characters | `facility.manage` at the ground's school | `facility.read` there; the manager through `planner_inputs()` |
| `ground_window` | a slot offered for fixtures, to one competition or (`competition_id` NULL) to any; at most a week | as above | as above |
| `competition_blackout` | a day nobody in the competition plays, or one entrant does not | the manager, any; an entrant school, its own side's (`fixture.update` at the entrant's school and team) | the manager; a competition-wide day by whoever may reach the competition; an entrant's day by that side (`fixture.read` there) |
| `fixture_plan` | a version: format, range, rules, the entrants in seed order, locks, the inputs `planner_inputs()` read, the engine's output; `draft → published → superseded` | the manager, through definer functions only | the manager; once published, whoever may reach the competition. A draft is the organiser's: an entrant school reads nothing of it |
| `fixture_plan_item` | the match each published fixture made, primary key `(competition_id, fixture_key)` | the manager, through `fixture_plan_item_record()` | as the plan that made it |

**The manager** is db/61's `competition_conditions_manager()` — `competition.conditions.manage` at the
organiser, which for a league with no organising school is a platform-wide `competitionadmin`. No new
capability: when SCRBRD-125 scopes the function to a competition, the planner follows. **The ground owner**
keeps windows and closures under `facility.manage`, the capability that already writes `ground` and
`ground_condition` (the generated policies, `tables.mjs` → db/67's block; DELETE by hand, same predicate).
**An entrant school's blackout** is `fixture.update` at that entrant, because the people who put a school's
Saturdays in are the ones who know its exam calendar, and a blackout constrains that side alone; it may
remove its own side's days, never the league's or another school's.

`fixture_plan`, `fixture_plan_item` and `competition_blackout` are written only through SECURITY DEFINER
functions (the application holds SELECT alone): `fixture_plan_save`, `fixture_plan_recompute` (a draft
only), `fixture_plan_publish` (never under a support session; supersedes every earlier version not already
superseded; a second call on a published plan is a retry), `fixture_plan_item_begin` (a per-fixture advisory
lock to the end of the transaction, and the match already made) and `fixture_plan_item_record`,
`competition_blackout_add` / `_remove`. A published plan's content never changes (`fixture_plan_guard()`).
All five tables carry db/50's pad guard.

### 5.2 · Reading the inputs from the database

`planner_inputs(competition, from, to)` answers the manager (NULL to anybody else, which the API says as
`not_permitted`). Everything is read in South African days:

- **windows** offered to the competition or to any, wholly inside the range;
- **grounds**: every ground on the same site as a window's ground or an entrant's fixture's ground — up to
  the top of its tree and down every pitch — with `parentId` and its closures near the range. The engine
  closes a pitch when its field is closed and the field when a pitch is (§2);
- **blackouts** of the competition on days in the range;
- **known** fixtures: every match not `abandoned`, starting from 15 days before the range to 15 after (rest
  is at most 14 days), that holds an entrant side (school and team code) or is on one of those grounds: its
  start, ground, the entrants it holds, sport, format and overs, and the plan fixture it was made for when
  this competition's planner made it. No opponent, school or name: a booking is a time and a place;
- **made**: every match this competition's planner has made, whatever its date — the fixture it was made
  for, and where and when the match is now (§5.4 keeps it there).

The API draws only the entrants in the plan: a known fixture's other sides and a blackout for an entrant not
drawn are dropped before the engine sees them.

### 5.3 · How a known fixture's end is derived

`match` records a start and never an end, so `knownFixtureEnd()` (the engine, `fixtureLength()`) gives one:

- **limited overs** (T20, One-Day, any format that is not a declaration, or none stated): two innings of
  the match's `overs` at `OVER_MINUTES` (4) an over, plus `INNINGS_BREAK_MINUTES` (20) — a T20 is 180
  minutes, fifty overs 420. With no overs recorded: fifty for a one-day format, else twenty (the fixture
  route's own default);
- **declaration** (One-Day Declaration, timed, Two-Day, multi-day, a test): whole South African days — the
  number in the name (two to five; multi-day two, a test five), else one — ending at midnight SAST;
- **another sport**: its whole SA day.

Generous on purpose: an end late costs a slot, one early double-books a side. The same function gives a
draft's default `durationMinutes` from the competition's format (the published conditions in force on the
range's first day, then `competition.format`); a declaration format must be told its minutes.

### 5.4 · Drafting, fixtures already made, and publishing

- **The server computes every plan**: the API calls `pairings()` and `plan()` over `planner_inputs()`'s
  document and stores both beside it. A client sends a format, a range, rules, seeds and locks — never a plan.
- **Locks** are set on a draft and recompute it in place over the inputs as they are now; regenerating is a
  new version (`basedOn`), which carries the locks unless told otherwise.
- **A fixture this competition's planner has already made stays where its match is.** In a round robin it
  leaves the draw and its match is a known commitment, so nothing else is put on its sides or its ground; in
  a knockout, whose later rounds need it, it is locked to a window that is exactly its match. A lock the
  organiser set on it is reported stale (`published`).
- **Publishing** first marks the plan published (earlier versions superseded), then checks it against the
  database as it is now: every placed, unmade fixture is locked to its window and `plan()` is run over fresh
  inputs. A fixture whose window is gone is refused `window_withdrawn`; one whose slot no longer fits (a
  booking typed since, a closure, a blackout) is refused `clash` with the engine's reasons. Each remaining
  fixture is, in its own transaction: `fixture_plan_item_begin()`; the body `toFixtureDrafts()` makes (with
  the conditions in force on its own day) through `fixtureInsertParams()` and `insertFixture()` — the
  validation and the insert `POST /api/fixtures` runs, exported from `fixture-api.mjs` for this; then
  `fixture_plan_item_record()`. A refusal anywhere rolls the fixture back whole: no match without its item.
  Knockout rounds past the first are `held` (`awaiting_winner`), as are unscheduled fixtures and a side with
  no team code.
- **Idempotent**: a retry, or a second person publishing at once, finds the item and reports `already`.
  An item is per competition and fixture id, so a later version's same pairing is `already` too.

### 5.5 · The API contract (for the screen)

Every route needs a signed-in token. Every refusal is `{ error, detail? }`: **401** `missing_token` /
`unauthorized`; **403** `not_permitted`, which never says whether the competition, plan, ground or blackout
exists; **404** `not_found` for an id that is not a uuid; **400** for a malformed request; **422** for the
rest. Instants are ISO with an offset (`…Z` or `…+02:00`); a bare local time is refused. Days are
`YYYY-MM-DD` on the South African calendar.

**The planner (the competition's manager)**

- `GET /api/competitions/:id/planner/inputs?from=&to=` →
  `{ competition: { id, name, format, organiserId }, from, to,
     entrants: [{ id, schoolId, teamCode, name, divisionId }],
     windows: [{ id, groundId, startsAt, endsAt, competitionId }],
     grounds: [{ id, name, schoolId, parentId, closed: [{ id, from, to, reason }] }],
     blackouts: [{ id, day, entrantId, reason }],
     known: [{ matchId, groundId, startsAt, endsAt, sport, format, overs, entrants: [entrantId], fixtureKey }],
     made: [{ fixtureKey, matchId, groundId, startsAt, sport, format, overs, status }],
     defaults: { durationMinutes, format, overs } }`.
  Refusals: `range_invalid` (400: from after to, or more than 366 days).
- `GET /api/competitions/:id/plans` → `{ canManage, plans: [{ id, version, state, format, from, to,
  fixtures, placed, unscheduled, basedOn, createdBy, createdAt, computedAt, publishedAt, supersededAt }] }`,
  newest first. The manager sees every version; anybody else only published ones (an empty list otherwise).
- `POST /api/competitions/:id/plans` `{ format, from, to, rules?, locks?, entrants?, basedOn? }` → **the
  plan** (below), version next. `format`: `round_robin` | `double_round_robin` | `knockout`. `rules`: any of
  `durationMinutes` (default from the format, §5.3), `preparationMinutes`, `recoveryMinutes`,
  `restMinutes`, `travelMinutes`, `maxPerDay` (whole minutes; the engine's ranges, §2). `locks`:
  `[{ fixtureId, windowId }]`. `entrants`: entrant ids in seed order (default: every entrant, by name) —
  seed order matters for a knockout. `basedOn`: a plan of this competition; anything not sent is taken from
  it (regenerate is `{ basedOn }` alone). Refusals: `format_invalid`, `range_invalid`, `rules_invalid`,
  `locks_invalid`, `entrants_invalid` (400); `too_few_entrants`, `too_many_entrants` (16),
  `duration_required` (a declaration format), `plan_input_invalid` with the engine's words in `detail`
  (a rule out of range, more than 256 windows …) (422).
- `GET /api/competitions/:id/plans/:planId[?inputs=1]` → **the plan**. `?inputs=1` returns the stored
  inputs in full to the manager; anybody else gets counts.
- `POST /api/competitions/:id/plans/:planId/locks` `{ locks }` → **the plan**, recomputed in place.
  Refusals: `locks_invalid`, `not_a_draft` (422, `detail` the state), `plan_input_invalid`.
- `POST /api/competitions/:id/plans/:planId/publish` →
  `{ plan: { id, version, state }, first, counts: { created, already, refused, held },
     results: [{ fixtureId, round, home, away, outcome, … }] }`, one result per fixture in the draw's order;
  `home`/`away` are names (or "winner of …"). By `outcome`:
  `created` `{ matchId, startsAt, sharedWithOpponent }`; `already` `{ matchId }`;
  `held` `{ held: "unscheduled" | "awaiting_winner" | "no_team_code", text }`;
  `refused` `{ error, detail?, reasons? }` with `error` one of the fixture route's —
  `invalid_fixture` (its `detail` names the rule: a side that has not entered, a side playing itself …),
  `not_permitted` (the publisher may not arrange the home school's fixture), `no_such_school_ground_or_sport`,
  or its 400s — or the planner's: `clash` (with `reasons: [{ code, text }]`), `window_withdrawn`,
  `match_not_in_competition`. `first` is false on a retry. Refusals of the whole call: `superseded`,
  `support_session` (422).

**The plan** → `{ id, competitionId, version, state, format, from, to, rules, locks, basedOn, createdBy,
createdAt, computedAt, publishedBy, publishedAt, supersededAt, canManage,
entrants: [{ id, name, schoolId, teamCode }],
summary: { fixtures, placed, unscheduled, made, byes },
fixtures: [{ id, round, leg, match, home, away, locked, windowId, groundId, groundName, startsAt, endsAt,
             reasons: [{ code, text }], held: { code, text } | null,
             made: { matchId, planId, startsAt, groundId } | null }],
byes: [{ round, entrantId, name }],
staleLocks: [{ fixtureId, windowId, reason, text }],
inputs: { windows, grounds, blackouts, known } }` (counts; the document with `?inputs=1` for the manager).
A side is `{ entrantId, name }` or `{ winnerOf: fixtureId }`. `startsAt`/`endsAt` are the match itself
(after preparation). A fixture with a slot has `reasons: []`; one without lists every reason any window
refused it, in `PLAN_REASON` order, with the words of `PLAN_REASON_TEXT`. A made fixture in a round robin
has `windowId: null` and the slot of its match. `staleLocks[].reason`: `no_such_fixture`,
`no_such_window`, `published`.

**Blackouts**

- `GET /api/competitions/:id/blackouts` → `{ blackouts: [{ id, day, entrantId, entrantName, reason,
  createdAt }] }`, as the reader may see them (§5.1).
- `POST /api/competitions/:id/blackouts` `{ day, entrantId?, reason? }` → `{ ok, id }`; the same day again
  is the same row. Refusals: `day_invalid`, `reason_invalid` (400); `not_permitted`; `entrant_invalid` (to
  the manager only), `reason_too_long` (120) (422).
- `POST /api/competition-blackouts/:id/remove` → `{ ok }`. Refusal: `not_permitted`.

**The ground owner's (facility.manage at the ground's school)**

- `GET /api/grounds/:id/windows[?from=&to=]` → `{ windows: [{ id, groundId, startsAt, endsAt,
  competitionId, createdAt }] }`.
- `POST /api/grounds/:id/windows` `{ startsAt, endsAt, competitionId? }` → the window. Refusals:
  `starts_at_invalid`, `ends_at_invalid`, `window_invalid` (400 ends first; 422 longer than a week, in the
  database's words), `competition_invalid`, `not_permitted`.
- `POST /api/ground-windows/:id/remove` → `{ ok }`.
- `GET /api/grounds/:id/closures` → `{ closures: [{ id, groundId, from, to, reason, createdAt }] }`.
- `POST /api/grounds/:id/closures` `{ from, to, reason }` → the closure. Refusals: `from_invalid`,
  `to_invalid`, `closure_invalid`, `reason_required` (3–120 characters), `not_permitted`.
- `POST /api/ground-closures/:id/remove` → `{ ok }`.
- `POST /api/grounds/:id/parent` `{ parentId: uuid | null }` → `{ id, parentId }`. Refusals:
  `parent_invalid` (422: itself, a cycle, another school's ground, too deep, no such ground),
  `not_permitted`. `/api/read/grounds` now carries `parent_id`; `/api/read/matches` carries
  `competition_id`.
- `POST /api/grounds/:id/ends` `{ endA, endB }` → `{ id, endA, endB }`: the strip's two named ends
  ("Pavilion End", "School End"), both or neither (`null`/`null` clears). Set on the ground a match names —
  the pitch where a field has pitches, since two pitches on one field may lie differently. Refusals:
  `ends_invalid` (one alone, 2–40 characters each, the same name twice), `not_permitted`.
  `/api/read/grounds` carries `end_a_name`, `end_b_name`; `/api/read/matches` carries `ground_end_a`,
  `ground_end_b`. (Added on Kameel's say for the bowling ends a later scoring item records; only the ground
  data now. **No boundary distances**: the scoring model's directions are batter-relative
  (`placement.mjs`), a boundary is fixed to the ground, and tying the two needs a convention about the ends
  that belongs to the scoring item — no figures are guessed. The public pages' header, a db/59 definer
  function, does not carry the ends yet.)

The dispatcher passes a second capture group as `params.sub` (the plan id).

### 5.6 · Left out of phase 2, and why

- **The screen** (Sonnet, from §5.5): inputs, a calendar and bracket preview, reasons in words, locks,
  regenerate, publish with its per-fixture report; the ground owner's windows and closures.
- **The venue does not follow the home side.** `plan()` puts a fixture in any window, so the "home" entrant
  (the one whose school owns the fixture record) may play on another school's ground. Asking the engine to
  prefer, or require, the home side's grounds is a rule for a later phase; today the organiser offers only
  the windows he means, or locks.
- **Nothing is reserved.** A window is an offer; a draft holds no slot; publishing rechecks and refuses a
  clash rather than taking the slot from whoever booked it.
- **Divisions and pools** are drawn by naming the entrants; there is no per-division plan record.
- **A made fixture is not moved or withdrawn by a later version.** Every later version keeps it where its
  match is (§5.4) and publishing reports it `already`; moving one is `POST /api/fixtures/:id` (the route
  that exists), and a match no longer wanted is the school's to call off. A made fixture whose slot a later
  closure or blackout now breaks shows its reasons in a knockout (it is locked) and none in a round robin
  (its match is a known commitment, not re-checked): phase 3's recheck.
- **Approvals** (each school its fixtures, the ground owner the slot) are phase 3.

### 5.7 · Making a league (added to phase 2, Kameel, 2026-09-30)

Until this, a competition existed only by seed: no route created one or entered a side, and the web's
"+ New Competition" had nothing to call. `db/67` §8a–8c and `services/api/write/league-api.mjs` (a new
module beside `competitions-api.mjs`, which keeps divisions; the names differ so the two are not confused)
add the league, its entrants and its first conditions. `tools/smoke-competition.mjs` walks it; db/99 §45
proves it.

**Who.** Creating is `competition.manage` at the organiser — the capability competition's own write policy
has always asked. Its holders are `competitionadmin` (school-less for a shared league, or at a school for
that school's) and the owner's key; both also hold `competition.conditions.manage`, so **the creator is the
competition's manager** (`competition_conditions_manager()`: its conditions, entrants and planner) with no
new role. A Westville-appointed administrator creates Westville's leagues and no other. **Accepting an
invitation** is whoever arranges that side's fixtures — `fixture.update` at the entrant's school and team
(director of sport, school administrator, sports administrator): entering a league commits the side to
fixtures made in its school's name, which is what `fixture.update` already governs, so nothing is widened —
**and never the competition's own manager**: a platform-wide `competitionadmin` holds `fixture.update`
everywhere, and without that exclusion the organiser could accept for any school. Never under a support
session. The application may no longer INSERT an entrant, nor UPDATE its status, school, team or
competition (only the ladder's columns): the functions are the only way in.

**Status.** `competition_entrant.status`: `invited` → `accepted` | `declined`, answered once (a declined
side may be invited afresh). Rows before db/67 are `accepted`. Only accepted entrants are drawn
(`planner_inputs()`), published, shown on the ladder (`/api/read/league`), offered by the fixture screen
(`/api/competitions/entered`), or given a fixture in the competition at all: db/61's
`match_competition_entered()` now asks for an accepted entrant, so the fixture route refuses the rest as
`invalid_fixture`.

**Conditions from a starting point.** Version 1, a draft; publishing is db/61's `condition_set_publish()`,
unchanged (effective from tomorrow at the earliest).
- `defaults`: every catalogue key with a platform default that a reader applies (not the reserved ones);
  `bowling.limit` per band from the platform's fast-bowling directive, its note quoting the band's rulebook
  clause — which says of itself that the figures follow the ECB directives "in the absence of a published
  CSA schedule. Not official wording", so no CSA citation is claimed; the format keys (`format.kind`,
  `format.overs_per_innings`, `format.innings_per_side`, `format.free_hit`) from the competition's format;
  `result.tie_break` = `none` noting the Laws of Cricket (MCC, 4th Edition, Law 16). **Every figure
  `unconfirmed`**, with `sourceNote` saying where it came from; a league confirms one by entering it with its
  own document, clause and date. No points are invented: the league sets its own.
- `competition`: the version in force today of another competition, figures, statuses and citations copied,
  each note ending "Copied from <name>, version N". Only from a competition the caller may read
  (`competition_visible()`, or its manager); anything else is `source_invalid`, the same words as a
  competition that is not there.

**The API** (same conventions as §5.5):

- `POST /api/competitions` `{ name, organiserSchoolId?, compType?, format?, ageGroup?, gender?, level?,
  season? }` → **the competition** `{ id, organiserSchoolId, name, compType, format, ageGroup, gender,
  level, season, canManage }`. `compType`: league (default) | knockout | festival. `format`: T20 | One-Day |
  One-Day Declaration | Two-Day. `level`: school (default) | club | provincial | national. `season`: a label
  such as "2026" that exists at that level. Overs are not a field: they are `format.overs_per_innings`,
  filled from the format by the defaults. Refusals: `not_permitted`, `support_session`, `organiser_invalid`,
  `name_invalid` (3–120), `comp_type_invalid`, `level_invalid`, `format_invalid`, `label_too_long`,
  `season_unknown`.
- `POST /api/competitions/:id` `{ name?, season? }` → the competition. Refusals: `nothing_to_change`,
  `not_permitted`, `has_fixtures` (a match or a published plan exists), `name_invalid`, `season_unknown`.
- `GET /api/competitions/:id/schools` → `{ schools: [{ id, name, code }] }`: whom the manager may invite
  (every school, club or academy on the platform, by name and code); an empty list to anybody else.
- `POST /api/competitions/:id/entrants` `{ schoolId, teamCode, displayName? }` → `{ ok, id, status,
  detail? }` (`detail` "already" or "invited again"; `displayName` defaults to the school's name and the
  team). Refusals: `not_permitted`, `school_invalid`, `team_invalid` (1XI … 20XI, U9 … U19 with A–F),
  `display_name_invalid`.
- `GET /api/competitions/:id/entrants` → `{ canManage, entrants: [{ id, competitionId, schoolId, teamCode,
  name, status, divisionId, invitedAt, respondedAt }] }`, as the entrant's own policy lets the reader see.
- `GET /api/competition-invitations` → `{ invitations: [{ …entrant, competitionName, organiserSchoolId }] }`:
  the invitations the caller may answer.
- `POST /api/competition-entrants/:id/accept` | `/decline` → `{ ok, status }`. Refusals: `not_permitted`
  (including the competition's manager), `support_session`, `not_invited` (`detail` the status).
- `POST /api/competitions/:id/playing-conditions/start` `{ from: "defaults" | "competition",
  sourceCompetitionId?, title?, effectiveFrom? }` → `{ ok, setId, version: 1, entered }`. `effectiveFrom`
  defaults to tomorrow, `title` to "<name> conditions". Refusals: `not_permitted`, `from_invalid`,
  `already_started` (it has a version: `POST /api/condition-sets/:id/new-version`), `source_invalid`,
  `source_has_no_conditions`, `title_invalid`, `effective_from_invalid`.

**The wizard (Sonnet), step by step, over routes that exist:**

1. **League** — `POST /api/competitions`; the seasons from `/api/read/seasons`.
2. **Entrants** — `GET …/schools`, `POST …/entrants` per team, `GET …/entrants` for each one's status.
   Schools answer from their own inbox (`GET /api/competition-invitations`, accept/decline).
3. **Conditions** — `POST …/playing-conditions/start` (defaults, or copy from a league); then a checklist
   of every key from `GET /api/playing-conditions/catalogue` (its `platformDefault`, `unit`, `values`,
   `reserved`) beside the draft's figure from `GET /api/competitions/:id/playing-conditions` (`value`,
   `status`, `sourceNote`, citation): "use default" keeps the pre-filled figure, "own value" is
   `POST /api/condition-sets/:setId/values` `{ key, ageBand?, value, status, sourceDocument?,
   sourceClause?, sourceDate?, sourceNote? }` (confirmed needs document, clause and date), and clearing is
   `…/values/clear`.
4. **Review and publish** — `POST /api/condition-sets/:setId` `{ effectiveFrom }` to date it,
   `POST /api/condition-sets/:setId/publish`; then **open the planner** (§5.5) for the accepted entrants.

**As built: two follow-ups to the screens (web only, no new route).**

- *A part-made league says so.* On Competitions, a manager's live league (the condition "Finish setting
  up" already used: `competition.manage`) reads, once it is on show, the two reads the wizard makes on
  reopening: `GET …/entrants` and `GET …/playing-conditions`. `leagueSetupState({ entrants, sets })`
  (`lib/league.js`) calls the league **part-made** when it has no entrants, or none of its sets has status
  `published` (the database's words are `draft`, `published`, `withdrawn`). A part-made card shows
  "Setting up: step N of 4, <the step's title>", N being `resumeStep`'s (so a league with no sides says step 2,
  with sides and no conditions step 3), and keeps "Finish setting up". A complete league shows neither the
  marker nor "Finish setting up"; "Fixture planner" is unchanged. Until the reads are in, if either fails, or
  if the API says the reader does not manage that league (`canManage` false), the card is exactly as it was
  before: it offers "Finish setting up" and no marker. Entrants count whatever their status, as `resumeStep`
  does, so a league whose only sides declined is not called part-made.
- *Waiting invitations are findable.* The API writes no notification for an invitation (that needs a later
  migration). Until then the shell counts `GET /api/competition-invitations` rows still `invited`
  (`useWaitingInvitations`, `lib/invitations.js`; no role is consulted, because the API already lists the
  organiser none) and badges **Competitions** in the sidebar, and on a phone on its place in the bar or on
  "More" and in the drawer. The count is the badge's text (12px); the button is named "Competitions, 2 league
  invitations waiting" ("1 league invitation waiting" in the singular). Nothing is shown for none, for a
  failed read, or when signed out. It is read again on a change of page, and at once when the invitations panel
  answers one. The existing badge mechanism was the bell's alone (`notifCount`); it is now one prop wider
  (`invites`), not a second mechanism. The dashboard line the brief held in reserve was therefore not needed.
