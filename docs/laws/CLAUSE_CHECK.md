# Law clause check (2026-09-27, against the 4th Edition)

Every MCC Law clause the codebase cites, checked against the Code in force from **1 October 2026**: the **2017 Code,
4th Edition (2026)**. The 3rd Edition (2022) column is kept for reference. This is research only. No code was changed.

## First: what the 4th Edition does to the three changes in flight

1. **Byes and leg byes off a no-ball: unchanged, but the clause number moved.** The rule is the same. Cite **21.15**
   (the 3rd Edition's 21.16). 4th, 21.15: "Any runs completed by the batters or any boundary allowance shall be credited
   to the striker if the ball has been struck by the bat; otherwise they shall also be scored as Byes or Leg byes as
   appropriate." The 4th also states it in Law 18. **18.10.2**: "If Byes or Leg byes accrue from a No ball, only the
   one-run penalty for No ball shall be scored as such, and the remainder as Byes or Leg byes." **18.10.3**: the bowler
   is debited with "all runs scored by the striker", "all runs scored as No ball extras" and "all runs scored as Wides",
   and nothing else. Any comment the change writes should cite 21.15 and 18.10.2–18.10.3, not 21.16.
2. **The penalty-reason list is affected, in four ways.**
   - **Unfair action by either side** is now **41.2.1** ("Unfair actions"). It was 41.2.2 in the 3rd. The warning
     applies "for the remainder of the match". A second offence gives 5 Penalty runs "to the opposing side".
   - **41.4 is wider.** Its title is now "Deliberate attempt to distract or obstruct striker". 21.9 sends a fielder's
     deliberate interception of a delivery to it: "if the fielder's action is a deliberate attempt to obstruct the
     striker from playing the ball, Law 41.4 shall apply." That covers the bowler who grabs a looping delivery before
     the striker can play it. It is a fielding-side offence: 5 to the batting side, and the ball does not count.
   - **Awards after the result (41.17.2) are new.** Penalty runs are awarded "up until the umpires leave the field at
     the end of the match, even if a result has already been achieved … if the award of Penalty runs means that a
     result has no longer been achieved, the match continues." The code refuses an award to the fielding side once the
     chase is over (`match_decided`, `laws.mjs` `penaltyRefusal`). The 4th Edition requires it to be accepted. See
     build item 6.
   - **Short running's award now comes with a choice of striker (18.5.2).** The fielding captain decides who faces
     next. See build item 4. The reason's clause is still 18.5 (18.5.2), not 41.5.
   - The other Law 41 numbers are the same as the 3rd's: 41.3, 41.9, 41.10, 41.12, 41.13, 41.14, 41.15, 41.16 and
     41.17 (41.17.4). Law 18.6 lists every source of penalty runs; the full list is under Law 41 below.
3. **Retired hurt and retired out resuming (25.4): no change.** The 4th has the same four sub-clauses with the same
   numbers. Only the wording is now gender-neutral. 25.4.4: "If after retiring a batter resumes their innings, subject
   to the requirements of 25.4.2 and 25.4.3, it shall be only at the fall of a wicket or the retirement of another
   batter." The commits for SCRBRD-071 already cite 25.4.4, which is right for both Editions.

## Summary

**Edition read:** the full text of the MCC **Laws of Cricket, 2017 Code 4th Edition (2026)**, supplied by Kameel. It
comes into force on 1 October 2026. Clause numbers are taken from the **body text**. The index at the back is out of step
after 21.10: it still has the 3rd Edition's numbers there, 21.12 to 21.18. The body has 21.11 to 21.17. For example, the
index gives "21.16 Runs resulting from a No ball" and the body gives 21.15. The document has no "what's new" section.
What changed from the 3rd Edition comes from comparing the text with the 3rd-Edition pass below, and from MCC's change
summaries on lords.org, read through web searches (the site itself is blocked by this session's proxy). The 3rd
Edition column is the earlier pass, which was made through web searches.

**Counts:** 37 distinct citations (one clause number cited for one meaning), counting 25.4.4, which today's SCRBRD-071
commits added. Against the 4th Edition: **24 CORRECT, 13 WRONG, 0 MOVED.** No number the code cites was right in the 3rd and changed in the 4th. But three numbers the
3rd-Edition pass *recommended* have moved, so its corrections cannot be applied as written:

- runs from a no-ball: **21.16 → 21.15**
- out from a no-ball: **21.18 → 21.17**
- an unfair action: **41.2.2 → 41.2.1**

Three of the CORRECT numbers are clauses whose **content** changed in the 4th, and the code must follow: 18.5.2, 41.7
and 41.8. 17.8 changed in a helpful way. Its proviso now reads "provided that **no bowler** delivers two overs
consecutively …", where the 3rd had "he/she". So in the 4th, 17.8 itself bars both the bowler who left and the one who
finished the over.

**The wrong ones, with the 4th Edition's numbers:**

| Cited | Used for | Right clause, 4th Edition (3rd in brackets where different) |
|---|---|---|
| 17.8 | no bowler bowls two overs, or parts of two, in a row (the general rule) | **17.6** (17.8 is right for the over finished by another bowler) |
| 17.8.1 | a bowler may be replaced during an over only if incapacitated or suspended | **17.7.1** (and 17.8). There is no 17.8.1. |
| 21.6 | runs off the bat from a no-ball are the striker's | **21.15** (3rd: 21.16). Also 18.10.1. 21.6 is "Bowler breaking wicket in delivering ball". |
| 21.19 | the ways out off a free hit | No such clause. **21.17** "Out from a No ball" (3rd: 21.18). The free hit is not in the Laws. |
| 25.4.2 (backlog only, for the resume rule) | resume only at a wicket or another retirement | **25.4.4** |
| 38.2 | a run out empties the end where the wicket was put down | **38.4** "Which batter is out" |
| 41.1 | `unfair_play` | **41.2.1** (3rd: 41.2.2). 41.1 is the captains' responsibility and carries no penalty. |
| 41.4 | `obstruction_distraction`: the batting side obstructing fielders | No clause. 41.4 is a **fielder** distracting or obstructing the striker. A batter who obstructs is out under **Law 37**. |
| 41.5 | `short_running` | **18.5** (18.5.2). 41.5 is a fielder distracting, deceiving or obstructing a batter. |
| 41.12 | `pitch_damage` by a batter | **41.14** "Batter damaging the pitch". 41.12 is the fielder. |
| 41.15 | `striking_pitch` | No such offence. 41.15 is "Striker in protected area": taking guard in or too near it. |
| 41.17 | `time_wasting` by a batter | **41.10** "Batter wasting time". 41.17 is Penalty runs. |
| 41.18 | penalty runs to the fielding side | **41.17** (41.17.4). There is no 41.18. |

**41.13 against 41.14, settled again in the 4th Edition's numbering: both numbers are right, for different
offences.** The numbering is unchanged from the 3rd.

- **41.13 "Bowler running on protected area"** is the bowler's offence. 41.13.1: "It is unfair for a bowler to enter
  the protected area in their follow-through without reasonable cause, whether or not the ball is delivered." The
  umpire cautions, then gives a final warning. On a third contravention, 41.13.4: the bowler "shall not be allowed to
  bowl again in that innings". This is the number for `SUSPENSION_REASON.protected_area`.
- **41.14 "Batter damaging the pitch"** is the batters' offence. 41.14.1: "If the striker enters the protected area
  in playing or playing at the ball, the striker must move from it immediately thereafter." A first and final warning
  comes first. On a further instance, 41.14.3: disallow all runs, return the batters to their original ends, and award
  5 Penalty runs to the fielding side. This is the number for `PENALTY_REASON.protected_area`.

The comment at `events.mjs:405-407` ("41.13 in this research; the penalty research gave 41.14 — to be confirmed") can
say 41.13 and drop the rest.

**What the 4th Edition changes that the code must do** (details in "4th Edition: changes to build"):

1. A deliberate front-foot no-ball suspends the bowler **for the match** (41.8). The code says the innings.
2. A deliberate non-landing delivery (a deliberate beamer) suspends the bowler **for the match** (41.7.6). The code
   has one `beamers` reason, scoped to the innings, for both the dangerous and the deliberate kind.
3. A bouncer over head height is a **Wide**, not a No ball (22.1.3). The fold needs no change. The words on the pad
   and in the rules need changing.
4. After deliberate short running, **the fielding captain chooses who faces** (18.5.2, 18.13.2). The batters are no
   longer simply returned to their original ends.
5. After an obstruction that prevents a catch, **the fielding captain chooses** whether the non-striker or the
   incoming batter faces (37.5.2).
6. **Penalty runs after the result** stand until the umpires leave the field, and can reopen the match (41.17.2).
   The result can be "a win … by Penalty runs" (16.7).

Candidates checked and refuted, or not scoring matters: the free hit is still not in the Laws. Retiring (25.4) is
unchanged. Byes and leg byes off a no-ball are unchanged (21.15). These 4th Edition changes are real but move no
figure the code keeps: "finally settled" (20.1.2), overthrows defined (19.8.2), airborne catches at the boundary
(19.5.2), hit wicket while regaining balance (35.1.1.2), last over after a wicket at close of play (12.5.2), laminated
bats (Law 5).

---

## Law 2: The umpires

| Cited | Where | What the code does there | 3rd Edition | 4th Edition | Verdict |
|---|---|---|---|---|---|
| 2.7 | db/08_schema_programme.sql:1434 (frozen, shipped) | Comment: whether a match goes ahead is the umpires' call | 2.7 "Fitness of ground, weather and light" | 2.7 "Fitness for play". 2.7.1: "It is solely for the umpires together to decide whether either conditions of ground, weather or light or exceptional circumstances mean that it would be dangerous or unreasonable for play to take place." | CORRECT |

## Law 17: The over

4th Edition, body:

- **17.6 Bowler changing ends:** "… provided they do not bowl two overs consecutively, nor bowl parts of each of two
  consecutive overs, in the same innings."
- **17.7.1:** "Other than at the end of an innings, a bowler shall finish an over in progress unless incapacitated or
  suspended under any of the Laws."
- **17.8 Bowler incapacitated or suspended during an over:** "another bowler shall complete the over from the same
  end, provided that no bowler delivers two overs consecutively, nor delivers parts of each of two consecutive overs, in
  that innings." It has no sub-clauses.

The numbers are the same as in the 3rd. What changed is 17.8's proviso: "no bowler" (4th) where the 3rd had "he/she",
meaning the replacement only. The 4th's 17.8 therefore covers both men who shared the over. The code's quotation at
`laws.mjs:526` ("a bowler shall not bowl two overs, or parts thereof, consecutively") is the older wording. The meaning
is the same.

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 17.8 (general rule) | laws.mjs:75, 202, 526; laws.test.mjs:332; sync/test/held.test.mjs:61, 85, 248; sheets.jsx:809; SCORING_RULES.md:189, 232; tools/smoke-laws.mjs:171; tools/smoke-browser-held.mjs:235, 374; tools/smoke-fold-figures.mjs:152 | No bowler bowls two overs, or parts of two, running (`bowledLastOver`, `consecutive_overs`) | 17.6 | 17.6 | **WRONG, should be 17.6** |
| 17.8 (the over finished by another bowler; both men barred) | events.mjs:755, 794; commentary.mjs:68; laws.test.mjs:226, 382, 564; engine.jsx:1437, 1439; SCORING_RULES.md:415, 615; tools/smoke-browser-pad-laws.mjs:19, 319 | The replacement may not have bowled the previous over and may not bowl the next; the man who left may not bowl the next either | 17.8 (the replacement only) | 17.8 ("no bowler …": both) | CORRECT |
| 17.8.1 | events.mjs:752; replay.mjs:176; laws.mjs:76, 125, 207; laws.test.mjs:228, 229; sheets.jsx:790; SCORING_RULES.md:190, 325, 407 | A change during an over only for an injured or suspended bowler, with the reason recorded | 17.7.1 (and 17.8) | 17.7.1 (and 17.8) | **WRONG, should be 17.7.1**. The substance matches. |

Test strings, not claims about the Laws (leave them): `apps/web/test/pad-feel.test.mjs:212, 213` and
`apps/web/test/law-clauses.test.mjs:40, 51, 52, 161`. They prove the clause-stripping and the clause sweep work.

Behaviour: matches 17.6, 17.7.1 and 17.8 in both Editions.

## Law 18: Scoring runs

4th Edition, body:

- **18.5.1.1** (a new definition): "A deliberate short run is an attempt by the batters to appear to run more than one
  run, while at least one batter deliberately does not make good their ground at one end." **18.5.1.2:** abandoning
  an attempted run is not deliberate short running, "provided the umpires believe that there was no intention … to
  deceive".
- **18.5.2**, the bowler's end umpire's actions. It keeps disallowing all runs, signalling No ball or Wide, awarding
  5 Penalty runs to the fielding side, and any other 5-run penalty except under 28.3. It **drops** the 3rd's "return
  any not out batter to his/her original end". It **adds**: "Instruct the fielding captain to decide which of the
  batters at the wicket, including the incoming batter if applicable, shall face the next delivery (see 18.13)."
- **18.10 Crediting of runs scored:** 18.10.1, runs off the bat are the striker's, except the 5-run penalty and the
  one-run No ball penalty. 18.10.2, byes and leg byes off a No ball (quoted at the top). 18.10.3, what the bowler is
  debited with.
- **18.11.2.2:** the batters return to their original ends when runs are disallowed, "except under Law 18.5.2".
- **18.12.1.2:** after a Run out, the not-out batter returns to the wicket they left "only if the batters had not
  already crossed".
- **18.13 Batters going to an end determined by players:** 18.13.1, an obstruction that prevents a catch; 18.13.2,
  deliberate short running; 18.13.3, a fielder's obstruction under 41.5 (there the batters choose).

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 18 | events.mjs:123; replay.mjs:627; sheets.jsx:653; laws-spec.test.mjs:213; SCORING_RULES.md:343 | With runs completed before a run out, the batters have crossed, so the pre-ball crease does not say which end is empty | Law 18 | Law 18 (precisely 18.12.1.2 with 30.2) | CORRECT |
| 18.5 | events.mjs:278 ("41.5 (and 18.5)") | `PENALTY_REASON.SHORT_RUNNING` | 18.5 | 18.5 | CORRECT (the 41.5 half is wrong, see Law 41) |
| 18.5.2 | events.mjs:1053, 1064; laws.mjs:313; replay.test.mjs:1381; SCORING_RULES.md:557 | `shortRunning()`: the delivery with no runs, batters at their original ends, the no-ball or wide penalty stands, 5 to the fielding side | 18.5.2 (batters returned to original ends) | 18.5.2 (the fielding captain decides who faces) | CORRECT number. **Content changed**: see build item 4. |

## Law 21: No ball

4th Edition, body. **21.10 in the 3rd ("Ball bouncing over head height of striker") is gone.** That delivery is now a
Wide (22.1.3). Every later clause moves down one:

| 3rd | 4th | Title |
|---|---|---|
| 21.10 | (none) | Ball bouncing over head height of striker. Now 22.1.3 (Wide). |
| 21.11 | 21.10 | Call of No ball for infringement of other Laws |
| 21.12 | 21.11 | Revoking a call of No ball |
| 21.13 | 21.12 | No ball to override Wide |
| 21.14 | 21.13 | Ball not dead |
| 21.15 | 21.14 | Penalty for a No ball |
| 21.16 | **21.15** | Runs resulting from a No ball – how scored |
| 21.17 | 21.16 | No ball not to count |
| 21.18 | **21.17** | Out from a No ball |

- **21.9 Fielder intercepting a delivery** now ends: "However, if the fielder's action is a deliberate attempt to
  obstruct the striker from playing the ball, Law 41.4 shall apply."
- **21.15**, quoted at the top. It adds one sentence: "If other Penalty runs have been awarded to either side these
  shall be scored as stated in Law 41.17 (Penalty runs)."
- **21.17:** "When No ball has been called, neither batter shall be out under any of the Laws except 34 (Hit the ball
  twice), 37 (Obstructing the field) or 38 (Run out)."
- The free hit is still **not in the Laws**. The text has no "free hit". It is a playing condition.

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 21 | events.mjs:108; replay.mjs:554; sheets.jsx:61; laws-spec.test.mjs:174; db/99_rls_verify.sql:3454; SCORING_RULES.md:368 | Byes and leg byes off a no-ball are no-ball extras, and every run of a no-ball is debited to the bowler | Law 21 (21.16) | Law 21 (**21.15**) | CORRECT Law number. The behaviour does not match 21.15. This is change 1 in flight. |
| 21.6 | events.mjs:98; SCORING_RULES.md:331 | Runs off the bat from a no-ball are the striker's | 21.16 | **21.15** (and 18.10.1) | **WRONG, should be 21.15** |
| 21.19 | events.mjs:210; phases.test.mjs:270 | `NON_DELIVERY`: the ways out that stand on a free hit | 21.18 | **21.17** | **WRONG.** No 21.19. 21.17 lists hit the ball twice, obstructing and run out; "handled" is not a way out. The free hit comes from the playing conditions and should be cited as such. |

## Law 22: Wide ball (not cited; new rule)

- **22.1.3 (new):** "The ball will be considered as passing wide of the striker if any delivery, after landing, passes
  over head height of the striker standing upright at the popping crease."
- **22.3.1:** the Wide is revoked "if there is any contact between the ball and the striker's bat or person before the
  ball comes into contact with any fielder".
- **22.9 Out from a Wide:** only Hit wicket, Obstructing the field, Run out or Stumped.
- **41.6.2** still makes short deliveries unfair "if they repeatedly pass above head height". Those are called No ball
  under 41.6.3.

## Law 23: Bye and Leg bye

**23.1:** runs from a ball that passes the striker without touching bat or person are "credited as Byes … Additionally,
if the delivery is a No ball, the one-run penalty for such a delivery shall be incurred." **23.2.3:** the same for Leg
byes. The numbers are the same as in the 3rd.

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 23 | events.mjs:105; sheets.jsx:60; laws-spec.test.mjs:174; SCORING_RULES.md:331 | Runs off a no-ball not off the bat are not the striker's, and are scored as no-ball extras | Law 23 | Law 23 | CORRECT Law number. The first half matches. "No-ball extras" does not (change 1 in flight). |

## Law 25: Batter's innings; runners

4th Edition, body. The same as the 3rd except for gender-neutral wording:

- **25.4.2:** "If a batter retires because of illness, injury or any other unavoidable cause, that batter is entitled to
  resume their innings. If for any reason this does not happen, that batter is to be recorded as 'Retired – not out'."
- **25.4.3:** "… may be resumed only with the consent of the opposing captain. If for any reason their innings is not
  resumed, that batter is to be recorded as 'Retired - out'."
- **25.4.4:** the resume rule, quoted at the top.
- Related, not new in the 4th: a Level 3 conduct suspension of a batter who does not come back is recorded "Retired –
  not out" (42.4.2.3.5). A Level 4 offence is recorded "Retired – out" (42.5.2.3.3).

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 25.4 | SCORING_RULES.md:196 | Rule table: a batter dismissed or retired out does not come back; retired hurt may, at a wicket or another's retirement | 25.4 | 25.4 | CORRECT |
| 25.4.2 | events.mjs:167; replay.mjs:307; laws.mjs:439, 507; laws.test.mjs:221; retire.js:2; engine.jsx:1476; SCORING_RULES.md:633 | Retired hurt is not out and may resume | 25.4.2 | 25.4.2 | CORRECT |
| 25.4.2 (for the resume-only-at-a-wicket rule) | audit/SCRBRD_IMPLEMENTATION_BACKLOG.md:2943 | Backlog note (the entry at :2953 already says "Law 25.4.4, not 25.4.2") | 25.4.4 | 25.4.4 | **WRONG, should be 25.4.4** |
| 25.4.3 | events.mjs:167, 1095; laws.mjs:406, 438; laws.test.mjs:223 | Retired out is a dismissal with no ball, and the batter may not return | 25.4.3 | 25.4.3 | CORRECT number. The code never allows a resume with the opposing captain's consent. The backlog records that consent needs SQL. |
| 25.4.4 | laws.mjs:120, 449; SCORING_RULES.md:638 (added by SCRBRD-071 today) | A retired-hurt batter resumes only at a wicket or another's retirement | 25.4.4 | 25.4.4 | CORRECT |

## Law 28: The fielder

- **28.2.3:** if a fielder illegally fields the ball, it "shall immediately become dead". The No ball or Wide penalty
  stands, runs completed are credited, "the ball shall not count as one of the over", and the umpire awards 5 Penalty
  runs to the batting side.
- **28.3.2:** a helmet on the ground struck by the ball: dead ball, 5 Penalty runs to the batting side.
- **28.6.3** (unfair movement by a fielder) and **27.4.2** (by the wicket-keeper): dead ball and 5 Penalty runs to the
  batting side. Both are listed in 18.6. The 3rd Edition, as amended in 2022, had these awards too, as I recall; they
  are not in MCC's 2026 change summaries.

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 28.2 | events.mjs:286, 321; SCORING_RULES.md:569 | `illegal_fielding`, 5 to the batting side | 28.2 | 28.2 (28.2.3) | CORRECT |
| 28.3 | events.mjs:285, 320; SCORING_RULES.md:569 | `helmet_struck`, 5 to the batting side | 28.3 | 28.3 (28.3.2) | CORRECT |

## Law 36: Leg before wicket

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 36 | db/08_schema_programme.sql:2641, 2673 (frozen); apps/web/src/data/roadmap.js:65; docs/redesign/SCREEN_MAP.md:122; tools/smoke-drs.mjs:14, 155; tools/smoke-browser-drs.mjs:236 | The review panel's LBW components | Law 36 | Law 36 "Leg before wicket" (36.1.1 to 36.1.5) | CORRECT |

## Law 37: Obstructing the field (not cited; new rule)

- **37.5.2 (new):** if the obstruction or distraction prevents the striker being out Caught, "any runs completed by the
  batters shall not be scored but any award of 5 Penalty Runs to either side shall stand", and "the fielding captain
  shall decide whether the non-striker, or the incoming batter, is to face the next delivery."
- **37.1.3:** the striker is out if, "while receiving the ball, they deliberately drop or throw the bat in an attempt to
  either impact the ball or prevent any dismissal except Hit wicket". MCC's summaries do not say whether this is new;
  it changes nothing the code records.
- Handled the ball is still not a way out. It is inside 37.1.2 (striking the ball with a hand not holding the bat).

## Law 38: Run out

**38.4 Which batter is out:** "The batter out in the circumstances of 38.1 is the one whose ground is at the end where
the wicket is fairly broken." 38.2 is still "Batter not out Run out". **38.5 Runs scored:** the order of the umpire's
actions was changed; the runs rule is not.

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 38.2 | events.mjs:122; replay.mjs:628; sheets.jsx:654; laws-spec.test.mjs:215; SCORING_RULES.md:329, 339 | `RUN_OUT_END` / `outAt`: the end where the wicket was put down is left empty | 38.4 | 38.4 | **WRONG, should be 38.4.** The behaviour matches. |

## Law 40: Timed out

**40.1.1:** "After the fall of a wicket or the retirement of a batter, the incoming batter must, unless Time has been
called, be ready to receive the ball, or for the other batter to be ready to receive the next ball within 3 minutes of
the dismissal or retirement." The same as in the 3rd.

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 40 | events.mjs:168, 1095; laws.mjs:410; laws.test.mjs:318; sheets.jsx:480, 647; SCORING_RULES.md:199, 441; tools/smoke-browser-pad-laws.mjs:265 | Timed out is the incoming batter's, a wicket with no ball, only while an end is empty after a wicket or a retirement | 40 | 40 | CORRECT |
| 40.1 | laws.mjs:408 | The same rule, in `offBallDismissalRefusal()` | 40.1.1 | 40.1.1 | CORRECT |

## Law 41: Unfair play

4th Edition clause titles (body), the 3rd's where different, and who gets the five:

| Clause | Title (4th) | Change from the 3rd | Sanction (4th) |
|---|---|---|---|
| 41.1 | Fair and unfair play – responsibility of captains | | none |
| 41.2 | **Unfair actions** (41.2.1: an unfair action not covered by the Laws) | Was "responsibility of umpires", with the offence at 41.2.2 | First and final warning to the side for the match (41.2.1.1), then 5 to the opposing side (41.2.1.2). Either side. |
| 41.3 | The match ball – changing its condition | 41.3.4: the opposing captain now chooses whether the ball is replaced | 5 to the opposing side (41.3.4.2). A further instance by the fielding side suspends the bowler of the preceding ball "again in the match" (41.3.5.2). Either side. |
| 41.4 | Deliberate attempt to distract **or obstruct** striker | 21.9 now sends a deliberate interception here | Dead ball, 5 to the batting side, the ball does not count (41.4.2) |
| 41.5 | Deliberate distraction, deception or obstruction of batter | | 5 to the batting side (41.5.6), the ball does not count (41.5.7), the batters choose who faces (41.5.9) |
| 41.6 | Bowling of dangerous and unfair short **deliveries** | Was "short pitched deliveries" | Caution (a first and final warning, 41.6.3), then suspension "in that innings" (41.6.4) |
| 41.7 | Bowling of dangerous and unfair **non-landing** deliveries | Was "non-pitching" | Dangerous: caution (41.7.3), then suspension for the innings (41.7.4). **Deliberate: at once, "not be allowed to bowl again in the match" (41.7.6)** |
| 41.8 | Bowling of deliberate front-foot No ball | **Match, not innings** | At once; "not be allowed to bowl again in the match" |
| 41.9 | Time wasting by the fielding side | | A first and final warning, then 5 to the batting side, or during an over a suspension for the innings (41.9.3) |
| 41.10 | Batter wasting time | | A first and final warning, then 5 to the fielding side (41.10.3) |
| 41.11 | The protected area | | definition |
| 41.12 | Fielder damaging the pitch | | A first and final warning, then 5 to the batting side (41.12.3) |
| 41.13 | Bowler running on protected area | | Caution, final warning, then suspension for the innings (41.13.4) |
| 41.14 | Batter damaging the pitch | | A first and final warning, then all runs disallowed, batters to their original ends, 5 to the fielding side (41.14.3) |
| 41.15 | Striker in protected area | | A first and final warning, then the same as 41.14.3 (41.15.3) |
| 41.16 | Batters stealing a run | 41.16: the order of the umpire's actions changed | Dead ball, the run disallowed, 5 to the fielding side |
| 41.17 | Penalty runs | **41.17.2: awards continue after a result until the umpires leave the field; the match continues if the result is undone; awards in the order the offences happened** | 41.17.4: the fielding side's five go to "its most recently completed innings", or its next |

Other sources of 5 Penalty runs (18.6): 18.5 (short running), 24.4 (a player returning without permission touches the
ball), 26.4 (practice after a warning, to the opposing side), 27.4.2 (the wicket-keeper's unfair movement), 28.2, 28.3,
28.6.3 (a fielder's unfair movement) and Law 42 (players' conduct, to the opposing team).

Every place a bowler is suspended, in the 4th:

| Clause | Scope |
|---|---|
| 21.3.2 (throwing) | innings |
| 41.3.5.2 (ball tampering) | match |
| 41.6.4 | innings |
| 41.7.4 | innings |
| **41.7.6** | **match** |
| **41.8** | **match** |
| 41.9.3 | innings |
| 41.13.4 | innings |

### Law 41 cited generally. Verdict: CORRECT

events.mjs:65, 138, 265, 270, 395, 753, 784; replay.mjs:433; laws.mjs:84, 89, 198, 270, 302; phases.mjs:40;
laws.test.mjs:487, 526; replay.test.mjs:1385; penalty.js:2; engine.jsx:1442, 1458; suspension.js:2; penaltySheet.jsx:12;
suspendSheet.jsx:14; db/45_handover_this_innings.sql:19 and db/48_penalty_runs.sql:6, 17 (both frozen);
docs/redesign/DESIGN_DIRECTION.md:495; SCORING_RULES.md:525, 587; tools/smoke-browser-suspension.mjs:3;
tools/smoke-handover-innings.mjs:145; tools/smoke-browser-penalty.mjs:3; tools/smoke-fold-figures.mjs:170. These are
penalty runs, suspensions and the reporting of them, all in Law 41. (Line numbers in this subsection are from
`6158091` and may have moved.)

### Each Law 41 clause

| Cited | Where | What the code does there | 3rd | 4th | Verdict |
|---|---|---|---|---|---|
| 41.1 | events.mjs:289, 324; SCORING_RULES.md:569 | `unfair_play`: "dangerous or unfair play", 5 to the batting side | 41.2.2 | **41.2.1** | **WRONG, should be 41.2.1.** If the pad means a fielder distracting or obstructing a batter, then 41.4 or 41.5. |
| 41.3 | events.mjs:287, 322, 410; SCORING_RULES.md:569 | `ball_tampering`: award to the batting side; suspension scoped to the match | 41.3 | 41.3 | CORRECT. Either side can offend (41.3.4). Suspension comes only on a further instance by the fielding side (41.3.5), not "at once". |
| 41.4 | events.mjs:279, 315; SCORING_RULES.md:569 | `obstruction_distraction`: the batting side obstructing fielders, 5 to the fielding side | no such offence | no such offence | **WRONG.** 41.4 is a fielder distracting or obstructing the striker, 5 to the batting side. A batter who obstructs is out (Law 37). |
| 41.5 | events.mjs:278, 314, 331, 1053; commentary.mjs:667; SCORING_RULES.md:557, 569 | `short_running` | 18.5 | 18.5 (18.5.2) | **WRONG, should be 18.5** |
| 41.6 | events.mjs:403 | `SUSPENSION_REASON.short_pitched` | 41.6 | 41.6 (41.6.4) | CORRECT |
| 41.7 | events.mjs:401 | `SUSPENSION_REASON.beamers`: "a second, or at once if deliberate" | 41.7 | 41.7 (41.7.4, 41.7.6) | CORRECT number. "A second" is right in the 4th: one caution (41.7.3), then suspension on the next dangerous one (41.7.4). But **41.7.6 (deliberate) is now for the match**. See build item 2. |
| 41.8 | events.mjs:404 | `SUSPENSION_REASON.deliberate_no_ball`, at once, scope innings | 41.8 (innings) | 41.8 (**match**) | CORRECT number. **The scope is wrong from 1 October 2026.** See build item 1. |
| 41.9 | events.mjs:288, 323, 409; SCORING_RULES.md:569 | `fielding_time_wasting` (penalty and suspension) | 41.9 | 41.9 (41.9.3) | CORRECT |
| 41.12 | events.mjs:280, 316; SCORING_RULES.md:569 | `pitch_damage` by the batting side, 5 to the fielding side | 41.14 | 41.14 | **WRONG, should be 41.14** (41.12 is the fielder, 5 to the batting side) |
| 41.13 | events.mjs:406 | `SUSPENSION_REASON.protected_area`, the bowler | 41.13 | 41.13 (41.13.4) | CORRECT |
| 41.14 | events.mjs:281, 317, 407; SCORING_RULES.md:569 | `PENALTY_REASON.protected_area`, the batter, 5 to the fielding side | 41.14 | 41.14 (41.14.3) | CORRECT |
| 41.15 | events.mjs:282, 318; SCORING_RULES.md:569 | `striking_pitch`: "striking the pitch unfairly" | no such offence | no such offence | **WRONG.** 41.15 is the striker's batting position in or near the protected area. A batter damaging the pitch is 41.14. |
| 41.17 | events.mjs:283, 319; SCORING_RULES.md:569 | `time_wasting` by a batter | 41.10 | 41.10 (41.10.3) | **WRONG, should be 41.10** |
| 41.18 | events.mjs:1020; replay.mjs:447, 935; replay.test.mjs:1217; db/99_rls_verify.sql:4696 | Five penalty runs; the fielding side's to its most recently completed innings, or its next | 41.17 (41.17.4) | 41.17 (41.17.4) | **WRONG, should be 41.17** (41.17.4). The behaviour matches 41.17.4. |

Test strings only (leave them): `laws.test.mjs:485` ("Laws 41.6 and 41.7"), `law-clauses.test.mjs:53` ("41.13.2")
and `:165, 167` ("Law 41.13").

---

## 4th Edition: changes to build

Each item gives what the 4th Edition says, what changed from the 3rd, what the code does today (file:line at
`6158091`), and what it must do. The document itself has no summary of changes. "What changed" comes from comparing
the texts and from MCC's change summaries on lords.org.

**A question every item below raises: which Edition applies to a match.** A match played on 30 September 2026 is
under the 3rd Edition, and one on 1 October under the 4th. Suspensions already carry their scope on the event, and the
fold reads `ev.scope` (`replay.mjs:442`), so a log written under the 3rd replays unchanged. But the constructor
(`events.mjs:810-824`) and the server (`laws.mjs` `suspensionRefusal`, about line 291) both insist the scope is the
reason's one fixed scope. Whatever changes that table either refuses a queued 3rd-Edition event or accepts a wrong
4th-Edition one. The rule needs to be keyed on the Edition in force for the match (its start date, or an explicit
edition on `innings_start`). That is a design decision for Opus before any item below is built.

### 1. A deliberate front-foot no-ball: suspended for the match (Law 41.8)

- **4th:** "The suspended bowler shall not be allowed to bowl again in the match."
- **What changed:** the 3rd said "in that innings". MCC's own note: "Law 41.8 – one of a few instances in this edition
  where penalties for deliberate unfair play will be applied to the whole match, not just an innings."
- **Code today:** `SUSPENSION_REASON_SCOPE.deliberate_no_ball: "innings"` (events.mjs:437). The words that tell the
  scorer only ball tampering is for the match: `REFUSAL_TEXT.bowler_suspended` (laws.mjs:114), `suspension.js:69`,
  the doc comments at events.mjs:412-413 and 790-791, and SCORING_RULES.md:191 and 587-590.
- **Must:** scope `match` for a 4th-Edition match (see the Edition question above). `suspendedBowlers()` already
  carries a match-scoped suspension into later innings. Update the words.

### 2. A deliberate beamer: suspended for the match (Law 41.7.6)

- **4th:** 41.7.6, for a bowler who "deliberately bowled a non-landing delivery": the caution and warning are dispensed
  with, and "The suspended bowler shall not be allowed to bowl again in the match." 41.7.4, a further *dangerous*
  (not deliberate) one: "in that innings".
- **What changed:** the deliberate one is now for the match (it was the innings in the 3rd). MCC's 41.8 note says
  there are "a few" such instances; 41.7.6 is the other bowling one in the text. 41.3.5.2 was already for the match.
- **Code today:** one reason, `beamers` ("a second, or at once if deliberate", events.mjs:400-401), scoped `innings`
  (events.mjs:437), with the words "dangerous full tosses above waist height" (events.mjs:447). One reason with one
  fixed scope cannot be both.
- **Must:** split it. `beamers` becomes the dangerous series (41.7.4, innings). Add a reason for the deliberate one
  (41.7.6, match) to the list, `SUSPENSION_REASON_TEXT`, the pad's suspend sheet and SCORING_RULES. Old `beamers`
  events keep their recorded scope. Also change "full tosses above waist height" to "non-landing deliveries above
  waist height" (the 4th's term) at events.mjs:447.

### 3. A bouncer over head height is a Wide, not a No ball (Law 22.1.3)

- **4th:** 22.1.3, quoted under Law 22. The 3rd's 21.10 (No ball) is removed, and Law 21 is renumbered after it.
- **What changed:** MCC: "a bouncer over head height will now be a Wide in Law, not a No ball." Three consequences for
  a scorer:
  1. If the striker hits it, it is no Wide (22.3.1). It is a fair delivery: it counts in the over, the runs are the
     striker's, and he can be caught.
  2. If he does not hit it, it is a Wide. Runs run are wides (22.7), not byes, and not off the bat.
  3. Only *repeated* short deliveries over head height are a No ball, under 41.6.2 and 41.6.3, with a caution and
     then suspension.
- **Code today:** confirmed, and the fold needs no change. There is no head-height no-ball kind: `NB_TYPE` is front
  foot, a waist-high full toss and a beamer (events.mjs:143), and a scorer records a Wide as a Wide. What might
  mislead a scorer:
  - The quick pad's no-ball kinds show a bare **"Height"** (`apps/web/src/scorer/extras.js:38`). Under the 3rd, a
    scorer could have used it for a head-high bouncer.
  - The no-ball sheet's note says a batter can be "dismissed caught, run out, stumped, handled ball" off a no-ball
    (`sheets.jsx:70`, repeated for the other kinds at :72). That is wrong in both Editions (21.17).
  - `RulebookView.jsx:68` lists the no-ball causes.
- **Must:**
  - Relabel "Height" as a waist-high full toss.
  - Say in SCORING_RULES and the rulebook screen that a head-high bouncer is a Wide.
  - Optionally add a no-ball kind for 41.6 (unfair or dangerous short deliveries). None of the current kinds fits it.
  - Knock-on: the pad cannot record a wicket off a Wide. `BALL_TYPE.WICKET` is always a legal ball
    (`ILLEGAL` at events.mjs:82 holds only Wd and Nb; replay.mjs:579-594). Stumped or hit wicket off a head-high Wide (22.9, 39.4) becomes more likely.
  - Whether a head-high bouncer still earns a free hit is for the competition's playing conditions. As a Wide it does
    not, unless they say so.

### 4. Deliberate short running: the fielding captain chooses who faces (Laws 18.5.2, 18.13.2)

- **4th:** 18.5.2 no longer returns the batters to their original ends. It ends: "Instruct the fielding captain to
  decide which of the batters at the wicket, including the incoming batter if applicable, shall face the next delivery
  (see 18.13)." 18.11.2.2 makes the exception explicit.
- **What changed:** MCC: "the fielding side will also get to determine which of the batters takes strike."
- **Code today:** `shortRunning()` (events.mjs:1053-1078) records the delivery with no runs, so the batters stay at
  their original ends. The doc comment says so ("returns the batters to the ends they started from", events.mjs:1054-1055),
  and so does the pad's sheet ("The batters go back to the ends they started from", penaltySheet.jsx:144-145), and
  SCORING_RULES.md:557.
- **Must:**
  - After the award, the pad asks who the fielding captain chose to face.
  - If it is the other batter, the pad records a change of ends: a `batters` event with the same two swapped. The
    server already accepts one (`battersRefusal`, "a change of ends … is always allowed").
  - If a wicket fell on the same delivery, the choice includes the incoming batter.
  - At an over's end, the choice is who faces the first ball of the next over.
  - Change the words above.
  - 18.5.1.2 (abandoning a run is not short running) needs no code.

### 5. An obstruction that prevents a catch: the fielding captain chooses who faces (Law 37.5.2)

- **4th:** 37.5.2, quoted under Law 37. 18.13.1 is the same rule.
- **What changed:** MCC: "Law 37.5.2, when a batter is out obstructing a catch, will now give that power to the
  fielding captain."
- **Code today:** the wicket sheet records Obstructing the field against the striker (it asks "who" only for a run out
  or retired out, `asksWho` at sheets.jsx:658). The fold empties the striker's end (replay.mjs:632-634), so
  the incoming batter always faces.
- **Must:** when the obstruction prevented a catch, the pad asks which of the two the fielding captain chose. If it
  was the non-striker, the pad places the incoming batter at the non-striker's end. No runs count: `value` 0, with any
  5-run award standing. A separate gap, not new in the 4th: under 37.1.1 either batter can be out Obstructing the
  field, and the sheet cannot record the non-striker.

### 6. Penalty runs after the result (Laws 41.17.2, 16.6.1, 16.7)

- **4th:** 41.17.2, quoted at the top. It adds: "Where more than one award of Penalty runs is required during the same
  delivery, the umpires shall award them in the order that the offences took place." 16.6.1 points to it: nothing
  after the result is part of the match, "except as in Law 41.17.2". 16.7: if the side batting last has completed its
  innings short of the total, "but as the result of an award of 5 Penalty runs its total of runs is then sufficient to
  win, the result shall be stated as a win to that side by Penalty runs."
- **What changed:** MCC's change summary: if a side offends after a result has been reached but before the umpires
  leave the field, penalty runs can be awarded, and if that undoes the result, the match continues.
- **Code today:**
  - `penaltyRefusal` refuses an award to the fielding side once the chase is complete: `if (toFielding &&
    innings[1]?.complete) return REFUSAL.MATCH_DECIDED` (laws.mjs:340). The pad explains why in `penalty.js:107`.
  - `ballRefusal` refuses every delivery after it (laws.mjs:356).
  - A chase that reached its target stays complete (`settleInnings`, replay.mjs:758-761; `inningsOverReason`,
    replay.mjs:853).
  - `describeResult` (replay.mjs:1196) has no "by Penalty runs".
- **Must:**
  - Accept either side's award until the match is concluded. The app has no "umpires left the field" event, so the
    cut-off needs a decision: the match's completion, or the last innings' seal.
  - When an award to the fielding side lifts the target above a chase that ended by reaching it, the innings is no
    longer over and play resumes. The target-reached ending has to be re-derived, not sticky.
  - When an award to the batting side makes a completed chase sufficient, the result reads "by Penalty runs".
  - Several awards on one delivery are recorded in the order given; the log order already does this.

### 7. Words and numbers to follow the 4th (no behaviour change)

- 41.2 is "Unfair actions" (41.2.1).
- 41.6 is "short deliveries". 41.7 is "non-landing deliveries".
- The no-ball clauses are 21.15 and 21.17.
- `SUSPENSION_REASON_TEXT.protected_area` says "after a first and final warning". That is the batter's procedure. The
  bowler's (41.13) is a caution, a final warning, and suspension on the third, as in the 3rd.

## Also found in the 4th text: not new in the 4th, but wrong in the code

These were probably the same in the 3rd, so they are not 4th-Edition changes. They matter to the penalty-reason list in
flight.

- **Some deliveries with a penalty do not count in the over.** 17.3.2.5: when 24.4, 28.2, 41.4 or 41.5 is applied.
  The code records the award apart from the delivery, which still counts.
- **41.14.3 and 41.15.3 disallow the delivery's runs**, like short running: "disallow all runs to the batting side;
  return any not out batter to their original end". The `protected_area` award does not. The same two-event shape as
  `shortRunning()` would fit.
- **Penalty reasons missing from the list:**
  - to the batting side: 24.4, 27.4.2, 28.6.3, 41.4, 41.5 and 41.12 (the fielder);
  - to the fielding side: 41.16 (stealing a run);
  - to either side: 26.4.2, 41.2.1, 41.3 (by the batting side) and Law 42.
- **Suspension reasons missing from the list:** 21.3.2 (throwing, the innings) and Law 42.4 and 42.5 (a player
  suspended for conduct, which can include the bowler mid-over).
- **Ball tampering (41.3.5)** suspends only on a further instance by the fielding side, not "at once" (events.mjs:410).
- **Handled the ball** is still not a way out (37.1.2), and `DISMISSAL.HANDLED_BALL` is still offered.

---

## Renumbering map

Computed at commit **`6158091`** (branch `claude/scrbrd-os-03vb2m`). Other sessions are committing to this branch, so
**match each row by its file and the exact text in "Cites now"**, and use the line number only to find it. There is one
row per citation: a line that cites two clauses has two rows. "Should cite" is the 4th Edition's number.

Three kinds of file need no change:

- **Frozen files.** `db/08`, `db/45` and `db/48` are in `db/SHIPPED.sha256` and must not be edited. Every citation in
  them (2.7, 36, 41) is already right.
- **Correct citations.** Everything not listed here is right in the 4th Edition: 2.7, 17.8 where it means the over
  finished by another bowler, 18, 18.5.2, 21, 23, 25.4, 25.4.2, 25.4.3, 25.4.4, 28.2, 28.3, 36, 40, 40.1, 41, 41.3, 41.6,
  41.7, 41.8, 41.9, 41.13 and 41.14.
- **Lines that also change in behaviour.** Some lines cite a correct number but describe a behaviour the 4th Edition
  changes: 18.5.2 (short running), 41.7 and 41.8 (scope), and the no-ball's byes. Their words change with build items
  1, 2 and 4, and with change 1 in flight. They are not part of this map.

### A. Code, tests, tools and docs

| # | Location | Cites now (exact text) | Should cite |
|---|---|---|---|
| 1 | packages/scoring/src/laws.mjs:75 | `// Law 17.8: not two overs, or parts, running` | `Law 17.6` |
| 2 | packages/scoring/src/laws.mjs:76 | `// Law 17.8.1: a change during an over says why` | `Law 17.7.1` |
| 3 | packages/scoring/src/laws.mjs:125 | `// Law 17.8.1. No clause number in the words` | `Law 17.7.1` |
| 4 | packages/scoring/src/laws.mjs:202 | `// Law 17.8, "or parts thereof". This is also the whole of the` | `Law 17.6` (the rest of the comment, about the man who finishes the over, is 17.8 and can say so) |
| 5 | packages/scoring/src/laws.mjs:207 | `// Law 17.8.1: an over is finished by another bowler` | `Law 17.7.1` |
| 6 | packages/scoring/src/laws.mjs:526-527 | `Law 17.8: "a bowler shall not bowl two overs, or parts thereof, consecutively in the same innings"` | `Law 17.6: "… provided they do not bowl two overs consecutively, nor bowl parts of each of two consecutive overs, in the same innings"` |
| 7 | packages/scoring/src/events.mjs:98 | `off the bat — the striker's (Law 21.6)` | `Law 21.15` |
| 8 | packages/scoring/src/events.mjs:122 | `wicket was put down at (Law 38.2)` | `Law 38.4` |
| 9 | packages/scoring/src/events.mjs:210-211 | `(Law 21.19 lists the ways out off a free hit — run out, handled, obstructing, hit twice; …)` | `Law 21.17`, which lists the ways out from a No ball: hit the ball twice, obstructing the field, run out. "Handled" is not one. The free hit itself is the playing conditions', not a Law. |
| 10 | packages/scoring/src/events.mjs:278 | `// 41.5 (and 18.5): deliberate short running` | `// 18.5:` (18.5.2) |
| 11 | packages/scoring/src/events.mjs:279 | `// 41.4: distracting, deceiving or obstructing a fielder` | No Law clause: a batter who obstructs is out under Law 37. The penalty-reason change in flight decides the reason's fate. |
| 12 | packages/scoring/src/events.mjs:280 | `// 41.12: damaging the pitch on purpose` | `// 41.14:` |
| 13 | packages/scoring/src/events.mjs:282 | `// 41.15: striking the pitch unfairly` | No such offence. `41.15` only if the reason becomes the striker's batting position in or near the protected area. Decided by the penalty-reason change. |
| 14 | packages/scoring/src/events.mjs:283 | `// 41.17: a batter wasting time` | `// 41.10:` |
| 15 | packages/scoring/src/events.mjs:289 | `// 41.1: dangerous or unfair play by a fielder` | `// 41.2.1:` |
| 16 | packages/scoring/src/events.mjs:314 | `"deliberate short running (Law 41.5)"` | `(Law 18.5)` |
| 17 | packages/scoring/src/events.mjs:315 | `"… obstructing the fielders (Law 41.4)"` | No Law clause (as row 11) |
| 18 | packages/scoring/src/events.mjs:316 | `"damaging the pitch on purpose (Law 41.12)"` | `(Law 41.14)` |
| 19 | packages/scoring/src/events.mjs:318 | `"striking the pitch unfairly (Law 41.15)"` | No such offence (as row 13) |
| 20 | packages/scoring/src/events.mjs:319 | `"a batter wasting time after a first and final warning (Law 41.17)"` | `(Law 41.10)` |
| 21 | packages/scoring/src/events.mjs:324 | `"dangerous or unfair play (Law 41.1)"` | `(Law 41.2.1)` |
| 22 | packages/scoring/src/events.mjs:330-331 | the example `"deliberate short running (Law` / `41.5)"` | `18.5)"`, to match row 16 |
| 23 | packages/scoring/src/events.mjs:406-407 | `(41.13 in this research; the penalty research gave 41.14 — to be confirmed)` | `(41.13)` |
| 24 | packages/scoring/src/events.mjs:752 | `Law 17.8.1: only a bowler who is` | `Law 17.7.1` |
| 25 | packages/scoring/src/events.mjs:1020 | `Penalty runs: five (Law 41.18)` | `Law 41.17` |
| 26 | packages/scoring/src/events.mjs:1053 | `Deliberate short running (Law 18.5.2, Law 41.5)` | `(Law 18.5.2)` |
| 27 | packages/scoring/src/replay.mjs:176 | `(SCRBRD-080, Law 17.8.1)` | `Law 17.7.1` |
| 28 | packages/scoring/src/replay.mjs:447 | `// Law 41.18. To the batting side` | `Law 41.17` |
| 29 | packages/scoring/src/replay.mjs:628 | `the survivor is at the other (Law 38.2)` | `Law 38.4` |
| 30 | packages/scoring/src/replay.mjs:935 | `CROSS INNINGS (SCRBRD-094, Law 41.18)` | `Law 41.17` |
| 31 | packages/scoring/src/commentary.mjs:667 | `disallows this ball's runs (Law 41.5)` | `Law 18.5` |
| 32 | packages/scoring/test/laws.test.mjs:228 | `the reason Law 17.8.1 gives` | `Law 17.7.1` |
| 33 | packages/scoring/test/laws.test.mjs:229 | `accepted with its reason (Law 17.8.1)` | `Law 17.7.1` |
| 34 | packages/scoring/test/laws.test.mjs:332 | `so Law 17.8 reads the same after one` | `Law 17.6` |
| 35 | packages/scoring/test/replay.test.mjs:1217 | `or their next (Law 41.18)` | `Law 41.17` |
| 36 | packages/scoring/test/laws-spec.test.mjs:215 | `where the wicket was put down (Law 38.2)` | `Law 38.4` |
| 37 | packages/scoring/test/phases.test.mjs:270 | `Run out is out on a free hit (Law 21.19)` | `Law 21.17` (out from a No ball; the free hit is the playing conditions') |
| 38 | packages/sync/test/held.test.mjs:61 | `then A Nel again — Law 17.8 —` | `Law 17.6` |
| 39 | packages/sync/test/held.test.mjs:85 | `is refused (Law 17.8)` | `Law 17.6` |
| 40 | packages/sync/test/held.test.mjs:248 | `Nel again (refused, Law 17.8)` | `Law 17.6` |
| 41 | apps/web/src/scorer/sheets.jsx:654 | `put down (Law 38.2)` | `Law 38.4` |
| 42 | apps/web/src/scorer/sheets.jsx:790 | `Law 17.8.1 allows that only for an` | `Law 17.7.1` |
| 43 | apps/web/src/scorer/sheets.jsx:809 | `// Can't bowl consecutive overs (Law 17.8)` | `Law 17.6` |
| 44 | db/99_rls_verify.sql:4696 | `-- Law 41.18, as the fold credits it` | `Law 41.17` (not ledgered; free to edit) |
| 45 | tools/smoke-laws.mjs:171 | `a second over running is refused (Law 17.8)` | `Law 17.6` |
| 46 | tools/smoke-browser-held.mjs:235 | `// Law 17.8: not two overs running` | `Law 17.6` |
| 47 | tools/smoke-browser-held.mjs:374 | `(refused, Law 17.8)` | `Law 17.6` |
| 48 | tools/smoke-fold-figures.mjs:152 | `the one the next ball is in (Law 17.8)` | `Law 17.6` |
| 49 | docs/SCORING_RULES.md:189 | `or parts of two, running (Law 17.8)` | `Law 17.6` |
| 50 | docs/SCORING_RULES.md:190 | `injury or suspension (Law 17.8.1)` | `Law 17.7.1` |
| 51 | docs/SCORING_RULES.md:232 | `refused under Law 17.8` | `Law 17.6` |
| 52 | docs/SCORING_RULES.md:325 | `Law 17.8.1: a bowler incapacitated or suspended` | `Law 17.7.1` |
| 53 | docs/SCORING_RULES.md:329 | `the bowler's end (Law 38.2)` | `Law 38.4` |
| 54 | docs/SCORING_RULES.md:331 | `(Law 21.6, Law 23)` | `(Law 21.15, Law 23)` |
| 55 | docs/SCORING_RULES.md:339 | `at (Law 38.2)` | `Law 38.4` |
| 56 | docs/SCORING_RULES.md:407 | `Law 17.8.1 lets a bowler be replaced` | `Law 17.7.1` |
| 57 | docs/SCORING_RULES.md:557 | `(Law 18.5.2, 41.5)` | `(Law 18.5.2)` |
| 58 | docs/SCORING_RULES.md:569 | `` `short_running` 41.5 `` | `18.5` |
| 59 | docs/SCORING_RULES.md:569 | `` `obstruction_distraction` 41.4 `` | none (as row 11) |
| 60 | docs/SCORING_RULES.md:569 | `` `pitch_damage` 41.12 `` | `41.14` |
| 61 | docs/SCORING_RULES.md:569 | `` `striking_pitch` 41.15 `` | none (as row 13) |
| 62 | docs/SCORING_RULES.md:569 | `` `time_wasting` 41.17 `` | `41.10` |
| 63 | docs/SCORING_RULES.md:569 | `` `unfair_play` 41.1 `` | `41.2.1` |

### B. Test fixtures: leave as they are

These strings test the clause-stripping (`withoutLawClause`, `noClause`) and the on-screen clause sweep. They are not
claims about the Laws.

- apps/web/test/pad-feel.test.mjs:212, 213
- apps/web/test/law-clauses.test.mjs:40, 51, 52, 53, 161, 165, 167
- packages/scoring/test/laws.test.mjs:485 ("Laws 41.6 and 41.7")

Optional, to match row 16 if its text changes: the example `"deliberate short running (Law 41.5)"` at
apps/web/src/scorer/penalty.js:48, packages/scoring/test/laws.test.mjs:484 and apps/web/test/penalty-sheet.test.mjs:169.
The assertions compare against the stripped words, so they pass either way.

### C. The backlog (outside the searched folders; a historical record)

| Location | Cites now | Should cite |
|---|---|---|
| audit/SCRBRD_IMPLEMENTATION_BACKLOG.md:2864 | `(Law 21.6, Law 23)` | `(Law 21.15, Law 23)` |
| audit/SCRBRD_IMPLEMENTATION_BACKLOG.md:2878 | `which end is empty (Law 38.2)` | `Law 38.4` |
| audit/SCRBRD_IMPLEMENTATION_BACKLOG.md:2943 | `25.4.2's "only at the fall of a wicket …"` | `25.4.4's` (the entry at :2953 already says so) |
| audit/SCRBRD_IMPLEMENTATION_BACKLOG.md:3273 | `Allowed (Law 17.8.1)` | `Law 17.7.1` |

Leave lines 3576–3602 and 3994 as they are. They record what a screen said at the time, and which numbers were then
still to verify.

## Sources

- **4th Edition (2026), full text:** the PDF Kameel supplied (Laws of Cricket, 2017 Code 4th Edition, © MCC 2026),
  read in full for Laws 2, 16–42. Published at
  [lords.org](https://www.lords.org/getmedia/1d908298-5c44-468d-b6a7-e1414a1296e0/Laws-of-Cricket-2017-Code-4th-Edition-(2026)_3.pdf).
- MCC's change summaries, read through web searches (lords.org is blocked by the proxy):
  - [changes explained](https://www.lords.org/getmedia/5ff72819-c9ef-448c-87e3-b051408e1803/Changes-to-Laws-for-2026-edition-explained_2.pdf)
  - [list of changes](https://www.lords.org/getmedia/0855ddfe-e219-4363-8652-2d7de233c4b9/Changes-to-Laws-for-2026-edition_1.pdf)
  - [ten major changes](https://www.lords.org/getmedia/72990a68-98cd-4c6e-89ac-a2dce54533ad/Ten-major-changes-to-Laws-for-2026-edition_5.pdf)
  - [announcement](https://www.lords.org/lords/news-stories/mcc-announces-new-edition-of-laws-from-1-october-2026)
- **3rd Edition (2022) column:** the earlier pass of this document (commit `1268224`), made through web searches of
  lords.org's Law pages, for example [No Ball](https://www.lords.org/mcc/the-laws/no-ball),
  [Unfair Play](https://www.lords.org/mcc/the-laws/unfair-play) and [The Over](https://www.lords.org/mcc/the-laws/the-over).
- 2017 Code (Handled the ball merged into Obstructing the field):
  [summary paper](https://apps.lords.org/assets/Uploads/Law-Summary-Paper-updated-28-June.pdf)
