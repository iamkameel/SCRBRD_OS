# SCRBRD-136 / 137 — The coach's match-day cockpit, and a feed of real signals: the design

**Status:** for Kameel's review, 2026-10-02. Nothing built yet.
**Source:** `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md` SCRBRD-136, 137, 138; ADR 0001, 0002, 0003; `docs/design/SCRBRD-110_workload.md` (what a coach reads of load and health; the health consent); `docs/design/SCRBRD-138_captains_view.md` (the sister design, decided); `docs/design/SCRBRD-133_immersive_match_centre.md` §2–3 and D4; `docs/design/SAFEGUARDING_DSO.md` §1, §4.4, K3; `docs/design/SCRBRD-124_lift_clubs.md` (db/76 as built; §2, §5, §6); `packages/policy/src/roles.mjs`, `capabilities.mjs`; `services/api/read/read-api.mjs`; the beta-2 prototype's `CoachCockpitView.tsx` and its Intelligence drawer.
**Reader:** the product owner first, then the Opus lead who reviews it, then the Opus agent who builds any new read or gate and the Sonnet agent who builds the screens. Plain words come first in each section. Names in the sketches are the seed's illustrative ones (Hilton, Kearsney, D Erasmus, R Pillay, K Naidoo, J Smith, T Cele, M Khan, Mr Dlamini, Mrs Naidoo), never a real child's.

