# StatsMagic — the guided Analytics Explorer (G16, CRI-3.4)

**Status:** Design (Fable, 2026-10-28). **Decided 29 Oct 2026 (Kameel, on the Build Board): Q1–Q10 as recommended** (§9). Nothing here is built. Allowed by `docs/design/CRICINFO_GAP_PLAN.md` CRI-3.4 (23 Oct); named StatsMagic by Kameel on 28 Oct (plan §9 decision 7).
**Sits inside:** `docs/design/GA-I24-I25_compare_and_combine.md` (the governing design for combining children's figures; every decision there stands, and §2.4 below names the one place this design extends it), `docs/design/READERS_child_data.md` (the reader map, §7 decisions of 21 and 28 Oct), `docs/policy/PUBLIC_DATA.md`.
**Source read:** the plan (G16, CRI-3.4, decision 7); the two Cricinfo audits' Statsguru parts (`audit/ESPNCRICINFO_FULL_UX_AUDIT_2026-10-23.md` §4.5–4.6, UX-11, UX-17, §10–11; `audit/ESPNCRICINFO_LESSONS_AUDIT_2026-10-23.md`); `services/api/ai/ai-service.mjs` (`contextFrom`, `statsMagicContext`, `askStatsMagic`, `maskNames`, `TOKEN_RULE`); `apps/web/src/shell/GlobalSearch.jsx` (the question box); `apps/web/src/lib/compare.js`, `views/compare.jsx`, `views/AnalyticsView.jsx`; `tools/smoke-statsmagic.mjs`.
**Reader:** Kameel on a phone first; then the Opus lead; then whoever builds a slice. Names in the sketches are the seed's (Hilton, Kearsney, D Erasmus, R Pillay, K Naidoo), never a real child's.

---

## 0 · In one page

Cricinfo's Statsguru is a form: pick a class, a team, an opposition, a ground, a season, a grouping, and get a table. The audits say copy the *power of composition*, not the form (§4.6, §10 item 3); the plan's §8 bars "dense Statsguru-style forms" and "professional leaderboards of children". SCRBRD already has the pieces: `career`, `career_by_season`, `matchups`, `matchup_coverage`, `derby_record`, `phases`, the compare screen's floor and column list, the source line, and a question box that sends a plain question to a model over the reader's own read path.

**StatsMagic is one thing with two doors.** The thing is a *question*: a subject, a measure, a grouping and some filters, answered by a fold over the ball log under the reader's own scope, with its basis beside every figure. The guided door is chips the reader taps. The AI door is a sentence the reader types, which the model turns into *the same chips*, which then run the same fold. The model never produces a figure. Every number on screen came from SQL under RLS, carries its denominator and its "as at", and can be opened to the deliveries it stands on.

**The scope rule is GA-I24's, unchanged:** StatsMagic may show the reader only what he may already open on his own, under the same capability, on the same day. It invents no figure, names no winner, draws no absence, keeps no row of another school's child, and puts nothing on a public page. It adds one thing GA-I24 refused for Compare and the plan now asks for: a **saved view**, which is a saved *question*, never a saved answer; it is personal, re-run under the owner's scope on every open, and it cannot hold an opposition query or a two-player comparison.

Four things decided that the reads alone would allow and this design refuses: a list of children ordered by a rate under the thirty-ball floor; any list of children for a reader outside the school's own staff (pupil, parent, spectator, scout, league, media get none); a question the model answers in prose with numbers of its own; and a StatsMagic question box on any public page.

---

## 1 · The problem

A coach asks "who has the best economy in the U15A this season?" and today types it into Global Search, which hands the model every boy's career line (masked) and lets it write a paragraph. That works for one question and fails for the next: the model's arithmetic is unchecked (`ai.test.mjs` proves the context, not the answer), the whole school's figures go to a provider for a question about one side, there is no table, no "how many balls is that on", no way to change one word of the question without retyping it, and nothing to come back to next week.

The explorer the audits want solves the last four. What it must not do is widen anything: an explorer is a sweep over many children at once, where small samples become verdicts, where "by opposition" can mean another school's child, and where a saved screen can outlive the assignment that made it.

---

## 2 · Decisions

### 2.1 What a question is

**D1. One grammar, two doors.** A StatsMagic *question* is a small record: `subject`, `measure`, `group`, `filters`, `order`, `limit`. The chips on the explorer screen *are* that record, one chip per field. The AI box produces the same record and nothing else (D13). The record is validated against a vocabulary built from the reader's own reads (the sides, seasons, oppositions, grounds and competitions he may see); a value not in his vocabulary is dropped and said in words. The grammar lives in one pure module (`apps/web/src/lib/statsmagic.js` for the client, mirrored by the server's validator) with a test that pins its fields, as `COMPARE_FIELDS` is pinned today.

