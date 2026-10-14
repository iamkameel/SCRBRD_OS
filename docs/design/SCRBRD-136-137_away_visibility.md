# SCRBRD-136 / 137 — Away visibility: what the visiting side may read of its own boys from a fixture another school hosts

**Status:** Decided 14 Oct 2026; build not started.
**Source:** PR #141's walk (`tools/smoke-cockpit.mjs` on `claude/wip-cockpit-b`, :179–189: "this may be a functional gap for away coaches"); `docs/design/SCRBRD-136-137_coach_cockpit_and_feed.md` §1, §3.5–3.7, §9, D8, D15; `docs/design/SCRBRD-136-137_phaseB.md` §1, §5, PB-D1–D3; `db/02_schema_scoring.sql` (`ball_event_read` :212–215, `ball_event_live` :487); `db/07_shot_placement.sql` :113; `db/09_rls_policies.sql` (`match_read` :237–239, `match_squad_read` :273); `db/54_laws_4th_edition.sql` (`bowler_over` :332–347); `db/94_bowler_day.sql` [branch]; `services/api/read/read-api.mjs` (`shot_points` :218–230, `workload` :1481–1503, `bowling_spells` :1568–1585); `docs/design/GA-I24-I25_compare_and_combine.md` D7; `docs/policy/PUBLIC_DATA.md` §3, §5a; ADR 0002; `docs/design/SCRBRD-110_workload.md` §3.3, §4.2; `docs/design/STEP4_parent_pupil.md` §1.2, §2.1 P4, Q4.
**Reader:** Kameel first; then the Opus lead; then the Opus agent who writes the one policy and its proofs, and the Sonnet agent who flips the walk's assertions and checks the two screens. Plain words come first in each section. Names are the seed's illustrative ones (Hilton, Westville, Kearsney, D Erasmus, R Pillay, K Naidoo), never a real child's.
**Scope:** reads only. Nothing here lets the away side score, correct, void or hold the pad; nothing here touches the dossier's window, the public page, or any medical, wellness, discipline or safeguarding table.

**Lead's review (2026-10-14).** Confirmed against main: `ball_event_read` asks `fixture.read` at `ball_event.school_id` and `match_team()`, both the host's (`db/02_schema_scoring.sql:51–52, :212–215`), while `match_read` has the away branch (`db/09_rls_policies.sql:237–239`). So today an away fixture is listed for the visiting school and every ball of it is hidden from them, its parents' Match Centre included, not just the coach's spells. That raises this from a cockpit gap to a family-screen gap at every away fixture. Two notes for the builder, neither changing a decision. (1) **Numbering:** `tools/migrate.mjs:154` takes only `^\d\d_` and skips 98 and 99, so **db/97 is the last number the migrator, `expected-migrations.json` and `schema-guard.test.mjs` accept as they stand**; db/96 is claimed for the captain's plan. This design takes db/97, and the first file after it needs an Opus change to the numbering rule in all three places (and the paste kit's bundler) before it can be written. (2) AV-D2 shows the host's boys to the visiting school's signed-in readers by the names the pad wrote. That is what 136 §3.5 and STEP4 Q4 already decided for "every signed-in reader"; the public page's consent-based masking (PUBLIC_DATA §5a) is unchanged, so this needs nothing new from the information officer, but it is the call in this design that touches other schools' children, so it is Kameel's explicitly.

---

## What Kameel decides

**Decided 14 October 2026 (Kameel): every recommendation below, as written.**

