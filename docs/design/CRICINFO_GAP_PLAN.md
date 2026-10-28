# Cricinfo audit — gap analysis and implementation plan

**Decided 2026-10-23 (Kameel):** all six open decisions settled; see §9. Sprint 0 approved.
Written from two audits of ESPNcricinfo (both in `audit/`) checked against `main` @ `37f5884`.
Living copy for comments: https://claude.ai/artifact/364Tdggp65zF43gHHkEqgi

Inputs:

- `audit/ESPNCRICINFO_FULL_UX_AUDIT_2026-10-23.md` — the **Full audit**, read against this repo (UX-01 to UX-18).
- `audit/ESPNCRICINFO_LESSONS_AUDIT_2026-10-23.md` — the **Lessons audit**, read against the superseded
  single-file prototype `scrbrd_os.jsx` (recommendations L1 to L12).

---

## 1. Verdict

The two audits agree on the destination and disagree on where SCRBRD is standing. The Full audit is
right: it read this repo, while the Lessons audit read the prototype, which this repo has superseded.
Half of the Lessons audit's "missing" items already exist here. This plan is built on the repo.

The real gaps, confirmed in the tree:

1. **One match page for every role, with a tab row that fits a phone.** `MatchView.jsx` has six equal
   tabs plus a Coach or Captain tab; the scorer's pad is a separate surface.
2. **Ball-by-ball as a navigable chronology.** Commentary is generated and grouped by over, but has no
   filter chips, no over jump, and no link from a scorecard dismissal to the exact ball.
3. **A fixture list that reads as one status sentence per match.** `scores.jsx` prints innings lines
   and a "corrected" note; nothing says "Need 35 off 38" or "Westville won by 23 runs".
4. **Follow and alert categories for parents.** `NOTIFICATIONS.md` is decided and S0–S1 are built;
   follow-a-child, per-category preferences and pinned matches are not.
5. **Coverage and denominators on every chart**, and chart-to-delivery drill-down. `sourceLine.jsx`
   exists but is not applied everywhere; nothing drills from a bar to its balls.
6. **Type floors in the old analytics screens.** `AnalyticsView.jsx` still carries 8–10px type
   against the 12px floor in `CLAUDE.md`.

The Project brief on claude.ai (Material 3, glass, navy and neon gradients, a floating Stadium Bar)
contradicted `docs/redesign/DESIGN_DIRECTION.md`. Kameel settled it on 2026-10-23:
**`DESIGN_DIRECTION.md` stands**, and every screen item below is built against it.

## 2. Codebase reality check