**D2. Subjects.** *Me* (a pupil; his `selfaccess`); *a player* I may open (one id, from the Compare picker's rules: `pickable()`, `teamMates()`); *a side* (one of my team codes); *my sides*; *the school* (staff with school-wide `analytics.read`); *an opposition side* (team level only, ever); *a competition* (team level only). No subject is "every school" or "the platform". A subject the reader cannot open is not offered and, typed, is refused with "not in your scope", not with "no such player" (GA-I24 D2: no hint that a hidden boy exists).

**D3. Measures.** Batting: innings, runs, balls faced, dismissals, average, strike rate, fours, sixes, dot-ball %, boundary %, highest score. Bowling: balls bowled, runs conceded, wickets, economy, average, strike rate, dot %, maidens, best figures. Partnerships: runs and balls, by wicket. Team: totals, run rate, extras, wickets lost, result, margin; the derby record; phase runs and wickets (powerplay, middle, death, as `phases` folds them). Nothing else. Every rate carries the count it is divided over.

**D4. Groupings.** By season, by opposition (school and side), by ground (home or away, or the named ground), by format, by competition or fixture class (competitive, friendly, inter-house, when the fixture carries it), by phase, by batting position, by bowling type (pace or spin, `matchupTypes()`), by innings (first or second), by match. One grouping at a time; the table is one row per group. A second grouping is Q4.

**D5. Filters.** Season, format, competition or fixture class, side, opposition, ground or home/away, batting position (1–11, derived from the order of arrival in the innings fold), phase, date range, and the floor's own filter "at least N balls" (N is never below thirty for a rate, D7). No filter on age, date of birth, availability, fitness, selection, or anything in `NEVER_COMPARED`; the vocabulary does not contain them, so the model cannot pick them either.

**D6. Three answer forms, each with its basis.** *A figure*: one number, its unit, its denominator ("41.20, over 15 innings, 206 balls"), its scope, its window and its "as at", drawn as `SourceLine` draws every chart today. *A table*: one row per group, counts always, rates under the floor as an em dash and the evidence word, the source line as the first row. *A list*: rows are players (own school only, D9), ordered by a count or, at or above the floor, by a rate; no rank number, no "best", no colour, no arrow (GA-I24 D3). Every form has a "view deliveries" route that opens the commentary filtered to the event ids the figure stands on (CRI-2.3's drill-down; the audit's "auditable insight", §11), inside the reader's `fixture.read`.

**D7. The floor applies everywhere.** A rate is drawn only on thirty legal balls or more (GA-I24 D4, `COMPARE_FLOOR`, `evidence_label()`); below it, an em dash and the dossier's word. A list ordered by a rate holds only rows at or above the floor and says how many rows it left out, as counts ("4 bowlers under thirty balls are not ranked"), never by name. The audit's "36 balls" example becomes "at least 30"; the floor is the dossier's and there is one.

**D8. No absence, no verdict, no invented figure.** As GA-I24 D3 and D8: no "matches missed", no "did not play", no gap drawn as a gap (a season row exists only where the subject has figures in it); no index, probability, impact, percentile, "better by", form word, or reason. StatsMagic answers "what happened", never "why" or "how good".

### 2.2 Who may ask what

**D9. A list of children is a staff tool.** Only a reader holding `analytics.read` and `player.performance.read` in a scope (coach over his sides; analyst, director of sport, principal, office school-wide) gets the *list* form or a per-player row in a *table*. A pupil, a parent, a spectator, a scout, a media officer and a league account never see children listed side by side by StatsMagic, whatever their reads would allow one at a time. Reasoning: READERS lets a pupil open a team-mate's season figures one at a time (REACH-D2) and lets media open profiles school-wide; GA-I24 D10 still refuses a pupil a screen that ranks two team-mates. A list is that screen with eleven columns. The captain's season table (138 C2) is its own decided surface and is not drawn by StatsMagic.

**D10. The pupil asks about himself and about the side as a team.** Subjects: *me*, *my side*. Measures and groupings as D3–D4 over his own figures (by season, by opposition, by position, by phase, by bowling type) and his side's team-level figures. A question naming a team-mate ("how many runs has R Pillay got this term?") is answered as his profile read already answers it today, one boy, figures only, no list, no comparison; "Me v a team-mate" stays on Compare as decided (GA-I24 D10). Never: another school's child, an ordered list of team-mates, skills, load, health, availability, age.

**D11. The parent asks about her child and his side as a team.** One child at a time (STEP4 decision 1; GA-I24 D11): the switcher picks the child, and StatsMagic's vocabulary is rebuilt for him. Subjects: *my child*, *his side* (team level). Never a team-mate by name beyond what the scorecard says, never her two children in one answer, never a list. Her reads continue while he is at school after eighteen (READERS Q1).

**D12. Coach, analyst, director, principal, office: the full grammar over their scope.** The coach over his sides; the others school-wide. The assistant coach and team manager are not offered StatsMagic, as they are not offered Analytics or Compare (GA-I24 D13, Q3). Media: team-level subjects only (Q6). Physio, S&C, DSO, scorer, official, driver, finance: nothing; the reason for reading figures is not theirs.

**D13. The AI door is a translator and a narrator, never a calculator.** Three stages, one request: *parse* (the model sees the grammar, the reader's vocabulary with names masked, and the question, and returns a question record or "cannot"), *run* (the server validates the record against the vocabulary and runs the fold under the reader's session, as every read does), *say* (the model sees the result rows masked and writes one plain sentence that may contain only numbers present in the rows; the server checks every number in the sentence against the rows and drops the sentence if one is not there). The screen shows the chips the model chose, so the reader can change one and re-run without the model. A question the grammar cannot hold ("why isn't K Naidoo playing?", "who is the fittest?", "how old is their opener?") is refused in words: "StatsMagic answers from the ball log. It does not hold availability, health, age or coaching notes." The model is never given the whole school's career lines again; today's `statsMagicContext()` (which sends every boy's figures for every question) is retired once slice 3 lands (§8).

**D14. The opposition appears as a side, never as a boy, outside the window.** "By opposition" groups by school and side; "against Kearsney" filters by them. A question about one of their children ("how does their opener bat against spin?") is refused with "types only" outside the five-day window (GA-I24 D6, D7; db/46). Inside the window, with `opposition.read` at the reader's side of that fixture, the answer is `opposition_squad()`'s columns exactly, with the function's own floor, logged against the other school with every boy's id as today; StatsMagic adds no second read and no new column, and the answer carries two scope lines (ours over the matches I may see; theirs over their whole log). It cannot be saved (D17) and its rows are never written to any client store (GA-I24 D9).

**D15. A league account reads its own competitions, team level.** `competitionadmin`'s StatsMagic has subjects *a competition of mine* and *a side in it*; measures are team totals, results, margins, extras, run rates, standings; no per-child row, no list, no player subject. This is READERS R1 (28 Oct: a league account reads only its own competitions) applied to figures, and PUBLIC_DATA A3 (no leaderboard across a competition) applied signed-in to the one reader who could build one. A spectator, under REACH R-G, gets the same team-level grammar over the fixtures he may see, and nothing about a boy. A scout has no StatsMagic; `scouting_candidates()` is the whole of his read (GA-I24 Q7). The owner's key has no school scope and gets no StatsMagic; `superadmin` reads tables, not explorers.

**D16. Nothing of StatsMagic on a public page.** No question box, no chips, no answer, no link into it from a public page. The public page's team-level facts (results, standings, the live board) are the `public_*()` functions' and stay so. No child's name, no photograph: StatsMagic draws no avatar and no image anywhere, signed in or out (the Analytics screen's `Avatar` import is not used by it).

### 2.3 Saved views

**D17. A saved view is a saved question, never a saved answer.** Table `stats_magic_view`: owner (`app_user`), school, the question record (JSON, validated on write by the same validator as a run), a name the owner gives it, created and last-opened times. No result row, no figure, no player name in the stored record (ids only; the name is read at open). On open it runs again under the owner's assignments that day. A view whose subject the owner may no longer open (a boy who left, a side he no longer coaches, a child whose link ended) renders "no longer in your scope", with no figure and no name, and offers delete. Three things cannot be saved: any question whose subject or filter is an opposition child or `opposition_squad()` (D14); a two-player comparison (GA-I24 D9 stands for Compare); and any question a run has refused. A saved view is owner-only under RLS; it is never shared, posted, exported or linked (Q2); it is deleted with the owner's last assignment at that school (ACCOUNT_LIFECYCLE: a departure, a disabled account) and on the owner's request.

### 2.4 Where this extends GA-I24

Exactly one place: **D17 allows a stored question**, where GA-I24 D9 allows no store at all. The reasoning that produced D9 (a saved screen quietly keeps a window open; opposition rows outlive the fixture) is honoured by what a view may not hold (opposition, a comparison) and by re-running under today's scope. Everything else here is GA-I24 applied to a new surface: the floor (D4), the column list (D5), the window (D6, D7), no absence (D8), no verdict (D3), the pupil (D10), the parent (D11), the analyst's bundle unchanged (D12), corrections by construction (D14). Compare itself changes in nothing.

### 2.5 Logging and corrections

**D18. A run that names children is logged once.** Every StatsMagic run whose answer carries per-child rows (a list, or a player-subject table) writes one `access_log` row through `log_restricted_read()`: reader, school, kind `stats_magic`, the question record, and the player ids the rows named. Team-level runs are not logged. The parent's "who read my son's figures" (READERS S; INCIDENTS D20) gains the word "a figures question (StatsMagic)" beside the reader's role and school. This differs from GA-I24 §6 (own-school comparisons unlogged) on purpose: a comparison is two profile opens; a list is a sweep of a side, and a sweep is what a parent would want to know about. Q3 puts it to Kameel. The AI door also logs that a model was called, with the *masked* question and the row count; the names never reach the log from that path either. The opposition answer logs as `opposition_squad()` logs today, nothing more.

**D19. Corrections and withdrawals reach every answer on the next read, because nothing is stored but the question.** A `void` or an approved amendment refolds `ball_event_live` / `ball_event_career` (GA-I36 §0), and every StatsMagic run is a fold over them; a saved view shows the corrected figure when opened, with its "as at", and I36's "updated since you opened this" marker when it lands. A pupil leaving the school, a guardian link ending, a coach's assignment ending: he leaves the vocabulary from that day (GA-I24 D2, Q6), saved views naming him go "out of scope", and his rows in a side's season table stay as scored (lifecycle D8). Withdrawn public-name consent and the never-public mark change nothing signed-in (083 §7) and StatsMagic has no public face (D16). Withdrawn health, scouting or passport consent touches nothing here because none of their data is in the grammar. A correction never reaches into a log row already written; a re-run after a correction is a new read and a new row.

---

## 3 · Who sees what

"Own" means a player whose figures the reader may open today under `player.performance.read` in a current assignment. "Team level" means totals, results, margins, extras, run rates, phases, the derby record, standings: nothing keyed to one boy.

| reader | subjects | forms | AI door | saved views | logged | never |
|---|---|---|---|---|---|---|
| **Pupil** (`player` + `selfaccess`) | me; my side (team level); one team-mate at a time, as his profile read allows | figure, table (one subject) | yes, over the same grammar | yes, his own questions | no (`career` unlogged by decision) | a list of team-mates; two team-mates in one answer; any boy of another school; skills, load, health, availability, age |
| **Parent** (`guardian`) | my child (one at a time); his side (team level) | figure, table | yes | yes, per child | no | a team-mate by name beyond the scorecard; her two children in one answer; a list |
| **Coach** (`coach`, team-scoped) | own players; own sides; opposition sides (team level); competition | figure, table, list | yes | yes | lists and player tables, one row per run (D18) | their named child outside the window; skills, ratings, notes beside figures; an absence; a shared or exported view |
| **Assistant coach, team manager** | not offered (GA-I24 D13, Q3) | — | — | — | — | as the coach |
| **Captain** (a pupil with the honour) | as any pupil | as any pupil | as any pupil | as any pupil | — | the 138 C2 table is not StatsMagic's; the dossier, ever |
| **Analyst, director of sport, principal, office** | own school's players and sides; opposition sides (team level); competitions | figure, table, list | yes | yes | as the coach | as the coach; their wider bundles draw nothing here |
| **Media** (`media`) | sides and competitions, team level (Q6) | figure, table | yes | yes | — | any per-child row; a list |
| **Scout** (`scout`) | none; `scouting_candidates()` as today | — | — | — | as today | any StatsMagic surface |
| **League account** (`competitionadmin`) | its own competitions and the sides in them, team level (R1) | figure, table | yes | yes | — | a player subject; a per-child row; a list; any other competition |
| **Spectator** (`spectator`, REACH R-G) | fixtures he may see, team level | figure, table | no (Q7) | no | — | a boy as a person |
| **Other school's staff** | our side at team level through their own StatsMagic; our boys only through *their* dossier in the window, logged against us | | | cannot save it | against our school, every boy's id | our boys' anything beyond `opposition_squad()`'s columns |
| **Owner's key, support sessions** | none | — | — | — | — | a StatsMagic surface |
| **Public** (signed out) | nothing | nothing | no box, ever | — | — | a question box, a figure for one child, a list, a name, a photo |

Scorer, official, physio, S&C, DSO, finance, driver, transport coordinator: no StatsMagic. The surfaces exist where the reason for reading figures is playing, parenting, selection, coaching, analysis or running a competition.

---

## 4 · What combining reveals, and what never surfaces

| combination | allowed? | why |
|---|---|---|
| One boy's runs by opposition, by ground, by phase, by position, by bowling type | **Yes**, own school | his own rows under `player.performance.read`; small cells fall under the floor and say so |
| A side's bowlers listed by economy | **Yes**, staff only, floor applied, unranked rows under the floor counted not named | D7, D9 |
| A side's batters listed, grouped by position | **Yes**, staff | position is a fold fact of the innings, not a selection judgement |
| "Appearances" beside "fixtures" or any count of matches not played | **No** | GA-I24 D8: an absence is health or discipline by subtraction |
| By age, age band, date of birth | **No** | not in the vocabulary; `player.age.read` is not the analyst's and not a figure |
| Our batter against their *named* bowler | **No** | GA-I24 D7; `matchups` already drops the row; types only |
| Their child's figures across our fixtures, outside the window | **No** | a standing file on another school's child (GA-I24 D6, D9) |
| Their child inside the window | **Yes**, `opposition_squad()` only, logged, unsaved | D14 |
| Opposition aggregates minus our own fixtures | **Not drawn** | GA-I24 §5: a subtraction pane nobody asked for |
| A competition's children ranked across schools | **No**, for anyone | PUBLIC_DATA A3; READERS R1; plan §8 |
| Team-level totals across a competition's sides | **Yes** | team-level facts (A1); the league reads its own competitions only |
| Two of a parent's children in one answer | **No** | STEP4 decision 1; GA-I24 D11 |
| A pupil's side listed by runs | **No** | D9, GA-I24 D10; the captain's C2 table is its own surface |
| Skills, ratings, notes, workload, wellness, availability, discipline, PII, fitness, born | **Never** | `NEVER_COMPARED` is the vocabulary's never-list; a test holds them apart |

**Re-identification.** Within a school the staff read every boy by name already; nothing to re-identify. Across schools the only per-child path is the window, logged. On public pages nothing of StatsMagic appears, so per-match pseudonyms are untouched.

**Small-sample inference.** The floor (D7) and no verdict (D8). A list over a two-match season shows counts and em dashes and says "insufficient" in words; the AI narrator may not say "best" or "struggling" (its system prompt forbids a judgement word, and the number check drops any figure the rows do not hold).

**Leakage by subtraction.** Absence (barred), age (not in the grammar), medical by exclusion (needs availability and fitness, neither present). The model is handed no column outside the result rows, so it cannot infer from what it was not given.

---

## 5 · How the AI box and the explorer relate

```
Global Search box ─ "who has the best economy in the U15A this season?"
        │  (question text only; no context from the browser, as today)
        ▼
POST /api/ai/stats-magic
   1 parse  → model sees: grammar, the reader's vocabulary (names masked PLAYER_n), the question
             returns: {subject: side U15A, measure: economy, group: player, filters: {season: 2026/27},
                       order: economy asc, limit: 11}  — or {cannot: "availability is not in the ball log"}
   2 run    → validator drops anything not in the vocabulary; the fold runs under the session (RLS);
             floor applied; rows returned with denominators and as-at
   3 say    → model sees the rows (masked), writes one sentence; server checks every number in it
             against the rows; a sentence with a stranger number is dropped, the rows stand
        │
        ▼
The explorer screen opens with those chips filled, the table under them, the sentence above
the table, "as at 14:32", the source line, "view deliveries", and "save this question".
```

- The box stays where it is in Global Search (`askGuru`, `looksLikeStat`) and becomes a hand-off: it posts the question and navigates to Analytics → StatsMagic with the result. The guided door is the same screen with empty chips.
- `maskNames` and `TOKEN_RULE` stay. The vocabulary carries each own player as `PLAYER_n` ↔ id, so the model can map a typed name to a token to an id without ever seeing the name; a name not in the reader's vocabulary is not masked and not matched, and the parse returns "not in your scope".
- The parse and say calls use `AI_MODELS.statsMagic`; the say call is skipped when the answer is a single figure (the figure speaks for itself) or when the row count is zero (the screen's own empty state speaks).
- A question with a missing field ("how did we do at the death?" — which side, which season?) comes back with the chips it could fill and the empty one marked "choose", and runs when the reader fills it. No figures before a run.
- The free-prose answer of today (a paragraph from the model over the whole school's career lines) is retired when slice 3 lands; until then it stays as it is.

---

## 6 · Build plan

Each slice names the existing functions it stands on and its proof. Opus writes the grammar, the read, the schema, the logging and the AI path; Sonnet writes the screens; Opus reviews every slice that draws a child's figures.

| slice | ships | stands on | proof | tier |
|---|---|---|---|---|
| **S0 · Grammar and never-list** | `apps/web/src/lib/statsmagic.js` (pure): the question record, its fields, the vocabulary shape, `validate(question, vocabulary)`, the measures and groupings of D3–D4, the never-list (reuse `NEVER_COMPARED`, `COMPARE_FLOOR`); the same validator in `services/api/` | `lib/compare.js` (`COMPARE_FIELDS`, `NEVER_COMPARED`, `floorRate`, `evidenceWord`, `compareScopes`, `pickable`, `teamMates`), `lib/captain.js` (`matchupTypes`), `@scrbrd/scoring` `evidenceLabel` | unit tests: every field pinned; a question naming a never-list column fails validation; a value outside the vocabulary is dropped and named; a rate order below thirty is rewritten to thirty | Opus |
| **S1 · The read** | one parameterised read, `stats_magic` (`readResource`), SECURITY INVOKER over `ball_event_career` and the existing views (`player_batting_career`, `player_bowling_career`, `player_dismissals`, `match_live_score`), with the floor inside it as `opposition_squad()` has it, batting position derived in the fold, phases from the `phases` fold; team-level subjects over fixtures under `fixture.read`; `competitionadmin` cut to its own competitions | `services/api/read/read-api.mjs` (`career`, `career_by_season`, `matchups`, `matchup_coverage`, `derby_record`, `phases`), `db/08` `evidence_label()`, RLS on `ball_event_career` | `db/99` assertions: a coach's run returns only his sides' boys; an analyst's returns the school's; a pupil's returns himself and team level; a parent's returns her child and team level; a league account's returns its competitions, no `player_id` column; a spectator's has no `player_id` column; a run with `born`, `fitness`, `age_band` in any parameter is refused; a rate at 29 balls is null, at 30 a number; a departed boy is in no row of a new run; the generic CSV export refuses `stats_magic` and `opposition_*` (GA-I24 A1). `tools/smoke-statsmagic.mjs` gains: the read's figures equal the career views' for the same reader | Opus |
| **S2 · The explorer screen** | Analytics → StatsMagic sub-view (`AnalyticsView.jsx`, beside Compare): chips per field, the three answer forms, `SourceLine` first, "as at", the floor words, "view deliveries" through CRI-2.3's event-id route; no avatar; 12 px and 44 px floors; `prefers-reduced-motion` | `views/compare.jsx` (`Picker`, `Cell`, `Pair`, `FloorLine`, `asAtWords`), `ui/sourceLine.jsx`, `lib/sourceWords.js`, `lib/live.js` (`useLive`), `lib/held.js`, `lib/teamContext.js` | `apps/web/test`: the component accepts only validated questions; a list has no rank column, no colour by value; rows under the floor are counted not named; no absence measure exists in the chip set; `smoke-a11y` and the 360/390 px walk over the new surface | Sonnet builds, Opus reviews |
| **S3 · The AI door rewired** | `askStatsMagic` becomes parse → run → say; the vocabulary built server-side from the reader's reads; the number check on the sentence; refusal words for out-of-grammar questions; Global Search hands off to the screen with chips filled; `statsMagicContext()`'s whole-school context retired | `ai-service.mjs` (`maskNames`, `TOKEN_RULE`, `AI_MODELS.statsMagic`, `textOf`, `readResource`), `GlobalSearch.jsx` (`askGuru`, `looksLikeStat`), `lib/ai.js` (`askStatsMagic`) | `smoke-statsmagic.mjs` rewritten: no child's name in any request (as today); the parse request carries no figure; the say request carries only the result rows; every number in the returned sentence is in the rows; a question about availability, health, age or a note returns the refusal and makes no run; a question naming a boy outside scope returns "not in your scope"; an unauthenticated call is refused before any read | Opus |
| **S4 · Saved views** | `db/NN_stats_magic_view.sql`: the table, owner-only RLS, the validator as a check on write, deletion on the owner's last assignment at the school; "save this question" and "my questions" on the screen; "no longer in your scope" state | ACCOUNT_LIFECYCLE's departure and disable paths, `assignment` end dates, S0's validator | `db/99`: another user cannot read or write my view; a view with an opposition subject or two player ids is refused on write; the owner's departure deletes his views; a stored record carries no name and no figure. Walk: save, void a ball, reopen, the figure changed and "as at" moved; the boy leaves, reopen, "no longer in your scope", no name | Opus schema, Sonnet screen |
| **S5 · Logging** | one `access_log` row per run that names children, kind `stats_magic`, the question and the ids; the parent's "who read" word; the AI call's log line with the masked question | `log_restricted_read()`, `access_log`, `RESTRICTED_FIELDS`, `my_child_access_log()` (design) | `db/99`: a list run writes one row with every id in it; a team-level run writes none; an opposition run writes `opposition_squad()`'s rows as today and no second row; the log row holds no name. Walk: the parent persona sees "a figures question" with the coach's role and the day | Opus |
| **S6 · Role walks and the public check** | the persona walks over the finished surface | `tools/smoke-*` pattern, `smoke-public-*` | pupil: me and team level, no list, a team-mate one at a time; parent: one child, switcher rebuilds the vocabulary, two children never in one answer; coach: list with the floor; analyst: school-wide; league: own competitions, no `player_id`; scout and spectator: no surface, or team level only; signed out: no route, no box, no string "StatsMagic" in any public page's HTML, no image; a corrected ball changes a saved view on reopen | Opus |

Order: S0 → S1 → S2 → S3 → S4 → S5 → S6. S2 can start on S0 with a fixture of the read's shape while S1 is on the database lock. No slice touches `packages/policy` bundles: the `analyst`, `coach`, `player`, `guardian`, `competitionadmin` grants are as they are. One migration (S4). One new read (S1).

---

## 7 · Where it lives, and the phone

- Analytics → StatsMagic, a sub-view beside Performance, Phases, Head-to-head, Match-ups, Compare and Table. On a phone: chips in two wrapping rows, the sentence, the source line, the answer; a table scrolls sideways with a scroll cue (G6's rule). "View deliveries" and "Save this question" are 44 px buttons under the answer.
- The question box stays in Global Search and lands on this screen.
- A pupil's and a parent's StatsMagic is the same screen with a smaller vocabulary; no separate build.
- Floors stand: 12 px, 44 px, `prefers-reduced-motion`, no colour alone, figures in the tabular face; no new runtime dependency; `DESIGN_DIRECTION.md` governs; no dense form (the chips are the form, and an empty screen shows six example questions as chips, not a grid of selects).

---

## 8 · The reads it needs

| part | served by | exists? | notes |
|---|---|---|---|
| Per-player figures by season | `career`, `career_by_season` | yes | S1 folds the same views with groupings |
| Match-ups by type | `matchups`, `matchup_coverage` | yes | types only, coverage line |
| Derby record | `derby_record` | yes | team level |
| Phases | `phases?matchId=` | yes, per match | S1 folds across matches under the same reducer |
| Batting position | the innings fold's order of arrival | **not a column today** (A1) | derived in S1's fold; Opus confirms the fold can say it |
| Fixture class (competitive, friendly, inter-house) | `match` metadata | **unknown** (A2) | the grouping is offered only where the column exists |
| Grouped folds with floors | **`stats_magic` read, S1** | no | the one new read; SECURITY INVOKER |
| Opposition in the window | `opposition_context()`, `opposition_squad()` | yes | unchanged, logged |
| Competition and standings | `league` and the competition reads | yes | team level |
| The vocabulary | `players`, `matches`, `teams`, the competition reads, under the session | yes | built server-side for the AI door, client-side for the chips, from the same reads |
| Saved questions | **`stats_magic_view`, S4** | no | the one migration |
| The log | `log_restricted_read()`, `access_log` | yes | one row per run naming children |
| The never-list | `NEVER_COMPARED`, `tables.mjs` masks | yes | reused |
| Whole-school AI context | `statsMagicContext()`, `contextFrom()` | yes | **retired in S3** |

---

## 9 · Questions for Kameel: decided 29 Oct 2026, all ten as recommended

Kameel's answer on the Build Board (29 Oct 2026): "All ten as recommended". Each recommendation below is therefore the decision.

| # | question | recommendation |
|---|---|---|
| **Q1** | Saved views at all, given GA-I24 D9 refused any store for Compare? | **Yes, as a saved question** (D17): no figure, no name, owner-only, re-run under today's scope, cannot hold an opposition query or a comparison, deleted with the owner's assignment. The plan's decision 7 asks for them; this is the narrowest shape that answers it |
| **Q2** | May a saved view be shared with a colleague, posted to the side, or exported as CSV or a report? | **No, in v1.** Personal only. The audit's "exported reports record query filters, data revision and generated time" is met by the screen's source line and "as at"; a file of children's figures leaving the app is its own design. The generic CSV export refuses `stats_magic` |
| **Q3** | Log own-school StatsMagic runs that name children, one row per run? | **Yes** (D18). A list is a sweep, not a glance; a parent asking "who read my son's figures" should see it. Team-level runs unlogged |
| **Q4** | Two groupings at once (by opposition *and* by season)? | **Not in v1.** One grouping keeps the table readable on a phone and keeps cells above the floor. Add later if coaches ask |
| **Q5** | May a pupil list his side (runs this season, ordered)? | **No** (D9, D10). He opens a team-mate one at a time as today; the captain's 138 C2 table stays its own decided surface. If Kameel wants a side table for every pupil, it is C2 widened, not StatsMagic |
| **Q6** | Media: team level only, or the full staff grammar? | **Team level only.** Media holds `player.performance.read` for news; a list of children ordered by figures is a leaderboard waiting for a post (A3 signed-in). A news post about one boy's fifty needs no explorer |
| **Q7** | The AI door for spectators and the league account? | **League yes, team level; spectators no.** The league account asks about its own competitions; a spectator's team-level questions are few and the chips answer them. Keep the model calls to roles with a job |
| **Q8** | Inside the window, may the AI door answer about an opposition boy, or is that the chips only? | **Chips only.** The dossier is read deliberately, logged, on a screen that says so; a typed question that happens to name their opener should answer "open the opposition dossier", not run it. The model never sees another school's child's figures |
| **Q9** | The sentence from the model: keep it, or show only the chips and the table? | **Keep it, with the number check** (D13). One plain sentence is what makes a parent's or a pupil's answer readable; the check makes it safe. If the check drops more than it keeps in the pilot, the sentence goes and the chips stay |
| **Q10** | One spelling: "StatsMagic" (plan decision 7) or "Stats-Magic" (the app's strings today)? | **StatsMagic**, everywhere; Haiku renames the strings, the route name `/api/ai/stats-magic` stays |

---

## 10 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **A1** | The innings fold (`packages/scoring`, `deriveMatch`) can state each batter's position from his order of arrival, and the career views can carry it or S1 can derive it | the position grouping and filter ship in a later slice; nothing else moves |
| **A2** | `match` carries, or can carry, a fixture class (competitive, friendly, inter-house) and a competition id | the grouping is offered only by competition where the id exists; "fixture class" waits |
| **A3** | CRI-2.3's drill-down (event ids → filtered commentary) lands before or with S2 | "view deliveries" opens the fixture's commentary unfiltered, with the over named; replaced when 2.3 lands |
| **A4** | `competitionadmin`'s reads are already cut to its own competitions (READERS R1, 28 Oct) at the read path | S1 applies the cut inside `stats_magic` itself; the league's vocabulary is built from it |
| **A5** | `log_restricted_read()` takes a kind and a list of ids, or can in one line | S5 writes one row per id instead, which is noisier and still true |
| **A6** | The spectator's reach (REACH R-G) gives `fixture.read` over the fixtures the team-level grammar needs | the spectator gets no StatsMagic in v1; nothing else changes |
| **A7** | The model, given the grammar and a masked vocabulary, returns a valid record often enough to be worth the call | the AI door narrows to "fill the chips from this sentence" with the reader confirming before any run; the explorer stands on its own |

---

*Nothing here reopens a decision Kameel has made. Where this design would allow something GA-I24 refused, it says so in §2.4 and asks in §9.*