1. **The ball log follows the fixture.** `ball_event_read` gains the away-side branch that `match_read` already has (db/09:237–239), so a fixture both schools may *see* is a fixture both schools may *watch*. Recommendation: **yes** (AV-D1). The alternative, a per-side view of the log filtered to "our boys' balls", is rejected in §2.3: every ball has one side's bowler and the other side's striker, so there is no such thing as our half of a log.
2. **Names on the away side's scorecard, as the log carries them.** A Westville coach, pupil, parent or spectator signed in at a Hilton-hosted fixture sees Hilton's eleven by the names the pad wrote (STEP4:227), exactly as Hilton's own crowd does and as the board at the ground does. Recommendation: **yes**, no masking (AV-D2). STEP4 Q4 decided the signed-in, linked crowd is not the public; 136 §3.5 already says "from the first ball: this match's scorecard and log, as every signed-in reader has it". This makes the code do what that row says.
3. **Everything per boy stays per boy, and nothing new is gated.** The directive, age band and limit flag on `bowling_spells` (read-api.mjs:1579–1581), a boy's wheel (`player_shot_points`), his day total (`bowler_day`), his week (`workload()`), his named matchups: each already asks its own capability per boy, so the away coach gets his own boys filled and Hilton's null or absent, in both directions. Recommendation: **confirm, build nothing more** (AV-D3).
4. **The pad's tables stay the host's.** `scoring_session`, `ball_event_quarantine` and `scoring_audit` keep their host-only policies (db/02:245, :252, :272). Recommendation: **yes** (AV-D4): who holds the token, what was quarantined and who did what are the scoring school's business; the away side reads what the balls say, not how they were scored.
5. **The away school's spectators read it too.** `fixture.read` at Westville is what lets Westville's parents and pupils in; its spectators hold the same capability. Recommendation: **yes** (AV-D5). Keeping spectators out would need a role test inside a policy, which ADR 0003 forbids, or a second capability for one table.

Everything else below is a design call made with reasons, and is Kameel's to overturn.

---

## 0 · In one page

A fixture has a host (`match.school_id`, `team_code`) and a visitor (`match.away_school_id`, `away_team_code`). The `match` row is readable by either side's `fixture.read` holder (db/09:237–239), so Westville's coach sees Saturday at Hilton on his list, his parents see it on Family, his pupils see it on Home. But every ball of it sits in `ball_event` with the **host's** `school_id` (db/02:85), and `ball_event_read` asks `fixture.read` at the host school and the host team only (db/02:212–215; `match_team()` returns the host's code, db/02:51–52). So at Hilton, Westville's coach reads no spell, no wheel, no phase, no scorecard; his parents' Match Centre is blank; his pupils' rows cannot light. PR #141's walk proved it both ways round (`smoke-cockpit.mjs:182, :189`).

Meanwhile `bowler_day()` (db/94, a definer) and `workload()` (db/60) already sum D Erasmus's overs at Hilton into his own coach's day and week (`smoke-cockpit.mjs:262–264`: "our spinner bowled at his ground: our coach reads that, as his day"). The platform tells the coach his boy bowled seven at Hilton and will not show him the seven.

**The fix is one policy, not a new read.** `ball_event_read` becomes what `match_read` is: host branch **or** away branch. Every read of the log — the fold, `bowling_spells`, `shot_points`, `phases`, `live_score`, `matchups`, `career_by_season` — runs `security_invoker` down to `ball_event` (db/02:487; db/07:113; db/54:332), so all of them start answering the away side at once, and each one's per-boy gate keeps answering per boy. Nothing of Hilton's children that is gated today becomes ungated: the band, the directive, the limit flag, the wheel, the load, the day total, the matchups by name, the squad, the availability, the injury all stay behind the capabilities they are behind now (§4). What Westville gains is the match. What Hilton gives up is nothing it does not already show its own crowd and the pavilion.

Build: one hand-written migration (Opus), one `db/99` section, two assertions in the walk flipped and a cross-school group added (Sonnet from the list here, Opus reviews), no new screen (§7). The public page does not change (§6).

---

## 1 · Today, exactly

### 1.1 Plain words

Two tables decide what a signed-in person sees of a match: the `match` row (is there a fixture) and `ball_event` (what happened in it). The first already belongs to both schools. The second belongs to the host, by one `app_can()` line written when "a school context" meant one school (db/02:200–202: "live scores are public within a school context").

### 1.2 The two policies side by side

| | `match_read` (db/09:237–239) | `ball_event_read` (db/02:212–215) |
|---|---|---|
| host branch | `app_can('fixture.read', match.school_id, match.team_code, …, match.id)` | `app_can('fixture.read', ball_event.school_id, match_team(ball_event.match_id), NULL, ball_event.match_id)` |
| away branch | `OR app_can('fixture.read', match.away_school_id, match.away_team_code, …, match.id)` | **none** |
| who reads at Hilton v Westville | both schools' `fixture.read` holders | Hilton's only |

