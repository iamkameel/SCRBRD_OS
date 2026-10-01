# SCRBRD-133 — The immersive Match Centre and the ground display: the design

**Status:** for Kameel's review, 2026-10-01. Nothing here is built. Design within Kameel's brief of 2026-10-01 (the build order: ground display → par and pressure → charts that move, moment cards and the over story) and his four guardrails: no public rankings of children; motion respects "reduce motion"; text at 12px or more and colour never the only signal; every figure real, no placeholder numbers and no invented records.
**Reader:** Kameel first; then Opus, who builds the parts §8 names for him; then Sonnet for the screens named there.
**Fits:** `docs/redesign/DESIGN_DIRECTION.md` (§1 the Board, §1a "the pad is for speed, the board is for emotion", §3.6 motion, §10 the three tiers); `docs/policy/PUBLIC_DATA.md` (decided and signed off); `SCRBRD-083_public_pages.md` (the public read path as built; §5 the overlay; Q9 the big screen); `SCRBRD-130_rain_and_par.md` §3.3, §5, §6 (DLS par at a point, venue par at a point, and their fallbacks); `SCRBRD-114_phase3_results_super_over.md` §1, §3.5, §11 (the super over's board and result words, as built in 3a and designed in 3b).
**Sources:** the code as it stands (`ui/board.jsx`, `scorer/boardData.js`, `views/matchcentre/*`, `public/PublicMatch.jsx`, `lib/announce.js`, `scorer/signals.js`, `packages/scoring/src/commentary.mjs`, `db/08` `broadcast_state()`, `db/59`, `services/api/public/`). Everything else is marked **A** (assumption) and listed in §10. Figures in the sketches are the DESIGN_DIRECTION's own illustrative ones (Hilton 142/3, D Erasmus, K Naidoo); no sketch figure is a claim about any real match.

**Lead's review (Opus, 2026-10-01), before Kameel reads it.** The design holds; the four corrections below are to its facts, not its decisions.
- **A3 is already true:** the public log route takes `?since=` today (`public-api.mjs`, tested in `public.test.mjs`). G1 has no route work for it.
- **A10 is a bug, confirmed:** a wicket the free hit saved keeps `type "W"` with `freeHitSaved` set (`replay.mjs`), and `boardBall()` draws any `"W"` as W, so the Board's "this over" shows W for a batter who is not out. It is fixed on its own, before G1, not left to the strip's test.
- **A11 and A12 are built:** SCRBRD-130 R1–R3 (db/73–75) are in the db/71–76 PR, so `inn.stopped`, `venue_par` and `dlsParAt` exist as §3 and §2.2 read them.
- **Numbering:** this was written on main. db/99 §50–§55 belong to db/71–76 and §56 to db/77 (End a role). G2's migration and section take the next free numbers when it is built, not db/78 and §50.

---

## 0 · In one page

A Saturday at Hilton. The director of sport opens the fixture's Publication screen, which already has the switch that makes the live page public. Under it is a new section, **Ground display**: a link, a QR code, Daylight or Floodlit, and a line that says *8 of 11 named on public surfaces · 3 shown by position*. He opens the link on the pavilion TV's browser and walks away. Nobody signs in at the TV, nothing on it can be tapped into, and if someone copies the link they get exactly the live page's data: the public projection, with every name through the consent rule on the server.

The TV shows the Board, edge to edge and black, as the Match Centre's big screen shows it today, with the run count ticking and figures that flip. Under it a panel changes every twelve seconds: the worm with a dashed line that says *Par here 128*, the partnership, the last six overs as rows of chips, the bowler's figures, where the runs went. A four puts a chip-coloured **FOUR** in the corner for two and a half seconds; a fifty puts a lime card there for four; a wicket cuts the panel to the fall of the wicket for eight seconds and goes back to where the rotation was. At the innings break the four facts hold. At full time the result holds, and after ten minutes the display dims and stops reading.

The Board's second line says *12 ahead of par for this ground* while the first innings is on, from the ground's own record of first-innings totals, and nothing at all at a new ground. In the chase it says *Need 45 off 34 · RRR 7.94, climbing*, because the required rate at the end of the last three overs rose. After rain, with the DLS table loaded, the dashed par on the worm is the DLS par at this point, labelled *calculated*, and the words are *3 ahead of DLS par*. There is no pressure percentage anywhere: a 0–100 "pressure" is a number nobody measured, and this design shows gaps and trends that the log can prove instead.

The same three pieces — the worm that grows, the moment cards, the over story strip — go on the Match Centre's Summary tab and on the public live page, as one component each. The signed-in big screen becomes the same display view with signed-in names, which keeps SCRBRD-083 Q9 as decided.

---

## 1 · What the ground display signs in as

### 1.1 Plain words

**Nothing.** The display is a public page, `/display/:match`, served by the public router like `/live/:match`, reading the same redacted log and header with no credential, no session and no API client. It is switched on by the same switch that publishes the live page, under `broadcast.publish`. It can never show a child's name beyond what the live page shows, because it has no way to ask for more.

### 1.2 The three options, weighed

| option | what it would show | who creates it | how it ends | why not / why |
|---|---|---|---|---|
| **(a) Public data only** — the page's own reads, no credential | exactly the live page: team facts, figures, labels under the consent rule (L2), positions otherwise | whoever holds `broadcast.publish` publishes the fixture and opens the link | the result card, then sleep; nothing to revoke because nothing was granted | **Recommended.** The brief's own rule ("never beyond what public pages allow") leaves a credential nothing to unlock; the server applies the rule; a copied link leaks nothing the link already shows |
| (b) A display credential, one match (or one ground and one day), device-bound like the pad's resume credential (db/50) | the same public projection (the rule stands), or signed-in names if Kameel wanted a ground's crowd treated like a painted scoreboard | `broadcast.publish`; the TV's browser mints a key pair, the credential binds to it, expires at the next Johannesburg midnight | expiry, `match_complete`, or revoked from the setup screen | A migration, an issue/verify/revoke function set, RLS, a proof and a DPoP flow on the weakest browser the product has (a TV's). It buys one thing: a display for a fixture the school has not published to the world. That is a real but small need, met later by a flag, not a credential (§9 D2) |
| (c) A staff session on the TV | everything the signed-in person can read | a coach signs in at the TV | the token's 30-minute life (`auth.mjs TOKEN.ttlSec`), then a dead board; or a long session nobody is watching | **Never.** An unattended screen with a session that can reach the day sheet's medical status is the exact thing the masking exists to prevent. Also it goes dark mid-match |

### 1.3 Who creates it, how it ends, what it may never show, how it stays live

