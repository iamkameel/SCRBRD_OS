# GA-I24 / I25 — Compare and combine: two players side by side, and the analyst's workspace

**Status:** Design (Fable, 2026-10-08), for Kameel's review; nothing here is built.
**Source:** the Phase C survey (I24, I25 rows and "Cross-cutting flags"); `docs/policy/PUBLIC_DATA.md`; `docs/design/SCRBRD-083_public_pages.md`; `docs/design/SCRBRD-138_captains_view.md` (D8, §4); `docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md` (§3.5, §3.7, §4.4); `docs/design/STEP4_parent_pupil.md` (§0 decision 1, §3); `docs/design/ACCOUNT_LIFECYCLE.md` (§3, §4); `docs/design/GA-I36_corrections_everywhere.md` (§0); `packages/policy/src/roles.mjs` (the `analyst` bundle at 414–421, `scout` at 491, `player` at 330, `guardian` at 391, `coach` at 250, `READ_TEAM` at 60); `services/api/read/read-api.mjs` (`career` 2304, `career_by_season` 2395, `matchups` 2095, `matchup_coverage` 2166, `derby_record` 2201, `opposition_context` / `opposition_squad` 1930, `RESTRICTED_FIELDS` 2951–2996, the CSV export 3197); `db/08_schema_programme.sql` (`evidence_label()` 4478, `opposition_context()` 4493, `opposition_squad()` 4539).
**Reader:** Kameel on a phone first; then the Opus lead; then whoever builds a slice. Names in the sketches are the seed's (Hilton, Kearsney, D Erasmus, R Pillay, K Naidoo), never a real child's.

---

## 0 · In one page

Two gap items ask for the same thing from two ends. **I25** wants two players' figures side by side. **I24** wants the analyst's screen to put several things next to each other: our batters, our matchups, the derby record, the other school's squad. Both are *combining* reads that already exist, and the whole question is what combining shows that the parts do not.

The answer in one sentence: **a comparison or a workspace may put side by side only what the reader may already open on its own, under the same capability, on the same day; it stores nothing, exports nothing, invents no figure, names no winner, and never puts a child of another school into a standing file.**

Nothing widens. The `analyst` bundle stays as it is. No new read is needed for the first two slices; every column comes from `career`, `career_by_season`, `matchups`, `matchup_coverage`, `derby_record`, `opposition_context` and `opposition_squad`, each of which already applies the reader's own scope. Skills and ratings stay out (they are RESTRICTED and logged, and they are a coach's judgement, not a record). The public pages get nothing: a comparison is the cross-match linkage of two children that per-match pseudonyms exist to prevent (083 §1.2, A3, A4).

Three things are decided that the reads alone would allow and this design refuses: a pupil comparing two team-mates with each other (he may compare himself with one); a parent comparing two of her own children (one child at a time stands, STEP4); and a head-to-head of our batter against a *named* bowler of another school (types only, 138 D8). Two things are decided that nobody asked for but combining makes necessary: the workspace never draws a "matches missed" or "did not play" figure (an absence is a health or discipline fact by another name, N2/N3), and opposition rows are never kept past the screen, in any store, on any device.

---

## 1 · The problem

A coach picking between two openers, an analyst preparing for Kearsney, a boy wondering how he stands against his mate: each wants two or more sets of figures on one screen. Today they open two profiles in two tabs. Putting them on one screen is cheap. What is not cheap is getting wrong who may do it, because side by side is where small samples become verdicts about a child, where a figure about a boy the reader may not read can be worked out by subtraction, and where a window that was meant to close (the five-day dossier) quietly stays open in a saved screen.

beta-2 had a comparison and an analyst view. The plan allows their *pattern* (two columns, the same rows) and nothing of their formulas (indices, ratings, "impact"). This design takes the pattern and names, for each role, which two players, which combinations, with what floor, what logging and what never.

---

## 2 · Decisions