`ball_event.school_id` is the host's (db/02:85, set by the scorer's session at the host). `match_team()` returns `match.team_code`, the host's (db/02:51–52). So neither value in the policy can ever be Westville's; the away branch has to read `away_school_id` and `away_team_code` from `match` directly, as `match_read` does.

### 1.3 What flows from it, as the walk proved

| reader at a Hilton-hosted fixture | `matches` | `bowling_spells` | `bowler_day` (his own boy) | source |
|---|---|---|---|---|
| Hilton's coach | row | rows; his boys' band filled, Westville's null | row | `smoke-cockpit.mjs:164–167`, :183–188 |
| Westville's coach | row | **`[]`** | row, including the Hilton overs | :182, :262–264 |
| Hilton's coach at a Westville-hosted fixture | row | **`[]`** | row | :189 |

`bowler_day` is `SECURITY DEFINER` and reads `bowler_over` as the owner (db/94 "day" CTE comment: "the sum reaches a match the reader's own row security may not, which is the point"); `bowling_spells` is `security_invoker` all the way down (`bowler_spell` → `bowler_over` → `ball_event_live` → `ball_event`). The day total was designed to cross the boundary; the spells were never designed to stop at it — 136 §3.5's "from the first ball" row assumes they do not.

---

## 2 · The model

### 2.1 Plain words

A ball log is one thing about one match. The six legal balls of an over were bowled by one school's boy to the other school's boys; the score is the sum of both. There is no "Westville's part" of the log that is not also Hilton's part. So the question is never *which balls* the away side may read; it is *whether* the away side may read the match it is playing in. Today's design already answers yes (136 §3.5 row 3, D8 "this match's balls, both sides", STEP4:184 "an away side's parent read the shared fixture"). The policy did not follow.

### 2.2 The rule — AV-D1

**Whoever may read the fixture may read its log.** `ball_event_read` is replaced by:

```
app_can('fixture.read', ball_event.school_id, match_team(ball_event.match_id), NULL, ball_event.match_id)
OR app_can('fixture.read',
           (SELECT m.away_school_id FROM match m WHERE m.id = ball_event.match_id),
           (SELECT m.away_team_code FROM match m WHERE m.id = ball_event.match_id),
           NULL, ball_event.match_id)
```

The host branch is unchanged word for word. The away branch is `match_read`'s second line with `ball_event.match_id` as the match. A fixture with no away school (`away_school_id` null — a match against an opponent not on the platform) has a branch that `app_can()` refuses, as it does on `match` today. Nothing else: no role name, no feature flag, no window.

### 2.3 Rejected alternatives, and why

| alternative | why not |
|---|---|
| **A per-side view of the log** filtered to balls where our boy bowled or faced | The row still carries the other side's `striker_id` or `bowler_id` (db/02:133–135), so it names Hilton's child anyway. The fold cannot run on half a log: the over count is "balls of the over before it" (db/54:336–340), partnerships need both ends, extras need the bowler. And it would be a fifth fold that disagrees with the scorecard — the exact fault db/02 fixed by making `ball_event_live` the one exclusion (db/02:475–487). |
| **A definer read of "our boys' figures"** (spells, points) without the log | Duplicates `bowling_spells` and `player_shot_points` as definers; two places hold the same gate. The parent's Match Centre and the pupil's lit rows stay blank (§5). |
| **Leave it; `bowler_day` is the cross-match read** | A day total with no spell behind it: the S2c card says "7 today" and P6 shows nothing. Half the families at every fixture see no match. And the "protection" protects nothing: the host's crowd and the pavilion already read every ball. |
| **A per-match assignment at the host** for the visiting coach | An office task per fixture, and a scoped assignment the away pupils and parents would never get. ADR 0001 wants authority from standing assignments, not per-event grants. |
| **Mask the host's names** for cross-school readers | The names are in the log as the pad wrote them (STEP4:227); masking would need a second scorecard shape for one reader class, and the board at the ground shows them unmasked. The public label (initial + surname under consent, PUBLIC_DATA §5a) is for the public page, which is not this read (§6). |

---

## 3 · Which reads change, and which never do

