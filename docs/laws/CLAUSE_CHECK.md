# Law clause check (2026-09-27)

Every MCC Law clause the codebase cites, checked against the current Code. This is research only. No code was changed.

## Summary

**Edition read:** the MCC Laws of Cricket, **2017 Code, 3rd Edition (2022)**, as published Law by Law on lords.org
(`https://www.lords.org/mcc/the-laws/...`). This edition is in force until 30 September 2026. The **2017 Code, 4th Edition
(2026)** comes into force on **1 October 2026**, four days from today. I could not read its full text. What this report
says about it comes from MCC's own change summaries (links under "Sources").

**How it was read:** a direct fetch of www.lords.org was **blocked by this session's network egress proxy**. Every clause
below was checked through web searches limited to lords.org, which return text taken from MCC's Law pages and PDFs.
Quotations are as those searches returned them: close paraphrase, occasionally verbatim. Each row gives the page URL.
Before changing any wording, spot-check the WRONG rows on the page itself. It takes a minute a row.

**Counts:** 34 distinct citations (a clause number cited for one meaning). **21 CORRECT, 13 WRONG, 0 UNVERIFIED**
against the 3rd Edition. Against the 4th Edition, clause numbering is confirmed only for Law 41's penalty runs (41.17).
Everything else is **UNVERIFIED for the 4th Edition**. The 4th Edition may renumber Law 21, because a bouncer over head
height moves from No ball to Wide.

**The wrong ones, with the right numbers:**

| Cited | Used for | Right clause |
|---|---|---|
| 17.8 | no bowler bowls two overs, or parts of two, in a row (the general rule) | **17.6** (17.8 is right only for the replacement who finishes an over) |
| 17.8.1 | a bowler may be replaced during an over only if incapacitated or suspended | **17.7.1** (must finish the over unless incapacitated or suspended) and **17.8** (another bowler finishes it). There is no 17.8.1. |
| 21.6 | runs off the bat from a no-ball are the striker's | **21.16** (21.6 is "Bowler breaking wicket in delivering ball") |
| 21.19 | the ways out off a free hit | No such clause. Law 21 ends at **21.18** "Out from a No ball". The free hit is a playing condition, not a Law. |
| 25.4.2 (in the backlog, for the resume rule) | a retired batter resumes only at the fall of a wicket or the retirement of another batter | **25.4.4** |
| 38.2 | which batter is out on a run out: the end where the wicket was put down | **38.4** "Which batter is out" (38.2 is "Batter not Run out") |
| 41.1 | `unfair_play`: dangerous or unfair play (5 to the batting side) | **41.2** (41.2.2: an unfair action not covered by the Laws). 41.1 is the captains' responsibility and carries no penalty. |
| 41.4 | `obstruction_distraction`: the batting side distracting, deceiving or obstructing fielders (5 to the fielding side) | No Law 41 clause. 41.4 is a **fielder** distracting the striker (5 to the batting side). A batter who obstructs fielders is out under **Law 37**. |
| 41.5 | `short_running`: deliberate short running | **18.5** (18.5.1/18.5.2). 41.5 is a fielder distracting, deceiving or obstructing a batter. |
| 41.12 | `pitch_damage`: a batter damaging the pitch (5 to the fielding side) | **41.14** "Batter damaging the pitch". 41.12 is the **fielder** damaging the pitch. |
| 41.15 | `striking_pitch`: striking the pitch unfairly | No such offence. 41.15 is "Striker in protected area" (taking guard in or near it). A batter damaging the pitch is **41.14**. |
| 41.17 | `time_wasting`: a batter wasting time | **41.10** "Batter wasting time". 41.17 is Penalty runs. |
| 41.18 | penalty runs; the fielding side's five go to its last completed innings, or its next | **41.17** (41.17.4 for the fielding side's award). It was 41.18 in the 1st and 2nd Editions. It is 41.17 in both the 3rd and the 4th. |

**41.13 against 41.14, settled: both are right, for different offences.** **41.13** is the *bowler* running on the
protected area after delivering the ball: a caution, then a final warning, then suspension from bowling for the innings.
That is the right number for `SUSPENSION_REASON.protected_area`. **41.14** is the *batter* damaging the pitch, which
includes being on the protected area without reasonable cause: a first and final warning, then 5 penalty runs to the
fielding side. That is the right number for `PENALTY_REASON.protected_area`. The two earlier research passes were each
right about a different offence. The comment at `events.mjs:406-407` can be resolved that way.

**The most important behaviour mismatches** (full list at the end):

1. **Byes and leg byes off a no-ball.** The current 21.16 scores them as byes or leg byes, and only the one-run no-ball
   penalty is debited to the bowler. The code scores them as no-ball extras and debits all of them to the bowler. That
   is the 2000 Code's rule.
2. **Resuming after retiring hurt (25.4.4).** The server lets him back at any empty end. The pad only avoids offering
   him straight back into his own vacancy.