**D1. A comparison is two reads, not a new read.** The screen asks the API for each player's figures exactly as the Profiles screen does (`career`, `career_by_season`, `matchups` by type, `matchup_coverage`), and places them in two columns. The server never joins two players; nothing is computed on the server that is not computed for one player today. Consequence: the rule for *who may compare whom* is "whoever may open both on their own", and no capability moves.

**D2. The same capability on both sides, the same day.** Both columns must be readable under `player.performance.read` within the reader's current assignments, or (for the one exception, D6) both under the fixture's open opposition window. A column the reader cannot fill is not offered: the picker lists only players whose figures the reader can open today, so there is never a half-empty comparison and never a hint that a hidden player exists.

**D3. No verdict, no rank, no colour, no invented figure.** The two columns carry the figures the reads return and the derived rates the API already computes (average, strike rate, economy). No "better by 12 %", no arrow, no green and red, no composite score, no radar, no "impact". The design direction's rule for the captain's season table applies: figures in the figure face, tabular, a word beside every symbol. A comparison is read, not scored.

**D4. The evidence floor applies to a comparison.** A profile is a record; a comparison is a judgement. So the compare screen uses the dossier's rule (`evidence_label()`, db/08 4478): counts always; a rate (average, SR, economy, dot %) only at thirty legal balls or more, otherwise an em dash and the word "insufficient". Below the floor the screen says "not enough balls to compare" rather than showing two numbers that mean nothing. The five words (none, insufficient, low, moderate, high) are the dossier's, so a coach reads one scale everywhere.

**D5. Skills, ratings, notes, workload, health, availability, age, discipline: never in a comparison or a workspace.** Skills (`skills.score`) and ratings are RESTRICTED and logged (read-api.mjs 2951–2996) and are a named coach's judgement of a named child (N5). The analyst holds none of them anyway. A coach, who does hold `player.development.read`, reads them on the Skills screen on purpose; a side-by-side of two boys' ratings is a selection verdict written by the app, and it is refused here. If Kameel ever wants it, it is its own design.

**D6. Another school's child appears in a comparison only inside the dossier's window, with the dossier's columns, logged, and never kept.** Inside the five days (db/46; 136 §3.5, D9) a coach or analyst with `opposition.read` at his side of the fixture may place one of our boys beside one of theirs. Their column is `opposition_squad()`'s columns and nothing else (full name, playing role, styles, the batting and bowling aggregates with the thirty-ball floor already in them). Each open is a read of `opposition_squad` and is logged against the other school with every boy's id, as today. The two halves state their scope separately, because they differ: ours is over the matches this reader may see (RLS), theirs is over their whole log (SECURITY DEFINER, the grant as decided). At the first ball the window closes and the column is gone; there is no way to keep it.

**D7. Our batter against their *named* bowler is not offered.** The matchups read already drops a row naming a player the reader may not read (138 D8, A2; `smoke-matchups.mjs`). This design keeps it so and does not propose a read. The balls of our own fixtures against them are on our scorecard already; a read across fixtures we did not play would be a standing file on another school's child, built from samples the floor would hide anyway. Types only: "against left-arm spin", as 136 P9 and 138 C5 have it.

**D8. The workspace never draws an absence.** No "matches missed", "appearances v fixtures", "did not play", "games since last appearance", no gap in a season strip marked as a gap. Each is "why a boy is not playing" (N2) or a conduct matter (N3) by subtraction. The workspace shows what a boy played, never what he did not. The same rule bars a "form dip" diagnosis or any wording that reaches for a reason.

**D9. Nothing is stored, shared, exported or posted.** A comparison and a workspace are reads drawn on a screen. No saved comparison, no "pin this", no CSV, no share card, no post to the side, no screenshot action. The generic CSV export (read-api.mjs 3197) must not serve `opposition_squad` or `opposition_context` (A1 asks Opus to confirm it does not today and to refuse it if it does). Opposition rows are never written to `localStorage`, IndexedDB, the service-worker cache or any client store; the screen re-reads on every open.