### 3.1 Plain words

One policy sits under every fold of the log. Change it and every signed-in read of the match starts answering the visiting school. Every read that asks a capability *per boy* on top of the log keeps asking it. The reads that are the pad's, the scorer's or the office's are untouched.

### 3.2 Reads that start answering the away side (no code change in any of them)

| read | path | folds | the away coach at Hilton, after |
|---|---|---|---|
| `GET /api/matches/:id/events` (the fold: Board, Scorecard, Commentary, Partnerships) | `services/api/server.mjs:585` | `ball_event` | the match, as Hilton's crowd has it |
| `live_score` | `read-api.mjs:169–173` | `match_live_score` | the score |
| `shot_points` (this match's wheel, P8) | :218–230 | `ball_event_live` | both sides' balls, as D8 decided |
| `shot_point_coverage` | :282–287 | `ball_event` | the excluded count |
| `phases` (P7) | :810–821 | `ball_event_live` | the phase split |
| `summary` | :720–762 | the career views over `ball_event_live` | the result and cards |
| `bowling_spells` (P6) | :1568–1585 | `bowler_spell` → `bowler_over` (db/54:332) | every bowler's spell; **his boys' `age_band`, `pace`, `max_*`, `over_spell_limit`, `breach_recorded` filled; Hilton's null or false** (`w.may`, :1579–1581) |
| `matchups`, `matchup_coverage` | :2150–2225 | `ball_event_career` | rows whose `bowler_id` he may read (138 D8); Hilton's bowlers unattributed |
| `career_by_season`, `player_shot_points` for his own boy | :2450, :251–271 | `ball_event_career` | his boy's figures now include the Hilton innings; still refused for Hilton's boy (`player.performance.read` per boy) |

The lead checks at build that `ball_event_career` is `security_invoker` like its siblings (read-api.mjs:2500 says it inherits from `ball_event_live`); if it is not, the away branch does not reach it and the career rows would still omit the away innings (AV-A3).

### 3.3 Reads and tables that never change

| thing | policy | why it stays the host's |
|---|---|---|
| `scoring_session` | `fixture.read` at host (db/02:245) | the token and the lease are the scoring school's; the away side watches the balls, not the pad |
| `ball_event_quarantine` | `scoring.correct` at host (db/02:252) | a quarantined ball is not yet the match |
| `scoring_audit` | `audit.read` at host (db/02:272) | who scored what, when, is the host's audit |
| `ball_event_insert`, every write | `scoring.edit` at host (db/02:229) | **nothing here lets the away side score** |
| `match_squad` | per side already (db/09:273) | Westville reads Westville's sheet, Hilton's never |
| `match_availability`, `injury`, `wellness_*`, `load_entry`, `athlete_limit`, `bowling_breach` | their own policies, per boy or per side | none joins the log; none is reached by `fixture.read` |
| `opposition_squad`, `opposition_context` | `opposition.read`, the five-day window, logged (136 §3.5, D9) | the dossier is the season's view of their squad; this design reads one match's balls, from the first ball, as §3.5 row 3 always said |
| `workload()`, `bowler_day()`, `load_summary()` | definers, `player.workload.read` per boy (db/60:1085; db/94) | already cross the boundary for the reader's own boys and only them |
| the public reads (`public.mjs`) | PUBLIC_DATA | §6 |

---

## 4 · What nobody of the away side ever sees of the host's boys

### 4.1 Plain words

The log says who bowled, who faced, what the ball did and where it went. It does not say how old a boy is, what his limit is, whether he is carrying something, whether he was dropped or why, or what his coach thinks of him. Those live in other tables under other capabilities, and this change opens none of them. The list below is what a Westville reader at Hilton gets of K Naidoo (Hilton's U15 quick) — and, in mirror, what a Hilton reader at Westville gets of D Erasmus.

### 4.2 The table

| of K Naidoo, to a Westville reader | before | after | held by |
|---|---|---|---|
| his name on the scorecard, his overs, runs, wickets, this match | nothing (no log) | yes, as the pad wrote it (AV-D2) | `fixture.read` at Westville; same as Hilton's crowd |
| his spell lengths this match (`bowling_spells` overs, first/last over) | nothing | yes — a derivation of the scorecard's overs | the same |
| his `age_band`, `pace`, `max_overs_per_spell`, `max_overs_per_day`, `over_spell_limit` | nothing | **null** (`w.may` false, read-api.mjs:1579–1581) | `player.workload.read` for him: never Westville's |
| his `breach_recorded` | nothing | **false** (`bowling_breach` RLS, read-api.mjs:1574–1576) | the same |
| his overs today across matches (`bowler_day`), his week (`workload`) | no row | **no row** (db/94 "boys" CTE) | the same |
| his career, his wheel across innings (`player_shot_points`, `career_by_season`) | refused | **refused** | `player.performance.read` for him |
| our batter v K Naidoo *by name*, across fixtures | not offered | **not offered** (GA-I24-I25 D7; `matchups` drops the row) | — |
| our batter v K Naidoo *in this match*, from the raw balls | nothing | the balls are readable (D8: "this match's balls, both sides"); **no panel draws it by name** — P9 stays by type (136 §3.5 row 4), and `lib/signals.js`'s never-list gains "no rule keys a Hilton `bowler_id`" (§7 AV3) | — |
| his DOB, guardian, note, fitness, availability, injury at any tier, load word, check-in, flag, discipline, safeguarding | never | **never** — no read exists and none is proposed (136 §3.5 row 5; 110 §3.3; ADR 0002; PUBLIC_DATA §3) | — |
| his squad row, whether he was picked, dropped or declared | no | **no** (db/09:273, `side`) | `player.profile.read` at Hilton |
| who scored the match, the token, a quarantined ball | no | **no** (AV-D4) | host's |

The medical rule needs one sentence: ADR 0002 gives a coach the status and nature tiers *of his own boys*; nothing in `ball_event` is a medical column and no medical table joins the log, so the away coach learns nothing of a Hilton boy's body from the match, and a Hilton boy restricted by his physio appears in the log exactly as he appears on the board — bowling, or not. The safeguarding rule needs none: no `safeguarding.*` table is near this read.

---

## 5 · The away side's pupils and parents (STEP4 rules)

### 5.1 Plain words

R Pillay's mother holds `guardian` over him; he holds `player` at Westville U15A and `selfaccess` over himself. Both hold `fixture.read` through the away anchor (STEP4:184, db/09:239), which is why Saturday at Hilton is on her Family screen today. Neither can read a ball of it (db/02:212–215). After AV-D1 they read it exactly as a Hilton family reads a home fixture, and no more.

### 5.2 What each sees, after

| | the parent (STEP4 §2.1 P4, family mode) | the pupil (STEP4 §2.2 S3) |
|---|---|---|
| the board, the scorecard, the commentary | yes, as any signed-in reader (`fixture.read`) | yes |
| her child's / his own rows lit | yes — the point of G13 (STEP4:225, :666) | yes |
| Hilton's eleven by name | yes, as the log carries them (Q4; AV-D2) | yes |
| her child's / his own wheel (`player_shot_points`) | yes, him only (`player.performance.read` via `guardian` / `selfaccess`) | yes, himself only |
| a Hilton boy's wheel, career, profile | refused, as a team-mate's is today (STEP4:227) | refused |
| Hilton's team sheet, availability, injuries | no (`match_squad` per side; no medical tier outside her own child, STEP4:279) | no (K3, db/55: no team-mate's status, let alone an opponent's; STEP4:421) |
| his own overs that day, across both matches (`bowler_day` through `selfaccess`) | not hers (`guardian` holds no `player.workload.read`, roles.mjs per phase B §1.2) | his own row, nobody else's (`smoke-cockpit.mjs:258–259`) |
| the Coach tab, the drawer, any signal | never (136 D1, D11) | never |

Nothing is added for them. The same policy line admits them because the same capability admits them to the fixture. A Kearsney parent, pupil or spectator — neither side — reads the row (if Kearsney's `fixture.read` reaches it, which it does not: db/09:237–239 names two schools) and no ball.

---

## 6 · The public page: unchanged

The public reads run as `public.mjs` defines them (PUBLIC_DATA §5a), not through a signed-in session's RLS, so a policy on `ball_event` changes nothing a stranger sees. The public label for another school's child (initial and surname, under *that* school's consent, judged on the day the page is served) stands; N1–N5 stand; "bowling-workload breaches are never public" stands (§5a). The ground display (133 D10) and the par line read as they did. This design adds no public surface and asks for none.

---

## 7 · `bowler_day`, the S2c card and the cockpit — what changes for the away coach

### 7.1 Plain words

Phase B gave the coach a day total across matches. At an away fixture today the total has no spell behind it on the tab: S2c can say "D Erasmus · 11 of 12 today, two matches" while P6 is empty, because the second match's log is the host's. After AV-D1 the tab's P6 shows the spell the total counts. Nothing in `bowler_day` changes.

### 7.2 Exactly

| | before | after |
|---|---|---|
| `bowler_day(p_date, '1XI')` as Westville's coach, for D Erasmus who bowled at Hilton | his row, `overs_today` includes the Hilton overs (db/94, definer) | the same row, unchanged |
| `bowling_spells?matchId=<Hilton fixture>` as Westville's coach | `[]` (`smoke-cockpit.mjs:182`) | D Erasmus's spell with band and limits filled; K Naidoo's with them null |
| S2c (phase B §1.5) on the Hilton fixture's Coach tab | fires only if the tab is drawn (AV-A1) and the read answers; its evidence (the spell) is invisible | fires; P6 shows the overs it counts; `over_spell_limit` beside his own boy agrees with S2b |
| S2a/S2b, P6's cap words | `bowlerInningsCap()` from the frozen conditions (A7) — the conditions read is `fixture.read` and already reaches him | unchanged |
| the Coach tab's entry (136 §1.2: "one assignment … covers the fixture's side") | `cockpit.js:105` decides; whether it tests the away anchor is **AV-A1** | if it tests host only, Sonnet widens the client test to the `match` row's two anchors — no server change, no new capability |
| P8 this match's wheel, P7 phases, P5 Board | not drawn (no balls) | drawn, both sides' balls (D8) |
| P4 the dossier | the window and `opposition.read`, as before | unchanged; closes at the first ball (D9) |
| P9 our batters v *types* | from `matchups` (RLS drops named rows) | unchanged in shape; now has rows from the away fixture too |
| the never-list (`lib/signals.js`, 136 §9 Unit) | no rule reads `reason_kind`, `note`, `injury_type`, … | **adds:** no rule keys a card to a `bowler_id` or `striker_id` of the other side's school (a static check over the module, as `NEVER_ON_THE_TAB` is) |

---

## 8 · Build plan, tiers, the number

Order is the order of risk: the policy and its proof first, then the walk, then the two screen checks.

| # | item | migration | tier | proof |
|---|---|---|---|---|
| **AV0** | `DROP POLICY ball_event_read; CREATE POLICY ball_event_read` with §2.2's two branches; a self-check block that refuses to commit if `pg_get_expr(polqual)` does not name `away_school_id` and `away_team_code` and still names `match_team(`; `db/99 §73` (§9) | **`db/97_ball_event_away_read.sql`** — see the note below | **Opus** (hand-written RLS on the log) | `db/99 §73`; the file's own check |
| **AV1** | `tools/smoke-cockpit.mjs`: the two assertions at :182 and :189 flip to their mirror (his bowler filled, ours null; ours filled, his null); a new group "5 · the away side" with §9's API lines (a Westville parent, pupil and spectator; a Kearsney coach; the pad's tables) | none | **Sonnet** writes it from §9 word for word; **Opus reviews** every assertion | the walk green against the seed |
| **AV2** | the Coach tab for the away coach (AV-A1) and `MatchView` family mode at an away fixture: `smoke-browser-pupil.mjs` and the guardian group gain one away-fixture case each (rows lit; no team sheet of the host; no injury word) | none | **Sonnet**; **Opus reviews** (minors' data on the screen) | the browser walks; `smoke-a11y` unchanged |
| **AV3** | `lib/signals.js` never-list: no rule keys the other side's `bowler_id`/`striker_id`; the static test | none | **Opus** (it is a gate's client) | `signals.test.mjs` |
| **AV4** | after the merge: 136 §3.5 row 3 gains "(db/97)"; phase B §5 item 1 and `smoke-cockpit.mjs`'s header (:16–17) corrected to what is now true; `DEPLOYING.md`'s paste list; roadmap and gap-analysis rows | none | **Haiku** | the lead reviews before it lands |

**The number.** `db/92`–`db/96` are claimed (phase B, 140 phase 2); `db/98` and `db/99` are the seed and the verify file. **`db/97` is the last free two-digit slot and sorts before them, so this design claims it.** If the lead is holding 97, the next is `db/100`, and then the lead confirms `tools/migrate.mjs` orders files numerically, not lexically, before the first three-digit file lands. The lead numbers it either way.

`db/02` is shipped (`db/SHIPPED.sha256`), so the policy is replaced in the new file, never edited in place (`DEPLOYING.md`'s frozen-file rule). `CREATE OR REPLACE` does not exist for a policy; `DROP POLICY IF EXISTS` then `CREATE POLICY`, inside one transaction, so a second paste changes nothing.

One Opus agent's two days with Sonnet beside it; only AV0's paste waits on the database lock.

---

## 9 · Proofs — `db/99 §73` and the walk

**`db/99 §73 · the log follows the fixture`**, SET ROLE as the seed's personas, against a fixture Hilton hosts with Westville as `away_school_id` and a second Westville-hosted fixture (the walk's `fixture()` shape, `smoke-cockpit.mjs:106–109`), balls written inside the transaction:

1. **Each direction.** As Hilton's coach: every ball of the Hilton fixture; of the Westville fixture: every ball. As Westville's coach: the same two counts. The counts equal the owner's.
2. **Per boy stays per boy, both ways.** `bowling_spells` as Westville's coach at Hilton: D Erasmus's row has `age_band`, `max_overs_per_day` not null and `over_spell_limit` a boolean; K Naidoo's row has all four null and `over_spell_limit` null and `breach_recorded` false. The mirror as Hilton's coach at Westville.
3. **Cross-school refusals.** As Kearsney's coach (neither side): zero rows of either fixture, no error. As a Kearsney `spectator`: zero. As a Hilton `coach` of a *different* team (team-scoped, say 2nd XI, when the fixture is 1st XI): the host branch's own answer today, unchanged by this section (asserted equal before and after).
4. **A pupil and a parent of each side.** As R Pillay (`player` at Westville, `selfaccess`): every ball of the Hilton fixture; `player_shot_points` for himself: rows; for K Naidoo: zero. As his guardian: the same two. As a Hilton pupil and a Hilton guardian at the Westville fixture: the mirror.
5. **The pad's tables.** As Westville's coach at Hilton: `scoring_session` zero rows, `ball_event_quarantine` zero, `scoring_audit` zero (AV-D4). An `INSERT` into `ball_event` for the Hilton fixture as Westville's scorer: refused by `ball_event_insert` (db/02:228–229), unchanged.
6. **No away school.** A fixture with `away_school_id` null: Hilton's coach reads it; Westville's reads zero; the away branch raises no error on the null.
7. **Nothing joined that was not before.** No column of `ball_event` is on `tables.mjs`'s masked lists (the PUBLIC_DATA §3 test's shape); the section asserts the table's column names against a fixed list so a future medical or note column on the log fails loudly here.
8. **The policy's text.** `pg_get_expr(polqual, 'ball_event'::regclass)` names `away_school_id`, `away_team_code`, and `match_team(` once; `security_invoker` is still true on `ball_event_live`, `bowler_over`, `bowler_spell` and `ball_event_career` (the chain the away branch rides).
9. **`bowler_day` agrees with the spell it counts.** As Westville's coach, `bowler_day(<date>, '1XI')` for D Erasmus equals the sum of his `bowling_spells.overs` across both fixtures that day, now that both are readable to him (phase B §1.7 item 7's shape, across the boundary).

**The API walk (`tools/smoke-cockpit.mjs`)**: items 1–5 and 9 over HTTP, signed in as `coach.wes`, `coach` (Hilton), a Westville pupil, a Westville guardian, a Westville spectator and a Kearsney coach the walk appoints; the two flipped assertions (:182, :189) and their mirrors; `rows("bowling_spells", { matchId: SHARED }, wes)` as item 2; and the never-words grep on the rendered Coach tab and Match Centre as the away coach: no `age_band` value beside a Hilton name, no `injury_type`, no `reason_kind`, no "risk".

**Browser (`smoke-browser-pupil.mjs`, the guardian group)**: at the away fixture the child's rows are lit, Hilton's eleven appear by the names the log carries, no team sheet of Hilton's, no injury word, no "unavailable" against any Hilton name; the Analytics tab offers a wheel for her child only.

---

## 10 · Decisions — AV-D1 … AV-D5

| # | decision | recommendation | why, in one line |
|---|---|---|---|
| **AV-D1** | the model | **`ball_event_read` = `match_read`'s two branches; the log follows the fixture** — **decided 14 Oct** | a ball has both sides on it; the design (136 §3.5 row 3, D8, STEP4:184) already assumed this and the code never followed |
| **AV-D2** | names of the host's boys to the away side's signed-in readers | **as the log carries them, unmasked** — **decided 14 Oct** | STEP4 Q4: the linked, signed-in crowd is not the public; the board at the ground shows them; one scorecard, not two |
| **AV-D3** | the per-boy figures | **unchanged: every existing per-boy gate holds in both directions; no new gate, no new read** — **decided 14 Oct** | `w.may`, `workload()`, `bowler_day`, `matchups`, `player_shot_points` all already ask per boy (§4.2) |
| **AV-D4** | the pad's tables | **host-only, unchanged** — **decided 14 Oct** | the token, the quarantine and the audit are how the host scored, not what the balls say |
| **AV-D5** | the away school's spectators | **in, through `fixture.read`, like the host's** — **decided 14 Oct** | keeping them out needs a role test in a policy (against ADR 0003) or a capability for one table |

## 11 · Assumptions

| # | assumption | if wrong |
|---|---|---|
| **AV-A1** | the Coach tab's entry test (`cockpit.js:105`, 136 §1.2) accepts an assignment on the fixture's *away* anchor, as the `match` row's policy does | Sonnet widens the client test to both anchors in AV2; no server change |
| **AV-A2** | the names on the scorecard come from the log as the pad wrote them (STEP4:227, `MatchView.jsx`'s header), not from a `player` join | then a cross-school reader sees ids with no name for the other side, AV-D2 is moot in that direction, and Kameel decides whether the away scorecard should name the host's boys at all |
| **AV-A3** | `ball_event_career` is `security_invoker` over `ball_event_live` (read-api.mjs:2500 says so) | the away innings do not reach `career_by_season`, `matchups` or `player_shot_points` until the lead restates the view with `security_invoker`, in the same migration |
| **AV-A4** | `app_can()` with a null school and team (a fixture with no away school) returns false without error, as it does for `match_read` today | the away branch is wrapped in `m.away_school_id IS NOT NULL AND …` |
| **AV-A5** | `db/97` is free and `db/99`'s last section on the branch is §72 (`db/99_rls_verify.sql` [branch] :18046–18065) | the numbers move; nothing else |
| **AV-A6** | the seed's `coach.wes@example.invalid` (`smoke-cockpit.mjs:156`) and the walk's `fixture()` already give a Westville-hosted and a Hilton-hosted shared fixture (:135, :137) | the walk seeds them, as it does today |
| **AV-A7** | the policy's extra sub-select on `match` costs what `match_read`'s does; `ball_event_read` runs once per row in the fold | the lead compares `EXPLAIN` before and after on the seed's longest match; if it matters, the two anchors are read once through a `STABLE` helper like `match_team()`, which is a shape change and not a rule change |
| **AV-A8** | no column of `ball_event` is, or will be, a masked column (medical, note, PII) | §9 item 7 fails and the lead decides before the log is widened |

## 12 · What this document does not reopen

The five-day dossier window (D9); the matchup floor (D14); our batter against their named bowler across fixtures (GA-I24-I25 D7); who may score (db/02:228–229); the status-only rule on the cockpit (D4); the no-push rule (D11); the public page (PUBLIC_DATA); the pupil's and parent's reads of their own side (STEP4 §1.2, §2.1, §2.2); `bowler_day`'s gate and shape (PB-D1–D3).
