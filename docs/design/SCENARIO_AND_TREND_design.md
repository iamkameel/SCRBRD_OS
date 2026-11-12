# Scenario controls (GA-I29) and the season trend, slice 2 (GA-I23)

**Status:** Design (Opus, 2026-11-11). Kameel answered the questions below on 12 Nov 2026. Nothing here is built.
**Governing decision (Kameel, 11 Nov 2026, word for word):** "Scenario controls (GA-I29) - probability and forecasts are based scoring-rates and overs and what's achievable etc."
**Source, and nothing broader:** `audit/GAP_ANALYSIS_2026-10-05.md` Phase C (I23, I29; "built over existing reads, with its source, unit, window and denominator shown"); `docs/design/CRICINFO_GAP_PLAN.md` (CRI-1.8, decision 5); `docs/design/SCRBRD-130_rain_and_par.md` §10; `packages/scoring/src/pressure.mjs` (`requiredRate`, `rrrTrend`, `chaseRates`, `inningsAtOverEnds`, `parReport`, `parEstimate`); `packages/scoring/src/replay.mjs` (`inningsOverReason`, `wicketsToEnd`, `describeResult`, `revisedTargetMethod`, the `Innings` typedef); `packages/scoring/src/conditions.mjs` (the condition keys); `apps/web/src/lib/par.js`; `apps/web/src/scorer/boardData.js` (`chaseLine`, `atThisRate`, `rainLine`, `boardFromInnings`); `apps/web/src/scorer/signals.js` (`boardInsights`); `apps/web/src/scorer/chartData.js` (`runRates`, `chaseEndWords`); `apps/web/src/views/matchcentre/tabs-core.jsx` (`SummaryTab`); `apps/web/src/display/DisplayView.jsx`; GA-I23 slice 1 (commit `ef0e999d`, #115: `lib/seasonBars.js`, `views/seasonbars.jsx`, `views/demoworm.jsx`, `AnalyticsView.jsx:86`); `services/api/read/read-api.mjs` (`career`, `career_by_season`, `UNRECORDED_COLUMNS`); `db/87_wicket_on_extra.sql` (`player_innings`, its latest definition); `packages/scoring/src/rating.mjs` (`MIN_BALLS_FACED`, `MIN_BALLS_BOWLED`); `apps/web/src/ui/sourceLine.jsx`; `docs/policy/PUBLIC_DATA.md` (§1, §2); `docs/design/GA-I36_corrections_everywhere.md` §2, §3, §5, §7; `docs/design/REACH_parent_pupil.md` (decided 7 and 11 Nov); `docs/design/GA-I24-I25_compare_and_combine.md` (D3, D4, D10, D11).
**Reader:** Kameel on a phone first; then the Opus lead; then whoever builds a slice. Names in the sketches are the seed's (Hilton, Kearsney), never a real child's.

---

## 0 · In one page

**Part A, scenario controls.** One panel on the Match Centre's Summary, signed in and public, while a limited-overs innings is being played. It answers three questions with arithmetic on the score and nothing else:

- *Where is this innings heading?* "At their rate so far (7.25 an over): 145 off 20 overs."
- *What does the chase take?* "Needs 45 off 34 balls: 7.94 an over, 1.32 a ball. 6 wickets in hand."
- *What if they score at a different rate?* A stepper, 0.5 runs an over at a time: "If they score at 8.0 an over: they get there off the last ball."

Every figure is a formula over the fold: runs, legal balls, the allotment, the target, the wickets. No trained model, no history, no percentage. The one percentage already on the board, the **par estimate** (CRI-1.8), is left exactly as shipped and is not touched here (Q1). The panel needs **no new read, route, table, migration or capability**: it folds the log the page already reads. A corrected ball refreshes it by construction, because it is a pure function of the fold.

Two existing projections already say the same thing two ways ("At this rate: 145" in the board's rates; "Projected 145 at 7.25 an over" in the insight lines, from a different minimum). Slice A0 gives the scenario figures one definition in `packages/scoring`, and both become its callers.

**Part B, the season trend, slice 2.** Slice 1 (#115) drew season bars: one bar per player per season, or the side's leaders for one season. Slice 2 adds the season **inside** a season: the side's matches one by one, and a player's innings one by one, each with a line that is drawn only once there is enough to draw it ("Only 4 innings, fewer than the 6 this needs. A guide, not a result."). It needs two new read resources over views that already exist (`player_innings`, `match_live_score`), no migration. A pupil reads his own line and nobody else's; a parent her own child's; staff their side's; the public nothing (Q7, Q8).

---

# Part A · Scenario controls (GA-I29)

## A1 · Decisions this design takes

| # | Decision | Why |
|---|---|---|
| **A-D1** | **Arithmetic only.** Every figure is a rate times balls, a difference or a count, from this innings' own fold. Nothing is fitted, nothing reads another match. | Kameel, 11 Nov: "based on scoring-rates and overs and what's achievable". Phase D (a learned win probability with a held-out evaluation) stays out. |
| **A-D2** | **No new percentage.** The panel never prints a probability, a "chance", "likely" or "favourites". An all-out risk is "6 wickets in hand", never a figure. | A-D1. The par estimate (CRI-1.8) is the board's one percentage and stays the board's (Q1). |
| **A-D3** | **The conditional mood, always.** "At their rate so far … they would finish 11 short", "If they score at 8.0 an over …". Never "they will", "on track", "should win". | Arithmetic says what a rate comes to, not what will happen. The words must not read as a forecast. |
| **A-D4** | **One definition.** `packages/scoring/src/scenario.mjs`, pure, beside `pressure.mjs`. `atThisRate()` (`boardData.js:71`) and `boardInsights()`'s "Projected" line (`signals.js:166`) become its callers. | Two copies today, with two minimums (the first legal ball, and 24 balls). The Match Centre, the public page, the display, the coach's cockpit (`CoachTab.jsx:319`) and the captain's tab (`captainTab.jsx:153`) all import from `@scrbrd/scoring` or `boardData.js` already. |
| **A-D5** | **Client-side over the fold.** No read, route, migration or capability is added. | The fold is already on every screen that shows the board, and it is the single definition of "the balls that count" (GA-I36 §3). |
| **A-D6** | **Team-level only.** The panel names sides by team name and never a player. It adds no batter's or bowler's scenario. | `PUBLIC_DATA.md` L1 (scores are team-level facts), A3 and A4. The existing milestone lines in `boardInsights()` ("needs 6 for his fifty") are not this design's and are not changed. |
| **A-D7** | **Not on the pad.** | The scorer's job is the next ball. The pad already shows "Need 45 off 34 · RRR 7.94". `signals.js` says it: "the pad never shows Tier 2". |
| **A-D8** | **From two overs.** The panel, and every projection on any surface, shows only once 12 legal balls are bowled (`par.js` `TWO_OVERS`, the rule the rate trend already uses). | One minimum for one figure. "At this rate: 120" after one ball of a 20-over innings is not useful (Q3). |

## A2 · The figures: formula, source, unit, window, denominator

**Inputs, all from the fold of the innings on the board.** `R` = `inn.runs` (runs off the bat, extras and penalty runs, as the fold adds them). `b` = `inn.balls` (legal balls). `N` = `inn.overs × 6` (the allotment **as it now stands**, so revised if the umpires revised it). `L` = `N − b` (balls left). `W` = `inn.wickets`. `Wmax` = `wicketsToEnd(inn)` (the squad less one, at most ten). `T` = the chase's target (`matchChaseOf()`, the revised one where there is one). `k` = `floor(b / 6)` (completed overs).

**Source** for every row: "Scored balls" (`SRC_BALLS`), the log the page already reads: `GET /api/matches/:id/events` signed in, `GET /api/public/matches/:id/log` in public, the display's log read. **Window** for every row: "this innings so far", except S6.

| # | Figure | Formula | Unit | Window | Denominator | Where today |
|---|---|---|---|---|---|---|
| S1 | Run rate so far (CRR) | `6R ÷ b`, two places | runs an over | the innings so far | `b` legal balls | `boardData.js` `RR()`, on the board |
| S2 | Balls left | `L = N − b`; also as overs, `fmtOv(L)` | balls | the allotment as it stands | — | `chaseLine()` |
| S3 | Wickets in hand | `Wmax − W` | wickets | now | `Wmax` | **new words**, from `wicketsToEnd()` |
| S4 | Needed, and the required rate | `need = T − R`; RRR `= 6·need ÷ L` (`requiredRate()`); a ball `= need ÷ L` | runs; runs an over; runs a ball | the chase from now | `L` legal balls | `parWords()`, `chaseLine()` |
| S5 | A first innings at rate X | `round(R + X·L ÷ 6)` | runs | the innings to its allotment | — | at X = CRR this equals `atThisRate()` (`R·N ÷ b`, rounded) |
| S6 | The last five overs' rate | `6·(R_k − R_{k−5}) ÷ (b_k − b_{k−5})`, from `inningsAtOverEnds(events, ctx, n, {only: [k, k−5]})` | runs an over | overs `k−4` to `k`, the last five **completed** | the legal balls in them (normally 30) | **new**; the two-fold approach `chaseRates()` already uses, so penalty runs and voids count as the fold counts them |
| S7 | A chase at rate X | reached when `6R + X·L ≥ 6T`, exactly (X is in halves, so `12R + 2X·L ≥ 12T` in whole numbers); then `balls = ceil(6·need ÷ X)`, `spare = L − balls`; otherwise `short = T − floor(R + X·L ÷ 6)` | balls to spare, or runs short | the chase to its allotment | `L` | **new** |
| S8 | A chase at its own rate so far | S7 with X = CRR exactly: reached when `R·N ≥ T·b` (whole numbers); `balls = ceil(need·b ÷ R)` | as S7 | as S7 | `b` and `L` | **new**: the "achievable at the current rate" line |
| S9 | Out of reach off the bat | `need > 6L` | — | now | `L` | **new** |
| S10 | Scores level, and the last ball | level when `need = 1`; on the last ball (`L = 1`): win at `need`, tie at `need − 1` | runs | now | — | `chartData.js` `runRates()` already reads `runs = T − 1` as "level"; `describeResult()` reads level as a tie |

**Rounding, and why it differs between innings.** A first innings rounds to the nearest run (S5), because `atThisRate()` already does and is on three screens. A chase never rounds a run up (S7 uses an exact comparison, then `floor` for the shortfall), so "would get there" and "1 short" can never contradict each other. At 132.6 projected against a target of 133, rounding would say "reached" and the exact test would say "not": the chase must take the exact one.

**What the stepper offers.** X from 0.5 to 18.0 in steps of 0.5. It opens on the CRR rounded to the nearest 0.5 in a first innings, and on the RRR rounded **up** to the next 0.5 in a chase (the smallest offered rate that gets there). The chosen X belongs to the panel while it is open and to this innings; a new innings opens it afresh. It is not stored anywhere.

**Hand figures (the tests' examples).**
- *A chase.* T = 133, R = 88, b = 86 (14.2 overs), N = 120. L = 34, need = 45. RRR = 270 ÷ 34 = 7.94; a ball 1.32. CRR = 528 ÷ 86 = 6.14. At CRR: 88·120 = 10 560 < 133·86 = 11 438, so not reached; floor(88 + 6.14·34 ÷ 6) = floor(122.79) = 122, so 11 short. At X = 8.0 (the stepper's opening value, 7.94 rounded up): 12·88 + 16·34 = 1 600 ≥ 1 596, reached; balls = ceil(270 ÷ 8) = 34; spare 0: "off the last ball". At 8.5: ceil(31.76) = 32 balls, 2 to spare.
- *A first innings.* R = 87, b = 72 (12 overs), N = 120, W = 3. CRR 7.25; at CRR round(87·120 ÷ 72) = 145. Runs at the end of the 7th over 46: S6 = 6·41 ÷ 30 = 8.20, projected round(87 + 8.2·8) = 153. At X = 7.5: 147. "7 wickets in hand · 48 balls left (8 overs)".

## A3 · The words on screen

**Title:** "Scenarios". **Source line** (`<SourceLine>`, GA-I22), on the panel: *Source* Scored balls · *Scope* Hilton 1XI, this innings · *Window* 14.2 of 20 overs · *Basis* From 86 balls.

**A first innings:**

```
Scenarios
Source Scored balls · Scope Hilton 1XI, this innings · Window 12 of 20 overs · Basis From 72 balls.

At their rate so far (7.25 an over): 145 off 20 overs
At the last five overs' rate (8.20 an over, 30 balls): 153
If they score at  [ − ]  7.5  [ + ]  an over: 147
7 wickets in hand · 48 balls left (8 overs)

Arithmetic on the score so far, not a forecast. It does not allow for wickets still to fall.
```

**A chase:**

```
Scenarios
Source Scored balls · Scope Kearsney 1XI, this innings · Window 14.2 of 20 overs · Basis From 86 balls.

Needs 45 off 34 balls: 7.94 an over, 1.32 a ball
6 wickets in hand
At their rate so far (6.14 an over): they would finish on 122, 11 short
At the last five overs' rate (8.20 an over, 30 balls): they would get there with 1 ball to spare
If they score at  [ − ]  8.0  [ + ]  an over: they would get there off the last ball

Arithmetic on the score so far, not a forecast. It does not allow for wickets still to fall.
```

**The sentences, every case.** The builder takes these exactly; a test holds each.

| Case | Words |
|---|---|
| Reached at X, balls to spare | "they would get there with 4 balls to spare" (1: "1 ball to spare") |
| Reached at X on the last ball | "they would get there off the last ball" |
| Short at X | "they would finish on 122, 11 short" |
| Short by one, unrevised target | "they would finish on 132, 1 short: scores level" |
| CRR is nought (no run yet, 12 balls bowled) | the S8 line is left out; S7 still offered |
| Out of reach off the bat (S9) | "Needs 40 off 6 balls: more than six off every ball, so only extras can get there." The stepper is still offered, and its lines are arithmetic like the others |
| Scores level, balls left | "Scores level. Needs 1 off 9 balls" |
| The last ball | "Last ball: 3 to win, 2 to tie" (need 1: "Last ball: 1 to win; scores are level") |
| One wicket left | "1 wicket in hand" (no other word: not "last man", not a risk) |
| The footnote, when the par estimate is also on the board | "Arithmetic on the score so far, not a forecast. The par estimate above is a separate reading of this ground's par." |
| A revised chase (rain) | the S4 line takes `parWords()`'s own suffix: "Needs 45 off 34 balls (DLS): …" or "(revised)". One more line: "If play stops again the umpires may change the target and the overs." |
| Play stopped | the panel stays, with its first line "Play stopped. These use the target and overs as they stand." |
| A first innings the umpires cut | S5 says the allotment as `rainLine()` does: "145 off 16 overs (revised from 20)" |
| A short chase that would be a no result | where the chase's allotment is under `result.min_overs_per_side`, one line: "Under this match's conditions, a chase of fewer than 10 overs that falls short is a no result." (`describeResult()`'s rule) |

**Never written:** a percentage; "chance", "likely", "favourites", "on track", "should", "will"; a player's name; a colour without words. Nothing under 12 px; the stepper's two buttons are 44 px targets; the result is an `<output>` tied to the stepper and announced (polite) only when the reader moves the stepper, never on a new ball (the public page has a live region of its own, `quietMoments`). No motion: the figures change in place, so `prefers-reduced-motion` has nothing to turn off.

## A4 · When the panel is drawn, and the edge cases

Drawn only when **all** of these hold: a limited-overs format (`formatKind()` is not `declaration`; a timed or two-innings match has no overs to divide by); not a super over (`superOverBlock()` already says "Need 4 off 4 · 2 wickets left of 2"); not a scorebook's innings (`inn.summarised == null`); the innings not complete and not at a break (`boardInnings()`'s `atBreak`); the match not decided (`SummaryTab`'s `fullTime`); `b ≥ 12` (A-D8); a chase only with a target.

| Edge | What the design does |
|---|---|
| **Reduced overs** | `N` is `inn.overs × 6`, the allotment as the fold now has it, including a cut made with no stop (`inn.overCuts`). A first innings the umpires cut is projected to its new allotment, and the words say so (A3). |
| **A rain-adjusted target** | The engine has one: `inn.target` after a revision, `target.method` `umpires_revision` or `dls_standard` (`conditions.mjs:101`). The panel uses the target as it stands; it never computes one. The DLS calculation stays on the server (SCRBRD-130 D6) and the DLS par line stays the board's. The panel cannot foresee a second interruption and says so (A3). |
| **Extras** | Every rate includes extras and penalty runs, as `inn.runs` does. Balls are legal balls: a wide or a no-ball adds a run and uses no ball, so it lowers the required rate without spending one. S9 counts six an over **off the bat** per legal ball, and says that extras can add more. |
| **Free hits** | No figure changes: a free hit is a legal ball (`inn.freeHit` changes who may be out, not what a run is worth). The board's own free-hit mark stands; the panel adds nothing. |
| **A last-ball tie** | S10. "Level" is `R = T − 1`, the rule `runRates()` and `describeResult()` already apply. Whether `T − 1` is a tie under every umpires' revision is for the builder to hold in a test against `describeResult()` (§A9). |
| **All out** | Shown as wickets in hand (S3), from `wicketsToEnd()`, so a junior squad of nine has eight. No probability of being bowled out, ever (A-D2). A retired-not-out batter is not a wicket (the fold's rule), so "wickets in hand" counts wickets, not batters fit to bat. |
| **A chase with nothing left** | `L = 0` or `need ≤ 0`: the innings is over (`inningsOverReason()`), the panel is gone and the result view takes the Summary (CRI-1.7). |
| **Penalty runs after the innings** (Law 16.7) | The match is decided; no panel. |
| **The par estimate on the same screen** | Untouched. It is read off the par report and the ground's totals (SCRBRD-130 §10), not off this panel, and the footnote says they are separate (A3). |

## A5 · Where it shows, and who may see it

| Surface | What | Who | Reads |
|---|---|---|---|
| **Match Centre, Summary, signed in** | the whole panel, with the stepper | anyone the Match Centre shows the fixture to (`fixture.read`, `match_read`); the same rows the board is drawn from | `GET /api/matches/:id/events`, folded (`useMatchLog`) |
| **Public match page** | the same panel, the same words (one `SummaryTab` serves both) | anyone with the link to a **published** fixture | `GET /api/public/matches/:id/log`, folded (`public/reads.js`) |
| **Ground display** | no stepper: a pavilion screen has no hands on it. S8 (a chase) or S5 at CRR (a first innings) rides in the display's existing insight rotation, because `boardInsights()` becomes a caller of the module (A-D4) | as the display today (signed in and public, SCRBRD-130 §10) | the display's log read |
| **Pad** | nothing new (A-D7) | — | — |
| **Coach's cockpit, captain's tab** | nothing new beyond the shared figure: their "At this rate" becomes the module's S5 and follows A-D8. The panel itself is not added there in this design | as today | as today |

**Public pages.** `PUBLIC_DATA.md` has no row for projections. The panel is team-level arithmetic on the published score (L1) and names no child (rules 3 and 4, A4), and the public page already shows "At this rate" and the par estimate. So this design reads it as allowed, and asks Kameel to confirm (Q2). Nothing per child is projected, in public or signed in.

## A6 · How a correction refreshes it (GA-I36)

The panel is a pure function of the fold, so it follows a correction by construction, as GA-I36 §3 finds for the charts:

- **A voided or amended ball** leaves the fold on the next read of the log (Match Centre every 15 s while live; public every 15 s on a phone, 5 s on the display; the hub's `events` message where it is open). `R`, `b`, `W` and the last-five window are re-derived, and every line with them. Nothing is cached.
- **The reader's X does not move.** The stepper keeps the rate the reader chose; only the outcome changes. No figure moves under a finger without the reader's own read (GA-I36 §7).
- **A correction that undoes a decided result** (a winning run voided) puts the Summary back into its live view, and the panel back with it. A correction that decides a match removes it.
- **The par estimate beside it** is matched to its position (`reportFor()`: innings, balls, wickets, allotment, stops). A correction that changes only runs leaves the position, and the par at it, valid (par at a point does not depend on runs); one that changes a wicket or a ball waits for the next `…/par` read, as today.
- **Words.** The panel says nothing of its own about a correction. The board's "Corrected 18:42" chip (GA-I36 §5, A1) speaks for the match; a second chip on the panel would say the same thing twice.

## A7 · Slices

| Slice | What | Tier | Needs | Tests |
|---|---|---|---|---|
| **A0** | `packages/scoring/src/scenario.mjs`: S1–S10 as pure functions over a folded innings and the match's conditions, returning figures and their words. `atThisRate()` and the "Projected" insight become callers, both at A-D8's minimum. Exported from `index.mjs` | **Opus** (`packages/scoring`) | Q3 | a unit test per row of A2 and per sentence of A3, against the hand figures; the exact-comparison cases (132.6 against 133); a revised target; a cut first innings; a nine-boy squad; the existing `par-estimate` and board tests unchanged |
| **A1** | The panel on `SummaryTab` (`tabs-core.jsx`), signed in and public: the stepper, the `<output>`, `<SourceLine>`, the footnote, the conditions of A4 | **Opus** (complex frontend, on the public page) | A0; Q2 | `browser-matchcentre` and `browser-public-live` walks: the panel at 12 balls and not at 11; gone at full time; the stepper's 44 px and keyboard; a void that moves the outcome and keeps X; break-ui at 320 and 360 px |
| **A2** | The display: nothing to build beyond A0's change to `boardInsights()`; a walk proves the rotation shows the scenario line and no stepper | **Sonnet** (a walk over designed behaviour) | A0 | `browser-display` |

No migration, no `db/NN`, no policy change, no new read. Bundle: A0 is a few hundred bytes in a package every screen already loads; A1 adds no dependency.

---

# Part B · The season trend, slice 2 (GA-I23)

## B1 · What slice 1 shipped

Commit `ef0e999d` (8 Oct 2026, #115): `lib/seasonBars.js`, `views/seasonbars.jsx`, `views/demoworm.jsx`, the Analytics performance tab (`AnalyticsView.jsx:86`), `test/season-bars.test.mjs`.

- **Season bars** over the `career_by_season` read (SCRBRD-086), and nothing else. With no player picked: the side's leaders for one season, top six by runs or wickets. With a player picked, or a read that shows this reader one player only: his seasons, oldest first, the latest eight.
- **Two nulls that are not zeros:** "did not bat", "did not bowl", never a bar of nought.
- **The source line** (`SRC_RECORD`, "Scored balls and scorebook imports"), the season window, and the basis (innings, with balls faced where every innings has them; balls bowled).
- **The match-by-match worm** stayed a demonstration, drawn only signed out, because "the team's match-by-match worm needs a read of its own (the second slice)" (`AnalyticsView.jsx:87`).

## B2 · What slice 2 adds

Two panels on the same tab, under the season bars, each over a read of its own (B4).

### B2.1 · The side's season, match by match

| | |
|---|---|
| **Measures** | per completed limited-overs fixture of the side in the season: runs, wickets, legal balls and allotment, for and against; **run rate for** (`6 × runs ÷ legal balls`) and **run rate against**; the result word (`match_result()`'s) |
| **Why run rate, not the total** | a school's season mixes 20, 40 and 50 overs and rain-cut matches; a total is not comparable across them and a rate is. The total is printed beside each point |
| **Window** | one school season, the server's label (`school_season_of()`, db/44), fixtures in date order |
| **Denominator** | legal balls in each innings, the balls actually bowled. An all-out innings is **not** charged its full allotment, as net run rate would charge it (Q10) |
| **The line** | the season's run rate so far, for and against, through each match: `6 × Σruns ÷ Σballs` to that match. Drawn from the **5th** completed match; points from the first |
| **Scope** | team-level: a side's totals, no child named |

### B2.2 · A player's season, innings by innings (batting)

| | |
|---|---|
| **Measures** | per innings he batted in the season: runs, balls faced, out or not out ("23*"). Beside the panel, the season so far: runs; average (`runs ÷ dismissals`, "no average yet" with no dismissal, never 0); strike rate (`100 × runs ÷ balls faced`) |
| **The line** | **runs per innings over his last five innings** (a rolling five). Runs per innings, not the average, because its denominator is fixed: an average of a boy retired at 30 three times with no dismissal does not exist, and a not-out in a five-innings window swings it hugely |
| **Window** | one school season; innings ordered by `ended_at`, match and innings, the form guide's order (`career`'s `form`) |
| **Denominator** | innings (the line), balls faced (the strike rate) |
| **Minimum before the line shows** | **6 innings in the season with balls recorded, and 30 balls faced in the five-innings window** (`MIN_BALLS_FACED`, rating.mjs). Six because a rolling five needs a sixth innings to make two points of a line. Points are drawn from the first innings |
| **Scorebook innings** | *Corrected by B1 (13 Nov 2026).* `player_innings` carries a scorebook's batting rows as innings of their own (db/64, db/87: its `summary_batting_line` arm), so an innings imported from a scorebook **is** returned innings by innings, marked `source = 'scorebook'`, with `balls_faced` NULL where the book recorded no balls (never 0). B2 draws it as a point, and leaves a NULL `balls_faced` out of the strike rate and out of the 30-ball floor (the innings counts towards the 6, its balls towards nothing). Summed over a season, the innings are `career_by_season`'s runs, and the scorebook ones its `book_innings` (the trend walk proves both) |

### B2.3 · Bowling, innings by innings: not in slice 2

There is no per-match bowling view. `player_bowling_by_season` aggregates, and writing the bowler's conventions again in a read's SQL (wides and no-balls charged to him, byes not) would be a second copy. db/02's own comment warns against exactly that: "this codebase has already shipped a bug where two folds over the same log disagreed". A per-match bowling view that the season view also calls is a migration, which makes it slice 3, for Opus, on Kameel's say (Q11). Until then the bowler's trend is slice 1's season bars.

## B3 · The words, and a small sample said plainly

Every panel carries `<SourceLine>`, whose `floor` turns a small denominator into words already: "Only 4 innings, fewer than the 6 this needs. A guide, not a result." (`denominatorWords()`, level `small`, drawn with a warning icon, never colour alone).

| Case | Words |
|---|---|
| Player, under 6 innings | Source line basis: "Only 4 innings, fewer than the 6 this needs. A guide, not a result." Note: "The line starts once he has batted 6 times this season. Until then each innings is shown on its own." |
| Player, 6 innings but under 30 balls in the window | basis: "Only 22 balls faced in his last five innings, fewer than the 30 this needs. A guide, not a result." |
| Player, scorebook innings in the season | *Corrected by B1:* they are shown one by one (B2.2). The note says only what the book lacks, for B2 to word: e.g. "2 innings are from a scorebook; 1 has no balls recorded, so it is not in the strike rate." |
| Player, did not bat this season | "Did not bat this season." No axis, no zero |
| Side, under 5 matches | "Only 3 completed matches, fewer than the 5 this needs. A guide, not a result." Note: "The line starts at the 5th match. Until then each match is shown on its own." |
| Side, a rain-cut match | the point says its allotment: "16 overs (revised)" |
| The line's label | "Runs an innings, last five innings" · "Run rate this season so far" |

**No verdict words** (Compare D3): never "in form", "improving", "declining", "best", "struggling". The points and the line are the whole statement (Q9).

## B4 · The reads

Both are SELECTs added to `services/api/read/read-api.mjs`, over views that exist. No migration.

| Read | Over | Scope | Notes |
|---|---|---|---|
| **`innings_by_season`** | `player_innings` (db/87, `security_invoker`, over `ball_event_career`), joined to `match` for `school_season_of(m.starts_at)` and to `player` for the name | the `career` read's, row for row (the invoker views and `player`'s RLS), **narrowed for a pupil** (B5) | `?season=` and `?player=` parameters; one row per player per innings; `runs`, `balls_faced`, `out`, `ended_at`, `match_id`, `innings` |
| **`side_season`** | `match_live_score` (per match per innings: runs, wickets, legal balls), joined to `match` (allotment, `starts_at`, `status`) and `match_result()` | the reader's fixtures (`match_read`) | team-level; completed limited-overs fixtures only |

Both views skip a void and its target on every read (`ball_event_live`, `ball_event_career`), so a correction is in the next read and nothing needs invalidating (GA-I36 §3, the careers row: **works**; D10, no "corrected at" on a career). The client holds no cache beyond the open screen.

## B5 · Who may read a child's trend

| Reader | Slice 2 | Standing on |
|---|---|---|
| **Staff of his side** (coach, team manager, analyst, director) | his line, and the side's | the `career` read's scope today |
| **His parent** (a verified live link) | her own child's line, one child at a time, on the Analytics tab and, if Kameel agrees, her child's screen (Q8) | `player`'s RLS gives her her child's rows only (`seasonBars.js` header); GA-I24 D11: "her child's seasons come with I23"; STEP4 decision 1, never two children merged |
| **The pupil himself** | his own line | `selfaccess` |
| **A team-mate** (a pupil) | **refused**: another boy's line, innings by innings, is a per-boy dossier | REACH-D2, closed 7 Nov. The two 11 Nov exceptions are "season figures" (Compare's one team-mate; the captain's side), and an innings-by-innings line is not season figures (Q7). The new read gates per boy from day one: `is_family_of(player)` or himself or a staff capability (REACH §6.6 path (b), for this read only) |
| **The captain** | his own line; the side's season figures as SCRBRD-138 decided; **not** team-mates' innings-by-innings lines | Kameel, 11 Nov: "the side's season figures, nothing else" |
| **The other school** | nothing | AV-D3 cross-school gates |
| **The public** | nothing, not even the side's line | A4 (no page per player), A3 (no leaderboards) |
| **The side's season panel** (B2.1) | everyone who may read the side's fixtures, signed in; not public | team-level totals already on scorecards they may read (Q10) |

**Who "staff" is, as B1 built it (13 Nov 2026).** The staff arm of `innings_by_season`'s gate is `player.roster.read` or `analytics.read`, asked about the boy's own side or the side he played for in the match (never `'*'`), with no fixture, and never for a reader who is a pupil (`not app_reader_is_pupil()`, the safe default, pending Kameel). The roles that pass: coach, assistant coach and team manager of his side; director of sport, principal, the office (schooladmin), sportsadmin and analyst, school-wide; superadmin, whose every read is logged platform-wide. A member of staff of another side who is also a parent reads his own boy's line and no team-mate's. A scorer, medical, fitness, media, scout, enquiry and spectator read no boy's line, though they may read `career`. `read.test.mjs` holds the exact set.

**A finding from slice 1, for the REACH-D2 build, not fixed here.** Slice 1's "side's leaders" mode shows a pupil his team-mates' season runs and wickets, because `career_by_season` gives a pupil his side's rows (REACH M5). Under the 7 Nov close, only the captain keeps the side's season figures. Hiding the mode in the view would be cosmetic; the read is what discloses, and REACH §6.6 owns it. Slice B1 below must not widen it.

## B6 · Slices

| Slice | What | Tier | Needs | Tests |
|---|---|---|---|---|
| **B1** | The two reads of B4, with `innings_by_season`'s per-boy gate for a pupil; read tests (`read.test.mjs`) and a smoke over a real database: a pupil refused a team-mate's innings, a parent given only her child, a Westville reader refused a Hilton boy | **Opus** (a child's data read path) | Q7 | db proofs: the sum of a player's innings equals `career_by_season`'s runs less `book_innings`'s; a voided ball gone from the next read |
| **B2** | The player's innings-by-innings panel on the Analytics performance tab: points, the rolling-five line, the season figures, B3's words | **Opus** (renders a child's data) | B1; Q8, Q9 | `season-trend.test.mjs` on pure figures (the rolling five, the 6-innings and 30-ball floors, not-outs, did not bat, scorebook innings); a11y walk; "Show as table" and a spoken summary (GA-I31) |
| **B3** | The side's season panel, replacing `DemoWorm` for a signed-in reader (the demonstration stays signed out) | **Sonnet** builds, **Opus** reviews (a simple screen over B1's read, team-level) | B1; Q10 | the 5-match floor; a rain-cut point; "Show as table" |
| **B4** | Bowling innings by innings: a per-match bowling view the season view calls, then its panel | **Opus** (a migration) | Kameel's say (Q11) | db/99 proofs that the season view is unchanged row for row |

---

## Questions for Kameel

**Kameel's answer (12 Nov 2026, 00:29 SAST, on the Build Board): All 12 as recommended.**

- **Q1:** Leave it as shipped: the par estimate stays, labelled "Par estimate", and the scenario panel adds no second percentage.
- **Q2:** Yes, the scenario panel may appear on the public match page, team-level arithmetic on a published score, no child named.
- **Q3:** 12 legal balls is the minimum before any projection on any surface.
- **Q4:** No scenario on the pad. Scenarios are for readers.
- **Q5:** Not now. Bowlers' overs left is a later slice, signed-in staff only, if a coach asks.
- **Q6:** Yes, in the ground display's existing insight rotation, with no stepper.
- **Q7:** No. A pupil may not read a team-mate's innings-by-innings line. The new read is gated per boy from the start.
- **Q8:** Yes, one child at a time: a parent sees her child's innings-by-innings line on his own screen, as well as on Analytics.
- **Q9:** No verdict words on a trend. Points and a line only.
- **Q10:** Yes to all three: rates over balls actually bowled, signed in for anyone who may read the side's fixtures, not public.
- **Q11:** Bowling innings by innings (B4) is built after B2 and B3, if coaches ask for it in the pilot.
- **Q12:** Yes: 6 innings and 30 balls for a batter, 5 matches for a side.


| # | Question | Recommendation |
|---|---|---|
| **Q1** | Your 11 Nov decision bases forecasts on scoring rates, overs and what is achievable. The board already shows one percentage, the **par estimate** (CRI-1.8, your decision of 23 Oct), read off the par line and the spread of the ground's own past totals. Does the 11 Nov decision withdraw it, or leave it? | **Leave it as shipped.** It is labelled "Par estimate", only appears where a ground has a par on record, and has its own calibration plan after the pilot (SCRBRD-130 §10). The scenario panel adds no second percentage and says the two are separate. If you want no percentage that reads past matches, the estimate is one line to switch off (`estimateLine()`), and nothing in this design depends on it. |
| **Q2** | May the scenario panel appear on the **public** match page? `PUBLIC_DATA.md` has no row for projections. | **Yes**, the same panel: team-level arithmetic on a published score (L1), no child named. The public page already shows "At this rate" and the par estimate. |
| **Q3** | One minimum before any projection on any surface: **12 legal balls** (two overs)? Today "At this rate" shows from the first ball and the "Projected" insight from 24. | **12 balls**, the rate trend's own minimum. |
| **Q4** | No scenario on the **pad**? | **None.** The scorer has the equation already; scenarios are for readers. |
| **Q5** | A scenario for the fielding side: **bowlers' overs left** (`bowling.max_overs_per_bowler_innings`)? | **Not now.** It names children, so it would be signed-in staff only (the coach's cockpit); a later slice if a coach asks. |
| **Q6** | Should the ground display show a scenario line at all? With A0 it rides in the existing insight rotation. | **Yes, in the rotation**, no stepper. If the pavilion screen is already full, it is one line to leave out. |
| **Q7** | May a **pupil** read a team-mate's innings-by-innings line? | **No.** Gate the new read per boy from the start. The 11 Nov exceptions (Compare's one team-mate, the captain) are season figures and do not stretch to it. |
| **Q8** | Does a **parent** see her child's innings-by-innings line on her child's own screen, as well as on Analytics? | **Yes, one child at a time.** She already reads his season figures; this is the same rows, finer. |
| **Q9** | **No verdict words** on a trend ("in form", "improving")? | **None.** Points and a line only, as Compare D3 decided for two players. |
| **Q10** | The side's season panel: rates over the **balls actually bowled** (not net run rate's full allotment for an all-out side); signed in for anyone who may read the side's fixtures; **not public**? | **Yes to all three.** NRR's convention belongs to the standings table, which has it already. |
| **Q11** | **Bowling innings by innings** (slice B4) needs a migration. Build it after B2 and B3, or leave the bowler's trend at the season bars? | **After B2 and B3**, if coaches ask for it in the pilot. |
| **Q12** | The minimums for a trend line: **6 innings and 30 balls** for a batter, **5 matches** for a side? | **Yes.** They are the rating floor's 30 balls and the least a rolling five needs to be a line. |

## What I could not settle from what I read

1. **`match_live_score`'s scope** for `side_season`: I did not read db/45 or db/48, so whether the view is `security_invoker`, and whether a scorebook's innings (`innings_summary`) appears in it, are B1's to establish before the read is written.
2. **A tie under an umpires' revision.** `describeResult()` says "short: a win by the runs short; level: a tie", and `runRates()` takes level as `T − 1`. I read no case where an umpires' revision makes `T − 1` something other than a tie. A0's tests must hold S10's words to `describeResult()` on a revised chase, and drop "scores level" if the two ever disagree.
3. **Junior retirement rules.** `batting.retire_at_runs` is a recorded condition with no reader (`conditions.mjs:128`). If a pilot competition retires batters at 30 and lets them return, "wickets in hand" is still true, but it is not "batters left". The words say wickets, deliberately.
4. **The pupil's exposure through slice 1** (B5): a REACH-D2 build matter, recorded here and not fixed.
5. **The coach's cockpit and the captain's tab** call `atThisRate()` today. A0 changes their minimum to 12 balls; I did not read SCRBRD-136 or 138 to see whether either design fixed a different one.