**D10. A pupil compares himself with one team-mate, never two team-mates with each other.** `player` holds `player.performance.read` across his side, so he may already open a team-mate's figures (138 §3.1 relies on exactly this). What he is entitled to is his own development measured against the side; what he is not entitled to is a screen that ranks two other boys. The card is "Me v a team-mate", on his Passport, figures only, D3 and D4 applied. The captain's honour adds nothing here; his season table from 138 C2 stays as decided.

**D11. A parent does not compare.** Her `player.performance.read` names her own children and nobody else, so her child against a team-mate is not readable. Her two children against each other is readable and is refused: STEP4 decision 1 ("nothing is ever merged into one list"; two children at two schools kept apart) stands, and a younger brother measured against an older on a screen the school built is not a product. What she gets is her one child's seasons, which is I23's per-player bars, not this design.

**D12. The analyst's workspace is an arrangement, not a grant.** One screen with five panes, each a read the `analyst` bundle already holds: Our side (career and season), Matchups by type, Derby record, Opposition (window-gated), Competition. The bundle (team.read, fixture.read, news.read, player.profile.read, player.performance.read, analytics.read, competition.read, opposition.read) does not change. Every pane carries I22's source-scope-window-denominator line. What the panes may be joined on is in §5.

**D13. The compare screen lives on Analytics, under `analytics.read`.** Coach, analyst, director of sport, principal and the office hold it; the assistant coach and the team manager do not (they are not offered the Analytics screen today either). The pupil's card is the one place a comparison is drawn outside Analytics. Q3 asks whether the assistant coach should have it.

**D14. Corrections flow by construction, and the screen says when it last read.** Every input is a fold over `ball_event_live` or `ball_event_career` (GA-I36 §0): a void or an approved amendment changes `career`, `career_by_season`, `matchups` and `opposition_squad` on the next read, and there is no stored comparison to refresh. The screen shows "as at {time}" from the read and re-reads on open and on pull-to-refresh; when I36's current-or-stale marker lands it is drawn here as everywhere.

---

## 3 · Who sees what

"Own" means a player whose figures the reader may open today under `player.performance.read` in a current assignment. "Theirs" means a child of the other school in a head-to-head fixture, inside the five-day window, under `opposition.read` at the reader's side.

| reader | may compare | may combine (workspace) | logged | never |
|---|---|---|---|---|
| **Pupil** (`player` + `selfaccess`) | Himself v one team-mate on his current side (D10). Cricket figures, the floor, no verdict | Nothing beyond the card; no workspace | No new log (`career` is unlogged by decision) | Two team-mates against each other; any boy of another school; any team-mate's skills, ratings, load, health, availability, age |
| **Parent** (`guardian`) | Nobody (D11) | — | — | Her child v a team-mate (not readable); her two children v each other (refused); anything of another family's child |
| **Coach** (`coach`, team-scoped) | Two boys on his side, or across his sides where he holds both assignments | The workspace's panes for his side(s) (he holds `analytics.read`, `opposition.read`) | The opposition pane, every open, against the other school, every boy's id (as today) | Their named bowler v our batter (D7); skills, ratings, notes side by side (D5); an absence figure (D8); a saved or exported comparison (D9) |
| **Assistant coach**, **team manager** | Not offered (D13, Q3) | — | — | As the coach, and no Analytics screen |
| **Captain** (a pupil with the honour) | As any pupil: himself v one team-mate | His 138 C2 season table of the side stays as decided; nothing more | — | As the pupil; the dossier, ever (138 D9) |
| **Analyst** (`analyst`, school-scoped unless narrowed) | Any two own players in scope | All five panes (D12), joined only as §5 allows | The opposition pane as above | Skills, ratings, notes, workload, health, availability, date of birth, age band, discipline (none in the bundle); an absence figure; their named bowler; anything kept past the screen |
| **Director of sport, principal, office** | As the analyst, school-wide | As the analyst | As above | As the analyst. Their wider bundles (recognition, workload, clearances) draw nothing here |
| **Scout** (`scout`) | Not offered (Q7) | — | `scouting_candidates()` as today | Any boy without a live scouting consent; any boy beyond name, team and career figures; a side-by-side the consent did not contemplate |
| **The other school's staff** | Our boys only through *their* dossier of *our* side, inside the window, logged against us | Their own workspace | Against our school, with our boys' ids, so a parent here can ask who read her son | Our boys' health, availability, age, notes, discipline, PII: no read exists and none is proposed (136 §3.5) |
| **Public** (signed out) | Nothing, ever | Nothing | — | A player page (A4), a leaderboard (A3), any figure for one child across matches, any comparison, on any page, overlay, graphic or ground display, whatever the consent |

