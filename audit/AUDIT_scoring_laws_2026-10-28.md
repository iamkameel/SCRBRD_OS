# Audit: scoring against the Laws of Cricket

**For:** Kameel · **Date:** 2026-10-28 · **Read-only audit (Fable)** · **Commit audited:** `19f019e` on `claude/scrbrd-os-03vb2m`
**Judged against:** MCC Laws of Cricket, 2017 Code, 4th Edition (2026), as the code names it (`edition.mjs`); the 3rd Edition where the code branches on it; and the project's own stated conditions (free hit by format, SCRBRD-114 documents, the pilot league's decisions of 2026-09-30).

Files read: everything on the brief's reading list. Beyond it, to judge one finding each, I read three lines of `apps/web/src/scorer/sheets.jsx` (892–893, 1053–1055) and one line of `apps/web/src/scorer/pad.jsx` (353), both found by a search for `outAt` and `nbFreeHit`. I also folded fourteen short event logs through the engine with a throwaway script to confirm what I read (`node` against `packages/scoring/src/index.mjs`; nothing in the repository was changed, no test suite was run). Where a finding rests on a file I did not read, it says so.

---

## 1 · Verdict

The arithmetic is sound: runs, extras by type, wickets, balls of the over, the free hit, the bowler's credit and the no-ball/wide dismissal lists all follow the current Code, and the SQL mirrors are held to the engine by construction and by their own proofs. I found nothing that makes a **team total** wrong. What I did find sits one layer down, in the things a total cannot show: **who faces the next ball** after the commonest kind of run out is wrong about half the time and the pad does not ask the question that would settle it; **a two-innings match cannot be scored live** because the Laws check refuses every ball of the third innings as "match decided"; a change of ends **wipes the partnership so far**; and a correction of an older ball makes the engine and the SQL careers **disagree about who faced every ball after it**. The first and third are silent (the scorebook looks plausible); the second is loud. Fourteen findings in all: 3 wrong-flow, 4 wrong-numbers, 7 edge. The top three should be fixed before the pilot; none of them is large.

---

## 2 · Findings, most serious first

### F1 · Run out with no run completed: the fold puts the wrong batter on strike whenever the batters had crossed — WRONG-FLOW (silent)

**Law.** 38.4 (which batter is out: the one whose ground is at the end where the wicket is broken) and 18.12.1.2 (after a run out, the not-out batter returns to the wicket he left *only if the batters had not already crossed*). So after a run out the empty end is the end where the wicket was broken, not the end the dismissed batter started at.

**What the code does.** `replay.mjs:1026–1034`: with `outAt` on the event, the end named empties and the survivor takes the other; **without it, "the dismissed batter's end before the ball" empties** (lines 1031–1034). The pad asks for the end only when runs were completed: `sheets.jsx:893` `asksEnd = isRunOut && runs > 0`, and sends `outAt: asksEnd ? end : null` (`sheets.jsx:1055`). `docs/SCORING_RULES.md:348–351` and `353–355` record this as the design: "a run out with no run completed, which the pad does not ask about — the dismissed batter's end before the ball empties."

**What the Law says.** With no run completed the batters may or may not have crossed. The two commonest school run outs both involve crossing: the striker beaten at the **bowler's** end going for a quick single (the non-striker has reached the striker's end), and the non-striker beaten at the **keeper's** end on the same single (the striker has reached the bowler's end). In both the not-out batter is now at the *other* end from where he started.

**Scenario.** Over 7, ball 3. A on strike, B at the bowler's end. A pushes to cover and runs; B runs too; A is run out at the bowler's end by a direct hit. No run completed. The pad records *run out, A, 0 runs*, is not asked which end, and sends no `outAt`. The fold empties the striker's end and leaves B as non-striker (confirmed: `striker: null, nonStriker: "p2"`). The batting-order sheet puts the new batter C at the striker's end, on strike. On the field B is standing at the striker's end and faces ball 7.4. The scorer either notices and swaps ends (which triggers F3), or ball 7.4 and every ball until the next swap is credited to the wrong batter — on the pad, in the ball log, and in the SQL careers (the pad stamps `striker` from its own fold, `delivery.js:23–27`). The non-striker-run-out mirror case comes out the same way. The laws-spec test pins the un-crossed reading as if it were general (`laws-spec.test.mjs:154–158` "non-striker run out: striker keeps facing").