3. **Retired out (25.4.3).** The Law lets him resume with the opposing captain's consent. The code never does.
4. **The penalty-reason list** puts two fielding-side offences (41.4/41.5, 41.12) on the batting side's list. It
   includes one offence that does not exist ("striking the pitch"). It leaves out batters stealing a run (41.16).
5. **"Handled the ball"** is still offered as a way out. It was removed in the 2017 Code and folded into Obstructing the
   field (Law 37).
6. **From 1 October 2026 (4th Edition):** a deliberate front-foot no-ball (41.8) suspends the bowler for the whole
   match, not the innings. `SUSPENSION_REASON_SCOPE` says innings.

---

## Law 2: The umpires

| Cited | Where (file:line) | What the code does there | What the Law says | Verdict |
|---|---|---|---|---|
| 2.7 | db/08_schema_programme.sql:1434 | Comment: whether a match goes ahead is the umpires' call | 2.7 "Fitness of ground, weather and light": it is solely for the umpires together to decide whether conditions make play dangerous or unreasonable. https://www.lords.org/mcc/the-laws/the-umpires | CORRECT |

## Law 17: The over

Source: https://www.lords.org/mcc/the-laws/the-over

- **17.6 Bowler changing ends:** a bowler may change ends as often as desired, "provided he/she does not bowl two overs
  consecutively, nor bowl parts of each of two consecutive overs, in the same innings."
- **17.7.1:** "Other than at the end of an innings, a bowler shall finish an over in progress unless incapacitated or
  suspended under any of the Laws."
- **17.8 Bowler incapacitated or suspended during an over:** the umpire calls Dead ball. "Another bowler shall complete
  the over from the same end, provided that he/she does not bowl two overs consecutively, nor bowl parts of each of two
  consecutive overs, in that innings." 17.8 has no sub-clauses. There is no 17.8.1.
- 4th Edition: MCC lists only a wording correction to 17.5.2 for Law 17. The numbers of 17.6, 17.7.1 and 17.8 are
  UNVERIFIED for the 4th Edition.

The code's quotation "a bowler shall not bowl two overs, or parts thereof, consecutively" (laws.mjs:472) is older
wording. The meaning is the same.

### 17.8, the general rule (no two overs, or parts of two, in a row). Verdict: WRONG, should be 17.6

| Where | What the code does there |
|---|---|
| packages/scoring/src/laws.mjs:74 | `REFUSAL.CONSECUTIVE_OVERS`: "not two overs, or parts, running" |
| packages/scoring/src/laws.mjs:199 | `bowledLastOver()` check run on every `bowler` event |
| packages/scoring/src/laws.mjs:472 | doc of `bowledLastOver()`, with the quotation above |
| packages/scoring/test/laws.test.mjs:332 | test: a wicket with no ball does not move the over, so the rule reads the same |
| packages/sync/test/held.test.mjs:61, 85, 248 | test: the same bowler named for the next over is refused |
| apps/web/src/scorer/sheets.jsx:806 | new-over sheet: "Can't bowl consecutive overs" (asks `lawsRefusal`) |
| docs/SCORING_RULES.md:189, 232 | rule table: "No bowler bowls two overs, or parts of two, running" |

### 17.8, the replacement who finishes an over. Verdict: CORRECT

| Where | What the code does there |
|---|---|
| packages/scoring/src/events.mjs:755 | `BOWLER_CHANGE_REASON` doc: the one who finishes may not have bowled the previous over or bowl the next |
| packages/scoring/src/events.mjs:794 | `bowlerSuspended()` doc: the replacement's two rules |
| packages/scoring/src/commentary.mjs:68 | `BOWLER_CHANGE`: a bowler taking over during an over |
| packages/scoring/test/laws.test.mjs:226, 382, 564 | tests: a mid-over change bars both men from the next over; the replacement may not have bowled the previous one |
| apps/web/src/scorer/engine.jsx:1437, 1439 | pad asks `lawsRefusal` for a mid-over replacement |
| docs/SCORING_RULES.md:415, 615 | mid-over change and suspension: "or parts thereof" |

### 17.8.1. Verdict: WRONG, should be 17.7.1 (and 17.8)

The substance matches the Law: a change during an over only for an incapacitated or suspended bowler. Only the number
is wrong.

| Where | What the code does there |
|---|---|
| packages/scoring/src/events.mjs:752 | `BOWLER_CHANGE_REASON` (injury, suspended) |
| packages/scoring/src/replay.mjs:168 | `isMidOver()` doc |
| packages/scoring/src/laws.mjs:75 | `REFUSAL.MID_OVER_NO_REASON` |
| packages/scoring/src/laws.mjs:122 | comment above `REFUSAL_TEXT.mid_over_no_reason` |
| packages/scoring/src/laws.mjs:204 | the check that refuses a mid-over change with no reason |
| packages/scoring/test/laws.test.mjs:228, 229 | test: accepted with a reason, refused without |
| apps/web/src/scorer/sheets.jsx:787 | new-over sheet asks "injury or suspended" mid-over |
| docs/SCORING_RULES.md:190, 325, 407 | rule table and SCRBRD-080 write-up |