Scorer, official, media, spectator, physio, fitness, DSO, finance, driver: no compare screen and no workspace. The screens are drawn only where the reason for reading figures is selection, coaching or analysis; a holder of `player.performance.read` for another reason (media, for a news post) reads profiles as today.

---

## 4 · What never surfaces

Restated so a builder can check a diff without re-reading the rule.

1. **No child of another school outside the window**, and inside it nothing beyond `opposition_squad()`'s named columns. No injury, absence, load, age, guardian, note, "their opener is out".
2. **No skill score, rating, coach's note, assessment history, saved goal** in a comparison or a workspace (D5). The components take the columns of `career`, `career_by_season`, `matchups`, `matchup_coverage`, `derby_record`, `opposition_*` and nothing else; a test pins the list (§9).
3. **No health, availability, workload, wellness, discipline, safeguarding, PII, date of birth, age band, fitness.** The analyst's reads mask `players.fitness` for him already; the workspace must also not draw `bowling_spells`' `age_band` or directive maxima until the 136 lead's fix lands (A2), and never afterwards.
4. **No absence** (D8). No count or strip of matches not played, no reason, no "unavailable".
5. **No invented figure** (D3). No index, probability, pressure, threat, composite, percentile, "better by".
6. **No rate under thirty balls** (D4).
7. **No winner, rank, colour, badge** (D3). Two columns, one scale, words.
8. **No store, export, share or post** (D9).
9. **Nothing on a public page, overlay, graphic or the ground display** (083 §1, §3.6, §5.3 "Leaderboards: never").
10. **No join of two `player` rows for one person** across schools (§7): Westville compares Westville's record of him; the Passport lines from Hilton are not a comparison input.

---

## 5 · What a workspace may join, and what joining reveals

The analyst's five panes, and the rule for each join. "Join" means drawing one pane's rows keyed to another's on the same screen.

| join | allowed? | why |
|---|---|---|
| Our batter's season figures beside his matchups by bowling type | **Yes** | both his own rows, both `player.performance.read`; the coverage line says how many balls were attributable (`matchup_coverage`) |
| Our side's figures beside the derby record against the fixture's opponent | **Yes** | the derby record is team-level over fixtures the reader may see; `undecided` is shown as the read returns it, never dropped |
| Our side beside the opposition squad, inside the window | **Yes**, D6 | logged; two scope lines; the floor on theirs is in the function, the floor on ours is the screen's (D4) |
| Our batter keyed to their named bowler | **No**, D7 | the read drops it; a new read would be a standing file |
| Opposition squad from fixture X (week 1) kept beside the squad from fixture Y (week 6), same school | **No**, D9 | the window is per fixture; keeping rows across windows re-assembles the standing file the window exists to prevent. Each is its own read, its own log row, its own screen |
| Opposition aggregates minus our own fixtures against them | Not drawn | the subtraction gives his figures in matches we did not see. Those are cricket figures and the grant is over his whole log by decision, so this is not a leak of a new kind; but the screen does not do the arithmetic, because "his figures against everyone but us" is a column nobody asked for and a precedent for subtraction panes |
| Team sheet (`match_squad`) beside the roster, or fixtures beside appearances | **No**, D8 | the difference is an absence |
| Anything beside `bowling_spells`' age band or maxima | **No** | `player.age.read` and `player.workload.read` are not the analyst's |
| Competition standings and results beside any of the above | **Yes** | team-level public facts (A1) |