- **Who.** The roles that hold `broadcast.publish` (two in `packages/policy/src/roles.mjs` today; **A**: the director of sport and the school office). The switch is the fixture's existing publication row (`fixture_publication`, db/47, home and away published separately): the display is on when the **home** side has published (**A**: a display at a neutral ground is the home side's to switch on, as the fixture is theirs to publish). No new table, no new capability.
- **The setup section** (signed in, on `views/publication.jsx`, beside the live-page switch): the link and a QR; **Daylight / Floodlit**; dwell **Normal (12 s) / Long (24 s)**; **Reduce motion**; *N of 11 named on public surfaces · M shown by position*, with a link to where consent is recorded. The choices travel in the URL (`?theme=daylight&dwell=long&motion=reduce`); nothing is stored and nothing is counted (083 Q8: no page-view counter).
- **How it ends.** The match's result is read from the public header (`match.result`, 3a). The display shows the result card, polls nothing further, and after ten minutes dims to the sleep state (the result still readable, the rest at `board.dim`). A withdrawn publication 404s the next read and the display shows *This display is no longer available* over a blank board. A TV left on overnight shows a dim result card and does not touch the API.
- **What it may never show** — the public rule, applied on the server, by construction: no full name, no first name, no photo, no date of birth or age (the age group on the team code stays), no health (so no reason for a retirement, and no "unavailable"), no discipline, no officials (083 Q5: none on the page in phase 1, so none here), no per-player shot map (L7), no leaderboard or record across matches (A3; the brief's "no public rankings of children"), no sponsor or strapline in this phase (§9 D13), no weather and no pitch report (the public header carries none), never a demonstration or reconstructed fixture (the public read has no seeder).
- **How it stays live.** The public log read is already incremental (`public_match_log(p_match, p_since)`; the route gains `?since=`, **A**: it does not take it today). The display reads `/log?since=<last seq>` every **5 s** while the header says `live`: the API's live cache TTL is 5 s (`LIVE_TTL_MS`), so nothing faster can return anything newer, and a ball at school pace is thirty seconds apart. Each read brings 0–2 balls, which is what "charts grow ball by ball" needs (§4.4). The header is re-read every 60 s and after every read that brought an `innings_end` or a `revision`. Ball events do not `pg_notify` (114 §10.2 item 11), so there is no push channel to use; a server-sent stream is a later improvement, not a need. The rate limit must allow one display plus the pavilion's parents on one shared address (**A**: the public router's `RATE` is tuned to 1 request per 5 s per match per address with headroom; the lead confirms).
- **The signed-in big screen** (Match Centre, "Big screen") is attended and signed in and stays so, as 083 Q9 decided. It becomes the same `DisplayView` fed by the signed-in fold and names, with its "Exit big screen" button and Escape. Q9's "one-tap public names mode" is **opening the ground display** from the setup section: one component, two feeds, and no third projection to get wrong.

---

## 2 · The panels and their rotation

### 2.1 Plain words

The score never leaves the screen. The Board is a fixed band; beneath it one panel at a time takes a turn, twelve seconds each, in a fixed order; a panel with nothing true to show is skipped. A wicket, a milestone, the end of an innings, a result and rain interrupt the rotation in the ways §2.4 lists. A moment card sits in the Board's top-left corner and never over the total.

### 2.2 The panels

Every figure is the fold's (`deriveMatch` over the public log), through functions that already exist where named. "Label" means the public projection's label for a boy: "D Erasmus" with consent, "Batter 3" without.

| # | panel | shows | source | skipped when |
|---|---|---|---|---|
| B | **The Board** (fixed band) | team, total/wickets, overs, the second line (§3), the two batters with the striker lit, the partnership, the bowler, this over's chips, the Tier 2 insight line | `boardFromInnings()`, `boardInsights()`, `useTicker()`; the second line from §3 | never: before the first ball it says *The board opens with the first ball* over the pre-toss facts |
| 1 | **Worm** | cumulative runs by over for the innings in play (white), the other innings (dim) in a chase, wickets as marks, the target as a solid labelled line, the par as a dashed labelled line (§3) | `inn.overLog` → per-over totals (`wormSeries()`, new, pure); `inn.fow`; `inn.target`; the par read | fewer than one completed over |
| 2 | **Partnership** | the pair by label, the stand's runs (balls), each batter's share as two labelled bars, the stand's run rate; below, the innings' stands as bars with the wicket each ended at | `inn.curPartner`, `inn.partnerships`, `inn.batsmen` | between a wicket and the next batter (no pair) |
| 3 | **Over story** (the strip, §6) | the last six overs as rows: over number, bowler's label, the chips, runs and wickets, score after the over | `inn.overLog`, `boardBall()`, `chipFor()` | before the first completed over |
| 4 | **Bowling** | the bowler on: label, figures, economy, his overs as rows of chips; the other bowlers' figures as a table | `inn.bowlers`, `inn.overLog` | before the first ball |
| 5 | **Runs per over** | one bar per over, wickets marked on the bar, the innings' run rate as a line | `inn.overLog` | fewer than four completed overs |
| 6 | **Where the runs went** | the side's twelve sectors shaded by runs (the public `TeamWheel`, L7) | `/api/public/matches/:id/shots` | fewer than twelve placements, or the read says none |
| 7 | **Fall of wicket** (interrupt only) | the dismissal line, the batter's label and score, the stand that ended, the score at the fall, the new batter's label | the wicket's commentary line, `inn.fow`, `inn.partnerships` | — |
| 8 | **Innings break** (holds) | the chase's target in words, then the four facts: top scorers, best bowling, most boundaries, best strike rate, by label | `inningsBreak()`, `InningsBreakCard` as built | — |
| 9 | **Result** (holds) | the result words; both innings' lines; the super over's block under them when there was one | `resultText(match, result, {reasons:false})`, 3b's board block | — |
| 10 | **Stopped** (holds) | *Play stopped (rain) at 12.3 ov, 87/3, 14:32* and the revised figures when there are any | `inn.stopped`, `inn.revised` (R1; until R1 ships, `revisionNotice()` as built) | — |
| 11 | **Pre-toss** (holds) | the sides, the ground, the start, the format | the public header, `PreTossCard` as built | — |

Panels 1–6 are the cycle, in that order. The Tier 2 insight line on the Board keeps its own 8 s turn, as built.

### 2.3 Timing

- Dwell **12 s** per panel (Long: 24 s). The insight's 8 s is read at arm's length; a panel at ten metres is read in sweeps, and a chart takes two.
- A panel's entrance is a 280 ms cross-fade (`motion.panel`, `ease`); nothing slides. Under reduced motion, a cut.
- The cycle resumes **where it was** after an interrupt, not from the start, so the worm is not the only panel anyone ever sees.
- Nothing is interactive on the ground display; on the signed-in big screen Space pauses the rotation and Escape leaves (WCAG 2.2.2 is met by the setup's Long dwell and the pause key; the ground display has no pointer and no reader, and the Board, which is what changes, is not the thing rotating).

### 2.4 What interrupts the cycle

| event (from the fold / the arrivals) | the Board | the corner | the panel area | then |
|---|---|---|---|---|
| a four or a six (`four` / `six` arrives) | the chip scales in; the figures flip; the count ticks | **FOUR** / **SIX** beat, 2.5 s | nothing | — |
| a wicket (`wicket` arrives) | the W chip; the wickets figure flips | **WICKET** card with the dismissal line, 4 s | cuts to **Fall of wicket** for 8 s | resumes where it was |
| a milestone (`milestone` arrives: a batter's fifty or more, a stand's, five wickets, a hat-trick) | — | the lime card, 4 s (hat-trick 6 s) | holds the current panel for the card's time | resumes |
| on a hat-trick (`milestone` "… is on a hat-trick") | the tag **Hat-trick ball** beside the chips | — | — | the tag goes with the next counted ball |
| a free hit to come (`inn.freeHit` after the latest ball) | the tag **Free hit** beside the chips | — | — | the tag goes with the next ball |
| end of over (`over_end` arrives) | the over summary line under the chips, 6 s (`OverSummary`, as built) | — | the strip gains the row at its next turn | — |
| end of innings (`innings_end` arrives) | the completed innings stays on the Board | **INNINGS CLOSED · 164/7 (20)**, 6 s | **Innings break** holds | until the next innings' first ball |
| the chase's innings starts (`innings_start`, innings 1 or a super-over pair) | the Board turns to the chase | **TARGET 165 from 20 overs** (+ *(DLS)* where the target is a DLS one), 6 s | the cycle starts from the worm | — |
| the result (the synthetic `result` line, as `MatchView` builds it; the public page gains the same line) | the final score | the result words, held | **Result** holds | sleep after 10 min |
| play stopped (`inn.stopped`, R1) | the Board stays | **PLAY STOPPED · rain · 12.3 ov**, held | **Stopped** holds | `play_resumed` restarts the cycle |
| a revision (`revision` arrives) | the second line changes | **OVERS REVISED TO 16** / **TARGET 134 from 16 (DLS)**, 6 s | — | — |
| penalty runs (`penalty` arrives) | the figures flip | **5 PENALTY RUNS to Hilton** (the side, never a boy; 083 Q4), 4 s | — | — |
| a super over (`innings_start` with `superOver: n`) | the Board's super-over block (3b) | **SUPER OVER · Northwood to bat**, 6 s | the cycle: worm (the pair only), partnership, strip | — |

Nothing is replayed on a reload or a reconnect: only a line that **arrives while the page is open** is a moment, exactly the rule `live.js` applies today, and a burst of more than six arrivals in one read is a gap (the TV was asleep) and cuts to the current state with no moments (§4.4).

### 2.5 Layouts

Sizes are `max(floor, Xvmin)` so one rule fits every screen; the floors are §2.6's. Illustrative figures throughout.

**16:9 TV (1920×1080 or 1280×720)** — the Board band is the top 40 %; the panel the rest.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ████████████████████████████████ BOARD ███████████████████████████████████████│
│  HILTON COLLEGE 1ST XI                                        142 / 3        │  team 3.2vmin · total 26vmin
│  14.2 overs · Need 45 off 34 · RRR 7.94, climbing             (lime 6vmin)  │
│  ● D Erasmus 23 (18)    R Pillay 17 (12)    Partnership 43 (27)              │  4.4vmin
│  K Naidoo 1/31 (3.2)                        · 4 1 W · 2wd   [Free hit]       │  3.6vmin · chips 3.6vmin
│  D Erasmus needs 4 for fifty                                                  │  insight 3vmin
├───────────────────────────────────────────────────────────────────────────────┤
│  WORM                                  Target 187 ───────────────────────     │  panel title 3.2vmin
│                                    ╭──────                                    │
│                              ╭─────╯  ·  ·  ·  Par here 128 (dashed)         │
│                      ╭───────╯ W                                              │
│              ╭───────╯                                                        │
│      ╭───────╯  W                                                             │
│  ────╯                                                                        │  axis labels 2.4vmin
│   0      4      8      12     16     20                                       │
│  Hilton (white) · Kearsney (dim) · Par: this ground, 9 innings (dashed)       │  legend 2.4vmin, words not colour
└───────────────────────────────────────────────────────────────────────────────┘
   ┌──────────┐
   │  FOUR    │  ← the corner: top-left of the Board, ≤ 40 % wide, never over the total
   └──────────┘
```

**4:3 projector (1024×768)** — the same bands at 42 % / 58 %; the batters and the bowler stack in two rows instead of one; chips wrap to a second row rather than shrink.

```
┌─────────────────────────────────────────────────────┐
│ ██████████████████ BOARD ███████████████████████████│
│  HILTON COLLEGE 1ST XI                142 / 3       │
│  14.2 overs                                         │
│  Need 45 off 34 · RRR 7.94, climbing                │
│  ● D Erasmus 23 (18)      R Pillay 17 (12)          │
│  Partnership 43 (27)      K Naidoo 1/31 (3.2)       │
│  · 4 1 W · 2wd                                      │
├─────────────────────────────────────────────────────┤
│  PARTNERSHIP · 3rd wicket · 43 (27)                 │
│  D Erasmus  ████████████  23 (18)                   │
│  R Pillay   ████████      17 (12)                   │
│  extras 3 · run rate 9.56                           │
│  1st  ██████ 31 (D Erasmus, R Pillay)               │
│  2nd  ████████████ 68                               │
└─────────────────────────────────────────────────────┘
```

**Portrait (a phone on a stand, 390×844, or a rotated monitor)** — the Board stacks: team, total, overs, the second line, batters one per row, the stand, the bowler, the chips; the panel beneath takes the remaining height; the worm's x-axis still fits because it is overs, not balls.

```
┌──────────────────────────┐
│ ████████ BOARD ██████████│
│  HILTON 1XI              │
│         142 / 3          │  26vmin = 101px at 390 wide
│  14.2 overs              │
│  Need 45 off 34          │
│  RRR 7.94, climbing      │
│  ● D Erasmus 23 (18)     │
│    R Pillay 17 (12)      │
│  Partnership 43 (27)     │
│  K Naidoo 1/31 (3.2)     │
│  · 4 1 W · 2wd           │
├──────────────────────────┤
│  OVER STORY              │
│  15  Naidoo  · 4 1 W · 2wd  7 · 1W  142/3 │
│  14  Smith   1 · · 4 2 ·    8      135/2 │
│  13  Naidoo  · · 1 · 6 1    8      127/2 │
│  …                        │
└──────────────────────────┘
```

### 2.6 Readability at ten metres

- **The rule (A):** a sighted viewer reads text comfortably when its cap height is about 1/200 of the distance — 5 cm at 10 m, 1.5 cm at 3 m. On a 55-inch 1080p TV a CSS pixel is 0.63 mm, so 5 cm of cap height is about 80 px, which with DM Mono's cap height (≈ 0.7 em) is a 113 px figure. From that:

| what | size | at 1080p | read from (A) |
|---|---|---|---|
| the total and wickets | `max(56px, 26vmin)` | 281 px | 25 m |
| overs | `max(32px, 10vmin)` | 108 px | 15 m |
| the second line (need, par, rate) | `max(20px, 6vmin)` lime | 65 px | 9 m |
| batters, partnership | `max(16px, 4.4vmin)` | 48 px | 6.5 m |
| bowler, chips | `max(16px, 3.6vmin)` | 39 px | 5.5 m |
| panel titles | `max(14px, 3.2vmin)` | 35 px | 5 m |
| chart labels, legend, insight | `max(12px, 2.4vmin)` | 26 px | 3.5 m |
| **floor on the display** | `max(12px, 2.2vmin)` | 24 px | 3 m |

  The brief's 12 px floor is the `max()`'s first argument everywhere, so a phone in portrait never goes under it (2.2vmin at 390 wide is 8.6 px, and the floor wins). `smoke-a11y`'s under-12px check runs on the display at every size.

- **Contrast.** The Board never changes (DESIGN_DIRECTION decision 6): `board.figure` on `board.face` is about 18:1, `board.lime` 10.8:1, `board.dim` about 6.3:1. Through daylight glare on a pavilion TV the black board with bright figures is the right way round: reflections wash a light surface before they wash a black one.
- **Daylight and Floodlit** are the display's two settings, from the setup section, and they change only three things, because the board's black, white and lime do not move: in Daylight, `board.dim` lifts one step to about 10:1 (**A**: `#b8c0cc`, to be measured on a real pavilion TV in sun), a 2 px rule separates the Board's rows, and chip outlines thicken to 2 px so an extras chip survives glare. A projector in a bright room has the same problem (projected black is grey) and takes Daylight. Floodlit is the board as built.
- **Weights.** DM Mono has no bold above 500, so size does the work, never weight; names are DM Sans 600 as on the Board.
- **Colour never alone:** the striker's ● is a shape and is said; the worm's three lines are solid (target), dashed (par) and dim with a legend in words; wickets on the worm are a W mark, not a red dot; every chip carries its figure or word; the free-hit and hat-trick tags are words.

---

## 3 · Par and pressure

### 3.1 Plain words

The Board's second line says one true thing about where the innings stands. In a first innings, how far ahead of or behind par for this ground, from the ground's own record (SCRBRD-130 §6). In a chase, what is needed and whether the required rate is climbing, steady or falling over the last three overs. After rain in a chase, with the DLS table loaded, the DLS par at this point, labelled as a calculation. Where there is no par, nothing is said about par and the line is what it is today. **There is no pressure percentage.** `signals.js`'s 0–100 "pressure" is a heuristic with chosen weights; it is a number nobody measured and it stays off every spectator surface.

### 3.2 The sources

| figure | source (130 §) | with a table | without |
|---|---|---|---|
| venue par `P` | `venue_par(ground, overs, age_band)`, §6.2–6.3 | — | — |
| venue par at a point | §6.5: `round(P × (R(N,0) − R(b,w)) / R(N,0))` | label *DLS resources used* | `round(P × (N − b) / N)`, label *proportion of overs; no DLS table loaded* |
| DLS par at a point (chase, after an interruption) | §3.3: `dlsParAt()` | the figure, label *calculated* | none: no DLS par line, the umpires' figures only |
| the required rate | `chaseLine()` as built | — | — |

All of it is computed in the API, not the browser: the table never leaves the server (130 D6). A new public read, `GET /api/public/matches/:id/par`, returns for the innings on the Board:

```
{ venue: { par, n, sufficient, seasons, median, range, parAt, label } | null,
  dls:   { parAt, status, tableId } | null,
  track: [ { over, parAt } ],          // one figure per completed over and the current point (§3.4)
  rrr:   { now, threeOversAgo, trend } | null }
```

`venue` is null when the ground has no par (`sufficient = false`, or no ground). It is team-level — innings totals, overs and a ground (130 §6.6: nothing about a child) — and is cached at the live TTL and served `no-store`, because its words change with every ball. It needs **db/78**: `public_venue_par(p_match)`, a definer that returns the `venue_par` row for a **published** fixture and nothing for one that is not, granted to `scrbrd_app` (the shape of db/59's reads).

### 3.3 The words, case by case

| case | the second line | the worm |
|---|---|---|
| 1st innings, venue par sufficient, ahead | *12 ahead of par for this ground · CRR 9.91* | dashed par line to `P` at `N`, labelled *Par here 128 (9 innings)* |
| … level | *Level with par for this ground · CRR 9.91* | same |
| … behind | *9 behind par for this ground · CRR 9.91* | same |
| 1st innings, no venue par | *CRR 9.91 · At this rate: 146* (as built) | no par line |
| 1st innings, shortened by rain | the venue par words, measured against the full-length par, with the small label *of a full innings here* (130 §6.5) | the par line to `P` at the original `N`; the revised `N'` as a vertical rule labelled *16 overs (revised)* |
| chase, no interruption, two or more overs bowled | *Need 45 off 34 · RRR 7.94, climbing* / *steady* / *falling* | solid target line labelled *Target 187*; the first innings' worm dim and labelled; the venue par line stays dashed when sufficient (the ground's record is true of either innings, §6.5) |
| chase, fewer than two overs bowled | *Need 45 off 34 · RRR 7.94* (no trend word yet) | same |
| chase, last two overs | *Need 11 off 7* (no rate: the balls say it) | same |
| chase after an interruption, table loaded | *Need 45 off 34 (DLS) · 3 ahead of DLS par* | the DLS par replaces the venue par: dashed, labelled *DLS par (calculated)* |
| chase after an interruption, no table | *Need 45 off 34 (revised) · RRR 7.94, climbing* | no par line; the target line at the umpires' figure |
| chase terminated, par announced | the result words (130 §5) | the worm stops at the termination; the announced par as a mark labelled *Par (umpires) 74* |
| target reached | *Target reached* (as built) | — |
| super over | *Need 10 off 6*; no par, no projection, no trend (3b: a one-over innings is not a thing to model) | the pair's two worms only, one over wide |

**Ahead / behind** is `inn.runs − parAt`, in whole runs, never a percentage. **Climbing / steady / falling**: `rrr.now − rrr.threeOversAgo` at or above +0.25 is climbing, at or below −0.25 falling, else steady (**A**: the threshold), where `rrr` at an over's end is `(target − runs) / ((N×6 − balls) / 6)` read off `inn.overLog`'s cumulative figures, and "three overs ago" is the start of the chase when fewer than three are bowled. Pure, in `lib/par.js` (`parWords()`, `rrrTrend()`), tested against hand figures.

### 3.4 The par track, and why it is served

The worm wants the par as a line, not a point. With a table, the line's shape is the resource curve, which lives only on the server. The read therefore serves **the track**: one `parAt` per completed over of this innings, at the wickets as they stood, and the current point. It is the same shape as the worm's own series and is drawn the same way. What it is not is the table: each point is `P` scaled by a ratio at a mixed wicket count, and the table's permission (130 §8, granted 2026-10-01) covers the platform's own calculation shown as such. **Opus confirms** at build that the track exposes no cell (§9 D6).

### 3.5 The pressure meter

What Kameel called a meter is drawn as **one labelled track** under the second line on the display and on the Summary tab's Board, in a first innings and in a chase:

```
  1st innings:   par 61 ──────┼────●── 73 you      "+12"      (two labelled ticks on one line)
  chase:         CRR 8.40 ──●────────┼── RRR 7.94  "climbing" (the gap and the trend word)
```

Two ticks, both labelled with their figure, and the gap in words. It moves when the figures move (the ticks slide, `motion.control`), it is a cut under reduced motion, and it is not drawn when there is nothing to compare (no par; a chase under two overs). It is `RateTrack` in `ui/parTrack.jsx`, shared by all three surfaces.

---

## 4 · Motion

### 4.1 Plain words

Everything that moves explains a change in the score, and nothing moves for its own sake. The tokens' scale is the whole vocabulary: `flip` 190 ms for a figure, `control` 190 ms for a chip or a tick, `panel` 280 ms for a panel or a bar, `context` 420 ms for a spoke or a worm segment, `interrupt` 1100 ms for the big card's entrance. Under reduced motion every one is a cut and the page shows the same facts.

### 4.2 What animates

| thing | motion | duration · easing | reduced motion |
|---|---|---|---|
| a Board figure | the flip (as built) | 190 ms `swift` | cut |
| the run count | ticks up a run at a time, closing the last eight (as built) | 190 ms a run | cut to the total |
| a new chip in this over | scales in from 0.8 | 190 ms `swift` | appears |
| the worm's last segment | draws from the previous over's point to the new one (`stroke-dashoffset`); within an over the point advances a sixth of an over a ball | 420 ms `ease` | the segment appears |
| the runs-per-over bar in progress | grows a ball at a time (`transform: scaleY`, origin bottom) | 280 ms `swift` | appears |
| a wagon-wheel spoke (signed-in big screen only, §9 D7) | draws from the centre to its end | 420 ms `ease` | appears |
| a sector on the team wheel (public) | its fill steps up to the new share | 280 ms `swift` | appears |
| the two ticks of the rate track | slide to their new place | 190 ms `swift` | jump |
| a moment card (beat) | `mcBeat` as built | 190 ms | appears |
| a moment card (big) | `interruptIn` as built, then held, then a 190 ms fade | 1100 ms in · hold · 190 ms out | appears, held, gone |
| a panel change | cross-fade | 280 ms `ease` | cut |
| the sleep state | the Board dims to 40 % | 1100 ms | cut |

Only `transform`, `opacity` and `stroke-dashoffset` are ever animated: never width, height, colour or layout, never a shadow or a filter, and no backdrop blur anywhere on the display (the glass budget is zero here).

### 4.3 Reduced motion

`prefers-reduced-motion: reduce` already collapses `.os-board-flip`, `.mc-moment`, `.mc-moment-big` and `.os-insight-in` to cuts in `GLOBAL_CSS`; the new classes (`.os-worm-seg`, `.os-bar-grow`, `.os-spoke`, `.os-panel-in`, `.os-tick`) join that one block. A TV's browser has no system setting a person can reach, so the setup section's **Reduce motion** sets `data-reduce-motion` on the root and the same block applies under `:root[data-reduce-motion]`. The rotation still rotates under reduced motion — it is a content change at a reading pace, not motion — and the dwell can be made Long.

### 4.4 The frame budget, and a ball mid-animation

- **Budget (A):** 30 frames a second on a 2018-era TV browser (a 2 GHz ARM core, a Chromium fork two years old). Every rule below is there to hold it: at most one chart animating at a time; the worm is two polylines and at most twenty W marks; the runs-per-over chart is at most fifty rectangles; the signed-in wheel animates only its latest spoke and draws the rest as one static path; the ticker is bounded to eight flips; `will-change: transform` on the moment card alone; no re-layout on a ball (the panel is absolutely sized; the Board's figures are tabular so widths do not change).
- **Self-protection:** the display measures each chart animation with `requestAnimationFrame` timestamps; if two in a row average under 20 frames a second it sets `data-reduce-motion` for the session and says nothing. A TV that cannot animate shows cuts, which are still the truth.
- **A ball mid-animation.** Each read's new events become **steps** in one arrival queue (`display/arrivals.js`): a step is one ball's worth — chip in, figures flip and tick, chart extends, then its card if it earned one. Steps play one after another, at least 400 ms apart; an animation in flight is never cancelled, the next step waits for it. The queue never holds more than six steps; more than six arrivals in one read (the TV was asleep; the tab was hidden; `CATCH_UP` in `announce.js` is the same judgement at eight) is a **gap**: the display cuts to the current state, plays no steps and no cards, and the strip simply has its new rows. On `visibilitychange` to visible it does a full read and treats it as a gap.

---

## 5 · Moment cards

### 5.1 Plain words

A moment is a line that arrives from the shared commentary generator while the page is open, or a state the fold now says, matched exactly as the table below has it. Each is a card in the Board's corner for a fixed time, then it lives in the match story (the Highlights list, as built, and the strip's over row). One card at a time; the same ball's moments merge into the biggest; a beat waiting behind a big card is dropped. No card ever covers the total. On the ground display every card is public-safe by construction: its words are the public projection's, and a kind that is not safe is simply not a card.

### 5.2 The catalogue

Triggers name `COMMENTARY_KIND` values from `commentary.mjs` and fields of the fold's `Innings`. "Big" is the lime card (`mc-moment-big`); "beat" the chip-coloured one. Words are the card's; the eyebrow is the small line above them.

| # | moment | trigger, exactly | eyebrow / words | shows for | public display |
|---|---|---|---|---|---|
| 1 | Four | a line of kind `four` arrives | **FOUR** | 2.5 s · beat | yes |
| 2 | Six | kind `six` arrives | **SIX** | 2.5 s · beat | yes |
| 3 | Wicket | kind `wicket` arrives | **WICKET** / the generator's dismissal line (*c Pillay b Naidoo · D Erasmus 23 (18)*) | 4 s · big (white, black W, as `MomentMark` draws a wicket) | yes, by label (L4) |
| 4 | Fifty, hundred, 150, 200 | kind `milestone` whose line is the batter mark (the generator's fifty/hundred/`reaches N` text; the matcher reads the mark from the fold: `prev.runs < mark ≤ runs` for the striker) | **FIFTY** / *D Erasmus · 50 off 38* | 4 s · big | yes (A6: milestones on the live page under L2) |
| 5 | Partnership 50, 100, 150, 200 | kind `milestone`, the partnership mark (`curPartner.runs` crosses the mark with the same pair) | **PARTNERSHIP 100** / *Erasmus and Pillay · 71 balls* | 4 s · big | yes, by label |
| 6 | Five wickets | kind `milestone`, the bowler's wickets reach five or more on this ball | **FIVE WICKETS** / *K Naidoo 5/31* | 4 s · big | yes |
| 7 | On a hat-trick | kind `milestone`, "… is on a hat-trick" (two consecutive counted balls of the bowler's were his wickets) | the tag **Hat-trick ball** beside the chips, not a card | until the next counted ball | yes |
| 8 | Hat-trick | kind `milestone`, "A hat-trick for …" | **HAT-TRICK** / *K Naidoo* | 6 s · big | yes |
| 9 | Free hit | the fold's `inn.freeHit === true` after the latest ball | the tag **Free hit** beside the chips | until the next ball | yes |
| 10 | End of over | kind `over_end` | the over summary line under the chips (`OverSummary`, as built) | 6 s | yes |
| 11 | Innings closed | kind `innings_end` | **INNINGS CLOSED** / *Hilton 164/7 (20 overs)* | 6 s · big, then the break holds | yes (team-level) |
| 12 | Target set | kind `innings_start` for the chase (innings 1, or the second of a super-over pair) | **TARGET 165** / *from 20 overs* (+ *(DLS)* when `target.method = dls_standard` and the target was revised) | 6 s · big | yes |
| 13 | Result | the synthetic `result` line (key `result:<match>`) | the result words | held (the Result panel) | yes (`reasons: false`) |
| 14 | Play stopped | the fold's `inn.stopped` becomes non-null (R1) | **PLAY STOPPED** / *rain · 12.3 ov, 87/3* | held | yes |
| 15 | Revision | kind `revision` | **OVERS REVISED TO 16** / **TARGET 134 from 16 overs (DLS)** | 6 s · big | yes |
| 16 | Penalty runs | kind `penalty` | **5 PENALTY RUNS** / *to Hilton* | 4 s · big | yes: the side, never the boy (083 Q4) |
| 17 | Super over | kind `innings_start` with `superOver: n` on the first of a pair | **SUPER OVER** / *Northwood to bat* | 6 s · big | yes |
| 18 | Super over tied | the fold's last pair is `tied` and no next pair has opened | **SUPER OVER TIED** / *another to follow* | held until the next `innings_start` | yes |
| 19 | Super over decided | the result line (3b's words: *Match tied; Northwood won the super over*) | as #13 | held | yes |
| — | Retirement (`retire`), a bowler change, the keeper, short running, a penalty credit, a new batter | no card: the Board shows the change; the strip's sheet has the line | — | — | a retirement's reason is health (N2) and is never said on a spectator surface, so there is no card to make safe |

Super-over play produces no career milestone lines (3b §4: the generator writes none), so #4–#6 cannot fire in one; #1, #2, #3 and #9 can, and do.

### 5.3 Stacking and merging

- **Same ball, several moments:** the biggest wins and takes the others as its eyebrow: a six that brings up a fifty is **FIFTY** with the eyebrow *with a six*; a wicket that completes a hat-trick is **HAT-TRICK** with the dismissal line as its body; a wicket that is also a five-for is **FIVE WICKETS** with the dismissal line.
- **Order of size:** result > stopped > super over > hat-trick > five wickets > hundred and above > partnership hundred > fifty > partnership fifty > wicket > target set > revision > innings closed > penalty > six > four.
- **Queue:** at most three waiting (the built `QUEUE_MAX` is four; three keeps a flurry under twelve seconds). A beat behind a big card is dropped; a big card behind a big card waits; a held card (#13, #14, #18) ends the queue.
- **Afterwards:** every card's line is already in the commentary and so in the Highlights list; the strip's over row carries the mark (§6.3).
- **Where it sits:** `MomentMark`'s place, the Board's top-left, at most 40 % of the Board's width, never over the total (as built). On the display the big card is `clamp(20px, 3.4vmin, 44px)` already; it grows to `max(20px, 4.4vmin)` for the words and `max(12px, 2.4vmin)` for the eyebrow.

`lib/moments.js` is pure: `momentsFrom(arrivals, foldBefore, foldAfter)` returns cards with their size, hold and eyebrow; `moments.test.mjs` feeds it each trigger from a built log and asserts the exact card, the merge and the drop.

---

## 6 · The over story strip

### 6.1 Plain words

Each over is one row: its number, the bowler, its balls as the Board's chips, its runs and wickets, and the score after it. Newest at the top, as the Commentary tab reads. Tap a row and it opens in place to that over's lines from the generator. On the display it is the last six overs and nothing opens.

### 6.2 Layout

Phone (390 wide), on the Summary tab under the Board, replacing the three-line "Latest" panel (§9 D10); "All commentary" stays beneath it:

```
┌────────────────────────────────────────────┐
│ OVER STORY                     Hilton 1XI  │
│ 15  Naidoo   · 4 1 W · 2wd   7 · 1W  142/3 │  ← lit
│ 14  Smith    1 · · 4 2 ·     8       135/2 │
│ 13  Naidoo   · · 1 · 6 1     8       127/2 │
│ 12  Smith    · · · · · ·     M       119/2 │  ← maiden: "M"
│ 11  Naidoo   nb 4 ◌4 · 1 ·   10      119/2 │  ← ◌: the free-hit delivery, dashed ring
│ 10  Pillay   W · · 1 · ·     1 · 1W  109/2 │
│ [ Earlier overs ]          [ All commentary ] │
└────────────────────────────────────────────┘
```

Desktop (≥ 960): two columns side by side, one per innings, each with its own rows; the InningsToggle (as built) on phone. Each row is 44 px tall at least (it is tapped); chips 24 px as on the Board; the bowler's label in DM Sans; figures tabular.

The display: the same rows at `max(16px, 3.6vmin)` chips, the last six overs, the newest lit at `board.figure` and the rest stepping down to `board.dim`; nothing tapped.

### 6.3 Marks: words and shape, never colour alone

| what | chip (as built, `chipFor`) | shape, added here | words in the sheet |
|---|---|---|---|
| a dot | a bare dim "·" | — | *Dot ball* |
| 1, 2, 3, 4, 5, 6 | the chip's figure on its colour | **round** | *Four runs* |
| a wicket | white, black **W** | round, the strongest mark | the dismissal line |
| wide, no-ball, byes, leg byes | the extras' colour with the word (*wd*, *2wd*, *nb*, *5nb*, *2b*, *1lb*, *nb+4b*) | **square-cornered** (`radius.sm`), so an extra differs from a run by outline as well as by word | *Wide*, *No ball, and two more* … |
| the free-hit delivery | its own chip | a **dashed ring** round it and the sheet's line says *Free hit* | *Free hit: not out* when the fold's `freeHitSaved` is set |
| penalty runs | `+5` | square-cornered | *Five penalty runs to Hilton* |
| a maiden | — | the over's figure column says **M**; a wicket maiden **WM** | — |
| the over's figures | — | *7 · 1W* at the row's end; the score after the over last | — |

The row's `aria-label` reads the chips through `chipFor().say`, as the Board's "This over" does.

One thing for Opus to check at build (**A**): `boardBall()` returns `"W"` for any entry with `type === "W"`, and a wicket the free hit saved is logged with that type and `freeHitSaved` set; the strip (and the Board) must draw that ball as its runs with the dashed ring, not as a W. If the Board does today, it is a bug the strip's test will catch.

### 6.4 Tapping an over

The row expands in place (not a modal, so the Board stays in view): the over's lines from `commentaryByOver()`'s group, newest first as the Commentary tab has them, the bowler's figures after the over, and the score. On the public page the lines are the public projection's. A second tap closes it. Keyboard: the row is a button; Enter toggles.

---

## 7 · Shared components

### 7.1 Plain words

One component per thing, used by three surfaces: the Match Centre's Summary tab (signed in), the public live page, and the display (public, and the signed-in big screen through the same view). Public modules import nothing signed-in; the signed-in app may import public modules; the scorer's `charts.jsx` is not imported by any of them.

### 7.2 Reused as built

| piece | where | used for |
|---|---|---|
| `Board`, `Figure`, `Insight`, `chipFor`, `chipFill` | `ui/board.jsx` | the Board band, every chip, the insight turn |
| `boardFromInnings`, `chaseLine`, `atThisRate`, `boardBall` | `scorer/boardData.js` | the Board's props; the chips' words |
| `boardInsights` | `scorer/signals.js` | the Tier 2 line (the rest of `signals.js` stays the pad's) |
| `useArrivals`, `useMoments`, `useAnnouncement`, `useTicker`, `liveRefreshMs` | `views/matchcentre/live.js` | arrivals, the ticker; `useMoments` is extended to read `lib/moments.js` |
| `MomentMark`, `OverSummary`, `Highlights`, `BigScreen` | `views/matchcentre/spectator.jsx` | the corner, the over summary, the story; `BigScreen` becomes a thin wrapper over `DisplayView` |
| `InningsBreakCard`, `SummaryTab`, `CommentaryTab`, `PartnershipsTab` | `tabs-core.jsx` | the break panel; the tabs that gain the strip |
| `TeamWheel`, `usePublicMatch`, `read()` | `public/PublicMatch.jsx` | the public wheel; the public reads (lifted to `public/reads.js` so the display shares them) |
| `inningsBreak`, `boardInnings`, `inningsPhase`, `matchLine`, `resultText`, `revisionNotice`, `commentaryByOver`, `teamOf`, `sidesOf` | `lib/matchCentre.js` | everything the panels say |
| `BEAT_WORD`, `overSummaryText`, `announceArrivals`, `CATCH_UP` | `lib/announce.js` | the words; the gap rule |
| the public router, shells, cache, `publicPages()` | `services/api/public/` | `/display/:match` and `/par` |
| `public_match_log(match, since)`, `public_match_header`, the sectors read | db/59 | the incremental log |

### 7.3 Lifted (moved so three surfaces can share them)

| piece | from | to | why |
|---|---|---|---|
| the worm, the runs-per-over chart | `scorer/charts.jsx` (`WormChart`, `ManhattanChart`: read `D`, import the scorer's field code) | `ui/charts/worm.jsx`, `ui/charts/bars.jsx`, reading `T` only, taking **series** not an innings; `lib/chartSeries.js` (`wormSeries(inn)`, `oversSeries(inn)`, pure) | the public bundle must stay free of the scorer (`check-bundle.mjs`); AnalyticsTab and the public Analytics switch to them; the scorer's own copies migrate to `T` on their own step |

### 7.4 New

| piece | where | what |
|---|---|---|
| `DisplayView` | `display/DisplayView.jsx` | the Board band, the rotation, the corner, the layouts, the two settings, the wake lock (from `BigScreen`), the stale notice (*Last updated 14:32 · reconnecting* after 30 s without a read) |
| `Rotation` | `display/rotation.js` (pure) + `display/Rotation.jsx` | the cycle, skips, interrupts, dwell, pause |
| the panels | `display/panels/*.jsx` | §2.2's 1–11, each over the shared pieces |
| `arrivals.js` | `display/arrivals.js` (pure) | the step queue and the gap rule (§4.4) |
| `lib/moments.js` | pure | the catalogue (§5) |
| `MomentCard` | `ui/momentCard.jsx` | `MomentMark` grown an eyebrow and the display's sizes; `MomentMark` keeps its name as the small form |
| `StoryStrip` | `ui/storyStrip.jsx` + `lib/storyStrip.js` (pure rows) | §6, on all three surfaces |
| `lib/par.js` | pure | `parWords()`, `rrrTrend()`, the second line's composition |
| `RateTrack` | `ui/parTrack.jsx` | §3.5 |
| `/display/:match` | `services/api/public/` | the shell (noindex, no-store), the route in `public/main.jsx` as a lazy chunk so `/live` does not pay for the charts |
| `/api/public/matches/:id/par` | `services/api/public/` | §3.2, over `public_venue_par()` (db/78) and `dlsParAt()` |
| the setup section | `views/publication.jsx` | §1.3 |
| the public page's `result` line | `PublicMatch.jsx` | the same synthetic line `MatchView` builds, so #13 fires on the public page and the display |

The display rides in the **public bundle** (same entry as `/live`, lazy chunk). It gets a ceiling of its own in `check-bundle.mjs` if the public entry has none today (**A**: 250 KB for the public entry graph, the display chunk outside it).

---

## 8 · Phasing

One phase per step of Kameel's order; each a PR, reviewed before it lands, behind the walks that exist. The next free migration is **db/78**; the next free db/99 section is **§50** (the file's last is §49 on this branch). If phases in flight take them, the lead renumbers.

| phase | migration | tier | ships | proves |
|---|---|---|---|---|
| **G1 · The ground display** | none | **Opus:** the public shell and route for `/display/:match`; `?since=` on the log read; the rate-limit allowance; the public reads lifted to `public/reads.js`; the setup section's switch and words (who may, what it says about names); review of every panel for the public rule. **Sonnet:** `DisplayView` from `BigScreen`; `Rotation`; panels 2, 3 (static rows), 4, 8, 9, 10, 11 and the Board band; the three layouts; Daylight and Floodlit; the stale notice; the sleep state; the setup section's link and QR; `BigScreen` rewired to `DisplayView` | §1, §2 less the worm, bars and wheel panels (G2, G3), §6.2's display form of the strip (static) | `tools/smoke-browser-display.mjs`: at 1920×1080, 1024×768 and 390×844: no text under 12 px; no token and no API client in the bundle; names only under the rule (the consent cases from `smoke-browser-public.mjs`); an unpublished fixture 404s; the rotation skips an empty panel and resumes where it was after a wicket; the break and the result hold; sleep after full time; Daylight lifts the dim token; nothing is tappable. `smoke-public.mjs` gains the shell's headers and `since`. `rotation.test.mjs` |
| **G2 · Par and pressure** | **db/78** `public_venue_par(p_match)`: the `venue_par` row for a published fixture, team-level, nothing otherwise; granted to `scrbrd_app`; its own proof in the file | **Opus:** db/78 and §50; `lib/par.js`; the `/par` read with the track (§3.4) and the leakage check; the second line in `boardData.js` gaining the par words; the worm lifted to `ui/charts/worm.jsx` with the series module (it is the par line's home). **Sonnet:** the worm panel on the display and the par line on the Summary tab's and the public page's worm; `RateTrack`; the labels and legend | §3 entire; panel 1 (static) | **§50**: `public_venue_par` answers for a published fixture only, returns team-level columns only, and null below the floor. `par.test.mjs`: every row of §3.3 against hand figures over built logs (a first innings ahead, level, behind; no par; a chase at one over, three overs, climbing, steady, falling, the last two overs; a DLS chase with the synthetic table; a terminated chase with a par; a super over). The walk gains the line and words in each state. **G2 does not wait for the DLS table:** without R2 the DLS rows are `no_table` and the proportional fallback is labelled, as 130 §4.5 says; without R3 the venue rows are null and nothing is said; both gain their figures when those phases ship |
| **G3 · Charts that move, moment cards, the over story** | none | **Opus:** `lib/moments.js` and its test (a wrong trigger is a silent lie on a public screen); `display/arrivals.js` (the step queue and the gap); review of each card's public safety; the free-hit-saved check (§6.3). **Sonnet:** the animated worm, bars and the signed-in wheel's spoke (`ui/charts/`); `MomentCard`; `StoryStrip` on the three surfaces with the tap-open; the reduced-motion block and the self-protection; the frame measurements | §4, §5, §6; panels 5 and 6 | `moments.test.mjs`: every trigger of §5.2 from a built log, the exact words, the merge, the drop, the hold. `storyStrip.test.mjs`: rows, maiden, free-hit ring, the saved wicket. `chartSeries.test.mjs`: series equal hand figures. The display walk gains: a four's card appears once and never on reload; a six that makes a fifty shows one card; reduced motion leaves no animation class on the page; seven arrivals in one read cut to state with no card; the strip's newest row is lit. `smoke-browser-matchcentre.mjs` and `smoke-browser-public.mjs` gain the strip and the tap-open |

JS tests beside them as named; `design.test.mjs` gains the display's Daylight dim token at AA on the board; `smoke-a11y` runs its three ratchets on the display at all three sizes; `check-bundle.mjs` holds the public entry's ceiling with the display outside it.

Order: G1, G2, G3 as Kameel set it. G2's worm lift is the one piece G3 builds on; nothing else crosses phases.

---

## 9 · Decisions for Kameel

Each with the recommendation the body assumes and one line of why.

| # | decision | recommendation |
|---|---|---|
| **D1** | The ground display signs in as nothing: the public projection, no credential, no session | **Yes.** The rule already forbids everything a credential would unlock; a session on an unattended TV is the leak the masking exists to stop |
| **D2** | Its switch is the fixture's existing publication by the home side, under `broadcast.publish`; no new flag or table. A display for a fixture a school will not publish to the world is a later per-fixture flag (not a credential), if a school asks | **Yes.** One switch, already built and already under the right capability; the need for a private display is real but unproven |
| **D3** | Names on the display follow the public rule exactly; the setup section says how many of the XI are named and links to consent | **Yes.** The pavilion TV is the strongest reason a school will ever have to record consent, and the honest lever is consent, not a looser surface |
| **D4** | No invented pressure score on any spectator surface; the "meter" is the par gap and the required-rate trend, both provable from the log | **Yes.** Kameel's own rule: every figure real; `signals.js`'s 0–100 stays the pad's private heuristic |
| **D5** | Venue par is said only when the ground's record is sufficient (five innings, 130 D11); otherwise nothing, not a placeholder | **Yes.** "Not enough matches here yet" is a ground-page sentence, not a scoreboard one |
| **D6** | The `/par` read serves the per-over par **track** for this innings, calculated on the server; the table never leaves; Opus confirms the track exposes no cell | **Yes.** The worm needs a line, the permission covers the platform's own calculation shown as such, and a mixed-wicket track of one innings is not the table |
| **D7** | On the ground display the wagon wheel is the side's twelve sectors (L7), refreshed per over; a spoke that draws in as the shot is scored is the signed-in big screen's | **Yes.** The public log carries no placement by design; a sector per ball would be a per-pseudonym shot map |
| **D8** | No card for a retirement, and no reason for one on any spectator surface | **Yes.** N2: health is never public, and "retired hurt" is health |
| **D9** | Dwell 12 s (Long 24 s); the cycle resumes where it was after an interrupt; the break, the result, a stop and a tied super over hold | **Yes.** Twelve seconds is two sweeps of a chart at ten metres; resuming keeps every panel seen |
| **D10** | The strip replaces the Summary tab's three-line "Latest" panel on the Match Centre and the public page; "All commentary" stays | **Yes.** Six overs as chips say more than three lines of prose, in less height |
| **D11** | The signed-in big screen becomes `DisplayView` with signed-in names; Q9's "public names" mode is opening the ground display | **Yes.** One component, two feeds, no third projection |
| **D12** | After full time the result holds; after ten minutes the display dims and stops reading | **Yes.** A pavilion TV is left on; a dim result card costs the API nothing |
| **D13** | No sponsor slot or strapline on the display in G1–G3; it comes later through the public header, not `broadcast_state()` | **Yes.** `broadcast_state()` masks without consent (083 §5.2) and the display must never read it; the slot is revenue and worth its own small phase |
| **D14** | Daylight and Floodlit are display settings in the URL; Daylight lifts `board.dim`, thickens chip outlines, rules the rows; the values are measured on a real pavilion TV before they are fixed | **Yes.** The board's black, white and lime do not move (decision 6); glare is fought with contrast of the dim row, not a new palette |
| **D15** | A one-TV, whole-ground display (the day's matches at one ground, rotating) is out of these three phases | **Later.** It is a list of displays, not a new display; the pieces here make it a small phase when a ground with four pitches asks |
| **D16** | G2 ships before the DLS table is loaded and before venue par exists if they are not yet built, with their rows empty and labelled, and gains the figures when R2 and R3 land | **Yes.** Nothing in G2's words is wrong without them; it is only quieter |

---

## 10 · Assumptions (A), each to be confirmed

1. The roles holding `broadcast.publish` are the director of sport and the school office (`roles.mjs` has two).
2. A display at a neutral ground is switched on by the home side's publication.
3. The public log route does not take `?since=` today; adding it is API work only (`public_match_log()` already takes `p_since`).
4. The public router's rate limit can be tuned to allow one display at 5 s plus a pavilion's phones on one address.
5. The readability rule of 1/200 of the viewing distance, and the "read from" distances in §2.6 derived from it.
6. The Daylight dim value (`#b8c0cc` or thereabouts) and the thickened outlines, to be measured at a ground.
7. The required-rate trend threshold of ±0.25 an over over three overs.
8. The frame budget of 30 frames a second and the 20-frame self-protection threshold on a 2018-era TV browser.
9. The public entry has no bundle ceiling of its own today; 250 KB is proposed.
10. `boardBall()`'s treatment of a wicket the free hit saved (§6.3) — a possible existing bug, to be checked, not assumed.
11. R1's `inn.stopped` shape is as SCRBRD-130 §2.3 designs it; until R1 ships, `revisionNotice()` stands in for the Stopped panel.
12. The venue-par and DLS reads exist as SCRBRD-130 R2 and R3 design them, in `venue.mjs` and `dls.mjs`; G2 reads them through the API and never computes a resource in the browser.

---

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `Board`, `Figure`, `Insight`, `INSIGHT_MS`, `chipFor`, `chipFill`, `nextFigure` | `apps/web/src/ui/board.jsx` | the Board band, the chips, the insight turn |
| `boardFromInnings`, `chaseLine`, `atThisRate`, `boardBall` | `apps/web/src/scorer/boardData.js` | the Board's props and the second line |
| `boardInsights` | `apps/web/src/scorer/signals.js` | Tier 2 |
| `useArrivals`, `useMoments`, `useAnnouncement`, `useTicker`, `liveRefreshMs`, `OVER_SUMMARY_MS` | `apps/web/src/views/matchcentre/live.js` | arrivals, the queue, the ticker, the cadence |
| `MomentMark`, `OverSummary`, `Highlights`, `HIGHLIGHT_KINDS`, `BigScreen` | `apps/web/src/views/matchcentre/spectator.jsx` | the corner, the summary, the story, the wake lock |
| `SummaryTab`, `InningsBreakCard`, `CommentaryTab`, `PartnershipsTab` | `apps/web/src/views/matchcentre/tabs-core.jsx` | the shared tabs |
| `AnalyticsTab`, `WormChart`, `ManhattanChart`, `ShotWheel` | `tabs.jsx`, `apps/web/src/scorer/charts.jsx` | what is lifted |
| `PublicMatch`, `usePublicMatch`, `TeamWheel`, `useSectors` | `apps/web/src/public/PublicMatch.jsx` | the public reads and wheel |
| `inningsBreak`, `boardInnings`, `inningsPhase`, `matchLine`, `resultText`, `revisionNotice`, `commentaryByOver`, `teamOf`, `sidesOf` | `apps/web/src/lib/matchCentre.js` | the panels' words |
| `BEAT_WORD`, `overSummaryText`, `announceArrivals`, `CATCH_UP` | `apps/web/src/lib/announce.js` | words; the gap |
| `COMMENTARY_KIND`, the milestone, hat-trick and free-hit lines, `deriveCommentary` | `packages/scoring/src/commentary.mjs` | every card's trigger |
| `Innings` (`overLog`, `fow`, `curPartner`, `partnerships`, `freeHit`, `revised`, `target`, `superOver`), `BallLogEntry` (`freeHitSaved`) | `packages/scoring/src/replay.mjs` | every series and mark |
| `describeResult()`, `resultWords()`, the super-over pairs | `replay.mjs`, `result.mjs` (3a), 3b's design | the result and super-over cards |
| `T.motion`, `GLOBAL_CSS`'s reduced-motion block, `.os-board-flip`, `.mc-moment`, `.mc-moment-big`, `interruptIn` | `apps/web/src/design/tokens.js` | every duration and easing |
| `publicPages()`, `LIVE_TTL_MS`, `SETTLED_TTL_MS`, `TEAM_LEVEL`, the shells, `RateLimit`, the `public_data_changed` listener | `services/api/public/public-api.mjs` | the route, the cadence, the cache |
| `public_match_log(uuid, integer)`, `public_match_header`, `public_shot_sectors`, the `public_data_changed` triggers | `db/59_public_read_path.sql` | the reads |
| `fixture_publication`, `public_name_facts()`, `publicName()` | `db/47`, `packages/policy/src/public.mjs` | the switch and the rule |
| `match_broadcast`, `broadcast_state()`, `broadcast_name()` | `db/08` (and db/48) | what the display must **not** read (083 §5.2) |
| `pad_resume_credential`, `pad_resume_issue()`, `pad_resume_day_end()` | `db/50_pad_resume.sql` | the credential option weighed and not taken |
| `venue_par`, `venue.mjs`, `dls.mjs` (`dlsParAt`, `resourcesOf`), `target.dls_table`, `target.g50` | SCRBRD-130 R2, R3 | the par figures |
| `check-bundle.mjs`'s entry graph and ceiling, `smoke-a11y`'s three ratchets, `smoke-browser-public.mjs`, `smoke-public.mjs`, `smoke-broadcast.mjs` | `tools/` | what proves it |