**Lead's review (Opus, 2026-10-02), before Kameel reads it.** Checked against the branch: the entry rule and the role table follow `roles.mjs`; phase A widens no read and needs no migration; the refused signals (§4.4) are the right ones; D11 keeps every signal off parents' and pupils' phones. The three findings in §3.6 (D15) are confirmed and become one small Opus fix, separate from this build:
1. **`bowling_spells`** returns `age_band` (derived from a boy's date of birth) and the directive's maxima to every reader of the match's log, a scorer or a pupil included. The age band and the limits will be returned only under `player.workload.read`; everyone else gets the spells without them.
2. **`shot_points`** reads `ball_event`, so a delivery the scorer voided can still be drawn on the match wagon wheel; `player_shot_points` already reads `ball_event_live`. It will read `ball_event_live` too.
3. **`bowling_breaches`**: the comment names `player.development.read`; the policy is `player.workload.read`. The comment will be corrected.
`teammanager` holding `medical.nature.read` and `availability` carrying `reason_kind` and `note` are as designed (ADR 0002, SCRBRD-110); this design keeps both off the cockpit (D4).

---

## 0 · In one page

A coach on a Saturday has three questions: *who have I got*, *what is the match doing*, and *how much has each bowler left*. beta-2 answered them with four cockpits whose every figure was typed into the code. This design answers them from reads that already exist, and says plainly where no read can answer.

**The cockpit (136) is a Coach tab in the Match Centre and a match-day card on the Dashboard**, drawn for whoever holds the right capabilities on the fixture's side, never for a job title. Before the match: the day (format, cap, pitch, weather, umpires, bus, lifts), the side (the readiness read: who is picked, who said no, who the physio has restricted and until when), each pace bowler's directive figures and his week's load word, and the opposition dossier while its five-day window is open. During: the Board and its second line, the over strip, this over's chips, the bowlers with the cap's own words beside each, the phase split, and where the runs went by shot. After: the result, the spells as the log recorded them, and our batters against bowling types.

**Health in the cockpit is the status tier only** (out, restricted, back on a date). A coach may read the nature tier (ADR 0002) and still does, on the Injuries screen he opens on purpose; a phone held up in a pavilion is not that screen (D4). Load is what SCRBRD-110 already gives him — overs this week, the directive, a word — never a guideline's reason, never a check-in, never a flag beside a name on the team sheet (D5).

**The feed (137) is a drawer of cards, each a rule over data the reader already holds**, evaluated when he opens it, with its evidence and its count on the card and the capability that let him see it. Twelve rules survive (§4.3); eight are refused (§4.4), among them anything medical beyond status, anything disciplinary (a coach holds no `discipline.read`), and anything safeguarding. **The feed pushes nothing** and reaches no parent and no pupil (D11): what must reach a phone already goes through the notification path with its pointer payload, and the feed shows those notices as a lane rather than re-inventing them.

**Not carried over from beta-2:** win probability, a 0–100 pressure index, threat levels, ball speed, false shots, a pitch rating, "workload risk 86%", "+18% win equity". Each is a number nobody measured (§5).

**Phase A needs no migration.** Sonnet builds the tab, the card and the drawer over existing reads; Opus reviews every screen because minors' data is on it. Phase B is three small Opus items: one read (`bowler_day`), one table (`signal_ack`), and the `effective_limits()` line when SCRBRD-110 phase 3 lands.

---

## 1 · Who gets it

### 1.1 Plain words

Nobody gets the cockpit for being called "head coach". The tab appears for a person whose live assignment covers the fixture's side and grants the capabilities a panel needs; each panel checks its own. So an assistant coach sees everything the head coach sees except the selection controls; a team manager sees the side and the bus and no load; a scorer sees none of it, because the pad is his screen; a physio holding `player.workload.read` for the school sees the load, the spells and the injuries and no selection. That is ADR 0003 applied: the specialism decides what the app shows first, the capability decides what it may show at all.

### 1.2 The entry rule, stated once

The Coach tab and the match-day card are drawn when **one assignment** (ADR 0001: never a union) that is school- or team-scoped — never `selfaccess`, `guardian` or `enquiry` (`SUBJECT_SCOPED_ROLES`) — covers the fixture's side and grants **`team.select` or `player.workload.read`**. Nothing is widened by the tab existing: a reader who passes the entry rule and lacks a panel's capability sees that panel not drawn, and `boundaries(role)` rendered as help if he asks.

| role (today's bundle) | enters | side panel (`availability.read`, `team.read`) | selects (`team.select`) | load (`player.workload.read`) | injury status (`medical.status.read`) | opposition (`opposition.read`) | bus (`transport.read`) | lifts (`transport.lift.receive`) |
|---|---|---|---|---|---|---|---|---|
| `coach` | yes | yes | yes | yes | yes | yes | yes | yes |
| `assistantcoach` | yes (load) | yes | no | yes | yes | yes | yes | yes |
| `teammanager` | yes (select) | yes | yes | **no** | yes | **no** | yes | yes |
| `directorofsport` | yes | yes | yes | yes | yes | yes | yes | no |
| `sportsadmin` | yes (select) | yes | yes | no | yes | no | yes | no |
| `medical`, `fitness` | yes (load) | no | no | yes | yes | no | no | no |
| `scorer`, `official`, `analyst`, `media`, `spectator` | **no** | — | — | — | — | — | — | — |
| `player`, `guardian`, `selfaccess` | **never** | — | — | — | — | — | — | — |

The client asks `holdsCapability()` per panel (as `AvailabilityPanel` does today); the server's reads decide what comes back. **The table is derived from `roles.mjs` at build time, not typed into the screen** (A1).

---

## 2 · When he would use it

### 2.1 Plain words

Thursday evening, picking; Friday, chasing answers; Saturday morning on the bus and at the toss; between overs with the phone in his pocket and the pad in the scorer's hands; drinks and the innings break; the evening after. The screen is built for those moments. In the field a coach is not scoring and not tapping; the pavilion display (133) and the scorer's words are what he reads at ten metres.

### 2.2 The moments

| moment | what he wants | where |
|---|---|---|
| Thursday | the sheet against who has answered, who is restricted, each bowler's week; the dossier if open | **P1–P4**, the Dashboard card, the feed |
| Friday | the unanswered; the bus against the sheet; lifts expected; conditions frozen or not | the feed (S3, S6, S7, S8, S10) |
| the bus | the format and the cap, pitch, weather, umpires | **P1** |
| the toss | nothing on a phone | — |
| fielding, between overs | the bowlers and their overs left; the strip | **P6** |
| drinks, the break | the phase split; where they scored; the chase line | **P7, P8** |
| his side bats | the Board, par and rate trend, next in, the strip | **P5** |
| after | the result, the spells as recorded, matchups by type, breaches on record | **P9** |

*Rejected — a "tactics console" with a field map and a bowling-change planner:* field settings are recorded nowhere, and the planner's "adherence %" was invented (138 §8 reached the same verdict for the captain).

---

## 3 · The cockpit, panel by panel (136)

### 3.1 Plain words

Every panel below names the read it draws from, the capability that gates the read in the database, and what is left out on purpose. Where a read is missing it says so and gives the gate the read must carry. The Board, the second line, the over strip, the `RateTrack` and the chips are 133's, reused unchanged; the cap's sentences are `capWords()`'s, reused from the pad and the captain's tab so the three surfaces never disagree about one rule.

### 3.2 Before the match

```
┌──────────────────────────────────────────┐
│ ‹ Sat 3 Oct · Hilton U15A v Kearsney     │
│ COACH · HILTON U15A                      │
├──────────────────────────────────────────┤
│ THE DAY                               P1 │
│ 20 overs · 4 an innings per bowler ·     │  conditionsLine as built
│ free hit on · U15 League                 │
│ U15 directive: 6 a spell, 12 a day       │  PACE-U15, the clause beside it
│ Pitch: firm, good grass · 22° rain at 2  │
│ Umpires: Mr Khoza, Mr Pillay · no scorer │  duties: a gap is a gap
│ Bus 07:15 school gate · 22 seats ·       │  trips
│ 14 named · 2 arriving by lift            │  lift_expected
├──────────────────────────────────────────┤
│ THE SIDE · published Thu              P2 │  readiness
│  1 D Erasmus   available                 │
│  2 R Pillay    UNAVAILABLE · said Thu    │  the family's word, no reason here
│  6 K Naidoo    restricted · back 14 Oct  │  status tier only
│  7 J Smith     no answer                 │
│  … 11 named · 1 to chase · 1 restricted  │
├──────────────────────────────────────────┤
│ OUR BOWLERS THIS WEEK                 P3 │  workload?teamCode
│  K Naidoo  14 ov · steady    6/12  U15   │  overs_7d · load_word · spell/day
│  J Smith    6 ov · rising ~  6/12  U15   │  ~ = estimate (nets band inside)
│  T Cele     — · rested       6/12  U15   │
│  "A guide to a conversation, not a       │  110 §2.2's fixed sentence
│   diagnosis."                            │
├──────────────────────────────────────────┤
│ KEARSNEY · DOSSIER · closes Sat 09:00 P4 │  opposition_context / _squad
│  their squad, cricket columns only       │  OppositionDossier as built
└──────────────────────────────────────────┘
```

| panel | source (read → function or table) | gate (in the database) | left out on purpose |
|---|---|---|---|
| **P1 The day** | `GET /api/matches/:id/playing-conditions` (the frozen `match_conditions.doc`, db/61) → `conditionsLine`; `bowling_directives` + `rulebook_clauses` for the band's line; `pitch_report`, `weather`, `officials`, `match_duties`; `trips?matchId` (capacity, `seats_taken`, state); `lift_expected(p_match)` through `lift-api.mjs` | `fixture.read` for the conditions, pitch, weather, officials, duties; `transport.read` for the bus; `transport.lift.receive` for the lifts (team-scoped; **logged** as db/76 logs it) | the back leg of any lift (not the coach's, 124 §5.1); any phone number; the lift driver's car beyond her name; the duty roster's names beyond the slot (a gap reads "no scorer on record", as `duties.jsx` has it) |
| **P2 The side** | `readiness?matchId`: `selected`, `batting_no`, `declared_status` (effective, db/65), `said_status`, `needs_reconfirming`, `self_declared`, `declared_by_name`, `clinically_restricted`, `rtw_date`, `state` | `team.read` (the roster), `availability.read` (the family's answer), `medical.status.read` (restricted, `rtw_date`); `team.select` to change the sheet | **`reason_kind` and `note`** (the `availability` read carries them to every `availability.read` holder; the cockpit does not draw them: "unavailable" is enough on a Saturday and the reason is on the Squad screen he opens on purpose, D4); `injury_type`, `severity`, `phase` (nature tier: on the Injuries screen, never here); `player.fitness` (nothing writes it; `readiness` already refuses it) |
| **P3 Our bowlers this week** | `workload?teamCode`: `overs_7d`, `overs_28d`, `longest_spell_7d`, `breaches_28d`, `load_word`, `estimated_7d`, `max_overs_per_spell`, `max_overs_per_day`, `age_band`, `pace`, `clause_code` | `player.workload.read` (level 2; evaluated per boy inside `workload()`) | `acwr` and `ewma_ratio` as numbers (the word is the figure a coach acts on; the numbers are the physio's screen); `monitored` and the phase-2 `open_flag` dot (D5); a guideline's basis ("returning from injury", "set by the physio") when 110 phase 3 lands — the cockpit shows the effective figure and the Workload profile shows why (D6); the word *risk* anywhere |
| **P4 The opposition** | `opposition_context?matchId`, `opposition_squad?matchId` (`db/08` 4493, 4539; window `opposition_window_days()` = 5, db/46; closes at the first ball; **every read logged against the other school**) | `opposition.read` at the reader's side of this head-to-head fixture; the `opposition` feature, off by default per school | anything about a child's person: DOB, guardian, notes, fitness, availability; figures the log is too thin to carry (the function withholds them below thirty balls and says why); after the first ball, anything but this match's scorecard (§3.5) |

**The Dashboard card** is P2's last line and P1's bus line for the next fixture within seven days, with the feed's count: *"v Kearsney Sat 09:00 · 11 named · 1 to chase · 1 restricted · 3 signals"*. One tap opens the tab.

### 3.3 During the match

```
┌──────────────────────────────────────────┐
│ ████████████ BOARD (black) ████████████ │  P5
│  KEARSNEY                   87 / 3       │
│  12.0 · CRR 7.25 · At this rate: 145     │  133 §3's second line; par when it exists
│  ● S Mkhize 31 (24)   L Dube 12 (9)      │
│  par 81 ──┼──●── 87  "+6"                │  RateTrack (133 §3.5)
│  · 1 · 4 W · 2                           │  this over's chips
├──────────────────────────────────────────┤
│ OUR BOWLERS · OVERS LEFT              P6 │  the fold + capWords + bowling_spells
│  K Naidoo  4-0-18-2  Has bowled his 4    │  the cap's words, verbatim
│  J Smith   3-0-21-0  Has 1 over left     │
│            spell 3 of 6 (U15 directive)  │  the directive, as a figure
│  T Cele    3-1-12-1  Has 1 over left     │
│  M Khan    2-0-19-0  Has 2 overs left    │
│  not yet bowled: D Erasmus, R Pillay     │
├──────────────────────────────────────────┤
│ OVER STORY · last six                 P7 │  133 §6 strip, as built
│  12  Khan   · 4 1 W · 2wd    8 · 1W      │
│  11  Cele   1 · · 4 2 ·      8           │
│ PHASES                                   │  phases?matchId
│  Powerplay 1–6   41/1 · RR 6.8           │
│  Middle   7–12   46/2 · RR 7.7           │
├──────────────────────────────────────────┤
│ WHERE THE RUNS WENT                   P8 │  shot_points?matchId
│  [ wheel · filter: all · drive · pull … ]│  by shot, this innings
│  Mkhize: 31 · 18 off the drive, cover    │  this match's log only
└──────────────────────────────────────────┘
```

| panel | source | gate | left out on purpose |
|---|---|---|---|
| **P5 Match command** | the fold (`deriveMatch()` through `live.js`): score, wickets, overs, the two batters, the partnership, the bowler, this over's chips (last twelve balls as `inn.ballLog`), `chaseLine()`, `atThisRate()`; 133's `RateTrack` and `/par` where it ships | `fixture.read` + `scoring.*` as the Match Centre reads today (the same rows every signed-in reader of the match has) | a win probability, a pressure number, a "momentum" word (§5); nothing that is not the fold's |
| **P6 Overs left** | `bowlerCapWords(termsOf(fold), balls)` for the competition cap (as `captainTab.jsx`); `bowling_spells?matchId` for the directive: `spell_no`, `overs`, `max_overs_per_spell`, `max_overs_per_day`, `over_spell_limit`, `breach_recorded` | `fixture.read` for the cap (the frozen document is the match's); `bowler_spell` is a `security_invoker` view over the log the reader may see; **the directive figures should sit under `player.workload.read`** — see the lead's note in §3.6 | a guideline for one boy (110 phase 3): the figure may be shown as "4 a spell" once `effective_limits()` exists, **its basis never on this panel** (D6); any reason a bowler should stop; today's overs across *two* matches (no read: `bowler_day`, phase B) |
| **P7 Over story and phases** | the strip (133 §6, built); `phases?matchId` → `composePhases` (powerplay, middle, death from `m.overs`, never from the caller) | `fixture.read` | nothing: team-level figures |
| **P8 Where the runs went, by shot** | `shot_points?matchId` (`seq`, `shot`, `theta`, `radius`, `striker_id`, `bowler_id`), filtered on `shot` as the pad records it; `ShotWheel` and `WagonAnalysisPanel` as built | the match's `ball_event` under the reader's RLS | a **career** wheel for another school's child (`player_shot_points?playerId` is drawn for our own boys only, D8); ball speed, a pitch map (SCRBRD-108), "false shots" (§5) |

**Why P8 may name an opposition batter in this match.** The scorecard of a fixture both sides are in is read by every signed-in reader of it, and the opposition's bowlers and batters already appear by the name the log carries (STEP4 §9 Q4; 138 §3.4). A wheel of *this innings'* balls is the scorecard one grain finer. A wheel of *his season* is the dossier's business and stays inside its window (D8).

### 3.4 After the match

**P9** is the Summary tab's result words, both innings' lines, the strip in full, our bowlers' spells as `bowling_spells` recorded them with `over_spell_limit` and `breach_recorded` said plainly ("5 overs; the directive allowed 4; a breach is on record"), and **our batters against bowling types** — `matchups?batterId=` per boy, folded by `bowling_style` as `matchupTypes()` does, a type drawn only when it has thirty balls behind it (the dossier's own floor) and `matchup_coverage` said beside it ("48 of 61 balls attributable"). A row naming a bowler the reader may not read comes back empty from the read itself (the lesson in `smoke-matchups.mjs`'s header), so **a named child of another school never appears** and the screen never offers a row the read cannot fill (138 D8, kept).

### 3.5 Opposition data: the window, and what a coach may know of another school's children

| when | what he may read | through | logged |
|---|---|---|---|
| more than five days before the first ball | nothing: the dossier says "opens Mon 09:00" and no count | `opposition_context()` returns `open = false, reason = 'not_yet_open'` and null counts | — |
| inside the window | the other side's named squad with **cricket columns and aggregates** over their own log; figures withheld below thirty balls | `opposition_squad()`, `opposition.read` at his side of this fixture, the `opposition` feature on | **yes**, every read, against the other school's `access_log`, every boy's id |
| from the first ball | this match's scorecard and log, as every signed-in reader has it: names as the log carries them, this innings' wheel (P8) | the fold | — |
| after the match | the scorecard; our batters against *types* (P9) | `matchups` (RLS drops the named rows) | — |
| ever | DOB, guardian, note, fitness, availability, injury, load of another school's child | — | **never**: no read exists and none is proposed |

The window is five days (db/46), and this design does not move it (D9).

### 3.6 Workload and health: exactly what SCRBRD-110 and ADR 0002 allow, and never more

| tier | capability | coach holds | the cockpit draws | where the rest is |
|---|---|---|---|---|
| availability | `availability.read` (2) | yes | the effective status, who said it, when | `reason_kind`, `note` on the Squad screen |
| injury status | `medical.status.read` (2) | yes | `restricted`, `rtw_date` | — |
| injury nature | `medical.nature.read` (3) | yes (ADR 0002) | **nothing** (D4) | `InjuryView` |
| clinical details | `medical.details.read` (4) | **no** (db/21) | — | the physio, the family, the boy |
| load | `player.workload.read` (2) | yes | overs this week, the word, the directive figures; "estimate" where a band is inside | the Workload screen: windows, ratios, baseline |
| guideline (110 phase 3) | `player.workload.read` | yes, when built | the effective figure as a figure | the profile: its basis and who set it |
| check-ins, flags, tests (110 phases 2, 4) | `wellness.read` (3), `wellness.alert` | reads yes; the flag notice yes | **nothing**, not a dot (D5) | the notice itself, in Notices and in the feed's notices lane; the Workload list's dot |
| discipline | `discipline.read` (3) | **no** | — | not his |
| safeguarding | `safeguarding.*` (4) | **never** | — | the DSO card only |

*For the lead, found in the reads (not this design's to fix):* (i) `bowling_spells` returns `age_band`, `pace`, `max_overs_per_spell` and `max_overs_per_day` for every bowler to anyone who can read the match's log — the view is `security_invoker` over `ball_event` and the lateral `bowling_directive_for()` is not gated. A band is derived from a date of birth (`player.age.read`, level 2), and a boy playing up a band is revealed by it to a scorer or a pupil. P6 draws those columns only under `player.workload.read` on the client, but the read itself should be looked at. (ii) `shot_points` reads the `ball_event` base table where `player_shot_points` reads `ball_event_career`, which drops voided balls; P8 should draw from a read that drops them. (iii) `bowling_breaches`' comment says "under `player.development.read`"; the policy (`db/08` 5279) is `player.workload.read`. Comment drift only.

### 3.7 What the cockpit never shows

| never | why |
|---|---|
| the nature of an injury, on this surface | ADR 0002 allows it; this design keeps it off a pavilion phone (D4). `InjuryView` is one tap away |
| a reason for an absence | `reason_kind` is a window into a home; it stays on the Squad screen |
| a check-in, a soreness map, an open flag, "something doesn't feel right" | 110 §3.3: a flag "never touches selection … never shows on a team screen" (D5) |
| a guideline's basis beside a name | the figure is the coach's; the clinical reason is the profile's (D6) |
| another school's child beyond §3.5 | `opposition.read` is bounded three ways in `db/08`; nothing widens it |
| discipline, safeguarding, clearances, PII, the ID number, the home address | the coach's bundle holds none of them; `boundaries("coach")` says who does |
| a win chance, a pressure index, a threat level, ball speed, false shots, a pitch rating | §5 |
| a per-boy "overs left" on the public ground display | 133 D10 / 138 D10 stand |

---

## 4 · The feed (137)

### 4.1 Plain words

A signal is a sentence the data can prove: *"the bus seats 22 and 25 are named"*, *"K Naidoo has one over left"*, *"R Pillay is on the sheet and marked unavailable"*. Each card says what it found, how many, from which read, and why this reader is seeing it (the granting capability, ADR 0001's "which assignment granted it is part of the answer"). Nothing is scored, weighted or ranked by a formula; cards are ordered by the fixture's clock (today's first) and then by the rule's fixed order below. A card with nothing true behind it is not drawn.

**Phase A evaluates the rules in the browser over the reads the reader already fetched** for the cockpit — no new query, no new row, no new gate — in a pure module (`lib/signals.js`, tested under plain node like `lib/captain.js`). Dismissing a card in phase A is per device and per evidence (the key carries the count, so a bus that was two short and is now five short comes back); phase B gives it a table.

### 4.2 Who may open the drawer, and what dismissing means

The drawer opens for anyone who passes the cockpit's entry rule (§1.2); each card checks its own capability. **Dismissing a card hides it for that person** until its evidence changes; it never changes a row, never tells anyone, never marks a notice read, and is never shared between two people: a team manager dismissing "1 to chase" does not dismiss it for the coach. A signal that is still true is still true (the card's evidence is re-derived on every open), so "dismiss" is "I have seen this", nothing more (D13).

### 4.3 The rules that survive

Threshold words: *the fixture's day* is `sa_today()` on the match's `starts_at`; *soon* is within 48 hours.

| # | signal | source (read) | gate | evidence and count on the card | threshold | dismiss | never says |
|---|---|---|---|---|---|---|---|
| **S1** | **The bus is short** | `trips?matchId` (`capacity`, `seats_taken`, `state`); `match_squad?matchId` (not withdrawn); `lift_expected()` (boys arriving by lift) | `transport.read` + `team.read` (+ `transport.lift.receive` to subtract lifts; without it the card says "lifts not counted") | "Bus seats 22 · 25 named, 2 by lift → 23 travelling" | `capacity < named − by lift`, or `seats_taken > capacity` (the trigger refuses this on write; a vehicle swapped later can still make it true) | coach, team manager, office; until the counts change | a boy's name; who is on the bus |
| **S2a** | **A bowler one over from the competition's cap** (in play) | the fold's `inn.bowlers` + `capWords()` over the frozen document | `fixture.read` (the cap is the match's); drawn only in the drawer, which is behind §1.2 | "J Smith · Has 1 over left (4 an innings)" | the cap's own sentence, verbatim; also "5 overs; the conditions allow 4" after the fact | nobody while in play (it clears with the next over); afterwards anyone | a reason; a guideline |
| **S2b** | **A bowler one over from the directive's spell** (in play) | `bowling_spells?matchId`: current spell's `overs` = `max_overs_per_spell − 1` | `player.workload.read` (client-gated today; see §3.6 lead's note) | "T Cele · spell 5 of 6 (U15 directive, PACE-U15)" | `overs ≥ max − 1` on the open spell; pace bowlers only | as S2a | a boy's own guideline (110 phase 3) by name or basis |
| **S2c** | **A bowler one over from the directive's day** | **missing read:** `bowler_day?date&teamCode` → overs per bowler on the fixture's date across every match, with `max_overs_per_day` | **`player.workload.read`**, per boy inside the function, as `workload()` does | "K Naidoo · 11 of 12 today (two matches)" | `overs_today ≥ max_per_day − 1` | as S2a | — |
| **S3** | **A picked boy is unavailable, restricted or asking again** | `readiness?matchId`: `selected AND state IN ('unavailable','restricted','needs_reconfirming')` | `team.select` + `availability.read`; `medical.status.read` for the restricted case | "R Pillay · on the sheet · marked unavailable (said by Mrs Pillay, Thu)" / "K Naidoo · restricted · back 14 Oct" | one card per boy; a count in the header | the selector (team.select), by changing the sheet or by dismissing; comes back if his status changes again | `reason_kind`, `note`; the injury's nature |
| **S4a** | **A lift has not left / a boy not yet with us** (match day, out leg) | `lift_expected()`: `not_left`, `status` | `transport.lift.receive` (team-scoped; **logged** by db/76) | "2 arriving by lift · 1 lift not marked as leaving (Mrs Naidoo's) · 1 handed over, not yet confirmed" | `not_left`, or handed over and not acknowledged (db/76's 30 minutes) | the receiving staff, by tapping "with us" (the real act) or dismissing | the back leg; a phone number; a boy's name beyond the card the coach already holds |
| **S4b** | **A lift exception by name** | `lift_exceptions(p_school, p_match)` through `lift-api.mjs` | **`transport.lift.oversee`** (the office, the transport coordinator, the director of sport; **not the coach**; **logged**) | the five db/76 kinds, each with the boy, the driver, the time since | as db/76 defines them | the office, by `lift_resolve()`; dismissing does **not** resolve | — |
| **S5** | **A matchup with enough balls to mean something** | `matchups?batterId=` for each boy on the sheet, folded by type; `matchup_coverage` beside it | `player.performance.read` on our boys (the read drops rows naming players the reader may not read) | "D Erasmus v left-arm spin · 48 balls · 31 runs · out 3 times · 48 of 61 attributable" | ≥ 30 balls against a type (the dossier's floor for a strike rate); drawn before the match only | anyone; it does not return until the balls grow by six | a named bowler of another school (the read cannot return one to this reader); a "threat level" |
| **S6** | **The sheet is thin or unpublished** | `match_squad?matchId` | `team.select` | "9 named for Sat · the sheet has no twelfth" | fewer than 11 not withdrawn, and the fixture soon | the selector | names |
| **S7** | **Unanswered** | `availability?matchId`: `status IS NULL OR needs_reconfirming` | `availability.read` | "4 have not answered · 1 to answer again (the fixture moved)" — a count; names on the Squad screen | ≥ 1 and the fixture soon | coach, team manager; comes back as the count changes | names on the card; any reason |
| **S8** | **No scorer / umpire / first-aider on record** | `match_duties?matchId` (the readiness read `ReadinessOverview` already fans out) | `fixture.read` | "No scorer on record for Sat" per empty slot | a slot with nothing on record, fixture soon | the person who can fill it; the office | "pending" (duties.jsx's rule: nothing says how many a fixture ought to have) |
| **S9** | **Weather** | `weather?matchId` | `fixture.read` | "Rain likely from 14:00 · 22° overcast" | the weather read's own words; one card | anyone | a DLS figure (that is 130/133's and lives on the Board) |
| **S10** | **No playing conditions for this fixture** | `GET /api/matches/:id/playing-conditions` returns none | `fixture.read` | "No conditions document: the pad will use the platform default (no cap, no free hit)" | absent, fixture soon | the competition's administrator by publishing; dismissable by anyone | — |
| **S11** | **A pace bowler's week is rising or a spike** | `workload?teamCode`: `load_word IN ('rising','spike')`, `estimated_7d` | `player.workload.read` | "J Smith · 6 overs this week · rising (estimate) — a guide to a conversation, not a diagnosis" | the words 110 §2.2 fixes; pace bowlers on the sheet | coach, assistant, physio; until the word changes | *risk*, *danger*, *injury*; the ratio as a number; any guideline |
| **S12** | **The notices lane** | `notifications` read: `kind IN ('welfare', 'selection', 'transport', …)` for this side's fixtures | each notice's own `required_capability` (the policy already decides) | the notice as published (a breach: "…is 5 overs into a spell; the directive allows 4. Take him off.") | as published | read/unread as Notices does; dismissing here marks it read there (one state, not two) | nothing new: the feed re-derives none of these |

**On S2a and the drawer's gate.** The cap's sentence is public-grade (the captain reads it, the pad says it), but the card is drawn in a drawer only staff can open; a pupil's surface for the same fact is 138's tab. The gate column says what protects the *data*; the drawer's entry rule says who is *here*.

### 4.4 The signals this design refuses

| refused | why, in one line |
|---|---|
| **"Workload risk 86 %"**, any risk percentage | a number nobody measured; 110 §2.2 fixes seven words and forbids *risk* |
| **An open wellness flag or a check-in beside a name on the sheet** | 110 §3.3: the flag never touches selection and never shows on a team screen; the notice to `wellness.alert` is the channel, and S12 shows it as the notice it is, not as a selection fact |
| **"Passed his weekly guideline"** as a card | 110 §4.2, decided Q8: a line on his profile, no notice; a feed card is a notice by another name |
| **The injury's nature** on any card ("hamstring, grade 2") | status is enough to pick a side (ADR 0002's own reasoning); the nature is on the Injuries screen, D4 |
| **Anything disciplinary** ("a picked boy has an open matter") | `coach` holds no `discipline.read`; eligibility on conduct is the director of sport's by other means; a card would be a leak with a gate it does not have |
| **Anything safeguarding** (a concern, a suspension, a clearance gap) | SAFEGUARDING_DSO §1: nobody but a DSO reads a concern by standing; a coach learns of a share through the share. A suspended adult's duty already reads "suspended by the DSO" where it matters (db/34–35) and needs no card |
| **Another school's child**: his injury, his absence, "their opener is out" | no read holds it, none is proposed; the window is cricket columns only |
| **A lift exception by name on the coach's drawer** | `transport.lift.oversee` is the office's; the coach's card is S4a's head count and "with us" |
| **"+18 % win equity"**, a pitch rating, "threat level", a pressure index | §5 |
| **Unpaid fees, a missing consent, an expired clearance** | `invoice.read`, `guardian.link.manage`, `clearance.read` are not the coach's; each has its holder's screen |

### 4.5 Push or no push, and quiet hours

- **The feed pushes nothing** (D11). A signal is derived when the drawer is opened; nothing is stored in phase A, so there is nothing to deliver. What must reach a phone — a directive breach (`bowling_breach_watch()`), a wellness flag (110 phase 2), a lift alert (db/76) — already goes through `notification` with its `required_capability` and a **pointer** payload that names nobody (`fanOut()`), and S12 shows those notices as notices.
- **Quiet hours:** none exist on the platform today and this design adds none for the feed, because it sends nothing. The existing welfare notices should not acquire quiet hours through this work: a breach during play is during play.
- **A parent or a pupil never receives a signal.** The drawer is behind §1.2's entry rule, which no subject-scoped role passes. The notices a family does receive (a lift alert to every live guardian, a share notice) are db/76's and 110's own, addressed by `recipient_id` or by capability and subject, and are not this design's to widen or narrow. Nothing here writes a `notification` row (A4).

---

## 5 · Not carried over from beta-2: confirmed

| beta-2 figure | verdict | why |
|---|---|---|
| win probability | **confirmed out** | 133 D4: par gap and rate trend instead, both provable from the log; a probability needs a model nobody fitted |
| 0–100 pressure index | **confirmed out** | `signals.js`'s `pressure` is a heuristic with chosen weights (+18 for four dots, +22 for two wickets…); it stays the pad's private cue and goes on no coach surface |
| threat levels per batter | **confirmed out** | invented; the matchup's balls, runs and dismissals *are* the evidence, said as counts (S5) |
| ball speed | **confirmed out** | no speed gun; `pace_reading` (110 phase 4) is a nets asset under `player.workload.read`, never a match-day figure |
| the pitch landing map | **confirmed out** | SCRBRD-108; nothing records where a ball pitched |
| false shots, "control %" | **confirmed out** | the pad records Shot, Area, Outcome; it does not judge intent or control, and a fifteen-year-old is not scored on a judgement nobody made |
| a pitch rating ("7.2 batting") | **confirmed out** | the pitch report is the groundsman's words (firm, good grass); venue par (130 §6) is a ground's record, not a rating |
| "+18 % win equity", "workload risk 86 %" | **confirmed out** | §4.4 |

One thing beta-2 had that this design keeps: **the last twelve balls as chips**, which is this over's chips plus the strip's rows — already built.

---

## 6 · Where it lives, and the phone

- **A Coach tab in the Match Centre**, after the Summary, drawn by §1.2 as the Captain tab is drawn by the honour (`MatchView` already takes a `captain` prop and splices `CAPTAIN_TAB`; this adds a `staff` prop the same way). **A match-day card on the Dashboard** for the next fixture within seven days. **The feed is a drawer** reached from the card's count and from the tab's header; it is not a fifth destination.
- **Phone first**, portrait at 390; the laptop gets the same panels in two columns. The Board is black and stays black (DESIGN_DIRECTION decision 6); every figure tabular in the figure face; a word beside every chip; no colour alone (restricted, unavailable and no answer are words, not reds).
- **Floors:** 12 px for every text; 44 px for every tap target; 56 px for "with us" and the selection toggles.
- **Reduced motion:** the Board's flips and the `RateTrack`'s slides are cuts; cards do not animate in.
- **The pad is not the cockpit.** Nothing here is drawn on the scorer's screen: the scorer may be a pupil of either school.

---

## 7 · The prototype's ideas: what survives

| idea (beta-2 `CoachCockpitView`, the Intelligence drawer) | verdict | where |
|---|---|---|
| live score, rates, the two batters, the bowler | **survives** | P5, the fold |
| the last twelve balls | **survives** | this over's chips + the strip |
| overs remaining per bowler | **survives** | P6, `capWords()` and the directive figures |
| "batters in against our bowlers", by threat | survives as counts, threat dropped | P9/S5 by type; this match's wheel P8 |
| the wagon wheel by shot | **survives** | P8, `shot_points.shot` |
| phase splits | **survives** | P7, `phases` |
| who's out and the XI | **survives** | P2, `readiness` |
| workload "risk %" | dropped; the word and the directive survive | P3, S11 |
| the five fixed intelligence cards | replaced by rules with evidence | §4.3 |
| "Physio restricted (max 8 overs)" with a reason | status survives, reason never | P2, P6 |
| the field map, the tactics console, "broadcast tactics" | dropped | field settings are not data; "broadcast" is a message to children (138 §5) |
| the win-probability dial, pressure gauge, pitch rating | dropped | §5 |

---

## 8 · Phasing and tiers

| phase | ships | migration | who | proof |
|---|---|---|---|---|
| **A · Over what exists** | the Coach tab (P1–P9 less S2c and the guideline line), the Dashboard card, the drawer with S1, S2a, S2b, S3, S4a, S4b, S5–S12; `lib/signals.js` pure; dismiss per device | **none** | **Sonnet** builds; **Opus reviews** every screen (minors' data on screen, as 138 phase A was) | §9 A-walks; `apps/web/test/signals.test.mjs`; `smoke-a11y` over the new surfaces; `separation.test.mjs` unchanged |
| **B · The three small Opus items** | `bowler_day(p_date, p_team)` read under `player.workload.read` (S2c); `signal_ack` (person, signal key, evidence hash, acked_at; read and written by its owner only, no capability) and the `signal_acks` read; the `effective_limits()` figure on P6 when 110 phase 3 lands, basis withheld | one (`signal_ack`); the read is a function in the same file | **Opus** | a `db/99` section: `bowler_day` returns a boy's row to his side's coach and nothing to a scorer, a pupil, a team manager; sums across two matches on one date; `signal_ack` rows are the writer's and nobody else's |
| **C · Server-side signals, if the drawer gets slow** | `coach_signals(p_match)`: the twelve rules in SQL, one logged call instead of nine reads | one | **Opus** | the function's rows equal the client's for the seed's fixture; the one `access_log` row per open names the level-2 reads it folded |

Phase A is the whole product for the pilot. Nothing in B or C changes a panel shipped in A; each fills a line that was drawn empty and labelled.

---

## 9 · Proofs

Named here; written at build. `db/99` sections and `tools/` walks are numbered by the lead.

**db/99 assertions (phase B only; phase A adds no SQL)**
- `bowler_day`: the coach of K Naidoo's side reads his overs on a date across two matches; the same date read as `scorer` of one of them returns no row; as `teammanager`, none; as `player` on the side, none; as `medical` at the school, his row.
- `signal_ack`: a row written by one coach is invisible to the assistant on the same side and to the office; a `support_access` session reads none.
- The existing gates the cockpit leans on, re-asserted in the same section so the proof is in one place: a `teammanager` reads `readiness.clinically_restricted` and no `injury_type`; a `scorer` reads `bowling_spells` — **and the lead decides whether `age_band` should come back to him** (§3.6 note i).

**API walks (`tools/smoke-cockpit.mjs`)**
- Signed in as each persona in §1.2's table, every read the tab makes is called; the rows that come back are exactly the table's "yes" cells: a team manager's `workload?teamCode` is empty, an assistant's `readiness` has rows, a scorer's `opposition_context` is empty, an analyst's `trips` is empty.
- `matchups?batterId=` for a Hilton boy returns rows whose `bowler_id` the reader may read and none naming a Kearsney boy; `matchup_coverage` reports the rest as unattributable.
- `opposition_squad` inside the window writes an `access_log` row against Kearsney naming the reader; the day after the first ball it returns none.
- `lift_expected()` as the coach writes its access-log row; `lift_exceptions()` as the coach returns none; as the office, rows.

**Browser walks (`tools/smoke-browser-cockpit.mjs`)**
- As the seed's coach: the Coach tab appears for Saturday's fixture; P2 shows "restricted · back 14 Oct" for the restricted boy and **no injury word**; P2 shows "unavailable" and **no reason**; P3 shows the word and the fixed sentence and **no number for the ratio**; P6's sentence for J Smith equals the pad's and the Captain tab's for the same bowler; the drawer shows S1 when the seed's vehicle is swapped to one with fewer seats and clears when it is swapped back; dismissing S7 hides it and a new declaration brings it back.
- As the seed's team manager: the tab appears; P3 and P4 are not drawn; the drawer has S1, S3, S6–S10 and no S11.
- As the seed's scorer, pupil, guardian: no tab, no card, no drawer, and nothing suggests one is missing.
- Grep the rendered tab for the never-words: no `injury_type` value, no `reason_kind` value, no "risk", no "%" beside a name, no phone number.
- `smoke-a11y`: 12 px floor, 44 px targets, the drawer reachable by keyboard, every card a landmark with its evidence as text.

**Unit (`apps/web/test/signals.test.mjs`)**
- Each rule in §4.3 against hand-built rows: fires at its threshold, not one short; S1's arithmetic with and without the lifts count; S5's thirty-ball floor; S2a's three sentences are `capWords()`'s and no fourth is invented; the dismiss key changes when the evidence changes; no rule reads `reason_kind`, `note`, `injury_type`, `severity`, `phase`, `acwr`, `ewma_ratio` or `open_flag` (a static check over the module, like `NEVER_ON_THE_TAB` in `lib/captain.js`).

---

## 10 · Decisions for Kameel

| # | decision | recommendation | why, in one line |
|---|---|---|---|
| **D1** | Who gets the cockpit | **anyone whose single school- or team-scoped assignment on the side grants `team.select` or `player.workload.read`; panels check their own capability** | ADR 0003: by capability, never by title; the physio and the S&C coach get the load panels because they hold the read |
| **D2** | Where it lives | **a Coach tab in the Match Centre, a card on the Dashboard, the feed as a drawer** | the Captain tab's shape, already built; no fifth destination |
| **D3** | The scorer | **no cockpit** | the pad is his screen; he may be a pupil of either school |
| **D4** | Health on the cockpit | **status tier only (restricted, back on a date); the nature stays on the Injuries screen; no reason for an absence** | ADR 0002 allows the nature; a phone in a pavilion is not the Injuries screen, and status is what picking a side needs |
| **D5** | Wellness on the cockpit | **nothing: no flag dot, no check-in, not on the sheet** | 110 §3.3: a flag never touches selection; the notice is the channel (S12) |
| **D6** | A boy's guideline (110 phase 3) on P6 | **the effective figure as a figure; its basis never on this panel** | the number is what the coach acts on; "returning from injury" is the profile's |
| **D7** | Load word on the cockpit and S11 | **yes, with 110's fixed sentence, "estimate" where a band is inside, never a ratio number** | the coach already holds it; Friday is when the conversation happens |
| **D8** | Opposition wheels | **this match's balls, both sides; a career wheel for our own boys only** | the scorecard is one grain finer; a season of another school's child is the dossier's, inside its window |
| **D9** | The opposition window | **five days, unchanged; closes at the first ball** | db/46 decided it; nothing here needs more |
| **D10** | Lift exceptions | **the coach gets S4a (head count, "not left", "with us"); exceptions by name stay the office's (S4b)** | `transport.lift.receive` v `transport.lift.oversee`, as db/76 drew them |
| **D11** | Push | **the feed pushes nothing; no quiet hours; no signal reaches a parent or a pupil** | signals are derived at read time; what must reach a phone already goes as a notice with a pointer payload |
| **D12** | Phase A evaluates in the browser | **yes, pure and tested; a server function only if the drawer gets slow (phase C)** | nothing new to gate; the reads are the ones the tab already made |
| **D13** | What dismissing means | **"I have seen this", per person, per evidence; never a change to a row or a notice** | a signal still true is still true; one coach's dismiss is not another's |
| **D14** | The matchup floor | **thirty balls against a type** | the dossier's own floor for a strike rate; one floor across the product |
| **D15** | The lead's three findings in §3.6 | **the lead decides; this design does not depend on them** | a gate that looks wide is the lead's call, not a screen's |
| **D16** | S2c needs a read | **phase B, `bowler_day` under `player.workload.read`** | the day limit across two matches is real and nothing reads it today |

## 11 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | the §1.2 table can be derived from `ROLE_CAPABILITIES` at build time (a test holds the table equal to the bundles) | the screen types it and `rbac.test` holds it instead |
| **A2** | `readiness?matchId` is readable by every `availability.read` holder on the side and already withholds the nature tier (its own header says so) | P2 draws from `availability` + `injuries` separately with the same columns |
| **A3** | `lift_expected()` is reachable through an existing `lift-api.mjs` route for the fixture (line 281) | a `lift_expected` read is added in phase B, same gate |
| **A4** | nothing in phase A writes a `notification` row | if a stored signal is ever wanted, it is a phase-C `notification` under the existing policy, never a new channel |
| **A5** | `MatchView` can take a `staff` prop beside `captain` and splice a tab the same way | the tab is a new route; nothing else changes |
| **A6** | 133's `RateTrack` and `/par` reach a signed-in reader of an unpublished fixture (138 A4) | the second line is the chase line as built |
| **A7** | the frozen conditions document is readable by a `fixture.read` holder through `GET /api/matches/:id/playing-conditions` (the pad and the captain's tab read it) | S10 and P1's cap line wait for a read |
| **A8** | `weather?matchId` carries words a card can quote | S9 is not drawn |
| **A9** | the seed has a vehicle, a trip and two lifts for Saturday's fixture, or the walk makes them inside its run | the walk seeds them |
| **A10** | `match_duties` is the readiness read `ReadinessOverview` fans out, one per fixture | S8 reads `officials` alone |

## Appendix A · Existing things this design relies on, by name

| thing | where | used for |
|---|---|---|
| `ROLE_CAPABILITIES`, `TEAM_SCOPED_ROLES`, `SUBJECT_SCOPED_ROLES`, `boundaries()` | `packages/policy/src/roles.mjs` | §1.2; "who to ask" |
| `CAPABILITIES`, `LEVEL`, `SENSITIVE` | `packages/policy/src/capabilities.mjs` | the gate column of every table |
| `injury`, `match_availability`, `match_squad`, `trip`, `match_pitch_report`, `notification` entries | `packages/policy/src/tables.mjs` 352, 980, 430, 932, 893, 689 | the gates named in §3 |
| `readiness`, `availability`, `availability_history`, `injuries`, `workload`, `load`, `bowling_spells`, `bowling_breaches`, `bowling_directives`, `rulebook_clauses`, `phases`, `shot_points`, `player_shot_points`, `shot_point_coverage`, `matchups`, `matchup_coverage`, `match_squad`, `opposition_context`, `opposition_squad`, `trips`, `weather`, `pitch_report`, `officials`, `match_duties`, `notifications`, `matches` | `services/api/read/read-api.mjs` | every panel and rule |
| `RESTRICTED_FIELDS`, `SUBJECT_ID` | `read-api.mjs` ~2829 | which reads are already logged |
| `workload()` (re-emitted) | `db/60_workload_consent_count.sql` 1073 | P3, S11: `overs_7d`, `load_word`, `estimated_7d`, `monitored` |
| `bowling_directive_for()`, `bowler_over`, `bowler_spell`, `bowling_breach_read`, `bowling_breach_watch()` | `db/08_schema_programme.sql` 5192, 5217, 5239, 5279, 5284 | P6, S2b, S12 |
| `opposition_window_days()`, `opposition_context()`, `opposition_squad()` | `db/08` 4415, 4493, 4539; `db/46` | P4, §3.5 |
| `lift_expected()`, `lift_exceptions()`, `lift_receive()` | `db/76_lift_day.sql` 871, 946; `services/api/write/lift-api.mjs` 281, 292 | P1, S4a, S4b |
| `trip`, `vehicle.capacity`, the seats trigger | `db/08` 2764, 2785, 2844 | S1 |
| `notification` (`required_capability`, `subject_person_id`), `fanOut()`, `SUBJECT_KINDS` | `db/08` 220–288; `services/api/notify/push-api.mjs` 38 | S12; §4.5 |
| `match_conditions.doc`, `GET /api/matches/:id/playing-conditions` | `db/61`; `services/api/server.mjs` 720 | P1, S2a, S10 |
| `bowlerInningsCap()`, `capWords()`, `bowlerCapWords()`, `termsOf()` | `packages/scoring/src/conditions.mjs` 218, 255; `apps/web/src/scorer/conditionsLine.jsx`; `apps/web/src/lib/captain.js` 267 | P6, S2a |
| `deriveMatch()`, `deriveMatchPhases`, `composePhases` | `packages/scoring`; `read-api.mjs` 744 | P5, P7 |
| `Board`, `boardFromInnings()`, `atThisRate()`, `chaseLine()`, `RateTrack`, the over strip, `ShotWheel`, `WagonAnalysisPanel` | `apps/web/src/ui/`, `scorer/boardData.js`, `scorer/charts.jsx`, `scorer/wagonAnalysisPanel.jsx`; 133 §3, §6 | P5, P7, P8 |
| `signals.js` `pressure` | `apps/web/src/scorer/signals.js` 39–46 | the figure that stays off (§5) |
| `MatchView`, `CAPTAIN_TAB`, `CaptainTab` | `apps/web/src/views/matchcentre/MatchView.jsx` 191, 400; `captainTab.jsx` | the tab's shape (A5) |
| `AvailabilityPanel`, `holdsCapability()` | `apps/web/src/views/availability.jsx`; `apps/web/src/rbac/index.js` | per-panel gating pattern |
| `OppositionDossier`, `REASON`, `EVIDENCE` | `apps/web/src/views/dossier.jsx` | P4 reused whole |
| `ReadinessOverview`, `useDutyCoverage`, `SLOTS` | `apps/web/src/views/ReadinessOverview.jsx`, `duties.jsx` | S8 |
| `DriverDayView` | `apps/web/src/views/DayOfView.jsx` | the capability-not-role gating pattern it documents |
| `smoke-matchups.mjs` (header), `smoke-opposition.mjs`, `smoke-readiness.mjs`, `smoke-lifts.mjs`, `smoke-browser-pupil.mjs`, `smoke-a11y.mjs` | `tools/` | the walks §9 extends |
| `lib/captain.js` `NEVER_ON_THE_TAB` | `apps/web/src/lib/captain.js` 255 | the static never-list pattern `lib/signals.js` copies |
| ADR 0001, 0002, 0003; 110 §2.2, §3.3, §4.2, §6.1; 133 §2–3, D4, D10; 138 D4, D7–D10; SAFEGUARDING_DSO §1, §4.4, K3; 124 §2, §5.1, db/76 as built | `docs/` | the rules this design does not reopen |