**Re-identification.** Within one school the analyst reads every boy by name under his assignment, so there is nothing to re-identify. Across schools the risk is the standing file, closed by D6 and D9. On a public page nothing here appears, so pseudonyms are untouched.

**Small-sample inference.** Closed by D4 (the floor) and D3 (no verdict). A comparison of two boys over eleven balls each shows two counts and "insufficient", and says so in words.

**Leakage by subtraction.** The two real routes are absence (D8) and age (the `bowling_spells` fix, A2). A third, medical by exclusion ("he is on the roster, fit, and not picked"), needs availability and fitness, neither of which the workspace draws.

---

## 6 · Logging

- **Own-school comparisons:** no new log entry. `career` and `career_by_season` are RESTRICTED `[]` by decision (nothing about a child beyond the profile the same reader already opens), and two profile opens were never logged. Q9 asks whether Kameel wants a comparison logged anyway; the recommendation is no, because a log that records every glance drowns the ones that matter.
- **The opposition pane and column:** exactly today's rule. Every `opposition_squad` read writes to the other school's `access_log` with the reader, the fixture, the day and every boy's id. The workspace adds no second path and no cache that would skip the read.
- **The pupil's card:** no log; the same rows as his team-mate's scorecard line.
- **What a parent can ask:** "who has read my son's figures as an opposition player" is answered from `access_log` as today, naming the reader's school, the fixture and the day.

---

## 7 · Consent, and eighteen

- **No new consent.** Cricket figures are the school's record of a match, processed under the guardian-link consent that governs processing at all (PUBLIC_DATA C1's "separate from the guardian-link consent"). Nothing here is published, so the public-name consent does not apply; nothing goes to a scout, so the scouting consent does not apply; nothing travels to another school, so the passport consent does not apply.
- **At eighteen:** no difference to any row of §3. A pupil's "Me v a team-mate" card is the same at seventeen and eighteen (138 §6's reasoning). A parent's sight ends when her link ends (§8).
- **The never-public mark (C5)** is a public-page mark and changes nothing signed-in (083 §7, first row).

---

## 8 · When a child leaves, or a link ends

| event | the comparison | the workspace |
|---|---|---|
| **A pupil leaves the school** (`player_leave`, ACCOUNT_LIFECYCLE §3) | He is not offered in any picker from the day his side ends (D2: "readable today"). His scorecards, season rows and the derby record stay exactly as scored (lifecycle D8); a coach who opens an old season table still sees his line there, as the lifecycle's §3.6 allows for past team sheets. **Q6** asks whether a departed boy may still be picked for a *new* comparison by the office or analyst; the recommendation is no | His rows stay in the season panes for the seasons he played; he is in no picker |
| **He transfers to another SCRBRD school** (lifecycle D9) | Two `player` rows, never joined (§4 item 10). Westville compares its own record of him; Hilton's is Hilton's | The same |
| **His parent's link ends** (lifecycle §4) | She had no comparison (D11); her child's seasons leave her app on the next statement with everything else | — |
| **A coach's assignment ends** (SCRBRD-132) | His pickers empty on the next statement; nothing was stored (D9) | The same |
| **A pupil's account is disabled** | His card is gone with his app; nobody else's view changes | — |
| **The opposition window closes** (first ball) | Their column disappears; a comparison open on a phone shows "window closed" on the next read | The pane shows the scorecard and the log as every signed-in reader has it (136 §3.5) |

---

## 9 · Corrections

GA-I36 §0 is the whole answer: there is no stored score. A `void` or an approved amendment refolds `ball_event_live`, and every input here is a view or a read over it (`career`, `career_by_season`, `matchups` and `matchup_coverage` over `ball_event_career`; `opposition_squad()` over `ball_event_live`; `derby_record` over `match_live_score`). A comparison is never stored (D9), so there is nothing to invalidate; the next open shows the corrected figures.

What the screen owes the reader is to say *when*: "as at 14:32" from the read's time, re-read on open and on pull-to-refresh, and, once I36's marker exists, "updated since you opened this" drawn as I36 draws it everywhere. A comparison that changed because a ball was corrected looks like any other re-read; no banner about the child, no reason.

