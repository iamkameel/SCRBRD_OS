# SCRBRD-138 — The captain's view: the design

**Status:** for Kameel's review, 2026-10-01. Nothing is built.
**Source:** `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md` SCRBRD-136/137/138; ADR 0003; `docs/design/STEP4_parent_pupil.md` (the pupil app as built); `docs/design/SAFEGUARDING_DSO.md` and `docs/policy/CSA_SAFEGUARDING_CHECK.md` (SG-9, K3, db/57); `docs/design/SCRBRD-110_workload.md` and ADR 0002; `docs/design/SCRBRD-133_immersive_match_centre.md` §2–3; `packages/scoring/src/conditions.mjs`; `tools/smoke-matchups.mjs`; the beta-2 prototype's `CaptainCockpitView.tsx` and `CaptainTacticalCockpit.tsx`.
**Reader:** the product owner first, then the Opus agent who builds the gate and the channel, and the Sonnet agent who builds the screens. Plain words come first in each section. Names in the sketches are the seed's illustrative ones (Hilton, Kearsney, D Erasmus, R Pillay, K Naidoo), never a real child's.

---

## 0 · In one page

A captain is a pupil who holds the captaincy honour. ADR 0003 settled that he is not a role, and this design keeps it so: nothing he sees is a capability he gains. **The captain's view is the pupil app with three things switched on by the honour** — a card on Home, a section on his fixture screen, and a tab in the Match Centre — every one of them drawn from reads the `player` role already holds across his side. No capability is widened, so phase A needs no migration.

What he sees is the match as the Board shows it, the competition's bowling cap set against each bowler's overs (a figure, never a reason), the team sheet and who is in next, his side's season figures, his batters against bowling types, the toss, the conditions and the pitch report, and the coach's plan for the day. What he never sees is anybody's health, load, guideline, availability, assessment, note, discipline or safeguarding record, nor another school's child beyond the public page's label.

Three things from the prototype are refused rather than redesigned. The coach's directive inbox is a one-to-one channel from an adult to a child, which SG-9 forbids and `db/57` already refuses (`recipient_is_pupil`); the coach's plan goes **to the side** instead. "Physio restricted" on a team-mate's card is health data in front of other children (CSA p52, K3). The win-probability slider and the decision ledger with its "impact" are figures nobody measured (133 D4).

The honest finding about *when*: a fielding captain is not holding a phone. The view is for the pavilion, the bus and the evening; in the field his cue is the scorer's words through the umpire, as it is today.

---

## 1 · Who is a captain

### 1.1 Plain words

The school says who the captain is by awarding an honour (`honour`, `db/08` 5451): kind `captain` or `vice_captain`, for one side, for one season, by a named adult, on a date. It is withdrawn with a reason, never edited, and stays on his passport. That row — live, for this season, for the side he is on today — is the whole of the switch. There is no flag on the player, no role, no setting.

### 1.2 The gate, stated once