Behaviour: matches. `bowledLastOver()` bars the man who left and the man who finished from the next over, which is
what 17.6 and 17.8 require.

## Law 18: Scoring runs

Source: https://www.lords.org/mcc/the-laws/scoring-runs

- **18.5 Deliberate short running.** 18.5.1: the umpire calls and signals Short run and applies 18.5.2. 18.5.2: the
  bowler's end umpire shall "disallow all runs to the batting side; return any not out batter to his/her original end;
  signal No ball or Wide to the scorers if applicable; award 5 Penalty runs to the fielding side", together with any
  other applicable 5-run penalty except under 28.3, and inform the scorers and the captains.
- 4th Edition: MCC notes a clarification that batters may turn back and abandon a run without penalty. Deliberate short
  running must be an attempt to deceive. No renumbering was found (UNVERIFIED for the 4th Edition).

| Cited | Where | What the code does there | Verdict |
|---|---|---|---|
| 18 | packages/scoring/src/events.mjs:123; packages/scoring/src/replay.mjs:616; apps/web/src/scorer/sheets.jsx:650; packages/scoring/test/laws-spec.test.mjs:213; docs/SCORING_RULES.md:343 | With runs completed before a run out the batters have crossed, so the pre-ball crease does not say which end is empty | CORRECT at the level of the Law (Law 18 is Scoring runs). The precise "whose ground is whose" rule is Law 30.2. I did not verify that number. |
| 18.5 | packages/scoring/src/events.mjs:278 | `PENALTY_REASON.SHORT_RUNNING` comment "41.5 (and 18.5)" | CORRECT (18.5 is the clause; the 41.5 half is wrong, see Law 41) |
| 18.5.2 | packages/scoring/src/events.mjs:1053, 1064; packages/scoring/src/laws.mjs:304; packages/scoring/test/replay.test.mjs:1373; docs/SCORING_RULES.md:557 | `shortRunning()`: the delivery with no runs, batters at their original ends, the no-ball or wide penalty stands, 5 to the fielding side | CORRECT. Behaviour matches 18.5.2. |

## Law 21: No ball

Source: https://www.lords.org/mcc/the-laws/no-ball

- **21.6** is "Bowler breaking wicket in delivering ball".
- **21.16 Runs resulting from a No ball, how scored:** "The one run penalty for a No ball shall be scored as a No ball
  extra and shall be debited against the bowler. Any runs completed by the batters or any boundary allowance shall be
  credited to the striker if the ball has been struck by the bat; otherwise they shall also be scored as Byes or Leg
  byes as appropriate."
- **21.18 Out from a No ball:** neither batter is out except under Law 34 (Hit the ball twice), 37 (Obstructing the
  field) or 38 (Run out).