**Severity:** wrong-flow (who faces), with wrong-numbers downstream in attribution. **Where:** engine (the default), pad (does not ask), SQL (follows the pad's stamp). **Settle it by:** asking the end on every run out — the plumbing exists; `asksEnd` need only drop `&& runs > 0` — or asking "had they crossed?" which is the Law's own question.

### F2 · A two-innings match: every ball of the third innings is refused as "match decided" — WRONG-FLOW (loud)

**Law.** Law 13 (innings): a match is one or two innings a side as agreed; Law 16: the result of a two-innings match is read from all four.

**What the code does.** `laws.mjs:906–907` `decided()`: for any innings that is not a super over, the match is decided when `innings[1].complete === true`. `ballRefusal` asks it first (`laws.mjs:577`) and returns `MATCH_DECIDED`. Nothing reads `format.innings_per_side` here (it is read only by `superOverStartRefusal`, lines 888–892, and by `describeResult`, `replay.mjs:1854–1875`). The `innings_start` of innings 2 is accepted; its first ball is refused. Confirmed by folding a two-innings log with `conditions["format.innings_per_side"] = 2`: the innings_start passes, `lawsRefusal` on the first ball answers `match_decided`.

**What the project says it does.** SCRBRD-114 phase 3a D11 built two-innings results ("an innings and N runs", a draw) in `describeResult`, and `format.mjs` offers "Two-Day" on the fixture screen; `docs/SCORING_RULES.md:195` still lists "No ball once the second innings is complete — the match is decided" as a rule, inherited from the limited-overs-only artifact. The two were never reconciled.

**Scenario.** A Two-Day fixture. Home bat first and declare at 180/6 (sealed `declared`). Away bat and are all out for 140 (sealed `all_out`). Home open their second innings; the pad (which asks the same `lawsRefusal`) blocks the first ball with "the match was already decided", and the server would refuse any client that sent one. The match cannot be scored live. (Only the scorebook importer's `innings_summary` path gets past this, since it is not a `ball`.)

**Severity:** wrong-flow — the pad blocks a lawful ball. **Where:** engine (laws), and so pad and server alike. **Settle it by:** `decided()` reading the scheduled innings (`scheduledInnings()` already exists in the same file) and treating innings 2 and 3 of a four-innings match as live until innings 3 is complete. Related question for Kameel in §5 (whether the pad stamps a `target` on the second innings of a two-innings match; if it does, `inningsOverReason` at `replay.mjs:1395` would end that innings as "target reached" too).

### F3 · A change of ends wipes the partnership so far — WRONG-NUMBERS (silent)

**Law.** Not a Law; a scorebook convention the project follows: a partnership is the runs added while a pair is together (`docs/SCORING_RULES.md:145–150`).

**What the code does.** The `BATTERS` case (`replay.mjs:691–703`) calls `openPartnership()` whenever the event names either batter, including when it names the same two swapped (`line 702`). `openPartnership()` (`lines 604–607`) resets `partnerStartRuns` and `curPartner` to zero **without** `closePartnership()` first. A swap of ends is exactly a `batters` event with the same two swapped, and the Laws check allows it at any time (`laws.mjs:843–851`, "a change of ends ... is always allowed"); it is the pad's correction for who is on strike, and what F1 forces a scorer to use.

**Scenario.** Openers A and B put on 6 (a four and a two). The scorer realises the strike is wrong and swaps ends. A single, then B is bowled at 7/1. The fold records the first-wicket partnership as **1 run off 2 balls**, not 7 off 4 (confirmed: `partnerships: [{runs: 1, balls: 2, wicket: 1}]`). The six runs before the swap belong to no partnership. Every partnership chart, the post-match report and the Match Centre read this.

**Severity:** wrong-numbers (partnerships only; totals and individual figures are right). **Where:** engine. SQL keeps no partnerships. **Settle it by:** in the `BATTERS` case, open a new partnership only when the set of two batters changes.

### F4 · Correcting an older ball by amendment: the engine re-derives who faced every later ball, SQL keeps what the pad stamped — WRONG-NUMBERS (silent)

**Law.** Law 18 (which batter the runs belong to) read with the project's own rule that the fold is the truth and SQL must agree (`docs/SCORING_RULES.md:479–481`).

**What the code does.** The fold ignores a voided event and replays everything after it (`replay.mjs:1185–1206`), tracking the crease itself; it never reads the `striker` on the event (`events.mjs:1519–1531`). SQL's batting figures read the `striker_id` the pad stamped at tap time (`db/87:160–167` `player_innings`, and every career view). The two agree only while the pad's crease at tap time equals the fold's crease on replay. An approved amendment voids an **older** delivery (`docs/SCORING_RULES.md:282–298`), and the project notes "the balls bowled after an amended delivery are not re-judged; whether a correction should re-judge them is a product decision" (`lines 296–298`). What that note does not say is that the fold *does* re-derive them, and SQL does not.

**Scenario.** Ball 1: A takes a single (stamped striker A). Ball 2: B hits four (stamped striker B). After the match an amendment voids ball 1 (it was a dead ball). The fold now has A facing ball 2: A 4 (1), B 0 (0). SQL has B 4 (1) (confirmed: after the void the fold's `ballLog[0].strikerId` is `p1` while the event's `striker` is `p2`; `batsmen` read `p1: 4, p2: 0`). The scorecard on the pad and the Match Centre disagree with the careers, the season views and the milestone trigger, and `smoke-fold-figures` would not see it unless it voids an odd-run ball mid-innings. The same mechanism after a **voided wicket** is worse: the `batters` event that followed it still applies, so the fold shows three batters "batting", one fewer wicket, and a crease that no longer matches the two it names.

**Severity:** wrong-numbers (per-batter figures; the total is unchanged). **Where:** engine vs SQL — they disagree. **Settle it by:** deciding the open question. Either an amendment appends the corrected ball *and* the fold trusts the stamped `striker` where one is present (one rule in both places), or the amendment route re-stamps the events after the void. Until then the amendment route should at least warn when the voided delivery had odd runs or was a wicket.

### F5 · A run out that completed runs off a bye or leg bye credits the runs to the striker and charges the bowler — WRONG-NUMBERS (silent)

**Law.** 18.10.1–18.10.3 and Law 23: runs not off the bat are byes or leg byes, neither the striker's nor debited to the bowler. 38.5 / 18.11: runs completed before a run out are scored.

**What the code does.** A wicket is delivery type `W`, and its `value` is always off the bat: `events.mjs:97` (`OFF_THE_BAT` includes `WICKET`), `events.mjs:230–236` (`runsToBowler` charges a `W`'s value), `replay.mjs:967–970` (`bat.runs += v`, `bowlerCharged = v`). There is no `nbRuns`-style field on a `W`, and the pad's wicket sheet asks only how many runs were completed (`sheets.jsx:1055`). SQL agrees exactly (`db/52:125`: `'W' THEN coalesce(p_value, 0)`), so the parity walk cannot catch it.

**Scenario.** Ball beats the bat and the keeper fumbles; the batters take a bye and go for a second; the non-striker is run out at the keeper's end. One run completed. The pad records *run out, 1 run, out at the striker's end*. The fold gives the striker 1 run off the bat and charges the bowler 1 (confirmed: `batsmen p1: 1 run`, `bowler w1: 1 run`, `extras.bye: 0`). The scorebook should read 1 bye, striker 0, bowler 0. Same for a run out going for a second leg bye.

**Severity:** wrong-numbers (striker's runs, bowler's runs conceded and economy, extras by type; total right). **Where:** engine, pad and SQL together. **Settle it by:** letting a run out carry `nbRuns`-style provenance (off the bat / byes / leg byes), as a no-ball does, and reading it in `runsOffBat()`/`runsToBowler()` and `ball_runs_off_bat()`/`ball_runs_to_bowler()`.

### F6 · An unintentional short run has no input: fewer runs are recorded and the strike is wrong — WRONG-FLOW (silent)

**Law.** 18.5.1: a run is short when a batter fails to make good his ground; that run is not scored, but the batters stay where they are (18.5.1 does not return them; only deliberate short running, 18.5.2, disallows all runs). So "3 run, one short" is 2 runs with the batters at the ends they would be after three.

**What the code does.** Strike rotates by the parity of `value` (`replay.mjs:1050`), which is right whenever runs scored equals runs run. The model has no way to say "N run, M scored": `shortRunning()`/`runsDisallowed()` (`events.mjs:1644–1659`) are the *deliberate* case, every run disallowed and the batters at their original ends (3rd Edition) or a captain's choice (4th). The pad's extras and run keys (`extras.js:27–32`; the run keys are in `engine.jsx`, not read) offer no "one short".

**Scenario.** A drives and the batters run three; the bowler's end umpire signals one short. The scorer records 2. The fold leaves A on strike (even runs); on the field B is on strike (three crossings). Ball-by-ball attribution is wrong until someone swaps ends — and the swap triggers F3.

**Severity:** wrong-flow (strike), wrong-numbers downstream. **Where:** pad (no input), engine (no field). **Settle it by:** a `shortBy` count on the delivery (runs run minus runs scored), with rotation reading runs run; SQL needs nothing, since it reads the stamped striker.

### F7 · "Fours" and "sixes" count any ball worth 4 or 6 off the bat, so overthrows make a six and an all-run four makes a four — WRONG-NUMBERS (convention)

**Law.** Law 19.8 (overthrows: the boundary allowance plus runs completed, plus the run in progress if the batters had crossed). The 4s/6s columns are not in the Laws; scorebook convention counts *boundaries* — the ball reaching or clearing the rope.

**What the code does.** `replay.mjs:974–978` and `949–953`: `if (v === 4) fours += 1; if (v === 6) sixes += 1`. SQL does the same (`db/87:201–204`, `ball_runs_off_bat = 4 / 6`), so the walk agrees. Confirmed: a run ball of 6 records a six.

**Scenario.** A pushes for two and the throw goes to the boundary: 6 runs, correctly. The engine records a **six** for A, and the career and season "sixes" follow. Conversely 3 run plus 4 overthrows (7) is a boundary the columns never see, and an all-run four without the ball reaching the rope is counted as a four. The team total, the batter's runs and the bowler's runs are all right.

**Severity:** wrong-numbers, but in the boundary columns only, and a convention rather than a Law. Matters because SCRBRD publishes records and honours (most sixes). **Where:** engine and SQL together. **Settle it by:** a `boundary: 4 | 6 | null` field the pad sets from the shot, read by both; or accept the convention and say so in the rulebook.

### F8 · Obstructing the field: completed runs are dropped, and the non-striker cannot be the one out — EDGE

**Law.** 37.1.1: either batter may be out Obstructing the field. Law 37, runs scored (37.6 in the 2017 Code): runs completed before the offence are scored, except where the obstruction prevented a catch (37.5.2, no runs).

**What the code does.** The wicket sheet asks "who" for obstructing the field only on a wide or a no-ball (`sheets.jsx:892`), and sends `runs: isRunOut ? runs : 0` (`sheets.jsx:1055`): an obstruction on an ordinary delivery is always the striker's and always 0 runs. The fold would accept both (`dismissed`, `value`). `docs/laws/CLAUSE_CHECK.md:469–470` already records the non-striker gap.

**Scenario.** The batters complete one run; the non-striker, going for a second, deliberately changes course and blocks the throw; umpire gives him out obstructing. The pad can only record the **striker** out, with **0** runs.

**Severity:** edge (rare at school level). **Where:** pad. **Settle it by:** asking "who" and "runs completed" on every obstruction, as on a run out.

### F9 · Bowled off a free hit with runs taken: the runs are the striker's and the bowler's, and the strike does not rotate — EDGE

**Law.** The free hit is a playing condition (the ICC's: off a free hit the striker is out only run out, obstructing, hit twice; runs off a bowled free hit are scored as byes and the ball is not dead).

**What the code does.** A saved `W` keeps its type, so `type !== WICKET` stops rotation (`replay.mjs:1050`) and `value` is credited off the bat (`replay.mjs:967–970`). Confirmed: no-ball, then `W bowled, value 1` → striker credited 1, bowler charged 2, strike not rotated. On the pad this cannot be built — the sheet sends 0 runs for anything but a run out — so the scorer's only honest records are "bowled, 0" (the byes vanish) or "1 bye" (the recorded appeal vanishes, against product decision 1 of 2026-09-24).

**Severity:** edge (free hits only, and the batters must run). **Where:** pad (no way to record), engine (would score it wrong if told). **Settle it by:** allowing byes on a wicket ball that the free hit saved, or documenting "record it as byes".

### F10 · A chase abandoned with a par score: a winning chase is given "by N wickets" — EDGE (words)

**Law/condition.** Law 16 leaves the margin to the conditions. Under DLS conditions a curtailed chase ahead of par is a win **by the runs it is ahead of par**, not by wickets in hand.

**What the code does.** `replay.mjs:1882–1891`: `b.runs > b.par → win(b, WICKETS, inHand(b))`; level a tie; behind, the first side by `par - runs`. `match_result_compute()` mirrors it (db/73, not read).

**Scenario.** Chasing 181, rain ends it at 15 overs with the side on 120/3 and the umpires' par 112. The result should read "won by 8 runs (DLS)"; the code says "won by 7 wickets (DLS)".

**Severity:** edge; words and the margin, not the winner. I am not certain which margin the pilot's conditions use (§5). **Where:** engine and the SQL mirror.

### F11 · A delivery that does not count in the over (17.3.2.5) consumes a free hit — EDGE

**Law/condition.** Law 17.3.2.5 says the delivery is not one of the over. The free hit condition is for "the next delivery"; whether a delivery that does not count spends it is not stated anywhere I can point to.

**What the code does.** `replay.mjs:1058`: the free hit is consumed by any fair delivery, `notInOver` included (the comment chooses this deliberately). Confirmed: no-ball, then a fair delivery marked `illegal_fielding` → `freeHit: false`, `balls: 0`. SQL's `ball_on_free_hit()` (`db/54:267–276`) reads the same, so the two agree.

**Severity:** edge; a choice the conditions leave open, made consistently. Record it as decided, or change both together.

### F12 · The no-ball panel's free-hit note appears only for a waist-high full toss or a beamer — EDGE (words on the pad)

**What the code does.** `extras.js:54` `nbFreeHit = type === "height" || type === "beamer"`, used at `pad.jsx:353` (`freeHits && nbFreeHit(nb.type) && ...`; I read that one line). The fold gives a free hit after every no-ball in a limited-overs match (`replay.mjs:1058`), and `docs/SCORING_RULES.md:714–719` says the banner reads the fold. So the engine is right; the panel under-tells the scorer for a front-foot no-ball, the commonest kind. The post-ball banner (not read) may make this moot.

**Severity:** edge, words only. **Where:** pad.

### F13 · Fall of wickets on the last ball of an over is written "5.0", not "4.6" — EDGE (cosmetic)

`replay.mjs:1021–1024` uses `fmtOvers(inn.balls)` after the ball has been counted, so a wicket on the sixth ball of the fifth over prints 5.0. Both notations exist; most published scorecards use 4.6. Same at `replay.mjs:817` for a non-ball wicket. No figure is wrong.

### F14 · A ball released from quarantine lands at the end of the server's fold, not where it was bowled — EDGE (unverified beyond the design text)

`docs/SCORING_RULES.md:261–280` describes a held ball released later at a later `seq`; `MatchFold` folds in `seq` order (`replay.mjs:1685–1699`) and places the ball's runs against whoever the fold has at the crease *then*, while SQL reads the stamped `striker_id`. Totals agree (which is all the handover check compares); per-batter figures in the server's own fold (`replayEvents`, `innings_result_state`) would not. I did not read the release path (`events-api.mjs`, db/33/37) and cannot say how often it happens; raised so the parity walk can include a release.

---

## 3 · What I checked and found right

- **No-balls (21).** One run, debited to the bowler; runs off the bat the striker's and the bowler's; byes and leg byes off a no-ball scored as byes/leg byes, not the bowler's (21.15, 18.10.2–3, the 4th Edition's reading) — `runsOffBat()`/`runsToBowler()` (`events.mjs:213–236`), the fold (`replay.mjs:935–955`) and `ball_runs_off_bat()`/`ball_runs_to_bowler()` (db/52) agree, and db/52's proof pins the table. Not a ball of the over; a ball faced; odd runs rotate. Dismissals off a no-ball: run out, hit twice, obstructing only (21.17) — constructor, Laws check and the database door (db/87) all refuse others.
- **Wides (22).** One run plus runs run, all wides, to the bowler; a wide to the rope is 5; not a ball of the over; not a ball faced; odd runs rotate. Dismissals off a wide: run out, stumped, hit wicket, obstructing (22.9); stumped and hit wicket the bowler's. A wide on a free hit carries it; a stumping off a wide on a free hit is saved.
- **Byes and leg byes (23).** Not the bowler's; a ball faced; rotate on odd runs.
- **Free hit (condition).** Set by any no-ball in a limited-overs match, not in a declaration/timed match (`format.mjs`, `conditions.mjs`, `free_hits_apply()`); renewed by a no-ball, carried over a wide, consumed by the next fair delivery; saves every dismissal but run out, obstructing, hit twice (and the non-delivery ones) — one set decides both the free hit and the bowler's credit (`events.mjs:290–297`), and `ball_wicket_stands()` is the same rule in SQL.
- **Bowler's credit (32–40).** Bowled, caught, lbw, stumped, hit wicket his; run out, obstructing, handled (legacy), hit twice, timed out, retired out not. `dismissed` names the non-striker where needed; a wicket with no method is nobody's.
- **Crossing on a caught dismissal (18.12.1.1, 2017 Code).** The striker's end empties and the incoming batter faces; on the last ball of an over the change of ends then puts him at the non-striker's end — exactly right (`replay.mjs:1031–1034, 1051`; laws-spec group C).
- **Run out with runs completed and `outAt`.** The named end empties, the survivor takes the other, then the over's change of ends (laws-spec group E). Right whenever the end is asked.
- **Overs (17).** Wides and no-balls do not advance the over; a delivery under 24.4/28.2/41.4/41.5 does not count (17.3.2.5), in JS and SQL (`ball_counts_in_over()`); the bowler is cleared at the over's end; no bowler bowls two overs or parts of two running (17.6), including both men who shared an over (17.8); a mid-over change needs injury or suspension (17.7.1). Maidens exclude byes and leg byes, include wides/no-balls, and are nobody's for a split over.
- **Penalty runs (41.17, 18.6).** Extras, no ball counted, to the side that did not offend (`PENALTY_REASON_SIDE`); to the fielding side they go to its most recently completed innings or open its next, within a super-over pair (`penaltyCredits()`, `penalty_credit_as_folded()`); a chase's target rises with them unless the umpires typed it; under the 4th Edition an award after the result stands and can reopen a chase or win it "by penalty runs" (16.7); under the 3rd it is refused. The reason list matches CLAUSE_CHECK's 4th-Edition sweep.
- **Retirements (25.4).** Retired hurt not out, may resume only at a wicket or another retirement (25.4.4); retired out a wicket with no ball, resumes only with the opposing captain's consent (25.4.3), the wicket taken back in JS and in SQL (db/53). Timed out (40) the incoming batter, a wicket with no ball, only while an end is empty after a wicket or retirement.
- **Suspensions (41.6–41.9, 41.13, 21.3.2, 42).** Scoped by Edition; the replacement bound by 17.6/17.8; suspended bowlers refused for the innings or the match.
- **Undo.** A void is a skip, never a subtraction (`replay.mjs:1185–1206`), so the fold after an undo of the latest event equals the fold without it, exactly; `MatchFold` refolds on a void and the incremental fold is tested against the full one (laws.test group I). Last-in-first-out is enforced on the server as on the pad.
- **Result (16).** Judged against the target (revised or first innings plus one); tie at target minus one; a chase sealed `abandoned` is no result unless a par was given; `result.min_overs_per_side` where set; a super over's structure (after a tie, numbered in order, two wickets end it, never revised) and its exclusion from careers and the table.
- **Edition dating.** By the fixture's start in SAST, else the log's first event; one Edition per match.
- **SQL mirrors.** `ball_runs_off_bat`, `ball_runs_to_bowler`, `ball_counts_in_over`, `ball_is_wicket`, `ball_wicket_stands`, `ball_on_free_hit`, `free_hits_apply`, `penalty_*_as_folded`, `innings_target_as_folded`, `retirement_resumed`: each is the JS rule restated, each file's proof pins the rule's table against the JS test's table, and totals/balls/wickets agree with the fold on every lawful log I could think of.

---

## 4 · What I did not check, and why

- **The DLS calculator and its tables** (`dls.mjs` beyond its interface; the published table rows): out of the brief.
- **The pad's screens** (`engine.jsx`, `sheets.jsx`, `pad.jsx`, the batting-order and super-over sheets) beyond the four lines named above: not on the list. So I cannot say which run values the pad offers, whether it stamps a `target` on the second innings of a two-innings match (F2), or what the post-ball free-hit banner shows (F12).
- **The server's write, release and amendment paths** (`services/api/write/events-api.mjs`, db/33, db/37, db/38) and `readiness.mjs`: not on the list; F4 and F14 describe what the engine and SQL would do with what those paths write, not the paths themselves.
- **The result and standings SQL** (db/69, db/71, db/73 `match_result_compute()`, NRR) and `tools/smoke-fold-figures.mjs`'s generator: not on the list; F10's SQL half is inferred from the design text.
- **Commentary, phases, the public page, the Match Centre, recognition**: readers of the fold, not the fold.
- **3rd-Edition behaviour** beyond what `edition.mjs` branches on: the pilot is dated after 1 October 2026.
- **Primary-school conditions** (balls-per-over caps, compulsory retirement): recorded as reserved keys, read by nothing; out of scope by the project's own note.

---

## 5 · Questions only Kameel can answer

1. **Does the pilot score any two-innings (Two-Day) matches live?** If yes, F2 is a blocker; if the format is only ever imported from the book, F2 can wait. Either way `decided()` and `docs/SCORING_RULES.md:195` should say which.
2. **Which free-hit condition applies to the pilot league?** The code gives a free hit after *every* no-ball (the ICC's rule since 2015). If CSA schools' conditions give it only for a front-foot no-ball, `inn.freeHit` at `replay.mjs:1058` needs the `nbType`, and F12's hint would then be right as it stands.
3. **The DLS/par result margin (F10):** does the pilot play under DLS at all, and if so does its condition state a curtailed chase's win in runs ahead of par (the ICC's) or in wickets?
4. **The 4s/6s convention (F7):** boundaries only, or any ball worth four or six? SCRBRD's records and honours depend on the answer.
5. **Amendments (F4):** the documented open decision — should a correction of an older ball re-judge and re-stamp the balls after it? The engine already re-derives them; SQL does not. One of the two has to move.
6. **Should the pad ask "out at which end?" on every run out (F1)?** My recommendation is yes; it is one tap and the Laws' own question. The alternative, "had they crossed?", is the same question in other words.
7. **A short run (F6):** is a "one short" key worth the pad real estate, or is the convention "record the runs and swap ends by hand" acceptable with F3 fixed?
8. **Fall-of-wickets notation (F13):** 4.6 or 5.0.
9. **F11:** should a delivery that does not count in the over spend the free hit? The code says yes; record the decision either way.

---

## 6 · Kameel's decisions (28 Oct)

Word for word from the board:

- **Q1 Two-Day:** scored live, fixed before the pilot (F2: `laws.mjs` `decided()` refuses the third innings; `SCORING_RULES.md:195` still states the limited-overs rule).
- **Q2 Free hit:** after front-foot no-balls only (the code gives one after every no-ball: `inn.freeHit` at `replay.mjs` ~1058 needs the `nbType`; F12's pad note then becomes right).
- **Q3 / Q8 / Q9, ICC conventions:** a curtailed chase under DLS/par is won "by N runs" ahead of par (F10); a wicket on the last ball of the 5th over is written 4.6 (F13); a ball that doesn't count in the over keeps the free hit for the next (F11).
- **Q4 Fours and sixes:** boundaries only (F7): an all-run four isn't a four; overthrows don't make a six.
- **Q5 Amendments:** re-work it. The server follows the corrected order (F4): when an older ball is corrected, the balls after it are re-judged for who faced, and SQL must agree with the engine's re-derivation instead of trusting the pad's stamped `striker_id`.
- **Q6:** ask "out at which end?" on every run out (F1: `sheets.jsx` `asksEnd = isRunOut && runs > 0` → drop the `runs > 0`).
- **Q7:** no "one short" key (F6): recording the runs made and swapping ends by hand is the convention, which needs F3 fixed.

Plain bugs, no decision needed: F3 (a swap of ends wipes the partnership), F5 (a run out that completed a bye or leg bye credits the run to the striker and the bowler, in engine, pad and SQL), F8 and F9 as described above where the fix is clear.
