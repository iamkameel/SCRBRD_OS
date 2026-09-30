# SCRBRD-123 — the fixture planner: the engine

Status: **phase 1 built** (2026-09-30): the engine, with tests, and no database change, route or screen.
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

- **No database, route or screen.** The plan reserves nothing; windows are what the caller declares.
- **Ground hierarchy and closures are input.** `ground` has no parent and `ground_condition` has no closed
  state, so `plan()` takes `grounds` with `parentId` and `closed` spans; phase 2 decides where they live.
- **Soft preferences** (preferred weekdays, less travel, home/away alternation across rounds) and
  **optimality**: the search is greedy and says why a fixture was not placed rather than backtracking.
- **Pools, group-then-knockout, placement matches, reserve days.** Same model, later.
- **Surface, sport and inspection checks** (the source's warnings): `ground.surface` is free text today.
- **Travel times are not guessed**: one `travelMinutes` between different sites, from the organiser.