| Claim | Lessons audit (prototype) | Full audit (repo) | Repo today |
| --- | --- | --- | --- |
| Match page tabs | Scorer tabs `score`, `cards`, `analysis`, `history` | Six tabs plus role tab | `MatchView.jsx:60–66` Summary, Scorecard, Commentary, Partnerships, Analytics, Match details; Coach/Captain inserted at `:555` |
| Score hero | Rotating `DynamicBar` | Persistent black `Board` | `ui/board.jsx:214` takes `total, wickets, overs, sub, batters, partnership, bowler, thisOver, insight`. Nothing rotates. No last-wicket prop |
| Commentary | 30-row flat log | Deterministic generator, over groups | `tabs-core.jsx`, `@scrbrd/scoring/commentary`; "Earlier overs" reveal; no chips, no over jump |
| Scorecard | No dismissal grammar | Full card with expandable rows | `scorecard.jsx:216` R, B, 4s, 6s, SR; `howOut()` `:85`; `fowLines()`; wagon wheel in the expanded row |
| Offline sync | "Silent queue" | Local, held, sent distinguishable | `scorer/syncBanner.jsx`: a sentence and one action per state; pill reads "Held 3" |
| Scorer modes | `FocusPad` vs `ScoringPanel` | Basic vs Detailed | `scorer/pad.jsx:444`, `basic` prop |
| Fixture status sentence | — | — | Not present: `scores.jsx` renders innings lines only |
| Follow and alerts | Roadmap | S0–S1 built | S0 (#90), S1 (#97) merged; no follow model, no per-category preferences |
| Public live page | — | Isolation tests needed | `SCREEN_MAP.md` lists it missing; `SCRBRD-083`, `spectator.jsx` exist. Needs one walk to settle |
| Small type | — | 8–10px in `AnalyticsView.jsx` | `:37` 10px, `:41` 9px, `:43` 8px, `:142` 9px, `:156` 9px |
| Corrections | — | Spec; end-to-end unverified | `corrected.jsx`, `corrections.jsx`, GA-I36 |

Neither audit saw `bigscreen.jsx` (ground display), `spectator.jsx` (moment cards, over summaries), or
this backlog. New items go into `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`, not only this file.

## 3. Gap analysis

**Have** = exists, no UX work; **Partial** = exists, needs refinement or QA; **Missing** = nothing on `main`.

| Gap | From | Status | What the repo has | What is missing |
| --- | --- | --- | --- | --- |
| G1 One match page, role-fitted tabs | L2, UX-07 | Partial | `MatchView.jsx` six tabs, role insertion, `TabBar` | Summary, Scorecard, Commentary plus More; pad reachable from the same page; one URL per tab |
| G2 Score hero as a fixed contract | L1, UX-01 | Partial | `Board` total, overs, sub line, batters, partnership, bowler, this over | Last-wicket row; "updated N s ago" and sync word; same `Board` on fixture cards |
| G3 Fixture status sentence | L5, 4.1 | Missing | `scores.jsx`; `live_status` | One sentence per state in `lib/matchCentre.js`, used by list, board and push |
| G4 Commentary filters and over jump | L7, UX-08 | Missing | Over-grouped feed | Chips All, Wickets, Boundaries, Extras, Moments; over jump; per-ball anchor |
| G5 Scorecard to exact ball | UX-03 | Partial | Expanded row shows the dismissal line | Tap → Commentary at that ball; back restores scroll |
| G6 Scorecard grammar, mobile header | L4, 4.3 | Have, QA | All columns, dismissal, extras, FOW, details | Sticky header on mobile; scroll cue |
| G7 Sync state on every surface | L6, UX-04 | Partial | `syncBanner.jsx`; "Held N" | Reader-side "updated at"; duplicate-event walk; low-bandwidth spectator mode |
| G8 Type and touch floors | 4.11, UX-05 | Partial | Floors in `CLAUDE.md`; `design/tokens.js` | Remove 8–10px overrides; 360/390px walk |
| G9 Public child-safe match page | 4.1, UX-06 | Partial | `PUBLIC_DATA.md`, `SCRBRD-083`, `spectator.jsx` | Walk settling whether it is mounted; cache and URL isolation tests |
| G10 Follow and alert categories | L8, L9, UX-15 | Partial | `NOTIFICATIONS.md`; S0, S1 | S2–S5; follow child → team → school; Result-only default; pinned matches |
| G11 Coverage and denominators | UX-09 | Partial | `sourceLine.jsx`; floors in `rating.mjs` | `sourceLine` on every chart; "shots captured for N of M balls" |
| G12 Chart-to-delivery drill-down | UX-10, 4.5 | Missing | Worm, Manhattan, wagon wheel | Select bar or sector → filtered commentary by event ID |
| G13 Tap-to-passport | L10, UX-12 | Partial | Player profile with recognition rows | Sheet over the scorecard; scope-checked link per row |
| G14 Impact score as PoM suggestion | L11 | Missing | Indices in `rating.mjs` | Match impact with reasoning, gated on `RECOGNITION_spec_v0.2.md` §7 fixes |
| G15 Innings-break and result states | L12 | Partial | `fulltime.jsx`, `spectator.jsx` | Hero shows the result sentence (shares G3); Summary replaces Live |
| G16 StatsMagic (the guided Analytics Explorer) | UX-11, 4.6 | Missing | `compare.jsx`, career reads | Question-led chips; saved views keeping scope; after the pilot |

Dropped: the Lessons items "replace flag emoji with crests" (prototype artefact; the repo uses
`SideName` and colour tokens) and "remove `DynamicBar` rotation" (already true of `Board`).

## 4. Where the audits conflict, and the call

| Topic | Lessons audit | Full audit | Resolution |
| --- | --- | --- | --- |
| Baseline | Prototype | Repo `main` | Repo; prototypes marked superseded |
| Visual direction | Project brief with restraint | `DESIGN_DIRECTION.md` | `DESIGN_DIRECTION.md` (decided 2026-10-23); no second style lock |
| Prediction | Surface win probability | No % until calibrated | Decided 2026-10-23: show it now from the existing par line, labelled "par estimate"; recalibrate on pilot ball logs |
| First sprint | Ship the grammar together | Walk before redesign | Both, in order: Sprint 0 walks, then the grammar |
| Scorecard | Freeze to Cricinfo columns | Present; QA semantics | No rebuild |
| Analytics surface | Three public charts | Keep all, add coverage | Spectator gets three; coach keeps the suite with coverage labels |
| Notifications | Result only by default | Decided model, quiet hours | `NOTIFICATIONS.md` with a Result-only default. Changed 23 Oct 2026 (Kameel): S2–S5 before the pilot, not after; see NOTIFICATIONS.md. |
| Who builds | — | — | `CLAUDE.md` routing |

## 5. Roadmap

| Sprint | Contents | Gate to the next |
| --- | --- | --- |
| 0 · Walks (about a week, no screen changes) | Brief settled; 360/390px screenshot set; public-page and sync walks; type-floor sweep | Walks recorded |
| 1 · Grammar (before the next Pilot Match) | Hero contract; status sentence; role-fitted tabs; scorecard to ball; result state; par-line win estimate | Parent and scorer acceptance walks green |
| 2 · Explorable | Commentary chips; coverage labels; chart drill-down; sync and low-bandwidth | One full match scored and followed live |
| 3 · Differentiate (after pilot evidence) | Follow and alerts; tap-to-passport; impact score; StatsMagic design pass | — |

## 6. Work items

Each names the files it touches, the tier `CLAUDE.md` routes it to, and what closes it.
Backlog IDs `CRI-*` are in `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`.

### Sprint 0 — walks

| ID | Item | Files | Tier | Closes when |
| --- | --- | --- | --- | --- |
| CRI-0.1 | ~~Settle the design brief~~ — decided 2026-10-23. Remaining: rewrite or withdraw the claude.ai Project brief | Project description (Kameel) | Kameel | Project brief matches `DESIGN_DIRECTION.md` |
| CRI-0.2 | Screenshot set of Match Centre, Scorecard, Commentary, pad, fixtures at 360/390/768/1440px, Daylight and Floodlit | existing browser walks | Sonnet | Set under `audit/` with a note per clipped element |
| CRI-0.3 | Public live page walk: mounted? any child identity in the payload? | `spectator.jsx`, `SCRBRD-083_public_pages.md`, `docs/policy/PUBLIC_DATA.md` | Opus | Result recorded; `SCREEN_MAP.md` row corrected. walk: browser-public-live; result: mounted at `/live/:id` (with `/scorecard/:id`, `/display/:id`) behind `PUBLIC_PAGES=on`, reached from `/`; no child's identity in any of 83 signed-out responses (28/28) |
| CRI-0.4 | Sync walk: lose signal mid-over, score six balls, regain; no duplicates; "Held N" counts down Changed 28 Oct 2026 (Kameel): the pad sends what it held in one go when signal returns ("Held N", "Sending N", "Sent"); that stands, and the walk checks the count never rises rather than a ball-by-ball countdown. | `scorer/syncBanner.jsx`, `packages/sync/` | Opus | Walk green or defect filed |
| CRI-0.5 | Type-floor sweep: every `fontSize` < 12px and tap target < 44px | `apps/web/src/**` (`AnalyticsView.jsx:37,41,43,142,156` known) | Haiku lists, Sonnet fixes | Zero under-floor values; bundle check green |

### Sprint 1 — the match page grammar

| ID | Item | Files | Tier | Closes when |
| --- | --- | --- | --- | --- |
| CRI-1.1 | `lastWicket` and `updatedAt` on `Board`: "c Smith b Jones 34" and "Updated 4 s ago · Live · Held 2" as fixed rows | `ui/board.jsx`, `scorer/boardData.js`, `lib/announce.js` | Opus data, Sonnet render | Snapshot tests; same `Board` on pad, Match Centre, public page |
| CRI-1.2 | `statusSentence(match, fold)` in `lib/matchCentre.js`, one sentence per `live_status` | `lib/matchCentre.js`, `scores.jsx`, `fulltime.jsx`, fixtures list | Sonnet | Unit test per state; list and hero share it |
| CRI-1.3 | Tabs: Summary, Scorecard, Commentary; the rest and the role tab under More on narrow widths; one route per tab | `MatchView.jsx:60–66, 294, 555`, router | Sonnet, Opus review | Every tab in two taps at 360px; deep link opens the tab |
| CRI-1.4 | "Enter scoring" on the match page for an authorised scorer; reading never enters scoring state | `MatchView.jsx`, `scorer/engine.jsx`, `packages/policy` | Opus | Policy test: unauthorised role never sees it |
| CRI-1.5 | Dismissal line links to Commentary at that ball; back restores tab and scroll | `scorecard.jsx:150, 220`, `tabs-core.jsx`, `dismissalKey` | Sonnet | Walk: scorecard → ball → back |
| CRI-1.6 | Sticky scorecard header and scroll cue on mobile; `role=columnheader` kept | `scorecard.jsx:64–75` | Sonnet | a11y walk green at 360px |
| CRI-1.7 | Summary becomes the result view after full time | `fulltime.jsx`, `spectator.jsx`, `tabs-core.jsx` | Sonnet | Walk on a completed fixture |
| CRI-1.8 | Win probability from the existing par line, labelled "par estimate" on every surface (pulled forward 2026-10-23) | `SCRBRD-130_rain_and_par.md`, `packages/scoring`, `Board` insight | Opus | Label on every surface; calibration note after the pilot |

### Sprint 2 — make the data explorable

| ID | Item | Files | Tier | Closes when |
| --- | --- | --- | --- | --- |
| CRI-2.1 | Commentary chips on event `kind`; over jump; per-ball `id` anchor | `tabs-core.jsx`, `@scrbrd/scoring/commentary` | Sonnet | Filters return the events the scorecard counts |
| CRI-2.2 | `sourceLine` on every chart; "shots captured for N of M balls" | `ui/sourceLine.jsx`, `matchcentre/tabs.jsx`, `scorer/wagonAnalysisPanel.jsx`, `views/compare.jsx` | Sonnet | No chart without a source line |
| CRI-2.3 | Drill-down: bar or sector → filtered commentary by event ID | `matchcentre/tabs.jsx`, `tabs-core.jsx` | Opus | Every run traceable to a listed ball |
| CRI-2.4 | Reader freshness and low-bandwidth mode | `spectator.jsx`, public page, `bigscreen.jsx` | Opus | 3G walk: score in 3 s, no blank state |
| CRI-2.5 | Spectator charts: worm with wicket pins, Manhattan, partnerships; coach keeps all | `matchcentre/tabs.jsx`, role gating | Sonnet | Parent walk three charts; coach walk all |

### Sprint 3 — differentiate, after pilot evidence

| ID | Item | Files | Tier | Closes when |
| --- | --- | --- | --- | --- |
| CRI-3.1 | Notifications S2–S5; follow child → team → school → competition; Result-only default; pinned matches. Changed 23 Oct 2026 (Kameel): S2–S5 before the pilot, not after; see NOTIFICATIONS.md. | `NOTIFICATIONS.md`, `db/`, `services/api/`, home | Opus policy, Sonnet screens | Push is a pointer; preferences walk green |
| CRI-3.2 | Tap-to-passport sheet, scope-checked | `scorecard.jsx`, `tabs-core.jsx`, profile view, `packages/policy` | Opus | Parent own child; coach squad; public nothing |
| CRI-3.3 | Match impact as the PoM suggestion, with reasoning | `packages/scoring/src/rating.mjs`, recognition | Opus | After bowler-credit and dismissed-batter fixes merge |
| CRI-3.4 | StatsMagic (the Analytics Explorer): one Fable design pass (allowed 2026-10-23), then Opus | `views/compare.jsx`, `views/AnalyticsView.jsx` | Fable, then Opus | Design doc for Kameel; build on his say |

## 7. Risks and dependencies

- **The claude.ai Project brief** still carries the old visual direction; new chats there will read it.
- **Sprint 1 touches `MatchView.jsx` and `Board`, which every walk depends on.** Land CRI-1.1 and
  CRI-1.2 on one branch with walks updated, then 1.3 to 1.8.
- **Budget.** Three builders by default; CRI-3.4 is the only Fable spend.
- **Backlog collisions.** Haiku reconciles `CRI-*` against existing Product completeness and Polish
  entries before any builder starts.
- **Public page status unknown.** If CRI-0.3 finds it unmounted, CRI-2.4 and CRI-3.1 move behind SCRBRD-083.

Dependencies: CRI-1.2 feeds 1.1, 1.7 and 3.1. CRI-2.3 needs 2.1's anchors. CRI-3.3 needs the
recognition spec §7 scoring fixes.

## 8. What not to borrow

The news feed, video docking, editorial layers, global content breadth, dense Statsguru-style forms,
professional leaderboards of children, and anything that puts content or an overlay between the reader
and the score.

## 9. Decisions (Kameel, 2026-10-23)

1. **Design brief:** `docs/redesign/DESIGN_DIRECTION.md` stands. The claude.ai Project's Material 3
   glass brief is to be rewritten to match or withdrawn.
2. **Prototypes:** `scrbrd_os.jsx`, `cricket_os.jsx`, `scrbrd.jsx` are superseded, reference only.
3. **Sprint 0:** approved as walks only, about one week, before any Sprint 1 build.
4. **Match page tabs:** Summary, Scorecard, Commentary, plus More.
5. **Win probability:** shown now from the existing par line, labelled a par estimate; recalibrated
   once pilot ball logs exist.
6. **Analytics Explorer:** one Fable design pass allowed in Sprint 3.
7. **StatsMagic** (Kameel, 2026-10-28): SCRBRD's counterpart of Cricinfo's Statsguru is
   called StatsMagic, and it is the Analytics Explorer of G16 and CRI-3.4, renamed:
   question-led chips and saved views over SCRBRD's own data, each keeping its
   reader's scope. Same place in the plan: one Fable design pass in Sprint 3, after
   the pilot. §8 stands: no dense Statsguru-style forms.
   The name is already in the app: Global Search's question box (`askStatsMagic()` in
   `apps/web/src/lib/ai.js`, `POST /api/ai/stats-magic`, `services/api/ai/ai-service.mjs`)
   answers a plain question from the reader's own read path, names masked before the
   model sees them. The Explorer grows from it; the design pass starts there.