- There is no 21.19. The **free hit is not in the MCC Laws**. It is a playing condition (ICC, or the competition's).
- 4th Edition: "a bouncer over head height will now be a Wide in Law, not a No ball", so today's 21.10 leaves Law 21.
  Whether the later clauses are renumbered is **UNVERIFIED**.

| Cited | Where | What the code does there | Verdict |
|---|---|---|---|
| 21 | packages/scoring/src/events.mjs:108; packages/scoring/src/replay.mjs:543; apps/web/src/scorer/sheets.jsx:61; packages/scoring/test/laws-spec.test.mjs:174; db/99_rls_verify.sql:3454; docs/SCORING_RULES.md:368 | Byes and leg byes off a no-ball are no-ball extras, and every run of a no-ball is debited to the bowler | CORRECT Law number (the clause is 21.16). The behaviour does **not** match the current 21.16. See mismatch 1. |
| 21.6 | packages/scoring/src/events.mjs:98; docs/SCORING_RULES.md:331 | Runs off the bat from a no-ball are the striker's (`NB_RUNS` absent) | **WRONG, should be 21.16** |
| 21.19 | packages/scoring/src/events.mjs:210; packages/scoring/test/phases.test.mjs:270 | `NON_DELIVERY`: the ways out that stand on a free hit (run out, handled, obstructing, hit twice) | **WRONG.** No 21.19 exists. The nearest Law is 21.18 (out from a no-ball: hit twice, obstructing, run out). The free hit comes from the playing conditions and should be cited as such. |

## Law 23: Bye and Leg bye

Source: https://www.lords.org/mcc/the-laws/bye-and-leg-bye

23.1: if the ball, not being a Wide, passes the striker without touching bat or person, runs completed or a boundary
allowance are credited as Byes. 23.2: runs off the person are Leg byes if the conditions in 23.2.1 are met. The
lords.org search text adds: if Byes or Leg byes accrue from a No ball, only the one-run penalty is scored as a No ball
and the remainder as Byes or Leg byes.

| Cited | Where | What the code does there | Verdict |
|---|---|---|---|
| 23 | packages/scoring/src/events.mjs:105; apps/web/src/scorer/sheets.jsx:60; packages/scoring/test/laws-spec.test.mjs:174; docs/SCORING_RULES.md:331 | Runs off a no-ball not off the bat are not the striker's, and are scored as no-ball extras | CORRECT Law number. The first half matches. The second half ("no-ball extras") does not. See mismatch 1. |

## Law 25: Batter's innings; runners

Source: https://www.lords.org/mcc/the-laws/batsman-s-innings;-runners

- **25.4.2:** "If a batter retires because of illness, injury or any other unavoidable cause, that batter is entitled
  to resume his/her innings. If for any reason this does not happen, that batter is to be recorded as 'Retired – not
  out'."
- **25.4.3:** "If a batter retires for any reason other than as in 25.4.2, the innings of that batter may be resumed
  only with the consent of the opposing captain. If for any reason his/her innings is not resumed, that batter is to
  be recorded as 'Retired – out'."
- **25.4.4:** "If after retiring a batter resumes his/her innings, subject to the requirements of 25.4.2 and 25.4.3,
  it shall be only at the fall of a wicket or the retirement of another batter." **This is the resume rule.**
- 4th Edition: MCC lists changes to 25.6.5 and 25.8. No change to 25.4 was found (UNVERIFIED for the 4th Edition).

| Cited | Where | What the code does there | Verdict |
|---|---|---|---|
| 25.4 | docs/SCORING_RULES.md:196 | Rule table: a batter dismissed or retired out does not come back; retired hurt may | CORRECT |
| 25.4.2 | packages/scoring/src/events.mjs:167; packages/scoring/src/replay.mjs:299; packages/scoring/src/laws.mjs:430, 454; packages/scoring/test/laws.test.mjs:221; apps/web/src/scorer/retire.js:2; apps/web/src/scorer/sheets.jsx:498; apps/web/src/scorer/engine.jsx:1476; docs/SCORING_RULES.md:633 | Retired hurt is not out and may resume; the fold puts him back on his old line | CORRECT |
| 25.4.2 (for the resume-only-at-a-wicket rule) | audit/SCRBRD_IMPLEMENTATION_BACKLOG.md:2943 | Backlog note: "Not modelled: Law 25.4.2's 'only at the fall of a wicket or the retirement of another batter'" | **WRONG, should be 25.4.4** |
| 25.4.3 | packages/scoring/src/events.mjs:167, 1095; packages/scoring/src/laws.mjs:397, 429; packages/scoring/test/laws.test.mjs:223 | Retired out is a dismissal with no ball, and the batter may not return | CORRECT number. The behaviour differs (consent to resume). See mismatch 3. |

## Law 28: The fielder

Source: https://www.lords.org/mcc/the-laws/the-fielder

- **28.2 Fielding the ball:** fielding the ball illegally means, while the ball is in play, wilfully using anything
  other than part of the person, extending clothing with the hands to field it, or discarding clothing or equipment that
  then touches the ball. The ball is dead and 5 Penalty runs are awarded.
- **28.3 Protective helmets belonging to the fielding side:** a helmet not in use may be placed on the ground only
  behind the wicket-keeper, in line with both sets of stumps. If the ball in play strikes it, the ball is dead and
  5 Penalty runs are awarded.

| Cited | Where | What the code does there | Verdict |
|---|---|---|---|
| 28.2 | packages/scoring/src/events.mjs:286, 321; docs/SCORING_RULES.md:569 | `PENALTY_REASON.ILLEGAL_FIELDING`, 5 to the batting side | CORRECT |
| 28.3 | packages/scoring/src/events.mjs:285, 320; docs/SCORING_RULES.md:569 | `PENALTY_REASON.HELMET_STRUCK`, 5 to the batting side | CORRECT |

## Law 36: Leg before wicket

| Cited | Where | What the code does there | Verdict |
|---|---|---|---|
| 36 | db/08_schema_programme.sql:2641, 2673; apps/web/src/data/roadmap.js:65; docs/redesign/SCREEN_MAP.md:122 | The review panel's LBW components (pitched, impact, hitting) | CORRECT. Law 36 is LBW. https://www.lords.org/mcc/laws-of-cricket/laws/law-36-leg-before-wicket/ |

## Law 38: Run out

Source: https://www.lords.org/mcc/the-laws/run-out

- **38.2** is "Batter not Run out": the exceptions, such as a batter who was in the ground and left it to avoid injury.
- **38.4 Which batter is out:** "The batter out in the circumstances of 38.1 is the one whose ground is at the end
  where the wicket is put down."
- 4th Edition: MCC lists changes to the order of an umpire's actions in Law 38. Numbering is UNVERIFIED.

| Cited | Where | What the code does there | Verdict |
|---|---|---|---|
| 38.2 | packages/scoring/src/events.mjs:122; packages/scoring/src/replay.mjs:617; apps/web/src/scorer/sheets.jsx:651; packages/scoring/test/laws-spec.test.mjs:215; docs/SCORING_RULES.md:329, 339 | `RUN_OUT_END` / `outAt`: the end the wicket was put down at is the one left empty; the survivor is at the other | **WRONG, should be 38.4.** The behaviour matches 38.4. |

## Law 40: Timed out

Source: https://www.lords.org/mcc/the-laws/timed-out

**40.1.1:** "After the fall of a wicket or the retirement of a batter, the incoming batter must, unless Time has been
called, be ready to receive the ball, or for the other batter to be ready to receive the next ball within 3 minutes of
the dismissal or retirement. If this requirement is not met, the incoming batter will be out, Timed out." 40.1.2
covers an extended delay (Law 16.3). The bowler does not get credit.

| Cited | Where | What the code does there | Verdict |
|---|---|---|---|
| 40 | packages/scoring/src/events.mjs:168, 1095; packages/scoring/src/laws.mjs:401; packages/scoring/test/laws.test.mjs:318; apps/web/src/scorer/sheets.jsx:480, 644; docs/SCORING_RULES.md:199, 441 | Timed out is the incoming batter's, a wicket with no ball, offered only while an end is empty after a wicket or a retirement, never for openers | CORRECT. The behaviour matches. |
| 40.1 | packages/scoring/src/laws.mjs:399 | The same rule, in `offBallDismissalRefusal()` | CORRECT (40.1.1 is the exact sub-clause) |

## Law 41: Unfair play

Source: https://www.lords.org/mcc/the-laws/unfair-play (3rd Edition). The clause titles as the lords.org text gives them:

| Clause | Title (3rd Edition) | Who offends, who gets the 5 |
|---|---|---|
| 41.1 | Fair and unfair play: responsibility of captains | none (no penalty) |
| 41.2 | Fair and unfair play: responsibility of umpires. 41.2.2: an unfair action not covered by the Laws, first and final warning to the side, then 5 to the opponents | either side |
| 41.3 | The match ball: changing its condition. First instance: 5 to the opposing side. A further instance in the match by the fielding side also suspends the bowler of the preceding ball **for the match** | either side |
| 41.4 | Deliberate attempt to distract striker (by a fielder). 4th Edition: "Deliberate attempt to distract or obstruct striker" | fielding side offends, 5 to batting side |
| 41.5 | Deliberate distraction, deception or obstruction of batter (by a fielder) | fielding side offends, 5 to batting side |
| 41.6 | Bowling of dangerous and unfair short pitched deliveries. Caution, final warning, then suspension for the innings | bowler |
| 41.7 | Bowling of dangerous and unfair non-pitching deliveries (above waist height). Caution and warning (41.7.3), dispensed with if deliberate | bowler |
| 41.8 | Bowling of deliberate front foot No ball. Suspended at once, for the innings (**the match from 1 Oct 2026**) | bowler |
| 41.9 | Time wasting by the fielding side. Warning, then 5 to the batting side. Waste during an over leads to suspension of the bowler for the innings | fielding side |
| 41.10 | Batter wasting time. Warning, then 5 to the fielding side | batting side |
| 41.11 | The protected area (definition) | none |
| 41.12 | Fielder damaging the pitch. Warnings, then 5 to the batting side | fielding side |
| 41.13 | Bowler running on the protected area after delivering the ball. Caution, final warning, then suspension for the innings | bowler |
| 41.14 | Batter damaging the pitch, including presence on the pitch without reasonable cause. First and final warning, then 5 to the fielding side | batting side |
| 41.15 | Striker in protected area (taking a batting position in or too near it). First and final warning, then 5 to the fielding side | batting side |
| 41.16 | Batters stealing a run. Dead ball, run disallowed, 5 to the fielding side | batting side |
| 41.17 | Penalty runs. 41.17.4: the fielding side's five go to its most recently completed innings, or its next if it has none | none |

The 4th Edition keeps Penalty runs at 41.17 (41.17.3 and 41.17.4 confirmed in the 4th Edition text returned by the
search). It changes 41.8 (whole match), 41.16 (the order of the umpire's actions) and 41.17.2 (penalty runs at the end
of a match). Other numbers are UNVERIFIED for the 4th Edition.

### Law 41 cited generally. Verdict: CORRECT

packages/scoring/src/events.mjs:65, 138, 265, 270, 395, 753, 784; packages/scoring/src/replay.mjs:425;
packages/scoring/src/laws.mjs:83, 88, 195, 261, 293; packages/scoring/src/phases.mjs:40;
packages/scoring/test/laws.test.mjs:487, 526; packages/scoring/test/replay.test.mjs:1377;
apps/web/src/scorer/penalty.js:2; apps/web/src/scorer/engine.jsx:1442, 1458; apps/web/src/scorer/suspension.js:2;
apps/web/src/scorer/penaltySheet.jsx:12; apps/web/src/scorer/suspendSheet.jsx:14; db/45_handover_this_innings.sql:19;
db/48_penalty_runs.sql:6, 17; docs/redesign/DESIGN_DIRECTION.md:495; docs/SCORING_RULES.md:525, 587.
These are penalty runs, suspensions and the reporting of them, all of which are in Law 41. One exception in content,
not number: events.mjs:138 says "a second beamer" is grounds for suspension. See mismatch 7.

### Each Law 41 clause

| Cited | Where | What the code does there | What the clause is | Verdict |
|---|---|---|---|---|
| 41.1 | events.mjs:289, 324 (`PENALTY_REASON_TEXT.unfair_play`); docs/SCORING_RULES.md:569 | `unfair_play`: "dangerous or unfair play", 5 to the batting side | Captains' responsibility; no penalty | **WRONG, should be 41.2** (41.2.2). If the pad means a fielder distracting or obstructing a batter, then 41.4 or 41.5. |
| 41.3 | events.mjs:287, 322, 410; docs/SCORING_RULES.md:569 | `ball_tampering`: penalty to the batting side; suspension reason with scope "match" | Changing the condition of the ball | CORRECT. See mismatch 5 on "at once" and on the batting side's offence. |
| 41.4 | events.mjs:279, 315; docs/SCORING_RULES.md:569 | `obstruction_distraction`: the **batting side** distracting, deceiving or obstructing fielders, 5 to the fielding side | A **fielder** attempting to distract the striker, 5 to the batting side | **WRONG.** There is no Law 41 clause for this. A batter wilfully obstructing or distracting the fielding side is out, Obstructing the field (Law 37), with no penalty runs. The words mirror 41.5's title with the sides reversed. |
| 41.5 | events.mjs:278, 314, 1053; commentary.mjs:667; apps/web/src/scorer/penalty.js:48 (example in a doc comment); packages/scoring/test/laws.test.mjs:484 (test string); docs/SCORING_RULES.md:557, 569 | `short_running`: deliberate short running | A fielder distracting, deceiving or obstructing a batter | **WRONG, should be 18.5** (18.5.2 for the actions) |
| 41.6 | events.mjs:403; laws.test.mjs:485 (fixture string only) | `SUSPENSION_REASON.short_pitched` | Dangerous and unfair short-pitched deliveries | CORRECT |
| 41.7 | events.mjs:401; laws.test.mjs:485 (fixture string only) | `SUSPENSION_REASON.beamers`: "a second, or at once if deliberate" | Dangerous and unfair non-pitching deliveries | CORRECT number. The comment's "a second" is off. See mismatch 7. |
| 41.8 | events.mjs:404 | `SUSPENSION_REASON.deliberate_no_ball`, at once, scope innings | Deliberate front-foot No ball: suspended at once, for the innings | CORRECT. The scope changes on 1 Oct 2026, see mismatch 8. |
| 41.9 | events.mjs:288, 323, 409; docs/SCORING_RULES.md:569 | `fielding_time_wasting` (penalty to the batting side, and suspension reason) | Time wasting by the fielding side | CORRECT |
| 41.12 | events.mjs:280, 316; docs/SCORING_RULES.md:569 | `pitch_damage`: the **batting side** damaging the pitch, 5 to the fielding side | **Fielder** damaging the pitch, 5 to the batting side | **WRONG, should be 41.14** (Batter damaging the pitch) |
| 41.13 | events.mjs:406 | `SUSPENSION_REASON.protected_area`: the bowler | Bowler running on the protected area after delivering the ball | CORRECT (settles the "41.13 or 41.14" question for the suspension) |
| 41.14 | events.mjs:281, 317, 407; docs/SCORING_RULES.md:569 | `PENALTY_REASON.protected_area`: a batter running on the protected area after a first and final warning, 5 to the fielding side | Batter damaging the pitch, including presence on the pitch without reasonable cause; first and final warning, then 5 to the fielding side | CORRECT (for the batter's penalty) |
| 41.15 | events.mjs:282, 318; docs/SCORING_RULES.md:569 | `striking_pitch`: "striking the pitch unfairly" | Striker in protected area (taking guard in or too near it) | **WRONG.** The Laws have no "striking the pitch" offence. A batter damaging the pitch is 41.14. If the reason is meant to be the striker's stance, the number is right but the words are wrong. |
| 41.17 | events.mjs:283, 319; docs/SCORING_RULES.md:569 | `time_wasting`: a batter wasting time after a first and final warning | Penalty runs | **WRONG, should be 41.10** (Batter wasting time) |
| 41.18 | events.mjs:1020; replay.mjs:439, 924; packages/scoring/test/replay.test.mjs:1209; db/99_rls_verify.sql:4696 | Five penalty runs; the fielding side's go to its most recently completed innings, or its next | 3rd and 4th Editions: 41.17 is Penalty runs. There is no 41.18. | **WRONG, should be 41.17** (41.17.4). The behaviour matches 41.17.4. |

Not cited anywhere, but relevant to the lists: **41.16 Batters stealing a run** (5 to the fielding side) has no
`PENALTY_REASON`. **41.10** is missing too: it is there, but as `time_wasting` under the wrong number.

---

## Behaviour mismatches noticed

I did not fix any of these. They are ordered by how much they change a score or a scorecard.

1. **Byes and leg byes off a no-ball: scored and debited against the 2000 Code, not the current one.**
   The current 21.16 (3rd Edition, and the same words appear in the 4th Edition text returned by the search) says runs
   not off the bat from a no-ball "shall also be scored as Byes or Leg byes as appropriate". The one-run penalty is the
   No ball extra "debited against the bowler". The code scores those runs as no-ball extras and debits every one to
   the bowler: `events.mjs:105-109`, `replay.mjs:540-546` (`inn.extras.noBall += penaltyRun + (v - offBat)`),
   `sheets.jsx:59-61`, `db/99_rls_verify.sql:3454` ("5 + 5 + 7"), and `docs/SCORING_RULES.md:368-374`, which says
   outright "not byes or leg byes" and gives a table. The heading it quotes, "Runs resulting from a No ball – how
   scored", exists in both Codes. The rule it describes ("all runs resulting from a No ball … debited against the
   bowler") is the 2000 Code's Law 24.13. The team total is right either way. The extras split (nb against b/lb) and
   the bowler's runs conceded are not, and every SQL fold that adds `1 + value` to the bowler follows the fold. Check
   the wording of 21.16 on the page before acting. This is the biggest one.

2. **Resuming after retiring hurt: 25.4.4 is only half enforced.** The Law allows a return "only at the fall of a
   wicket or the retirement of another batter". The server (`battersRefusal`, `laws.mjs:445-466`) lets a
   retired-hurt batter in at any empty end. The pad (`sheets.jsx:503`, `notResuming` from `engine.jsx:1675`) only
   declines to offer him back into the end he has just left. Because an end is empty only after a wicket or a
   retirement, the one case the Law forbids and the server takes is his return into his own vacancy: from another
   client, an older build, or a correction. The backlog already notes this at `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md:2943`,
   under the wrong clause (25.4.2; it is 25.4.4). Also: 25.4.2 covers "illness, injury or any other unavoidable cause",
   not injury only. The pad's "retired hurt" is the right bucket, but the label is narrower than the Law.

3. **Retired out can resume under the Law; the code never allows it.** 25.4.3: a batter who retires for any other
   reason "may be resumed only with the consent of the opposing captain", and is recorded "Retired – out" only if he
   does not resume. The code makes retired out a dismissal at once and refuses his return (`isOut()`, `laws.mjs:429-433`;
   `laws.test.mjs:223`; `SCORING_RULES.md:196`). This may be the right product call for school cricket. It is not the Law.

4. **The penalty-reason list has sides and offences the Laws do not.** (`PENALTY_REASON`, `PENALTY_REASON_SIDE`,
   `events.mjs:276-307`)
   - `obstruction_distraction` and `pitch_damage` are on the batting side's list (5 to the fielding side). Under Law 41
     both are **fielding-side** offences: 41.4/41.5 a fielder distracting or obstructing a batter, 41.12 a fielder
     damaging the pitch, each 5 to the **batting** side. With the sides as they are, `lawsRefusal`
     (`penalty_reason_side`) would refuse the lawful award, 5 to the batting side for a fielder damaging the pitch,
     and the scorer would have to use `other`. A batter obstructing fielders is out under Law 37, not a penalty.
   - `striking_pitch` is not an offence in the Laws.
   - Missing: 41.16 batters stealing a run (5 to the fielding side); 41.2.2 unfair action by either side; 41.4 and
     41.5 as the fielding side's offences.
   - `fielding_restrictions` is a playing condition, not a Law. That is fine, but no Law number applies.

5. **Ball tampering (41.3).** Either side can change the ball's condition. The first instance gives 5 to the
   *opposing* side, and suspension comes only on a *further* instance in the match by the fielding side. The code
   allows `ball_tampering` only as an award to the batting side, so the batting side's tampering can only be recorded
   as `other`. The suspension comment says "at once" (`events.mjs:410`). The scope (the match) is right. Because
   warnings are not tracked and the umpire decides when to suspend, the "at once" wording is the only practical
   effect of the suspension half.

6. **"Handled the ball" is not a way out any more.** The 2017 Code folded it into Obstructing the field (Law 37).
   MCC's own summary: "reducing the list of dismissals from ten to nine". `DISMISSAL.HANDLED_BALL` is still in the
   vocabulary, the comment says "The eleven in the Laws" (`events.mjs:185`), and the wicket sheet offers
   every `DISMISSAL_LABEL` except timed out (`sheets.jsx:648`), so a scorer can record "Handled Ball". Keep it for
   reading old logs. Whether to stop offering it is a product question.

7. **Suspension words and comments that do not match the procedure.**
   - Beamers (41.7): the comment and `SCORING_RULES.md:587` say a bowler is suspended on "a second" dangerous
     full toss. Since the 2019 amendment, 41.7 has a caution and a warning (41.7.3), so suspension comes on the third,
     or at once if deliberate. `events.mjs:138` says "a second beamer" too.
   - Bowler on the protected area (41.13): a caution, then a final warning, then suspension.
     `SUSPENSION_REASON_TEXT.protected_area`, which a screen shows, says "after a first and final warning". That is the
     batter's procedure under 41.14.
   - All of these are words only: warnings are not tracked and the scorer records what the umpire decided.

8. **From 1 October 2026 (4th Edition).** MCC's change list: "Law 41.8 – one of a few instances in this edition where
   penalties for deliberate unfair play will be applied to the whole match, not just an innings".
   `SUSPENSION_REASON_SCOPE.deliberate_no_ball` is `"innings"`. I could not find which other clauses moved to the whole
   match (UNVERIFIED). Also from 1 October: a bouncer over head height is a Wide, not a No ball. The pad's no-ball
   types (front foot, height, beamer) do not model it, so nothing breaks. And 41.17.2 changes penalty runs at the end
   of a match. The code's rule refusing an award to the fielding side once the match is decided (`match_decided`)
   should be checked against the new wording.

9. **The free hit is cited as a Law.** "Every no-ball is followed by a free hit" (`events.mjs:139-140`, §6 of
   `SCORING_RULES.md`) and "Law 21.19" (`events.mjs:210`). The MCC Laws have no free hit. If the competition's
   playing conditions (CSA or the schools' league) have one, the code is right and the citation should name those
   conditions. If they do not, every no-ball's free hit is wrong for that competition.

**Checked and matching:** no consecutive overs and the mid-over replacement (17.6, 17.7.1, 17.8); timed out applying
to the incoming batter after a wicket or a retirement, and not to openers (40.1.1); which end is empty after a run out
(38.4); deliberate short running (18.5.2); the fielding side's penalty runs going to its most recently completed innings
or its next (41.17.4); ball tampering's match-long suspension (41.3); a deliberate front-foot no-ball suspending at once
(41.8, 3rd Edition).

## Outside the folders searched

The brief named `packages/`, `apps/web/src/`, `services/`, `db/` and `docs/`. `services/` cites no clause. The same
numbers also appear in `apps/web/test/` (law-clauses.test.mjs: 17.8.1, 40, 41.13; penalty-sheet.test.mjs: 41.5;
pad-feel.test.mjs: 17.8, 17.8.1), `tools/` (smoke scripts: 17.8, 36, 40, 41) and `audit/SCRBRD_IMPLEMENTATION_BACKLOG.md`
(17.8, 17.8.1, 18, 21.6, 23, 38.2, 40, 41, and 25.4.2 at line 2943). Their verdicts are the same as above. Most of these
are test strings that prove clause numbers stay off screen, not claims about the Laws.

## Sources

- Law pages (3rd Edition, 2022): [The Over](https://www.lords.org/mcc/the-laws/the-over) ·
  [Scoring Runs](https://www.lords.org/mcc/the-laws/scoring-runs) · [No Ball](https://www.lords.org/mcc/the-laws/no-ball) ·
  [Bye and Leg Bye](https://www.lords.org/mcc/the-laws/bye-and-leg-bye) ·
  [Batter's Innings; Runners](https://www.lords.org/mcc/the-laws/batsman-s-innings;-runners) ·
  [The Fielder](https://www.lords.org/mcc/the-laws/the-fielder) · [Run Out](https://www.lords.org/mcc/the-laws/run-out) ·
  [Timed Out](https://www.lords.org/mcc/the-laws/timed-out) · [Unfair Play](https://www.lords.org/mcc/the-laws/unfair-play) ·
  [The Umpires](https://www.lords.org/mcc/the-laws/the-umpires) ·
  [Leg Before Wicket](https://www.lords.org/mcc/laws-of-cricket/laws/law-36-leg-before-wicket/) ·
  [Obstructing the Field](https://www.lords.org/mcc/the-laws/obstructing-the-field)
- 4th Edition (2026): [announcement](https://www.lords.org/lords/news-stories/mcc-announces-new-edition-of-laws-from-1-october-2026) ·
  [full text PDF](https://www.lords.org/getmedia/1d908298-5c44-468d-b6a7-e1414a1296e0/Laws-of-Cricket-2017-Code-4th-Edition-(2026)_3.pdf) ·
  [changes explained](https://www.lords.org/getmedia/5ff72819-c9ef-448c-87e3-b051408e1803/Changes-to-Laws-for-2026-edition-explained_2.pdf) ·
  [list of changes](https://www.lords.org/getmedia/0855ddfe-e219-4363-8652-2d7de233c4b9/Changes-to-Laws-for-2026-edition_1.pdf)
- 2017 Code changes (Handled the ball merged into Obstructing the field):
  [summary paper](https://apps.lords.org/assets/Uploads/Law-Summary-Paper-updated-28-June.pdf)
- Law 41.7 amendment (2019): [MCC announcement](https://www.lords.org/lords/news-stories/mcc-announces-intended-changes-to-law-41-7)