The one thing a correction must not do is reach into a log: an `access_log` row written for an opposition read stays as written. A corrected figure is a new read if the reader opens it again, and a new log row.

---

## 10 · The reads it needs

| part | served by | exists? | notes |
|---|---|---|---|
| Two own players' career figures | `career` (read-api.mjs 2304), filtered client-side to the two ids as Profiles does | yes | RLS-scoped; `matches` returned so the scope line can say the denominator |
| Season by season for each | `career_by_season` (2395), `?season=` | yes | the grain the pupil's card and the by-season rows use |
| Matchups by bowling type, per batter | `matchups?batterId=` (2095), aggregated by `bowling_style` on the client | yes | rows naming an unreadable player are dropped by RLS (138 A2) |
| "How much of the log this speaks for" | `matchup_coverage?batterId=` (2166) | yes | the I22 line |
| Shot points per batter (optional pane) | `player_shot_points` (251) | yes | reads `ball_event_career`; team-level only on public pages (L7), signed-in here |
| Derby record | `derby_record` (2201) | yes | team-level; `undecided` shown |
| Opposition header and window | `opposition_context?matchId=` (1930) | yes | `open`, `reason`, counts only when open |
| Opposition squad | `opposition_squad?matchId=` (1934) | yes | logged; floor in the function |
| Competition | `league` (663) and the competition reads | yes | team-level |
| The evidence words for our own rates | `evidence_label()` (db/08 4478) | yes, in SQL | the client reuses the same five thresholds; a tiny shared constant in `packages/scoring` or `lib/` so the words match. **Not a new read** |
| A per-match line per player for the pupil's card | the fold per match, or STEP4 G7's `player_match_lines` if that read is ever added | not needed for slice 1 | — |
| Our batter v their named bowler | **none, by decision (D7)** | — | if Kameel ever wants it: a new SECURITY DEFINER read, Opus, its own design |
| A saved comparison | **none, by decision (D9)** | — | — |

**No migration. No new read. No policy change.** The two Opus items are checks: that the generic CSV export cannot serve `opposition_*` (A1), and that the `bowling_spells` age-band fix from 136 has landed before the workspace draws spells (A2).

---

## 11 · Build slices, in order