| test | the column | why |
|---|---|---|
| the kind | `honour.kind IN ('captain','vice_captain')` | both lead the side (D1) |
| live | `withdrawn_at IS NULL` | a withdrawn honour is not a captaincy |
| this season | `honour.season_id` = the fixture's school season (on a fixture or match screen); the current school season (`season_for(sa_today(),'school')`) on Home | one of each kind per boy per season, live (`honour_once_a_season`) |
| this side | `honour.team_code = player.team_code` (his *current* side) | "an honour does not move sides when he does" (the table's own comment); a 1st XI captain moved to the 2nd XI is not its captain |
| his school | `honour.school_id` = the school of his `player` assignment | stamped at award by `honour_stamp()` |

In phase A the client reads his own row (`recognition?playerId`, `honours`, both under `player.profile.read` through `selfaccess`) and draws; nothing server-side is gated, because nothing he reads widens. When a server read is ever gated on the honour (phase C), the same five tests become `is_captain_of(p_player, p_team, p_season)` in SQL, and `db/99` proves each test false one at a time.

### 1.3 How it starts and ends

| event | what happens | when the view changes |
|---|---|---|
| the award (`POST /api/honours`, `recognition.manage`: director of sport, principal, office) | the row exists from `awarded_on` (today by default) | next load |
| withdrawal (`POST /api/honours/:id/withdraw`, a reason of 3–200 characters) | `withdrawn_at` set; the honour stays on his passport as withdrawn | next load; nothing is deleted and nothing is "demoted" on a screen a team-mate sees |
| he changes side | `player.team_code` moves; the honour's does not | off; the new side's coach awards again if he is to lead it |
| the season ends | `season_id` is last season's | off on the first day of the new season; a new award each season |
| he leaves the school | the `player` assignment ends | the app is gone with it |

**Vice-captain (D1).** The same view, with "Vice-captain" as its label. He runs the side when the captain is batting, injured or away, and the view at those moments is exactly the captain's. A lesser screen would be a second screen to build, test and explain for no reason.

**A captain for the day without an honour (D3).** No view. The side's regular stand-in is a `vice_captain` for the season; a per-match "captain on the day" mark is a later item if coaches ask. `match_squad` carries no such mark today (A5).

---

## 2 · When he would use it

### 2.1 Plain words

Design for the moments that are real. A captain in the field has an umpire, a bowler and a ball to think about, and a phone in the kit bag. The screen time he actually has is before the match, while his side bats and he is not in, at the innings break, and afterwards. The design builds for those, and sends the fielding captain's one real question — how many overs has this bowler left — through the scorer and the umpire, where it already goes.

### 2.2 The moments

| moment | phone in hand | what he wants | where |
|---|---|---|---|
| the week, Friday evening | yes | the sheet and the order, the plan, the opposition's results, the ground, the bus | **C2** on the fixture screen |
| the bus, before the toss | in his pocket, read on the way | the format and the cap, free hit or not, the pitch report, the weather | **C2** |
| the toss | no | nothing on a phone | — |
| fielding, between overs | no | overs left per bowler | the scorer's words to the umpire (`capWords()`, as the pad says them); the pavilion screen for the score (133) |
| drinks | briefly, if the twelfth man brings it | overs left per bowler; where they have scored this innings | **C4** |
| the innings break | yes, ten minutes | the target, the four facts, the order for the chase, the plan | **C3/C4** |
| his side bats and he is not in | yes — the real screen time | the Board, the need and par, the over strip, who is in next, his batters' figures | **C3** |
| after | yes | the result, his bowlers' figures, his batters against bowling types for next week | **C5** |

*Rejected — a "fielding mode" with large tap targets for logging field changes:* field placements are recorded nowhere on the platform, and the thing that produces them is a boy on his phone at mid-off.

---

## 3 · What he sees, field by field

### 3.1 Plain words

Every figure below is one the pupil app can already fetch for him under `player` (team-scoped: `fixture.read`, `team.read`, `player.profile.read`, `player.performance.read`, `competition.read`, `transport.read`) or `selfaccess`. The view is a different arrangement of what a team-mate may already read, drawn for a boy who is thinking about the side rather than about himself. The Board, the second line, the par track and the over strip are SCRBRD-133's, reused unchanged.

### 3.2 C1 · The Home card

```
┌──────────────────────────────────────────┐
│ CAPTAIN · HILTON U15A                    │  label; "VICE-CAPTAIN" for that kind
│ v Kearsney (away) · Sat 3 Oct · 09:00    │  the next fixture
│ Side published Thu · 11 named            │  match_squad: a count and the day, no names here
│ Plan from Mr Dlamini · Thu      [ Open ] │  only when a plan exists (§5.2)
│                          [ Match day › ] │  → C2
└──────────────────────────────────────────┘
```

Drawn below the next-fixture card (which stays first: "am I playing" is still his first question) only while the gate (§1.2) passes and a fixture of his side is within seven days or live. No fixture, no card.

### 3.3 C2 · Before the match (the fixture screen's Captain section)

```
┌──────────────────────────────────────────┐
│ ‹ Sat 3 Oct · Hilton U15A v Kearsney     │
│ … the fixture as built (S3): ground, map,│
│   umpires, pitch, weather, bus, his answer│
├──────────────────────────────────────────┤
│ CAPTAIN                                  │
│ THE DAY                                  │
│ 20 overs · 4 an innings per bowler ·     │  the frozen conditions document, the pad's own line
│ free hit on · U15 League                 │  (conditionsLine as built)
│ U15 rule: 6-over spells, 12 a day, for   │  one line for the side, the band's directive (D4)
│ every bowler                             │
│ Pitch: firm, good grass cover            │  match_pitch_report — written for captains (db/08 1430)
│ 22° overcast, rain after 4               │  weather (fixture-scoped)
│                                          │
│ THE SIDE · published Thu                 │
│  1 D Erasmus     6 K Naidoo   11 T Cele  │  match_squad: names and places, as SideSheet draws them
│  2 R Pillay      7 …                     │
│                                          │
│ THE PLAN · Mr Dlamini, Thu 20:10         │  §5.2 — a post to the side, drawn first here
│ "Bat first if we win it. Naidoo and      │
│  Smith open the bowling …"               │
│                                          │
│ THIS SEASON                              │  career_by_season per team-mate (player.performance.read)
│  D Erasmus  6 inns · 184 · avg 36.8      │  figures in the figure face, tabular; no colour, no rank
│  K Naidoo   22 ov · 9 wkts · econ 4.9    │
│  …                                       │
│                                          │
│ KEARSNEY THIS SEASON                     │  competition table and results (competition.read)
│  3rd · W4 L2 · last: beat DHS by 31      │  the public page's facts; no child named
└──────────────────────────────────────────┘
```

| element | source | capability (held) |
|---|---|---|
| the format, overs, cap, free hit | `match_conditions.doc` (play part, `db/61`), through `lib/playingConditions.js` and the pad's `conditionsLine.jsx` | `fixture.read` (A1) |
| the band's rule, one line | `bowling.limit[band]` from the document, else `bowling_directive` for the fixture's band (A7) | `fixture.read`, `competition.read` |
| pitch, weather, umpires, bus | `match_pitch_report`, `weather`, `match_official`, `trips?matchId` (all as S3 draws them) | `fixture.read`, `transport.read` |
| the side | `match_squad?matchId` (`SideSheet` as built) | `player.profile.read` across his side |
| the plan | §5.2 | `news.read` |
| this season | `career_by_season?season=` for each boy on the sheet | `player.performance.read` across his side |
| the opposition | `competition` standings and results | `competition.read` |

### 3.4 C3 · While his side bats (the Match Centre's Captain tab)

```
┌──────────────────────────────────────────┐
│ ████████████ BOARD (black) ████████████ │  as built; the second line from 133 §3
│  HILTON U15A               142 / 3       │
│  14.2 · Need 45 off 34 · RRR 7.94,       │
│  climbing                                │
│  ● D Erasmus 23 (18)   R Pillay 17 (12)  │
│  Partnership 43 (27)                     │
│  par 128 ──┼──●── 142   "+14"            │  RateTrack (133 §3.5), when a par exists
├──────────────────────────────────────────┤
│ NEXT IN                                  │  the sheet's order minus the fold's batted list — pure client
│  6 K Naidoo · 7 J Smith · 8 T Cele       │
├──────────────────────────────────────────┤
│ OVER STORY                               │  133 §6 strip, as built
│  15  Mkhize  · 4 1 W · 2wd   7 · 1W      │
│  14  Dube    1 · · 4 2 ·     8           │
├──────────────────────────────────────────┤
│ OUR BATTERS TODAY                        │  the fold: inn.batsmen
│  D Erasmus  23 (18)  3×4                 │
│  R Pillay   17 (12)  2×4                 │
│  M Khan      4 (9)   c & b Dube          │
└──────────────────────────────────────────┘
```

The opposition's bowlers appear by the name the log carries, as they do for every signed-in reader of the scorecard (STEP4 §9 Q4); nothing more about them is offered — no row opens.

### 3.5 C4 · Fielding, read at drinks or the innings break

```
┌──────────────────────────────────────────┐
│ ████████████ BOARD ████████████████████ │  Kearsney 87/3 · 12.0
├──────────────────────────────────────────┤
│ OUR BOWLERS                              │  inn.bowlers + capWords(balls, conditions)
│  K Naidoo   4-0-18-2   Has bowled his 4  │  the cap's words only; no reason, ever
│  J Smith    3-0-21-0   Has 1 over left   │
│  T Cele     3-1-12-1   Has 1 over left   │
│  M Khan     2-0-19-0   Has 2 overs left  │
│  not yet bowled: D Erasmus, R Pillay …   │  the sheet minus the bowlers
├──────────────────────────────────────────┤
│ WHERE THEY HAVE SCORED                   │  the side's twelve sectors this innings (A8)
│  [ wheel: 12 sectors shaded by runs ]    │  TeamWheel as 133 draws it; side-level, no batter
├──────────────────────────────────────────┤
│ OVER STORY · last six                    │
└──────────────────────────────────────────┘
```

"Has 1 over left (4 an innings)", "Has bowled his 4 overs", "5 overs; the conditions allow 4" are `capWords()`'s three sentences, verbatim, so the captain, the scorer and the coach read one rule in one wording. With no cap in the document the line is not drawn (D5 of SCRBRD-114: the platform default is none). **Nothing here says why a bowler should stop**: not a guideline, not a spell count against the directive per boy, not a flag. Whether a particular boy has a stricter rule is the coach's to tell him in person, as today (D4).

### 3.6 C5 · After

The result words, both innings' lines, the over strip in full, his bowlers' final figures, his batters' innings in words (the commentary engine's lines, deterministic), and **matchups** for his batters: `matchups?batterId=` per boy, which the read scopes itself — rows against *bowling like his* (arm, pace or spin) survive; a row naming a bowler the reader may not read (another school's child) comes back empty, exactly the lesson `smoke-matchups.mjs` records in its header. The screen never offers a row the read cannot fill (D8). "His bowlers' matchups" — his bowler against a named opposition batter — is keyed by that batter, another school's child, and so is not his; the same facts reach him as the side's wheel for the match.

### 3.7 Availability

**Not shown, in any form** (D7). `player` holds `availability.declare` and not `availability.read` (STEP4 §1.2, §2.2 "Rejected"): a team-mate's "unavailable, family" is a window into a child's home. The captain learns the side from the sheet, and the card says when it was published and how many are named. A coach who wants the unanswered nudged says so in a team notice.

---

## 4 · What he never sees

| never | why — the capability `player` does not hold, or the rule |
|---|---|
| a team-mate's injury, fitness, return date, "restricted" | no medical tier since `db/55` (K3; CSA p52: not in general view to other children). `player.fitness` masked (`db/58`) |
| a bowler's load, guideline, spell limit *for him*, check-in, flag | no `player.workload.*`, no `wellness.*` (SCRBRD-110 §6.5); `effective_limits()` names its source ("guideline set by the physio") and is never called from this view |
| a workload breach | never public (PUBLIC_DATA §5a); a welfare notice to adults |
| a team-mate's ratings, the coach's notes | no `player.development.read`, no `player.note.read` |
| who is available, doubtful or out, or why | no `availability.read` (§3.7) |
| discipline, safeguarding | no `discipline.read` over others; `safeguarding.*` is the DSO's alone (SAFEGUARDING_DSO §1) |
| another school's children beyond the public label | the opposition dossier is `opposition.read`, staff-only, off by default: **a captain never reads it**, nor any per-player read of another school |
| the coach's cockpit (SCRBRD-136) | it carries workload and availability; the "View full coach cockpit" button does not exist |
| PII, date of birth, emergency contacts | not in `player`; the fixture's umpires are adults and are named |
| a win probability, a pressure index, a "threat level", a false-shot rate | 133 D4 and 136: figures nobody measured; no data |
| a photo | none exist (A8 of PUBLIC_DATA) |

Where a boy asks the screen for one of these, the answer is `boundaries("player")` rendered as help, as the family screens do.

---

## 5 · Coach to captain, and back

### 5.1 Plain words

May a coach send the captain a field plan, a batting order or a note? **Yes — to the side, never to him alone.** CSA's principle is that an adult is never alone with a child (p34 rule 6, p35), SG-9 turned that into rules for any messaging — no private adult-to-pupil channel; a message to a pupil goes to a team, or to him with his guardian copied; every message kept and openable by a DSO; a pupil can report any message in one tap — and `db/57` already enforces the hard edge: a `notification.recipient_id` naming a pupil is refused unless the notice is the system's own. The prototype's inbox of directives with Accept and Dismiss is therefore not redesigned; it is declined.

### 5.2 The match plan, to the side

The coach writes **one plan per fixture** — words, up to a short limit — and it is a post to the side: `news.publish.team` (A3), tagged to the fixture, readable by every boy named on the sheet and by the side's staff on the fixture screen (S3). The captain's section (C2) draws it first and so does every team-mate's fixture screen. Why this shape (D5):

- a batting order and a plan are the side's, not one boy's; the sheet is already read by the whole XI;
- the whole side and every adult on the side seeing it is the clearest form of "visible to a second adult";
- a narrower audience (captain, vice-captain and the staff) would need an honour-gated read and a migration, for a privacy from team-mates that nobody has asked for;
- it is kept like any post, on the fixture, and a DSO can open it on a concern; the pupil's "Raise a concern" is in his persona header already.

**What a plan may not say**, enforced at the writer with the words refused back: no health or load ("Naidoo is on four overs, physio"), no reason for anyone's absence, no name of another school's child beyond the public label, no derisive words (SG-10's list). The same filter the AI line already passes through, applied to a coach's post.

*Rejected — a plan visible to the captain and vice-captain only:* the cost above, and a private channel to two children is a private channel.
*Rejected — the plan on the pad:* the pad is the scorer's, and the scorer may be a pupil of either school.

### 5.3 Him writing back

**Nothing in the first build** (D6). A decision log ("+2nd slip", "ring in", with an invented "impact") is declined: field changes are recorded nowhere, the "impact" is a story, and a captain scoring his own decisions on a phone during an over is not a product. A captain's post-match note to the side — "we lost it in overs 8–12; next week we bowl straighter" — is a real thing a captain says, and could be a post under the same rule as §5.2 (to the side, with the staff reading, by a pupil under an honour-gated publish). It needs a new capability gated by `is_captain_of()` and is a phase C item if Kameel wants it after a term.

### 5.4 Law 25.4.3

A batter who retired for a reason other than illness or injury may resume only with the opposing captain's consent. That consent is given on the field, to the umpires, and the pad records it today. The view does not become a signing device, and no consent is taken from a phone: the log carries the resumption and the Match Centre shows it. Nothing to build.

---

## 6 · Under 18 and 18 at school

**No difference.** The gate is age-blind; a 1st XI captain is as often eighteen as seventeen, and the view treats him as a pupil of the school either way. What changes at eighteen is already decided elsewhere and is his own business, not the side's: his consents become his (STEP4 §3.3), the guardian link stays open while he is at school (SCRBRD-110 §7.4, signed off 2026-09-28). Because nothing in §5 goes to him alone, SG-9's "with his guardian copied" never arises, and so neither does the question of copying the guardian of an adult pupil. A club's adult captain, with `player` and `selfaccess` and no guardian, gets the same view word for word (the words come from `tenantWords()`).

---

## 7 · Where it lives, and the phone

- **Inside the pupil app**, behind the four-item bar (Home · Matches · Passport · Me), which does not change: the honour switches on **a card on Home (C1)**, **a section on the fixture screen (C2)** and **a Captain tab in the Match Centre in family mode (C3–C5)**. No fifth bar item, no drawer, no separate screen or route. A boy without the honour, or with a withdrawn one, sees the app exactly as built and nothing suggests a tab is missing.
- **Phone first**, portrait at 390; a laptop gets the same screens wider. The Board is black and stays black in the sun (DESIGN_DIRECTION decision 6); every figure is tabular in the figure face; a word beside every chip; no colour alone (the striker's ● is said).
- **Floors:** 12px for every text, including the strip's rows and the legend (`smoke-a11y`'s check); 44px for every tap target; 56px for anything a boy taps in a hurry, as the declaration keys on S3.
- **Reduced motion:** the Board's figure flips and the RateTrack's slides become cuts (133 §4's rule); the strip does not animate; nothing autoplays.
- **Nothing pushes.** The plan's arrival is a notice in Notices like any post; the push payload is a pointer.

---

## 8 · The prototype's ideas: what survives

Every figure in `CaptainCockpitView.tsx` and `CaptainTacticalCockpit.tsx` is typed into the code. The ideas are judged on their own.

| idea | verdict | why |
|---|---|---|
| a glanceable score: total, overs, CRR, projected, target, RRR | **survives** as the Board and the second line (133 §3: need, RRR climbing/steady/falling, par ahead/behind; "At this rate" as built) | the fold's figures, already drawn |
| "momentum: +34 in last 5 ov", a phase word | survives as the over strip; the phase word is dropped | the strip shows the last six overs as they were; the over number says the phase |
| the last twelve deliveries | **survives** as this over's chips and the strip | as built |
| the batters in, with score and balls | **survives** on the Board | the fold |
| a batter's "primary scoring tendency, 68% boundaries" and "threat level" | dropped; the side's wheel for this match replaces the first (C4) | a per-batter read of another school's child is not his; threat levels are invented |
| the bowler's figures, economy, this spell | **survives** (C4) | the fold |
| "remaining allocation 3.3 overs" | **survives** as `capWords()` against the competition's cap | the frozen document; the pad's wording |
| "Max 8.0 overs (Physio restricted)" | **never** | health data about a child, shown to children (K3, CSA p52) |
| the coach's directive inbox, confidence %, sample size, Accept/Dismiss | **declined**; the plan to the side replaces it (§5.2) | SG-9; `db/57` refuses a pupil recipient; the % is invented; a boy does not "dismiss" an adult in an app |
| the over planner: intent v execution per ball, "adherence 80%" | dropped | intent is recorded nowhere; a fifteen-year-old is not scored on adherence |
| the one-tap decision logger and timeline with "impact" | dropped; a captain's post-match note is a phase C question (D6) | field changes are not data; "impact" is a story |
| the aggression slider, the bowling-plan select, win probability, "apply & broadcast tactics" | dropped | 133 D4 parks win probability; "broadcast" is a message to children; sliders that move a made-up number |
| "View full coach cockpit" | **never** | SCRBRD-136 carries workload and availability |

---

## 9 · Phasing and tiers

| phase | ships | migration | who | proof |
|---|---|---|---|---|
| **A · The view over what exists** | C1, C2 (without the plan), C3, C4, C5; the gate read client-side from his own honour row; the `capWords()` lines; the RateTrack and strip reused | none | Sonnet builds; **Opus reviews** every screen (minors' data on screen, as STEP4 phase A was) | `smoke-browser-pupil` gains a captain group: the seed's pupil is awarded `captain` (A6) and the card, section and tab appear; a team-mate without the honour has none; after withdrawal they are gone on the next load; after the honour's side differs from his, gone; nothing on the tab is an injury, a fitness word, a guideline, an availability or a reason; no row of another school's child opens; `capWords()`'s sentence matches the pad's for the same bowler. `apps/web/test/family.test.mjs`: next-in is the sheet minus the batted; a bowler with no cap has no line. `smoke-a11y` over the new surfaces. `separation.test.mjs` unchanged — no capability moves. |
| **B · The plan to the side** | the coach's one-per-fixture post, the writer's filter, the fixture screen drawing it for every boy on the sheet, C1's "Plan from…" line | one, if `news` cannot be tagged to a fixture (A3) | **Opus** (a channel that reaches children), Sonnet the form | a `db/99` section: the plan is read by every boy on the sheet and the side's staff, by no other side at the school, by nobody at the other school; no row with `recipient_id` names a pupil (db/57's test still green); the filter refuses the health and reason words. Walk: the plan appears on a team-mate's fixture screen, not only the captain's. |
| **C · Server-side gates, if wanted** | `is_captain_of(p_player, p_team, p_season)`; anything gated on it: a captain's note to the side (D6) | one | **Opus** | a `db/99` section: true for the seed's live honour; false for withdrawn, last season, another side, another school; true for `vice_captain`; a boy reading through the function cannot reach a row the honour does not cover. |

Phase A is the whole product for the pilot. Nothing in B or C changes a screen shipped in A; each adds a card that was not drawn. The lead numbers migrations and `db/99` sections at build.

---

## 10 · Decisions for Kameel

| # | decision | recommendation | why, in one line |
|---|---|---|---|
| **D1** | Does a vice-captain get the view? | **Yes, the same view** | he leads when the captain is batting or away, and a lesser screen is a second screen for nothing |
| **D2** | The gate is the honour's side = his current side, and the fixture's season | **Yes** | the honour table says an honour does not move sides; a captain moved down is not the 2nd XI's captain |
| **D3** | A captain for the day with no honour | **No view; the stand-in is a season's `vice_captain`** | a per-match mark is a migration for a case the vice-captain covers |
| **D4** | Overs left: the competition's cap per bowler (`capWords()`), and the band's directive as one line for the side; never a per-boy spell or day figure | **As stated** | a per-boy figure differs by date of birth or by a physio's guideline, and either leaks |
| **D5** | The coach's plan goes to the whole side, never to the captain alone | **To the side** | meets SG-9 by construction with no new gate; a plan is the side's |
| **D6** | May the captain write anything back (a note to the side; a decision log)? | **Not in phase A or B; the note is a phase C question after a term; the log never** | the log is invented causality; the note needs an honour-gated publish |
| **D7** | Any sight of availability — even a count of the unanswered? | **None** | "unavailable, family" is a window into a home; the sheet is the answer; the nudge is the coach's notice |
| **D8** | Matchups: his batters against bowling types; no named child of another school | **Yes** | the read already scopes it; the screen must not offer a row it cannot fill |
| **D9** | The opposition in the view is the competition table and the public page; the dossier never | **Yes** | `opposition.read` is staff-only and off by default |
| **D10** | The ground display's Bowling panel (133) stays as decided — no overs-left on the public screen | **Unchanged** | the fielding captain's cue is the scorer's words through the umpire |
| **D11** | Phase A's gate is client-side; SQL only when a server read is gated | **Yes** | nothing in A widens a read, so there is nothing to gate |

## 11 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | `match_conditions.doc`'s play part is readable by a `fixture.read` holder (the pad's `conditionsLine.jsx` and `lib/playingConditions.js` read it; the public page shows the format) | the conditions line is drawn from the fixture's own format and overs, and the cap line is not drawn until a read exists |
| **A2** | `matchups?batterId=` is under `player.performance.read` and drops rows naming a player the reader may not read (the smoke's lesson) | the matchups card waits for phase C and a scoped read |
| **A3** | `coach` holds `news.publish.team`, and a post can carry a fixture (or gains `fixture_id` in phase B) | phase B's migration adds the column |
| **A4** | the par and RateTrack reach a signed-in reader of an unpublished fixture (133 §3.5 puts `RateTrack` on the Summary tab's Board) | the second line falls back to the chase line as built; no par |
| **A5** | `match_squad` carries no captain mark (none found in `db/08`) | D3's per-match mark already exists and the day captain is a client check |
| **A6** | the seed can award the pupil persona a `captain` honour for the walk without disturbing other walks | the walk awards and withdraws it inside its own run |
| **A7** | a fixture's age band is derivable from the side (the team's band) for the one-line directive | the band line is not drawn |
| **A8** | the side's twelve-sector wheel for the opposition's innings is the public read (`/api/public/matches/:id/shots`) and needs a published fixture | for an unpublished fixture the card is not drawn; a signed-in side-level read is a phase C question |

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `honour`, `honour_stamp()`, `honour_once_a_season`, `honour_kind_label()` | `db/08` 5451–5530 | the gate; the label |
| `POST /api/honours`, `…/withdraw`, `KINDS` | `services/api/write/recognition-api.mjs` | how it starts and ends |
| `recognition?playerId`, `honours` reads | `services/api/read/read-api.mjs` (STEP4 S3) | the client's read of his own honour |
| `player`, `selfaccess`, `guardian` bundles; `boundaries()` | `packages/policy/src/roles.mjs` 330–400 | what he holds; "who to ask" |
| `db/55` (K3), `db/58` (fitness mask), `db/57` (`recipient_is_pupil`, SG-9) | `db/` | the "never" table; the channel rule |
| `bowlerInningsCap()`, `bowlingLimit()`, `capWords()`, `oversPerInnings()` | `packages/scoring/src/conditions.mjs` | overs left; the conditions line |
| `match_conditions.doc`, `match_conditions_fix()` | `db/61` | the frozen document |
| `conditionsLine.jsx`, `lib/playingConditions.js` | `apps/web/src/scorer/`, `apps/web/src/lib/` | the pad's wording, reused |
| `Board`, `boardFromInnings()`, `boardInsights()`, `RateTrack`, the over strip, `TeamWheel`, `chaseLine()` | `apps/web/src/ui/`, `scorer/boardData.js`, `signals.js`, 133 §2–3, §6 | C3–C5 |
| `deriveMatch()`, `deriveCommentary()`, `resultText()` | `packages/scoring`; `lib/matchCentre.js` | the fold; the innings in words |
| `match_squad`, `SideSheet`, `match_pitch_report`, `weather`, `match_toss`, `match_official`, `trips` | `db/00`, `db/08` 1428; `views/family/` | C2 |
| `career_by_season`, `matchups` | `read-api.mjs`; `tools/smoke-matchups.mjs` | this season; the matchups |
| `PERSONA_NAV`, `personaFor()`, `MatchView` `focus` (family mode), `PupilHome`, `FixtureDetail` | `apps/web/src/design/roles.js`, `views/matchcentre/MatchView.jsx`, `views/family/` | where it lives |
| `smoke-browser-pupil.mjs`, `family.test.mjs`, `smoke-a11y` | `tools/`, `apps/web/test/` | the walks phase A extends |
| ADR 0002, ADR 0003; SCRBRD-110 §6.5, §7.4; SAFEGUARDING_DSO §1, §4.4, §9.1; CSA check SG-9, K3; 133 §2–3, D4; 136 | `docs/` | the rules this design does not reopen |