| slice | ships | tier | closes |
|---|---|---|---|
| **S1 · Compare on Analytics** | A Compare sub-view: two pickers (own players the reader can open), two columns of `career` and `career_by_season`, matchups by type with the coverage line, the floor (D4), the evidence words, I22's scope line, "as at". No colour, no verdict, no export | **Sonnet** builds; **Opus reviews** (minors' figures on screen; the column list pinned by test) | I25 for staff |
| **S2 · The pupil's card** | "Me v a team-mate" on the Passport: one picker (his side), the same two columns, the floor, no verdict. The captain's screens unchanged | **Sonnet**; **Opus reviews** (a child's screen about another child) | I25 for pupils, if Q1 is yes |
| **S3 · The analyst workspace** | One screen, five panes over the reads in §10, the joins of §5 and no others; the opposition pane window-gated by `opposition_context`, re-read on every open, never stored; no absence figure; no spells pane until A2 | **Opus** writes the two checks (A1, A2) and the never-list test; **Sonnet** builds the panes; **Opus reviews** | I24 |
| **S4 · Opposition column in Compare** | Inside the window, one of theirs beside one of ours, two scope lines, logged | **Sonnet** over S1 and S3; **Opus reviews** the log path | the cross-school part of I25, if Q4 is yes |
| **S5 · Proofs** | `packages/policy` test: the compare and workspace components accept only the named columns and no RESTRICTED one (`skills.score`, `ratings.*`, `notes.body`, `players.fitness`, `born`, `age_band`); `apps/web/test`: the floor hides a rate at 29 balls and shows it at 30, no absence column exists, nothing is written to any client store on the opposition pane; a walk: the analyst persona opens the workspace, the dossier reads nothing before the window and rows inside it, `access_log` gains one row per open against the other school, a departed boy is in no picker, a voided ball changes the comparison on reload; `smoke-a11y` over the new surfaces, 12 px and 44 px floors | **Opus** | the evidence for I24/I25 |

S1 and S2 need no Opus build time beyond review. S3 is the large one the survey flagged, and it is large in screens, not in policy.

---

## 12 · Where it lives, and the phone

- Compare is a sub-view of Analytics (`AnalyticsView.jsx`, beside HeadToHead and Matchups), two columns at 390 wide with the row labels between them, the pickers as two chips at the top. The pupil's card is on his Passport below his own figures, one picker, no new bar item.
- The workspace is the Analytics screen for the analyst persona with the five panes stacked on a phone, side by side on a laptop; each pane's scope line is its first row.
- Floors stand: 12 px, 44 px, `prefers-reduced-motion` honoured; no colour alone; the figure face tabular. No new runtime dependency.

---

## 13 · Open questions for Kameel

| # | question | recommendation |
|---|---|---|
| **Q1** | May a pupil compare at all? | **Yes, himself against one team-mate** (D10), figures only, the floor, no verdict. Never two team-mates against each other. If this feels like too much for a fourteen-year-old, the card is one component to not draw; nothing else changes |
| **Q2** | May a parent compare her two children? | **No** (D11). One child at a time stands. Her child's seasons come with I23 |
| **Q3** | Should the assistant coach (and the team manager) get Compare? | **Not now.** It lives on Analytics under `analytics.read`, which they do not hold, and they are not offered that screen today. If coaches ask, it is one line in `roles.mjs` (Opus) and a separation test |
| **Q4** | May an opposition child be one column of a comparison inside the window? | **Yes** (D6): the dossier's columns, the floor, logged, two scope lines, gone at the first ball, never kept |
| **Q5** | Our batter against their *named* bowler? | **No** (D7). Types only. The balls of our own fixtures are on our scorecard; a cross-fixture read is a standing file |
| **Q6** | A boy who has left the school: may the analyst or office pick him for a new comparison? | **No.** He stays on every past table and scorecard; he is in no picker. The selection question he would answer no longer exists |
| **Q7** | A compare screen for scouts over consented candidates? | **No.** The candidates list carries the figures; a side-by-side is a shortlist the consent did not describe. Revisit with the scouting consent wording if asked |
| **Q8** | The thirty-ball floor on our *own* boys' rates in a comparison, when the profile shows them regardless? | **Yes, the floor** (D4). A profile is a record; a comparison is a judgement. The count is always shown, so nothing is hidden, only not divided |
| **Q9** | Log own-school comparisons? | **No** (§6). `career` is unlogged by decision; the opposition half is logged as today |
| **Q10** | Any way to keep or share a comparison (a pin, a CSV, a post to the side)? | **No** (D9). Nothing leaves the screen. A coach tells the side what he wants in the plan to the side, in words |

---

## 14 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | The generic CSV export (read-api.mjs 3197–3250) does not serve `opposition_squad` or `opposition_context`, or can be made to refuse them in one line | Opus adds the refusal before S3; the workspace ships without the opposition pane until it does |
| **A2** | The 136 lead's fix (`bowling_spells` returns `age_band` and maxima only under `player.workload.read`) lands before S3 | S3 draws no spells pane; the analyst's workspace has no row that reads `bowling_spells` |
| **A3** | `analyst` assignments are school-scoped unless the office narrows them to a team (`TEAM_SCOPED_ROLES` names coach, assistant, team manager only) | The pickers follow whatever scope RLS gives; nothing in this design depends on the breadth |
| **A4** | `career` with no `playerId` returns every player the reader may see, and the client filters to two, as Profiles does today | A `?playerId=` on `career` is a small read change, Opus, no migration |
| **A5** | `player.performance.read` for `player` is team-scoped to his current side (138 §3.1 relies on it) | The pupil's card is not drawn; Q1 is moot |
| **A6** | The I22 scope line ships before or with S1, so every pane and column can say its source, window and denominator | S1 draws its own line in the same shape, to be replaced by the shared one |
